process.on('uncaughtException', e => { console.error('UNCAUGHT:', e.stack || e.message); process.exit(1); });
process.on('unhandledRejection', e => { console.error('UNHANDLED:', e && e.stack ? e.stack : e); process.exit(1); });

// Simulate headless.js boot
const path = require('path');
const fs = require('fs');
const baseDir = __dirname;
const dataDir = path.join(baseDir, 'data');

// Load config
let config = {};
try { config = JSON.parse(fs.readFileSync(path.join(baseDir, 'config', 'aries.json'), 'utf8')); } catch {}
try { if (!Object.keys(config).length) config = JSON.parse(fs.readFileSync(path.join(baseDir, 'config.json'), 'utf8')); } catch {}

console.log('Config loaded, apiPort:', config.apiPort || 3333);

// Load core modules one by one
const mods = [
  'logger', 'websocket', 'backup', 'https-server',
  'ai', 'tools', 'memory', 'system', 'events', 'swarm', 'swarm-coordinator',
  'task-queue', 'plugin-loader', 'self-heal', 'api-server', 'smart-router',
  'pipelines', 'war-room', 'ai-gateway', 'extension-bridge', 'swarm-join'
];

for (const m of mods) {
  try {
    const mod = require(path.join(baseDir, 'core', m));
    console.log(`  ${m}: loaded`);
  } catch(e) {
    console.log(`  ${m}: FAIL - ${e.message.split('\n')[0]}`);
  }
}

// Now try to instantiate things that headless does
console.log('\n--- Instantiation ---');

try {
  const { Logger } = require(path.join(baseDir, 'core', 'logger'));
  const logger = new Logger(config.logger || {});
  console.log('Logger OK');
} catch(e) { console.log('Logger FAIL:', e.message); }

try {
  const { WebSocketServer } = require(path.join(baseDir, 'core', 'websocket'));
  const ws = new WebSocketServer({ apiKey: config.apiKey || 'aries-api-2026' });
  console.log('WebSocket OK');
} catch(e) { console.log('WebSocket FAIL:', e.message); }

try {
  const apiServer = require(path.join(baseDir, 'core', 'api-server'));
  console.log('API Server type:', typeof apiServer, typeof apiServer.createServer);
  // Try to start it
  if (typeof apiServer.createServer === 'function') {
    const server = apiServer.createServer({ port: 3333, config });
    console.log('API Server created');
  } else if (typeof apiServer === 'function') {
    console.log('API Server is a function/class');
  }
} catch(e) { console.log('API Server FAIL:', e.message); }

console.log('\nBoot test complete');
process.exit(0);
