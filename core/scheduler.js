/**
 * ARIES v4.4 — Cron/Task Scheduling System
 * Native scheduled tasks with cron expressions.
 * Uses only Node.js built-in modules.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const EventEmitter = require('events');

const DATA_DIR = path.join(__dirname, '..', 'data');
const JOBS_FILE = path.join(DATA_DIR, 'scheduler-jobs.json');
const HISTORY_FILE = path.join(DATA_DIR, 'scheduler-history.json');

/**
 * Parse a simple cron expression: min hour day month weekday
 * Supports: *, specific numbers, comma-separated, ranges (1-5), step (* /5)
 * @param {string} expr - Cron expression
 * @returns {object} Parsed cron fields
 */
function parseCron(expr) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('Invalid cron expression: need 5 fields (min hour day month weekday)');

  function parseField(field, min, max) {
    if (field === '*') return null; // any
    // Step: */N
    if (field.startsWith('*/')) {
      const step = parseInt(field.slice(2));
      if (isNaN(step) || step < 1) throw new Error('Invalid step: ' + field);
      const values = [];
      for (let i = min; i <= max; i += step) values.push(i);
      return values;
    }
    // Comma-separated and ranges
    const values = [];
    for (const part of field.split(',')) {
      if (part.includes('-')) {
        const [a, b] = part.split('-').map(Number);
        if (isNaN(a) || isNaN(b)) throw new Error('Invalid range: ' + part);
        for (let i = a; i <= b; i++) values.push(i);
      } else {
        const n = parseInt(part);
        if (isNaN(n)) throw new Error('Invalid value: ' + part);
        values.push(n);
      }
    }
    return values;
  }

  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    day: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12),
    weekday: parseField(parts[4], 0, 6)
  };
}

/**
 * Check if a cron expression matches a given date
 * @param {object} parsed - Parsed cron fields
 * @param {Date} date
 * @returns {boolean}
 */
function cronMatches(parsed, date) {
  const checks = [
    [parsed.minute, date.getMinutes()],
    [parsed.hour, date.getHours()],
    [parsed.day, date.getDate()],
    [parsed.month, date.getMonth() + 1],
    [parsed.weekday, date.getDay()]
  ];
  for (const [allowed, value] of checks) {
    if (allowed !== null && !allowed.includes(value)) return false;
  }
  return true;
}

class Scheduler extends EventEmitter {
  /**
   * @param {object} config - scheduler config section
   * @param {object} refs - { ai, swarm, messaging }
   */
  constructor(config = {}, refs = {}) {
    super();
    this.checkIntervalMs = config.checkIntervalMs || 30000;
    this.maxJobs = config.maxJobs || 100;
    this.refs = refs;
    this._jobs = {};
    this._history = [];
    this._timer = null;
    this._lastCheck = {};
    this._loadJobs();
    this._loadHistory();
  }

  _ensureDir() {
    try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
  }

  _loadJobs() {
    try {
      if (fs.existsSync(JOBS_FILE)) {
        this._jobs = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
      }
    } catch { this._jobs = {}; }
  }

  _saveJobs() {
    try {
      this._ensureDir();
      fs.writeFileSync(JOBS_FILE, JSON.stringify(this._jobs, null, 2));
    } catch {}
  }

  _loadHistory() {
    try {
      if (fs.existsSync(HISTORY_FILE)) {
        this._history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      }
    } catch { this._history = []; }
  }

  _saveHistory() {
    try {
      this._ensureDir();
      if (this._history.length > 1000) this._history = this._history.slice(-1000);
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(this._history, null, 2));
    } catch {}
  }

  /**
   * Add a recurring job
   * @param {string} name - Job name
   * @param {string} schedule - Cron expression
   * @param {object} action - { type, ... }
   * @param {object} options - Additional options
   * @returns {{jobId: string, created: boolean}}
   */
  addJob(name, schedule, action, options = {}) {
    if (Object.keys(this._jobs).length >= this.maxJobs) {
      throw new Error('Maximum jobs limit reached');
    }

    // Validate cron
    const parsed = parseCron(schedule);

    const jobId = crypto.randomBytes(6).toString('hex');
    this._jobs[jobId] = {
      id: jobId,
      name,
      schedule,
      parsedCron: parsed,
      action,
      type: 'recurring',
      enabled: true,
      createdAt: new Date().toISOString(),
      lastRun: null,
      runCount: 0,
      ...options
    };
    this._saveJobs();
    this.emit('job-added', { jobId, name });
    return { jobId, created: true };
  }

  /**
   * Add a one-shot scheduled task
   * @param {string} name - Job name
   * @param {string|Date} dateTime - When to run (ISO string or Date)
   * @param {object} action - { type, ... }
   * @returns {{jobId: string, created: boolean}}
   */
  addOneShot(name, dateTime, action) {
    const jobId = crypto.randomBytes(6).toString('hex');
    const runAt = typeof dateTime === 'string' ? new Date(dateTime) : dateTime;

    this._jobs[jobId] = {
      id: jobId,
      name,
      runAt: runAt.toISOString(),
      action,
      type: 'oneshot',
      enabled: true,
      createdAt: new Date().toISOString(),
      lastRun: null,
      runCount: 0
    };
    this._saveJobs();
    this.emit('job-added', { jobId, name });
    return { jobId, created: true };
  }

  /**
   * Remove a job
   * @param {string} jobId
   * @returns {{removed: boolean}}
   */
  removeJob(jobId) {
    if (this._jobs[jobId]) {
      const name = this._jobs[jobId].name;
      delete this._jobs[jobId];
      this._saveJobs();
      this.emit('job-removed', { jobId, name });
      return { removed: true };
    }
    return { removed: false, error: 'Job not found' };
  }

  /**
   * List all jobs
   * @returns {Array}
   */
  listJobs() {
    return Object.values(this._jobs).map(j => ({
      id: j.id,
      name: j.name,
      type: j.type,
      schedule: j.schedule || null,
      runAt: j.runAt || null,
      enabled: j.enabled,
      lastRun: j.lastRun,
      runCount: j.runCount,
      createdAt: j.createdAt
    }));
  }

  /**
   * Get job execution history
   * @param {string} jobId - Optional filter by job
   * @returns {Array}
   */
  getJobHistory(jobId) {
    if (jobId) {
      return this._history.filter(h => h.jobId === jobId);
    }
    return this._history;
  }

  /**
   * Pause a job
   * @param {string} jobId
   * @returns {{paused: boolean}}
   */
  pauseJob(jobId) {
    if (this._jobs[jobId]) {
      this._jobs[jobId].enabled = false;
      this._saveJobs();
      return { paused: true };
    }
    return { paused: false, error: 'Job not found' };
  }

  /**
   * Resume a job
   * @param {string} jobId
   * @returns {{resumed: boolean}}
   */
  resumeJob(jobId) {
    if (this._jobs[jobId]) {
      this._jobs[jobId].enabled = true;
      this._saveJobs();
      return { resumed: true };
    }
    return { resumed: false, error: 'Job not found' };
  }

  /**
   * Execute an action
   * @param {object} action - { type, ... }
   * @returns {Promise<object>}
   */
  async _executeAction(action) {
    try {
      switch (action.type) {
        case 'command': {
          const output = execSync(action.cmd, {
            encoding: 'utf8', timeout: 30000, shell: 'powershell.exe',
            maxBuffer: 1024 * 1024
          });
          return { success: true, output: output.substring(0, 2000) };
        }
        case 'webhook': {
          const https = require('https');
          const http = require('http');
          const parsed = new URL(action.url);
          const mod = parsed.protocol === 'https:' ? https : http;
          return new Promise((resolve) => {
            const req = mod.request({
              hostname: parsed.hostname, port: parsed.port,
              path: parsed.pathname + parsed.search,
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              timeout: 10000
            }, (res) => {
              let data = '';
              res.on('data', c => data += c);
              res.on('end', () => resolve({ success: true, statusCode: res.statusCode }));
            });
            req.on('error', e => resolve({ success: false, error: e.message }));
            req.on('timeout', () => { req.destroy(); resolve({ success: false, error: 'timeout' }); });
            req.write(JSON.stringify(action.payload || {}));
            req.end();
          });
        }
        case 'message': {
          if (this.refs.messaging) {
            const result = await this.refs.messaging.send(action.channel, action.target, action.text);
            return { success: true, result };
          }
          return { success: false, error: 'Messaging not available' };
        }
        case 'chat': {
          // Emit for headless to handle
          this.emit('chat-action', { prompt: action.prompt });
          return { success: true, note: 'Chat action emitted' };
        }
        case 'swarm': {
          if (this.refs.swarm) {
            const result = await this.refs.swarm.execute(action.task);
            return { success: true, result: typeof result === 'string' ? result.substring(0, 1000) : result };
          }
          return { success: false, error: 'Swarm not available' };
        }
        default:
          return { success: false, error: 'Unknown action type: ' + action.type };
      }
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  /**
   * Check and run due jobs
   */
  async _checkJobs() {
    const now = new Date();
    const minuteKey = now.getFullYear() + '-' + now.getMonth() + '-' + now.getDate() + '-' + now.getHours() + '-' + now.getMinutes();

    for (const [jobId, job] of Object.entries(this._jobs)) {
      if (!job.enabled) continue;

      try {
        let shouldRun = false;

        if (job.type === 'recurring' && job.parsedCron) {
          // Prevent running same minute twice
          const checkKey = jobId + ':' + minuteKey;
          if (this._lastCheck[checkKey]) continue;
          if (cronMatches(job.parsedCron, now)) {
            shouldRun = true;
            this._lastCheck[checkKey] = true;
          }
        } else if (job.type === 'oneshot' && job.runAt) {
          const runAt = new Date(job.runAt);
          if (now >= runAt && job.runCount === 0) {
            shouldRun = true;
          }
        }

        if (shouldRun) {
          job.lastRun = now.toISOString();
          job.runCount = (job.runCount || 0) + 1;
          this._saveJobs();

          const result = await this._executeAction(job.action);
          this._history.push({
            jobId,
            jobName: job.name,
            action: job.action.type,
            result,
            timestamp: now.toISOString()
          });
          this._saveHistory();
          this.emit('job-executed', { jobId, name: job.name, result });

          // Remove oneshot after execution
          if (job.type === 'oneshot') {
            delete this._jobs[jobId];
            this._saveJobs();
          }
        }
      } catch (e) {
        this._history.push({
          jobId, jobName: job.name, action: job.action?.type,
          result: { success: false, error: e.message },
          timestamp: now.toISOString()
        });
        this._saveHistory();
      }
    }

    // Clean old lastCheck entries
    const keys = Object.keys(this._lastCheck);
    if (keys.length > 1000) {
      const toDelete = keys.slice(0, keys.length - 100);
      for (const k of toDelete) delete this._lastCheck[k];
    }
  }

  /**
   * Start the scheduler
   */
  start() {
    if (this._timer) return;
    this._timer = setInterval(() => this._checkJobs(), this.checkIntervalMs);
    this._checkJobs(); // Run immediately
    this.emit('started');
  }

  /**
   * Stop the scheduler
   */
  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this.removeAllListeners();
  }

  // ═══════════════════════════════════════════════════════════
  // v5.0 — Battle-Tested Scheduler Upgrades
  // ═══════════════════════════════════════════════════════════

  /**
   * Add a job with dependencies (DAG-style)
   * @param {string} name
   * @param {string} schedule
   * @param {object} action
   * @param {object} options - { timeout, retries, dependsOn, recoverMissed }
   * @returns {{jobId: string, created: boolean}}
   */
  addAdvancedJob(name, schedule, action, options) {
    try {
      options = options || {};
      var result = this.addJob(name, schedule, action, {});
      var job = this._jobs[result.jobId];
      if (job) {
        job.timeoutMs = options.timeout || 60000;
        job.maxRetries = options.retries || 1;
        job.dependsOn = options.dependsOn || null;
        job.recoverMissed = options.recoverMissed !== false;
        job.outputHistory = [];
        job.stats = { success: 0, failure: 0, totalRuntime: 0, runs: 0 };
        this._saveJobs();
      }
      return result;
    } catch (e) { return { jobId: null, created: false, error: e.message }; }
  }

  /**
   * Force-run a job immediately
   * @param {string} jobId
   * @returns {Promise<object>}
   */
  async forceRun(jobId) {
    try {
      var job = this._jobs[jobId];
      if (!job) return { error: 'Job not found' };

      var startMs = Date.now();
      var result = await this._executeAction(job.action);
      var elapsed = Date.now() - startMs;

      job.lastRun = new Date().toISOString();
      job.runCount = (job.runCount || 0) + 1;
      if (job.stats) {
        job.stats.runs++;
        job.stats.totalRuntime += elapsed;
        if (result.success) { job.stats.success++; } else { job.stats.failure++; }
      }
      if (job.outputHistory) {
        job.outputHistory.push({ timestamp: job.lastRun, result: result, durationMs: elapsed });
        if (job.outputHistory.length > 10) job.outputHistory.shift();
      }
      this._saveJobs();

      this._history.push({ jobId: jobId, jobName: job.name, action: job.action.type, result: result, timestamp: job.lastRun, durationMs: elapsed, forced: true });
      this._saveHistory();

      return { success: true, result: result, durationMs: elapsed };
    } catch (e) { return { success: false, error: e.message }; }
  }

  /**
   * Get jobs in a date range (calendar view)
   * @param {string} startDate - ISO date string
   * @param {string} endDate - ISO date string
   * @returns {Array}
   */
  getCalendar(startDate, endDate) {
    try {
      var start = new Date(startDate || Date.now() - 7 * 86400000);
      var end = new Date(endDate || Date.now() + 7 * 86400000);
      return this._history.filter(function(h) {
        var ts = new Date(h.timestamp);
        return ts >= start && ts <= end;
      });
    } catch (e) { return []; }
  }

  /**
   * Get execution statistics
   * @returns {object}
   */
  getStats() {
    try {
      var totalJobs = Object.keys(this._jobs).length;
      var activeJobs = Object.values(this._jobs).filter(function(j) { return j.enabled; }).length;
      var totalRuns = this._history.length;
      var successes = this._history.filter(function(h) { return h.result && h.result.success; }).length;
      var failures = totalRuns - successes;
      var avgRuntime = 0;
      var runtimeCount = 0;
      for (var i = 0; i < this._history.length; i++) {
        if (this._history[i].durationMs) {
          avgRuntime += this._history[i].durationMs;
          runtimeCount++;
        }
      }
      if (runtimeCount > 0) avgRuntime = Math.round(avgRuntime / runtimeCount);

      return {
        totalJobs: totalJobs, activeJobs: activeJobs,
        totalRuns: totalRuns, successes: successes, failures: failures,
        successRate: totalRuns > 0 ? Math.round((successes / totalRuns) * 100) : 0,
        avgRuntimeMs: avgRuntime
      };
    } catch (e) { return { totalJobs: 0, activeJobs: 0, totalRuns: 0 }; }
  }

  /**
   * Create job from template
   * @param {string} templateId
   * @returns {{jobId: string, created: boolean}}
   */
  createFromTemplate(templateId) {
    try {
      var template = _SCHED_TEMPLATES[templateId];
      if (!template) return { created: false, error: 'Unknown template: ' + templateId + '. Available: ' + Object.keys(_SCHED_TEMPLATES).join(', ') };
      return this.addJob(template.name, template.schedule, template.action);
    } catch (e) { return { created: false, error: e.message }; }
  }
}

var _SCHED_TEMPLATES = {
  'daily-backup': { name: 'Daily Backup', schedule: '0 2 * * *', action: { type: 'command', cmd: 'echo "Running daily backup"' } },
  'hourly-health-check': { name: 'Hourly Health Check', schedule: '0 * * * *', action: { type: 'webhook', url: 'http://localhost:3333/api/health', payload: {} } },
  'morning-briefing': { name: 'Morning Briefing', schedule: '0 8 * * 1-5', action: { type: 'chat', prompt: 'Give me a morning briefing with weather, calendar, and top news' } }
};

module.exports = { Scheduler };
