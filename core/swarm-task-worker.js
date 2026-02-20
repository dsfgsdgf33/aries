/**
 * ARIES — Swarm Task Worker
 * Polls relay for tasks, routes to local Ollama, returns results.
 */

const http = require('http');
const https = require('https');
const EventEmitter = require('events');

// DEFAULT_RELAY_URL: reads from config.json relay.url; fallback is a sensible default
const DEFAULT_RELAY_URL = (() => {
  try {
    const _cfg = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'config.json'), 'utf8'));
    return (_cfg.relay && _cfg.relay.url) || 'http://localhost:9700';
  } catch { return 'http://localhost:9700'; }
})();
const OLLAMA_API = 'http://localhost:11434';
const POLL_INTERVAL = 10000;
const MAX_RETRIES = 3;
const MAX_CONCURRENT = 2;

class SwarmTaskWorker extends EventEmitter {
  constructor(opts = {}) {
    super();
    this._workerId = opts.workerId || 'unknown';
    this._authKey = opts.authKey || '';
    this._model = opts.model || 'qwen2.5:1.5b';
    this._relayUrl = opts.relayUrl || DEFAULT_RELAY_URL;
    this._running = false;
    this._paused = false;
    this._pollTimer = null;
    this._activeTasks = 0;
    this._stats = {
      tasksCompleted: 0,
      tasksFailed: 0,
      tokensProcessed: 0,
      totalResponseTime: 0,
      startedAt: null
    };
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._paused = false;
    this._stats.startedAt = Date.now();
    this._poll();
    this._pollTimer = setInterval(() => this._poll(), POLL_INTERVAL);
    this.emit('started');
  }

  stop() {
    this._running = false;
    if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
    // Wait for active tasks to drain before emitting stopped
    if (this._activeTasks > 0) {
      const checkDrain = setInterval(() => {
        if (this._activeTasks <= 0) {
          clearInterval(checkDrain);
          this.emit('stopped');
        }
      }, 500);
      // Force emit after 30s regardless
      setTimeout(() => { clearInterval(checkDrain); this.emit('stopped'); }, 30000);
    } else {
      this.emit('stopped');
    }
  }

  pause() { this._paused = true; this.emit('paused'); }
  resume() { this._paused = false; this.emit('resumed'); }

  async _poll() {
    if (!this._running || this._paused || this._activeTasks >= MAX_CONCURRENT) return;

    try {
      const resp = await this._httpRequest(`${this._relayUrl}/api/claim`, 'POST', {
        workerId: this._workerId,
        capabilities: ['chat', 'embed', 'summarize'],
        model: this._model
      });

      if (resp.status === 200 && resp.data && resp.data.task) {
        this._processTask(resp.data.task);
      }
    } catch (e) {
      // Relay unreachable — silent fail, will retry next poll
    }
  }

  async _processTask(task) {
    this._activeTasks++;
    this.emit('task-start', { taskId: task.id, type: task.type });
    const startTime = Date.now();
    let attempts = 0;
    let success = false;
    let result = null;

    while (attempts < MAX_RETRIES && !success) {
      attempts++;
      try {
        result = await this._executeTask(task);
        success = true;
      } catch (e) {
        if (attempts >= MAX_RETRIES) {
          result = { error: e.message };
        } else {
          await new Promise(r => setTimeout(r, 1000 * attempts));
        }
      }
    }

    const elapsed = Date.now() - startTime;

    // Send result back to relay
    try {
      await this._httpRequest(`${this._relayUrl}/api/result`, 'POST', {
        workerId: this._workerId,
        taskId: task.id,
        success,
        result: result,
        elapsed
      });
    } catch {}

    // Update stats
    if (success) {
      this._stats.tasksCompleted++;
      this._stats.tokensProcessed += (result?.eval_count || result?.tokens || 0);
      this._stats.totalResponseTime += elapsed;
    } else {
      this._stats.tasksFailed++;
    }

    this._activeTasks--;
    this.emit('task-complete', {
      taskId: task.id, success, elapsed,
      stats: this.getStats()
    });
  }

  async _executeTask(task) {
    const type = task.type || 'chat';

    if (type === 'chat' || type === 'summarize') {
      const prompt = type === 'summarize'
        ? `Summarize the following:\n\n${task.prompt || task.content}`
        : (task.prompt || task.content || '');

      if (task.messages) {
        // Chat completion format
        return this._ollamaChat(task.messages);
      }
      return this._ollamaGenerate(prompt);
    }

    if (type === 'embed') {
      return this._ollamaEmbed(task.content || task.prompt || '');
    }

    throw new Error(`Unknown task type: ${type}`);
  }

  _ollamaGenerate(prompt) {
    return this._ollamaRequest('/api/generate', {
      model: this._model, prompt, stream: false
    });
  }

  _ollamaChat(messages) {
    return this._ollamaRequest('/api/chat', {
      model: this._model, messages, stream: false
    });
  }

  _ollamaEmbed(content) {
    return this._ollamaRequest('/api/embeddings', {
      model: this._model, prompt: content
    });
  }

  _ollamaRequest(endpoint, body) {
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify(body);
      const req = http.request({
        hostname: 'localhost', port: 11434, path: endpoint,
        method: 'POST', timeout: 120000,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          if (res.statusCode === 200) {
            try { resolve(JSON.parse(data)); } catch { resolve({ raw: data }); }
          } else {
            reject(new Error(`Ollama ${endpoint}: HTTP ${res.statusCode}`));
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Ollama timeout')); });
      req.write(postData);
      req.end();
    });
  }

  _httpRequest(urlStr, method, body) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(urlStr);
      const mod = parsed.protocol === 'https:' ? https : http;
      const postData = body ? JSON.stringify(body) : null;
      const opts = {
        method, hostname: parsed.hostname, port: parsed.port,
        path: parsed.pathname + parsed.search, timeout: 15000,
        headers: {
          'Content-Type': 'application/json',
          ...(this._authKey ? { 'X-Aries-Auth': this._authKey } : {}),
          'X-Worker-Id': this._workerId
        }
      };
      if (postData) opts.headers['Content-Length'] = Buffer.byteLength(postData);

      const req = mod.request(opts, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, data: { raw: data } }); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      if (postData) req.write(postData);
      req.end();
    });
  }

  getStats() {
    const uptime = this._stats.startedAt ? Math.floor((Date.now() - this._stats.startedAt) / 1000) : 0;
    const avgResponseTime = this._stats.tasksCompleted > 0
      ? Math.round(this._stats.totalResponseTime / this._stats.tasksCompleted)
      : 0;
    return {
      running: this._running,
      paused: this._paused,
      activeTasks: this._activeTasks,
      tasksCompleted: this._stats.tasksCompleted,
      tasksFailed: this._stats.tasksFailed,
      tokensProcessed: this._stats.tokensProcessed,
      avgResponseTime,
      uptime
    };
  }
}

module.exports = { SwarmTaskWorker };
