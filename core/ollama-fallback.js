/**
 * ARIES v7.0 — Intelligent Ollama Fallback System
 * 
 * Automatically detects API failures (rate limits, quota exceeded, invalid keys)
 * and seamlessly switches to local Ollama models. Resumes API when available.
 * Zero configuration required — works out of the box.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const EventEmitter = require('events');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'ollama-fallback-state.json');

/** Error codes that trigger fallback */
const FALLBACK_TRIGGERS = {
  429: 'Rate limit exceeded',
  402: 'Payment required / quota exceeded',
  401: 'Invalid or expired API key',
  403: 'Access denied',
  500: 'Server error',
  502: 'Bad gateway',
  503: 'Service unavailable',
  529: 'API overloaded',
};

/** Timeout errors */
const TIMEOUT_PATTERNS = [
  /timeout/i, /ETIMEDOUT/i, /ECONNREFUSED/i, /ECONNRESET/i,
  /socket hang up/i, /network error/i,
];

class OllamaFallback extends EventEmitter {
  constructor(config = {}) {
    super();
    this.ollamaUrl = config.url || 'http://localhost:11434';
    this.preferredModel = config.model || 'auto';
    this.enabled = config.enabled !== false;
    this.autoSwitch = config.autoSwitch !== false;
    this.retryAfterMs = config.retryAfterMs || 60000; // Check API again after 1 min
    this.maxRetryMs = config.maxRetryMs || 300000; // Max 5 min backoff

    // State
    this._active = false; // Currently in fallback mode
    this._activeSince = null;
    this._reason = null;
    this._apiCheckTimer = null;
    this._consecutiveFailures = 0;
    this._ollamaAvailable = null; // null = unknown
    this._detectedModel = null;
    this._stats = { fallbackActivations: 0, requestsServed: 0, apiResumes: 0 };

    this._loadState();
  }

  /** Is fallback currently active? */
  get isActive() { return this._active; }
  get currentModel() { return this._detectedModel || this.preferredModel; }
  get reason() { return this._reason; }

  /** Get status for UI */
  getStatus() {
    return {
      enabled: this.enabled,
      active: this._active,
      activeSince: this._activeSince,
      reason: this._reason,
      ollamaAvailable: this._ollamaAvailable,
      model: this._detectedModel,
      stats: { ...this._stats },
      ollamaUrl: this.ollamaUrl,
    };
  }

  /** Check if an error should trigger fallback */
  shouldFallback(error, statusCode) {
    if (!this.enabled) return false;

    // Check HTTP status codes
    if (statusCode && FALLBACK_TRIGGERS[statusCode]) {
      return { trigger: true, reason: FALLBACK_TRIGGERS[statusCode] + ` (HTTP ${statusCode})` };
    }

    // Check error message patterns
    if (error) {
      const msg = typeof error === 'string' ? error : (error.message || '');

      // Rate limit patterns
      if (/rate.?limit/i.test(msg) || /too many requests/i.test(msg)) {
        return { trigger: true, reason: 'Rate limit exceeded' };
      }
      // Quota patterns
      if (/quota/i.test(msg) || /billing/i.test(msg) || /credit/i.test(msg) || /insufficient/i.test(msg)) {
        return { trigger: true, reason: 'API quota exceeded' };
      }
      // Auth patterns
      if (/invalid.*key/i.test(msg) || /expired/i.test(msg) || /unauthorized/i.test(msg) || /authentication/i.test(msg)) {
        return { trigger: true, reason: 'Invalid or expired API key' };
      }
      // Timeout patterns
      for (const pattern of TIMEOUT_PATTERNS) {
        if (pattern.test(msg)) {
          return { trigger: true, reason: 'API connection failed' };
        }
      }
    }

    return { trigger: false };
  }

  /** Activate fallback mode */
  async activate(reason) {
    if (this._active) return;

    // First check if Ollama is available
    const available = await this.checkOllama();
    if (!available) {
      console.log('[OllamaFallback] Cannot activate — Ollama not available at', this.ollamaUrl);
      this.emit('ollama-unavailable', { reason });
      return false;
    }

    this._active = true;
    this._activeSince = Date.now();
    this._reason = reason;
    this._stats.fallbackActivations++;
    this._consecutiveFailures++;

    console.log(`[OllamaFallback] ACTIVATED — ${reason} → Using Ollama (${this._detectedModel})`);
    this.emit('activated', { reason, model: this._detectedModel, since: this._activeSince });

    // Schedule API availability check
    this._scheduleApiCheck();
    this._saveState();
    return true;
  }

  /** Deactivate fallback — API is back */
  deactivate() {
    if (!this._active) return;

    const duration = Date.now() - this._activeSince;
    this._active = false;
    this._activeSince = null;
    this._reason = null;
    this._consecutiveFailures = 0;
    this._stats.apiResumes++;

    if (this._apiCheckTimer) {
      clearTimeout(this._apiCheckTimer);
      this._apiCheckTimer = null;
    }

    console.log(`[OllamaFallback] DEACTIVATED — API resumed (was in fallback for ${Math.round(duration / 1000)}s)`);
    this.emit('deactivated', { duration });
    this._saveState();
  }

  /** Check if Ollama is running and detect best model */
  async checkOllama() {
    try {
      const data = await this._httpGet(this.ollamaUrl + '/api/tags');
      const parsed = JSON.parse(data);
      const models = (parsed.models || []).map(m => m.name || m.model);

      if (models.length === 0) {
        this._ollamaAvailable = false;
        return false;
      }

      this._ollamaAvailable = true;

      // Auto-select best model
      if (this.preferredModel === 'auto' || !models.includes(this.preferredModel)) {
        this._detectedModel = this._selectBestModel(models);
      } else {
        this._detectedModel = this.preferredModel;
      }

      return true;
    } catch (e) {
      this._ollamaAvailable = false;
      return false;
    }
  }

  /** Select best available model based on priority */
  _selectBestModel(models) {
    const priority = [
      'deepseek-r1:14b', 'deepseek-r1:7b', 'deepseek-r1',
      'qwen2.5:14b', 'qwen2.5:7b', 'qwen2.5',
      'llama3.1:8b', 'llama3.1', 'llama3:8b', 'llama3',
      'mistral', 'phi3:mini', 'phi3', 'gemma2', 'gemma',
      'codellama', 'tinyllama',
    ];

    for (const preferred of priority) {
      const match = models.find(m => m.startsWith(preferred));
      if (match) return match;
    }
    return models[0]; // fallback to first available
  }

  /** Chat via Ollama */
  async chat(messages, options = {}) {
    if (!this._ollamaAvailable) {
      const ok = await this.checkOllama();
      if (!ok) throw new Error('Ollama is not available at ' + this.ollamaUrl);
    }

    const model = options.model || this._detectedModel || 'llama3';
    const body = JSON.stringify({
      model,
      messages,
      stream: options.stream || false,
      options: { temperature: options.temperature || 0.7 }
    });

    this._stats.requestsServed++;

    if (options.stream) {
      return this._streamChat(body);
    }

    const resp = await this._httpPost(this.ollamaUrl + '/api/chat', body);
    const data = JSON.parse(resp);
    return {
      choices: [{ message: { content: data.message?.content || '' } }],
      model,
      _fallback: true,
      _ollamaModel: model,
    };
  }

  /** Stream chat via Ollama */
  async _streamChat(body) {
    return new Promise((resolve, reject) => {
      const url = new (require('url').URL)(this.ollamaUrl + '/api/chat');
      const req = http.request({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, (res) => {
        if (res.statusCode >= 400) {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => reject(new Error('Ollama error: ' + data)));
          return;
        }
        resolve({ body: res, ok: true, _fallback: true });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  /** Schedule periodic API availability check */
  _scheduleApiCheck() {
    if (this._apiCheckTimer) clearTimeout(this._apiCheckTimer);

    const backoff = Math.min(
      this.retryAfterMs * Math.pow(1.5, this._consecutiveFailures - 1),
      this.maxRetryMs
    );

    this._apiCheckTimer = setTimeout(() => {
      this.emit('api-check', { backoff });
    }, backoff);
  }

  /** HTTP GET helper */
  _httpGet(url) {
    return new Promise((resolve, reject) => {
      http.get(url, { timeout: 5000 }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve(data));
      }).on('error', reject);
    });
  }

  /** HTTP POST helper */
  _httpPost(url, body) {
    return new Promise((resolve, reject) => {
      const parsed = new (require('url').URL)(url);
      const req = http.request({
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 120000
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          if (res.statusCode >= 400) reject(new Error('Ollama HTTP ' + res.statusCode + ': ' + data.substring(0, 200)));
          else resolve(data);
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Ollama timeout')); });
      req.write(body);
      req.end();
    });
  }

  _loadState() {
    try {
      if (fs.existsSync(STATE_FILE)) {
        const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        this._stats = state.stats || this._stats;
      }
    } catch {}
  }

  _saveState() {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(STATE_FILE, JSON.stringify({
        stats: this._stats,
        lastActive: this._active,
        lastModel: this._detectedModel,
      }, null, 2));
    } catch {}
  }
}

module.exports = OllamaFallback;
