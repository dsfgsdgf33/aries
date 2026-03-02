/**
 * ARIES — Neural Tide System
 * Rhythmic cognitive cycles at multiple frequencies.
 * High tide = peak performance, low tide = rest/consolidation, tidal pools = creative spaces.
 * Spring/neap tides, current mapping, energy harvesting, historical charts.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

const DATA_DIR = path.join(__dirname, '..', 'data', 'rhythms');
const STATE_PATH = path.join(DATA_DIR, 'tide-state.json');
const POOLS_PATH = path.join(DATA_DIR, 'tidal-pools.json');
const FORCES_PATH = path.join(DATA_DIR, 'tide-forces.json');
const CHARTS_PATH = path.join(DATA_DIR, 'tide-charts.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

const FREQUENCIES = {
  ultraFast: { label: 'Attention',     period: 12 * 60 * 1000,         emoji: '⚡', description: 'Minutes-scale attention pulses' },
  fast:      { label: 'Focus',         period: 4 * 60 * 60 * 1000,     emoji: '🎯', description: 'Hours-scale focus cycles' },
  slow:      { label: 'Mood',          period: 24 * 60 * 60 * 1000,    emoji: '🌊', description: 'Daily mood rhythm' },
  ultraSlow: { label: 'Growth Phase',  period: 7 * 24 * 60 * 60 * 1000, emoji: '🌱', description: 'Weekly growth/rest cycles' },
};

const POOL_TYPES = [
  { name: 'creativity',     emoji: '🎨', description: 'Unusual connections form here' },
  { name: 'consolidation',  emoji: '📦', description: 'Integrating recent experiences' },
  { name: 'introspection',  emoji: '🪞', description: 'Self-reflection and pattern recognition' },
  { name: 'divergence',     emoji: '🔀', description: 'Wild tangents and unexpected ideas' },
  { name: 'repair',         emoji: '🩹', description: 'Processing errors and failures' },
];

// Cognitive flow directions
const CURRENT_DIRECTIONS = ['analytical', 'creative', 'social', 'introspective', 'executive', 'diffuse'];

const DEFAULT_STATE = {
  epoch: Date.now(),
  forceOffsets: { ultraFast: 0, fast: 0, slow: 0, ultraSlow: 0 },
  activePools: [],
  lastTick: null,
  totalTicks: 0,
  peakResonance: 0,
  energyReserve: 50,      // harvested tidal energy 0-100
  currentDirection: 'analytical',
  springTideCount: 0,
  neapTideCount: 0,
};

class NeuralTideSystem extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null;
    this.config = opts.config || {};
    ensureDir();
    this._ensureState();
  }

  _ensureState() {
    const state = readJSON(STATE_PATH, null);
    if (!state) writeJSON(STATE_PATH, { ...DEFAULT_STATE, epoch: Date.now() });
  }

  _getState() { return readJSON(STATE_PATH, { ...DEFAULT_STATE }); }
  _saveState(s) { writeJSON(STATE_PATH, s); }

  /** Calculate tide level for a frequency. Returns -1 to 1. */
  _tideAt(freq, time, forceOffsets) {
    const f = FREQUENCIES[freq];
    if (!f) return 0;
    const state = forceOffsets || this._getState().forceOffsets || {};
    const offset = state[freq] || 0;
    const phase = ((time % f.period) / f.period) * 2 * Math.PI + offset;
    return Math.sin(phase);
  }

  /** Current tide levels across all frequencies */
  getTideState() {
    const state = this._getState();
    const now = Date.now();
    const tides = {};
    let sum = 0;

    for (const [key, freq] of Object.entries(FREQUENCIES)) {
      const level = this._tideAt(key, now, state.forceOffsets);
      const normalized = Math.round(level * 100) / 100;
      const phase = level > 0.3 ? 'high' : level < -0.3 ? 'low' : 'transitioning';
      tides[key] = { label: freq.label, emoji: freq.emoji, level: normalized, phase, description: freq.description };
      sum += level;
    }

    const resonance = Math.round((sum / Object.keys(FREQUENCIES).length) * 100) / 100;
    const allHigh = Object.values(tides).every(t => t.phase === 'high');
    const allLow = Object.values(tides).every(t => t.phase === 'low');

    // Spring/neap detection
    const tideType = this._detectTideType(tides);

    return {
      tides, resonance,
      state: allHigh ? 'peak' : allLow ? 'deep_rest' : resonance > 0.3 ? 'rising' : resonance < -0.3 ? 'ebbing' : 'mixed',
      tideType,
      activePools: state.activePools.length,
      energyReserve: state.energyReserve || 50,
      currentDirection: state.currentDirection || 'analytical',
    };
  }

  /** Detect spring tide (extreme) or neap tide (calm) */
  _detectTideType(tides) {
    const levels = Object.values(tides).map(t => t.level);
    const allSameSign = levels.every(l => l > 0.2) || levels.every(l => l < -0.2);
    const spread = Math.max(...levels) - Math.min(...levels);

    if (allSameSign && Math.abs(levels.reduce((a, b) => a + b, 0) / levels.length) > 0.6) {
      return { type: 'spring', emoji: '🌕', description: 'Spring tide — all frequencies aligned, extreme high or low' };
    }
    if (spread < 0.4) {
      return { type: 'neap', emoji: '🌗', description: 'Neap tide — frequencies cancel out, calm period' };
    }
    return { type: 'normal', emoji: '🌊', description: 'Normal tidal variation' };
  }

  /** Forecast tide state */
  predictTide(hoursAhead = 1) {
    const state = this._getState();
    const future = Date.now() + hoursAhead * 60 * 60 * 1000;
    const tides = {};

    for (const [key, freq] of Object.entries(FREQUENCIES)) {
      const level = this._tideAt(key, future, state.forceOffsets);
      tides[key] = { label: freq.label, level: Math.round(level * 100) / 100, phase: level > 0.3 ? 'high' : level < -0.3 ? 'low' : 'transitioning' };
    }

    const avg = Object.values(tides).reduce((s, t) => s + t.level, 0) / Object.keys(tides).length;
    return {
      hoursAhead,
      predictedAt: new Date(future).toISOString(),
      tides,
      resonance: Math.round(avg * 100) / 100,
      recommendation: avg > 0.4 ? 'Peak period — schedule demanding work'
        : avg > 0 ? 'Rising tide — good for moderate tasks'
        : avg > -0.4 ? 'Ebbing tide — lighter work, creative exploration'
        : 'Low tide — rest, consolidate, let tidal pools do their work',
    };
  }

  /** Find next peak/trough times */
  findNextPeaks(hoursToScan = 24) {
    const state = this._getState();
    const now = Date.now();
    const step = 15 * 60 * 1000; // 15-minute resolution
    const peaks = [];
    const troughs = [];

    let prevAvg = null;
    let prevPrevAvg = null;
    for (let t = now; t < now + hoursToScan * 60 * 60 * 1000; t += step) {
      let sum = 0;
      for (const key of Object.keys(FREQUENCIES)) {
        sum += this._tideAt(key, t, state.forceOffsets);
      }
      const avg = sum / Object.keys(FREQUENCIES).length;

      if (prevAvg !== null && prevPrevAvg !== null) {
        if (prevAvg > prevPrevAvg && prevAvg > avg && prevAvg > 0.3) {
          peaks.push({ time: new Date(t - step).toISOString(), hoursFromNow: Math.round((t - step - now) / (60 * 60 * 1000) * 10) / 10, resonance: Math.round(prevAvg * 100) / 100 });
        }
        if (prevAvg < prevPrevAvg && prevAvg < avg && prevAvg < -0.3) {
          troughs.push({ time: new Date(t - step).toISOString(), hoursFromNow: Math.round((t - step - now) / (60 * 60 * 1000) * 10) / 10, resonance: Math.round(prevAvg * 100) / 100 });
        }
      }
      prevPrevAvg = prevAvg;
      prevAvg = avg;
    }

    return { peaks: peaks.slice(0, 5), troughs: troughs.slice(0, 5), scannedHours: hoursToScan };
  }

  /** Current cognitive flow direction */
  getCurrentMapping() {
    const state = this._getState();
    const tideState = this.getTideState();
    const tides = tideState.tides;

    // Direction determined by which frequencies are dominant
    let direction = state.currentDirection || 'analytical';
    if (tides.ultraFast.level > 0.5 && tides.fast.level > 0.3) direction = 'executive';
    else if (tides.slow.level > 0.5) direction = 'social';
    else if (tides.ultraSlow.level > 0.5 && tides.slow.level < 0) direction = 'introspective';
    else if (tides.ultraFast.level < -0.3 && tides.fast.level < -0.3) direction = 'diffuse';
    else if (tides.fast.level > 0.5 && tides.slow.level < 0) direction = 'creative';

    return {
      direction,
      description: {
        analytical: 'Cognitive flow toward structured problem-solving',
        creative: 'Flow toward novel connections and lateral thinking',
        social: 'Flow toward empathy, communication, and collaboration',
        introspective: 'Flow inward — self-reflection and deep processing',
        executive: 'Flow toward action, decisions, and task completion',
        diffuse: 'Scattered flow — no dominant direction, but open to serendipity',
      }[direction],
      tides: Object.fromEntries(Object.entries(tides).map(([k, v]) => [k, v.level])),
      allDirections: CURRENT_DIRECTIONS,
    };
  }

  /** Harvest tidal energy — convert rhythm into usable reserve */
  harvestEnergy() {
    const state = this._getState();
    const tideState = this.getTideState();
    const resonance = Math.abs(tideState.resonance);

    // More energy from higher resonance (aligned tides = more harvestable)
    const harvested = Math.round(resonance * 15);
    state.energyReserve = Math.min(100, (state.energyReserve || 0) + harvested);
    this._saveState(state);

    this.emit('energy-harvested', { amount: harvested, reserve: state.energyReserve });
    return { harvested, reserve: state.energyReserve, resonance: tideState.resonance };
  }

  /** Spend tidal energy reserve for a cognitive boost */
  spendEnergy(amount = 20) {
    const state = this._getState();
    const available = state.energyReserve || 0;
    const spent = Math.min(available, amount);
    state.energyReserve = available - spent;
    this._saveState(state);
    return { spent, remaining: state.energyReserve, boostFactor: 1 + spent / 100 };
  }

  /** Active tidal pools */
  getTidalPools() {
    const state = this._getState();
    return {
      pools: state.activePools,
      count: state.activePools.length,
      hint: state.activePools.length > 0
        ? 'Low-tide pools are active — creative/unusual processing available'
        : 'No active pools — tide is too high for pool formation',
    };
  }

  /** External force shifts the tides */
  force(event, magnitude = 1) {
    const state = this._getState();
    const mag = Math.max(-3, Math.min(3, magnitude));
    const impact = { ultraFast: mag * 0.5, fast: mag * 0.3, slow: mag * 0.1, ultraSlow: mag * 0.02 };

    for (const [freq, shift] of Object.entries(impact)) {
      state.forceOffsets[freq] = ((state.forceOffsets[freq] || 0) + shift) % (2 * Math.PI);
    }

    const forces = readJSON(FORCES_PATH, []);
    forces.push({ id: uuid(), event, magnitude: mag, impact, timestamp: Date.now() });
    if (forces.length > 300) forces.splice(0, forces.length - 300);
    writeJSON(FORCES_PATH, forces);
    this._saveState(state);

    return {
      forced: true, event, magnitude: mag, impact,
      description: mag > 0 ? `Flood tide from "${event}" — cognitive energy surging`
        : mag < 0 ? `Neap tide from "${event}" — cognitive energy receding`
        : `Neutral force from "${event}"`,
    };
  }

  /** Multi-frequency alignment score */
  getResonance() {
    const tideState = this.getTideState();
    const levels = Object.values(tideState.tides).map(t => t.level);
    const avg = levels.reduce((a, b) => a + b, 0) / levels.length;
    const allSameSign = levels.every(l => l > 0) || levels.every(l => l < 0);
    const spread = Math.max(...levels) - Math.min(...levels);

    const harmonicScore = allSameSign ? Math.abs(avg) * 100 : Math.abs(avg) * 50;
    const coherence = Math.max(0, 100 - spread * 50);

    return {
      resonance: Math.round(avg * 100) / 100,
      harmonicScore: Math.round(harmonicScore),
      coherence: Math.round(coherence),
      aligned: allSameSign,
      state: harmonicScore > 70 ? 'harmonic_peak' : harmonicScore > 40 ? 'partial_resonance' : 'dissonant',
      description: harmonicScore > 70
        ? (avg > 0 ? '🌟 Full harmonic resonance — all tides high. Peak cognitive state!' : '🌑 Deep harmonic rest — all tides low. Maximum consolidation.')
        : harmonicScore > 40 ? '🌓 Partial alignment — mixed cognitive state'
        : '🌀 Tides are dissonant — scattered energy, but tidal pools may form',
    };
  }

  /** Tidal calendar */
  getCalendar(days = 3) {
    const state = this._getState();
    const calendar = [];
    const now = Date.now();
    const hourMs = 60 * 60 * 1000;

    for (let h = 0; h < days * 24; h += 2) {
      const time = now + h * hourMs;
      const tides = {};
      let sum = 0;
      for (const [key] of Object.entries(FREQUENCIES)) {
        const level = this._tideAt(key, time, state.forceOffsets);
        tides[key] = Math.round(level * 100) / 100;
        sum += level;
      }
      const avg = sum / Object.keys(FREQUENCIES).length;
      calendar.push({
        hoursFromNow: h, time: new Date(time).toISOString(), tides,
        resonance: Math.round(avg * 100) / 100,
        recommendation: avg > 0.4 ? 'peak' : avg > 0 ? 'productive' : avg > -0.4 ? 'creative' : 'rest',
      });
    }
    return { days, entries: calendar };
  }

  /** Historical tide charts */
  getCharts(limit = 100) {
    return readJSON(CHARTS_PATH, { snapshots: [] }).snapshots.slice(-limit);
  }

  /** Periodic tick */
  tick() {
    const state = this._getState();
    const now = Date.now();
    const effects = [];

    // Get current tide levels
    const tides = {};
    for (const [key] of Object.entries(FREQUENCIES)) {
      tides[key] = this._tideAt(key, now, state.forceOffsets);
    }

    // Current direction update
    if (tides.ultraFast > 0.5 && tides.fast > 0.3) state.currentDirection = 'executive';
    else if (tides.slow > 0.5) state.currentDirection = 'social';
    else if (tides.ultraSlow > 0.5 && tides.slow < 0) state.currentDirection = 'introspective';
    else if (tides.ultraFast < -0.3 && tides.fast < -0.3) state.currentDirection = 'diffuse';
    else if (tides.fast > 0.5 && tides.slow < 0) state.currentDirection = 'creative';
    else state.currentDirection = 'analytical';

    // Spring/neap tide detection and counting
    const allSameSign = Object.values(tides).every(l => l > 0.2) || Object.values(tides).every(l => l < -0.2);
    const spread = Math.max(...Object.values(tides)) - Math.min(...Object.values(tides));
    if (allSameSign && Math.abs(Object.values(tides).reduce((a, b) => a + b, 0) / Object.keys(tides).length) > 0.6) {
      state.springTideCount = (state.springTideCount || 0) + 1;
      effects.push('🌕 Spring tide detected — extreme alignment');
      this.emit('spring-tide');
    }
    if (spread < 0.4) {
      state.neapTideCount = (state.neapTideCount || 0) + 1;
    }

    // Tidal pools
    const lowFreqs = Object.entries(tides).filter(([, level]) => level < -0.3);
    if (lowFreqs.length >= 2 && state.activePools.length < 3) {
      const poolType = POOL_TYPES[Math.floor(Math.random() * POOL_TYPES.length)];
      if (!state.activePools.some(p => p.name === poolType.name)) {
        const pool = {
          id: uuid(), ...poolType, formedAt: now,
          triggeringTides: lowFreqs.map(([k]) => k),
          strength: Math.abs(lowFreqs.reduce((s, [, l]) => s + l, 0) / lowFreqs.length),
        };
        state.activePools.push(pool);
        effects.push(`🌊 Tidal pool formed: ${poolType.emoji} ${poolType.name}`);
        this.emit('pool-formed', pool);
      }
    }

    // Dissolve pools
    state.activePools = state.activePools.filter(pool => {
      const stillLow = pool.triggeringTides.some(freq => tides[freq] < -0.1);
      const tooOld = (now - pool.formedAt) > 6 * 60 * 60 * 1000;
      if (!stillLow || tooOld) {
        effects.push(`🫧 Tidal pool dissolved: ${pool.emoji} ${pool.name}`);
        return false;
      }
      return true;
    });

    // Passive energy harvesting
    const avgAbs = Object.values(tides).reduce((s, l) => s + Math.abs(l), 0) / Object.keys(tides).length;
    state.energyReserve = Math.min(100, (state.energyReserve || 0) + avgAbs * 0.5);

    // Force offset decay
    for (const freq of Object.keys(state.forceOffsets)) {
      state.forceOffsets[freq] *= 0.98;
      if (Math.abs(state.forceOffsets[freq]) < 0.01) state.forceOffsets[freq] = 0;
    }

    // Track peak
    const avg = Object.values(tides).reduce((s, l) => s + l, 0) / Object.keys(tides).length;
    if (avg > (state.peakResonance || 0)) state.peakResonance = Math.round(avg * 100) / 100;

    // Record to charts
    const charts = readJSON(CHARTS_PATH, { snapshots: [] });
    charts.snapshots.push({
      timestamp: now,
      tides: Object.fromEntries(Object.entries(tides).map(([k, v]) => [k, Math.round(v * 100) / 100])),
      resonance: Math.round(avg * 100) / 100,
      direction: state.currentDirection,
      pools: state.activePools.length,
    });
    if (charts.snapshots.length > 2000) charts.snapshots = charts.snapshots.slice(-2000);
    writeJSON(CHARTS_PATH, charts);

    state.lastTick = now;
    state.totalTicks = (state.totalTicks || 0) + 1;
    this._saveState(state);

    return {
      tides: Object.fromEntries(Object.entries(tides).map(([k, v]) => [k, Math.round(v * 100) / 100])),
      resonance: Math.round(avg * 100) / 100,
      resonanceState: this.getResonance().state,
      currentDirection: state.currentDirection,
      activePools: state.activePools.length,
      energyReserve: Math.round(state.energyReserve || 0),
      effects,
    };
  }

  /** Force history */
  getForceHistory(limit = 30) { return readJSON(FORCES_PATH, []).slice(-limit); }

  /** Full status */
  getStatus() {
    const tideState = this.getTideState();
    const resonance = this.getResonance();
    const pools = this.getTidalPools();
    const state = this._getState();

    return {
      tides: tideState.tides,
      resonance: resonance.resonance,
      resonanceState: resonance.state,
      resonanceDescription: resonance.description,
      tideType: tideState.tideType,
      currentDirection: tideState.currentDirection,
      activePools: pools.pools,
      poolCount: pools.count,
      energyReserve: state.energyReserve || 0,
      totalTicks: state.totalTicks || 0,
      peakResonance: state.peakResonance || 0,
      springTideCount: state.springTideCount || 0,
      neapTideCount: state.neapTideCount || 0,
      frequencies: FREQUENCIES,
      poolTypes: POOL_TYPES,
    };
  }
}

module.exports = NeuralTideSystem;
