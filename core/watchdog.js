/**
 * ARIES v5.0 — Watchdog Process
 * 
 * Monitors the main Aries daemon and restarts on crash.
 * Runs as a separate process for true independence.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const DAEMON_SCRIPT = path.join(__dirname, 'daemon.js');
const LOG_FILE = path.join(__dirname, '..', 'logs', 'watchdog.log');
const STATE_FILE = path.join(__dirname, '..', 'data', 'watchdog-state.json');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    const dir = path.dirname(LOG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch {}
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { restarts: 0, lastRestart: null, crashes: [] };
  }
}

function saveState(state) {
  try {
    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch {}
}

class Watchdog {
  constructor(opts = {}) {
    this.checkIntervalMs = opts.checkIntervalMs || 10000;
    this.maxRestarts = opts.maxRestarts || 5;
    this.restartCooldownMs = opts.restartCooldownMs || 60000;
    this.port = opts.port || 3333;
    this.child = null;
    this._interval = null;
    this._state = loadState();
  }

  start() {
    log('═══ ARIES Watchdog v5.0 Started ═══');
    this._spawnDaemon();
    this._interval = setInterval(() => this._healthCheck(), this.checkIntervalMs);
  }

  _spawnDaemon() {
    log('Spawning Aries daemon...');

    this.child = spawn(process.execPath, [DAEMON_SCRIPT], {
      cwd: path.join(__dirname, '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, ARIES_WATCHDOG: '1' },
    });

    this.child.stdout.on('data', d => {
      const lines = d.toString().split('\n').filter(Boolean);
      lines.forEach(l => log(`[DAEMON] ${l}`));
    });

    this.child.stderr.on('data', d => {
      const lines = d.toString().split('\n').filter(Boolean);
      lines.forEach(l => log(`[DAEMON:ERR] ${l}`));
    });

    this.child.on('exit', (code, signal) => {
      log(`Daemon exited: code=${code} signal=${signal}`);
      this._handleCrash(code, signal);
    });

    this.child.on('error', err => {
      log(`Daemon spawn error: ${err.message}`);
      this._handleCrash(-1, err.message);
    });
  }

  _handleCrash(code, signal) {
    this._state.crashes.push({ code, signal, time: new Date().toISOString() });
    if (this._state.crashes.length > 50) this._state.crashes = this._state.crashes.slice(-50);

    // Check restart budget
    const now = Date.now();
    const recentRestarts = this._state.crashes.filter(c => 
      now - new Date(c.time).getTime() < this.restartCooldownMs
    ).length;

    if (recentRestarts >= this.maxRestarts) {
      log(`FATAL: Too many restarts (${recentRestarts}/${this.maxRestarts}) within cooldown. Giving up.`);
      saveState(this._state);
      process.exit(1);
    }

    this._state.restarts++;
    this._state.lastRestart = new Date().toISOString();
    saveState(this._state);

    log(`Restarting daemon (attempt ${recentRestarts + 1}/${this.maxRestarts})...`);
    setTimeout(() => this._spawnDaemon(), 2000);
  }

  async _healthCheck() {
    if (!this.child || this.child.exitCode !== null) return;

    try {
      const ok = await new Promise((resolve) => {
        const req = http.get(`http://127.0.0.1:${this.port}/api/health`, { timeout: 5000 }, res => {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => resolve(res.statusCode === 200));
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
      });

      if (!ok) {
        log('Health check failed — daemon unresponsive');
        // Don't kill immediately, give it a chance
      }
    } catch {}
  }

  stop() {
    if (this._interval) clearInterval(this._interval);
    if (this.child) {
      try { this.child.kill('SIGTERM'); } catch {}
    }
    log('Watchdog stopped');
  }
}

// Run directly as watchdog process
if (require.main === module) {
  const config = (() => {
    try {
      const cfgPath = path.join(__dirname, '..', 'config', 'aries.json');
      if (fs.existsSync(cfgPath)) return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
    } catch { return {}; }
  })();

  const wd = new Watchdog({
    port: config.server?.port || config.apiPort || 3333,
    ...(config.watchdog || {}),
  });
  wd.start();

  process.on('SIGINT', () => { wd.stop(); process.exit(0); });
  process.on('SIGTERM', () => { wd.stop(); process.exit(0); });
}

module.exports = Watchdog;
