/**
 * ARIES v5.0 — Browser Control Module
 * PowerShell-based browser automation (no npm packages)
 */

const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

class BrowserControl extends EventEmitter {
  constructor(config = {}) {
    super();
    this.enabled = config.enabled !== false;
    this.logFile = path.join(__dirname, '..', 'data', 'browser-log.json');
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

  _ps(script) {
    try {
      const out = execSync(`powershell -NoProfile -Command "${script.replace(/"/g, '\\"')}"`, {
        encoding: 'utf8', timeout: 15000, windowsHide: true
      });
      return out.trim();
    } catch (e) {
      return e.stdout ? e.stdout.trim() : e.message;
    }
  }

  /** Open URL in default browser */
  openUrl(url) {
    try {
      execSync(`start "" "${url}"`, { shell: true, windowsHide: true });
      return this._log('openUrl', { url }, { success: true });
    } catch (e) {
      return this._log('openUrl', { url }, { success: false, error: e.message });
    }
  }

  /** Take screenshot using PowerShell */
  screenshot(outputPath) {
    if (!outputPath) outputPath = path.join(__dirname, '..', 'data', 'screenshot-' + Date.now() + '.png');
    const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bmp)
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bmp.Save('${outputPath.replace(/\\/g, '\\\\')}')
$graphics.Dispose()
$bmp.Dispose()
Write-Output 'OK'
`;
    try {
      const result = this._ps(ps);
      return this._log('screenshot', { outputPath }, { success: result.includes('OK'), path: outputPath });
    } catch (e) {
      return this._log('screenshot', { outputPath }, { success: false, error: e.message });
    }
  }

  /** Send keystrokes via PowerShell */
  sendKeys(keys) {
    const ps = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${keys.replace(/'/g, "''")}')`;
    try {
      this._ps(ps);
      return this._log('sendKeys', { keys }, { success: true });
    } catch (e) {
      return this._log('sendKeys', { keys }, { success: false, error: e.message });
    }
  }

  /** Click at coordinates */
  mouseClick(x, y) {
    const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class Mouse {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint cButtons, uint dwExtraInfo);
    public static void Click(int x, int y) { SetCursorPos(x, y); mouse_event(0x0002, 0, 0, 0, 0); mouse_event(0x0004, 0, 0, 0, 0); }
}
'@
[Mouse]::Click(${x}, ${y})
Write-Output 'OK'
`;
    try {
      this._ps(ps);
      return this._log('mouseClick', { x, y }, { success: true });
    } catch (e) {
      return this._log('mouseClick', { x, y }, { success: false, error: e.message });
    }
  }

  /** Get active window title */
  getActiveWindow() {
    const ps = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Win {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    public static string GetTitle() { var sb = new StringBuilder(256); GetWindowText(GetForegroundWindow(), sb, 256); return sb.ToString(); }
}
'@
Write-Output ([Win]::GetTitle())
`;
    try {
      const title = this._ps(ps);
      return this._log('getActiveWindow', {}, { success: true, title });
    } catch (e) {
      return this._log('getActiveWindow', {}, { success: false, error: e.message });
    }
  }

  /** List all windows */
  listWindows() {
    const ps = "Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object -Property Id, MainWindowTitle | ConvertTo-Json";
    try {
      const out = this._ps(ps);
      let windows = [];
      try { windows = JSON.parse(out); if (!Array.isArray(windows)) windows = [windows]; } catch {}
      return this._log('listWindows', {}, { success: true, windows });
    } catch (e) {
      return this._log('listWindows', {}, { success: false, error: e.message });
    }
  }

  /** Focus window by title */
  focusWindow(title) {
    const ps = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class WinFocus {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
'@
$proc = Get-Process | Where-Object { $_.MainWindowTitle -like '*${title.replace(/'/g, "''")}*' } | Select-Object -First 1
if ($proc) { [WinFocus]::SetForegroundWindow($proc.MainWindowHandle); Write-Output 'OK' } else { Write-Output 'NOT_FOUND' }
`;
    try {
      const result = this._ps(ps);
      return this._log('focusWindow', { title }, { success: result.includes('OK') });
    } catch (e) {
      return this._log('focusWindow', { title }, { success: false, error: e.message });
    }
  }

  /** Type text via SendKeys */
  typeText(text) {
    // Escape special SendKeys characters
    const escaped = text.replace(/[+^%~(){}[\]]/g, '{$&}');
    const ps = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${escaped.replace(/'/g, "''")}')`;
    try {
      this._ps(ps);
      return this._log('typeText', { text }, { success: true });
    } catch (e) {
      return this._log('typeText', { text }, { success: false, error: e.message });
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

module.exports = { BrowserControl };
