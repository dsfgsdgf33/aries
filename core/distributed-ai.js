/**
 * ARIES — Distributed AI Task Processing
 * 
 * Splits large prompts across multiple Ollama workers for parallel processing.
 * Strategies: split, ensemble, chain
 * Uses the swarm relay at gateway.doomtrader.com:9700
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
 * Get online workers from relay
 */
async function getOnlineWorkers() {
  var data = await _relayRequest('/api/status', 'GET');
  var workers = data.workers || {};
  var now = Date.now();
  var online = [];
  for (var id in workers) {
    var w = workers[id];
    if (now - (w.timestamp || 0) < 60000 && w.status !== 'offline') {
      online.push({ id: id, hostname: w.hostname || id, model: w.model || '', gpu: w.gpu || 'none', ram_gb: w.ram_gb || 0, installedModels: w.installedModels || [] });
    }
  }
  return online;
}

/**
 * Submit a task to a specific worker via relay and wait for result
 */
async function submitAndWait(prompt, workerId, options, timeoutMs) {
  options = options || {};
  timeoutMs = timeoutMs || 300000;
  var taskId = crypto.randomUUID();
  var taskBody = {
    id: taskId,
    prompt: prompt,
    model: options.model || undefined,
    systemPrompt: options.systemPrompt || '',
    maxTokens: options.maxTokens || 2048,
    meta: { targetWorker: workerId, strategy: options.strategy || 'distributed' }
  };

  // Submit via relay task endpoint
  await _relayRequest('/api/task', 'POST', taskBody);

  // Poll for result
  var start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise(function(r) { setTimeout(r, 2000); });
    try {
      var result = await _relayRequest('/api/result/' + taskId, 'GET');
      if (result && result.result) return { taskId: taskId, worker: workerId, result: result.result, duration_ms: Date.now() - start };
      if (result && result.error) return { taskId: taskId, worker: workerId, error: result.error, duration_ms: Date.now() - start };
      // 202 = still processing, continue polling
    } catch (e) { /* keep polling */ }
  }
  return { taskId: taskId, worker: workerId, error: 'timeout', duration_ms: timeoutMs };
}

/**
 * Split strategy — break prompt into chunks, process in parallel
 */
async function executeSplit(prompt, workers, options, onProgress) {
  var sentences = prompt.replace(/([.!?])\s+/g, '$1\n').split('\n').filter(function(s) { return s.trim(); });
  var chunkCount = Math.min(workers.length, sentences.length);
  if (chunkCount < 1) chunkCount = 1;
  var chunkSize = Math.ceil(sentences.length / chunkCount);
  var chunks = [];
  for (var i = 0; i < sentences.length; i += chunkSize) {
    chunks.push(sentences.slice(i, i + chunkSize).join(' '));
  }

  onProgress({ phase: 'splitting', chunks: chunks.length, workers: workers.length });

  var promises = [];
  for (var j = 0; j < chunks.length; j++) {
    var w = workers[j % workers.length];
    var chunkPrompt = (options.systemPrompt || 'Process this section and provide a clear response:') + '\n\n' + chunks[j];
    onProgress({ phase: 'dispatching', chunk: j + 1, worker: w.id });
    promises.push(submitAndWait(chunkPrompt, w.id, options));
  }

  var results = await Promise.all(promises);
  onProgress({ phase: 'combining', results: results.length });

  var combined = results.map(function(r, idx) {
    if (r.error) return '[Chunk ' + (idx + 1) + ' failed: ' + r.error + ']';
    var text = '';
    if (r.result && r.result.response) text = r.result.response;
    else if (r.result && r.result.message && r.result.message.content) text = r.result.message.content;
    else text = JSON.stringify(r.result);
    return text;
  }).join('\n\n');

  return { strategy: 'split', combined: combined, results: results, chunks: chunks.length };
}

/**
 * Ensemble strategy — same prompt to multiple workers, merge results
 */
async function executeEnsemble(prompt, workers, options, onProgress) {
  onProgress({ phase: 'dispatching', workers: workers.length });

  var promises = [];
  for (var i = 0; i < workers.length; i++) {
    var w = workers[i];
    onProgress({ phase: 'sending', worker: w.id, model: w.model });
    promises.push(submitAndWait(prompt, w.id, { model: options.model || w.model, systemPrompt: options.systemPrompt, maxTokens: options.maxTokens }));
  }

  var results = await Promise.all(promises);
  onProgress({ phase: 'merging', results: results.length });

  var responses = [];
  for (var j = 0; j < results.length; j++) {
    var r = results[j];
    if (r.error) continue;
    var text = '';
    if (r.result && r.result.response) text = r.result.response;
    else if (r.result && r.result.message && r.result.message.content) text = r.result.message.content;
    else text = JSON.stringify(r.result);
    responses.push({ worker: r.worker, text: text, duration_ms: r.duration_ms });
  }

  // Pick longest response as "best" (simple heuristic)
  var best = '';
  var bestLen = 0;
  for (var k = 0; k < responses.length; k++) {
    if (responses[k].text.length > bestLen) { best = responses[k].text; bestLen = responses[k].text.length; }
  }

  return { strategy: 'ensemble', best: best, allResponses: responses, workerCount: workers.length };
}

/**
 * Chain strategy — sequential refinement: draft → refine → polish
 */
async function executeChain(prompt, workers, options, onProgress) {
  var stages = ['Draft a detailed response to the following', 'Refine and improve the following draft. Fix errors, add detail, improve clarity', 'Polish this text for final delivery. Ensure it is well-structured, clear, and complete'];
  var current = prompt;

  var chainResults = [];
  for (var i = 0; i < Math.min(stages.length, workers.length); i++) {
    var w = workers[i];
    var stagePrompt = stages[i] + ':\n\n' + current;
    onProgress({ phase: 'chain-stage', stage: i + 1, stageName: ['draft', 'refine', 'polish'][i], worker: w.id });

    var result = await submitAndWait(stagePrompt, w.id, options);
    var text = '';
    if (result.error) {
      onProgress({ phase: 'chain-error', stage: i + 1, error: result.error });
      break;
    }
    if (result.result && result.result.response) text = result.result.response;
    else if (result.result && result.result.message && result.result.message.content) text = result.result.message.content;
    else text = JSON.stringify(result.result);

    chainResults.push({ stage: i + 1, worker: w.id, text: text, duration_ms: result.duration_ms });
    current = text;
  }

  return { strategy: 'chain', final: current, stages: chainResults };
}

/**
 * Main distributed execution
 */
async function execute(prompt, strategy, options, onProgress) {
  strategy = strategy || 'split';
  options = options || {};
  onProgress = onProgress || function() {};

  onProgress({ phase: 'init', strategy: strategy });

  var workers = await getOnlineWorkers();
  if (workers.length === 0) throw new Error('No online workers available');

  onProgress({ phase: 'workers-found', count: workers.length, workers: workers.map(function(w) { return w.id; }) });

  switch (strategy) {
    case 'split': return await executeSplit(prompt, workers, options, onProgress);
    case 'ensemble': return await executeEnsemble(prompt, workers, options, onProgress);
    case 'chain': return await executeChain(prompt, workers, options, onProgress);
    default: throw new Error('Unknown strategy: ' + strategy);
  }
}

module.exports = { execute: execute, getOnlineWorkers: getOnlineWorkers, submitAndWait: submitAndWait };
