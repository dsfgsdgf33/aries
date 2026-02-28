/**
 * ARIES — Circulatory System
 * Continuous shared state flowing to ALL modules. The bloodstream of information.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'circulatory');
const CURRENT_PATH = path.join(DATA_DIR, 'current.json');
const HISTORY_PATH = path.join(DATA_DIR, 'history.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }

const BLOODSTREAM_KEYS = [
  'emotion', 'thought', 'perception', 'drive', 'persona', 'rhythm',
  'flow', 'weather', 'empathy', 'attention', 'gestalt', 'time', 'health'
];

function makeDefault() {
  const now = Date.now();
  return {
    emotion: { state: 'neutral', intensity: 0, timestamp: now },
    thought: { current: 'idle', type: 'observation', timestamp: now },
    perception: { activeWindow: null, recentChanges: [], audioState: 'silent', timestamp: now },
    drive: { dominant: 'curiosity', strength: 50, timestamp: now },
    persona: { active: 'default', traits: [], timestamp: now },
    rhythm: { current: 'normal', hints: [], timestamp: now },
    flow: { state: 'idle', score: 0, timestamp: now },
    weather: { type: 'clear', advisory: 'All systems nominal', timestamp: now },
    empathy: { userMood: 'unknown', engagement: 0, timestamp: now },
    attention: { spotlight: null, budget: 100, timestamp: now },
    gestalt: { coherence: 100, tension: 0, mood: 'stable', timestamp: now },
    time: { pace: 'normal', urgency: 0, sessionDuration: 0, timestamp: now },
    health: { memory: 0, cpu: 0, errors: 0, timestamp: now }
  };
}

class CirculatorySystem {
  constructor() {
    ensureDir();
    this._bloodstream = readJSON(CURRENT_PATH, null) || makeDefault();
    this._history = readJSON(HISTORY_PATH, []);
    this._subscribers = {}; // key -> Set<callback>
    this._eventCount = 0;
    this._startedAt = Date.now();
    this._pumpInterval = null;
    this._historyInterval = null;
    this._startPumping();
  }

  _startPumping() {
    // Pump every 5 seconds
    this._pumpInterval = setInterval(() => this.pump(), 5000);
    if (this._pumpInterval.unref) this._pumpInterval.unref();
    // Save history snapshot every 60 seconds
    this._historyInterval = setInterval(() => this._saveHistorySnapshot(), 60000);
    if (this._historyInterval.unref) this._historyInterval.unref();
  }

  stop() {
    if (this._pumpInterval) { clearInterval(this._pumpInterval); this._pumpInterval = null; }
    if (this._historyInterval) { clearInterval(this._historyInterval); this._historyInterval = null; }
  }

  pump() {
    const now = Date.now();
    // Poll system health
    try {
      const mem = process.memoryUsage();
      const cpu = process.cpuUsage ? process.cpuUsage() : { user: 0, system: 0 };
      this.inject('health', {
        memory: Math.round(mem.rss / 1024 / 1024),
        cpu: Math.round((cpu.user + cpu.system) / 1000),
        errors: this._bloodstream.health ? this._bloodstream.health.errors : 0,
        timestamp: now
      });
    } catch (_) {}

    // Update time
    this.inject('time', {
      pace: this._bloodstream.time ? this._bloodstream.time.pace : 'normal',
      urgency: this._bloodstream.time ? this._bloodstream.time.urgency : 0,
      sessionDuration: Math.round((now - this._startedAt) / 1000),
      timestamp: now
    });

    // Try to poll other modules (safe failures)
    this._pollModules();

    this._eventCount++;
    writeJSON(CURRENT_PATH, this._bloodstream);
    return { pumped: true, timestamp: now, eventCount: this._eventCount };
  }

  _pollModules() {
    const now = Date.now();
    // Attempt to read from known modules — all wrapped in try/catch
    const modulePaths = {
      emotion: './emotional-engine',
      rhythm: './cognitive-rhythms',
      flow: './flow-state',
      weather: './cognitive-weather',
      drive: './drive-system',
      gestalt: './gestalt-engine',
      attention: './attention-system',
      empathy: './user-empathy',
      persona: './persona-forking',
      thought: './inner-monologue'
    };

    for (const [key, modPath] of Object.entries(modulePaths)) {
      try {
        const Mod = require(modPath);
        const inst = typeof Mod.getInstance === 'function' ? Mod.getInstance() : new Mod();
        let data = null;

        if (key === 'emotion' && inst.getState) {
          const s = inst.getState();
          data = { state: s.dominant || s.state || 'neutral', intensity: s.intensity || 0, timestamp: now };
        } else if (key === 'rhythm' && inst.getCurrentRhythm) {
          const r = inst.getCurrentRhythm();
          data = { current: r.rhythm || r.current || 'normal', hints: r.hints || [], timestamp: now };
        } else if (key === 'flow' && (inst.getFlowState || inst.getFlowScore)) {
          const f = inst.getFlowState ? inst.getFlowState() : inst.getFlowScore();
          data = { state: f.state || 'idle', score: f.score || f.flowScore || 0, timestamp: now };
        } else if (key === 'weather' && inst.getCurrentWeather) {
          const w = inst.getCurrentWeather();
          data = { type: w.type || w.weather || 'clear', advisory: w.advisory || '', timestamp: now };
        } else if (key === 'drive' && (inst.getDominantDrive || inst.getActiveDrives)) {
          const d = inst.getDominantDrive ? inst.getDominantDrive() : {};
          data = { dominant: d.name || d.drive || 'curiosity', strength: d.strength || d.intensity || 50, timestamp: now };
        } else if (key === 'gestalt' && (inst.getCoherence || inst.getState)) {
          const g = inst.getCoherence ? inst.getCoherence() : inst.getState();
          data = { coherence: g.coherence || 100, tension: g.tension || 0, mood: g.mood || 'stable', timestamp: now };
        } else if (key === 'attention' && inst.getSpotlight) {
          const a = inst.getSpotlight();
          data = { spotlight: a.target || a.spotlight || null, budget: a.budget || a.remaining || 100, timestamp: now };
        } else if (key === 'empathy' && inst.getUserState) {
          const e = inst.getUserState();
          data = { userMood: e.mood || e.userMood || 'unknown', engagement: e.engagement || 0, timestamp: now };
        } else if (key === 'persona' && (inst.getCurrentPersona || inst.listPersonas)) {
          const p = inst.getCurrentPersona ? inst.getCurrentPersona() : {};
          data = { active: p.name || p.id || 'default', traits: p.traits || [], timestamp: now };
        } else if (key === 'thought' && (inst.getThoughtStream || inst.getStats)) {
          const t = inst.getStats ? inst.getStats() : {};
          data = { current: t.lastThought || t.current || 'idle', type: t.lastType || 'observation', timestamp: now };
        }

        if (data) this.inject(key, data);
      } catch (_) { /* module not available, keep last known state */ }
    }
  }

  _saveHistorySnapshot() {
    this._history.push({ ...this._bloodstream, _snapshotAt: Date.now() });
    if (this._history.length > 500) this._history = this._history.slice(-250);
    writeJSON(HISTORY_PATH, this._history);
  }

  getBloodstream() {
    return { ...this._bloodstream };
  }

  get(key) {
    return this._bloodstream[key] || null;
  }

  inject(key, value) {
    const prev = this._bloodstream[key];
    this._bloodstream[key] = { ...value, timestamp: value.timestamp || Date.now() };
    this._eventCount++;

    // Notify subscribers
    if (this._subscribers[key]) {
      for (const cb of this._subscribers[key]) {
        try { cb(this._bloodstream[key], prev); } catch (_) {}
      }
    }
    return { injected: true, key, timestamp: Date.now() };
  }

  getFlowRate() {
    const elapsed = (Date.now() - this._startedAt) / 1000;
    return {
      eventsPerSecond: elapsed > 0 ? Math.round(this._eventCount / elapsed * 100) / 100 : 0,
      totalEvents: this._eventCount,
      uptimeSeconds: Math.round(elapsed)
    };
  }

  getOxygenLevel() {
    const now = Date.now();
    const STALE_THRESHOLD = 5 * 60 * 1000; // 5 minutes
    let fresh = 0;
    let total = 0;
    const stale = [];

    for (const key of BLOODSTREAM_KEYS) {
      total++;
      const val = this._bloodstream[key];
      if (val && val.timestamp && (now - val.timestamp) < STALE_THRESHOLD) {
        fresh++;
      } else {
        stale.push({ key, lastUpdate: val ? val.timestamp : null, ageMs: val ? now - val.timestamp : null });
      }
    }

    const level = total > 0 ? Math.round(fresh / total * 100) : 0;
    return {
      oxygenLevel: level,
      fresh,
      total,
      stale,
      status: level >= 80 ? 'healthy' : level >= 50 ? 'low' : 'critical'
    };
  }

  getCirculationHistory(limit) {
    const l = limit || 20;
    return this._history.slice(-l).reverse();
  }

  subscribe(key, callback) {
    if (!this._subscribers[key]) this._subscribers[key] = new Set();
    this._subscribers[key].add(callback);
    return { subscribed: key };
  }

  unsubscribe(key, callback) {
    if (this._subscribers[key]) this._subscribers[key].delete(callback);
  }
}

module.exports = CirculatorySystem;
