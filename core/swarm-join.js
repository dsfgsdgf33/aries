/**
 * ARIES v5.0 — Swarm Join (One-Click Network Enrollment)
 * 
 * Makes joining the Aries swarm brain-dead simple.
 * One click. No config editing. No terminal commands.
 */

const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const EventEmitter = require('events');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const DEFAULT_RELAY_URL = 'http://relay.aries-network.io:9800';

class SwarmJoin extends EventEmitter {
  constructor(opts = {}) {
    super();
    this._configPath = opts.configPath || CONFIG_PATH;
    this._config = null;
    this._heartbeatTimer = null;
    this._heartbeatInterval = opts.heartbeatInterval || 30000; // 30s
    this._connected = false;
    this._connectedSince = null;
    this._tasksCompleted = 0;
    this._networkPeers = 0;
    this._lastPong = null;
    this._reconnectTimer = null;
    this._loadConfig();
  }

  _loadConfig() {
    try {
      this._config = JSON.parse(fs.readFileSync(this._configPath, 'utf8'));
    } catch {
      this._config = {};
    }
  }

  _saveConfig() {
    try {
      fs.writeFileSync(this._configPath, JSON.stringify(this._config, null, 4));
    } catch (e) {
      console.error('[SWARM-JOIN] Config save error:', e.message);
    }
  }

  _getSystemSpecs() {
    const cpus = os.cpus();
    const specs = {
      os: `${os.platform()} ${os.release()}`,
      arch: os.arch(),
      hostname: os.hostname(),
      ram_gb: Math.round(os.totalmem() / (1024 * 1024 * 1024) * 10) / 10,
      cpu_cores: cpus.length,
      cpu_model: cpus[0] ? cpus[0].model.trim() : 'unknown',
      gpu: 'none'
    };
    // Try to detect GPU (Windows)
    try {
      if (os.platform() === 'win32') {
        const { execSync } = require('child_process');
        const out = execSync('wmic path win32_videocontroller get name', { timeout: 5000, encoding: 'utf8' });
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
        const opts = {
          method,
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.pathname + parsed.search,
          timeout: 15000,
          headers: {
            'Content-Type': 'application/json',
            ...(this._config.swarm?.authKey ? { 'X-Aries-Auth': this._config.swarm.authKey } : {}),
            ...(this._config.swarm?.workerId ? { 'X-Worker-Id': this._config.swarm.workerId } : {}),
          }
        };
        if (postData) opts.headers['Content-Length'] = Buffer.byteLength(postData);

        const req = mod.request(opts, (res) => {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode, data: JSON.parse(data) });
            } catch {
              resolve({ status: res.statusCode, data: { raw: data } });
            }
          });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
        if (postData) req.write(postData);
        req.end();
      } catch (e) { reject(e); }
    });
  }

  /**
   * One-click join. The whole enchilada.
   */
  async joinNetwork(relayUrl) {
    if (this.isEnrolled()) {
      return { ok: true, already: true, workerId: this._config.swarm.workerId };
    }

    const workerId = 'aries-' + crypto.randomBytes(4).toString('hex');
    const authKey = crypto.randomBytes(32).toString('hex');
    const relay = relayUrl || this._config.swarm?.relayUrl || DEFAULT_RELAY_URL;
    const specs = this._getSystemSpecs();

    this.emit('progress', { step: 'connecting', message: 'Connecting to relay...' });

    // Try to send enrollment request to relay
    let approved = false;
    let peers = 0;
    try {
      const resp = await this._httpRequest(`${relay}/api/enroll`, 'POST', {
        workerId,
        authKey,
        specs,
        version: '5.0'
      });
      if (resp.status >= 200 && resp.status < 300) {
        approved = true;
        peers = resp.data?.peers || 0;
      } else if (resp.status === 0 || resp.data?.error) {
        // Relay unreachable — auto-accept (offline enrollment)
        approved = true;
      }
    } catch {
      // Relay unreachable — auto-accept for now, will sync when relay comes online
      approved = true;
    }

    if (!approved) {
      this.emit('progress', { step: 'rejected', message: 'Enrollment rejected by relay' });
      return { ok: false, error: 'Enrollment rejected' };
    }

    this.emit('progress', { step: 'enrolling', message: 'Enrolling...' });

    // Save to config
    if (!this._config.swarm) this._config.swarm = {};
    this._config.swarm.enrolled = true;
    this._config.swarm.workerId = workerId;
    this._config.swarm.authKey = authKey;
    this._config.swarm.relayUrl = relay;
    this._config.swarm.enrolledAt = new Date().toISOString();
    this._config.swarm.specs = specs;
    this._saveConfig();

    // Start heartbeat
    this._connected = true;
    this._connectedSince = Date.now();
    this._networkPeers = peers;
    this._startHeartbeat();

    this.emit('progress', { step: 'done', message: "You're in!" });
    this.emit('joined', { workerId, relay });

    return { ok: true, workerId, relay, peers };
  }

  /**
   * Get current enrollment/connection status
   */
  getStatus() {
    const enrolled = this.isEnrolled();
    return {
      enrolled,
      connected: this._connected,
      workerId: enrolled ? this._config.swarm.workerId : null,
      relayUrl: enrolled ? this._config.swarm.relayUrl : null,
      enrolledAt: enrolled ? this._config.swarm.enrolledAt : null,
      connectedSince: this._connectedSince ? new Date(this._connectedSince).toISOString() : null,
      uptime: this._connectedSince ? Math.floor((Date.now() - this._connectedSince) / 1000) : 0,
      tasksCompleted: this._tasksCompleted,
      networkPeers: this._networkPeers,
      lastPong: this._lastPong ? new Date(this._lastPong).toISOString() : null,
      specs: enrolled ? this._config.swarm.specs : null,
    };
  }

  /**
   * Leave the network
   */
  async leaveNetwork() {
    if (!this.isEnrolled()) {
      return { ok: true, already: true };
    }

    const relay = this._config.swarm.relayUrl;
    const workerId = this._config.swarm.workerId;

    // Notify relay
    try {
      await this._httpRequest(`${relay}/api/unenroll`, 'POST', { workerId });
    } catch {} // Best effort

    // Stop heartbeat
    this._stopHeartbeat();
    this._connected = false;
    this._connectedSince = null;

    // Clear config
    this._config.swarm.enrolled = false;
    delete this._config.swarm.workerId;
    delete this._config.swarm.authKey;
    delete this._config.swarm.enrolledAt;
    delete this._config.swarm.specs;
    this._saveConfig();

    this.emit('left', { workerId });
    return { ok: true, workerId };
  }

  /**
   * Check if currently enrolled
   */
  isEnrolled() {
    return !!(this._config.swarm && this._config.swarm.enrolled && this._config.swarm.workerId);
  }

  /**
   * Auto-reconnect on startup if already enrolled
   */
  autoReconnect() {
    if (!this.isEnrolled()) return false;
    this._connected = true;
    this._connectedSince = Date.now();
    this._startHeartbeat();
    this.emit('reconnected', { workerId: this._config.swarm.workerId });
    return true;
  }

  /**
   * Increment task counter (called by AI routing when swarm task completes)
   */
  taskCompleted() {
    this._tasksCompleted++;
    this.emit('task-completed', { total: this._tasksCompleted });
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    const relay = this._config.swarm?.relayUrl;
    if (!relay) return;

    const ping = async () => {
      try {
        const resp = await this._httpRequest(`${relay}/api/heartbeat`, 'POST', {
          workerId: this._config.swarm.workerId,
          uptime: this._connectedSince ? Math.floor((Date.now() - this._connectedSince) / 1000) : 0,
          tasksCompleted: this._tasksCompleted,
        });
        if (resp.status >= 200 && resp.status < 300) {
          this._connected = true;
          this._lastPong = Date.now();
          this._networkPeers = resp.data?.peers || this._networkPeers;
          // Check for tasks from relay
          if (resp.data?.task) {
            this.emit('task', resp.data.task);
          }
        } else {
          this._connected = false;
        }
      } catch {
        this._connected = false;
      }
      this.emit('heartbeat', { connected: this._connected });
    };

    ping(); // immediate first ping
    this._heartbeatTimer = setInterval(ping, this._heartbeatInterval);
  }

  _stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  /**
   * Register API routes on an addPluginRoute function
   */
  registerRoutes(addRoute) {
    const self = this;

    addRoute('POST', '/api/swarm/join', async (req, res, json, bodyStr) => {
      try {
        const body = bodyStr ? JSON.parse(bodyStr) : {};
        const result = await self.joinNetwork(body.relayUrl);
        json(res, result.ok ? 200 : 400, result);
      } catch (e) {
        json(res, 500, { ok: false, error: e.message });
      }
    });

    addRoute('GET', '/api/swarm/join/status', async (req, res, json) => {
      json(res, 200, self.getStatus());
    });

    addRoute('POST', '/api/swarm/leave', async (req, res, json) => {
      try {
        const result = await self.leaveNetwork();
        json(res, 200, result);
      } catch (e) {
        json(res, 500, { ok: false, error: e.message });
      }
    });
  }

  stop() {
    this._stopHeartbeat();
    this._connected = false;
  }
}

module.exports = { SwarmJoin };
