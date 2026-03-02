/**
 * ARIES — Semantic Metabolism
 * Information digestion framework. Raw data → parsed → extracted → integrated → applied.
 * 5 enzyme types, nutritional analysis, toxin detection, malnutrition detection,
 * metabolic rate, waste products, dietary recommendations.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

const DATA_DIR = path.join(__dirname, '..', 'data', 'knowledge');
const INGESTIONS_PATH = path.join(DATA_DIR, 'ingestions.json');
const ABSORBED_PATH = path.join(DATA_DIR, 'absorbed.json');
const WASTE_PATH = path.join(DATA_DIR, 'waste.json');
const METABOLISM_PATH = path.join(DATA_DIR, 'metabolism-state.json');
const TOXINS_PATH = path.join(DATA_DIR, 'toxins.json');

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }

const STAGES = ['RAW', 'PARSED', 'EXTRACTED', 'INTEGRATED', 'APPLIED'];

const ENZYMES = {
  factual:    { speed: 1.0, efficiency: 0.9, description: 'Processes facts, data, statistics', ideal: 0.25 },
  procedural: { speed: 0.7, efficiency: 0.8, description: 'Processes how-to knowledge, steps, methods', ideal: 0.2 },
  emotional:  { speed: 1.2, efficiency: 0.6, description: 'Processes feelings, moods, social cues', ideal: 0.15 },
  creative:   { speed: 0.5, efficiency: 0.7, description: 'Processes ideas, art, novel concepts', ideal: 0.2 },
  meta:       { speed: 0.4, efficiency: 0.5, description: 'Processes self-referential, abstract knowledge', ideal: 0.2 },
};

const TOXIN_PATTERNS = [
  { name: 'contradiction', pattern: /\b(but also|however|on the other hand|contradicts)\b/i, severity: 'mild', description: 'Contradictory information' },
  { name: 'misinformation', pattern: /\b(fake|hoax|debunked|false claim|conspiracy)\b/i, severity: 'severe', description: 'Potential misinformation' },
  { name: 'manipulation', pattern: /\b(you must|you should always|never question|blindly)\b/i, severity: 'moderate', description: 'Manipulative framing' },
  { name: 'information_overload', pattern: null, severity: 'moderate', description: 'Excessive data volume', check: (data) => data.length > 8000 },
  { name: 'circular_reference', pattern: /\b(see above|as mentioned|refer to|as previously stated)\b/i, severity: 'mild', description: 'Circular or self-referential content' },
];

const MAX_INGESTIONS = 500;
const MAX_ABSORBED = 1000;
const MAX_WASTE = 200;
const BASE_METABOLIC_RATE = 1.0;

class SemanticMetabolism extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null;
    this.config = opts.config || {};
    ensureDir();
  }

  _getIngestions() { return readJSON(INGESTIONS_PATH, []); }
  _saveIngestions(i) { writeJSON(INGESTIONS_PATH, i); }
  _getAbsorbed() { return readJSON(ABSORBED_PATH, []); }
  _saveAbsorbed(a) { writeJSON(ABSORBED_PATH, a); }
  _getWaste() { return readJSON(WASTE_PATH, []); }
  _saveWaste(w) { writeJSON(WASTE_PATH, w); }
  _getState() { return readJSON(METABOLISM_PATH, { metabolicRate: BASE_METABOLIC_RATE, totalIngested: 0, totalAbsorbed: 0, totalWasted: 0, indigestionCount: 0, toxinsDetected: 0, lastTick: null }); }
  _saveState(s) { writeJSON(METABOLISM_PATH, s); }
  _getToxins() { return readJSON(TOXINS_PATH, []); }
  _saveToxins(t) { writeJSON(TOXINS_PATH, t); }

  /**
   * Take in raw information.
   */
  ingest(data, type, source) {
    if (!data) return { error: 'No data to ingest' };

    const ingestions = this._getIngestions();
    const state = this._getState();
    const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
    const enzyme = ENZYMES[type] || ENZYMES.factual;

    // Toxin scan on ingestion
    const toxins = this._detectToxins(dataStr);

    const ingestion = {
      id: uuid(),
      data: dataStr.slice(0, 10000),
      type: type || 'factual',
      source: source || 'unknown',
      stage: 'RAW',
      enzyme: type || 'factual',
      nutrients: [],
      waste: [],
      toxins,
      indigestion: false,
      indigestionReason: null,
      size: dataStr.length,
      calorieEstimate: this._estimateCalories(dataStr, type),
      ingestedAt: Date.now(),
      lastProcessed: null,
      completedAt: null,
    };

    // If severe toxin, flag immediately
    if (toxins.some(t => t.severity === 'severe')) {
      ingestion.indigestion = true;
      ingestion.indigestionReason = 'Severe toxin detected: ' + toxins.find(t => t.severity === 'severe').name;
      state.toxinsDetected += toxins.length;
      this.emit('toxin-detected', { id: ingestion.id, toxins });
    }

    ingestions.push(ingestion);
    state.totalIngested++;

    if (ingestions.length > MAX_INGESTIONS) {
      const completed = ingestions.filter(i => i.stage === 'APPLIED' || i.indigestion);
      if (completed.length > 0) ingestions.splice(ingestions.indexOf(completed[0]), 1);
      else ingestions.shift();
    }

    this._saveIngestions(ingestions);
    this._saveState(state);
    this.emit('ingested', { id: ingestion.id, type: ingestion.type, toxins: toxins.length });
    return ingestion;
  }

  /**
   * Detect toxins in data.
   */
  _detectToxins(data) {
    const found = [];
    for (const toxin of TOXIN_PATTERNS) {
      let detected = false;
      if (toxin.pattern && toxin.pattern.test(data)) detected = true;
      if (toxin.check && toxin.check(data)) detected = true;
      if (detected) {
        found.push({ name: toxin.name, severity: toxin.severity, description: toxin.description, detectedAt: Date.now() });
      }
    }

    // Record toxins
    if (found.length > 0) {
      const toxinLog = this._getToxins();
      toxinLog.push(...found);
      if (toxinLog.length > 300) toxinLog.splice(0, toxinLog.length - 300);
      this._saveToxins(toxinLog);
    }

    return found;
  }

  /**
   * Get toxin history.
   */
  getToxinHistory(limit = 30) {
    return this._getToxins().slice(-limit).reverse();
  }

  /**
   * Process an ingestion through stages.
   */
  digest(ingestionId) {
    const ingestions = this._getIngestions();
    const ing = ingestions.find(i => i.id === ingestionId);
    if (!ing) return { error: 'Ingestion not found' };
    if (ing.stage === 'APPLIED') return { status: 'already_complete', ingestion: ing };
    if (ing.indigestion) return { status: 'indigestion', reason: ing.indigestionReason, ingestion: ing };

    const currentIdx = STAGES.indexOf(ing.stage);
    if (currentIdx === -1) return { error: 'Invalid stage' };

    const state = this._getState();
    const nextStage = STAGES[currentIdx + 1];

    switch (nextStage) {
      case 'PARSED':
        ing.parsed = this._parse(ing.data, ing.type);
        break;
      case 'EXTRACTED':
        ing.nutrients = this._extract(ing.parsed || ing.data, ing.type);
        ing.waste = this._identifyWaste(ing.data, ing.nutrients);
        // Toxin re-check at extraction stage
        if (ing.toxins.length > 0) {
          ing.nutrients = ing.nutrients.filter(n => {
            const nutToxins = this._detectToxins(n.content);
            return nutToxins.length === 0; // only keep clean nutrients
          });
        }
        break;
      case 'INTEGRATED':
        if (this._checkIndigestion(ing)) {
          ing.indigestion = true;
          ing.indigestionReason = 'Too complex or contradictory for current capacity';
          state.indigestionCount++;
          this._saveIngestions(ingestions);
          this._saveState(state);
          this.emit('indigestion', { id: ing.id, reason: ing.indigestionReason });
          return { status: 'indigestion', reason: ing.indigestionReason, ingestion: ing };
        }
        ing.integrated = true;
        break;
      case 'APPLIED':
        this._absorb(ing);
        this._expel(ing);
        ing.completedAt = Date.now();
        state.totalAbsorbed += ing.nutrients.length;
        state.totalWasted += ing.waste.length;
        this.emit('absorbed', { id: ing.id, nutrients: ing.nutrients.length });
        break;
    }

    ing.stage = nextStage;
    ing.lastProcessed = Date.now();
    this._saveIngestions(ingestions);
    this._saveState(state);
    return { status: 'progressed', stage: nextStage, ingestion: ing };
  }

  getAbsorbed(filter) {
    const absorbed = this._getAbsorbed();
    if (!filter) return absorbed.slice(-50).reverse();
    return absorbed.filter(a => {
      if (filter.type && a.type !== filter.type) return false;
      if (filter.source && a.source !== filter.source) return false;
      if (filter.since && a.absorbedAt < filter.since) return false;
      if (filter.query) {
        const q = filter.query.toLowerCase();
        return a.content.toLowerCase().includes(q) || (a.tags || []).some(t => t.includes(q));
      }
      return true;
    }).slice(-50).reverse();
  }

  getWaste() { return this._getWaste().slice(-50).reverse(); }

  getMetabolicRate() {
    const state = this._getState();
    const ingestions = this._getIngestions();
    const pending = ingestions.filter(i => i.stage !== 'APPLIED' && !i.indigestion);
    const indigesting = ingestions.filter(i => i.indigestion);
    const load = pending.length;
    const adjustedRate = load > 20 ? state.metabolicRate * 0.5 : load > 10 ? state.metabolicRate * 0.8 : state.metabolicRate;

    return {
      baseRate: state.metabolicRate,
      adjustedRate: Math.round(adjustedRate * 100) / 100,
      pending: pending.length,
      indigesting: indigesting.length,
      totalIngested: state.totalIngested,
      totalAbsorbed: state.totalAbsorbed,
      totalWasted: state.totalWasted,
      indigestionCount: state.indigestionCount,
      toxinsDetected: state.toxinsDetected || 0,
      efficiency: state.totalIngested > 0 ? Math.round(state.totalAbsorbed / state.totalIngested * 100) : 0,
      loadStatus: load > 20 ? 'overloaded' : load > 10 ? 'heavy' : load > 5 ? 'moderate' : 'light',
    };
  }

  /**
   * Full nutritional analysis of information diet.
   */
  getNutritionalAnalysis() {
    const ingestions = this._getIngestions();
    const absorbed = this._getAbsorbed();

    const dietBreakdown = {};
    for (const ing of ingestions) {
      const t = ing.type || 'factual';
      if (!dietBreakdown[t]) dietBreakdown[t] = { ingested: 0, absorbed: 0, wasted: 0, indigested: 0, toxins: 0 };
      dietBreakdown[t].ingested++;
      if (ing.indigestion) dietBreakdown[t].indigested++;
      dietBreakdown[t].toxins += (ing.toxins || []).length;
    }
    for (const a of absorbed) {
      const t = a.type || 'factual';
      if (!dietBreakdown[t]) dietBreakdown[t] = { ingested: 0, absorbed: 0, wasted: 0, indigested: 0, toxins: 0 };
      dietBreakdown[t].absorbed++;
    }

    const totalIngested = ingestions.length || 1;
    const balance = {};
    for (const t of Object.keys(dietBreakdown)) {
      balance[t] = Math.round(dietBreakdown[t].ingested / totalIngested * 100);
    }

    const isBalanced = Object.keys(balance).length >= 3 && !Object.values(balance).some(v => v > 60);

    return {
      dietBreakdown, balance, isBalanced,
      recommendation: this._getDietaryRecommendations(balance, dietBreakdown),
      enzymes: ENZYMES,
      totalItems: ingestions.length,
    };
  }

  /**
   * Generate dietary recommendations based on intake patterns.
   */
  _getDietaryRecommendations(balance, breakdown) {
    const recs = [];
    const types = Object.keys(balance);

    if (types.length < 3) recs.push('Diet too narrow — diversify information sources across at least 3 types');
    if (Object.values(balance).some(v => v > 60)) {
      const dominant = Object.entries(balance).sort((a, b) => b[1] - a[1])[0];
      recs.push(`Heavily skewed toward ${dominant[0]} (${dominant[1]}%) — reduce intake or diversify`);
    }

    // Check for deficiencies
    for (const [type, enzyme] of Object.entries(ENZYMES)) {
      const actual = (balance[type] || 0) / 100;
      if (actual < enzyme.ideal * 0.3) {
        recs.push(`${type.toUpperCase()} deficiency — current ${Math.round(actual * 100)}% vs ideal ${Math.round(enzyme.ideal * 100)}%`);
      }
    }

    // Toxin warnings
    const totalToxins = Object.values(breakdown).reduce((s, d) => s + (d.toxins || 0), 0);
    if (totalToxins > 5) recs.push(`High toxin exposure (${totalToxins} detected) — filter sources more carefully`);

    // Indigestion rate
    const totalIndigested = Object.values(breakdown).reduce((s, d) => s + d.indigested, 0);
    const totalIngested = Object.values(breakdown).reduce((s, d) => s + d.ingested, 0);
    if (totalIngested > 5 && totalIndigested / totalIngested > 0.3) {
      recs.push('High indigestion rate — reduce complexity or increase metabolic capacity');
    }

    if (recs.length === 0) recs.push('Diet is well-balanced — maintain current information intake patterns');
    return recs;
  }

  /**
   * Detect malnutrition — deficiencies in certain information types.
   */
  detectMalnutrition() {
    const ingestions = this._getIngestions();
    const now = Date.now();
    const recent = ingestions.filter(i => now - i.ingestedAt < 7 * 86400000);
    const deficiencies = [];

    const typeCount = {};
    for (const ing of recent) { typeCount[ing.type || 'factual'] = (typeCount[ing.type || 'factual'] || 0) + 1; }
    const total = recent.length || 1;

    for (const [type, enzyme] of Object.entries(ENZYMES)) {
      const actual = (typeCount[type] || 0) / total;
      if (actual < enzyme.ideal * 0.3) {
        deficiencies.push({
          type, current: Math.round(actual * 100), ideal: Math.round(enzyme.ideal * 100),
          severity: actual === 0 ? 'critical' : 'moderate',
          recommendation: `Increase ${type} information intake — currently ${Math.round(actual * 100)}% vs ideal ${Math.round(enzyme.ideal * 100)}%`,
        });
      }
    }

    // Check total volume malnutrition
    if (recent.length < 3) {
      deficiencies.push({ type: 'overall', current: recent.length, ideal: '10+', severity: 'critical', recommendation: 'Information starvation — drastically increase intake' });
    }

    return {
      malnourished: deficiencies.length > 0,
      deficiencies,
      recentIntake: recent.length,
      typeDistribution: typeCount,
    };
  }

  detectIndigestion() {
    const ingestions = this._getIngestions();
    const problems = [];
    const now = Date.now();

    for (const ing of ingestions.filter(i => i.indigestion)) {
      problems.push({ id: ing.id, type: 'indigestion', data: ing.data.slice(0, 100), reason: ing.indigestionReason, source: ing.source, since: ing.lastProcessed, toxins: (ing.toxins || []).length });
    }

    for (const ing of ingestions.filter(i => !i.indigestion && i.stage !== 'APPLIED' && i.lastProcessed && (now - i.lastProcessed) > 3600000)) {
      problems.push({ id: ing.id, type: 'stalled', stage: ing.stage, data: ing.data.slice(0, 100), stalledFor: Math.round((now - ing.lastProcessed) / 60000) + ' minutes', source: ing.source });
    }

    const pending = ingestions.filter(i => i.stage !== 'APPLIED' && !i.indigestion);
    if (pending.length > 20) {
      problems.push({ type: 'overload', pendingCount: pending.length, recommendation: 'Reduce intake or increase metabolic rate' });
    }

    return problems;
  }

  tick() {
    const ingestions = this._getIngestions();
    const state = this._getState();
    const results = { processed: 0, completed: 0, indigestion: 0, errors: 0, toxinsFound: 0 };

    const pending = ingestions.filter(i => i.stage !== 'APPLIED' && !i.indigestion);
    const batchSize = Math.max(1, Math.ceil(pending.length * state.metabolicRate * 0.3));

    for (let i = 0; i < Math.min(batchSize, pending.length); i++) {
      const result = this.digest(pending[i].id);
      if (result.status === 'progressed') {
        results.processed++;
        if (result.stage === 'APPLIED') results.completed++;
      } else if (result.status === 'indigestion') results.indigestion++;
      else if (result.error) results.errors++;
    }

    // Adaptive metabolic rate
    if (pending.length > 15) state.metabolicRate = Math.min(2.0, state.metabolicRate + 0.1);
    else if (pending.length < 3) state.metabolicRate = Math.max(0.5, state.metabolicRate - 0.05);

    state.lastTick = Date.now();
    this._saveState(state);

    const malnutrition = this.detectMalnutrition();
    if (malnutrition.malnourished) this.emit('malnutrition', malnutrition);

    const result = { ...results, metabolicRate: state.metabolicRate, pendingRemaining: pending.length - results.processed - results.indigestion, malnourished: malnutrition.malnourished, timestamp: Date.now() };
    this.emit('tick', result);
    return result;
  }

  // ── Internal ──

  _parse(data, type) {
    const sentences = data.split(/[.!?\n]+/).map(s => s.trim()).filter(s => s.length > 5);
    return {
      sentences, wordCount: data.split(/\s+/).length, type,
      hasNumbers: /\d/.test(data), hasUrls: /https?:\/\//.test(data), hasCode: /[{}();=]/.test(data),
      complexity: Math.min(10, Math.ceil(sentences.length / 3)),
    };
  }

  _extract(parsed, type) {
    const nutrients = [];
    const sentences = parsed.sentences || (typeof parsed === 'string' ? parsed.split(/[.!?\n]+/).filter(s => s.trim().length > 5) : []);

    for (const sentence of sentences) {
      const words = sentence.split(/\s+/);
      if (words.length < 3) continue;
      const hasKeySignal = /\b(is|are|means|defined|because|therefore|important|key|critical|note|remember)\b/i.test(sentence);
      const informationDensity = words.length > 5 && hasKeySignal ? 'high' : words.length > 3 ? 'medium' : 'low';

      if (informationDensity !== 'low') {
        nutrients.push({ content: sentence.trim(), density: informationDensity, type: type || 'factual', tags: this._autoTag(sentence) });
      }
    }
    return nutrients.slice(0, 20);
  }

  _identifyWaste(data, nutrients) {
    const nutrientTexts = new Set(nutrients.map(n => n.content.toLowerCase()));
    return data.split(/[.!?\n]+/).map(s => s.trim()).filter(s => s.length > 3)
      .filter(s => !nutrientTexts.has(s.toLowerCase()))
      .slice(0, 10)
      .map(s => ({ content: s, reason: 'low information density' }));
  }

  _checkIndigestion(ingestion) {
    if (ingestion.size > 5000 && (ingestion.nutrients || []).length < 2) return true;
    if ((ingestion.parsed || {}).complexity > 8) return Math.random() < 0.3;
    if ((ingestion.toxins || []).some(t => t.severity === 'moderate')) return Math.random() < 0.2;
    return false;
  }

  _absorb(ingestion) {
    const absorbed = this._getAbsorbed();
    for (const nutrient of (ingestion.nutrients || [])) {
      absorbed.push({
        id: uuid(), content: nutrient.content, type: nutrient.type, density: nutrient.density,
        tags: nutrient.tags, source: ingestion.source, ingestionId: ingestion.id, absorbedAt: Date.now(),
      });
    }
    if (absorbed.length > MAX_ABSORBED) absorbed.splice(0, absorbed.length - MAX_ABSORBED);
    this._saveAbsorbed(absorbed);
  }

  _expel(ingestion) {
    const waste = this._getWaste();
    for (const w of (ingestion.waste || [])) {
      waste.push({ id: uuid(), content: w.content, reason: w.reason, source: ingestion.source, ingestionId: ingestion.id, expelledAt: Date.now() });
    }
    if (waste.length > MAX_WASTE) waste.splice(0, waste.length - MAX_WASTE);
    this._saveWaste(waste);
  }

  _estimateCalories(data, type) {
    const base = Math.ceil(data.length / 100);
    const enzyme = ENZYMES[type] || ENZYMES.factual;
    return Math.round(base / enzyme.speed);
  }

  _autoTag(text) {
    const t = text.toLowerCase();
    const tags = [];
    const tagMap = {
      'code': /\b(function|class|const|let|var|import|require)\b/,
      'data': /\b(data|database|sql|query|table)\b/,
      'concept': /\b(concept|theory|principle|idea|framework)\b/,
      'action': /\b(do|make|create|build|run|execute|deploy)\b/,
      'person': /\b(user|person|team|human|people)\b/,
      'time': /\b(when|date|time|schedule|deadline|today|tomorrow)\b/,
    };
    for (const [tag, regex] of Object.entries(tagMap)) { if (regex.test(t)) tags.push(tag); }
    return tags.length > 0 ? tags : ['general'];
  }
}

module.exports = SemanticMetabolism;
