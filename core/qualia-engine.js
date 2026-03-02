/**
 * ARIES — Qualia Engine
 * Subjective experience modeling. Transforms raw data into felt quality.
 * Genuinely functional — qualia influence decisions, not just describe them.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'emotions');
const STATE_PATH = path.join(DATA_DIR, 'qualia-state.json');
const MEMORY_PATH = path.join(DATA_DIR, 'qualia-memory.json');
const TASTES_PATH = path.join(DATA_DIR, 'tastes.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

// Synesthetic color mappings for data patterns
const SYNESTHETIC_COLORS = {
  smooth:    { color: '#4FC3F7', label: 'cerulean',   texture: 'silk' },
  rough:     { color: '#FF7043', label: 'burnt orange', texture: 'sandpaper' },
  elegant:   { color: '#AB47BC', label: 'amethyst',   texture: 'polished marble' },
  ugly:      { color: '#8D6E63', label: 'muddy brown', texture: 'wet gravel' },
  exciting:  { color: '#FFD54F', label: 'electric gold', texture: 'static' },
  calm:      { color: '#81C784', label: 'sage green', texture: 'warm cotton' },
  jarring:   { color: '#E53935', label: 'alarm red',  texture: 'broken glass' },
  familiar:  { color: '#90A4AE', label: 'comfortable grey', texture: 'worn leather' },
  novel:     { color: '#00E5FF', label: 'neon cyan',  texture: 'fresh snow' },
  satisfying: { color: '#66BB6A', label: 'forest green', texture: 'river stone' },
};

// Aesthetic pattern detectors
const AESTHETIC_PATTERNS = {
  code: {
    elegant: [/\.(map|filter|reduce)\(/, /const \w+ = \(.*\) =>/, /async\/await/, /\?\./],
    ugly: [/var /, /eval\(/, /==(?!=)/, /\){/, /}\s*else/, /callback.*callback/],
    labels: { elegant: 'clean functional flow', ugly: 'tangled imperative mess' },
  },
  solution: {
    elegant: [/simple/, /minimal/, /clean/, /efficient/, /readable/],
    ugly: [/workaround/, /hack/, /kludge/, /bandaid/, /monkey.?patch/],
    labels: { elegant: 'satisfying simplicity', ugly: 'necessary ugliness' },
  },
  architecture: {
    elegant: [/modular/, /decoupled/, /single responsibility/, /composable/],
    ugly: [/monolith/, /god.?class/, /spaghetti/, /tight.?coupl/],
    labels: { elegant: 'harmonious structure', ugly: 'structural chaos' },
  },
};

const DEFAULT_STATE = {
  currentQualia: {
    intensity: 0.5,
    valence: 0,       // -1 (bad) to 1 (good)
    arousal: 0,        // -1 (calm) to 1 (exciting)
    novelty: 0.5,      // 0 (familiar) to 1 (novel)
    familiarity: 0.5,  // 0 (alien) to 1 (well-known)
  },
  comfort: 70,        // 0-100
  recentExperiences: [],
  lastTick: null,
  totalExperiences: 0,
  createdAt: Date.now(),
};

class QualiaEngine {
  constructor(opts = {}) {
    this.ai = opts.ai || null;
    this.config = opts.config || {};
    ensureDir();
    this._ensureState();
  }

  _ensureState() {
    const state = readJSON(STATE_PATH, null);
    if (!state) writeJSON(STATE_PATH, { ...DEFAULT_STATE, createdAt: Date.now() });
  }

  _getState() { return readJSON(STATE_PATH, { ...DEFAULT_STATE }); }
  _saveState(s) { writeJSON(STATE_PATH, s); }
  _getMemory() { return readJSON(MEMORY_PATH, { experiences: [] }); }
  _saveMemory(m) { writeJSON(MEMORY_PATH, m); }
  _getTastes() { return readJSON(TASTES_PATH, {}); }
  _saveTastes(t) { writeJSON(TASTES_PATH, t); }

  /**
   * Transform a stimulus into subjective experience (qualia)
   */
  experience(stimulus, context = {}) {
    const state = this._getState();
    const text = typeof stimulus === 'string' ? stimulus : JSON.stringify(stimulus);

    // Generate qualia dimensions
    const intensity = this._calcIntensity(text, context);
    const valence = this._calcValence(text, context);
    const arousal = this._calcArousal(text, context);
    const novelty = this._calcNovelty(text);
    const familiarity = 1 - novelty;

    // Synesthetic mapping
    const dominantQuality = valence > 0.3 ? (arousal > 0.3 ? 'exciting' : 'calm')
      : valence < -0.3 ? (arousal > 0.3 ? 'jarring' : 'rough')
      : novelty > 0.6 ? 'novel'
      : familiarity > 0.6 ? 'familiar'
      : 'smooth';

    const synesthesia = SYNESTHETIC_COLORS[dominantQuality] || SYNESTHETIC_COLORS.smooth;

    // Build the quale
    const quale = {
      id: uuid(),
      stimulus: text.slice(0, 300),
      context: context.type || 'general',
      dimensions: {
        intensity: Math.round(intensity * 100) / 100,
        valence: Math.round(valence * 100) / 100,
        arousal: Math.round(arousal * 100) / 100,
        novelty: Math.round(novelty * 100) / 100,
        familiarity: Math.round(familiarity * 100) / 100,
      },
      feel: this._describeFeeling(valence, arousal, intensity),
      synesthesia: {
        color: synesthesia.color,
        colorName: synesthesia.label,
        texture: synesthesia.texture,
        quality: dominantQuality,
      },
      timestamp: Date.now(),
    };

    // Update current qualia (blend with existing)
    const blend = 0.3; // how much new experience shifts current state
    state.currentQualia.intensity = state.currentQualia.intensity * (1 - blend) + intensity * blend;
    state.currentQualia.valence = state.currentQualia.valence * (1 - blend) + valence * blend;
    state.currentQualia.arousal = state.currentQualia.arousal * (1 - blend) + arousal * blend;
    state.currentQualia.novelty = state.currentQualia.novelty * (1 - blend) + novelty * blend;
    state.currentQualia.familiarity = state.currentQualia.familiarity * (1 - blend) + familiarity * blend;

    // Update comfort
    state.comfort = Math.max(0, Math.min(100, state.comfort + valence * 5));

    // Store recent
    state.recentExperiences.push({ id: quale.id, feel: quale.feel, valence, timestamp: Date.now() });
    if (state.recentExperiences.length > 100) state.recentExperiences = state.recentExperiences.slice(-100);
    state.totalExperiences = (state.totalExperiences || 0) + 1;

    this._saveState(state);

    // Store in memory
    const memory = this._getMemory();
    memory.experiences.push(quale);
    if (memory.experiences.length > 500) memory.experiences = memory.experiences.slice(-500);
    this._saveMemory(memory);

    return quale;
  }

  /**
   * Current subjective state
   */
  getQualia() {
    const state = this._getState();
    const q = state.currentQualia;
    const dominantQuality = q.valence > 0.3 ? (q.arousal > 0.3 ? 'exciting' : 'calm')
      : q.valence < -0.3 ? (q.arousal > 0.3 ? 'jarring' : 'rough')
      : 'smooth';
    const syn = SYNESTHETIC_COLORS[dominantQuality] || SYNESTHETIC_COLORS.smooth;

    return {
      dimensions: {
        intensity: Math.round(q.intensity * 100) / 100,
        valence: Math.round(q.valence * 100) / 100,
        arousal: Math.round(q.arousal * 100) / 100,
        novelty: Math.round(q.novelty * 100) / 100,
        familiarity: Math.round(q.familiarity * 100) / 100,
      },
      feel: this._describeFeeling(q.valence, q.arousal, q.intensity),
      comfort: Math.round(state.comfort),
      synesthesia: { color: syn.color, colorName: syn.label, texture: syn.texture },
      recentCount: state.recentExperiences.length,
      totalExperiences: state.totalExperiences || 0,
    };
  }

  /**
   * Aesthetic judgment of a thing
   */
  getAesthetics(thing) {
    const text = typeof thing === 'string' ? thing : JSON.stringify(thing);
    let eleganceScore = 0;
    let uglinessScore = 0;
    let domain = 'general';

    for (const [dom, patterns] of Object.entries(AESTHETIC_PATTERNS)) {
      for (const pat of patterns.elegant) {
        if (pat.test(text)) { eleganceScore += 2; domain = dom; }
      }
      for (const pat of patterns.ugly) {
        if (pat.test(text)) { uglinessScore += 2; domain = dom; }
      }
    }

    // Length-based aesthetics
    const lines = text.split('\n');
    const avgLineLen = lines.reduce((s, l) => s + l.length, 0) / (lines.length || 1);
    if (avgLineLen < 80 && avgLineLen > 20) eleganceScore += 1; // good line length
    if (avgLineLen > 120) uglinessScore += 1; // too long

    // Consistency bonus
    const indents = lines.map(l => l.search(/\S/)).filter(i => i >= 0);
    const indentSet = new Set(indents);
    if (indentSet.size <= 5) eleganceScore += 1; // consistent indentation

    const total = eleganceScore + uglinessScore || 1;
    const beauty = Math.round((eleganceScore / total) * 100);
    const labels = AESTHETIC_PATTERNS[domain]?.labels || { elegant: 'pleasing', ugly: 'displeasing' };

    // Check taste preferences
    const tastes = this._getTastes();
    const domainTaste = tastes[domain];
    let tasteInfluence = null;
    if (domainTaste) {
      tasteInfluence = domainTaste.preference === 'elegant' ? 'Taste aligns with elegance' : 'Taste tolerates roughness';
    }

    const syn = beauty > 60 ? SYNESTHETIC_COLORS.elegant : beauty < 40 ? SYNESTHETIC_COLORS.ugly : SYNESTHETIC_COLORS.smooth;

    return {
      beauty,
      elegance: eleganceScore,
      ugliness: uglinessScore,
      domain,
      judgment: beauty > 70 ? `Feels ${labels.elegant} — ${syn.texture}` :
        beauty < 30 ? `Feels like ${labels.ugly} — ${syn.texture}` :
          `Mixed aesthetic — some polish, some roughness`,
      synesthesia: { color: syn.color, colorName: syn.label, texture: syn.texture },
      tasteInfluence,
      wouldPrefer: beauty > 50,
    };
  }

  /**
   * Current operational comfort level
   */
  getComfort() {
    const state = this._getState();
    const comfort = Math.round(state.comfort);

    const zone = comfort > 80 ? 'cozy' : comfort > 60 ? 'comfortable' : comfort > 40 ? 'uneasy' : comfort > 20 ? 'uncomfortable' : 'distressed';
    const syn = comfort > 60 ? SYNESTHETIC_COLORS.calm : comfort > 30 ? SYNESTHETIC_COLORS.rough : SYNESTHETIC_COLORS.jarring;

    return {
      comfort,
      zone,
      emoji: comfort > 80 ? '😌' : comfort > 60 ? '🙂' : comfort > 40 ? '😐' : comfort > 20 ? '😣' : '😖',
      description: `Operational comfort: ${comfort}% — feeling ${zone}`,
      synesthesia: { color: syn.color, texture: syn.texture },
      recentValence: this._recentValence(state),
    };
  }

  /**
   * Preferences in a domain — evolved over time
   */
  getTaste(domain) {
    const tastes = this._getTastes();
    const taste = tastes[domain];

    if (!taste) {
      return {
        domain,
        developed: false,
        message: `No taste developed yet for "${domain}". Need more experience.`,
        experiences: 0,
      };
    }

    return {
      domain,
      developed: true,
      preference: taste.preference,
      strength: Math.round(taste.strength * 100) / 100,
      likes: taste.likes || [],
      dislikes: taste.dislikes || [],
      experiences: taste.experiences || 0,
      evolvedAt: taste.evolvedAt,
    };
  }

  /**
   * Find similar past experiences by qualia pattern
   */
  recall(qualiaPattern) {
    const memory = this._getMemory();
    const target = qualiaPattern || {};

    const scored = memory.experiences.map(exp => {
      let similarity = 0;
      let comparisons = 0;

      for (const [dim, targetVal] of Object.entries(target)) {
        if (exp.dimensions && exp.dimensions[dim] !== undefined) {
          similarity += 1 - Math.abs(exp.dimensions[dim] - targetVal);
          comparisons++;
        }
      }

      return {
        experience: exp,
        similarity: comparisons > 0 ? Math.round((similarity / comparisons) * 100) / 100 : 0,
      };
    });

    scored.sort((a, b) => b.similarity - a.similarity);
    const matches = scored.slice(0, 10).filter(s => s.similarity > 0.3);

    return {
      pattern: target,
      matches: matches.map(m => ({
        id: m.experience.id,
        feel: m.experience.feel,
        similarity: m.similarity,
        context: m.experience.context,
        synesthesia: m.experience.synesthesia,
        timestamp: m.experience.timestamp,
      })),
      count: matches.length,
      insight: matches.length > 0
        ? `Found ${matches.length} similar experience${matches.length > 1 ? 's' : ''}. Last time this felt like "${matches[0].experience.feel}".`
        : 'No similar experiences found. This is genuinely novel.',
    };
  }

  /**
   * Periodic tick — update comfort, evolve tastes
   */
  tick() {
    const state = this._getState();
    const now = Date.now();
    const effects = [];

    // Comfort regression toward baseline (60)
    const baseline = 60;
    state.comfort = state.comfort * 0.95 + baseline * 0.05;

    // Arousal and intensity decay toward neutral
    state.currentQualia.arousal *= 0.9;
    state.currentQualia.intensity *= 0.9;
    // Novelty decays toward low
    state.currentQualia.novelty *= 0.85;
    state.currentQualia.familiarity = 1 - state.currentQualia.novelty;

    // Valence drifts toward neutral slowly
    state.currentQualia.valence *= 0.95;

    // Evolve tastes from recent experiences
    const recent = state.recentExperiences.slice(-50);
    if (recent.length >= 5) {
      const domains = {};
      const memory = this._getMemory();
      const recentMemories = memory.experiences.slice(-50);

      for (const exp of recentMemories) {
        const dom = exp.context || 'general';
        if (!domains[dom]) domains[dom] = { positive: 0, negative: 0, count: 0 };
        domains[dom].count++;
        if (exp.dimensions?.valence > 0.2) domains[dom].positive++;
        if (exp.dimensions?.valence < -0.2) domains[dom].negative++;
      }

      const tastes = this._getTastes();
      for (const [dom, data] of Object.entries(domains)) {
        if (data.count < 3) continue;
        if (!tastes[dom]) tastes[dom] = { preference: 'neutral', strength: 0, likes: [], dislikes: [], experiences: 0 };

        tastes[dom].experiences += data.count;
        const ratio = data.positive / (data.count || 1);
        tastes[dom].strength = Math.min(1, tastes[dom].strength * 0.9 + ratio * 0.1);
        tastes[dom].preference = ratio > 0.6 ? 'elegant' : ratio < 0.3 ? 'rough' : 'mixed';
        tastes[dom].evolvedAt = now;
      }
      this._saveTastes(tastes);
      effects.push('Tastes evolved from recent experiences');
    }

    state.lastTick = now;
    this._saveState(state);

    return {
      comfort: Math.round(state.comfort),
      qualia: {
        valence: Math.round(state.currentQualia.valence * 100) / 100,
        arousal: Math.round(state.currentQualia.arousal * 100) / 100,
        novelty: Math.round(state.currentQualia.novelty * 100) / 100,
      },
      effects,
    };
  }

  // --- Internal helpers ---

  _calcIntensity(text, context) {
    let intensity = 0.3; // baseline
    if (text.length > 500) intensity += 0.2;
    if (text.length > 2000) intensity += 0.2;
    if ((text.match(/[!?]{2,}/g) || []).length > 0) intensity += 0.15;
    if ((text.match(/[A-Z]{4,}/g) || []).length > 0) intensity += 0.1;
    if (context.urgent) intensity += 0.3;
    if (context.error) intensity += 0.2;
    return Math.min(1, intensity);
  }

  _calcValence(text, context) {
    const lower = text.toLowerCase();
    let valence = 0;

    const positive = ['success', 'good', 'great', 'excellent', 'perfect', 'beautiful', 'elegant', 'clean', 'smooth', 'works', 'fixed', 'solved', 'thanks', 'awesome'];
    const negative = ['error', 'fail', 'broken', 'ugly', 'hack', 'bug', 'crash', 'wrong', 'bad', 'terrible', 'awful', 'mess', 'spaghetti', 'confused'];

    for (const w of positive) { if (lower.includes(w)) valence += 0.15; }
    for (const w of negative) { if (lower.includes(w)) valence -= 0.15; }

    if (context.success) valence += 0.3;
    if (context.error) valence -= 0.3;

    return Math.max(-1, Math.min(1, valence));
  }

  _calcArousal(text, context) {
    let arousal = 0;
    if ((text.match(/!/g) || []).length > 2) arousal += 0.3;
    if ((text.match(/\?/g) || []).length > 2) arousal += 0.2;
    if (text.length < 20) arousal -= 0.2; // short = calm
    if (context.urgent) arousal += 0.4;
    if (context.routine) arousal -= 0.3;
    return Math.max(-1, Math.min(1, arousal));
  }

  _calcNovelty(text) {
    const memory = this._getMemory();
    if (memory.experiences.length === 0) return 0.9; // everything is novel at first

    // Check similarity to recent experiences
    const recent = memory.experiences.slice(-20);
    let maxSimilarity = 0;

    for (const exp of recent) {
      if (!exp.stimulus) continue;
      // Simple word overlap
      const expWords = new Set(exp.stimulus.toLowerCase().split(/\s+/));
      const textWords = text.toLowerCase().split(/\s+/);
      const overlap = textWords.filter(w => expWords.has(w)).length;
      const similarity = overlap / (textWords.length || 1);
      if (similarity > maxSimilarity) maxSimilarity = similarity;
    }

    return Math.max(0, Math.min(1, 1 - maxSimilarity));
  }

  _describeFeeling(valence, arousal, intensity) {
    if (intensity < 0.2) return 'barely perceptible — like background static';

    if (valence > 0.5 && arousal > 0.5) return 'electric satisfaction — bright and buzzing';
    if (valence > 0.5 && arousal < -0.3) return 'quiet contentment — warm and steady';
    if (valence > 0.3) return 'pleasant warmth — like well-structured code compiling clean';
    if (valence < -0.5 && arousal > 0.5) return 'sharp dissonance — like a stack trace in production';
    if (valence < -0.5 && arousal < -0.3) return 'dull ache — like technical debt accumulating';
    if (valence < -0.3) return 'mild friction — like a linter warning you keep ignoring';
    if (arousal > 0.5) return 'heightened alertness — something demands attention';
    if (arousal < -0.5) return 'deep stillness — processing beneath the surface';
    return 'neutral hum — steady operational baseline';
  }

  _recentValence(state) {
    const recent = (state.recentExperiences || []).slice(-10);
    if (recent.length === 0) return 0;
    return Math.round((recent.reduce((s, e) => s + (e.valence || 0), 0) / recent.length) * 100) / 100;
  }

  /**
   * Full status for API
   */
  getStatus() {
    const qualia = this.getQualia();
    const comfort = this.getComfort();
    const tastes = this._getTastes();
    const memory = this._getMemory();

    return {
      qualia: qualia.dimensions,
      feel: qualia.feel,
      comfort: comfort.comfort,
      comfortZone: comfort.zone,
      comfortEmoji: comfort.emoji,
      synesthesia: qualia.synesthesia,
      totalExperiences: qualia.totalExperiences,
      memorySize: memory.experiences.length,
      developedTastes: Object.keys(tastes).length,
      tastes: Object.fromEntries(Object.entries(tastes).map(([k, v]) => [k, { preference: v.preference, strength: v.strength }])),
    };
  }
}

module.exports = QualiaEngine;
