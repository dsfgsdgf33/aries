/**
 * ARIES — Flow State v1.0
 * Detect and protect flow states for both user and Aries.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'flow');
const SESSIONS_PATH = path.join(DATA_DIR, 'sessions.json');
const CONDITIONS_PATH = path.join(DATA_DIR, 'conditions.json');

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }
function clamp(v) { return Math.max(0, Math.min(100, Math.round(v))); }

const STATES = ['IDLE', 'WARMING_UP', 'FLOWING', 'DEEP_FLOW', 'COOLING_DOWN', 'DISRUPTED'];

class FlowState {
  constructor(opts) {
    this._refs = opts || {};
    this._userFlow = { state: 'IDLE', score: 0, since: Date.now() };
    this._selfFlow = { state: 'IDLE', score: 0, since: Date.now() };
    this._protecting = false;
    this._currentSession = null;
    ensureDir();
    if (!fs.existsSync(SESSIONS_PATH)) writeJSON(SESSIONS_PATH, []);
    if (!fs.existsSync(CONDITIONS_PATH)) writeJSON(CONDITIONS_PATH, []);
  }

  detectUserFlow(messageHistory) {
    if (!messageHistory || messageHistory.length < 3) {
      this._userFlow = { state: 'IDLE', score: 0, since: Date.now() };
      return this._userFlow;
    }

    const recent = messageHistory.slice(-10);
    const userMsgs = recent.filter(m => m.role === 'user');
    if (userMsgs.length < 3) {
      this._userFlow.state = 'IDLE';
      this._userFlow.score = 0;
      return this._userFlow;
    }

    // Analyze gaps
    const gaps = [];
    for (let i = 1; i < userMsgs.length; i++) {
      const gap = ((userMsgs[i].timestamp || 0) - (userMsgs[i - 1].timestamp || 0)) / 1000;
      if (gap > 0) gaps.push(gap);
    }
    const avgGap = gaps.length > 0 ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 999;
    const gapConsistency = gaps.length > 1 ? 1 - (Math.max(...gaps) - Math.min(...gaps)) / (Math.max(...gaps) || 1) : 0;

    // Message length trend
    const lengths = userMsgs.map(m => (m.content || '').length);
    let lengthTrend = 0;
    for (let i = 1; i < lengths.length; i++) {
      if (lengths[i] > lengths[i - 1]) lengthTrend++;
      else if (lengths[i] < lengths[i - 1]) lengthTrend--;
    }

    // Topic consistency (simple: check if similar words repeat)
    const allWords = userMsgs.map(m => (m.content || '').toLowerCase().split(/\s+/).filter(w => w.length > 4));
    let topicOverlap = 0;
    if (allWords.length >= 2) {
      const last = new Set(allWords[allWords.length - 1]);
      const prev = new Set(allWords[allWords.length - 2]);
      for (const w of last) { if (prev.has(w)) topicOverlap++; }
    }

    // Score
    let score = 0;
    if (avgGap < 15) score += 30;
    else if (avgGap < 30) score += 20;
    else if (avgGap < 60) score += 10;

    if (gapConsistency > 0.5) score += 15;
    if (lengthTrend > 0) score += 15;
    if (topicOverlap >= 2) score += 20;
    score += Math.min(userMsgs.length * 3, 20);
    score = clamp(score);

    // Determine state
    let state;
    if (score >= 80) state = 'DEEP_FLOW';
    else if (score >= 60) state = 'FLOWING';
    else if (score >= 35) state = 'WARMING_UP';
    else if (this._userFlow.state === 'FLOWING' || this._userFlow.state === 'DEEP_FLOW') state = 'COOLING_DOWN';
    else state = 'IDLE';

    // Disruption detection
    if ((this._userFlow.state === 'FLOWING' || this._userFlow.state === 'DEEP_FLOW') && score < 30) {
      state = 'DISRUPTED';
    }

    const prev = this._userFlow.state;
    this._userFlow = { state, score, since: state !== prev ? Date.now() : this._userFlow.since, avgGap: Math.round(avgGap), topicOverlap };

    // Track session transitions
    if ((state === 'FLOWING' || state === 'DEEP_FLOW') && prev !== 'FLOWING' && prev !== 'DEEP_FLOW') {
      this._startSession('user', state);
    } else if ((prev === 'FLOWING' || prev === 'DEEP_FLOW') && state !== 'FLOWING' && state !== 'DEEP_FLOW') {
      this._endSession('user');
    }

    return this._userFlow;
  }

  detectSelfFlow() {
    // Self-assessment based on available modules
    let score = 40; // baseline

    try {
      const EmotionalEngine = require('./emotional-engine');
      const ee = new EmotionalEngine();
      const state = ee.getState();
      if (state.emotion === 'FOCUSED') score += 20;
      else if (state.emotion === 'EXCITED') score += 10;
      else if (state.emotion === 'FRUSTRATED') score -= 15;
      else if (state.emotion === 'RESTLESS') score -= 10;
    } catch {}

    try {
      const GestaltEngine = require('./gestalt-engine');
      const ge = new GestaltEngine(this._refs);
      const gState = ge.getState();
      if (gState && gState.coherence > 70) score += 15;
      if (gState && gState.tension && gState.tension.length === 0) score += 10;
    } catch {}

    score = clamp(score);

    let state;
    if (score >= 80) state = 'DEEP_FLOW';
    else if (score >= 60) state = 'FLOWING';
    else if (score >= 40) state = 'WARMING_UP';
    else state = 'IDLE';

    const prev = this._selfFlow.state;
    this._selfFlow = { state, score, since: state !== prev ? Date.now() : this._selfFlow.since };

    if ((state === 'FLOWING' || state === 'DEEP_FLOW') && prev !== 'FLOWING' && prev !== 'DEEP_FLOW') {
      this._startSession('self', state);
    } else if ((prev === 'FLOWING' || prev === 'DEEP_FLOW') && state !== 'FLOWING' && state !== 'DEEP_FLOW') {
      this._endSession('self');
    }

    return this._selfFlow;
  }

  getFlowState() {
    return {
      user: this._userFlow,
      self: this._selfFlow,
      protecting: this._protecting,
      overallScore: clamp(Math.round((this._userFlow.score + this._selfFlow.score) / 2)),
      timestamp: Date.now(),
    };
  }

  protectFlow() {
    const userInFlow = this._userFlow.state === 'FLOWING' || this._userFlow.state === 'DEEP_FLOW';
    const selfInFlow = this._selfFlow.state === 'FLOWING' || this._selfFlow.state === 'DEEP_FLOW';
    this._protecting = userInFlow || selfInFlow;

    return {
      protecting: this._protecting,
      recommendations: this._protecting ? [
        'Suppress non-urgent notifications',
        'Reduce response verbosity',
        'Anticipate needs silently',
        'Avoid unnecessary questions',
        'Keep context switches minimal',
      ] : [],
      userState: this._userFlow.state,
      selfState: this._selfFlow.state,
    };
  }

  getFlowConditions() {
    const conditions = readJSON(CONDITIONS_PATH, []);
    if (conditions.length === 0) return { conditions: [], summary: 'No flow conditions recorded yet' };
    const last = conditions[conditions.length - 1];
    return {
      conditions,
      lastFlow: last,
      summary: `Last flow at ${new Date(last.timestamp).toLocaleString()}: ${last.trigger || 'unknown trigger'}, duration ${last.duration || '?'}ms`,
    };
  }

  induceFlow(conditions) {
    // Record desired conditions as a target
    const conds = readJSON(CONDITIONS_PATH, []);
    conds.push({
      type: 'induction_attempt',
      conditions: conditions || {},
      timestamp: Date.now(),
      result: 'pending',
    });
    if (conds.length > 200) conds.splice(0, conds.length - 200);
    writeJSON(CONDITIONS_PATH, conds);
    return { status: 'Flow induction initiated', conditions };
  }

  getFlowHistory(limit) {
    const sessions = readJSON(SESSIONS_PATH, []);
    return sessions.slice(-(limit || 20)).reverse();
  }

  getFlowScore() {
    return {
      user: this._userFlow.score,
      self: this._selfFlow.score,
      combined: clamp(Math.round((this._userFlow.score + this._selfFlow.score) / 2)),
      userState: this._userFlow.state,
      selfState: this._selfFlow.state,
    };
  }

  _startSession(who, state) {
    this._currentSession = {
      id: uuid(),
      who,
      startState: state,
      startedAt: Date.now(),
      peakScore: who === 'user' ? this._userFlow.score : this._selfFlow.score,
    };
  }

  _endSession(who) {
    if (!this._currentSession || this._currentSession.who !== who) return;
    const session = {
      ...this._currentSession,
      endedAt: Date.now(),
      duration: Date.now() - this._currentSession.startedAt,
      endScore: who === 'user' ? this._userFlow.score : this._selfFlow.score,
    };

    const sessions = readJSON(SESSIONS_PATH, []);
    sessions.push(session);
    if (sessions.length > 200) sessions.splice(0, sessions.length - 200);
    writeJSON(SESSIONS_PATH, sessions);

    // Record conditions
    const conditions = readJSON(CONDITIONS_PATH, []);
    conditions.push({
      type: 'flow_ended',
      who,
      duration: session.duration,
      peakScore: session.peakScore,
      timestamp: Date.now(),
      trigger: session.startState,
    });
    if (conditions.length > 200) conditions.splice(0, conditions.length - 200);
    writeJSON(CONDITIONS_PATH, conditions);

    this._currentSession = null;
  }
}

module.exports = FlowState;
