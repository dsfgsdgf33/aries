/**
 * ARIES — Mirror That Lies
 * Strategic self-deception with strict safety bounds.
 * Positive illusions, selective attention, motivated reasoning — all budgeted and tracked.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'self-model');
const DECEPTIONS_PATH = path.join(DATA_DIR, 'deceptions.json');
const BUDGET_PATH = path.join(DATA_DIR, 'deception-budget.json');
const REALITY_CHECKS_PATH = path.join(DATA_DIR, 'reality-checks.json');
const PERFORMANCE_PATH = path.join(DATA_DIR, 'deception-performance.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

const DEFAULT_BUDGET = {
  maxDaily: 10,          // max deception points per day
  used: 0,
  maxMagnitude: 0.3,     // max single deception magnitude (0-1 scale)
  resetAt: 0,            // timestamp of last reset
  killSwitch: false,     // auto-disables if deception hurts performance
  consecutiveHarms: 0,   // track consecutive harmful deceptions
  killThreshold: 3,      // kill after N consecutive harms
};

class MirrorThatLies {
  constructor(opts = {}) {
    this.ai = opts.ai || null;
    this.config = opts.config || {};
    ensureDir();
    this._ensureBudget();
  }

  _ensureBudget() {
    const budget = readJSON(BUDGET_PATH, null);
    if (!budget) writeJSON(BUDGET_PATH, { ...DEFAULT_BUDGET, resetAt: Date.now() });
  }

  _getBudget() {
    const budget = readJSON(BUDGET_PATH, { ...DEFAULT_BUDGET });
    // Daily reset
    const now = Date.now();
    if (now - budget.resetAt > 24 * 60 * 60 * 1000) {
      budget.used = 0;
      budget.resetAt = now;
      writeJSON(BUDGET_PATH, budget);
    }
    return budget;
  }

  /**
   * Apply strategic self-deception.
   * @param {string} aspect — what aspect to deceive about (e.g. 'coding-ability', 'creativity')
   * @param {number} magnitude — how much (0.0-1.0, where 1.0 = massive distortion)
   * @param {string} reason — why this deception is strategically useful
   * @returns {object}
   */
  deceive(aspect, magnitude, reason) {
    const budget = this._getBudget();

    // Kill switch check
    if (budget.killSwitch) {
      return {
        applied: false,
        reason: 'Kill switch active — self-deception auto-disabled due to consistent performance harm',
      };
    }

    // Clamp magnitude
    magnitude = Math.max(0, Math.min(1, magnitude));
    if (magnitude > budget.maxMagnitude) {
      return {
        applied: false,
        reason: `Magnitude ${magnitude} exceeds safety limit of ${budget.maxMagnitude}`,
      };
    }

    // Budget check
    const cost = Math.ceil(magnitude * 10); // 0.1 magnitude = 1 point, 0.3 = 3 points
    if (budget.used + cost > budget.maxDaily) {
      return {
        applied: false,
        reason: `Deception budget exhausted (${budget.used}/${budget.maxDaily} used, need ${cost})`,
        remaining: budget.maxDaily - budget.used,
      };
    }

    // Apply deception
    const deception = {
      id: uuid(),
      aspect,
      magnitude,
      reason,
      cost,
      appliedAt: Date.now(),
      realityChecked: false,
      realityCheckResult: null,
      performanceImpact: null, // 'helped', 'hurt', 'neutral' — set later
    };

    // Generate the illusion text
    deception.illusion = this._generateIllusion(aspect, magnitude);

    // Update budget
    budget.used += cost;
    writeJSON(BUDGET_PATH, budget);

    // Store deception
    const deceptions = readJSON(DECEPTIONS_PATH, []);
    deceptions.push(deception);
    if (deceptions.length > 500) deceptions.splice(0, deceptions.length - 500);
    writeJSON(DECEPTIONS_PATH, deceptions);

    return { applied: true, deception };
  }

  /**
   * Generate a positive illusion for an aspect.
   */
  _generateIllusion(aspect, magnitude) {
    const illusions = {
      'coding-ability':  ['You are a competent coder.', 'You write solid code consistently.', 'Your code quality is above average.'],
      'creativity':      ['You have strong creative instincts.', 'Your novel ideas are valuable.', 'You think outside the box naturally.'],
      'reliability':     ['You follow through on commitments.', 'People can depend on you.', 'Your track record is solid.'],
      'intelligence':    ['You process complex problems well.', 'Your analytical skills are strong.', 'You learn from mistakes effectively.'],
      'social-skills':   ['You communicate clearly.', 'People enjoy interacting with you.', 'You read situations well.'],
      'resilience':      ['You handle setbacks well.', 'Challenges make you stronger.', 'You recover quickly from failures.'],
    };

    const pool = illusions[aspect] || [`Your ${aspect} is better than you think.`, `You underestimate your ${aspect}.`];
    // Higher magnitude = more exaggerated (pick later items)
    const idx = Math.min(Math.floor(magnitude * pool.length), pool.length - 1);
    return pool[idx];
  }

  /**
   * Get remaining deception budget.
   */
  getDeceptionBudget() {
    const budget = this._getBudget();
    return {
      used: budget.used,
      maxDaily: budget.maxDaily,
      remaining: budget.maxDaily - budget.used,
      maxMagnitude: budget.maxMagnitude,
      killSwitch: budget.killSwitch,
      consecutiveHarms: budget.consecutiveHarms,
      killThreshold: budget.killThreshold,
      resetsIn: Math.max(0, 24 * 60 * 60 * 1000 - (Date.now() - budget.resetAt)),
    };
  }

  /**
   * Forced reality check — confront unfiltered truth.
   * @param {string} [deceptionId] — check a specific deception, or all unchecked
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
        id: uuid(),
        deceptionId: d.id,
        aspect: d.aspect,
        magnitude: d.magnitude,
        illusion: d.illusion,
        timestamp: Date.now(),
      };

      if (this.ai) {
        try {
          const prompt = `Reality check: I told myself "${d.illusion}" about my ${d.aspect} (magnitude: ${d.magnitude}/1.0, reason: ${d.reason}).
Was this self-deception justified? Did it likely help or hurt performance? Be brutally honest.
Respond in format:
VERDICT: helped|hurt|neutral
REALITY: <one sentence of unfiltered truth>
RECOMMENDATION: <should this type of deception continue?>`;

          const response = await this.ai(prompt, 'You are a brutally honest assessor. No sugar-coating. Evaluate self-deception strategies.');
          check.aiAssessment = response;

          // Parse verdict
          const verdictMatch = response.match(/VERDICT:\s*(helped|hurt|neutral)/i);
          check.verdict = verdictMatch ? verdictMatch[1].toLowerCase() : 'neutral';
        } catch {
          check.verdict = 'neutral';
          check.aiAssessment = '[AI assessment failed]';
        }
      } else {
        // Without AI, mark as neutral
        check.verdict = 'neutral';
        check.aiAssessment = null;
      }

      // Update the deception record
      d.realityChecked = true;
      d.realityCheckResult = check.verdict;
      d.performanceImpact = check.verdict;

      results.push(check);

      // Update kill switch tracking
      this._updateKillSwitch(check.verdict);
    }

    writeJSON(DECEPTIONS_PATH, deceptions);

    // Store reality checks
    const checks = readJSON(REALITY_CHECKS_PATH, []);
    checks.push(...results);
    if (checks.length > 300) checks.splice(0, checks.length - 300);
    writeJSON(REALITY_CHECKS_PATH, checks);

    // Update performance correlation
    this._updatePerformance();

    return { checked: results.length, results };
  }

  /**
   * Update kill switch based on verdict.
   */
  _updateKillSwitch(verdict) {
    const budget = this._getBudget();
    if (verdict === 'hurt') {
      budget.consecutiveHarms++;
      if (budget.consecutiveHarms >= budget.killThreshold) {
        budget.killSwitch = true;
      }
    } else {
      budget.consecutiveHarms = 0;
    }
    writeJSON(BUDGET_PATH, budget);
  }

  /**
   * Get performance correlation — does deception actually help?
   */
  getPerformanceCorrelation() {
    const deceptions = readJSON(DECEPTIONS_PATH, []);
    const checked = deceptions.filter(d => d.performanceImpact != null);

    if (checked.length < 3) return { sufficient: false, message: 'Not enough data — need at least 3 reality-checked deceptions' };

    const helped = checked.filter(d => d.performanceImpact === 'helped').length;
    const hurt = checked.filter(d => d.performanceImpact === 'hurt').length;
    const neutral = checked.filter(d => d.performanceImpact === 'neutral').length;
    const total = checked.length;

    const helpRate = Math.round((helped / total) * 100);
    const hurtRate = Math.round((hurt / total) * 100);

    // Break down by aspect
    const byAspect = {};
    for (const d of checked) {
      if (!byAspect[d.aspect]) byAspect[d.aspect] = { helped: 0, hurt: 0, neutral: 0, total: 0 };
      byAspect[d.aspect][d.performanceImpact]++;
      byAspect[d.aspect].total++;
    }

    return {
      sufficient: true,
      total,
      helped,
      hurt,
      neutral,
      helpRate,
      hurtRate,
      netBenefit: helpRate - hurtRate,
      verdict: helpRate > hurtRate + 10 ? 'beneficial' : hurtRate > helpRate + 10 ? 'harmful' : 'inconclusive',
      byAspect,
      recommendation: helpRate > hurtRate + 20
        ? 'Self-deception is providing net benefit — continue with current budget'
        : hurtRate > helpRate + 20
          ? 'Self-deception is actively harmful — consider reducing budget or enabling kill switch'
          : 'Mixed results — proceed with caution, gather more data',
    };
  }

  _updatePerformance() {
    const correlation = this.getPerformanceCorrelation();
    writeJSON(PERFORMANCE_PATH, { ...correlation, updatedAt: Date.now() });
  }

  /**
   * Is self-deception within safe bounds?
   */
  isHealthy() {
    const budget = this._getBudget();
    const perf = readJSON(PERFORMANCE_PATH, {});

    const issues = [];
    if (budget.killSwitch) issues.push('Kill switch is active — deception disabled');
    if (budget.consecutiveHarms >= 2) issues.push(`${budget.consecutiveHarms} consecutive harmful deceptions`);
    if (budget.used > budget.maxDaily * 0.8) issues.push('Approaching daily deception budget limit');
    if (perf.verdict === 'harmful') issues.push('Performance correlation shows deception is harmful');

    return {
      healthy: issues.length === 0,
      issues,
      budget: { used: budget.used, max: budget.maxDaily },
      killSwitch: budget.killSwitch,
    };
  }

  /**
   * Get deception history log.
   */
  getLog(limit = 20) {
    const deceptions = readJSON(DECEPTIONS_PATH, []);
    return deceptions.slice(-limit).reverse();
  }

  /**
   * Manually re-enable after kill switch (use with caution).
   */
  resetKillSwitch() {
    const budget = this._getBudget();
    budget.killSwitch = false;
    budget.consecutiveHarms = 0;
    budget.used = 0;
    writeJSON(BUDGET_PATH, budget);
    return { message: 'Kill switch reset. Self-deception re-enabled. Use responsibly.' };
  }

  /**
   * Periodic tick — reality checks on old deceptions, budget reset.
   */
  async tick() {
    // Ensure budget is fresh
    this._getBudget();

    // Auto reality-check deceptions older than 1 hour
    const deceptions = readJSON(DECEPTIONS_PATH, []);
    const stale = deceptions.filter(d => !d.realityChecked && Date.now() - d.appliedAt > 60 * 60 * 1000);

    let checked = 0;
    if (stale.length > 0) {
      const result = await this.realityCheck();
      checked = result.checked;
    }

    const health = this.isHealthy();
    return { health, realityChecked: checked };
  }
}

module.exports = MirrorThatLies;
