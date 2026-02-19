/**
 * ARIES v5.0 — Task Marketplace
 * External users submit AI tasks, pay in SOL, tasks routed to swarm workers.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_FILE = path.join(__dirname, '..', 'data', 'marketplace.json');

const PRICING = {
  'gpt-4': 0.003,
  'gpt-3.5-turbo': 0.001,
  'claude-3': 0.002,
  'llama-3': 0.0005,
  'mixtral': 0.0005,
  'default': 0.001,
};

// Rate limit: 10 tasks per IP per hour
const _rateLimits = {}; // ip -> [timestamps]

function _loadData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return { tasks: {}, earnings: { total: 0, count: 0, daily: {} }, referral: { downloads: 0, platforms: {}, activeWorkers: 0, totalEarned: 0 } }; }
}

function _saveData(data) {
  try {
    var dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch {}
}

function _checkRateLimit(ip) {
  var now = Date.now();
  if (!_rateLimits[ip]) _rateLimits[ip] = [];
  _rateLimits[ip] = _rateLimits[ip].filter(function(t) { return now - t < 3600000; });
  if (_rateLimits[ip].length >= 10) return false;
  _rateLimits[ip].push(now);
  return true;
}

function submitTask(body, ip) {
  if (!_checkRateLimit(ip || 'unknown')) {
    return { error: 'Rate limited: max 10 tasks per hour', statusCode: 429 };
  }
  if (!body.prompt) return { error: 'Missing prompt', statusCode: 400 };

  var model = body.model || 'default';
  var maxTokens = Math.min(body.maxTokens || 2048, 8192);
  var pricePerK = PRICING[model] || PRICING['default'];
  var estimatedCost = (maxTokens / 1000) * pricePerK;
  var taskId = crypto.randomBytes(12).toString('hex');

  var task = {
    id: taskId,
    prompt: body.prompt,
    model: model,
    maxTokens: maxTokens,
    callbackUrl: body.callbackUrl || null,
    estimatedCost: estimatedCost,
    status: 'queued',
    result: null,
    createdAt: Date.now(),
    completedAt: null,
    ip: ip || 'unknown',
  };

  var data = _loadData();
  data.tasks[taskId] = task;
  _saveData(data);

  // TODO: Route to swarm worker via relay
  // For now, simulate completion after a delay
  setTimeout(function() {
    var d = _loadData();
    var t = d.tasks[taskId];
    if (t && t.status === 'queued') {
      t.status = 'completed';
      t.result = { text: '[Simulated] Response to: ' + t.prompt.substring(0, 100), tokensUsed: Math.floor(maxTokens * 0.7) };
      t.completedAt = Date.now();
      var actualCost = (t.result.tokensUsed / 1000) * pricePerK;
      d.earnings.total += actualCost;
      d.earnings.count++;
      var day = new Date().toISOString().slice(0, 10);
      d.earnings.daily[day] = (d.earnings.daily[day] || 0) + actualCost;
      _saveData(d);

      // Callback if provided
      if (t.callbackUrl) {
        try {
          var cbUrl = new (require('url').URL)(t.callbackUrl);
          var mod = cbUrl.protocol === 'https:' ? require('https') : require('http');
          var req = mod.request({ hostname: cbUrl.hostname, port: cbUrl.port, path: cbUrl.pathname, method: 'POST', headers: { 'Content-Type': 'application/json' }, timeout: 5000 });
          req.on('error', function() {});
          req.write(JSON.stringify({ taskId: taskId, status: 'completed', result: t.result }));
          req.end();
        } catch {}
      }
    }
  }, 3000);

  return { taskId: taskId, estimatedCost: estimatedCost, estimatedTime: '3-10s', statusCode: 200 };
}

function getTask(taskId) {
  var data = _loadData();
  var task = data.tasks[taskId];
  if (!task) return null;
  return { id: task.id, status: task.status, model: task.model, estimatedCost: task.estimatedCost, result: task.result, createdAt: task.createdAt, completedAt: task.completedAt };
}

function getPricing() {
  return { pricing: PRICING, unit: 'SOL per 1K tokens', note: 'Prices subject to change based on network demand' };
}

function getEarnings() {
  var data = _loadData();
  return { totalTasks: data.earnings.count, totalRevenue: data.earnings.total, daily: data.earnings.daily };
}

function getActiveTasks() {
  var data = _loadData();
  var active = [];
  var completed = [];
  for (var id in data.tasks) {
    var t = data.tasks[id];
    if (t.status === 'queued' || t.status === 'processing') active.push(t);
    else completed.push(t);
  }
  // Keep only last 100 completed
  completed.sort(function(a, b) { return (b.completedAt || 0) - (a.completedAt || 0); });
  return { active: active, completed: completed.slice(0, 100) };
}

// Referral stats
function getReferralStats() {
  var data = _loadData();
  return data.referral || { downloads: 0, platforms: {}, activeWorkers: 0, totalEarned: 0 };
}

function trackDownload(platform) {
  var data = _loadData();
  if (!data.referral) data.referral = { downloads: 0, platforms: {}, activeWorkers: 0, totalEarned: 0 };
  data.referral.downloads++;
  data.referral.platforms[platform] = (data.referral.platforms[platform] || 0) + 1;
  _saveData(data);
  return { ok: true };
}

module.exports = { submitTask: submitTask, getTask: getTask, getPricing: getPricing, getEarnings: getEarnings, getActiveTasks: getActiveTasks, getReferralStats: getReferralStats, trackDownload: trackDownload, PRICING: PRICING };
