/**
 * ARIES v5.0 — Threat Intelligence Feed
 * 
 * Monitors swarm workers for compromise indicators and manages threat response.
 * 
 * Detection rules:
 *   - Unexpected outbound connections (IPs not in whitelist)
 *   - Unusual DNS queries (known C2 domains, DGA patterns)
 *   - CPU pattern anomalies (sudden spikes/drops)
 *   - Unauthorized process spawning
 *   - File integrity changes on critical worker files
 *   - Failed auth attempts against relay
 * 
 * Threat levels: INFO, WARN, ALERT, CRITICAL
 * Auto-response for CRITICAL: isolate worker, alert Master Control
 * 
 * No npm dependencies — built-in Node.js only.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const EventEmitter = require('events');

const DATA_DIR = path.join(__dirname, '..', 'data');
const THREAT_LOG_PATH = path.join(DATA_DIR, 'threat-log.json');
const WHITELIST_PATH = path.join(DATA_DIR, 'threat-whitelist.json');
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

const THREAT_LEVELS = { INFO: 0, WARN: 1, ALERT: 2, CRITICAL: 3 };
const LEVEL_NAMES = ['INFO', 'WARN', 'ALERT', 'CRITICAL'];

// ── Known C2 / malicious domain patterns ──
const KNOWN_C2_DOMAINS = [
  'cobaltstrike.com', 'evil.com', 'malware.com',
  // Common C2 frameworks
  /\.onion\./i, /\.tor2web\./i,
  // Suspicious TLDs commonly abused
  /\.(top|xyz|club|work|date|racing|download|stream|gdn|bid|loan)\.[^.]+$/i,
];

// DGA detection: high entropy + unusual length
function isDGADomain(domain) {
  const parts = domain.split('.');
  const name = parts[0];
  if (name.length < 8) return false;
  // Shannon entropy
  const freq = {};
  for (const c of name) freq[c] = (freq[c] || 0) + 1;
  let entropy = 0;
  const len = name.length;
  for (const c in freq) {
    const p = freq[c] / len;
    entropy -= p * Math.log2(p);
  }
  // High entropy + consonant clusters = likely DGA
  const consonantRatio = (name.match(/[bcdfghjklmnpqrstvwxyz]/gi) || []).length / len;
  return entropy > 3.5 && consonantRatio > 0.65 && name.length > 12;
}

// ── IP Reputation Cache ──
class IPReputationCache {
  constructor() {
    this._cache = new Map(); // ip -> { bad: bool, source: str, ts: number }
    this._ttl = 3600000; // 1 hour
  }

  get(ip) {
    const entry = this._cache.get(ip);
    if (entry && Date.now() - entry.ts < this._ttl) return entry;
    return null;
  }

  set(ip, bad, source) {
    this._cache.set(ip, { bad, source, ts: Date.now() });
  }

  clear() { this._cache.clear(); }
}

// ── Blocklist Fetcher ──
function fetchBlocklist(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 15000 }, (res) => {
      if (res.statusCode !== 200) { resolve(new Set()); return; }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        const ips = new Set();
        for (const line of text.split('\n')) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('//')) {
            // Extract IP (first column or whole line)
            const match = trimmed.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
            if (match) ips.add(match[1]);
          }
        }
        resolve(ips);
      });
    });
    req.on('error', () => resolve(new Set()));
    req.on('timeout', () => { req.destroy(); resolve(new Set()); });
  });
}

/**
 * @class ThreatIntel
 * @extends EventEmitter
 * 
 * Events emitted:
 *   'threat' - { id, level, type, workerId, detail, timestamp, dismissed }
 *   'worker-isolated' - { workerId, reason }
 */
class ThreatIntel extends EventEmitter {
  constructor(refs = {}) {
    super();
    this._refs = refs; // { relay, swarmManager, telegramBot, logger, config }
    this._running = false;
    this._threats = [];         // all threat events
    this._activeThreats = [];   // non-dismissed
    this._whitelist = { ips: [], domains: [], processes: [] };
    this._isolatedWorkers = new Set();
    this._ipRepCache = new IPReputationCache();
    this._blocklists = new Set();
    this._workerBaselines = new Map(); // workerId -> { avgCpu, processes, fileHashes }
    this._failedAuths = new Map();     // ip -> { count, firstSeen, lastSeen }
    this._checkInterval = null;
    this._blocklistInterval = null;
    this._maxEvents = 10000;

    this._blocklistUrls = [
      'https://feodotracker.abuse.ch/downloads/ipblocklist.txt',
      'https://sslbl.abuse.ch/blacklist/sslipblacklist.txt',
      'https://raw.githubusercontent.com/stamparm/ipsum/master/levels/3.txt',
    ];

    this._loadState();
  }

  // ── Lifecycle ──

  start() {
    if (this._running) return;
    this._running = true;
    console.log('[THREAT-INTEL] Starting threat intelligence feed');

    // Load persisted data
    this._loadState();

    // Refresh blocklists immediately, then every 30 min
    this._refreshBlocklists();
    this._blocklistInterval = setInterval(() => this._refreshBlocklists(), 1800000);

    // Main analysis loop every 30s
    this._checkInterval = setInterval(() => this._analyzeAll(), 30000);

    this.emit('started');
  }

  stop() {
    if (!this._running) return;
    this._running = false;
    if (this._checkInterval) { clearInterval(this._checkInterval); this._checkInterval = null; }
    if (this._blocklistInterval) { clearInterval(this._blocklistInterval); this._blocklistInterval = null; }
    this._saveState();
    console.log('[THREAT-INTEL] Stopped');
    this.emit('stopped');
  }

  // ── State Persistence ──

  _loadState() {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    } catch {}

    try {
      if (fs.existsSync(THREAT_LOG_PATH)) {
        const data = JSON.parse(fs.readFileSync(THREAT_LOG_PATH, 'utf8'));
        this._threats = Array.isArray(data) ? data : (data.events || []);
        this._activeThreats = this._threats.filter(t => !t.dismissed);
      }
    } catch (e) {
      console.error('[THREAT-INTEL] Failed to load threat log:', e.message);
      this._threats = [];
      this._activeThreats = [];
    }

    try {
      if (fs.existsSync(WHITELIST_PATH)) {
        this._whitelist = JSON.parse(fs.readFileSync(WHITELIST_PATH, 'utf8'));
      }
    } catch {
      this._whitelist = { ips: [], domains: [], processes: [] };
    }
  }

  _saveState() {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      // Trim to maxEvents
      if (this._threats.length > this._maxEvents) {
        this._threats = this._threats.slice(-this._maxEvents);
      }
      fs.writeFileSync(THREAT_LOG_PATH, JSON.stringify({
        lastUpdated: new Date().toISOString(),
        totalEvents: this._threats.length,
        activeCount: this._activeThreats.length,
        events: this._threats
      }, null, 2));
    } catch (e) {
      console.error('[THREAT-INTEL] Failed to save threat log:', e.message);
    }
  }

  _saveWhitelist() {
    try {
      fs.writeFileSync(WHITELIST_PATH, JSON.stringify(this._whitelist, null, 2));
    } catch {}
  }

  // ── Blocklist Management ──

  async _refreshBlocklists() {
    const allIPs = new Set();
    const results = await Promise.allSettled(
      this._blocklistUrls.map(url => fetchBlocklist(url))
    );
    for (const r of results) {
      if (r.status === 'fulfilled') {
        for (const ip of r.value) allIPs.add(ip);
      }
    }
    this._blocklists = allIPs;
    console.log(`[THREAT-INTEL] Loaded ${allIPs.size} IPs from blocklists`);
  }

  // ── Telemetry Ingestion (called by relay) ──

  /**
   * Process security telemetry reported by a worker.
   * @param {string} workerId 
   * @param {Object} telemetry - { connections: [{ip,port,proto}], dns: [domain], 
   *   cpu: number, processes: [name], fileHashes: {path:hash}, timestamp }
   */
  processTelemetry(workerId, telemetry) {
    if (!this._running) return;
    if (this._isolatedWorkers.has(workerId)) return; // already isolated

    const ts = telemetry.timestamp || Date.now();

    // 1. Check outbound connections
    if (telemetry.connections) {
      this._checkConnections(workerId, telemetry.connections, ts);
    }

    // 2. Check DNS queries
    if (telemetry.dns) {
      this._checkDNS(workerId, telemetry.dns, ts);
    }

    // 3. Check CPU patterns
    if (telemetry.cpu !== undefined) {
      this._checkCPU(workerId, telemetry.cpu, ts);
    }

    // 4. Check processes
    if (telemetry.processes) {
      this._checkProcesses(workerId, telemetry.processes, ts);
    }

    // 5. Check file integrity
    if (telemetry.fileHashes) {
      this._checkFileIntegrity(workerId, telemetry.fileHashes, ts);
    }

    // Update baseline
    this._updateBaseline(workerId, telemetry);
  }

  /**
   * Record a failed auth attempt (called by relay on 401).
   * @param {string} ip 
   * @param {string} detail 
   */
  recordFailedAuth(ip, detail = '') {
    if (!this._running) return;
    const entry = this._failedAuths.get(ip) || { count: 0, firstSeen: Date.now(), lastSeen: 0 };
    entry.count++;
    entry.lastSeen = Date.now();
    this._failedAuths.set(ip, entry);

    if (entry.count >= 10) {
      this._createThreat('CRITICAL', 'BRUTE_FORCE', ip, 
        `${entry.count} failed auth attempts from ${ip} since ${new Date(entry.firstSeen).toISOString()}. ${detail}`);
    } else if (entry.count >= 5) {
      this._createThreat('ALERT', 'FAILED_AUTH', ip,
        `${entry.count} failed auth attempts from ${ip}. ${detail}`);
    } else if (entry.count >= 3) {
      this._createThreat('WARN', 'FAILED_AUTH', ip,
        `${entry.count} failed auth attempts from ${ip}. ${detail}`);
    }
  }

  // ── Detection Rules ──

  _checkConnections(workerId, connections, ts) {
    for (const conn of connections) {
      const ip = conn.ip;
      if (!ip) continue;

      // Skip whitelisted
      if (this._whitelist.ips.includes(ip)) continue;
      // Skip private ranges
      if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|0\.)/.test(ip)) continue;

      // Check blocklists
      if (this._blocklists.has(ip)) {
        this._createThreat('CRITICAL', 'BLOCKLISTED_IP', workerId,
          `Connection to blocklisted IP ${ip}:${conn.port || '?'} (${conn.proto || 'tcp'})`);
        continue;
      }

      // Check IP reputation cache
      const cached = this._ipRepCache.get(ip);
      if (cached && cached.bad) {
        this._createThreat('ALERT', 'BAD_REPUTATION_IP', workerId,
          `Connection to bad-reputation IP ${ip} (source: ${cached.source})`);
        continue;
      }

      // Async reputation check for unknown IPs
      this._checkIPReputation(ip, workerId);
    }
  }

  _checkDNS(workerId, domains, ts) {
    for (const domain of domains) {
      if (!domain || typeof domain !== 'string') continue;
      const lowerDomain = domain.toLowerCase();

      // Skip whitelisted
      if (this._whitelist.domains.some(d => lowerDomain.endsWith(d))) continue;

      // Check known C2 domains
      for (const pattern of KNOWN_C2_DOMAINS) {
        if (pattern instanceof RegExp) {
          if (pattern.test(lowerDomain)) {
            this._createThreat('ALERT', 'SUSPICIOUS_DNS', workerId,
              `DNS query to suspicious domain: ${domain} (matched pattern)`);
            break;
          }
        } else if (lowerDomain.includes(pattern)) {
          this._createThreat('CRITICAL', 'C2_DOMAIN', workerId,
            `DNS query to known C2 domain: ${domain}`);
          break;
        }
      }

      // DGA detection
      if (isDGADomain(lowerDomain)) {
        this._createThreat('ALERT', 'DGA_DOMAIN', workerId,
          `DNS query to suspected DGA domain: ${domain} (high entropy, consonant-heavy)`);
      }
    }
  }

  _checkCPU(workerId, cpu, ts) {
    const baseline = this._workerBaselines.get(workerId);
    if (!baseline || !baseline.cpuHistory || baseline.cpuHistory.length < 5) return;

    const avg = baseline.cpuHistory.reduce((a, b) => a + b, 0) / baseline.cpuHistory.length;
    const stddev = Math.sqrt(baseline.cpuHistory.reduce((a, b) => a + (b - avg) ** 2, 0) / baseline.cpuHistory.length);

    // Sudden spike: >3 stddev above mean
    if (cpu > avg + 3 * stddev && cpu > 80) {
      this._createThreat('WARN', 'CPU_SPIKE', workerId,
        `CPU spike: ${cpu.toFixed(1)}% (baseline: ${avg.toFixed(1)}% ± ${stddev.toFixed(1)})`);
    }
    // Sudden drop: mining stopped unexpectedly?
    if (cpu < avg - 3 * stddev && avg > 50 && cpu < 10) {
      this._createThreat('WARN', 'CPU_DROP', workerId,
        `CPU drop: ${cpu.toFixed(1)}% (baseline: ${avg.toFixed(1)}% ± ${stddev.toFixed(1)}) — possible process kill`);
    }
  }

  _checkProcesses(workerId, processes, ts) {
    const baseline = this._workerBaselines.get(workerId);
    if (!baseline || !baseline.knownProcesses) {
      // First report — establish baseline
      return;
    }

    for (const proc of processes) {
      if (this._whitelist.processes.includes(proc)) continue;
      if (!baseline.knownProcesses.has(proc)) {
        // Suspicious process names
        const suspicious = /^(nc|ncat|netcat|socat|curl|wget|python|perl|ruby|bash|sh|cmd|powershell|mshta|wscript|cscript|certutil|bitsadmin)/i;
        const level = suspicious.test(proc) ? 'ALERT' : 'INFO';
        this._createThreat(level, 'NEW_PROCESS', workerId,
          `New process detected: "${proc}" (not in baseline)`);
      }
    }
  }

  _checkFileIntegrity(workerId, fileHashes, ts) {
    const baseline = this._workerBaselines.get(workerId);
    if (!baseline || !baseline.fileHashes) return;

    for (const [filePath, hash] of Object.entries(fileHashes)) {
      const prevHash = baseline.fileHashes[filePath];
      if (prevHash && prevHash !== hash) {
        this._createThreat('CRITICAL', 'FILE_INTEGRITY', workerId,
          `File modified: ${filePath} (was: ${prevHash.substring(0, 12)}... now: ${hash.substring(0, 12)}...)`);
      }
    }
  }

  _updateBaseline(workerId, telemetry) {
    let baseline = this._workerBaselines.get(workerId);
    if (!baseline) {
      baseline = { cpuHistory: [], knownProcesses: new Set(), fileHashes: {}, lastSeen: 0 };
      this._workerBaselines.set(workerId, baseline);
    }

    baseline.lastSeen = Date.now();

    if (telemetry.cpu !== undefined) {
      baseline.cpuHistory.push(telemetry.cpu);
      if (baseline.cpuHistory.length > 60) baseline.cpuHistory.shift(); // keep last 30min at 30s intervals
    }

    if (telemetry.processes) {
      // After 3 reports, lock in known processes
      if (!baseline._processReports) baseline._processReports = 0;
      baseline._processReports++;
      if (baseline._processReports <= 3) {
        for (const p of telemetry.processes) baseline.knownProcesses.add(p);
      }
    }

    if (telemetry.fileHashes) {
      if (!baseline._fileHashReports) baseline._fileHashReports = 0;
      baseline._fileHashReports++;
      if (baseline._fileHashReports <= 1) {
        // First report establishes baseline
        baseline.fileHashes = { ...telemetry.fileHashes };
      }
    }
  }

  // ── IP Reputation (async) ──

  async _checkIPReputation(ip, workerId) {
    const cached = this._ipRepCache.get(ip);
    if (cached) return;

    // Mark as checking to avoid duplicate requests
    this._ipRepCache.set(ip, false, 'pending');

    // Check against abuse.ch feodo tracker via blocklist (already loaded)
    if (this._blocklists.has(ip)) {
      this._ipRepCache.set(ip, true, 'abuse.ch-blocklist');
      this._createThreat('CRITICAL', 'BLOCKLISTED_IP', workerId,
        `Connection to blocklisted IP: ${ip}`);
    } else {
      this._ipRepCache.set(ip, false, 'clean');
    }
  }

  // ── Periodic Analysis ──

  _analyzeAll() {
    if (!this._running) return;

    // Check for stale workers (no telemetry in 5 min)
    const now = Date.now();
    for (const [workerId, baseline] of this._workerBaselines) {
      if (baseline.lastSeen && now - baseline.lastSeen > 300000) {
        this._createThreat('WARN', 'WORKER_SILENT', workerId,
          `Worker silent for ${Math.round((now - baseline.lastSeen) / 60000)} minutes — possible compromise or crash`);
      }
    }

    // Clean up old failed auth entries (>1h)
    for (const [ip, entry] of this._failedAuths) {
      if (now - entry.lastSeen > 3600000) this._failedAuths.delete(ip);
    }

    // Persist
    this._saveState();
  }

  // ── Threat Creation & Response ──

  _createThreat(level, type, workerId, detail) {
    // Dedup: don't create same threat within 5 minutes
    const dedupKey = `${level}:${type}:${workerId}:${detail}`;
    const recent = this._threats.find(t => 
      !t.dismissed && 
      t._dedupKey === dedupKey && 
      Date.now() - new Date(t.timestamp).getTime() < 300000
    );
    if (recent) return recent;

    const threat = {
      id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'),
      level,
      levelNum: THREAT_LEVELS[level],
      type,
      workerId,
      detail,
      timestamp: new Date().toISOString(),
      dismissed: false,
      dismissedAt: null,
      dismissedBy: null,
      autoResponse: null,
      _dedupKey: dedupKey,
    };

    this._threats.push(threat);
    this._activeThreats.push(threat);

    // Log
    const prefix = level === 'CRITICAL' ? '🚨' : level === 'ALERT' ? '⚠️' : level === 'WARN' ? '⚡' : 'ℹ️';
    console.log(`[THREAT-INTEL] ${prefix} ${level} | ${type} | worker=${workerId} | ${detail}`);

    // Emit event
    this.emit('threat', threat);

    // Logger integration
    if (this._refs.logger) {
      const logLevel = level === 'CRITICAL' ? 'fatal' : level === 'ALERT' ? 'error' : level === 'WARN' ? 'warn' : 'info';
      this._refs.logger[logLevel]?.(`[THREAT] ${level} ${type}: ${detail}`, 'threat-intel');
    }

    // Auto-response for CRITICAL
    if (level === 'CRITICAL') {
      this._autoRespond(threat);
    }

    // Alert for ALERT and CRITICAL
    if (THREAT_LEVELS[level] >= THREAT_LEVELS.ALERT) {
      this._sendAlert(threat);
    }

    return threat;
  }

  _autoRespond(threat) {
    // Isolate worker
    if (threat.workerId && threat.workerId !== 'system') {
      this._isolateWorker(threat.workerId, threat.detail);
      threat.autoResponse = `Worker ${threat.workerId} isolated`;
    }
  }

  _isolateWorker(workerId, reason) {
    this._isolatedWorkers.add(workerId);
    console.log(`[THREAT-INTEL] 🔒 ISOLATED worker ${workerId}: ${reason}`);

    this.emit('worker-isolated', { workerId, reason });

    // Notify relay to block this worker
    if (this._refs.relay && typeof this._refs.relay.blockWorker === 'function') {
      this._refs.relay.blockWorker(workerId, reason);
    }

    // If swarm manager exists, mark worker as compromised
    if (this._refs.swarmManager && typeof this._refs.swarmManager.markCompromised === 'function') {
      this._refs.swarmManager.markCompromised(workerId, reason);
    }
  }

  // ── Alerting ──

  _sendAlert(threat) {
    const msg = `🛡️ *ARIES Threat Intel*\n` +
      `*Level:* ${threat.level}\n` +
      `*Type:* ${threat.type}\n` +
      `*Worker:* ${threat.workerId}\n` +
      `*Detail:* ${threat.detail}\n` +
      `*Time:* ${threat.timestamp}`;

    // Telegram alert
    this._sendTelegram(msg);

    // Master Control notification
    if (this._refs.events && typeof this._refs.events.emit === 'function') {
      this._refs.events.emit('threat-alert', threat);
    }
  }

  _sendTelegram(text) {
    try {
      const cfg = this._getConfig();
      if (!cfg.botToken || !cfg.chatId) return;

      const payload = JSON.stringify({
        chat_id: cfg.chatId,
        text,
        parse_mode: 'Markdown',
      });

      const req = https.request({
        hostname: 'api.telegram.org',
        path: `/bot${cfg.botToken}/sendMessage`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        timeout: 10000,
      });
      req.on('error', () => {});
      req.write(payload);
      req.end();
    } catch {}
  }

  _getConfig() {
    try {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      return {
        botToken: cfg.miner?.telegram?.botToken || cfg.telegram?.botToken || '',
        chatId: cfg.miner?.telegram?.chatId || cfg.telegram?.chatId || '',
      };
    } catch {
      return { botToken: '', chatId: '' };
    }
  }

  // ── API Methods (for api-server integration) ──

  /**
   * Register API routes on an existing HTTP server or router.
   * @param {Function} addRoute - function(method, path, handler)
   *   handler receives (req, res, params) and should return response data
   */
  registerAPI(addRoute) {
    // GET /api/manage/threats — all threats with pagination
    addRoute('GET', '/api/manage/threats', (req, res, params) => {
      const url = new URL(req.url, 'http://localhost');
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 500);
      const offset = parseInt(url.searchParams.get('offset') || '0');
      const level = url.searchParams.get('level');

      let filtered = this._threats;
      if (level) filtered = filtered.filter(t => t.level === level.toUpperCase());

      return {
        total: filtered.length,
        offset,
        limit,
        events: filtered.slice(-limit - offset, filtered.length - offset || undefined).reverse(),
        summary: this._getSummary(),
      };
    });

    // GET /api/manage/threats/active — active (non-dismissed) threats
    addRoute('GET', '/api/manage/threats/active', () => {
      return {
        count: this._activeThreats.length,
        events: this._activeThreats.slice().reverse(),
        isolatedWorkers: [...this._isolatedWorkers],
        summary: this._getSummary(),
      };
    });

    // POST /api/manage/threats/whitelist — add to whitelist
    addRoute('POST', '/api/manage/threats/whitelist', async (req) => {
      const body = await this._readBody(req);
      if (body.ip) {
        if (!this._whitelist.ips.includes(body.ip)) this._whitelist.ips.push(body.ip);
      }
      if (body.domain) {
        if (!this._whitelist.domains.includes(body.domain)) this._whitelist.domains.push(body.domain);
      }
      if (body.process) {
        if (!this._whitelist.processes.includes(body.process)) this._whitelist.processes.push(body.process);
      }
      this._saveWhitelist();
      return { ok: true, whitelist: this._whitelist };
    });

    // POST /api/manage/threats/dismiss/:id — dismiss a threat
    addRoute('POST', '/api/manage/threats/dismiss/:id', (req, res, params) => {
      const id = params.id;
      const threat = this._threats.find(t => t.id === id);
      if (!threat) return { error: 'Threat not found', status: 404 };

      threat.dismissed = true;
      threat.dismissedAt = new Date().toISOString();
      threat.dismissedBy = 'operator';
      this._activeThreats = this._activeThreats.filter(t => t.id !== id);
      this._saveState();

      return { ok: true, threat };
    });

    // GET /api/manage/threats/summary — dashboard summary
    addRoute('GET', '/api/manage/threats/summary', () => {
      return this._getSummary();
    });

    // POST /api/manage/threats/unisolate/:workerId — un-isolate a worker
    addRoute('POST', '/api/manage/threats/unisolate/:workerId', (req, res, params) => {
      const wid = params.workerId;
      this._isolatedWorkers.delete(wid);
      if (this._refs.relay && typeof this._refs.relay.unblockWorker === 'function') {
        this._refs.relay.unblockWorker(wid);
      }
      return { ok: true, isolatedWorkers: [...this._isolatedWorkers] };
    });
  }

  /**
   * Handle API requests directly (for standalone HTTP server integration).
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   * @returns {boolean} true if handled
   */
  handleRequest(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    const method = req.method;

    const send = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(data));
    };

    if (method === 'GET' && p === '/api/manage/threats') {
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 500);
      const offset = parseInt(url.searchParams.get('offset') || '0');
      const level = url.searchParams.get('level');
      let filtered = this._threats;
      if (level) filtered = filtered.filter(t => t.level === level.toUpperCase());
      send(200, {
        total: filtered.length, offset, limit,
        events: filtered.slice(Math.max(0, filtered.length - limit - offset), filtered.length - offset || undefined).reverse(),
        summary: this._getSummary(),
      });
      return true;
    }

    if (method === 'GET' && p === '/api/manage/threats/active') {
      send(200, {
        count: this._activeThreats.length,
        events: this._activeThreats.slice().reverse(),
        isolatedWorkers: [...this._isolatedWorkers],
        summary: this._getSummary(),
      });
      return true;
    }

    if (method === 'GET' && p === '/api/manage/threats/summary') {
      send(200, this._getSummary());
      return true;
    }

    if (method === 'POST' && p === '/api/manage/threats/whitelist') {
      this._readBody(req).then(body => {
        if (body.ip && !this._whitelist.ips.includes(body.ip)) this._whitelist.ips.push(body.ip);
        if (body.domain && !this._whitelist.domains.includes(body.domain)) this._whitelist.domains.push(body.domain);
        if (body.process && !this._whitelist.processes.includes(body.process)) this._whitelist.processes.push(body.process);
        this._saveWhitelist();
        send(200, { ok: true, whitelist: this._whitelist });
      }).catch(() => send(400, { error: 'Invalid JSON' }));
      return true;
    }

    const dismissMatch = p.match(/^\/api\/manage\/threats\/dismiss\/(.+)$/);
    if (method === 'POST' && dismissMatch) {
      const id = dismissMatch[1];
      const threat = this._threats.find(t => t.id === id);
      if (!threat) { send(404, { error: 'Threat not found' }); return true; }
      threat.dismissed = true;
      threat.dismissedAt = new Date().toISOString();
      threat.dismissedBy = 'operator';
      this._activeThreats = this._activeThreats.filter(t => t.id !== id);
      this._saveState();
      send(200, { ok: true, threat });
      return true;
    }

    const unisolateMatch = p.match(/^\/api\/manage\/threats\/unisolate\/(.+)$/);
    if (method === 'POST' && unisolateMatch) {
      const wid = unisolateMatch[1];
      this._isolatedWorkers.delete(wid);
      send(200, { ok: true, isolatedWorkers: [...this._isolatedWorkers] });
      return true;
    }

    return false;
  }

  // ── Dashboard Data ──

  _getSummary() {
    const now = Date.now();
    const last24h = this._threats.filter(t => now - new Date(t.timestamp).getTime() < 86400000);
    const byLevel = { INFO: 0, WARN: 0, ALERT: 0, CRITICAL: 0 };
    const byType = {};
    for (const t of last24h) {
      byLevel[t.level] = (byLevel[t.level] || 0) + 1;
      byType[t.type] = (byType[t.type] || 0) + 1;
    }

    return {
      timestamp: new Date().toISOString(),
      active: this._activeThreats.length,
      total: this._threats.length,
      last24h: last24h.length,
      byLevel,
      byType,
      isolatedWorkers: [...this._isolatedWorkers],
      blocklistSize: this._blocklists.size,
      whitelistSize: this._whitelist.ips.length + this._whitelist.domains.length + this._whitelist.processes.length,
      topThreats: this._activeThreats.slice(-5).reverse().map(t => ({
        id: t.id, level: t.level, type: t.type, workerId: t.workerId,
        detail: t.detail.substring(0, 120), timestamp: t.timestamp,
      })),
    };
  }

  // ── Utility ──

  _readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch (e) { reject(e); }
      });
      req.on('error', reject);
    });
  }

  // ── Public Getters ──

  get threats() { return this._threats; }
  get activeThreats() { return this._activeThreats; }
  get isolatedWorkers() { return [...this._isolatedWorkers]; }
  get whitelist() { return this._whitelist; }
  get isRunning() { return this._running; }
}

module.exports = ThreatIntel;
