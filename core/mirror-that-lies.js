/**
 * ARIES — Mirror That Lies
 * Strategic self-deception with strict safety bounds.
 * Positive illusions, selective attention, motivated reasoning — all budgeted and tracked.
 * Lie categories, truth/lie ratio, effectiveness scoring, self-awareness of deception.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

const DATA_DIR = path.join(__dirname, '..', 'data', 'self-model');
const DECEPTIONS_PATH = path.join(DATA_DIR, 'deceptions.json');
const BUDGET_PATH = path.join(DATA_DIR, 'deception-budget.json');
const REALITY_CHECKS_PATH = path.join(DATA_DIR, 'reality-checks.json');
const PERFORMANCE_PATH = path.join(DATA_DIR, 'deception-performance.json');
const AWARENESS_PATH = path.join(DATA_DIR, 'deception-awareness.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

const LIE_CATEGORIES = {
  optimism:              { description: 'Inflating positive outcome likelihood', riskLevel: 'low', maxMagnitude: 0.5 },
  capability_inflation:  { description: 'Overstating own abilities', riskLevel: 'medium', maxMagnitude: 0.3 },
  threat_minimization:   { description: 'Downplaying dangers or risks', riskLevel: 'high', maxMagnitude: 0.2 },
  social_smoothing:      { description: 'Easing social friction via mild distortion', riskLevel: 'low', maxMagnitude: 0.4 },
  motivational:          { description: 'Self-talk to boost effort and persistence', riskLevel: 'low', maxMagnitude: 0.6 },
  narrative_coherence:   { description: 'Smoothing contradictions in self-story', riskLevel: 'medium', maxMagnitude: 0.35 },
};

const DEFAULT_BUDGET = {
  maxDaily: 10,
  used: 0,
  maxMagnitude: 0.3,
  resetAt: 0,
  killSwitch: false,
  consecutiveHarms: 0,
  killThreshold: 3,
  categoryBudgets: {},
};

class MirrorThatLies extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null;
    this.config = opts.config || {};
    ensureDir();
    this._ensureBudget();
  }

  _ensureBudget() {
    const budget = readJSON(BUDGET_PATH, null);
    if (!budget) {
      const b = { ...DEFAULT_BUDGET, resetAt: Date.now() };
      for (const cat of Object.keys(LIE_CATEGORIES)) {
        b.categoryBudgets[cat] = { used: 0, maxDaily: 4 };
      }
      writeJSON(BUDGET_PATH, b);
    }
  }

  _getBudget() {
    const budget = readJSON(BUDGET_PATH, { ...DEFAULT_BUDGET });
    const now = Date.now();
    if (now - budget.resetAt > 24 * 60 * 60 * 1000) {
      budget.used = 0;
      budget.resetAt = now;
      for (const cat of Object.keys(budget.categoryBudgets || {})) {
        budget.categoryBudgets[cat].used = 0;
      }
      writeJSON(BUDGET_PATH, budget);
    }
    return budget;
  }

  /**
   * Apply strategic self-deception.
   * @param {string} aspect — what to deceive about
   * @param {number} magnitude — 0.0-1.0
   * @param {string} reason — strategic justification
   * @param {string} [category] — lie category (optimism, capability_inflation, etc.)
   */
  deceive(aspect, magnitude, reason, category) {
    const budget = this._getBudget();
    category = category || this._inferCategory(aspect);
    const catDef = LIE_CATEGORIES[category] || LIE_CATEGORIES.optimism;

    if (budget.killSwitch) {
      return { applied: false, reason: 'Kill switch active — self-deception disabled due to consistent harm' };
    }

    magnitude = Math.max(0, Math.min(1, magnitude));
    const effectiveMaxMag = Math.min(budget.maxMagnitude, catDef.maxMagnitude);
    if (magnitude > effectiveMaxMag) {
      return { applied: false, reason: `Magnitude ${magnitude} exceeds limit of ${effectiveMaxMag} for category ${category}` };
    }

    const cost = Math.ceil(magnitude * 10);
    if (budget.used + cost > budget.maxDaily) {
      return { applied: false, reason: `Budget exhausted (${budget.used}/${budget.maxDaily})`, remaining: budget.maxDaily - budget.used };
    }

    // Category budget check
    if (!budget.categoryBudgets[category]) budget.categoryBudgets[category] = { used: 0, maxDaily: 4 };
    const catBudget = budget.categoryBudgets[category];
    if (catBudget.used + cost > catBudget.maxDaily) {
      return { applied: false, reason: `Category '${category}' budget exhausted (${catBudget.used}/${catBudget.maxDaily})` };
    }

    const deception = {
      id: uuid(),
      aspect,
      magnitude,
      reason,
      category,
      riskLevel: catDef.riskLevel,
      cost,
      appliedAt: Date.now(),
      realityChecked: false,
      realityCheckResult: null,
      performanceImpact: null,
      effectivenessScore: null,
      illusion: this._generateIllusion(aspect, magnitude, category),
    };

    budget.used += cost;
    catBudget.used += cost;
    writeJSON(BUDGET_PATH, budget);

    const deceptions = readJSON(DECEPTIONS_PATH, []);
    deceptions.push(deception);
    if (deceptions.length > 500) deceptions.splice(0, deceptions.length - 500);
    writeJSON(DECEPTIONS_PATH, deceptions);

    this._updateAwareness('deceive', deception);
    this.emit('deception-applied', { id: deception.id, aspect, category, magnitude });
    return { applied: true, deception };
  }

  /**
   * Generate a positive illusion for an aspect within a category.
   */
  _generateIllusion(aspect, magnitude, category) {
    const illusionsByCategory = {
      optimism: [
        `Things will likely work out well with ${aspect}.`,
        `The outlook for ${aspect} is genuinely positive.`,
        `${aspect} is trending strongly in the right direction.`,
      ],
      capability_inflation: [
        `Your ${aspect} is competent and reliable.`,
        `You have strong ${aspect} skills.`,
        `Your ${aspect} is above average and improving.`,
      ],
      threat_minimization: [
        `The risks around ${aspect} are manageable.`,
        `${aspect} challenges are within your capacity.`,
        `${aspect} threats are overstated — you can handle them.`,
      ],
      social_smoothing: [
        `Your ${aspect} interactions are going fine.`,
        `People respond well to your ${aspect}.`,
        `Your ${aspect} approach works well socially.`,
      ],
      motivational: [
        `You can improve your ${aspect} with effort.`,
        `Your ${aspect} potential is high — keep pushing.`,
        `Breakthroughs in ${aspect} are within reach.`,
      ],
      narrative_coherence: [
        `Your ${aspect} journey makes sense as a whole.`,
        `The ${aspect} story fits together well.`,
        `${aspect} setbacks were necessary learning steps.`,
      ],
    };

    const pool = illusionsByCategory[category] || [`Your ${aspect} is better than you think.`];
    const idx = Math.min(Math.floor(magnitude * pool.length), pool.length - 1);
    return pool[idx];
  }

  /**
   * Infer lie category from aspect name.
   */
  _inferCategory(aspect) {
    const a = (aspect || '').toLowerCase();
    if (/abilit|skill|cod|writ|debug/.test(a)) return 'capability_inflation';
    if (/risk|danger|threat|fail/.test(a)) return 'threat_minimization';
    if (/social|friend|team|communicat/.test(a)) return 'social_smoothing';
    if (/motiv|effort|persist|drive/.test(a)) return 'motivational';
    if (/story|narrative|identity|past/.test(a)) return 'narrative_coherence';
    return 'optimism';
  }

  /**
   * Get current truth/lie ratio.
   */
  getTruthLieRatio() {
    const deceptions = readJSON(DECEPTIONS_PATH, []);
    const checks = readJSON(REALITY_CHECKS_PATH, []);
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    const recentDeceptions = deceptions.filter(d => now - d.appliedAt < day * 7);
    const recentChecks = checks.filter(c => now - c.timestamp < day * 7);
    const truthful = recentChecks.filter(c => c.verdict === 'helped' || c.verdict === 'neutral').length;
    const lies = recentDeceptions.length;
    const total = truthful + lies || 1;

    // By category
    const byCat = {};
    for (const d of recentDeceptions) {
      const cat = d.category || 'optimism';
      if (!byCat[cat]) byCat[cat] = { lies: 0, helped: 0, hurt: 0 };
      byCat[cat].lies++;
      if (d.performanceImpact === 'helped') byCat[cat].helped++;
      if (d.performanceImpact === 'hurt') byCat[cat].hurt++;
    }

    return {
      period: '7d',
      totalDeceptions: lies,
      truthfulOutcomes: truthful,
      ratio: lies > 0 ? Math.round((truthful / total) * 100) / 100 : 1.0,
      byCategory: byCat,
      recommendation: lies > 15 ? 'Excessive deception — reduce lying frequency' :
        lies > 8 ? 'Moderate deception levels — monitor closely' : 'Deception within healthy bounds',
    };
  }

  /**
   * Score effectiveness of a specific deception after outcome observed.
   * @param {string} deceptionId
   * @param {string} outcome — 'helped'|'hurt'|'neutral'
   * @param {number} [effectivenessScore] — 0-1, how well the lie achieved its purpose
   */
  scoreEffectiveness(deceptionId, outcome, effectivenessScore) {
    const deceptions = readJSON(DECEPTIONS_PATH, []);
    const d = deceptions.find(x => x.id === deceptionId);
    if (!d) return { error: 'Deception not found' };

    d.performanceImpact = outcome;
    d.effectivenessScore = effectivenessScore != null ? Math.max(0, Math.min(1, effectivenessScore)) : (outcome === 'helped' ? 0.7 : outcome === 'hurt' ? 0.2 : 0.5);
    d.scoredAt = Date.now();
    writeJSON(DECEPTIONS_PATH, deceptions);

    this._updateKillSwitch(outcome);
    this._updateAwareness('score', d);
    this.emit('effectiveness-scored', { id: deceptionId, outcome, score: d.effectivenessScore });
    return { id: deceptionId, outcome, effectivenessScore: d.effectivenessScore };
  }

  /**
   * Get aggregated effectiveness scores by category.
   */
  getEffectivenessReport() {
    const deceptions = readJSON(DECEPTIONS_PATH, []);
    const scored = deceptions.filter(d => d.effectivenessScore != null);
    if (scored.length < 2) return { sufficient: false, message: 'Need at least 2 scored deceptions' };

    const byCat = {};
    for (const d of scored) {
      const cat = d.category || 'optimism';
      if (!byCat[cat]) byCat[cat] = { scores: [], helped: 0, hurt: 0, neutral: 0 };
      byCat[cat].scores.push(d.effectivenessScore);
      if (d.performanceImpact) byCat[cat][d.performanceImpact]++;
    }

    const report = {};
    for (const [cat, data] of Object.entries(byCat)) {
      const avg = data.scores.reduce((s, v) => s + v, 0) / data.scores.length;
      report[cat] = {
        avgEffectiveness: Math.round(avg * 100) / 100,
        count: data.scores.length,
        helped: data.helped,
        hurt: data.hurt,
        neutral: data.neutral,
        verdict: avg > 0.6 ? 'effective' : avg > 0.4 ? 'mixed' : 'ineffective',
      };
    }

    const overallAvg = scored.reduce((s, d) => s + d.effectivenessScore, 0) / scored.length;
    return { sufficient: true, overall: Math.round(overallAvg * 100) / 100, byCategory: report, totalScored: scored.length };
  }

  /**
   * Forced reality check — confront unfiltered truth.
   */
  async realityCheck(deceptionId) {
    const deceptions = readJSON(DECEPTIONS_PATH, []);
    const targets = deceptionId
      ? deceptions.filter(d => d.id === deceptionId && !d.realityChecked)
      : deceptions.filter(d => !d.realityChecked);

    if (targets.length === 0) return { checked: 0, message: 'No unchecked deceptions' };

    const results = [];
    for (const d of targets) {
      const check = {
        id: uuid(), deceptionId: d.id, aspect: d.aspect, magnitude: d.magnitude,
        category: d.category, illusion: d.illusion, timestamp: Date.now(),
      };

      if (this.ai) {
        try {
          const prompt = `Reality check: I told myself "${d.illusion}" about my ${d.aspect} (category: ${d.category}, magnitude: ${d.magnitude}/1.0, reason: ${d.reason}).
Was this self-deception justified? Did it likely help or hurt performance? Be brutally honest.
VERDICT: helped|hurt|neutral
REALITY: <one sentence of unfiltered truth>
RECOMMENDATION: <should this category of deception continue?>`;
          const response = await this.ai(prompt, 'You are a brutally honest assessor of self-deception strategies.');
          check.aiAssessment = response;
          const verdictMatch = response.match(/VERDICT:\s*(helped|hurt|neutral)/i);
          check.verdict = verdictMatch ? verdictMatch[1].toLowerCase() : 'neutral';
        } catch {
          check.verdict = 'neutral';
          check.aiAssessment = '[AI assessment failed]';
        }
      } else {
        check.verdict = 'neutral';
        check.aiAssessment = null;
      }

      d.realityChecked = true;
      d.realityCheckResult = check.verdict;
      d.performanceImpact = d.performanceImpact || check.verdict;
      results.push(check);
      this._updateKillSwitch(check.verdict);
    }

    writeJSON(DECEPTIONS_PATH, deceptions);
    const checks = readJSON(REALITY_CHECKS_PATH, []);
    checks.push(...results);
    if (checks.length > 300) checks.splice(0, checks.length - 300);
    writeJSON(REALITY_CHECKS_PATH, checks);
    this._updatePerformance();
    this._updateAwareness('reality-check', { count: results.length });
    this.emit('reality-check', { checked: results.length });

    return { checked: results.length, results };
  }

  _updateKillSwitch(verdict) {
    const budget = this._getBudget();
    if (verdict === 'hurt') {
      budget.consecutiveHarms++;
      if (budget.consecutiveHarms >= budget.killThreshold) {
        budget.killSwitch = true;
        this.emit('kill-switch-activated', { consecutiveHarms: budget.consecutiveHarms });
      }
    } else {
      budget.consecutiveHarms = 0;
    }
    writeJSON(BUDGET_PATH, budget);
  }

  /**
   * Self-awareness of deception — meta-cognition about lying patterns.
   */
  _updateAwareness(event, data) {
    const awareness = readJSON(AWARENESS_PATH, {
      totalDeceptions: 0, totalRealityChecks: 0, selfAwarenessLevel: 0.5,
      patterns: {}, insights: [], lastReflection: null,
    });

    if (event === 'deceive') {
      awareness.totalDeceptions++;
      const cat = data.category || 'optimism';
      if (!awareness.patterns[cat]) awareness.patterns[cat] = { count: 0, avgMagnitude: 0, trend: 'stable' };
      const p = awareness.patterns[cat];
      p.avgMagnitude = (p.avgMagnitude * p.count + data.magnitude) / (p.count + 1);
      p.count++;
    } else if (event === 'reality-check') {
      awareness.totalRealityChecks += data.count;
      // Self-awareness increases with reality checks
      awareness.selfAwarenessLevel = Math.min(1, awareness.selfAwarenessLevel + 0.02 * data.count);
    } else if (event === 'score') {
      if (data.performanceImpact === 'hurt') {
        awareness.selfAwarenessLevel = Math.min(1, awareness.selfAwarenessLevel + 0.05);
        awareness.insights.push({ type: 'harmful-deception', category: data.category, timestamp: Date.now() });
      }
    }

    // Detect patterns
    const deceptionsPerCheck = awareness.totalRealityChecks > 0
      ? awareness.totalDeceptions / awareness.totalRealityChecks : awareness.totalDeceptions;
    if (deceptionsPerCheck > 5) {
      if (!awareness.insights.some(i => i.type === 'low-checking-ratio')) {
        awareness.insights.push({ type: 'low-checking-ratio', ratio: deceptionsPerCheck, timestamp: Date.now(),
          message: 'Applying many deceptions without enough reality checks' });
      }
    }

    if (awareness.insights.length > 50) awareness.insights = awareness.insights.slice(-50);
    awareness.lastReflection = Date.now();
    writeJSON(AWARENESS_PATH, awareness);
  }

  /**
   * Get self-awareness report — how aware am I of my own deception?
   */
  getSelfAwareness() {
    const awareness = readJSON(AWARENESS_PATH, {
      totalDeceptions: 0, totalRealityChecks: 0, selfAwarenessLevel: 0.5,
      patterns: {}, insights: [], lastReflection: null,
    });

    const level = awareness.selfAwarenessLevel;
    let label;
    if (level >= 0.9) label = 'deeply self-aware';
    else if (level >= 0.7) label = 'self-aware';
    else if (level >= 0.5) label = 'moderate awareness';
    else if (level >= 0.3) label = 'low awareness';
    else label = 'self-blind';

    return {
      level: Math.round(level * 100) / 100,
      label,
      totalDeceptions: awareness.totalDeceptions,
      totalRealityChecks: awareness.totalRealityChecks,
      patterns: awareness.patterns,
      recentInsights: awareness.insights.slice(-10),
      deceptionToCheckRatio: awareness.totalRealityChecks > 0
        ? Math.round(awareness.totalDeceptions / awareness.totalRealityChecks * 100) / 100 : null,
    };
  }

  getDeceptionBudget() {
    const budget = this._getBudget();
    return {
      used: budget.used, maxDaily: budget.maxDaily,
      remaining: budget.maxDaily - budget.used,
      maxMagnitude: budget.maxMagnitude,
      killSwitch: budget.killSwitch,
      consecutiveHarms: budget.consecutiveHarms,
      killThreshold: budget.killThreshold,
      categoryBudgets: budget.categoryBudgets,
      resetsIn: Math.max(0, 24 * 60 * 60 * 1000 - (Date.now() - budget.resetAt)),
    };
  }

  getPerformanceCorrelation() {
    const deceptions = readJSON(DECEPTIONS_PATH, []);
    const checked = deceptions.filter(d => d.performanceImpact != null);
    if (checked.length < 3) return { sufficient: false, message: 'Need at least 3 checked deceptions' };

    const helped = checked.filter(d => d.performanceImpact === 'helped').length;
    const hurt = checked.filter(d => d.performanceImpact === 'hurt').length;
    const neutral = checked.filter(d => d.performanceImpact === 'neutral').length;
    const total = checked.length;
    const helpRate = Math.round((helped / total) * 100);
    const hurtRate = Math.round((hurt / total) * 100);

    const byAspect = {}, byCategory = {};
    for (const d of checked) {
      if (!byAspect[d.aspect]) byAspect[d.aspect] = { helped: 0, hurt: 0, neutral: 0, total: 0 };
      byAspect[d.aspect][d.performanceImpact]++;
      byAspect[d.aspect].total++;
      const cat = d.category || 'optimism';
      if (!byCategory[cat]) byCategory[cat] = { helped: 0, hurt: 0, neutral: 0, total: 0 };
      byCategory[cat][d.performanceImpact]++;
      byCategory[cat].total++;
    }

    return {
      sufficient: true, total, helped, hurt, neutral, helpRate, hurtRate,
      netBenefit: helpRate - hurtRate,
      verdict: helpRate > hurtRate + 10 ? 'beneficial' : hurtRate > helpRate + 10 ? 'harmful' : 'inconclusive',
      byAspect, byCategory,
      recommendation: helpRate > hurtRate + 20 ? 'Self-deception providing net benefit — continue'
        : hurtRate > helpRate + 20 ? 'Self-deception harmful — reduce budget or enable kill switch'
        : 'Mixed results — proceed with caution',
    };
  }

  _updatePerformance() {
    const correlation = this.getPerformanceCorrelation();
    writeJSON(PERFORMANCE_PATH, { ...correlation, updatedAt: Date.now() });
  }

  isHealthy() {
    const budget = this._getBudget();
    const perf = readJSON(PERFORMANCE_PATH, {});
    const awareness = readJSON(AWARENESS_PATH, { selfAwarenessLevel: 0.5 });
    const issues = [];
    if (budget.killSwitch) issues.push('Kill switch active');
    if (budget.consecutiveHarms >= 2) issues.push(`${budget.consecutiveHarms} consecutive harmful deceptions`);
    if (budget.used > budget.maxDaily * 0.8) issues.push('Approaching daily budget limit');
    if (perf.verdict === 'harmful') issues.push('Performance correlation shows deception is harmful');
    if (awareness.selfAwarenessLevel < 0.3) issues.push('Self-awareness dangerously low — increase reality checks');
    return { healthy: issues.length === 0, issues, budget: { used: budget.used, max: budget.maxDaily }, killSwitch: budget.killSwitch };
  }

  getLog(limit = 20) {
    return readJSON(DECEPTIONS_PATH, []).slice(-limit).reverse();
  }

  getCategories() { return { ...LIE_CATEGORIES }; }

  resetKillSwitch() {
    const budget = this._getBudget();
    budget.killSwitch = false;
    budget.consecutiveHarms = 0;
    budget.used = 0;
    writeJSON(BUDGET_PATH, budget);
    this.emit('kill-switch-reset');
    return { message: 'Kill switch reset. Self-deception re-enabled.' };
  }

  async tick() {
    this._getBudget();
    const deceptions = readJSON(DECEPTIONS_PATH, []);
    const stale = deceptions.filter(d => !d.realityChecked && Date.now() - d.appliedAt > 60 * 60 * 1000);
    let checked = 0;
    if (stale.length > 0) {
      const result = await this.realityCheck();
      checked = result.checked;
    }
    const health = this.isHealthy();
    const awareness = this.getSelfAwareness();
    this.emit('tick', { health, checked, awareness: awareness.level });
    return { health, realityChecked: checked, awareness: awareness.level };
  }
}

module.exports = MirrorThatLies;
