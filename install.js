#!/usr/bin/env node
/**
 * ARIES v4.0 — Install Script
 * 
 * Registers Aries as a Windows Scheduled Task for auto-start.
 * Creates desktop shortcut. Sets up system tray.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE_DIR = __dirname;
const TASK_NAME = 'AriesAI';

console.log('\x1b[36m');
console.log('  █▀▀█ █▀▀█ ▀█▀ █▀▀ █▀▀');
console.log('  █▄▄█ █▄▄▀  █  █▀▀ ▀▀█');
console.log('  █  █ █  █ ▄█▄ █▄▄ ▄▄█  v4.0 Installer');
console.log('\x1b[0m');

// ── 1. Generate initial token if needed ──
const tokensFile = path.join(BASE_DIR, 'config', '.tokens');
const configDir = path.join(BASE_DIR, 'config');
if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });

if (!fs.existsSync(tokensFile) || fs.readFileSync(tokensFile, 'utf8').trim() === '') {
  const token = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(tokensFile, token);
  console.log(`\x1b[32m✓ Generated API token: ${token}\x1b[0m`);
  console.log('  Save this token — you\'ll need it for remote access.\n');
} else {
  console.log('\x1b[90m  Existing tokens found.\x1b[0m');
}

// ── 2. Ensure directories ──
for (const dir of ['data', 'logs', 'plugins']) {
  const p = path.join(BASE_DIR, dir);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}
console.log('\x1b[32m✓ Directories created\x1b[0m');

// ── 3. Register Windows Scheduled Task ──
try {
  // Remove existing task if any
  try { execSync(`schtasks /Delete /TN "${TASK_NAME}" /F 2>nul`, { stdio: 'pipe' }); } catch {}

  const nodePath = process.execPath;
  const daemonPath = path.join(BASE_DIR, 'core', 'watchdog.js');

  // Create task that runs at logon with restart on failure
  execSync(
    `schtasks /Create /TN "${TASK_NAME}" /TR "\\"${nodePath}\\" \\"${daemonPath}\\"" /SC ONLOGON /RL HIGHEST /F`,
    { stdio: 'pipe' }
  );
  console.log('\x1b[32m✓ Registered Windows Scheduled Task: ' + TASK_NAME + '\x1b[0m');
  console.log('  Aries will auto-start at logon with watchdog protection.');
} catch (e) {
  console.log('\x1b[33m⚠ Failed to register scheduled task (need admin?): ' + e.message + '\x1b[0m');
  console.log('  Run this installer as Administrator for auto-start.');
}

// ── 4. Create desktop shortcut ──
try {
  const desktop = path.join(process.env.USERPROFILE || '', 'Desktop');
  const shortcutPath = path.join(desktop, 'ARIES.lnk');
  const psCmd = `
    $ws = New-Object -ComObject WScript.Shell;
    $sc = $ws.CreateShortcut('${shortcutPath.replace(/'/g, "''")}');
    $sc.TargetPath = '${process.execPath.replace(/'/g, "''")}';
    $sc.Arguments = '"${path.join(BASE_DIR, 'launcher.js').replace(/'/g, "''")}"';
    $sc.WorkingDirectory = '${BASE_DIR.replace(/'/g, "''")}';
    $sc.Description = 'ARIES v4.0 — AI Control Center';
    $sc.IconLocation = '${path.join(BASE_DIR, 'aries.ico').replace(/'/g, "''")}';
    $sc.Save();
  `.replace(/\n/g, ' ');

  execSync(`powershell -NoProfile -Command "${psCmd}"`, { stdio: 'pipe' });
  console.log('\x1b[32m✓ Desktop shortcut created\x1b[0m');
} catch (e) {
  console.log('\x1b[33m⚠ Desktop shortcut failed: ' + e.message + '\x1b[0m');
}

// ── 5. Add to PATH ──
try {
  const binDir = path.join(BASE_DIR, 'bin');
  const currentPath = execSync('echo %PATH%', { encoding: 'utf8' }).trim();
  if (!currentPath.includes(binDir)) {
    console.log(`\x1b[90m  To use 'aries' command globally, add to PATH:\x1b[0m`);
    console.log(`  \x1b[36m${binDir}\x1b[0m`);
  }
} catch {}

console.log('\n\x1b[32m═══ Installation Complete ═══\x1b[0m');
console.log(`
  Start Aries:    node bin/aries-cli.js start
  Open dashboard:  http://localhost:3333
  TUI mode:        node aries.js
  Desktop app:     node launcher.js
  
  Or use the desktop shortcut / auto-start at logon.
`);
