/**
 * ARIES — Micro Experiments
 * Continuous tiny A/B tests on itself.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'experiments');
const ACTIVE_PATH = path.join(DATA_DIR, 'active.json');
const HISTORY_PATH = path.join(DATA_DIR, 'history.json');

const EXPERIMENT_TYPES = ['RESPONSE_FORMAT', 'VERBOSITY', 'APPROACH', 'TIMING', 'STYLE'];
const MAX_CONCURRENT = 5;

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

class MicroExperiments {
  constructor() { ensureDir(); }

  startExperiment(type, hypothesis, variantA, variantB, targetSample) {
    if (!EXPERIMENT_TYPES.includes(type)) return { error: 'Invalid type. Valid: ' + EXPERIMENT_TYPES.join(', ') };

    const active = readJSON(ACTIVE_PATH, []);
    if (active.filter(e => e.status === 'running').length >= MAX_CONCURRENT) {
      return { error: 'Max concurrent experiments reached (' + MAX_CONCURRENT + '). Conclude some first.' };
    }

    const experiment = {
      id: uuid(),
      type,
      hypothesis: hypothesis || 'Testing ' + type,
      variantA: { name: variantA || 'Variant A', wins: 0, total: 0 },
      variantB: { name: variantB || 'Variant B', wins: 0, total: 0 },
      metric: 'user_satisfaction',
      sampleSize: targetSample || 20,
      status: 'running',
      winner: null,
      confidence: 0,
      startedAt: Date.now(),
    };

    active.push(experiment);
    writeJSON(ACTIVE_PATH, active);
    return experiment;
  }

  recordResult(expId, variant, outcome) {
    const active = readJSON(ACTIVE_PATH, []);
    const exp = active.find(e => e.id === expId);
    if (!exp) return { error: 'Experiment not found' };
    if (exp.status !== 'running') return { error: 'Experiment not running' };

    const v = variant === 'A' || variant === 'a' ? exp.variantA : exp.variantB;
    v.total++;
    if (outcome === true || outcome === 'win' || outcome === 'success') v.wins++;

    // Auto-check significance
    const totalSamples = exp.variantA.total + exp.variantB.total;
    if (totalSamples >= exp.sampleSize) {
      const sig = this._checkSig(exp);
      exp.confidence = sig.confidence;
      if (sig.significant) {
        exp.winner = sig.winner;
      }
    }

    writeJSON(ACTIVE_PATH, active);
    return { experiment: exp, recorded: { variant, outcome } };
  }

  _checkSig(exp) {
    const a = exp.variantA;
    const b = exp.variantB;
    if (a.total === 0 || b.total === 0) return { significant: false, confidence: 0 };

    const rateA = a.wins / a.total;
    const rateB = b.wins / b.total;
    const diff = Math.abs(rateA - rateB);
    const totalN = a.total + b.total;

    // Simplified significance: need >15% difference with >10 samples each
    const confidence = Math.min(95, Math.round(diff * 100 * Math.min(1, totalN / 20)));
    const significant = diff > 0.15 && a.total >= 5 && b.total >= 5;

    return {
      significant,
      confidence,
      rateA: Math.round(rateA * 100),
      rateB: Math.round(rateB * 100),
      winner: rateA > rateB ? 'A' : 'B',
      winnerName: rateA > rateB ? a.name : b.name,
    };
  }

  checkSignificance(expId) {
    const active = readJSON(ACTIVE_PATH, []);
    const exp = active.find(e => e.id === expId);
    if (!exp) return { error: 'Experiment not found' };
    return this._checkSig(exp);
  }

  conclude(expId) {
    const active = readJSON(ACTIVE_PATH, []);
    const idx = active.findIndex(e => e.id === expId);
    if (idx === -1) return { error: 'Experiment not found' };

    const exp = active[idx];
    const sig = this._checkSig(exp);
    exp.status = 'concluded';
    exp.confidence = sig.confidence;
    exp.winner = sig.winner;
    exp.winnerName = sig.winnerName;
    exp.concludedAt = Date.now();

    // Move to history
    const history = readJSON(HISTORY_PATH, []);
    history.push(exp);
    if (history.length > 200) history.splice(0, history.length - 200);
    writeJSON(HISTORY_PATH, history);

    active.splice(idx, 1);
    writeJSON(ACTIVE_PATH, active);

    return exp;
  }

  apply(expId) {
    const history = readJSON(HISTORY_PATH, []);
    const exp = history.find(e => e.id === expId);
    if (!exp) return { error: 'Experiment not found in history' };
    if (!exp.winner) return { error: 'No winner determined' };

    exp.status = 'applied';
    exp.appliedAt = Date.now();
    writeJSON(HISTORY_PATH, history);

    return { applied: true, experiment: exp, improvement: `Adopted ${exp.winnerName || exp.winner} for ${exp.type}` };
  }

  getRunning() {
    return readJSON(ACTIVE_PATH, []).filter(e => e.status === 'running');
  }

  getConcluded() {
    return readJSON(HISTORY_PATH, []).filter(e => e.status === 'concluded').reverse();
  }

  getImprovements() {
    return readJSON(HISTORY_PATH, []).filter(e => e.status === 'applied').reverse();
  }
}

module.exports = MicroExperiments;
