#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// ARIES v4.0 — Test Suite
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ✓ PASS: ${name}`); passed++; }
  catch (e) { console.log(`  ✗ FAIL: ${name} — ${e.message}`); failed++; }
}

async function testAsync(name, fn) {
  try { await fn(); console.log(`  ✓ PASS: ${name}`); passed++; }
  catch (e) { console.log(`  ✗ FAIL: ${name} — ${e.message}`); failed++; }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }

console.log('═══ ARIES v4.0 Test Suite ═══\n');

// ── Config System ──
console.log('── Config System ──');
test('config/aries.json exists', () => {
  assert(fs.existsSync(path.join(__dirname, 'config', 'aries.json')), 'missing config/aries.json');
});

test('config/aries.json is valid JSON', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config', 'aries.json'), 'utf8'));
  assert(cfg.version === '4.0.0', 'wrong version');
  assert(cfg.server && cfg.server.port, 'missing server.port');
  assert(cfg.gateway && cfg.gateway.url, 'missing gateway.url');
});

test('legacy config.json loads', () => {
  const config = require('./config.json');
  assert(config.gateway, 'missing gateway');
});

test('core/config.js loads and validates', () => {
  const config = require('./core/config');
  const cfg = config.load();
  assert(cfg.server, 'missing server section');
  assert(cfg.server.port > 0, 'invalid port');
  assert(cfg.gateway, 'missing gateway section');
  assert(cfg.auth, 'missing auth section');
  assert(cfg.models, 'missing models section');
});

test('config get/set works', () => {
  const config = require('./core/config');
  config.load();
  const port = config.get('server.port');
  assert(typeof port === 'number', 'port should be number');
  assert(config.get('nonexistent.key', 'default') === 'default', 'default not returned');
});

test('config token management', () => {
  const config = require('./core/config');
  config.load();
  const tokens = config.get('auth.tokens', []);
  assert(Array.isArray(tokens), 'tokens should be array');
});

// ── Core Modules ──
console.log('\n── Core Modules ──');
test('core/ai loads', () => { require('./core/ai'); });
test('core/tools loads', () => { require('./core/tools'); });
test('core/memory loads', () => { require('./core/memory'); });
test('core/system loads', () => { require('./core/system'); });
test('core/events loads', () => { require('./core/events'); });
test('core/swarm loads', () => { require('./core/swarm'); });
test('core/agents loads', () => { require('./core/agents'); });
test('core/swarm-coordinator loads', () => { require('./core/swarm-coordinator'); });
test('core/task-queue loads', () => { require('./core/task-queue'); });
test('core/plugin-loader loads', () => { require('./core/plugin-loader'); });
test('core/self-heal loads', () => { require('./core/self-heal'); });
test('core/api-server loads', () => { require('./core/api-server'); });
test('core/shared-data loads', () => { require('./core/shared-data'); });
test('core/self-update loads', () => { require('./core/self-update'); });
test('core/logger loads', () => { require('./core/logger'); });
test('core/rate-limiter loads', () => { require('./core/rate-limiter'); });
test('core/audit loads', () => { require('./core/audit'); });
test('core/process-manager loads', () => { require('./core/process-manager'); });
test('core/watchdog loads', () => { require('./core/watchdog'); });

// ── New v4 Modules ──
console.log('\n── v4 New Modules ──');
test('logger creates child', () => {
  const logger = require('./core/logger');
  const child = logger.child('TEST');
  assert(typeof child.info === 'function', 'child missing info');
  assert(typeof child.error === 'function', 'child missing error');
});

test('rate limiter works', () => {
  const RateLimiter = require('./core/rate-limiter');
  const rl = new RateLimiter({ maxPerMinute: 2, burst: 2 });
  const r1 = rl.check('test');
  assert(r1.allowed, 'first should be allowed');
  const r2 = rl.check('test');
  assert(r2.allowed, 'second should be allowed');
  const r3 = rl.check('test');
  assert(!r3.allowed, 'third should be blocked');
  rl.destroy();
});

test('audit log works', () => {
  const audit = require('./core/audit');
  audit.log({ type: 'test', message: 'test entry' });
  const recent = audit.recent(5);
  assert(Array.isArray(recent), 'recent should be array');
});

test('process manager static methods exist', () => {
  const PM = require('./core/process-manager');
  assert(typeof PM.writePid === 'function', 'missing writePid');
  assert(typeof PM.readPid === 'function', 'missing readPid');
  assert(typeof PM.isPortInUse === 'function', 'missing isPortInUse');
  assert(typeof PM.getStatus === 'function', 'missing getStatus');
});

// ── Agents ──
console.log('\n── Agents ──');
test('AgentRoster has 14 agents', () => {
  const { AgentRoster } = require('./core/agents');
  const roster = new AgentRoster();
  assert(roster.count() === 14, `Expected 14 agents, got ${roster.count()}`);
});

test('Agent allocation works', () => {
  const { AgentRoster } = require('./core/agents');
  const roster = new AgentRoster();
  const tasks = ['Research the market trends', 'Write code for API', 'Analyze the data'];
  const allocs = roster.allocateTasks(tasks);
  assert(allocs.length === 3, 'should have 3 allocations');
  assert(allocs[0].agentId, 'allocation missing agentId');
  assert(allocs[0].systemPrompt, 'allocation missing systemPrompt');
});

// ── Swarm ──
console.log('\n── Swarm ──');
test('Swarm initializes', () => {
  const Swarm = require('./core/swarm');
  const ai = require('./core/ai');
  const swarm = new Swarm(ai, { maxWorkers: 14, workerTimeout: 60000, retries: 2 });
  assert(swarm.maxWorkers === 14, 'wrong maxWorkers');
  assert(swarm.getRoster().count() === 14, 'roster not 14');
});

test('Swarm stats structure', () => {
  const Swarm = require('./core/swarm');
  const ai = require('./core/ai');
  const swarm = new Swarm(ai, {});
  const stats = swarm.getStats();
  assert('activeWorkers' in stats, 'missing activeWorkers');
  assert('isRunning' in stats, 'missing isRunning');
  assert('agents' in stats, 'missing agents');
});

// ── Memory ──
console.log('\n── Memory ──');
test('memory operations', () => {
  const memory = require('./core/memory');
  const count = memory.add('test-key', 'test value', 'general', 'normal');
  assert(typeof count === 'number', 'add should return count');
  const all = memory.getAll();
  assert(Array.isArray(all), 'getAll should return array');
  const stats = memory.stats();
  assert(typeof stats === 'object', 'stats should return object');
});

// ── Plugin System ──
console.log('\n── Plugins ──');
test('plugin loader works', () => {
  const loader = require('./core/plugin-loader');
  const loaded = loader.loadAll();
  assert(Array.isArray(loaded), 'loadAll should return array');
  const all = loader.getAll();
  assert(Array.isArray(all), 'getAll should return array');
});

test('built-in plugins load', () => {
  const loader = require('./core/plugin-loader');
  loader.loadAll();
  const plugins = loader.getAll().map(p => p.name);
  // At least some of our built-in plugins should load
  assert(plugins.length >= 1, 'should have at least 1 plugin');
});

test('plugin lifecycle hooks', () => {
  const loader = require('./core/plugin-loader');
  loader.loadAll();
  // broadcastMessage and broadcastTask should work without error
  assert(typeof loader.broadcastMessage === 'function', 'missing broadcastMessage');
  assert(typeof loader.broadcastTask === 'function', 'missing broadcastTask');
  assert(typeof loader.destroyAll === 'function', 'missing destroyAll');
});

// ── AI ──
console.log('\n── AI ──');
test('ai has multi-model functions', () => {
  const ai = require('./core/ai');
  assert(typeof ai.chat === 'function', 'missing chat');
  assert(typeof ai.chatStream === 'function', 'missing chatStream');
  assert(typeof ai.chatStreamChunked === 'function', 'missing chatStreamChunked');
  assert(typeof ai.selectModel === 'function', 'missing selectModel');
  assert(typeof ai.callWithFallback === 'function', 'missing callWithFallback');
});

test('model selection works', () => {
  const ai = require('./core/ai');
  const chatModel = ai.selectModel('chat');
  assert(chatModel, 'chat model should not be empty');
  const codingModel = ai.selectModel('coding');
  assert(codingModel, 'coding model should not be empty');
});

test('tool parsing works', () => {
  const ai = require('./core/ai');
  const calls = ai.parseTools('<tool:shell>dir</tool:shell>');
  assert(calls.length === 1, 'should parse 1 tool');
  assert(calls[0].tool === 'shell', 'should be shell');
  assert(calls[0].args[0] === 'dir', 'should have dir arg');
});

test('strip tool tags', () => {
  const ai = require('./core/ai');
  const stripped = ai.stripToolTags('hello <tool:shell>dir</tool:shell> world');
  assert(stripped === 'hello  world', 'should strip tags');
});

// ── SharedData ──
console.log('\n── SharedData ──');
test('shared data operations', () => {
  const SharedData = require('./core/shared-data');
  const sd = new SharedData(path.join(__dirname, 'data', 'test-shared.json'));
  sd.set('test', 42);
  assert(sd.get('test') === 42, 'get should return 42');
  sd.delete('test');
  assert(sd.get('test') === undefined, 'should be undefined after delete');
  sd.publish('agent1', 'finding', 'test result');
  const findings = sd.getAgentFindings('agent1');
  assert(Object.keys(findings).length > 0, 'should have findings');
  sd.clear();
});

// ── Tools ──
console.log('\n── Tools ──');
test('tools list', () => {
  const tools = require('./core/tools');
  const list = tools.list();
  assert(Array.isArray(list), 'list should return array');
  assert(list.length > 10, 'should have many tools');
});

// ── File Structure ──
console.log('\n── File Structure ──');
test('bin/aries-cli.js exists', () => {
  assert(fs.existsSync(path.join(__dirname, 'bin', 'aries-cli.js')), 'missing CLI');
});

test('bin/aries.cmd exists', () => {
  assert(fs.existsSync(path.join(__dirname, 'bin', 'aries.cmd')), 'missing cmd');
});

test('install.js exists', () => {
  assert(fs.existsSync(path.join(__dirname, 'install.js')), 'missing install');
});

test('uninstall.js exists', () => {
  assert(fs.existsSync(path.join(__dirname, 'uninstall.js')), 'missing uninstall');
});

test('README.md exists', () => {
  const content = fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8');
  assert(content.includes('v4.0'), 'README should mention v4.0');
});

test('web/index.html has v4.0', () => {
  const content = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
  assert(content.includes('v4.0') || content.includes('v 4 . 0'), 'should mention v4.0');
});

test('plugins directory has built-in plugins', () => {
  const files = fs.readdirSync(path.join(__dirname, 'plugins'));
  assert(files.includes('system-monitor.js'), 'missing system-monitor');
  assert(files.includes('code-runner.js'), 'missing code-runner');
  assert(files.includes('file-manager.js'), 'missing file-manager');
});

test('logs directory exists', () => {
  assert(fs.existsSync(path.join(__dirname, 'logs')), 'missing logs dir');
});

// ── Results ──
console.log('\n═══════════════════════════════════════');
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
console.log('═══════════════════════════════════════');

if (failed > 0) process.exit(1);
