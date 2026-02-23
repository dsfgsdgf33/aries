/**
 * ARIES — Ollama Watchdog
 * Monitors Ollama on remote nodes and attempts to restart via relay.
 * Also monitors local Ollama.
 */

const http = require('http');
const { execSync, spawn } = require('child_process');
const EventEmitter = require('events');

class OllamaWatchdog extends EventEmitter {
  constructor(config = {}) {
    super();
    this._interval = null;
    this._pollMs = config.pollMs || 60000; // check every 60s
    this._nodes = config.nodes || [];
    this._status = {};
    this._restartAttempts = {};
    this._maxRestarts = config.maxRestarts || 5;
  }

  start() {
    this._check(); // immediate first check
    this._interval = setInterval(() => this._check(), this._pollMs);
    console.log('[OLLAMA-WATCHDOG] Started monitoring ' + this._nodes.length + ' nodes (every ' + (this._pollMs/1000) + 's)');
  }

  stop() {
    if (this._interval) { clearInterval(this._interval); this._interval = null; }
  }

  async _check() {
    // Check local Ollama
    try {
      const local = await this._pingOllama('127.0.0.1', 11434);
      const wasDown = this._status['local'] && !this._status['local'].ok;
      this._status['local'] = { ok: true, models: local.models?.length || 0, lastCheck: Date.now() };
      if (this._restartAttempts['local']) this._restartAttempts['local'] = 0;
      if (wasDown) console.log('[OLLAMA-WATCHDOG] Local Ollama recovered');
      // Reset not-found flag on success so we detect future installs
      this._ollamaNotFound = false;
    } catch (e) {
      const wasOk = !this._status['local'] || this._status['local'].ok;
      this._status['local'] = { ok: false, error: e.message, lastCheck: Date.now() };
      // Only log and emit on first failure (status change)
      if (wasOk) {
        this.emit('down', { node: 'local', error: e.message });
        console.log('[OLLAMA-WATCHDOG] Local Ollama down: ' + e.message);
      }
      // Skip restart if binary was already not found
      if (!this._ollamaNotFound) {
        this._restartLocal();
      }
    }

    // Check remote nodes
    for (const node of this._nodes) {
      const key = node.name || node.ip;
      try {
        // Try direct Ollama port first
        const remote = await this._pingOllama(node.ip, node.ollamaPort || 11434);
        this._status[key] = { ok: true, models: remote.models?.length || 0, lastCheck: Date.now() };
        if (this._restartAttempts[key]) this._restartAttempts[key] = 0;
      } catch (e) {
        // Try through relay if available
        if (node.relayPort) {
          try {
            const relayHealth = await this._checkViaRelay(node.ip, node.relayPort, node.secret);
            const ollamaOk = relayHealth.services?.['Ollama (Vultr)']?.ok ||
                             relayHealth.workers && Object.values(relayHealth.workers).some(w => w.model);
            if (ollamaOk) {
              this._status[key] = { ok: true, via: 'relay', lastCheck: Date.now() };
              continue;
            }
          } catch {}
        }

        const wasRemoteOk = !this._status[key] || this._status[key].ok;
        this._status[key] = { ok: false, error: e.message, lastCheck: Date.now() };
        this._restartAttempts[key] = (this._restartAttempts[key] || 0) + 1;

        if (this._restartAttempts[key] <= this._maxRestarts) {
          if (wasRemoteOk) this.emit('restarting', { node: key, attempt: this._restartAttempts[key] });
          await this._restartRemote(node);
        } else if (wasRemoteOk) {
          this.emit('failed', { node: key, attempts: this._restartAttempts[key] });
        }
      }
    }
  }

  _pingOllama(host, port) {
    return new Promise((resolve, reject) => {
      const req = http.get({
        hostname: host, port, path: '/api/tags',
        timeout: 5000
      }, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch { reject(new Error('Invalid response')); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
  }

  _checkViaRelay(host, port, secret) {
    return new Promise((resolve, reject) => {
      const req = http.get({
        hostname: host, port, path: '/api/status',
        timeout: 5000,
        headers: secret ? { 'X-Aries-Secret': secret } : {}
      }, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch { reject(new Error('Invalid response')); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
  }

  _restartLocal() {
    try {
      // Check if ollama binary exists before trying to spawn
      let ollamaPath = null;
      if (process.platform === 'win32') {
        try {
          ollamaPath = execSync('where ollama 2>nul', { timeout: 3000, encoding: 'utf8' }).trim().split('\n')[0];
        } catch {}
      } else {
        try {
          ollamaPath = execSync('which ollama 2>/dev/null', { timeout: 3000, encoding: 'utf8' }).trim();
        } catch {}
      }

      if (!ollamaPath) {
        this._ollamaNotFound = true;
        // Only log once
        if (!this._binaryNotFoundLogged) {
          this._binaryNotFoundLogged = true;
          console.log('[OLLAMA-WATCHDOG] Ollama binary not found — will not attempt restart');
        }
        return;
      }

      const child = spawn(ollamaPath, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
      child.on('error', (e) => {
        this._ollamaNotFound = true;
        if (!this._binaryNotFoundLogged) {
          this._binaryNotFoundLogged = true;
          console.log('[OLLAMA-WATCHDOG] Ollama spawn failed: ' + e.message);
        }
      });
      console.log('[OLLAMA-WATCHDOG] Restarted local Ollama');
      this.emit('restarted', { node: 'local' });
    } catch (e) {
      // Don't spam — log once
      if (!this._restartLoggedOnce) {
        this._restartLoggedOnce = true;
        console.error('[OLLAMA-WATCHDOG] Local restart failed:', e.message);
      }
    }
  }

  async _restartRemote(node) {
    // Try to restart via relay's restart endpoint (if available)
    if (node.relayPort) {
      try {
        await new Promise((resolve, reject) => {
          const body = JSON.stringify({ service: 'ollama', action: 'restart' });
          const req = http.request({
            hostname: node.ip, port: node.relayPort, path: '/api/service/restart',
            method: 'POST', timeout: 10000,
            headers: {
              'Content-Type': 'application/json',
              'X-Aries-Secret': node.secret || '',
              'Content-Length': body.length
            }
          }, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve(data));
          });
          req.on('error', reject);
          req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
          req.write(body);
          req.end();
        });
        console.log('[OLLAMA-WATCHDOG] Sent restart command to ' + node.name);
        this.emit('restarted', { node: node.name, via: 'relay' });
      } catch (e) {
        console.log('[OLLAMA-WATCHDOG] Remote restart failed for ' + node.name + ': ' + e.message);
        this.emit('restart-failed', { node: node.name, error: e.message });
      }
    }
  }

  getStatus() {
    return {
      monitoring: !!this._interval,
      nodes: this._status,
      restartAttempts: this._restartAttempts
    };
  }
}

module.exports = { OllamaWatchdog };
