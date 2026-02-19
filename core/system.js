/**
 * ARIES v3.0 — System Info Monitor
 * 
 * Enhanced: GPU info, network connections count,
 * Docker container status.
 */

const si = require('systeminformation');

let cached = {
  cpu: 0, memUsed: 0, memTotal: 0,
  diskUsed: 0, diskTotal: 0,
  netUp: 0, netDown: 0,
  procs: [], uptime: 0,
  gpu: null,         // { name, temp, utilization, vram }
  netConns: 0,       // Active network connections
  docker: null       // [{ name, state }] or null
};

async function refresh() {
  try {
    const [cpuLoad, mem, disk, net, procs, time] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
      si.networkStats(),
      si.processes(),
      si.time()
    ]);

    cached.cpu = Math.round(cpuLoad.currentLoad || 0);
    cached.memUsed = mem.used;
    cached.memTotal = mem.total;

    if (disk && disk.length > 0) {
      cached.diskUsed = disk[0].used;
      cached.diskTotal = disk[0].size;
    }

    if (net && net.length > 0) {
      cached.netUp = net[0].tx_sec || 0;
      cached.netDown = net[0].rx_sec || 0;
    }

    cached.procs = (procs.list || [])
      .sort((a, b) => (b.cpu || 0) - (a.cpu || 0))
      .slice(0, 8)
      .map(p => ({
        name: p.name,
        cpu: Math.round(p.cpu || 0),
        mem: p.mem || 0,
        memRss: p.memRss || 0
      }));

    cached.uptime = time.uptime || 0;

    // Slow checks (GPU, net conns, docker) only every ~30 seconds
    _slowRefreshCounter++;
    if (_slowRefreshCounter >= 10) {
      _slowRefreshCounter = 0;
      refreshGpu().catch(() => {});
      refreshNetConns().catch(() => {});
      refreshDocker().catch(() => {});
    }

  } catch (e) {
    // Keep cached values on error
  }
  return cached;
}

// Use child_process.exec (async) to avoid blocking the event loop
const { exec } = require('child_process');

function execAsync(cmd, opts = {}) {
  return new Promise((resolve) => {
    exec(cmd, { encoding: 'utf8', timeout: 5000, windowsHide: true, ...opts }, (err, stdout) => {
      resolve(err ? '' : (stdout || '').trim());
    });
  });
}

let _slowRefreshCounter = 0;

async function refreshGpu() {
  try {
    const output = await execAsync('nvidia-smi --query-gpu=name,temperature.gpu,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits');
    if (output) {
      const parts = output.split(',').map(s => s.trim());
      cached.gpu = {
        name: parts[0] || 'GPU',
        temp: parseInt(parts[1]) || 0,
        utilization: parseInt(parts[2]) || 0,
        vramUsed: parseInt(parts[3]) || 0,
        vramTotal: parseInt(parts[4]) || 0
      };
    }
  } catch {
    cached.gpu = null;
  }
}

async function refreshNetConns() {
  try {
    const output = await execAsync('powershell.exe -NoProfile -WindowStyle Hidden -Command "(Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue).Count"');
    cached.netConns = parseInt(output) || 0;
  } catch {
    cached.netConns = 0;
  }
}

async function refreshDocker() {
  try {
    const output = await execAsync('docker ps --format "{{.Names}}|{{.State}}" 2>nul');
    if (output) {
      cached.docker = output.split('\n').filter(Boolean).map(line => {
        const [name, state] = line.split('|');
        return { name: name || '?', state: state || 'unknown' };
      });
    } else {
      cached.docker = [];
    }
  } catch {
    cached.docker = null;
  }
}

function get() { return cached; }

function formatBytes(b) {
  if (b >= 1073741824) return (b / 1073741824).toFixed(1) + 'GB';
  if (b >= 1048576) return (b / 1048576).toFixed(1) + 'MB';
  if (b >= 1024) return (b / 1024).toFixed(1) + 'KB';
  return b + 'B';
}

function formatUptime(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 24) return Math.floor(h / 24) + 'd';
  if (h > 0) return h + 'h' + (m > 0 ? m + 'm' : '');
  return m + 'm';
}

module.exports = { refresh, get, formatBytes, formatUptime };
