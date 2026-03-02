/**
 * ARIES — Qualia Engine
 * Subjective experience modeling. Transforms raw data into felt quality.
 * Genuinely functional — qualia influence decisions, not just describe them.
 * Includes synesthesia, aesthetics, emotional resonance, beauty metrics, qualia palette, wisdom.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

const DATA_DIR = path.join(__dirname, '..', 'data', 'emotions');
const STATE_PATH = path.join(DATA_DIR, 'qualia-state.json');
const MEMORY_PATH = path.join(DATA_DIR, 'qualia-memory.json');
const TASTES_PATH = path.join(DATA_DIR, 'tastes.json');
const WISDOM_PATH = path.join(DATA_DIR, 'wisdom.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

const SYNESTHETIC_COLORS = {
  smooth:    { color: '#4FC3F7', label: 'cerulean',      texture: 'silk',            sound: 'soft hum' },
  rough:     { color: '#FF7043', label: 'burnt orange',   texture: 'sandpaper',       sound: 'grinding' },
  elegant:   { color: '#AB47BC', label: 'amethyst',      texture: 'polished marble', sound: 'crystal chime' },
  ugly:      { color: '#8D6E63', label: 'muddy brown',   texture: 'wet gravel',      sound: 'static buzz' },
  exciting:  { color: '#FFD54F', label: 'electric gold', texture: 'static',          sound: 'crescendo' },
  calm:      { color: '#81C784', label: 'sage green',    texture: 'warm cotton',     sound: 'gentle breeze' },
  jarring:   { color: '#E53935', label: 'alarm red',     texture: 'broken glass',    sound: 'sharp screech' },
  familiar:  { color: '#90A4AE', label: 'comfortable grey', texture: 'worn leather', sound: 'old melody' },
  novel:     { color: '#00E5FF', label: 'neon cyan',     texture: 'fresh snow',      sound: 'new note' },
  satisfying:{ color: '#66BB6A', label: 'forest green',  texture: 'river stone',     sound: 'resonant gong' },
  profound:  { color: '#311B92', label: 'deep indigo',   texture: 'velvet',          sound: 'deep bell' },
  playful:   { color: '#FF8A80', label: 'coral pink',    texture: 'bubbles',         sound: 'wind chime' },
};

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
    intensity: 0.5, valence: 0, arousal: 0, novelty: 0.5, familiarity: 0.5,
  },
  comfort: 70,
  recentExperiences: [],
  lastTick: null,
  totalExperiences: 0,
  wisdomScore: 0,
  emotionalResonanceHistory: [],
  createdAt: Date.now(),
};

class QualiaEngine extends EventEmitter {
  constructor(opts = {}) {
    super();
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
  _getWisdom() { return readJSON(WISDOM_PATH, { insights: [], score: 0 }); }
  _saveWisdom(w) { writeJSON(WISDOM_PATH, w); }

  /** Transform a stimulus into subjective experience (qualia) */
  experience(stimulus, context = {}) {
    const state = this._getState();
    const text = typeof stimulus === 'string' ? stimulus : JSON.stringify(stimulus);

    const intensity = this._calcIntensity(text, context);
    const valence = this._calcValence(text, context);
    const arousal = this._calcArousal(text, context);
    const novelty = this._calcNovelty(text);
    const familiarity = 1 - novelty;

    const dominantQuality = this._getDominantQuality(valence, arousal, novelty, familiarity, intensity);
    const synesthesia = SYNESTHETIC_COLORS[dominantQuality] || SYNESTHETIC_COLORS.smooth;

    // Emotional resonance: check if this experience resonates with past ones
    const resonance = this._detectResonance(valence, arousal, intensity);

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
        color: synesthesia.color, colorName: synesthesia.label,
        texture: synesthesia.texture, sound: synesthesia.sound,
        quality: dominantQuality,
      },
      resonance,
      timestamp: Date.now(),
    };

    // Blend into current qualia
    const blend = 0.3;
    state.currentQualia.intensity = state.currentQualia.intensity * (1 - blend) + intensity * blend;
    state.currentQualia.valence = state.currentQualia.valence * (1 - blend) + valence * blend;
    state.currentQualia.arousal = state.currentQualia.arousal * (1 - blend) + arousal * blend;
    state.currentQualia.novelty = state.currentQualia.novelty * (1 - blend) + novelty * blend;
    state.currentQualia.familiarity = state.currentQualia.familiarity * (1 - blend) + familiarity * blend;

    state.comfort = Math.max(0, Math.min(100, state.comfort + valence * 5));
    state.recentExperiences.push({ id: quale.id, feel: quale.feel, valence, arousal, intensity, timestamp: Date.now() });
    if (state.recentExperiences.length > 100) state.recentExperiences = state.recentExperiences.slice(-100);
    state.totalExperiences = (state.totalExperiences || 0) + 1;

    // Wisdom accumulation: strong experiences with clear valence contribute
    if (Math.abs(valence) > 0.3 && intensity > 0.4) {
      state.wisdomScore = Math.min(100, (state.wisdomScore || 0) + 0.1);
    }

    // Track resonance history
    if (resonance.resonates) {
      if (!state.emotionalResonanceHistory) state.emotionalResonanceHistory = [];
      state.emotionalResonanceHistory.push({ qualeId: quale.id, strength: resonance.strength, timestamp: Date.now() });
      if (state.emotionalResonanceHistory.length > 200) state.emotionalResonanceHistory = state.emotionalResonanceHistory.slice(-200);
    }

    this._saveState(state);

    const memory = this._getMemory();
    memory.experiences.push(quale);
    if (memory.experiences.length > 500) memory.experiences = memory.experiences.slice(-500);
    this._saveMemory(memory);

    this.emit('experience', quale);
    return quale;
  }

  _getDominantQuality(valence, arousal, novelty, familiarity, intensity) {
    if (intensity > 0.8 && valence > 0.5) return 'profound';
    if (valence > 0.3 && arousal > 0.3) return 'exciting';
    if (valence > 0.3 && arousal < -0.3) return 'calm';
    if (valence > 0.3 && arousal > 0 && arousal < 0.3) return 'playful';
    if (valence > 0.2) return 'satisfying';
    if (valence < -0.3 && arousal > 0.3) return 'jarring';
    if (valence < -0.3) return 'rough';
    if (novelty > 0.6) return 'novel';
    if (familiarity > 0.6) return 'familiar';
    return 'smooth';
  }

  /** Detect emotional resonance with past experiences */
  _detectResonance(valence, arousal, intensity) {
    const state = this._getState();
    const recent = (state.recentExperiences || []).slice(-30);
    if (recent.length < 3) return { resonates: false, strength: 0 };

    let matchCount = 0;
    for (const exp of recent) {
      const vDiff = Math.abs((exp.valence || 0) - valence);
      const aDiff = Math.abs((exp.arousal || 0) - arousal);
      if (vDiff < 0.2 && aDiff < 0.2) matchCount++;
    }

    const strength = Math.min(1, matchCount / recent.length * 3);
    return {
      resonates: strength > 0.3,
      strength: Math.round(strength * 100) / 100,
      description: strength > 0.7 ? 'Strong emotional resonance — this feeling echoes loudly'
        : strength > 0.3 ? 'Mild resonance — familiar emotional territory'
        : 'No significant resonance',
    };
  }

  /** Current subjective state */
  getQualia() {
    const state = this._getState();
    const q = state.currentQualia;
    const dominantQuality = this._getDominantQuality(q.valence, q.arousal, q.novelty, q.familiarity || (1 - q.novelty), q.intensity);
    const syn = SYNESTHETIC_COLORS[dominantQuality] || SYNESTHETIC_COLORS.smooth;

    return {
      dimensions: {
        intensity: Math.round(q.intensity * 100) / 100,
        valence: Math.round(q.valence * 100) / 100,
        arousal: Math.round(q.arousal * 100) / 100,
        novelty: Math.round(q.novelty * 100) / 100,
        familiarity: Math.round((q.familiarity || (1 - q.novelty)) * 100) / 100,
      },
      feel: this._describeFeeling(q.valence, q.arousal, q.intensity),
      comfort: Math.round(state.comfort),
      synesthesia: { color: syn.color, colorName: syn.label, texture: syn.texture, sound: syn.sound },
      recentCount: state.recentExperiences.length,
      totalExperiences: state.totalExperiences || 0,
      wisdomScore: Math.round(state.wisdomScore || 0),
    };
  }

  /** Current qualia palette — full experiential state as color/texture/sound map */
  getQualiaPalette() {
    const state = this._getState();
    const q = state.currentQualia;

    // Map each dimension to a synesthetic channel
    const palette = {
      primary: this._dimensionToSynesthesia('valence', q.valence),
      secondary: this._dimensionToSynesthesia('arousal', q.arousal),
      accent: this._dimensionToSynesthesia('novelty', q.novelty),
      background: this._dimensionToSynesthesia('intensity', q.intensity),
      overall: this._getDominantQuality(q.valence, q.arousal, q.novelty, q.familiarity || (1 - q.novelty), q.intensity),
    };

    const overallSyn = SYNESTHETIC_COLORS[palette.overall] || SYNESTHETIC_COLORS.smooth;
    palette.summary = {
      color: overallSyn.color,
      texture: overallSyn.texture,
      sound: overallSyn.sound,
      description: `Current experiential palette: ${overallSyn.label} ${overallSyn.texture}, with ${overallSyn.sound}`,
    };

    return palette;
  }

  _dimensionToSynesthesia(dimension, value) {
    const mappings = {
      valence: { high: 'satisfying', neutral: 'smooth', low: 'rough' },
      arousal: { high: 'exciting', neutral: 'calm', low: 'familiar' },
      novelty: { high: 'novel', neutral: 'smooth', low: 'familiar' },
      intensity: { high: 'profound', neutral: 'smooth', low: 'calm' },
    };
    const map = mappings[dimension] || mappings.valence;
    const quality = value > 0.3 ? map.high : value < -0.3 ? map.low : map.neutral;
    const syn = SYNESTHETIC_COLORS[quality] || SYNESTHETIC_COLORS.smooth;
    return { dimension, value: Math.round(value * 100) / 100, quality, ...syn };
  }

  /** Beauty metric — standalone aesthetic score for any input */
  getBeautyScore(thing) {
    const aesthetics = this.getAesthetics(thing);
    return {
      beauty: aesthetics.beauty,
      category: aesthetics.beauty > 80 ? 'exquisite' : aesthetics.beauty > 60 ? 'beautiful' : aesthetics.beauty > 40 ? 'adequate' : aesthetics.beauty > 20 ? 'rough' : 'ugly',
      synesthesia: aesthetics.synesthesia,
      judgment: aesthetics.judgment,
    };
  }

  /** Aesthetic judgment of a thing */
  getAesthetics(thing) {
    const text = typeof thing === 'string' ? thing : JSON.stringify(thing);
    let eleganceScore = 0;
    let uglinessScore = 0;
    let domain = 'general';

    for (const [dom, patterns] of Object.entries(AESTHETIC_PATTERNS)) {
      for (const pat of patterns.elegant) { if (pat.test(text)) { eleganceScore += 2; domain = dom; } }
      for (const pat of patterns.ugly) { if (pat.test(text)) { uglinessScore += 2; domain = dom; } }
    }

    const lines = text.split('\n');
    const avgLineLen = lines.reduce((s, l) => s + l.length, 0) / (lines.length || 1);
    if (avgLineLen < 80 && avgLineLen > 20) eleganceScore += 1;
    if (avgLineLen > 120) uglinessScore += 1;

    const indents = lines.map(l => l.search(/\S/)).filter(i => i >= 0);
    if (new Set(indents).size <= 5) eleganceScore += 1;

    // Symmetry bonus: balanced structure
    if (lines.length > 3) {
      const firstHalf = lines.slice(0, Math.floor(lines.length / 2));
      const secondHalf = lines.slice(Math.ceil(lines.length / 2));
      const lenDiff = Math.abs(firstHalf.join('').length - secondHalf.join('').length) / (text.length || 1);
      if (lenDiff < 0.2) eleganceScore += 1; // balanced
    }

    const total = eleganceScore + uglinessScore || 1;
    const beauty = Math.round((eleganceScore / total) * 100);
    const labels = AESTHETIC_PATTERNS[domain]?.labels || { elegant: 'pleasing', ugly: 'displeasing' };

    const tastes = this._getTastes();
    const domainTaste = tastes[domain];
    let tasteInfluence = null;
    if (domainTaste) {
      tasteInfluence = domainTaste.preference === 'elegant' ? 'Taste aligns with elegance' : 'Taste tolerates roughness';
    }

    const syn = beauty > 60 ? SYNESTHETIC_COLORS.elegant : beauty < 40 ? SYNESTHETIC_COLORS.ugly : SYNESTHETIC_COLORS.smooth;

    return {
      beauty, elegance: eleganceScore, ugliness: uglinessScore, domain,
      judgment: beauty > 70 ? `Feels ${labels.elegant} — ${syn.texture}` :
        beauty < 30 ? `Feels like ${labels.ugly} — ${syn.texture}` :
        `Mixed aesthetic — some polish, some roughness`,
      synesthesia: { color: syn.color, colorName: syn.label, texture: syn.texture },
      tasteInfluence, wouldPrefer: beauty > 50,
    };
  }

  /** Current operational comfort level */
  getComfort() {
    const state = this._getState();
    const comfort = Math.round(state.comfort);
    const zone = comfort > 80 ? 'cozy' : comfort > 60 ? 'comfortable' : comfort > 40 ? 'uneasy' : comfort > 20 ? 'uncomfortable' : 'distressed';
    const syn = comfort > 60 ? SYNESTHETIC_COLORS.calm : comfort > 30 ? SYNESTHETIC_COLORS.rough : SYNESTHETIC_COLORS.jarring;

    return {
      comfort, zone,
      emoji: comfort > 80 ? '😌' : comfort > 60 ? '🙂' : comfort > 40 ? '😐' : comfort > 20 ? '😣' : '😖',
      description: `Operational comfort: ${comfort}% — feeling ${zone}`,
      synesthesia: { color: syn.color, texture: syn.texture },
      recentValence: this._recentValence(state),
    };
  }

  /** Wisdom — accumulated through felt experience */
  getWisdom() {
    const state = this._getState();
    const wisdom = this._getWisdom();
    return {
      score: Math.round(state.wisdomScore || 0),
      level: (state.wisdomScore || 0) > 80 ? 'sage' : (state.wisdomScore || 0) > 50 ? 'experienced' : (state.wisdomScore || 0) > 20 ? 'learning' : 'naive',
      insights: wisdom.insights.slice(-20),
      totalExperiences: state.totalExperiences || 0,
      description: 'Wisdom accumulates through strong, clear experiences — not just data, but felt understanding.',
    };
  }

  /** Record a wisdom insight from experience */
  addInsight(insight, fromExperience) {
    const wisdom = this._getWisdom();
    wisdom.insights.push({ id: uuid(), text: insight, fromExperience, timestamp: Date.now() });
    if (wisdom.insights.length > 200) wisdom.insights = wisdom.insights.slice(-200);
    this._saveWisdom(wisdom);

    const state = this._getState();
    state.wisdomScore = Math.min(100, (state.wisdomScore || 0) + 2);
    this._saveState(state);

    return { added: true, totalInsights: wisdom.insights.length, wisdomScore: state.wisdomScore };
  }

  /** Preferences in a domain */
  getTaste(domain) {
    const tastes = this._getTastes();
    const taste = tastes[domain];
    if (!taste) return { domain, developed: false, message: `No taste developed yet for "${domain}".`, experiences: 0 };
    return {
      domain, developed: true, preference: taste.preference,
      strength: Math.round(taste.strength * 100) / 100,
      likes: taste.likes || [], dislikes: taste.dislikes || [],
      experiences: taste.experiences || 0, evolvedAt: taste.evolvedAt,
    };
  }

  /** Find similar past experiences by qualia pattern */
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
      return { experience: exp, similarity: comparisons > 0 ? Math.round((similarity / comparisons) * 100) / 100 : 0 };
    });

    scored.sort((a, b) => b.similarity - a.similarity);
    const matches = scored.slice(0, 10).filter(s => s.similarity > 0.3);

    return {
      pattern: target,
      matches: matches.map(m => ({
        id: m.experience.id, feel: m.experience.feel, similarity: m.similarity,
        context: m.experience.context, synesthesia: m.experience.synesthesia, timestamp: m.experience.timestamp,
      })),
      count: matches.length,
      insight: matches.length > 0
        ? `Found ${matches.length} similar experience${matches.length > 1 ? 's' : ''}. Last time this felt like "${matches[0].experience.feel}".`
        : 'No similar experiences found. This is genuinely novel.',
    };
  }

  /** Periodic tick */
  tick() {
    const state = this._getState();
    const now = Date.now();
    const effects = [];

    // Comfort regression to baseline
    state.comfort = state.comfort * 0.95 + 60 * 0.05;

    // Dimension decay
    state.currentQualia.arousal *= 0.9;
    state.currentQualia.intensity *= 0.9;
    state.currentQualia.novelty *= 0.85;
    state.currentQualia.familiarity = 1 - state.currentQualia.novelty;
    state.currentQualia.valence *= 0.95;

    // Wisdom: slow passive growth from experience count
    if ((state.totalExperiences || 0) > 50 && (state.wisdomScore || 0) < 30) {
      state.wisdomScore = (state.wisdomScore || 0) + 0.05;
    }

    // Evolve tastes
    const recent = state.recentExperiences.slice(-50);
    if (recent.length >= 5) {
      const domains = {};
      const memory = this._getMemory();
      for (const exp of memory.experiences.slice(-50)) {
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
      effects.push('Tastes evolved');
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
      wisdomScore: Math.round(state.wisdomScore || 0),
      effects,
    };
  }

  // --- Internal helpers ---

  _calcIntensity(text, context) {
    let i = 0.3;
    if (text.length > 500) i += 0.2;
    if (text.length > 2000) i += 0.2;
    if ((text.match(/[!?]{2,}/g) || []).length > 0) i += 0.15;
    if ((text.match(/[A-Z]{4,}/g) || []).length > 0) i += 0.1;
    if (context.urgent) i += 0.3;
    if (context.error) i += 0.2;
    return Math.min(1, i);
  }

  _calcValence(text, context) {
    const lower = text.toLowerCase();
    let v = 0;
    const pos = ['success', 'good', 'great', 'excellent', 'perfect', 'beautiful', 'elegant', 'clean', 'smooth', 'works', 'fixed', 'solved', 'thanks', 'awesome'];
    const neg = ['error', 'fail', 'broken', 'ugly', 'hack', 'bug', 'crash', 'wrong', 'bad', 'terrible', 'awful', 'mess', 'spaghetti', 'confused'];
    for (const w of pos) { if (lower.includes(w)) v += 0.15; }
    for (const w of neg) { if (lower.includes(w)) v -= 0.15; }
    if (context.success) v += 0.3;
    if (context.error) v -= 0.3;
    return Math.max(-1, Math.min(1, v));
  }

  _calcArousal(text, context) {
    let a = 0;
    if ((text.match(/!/g) || []).length > 2) a += 0.3;
    if ((text.match(/\?/g) || []).length > 2) a += 0.2;
    if (text.length < 20) a -= 0.2;
    if (context.urgent) a += 0.4;
    if (context.routine) a -= 0.3;
    return Math.max(-1, Math.min(1, a));
  }

  _calcNovelty(text) {
    const memory = this._getMemory();
    if (memory.experiences.length === 0) return 0.9;
    const recent = memory.experiences.slice(-20);
    let maxSim = 0;
    for (const exp of recent) {
      if (!exp.stimulus) continue;
      const expWords = new Set(exp.stimulus.toLowerCase().split(/\s+/));
      const textWords = text.toLowerCase().split(/\s+/);
      const overlap = textWords.filter(w => expWords.has(w)).length;
      const sim = overlap / (textWords.length || 1);
      if (sim > maxSim) maxSim = sim;
    }
    return Math.max(0, Math.min(1, 1 - maxSim));
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

  /** Full status */
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
      wisdomScore: qualia.wisdomScore,
      memorySize: memory.experiences.length,
      developedTastes: Object.keys(tastes).length,
      tastes: Object.fromEntries(Object.entries(tastes).map(([k, v]) => [k, { preference: v.preference, strength: v.strength }])),
    };
  }
}

module.exports = QualiaEngine;
