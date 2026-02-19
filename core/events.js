const chokidar = require('chokidar');
const schedule = require('node-schedule');

const watchers = [];
const jobs = [];

function watchFile(filePath, callback) {
  const watcher = chokidar.watch(filePath, { persistent: true, ignoreInitial: true });
  watcher.on('change', () => callback('changed', filePath));
  watcher.on('add', () => callback('added', filePath));
  watcher.on('unlink', () => callback('removed', filePath));
  watchers.push(watcher);
  return watchers.length - 1;
}

function scheduleJob(cron, callback) {
  const job = schedule.scheduleJob(cron, callback);
  jobs.push(job);
  return jobs.length - 1;
}

function stopAll() {
  watchers.forEach(w => w.close());
  jobs.forEach(j => j.cancel());
  watchers.length = 0;
  jobs.length = 0;
}

function status() {
  return { watchers: watchers.length, jobs: jobs.length };
}

module.exports = { watchFile, scheduleJob, stopAll, status };
