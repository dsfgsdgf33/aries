/**
 * ARIES — Multi-Provider Manager
 * Manages free AI API providers, tests keys, tracks rate limits/quotas.
 * Normalizes all responses to OpenAI chat completion format.
 * @module core/provider-manager
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { EventEmitter } = require('events');

/** Default provider templates */
const PROVIDER_DEFAULTS = {
  gemini: {
    name: 'gemini',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
    model: 'gemini-2.0-flash',
    authType: 'query',
    rateLimit: { rpm: 15, tpm: 1000000 },
  },
  groq: {
    name: 'groq',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'llama-3.1-70b-versatile',
    authType: 'bearer',
    rateLimit: { rpm: 30, tpm: 14400 },
  },
  mistral: {
    name: 'mistral',
    endpoint: 'https://api.mistral.ai/v1/chat/completions',
    model: 'mistral-small-latest',
    authType: 'bearer',
    rateLimit: { rpm: 30, tpm: 500000 },
  },
  cohere: {
    name: 'cohere',
    endpoint: 'https://api.cohere.com/v2/chat',
    model: 'command-r',
    authType: 'bearer',
    rateLimit: { rpm: 20, tpm: 100000 },
  },
  openrouter: {
    name: 'openrouter',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'meta-llama/llama-3.1-8b-instruct:free',
    authType: 'bearer',
    rateLimit: { rpm: 20, tpm: 200000 },
  },
  huggingface: {
    name: 'huggingface',
    endpoint: 'https://api-inference.huggingface.co/models/meta-llama/Meta-Llama-3-8B-Instruct',
    model: 'meta-llama/Meta-Llama-3-8B-Instruct',
    authType: 'bearer',
    rateLimit: { rpm: 10, tpm: 50000 },
  },
  together: {
    name: 'together',
    endpoint: 'https://api.together.xyz/v1/chat/completions',
    model: 'meta-llama/Llama-3-70b-chat-hf',
    authType: 'bearer',
    rateLimit: { rpm: 30, tpm: 200000 },
  },
  cerebras: {
    name: 'cerebras',
    endpoint: 'https://api.cerebras.ai/v1/chat/completions',
    model: 'llama3.1-8b',
    authType: 'bearer',
    rateLimit: { rpm: 30, tpm: 60000 },
  },
  sambanova: {
    name: 'sambanova',
    endpoint: 'https://api.sambanova.ai/v1/chat/completions',
    model: 'Meta-Llama-3.1-8B-Instruct',
    authType: 'bearer',
    rateLimit: { rpm: 30, tpm: 100000 },
  },
};

class ProviderManager extends EventEmitter {
  /**
   * @param {Object} opts
   * @param {string} [opts.dataDir] - Directory for persistence
   */
  constructor(opts = {}) {
    super();
    this.dataDir = opts.dataDir || path.join(__dirname, '..', 'data');
    /** @type {Map<string, Object>} */
    this.providers = new Map();
    /** @type {Map<string, {calls: number[], tokens: number}>} */
    this.usage = new Map();
    /** @type {Map<string, {total: number, errors: number, lastCall: number|null}>} */
    this.stats = new Map();
    this._load();
  }

  /** Load providers from disk */
  _load() {
    try {
      const cfgPath = path.join(this.dataDir, 'providers.json');
      const keysPath = path.join(this.dataDir, 'providers-keys.json');
      if (fs.existsSync(cfgPath)) {
        const configs = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        let keys = {};
        if (fs.existsSync(keysPath)) {
          keys = JSON.parse(fs.readFileSync(keysPath, 'utf8'));
        }
        for (const cfg of configs) {
          cfg.apiKey = keys[cfg.name] || cfg.apiKey || '';
          this.providers.set(cfg.name, cfg);
          this.usage.set(cfg.name, { calls: [], tokens: 0 });
          this.stats.set(cfg.name, { total: 0, errors: 0, lastCall: null });
        }
      }
    } catch (e) {
      // Silent — fresh start
    }
  }

  /** Save providers to disk (keys separated) */
  _save() {
    try {
      if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
      const configs = [];
      const keys = {};
      for (const [name, cfg] of this.providers) {
        keys[name] = cfg.apiKey || '';
        var copy = Object.assign({}, cfg);
        delete copy.apiKey;
        configs.push(copy);
      }
      fs.writeFileSync(path.join(this.dataDir, 'providers.json'), JSON.stringify(configs, null, 2));
      fs.writeFileSync(path.join(this.dataDir, 'providers-keys.json'), JSON.stringify(keys, null, 2));
    } catch (e) {
      this.emit('error', e);
    }
  }

  /**
   * Add or update a provider
   * @param {Object} config
   */
  addProvider(config) {
    var defaults = PROVIDER_DEFAULTS[config.name] || {};
    var merged = Object.assign({}, defaults, config, {
      tested: false,
      lastTest: null,
      status: 'untested',
    });
    if (!merged.endpoint) throw new Error('Provider endpoint required');
    this.providers.set(merged.name, merged);
    if (!this.usage.has(merged.name)) this.usage.set(merged.name, { calls: [], tokens: 0 });
    if (!this.stats.has(merged.name)) this.stats.set(merged.name, { total: 0, errors: 0, lastCall: null });
    this._save();
    this.emit('provider-added', merged.name);
    return merged;
  }

  /**
   * Remove a provider
   * @param {string} name
   */
  removeProvider(name) {
    this.providers.delete(name);
    this.usage.delete(name);
    this.stats.delete(name);
    this._save();
    this.emit('provider-removed', name);
  }

  /**
   * Test a provider by sending a simple prompt
   * @param {string} name
   * @returns {Promise<Object>}
   */
  async testProvider(name) {
    var provider = this.providers.get(name);
    if (!provider) throw new Error('Provider not found: ' + name);
    try {
      var result = await this.callProvider(name, [{ role: 'user', content: 'Say hello in one word.' }], { max_tokens: 20 });
      provider.tested = true;
      provider.lastTest = Date.now();
      provider.status = 'active';
      this._save();
      return { success: true, response: result };
    } catch (e) {
      provider.tested = true;
      provider.lastTest = Date.now();
      provider.status = 'error';
      provider.lastError = e.message;
      this._save();
      return { success: false, error: e.message };
    }
  }

  /**
   * Test all providers
   * @returns {Promise<Object[]>}
   */
  async testAll() {
    var results = [];
    for (const [name] of this.providers) {
      var r = await this.testProvider(name);
      results.push(Object.assign({ name: name }, r));
    }
    return results;
  }

  /**
   * Get available (active, not rate-limited) providers
   * @returns {Object[]}
   */
  getAvailable() {
    var now = Date.now();
    var available = [];
    for (const [name, cfg] of this.providers) {
      if (cfg.status !== 'active') continue;
      var u = this.usage.get(name);
      // Clean old calls (older than 60s)
      if (u) u.calls = u.calls.filter(function(t) { return now - t < 60000; });
      var rpm = cfg.rateLimit ? cfg.rateLimit.rpm : 30;
      if (u && u.calls.length >= rpm) continue;
      available.push(cfg);
    }
    return available;
  }

  /**
   * Get best (least-loaded active) provider
   * @returns {Object|null}
   */
  getBestProvider() {
    var available = this.getAvailable();
    if (available.length === 0) return null;
    var best = null;
    var bestLoad = Infinity;
    for (var i = 0; i < available.length; i++) {
      var u = this.usage.get(available[i].name);
      var load = u ? u.calls.length : 0;
      if (load < bestLoad) {
        bestLoad = load;
        best = available[i];
      }
    }
    return best;
  }

  /**
   * Make an API call to a provider (normalized to OpenAI format)
   * @param {string} name
   * @param {Array} messages
   * @param {Object} [opts]
   * @returns {Promise<Object>}
   */
  callProvider(name, messages, opts) {
    var self = this;
    var provider = this.providers.get(name);
    if (!provider) return Promise.reject(new Error('Provider not found: ' + name));

    // Track rate limit
    var u = this.usage.get(name);
    if (u) u.calls.push(Date.now());

    var s = this.stats.get(name);
    if (s) { s.total++; s.lastCall = Date.now(); }

    // Build request based on provider type
    if (provider.name === 'gemini' || provider.authType === 'query') {
      return this._callGemini(provider, messages, opts);
    } else if (provider.name === 'cohere') {
      return this._callCohere(provider, messages, opts);
    } else if (provider.name === 'huggingface') {
      return this._callHuggingFace(provider, messages, opts);
    } else {
      return this._callOpenAICompatible(provider, messages, opts);
    }
  }

  /**
   * Call OpenAI-compatible endpoint (Groq, Mistral, OpenRouter, Together, Cerebras, SambaNova)
   * @private
   */
  _callOpenAICompatible(provider, messages, opts) {
    var self = this;
    opts = opts || {};
    var body = JSON.stringify({
      model: opts.model || provider.model,
      messages: messages,
      max_tokens: opts.max_tokens || 1024,
      temperature: opts.temperature != null ? opts.temperature : 0.7,
    });

    return this._httpPost(provider.endpoint, body, {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + provider.apiKey,
    }).then(function(data) {
      // Already in OpenAI format
      return data;
    }).catch(function(e) {
      var s = self.stats.get(provider.name);
      if (s) s.errors++;
      throw e;
    });
  }

  /**
   * Call Google Gemini (query param auth, different request/response format)
   * @private
   */
  _callGemini(provider, messages, opts) {
    var self = this;
    opts = opts || {};
    // Convert OpenAI messages to Gemini format
    var contents = [];
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      if (m.role === 'system') {
        contents.push({ role: 'user', parts: [{ text: m.content }] });
        contents.push({ role: 'model', parts: [{ text: 'Understood.' }] });
      } else {
        contents.push({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        });
      }
    }
    var body = JSON.stringify({
      contents: contents,
      generationConfig: {
        maxOutputTokens: opts.max_tokens || 1024,
        temperature: opts.temperature != null ? opts.temperature : 0.7,
      },
    });
    var endpoint = provider.endpoint + '?key=' + provider.apiKey;

    return this._httpPost(endpoint, body, {
      'Content-Type': 'application/json',
    }).then(function(data) {
      // Normalize Gemini response to OpenAI format
      var text = '';
      if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) {
        text = data.candidates[0].content.parts.map(function(p) { return p.text || ''; }).join('');
      }
      return {
        id: 'gemini-' + Date.now(),
        object: 'chat.completion',
        model: provider.model,
        choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };
    }).catch(function(e) {
      var s = self.stats.get(provider.name);
      if (s) s.errors++;
      throw e;
    });
  }

  /**
   * Call Cohere v2 chat (different request/response format)
   * @private
   */
  _callCohere(provider, messages, opts) {
    var self = this;
    opts = opts || {};
    var body = JSON.stringify({
      model: opts.model || provider.model,
      messages: messages,
      max_tokens: opts.max_tokens || 1024,
      temperature: opts.temperature != null ? opts.temperature : 0.7,
    });

    return this._httpPost(provider.endpoint, body, {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + provider.apiKey,
    }).then(function(data) {
      // Cohere v2 chat format — normalize
      var text = '';
      if (data.message && data.message.content && data.message.content[0]) {
        text = data.message.content[0].text || '';
      } else if (data.text) {
        text = data.text;
      }
      return {
        id: data.id || 'cohere-' + Date.now(),
        object: 'chat.completion',
        model: provider.model,
        choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
        usage: data.meta && data.meta.tokens ? {
          prompt_tokens: data.meta.tokens.input_tokens || 0,
          completion_tokens: data.meta.tokens.output_tokens || 0,
          total_tokens: (data.meta.tokens.input_tokens || 0) + (data.meta.tokens.output_tokens || 0),
        } : { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };
    }).catch(function(e) {
      var s = self.stats.get(provider.name);
      if (s) s.errors++;
      throw e;
    });
  }

  /**
   * Call HuggingFace Inference API
   * @private
   */
  _callHuggingFace(provider, messages, opts) {
    var self = this;
    opts = opts || {};
    // HF Inference uses { inputs: "..." } or { inputs: messages } depending on model
    var body = JSON.stringify({
      inputs: messages[messages.length - 1].content,
      parameters: {
        max_new_tokens: opts.max_tokens || 1024,
        temperature: opts.temperature != null ? opts.temperature : 0.7,
        return_full_text: false,
      },
    });
    // Use model-specific endpoint
    var endpoint = provider.endpoint;
    if (opts.model) {
      endpoint = 'https://api-inference.huggingface.co/models/' + opts.model;
    }

    return this._httpPost(endpoint, body, {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + provider.apiKey,
    }).then(function(data) {
      var text = '';
      if (Array.isArray(data) && data[0]) {
        text = data[0].generated_text || '';
      } else if (data.generated_text) {
        text = data.generated_text;
      } else if (typeof data === 'string') {
        text = data;
      }
      return {
        id: 'hf-' + Date.now(),
        object: 'chat.completion',
        model: provider.model,
        choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };
    }).catch(function(e) {
      var s = self.stats.get(provider.name);
      if (s) s.errors++;
      throw e;
    });
  }

  /**
   * Generic HTTPS POST
   * @private
   * @param {string} urlStr
   * @param {string} body
   * @param {Object} headers
   * @returns {Promise<Object>}
   */
  _httpPost(urlStr, body, headers) {
    return new Promise(function(resolve, reject) {
      try {
        var parsed = new URL(urlStr);
        var mod = parsed.protocol === 'https:' ? https : http;
        var reqHeaders = Object.assign({}, headers, {
          'Content-Length': Buffer.byteLength(body),
        });
        var req = mod.request(parsed, {
          method: 'POST',
          headers: reqHeaders,
          timeout: 30000,
        }, function(res) {
          var chunks = '';
          res.on('data', function(c) { chunks += c; });
          res.on('end', function() {
            if (res.statusCode >= 400) {
              return reject(new Error('HTTP ' + res.statusCode + ': ' + chunks.slice(0, 500)));
            }
            try {
              resolve(JSON.parse(chunks));
            } catch (e) {
              reject(new Error('Invalid JSON response: ' + chunks.slice(0, 200)));
            }
          });
        });
        req.on('error', reject);
        req.on('timeout', function() { req.destroy(); reject(new Error('Request timeout')); });
        req.write(body);
        req.end();
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * Get usage stats per provider
   * @returns {Object}
   */
  getStats() {
    var result = {};
    var now = Date.now();
    for (const [name, cfg] of this.providers) {
      var u = this.usage.get(name) || { calls: [], tokens: 0 };
      var s = this.stats.get(name) || { total: 0, errors: 0, lastCall: null };
      // Clean old calls
      u.calls = u.calls.filter(function(t) { return now - t < 60000; });
      var rpm = cfg.rateLimit ? cfg.rateLimit.rpm : 30;
      result[name] = {
        name: name,
        model: cfg.model,
        status: cfg.status,
        endpoint: cfg.endpoint,
        authType: cfg.authType || 'bearer',
        rateLimit: cfg.rateLimit,
        currentRPM: u.calls.length,
        maxRPM: rpm,
        totalCalls: s.total,
        errors: s.errors,
        lastCall: s.lastCall,
        lastTest: cfg.lastTest,
        lastError: cfg.lastError || null,
      };
    }
    return result;
  }

  /**
   * Get total capacity across all providers
   * @returns {Object}
   */
  getCapacity() {
    var totalRPM = 0;
    var activeProviders = 0;
    var exhausted = 0;
    var errored = 0;
    for (const [, cfg] of this.providers) {
      if (cfg.status === 'active') {
        totalRPM += cfg.rateLimit ? cfg.rateLimit.rpm : 0;
        activeProviders++;
      } else if (cfg.status === 'exhausted') {
        exhausted++;
      } else if (cfg.status === 'error') {
        errored++;
      }
    }
    return {
      totalProviders: this.providers.size,
      activeProviders: activeProviders,
      exhaustedProviders: exhausted,
      erroredProviders: errored,
      totalRPM: totalRPM,
      availableNow: this.getAvailable().length,
    };
  }
}

module.exports = { ProviderManager, PROVIDER_DEFAULTS };
