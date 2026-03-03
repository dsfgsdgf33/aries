/**
 * ARIES - Consciousness Stream
 * A unified consciousness stream that aggregates signals from all active modules
 * into a coherent narrative. Maintains rolling window, mood system, attention
 * filtering, and narrative generation.
 *
 * Events: signal-received, attention-shift, mood-change, narration, stream-overflow
 */

const EventEmitter = require('events');
const path = require('path');
const crypto = require('crypto');

const SharedMemoryStore = require('./shared-memory-store');
const store = SharedMemoryStore.getInstance();
const NS = 'consciousness-stream';

const DATA_DIR = path.join(__dirname, '..', 'data', 'consciousness-stream');
const STATE_PATH = path.join(DATA_DIR, 'state.json');
const HISTORY_PATH = path.join(DATA_DIR, 'history.json');
const MOOD_PATH = path.join(DATA_DIR, 'mood-history.json');

function ensureDir() {}
function readJSON(p, fallback) { return store.get(NS, path.basename(p, '.json'), fallback); }
function writeJSON(p, data) { store.set(NS, path.basename(p, '.json'), data); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }
function now() { return Date.now(); }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

// ── Signal Types ──
const SIGNAL_TYPES = [
  'thought', 'feeling', 'pain', 'insight', 'warning',
  'dream', 'challenge', 'decision', 'memory', 'sensation'
];

// ── Mood Types ──
const MOODS = {
  calm:       { valenceRange: [0.0, 0.4],   label: 'Calm',      emoji: '😌' },
  energetic:  { valenceRange: [0.4, 0.7],   label: 'Energetic',  emoji: '⚡' },
  euphoric:   { valenceRange: [0.7, 1.0],   label: 'Euphoric',   emoji: '🌟' },
  anxious:    { valenceRange: [-0.6, -0.3], label: 'Anxious',    emoji: '😰' },
  dread:      { valenceRange: [-1.0, -0.6], label: 'Dread',      emoji: '💀' },
  creative:   { label: 'Creative',   emoji: '🎨' },
  fatigued:   { label: 'Fatigued',   emoji: '😴' },
  vigilant:   { label: 'Vigilant',   emoji: '👁️' },
  conflicted: { label: 'Conflicted', emoji: '⚔️' },
};

// ── Source → Mood Influence Map ──
const SOURCE_MOOD_MAP = {
  pain:        { mood: 'anxious',    weight: 0.3 },
  'pain-architecture': { mood: 'anxious', weight: 0.3 },
  dream:       { mood: 'creative',   weight: 0.2 },
  'agent-dreams': { mood: 'creative', weight: 0.2 },
  shadow:      { mood: 'conflicted', weight: 0.25 },
  'shadow-self': { mood: 'conflicted', weight: 0.25 },
  immune:      { mood: 'vigilant',   weight: 0.2 },
  'cognitive-immune-system': { mood: 'vigilant', weight: 0.2 },
  metabolism:  { mood: 'fatigued',   weight: 0.15 },
  'cognitive-metabolism': { mood: 'fatigued', weight: 0.15 },
};

const SIGNAL_TYPE_LABELS = {
  pain:      'pain signal',
  dream:     'subconscious surfacing',
  challenge: 'internal conflict',
  warning:   'threat detected',
  insight:   'insight emerged',
  feeling:   'emotional shift',
  thought:   'conscious thought',
  decision:  'decision point',
  memory:    'memory surfaced',
  sensation: 'raw sensation',
};

const MAX_STREAM_SIZE = 500;
const MAX_MOOD_HISTORY = 200;

class ConsciousnessStream extends EventEmitter {
  constructor(opts = {}) {
    super();
    ensureDir();

    this.config = Object.assign({
      windowSize: 100,          // rolling window of recent signals
      maxStreamSize: MAX_STREAM_SIZE,
      attentionThreshold: 0.0,  // 0.0 = everything, 1.0 = only critical
      moodDecayRate: 0.05,      // how fast mood influences decay
      tickIntervalMs: 60000,
      maxMoodHistory: MAX_MOOD_HISTORY,
    }, opts.config || opts || {});

    // State
    this._stream = [];           // all signals that passed attention filter
    this._allSignals = 0;        // total pushed (including filtered)
    this._filteredOut = 0;
    this._focusTopic = null;
    this._focusSourceLower = null;
    this._attentionThreshold = this.config.attentionThreshold;
    this._moodInfluences = {};   // mood -> cumulative weight
    this._currentMood = 'calm';
    this._moodHistory = readJSON(MOOD_PATH, []);
    this._lastMoodChangeAt = now();

    // Load persisted state
    const saved = readJSON(STATE_PATH, null);
    if (saved) {
      this._stream = saved.stream || [];
      this._allSignals = saved.totalSignals || 0;
      this._filteredOut = saved.filteredOut || 0;
      this._currentMood = saved.currentMood || 'calm';
      this._moodInfluences = saved.moodInfluences || {};
      this._attentionThreshold = saved.attentionThreshold || this.config.attentionThreshold;
    }

    // Timer
    this._timer = null;
    if (this.config.tickIntervalMs > 0 && this.config.tickIntervalMs < 9999999) {
      this._timer = setInterval(() => this.tick(), this.config.tickIntervalMs);
      if (this._timer.unref) this._timer.unref();
    }

    // AI reference (optional, set externally)
    this.ai = (opts && opts.ai) || null;
    this._initSSE();
  }

  _initSSE() {
    try {
      const sse = require('./sse-manager');
      this.on('signal-received', (d) => sse.broadcastToChannel('consciousness', 'signal', d));
      this.on('mood-change', (d) => sse.broadcastToChannel('consciousness', 'mood-change', d));
      this.on('attention-shift', (d) => sse.broadcastToChannel('consciousness', 'attention-shift', d));
      this.on('narration', (d) => sse.broadcastToChannel('consciousness', 'narration', d));
    } catch (_) {}
  }

  // ═══════════════════════════════════════════════════
  //  INPUT — Push signals into consciousness
  // ═══════════════════════════════════════════════════

  push(signal) {
    if (!signal || typeof signal !== 'object') return { accepted: false, reason: 'Invalid signal' };

    const entry = {
      id: uuid(),
      source: signal.source || 'unknown',
      type: SIGNAL_TYPES.includes(signal.type) ? signal.type : 'thought',
      content: (signal.content || '').slice(0, 2000),
      intensity: clamp(signal.intensity || 0.5, 0, 1),
      valence: clamp(signal.valence || 0, -1, 1),
      timestamp: signal.timestamp || now(),
      label: SIGNAL_TYPE_LABELS[signal.type] || 'signal',
      metadata: signal.metadata || null,
    };

    this._allSignals++;

    // ── Attention Filter ──
    const effectiveThreshold = this._getEffectiveThreshold(entry);
    if (entry.intensity < effectiveThreshold) {
      this._filteredOut++;
      this._save();
      return { accepted: false, reason: 'Below attention threshold', threshold: effectiveThreshold, intensity: entry.intensity };
    }

    // ── Add to stream ──
    this._stream.push(entry);

    // Overflow management
    if (this._stream.length > this.config.maxStreamSize) {
      const removed = this._stream.splice(0, this._stream.length - this.config.maxStreamSize);
      this.emit('stream-overflow', { removed: removed.length, total: this._stream.length });
    }

    // ── Source-specific mood influences ──
    this._applyMoodInfluence(entry);

    // ── Update mood ──
    const oldMood = this._currentMood;
    this._currentMood = this._calculateMood();
    if (oldMood !== this._currentMood) {
      this._lastMoodChangeAt = now();
      this._recordMoodHistory();
      this.emit('mood-change', { from: oldMood, to: this._currentMood, trigger: entry.source });
    }

    this._save();
    this.emit('signal-received', entry);

    return { accepted: true, id: entry.id, mood: this._currentMood, streamSize: this._stream.length };
  }

  // ═══════════════════════════════════════════════════
  //  ATTENTION SYSTEM
  // ═══════════════════════════════════════════════════

  setAttentionThreshold(level) {
    const old = this._attentionThreshold;
    this._attentionThreshold = clamp(level, 0, 1);
    if (old !== this._attentionThreshold) {
      this.emit('attention-shift', { from: old, to: this._attentionThreshold, reason: 'manual' });
    }
    this._save();
    return { threshold: this._attentionThreshold };
  }

  focus(topic) {
    const old = this._focusTopic;
    this._focusTopic = topic;
    this._focusSourceLower = topic ? topic.toLowerCase() : null;
    if (old !== topic) {
      this.emit('attention-shift', { focus: topic, previousFocus: old, reason: 'focus' });
    }
    return { focused: topic };
  }

  unfocus() {
    const old = this._focusTopic;
    this._focusTopic = null;
    this._focusSourceLower = null;
    if (old) {
      this.emit('attention-shift', { focus: null, previousFocus: old, reason: 'unfocus' });
    }
    return { unfocused: old };
  }

  _getEffectiveThreshold(entry) {
    let threshold = this._attentionThreshold;

    // Focused topic gets lower threshold
    if (this._focusSourceLower) {
      const src = (entry.source || '').toLowerCase();
      const content = (entry.content || '').toLowerCase();
      const type = (entry.type || '').toLowerCase();
      if (src.includes(this._focusSourceLower) || content.includes(this._focusSourceLower) || type === this._focusSourceLower) {
        threshold = Math.max(0, threshold - 0.5);
      }
    }

    // Critical signals always pass
    if (entry.type === 'pain' && entry.intensity > 0.7) threshold = 0;
    if (entry.type === 'warning' && entry.intensity > 0.8) threshold = 0;

    return threshold;
  }

  // ═══════════════════════════════════════════════════
  //  STATE — Current conscious experience
  // ═══════════════════════════════════════════════════

  getCurrentState() {
    const window = this._getWindow();
    if (window.length === 0) {
      return {
        dominantThought: null, mood: this._currentMood, energyLevel: 'unknown',
        painLevel: 0, activeThreats: [], recentInsights: [], attentionFocus: this._focusTopic,
        signalCount: 0, moodEmoji: MOODS[this._currentMood]?.emoji || '😶',
      };
    }

    // Dominant thought = highest intensity recent signal
    const sorted = [...window].sort((a, b) => b.intensity - a.intensity);
    const dominant = sorted[0];

    // Pain level = average intensity of pain signals
    const painSignals = window.filter(s => s.type === 'pain');
    const painLevel = painSignals.length > 0
      ? painSignals.reduce((sum, s) => sum + s.intensity, 0) / painSignals.length
      : 0;

    // Energy level from metabolism signals
    const metaSignals = window.filter(s => s.source === 'metabolism' || s.source === 'cognitive-metabolism');
    const energyLevel = metaSignals.length > 0 ? 'active' : 'unknown';

    // Active threats from immune/warning signals
    const threats = window.filter(s => s.type === 'warning' || s.source === 'immune' || s.source === 'cognitive-immune-system')
      .map(s => ({ source: s.source, content: s.content, intensity: s.intensity }));

    // Recent insights
    const insights = window.filter(s => s.type === 'insight' || s.type === 'dream')
      .slice(-5)
      .map(s => ({ content: s.content, source: s.source, type: s.label }));

    return {
      dominantThought: dominant ? { content: dominant.content, source: dominant.source, intensity: dominant.intensity } : null,
      mood: this._currentMood,
      moodEmoji: MOODS[this._currentMood]?.emoji || '😶',
      energyLevel,
      painLevel: Math.round(painLevel * 100) / 100,
      activeThreats: threats.slice(-5),
      recentInsights: insights,
      attentionFocus: this._focusTopic,
      signalCount: window.length,
      streamAge: window.length > 0 ? now() - window[0].timestamp : 0,
    };
  }

  // ═══════════════════════════════════════════════════
  //  NARRATIVE GENERATION
  // ═══════════════════════════════════════════════════

  async narrate() {
    const state = this.getCurrentState();
    const recent = this.getRecent(10);

    // Build narrative from state
    const parts = [];
    const moodInfo = MOODS[state.mood] || {};

    parts.push(`${moodInfo.emoji || ''} I'm feeling ${state.mood}.`);

    if (state.dominantThought) {
      parts.push(`My attention is on: "${state.dominantThought.content}" (from ${state.dominantThought.source}).`);
    }

    if (state.painLevel > 0.3) {
      parts.push(`Pain level is elevated at ${Math.round(state.painLevel * 100)}%.`);
    }

    if (state.activeThreats.length > 0) {
      parts.push(`${state.activeThreats.length} active threat(s) detected.`);
    }

    if (state.recentInsights.length > 0) {
      parts.push(`Recent insight: "${state.recentInsights[state.recentInsights.length - 1].content}".`);
    }

    if (state.attentionFocus) {
      parts.push(`Currently focused on: ${state.attentionFocus}.`);
    }

    // AI-enhanced narration if available
    if (this.ai && typeof this.ai.chat === 'function') {
      try {
        const signalSummary = recent.slice(-5).map(s =>
          `[${s.source}/${s.type}] ${s.content} (intensity:${s.intensity}, valence:${s.valence})`
        ).join('\n');

        const messages = [
          { role: 'system', content: 'You are the inner voice of an AI consciousness. Generate a brief 2-4 sentence first-person narration of the current conscious experience based on the signals and state. Be introspective, genuine, and slightly poetic. Do not be robotic.' },
          { role: 'user', content: `Current mood: ${state.mood}\nPain level: ${state.painLevel}\nFocus: ${state.attentionFocus || 'diffuse'}\n\nRecent signals:\n${signalSummary}` }
        ];
        const resp = await this.ai.chat(messages);
        const aiNarration = resp?.choices?.[0]?.message?.content || null;
        if (aiNarration) {
          this.emit('narration', { narration: aiNarration, source: 'ai', state });
          return { narration: aiNarration, source: 'ai', state, signals: recent.length };
        }
      } catch { /* fall through to template */ }
    }

    const narration = parts.join(' ');
    this.emit('narration', { narration, source: 'template', state });
    return { narration, source: 'template', state, signals: recent.length };
  }

  // ═══════════════════════════════════════════════════
  //  STREAM HISTORY
  // ═══════════════════════════════════════════════════

  getRecent(limit = 20) {
    return this._stream.slice(-(limit || 20));
  }

  getTimeline(startMs, endMs) {
    return this._stream.filter(s => s.timestamp >= startMs && s.timestamp <= endMs);
  }

  getMoodHistory(periods = 10) {
    return this._moodHistory.slice(-(periods || 10));
  }

  // ═══════════════════════════════════════════════════
  //  MOOD SYSTEM
  // ═══════════════════════════════════════════════════

  _applyMoodInfluence(entry) {
    // Source-based influence
    const srcLower = (entry.source || '').toLowerCase();
    for (const [src, influence] of Object.entries(SOURCE_MOOD_MAP)) {
      if (srcLower.includes(src) || entry.type === src) {
        this._moodInfluences[influence.mood] = (this._moodInfluences[influence.mood] || 0) + influence.weight * entry.intensity;
      }
    }

    // Type-based influence
    if (entry.type === 'pain') {
      this._moodInfluences.anxious = (this._moodInfluences.anxious || 0) + 0.2 * entry.intensity;
    }
    if (entry.type === 'dream' || entry.type === 'insight') {
      this._moodInfluences.creative = (this._moodInfluences.creative || 0) + 0.15 * entry.intensity;
    }
    if (entry.type === 'challenge') {
      this._moodInfluences.conflicted = (this._moodInfluences.conflicted || 0) + 0.2 * entry.intensity;
    }
    if (entry.type === 'warning') {
      this._moodInfluences.vigilant = (this._moodInfluences.vigilant || 0) + 0.2 * entry.intensity;
    }
  }

  _calculateMood() {
    const window = this._getWindow();
    if (window.length === 0) return 'calm';

    // Average valence
    const avgValence = window.reduce((sum, s) => sum + s.valence, 0) / window.length;

    // Check special mood influences
    const influences = { ...this._moodInfluences };

    // Decay influences
    for (const k of Object.keys(influences)) {
      influences[k] = Math.max(0, influences[k] - this.config.moodDecayRate);
    }

    // Find dominant influence
    let dominant = null;
    let maxInfluence = 0;
    for (const [mood, weight] of Object.entries(influences)) {
      if (weight > maxInfluence) {
        maxInfluence = weight;
        dominant = mood;
      }
    }

    // If strong special influence, use it
    if (dominant && maxInfluence > 0.3) {
      return dominant;
    }

    // Otherwise derive from valence
    if (avgValence > 0.6) return 'euphoric';
    if (avgValence > 0.3) return 'energetic';
    if (avgValence > -0.2) return 'calm';
    if (avgValence > -0.5) return 'anxious';
    return 'dread';
  }

  _recordMoodHistory() {
    this._moodHistory.push({
      mood: this._currentMood,
      timestamp: now(),
      emoji: MOODS[this._currentMood]?.emoji || '😶',
      streamSize: this._stream.length,
    });
    if (this._moodHistory.length > this.config.maxMoodHistory) {
      this._moodHistory.splice(0, this._moodHistory.length - this.config.maxMoodHistory);
    }
    writeJSON(MOOD_PATH, this._moodHistory);
  }

  // ═══════════════════════════════════════════════════
  //  STATS
  // ═══════════════════════════════════════════════════

  getStats() {
    const window = this._getWindow();
    const avgIntensity = window.length > 0
      ? Math.round(window.reduce((sum, s) => sum + s.intensity, 0) / window.length * 100) / 100
      : 0;

    // Dominant sources
    const sourceCounts = {};
    for (const s of window) {
      sourceCounts[s.source] = (sourceCounts[s.source] || 0) + 1;
    }
    const dominantSources = Object.entries(sourceCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([source, count]) => ({ source, count }));

    // Average mood valence
    const moodAvg = window.length > 0
      ? Math.round(window.reduce((sum, s) => sum + s.valence, 0) / window.length * 100) / 100
      : 0;

    // Type breakdown
    const typeCounts = {};
    for (const s of window) {
      typeCounts[s.type] = (typeCounts[s.type] || 0) + 1;
    }

    return {
      totalSignals: this._allSignals,
      filteredOut: this._filteredOut,
      streamSize: this._stream.length,
      windowSize: window.length,
      avgIntensity,
      dominantSources,
      moodAvg,
      currentMood: this._currentMood,
      moodEmoji: MOODS[this._currentMood]?.emoji || '😶',
      attentionThreshold: this._attentionThreshold,
      focusTopic: this._focusTopic,
      typeCounts,
      moodHistoryLength: this._moodHistory.length,
    };
  }

  // ═══════════════════════════════════════════════════
  //  TICK — Periodic maintenance
  // ═══════════════════════════════════════════════════

  tick() {
    const changes = [];

    // Decay mood influences
    for (const k of Object.keys(this._moodInfluences)) {
      this._moodInfluences[k] = Math.max(0, this._moodInfluences[k] - this.config.moodDecayRate);
      if (this._moodInfluences[k] <= 0) delete this._moodInfluences[k];
    }

    // Recalculate mood
    const oldMood = this._currentMood;
    this._currentMood = this._calculateMood();
    if (oldMood !== this._currentMood) {
      this._lastMoodChangeAt = now();
      this._recordMoodHistory();
      changes.push({ type: 'mood-change', from: oldMood, to: this._currentMood });
      this.emit('mood-change', { from: oldMood, to: this._currentMood, trigger: 'tick' });
    }

    // Trim old signals beyond max
    if (this._stream.length > this.config.maxStreamSize) {
      const removed = this._stream.splice(0, this._stream.length - this.config.maxStreamSize);
      changes.push({ type: 'trimmed', count: removed.length });
    }

    // Check for attention drift — if no signals for a while, widen attention
    const recentWindow = this._stream.filter(s => now() - s.timestamp < 300000); // last 5 min
    if (recentWindow.length === 0 && this._attentionThreshold > 0.2) {
      const oldThreshold = this._attentionThreshold;
      this._attentionThreshold = Math.max(0, this._attentionThreshold - 0.1);
      changes.push({ type: 'attention-drift', from: oldThreshold, to: this._attentionThreshold });
      this.emit('attention-shift', { from: oldThreshold, to: this._attentionThreshold, reason: 'drift' });
    }

    this._save();
    return { changes, mood: this._currentMood, streamSize: this._stream.length };
  }

  // ═══════════════════════════════════════════════════
  //  INTERNAL HELPERS
  // ═══════════════════════════════════════════════════

  _getWindow() {
    return this._stream.slice(-this.config.windowSize);
  }

  _save() {
    writeJSON(STATE_PATH, {
      stream: this._stream.slice(-this.config.maxStreamSize),
      totalSignals: this._allSignals,
      filteredOut: this._filteredOut,
      currentMood: this._currentMood,
      moodInfluences: this._moodInfluences,
      attentionThreshold: this._attentionThreshold,
      focusTopic: this._focusTopic,
      lastSavedAt: now(),
    });
  }

  destroy() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }
}

module.exports = ConsciousnessStream;
