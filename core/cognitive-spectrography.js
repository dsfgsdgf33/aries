/**
 * ARIES — Cognitive Spectrography
 * Frequency decomposition of thought. Diagnostic and observability tool.
 * Decomposes cognitive activity into HIGH/MID/LOW frequency bands.
 *
 * Features:
 * - Frequency decomposition into high/mid/low bands
 * - Spectral balance → cognitive health assessment
 * - Pattern signatures per task type (learned over time)
 * - Historical spectral trends with time series
 * - Spectral anomaly detection (sudden band shifts)
 * - Band-pass filtering (focus on specific frequency ranges)
 * - Resonance detection (multi-band alignment = peak performance)
 * - Spectral comparison between time periods
 * - Cognitive rhythm detection (natural cycles in the spectrum)
 * - Spectrogram data for visualization
 */

'use strict';

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'cognitive');
const READINGS_PATH = path.join(DATA_DIR, 'readings.json');
const SIGNATURES_PATH = path.join(DATA_DIR, 'signatures.json');
const ANOMALIES_PATH = path.join(DATA_DIR, 'anomalies.json');
const RHYTHMS_PATH = path.join(DATA_DIR, 'rhythms.json');

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

class CognitiveSpectrography extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null;
    this.config = opts.config || {};
    ensureDir();
  }

  // ── Core Analysis ──────────────────────────────────────────────────

  /**
   * Analyze an activity and decompose into frequency spectrum.
   * @param {object|string} activity — string description or { type, description, duration?, outcome? }
   * @returns {object} spectral reading
   */
  analyze(activity) {
    const act = typeof activity === 'string' ? { type: 'unknown', description: activity } : activity;
    const desc = act.description || act.type || '';
    const type = act.type || 'unknown';

    const spectrum = this._decompose(desc, type);

    const reading = {
      id: uuid(),
      timestamp: Date.now(),
      activity: { type, description: desc.slice(0, 200) },
      spectrum,
      dominantBand: this._dominantBand(spectrum),
      balance: this._assessBalance(spectrum),
      resonance: this._detectResonance(spectrum),
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
    if (anomaly) {
      reading.anomaly = anomaly;
      this.emit('anomaly', anomaly);
    }

    // Check for resonance
    if (reading.resonance.inResonance) {
      this.emit('resonance', reading.resonance);
    }

    this.emit('reading', reading);
    return reading;
  }

  // ── Frequency Decomposition ────────────────────────────────────────

  /**
   * Decompose description into frequency spectrum.
   */
  _decompose(description, type) {
    const signatures = readJSON(SIGNATURES_PATH, DEFAULT_SIGNATURES);
    if (signatures[type]) {
      const base = signatures[type];
      const nudge = this._keywordNudge(description);
      return this._normalize({
        HIGH: base.HIGH + nudge.HIGH * 0.2,
        MID:  base.MID  + nudge.MID  * 0.2,
        LOW:  base.LOW  + nudge.LOW  * 0.2,
      });
    }
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

  // ── Spectral Balance & Health ──────────────────────────────────────

  /**
   * Assess spectral balance — cognitive health indicator.
   */
  _assessBalance(spectrum) {
    const deviation = Math.abs(spectrum.HIGH - 0.33) + Math.abs(spectrum.MID - 0.34) + Math.abs(spectrum.LOW - 0.33);
    let assessment = 'balanced';
    let concern = null;
    let healthScore = Math.max(0, Math.round((1 - deviation) * 100));

    if (spectrum.HIGH > 0.6) {
      assessment = 'reactive';
      concern = 'Too much high-frequency processing — may indicate anxiety, scattered focus, or reactive mode';
      healthScore = Math.max(20, healthScore - 20);
    } else if (spectrum.LOW > 0.6) {
      assessment = 'contemplative';
      concern = 'Deep in low-frequency — may indicate lethargy, over-thinking, or disconnection from action';
      healthScore = Math.max(20, healthScore - 15);
    } else if (spectrum.MID > 0.7) {
      assessment = 'analytical';
      concern = 'Heavy mid-frequency — solid but may lack creativity and spontaneity';
      healthScore = Math.max(30, healthScore - 10);
    } else if (deviation < 0.15) {
      assessment = 'balanced';
      concern = null;
    }

    return { assessment, deviation: Math.round(deviation * 100) / 100, concern, healthScore };
  }

  /**
   * Get current spectral balance across recent readings.
   */
  getBalance(windowMinutes = 60) {
    const readings = readJSON(READINGS_PATH, []);
    const cutoff = Date.now() - windowMinutes * 60 * 1000;
    const recent = readings.filter(r => r.timestamp > cutoff);

    if (recent.length === 0) return { spectrum: { HIGH: 0.33, MID: 0.34, LOW: 0.33 }, balance: { assessment: 'no data', healthScore: 50 }, readings: 0 };

    const spectrum = this._avgSpectrum(recent);
    return {
      spectrum,
      balance: this._assessBalance(spectrum),
      dominantBand: this._dominantBand(spectrum),
      resonance: this._detectResonance(spectrum),
      readings: recent.length,
      window: `${windowMinutes}min`,
    };
  }

  // ── Band-Pass Filtering ────────────────────────────────────────────

  /**
   * Band-pass filter — extract readings where a specific band dominates.
   * @param {'HIGH'|'MID'|'LOW'} band — the band to focus on
   * @param {number} [threshold=0.4] — minimum value for the band
   * @param {number} [hours=24] — time window
   * @returns {object} filtered readings and statistics
   */
  bandPassFilter(band, threshold = 0.4, hours = 24) {
    band = band.toUpperCase();
    if (!BANDS[band]) return { error: `Invalid band: ${band}. Use HIGH, MID, or LOW.` };

    const readings = readJSON(READINGS_PATH, []);
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    const relevant = readings.filter(r => r.timestamp > cutoff);
    const filtered = relevant.filter(r => r.spectrum[band] >= threshold);

    const avgFiltered = filtered.length > 0 ? this._avgSpectrum(filtered) : null;

    return {
      band,
      threshold,
      hours,
      totalReadings: relevant.length,
      matchingReadings: filtered.length,
      ratio: relevant.length > 0 ? Math.round((filtered.length / relevant.length) * 100) : 0,
      avgSpectrum: avgFiltered,
      readings: filtered.slice(-20).map(r => ({
        id: r.id,
        timestamp: r.timestamp,
        time: new Date(r.timestamp).toISOString(),
        activity: r.activity,
        spectrum: r.spectrum,
      })),
    };
  }

  // ── Resonance Detection ────────────────────────────────────────────

  /**
   * Detect resonance — when multiple bands align near each other = peak performance.
   * True resonance means all bands are active (balanced) with high total energy.
   */
  _detectResonance(spectrum) {
    // Resonance = all bands within 0.15 of each other (roughly balanced)
    const values = [spectrum.HIGH, spectrum.MID, spectrum.LOW];
    const max = Math.max(...values);
    const min = Math.min(...values);
    const spread = max - min;
    const inResonance = spread < 0.15;

    // Harmony score: 0 (one band dominates) to 1 (perfect balance)
    const harmony = Math.max(0, Math.round((1 - spread * 3) * 100)) / 100;

    return {
      inResonance,
      harmony,
      spread: Math.round(spread * 1000) / 1000,
      description: inResonance
        ? 'Peak performance zone — all cognitive bands aligned'
        : spread < 0.25
          ? 'Near-resonance — close to cognitive alignment'
          : 'Off-resonance — one band dominating',
    };
  }

  /**
   * Find resonance events in history.
   * @param {number} [hours=24]
   * @returns {object[]} resonance events
   */
  findResonanceEvents(hours = 24) {
    const readings = readJSON(READINGS_PATH, []);
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    const relevant = readings.filter(r => r.timestamp > cutoff);

    const resonanceEvents = [];
    let currentEvent = null;

    for (const r of relevant) {
      const res = this._detectResonance(r.spectrum);
      if (res.inResonance) {
        if (!currentEvent) {
          currentEvent = { start: r.timestamp, readings: [r.id], peakHarmony: res.harmony };
        } else {
          currentEvent.readings.push(r.id);
          currentEvent.peakHarmony = Math.max(currentEvent.peakHarmony, res.harmony);
        }
      } else if (currentEvent) {
        currentEvent.end = r.timestamp;
        currentEvent.durationMs = currentEvent.end - currentEvent.start;
        resonanceEvents.push(currentEvent);
        currentEvent = null;
      }
    }
    if (currentEvent) {
      currentEvent.end = Date.now();
      currentEvent.durationMs = currentEvent.end - currentEvent.start;
      currentEvent.ongoing = true;
      resonanceEvents.push(currentEvent);
    }

    return {
      hours,
      events: resonanceEvents,
      totalResonanceTime: resonanceEvents.reduce((s, e) => s + e.durationMs, 0),
      peakHarmony: resonanceEvents.length > 0 ? Math.max(...resonanceEvents.map(e => e.peakHarmony)) : 0,
    };
  }

  // ── Spectral Signatures ────────────────────────────────────────────

  /**
   * Get typical spectral signature for a task type.
   */
  getSignature(taskType) {
    const signatures = readJSON(SIGNATURES_PATH, DEFAULT_SIGNATURES);
    if (signatures[taskType]) {
      const sig = { ...signatures[taskType] };
      const meta = { samples: sig._samples || 0, outcomes: sig._outcomes || null };
      delete sig._samples; delete sig._outcomes;
      return { taskType, signature: sig, meta, source: 'learned' };
    }
    return { taskType, signature: null, source: 'unknown', available: Object.keys(signatures) };
  }

  /**
   * Get all known signatures.
   */
  getAllSignatures() {
    const signatures = readJSON(SIGNATURES_PATH, DEFAULT_SIGNATURES);
    const result = {};
    for (const [type, sig] of Object.entries(signatures)) {
      result[type] = { HIGH: sig.HIGH, MID: sig.MID, LOW: sig.LOW, samples: sig._samples || 0 };
    }
    return result;
  }

  // ── Anomaly Detection ──────────────────────────────────────────────

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
        : shift.HIGH < -0.15 ? 'Unusual drop in reactive processing'
        : shift.LOW < -0.15 ? 'Unusual drop in contemplative processing'
        : 'Significant spectral shift detected';

      result.severity = magnitude > 0.6 ? 'critical' : magnitude > 0.45 ? 'warning' : 'notice';

      const anomalies = readJSON(ANOMALIES_PATH, []);
      anomalies.push({ id: uuid(), timestamp: Date.now(), ...result });
      if (anomalies.length > 200) anomalies.splice(0, anomalies.length - 200);
      writeJSON(ANOMALIES_PATH, anomalies);

      this.emit('anomaly-detected', result);
    }

    return result;
  }

  /**
   * Get anomaly history.
   * @param {number} [limit=20]
   */
  getAnomalyHistory(limit = 20) {
    return readJSON(ANOMALIES_PATH, []).slice(-limit).reverse();
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
      return { type: 'signature-mismatch', magnitude: Math.round(diff * 100) / 100, expected: { HIGH: expected.HIGH, MID: expected.MID, LOW: expected.LOW }, actual: reading.spectrum };
    }
    return null;
  }

  // ── Spectral Comparison ────────────────────────────────────────────

  /**
   * Compare spectra between two time periods.
   * @param {object} periodA — { start: timestamp, end: timestamp }
   * @param {object} periodB — { start: timestamp, end: timestamp }
   * @returns {object} comparison
   */
  compareSpectra(periodA, periodB) {
    const readings = readJSON(READINGS_PATH, []);

    const readingsA = readings.filter(r => r.timestamp >= periodA.start && r.timestamp <= periodA.end);
    const readingsB = readings.filter(r => r.timestamp >= periodB.start && r.timestamp <= periodB.end);

    if (readingsA.length === 0 || readingsB.length === 0) {
      return { error: 'Insufficient readings in one or both periods', countA: readingsA.length, countB: readingsB.length };
    }

    const specA = this._avgSpectrum(readingsA);
    const specB = this._avgSpectrum(readingsB);

    const delta = {
      HIGH: Math.round((specB.HIGH - specA.HIGH) * 1000) / 1000,
      MID:  Math.round((specB.MID  - specA.MID)  * 1000) / 1000,
      LOW:  Math.round((specB.LOW  - specA.LOW)  * 1000) / 1000,
    };

    const totalShift = Math.abs(delta.HIGH) + Math.abs(delta.MID) + Math.abs(delta.LOW);

    // Determine what changed
    let interpretation = 'Minimal spectral change between periods';
    if (totalShift > 0.1) {
      const biggestShift = Math.abs(delta.HIGH) >= Math.abs(delta.MID) && Math.abs(delta.HIGH) >= Math.abs(delta.LOW) ? 'HIGH'
        : Math.abs(delta.MID) >= Math.abs(delta.LOW) ? 'MID' : 'LOW';
      const direction = delta[biggestShift] > 0 ? 'increased' : 'decreased';
      interpretation = `${biggestShift} band ${direction} most significantly (${delta[biggestShift] > 0 ? '+' : ''}${delta[biggestShift]})`;
    }

    return {
      periodA: { spectrum: specA, balance: this._assessBalance(specA), readings: readingsA.length },
      periodB: { spectrum: specB, balance: this._assessBalance(specB), readings: readingsB.length },
      delta,
      totalShift: Math.round(totalShift * 1000) / 1000,
      interpretation,
    };
  }

  // ── Cognitive Rhythm Detection ─────────────────────────────────────

  /**
   * Detect cognitive rhythms — natural cycles in the spectral data.
   * Looks for periodic patterns in band dominance over time.
   * @param {number} [hours=72] — analysis window
   * @returns {object} rhythm analysis
   */
  detectRhythms(hours = 72) {
    const readings = readJSON(READINGS_PATH, []);
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    const relevant = readings.filter(r => r.timestamp > cutoff);

    if (relevant.length < 20) {
      return { detected: false, reason: 'Insufficient data — need at least 20 readings', count: relevant.length };
    }

    // Bucket into hourly intervals
    const hourlyBuckets = {};
    for (const r of relevant) {
      const hour = Math.floor(r.timestamp / (60 * 60 * 1000));
      if (!hourlyBuckets[hour]) hourlyBuckets[hour] = [];
      hourlyBuckets[hour].push(r);
    }

    const hourlySpectra = Object.entries(hourlyBuckets)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([h, rds]) => ({ hour: Number(h), spectrum: this._avgSpectrum(rds), count: rds.length }));

    // Detect dominant band transitions
    const transitions = [];
    for (let i = 1; i < hourlySpectra.length; i++) {
      const prev = this._dominantBand(hourlySpectra[i - 1].spectrum);
      const curr = this._dominantBand(hourlySpectra[i].spectrum);
      if (prev !== curr) transitions.push({ fromHour: hourlySpectra[i - 1].hour, from: prev, to: curr });
    }

    // Check for time-of-day patterns (group by hour of day)
    const hourOfDayBands = {};
    for (const r of relevant) {
      const hod = new Date(r.timestamp).getHours();
      if (!hourOfDayBands[hod]) hourOfDayBands[hod] = [];
      hourOfDayBands[hod].push(r);
    }

    const dailyPattern = {};
    for (const [hod, rds] of Object.entries(hourOfDayBands)) {
      const avg = this._avgSpectrum(rds);
      dailyPattern[hod] = { spectrum: avg, dominant: this._dominantBand(avg), readings: rds.length };
    }

    // Detect if there's a consistent daily cycle
    const morningHours = [6, 7, 8, 9, 10, 11];
    const afternoonHours = [12, 13, 14, 15, 16, 17];
    const eveningHours = [18, 19, 20, 21, 22, 23];

    const getAvgForHours = (hours) => {
      const rds = hours.flatMap(h => hourOfDayBands[h] || []);
      return rds.length > 0 ? this._avgSpectrum(rds) : null;
    };

    const morningSpec = getAvgForHours(morningHours);
    const afternoonSpec = getAvgForHours(afternoonHours);
    const eveningSpec = getAvgForHours(eveningHours);

    const rhythmResult = {
      detected: transitions.length > 2,
      hours,
      totalReadings: relevant.length,
      hourlyIntervals: hourlySpectra.length,
      transitions: transitions.slice(-20),
      dailyPattern,
      periodSummary: {
        morning:   morningSpec   ? { spectrum: morningSpec,   dominant: this._dominantBand(morningSpec) }   : null,
        afternoon: afternoonSpec ? { spectrum: afternoonSpec, dominant: this._dominantBand(afternoonSpec) } : null,
        evening:   eveningSpec   ? { spectrum: eveningSpec,   dominant: this._dominantBand(eveningSpec) }   : null,
      },
    };

    // Persist rhythm data
    writeJSON(RHYTHMS_PATH, { lastAnalysis: Date.now(), ...rhythmResult });

    this.emit('rhythms', rhythmResult);
    return rhythmResult;
  }

  // ── Historical Trends ──────────────────────────────────────────────

  /**
   * Get spectral trends over time — time series of band values.
   * @param {number} [hours=24]
   * @param {number} [intervalMinutes=15] — bucket size
   * @returns {object} trend data suitable for charting
   */
  getTrends(hours = 24, intervalMinutes = 15) {
    const readings = readJSON(READINGS_PATH, []);
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    const relevant = readings.filter(r => r.timestamp > cutoff);

    const bucketSize = intervalMinutes * 60 * 1000;
    const buckets = {};

    for (const r of relevant) {
      const key = Math.floor(r.timestamp / bucketSize) * bucketSize;
      if (!buckets[key]) buckets[key] = [];
      buckets[key].push(r);
    }

    const series = Object.entries(buckets)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([ts, rds]) => {
        const spectrum = this._avgSpectrum(rds);
        return {
          timestamp: Number(ts),
          time: new Date(Number(ts)).toISOString(),
          HIGH: spectrum.HIGH,
          MID: spectrum.MID,
          LOW: spectrum.LOW,
          readings: rds.length,
          dominant: this._dominantBand(spectrum),
          healthScore: this._assessBalance(spectrum).healthScore,
        };
      });

    // Compute trend direction for each band
    const trendDirection = {};
    if (series.length >= 2) {
      const firstHalf = series.slice(0, Math.floor(series.length / 2));
      const secondHalf = series.slice(Math.floor(series.length / 2));
      for (const band of ['HIGH', 'MID', 'LOW']) {
        const avgFirst = firstHalf.reduce((s, p) => s + p[band], 0) / firstHalf.length;
        const avgSecond = secondHalf.reduce((s, p) => s + p[band], 0) / secondHalf.length;
        const diff = avgSecond - avgFirst;
        trendDirection[band] = diff > 0.05 ? 'rising' : diff < -0.05 ? 'falling' : 'stable';
      }
    }

    return {
      hours,
      intervalMinutes,
      totalReadings: relevant.length,
      dataPoints: series.length,
      trendDirection,
      series,
    };
  }

  // ── Spectrogram (Visualization Data) ───────────────────────────────

  /**
   * Get historical spectrogram data — array of band values over time.
   * @param {number} hours — how many hours back
   * @param {number} [intervalMinutes=15]
   */
  getSpectrogram(hours = 24, intervalMinutes = 15) {
    const readings = readJSON(READINGS_PATH, []);
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    const relevant = readings.filter(r => r.timestamp > cutoff);

    const bucketSize = intervalMinutes * 60 * 1000;
    const buckets = {};

    for (const r of relevant) {
      const bucketKey = Math.floor(r.timestamp / bucketSize) * bucketSize;
      if (!buckets[bucketKey]) buckets[bucketKey] = [];
      buckets[bucketKey].push(r);
    }

    const spectrogram = Object.entries(buckets)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([ts, rds]) => {
        const spectrum = this._avgSpectrum(rds);
        return {
          timestamp: Number(ts),
          time: new Date(Number(ts)).toISOString(),
          spectrum,
          readings: rds.length,
          dominant: this._dominantBand(spectrum),
          resonance: this._detectResonance(spectrum),
        };
      });

    return {
      hours,
      intervalMinutes,
      totalReadings: relevant.length,
      intervals: spectrogram.length,
      spectrogram,
    };
  }

  // ── Signature Management ───────────────────────────────────────────

  /**
   * Update learned spectral signature for a task type.
   */
  _updateSignature(type, spectrum, outcome) {
    const signatures = readJSON(SIGNATURES_PATH, DEFAULT_SIGNATURES);
    const existing = signatures[type];

    if (!existing) {
      signatures[type] = { ...spectrum, _samples: 1 };
    } else {
      const samples = (existing._samples || 10);
      const alpha = 1 / (samples + 1);
      signatures[type] = {
        HIGH: Math.round((existing.HIGH * (1 - alpha) + spectrum.HIGH * alpha) * 1000) / 1000,
        MID:  Math.round((existing.MID  * (1 - alpha) + spectrum.MID  * alpha) * 1000) / 1000,
        LOW:  Math.round((existing.LOW  * (1 - alpha) + spectrum.LOW  * alpha) * 1000) / 1000,
        _samples: Math.min(samples + 1, 100),
      };
      // Preserve outcomes
      if (existing._outcomes) signatures[type]._outcomes = existing._outcomes;
    }

    if (outcome != null) {
      if (!signatures[type]._outcomes) signatures[type]._outcomes = { good: 0, bad: 0, neutral: 0 };
      if (outcome === 'good' || outcome === true) signatures[type]._outcomes.good++;
      else if (outcome === 'bad' || outcome === false) signatures[type]._outcomes.bad++;
      else signatures[type]._outcomes.neutral++;
    }

    writeJSON(SIGNATURES_PATH, signatures);
  }

  // ── Helpers ────────────────────────────────────────────────────────

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

  // ── Periodic Tick ──────────────────────────────────────────────────

  /**
   * Periodic tick — analyze balance, detect anomalies, check rhythms.
   */
  tick() {
    const balance = this.getBalance(30);
    const anomaly = this.detectAnomaly();
    const resonance = balance.resonance || null;

    const result = { balance, anomaly, resonance };

    // Periodically detect rhythms (every 6 hours worth of ticks)
    const rhythms = readJSON(RHYTHMS_PATH, {});
    if (!rhythms.lastAnalysis || (Date.now() - rhythms.lastAnalysis) > 6 * 60 * 60 * 1000) {
      result.rhythms = this.detectRhythms(72);
    }

    this.emit('tick', result);
    return result;
  }
}

module.exports = CognitiveSpectrography;
