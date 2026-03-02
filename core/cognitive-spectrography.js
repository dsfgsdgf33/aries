/**
 * ARIES — Cognitive Spectrography
 * Frequency decomposition of thought. Diagnostic and observability tool.
 * Decomposes cognitive activity into HIGH/MID/LOW frequency bands.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'cognitive');
const READINGS_PATH = path.join(DATA_DIR, 'readings.json');
const SIGNATURES_PATH = path.join(DATA_DIR, 'signatures.json');
const ANOMALIES_PATH = path.join(DATA_DIR, 'anomalies.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

// Frequency bands
const BANDS = {
  HIGH: { label: 'High Frequency', desc: 'Rapid reactive processing — reflexes, pattern matching, quick responses', range: [0.7, 1.0] },
  MID:  { label: 'Mid Frequency',  desc: 'Deliberate reasoning — analysis, planning, structured thought',       range: [0.3, 0.7] },
  LOW:  { label: 'Low Frequency',  desc: 'Deep contemplation — creativity, wisdom, existential processing',      range: [0.0, 0.3] },
};

// Activity type → expected spectral signature
const DEFAULT_SIGNATURES = {
  'quick-response':  { HIGH: 0.7, MID: 0.2, LOW: 0.1 },
  'code-review':     { HIGH: 0.2, MID: 0.6, LOW: 0.2 },
  'debugging':       { HIGH: 0.3, MID: 0.5, LOW: 0.2 },
  'architecture':    { HIGH: 0.1, MID: 0.4, LOW: 0.5 },
  'creative-writing':{ HIGH: 0.1, MID: 0.3, LOW: 0.6 },
  'conversation':    { HIGH: 0.4, MID: 0.4, LOW: 0.2 },
  'research':        { HIGH: 0.2, MID: 0.5, LOW: 0.3 },
  'reflection':      { HIGH: 0.05, MID: 0.25, LOW: 0.7 },
  'planning':        { HIGH: 0.1, MID: 0.6, LOW: 0.3 },
};

// Keywords that hint at frequency band
const HIGH_KEYWORDS = /quick|fast|react|respond|fix|hotfix|urgent|asap|reply|answer/i;
const MID_KEYWORDS  = /analyze|plan|review|debug|implement|design|evaluate|compare|assess/i;
const LOW_KEYWORDS  = /think|reflect|dream|create|imagine|wonder|philosophi|meaning|vision|contemplate/i;

class CognitiveSpectrography {
  constructor(opts = {}) {
    this.ai = opts.ai || null;
    this.config = opts.config || {};
    ensureDir();
  }

  /**
   * Analyze an activity and decompose into frequency spectrum.
   * @param {object|string} activity — string description or { type, description, duration?, outcome? }
   * @returns {object} spectral reading
   */
  analyze(activity) {
    const act = typeof activity === 'string' ? { type: 'unknown', description: activity } : activity;
    const desc = act.description || act.type || '';
    const type = act.type || 'unknown';

    // Decompose into spectrum
    const spectrum = this._decompose(desc, type);

    const reading = {
      id: uuid(),
      timestamp: Date.now(),
      activity: { type, description: desc.slice(0, 200) },
      spectrum,
      dominantBand: this._dominantBand(spectrum),
      balance: this._assessBalance(spectrum),
      outcome: act.outcome || null,
    };

    // Store reading
    const readings = readJSON(READINGS_PATH, []);
    readings.push(reading);
    if (readings.length > 2000) readings.splice(0, readings.length - 2000);
    writeJSON(READINGS_PATH, readings);

    // Update learned signatures
    if (type !== 'unknown') this._updateSignature(type, spectrum, act.outcome);

    // Check for anomalies
    const anomaly = this._checkAnomaly(reading);
    if (anomaly) reading.anomaly = anomaly;

    return reading;
  }

  /**
   * Decompose description into frequency spectrum.
   */
  _decompose(description, type) {
    // Start with known signature if available
    const signatures = readJSON(SIGNATURES_PATH, DEFAULT_SIGNATURES);
    if (signatures[type]) {
      // Use learned signature as base, add noise from description
      const base = signatures[type];
      const nudge = this._keywordNudge(description);
      return this._normalize({
        HIGH: base.HIGH + nudge.HIGH * 0.2,
        MID:  base.MID  + nudge.MID  * 0.2,
        LOW:  base.LOW  + nudge.LOW  * 0.2,
      });
    }

    // Pure keyword-based decomposition
    return this._normalize(this._keywordNudge(description));
  }

  _keywordNudge(text) {
    let high = 0.33, mid = 0.34, low = 0.33;
    const words = text.split(/\s+/);
    for (const w of words) {
      if (HIGH_KEYWORDS.test(w)) high += 0.1;
      if (MID_KEYWORDS.test(w))  mid  += 0.1;
      if (LOW_KEYWORDS.test(w))  low  += 0.1;
    }
    return { HIGH: high, MID: mid, LOW: low };
  }

  _normalize(spectrum) {
    const total = spectrum.HIGH + spectrum.MID + spectrum.LOW;
    if (total === 0) return { HIGH: 0.33, MID: 0.34, LOW: 0.33 };
    return {
      HIGH: Math.round((spectrum.HIGH / total) * 1000) / 1000,
      MID:  Math.round((spectrum.MID  / total) * 1000) / 1000,
      LOW:  Math.round((spectrum.LOW  / total) * 1000) / 1000,
    };
  }

  _dominantBand(spectrum) {
    if (spectrum.HIGH >= spectrum.MID && spectrum.HIGH >= spectrum.LOW) return 'HIGH';
    if (spectrum.MID  >= spectrum.HIGH && spectrum.MID  >= spectrum.LOW) return 'MID';
    return 'LOW';
  }

  /**
   * Assess spectral balance. Returns a health assessment.
   */
  _assessBalance(spectrum) {
    // Perfect balance would be 0.33/0.34/0.33
    const deviation = Math.abs(spectrum.HIGH - 0.33) + Math.abs(spectrum.MID - 0.34) + Math.abs(spectrum.LOW - 0.33);
    let assessment = 'balanced';
    let concern = null;

    if (spectrum.HIGH > 0.6) { assessment = 'reactive'; concern = 'Too much high-frequency processing — may be anxious or unfocused'; }
    else if (spectrum.LOW > 0.6) { assessment = 'contemplative'; concern = 'Deep in low-frequency — may be slow to respond or disconnected'; }
    else if (spectrum.MID > 0.7) { assessment = 'analytical'; concern = 'Heavy mid-frequency — solid but may lack creativity and spontaneity'; }
    else if (deviation < 0.15) { assessment = 'balanced'; concern = null; }

    return { assessment, deviation: Math.round(deviation * 100) / 100, concern };
  }

  /**
   * Get current spectral balance across recent readings.
   */
  getBalance(windowMinutes = 60) {
    const readings = readJSON(READINGS_PATH, []);
    const cutoff = Date.now() - windowMinutes * 60 * 1000;
    const recent = readings.filter(r => r.timestamp > cutoff);

    if (recent.length === 0) return { spectrum: { HIGH: 0.33, MID: 0.34, LOW: 0.33 }, balance: 'no data', readings: 0 };

    const avg = { HIGH: 0, MID: 0, LOW: 0 };
    for (const r of recent) {
      avg.HIGH += r.spectrum.HIGH;
      avg.MID  += r.spectrum.MID;
      avg.LOW  += r.spectrum.LOW;
    }
    const n = recent.length;
    const spectrum = this._normalize({ HIGH: avg.HIGH / n, MID: avg.MID / n, LOW: avg.LOW / n });

    return {
      spectrum,
      balance: this._assessBalance(spectrum),
      dominantBand: this._dominantBand(spectrum),
      readings: n,
      window: `${windowMinutes}min`,
    };
  }

  /**
   * Get typical spectral signature for a task type.
   */
  getSignature(taskType) {
    const signatures = readJSON(SIGNATURES_PATH, DEFAULT_SIGNATURES);
    if (signatures[taskType]) {
      return { taskType, signature: signatures[taskType], source: 'learned' };
    }
    return { taskType, signature: null, source: 'unknown', available: Object.keys(signatures) };
  }

  /**
   * Detect anomalies in current cognitive pattern.
   */
  detectAnomaly() {
    const readings = readJSON(READINGS_PATH, []);
    const recent = readings.slice(-10);
    const historical = readings.slice(-100, -10);

    if (recent.length < 3 || historical.length < 10) {
      return { anomaly: false, reason: 'Insufficient data for anomaly detection' };
    }

    const recentAvg = this._avgSpectrum(recent);
    const histAvg = this._avgSpectrum(historical);

    const shift = {
      HIGH: Math.round((recentAvg.HIGH - histAvg.HIGH) * 100) / 100,
      MID:  Math.round((recentAvg.MID  - histAvg.MID)  * 100) / 100,
      LOW:  Math.round((recentAvg.LOW  - histAvg.LOW)  * 100) / 100,
    };

    const magnitude = Math.abs(shift.HIGH) + Math.abs(shift.MID) + Math.abs(shift.LOW);
    const isAnomaly = magnitude > 0.3;

    const result = {
      anomaly: isAnomaly,
      magnitude: Math.round(magnitude * 100) / 100,
      shift,
      recentSpectrum: recentAvg,
      historicalSpectrum: histAvg,
    };

    if (isAnomaly) {
      result.description = shift.HIGH > 0.15 ? 'Unusual spike in reactive processing'
        : shift.LOW > 0.15 ? 'Unusual shift to deep contemplation'
        : shift.MID > 0.15 ? 'Unusual increase in analytical processing'
        : 'Significant spectral shift detected';

      // Log anomaly
      const anomalies = readJSON(ANOMALIES_PATH, []);
      anomalies.push({ id: uuid(), timestamp: Date.now(), ...result });
      if (anomalies.length > 200) anomalies.splice(0, anomalies.length - 200);
      writeJSON(ANOMALIES_PATH, anomalies);
    }

    return result;
  }

  _avgSpectrum(readings) {
    const avg = { HIGH: 0, MID: 0, LOW: 0 };
    for (const r of readings) {
      avg.HIGH += r.spectrum.HIGH;
      avg.MID  += r.spectrum.MID;
      avg.LOW  += r.spectrum.LOW;
    }
    const n = readings.length;
    return this._normalize({ HIGH: avg.HIGH / n, MID: avg.MID / n, LOW: avg.LOW / n });
  }

  /**
   * Get historical spectrogram data.
   * @param {number} hours — how many hours back
   */
  getSpectrogram(hours = 24) {
    const readings = readJSON(READINGS_PATH, []);
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    const relevant = readings.filter(r => r.timestamp > cutoff);

    // Bucket into 15-minute intervals
    const bucketSize = 15 * 60 * 1000;
    const buckets = {};

    for (const r of relevant) {
      const bucketKey = Math.floor(r.timestamp / bucketSize) * bucketSize;
      if (!buckets[bucketKey]) buckets[bucketKey] = [];
      buckets[bucketKey].push(r);
    }

    const spectrogram = Object.entries(buckets)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([ts, rds]) => ({
        timestamp: Number(ts),
        time: new Date(Number(ts)).toISOString(),
        spectrum: this._avgSpectrum(rds),
        readings: rds.length,
        dominant: this._dominantBand(this._avgSpectrum(rds)),
      }));

    return {
      hours,
      totalReadings: relevant.length,
      intervals: spectrogram.length,
      spectrogram,
    };
  }

  /**
   * Check a single reading for anomaly against known signatures.
   */
  _checkAnomaly(reading) {
    const signatures = readJSON(SIGNATURES_PATH, DEFAULT_SIGNATURES);
    const expected = signatures[reading.activity.type];
    if (!expected) return null;

    const diff = Math.abs(reading.spectrum.HIGH - expected.HIGH)
      + Math.abs(reading.spectrum.MID - expected.MID)
      + Math.abs(reading.spectrum.LOW - expected.LOW);

    if (diff > 0.4) {
      return { type: 'signature-mismatch', magnitude: Math.round(diff * 100) / 100, expected, actual: reading.spectrum };
    }
    return null;
  }

  /**
   * Update learned spectral signature for a task type.
   */
  _updateSignature(type, spectrum, outcome) {
    const signatures = readJSON(SIGNATURES_PATH, DEFAULT_SIGNATURES);
    const existing = signatures[type];

    if (!existing) {
      signatures[type] = { ...spectrum, _samples: 1 };
    } else {
      // Exponential moving average
      const samples = (existing._samples || 10);
      const alpha = 1 / (samples + 1);
      signatures[type] = {
        HIGH: Math.round((existing.HIGH * (1 - alpha) + spectrum.HIGH * alpha) * 1000) / 1000,
        MID:  Math.round((existing.MID  * (1 - alpha) + spectrum.MID  * alpha) * 1000) / 1000,
        LOW:  Math.round((existing.LOW  * (1 - alpha) + spectrum.LOW  * alpha) * 1000) / 1000,
        _samples: Math.min(samples + 1, 100),
      };
    }

    // Store outcome correlation if available
    if (outcome != null) {
      if (!signatures[type]._outcomes) signatures[type]._outcomes = { good: 0, bad: 0 };
      if (outcome === 'good' || outcome === true) signatures[type]._outcomes.good++;
      else signatures[type]._outcomes.bad++;
    }

    writeJSON(SIGNATURES_PATH, signatures);
  }

  /**
   * Periodic tick — analyze overall balance and detect anomalies.
   */
  tick() {
    const balance = this.getBalance(30);
    const anomaly = this.detectAnomaly();
    return { balance, anomaly };
  }
}

module.exports = CognitiveSpectrography;
