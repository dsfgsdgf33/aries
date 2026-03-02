/**
 * ARIES — Epistemic Debt Tracker
 * Track unverified assumptions as accumulating debt with compound interest.
 * Debt accrues interest over time. Cascade risk tracks what collapses if wrong.
 * 
 * Features: 5 debt categories, compound interest, dependency chains, credit score
 * (300-850), bankruptcy detection, payment plans, audit system, debt-to-knowledge ratio.
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
const PLANS_PATH = path.join(DATA_DIR, 'payment-plans.json');
const AUDIT_PATH = path.join(DATA_DIR, 'audit-log.json');

const CATEGORIES = {
  EMPIRICAL: 'empirical',       // Claims about the world that need evidence
  LOGICAL: 'logical',           // Deductions that need proof-checking
  SOCIAL: 'social',             // Assumptions about people/preferences
  TEMPORAL: 'temporal',         // Assumptions about timing/sequences
  METHODOLOGICAL: 'methodological', // Assumptions about approaches/tools
};
const CATEGORY_LIST = Object.values(CATEGORIES);

// Risk tiers determine interest rate multiplier
const RISK_TIERS = {
  low: { multiplier: 0.5, label: 'Low risk — easy to verify' },
  moderate: { multiplier: 1.0, label: 'Moderate risk — needs investigation' },
  high: { multiplier: 2.0, label: 'High risk — hard to verify, high impact' },
  critical: { multiplier: 4.0, label: 'Critical — foundational assumption' },
};

const DEFAULT_CONFIG = {
  baseInterestRate: 0.02,
  compoundingInterval: 1,        // compound every tick
  dependencyMultiplier: 0.01,
  ageMultiplier: 0.005,
  categoryVolatility: {
    [CATEGORIES.EMPIRICAL]: 1.0,
    [CATEGORIES.LOGICAL]: 0.7,
    [CATEGORIES.SOCIAL]: 1.8,
    [CATEGORIES.TEMPORAL]: 2.0,
    [CATEGORIES.METHODOLOGICAL]: 1.2,
  },
  bankruptcyThreshold: 100,
  creditScoreMax: 850,
  creditScoreMin: 300,
  maxHistorySize: 5000,
  auditInterval: 10,             // run audit every 10 ticks
  maxAuditItems: 10,
  knowledgeBaseSize: 100,        // estimated verified knowledge items for ratio
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
  _getStats() {
    return readJSON(STATS_PATH, {
      totalRegistered: 0, totalVerified: 0, totalRefuted: 0,
      tickCount: 0, lastAuditAt: null, auditCount: 0,
    });
  }
  _saveStats(stats) { writeJSON(STATS_PATH, stats); }
  _getPlans() { return readJSON(PLANS_PATH, []); }
  _savePlans(plans) { writeJSON(PLANS_PATH, plans); }
  _getAuditLog() { return readJSON(AUDIT_PATH, []); }
  _saveAuditLog(log) { writeJSON(AUDIT_PATH, log); }

  // ── Core: Register Debt ──────────────────────────────────────

  registerDebt(claim, category, confidence, source, dependencies, opts = {}) {
    if (!claim) return { error: 'Claim is required' };
    if (!CATEGORY_LIST.includes(category)) {
      return { error: 'Invalid category. Valid: ' + CATEGORY_LIST.join(', ') };
    }
    confidence = Math.max(0, Math.min(1, confidence || 0.5));

    const riskTier = opts.riskTier || this._assessRisk(category, confidence, dependencies);

    const debts = this._getDebts();
    const entry = {
      id: uuid(),
      claim: (claim || '').slice(0, 1000),
      category,
      confidence,
      source: (source || 'unknown').slice(0, 500),
      dependencies: Array.isArray(dependencies) ? dependencies : [],
      dependents: [],
      status: 'unverified',
      interest: 0,
      principalDebt: 1 - confidence,  // initial debt = uncertainty
      riskTier,
      riskMultiplier: RISK_TIERS[riskTier]?.multiplier || 1.0,
      createdAt: Date.now(),
      verifiedAt: null,
      evidence: null,
      lastInterestAt: Date.now(),
      compoundCycles: 0,
    };

    // Reverse-link dependencies
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

  /**
   * Assess risk tier automatically based on category, confidence, and dependency count.
   */
  _assessRisk(category, confidence, dependencies) {
    const deps = Array.isArray(dependencies) ? dependencies.length : 0;
    let riskScore = 0;

    // Low confidence = higher risk
    if (confidence < 0.3) riskScore += 3;
    else if (confidence < 0.5) riskScore += 2;
    else if (confidence < 0.7) riskScore += 1;

    // Many dependencies = higher risk (foundational)
    riskScore += Math.min(deps * 0.5, 2);

    // Category risk
    const catRisk = { temporal: 1.5, social: 1.2, methodological: 0.8, empirical: 1.0, logical: 0.6 };
    riskScore *= catRisk[category] || 1.0;

    if (riskScore >= 4) return 'critical';
    if (riskScore >= 2.5) return 'high';
    if (riskScore >= 1) return 'moderate';
    return 'low';
  }

  // ── Compound Interest ────────────────────────────────────────

  accrueInterest() {
    const debts = this._getDebts();
    const cfg = this.config;
    let changed = false;

    for (const debt of debts) {
      if (debt.status !== 'unverified') continue;

      const daysOld = (Date.now() - debt.createdAt) / (24 * 60 * 60 * 1000);
      const dependentCount = debt.dependents.length;
      const volatility = cfg.categoryVolatility[debt.category] || 1.0;
      const riskMult = debt.riskMultiplier || 1.0;

      // Compound interest: interest = principal × (1 + rate)^n - principal
      const rate = (cfg.baseInterestRate + dependentCount * cfg.dependencyMultiplier + daysOld * cfg.ageMultiplier)
        * volatility * riskMult * (1 - debt.confidence + 0.1);

      const prevInterest = debt.interest;
      // Compound: add interest on (principal + existing interest)
      const base = (debt.principalDebt || (1 - debt.confidence)) + debt.interest;
      debt.interest = Math.round((debt.interest + base * rate) * 1000) / 1000;
      debt.compoundCycles = (debt.compoundCycles || 0) + 1;
      debt.lastInterestAt = Date.now();

      if (debt.interest !== prevInterest) changed = true;
    }

    if (changed) this._saveDebts(debts);
    return { accrued: changed, activeDebts: debts.filter(d => d.status === 'unverified').length };
  }

  // ── Verification & Refutation ────────────────────────────────

  verifyDebt(debtId, verified, evidence) {
    if (verified === false) return this.refuteDebt(debtId, evidence);

    const debts = this._getDebts();
    const debt = debts.find(d => d.id === debtId);
    if (!debt) return { error: 'Debt not found' };
    if (debt.status !== 'unverified') return { error: 'Debt already resolved: ' + debt.status };

    debt.status = 'verified';
    debt.verifiedAt = Date.now();
    debt.evidence = (evidence || '').slice(0, 1000);
    const interestPaid = debt.interest;
    debt.interest = 0;

    this._saveDebts(debts);

    const stats = this._getStats();
    stats.totalVerified++;
    this._saveStats(stats);

    this._archiveDebt(debt);

    // Check if this resolves a payment plan item
    this._resolvePaymentPlanItem(debtId);

    this.emit('debt:verified', { debt, interestPaid });
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
      if (dep.dependents.length > 0) this._cascadeRefute(debts, dep.dependents, cascaded);
    }
  }

  _archiveDebt(debt) {
    const history = this._getHistory();
    history.push({ ...debt, archivedAt: Date.now() });
    if (history.length > this.config.maxHistorySize) history.splice(0, history.length - this.config.maxHistorySize);
    this._saveHistory(history);
  }

  // ── Cascade Risk ─────────────────────────────────────────────

  getCascadeRisk(debtId) {
    const debts = this._getDebts();
    const debt = debts.find(d => d.id === debtId);
    if (!debt) return { error: 'Debt not found' };

    const visited = new Set();
    const queue = [...debt.dependents];
    let totalInterestAtRisk = 0;
    while (queue.length > 0) {
      const id = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);
      const dep = debts.find(d => d.id === id);
      if (dep) {
        totalInterestAtRisk += dep.interest;
        if (dep.dependents) queue.push(...dep.dependents);
      }
    }

    const contagionScore = Math.round((debt.dependents.length * 2 + visited.size) * (1 + debt.interest) * 10) / 10;

    return {
      debtId,
      claim: debt.claim.slice(0, 100),
      directDependents: debt.dependents.length,
      totalCascade: visited.size,
      totalInterestAtRisk: Math.round(totalInterestAtRisk * 100) / 100,
      contagionScore,
      affectedIds: [...visited],
    };
  }

  /**
   * Get the full dependency chain for a debt (both up and down).
   */
  getDependencyChain(debtId) {
    const debts = this._getDebts();
    const debt = debts.find(d => d.id === debtId);
    if (!debt) return { error: 'Debt not found' };

    // Trace upstream (what this depends on)
    const upstream = [];
    const traceUp = (ids, depth = 0) => {
      for (const id of ids) {
        const d = debts.find(x => x.id === id);
        if (d && !upstream.find(u => u.id === id)) {
          upstream.push({ id, claim: d.claim.slice(0, 100), status: d.status, depth });
          if (d.dependencies.length > 0) traceUp(d.dependencies, depth + 1);
        }
      }
    };
    traceUp(debt.dependencies);

    // Trace downstream (what depends on this)
    const downstream = [];
    const traceDown = (ids, depth = 0) => {
      for (const id of ids) {
        const d = debts.find(x => x.id === id);
        if (d && !downstream.find(u => u.id === id)) {
          downstream.push({ id, claim: d.claim.slice(0, 100), status: d.status, depth });
          if (d.dependents.length > 0) traceDown(d.dependents, depth + 1);
        }
      }
    };
    traceDown(debt.dependents);

    return {
      debtId,
      claim: debt.claim.slice(0, 200),
      upstream,
      downstream,
      chainDepth: Math.max(upstream.length > 0 ? Math.max(...upstream.map(u => u.depth)) + 1 : 0,
                           downstream.length > 0 ? Math.max(...downstream.map(d => d.depth)) + 1 : 0),
    };
  }

  // ── Payment Plans ────────────────────────────────────────────

  /**
   * Create a payment plan — schedule verification of specific debts.
   */
  createPaymentPlan(name, debtIds, dueByMs) {
    const debts = this._getDebts();
    const validIds = debtIds.filter(id => debts.find(d => d.id === id && d.status === 'unverified'));
    if (validIds.length === 0) return { error: 'No valid unverified debts' };

    const plans = this._getPlans();
    const plan = {
      id: uuid(),
      name: (name || 'Unnamed plan').slice(0, 200),
      debtIds: validIds,
      createdAt: Date.now(),
      dueBy: Date.now() + (dueByMs || 7 * 24 * 3600 * 1000),
      status: 'active',  // active, completed, overdue, cancelled
      resolvedIds: [],
      progress: 0,
    };
    plans.push(plan);
    this._savePlans(plans);
    this.emit('plan:created', plan);
    return plan;
  }

  /**
   * Auto-generate a payment plan from highest-priority debts.
   */
  autoPaymentPlan(n = 5, dueByMs) {
    const queue = this.getPaymentQueue(n);
    if (queue.length === 0) return { error: 'No debts to plan' };
    return this.createPaymentPlan(
      `Auto-plan (${new Date().toISOString().split('T')[0]})`,
      queue.map(q => q.id),
      dueByMs || 7 * 24 * 3600 * 1000
    );
  }

  _resolvePaymentPlanItem(debtId) {
    const plans = this._getPlans();
    let changed = false;
    for (const plan of plans) {
      if (plan.status !== 'active') continue;
      if (plan.debtIds.includes(debtId) && !plan.resolvedIds.includes(debtId)) {
        plan.resolvedIds.push(debtId);
        plan.progress = Math.round(plan.resolvedIds.length / plan.debtIds.length * 100);
        if (plan.resolvedIds.length >= plan.debtIds.length) {
          plan.status = 'completed';
          plan.completedAt = Date.now();
          this.emit('plan:completed', plan);
        }
        changed = true;
      }
    }
    if (changed) this._savePlans(plans);
  }

  getPaymentPlans(status) {
    let plans = this._getPlans();
    if (status) plans = plans.filter(p => p.status === status);
    return plans;
  }

  // ── Payment Queue ────────────────────────────────────────────

  getPaymentQueue(n) {
    n = n || 10;
    const debts = this._getDebts().filter(d => d.status === 'unverified');

    const scored = debts.map(d => {
      const cascade = this.getCascadeRisk(d.id);
      const priority = Math.round((d.interest + 1) * (cascade.contagionScore + 1) * (d.riskMultiplier || 1) * 100) / 100;
      return {
        id: d.id,
        claim: d.claim.slice(0, 200),
        category: d.category,
        confidence: d.confidence,
        interest: d.interest,
        riskTier: d.riskTier,
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

    const totalResolved = stats.totalVerified + stats.totalRefuted;
    const verifiedRatio = totalResolved > 0 ? stats.totalVerified / totalResolved : 1;

    // Count critical/high risk debts — extra penalty
    const highRiskCount = unverified.filter(d => d.riskTier === 'critical' || d.riskTier === 'high').length;

    const interestPenalty = Math.min(totalInterest * 2, 300);
    const volumePenalty = Math.min(totalActive * 5, 200);
    const refutedPenalty = Math.min(stats.totalRefuted * 10, 150);
    const highRiskPenalty = Math.min(highRiskCount * 15, 100);

    let score = Math.round(cfg.creditScoreMax * verifiedRatio - interestPenalty - volumePenalty - refutedPenalty - highRiskPenalty);
    score = Math.max(cfg.creditScoreMin, Math.min(cfg.creditScoreMax, score));

    let grade;
    if (score >= 750) grade = 'EXCELLENT';
    else if (score >= 650) grade = 'GOOD';
    else if (score >= 550) grade = 'FAIR';
    else if (score >= 450) grade = 'POOR';
    else grade = 'CRITICAL';

    return {
      score, grade,
      verifiedRatio: Math.round(verifiedRatio * 100),
      activeDebts: totalActive,
      totalInterest: Math.round(totalInterest * 100) / 100,
      highRiskDebts: highRiskCount,
      totalVerified: stats.totalVerified,
      totalRefuted: stats.totalRefuted,
    };
  }

  // ── Bankruptcy ───────────────────────────────────────────────

  isBankrupt() {
    const debts = this._getDebts().filter(d => d.status === 'unverified');
    const totalWeighted = debts.reduce((s, d) => s + d.interest + (d.principalDebt || (1 - d.confidence)), 0);
    const threshold = this.config.bankruptcyThreshold;
    return {
      bankrupt: totalWeighted >= threshold,
      totalWeightedDebt: Math.round(totalWeighted * 100) / 100,
      threshold,
      headroom: Math.round((threshold - totalWeighted) * 100) / 100,
    };
  }

  // ── Debt-to-Knowledge Ratio ──────────────────────────────────

  getDebtToKnowledgeRatio() {
    const debts = this._getDebts().filter(d => d.status === 'unverified');
    const stats = this._getStats();
    const verifiedKnowledge = stats.totalVerified + this.config.knowledgeBaseSize;
    const totalDebt = debts.reduce((s, d) => s + d.interest + (d.principalDebt || (1 - d.confidence)), 0);
    const ratio = verifiedKnowledge > 0 ? totalDebt / verifiedKnowledge : totalDebt;

    let health;
    if (ratio < 0.2) health = 'excellent';
    else if (ratio < 0.5) health = 'good';
    else if (ratio < 1.0) health = 'concerning';
    else if (ratio < 2.0) health = 'dangerous';
    else health = 'critical';

    return {
      debtToKnowledgeRatio: Math.round(ratio * 1000) / 1000,
      totalDebt: Math.round(totalDebt * 100) / 100,
      verifiedKnowledge,
      activeDebts: debts.length,
      health,
    };
  }

  // ── Category Breakdown ───────────────────────────────────────

  getDebtByCategory() {
    const debts = this._getDebts().filter(d => d.status === 'unverified');
    const result = {};
    for (const cat of CATEGORY_LIST) {
      const catDebts = debts.filter(d => d.category === cat);
      result[cat] = {
        count: catDebts.length,
        totalInterest: Math.round(catDebts.reduce((s, d) => s + d.interest, 0) * 100) / 100,
        avgConfidence: catDebts.length > 0
          ? Math.round(catDebts.reduce((s, d) => s + d.confidence, 0) / catDebts.length * 100) / 100 : null,
        riskDistribution: {
          low: catDebts.filter(d => d.riskTier === 'low').length,
          moderate: catDebts.filter(d => d.riskTier === 'moderate').length,
          high: catDebts.filter(d => d.riskTier === 'high').length,
          critical: catDebts.filter(d => d.riskTier === 'critical').length,
        },
      };
    }
    return result;
  }

  // ── Audit System ─────────────────────────────────────────────

  /**
   * Run an audit — review highest-debt items and flag issues.
   */
  async runAudit() {
    const debts = this._getDebts().filter(d => d.status === 'unverified');
    if (debts.length === 0) return { auditItems: [], issues: [] };

    // Sort by total cost (interest + principal × risk)
    const sorted = debts.map(d => ({
      ...d,
      totalCost: d.interest + (d.principalDebt || (1 - d.confidence)) * (d.riskMultiplier || 1),
    })).sort((a, b) => b.totalCost - a.totalCost);

    const topItems = sorted.slice(0, this.config.maxAuditItems);
    const issues = [];

    // Flag overdue payment plan items
    const plans = this._getPlans().filter(p => p.status === 'active');
    for (const plan of plans) {
      if (Date.now() > plan.dueBy) {
        plan.status = 'overdue';
        issues.push({ type: 'overdue-plan', planId: plan.id, name: plan.name });
        this.emit('plan:overdue', plan);
      }
    }
    this._savePlans(plans);

    // Flag very old debts (>30 days)
    for (const d of debts) {
      const age = (Date.now() - d.createdAt) / (24 * 3600 * 1000);
      if (age > 30 && d.interest > 5) {
        issues.push({ type: 'stale-high-interest', debtId: d.id, claim: d.claim.slice(0, 100), age: Math.round(age), interest: d.interest });
      }
    }

    // Flag debts with many dependents
    for (const d of debts) {
      if (d.dependents.length >= 3) {
        issues.push({ type: 'high-dependency', debtId: d.id, claim: d.claim.slice(0, 100), dependents: d.dependents.length });
      }
    }

    const auditEntry = {
      at: Date.now(),
      topItems: topItems.map(d => ({ id: d.id, claim: d.claim.slice(0, 100), totalCost: Math.round(d.totalCost * 100) / 100 })),
      issueCount: issues.length,
      issues,
    };

    const auditLog = this._getAuditLog();
    auditLog.push(auditEntry);
    if (auditLog.length > 100) auditLog.splice(0, auditLog.length - 100);
    this._saveAuditLog(auditLog);

    const stats = this._getStats();
    stats.lastAuditAt = Date.now();
    stats.auditCount = (stats.auditCount || 0) + 1;
    this._saveStats(stats);

    this.emit('audit:complete', auditEntry);
    return auditEntry;
  }

  // ── Tick ──────────────────────────────────────────────────────

  async tick() {
    const accrual = this.accrueInterest();
    const bankruptcy = this.isBankrupt();
    const credit = this.getCreditScore();

    const stats = this._getStats();
    stats.tickCount++;
    this._saveStats(stats);

    // Run audit periodically
    let audit = null;
    if (stats.tickCount % this.config.auditInterval === 0) {
      audit = await this.runAudit();
    }

    if (bankruptcy.bankrupt) this.emit('bankruptcy', bankruptcy);
    if (credit.grade === 'CRITICAL') this.emit('credit:critical', credit);
    else if (credit.grade === 'POOR') this.emit('credit:poor', credit);

    return { accrual, bankruptcy, credit, audit };
  }

  // ── Queries ──────────────────────────────────────────────────

  getDebt(debtId) {
    return this._getDebts().find(d => d.id === debtId) || { error: 'Not found' };
  }

  getActiveDebts() {
    return this._getDebts().filter(d => d.status === 'unverified').sort((a, b) => b.interest - a.interest);
  }

  getHistory(limit) {
    return this._getHistory().slice(-(limit || 50)).reverse();
  }

  getReport() {
    const debts = this._getDebts();
    const active = debts.filter(d => d.status === 'unverified');
    const credit = this.getCreditScore();
    const bankruptcy = this.isBankrupt();
    const byCategory = this.getDebtByCategory();
    const topQueue = this.getPaymentQueue(5);
    const dtkRatio = this.getDebtToKnowledgeRatio();
    const plans = this.getPaymentPlans('active');

    return {
      credit,
      bankruptcy,
      debtToKnowledgeRatio: dtkRatio,
      activeDebts: active.length,
      totalInterest: Math.round(active.reduce((s, d) => s + d.interest, 0) * 100) / 100,
      byCategory,
      topPriority: topQueue,
      activePlans: plans.length,
      oldestDebt: active.sort((a, b) => a.createdAt - b.createdAt)[0] || null,
    };
  }

  // ── Auto-Detection ───────────────────────────────────────────

  autoDetect(text) {
    const lower = (text || '').toLowerCase();
    const detected = [];

    const patterns = [
      { words: ['i assume', 'assuming', 'i believe', 'presumably', 'probably'], category: CATEGORIES.EMPIRICAL, confidence: 0.4 },
      { words: ['therefore', 'so it must', 'which means', 'implies that', 'suggests'], category: CATEGORIES.LOGICAL, confidence: 0.5 },
      { words: ['will likely', 'should be', 'expect', 'predict', 'forecast'], category: CATEGORIES.TEMPORAL, confidence: 0.3 },
      { words: ['the architecture', 'the system', 'designed to', 'built for', 'the approach'], category: CATEGORIES.METHODOLOGICAL, confidence: 0.6 },
      { words: ['you probably want', 'users prefer', 'people usually', 'you like', 'most people'], category: CATEGORIES.SOCIAL, confidence: 0.4 },
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

EpistemicDebtTracker.CATEGORIES = CATEGORIES;
EpistemicDebtTracker.RISK_TIERS = RISK_TIERS;
module.exports = EpistemicDebtTracker;
