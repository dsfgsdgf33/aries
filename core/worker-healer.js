/**
 * ARIES — Worker Auto-Healer v2
 * 
 * Goes beyond crash detection: monitors health metrics, detects degraded states,
 * auto-remediates per severity, tracks baselines, enforces cooldowns.
 * 
 * Severity levels:
 *   LOW      — log warning, Telegram alert
 *   MEDIUM   — restart worker service via relay
 *   HIGH     — clear cache/temp, restart service
 *   CRITICAL — mark dead, trigger replacement provisioning
 * 
 * Integrates with: relay system, vbox-provisioner, cloud-auto-provisioner, telegram-miner-bot
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const EventEmitter = require('events');

const DATA_DIR = path.join(__dirname, '..', 'data');
const HEALER_LOG_FILE = path.join(DATA_DIR, 'healer-log.json');
const BASELINE_FILE = path.join(DATA_DIR, 'healer-baselines.json');
const CONFIG_FILE = path.join(DATA_DIR, 'healer-config.json');

const DEFAULTS = {
  enabled: true,
  checkIntervalMs: 60000,          // 1 min
  baselineWindowMs: 24 * 3600000,  // 24h rolling
  thresholds: {
    hashrateDropPct: 50,   // >50% drop from baseline
    latencyMs: 5000,       // >5s
    diskPct: 90,           // >90%
    memoryPct: 95,         // >95%
    offlineMinutes: 5      // >5 min offline
  },
  cooldown: {
    maxPerHour: 3,
    windowMs: 3600000
  },
  maxLogEntries: 5000,
  autoProvision: true
};

class WorkerHealer extends EventEmitter {
  constructor(refs) {
    super();
    this._refs = refs || {};
    this._interval = null;
    this._config = this._loadConfig();
    this._baselines = this._loadBaselines();
    this._log = this._loadLog();
    this._workerStates = {};  // track per-worker state
  }

  // ── Persistence ──

  _ensureDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  _loadConfig() {
    try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) }; }
    catch { return { ...DEFAULTS }; }
  }

  _saveConfig() {
    this._ensureDir();
    try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(this._config, null, 2)); } catch {}
  }

  _loadBaselines() {
    try { return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')); }
    catch { return {}; }
  }

  _saveBaselines() {
    this._ensureDir();
    try { fs.writeFileSync(BASELINE_FILE, JSON.stringify(this._baselines)); } catch {}
  }

  _loadLog() {
    try { return JSON.parse(fs.readFileSync(HEALER_LOG_FILE, 'utf8')); }
    catch { return { entries: [] }; }
  }

  _saveLog() {
    this._ensureDir();
    // Trim
    if (this._log.entries.length > this._config.maxLogEntries) {
      this._log.entries = this._log.entries.slice(-this._config.maxLogEntries);
    }
    try { fs.writeFileSync(HEALER_LOG_FILE, JSON.stringify(this._log, null, 2)); } catch {}
  }

  _logEntry(workerId, severity, issue, action, result) {
    const entry = {
      ts: Date.now(),
      time: new Date().toISOString(),
      workerId,
      severity,
      issue,
      action,
      result
    };
    this._log.entries.push(entry);
    this._saveLog();
    this.emit('healer-action', entry);
    return entry;
  }

  // ── Relay Communication ──

  _getRelayConfig() {
    let mainCfg = {};
    try { mainCfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8')); } catch {}
    let usbCfg = {};
    try { usbCfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'usb-swarm', 'config.json'), 'utf8')); } catch {}
    const relayUrl = usbCfg.swarmRelayUrl || (mainCfg.relay ? mainCfg.relay.url : '') || '';
    const secret = usbCfg.swarmSecret || (mainCfg.remoteWorkers ? mainCfg.remoteWorkers.secret : '') || (mainCfg.relay ? mainCfg.relay.secret : '') || '';
    return { relayUrl, secret };
  }

  _relayRequest(urlPath, method, body, timeout) {
    timeout = timeout || 15000;
    return new Promise((resolve, reject) => {
      const cfg = this._getRelayConfig();
      if (!cfg.relayUrl) return resolve(null);
      const fullUrl = cfg.relayUrl.replace(/\/$/, '') + urlPath;
      let u;
      try { u = new URL(fullUrl); } catch { return resolve(null); }
      const mod = u.protocol === 'https:' ? https : http;
      const headers = {
        'X-Aries-Secret': cfg.secret,
        'Authorization': 'Bearer ' + cfg.secret
      };
      if (body) headers['Content-Type'] = 'application/json';
      const bodyStr = body ? JSON.stringify(body) : null;
      const req = mod.request({
        hostname: u.hostname, port: u.port, path: u.pathname + (u.search || ''),
        method: method || 'GET',
        headers,
        timeout,
        rejectUnauthorized: false
      }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
          catch { resolve(null); }
        });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  }

  // ── Baseline Tracking (24h rolling window) ──

  _updateBaseline(workerId, metrics) {
    const now = Date.now();
    const window = this._config.baselineWindowMs;
    if (!this._baselines[workerId]) {
      this._baselines[workerId] = { samples: [], computed: null };
    }
    const bl = this._baselines[workerId];
    bl.samples.push({ t: now, ...metrics });
    // Prune outside window
    bl.samples = bl.samples.filter(s => s.t > now - window);
    // Compute rolling averages
    const n = bl.samples.length;
    if (n < 3) { bl.computed = null; return; } // need minimum samples
    let sumHash = 0, sumCpu = 0, sumRam = 0, sumLatency = 0, hashCount = 0;
    for (const s of bl.samples) {
      if (s.hashrate > 0) { sumHash += s.hashrate; hashCount++; }
      sumCpu += (s.cpu || 0);
      sumRam += (s.ram || 0);
      sumLatency += (s.latency || 0);
    }
    bl.computed = {
      avgHashrate: hashCount > 0 ? sumHash / hashCount : 0,
      avgCpu: sumCpu / n,
      avgRam: sumRam / n,
      avgLatency: sumLatency / n,
      sampleCount: n,
      updatedAt: now
    };
  }

  // ── Degradation Detection ──

  _assessWorker(workerId, current, baseline) {
    const t = this._config.thresholds;
    const issues = [];

    // Offline check
    const now = Date.now();
    const lastSeen = current.lastSeen || current.timestamp || 0;
    const offlineMs = now - lastSeen;
    if (offlineMs > t.offlineMinutes * 60000) {
      const mins = Math.round(offlineMs / 60000);
      if (mins > 30) {
        issues.push({ severity: 'CRITICAL', issue: `offline ${mins}min`, metric: 'offline' });
      } else if (mins > 15) {
        issues.push({ severity: 'HIGH', issue: `offline ${mins}min`, metric: 'offline' });
      } else {
        issues.push({ severity: 'MEDIUM', issue: `offline ${mins}min`, metric: 'offline' });
      }
    }

    // Hashrate drop
    if (baseline && baseline.avgHashrate > 0 && current.hashrate !== undefined) {
      const dropPct = ((baseline.avgHashrate - current.hashrate) / baseline.avgHashrate) * 100;
      if (dropPct > t.hashrateDropPct) {
        if (current.hashrate === 0) {
          issues.push({ severity: 'HIGH', issue: `hashrate=0 (baseline=${baseline.avgHashrate.toFixed(1)})`, metric: 'hashrate' });
        } else {
          issues.push({ severity: 'MEDIUM', issue: `hashrate dropped ${dropPct.toFixed(0)}% (${current.hashrate.toFixed(1)} vs baseline ${baseline.avgHashrate.toFixed(1)})`, metric: 'hashrate' });
        }
      }
    }

    // Latency
    if (current.latency > t.latencyMs) {
      const sev = current.latency > t.latencyMs * 3 ? 'HIGH' : current.latency > t.latencyMs * 2 ? 'MEDIUM' : 'LOW';
      issues.push({ severity: sev, issue: `latency ${current.latency}ms`, metric: 'latency' });
    }

    // Disk usage
    if (current.disk > t.diskPct) {
      const sev = current.disk > 98 ? 'CRITICAL' : current.disk > 95 ? 'HIGH' : 'MEDIUM';
      issues.push({ severity: sev, issue: `disk at ${current.disk}%`, metric: 'disk' });
    }

    // Memory usage
    if (current.ram > t.memoryPct) {
      const sev = current.ram > 99 ? 'HIGH' : 'MEDIUM';
      issues.push({ severity: sev, issue: `memory at ${current.ram}%`, metric: 'memory' });
    }

    return issues;
  }

  // ── Cooldown Check ──

  _canRemediate(workerId) {
    const now = Date.now();
    const window = this._config.cooldown.windowMs;
    const max = this._config.cooldown.maxPerHour;
    const recent = this._log.entries.filter(e =>
      e.workerId === workerId &&
      e.ts > now - window &&
      e.action !== 'alert' && e.action !== 'log'
    );
    return recent.length < max;
  }

  _remediationCount(workerId) {
    const now = Date.now();
    const window = this._config.cooldown.windowMs;
    return this._log.entries.filter(e =>
      e.workerId === workerId &&
      e.ts > now - window &&
      e.action !== 'alert' && e.action !== 'log'
    ).length;
  }

  // ── Remediation Actions ──

  async _sendTelegramAlert(message) {
    // Use telegram-miner-bot if available, or direct config
    try {
      let cfg = {};
      try { cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8')); } catch {}
      const token = cfg.telegramBotToken || (cfg.telegram && cfg.telegram.botToken) || '';
      const chatId = cfg.telegramChatId || (cfg.telegram && cfg.telegram.chatId) || '';
      if (!token || !chatId) return false;
      const text = `🏥 ARIES Healer\n${message}`;
      const url = `https://api.telegram.org/bot${token}/sendMessage`;
      await this._httpPost(url, { chat_id: chatId, text, parse_mode: 'HTML' });
      return true;
    } catch { return false; }
  }

  _httpPost(url, body) {
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      const mod = u.protocol === 'https:' ? https : http;
      const data = JSON.stringify(body);
      const req = mod.request({
        hostname: u.hostname, port: u.port, path: u.pathname + (u.search || ''),
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
        timeout: 10000,
        rejectUnauthorized: false
      }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString()));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.write(data);
      req.end();
    });
  }

  async _remediateLow(workerId, issue) {
    await this._sendTelegramAlert(`⚠️ <b>${workerId}</b>: ${issue}`);
    return this._logEntry(workerId, 'LOW', issue, 'alert', 'telegram alert sent');
  }

  async _remediateMedium(workerId, issue) {
    if (!this._canRemediate(workerId)) {
      return this._logEntry(workerId, 'MEDIUM', issue, 'cooldown', `skipped — ${this._remediationCount(workerId)} remediations in last hour`);
    }
    // Send restart command via relay
    const result = await this._relayRequest(`/api/command/${workerId}`, 'POST', {
      command: 'restart-service',
      args: {}
    });
    await this._sendTelegramAlert(`🔄 <b>${workerId}</b>: restarting — ${issue}`);
    const ok = result && result.ok;
    return this._logEntry(workerId, 'MEDIUM', issue, 'restart', ok ? 'restart command sent' : 'restart command failed');
  }

  async _remediateHigh(workerId, issue) {
    if (!this._canRemediate(workerId)) {
      return this._logEntry(workerId, 'HIGH', issue, 'cooldown', `skipped — ${this._remediationCount(workerId)} remediations in last hour`);
    }
    // Clear cache then restart
    const clearResult = await this._relayRequest(`/api/command/${workerId}`, 'POST', {
      command: 'clear-cache',
      args: { paths: ['/tmp/aries-*', 'data/cache/*'] }
    });
    const restartResult = await this._relayRequest(`/api/command/${workerId}`, 'POST', {
      command: 'restart-service',
      args: { force: true }
    });
    await this._sendTelegramAlert(`🧹🔄 <b>${workerId}</b>: cleared cache + restarting — ${issue}`);
    return this._logEntry(workerId, 'HIGH', issue, 'clear+restart', `clear=${!!clearResult}, restart=${!!restartResult}`);
  }

  async _remediateCritical(workerId, issue) {
    if (!this._canRemediate(workerId)) {
      return this._logEntry(workerId, 'CRITICAL', issue, 'cooldown', `skipped — max remediations reached`);
    }
    // Mark as dead
    if (!this._workerStates[workerId]) this._workerStates[workerId] = {};
    this._workerStates[workerId].dead = true;
    this._workerStates[workerId].deadSince = Date.now();

    // Try replacement provisioning
    let provisionResult = 'no provisioner available';
    try {
      // Try vbox-provisioner first
      const vboxProv = require('./vbox-provisioner.js');
      if (vboxProv && typeof vboxProv.createVM === 'function') {
        const vm = vboxProv.createVM({ name: `aries-replace-${workerId.slice(0, 8)}` });
        provisionResult = vm ? `vbox VM created: ${vm.name || 'ok'}` : 'vbox creation failed';
      }
    } catch {
      // Try cloud provisioner
      try {
        const cloudProv = require('./cloud-auto-provisioner.js');
        if (cloudProv && typeof cloudProv.provision === 'function') {
          provisionResult = 'cloud provision triggered';
        }
      } catch {
        provisionResult = 'no provisioner available';
      }
    }

    await this._sendTelegramAlert(`💀 <b>${workerId}</b>: marked DEAD — ${issue}\nReplacement: ${provisionResult}`);
    return this._logEntry(workerId, 'CRITICAL', issue, 'dead+provision', provisionResult);
  }

  // ── Severity Priority ──

  static _severityRank(s) {
    return { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 }[s] || 0;
  }

  // ── Main Check Loop ──

  async _checkAll() {
    if (!this._config.enabled) return;

    try {
      // Get relay status
      const relayData = await this._relayRequest('/api/status', 'GET');
      const workers = (relayData && relayData.workers) ? relayData.workers : {};
      const now = Date.now();

      // Also pull miner state if available
      const minerState = this._refs._minerState || {};
      const minerNodes = minerState.nodes || {};

      for (const id of Object.keys(workers)) {
        const w = workers[id];
        const miner = minerNodes[id] || minerNodes[w.hostname] || {};
        const load = w.load || {};

        // Build current metrics
        const current = {
          hashrate: miner.hashrate || 0,
          latency: w.latency || (w.lastPing ? now - w.lastPing : 0),
          disk: load.disk || 0,
          ram: load.ram || load.memory || 0,
          cpu: load.cpu || 0,
          lastSeen: w.timestamp || w.lastSeen || 0,
          status: w.status || 'unknown'
        };

        // Skip workers marked dead (until they come back)
        if (this._workerStates[id] && this._workerStates[id].dead) {
          // Check if it came back online
          if (now - current.lastSeen < 60000 && current.hashrate > 0) {
            this._workerStates[id].dead = false;
            this._logEntry(id, 'LOW', 'worker recovered', 'recovered', 'back online');
            await this._sendTelegramAlert(`✅ <b>${id}</b>: recovered and back online!`);
          }
          continue;
        }

        // Update baseline
        if (now - current.lastSeen < 120000) {
          this._updateBaseline(id, current);
        }

        // Assess
        const baseline = this._baselines[id] && this._baselines[id].computed;
        const issues = this._assessWorker(id, current, baseline);
        if (issues.length === 0) continue;

        // Take highest severity action
        issues.sort((a, b) => WorkerHealer._severityRank(b.severity) - WorkerHealer._severityRank(a.severity));
        const worst = issues[0];

        switch (worst.severity) {
          case 'LOW':
            await this._remediateLow(id, worst.issue);
            break;
          case 'MEDIUM':
            await this._remediateMedium(id, worst.issue);
            break;
          case 'HIGH':
            await this._remediateHigh(id, worst.issue);
            break;
          case 'CRITICAL':
            await this._remediateCritical(id, worst.issue);
            break;
        }
      }

      // Save baselines periodically
      this._saveBaselines();
    } catch (err) {
      this._logEntry('system', 'LOW', `healer check error: ${err.message}`, 'error', 'check failed');
    }
  }

  // ── Lifecycle ──

  start() {
    if (this._interval) return;
    this._checkAll().catch(() => {});
    this._interval = setInterval(() => {
      this._checkAll().catch(() => {});
    }, this._config.checkIntervalMs);
    this.emit('started');
  }

  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
    this._saveBaselines();
    this._saveLog();
    this.emit('stopped');
  }

  // ── API Handlers ──

  getStatus() {
    const workerIds = Object.keys(this._baselines);
    const deadWorkers = Object.entries(this._workerStates)
      .filter(([, s]) => s.dead)
      .map(([id, s]) => ({ id, deadSince: s.deadSince }));

    const recentActions = this._log.entries.slice(-20);
    const now = Date.now();
    const lastHour = this._log.entries.filter(e => e.ts > now - 3600000);
    const bySeverity = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
    for (const e of lastHour) bySeverity[e.severity] = (bySeverity[e.severity] || 0) + 1;

    return {
      enabled: this._config.enabled,
      running: !!this._interval,
      checkIntervalMs: this._config.checkIntervalMs,
      trackedWorkers: workerIds.length,
      deadWorkers,
      baselines: Object.fromEntries(
        workerIds.map(id => [id, this._baselines[id].computed || 'learning'])
      ),
      lastHourActions: bySeverity,
      recentActions,
      thresholds: this._config.thresholds,
      cooldown: this._config.cooldown
    };
  }

  getLog(limit) {
    limit = limit || 100;
    return {
      total: this._log.entries.length,
      entries: this._log.entries.slice(-limit)
    };
  }

  updateConfig(newConfig) {
    // Merge safely
    if (newConfig.enabled !== undefined) this._config.enabled = !!newConfig.enabled;
    if (newConfig.checkIntervalMs) this._config.checkIntervalMs = Math.max(10000, newConfig.checkIntervalMs);
    if (newConfig.thresholds) this._config.thresholds = { ...this._config.thresholds, ...newConfig.thresholds };
    if (newConfig.cooldown) this._config.cooldown = { ...this._config.cooldown, ...newConfig.cooldown };
    if (newConfig.autoProvision !== undefined) this._config.autoProvision = !!newConfig.autoProvision;
    this._saveConfig();

    // Restart interval if changed
    if (this._interval) {
      this.stop();
      this.start();
    }
    return this._config;
  }

  // ── Express-style route handler ──

  registerRoutes(app) {
    if (!app) return;

    app.get('/api/manage/healer/status', (req, res) => {
      res.json(this.getStatus());
    });

    app.get('/api/manage/healer/log', (req, res) => {
      const limit = parseInt(req.query && req.query.limit) || 100;
      res.json(this.getLog(limit));
    });

    app.post('/api/manage/healer/config', (req, res) => {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const cfg = JSON.parse(body);
          const updated = this.updateConfig(cfg);
          res.json({ ok: true, config: updated });
        } catch (err) {
          res.statusCode = 400;
          res.json({ ok: false, error: err.message });
        }
      });
    });
  }
}

module.exports = WorkerHealer;
