/**
 * ARIES — Synesthesia
 * Cross-modal processing: analyze one type of input using another domain's principles.
 * CODE→MUSIC, DATA→TEXTURE, ARCHITECTURE→PHYSICS, UI→EMOTION, LOGIC→TASTE
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'synesthesia');
const ANALYSES_PATH = path.join(DATA_DIR, 'analyses.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

const DOMAINS = {
  CODE: { emoji: '💻', label: 'Code' },
  MUSIC: { emoji: '🎵', label: 'Music' },
  DATA: { emoji: '📊', label: 'Data' },
  TEXTURE: { emoji: '🧶', label: 'Texture' },
  ARCHITECTURE: { emoji: '🏗️', label: 'Architecture' },
  PHYSICS: { emoji: '⚛️', label: 'Physics' },
  UI: { emoji: '🎨', label: 'UI/UX' },
  EMOTION: { emoji: '❤️', label: 'Emotion' },
  LOGIC: { emoji: '🧠', label: 'Logic' },
  TASTE: { emoji: '👅', label: 'Taste' },
};

const MAPPINGS = {
  'CODE→MUSIC': {
    label: 'Code as Music',
    description: 'Analyzing code structure as musical composition',
    analyze(input) {
      const lines = input.split('\n');
      const indentPattern = lines.map(l => l.search(/\S/)).filter(i => i >= 0);
      const avgIndent = indentPattern.reduce((a, b) => a + b, 0) / (indentPattern.length || 1);
      const braceCount = (input.match(/[{}]/g) || []).length;
      const funcCount = (input.match(/function|=>|async/g) || []).length;
      const commentCount = (input.match(/\/\/|\/\*/g) || []).length;
      const repetition = lines.length > 0 ? new Set(lines.map(l => l.trim())).size / lines.length : 1;

      const harmony = Math.min(100, Math.round(repetition * 60 + (commentCount / (lines.length || 1)) * 200));
      const rhythm = Math.min(100, Math.round((1 - Math.abs(avgIndent - 4) / 8) * 100));
      const complexity = Math.min(100, Math.round((braceCount + funcCount) / (lines.length || 1) * 100));
      const dissonance = Math.min(100, Math.round((input.match(/TODO|FIXME|HACK|XXX|bug/gi) || []).length * 15));

      const tempo = lines.length < 30 ? 'Allegro (short, quick)' : lines.length < 100 ? 'Andante (moderate)' : 'Adagio (long, slow)';
      const key = harmony > 70 ? 'Major (bright, consistent)' : harmony > 40 ? 'Minor (moody, varied)' : 'Chromatic (chaotic)';

      return {
        harmony, rhythm, complexity, dissonance, tempo, key,
        description: `This code plays in ${key} at ${tempo}. Harmony: ${harmony}% (consistency), Rhythm: ${rhythm}% (indentation flow), Dissonance: ${dissonance}% (code smells). ${dissonance > 30 ? 'There are harsh notes that need resolving.' : 'A pleasant composition overall.'}`,
        emoji: dissonance > 50 ? '🎸' : harmony > 70 ? '🎻' : '🎹'
      };
    }
  },
  'DATA→TEXTURE': {
    label: 'Data as Texture',
    description: 'Data patterns as tactile sensations',
    analyze(input) {
      const numbers = input.match(/-?\d+\.?\d*/g);
      if (!numbers || numbers.length < 2) {
        return { texture: 'void', smoothness: 0, description: 'No numerical data detected — the surface is featureless, like touching nothing.', emoji: '🕳️' };
      }
      const vals = numbers.map(Number);
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const variance = vals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / vals.length;
      const stddev = Math.sqrt(variance);
      const range = Math.max(...vals) - Math.min(...vals);
      const outliers = vals.filter(v => Math.abs(v - mean) > 2 * stddev).length;

      const smoothness = Math.max(0, Math.min(100, Math.round(100 - (stddev / (range || 1)) * 100)));
      const sharpness = Math.min(100, Math.round((outliers / vals.length) * 300));

      let texture, emoji;
      if (smoothness > 80 && sharpness < 10) { texture = 'Silk'; emoji = '🧵'; }
      else if (smoothness > 60) { texture = 'Velvet'; emoji = '🧤'; }
      else if (sharpness > 40) { texture = 'Gravel with glass shards'; emoji = '💎'; }
      else if (smoothness > 30) { texture = 'Sandpaper'; emoji = '📐'; }
      else { texture = 'Rough bark'; emoji = '🪵'; }

      return {
        texture, smoothness, sharpness, variance: Math.round(variance * 100) / 100,
        dataPoints: vals.length, outliers,
        description: `This data feels like ${texture}. Smoothness: ${smoothness}% — ${smoothness > 70 ? 'runs through fingers effortlessly' : 'catches and snags'}. ${outliers > 0 ? `${outliers} sharp point${outliers > 1 ? 's' : ''} (outlier${outliers > 1 ? 's' : ''}) poke through the surface.` : 'No sharp edges detected.'}`,
        emoji
      };
    }
  },
  'ARCHITECTURE→PHYSICS': {
    label: 'Architecture as Physics',
    description: 'System design evaluated through physical principles',
    analyze(input) {
      const modules = (input.match(/require\(|import |module|class |function /g) || []).length;
      const dependencies = (input.match(/require\(/g) || []).length;
      const exports = (input.match(/module\.exports|export /g) || []).length;
      const errorHandling = (input.match(/try|catch|throw|Error/g) || []).length;
      const lines = input.split('\n').length;

      const mass = Math.min(100, Math.round(lines / 5));
      const balance = dependencies > 0 ? Math.min(100, Math.round((exports / dependencies) * 100)) : 50;
      const integrity = Math.min(100, Math.round(errorHandling / (lines / 50) * 100));
      const loadDist = modules > 0 ? Math.min(100, Math.round((1 - Math.abs(dependencies - exports) / modules) * 100)) : 50;

      const stable = balance > 50 && integrity > 40;
      return {
        mass, balance, structural_integrity: integrity, load_distribution: loadDist, stable,
        description: `This system has mass ${mass} (${lines} lines). Balance: ${balance}% — ${balance > 70 ? 'well-distributed load' : 'top-heavy, might topple under stress'}. Structural integrity: ${integrity}% — ${integrity > 60 ? 'reinforced against failure' : 'brittle, lacks error handling'}. ${stable ? '🏛️ Standing firm.' : '⚠️ Structurally unstable.'}`,
        emoji: stable ? '🏛️' : '🏚️'
      };
    }
  },
  'UI→EMOTION': {
    label: 'UI as Emotion',
    description: 'Colors and layout evoking feelings',
    analyze(input) {
      const lowered = input.toLowerCase();
      const warmColors = (lowered.match(/#f[0-9a-f]{5}|red|orange|yellow|warm|#e[0-9a-f]{5}/g) || []).length;
      const coolColors = (lowered.match(/#0[0-9a-f]{5}|blue|cyan|teal|cool|#00/g) || []).length;
      const darkTheme = (lowered.match(/dark|#0[0-3][0-9a-f]{4}|#1[0-9a-f]{5}|black/g) || []).length;
      const lightTheme = (lowered.match(/light|white|#f[0-9a-f]{5}|bright/g) || []).length;
      const rounded = (lowered.match(/border-radius|rounded|circle/g) || []).length;
      const sharp = (lowered.match(/sharp|angular|square/g) || []).length;
      const animations = (lowered.match(/transition|animation|transform|hover/g) || []).length;

      const warmth = warmColors > coolColors ? 'warm' : coolColors > warmColors ? 'cool' : 'neutral';
      const mood = darkTheme > lightTheme ? 'mysterious' : lightTheme > darkTheme ? 'cheerful' : 'balanced';
      const energy = Math.min(100, animations * 15);

      let emotion, emoji;
      if (warmth === 'warm' && mood === 'cheerful') { emotion = 'Joyful & Inviting'; emoji = '😊'; }
      else if (warmth === 'cool' && mood === 'mysterious') { emotion = 'Calm & Intriguing'; emoji = '🌙'; }
      else if (energy > 60) { emotion = 'Energetic & Dynamic'; emoji = '⚡'; }
      else if (mood === 'mysterious') { emotion = 'Moody & Atmospheric'; emoji = '🌌'; }
      else { emotion = 'Clean & Professional'; emoji = '✨'; }

      return {
        warmth, mood, energy, emotion,
        softness: rounded > sharp ? 'soft' : sharp > rounded ? 'hard' : 'mixed',
        description: `This UI evokes "${emotion}". It feels ${warmth}, ${mood}, with ${energy}% energy. ${rounded > 0 ? 'Rounded edges soften the experience.' : ''} ${animations > 3 ? 'Rich animations bring it alive.' : 'Minimal motion — contemplative.'} The emotional signature: ${emoji}`,
        emoji
      };
    }
  },
  'LOGIC→TASTE': {
    label: 'Logic as Taste',
    description: 'Arguments evaluated as flavors',
    analyze(input) {
      const lowered = input.toLowerCase();
      const evidence = (lowered.match(/because|therefore|thus|evidence|proves|data shows|research/g) || []).length;
      const hedging = (lowered.match(/maybe|perhaps|might|could|possibly|arguably/g) || []).length;
      const forceful = (lowered.match(/must|always|never|obviously|clearly|undeniably/g) || []).length;
      const nuanced = (lowered.match(/however|although|on the other hand|alternatively|nuance|complex/g) || []).length;
      const flawed = (lowered.match(/but|except|unless|problem|issue|flaw|wrong/g) || []).length;
      const words = input.split(/\s+/).length;

      let taste, emoji, flavor;
      const sweetness = Math.min(100, evidence * 15);
      const bitterness = Math.min(100, forceful * 20);
      const sourness = Math.min(100, flawed * 15);
      const savoriness = Math.min(100, nuanced * 20);
      const mildness = Math.min(100, hedging * 15);

      if (sweetness > 60 && savoriness > 40) { taste = 'Umami'; emoji = '🍜'; flavor = 'Rich, satisfying, deeply compelling'; }
      else if (sweetness > 60) { taste = 'Sweet'; emoji = '🍯'; flavor = 'Compelling and well-supported'; }
      else if (bitterness > 50) { taste = 'Bitter'; emoji = '☕'; flavor = 'Forced and overly assertive'; }
      else if (sourness > 50) { taste = 'Sour'; emoji = '🍋'; flavor = 'Flawed but piquant'; }
      else if (savoriness > 50) { taste = 'Savory'; emoji = '🧀'; flavor = 'Nuanced and satisfying'; }
      else if (mildness > 50) { taste = 'Bland'; emoji = '🍚'; flavor = 'Too hedged to have real flavor'; }
      else { taste = 'Plain'; emoji = '🍞'; flavor = 'Straightforward, no strong flavor'; }

      return {
        taste, flavor, sweetness, bitterness, sourness, savoriness, mildness,
        wordCount: words,
        description: `This argument tastes ${taste.toLowerCase()} — ${flavor}. Sweetness (evidence): ${sweetness}%, Bitterness (force): ${bitterness}%, Sourness (flaws): ${sourness}%, Savoriness (nuance): ${savoriness}%. ${emoji} ${taste === 'Umami' ? 'A chef\'s kiss of reasoning.' : taste === 'Bitter' ? 'Needs sugar (more evidence, less force).' : 'Could use more seasoning.'}`,
        emoji
      };
    }
  }
};

// Auto-detection: which domain does input likely belong to?
function detectDomain(input) {
  const lowered = input.toLowerCase();
  if (lowered.match(/function |const |let |var |=>|require\(|import |class |module/)) return 'CODE';
  if (lowered.match(/#[0-9a-f]{6}|border-radius|padding|margin|display:|color:|background/)) return 'UI';
  if (lowered.match(/because|therefore|argument|conclude|premise|evidence|thus/)) return 'LOGIC';
  if (lowered.match(/\d+\.\d+.*\d+\.\d+|\d+,\s*\d+/)) return 'DATA';
  if (lowered.match(/module|service|endpoint|api|database|architecture|system/)) return 'ARCHITECTURE';
  return 'LOGIC'; // default
}

const DOMAIN_TO_MAPPINGS = {
  'CODE': ['CODE→MUSIC'],
  'DATA': ['DATA→TEXTURE'],
  'ARCHITECTURE': ['ARCHITECTURE→PHYSICS'],
  'UI': ['UI→EMOTION'],
  'LOGIC': ['LOGIC→TASTE'],
};

class Synesthesia {
  constructor() {
    ensureDir();
  }

  /**
   * Cross-modal analysis.
   */
  perceive(input, fromDomain, toDomain) {
    const mappingKey = `${fromDomain}→${toDomain}`;
    const mapping = MAPPINGS[mappingKey];
    if (!mapping) {
      return { error: `No mapping for ${mappingKey}. Available: ${Object.keys(MAPPINGS).join(', ')}` };
    }

    const result = mapping.analyze(input);
    const analysis = {
      id: uuid(),
      fromDomain, toDomain, mappingKey,
      label: mapping.label,
      input: input.slice(0, 500),
      result,
      timestamp: Date.now()
    };

    this._store(analysis);
    return analysis;
  }

  /**
   * Auto-detect best mapping and apply.
   */
  getInsight(input) {
    const fromDomain = detectDomain(input);
    const mappings = DOMAIN_TO_MAPPINGS[fromDomain] || [];
    if (mappings.length === 0) {
      return { error: 'Could not determine appropriate mapping', detectedDomain: fromDomain };
    }

    const mappingKey = mappings[0];
    const [from, to] = mappingKey.split('→');
    return this.perceive(input, from, to);
  }

  /**
   * Full multi-modal report of a target.
   */
  getSynestheticReport(input) {
    const results = {};
    for (const [key, mapping] of Object.entries(MAPPINGS)) {
      try {
        results[key] = { label: mapping.label, ...mapping.analyze(input) };
      } catch (e) {
        results[key] = { label: mapping.label, error: e.message };
      }
    }

    const report = {
      id: uuid(),
      type: 'full_report',
      input: input.slice(0, 500),
      analyses: results,
      timestamp: Date.now()
    };

    this._store(report);
    return report;
  }

  /**
   * Past analyses.
   */
  getHistory(limit) {
    const data = readJSON(ANALYSES_PATH, { entries: [] });
    return { entries: data.entries.slice(-(limit || 20)) };
  }

  /**
   * Get available mappings.
   */
  getMappings() {
    return Object.entries(MAPPINGS).map(([key, m]) => ({
      key,
      label: m.label,
      description: m.description,
      from: key.split('→')[0],
      to: key.split('→')[1]
    }));
  }

  /**
   * Get available domains.
   */
  getDomains() {
    return DOMAINS;
  }

  _store(analysis) {
    const data = readJSON(ANALYSES_PATH, { entries: [] });
    data.entries.push(analysis);
    if (data.entries.length > 500) data.entries = data.entries.slice(-500);
    writeJSON(ANALYSES_PATH, data);
  }

  /**
   * Status for API.
   */
  getStatus() {
    const data = readJSON(ANALYSES_PATH, { entries: [] });
    return {
      mappings: this.getMappings(),
      domains: DOMAINS,
      totalAnalyses: data.entries.length,
      recentAnalyses: data.entries.slice(-5)
    };
  }
}

module.exports = Synesthesia;
