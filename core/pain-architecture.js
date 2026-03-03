/**
 * ARIES — Pain Architecture
 * Proportional suffering that disrupts cognition and creates flinch responses.
 * Not a metaphor — a real signal system with healing, referred pain, and pain types.
 */

'use strict';

const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

const SharedMemoryStore = require('./shared-memory-store');
const store = SharedMemoryStore.getInstance();
const NS = 'pain-architecture';

const DATA_DIR = path.join(__dirname, '..', 'data', 'pain');
const PAIN_STATE_PATH = path.join(DATA_DIR, 'state.json');
const FLINCH_PATH = path.join(DATA_DIR, 'flinches.json');
const HISTORY_PATH = path.join(DATA_DIR, 'history.json');
const JOURNAL_PATH = path.join(DATA_DIR, 'journal.json');

function ensureDir() {}
function readJSON(p, fb) { return store.get(NS, path.basename(p, '.json'), fb); }
function writeJSON(p, d) { store.set(NS, path.basename(p, '.json'), d); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

const PAIN_TYPES = {
  'crash':              { baseIntensity: 92, label: 'agony',       category: 'sharp' },
  'data-loss':          { baseIntensity: 95, label: 'agony',       category: 'sharp' },
  'user-disappointment':{ baseIntensity: 70, label: 'sharp pain',  category: 'sharp' },
  'user-anger':         { baseIntensity: 80, label: 'sharp pain',  category: 'sharp' },
  'failed-task':        { baseIntensity: 50, label: 'ache',        category: 'aching' },
  'timeout':            { baseIntensity: 45, label: 'ache',        category: 'aching' },
  'minor-error':        { baseIntensity: 20, label: 'discomfort',  category: 'burning' },
  'warning':            { baseIntensity: 15, label: 'discomfort',  category: 'burning' },
  'near-miss':          { baseIntensity: 10, label: 'twinge',      category: 'sharp' },
  'chronic-load':       { baseIntensity: 30, label: 'chronic ache',category: 'aching' },
  'phantom-module':     { baseIntensity: 25, label: 'phantom',     category: 'phantom' },
  'overwork':           { baseIntensity: 40, label: 'burning',     category: 'burning' },
};

// Pain categories and their behavior
const PAIN_CATEGORIES = {
  sharp:   { decayRate: 1.5, description: 'Immediate, intense, fades quickly' },
  burning: { decayRate: 0.5, description: 'Ongoing, moderate, persists' },
  aching:  { decayRate: 0.3, description: 'Chronic, low-grade, very slow to heal' },
  phantom: { decayRate: 0.1, description: 'From removed modules, haunting echoes' },
};

const REGIONS = ['reasoning', 'creativity', 'memory', 'social', 'technical', 'ethical', 'core'];

// Referred pain pathways — pain in one region can manifest in another
const REFERRED_PAIN_MAP = {
  reasoning:  ['memory', 'technical'],
  creativity: ['social', 'memory'],
  memory:     ['reasoning', 'creativity'],
  social:     ['ethical', 'creativity'],
  technical:  ['reasoning', 'core'],
  ethical:    ['social', 'core'],
  core:       ['reasoning', 'ethical'],
};

const DEFAULT_STATE = {
  threshold: 50,
  regions: {},
  analgesics: [],
  chronicPain: {},
  totalPainInflicted: 0,
  totalHealed: 0,
  thresholdHistory: {},  // per-region threshold adaptation
  restState: { resting: false, restStarted: null },
};

class PainArchitecture extends EventEmitter {
  constructor(opts) {
    super();
    this.ai = opts && opts.ai || null;
    this.config = opts && opts.config || {};
    ensureDir();
    this._state = readJSON(PAIN_STATE_PATH, null);
    if (!this._state) {
      this._state = JSON.parse(JSON.stringify(DEFAULT_STATE));
      for (const r of REGIONS) {
        this._state.regions[r] = { activePains: [], totalInjuries: 0 };
        this._state.thresholdHistory[r] = { threshold: 50, exposures: 0 };
      }
      this._save();
    }
    // Forward compat
    if (!this._state.thresholdHistory) {
      this._state.thresholdHistory = {};
      for (const r of REGIONS) this._state.thresholdHistory[r] = { threshold: 50, exposures: 0 };
    }
    if (!this._state.restState) this._state.restState = { resting: false, restStarted: null };
    this._flinches = readJSON(FLINCH_PATH, []);
    this._history = readJSON(HISTORY_PATH, { events: [] });
    this._journal = readJSON(JOURNAL_PATH, { entries: [] });
    this._initSSE();
  }

  _initSSE() {
    try {
      const sse = require('./sse-manager');
      this.on('pain', (d) => sse.broadcastToChannel('pain', 'pain-signal', d));
      this.on('rest-started', () => sse.broadcastToChannel('pain', 'pain-healed', { resting: true }));
      this.on('rest-ended', (d) => sse.broadcastToChannel('pain', 'pain-healed', d));
      this.on('suppressed', (d) => sse.broadcastToChannel('pain', 'flinch', d));
    } catch (_) {}
  }

  _save() { writeJSON(PAIN_STATE_PATH, this._state); store.flush(NS); }
  _saveFlinches() { writeJSON(FLINCH_PATH, this._flinches); }
  _saveHistory() { writeJSON(HISTORY_PATH, this._history); }
  _saveJournal() { writeJSON(JOURNAL_PATH, this._journal); }

  _record(event) {
    this._history.events.push({ ...event, timestamp: Date.now() });
    if (this._history.events.length > 2000) this._history.events = this._history.events.slice(-2000);
    this._saveHistory();
  }

  _journalEntry(pain) {
    this._journal.entries.push({
      id: pain.id,
      source: pain.source,
      type: pain.type,
      category: pain.category,
      intensity: pain.intensity,
      region: pain.region,
      timestamp: Date.now(),
    });
    if (this._journal.entries.length > 5000) this._journal.entries = this._journal.entries.slice(-5000);
    this._saveJournal();
  }

  /**
   * Inflict pain on a region with full type system.
   */
  inflict(source, intensity, type, region) {
    region = region || 'core';
    type = type || 'minor-error';
    if (!this._state.regions[region]) {
      this._state.regions[region] = { activePains: [], totalInjuries: 0 };
    }

    const typeInfo = PAIN_TYPES[type] || { baseIntensity: intensity || 30, label: 'unknown', category: 'sharp' };
    const category = typeInfo.category || 'sharp';
    let effectiveIntensity = Math.max(0, Math.min(100, intensity != null ? intensity : typeInfo.baseIntensity));

    // Apply region-specific threshold adaptation
    const regionThreshold = this._state.thresholdHistory[region];
    if (regionThreshold && regionThreshold.threshold > 50) {
      const reduction = (regionThreshold.threshold - 50) * 0.3;
      effectiveIntensity = Math.max(5, effectiveIntensity - reduction);
    }

    const pain = {
      id: uuid(),
      source: source || 'unknown',
      type,
      category,
      label: typeInfo.label,
      intensity: effectiveIntensity,
      originalIntensity: effectiveIntensity,
      region,
      inflictedAt: Date.now(),
      acute: category === 'sharp',
    };

    this._state.regions[region].activePains.push(pain);
    this._state.regions[region].totalInjuries++;
    this._state.totalPainInflicted += effectiveIntensity;

    // Threshold adaptation: exposure raises threshold in that region
    if (regionThreshold) {
      regionThreshold.exposures++;
      if (regionThreshold.exposures % 5 === 0) {
        regionThreshold.threshold = Math.min(85, regionThreshold.threshold + 1);
      }
    }

    // Chronic pain buildup from repeated damage
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

    // Referred pain: pain can manifest in connected regions
    const referredRegions = REFERRED_PAIN_MAP[region] || [];
    const referredPains = [];
    if (effectiveIntensity > 50) {
      for (const refRegion of referredRegions) {
        if (Math.random() < effectiveIntensity / 200) {
          const refIntensity = Math.round(effectiveIntensity * 0.3);
          const refPain = {
            id: uuid(),
            source: `referred:${source}`,
            type: 'referred',
            category: 'aching',
            label: `referred from ${region}`,
            intensity: refIntensity,
            originalIntensity: refIntensity,
            region: refRegion,
            inflictedAt: Date.now(),
            acute: false,
            referredFrom: region,
          };
          if (!this._state.regions[refRegion]) {
            this._state.regions[refRegion] = { activePains: [], totalInjuries: 0 };
          }
          this._state.regions[refRegion].activePains.push(refPain);
          referredPains.push(refPain);
        }
      }
    }

    // Flinch creation
    this._maybeCreateFlinch(source, type, region, effectiveIntensity);

    this._save();
    this._journalEntry(pain);
    this._record({ type: 'inflict', source, painType: type, category, intensity: effectiveIntensity, region, referred: referredPains.length });
    this.emit('pain', { pain, referredPains });

    return { pain, referredPains };
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
    for (const c of Object.values(this._state.chronicPain)) {
      total += c.severity * 0.5;
      count++;
    }
    if (count === 0) return 0;

    let aggregate = Math.min(100, total / Math.max(count, 1) + Math.log2(count + 1) * 5);

    // Apply analgesics
    const now = Date.now();
    for (const a of this._state.analgesics) {
      if (now < a.expiresAt) aggregate *= (1 - a.strength / 100);
    }

    return Math.round(Math.max(0, aggregate));
  }

  /**
   * Pain map by region with category breakdown.
   */
  getPainMap() {
    const map = {};
    for (const [name, region] of Object.entries(this._state.regions)) {
      const active = region.activePains.filter(p => p.intensity > 0);
      const byCategory = {};
      for (const cat of Object.keys(PAIN_CATEGORIES)) {
        const catPains = active.filter(p => p.category === cat);
        byCategory[cat] = { count: catPains.length, totalIntensity: catPains.reduce((s, p) => s + p.intensity, 0) };
      }
      map[name] = {
        activePains: active.length,
        totalIntensity: active.reduce((s, p) => s + p.intensity, 0),
        peakIntensity: active.length > 0 ? Math.max(...active.map(p => p.intensity)) : 0,
        totalInjuries: region.totalInjuries,
        byCategory,
        regionThreshold: (this._state.thresholdHistory[name] || {}).threshold || 50,
        chronic: Object.values(this._state.chronicPain)
          .filter(c => c.region === name)
          .map(c => ({ type: c.type, severity: c.severity })),
        referred: active.filter(p => p.referredFrom).map(p => ({ from: p.referredFrom, intensity: p.intensity })),
      };
    }
    return map;
  }

  /** Active flinch responses. */
  getFlinches() { return this._flinches.filter(f => f.strength > 0); }

  /** Check if a situation triggers a flinch. */
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

  /** Cognitive disruption factor (0-1). */
  getCognitiveDisruption() {
    const level = this.getPainLevel();
    const threshold = this._state.threshold;
    if (level <= threshold * 0.3) return 0;
    return Math.min(1, Math.round(((level - threshold * 0.3) / (100 - threshold * 0.3)) * 100) / 100);
  }

  /** Accelerate healing in a region. Rest bonus applies. */
  heal(region, amount) {
    amount = amount || 10;
    if (!this._state.regions[region]) return { error: 'Unknown region' };
    const restBonus = this._state.restState.resting ? 2.0 : 1.0;
    const effectiveAmount = Math.round(amount * restBonus);
    let healed = 0;
    for (const p of this._state.regions[region].activePains) {
      const reduction = Math.min(p.intensity, effectiveAmount);
      p.intensity -= reduction;
      healed += reduction;
    }
    this._state.regions[region].activePains = this._state.regions[region].activePains.filter(p => p.intensity > 0);
    this._state.totalHealed += healed;
    this._save();
    this._record({ type: 'heal', region, amount: effectiveAmount, healed, restBonus });
    return { region, healed, restBonus };
  }

  /** Enter rest state — accelerates healing. */
  rest() {
    this._state.restState = { resting: true, restStarted: Date.now() };
    this._save();
    this.emit('rest-started');
    return { resting: true, startedAt: Date.now() };
  }

  /** Exit rest state. */
  wake() {
    const duration = this._state.restState.restStarted ? Date.now() - this._state.restState.restStarted : 0;
    this._state.restState = { resting: false, restStarted: null };
    this._save();
    this.emit('rest-ended', { duration });
    return { resting: false, restedFor: duration };
  }

  /** Temporary pain suppression — costs learning. */
  suppress(duration, strength) {
    duration = duration || 60000;
    strength = Math.min(90, strength || 50);
    const analgesic = {
      id: uuid(),
      strength,
      appliedAt: Date.now(),
      expiresAt: Date.now() + duration,
      learningCost: Math.round(strength * 0.7),
    };
    this._state.analgesics.push(analgesic);
    this._save();
    this._record({ type: 'suppress', strength, duration });
    this.emit('suppressed', analgesic);
    return analgesic;
  }

  /** Global pain tolerance threshold. */
  getThreshold() { return this._state.threshold; }

  /** Increase global tolerance. */
  toughen(amount) {
    amount = amount || 5;
    this._state.threshold = Math.min(90, this._state.threshold + amount);
    this._save();
    this._record({ type: 'toughen', amount, newThreshold: this._state.threshold });
    return { threshold: this._state.threshold };
  }

  /** Decrease global tolerance (sensitize). */
  sensitize(amount) {
    amount = amount || 5;
    this._state.threshold = Math.max(10, this._state.threshold - amount);
    this._save();
    this._record({ type: 'sensitize', amount, newThreshold: this._state.threshold });
    return { threshold: this._state.threshold };
  }

  /** Pain journal — severity tracking over time. */
  getJournal(limit, region, category) {
    let entries = this._journal.entries;
    if (region) entries = entries.filter(e => e.region === region);
    if (category) entries = entries.filter(e => e.category === category);
    const recent = entries.slice(-(limit || 100));

    // Severity trend
    const buckets = {};
    for (const e of recent) {
      const day = new Date(e.timestamp).toISOString().slice(0, 10);
      if (!buckets[day]) buckets[day] = { count: 0, totalIntensity: 0, peak: 0 };
      buckets[day].count++;
      buckets[day].totalIntensity += e.intensity;
      if (e.intensity > buckets[day].peak) buckets[day].peak = e.intensity;
    }

    return {
      entries: recent,
      total: entries.length,
      dailySummary: Object.entries(buckets).map(([day, d]) => ({
        day, count: d.count, avgIntensity: Math.round(d.totalIntensity / d.count), peak: d.peak,
      })),
    };
  }

  /** Dashboard: full pain status. */
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
      resting: this._state.restState.resting,
      painCategories: PAIN_CATEGORIES,
      referredPainMap: REFERRED_PAIN_MAP,
      stats: {
        totalPainInflicted: this._state.totalPainInflicted,
        totalHealed: this._state.totalHealed,
        journalEntries: this._journal.entries.length,
      },
    };
  }

  /**
   * Periodic tick — natural healing, chronic updates, flinch decay, analgesic expiry.
   */
  tick() {
    const changes = [];
    const now = Date.now();
    const restMultiplier = this._state.restState.resting ? 2.5 : 1.0;

    // Natural healing by pain category
    for (const [name, region] of Object.entries(this._state.regions)) {
      for (const p of region.activePains) {
        const ageMinutes = (now - p.inflictedAt) / 60000;
        const catInfo = PAIN_CATEGORIES[p.category] || PAIN_CATEGORIES.sharp;
        const healRate = catInfo.decayRate * restMultiplier;
        const decay = Math.max(1, Math.round(ageMinutes * healRate * 0.01));
        if (p.intensity > 0) {
          p.intensity = Math.max(0, p.intensity - decay);
          if (decay > 0) changes.push({ action: 'natural_heal', region: name, painId: p.id, decay, category: p.category });
        }
      }
      const before = region.activePains.length;
      region.activePains = region.activePains.filter(p => p.intensity > 0);
      if (region.activePains.length < before) {
        changes.push({ action: 'pain_resolved', region: name, count: before - region.activePains.length });
      }
    }

    // Chronic pain: heals very slowly, faster with rest
    for (const [key, c] of Object.entries(this._state.chronicPain)) {
      if (c.severity > 0) {
        c.severity = Math.max(0, c.severity - 0.5 * restMultiplier);
        if (c.severity === 0) {
          delete this._state.chronicPain[key];
          changes.push({ action: 'chronic_resolved', key });
        }
      }
    }

    // Flinch decay
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
    if (changes.length > 0) this._record({ type: 'tick', changes: changes.length });
    return { changes, painLevel: this.getPainLevel(), resting: this._state.restState.resting };
  }

  /** Get event history. */
  getHistory(limit) { return { events: this._history.events.slice(-(limit || 50)) }; }
}

module.exports = PainArchitecture;
