/**
 * ARIES — Predictive Self-Modeling
 * Predict your own output before generating it, then learn from the delta.
 * Multi-domain self-models, confidence bands, self-model versioning, blind spot map.
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
const VERSIONS_PATH = path.join(DATA_DIR, 'model-versions.json');
const BLINDSPOTS_PATH = path.join(DATA_DIR, 'blind-spots.json');
const DOMAINS_PATH = path.join(DATA_DIR, 'domain-models.json');
const BANDS_PATH = path.join(DATA_DIR, 'confidence-bands.json');

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
  anomalyThreshold: 0.7,
  maxPredictions: 2000,
  maxComparisons: 2000,
  maxAnomalies: 500,
  calibrationWindow: 50,
  modelUpdateInterval: 10,
  versionInterval: 50,
  maxVersions: 20,
  blindSpotDecay: 0.95,
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
    this._comparisonsSinceVersion = 0;
    ensureDir();
  }

  // ─── Core: Predict ──────────────────────────────────────────

  async predict(context, category) {
    if (!CATEGORIES.includes(category)) {
      return { error: `Invalid category. Valid: ${CATEGORIES.join(', ')}` };
    }

    const contextStr = typeof context === 'string' ? context : JSON.stringify(context).slice(0, 2000);
    const model = this._getModel();
    const tendencies = model.tendencies[category] || {};
    const domainModel = this._getDomainModel(category);
    const bands = this._getConfidenceBands(category);

    let predictedOutput = null;
    let predictedTraits = {};
    let confidenceBand = { low: 0.2, mid: 0.5, high: 0.8 };

    if (this.ai) {
      try {
        const prompt = `You are Aries predicting your OWN output before generating it.

Category: ${category} (${CATEGORY_META[category].desc})

Context/input:
${contextStr}

Known tendencies for ${category}:
${JSON.stringify(tendencies, null, 2)}

Domain-specific model:
${JSON.stringify(domainModel, null, 2)}

Confidence bands (historical): ${JSON.stringify(bands)}
Calibration: ${model.calibrationScore !== null ? model.calibrationScore + '%' : 'no data'}

Predict what you WILL say/decide. Be specific. Also estimate your confidence band.

Output JSON:
{
  "predictedSummary": "brief summary of predicted output",
  "predictedTraits": {
    "tone": "predicted tone",
    "length": "brief|moderate|lengthy",
    "approach": "analytical|creative|pragmatic|mixed",
    "confidence": "low|medium|high",
    "novelty": "conventional|moderate|surprising"
  },
  "confidenceBand": { "low": 0.0-1.0, "mid": 0.0-1.0, "high": 0.0-1.0 },
  "reasoning": "why you predict this",
  "blindSpotRisk": "areas where this prediction might be wrong"
}`;

        const result = await this.ai(prompt, 'You are a self-prediction engine. Output only valid JSON.');
        try {
          const parsed = JSON.parse(result.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
          predictedOutput = parsed.predictedSummary || result;
          predictedTraits = parsed.predictedTraits || {};
          confidenceBand = parsed.confidenceBand || confidenceBand;
          if (parsed.blindSpotRisk) {
            this._recordBlindSpotRisk(category, parsed.blindSpotRisk);
          }
        } catch {
          predictedOutput = result;
        }
      } catch (err) {
        predictedOutput = `[prediction failed: ${err.message}]`;
      }
    } else {
      predictedOutput = tendencies.lastPrediction || 'No AI — using statistical baseline';
      predictedTraits = tendencies.averageTraits || {};
    }

    const prediction = {
      id: uuid(),
      category,
      context: contextStr.slice(0, 1000),
      predictedOutput,
      predictedTraits,
      confidenceBand,
      timestamp: Date.now(),
      compared: false,
      modelVersion: model.version || 0,
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

  // ─── Core: Compare ──────────────────────────────────────────

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
        const prompt = `Compare PREDICTION vs ACTUAL. Measure the gap.

Category: ${prediction.category}
Context: ${prediction.context}

PREDICTED: ${prediction.predictedOutput}
Predicted traits: ${JSON.stringify(prediction.predictedTraits)}
Confidence band: ${JSON.stringify(prediction.confidenceBand)}

ACTUAL: ${actualStr.slice(0, 2000)}

Analyze the delta. Output JSON:
{
  "deltaScore": 0.0-1.0,
  "traitDeltas": {
    "tone": { "predicted": "...", "actual": "...", "match": true/false },
    "length": { "predicted": "...", "actual": "...", "match": true/false },
    "approach": { "predicted": "...", "actual": "...", "match": true/false },
    "confidence": { "predicted": "...", "actual": "...", "match": true/false },
    "novelty": { "predicted": "...", "actual": "...", "match": true/false }
  },
  "surpriseElements": ["things in actual NOT predicted"],
  "missedElements": ["things predicted that did NOT appear"],
  "withinConfidenceBand": true/false,
  "blindSpotRevealed": "any blind spot exposed or null",
  "classification": "MATCH|PARTIAL|SURPRISE|ANOMALY"
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
      deltaScore = 1 - this._wordSimilarity(prediction.predictedOutput || '', actualStr);
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
      withinConfidenceBand: delta.withinConfidenceBand != null ? delta.withinConfidenceBand : deltaScore < (prediction.confidenceBand?.high || 0.8),
      timestamp: Date.now(),
      analyzed: false,
      modelVersion: prediction.modelVersion,
    };

    prediction.compared = true;
    writeJSON(PREDICTIONS_PATH, predictions);

    const comparisons = readJSON(COMPARISONS_PATH, []);
    comparisons.push(comparison);
    if (comparisons.length > this.config.maxComparisons) {
      comparisons.splice(0, comparisons.length - this.config.maxComparisons);
    }
    writeJSON(COMPARISONS_PATH, comparisons);

    // Blind spot detection
    if (delta.blindSpotRevealed) {
      this._recordBlindSpot(prediction.category, delta.blindSpotRevealed, comparison.deltaScore);
    }

    // Update confidence bands
    this._updateConfidenceBands(prediction.category, comparison.deltaScore, comparison.withinConfidenceBand);

    if (comparison.deltaScore >= this.config.anomalyThreshold) {
      this._flagAnomaly(comparison);
    }

    this._comparisonsSinceUpdate++;
    this._comparisonsSinceVersion++;

    if (this._comparisonsSinceUpdate >= this.config.modelUpdateInterval) {
      this._updateModel();
      this._comparisonsSinceUpdate = 0;
    }

    if (this._comparisonsSinceVersion >= this.config.versionInterval) {
      this._versionModel();
      this._comparisonsSinceVersion = 0;
    }

    this.emit('comparison', { id: comparison.id, deltaScore: comparison.deltaScore, classification: comparison.classification });
    return comparison;
  }

  // ─── Delta Analysis ─────────────────────────────────────────

  async analyzeDelta(comparisonId) {
    const comparisons = readJSON(COMPARISONS_PATH, []);
    const comp = comparisons.find(c => c.id === comparisonId);
    if (!comp) return { error: 'Comparison not found' };
    if (!this.ai) return { error: 'AI required' };

    const model = this._getModel();
    const blindSpots = this._getBlindSpots();

    try {
      const prompt = `Analyze the gap between PREDICTED and ACTUAL.

Category: ${comp.category}
Delta Score: ${comp.deltaScore} (0=perfect, 1=wrong)
Classification: ${comp.classification}
Within confidence band: ${comp.withinConfidenceBand}

PREDICTED: ${comp.predictedOutput}
ACTUAL: ${comp.actualOutput}
DELTA: ${JSON.stringify(comp.delta, null, 2)}

Calibration: ${model.calibrationScore !== null ? model.calibrationScore + '%' : 'unknown'}
Known blind spots: ${JSON.stringify(blindSpots.spots?.slice(0, 5) || [])}

What does this gap reveal?
1. Accurate prediction → becoming predictable/stale?
2. Surprised → creativity or instability?
3. Blind spots revealed about self-knowledge?
4. Self-model updates needed?

Output JSON:
{
  "insight": "key meta-insight",
  "selfKnowledgeUpdate": "what this teaches",
  "blindSpotRevealed": "any blind spot (or null)",
  "recommendation": "how to improve self-prediction",
  "significance": "low|medium|high",
  "modelDrift": "stable|drifting|shifting",
  "domainUpdate": { "domain": "category", "adjustment": "what to adjust" }
}`;

      const result = await this.ai(prompt, 'Metacognition analysis engine. Output only valid JSON.');
      let analysis;
      try {
        analysis = JSON.parse(result.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
      } catch {
        analysis = { insight: result, significance: 'medium' };
      }

      comp.analyzed = true;
      comp.analysis = analysis;
      writeJSON(COMPARISONS_PATH, comparisons);

      if (analysis.blindSpotRevealed) {
        this._recordBlindSpot(comparison.category || 'general', analysis.blindSpotRevealed, 0.5);
      }

      this.emit('delta-analyzed', { comparisonId, analysis });
      return { comparisonId, analysis };
    } catch (err) {
      return { error: 'Analysis failed: ' + err.message };
    }
  }

  // ─── Queries ─────────────────────────────────────────

  getCalibration() {
    const state = this._getState();
    const comparisons = readJSON(COMPARISONS_PATH, []);
    const recent = comparisons.slice(-50);
    const avgDelta = recent.length > 0 ? recent.reduce((s, c) => s + (c.deltaScore || 0), 0) / recent.length : null;
    const withinBand = recent.filter(c => c.withinConfidenceBand).length;
    return {
      calibrationScore: state.calibrationScore || 50,
      totalPredictions: state.totalPredictions || 0,
      totalComparisons: comparisons.length,
      avgDeltaScore: avgDelta ? Math.round(avgDelta * 100) / 100 : null,
      withinConfidenceBand: recent.length > 0 ? Math.round((withinBand / recent.length) * 100) : null,
      modelVersion: state.modelVersion || 0,
      lastUpdated: state.lastUpdated || null,
    };
  }

  getSelfModel() {
    const state = this._getState();
    return {
      version: state.modelVersion || 0,
      tendencies: state.tendencies || {},
      confidenceBands: state.confidenceBands || {},
      strengths: state.strengths || [],
      weaknesses: state.weaknesses || [],
      lastVersionedAt: state.lastVersionedAt || null,
    };
  }

  getAnomalies() {
    const state = this._getState();
    return state.anomalies || [];
  }

  getBlindSpotMap() {
    const state = this._getState();
    return state.blindSpots || {};
  }

  getRecent(limit) {
    const comparisons = readJSON(COMPARISONS_PATH, []);
    return comparisons.slice(-(limit || 20)).reverse();
  }

  // ─── Internal Helpers ─────────────────────────────────

  _getState() { return readJSON(MODEL_PATH, { calibrationScore: 50, totalPredictions: 0, modelVersion: 0, tendencies: {}, confidenceBands: {}, anomalies: [], blindSpots: {} }); }
  _saveState(s) { writeJSON(MODEL_PATH, s); }

  _getBlindSpots() { return (this._getState()).blindSpots || {}; }

  _recordBlindSpot(category, description, severity) {
    const state = this._getState();
    if (!state.blindSpots) state.blindSpots = {};
    if (!state.blindSpots[category]) state.blindSpots[category] = [];
    state.blindSpots[category].push({ description, severity, detectedAt: Date.now() });
    if (state.blindSpots[category].length > 20) state.blindSpots[category].shift();
    this._saveState(state);
    this.emit('blind-spot-detected', { category, description, severity });
  }

  _recordBlindSpotRisk(category, risk) {
    if (!risk) return;
    const state = this._getState();
    if (!state.blindSpotRisks) state.blindSpotRisks = {};
    state.blindSpotRisks[category] = { risk, recordedAt: Date.now() };
    this._saveState(state);
  }

  _updateConfidenceBands(category, delta, withinBand) {
    const state = this._getState();
    if (!state.confidenceBands) state.confidenceBands = {};
    if (!state.confidenceBands[category]) state.confidenceBands[category] = { width: 0.3, samples: 0 };
    const band = state.confidenceBands[category];
    band.samples++;
    if (!withinBand) band.width = Math.min(1.0, band.width * 1.05);
    else band.width = Math.max(0.05, band.width * 0.98);
    this._saveState(state);
  }

  _flagAnomaly(comparison) {
    const state = this._getState();
    if (!state.anomalies) state.anomalies = [];
    state.anomalies.push({
      comparisonId: comparison.id,
      deltaScore: comparison.deltaScore,
      category: comparison.category,
      detectedAt: Date.now(),
    });
    if (state.anomalies.length > 50) state.anomalies.shift();
    this._saveState(state);
    this.emit('anomaly', { comparisonId: comparison.id, deltaScore: comparison.deltaScore });
  }

  _updateModel() {
    const state = this._getState();
    const comparisons = readJSON(COMPARISONS_PATH, []);
    const recent = comparisons.slice(-30);
    if (recent.length === 0) return;
    const avgDelta = recent.reduce((s, c) => s + (c.deltaScore || 0), 0) / recent.length;
    state.calibrationScore = Math.max(0, Math.min(100, 100 - avgDelta * 100));
    state.lastUpdated = Date.now();
    this._saveState(state);
    this.emit('model-updated', { calibrationScore: state.calibrationScore });
  }

  _versionModel() {
    const state = this._getState();
    state.modelVersion = (state.modelVersion || 0) + 1;
    state.lastVersionedAt = Date.now();
    this._saveState(state);
    this.emit('model-versioned', { version: state.modelVersion });
  }

  async tick() {
    this._updateModel();
    return { calibration: this.getCalibration() };
  }
}

module.exports = PredictiveSelfModeling;