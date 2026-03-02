/**
 * ARIES — Phantom Limb
 * Neural plasticity after module loss. When a module dies, others adapt.
 * Tracks phantom signals, rewiring compensation, and recovery stages.
 */

'use strict';

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'neuroplasticity');
const LOSSES_PATH = path.join(DATA_DIR, 'phantom-losses.json');
const REWIRING_PATH = path.join(DATA_DIR, 'phantom-rewiring.json');
const SIGNALS_PATH = path.join(DATA_DIR, 'phantom-signals.json');
const RESILIENCE_PATH = path.join(DATA_DIR, 'phantom-resilience.json');

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }

const STAGES = ['SHOCK', 'PHANTOM', 'REWIRING', 'ADAPTED'];
const STAGE_DURATIONS = { SHOCK: 2, PHANTOM: 5, REWIRING: 10 }; // ticks to advance

class PhantomLimb extends EventEmitter {
  /**
   * @param {object} opts
   * @param {object} opts.ai - AI core module
   * @param {object} opts.config - phantomLimb config section
   */
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null;
    this.config = opts.config || {};
    ensureDir();
  }

  _getLosses() { return readJSON(LOSSES_PATH, {}); }
  _saveLosses(d) { writeJSON(LOSSES_PATH, d); }
  _getSignals() { return readJSON(SIGNALS_PATH, []); }
  _saveSignals(d) { writeJSON(SIGNALS_PATH, d); }
  _getRewiring() { return readJSON(REWIRING_PATH, {}); }
  _saveRewiring(d) { writeJSON(REWIRING_PATH, d); }
  _getResilience() { return readJSON(RESILIENCE_PATH, { score: 50, recoveries: 0, totalLosses: 0, history: [] }); }
  _saveResilience(d) { writeJSON(RESILIENCE_PATH, d); }

  /**
   * Register module loss
   * @param {string} moduleId - identifier of the lost module
   * @param {object} meta - optional metadata (functions, dependencies)
   * @returns {object} loss record
   */
  detectLoss(moduleId, meta = {}) {
    const losses = this._getLosses();
    if (losses[moduleId] && losses[moduleId].stage !== 'ADAPTED') {
      return { error: 'already_tracked', moduleId, stage: losses[moduleId].stage };
    }

    const record = {
      id: uuid(),
      moduleId,
      stage: 'SHOCK',
      ticksInStage: 0,
      functions: meta.functions || [],
      dependencies: meta.dependencies || [],
      lostAt: Date.now(),
      compensators: {},
      simulated: false,
    };

    losses[moduleId] = record;
    this._saveLosses(losses);

    // Update resilience
    const res = this._getResilience();
    res.totalLosses++;
    res.history.push({ moduleId, lostAt: Date.now(), type: 'loss' });
    if (res.history.length > 200) res.history = res.history.slice(-200);
    this._saveResilience(res);

    this.emit('module-lost', record);
    return record;
  }

  /**
   * Record a phantom signal — an attempt to communicate with a dead module
   * @param {string} fromModule - module sending the signal
   * @param {string} toModule - dead module being addressed
   * @param {string} signalType - type of communication attempted
   */
  recordPhantomSignal(fromModule, toModule, signalType = 'call') {
    const losses = this._getLosses();
    if (!losses[toModule]) return { error: 'module_not_lost', toModule };

    const signals = this._getSignals();
    const signal = {
      id: uuid(),
      from: fromModule,
      to: toModule,
      type: signalType,
      timestamp: Date.now(),
    };
    signals.push(signal);
    if (signals.length > 1000) signals.splice(0, signals.length - 1000);
    this._saveSignals(signals);

    this.emit('phantom-signal', signal);
    return signal;
  }

  /**
   * Get all phantom signals (optionally filtered by dead module)
   * @param {string} [moduleId] - filter by target module
   * @returns {object[]}
   */
  getPhantomSignals(moduleId) {
    const signals = this._getSignals();
    if (moduleId) return signals.filter(s => s.to === moduleId);
    return signals;
  }

  /**
   * Register a compensator — a module taking over a function of the dead module
   * @param {string} lostModule - the dead module
   * @param {string} compensator - the module stepping in
   * @param {string} func - function being taken over
   * @param {number} effectiveness - 0-100 how well it compensates
   */
  registerCompensation(lostModule, compensator, func, effectiveness = 50) {
    const losses = this._getLosses();
    if (!losses[lostModule]) return { error: 'module_not_lost', lostModule };

    const rewiring = this._getRewiring();
    const key = `${lostModule}:${func}`;
    rewiring[key] = {
      lostModule,
      function: func,
      compensator,
      effectiveness: Math.max(0, Math.min(100, effectiveness)),
      establishedAt: Date.now(),
    };
    this._saveRewiring(rewiring);

    // Also track on the loss record
    losses[lostModule].compensators[func] = { compensator, effectiveness };
    this._saveLosses(losses);

    this.emit('rewired', rewiring[key]);
    return rewiring[key];
  }

  /**
   * Get current compensation map
   * @returns {object}
   */
  getRewiring() {
    return this._getRewiring();
  }

  /**
   * Get recovery stage for a lost module
   * @param {string} moduleId
   * @returns {object}
   */
  getRecoveryStage(moduleId) {
    const losses = this._getLosses();
    const loss = losses[moduleId];
    if (!loss) return { error: 'not_found', moduleId };

    const totalCompensation = Object.values(loss.compensators);
    const avgEffectiveness = totalCompensation.length > 0
      ? Math.round(totalCompensation.reduce((s, c) => s + c.effectiveness, 0) / totalCompensation.length)
      : 0;

    const phantomSignals = this._getSignals().filter(s => s.to === moduleId);

    return {
      moduleId,
      stage: loss.stage,
      ticksInStage: loss.ticksInStage,
      lostAt: loss.lostAt,
      compensators: loss.compensators,
      avgEffectiveness,
      phantomSignalCount: phantomSignals.length,
      simulated: loss.simulated,
    };
  }

  /**
   * Get overall resilience score
   * @returns {object}
   */
  getResilience() {
    const res = this._getResilience();
    const losses = this._getLosses();
    const active = Object.values(losses).filter(l => l.stage !== 'ADAPTED');
    const adapted = Object.values(losses).filter(l => l.stage === 'ADAPTED');

    return {
      score: res.score,
      totalLosses: res.totalLosses,
      recoveries: res.recoveries,
      activeLosses: active.length,
      fullyAdapted: adapted.length,
      history: res.history.slice(-20),
    };
  }

  /**
   * Simulate module loss without actually losing it
   * @param {string} moduleId
   * @param {object} meta - functions, dependencies
   * @returns {object} simulation result
   */
  simulate(moduleId, meta = {}) {
    const losses = this._getLosses();

    // Create a temporary simulated loss
    const simRecord = {
      id: uuid(),
      moduleId: `sim:${moduleId}`,
      stage: 'SHOCK',
      ticksInStage: 0,
      functions: meta.functions || [],
      dependencies: meta.dependencies || [],
      lostAt: Date.now(),
      compensators: {},
      simulated: true,
    };

    losses[`sim:${moduleId}`] = simRecord;
    this._saveLosses(losses);

    // Analyze vulnerability
    const signals = this._getSignals();
    const dependentSignals = signals.filter(s => s.to === moduleId);
    const dependents = [...new Set(dependentSignals.map(s => s.from))];

    const rewiring = this._getRewiring();
    const existingBackups = Object.values(rewiring).filter(r => r.lostModule === moduleId);

    const vulnerability = {
      moduleId,
      simulated: true,
      dependentModules: dependents,
      functionsAtRisk: meta.functions || [],
      existingBackups: existingBackups.length,
      vulnerabilityScore: Math.max(0, 100 - (existingBackups.length * 20) - (dependents.length < 3 ? 20 : 0)),
      recommendation: existingBackups.length > 0
        ? 'Some backup pathways exist — partial resilience'
        : 'No backup pathways — high vulnerability, consider preemptive rewiring',
    };

    // Update resilience with simulation data
    const res = this._getResilience();
    res.history.push({ moduleId, type: 'simulation', vulnerability: vulnerability.vulnerabilityScore, at: Date.now() });
    if (res.history.length > 200) res.history = res.history.slice(-200);
    // Simulations slightly improve resilience (preparedness)
    res.score = Math.min(100, res.score + 1);
    this._saveResilience(res);

    this.emit('simulated', vulnerability);
    return vulnerability;
  }

  /**
   * Advance recovery stages, check for new losses, decay phantom signals
   * @returns {object} tick summary
   */
  tick() {
    const losses = this._getLosses();
    const res = this._getResilience();
    const changes = [];

    for (const [moduleId, loss] of Object.entries(losses)) {
      if (loss.stage === 'ADAPTED') continue;

      loss.ticksInStage++;
      const threshold = STAGE_DURATIONS[loss.stage];

      if (threshold && loss.ticksInStage >= threshold) {
        const stageIdx = STAGES.indexOf(loss.stage);
        if (stageIdx < STAGES.length - 1) {
          const oldStage = loss.stage;
          loss.stage = STAGES[stageIdx + 1];
          loss.ticksInStage = 0;

          changes.push({ moduleId, from: oldStage, to: loss.stage });
          this.emit('stage-change', { moduleId, from: oldStage, to: loss.stage });

          // On reaching ADAPTED, update resilience
          if (loss.stage === 'ADAPTED') {
            res.recoveries++;
            // Each recovery improves resilience
            res.score = Math.min(100, res.score + 3);
            res.history.push({ moduleId, type: 'adapted', at: Date.now() });
          }
        }
      }

      // During REWIRING, gradually improve compensator effectiveness
      if (loss.stage === 'REWIRING') {
        for (const func of Object.keys(loss.compensators)) {
          const comp = loss.compensators[func];
          if (comp.effectiveness < 90) {
            comp.effectiveness = Math.min(90, comp.effectiveness + 2);
          }
        }
      }
    }

    this._saveLosses(losses);

    // Decay old phantom signals (older than 50 ticks worth ~ keep last 500)
    const signals = this._getSignals();
    if (signals.length > 500) {
      this._saveSignals(signals.slice(-500));
    }

    // Slight resilience decay if no activity
    if (changes.length === 0 && res.score > 30) {
      res.score = Math.max(30, res.score - 0.1);
    }
    this._saveResilience(res);

    return {
      activeLosses: Object.values(losses).filter(l => l.stage !== 'ADAPTED').length,
      stageChanges: changes,
      resilience: Math.round(res.score),
    };
  }
}

let _instance = null;
function getInstance(opts) {
  if (!_instance) _instance = new PhantomLimb(opts);
  return _instance;
}

module.exports = { PhantomLimb, getInstance };
