#!/usr/bin/env node
/**
 * ARIES Watchdog — Auto-restarts Aries if it crashes or gets killed.
 * Run this instead of launcher.js directly.
 * Usage: node watchdog.js
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASE_DIR = __dirname;
const LOG_PATH = path.join(BASE_DIR, 'watchdog.log');
const LAUNCHER = path.join(BASE_DIR, 'launcher.js');
const MIN_UPTIME_MS = 5000; // if it dies within 5s, it's a boot loop
const MAX_RAPID_CRASHES = 5;
const RESTART_DELAY_MS = 3000;

let rapidCrashes = 0;
let lastStart = 0;
let child = null;
let stopping = false;

function log(msg) {
  const line = `[${new Date().toISOString()}] [watchdog] ${msg}`;
  try { fs.appendFileSync(LOG_PATH, line + '\n'); } catch {}
  console.log(line);
}

function startAries() {
  if (stopping) return;

  const now = Date.now();
  if (now - lastStart < MIN_UPTIME_MS) {
    rapidCrashes++;
    if (rapidCrashes >= MAX_RAPID_CRASHES) {
      log(`FATAL: ${MAX_RAPID_CRASHES} rapid crashes in a row. Giving up. Check app.log for errors.`);
      process.exit(1);
    }
    log(`Rapid crash #${rapidCrashes} detected. Waiting ${RESTART_DELAY_MS * rapidCrashes}ms before retry...`);
    setTimeout(startAries, RESTART_DELAY_MS * rapidCrashes);
    return;
  }

  rapidCrashes = 0;
  lastStart = now;
  log('Starting Aries...');

  child = spawn(process.execPath, [LAUNCHER], {
    cwd: BASE_DIR,
    stdio: 'inherit',
    env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' },
  });

  child.on('exit', (code, signal) => {
    if (stopping) {
      log('Aries stopped (clean shutdown).');
      return;
    }
    log(`Aries exited (code=${code}, signal=${signal}). Restarting in ${RESTART_DELAY_MS}ms...`);
    child = null;
    setTimeout(startAries, RESTART_DELAY_MS);
  });

  child.on('error', (err) => {
    log(`Spawn error: ${err.message}`);
  });
}

function shutdown() {
  stopping = true;
  log('Watchdog shutting down...');
  if (child) {
    child.kill('SIGTERM');
    // Force kill after 5s
    setTimeout(() => {
      if (child) {
        try { child.kill('SIGKILL'); } catch {}
      }
      process.exit(0);
    }, 5000);
  } else {
    process.exit(0);
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

log('═══ ARIES Watchdog Started ═══');
startAries();
