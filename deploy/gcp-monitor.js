// Aries Uptime Monitor — GCP Free Tier
// Monitors all Aries infrastructure and alerts via Telegram
const http = require('http');
const https = require('https');

const PORT = 9700;
const SECRET = 'aries-swarm-jdw-2026';

// Services to monitor
const TARGETS = [
  { name: 'Aries Dashboard', url: 'http://localhost:3333/api/status', local: true, note: 'Only works if tunnel active' },
  { name: 'Vultr Relay', url: 'http://45.76.232.5:9700/api/status', headers: { 'X-Aries-Secret': SECRET } },
  { name: 'DOOMTRADER', url: 'https://doomtrader.com', expect: 200 },
  { name: 'Gateway Tunnel', url: 'https://gateway.doomtrader.com/health' },
  { name: 'Ollama (Vultr)', url: 'http://45.76.232.5:11434/api/version' },
];

// Telegram alert config (optional — set these to enable alerts)
const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN || '';
const TG_CHAT_ID = process.env.TG_CHAT_ID || '';

// State
const state = {};
const history = [];
const startTime = Date.now();
let checkCount = 0;

function req(urlStr, opts = {}) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve({ ok: false, status: 0, ms: opts.timeout || 10000, error: 'timeout' }), opts.timeout || 10000);
    const start = Date.now();
    const mod = urlStr.startsWith('https') ? https : http;
    try {
      const r = mod.get(urlStr, { headers: opts.headers || {}, timeout: 10000 }, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          clearTimeout(timeout);
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, status: res.statusCode, ms: Date.now() - start, body: body.slice(0, 500) });
        });
      });
      r.on('error', (e) => { clearTimeout(timeout); resolve({ ok: false, status: 0, ms: Date.now() - start, error: e.message }); });
    } catch (e) { clearTimeout(timeout); resolve({ ok: false, status: 0, ms: 0, error: e.message }); }
  });
}

function sendTelegram(text) {
  if (!TG_BOT_TOKEN || !TG_CHAT_ID) return;
  const data = JSON.stringify({ chat_id: TG_CHAT_ID, text, parse_mode: 'HTML' });
  const r = https.request({
    hostname: 'api.telegram.org', path: '/bot' + TG_BOT_TOKEN + '/sendMessage',
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
  });
  r.write(data); r.end();
  r.on('error', () => {});
}

async function checkAll() {
  checkCount++;
  const results = [];
  for (const t of TARGETS) {
    if (t.local) { results.push({ name: t.name, ok: true, ms: 0, note: 'skipped (local)' }); continue; }
    const r = await req(t.url, { headers: t.headers });
    const prev = state[t.name];
    const wasDown = prev && !prev.ok;
    const isDown = !r.ok;

    // State change detection
    if (isDown && !wasDown) {
      sendTelegram('🔴 <b>' + t.name + '</b> is DOWN\nStatus: ' + r.status + '\nError: ' + (r.error || 'HTTP ' + r.status) + '\nLatency: ' + r.ms + 'ms');
    } else if (!isDown && wasDown) {
      sendTelegram('🟢 <b>' + t.name + '</b> is BACK UP\nLatency: ' + r.ms + 'ms\nDowntime: ' + Math.floor((Date.now() - (prev.downSince || Date.now())) / 1000) + 's');
    }

    state[t.name] = {
      ok: r.ok, status: r.status, ms: r.ms, error: r.error || null,
      lastCheck: Date.now(),
      downSince: isDown ? (wasDown ? prev.downSince : Date.now()) : null,
      uptime: isDown ? 0 : ((prev && prev.ok) ? (prev.uptime || 0) + 1 : 1),
      checks: (prev ? prev.checks : 0) + 1
    };
    results.push({ name: t.name, ...state[t.name] });
  }

  // Keep last 100 check rounds
  history.push({ time: Date.now(), results });
  if (history.length > 100) history.shift();
}

// Check every 60 seconds
setInterval(checkAll, 60000);
checkAll(); // immediate first check

// HTTP API for status
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.headers['x-aries-secret'] !== SECRET && !req.url.startsWith('/health')) {
    res.writeHead(401); res.end('{"error":"unauthorized"}'); return;
  }

  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/health') {
    res.end(JSON.stringify({ ok: true, uptime: Math.floor((Date.now() - startTime) / 1000), checks: checkCount }));
    return;
  }

  if (url.pathname === '/api/status') {
    const allOk = Object.values(state).every(s => s.ok || s.note);
    res.end(JSON.stringify({
      overall: allOk ? 'healthy' : 'degraded',
      uptime: Math.floor((Date.now() - startTime) / 1000),
      checks: checkCount,
      services: state,
      targets: TARGETS.map(t => t.name)
    }));
    return;
  }

  if (url.pathname === '/api/history') {
    res.end(JSON.stringify(history.slice(-20)));
    return;
  }

  res.writeHead(404); res.end('{"error":"not found"}');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Aries Uptime Monitor on port ' + PORT);
  console.log('Monitoring ' + TARGETS.length + ' services');
  console.log('Telegram alerts: ' + (TG_BOT_TOKEN ? 'enabled' : 'disabled (set TG_BOT_TOKEN and TG_CHAT_ID)'));
});
