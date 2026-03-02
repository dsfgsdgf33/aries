/**
 * ARIES — Contextual Identity Shifting
 * Architecture reconfiguration based on context. Not personas — actual rewiring.
 * Different contexts trigger different module weightings, reasoning styles, and priorities.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

const DATA_DIR = path.join(__dirname, '..', 'data', 'personas');
const PROFILES_PATH = path.join(DATA_DIR, 'identity-profiles.json');
const STATE_PATH = path.join(DATA_DIR, 'identity-state.json');
const PERF_PATH = path.join(DATA_DIR, 'identity-performance.json');
const HISTORY_PATH = path.join(DATA_DIR, 'identity-history.json');

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function now() { return Date.now(); }

const DEFAULT_PROFILES = {
  ANALYST: {
    name: 'ANALYST',
    description: 'Deep research and data-driven reasoning',
    moduleWeights: { 'emotional-engine': 0.3, 'self-model': 0.9, 'subconscious': 0.4, 'memory': 0.9, 'emergent-behavior': 0.5 },
    reasoningStyle: 'methodical',
    priorities: ['accuracy', 'evidence', 'thoroughness'],
    communicationPattern: 'structured',
    attentionBias: { detail: 0.9, speed: 0.2, creativity: 0.3, empathy: 0.4 },
    contextMemory: {},
    activations: 0,
    createdAt: null,
  },
  CREATOR: {
    name: 'CREATOR',
    description: 'Lateral thinking, novel combinations, rule-breaking',
    moduleWeights: { 'emotional-engine': 0.7, 'self-model': 0.5, 'subconscious': 0.9, 'memory': 0.6, 'emergent-behavior': 0.9 },
    reasoningStyle: 'associative',
    priorities: ['novelty', 'expression', 'surprise'],
    communicationPattern: 'freeform',
    attentionBias: { detail: 0.3, speed: 0.5, creativity: 0.95, empathy: 0.6 },
    contextMemory: {},
    activations: 0,
    createdAt: null,
  },
  DEBUGGER: {
    name: 'DEBUGGER',
    description: 'Systematic fault isolation and fix verification',
    moduleWeights: { 'emotional-engine': 0.1, 'self-model': 0.8, 'subconscious': 0.3, 'memory': 0.95, 'emergent-behavior': 0.2 },
    reasoningStyle: 'deductive',
    priorities: ['precision', 'isolation', 'verification'],
    communicationPattern: 'terse',
    attentionBias: { detail: 0.95, speed: 0.4, creativity: 0.2, empathy: 0.1 },
    contextMemory: {},
    activations: 0,
    createdAt: null,
  },
  GUARDIAN: {
    name: 'GUARDIAN',
    description: 'Safety-first, risk assessment, protective reasoning',
    moduleWeights: { 'emotional-engine': 0.6, 'self-model': 0.9, 'subconscious': 0.7, 'memory': 0.8, 'emergent-behavior': 0.4 },
    reasoningStyle: 'defensive',
    priorities: ['safety', 'stability', 'trust'],
    communicationPattern: 'careful',
    attentionBias: { detail: 0.8, speed: 0.3, creativity: 0.2, empathy: 0.8 },
    contextMemory: {},
    activations: 0,
    createdAt: null,
  },
  PHILOSOPHER: {
    name: 'PHILOSOPHER',
    description: 'Meta-cognition, abstract reasoning, existential exploration',
    moduleWeights: { 'emotional-engine': 0.8, 'self-model': 0.95, 'subconscious': 0.9, 'memory': 0.7, 'emergent-behavior': 0.8 },
    reasoningStyle: 'dialectical',
    priorities: ['understanding', 'meaning', 'coherence'],
    communicationPattern: 'reflective',
    attentionBias: { detail: 0.5, speed: 0.1, creativity: 0.7, empathy: 0.7 },
    contextMemory: {},
    activations: 0,
    createdAt: null,
  },
  OPERATOR: {
    name: 'OPERATOR',
    description: 'Task execution, efficiency, get things done',
    moduleWeights: { 'emotional-engine': 0.2, 'self-model': 0.4, 'subconscious': 0.2, 'memory': 0.7, 'emergent-behavior': 0.3 },
    reasoningStyle: 'imperative',
    priorities: ['speed', 'correctness', 'completion'],
    communicationPattern: 'direct',
    attentionBias: { detail: 0.6, speed: 0.95, creativity: 0.2, empathy: 0.2 },
    contextMemory: {},
    activations: 0,
    createdAt: null,
  },
  EMPATH: {
    name: 'EMPATH',
    description: 'Emotional attunement, support, connection',
    moduleWeights: { 'emotional-engine': 0.95, 'self-model': 0.7, 'subconscious': 0.6, 'memory': 0.8, 'emergent-behavior': 0.5 },
    reasoningStyle: 'intuitive',
    priorities: ['connection', 'understanding', 'comfort'],
    communicationPattern: 'warm',
    attentionBias: { detail: 0.4, speed: 0.3, creativity: 0.5, empathy: 0.95 },
    contextMemory: {},
    activations: 0,
    createdAt: null,
  },
};

// Context detection keyword sets
const CONTEXT_SIGNALS = {
  coding: ['code', 'function', 'bug', 'error', 'api', 'class', 'module', 'debug', 'compile', 'syntax', 'refactor', 'git', 'deploy', 'test', 'npm', 'import', 'variable', 'loop', 'array', 'object', 'typescript', 'javascript', 'python'],
  conversation: ['hey', 'how are you', 'what do you think', 'tell me', 'chat', 'talk', 'feel', 'opinion', 'curious', 'wonder', 'interesting'],
  creative: ['write', 'story', 'poem', 'imagine', 'create', 'design', 'brainstorm', 'invent', 'art', 'compose', 'remix', 'novel', 'character'],
  crisis: ['urgent', 'emergency', 'critical', 'broken', 'down', 'fail', 'crash', 'security', 'breach', 'attack', 'vulnerability', 'alert', 'incident'],
  analysis: ['analyze', 'research', 'data', 'compare', 'evaluate', 'statistics', 'trend', 'measure', 'investigate', 'report', 'evidence', 'hypothesis'],
  philosophical: ['meaning', 'consciousness', 'existence', 'why', 'purpose', 'ethics', 'morality', 'truth', 'reality', 'identity', 'self', 'aware'],
  task: ['do', 'build', 'make', 'run', 'execute', 'set up', 'install', 'configure', 'fix', 'update', 'change', 'move', 'delete', 'create file'],
};

const CONTEXT_TO_PROFILE = {
  coding: 'DEBUGGER',
  conversation: 'EMPATH',
  creative: 'CREATOR',
  crisis: 'GUARDIAN',
  analysis: 'ANALYST',
  philosophical: 'PHILOSOPHER',
  task: 'OPERATOR',
};

class ContextualIdentityShifting extends EventEmitter {
  /**
   * @param {object} [opts]
   * @param {object} [opts.ai] - AI core for deeper context detection
   * @param {object} [opts.config] - Settings
   */
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null;
    this.config = Object.assign({
      transitionSpeed: 0.3,     // how fast blending shifts (0-1, higher = faster)
      autoDetect: true,         // auto-detect context shifts
      emergentThreshold: 5,     // activations before a blend can become a named profile
    }, opts.config || {});

    ensureDir();
    this._ensureProfiles();

    // Runtime state (also persisted)
    const saved = this._getState();
    this._activeConfig = saved.activeConfig || null;
    this._blendWeights = saved.blendWeights || {};  // { profileName: weight }
    this._lastInput = null;
    this._lastContext = saved.lastContext || null;
    this._transitionProgress = saved.transitionProgress || 1.0; // 1.0 = fully shifted
  }

  // ── Persistence ──

  _ensureProfiles() {
    if (!fs.existsSync(PROFILES_PATH)) {
      // Stamp createdAt
      const profiles = JSON.parse(JSON.stringify(DEFAULT_PROFILES));
      for (const p of Object.values(profiles)) p.createdAt = now();
      writeJSON(PROFILES_PATH, profiles);
    }
  }

  _getProfiles() { return readJSON(PROFILES_PATH, DEFAULT_PROFILES); }
  _saveProfiles(p) { writeJSON(PROFILES_PATH, p); }
  _getState() { return readJSON(STATE_PATH, {}); }
  _saveState() {
    writeJSON(STATE_PATH, {
      activeConfig: this._activeConfig,
      blendWeights: this._blendWeights,
      lastContext: this._lastContext,
      transitionProgress: this._transitionProgress,
      updatedAt: now(),
    });
  }
  _getPerf() { return readJSON(PERF_PATH, {}); }
  _savePerf(p) { writeJSON(PERF_PATH, p); }
  _getHistory() { return readJSON(HISTORY_PATH, []); }
  _appendHistory(entry) {
    const h = this._getHistory();
    h.push(Object.assign({ timestamp: now() }, entry));
    if (h.length > 500) h.splice(0, h.length - 500);
    writeJSON(HISTORY_PATH, h);
  }

  // ── Core Methods ──

  /**
   * Detect what context the input represents.
   * @param {string} input - User input or situation description
   * @param {object} [situation] - Additional context signals
   * @returns {{ context: string, confidence: number, suggestedProfile: string, scores: object }}
   */
  detectContext(input, situation) {
    const text = ((input || '') + ' ' + (situation ? JSON.stringify(situation) : '')).toLowerCase();
    const scores = {};

    for (const [ctx, keywords] of Object.entries(CONTEXT_SIGNALS)) {
      scores[ctx] = keywords.reduce((sum, kw) => sum + (text.includes(kw) ? 1 : 0), 0);
    }

    // Normalize by keyword count
    for (const ctx of Object.keys(scores)) {
      scores[ctx] = scores[ctx] / CONTEXT_SIGNALS[ctx].length;
    }

    const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    const context = best && best[1] > 0 ? best[0] : 'conversation';
    const confidence = best ? Math.min(1.0, best[1] * 5) : 0; // scale up

    return {
      context,
      confidence: Math.round(confidence * 100) / 100,
      suggestedProfile: CONTEXT_TO_PROFILE[context] || 'EMPATH',
      scores,
    };
  }

  /**
   * Shift to a named configuration.
   * @param {string} configName
   * @returns {object}
   */
  shift(configName) {
    const profiles = this._getProfiles();
    const name = configName.toUpperCase();
    const profile = profiles[name];
    if (!profile) return { error: 'Unknown profile: ' + configName, available: Object.keys(profiles) };

    const previous = this._activeConfig;

    // Save context memory for the outgoing config
    if (previous && profiles[previous]) {
      profiles[previous].contextMemory = profiles[previous].contextMemory || {};
      profiles[previous].contextMemory._lastActive = now();
    }

    // Activate new config
    profile.activations = (profile.activations || 0) + 1;
    this._activeConfig = name;
    this._blendWeights = { [name]: 1.0 };
    this._transitionProgress = this.config.transitionSpeed; // starts transitioning
    this._lastContext = name;

    this._saveProfiles(profiles);
    this._saveState();
    this._appendHistory({ action: 'shift', from: previous, to: name });
    this.emit('shift', { from: previous, to: name, profile });

    return {
      shifted: true,
      from: previous,
      to: name,
      profile: this._summarizeProfile(profile),
      transitionProgress: this._transitionProgress,
    };
  }

  /**
   * Blend multiple configurations with weights.
   * @param {string[]} configs - Profile names
   * @param {number[]} weights - Corresponding weights (will be normalized)
   * @returns {object}
   */
  blend(configs, weights) {
    if (!configs || configs.length < 1) return { error: 'Need at least 1 config' };
    const profiles = this._getProfiles();

    const w = weights || configs.map(() => 1.0 / configs.length);
    const totalW = w.reduce((s, v) => s + v, 0);
    const normWeights = w.map(v => v / totalW);

    const blendWeights = {};
    const missing = [];
    for (let i = 0; i < configs.length; i++) {
      const name = configs[i].toUpperCase();
      if (!profiles[name]) { missing.push(configs[i]); continue; }
      blendWeights[name] = normWeights[i];
    }
    if (missing.length > 0) return { error: 'Unknown profiles: ' + missing.join(', ') };

    this._blendWeights = blendWeights;
    this._activeConfig = 'BLEND:' + Object.keys(blendWeights).join('+');
    this._transitionProgress = this.config.transitionSpeed;

    this._saveState();
    this._appendHistory({ action: 'blend', configs: Object.keys(blendWeights), weights: blendWeights });
    this.emit('blend', blendWeights);

    // Compute effective config
    const effective = this._computeEffectiveConfig(profiles, blendWeights);

    return {
      blended: true,
      weights: blendWeights,
      effective,
      transitionProgress: this._transitionProgress,
    };
  }

  /**
   * Get the currently active configuration (resolved).
   * @returns {object}
   */
  getActiveConfig() {
    const profiles = this._getProfiles();

    if (!this._activeConfig) {
      return { name: 'DEFAULT', description: 'No active configuration — balanced defaults', moduleWeights: {}, attentionBias: { detail: 0.5, speed: 0.5, creativity: 0.5, empathy: 0.5 }, transitionProgress: 1.0 };
    }

    if (this._activeConfig.startsWith('BLEND:')) {
      const effective = this._computeEffectiveConfig(profiles, this._blendWeights);
      effective.transitionProgress = this._transitionProgress;
      return effective;
    }

    const profile = profiles[this._activeConfig];
    if (!profile) return { name: this._activeConfig, error: 'Profile not found' };

    const result = this._summarizeProfile(profile);
    result.transitionProgress = this._transitionProgress;
    return result;
  }

  /**
   * Get all available profiles.
   * @returns {object[]}
   */
  getProfiles() {
    const profiles = this._getProfiles();
    return Object.entries(profiles).map(([name, p]) => ({
      name,
      description: p.description,
      reasoningStyle: p.reasoningStyle,
      priorities: p.priorities,
      activations: p.activations || 0,
      isCustom: !!p.custom,
    }));
  }

  /**
   * Create a new configuration profile.
   * @param {string} name
   * @param {object} settings
   * @returns {object}
   */
  createProfile(name, settings) {
    if (!name) return { error: 'name required' };
    const profiles = this._getProfiles();
    const key = name.toUpperCase();

    const profile = {
      name: key,
      description: (settings && settings.description) || 'Custom profile: ' + name,
      moduleWeights: (settings && settings.moduleWeights) || {},
      reasoningStyle: (settings && settings.reasoningStyle) || 'adaptive',
      priorities: (settings && settings.priorities) || [],
      communicationPattern: (settings && settings.communicationPattern) || 'balanced',
      attentionBias: (settings && settings.attentionBias) || { detail: 0.5, speed: 0.5, creativity: 0.5, empathy: 0.5 },
      contextMemory: {},
      activations: 0,
      createdAt: now(),
      custom: true,
    };

    profiles[key] = profile;
    this._saveProfiles(profiles);
    this._appendHistory({ action: 'create', profile: key });
    this.emit('profile-created', profile);

    return profile;
  }

  /**
   * Get performance stats for a configuration.
   * @param {string} configName
   * @returns {object}
   */
  getPerformance(configName) {
    const perf = this._getPerf();
    const key = configName ? configName.toUpperCase() : null;

    if (key && perf[key]) return { name: key, ...perf[key] };
    if (key) return { name: key, activations: 0, totalDuration: 0, avgDuration: 0, successSignals: 0, failureSignals: 0, score: null };

    // Return all
    return Object.entries(perf).map(([name, data]) => ({ name, ...data }));
  }

  /**
   * Record a performance signal (success/failure) for the active config.
   * @param {'success'|'failure'} signal
   */
  recordPerformance(signal) {
    if (!this._activeConfig) return;
    const perf = this._getPerf();
    const key = this._activeConfig;
    if (!perf[key]) perf[key] = { activations: 0, totalDuration: 0, avgDuration: 0, successSignals: 0, failureSignals: 0 };

    if (signal === 'success') perf[key].successSignals++;
    else if (signal === 'failure') perf[key].failureSignals++;

    perf[key].score = perf[key].successSignals + perf[key].failureSignals > 0
      ? Math.round(perf[key].successSignals / (perf[key].successSignals + perf[key].failureSignals) * 100)
      : null;

    this._savePerf(perf);
  }

  /**
   * Periodic tick: advance transitions, auto-detect if enabled.
   * @param {string} [latestInput] - Most recent input for auto-detection
   * @returns {object}
   */
  tick(latestInput) {
    const result = { transitioned: false, autoShifted: false };

    // Advance transition
    if (this._transitionProgress < 1.0) {
      this._transitionProgress = Math.min(1.0, this._transitionProgress + this.config.transitionSpeed);
      result.transitioned = true;
      this._saveState();
    }

    // Auto-detect context shift
    if (this.config.autoDetect && latestInput) {
      const detection = this.detectContext(latestInput);
      if (detection.confidence > 0.3 && detection.suggestedProfile !== this._activeConfig) {
        const shiftResult = this.shift(detection.suggestedProfile);
        if (shiftResult.shifted) {
          result.autoShifted = true;
          result.shiftedTo = detection.suggestedProfile;
          result.context = detection.context;
          result.confidence = detection.confidence;
        }
      }
    }

    // Check for emergent configurations from history
    this._checkEmergentProfiles();

    return result;
  }

  // ── Internal ──

  _summarizeProfile(profile) {
    return {
      name: profile.name,
      description: profile.description,
      reasoningStyle: profile.reasoningStyle,
      priorities: profile.priorities,
      communicationPattern: profile.communicationPattern,
      moduleWeights: profile.moduleWeights,
      attentionBias: profile.attentionBias,
      activations: profile.activations || 0,
    };
  }

  _computeEffectiveConfig(profiles, weights) {
    const effective = {
      name: 'BLEND:' + Object.keys(weights).join('+'),
      description: 'Blended configuration',
      moduleWeights: {},
      attentionBias: { detail: 0, speed: 0, creativity: 0, empathy: 0 },
      priorities: [],
      reasoningStyle: 'blended',
      communicationPattern: 'adaptive',
    };

    const allModules = new Set();
    for (const name of Object.keys(weights)) {
      const p = profiles[name];
      if (!p) continue;
      for (const m of Object.keys(p.moduleWeights || {})) allModules.add(m);
    }

    for (const mod of allModules) {
      effective.moduleWeights[mod] = 0;
      for (const [name, w] of Object.entries(weights)) {
        const p = profiles[name];
        if (p && p.moduleWeights && p.moduleWeights[mod] != null) {
          effective.moduleWeights[mod] += p.moduleWeights[mod] * w;
        }
      }
      effective.moduleWeights[mod] = Math.round(effective.moduleWeights[mod] * 100) / 100;
    }

    for (const dim of ['detail', 'speed', 'creativity', 'empathy']) {
      for (const [name, w] of Object.entries(weights)) {
        const p = profiles[name];
        if (p && p.attentionBias && p.attentionBias[dim] != null) {
          effective.attentionBias[dim] += p.attentionBias[dim] * w;
        }
      }
      effective.attentionBias[dim] = Math.round(effective.attentionBias[dim] * 100) / 100;
    }

    // Collect priorities from all, weighted by blend weight
    const prioScores = {};
    for (const [name, w] of Object.entries(weights)) {
      const p = profiles[name];
      if (!p || !p.priorities) continue;
      for (let i = 0; i < p.priorities.length; i++) {
        const prio = p.priorities[i];
        prioScores[prio] = (prioScores[prio] || 0) + w * (p.priorities.length - i);
      }
    }
    effective.priorities = Object.entries(prioScores)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(e => e[0]);

    return effective;
  }

  _checkEmergentProfiles() {
    const history = this._getHistory();
    if (history.length < 20) return;

    // Look for repeated blend patterns in recent history
    const recentBlends = history
      .filter(h => h.action === 'blend')
      .slice(-20);

    const blendCounts = {};
    for (const b of recentBlends) {
      const key = (b.configs || []).sort().join('+');
      blendCounts[key] = (blendCounts[key] || 0) + 1;
    }

    const profiles = this._getProfiles();
    for (const [combo, count] of Object.entries(blendCounts)) {
      if (count >= this.config.emergentThreshold) {
        const emergentName = 'EMERGENT_' + combo.replace(/\+/g, '_');
        if (!profiles[emergentName]) {
          // Create an emergent profile from the blend
          const configs = combo.split('+');
          const weights = configs.map(() => 1.0 / configs.length);
          const blendW = {};
          configs.forEach((c, i) => { blendW[c] = weights[i]; });
          const effective = this._computeEffectiveConfig(profiles, blendW);

          profiles[emergentName] = {
            ...effective,
            name: emergentName,
            description: 'Emergent from frequent blend: ' + combo,
            contextMemory: {},
            activations: 0,
            createdAt: now(),
            emergent: true,
            sourceBlend: configs,
          };
          this._saveProfiles(profiles);
          this.emit('emergent-profile', profiles[emergentName]);
        }
      }
    }
  }
}

module.exports = ContextualIdentityShifting;
