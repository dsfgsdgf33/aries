/**
 * ARIES v5.0 — Advanced Task Scheduler (Cron Manager)
 * Schedule recurring tasks with cron expressions
 */
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class CronManager {
  constructor() {
    this.jobsFile = path.join(__dirname, '..', 'data', 'cron-jobs.json');
    this.jobs = [];
    this.timers = new Map();
    this.refs = null;
  }

  start(refs) {
    this.refs = refs;
    try { this.jobs = JSON.parse(fs.readFileSync(this.jobsFile, 'utf8')); } catch { this.jobs = []; }
    // Start all enabled jobs
    for (const job of this.jobs) {
      if (job.enabled !== false) this._schedule(job);
    }
  }

  stop() {
    for (const [id, timer] of this.timers) clearInterval(timer);
    this.timers.clear();
  }

  _save() {
    try { fs.writeFileSync(this.jobsFile, JSON.stringify(this.jobs, null, 2)); } catch {}
  }

  _parseCron(expr) {
    // Simplified cron: support interval-style "every Xm", "every Xh", "every Xs"
    const m = expr.match(/^every\s+(\d+)([smh])$/i);
    if (m) {
      const val = parseInt(m[1]);
      const unit = m[2].toLowerCase();
      const ms = unit === 's' ? val * 1000 : unit === 'm' ? val * 60000 : val * 3600000;
      return ms;
    }
    // Default: every 1 hour
    return 3600000;
  }

  _schedule(job) {
    if (this.timers.has(job.id)) clearInterval(this.timers.get(job.id));
    const ms = this._parseCron(job.schedule);
    const timer = setInterval(() => this._run(job), ms);
    this.timers.set(job.id, timer);
  }

  _run(job) {
    const start = Date.now();
    if (job.type === 'command' || !job.type) {
      exec(job.command, { timeout: 30000 }, (err, stdout, stderr) => {
        const entry = { timestamp: Date.now(), duration: Date.now() - start, success: !err, output: (stdout || '').slice(0, 2000), error: err ? err.message : null };
        if (!job.history) job.history = [];
        job.history.push(entry);
        if (job.history.length > 20) job.history = job.history.slice(-20);
        this._save();
      });
    } else if (job.type === 'url') {
      const mod = job.command.startsWith('https') ? require('https') : require('http');
      mod.get(job.command, { timeout: 10000 }, (res) => {
        let d = ''; res.on('data', c => d += c);
        res.on('end', () => {
          if (!job.history) job.history = [];
          job.history.push({ timestamp: Date.now(), duration: Date.now() - start, success: true, status: res.statusCode });
          if (job.history.length > 20) job.history = job.history.slice(-20);
          this._save();
        });
      }).on('error', (e) => {
        if (!job.history) job.history = [];
        job.history.push({ timestamp: Date.now(), duration: Date.now() - start, success: false, error: e.message });
        this._save();
      });
    }
  }

  createJob(data) {
    const job = {
      id: crypto.randomUUID(),
      name: data.name || 'Untitled',
      schedule: data.schedule || 'every 1h',
      command: data.command || '',
      type: data.type || 'command',
      enabled: true,
      created: Date.now(),
      history: []
    };
    this.jobs.push(job);
    this._save();
    this._schedule(job);
    return job;
  }

  deleteJob(id) {
    if (this.timers.has(id)) { clearInterval(this.timers.get(id)); this.timers.delete(id); }
    this.jobs = this.jobs.filter(j => j.id !== id);
    this._save();
    return { ok: true };
  }

  triggerJob(id) {
    const job = this.jobs.find(j => j.id === id);
    if (!job) return { error: 'Job not found' };
    this._run(job);
    return { ok: true, triggered: id };
  }

  registerRoutes(addRoute) {
    addRoute('GET', '/api/cron', (req, res, json) => {
      json(res, 200, { ok: true, jobs: this.jobs.map(j => ({ ...j, history: (j.history || []).slice(-5) })) });
    });
    addRoute('POST', '/api/cron', (req, res, json, body) => {
      try {
        const data = JSON.parse(body);
        const job = this.createJob(data);
        json(res, 200, { ok: true, job });
      } catch (e) { json(res, 400, { error: e.message }); }
    });
    addRoute('DELETE', '/api/cron', (req, res, json) => {
      const parsed = require('url').parse(req.url, true);
      const id = parsed.query.id;
      json(res, 200, this.deleteJob(id));
    });
    addRoute('POST', '/api/cron/run', (req, res, json, body) => {
      try {
        const data = JSON.parse(body);
        json(res, 200, this.triggerJob(data.id));
      } catch (e) { json(res, 400, { error: e.message }); }
    });
  }
}

module.exports = { CronManager };
