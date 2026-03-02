/**
 * ARIES — Semantic Metabolism
 * Information digestion framework. Raw data → parsed → extracted → integrated → applied.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'knowledge');
const INGESTIONS_PATH = path.join(DATA_DIR, 'ingestions.json');
const ABSORBED_PATH = path.join(DATA_DIR, 'absorbed.json');
const WASTE_PATH = path.join(DATA_DIR, 'waste.json');
const METABOLISM_PATH = path.join(DATA_DIR, 'metabolism-state.json');

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }

const STAGES = ['RAW', 'PARSED', 'EXTRACTED', 'INTEGRATED', 'APPLIED'];
const ENZYMES = {
  factual:    { speed: 1.0, efficiency: 0.9, description: 'Processes facts, data, statistics' },
  procedural: { speed: 0.7, efficiency: 0.8, description: 'Processes how-to knowledge, steps, methods' },
  emotional:  { speed: 1.2, efficiency: 0.6, description: 'Processes feelings, moods, social cues' },
  creative:   { speed: 0.5, efficiency: 0.7, description: 'Processes ideas, art, novel concepts' },
  meta:       { speed: 0.4, efficiency: 0.5, description: 'Processes self-referential, abstract knowledge' },
};

const MAX_INGESTIONS = 500;
const MAX_ABSORBED = 1000;
const MAX_WASTE = 200;
const BASE_METABOLIC_RATE = 1.0;

class SemanticMetabolism {
  constructor(opts) {
    this.ai = opts && opts.ai;
    this.config = (opts && opts.config) || {};
    ensureDir();
  }

  _getIngestions() { return readJSON(INGESTIONS_PATH, []); }
  _saveIngestions(i) { writeJSON(INGESTIONS_PATH, i); }
  _getAbsorbed() { return readJSON(ABSORBED_PATH, []); }
  _saveAbsorbed(a) { writeJSON(ABSORBED_PATH, a); }
  _getWaste() { return readJSON(WASTE_PATH, []); }
  _saveWaste(w) { writeJSON(WASTE_PATH, w); }
  _getState() { return readJSON(METABOLISM_PATH, { metabolicRate: BASE_METABOLIC_RATE, totalIngested: 0, totalAbsorbed: 0, totalWasted: 0, indigestionCount: 0, lastTick: null }); }
  _saveState(s) { writeJSON(METABOLISM_PATH, s); }

  /**
   * Take in raw information.
   */
  ingest(data, type, source) {
    if (!data) return { error: 'No data to ingest' };

    const ingestions = this._getIngestions();
    const state = this._getState();

    const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
    const enzyme = ENZYMES[type] || ENZYMES.factual;

    const ingestion = {
      id: uuid(),
      data: dataStr.slice(0, 10000),
      type: type || 'factual',
      source: source || 'unknown',
      stage: 'RAW',
      enzyme: type || 'factual',
      nutrients: [],            // extracted useful bits
      waste: [],                // rejected bits
      indigestion: false,
      indigestionReason: null,
      size: dataStr.length,
      calorieEstimate: this._estimateCalories(dataStr, type),
      ingestedAt: Date.now(),
      lastProcessed: null,
      completedAt: null,
    };

    ingestions.push(ingestion);
    state.totalIngested++;

    // Cap
    if (ingestions.length > MAX_INGESTIONS) {
      // Remove oldest completed
      const completed = ingestions.filter(i => i.stage === 'APPLIED' || i.stage === 'WASTE');
      if (completed.length > 0) {
        const oldest = completed[0];
        const idx = ingestions.indexOf(oldest);
        if (idx !== -1) ingestions.splice(idx, 1);
      } else {
        ingestions.shift();
      }
    }

    this._saveIngestions(ingestions);
    this._saveState(state);
    return ingestion;
  }

  /**
   * Process an ingestion through digestion stages.
   */
  digest(ingestionId) {
    const ingestions = this._getIngestions();
    const ing = ingestions.find(i => i.id === ingestionId);
    if (!ing) return { error: 'Ingestion not found' };
    if (ing.stage === 'APPLIED') return { status: 'already_complete', ingestion: ing };
    if (ing.indigestion) return { status: 'indigestion', reason: ing.indigestionReason, ingestion: ing };

    const currentIdx = STAGES.indexOf(ing.stage);
    if (currentIdx === -1) return { error: 'Invalid stage' };

    const enzyme = ENZYMES[ing.enzyme] || ENZYMES.factual;
    const state = this._getState();
    const nextStage = STAGES[currentIdx + 1];

    // Process based on stage
    switch (nextStage) {
      case 'PARSED':
        ing.parsed = this._parse(ing.data, ing.type);
        break;
      case 'EXTRACTED':
        ing.nutrients = this._extract(ing.parsed || ing.data, ing.type);
        ing.waste = this._identifyWaste(ing.data, ing.nutrients);
        break;
      case 'INTEGRATED':
        if (this._checkIndigestion(ing)) {
          ing.indigestion = true;
          ing.indigestionReason = 'Information too complex or contradictory for current metabolic capacity';
          state.indigestionCount++;
          this._saveIngestions(ingestions);
          this._saveState(state);
          return { status: 'indigestion', reason: ing.indigestionReason, ingestion: ing };
        }
        ing.integrated = true;
        break;
      case 'APPLIED':
        // Absorb nutrients, expel waste
        this._absorb(ing);
        this._expel(ing);
        ing.completedAt = Date.now();
        state.totalAbsorbed += ing.nutrients.length;
        state.totalWasted += ing.waste.length;
        break;
    }

    ing.stage = nextStage;
    ing.lastProcessed = Date.now();

    this._saveIngestions(ingestions);
    this._saveState(state);
    return { status: 'progressed', stage: nextStage, ingestion: ing };
  }

  /**
   * Get absorbed nutrients (useful knowledge).
   */
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

  /**
   * Get waste — rejected information.
   */
  getWaste() {
    return this._getWaste().slice(-50).reverse();
  }

  /**
   * Get current metabolic rate and stats.
   */
  getMetabolicRate() {
    const state = this._getState();
    const ingestions = this._getIngestions();
    const pending = ingestions.filter(i => i.stage !== 'APPLIED' && !i.indigestion);
    const indigesting = ingestions.filter(i => i.indigestion);

    // Dynamic rate based on load
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
      efficiency: state.totalIngested > 0 ? Math.round(state.totalAbsorbed / state.totalIngested * 100) : 0,
      loadStatus: load > 20 ? 'overloaded' : load > 10 ? 'heavy' : load > 5 ? 'moderate' : 'light',
    };
  }

  /**
   * Breakdown of information types being processed.
   */
  getNutritionalAnalysis() {
    const ingestions = this._getIngestions();
    const absorbed = this._getAbsorbed();

    const dietBreakdown = {};
    for (const ing of ingestions) {
      const t = ing.type || 'factual';
      if (!dietBreakdown[t]) dietBreakdown[t] = { ingested: 0, absorbed: 0, wasted: 0, indigested: 0 };
      dietBreakdown[t].ingested++;
      if (ing.indigestion) dietBreakdown[t].indigested++;
    }

    for (const a of absorbed) {
      const t = a.type || 'factual';
      if (!dietBreakdown[t]) dietBreakdown[t] = { ingested: 0, absorbed: 0, wasted: 0, indigested: 0 };
      dietBreakdown[t].absorbed++;
    }

    // Diet balance assessment
    const types = Object.keys(dietBreakdown);
    const totalIngested = ingestions.length || 1;
    const balance = {};
    for (const t of types) {
      balance[t] = Math.round(dietBreakdown[t].ingested / totalIngested * 100);
    }

    const isBalanced = types.length >= 3 && !Object.values(balance).some(v => v > 60);

    return {
      dietBreakdown,
      balance,
      isBalanced,
      recommendation: isBalanced
        ? 'Diet is well-balanced across information types'
        : types.length < 3
          ? 'Diet is too narrow — diversify information sources'
          : 'Diet is heavily skewed — consider balancing information intake',
      enzymes: ENZYMES,
      totalItems: ingestions.length,
    };
  }

  /**
   * Detect processing problems.
   */
  detectIndigestion() {
    const ingestions = this._getIngestions();
    const problems = [];

    // Active indigestion
    const indigesting = ingestions.filter(i => i.indigestion);
    for (const ing of indigesting) {
      problems.push({
        id: ing.id,
        type: 'indigestion',
        data: ing.data.slice(0, 100),
        reason: ing.indigestionReason,
        source: ing.source,
        since: ing.lastProcessed,
      });
    }

    // Stalled ingestions (stuck in a stage too long)
    const now = Date.now();
    const stalled = ingestions.filter(i => !i.indigestion && i.stage !== 'APPLIED' && i.lastProcessed && (now - i.lastProcessed) > 3600000);
    for (const ing of stalled) {
      problems.push({
        id: ing.id,
        type: 'stalled',
        stage: ing.stage,
        data: ing.data.slice(0, 100),
        stalledFor: Math.round((now - ing.lastProcessed) / 60000) + ' minutes',
        source: ing.source,
      });
    }

    // Overload
    const pending = ingestions.filter(i => i.stage !== 'APPLIED' && !i.indigestion);
    if (pending.length > 20) {
      problems.push({
        type: 'overload',
        pendingCount: pending.length,
        recommendation: 'Reduce intake or increase metabolic rate',
      });
    }

    return problems;
  }

  /**
   * Periodic tick: process pending ingestions through their next stage.
   */
  tick() {
    const ingestions = this._getIngestions();
    const state = this._getState();
    const results = { processed: 0, completed: 0, indigestion: 0, errors: 0 };

    // How many to process this tick based on metabolic rate
    const pending = ingestions.filter(i => i.stage !== 'APPLIED' && !i.indigestion);
    const batchSize = Math.max(1, Math.ceil(pending.length * state.metabolicRate * 0.3));

    for (let i = 0; i < Math.min(batchSize, pending.length); i++) {
      const ing = pending[i];
      const result = this.digest(ing.id);

      if (result.status === 'progressed') {
        results.processed++;
        if (result.stage === 'APPLIED') results.completed++;
      } else if (result.status === 'indigestion') {
        results.indigestion++;
      } else if (result.error) {
        results.errors++;
      }
    }

    // Adaptive metabolic rate
    if (pending.length > 15) {
      state.metabolicRate = Math.min(2.0, state.metabolicRate + 0.1);
    } else if (pending.length < 3) {
      state.metabolicRate = Math.max(0.5, state.metabolicRate - 0.05);
    }

    state.lastTick = Date.now();
    this._saveState(state);

    return { ...results, metabolicRate: state.metabolicRate, pendingRemaining: pending.length - results.processed - results.indigestion, timestamp: Date.now() };
  }

  // ── Internal helpers ──

  _parse(data, type) {
    // Break data into chunks/sentences
    const sentences = data.split(/[.!?\n]+/).map(s => s.trim()).filter(s => s.length > 5);
    return {
      sentences,
      wordCount: data.split(/\s+/).length,
      type,
      hasNumbers: /\d/.test(data),
      hasUrls: /https?:\/\//.test(data),
      hasCode: /[{}();=]/.test(data),
      complexity: Math.min(10, Math.ceil(sentences.length / 3)),
    };
  }

  _extract(parsed, type) {
    const nutrients = [];
    const sentences = parsed.sentences || (typeof parsed === 'string' ? parsed.split(/[.!?\n]+/).filter(s => s.trim().length > 5) : []);

    for (const sentence of sentences) {
      // Simple heuristic: longer, more informative sentences are nutrients
      const words = sentence.split(/\s+/);
      if (words.length < 3) continue;

      const hasKeySignal = /\b(is|are|means|defined|because|therefore|important|key|critical|note|remember)\b/i.test(sentence);
      const informationDensity = words.length > 5 && hasKeySignal ? 'high' : words.length > 3 ? 'medium' : 'low';

      if (informationDensity !== 'low') {
        nutrients.push({
          content: sentence.trim(),
          density: informationDensity,
          type: type || 'factual',
          tags: this._autoTag(sentence),
        });
      }
    }

    return nutrients.slice(0, 20);
  }

  _identifyWaste(data, nutrients) {
    const nutrientTexts = new Set(nutrients.map(n => n.content.toLowerCase()));
    const sentences = data.split(/[.!?\n]+/).map(s => s.trim()).filter(s => s.length > 3);

    return sentences
      .filter(s => !nutrientTexts.has(s.toLowerCase()))
      .slice(0, 10)
      .map(s => ({ content: s, reason: 'low information density' }));
  }

  _checkIndigestion(ingestion) {
    // Indigestion if: too complex, contradictory signals, or too large
    if (ingestion.size > 5000 && (ingestion.nutrients || []).length < 2) return true;
    if ((ingestion.parsed || {}).complexity > 8) return Math.random() < 0.3;
    return false;
  }

  _absorb(ingestion) {
    const absorbed = this._getAbsorbed();
    for (const nutrient of (ingestion.nutrients || [])) {
      absorbed.push({
        id: uuid(),
        content: nutrient.content,
        type: nutrient.type,
        density: nutrient.density,
        tags: nutrient.tags,
        source: ingestion.source,
        ingestionId: ingestion.id,
        absorbedAt: Date.now(),
      });
    }
    if (absorbed.length > MAX_ABSORBED) absorbed.splice(0, absorbed.length - MAX_ABSORBED);
    this._saveAbsorbed(absorbed);
  }

  _expel(ingestion) {
    const waste = this._getWaste();
    for (const w of (ingestion.waste || [])) {
      waste.push({
        id: uuid(),
        content: w.content,
        reason: w.reason,
        source: ingestion.source,
        ingestionId: ingestion.id,
        expelledAt: Date.now(),
      });
    }
    if (waste.length > MAX_WASTE) waste.splice(0, waste.length - MAX_WASTE);
    this._saveWaste(waste);
  }

  _estimateCalories(data, type) {
    // "Caloric" value = information processing cost
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
    for (const [tag, regex] of Object.entries(tagMap)) {
      if (regex.test(t)) tags.push(tag);
    }
    return tags.length > 0 ? tags : ['general'];
  }
}

module.exports = SemanticMetabolism;
