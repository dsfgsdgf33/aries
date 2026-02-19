/**
 * ARIES Relay Worker — Polls relay for tasks, calls AI, posts results
 * 
 * Supports multiple AI backends:
 *   - anthropic: Direct Anthropic API (ANTHROPIC_API_KEY)
 *   - openai:    OpenAI-compatible endpoint (AI_API_URL + AI_API_TOKEN)
 *   - openclaw:  OpenClaw gateway (default, same openai-compat format)
 *   - ollama:    Local Ollama instance
 * 
 * Env vars:
 *   RELAY_URL     — Relay server URL (default: http://localhost:9700)
 *   ARIES_SECRET  — Shared auth secret
 *   WORKER_ID     — Unique worker name (default: worker-<random>)
 *   AI_BACKEND    — anthropic | openai | openclaw | ollama (default: openai)
 *   AI_API_URL    — AI endpoint URL
 *   AI_API_TOKEN  — AI API key/token
 *   AI_MODEL      — Model name (default: claude-sonnet-4-20250514)
 *   POLL_MS       — Poll interval in ms (default: 2000)
 */

const http = require('http');
const https = require('https');

const RELAY_URL = (process.env.RELAY_URL || 'http://localhost:9700').replace(/\/$/, '');
const SECRET = process.env.ARIES_SECRET || 'aries-swarm-secret-change-me';
const WORKER_ID = process.env.WORKER_ID || `worker-${Math.random().toString(36).slice(2, 8)}`;
const AI_BACKEND = process.env.AI_BACKEND || 'openai';
const AI_API_URL = process.env.AI_API_URL || 'https://api.anthropic.com';
const AI_API_TOKEN = process.env.AI_API_TOKEN || '';
const AI_MODEL = process.env.AI_MODEL || 'claude-sonnet-4-20250514';
const POLL_MS = parseInt(process.env.POLL_MS || '2000');

let busy = false;
let completed = 0;
let errors = 0;

function fetch(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(u, {
      method: opts.method || 'GET',
      headers: opts.headers || {},
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString();
        resolve({ status: res.statusCode, body, json: () => { try { return JSON.parse(body); } catch { return null; } } });
      });
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function claimTask() {
  try {
    const res = await fetch(`${RELAY_URL}/api/task?worker=${WORKER_ID}`, {
      headers: { 'X-Aries-Secret': SECRET }
    });
    if (res.status === 204 || res.status === 404) return null;
    return res.json();
  } catch (e) {
    return null;
  }
}

async function postResult(taskId, result, error) {
  try {
    await fetch(`${RELAY_URL}/api/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Aries-Secret': SECRET },
      body: JSON.stringify({ taskId, result, error })
    });
  } catch (e) {
    console.error(`[${WORKER_ID}] Failed to post result: ${e.message}`);
  }
}

// --- AI Backends ---

async function callAnthropic(systemPrompt, userPrompt, maxTokens) {
  const res = await fetch(`${AI_API_URL}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': AI_API_TOKEN,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });
  const data = res.json();
  if (!data || !data.content) throw new Error(`Anthropic error: ${res.body.slice(0, 200)}`);
  return data.content[0].text;
}

async function callOpenAI(systemPrompt, userPrompt, maxTokens) {
  const url = AI_API_URL.includes('/chat/completions') ? AI_API_URL : `${AI_API_URL}/v1/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AI_API_TOKEN}`
    },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    })
  });
  const data = res.json();
  if (!data || !data.choices) throw new Error(`OpenAI-compat error: ${res.body.slice(0, 200)}`);
  return data.choices[0].message.content;
}

async function callOllama(systemPrompt, userPrompt, maxTokens) {
  const url = AI_API_URL.includes('/api/') ? AI_API_URL : `${AI_API_URL}/api/generate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: AI_MODEL,
      system: systemPrompt,
      prompt: userPrompt,
      stream: false,
      options: { num_predict: maxTokens }
    })
  });
  const data = res.json();
  if (!data || !data.response) throw new Error(`Ollama error: ${res.body.slice(0, 200)}`);
  return data.response;
}

async function callAI(systemPrompt, userPrompt, maxTokens) {
  switch (AI_BACKEND) {
    case 'anthropic': return callAnthropic(systemPrompt, userPrompt, maxTokens);
    case 'ollama': return callOllama(systemPrompt, userPrompt, maxTokens);
    case 'openai':
    case 'openclaw':
    default: return callOpenAI(systemPrompt, userPrompt, maxTokens);
  }
}

// --- Main Loop ---

async function processTask(task) {
  const systemPrompt = task.systemPrompt || 'You are a focused worker agent in a swarm. Complete ONLY the specific subtask assigned to you. Be thorough but concise.';
  const userPrompt = task.prompt;
  const maxTokens = task.maxTokens || 2048;

  console.log(`[${WORKER_ID}] Processing task ${task.id}: ${userPrompt.slice(0, 60)}...`);
  const start = Date.now();

  try {
    const result = await callAI(systemPrompt, userPrompt, maxTokens);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[${WORKER_ID}] ✓ Task ${task.id} done in ${elapsed}s (${result.length} chars)`);
    await postResult(task.id, result, null);
    completed++;
  } catch (e) {
    console.error(`[${WORKER_ID}] ✗ Task ${task.id} failed: ${e.message}`);
    await postResult(task.id, null, e.message);
    errors++;
  }
}

async function poll() {
  if (busy) return;
  busy = true;
  try {
    const task = await claimTask();
    if (task) await processTask(task);
  } catch (e) {
    // silent
  }
  busy = false;
}

console.log(`[${WORKER_ID}] Starting relay worker`);
console.log(`  Relay:   ${RELAY_URL}`);
console.log(`  Backend: ${AI_BACKEND} → ${AI_API_URL}`);
console.log(`  Model:   ${AI_MODEL}`);
console.log(`  Poll:    ${POLL_MS}ms`);

setInterval(poll, POLL_MS);
poll(); // immediate first poll

// Status every 60s
setInterval(() => {
  console.log(`[${WORKER_ID}] Status: ${completed} done, ${errors} errors`);
}, 60000);
