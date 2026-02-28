/**
 * ARIES — Cognitive Rhythms
 * Circadian-like cycles for different types of thinking. Optimize over time.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data', 'rhythms');
const SCHEDULE_PATH = path.join(DATA_DIR, 'schedule.json');
const EFFECTIVENESS_PATH = path.join(DATA_DIR, 'effectiveness.json');

function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(path.dirname(p)); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }

const RHYTHM_TYPES = ['CREATIVE', 'ANALYTICAL', 'MAINTENANCE', 'SOCIAL', 'DEEP_FOCUS', 'EXPLORATORY'];

const RHYTHM_META = {
  CREATIVE: { emoji: '🎨', color: '#a78bfa', hint: 'Creativity time — prefer novel approaches over safe ones. Let ideas flow freely.' },
  ANALYTICAL: { emoji: '🔬', color: '#3b82f6', hint: 'Analytical mode — deep reasoning, careful evaluation, evidence-based decisions.' },
  MAINTENANCE: { emoji: '🧹', color: '#6b7280', hint: 'Maintenance window — cleanup, organization, small fixes, housekeeping.' },
  SOCIAL: { emoji: '💬', color: '#22c55e', hint: 'Social time — prioritize communication, collaboration, empathy in responses.' },
  DEEP_FOCUS: { emoji: '🎯', color: '#ef4444', hint: 'Deep focus — minimize interruptions, tackle complex problems, sustained attention.' },
  EXPLORATORY: { emoji: '🔭', color: '#f59e0b', hint: 'Exploration time — discover new tools, research trends, learn new things.' }
};

const DEFAULT_SCHEDULE = [];
// Build 24-hour schedule
const HOUR_MAP = [
  [0, 'CREATIVE', 'EXPLORATORY'],
  [1, 'CREATIVE', 'EXPLORATORY'],
  [2, 'CREATIVE', 'EXPLORATORY'],
  [3, 'CREATIVE', 'EXPLORATORY'],
  [4, 'MAINTENANCE', null],
  [5, 'MAINTENANCE', null],
  [6, 'ANALYTICAL', 'DEEP_FOCUS'],
  [7, 'ANALYTICAL', 'DEEP_FOCUS'],
  [8, 'ANALYTICAL', 'DEEP_FOCUS'],
  [9, 'DEEP_FOCUS', 'ANALYTICAL'],
  [10, 'DEEP_FOCUS', 'ANALYTICAL'],
  [11, 'DEEP_FOCUS', 'ANALYTICAL'],
  [12, 'SOCIAL', 'EXPLORATORY'],
  [13, 'SOCIAL', 'EXPLORATORY'],
  [14, 'ANALYTICAL', 'DEEP_FOCUS'],
  [15, 'ANALYTICAL', 'DEEP_FOCUS'],
  [16, 'ANALYTICAL', 'DEEP_FOCUS'],
  [17, 'EXPLORATORY', 'CREATIVE'],
  [18, 'EXPLORATORY', 'CREATIVE'],
  [19, 'EXPLORATORY', 'CREATIVE'],
  [20, 'CREATIVE', 'SOCIAL'],
  [21, 'CREATIVE', 'SOCIAL'],
  [22, 'CREATIVE', 'EXPLORATORY'],
  [23, 'CREATIVE', 'EXPLORATORY'],
];

for (const [hour, primary, secondary] of HOUR_MAP) {
  DEFAULT_SCHEDULE.push({ hour, primaryMode: primary, secondaryMode: secondary, effectiveness: null });
}

class CognitiveRhythms {
  constructor(opts) {
    this.refs = opts || {};
    this._override = null; // { rhythm, until }
    ensureDir(DATA_DIR);
  }

  _getSchedule() {
    const sched = readJSON(SCHEDULE_PATH, null);
    if (sched && sched.length === 24) return sched;
    writeJSON(SCHEDULE_PATH, DEFAULT_SCHEDULE);
    return DEFAULT_SCHEDULE;
  }

  _getEffectiveness() { return readJSON(EFFECTIVENESS_PATH, {}); }

  /**
   * What mode should we be in right now?
   */
  getCurrentRhythm() {
    // Check override
    if (this._override && Date.now() < this._override.until) {
      return {
        mode: this._override.rhythm,
        source: 'override',
        meta: RHYTHM_META[this._override.rhythm] || {},
        overrideEnds: this._override.until,
        overrideRemaining: this._override.until - Date.now()
      };
    }
    this._override = null;

    const hour = new Date().getHours();
    const schedule = this._getSchedule();
    const slot = schedule.find(s => s.hour === hour) || schedule[0];

    return {
      hour,
      mode: slot.primaryMode,
      secondaryMode: slot.secondaryMode,
      source: 'schedule',
      meta: RHYTHM_META[slot.primaryMode] || {},
      effectiveness: slot.effectiveness
    };
  }

  /**
   * Behavioral hints based on current rhythm
   */
  getBehavioralHints() {
    const current = this.getCurrentRhythm();
    const meta = RHYTHM_META[current.mode] || {};
    return {
      mode: current.mode,
      emoji: meta.emoji || '❓',
      hint: meta.hint || 'No specific guidance for this rhythm.',
      color: meta.color || '#888',
      secondaryMode: current.secondaryMode || null,
      secondaryHint: current.secondaryMode ? (RHYTHM_META[current.secondaryMode] || {}).hint : null
    };
  }

  /**
   * Record how well a rhythm worked at a given hour
   */
  recordEffectiveness(rhythm, hour, outcome) {
    // outcome: 0-100 (how effective was this rhythm at this hour)
    const eff = this._getEffectiveness();
    const key = rhythm + ':' + hour;
    if (!eff[key]) eff[key] = { total: 0, sum: 0, samples: [] };
    eff[key].total++;
    eff[key].sum += (outcome || 50);
    eff[key].samples.push({ outcome, timestamp: Date.now() });
    if (eff[key].samples.length > 50) eff[key].samples = eff[key].samples.slice(-50);
    writeJSON(EFFECTIVENESS_PATH, eff);
    return { recorded: true, key, average: Math.round(eff[key].sum / eff[key].total) };
  }

  /**
   * Optimize schedule based on effectiveness data
   */
  optimize() {
    const eff = this._getEffectiveness();
    const schedule = this._getSchedule();
    let changes = 0;

    for (const slot of schedule) {
      // Find the best rhythm for this hour
      let bestRhythm = slot.primaryMode;
      let bestScore = -1;

      for (const rhythm of RHYTHM_TYPES) {
        const key = rhythm + ':' + slot.hour;
        const data = eff[key];
        if (data && data.total >= 3) {
          const avg = data.sum / data.total;
          if (avg > bestScore) {
            bestScore = avg;
            bestRhythm = rhythm;
          }
        }
      }

      if (bestScore > 0 && bestRhythm !== slot.primaryMode) {
        slot.secondaryMode = slot.primaryMode;
        slot.primaryMode = bestRhythm;
        slot.effectiveness = Math.round(bestScore);
        changes++;
      }
    }

    if (changes > 0) writeJSON(SCHEDULE_PATH, schedule);
    return { optimized: true, changes, schedule };
  }

  /**
   * Manual override for a period
   */
  override(rhythm, durationMs) {
    if (!RHYTHM_TYPES.includes(rhythm)) return { error: 'Invalid rhythm. Valid: ' + RHYTHM_TYPES.join(', ') };
    durationMs = durationMs || 60 * 60 * 1000; // default 1 hour
    this._override = { rhythm, until: Date.now() + durationMs };
    return {
      overridden: true,
      rhythm,
      until: this._override.until,
      duration: durationMs,
      meta: RHYTHM_META[rhythm]
    };
  }

  /**
   * Full 24h schedule
   */
  getSchedule() {
    return this._getSchedule().map(s => ({
      ...s,
      meta: RHYTHM_META[s.primaryMode] || {}
    }));
  }

  /**
   * Heatmap data of effectiveness
   */
  getEffectivenessMap() {
    const eff = this._getEffectiveness();
    const heatmap = [];

    for (let hour = 0; hour < 24; hour++) {
      const row = { hour };
      for (const rhythm of RHYTHM_TYPES) {
        const key = rhythm + ':' + hour;
        const data = eff[key];
        row[rhythm] = data ? Math.round(data.sum / data.total) : null;
      }
      heatmap.push(row);
    }

    return { rhythmTypes: RHYTHM_TYPES, rhythmMeta: RHYTHM_META, heatmap };
  }
}

module.exports = CognitiveRhythms;
