/**
 * ARIES v5.0 — Web Monitoring & Alerting (Sentinel)
 * 
 * Monitor URLs for changes with configurable conditions.
 * Triggers agent actions when conditions are met.
 */

const EventEmitter = require('events');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const url = require('url');

const DATA_FILE = path.join(__dirname, '..', 'data', 'web-watches.json');

class WebSentinel extends EventEmitter {
  /**
   * @param {object} opts
   * @param {object} opts.ai - AI core (optional, for analysis actions)
   * @param {object} opts.config - sentinel config section
   */
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null;
    this.config = opts.config || {};
    this.minIntervalMs = this.config.minIntervalMs || 30000;
    this.maxWatches = this.config.maxWatches || 50;
    /** @type {Map<string, object>} */
    this.watches = new Map();
    /** @type {Map<string, NodeJS.Timer>} */
    this._timers = new Map();
    this._running = false;
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        for (const w of (Array.isArray(data) ? data : [])) {
          this.watches.set(w.id, w);
        }
      }
    } catch {}
  }

  _save() {
    try {
      const dir = path.dirname(DATA_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify([...this.watches.values()], null, 2));
    } catch {}
  }

  /**
   * Add a new watch
   * @param {object} config
   * @param {string} config.url - URL to monitor
   * @param {number} [config.intervalMs=60000] - Check interval
   * @param {string} config.condition - content_changed | keyword_appeared | keyword_disappeared | regex_match | status_changed
   * @param {string} [config.value] - Keyword or regex pattern for condition
   * @param {string} [config.action=alert] - alert | analyze
   * @param {string} [config.name] - Friendly name
   * @returns {object} Created watch
   */
  addWatch(config) {
    if (this.watches.size >= this.maxWatches) throw new Error(`Max watches (${this.maxWatches}) reached`);
    if (!config.url) throw new Error('URL is required');

    const id = crypto.randomBytes(6).toString('hex');
    const intervalMs = Math.max(config.intervalMs || 60000, this.minIntervalMs);

    const watch = {
      id,
      name: config.name || config.url.substring(0, 60),
      url: config.url,
      intervalMs,
      condition: config.condition || 'content_changed',
      value: config.value || null,
      action: config.action || 'alert',
      enabled: true,
      createdAt: Date.now(),
      lastCheck: null,
      lastStatus: null,
      lastHash: null,
      lastResult: null,
      triggerCount: 0,
      consecutiveErrors: 0,
    };

    this.watches.set(id, watch);
    this._save();

    // Start timer if running
    if (this._running) this._startTimer(id);

    this.emit('watch-added', watch);
    return watch;
  }

  /**
   * Remove a watch
   * @param {string} id
   */
  removeWatch(id) {
    if (!this.watches.has(id)) throw new Error(`Watch ${id} not found`);
    this._stopTimer(id);
    this.watches.delete(id);
    this._save();
    this.emit('watch-removed', id);
    return { removed: id };
  }

  /**
   * List all watches
   */
  listWatches() {
    return [...this.watches.values()].map(w => ({
      id: w.id,
      name: w.name,
      url: w.url,
      condition: w.condition,
      value: w.value,
      intervalMs: w.intervalMs,
      enabled: w.enabled,
      lastCheck: w.lastCheck,
      lastStatus: w.lastStatus,
      lastResult: w.lastResult,
      triggerCount: w.triggerCount,
      consecutiveErrors: w.consecutiveErrors,
    }));
  }

  /**
   * Start all watch timers
   */
  start() {
    this._running = true;
    for (const [id, watch] of this.watches) {
      if (watch.enabled) this._startTimer(id);
    }
    this.emit('started');
  }

  /**
   * Stop all watch timers
   */
  stop() {
    this._running = false;
    for (const id of this._timers.keys()) {
      this._stopTimer(id);
    }
    this.emit('stopped');
  }

  /**
   * Check a specific watch immediately
   * @param {string} id
   * @returns {object} Check result
   */
  async checkNow(id) {
    const watch = this.watches.get(id);
    if (!watch) throw new Error(`Watch ${id} not found`);
    return await this._checkWatch(watch);
  }

  // ── Internal ──

  _startTimer(id) {
    this._stopTimer(id);
    const watch = this.watches.get(id);
    if (!watch || !watch.enabled) return;

    const timer = setInterval(() => {
      this._checkWatch(watch).catch(e => {
        this.emit('error', { watchId: id, error: e.message });
      });
    }, watch.intervalMs);

    this._timers.set(id, timer);

    // Initial check after a short delay
    setTimeout(() => {
      this._checkWatch(watch).catch(() => {});
    }, 2000);
  }

  _stopTimer(id) {
    const timer = this._timers.get(id);
    if (timer) { clearInterval(timer); this._timers.delete(id); }
  }

  async _checkWatch(watch) {
    try {
      const { body, statusCode } = await this._fetch(watch.url);
      const hash = crypto.createHash('sha256').update(body).digest('hex');
      const prevHash = watch.lastHash;
      const prevStatus = watch.lastStatus;

      watch.lastCheck = Date.now();
      watch.lastStatus = statusCode;
      watch.consecutiveErrors = 0;

      let triggered = false;
      let reason = '';

      switch (watch.condition) {
        case 'content_changed':
          if (prevHash && hash !== prevHash) {
            triggered = true;
            reason = 'Content changed';
          }
          break;

        case 'keyword_appeared':
          if (watch.value && body.includes(watch.value)) {
            triggered = true;
            reason = `Keyword "${watch.value}" found`;
          }
          break;

        case 'keyword_disappeared':
          if (watch.value && prevHash && !body.includes(watch.value)) {
            triggered = true;
            reason = `Keyword "${watch.value}" no longer found`;
          }
          break;

        case 'regex_match':
          if (watch.value) {
            try {
              const re = new RegExp(watch.value);
              const match = body.match(re);
              if (match) {
                triggered = true;
                reason = `Regex matched: "${match[0].substring(0, 100)}"`;
              }
            } catch {}
          }
          break;

        case 'status_changed':
          if (prevStatus !== null && statusCode !== prevStatus) {
            triggered = true;
            reason = `Status changed: ${prevStatus} → ${statusCode}`;
          }
          break;
      }

      watch.lastHash = hash;

      if (triggered) {
        watch.triggerCount++;
        watch.lastResult = reason;
        this._save();
        this.emit('triggered', { watchId: watch.id, name: watch.name, url: watch.url, reason, action: watch.action });

        // Execute action
        await this._executeAction(watch, reason, body);
      } else {
        watch.lastResult = 'No change';
        this._save();
      }

      return { checked: true, triggered, reason, statusCode };
    } catch (e) {
      watch.lastCheck = Date.now();
      watch.consecutiveErrors++;
      watch.lastResult = `Error: ${e.message}`;
      this._save();
      this.emit('check-error', { watchId: watch.id, error: e.message });
      return { checked: false, error: e.message };
    }
  }

  _fetch(targetUrl) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(targetUrl);
      const mod = parsed.protocol === 'https:' ? https : http;
      const req = mod.request(parsed, {
        headers: { 'User-Agent': 'ARIES-Sentinel/4.0' },
        timeout: 15000,
      }, (res) => {
        // Follow redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          this._fetch(res.headers.location).then(resolve).catch(reject);
          return;
        }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ body: Buffer.concat(chunks).toString(), statusCode: res.statusCode }));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      req.end();
    });
  }

  async _executeAction(watch, reason, body) {
    switch (watch.action) {
      case 'alert':
        this.emit('alert', { watchId: watch.id, name: watch.name, url: watch.url, reason });
        break;

      case 'analyze':
        if (this.ai) {
          try {
            const messages = [
              { role: 'system', content: 'Analyze the following web content change and provide a brief summary of what changed and its significance.' },
              { role: 'user', content: `URL: ${watch.url}\nTrigger: ${reason}\n\nContent (first 2000 chars):\n${body.substring(0, 2000)}` }
            ];
            const data = await this.ai.callWithFallback(messages, null);
            const analysis = data.choices?.[0]?.message?.content || 'Analysis unavailable';
            this.emit('analysis', { watchId: watch.id, name: watch.name, analysis });
          } catch {}
        }
        break;
    }
  }
}

module.exports = { WebSentinel };
