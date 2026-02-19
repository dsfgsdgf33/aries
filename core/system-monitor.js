/**
 * ARIES v5.0 — Deep System Monitor
 * CPU, RAM, disk, GPU, processes, connections, startup, software
 */
const os = require('os');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

class SystemMonitor {
  constructor() { this.refs = null; this._cache = {}; this._cacheTime = {}; }
  start(refs) { this.refs = refs; }

  _cached(key, ttlMs, fn) {
    if (this._cache[key] && Date.now() - this._cacheTime[key] < ttlMs) return Promise.resolve(this._cache[key]);
    return fn().then(r => { this._cache[key] = r; this._cacheTime[key] = Date.now(); return r; });
  }

  getStats() {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const uptime = os.uptime();
    const loadavg = os.loadavg();
    return {
      hostname: os.hostname(), platform: os.platform(), arch: os.arch(), release: os.release(),
      cpuModel: cpus[0]?.model, cpuCores: cpus.length,
      cpuUsage: loadavg[0],
      memTotal: Math.round(totalMem / 1024 / 1024),
      memFree: Math.round(freeMem / 1024 / 1024),
      memUsed: Math.round((totalMem - freeMem) / 1024 / 1024),
      memPct: Math.round(((totalMem - freeMem) / totalMem) * 100),
      uptime, loadavg
    };
  }

  getProcesses() {
    return this._cached('procs', 3000, () => new Promise((resolve) => {
      exec('powershell -NoProfile -Command "Get-Process | Sort-Object -Property WS -Descending | Select-Object -First 50 Id,ProcessName,@{N=\'CPU\';E={[math]::Round($_.CPU,1)}},@{N=\'MemMB\';E={[math]::Round($_.WS/1MB,1)}} | ConvertTo-Json"', { timeout: 10000 }, (err, stdout) => {
        if (err) return resolve([]);
        try { resolve(JSON.parse(stdout)); } catch { resolve([]); }
      });
    }));
  }

  getConnections() {
    return this._cached('conns', 5000, () => new Promise((resolve) => {
      exec('powershell -NoProfile -Command "Get-NetTCPConnection -State Established,Listen | Select-Object -First 100 LocalAddress,LocalPort,RemoteAddress,RemotePort,State,OwningProcess | ConvertTo-Json"', { timeout: 10000 }, (err, stdout) => {
        if (err) return resolve([]);
        try { resolve(JSON.parse(stdout)); } catch { resolve([]); }
      });
    }));
  }

  getStartup() {
    return this._cached('startup', 30000, () => new Promise((resolve) => {
      exec('powershell -NoProfile -Command "Get-CimInstance Win32_StartupCommand | Select-Object Name,Command,Location | ConvertTo-Json"', { timeout: 10000 }, (err, stdout) => {
        if (err) return resolve([]);
        try { const r = JSON.parse(stdout); resolve(Array.isArray(r) ? r : [r]); } catch { resolve([]); }
      });
    }));
  }

  getSoftware() {
    return this._cached('software', 60000, () => new Promise((resolve) => {
      exec('powershell -NoProfile -Command "Get-ItemProperty HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\* | Select-Object DisplayName,DisplayVersion,Publisher,InstallDate | Where-Object {$_.DisplayName} | Sort-Object DisplayName | ConvertTo-Json"', { timeout: 15000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
        if (err) return resolve([]);
        try { resolve(JSON.parse(stdout)); } catch { resolve([]); }
      });
    }));
  }

  getGPU() {
    return this._cached('gpu', 10000, () => new Promise((resolve) => {
      exec('powershell -NoProfile -Command "Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion,VideoProcessor,Status | ConvertTo-Json"', { timeout: 10000 }, (err, stdout) => {
        if (err) return resolve({});
        try { const r = JSON.parse(stdout); resolve(Array.isArray(r) ? r : [r]); } catch { resolve([]); }
      });
    }));
  }

  getDisk() {
    return this._cached('disk', 10000, () => new Promise((resolve) => {
      exec('powershell -NoProfile -Command "Get-CimInstance Win32_LogicalDisk | Where-Object {$_.DriveType -eq 3} | Select-Object DeviceID,@{N=\'SizeGB\';E={[math]::Round($_.Size/1GB,1)}},@{N=\'FreeGB\';E={[math]::Round($_.FreeSpace/1GB,1)}} | ConvertTo-Json"', { timeout: 10000 }, (err, stdout) => {
        if (err) return resolve([]);
        try { const r = JSON.parse(stdout); resolve(Array.isArray(r) ? r : [r]); } catch { resolve([]); }
      });
    }));
  }

  registerRoutes(addRoute) {
    addRoute('GET', '/api/system/stats', async (req, res, json) => {
      const stats = this.getStats();
      const disk = await this.getDisk();
      json(res, 200, { ok: true, ...stats, disks: disk });
    });
    addRoute('GET', '/api/system/processes', async (req, res, json) => {
      json(res, 200, { ok: true, processes: await this.getProcesses() });
    });
    addRoute('GET', '/api/system/connections', async (req, res, json) => {
      json(res, 200, { ok: true, connections: await this.getConnections() });
    });
    addRoute('GET', '/api/system/startup', async (req, res, json) => {
      json(res, 200, { ok: true, startup: await this.getStartup() });
    });
    addRoute('GET', '/api/system/software', async (req, res, json) => {
      json(res, 200, { ok: true, software: await this.getSoftware() });
    });
    addRoute('GET', '/api/system/gpu', async (req, res, json) => {
      json(res, 200, { ok: true, gpu: await this.getGPU() });
    });
  }
}

module.exports = { SystemMonitor };
