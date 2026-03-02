/**
 * ARIES — Epistemic Debt Tracker
 * Track unverified assumptions as accumulating debt with interest.
 * When Aries operates on unverified info, that's epistemic debt.
 * Debt accrues interest over time. Cascade risk tracks what collapses if wrong.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

const DATA_DIR = path.join(__dirname, '..', 'data', 'cognitive-debt');
const DEBTS_PATH = path.join(DATA_DIR, 'epistemic-debts.json');
const HISTORY_PATH = path.join(DATA_DIR, 'epistemic-history.json');
const STATS_PATH = path.join(DATA_DIR, 'epistemic-stats.json');

const CATEGORIES = ['FACTUAL', 'INFERENTIAL', 'PREDICTIVE', 'STRUCTURAL', 'SOCIAL'];

const DEFAULT_CONFIG = {
  baseInterestRate: 0.02,         // per tick, base rate
  dependencyMultiplier: 0.01,     // extra rate per dependent
  ageMultiplier: 0.005,           // extra rate per day old
  volatilityRates: {              // category-specific volatility
    FACTUAL: 1.0,
    INFERENTIAL: 1.5,
    PREDICTIVE: 2.0,
    STRUCTURAL: 0.5,
    SOCIAL: 1.8,
  },
  bankruptcyThreshold: 100,       // total weighted debt triggers bankruptcy
  creditScoreMax: 850,
  creditScoreMin: 300,
  maxHistorySize: 5000,
};

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

class EpistemicDebtTracker extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null;
    this.config = Object.assign({}, DEFAULT_CONFIG, opts.config || {});
    ensureDir();
  }

  // ── Persistence ──────────────────────────────────────────────

  _getDebts() { return readJSON(DEBTS_PATH, []); }
  _saveDebts(debts) { writeJSON(DEBTS_PATH, debts); }
  _getHistory() { return readJSON(HISTORY_PATH, []); }
  _saveHistory(history) { writeJSON(HISTORY_PATH, history); }
  _getStats() { return readJSON(STATS_PATH, { totalRegistered: 0, totalVerified: 0, totalRefuted: 0, tickCount: 0 }); }
  _saveStats(stats) { writeJSON(STATS_PATH, stats); }

  // ── Core: Register Debt ──────────────────────────────────────

  registerDebt(claim, category, confidence, source, dependencies) {
    if (!claim) return { error: 'Claim is required' };
    if (!CATEGORIES.includes(category)) return { error: 'Invalid category. Valid: ' + CATEGORIES.join(', ') };
    confidence = Math.max(0, Math.min(1, confidence || 0.5));

    const debts = this._getDebts();
    const entry = {
      id: uuid(),
      claim: (claim || '').slice(0, 1000),
      category,
      confidence,
      source: (source || 'unknown').slice(0, 500),
      dependencies: Array.isArray(dependencies) ? dependencies : [],
      status: 'unverified',       // unverified | verified | refuted | cascadeRefuted
      interest: 0,
      createdAt: Date.now(),
      verifiedAt: null,
      evidence: null,
      dependents: [],              // populated by reverse-link
    };

    // Reverse-link: if this debt depends on others, register as dependent
    for (const depId of entry.dependencies) {
      const parent = debts.find(d => d.id === depId);
      if (parent && !parent.dependents.includes(entry.id)) {
        parent.dependents.push(entry.id);
      }
    }

    debts.push(entry);
    this._saveDebts(debts);

    const stats = this._getStats();
    stats.totalRegistered++;
    this._saveStats(stats);

    this.emit('debt:registered', entry);
    return entry;
  }

  // ── Interest Accumulation ────────────────────────────────────

  accrueInterest() {
    const debts = this._getDebts();
    const cfg = this.config;
    let changed = false;

    for (const debt of debts) {
      if (debt.status !== 'unverified') continue;

      const daysOld = (Date.now() - debt.createdAt) / (24 * 60 * 60 * 1000);
      const dependentCount = debt.dependents.length;
      const volatility = cfg.volatilityRates[debt.category] || 1.0;

      // Interest = base + dependency bonus + age bonus, scaled by volatility and inverse confidence
      const rate = (cfg.baseInterestRate + dependentCount * cfg.dependencyMultiplier + daysOld * cfg.ageMultiplier) * volatility * (1 - debt.confidence + 0.1);
      const prevInterest = debt.interest;
      debt.interest = Math.round((debt.interest + rate) * 1000) / 1000;

      if (debt.interest !== prevInterest) changed = true;
    }

    if (changed) this._saveDebts(debts);
    return { accrued: changed, activeDebts: debts.filter(d => d.status === 'unverified').length };
  }

  // ── Verification ─────────────────────────────────────────────

  verifyDebt(debtId, verified, evidence) {
    if (verified === false) return this.refuteDebt(debtId, evidence);

    const debts = this._getDebts();
    const debt = debts.find(d => d.id === debtId);
    if (!debt) return { error: 'Debt not found' };
    if (debt.status !== 'unverified') return { error: 'Debt already resolved: ' + debt.status };

    debt.status = 'verified';
    debt.verifiedAt = Date.now();
    debt.evidence = (evidence || '').slice(0, 1000);
    debt.interest = 0; // paid off

    this._saveDebts(debts);

    const stats = this._getStats();
    stats.totalVerified++;
    this._saveStats(stats);

    // Move to history
    this._archiveDebt(debt);

    this.emit('debt:verified', debt);
    return debt;
  }

  refuteDebt(debtId, evidence) {
    const debts = this._getDebts();
    const debt = debts.find(d => d.id === debtId);
    if (!debt) return { error: 'Debt not found' };
    if (debt.status !== 'unverified') return { error: 'Debt already resolved: ' + debt.status };

    debt.status = 'refuted';
    debt.verifiedAt = Date.now();
    debt.evidence = (evidence || '').slice(0, 1000);

    // Cascade: refute all dependents
    const cascaded = [];
    this._cascadeRefute(debts, debt.dependents, cascaded);

    this._saveDebts(debts);

    const stats = this._getStats();
    stats.totalRefuted++;
    this._saveStats(stats);

    this._archiveDebt(debt);
    for (const cid of cascaded) {
      const cd = debts.find(d => d.id === cid);
      if (cd) this._archiveDebt(cd);
    }

    this.emit('debt:refuted', { debt, cascaded });
    return { debt, cascadedCount: cascaded.length, cascaded };
  }

  _cascadeRefute(debts, dependentIds, cascaded) {
    for (const depId of dependentIds) {
      const dep = debts.find(d => d.id === depId);
      if (!dep || dep.status !== 'unverified') continue;
      dep.status = 'cascadeRefuted';
      dep.verifiedAt = Date.now();
      dep.evidence = 'Cascade refuted: dependency was refuted';
      cascaded.push(dep.id);
      this.emit('debt:cascadeRefuted', dep);
      // Recurse
      if (dep.dependents.length > 0) {
        this._cascadeRefute(debts, dep.dependents, cascaded);
      }
    }
  }

  _archiveDebt(debt) {
    const history = this._getHistory();
    history.push({ ...debt, archivedAt: Date.now() });
    if (history.length > this.config.maxHistorySize) {
      history.splice(0, history.length - this.config.maxHistorySize);
    }
    this._saveHistory(history);
  }

  // ── Cascade Risk ─────────────────────────────────────────────

  getCascadeRisk(debtId) {
    const debts = this._getDebts();
    const debt = debts.find(d => d.id === debtId);
    if (!debt) return { error: 'Debt not found' };

    const visited = new Set();
    const queue = [...debt.dependents];
    while (queue.length > 0) {
      const id = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);
      const dep = debts.find(d => d.id === id);
      if (dep && dep.dependents) {
        queue.push(...dep.dependents);
      }
    }

    const directDependents = debt.dependents.length;
    const totalCascade = visited.size;
    // Contagion score: direct × 2 + transitive, weighted by interest
    const contagionScore = Math.round((directDependents * 2 + totalCascade) * (1 + debt.interest) * 10) / 10;

    return {
      debtId,
      claim: debt.claim.slice(0, 100),
      directDependents,
      totalCascade,
      contagionScore,
      affectedIds: [...visited],
    };
  }

  // ── Payment Queue ────────────────────────────────────────────

  getPaymentQueue(n) {
    n = n || 10;
    const debts = this._getDebts().filter(d => d.status === 'unverified');

    // Score each: interest × cascade risk
    const scored = debts.map(d => {
      const cascade = this.getCascadeRisk(d.id);
      const priority = Math.round((d.interest + 1) * (cascade.contagionScore + 1) * 100) / 100;
      return {
        id: d.id,
        claim: d.claim.slice(0, 200),
        category: d.category,
        confidence: d.confidence,
        interest: d.interest,
        contagionScore: cascade.contagionScore,
        priority,
        daysOld: Math.round((Date.now() - d.createdAt) / (24 * 60 * 60 * 1000) * 10) / 10,
      };
    });

    scored.sort((a, b) => b.priority - a.priority);
    return scored.slice(0, n);
  }

  // ── Credit Score ─────────────────────────────────────────────

  getCreditScore() {
    const debts = this._getDebts();
    const stats = this._getStats();
    const cfg = this.config;

    const unverified = debts.filter(d => d.status === 'unverified');
    const totalInterest = unverified.reduce((s, d) => s + d.interest, 0);
    const totalActive = unverified.length;

    // Base score from verification ratio
    const totalResolved = stats.totalVerified + stats.totalRefuted;
    const verifiedRatio = totalResolved > 0 ? stats.totalVerified / totalResolved : 1;

    // Penalties
    const interestPenalty = Math.min(totalInterest * 2, 300);
    const volumePenalty = Math.min(totalActive * 5, 200);
    const refutedPenalty = Math.min(stats.totalRefuted * 10, 150);

    let score = Math.round(cfg.creditScoreMax * verifiedRatio - interestPenalty - volumePenalty - refutedPenalty);
    score = Math.max(cfg.creditScoreMin, Math.min(cfg.creditScoreMax, score));

    let grade;
    if (score >= 750) grade = 'EXCELLENT';
    else if (score >= 650) grade = 'GOOD';
    else if (score >= 550) grade = 'FAIR';
    else if (score >= 450) grade = 'POOR';
    else grade = 'CRITICAL';

    return {
      score,
      grade,
      verifiedRatio: Math.round(verifiedRatio * 100),
      activeDebts: totalActive,
      totalInterest: Math.round(totalInterest * 100) / 100,
      totalVerified: stats.totalVerified,
      totalRefuted: stats.totalRefuted,
    };
  }

  // ── Bankruptcy Detection ─────────────────────────────────────

  isBankrupt() {
    const debts = this._getDebts().filter(d => d.status === 'unverified');
    const totalWeighted = debts.reduce((s, d) => s + d.interest + (1 - d.confidence), 0);
    const threshold = this.config.bankruptcyThreshold;
    return {
      bankrupt: totalWeighted >= threshold,
      totalWeightedDebt: Math.round(totalWeighted * 100) / 100,
      threshold,
      headroom: Math.round((threshold - totalWeighted) * 100) / 100,
    };
  }

  // ── Category Breakdown ───────────────────────────────────────

  getDebtByCategory() {
    const debts = this._getDebts().filter(d => d.status === 'unverified');
    const result = {};
    for (const cat of CATEGORIES) {
      const catDebts = debts.filter(d => d.category === cat);
      result[cat] = {
        count: catDebts.length,
        totalInterest: Math.round(catDebts.reduce((s, d) => s + d.interest, 0) * 100) / 100,
        avgConfidence: catDebts.length > 0
          ? Math.round(catDebts.reduce((s, d) => s + d.confidence, 0) / catDebts.length * 100) / 100
          : null,
      };
    }
    return result;
  }

  // ── Tick ──────────────────────────────────────────────────────

  tick() {
    const accrual = this.accrueInterest();
    const bankruptcy = this.isBankrupt();
    const credit = this.getCreditScore();

    const stats = this._getStats();
    stats.tickCount++;
    this._saveStats(stats);

    if (bankruptcy.bankrupt) {
      this.emit('bankruptcy', bankruptcy);
    }

    if (credit.grade === 'CRITICAL') {
      this.emit('credit:critical', credit);
    } else if (credit.grade === 'POOR') {
      this.emit('credit:poor', credit);
    }

    return { accrual, bankruptcy, credit };
  }

  // ── Queries ──────────────────────────────────────────────────

  getDebt(debtId) {
    const debts = this._getDebts();
    return debts.find(d => d.id === debtId) || { error: 'Not found' };
  }

  getActiveDebts() {
    return this._getDebts()
      .filter(d => d.status === 'unverified')
      .sort((a, b) => b.interest - a.interest);
  }

  getHistory(limit) {
    const history = this._getHistory();
    return history.slice(-(limit || 50)).reverse();
  }

  getReport() {
    const debts = this._getDebts();
    const active = debts.filter(d => d.status === 'unverified');
    const credit = this.getCreditScore();
    const bankruptcy = this.isBankrupt();
    const byCategory = this.getDebtByCategory();
    const topQueue = this.getPaymentQueue(5);

    return {
      credit,
      bankruptcy,
      activeDebts: active.length,
      totalInterest: Math.round(active.reduce((s, d) => s + d.interest, 0) * 100) / 100,
      byCategory,
      topPriority: topQueue,
      oldestDebt: active.sort((a, b) => a.createdAt - b.createdAt)[0] || null,
    };
  }

  // ── Auto-Detection ───────────────────────────────────────────

  autoDetect(text) {
    const lower = (text || '').toLowerCase();
    const detected = [];

    const patterns = [
      { words: ['i assume', 'assuming', 'i believe', 'presumably', 'probably'], category: 'FACTUAL', confidence: 0.4 },
      { words: ['therefore', 'so it must', 'which means', 'implies that', 'suggests'], category: 'INFERENTIAL', confidence: 0.5 },
      { words: ['will likely', 'should be', 'expect', 'predict', 'forecast'], category: 'PREDICTIVE', confidence: 0.3 },
      { words: ['the architecture', 'the system', 'designed to', 'built for', 'scales to'], category: 'STRUCTURAL', confidence: 0.6 },
      { words: ['you probably want', 'users prefer', 'people usually', 'you like', 'most people'], category: 'SOCIAL', confidence: 0.4 },
    ];

    for (const p of patterns) {
      for (const word of p.words) {
        if (lower.includes(word)) {
          detected.push({
            trigger: word,
            category: p.category,
            suggestedConfidence: p.confidence,
            claim: text.slice(0, 200),
          });
          break;
        }
      }
    }

    return detected;
  }
}

module.exports = EpistemicDebtTracker;
