/**
 * ARIES v5.0 — Computer Control Module
 * Full system control via PowerShell (no npm packages)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const EventEmitter = require('events');

class ComputerControl extends EventEmitter {
  constructor(config = {}) {
    super();
    this.enabled = config.enabled !== false;
    this.allowDestructive = config.allowDestructive || false;
    this.logFile = path.join(__dirname, '..', 'data', 'computer-log.json');
    this.history = [];
    this._loadHistory();
  }

  _loadHistory() {
    try { this.history = JSON.parse(fs.readFileSync(this.logFile, 'utf8')); } catch { this.history = []; }
  }

  _saveHistory() {
    try {
      const dir = path.dirname(this.logFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.logFile, JSON.stringify(this.history.slice(-500), null, 2));
    } catch {}
  }

  _log(action, params, result) {
    const entry = { action, params, result, timestamp: new Date().toISOString() };
    this.history.push(entry);
    this._saveHistory();
    this.emit('action', entry);
    return entry;
  }

  _ps(script, timeout = 15000) {
    try {
      return execSync(`powershell -NoProfile -Command "${script.replace(/"/g, '\\"')}"`, {
        encoding: 'utf8', timeout, windowsHide: true
      }).trim();
    } catch (e) {
      return e.stdout ? e.stdout.trim() : e.message;
    }
  }

  /** Execute shell command */
  runCommand(cmd) {
    try {
      const out = execSync(cmd, { encoding: 'utf8', timeout: 30000, windowsHide: true });
      return this._log('runCommand', { cmd }, { success: true, output: out.trim() });
    } catch (e) {
      return this._log('runCommand', { cmd }, { success: false, error: e.message, output: (e.stdout || '').trim() });
    }
  }

  /** List processes */
  listProcesses() {
    try {
      const out = this._ps("Get-Process | Sort-Object -Property CPU -Descending | Select-Object -First 30 -Property Id, ProcessName, CPU, @{N='MemMB';E={[math]::Round($_.WorkingSet64/1MB,1)}} | ConvertTo-Json");
      let procs = [];
      try { procs = JSON.parse(out); if (!Array.isArray(procs)) procs = [procs]; } catch {}
      return this._log('listProcesses', {}, { success: true, processes: procs });
    } catch (e) {
      return this._log('listProcesses', {}, { success: false, error: e.message });
    }
  }

  /** Kill process by name */
  killProcess(name) {
    try {
      const out = this._ps("Stop-Process -Name '" + name.replace(/'/g, "''") + "' -Force -ErrorAction Stop; Write-Output 'OK'");
      return this._log('killProcess', { name }, { success: out.includes('OK') });
    } catch (e) {
      return this._log('killProcess', { name }, { success: false, error: e.message });
    }
  }

  /** Get clipboard */
  getClipboard() {
    try {
      const out = this._ps("Get-Clipboard");
      return this._log('getClipboard', {}, { success: true, content: out });
    } catch (e) {
      return this._log('getClipboard', {}, { success: false, error: e.message });
    }
  }

  /** Set clipboard */
  setClipboard(text) {
    try {
      this._ps("Set-Clipboard -Value '" + text.replace(/'/g, "''") + "'");
      return this._log('setClipboard', { text: text.substring(0, 100) }, { success: true });
    } catch (e) {
      return this._log('setClipboard', {}, { success: false, error: e.message });
    }
  }

  /** Lock screen */
  lockScreen() {
    if (!this.allowDestructive) {
      return this._log('lockScreen', {}, { success: false, error: 'Destructive actions disabled' });
    }
    try {
      execSync('rundll32.exe user32.dll,LockWorkStation', { windowsHide: true });
      return this._log('lockScreen', {}, { success: true });
    } catch (e) {
      return this._log('lockScreen', {}, { success: false, error: e.message });
    }
  }

  /** Get system info */
  getSystemInfo() {
    try {
      const info = {
        hostname: os.hostname(),
        platform: os.platform(),
        arch: os.arch(),
        release: os.release(),
        uptime: os.uptime(),
        cpus: os.cpus().length,
        cpuModel: os.cpus()[0]?.model || 'Unknown',
        totalMem: Math.round(os.totalmem() / 1073741824 * 10) / 10 + ' GB',
        freeMem: Math.round(os.freemem() / 1073741824 * 10) / 10 + ' GB',
        homeDir: os.homedir(),
        tmpDir: os.tmpdir(),
        networkInterfaces: Object.keys(os.networkInterfaces()),
      };
      // Get extra from PowerShell
      try {
        const extra = this._ps("$os = Get-CimInstance Win32_OperatingSystem; Write-Output ('{0}|{1}|{2}' -f $os.Caption, $os.LastBootUpTime, $os.TotalVisibleMemorySize)");
        const parts = extra.split('|');
        if (parts.length >= 3) {
          info.osName = parts[0];
          info.lastBoot = parts[1];
        }
      } catch {}
      return this._log('getSystemInfo', {}, { success: true, info });
    } catch (e) {
      return this._log('getSystemInfo', {}, { success: false, error: e.message });
    }
  }

  /** Open application */
  openApp(appName) {
    try {
      execSync(`start "" "${appName}"`, { shell: true, windowsHide: true });
      return this._log('openApp', { appName }, { success: true });
    } catch (e) {
      return this._log('openApp', { appName }, { success: false, error: e.message });
    }
  }

  /** Close application */
  closeApp(appName) {
    try {
      const out = this._ps("Stop-Process -Name '" + appName.replace(/'/g, "''") + "' -Force -ErrorAction Stop; Write-Output 'OK'");
      return this._log('closeApp', { appName }, { success: out.includes('OK') });
    } catch (e) {
      return this._log('closeApp', { appName }, { success: false, error: e.message });
    }
  }

  /** Set system volume */
  setVolume(level) {
    const vol = Math.max(0, Math.min(100, parseInt(level) || 50));
    const ps = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class Audio {
    [DllImport("user32.dll")] public static extern IntPtr SendMessageW(IntPtr hWnd, int Msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
}
'@
$WM_APPCOMMAND = 0x319
$APPCOMMAND_VOLUME_MUTE = 0x80000
$APPCOMMAND_VOLUME_UP = 0xA0000
$APPCOMMAND_VOLUME_DOWN = 0x90000
# Use nircmd-style approach via PowerShell
$obj = New-Object -ComObject WScript.Shell
`;
    try {
      // Simpler approach using PowerShell audio
      this._ps("$obj = New-Object -ComObject WScript.Shell; " + Array(50).fill("$obj.SendKeys([char]174)").join("; ") + "; " + Array(Math.round(vol / 2)).fill("$obj.SendKeys([char]175)").join("; "));
      return this._log('setVolume', { level: vol }, { success: true });
    } catch (e) {
      return this._log('setVolume', { level: vol }, { success: false, error: e.message });
    }
  }

  /** Get battery status */
  getBatteryStatus() {
    try {
      const out = this._ps("Get-CimInstance Win32_Battery | Select-Object EstimatedChargeRemaining, BatteryStatus, EstimatedRunTime | ConvertTo-Json");
      let battery = null;
      try { battery = JSON.parse(out); } catch {}
      return this._log('getBatteryStatus', {}, { success: true, battery: battery || { message: 'No battery detected (desktop)' } });
    } catch (e) {
      return this._log('getBatteryStatus', {}, { success: false, error: e.message });
    }
  }

  /** Get network info */
  getNetworkInfo() {
    try {
      const out = this._ps("Get-NetAdapter | Where-Object Status -eq 'Up' | Select-Object Name, InterfaceDescription, MacAddress, LinkSpeed, Status | ConvertTo-Json");
      let adapters = [];
      try { adapters = JSON.parse(out); if (!Array.isArray(adapters)) adapters = [adapters]; } catch {}
      return this._log('getNetworkInfo', {}, { success: true, adapters });
    } catch (e) {
      return this._log('getNetworkInfo', {}, { success: false, error: e.message });
    }
  }

  /** List services */
  listServices() {
    try {
      const out = this._ps("Get-Service | Where-Object Status -eq 'Running' | Select-Object -First 50 -Property Name, DisplayName, Status | ConvertTo-Json");
      let services = [];
      try { services = JSON.parse(out); if (!Array.isArray(services)) services = [services]; } catch {}
      return this._log('listServices', {}, { success: true, services });
    } catch (e) {
      return this._log('listServices', {}, { success: false, error: e.message });
    }
  }

  /** Get action history */
  getHistory(limit = 50) {
    return this.history.slice(-limit);
  }

  /** Cleanup */
  cleanup() {
    this._saveHistory();
  }
}

module.exports = { ComputerControl };
