/**
 * ARIES — Swarm Worker Setup (Auto Ollama Installer)
 * Detects, installs, and configures Ollama for swarm workers.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { execSync, spawn } = require('child_process');
const EventEmitter = require('events');

const OLLAMA_API = 'http://localhost:11434';
const DEFAULT_MODEL = 'qwen2.5:1.5b';

class SwarmWorkerSetup extends EventEmitter {
  constructor(opts = {}) {
    super();
    this._model = opts.model || DEFAULT_MODEL;
    this._ollamaReady = false;
    this._modelReady = false;
  }

  /**
   * Full setup flow: detect → install → pull model → verify
   */
  async setup() {
    try {
      this.emit('progress', { step: 'detect', message: 'Checking for Ollama...' });
      const installed = await this._detectOllama();

      if (!installed) {
        this.emit('progress', { step: 'install', message: 'Installing Ollama...' });
        await this._installOllama();
        // Wait for Ollama to start
        await this._waitForOllama(60000);
      }

      this._ollamaReady = true;
      this.emit('progress', { step: 'pull', message: `Pulling model ${this._model}...` });
      await this._pullModel();

      this._modelReady = true;
      this.emit('progress', { step: 'verify', message: 'Verifying...' });
      const ok = await this._verify();

      if (ok) {
        this.emit('progress', { step: 'done', message: 'Ollama ready!' });
        return { ok: true, model: this._model };
      } else {
        throw new Error('Verification failed');
      }
    } catch (e) {
      this.emit('progress', { step: 'error', message: e.message });
      return { ok: false, error: e.message };
    }
  }

  async _detectOllama() {
    // Try API first
    try {
      const resp = await this._httpGet(`${OLLAMA_API}/api/tags`);
      if (resp.status === 200) return true;
    } catch {}

    // Try CLI
    try {
      execSync('ollama list', { timeout: 5000, stdio: 'pipe' });
      return true;
    } catch {}

    return false;
  }

  async _installOllama() {
    const platform = os.platform();

    if (platform === 'win32') {
      return this._installWindows();
    } else if (platform === 'linux' || platform === 'darwin') {
      return this._installUnix();
    } else {
      throw new Error(`Unsupported platform: ${platform}`);
    }
  }

  _installWindows() {
    return new Promise((resolve, reject) => {
      const tmpPath = path.join(os.tmpdir(), 'OllamaSetup.exe');
      this.emit('progress', { step: 'download', message: 'Downloading Ollama installer...' });

      const file = fs.createWriteStream(tmpPath);
      const download = (url) => {
        const mod = url.startsWith('https') ? https : http;
        mod.get(url, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            download(res.headers.location);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`Download failed: HTTP ${res.statusCode}`));
            return;
          }
          const total = parseInt(res.headers['content-length'] || '0', 10);
          let downloaded = 0;
          res.on('data', (chunk) => {
            downloaded += chunk.length;
            if (total > 0) {
              this.emit('progress', { step: 'download', message: `Downloading... ${Math.round(downloaded / total * 100)}%`, pct: downloaded / total });
            }
          });
          res.pipe(file);
          file.on('finish', () => {
            file.close();
            this.emit('progress', { step: 'install', message: 'Running installer...' });
            try {
              execSync(`"${tmpPath}" /VERYSILENT /NORESTART`, { timeout: 120000, stdio: 'pipe' });
              try { fs.unlinkSync(tmpPath); } catch {}
              resolve();
            } catch (e) {
              reject(new Error('Installer failed: ' + e.message));
            }
          });
        }).on('error', reject);
      };
      download('https://ollama.com/download/OllamaSetup.exe');
    });
  }

  _installUnix() {
    return new Promise((resolve, reject) => {
      this.emit('progress', { step: 'install', message: 'Running install script...' });
      try {
        execSync('curl -fsSL https://ollama.com/install.sh | sh', {
          timeout: 120000, stdio: 'pipe', shell: '/bin/bash'
        });
        resolve();
      } catch (e) {
        reject(new Error('Install script failed: ' + e.message));
      }
    });
  }

  async _waitForOllama(timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const resp = await this._httpGet(`${OLLAMA_API}/api/tags`);
        if (resp.status === 200) return;
      } catch {}
      await new Promise(r => setTimeout(r, 2000));
    }
    // Try starting it manually
    try {
      if (os.platform() === 'win32') {
        spawn('ollama', ['serve'], { detached: true, stdio: 'ignore' }).unref();
      } else {
        spawn('ollama', ['serve'], { detached: true, stdio: 'ignore' }).unref();
      }
      await new Promise(r => setTimeout(r, 3000));
      const resp = await this._httpGet(`${OLLAMA_API}/api/tags`);
      if (resp.status === 200) return;
    } catch {}
    throw new Error('Ollama did not start within timeout');
  }

  async _pullModel() {
    // Check if already pulled
    try {
      const resp = await this._httpGet(`${OLLAMA_API}/api/tags`);
      if (resp.status === 200) {
        const data = JSON.parse(resp.body);
        const models = (data.models || []).map(m => m.name);
        if (models.some(m => m === this._model || m === this._model.split(':')[0])) {
          this.emit('progress', { step: 'pull', message: `Model ${this._model} already available` });
          return;
        }
      }
    } catch {}

    // Pull model
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify({ name: this._model, stream: false });
      const req = http.request({
        hostname: 'localhost', port: 11434, path: '/api/pull',
        method: 'POST', timeout: 600000,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
      }, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          if (res.statusCode === 200) resolve();
          else reject(new Error(`Pull failed: ${res.statusCode} ${body}`));
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Pull timeout')); });
      req.write(postData);
      req.end();
    });
  }

  async _verify() {
    try {
      const postData = JSON.stringify({ model: this._model, prompt: 'Hi', stream: false });
      return new Promise((resolve) => {
        const req = http.request({
          hostname: 'localhost', port: 11434, path: '/api/generate',
          method: 'POST', timeout: 60000,
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
        }, (res) => {
          let body = '';
          res.on('data', c => body += c);
          res.on('end', () => resolve(res.statusCode === 200));
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
        req.write(postData);
        req.end();
      });
    } catch { return false; }
  }

  _httpGet(urlStr) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(urlStr);
      const mod = parsed.protocol === 'https:' ? https : http;
      mod.get(urlStr, { timeout: 5000 }, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }).on('error', reject);
    });
  }

  getStatus() {
    return { ollamaReady: this._ollamaReady, modelReady: this._modelReady, model: this._model };
  }
}

module.exports = { SwarmWorkerSetup };
