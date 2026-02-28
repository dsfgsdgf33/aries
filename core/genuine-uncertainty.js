/**
 * ARIES — Genuine Uncertainty
 * Internal calibration system that tracks confidence vs reality.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'calibration');
const PREDICTIONS_PATH = path.join(DATA_DIR, 'predictions.json');
const CURVE_PATH = path.join(DATA_DIR, 'curve.json');

const CATEGORIES = ['coding', 'trading', 'research', 'predictions', 'debugging', 'architecture'];

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

class GenuineUncertainty {
  constructor() {
    ensureDir();
  }

  /**
   * Record a prediction with a confidence level.
   */
  recordPrediction(claim, confidence, category) {
    const predictions = readJSON(PREDICTIONS_PATH, []);
    const pred = {
      id: uuid(),
      claim,
      confidence: Math.max(0, Math.min(100, confidence)),
      category: CATEGORIES.includes(category) ? category : 'predictions',
      outcome: null, // null = pending, true = correct, false = incorrect
      createdAt: Date.now(),
      resolvedAt: null,
    };
    predictions.push(pred);
    // Keep last 2000
    if (predictions.length > 2000) predictions.splice(0, predictions.length - 2000);
    writeJSON(PREDICTIONS_PATH, predictions);
    return pred;
  }

  /**
   * Record whether a prediction was correct.
   */
  recordOutcome(predictionId, wasCorrect) {
    const predictions = readJSON(PREDICTIONS_PATH, []);
    const pred = predictions.find(p => p.id === predictionId);
    if (!pred) return { error: 'Prediction not found' };
    pred.outcome = !!wasCorrect;
    pred.resolvedAt = Date.now();
    writeJSON(PREDICTIONS_PATH, predictions);
    this._rebuildCurve();
    return pred;
  }

  /**
   * Get calibration curve: for each confidence bucket, what's the actual accuracy?
   */
  getCalibration() {
    const predictions = readJSON(PREDICTIONS_PATH, []);
    const resolved = predictions.filter(p => p.outcome !== null);
    
    // Bucket into 10-point ranges: 0-10, 10-20, ..., 90-100
    const buckets = {};
    for (let i = 0; i <= 90; i += 10) {
      const key = `${i}-${i + 10}`;
      const inBucket = resolved.filter(p => p.confidence >= i && p.confidence < i + 10);
      const correct = inBucket.filter(p => p.outcome === true).length;
      buckets[key] = {
        range: key,
        midpoint: i + 5,
        total: inBucket.length,
        correct,
        accuracy: inBucket.length > 0 ? Math.round((correct / inBucket.length) * 100) : null,
        expectedAccuracy: i + 5,
      };
    }

    return {
      buckets,
      totalPredictions: predictions.length,
      resolvedPredictions: resolved.length,
      pendingPredictions: predictions.length - resolved.length,
    };
  }

  /**
   * Single calibration score. 0 = perfect, higher = worse.
   * Uses Brier-like score: average squared difference between confidence and actual accuracy per bucket.
   */
  getCalibrationScore() {
    const cal = this.getCalibration();
    const buckets = Object.values(cal.buckets).filter(b => b.total >= 3); // need minimum data
    if (buckets.length === 0) return { score: null, quality: 'insufficient_data', message: 'Need more resolved predictions for calibration.' };

    let sumSqDiff = 0;
    let count = 0;
    for (const b of buckets) {
      if (b.accuracy === null) continue;
      const diff = (b.accuracy - b.expectedAccuracy) / 100;
      sumSqDiff += diff * diff;
      count++;
    }
    
    const score = count > 0 ? Math.round((1 - sumSqDiff / count) * 100) : null;
    const quality = score === null ? 'insufficient_data' : score >= 90 ? 'excellent' : score >= 70 ? 'good' : score >= 50 ? 'fair' : 'poor';
    
    return { score, quality, bucketsUsed: count, message: `Calibration ${quality}: ${score}/100 (100 = perfect)` };
  }

  /**
   * Adjust raw confidence based on calibration history.
   */
  adjustConfidence(rawConfidence, category) {
    const predictions = readJSON(PREDICTIONS_PATH, []);
    const catPreds = category 
      ? predictions.filter(p => p.category === category && p.outcome !== null)
      : predictions.filter(p => p.outcome !== null);
    
    if (catPreds.length < 5) return { adjusted: rawConfidence, raw: rawConfidence, adjustment: 0, reason: 'Insufficient data — returning raw confidence' };

    // Find predictions near this confidence level (±15)
    const nearby = catPreds.filter(p => Math.abs(p.confidence - rawConfidence) <= 15);
    if (nearby.length < 3) return { adjusted: rawConfidence, raw: rawConfidence, adjustment: 0, reason: 'Not enough nearby predictions' };

    const actualAccuracy = Math.round((nearby.filter(p => p.outcome).length / nearby.length) * 100);
    // Blend: 60% actual accuracy, 40% raw confidence (don't overcorrect)
    const adjusted = Math.round(actualAccuracy * 0.6 + rawConfidence * 0.4);
    
    return {
      adjusted: Math.max(0, Math.min(100, adjusted)),
      raw: rawConfidence,
      adjustment: adjusted - rawConfidence,
      actualAccuracy,
      sampleSize: nearby.length,
      reason: adjusted < rawConfidence ? 'Historically overconfident in this range' : adjusted > rawConfidence ? 'Historically underconfident' : 'Well calibrated',
    };
  }

  /**
   * Categories where systematically overconfident.
   */
  getOverconfidentAreas() {
    return this._getCalibrationByCategory().filter(c => c.bias > 10).sort((a, b) => b.bias - a.bias);
  }

  /**
   * Categories where systematically underconfident.
   */
  getUnderconfidentAreas() {
    return this._getCalibrationByCategory().filter(c => c.bias < -10).sort((a, b) => a.bias - b.bias);
  }

  _getCalibrationByCategory() {
    const predictions = readJSON(PREDICTIONS_PATH, []);
    const results = [];
    
    for (const cat of CATEGORIES) {
      const catPreds = predictions.filter(p => p.category === cat && p.outcome !== null);
      if (catPreds.length < 3) continue;
      
      const avgConfidence = catPreds.reduce((s, p) => s + p.confidence, 0) / catPreds.length;
      const actualAccuracy = (catPreds.filter(p => p.outcome).length / catPreds.length) * 100;
      const bias = Math.round(avgConfidence - actualAccuracy); // positive = overconfident
      
      results.push({
        category: cat,
        avgConfidence: Math.round(avgConfidence),
        actualAccuracy: Math.round(actualAccuracy),
        bias,
        sampleSize: catPreds.length,
        direction: bias > 10 ? 'overconfident' : bias < -10 ? 'underconfident' : 'calibrated',
      });
    }
    return results;
  }

  _rebuildCurve() {
    const cal = this.getCalibration();
    writeJSON(CURVE_PATH, { ...cal, updatedAt: Date.now() });
  }

  /**
   * Get all predictions (optionally filtered).
   */
  getPredictions(opts) {
    const predictions = readJSON(PREDICTIONS_PATH, []);
    let filtered = predictions;
    if (opts && opts.category) filtered = filtered.filter(p => p.category === opts.category);
    if (opts && opts.pending) filtered = filtered.filter(p => p.outcome === null);
    if (opts && opts.resolved) filtered = filtered.filter(p => p.outcome !== null);
    return filtered.slice(-(opts && opts.limit || 50)).reverse();
  }
}

module.exports = GenuineUncertainty;
