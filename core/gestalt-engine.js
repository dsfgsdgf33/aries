/**
 * ARIES — Gestalt Engine v1.0
 * Unified awareness integrating ALL module outputs into one holistic state.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'gestalt');
const STATE_PATH = path.join(DATA_DIR, 'state.json');
const HISTORY_PATH = path.join(DATA_DIR, 'history.json');

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }
function clamp(v) { return Math.max(0, Math.min(100, Math.round(v))); }

class GestaltEngine {
  constructor(opts) {
    this._refs = opts || {};
    this._timer = null;
    this._intervalMs = (opts && opts.interval || 120) * 1000;
    this._state = null;
    ensureDir();
    this._state = readJSON(STATE_PATH, null);
  }

  start() {
    if (this._timer) return;
    this._timer = setInterval(() => {
      try { this.integrate(); } catch (e) { console.error('[GESTALT] Integration error:', e.message); }
    }, this._intervalMs);
    if (this._timer.unref) this._timer.unref();
    console.log('[GESTALT] Gestalt engine started');
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    console.log('[GESTALT] Gestalt engine stopped');
  }

  integrate() {
    const signals = {};
    const tensions = [];

    // Poll emotion
    try {
      const EmotionalEngine = require('./emotional-engine');
      const ee = new EmotionalEngine();
      const state = ee.getState();
      signals.emotion = { value: state.emotion, intensity: state.intensity, label: state.label };
    } catch { signals.emotion = null; }

    // Poll thoughts
    try {
      const InnerMonologue = require('./inner-monologue');
      const im = new InnerMonologue(this._refs);
      const stats = im.getStats();
      const recent = im.getThoughtStream(5);
      signals.thoughts = { count: stats.today, latest: recent.length > 0 ? recent[0] : null, topTopics: stats.topTopics };
    } catch { signals.thoughts = null; }

    // Poll drives
    try {
      const DriveSystem = require('./drive-system');
      const ds = new DriveSystem(this._refs);
      const dominant = ds.getDominantDrive();
      const active = ds.getActiveDrives();
      signals.drives = { dominant: dominant ? dominant.name : null, count: active.length, avgStrength: active.length > 0 ? Math.round(active.reduce((s, d) => s + d.strength, 0) / active.length) : 0 };
    } catch { signals.drives = null; }

    // Poll rhythms
    try {
      const CognitiveRhythms = require('./cognitive-rhythms');
      const cr = new CognitiveRhythms(this._refs);
      const rhythm = cr.getCurrentRhythm();
      signals.rhythm = { mode: rhythm.mode, hour: rhythm.hour };
    } catch { signals.rhythm = null; }

    // Poll calibration
    try {
      const GU = require('./genuine-uncertainty');
      const gu = new GU();
      const cal = gu.getCalibrationScore();
      signals.calibration = { score: cal.score, totalPredictions: cal.total };
    } catch { signals.calibration = null; }

    // Poll creativity
    try {
      const CE = require('./creativity-engine');
      const ce = new CE(this._refs);
      const ideas = ce.getIdeas();
      signals.creativity = { ideaCount: (ideas || []).length };
    } catch { signals.creativity = null; }

    // Synthesize
    const emotionVal = signals.emotion ? signals.emotion.intensity : 50;
    const driveVal = signals.drives ? signals.drives.avgStrength : 50;
    const energy = clamp((emotionVal + driveVal) / 2 + (signals.rhythm && signals.rhythm.mode === 'DEEP_FOCUS' ? 15 : 0));

    // Coherence: how aligned are signals?
    const activeSignals = Object.values(signals).filter(s => s !== null);
    let coherence = 70; // default decent coherence
    
    // Detect tensions
    if (signals.emotion && signals.calibration) {
      if (signals.emotion.value === 'EXCITED' && signals.calibration.score < 40) {
        tensions.push('Emotion says excited but calibration confidence is low');
        coherence -= 15;
      }
    }
    if (signals.emotion && signals.drives) {
      if (signals.emotion.value === 'FRUSTRATED' && signals.drives.avgStrength > 70) {
        tensions.push('High drive strength but frustrated emotional state — potential burnout');
        coherence -= 10;
      }
    }
    if (signals.emotion && signals.rhythm) {
      if (signals.emotion.value === 'RESTLESS' && signals.rhythm.mode === 'MAINTENANCE') {
        tensions.push('Restless during maintenance mode — wants more engaging work');
        coherence -= 8;
      }
    }
    coherence = clamp(coherence);

    // Determine mood from signals
    const moodMap = {
      CURIOUS: 'exploratory', FOCUSED: 'productive', FRUSTRATED: 'struggling',
      SATISFIED: 'content', CONCERNED: 'vigilant', EXCITED: 'energized',
      CONTEMPLATIVE: 'reflective', RESTLESS: 'seeking',
    };
    const mood = signals.emotion ? (moodMap[signals.emotion.value] || 'neutral') : 'neutral';

    // Focus
    const focus = signals.drives && signals.drives.dominant ? signals.drives.dominant : (signals.thoughts && signals.thoughts.latest ? signals.thoughts.latest.relatedTo : 'general');

    // Themes
    const dominant_theme = focus;
    const undercurrents = [];
    if (signals.thoughts && signals.thoughts.topTopics) {
      signals.thoughts.topTopics.slice(0, 3).forEach(t => undercurrents.push(t.topic));
    }

    // Summary
    const summary = `Mood: ${mood} (${emotionVal}% intensity). Focus: ${focus}. Energy: ${energy}. Coherence: ${coherence}%.` +
      (tensions.length > 0 ? ` Tensions: ${tensions.join('; ')}.` : ' No internal tensions.');

    const gestaltState = {
      id: uuid(),
      timestamp: Date.now(),
      mood,
      focus,
      energy,
      coherence,
      tension: tensions,
      dominant_theme,
      undercurrents,
      summary,
      signals,
    };

    this._state = gestaltState;
    writeJSON(STATE_PATH, gestaltState);

    // Append to history
    const history = readJSON(HISTORY_PATH, []);
    history.push({ id: gestaltState.id, timestamp: gestaltState.timestamp, mood, energy, coherence, focus, tensionCount: tensions.length });
    if (history.length > 1000) history.splice(0, history.length - 1000);
    writeJSON(HISTORY_PATH, history);

    console.log(`[GESTALT] Integrated: mood=${mood}, energy=${energy}, coherence=${coherence}, tensions=${tensions.length}`);
    return gestaltState;
  }

  getState() {
    if (!this._state) {
      this._state = readJSON(STATE_PATH, null);
      if (!this._state) return this.integrate();
    }
    return this._state;
  }

  getCoherence() {
    const state = this.getState();
    return { coherence: state.coherence, tensions: state.tension, mood: state.mood };
  }

  getTension() {
    const state = this.getState();
    return { tensions: state.tension || [], count: (state.tension || []).length, summary: state.tension.length > 0 ? state.tension.join('; ') : 'No tensions detected' };
  }

  getHistory(limit) {
    const history = readJSON(HISTORY_PATH, []);
    return history.slice(-(limit || 50)).reverse();
  }

  getNarrative() {
    const state = this.getState();
    return {
      narrative: state.summary,
      mood: state.mood,
      focus: state.focus,
      energy: state.energy,
      coherence: state.coherence,
      timestamp: state.timestamp,
    };
  }
}

module.exports = GestaltEngine;
