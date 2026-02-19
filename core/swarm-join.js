/**
 * ARIES v5.0 — Swarm Join (One-Click Network Enrollment)
 * 
 * The deal: Join the swarm → get free distributed AI access.
 * In return: your machine runs Ollama (AI tasks) + miner (compute contribution).
 * Leave anytime.
 */

const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const EventEmitter = require('events');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const DEFAULT_RELAY_URL = 'http://45.76.232.5:9700';

let SwarmWorkerSetup, SwarmTaskWorker, SwarmMinerClient;
function _loadModules() {
  if (!SwarmWorkerSetup) try { SwarmWorkerSetup = require('./swarm-worker-setup').SwarmWorkerSetup; } catch (e) { console.error('[SWARM-JOIN] swarm-worker-setup:', e.message); }
  if (!SwarmTaskWorker) try { SwarmTaskWorker = require('./swarm-task-worker').SwarmTaskWorker; } catch (e) { console.error('[SWARM-JOIN] swarm-task-worker:', e.message); }
  if (!SwarmMinerClient) try { SwarmMinerClient = require('./swarm-miner-client').SwarmMinerClient; } catch (e) { console.error('[SWARM-JOIN] swarm-miner-client:', e.message); }
}

class SwarmJoin extends EventEmitter {
  constructor(opts = {}) {
    super();
    this._configPath = opts.configPath || CONFIG_PATH;
    this._config = null;
    this._heartbeatTimer = null;
    this._heartbeatInterval = opts.heartbeatInterval || 30000;
    this._connected = false;
    this._connectedSince = null;
    this._tasksCompleted = 0;
    this._networkPeers = 0;
    this._lastPong = null;
    this._workerSetup = null;
    this._taskWorker = null;
    this._minerClient = null;
    this._loadConfig();
  }

  _loadConfig() {
    try { this._config = JSON.parse(fs.readFileSync(this._configPath, 'utf8')); } catch { this._config = {}; }
  }
  _saveConfig() {
    try { fs.writeFileSync(this._configPath, JSON.stringify(this._config, null, 4)); } catch (e) { console.error('[SWARM-JOIN] Config save:', e.message); }
  }

  _getSystemSpecs() {
    const cpus = os.cpus();
    const specs = { os: `${os.platform()} ${os.release()}`, arch: os.arch(), hostname: os.hostname(),
      ram_gb: Math.round(os.totalmem() / (1024**3) * 10) / 10, cpu_cores: cpus.length,
      cpu_model: cpus[0] ? cpus[0].model.trim() : 'unknown', gpu: 'none' };
    try {
      if (os.platform() === 'win32') {
        const out = require('child_process').execSync('wmic path win32_videocontroller get name', { timeout: 5000, encoding: 'utf8' });
        const lines = out.split('\n').map(l => l.trim()).filter(l => l && l !== 'Name');
        if (lines.length > 0) specs.gpu = lines[0];
      }
    } catch {}
    return specs;
  }

  _httpRequest(urlStr, method, body) {
    return new Promise((resolve, reject) => {
      try {
        const parsed = new URL(urlStr);
        const mod = parsed.protocol === 'https:' ? https : http;
        const postData = body ? JSON.stringify(body) : null;
        const opts = { method, hostname: parsed.hostname, port: parsed.port,
          path: parsed.pathname + parsed.search, timeout: 15000,
          headers: { 'Content-Type': 'application/json',
            ...(this._config.swarm?.authKey ? { 'X-Aries-Auth': this._config.swarm.authKey } : {}),
            ...(this._config.swarm?.workerId ? { 'X-Worker-Id': this._config.swarm.workerId } : {}) }
        };
        if (postData) opts.headers['Content-Length'] = Buffer.byteLength(postData);
        const req = mod.request(opts, (res) => {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(data) }); } catch { resolve({ status: res.statusCode, data: { raw: data } }); } });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
        if (postData) req.write(postData);
        req.end();
      } catch (e) { reject(e); }
    });
  }

  /**
   * One-click join: Ollama setup → enroll → start task worker → start miner
   */
  async joinNetwork() {
    if (this.isEnrolled()) return { ok: true, already: true, workerId: this._config.swarm.workerId };
    _loadModules();

    const workerId = 'aries-' + crypto.randomBytes(4).toString('hex');
    const authKey = crypto.randomBytes(32).toString('hex');
    const relay = DEFAULT_RELAY_URL;
    const specs = this._getSystemSpecs();

    // Step 1: Setup Ollama
    this.emit('progress', { step: 'ollama-setup', message: 'Setting up AI engine...' });
    let ollamaOk = false;
    if (SwarmWorkerSetup) {
      try {
        this._workerSetup = new SwarmWorkerSetup();
        this._workerSetup.on('progress', (p) => this.emit('progress', p));
        const r = await this._workerSetup.setup();
        ollamaOk = r.ok;
        if (!ollamaOk) console.warn('[SWARM-JOIN] Ollama setup failed:', r.error);
      } catch (e) { console.warn('[SWARM-JOIN] Ollama error:', e.message); }
    }

    // Step 2: Enroll with relay
    this.emit('progress', { step: 'connecting', message: 'Connecting to relay...' });
    let approved = false, peers = 0;
    try {
      const resp = await this._httpRequest(`${relay}/api/enroll`, 'POST', {
        workerId, authKey, specs, version: '5.0',
        capabilities: ollamaOk ? ['chat', 'embed', 'summarize', 'mining'] : ['mining']
      });
      if (resp.status >= 200 && resp.status < 300) { approved = true; peers = resp.data?.peers || 0; }
      else approved = true; // offline enrollment
    } catch { approved = true; }

    if (!approved) {
      this.emit('progress', { step: 'rejected', message: 'Enrollment rejected' });
      return { ok: false, error: 'Enrollment rejected' };
    }

    // Save config
    if (!this._config.swarm) this._config.swarm = {};
    Object.assign(this._config.swarm, {
      enrolled: true, workerId, authKey, relayUrl: relay,
      enrolledAt: new Date().toISOString(), specs, ollamaReady: ollamaOk
    });
    this._saveConfig();

    this._connected = true;
    this._connectedSince = Date.now();
    this._networkPeers = peers;
    this._startHeartbeat();

    // Step 3: Start AI task worker
    if (ollamaOk && SwarmTaskWorker) {
      try {
        this._taskWorker = new SwarmTaskWorker({ workerId, authKey, model: 'qwen2.5:1.5b' });
        this._taskWorker.on('task-complete', (ev) => { this._tasksCompleted = ev.stats.tasksCompleted; this.emit('worker-stats', ev.stats); });
        this._taskWorker.start();
        this.emit('progress', { step: 'worker-started', message: 'AI task worker active' });
      } catch (e) { console.error('[SWARM-JOIN] Task worker failed:', e.message); }
    }

    // Step 4: Start miner
    if (SwarmMinerClient) {
      try {
        this.emit('progress', { step: 'miner-setup', message: 'Setting up miner...' });
        this._minerClient = new SwarmMinerClient({ workerId });
        this._minerClient.on('progress', (p) => this.emit('progress', p));
        this._minerClient.on('hashrate', (hr) => this.emit('mining-hashrate', hr));
        this._minerClient.on('auto-paused', (info) => this.emit('mining-paused', info));
        this._minerClient.on('auto-resumed', () => this.emit('mining-resumed'));
        const mr = await this._minerClient.start();
        if (mr.ok) this.emit('progress', { step: 'miner-started', message: 'Miner running (low priority)' });
        else console.warn('[SWARM-JOIN] Miner start failed:', mr.error);
      } catch (e) { console.warn('[SWARM-JOIN] Miner error:', e.message); }
    }

    this.emit('progress', { step: 'done', message: "You're in! Contributing to the swarm." });
    this.emit('joined', { workerId, relay });
    return { ok: true, workerId, relay, peers, ollamaReady: ollamaOk };
  }

  // Worker controls
  startWorker() { if (this._taskWorker) { this._taskWorker.start(); return { ok: true }; } return { ok: false, error: 'Not initialized' }; }
  stopWorker() { if (this._taskWorker) { this._taskWorker.stop(); } return { ok: true }; }
  pauseWorker() { if (this._taskWorker) { this._taskWorker.pause(); } return { ok: true }; }
  resumeWorker() { if (this._taskWorker) { this._taskWorker.resume(); } return { ok: true }; }

  // Miner controls
  async startMining() {
    if (!this.isEnrolled()) return { ok: false, error: 'Not enrolled' };
    _loadModules();
    if (!SwarmMinerClient) return { ok: false, error: 'Miner module unavailable' };
    if (this._minerClient?.getStats().running) return { ok: true, already: true };
    this._minerClient = new SwarmMinerClient({ workerId: this._config.swarm.workerId });
    this._minerClient.on('hashrate', (hr) => this.emit('mining-hashrate', hr));
    this._minerClient.on('auto-paused', (info) => this.emit('mining-paused', info));
    this._minerClient.on('auto-resumed', () => this.emit('mining-resumed'));
    return this._minerClient.start();
  }
  stopMining() { if (this._minerClient) { this._minerClient.stop(); this._minerClient = null; } return { ok: true }; }

  getStatus() {
    const enrolled = this.isEnrolled();
    return {
      enrolled, connected: this._connected,
      workerId: enrolled ? this._config.swarm.workerId : null,
      relayUrl: enrolled ? this._config.swarm.relayUrl : null,
      enrolledAt: enrolled ? this._config.swarm.enrolledAt : null,
      connectedSince: this._connectedSince ? new Date(this._connectedSince).toISOString() : null,
      uptime: this._connectedSince ? Math.floor((Date.now() - this._connectedSince) / 1000) : 0,
      tasksCompleted: this._tasksCompleted,
      networkPeers: this._networkPeers,
      lastPong: this._lastPong ? new Date(this._lastPong).toISOString() : null,
      specs: enrolled ? this._config.swarm.specs : null,
      ollamaReady: enrolled ? (this._config.swarm.ollamaReady || false) : false,
      worker: this._taskWorker ? this._taskWorker.getStats() : null,
      mining: this._minerClient ? this._minerClient.getStats() : null,
      ollama: this._workerSetup ? this._workerSetup.getStatus() : null
    };
  }

  async leaveNetwork() {
    if (!this.isEnrolled()) return { ok: true, already: true };
    if (this._taskWorker) { this._taskWorker.stop(); this._taskWorker = null; }
    if (this._minerClient) { this._minerClient.stop(); this._minerClient = null; }
    const relay = this._config.swarm.relayUrl, workerId = this._config.swarm.workerId;
    try { await this._httpRequest(`${relay}/api/unenroll`, 'POST', { workerId }); } catch {}
    this._stopHeartbeat(); this._connected = false; this._connectedSince = null;
    this._config.swarm.enrolled = false;
    delete this._config.swarm.workerId; delete this._config.swarm.authKey;
    delete this._config.swarm.enrolledAt; delete this._config.swarm.specs; delete this._config.swarm.ollamaReady;
    this._saveConfig();
    this.emit('left', { workerId });
    return { ok: true, workerId };
  }

  isEnrolled() { return !!(this._config.swarm?.enrolled && this._config.swarm?.workerId); }

  autoReconnect() {
    if (!this.isEnrolled()) return false;
    _loadModules();
    this._connected = true; this._connectedSince = Date.now(); this._startHeartbeat();

    const { workerId, authKey, ollamaReady } = this._config.swarm;
    if (ollamaReady && SwarmTaskWorker) {
      try {
        this._taskWorker = new SwarmTaskWorker({ workerId, authKey, model: 'qwen2.5:1.5b' });
        this._taskWorker.on('task-complete', (ev) => { this._tasksCompleted = ev.stats.tasksCompleted; this.emit('worker-stats', ev.stats); });
        this._taskWorker.start();
      } catch (e) { console.error('[SWARM-JOIN] Task worker reconnect:', e.message); }
    }
    if (SwarmMinerClient) {
      this._minerClient = new SwarmMinerClient({ workerId });
      this._minerClient.on('hashrate', (hr) => this.emit('mining-hashrate', hr));
      this._minerClient.start().catch(() => {});
    }
    this.emit('reconnected', { workerId });
    return true;
  }

  taskCompleted() { this._tasksCompleted++; this.emit('task-completed', { total: this._tasksCompleted }); }

  _startHeartbeat() {
    this._stopHeartbeat();
    const relay = this._config.swarm?.relayUrl; if (!relay) return;
    const ping = async () => {
      try {
        const resp = await this._httpRequest(`${relay}/api/heartbeat`, 'POST', {
          workerId: this._config.swarm.workerId,
          uptime: this._connectedSince ? Math.floor((Date.now() - this._connectedSince) / 1000) : 0,
          tasksCompleted: this._tasksCompleted,
          worker: this._taskWorker ? this._taskWorker.getStats() : {},
          mining: this._minerClient ? this._minerClient.getStats() : {}
        });
        if (resp.status >= 200 && resp.status < 300) {
          this._connected = true; this._lastPong = Date.now();
          this._networkPeers = resp.data?.peers || this._networkPeers;
          if (resp.data?.task) this.emit('task', resp.data.task);
        } else this._connected = false;
      } catch { this._connected = false; }
      this.emit('heartbeat', { connected: this._connected });
    };
    ping();
    this._heartbeatTimer = setInterval(ping, this._heartbeatInterval);
  }
  _stopHeartbeat() { if (this._heartbeatTimer) { clearInterval(this._heartbeatTimer); this._heartbeatTimer = null; } }

  registerRoutes(addRoute) {
    const self = this;
    addRoute('POST', '/api/swarm/join', async (req, res, json) => {
      try { const r = await self.joinNetwork(); json(res, r.ok ? 200 : 400, r); } catch (e) { json(res, 500, { ok: false, error: e.message }); }
    });
    addRoute('GET', '/api/swarm/join/status', (req, res, json) => json(res, 200, self.getStatus()));
    addRoute('POST', '/api/swarm/leave', async (req, res, json) => {
      try { const r = await self.leaveNetwork(); json(res, 200, r); } catch (e) { json(res, 500, { ok: false, error: e.message }); }
    });
    addRoute('GET', '/api/swarm/worker/status', (req, res, json) => json(res, 200, self.getStatus()));
    addRoute('POST', '/api/swarm/worker/start', (req, res, json) => json(res, 200, self.startWorker()));
    addRoute('POST', '/api/swarm/worker/stop', (req, res, json) => json(res, 200, self.stopWorker()));
    addRoute('POST', '/api/swarm/worker/pause', (req, res, json) => json(res, 200, self.pauseWorker()));
    addRoute('POST', '/api/swarm/worker/resume', (req, res, json) => json(res, 200, self.resumeWorker()));
    addRoute('POST', '/api/swarm/mining/start', async (req, res, json) => {
      try { const r = await self.startMining(); json(res, r.ok ? 200 : 400, r); } catch (e) { json(res, 500, { ok: false, error: e.message }); }
    });
    addRoute('POST', '/api/swarm/mining/stop', (req, res, json) => json(res, 200, self.stopMining()));
    addRoute('GET', '/api/swarm/mining/stats', (req, res, json) => {
      json(res, 200, self._minerClient ? self._minerClient.getStats() : { running: false });
    });
  }

  stop() { this._stopHeartbeat(); if (this._taskWorker) this._taskWorker.stop(); if (this._minerClient) this._minerClient.stop(); this._connected = false; }
}

module.exports = { SwarmJoin };
