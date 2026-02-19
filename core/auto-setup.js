/**
 * ARIES v5.0 — Auto-Setup System
 * 
 * Automatically configures AI for users without API keys.
 * Flow: Check API keys → Check swarm membership → Install Ollama → Detect hardware → Pull best model
 * 
 * Usage: await new AutoSetup().run()
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawn } = require('child_process');
const http = require('http');
const https = require('https');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

class AutoSetup {
  constructor(opts = {}) {
    this.configPath = opts.configPath || CONFIG_PATH;
    this.config = {};
    this.skipInstall = opts.skipInstall || false;
  }

  // ── Entry Point ──
  async run() {
    this._loadConfig();

    // 1. Check if user already has a valid API key
    if (this._hasValidApiKey()) {
      return { status: 'ok', reason: 'api-key-present' };
    }

    console.log('');
    console.log('  🔧 No API key detected — setting up local AI...');

    // 2. Check swarm membership — verified members can use network AI
    const swarmStatus = this._checkSwarmMembership();
    if (swarmStatus.verified) {
      console.log('  🌐 Verified swarm member — configuring network AI access...');
      this._configureSwarmAI(swarmStatus);
      this._saveConfig();
      console.log('  ✅ Ready! Using Aries Network AI via swarm relay.');
      console.log('');
      return { status: 'ok', reason: 'swarm-ai', relay: swarmStatus.relayUrl };
    }

    // 3. Not a swarm member — Ollama is the only option
    if (!swarmStatus.verified) {
      console.log('  ℹ️  Not enrolled in Aries Swarm — using local Ollama.');
    }

    // 4. Check if Ollama is already installed
    const ollamaInstalled = this._isOllamaInstalled();
    if (!ollamaInstalled) {
      console.log('  📦 Installing Ollama...');
      if (!this.skipInstall) {
        await this._installOllama();
      } else {
        console.log('  ⚠️  Skipping install (skipInstall=true). Install Ollama manually: https://ollama.com/download');
        return { status: 'skip', reason: 'skip-install' };
      }
    } else {
      console.log('  ✓ Ollama already installed.');
    }

    // 5. Ensure Ollama is running
    await this._ensureOllamaRunning();

    // 6. Detect hardware
    const specs = this._detectHardware();
    const gpuStr = specs.gpu ? `, ${specs.gpu.name} (${specs.gpu.vramGB}GB VRAM)` : '';
    console.log(`  🔍 Detected: ${specs.ramGB}GB RAM${gpuStr}`);

    // 7. Pick best model
    const model = this._pickModel(specs);
    console.log(`  📥 Pulling ${model} (best fit for your hardware)...`);

    // 8. Pull model
    await this._pullModel(model);

    // 9. Configure aries to use Ollama
    this._configureOllama(model);
    this._saveConfig();

    console.log(`  ✅ Ready! Using local Ollama with ${model}.`);
    console.log('');

    return { status: 'ok', reason: 'ollama', model, specs };
  }

  // ── Config ──
  _loadConfig() {
    try {
      this.config = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
    } catch {
      this.config = {};
    }
  }

  _saveConfig() {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 4));
    } catch (e) {
      console.error('  ⚠️  Could not save config:', e.message);
    }
  }

  // ── API Key Check ──
  _hasValidApiKey() {
    const cfg = this.config;

    // Check ariesGateway providers
    const providers = cfg.ariesGateway?.providers || {};
    for (const [, prov] of Object.entries(providers)) {
      if (prov.apiKey && prov.apiKey.length > 10) return true;
    }

    // Check fallback direct API key
    if (cfg.fallback?.directApi?.key && cfg.fallback.directApi.key.length > 10) return true;

    // Check environment variables
    const envKeys = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_API_KEY', 'MISTRAL_API_KEY'];
    for (const k of envKeys) {
      if (process.env[k] && process.env[k].length > 10) return true;
    }

    return false;
  }

  // ── Swarm Membership Check ──
  _checkSwarmMembership() {
    const cfg = this.config;
    const result = { verified: false, relayUrl: null, authKey: null };

    // Check for worker auth key
    const authKey = cfg.relay?.secret || cfg.swarm?.authKey || cfg.workerAuthKey;
    if (!authKey || authKey.length < 8) return result;

    // Check relay URL
    const relayUrl = cfg.relay?.url;
    if (!relayUrl) return result;

    // Check enrollment status — try to ping relay
    try {
      const url = new URL(`${relayUrl}/api/status`);
      const mod = url.protocol === 'https:' ? https : http;
      // Synchronous check via execSync for simplicity at boot
      const cmd = process.platform === 'win32'
        ? `powershell -Command "(Invoke-WebRequest -Uri '${relayUrl}/api/status' -Headers @{'X-Aries-Secret'='${authKey}'} -TimeoutSec 3 -UseBasicParsing).Content"`
        : `curl -s -m 3 -H 'X-Aries-Secret: ${authKey}' '${relayUrl}/api/status'`;
      
      const output = execSync(cmd, { timeout: 5000, encoding: 'utf8' }).trim();
      const status = JSON.parse(output);
      
      // Verified if relay responds and recognizes us
      if (status && (status.ok || status.status === 'online' || status.workers !== undefined)) {
        result.verified = true;
        result.relayUrl = relayUrl;
        result.authKey = authKey;
        result.workerCount = status.workers || 0;
      }
    } catch {
      // Relay unreachable or auth rejected — not a verified member
    }

    return result;
  }

  _configureSwarmAI(swarmStatus) {
    // Configure gateway to route through relay
    if (!this.config.gateway) this.config.gateway = {};
    this.config.gateway.url = `${swarmStatus.relayUrl}/v1/chat/completions`;
    this.config.gateway.token = swarmStatus.authKey;
    if (!this.config.gateway.model) this.config.gateway.model = 'mistral';

    // Mark as swarm-configured
    if (!this.config.autoSetup) this.config.autoSetup = {};
    this.config.autoSetup.provider = 'swarm';
    this.config.autoSetup.relayUrl = swarmStatus.relayUrl;
    this.config.autoSetup.configuredAt = new Date().toISOString();
  }

  // ── Ollama Detection ──
  _isOllamaInstalled() {
    try {
      execSync('ollama --version', { encoding: 'utf8', timeout: 5000, stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  // ── Ollama Installation ──
  async _installOllama() {
    const platform = os.platform(); // win32, darwin, linux

    if (platform === 'win32') {
      await this._installOllamaWindows();
    } else if (platform === 'darwin') {
      await this._installOllamaMac();
    } else {
      await this._installOllamaLinux();
    }

    // Verify installation
    if (!this._isOllamaInstalled()) {
      console.log('  ⚠️  Ollama install may have failed. Please install manually: https://ollama.com/download');
    }
  }

  async _installOllamaWindows() {
    const installerPath = path.join(os.tmpdir(), 'OllamaSetup.exe');
    const url = 'https://ollama.com/download/OllamaSetup.exe';

    console.log('  ⬇️  Downloading Ollama for Windows...');
    await this._download(url, installerPath);

    console.log('  ⏳ Running installer (this may take a moment)...');
    try {
      // Silent install
      execSync(`"${installerPath}" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART`, {
        timeout: 120000,
        stdio: 'pipe'
      });
    } catch (e) {
      // Try without silent flags
      try {
        execSync(`start /wait "" "${installerPath}"`, {
          timeout: 300000,
          shell: 'cmd.exe',
          stdio: 'pipe'
        });
      } catch {
        console.log('  ⚠️  Auto-install failed. Please run the installer manually:', installerPath);
      }
    }

    // Clean up
    try { fs.unlinkSync(installerPath); } catch {}
  }

  async _installOllamaMac() {
    console.log('  ⬇️  Installing Ollama via curl...');
    try {
      execSync('curl -fsSL https://ollama.com/install.sh | sh', {
        timeout: 120000,
        stdio: 'inherit'
      });
    } catch {
      console.log('  ⚠️  Install failed. Try: brew install ollama');
    }
  }

  async _installOllamaLinux() {
    console.log('  ⬇️  Installing Ollama via install script...');
    try {
      execSync('curl -fsSL https://ollama.com/install.sh | sh', {
        timeout: 120000,
        stdio: 'inherit'
      });
    } catch {
      console.log('  ⚠️  Install failed. See: https://ollama.com/download/linux');
    }
  }

  // ── Ensure Ollama is running ──
  async _ensureOllamaRunning() {
    // Check if Ollama API is responding
    const alive = await this._ollamaAlive();
    if (alive) return;

    console.log('  ⏳ Starting Ollama server...');
    // Start ollama serve in background
    const child = spawn('ollama', ['serve'], {
      detached: true,
      stdio: 'ignore',
      shell: true
    });
    child.unref();

    // Wait up to 10s for it to come alive
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      if (await this._ollamaAlive()) return;
    }
    console.log('  ⚠️  Ollama server may not be running. Continuing anyway...');
  }

  _ollamaAlive() {
    return new Promise(resolve => {
      const req = http.get('http://localhost:11434/api/tags', { timeout: 2000 }, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => resolve(res.statusCode === 200));
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
  }

  // ── Hardware Detection ──
  _detectHardware() {
    const totalMem = os.totalmem();
    const ramGB = Math.round(totalMem / (1024 ** 3));

    const specs = { ramGB, gpu: null };

    // Try to detect NVIDIA GPU
    try {
      const nvOut = execSync('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits', {
        encoding: 'utf8', timeout: 5000, stdio: 'pipe'
      }).trim();
      if (nvOut) {
        const parts = nvOut.split(',').map(s => s.trim());
        specs.gpu = {
          name: parts[0] || 'NVIDIA GPU',
          vramMB: parseInt(parts[1]) || 0,
          vramGB: Math.round((parseInt(parts[1]) || 0) / 1024)
        };
      }
    } catch {
      // No NVIDIA GPU or nvidia-smi not available
    }

    // Try AMD on Linux
    if (!specs.gpu && os.platform() === 'linux') {
      try {
        const amdOut = execSync('rocm-smi --showmeminfo vram --csv', {
          encoding: 'utf8', timeout: 5000, stdio: 'pipe'
        }).trim();
        if (amdOut && amdOut.includes('Total')) {
          specs.gpu = { name: 'AMD GPU', vramMB: 0, vramGB: 0 };
        }
      } catch {}
    }

    return specs;
  }

  // ── Model Selection ──
  _pickModel(specs) {
    const { ramGB, gpu } = specs;
    const vramGB = gpu?.vramGB || 0;

    // Effective memory: use VRAM if GPU is present (models run on GPU)
    // But also consider RAM for CPU-only inference
    const effectiveGB = Math.max(ramGB, vramGB);

    // If strong GPU, prefer larger models
    if (vramGB >= 24) return 'llama3.1:70b-q4';
    if (vramGB >= 16) return 'codellama:34b-q4';
    if (vramGB >= 12) return 'llama3.1:8b';
    if (vramGB >= 8) return 'llama3.1:8b';

    // CPU-only / weak GPU — go by RAM
    if (ramGB >= 32) return 'llama3.1:70b-q4';
    if (ramGB >= 16) return 'llama3.1:8b';
    if (ramGB >= 8) return 'deepseek-coder:6.7b';
    if (ramGB >= 4) return 'llama3.2:3b';
    return 'tinyllama';
  }

  // ── Model Pull ──
  async _pullModel(model) {
    return new Promise((resolve, reject) => {
      const child = spawn('ollama', ['pull', model], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true
      });

      let lastProgress = '';
      const onData = (chunk) => {
        const line = chunk.toString().trim();
        if (line && line !== lastProgress) {
          // Show pull progress (overwrite line)
          process.stdout.write(`\r  📥 ${line.substring(0, 70).padEnd(70)}`);
          lastProgress = line;
        }
      };

      child.stdout.on('data', onData);
      child.stderr.on('data', onData);

      child.on('close', (code) => {
        process.stdout.write('\r' + ' '.repeat(80) + '\r'); // clear progress line
        if (code === 0) {
          console.log(`  ✓ Model ${model} pulled successfully.`);
          resolve();
        } else {
          console.log(`  ⚠️  Model pull exited with code ${code}. You can retry: ollama pull ${model}`);
          resolve(); // Don't reject — allow boot to continue
        }
      });

      child.on('error', (err) => {
        console.log(`  ⚠️  Could not pull model: ${err.message}`);
        resolve();
      });
    });
  }

  // ── Configure Ollama in config.json ──
  _configureOllama(model) {
    // Set up fallback.ollama so ai.js picks it up
    if (!this.config.fallback) this.config.fallback = {};
    this.config.fallback.enabled = true;

    if (!this.config.fallback.ollama) this.config.fallback.ollama = {};
    this.config.fallback.ollama.url = 'http://localhost:11434/api/chat';
    this.config.fallback.ollama.model = model;

    // If no gateway is configured, point gateway at Ollama's OpenAI-compatible endpoint
    if (!this.config.gateway?.url || !this._hasValidApiKey()) {
      if (!this.config.gateway) this.config.gateway = {};
      this.config.gateway.url = 'http://localhost:11434/v1/chat/completions';
      this.config.gateway.model = model;
      this.config.gateway.token = '';
    }

    // Track auto-setup metadata
    if (!this.config.autoSetup) this.config.autoSetup = {};
    this.config.autoSetup.provider = 'ollama';
    this.config.autoSetup.model = model;
    this.config.autoSetup.configuredAt = new Date().toISOString();
  }

  // ── Download Helper ──
  _download(url, dest) {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest);
      const get = (u) => {
        const mod = u.startsWith('https') ? https : http;
        mod.get(u, { timeout: 60000 }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            // Follow redirect
            get(res.headers.location);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`Download failed: HTTP ${res.statusCode}`));
            return;
          }
          const total = parseInt(res.headers['content-length'] || '0');
          let downloaded = 0;
          res.on('data', (chunk) => {
            downloaded += chunk.length;
            if (total > 0) {
              const pct = Math.round((downloaded / total) * 100);
              process.stdout.write(`\r  ⬇️  ${pct}% (${Math.round(downloaded / 1048576)}MB)`);
            }
          });
          res.pipe(file);
          file.on('finish', () => {
            file.close();
            process.stdout.write('\r' + ' '.repeat(50) + '\r');
            resolve();
          });
        }).on('error', reject);
      };
      get(url);
    });
  }
}

module.exports = AutoSetup;
