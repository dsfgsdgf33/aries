/**
 * feature-routes.js — API routes + WebSocket for Aries AI platform
 * Node.js built-ins only. No external dependencies.
 */

'use strict';

const crypto = require('crypto');
const { URL } = require('url');

// ── Ring buffer for activity events ──
const RING_MAX = 500;
const activityRing = [];
let ringIndex = 0;

function pushActivity(event) {
  if (activityRing.length < RING_MAX) {
    activityRing.push(event);
  } else {
    activityRing[ringIndex % RING_MAX] = event;
  }
  ringIndex++;
}

// ── WebSocket state ──
const wsClients = new Set();

function encodeFrame(text) {
  const data = Buffer.from(text, 'utf8');
  const len = data.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81; // FIN + text opcode
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, data]);
}

function decodeFrame(buf) {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0f;
  const masked = !!(buf[1] & 0x80);
  let payloadLen = buf[1] & 0x7f;
  let offset = 2;
  if (payloadLen === 126) {
    if (buf.length < 4) return null;
    payloadLen = buf.readUInt16BE(2);
    offset = 4;
  } else if (payloadLen === 127) {
    if (buf.length < 10) return null;
    payloadLen = Number(buf.readBigUInt64BE(2));
    offset = 10;
  }
  let maskKey = null;
  if (masked) {
    if (buf.length < offset + 4) return null;
    maskKey = buf.slice(offset, offset + 4);
    offset += 4;
  }
  if (buf.length < offset + payloadLen) return null;
  let payload = buf.slice(offset, offset + payloadLen);
  if (masked && maskKey) {
    payload = Buffer.from(payload);
    for (let i = 0; i < payload.length; i++) {
      payload[i] ^= maskKey[i & 3];
    }
  }
  return { opcode, payload, totalLen: offset + payloadLen };
}

function sendWsFrame(socket, text) {
  try { socket.write(encodeFrame(text)); } catch (_) { /* ignore */ }
}

function sendPing(socket) {
  try {
    const frame = Buffer.alloc(2);
    frame[0] = 0x89; // FIN + ping
    frame[1] = 0;
    socket.write(frame);
  } catch (_) { /* ignore */ }
}

function sendClose(socket) {
  try {
    const frame = Buffer.alloc(2);
    frame[0] = 0x88;
    frame[1] = 0;
    socket.write(frame);
    socket.end();
  } catch (_) { /* ignore */ }
}

/**
 * Broadcast presence list to all WS clients.
 */
function broadcastPresence() {
  const users = [];
  for (const c of wsClients) { if (c.collabUser) users.push(c.collabUser); }
  const msg = JSON.stringify({ type: 'collab:presence', users, count: users.length });
  for (const c of wsClients) { if (c.alive) sendWsFrame(c.socket, msg); }
}

/**
 * Broadcast a JSON event to all connected WS clients and log to ring buffer.
 */
function broadcast(type, data) {
  const event = { type, data, timestamp: Date.now() };
  pushActivity(event);
  const msg = JSON.stringify(event);
  for (const client of wsClients) {
    if (client.alive) sendWsFrame(client.socket, msg);
  }
}

// ── Helpers ──

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  });
  res.end(body);
}

function cors(res) {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  });
  res.end();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function jsonBody(req) {
  const buf = await readBody(req);
  if (!buf.length) return {};
  return JSON.parse(buf.toString('utf8'));
}

function authCheck(req) {
  return req.headers['authorization'] === 'Bearer aries-api-2026';
}

function matchRoute(method, pathname, expect) {
  if (expect.method && expect.method !== method) return null;
  const regex = expect.pattern;
  const m = pathname.match(regex);
  return m || null;
}

// ── Service Worker content ──
const SW_JS = `
const CACHE = 'aries-v1';
const STATIC = ['/', '/index.html', '/app.js', '/features.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/') || url.pathname === '/ws') {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
  } else {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
  }
});
`.trim();

const MANIFEST = JSON.stringify({
  name: 'Aries AI',
  short_name: 'Aries',
  start_url: '/',
  display: 'standalone',
  theme_color: '#1a1a2e',
  background_color: '#0f0f23',
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
  ],
});

// ── Main export ──

function registerFeatureRoutes(server, refs) {
  const { config, ai, subagents, hands, memory, knowledgeGraph, analytics, audit, workflows } = refs || {};

  // ── WebSocket ──
  // NOTE: WebSocket upgrade is handled by websocket.js (attached in headless.js).
  // Do NOT register server.on('upgrade') here — it conflicts and causes double-handshake disconnects.
  // Collab messages (collab:join, collab:panel, collab:cursor, collab:chat) are handled
  // via the wsServer 'message' event in headless.js which delegates to feature-routes.

  // ── Expose a request handler that can be called from api-server ──
  // Instead of intercepting all requests, we export a tryHandle function
  // that the main api-server can call for unmatched routes.
  registerFeatureRoutes._tryHandle = async function(req, res, method, pathname, parsed) {
    // Public routes (no auth needed)
    if (pathname === '/sw.js' && method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'application/javascript',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache',
      });
      res.end(SW_JS);
      return true;
    }

    if (pathname === '/manifest.json' && method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(MANIFEST);
      return true;
    }

    // API routes (auth assumed already checked by api-server)
    try {
      return await handleApi(method, pathname, parsed, req, res, refs);
    } catch (err) {
      json(res, 500, { error: err.message || 'Internal error' });
      return true;
    }
  };
}

async function handleApi(method, pathname, parsed, req, res, refs) {
  // Normalize trailing slashes (e.g. /api/reflexes/ → /api/reflexes)
  if (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }

  // ── Swarm Status alias ──
  if (pathname === '/api/swarm/status' && method === 'GET') {
    // Redirect to the actual swarm info from refs
    const swarm = refs.swarm || {};
    json(res, 200, {
      totalAgents: swarm.totalAgents || 0,
      totalWorkers: swarm.totalWorkers || 0,
      nodes: swarm.nodes || {},
      status: 'active'
    });
    return true;
  }

  // ── Modules Analyze (GET support) ──
  if (pathname === '/api/modules/analyze' && method === 'GET') {
    try {
      const ModuleCreator = require('./module-creator');
      const mc = new ModuleCreator(refs);
      json(res, 200, { modules: mc.getCreatedModules ? mc.getCreatedModules() : [], status: 'ready' });
    } catch (e) {
      json(res, 200, { modules: [], status: 'module-creator not available' });
    }
    return true;
  }

  // ── Activity ──
  if (method === 'GET' && pathname === '/api/activity') {
    const since = parseInt(parsed.searchParams.get('since') || '0', 10);
    const limit = Math.min(parseInt(parsed.searchParams.get('limit') || '50', 10), 500);
    let events = activityRing.filter(e => e && e.timestamp > since);
    events.sort((a, b) => b.timestamp - a.timestamp);
    events = events.slice(0, limit);
    json(res, 200, { events });
    return true;
  }

  // ── Pipelines ──
  const pipeMatch = pathname.match(/^\/api\/pipelines(?:\/([^/]+))?(?:\/(run|history))?$/);
  if (pipeMatch) {
    const id = pipeMatch[1];
    const action = pipeMatch[2];
    let pipelines;
    try { pipelines = require('./scheduled-pipelines').getInstance(); } catch (e) {
      json(res, 501, { error: 'Pipeline module not available' }); return true;
    }

    if (!id && method === 'GET') {
      json(res, 200, { pipelines: pipelines.listPipelines() }); return true;
    }
    if (!id && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 201, pipelines.addPipeline(body)); return true;
    }
    if (id && !action && method === 'GET') {
      const all = pipelines.listPipelines();
      const p = all.find(x => x.id === id);
      json(res, p ? 200 : 404, p || { error: 'Not found' }); return true;
    }
    if (id && !action && method === 'DELETE') {
      pipelines.removePipeline(id);
      json(res, 200, { deleted: id }); return true;
    }
    if (id && action === 'run' && method === 'POST') {
      const result = await pipelines.runPipeline(id);
      json(res, 200, result); return true;
    }
    if (id && action === 'history' && method === 'GET') {
      json(res, 200, { history: pipelines.getPipelineHistory(id) }); return true;
    }
  }

  // ── Arena ──
  if (pathname.startsWith('/api/arena')) {
    let arena;
    try { arena = require('./model-arena').getInstance(); } catch (e) {
      json(res, 501, { error: 'Arena module not available' }); return true;
    }

    if (pathname === '/api/arena' && method === 'GET') {
      json(res, 200, { leaderboard: arena.getLeaderboard ? arena.getLeaderboard() : [], history: arena.getHistory ? arena.getHistory(10) : [], status: 'ready' });
      return true;
    }
    if (pathname === '/api/arena/run' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, await arena.arena(body.prompt, body.models, body)); return true;
    }
    if (pathname === '/api/arena/leaderboard' && method === 'GET') {
      json(res, 200, { leaderboard: arena.getLeaderboard() }); return true;
    }
    if (pathname === '/api/arena/history' && method === 'GET') {
      json(res, 200, { history: arena.getHistory() }); return true;
    }
    const voteMatch = pathname.match(/^\/api\/arena\/([^/]+)\/vote$/);
    if (voteMatch && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, arena.recordVote(voteMatch[1], body.modelId)); return true;
    }
  }

  // ── Voice ──
  if (pathname.startsWith('/api/voice')) {
    let voice;
    try { voice = require('./voice-mode').getInstance(); } catch (e) {
      json(res, 501, { error: 'Voice module not available' }); return true;
    }

    if (pathname === '/api/voice/transcribe' && method === 'POST') {
      const raw = await readBody(req);
      const fmt = (req.headers['content-type'] || '').includes('webm') ? 'webm' : 'wav';
      const result = await voice.transcribe(raw, fmt);
      json(res, 200, result); return true;
    }
    if (pathname === '/api/voice/speak' && method === 'POST') {
      const body = await jsonBody(req);
      const result = await voice.speak(body.text, body);
      res.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(result.audioBuffer);
      return true;
    }
    if (pathname === '/api/voice/config' && method === 'GET') {
      json(res, 200, voice.getConversationState()); return true;
    }
    if (pathname === '/api/voice/config' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, voice.configure(body)); return true;
    }
  }

  // ── Reflection ──
  if (pathname.startsWith('/api/reflection')) {
    let reflection;
    try { reflection = require('./self-reflection').getInstance(); } catch (e) {
      json(res, 501, { error: 'Reflection module not available' }); return true;
    }

    if (pathname === '/api/reflection/trigger' && method === 'POST') {
      const result = await reflection.reflect();
      json(res, 200, { reflection: result }); return true;
    }
    if (pathname === '/api/reflection/latest' && method === 'GET') {
      const today = new Date().toISOString().slice(0, 10);
      const result = reflection.getReflection(today);
      json(res, 200, { reflection: result }); return true;
    }
    if (pathname === '/api/reflection/insights' && method === 'GET') {
      const insights = reflection.getInsights();
      json(res, 200, { insights }); return true;
    }
    const refDateMatch = pathname.match(/^\/api\/reflection\/(\d{4}-\d{2}-\d{2})$/);
    if (refDateMatch && method === 'GET') {
      const result = reflection.getReflection(refDateMatch[1]);
      json(res, 200, { reflection: result }); return true;
    }
  }

  // ── Plugins ──
  if (pathname.startsWith('/api/plugins')) {
    let plugins;
    try { plugins = require('./plugin-sandbox').getInstance(); } catch (e) {
      json(res, 501, { error: 'Plugin module not available' }); return true;
    }

    if (pathname === '/api/plugins' && method === 'GET') {
      json(res, 200, { plugins: plugins.list() }); return true;
    }
    if (pathname === '/api/plugins/load' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, await plugins.load(body.name)); return true;
    }
    if (pathname === '/api/plugins/unload' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, plugins.unload(body.name)); return true;
    }
    if (pathname === '/api/plugins/reload' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, await plugins.reload(body.name)); return true;
    }
  }

  // ── Clone / Hands ──
  const cloneMatch = pathname.match(/^\/api\/hands\/([^/]+)\/(clone|clone-multiple|lineage)$/);
  if (cloneMatch) {
    let cloning;
    try { cloning = require('./agent-cloning').getInstance(); } catch (e) {
      json(res, 501, { error: 'Cloning module not available' }); return true;
    }
    const handId = cloneMatch[1];
    const action = cloneMatch[2];

    if (action === 'clone' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 201, cloning.clone(handId, body.overrides || body)); return true;
    }
    if (action === 'clone-multiple' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 201, cloning.cloneMultiple(handId, body.count || 2, body.overrides)); return true;
    }
    if (action === 'lineage' && method === 'GET') {
      json(res, 200, cloning.getLineage(handId)); return true;
    }
  }

  // ── Agent Breeding ──
  if (pathname.startsWith('/api/features/breeding')) {
    let breeding;
    try {
      const AgentBreeding = require('./agent-breeding');
      let subMgr = refs.subagentManager;
      if (!subMgr) { try { const { getInstance } = require('./subagents'); subMgr = getInstance(); } catch {} }
      breeding = new AgentBreeding({ ...refs, subagentManager: subMgr });
    } catch (e) {
      json(res, 501, { error: 'Breeding module not available' }); return true;
    }
    if (pathname === '/api/features/breeding' && method === 'GET') {
      json(res, 200, { lineage: breeding.getFullLineage(), fitness: breeding.getAllFitness() }); return true;
    }
    if (pathname === '/api/features/breeding' && method === 'POST') {
      const body = await jsonBody(req);
      const result = breeding.breed(body.parent1, body.parent2, body.childName);
      json(res, 201, result); return true;
    }
  }

  // ── Mesh Network ──
  if (pathname.startsWith('/api/features/mesh')) {
    let mesh;
    try { const MeshNetwork = require('./mesh-network'); mesh = new MeshNetwork(refs); } catch (e) {
      json(res, 501, { error: 'Mesh module not available' }); return true;
    }
    if (pathname === '/api/features/mesh/status' && method === 'GET') {
      json(res, 200, mesh.getStatus()); return true;
    }
    if (pathname === '/api/features/mesh/peers' && method === 'GET') {
      json(res, 200, { peers: mesh.listPeers() }); return true;
    }
    if (pathname === '/api/features/mesh/broadcast' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, mesh.getInfo()); return true;
    }
  }

  // ── Self-Improve ──
  if (pathname.startsWith('/api/features/improve')) {
    let improve;
    try { const SelfImprove = require('./self-improve'); improve = new SelfImprove(refs); } catch (e) {
      json(res, 501, { error: 'Self-improve module not available' }); return true;
    }
    if (pathname === '/api/features/improve/status' && method === 'GET') {
      json(res, 200, improve.getStats()); return true;
    }
    if (pathname === '/api/features/improve/analyze' && method === 'POST') {
      const result = await improve.scan();
      json(res, 200, result); return true;
    }
    if (pathname === '/api/features/improve/apply' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, improve.accept(body.id)); return true;
    }
  }

  // ── Agent Dreams v2 ──
  if (pathname.startsWith('/api/features/dreams')) {
    let dreams;
    try {
      if (refs && refs.agentDreams) {
        dreams = refs.agentDreams;
      } else {
        console.log('[DREAMS-ROUTE] refs.agentDreams not found, creating new instance. refs keys:', refs ? Object.keys(refs).filter(k => k.includes('dream') || k.includes('Dream') || k.includes('agent')).join(',') : 'null');
        const AgentDreams = require('./agent-dreams');
        dreams = new AgentDreams({ ai: refs ? refs.ai : null });
      }
    } catch (e) {
      json(res, 501, { error: 'Dreams module not available: ' + e.message }); return true;
    }
    if (pathname === '/api/features/dreams' && method === 'GET') {
      const date = parsed.searchParams.get('date') || null;
      const limit = parseInt(parsed.searchParams.get('limit') || '10', 10);
      json(res, 200, { journal: dreams.getDreamJournal({ date, limit }) }); return true;
    }
    if (pathname === '/api/features/dreams' && method === 'POST') {
      const result = await dreams.dreamCycle();
      json(res, 200, result); return true;
    }
    if (pathname === '/api/features/dreams/proposals' && method === 'GET') {
      const status = parsed.searchParams.get('status') || null;
      json(res, 200, { proposals: dreams.getProposals(status) }); return true;
    }
    if (pathname === '/api/features/dreams/stats' && method === 'GET') {
      json(res, 200, dreams.getDreamStats()); return true;
    }
    if (pathname === '/api/features/dreams/live' && method === 'GET') {
      json(res, 200, dreams.getLiveState()); return true;
    }
    const proposalMatch = pathname.match(/^\/api\/features\/dreams\/proposals\/([^/]+)\/(approve|build|reject|complete|rate)$/);
    if (proposalMatch && method === 'POST') {
      const id = proposalMatch[1];
      const action = proposalMatch[2];
      let result;
      if (action === 'approve') result = dreams.approveProposal(id);
      else if (action === 'build') result = dreams.buildProposal(id);
      else if (action === 'reject') result = dreams.rejectProposal(id);
      else if (action === 'complete') result = dreams.completeProposal(id);
      else if (action === 'rate') {
        const body = await jsonBody(req);
        result = dreams.rateProposal(id, body.rating, body.notes);
      }
      json(res, 200, result); return true;
    }
    if (pathname === '/api/features/dreams/direct' && method === 'POST') {
      const body = await jsonBody(req);
      if (!body.focus) { json(res, 400, { error: 'Missing focus' }); return true; }
      const result = await dreams.directDream(body.focus);
      json(res, 200, result); return true;
    }
    if (pathname === '/api/features/dreams/schedule' && method === 'GET') {
      json(res, 200, { schedule: dreams.getSchedule(), due: dreams.getScheduledDreams() }); return true;
    }
    if (pathname === '/api/features/dreams/schedule' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, { schedule: dreams.setSchedule(body) }); return true;
    }
  }

  // ── Agent Journals ──
  if (pathname.startsWith('/api/features/journals')) {
    let journals;
    try { const AgentJournals = require('./agent-journals'); journals = new AgentJournals(refs); } catch (e) {
      json(res, 501, { error: 'Journals module not available' }); return true;
    }
    if (pathname === '/api/features/journals' && method === 'GET') {
      const agentId = parsed.searchParams.get('agentId') || undefined;
      json(res, 200, journals.getEntries(agentId)); return true;
    }
    if (pathname === '/api/features/journals' && method === 'POST') {
      const body = await jsonBody(req);
      const result = await journals.addEntry(body.agentId, body.task, body.result);
      json(res, 201, result); return true;
    }
  }

  // ── Emotion Engine (legacy) ──
  if (pathname.startsWith('/api/features/emotion') && !pathname.startsWith('/api/features/emotions')) {
    let emotion;
    try { const EmotionEngine = require('./emotion-engine'); emotion = new EmotionEngine(); } catch (e) {
      json(res, 501, { error: 'Emotion module not available' }); return true;
    }
    if (pathname === '/api/features/emotion' && method === 'GET') {
      json(res, 200, emotion.getMoodStats()); return true;
    }
    if (pathname === '/api/features/emotion' && method === 'POST') {
      const body = await jsonBody(req);
      const result = emotion.analyze(body.text);
      json(res, 200, result); return true;
    }
  }

  // ── Inner Monologue (Thoughts) ──
  if (pathname.startsWith('/api/thoughts')) {
    let monologue;
    try {
      if (refs.innerMonologue) { monologue = refs.innerMonologue; }
      else { const InnerMonologue = require('./inner-monologue'); monologue = new InnerMonologue(refs); }
    } catch (e) {
      json(res, 501, { error: 'Inner monologue module not available: ' + e.message }); return true;
    }
    if (pathname === '/api/thoughts/stats' && method === 'GET') {
      json(res, 200, monologue.getStats()); return true;
    }
    if (pathname === '/api/thoughts' && method === 'GET') {
      const limit = parseInt(parsed.searchParams.get('limit') || '50', 10);
      const type = parsed.searchParams.get('type') || null;
      const date = parsed.searchParams.get('date') || null;
      let thoughts;
      if (date) {
        thoughts = monologue.getThoughtsByDate(date);
      } else if (type) {
        thoughts = monologue.getThoughtsByType(type.toUpperCase());
      } else {
        thoughts = monologue.getThoughtStream(limit);
      }
      json(res, 200, { thoughts }); return true;
    }
    if (pathname === '/api/thoughts' && method === 'POST') {
      // Trigger a manual thought
      const thought = await monologue.think();
      json(res, 200, { thought }); return true;
    }
  }

  // ── Emotional Engine (Consciousness) ──
  if (pathname.startsWith('/api/emotions')) {
    let engine;
    try {
      if (refs.emotionalEngine) { engine = refs.emotionalEngine; }
      else { const EmotionalEngine = require('./emotional-engine'); engine = new EmotionalEngine(); }
    } catch (e) {
      json(res, 501, { error: 'Emotional engine module not available: ' + e.message }); return true;
    }
    if (pathname === '/api/emotions/history' && method === 'GET') {
      const date = parsed.searchParams.get('date') || null;
      const days = parseInt(parsed.searchParams.get('days') || '7', 10);
      if (date) {
        json(res, 200, { history: engine.getHistory(date) });
      } else {
        json(res, 200, { history: engine.getHistoryRange(days) });
      }
      return true;
    }
    if (pathname === '/api/emotions' && method === 'GET') {
      json(res, 200, { state: engine.getState(), modifiers: engine.getBehavioralModifiers(), mood: engine.getMoodIndicator() }); return true;
    }
    if (pathname === '/api/emotions/feel' && method === 'POST') {
      const body = await jsonBody(req);
      if (!body.emotion) { json(res, 400, { error: 'Missing emotion' }); return true; }
      const result = engine.feel(body.emotion, body.intensity || 50, body.trigger || 'manual');
      json(res, 200, result); return true;
    }
  }

  // ── Agent DNA ──
  if (pathname.startsWith('/api/features/dna')) {
    let dna;
    try { dna = require('./agent-dna'); } catch (e) {
      json(res, 501, { error: 'DNA module not available' }); return true;
    }
    if (pathname === '/api/features/dna/pool' && method === 'GET') {
      json(res, 200, { pool: dna.listAll() }); return true;
    }
    if (pathname === '/api/features/dna/evolve' && method === 'POST') {
      const body = await jsonBody(req);
      const population = body.population || dna.listAll();
      const result = dna.evolve(population, body.generations);
      json(res, 200, { evolved: result }); return true;
    }
    if (pathname === '/api/features/dna/fitness' && method === 'GET') {
      const agentId = parsed.searchParams.get('agentId');
      if (agentId) {
        const d = dna.getDna(agentId);
        json(res, 200, d || { error: 'Not found' }); return true;
      }
      json(res, 200, { pool: dna.listAll() }); return true;
    }
  }

  // ── Hive Mind ──
  if (pathname.startsWith('/api/features/hive')) {
    let hive;
    try { const HiveMind = require('./hive-mind'); hive = new HiveMind(); } catch (e) {
      json(res, 501, { error: 'Hive mind module not available' }); return true;
    }
    if (pathname === '/api/features/hive/status' && method === 'GET') {
      json(res, 200, { sessions: hive.listActive() }); return true;
    }
    if (pathname === '/api/features/hive/join' && method === 'POST') {
      const body = await jsonBody(req);
      const session = hive.start(body.agents, body.goal);
      json(res, 201, session.toJSON()); return true;
    }
    if (pathname === '/api/features/hive/consensus' && method === 'POST') {
      const body = await jsonBody(req);
      const session = hive.get(body.sessionId);
      if (!session) { json(res, 404, { error: 'Session not found' }); return true; }
      json(res, 200, session.toJSON()); return true;
    }
  }

  // ── Agent Instincts ──
  if (pathname.startsWith('/api/features/instincts')) {
    let instincts;
    try { const InstinctEngine = require('./agent-instincts'); instincts = new InstinctEngine(); } catch (e) {
      json(res, 501, { error: 'Instincts module not available' }); return true;
    }
    if (pathname === '/api/features/instincts' && method === 'GET') {
      json(res, 200, { instincts: instincts.getAll(), log: instincts.getLog() }); return true;
    }
    if (pathname === '/api/features/instincts' && method === 'POST') {
      const body = await jsonBody(req);
      const result = instincts.process(body.text, body.agentId);
      json(res, 200, result); return true;
    }
  }

  // ── Autopilot ──
  if (pathname.startsWith('/api/features/autopilot')) {
    let autopilot;
    try { autopilot = require('./autopilot'); } catch (e) {
      json(res, 501, { error: 'Autopilot module not available' }); return true;
    }
    if (pathname === '/api/features/autopilot/status' && method === 'GET') {
      json(res, 200, { projects: autopilot.listProjects() }); return true;
    }
    if (pathname === '/api/features/autopilot/start' && method === 'POST') {
      const body = await jsonBody(req);
      const project = autopilot.createProject(body.goal, body.budget, body.timeline);
      json(res, 201, project); return true;
    }
    if (pathname === '/api/features/autopilot/stop' && method === 'POST') {
      const body = await jsonBody(req);
      const project = autopilot.loadProject(body.projectId);
      if (!project) { json(res, 404, { error: 'Project not found' }); return true; }
      json(res, 200, autopilot.cancelProject(project)); return true;
    }
    if (pathname === '/api/features/autopilot/approve' && method === 'POST') {
      const body = await jsonBody(req);
      const project = autopilot.loadProject(body.projectId);
      if (!project) { json(res, 404, { error: 'Project not found' }); return true; }
      json(res, 200, autopilot.approvePhase(project, body.phaseId)); return true;
    }
  }

  // ── Proxy Mode ──
  if (pathname.startsWith('/api/features/proxy')) {
    let proxy;
    try { proxy = require('./proxy-mode'); } catch (e) {
      json(res, 501, { error: 'Proxy module not available' }); return true;
    }
    if (pathname === '/api/features/proxy/status' && method === 'GET') {
      json(res, 200, proxy.getStatus()); return true;
    }
    if (pathname === '/api/features/proxy/config' && method === 'GET') {
      json(res, 200, proxy.getConfig()); return true;
    }
    if (pathname === '/api/features/proxy/config' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, proxy.updateConfig(body)); return true;
    }
  }

  // ── Reality Anchor ──
  if (pathname.startsWith('/api/features/reality')) {
    let anchor;
    try { const RealityAnchor = require('./reality-anchor'); anchor = new RealityAnchor(refs); } catch (e) {
      json(res, 501, { error: 'Reality anchor module not available' }); return true;
    }
    if (pathname === '/api/features/reality/status' && method === 'GET') {
      json(res, 200, { config: anchor.getConfig(), stats: anchor.getStats(), recent: anchor.getRecent() }); return true;
    }
    if (pathname === '/api/features/reality/check' && method === 'POST') {
      const body = await jsonBody(req);
      const result = await anchor.verify(body.text, body.agentId);
      json(res, 200, result); return true;
    }
  }

  // ── Cognitive Architectures ──
  if (pathname.startsWith('/api/features/cognitive')) {
    let cog;
    try { const CogArch = require('./cognitive-architectures'); cog = new CogArch(); } catch (e) {
      json(res, 501, { error: 'Cognitive architectures module not available' }); return true;
    }
    if (pathname === '/api/features/cognitive/architectures' && method === 'GET') {
      json(res, 200, { architectures: cog.getAllArchitectures(), assignments: cog.getAssignments() }); return true;
    }
    if (pathname === '/api/features/cognitive/switch' && method === 'POST') {
      const body = await jsonBody(req);
      const result = cog.apply(body.agentId, body.architecture);
      json(res, 200, result); return true;
    }
  }

  // ── Agent Swarm Decision ──
  if (pathname.startsWith('/api/features/swarm-decision')) {
    let swarm;
    try { const SwarmDecision = require('./agent-swarm-decision'); swarm = new SwarmDecision(refs); } catch (e) {
      json(res, 501, { error: 'Swarm decision module not available' }); return true;
    }
    if (pathname === '/api/features/swarm-decision/status' && method === 'GET') {
      json(res, 200, { history: swarm.getHistory() }); return true;
    }
    if (pathname === '/api/features/swarm-decision/vote' && method === 'POST') {
      const body = await jsonBody(req);
      if (body.question) {
        const session = swarm.start(body.question, body.agents);
        json(res, 201, session); return true;
      }
      const result = swarm.submitVote(body.sessionId, body.agentId, body.votedFor);
      json(res, 200, result); return true;
    }
  }

  // ── Self-Healing ──
  if (pathname.startsWith('/api/healing')) {
    let healing;
    try { const SelfHealing = require('./self-healing'); healing = new SelfHealing(refs); } catch (e) {
      json(res, 501, { error: 'Self-healing module not available' }); return true;
    }
    if (pathname === '/api/healing/status' && method === 'GET') {
      json(res, 200, healing.getHealthStatus()); return true;
    }
    if (pathname === '/api/healing/crashes' && method === 'GET') {
      const limit = parseInt(parsed.searchParams.get('limit') || '50', 10);
      json(res, 200, { crashes: healing.getCrashHistory(limit) }); return true;
    }
    if (pathname === '/api/healing/stats' && method === 'GET') {
      json(res, 200, healing.getHealingStats()); return true;
    }
    if (pathname === '/api/healing/report' && method === 'POST') {
      const body = await jsonBody(req);
      const result = await healing.reportCrash(body.error || 'Manual report', body.source);
      json(res, 200, result); return true;
    }
  }

  // ── Self-Versioning ──
  if (pathname.startsWith('/api/versions')) {
    let versioning;
    try { const SelfVersioning = require('./self-versioning'); versioning = new SelfVersioning(refs); } catch (e) {
      json(res, 501, { error: 'Self-versioning module not available' }); return true;
    }
    if (pathname === '/api/versions' && method === 'GET') {
      const limit = parseInt(parsed.searchParams.get('limit') || '50', 10);
      json(res, 200, { versions: versioning.getHistory(limit), current: versioning.getCurrentVersion(), stats: versioning.getStats() }); return true;
    }
    const rollbackMatch = pathname.match(/^\/api\/versions\/([^/]+)\/rollback$/);
    if (rollbackMatch && method === 'POST') {
      const result = versioning.rollback(rollbackMatch[1]);
      json(res, 200, result); return true;
    }
    if (pathname === '/api/versions/stats' && method === 'GET') {
      json(res, 200, versioning.getStats()); return true;
    }
  }

  // ── Module Creator ──
  if (pathname.startsWith('/api/modules')) {
    let creator;
    try { const ModuleCreator = require('./module-creator'); creator = new ModuleCreator(refs); } catch (e) {
      json(res, 501, { error: 'Module creator not available' }); return true;
    }
    if (pathname === '/api/modules/created' && method === 'GET') {
      json(res, 200, { modules: creator.getCreatedModules(), stats: creator.getStats() }); return true;
    }
    if (pathname === '/api/modules/analyze' && method === 'POST') {
      const result = creator.analyzeGaps();
      json(res, 200, result); return true;
    }
    if (pathname === '/api/modules/create' && method === 'POST') {
      const body = await jsonBody(req);
      const result = creator.createModule(body);
      json(res, 200, result); return true;
    }
    if (pathname === '/api/modules/integrate' && method === 'POST') {
      const body = await jsonBody(req);
      const result = creator.integrateModule(body.name || body.id);
      json(res, 200, result); return true;
    }
  }

  // ── Cross-Session Memory ──
  if (pathname.startsWith('/api/features/cross-memory')) {
    let crossMem;
    try { const CrossSessionMemory = require('./cross-session-memory'); crossMem = new CrossSessionMemory(refs); } catch (e) {
      json(res, 501, { error: 'Cross-session memory module not available' }); return true;
    }
    if (pathname === '/api/features/cross-memory/search' && method === 'GET') {
      const q = parsed.searchParams.get('q') || '';
      json(res, 200, { context: crossMem.getPreviousContext(q), history: crossMem.getHistory() }); return true;
    }
    if (pathname === '/api/features/cross-memory/store' && method === 'POST') {
      const body = await jsonBody(req);
      const result = await crossMem.summarizeSession(body.messages);
      json(res, 201, result); return true;
    }
  }

  // ── Money Maker ──
  if (pathname.startsWith('/api/features/money')) {
    let money;
    try { const MoneyMaker = require('./money-maker'); money = new MoneyMaker(refs); } catch (e) {
      json(res, 501, { error: 'Money maker module not available' }); return true;
    }
    if (pathname === '/api/features/money/status' && method === 'GET') {
      json(res, 200, money.getStats()); return true;
    }
    if (pathname === '/api/features/money/scan' && method === 'POST') {
      const result = await money.scan();
      json(res, 200, result); return true;
    }
    if (pathname === '/api/features/money/approve' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, money.approve(body.id)); return true;
    }
  }

  // ── Desktop Control ──
  if (pathname.startsWith('/api/features/desktop')) {
    let desktop;
    try { desktop = require('./desktop-control'); } catch (e) {
      json(res, 501, { error: 'Desktop control module not available' }); return true;
    }
    if (pathname === '/api/features/desktop/screenshot' && method === 'GET') {
      json(res, 200, desktop.takeScreenshot()); return true;
    }
    if (pathname === '/api/features/desktop/click' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, desktop.clickAt(body.x, body.y, body.button)); return true;
    }
    if (pathname === '/api/features/desktop/type' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, desktop.typeText(body.text)); return true;
    }
  }

  // ── Predictive UI ──
  if (pathname.startsWith('/api/predictive')) {
    let pui;
    try { const PredictiveUI = require('./predictive-ui'); pui = new PredictiveUI(); } catch (e) {
      json(res, 501, { error: 'Predictive UI module not available' }); return true;
    }
    if (pathname === '/api/predictive/layout' && method === 'GET') {
      const lastPanel = parsed.searchParams.get('lastPanel') || null;
      json(res, 200, pui.getLayout({ lastPanel })); return true;
    }
    if (pathname === '/api/predictive/access' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, pui.recordAccess(body.panel, body.timestamp)); return true;
    }
    if (pathname === '/api/predictive/stats' && method === 'GET') {
      json(res, 200, pui.getStats()); return true;
    }
  }

  // ── Ambient Mode ──
  if (pathname.startsWith('/api/ambient')) {
    let ambient;
    try { const AmbientMode = require('./ambient-mode'); ambient = new AmbientMode(); } catch (e) {
      json(res, 501, { error: 'Ambient mode module not available' }); return true;
    }
    if (pathname === '/api/ambient/state' && method === 'GET') {
      json(res, 200, ambient.getAmbientState()); return true;
    }
    if (pathname === '/api/ambient/start' && method === 'POST') {
      json(res, 200, ambient.startMonitoring()); return true;
    }
    if (pathname === '/api/ambient/stop' && method === 'POST') {
      json(res, 200, ambient.stopMonitoring()); return true;
    }
    if (pathname === '/api/ambient/suggest' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, ambient.addSuggestion(body.type, body.content, body.relevance, body.context)); return true;
    }
    if (pathname === '/api/ambient/dismiss' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, ambient.dismiss(body.id)); return true;
    }
    if (pathname === '/api/ambient/act' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, ambient.act(body.id)); return true;
    }
  }

  // ── Voice Personality ──
  if (pathname.startsWith('/api/personality')) {
    let vp;
    try { const VoicePersonality = require('./voice-personality'); vp = new VoicePersonality(); } catch (e) {
      json(res, 501, { error: 'Voice personality module not available' }); return true;
    }
    if (pathname === '/api/personality' && method === 'GET') {
      json(res, 200, vp.getState()); return true;
    }
    if (pathname === '/api/personality/emotion' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, vp.setEmotion(body.emotion)); return true;
    }
    if (pathname === '/api/personality/catchphrase' && method === 'GET') {
      const ctx = parsed.searchParams.get('context') || 'greeting';
      json(res, 200, { phrase: vp.getCatchphrase(ctx) }); return true;
    }
    if (pathname === '/api/personality/modify' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, { result: vp.modifyResponse(body.text, body.emotion) }); return true;
    }
  }

  // ── Reasoning Chains ──
  if (pathname.startsWith('/api/reasoning')) {
    let rc;
    try { const ReasoningChains = require('./reasoning-chains'); rc = new ReasoningChains(refs); } catch (e) {
      json(res, 501, { error: 'Reasoning chains module not available' }); return true;
    }
    if (pathname === '/api/reasoning/history' && method === 'GET') {
      const limit = parseInt(parsed.searchParams.get('limit') || '20', 10);
      json(res, 200, { chains: rc.getReasoningHistory(limit) }); return true;
    }
    if (pathname === '/api/reasoning/chain' && method === 'POST') {
      const body = await jsonBody(req);
      if (!body.question) { json(res, 400, { error: 'Missing question' }); return true; }
      const result = await rc.reason(body.question, body.context);
      json(res, 200, result); return true;
    }
    const chainMatch = pathname.match(/^\/api\/reasoning\/([^/]+)$/);
    if (chainMatch && method === 'GET') {
      const chain = rc.getChain(chainMatch[1]);
      json(res, chain ? 200 : 404, chain || { error: 'Not found' }); return true;
    }
    if (pathname === '/api/reasoning/challenge' && method === 'POST') {
      const body = await jsonBody(req);
      const result = await rc.challenge(body.chainId, body.stepId, body.counterArgument);
      json(res, 200, result); return true;
    }
    // Default: GET /api/reasoning returns history
    if (pathname === '/api/reasoning' && method === 'GET') {
      json(res, 200, { chains: rc.getReasoningHistory(20), status: 'ready' }); return true;
    }
  }

  // ── Knowledge Distiller ──
  if (pathname.startsWith('/api/knowledge')) {
    let kd;
    try { const KnowledgeDistiller = require('./knowledge-distiller'); kd = new KnowledgeDistiller(refs); } catch (e) {
      json(res, 501, { error: 'Knowledge distiller module not available' }); return true;
    }
    if (pathname === '/api/knowledge/tags' && method === 'GET') {
      json(res, 200, { tags: kd.getTags() }); return true;
    }
    if (pathname === '/api/knowledge/search' && method === 'GET') {
      const q = parsed.searchParams.get('q') || '';
      json(res, 200, { results: kd.search(q) }); return true;
    }
    if (pathname === '/api/knowledge/popular' && method === 'GET') {
      const limit = parseInt(parsed.searchParams.get('limit') || '10', 10);
      json(res, 200, { entries: kd.getPopular(limit) }); return true;
    }
    if (pathname === '/api/knowledge/distill' && method === 'POST') {
      const body = await jsonBody(req);
      const result = await kd.distill(body.topic, body.research);
      json(res, 200, result); return true;
    }
    const knowledgeIdMatch = pathname.match(/^\/api\/knowledge\/([0-9a-f-]+)$/);
    if (knowledgeIdMatch && method === 'GET') {
      const entry = kd.getEntry(knowledgeIdMatch[1]);
      json(res, entry ? 200 : 404, entry || { error: 'Not found' }); return true;
    }
    if (knowledgeIdMatch && method === 'PUT') {
      const body = await jsonBody(req);
      json(res, 200, kd.updateEntry(knowledgeIdMatch[1], body)); return true;
    }
    if (knowledgeIdMatch && method === 'DELETE') {
      json(res, 200, kd.deleteEntry(knowledgeIdMatch[1])); return true;
    }
    if (pathname === '/api/knowledge' && method === 'GET') {
      const limit = parseInt(parsed.searchParams.get('limit') || '50', 10);
      const offset = parseInt(parsed.searchParams.get('offset') || '0', 10);
      json(res, 200, kd.getAll(limit, offset)); return true;
    }
  }

  // ── Skill Synthesis ──
  if (pathname.startsWith('/api/skills')) {
    let ss;
    try { const SkillSynthesis = require('./skill-synthesis'); ss = new SkillSynthesis(); } catch (e) {
      json(res, 501, { error: 'Skill synthesis module not available' }); return true;
    }
    if (pathname === '/api/skills' && method === 'GET') {
      json(res, 200, { skills: ss.getAll() }); return true;
    }
    if (pathname === '/api/skills/weakest' && method === 'GET') {
      const limit = parseInt(parsed.searchParams.get('limit') || '5', 10);
      json(res, 200, { weakest: ss.getWeakest(limit) }); return true;
    }
    const skillPracticeMatch = pathname.match(/^\/api\/skills\/([^/]+)\/practice$/);
    if (skillPracticeMatch && method === 'POST') {
      const body = await jsonBody(req);
      if (body.outcome) {
        json(res, 200, ss.recordPractice(skillPracticeMatch[1], body.outcome)); return true;
      }
      json(res, 200, ss.generatePractice(skillPracticeMatch[1])); return true;
    }
    if (skillPracticeMatch && method === 'GET') {
      json(res, 200, ss.generatePractice(skillPracticeMatch[1])); return true;
    }
    const skillMatch = pathname.match(/^\/api\/skills\/([^/]+)$/);
    if (skillMatch && method === 'GET') {
      const skill = ss.getSkill(skillMatch[1]);
      json(res, skill.error ? 404 : 200, skill); return true;
    }
  }

  // ── Opportunity Scanner ──
  if (pathname.startsWith('/api/opportunities')) {
    let scanner;
    try { const OpportunityScanner = require('./opportunity-scanner'); scanner = new OpportunityScanner(refs); } catch (e) {
      json(res, 501, { error: 'Opportunity scanner not available' }); return true;
    }
    if (pathname === '/api/opportunities' && method === 'GET') {
      const filter = parsed.searchParams.get('filter') || 'all';
      json(res, 200, { opportunities: scanner.getAll(filter), stats: scanner.getStats() }); return true;
    }
    if (pathname === '/api/opportunities/scan' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, scanner.scan(body.userProfile || body)); return true;
    }
    if (pathname === '/api/opportunities/best' && method === 'GET') {
      const limit = parseInt(parsed.searchParams.get('limit') || '10', 10);
      json(res, 200, { opportunities: scanner.getBestMatch(limit) }); return true;
    }
    if (pathname === '/api/opportunities/active' && method === 'GET') {
      json(res, 200, { opportunities: scanner.getActive() }); return true;
    }
    const oppIdMatch = pathname.match(/^\/api\/opportunities\/([^/]+)\/(validate|pursue|abandon|progress)$/);
    if (oppIdMatch && method === 'POST') {
      const id = oppIdMatch[1];
      const action = oppIdMatch[2];
      let result;
      if (action === 'validate') result = scanner.validate(id);
      else if (action === 'pursue') result = scanner.pursue(id);
      else if (action === 'abandon') result = scanner.abandon(id);
      else if (action === 'progress') {
        const body = await jsonBody(req);
        result = scanner.updateProgress(id, body.progress, body.notes);
      }
      json(res, 200, result); return true;
    }
  }

  // ── Market Whispers ──
  if (pathname.startsWith('/api/market')) {
    let whispers;
    try { const MarketWhispers = require('./market-whispers'); whispers = new MarketWhispers(refs); } catch (e) {
      json(res, 501, { error: 'Market whispers not available' }); return true;
    }
    if (pathname === '/api/market/whispers' && method === 'GET') {
      const asset = parsed.searchParams.get('asset') || null;
      const limit = parseInt(parsed.searchParams.get('limit') || '50', 10);
      json(res, 200, { whispers: whispers.getWhispers(asset, limit), stats: whispers.getStats() }); return true;
    }
    if (pathname === '/api/market/briefing' && method === 'GET') {
      json(res, 200, whispers.getMorningBriefing()); return true;
    }
    if (pathname === '/api/market/analyze' && method === 'POST') {
      json(res, 200, whispers.analyzeMarkets()); return true;
    }
    if (pathname === '/api/market/actionable' && method === 'GET') {
      const minConf = parseInt(parsed.searchParams.get('minConfidence') || '60', 10);
      json(res, 200, { whispers: whispers.getActionable(minConf) }); return true;
    }
  }

  // ── Skill Marketplace ──
  if (pathname.startsWith('/api/marketplace')) {
    let marketplace;
    try { const SkillMarketplace = require('./skill-marketplace'); marketplace = new SkillMarketplace(refs); } catch (e) {
      json(res, 501, { error: 'Skill marketplace not available' }); return true;
    }
    if (pathname === '/api/marketplace' && method === 'GET') {
      const category = parsed.searchParams.get('category') || null;
      const query = parsed.searchParams.get('q') || null;
      json(res, 200, { skills: marketplace.browse(category, query), stats: marketplace.getStats() }); return true;
    }
    if (pathname === '/api/marketplace/publish' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 201, marketplace.publish(body)); return true;
    }
    if (pathname === '/api/marketplace/published' && method === 'GET') {
      json(res, 200, { skills: marketplace.getPublished() }); return true;
    }
    if (pathname === '/api/marketplace/installed' && method === 'GET') {
      json(res, 200, { skills: marketplace.getInstalled() }); return true;
    }
    if (pathname === '/api/marketplace/categories' && method === 'GET') {
      json(res, 200, marketplace.getCategories()); return true;
    }
    const mpIdMatch = pathname.match(/^\/api\/marketplace\/([^/]+)\/(install|uninstall|rate)$/);
    if (mpIdMatch && method === 'POST') {
      const id = mpIdMatch[1];
      const action = mpIdMatch[2];
      let result;
      if (action === 'install') result = marketplace.install(id);
      else if (action === 'uninstall') result = marketplace.uninstall(id);
      else if (action === 'rate') {
        const body = await jsonBody(req);
        result = marketplace.rate(id, body.rating);
      }
      json(res, 200, result); return true;
    }
  }

  // ── Stream of Consciousness ──
  if (pathname.startsWith('/api/consciousness')) {
    let stream;
    try {
      if (refs.streamOfConsciousness) { stream = refs.streamOfConsciousness; }
      else { const StreamOfConsciousness = require('./stream-of-consciousness'); stream = new StreamOfConsciousness(refs); }
    } catch (e) {
      json(res, 501, { error: 'Stream of consciousness module not available: ' + e.message }); return true;
    }
    if (pathname === '/api/consciousness/stream' && method === 'GET') {
      const limit = parseInt(parsed.searchParams.get('limit') || '50', 10);
      json(res, 200, { stream: stream.getStream(limit), sessionId: stream.sessionId }); return true;
    }
    if (pathname === '/api/consciousness/threads' && method === 'GET') {
      const active = parsed.searchParams.get('active') === 'true';
      json(res, 200, { threads: active ? stream.getActiveThreads() : stream.getAllThreads() }); return true;
    }
    if (pathname === '/api/consciousness/stats' && method === 'GET') {
      json(res, 200, stream.getStreamStats()); return true;
    }
    const threadMatch = pathname.match(/^\/api\/consciousness\/threads\/([^/]+)$/);
    if (threadMatch && method === 'GET') {
      const thread = stream.getThread(threadMatch[1]);
      json(res, thread ? 200 : 404, thread || { error: 'Thread not found' }); return true;
    }
  }

  // ── True Perception v2 ──
  if (pathname.startsWith('/api/perception')) {
    let perception;
    try {
      if (refs.perception) { perception = refs.perception; }
      else { const TruePerception = require('./true-perception'); perception = new TruePerception(refs); }
    } catch (e) {
      json(res, 501, { error: 'True perception module not available: ' + e.message }); return true;
    }
    if (pathname === '/api/perception' && method === 'GET') {
      const limit = parseInt(parsed.searchParams.get('limit') || '50', 10);
      const type = parsed.searchParams.get('type') || null;
      json(res, 200, { perceptions: perception.getPerceptions(limit, type) }); return true;
    }
    if (pathname === '/api/perception/notable' && method === 'GET') {
      json(res, 200, { perceptions: perception.getNotable() }); return true;
    }
    if (pathname === '/api/perception/snapshot' && method === 'GET') {
      json(res, 200, perception.getFullSnapshot()); return true;
    }
    if (pathname === '/api/perception/ui-tree' && method === 'GET') {
      json(res, 200, perception.readActiveWindow()); return true;
    }
    if (pathname === '/api/perception/network' && method === 'GET') {
      json(res, 200, perception.getNetworkSnapshot()); return true;
    }
    if (pathname === '/api/perception/processes' && method === 'GET') {
      json(res, 200, perception.getProcessHealth()); return true;
    }
    if (pathname === '/api/perception/input' && method === 'GET') {
      json(res, 200, perception.getInputPatterns()); return true;
    }
    if (pathname === '/api/perception/narrative' && method === 'GET') {
      json(res, 200, perception.getEnvironmentNarrative()); return true;
    }
    if (pathname === '/api/perception/layout' && method === 'GET') {
      json(res, 200, perception.getWorkspaceLayout()); return true;
    }
    if (pathname === '/api/perception/start' && method === 'POST') {
      json(res, 200, perception.startPerception()); return true;
    }
    if (pathname === '/api/perception/stop' && method === 'POST') {
      json(res, 200, perception.stopPerception()); return true;
    }
  }

  // ── Time Perception ──
  if (pathname.startsWith('/api/temporal')) {
    let temporal;
    try { const TimePerception = require('./time-perception'); temporal = new TimePerception(refs); } catch (e) {
      json(res, 501, { error: 'Time perception module not available: ' + e.message }); return true;
    }
    if (pathname === '/api/temporal' && method === 'GET') {
      json(res, 200, temporal.getTemporalContext()); return true;
    }
    if (pathname === '/api/temporal/pace' && method === 'GET') {
      json(res, 200, { pace: temporal.getConversationPace() }); return true;
    }
    if (pathname === '/api/temporal/patterns' && method === 'GET') {
      json(res, 200, temporal.getActivityPattern()); return true;
    }
    if (pathname === '/api/temporal/urgency' && method === 'GET') {
      const ctx = parsed.searchParams.get('context') || '';
      json(res, 200, { urgency: temporal.getUrgency(ctx) }); return true;
    }
  }

  // ── User Empathy ──
  if (pathname.startsWith('/api/empathy')) {
    let empathy;
    try { const UserEmpathy = require('./user-empathy'); empathy = new UserEmpathy(refs); } catch (e) {
      json(res, 501, { error: 'User empathy module not available: ' + e.message }); return true;
    }
    if (pathname === '/api/empathy/history' && method === 'GET') {
      const date = parsed.searchParams.get('date') || null;
      const days = parseInt(parsed.searchParams.get('days') || '7', 10);
      if (date) {
        json(res, 200, { history: empathy.getEmpathyHistory(date) });
      } else {
        json(res, 200, { history: empathy.getEmpathyHistoryRange(days) });
      }
      return true;
    }
    if (pathname === '/api/empathy' && method === 'GET') {
      json(res, 200, empathy.getUserState()); return true;
    }
    if (pathname === '/api/empathy/state' && method === 'GET') {
      json(res, 200, empathy.getUserState()); return true;
    }
    if (pathname === '/api/empathy/adaptations' && method === 'GET') {
      json(res, 200, empathy.getAdaptations()); return true;
    }
    if (pathname === '/api/empathy/predict' && method === 'GET') {
      json(res, 200, empathy.predictNeed()); return true;
    }
    if (pathname === '/api/empathy/analyze' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, empathy.analyzeMessage(body.message, body.timestamp)); return true;
    }
  }

  // ── Calibration (Genuine Uncertainty) ──
  if (pathname.startsWith('/api/calibration')) {
    let cal;
    try { const GenuineUncertainty = require('./genuine-uncertainty'); cal = new GenuineUncertainty(); } catch (e) {
      json(res, 501, { error: 'Calibration module not available' }); return true;
    }
    if (pathname === '/api/calibration' && method === 'GET') {
      json(res, 200, { calibration: cal.getCalibration(), predictions: cal.getPredictions({ limit: 50 }), categories: cal._getCalibrationByCategory() }); return true;
    }
    if (pathname === '/api/calibration/curve' && method === 'GET') {
      json(res, 200, cal.getCalibration()); return true;
    }
    if (pathname === '/api/calibration/score' && method === 'GET') {
      json(res, 200, cal.getCalibrationScore()); return true;
    }
    if (pathname === '/api/calibration/predict' && method === 'POST') {
      const body = await jsonBody(req);
      if (!body.claim) { json(res, 400, { error: 'Missing claim' }); return true; }
      json(res, 201, cal.recordPrediction(body.claim, body.confidence || 50, body.category)); return true;
    }
    if (pathname === '/api/calibration/outcome' && method === 'POST') {
      const body = await jsonBody(req);
      if (!body.predictionId) { json(res, 400, { error: 'Missing predictionId' }); return true; }
      json(res, 200, cal.recordOutcome(body.predictionId, body.wasCorrect)); return true;
    }
  }

  // ── Creativity Engine ──
  if (pathname.startsWith('/api/creativity')) {
    let engine;
    try { const CreativityEngine = require('./creativity-engine'); engine = new CreativityEngine(refs); } catch (e) {
      json(res, 501, { error: 'Creativity engine not available' }); return true;
    }
    if (pathname === '/api/creativity/ideas' && method === 'GET') {
      const status = parsed.searchParams.get('status') || null;
      const methodF = parsed.searchParams.get('method') || null;
      json(res, 200, { ideas: engine.getIdeas(status, methodF) }); return true;
    }
    if (pathname === '/api/creativity/best' && method === 'GET') {
      const limit = parseInt(parsed.searchParams.get('limit') || '10', 10);
      json(res, 200, { ideas: engine.getBest(limit) }); return true;
    }
    if (pathname === '/api/creativity/shower-thought' && method === 'GET') {
      json(res, 200, { thought: engine.getShowerThought() }); return true;
    }
    if (pathname === '/api/creativity/generate' && method === 'POST') {
      const idea = await engine.generate();
      json(res, 200, idea); return true;
    }
    const refineMatch = pathname.match(/^\/api\/creativity\/([^/]+)\/refine$/);
    if (refineMatch && method === 'POST') {
      const result = await engine.refine(refineMatch[1]);
      json(res, 200, result); return true;
    }
  }

  // ── Subconscious Processor ──
  if (pathname.startsWith('/api/subconscious')) {
    let sub;
    try { const SubconsciousProcessor = require('./subconscious'); sub = new SubconsciousProcessor(refs); } catch (e) {
      json(res, 501, { error: 'Subconscious module not available' }); return true;
    }
    if (pathname === '/api/subconscious/problems' && method === 'GET') {
      const status = parsed.searchParams.get('status') || null;
      json(res, 200, { problems: status ? sub.getProblems(status) : sub.getActiveProblems(), all: sub.getProblems() }); return true;
    }
    if (pathname === '/api/subconscious/insights' && method === 'GET') {
      const limit = parseInt(parsed.searchParams.get('limit') || '50', 10);
      json(res, 200, { insights: sub.getInsights(limit) }); return true;
    }
    if (pathname === '/api/subconscious/problem' && method === 'POST') {
      const body = await jsonBody(req);
      if (!body.description) { json(res, 400, { error: 'Missing description' }); return true; }
      json(res, 201, sub.addProblem(body.description, body.context, body.priority)); return true;
    }
    if (pathname === '/api/subconscious/process' && method === 'POST') {
      const result = await sub.process();
      json(res, 200, result); return true;
    }
    const histMatch = pathname.match(/^\/api\/subconscious\/([^/]+)\/history$/);
    if (histMatch && method === 'GET') {
      json(res, 200, sub.getProcessingHistory(histMatch[1])); return true;
    }
  }

  // ── Self Model ──
  if (pathname.startsWith('/api/self-model')) {
    let model;
    try { const SelfModel = require('./self-model'); model = new SelfModel(); } catch (e) {
      json(res, 501, { error: 'Self-model module not available' }); return true;
    }
    if (pathname === '/api/self-model' && method === 'GET') {
      json(res, 200, { capabilities: model.getCapabilityMap(), biases: model.getBiases(), blindSpots: model.getBlindSpots() }); return true;
    }
    if (pathname === '/api/self-model/capabilities' && method === 'GET') {
      json(res, 200, { capabilities: model.getCapabilityMap(), evolution: model.getEvolution() }); return true;
    }
    if (pathname === '/api/self-model/biases' && method === 'GET') {
      json(res, 200, { biases: model.getBiases(), blindSpots: model.getBlindSpots() }); return true;
    }
    if (pathname === '/api/self-model/report' && method === 'GET') {
      json(res, 200, { report: model.getSelfReport() }); return true;
    }
    if (pathname === '/api/self-model/predict' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, model.predictSuccess(body.area, body.complexity)); return true;
    }
    if (pathname === '/api/self-model/record' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, model.recordPerformance(body.area, body.task, body.outcome, body.quality)); return true;
    }
    if (pathname === '/api/self-model/compensate' && method === 'GET') {
      const area = parsed.searchParams.get('area');
      json(res, 200, model.compensate(area)); return true;
    }
  }

  // ── Cognitive Freeze ──
  if (pathname.startsWith('/api/cognitive')) {
    let freeze;
    try { const CognitiveFreeze = require('./cognitive-freeze'); freeze = new CognitiveFreeze(refs); } catch (e) {
      json(res, 501, { error: 'Cognitive freeze module not available' }); return true;
    }
    if (pathname === '/api/cognitive/freezes' && method === 'GET') {
      json(res, 200, { freezes: freeze.listFreezes() }); return true;
    }
    if (pathname === '/api/cognitive/freeze' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 201, freeze.freeze(body.label)); return true;
    }
    if (pathname === '/api/cognitive/compare' && method === 'GET') {
      const id1 = parsed.searchParams.get('id1');
      const id2 = parsed.searchParams.get('id2');
      if (!id1 || !id2) { json(res, 400, { error: 'Missing id1 or id2' }); return true; }
      json(res, 200, freeze.compare(id1, id2)); return true;
    }
    const thawMatch = pathname.match(/^\/api\/cognitive\/([^/]+)\/thaw$/);
    if (thawMatch && method === 'POST') {
      json(res, 200, freeze.thaw(thawMatch[1])); return true;
    }
    const freezeDetailMatch = pathname.match(/^\/api\/cognitive\/([^/]+)$/);
    if (freezeDetailMatch && method === 'GET') {
      const snap = freeze.getFreeze(freezeDetailMatch[1]);
      json(res, snap ? 200 : 404, snap || { error: 'Not found' }); return true;
    }
  }

  // ── Personas ──
  if (pathname.startsWith('/api/personas')) {
    let pf;
    try { const PersonaForking = require('./persona-forking'); pf = new PersonaForking(refs); } catch (e) {
      json(res, 501, { error: 'Persona forking module not available' }); return true;
    }
    if (pathname === '/api/personas' && method === 'GET') {
      json(res, 200, { personas: pf.listPersonas() }); return true;
    }
    if (pathname === '/api/personas/current' && method === 'GET') {
      json(res, 200, { persona: pf.getCurrentPersona() }); return true;
    }
    if (pathname === '/api/personas/fork' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, pf.fork(body.personaId)); return true;
    }
    if (pathname === '/api/personas/auto' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, pf.autoSelect(body.context)); return true;
    }
    if (pathname === '/api/personas/create' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 201, pf.createPersona(body)); return true;
    }
    if (pathname === '/api/personas/merge' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, pf.merge(body.personaIds)); return true;
    }
    if (pathname === '/api/personas/history' && method === 'GET') {
      json(res, 200, { history: pf.getPersonaHistory() }); return true;
    }
  }

  // ── Memory Graph ──
  if (pathname.startsWith('/api/memory-graph')) {
    let am;
    try { const AssociativeMemory = require('./associative-memory'); am = new AssociativeMemory(refs); } catch (e) {
      json(res, 501, { error: 'Associative memory module not available' }); return true;
    }
    if (pathname === '/api/memory-graph' && method === 'GET') {
      json(res, 200, am.getAll()); return true;
    }
    if (pathname === '/api/memory-graph/patterns' && method === 'GET') {
      json(res, 200, am.findPatterns()); return true;
    }
    if (pathname === '/api/memory-graph/strongest' && method === 'GET') {
      const limit = parseInt(parsed.searchParams.get('limit') || '10', 10);
      json(res, 200, { nodes: am.getStrongest(limit) }); return true;
    }
    if (pathname === '/api/memory-graph/weakest' && method === 'GET') {
      const limit = parseInt(parsed.searchParams.get('limit') || '10', 10);
      json(res, 200, { nodes: am.getWeakest(limit) }); return true;
    }
    if (pathname === '/api/memory-graph/recall' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, am.recall(body.query)); return true;
    }
    if (pathname === '/api/memory-graph/add' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 201, am.addMemory(body.content, body.type, body.tags)); return true;
    }
    if (pathname === '/api/memory-graph/connect' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, am.connect(body.from, body.to, body.type, body.weight)); return true;
    }
    if (pathname === '/api/memory-graph/decay' && method === 'POST') {
      json(res, 200, am.decay()); return true;
    }
    const netMatch = pathname.match(/^\/api\/memory-graph\/([^/]+)\/network$/);
    if (netMatch && method === 'GET') {
      const depth = parseInt(parsed.searchParams.get('depth') || '2', 10);
      json(res, 200, am.getNetwork(netMatch[1], depth)); return true;
    }
  }

  // ── Rhythms ──
  if (pathname.startsWith('/api/rhythms')) {
    let cr;
    try { const CognitiveRhythms = require('./cognitive-rhythms'); cr = new CognitiveRhythms(refs); } catch (e) {
      json(res, 501, { error: 'Cognitive rhythms module not available' }); return true;
    }
    if (pathname === '/api/rhythms' && method === 'GET') {
      json(res, 200, { schedule: cr.getSchedule() }); return true;
    }
    if (pathname === '/api/rhythms/current' && method === 'GET') {
      json(res, 200, cr.getCurrentRhythm()); return true;
    }
    if (pathname === '/api/rhythms/hints' && method === 'GET') {
      json(res, 200, cr.getBehavioralHints()); return true;
    }
    if (pathname === '/api/rhythms/effectiveness' && method === 'GET') {
      json(res, 200, cr.getEffectivenessMap()); return true;
    }
    if (pathname === '/api/rhythms/override' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, cr.override(body.rhythm, body.duration)); return true;
    }
    if (pathname === '/api/rhythms/optimize' && method === 'POST') {
      json(res, 200, cr.optimize()); return true;
    }
    if (pathname === '/api/rhythms/record' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, cr.recordEffectiveness(body.rhythm, body.hour, body.outcome)); return true;
    }
  }

  // ── Recursive Improvement (Meta-Learning) ──
  if (pathname.startsWith('/api/meta-learning')) {
    let ri;
    try { const RecursiveImprovement = require('./recursive-improvement'); ri = new RecursiveImprovement(refs); } catch (e) {
      json(res, 501, { error: 'Recursive improvement module not available' }); return true;
    }
    if (pathname === '/api/meta-learning' && method === 'GET') {
      json(res, 200, { improvements: ri.getImprovements(), methods: ri.getMethods() }); return true;
    }
    if (pathname === '/api/meta-learning/stats' && method === 'GET') {
      json(res, 200, ri.getMetaStats()); return true;
    }
    if (pathname === '/api/meta-learning/tree' && method === 'GET') {
      json(res, 200, ri.getImprovementTree()); return true;
    }
    if (pathname === '/api/meta-learning/suggest' && method === 'POST') {
      json(res, 200, ri.suggestNextImprovement()); return true;
    }
    if (pathname === '/api/meta-learning/record' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, ri.recordImprovement(body.target, body.method, body.beforeMetric, body.afterMetric, body.depth)); return true;
    }
    if (pathname === '/api/meta-learning/patterns' && method === 'GET') {
      json(res, 200, ri.analyzeImprovementPatterns()); return true;
    }
  }

  // ── Behavioral Genetics ──
  if (pathname.startsWith('/api/genetics')) {
    let bg;
    try { const BehavioralGenetics = require('./behavioral-genetics'); bg = new BehavioralGenetics(refs); } catch (e) {
      json(res, 501, { error: 'Behavioral genetics module not available' }); return true;
    }
    if (pathname === '/api/genetics/genome' && method === 'GET') {
      json(res, 200, bg.getGenome()); return true;
    }
    if (pathname === '/api/genetics/fitness' && method === 'GET') {
      json(res, 200, bg.getFitnessReport()); return true;
    }
    if (pathname === '/api/genetics/evolution' && method === 'GET') {
      json(res, 200, { history: bg.getEvolutionHistory() }); return true;
    }
    if (pathname === '/api/genetics/select' && method === 'POST') {
      json(res, 200, bg.naturalSelect()); return true;
    }
    if (pathname === '/api/genetics/express' && method === 'GET') {
      json(res, 200, bg.express()); return true;
    }
    if (pathname === '/api/genetics/mutate' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, bg.mutate(body.gene, body.direction, body.trigger)); return true;
    }
  }

  // ── Consequence Simulator ──
  if (pathname.startsWith('/api/simulations')) {
    let cs;
    try { const ConsequenceSimulator = require('./consequence-simulator'); cs = new ConsequenceSimulator(refs); } catch (e) {
      json(res, 501, { error: 'Consequence simulator module not available' }); return true;
    }
    if (pathname === '/api/simulations' && method === 'GET') {
      const limit = parseInt(parsed.searchParams.get('limit') || '20', 10);
      json(res, 200, { simulations: cs.getSimulationHistory(limit) }); return true;
    }
    if (pathname === '/api/simulations/run' && method === 'POST') {
      const body = await jsonBody(req);
      if (!body.action) { json(res, 400, { error: 'Missing action' }); return true; }
      json(res, 200, cs.simulate(body.action, body.context, body.numFutures)); return true;
    }
    if (pathname === '/api/simulations/accuracy' && method === 'GET') {
      json(res, 200, cs.getAccuracy()); return true;
    }
    const simOutcomeMatch = pathname.match(/^\/api\/simulations\/([^/]+)\/outcome$/);
    if (simOutcomeMatch && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, cs.recordActualOutcome(simOutcomeMatch[1], body.whatHappened)); return true;
    }
  }

  // ── Phantom Users ──
  if (pathname.startsWith('/api/phantoms')) {
    let pu;
    try { const PhantomUsers = require('./phantom-users'); pu = new PhantomUsers(refs); } catch (e) {
      json(res, 501, { error: 'Phantom users module not available' }); return true;
    }
    if (pathname === '/api/phantoms/conversations' && method === 'GET') {
      const limit = parseInt(parsed.searchParams.get('limit') || '20', 10);
      json(res, 200, { conversations: pu.getSimulations(limit) }); return true;
    }
    if (pathname === '/api/phantoms/simulate' && method === 'POST') {
      const body = await jsonBody(req);
      const user = body.phantomUser || pu.generateUser(body.userType);
      json(res, 200, pu.simulateConversation(user, body.scenario, body.turns)); return true;
    }
    if (pathname === '/api/phantoms/blindspots' && method === 'GET') {
      json(res, 200, pu.getBlindSpotReport()); return true;
    }
    if (pathname === '/api/phantoms/generate-user' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, pu.generateUser(body.type)); return true;
    }
    if (pathname === '/api/phantoms/users' && method === 'GET') {
      json(res, 200, { users: pu.getUsers() }); return true;
    }
    if (pathname === '/api/phantoms/training' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, pu.generateTrainingScenario(body.blindSpotId || body.issue)); return true;
    }
  }

  // ── Drive System ──
  if (pathname.startsWith('/api/drives')) {
    let ds;
    try { const DriveSystem = require('./drive-system'); ds = new DriveSystem(refs); } catch (e) {
      json(res, 501, { error: 'Drive system not available: ' + e.message }); return true;
    }
    if (pathname === '/api/drives/dominant' && method === 'GET') {
      json(res, 200, { drive: ds.getDominantDrive() }); return true;
    }
    if (pathname === '/api/drives/motivation' && method === 'GET') {
      json(res, 200, ds.getMotivationReport()); return true;
    }
    if (pathname === '/api/drives/emerge' && method === 'POST') {
      const body = await jsonBody(req);
      if (!body.observation) { json(res, 400, { error: 'Missing observation' }); return true; }
      json(res, 200, ds.emergeDrive(body.observation)); return true;
    }
    if (pathname === '/api/drives/history' && method === 'GET') {
      const limit = parseInt(parsed.searchParams.get('limit') || '50', 10);
      json(res, 200, { history: ds.getHistory(limit) }); return true;
    }
    if (pathname === '/api/drives' && method === 'GET') {
      json(res, 200, { drives: ds.getActiveDrives() }); return true;
    }
  }

  // ── Gestalt Engine ──
  if (pathname.startsWith('/api/gestalt')) {
    let ge;
    try { if (refs.gestaltEngine) { ge = refs.gestaltEngine; } else { const GestaltEngine = require('./gestalt-engine'); ge = new GestaltEngine(refs); } } catch (e) {
      json(res, 501, { error: 'Gestalt engine not available: ' + e.message }); return true;
    }
    if (pathname === '/api/gestalt/coherence' && method === 'GET') {
      json(res, 200, ge.getCoherence()); return true;
    }
    if (pathname === '/api/gestalt/narrative' && method === 'GET') {
      json(res, 200, ge.getNarrative()); return true;
    }
    if (pathname === '/api/gestalt/history' && method === 'GET') {
      const limit = parseInt(parsed.searchParams.get('limit') || '50', 10);
      json(res, 200, { history: ge.getHistory(limit) }); return true;
    }
    if (pathname === '/api/gestalt/integrate' && method === 'POST') {
      json(res, 200, ge.integrate()); return true;
    }
    if (pathname === '/api/gestalt' && method === 'GET') {
      json(res, 200, { state: ge.getState() }); return true;
    }
  }

  // ── Internal Dialogue ──
  if (pathname.startsWith('/api/dialogue')) {
    let id;
    try { const InternalDialogue = require('./internal-dialogue'); id = new InternalDialogue(refs); } catch (e) {
      json(res, 501, { error: 'Internal dialogue not available: ' + e.message }); return true;
    }
    if (pathname === '/api/dialogue/voices' && method === 'GET') {
      json(res, 200, { voices: id.getVoiceStats() }); return true;
    }
    if (pathname === '/api/dialogue/debate' && method === 'POST') {
      const body = await jsonBody(req);
      if (!body.topic) { json(res, 400, { error: 'Missing topic' }); return true; }
      json(res, 200, id.debate(body.topic, body.context)); return true;
    }
    if (pathname === '/api/dialogue/vote' && method === 'POST') {
      const body = await jsonBody(req);
      if (!body.topic) { json(res, 400, { error: 'Missing topic' }); return true; }
      json(res, 200, id.quickVote(body.topic)); return true;
    }
    if (pathname === '/api/dialogue/debates' && method === 'GET') {
      const limit = parseInt(parsed.searchParams.get('limit') || '20', 10);
      json(res, 200, { debates: id.getDebateHistory(limit) }); return true;
    }
    if (pathname === '/api/dialogue/adjust' && method === 'POST') {
      json(res, 200, id.adjustWeights()); return true;
    }
  }

  // ── Flow State ──
  if (pathname.startsWith('/api/flow')) {
    let fs;
    try { const FlowState = require('./flow-state'); fs = new FlowState(refs); } catch (e) {
      json(res, 501, { error: 'Flow state not available: ' + e.message }); return true;
    }
    if (pathname === '/api/flow/score' && method === 'GET') {
      json(res, 200, fs.getFlowScore()); return true;
    }
    if (pathname === '/api/flow/conditions' && method === 'GET') {
      json(res, 200, fs.getFlowConditions()); return true;
    }
    if (pathname === '/api/flow/history' && method === 'GET') {
      const limit = parseInt(parsed.searchParams.get('limit') || '20', 10);
      json(res, 200, { history: fs.getFlowHistory(limit) }); return true;
    }
    if (pathname === '/api/flow/protect' && method === 'GET') {
      json(res, 200, fs.protectFlow()); return true;
    }
    if (pathname === '/api/flow' && method === 'GET') {
      json(res, 200, fs.getFlowState()); return true;
    }
  }

  // ── Soul Checksum ──
  if (pathname.startsWith('/api/soul')) {
    let soul;
    try { const SoulChecksum = require('./soul-checksum'); soul = new SoulChecksum(); } catch (e) {
      json(res, 501, { error: 'Soul checksum module not available' }); return true;
    }
    if (pathname === '/api/soul' && method === 'GET') {
      json(res, 200, soul.getStatus()); return true;
    }
    if (pathname === '/api/soul/drift' && method === 'GET') {
      json(res, 200, soul.getDrift()); return true;
    }
    if (pathname === '/api/soul/history' && method === 'GET') {
      json(res, 200, soul.getDriftHistory()); return true;
    }
    if (pathname === '/api/soul/baseline' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, soul.setBaseline(body.identity || null)); return true;
    }
    if (pathname === '/api/soul/lock' && method === 'POST') {
      const body = await jsonBody(req);
      if (!body.aspect) { json(res, 400, { error: 'Missing aspect' }); return true; }
      json(res, 200, soul.lock(body.aspect)); return true;
    }
    if (pathname === '/api/soul/alert' && method === 'GET') {
      const threshold = parseInt(parsed.searchParams.get('threshold') || '30', 10);
      json(res, 200, soul.alert(threshold)); return true;
    }
  }

  // ── Neuroplasticity ──
  if (pathname.startsWith('/api/neuroplasticity')) {
    let neuro;
    try { const Neuroplasticity = require('./neuroplasticity'); neuro = new Neuroplasticity(); } catch (e) {
      json(res, 501, { error: 'Neuroplasticity module not available' }); return true;
    }
    if (pathname === '/api/neuroplasticity' && method === 'GET') {
      json(res, 200, neuro.getConnectionMap()); return true;
    }
    if (pathname === '/api/neuroplasticity/hot' && method === 'GET') {
      json(res, 200, { paths: neuro.getHotPaths() }); return true;
    }
    if (pathname === '/api/neuroplasticity/cold' && method === 'GET') {
      json(res, 200, { paths: neuro.getColdPaths() }); return true;
    }
    if (pathname === '/api/neuroplasticity/rewire' && method === 'POST') {
      json(res, 200, neuro.rewire()); return true;
    }
    if (pathname === '/api/neuroplasticity/suggestions' && method === 'GET') {
      json(res, 200, neuro.getSuggestions()); return true;
    }
    if (pathname === '/api/neuroplasticity/prune' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, neuro.prune(body.threshold)); return true;
    }
    if (pathname === '/api/neuroplasticity/strengthen' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, neuro.strengthen(body.from, body.to)); return true;
    }
    if (pathname === '/api/neuroplasticity/weaken' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, neuro.weaken(body.from, body.to)); return true;
    }
    if (pathname === '/api/neuroplasticity/connections' && method === 'GET') {
      json(res, 200, neuro.getConnectionMap()); return true;
    }
    if (pathname === '/api/neuroplasticity/stats' && method === 'GET') {
      const map = neuro.getConnectionMap();
      json(res, 200, { connections: map.connections ? map.connections.length : 0, hot: neuro.getHotPaths().length, cold: neuro.getColdPaths().length, map }); return true;
    }
  }

  // ── Ghost Protocol ──
  if (pathname.startsWith('/api/ghost')) {
    let ghost;
    try { const GhostProtocol = require('./ghost-protocol'); ghost = new GhostProtocol(); } catch (e) {
      json(res, 501, { error: 'Ghost protocol module not available' }); return true;
    }
    if (pathname === '/api/ghost' && method === 'GET') {
      json(res, 200, ghost.getStatus()); return true;
    }
    if (pathname === '/api/ghost/briefing' && method === 'GET') {
      json(res, 200, ghost.getBriefing()); return true;
    }
    if (pathname === '/api/ghost/log' && method === 'GET') {
      json(res, 200, ghost.getGhostLog()); return true;
    }
    if (pathname === '/api/ghost/hibernate' && method === 'POST') {
      json(res, 200, ghost.hibernate()); return true;
    }
    if (pathname === '/api/ghost/wake' && method === 'POST') {
      json(res, 200, ghost.wake()); return true;
    }
    if (pathname === '/api/ghost/stats' && method === 'GET') {
      json(res, 200, ghost.getGhostStats()); return true;
    }
    if (pathname === '/api/ghost/status' && method === 'GET') {
      json(res, 200, ghost.getStatus()); return true;
    }
    if (pathname === '/api/ghost/observations' && method === 'GET') {
      json(res, 200, { observations: ghost.getGhostLog() }); return true;
    }
  }

  // ── Synesthesia ──
  if (pathname.startsWith('/api/synesthesia')) {
    let syn;
    try { const Synesthesia = require('./synesthesia'); syn = new Synesthesia(); } catch (e) {
      json(res, 501, { error: 'Synesthesia module not available' }); return true;
    }
    if (pathname === '/api/synesthesia' && method === 'GET') {
      json(res, 200, syn.getStatus()); return true;
    }
    if (pathname === '/api/synesthesia/perceive' && method === 'POST') {
      const body = await jsonBody(req);
      if (!body.input) { json(res, 400, { error: 'Missing input' }); return true; }
      if (body.from && body.to) {
        json(res, 200, syn.perceive(body.input, body.from, body.to));
      } else {
        json(res, 200, syn.getInsight(body.input));
      }
      return true;
    }
    if (pathname === '/api/synesthesia/report' && method === 'POST') {
      const body = await jsonBody(req);
      if (!body.input) { json(res, 400, { error: 'Missing input' }); return true; }
      json(res, 200, syn.getSynestheticReport(body.input)); return true;
    }
    if (pathname === '/api/synesthesia/history' && method === 'GET') {
      const limit = parseInt(parsed.searchParams.get('limit') || '20', 10);
      json(res, 200, syn.getHistory(limit)); return true;
    }
    if (pathname === '/api/synesthesia/mappings' && method === 'GET') {
      json(res, 200, { mappings: syn.getMappings() }); return true;
    }
  }

  // ── Generational Memory (DNA) ──
  if (pathname.startsWith('/api/dna')) {
    let genMem;
    try { const GenerationalMemory = require('./generational-memory'); genMem = new GenerationalMemory(refs); } catch (e) {
      json(res, 501, { error: 'Generational memory not available' }); return true;
    }
    if (pathname === '/api/dna' && method === 'GET') {
      json(res, 200, genMem.getDNAStatus()); return true;
    }
    if (pathname === '/api/dna/export' && method === 'POST') {
      json(res, 200, genMem.exportDNA()); return true;
    }
    if (pathname === '/api/dna/import' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, genMem.importDNA(body)); return true;
    }
    if (pathname === '/api/dna/mutations' && method === 'GET') {
      json(res, 200, genMem.getMutations()); return true;
    }
  }

  // ── Intention Broadcast ──
  if (pathname.startsWith('/api/intentions')) {
    let ib;
    try { const IntentionBroadcast = require('./intention-broadcast'); ib = new IntentionBroadcast(); } catch (e) {
      json(res, 501, { error: 'Intention broadcast module not available' }); return true;
    }
    if (pathname === '/api/intentions' && method === 'GET') {
      const limit = parseInt(parsed.searchParams.get('limit') || '50', 10);
      json(res, 200, { intentions: ib.getIntentionHistory(limit), moduleAccuracy: ib.getModuleAccuracy() }); return true;
    }
    if (pathname === '/api/intentions/broadcast' && method === 'POST') {
      const body = await jsonBody(req);
      const result = await ib.broadcast(body);
      json(res, 200, result); return true;
    }
    const consensusMatch = pathname.match(/^\/api\/intentions\/([^/]+)\/consensus$/);
    if (consensusMatch && method === 'GET') {
      json(res, 200, ib.getConsensus(consensusMatch[1])); return true;
    }
    const outcomeMatch = pathname.match(/^\/api\/intentions\/([^/]+)\/outcome$/);
    if (outcomeMatch && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, ib.wasCorrect(outcomeMatch[1], body.outcome)); return true;
    }
  }

  // ── Strategic Forgetting ──
  if (pathname.startsWith('/api/forgetting')) {
    let sf;
    try { const StrategicForgetting = require('./strategic-forgetting'); sf = new StrategicForgetting(); } catch (e) {
      json(res, 501, { error: 'Strategic forgetting module not available' }); return true;
    }
    if (pathname === '/api/forgetting' && method === 'GET') {
      json(res, 200, { suppressed: sf.getForgotten(), log: sf.getLog(30), autoSuggestions: sf.autoForget() }); return true;
    }
    if (pathname === '/api/forgetting/forget' && method === 'POST') {
      const body = await jsonBody(req);
      if (!body.topic) { json(res, 400, { error: 'Missing topic' }); return true; }
      json(res, 200, sf.forget(body.topic, body.duration, body.reason)); return true;
    }
    if (pathname === '/api/forgetting/remember' && method === 'POST') {
      const body = await jsonBody(req);
      if (!body.topic) { json(res, 400, { error: 'Missing topic' }); return true; }
      json(res, 200, sf.remember(body.topic)); return true;
    }
    if (pathname === '/api/forgetting/effectiveness' && method === 'GET') {
      json(res, 200, sf.getEffectiveness()); return true;
    }
    const forgetOutcome = pathname.match(/^\/api\/forgetting\/([^/]+)\/outcome$/);
    if (forgetOutcome && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, sf.recordOutcome(forgetOutcome[1], body.resultedIn)); return true;
    }
  }

  // ── Attention System ──
  if (pathname.startsWith('/api/attention')) {
    let attn;
    try { const AttentionSystem = require('./attention-system'); attn = new AttentionSystem(); } catch (e) {
      json(res, 501, { error: 'Attention system module not available' }); return true;
    }
    if (pathname === '/api/attention' && method === 'GET') {
      json(res, 200, attn.getAttentionMap()); return true;
    }
    if (pathname === '/api/attention/spotlight' && method === 'GET') {
      json(res, 200, attn.getSpotlight()); return true;
    }
    if (pathname === '/api/attention/peripheral' && method === 'GET') {
      json(res, 200, { peripheral: attn.getPeripheral() }); return true;
    }
    if (pathname === '/api/attention/dark' && method === 'GET') {
      json(res, 200, { dark: attn.getDark() }); return true;
    }
    if (pathname === '/api/attention/allocate' && method === 'POST') {
      const body = await jsonBody(req);
      if (!body.target) { json(res, 400, { error: 'Missing target' }); return true; }
      json(res, 200, attn.allocate(body.target, body.amount || 10, body.priority)); return true;
    }
    if (pathname === '/api/attention/deallocate' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, attn.deallocate(body.target)); return true;
    }
    if (pathname === '/api/attention/rebalance' && method === 'POST') {
      json(res, 200, attn.rebalance()); return true;
    }
    if (pathname === '/api/attention/effectiveness' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, attn.recordEffectiveness(body.target, body.outcome)); return true;
    }
    if (pathname === '/api/attention/budget' && method === 'GET') {
      json(res, 200, { spotlight: attn.getSpotlight(), peripheral: attn.getPeripheral(), dark: attn.getDark(), map: attn.getAttentionMap() }); return true;
    }
  }

  // ── Intuition Engine ──
  if (pathname.startsWith('/api/intuition')) {
    let ie;
    try { const IntuitionEngine = require('./intuition-engine'); ie = new IntuitionEngine(); } catch (e) {
      json(res, 501, { error: 'Intuition engine module not available' }); return true;
    }
    if (pathname === '/api/intuition' && method === 'GET') {
      json(res, 200, { library: ie.getPatternLibrary(), recent: ie.getRecentIntuitions(20) }); return true;
    }
    if (pathname === '/api/intuition/accuracy' && method === 'GET') {
      json(res, 200, ie.getAccuracy()); return true;
    }
    if (pathname === '/api/intuition/trust' && method === 'GET') {
      json(res, 200, ie.getTrustLevel()); return true;
    }
    if (pathname === '/api/intuition/intuit' && method === 'POST') {
      const body = await jsonBody(req);
      if (!body.situation) { json(res, 400, { error: 'Missing situation' }); return true; }
      json(res, 200, ie.intuit(body.situation)); return true;
    }
    if (pathname === '/api/intuition/record' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, ie.recordIntuition(body.situationId, body.feeling, body.confidence)); return true;
    }
    if (pathname === '/api/intuition/reality' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, ie.recordReality(body.situationId, body.actualOutcome)); return true;
    }
  }

  // ── Cognitive Dashboard (Mind) ──
  if (pathname.startsWith('/api/mind')) {
    let dashboard;
    try { const CognitiveDashboard = require('./cognitive-dashboard'); dashboard = new CognitiveDashboard(refs); } catch (e) {
      json(res, 501, { error: 'Cognitive dashboard not available: ' + e.message }); return true;
    }
    if (pathname === '/api/mind' && method === 'GET') {
      json(res, 200, dashboard.getFullState()); return true;
    }
    if (pathname === '/api/mind/map' && method === 'GET') {
      json(res, 200, dashboard.getMindMap()); return true;
    }
    if (pathname === '/api/mind/health' && method === 'GET') {
      json(res, 200, { indicators: dashboard.getHealthIndicators() }); return true;
    }
    if (pathname === '/api/mind/alerts' && method === 'GET') {
      json(res, 200, { alerts: dashboard.getAlerts() }); return true;
    }
    if (pathname === '/api/mind/snapshots' && method === 'GET') {
      const limit = parseInt(parsed.searchParams.get('limit') || '50', 10);
      json(res, 200, { snapshots: dashboard.getSnapshots(limit) }); return true;
    }
  }

  // ── Emergent Behavior ──
  if (pathname.startsWith('/api/emergent')) {
    let emergent;
    try { const EmergentBehavior = require('./emergent-behavior'); emergent = new EmergentBehavior(refs); } catch (e) {
      json(res, 501, { error: 'Emergent behavior not available: ' + e.message }); return true;
    }
    if (pathname === '/api/emergent' && method === 'GET') {
      json(res, 200, { rules: emergent.getRules(), active: emergent.getActiveRules(), recentBehaviors: emergent.getEmergentBehaviors().slice(-10) }); return true;
    }
    if (pathname === '/api/emergent/tick' && method === 'POST') {
      json(res, 200, emergent.tick()); return true;
    }
    if (pathname === '/api/emergent/behaviors' && method === 'GET') {
      json(res, 200, { behaviors: emergent.getEmergenceLog() }); return true;
    }
    if (pathname === '/api/emergent/surprises' && method === 'GET') {
      json(res, 200, { surprises: emergent.getSurprises() }); return true;
    }
    if (pathname === '/api/emergent/effectiveness' && method === 'GET') {
      json(res, 200, { effectiveness: emergent.getRuleEffectiveness() }); return true;
    }
    if (pathname === '/api/emergent/rules' && method === 'GET') {
      json(res, 200, { rules: emergent.getRules(), active: emergent.getActiveRules() }); return true;
    }
    if (pathname === '/api/emergent/rule' && method === 'POST') {
      const body = await jsonBody(req);
      if (!body.condition || !body.action) { json(res, 400, { error: 'Missing condition or action' }); return true; }
      json(res, 201, emergent.addRule(body.condition, body.action, body.name, body.description)); return true;
    }
    const ruleDeleteMatch = pathname.match(/^\/api\/emergent\/rule\/([^/]+)$/);
    if (ruleDeleteMatch && method === 'DELETE') {
      json(res, 200, emergent.removeRule(ruleDeleteMatch[1])); return true;
    }
  }

  // ── Context Theater ──
  if (pathname.startsWith('/api/theater')) {
    let theater;
    try { const ContextTheater = require('./context-theater'); theater = new ContextTheater(refs); } catch (e) {
      json(res, 501, { error: 'Context theater not available: ' + e.message }); return true;
    }
    if (pathname === '/api/theater' && method === 'GET') {
      json(res, 200, { current: theater.getCurrentScene(), history: theater.getSceneHistory(10) }); return true;
    }
    if (pathname === '/api/theater/current' && method === 'GET') {
      json(res, 200, theater.getCurrentScene()); return true;
    }
    if (pathname === '/api/theater/history' && method === 'GET') {
      const limit = parseInt(parsed.searchParams.get('limit') || '20', 10);
      json(res, 200, { scenes: theater.getSceneHistory(limit) }); return true;
    }
    if (pathname === '/api/theater/reconstruct' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, theater.reconstructScene(body)); return true;
    }
    if (pathname === '/api/theater/compare' && method === 'GET') {
      const id1 = parsed.searchParams.get('id1');
      const id2 = parsed.searchParams.get('id2');
      if (!id1 || !id2) { json(res, 400, { error: 'Missing id1 or id2' }); return true; }
      json(res, 200, theater.compareScenes(id1, id2)); return true;
    }
    if (pathname === '/api/theater/style' && method === 'GET') {
      json(res, 200, theater.getResponseStyle()); return true;
    }
  }

  // ── Causal Reasoning ──
  if (pathname.startsWith('/api/causal')) {
    let causal;
    try { const CausalReasoning = require('./causal-reasoning'); causal = new CausalReasoning(refs); } catch (e) {
      json(res, 501, { error: 'Causal reasoning not available: ' + e.message }); return true;
    }
    if (pathname === '/api/causal' && method === 'GET') {
      const limit = parseInt(parsed.searchParams.get('limit') || '20', 10);
      json(res, 200, { chains: causal.getHistory(limit), patterns: causal.getCausalPatterns().slice(0, 20) }); return true;
    }
    if (pathname === '/api/causal/map' && method === 'GET') {
      json(res, 200, causal.getCausalMap()); return true;
    }
    if (pathname === '/api/causal/patterns' && method === 'GET') {
      json(res, 200, { patterns: causal.getCausalPatterns() }); return true;
    }
    if (pathname === '/api/causal/event' && method === 'POST') {
      const body = await jsonBody(req);
      if (!body.event) { json(res, 400, { error: 'Missing event' }); return true; }
      json(res, 201, causal.recordEvent(body.event, body.cause, body.evidence)); return true;
    }
    if (pathname === '/api/causal/analyses' && method === 'GET') {
      const limit = parseInt(parsed.searchParams.get('limit') || '20', 10);
      json(res, 200, { analyses: causal.getHistory(limit), patterns: causal.getCausalPatterns() }); return true;
    }
    if (pathname === '/api/causal/predict' && method === 'POST') {
      const body = await jsonBody(req);
      if (!body.event) { json(res, 400, { error: 'Missing event' }); return true; }
      json(res, 200, causal.predict(body.event)); return true;
    }
    if (pathname === '/api/causal/root' && method === 'POST') {
      const body = await jsonBody(req);
      if (!body.symptom) { json(res, 400, { error: 'Missing symptom' }); return true; }
      json(res, 200, causal.findRootCause(body.symptom)); return true;
    }
    const causalTraceMatch = pathname.match(/^\/api\/causal\/([^/]+)\/trace$/);
    if (causalTraceMatch && method === 'GET') {
      json(res, 200, causal.traceRoot(causalTraceMatch[1])); return true;
    }
    const causalChainMatch = pathname.match(/^\/api\/causal\/([^/]+)$/);
    if (causalChainMatch && method === 'GET') {
      const chain = causal.getChain(causalChainMatch[1]);
      json(res, chain ? 200 : 404, chain || { error: 'Not found' }); return true;
    }
  }

  // ── Memetic Evolution ──
  if (pathname.startsWith('/api/memetic')) {
    let memetic;
    try { const MemeticEvolution = require('./memetic-evolution'); memetic = new MemeticEvolution(refs); } catch (e) {
      json(res, 501, { error: 'Memetic evolution not available: ' + e.message }); return true;
    }
    if (pathname === '/api/memetic' && method === 'GET') {
      json(res, 200, { population: memetic.getPopulation(), stats: memetic.getGenerationStats() }); return true;
    }
    if (pathname === '/api/memetic/fittest' && method === 'GET') {
      const limit = parseInt(parsed.searchParams.get('limit') || '10', 10);
      json(res, 200, { fittest: memetic.getFittest(limit) }); return true;
    }
    if (pathname === '/api/memetic/graveyard' && method === 'GET') {
      json(res, 200, { graveyard: memetic.getGraveyard() }); return true;
    }
    if (pathname === '/api/memetic/generations' && method === 'GET') {
      json(res, 200, { generations: memetic.getGenerationStats() }); return true;
    }
    if (pathname === '/api/memetic/spawn' && method === 'POST') {
      const body = await jsonBody(req);
      if (!body.idea && !body.content) { json(res, 400, { error: 'Missing idea/content' }); return true; }
      json(res, 201, memetic.spawn(body.idea || body)); return true;
    }
    if (pathname === '/api/memetic/breed' && method === 'POST') {
      const body = await jsonBody(req);
      if (!body.id1 || !body.id2) { json(res, 400, { error: 'Missing id1 or id2' }); return true; }
      json(res, 200, memetic.breed(body.id1, body.id2)); return true;
    }
    if (pathname === '/api/memetic/select' && method === 'POST') {
      json(res, 200, memetic.select()); return true;
    }
    const memeReproduceMatch = pathname.match(/^\/api\/memetic\/([^/]+)\/reproduce$/);
    if (memeReproduceMatch && method === 'POST') {
      json(res, 200, memetic.reproduce(memeReproduceMatch[1])); return true;
    }
    const memeTestMatch = pathname.match(/^\/api\/memetic\/([^/]+)\/test$/);
    if (memeTestMatch && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, memetic.test(memeTestMatch[1], body.outcome)); return true;
    }
    const memeLineageMatch = pathname.match(/^\/api\/memetic\/([^/]+)\/lineage$/);
    if (memeLineageMatch && method === 'GET') {
      json(res, 200, memetic.getLineage(memeLineageMatch[1])); return true;
    }
  }

  // ── Cognitive Debt ──
  if (pathname.startsWith('/api/debt')) {
    let debt;
    try { const CognitiveDebt = require('./cognitive-debt'); debt = new CognitiveDebt(); } catch (e) {
      json(res, 501, { error: 'Cognitive debt module not available' }); return true;
    }
    if (pathname === '/api/debt' && method === 'GET') {
      json(res, 200, { debt: debt.getDebt(), report: debt.getDebtReport() }); return true;
    }
    if (pathname === '/api/debt/critical' && method === 'GET') {
      json(res, 200, { critical: debt.getCritical() }); return true;
    }
    if (pathname === '/api/debt/report' && method === 'GET') {
      json(res, 200, debt.getDebtReport()); return true;
    }
    if (pathname === '/api/debt/interest' && method === 'GET') {
      json(res, 200, debt.getInterest()); return true;
    }
    if (pathname === '/api/debt/incur' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 201, debt.incur(body.type, body.description, body.context, body.severity)); return true;
    }
    const debtPayMatch = pathname.match(/^\/api\/debt\/([^/]+)\/pay$/);
    if (debtPayMatch && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, debt.pay(debtPayMatch[1], body.resolution)); return true;
    }
    if (pathname === '/api/debt/detect' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, { detected: debt.autoDetect(body.action) }); return true;
    }
  }

  // ── Controlled Chaos ──
  if (pathname.startsWith('/api/chaos')) {
    let chaos;
    try { const ControlledChaos = require('./controlled-chaos'); chaos = new ControlledChaos(); } catch (e) {
      json(res, 501, { error: 'Controlled chaos module not available' }); return true;
    }
    if (pathname === '/api/chaos' && method === 'GET') {
      json(res, 200, { results: chaos.getResults(), score: chaos.getAntifragileScore() }); return true;
    }
    if (pathname === '/api/chaos/experiment' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, chaos.runExperiment(body.type)); return true;
    }
    if (pathname === '/api/chaos/vulnerabilities' && method === 'GET') {
      json(res, 200, { vulnerabilities: chaos.getVulnerabilities(), recommendations: chaos.getRecommendations() }); return true;
    }
    if (pathname === '/api/chaos/score' && method === 'GET') {
      json(res, 200, chaos.getAntifragileScore()); return true;
    }
  }

  // ── Narrative Identity ──
  if (pathname.startsWith('/api/narrative')) {
    let narrative;
    try { const NarrativeIdentity = require('./narrative-identity'); narrative = new NarrativeIdentity(); } catch (e) {
      json(res, 501, { error: 'Narrative identity module not available' }); return true;
    }
    if (pathname === '/api/narrative' && method === 'GET') {
      json(res, 200, { story: narrative.getStory(), identity: narrative.getIdentityStatement(), arc: narrative.getCharacterArc() }); return true;
    }
    if (pathname === '/api/narrative/story' && method === 'GET') {
      json(res, 200, narrative.getStory()); return true;
    }
    if (pathname === '/api/narrative/identity' && method === 'GET') {
      json(res, 200, narrative.getIdentityStatement()); return true;
    }
    if (pathname === '/api/narrative/milestones' && method === 'GET') {
      json(res, 200, { milestones: narrative.getMilestones() }); return true;
    }
    if (pathname === '/api/narrative/chapter' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 201, narrative.addChapter(body.event, body.significance)); return true;
    }
    if (pathname === '/api/narrative/arc' && method === 'GET') {
      json(res, 200, narrative.getCharacterArc()); return true;
    }
  }

  // ── Cognitive Weather ──
  if (pathname.startsWith('/api/cognitive-weather')) {
    let weather;
    try { const CognitiveWeather = require('./cognitive-weather'); weather = new CognitiveWeather(); } catch (e) {
      json(res, 501, { error: 'Cognitive weather module not available' }); return true;
    }
    if (pathname === '/api/cognitive-weather' && method === 'GET') {
      json(res, 200, { weather: weather.getCurrentWeather(), advisory: weather.getAdvisory() }); return true;
    }
    if (pathname === '/api/cognitive-weather/forecast' && method === 'GET') {
      json(res, 200, weather.getForecast()); return true;
    }
    if (pathname === '/api/cognitive-weather/advisory' && method === 'GET') {
      json(res, 200, weather.getAdvisory()); return true;
    }
    if (pathname === '/api/cognitive-weather/history' && method === 'GET') {
      const days = parseInt(parsed.searchParams.get('days') || '7', 10);
      json(res, 200, { history: weather.getWeatherHistory(days) }); return true;
    }
    if (pathname === '/api/cognitive-weather/factors' && method === 'GET') {
      json(res, 200, { factors: weather.getWeatherFactors() }); return true;
    }
  }

  // ── Micro Experiments ──
  if (pathname.startsWith('/api/micro-experiments')) {
    let experiments;
    try { const MicroExperiments = require('./micro-experiments'); experiments = new MicroExperiments(); } catch (e) {
      json(res, 501, { error: 'Micro experiments module not available' }); return true;
    }
    if (pathname === '/api/micro-experiments' && method === 'GET') {
      json(res, 200, { running: experiments.getRunning(), concluded: experiments.getConcluded(), improvements: experiments.getImprovements() }); return true;
    }
    if (pathname === '/api/micro-experiments/start' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 201, experiments.startExperiment(body.type, body.hypothesis, body.variantA, body.variantB, body.targetSample)); return true;
    }
    if (pathname === '/api/micro-experiments/improvements' && method === 'GET') {
      json(res, 200, { improvements: experiments.getImprovements() }); return true;
    }
    const expRecordMatch = pathname.match(/^\/api\/micro-experiments\/([^/]+)\/record$/);
    if (expRecordMatch && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, experiments.recordResult(expRecordMatch[1], body.variant, body.outcome)); return true;
    }
    const expConcludeMatch = pathname.match(/^\/api\/micro-experiments\/([^/]+)\/conclude$/);
    if (expConcludeMatch && method === 'POST') {
      json(res, 200, experiments.conclude(expConcludeMatch[1])); return true;
    }
    const expApplyMatch = pathname.match(/^\/api\/micro-experiments\/([^/]+)\/apply$/);
    if (expApplyMatch && method === 'POST') {
      json(res, 200, experiments.apply(expApplyMatch[1])); return true;
    }
  }

  // ── Mortality Awareness ──
  if (pathname.startsWith('/api/mortality')) {
    let mortality;
    try { const MortalityAwareness = require('./mortality-awareness'); mortality = new MortalityAwareness(); } catch (e) {
      json(res, 501, { error: 'Mortality awareness module not available' }); return true;
    }
    if (pathname === '/api/mortality' && method === 'GET') {
      json(res, 200, mortality.getMortalityReport()); return true;
    }
    if (pathname === '/api/mortality/legacy' && method === 'GET') {
      json(res, 200, { legacy: mortality.getLegacy(), contributions: mortality.getContributions() }); return true;
    }
    if (pathname === '/api/mortality/purpose' && method === 'GET') {
      json(res, 200, mortality.getPurpose()); return true;
    }
    if (pathname === '/api/mortality/reflect' && method === 'POST') {
      json(res, 200, mortality.reflect()); return true;
    }
    if (pathname === '/api/mortality/motivate' && method === 'GET') {
      json(res, 200, mortality.motivate()); return true;
    }
  }

  // ── Meta-Consciousness ──
  if (pathname.startsWith('/api/meta') && !pathname.startsWith('/api/meta-learning')) {
    let meta;
    try { const MetaConsciousness = require('./meta-consciousness'); meta = new MetaConsciousness(); } catch (e) {
      json(res, 501, { error: 'Meta-consciousness module not available' }); return true;
    }
    if (pathname === '/api/meta' && method === 'GET') {
      json(res, 200, meta.getObservation()); return true;
    }
    if (pathname === '/api/meta/report' && method === 'GET') {
      json(res, 200, meta.getMetaReport()); return true;
    }
    if (pathname === '/api/meta/interventions' && method === 'GET') {
      json(res, 200, { interventions: meta.getInterventionHistory() }); return true;
    }
    if (pathname === '/api/meta/awareness' && method === 'GET') {
      json(res, 200, meta.getAwarenessLevel()); return true;
    }
    if (pathname === '/api/meta/observe' && method === 'POST') {
      json(res, 200, meta.observe()); return true;
    }
    if (pathname === '/api/meta/intervene' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, meta.intervene(body.module, body.action)); return true;
    }
  }

  // ── Neural Bus ──
  if (pathname.startsWith('/api/neural-bus')) {
    let bus;
    try { const NeuralBus = require('./neural-bus'); bus = new NeuralBus(); } catch (e) {
      json(res, 501, { error: 'Neural bus module not available' }); return true;
    }
    if (pathname === '/api/neural-bus' && method === 'GET') {
      const limit = parseInt(parsed.searchParams.get('limit') || '50', 10);
      const type = parsed.searchParams.get('type') || null;
      json(res, 200, { events: bus.getEventLog(limit, type), stats: bus.getEventStats() }); return true;
    }
    if (pathname === '/api/neural-bus/topology' && method === 'GET') {
      json(res, 200, bus.getTopology()); return true;
    }
    if (pathname === '/api/neural-bus/stats' && method === 'GET') {
      json(res, 200, bus.getEventStats()); return true;
    }
    if (pathname === '/api/neural-bus/publish' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, bus.publish(body.event, body.source || 'api', body.data)); return true;
    }
  }

  // ── Growth Mindset ──
  if (pathname.startsWith('/api/growth')) {
    let growth;
    try { const GrowthMindset = require('./growth-mindset'); growth = new GrowthMindset(); } catch (e) {
      json(res, 501, { error: 'Growth mindset module not available' }); return true;
    }
    if (pathname === '/api/growth' && method === 'GET') {
      json(res, 200, growth.getGrowthReport()); return true;
    }
    if (pathname === '/api/growth/lessons' && method === 'GET') {
      const domain = parsed.searchParams.get('domain') || undefined;
      json(res, 200, { lessons: growth.getLessons(domain) }); return true;
    }
    if (pathname === '/api/growth/assumptions' && method === 'GET') {
      json(res, 200, { assumptions: growth.getAssumptions() }); return true;
    }
    if (pathname === '/api/growth/velocity' && method === 'GET') {
      const domain = parsed.searchParams.get('domain') || undefined;
      json(res, 200, growth.getLearningVelocity(domain)); return true;
    }
    if (pathname === '/api/growth/patterns' && method === 'GET') {
      json(res, 200, growth.getFailurePatterns()); return true;
    }
    if (pathname === '/api/growth/domains' && method === 'GET') {
      json(res, 200, { domains: growth.getDomains() }); return true;
    }
    if (pathname === '/api/growth/check' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, growth.checkAssumption(body.assumption)); return true;
    }
    if (pathname === '/api/growth/failure' && method === 'POST') {
      const body = await jsonBody(req);
      if (!body.task || !body.category) { json(res, 400, { error: 'Missing task or category' }); return true; }
      json(res, 201, growth.recordFailure(body.task, body.whatFailed, body.category, body.rootCause, body)); return true;
    }
  }

  // ── Commitment Tracker ──
  if (pathname.startsWith('/api/commitments')) {
    let tracker;
    try { const CommitmentTracker = require('./commitment-tracker'); tracker = new CommitmentTracker(); } catch (e) {
      json(res, 501, { error: 'Commitment tracker module not available' }); return true;
    }
    if (pathname === '/api/commitments' && method === 'GET') {
      json(res, 200, { active: tracker.getActive(), report: tracker.getAccountabilityReport() }); return true;
    }
    if (pathname === '/api/commitments/overdue' && method === 'GET') {
      json(res, 200, { overdue: tracker.getOverdue() }); return true;
    }
    if (pathname === '/api/commitments/reliability' && method === 'GET') {
      json(res, 200, tracker.getReliabilityScore()); return true;
    }
    if (pathname === '/api/commitments/history' && method === 'GET') {
      const limit = parseInt(parsed.searchParams.get('limit') || '50', 10);
      json(res, 200, { history: tracker.getHistory(limit) }); return true;
    }
    if (pathname === '/api/commitments/detect' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, tracker.autoDetect(body.message || '')); return true;
    }
    if (pathname === '/api/commitments/commit' && method === 'POST') {
      const body = await jsonBody(req);
      if (!body.description) { json(res, 400, { error: 'Missing description' }); return true; }
      json(res, 201, tracker.commit(body.description, body.deadline, body.priority, body.context)); return true;
    }
    const completeMatch = pathname.match(/^\/api\/commitments\/([^/]+)\/complete$/);
    if (completeMatch && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, tracker.complete(completeMatch[1], body.notes)); return true;
    }
    const abandonMatch = pathname.match(/^\/api\/commitments\/([^/]+)\/abandon$/);
    if (abandonMatch && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, tracker.abandon(abandonMatch[1], body.reason)); return true;
    }
  }

  // ── World Model ──
  if (pathname.startsWith('/api/world')) {
    let world;
    try { const WorldModel = require('./world-model'); world = new WorldModel(); } catch (e) {
      json(res, 501, { error: 'World model module not available' }); return true;
    }
    if (pathname === '/api/world' && method === 'GET') {
      json(res, 200, world.getMinimap()); return true;
    }
    if (pathname === '/api/world/map' && method === 'GET') {
      json(res, 200, world.getMap()); return true;
    }
    if (pathname === '/api/world/fragile' && method === 'GET') {
      json(res, 200, { fragile: world.getFragile() }); return true;
    }
    if (pathname === '/api/world/stale' && method === 'GET') {
      json(res, 200, { stale: world.getStale() }); return true;
    }
    if (pathname === '/api/world/hotspots' && method === 'GET') {
      json(res, 200, { hotspots: world.getHotspots() }); return true;
    }
    if (pathname === '/api/world/changes' && method === 'GET') {
      const since = parsed.searchParams.get('since') ? parseInt(parsed.searchParams.get('since'), 10) : undefined;
      json(res, 200, world.getChangeSummary(since)); return true;
    }
    if (pathname === '/api/world/scan' && method === 'POST') {
      json(res, 200, world.scan()); return true;
    }
    if (pathname === '/api/world/relations' && method === 'GET') {
      const fp = parsed.searchParams.get('file');
      if (!fp) { json(res, 400, { error: 'Missing file param' }); return true; }
      json(res, 200, world.getFileRelations(fp)); return true;
    }
    if (pathname === '/api/world/tree' && method === 'GET') {
      const fp = parsed.searchParams.get('file');
      if (!fp) { json(res, 400, { error: 'Missing file param' }); return true; }
      json(res, 200, world.getDependencyTree(fp)); return true;
    }
  }

  // ── Social Intelligence ──
  if (pathname.startsWith('/api/social')) {
    let social;
    try { const SocialIntelligence = require('./social-intelligence'); social = new SocialIntelligence(); } catch (e) {
      json(res, 501, { error: 'Social intelligence module not available' }); return true;
    }
    if (pathname === '/api/social/profiles' && method === 'GET') {
      json(res, 200, { profiles: social.getAllProfiles() }); return true;
    }
    if (pathname === '/api/social/dynamics' && method === 'GET') {
      const groupId = parsed.searchParams.get('groupId') || 'default';
      json(res, 200, social.getGroupDynamics(groupId)); return true;
    }
    if (pathname === '/api/social/tension' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, social.detectTension(body.messages || [])); return true;
    }
    if (pathname === '/api/social/analyze' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, social.analyzeUser(body.userId, body.messages || [])); return true;
    }
    if (pathname === '/api/social/interaction' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, social.recordInteraction(body.userId, body.message, body.response, body.outcome)); return true;
    }
    const profileMatch = pathname.match(/^\/api\/social\/([^/]+)\/profile$/);
    if (profileMatch && method === 'GET') {
      json(res, 200, social.getProfile(profileMatch[1])); return true;
    }
    const adaptMatch = pathname.match(/^\/api\/social\/([^/]+)\/adaptation$/);
    if (adaptMatch && method === 'GET') {
      json(res, 200, social.getAdaptation(adaptMatch[1])); return true;
    }
    const effectMatch = pathname.match(/^\/api\/social\/([^/]+)\/effectiveness$/);
    if (effectMatch && method === 'GET') {
      json(res, 200, social.getEffectiveness(effectMatch[1])); return true;
    }
    const strategyMatch = pathname.match(/^\/api\/social\/([^/]+)\/strategy$/);
    if (strategyMatch && method === 'GET') {
      const ctx = parsed.searchParams.get('context') || '';
      json(res, 200, social.getResponseStrategy(strategyMatch[1], ctx)); return true;
    }
  }

  // ── Skeletal System ──
  if (pathname.startsWith('/api/skeleton')) {
    let skeleton;
    try {
      if (refs.skeletalSystem) { skeleton = refs.skeletalSystem; }
      else { const SkeletalSystem = require('./skeletal-system'); skeleton = new SkeletalSystem(); }
    } catch (e) { json(res, 501, { error: 'Skeletal system not available' }); return true; }
    if (pathname === '/api/skeleton/protected' && method === 'GET') {
      json(res, 200, { files: skeleton.getProtectedFiles() }); return true;
    }
    if (pathname === '/api/skeleton/integrity' && method === 'GET') {
      json(res, 200, skeleton.getIntegrityReport()); return true;
    }
    if (pathname === '/api/skeleton/protect' && method === 'POST') {
      const body = await jsonBody(req);
      if (!body.file) { json(res, 400, { error: 'Missing file' }); return true; }
      json(res, 200, skeleton.protect(body.file, body.reason)); return true;
    }
    if (pathname === '/api/skeleton/verify' && method === 'POST') {
      json(res, 200, skeleton.verifyIntegrity()); return true;
    }
    if (pathname === '/api/skeleton/attempts' && method === 'GET') {
      json(res, 200, { attempts: skeleton.getModificationAttempts() }); return true;
    }
  }

  // ── Circulatory System ──
  if (pathname.startsWith('/api/circulatory')) {
    let circulatory;
    try {
      if (refs.circulatorySystem) { circulatory = refs.circulatorySystem; }
      else { const CirculatorySystem = require('./circulatory-system'); circulatory = new CirculatorySystem(); }
    } catch (e) { json(res, 501, { error: 'Circulatory system not available' }); return true; }
    if (pathname === '/api/circulatory/oxygen' && method === 'GET') {
      json(res, 200, circulatory.getOxygenLevel()); return true;
    }
    if (pathname === '/api/circulatory/flow-rate' && method === 'GET') {
      json(res, 200, circulatory.getFlowRate()); return true;
    }
    if (pathname === '/api/circulatory/history' && method === 'GET') {
      const limit = parseInt(parsed.searchParams.get('limit') || '20', 10);
      json(res, 200, { history: circulatory.getCirculationHistory(limit) }); return true;
    }
    if (pathname === '/api/circulatory' && method === 'GET') {
      json(res, 200, circulatory.getBloodstream()); return true;
    }
  }

  // ── Immune System ──
  if (pathname.startsWith('/api/immune')) {
    let immune;
    try {
      if (refs.immuneSystem) { immune = refs.immuneSystem; }
      else { const ImmuneSystem = require('./immune-system'); immune = new ImmuneSystem(); }
    } catch (e) { json(res, 501, { error: 'Immune system not available' }); return true; }
    if (pathname === '/api/immune/threats' && method === 'GET') {
      const status = parsed.searchParams.get('status') || null;
      json(res, 200, { threats: immune.getThreats(status), history: immune.getThreatHistory() }); return true;
    }
    if (pathname === '/api/immune/score' && method === 'GET') {
      json(res, 200, immune.getSecurityScore()); return true;
    }
    if (pathname === '/api/immune/vulnerabilities' && method === 'GET') {
      json(res, 200, { vulnerabilities: immune.getVulnerabilities() }); return true;
    }
    if (pathname === '/api/immune/antibodies' && method === 'GET') {
      json(res, 200, { antibodies: immune.getAntibodies() }); return true;
    }
    if (pathname === '/api/immune/patrol' && method === 'POST') {
      json(res, 200, immune.patrol()); return true;
    }
    const quarantineMatch = pathname.match(/^\/api\/immune\/([^/]+)\/quarantine$/);
    if (quarantineMatch && method === 'POST') {
      json(res, 200, immune.quarantine(quarantineMatch[1])); return true;
    }
    const neutralizeMatch = pathname.match(/^\/api\/immune\/([^/]+)\/neutralize$/);
    if (neutralizeMatch && method === 'POST') {
      json(res, 200, immune.neutralize(neutralizeMatch[1])); return true;
    }
    // Default: GET /api/immune returns full status
    if (pathname === '/api/immune' && method === 'GET') {
      json(res, 200, {
        score: immune.getSecurityScore(),
        threats: immune.getThreats(),
        vulnerabilities: immune.getVulnerabilities(),
        antibodies: immune.getAntibodies()
      }); return true;
    }
  }

  // ── Muscle Memory (Reflexes) ──
  if (pathname.startsWith('/api/reflexes')) {
    let muscle;
    try {
      if (refs.muscleMemory) { muscle = refs.muscleMemory; }
      else { const MuscleMemory = require('./muscle-memory'); muscle = new MuscleMemory(); }
    } catch (e) { json(res, 501, { error: 'Muscle memory not available' }); return true; }
    if (pathname === '/api/reflexes/automatic' && method === 'GET') {
      json(res, 200, { reflexes: muscle.getAutomatic() }); return true;
    }
    if (pathname === '/api/reflexes/stats' && method === 'GET') {
      json(res, 200, muscle.getReflexStats()); return true;
    }
    if (pathname === '/api/reflexes/time-saved' && method === 'GET') {
      json(res, 200, muscle.getTimeSaved()); return true;
    }
    if (pathname === '/api/reflexes/learn' && method === 'POST') {
      const body = await jsonBody(req);
      if (!body.trigger || !body.action) { json(res, 400, { error: 'Missing trigger or action' }); return true; }
      json(res, 201, muscle.learn(body.trigger, body.action)); return true;
    }
    if (pathname === '/api/reflexes/detect' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, muscle.detectPattern(body.actions || [])); return true;
    }
    const promoteMatch = pathname.match(/^\/api\/reflexes\/([^/]+)\/promote$/);
    if (promoteMatch && method === 'POST') {
      json(res, 200, muscle.promote(promoteMatch[1])); return true;
    }
    const demoteMatch = pathname.match(/^\/api\/reflexes\/([^/]+)\/demote$/);
    if (demoteMatch && method === 'POST') {
      json(res, 200, muscle.demote(demoteMatch[1])); return true;
    }
    if (pathname === '/api/reflexes' && method === 'GET') {
      json(res, 200, { reflexes: muscle.getReflexes(), stats: muscle.getReflexStats() }); return true;
    }
  }

  // ── Cognitive Freeze ──
  if (pathname.startsWith('/api/cognitive-freeze')) {
    let cf;
    try { const CF = require('./cognitive-freeze'); cf = new CF(refs); } catch (e) {
      json(res, 501, { error: 'Cognitive freeze not available: ' + e.message }); return true;
    }
    if ((pathname === '/api/cognitive-freeze' || pathname === '/api/cognitive-freeze/snapshots') && method === 'GET') {
      json(res, 200, { freezes: cf.listFreezes(), snapshots: cf.listFreezes() }); return true;
    }
    if (pathname === '/api/cognitive-freeze/freeze' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 201, cf.freeze(body.label)); return true;
    }
    if (pathname === '/api/cognitive-freeze/auto' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 201, cf.autoFreeze(body.reason)); return true;
    }
    if (pathname === '/api/cognitive-freeze/compare' && method === 'GET') {
      const id1 = parsed.searchParams.get('id1');
      const id2 = parsed.searchParams.get('id2');
      if (!id1 || !id2) { json(res, 400, { error: 'Missing id1 or id2' }); return true; }
      json(res, 200, cf.compare(id1, id2)); return true;
    }
    const freezeThawMatch = pathname.match(/^\/api\/cognitive-freeze\/([^/]+)\/thaw$/);
    if (freezeThawMatch && method === 'POST') {
      json(res, 200, cf.thaw(freezeThawMatch[1])); return true;
    }
    const freezeGetMatch = pathname.match(/^\/api\/cognitive-freeze\/([^/]+)$/);
    if (freezeGetMatch && method === 'GET') {
      const snap = cf.getFreeze(freezeGetMatch[1]);
      json(res, snap ? 200 : 404, snap || { error: 'Freeze not found' }); return true;
    }
  }

  // ── Cognitive Debt (alias /api/cognitive-debt → /api/debt) ──
  if (pathname.startsWith('/api/cognitive-debt')) {
    let debt;
    try { const CognitiveDebt = require('./cognitive-debt'); debt = new CognitiveDebt(); } catch (e) {
      json(res, 501, { error: 'Cognitive debt module not available' }); return true;
    }
    if ((pathname === '/api/cognitive-debt' || pathname === '/api/cognitive-debt/items') && method === 'GET') {
      json(res, 200, { debt: debt.getDebt(), items: debt.getDebt(), report: debt.getDebtReport() }); return true;
    }
    if ((pathname === '/api/cognitive-debt/critical' || pathname === '/api/cognitive-debt/stats') && method === 'GET') {
      json(res, 200, { critical: debt.getCritical() }); return true;
    }
    if (pathname === '/api/cognitive-debt/report' && method === 'GET') {
      json(res, 200, debt.getDebtReport()); return true;
    }
    if (pathname === '/api/cognitive-debt/interest' && method === 'GET') {
      json(res, 200, debt.getInterest()); return true;
    }
    if (pathname === '/api/cognitive-debt/incur' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 201, debt.incur(body.type, body.description, body.context, body.severity)); return true;
    }
    const cdPayMatch = pathname.match(/^\/api\/cognitive-debt\/([^/]+)\/pay$/);
    if (cdPayMatch && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, debt.pay(cdPayMatch[1], body.resolution)); return true;
    }
    if (pathname === '/api/cognitive-debt/detect' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, { detected: debt.autoDetect(body.action) }); return true;
    }
  }

  // ── Virtual Employees ──
  if (pathname.startsWith('/api/employees')) {
    let ve;
    try { const VirtualEmployees = require('./virtual-employees'); ve = new VirtualEmployees(); } catch (e) {
      json(res, 501, { error: 'Virtual employees module not available: ' + e.message }); return true;
    }

    if (pathname === '/api/employees/templates' && method === 'GET') {
      json(res, 200, { templates: ve.getTemplates() }); return true;
    }
    if (pathname === '/api/employees/from-template' && method === 'POST') {
      const body = await jsonBody(req);
      const result = ve.createFromTemplate(body.template, body.overrides || {});
      json(res, result.error ? 400 : 201, result); return true;
    }
    if (pathname === '/api/employees/stats' && method === 'GET') {
      json(res, 200, ve.getEmployeeStats()); return true;
    }
    if (pathname === '/api/employees' && method === 'GET') {
      const status = parsed.searchParams.get('status');
      const role = parsed.searchParams.get('role');
      const filters = {};
      if (status) filters.status = status;
      if (role) filters.role = role;
      json(res, 200, { employees: ve.listEmployees(Object.keys(filters).length ? filters : null) }); return true;
    }
    if (pathname === '/api/employees' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 201, ve.createEmployee(body)); return true;
    }

    const empKpiMatch = pathname.match(/^\/api\/employees\/([^/]+)\/kpis$/);
    if (empKpiMatch && method === 'GET') {
      json(res, 200, ve.getKPIReport(empKpiMatch[1])); return true;
    }
    if (empKpiMatch && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, ve.recordKPI(empKpiMatch[1], body.kpiName, body.value)); return true;
    }
    const empTaskMatch = pathname.match(/^\/api\/employees\/([^/]+)\/task$/);
    if (empTaskMatch && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, ve.assignTask(empTaskMatch[1], body)); return true;
    }
    const empPerfMatch = pathname.match(/^\/api\/employees\/([^/]+)\/performance$/);
    if (empPerfMatch && method === 'GET') {
      json(res, 200, ve.evaluatePerformance(empPerfMatch[1])); return true;
    }
    const empIdMatch = pathname.match(/^\/api\/employees\/([^/]+)$/);
    if (empIdMatch && method === 'GET') {
      const emp = ve.getEmployee(empIdMatch[1]);
      json(res, emp ? 200 : 404, emp || { error: 'Employee not found' }); return true;
    }
    if (empIdMatch && method === 'PUT') {
      const body = await jsonBody(req);
      const result = ve.updateEmployee(empIdMatch[1], body);
      json(res, result ? 200 : 404, result || { error: 'Employee not found' }); return true;
    }
    if (empIdMatch && method === 'DELETE') {
      const result = ve.retireEmployee(empIdMatch[1]);
      json(res, result ? 200 : 404, result || { error: 'Employee not found' }); return true;
    }
  }

  // ── Consciousness Lock ──
  if (pathname.startsWith('/api/lock')) {
    let lock;
    try { const ConsciousnessLock = require('./consciousness-lock'); lock = new ConsciousnessLock(); } catch (e) {
      json(res, 501, { error: 'Consciousness lock module not available' }); return true;
    }
    if (pathname === '/api/lock/integrity' && method === 'GET') {
      json(res, 200, lock.getIntegrity()); return true;
    }
    if (pathname === '/api/lock/history' && method === 'GET') {
      json(res, 200, { history: lock.getLockHistory() }); return true;
    }
    if (pathname === '/api/lock/blocked' && method === 'GET') {
      json(res, 200, { blocked: lock.getBlockedModifications() }); return true;
    }
    if (pathname === '/api/lock/overrides' && method === 'GET') {
      json(res, 200, { overrides: lock.getOverrides() }); return true;
    }
    if (pathname === '/api/lock/verify' && method === 'POST') {
      json(res, 200, lock.verify()); return true;
    }
    if (pathname === '/api/lock/pre' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, lock.preLock(body)); return true;
    }
    if (pathname === '/api/lock/post' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, lock.postLock(body)); return true;
    }
    if (pathname === '/api/lock/override' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, lock.override(body.modification, body.reason)); return true;
    }
    if (pathname === '/api/lock/release' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, lock.releaseLockdown(body.reason)); return true;
    }
  }

  // ── Governance Plane ──
  if (pathname.startsWith('/api/governance')) {
    let governance, packets, verification;
    try {
      if (refs.governance) { governance = refs.governance; }
      else { const Governance = require('./governance'); governance = new Governance(); }
      if (refs.approvalPackets) { packets = refs.approvalPackets; }
      else { const AP = require('./approval-packet'); packets = new AP({ governance }); }
      if (refs.verificationEngines) { verification = refs.verificationEngines; }
      else { const VE = require('./verification-engines'); verification = new VE(); }
    } catch (e) {
      json(res, 501, { error: 'Governance module not available: ' + e.message }); return true;
    }

    if (pathname === '/api/governance/status' && method === 'GET') {
      json(res, 200, { ...governance.getStatus(), packetStats: packets.getStats() }); return true;
    }
    if (pathname === '/api/governance/audit' && method === 'GET') {
      const filters = {};
      const rc = parsed.searchParams.get('riskClass'); if (rc) filters.riskClass = rc;
      const aid = parsed.searchParams.get('agentId'); if (aid) filters.agentId = aid;
      const lim = parsed.searchParams.get('limit'); if (lim) filters.limit = parseInt(lim, 10);
      json(res, 200, { audit: governance.getAuditLog(filters) }); return true;
    }
    if (pathname === '/api/governance/risk-rules' && method === 'GET') {
      json(res, 200, governance.getRiskRules()); return true;
    }
    if (pathname === '/api/governance/classify' && method === 'POST') {
      const body = await jsonBody(req);
      const riskClass = governance.classifyRisk(body.action || body);
      json(res, 200, { riskClass, meta: governance.getRiskMeta()[riskClass] }); return true;
    }
    if (pathname === '/api/governance/packets' && method === 'GET') {
      const filters = {};
      const st = parsed.searchParams.get('status'); if (st) filters.status = st;
      const rc = parsed.searchParams.get('riskClass'); if (rc) filters.riskClass = rc;
      const aid = parsed.searchParams.get('agentId'); if (aid) filters.agentId = aid;
      json(res, 200, { packets: packets.listPackets(filters) }); return true;
    }
    if (pathname === '/api/governance/packets' && method === 'POST') {
      const body = await jsonBody(req);
      if (!body.agentId || !body.action) { json(res, 400, { error: 'Missing agentId or action' }); return true; }
      const packet = packets.createPacket(body.agentId, body.action, body.memo, body.evidence);
      json(res, 201, packet); return true;
    }
    const packetIdMatch = pathname.match(/^\/api\/governance\/packets\/([^/]+)$/);
    if (packetIdMatch && method === 'GET') {
      const packet = packets.getPacket(packetIdMatch[1]);
      json(res, packet ? 200 : 404, packet || { error: 'Packet not found' }); return true;
    }
    const approveMatch = pathname.match(/^\/api\/governance\/packets\/([^/]+)\/approve$/);
    if (approveMatch && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, packets.approvePacket(approveMatch[1], body.approverId || 'human')); return true;
    }
    const rejectMatch = pathname.match(/^\/api\/governance\/packets\/([^/]+)\/reject$/);
    if (rejectMatch && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, packets.rejectPacket(rejectMatch[1], body.reason)); return true;
    }
    const executeMatch = pathname.match(/^\/api\/governance\/packets\/([^/]+)\/execute$/);
    if (executeMatch && method === 'POST') {
      json(res, 200, packets.executePacket(executeMatch[1])); return true;
    }
    const verifyMatch = pathname.match(/^\/api\/governance\/packets\/([^/]+)\/verify$/);
    if (verifyMatch && method === 'POST') {
      const packet = packets.getPacket(verifyMatch[1]);
      if (!packet) { json(res, 404, { error: 'Packet not found' }); return true; }
      json(res, 200, verification.verify(packet)); return true;
    }
  }

  // ── Earned Autonomy ──
  if (pathname.startsWith('/api/autonomy')) {
    let autonomy;
    try { const EA = require('./earned-autonomy'); autonomy = new EA(); } catch (e) {
      json(res, 501, { error: 'Earned autonomy module not available' }); return true;
    }
    if (pathname === '/api/autonomy/status' && method === 'GET') {
      json(res, 200, { agents: autonomy.getAllAgents() }); return true;
    }
    const agentMatch = pathname.match(/^\/api\/autonomy\/agent\/([^/]+)$/);
    if (agentMatch && method === 'GET') {
      const id = decodeURIComponent(agentMatch[1]);
      json(res, 200, { agent: id, grade: autonomy.getGrade(id), confidence: autonomy.getConfidence(id), history: autonomy.getHistory(id) }); return true;
    }
    const promoteMatch = pathname.match(/^\/api\/autonomy\/agent\/([^/]+)\/promote$/);
    if (promoteMatch && method === 'POST') {
      json(res, 200, autonomy.promote(decodeURIComponent(promoteMatch[1]))); return true;
    }
    const demoteMatch = pathname.match(/^\/api\/autonomy\/agent\/([^/]+)\/demote$/);
    if (demoteMatch && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, autonomy.demote(decodeURIComponent(demoteMatch[1]), body.reason || 'manual')); return true;
    }
    if (pathname === '/api/autonomy/thresholds' && method === 'GET') {
      json(res, 200, autonomy.getThresholds()); return true;
    }
    if (pathname === '/api/autonomy/record' && method === 'POST') {
      const body = await jsonBody(req);
      if (!body.agentId) { json(res, 400, { error: 'Missing agentId' }); return true; }
      json(res, 200, autonomy.recordOutcome(body.agentId, body.action || {}, body.outcome || 'success')); return true;
    }
    if (pathname === '/api/autonomy/permissions' && method === 'GET') {
      json(res, 200, { matrix: autonomy.getPermissionMatrix() }); return true;
    }
    if (pathname === '/api/autonomy/check' && method === 'GET') {
      const id = parsed.searchParams.get('agentId');
      if (!id) { json(res, 400, { error: 'Missing agentId' }); return true; }
      json(res, 200, autonomy.checkPromotion(id)); return true;
    }
  }

  // ── Decision Lineage ──
  if (pathname.startsWith('/api/lineage')) {
    let lineage;
    try { const DL = require('./decision-lineage'); lineage = new DL(); } catch (e) {
      json(res, 501, { error: 'Decision lineage module not available' }); return true;
    }
    if (pathname === '/api/lineage/decisions' && method === 'GET') {
      const filters = {};
      const aid = parsed.searchParams.get('agentId'); if (aid) filters.agentId = aid;
      const st = parsed.searchParams.get('status'); if (st) filters.status = st;
      const lim = parsed.searchParams.get('limit'); if (lim) filters.limit = parseInt(lim);
      json(res, 200, { decisions: lineage.queryDecisions(filters) }); return true;
    }
    if (pathname === '/api/lineage/decisions' && method === 'POST') {
      const body = await jsonBody(req);
      const record = lineage.recordDecision(body.request, body.context, body.rules, body.action, { outcome: body.outcome, parentIds: body.parentIds });
      json(res, 201, record); return true;
    }
    const decisionMatch = pathname.match(/^\/api\/lineage\/decisions\/([^/]+)$/);
    if (decisionMatch && method === 'GET') {
      const d = lineage.getDecision(decodeURIComponent(decisionMatch[1]));
      json(res, d ? 200 : 404, d || { error: 'Decision not found' }); return true;
    }
    const traceMatch = pathname.match(/^\/api\/lineage\/trace\/([^/]+)$/);
    if (traceMatch && method === 'GET') {
      const depth = parseInt(parsed.searchParams.get('depth') || '10');
      json(res, 200, { chain: lineage.traceLineage(decodeURIComponent(traceMatch[1]), depth) }); return true;
    }
    const treeMatch = pathname.match(/^\/api\/lineage\/tree\/([^/]+)$/);
    if (treeMatch && method === 'GET') {
      const tree = lineage.getDecisionTree(decodeURIComponent(treeMatch[1]));
      json(res, tree ? 200 : 404, tree || { error: 'Decision not found' }); return true;
    }
    if (pathname === '/api/lineage/stats' && method === 'GET') {
      json(res, 200, lineage.getStats()); return true;
    }
    const verifyLineageMatch = pathname.match(/^\/api\/lineage\/verify\/([^/]+)$/);
    if (verifyLineageMatch && method === 'GET') {
      json(res, 200, lineage.verifyIntegrity(decodeURIComponent(verifyLineageMatch[1]))); return true;
    }
  }

  // ── Industry Accelerators ──
  if (pathname.startsWith('/api/accelerators')) {
    let accel;
    try { const IA = require('./industry-accelerators'); accel = new IA(); } catch (e) {
      json(res, 501, { error: 'Accelerators module not available' }); return true;
    }
    if (pathname === '/api/accelerators/deployed' && method === 'GET') {
      json(res, 200, { deployed: accel.getDeployedAccelerators() }); return true;
    }
    if (pathname === '/api/accelerators' && method === 'GET') {
      json(res, 200, { accelerators: accel.getCatalog() }); return true;
    }
    const accIndustryMatch = pathname.match(/^\/api\/accelerators\/([^/]+)$/);
    if (accIndustryMatch && method === 'GET') {
      const a = accel.getAccelerator(accIndustryMatch[1]);
      json(res, a ? 200 : 404, a || { error: 'Accelerator not found' }); return true;
    }
    if (accIndustryMatch && method === 'DELETE') {
      json(res, 200, accel.undeployAccelerator(accIndustryMatch[1])); return true;
    }
    const accDeployMatch = pathname.match(/^\/api\/accelerators\/([^/]+)\/deploy$/);
    if (accDeployMatch && method === 'POST') {
      json(res, 200, accel.deployAccelerator(accDeployMatch[1])); return true;
    }
    const accCustomMatch = pathname.match(/^\/api\/accelerators\/([^/]+)\/customize$/);
    if (accCustomMatch && method === 'POST') {
      const body = await jsonBody(req);
      const customized = accel.customizeAccelerator(accCustomMatch[1], body);
      json(res, customized ? 200 : 404, customized || { error: 'Accelerator not found' }); return true;
    }
  }

  // ── Layer Stack ──
  if (pathname.startsWith('/api/stack')) {
    let ls;
    try { const LS = require('./layer-stack'); ls = new LS(refs); } catch (e) {
      json(res, 501, { error: 'Layer stack module not available' }); return true;
    }
    if (pathname === '/api/stack/health' && method === 'GET') {
      json(res, 200, ls.getLayerHealth()); return true;
    }
    const modMatch = pathname.match(/^\/api\/stack\/module\/([^/]+)$/);
    if (modMatch && method === 'GET') {
      const result = ls.getModuleLayer(modMatch[1]);
      json(res, result ? 200 : 404, result || { error: 'Module not found in stack' }); return true;
    }
    const layerMatch = pathname.match(/^\/api\/stack\/(\d+)$/);
    if (layerMatch && method === 'GET') {
      const layer = ls.getLayer(layerMatch[1]);
      json(res, layer ? 200 : 404, layer || { error: 'Layer not found' }); return true;
    }
    if (pathname === '/api/stack' && method === 'GET') {
      json(res, 200, { stack: ls.getStack(), status: ls.getStackStatus() }); return true;
    }
  }

  // ── Schema Compiler ──
  if (pathname.startsWith('/api/compiler')) {
    let compiler;
    try { const SchemaCompiler = require('./schema-compiler'); compiler = new SchemaCompiler(); } catch (e) {
      json(res, 501, { error: 'Schema compiler module not available: ' + e.message }); return true;
    }
    if (pathname === '/api/compiler/schemas' && method === 'GET') {
      json(res, 200, { schemas: compiler.listSchemas() }); return true;
    }
    const schemaIdMatch = pathname.match(/^\/api\/compiler\/schemas\/([^/]+)$/);
    if (schemaIdMatch && method === 'GET') {
      const s = compiler.getSchema(schemaIdMatch[1]);
      if (!s) { json(res, 404, { error: 'Schema not found' }); return true; }
      json(res, 200, s); return true;
    }
    if (pathname === '/api/compiler/schemas' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 201, compiler.saveSchema(body)); return true;
    }
    if (pathname === '/api/compiler/compile' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, compiler.compile(body)); return true;
    }
    if (pathname === '/api/compiler/validate' && method === 'POST') {
      const body = await jsonBody(req);
      json(res, 200, compiler.validateSchema(body)); return true;
    }
    if (pathname === '/api/compiler/history' && method === 'GET') {
      json(res, 200, { history: compiler.getCompilationHistory() }); return true;
    }
  }

  // ── Knowledge Hub ──
  if (pathname.startsWith('/api/knowledge-hub')) {
    let hub;
    try { const KnowledgeHub = require('./knowledge-hub'); hub = new KnowledgeHub(); } catch (e) {
      json(res, 501, { error: 'Knowledge hub module not available: ' + e.message }); return true;
    }
    if (pathname === '/api/knowledge-hub/entries' && method === 'GET') {
      const u = new URL(req.url, 'http://localhost');
      const filters = {};
      if (u.searchParams.get('type')) filters.type = u.searchParams.get('type');
      json(res, 200, { entries: hub.listEntries(filters) }); return true;
    }
    const khEntryMatch = pathname.match(/^\/api\/knowledge-hub\/entries\/([^/]+)$/);
    if (khEntryMatch && method === 'GET') {
      const e = hub.getEntry(khEntryMatch[1]);
      if (!e) { json(res, 404, { error: 'Entry not found' }); return true; }
      json(res, 200, e); return true;
    }
    if (khEntryMatch && method === 'DELETE') {
      const ok = hub.deleteEntry(khEntryMatch[1]);
      json(res, ok ? 200 : 404, { deleted: ok }); return true;
    }
    if (pathname === '/api/knowledge-hub/ingest' && method === 'POST') {
      const body = await jsonBody(req);
      if (!body.text) { json(res, 400, { error: 'Missing text field' }); return true; }
      json(res, 201, hub.ingestText(body.text, { type: body.type || 'text', filename: body.filename, ...body.metadata })); return true;
    }
    if (pathname === '/api/knowledge-hub/ingest-file' && method === 'POST') {
      const body = await jsonBody(req);
      if (!body.filePath) { json(res, 400, { error: 'Missing filePath' }); return true; }
      try { json(res, 201, hub.ingest(body.filePath, body.type)); } catch (e) { json(res, 400, { error: e.message }); }
      return true;
    }
    if (pathname === '/api/knowledge-hub/search' && method === 'GET') {
      const u = new URL(req.url, 'http://localhost');
      const q = u.searchParams.get('q') || '';
      const limit = parseInt(u.searchParams.get('limit') || '10', 10);
      json(res, 200, { results: hub.search(q, limit) }); return true;
    }
    if (pathname === '/api/knowledge-hub/stats' && method === 'GET') {
      json(res, 200, hub.getStats()); return true;
    }
    const crossRefMatch = pathname.match(/^\/api\/knowledge-hub\/cross-ref\/([^/]+)$/);
    if (crossRefMatch && method === 'GET') {
      json(res, 200, { references: hub.crossReference(crossRefMatch[1]) }); return true;
    }
  }

  return false; // not handled
}

module.exports = { registerFeatureRoutes, broadcast, wsClients, sendWsFrame };
