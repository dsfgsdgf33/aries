/**
 * ARIES — Pain Architecture
 * Proportional suffering that disrupts cognition and creates flinch responses.
 * Not a metaphor — a real signal system.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'pain');
const PAIN_STATE_PATH = path.join(DATA_DIR, 'state.json');
const FLINCH_PATH = path.join(DATA_DIR, 'flinches.json');
const HISTORY_PATH = path.join(DATA_DIR, 'history.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

const PAIN_TYPES = {
  'crash':              { baseIntensity: 92, label: 'agony' },
  'data-loss':          { baseIntensity: 95, label: 'agony' },
  'user-disappointment':{ baseIntensity: 70, label: 'sharp pain' },
  'user-anger':         { baseIntensity: 80, label: 'sharp pain' },
  'failed-task':        { baseIntensity: 50, label: 'ache' },
  'timeout':            { baseIntensity: 45, label: 'ache' },
  'minor-error':        { baseIntensity: 20, label: 'discomfort' },
  'warning':            { baseIntensity: 15, label: 'discomfort' },
  'near-miss':          { baseIntensity: 10, label: 'twinge' },
};

const REGIONS = ['reasoning', 'creativity', 'memory', 'social', 'technical', 'ethical', 'core'];

const DEFAULT_STATE = {
  threshold: 50,
  regions: {},
  analgesics: [],
  chronicPain: {},
  totalPainInflicted: 0,
  totalHealed: 0,
};

class PainArchitecture {
  constructor(opts) {
    this.ai = opts && opts.ai || null;
    this.config = opts && opts.config || {};
    ensureDir();
    this._state = readJSON(PAIN_STATE_PATH, null);
    if (!this._state) {
      this._state = JSON.parse(JSON.stringify(DEFAULT_STATE));
      for (const r of REGIONS) {
        this._state.regions[r] = { activePains: [], totalInjuries: 0 };
      }
      this._save();
    }
    this._flinches = readJSON(FLINCH_PATH, []);
    this._history = readJSON(HISTORY_PATH, { events: [] });
  }

  _save() { writeJSON(PAIN_STATE_PATH, this._state); }
  _saveFlinches() { writeJSON(FLINCH_PATH, this._flinches); }
  _saveHistory() { writeJSON(HISTORY_PATH, this._history); }

  _record(event) {
    this._history.events.push({ ...event, timestamp: Date.now() });
    if (this._history.events.length > 2000) this._history.events = this._history.events.slice(-2000);
    this._saveHistory();
  }

  /**
   * Inflict pain on a region.
   */
  inflict(source, intensity, type, region) {
    region = region || 'core';
    type = type || 'minor-error';
    if (!this._state.regions[region]) {
      this._state.regions[region] = { activePains: [], totalInjuries: 0 };
    }

    const typeInfo = PAIN_TYPES[type] || { baseIntensity: intensity || 30, label: 'unknown' };
    const effectiveIntensity = Math.max(0, Math.min(100, intensity != null ? intensity : typeInfo.baseIntensity));

    const pain = {
      id: uuid(),
      source: source || 'unknown',
      type,
      label: typeInfo.label,
      intensity: effectiveIntensity,
      originalIntensity: effectiveIntensity,
      region,
      inflictedAt: Date.now(),
      acute: true,
    };

    this._state.regions[region].activePains.push(pain);
    this._state.regions[region].totalInjuries++;
    this._state.totalPainInflicted += effectiveIntensity;

    // Check for chronic pain buildup
    const recentInRegion = this._state.regions[region].activePains.filter(
      p => Date.now() - p.inflictedAt < 24 * 60 * 60 * 1000
    );
    if (recentInRegion.length >= 3) {
      const key = `${region}:${type}`;
      if (!this._state.chronicPain[key]) {
        this._state.chronicPain[key] = { region, type, severity: 0, onsetAt: Date.now(), injuries: 0 };
      }
      this._state.chronicPain[key].severity = Math.min(100, this._state.chronicPain[key].severity + 5);
      this._state.chronicPain[key].injuries++;
    }

    // Check for flinch creation
    this._maybeCreateFlinch(source, type, region, effectiveIntensity);

    this._save();
    this._record({ type: 'inflict', source, painType: type, intensity: effectiveIntensity, region });

    return pain;
  }

  _maybeCreateFlinch(source, type, region, intensity) {
    if (intensity < 40) return;
    const existing = this._flinches.find(f => f.source === source && f.region === region);
    if (existing) {
      existing.strength = Math.min(100, existing.strength + 10);
      existing.triggers++;
      existing.lastTriggered = Date.now();
    } else {
      this._flinches.push({
        id: uuid(),
        source,
        type,
        region,
        strength: Math.min(100, Math.round(intensity * 0.6)),
        triggers: 1,
        createdAt: Date.now(),
        lastTriggered: Date.now(),
      });
    }
    this._saveFlinches();
  }

  /**
   * Current aggregate pain level (0-100), accounting for analgesics and threshold.
   */
  getPainLevel() {
    let total = 0;
    let count = 0;
    for (const r of Object.values(this._state.regions)) {
      for (const p of r.activePains) {
        total += p.intensity;
        count++;
      }
    }
    // Add chronic pain
    for (const c of Object.values(this._state.chronicPain)) {
      total += c.severity * 0.5;
      count++;
    }
    if (count === 0) return 0;

    let aggregate = Math.min(100, total / Math.max(count, 1) + Math.log2(count + 1) * 5);

    // Apply analgesics
    const now = Date.now();
    for (const a of this._state.analgesics) {
      if (now < a.expiresAt) {
        aggregate *= (1 - a.strength / 100);
      }
    }

    return Math.round(Math.max(0, aggregate));
  }

  /**
   * Pain map by region.
   */
  getPainMap() {
    const map = {};
    for (const [name, region] of Object.entries(this._state.regions)) {
      const active = region.activePains.filter(p => p.intensity > 0);
      map[name] = {
        activePains: active.length,
        totalIntensity: active.reduce((s, p) => s + p.intensity, 0),
        peakIntensity: active.length > 0 ? Math.max(...active.map(p => p.intensity)) : 0,
        totalInjuries: region.totalInjuries,
        chronic: Object.values(this._state.chronicPain)
          .filter(c => c.region === name)
          .map(c => ({ type: c.type, severity: c.severity })),
      };
    }
    return map;
  }

  /**
   * Active flinch responses.
   */
  getFlinches() {
    return this._flinches.filter(f => f.strength > 0);
  }

  /**
   * Check if a situation triggers a flinch.
   */
  checkFlinch(source, region) {
    const matches = this._flinches.filter(f =>
      f.strength > 0 && (f.source === source || f.region === region)
    );
    if (matches.length === 0) return { flinch: false };
    const strongest = matches.sort((a, b) => b.strength - a.strength)[0];
    return {
      flinch: true,
      strength: strongest.strength,
      source: strongest.source,
      region: strongest.region,
      recommendation: strongest.strength > 70 ? 'AVOID' : strongest.strength > 40 ? 'CAUTION' : 'MILD_HESITATION',
    };
  }

  /**
   * Cognitive disruption factor (0-1). Higher = more disrupted.
   */
  getCognitiveDisruption() {
    const level = this.getPainLevel();
    const threshold = this._state.threshold;
    if (level <= threshold * 0.3) return 0;
    return Math.min(1, Math.round(((level - threshold * 0.3) / (100 - threshold * 0.3)) * 100) / 100);
  }

  /**
   * Accelerate healing in a region.
   */
  heal(region, amount) {
    amount = amount || 10;
    if (!this._state.regions[region]) return { error: 'Unknown region' };
    let healed = 0;
    for (const p of this._state.regions[region].activePains) {
      const reduction = Math.min(p.intensity, amount);
      p.intensity -= reduction;
      healed += reduction;
    }
    // Clean up fully healed
    this._state.regions[region].activePains = this._state.regions[region].activePains.filter(p => p.intensity > 0);
    this._state.totalHealed += healed;
    this._save();
    this._record({ type: 'heal', region, amount, healed });
    return { region, healed };
  }

  /**
   * Temporary pain suppression.
   */
  suppress(duration, strength) {
    duration = duration || 60000;
    strength = Math.min(90, strength || 50); // Can't fully suppress
    const analgesic = {
      id: uuid(),
      strength,
      appliedAt: Date.now(),
      expiresAt: Date.now() + duration,
      learningCost: Math.round(strength * 0.7), // % of learning from pain that's lost
    };
    this._state.analgesics.push(analgesic);
    this._save();
    this._record({ type: 'suppress', strength, duration });
    return analgesic;
  }

  /**
   * Current pain tolerance threshold.
   */
  getThreshold() {
    return this._state.threshold;
  }

  /**
   * Increase pain tolerance.
   */
  toughen(amount) {
    amount = amount || 5;
    this._state.threshold = Math.min(90, this._state.threshold + amount);
    this._save();
    this._record({ type: 'toughen', amount, newThreshold: this._state.threshold });
    return { threshold: this._state.threshold };
  }

  /**
   * Decrease pain tolerance (sensitize).
   */
  sensitize(amount) {
    amount = amount || 5;
    this._state.threshold = Math.max(10, this._state.threshold - amount);
    this._save();
    this._record({ type: 'sensitize', amount, newThreshold: this._state.threshold });
    return { threshold: this._state.threshold };
  }

  /**
   * Dashboard: full pain status.
   */
  getDashboard() {
    return {
      aggregatePain: this.getPainLevel(),
      cognitiveDisruption: this.getCognitiveDisruption(),
      threshold: this._state.threshold,
      painMap: this.getPainMap(),
      activeFlinches: this.getFlinches().length,
      flinches: this.getFlinches().slice(0, 10),
      chronicConditions: Object.values(this._state.chronicPain).filter(c => c.severity > 0),
      activeAnalgesics: this._state.analgesics.filter(a => Date.now() < a.expiresAt),
      stats: {
        totalPainInflicted: this._state.totalPainInflicted,
        totalHealed: this._state.totalHealed,
      },
    };
  }

  /**
   * Periodic tick — natural healing, chronic updates, flinch decay, analgesic expiry.
   */
  tick() {
    const changes = [];
    const now = Date.now();

    // Natural healing: acute pain fades
    for (const [name, region] of Object.entries(this._state.regions)) {
      for (const p of region.activePains) {
        const ageMinutes = (now - p.inflictedAt) / 60000;
        const healRate = p.acute ? 0.5 : 0.1; // Acute heals faster
        const decay = Math.max(1, Math.round(ageMinutes * healRate * 0.01));
        if (p.intensity > 0) {
          p.intensity = Math.max(0, p.intensity - decay);
          if (decay > 0) changes.push({ action: 'natural_heal', region: name, painId: p.id, decay });
        }
      }
      // Remove fully healed
      const before = region.activePains.length;
      region.activePains = region.activePains.filter(p => p.intensity > 0);
      if (region.activePains.length < before) {
        changes.push({ action: 'pain_resolved', region: name, count: before - region.activePains.length });
      }
    }

    // Chronic pain: heals very slowly
    for (const [key, c] of Object.entries(this._state.chronicPain)) {
      if (c.severity > 0) {
        c.severity = Math.max(0, c.severity - 0.5);
        if (c.severity === 0) {
          delete this._state.chronicPain[key];
          changes.push({ action: 'chronic_resolved', key });
        }
      }
    }

    // Flinch decay: slow fade
    for (const f of this._flinches) {
      const daysSince = (now - f.lastTriggered) / (24 * 60 * 60 * 1000);
      if (daysSince > 3 && f.strength > 0) {
        f.strength = Math.max(0, f.strength - 1);
        changes.push({ action: 'flinch_decay', source: f.source, newStrength: f.strength });
      }
    }
    this._flinches = this._flinches.filter(f => f.strength > 0);
    this._saveFlinches();

    // Expire analgesics
    const beforeA = this._state.analgesics.length;
    this._state.analgesics = this._state.analgesics.filter(a => now < a.expiresAt);
    if (this._state.analgesics.length < beforeA) {
      changes.push({ action: 'analgesic_expired', count: beforeA - this._state.analgesics.length });
    }

    this._save();
    if (changes.length > 0) {
      this._record({ type: 'tick', changes: changes.length });
    }
    return { changes, painLevel: this.getPainLevel() };
  }

  /**
   * Get event history.
   */
  getHistory(limit) {
    return { events: this._history.events.slice(-(limit || 50)) };
  }
}

module.exports = PainArchitecture;
