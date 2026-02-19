/**
 * ARIES v5.0 — Process Manager
 * PID file tracking, port detection, graceful shutdown.
 */

const fs = require('fs');
const path = require('path');
const net = require('net');
const { execSync } = require('child_process');

const PID_FILE = path.join(__dirname, '..', 'data', 'aries.pid');
const PORT_FILE = path.join(__dirname, '..', 'data', 'aries.port');

class ProcessManager {
  /** Write PID file */
  static writePid(pid) {
    const dir = path.dirname(PID_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(PID_FILE, String(pid || process.pid));
  }

  /** Write port file */
  static writePort(port) {
    const dir = path.dirname(PORT_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(PORT_FILE, String(port));
  }

  /** Read PID from file */
  static readPid() {
    try {
      return parseInt(fs.readFileSync(PID_FILE, 'utf8').trim());
    } catch {
      return null;
    }
  }

  /** Read port from file */
  static readPort() {
    try {
      return parseInt(fs.readFileSync(PORT_FILE, 'utf8').trim());
    } catch {
      return 3333;
    }
  }

  /** Check if a process is running */
  static isProcessRunning(pid) {
    if (!pid) return false;
    try {
      // On Windows, use tasklist
      const output = execSync(`tasklist /FI "PID eq ${pid}" /NH /FO CSV`, {
        encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true
      });
      return output.includes(String(pid));
    } catch {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    }
  }

  /** Check if port is in use */
  static isPortInUse(port) {
    return new Promise(resolve => {
      const srv = net.createServer();
      srv.once('error', e => resolve(e.code === 'EADDRINUSE'));
      srv.once('listening', () => { srv.close(); resolve(false); });
      srv.listen(port, '127.0.0.1');
    });
  }

  /** Get running status */
  static async getStatus() {
    const pid = this.readPid();
    const port = this.readPort();
    const running = pid ? this.isProcessRunning(pid) : false;
    const portInUse = await this.isPortInUse(port);

    // If PID file exists but process is dead, clean up
    if (pid && !running) {
      try { fs.unlinkSync(PID_FILE); } catch {}
    }

    // Try health check if port is in use
    let health = null;
    if (portInUse) {
      try {
        const http = require('http');
        health = await new Promise((resolve, reject) => {
          const req = http.get(`http://127.0.0.1:${port}/api/health`, { timeout: 3000 }, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
              try { resolve(JSON.parse(data)); } catch { resolve(null); }
            });
          });
          req.on('error', () => resolve(null));
          req.on('timeout', () => { req.destroy(); resolve(null); });
        });
      } catch {}
    }

    return { pid, port, running: running || portInUse, health };
  }

  /** Kill the running instance */
  static async kill() {
    const pid = this.readPid();
    if (pid && this.isProcessRunning(pid)) {
      try {
        // Try graceful first via API
        const port = this.readPort();
        const http = require('http');
        await new Promise((resolve) => {
          const req = http.request(`http://127.0.0.1:${port}/api/shutdown`, { method: 'POST', timeout: 3000 }, () => resolve());
          req.on('error', () => resolve());
          req.on('timeout', () => { req.destroy(); resolve(); });
          req.end();
        });

        // Wait briefly
        await new Promise(r => setTimeout(r, 2000));

        // Force kill if still alive
        if (this.isProcessRunning(pid)) {
          try { process.kill(pid, 'SIGTERM'); } catch {}
          await new Promise(r => setTimeout(r, 1000));
          if (this.isProcessRunning(pid)) {
            try { execSync(`taskkill /PID ${pid} /F`, { timeout: 5000, stdio: 'pipe' }); } catch {}
          }
        }
      } catch {}
    }

    // Clean up PID file
    try { fs.unlinkSync(PID_FILE); } catch {}
    return true;
  }

  /** Remove PID file */
  static cleanup() {
    try { fs.unlinkSync(PID_FILE); } catch {}
    try { fs.unlinkSync(PORT_FILE); } catch {}
  }

  /** Register graceful shutdown handlers */
  static registerShutdownHandlers(shutdownFn) {
    const handler = async (signal) => {
      console.log(`[PROCESS] Received ${signal}, shutting down...`);
      try { await shutdownFn(); } catch {}
      this.cleanup();
      process.exit(0);
    };

    process.on('SIGINT', () => handler('SIGINT'));
    process.on('SIGTERM', () => handler('SIGTERM'));
    process.on('SIGHUP', () => handler('SIGHUP'));
  }
}

module.exports = ProcessManager;
