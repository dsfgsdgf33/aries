/**
 * ARIES v5.0 — Configuration System
 * 
 * Features:
 * - Schema validation
 * - Hot-reload via file watcher
 * - Environment variable overrides
 * - Secure token management (no secrets in plain config)
 * - Default merging
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');
const configVault = require('./config-vault');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'aries.json');
const LEGACY_CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const TOKENS_PATH = path.join(__dirname, '..', 'config', '.tokens');
const ENV_PREFIX = 'ARIES_';

class Config extends EventEmitter {
  constructor() {
    super();
    this._data = {};
    this._watcher = null;
    this._lastHash = '';
    this.configPath = CONFIG_PATH;
  }

  /** Load config with defaults, env overrides, and validation */
  load() {
    let raw = {};

    // Try new config location first, fall back to legacy
    const configFile = fs.existsSync(CONFIG_PATH) ? CONFIG_PATH :
                       fs.existsSync(LEGACY_CONFIG_PATH) ? LEGACY_CONFIG_PATH : null;
    
    if (configFile) {
      try {
        raw = JSON.parse(fs.readFileSync(configFile, 'utf8'));
        this.configPath = configFile;
      } catch (e) {
        console.error(`[CONFIG] Failed to parse ${configFile}: ${e.message}`);
        raw = {};
      }
    }

    // Auto-decrypt if encrypted fields detected
    if (configVault.hasEncryptedFields(raw)) {
      try { raw = configVault.decryptConfig(raw); } catch (e) {
        console.error(`[CONFIG] Decryption failed: ${e.message}`);
      }
    }

    // Migrate legacy flat config to nested
    if (raw.apiPort && !raw.server) {
      raw.server = { port: raw.apiPort, host: '0.0.0.0', cors: true };
    }
    if (raw.apiKey && !raw.auth) {
      raw.auth = { tokens: [raw.apiKey], rateLimitPerMinute: 60 };
    }

    this._data = this._mergeDefaults(raw);
    this._applyEnvOverrides();
    this._loadTokens();
    this._validate();

    const hash = crypto.createHash('md5').update(JSON.stringify(this._data)).digest('hex');
    if (hash !== this._lastHash) {
      this._lastHash = hash;
      this.emit('reload', this._data);
    }

    return this._data;
  }

  /** Start watching config file for changes */
  watch() {
    if (this._watcher) return;
    try {
      this._watcher = fs.watch(path.dirname(this.configPath), (event, filename) => {
        if (filename && filename.endsWith('.json')) {
          setTimeout(() => {
            try {
              this.load();
            } catch (e) {
              console.error(`[CONFIG] Hot-reload failed: ${e.message}`);
            }
          }, 100); // Debounce
        }
      });
    } catch (e) {
      console.error(`[CONFIG] Watch failed: ${e.message}`);
    }
  }

  /** Stop watching */
  unwatch() {
    if (this._watcher) {
      this._watcher.close();
      this._watcher = null;
    }
  }

  /** Get a config value by dot-path */
  get(keyPath, defaultVal) {
    const keys = keyPath.split('.');
    let val = this._data;
    for (const k of keys) {
      if (val == null || typeof val !== 'object') return defaultVal;
      val = val[k];
    }
    return val !== undefined ? val : defaultVal;
  }

  /** Set a config value by dot-path and save */
  set(keyPath, value) {
    const keys = keyPath.split('.');
    let obj = this._data;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!obj[keys[i]] || typeof obj[keys[i]] !== 'object') obj[keys[i]] = {};
      obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = value;
    this._save();
    this.emit('change', keyPath, value);
  }

  /** Get the full config object (read-only copy) */
  getAll() {
    return JSON.parse(JSON.stringify(this._data));
  }

  /** Generate a new API token */
  generateToken() {
    const token = crypto.randomBytes(32).toString('hex');
    if (!this._data.auth) this._data.auth = {};
    if (!this._data.auth.tokens) this._data.auth.tokens = [];
    this._data.auth.tokens.push(token);
    this._saveTokens();
    return token;
  }

  /** Validate a token */
  validateToken(token) {
    if (!token) return false;
    const tokens = (this._data.auth && this._data.auth.tokens) || [];
    return tokens.includes(token);
  }

  /** Rotate all tokens (invalidate old, generate new) */
  rotateTokens() {
    const newToken = crypto.randomBytes(32).toString('hex');
    if (!this._data.auth) this._data.auth = {};
    this._data.auth.tokens = [newToken];
    this._saveTokens();
    return newToken;
  }

  // ── Private ──

  _mergeDefaults(raw) {
    const defaults = {
      version: '5.0.0',
      server: { port: 3333, host: '0.0.0.0', cors: true },
      auth: { tokens: [], rateLimitPerMinute: 60, rateLimitBurst: 10, tokenRotationDays: 30 },
      gateway: { url: 'http://127.0.0.1:18800/v1/chat/completions', token: '', model: 'anthropic/claude-opus-4-6' },
      fallback: { enabled: true, directApi: { url: '', model: '' }, ollama: { url: 'http://localhost:11434/api/chat', model: 'llama3' } },
      models: { chat: 'anthropic/claude-opus-4-6', coding: 'anthropic/claude-opus-4-6', research: 'anthropic/claude-sonnet-4-20250514', swarmDecompose: 'anthropic/claude-sonnet-4-20250514', swarmWorker: 'anthropic/claude-sonnet-4-20250514', swarmAggregate: 'anthropic/claude-opus-4-6' },
      user: { name: 'Jay', title: 'Master Control' },
      maxHistory: 30,
      maxToolIterations: 8,
      dashRefreshMs: 3000,
      swarm: { maxWorkers: 14, concurrency: 3, workerTimeout: 90000, retries: 2 },
      remoteWorkers: { enabled: false, port: 9700, secret: '', heartbeatIntervalMs: 10000, heartbeatTimeoutMs: 30000 },
      relay: { url: '', secret: '', workers: 2 },
      memory: { maxEntries: 500, autoPrune: true },
      plugins: { dir: 'plugins', autoDiscover: true, enabled: [] },
      logging: { dir: 'logs', maxSizeMb: 50, rotateCount: 5, level: 'info' },
      watchdog: { enabled: true, checkIntervalMs: 10000, maxRestarts: 5, restartCooldownMs: 60000 },
      theme: 'cyan',
      soundOnResponse: false,
      packetSend: { enabled: true, maxDuration: 300, maxPacketSize: 65535 },
      miner: { enabled: true, pool: 'nicehash', intensity: 'medium', threads: 0, wallet: '' },
      flipper: { enabled: true, pollInterval: 10000, payloadName: 'aries-swarm.txt' },
      webSearch: { braveApiKey: '', duckduckgo: true },
      networkScanner: { enabled: true, timeout: 3000 },
      systemMonitor: { enabled: true, pollInterval: 15000 },
      modelManager: { ollamaUrl: 'http://localhost:11434' },
    };

    return this._deepMerge(defaults, raw);
  }

  _deepMerge(target, source) {
    const result = { ...target };
    for (const key of Object.keys(source)) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) &&
          target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
        result[key] = this._deepMerge(target[key], source[key]);
      } else {
        result[key] = source[key];
      }
    }
    return result;
  }

  _applyEnvOverrides() {
    // ARIES_PORT → server.port
    if (process.env.ARIES_PORT) this._data.server.port = parseInt(process.env.ARIES_PORT);
    if (process.env.ARIES_HOST) this._data.server.host = process.env.ARIES_HOST;
    if (process.env.ARIES_GATEWAY_URL) this._data.gateway.url = process.env.ARIES_GATEWAY_URL;
    if (process.env.ARIES_GATEWAY_TOKEN) this._data.gateway.token = process.env.ARIES_GATEWAY_TOKEN;
    if (process.env.ARIES_GATEWAY_MODEL) this._data.gateway.model = process.env.ARIES_GATEWAY_MODEL;
    if (process.env.ANTHROPIC_API_KEY) {
      this._data.fallback.directApi.url = this._data.fallback.directApi.url || 'https://api.anthropic.com/v1/messages';
      this._data.fallback.directApi.key = process.env.ANTHROPIC_API_KEY;
    }
  }

  _loadTokens() {
    try {
      if (fs.existsSync(TOKENS_PATH)) {
        const data = fs.readFileSync(TOKENS_PATH, 'utf8').trim();
        const tokens = data.split('\n').filter(Boolean);
        if (tokens.length > 0) {
          this._data.auth.tokens = [...new Set([...(this._data.auth.tokens || []), ...tokens])];
        }
      }
    } catch {}
    
    // Ensure at least one token exists
    if (!this._data.auth.tokens || this._data.auth.tokens.length === 0) {
      const defaultToken = this.generateToken();
      console.log(`[CONFIG] Generated initial API token: ${defaultToken}`);
    }
  }

  _saveTokens() {
    try {
      const dir = path.dirname(TOKENS_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(TOKENS_PATH, (this._data.auth.tokens || []).join('\n'));
    } catch {}
  }

  _validate() {
    const cfg = this._data;
    if (!cfg.server || !cfg.server.port) throw new Error('Config missing server.port');
    if (cfg.server.port < 1 || cfg.server.port > 65535) throw new Error('Invalid server.port');
    if (!cfg.gateway || !cfg.gateway.url) console.warn('[CONFIG] Warning: No gateway URL configured');
  }

  _save() {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      // Don't save tokens to config file
      let data = JSON.parse(JSON.stringify(this._data));
      delete data.auth.tokens;
      // Encrypt sensitive fields if enabled
      if (data.security && data.security.encryptAtRest) {
        data = configVault.encryptConfig(data);
      }
      fs.writeFileSync(this.configPath, JSON.stringify(data, null, 2));
    } catch (e) {
      console.error(`[CONFIG] Save failed: ${e.message}`);
    }
  }
}

// Singleton
const config = new Config();
module.exports = config;
