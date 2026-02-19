// ============================================================================
// Aries Member Tracker — core/member-tracker.js
// Track all workers connecting to the relay, persist stats, GeoIP, bans
// ============================================================================

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const EventEmitter = require('events');

const DATA_DIR = path.join(__dirname, '..', 'data');
const MEMBERS_FILE = path.join(DATA_DIR, 'members.json');
const BANNED_FILE = path.join(DATA_DIR, 'banned.json');
const HISTORY_FILE = path.join(DATA_DIR, 'member-history.json');

class MemberTracker extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.members = {};       // workerId → member data
    this.banned = { ips: [], workerIds: [] };
    this.history = [];       // connection/disconnection events
    this.geoCache = {};      // ip → { country, city, ... }
    this._geoQueue = [];
    this._geoProcessing = false;
    this._geoLastReq = 0;
    this._workerMessages = {}; // workerId → [pending messages]
    this._workerGroups = {};   // groupName → [workerIds]
    this._configPushQueue = {}; // workerId → pending config
    this._shellQueue = {};     // workerId → { command, resolve, reject }
    this._shellResults = {};   // workerId → last result
    this._load();
    this._startPeriodicSave();
  }

  _ensureDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  _load() {
    this._ensureDir();
    try { this.members = JSON.parse(fs.readFileSync(MEMBERS_FILE, 'utf8')); } catch {}
    try { this.banned = JSON.parse(fs.readFileSync(BANNED_FILE, 'utf8')); } catch {}
    try { this.history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch {}
    if (!this.banned.ips) this.banned.ips = [];
    if (!this.banned.workerIds) this.banned.workerIds = [];
    // Rebuild groups from member data
    for (const [wid, m] of Object.entries(this.members)) {
      if (m.groups) {
        for (const g of m.groups) {
          if (!this._workerGroups[g]) this._workerGroups[g] = [];
          if (!this._workerGroups[g].includes(wid)) this._workerGroups[g].push(wid);
        }
      }
    }
  }

  _save() {
    this._ensureDir();
    try { fs.writeFileSync(MEMBERS_FILE, JSON.stringify(this.members, null, 2)); } catch {}
    try { fs.writeFileSync(BANNED_FILE, JSON.stringify(this.banned, null, 2)); } catch {}
  }

  _saveHistory() {
    this._ensureDir();
    // Keep last 10000 events
    if (this.history.length > 10000) this.history = this.history.slice(-10000);
    try { fs.writeFileSync(HISTORY_FILE, JSON.stringify(this.history, null, 2)); } catch {}
  }

  _startPeriodicSave() {
    setInterval(() => this._save(), 60000); // save every minute
  }

  // Check if worker/IP is banned
  isBanned(workerId, ip) {
    if (this.banned.workerIds.includes(workerId)) return true;
    if (ip && this.banned.ips.includes(ip)) return true;
    return false;
  }

  // Register or update a worker
  trackWorker(workerId, info = {}) {
    const now = Date.now();
    const ip = info.ip || 'unknown';

    if (this.isBanned(workerId, ip)) {
      return { banned: true };
    }

    const existing = this.members[workerId];
    if (existing) {
      // Update existing
      existing.lastHeartbeat = now;
      existing.status = info.status || 'online';
      if (info.ip) existing.ip = info.ip;
      if (info.hostname) existing.hostname = info.hostname;
      if (info.os) existing.os = info.os;
      if (info.ram) existing.ram = info.ram;
      if (info.cpuCores) existing.cpuCores = info.cpuCores;
      if (info.cpuPercent !== undefined) existing.cpuPercent = info.cpuPercent;
      if (info.ramPercent !== undefined) existing.ramPercent = info.ramPercent;
      if (info.diskPercent !== undefined) existing.diskPercent = info.diskPercent;
      if (info.hashrate !== undefined) {
        existing.hashrate = info.hashrate;
        existing.hashrateHistory = existing.hashrateHistory || [];
        existing.hashrateHistory.push({ t: now, h: info.hashrate });
        if (existing.hashrateHistory.length > 1440) existing.hashrateHistory = existing.hashrateHistory.slice(-1440); // 24h at 1/min
      }
      if (info.ollamaModel) existing.ollamaModel = info.ollamaModel;
      if (info.tasksCompleted !== undefined) existing.tasksCompleted = info.tasksCompleted;
      if (info.cpuHours !== undefined) existing.cpuHours = info.cpuHours;
      existing.uptimeHours = ((now - existing.connectedSince) / 3600000).toFixed(2);
      return existing;
    }

    // New worker
    const member = {
      workerId,
      name: info.name || workerId,
      ip: ip,
      hostname: info.hostname || '',
      status: info.status || 'online',
      connectedSince: now,
      firstSeen: now,
      lastHeartbeat: now,
      uptimeHours: 0,
      cpuHours: 0,
      hashrate: info.hashrate || 0,
      hashrateHistory: [],
      tasksCompleted: 0,
      ollamaModel: info.ollamaModel || null,
      os: info.os || 'unknown',
      ram: info.ram || 0,
      cpuCores: info.cpuCores || 0,
      cpuPercent: info.cpuPercent || 0,
      ramPercent: info.ramPercent || 0,
      diskPercent: info.diskPercent || 0,
      referralCode: info.referralCode || null,
      tier: info.tier || 'free',
      groups: info.groups || [],
      country: null,
      city: null,
      version: info.version || 'unknown',
    };

    this.members[workerId] = member;
    this.history.push({ event: 'connect', workerId, ip, timestamp: now });
    this._saveHistory();
    this.emit('worker-connect', member);

    // Queue GeoIP lookup
    if (ip && ip !== 'unknown' && ip !== '127.0.0.1' && !ip.startsWith('::')) {
      this._queueGeoLookup(workerId, ip);
    }

    return member;
  }

  // Worker disconnected
  disconnectWorker(workerId) {
    const member = this.members[workerId];
    if (member) {
      member.status = 'offline';
      member.lastDisconnect = Date.now();
      member.uptimeHours = ((Date.now() - member.connectedSince) / 3600000).toFixed(2);
      this.history.push({ event: 'disconnect', workerId, timestamp: Date.now() });
      this._saveHistory();
      this.emit('worker-disconnect', member);
    }
  }

  // Update hashrate for a worker
  updateHashrate(workerId, hashrate) {
    const m = this.members[workerId];
    if (!m) return;
    m.hashrate = hashrate;
    m.hashrateHistory = m.hashrateHistory || [];
    m.hashrateHistory.push({ t: Date.now(), h: hashrate });
    if (m.hashrateHistory.length > 1440) m.hashrateHistory = m.hashrateHistory.slice(-1440);
    if (hashrate > 0) m.status = 'mining';
  }

  // Record task completion
  recordTaskCompletion(workerId, taskInfo = {}) {
    const m = this.members[workerId];
    if (!m) return;
    m.tasksCompleted = (m.tasksCompleted || 0) + 1;
    m.lastTaskCompleted = Date.now();
    m.cpuHours = (m.cpuHours || 0) + (taskInfo.durationMs ? taskInfo.durationMs / 3600000 : 0.01);
    this.emit('task-complete', { workerId, taskInfo });
  }

  // Ban a worker
  banWorker(workerId) {
    const m = this.members[workerId];
    if (!this.banned.workerIds.includes(workerId)) this.banned.workerIds.push(workerId);
    if (m && m.ip && !this.banned.ips.includes(m.ip)) this.banned.ips.push(m.ip);
    if (m) m.status = 'banned';
    this.history.push({ event: 'ban', workerId, timestamp: Date.now() });
    this._saveHistory();
    this._save();
    this.emit('worker-ban', { workerId });
    return true;
  }

  // Unban
  unbanWorker(workerId) {
    this.banned.workerIds = this.banned.workerIds.filter(id => id !== workerId);
    const m = this.members[workerId];
    if (m) {
      this.banned.ips = this.banned.ips.filter(ip => ip !== m.ip);
      m.status = 'offline';
    }
    this._save();
  }

  // Kick (disconnect without banning)
  kickWorker(workerId) {
    const m = this.members[workerId];
    if (m) {
      m.status = 'kicked';
      this.history.push({ event: 'kick', workerId, timestamp: Date.now() });
      this._saveHistory();
      this.emit('worker-kick', { workerId });
    }
    return true;
  }

  // Push message to worker (they poll for it)
  pushMessage(workerId, message) {
    if (!this._workerMessages[workerId]) this._workerMessages[workerId] = [];
    this._workerMessages[workerId].push({ message, timestamp: Date.now(), read: false });
    this.emit('worker-message', { workerId, message });
  }

  // Get pending messages for worker (and clear them)
  getMessages(workerId) {
    const msgs = this._workerMessages[workerId] || [];
    this._workerMessages[workerId] = [];
    return msgs;
  }

  // Change worker tier
  setTier(workerId, tier) {
    const m = this.members[workerId];
    if (m) m.tier = tier;
  }

  // Worker groups
  addToGroup(workerId, groupName) {
    if (!this._workerGroups[groupName]) this._workerGroups[groupName] = [];
    if (!this._workerGroups[groupName].includes(workerId)) this._workerGroups[groupName].push(workerId);
    const m = this.members[workerId];
    if (m) {
      m.groups = m.groups || [];
      if (!m.groups.includes(groupName)) m.groups.push(groupName);
    }
  }

  removeFromGroup(workerId, groupName) {
    if (this._workerGroups[groupName]) {
      this._workerGroups[groupName] = this._workerGroups[groupName].filter(id => id !== workerId);
    }
    const m = this.members[workerId];
    if (m && m.groups) m.groups = m.groups.filter(g => g !== groupName);
  }

  getGroup(groupName) {
    return (this._workerGroups[groupName] || []).map(id => this.members[id]).filter(Boolean);
  }

  getGroups() {
    return Object.keys(this._workerGroups);
  }

  // Config push
  pushConfig(workerId, configPatch) {
    this._configPushQueue[workerId] = { config: configPatch, timestamp: Date.now() };
  }

  getConfigPush(workerId) {
    const c = this._configPushQueue[workerId];
    if (c) delete this._configPushQueue[workerId];
    return c;
  }

  // Shell command queue
  queueShellCommand(workerId, command) {
    return new Promise((resolve, reject) => {
      this._shellQueue[workerId] = { command, resolve, reject, timestamp: Date.now() };
      // Timeout after 60s
      setTimeout(() => {
        if (this._shellQueue[workerId]) {
          delete this._shellQueue[workerId];
          reject(new Error('Shell command timed out'));
        }
      }, 60000);
    });
  }

  getShellCommand(workerId) {
    const cmd = this._shellQueue[workerId];
    return cmd ? cmd.command : null;
  }

  reportShellResult(workerId, result) {
    this._shellResults[workerId] = result;
    if (this._shellQueue[workerId]) {
      this._shellQueue[workerId].resolve(result);
      delete this._shellQueue[workerId];
    }
  }

  // Aggregate stats
  getStats() {
    const now = Date.now();
    const allMembers = Object.values(this.members);
    const online = allMembers.filter(m => m.status === 'online' || m.status === 'mining' || m.status === 'processing' || m.status === 'idle');
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const weekAgo = now - 7 * 86400000;
    const monthAgo = now - 30 * 86400000;

    const newToday = allMembers.filter(m => m.firstSeen >= today.getTime()).length;
    const newWeek = allMembers.filter(m => m.firstSeen >= weekAgo).length;
    const newMonth = allMembers.filter(m => m.firstSeen >= monthAgo).length;

    const totalHashrate = online.reduce((s, m) => s + (m.hashrate || 0), 0);
    const totalTasks = allMembers.reduce((s, m) => s + (m.tasksCompleted || 0), 0);
    const totalCpuHours = allMembers.reduce((s, m) => s + (m.cpuHours || 0), 0);

    // Geographic distribution
    const geoDistribution = {};
    for (const m of allMembers) {
      const country = m.country || 'Unknown';
      geoDistribution[country] = (geoDistribution[country] || 0) + 1;
    }

    return {
      totalMembers: allMembers.length,
      onlineCount: online.length,
      totalHashrate,
      totalTasks,
      totalCpuHours: Math.round(totalCpuHours * 100) / 100,
      newToday,
      newWeek,
      newMonth,
      geoDistribution,
      bannedCount: this.banned.workerIds.length,
    };
  }

  // Get all members (for API)
  getAllMembers() {
    return Object.values(this.members).map(m => {
      const safe = { ...m };
      // Anonymize IP for display (keep full in separate field)
      if (safe.ip && safe.ip !== 'unknown') {
        const parts = safe.ip.split('.');
        if (parts.length === 4) safe.ipDisplay = parts[0] + '.' + parts[1] + '.' + parts[2] + '.***';
        else safe.ipDisplay = safe.ip;
      } else {
        safe.ipDisplay = 'unknown';
      }
      return safe;
    });
  }

  // Get single member
  getMember(workerId) {
    return this.members[workerId] || null;
  }

  // Revenue estimation
  getRevenueEstimate() {
    const stats = this.getStats();
    // XMR price estimate (rough, should be fetched)
    const xmrPrice = 170; // USD fallback
    const solPrice = 150; // USD fallback
    // RandomX: ~1000 H/s per modern CPU core ≈ ~0.0001 XMR/day at network difficulty
    // Very rough: hashrate × 0.0000001 XMR/day per H/s
    const dailyXmr = stats.totalHashrate * 0.0000001;
    const dailySol = (dailyXmr * xmrPrice) / solPrice; // converted via unMineable
    const monthlyXmr = dailyXmr * 30;
    const monthlySol = dailySol * 30;

    // Per-worker breakdown
    const perWorker = {};
    for (const [wid, m] of Object.entries(this.members)) {
      if (m.hashrate > 0) {
        const wDailyXmr = m.hashrate * 0.0000001;
        const wDailySol = (wDailyXmr * xmrPrice) / solPrice;
        perWorker[wid] = {
          hashrate: m.hashrate,
          dailyXmr: Math.round(wDailyXmr * 100000000) / 100000000,
          dailySol: Math.round(wDailySol * 100000000) / 100000000,
          monthlySol: Math.round(wDailySol * 30 * 100000000) / 100000000,
        };
      }
    }

    return {
      totalHashrate: stats.totalHashrate,
      dailyXmr: Math.round(dailyXmr * 100000000) / 100000000,
      dailySol: Math.round(dailySol * 100000000) / 100000000,
      monthlyXmr: Math.round(monthlyXmr * 100000000) / 100000000,
      monthlySol: Math.round(monthlySol * 100000000) / 100000000,
      projectedMonthlySol: Math.round(monthlySol * 100) / 100,
      xmrPriceUsd: xmrPrice,
      solPriceUsd: solPrice,
      perWorker,
    };
  }

  // GeoIP lookup via ip-api.com (free tier, 45 req/min)
  _queueGeoLookup(workerId, ip) {
    if (this.geoCache[ip]) {
      const m = this.members[workerId];
      if (m) {
        m.country = this.geoCache[ip].country;
        m.city = this.geoCache[ip].city;
      }
      return;
    }
    this._geoQueue.push({ workerId, ip });
    this._processGeoQueue();
  }

  _processGeoQueue() {
    if (this._geoProcessing || this._geoQueue.length === 0) return;
    this._geoProcessing = true;

    const now = Date.now();
    const delay = Math.max(0, 1400 - (now - this._geoLastReq)); // ~45/min = 1 per 1.33s

    setTimeout(() => {
      const item = this._geoQueue.shift();
      if (!item) { this._geoProcessing = false; return; }

      this._geoLastReq = Date.now();
      const req = http.get(`http://ip-api.com/json/${item.ip}?fields=status,country,countryCode,city`, (resp) => {
        let data = '';
        resp.on('data', c => data += c);
        resp.on('end', () => {
          try {
            const j = JSON.parse(data);
            if (j.status === 'success') {
              this.geoCache[item.ip] = { country: j.country, countryCode: j.countryCode, city: j.city };
              const m = this.members[item.workerId];
              if (m) { m.country = j.country; m.city = j.city; m.countryCode = j.countryCode; }
            }
          } catch {}
          this._geoProcessing = false;
          this._processGeoQueue();
        });
      });
      req.on('error', () => { this._geoProcessing = false; this._processGeoQueue(); });
      req.setTimeout(5000, () => { req.destroy(); this._geoProcessing = false; this._processGeoQueue(); });
    }, delay);
  }

  // Broadcast message to all online workers
  broadcastMessage(message) {
    for (const [wid, m] of Object.entries(this.members)) {
      if (m.status === 'online' || m.status === 'mining' || m.status === 'processing' || m.status === 'idle') {
        this.pushMessage(wid, message);
      }
    }
  }

  // Push config to all workers
  broadcastConfig(configPatch) {
    for (const [wid, m] of Object.entries(this.members)) {
      if (m.status === 'online' || m.status === 'mining' || m.status === 'processing' || m.status === 'idle') {
        this.pushConfig(wid, configPatch);
      }
    }
  }

  // Get workers matching filter
  filterWorkers(filter = {}) {
    return Object.values(this.members).filter(m => {
      if (filter.os && m.os !== filter.os) return false;
      if (filter.tier && m.tier !== filter.tier) return false;
      if (filter.minRam && m.ram < filter.minRam) return false;
      if (filter.group && (!m.groups || !m.groups.includes(filter.group))) return false;
      if (filter.status && m.status !== filter.status) return false;
      return true;
    });
  }
}

module.exports = MemberTracker;
