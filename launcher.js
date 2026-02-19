#!/usr/bin/env node
/**
 * ARIES v4.0 — Desktop App Launcher
 * Starts backend headless, opens browser in app mode, manages tray icon.
 * No npm dependencies beyond what's already installed.
 */

const fs = require('fs');
const path = require('path');
const net = require('net');
const { execSync, exec, spawn } = require('child_process');

const BASE_DIR = __dirname;
const CONFIG_PATH = path.join(BASE_DIR, 'config.json');
const LOG_PATH = path.join(BASE_DIR, 'app.log');
const DATA_DIR = path.join(BASE_DIR, 'data');
const PID_FILE = path.join(DATA_DIR, 'aries.pid');
const PORT = 3333;

// ── Logging ──
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  try { fs.appendFileSync(LOG_PATH, line + '\n'); } catch {}
  if (process.stdout.isTTY) console.log(line);
}

// ── Port check ──
function isPortInUse(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', (e) => { resolve(e.code === 'EADDRINUSE'); });
    srv.once('listening', () => { srv.close(); resolve(false); });
    srv.listen(port, '127.0.0.1');
  });
}

// ── Find browser ──
function findBrowser() {
  const candidates = [
    { name: 'Edge', paths: [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ]},
    { name: 'Chrome', paths: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ]},
    { name: 'Chromium', paths: [
      'C:\\Program Files\\Chromium\\Application\\chrome.exe',
    ]},
  ];

  for (const browser of candidates) {
    for (const p of browser.paths) {
      if (fs.existsSync(p)) {
        log(`Found browser: ${browser.name} at ${p}`);
        return { name: browser.name, path: p };
      }
    }
  }

  // Try PATH
  for (const cmd of ['msedge', 'chrome', 'chromium']) {
    try {
      const result = execSync(`where ${cmd}`, { encoding: 'utf8', timeout: 3000 }).trim().split('\n')[0];
      if (result && fs.existsSync(result.trim())) {
        log(`Found browser in PATH: ${cmd} at ${result.trim()}`);
        return { name: cmd, path: result.trim() };
      }
    } catch {}
  }

  return null;
}

// ── Open browser in app mode ──
function openAppWindow(browserPath) {
  const args = [
    `--app=http://localhost:${PORT}`,
    '--window-size=1400,900',
    '--window-position=center',
    '--disable-extensions',
    '--disable-default-apps',
    '--no-first-run',
    '--app-name=ARIES v4.0',
  ];

  log(`Launching app window: ${browserPath} ${args.join(' ')}`);
  const child = spawn(browserPath, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();
  return child;
}

// ── Start tray icon ──
function startTray() {
  const trayScript = path.join(BASE_DIR, 'tray.ps1');
  if (!fs.existsSync(trayScript)) {
    log('tray.ps1 not found, skipping tray icon');
    return null;
  }

  const child = spawn('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', trayScript
  ], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    cwd: BASE_DIR,
  });
  child.unref();
  log('Tray icon started');
  return child;
}

// ── PID file management ──
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function killOldProcess() {
  try {
    if (fs.existsSync(PID_FILE)) {
      const oldPid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
      if (oldPid && !isNaN(oldPid)) {
        try {
          process.kill(oldPid, 0); // check if alive
          log(`Killing old Aries process (PID ${oldPid})...`);
          process.kill(oldPid, 'SIGTERM');
          // Give it a moment to die
          try { execSync(`taskkill /PID ${oldPid} /T /F`, { timeout: 5000, stdio: 'ignore' }); } catch {}
        } catch (e) {
          // Process not running, that's fine
        }
      }
      try { fs.unlinkSync(PID_FILE); } catch {}
    }
  } catch (e) {
    log(`PID cleanup warning: ${e.message}`);
  }
}

function killPortListeners() {
  // Kill any processes listening on our ports (3333, 18800)
  for (const port of [3333, 18800]) {
    try {
      const output = execSync(
        `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess"`,
        { encoding: 'utf8', timeout: 5000 }
      ).trim();
      const pids = [...new Set(output.split(/\r?\n/).map(p => parseInt(p.trim(), 10)).filter(p => p && p !== process.pid))];
      for (const pid of pids) {
        log(`Killing process ${pid} on port ${port}`);
        try { execSync(`taskkill /PID ${pid} /T /F`, { timeout: 5000, stdio: 'ignore' }); } catch {}
      }
    } catch {}
  }
}

function writePidFile() {
  ensureDataDir();
  fs.writeFileSync(PID_FILE, String(process.pid));
}

function cleanupPidFile() {
  try { fs.unlinkSync(PID_FILE); } catch {}
}

// ── Main ──
async function main() {
  // First-run setup wizard
  if (!fs.existsSync(CONFIG_PATH)) {
    const wizard = require('./setup-wizard');
    await wizard.run();
    if (!fs.existsSync(CONFIG_PATH)) {
      log('Setup wizard did not create config.json. Exiting.');
      process.exit(1);
    }
  }

  log('═══ ARIES v4.0 Desktop Launcher ═══');

  // Kill zombie processes from previous runs
  ensureDataDir();
  killOldProcess();
  killPortListeners();

  // Check if already running
  const inUse = await isPortInUse(PORT);
  if (inUse) {
    log(`Port ${PORT} already in use — another instance is running.`);
    log('Opening browser window to existing instance...');
    const browser = findBrowser();
    if (browser) {
      openAppWindow(browser.path);
    } else {
      log('ERROR: No supported browser found. Install Edge or Chrome.');
      // Fallback: try to open in default browser
      exec(`start http://localhost:${PORT}`);
    }
    return;
  }

  // Start headless backend
  log('Starting Aries backend (headless)...');
  try {
    const { startHeadless } = require('./core/headless');
    const aries = await startHeadless(CONFIG_PATH);

    // Write PID file
    writePidFile();

    log(`API server listening on port ${PORT}`);
    if (aries.coordinatorStarted) {
      log(`Swarm coordinator on port ${aries.coordinatorPort}`);
    }

    // Open browser
    const browser = findBrowser();
    if (browser) {
      // Small delay to ensure server is ready
      setTimeout(() => {
        openAppWindow(browser.path);
      }, 500);
    } else {
      log('WARNING: No browser found. Open http://localhost:3333 manually.');
      exec(`start http://localhost:${PORT}`);
    }

    // Start tray icon
    setTimeout(() => {
      startTray();
    }, 1000);

    // Graceful shutdown
    const shutdown = () => {
      log('Shutting down...');
      cleanupPidFile();
      try { aries.shutdown(); } catch {}
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.on('SIGHUP', shutdown);

    // Keep alive
    log('Aries is running. Close the app window or press Ctrl+C to stop.');

  } catch (err) {
    log(`FATAL: Failed to start — ${err.stack || err.message}`);
    process.exit(1);
  }
}

main().catch(err => {
  log(`FATAL: ${err.stack || err.message}`);
  process.exit(1);
});
