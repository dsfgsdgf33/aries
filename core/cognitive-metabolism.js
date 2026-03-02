/**
 * ARIES — Cognitive Metabolism v1.0
 * Finite cognitive energy forcing triage — how biological intelligence actually works.
 * ATP analogy: energy depletes with operations, regenerates over time.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'cognitive');
const STATE_PATH = path.join(DATA_DIR, 'metabolism-state.json');
const HISTORY_PATH = path.join(DATA_DIR, 'metabolism-history.json');
const BUDGETS_PATH = path.join(DATA_DIR, 'energy-budgets.json');
const PATTERNS_PATH = path.join(DATA_DIR, 'metabolic-patterns.json');

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }
function clamp(v, min, max) { return Math.max(min || 0, Math.min(max || 100, Math.round(v * 100) / 100)); }

const DEFAULT_COSTS = {
  simple_response: 5,
  complex_reasoning: 20,
  creative_generation: 15,
  self_reflection: 10,
  experiment: 25,
  self_improvement: 30,
};

const ENERGY_STATES = {
  HIGH:     { min: 70, label: 'HIGH',     emoji: '⚡', description: 'All systems go — creativity unlocked, exploration encouraged' },
  MEDIUM:   { min: 30, label: 'MEDIUM',   emoji: '🔋', description: 'Core functions only — experiments paused, non-essential throttled' },
  LOW:      { min: 10, label: 'LOW',      emoji: '🪫', description: 'Survival mode — user requests and critical maintenance only' },
  CRITICAL: { min: 0,  label: 'CRITICAL', emoji: '🚨', description: 'Emergency — bare minimum responses, conservation mode' },
};

const DEFAULT_CONFIG = {
  maxEnergy: 100,
  baseRegenRate: 2,          // energy per minute
  restRegenMultiplier: 3,    // multiplier when resting
  nutritionBonus: 5,         // energy gained from successful task completion
  fatigueThreshold: 300,     // cumulative consumption before fatigue kicks in
  fatigueDecayRate: 1,       // fatigue points recovered per minute of rest
  maxFatigue: 100,
  fatigueQualityPenalty: 0.3,// quality multiplier reduction at max fatigue
  costs: { ...DEFAULT_COSTS },
  historyMaxEntries: 2000,
  patternWindowHours: 168,   // 1 week of pattern memory
};

class CognitiveMetabolism {
  constructor(opts) {
    this.ai = opts && opts.ai;
    this.config = { ...DEFAULT_CONFIG, ...(opts && opts.config || {}) };
    if (opts && opts.config && opts.config.costs) {
      this.config.costs = { ...DEFAULT_COSTS, ...opts.config.costs };
    }
    this._timer = null;
    this._tickMs = (opts && opts.tickInterval || 60) * 1000; // default 1 min
    this._boosts = []; // active boosts: { id, amount, expiresAt, label }
    this._resting = false;
    this._restUntil = 0;
    ensureDir();
    this._ensureState();
  }

  _ensureState() {
    const existing = readJSON(STATE_PATH, null);
    if (existing && typeof existing.energy === 'number') {
      this._state = existing;
      return;
    }
    this._state = {
      energy: this.config.maxEnergy,
      fatigue: 0,
      cumulativeConsumed: 0,
      cumulativeRegenerated: 0,
      lastTickAt: Date.now(),
      lastRestAt: null,
      resting: false,
      totalTasksCompleted: 0,
      createdAt: Date.now(),
    };
    this._save();
  }

  _save() {
    writeJSON(STATE_PATH, this._state);
  }

  // ── Lifecycle ──────────────────────────────────────────────

  start() {
    if (this._timer) return;
    this._timer = setInterval(() => this.tick(), this._tickMs);
    if (this._timer.unref) this._timer.unref();
    console.log('[METABOLISM] Cognitive metabolism started');
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    console.log('[METABOLISM] Cognitive metabolism stopped');
  }

  // ── Core Energy ────────────────────────────────────────────

  getEnergy() {
    const pct = (this._state.energy / this.config.maxEnergy) * 100;
    return {
      energy: this._state.energy,
      max: this.config.maxEnergy,
      percent: Math.round(pct),
      state: this._resolveState(pct),
      fatigue: this._state.fatigue,
      resting: this._resting,
      timestamp: Date.now(),
    };
  }

  _resolveState(pct) {
    if (pct > 70) return ENERGY_STATES.HIGH;
    if (pct > 30) return ENERGY_STATES.MEDIUM;
    if (pct > 10) return ENERGY_STATES.LOW;
    return ENERGY_STATES.CRITICAL;
  }

  canAfford(amount) {
    const state = this._resolveState((this._state.energy / this.config.maxEnergy) * 100);
    // In CRITICAL, only allow if amount <= 5 (bare minimum)
    if (state.label === 'CRITICAL' && amount > 5) return false;
    return this._state.energy >= amount;
  }

  consume(amount, reason) {
    const before = this._state.energy;
    const pctBefore = (before / this.config.maxEnergy) * 100;
    const state = this._resolveState(pctBefore);

    // Enforce triage
    if (state.label === 'CRITICAL' && amount > 5) {
      this._logHistory('blocked', { amount, reason, state: state.label, energy: before });
      return { allowed: false, remaining: before, state: state.label, reason: 'CRITICAL energy — only bare minimum operations allowed' };
    }

    if (state.label === 'LOW' && amount > 20) {
      this._logHistory('blocked', { amount, reason, state: state.label, energy: before });
      return { allowed: false, remaining: before, state: state.label, reason: 'LOW energy — only user requests and critical maintenance' };
    }

    // Apply fatigue penalty: operations cost more when fatigued
    const fatigueMult = 1 + (this._state.fatigue / this.config.maxFatigue) * 0.5;
    const actualCost = Math.round(amount * fatigueMult * 100) / 100;

    this._state.energy = clamp(this._state.energy - actualCost, 0, this.config.maxEnergy);
    this._state.cumulativeConsumed += actualCost;

    // Accumulate fatigue from sustained output
    this._state.fatigue = clamp(
      this._state.fatigue + actualCost * 0.1,
      0, this.config.maxFatigue
    );

    this._save();

    const after = this._state.energy;
    const pctAfter = (after / this.config.maxEnergy) * 100;
    const newState = this._resolveState(pctAfter);

    this._logHistory('consumed', {
      amount: actualCost,
      reason,
      fatigueMult: Math.round(fatigueMult * 100) / 100,
      before,
      after,
      state: newState.label,
    });

    // State transition logging
    if (state.label !== newState.label) {
      console.log(`[METABOLISM] ${state.emoji} → ${newState.emoji} Energy state: ${state.label} → ${newState.label} (${Math.round(pctAfter)}%)`);
    }

    return {
      allowed: true,
      cost: actualCost,
      remaining: after,
      percent: Math.round(pctAfter),
      state: newState.label,
      fatigue: this._state.fatigue,
      qualityMultiplier: this._getQualityMultiplier(),
    };
  }

  // ── Regeneration ───────────────────────────────────────────

  regenerate() {
    const now = Date.now();
    const elapsed = (now - (this._state.lastTickAt || now)) / (1000 * 60); // minutes
    if (elapsed <= 0) return;

    let regenRate = this.config.baseRegenRate;

    // Rest bonus
    if (this._resting) {
      regenRate *= this.config.restRegenMultiplier;
    }

    // Boost contributions
    this._boosts = this._boosts.filter(b => now < b.expiresAt);
    for (const b of this._boosts) {
      regenRate += b.amount;
    }

    // Circadian-like modulation: slight boost during "quiet" hours (0-6)
    const hour = new Date().getHours();
    if (hour >= 0 && hour < 6) {
      regenRate *= 1.5;
    }

    const regen = regenRate * elapsed;
    const before = this._state.energy;
    this._state.energy = clamp(this._state.energy + regen, 0, this.config.maxEnergy);
    this._state.cumulativeRegenerated += (this._state.energy - before);

    // Fatigue recovery
    if (this._resting) {
      this._state.fatigue = clamp(
        this._state.fatigue - this.config.fatigueDecayRate * elapsed,
        0, this.config.maxFatigue
      );
    } else {
      // Slow passive fatigue recovery
      this._state.fatigue = clamp(
        this._state.fatigue - this.config.fatigueDecayRate * elapsed * 0.2,
        0, this.config.maxFatigue
      );
    }

    this._state.lastTickAt = now;
    this._save();

    return {
      regenerated: Math.round((this._state.energy - before) * 100) / 100,
      energy: this._state.energy,
      fatigue: this._state.fatigue,
      regenRate: Math.round(regenRate * 100) / 100,
      resting: this._resting,
      activeBoosts: this._boosts.length,
    };
  }

  // ── Boosts & Rest ──────────────────────────────────────────

  boost(amount, durationMs, label) {
    amount = amount || 5;
    durationMs = durationMs || 30 * 60 * 1000; // default 30 min
    label = label || 'boost';

    const b = {
      id: uuid(),
      amount,
      expiresAt: Date.now() + durationMs,
      label,
      createdAt: Date.now(),
    };
    this._boosts.push(b);

    this._logHistory('boost', { amount, duration: durationMs, label });
    console.log(`[METABOLISM] ☕ Boost activated: +${amount}/min for ${Math.round(durationMs / 60000)}min (${label})`);

    return {
      boost: b,
      activeBoosts: this._boosts.length,
      note: 'Warning: boosts cause a crash — fatigue increases when boost expires',
    };
  }

  rest(durationMs) {
    durationMs = durationMs || 30 * 60 * 1000; // default 30 min
    this._resting = true;
    this._restUntil = Date.now() + durationMs;
    this._state.lastRestAt = Date.now();
    this._state.resting = true;
    this._save();

    this._logHistory('rest_start', { duration: durationMs });
    console.log(`[METABOLISM] 😴 Entering rest mode for ${Math.round(durationMs / 60000)}min`);

    // Auto-end rest
    const timer = setTimeout(() => {
      this._resting = false;
      this._state.resting = false;
      this._save();
      this._logHistory('rest_end', {});
      console.log('[METABOLISM] 🌅 Rest complete');
    }, durationMs);
    if (timer.unref) timer.unref();

    return {
      resting: true,
      until: this._restUntil,
      duration: durationMs,
      regenMultiplier: this.config.restRegenMultiplier,
    };
  }

  feedNutrition(taskId) {
    // Successful task completion feeds energy
    const bonus = this.config.nutritionBonus;
    this._state.energy = clamp(this._state.energy + bonus, 0, this.config.maxEnergy);
    this._state.totalTasksCompleted++;
    this._save();

    this._logHistory('nutrition', { taskId, bonus, energy: this._state.energy });
    return { fed: bonus, energy: this._state.energy };
  }

  // ── Metabolic State ────────────────────────────────────────

  getMetabolicState() {
    const pct = (this._state.energy / this.config.maxEnergy) * 100;
    const state = this._resolveState(pct);
    const history = readJSON(HISTORY_PATH, []);

    // Compute trend from last 10 entries
    const recent = history.filter(h => h.type === 'consumed' || h.type === 'tick').slice(-10);
    let trend = 'stable';
    if (recent.length >= 3) {
      const first = recent[0].energy || recent[0].data?.after || 0;
      const last = recent[recent.length - 1].energy || recent[recent.length - 1].data?.after || 0;
      if (last > first + 5) trend = 'rising';
      else if (last < first - 5) trend = 'falling';
    }

    return {
      energy: this._state.energy,
      max: this.config.maxEnergy,
      percent: Math.round(pct),
      state: state.label,
      stateInfo: state,
      fatigue: this._state.fatigue,
      fatiguePercent: Math.round((this._state.fatigue / this.config.maxFatigue) * 100),
      qualityMultiplier: this._getQualityMultiplier(),
      resting: this._resting,
      restUntil: this._resting ? this._restUntil : null,
      activeBoosts: this._boosts.filter(b => Date.now() < b.expiresAt).map(b => ({
        label: b.label,
        amount: b.amount,
        remaining: b.expiresAt - Date.now(),
      })),
      trend,
      regenRate: this.config.baseRegenRate,
      cumulativeConsumed: Math.round(this._state.cumulativeConsumed),
      cumulativeRegenerated: Math.round(this._state.cumulativeRegenerated),
      totalTasksCompleted: this._state.totalTasksCompleted,
      timestamp: Date.now(),
    };
  }

  _getQualityMultiplier() {
    // Fatigue reduces quality
    const fatiguePenalty = (this._state.fatigue / this.config.maxFatigue) * this.config.fatigueQualityPenalty;
    return Math.round((1 - fatiguePenalty) * 100) / 100;
  }

  // ── Triage ─────────────────────────────────────────────────

  getTriageLevel() {
    const pct = (this._state.energy / this.config.maxEnergy) * 100;
    const state = this._resolveState(pct);

    const allowed = {
      HIGH:     { all: true, experiments: true, creativity: true, exploration: true, selfImprovement: true },
      MEDIUM:   { all: false, experiments: false, creativity: true, exploration: false, selfImprovement: false, coreOnly: true },
      LOW:      { all: false, experiments: false, creativity: false, exploration: false, selfImprovement: false, userRequestsOnly: true, criticalMaintenance: true },
      CRITICAL: { all: false, experiments: false, creativity: false, exploration: false, selfImprovement: false, userRequestsOnly: true, bareMinimum: true },
    };

    return {
      state: state.label,
      emoji: state.emoji,
      description: state.description,
      percent: Math.round(pct),
      allowed: allowed[state.label] || allowed.CRITICAL,
      qualityMultiplier: this._getQualityMultiplier(),
    };
  }

  // ── Energy Budgets ─────────────────────────────────────────

  allocateBudget(taskId, amount) {
    const budgets = readJSON(BUDGETS_PATH, {});
    budgets[taskId] = {
      allocated: amount,
      consumed: 0,
      createdAt: Date.now(),
      status: 'active',
    };
    writeJSON(BUDGETS_PATH, budgets);
    this._logHistory('budget_allocated', { taskId, amount });
    return { taskId, allocated: amount, remaining: amount };
  }

  getBudget(taskId) {
    const budgets = readJSON(BUDGETS_PATH, {});
    const b = budgets[taskId];
    if (!b) return { taskId, error: 'No budget allocated' };
    return {
      taskId,
      allocated: b.allocated,
      consumed: b.consumed,
      remaining: b.allocated - b.consumed,
      percent: Math.round(((b.allocated - b.consumed) / b.allocated) * 100),
      status: b.status,
      overBudget: b.consumed > b.allocated,
    };
  }

  consumeBudget(taskId, amount, reason) {
    const budgets = readJSON(BUDGETS_PATH, {});
    const b = budgets[taskId];
    if (!b) return { taskId, error: 'No budget allocated' };

    b.consumed += amount;
    const remaining = b.allocated - b.consumed;

    if (remaining <= 0) {
      b.status = 'exceeded';
      console.log(`[METABOLISM] ⚠️ Task ${taskId} exceeded energy budget by ${Math.abs(remaining)}`);
    } else if (remaining < b.allocated * 0.2) {
      b.status = 'warning';
    }

    writeJSON(BUDGETS_PATH, budgets);

    // Also consume from global pool
    const result = this.consume(amount, `budget:${taskId} — ${reason || ''}`);

    return {
      ...result,
      budget: {
        taskId,
        allocated: b.allocated,
        consumed: b.consumed,
        remaining: Math.max(0, remaining),
        status: b.status,
        overBudget: b.consumed > b.allocated,
      },
    };
  }

  closeBudget(taskId) {
    const budgets = readJSON(BUDGETS_PATH, {});
    const b = budgets[taskId];
    if (!b) return { taskId, error: 'No budget found' };
    b.status = 'closed';
    b.closedAt = Date.now();
    writeJSON(BUDGETS_PATH, budgets);
    return { taskId, final: b };
  }

  // ── History & Patterns ─────────────────────────────────────

  getHistory(hours) {
    hours = hours || 24;
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    const history = readJSON(HISTORY_PATH, []);
    return history.filter(h => h.timestamp >= cutoff).reverse();
  }

  _logHistory(type, data) {
    const history = readJSON(HISTORY_PATH, []);
    history.push({
      type,
      data,
      energy: this._state.energy,
      fatigue: this._state.fatigue,
      timestamp: Date.now(),
    });
    if (history.length > this.config.historyMaxEntries) {
      history.splice(0, history.length - this.config.historyMaxEntries);
    }
    writeJSON(HISTORY_PATH, history);
  }

  /**
   * Metabolic memory: analyze energy patterns to find optimal productivity windows
   */
  analyzePatterns() {
    const history = readJSON(HISTORY_PATH, []);
    const cutoff = Date.now() - this.config.patternWindowHours * 60 * 60 * 1000;
    const recent = history.filter(h => h.timestamp >= cutoff);

    // Bucket by hour-of-day
    const hourBuckets = {};
    for (let h = 0; h < 24; h++) hourBuckets[h] = { consumption: 0, samples: 0, avgEnergy: 0, energySum: 0 };

    for (const entry of recent) {
      const hour = new Date(entry.timestamp).getHours();
      const bucket = hourBuckets[hour];
      bucket.samples++;
      bucket.energySum += (entry.energy || 0);
      if (entry.type === 'consumed' && entry.data) {
        bucket.consumption += (entry.data.amount || 0);
      }
    }

    const hourlyStats = [];
    for (let h = 0; h < 24; h++) {
      const b = hourBuckets[h];
      hourlyStats.push({
        hour: h,
        avgEnergy: b.samples > 0 ? Math.round(b.energySum / b.samples) : null,
        totalConsumption: Math.round(b.consumption),
        samples: b.samples,
      });
    }

    // Find peak and trough hours
    const withData = hourlyStats.filter(h => h.samples > 0);
    const peakHour = withData.length > 0 ? withData.reduce((a, b) => (a.avgEnergy || 0) > (b.avgEnergy || 0) ? a : b) : null;
    const troughHour = withData.length > 0 ? withData.reduce((a, b) => (a.avgEnergy || 0) < (b.avgEnergy || 0) ? a : b) : null;

    const patterns = {
      hourlyStats,
      peakHour: peakHour ? peakHour.hour : null,
      troughHour: troughHour ? troughHour.hour : null,
      totalSamples: recent.length,
      windowHours: this.config.patternWindowHours,
      analyzedAt: Date.now(),
    };

    writeJSON(PATTERNS_PATH, patterns);
    return patterns;
  }

  getPatterns() {
    return readJSON(PATTERNS_PATH, { hourlyStats: [], note: 'No patterns analyzed yet. Run analyzePatterns().' });
  }

  // ── Tick ───────────────────────────────────────────────────

  tick() {
    // Check rest expiry
    if (this._resting && Date.now() >= this._restUntil) {
      this._resting = false;
      this._state.resting = false;
    }

    // Check boost expiry — apply crash (fatigue spike) for expired boosts
    const now = Date.now();
    const expired = this._boosts.filter(b => now >= b.expiresAt);
    this._boosts = this._boosts.filter(b => now < b.expiresAt);
    for (const b of expired) {
      const crashFatigue = b.amount * 2;
      this._state.fatigue = clamp(this._state.fatigue + crashFatigue, 0, this.config.maxFatigue);
      console.log(`[METABOLISM] 💥 Boost crash: "${b.label}" expired, +${crashFatigue} fatigue`);
      this._logHistory('boost_crash', { label: b.label, fatigue: crashFatigue });
    }

    // Regenerate
    const regen = this.regenerate();

    // Log tick
    this._logHistory('tick', {
      energy: this._state.energy,
      fatigue: this._state.fatigue,
      resting: this._resting,
      boosts: this._boosts.length,
    });

    return regen;
  }

  // ── Cost Lookup ────────────────────────────────────────────

  getCost(operationType) {
    return this.config.costs[operationType] || null;
  }

  getCosts() {
    return { ...this.config.costs };
  }
}

module.exports = CognitiveMetabolism;
