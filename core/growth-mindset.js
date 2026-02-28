/**
 * ARIES — Growth Mindset
 * Learn from failures at the principle level, not just the instance level.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'growth');
const FAILURES_PATH = path.join(DATA_DIR, 'failures.json');
const ASSUMPTIONS_PATH = path.join(DATA_DIR, 'assumptions.json');
const VELOCITY_PATH = path.join(DATA_DIR, 'velocity.json');

const CATEGORIES = [
  'KNOWLEDGE_GAP', 'WRONG_APPROACH', 'BAD_ASSUMPTION', 'INSUFFICIENT_DATA',
  'TOOLING_ISSUE', 'COMMUNICATION', 'TIME_PRESSURE', 'COMPLEXITY_UNDERESTIMATE'
];

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

class GrowthMindset {
  constructor() { ensureDir(); }

  recordFailure(task, whatFailed, category, rootCause, opts) {
    opts = opts || {};
    if (!CATEGORIES.includes(category)) return { error: 'Invalid category. Valid: ' + CATEGORIES.join(', ') };

    const failures = readJSON(FAILURES_PATH, []);
    const entry = {
      id: uuid(),
      task: (task || '').slice(0, 500),
      whatFailed: (whatFailed || '').slice(0, 500),
      category,
      rootCause: (rootCause || '').slice(0, 500),
      principleViolated: opts.principleViolated || '',
      lessonLearned: opts.lessonLearned || '',
      assumption: opts.assumption || '',
      correctedAssumption: opts.correctedAssumption || '',
      domain: opts.domain || 'general',
      timestamp: Date.now(),
      applied: false
    };

    failures.push(entry);
    if (failures.length > 5000) failures.splice(0, failures.length - 5000);
    writeJSON(FAILURES_PATH, failures);

    // Track assumption if provided
    if (entry.assumption && entry.correctedAssumption) {
      const assumptions = readJSON(ASSUMPTIONS_PATH, []);
      assumptions.push({
        id: entry.id,
        assumption: entry.assumption,
        correctedAssumption: entry.correctedAssumption,
        domain: entry.domain,
        timestamp: entry.timestamp
      });
      writeJSON(ASSUMPTIONS_PATH, assumptions);
    }

    this._updateVelocity(entry.domain);
    return entry;
  }

  getLessons(domain) {
    const failures = readJSON(FAILURES_PATH, []);
    let filtered = failures.filter(f => f.lessonLearned);
    if (domain) filtered = filtered.filter(f => f.domain === domain);
    return filtered.map(f => ({
      id: f.id,
      task: f.task,
      lesson: f.lessonLearned,
      category: f.category,
      domain: f.domain,
      applied: f.applied,
      timestamp: f.timestamp
    }));
  }

  getAssumptions() {
    return readJSON(ASSUMPTIONS_PATH, []);
  }

  getLearningVelocity(domain) {
    const failures = readJSON(FAILURES_PATH, []);
    const domainFailures = failures.filter(f => !domain || f.domain === domain);
    if (domainFailures.length < 2) return { domain: domain || 'all', velocity: null, reason: 'Insufficient data' };

    // Group by week
    const weeks = {};
    for (const f of domainFailures) {
      const weekKey = new Date(f.timestamp).toISOString().slice(0, 10);
      weeks[weekKey] = (weeks[weekKey] || 0) + 1;
    }

    const sorted = Object.entries(weeks).sort((a, b) => a[0].localeCompare(b[0]));
    if (sorted.length < 2) return { domain: domain || 'all', velocity: 0, trend: 'stable', weeks: sorted };

    const firstHalf = sorted.slice(0, Math.ceil(sorted.length / 2));
    const secondHalf = sorted.slice(Math.ceil(sorted.length / 2));
    const avgFirst = firstHalf.reduce((s, [, c]) => s + c, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((s, [, c]) => s + c, 0) / secondHalf.length;

    const velocity = avgFirst > 0 ? Math.round(((avgFirst - avgSecond) / avgFirst) * 100) : 0;
    return {
      domain: domain || 'all',
      velocity,
      trend: velocity > 10 ? 'improving' : velocity < -10 ? 'declining' : 'stable',
      avgEarlyFailures: Math.round(avgFirst * 10) / 10,
      avgRecentFailures: Math.round(avgSecond * 10) / 10,
      totalFailures: domainFailures.length,
      weeks: sorted
    };
  }

  getFailurePatterns() {
    const failures = readJSON(FAILURES_PATH, []);
    const patterns = {};
    for (const f of failures) {
      patterns[f.category] = (patterns[f.category] || 0) + 1;
    }
    const sorted = Object.entries(patterns).sort((a, b) => b[1] - a[1]);
    const recurring = sorted.filter(([, c]) => c >= 3);
    return {
      distribution: Object.fromEntries(sorted),
      recurring: recurring.map(([cat, count]) => ({ category: cat, count, warning: count >= 5 ? 'Chronic pattern — needs systematic fix' : 'Recurring — monitor closely' })),
      total: failures.length
    };
  }

  getGrowthReport() {
    const failures = readJSON(FAILURES_PATH, []);
    const assumptions = readJSON(ASSUMPTIONS_PATH, []);
    const domains = this.getDomains();
    const patterns = this.getFailurePatterns();
    const applied = failures.filter(f => f.applied).length;
    const lessons = failures.filter(f => f.lessonLearned).length;

    return {
      totalFailures: failures.length,
      totalLessons: lessons,
      lessonsApplied: applied,
      assumptionsCorrected: assumptions.length,
      domains,
      patterns: patterns.recurring,
      improving: domains.filter(d => d.trend === 'improving'),
      stagnant: domains.filter(d => d.trend === 'stable' && d.totalFailures > 3),
      declining: domains.filter(d => d.trend === 'declining')
    };
  }

  checkAssumption(assumption) {
    const assumptions = readJSON(ASSUMPTIONS_PATH, []);
    const lower = (assumption || '').toLowerCase();
    const matches = assumptions.filter(a =>
      a.assumption.toLowerCase().includes(lower) || lower.includes(a.assumption.toLowerCase())
    );
    return {
      found: matches.length > 0,
      matches,
      warning: matches.length > 0 ? '⚠️ This assumption has been corrected before!' : '✅ No prior corrections found'
    };
  }

  getDomains() {
    const failures = readJSON(FAILURES_PATH, []);
    const domainMap = {};
    for (const f of failures) {
      if (!domainMap[f.domain]) domainMap[f.domain] = [];
      domainMap[f.domain].push(f);
    }
    return Object.entries(domainMap).map(([domain, items]) => {
      const vel = this.getLearningVelocity(domain);
      return {
        domain,
        totalFailures: items.length,
        velocity: vel.velocity,
        trend: vel.trend,
        lastFailure: items[items.length - 1].timestamp
      };
    }).sort((a, b) => b.totalFailures - a.totalFailures);
  }

  markApplied(id) {
    const failures = readJSON(FAILURES_PATH, []);
    const f = failures.find(x => x.id === id);
    if (!f) return { error: 'Not found' };
    f.applied = true;
    writeJSON(FAILURES_PATH, failures);
    return f;
  }

  _updateVelocity(domain) {
    const vel = readJSON(VELOCITY_PATH, {});
    if (!vel[domain]) vel[domain] = { dataPoints: [] };
    vel[domain].dataPoints.push(Date.now());
    if (vel[domain].dataPoints.length > 1000) vel[domain].dataPoints.splice(0, vel[domain].dataPoints.length - 1000);
    writeJSON(VELOCITY_PATH, vel);
  }
}

module.exports = GrowthMindset;
