/**
 * ARIES — Cognitive Metabolism v2.0
 * Finite cognitive energy forcing triage — how biological intelligence works.
 * ATP analogy: energy depletes with operations, regenerates over time.
 * 
 * Features: 5-state energy model (CRITICAL→LOW→MEDIUM→HIGH→PEAK), per-operation
 * costs, rest/recovery, boost+crash, metabolic memory, fatigue accumulation,
 * energy budgets, metabolic rate adjustment, starvation mode, tick integration.
 */

const EventEmitter = require('events');
const path = require('path');
const crypto = require('crypto');

const SharedMemoryStore = require('./shared-memory-store');
const store = SharedMemoryStore.getInstance();
const NS = 'cognitive-metabolism';

const DATA_DIR = path.join(__dirname, '..', 'data', 'cognitive');
const STATE_PATH = path.join(DATA_DIR, 'metabolism-state.json');
const HISTORY_PATH = path.join(DATA_DIR, 'metabolism-history.json');
const BUDGETS_PATH = path.join(DATA_DIR, 'energy-budgets.json');
const PATTERNS_PATH = path.join(DATA_DIR, 'metabolic-patterns.json');
const ALLOCATIONS_PATH = path.join(DATA_DIR, 'module-allocations.json');

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function ensureDir() {}
function readJSON(p, fallback) { return store.get(NS, path.basename(p, '.json'), fallback); }
function writeJSON(p, data) { store.set(NS, path.basename(p, '.json'), data); }
function clamp(v, min, max) { return Math.max(min || 0, Math.min(max || 100, Math.round(v * 100) / 100)); }

const DEFAULT_COSTS = {
  simple_response: 5,
  complex_reasoning: 20,
  creative_generation: 15,
  self_reflection: 10,
  experiment: 25,
  self_improvement: 30,
  memory_recall: 3,
  planning: 12,
  monitoring: 2,
  communication: 8,
};

const ENERGY_STATES = {
  PEAK:     { min: 90, label: 'PEAK',     emoji: '🌟', description: 'Maximum output — all systems at full, creativity and exploration maximized' },
  HIGH:     { min: 70, label: 'HIGH',     emoji: '⚡', description: 'All systems go — creativity unlocked, exploration encouraged' },
  MEDIUM:   { min: 30, label: 'MEDIUM',   emoji: '🔋', description: 'Core functions only — experiments paused, non-essential throttled' },
  LOW:      { min: 10, label: 'LOW',      emoji: '🪫', description: 'Survival mode — user requests and critical maintenance only' },
  CRITICAL: { min: 0,  label: 'CRITICAL', emoji: '🚨', description: 'Emergency — bare minimum responses, starvation mode active' },
};

const DEFAULT_CONFIG = {
  maxEnergy: 100,
  baseRegenRate: 2,
  restRegenMultiplier: 3,
  nutritionBonus: 5,
  fatigueThreshold: 300,
  fatigueDecayRate: 1,
  maxFatigue: 100,
  fatigueQualityPenalty: 0.3,
  starvationThreshold: 5,       // energy below which starvation mode activates
  starvationRegenBoost: 2,      // extra regen in starvation
  peakDurationMs: 30 * 60 * 1000, // PEAK state naturally decays after 30min
  metabolicRateBase: 1.0,       // base metabolic rate multiplier
  metabolicRateAdaptation: true, // adjust rate based on workload
  workloadWindowMs: 15 * 60 * 1000, // 15 min window for workload calculation
  costs: { ...DEFAULT_COSTS },
  historyMaxEntries: 2000,
  patternWindowHours: 168,
};

class CognitiveMetabolism extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.ai = opts && opts.ai;
    this.config = { ...DEFAULT_CONFIG, ...(opts && opts.config || {}) };
    if (opts && opts.config && opts.config.costs) {
      this.config.costs = { ...DEFAULT_COSTS, ...opts.config.costs };
    }
    this._timer = null;
    this._tickMs = (opts && opts.tickInterval || 60) * 1000;
    this._boosts = [];
    this._resting = false;
    this._restUntil = 0;
    this._starvationMode = false;
    this._peakEnteredAt = 0;
    this._metabolicRate = this.config.metabolicRateBase;
    this._recentOperations = []; // { timestamp, cost } for workload tracking
    ensureDir();
    this._ensureState();
    this._initSSE();
  }

  _initSSE() {
    try {
      const sse = require('./sse-manager');
      this.on('state-change', (d) => sse.broadcastToChannel('metabolism', 'state-change', d));
      this.on('starvation', (d) => sse.broadcastToChannel('metabolism', 'energy-change', d));
      this.on('peak-entered', (d) => sse.broadcastToChannel('metabolism', 'energy-change', d));
      this.on('rest-complete', (d) => sse.broadcastToChannel('metabolism', 'energy-change', d));
    } catch (_) { /* SSE not available */ }
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
      peakCount: 0,
      starvationCount: 0,
      totalBoostsClaimed: 0,
      createdAt: Date.now(),
    };
    this._save();
  }

  _save() { writeJSON(STATE_PATH, this._state); store.flush(NS); }

  // ── Lifecycle ──

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

  // ── Core Energy ──

  getEnergy() {
    const pct = (this._state.energy / this.config.maxEnergy) * 100;
    return {
      energy: this._state.energy,
      max: this.config.maxEnergy,
      percent: Math.round(pct),
      state: this._resolveState(pct),
      fatigue: this._state.fatigue,
      resting: this._resting,
      starvationMode: this._starvationMode,
      metabolicRate: this._metabolicRate,
      timestamp: Date.now(),
    };
  }

  _resolveState(pct) {
    if (pct >= 90) return ENERGY_STATES.PEAK;
    if (pct > 70) return ENERGY_STATES.HIGH;
    if (pct > 30) return ENERGY_STATES.MEDIUM;
    if (pct > 10) return ENERGY_STATES.LOW;
    return ENERGY_STATES.CRITICAL;
  }

  canAfford(amount) {
    const pct = (this._state.energy / this.config.maxEnergy) * 100;
    const state = this._resolveState(pct);
    if (state.label === 'CRITICAL' && amount > 5) return false;
    if (this._starvationMode && amount > 3) return false;
    return this._state.energy >= amount;
  }

  consume(amount, reason) {
    const before = this._state.energy;
    const pctBefore = (before / this.config.maxEnergy) * 100;
    const state = this._resolveState(pctBefore);

    // Starvation mode: reject almost everything
    if (this._starvationMode && amount > 3) {
      this._logHistory('blocked_starvation', { amount, reason, energy: before });
      return { allowed: false, remaining: before, state: 'CRITICAL', reason: 'STARVATION mode — only absolute minimum operations' };
    }

    // CRITICAL triage
    if (state.label === 'CRITICAL' && amount > 5) {
      this._logHistory('blocked', { amount, reason, state: state.label, energy: before });
      return { allowed: false, remaining: before, state: state.label, reason: 'CRITICAL energy' };
    }

    // LOW triage
    if (state.label === 'LOW' && amount > 20) {
      this._logHistory('blocked', { amount, reason, state: state.label, energy: before });
      return { allowed: false, remaining: before, state: state.label, reason: 'LOW energy — user requests only' };
    }

    // Apply fatigue penalty
    const fatigueMult = 1 + (this._state.fatigue / this.config.maxFatigue) * 0.5;
    // Apply metabolic rate
    const actualCost = Math.round(amount * fatigueMult * this._metabolicRate * 100) / 100;

    this._state.energy = clamp(this._state.energy - actualCost, 0, this.config.maxEnergy);
    this._state.cumulativeConsumed += actualCost;

    // Accumulate fatigue
    this._state.fatigue = clamp(this._state.fatigue + actualCost * 0.1, 0, this.config.maxFatigue);

    // Track for workload calculation
    this._recentOperations.push({ timestamp: Date.now(), cost: actualCost });
    this._cleanRecentOperations();

    this._save();

    const after = this._state.energy;
    const pctAfter = (after / this.config.maxEnergy) * 100;
    const newState = this._resolveState(pctAfter);

    this._logHistory('consumed', {
      amount: actualCost, reason,
      fatigueMult: Math.round(fatigueMult * 100) / 100,
      metabolicRate: this._metabolicRate,
      before, after, state: newState.label,
    });

    // State transitions
    if (state.label !== newState.label) {
      console.log(`[METABOLISM] ${state.emoji} → ${newState.emoji} Energy: ${state.label} → ${newState.label} (${Math.round(pctAfter)}%)`);
      this.emit('state-change', { from: state.label, to: newState.label, percent: Math.round(pctAfter) });

      // Enter starvation
      if (newState.label === 'CRITICAL' && this._state.energy <= this.config.starvationThreshold) {
        this._enterStarvation();
      }
    }

    // Check PEAK decay
    if (state.label === 'PEAK' && newState.label !== 'PEAK') {
      this._peakEnteredAt = 0;
    }

    return {
      allowed: true, cost: actualCost, remaining: after,
      percent: Math.round(pctAfter), state: newState.label,
      fatigue: this._state.fatigue, starvationMode: this._starvationMode,
      qualityMultiplier: this._getQualityMultiplier(),
    };
  }

  // ── Starvation Mode ──

  _enterStarvation() {
    if (this._starvationMode) return;
    this._starvationMode = true;
    this._state.starvationCount = (this._state.starvationCount || 0) + 1;
    this._save();
    console.log('[METABOLISM] 💀 STARVATION MODE — extreme conservation active');
    this._logHistory('starvation_enter', { energy: this._state.energy });
    this.emit('starvation', { entered: true, energy: this._state.energy });
  }

  _exitStarvation() {
    if (!this._starvationMode) return;
    this._starvationMode = false;
    console.log('[METABOLISM] 🌱 Exiting starvation mode');
    this._logHistory('starvation_exit', { energy: this._state.energy });
    this.emit('starvation', { entered: false, energy: this._state.energy });
  }

  // ── Regeneration ──

  regenerate() {
    const ts = Date.now();
    const elapsed = (ts - (this._state.lastTickAt || ts)) / (1000 * 60);
    if (elapsed <= 0) return;

    let regenRate = this.config.baseRegenRate;

    // Rest bonus
    if (this._resting) regenRate *= this.config.restRegenMultiplier;

    // Starvation bonus regen
    if (this._starvationMode) regenRate += this.config.starvationRegenBoost;

    // Boost contributions
    this._boosts = this._boosts.filter(b => ts < b.expiresAt);
    for (const b of this._boosts) regenRate += b.amount;

    // Circadian modulation
    const hour = new Date().getHours();
    if (hour >= 0 && hour < 6) regenRate *= 1.5;
    else if (hour >= 22) regenRate *= 1.2;

    // Metabolic memory: if we know this is a peak hour, boost slightly
    const patterns = this.getPatterns();
    if (patterns.peakHour != null) {
      const hourKey = String(hour);
      const hourData = (patterns.hourlyStats || []).find(h => h.hour === hour);
      if (hourData && hourData.avgEnergy && hourData.avgEnergy > 70) regenRate *= 1.1;
    }

    const regen = regenRate * elapsed;
    const before = this._state.energy;
    this._state.energy = clamp(this._state.energy + regen, 0, this.config.maxEnergy);
    this._state.cumulativeRegenerated += (this._state.energy - before);

    // Fatigue recovery
    const fatigueRecovery = this._resting
      ? this.config.fatigueDecayRate * elapsed
      : this.config.fatigueDecayRate * elapsed * 0.2;
    this._state.fatigue = clamp(this._state.fatigue - fatigueRecovery, 0, this.config.maxFatigue);

    // Exit starvation when energy recovers enough
    if (this._starvationMode && this._state.energy > this.config.starvationThreshold * 3) {
      this._exitStarvation();
    }

    // Track PEAK state
    const pct = (this._state.energy / this.config.maxEnergy) * 100;
    if (pct >= 90 && !this._peakEnteredAt) {
      this._peakEnteredAt = ts;
      this._state.peakCount = (this._state.peakCount || 0) + 1;
      console.log('[METABOLISM] 🌟 PEAK state entered!');
      this.emit('peak-entered', { energy: this._state.energy });
    }

    // PEAK naturally decays (can't stay at peak forever)
    if (this._peakEnteredAt && (ts - this._peakEnteredAt > this.config.peakDurationMs)) {
      const peakDecay = 0.5 * elapsed; // gentle decay from peak
      this._state.energy = clamp(this._state.energy - peakDecay, 0, this.config.maxEnergy);
    }

    this._state.lastTickAt = ts;
    this._save();

    return {
      regenerated: Math.round((this._state.energy - before) * 100) / 100,
      energy: this._state.energy, fatigue: this._state.fatigue,
      regenRate: Math.round(regenRate * 100) / 100,
      resting: this._resting, starvationMode: this._starvationMode,
      activeBoosts: this._boosts.length,
    };
  }

  // ── Boosts & Rest ──

  boost(amount, durationMs, label) {
    amount = amount || 5;
    durationMs = durationMs || 30 * 60 * 1000;
    label = label || 'boost';

    const b = { id: uuid(), amount, expiresAt: Date.now() + durationMs, label, createdAt: Date.now() };
    this._boosts.push(b);
    this._state.totalBoostsClaimed = (this._state.totalBoostsClaimed || 0) + 1;
    this._save();

    this._logHistory('boost', { amount, duration: durationMs, label });
    console.log(`[METABOLISM] ☕ Boost: +${amount}/min for ${Math.round(durationMs / 60000)}min (${label})`);

    return { boost: b, activeBoosts: this._boosts.length, note: 'Warning: boost crash — fatigue spikes when expired' };
  }

  rest(durationMs) {
    durationMs = durationMs || 30 * 60 * 1000;
    this._resting = true;
    this._restUntil = Date.now() + durationMs;
    this._state.lastRestAt = Date.now();
    this._state.resting = true;
    this._save();

    this._logHistory('rest_start', { duration: durationMs });
    console.log(`[METABOLISM] 😴 Rest mode for ${Math.round(durationMs / 60000)}min`);

    const timer = setTimeout(() => {
      this._resting = false;
      this._state.resting = false;
      this._save();
      this._logHistory('rest_end', {});
      console.log('[METABOLISM] 🌅 Rest complete');
      this.emit('rest-complete', { energy: this._state.energy, fatigue: this._state.fatigue });
    }, durationMs);
    if (timer.unref) timer.unref();

    return { resting: true, until: this._restUntil, duration: durationMs, regenMultiplier: this.config.restRegenMultiplier };
  }

  feedNutrition(taskId) {
    const bonus = this.config.nutritionBonus;
    this._state.energy = clamp(this._state.energy + bonus, 0, this.config.maxEnergy);
    this._state.totalTasksCompleted++;
    this._save();
    this._logHistory('nutrition', { taskId, bonus, energy: this._state.energy });
    return { fed: bonus, energy: this._state.energy };
  }

  // ── Metabolic Rate Adjustment ──

  _adjustMetabolicRate() {
    if (!this.config.metabolicRateAdaptation) return;

    this._cleanRecentOperations();
    const workload = this._recentOperations.reduce((sum, op) => sum + op.cost, 0);
    const windowMin = this.config.workloadWindowMs / (1000 * 60);
    const opsPerMin = this._recentOperations.length / windowMin;

    // High workload → increase metabolic rate (burn faster but produce more)
    // Low workload → decrease metabolic rate (conserve)
    if (opsPerMin > 2) {
      this._metabolicRate = Math.min(2.0, this.config.metabolicRateBase * 1.3);
    } else if (opsPerMin > 1) {
      this._metabolicRate = this.config.metabolicRateBase * 1.1;
    } else if (opsPerMin < 0.3) {
      this._metabolicRate = Math.max(0.5, this.config.metabolicRateBase * 0.8);
    } else {
      this._metabolicRate = this.config.metabolicRateBase;
    }

    // Starvation forces lowest rate
    if (this._starvationMode) this._metabolicRate = 0.3;
  }

  _cleanRecentOperations() {
    const cutoff = Date.now() - this.config.workloadWindowMs;
    this._recentOperations = this._recentOperations.filter(op => op.timestamp > cutoff);
  }

  // ── Module Energy Allocations ──

  allocateModuleBudget(moduleId, energyPercent) {
    const allocations = readJSON(ALLOCATIONS_PATH, {});
    allocations[moduleId] = {
      percent: clamp(energyPercent, 0, 100),
      consumed: allocations[moduleId]?.consumed || 0,
      updatedAt: Date.now(),
    };

    // Normalize to not exceed 100%
    const total = Object.values(allocations).reduce((s, a) => s + a.percent, 0);
    if (total > 100) {
      const scale = 100 / total;
      for (const a of Object.values(allocations)) a.percent = Math.round(a.percent * scale);
    }

    writeJSON(ALLOCATIONS_PATH, allocations);
    return allocations;
  }

  getModuleAllocations() { return readJSON(ALLOCATIONS_PATH, {}); }

  consumeModuleBudget(moduleId, amount, reason) {
    const allocations = readJSON(ALLOCATIONS_PATH, {});
    const alloc = allocations[moduleId];
    if (!alloc) return this.consume(amount, `${moduleId}:${reason}`);

    const maxForModule = (alloc.percent / 100) * this.config.maxEnergy;
    if (alloc.consumed + amount > maxForModule) {
      this._logHistory('module_budget_exceeded', { moduleId, amount, consumed: alloc.consumed, max: maxForModule });
      return { allowed: false, remaining: this._state.energy, reason: `Module ${moduleId} exceeded allocation (${alloc.consumed}/${maxForModule})` };
    }

    const result = this.consume(amount, `${moduleId}:${reason}`);
    if (result.allowed) {
      alloc.consumed += amount;
      writeJSON(ALLOCATIONS_PATH, allocations);
    }
    return result;
  }

  resetModuleAllocations() {
    const allocations = readJSON(ALLOCATIONS_PATH, {});
    for (const a of Object.values(allocations)) a.consumed = 0;
    writeJSON(ALLOCATIONS_PATH, allocations);
    return allocations;
  }

  // ── Metabolic State ──

  getMetabolicState() {
    const pct = (this._state.energy / this.config.maxEnergy) * 100;
    const state = this._resolveState(pct);
    const history = readJSON(HISTORY_PATH, []);

    const recent = history.filter(h => h.type === 'consumed' || h.type === 'tick').slice(-10);
    let trend = 'stable';
    if (recent.length >= 3) {
      const first = recent[0].energy || recent[0].data?.after || 0;
      const last = recent[recent.length - 1].energy || recent[recent.length - 1].data?.after || 0;
      if (last > first + 5) trend = 'rising';
      else if (last < first - 5) trend = 'falling';
    }

    return {
      energy: this._state.energy, max: this.config.maxEnergy,
      percent: Math.round(pct), state: state.label, stateInfo: state,
      fatigue: this._state.fatigue,
      fatiguePercent: Math.round((this._state.fatigue / this.config.maxFatigue) * 100),
      qualityMultiplier: this._getQualityMultiplier(),
      resting: this._resting, restUntil: this._resting ? this._restUntil : null,
      starvationMode: this._starvationMode,
      metabolicRate: this._metabolicRate,
      activeBoosts: this._boosts.filter(b => Date.now() < b.expiresAt).map(b => ({
        label: b.label, amount: b.amount, remaining: b.expiresAt - Date.now(),
      })),
      trend, regenRate: this.config.baseRegenRate,
      cumulativeConsumed: Math.round(this._state.cumulativeConsumed),
      cumulativeRegenerated: Math.round(this._state.cumulativeRegenerated),
      totalTasksCompleted: this._state.totalTasksCompleted,
      peakCount: this._state.peakCount || 0,
      starvationCount: this._state.starvationCount || 0,
      moduleAllocations: this.getModuleAllocations(),
      currentWorkload: this._getCurrentWorkload(),
      timestamp: Date.now(),
    };
  }

  _getQualityMultiplier() {
    const fatiguePenalty = (this._state.fatigue / this.config.maxFatigue) * this.config.fatigueQualityPenalty;
    // PEAK bonus
    const pct = (this._state.energy / this.config.maxEnergy) * 100;
    const peakBonus = pct >= 90 ? 0.1 : 0;
    // Starvation penalty
    const starvPenalty = this._starvationMode ? 0.3 : 0;
    return Math.round(Math.max(0.1, 1 - fatiguePenalty + peakBonus - starvPenalty) * 100) / 100;
  }

  _getCurrentWorkload() {
    this._cleanRecentOperations();
    const windowMin = this.config.workloadWindowMs / (1000 * 60);
    return {
      operations: this._recentOperations.length,
      totalCost: Math.round(this._recentOperations.reduce((s, op) => s + op.cost, 0) * 100) / 100,
      opsPerMinute: Math.round(this._recentOperations.length / windowMin * 100) / 100,
      windowMinutes: windowMin,
    };
  }

  // ── Triage ──

  getTriageLevel() {
    const pct = (this._state.energy / this.config.maxEnergy) * 100;
    const state = this._resolveState(pct);

    const allowed = {
      PEAK:     { all: true, experiments: true, creativity: true, exploration: true, selfImprovement: true, maxQuality: true },
      HIGH:     { all: true, experiments: true, creativity: true, exploration: true, selfImprovement: true },
      MEDIUM:   { all: false, experiments: false, creativity: true, exploration: false, selfImprovement: false, coreOnly: true },
      LOW:      { all: false, experiments: false, creativity: false, exploration: false, selfImprovement: false, userRequestsOnly: true, criticalMaintenance: true },
      CRITICAL: { all: false, experiments: false, creativity: false, exploration: false, selfImprovement: false, userRequestsOnly: true, bareMinimum: true, starvation: this._starvationMode },
    };

    return {
      state: state.label, emoji: state.emoji, description: state.description,
      percent: Math.round(pct),
      allowed: allowed[state.label] || allowed.CRITICAL,
      qualityMultiplier: this._getQualityMultiplier(),
      starvationMode: this._starvationMode,
      metabolicRate: this._metabolicRate,
    };
  }

  // ── Energy Budgets ──

  allocateBudget(taskId, amount) {
    const budgets = readJSON(BUDGETS_PATH, {});
    budgets[taskId] = { allocated: amount, consumed: 0, createdAt: Date.now(), status: 'active' };
    writeJSON(BUDGETS_PATH, budgets);
    this._logHistory('budget_allocated', { taskId, amount });
    return { taskId, allocated: amount, remaining: amount };
  }

  getBudget(taskId) {
    const budgets = readJSON(BUDGETS_PATH, {});
    const b = budgets[taskId];
    if (!b) return { taskId, error: 'No budget' };
    return {
      taskId, allocated: b.allocated, consumed: b.consumed,
      remaining: b.allocated - b.consumed,
      percent: Math.round(((b.allocated - b.consumed) / b.allocated) * 100),
      status: b.status, overBudget: b.consumed > b.allocated,
    };
  }

  consumeBudget(taskId, amount, reason) {
    const budgets = readJSON(BUDGETS_PATH, {});
    const b = budgets[taskId];
    if (!b) return { taskId, error: 'No budget' };

    b.consumed += amount;
    const remaining = b.allocated - b.consumed;
    if (remaining <= 0) { b.status = 'exceeded'; console.log(`[METABOLISM] ⚠️ Task ${taskId} exceeded budget`); }
    else if (remaining < b.allocated * 0.2) b.status = 'warning';

    writeJSON(BUDGETS_PATH, budgets);
    const result = this.consume(amount, `budget:${taskId} — ${reason || ''}`);

    return {
      ...result,
      budget: { taskId, allocated: b.allocated, consumed: b.consumed, remaining: Math.max(0, remaining), status: b.status, overBudget: b.consumed > b.allocated },
    };
  }

  closeBudget(taskId) {
    const budgets = readJSON(BUDGETS_PATH, {});
    const b = budgets[taskId];
    if (!b) return { taskId, error: 'No budget' };
    b.status = 'closed';
    b.closedAt = Date.now();
    writeJSON(BUDGETS_PATH, budgets);
    return { taskId, final: b };
  }

  // ── History & Patterns ──

  getHistory(hours) {
    hours = hours || 24;
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    return readJSON(HISTORY_PATH, []).filter(h => h.timestamp >= cutoff).reverse();
  }

  _logHistory(type, data) {
    const history = readJSON(HISTORY_PATH, []);
    history.push({ type, data, energy: this._state.energy, fatigue: this._state.fatigue, timestamp: Date.now() });
    if (history.length > this.config.historyMaxEntries) history.splice(0, history.length - this.config.historyMaxEntries);
    writeJSON(HISTORY_PATH, history);
  }

  analyzePatterns() {
    const history = readJSON(HISTORY_PATH, []);
    const cutoff = Date.now() - this.config.patternWindowHours * 60 * 60 * 1000;
    const recent = history.filter(h => h.timestamp >= cutoff);

    const hourBuckets = {};
    for (let h = 0; h < 24; h++) hourBuckets[h] = { consumption: 0, samples: 0, energySum: 0, taskCount: 0 };

    for (const entry of recent) {
      const hour = new Date(entry.timestamp).getHours();
      const bucket = hourBuckets[hour];
      bucket.samples++;
      bucket.energySum += (entry.energy || 0);
      if (entry.type === 'consumed' && entry.data) bucket.consumption += (entry.data.amount || 0);
      if (entry.type === 'nutrition') bucket.taskCount++;
    }

    const hourlyStats = [];
    for (let h = 0; h < 24; h++) {
      const b = hourBuckets[h];
      hourlyStats.push({
        hour: h,
        avgEnergy: b.samples > 0 ? Math.round(b.energySum / b.samples) : null,
        totalConsumption: Math.round(b.consumption),
        taskCompletions: b.taskCount,
        samples: b.samples,
        productivity: b.taskCount > 0 && b.consumption > 0 ? Math.round((b.taskCount / b.consumption) * 1000) / 1000 : null,
      });
    }

    const withData = hourlyStats.filter(h => h.samples > 0);
    const peakHour = withData.length > 0 ? withData.reduce((a, b) => (a.avgEnergy || 0) > (b.avgEnergy || 0) ? a : b) : null;
    const troughHour = withData.length > 0 ? withData.reduce((a, b) => (a.avgEnergy || 0) < (b.avgEnergy || 0) ? a : b) : null;
    const mostProductiveHour = withData.filter(h => h.productivity != null).length > 0
      ? withData.filter(h => h.productivity != null).reduce((a, b) => (a.productivity || 0) > (b.productivity || 0) ? a : b) : null;

    const patterns = {
      hourlyStats, peakHour: peakHour ? peakHour.hour : null,
      troughHour: troughHour ? troughHour.hour : null,
      mostProductiveHour: mostProductiveHour ? mostProductiveHour.hour : null,
      totalSamples: recent.length, windowHours: this.config.patternWindowHours,
      recommendedRestHours: troughHour ? [troughHour.hour, (troughHour.hour + 1) % 24] : [],
      recommendedWorkHours: peakHour ? [peakHour.hour, (peakHour.hour + 1) % 24, (peakHour.hour + 2) % 24] : [],
      analyzedAt: Date.now(),
    };

    writeJSON(PATTERNS_PATH, patterns);
    return patterns;
  }

  getPatterns() {
    return readJSON(PATTERNS_PATH, { hourlyStats: [], note: 'Run analyzePatterns() first' });
  }

  // ── Tick ──

  tick() {
    const ts = Date.now();

    // Rest expiry
    if (this._resting && ts >= this._restUntil) {
      this._resting = false;
      this._state.resting = false;
    }

    // Boost expiry with crash
    const expired = this._boosts.filter(b => ts >= b.expiresAt);
    this._boosts = this._boosts.filter(b => ts < b.expiresAt);
    for (const b of expired) {
      const crashFatigue = b.amount * 2;
      this._state.fatigue = clamp(this._state.fatigue + crashFatigue, 0, this.config.maxFatigue);
      // Energy crash too
      const energyCrash = b.amount * 0.5;
      this._state.energy = clamp(this._state.energy - energyCrash, 0, this.config.maxEnergy);
      console.log(`[METABOLISM] 💥 Boost crash: "${b.label}" → +${crashFatigue} fatigue, -${energyCrash} energy`);
      this._logHistory('boost_crash', { label: b.label, fatigue: crashFatigue, energyCrash });
    }

    // Adjust metabolic rate based on workload
    this._adjustMetabolicRate();

    // Regenerate
    const regen = this.regenerate();

    // Periodic pattern analysis (every 100 ticks)
    if (this._state.totalTasksCompleted > 0 && this._state.totalTasksCompleted % 100 === 0) {
      this.analyzePatterns();
    }

    // Reset module allocations daily
    const lastReset = this._state._lastAllocReset || 0;
    if (ts - lastReset > 24 * 60 * 60 * 1000) {
      this.resetModuleAllocations();
      this._state._lastAllocReset = ts;
    }

    this._logHistory('tick', {
      energy: this._state.energy, fatigue: this._state.fatigue,
      resting: this._resting, boosts: this._boosts.length,
      metabolicRate: this._metabolicRate, starvation: this._starvationMode,
    });

    this._save();
    return regen;
  }

  // ── Cost Lookup ──

  getCost(operationType) { return this.config.costs[operationType] || null; }
  getCosts() { return { ...this.config.costs }; }

  setCost(operationType, cost) {
    this.config.costs[operationType] = cost;
    return this.config.costs;
  }
}

module.exports = CognitiveMetabolism;
