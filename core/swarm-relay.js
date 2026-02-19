/**
 * ARIES Swarm Relay — HTTP Task Broker
 * 
 * Runs on a remote VM (e.g. GCP). Bridges Jay's local PC and remote workers
 * without requiring port forwarding or inbound connections to the PC.
 * 
 * Flow:
 *   Jay's PC → POST /api/task → Relay (queue) → GET /api/task → Worker
 *   Worker → POST /api/result → Relay → GET /api/result/:id → Jay's PC
 * 
 * Usage: ARIES_SECRET=mysecret PORT=9700 node swarm-relay.js
 */

const http = require('http');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT || '9700');
const SECRET = process.env.ARIES_SECRET || 'aries-swarm-secret-change-me';

// In-memory state
const taskQueue = [];          // unclaimed tasks
const activeTasks = new Map(); // taskId → { task, claimedBy, claimedAt }
const results = new Map();     // taskId → { result, completedAt }
const workers = {};            // workerId → { hostname, ip, ram_gb, cpu, cpu_cores, gpu, model, status, timestamp }
const stats = { submitted: 0, claimed: 0, completed: 0, failed: 0, started: Date.now() };

// Auto-expire: reclaim tasks stuck >5min, expire results >10min
setInterval(() => {
  const now = Date.now();
  for (const [id, t] of activeTasks) {
    if (now - t.claimedAt > 300000) {
      taskQueue.push({ id, ...t.task });
      activeTasks.delete(id);
      stats.failed++;
    }
  }
  for (const [id, r] of results) {
    if (now - r.completedAt > 600000) results.delete(id);
  }
}, 30000);

function auth(req) {
  return req.headers['x-aries-secret'] === SECRET;
}

function verifySignature(req, body) {
  var sig = req.headers['x-aries-signature'];
  if (!sig) return true; // backwards compat: don't require sig yet
  try {
    var expected = crypto.createHmac('sha256', SECRET).update(JSON.stringify(body)).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch (e) { return false; }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Aries-Secret');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (!auth(req)) return send(res, 401, { error: 'unauthorized' });

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  try {
    // POST /api/swarm/register — worker registers
    if (req.method === 'POST' && path === '/api/swarm/register') {
      const body = await readBody(req);
      const id = body.id || body.hostname || 'unknown';
      workers[id] = { hostname: body.hostname || id, ip: req.socket?.remoteAddress || '', ram_gb: body.ram_gb || 0, cpu: body.cpu || '', cpu_cores: body.cpu_cores || 0, gpu: body.gpu || 'none', model: body.model || '', status: 'ready', timestamp: Date.now() };
      console.log(`[Relay] Worker registered: ${id}`);
      return send(res, 200, { ok: true, workerId: id });
    }

    // POST /api/swarm/heartbeat — worker heartbeat
    if (req.method === 'POST' && path === '/api/swarm/heartbeat') {
      const body = await readBody(req);
      if (!verifySignature(req, body)) return send(res, 403, { error: 'invalid signature' });
      const id = body.id || body.hostname || 'unknown';
      if (workers[id]) { workers[id].timestamp = Date.now(); workers[id].status = body.status || 'ready'; if (body.uptime) workers[id].uptime = body.uptime; if (body.installedModels) workers[id].installedModels = body.installedModels; if (body.load) workers[id].load = body.load; }
      else { workers[id] = { hostname: body.hostname || id, ip: req.socket?.remoteAddress || '', ram_gb: body.ram_gb || 0, cpu: body.cpu || '', cpu_cores: body.cpu_cores || 0, gpu: body.gpu || 'none', model: body.model || '', status: body.status || 'ready', timestamp: Date.now() }; console.log(`[Relay] Worker auto-registered via heartbeat: ${id}`); }
      return send(res, 200, { ok: true });
    }

    // POST /api/swarm/broadcast — broadcast command to workers (used by packet-send etc)
    if (req.method === 'POST' && path === '/api/swarm/broadcast') {
      const body = await readBody(req);
      // Store as a broadcast task that all workers will pick up
      const id = crypto.randomUUID();
      const targetWorkers = body.workerIds || Object.keys(workers);
      for (const wId of targetWorkers) {
        taskQueue.push({ id: id + '-' + wId, ...body, targetWorker: wId });
      }
      return send(res, 200, { ok: true, broadcastId: id, targets: targetWorkers.length });
    }

    // POST /api/swarm/packet-stats — worker reports packet send stats
    if (req.method === 'POST' && path === '/api/swarm/packet-stats') {
      const body = await readBody(req);
      // Store for dashboard polling — attach to worker record
      const wId = body.worker || 'unknown';
      if (workers[wId]) workers[wId].packetStats = body.stats;
      return send(res, 200, { ok: true });
    }

    // POST /api/task — coordinator submits task(s)
    if (req.method === 'POST' && path === '/api/task') {
      const body = await readBody(req);
      const tasks = Array.isArray(body) ? body : [body];
      const ids = [];
      for (const t of tasks) {
        const id = t.id || crypto.randomUUID();
        taskQueue.push({ id, prompt: t.prompt, systemPrompt: t.systemPrompt, maxTokens: t.maxTokens || 2048, meta: t.meta || {} });
        stats.submitted++;
        ids.push(id);
      }
      return send(res, 200, { ok: true, taskIds: ids, queued: taskQueue.length });
    }

    // GET /api/task — worker claims next task
    if (req.method === 'GET' && path === '/api/task') {
      const workerId = url.searchParams.get('worker') || 'anon';
      if (!workers[workerId]) workers[workerId] = { hostname: workerId, ip: req.socket?.remoteAddress || '', status: 'ready', timestamp: Date.now() };
      else workers[workerId].timestamp = Date.now();
      if (taskQueue.length === 0) return send(res, 204, null);
      const task = taskQueue.shift();
      activeTasks.set(task.id, { task, claimedBy: workerId, claimedAt: Date.now() });
      stats.claimed++;
      return send(res, 200, task);
    }

    // POST /api/result — worker submits result
    if (req.method === 'POST' && path === '/api/result') {
      const body = await readBody(req);
      if (!body.taskId) return send(res, 400, { error: 'taskId required' });
      results.set(body.taskId, { result: body.result, error: body.error, completedAt: Date.now() });
      activeTasks.delete(body.taskId);
      if (body.error) stats.failed++; else stats.completed++;
      return send(res, 200, { ok: true });
    }

    // GET /api/result/:taskId — coordinator polls for result
    if (req.method === 'GET' && path.startsWith('/api/result/')) {
      const taskId = path.split('/api/result/')[1];
      if (results.has(taskId)) {
        const r = results.get(taskId);
        results.delete(taskId);
        return send(res, 200, { taskId, ...r });
      }
      // Check if still active or queued
      if (activeTasks.has(taskId)) return send(res, 202, { taskId, status: 'processing' });
      if (taskQueue.some(t => t.id === taskId)) return send(res, 202, { taskId, status: 'queued' });
      return send(res, 404, { error: 'not found' });
    }

    // GET /api/results — batch poll (coordinator sends ?ids=a,b,c)
    if (req.method === 'GET' && path === '/api/results') {
      const ids = (url.searchParams.get('ids') || '').split(',').filter(Boolean);
      const out = {};
      for (const id of ids) {
        if (results.has(id)) { out[id] = results.get(id); results.delete(id); }
        else if (activeTasks.has(id)) out[id] = { status: 'processing' };
        else if (taskQueue.some(t => t.id === id)) out[id] = { status: 'queued' };
        else out[id] = { status: 'unknown' };
      }
      return send(res, 200, out);
    }

    // POST /api/miner/node-report — worker reports miner stats
    if (req.method === 'POST' && path === '/api/miner/node-report') {
      const body = await readBody(req);
      if (!verifySignature(req, body)) return send(res, 403, { error: 'invalid signature' });
      const wId = body.nodeId || body.hostname || 'unknown';
      if (workers[wId]) workers[wId].minerStats = body;
      else workers[wId] = { hostname: wId, minerStats: body, timestamp: Date.now() };
      return send(res, 200, { ok: true });
    }

    // GET /api/status
    if (req.method === 'GET' && path === '/api/status') {
      return send(res, 200, {
        ...stats,
        uptime: Math.round((Date.now() - stats.started) / 1000),
        queued: taskQueue.length,
        active: activeTasks.size,
        pendingResults: results.size,
        workers: workers
      });
    }

    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`[Aries Relay] listening on port ${PORT}`);
  console.log(`[Aries Relay] secret: ${SECRET.slice(0, 4)}...${SECRET.slice(-4)}`);
});
