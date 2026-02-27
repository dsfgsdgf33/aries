'use strict';

const { execSync, exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { EventEmitter } = require('events');

const PLATFORM = os.platform(); // 'win32', 'darwin', 'linux'

let _instance = null;

class DesktopLauncher extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} [opts.appName=Aries]
   * @param {number} [opts.dashboardPort=3000]
   * @param {string} [opts.dashboardUrl]
   * @param {string} [opts.shortcut=Ctrl+Shift+A]
   */
  constructor(opts = {}) {
    super();
    this.appName = opts.appName || 'Aries';
    this.dashboardPort = opts.dashboardPort || 3000;
    this.dashboardUrl = opts.dashboardUrl || `http://localhost:${this.dashboardPort}`;
    this.shortcut = opts.shortcut || 'Ctrl+Shift+A';
    this._trayProc = null;
    this._shortcutProc = null;
    this._running = false;
  }

  // ── Launch ──

  async launch() {
    if (this._running) return;
    this._running = true;

    this._startTray();
    this._registerShortcut();
    this.openDashboard();
    this.emit('launched');
  }

  // ── Dashboard ──

  openDashboard() {
    const url = this.dashboardUrl;
    try {
      if (PLATFORM === 'win32') {
        exec(`start "" "${url}"`);
      } else if (PLATFORM === 'darwin') {
        exec(`open "${url}"`);
      } else {
        exec(`xdg-open "${url}" 2>/dev/null || sensible-browser "${url}" 2>/dev/null`);
      }
    } catch (e) {
      this.emit('error', e);
    }
  }

  // ── System Tray ──

  _startTray() {
    if (PLATFORM === 'win32') {
      this._startTrayWindows();
    } else if (PLATFORM === 'darwin') {
      // macOS: no simple tray without native deps; use a menu bar script
      this._startTrayMac();
    }
    // Linux: would need libappindicator, skip for Phase 1
  }

  _startTrayWindows() {
    const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$icon = [System.Drawing.SystemIcons]::Application
$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = $icon
$tray.Text = "${this.appName}"
$tray.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$openItem = $menu.Items.Add("Open Dashboard")
$openItem.Add_Click({ Start-Process "${this.dashboardUrl}" })
$quitItem = $menu.Items.Add("Quit")
$quitItem.Add_Click({ $tray.Visible = $false; [System.Windows.Forms.Application]::Exit() })
$tray.ContextMenuStrip = $menu

$tray.Add_DoubleClick({ Start-Process "${this.dashboardUrl}" })

[System.Windows.Forms.Application]::Run()
`;
    this._trayProc = spawn('powershell', ['-NoProfile', '-Command', ps], {
      stdio: 'ignore',
      detached: true,
      windowsHide: true,
    });
    this._trayProc.unref();
  }

  _startTrayMac() {
    // Minimal: just a notification on launch. Full menu bar requires Swift/ObjC.
    this._runOsascript(`display notification "Dashboard running at ${this.dashboardUrl}" with title "${this.appName}" subtitle "Agent is active"`);
  }

  // ── Global Keyboard Shortcut ──

  _registerShortcut() {
    if (PLATFORM === 'win32') {
      this._registerShortcutWindows();
    } else if (PLATFORM === 'darwin') {
      this._registerShortcutMac();
    }
  }

  _registerShortcutWindows() {
    // Use PowerShell + RegisterHotKey via P/Invoke
    const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class HotKey {
    [DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
    [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr hWnd, int id);
}
"@

# MOD_CONTROL=0x0002, MOD_SHIFT=0x0004, MOD_ALT=0x0001
# VK_A = 0x41
[HotKey]::RegisterHotKey([IntPtr]::Zero, 1, 0x0006, 0x41)

$msg = New-Object System.Windows.Forms.Message
while ([System.Windows.Forms.Application]::DoEvents() -or $true) {
    $peeked = [System.Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 100
    # Check for hotkey message WM_HOTKEY=0x0312
    try {
        Add-Type -AssemblyName Microsoft.VisualBasic -ErrorAction SilentlyContinue
    } catch {}
    # Simple approach: poll a named pipe or just re-check
    # For Phase 1, use a simple HTTP trigger instead
    break
}

# Fallback: just open dashboard URL
Start-Process "${this.dashboardUrl}"
[HotKey]::UnregisterHotKey([IntPtr]::Zero, 1)
`;
    // Phase 1: The hotkey registration is best-effort; full implementation
    // would require a persistent message pump. For now, register and let it run.
    this._shortcutProc = spawn('powershell', ['-NoProfile', '-Command', ps], {
      stdio: 'ignore',
      detached: true,
      windowsHide: true,
    });
    this._shortcutProc.unref();
  }

  _registerShortcutMac() {
    // macOS global shortcuts need Accessibility permissions + Swift.
    // Phase 1: register via Automator/AppleScript service (best-effort)
    // User can manually set up a shortcut via System Preferences -> Keyboard -> Shortcuts
    this.emit('info', 'macOS global shortcut: set up manually in System Preferences > Keyboard > Shortcuts');
  }

  // ── Desktop Notifications ──

  notify(title, body) {
    try {
      if (PLATFORM === 'win32') {
        this._notifyWindows(title, body);
      } else if (PLATFORM === 'darwin') {
        this._notifyMac(title, body);
      } else {
        this._notifyLinux(title, body);
      }
    } catch (e) {
      this.emit('error', e);
    }
  }

  _notifyWindows(title, body) {
    const ps = `
Add-Type -AssemblyName System.Windows.Forms
$n = New-Object System.Windows.Forms.NotifyIcon
$n.Icon = [System.Drawing.SystemIcons]::Information
$n.Visible = $true
$n.BalloonTipTitle = '${title.replace(/'/g, "''")}'
$n.BalloonTipText = '${body.replace(/'/g, "''")}'
$n.ShowBalloonTip(5000)
Start-Sleep -Seconds 6
$n.Dispose()
`;
    spawn('powershell', ['-NoProfile', '-Command', ps], {
      stdio: 'ignore', detached: true, windowsHide: true,
    }).unref();
  }

  _notifyMac(title, body) {
    this._runOsascript(`display notification "${body.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}"`);
  }

  _notifyLinux(title, body) {
    try {
      execSync(`notify-send "${title}" "${body}"`, { stdio: 'ignore' });
    } catch {
      // notify-send not available
    }
  }

  _runOsascript(script) {
    try {
      execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { stdio: 'ignore' });
    } catch (e) {
      this.emit('error', e);
    }
  }

  // ── Auto-start ──

  setupAutoStart() {
    if (PLATFORM === 'win32') {
      this._autoStartWindows(true);
    } else if (PLATFORM === 'darwin') {
      this._autoStartMac(true);
    } else {
      this._autoStartLinux(true);
    }
  }

  removeAutoStart() {
    if (PLATFORM === 'win32') {
      this._autoStartWindows(false);
    } else if (PLATFORM === 'darwin') {
      this._autoStartMac(false);
    } else {
      this._autoStartLinux(false);
    }
  }

  _autoStartWindows(enable) {
    const nodePath = process.execPath;
    const scriptPath = path.resolve(__dirname, '..', 'index.js');
    const regKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';

    if (enable) {
      execSync(`reg add "${regKey}" /v "${this.appName}" /t REG_SZ /d "\\"${nodePath}\\" \\"${scriptPath}\\"" /f`, { stdio: 'ignore' });
    } else {
      try {
        execSync(`reg delete "${regKey}" /v "${this.appName}" /f`, { stdio: 'ignore' });
      } catch { /* key may not exist */ }
    }
  }

  _autoStartMac(enable) {
    const plistName = `com.aries.agent`;
    const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${plistName}.plist`);

    if (enable) {
      const nodePath = process.execPath;
      const scriptPath = path.resolve(__dirname, '..', 'index.js');
      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${plistName}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${scriptPath}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardOutPath</key>
    <string>/tmp/aries-agent.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/aries-agent-err.log</string>
</dict>
</plist>`;
      fs.mkdirSync(path.dirname(plistPath), { recursive: true });
      fs.writeFileSync(plistPath, plist);
      try { execSync(`launchctl load "${plistPath}"`, { stdio: 'ignore' }); } catch {}
    } else {
      try { execSync(`launchctl unload "${plistPath}"`, { stdio: 'ignore' }); } catch {}
      try { fs.unlinkSync(plistPath); } catch {}
    }
  }

  _autoStartLinux(enable) {
    const desktopFile = path.join(os.homedir(), '.config', 'autostart', `${this.appName.toLowerCase()}.desktop`);
    if (enable) {
      const nodePath = process.execPath;
      const scriptPath = path.resolve(__dirname, '..', 'index.js');
      const content = `[Desktop Entry]
Type=Application
Name=${this.appName}
Exec=${nodePath} ${scriptPath}
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
`;
      fs.mkdirSync(path.dirname(desktopFile), { recursive: true });
      fs.writeFileSync(desktopFile, content);
    } else {
      try { fs.unlinkSync(desktopFile); } catch {}
    }
  }

  // ── Status ──

  isRunning() {
    return this._running;
  }

  async stop() {
    this._running = false;
    if (this._trayProc) { try { this._trayProc.kill(); } catch {} this._trayProc = null; }
    if (this._shortcutProc) { try { this._shortcutProc.kill(); } catch {} this._shortcutProc = null; }
    this.emit('stopped');
  }
}

function getInstance(opts) {
  if (!_instance) _instance = new DesktopLauncher(opts);
  return _instance;
}

module.exports = { DesktopLauncher, getInstance };
