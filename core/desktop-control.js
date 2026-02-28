/**
 * Desktop Control Module — Screen capture, mouse/keyboard via PowerShell
 * Node.js built-ins only. Windows PowerShell automation.
 */
'use strict';

const { execSync, exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const SCREENSHOT_PATH = path.join(__dirname, '..', 'data', 'desktop-screenshot.png');

function ensureDataDir() {
  const dir = path.dirname(SCREENSHOT_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Take a screenshot and return base64 PNG
 */
function takeScreenshot() {
  ensureDataDir();
  const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
$g.Dispose()
$bmp.Save('${SCREENSHOT_PATH.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "$($screen.Width)x$($screen.Height)"
`.trim();
  try {
    const result = execSync(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"').replace(/\n/g, '; ')}"`, { timeout: 10000 }).toString().trim();
    const imgBuf = fs.readFileSync(SCREENSHOT_PATH);
    return { success: true, base64: imgBuf.toString('base64'), resolution: result, size: imgBuf.length };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Simulate mouse click at x, y
 */
function clickAt(x, y, button) {
  button = button || 'left';
  const ps = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${parseInt(x)}, ${parseInt(y)})
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class MouseSim {
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, IntPtr dwExtraInfo);
  public static void Click() { mouse_event(0x0002, 0, 0, 0, IntPtr.Zero); mouse_event(0x0004, 0, 0, 0, IntPtr.Zero); }
  public static void RightClick() { mouse_event(0x0008, 0, 0, 0, IntPtr.Zero); mouse_event(0x0010, 0, 0, 0, IntPtr.Zero); }
}
'@
${button === 'right' ? '[MouseSim]::RightClick()' : '[MouseSim]::Click()'}
`.trim();
  try {
    execSync(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"').replace(/\n/g, '; ')}"`, { timeout: 5000 });
    return { success: true, x: parseInt(x), y: parseInt(y), button };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Simulate keyboard input
 */
function typeText(text) {
  const escaped = text.replace(/'/g, "''");
  const ps = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${escaped}')`;
  try {
    execSync(`powershell -NoProfile -Command "${ps}"`, { timeout: 5000 });
    return { success: true, typed: text };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Get screen info
 */
function getScreenInfo() {
  try {
    const ps = `Add-Type -AssemblyName System.Windows.Forms; $s = [System.Windows.Forms.Screen]::PrimaryScreen; Write-Output "$($s.Bounds.Width)x$($s.Bounds.Height)"`;
    const result = execSync(`powershell -NoProfile -Command "${ps}"`, { timeout: 5000 }).toString().trim();
    const [w, h] = result.split('x').map(Number);
    return { success: true, width: w, height: h, resolution: result };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

module.exports = { takeScreenshot, clickAt, typeText, getScreenInfo };
