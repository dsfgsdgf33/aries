/**
 * ARIES v5.0 — Swarm Health Monitor
 * Real-time health checks for all swarm nodes (local, GCP, Vultr).
 * Uses only Node.js built-in modules.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

const DATA_DIR = path.join(__dirname, '..', 'data');
const HEALTH_FILE = path.join(DATA_DIR, 'swarm-health.json');

class SwarmHealth extends EventEmitter {
  /**
   * @param {object} config - Full app config
   */
  constructor(config = {}) {
    super();
    this.config = config;
    this.checkIntervalMs = 60000;
    this._timer = null;
    this._nodes = {};
    this._taskStats = { total: 0, completed: 0, failed: 0, byPool: {} };
    this._healthHistory = [];

    // Build node list from config
    this._buildNodeList();
    this._loadHealth();
  }

  _ensureDir() {
    try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) { /* ignore */ }
  }

  _buildNodeList() {
    try {
      // Local node
      this._nodes['local'] = {
        id: 'local', name: 'Local', type: 'local', ip: '127.0.0.1', port: 9700,
        workers: (this.config.swarm && this.config.swarm.maxWorkers) || 20,
        status: 'online', lastPing: null, responseTimeMs: 0,
        successRate: 100, history: [], priority: 1
      };

      // GCP relay
      var gcpCfg = this.config.relayGcp || {};
      if (gcpCfg.vmIp || gcpCfg.url) {
        var gcpIp = gcpCfg.vmIp || 'YOUR-GCP-IP';
        this._nodes['gcp'] = {
          id: 'gcp', name: 'GCP ' + (gcpCfg.gcpZone || 'us-central1'), type: 'gcp',
          ip: gcpIp, port: gcpCfg.port || 9700,
          workers: gcpCfg.workers || 4,
          status: 'unknown', lastPing: null, responseTimeMs: 0,
          successRate: 100, history: [], priority: 2
        };
      }

      // Vultr relay
      var relayCfg = this.config.relay || {};
      var vultrNodes = this.config.vultrNodes || {};
      var vultrKey = Object.keys(vultrNodes)[0];
      if (vultrKey || relayCfg.vmIp) {
        var vultrCfg = vultrNodes[vultrKey] || {};
        var vultrIp = vultrCfg.ip || relayCfg.vmIp || '127.0.0.1';
        this._nodes['vultr'] = {
          id: 'vultr', name: 'Vultr ' + (vultrCfg.region || 'dallas'), type: 'vultr',
          ip: vultrIp, port: relayCfg.port || 9700,
          workers: vultrCfg.workers || relayCfg.workers || 12,
          status: 'unknown', lastPing: null, responseTimeMs: 0,
          successRate: 100, history: [], priority: 3
        };
      }
    } catch (e) { /* ignore */ }
  }

  _loadHealth() {
    try {
      if (fs.existsSync(HEALTH_FILE)) {
        var saved = JSON.parse(fs.readFileSync(HEALTH_FILE, 'utf8'));
        if (saved.taskStats) this._taskStats = saved.taskStats;
        if (saved.healthHistory) this._healthHistory = saved.healthHistory.slice(-500);
      }
    } catch (e) { /* ignore */ }
  }

  _saveHealth() {
    try {
      this._ensureDir();
      fs.writeFileSync(HEALTH_FILE, JSON.stringify({
        taskStats: this._taskStats,
        healthHistory: this._healthHistory.slice(-500),
        lastSave: new Date().toISOString()
      }, null, 2));
    } catch (e) { /* ignore */ }
  }

  /**
   * Ping a remote relay node
   * @param {object} node
   * @returns {Promise<{online: boolean, responseTimeMs: number, workers: object}>}
   */
  _pingNode(node) {
    var self = this;
    return new Promise(function(resolve) {
      if (node.type === 'local') {
        resolve({ online: true, responseTimeMs: 0, workers: {} });
        return;
      }

      var startMs = Date.now();
      try {
        var req = http.request({
          hostname: node.ip,
          port: node.port,
          path: '/api/status',
          method: 'GET',
          headers: { 'X-Aries-Secret': (self.config.remoteWorkers && self.config.remoteWorkers.secret) || '' },
          timeout: 10000
        }, function(res) {
          var data = '';
          res.on('data', function(c) { data += c; });
          res.on('end', function() {
            var elapsed = Date.now() - startMs;
            var json = null;
            try { json = JSON.parse(data); } catch (e) { /* not json */ }
            resolve({ online: res.statusCode < 400, responseTimeMs: elapsed, workers: json || {} });
          });
        });
        req.on('error', function() { resolve({ online: false, responseTimeMs: Date.now() - startMs, workers: {} }); });
        req.on('timeout', function() { req.destroy(); resolve({ online: false, responseTimeMs: Date.now() - startMs, workers: {} }); });
        req.end();
      } catch (e) {
        resolve({ online: false, responseTimeMs: Date.now() - startMs, workers: {} });
      }
    });
  }

  /**
   * Run health checks on all nodes
   * @returns {Promise<object>}
   */
  async checkAll() {
    var results = {};
    var nodeIds = Object.keys(this._nodes);

    for (var i = 0; i < nodeIds.length; i++) {
      var nodeId = nodeIds[i];
      var node = this._nodes[nodeId];
      try {
        var pingResult = await this._pingNode(node);
        node.lastPing = new Date().toISOString();
        node.responseTimeMs = pingResult.responseTimeMs;

        if (pingResult.online) {
          node.status = pingResult.responseTimeMs > 5000 ? 'degraded' : 'online';
        } else {
          node.status = 'offline';
        }

        // Track history
        node.history.push({ time: node.lastPing, status: node.status, ms: node.responseTimeMs });
        if (node.history.length > 60) node.history.shift();

        // Calculate success rate from history
        var successes = node.history.filter(function(h) { return h.status !== 'offline'; }).length;
        node.successRate = node.history.length > 0 ? Math.round((successes / node.history.length) * 100) : 100;

        results[nodeId] = { status: node.status, responseTimeMs: node.responseTimeMs, successRate: node.successRate };
      } catch (e) {
        node.status = 'offline';
        results[nodeId] = { status: 'offline', error: e.message };
      }
    }

    this._healthHistory.push({ timestamp: new Date().toISOString(), results: results });
    if (this._healthHistory.length > 500) this._healthHistory.shift();
    this._saveHealth();

    this.emit('health-check', results);
    return results;
  }

  /**
   * Get full health report
   * @returns {object}
   */
  getHealthReport() {
    var nodes = {};
    var nodeIds = Object.keys(this._nodes);
    for (var i = 0; i < nodeIds.length; i++) {
      var n = this._nodes[nodeIds[i]];
      nodes[nodeIds[i]] = {
        name: n.name, type: n.type, ip: n.ip, port: n.port,
        workers: n.workers, status: n.status, lastPing: n.lastPing,
        responseTimeMs: n.responseTimeMs, successRate: n.successRate,
        recentHistory: n.history.slice(-10)
      };
    }
    return {
      nodes: nodes,
      taskStats: this._taskStats,
      summary: {
        totalNodes: nodeIds.length,
        onlineNodes: nodeIds.filter(function(id) { return this._nodes[id].status === 'online'; }.bind(this)).length,
        degradedNodes: nodeIds.filter(function(id) { return this._nodes[id].status === 'degraded'; }.bind(this)).length,
        offlineNodes: nodeIds.filter(function(id) { return this._nodes[id].status === 'offline'; }.bind(this)).length
      }
    };
  }

  /**
   * Get healthy pools in priority order for task redistribution
   * @returns {Array<string>}
   */
  getHealthyPools() {
    var self = this;
    return Object.keys(self._nodes)
      .filter(function(id) { return self._nodes[id].status !== 'offline'; })
      .sort(function(a, b) { return (self._nodes[a].priority || 99) - (self._nodes[b].priority || 99); });
  }

  /**
   * Record a task completion
   * @param {string} pool
   * @param {boolean} success
   */
  recordTask(pool, success) {
    try {
      this._taskStats.total++;
      if (success) { this._taskStats.completed++; } else { this._taskStats.failed++; }
      if (!this._taskStats.byPool[pool]) this._taskStats.byPool[pool] = { total: 0, completed: 0, failed: 0 };
      this._taskStats.byPool[pool].total++;
      if (success) { this._taskStats.byPool[pool].completed++; } else { this._taskStats.byPool[pool].failed++; }
    } catch (e) { /* ignore */ }
  }

  /**
   * Start periodic health checks
   */
  start() {
    var self = this;
    if (self._timer) return;
    self.checkAll().catch(function() {});
    self._timer = setInterval(function() {
      self.checkAll().catch(function() {});
    }, self.checkIntervalMs);
  }

  /**
   * Stop health checks
   */
  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._saveHealth();
  }
}

module.exports = { SwarmHealth };
