/**
 * ARIES — Causal Paradox Engine
 * Retroactive re-weighting of past decisions. Dynamic importance scoring.
 * Detects paradoxes where wrong decisions led to good outcomes (and vice versa).
 */

'use strict';

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'causal');
const DECISIONS_PATH = path.join(DATA_DIR, 'paradox-decisions.json');
const CHAINS_PATH = path.join(DATA_DIR, 'paradox-chains.json');
const PARADOXES_PATH = path.join(DATA_DIR, 'paradoxes.json');

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }

class CausalParadoxEngine extends EventEmitter {
  /**
   * @param {object} opts
   * @param {object} opts.ai - AI core module
   * @param {object} opts.config - causalParadox config section
   */
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null;
    this.config = opts.config || {};
    ensureDir();
  }

  _getDecisions() { return readJSON(DECISIONS_PATH, []); }
  _saveDecisions(d) { writeJSON(DECISIONS_PATH, d); }
  _getChains() { return readJSON(CHAINS_PATH, {}); }
  _saveChains(d) { writeJSON(CHAINS_PATH, d); }
  _getParadoxes() { return readJSON(PARADOXES_PATH, []); }
  _saveParadoxes(d) { writeJSON(PARADOXES_PATH, d); }

  /**
   * Log a significant decision
   * @param {string} description - what was decided
   * @param {string} context - surrounding circumstances
   * @param {string[]} options - alternatives considered
   * @param {string} chosen - which option was selected
   * @param {number} confidence - 0-100 confidence at decision time
   * @returns {object} decision record
   */
  registerDecision(description, context, options, chosen, confidence = 50) {
    const decisions = this._getDecisions();
    const decision = {
      id: uuid(),
      description,
      context: context || '',
      options: options || [],
      chosen: chosen || description,
      confidence: Math.max(0, Math.min(100, confidence)),
      originalConfidence: confidence,
      importance: 50,
      outcome: null,
      outcomeQuality: null, // -100 to 100
      reweights: [],
      createdAt: Date.now(),
      lastReweighted: null,
    };

    decisions.push(decision);
    if (decisions.length > 1000) decisions.splice(0, decisions.length - 1000);
    this._saveDecisions(decisions);

    this.emit('decision-registered', decision);
    return decision;
  }

  /**
   * Record an outcome for a decision
   * @param {string} decisionId
   * @param {string} outcome - what happened
   * @param {number} quality - -100 (terrible) to 100 (excellent)
   */
  recordOutcome(decisionId, outcome, quality = 0) {
    const decisions = this._getDecisions();
    const decision = decisions.find(d => d.id === decisionId);
    if (!decision) return { error: 'not_found', decisionId };

    decision.outcome = outcome;
    decision.outcomeQuality = Math.max(-100, Math.min(100, quality));

    // Add to causal chain
    const chains = this._getChains();
    if (!chains[decisionId]) chains[decisionId] = { decisionId, outcomes: [] };
    chains[decisionId].outcomes.push({ outcome, quality, recordedAt: Date.now() });
    this._saveChains(chains);

    this._saveDecisions(decisions);
    this.emit('outcome-recorded', { decisionId, outcome, quality });

    // Check for paradoxes
    this._checkParadox(decision);
    return decision;
  }

  /**
   * Retroactive re-scoring with new information
   * @param {string} decisionId
   * @param {string} newInfo - new information that changes the assessment
   * @returns {object} reweight result
   */
  reweight(decisionId, newInfo) {
    const decisions = this._getDecisions();
    const decision = decisions.find(d => d.id === decisionId);
    if (!decision) return { error: 'not_found', decisionId };

    const oldConfidence = decision.confidence;
    const oldImportance = decision.importance;

    // Heuristic reweighting based on info sentiment
    const infoLower = (newInfo || '').toLowerCase();
    let confidenceDelta = 0;
    let importanceDelta = 0;

    if (infoLower.includes('correct') || infoLower.includes('right') || infoLower.includes('good') || infoLower.includes('success')) {
      confidenceDelta = 10;
      importanceDelta = 5;
    } else if (infoLower.includes('wrong') || infoLower.includes('bad') || infoLower.includes('fail') || infoLower.includes('mistake')) {
      confidenceDelta = -15;
      importanceDelta = 10; // mistakes are important to remember
    } else if (infoLower.includes('irrelevant') || infoLower.includes('minor')) {
      importanceDelta = -10;
    } else {
      // Neutral info slightly increases importance (more context = more important)
      importanceDelta = 3;
    }

    decision.confidence = Math.max(0, Math.min(100, decision.confidence + confidenceDelta));
    decision.importance = Math.max(0, Math.min(100, decision.importance + importanceDelta));
    decision.lastReweighted = Date.now();
    decision.reweights.push({
      info: newInfo,
      confidenceDelta,
      importanceDelta,
      oldConfidence,
      newConfidence: decision.confidence,
      at: Date.now(),
    });

    this._saveDecisions(decisions);
    this._checkParadox(decision);

    this.emit('reweighted', { decisionId, oldConfidence, newConfidence: decision.confidence });
    return {
      decisionId,
      description: decision.description,
      oldConfidence,
      newConfidence: decision.confidence,
      oldImportance,
      newImportance: decision.importance,
      totalReweights: decision.reweights.length,
    };
  }

  /**
   * Get the causal chain (consequences graph) for a decision
   * @param {string} decisionId
   * @returns {object}
   */
  getCausalChain(decisionId) {
    const chains = this._getChains();
    const chain = chains[decisionId];
    if (!chain) return { decisionId, outcomes: [], depth: 0 };

    const decisions = this._getDecisions();
    const decision = decisions.find(d => d.id === decisionId);

    return {
      decisionId,
      decision: decision ? { description: decision.description, chosen: decision.chosen, confidence: decision.confidence } : null,
      outcomes: chain.outcomes,
      depth: chain.outcomes.length,
      netQuality: chain.outcomes.reduce((s, o) => s + (o.quality || 0), 0),
    };
  }

  /**
   * Find paradoxical outcomes
   * @returns {object[]}
   */
  detectParadoxes() {
    const paradoxes = this._getParadoxes();
    const decisions = this._getDecisions();

    // Also scan for new paradoxes
    for (const d of decisions) {
      if (d.outcomeQuality === null || d.confidence === null) continue;

      const isParadox = (
        (d.confidence < 30 && d.outcomeQuality > 50) || // low confidence, great outcome
        (d.confidence > 70 && d.outcomeQuality < -30) || // high confidence, bad outcome
        (d.originalConfidence > 70 && d.confidence < 30)  // dramatic confidence reversal
      );

      if (isParadox) {
        const existing = paradoxes.find(p => p.decisionId === d.id);
        if (!existing) {
          const paradox = {
            id: uuid(),
            decisionId: d.id,
            description: d.description,
            type: d.confidence < 30 && d.outcomeQuality > 50 ? 'lucky_mistake'
              : d.confidence > 70 && d.outcomeQuality < -30 ? 'confident_failure'
              : 'reversal',
            confidence: d.confidence,
            originalConfidence: d.originalConfidence,
            outcomeQuality: d.outcomeQuality,
            detectedAt: Date.now(),
          };
          paradoxes.push(paradox);
          this.emit('paradox-detected', paradox);
        }
      }
    }

    if (paradoxes.length > 200) paradoxes.splice(0, paradoxes.length - 200);
    this._saveParadoxes(paradoxes);
    return paradoxes;
  }

  /**
   * Counterfactual analysis — what if a different option was chosen?
   * @param {string} decisionId
   * @param {string} alternative - the alternative option to consider
   * @returns {object}
   */
  whatIf(decisionId, alternative) {
    const decisions = this._getDecisions();
    const decision = decisions.find(d => d.id === decisionId);
    if (!decision) return { error: 'not_found', decisionId };

    // Find similar decisions where the alternative was chosen
    const similar = decisions.filter(d =>
      d.id !== decisionId &&
      d.chosen === alternative &&
      d.outcomeQuality !== null
    );

    const avgAlternativeQuality = similar.length > 0
      ? Math.round(similar.reduce((s, d) => s + d.outcomeQuality, 0) / similar.length)
      : null;

    // Estimate based on available data
    const analysis = {
      decisionId,
      originalChoice: decision.chosen,
      alternative,
      originalOutcome: decision.outcomeQuality,
      estimatedAlternativeOutcome: avgAlternativeQuality,
      similarDecisions: similar.length,
      verdict: null,
    };

    if (avgAlternativeQuality !== null && decision.outcomeQuality !== null) {
      const diff = avgAlternativeQuality - decision.outcomeQuality;
      if (diff > 20) analysis.verdict = 'Alternative was likely better';
      else if (diff < -20) analysis.verdict = 'Original choice was likely better';
      else analysis.verdict = 'Outcomes would have been similar';
    } else {
      analysis.verdict = 'Insufficient data for counterfactual analysis';
    }

    return analysis;
  }

  /**
   * Get decision quality trend over time
   * @param {number} [windowSize=10] - number of recent decisions to analyze
   * @returns {object}
   */
  getQualityTrend(windowSize = 10) {
    const decisions = this._getDecisions()
      .filter(d => d.outcomeQuality !== null)
      .sort((a, b) => a.createdAt - b.createdAt);

    if (decisions.length < 2) return { trend: 'insufficient_data', decisions: decisions.length };

    const windows = [];
    for (let i = 0; i <= decisions.length - windowSize && i < decisions.length; i++) {
      const window = decisions.slice(i, i + windowSize);
      const avg = Math.round(window.reduce((s, d) => s + d.outcomeQuality, 0) / window.length);
      windows.push({ startIdx: i, avg, count: window.length });
    }

    if (windows.length < 2) {
      const overall = Math.round(decisions.reduce((s, d) => s + d.outcomeQuality, 0) / decisions.length);
      return { trend: 'flat', overallQuality: overall, decisions: decisions.length };
    }

    const first = windows[0].avg;
    const last = windows[windows.length - 1].avg;
    const diff = last - first;

    const avgConfidenceAccuracy = decisions.reduce((s, d) => {
      // How well does confidence predict outcome? (both normalized to 0-100)
      const normalizedOutcome = (d.outcomeQuality + 100) / 2; // -100..100 → 0..100
      return s + Math.abs(d.confidence - normalizedOutcome);
    }, 0) / decisions.length;

    return {
      trend: diff > 10 ? 'improving' : diff < -10 ? 'declining' : 'stable',
      recentAvg: last,
      historicAvg: first,
      delta: diff,
      totalDecisions: decisions.length,
      confidenceAccuracy: Math.round(100 - avgConfidenceAccuracy),
      windows,
    };
  }

  /**
   * Periodic re-weighting and paradox detection
   * @returns {object} tick summary
   */
  tick() {
    const decisions = this._getDecisions();
    const now = Date.now();
    let reweighted = 0;

    // Importance drift: recent decisions with outcomes drift in importance
    for (const d of decisions) {
      if (d.outcomeQuality === null) continue;
      const age = (now - d.createdAt) / (24 * 60 * 60 * 1000); // days

      // Importance drifts based on outcome magnitude
      if (Math.abs(d.outcomeQuality) > 50) {
        // High-impact decisions stay important longer
        d.importance = Math.min(100, d.importance + 0.5);
      } else if (age > 30) {
        // Low-impact old decisions fade
        d.importance = Math.max(5, d.importance - 0.5);
      }
      reweighted++;
    }

    this._saveDecisions(decisions);

    // Run paradox detection
    const paradoxes = this.detectParadoxes();

    return {
      decisionsProcessed: reweighted,
      totalDecisions: decisions.length,
      paradoxesFound: paradoxes.length,
    };
  }

  // ── Internal ──

  _checkParadox(decision) {
    if (decision.outcomeQuality === null) return;
    const isParadox = (
      (decision.confidence < 30 && decision.outcomeQuality > 50) ||
      (decision.confidence > 70 && decision.outcomeQuality < -30)
    );
    if (isParadox) {
      const paradoxes = this._getParadoxes();
      if (!paradoxes.find(p => p.decisionId === decision.id)) {
        const paradox = {
          id: uuid(),
          decisionId: decision.id,
          description: decision.description,
          type: decision.confidence < 30 ? 'lucky_mistake' : 'confident_failure',
          confidence: decision.confidence,
          outcomeQuality: decision.outcomeQuality,
          detectedAt: Date.now(),
        };
        paradoxes.push(paradox);
        this._saveParadoxes(paradoxes);
        this.emit('paradox-detected', paradox);
      }
    }
  }
}

let _instance = null;
function getInstance(opts) {
  if (!_instance) _instance = new CausalParadoxEngine(opts);
  return _instance;
}

module.exports = { CausalParadoxEngine, getInstance };
