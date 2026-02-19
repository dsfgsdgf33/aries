'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── Built-in Cron Parser (no npm) ──────────────────────────────────────────

function parseCronField(field, min, max) {
  const values = new Set();
  for (const part of field.split(',')) {
    // */N
    const stepAll = part.match(/^\*\/(\d+)$/);
    if (stepAll) {
      const step = parseInt(stepAll[1], 10);
      for (let i = min; i <= max; i += step) values.add(i);
      continue;
    }
    // *
    if (part === '*') {
      for (let i = min; i <= max; i++) values.add(i);
      continue;
    }
    // range with optional step: N-M or N-M/S
    const range = part.match(/^(\d+)-(\d+)(\/(\d+))?$/);
    if (range) {
      const lo = parseInt(range[1], 10);
      const hi = parseInt(range[2], 10);
      const step = range[4] ? parseInt(range[4], 10) : 1;
      for (let i = lo; i <= hi; i += step) values.add(i);
      continue;
    }
    // plain number
    const num = parseInt(part, 10);
    if (!isNaN(num)) values.add(num);
  }
  return values;
}

function parseCron(expr) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Invalid cron expression: ${expr}`);
  return {
    minutes:  parseCronField(parts[0], 0, 59),
    hours:    parseCronField(parts[1], 0, 23),
    days:     parseCronField(parts[2], 1, 31),
    months:   parseCronField(parts[3], 1, 12),
    weekdays: parseCronField(parts[4], 0, 6),
  };
}

function cronMatches(parsed, date) {
  return (
    parsed.minutes.has(date.getMinutes()) &&
    parsed.hours.has(date.getHours()) &&
    parsed.days.has(date.getDate()) &&
    parsed.months.has(date.getMonth() + 1) &&
    parsed.weekdays.has(date.getDay())
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function uid() { return crypto.randomBytes(8).toString('hex'); }

function readJSON(fp, fallback) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return fallback; }
}

function writeJSON(fp, data) {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(data, null, 2));
}

function toCT(date) {
  // Return a Date-like object adjusted to US Central Time
  // CT is UTC-6 (CST) or UTC-5 (CDT). We approximate with Intl.
  const str = date.toLocaleString('en-US', { timeZone: 'America/Chicago' });
  return new Date(str);
}

// ─── Default Schedules ─────────────────────────────────────────────────────

const DEFAULT_SCHEDULES = [
  {
    id: 'default-mine-night',
    name: 'Mining full intensity (11PM-7AM CT)',
    schedule: '0 23,0,1,2,3,4,5,6 * * *',
    action: 'mine',
    params: { intensity: 100 },
    enabled: true,
  },
  {
    id: 'default-mine-day',
    name: 'Mining 50% intensity (7AM-11PM CT)',
    schedule: '0 7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22 * * *',
    action: 'mine',
    params: { intensity: 50 },
    enabled: true,
  },
  {
    id: 'default-proxy-rotate',
    name: 'Proxy IP rotation every 2 hours',
    schedule: '0 */2 * * *',
    action: 'proxy-rotate',
    params: {},
    enabled: true,
  },
  {
    id: 'default-ai-batch',
    name: 'AI task queue processing every 30 min',
    schedule: '*/30 * * * *',
    action: 'ai-batch',
    params: {},
    enabled: true,
  },
];

// ─── SwarmScheduler ─────────────────────────────────────────────────────────

class SwarmScheduler {
  /**
   * @param {object} opts
   * @param {string} opts.dataDir        - path to data/ directory
   * @param {object} [opts.relay]        - relay instance with dispatch(workerId, action, params)
   * @param {object} [opts.workerOverrides] - { workerId: { scheduleId: { enabled, params } } }
   */
  constructor(opts = {}) {
    this.dataDir = opts.dataDir || path.join(__dirname, '..', 'data');
    this.relay = opts.relay || null;
    this.workerOverrides = opts.workerOverrides || {};

    this.schedulesPath = path.join(this.dataDir, 'schedules.json');
    this.logPath = path.join(this.dataDir, 'scheduler-log.json');

    this.schedules = [];
    this._parsedCache = new Map(); // id -> parsed cron
    this._timer = null;
    this._running = false;
    this._lastTick = -1; // minute stamp to avoid double-fire
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  start() {
    this._load();
    this._running = true;
    // Tick every 15 s; only fire actions on new minutes
    this._timer = setInterval(() => this._tick(), 15_000);
    this._tick(); // immediate first check
    return this;
  }

  stop() {
    this._running = false;
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  // ── Schedule CRUD ───────────────────────────────────────────────────────

  addSchedule(sched) {
    const entry = {
      id: sched.id || uid(),
      name: sched.name || 'Unnamed',
      schedule: sched.schedule,
      action: sched.action,
      params: sched.params || {},
      enabled: sched.enabled !== false,
    };
    // validate cron
    const parsed = parseCron(entry.schedule);
    this._parsedCache.set(entry.id, parsed);
    this.schedules.push(entry);
    this._save();
    return entry;
  }

  updateSchedule(id, updates) {
    const idx = this.schedules.findIndex(s => s.id === id);
    if (idx === -1) return null;
    const entry = this.schedules[idx];
    if (updates.name !== undefined) entry.name = updates.name;
    if (updates.schedule !== undefined) {
      entry.schedule = updates.schedule;
      this._parsedCache.set(id, parseCron(entry.schedule));
    }
    if (updates.action !== undefined) entry.action = updates.action;
    if (updates.params !== undefined) entry.params = updates.params;
    if (updates.enabled !== undefined) entry.enabled = updates.enabled;
    this._save();
    return entry;
  }

  removeSchedule(id) {
    const idx = this.schedules.findIndex(s => s.id === id);
    if (idx === -1) return false;
    this.schedules.splice(idx, 1);
    this._parsedCache.delete(id);
    this._save();
    return true;
  }

  listSchedules() { return this.schedules; }

  triggerSchedule(id) {
    const sched = this.schedules.find(s => s.id === id);
    if (!sched) return { ok: false, error: 'not_found' };
    this._execute(sched, true);
    return { ok: true };
  }

  // ── Worker Overrides ────────────────────────────────────────────────────

  setWorkerOverride(workerId, scheduleId, override) {
    if (!this.workerOverrides[workerId]) this.workerOverrides[workerId] = {};
    this.workerOverrides[workerId][scheduleId] = override;
  }

  getWorkerOverride(workerId, scheduleId) {
    return this.workerOverrides[workerId]?.[scheduleId] || null;
  }

  // ── API Route Installer ─────────────────────────────────────────────────

  /**
   * Attach scheduler API routes to an express-like app (or any router with
   * .get/.post/.put/.delete that passes (req, res)).
   */
  installRoutes(app) {
    const prefix = '/api/manage/scheduler';

    app.get(`${prefix}/list`, (_req, res) => {
      res.json({ ok: true, schedules: this.listSchedules() });
    });

    app.post(`${prefix}/add`, (req, res) => {
      try {
        const entry = this.addSchedule(req.body);
        res.json({ ok: true, schedule: entry });
      } catch (e) {
        res.status(400).json({ ok: false, error: e.message });
      }
    });

    app.put(`${prefix}/update/:id`, (req, res) => {
      const result = this.updateSchedule(req.params.id, req.body);
      if (!result) return res.status(404).json({ ok: false, error: 'not_found' });
      res.json({ ok: true, schedule: result });
    });

    app.delete(`${prefix}/remove/:id`, (req, res) => {
      const ok = this.removeSchedule(req.params.id);
      if (!ok) return res.status(404).json({ ok: false, error: 'not_found' });
      res.json({ ok: true });
    });

    app.post(`${prefix}/trigger/:id`, (req, res) => {
      const result = this.triggerSchedule(req.params.id);
      if (!result.ok) return res.status(404).json(result);
      res.json(result);
    });
  }

  // ── Internal ────────────────────────────────────────────────────────────

  _load() {
    const stored = readJSON(this.schedulesPath, null);
    if (stored && Array.isArray(stored) && stored.length > 0) {
      this.schedules = stored;
    } else {
      this.schedules = DEFAULT_SCHEDULES.map(s => ({ ...s }));
    }
    // Build cron cache
    this._parsedCache.clear();
    for (const s of this.schedules) {
      try { this._parsedCache.set(s.id, parseCron(s.schedule)); } catch {}
    }
    this._save();
  }

  _save() {
    writeJSON(this.schedulesPath, this.schedules);
  }

  _tick() {
    const now = toCT(new Date());
    const stamp = now.getFullYear() * 100000000 +
                  (now.getMonth() + 1) * 1000000 +
                  now.getDate() * 10000 +
                  now.getHours() * 100 +
                  now.getMinutes();
    if (stamp === this._lastTick) return;
    this._lastTick = stamp;

    for (const sched of this.schedules) {
      if (!sched.enabled) continue;
      const parsed = this._parsedCache.get(sched.id);
      if (!parsed) continue;
      if (cronMatches(parsed, now)) {
        this._execute(sched, false);
      }
    }
  }

  _execute(sched, manual) {
    const ts = new Date().toISOString();
    const logEntry = {
      id: uid(),
      scheduleId: sched.id,
      scheduleName: sched.name,
      action: sched.action,
      params: sched.params,
      manual,
      ts,
      dispatched: [],
    };

    // Dispatch to workers via relay
    if (this.relay && typeof this.relay.dispatch === 'function') {
      const workers = typeof this.relay.getWorkers === 'function'
        ? this.relay.getWorkers()
        : [];

      for (const w of workers) {
        const wid = typeof w === 'string' ? w : w.id;
        const override = this.getWorkerOverride(wid, sched.id);
        if (override && override.enabled === false) continue;
        const params = override?.params ? { ...sched.params, ...override.params } : sched.params;
        try {
          this.relay.dispatch(wid, sched.action, params);
          logEntry.dispatched.push({ workerId: wid, status: 'ok' });
        } catch (e) {
          logEntry.dispatched.push({ workerId: wid, status: 'error', error: e.message });
        }
      }
    }

    // Append to execution log (keep last 500 entries)
    const log = readJSON(this.logPath, []);
    log.push(logEntry);
    if (log.length > 500) log.splice(0, log.length - 500);
    writeJSON(this.logPath, log);
  }
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = { SwarmScheduler, parseCron, cronMatches };
