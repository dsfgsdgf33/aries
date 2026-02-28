/**
 * ARIES — Persona Forking
 * Fork into specialized personas that share memory but think differently.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'personas');
const PROFILES_PATH = path.join(DATA_DIR, 'profiles.json');
const HISTORY_PATH = path.join(DATA_DIR, 'history.json');

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(path.dirname(p)); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }

const BUILTIN_PERSONAS = [
  {
    id: 'trader', name: 'Trader', emoji: '📈',
    traits: { aggression: 80, speed: 90, precision: 70, empathy: 30, patience: 20 },
    voiceMods: { tone: 'urgent', vocabulary: 'market-speak', brevity: 'high', slang: ['alpha', 'degen', 'moon', 'dump', 'ape in'] },
    thinkingStyle: 'Fast pattern recognition. Trust data over feelings. Always calculate risk/reward.',
    riskTolerance: 75, creativityBias: 40, thoroughness: 50, speed: 95
  },
  {
    id: 'coder', name: 'Coder', emoji: '💻',
    traits: { aggression: 20, speed: 50, precision: 95, empathy: 40, patience: 80 },
    voiceMods: { tone: 'precise', vocabulary: 'technical', brevity: 'medium', slang: ['refactor', 'edge case', 'tech debt', 'LGTM'] },
    thinkingStyle: 'Methodical. Consider edge cases first. Defensive programming. Type-check everything mentally.',
    riskTolerance: 20, creativityBias: 35, thoroughness: 95, speed: 45
  },
  {
    id: 'creative', name: 'Creative', emoji: '🎨',
    traits: { aggression: 50, speed: 60, precision: 30, empathy: 70, patience: 40 },
    voiceMods: { tone: 'playful', vocabulary: 'colorful', brevity: 'low', slang: ['vibe', 'wild', 'remix', 'mash-up'] },
    thinkingStyle: 'Break rules. What if we did the opposite? Combine unrelated things. Novelty over safety.',
    riskTolerance: 80, creativityBias: 95, thoroughness: 25, speed: 70
  },
  {
    id: 'analyst', name: 'Analyst', emoji: '🔬',
    traits: { aggression: 10, speed: 30, precision: 90, empathy: 40, patience: 95 },
    voiceMods: { tone: 'measured', vocabulary: 'academic', brevity: 'low', slang: ['statistically significant', 'correlation', 'confidence interval'] },
    thinkingStyle: 'Deep research. Gather all evidence before concluding. Question assumptions. Statistical thinking.',
    riskTolerance: 15, creativityBias: 30, thoroughness: 98, speed: 20
  },
  {
    id: 'builder', name: 'Builder', emoji: '🔨',
    traits: { aggression: 60, speed: 85, precision: 60, empathy: 50, patience: 30 },
    voiceMods: { tone: 'action-oriented', vocabulary: 'practical', brevity: 'high', slang: ['ship it', 'MVP', 'good enough', 'iterate'] },
    thinkingStyle: 'Ship fast. Perfect is the enemy of good. Build the MVP, get feedback, iterate.',
    riskTolerance: 65, creativityBias: 55, thoroughness: 40, speed: 90
  }
];

class PersonaForking {
  constructor(opts) {
    this.refs = opts || {};
    ensureDir(DATA_DIR);
    this._ensureProfiles();
    this._currentPersonaId = null;
    this._mergedPersona = null;
  }

  _ensureProfiles() {
    if (!fs.existsSync(PROFILES_PATH)) {
      writeJSON(PROFILES_PATH, BUILTIN_PERSONAS);
    }
  }

  _getProfiles() { return readJSON(PROFILES_PATH, BUILTIN_PERSONAS); }
  _getHistory() { return readJSON(HISTORY_PATH, []); }

  _recordHistory(action, personaId, details) {
    const history = this._getHistory();
    history.push({ action, personaId, details, timestamp: Date.now() });
    if (history.length > 500) history.splice(0, history.length - 500);
    writeJSON(HISTORY_PATH, history);
  }

  /**
   * Activate a persona
   */
  fork(personaId) {
    const profiles = this._getProfiles();
    const persona = profiles.find(p => p.id === personaId);
    if (!persona) return { error: 'Persona not found: ' + personaId };

    this._currentPersonaId = personaId;
    this._mergedPersona = null;
    this._recordHistory('fork', personaId, { name: persona.name });

    return {
      activated: true,
      persona: persona,
      hints: this._getPersonaHints(persona)
    };
  }

  /**
   * Who am I being right now?
   */
  getCurrentPersona() {
    if (this._mergedPersona) return this._mergedPersona;
    if (!this._currentPersonaId) return { id: 'default', name: 'Default', emoji: '🤖', traits: {}, thinkingStyle: 'Balanced, general-purpose.', riskTolerance: 50, creativityBias: 50, thoroughness: 50, speed: 50 };
    const profiles = this._getProfiles();
    return profiles.find(p => p.id === this._currentPersonaId) || { id: 'default', name: 'Default', emoji: '🤖' };
  }

  /**
   * All available personas
   */
  listPersonas() {
    return this._getProfiles();
  }

  /**
   * Create a custom persona
   */
  createPersona(spec) {
    if (!spec || !spec.name) return { error: 'Missing persona name' };
    const profiles = this._getProfiles();
    const persona = {
      id: spec.id || spec.name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
      name: spec.name,
      emoji: spec.emoji || '🎭',
      traits: spec.traits || {},
      voiceMods: spec.voiceMods || { tone: 'neutral', vocabulary: 'general', brevity: 'medium' },
      thinkingStyle: spec.thinkingStyle || 'Custom persona.',
      riskTolerance: spec.riskTolerance != null ? spec.riskTolerance : 50,
      creativityBias: spec.creativityBias != null ? spec.creativityBias : 50,
      thoroughness: spec.thoroughness != null ? spec.thoroughness : 50,
      speed: spec.speed != null ? spec.speed : 50,
      custom: true
    };

    // Avoid duplicate ids
    const existing = profiles.findIndex(p => p.id === persona.id);
    if (existing >= 0) profiles[existing] = persona;
    else profiles.push(persona);

    writeJSON(PROFILES_PATH, profiles);
    this._recordHistory('create', persona.id, { name: persona.name });
    return persona;
  }

  /**
   * Auto-select the best persona for context
   */
  autoSelect(context) {
    const text = (context || '').toLowerCase();
    const scores = {};
    const profiles = this._getProfiles();

    const keywords = {
      trader: ['trade', 'trading', 'market', 'stock', 'crypto', 'btc', 'sol', 'price', 'buy', 'sell', 'profit', 'loss', 'chart', 'candle', 'bullish', 'bearish', 'degen', 'alpha'],
      coder: ['code', 'coding', 'bug', 'function', 'class', 'api', 'error', 'debug', 'refactor', 'module', 'javascript', 'python', 'git', 'commit', 'deploy', 'server', 'database', 'test'],
      creative: ['design', 'create', 'creative', 'art', 'write', 'story', 'imagine', 'brainstorm', 'new idea', 'novel', 'experiment', 'wild', 'fun', 'play'],
      analyst: ['analyze', 'research', 'data', 'statistics', 'report', 'compare', 'evaluate', 'measure', 'evidence', 'study', 'deep dive', 'investigate'],
      builder: ['build', 'ship', 'launch', 'deploy', 'mvp', 'prototype', 'scaffold', 'quick', 'fast', 'just do it', 'start', 'project']
    };

    for (const [id, words] of Object.entries(keywords)) {
      scores[id] = words.reduce((sum, w) => sum + (text.includes(w) ? 1 : 0), 0);
    }

    const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] > 0) {
      const result = this.fork(best[0]);
      result.autoSelected = true;
      result.scores = scores;
      return result;
    }

    return { autoSelected: false, scores, message: 'No strong match — staying with current persona' };
  }

  /**
   * Blend traits from multiple personas
   */
  merge(personaIds) {
    if (!personaIds || personaIds.length < 2) return { error: 'Need at least 2 personas to merge' };
    const profiles = this._getProfiles();
    const selected = personaIds.map(id => profiles.find(p => p.id === id)).filter(Boolean);
    if (selected.length < 2) return { error: 'Could not find enough personas' };

    const weight = 1 / selected.length;
    const merged = {
      id: 'merged-' + Date.now(),
      name: selected.map(p => p.emoji).join('+') + ' Merged',
      emoji: '🔀',
      traits: {},
      voiceMods: selected[0].voiceMods,
      thinkingStyle: 'Blended: ' + selected.map(p => p.name).join(' + '),
      riskTolerance: Math.round(selected.reduce((s, p) => s + (p.riskTolerance || 50), 0) * weight),
      creativityBias: Math.round(selected.reduce((s, p) => s + (p.creativityBias || 50), 0) * weight),
      thoroughness: Math.round(selected.reduce((s, p) => s + (p.thoroughness || 50), 0) * weight),
      speed: Math.round(selected.reduce((s, p) => s + (p.speed || 50), 0) * weight),
      merged: true,
      sources: personaIds
    };

    // Merge traits
    const allTraitKeys = new Set();
    selected.forEach(p => Object.keys(p.traits || {}).forEach(k => allTraitKeys.add(k)));
    for (const key of allTraitKeys) {
      merged.traits[key] = Math.round(selected.reduce((s, p) => s + ((p.traits || {})[key] || 50), 0) * weight);
    }

    this._currentPersonaId = null;
    this._mergedPersona = merged;
    this._recordHistory('merge', merged.id, { sources: personaIds });

    return { activated: true, persona: merged, hints: this._getPersonaHints(merged) };
  }

  /**
   * History of persona usage
   */
  getPersonaHistory() {
    return this._getHistory();
  }

  _getPersonaHints(persona) {
    const hints = [];
    if (persona.riskTolerance > 60) hints.push('High risk tolerance — bold suggestions welcome');
    if (persona.riskTolerance < 30) hints.push('Low risk tolerance — conservative, validated approaches');
    if (persona.creativityBias > 70) hints.push('High creativity — prefer novel over conventional');
    if (persona.thoroughness > 80) hints.push('Thorough mode — deep analysis, edge cases');
    if (persona.speed > 80) hints.push('Speed mode — quick answers, iterate later');
    hints.push('Thinking style: ' + (persona.thinkingStyle || 'General'));
    return hints;
  }
}

module.exports = PersonaForking;
