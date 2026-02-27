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

  // ── WebSocket upgrade ──
  server.on('upgrade', (req, socket, head) => {
    const parsed = new URL(req.url, 'http://localhost');
    if (parsed.pathname !== '/ws') {
      socket.destroy();
      return;
    }

    const key = req.headers['sec-websocket-key'];
    if (!key) { socket.destroy(); return; }

    const accept = crypto
      .createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-5AB5CE89B541')
      .digest('base64');

    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n` +
      '\r\n'
    );

    const client = { socket, alive: true, buf: Buffer.alloc(0) };
    wsClients.add(client);

    socket.on('data', (chunk) => {
      client.buf = Buffer.concat([client.buf, chunk]);
      while (client.buf.length >= 2) {
        const frame = decodeFrame(client.buf);
        if (!frame) break;
        client.buf = client.buf.slice(frame.totalLen);

        if (frame.opcode === 0x01) {
          // text frame — echo or handle
          const text = frame.payload.toString('utf8');
          try {
            const msg = JSON.parse(text);
            // Client can subscribe or send commands; for now just acknowledge
            sendWsFrame(socket, JSON.stringify({ type: 'ack', data: msg, timestamp: Date.now() }));
          } catch (_) { /* ignore bad json */ }
        } else if (frame.opcode === 0x09) {
          // ping → pong
          const pong = Buffer.alloc(2 + frame.payload.length);
          pong[0] = 0x8a; // FIN + pong
          pong[1] = frame.payload.length;
          frame.payload.copy(pong, 2);
          try { socket.write(pong); } catch (_) { /* */ }
        } else if (frame.opcode === 0x0a) {
          // pong
          client.alive = true;
        } else if (frame.opcode === 0x08) {
          // close
          sendClose(socket);
          wsClients.delete(client);
          return;
        }
      }
    });

    socket.on('close', () => wsClients.delete(client));
    socket.on('error', () => wsClients.delete(client));
  });

  // Ping interval
  setInterval(() => {
    for (const client of wsClients) {
      if (!client.alive) {
        wsClients.delete(client);
        try { client.socket.destroy(); } catch (_) { /* */ }
        continue;
      }
      client.alive = false;
      sendPing(client.socket);
    }
  }, 30000).unref();

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

  return false; // not handled
}

module.exports = { registerFeatureRoutes, broadcast };
