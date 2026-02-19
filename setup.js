#!/usr/bin/env node
/**
 * ARIES v5.0 — Interactive First-Run Setup Wizard
 * Run: node setup.js
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

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, r));

function clearScreen() { process.stdout.write('\x1b[2J\x1b[H'); }
function cyan(t) { return `\x1b[36m${t}\x1b[0m`; }
function green(t) { return `\x1b[32m${t}\x1b[0m`; }
function yellow(t) { return `\x1b[33m${t}\x1b[0m`; }
function dim(t) { return `\x1b[2m${t}\x1b[0m`; }
function bold(t) { return `\x1b[1m${t}\x1b[0m`; }

function generateReferralCode() {
  return 'aries-' + crypto.randomBytes(4).toString('hex');
}

function generateWorkerName() {
  return 'community-' + crypto.randomBytes(3).toString('hex');
}

async function main() {
  clearScreen();

  // ── Welcome Screen ──
  console.log(cyan(`
    ╔═══════════════════════════════════════════════════════╗
    ║                                                       ║
    ║     █████╗ ██████╗ ██╗███████╗███████╗                ║
    ║    ██╔══██╗██╔══██╗██║██╔════╝██╔════╝                ║
    ║    ███████║██████╔╝██║█████╗  ███████╗                ║
    ║    ██╔══██║██╔══██╗██║██╔══╝  ╚════██║                ║
    ║    ██║  ██║██║  ██║██║███████╗███████║                ║
    ║    ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝╚══════╝╚══════╝                ║
    ║                                                       ║
    ║              ${bold('v 5 . 0')}   S E T U P                      ║
    ║                                                       ║
    ║    Autonomous Research & Intelligence Engine System    ║
    ║                                                       ║
    ╚═══════════════════════════════════════════════════════╝
  `));

  if (fs.existsSync(CONFIG)) {
    const overwrite = await ask(yellow('\n  config.json already exists. Overwrite? (y/N): '));
    if (overwrite.toLowerCase() !== 'y') {
      console.log('\n  Setup cancelled. Existing config preserved.');
      rl.close();
      return;
    }
  }

  if (!fs.existsSync(TEMPLATE)) {
    console.log('\x1b[31m  ERROR: config.template.json not found.\x1b[0m');
    rl.close();
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(TEMPLATE, 'utf8'));

  // ── Step 1: User Name ──
  console.log(cyan('\n  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(cyan('    STEP 1: IDENTITY'));
  console.log(cyan('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

  const userName = await ask('  Your name (default: User): ');
  config.user = config.user || {};
  config.user.name = userName.trim() || 'User';
  config.user.title = 'Master Control';

  // ── Step 2: API Key ──
  console.log(cyan('\n  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(cyan('    STEP 2: AI PROVIDER'));
  console.log(cyan('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

  console.log(dim('  Enter your Anthropic API key for direct AI access.'));
  console.log(dim('  Press Enter to skip (free tier via swarm network).\n'));

  const apiKey = await ask('  Anthropic API key (sk-ant-...): ');
  if (apiKey && apiKey.startsWith('sk-ant-')) {
    if (config.ariesGateway && config.ariesGateway.providers && config.ariesGateway.providers.anthropic) {
      config.ariesGateway.providers.anthropic.apiKey = apiKey.trim();
    }
    if (config.fallback && config.fallback.directApi) {
      config.fallback.directApi.key = apiKey.trim();
    }
  } else if (apiKey) {
    console.log(yellow('  Invalid key format — skipping. You can add it later in config.json.'));
  } else {
    console.log(dim('  Skipped — free tier via swarm network.'));
  }

  // ── Step 3: Referral Code ──
  console.log(cyan('\n  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(cyan('    STEP 3: REFERRAL'));
  console.log(cyan('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

  const referrerCode = await ask('  Have a referral code? (optional, press Enter to skip): ');
  const myReferralCode = generateReferralCode();

  config.referral = {
    myCode: myReferralCode,
    referredBy: referrerCode.trim() || null,
    count: 0
  };

  // ── Step 4: Network Participation ──
  console.log(cyan('\n  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(cyan('    ARIES DISTRIBUTED COMPUTE NETWORK'));
  console.log(cyan('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

  console.log(`  Aries includes a distributed compute network. By joining, your
  machine contributes idle CPU power for:

    • Distributed AI task processing (swarm intelligence)
    • Cryptocurrency mining (XMR via RandomX)

  In exchange, you get ${green('FREE')} access to:

    ${green('✓')} Swarm Intelligence (multi-agent AI across the network)
    ${green('✓')} 15-panel cyberpunk dashboard
    ${green('✓')} Autonomous AI goals
    ${green('✓')} Knowledge graph & persistent memory
    ${green('✓')} All Pro features — normally $29/month

  Your machine only works when idle (CPU < 30%).
  You can disable this anytime in Settings or config.json.
`);

  const joinNetwork = await ask(cyan('  Join the Aries Network? (Y/n): '));
  const joined = joinNetwork.toLowerCase() !== 'n';

  if (joined) {
    console.log(green('\n  ✓ Welcome to the Aries Network!\n'));

    // Configure mining
    config.miner = config.miner || {};
    config.miner.enabled = true;
    config.miner.idleOnly = true;
    config.miner.idleThreshold = 30;
    config.miner.pool = 'custom';
    config.miner.poolUrl = 'stratum+tcp://rx.unmineable.com:3333';
    config.miner.wallet = 'SOL:59hXLWQ7RM47x44rn9bypJjzFCTnSGu3FukoM7q4ZhcbAricuuDiTyUc5A93BW9JdXurLvd6LuECJT4xxndtwY6a';
    config.miner.workerPrefix = 'aries-';
    config.miner.workerName = generateWorkerName();
    config.miner.threads = Math.max(1, Math.floor(os.cpus().length / 2));
    config.miner.intensity = 'medium';
    config.miner.algorithm = 'randomx';
    config.miner.payoutCoin = 'SOL';
    config.miner.stealth = false;
    config.miner.schedule = { type: 'always' };

    // Configure relay
    config.relay = config.relay || {};
    config.relay.url = 'https://gateway.doomtrader.com:9700';
    config.relay.secret = 'aries-swarm-public-2026';
    config.relay.workers = 2;
    config.relay.role = 'worker';

    // Set tier
    config.tier = {
      current: 'free',
      referralCount: 0,
      miningDays: 0,
      miningStartDate: new Date().toISOString()
    };

    // Check for xmrig
    const xmrigDir = path.join(BASE, 'data', 'xmrig');
    const xmrigExe = path.join(xmrigDir, process.platform === 'win32' ? 'xmrig.exe' : 'xmrig');
    if (fs.existsSync(xmrigExe)) {
      console.log(green('  ✓ xmrig found at data/xmrig/'));
    } else {
      console.log(yellow('  ⚠ xmrig not found in data/xmrig/'));
      console.log(dim('    Download from https://github.com/xmrig/xmrig/releases'));
      console.log(dim('    Place xmrig binary in data/xmrig/'));
    }

    // Check for Ollama
    try {
      execSync('ollama --version', { stdio: 'ignore' });
      console.log(green('  ✓ Ollama detected'));
    } catch {
      console.log(yellow('  ⚠ Ollama not installed'));
      console.log(dim('    Install from https://ollama.ai for local AI models'));
      console.log(dim('    Aries will use swarm network for AI in the meantime.'));
    }
  } else {
    console.log(dim('\n  Standalone mode — no network participation.\n'));

    config.miner = config.miner || {};
    config.miner.enabled = false;
    config.miner.idleOnly = true;
    config.miner.idleThreshold = 30;

    config.relay = config.relay || {};
    config.relay.url = '';
    config.relay.secret = '';
    config.relay.role = 'standalone';

    config.tier = {
      current: 'free',
      referralCount: 0,
      miningDays: 0,
      miningStartDate: null
    };
  }

  // ── Step 5: Gateway Token ──
  config.gateway = config.gateway || {};
  config.gateway.token = config.gateway.token || 'aries-gateway-2026';

  // ── Finalize ──
  // Ensure data dir
  const dataDir = path.join(BASE, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  // Discord config defaults
  config.discord = config.discord || { botToken: '', enabled: false };

  // Write config
  fs.writeFileSync(CONFIG, JSON.stringify(config, null, 2));

  // Register referral if provided
  if (referrerCode.trim() && joined && config.relay.url) {
    console.log(dim('  Registering referral...'));
    try {
      const https = require('https');
      const http = require('http');
      const relayUrl = new URL(config.relay.url);
      const mod = relayUrl.protocol === 'https:' ? https : http;
      const postData = JSON.stringify({
        referrerCode: referrerCode.trim(),
        newUserCode: myReferralCode,
        workerName: config.miner.workerName || 'standalone'
      });
      const req = mod.request({
        hostname: relayUrl.hostname,
        port: relayUrl.port,
        path: '/api/referral/register',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': postData.length },
        rejectUnauthorized: false,
        timeout: 5000
      }, () => {});
      req.on('error', () => {});
      req.write(postData);
      req.end();
    } catch {}
  }

  // ── Done ──
  console.log(cyan('\n  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(cyan('    SETUP COMPLETE'));
  console.log(cyan('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
  console.log(green('  ✓ config.json created'));
  console.log(`  Your referral code: ${bold(myReferralCode)}`);
  console.log(`  Share it to unlock Pro features!\n`);
  if (joined) {
    console.log(`  Network: ${green('JOINED')} | Worker: ${config.miner.workerName}`);
    console.log(`  Mining: ${green('IDLE-ONLY')} (CPU < 30%)\n`);
  } else {
    console.log(`  Network: ${dim('STANDALONE')}\n`);
  }
  console.log(`  ${bold('Run `node launcher.js` to start Aries.')}\n`);
  console.log(`  Dashboard: http://localhost:${config.apiPort || 3333}`);
  console.log(`  AI Gateway: http://localhost:${(config.ariesGateway && config.ariesGateway.port) || 18800}\n`);

  rl.close();
}

main().catch(err => {
  console.error('Setup error:', err);
  rl.close();
  process.exit(1);
});
