/**
 * ARIES — Cognitive Dashboard
 * Meta-dashboard: unified view of the entire mind state.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'dashboard');
const SNAPSHOTS_PATH = path.join(DATA_DIR, 'snapshots.json');

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }

function safeRequire(mod) {
  try { return require(mod); } catch { return null; }
}

function safeCall(fn, fallback) {
  try { const r = fn(); return r != null ? r : fallback; } catch { return fallback; }
}

const CREATED_AT = Date.now();
const SESSION_START = Date.now();

class CognitiveDashboard {
  constructor(refs) {
    this.refs = refs || {};
    ensureDir();
  }

  getFullState() {
    const state = {
      timestamp: Date.now(),
      thought: this._getThought(),
      emotion: this._getEmotion(),
      drive: this._getDrive(),
      persona: this._getPersona(),
      rhythm: this._getRhythm(),
      attention: this._getAttention(),
      flow: this._getFlow(),
      weather: this._getWeather(),
      coherence: this._getCoherence(),
      awareness: this._getAwareness(),
      soulDrift: this._getSoulDrift(),
      activeProblems: this._getActiveProblems(),
      runningExperiments: this._getRunningExperiments(),
      pendingProposals: this._getPendingProposals(),
      cognitiveDebt: this._getCognitiveDebt(),
      uptime: Date.now() - SESSION_START,
      age: Date.now() - CREATED_AT,
    };

    // Save snapshot periodically
    this._maybeSnapshot(state);
    return state;
  }

  getMindMap() {
    const full = this.getFullState();
    return {
      thought: full.thought ? (full.thought.content || '').slice(0, 80) : 'quiet',
      emotion: full.emotion.primary || 'neutral',
      emotionIntensity: full.emotion.intensity || 0,
      persona: full.persona.name || 'default',
      rhythm: full.rhythm.mode || 'unknown',
      flow: full.flow.state || 'idle',
      weather: full.weather.condition || 'clear',
      coherence: full.coherence,
      awareness: full.awareness,
    };
  }

  getHealthIndicators() {
    const checks = [
      { name: 'Inner Monologue', module: './inner-monologue', test: m => { const inst = new m(this.refs); return inst.getStats ? inst.getStats() : null; } },
      { name: 'Emotional Engine', module: './emotional-engine', test: m => { const inst = new m(); return inst.getState ? inst.getState() : null; } },
      { name: 'Attention System', module: './attention-system', test: m => { const inst = new m(); return inst.getAttentionMap ? inst.getAttentionMap() : null; } },
      { name: 'Persona Forking', module: './persona-forking', test: m => { const inst = new m(this.refs); return inst.listPersonas ? inst.listPersonas() : null; } },
      { name: 'Cognitive Rhythms', module: './cognitive-rhythms', test: m => { const inst = new m(this.refs); return inst.getCurrentRhythm ? inst.getCurrentRhythm() : null; } },
      { name: 'Agent Dreams', module: './agent-dreams', test: m => { const inst = new m(this.refs); return inst.getLiveState ? inst.getLiveState() : null; } },
      { name: 'Self Model', module: './self-model', test: m => { const inst = new m(); return inst.getCapabilityMap ? inst.getCapabilityMap() : null; } },
      { name: 'Subconscious', module: './subconscious', test: m => { const inst = new m(this.refs); return inst.getActiveProblems ? inst.getActiveProblems() : null; } },
      { name: 'Associative Memory', module: './associative-memory', test: m => { const inst = new m(this.refs); return inst.getAll ? inst.getAll() : null; } },
      { name: 'Creativity Engine', module: './creativity-engine', test: m => { const inst = new m(this.refs); return inst.getIdeas ? inst.getIdeas() : null; } },
      { name: 'Intuition Engine', module: './intuition-engine', test: m => { const inst = new m(); return inst.getTrustLevel ? inst.getTrustLevel() : null; } },
      { name: 'Reality Anchor', module: './reality-anchor', test: m => { const inst = new m(this.refs); return inst.getStats ? inst.getStats() : null; } },
    ];

    return checks.map(c => {
      try {
        const Mod = require(c.module);
        const result = c.test(Mod);
        return { name: c.name, status: 'green', detail: 'operational' };
      } catch (e) {
        const msg = (e.message || '').toLowerCase();
        if (msg.includes('cannot find module') || msg.includes('not available')) {
          return { name: c.name, status: 'red', detail: 'module not loaded' };
        }
        return { name: c.name, status: 'yellow', detail: e.message.slice(0, 60) };
      }
    });
  }

  getAlerts() {
    const alerts = [];

    // Check coherence
    const coherence = this._getCoherence();
    if (coherence < 30) alerts.push({ level: 'critical', source: 'coherence', message: 'Gestalt coherence critically low: ' + coherence });
    else if (coherence < 50) alerts.push({ level: 'warning', source: 'coherence', message: 'Coherence below threshold: ' + coherence });

    // Check soul drift
    const drift = this._getSoulDrift();
    if (drift > 70) alerts.push({ level: 'critical', source: 'identity', message: 'Soul drift dangerously high: ' + drift + '%' });
    else if (drift > 40) alerts.push({ level: 'warning', source: 'identity', message: 'Identity drift elevated: ' + drift + '%' });

    // Check cognitive debt
    const debt = this._getCognitiveDebt();
    if (debt > 10) alerts.push({ level: 'critical', source: 'debt', message: debt + ' critical cognitive debts accumulated' });
    else if (debt > 5) alerts.push({ level: 'warning', source: 'debt', message: debt + ' cognitive debts need attention' });

    // Check active problems
    const problems = this._getActiveProblems();
    if (problems > 10) alerts.push({ level: 'warning', source: 'subconscious', message: problems + ' unresolved problems in subconscious' });

    // Check proposals
    const proposals = this._getPendingProposals();
    if (proposals > 20) alerts.push({ level: 'info', source: 'dreams', message: proposals + ' dream proposals awaiting review' });

    // Health check
    const health = this.getHealthIndicators();
    const redCount = health.filter(h => h.status === 'red').length;
    if (redCount > 3) alerts.push({ level: 'critical', source: 'health', message: redCount + ' subsystems offline' });
    else if (redCount > 0) alerts.push({ level: 'warning', source: 'health', message: redCount + ' subsystem(s) not responding' });

    // Check emotion
    const emotion = this._getEmotion();
    if (emotion.intensity > 80) alerts.push({ level: 'info', source: 'emotion', message: 'High emotional intensity: ' + emotion.primary + ' at ' + emotion.intensity });

    return alerts;
  }

  getSnapshots(limit) {
    const snaps = readJSON(SNAPSHOTS_PATH, []);
    return (limit ? snaps.slice(-limit) : snaps);
  }

  // ── Private helpers ──

  _getThought() {
    return safeCall(() => {
      const M = require('./inner-monologue');
      const inst = new M(this.refs);
      const stream = inst.getThoughtStream(1);
      return stream && stream[0] ? stream[0] : null;
    }, null);
  }

  _getEmotion() {
    return safeCall(() => {
      const M = require('./emotional-engine');
      const inst = new M();
      const s = inst.getState();
      return { primary: s.currentEmotion || s.dominant || 'neutral', intensity: s.intensity || 0, valence: s.valence || 0 };
    }, { primary: 'neutral', intensity: 0, valence: 0 });
  }

  _getDrive() {
    return safeCall(() => {
      const M = require('./behavioral-genetics');
      const inst = new M(this.refs);
      const genome = inst.getGenome();
      if (genome && genome.genes) {
        const sorted = Object.entries(genome.genes).sort((a, b) => (b[1].value || 0) - (a[1].value || 0));
        return { name: sorted[0] ? sorted[0][0] : 'exploration', strength: sorted[0] ? sorted[0][1].value : 50 };
      }
      return { name: 'exploration', strength: 50 };
    }, { name: 'exploration', strength: 50 });
  }

  _getPersona() {
    return safeCall(() => {
      const M = require('./persona-forking');
      const inst = new M(this.refs);
      const p = inst.getCurrentPersona();
      return p || { name: 'default', emoji: '🤖' };
    }, { name: 'default', emoji: '🤖' });
  }

  _getRhythm() {
    return safeCall(() => {
      const M = require('./cognitive-rhythms');
      const inst = new M(this.refs);
      return inst.getCurrentRhythm() || { mode: 'BALANCED' };
    }, { mode: 'BALANCED' });
  }

  _getAttention() {
    return safeCall(() => {
      const M = require('./attention-system');
      const inst = new M();
      const spot = inst.getSpotlight();
      return { spotlight: spot.focus || spot.target || 'nothing', budget: spot.budget || spot.remaining || 100 };
    }, { spotlight: 'nothing', budget: 100 });
  }

  _getFlow() {
    return safeCall(() => {
      const M = require('./cognitive-rhythms');
      const inst = new M(this.refs);
      const r = inst.getCurrentRhythm();
      const mode = (r && r.mode) || 'BALANCED';
      if (mode === 'DEEP_FOCUS') return { state: 'flow', depth: 80 };
      if (mode === 'CREATIVE') return { state: 'creative-flow', depth: 60 };
      return { state: 'normal', depth: 30 };
    }, { state: 'normal', depth: 30 });
  }

  _getWeather() {
    const emotion = this._getEmotion();
    const coherence = this._getCoherence();
    let condition = 'clear';
    let icon = '☀️';
    if (emotion.intensity > 70) { condition = 'stormy'; icon = '⛈️'; }
    else if (emotion.intensity > 50) { condition = 'cloudy'; icon = '🌥️'; }
    else if (coherence < 40) { condition = 'foggy'; icon = '🌫️'; }
    else if (emotion.valence > 0.5) { condition = 'sunny'; icon = '☀️'; }
    else if (emotion.valence < -0.3) { condition = 'overcast'; icon = '☁️'; }
    return { condition, icon, temperature: Math.round(50 + emotion.valence * 30 + (coherence / 5)) };
  }

  _getCoherence() {
    return safeCall(() => {
      const M = require('./self-model');
      const inst = new M();
      const report = inst.getSelfReport();
      return report.overallScore || report.coherence || 65;
    }, 65);
  }

  _getAwareness() {
    return safeCall(() => {
      const M = require('./stream-of-consciousness');
      const inst = new M(this.refs);
      const stats = inst.getStreamStats();
      const total = stats.totalThoughts || stats.total || 0;
      if (total > 100) return 90;
      if (total > 50) return 70;
      if (total > 10) return 50;
      return 30;
    }, 50);
  }

  _getSoulDrift() {
    return safeCall(() => {
      // Use the actual soul-checksum module for real drift calculation
      const SoulChecksum = require('./soul-checksum');
      const soul = new SoulChecksum();
      const status = soul.getStatus();
      if (status && status.drift && typeof status.drift.percentage === 'number') {
        return status.drift.percentage;
      }
      return 0;
    }, 0);
  }

  _getActiveProblems() {
    return safeCall(() => {
      const M = require('./subconscious');
      const inst = new M(this.refs);
      return (inst.getActiveProblems() || []).length;
    }, 0);
  }

  _getRunningExperiments() {
    return safeCall(() => {
      const M = require('./recursive-improvement');
      const inst = new M(this.refs);
      const stats = inst.getMetaStats();
      return stats.activeExperiments || stats.total || 0;
    }, 0);
  }

  _getPendingProposals() {
    return safeCall(() => {
      const proposalsPath = path.join(__dirname, '..', 'data', 'dreams', 'proposals.json');
      const proposals = readJSON(proposalsPath, []);
      return proposals.filter(p => p.status === 'proposed').length;
    }, 0);
  }

  _getCognitiveDebt() {
    const health = this.getHealthIndicators();
    return health.filter(h => h.status === 'red').length;
  }

  _maybeSnapshot(state) {
    const snaps = readJSON(SNAPSHOTS_PATH, []);
    const last = snaps[snaps.length - 1];
    // Snapshot every 5 minutes max
    if (last && (Date.now() - last.timestamp) < 5 * 60 * 1000) return;
    snaps.push({ id: uuid(), ...state });
    if (snaps.length > 500) snaps.splice(0, snaps.length - 500);
    writeJSON(SNAPSHOTS_PATH, snaps);
  }
}

module.exports = CognitiveDashboard;
