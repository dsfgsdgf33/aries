/**
 * ARIES — Worker Health Dashboard (Grafana-style)
 * Collects and stores worker metrics over time.
 * 7-day rolling window, 5-min intervals.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const METRICS_FILE = path.join(__dirname, '..', 'data', 'worker-metrics.json');
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
const FIVE_MIN = 5 * 60 * 1000;

let _collectInterval = null;
let _refs = {};

function _loadMetrics() {
  try { return JSON.parse(fs.readFileSync(METRICS_FILE, 'utf8')); } catch (e) { return {}; }
}

function _saveMetrics(data) {
  var dir = path.dirname(METRICS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(METRICS_FILE, JSON.stringify(data));
}

function _getRelayConfig() {
  var mainCfg = {};
  try { mainCfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8')); } catch (e) {}
  var usbCfg = {};
  try { usbCfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'usb-swarm', 'config.json'), 'utf8')); } catch (e) {}
  var relayUrl = usbCfg.swarmRelayUrl || (mainCfg.relay ? mainCfg.relay.url : '') || '';
  var secret = usbCfg.swarmSecret || (mainCfg.remoteWorkers ? mainCfg.remoteWorkers.secret : '') || (mainCfg.relay ? mainCfg.relay.secret : '') || '';
  return { relayUrl, secret };
}

function _relayGet(urlPath, timeout) {
  timeout = timeout || 10000;
  return new Promise(function (resolve, reject) {
    var cfg = _getRelayConfig();
    if (!cfg.relayUrl) return resolve(null);
    var u = new (require('url').URL)(cfg.relayUrl + urlPath);
    var mod = u.protocol === 'https:' ? https : http;
    var req = mod.request({
      hostname: u.hostname, port: u.port, path: u.pathname,
      method: 'GET',
      headers: { 'X-Aries-Secret': cfg.secret, 'Authorization': 'Bearer ' + cfg.secret },
      timeout: timeout, rejectUnauthorized: false
    }, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (e) { resolve(null); }
      });
    });
    req.on('error', function () { resolve(null); });
    req.on('timeout', function () { req.destroy(); resolve(null); });
    req.end();
  });
}

/**
 * Collect current metrics from relay and miner state
 */
async function collectMetrics() {
  var metrics = _loadMetrics();
  var now = Date.now();
  var cutoff = now - SEVEN_DAYS;

  // Prune old data
  for (var wId in metrics) {
    if (!Array.isArray(metrics[wId])) { delete metrics[wId]; continue; }
    metrics[wId] = metrics[wId].filter(function (m) { return m.t > cutoff; });
    if (metrics[wId].length === 0) delete metrics[wId];
  }

  // Get relay status
  var relayData = await _relayGet('/api/status');
  var workers = (relayData && relayData.workers) ? relayData.workers : {};

  // Get miner state if available
  var minerState = _refs._minerState || {};
  var minerNodes = minerState.nodes || {};

  for (var id in workers) {
    var w = workers[id];
    var isOnline = (now - (w.timestamp || 0)) < 60000;
    var minerNode = minerNodes[id] || minerNodes[w.hostname] || {};
    var load = w.load || {};

    var point = {
      t: now,
      hashrate: minerNode.hashrate || 0,
      cpu: load.cpu || 0,
      ram: load.ram || 0,
      uptime: w.uptime || 0,
      shares: minerNode.shares || 0,
      status: isOnline ? (minerNode.status || 'online') : 'offline'
    };

    if (!metrics[id]) metrics[id] = [];
    metrics[id].push(point);
  }

  _saveMetrics(metrics);
  return metrics;
}

/**
 * Calculate per-worker stats
 */
function _workerStats(points) {
  if (!points || !points.length) return { uptimePct: 0, avgHashrate: 0, reliability: 0 };
  var onlineCount = points.filter(function (p) { return p.status !== 'offline'; }).length;
  var uptimePct = (onlineCount / points.length) * 100;
  var totalHash = 0;
  var hashPoints = 0;
  for (var p of points) {
    if (p.hashrate > 0) { totalHash += p.hashrate; hashPoints++; }
  }
  var avgHashrate = hashPoints > 0 ? totalHash / hashPoints : 0;
  // Reliability: weighted avg of uptime SLA and consistent hashrate
  var reliability = (uptimePct * 0.7 + Math.min(100, avgHashrate > 0 ? 100 : 0) * 0.3);
  return { uptimePct: Math.round(uptimePct * 100) / 100, avgHashrate: Math.round(avgHashrate * 100) / 100, reliability: Math.round(reliability * 100) / 100 };
}

/**
 * GET /api/health/workers — all workers with metrics
 */
function getAllWorkers() {
  var metrics = _loadMetrics();
  var result = {};
  for (var wId in metrics) {
    var points = metrics[wId];
    var stats = _workerStats(points);
    var last = points.length > 0 ? points[points.length - 1] : {};
    // Last 24h for sparkline (288 points at 5min intervals)
    var day = Date.now() - 24 * 60 * 60 * 1000;
    var last24h = points.filter(function (p) { return p.t > day; }).map(function (p) { return { t: p.t, hashrate: p.hashrate, status: p.status }; });
    result[wId] = { current: last, stats: stats, history24h: last24h, totalPoints: points.length };
  }
  return result;
}

/**
 * GET /api/health/worker/:id — detailed metrics for one worker
 */
function getWorker(id) {
  var metrics = _loadMetrics();
  var points = metrics[id];
  if (!points) return null;
  var stats = _workerStats(points);
  return { id: id, stats: stats, history: points, current: points[points.length - 1] || {} };
}

/**
 * GET /api/health/overview — fleet-wide stats
 */
function getOverview() {
  var metrics = _loadMetrics();
  var workerIds = Object.keys(metrics);
  if (workerIds.length === 0) return { totalWorkers: 0, fleetUptimePct: 0, avgHashrate: 0, worstPerformer: null };

  var totalUptime = 0;
  var totalHash = 0;
  var worst = { id: null, uptimePct: 100 };
  var workerStats = {};

  for (var id of workerIds) {
    var stats = _workerStats(metrics[id]);
    workerStats[id] = stats;
    totalUptime += stats.uptimePct;
    totalHash += stats.avgHashrate;
    if (stats.uptimePct < worst.uptimePct) { worst = { id: id, uptimePct: stats.uptimePct }; }
  }

  return {
    totalWorkers: workerIds.length,
    fleetUptimePct: Math.round((totalUptime / workerIds.length) * 100) / 100,
    avgHashrate: Math.round((totalHash / workerIds.length) * 100) / 100,
    worstPerformer: worst.id ? worst : null,
    workers: workerStats
  };
}

/**
 * Start periodic collection (every 5 min)
 */
function startCollecting(refs) {
  _refs = refs || {};
  if (_collectInterval) clearInterval(_collectInterval);
  // Collect immediately, then every 5 min
  collectMetrics().catch(function () {});
  _collectInterval = setInterval(function () {
    collectMetrics().catch(function () {});
  }, FIVE_MIN);
}

function stopCollecting() {
  if (_collectInterval) { clearInterval(_collectInterval); _collectInterval = null; }
}

module.exports = { startCollecting, stopCollecting, collectMetrics, getAllWorkers, getWorker, getOverview };
