/**
 * ARIES v5.0 — Full Windows System Integration
 * Deep OS control: monitoring, apps, files, clipboard, audio, power, network
 * Uses ONLY Node.js built-in modules + PowerShell for Windows APIs
 */

const { execSync, exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const os = require('os');

const PS_FLAGS = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command';

class SystemIntegration extends EventEmitter {
  constructor(config) {
    super();
    try {
      this._config = config || {};
      this._pollInterval = null;
      this._clipboardInterval = null;
      this._lastClipboard = '';
      this._watchers = {};
      this._screenshotDir = config.screenshotDir || path.join(__dirname, '..', 'data', 'screenshots');
      this._cache = {};
      this._cacheTs = {};
    } catch (e) {}
  }

  // ═══════════════════════════════════════
  // POWERSHELL HELPERS
  // ═══════════════════════════════════════

  _ps(cmd, timeoutMs) {
    try {
      var result = execSync('powershell.exe ' + PS_FLAGS + ' "' + cmd.replace(/"/g, '\\"') + '"', {
        timeout: timeoutMs || 8000,
        maxBuffer: 2 * 1024 * 1024,
        encoding: 'utf8',
        windowsHide: true
      });
      return (result || '').trim();
    } catch (e) {
      return '';
    }
  }

  _psAsync(cmd, timeoutMs) {
    var self = this;
    return new Promise(function(resolve) {
      try {
        exec('powershell.exe ' + PS_FLAGS + ' "' + cmd.replace(/"/g, '\\"') + '"', {
          timeout: timeoutMs || 8000,
          maxBuffer: 2 * 1024 * 1024,
          encoding: 'utf8',
          windowsHide: true
        }, function(err, stdout) {
          resolve((stdout || '').trim());
        });
      } catch (e) {
        resolve('');
      }
    });
  }

  _psJson(cmd, timeoutMs) {
    try {
      var raw = this._ps(cmd + ' | ConvertTo-Json -Compress', timeoutMs);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  _psJsonAsync(cmd, timeoutMs) {
    var self = this;
    return this._psAsync(cmd + ' | ConvertTo-Json -Compress -Depth 3', timeoutMs).then(function(raw) {
      try { return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
    });
  }

  // simple TTL cache
  _cached(key, ttlMs, fn) {
    var now = Date.now();
    if (this._cache[key] && this._cacheTs[key] && (now - this._cacheTs[key]) < ttlMs) {
      return this._cache[key];
    }
    var val = fn();
    this._cache[key] = val;
    this._cacheTs[key] = now;
    return val;
  }

  // ═══════════════════════════════════════
  // SYSTEM MONITORING
  // ═══════════════════════════════════════

  getCpuUsage() {
    try {
      var raw = this._ps('(Get-CimInstance Win32_Processor).LoadPercentage');
      var pct = parseInt(raw);
      return isNaN(pct) ? 0 : pct;
    } catch (e) { return 0; }
  }

  getMemoryUsage() {
    try {
      var data = this._psJson('Get-CimInstance Win32_OperatingSystem | Select-Object FreePhysicalMemory,TotalVisibleMemorySize');
      if (!data) return { usedBytes: 0, totalBytes: os.totalmem(), percent: 0 };
      var freeKB = data.FreePhysicalMemory || 0;
      var totalKB = data.TotalVisibleMemorySize || 0;
      var usedKB = totalKB - freeKB;
      return {
        usedBytes: usedKB * 1024,
        totalBytes: totalKB * 1024,
        freeBytes: freeKB * 1024,
        percent: totalKB > 0 ? Math.round((usedKB / totalKB) * 100) : 0
      };
    } catch (e) {
      return { usedBytes: 0, totalBytes: os.totalmem(), percent: 0 };
    }
  }

  getDiskUsage() {
    try {
      var data = this._psJson('Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Select-Object DeviceID,Size,FreeSpace,VolumeName');
      if (!data) return [];
      var disks = Array.isArray(data) ? data : [data];
      return disks.map(function(d) {
        var total = d.Size || 0;
        var free = d.FreeSpace || 0;
        var used = total - free;
        return {
          drive: d.DeviceID || '?',
          label: d.VolumeName || '',
          totalBytes: total,
          freeBytes: free,
          usedBytes: used,
          percent: total > 0 ? Math.round((used / total) * 100) : 0
        };
      });
    } catch (e) { return []; }
  }

  getGpuInfo() {
    try {
      return this._cached('gpu', 30000, function() {
        var data = this._psJson('Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion,AdapterRAM,Status,CurrentRefreshRate');
        if (!data) return [];
        var gpus = Array.isArray(data) ? data : [data];
        return gpus.map(function(g) {
          return {
            name: g.Name || 'Unknown',
            driver: g.DriverVersion || '',
            vramBytes: g.AdapterRAM || 0,
            vramMB: Math.round((g.AdapterRAM || 0) / 1048576),
            status: g.Status || 'Unknown',
            refreshRate: g.CurrentRefreshRate || 0
          };
        });
      }.bind(this));
    } catch (e) { return []; }
  }

  getNetworkStats() {
    try {
      var data = this._psJson('Get-NetAdapterStatistics | Select-Object Name,ReceivedBytes,SentBytes,ReceivedUnicastPackets,SentUnicastPackets');
      if (!data) return [];
      var adapters = Array.isArray(data) ? data : [data];
      return adapters.map(function(a) {
        return {
          name: a.Name || '',
          receivedBytes: a.ReceivedBytes || 0,
          sentBytes: a.SentBytes || 0,
          receivedPackets: a.ReceivedUnicastPackets || 0,
          sentPackets: a.SentUnicastPackets || 0
        };
      });
    } catch (e) { return []; }
  }

  getBatteryStatus() {
    try {
      var data = this._psJson('Get-CimInstance Win32_Battery | Select-Object EstimatedChargeRemaining,BatteryStatus,EstimatedRunTime');
      if (!data) return { hasBattery: false };
      return {
        hasBattery: true,
        percent: data.EstimatedChargeRemaining || 0,
        status: data.BatteryStatus || 0,
        statusText: [null,'Discharging','AC Power','Fully Charged','Low','Critical','Charging','Charging+High','Charging+Low','Charging+Critical','Undefined'][data.BatteryStatus] || 'Unknown',
        minutesRemaining: data.EstimatedRunTime || 0
      };
    } catch (e) { return { hasBattery: false }; }
  }

  getRunningProcesses(topN) {
    try {
      topN = topN || 20;
      var cmd = 'Get-Process -ErrorAction SilentlyContinue | Sort-Object WorkingSet64 -Descending | Select-Object -First ' + topN + ' -Property Id,ProcessName,CPU,WorkingSet64';
      var raw = this._ps(cmd + ' | ConvertTo-Json -Compress', 10000);
      if (!raw) return [];
      var data;
      try { data = JSON.parse(raw); } catch (e) { return []; }
      var procs = Array.isArray(data) ? data : [data];
      return procs.map(function(p) {
        return {
          pid: p.Id || 0,
          name: p.ProcessName || '',
          cpu: Math.round((p.CPU || 0) * 100) / 100,
          memMB: Math.round((p.WorkingSet64 || 0) / 1048576)
        };
      });
    } catch (e) { return []; }
  }

  getInstalledApps() {
    try {
      return this._cached('apps', 120000, function() {
        var cmd = 'Get-ItemProperty HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*,HKLM:\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\* -ErrorAction SilentlyContinue | Where-Object {$_.DisplayName} | Select-Object DisplayName,DisplayVersion,Publisher,InstallDate | Sort-Object DisplayName';
        var data = this._psJson(cmd, 15000);
        if (!data) return [];
        var apps = Array.isArray(data) ? data : [data];
        return apps.map(function(a) {
          return { name: a.DisplayName || '', version: a.DisplayVersion || '', publisher: a.Publisher || '', installDate: a.InstallDate || '' };
        });
      }.bind(this));
    } catch (e) { return []; }
  }

  getStartupApps() {
    try {
      var data = this._psJson('Get-CimInstance Win32_StartupCommand | Select-Object Name,Command,Location,User');
      if (!data) return [];
      var apps = Array.isArray(data) ? data : [data];
      return apps.map(function(a) {
        return { name: a.Name || '', command: a.Command || '', location: a.Location || '', user: a.User || '' };
      });
    } catch (e) { return []; }
  }

  getFullStats() {
    try {
      var cpu = this.getCpuUsage();
      var mem = this.getMemoryUsage();
      var disks = this.getDiskUsage();
      var gpu = this.getGpuInfo();
      var battery = this.getBatteryStatus();
      return {
        cpu: cpu,
        memory: mem,
        disks: disks,
        gpu: gpu,
        battery: battery,
        hostname: os.hostname(),
        platform: os.platform(),
        arch: os.arch(),
        uptime: os.uptime(),
        nodeVersion: process.version,
        timestamp: Date.now()
      };
    } catch (e) {
      return { cpu: 0, memory: {}, disks: [], gpu: [], battery: {}, timestamp: Date.now() };
    }
  }

  // ═══════════════════════════════════════
  // APPLICATION CONTROL
  // ═══════════════════════════════════════

  launchApp(name, args) {
    try {
      var cmd = 'Start-Process \\"' + (name || '').replace(/"/g, '') + '\\"';
      if (args) cmd += ' -ArgumentList \\"' + (args || '').replace(/"/g, '') + '\\"';
      this._ps(cmd);
      return { success: true, app: name };
    } catch (e) { return { success: false, error: e.message }; }
  }

  closeApp(name) {
    try {
      this._ps('Stop-Process -Name \\"' + (name || '').replace(/"/g, '') + '\\" -Force -ErrorAction SilentlyContinue');
      return { success: true, app: name };
    } catch (e) { return { success: false, error: e.message }; }
  }

  focusWindow(title) {
    try {
      var safe = (title || '').replace(/"/g, '').replace(/\*/g, '');
      this._ps('$p = Get-Process | Where-Object { $_.MainWindowTitle -like \\"*' + safe + '*\\" } | Select-Object -First 1; if ($p -and $p.MainWindowHandle) { (New-Object -ComObject WScript.Shell).AppActivate($p.Id) }');
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  }

  listWindows() {
    try {
      var data = this._psJson('Get-Process | Where-Object {$_.MainWindowTitle -ne \\"\\"} | Select-Object Id,ProcessName,MainWindowTitle');
      if (!data) return [];
      return (Array.isArray(data) ? data : [data]).map(function(w) {
        return { pid: w.Id || 0, process: w.ProcessName || '', title: w.MainWindowTitle || '' };
      });
    } catch (e) { return []; }
  }

  minimizeAll() {
    try { this._ps('(New-Object -ComObject Shell.Application).MinimizeAll()'); return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
  }

  restoreAll() {
    try { this._ps('(New-Object -ComObject Shell.Application).UndoMinimizeAll()'); return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
  }

  getActiveWindow() {
    try {
      // Simple approach: get the process with non-empty MainWindowTitle that has focus
      var windows = this.listWindows();
      return windows.length > 0 ? windows[0] : { title: '', pid: 0, process: '' };
    } catch (e) { return { title: '', pid: 0, process: '' }; }
  }

  takeScreenshot(filename) {
    try {
      if (!fs.existsSync(this._screenshotDir)) fs.mkdirSync(this._screenshotDir, { recursive: true });
      var fname = filename || ('screenshot-' + Date.now() + '.png');
      var outPath = path.join(this._screenshotDir, fname);
      var cmd = [
        'Add-Type -AssemblyName System.Windows.Forms,System.Drawing',
        '$b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds',
        '$bmp=New-Object Drawing.Bitmap($b.Width,$b.Height)',
        '$g=[Drawing.Graphics]::FromImage($bmp)',
        '$g.CopyFromScreen($b.Location,[Drawing.Point]::Empty,$b.Size)',
        '$bmp.Save(\\"' + outPath.replace(/\\/g, '\\\\') + '\\")',
        '$g.Dispose(); $bmp.Dispose()'
      ].join('; ');
      this._ps(cmd, 10000);
      return { success: true, path: outPath, filename: fname };
    } catch (e) { return { success: false, error: e.message }; }
  }

  // ═══════════════════════════════════════
  // FILE SYSTEM
  // ═══════════════════════════════════════

  listFiles(dirPath, recursive) {
    try {
      dirPath = dirPath || 'C:\\';
      if (!fs.existsSync(dirPath)) return { error: 'Path not found' };
      var stat = fs.statSync(dirPath);
      if (!stat.isDirectory()) return { error: 'Not a directory' };
      var entries = fs.readdirSync(dirPath, { withFileTypes: true });
      var results = [];
      for (var i = 0; i < entries.length && i < 500; i++) {
        try {
          var e = entries[i];
          var fullPath = path.join(dirPath, e.name);
          var st = null;
          try { st = fs.statSync(fullPath); } catch (x) {}
          results.push({
            name: e.name,
            isDir: e.isDirectory(),
            size: st ? st.size : 0,
            modified: st ? st.mtime.toISOString() : '',
            path: fullPath
          });
        } catch (x) {}
      }
      return { path: dirPath, entries: results, count: results.length };
    } catch (e) { return { error: e.message }; }
  }

  readFile(filePath, maxBytes) {
    try {
      maxBytes = maxBytes || 1024 * 1024; // 1MB default
      if (!fs.existsSync(filePath)) return { error: 'File not found' };
      var stat = fs.statSync(filePath);
      if (stat.size > maxBytes) {
        var buf = Buffer.alloc(maxBytes);
        var fd = fs.openSync(filePath, 'r');
        fs.readSync(fd, buf, 0, maxBytes, 0);
        fs.closeSync(fd);
        return { content: buf.toString('utf8'), truncated: true, size: stat.size };
      }
      return { content: fs.readFileSync(filePath, 'utf8'), truncated: false, size: stat.size };
    } catch (e) { return { error: e.message }; }
  }

  writeFile(filePath, content) {
    try {
      var dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, content, 'utf8');
      return { success: true, path: filePath, size: Buffer.byteLength(content) };
    } catch (e) { return { success: false, error: e.message }; }
  }

  deleteFile(filePath) {
    try {
      // Move to recycle bin via PowerShell
      this._ps('$sh=New-Object -ComObject Shell.Application; $ns=$sh.Namespace(10); $ns.MoveHere(\\"' + filePath.replace(/\\/g, '\\\\').replace(/"/g, '') + '\\")');
      return { success: true, path: filePath };
    } catch (e) { return { success: false, error: e.message }; }
  }

  searchFiles(query, dirPath) {
    try {
      dirPath = dirPath || 'C:\\Users';
      var cmd = 'Get-ChildItem -Path \\"' + dirPath.replace(/"/g, '') + '\\" -Recurse -Filter \\"*' + (query || '').replace(/"/g, '') + '*\\" -ErrorAction SilentlyContinue | Select-Object -First 50 FullName,Length,LastWriteTime';
      var data = this._psJson(cmd, 15000);
      if (!data) return [];
      return (Array.isArray(data) ? data : [data]).map(function(f) {
        return { path: f.FullName || '', size: f.Length || 0, modified: f.LastWriteTime || '' };
      });
    } catch (e) { return []; }
  }

  watchFolder(dirPath, callback) {
    try {
      if (this._watchers[dirPath]) { this._watchers[dirPath].close(); }
      var watcher = fs.watch(dirPath, { recursive: false }, function(eventType, filename) {
        try { if (callback) callback(eventType, filename, dirPath); } catch (e) {}
      });
      this._watchers[dirPath] = watcher;
      return { success: true, path: dirPath };
    } catch (e) { return { success: false, error: e.message }; }
  }

  unwatchFolder(dirPath) {
    try {
      if (this._watchers[dirPath]) { this._watchers[dirPath].close(); delete this._watchers[dirPath]; }
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  }

  getRecentFiles() {
    try {
      var data = this._psJson('Get-ChildItem ([Environment]::GetFolderPath(\\"Recent\\")) | Select-Object -First 30 Name,LastWriteTime,@{N=\\"Target\\";E={$_.Target}}', 8000);
      if (!data) return [];
      return (Array.isArray(data) ? data : [data]).map(function(f) {
        return { name: f.Name || '', modified: f.LastWriteTime || '', target: (f.Target && f.Target[0]) || '' };
      });
    } catch (e) { return []; }
  }

  getDriveInfo() {
    try {
      return this.getDiskUsage();
    } catch (e) { return []; }
  }

  // ═══════════════════════════════════════
  // CLIPBOARD
  // ═══════════════════════════════════════

  getClipboard() {
    try {
      var text = this._ps('Get-Clipboard -Format Text -ErrorAction SilentlyContinue');
      return { content: text || '' };
    } catch (e) { return { content: '' }; }
  }

  setClipboard(text) {
    try {
      // Write to temp file then set clipboard to avoid escaping issues
      var tmpFile = path.join(os.tmpdir(), 'aries-clip-' + Date.now() + '.txt');
      fs.writeFileSync(tmpFile, text || '', 'utf8');
      this._ps('Get-Content \\"' + tmpFile.replace(/\\/g, '\\\\') + '\\" | Set-Clipboard');
      try { fs.unlinkSync(tmpFile); } catch (x) {}
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  }

  startClipboardWatch() {
    try {
      var self = this;
      this._lastClipboard = (this.getClipboard().content || '').substring(0, 200);
      if (this._clipboardInterval) clearInterval(this._clipboardInterval);
      this._clipboardInterval = setInterval(function() {
        try {
          var current = (self.getClipboard().content || '').substring(0, 200);
          if (current !== self._lastClipboard) {
            self._lastClipboard = current;
            self.emit('clipboard-change', { content: current });
          }
        } catch (e) {}
      }, 2000);
    } catch (e) {}
  }

  stopClipboardWatch() {
    try {
      if (this._clipboardInterval) { clearInterval(this._clipboardInterval); this._clipboardInterval = null; }
    } catch (e) {}
  }

  // ═══════════════════════════════════════
  // AUDIO / DISPLAY
  // ═══════════════════════════════════════

  getVolume() {
    try {
      var cmd = [
        'Add-Type -TypeDefinition @\\"',
        'using System.Runtime.InteropServices;',
        '[Guid(\\"5CDF2C82-841E-4546-9722-0CF74078229A\\"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
        'interface IAudioEndpointVolume { int _0(); int _1(); int _2(); int _3(); int SetMasterVolumeLevelScalar(float fLevel, System.Guid pguidEventContext); int _5(); int GetMasterVolumeLevelScalar(out float pfLevel); int SetMute(bool bMute, System.Guid pguidEventContext); int GetMute(out bool pbMute); }',
        '[Guid(\\"D666063F-1587-4E43-81F1-B948E807363F\\"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
        'interface IMMDevice { int Activate(ref System.Guid iid, int dwClsCtx, System.IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface); }',
        '[Guid(\\"A95664D2-9614-4F35-A746-DE8DB63617E6\\"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
        'interface IMMDeviceEnumerator { int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppEndpoint); }',
        '[ComImport, Guid(\\"BCDE0395-E52F-467C-8E3D-C4579291692E\\")] class MMDeviceEnumeratorComObject { }',
        '\\"@',
        '$de=New-Object MMDeviceEnumeratorComObject; $enum=[IMMDeviceEnumerator]$de; $dev=$null; [void]$enum.GetDefaultAudioEndpoint(0,1,[ref]$dev)',
        '$iid=[Guid]\\"5CDF2C82-841E-4546-9722-0CF74078229A\\"; $obj=$null; [void]$dev.Activate([ref]$iid,1,[IntPtr]::Zero,[ref]$obj); $vol=[IAudioEndpointVolume]$obj',
        '$level=0.0; [void]$vol.GetMasterVolumeLevelScalar([ref]$level); $muted=$false; [void]$vol.GetMute([ref]$muted)',
        '@{level=[math]::Round($level*100);muted=$muted}'
      ].join('; ');
      var data = this._psJson(cmd, 5000);
      // Fallback: simpler approach
      if (!data) return { level: -1, muted: false };
      return { level: data.level || 0, muted: data.muted || false };
    } catch (e) { return { level: -1, muted: false }; }
  }

  setVolume(level) {
    try {
      level = Math.max(0, Math.min(100, parseInt(level) || 50));
      // Use nircmd if available, else PowerShell COM
      var scalar = (level / 100).toFixed(2);
      var cmd = [
        'Add-Type -TypeDefinition @\\"',
        'using System.Runtime.InteropServices;',
        '[Guid(\\"5CDF2C82-841E-4546-9722-0CF74078229A\\"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
        'interface IAudioEndpointVolume { int _0(); int _1(); int _2(); int _3(); int SetMasterVolumeLevelScalar(float fLevel, System.Guid pguidEventContext); int _5(); int GetMasterVolumeLevelScalar(out float pfLevel); int SetMute(bool bMute, System.Guid pguidEventContext); int GetMute(out bool pbMute); }',
        '[Guid(\\"D666063F-1587-4E43-81F1-B948E807363F\\"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
        'interface IMMDevice { int Activate(ref System.Guid iid, int dwClsCtx, System.IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface); }',
        '[Guid(\\"A95664D2-9614-4F35-A746-DE8DB63617E6\\"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
        'interface IMMDeviceEnumerator { int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppEndpoint); }',
        '[ComImport, Guid(\\"BCDE0395-E52F-467C-8E3D-C4579291692E\\")] class MMDeviceEnumeratorComObject { }',
        '\\"@',
        '$de=New-Object MMDeviceEnumeratorComObject; $enum=[IMMDeviceEnumerator]$de; $dev=$null; [void]$enum.GetDefaultAudioEndpoint(0,1,[ref]$dev)',
        '$iid=[Guid]\\"5CDF2C82-841E-4546-9722-0CF74078229A\\"; $obj=$null; [void]$dev.Activate([ref]$iid,1,[IntPtr]::Zero,[ref]$obj); $vol=[IAudioEndpointVolume]$obj',
        '[void]$vol.SetMasterVolumeLevelScalar(' + scalar + ',[Guid]::Empty)'
      ].join('; ');
      this._ps(cmd, 5000);
      return { success: true, level: level };
    } catch (e) { return { success: false, error: e.message }; }
  }

  mute() {
    try {
      // Simple approach: send mute key
      this._ps('$w=New-Object -ComObject WScript.Shell; $w.SendKeys([char]173)');
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  }

  unmute() {
    try {
      return this.mute(); // toggle
    } catch (e) { return { success: false, error: e.message }; }
  }

  setBrightness(level) {
    try {
      level = Math.max(0, Math.min(100, parseInt(level) || 50));
      this._ps('(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1,' + level + ')');
      return { success: true, level: level };
    } catch (e) { return { success: false, error: e.message }; }
  }

  getDisplays() {
    try {
      var data = this._psJson('Get-CimInstance -Namespace root\\wmi -ClassName WmiMonitorBasicDisplayParams -ErrorAction SilentlyContinue | Select-Object InstanceName,MaxHorizontalImageSize,MaxVerticalImageSize,Active');
      if (!data) {
        // Fallback to Win32_DesktopMonitor
        data = this._psJson('Get-CimInstance Win32_DesktopMonitor | Select-Object Name,ScreenWidth,ScreenHeight,DeviceID');
      }
      if (!data) return [];
      return Array.isArray(data) ? data : [data];
    } catch (e) { return []; }
  }

  // ═══════════════════════════════════════
  // NOTIFICATIONS
  // ═══════════════════════════════════════

  sendNotification(title, body, icon) {
    try {
      var cmd = [
        '[void][Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]',
        '[void][Windows.Data.Xml.Dom.XmlDocument,Windows.Data.Xml.Dom,ContentType=WindowsRuntime]',
        '$t=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)',
        '$txt=$t.GetElementsByTagName(\\"text\\")',
        '$txt[0].AppendChild($t.CreateTextNode(\\"' + (title || 'ARIES').replace(/"/g, '') + '\\")) | Out-Null',
        '$txt[1].AppendChild($t.CreateTextNode(\\"' + (body || '').replace(/"/g, '') + '\\")) | Out-Null',
        '$n=[Windows.UI.Notifications.ToastNotification]::new($t)',
        '[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier(\\"ARIES\\").Show($n)'
      ].join('; ');
      this._ps(cmd, 5000);
      return { success: true };
    } catch (e) {
      // Fallback: balloon tip
      return this.sendBalloonTip(title, body);
    }
  }

  sendBalloonTip(title, body) {
    try {
      var cmd = [
        'Add-Type -AssemblyName System.Windows.Forms',
        '$n=New-Object System.Windows.Forms.NotifyIcon',
        '$n.Icon=[System.Drawing.SystemIcons]::Information',
        '$n.Visible=$true',
        '$n.ShowBalloonTip(5000,\\"' + (title || 'ARIES').replace(/"/g, '') + '\\",\\"' + (body || '').replace(/"/g, '') + '\\",[System.Windows.Forms.ToolTipIcon]::Info)',
        'Start-Sleep -Seconds 5; $n.Dispose()'
      ].join('; ');
      // Run async so it doesn't block
      exec('powershell.exe ' + PS_FLAGS + ' "' + cmd.replace(/"/g, '\\"') + '"', { windowsHide: true, timeout: 10000 });
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  }

  // ═══════════════════════════════════════
  // STARTUP / SERVICES
  // ═══════════════════════════════════════

  addToStartup(name, command) {
    try {
      var regPath = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
      this._ps('Set-ItemProperty -Path \\"' + regPath + '\\" -Name \\"' + (name || '').replace(/"/g, '') + '\\" -Value \\"' + (command || '').replace(/"/g, '') + '\\"');
      return { success: true, name: name };
    } catch (e) { return { success: false, error: e.message }; }
  }

  removeFromStartup(name) {
    try {
      var regPath = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
      this._ps('Remove-ItemProperty -Path \\"' + regPath + '\\" -Name \\"' + (name || '').replace(/"/g, '') + '\\" -ErrorAction SilentlyContinue');
      return { success: true, name: name };
    } catch (e) { return { success: false, error: e.message }; }
  }

  listServices(filter) {
    try {
      var cmd = 'Get-Service';
      if (filter) cmd += ' | Where-Object {$_.DisplayName -like \\"*' + (filter || '').replace(/"/g, '') + '*\\"}';
      cmd += ' | Select-Object -First 100 Name,DisplayName,Status,StartType';
      var data = this._psJson(cmd);
      if (!data) return [];
      return (Array.isArray(data) ? data : [data]).map(function(s) {
        return { name: s.Name || '', displayName: s.DisplayName || '', status: s.Status === 4 ? 'Running' : s.Status === 1 ? 'Stopped' : String(s.Status || ''), startType: s.StartType || '' };
      });
    } catch (e) { return []; }
  }

  startService(name) {
    try { this._ps('Start-Service -Name \\"' + (name || '').replace(/"/g, '') + '\\"'); return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
  }

  stopService(name) {
    try { this._ps('Stop-Service -Name \\"' + (name || '').replace(/"/g, '') + '\\" -Force'); return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
  }

  restartService(name) {
    try { this._ps('Restart-Service -Name \\"' + (name || '').replace(/"/g, '') + '\\" -Force'); return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
  }

  // ═══════════════════════════════════════
  // POWER MANAGEMENT
  // ═══════════════════════════════════════

  shutdown(delaySec) {
    try {
      delaySec = parseInt(delaySec) || 0;
      execSync('shutdown /s /t ' + delaySec, { windowsHide: true });
      return { success: true, action: 'shutdown', delay: delaySec };
    } catch (e) { return { success: false, error: e.message }; }
  }

  restart(delaySec) {
    try {
      delaySec = parseInt(delaySec) || 0;
      execSync('shutdown /r /t ' + delaySec, { windowsHide: true });
      return { success: true, action: 'restart', delay: delaySec };
    } catch (e) { return { success: false, error: e.message }; }
  }

  sleep() {
    try {
      execSync('rundll32.exe powrprof.dll,SetSuspendState 0,1,0', { windowsHide: true });
      return { success: true, action: 'sleep' };
    } catch (e) { return { success: false, error: e.message }; }
  }

  lock() {
    try {
      execSync('rundll32.exe user32.dll,LockWorkStation', { windowsHide: true });
      return { success: true, action: 'lock' };
    } catch (e) { return { success: false, error: e.message }; }
  }

  cancelShutdown() {
    try {
      execSync('shutdown /a', { windowsHide: true });
      return { success: true, action: 'cancelled' };
    } catch (e) { return { success: false, error: e.message }; }
  }

  // ═══════════════════════════════════════
  // NETWORK
  // ═══════════════════════════════════════

  getWifiNetworks() {
    try {
      var raw = this._ps('netsh wlan show networks mode=bssid');
      var networks = [];
      var current = null;
      var lines = raw.split('\n');
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (line.startsWith('SSID') && line.indexOf('BSSID') === -1) {
          if (current) networks.push(current);
          current = { ssid: line.split(':').slice(1).join(':').trim() };
        } else if (current && line.startsWith('Signal')) {
          current.signal = line.split(':')[1] ? line.split(':')[1].trim() : '';
        } else if (current && line.startsWith('Authentication')) {
          current.auth = line.split(':')[1] ? line.split(':')[1].trim() : '';
        }
      }
      if (current) networks.push(current);
      return networks;
    } catch (e) { return []; }
  }

  connectWifi(ssid, password) {
    try {
      if (password) {
        // Create a temp profile XML
        var profile = '<?xml version="1.0"?><WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1"><name>' + ssid + '</name><SSIDConfig><SSID><name>' + ssid + '</name></SSID></SSIDConfig><connectionType>ESS</connectionType><connectionMode>auto</connectionMode><MSM><security><authEncryption><authentication>WPA2PSK</authentication><encryption>AES</encryption><useOneX>false</useOneX></authEncryption><sharedKey><keyType>passPhrase</keyType><protected>false</protected><keyMaterial>' + password + '</keyMaterial></sharedKey></security></MSM></WLANProfile>';
        var tmpFile = path.join(os.tmpdir(), 'wifi-' + Date.now() + '.xml');
        fs.writeFileSync(tmpFile, profile);
        execSync('netsh wlan add profile filename="' + tmpFile + '"', { windowsHide: true });
        try { fs.unlinkSync(tmpFile); } catch (x) {}
      }
      execSync('netsh wlan connect name="' + ssid + '"', { windowsHide: true });
      return { success: true, ssid: ssid };
    } catch (e) { return { success: false, error: e.message }; }
  }

  getIPAddress() {
    try {
      var interfaces = os.networkInterfaces();
      var ips = [];
      var keys = Object.keys(interfaces);
      for (var i = 0; i < keys.length; i++) {
        var iface = interfaces[keys[i]];
        for (var j = 0; j < iface.length; j++) {
          if (!iface[j].internal) {
            ips.push({ interface: keys[i], address: iface[j].address, family: iface[j].family, mac: iface[j].mac });
          }
        }
      }
      return ips;
    } catch (e) { return []; }
  }

  pingHost(host) {
    try {
      var raw = this._ps('Test-Connection -ComputerName \\"' + (host || '').replace(/"/g, '') + '\\" -Count 3 -ErrorAction SilentlyContinue | Select-Object Address,ResponseTime,StatusCode | ConvertTo-Json -Compress', 15000);
      try { return JSON.parse(raw); } catch (x) { return { error: 'Ping failed or timed out' }; }
    } catch (e) { return { error: e.message }; }
  }

  getOpenPorts() {
    try {
      var data = this._psJson('Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Select-Object -First 50 LocalAddress,LocalPort,OwningProcess,@{N=\\"Process\\";E={(Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName}}', 10000);
      if (!data) return [];
      return Array.isArray(data) ? data : [data];
    } catch (e) { return []; }
  }

  flushDNS() {
    try {
      execSync('ipconfig /flushdns', { windowsHide: true });
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  }

  // ═══════════════════════════════════════
  // POLLING / LIFECYCLE
  // ═══════════════════════════════════════

  startPolling(intervalMs) {
    try {
      var self = this;
      intervalMs = intervalMs || 5000;
      if (this._pollInterval) clearInterval(this._pollInterval);
      // Use async polling to avoid blocking the event loop
      this._pollInterval = setInterval(function() {
        self._getStatsAsync().then(function(stats) {
          self.emit('stats', stats);
        }).catch(function() {});
      }, intervalMs);
    } catch (e) {}
  }

  _getStatsAsync() {
    var self = this;
    return Promise.all([
      self._psAsync('(Get-CimInstance Win32_Processor).LoadPercentage', 5000),
      self._psJsonAsync('Get-CimInstance Win32_OperatingSystem | Select-Object FreePhysicalMemory,TotalVisibleMemorySize', 5000)
    ]).then(function(results) {
      var cpuRaw = results[0];
      var memData = results[1];
      var cpu = parseInt(cpuRaw);
      if (isNaN(cpu)) cpu = 0;
      var mem = {};
      if (memData) {
        var freeKB = memData.FreePhysicalMemory || 0;
        var totalKB = memData.TotalVisibleMemorySize || 0;
        var usedKB = totalKB - freeKB;
        mem = {
          usedBytes: usedKB * 1024,
          totalBytes: totalKB * 1024,
          freeBytes: freeKB * 1024,
          percent: totalKB > 0 ? Math.round((usedKB / totalKB) * 100) : 0
        };
      }
      return { cpu: cpu, memory: mem, timestamp: Date.now() };
    });
  }

  stopPolling() {
    try {
      if (this._pollInterval) { clearInterval(this._pollInterval); this._pollInterval = null; }
    } catch (e) {}
  }

  stop() {
    try {
      this.stopPolling();
      this.stopClipboardWatch();
      var keys = Object.keys(this._watchers);
      for (var i = 0; i < keys.length; i++) {
        try { this._watchers[keys[i]].close(); } catch (e) {}
      }
      this._watchers = {};
    } catch (e) {}
  }
}

module.exports = { SystemIntegration };
