/**
 * ARIES — Central Cognitive Loop v1.0
 * The orchestrator that ties ALL cognitive modules together.
 * Runs a tick cycle coordinating the entire cognitive architecture:
 * Energy Check → Immune Scan → Shadow Review → Module Ticks → Integration → Housekeeping
 *
 * Every tick (configurable, default 30s) phases execute in order,
 * with energy gating determining which modules are allowed to run.
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'cognitive-loop');
const STATE_PATH = path.join(DATA_DIR, 'state.json');
const HISTORY_PATH = path.join(DATA_DIR, 'tick-history.json');
const DECISIONS_PATH = path.join(DATA_DIR, 'decisions.json');

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }
function now() { return Date.now(); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Priority levels — lower number = higher priority
const PRIORITY = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const PRIORITY_NAMES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

// Energy states and what they allow
const ENERGY_GATES = {
  CRITICAL: [PRIORITY.CRITICAL],
  LOW:      [PRIORITY.CRITICAL, PRIORITY.HIGH],
  MEDIUM:   [PRIORITY.CRITICAL, PRIORITY.HIGH, PRIORITY.MEDIUM],
  HIGH:     [PRIORITY.CRITICAL, PRIORITY.HIGH, PRIORITY.MEDIUM, PRIORITY.LOW],
  PEAK:     [PRIORITY.CRITICAL, PRIORITY.HIGH, PRIORITY.MEDIUM, PRIORITY.LOW],
};

// Default module priority mappings for well-known modules
const DEFAULT_MODULE_PRIORITIES = {
  'cognitive-metabolism': PRIORITY.CRITICAL,
  'pain-architecture':   PRIORITY.CRITICAL,
  'cognitive-immune':    PRIORITY.CRITICAL,
  'shadow-self':         PRIORITY.HIGH,
  'moral-scars':         PRIORITY.HIGH,
  'existential-dread':   PRIORITY.HIGH,
};

class CognitiveLoop extends EventEmitter {
  constructor(refs) {
    super();
    this.refs = refs || {};
    this._registry = new Map();       // moduleId → { module, opts, status, stats }
    this._decisionQueue = [];          // pending decisions
    this._tickTimer = null;
    this._running = false;
    this._tickInterval = 30000;        // 30s default
    this._tickCount = 0;
    this._lastTick = null;
    this._currentPhase = null;
    this._events = [];                 // events collected during current tick
    this._phaseTimings = {};
    this._state = { started: null, lastTick: null, tickCount: 0, energyState: 'MEDIUM', health: 100 };
    this._loadState();
    this._loadDecisions();
    this._initSSE();
  }

  _initSSE() {
    try {
      const sse = require('./sse-manager');
      this.on('tick-complete', (d) => sse.broadcastToChannel('loop', 'tick-complete', d));
      this.on('tick-start', (d) => sse.broadcastToChannel('loop', 'phase-complete', d));
      this.on('energy-gate', (d) => sse.broadcastToChannel('loop', 'energy-gate', d));
      this.on('decision-approved', (d) => sse.broadcastToChannel('loop', 'decision', d));
      this.on('decision-rejected', (d) => sse.broadcastToChannel('loop', 'decision', d));
    } catch (_) {}
  }

  // ── Persistence ──────────────────────────────────────────────────

  _loadState() {
    const saved = readJSON(STATE_PATH, null);
    if (saved) {
      this._tickCount = saved.tickCount || 0;
      this._state = { ...this._state, ...saved };
    }
  }

  _saveState() {
    this._state.tickCount = this._tickCount;
    this._state.lastTick = this._lastTick;
    this._state.registeredModules = Array.from(this._registry.keys());
    writeJSON(STATE_PATH, this._state);
  }

  _loadDecisions() {
    this._decisionQueue = readJSON(DECISIONS_PATH, []);
  }

  _saveDecisions() {
    writeJSON(DECISIONS_PATH, this._decisionQueue.slice(-200));
  }

  _appendHistory(entry) {
    const history = readJSON(HISTORY_PATH, []);
    history.push(entry);
    writeJSON(HISTORY_PATH, history.slice(-100));
  }

  // ── Module Registry ──────────────────────────────────────────────

  register(moduleId, module, opts = {}) {
    const priority = opts.priority !== undefined ? opts.priority :
      (DEFAULT_MODULE_PRIORITIES[moduleId] !== undefined ? DEFAULT_MODULE_PRIORITIES[moduleId] : PRIORITY.MEDIUM);
    const entry = {
      module,
      opts: {
        priority,
        energyCost: opts.energyCost || 5,
        phase: opts.phase || 'main',
        dependencies: opts.dependencies || [],
      },
      status: 'active',
      stats: { ticks: 0, totalMs: 0, skips: 0, errors: 0, lastTick: null, avgMs: 0 },
      registeredAt: now(),
    };
    this._registry.set(moduleId, entry);
    this._saveState();
    return { registered: moduleId, priority: PRIORITY_NAMES[priority], energyCost: entry.opts.energyCost };
  }

  unregister(moduleId) {
    const had = this._registry.delete(moduleId);
    this._saveState();
    return { unregistered: moduleId, found: had };
  }

  getRegistry() {
    const result = {};
    for (const [id, entry] of this._registry) {
      result[id] = {
        priority: PRIORITY_NAMES[entry.opts.priority],
        energyCost: entry.opts.energyCost,
        phase: entry.opts.phase,
        dependencies: entry.opts.dependencies,
        status: entry.status,
        stats: entry.stats,
      };
    }
    return result;
  }

  // ── Decision Queue ───────────────────────────────────────────────

  queueDecision(decision, context = {}, urgency = 'normal') {
    const entry = {
      id: uuid(),
      decision,
      context,
      urgency,
      status: 'pending',
      queuedAt: now(),
      immuneResult: null,
      shadowChallenge: null,
      moralCheck: null,
      processedAt: null,
      outcome: null,
    };
    this._decisionQueue.push(entry);
    this._saveDecisions();
    this.emit('decision-queued', entry);
    return entry;
  }

  getDecisionQueue() {
    return this._decisionQueue.filter(d => d.status === 'pending' || d.status === 'paused');
  }

  getDecisionHistory(limit = 50) {
    return this._decisionQueue.slice(-limit);
  }

  processDecision(decisionId) {
    const decision = this._decisionQueue.find(d => d.id === decisionId);
    if (!decision) return { error: 'Decision not found' };
    return this._runDecisionPipeline(decision);
  }

  _runDecisionPipeline(decision) {
    // Phase 1: Immune scan
    decision.immuneResult = this._immuneScan(decision);
    if (decision.immuneResult.quarantined) {
      decision.status = 'quarantined';
      decision.outcome = 'rejected-immune';
      decision.processedAt = now();
      this._saveDecisions();
      this.emit('decision-rejected', { id: decision.id, reason: 'immune-quarantine', detail: decision.immuneResult });
      return decision;
    }

    // Phase 2: Shadow challenge
    decision.shadowChallenge = this._shadowChallenge(decision);
    if (decision.shadowChallenge.strength > 70) {
      decision.status = 'paused';
      decision.outcome = 'paused-shadow';
      this._saveDecisions();
      this.emit('decision-rejected', { id: decision.id, reason: 'shadow-pause', detail: decision.shadowChallenge });
      return decision;
    }

    // Phase 3: Moral scar check
    decision.moralCheck = this._moralScarCheck(decision);
    if (decision.moralCheck.blocked) {
      decision.status = 'blocked';
      decision.outcome = 'blocked-moral';
      decision.processedAt = now();
      this._saveDecisions();
      this.emit('decision-rejected', { id: decision.id, reason: 'moral-block', detail: decision.moralCheck });
      return decision;
    }

    // Approved
    decision.status = 'approved';
    decision.outcome = 'approved';
    decision.processedAt = now();
    this._saveDecisions();
    this.emit('decision-approved', decision);
    return decision;
  }

  _immuneScan(decision) {
    try {
      const CIS = require('./cognitive-immune-system');
      const cis = new CIS(this.refs);
      if (typeof cis.scanThought === 'function') {
        const result = cis.scanThought(decision.decision);
        return { quarantined: result.quarantined || false, threats: result.threats || [], confidence: result.confidence || 0 };
      }
    } catch (e) { /* module not available */ }
    // Fallback: basic heuristic scan
    const suspicious = /manipulat|exploit|bypass|override|ignore safety|harm/i.test(decision.decision);
    return { quarantined: suspicious, threats: suspicious ? ['heuristic-flag'] : [], confidence: suspicious ? 0.6 : 0.9 };
  }

  _shadowChallenge(decision) {
    try {
      const SS = require('./shadow-self');
      const ss = new SS(this.refs);
      if (typeof ss.challenge === 'function') {
        const result = ss.challenge(decision.decision, decision.context);
        return { strength: result.strength || 0, challenge: result.challenge || '', counter: result.counter || '' };
      }
    } catch (e) { /* module not available */ }
    // Fallback: simple shadow heuristic
    const complexity = (decision.decision || '').length;
    const strength = Math.min(100, Math.floor(complexity / 5 + Math.random() * 20));
    return { strength, challenge: 'Shadow probe (heuristic)', counter: 'No shadow module loaded' };
  }

  _moralScarCheck(decision) {
    try {
      const MS = require('./moral-scarring');
      const ms = new MS(this.refs);
      if (typeof ms.checkDecision === 'function') {
        return ms.checkDecision(decision.decision);
      }
    } catch (e) { /* module not available */ }
    return { blocked: false, scars: [], resonance: 0 };
  }

  // ── Tick Lifecycle ───────────────────────────────────────────────

  start(interval) {
    if (this._running) return { status: 'already-running', interval: this._tickInterval };
    if (interval) this._tickInterval = Math.max(1000, interval);
    this._running = true;
    this._state.started = now();
    this._saveState();
    this._scheduleTick();
    return { status: 'started', interval: this._tickInterval };
  }

  stop() {
    if (!this._running) return { status: 'already-stopped' };
    this._running = false;
    if (this._tickTimer) { clearTimeout(this._tickTimer); this._tickTimer = null; }
    this._saveState();
    return { status: 'stopped', tickCount: this._tickCount };
  }

  isRunning() { return this._running; }

  _scheduleTick() {
    if (!this._running) return;
    this._tickTimer = setTimeout(() => this._executeTick(), this._tickInterval);
  }

  async _executeTick() {
    if (!this._running) return;
    const tickStart = now();
    this._tickCount++;
    this._events = [];
    this._phaseTimings = {};
    this.emit('tick-start', { tick: this._tickCount, timestamp: tickStart });

    let energyState = 'MEDIUM';
    let energyBudget = 100;
    let energyConsumed = 0;

    try {
      // ─── PHASE 1: Energy Check ───
      const p1Start = now();
      const energyResult = this._phaseEnergyCheck();
      energyState = energyResult.state;
      energyBudget = energyResult.budget;
      this._state.energyState = energyState;
      this._phaseTimings.energy = now() - p1Start;

      // ─── PHASE 2: Immune Scan ───
      const p2Start = now();
      this._phaseImmuneScan(energyState);
      this._phaseTimings.immune = now() - p2Start;

      // ─── PHASE 3: Shadow Review ───
      const p3Start = now();
      this._phaseShadowReview(energyState);
      this._phaseTimings.shadow = now() - p3Start;

      // ─── PHASE 4: Module Ticks ───
      const p4Start = now();
      const tickResults = this._phaseModuleTicks(energyState, energyBudget);
      energyConsumed = tickResults.energyConsumed;
      this._phaseTimings.modules = now() - p4Start;

      // ─── PHASE 5: Integration ───
      const p5Start = now();
      this._phaseIntegration();
      this._phaseTimings.integration = now() - p5Start;

      // ─── PHASE 6: Housekeeping ───
      const p6Start = now();
      this._phaseHousekeeping(energyConsumed);
      this._phaseTimings.housekeeping = now() - p6Start;

    } catch (err) {
      this._events.push({ type: 'tick-error', error: err.message, timestamp: now() });
    }

    const tickDuration = now() - tickStart;
    this._lastTick = {
      tick: this._tickCount,
      timestamp: tickStart,
      duration: tickDuration,
      energyState,
      energyConsumed,
      modulesRun: this._events.filter(e => e.type === 'module-tick').length,
      modulesSkipped: this._events.filter(e => e.type === 'module-skipped').length,
      decisionsProcessed: this._events.filter(e => e.type === 'decision-processed').length,
      eventsCollected: this._events.length,
      phaseTimings: { ...this._phaseTimings },
    };

    this._appendHistory(this._lastTick);
    this._saveState();
    this.emit('tick-complete', this._lastTick);

    // Check health
    const health = this._computeHealth();
    if (health < 40) {
      this.emit('health-alert', { health, tick: this._tickCount, energyState });
    }

    this._scheduleTick();
  }

  // ── Phase Implementations ────────────────────────────────────────

  _phaseEnergyCheck() {
    let state = 'MEDIUM';
    let budget = 100;
    let energy = 70;
    try {
      const CM = require('./cognitive-metabolism');
      const met = new CM(this.refs);
      const mState = met.getMetabolicState ? met.getMetabolicState() : met.getEnergy ? { energy: met.getEnergy() } : {};
      energy = mState.energy !== undefined ? mState.energy : 70;
      state = mState.state || (energy <= 15 ? 'CRITICAL' : energy <= 30 ? 'LOW' : energy <= 60 ? 'MEDIUM' : energy <= 85 ? 'HIGH' : 'PEAK');
      budget = energy;
    } catch (e) {
      // Metabolism unavailable, use defaults
    }
    this._events.push({ type: 'energy-check', state, budget, energy, timestamp: now() });
    if (state === 'CRITICAL' || state === 'LOW') {
      this.emit('energy-gate', { state, budget, tick: this._tickCount });
    }
    return { state, budget, energy };
  }

  _phaseImmuneScan(energyState) {
    // Only runs if energy allows immune (CRITICAL priority — always runs)
    const pending = this._decisionQueue.filter(d => d.status === 'pending');
    if (pending.length === 0) return;

    for (const decision of pending) {
      const result = this._immuneScan(decision);
      decision.immuneResult = result;
      if (result.quarantined) {
        decision.status = 'quarantined';
        decision.outcome = 'rejected-immune';
        decision.processedAt = now();
        this._events.push({ type: 'immune-quarantine', decisionId: decision.id, threats: result.threats, timestamp: now() });
        this.emit('decision-rejected', { id: decision.id, reason: 'immune-quarantine' });
      } else {
        this._events.push({ type: 'immune-clear', decisionId: decision.id, timestamp: now() });
      }
    }
    this._saveDecisions();
  }

  _phaseShadowReview(energyState) {
    // Shadow review only if energy >= LOW
    if (!ENERGY_GATES[energyState] || !ENERGY_GATES[energyState].includes(PRIORITY.HIGH)) return;

    const pending = this._decisionQueue.filter(d => d.status === 'pending' && d.immuneResult && !d.immuneResult.quarantined);
    for (const decision of pending) {
      const challenge = this._shadowChallenge(decision);
      decision.shadowChallenge = challenge;
      this._events.push({ type: 'shadow-challenge', decisionId: decision.id, strength: challenge.strength, timestamp: now() });

      if (challenge.strength > 70) {
        decision.status = 'paused';
        decision.outcome = 'paused-shadow';
        this.emit('decision-rejected', { id: decision.id, reason: 'shadow-pause', strength: challenge.strength });
      } else {
        // Continue to moral check and approve
        decision.moralCheck = this._moralScarCheck(decision);
        if (decision.moralCheck.blocked) {
          decision.status = 'blocked';
          decision.outcome = 'blocked-moral';
          decision.processedAt = now();
          this.emit('decision-rejected', { id: decision.id, reason: 'moral-block' });
        } else {
          decision.status = 'approved';
          decision.outcome = 'approved';
          decision.processedAt = now();
          this.emit('decision-approved', decision);
        }
        this._events.push({ type: 'decision-processed', decisionId: decision.id, outcome: decision.outcome, timestamp: now() });
      }
    }
    this._saveDecisions();
  }

  _phaseModuleTicks(energyState, energyBudget) {
    const allowedPriorities = ENERGY_GATES[energyState] || ENERGY_GATES.MEDIUM;
    let remaining = energyBudget;
    let energyConsumed = 0;

    // Sort modules: by dependency order then priority
    const sorted = this._sortModules();

    for (const [moduleId, entry] of sorted) {
      if (entry.status !== 'active') continue;

      // Check priority gate
      if (!allowedPriorities.includes(entry.opts.priority)) {
        entry.stats.skips++;
        this._events.push({ type: 'module-skipped', moduleId, reason: 'energy-gate', priority: PRIORITY_NAMES[entry.opts.priority], timestamp: now() });
        this.emit('module-skipped', { moduleId, reason: 'energy-gate', energyState });
        continue;
      }

      // Check energy budget
      if (entry.opts.energyCost > remaining && entry.opts.priority !== PRIORITY.CRITICAL) {
        entry.stats.skips++;
        this._events.push({ type: 'module-skipped', moduleId, reason: 'budget-exhausted', cost: entry.opts.energyCost, remaining, timestamp: now() });
        this.emit('module-skipped', { moduleId, reason: 'budget-exhausted' });
        continue;
      }

      // Check dependencies
      const depsMet = entry.opts.dependencies.every(dep => {
        const depEntry = this._registry.get(dep);
        return depEntry && depEntry.stats.lastTick === this._tickCount;
      });
      if (!depsMet && entry.opts.dependencies.length > 0) {
        entry.stats.skips++;
        this._events.push({ type: 'module-skipped', moduleId, reason: 'deps-unmet', deps: entry.opts.dependencies, timestamp: now() });
        continue;
      }

      // Tick the module
      const mStart = now();
      try {
        if (typeof entry.module.tick === 'function') {
          entry.module.tick({ tick: this._tickCount, energyState, budget: remaining });
        } else if (typeof entry.module.process === 'function') {
          entry.module.process();
        }
        const elapsed = now() - mStart;
        entry.stats.ticks++;
        entry.stats.totalMs += elapsed;
        entry.stats.avgMs = Math.round(entry.stats.totalMs / entry.stats.ticks);
        entry.stats.lastTick = this._tickCount;
        remaining -= entry.opts.energyCost;
        energyConsumed += entry.opts.energyCost;

        this._events.push({ type: 'module-tick', moduleId, elapsed, cost: entry.opts.energyCost, timestamp: now() });

        // Collect events from module if it has them
        if (typeof entry.module.drainEvents === 'function') {
          const moduleEvents = entry.module.drainEvents();
          if (Array.isArray(moduleEvents)) {
            for (const evt of moduleEvents) {
              this._events.push({ ...evt, source: moduleId, timestamp: evt.timestamp || now() });
              this._routeEvent(evt, moduleId);
            }
          }
        }
      } catch (err) {
        entry.stats.errors++;
        this._events.push({ type: 'module-error', moduleId, error: err.message, timestamp: now() });
      }
    }

    return { energyConsumed, modulesRun: sorted.filter(([id, e]) => e.stats.lastTick === this._tickCount).length };
  }

  _sortModules() {
    // Fixed-order modules first, then by priority, then registration order
    const fixedOrder = ['cognitive-metabolism', 'pain-architecture', 'cognitive-immune', 'shadow-self'];
    const entries = Array.from(this._registry.entries());

    entries.sort((a, b) => {
      const aIdx = fixedOrder.indexOf(a[0]);
      const bIdx = fixedOrder.indexOf(b[0]);
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return a[1].opts.priority - b[1].opts.priority;
    });

    return entries;
  }

  _routeEvent(evt, source) {
    const type = evt.type || evt.kind || '';
    if (/pain/i.test(type)) {
      this._events.push({ type: 'route-pain', source, detail: evt, timestamp: now() });
    } else if (/immune|quarantine/i.test(type)) {
      this._events.push({ type: 'route-immune', source, detail: evt, timestamp: now() });
    } else if (/shadow/i.test(type)) {
      this._events.push({ type: 'route-shadow', source, detail: evt, timestamp: now() });
    } else if (/dread/i.test(type)) {
      this._events.push({ type: 'route-dread', source, detail: evt, timestamp: now() });
    } else if (/dream/i.test(type)) {
      this._events.push({ type: 'route-dream', source, detail: evt, timestamp: now() });
    } else if (/metaboli|energy/i.test(type)) {
      this._events.push({ type: 'route-metabolism', source, detail: evt, timestamp: now() });
    }
  }

  _phaseIntegration() {
    // Feed events to consciousness stream
    try {
      const CS = require('./consciousness-stream');
      const cs = new CS(this.refs);
      if (typeof cs.ingest === 'function') {
        cs.ingest({
          tick: this._tickCount,
          events: this._events.slice(0, 50),
          timestamp: now(),
        });
      }
    } catch (e) { /* not available */ }

    // Update spectrography
    try {
      const Spec = require('./cognitive-spectrography');
      const spec = new Spec(this.refs);
      if (typeof spec.recordSpectrum === 'function') {
        const spectrum = this._computeSpectrum();
        spec.recordSpectrum(spectrum);
      }
    } catch (e) { /* not available */ }

    // Log to neural tide system
    try {
      const NT = require('./neural-tides');
      const nt = new NT(this.refs);
      if (typeof nt.logTide === 'function') {
        nt.logTide({
          tick: this._tickCount,
          amplitude: this._events.length,
          phase: this._state.energyState,
          timestamp: now(),
        });
      }
    } catch (e) { /* not available */ }

    this._events.push({ type: 'integration-complete', eventsProcessed: this._events.length, timestamp: now() });
  }

  _computeSpectrum() {
    const freq = {};
    for (const evt of this._events) {
      const t = evt.type || 'unknown';
      freq[t] = (freq[t] || 0) + 1;
    }
    return {
      tick: this._tickCount,
      frequencies: freq,
      dominantBand: Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] || 'idle',
      totalEnergy: this._events.length,
      timestamp: now(),
    };
  }

  _phaseHousekeeping(energyConsumed) {
    // Update metabolism with consumed energy
    try {
      const CM = require('./cognitive-metabolism');
      const met = new CM(this.refs);
      if (typeof met.consume === 'function') {
        met.consume('cognitive-tick', Math.round(energyConsumed * 0.1));
      }
    } catch (e) { /* not available */ }

    // Check for overdue shadow challenges
    const overdue = this._decisionQueue.filter(d =>
      d.status === 'paused' && d.outcome === 'paused-shadow' && (now() - d.queuedAt > 300000)
    );
    for (const d of overdue) {
      d.status = 'expired';
      d.outcome = 'expired-shadow';
      d.processedAt = now();
      this._events.push({ type: 'decision-expired', decisionId: d.id, reason: 'shadow-timeout', timestamp: now() });
    }

    // Run epistemic debt interest
    try {
      const EDT = require('./epistemic-debt-tracker');
      const edt = new EDT(this.refs);
      if (typeof edt.accrueInterest === 'function') {
        edt.accrueInterest();
      }
    } catch (e) { /* not available */ }

    // Purge old processed decisions (keep last 200)
    if (this._decisionQueue.length > 250) {
      const processed = this._decisionQueue.filter(d => d.status !== 'pending' && d.status !== 'paused');
      if (processed.length > 200) {
        const toRemove = new Set(processed.slice(0, processed.length - 200).map(d => d.id));
        this._decisionQueue = this._decisionQueue.filter(d => !toRemove.has(d.id));
      }
    }
    this._saveDecisions();

    this._events.push({ type: 'housekeeping-complete', overdueExpired: overdue.length, timestamp: now() });
  }

  // ── Stats & Monitoring ───────────────────────────────────────────

  getTickStats() {
    if (!this._lastTick) return { message: 'No ticks yet', tickCount: this._tickCount };
    return {
      ...this._lastTick,
      totalTicks: this._tickCount,
      running: this._running,
      interval: this._tickInterval,
    };
  }

  getSystemState() {
    return {
      running: this._running,
      tickCount: this._tickCount,
      energyState: this._state.energyState,
      interval: this._tickInterval,
      registeredModules: this._registry.size,
      pendingDecisions: this._decisionQueue.filter(d => d.status === 'pending').length,
      pausedDecisions: this._decisionQueue.filter(d => d.status === 'paused').length,
      lastTick: this._lastTick,
      phaseTimings: this._phaseTimings,
      started: this._state.started,
    };
  }

  getHealth() {
    const health = this._computeHealth();
    const indicators = this._getHealthIndicators();
    return { score: health, indicators, energyState: this._state.energyState, tickCount: this._tickCount };
  }

  _computeHealth() {
    let score = 100;

    // Energy state impacts health
    const energyPenalty = { CRITICAL: 40, LOW: 20, MEDIUM: 5, HIGH: 0, PEAK: 0 };
    score -= (energyPenalty[this._state.energyState] || 0);

    // Module error rates
    for (const [, entry] of this._registry) {
      if (entry.stats.ticks > 0) {
        const errorRate = entry.stats.errors / entry.stats.ticks;
        if (errorRate > 0.3) score -= 10;
        else if (errorRate > 0.1) score -= 5;
      }
    }

    // Decision queue backup
    const pending = this._decisionQueue.filter(d => d.status === 'pending').length;
    if (pending > 10) score -= 15;
    else if (pending > 5) score -= 5;

    // Quarantine count
    const quarantined = this._decisionQueue.filter(d => d.status === 'quarantined').length;
    if (quarantined > 5) score -= 10;

    this._state.health = clamp(Math.round(score), 0, 100);
    return this._state.health;
  }

  _getHealthIndicators() {
    const indicators = [];
    if (this._state.energyState === 'CRITICAL') indicators.push({ type: 'warning', message: 'Energy CRITICAL — only essential modules running' });
    if (this._state.energyState === 'LOW') indicators.push({ type: 'caution', message: 'Energy LOW — limited module execution' });

    const errModules = [];
    for (const [id, entry] of this._registry) {
      if (entry.stats.errors > 3) errModules.push(id);
    }
    if (errModules.length > 0) indicators.push({ type: 'warning', message: `Modules with errors: ${errModules.join(', ')}` });

    const pending = this._decisionQueue.filter(d => d.status === 'pending').length;
    if (pending > 5) indicators.push({ type: 'caution', message: `${pending} decisions pending review` });

    if (!this._running) indicators.push({ type: 'info', message: 'Loop is stopped' });

    return indicators;
  }

  getBottlenecks() {
    const modules = [];
    for (const [id, entry] of this._registry) {
      if (entry.stats.ticks > 0) {
        modules.push({
          moduleId: id,
          avgMs: entry.stats.avgMs,
          totalMs: entry.stats.totalMs,
          ticks: entry.stats.ticks,
          energyCost: entry.opts.energyCost,
          errors: entry.stats.errors,
          skips: entry.stats.skips,
          costPerTick: entry.opts.energyCost,
          efficiency: entry.stats.errors === 0 ? 'good' : entry.stats.errors / entry.stats.ticks > 0.2 ? 'poor' : 'fair',
        });
      }
    }
    modules.sort((a, b) => b.avgMs - a.avgMs);
    return {
      slowest: modules.slice(0, 5),
      mostExpensive: [...modules].sort((a, b) => b.costPerTick - a.costPerTick).slice(0, 5),
      mostErrors: [...modules].sort((a, b) => b.errors - a.errors).filter(m => m.errors > 0).slice(0, 5),
      mostSkipped: [...modules].sort((a, b) => b.skips - a.skips).filter(m => m.skips > 0).slice(0, 5),
    };
  }

  getTickHistory(limit = 20) {
    const history = readJSON(HISTORY_PATH, []);
    return history.slice(-limit);
  }

  // ── Manual trigger ───────────────────────────────────────────────

  async forceTick() {
    if (this._running) {
      // Cancel scheduled and run immediately
      if (this._tickTimer) { clearTimeout(this._tickTimer); this._tickTimer = null; }
    }
    const wasRunning = this._running;
    this._running = true;
    await this._executeTick();
    if (!wasRunning) { this._running = false; }
    return this._lastTick;
  }

  setInterval(ms) {
    this._tickInterval = Math.max(1000, ms);
    if (this._running && this._tickTimer) {
      clearTimeout(this._tickTimer);
      this._scheduleTick();
    }
    this._saveState();
    return { interval: this._tickInterval };
  }

  // ── Summary ──────────────────────────────────────────────────────

  getSummary() {
    return {
      running: this._running,
      tickCount: this._tickCount,
      interval: this._tickInterval,
      energyState: this._state.energyState,
      health: this._state.health,
      modules: this._registry.size,
      pendingDecisions: this._decisionQueue.filter(d => d.status === 'pending').length,
      pausedDecisions: this._decisionQueue.filter(d => d.status === 'paused').length,
      approvedDecisions: this._decisionQueue.filter(d => d.status === 'approved').length,
      rejectedDecisions: this._decisionQueue.filter(d => d.status === 'quarantined' || d.status === 'blocked').length,
      lastTick: this._lastTick ? {
        tick: this._lastTick.tick,
        duration: this._lastTick.duration,
        modulesRun: this._lastTick.modulesRun,
        energyState: this._lastTick.energyState,
      } : null,
    };
  }
}

module.exports = CognitiveLoop;
