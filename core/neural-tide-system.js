/**
 * ARIES — Neural Tide System
 * Rhythmic cognitive cycles at multiple frequencies.
 * High tide = peak performance, low tide = rest/consolidation, tidal pools = creative spaces.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'rhythms');
const STATE_PATH = path.join(DATA_DIR, 'tide-state.json');
const POOLS_PATH = path.join(DATA_DIR, 'tidal-pools.json');
const FORCES_PATH = path.join(DATA_DIR, 'tide-forces.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

// Tidal frequencies — period in milliseconds
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

const DEFAULT_STATE = {
  epoch: Date.now(),
  forceOffsets: { ultraFast: 0, fast: 0, slow: 0, ultraSlow: 0 },
  activePools: [],
  lastTick: null,
  totalTicks: 0,
  peakResonance: 0,
};

class NeuralTideSystem {
  constructor(opts = {}) {
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

  /**
   * Calculate tide level for a frequency at a given time.
   * Returns -1 to 1 (low tide to high tide). Uses sine wave + force offsets.
   */
  _tideAt(freq, time, forceOffsets) {
    const f = FREQUENCIES[freq];
    if (!f) return 0;
    const state = forceOffsets || this._getState().forceOffsets || {};
    const offset = state[freq] || 0;
    const phase = ((time % f.period) / f.period) * 2 * Math.PI + offset;
    return Math.sin(phase);
  }

  /**
   * Current tide levels across all frequencies
   */
  getTideState() {
    const state = this._getState();
    const now = Date.now();
    const tides = {};
    let sum = 0;

    for (const [key, freq] of Object.entries(FREQUENCIES)) {
      const level = this._tideAt(key, now, state.forceOffsets);
      const normalized = Math.round(level * 100) / 100;
      const phase = level > 0.3 ? 'high' : level < -0.3 ? 'low' : 'transitioning';
      tides[key] = {
        label: freq.label,
        emoji: freq.emoji,
        level: normalized,
        phase,
        description: freq.description,
      };
      sum += level;
    }

    const resonance = Math.round((sum / Object.keys(FREQUENCIES).length) * 100) / 100;
    const allHigh = Object.values(tides).every(t => t.phase === 'high');
    const allLow = Object.values(tides).every(t => t.phase === 'low');

    return {
      tides,
      resonance,
      state: allHigh ? 'peak' : allLow ? 'deep_rest' : resonance > 0.3 ? 'rising' : resonance < -0.3 ? 'ebbing' : 'mixed',
      activePools: state.activePools.length,
    };
  }

  /**
   * Forecast tide state hours ahead
   */
  predictTide(hoursAhead = 1) {
    const state = this._getState();
    const future = Date.now() + hoursAhead * 60 * 60 * 1000;
    const tides = {};

    for (const [key, freq] of Object.entries(FREQUENCIES)) {
      const level = this._tideAt(key, future, state.forceOffsets);
      tides[key] = {
        label: freq.label,
        level: Math.round(level * 100) / 100,
        phase: level > 0.3 ? 'high' : level < -0.3 ? 'low' : 'transitioning',
      };
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

  /**
   * Active tidal pools — isolated cognitive spaces during low tide
   */
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

  /**
   * External force shifts the tides
   */
  force(event, magnitude = 1) {
    const state = this._getState();
    const mag = Math.max(-3, Math.min(3, magnitude));

    // Force affects different frequencies differently
    const impact = {
      ultraFast: mag * 0.5,
      fast: mag * 0.3,
      slow: mag * 0.1,
      ultraSlow: mag * 0.02,
    };

    for (const [freq, shift] of Object.entries(impact)) {
      state.forceOffsets[freq] = (state.forceOffsets[freq] || 0) + shift;
      // Normalize to stay within 0..2π
      state.forceOffsets[freq] = state.forceOffsets[freq] % (2 * Math.PI);
    }

    // Log force
    const forces = readJSON(FORCES_PATH, []);
    forces.push({ id: uuid(), event, magnitude: mag, impact, timestamp: Date.now() });
    if (forces.length > 300) forces.splice(0, forces.length - 300);
    writeJSON(FORCES_PATH, forces);

    this._saveState(state);

    return {
      forced: true,
      event,
      magnitude: mag,
      impact,
      description: mag > 0
        ? `Flood tide from "${event}" — cognitive energy surging`
        : mag < 0
          ? `Neap tide from "${event}" — cognitive energy receding`
          : `Neutral force from "${event}"`,
    };
  }

  /**
   * Multi-frequency alignment score
   */
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
        : harmonicScore > 40
          ? '🌓 Partial alignment — mixed cognitive state'
          : '🌀 Tides are dissonant — scattered energy, but tidal pools may form',
    };
  }

  /**
   * Tidal calendar — predicted schedule for planning
   */
  getCalendar(days = 3) {
    const state = this._getState();
    const calendar = [];
    const now = Date.now();
    const hourMs = 60 * 60 * 1000;

    for (let h = 0; h < days * 24; h += 2) { // Every 2 hours
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
        hoursFromNow: h,
        time: new Date(time).toISOString(),
        tides,
        resonance: Math.round(avg * 100) / 100,
        recommendation: avg > 0.4 ? 'peak' : avg > 0 ? 'productive' : avg > -0.4 ? 'creative' : 'rest',
      });
    }

    return { days, entries: calendar };
  }

  /**
   * Periodic tick — advance cycles, manage tidal pools
   */
  tick() {
    const state = this._getState();
    const now = Date.now();
    const effects = [];

    // Get current tide levels
    const tides = {};
    for (const [key] of Object.entries(FREQUENCIES)) {
      tides[key] = this._tideAt(key, now, state.forceOffsets);
    }

    // Manage tidal pools — form during low tides, dissolve during high
    const lowFreqs = Object.entries(tides).filter(([, level]) => level < -0.3);

    if (lowFreqs.length >= 2 && state.activePools.length < 3) {
      // Conditions for pool formation: multiple low tides
      const poolType = POOL_TYPES[Math.floor(Math.random() * POOL_TYPES.length)];
      const alreadyActive = state.activePools.some(p => p.name === poolType.name);

      if (!alreadyActive) {
        const pool = {
          id: uuid(),
          ...poolType,
          formedAt: now,
          triggeringTides: lowFreqs.map(([k]) => k),
          strength: Math.abs(lowFreqs.reduce((s, [, l]) => s + l, 0) / lowFreqs.length),
        };
        state.activePools.push(pool);
        effects.push(`🌊 Tidal pool formed: ${poolType.emoji} ${poolType.name} — ${poolType.description}`);
      }
    }

    // Dissolve pools when tide rises
    const prevPools = state.activePools.length;
    state.activePools = state.activePools.filter(pool => {
      const allTriggersStillLow = pool.triggeringTides.some(freq => tides[freq] < -0.1);
      const tooOld = (now - pool.formedAt) > 6 * 60 * 60 * 1000; // 6 hours max
      if (!allTriggersStillLow || tooOld) {
        effects.push(`🫧 Tidal pool dissolved: ${pool.emoji} ${pool.name}`);
        return false;
      }
      return true;
    });

    // Force offset decay — external forces slowly fade
    for (const freq of Object.keys(state.forceOffsets)) {
      state.forceOffsets[freq] *= 0.98; // Gentle decay
      if (Math.abs(state.forceOffsets[freq]) < 0.01) state.forceOffsets[freq] = 0;
    }

    // Track resonance peak
    const avg = Object.values(tides).reduce((s, l) => s + l, 0) / Object.keys(tides).length;
    if (avg > state.peakResonance) state.peakResonance = Math.round(avg * 100) / 100;

    state.lastTick = now;
    state.totalTicks = (state.totalTicks || 0) + 1;
    this._saveState(state);

    const resonance = this.getResonance();

    return {
      tides: Object.fromEntries(Object.entries(tides).map(([k, v]) => [k, Math.round(v * 100) / 100])),
      resonance: resonance.resonance,
      resonanceState: resonance.state,
      activePools: state.activePools.length,
      effects,
    };
  }

  /**
   * Force history
   */
  getForceHistory(limit = 30) {
    const forces = readJSON(FORCES_PATH, []);
    return forces.slice(-limit);
  }

  /**
   * Full status for API
   */
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
      activePools: pools.pools,
      poolCount: pools.count,
      totalTicks: state.totalTicks || 0,
      peakResonance: state.peakResonance || 0,
      frequencies: FREQUENCIES,
      poolTypes: POOL_TYPES,
    };
  }
}

module.exports = NeuralTideSystem;
