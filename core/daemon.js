/**
 * ARIES v4.4 — Production Daemon
 * Graceful shutdown, crash recovery, watchdog, PID management.
 * Uses only Node.js built-in modules.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CRASH_LOG_FILE = path.join(DATA_DIR, 'crash-logs.json');

class Daemon {
  /**
   * @param {object} config - daemon config section
   * @param {object} refs - { shutdown, modules... }
   */
  constructor(config = {}, refs = {}) {
    this.config = config;
    this.maxRestarts = config.maxRestarts || 5;
    this.restartWindowMs = config.restartWindowMs || 600000;
    this.watchdogMemPct = config.watchdogMemPct || 90;
    this.pidFile = config.pidFile || path.join(DATA_DIR, 'aries.pid');
    this.refs = refs;
    this._startTime = Date.now();
    this._restartHistory = [];
    this._watchdogTimer = null;
    this._memHighSince = null;
    this._crashLogs = [];
    this._isShuttingDown = false;
    this._loadCrashLogs();
  }

  _ensureDir() {
    try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
  }

  _loadCrashLogs() {
    try {
      if (fs.existsSync(CRASH_LOG_FILE)) {
        this._crashLogs = JSON.parse(fs.readFileSync(CRASH_LOG_FILE, 'utf8'));
      }
    } catch { this._crashLogs = []; }
  }

  _saveCrashLogs() {
    try {
      this._ensureDir();
      if (this._crashLogs.length > 100) this._crashLogs = this._crashLogs.slice(-100);
      fs.writeFileSync(CRASH_LOG_FILE, JSON.stringify(this._crashLogs, null, 2));
    } catch {}
  }

  /**
   * Start the daemon
   */
  start() {
    this._startTime = Date.now();
    this._ensureDir();

    // Write PID file
    try {
      const pidPath = typeof this.pidFile === 'string' && path.isAbsolute(this.pidFile)
        ? this.pidFile
        : path.join(DATA_DIR, 'aries.pid');
      fs.writeFileSync(pidPath, String(process.pid));
    } catch {}

    // Set up signal handlers
    const gracefulShutdown = (signal) => {
      if (this._isShuttingDown) return;
      this._isShuttingDown = true;
      console.log(`[DAEMON] Received ${signal}, shutting down gracefully...`);
      try { require('fs').appendFileSync(require('path').join(__dirname, '..', 'data', 'exit-debug.log'), new Date().toISOString() + ' SIGNAL=' + signal + '\n' + new Error().stack + '\n\n'); } catch {}
      this.stop().then(() => {
        process.exit(0);
      }).catch(() => {
        process.exit(1);
      });
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Crash recovery
    process.on('uncaughtException', (err) => {
      this._handleCrash('uncaughtException', err);
    });

    process.on('unhandledRejection', (reason) => {
      this._handleCrash('unhandledRejection', reason instanceof Error ? reason : new Error(String(reason)));
    });

    // Start watchdog
    this._startWatchdog();

    return { started: true, pid: process.pid };
  }

  /**
   * Handle a crash
   * @param {string} type
   * @param {Error} err
   */
  _handleCrash(type, err) {
    const crashEntry = {
      type,
      message: err.message,
      stack: err.stack ? err.stack.substring(0, 2000) : '',
      timestamp: new Date().toISOString(),
      uptime: this.getUptime()
    };
    this._crashLogs.push(crashEntry);
    this._saveCrashLogs();
    console.error(`[DAEMON] Crash (${type}):`, err.message);

    // Check restart limit
    const now = Date.now();
    this._restartHistory.push(now);
    this._restartHistory = this._restartHistory.filter(t => (now - t) < this.restartWindowMs);

    if (this._restartHistory.length > this.maxRestarts) {
      console.error(`[DAEMON] Too many crashes (${this._restartHistory.length} in ${this.restartWindowMs / 1000}s). Continuing but logging warning.`);
      // Don't exit — just clear history and keep running
      this._restartHistory = [];
    }
  }

  /**
   * Start watchdog monitoring
   */
  _startWatchdog() {
    if (this._watchdogTimer) return;

    this._watchdogTimer = setInterval(() => {
      try {
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedPct = Math.round(((totalMem - freeMem) / totalMem) * 100);

        if (usedPct > this.watchdogMemPct) {
          if (!this._memHighSince) {
            this._memHighSince = Date.now();
          } else if ((Date.now() - this._memHighSince) > 300000) { // 5 minutes
            console.error(`[DAEMON] Memory usage at ${usedPct}% for >5min. Suggesting restart.`);
            this._crashLogs.push({
              type: 'watchdog-memory',
              message: `Memory at ${usedPct}% for >5 minutes`,
              timestamp: new Date().toISOString()
            });
            this._saveCrashLogs();
            this._memHighSince = null; // Reset so we don't spam
          }
        } else {
          this._memHighSince = null;
        }
      } catch {}
    }, 60000);
  }

  /**
   * Stop the daemon gracefully
   * @returns {Promise<{stopped: boolean}>}
   */
  async stop() {
    this._isShuttingDown = true;

    // Stop watchdog
    if (this._watchdogTimer) {
      clearInterval(this._watchdogTimer);
      this._watchdogTimer = null;
    }

    // Call shutdown on refs
    if (this.refs.shutdown && typeof this.refs.shutdown === 'function') {
      try {
        await this.refs.shutdown();
      } catch (e) {
        console.error('[DAEMON] Shutdown error:', e.message);
      }
    }

    // Remove PID file
    try {
      const pidPath = typeof this.pidFile === 'string' && path.isAbsolute(this.pidFile)
        ? this.pidFile
        : path.join(DATA_DIR, 'aries.pid');
      if (fs.existsSync(pidPath)) fs.unlinkSync(pidPath);
    } catch {}

    return { stopped: true };
  }

  /**
   * Restart (stop then start)
   * @returns {Promise<object>}
   */
  async restart() {
    await this.stop();
    return this.start();
  }

  /**
   * Get process uptime in seconds
   * @returns {number}
   */
  getUptime() {
    return Math.floor((Date.now() - this._startTime) / 1000);
  }

  /**
   * Comprehensive health check
   * @returns {object}
   */
  getHealth() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memPct = Math.round((usedMem / totalMem) * 100);
    const processMemory = process.memoryUsage();

    return {
      status: this._isShuttingDown ? 'shutting_down' : 'running',
      pid: process.pid,
      uptime: this.getUptime(),
      uptimeFormatted: this._formatUptime(this.getUptime()),
      startedAt: new Date(this._startTime).toISOString(),
      memory: {
        systemUsedPct: memPct,
        systemUsedGb: (usedMem / 1073741824).toFixed(2),
        systemTotalGb: (totalMem / 1073741824).toFixed(2),
        processRssMb: (processMemory.rss / 1048576).toFixed(1),
        processHeapMb: (processMemory.heapUsed / 1048576).toFixed(1),
        processHeapTotalMb: (processMemory.heapTotal / 1048576).toFixed(1)
      },
      cpu: {
        cores: os.cpus().length,
        model: os.cpus()[0]?.model || 'unknown',
        loadAvg: os.loadavg()
      },
      crashes: {
        total: this._crashLogs.length,
        recentRestarts: this._restartHistory.length,
        lastCrash: this._crashLogs.length > 0 ? this._crashLogs[this._crashLogs.length - 1] : null
      },
      watchdog: {
        memoryThreshold: this.watchdogMemPct,
        memoryHigh: this._memHighSince ? Math.floor((Date.now() - this._memHighSince) / 1000) + 's' : null
      },
      platform: {
        os: os.type(),
        release: os.release(),
        arch: os.arch(),
        hostname: os.hostname(),
        nodeVersion: process.version
      }
    };
  }

  _formatUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    const parts = [];
    if (d > 0) parts.push(d + 'd');
    if (h > 0) parts.push(h + 'h');
    if (m > 0) parts.push(m + 'm');
    parts.push(s + 's');
    return parts.join(' ');
  }

  /**
   * Get crash logs
   * @returns {Array}
   */
  getCrashLogs() {
    return this._crashLogs;
  }
}

module.exports = { Daemon };
