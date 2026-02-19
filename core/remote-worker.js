#!/usr/bin/env node
/**
 * ARIES v3.0 — Remote Worker Agent
 * 
 * Lightweight worker that runs on remote VMs (e.g., Oracle Cloud ARM).
 * Connects back to the Aries coordinator via WebSocket.
 * Receives tasks, executes them via local AI API, returns results.
 * 
 * Usage: node remote-worker.js --coordinator ws://host:9700 --secret <token> [--name <id>]
 * 
 * Environment variables (alternative to CLI args):
 *   ARIES_COORDINATOR=ws://host:9700
 *   ARIES_SECRET=aries-swarm-secret
 *   ARIES_WORKER_NAME=worker-1
 *   ARIES_API_URL=http://localhost:18800/v1/chat/completions
 *   ARIES_API_TOKEN=<token>
 *   ARIES_MODEL=anthropic/claude-sonnet-4-20250514
 */

const os = require('os');

// Parse CLI args
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
}

const COORDINATOR_URL = getArg('coordinator') || process.env.ARIES_COORDINATOR || 'ws://localhost:9700';
const SECRET = getArg('secret') || process.env.ARIES_SECRET || 'aries-swarm-secret';
const WORKER_NAME = getArg('name') || process.env.ARIES_WORKER_NAME || `worker-${os.hostname()}`;
const API_URL = getArg('api-url') || process.env.ARIES_API_URL || 'http://localhost:18800/v1/chat/completions';
const API_TOKEN = getArg('api-token') || process.env.ARIES_API_TOKEN || '';
const MODEL = getArg('model') || process.env.ARIES_MODEL || 'anthropic/claude-sonnet-4-20250514';
const HEARTBEAT_MS = 10000;
const RECONNECT_MS = 5000;

let WebSocket;
try { WebSocket = require('ws'); } catch {
  console.error('ERROR: ws module not found. Run: npm install ws');
  process.exit(1);
}

let fetch;
try { fetch = require('node-fetch'); } catch {
  // Node 18+ has global fetch
  fetch = globalThis.fetch;
}

let ws = null;
let heartbeatTimer = null;
let reconnectTimer = null;
let connected = false;

function log(msg) {
  const ts = new Date().toISOString().substring(11, 19);
  console.log(`[${ts}] ${msg}`);
}

function getSystemInfo() {
  const cpus = os.cpus();
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    cpus: cpus.length,
    cpuModel: cpus[0] ? cpus[0].model : 'unknown',
    totalMem: Math.round(os.totalmem() / 1073741824 * 10) / 10,
    freeMem: Math.round(os.freemem() / 1073741824 * 10) / 10,
    uptime: Math.round(os.uptime())
  };
}

async function executeTask(task, systemPrompt) {
  const messages = [
    { role: 'system', content: systemPrompt || 'You are a focused worker agent in a swarm. Complete the specific subtask assigned to you. Be thorough but concise. Return your findings/results directly.' },
    { role: 'user', content: task }
  ];

  const headers = { 'Content-Type': 'application/json' };
  if (API_TOKEN) headers['Authorization'] = `Bearer ${API_TOKEN}`;

  const resp = await fetch(API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: MODEL, messages, max_tokens: 2048 })
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`API ${resp.status}: ${errText.substring(0, 200)}`);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '(empty response)';
}

function connect() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  
  log(`Connecting to ${COORDINATOR_URL}...`);
  ws = new WebSocket(COORDINATOR_URL);

  ws.on('open', () => {
    log('Connected. Authenticating...');
    ws.send(JSON.stringify({
      type: 'auth',
      secret: SECRET,
      workerId: WORKER_NAME,
      info: getSystemInfo()
    }));
  });

  ws.on('message', async (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    if (msg.type === 'auth_ok') {
      connected = true;
      log(`Authenticated as ${msg.workerId}`);
      // Start heartbeat
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'heartbeat', info: getSystemInfo() }));
        }
      }, HEARTBEAT_MS);
    }

    if (msg.type === 'heartbeat_ack') {
      // All good
    }

    if (msg.type === 'task') {
      log(`Received task #${msg.taskId}: ${msg.task.substring(0, 80)}...`);
      try {
        const result = await executeTask(msg.task, msg.systemPrompt);
        log(`Task #${msg.taskId} complete (${result.length} chars)`);
        ws.send(JSON.stringify({ type: 'task_result', taskId: msg.taskId, result }));
      } catch (e) {
        log(`Task #${msg.taskId} failed: ${e.message}`);
        ws.send(JSON.stringify({ type: 'task_result', taskId: msg.taskId, error: e.message }));
      }
    }

    if (msg.type === 'error') {
      log(`Error from coordinator: ${msg.message}`);
    }
  });

  ws.on('close', () => {
    connected = false;
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    log('Disconnected. Reconnecting...');
    reconnectTimer = setTimeout(connect, RECONNECT_MS);
  });

  ws.on('error', (err) => {
    log(`WebSocket error: ${err.message}`);
  });
}

// Start
log(`ARIES Remote Worker — ${WORKER_NAME}`);
log(`Coordinator: ${COORDINATOR_URL}`);
log(`API: ${API_URL}`);
log(`Model: ${MODEL}`);
connect();

// Graceful shutdown
process.on('SIGINT', () => { log('Shutting down...'); if (ws) ws.close(); process.exit(0); });
process.on('SIGTERM', () => { log('Shutting down...'); if (ws) ws.close(); process.exit(0); });
