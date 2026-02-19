#!/usr/bin/env node
/**
 * ARIES v4.0 — CLI
 * 
 * Commands: start, stop, restart, status, logs, token, config, version
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');

const BASE_DIR = path.join(__dirname, '..');
const ProcessManager = require(path.join(BASE_DIR, 'core', 'process-manager'));

const args = process.argv.slice(2);
const command = args[0] || 'help';

const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[90m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function banner() {
  console.log(`${CYAN}
  █▀▀█ █▀▀█ ▀█▀ █▀▀ █▀▀
  █▄▄█ █▄▄▀  █  █▀▀ ▀▀█
  █  █ █  █ ▄█▄ █▄▄ ▄▄█  ${BOLD}v4.0${RESET}${CYAN}
  ─────────────────────────
  Autonomous Runtime Intelligence
  & Execution System${RESET}
  `);
}

async function cmd_start() {
  banner();
  const status = await ProcessManager.getStatus();
  
  if (status.running) {
    console.log(`${YELLOW}⚠ Aries is already running (PID: ${status.pid}, Port: ${status.port})${RESET}`);
    return;
  }

  const useWatchdog = args.includes('--watchdog') || args.includes('-w');
  const script = useWatchdog
    ? path.join(BASE_DIR, 'core', 'watchdog.js')
    : path.join(BASE_DIR, 'core', 'daemon.js');

  console.log(`${DIM}Starting Aries ${useWatchdog ? '(with watchdog)' : '(daemon)'}...${RESET}`);

  const child = spawn(process.execPath, [script], {
    cwd: BASE_DIR,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env },
  });
  child.unref();

  // Wait for it to come up
  console.log(`${DIM}Waiting for server...${RESET}`);
  const port = ProcessManager.readPort() || 3333;
  for (let attempts = 0; attempts < 40; attempts++) {
    await new Promise(r => setTimeout(r, 500));
    try {
      const http = require('http');
      const health = await new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${port}/api/health`, { timeout: 3000 }, res => {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
      });
      if (health && health.status) {
        const pid = ProcessManager.readPid();
        console.log(`${GREEN}✓ Aries v4.0 is running${RESET}`);
        console.log(`  ${DIM}PID:    ${pid || 'unknown'}${RESET}`);
        console.log(`  ${DIM}Port:   ${port}${RESET}`);
        console.log(`  ${DIM}Health: ${health.status}${RESET}`);
        console.log(`  ${CYAN}Dashboard: http://localhost:${port}${RESET}`);
        return;
      }
    } catch {}
  }

  console.log(`${YELLOW}⚠ Started but health check timed out. Check logs.${RESET}`);
}

async function cmd_stop() {
  banner();
  const status = await ProcessManager.getStatus();
  
  if (!status.running) {
    console.log(`${DIM}Aries is not running.${RESET}`);
    return;
  }

  console.log(`${DIM}Stopping Aries (PID: ${status.pid})...${RESET}`);
  await ProcessManager.kill();

  // Also kill watchdog if running
  try {
    execSync('taskkill /FI "WINDOWTITLE eq *aries*watchdog*" /F 2>nul', { stdio: 'pipe' });
  } catch {}

  console.log(`${GREEN}✓ Aries stopped${RESET}`);
}

async function cmd_restart() {
  await cmd_stop();
  await new Promise(r => setTimeout(r, 1000));
  await cmd_start();
}

async function cmd_status() {
  banner();
  const status = await ProcessManager.getStatus();
  
  if (!status.running) {
    console.log(`${RED}● Aries is not running${RESET}`);
    return;
  }

  console.log(`${GREEN}● Aries is running${RESET}`);
  console.log(`  PID:       ${status.pid}`);
  console.log(`  Port:      ${status.port}`);

  if (status.health) {
    const h = status.health;
    console.log(`  Status:    ${h.status === 'healthy' ? GREEN : YELLOW}${h.status}${RESET}`);
    if (h.checks) {
      Object.entries(h.checks).forEach(([k, v]) => {
        const color = v === 'ok' ? GREEN : (typeof v === 'number' ? DIM : YELLOW);
        console.log(`  ${k.padEnd(10)} ${color}${v}${RESET}`);
      });
    }
  }

  console.log(`  ${CYAN}Dashboard: http://localhost:${status.port}${RESET}`);
}

async function cmd_logs() {
  const logDir = path.join(BASE_DIR, 'logs');
  const today = new Date().toISOString().slice(0, 10);
  const logFile = path.join(logDir, `aries-${today}.log`);

  if (!fs.existsSync(logFile)) {
    console.log(`${DIM}No logs for today.${RESET}`);
    return;
  }

  const lines = args.includes('-n') ? parseInt(args[args.indexOf('-n') + 1]) || 50 : 50;
  const content = fs.readFileSync(logFile, 'utf8');
  const allLines = content.split('\n');
  console.log(allLines.slice(-lines).join('\n'));
}

async function cmd_token() {
  const subCmd = args[1] || 'show';
  const configMod = require(path.join(BASE_DIR, 'core', 'config'));
  configMod.load();

  if (subCmd === 'generate') {
    const token = configMod.generateToken();
    console.log(`${GREEN}✓ New token: ${token}${RESET}`);
  } else if (subCmd === 'rotate') {
    const token = configMod.rotateTokens();
    console.log(`${GREEN}✓ All tokens rotated. New token: ${token}${RESET}`);
  } else {
    const tokens = configMod.get('auth.tokens', []);
    console.log(`${BOLD}API Tokens:${RESET}`);
    tokens.forEach((t, i) => console.log(`  ${i + 1}. ${t.substring(0, 8)}...${t.slice(-8)}`));
  }
}

function cmd_version() {
  const pkg = require(path.join(BASE_DIR, 'package.json'));
  console.log(`ARIES v${pkg.version}`);
}

function cmd_help() {
  banner();
  console.log(`${BOLD}Usage: aries <command> [options]${RESET}
  
${BOLD}Commands:${RESET}
  start [--watchdog]  Start Aries daemon (optionally with watchdog)
  stop                Stop running instance
  restart             Restart Aries
  status              Show running status & health
  logs [-n 50]        Show recent log entries
  token [generate|rotate|show]  Manage API tokens
  version             Show version
  help                Show this help

${BOLD}Options:${RESET}
  --watchdog, -w      Start with auto-restart watchdog

${BOLD}Other ways to run:${RESET}
  node aries.js       TUI mode (terminal UI)
  node launcher.js    Desktop app mode (browser + tray)
  `);
}

// Dispatch
const commands = {
  start: cmd_start,
  stop: cmd_stop,
  restart: cmd_restart,
  status: cmd_status,
  logs: cmd_logs,
  log: cmd_logs,
  token: cmd_token,
  tokens: cmd_token,
  version: cmd_version,
  '-v': cmd_version,
  '--version': cmd_version,
  help: cmd_help,
  '-h': cmd_help,
  '--help': cmd_help,
};

const fn = commands[command];
if (fn) {
  fn().catch(err => {
    console.error(`${RED}Error: ${err.message}${RESET}`);
    process.exit(1);
  });
} else {
  console.error(`${RED}Unknown command: ${command}${RESET}`);
  cmd_help();
  process.exit(1);
}
