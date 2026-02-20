#!/usr/bin/env node
/**
 * ARIES — First-Run Setup Wizard
 * Beautiful console-based wizard that runs when no config.json exists.
 * Pure Node.js, no npm dependencies.
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const crypto = require('crypto');
const { execSync, spawn } = require('child_process');
const os = require('os');

const BASE = __dirname;
const CONFIG = path.join(BASE, 'config.json');
const TEMPLATE = path.join(BASE, 'config.template.json');

// ── ANSI Colors ──
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  white: '\x1b[97m',
  bgCyan: '\x1b[46m',
  bgGreen: '\x1b[42m',
};

const cyan = t => `${C.cyan}${t}${C.reset}`;
const green = t => `${C.green}${t}${C.reset}`;
const yellow = t => `${C.yellow}${t}${C.reset}`;
const red = t => `${C.red}${t}${C.reset}`;
const dim = t => `${C.dim}${t}${C.reset}`;
const bold = t => `${C.bold}${t}${C.reset}`;
const magenta = t => `${C.magenta}${t}${C.reset}`;

// ── Readline ──
let rl;
function initRL() {
  rl = readline.createInterface({ input: process.stdin, output: process.stdout });
}
const ask = (q) => new Promise(r => rl.question(q, r));

// ── Graceful Ctrl+C ──
process.on('SIGINT', () => {
  console.log(`\n\n  ${yellow('⚠')} Setup cancelled. Run ${bold('node setup-wizard.js')} to try again.\n`);
  if (rl) rl.close();
  process.exit(0);
});

// ── Helpers ──
function clearScreen() { process.stdout.write('\x1b[2J\x1b[H'); }

function banner(title, icon = '🔱') {
  const line = '═'.repeat(47);
  console.log(`\n  ${cyan(line)}`);
  console.log(`     ${icon} ${bold(title)}`);
  console.log(`  ${cyan(line)}\n`);
}

function section(title) {
  console.log(`\n  ${cyan('─'.repeat(47))}`);
  console.log(`  ${cyan(title)}`);
  console.log(`  ${cyan('─'.repeat(47))}\n`);
}

function detectApiKeyType(key) {
  key = key.trim();
  if (key.startsWith('sk-ant-')) return { provider: 'anthropic', name: 'Anthropic Claude', model: 'claude-opus-4-6' };
  if (key.startsWith('sk-') && !key.startsWith('sk-ant-')) return { provider: 'openai', name: 'OpenAI GPT', model: 'gpt-4o' };
  if (key.startsWith('gsk_')) return { provider: 'groq', name: 'Groq', model: 'llama-3.3-70b-versatile' };
  if (key.startsWith('xai-')) return { provider: 'xai', name: 'xAI Grok', model: 'grok-2' };
  if (key.length > 20) return { provider: 'unknown', name: 'Unknown Provider', model: 'auto' };
  return null;
}

function ollamaInstalled() {
  try {
    execSync('ollama --version', { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

function getSystemRAM() {
  return Math.round(os.totalmem() / (1024 * 1024 * 1024));
}

function detectGpuVram() {
  try {
    const out = execSync('nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits', { encoding: 'utf8', timeout: 5000 }).trim();
    const vramMb = parseInt(out.split('\n')[0]);
    if (!isNaN(vramMb)) return Math.round(vramMb / 1024);
  } catch {}
  // Try AMD on Linux
  try {
    const out = execSync('rocm-smi --showmeminfo vram', { encoding: 'utf8', timeout: 5000 });
    const match = out.match(/Total.*?(\d+)/);
    if (match) return Math.round(parseInt(match[1]) / (1024 * 1024));
  } catch {}
  return 0;
}

function pickOllamaModel() {
  const ram = getSystemRAM();
  const vram = detectGpuVram();
  const effectiveMem = vram > 0 ? vram : ram;
  const gpuLabel = vram > 0 ? `GPU ${vram}GB VRAM` : `${ram}GB RAM (CPU mode)`;

  // With GPU VRAM, prefer larger quantized models
  if (effectiveMem >= 48) return { model: 'qwen2.5:32b', label: 'Qwen 2.5 32B', reason: `${gpuLabel} — large model, excellent quality`, hardware: { ram, vram } };
  if (effectiveMem >= 24) return { model: 'qwen2.5:14b', label: 'Qwen 2.5 14B', reason: `${gpuLabel} — great quality/speed balance`, hardware: { ram, vram } };
  if (effectiveMem >= 16) return { model: 'llama3.1:8b', label: 'Llama 3.1 8B', reason: `${gpuLabel} — excellent balance`, hardware: { ram, vram } };
  if (effectiveMem >= 8) return { model: 'qwen2.5:7b', label: 'Qwen 2.5 7B', reason: `${gpuLabel} — fast & capable`, hardware: { ram, vram } };
  if (effectiveMem >= 4) return { model: 'llama3.2:3b', label: 'Llama 3.2 3B', reason: `${gpuLabel} — lightweight`, hardware: { ram, vram } };
  return { model: 'llama3.2:1b', label: 'Llama 3.2 1B', reason: `${gpuLabel} — minimal`, hardware: { ram, vram } };
}

function pullOllamaModel(model) {
  return new Promise((resolve, reject) => {
    console.log(`  ${dim('Pulling')} ${bold(model)} ${dim('...')}`);
    const proc = spawn('ollama', ['pull', model], { stdio: 'inherit' });
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(`ollama pull exited ${code}`)));
    proc.on('error', reject);
  });
}

async function installOllama() {
  const platform = process.platform;
  if (platform === 'win32') {
    console.log(`  ${yellow('⚠')} Ollama needs to be installed manually on Windows.`);
    console.log(`  ${dim('Download from:')} ${bold('https://ollama.ai/download')}`);
    console.log(`  ${dim('Install it, then run this wizard again.')}\n`);
    const cont = await ask(`  ${cyan('Press Enter after installing Ollama (or "skip" to cancel): ')}`);
    if (cont.toLowerCase() === 'skip') return false;
    return ollamaInstalled();
  } else if (platform === 'linux' || platform === 'darwin') {
    console.log(`  ${dim('Installing Ollama...')}`);
    try {
      execSync('curl -fsSL https://ollama.ai/install.sh | sh', { stdio: 'inherit' });
      return ollamaInstalled();
    } catch {
      console.log(`  ${red('✗')} Auto-install failed. Install manually: ${bold('https://ollama.ai')}`);
      return false;
    }
  }
  return false;
}

// ── Option 1: Quick Join (One-Click) ──
async function setupQuickJoin(config) {
  section('⚡ One-Click: Join Aries Network');

  console.log(`  ${bold('This will automatically:')}`);
  console.log(`  ${green('✓')} Download & install Ollama (local AI engine)`);
  console.log(`  ${green('✓')} Pull the best AI model for your hardware`);
  console.log(`  ${green('✓')} Connect to the Aries relay network`);
  console.log(`  ${green('✓')} Start the AI worker (you contribute, you get access)`);
  console.log(`  ${green('✓')} Start low-priority background compute`);
  console.log(`  ${dim('  Everything runs idle-only. Disable anytime.')}\n`);

  const confirm = await ask(`  ${cyan('Ready to join? (Y/n): ')}`);
  if (confirm.toLowerCase() === 'n') return false;

  const crypto = require('crypto');
  const workerId = 'aries-' + crypto.randomBytes(4).toString('hex');
  const authKey = crypto.randomBytes(16).toString('hex');

  // Step 1: Install/check Ollama
  console.log(`\n  ${bold('[1/5]')} Checking AI engine...`);
  if (!ollamaInstalled()) {
    console.log(`  ${dim('Installing Ollama...')}`);
    const installed = await installOllama();
    if (!installed) {
      console.log(`  ${yellow('⚠')} Ollama install pending. Continuing with network-only mode...`);
    }
  }
  if (ollamaInstalled()) console.log(`  ${green('✓')} Ollama ready`);

  // Step 2: Pull model
  console.log(`  ${bold('[2/5]')} Selecting AI model...`);
  const picked = pickOllamaModel();
  if (ollamaInstalled()) {
    console.log(`  ${dim('Pulling')} ${bold(picked.label)} ${dim('(' + picked.reason + ')')}`);
    try { await pullOllamaModel(picked.model); console.log(`  ${green('✓')} Model ready`); }
    catch (e) { console.log(`  ${yellow('⚠')} Model pull failed: ${e.message}`); }
  }

  // Step 3: Connect to relay
  console.log(`  ${bold('[3/5]')} Connecting to Aries Network...`);
  const https = require('https');
  const http = require('http');
  const relayUrl = 'https://gateway.doomtrader.com:9700';
  let connected = false;
  try {
    connected = await new Promise((resolve) => {
      const req = https.get(`${relayUrl}/health`, { timeout: 5000, rejectUnauthorized: false }, (res) => {
        resolve(res.statusCode < 500);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
  } catch { connected = false; }

  if (connected) console.log(`  ${green('✓')} Relay connected`);
  else console.log(`  ${yellow('⚠')} Relay offline — will connect later`);

  // Step 4: Configure
  console.log(`  ${bold('[4/5]')} Configuring...`);
  config.relay = {
    url: relayUrl,
    secret: 'aries-swarm-public-2026',
    workers: 2,
    role: 'worker',
    workerId,
    authKey
  };
  if (ollamaInstalled()) {
    config.gateway = config.gateway || {};
    config.gateway.url = 'http://localhost:11434/v1/chat/completions';
    config.gateway.model = picked.model;
    config.ariesGateway = config.ariesGateway || { providers: {} };
    config.ariesGateway.providers.ollama = { baseUrl: 'http://localhost:11434', defaultModel: picked.model };
    config.models = config.models || {};
    config.models.chat = picked.model;
    config.models.coding = picked.model;
    config.models.swarmWorker = picked.model;
  }
  config.miner = config.miner || {};
  config.miner.enabled = true;
  config.miner.idleOnly = true;
  config.miner.idleThreshold = 30;
  config.miner.workerName = workerId;
  config.swarm = config.swarm || {};
  config.swarm.enrolled = true;
  config.swarm.workerId = workerId;
  config.swarm.authKey = authKey;
  config.swarm.relayUrl = relayUrl;
  config.swarm.enrolledAt = new Date().toISOString();
  config.swarm.ollamaReady = ollamaInstalled();
  config.tier = { current: 'network', miningStartDate: new Date().toISOString() };

  // Step 5: Done
  console.log(`  ${bold('[5/5]')} Finalizing...`);
  console.log(`\n  ${green('✅')} ${bold("You're in! Welcome to the Aries Network!")}`);
  console.log(`  ${dim('Worker ID:')} ${bold(workerId)}`);
  if (ollamaInstalled()) console.log(`  ${dim('AI Model:')}  ${bold(picked.model)}`);
  console.log(`  ${dim('Mining:')}    ${bold('Idle-only, auto-throttle')}`);

  config._setupMethod = 'quickjoin';
  config._setupProvider = 'Aries Network (Quick Join)';
  return true;
}

// ── Option 2: API Key ──
async function setupApiKey(config) {
  section('🔑 API Key Setup');
  console.log(`  ${dim('Supported: Anthropic (sk-ant-...), OpenAI (sk-...), Groq (gsk_...), xAI (xai-...)')}\n`);

  const key = await ask(`  Paste your API key: `);
  const detected = detectApiKeyType(key);

  if (!detected) {
    console.log(`\n  ${red('✗')} That doesn\'t look like a valid API key.`);
    const retry = await ask(`  Try again? (y/n): `);
    if (retry.toLowerCase() === 'y') return setupApiKey(config);
    return false;
  }

  // Apply to config
  if (detected.provider === 'anthropic') {
    config.ariesGateway.providers.anthropic.apiKey = key.trim();
    config.ariesGateway.providers.anthropic.defaultModel = detected.model;
  } else if (detected.provider === 'openai') {
    config.ariesGateway.providers.openai = {
      apiKey: key.trim(),
      baseUrl: 'https://api.openai.com/v1',
      defaultModel: detected.model,
      maxRetries: 3
    };
    // Update model references
    config.gateway.model = `openai/${detected.model}`;
    config.models.chat = `openai/${detected.model}`;
  } else {
    // Generic — store in anthropic slot with note
    config.ariesGateway.providers[detected.provider] = {
      apiKey: key.trim(),
      defaultModel: detected.model
    };
  }

  console.log(`\n  ${green('✅')} API key configured! You're using ${bold(detected.name)}`);
  config._setupMethod = 'api-key';
  config._setupProvider = detected.name;
  return true;
}

// ── Option 2: Ollama ──
async function setupOllama(config) {
  section('🦙 Local AI Setup (Ollama)');

  if (!ollamaInstalled()) {
    console.log(`  ${yellow('⚠')} Ollama is not installed.\n`);
    const installed = await installOllama();
    if (!installed) {
      console.log(`  ${red('✗')} Ollama not available. Please install it and try again.`);
      return false;
    }
  }

  console.log(`  ${green('✓')} Ollama detected!\n`);

  const picked = pickOllamaModel();
  const { model, label, reason, hardware } = picked;
  console.log(`  ${cyan('╔══ Hardware Detected ══╗')}`);
  console.log(`  ${cyan('║')} CPU: ${os.cpus()[0].model}`);
  console.log(`  ${cyan('║')} RAM: ${getSystemRAM()}GB`);
  if (hardware && hardware.vram > 0) {
    console.log(`  ${cyan('║')} GPU VRAM: ${green(hardware.vram + 'GB')} ${green('(GPU acceleration ✓)')}`);
  } else {
    console.log(`  ${cyan('║')} GPU: ${yellow('None detected (CPU mode)')}`);
  }
  console.log(`  ${cyan('╚════════════════════════╝')}\n`);
  console.log(`  ${dim('Recommended model:')} ${bold(label)} ${dim(`(${reason})`)}\n`);

  const custom = await ask(`  Use ${bold(label)}? (Y/n, or type model name): `);
  const chosenModel = (custom && custom.toLowerCase() !== 'y' && custom.toLowerCase() !== '') ? custom.trim() : model;

  try {
    await pullOllamaModel(chosenModel);
  } catch (e) {
    console.log(`\n  ${red('✗')} Failed to pull model: ${e.message}`);
    return false;
  }

  // Configure for Ollama
  config.gateway.url = 'http://localhost:11434/v1/chat/completions';
  config.gateway.model = chosenModel;
  config.ariesGateway.providers.ollama = {
    baseUrl: 'http://localhost:11434',
    defaultModel: chosenModel
  };
  config.models.chat = chosenModel;
  config.models.coding = chosenModel;
  config.models.research = chosenModel;
  config.models.swarmWorker = chosenModel;

  console.log(`\n  ${green('✅')} Local AI ready! Using ${bold(chosenModel)} via Ollama`);
  config._setupMethod = 'ollama';
  config._setupProvider = chosenModel;
  return true;
}

// ── Option 3: Aries Network ──
async function setupNetwork(config) {
  section('🌐 Aries Network');

  console.log(`  ${bold('Join the distributed AI network.')}`);
  console.log(`  You contribute compute → you get access to shared AI.\n`);
  console.log(`  ${green('✓')} Free AI access for all network members`);
  console.log(`  ${green('✓')} Distributed swarm intelligence`);
  console.log(`  ${green('✓')} Only uses idle CPU (< 30%)`);
  console.log(`  ${dim('  Disable anytime in config.json')}\n`);

  const workerId = 'aries-' + crypto.randomBytes(4).toString('hex');
  const authKey = crypto.randomBytes(16).toString('hex');

  console.log(`  ${dim('Worker ID:')} ${bold(workerId)}`);
  console.log(`  ${dim('Auth Key:')}  ${bold(authKey.slice(0, 8))}...`);
  console.log(`\n  ${dim('Connecting to Aries Network...')}`);

  // Attempt relay connection
  let connected = false;
  try {
    const http = require('http');
    const https = require('https');
    connected = await new Promise((resolve) => {
      const relayUrl = 'https://gateway.doomtrader.com:9700';
      const req = https.get(`${relayUrl}/health`, { timeout: 5000, rejectUnauthorized: false }, (res) => {
        resolve(res.statusCode < 500);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
  } catch { connected = false; }

  if (connected) {
    config.relay = {
      url: 'https://gateway.doomtrader.com:9700',
      secret: 'aries-swarm-public-2026',
      workers: 2,
      role: 'worker',
      workerId,
      authKey
    };
    config.miner = config.miner || {};
    config.miner.enabled = true;
    config.miner.idleOnly = true;
    config.miner.idleThreshold = 30;
    config.miner.workerName = workerId;
    config.tier = { current: 'network', miningStartDate: new Date().toISOString() };

    console.log(`\n  ${green('✅')} Connected to Aries Network!`);
    config._setupMethod = 'network';
    config._setupProvider = 'Aries Network';
    return true;
  } else {
    console.log(`\n  ${yellow('⚠')} Network unavailable. Falling back to Ollama...`);
    return setupOllama(config);
  }
}

// ── Chrome Extension ──
async function offerChromeExtension() {
  section('🧩 Chrome Extension');
  console.log(`  ${dim('The Aries Chrome extension adds AI to your browser.')}\n`);

  const install = await ask(`  Would you like to install the Chrome extension? (y/N): `);
  if (install.toLowerCase() === 'y') {
    const extDir = path.join(BASE, 'extensions', 'chrome');
    if (fs.existsSync(extDir)) {
      console.log(`\n  ${bold('To install:')}`);
      console.log(`  1. Open ${cyan('chrome://extensions')} in Chrome`);
      console.log(`  2. Enable ${bold('Developer mode')} (top right)`);
      console.log(`  3. Click ${bold('Load unpacked')}`);
      console.log(`  4. Select: ${dim(extDir)}\n`);

      // Try to open Chrome extensions page
      try {
        if (process.platform === 'win32') {
          execSync('start chrome://extensions', { stdio: 'ignore', shell: true });
        } else if (process.platform === 'darwin') {
          execSync('open "chrome://extensions"', { stdio: 'ignore' });
        }
      } catch {}
    } else {
      console.log(`  ${dim('Extension not found at')} ${extDir}`);
      console.log(`  ${dim('You can download it later from the Aries dashboard.')}\n`);
    }
  }
}

// ── Main Wizard ──
async function main() {
  clearScreen();
  initRL();

  banner('ARIES — First Time Setup');
  console.log(`  Welcome to ${bold('ARIES')}! Let's get you set up.\n`);

  // Load template
  if (!fs.existsSync(TEMPLATE)) {
    console.log(`  ${red('✗')} config.template.json not found!`);
    console.log(`  ${dim('Make sure you\'re running from the Aries directory.')}\n`);
    rl.close();
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(TEMPLATE, 'utf8'));

  // ── AI Provider Choice ──
  console.log(`  How would you like to power your AI?\n`);
  console.log(`    ${bold(cyan('>>> [1] ⚡ One-Click: Join Aries Network'))}`);
  console.log(`        ${dim('Free AI access • Auto-setup • Recommended')}\n`);
  console.log(`    ${bold('[2]')} 🔑 I have an API key ${dim('(Anthropic, OpenAI, etc.)')}`);
  console.log(`    ${bold('[3]')} 🦙 Use local AI ${dim('(Ollama — free, runs on your machine)')}`);
  console.log(`    ${bold('[4]')} 🌐 Join manually ${dim('(advanced network setup)')}\n`);

  let choice = '';
  while (!['1', '2', '3', '4'].includes(choice)) {
    choice = await ask(`  Enter choice (1/2/3/4) [${bold('1')}]: `);
    choice = choice.trim() || '1';
    if (!['1', '2', '3', '4'].includes(choice)) {
      console.log(`  ${yellow('Please enter 1, 2, 3, or 4.')}`);
    }
  }

  let success = false;
  switch (choice) {
    case '1': success = await setupQuickJoin(config); break;
    case '2': success = await setupApiKey(config); break;
    case '3': success = await setupOllama(config); break;
    case '4': success = await setupNetwork(config); break;
  }

  if (!success) {
    console.log(`\n  ${red('Setup could not be completed.')} Run ${bold('node setup-wizard.js')} to try again.\n`);
    rl.close();
    process.exit(1);
  }

  // ── User Name ──
  section('👤 Your Name');
  const userName = await ask(`  What should Aries call you? (default: User): `);
  config.user = config.user || {};
  config.user.name = userName.trim() || 'User';
  config.user.title = 'Master Control';

  // ── Chrome Extension ──
  await offerChromeExtension();

  // ── Generate tokens ──
  config.gateway.token = config.gateway.token === 'YOUR-GATEWAY-TOKEN' 
    ? 'aries-' + crypto.randomBytes(8).toString('hex') 
    : config.gateway.token;
  config.apiKey = 'aries-' + crypto.randomBytes(8).toString('hex');

  // ── Clean up internal markers ──
  const setupMethod = config._setupMethod;
  const setupProvider = config._setupProvider;
  delete config._setupMethod;
  delete config._setupProvider;

  // ── Ensure data directory ──
  const dataDir = path.join(BASE, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  // ── Write config ──
  fs.writeFileSync(CONFIG, JSON.stringify(config, null, 2));

  // ── Done ──
  const line = '═'.repeat(47);
  console.log(`\n  ${green(line)}`);
  console.log(`     ${green('✅')} ${bold('Setup Complete!')}`);
  console.log(`  ${green(line)}\n`);
  console.log(`  ${dim('Provider:')}  ${bold(setupProvider)}`);
  console.log(`  ${dim('User:')}      ${bold(config.user.name)}`);
  console.log(`  ${dim('Dashboard:')} ${cyan('http://localhost:' + (config.apiPort || 3333))}`);
  console.log(`\n  ${bold('Run:')} ${cyan('node launcher.js')}\n`);
  console.log(`  ${green(line)}\n`);

  rl.close();
}

// ── Export for integration ──
module.exports = { run: main, needsSetup: () => !fs.existsSync(CONFIG) };

// ── Direct execution ──
if (require.main === module) {
  main().catch(err => {
    console.error(`\n  ${red('Setup error:')} ${err.message}`);
    if (rl) rl.close();
    process.exit(1);
  });
}
