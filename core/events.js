/**
 * ARIES — Events (File Watching + Cron Scheduling)
 * Zero dependency version using built-in fs.watch and setInterval-based cron.
 */
const fs = require('fs');
const path = require('path');

const watchers = [];
const jobs = [];

function watchFile(filePath, callback) {
  try {
    const watcher = fs.watch(filePath, { persistent: true }, (eventType) => {
      callback(eventType === 'rename' ? 'renamed' : 'changed', filePath);
    });
    watchers.push(watcher);
    return watchers.length - 1;
  } catch (e) {
    console.error('[EVENTS] Watch failed:', e.message);
    return -1;
  }
}

// Simple cron-like scheduler using setInterval
// Supports: "*/N * * * *" (every N minutes) and basic cron patterns
function scheduleJob(cronExpr, callback) {
  // Parse basic cron — for full cron, use the CronManager module
  const parts = cronExpr.trim().split(/\s+/);
  let intervalMs = 60000; // default: every minute

  if (parts[0] && parts[0].startsWith('*/')) {
    const n = parseInt(parts[0].slice(2));
    if (!isNaN(n) && n > 0) intervalMs = n * 60000;
  } else if (parts[0] && /^\d+$/.test(parts[0])) {
    // Specific minute — check every minute
    const targetMin = parseInt(parts[0]);
    const id = setInterval(() => {
      const now = new Date();
      if (now.getMinutes() === targetMin) callback();
    }, 60000);
    jobs.push({ cancel: () => clearInterval(id) });
    return jobs.length - 1;
  }

  const id = setInterval(callback, intervalMs);
  jobs.push({ cancel: () => clearInterval(id) });
  return jobs.length - 1;
}

function stopAll() {
  watchers.forEach(w => { try { w.close(); } catch {} });
  jobs.forEach(j => { try { j.cancel(); } catch {} });
  watchers.length = 0;
  jobs.length = 0;
}

function status() {
  return { watchers: watchers.length, jobs: jobs.length };
}

module.exports = { watchFile, scheduleJob, stopAll, status };
