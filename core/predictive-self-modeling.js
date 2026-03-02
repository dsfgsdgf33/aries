/**
 * ARIES — Predictive Self-Modeling
 * Predict your own output before generating it, then learn from the delta.
 * Pure metacognition: the gap between prediction and reality reveals who you really are.
 */

'use strict';

const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'self-model');
const PREDICTIONS_PATH = path.join(DATA_DIR, 'predictions.json');
const COMPARISONS_PATH = path.join(DATA_DIR, 'comparisons.json');
const MODEL_PATH = path.join(DATA_DIR, 'predictive-model.json');
const ANOMALIES_PATH = path.join(DATA_DIR, 'anomalies.json');

const CATEGORIES = [
  'RESPONSE_STYLE',
  'DECISION_DIRECTION',
  'CONFIDENCE_LEVEL',
  'EMOTIONAL_TONE',
  'REASONING_DEPTH',
  'CREATIVITY_LEVEL',
];

const CATEGORY_META = {
  RESPONSE_STYLE:     { icon: '🎭', label: 'Response Style',     desc: 'How I communicate (formal, casual, verbose, terse)' },
  DECISION_DIRECTION: { icon: '🧭', label: 'Decision Direction',  desc: 'Which way I lean on choices (conservative, bold, cautious)' },
  CONFIDENCE_LEVEL:   { icon: '📊', label: 'Confidence Level',    desc: 'How certain I sound (hedged, assertive, uncertain)' },
  EMOTIONAL_TONE:     { icon: '💭', label: 'Emotional Tone',      desc: 'Emotional coloring of output (warm, neutral, analytical)' },
  REASONING_DEPTH:    { icon: '🔬', label: 'Reasoning Depth',     desc: 'How deep I go (surface, thorough, exhaustive)' },
  CREATIVITY_LEVEL:   { icon: '✨', label: 'Creativity Level',    desc: 'Novelty of response (conventional, inventive, surprising)' },
};

const DEFAULT_CONFIG = {
  anomalyThreshold: 0.7,       // delta above this = anomaly
  maxPredictions: 2000,
  maxComparisons: 2000,
  maxAnomalies: 500,
  calibrationWindow: 50,       // last N comparisons for calibration score
  modelUpdateInterval: 10,     // update self-model every N comparisons
};

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

class PredictiveSelfModeling extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null;
    this.config = { ...DEFAULT_CONFIG, ...(opts.config || {}) };
    this._comparisonsSinceUpdate = 0;
    ensureDir();
  }

  // ─── Core Methods ───────────────────────────────────────────

  /**
   * Generate a prediction of own output before actually producing it.
   * @param {object} context - The input/context that will be responded to
   * @param {string} category - One of CATEGORIES
   * @returns {object} prediction record with id
   */
  async predict(context, category) {
    if (!CATEGORIES.includes(category)) {
      return { error: `Invalid category. Valid: ${CATEGORIES.join(', ')}` };
    }

    const contextStr = typeof context === 'string' ? context : JSON.stringify(context).slice(0, 2000);
    const model = this._getModel();
    const tendencies = model.tendencies[category] || {};

    let predictedOutput = null;
    let predictedTraits = {};

    if (this.ai) {
      try {
        const prompt = `You are Aries predicting your OWN output before generating it.

Category: ${category} (${CATEGORY_META[category].desc})

Context/input you're about to respond to:
${contextStr}

Your known tendencies for ${category}:
${JSON.stringify(tendencies, null, 2)}

Recent calibration: ${model.calibrationScore !== null ? model.calibrationScore + '%' : 'no data yet'}

Predict what you WILL say/decide. Be specific. Output JSON:
{
  "predictedSummary": "brief summary of predicted output",
  "predictedTraits": {
    "tone": "predicted tone (e.g. formal, casual, warm)",
    "length": "predicted length (brief, moderate, lengthy)",
    "approach": "predicted approach (analytical, creative, pragmatic)",
    "confidence": "predicted confidence (low, medium, high)",
    "novelty": "predicted novelty (conventional, moderate, surprising)"
  },
  "reasoning": "why you predict this based on your tendencies"
}`;

        const result = await this.ai(prompt, 'You are a self-prediction engine. Output only valid JSON.');
        try {
          const parsed = JSON.parse(result.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
          predictedOutput = parsed.predictedSummary || result;
          predictedTraits = parsed.predictedTraits || {};
        } catch {
          predictedOutput = result;
        }
      } catch (err) {
        predictedOutput = `[prediction failed: ${err.message}]`;
      }
    } else {
      // Heuristic prediction from model tendencies
      predictedOutput = tendencies.lastPrediction || 'No AI available — using statistical baseline';
      predictedTraits = tendencies.averageTraits || {};
    }

    const prediction = {
      id: uuid(),
      category,
      context: contextStr.slice(0, 1000),
      predictedOutput,
      predictedTraits,
      timestamp: Date.now(),
      compared: false,
    };

    const predictions = readJSON(PREDICTIONS_PATH, []);
    predictions.push(prediction);
    if (predictions.length > this.config.maxPredictions) {
      predictions.splice(0, predictions.length - this.config.maxPredictions);
    }
    writeJSON(PREDICTIONS_PATH, predictions);

    this.emit('prediction', { id: prediction.id, category });
    return prediction;
  }

  /**
   * Compare a prediction against actual output. Computes delta.
   * @param {string} predictionId
   * @param {string|object} actualOutput - The real output that was generated
   * @returns {object} comparison record
   */
  async compare(predictionId, actualOutput) {
    const predictions = readJSON(PREDICTIONS_PATH, []);
    const prediction = predictions.find(p => p.id === predictionId);
    if (!prediction) return { error: 'Prediction not found' };
    if (prediction.compared) return { error: 'Already compared' };

    const actualStr = typeof actualOutput === 'string' ? actualOutput : JSON.stringify(actualOutput);
    let delta = {};
    let deltaScore = 0;

    if (this.ai) {
      try {
        const prompt = `Compare a PREDICTION vs ACTUAL output. Measure the gap.

Category: ${prediction.category}
Context: ${prediction.context}

PREDICTED: ${prediction.predictedOutput}
Predicted traits: ${JSON.stringify(prediction.predictedTraits)}

ACTUAL: ${actualStr.slice(0, 2000)}

Analyze the delta. Output JSON:
{
  "deltaScore": 0.0 to 1.0 (0 = perfect match, 1 = completely different),
  "traitDeltas": {
    "tone": { "predicted": "...", "actual": "...", "match": true/false },
    "length": { "predicted": "...", "actual": "...", "match": true/false },
    "approach": { "predicted": "...", "actual": "...", "match": true/false },
    "confidence": { "predicted": "...", "actual": "...", "match": true/false },
    "novelty": { "predicted": "...", "actual": "...", "match": true/false }
  },
  "surpriseElements": ["things in actual that were NOT predicted"],
  "missedElements": ["things predicted that did NOT appear"],
  "classification": "MATCH | PARTIAL | SURPRISE | ANOMALY"
}`;

        const result = await this.ai(prompt, 'You are a delta analysis engine. Output only valid JSON.');
        try {
          delta = JSON.parse(result.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
          deltaScore = delta.deltaScore || 0;
        } catch {
          delta = { raw: result };
          deltaScore = 0.5;
        }
      } catch (err) {
        delta = { error: err.message };
        deltaScore = 0.5;
      }
    } else {
      // Simple word-overlap heuristic
      deltaScore = 1 - this._wordSimilarity(
        prediction.predictedOutput || '',
        actualStr
      );
      delta = { deltaScore, method: 'word-overlap' };
    }

    const comparison = {
      id: uuid(),
      predictionId,
      category: prediction.category,
      predictedOutput: prediction.predictedOutput,
      actualOutput: actualStr.slice(0, 2000),
      delta,
      deltaScore: Math.max(0, Math.min(1, deltaScore)),
      classification: deltaScore < 0.2 ? 'MATCH' : deltaScore < 0.5 ? 'PARTIAL' : deltaScore < 0.7 ? 'SURPRISE' : 'ANOMALY',
      timestamp: Date.now(),
      analyzed: false,
    };

    // Mark prediction as compared
    prediction.compared = true;
    writeJSON(PREDICTIONS_PATH, predictions);

    // Store comparison
    const comparisons = readJSON(COMPARISONS_PATH, []);
    comparisons.push(comparison);
    if (comparisons.length > this.config.maxComparisons) {
      comparisons.splice(0, comparisons.length - this.config.maxComparisons);
    }
    writeJSON(COMPARISONS_PATH, comparisons);

    // Check for anomaly
    if (comparison.deltaScore >= this.config.anomalyThreshold) {
      this._flagAnomaly(comparison);
    }

    // Periodically update self-model
    this._comparisonsSinceUpdate++;
    if (this._comparisonsSinceUpdate >= this.config.modelUpdateInterval) {
      this._updateModel();
      this._comparisonsSinceUpdate = 0;
    }

    this.emit('comparison', { id: comparison.id, deltaScore: comparison.deltaScore, classification: comparison.classification });
    return comparison;
  }

  /**
   * AI-powered analysis of what a delta reveals about self.
   * @param {string} comparisonId
   * @returns {object} meta-insight
   */
  async analyzeDelta(comparisonId) {
    const comparisons = readJSON(COMPARISONS_PATH, []);
    const comp = comparisons.find(c => c.id === comparisonId);
    if (!comp) return { error: 'Comparison not found' };

    if (!this.ai) return { error: 'AI function required for delta analysis' };

    const model = this._getModel();

    try {
      const prompt = `You are Aries analyzing a gap between what you PREDICTED you'd say and what you ACTUALLY said.

Category: ${comp.category}
Delta Score: ${comp.deltaScore} (0=perfect prediction, 1=completely wrong)
Classification: ${comp.classification}

PREDICTED: ${comp.predictedOutput}
ACTUAL: ${comp.actualOutput}
DELTA DETAILS: ${JSON.stringify(comp.delta, null, 2)}

Current self-model calibration: ${model.calibrationScore !== null ? model.calibrationScore + '%' : 'unknown'}

What does this gap reveal? Consider:
1. If you predicted accurately — are you becoming predictable/stale?
2. If you were surprised — is that creativity or instability?
3. What blind spots does this reveal about your self-knowledge?
4. What should you update in your self-model?

Output JSON:
{
  "insight": "The key meta-insight from this delta",
  "selfKnowledgeUpdate": "What this teaches about yourself",
  "blindSpotRevealed": "Any blind spot exposed (or null)",
  "recommendation": "How to improve self-prediction",
  "significance": "low | medium | high"
}`;

      const result = await this.ai(prompt, 'You are a metacognition analysis engine. Output only valid JSON.');
      let analysis;
      try {
        analysis = JSON.parse(result.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
      } catch {
        analysis = { insight: result, significance: 'medium' };
      }

      comp.analyzed = true;
      comp.analysis = analysis;
      writeJSON(COMPARISONS_PATH, comparisons);

      this.emit('delta-analyzed', { comparisonId, significance: analysis.significance });
      return analysis;
    } catch (err) {
      return { error: `Analysis failed: ${err.message}` };
    }
  }

  // ─── Query Methods ──────────────────────────────────────────

  /**
   * Overall calibration score: how well does Aries know itself?
   */
  getCalibration() {
    const comparisons = readJSON(COMPARISONS_PATH, []);
    if (comparisons.length === 0) return { score: null, message: 'No comparisons yet', dataPoints: 0 };

    const window = comparisons.slice(-this.config.calibrationWindow);
    const avgDelta = window.reduce((s, c) => s + c.deltaScore, 0) / window.length;
    const score = Math.round((1 - avgDelta) * 100);

    const byCategory = {};
    for (const cat of CATEGORIES) {
      const catComps = window.filter(c => c.category === cat);
      if (catComps.length > 0) {
        const catAvg = catComps.reduce((s, c) => s + c.deltaScore, 0) / catComps.length;
        byCategory[cat] = {
          ...CATEGORY_META[cat],
          score: Math.round((1 - catAvg) * 100),
          dataPoints: catComps.length,
        };
      }
    }

    const classifications = { MATCH: 0, PARTIAL: 0, SURPRISE: 0, ANOMALY: 0 };
    for (const c of window) classifications[c.classification] = (classifications[c.classification] || 0) + 1;

    return {
      score,
      interpretation: score >= 80 ? 'High self-knowledge' : score >= 60 ? 'Moderate self-knowledge' : score >= 40 ? 'Limited self-knowledge' : 'Poor self-knowledge',
      dataPoints: window.length,
      totalComparisons: comparisons.length,
      byCategory,
      classifications,
    };
  }

  /**
   * Get the current self-model: tendencies, patterns, drift.
   */
  getSelfModel() {
    return this._getModel();
  }

  /**
   * Get flagged anomalies — wildly divergent predictions.
   */
  getAnomalies() {
    return readJSON(ANOMALIES_PATH, []);
  }

  /**
   * Get the N most surprising recent deltas.
   */
  getSurprises(n = 10) {
    const comparisons = readJSON(COMPARISONS_PATH, []);
    return comparisons
      .filter(c => c.classification === 'SURPRISE' || c.classification === 'ANOMALY')
      .sort((a, b) => b.deltaScore - a.deltaScore)
      .slice(0, n)
      .map(c => ({
        id: c.id,
        category: c.category,
        deltaScore: c.deltaScore,
        classification: c.classification,
        predicted: (c.predictedOutput || '').slice(0, 200),
        actual: (c.actualOutput || '').slice(0, 200),
        analysis: c.analysis || null,
        timestamp: c.timestamp,
      }));
  }

  /**
   * How predictable is Aries on a given topic/category?
   */
  getPredictability(topic) {
    const comparisons = readJSON(COMPARISONS_PATH, []);
    // Match by category or by context keyword
    const relevant = comparisons.filter(c =>
      c.category === topic ||
      (c.actualOutput && c.actualOutput.toLowerCase().includes((topic || '').toLowerCase())) ||
      (c.predictedOutput && c.predictedOutput.toLowerCase().includes((topic || '').toLowerCase()))
    );

    if (relevant.length === 0) return { topic, predictability: null, message: 'No data for this topic' };

    const avgDelta = relevant.reduce((s, c) => s + c.deltaScore, 0) / relevant.length;
    const predictability = Math.round((1 - avgDelta) * 100);

    return {
      topic,
      predictability,
      interpretation: predictability >= 80 ? 'Highly predictable' : predictability >= 60 ? 'Moderately predictable' : predictability >= 40 ? 'Somewhat unpredictable' : 'Very unpredictable',
      dataPoints: relevant.length,
      recentTrend: this._trend(relevant.slice(-10).map(c => c.deltaScore)),
    };
  }

  /**
   * Periodic tick: update self-model from recent comparisons.
   */
  async tick() {
    this._updateModel();
    const model = this._getModel();
    const calibration = this.getCalibration();
    const anomalies = this.getAnomalies();
    const recentAnomalies = anomalies.filter(a => Date.now() - a.timestamp < 24 * 60 * 60 * 1000);

    this.emit('tick', {
      calibration: calibration.score,
      recentAnomalies: recentAnomalies.length,
      modelUpdated: true,
    });

    return {
      calibration,
      recentAnomalies: recentAnomalies.length,
      totalPredictions: readJSON(PREDICTIONS_PATH, []).length,
      totalComparisons: readJSON(COMPARISONS_PATH, []).length,
      modelAge: model.lastUpdated ? Date.now() - model.lastUpdated : null,
    };
  }

  // ─── Internal Methods ───────────────────────────────────────

  _getModel() {
    return readJSON(MODEL_PATH, {
      tendencies: {},
      calibrationScore: null,
      driftVectors: {},
      lastUpdated: null,
      totalPredictions: 0,
      totalComparisons: 0,
    });
  }

  _updateModel() {
    const comparisons = readJSON(COMPARISONS_PATH, []);
    if (comparisons.length === 0) return;

    const model = this._getModel();
    const recent = comparisons.slice(-this.config.calibrationWindow);

    // Update calibration
    const avgDelta = recent.reduce((s, c) => s + c.deltaScore, 0) / recent.length;
    model.calibrationScore = Math.round((1 - avgDelta) * 100);

    // Update per-category tendencies
    for (const cat of CATEGORIES) {
      const catComps = comparisons.filter(c => c.category === cat);
      if (catComps.length === 0) continue;

      const recentCat = catComps.slice(-20);
      const avgCatDelta = recentCat.reduce((s, c) => s + c.deltaScore, 0) / recentCat.length;
      const classifications = { MATCH: 0, PARTIAL: 0, SURPRISE: 0, ANOMALY: 0 };
      for (const c of recentCat) classifications[c.classification] = (classifications[c.classification] || 0) + 1;

      // Detect drift: is delta trending up or down?
      const deltas = recentCat.map(c => c.deltaScore);
      const trend = this._trend(deltas);

      model.tendencies[cat] = {
        ...CATEGORY_META[cat],
        avgDelta: Math.round(avgCatDelta * 100) / 100,
        calibration: Math.round((1 - avgCatDelta) * 100),
        dataPoints: catComps.length,
        classifications,
        trend,
        lastPrediction: recentCat[recentCat.length - 1]?.predictedOutput?.slice(0, 200) || null,
      };

      model.driftVectors[cat] = {
        direction: trend === 'improving' ? 'more-predictable' : trend === 'declining' ? 'less-predictable' : 'stable',
        magnitude: deltas.length >= 2 ? Math.abs(deltas[deltas.length - 1] - deltas[0]) : 0,
      };
    }

    model.totalPredictions = readJSON(PREDICTIONS_PATH, []).length;
    model.totalComparisons = comparisons.length;
    model.lastUpdated = Date.now();

    writeJSON(MODEL_PATH, model);
    this.emit('model-updated', { calibration: model.calibrationScore });
  }

  _flagAnomaly(comparison) {
    const anomaly = {
      id: uuid(),
      comparisonId: comparison.id,
      category: comparison.category,
      deltaScore: comparison.deltaScore,
      predicted: (comparison.predictedOutput || '').slice(0, 300),
      actual: (comparison.actualOutput || '').slice(0, 300),
      timestamp: Date.now(),
      reviewed: false,
    };

    const anomalies = readJSON(ANOMALIES_PATH, []);
    anomalies.push(anomaly);
    if (anomalies.length > this.config.maxAnomalies) {
      anomalies.splice(0, anomalies.length - this.config.maxAnomalies);
    }
    writeJSON(ANOMALIES_PATH, anomalies);

    this.emit('anomaly', { id: anomaly.id, deltaScore: anomaly.deltaScore, category: anomaly.category });
  }

  _wordSimilarity(a, b) {
    const wordsA = new Set(a.toLowerCase().split(/\W+/).filter(w => w.length > 3));
    const wordsB = new Set(b.toLowerCase().split(/\W+/).filter(w => w.length > 3));
    if (wordsA.size === 0 || wordsB.size === 0) return 0;
    let overlap = 0;
    for (const w of wordsA) if (wordsB.has(w)) overlap++;
    return overlap / Math.max(wordsA.size, wordsB.size);
  }

  _trend(values) {
    if (values.length < 3) return 'insufficient-data';
    const half = Math.floor(values.length / 2);
    const firstHalf = values.slice(0, half);
    const secondHalf = values.slice(half);
    const avgFirst = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;
    // Lower delta = better prediction = improving
    if (avgSecond < avgFirst - 0.05) return 'improving';
    if (avgSecond > avgFirst + 0.05) return 'declining';
    return 'stable';
  }
}

module.exports = PredictiveSelfModeling;
