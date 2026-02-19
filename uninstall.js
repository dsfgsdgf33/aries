#!/usr/bin/env node
/**
 * ARIES v4.0 — Uninstall Script
 * Removes scheduled task and desktop shortcut.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TASK_NAME = 'AriesAI';

console.log('\x1b[33mUninstalling ARIES...\x1b[0m');

// Stop running instance
try {
  const ProcessManager = require('./core/process-manager');
  ProcessManager.kill().catch(() => {});
} catch {}

// Remove scheduled task
try {
  execSync(`schtasks /Delete /TN "${TASK_NAME}" /F`, { stdio: 'pipe' });
  console.log('\x1b[32m✓ Removed scheduled task\x1b[0m');
} catch {
  console.log('\x1b[90m  No scheduled task found\x1b[0m');
}

// Remove desktop shortcut
try {
  const desktop = path.join(process.env.USERPROFILE || '', 'Desktop');
  const shortcut = path.join(desktop, 'ARIES.lnk');
  if (fs.existsSync(shortcut)) {
    fs.unlinkSync(shortcut);
    console.log('\x1b[32m✓ Removed desktop shortcut\x1b[0m');
  }
} catch {}

// Clean PID files
try {
  for (const f of ['data/aries.pid', 'data/aries.port']) {
    const p = path.join(__dirname, f);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  console.log('\x1b[32m✓ Cleaned PID files\x1b[0m');
} catch {}

console.log('\n\x1b[32mUninstall complete.\x1b[0m');
console.log('Config, data, and logs were preserved. Delete the aries/ folder to remove everything.');
