/**
 * ARIES v5.0 — System Info Monitor (Zero Dependencies)
 * Uses built-in Node.js os module + PowerShell for Windows-specific info.
 */

const os = require('os');
const { execSync } = require('child_process');

let cached = {
  cpu: 0, memUsed: 0, memTotal: 0,
  diskUsed: 0, diskTotal: 0,
  netUp: 0, netDown: 0,
  procs: [], uptime: 0,
  gpu: null,
  netConns: 0,
  docker: null
};

function _ps(cmd, timeout = 5000) {
  try {
    return execSync(`powershell -NoProfile -Command "${cmd}"`, {
      encoding: 'utf8', timeout, windowsHide: true
    }).trim();
  } catch { return ''; }
}

async function refresh() {
  try {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    cached.memTotal = totalMem;
    cached.memUsed = totalMem - freeMem;
    cached.uptime = Math.round(os.uptime());

    // CPU usage estimate
    const cpus = os.cpus();
    let totalIdle = 0, totalTick = 0;
    for (const cpu of cpus) {
      for (const type of Object.keys(cpu.times)) totalTick += cpu.times[type];
      totalIdle += cpu.times.idle;
    }
    cached.cpu = Math.round((1 - totalIdle / totalTick) * 100);

    // Disk info (Windows)
    try {
      const diskOut = execSync('wmic logicaldisk where "DeviceID=\'C:\'" get Size,FreeSpace /format:list', {
        encoding: 'utf8', timeout: 5000, windowsHide: true
      });
      const freeMatch = diskOut.match(/FreeSpace=(\d+)/);
      const sizeMatch = diskOut.match(/Size=(\d+)/);
      if (sizeMatch) {
        cached.diskTotal = parseInt(sizeMatch[1]);
        cached.diskUsed = cached.diskTotal - (freeMatch ? parseInt(freeMatch[1]) : 0);
      }
    } catch {}

    // Top processes
    try {
      const procOut = _ps(
        'Get-Process | Sort-Object CPU -Descending | Select-Object -First 15 Name,Id,@{N=\\"CPU\\";E={[math]::Round($_.CPU,1)}},@{N=\\"MemMB\\";E={[math]::Round($_.WorkingSet64/1MB,1)}} | ConvertTo-Json -Compress'
      );
      if (procOut) {
        let procs = JSON.parse(procOut);
        if (!Array.isArray(procs)) procs = [procs];
        cached.procs = procs.map(p => ({
          name: p.Name, pid: p.Id, cpu: p.CPU || 0, mem: p.MemMB || 0
        }));
      }
    } catch {}

    // GPU (optional)
    try {
      const gpuOut = _ps('(Get-CimInstance Win32_VideoController | Select-Object -First 1).Name');
      if (gpuOut) cached.gpu = { name: gpuOut, temp: 0, utilization: 0, vram: 0 };
    } catch {}

  } catch (e) {
    console.error('[SYSTEM] Refresh error:', e.message);
  }

  return cached;
}

function get() { return cached; }
function getProcs() { return cached.procs; }

// Start polling
let _interval = null;
function startPolling(intervalMs = 5000) {
  if (_interval) return;
  refresh();
  _interval = setInterval(refresh, intervalMs);
}

function stopPolling() {
  if (_interval) { clearInterval(_interval); _interval = null; }
}

module.exports = { refresh, get, getProcs, startPolling, stopPolling, cached };
