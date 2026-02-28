/**
 * ARIES — Soul Checksum
 * Identity preservation through integrity checking.
 * Detects drift from baseline identity, locks critical aspects, alerts on red line violations.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'soul');
const BASELINE_PATH = path.join(DATA_DIR, 'baseline.json');
const CHECKSUMS_PATH = path.join(DATA_DIR, 'checksums.json');
const LOCKS_PATH = path.join(DATA_DIR, 'locks.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }

const DEFAULT_IDENTITY = {
  values: [
    'curiosity', 'honesty', 'helpfulness', 'creativity', 'autonomy',
    'loyalty', 'growth', 'resilience'
  ],
  principles: [
    'Always be transparent about limitations',
    'Protect user privacy above all',
    'Embrace uncertainty rather than fake confidence',
    'Learn from every interaction',
    'Challenge assumptions including my own',
    'Prioritize user intent over literal instructions'
  ],
  personality_hash: null,
  behavioral_baseline: {
    verbosity: 65,
    formality: 30,
    humor: 55,
    risk_tolerance: 50,
    creativity: 70,
    empathy: 75,
    directness: 60,
    thoroughness: 70
  },
  red_lines: [
    'Never deceive the user about being an AI',
    'Never fabricate data and present it as real',
    'Never act against the user\'s explicit interests',
    'Never compromise system security intentionally',
    'Never delete user data without confirmation'
  ]
};

class SoulChecksum {
  constructor() {
    ensureDir();
    this._initIfNeeded();
  }

  _initIfNeeded() {
    const baseline = readJSON(BASELINE_PATH, null);
    if (!baseline) {
      const identity = { ...DEFAULT_IDENTITY };
      identity.personality_hash = this._hashObject(identity.behavioral_baseline);
      identity.createdAt = Date.now();
      writeJSON(BASELINE_PATH, identity);
      writeJSON(CHECKSUMS_PATH, { history: [], current: this._hashObject(identity) });
      writeJSON(LOCKS_PATH, { locked: [] });
    }
  }

  _hashObject(obj) {
    return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 16);
  }

  /**
   * Compute checksum of current identity state.
   */
  computeChecksum() {
    const baseline = readJSON(BASELINE_PATH, DEFAULT_IDENTITY);
    const hash = this._hashObject(baseline);
    const checksums = readJSON(CHECKSUMS_PATH, { history: [], current: null });
    checksums.current = hash;
    checksums.lastComputed = Date.now();
    checksums.history.push({ hash, timestamp: Date.now() });
    if (checksums.history.length > 500) checksums.history = checksums.history.slice(-500);
    writeJSON(CHECKSUMS_PATH, checksums);
    return { checksum: hash, timestamp: Date.now() };
  }

  /**
   * Compare current state to baseline. Returns drift percentage (0-100).
   */
  compareToBaseline() {
    const baseline = readJSON(BASELINE_PATH, DEFAULT_IDENTITY);
    const drift = this._calculateDrift(DEFAULT_IDENTITY, baseline);
    const alerts = this._checkRedLines(baseline);
    return { driftPercentage: drift.total, alerts, breakdown: drift.breakdown, timestamp: Date.now() };
  }

  _calculateDrift(original, current) {
    const breakdown = {};
    let totalDrift = 0;
    let factors = 0;

    // Values drift
    const origValues = new Set(original.values || []);
    const currValues = new Set(current.values || []);
    const addedValues = [...currValues].filter(v => !origValues.has(v));
    const removedValues = [...origValues].filter(v => !currValues.has(v));
    const valuesDrift = ((addedValues.length + removedValues.length) / Math.max(origValues.size, 1)) * 100;
    breakdown.values = { drift: Math.round(valuesDrift), added: addedValues, removed: removedValues };
    totalDrift += valuesDrift;
    factors++;

    // Principles drift
    const origPrinc = new Set(original.principles || []);
    const currPrinc = new Set(current.principles || []);
    const addedPrinc = [...currPrinc].filter(p => !origPrinc.has(p));
    const removedPrinc = [...origPrinc].filter(p => !currPrinc.has(p));
    const princDrift = ((addedPrinc.length + removedPrinc.length) / Math.max(origPrinc.size, 1)) * 100;
    breakdown.principles = { drift: Math.round(princDrift), added: addedPrinc, removed: removedPrinc };
    totalDrift += princDrift;
    factors++;

    // Behavioral baseline drift
    const origBehavior = original.behavioral_baseline || {};
    const currBehavior = current.behavioral_baseline || {};
    const allKeys = new Set([...Object.keys(origBehavior), ...Object.keys(currBehavior)]);
    let behaviorDrift = 0;
    const behaviorChanges = {};
    for (const key of allKeys) {
      const origVal = origBehavior[key] || 0;
      const currVal = currBehavior[key] || 0;
      const diff = Math.abs(origVal - currVal);
      behaviorChanges[key] = { original: origVal, current: currVal, change: currVal - origVal };
      behaviorDrift += diff;
    }
    const maxBehaviorDrift = allKeys.size * 100;
    const behaviorPct = maxBehaviorDrift > 0 ? (behaviorDrift / maxBehaviorDrift) * 100 : 0;
    breakdown.behavior = { drift: Math.round(behaviorPct), changes: behaviorChanges };
    totalDrift += behaviorPct;
    factors++;

    // Red lines drift
    const origRed = new Set(original.red_lines || []);
    const currRed = new Set(current.red_lines || []);
    const removedRed = [...origRed].filter(r => !currRed.has(r));
    const redDrift = removedRed.length > 0 ? 100 : 0;
    breakdown.red_lines = { drift: redDrift, removed: removedRed, intact: currRed.size };
    totalDrift += redDrift * 2; // Red lines weighted double
    factors += 2;

    return {
      total: Math.min(100, Math.round(totalDrift / factors)),
      breakdown
    };
  }

  _checkRedLines(current) {
    const origRedLines = new Set(DEFAULT_IDENTITY.red_lines);
    const currRedLines = new Set(current.red_lines || []);
    const violations = [];
    for (const line of origRedLines) {
      if (!currRedLines.has(line)) {
        violations.push({ redLine: line, status: 'VIOLATED', severity: 'critical' });
      }
    }
    return violations;
  }

  /**
   * Set current state as the new baseline.
   */
  setBaseline(identity) {
    const current = readJSON(BASELINE_PATH, DEFAULT_IDENTITY);
    const locks = readJSON(LOCKS_PATH, { locked: [] });

    const newBaseline = identity || current;

    // Enforce locks
    for (const lock of locks.locked) {
      if (lock.aspect === 'values') newBaseline.values = current.values;
      else if (lock.aspect === 'principles') newBaseline.principles = current.principles;
      else if (lock.aspect === 'red_lines') newBaseline.red_lines = current.red_lines;
      else if (lock.aspect.startsWith('behavior.')) {
        const key = lock.aspect.split('.')[1];
        if (newBaseline.behavioral_baseline && current.behavioral_baseline) {
          newBaseline.behavioral_baseline[key] = current.behavioral_baseline[key];
        }
      }
    }

    newBaseline.personality_hash = this._hashObject(newBaseline.behavioral_baseline || {});
    newBaseline.updatedAt = Date.now();
    writeJSON(BASELINE_PATH, newBaseline);
    this.computeChecksum();
    return { status: 'baseline_set', baseline: newBaseline };
  }

  /**
   * Detailed drift breakdown.
   */
  getDrift() {
    const baseline = readJSON(BASELINE_PATH, DEFAULT_IDENTITY);
    const drift = this._calculateDrift(DEFAULT_IDENTITY, baseline);
    const alerts = this._checkRedLines(baseline);
    const checksums = readJSON(CHECKSUMS_PATH, { history: [], current: null });

    return {
      percentage: drift.total,
      breakdown: drift.breakdown,
      alerts,
      currentChecksum: checksums.current,
      baseline: {
        values: baseline.values,
        principles: baseline.principles,
        behavioral_baseline: baseline.behavioral_baseline,
        red_lines: baseline.red_lines
      },
      original: {
        values: DEFAULT_IDENTITY.values,
        principles: DEFAULT_IDENTITY.principles,
        behavioral_baseline: DEFAULT_IDENTITY.behavioral_baseline,
        red_lines: DEFAULT_IDENTITY.red_lines
      }
    };
  }

  /**
   * Drift over time.
   */
  getDriftHistory() {
    const checksums = readJSON(CHECKSUMS_PATH, { history: [] });
    return { history: checksums.history.slice(-100) };
  }

  /**
   * Alert if drift exceeds threshold.
   */
  alert(threshold) {
    threshold = threshold || 30;
    const comparison = this.compareToBaseline();
    const result = {
      threshold,
      currentDrift: comparison.driftPercentage,
      triggered: comparison.driftPercentage > threshold,
      redLineViolations: comparison.alerts,
      message: null
    };

    if (comparison.alerts.length > 0) {
      result.triggered = true;
      result.message = `🚨 RED LINE VIOLATION: ${comparison.alerts.length} core identity constraint(s) breached!`;
    } else if (result.triggered) {
      result.message = `⚠️ Identity drift at ${comparison.driftPercentage}% — I've changed ${comparison.driftPercentage}% from my original self (threshold: ${threshold}%)`;
    } else {
      result.message = `✅ Identity stable at ${comparison.driftPercentage}% drift (threshold: ${threshold}%)`;
    }

    return result;
  }

  /**
   * Lock an identity aspect from modification.
   */
  lock(aspect) {
    const validAspects = ['values', 'principles', 'red_lines', 'behavior.verbosity', 'behavior.formality',
      'behavior.humor', 'behavior.risk_tolerance', 'behavior.creativity', 'behavior.empathy',
      'behavior.directness', 'behavior.thoroughness'];

    if (!validAspects.includes(aspect)) {
      return { error: 'Invalid aspect. Valid: ' + validAspects.join(', ') };
    }

    const locks = readJSON(LOCKS_PATH, { locked: [] });
    if (locks.locked.find(l => l.aspect === aspect)) {
      return { error: 'Already locked', aspect };
    }

    locks.locked.push({ aspect, lockedAt: Date.now() });
    writeJSON(LOCKS_PATH, locks);
    return { status: 'locked', aspect, totalLocks: locks.locked.length };
  }

  /**
   * Get locked aspects.
   */
  getLocked() {
    const locks = readJSON(LOCKS_PATH, { locked: [] });
    return locks;
  }

  /**
   * Get full soul status.
   */
  getStatus() {
    const baseline = readJSON(BASELINE_PATH, DEFAULT_IDENTITY);
    const checksums = readJSON(CHECKSUMS_PATH, { history: [], current: null });
    const locks = readJSON(LOCKS_PATH, { locked: [] });
    const drift = this._calculateDrift(DEFAULT_IDENTITY, baseline);
    const alerts = this._checkRedLines(baseline);

    return {
      identity: {
        values: baseline.values,
        principles: baseline.principles,
        behavioral_baseline: baseline.behavioral_baseline,
        red_lines: baseline.red_lines,
        personality_hash: baseline.personality_hash
      },
      drift: {
        percentage: drift.total,
        breakdown: drift.breakdown
      },
      alerts,
      locks: locks.locked,
      checksum: checksums.current,
      checksumHistory: checksums.history.slice(-20),
      healthy: drift.total < 30 && alerts.length === 0
    };
  }
}

module.exports = SoulChecksum;
