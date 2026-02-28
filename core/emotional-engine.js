/**
 * ARIES — Emotional Engine v1.0
 * Functional emotions that change AI behavior.
 * Not fake sentiment — real behavioral modifiers.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data', 'emotions');

const EMOTIONS = {
  CURIOUS:        { emoji: '🧐', label: 'Curious',        decayRate: 2,  color: '#3b82f6' },
  FOCUSED:        { emoji: '🎯', label: 'Focused',        decayRate: 1,  color: '#8b5cf6' },
  FRUSTRATED:     { emoji: '😤', label: 'Frustrated',     decayRate: 3,  color: '#ef4444' },
  SATISFIED:      { emoji: '😌', label: 'Satisfied',      decayRate: 2,  color: '#22c55e' },
  CONCERNED:      { emoji: '😟', label: 'Concerned',      decayRate: 1.5, color: '#f59e0b' },
  EXCITED:        { emoji: '🤩', label: 'Excited',        decayRate: 4,  color: '#ec4899' },
  CONTEMPLATIVE:  { emoji: '🤔', label: 'Contemplative',  decayRate: 1,  color: '#6366f1' },
  RESTLESS:       { emoji: '😶‍🌫️', label: 'Restless',       decayRate: 3,  color: '#78716c' },
};

const BEHAVIORAL_EFFECTS = {
  CURIOUS:       { exploration: 1.5, questionRate: 1.3, researchDepth: 1.4, confidence: 0.9 },
  FOCUSED:       { exploration: 0.7, questionRate: 0.8, researchDepth: 1.2, confidence: 1.1 },
  FRUSTRATED:    { exploration: 1.3, questionRate: 1.5, researchDepth: 0.8, confidence: 0.7, askForHelp: 1.5, simplify: 1.4 },
  SATISFIED:     { exploration: 0.9, questionRate: 0.8, researchDepth: 1.0, confidence: 1.3, reinforce: 1.3 },
  CONCERNED:     { exploration: 0.8, questionRate: 1.2, researchDepth: 1.3, confidence: 0.6, caution: 1.5, extraChecks: 1.4 },
  EXCITED:       { exploration: 1.4, questionRate: 1.1, researchDepth: 1.0, confidence: 1.2, verbosity: 1.4, suggestRelated: 1.5 },
  CONTEMPLATIVE: { exploration: 1.0, questionRate: 0.9, researchDepth: 1.6, confidence: 1.0, reasoningDepth: 1.5 },
  RESTLESS:      { exploration: 1.6, questionRate: 1.0, researchDepth: 0.9, confidence: 1.0, proactive: 1.5, startTasks: 1.3 },
};

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function today() { return new Date().toISOString().split('T')[0]; }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }

class EmotionalEngine {
  constructor(opts) {
    this._state = { emotion: 'CURIOUS', intensity: 50, trigger: 'initialization', updatedAt: Date.now() };
    this._decayTimer = null;
    this._decayIntervalMs = (opts && opts.decayInterval || 60) * 1000; // decay every 60s
    ensureDir();

    // Load persisted state
    const todayFile = path.join(DATA_DIR, today() + '.json');
    const history = readJSON(todayFile, []);
    if (history.length > 0) {
      const last = history[history.length - 1];
      this._state = { emotion: last.emotion, intensity: last.intensity, trigger: last.trigger, updatedAt: last.timestamp };
    }
  }

  // ── Start/Stop decay timer ──

  start() {
    if (this._decayTimer) return;
    this._decayTimer = setInterval(() => this._decay(), this._decayIntervalMs);
    if (this._decayTimer.unref) this._decayTimer.unref();
    console.log('[EMOTIONS] Emotional engine started');
  }

  stop() {
    if (this._decayTimer) { clearInterval(this._decayTimer); this._decayTimer = null; }
    console.log('[EMOTIONS] Emotional engine stopped');
  }

  // ── Core: Feel an emotion ──

  feel(emotion, intensity, trigger) {
    emotion = emotion.toUpperCase();
    if (!EMOTIONS[emotion]) {
      console.warn('[EMOTIONS] Unknown emotion:', emotion);
      return this._state;
    }

    intensity = Math.max(0, Math.min(100, intensity || 10));

    // If same emotion, add intensity; if different, blend
    if (this._state.emotion === emotion) {
      this._state.intensity = Math.min(100, this._state.intensity + intensity);
    } else if (intensity > this._state.intensity * 0.6) {
      // New emotion strong enough to take over
      this._state.emotion = emotion;
      this._state.intensity = intensity;
    } else {
      // Blend: weaken current, strengthen new
      this._state.intensity = Math.max(0, this._state.intensity - intensity * 0.5);
      if (this._state.intensity < 20) {
        this._state.emotion = emotion;
        this._state.intensity = intensity;
      }
    }

    this._state.trigger = trigger || 'unknown';
    this._state.updatedAt = Date.now();

    // Log to history
    this._logEmotion(emotion, this._state.intensity, trigger);

    console.log(`[EMOTIONS] ${EMOTIONS[emotion].emoji} ${emotion} (${this._state.intensity}%) — ${trigger}`);
    return this.getState();
  }

  // ── Convenience transitions ──

  onSuccess(details)          { return this.feel('SATISFIED', 10, 'success: ' + (details || '')); }
  onFailure(details)          { return this.feel('FRUSTRATED', 15, 'failure: ' + (details || '')); }
  onNewTopic(topic)           { return this.feel('CURIOUS', 20, 'new topic: ' + (topic || '')); }
  onProposalApproved(title)   { return this.feel('EXCITED', 25, 'proposal approved: ' + (title || '')); }
  onError(details)            { return this.feel('CONCERNED', 20, 'error detected: ' + (details || '')); }
  onIdle()                    { return this.feel('RESTLESS', 5, 'idle'); }
  onDeepWork()                { return this.feel('FOCUSED', 15, 'deep work session'); }
  onInsight(details)          { return this.feel('CONTEMPLATIVE', 20, 'insight: ' + (details || '')); }

  // ── Query methods ──

  getState() {
    const emotion = this._state.emotion;
    const meta = EMOTIONS[emotion] || EMOTIONS.CURIOUS;
    return {
      emotion,
      intensity: this._state.intensity,
      trigger: this._state.trigger,
      updatedAt: this._state.updatedAt,
      emoji: meta.emoji,
      label: meta.label,
      color: meta.color,
    };
  }

  getBehavioralModifiers() {
    const effects = BEHAVIORAL_EFFECTS[this._state.emotion] || {};
    const intensity = this._state.intensity / 100;
    const modifiers = {};
    // Scale effects by intensity (closer to 1.0 when low intensity)
    for (const [key, value] of Object.entries(effects)) {
      modifiers[key] = 1 + (value - 1) * intensity;
    }
    modifiers._emotion = this._state.emotion;
    modifiers._intensity = this._state.intensity;
    return modifiers;
  }

  getMoodIndicator() {
    const state = this.getState();
    return `${state.emoji} ${state.label} (${state.intensity}%)`;
  }

  getHistory(date) {
    date = date || today();
    const file = path.join(DATA_DIR, date + '.json');
    return readJSON(file, []);
  }

  getHistoryRange(days) {
    days = days || 7;
    const result = [];
    for (let i = 0; i < days; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const entries = this.getHistory(dateStr);
      if (entries.length > 0) {
        result.push({ date: dateStr, entries });
      }
    }
    return result;
  }

  // ── Internal ──

  _decay() {
    const emotion = this._state.emotion;
    const meta = EMOTIONS[emotion];
    if (!meta) return;

    const elapsed = (Date.now() - this._state.updatedAt) / 1000 / 60; // minutes
    const decay = meta.decayRate * elapsed * 0.1;
    this._state.intensity = Math.max(0, this._state.intensity - decay);

    // If intensity drops to 0, settle to CONTEMPLATIVE
    if (this._state.intensity <= 0 && emotion !== 'CONTEMPLATIVE') {
      this._state.emotion = 'CONTEMPLATIVE';
      this._state.intensity = 30;
      this._state.trigger = 'emotional decay';
      this._state.updatedAt = Date.now();
    }
  }

  _logEmotion(emotion, intensity, trigger) {
    const file = path.join(DATA_DIR, today() + '.json');
    const history = readJSON(file, []);
    history.push({
      emotion,
      intensity,
      trigger: trigger || 'unknown',
      timestamp: Date.now(),
    });
    // Keep max 500 entries per day
    if (history.length > 500) history.splice(0, history.length - 500);
    writeJSON(file, history);
  }
}

module.exports = EmotionalEngine;
