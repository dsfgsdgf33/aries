/**
 * ARIES — Model Sharing (P2P via Relay)
 * 
 * Distributes Ollama models across swarm workers using the relay as intermediary.
 * Workers report installedModels in heartbeat. Share triggers chunked transfer via relay.
 */

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function _getRelayConfig() {
  var usbDir = path.join(__dirname, '..', 'usb-swarm');
  var usbCfg = {};
  try { usbCfg = JSON.parse(fs.readFileSync(path.join(usbDir, 'config.json'), 'utf8')); } catch (e) {}
  var mainCfg = {};
  try { mainCfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8')); } catch (e) {}
  var relayUrl = usbCfg.swarmRelayUrl || (mainCfg.relay ? mainCfg.relay.url : '') || 'https://gateway.doomtrader.com:9700';
  var secret = usbCfg.swarmSecret || (mainCfg.remoteWorkers ? mainCfg.remoteWorkers.secret : '') || (mainCfg.relay ? mainCfg.relay.secret : '') || '';
  return { relayUrl: relayUrl, secret: secret };
}

function _relayRequest(urlStr, method, body, timeout) {
  timeout = timeout || 30000;
  return new Promise(function(resolve, reject) {
    var cfg = _getRelayConfig();
    var u = new (require('url').URL)(urlStr.startsWith('http') ? urlStr : cfg.relayUrl + urlStr);
    var mod = u.protocol === 'https:' ? https : http;
    var req = mod.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      method: method || 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Aries-Secret': cfg.secret, 'Authorization': 'Bearer ' + cfg.secret },
      timeout: timeout, rejectUnauthorized: false
    }, function(res) {
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() {
        var raw = Buffer.concat(chunks).toString();
        try { resolve(JSON.parse(raw)); } catch (e) { resolve({ raw: raw, status: res.statusCode }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', function() { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

/**
 * Get model matrix — which worker has which models
 */
async function getModelMatrix() {
  var data = await _relayRequest('/api/status', 'GET');
  var workers = data.workers || {};
  var now = Date.now();
  var matrix = {};
  var allModels = {};

  for (var id in workers) {
    var w = workers[id];
    var online = (now - (w.timestamp || 0)) < 60000;
    var models = w.installedModels || [];
    if (w.model && models.indexOf(w.model) === -1) models.push(w.model);
    matrix[id] = { hostname: w.hostname || id, online: online, models: models, gpu: w.gpu || 'none', ram_gb: w.ram_gb || 0 };
    for (var i = 0; i < models.length; i++) {
      if (!allModels[models[i]]) allModels[models[i]] = [];
      allModels[models[i]].push(id);
    }
  }

  return { workers: matrix, models: allModels };
}

/**
 * Initiate model share — sends model-share task to source worker via relay broadcast
 */
async function shareModel(model, fromWorker, toWorkers) {
  if (!model || !fromWorker || !toWorkers || toWorkers.length === 0) {
    throw new Error('model, fromWorker, and toWorkers are required');
  }

  var shareId = crypto.randomUUID();
  var cfg = _getRelayConfig();

  // Send model-share task to source worker
  await _relayRequest('/api/swarm/broadcast', 'POST', {
    type: 'model-share',
    shareId: shareId,
    model: model,
    fromWorker: fromWorker,
    toWorkers: toWorkers,
    relayUrl: cfg.relayUrl,
    targetWorker: fromWorker
  });

  return { shareId: shareId, model: model, from: fromWorker, to: toWorkers, status: 'initiated' };
}

module.exports = { getModelMatrix: getModelMatrix, shareModel: shareModel };
