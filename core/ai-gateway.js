/**
 * ARIES v5.0 — Smart AI Gateway (INDEPENDENT)
 * 
 * Routes AI requests directly to api.anthropic.com:
 *   1. sk-ant-oat*  → Direct to Anthropic via OAuth Bearer + special headers
 *   2. sk-ant-api*  → Direct to Anthropic via x-api-key header
 * 
 * Fully independent — no external gateway dependencies.
 * OpenAI-compatible /v1/chat/completions endpoint on port 18800.
 * Streaming SSE, token tracking, caching, rate limiting, cost estimation.
 * Uses only Node.js built-in modules — zero npm dependencies.
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

const DATA_DIR = path.join(__dirname, '..', 'data');
const USAGE_FILE = path.join(DATA_DIR, 'gateway-usage.json');

// No Claude Code prefix needed — OAuth tokens work with plain system prompts

/** anthropic-beta header value for OAuth requests */
const OAUTH_BETA_HEADER = 'oauth-2025-04-20';

/** @type {Object<string, string>} Model alias mapping */
const MODEL_ALIASES = {
  'opus': 'anthropic/claude-opus-4-6',
  'sonnet': 'anthropic/claude-sonnet-4-20250514',
  'claude-opus-4': 'anthropic/claude-opus-4-6',
  'claude-sonnet-4': 'anthropic/claude-sonnet-4-20250514',
};

/** @type {Object<string, {input: number, output: number, cacheRead: number, cacheWrite: number}>} Cost per million tokens */
const MODEL_PRICING = {
  'claude-opus-4-6': { input: 15, output: 75, cacheRead: 1.875, cacheWrite: 18.75 },
  'claude-opus-4': { input: 15, output: 75, cacheRead: 1.875, cacheWrite: 18.75 },
  'claude-sonnet-4-20250514': { input: 3, output: 15, cacheRead: 0.375, cacheWrite: 3.75 },
  'claude-sonnet-4': { input: 3, output: 15, cacheRead: 0.375, cacheWrite: 3.75 },
};

/** Route mode constants */
var ROUTE = {
  OAUTH_DIRECT: 'oauth-direct',   // sk-ant-oat* → api.anthropic.com with Bearer
  API_DIRECT: 'api-direct',       // sk-ant-api* → api.anthropic.com with x-api-key
};

class AIGateway extends EventEmitter {
  /**
   * @param {object} config - ariesGateway config section
   * @param {object} parentConfig - full app config (for gateway.fallbackToken)
   */
  constructor(config, parentConfig) {
    super();
    config = config || {};
    parentConfig = parentConfig || {};
    this.config = config;
    this.parentConfig = parentConfig;
    this.port = config.port || 18800;
    this.enabled = config.enabled !== false;
    this.providers = config.providers || {};
    this.maxConcurrent = config.maxConcurrent || 15;
    this.cacheTTLMs = config.cacheTTLMs || 300000;
    this.fallbackChain = config.fallbackChain || ['claude-opus-4-6', 'claude-sonnet-4-20250514'];
    this.costTracking = config.costTracking !== false;
    this.token = config.token || 'aries-gateway-2026';

    /** @type {http.Server|null} */
    this._server = null;
    this._activeConcurrent = 0;
    /** @type {Array<{resolve: Function, reject: Function}>} */
    this._queue = [];
    /** @type {Map<string, {response: object, timestamp: number}>} */
    this._cache = new Map();
    /** @type {Array<object>} Ring buffer of last 200 requests */
    this._requestLog = [];
    this._usage = { byModel: {}, byHour: {}, byDay: {}, totalRequests: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCost: 0, cacheHits: 0, cacheMisses: 0 };
    this._loadUsage();
  }

  // ═══════════════════════════════════════════════════
  //  PERSISTENCE
  // ═══════════════════════════════════════════════════

  _ensureDir() {
    try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) { /* ignore */ }
  }

  _loadUsage() {
    try {
      if (fs.existsSync(USAGE_FILE)) {
        this._usage = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8'));
      }
    } catch (e) { /* use defaults */ }
  }

  _saveUsage() {
    try {
      this._ensureDir();
      fs.writeFileSync(USAGE_FILE, JSON.stringify(this._usage, null, 2));
    } catch (e) { /* ignore */ }
  }

  // ═══════════════════════════════════════════════════
  //  SMART ROUTING — detect token type, pick route
  // ═══════════════════════════════════════════════════

  /**
   * Check if a string is an OAuth token
   * @param {string} key
   * @returns {boolean}
   */
  _isOAuth(key) {
    return typeof key === 'string' && key.includes('sk-ant-oat');
  }

  /**
   * Check if a string is a direct API key
   * @param {string} key
   * @returns {boolean}
   */
  _isApiKey(key) {
    return typeof key === 'string' && key.startsWith('sk-ant-api');
  }

  /**
   * Determine routing based on configured token.
   * 
   * Priority:
   *   1. apiKey contains sk-ant-oat → OAUTH_DIRECT (Bearer auth + special headers)
   *   2. apiKey contains sk-ant-api → API_DIRECT (x-api-key header)
   *   3. oauthToken field set       → OAUTH_DIRECT
   * 
   * @returns {{mode: string, token: string, url: string}}
   */
  _resolveRoute() {
    var providerCfg = this.providers.anthropic || {};
    var apiKey = providerCfg.apiKey || '';
    var oauthToken = providerCfg.oauthToken || '';
    var baseUrl = (providerCfg.baseUrl || 'https://api.anthropic.com/v1') + '/messages';

    // 1. apiKey is an OAuth token → direct to Anthropic with Bearer
    if (this._isOAuth(apiKey)) {
      return { mode: ROUTE.OAUTH_DIRECT, token: apiKey, url: baseUrl };
    }

    // 2. apiKey is a direct API key → direct to Anthropic with x-api-key
    if (this._isApiKey(apiKey)) {
      return { mode: ROUTE.API_DIRECT, token: apiKey, url: baseUrl };
    }

    // 3. Separate oauthToken field
    if (this._isOAuth(oauthToken)) {
      return { mode: ROUTE.OAUTH_DIRECT, token: oauthToken, url: baseUrl };
    }

    // No valid Anthropic key found — Aries requires a direct API key or OAuth token
    throw new Error('No valid Anthropic API key or OAuth token configured. Aries requires direct API access.');
  }

  // ═══════════════════════════════════════════════════
  //  MODEL RESOLUTION
  // ═══════════════════════════════════════════════════

  /**
   * Resolve model alias and extract provider
   * @param {string} modelStr - e.g. "anthropic/claude-opus-4-6" or "opus"
   * @returns {{provider: string, model: string}}
   */
  resolveModel(modelStr) {
    try {
      var resolved = MODEL_ALIASES[modelStr] || modelStr;
      if (resolved.includes('/')) {
        var parts = resolved.split('/');
        return { provider: parts[0], model: parts.slice(1).join('/') };
      }
      return { provider: 'anthropic', model: resolved };
    } catch (e) {
      return { provider: 'anthropic', model: modelStr };
    }
  }

  // ═══════════════════════════════════════════════════
  //  AUTHENTICATION (for incoming requests to THIS gw)
  // ═══════════════════════════════════════════════════

  /**
   * @param {http.IncomingMessage} req
   * @returns {boolean}
   */
  authenticate(req) {
    try {
      var ip = req.socket && req.socket.remoteAddress;
      if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return true;

      var authHeader = req.headers['authorization'] || '';
      var apiKeyHeader = req.headers['x-api-key'] || req.headers['x-aries-key'] || '';
      var bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      var tok = bearerToken || apiKeyHeader;
      if (!tok) return false;
      return tok === this.token || tok === 'aries-api-2026';
    } catch (e) {
      return false;
    }
  }

  // ═══════════════════════════════════════════════════
  //  CACHING
  // ═══════════════════════════════════════════════════

  /** @param {object} body @returns {string} */
  _cacheKey(body) {
    try {
      var key = JSON.stringify({ model: body.model, messages: body.messages, temperature: body.temperature });
      return crypto.createHash('md5').update(key).digest('hex');
    } catch (e) { return ''; }
  }

  /** @param {string} key @returns {object|null} */
  _getCache(key) {
    try {
      if (!key) return null;
      var entry = this._cache.get(key);
      if (!entry) return null;
      if (Date.now() - entry.timestamp > this.cacheTTLMs) { this._cache.delete(key); return null; }
      return entry.response;
    } catch (e) { return null; }
  }

  /** @param {string} key @param {object} response */
  _setCache(key, response) {
    try {
      if (!key) return;
      this._cache.set(key, { response: response, timestamp: Date.now() });
      // Bound cache to 200 entries (was 500) — each entry can be large JSON
      if (this._cache.size > 200) { this._cache.delete(this._cache.keys().next().value); }
    } catch (e) { /* ignore */ }
  }

  // ═══════════════════════════════════════════════════
  //  CONCURRENCY CONTROL
  // ═══════════════════════════════════════════════════

  /** @returns {Promise<void>} */
  _acquireSlot() {
    var self = this;
    if (self._activeConcurrent < self.maxConcurrent) { self._activeConcurrent++; return Promise.resolve(); }
    return new Promise(function(resolve, reject) {
      if (self._queue.length > 50) { reject(new Error('Gateway queue full')); return; }
      self._queue.push({ resolve: resolve, reject: reject });
    });
  }

  _releaseSlot() {
    try {
      if (this._queue.length > 0) { this._queue.shift().resolve(); }
      else { this._activeConcurrent = Math.max(0, this._activeConcurrent - 1); }
    } catch (e) { /* ignore */ }
  }

  // ═══════════════════════════════════════════════════
  //  MESSAGE FORMAT CONVERSION (OpenAI ↔ Anthropic)
  // ═══════════════════════════════════════════════════

  /**
   * Convert OpenAI-format messages to Anthropic format.
   * System prompt is always a plain string.
   * 
   * @param {Array} messages - OpenAI messages array
   * @param {boolean} isOAuth - Whether this is an OAuth request
   * @returns {{system: string, messages: Array}}
   */
  _convertToAnthropic(messages, isOAuth) {
    var systemText = '';
    var anthropicMsgs = [];
    try {
      for (var i = 0; i < messages.length; i++) {
        var msg = messages[i];
        if (msg.role === 'system') {
          systemText += (systemText ? '\n' : '') + (typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content));
        } else {
          anthropicMsgs.push({ role: msg.role === 'assistant' ? 'assistant' : 'user', content: msg.content });
        }
      }
      if (anthropicMsgs.length === 0) {
        anthropicMsgs.push({ role: 'user', content: 'Hello' });
      }
    } catch (e) {
      anthropicMsgs = [{ role: 'user', content: 'Hello' }];
    }

    // System prompt — same format for both OAuth and API key
    // OAuth tokens work fine with plain string system prompts
    var system = systemText || '';

    return { system: system, messages: anthropicMsgs };
  }

  /**
   * Convert Anthropic response to OpenAI format
   * @param {object} resp - Anthropic API response
   * @param {string} model - Model name
   * @returns {object}
   */
  _convertFromAnthropic(resp, model) {
    try {
      var content = '';
      if (resp.content && Array.isArray(resp.content)) {
        for (var i = 0; i < resp.content.length; i++) {
          if (resp.content[i].type === 'text') content += resp.content[i].text;
        }
      }
      var usage = resp.usage || {};
      return {
        id: 'chatcmpl-' + (resp.id || crypto.randomBytes(12).toString('hex')),
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [{
          index: 0,
          message: { role: 'assistant', content: content },
          finish_reason: resp.stop_reason === 'end_turn' ? 'stop' : (resp.stop_reason || 'stop')
        }],
        usage: {
          prompt_tokens: usage.input_tokens || 0,
          completion_tokens: usage.output_tokens || 0,
          total_tokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
          cache_creation_input_tokens: usage.cache_creation_input_tokens || 0,
          cache_read_input_tokens: usage.cache_read_input_tokens || 0
        }
      };
    } catch (e) {
      return { id: 'chatcmpl-err', object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: model, choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'error' }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } };
    }
  }

  // ═══════════════════════════════════════════════════
  //  BUILD HEADERS FOR ANTHROPIC API
  // ═══════════════════════════════════════════════════

  /**
   * Build the correct headers for Anthropic API based on token type.
   * 
   * OAuth tokens (sk-ant-oat*):
   *   Authorization: Bearer <token>
   *   anthropic-beta: oauth-2025-04-20
   *   anthropic-dangerous-direct-browser-access: true
   *   user-agent: claude-cli/2.1.2 (external, cli)
   *   x-app: cli
   * 
   * API keys (sk-ant-api*):
   *   x-api-key: <key>
   * 
   * @param {string} token - The API key or OAuth token
   * @param {boolean} isOAuth - Whether token is OAuth
   * @returns {object} Headers object
   */
  _buildAnthropicHeaders(token, isOAuth) {
    var headers = {
      'content-type': 'application/json',
      'accept': 'application/json',
      'anthropic-version': '2023-06-01'
    };
    if (isOAuth) {
      headers['authorization'] = 'Bearer ' + token;
      headers['anthropic-beta'] = OAUTH_BETA_HEADER;
      headers['user-agent'] = 'aries/5.0';
    } else {
      headers['x-api-key'] = token;
    }
    return headers;
  }

  // ═══════════════════════════════════════════════════
  //  DIRECT ANTHROPIC CALLS (OAuth + API key)
  // ═══════════════════════════════════════════════════

  /**
   * Make non-streaming request to Anthropic Messages API
   * Works for both OAuth and API key tokens.
   * 
   * @param {object} body - OpenAI-format request body
   * @param {string} model - Resolved model name (without provider prefix)
   * @param {string} token - OAuth token or API key
   * @param {boolean} isOAuth - Token type
   * @returns {Promise<object>} OpenAI-format response
   */
  async _callAnthropicDirect(body, model, token, isOAuth) {
    var self = this;
    var converted = self._convertToAnthropic(body.messages || [], isOAuth);
    var anthropicBody = {
      model: model,
      messages: converted.messages,
      max_tokens: body.max_tokens || 4096
    };
    if (converted.system) anthropicBody.system = converted.system;
    if (body.temperature !== undefined) anthropicBody.temperature = body.temperature;
    if (body.top_p !== undefined) anthropicBody.top_p = body.top_p;

    var bodyStr = JSON.stringify(anthropicBody);
    var headers = self._buildAnthropicHeaders(token, isOAuth);
    var result = await self._httpsPost('https://api.anthropic.com/v1/messages', bodyStr, headers);
    if (result.statusCode >= 400) {
      var errMsg = 'Anthropic API error ' + result.statusCode;
      if (result.json && result.json.error) errMsg += ': ' + (result.json.error.message || JSON.stringify(result.json.error));
      throw new Error(errMsg);
    }
    return self._convertFromAnthropic(result.json, body.model || model);
  }

  /**
   * Stream from Anthropic Messages API, convert SSE to OpenAI SSE format.
   * Works for both OAuth and API key tokens.
   * 
   * Anthropic SSE events:
   *   message_start → initial usage
   *   content_block_start → new block
   *   content_block_delta → incremental text (text_delta) or thinking
   *   content_block_stop → block done
   *   message_delta → stop_reason + final usage
   *   message_stop → end
   * 
   * @param {object} body - OpenAI-format request body
   * @param {string} model - Resolved model name
   * @param {string} token - OAuth token or API key
   * @param {boolean} isOAuth - Token type
   * @param {http.ServerResponse} res - Client response to stream to
   * @returns {Promise<{inputTokens: number, outputTokens: number, cacheReadTokens: number, cacheWriteTokens: number}>}
   */
  /**
   * Retryable error codes that trigger model fallback
   */
  _isRetryableStatus(statusCode) {
    return statusCode === 429 || statusCode === 500 || statusCode === 502 || statusCode === 503 || statusCode === 529;
  }

  /**
   * Stream with fallback — tries primary model, falls back on retryable errors.
   * @returns {Promise<{inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, usedModel}>}
   */
  async _streamWithFallback(body, resolvedModel, token, isOAuth, res) {
    var self = this;
    var modelsToTry = [resolvedModel];
    for (var fi = 0; fi < self.fallbackChain.length; fi++) {
      var fc = self.fallbackChain[fi];
      if (fc !== resolvedModel) modelsToTry.push(fc);
    }

    for (var mi = 0; mi < modelsToTry.length; mi++) {
      var tryModel = modelsToTry[mi];
      var tryResolved = self.resolveModel(tryModel);
      try {
        var result = await self._streamAnthropicDirect(body, tryResolved.model, token, isOAuth, res, mi > 0);
        result.usedModel = tryModel;
        if (result.fallbackNeeded) {
          console.log('[AI-GATEWAY] Model ' + tryModel + ' returned ' + result.fallbackStatus + ', trying fallback...');
          continue;
        }
        if (mi > 0) {
          console.log('[AI-GATEWAY] Fallback succeeded with model: ' + tryModel);
        }
        return result;
      } catch (e) {
        if (mi < modelsToTry.length - 1) {
          console.log('[AI-GATEWAY] Stream error with ' + tryModel + ': ' + e.message + ', trying fallback...');
          continue;
        }
        throw e;
      }
    }
    throw new Error('All models failed for streaming');
  }

  async _streamAnthropicDirect(body, model, token, isOAuth, res, isFallbackAttempt) {
    var self = this;
    var converted = self._convertToAnthropic(body.messages || [], isOAuth);
    var anthropicBody = {
      model: model,
      messages: converted.messages,
      max_tokens: body.max_tokens || 4096,
      stream: true
    };
    if (converted.system) anthropicBody.system = converted.system;
    if (body.temperature !== undefined) anthropicBody.temperature = body.temperature;

    var bodyStr = JSON.stringify(anthropicBody);
    var headers = self._buildAnthropicHeaders(token, isOAuth);

    return new Promise(function(resolve, reject) {
      try {
        var options = {
          hostname: 'api.anthropic.com',
          port: 443,
          path: '/v1/messages',
          method: 'POST',
          headers: headers,
          timeout: 120000
        };

        var req = https.request(options, function(apiRes) {
          if (apiRes.statusCode >= 400) {
            var errData = '';
            apiRes.on('data', function(c) { errData += c; });
            apiRes.on('end', function() {
              // If retryable and not yet streaming to client, signal fallback
              if (self._isRetryableStatus(apiRes.statusCode) && isFallbackAttempt !== undefined) {
                resolve({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, fallbackNeeded: true, fallbackStatus: apiRes.statusCode });
                return;
              }
              var errMsg = errData;
              try { var errObj = JSON.parse(errData); errMsg = (errObj.error && errObj.error.message) || errData; } catch (e2) { /* use raw */ }
              res.write('data: ' + JSON.stringify({ id: 'chatcmpl-err', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'error' }], error: errMsg }) + '\n\n');
              res.write('data: [DONE]\n\n');
              res.end();
              resolve({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
            });
            return;
          }

          var buffer = '';
          var inputTokens = 0;
          var outputTokens = 0;
          var cacheReadTokens = 0;
          var cacheWriteTokens = 0;
          var completionId = 'chatcmpl-' + crypto.randomBytes(12).toString('hex');
          var currentEventType = '';

          apiRes.on('data', function(chunk) {
            try {
              buffer += chunk.toString();
              // SSE: split on double newline for events, but also handle event: / data: lines
              var lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (var li = 0; li < lines.length; li++) {
                var line = lines[li].trim();

                // Track event type from "event:" lines
                if (line.startsWith('event:')) {
                  currentEventType = line.slice(6).trim();
                  continue;
                }

                if (!line.startsWith('data:')) continue;
                var dataStr = line.slice(5).trim();
                if (!dataStr || dataStr === '[DONE]') continue;

                try {
                  var event = JSON.parse(dataStr);
                  var eventType = event.type || currentEventType || '';

                  if (eventType === 'content_block_delta') {
                    var delta = event.delta || {};
                    // text_delta → stream as content
                    if (delta.type === 'text_delta' && delta.text) {
                      var openaiChunk = {
                        id: completionId,
                        object: 'chat.completion.chunk',
                        created: Math.floor(Date.now() / 1000),
                        model: body.model || model,
                        choices: [{ index: 0, delta: { content: delta.text }, finish_reason: null }]
                      };
                      res.write('data: ' + JSON.stringify(openaiChunk) + '\n\n');
                    }
                    // thinking_delta → skip (internal reasoning)
                  } else if (eventType === 'message_start') {
                    if (event.message && event.message.usage) {
                      inputTokens = event.message.usage.input_tokens || 0;
                      cacheReadTokens = event.message.usage.cache_read_input_tokens || 0;
                      cacheWriteTokens = event.message.usage.cache_creation_input_tokens || 0;
                    }
                  } else if (eventType === 'message_delta') {
                    if (event.usage) {
                      outputTokens = event.usage.output_tokens || 0;
                    }
                    // Emit final chunk with stop reason
                    var finalChunk = {
                      id: completionId,
                      object: 'chat.completion.chunk',
                      created: Math.floor(Date.now() / 1000),
                      model: body.model || model,
                      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
                      usage: {
                        prompt_tokens: inputTokens,
                        completion_tokens: outputTokens,
                        total_tokens: inputTokens + outputTokens,
                        cache_read_input_tokens: cacheReadTokens,
                        cache_creation_input_tokens: cacheWriteTokens
                      }
                    };
                    res.write('data: ' + JSON.stringify(finalChunk) + '\n\n');
                  }
                  // message_stop, content_block_start, content_block_stop → no action needed
                } catch (parseErr) { /* skip malformed event data */ }
              }
            } catch (chunkErr) { /* ignore */ }
          });

          apiRes.on('end', function() {
            try {
              // Send model metadata event so dashboard can show which model responded
              res.write('data: ' + JSON.stringify({ _meta: true, _usedModel: model }) + '\n\n');
              res.write('data: [DONE]\n\n');
              res.end();
            } catch (e3) { /* ignore */ }
            resolve({ inputTokens: inputTokens, outputTokens: outputTokens, cacheReadTokens: cacheReadTokens, cacheWriteTokens: cacheWriteTokens });
          });

          apiRes.on('error', function(err) {
            try { res.write('data: ' + JSON.stringify({ error: err.message }) + '\n\n'); res.write('data: [DONE]\n\n'); res.end(); } catch (e4) { /* ignore */ }
            resolve({ inputTokens: inputTokens, outputTokens: outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0 });
          });
        });

        req.on('error', function(err) {
          try { res.write('data: ' + JSON.stringify({ error: err.message }) + '\n\n'); res.write('data: [DONE]\n\n'); res.end(); } catch (e5) { /* ignore */ }
          resolve({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
        });
        req.on('timeout', function() {
          req.destroy();
          try { res.write('data: ' + JSON.stringify({ error: 'Request timeout' }) + '\n\n'); res.write('data: [DONE]\n\n'); res.end(); } catch (e6) { /* ignore */ }
          resolve({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
        });

        req.write(bodyStr);
        req.end();
      } catch (e) {
        reject(e);
      }
    });
  }

  // ═══════════════════════════════════════════════════
  //  HTTP HELPERS
  // ═══════════════════════════════════════════════════

  /**
   * HTTPS POST
   * @param {string} reqUrl @param {string} bodyStr @param {object} headers
   * @returns {Promise<{statusCode: number, body: string, json: object}>}
   */
  _httpsPost(reqUrl, bodyStr, headers) {
    return new Promise(function(resolve, reject) {
      try {
        var parsed = new URL(reqUrl);
        var opts = {
          hostname: parsed.hostname, port: parsed.port || 443,
          path: parsed.pathname + parsed.search, method: 'POST',
          headers: headers || {}, timeout: 120000
        };
        var req = https.request(opts, function(res) {
          var data = '';
          res.on('data', function(c) { data += c; });
          res.on('end', function() {
            var json = null;
            try { json = JSON.parse(data); } catch (e) { /* not json */ }
            resolve({ statusCode: res.statusCode, body: data, json: json });
          });
        });
        req.on('timeout', function() { req.destroy(); reject(new Error('Request timeout')); });
        req.on('error', reject);
        req.write(bodyStr);
        req.end();
      } catch (e) { reject(e); }
    });
  }

  /**
   * HTTP/HTTPS POST (auto-detect protocol)
   * @param {string} reqUrl @param {string} bodyStr @param {object} headers
   * @returns {Promise<{statusCode: number, body: string, json: object}>}
   */
  _httpPost(reqUrl, bodyStr, headers) {
    return new Promise(function(resolve, reject) {
      try {
        var parsed = new URL(reqUrl);
        var isHttps = parsed.protocol === 'https:';
        var mod = isHttps ? https : http;
        var opts = {
          hostname: parsed.hostname, port: parsed.port || (isHttps ? 443 : 80),
          path: parsed.pathname + parsed.search, method: 'POST',
          headers: headers || {}, timeout: 120000
        };
        var req = mod.request(opts, function(res) {
          var data = '';
          res.on('data', function(c) { data += c; });
          res.on('end', function() {
            var json = null;
            try { json = JSON.parse(data); } catch (e) { /* not json */ }
            resolve({ statusCode: res.statusCode, body: data, json: json });
          });
        });
        req.on('timeout', function() { req.destroy(); reject(new Error('Request timeout')); });
        req.on('error', reject);
        req.write(bodyStr);
        req.end();
      } catch (e) { reject(e); }
    });
  }

  // ═══════════════════════════════════════════════════
  //  USAGE TRACKING
  // ═══════════════════════════════════════════════════

  /**
   * Track token usage and cost
   * @param {string} model @param {number} inputTokens @param {number} outputTokens
   * @param {number} cacheReadTokens @param {number} cacheWriteTokens
   * @param {number} latencyMs @param {string} routeMode
   */
  _trackUsage(model, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, latencyMs, routeMode) {
    try {
      var shortModel = model.replace('anthropic/', '');
      var pricing = MODEL_PRICING[shortModel] || MODEL_PRICING['claude-sonnet-4-20250514'] || { input: 3, output: 15, cacheRead: 0.375, cacheWrite: 3.75 };
      var cost = (inputTokens / 1000000) * pricing.input + (outputTokens / 1000000) * pricing.output;
      if (cacheReadTokens) cost += (cacheReadTokens / 1000000) * pricing.cacheRead;
      if (cacheWriteTokens) cost += (cacheWriteTokens / 1000000) * pricing.cacheWrite;

      this._usage.totalRequests = (this._usage.totalRequests || 0) + 1;
      this._usage.totalInputTokens = (this._usage.totalInputTokens || 0) + inputTokens;
      this._usage.totalOutputTokens = (this._usage.totalOutputTokens || 0) + outputTokens;
      this._usage.totalCost = (this._usage.totalCost || 0) + cost;

      if (!this._usage.byModel) this._usage.byModel = {};
      if (!this._usage.byModel[model]) this._usage.byModel[model] = { requests: 0, inputTokens: 0, outputTokens: 0, cost: 0 };
      this._usage.byModel[model].requests += 1;
      this._usage.byModel[model].inputTokens += inputTokens;
      this._usage.byModel[model].outputTokens += outputTokens;
      this._usage.byModel[model].cost += cost;

      var now = new Date();
      var hourKey = now.toISOString().slice(0, 13);
      var dayKey = now.toISOString().slice(0, 10);

      if (!this._usage.byHour) this._usage.byHour = {};
      if (!this._usage.byHour[hourKey]) this._usage.byHour[hourKey] = { requests: 0, tokens: 0, cost: 0 };
      this._usage.byHour[hourKey].requests += 1;
      this._usage.byHour[hourKey].tokens += inputTokens + outputTokens;
      this._usage.byHour[hourKey].cost += cost;

      if (!this._usage.byDay) this._usage.byDay = {};
      if (!this._usage.byDay[dayKey]) this._usage.byDay[dayKey] = { requests: 0, tokens: 0, cost: 0 };
      this._usage.byDay[dayKey].requests += 1;
      this._usage.byDay[dayKey].tokens += inputTokens + outputTokens;
      this._usage.byDay[dayKey].cost += cost;

      this._requestLog.push({
        model: model, inputTokens: inputTokens, outputTokens: outputTokens,
        cost: cost, latencyMs: latencyMs, timestamp: now.toISOString(),
        cached: false, route: routeMode || 'unknown'
      });
      if (this._requestLog.length > 200) this._requestLog.shift();

      this._saveUsage();
      this.emit('request', { model: model, inputTokens: inputTokens, outputTokens: outputTokens, cost: cost, latencyMs: latencyMs, route: routeMode });
    } catch (e) { /* ignore tracking errors */ }
  }

  // ═══════════════════════════════════════════════════
  //  MAIN REQUEST HANDLER
  // ═══════════════════════════════════════════════════

  /**
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   */
  async _handleRequest(req, res) {
    var self = this;
    var reqUrl = req.url || '';
    var method = req.method || 'GET';

    // CORS
    if (method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Api-Key, X-Aries-Key' });
      res.end();
      return;
    }

    // GET /health
    if (reqUrl === '/health' && method === 'GET') {
      var route = self._resolveRoute();
      var modeLabel = route.mode === ROUTE.OAUTH_DIRECT ? 'OAUTH → api.anthropic.com' : 'DIRECT → api.anthropic.com';
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({
        status: 'ok', gateway: 'aries', version: '5.0',
        routeMode: route.mode, routeLabel: modeLabel,
        independent: true,
        providers: { anthropic: { mode: route.mode, hasOAuthToken: self._isOAuth(route.token), hasDirectKey: self._isApiKey(route.token) } },
        activeConcurrent: self._activeConcurrent, queueLength: self._queue.length,
        cacheSize: self._cache.size, totalRequests: self._usage.totalRequests || 0
      }));
      return;
    }

    // GET /usage
    if (reqUrl === '/usage' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(self._usage));
      return;
    }

    // GET /requests
    if (reqUrl === '/requests' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ requests: self._requestLog }));
      return;
    }

    // POST /v1/chat/completions
    if (reqUrl === '/v1/chat/completions' && method === 'POST') {
      if (!self.authenticate(req)) {
        res.writeHead(401, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: { message: 'Unauthorized', type: 'auth_error' } }));
        return;
      }

      // Read body
      var bodyStr = '';
      try {
        bodyStr = await new Promise(function(resolve, reject) {
          var data = '';
          req.on('data', function(c) { data += c; if (data.length > 10e6) { req.destroy(); reject(new Error('Body too large')); } });
          req.on('end', function() { resolve(data); });
          req.on('error', reject);
        });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: { message: e.message } }));
        return;
      }

      var body;
      try { body = JSON.parse(bodyStr); } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: { message: 'Invalid JSON' } }));
        return;
      }

      var resolved = self.resolveModel(body.model || 'opus');
      var startMs = Date.now();
      var isStream = body.stream === true;
      var route = self._resolveRoute();
      var isOAuth = self._isOAuth(route.token);

      // Cache check (non-streaming)
      var cacheKey = '';
      if (!isStream) {
        cacheKey = self._cacheKey(body);
        var cached = self._getCache(cacheKey);
        if (cached) {
          self._usage.cacheHits = (self._usage.cacheHits || 0) + 1;
          self._requestLog.push({ model: body.model, inputTokens: 0, outputTokens: 0, cost: 0, latencyMs: Date.now() - startMs, timestamp: new Date().toISOString(), cached: true, route: route.mode });
          if (self._requestLog.length > 200) self._requestLog.shift();
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify(cached));
          return;
        }
        self._usage.cacheMisses = (self._usage.cacheMisses || 0) + 1;
      }

      // Concurrency
      try { await self._acquireSlot(); } catch (e) {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: { message: 'Gateway overloaded: ' + e.message, type: 'rate_limit_error' } }));
        return;
      }

      try {
        // ─── DIRECT TO ANTHROPIC (OAuth or API key) ───
        if (route.mode === ROUTE.OAUTH_DIRECT || route.mode === ROUTE.API_DIRECT) {
          if (isStream) {
            res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*' });
            var sr = await self._streamWithFallback(body, resolved.model, route.token, isOAuth, res);
            var actualModel = sr.usedModel || body.model || resolved.model;
            self._trackUsage(actualModel, sr.inputTokens || 0, sr.outputTokens || 0, sr.cacheReadTokens || 0, sr.cacheWriteTokens || 0, Date.now() - startMs, route.mode);
          } else {
            // Try with fallback chain
            var lastError = null;
            var modelsToTry = [resolved.model];
            for (var fi = 0; fi < self.fallbackChain.length; fi++) {
              if (self.fallbackChain[fi] !== resolved.model) modelsToTry.push(self.fallbackChain[fi]);
            }
            var result = null;
            var usedModelName = resolved.model;
            for (var mi = 0; mi < modelsToTry.length; mi++) {
              try {
                var tryResolved = self.resolveModel(modelsToTry[mi]);
                result = await self._callAnthropicDirect(body, tryResolved.model, route.token, isOAuth);
                usedModelName = modelsToTry[mi];
                if (mi > 0) console.log('[AI-GATEWAY] Fallback succeeded with model: ' + usedModelName);
                break;
              } catch (e) {
                var isRetryable = e.message && (e.message.includes('429') || e.message.includes('500') || e.message.includes('502') || e.message.includes('503') || e.message.includes('529') || e.message.includes('timeout'));
                if (isRetryable && mi < modelsToTry.length - 1) {
                  console.log('[AI-GATEWAY] Model ' + modelsToTry[mi] + ' failed (' + e.message.substring(0, 80) + '), trying fallback...');
                  lastError = e;
                  continue;
                }
                lastError = e;
                if (mi < modelsToTry.length - 1) continue;
              }
            }
            if (!result) throw lastError || new Error('All models failed');

            // Add metadata about which model was used
            result._usedModel = usedModelName;
            if (usedModelName !== resolved.model) {
              result._fallback = true;
              result._requestedModel = resolved.model;
            }

            var usage = result.usage || {};
            self._trackUsage(usedModelName, usage.prompt_tokens || 0, usage.completion_tokens || 0, usage.cache_read_input_tokens || 0, usage.cache_creation_input_tokens || 0, Date.now() - startMs, route.mode);
            self._setCache(cacheKey, result);
            res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify(result));
          }

        }
      } catch (e) {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: { message: e.message, type: 'gateway_error' } }));
        }
      } finally {
        self._releaseSlot();
      }
      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ error: { message: 'Not found. Use /v1/chat/completions, /health, /usage, /requests' } }));
  }

  // ═══════════════════════════════════════════════════
  //  SERVER LIFECYCLE
  // ═══════════════════════════════════════════════════

  /** @returns {boolean} */
  start() {
    if (!this.enabled) return false;
    var self = this;
    try {
      self._server = http.createServer(function(req, res) {
        self._handleRequest(req, res).catch(function(e) {
          try { if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: e.message } })); } } catch (e2) { /* ignore */ }
        });
      });

      self._server.on('error', function(err) {
        if (err.code === 'EADDRINUSE') {
          console.error('[AI-GATEWAY] Port ' + self.port + ' in use, trying ' + (self.port + 1));
          self.port++;
          self._server.listen(self.port, '0.0.0.0');
        } else {
          console.error('[AI-GATEWAY] Server error:', err.message);
        }
      });

      var route = self._resolveRoute();
      var modeDesc = route.mode === ROUTE.OAUTH_DIRECT ? 'OAUTH DIRECT → api.anthropic.com (INDEPENDENT)' :
                     'API DIRECT → api.anthropic.com (INDEPENDENT)';

      self._server.listen(self.port, '0.0.0.0', function() {
        console.log('[AI-GATEWAY] Aries AI Gateway on port ' + self.port + ' | ' + modeDesc);
        self.emit('started', { port: self.port, mode: route.mode });
      });
      return true;
    } catch (e) {
      console.error('[AI-GATEWAY] Failed to start:', e.message);
      return false;
    }
  }

  stop() {
    try { if (this._server) { this._server.close(); this._server = null; } this._saveUsage(); } catch (e) { /* ignore */ }
  }

  // ═══════════════════════════════════════════════════
  //  PUBLIC API
  // ═══════════════════════════════════════════════════

  /** @returns {object} */
  getStatus() {
    var route = this._resolveRoute();
    return {
      enabled: this.enabled, port: this.port, running: !!this._server,
      routeMode: route.mode,
      independent: true,
      routeTarget: 'api.anthropic.com',
      providers: { anthropic: { mode: route.mode, hasOAuthToken: this._isOAuth(route.token), hasDirectKey: this._isApiKey(route.token) } },
      activeConcurrent: this._activeConcurrent, queueLength: this._queue.length,
      cacheSize: this._cache.size,
      cacheHitRate: this._usage.totalRequests > 0 ? ((this._usage.cacheHits || 0) / ((this._usage.cacheHits || 0) + (this._usage.cacheMisses || 0) || 1) * 100).toFixed(1) + '%' : '0%'
    };
  }

  /** @returns {object} */
  getUsage() { return this._usage; }

  /** @returns {Array} */
  getRequestLog() { return this._requestLog; }

  /**
   * Update API key at runtime (auto-detects token type)
   * @param {string} provider @param {string} apiKey
   */
  setApiKey(provider, apiKey) {
    try {
      if (!this.providers[provider]) this.providers[provider] = {};
      this.providers[provider].apiKey = apiKey;
    } catch (e) { /* ignore */ }
  }

  /** @returns {boolean} */
  isReady() { return this.enabled; }
}

module.exports = { AIGateway };
