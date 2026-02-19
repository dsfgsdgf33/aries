#!/usr/bin/env node
/**
 * ARIES v5.3 — Desktop Shortcut Installer
 * Creates desktop shortcut + Start Menu entry on Windows
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const BASE_DIR = __dirname;
const BAT_PATH = path.join(BASE_DIR, 'launch.bat');
const VBS_PATH = path.join(BASE_DIR, 'launch.vbs');
const ICO_PATH = path.join(BASE_DIR, 'aries.ico');

// Pick target: prefer launch.bat, fall back to launch.vbs
const TARGET = fs.existsSync(BAT_PATH) ? BAT_PATH : VBS_PATH;
const ICON = fs.existsSync(ICO_PATH) ? ICO_PATH : '%SystemRoot%\\System32\\shell32.dll,21';

if (os.platform() !== 'win32') {
  console.log('Shortcut creation is Windows-only. Skipping.');
  process.exit(0);
}

const psScript = `
$WshShell = New-Object -ComObject WScript.Shell

# Desktop shortcut
$Desktop = $WshShell.SpecialFolders("Desktop")
$Shortcut = $WshShell.CreateShortcut("$Desktop\\ARIES.lnk")
$Shortcut.TargetPath = "${TARGET.replace(/\\/g, '\\\\')}"
$Shortcut.WorkingDirectory = "${BASE_DIR.replace(/\\/g, '\\\\')}"
$Shortcut.IconLocation = "${ICON.replace(/\\/g, '\\\\')}"
$Shortcut.Description = "ARIES - Autonomous Runtime Intelligence"
$Shortcut.WindowStyle = 7
$Shortcut.Save()
Write-Host "[+] Desktop shortcut created"

# Start Menu shortcut
$StartMenu = "$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs"
$Shortcut2 = $WshShell.CreateShortcut("$StartMenu\\ARIES.lnk")
$Shortcut2.TargetPath = "${TARGET.replace(/\\/g, '\\\\')}"
$Shortcut2.WorkingDirectory = "${BASE_DIR.replace(/\\/g, '\\\\')}"
$Shortcut2.IconLocation = "${ICON.replace(/\\/g, '\\\\')}"
$Shortcut2.Description = "ARIES - Autonomous Runtime Intelligence"
$Shortcut2.WindowStyle = 7
$Shortcut2.Save()
Write-Host "[+] Start Menu entry created"
`;

try {
  execSync(`powershell -NoProfile -Command "${psScript.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
    encoding: 'utf8',
    stdio: 'inherit'
  });
  console.log('✓ Shortcuts installed successfully.');
} catch (err) {
  console.error('Failed to create shortcuts:', err.message);
}
