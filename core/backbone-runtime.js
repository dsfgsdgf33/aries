/**
 * ARIES — Backbone Runtime v1.0
 * Unified runtime wiring together:
 *   - CognitiveLoop (tick orchestration)
 *   - ModuleDependencyGraph (topological boot order)
 *   - EventQueryOptimizer (compiled event dispatch)
 *
 * Provides init/start/stop lifecycle, health monitoring, bottleneck detection,
 * and JSON persistence in data/backbone/.
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'backbone');
const STATE_PATH = path.join(DATA_DIR, 'state.json');
const HEALTH_PATH = path.join(DATA_DIR, 'health.json');
const BOTTLENECK_PATH = path.join(DATA_DIR, 'bottlenecks.json');
const DISPATCH_STATS_PATH = path.join(DATA_DIR, 'dispatch-stats.json');
const BOOT_LOG_PATH = path.join(DATA_DIR, 'boot-log.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function now() { return Date.now(); }

// Thresholds
const SLOW_MODULE_MS = 500;
const BOTTLENECK_DEPENDENT_COUNT = 5;
const MODULE_TIMEOUT_MS = 5000;
const HEALTH_CHECK_INTERVAL = 60000;
const DROP_THRESHOLD = 0.15; // 15% drop rate triggers alert

/**
 * Module lifecycle states
 */
const MODULE_STATE = {
  PENDING: 'pending',
  BOOTING: 'booting',
  READY: 'ready',
  RUNNING: 'running',
  ERROR: 'error',
  STOPPED: 'stopped',
  TIMEOUT: 'timeout',
};

/**
 * Backbone lifecycle states
 */
const BACKBONE_STATE = {
  IDLE: 'idle',
  BOOTING: 'booting',
  RUNNING: 'running',
  STOPPING: 'stopping',
  STOPPED: 'stopped',
  ERROR: 'error',
};

class BackboneRuntime extends EventEmitter {
  /**
   * @param {object} opts
   * @param {object} [opts.ai] - AI interface
   * @param {object} [opts.config] - Configuration overrides
   */
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null;
    this.config = Object.assign({
      tickInterval: 30000,
      slowModuleMs: SLOW_MODULE_MS,
      moduleTimeoutMs: MODULE_TIMEOUT_MS,
      healthCheckInterval: HEALTH_CHECK_INTERVAL,
      bottleneckThreshold: BOTTLENECK_DEPENDENT_COUNT,
      dropThreshold: DROP_THRESHOLD,
      autoLoadDefaults: true,
    }, opts.config);

    // Sub-modules (lazy-loaded)
    this._cognitiveLoop = null;
    this._depGraph = null;
    this._eventOptimizer = null;

    // State
    this._state = BACKBONE_STATE.IDLE;
    this._bootOrder = [];
    this._moduleStates = new Map(); // moduleId → { state, bootTime, lastTick, errors, ... }
    this._tickCount = 0;
    this._lastTick = null;
    this._startedAt = null;
    this._healthTimer = null;

    // Health tracking
    this._healthHistory = [];
    this._bottlenecks = [];
    this._slowModules = new Map();  // moduleId → { count, totalMs, avgMs }
    this._droppedEvents = new Map(); // eventType → { total, dropped }
    this._moduleTimings = new Map(); // moduleId → [last N tick durations]

    // Dispatch stats
    this._dispatchStats = {
      totalDispatched: 0,
      totalMatched: 0,
      totalDropped: 0,
      totalErrors: 0,
      byEventType: {},
      byModule: {},
      lastReset: now(),
    };

    // Persisted state
    this._loadState();
  }

  // ═══════════════════════════════════════════════════════════════
  //  PERSISTENCE
  // ═══════════════════════════════════════════════════════════════

  _loadState() {
    const saved = readJSON(STATE_PATH, null);
    if (saved) {
      this._tickCount = saved.tickCount || 0;
      this._dispatchStats = Object.assign(this._dispatchStats, saved.dispatchStats || {});
    }
    this._bottlenecks = readJSON(BOTTLENECK_PATH, []);
    this._healthHistory = readJSON(HEALTH_PATH, []);
  }

  _saveState() {
    writeJSON(STATE_PATH, {
      state: this._state,
      tickCount: this._tickCount,
      bootOrder: this._bootOrder,
      startedAt: this._startedAt,
      lastTick: this._lastTick,
      moduleCount: this._moduleStates.size,
      dispatchStats: this._dispatchStats,
      savedAt: now(),
    });
  }

  _saveHealth() {
    writeJSON(HEALTH_PATH, this._healthHistory.slice(-200));
  }

  _saveBottlenecks() {
    writeJSON(BOTTLENECK_PATH, this._bottlenecks.slice(-100));
  }

  _saveDispatchStats() {
    writeJSON(DISPATCH_STATS_PATH, this._dispatchStats);
  }

  _saveBootLog(log) {
    const existing = readJSON(BOOT_LOG_PATH, []);
    existing.push(log);
    writeJSON(BOOT_LOG_PATH, existing.slice(-50));
  }

  // ═══════════════════════════════════════════════════════════════
  //  SUB-MODULE ACCESS (lazy instantiation)
  // ═══════════════════════════════════════════════════════════════

  _getCognitiveLoop() {
    if (!this._cognitiveLoop) {
      try {
        const CognitiveLoop = require('./cognitive-loop');
        this._cognitiveLoop = new CognitiveLoop({ ai: this.ai });
      } catch (e) {
        this.emit('dispatch-error', { source: 'backbone', error: 'Failed to load CognitiveLoop: ' + e.message });
        return null;
      }
    }
    return this._cognitiveLoop;
  }

  _getDepGraph() {
    if (!this._depGraph) {
      try {
        const ModuleDependencyGraph = require('./module-dependency-graph');
        this._depGraph = new ModuleDependencyGraph({ ai: this.ai, config: this.config });
      } catch (e) {
        this.emit('dispatch-error', { source: 'backbone', error: 'Failed to load ModuleDependencyGraph: ' + e.message });
        return null;
      }
    }
    return this._depGraph;
  }

  _getEventOptimizer() {
    if (!this._eventOptimizer) {
      try {
        const EventQueryOptimizer = require('./event-query-optimizer');
        this._eventOptimizer = new EventQueryOptimizer({ ai: this.ai, config: this.config });
      } catch (e) {
        this.emit('dispatch-error', { source: 'backbone', error: 'Failed to load EventQueryOptimizer: ' + e.message });
        return null;
      }
    }
    return this._eventOptimizer;
  }

  // ═══════════════════════════════════════════════════════════════
  //  INIT — Load graph, compute boot order, init modules
  // ═══════════════════════════════════════════════════════════════

  async init() {
    if (this._state === BACKBONE_STATE.RUNNING || this._state === BACKBONE_STATE.BOOTING) {
      return { error: 'Already initialized or booting', state: this._state };
    }

    this._state = BACKBONE_STATE.BOOTING;
    const bootStart = now();
    const bootLog = {
      id: uuid(),
      startedAt: bootStart,
      phases: [],
      errors: [],
      completedAt: null,
      success: false,
    };

    try {
      // Phase 1: Load dependency graph
      const p1Start = now();
      const depGraph = this._getDepGraph();
      if (!depGraph) throw new Error('ModuleDependencyGraph unavailable');

      // Load defaults if graph is empty
      if (depGraph.modules.size === 0 && this.config.autoLoadDefaults) {
        depGraph.loadDefaults();
      }

      // Validate graph
      const validation = depGraph.validate();
      bootLog.phases.push({
        name: 'load-graph',
        duration: now() - p1Start,
        moduleCount: depGraph.modules.size,
        valid: validation.valid,
        errors: validation.errors.length,
        warnings: validation.warnings.length,
      });

      // Phase 2: Compute topological boot order
      const p2Start = now();
      this._bootOrder = depGraph.getTickOrder();
      bootLog.phases.push({
        name: 'compute-boot-order',
        duration: now() - p2Start,
        orderLength: this._bootOrder.length,
      });

      // Phase 3: Initialize modules in boot order
      const p3Start = now();
      let initSuccessCount = 0;
      let initErrorCount = 0;

      for (const moduleId of this._bootOrder) {
        const modStart = now();
        const modInfo = depGraph.modules.get(moduleId);

        this._moduleStates.set(moduleId, {
          state: MODULE_STATE.BOOTING,
          bootStart: modStart,
          bootTime: null,
          lastTick: null,
          tickCount: 0,
          totalTickMs: 0,
          avgTickMs: 0,
          errors: 0,
          skips: 0,
          timeouts: 0,
          lastError: null,
          priority: modInfo ? modInfo.priority : 'MEDIUM',
          phase: modInfo ? modInfo.phase : 'main',
          energyCost: modInfo ? modInfo.energyCost : 5,
        });

        try {
          // Try to load and register the module with the cognitive loop
          const loop = this._getCognitiveLoop();
          if (loop) {
            // Attempt to require the module (best-effort)
            let modInstance = null;
            try {
              const ModClass = require('./' + moduleId);
              if (typeof ModClass === 'function') {
                modInstance = new ModClass({ ai: this.ai, config: this.config });
              } else {
                modInstance = ModClass;
              }
            } catch (_) {
              // Module file not found — that's okay, not all declared modules exist as files
            }

            if (modInstance) {
              loop.register(moduleId, modInstance, {
                priority: this._priorityToNumber(modInfo ? modInfo.priority : 'MEDIUM'),
                energyCost: modInfo ? modInfo.energyCost : 5,
                phase: modInfo ? modInfo.phase : 'main',
                dependencies: modInfo ? modInfo.dependencies : [],
              });
            }
          }

          const bootTime = now() - modStart;
          const ms = this._moduleStates.get(moduleId);
          ms.state = MODULE_STATE.READY;
          ms.bootTime = bootTime;
          initSuccessCount++;
        } catch (e) {
          const ms = this._moduleStates.get(moduleId);
          ms.state = MODULE_STATE.ERROR;
          ms.lastError = e.message;
          ms.bootTime = now() - modStart;
          initErrorCount++;
          bootLog.errors.push({ moduleId, error: e.message });
        }
      }

      bootLog.phases.push({
        name: 'init-modules',
        duration: now() - p3Start,
        success: initSuccessCount,
        errors: initErrorCount,
      });

      // Phase 4: Wire event optimizer
      const p4Start = now();
      this._wireEventOptimizer();
      bootLog.phases.push({
        name: 'wire-events',
        duration: now() - p4Start,
      });

      // Phase 5: Register optimizer listeners for dispatch tracking
      const p5Start = now();
      this._setupDispatchTracking();
      bootLog.phases.push({
        name: 'setup-tracking',
        duration: now() - p5Start,
      });

      bootLog.completedAt = now();
      bootLog.success = true;
      bootLog.totalDuration = now() - bootStart;
      this._saveBootLog(bootLog);
      this._saveState();

      this._state = BACKBONE_STATE.STOPPED; // Initialized but not ticking
      this.emit('boot-complete', {
        bootOrder: this._bootOrder,
        moduleCount: this._moduleStates.size,
        duration: bootLog.totalDuration,
        errors: bootLog.errors,
      });

      return {
        success: true,
        bootOrder: this._bootOrder,
        moduleCount: this._moduleStates.size,
        duration: bootLog.totalDuration,
        initSuccess: initSuccessCount,
        initErrors: initErrorCount,
        validation,
      };
    } catch (e) {
      this._state = BACKBONE_STATE.ERROR;
      bootLog.completedAt = now();
      bootLog.success = false;
      bootLog.fatalError = e.message;
      this._saveBootLog(bootLog);
      this.emit('dispatch-error', { source: 'init', error: e.message });
      return { success: false, error: e.message };
    }
  }

  _priorityToNumber(priority) {
    const map = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    return map[priority] !== undefined ? map[priority] : 2;
  }

  // ═══════════════════════════════════════════════════════════════
  //  EVENT WIRING — Route events through optimizer
  // ═══════════════════════════════════════════════════════════════

  _wireEventOptimizer() {
    const optimizer = this._getEventOptimizer();
    const depGraph = this._getDepGraph();
    if (!optimizer || !depGraph) return;

    const EQO = require('./event-query-optimizer');

    // For each module that consumes events, register with the optimizer
    for (const [moduleId, modInfo] of depGraph.modules) {
      if (!modInfo.consumes || modInfo.consumes.length === 0) continue;

      for (const eventType of modInfo.consumes) {
        // Create a filter that accepts all events of this type (wildcard)
        const filter = EQO.all([EQO.wc('type')]);

        // Create handler that tracks dispatch
        const handler = (event, handlerModuleId) => {
          this._recordDispatch(eventType, handlerModuleId, true);
        };

        optimizer.register(moduleId, eventType, filter, handler);
      }
    }

    // Compile the dispatch trees
    optimizer.compile();
  }

  _setupDispatchTracking() {
    const optimizer = this._getEventOptimizer();
    if (!optimizer) return;

    optimizer.on('dispatch', (info) => {
      this._dispatchStats.totalDispatched++;
      this._dispatchStats.totalMatched += info.matchCount;

      if (!this._dispatchStats.byEventType[info.eventType]) {
        this._dispatchStats.byEventType[info.eventType] = { dispatched: 0, matched: 0, dropped: 0, errors: 0, totalTimeUs: 0 };
      }
      const et = this._dispatchStats.byEventType[info.eventType];
      et.dispatched++;
      et.matched += info.matchCount;
      et.totalTimeUs += info.timeUs || 0;

      if (info.matchCount === 0) {
        et.dropped++;
        this._dispatchStats.totalDropped++;
        this._checkDropRate(info.eventType, et);
      }
    });

    optimizer.on('error', (info) => {
      this._dispatchStats.totalErrors++;
      if (!this._dispatchStats.byModule[info.moduleId]) {
        this._dispatchStats.byModule[info.moduleId] = { dispatched: 0, errors: 0 };
      }
      this._dispatchStats.byModule[info.moduleId].errors++;
      this.emit('dispatch-error', {
        moduleId: info.moduleId,
        eventType: info.eventType,
        error: info.error ? info.error.message : 'unknown',
      });
    });
  }

  _recordDispatch(eventType, moduleId, matched) {
    if (!this._dispatchStats.byModule[moduleId]) {
      this._dispatchStats.byModule[moduleId] = { dispatched: 0, errors: 0 };
    }
    this._dispatchStats.byModule[moduleId].dispatched++;
  }

  _checkDropRate(eventType, stats) {
    if (stats.dispatched < 10) return; // Not enough data
    const dropRate = stats.dropped / stats.dispatched;
    if (dropRate > this.config.dropThreshold) {
      const evt = {
        eventType,
        dropRate: Math.round(dropRate * 100),
        totalDispatched: stats.dispatched,
        totalDropped: stats.dropped,
        timestamp: now(),
      };
      this._droppedEvents.set(eventType, evt);
      this.emit('bottleneck-detected', {
        type: 'event-drop',
        ...evt,
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  DISPATCH — Route inter-module events through optimizer
  // ═══════════════════════════════════════════════════════════════

  /**
   * Route an event through the compiled optimizer dispatch tree.
   * Call this instead of direct EventEmitter coupling between modules.
   * @param {string} eventType
   * @param {object} event
   * @returns {Array} matched modules
   */
  dispatchEvent(eventType, event) {
    const optimizer = this._getEventOptimizer();
    if (!optimizer) return [];

    const enriched = { ...event, type: eventType, _dispatchedAt: now() };
    try {
      return optimizer.dispatch(eventType, enriched);
    } catch (e) {
      this._dispatchStats.totalErrors++;
      this.emit('dispatch-error', { eventType, error: e.message });
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  TICK — Delegate to cognitive loop with dependency ordering
  // ═══════════════════════════════════════════════════════════════

  async tick() {
    if (this._state !== BACKBONE_STATE.RUNNING) {
      return { error: 'Backbone not running', state: this._state };
    }

    const tickStart = now();
    this._tickCount++;
    const tickResult = {
      tick: this._tickCount,
      timestamp: tickStart,
      modulesRun: 0,
      modulesSkipped: 0,
      modulesTimedOut: 0,
      modulesErrored: 0,
      duration: 0,
      bottlenecksDetected: 0,
    };

    // Get tick order from dependency graph
    const depGraph = this._getDepGraph();
    const tickOrder = depGraph ? depGraph.getTickOrder() : this._bootOrder;

    // Execute each module in dependency order, tracking timing
    for (const moduleId of tickOrder) {
      const ms = this._moduleStates.get(moduleId);
      if (!ms || ms.state === MODULE_STATE.ERROR || ms.state === MODULE_STATE.STOPPED) {
        tickResult.modulesSkipped++;
        continue;
      }

      const modStart = now();
      ms.state = MODULE_STATE.RUNNING;

      try {
        // Delegate tick to cognitive loop if available
        const loop = this._getCognitiveLoop();
        const registry = loop ? loop._registry : null;
        const entry = registry ? registry.get(moduleId) : null;

        if (entry && entry.module) {
          // Use timeout wrapper
          const tickPromise = new Promise((resolve, reject) => {
            try {
              if (typeof entry.module.tick === 'function') {
                const result = entry.module.tick({ tick: this._tickCount, backbone: true });
                if (result && typeof result.then === 'function') {
                  result.then(resolve).catch(reject);
                } else {
                  resolve(result);
                }
              } else if (typeof entry.module.process === 'function') {
                entry.module.process();
                resolve();
              } else {
                resolve();
              }
            } catch (e) {
              reject(e);
            }
          });

          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Module timeout')), this.config.moduleTimeoutMs);
          });

          await Promise.race([tickPromise, timeoutPromise]);
        }

        const elapsed = now() - modStart;
        ms.state = MODULE_STATE.READY;
        ms.lastTick = this._tickCount;
        ms.tickCount++;
        ms.totalTickMs += elapsed;
        ms.avgTickMs = Math.round(ms.totalTickMs / ms.tickCount);
        tickResult.modulesRun++;

        // Track timing for bottleneck detection
        this._recordModuleTiming(moduleId, elapsed);

        // Route any events from this module through the optimizer
        if (entry && entry.module && typeof entry.module.drainEvents === 'function') {
          const events = entry.module.drainEvents();
          if (Array.isArray(events)) {
            for (const evt of events) {
              const evtType = evt.type || evt.kind || 'unknown';
              this.dispatchEvent(evtType, { ...evt, source: moduleId });
            }
          }
        }

      } catch (e) {
        const elapsed = now() - modStart;

        if (e.message === 'Module timeout') {
          ms.state = MODULE_STATE.TIMEOUT;
          ms.timeouts++;
          tickResult.modulesTimedOut++;
          this.emit('module-timeout', { moduleId, tick: this._tickCount, elapsed });
        } else {
          ms.state = MODULE_STATE.ERROR;
          ms.errors++;
          ms.lastError = e.message;
          tickResult.modulesErrored++;
        }

        this._recordModuleTiming(moduleId, elapsed);
      }
    }

    // Run bottleneck detection
    const detected = this._detectBottlenecks();
    tickResult.bottlenecksDetected = detected.length;

    tickResult.duration = now() - tickStart;
    this._lastTick = tickResult;

    // Periodic saves
    if (this._tickCount % 5 === 0) {
      this._saveState();
      this._saveDispatchStats();
    }

    this.emit('tick-complete', tickResult);
    return tickResult;
  }

  // ═══════════════════════════════════════════════════════════════
  //  TIMING & BOTTLENECK DETECTION
  // ═══════════════════════════════════════════════════════════════

  _recordModuleTiming(moduleId, elapsed) {
    if (!this._moduleTimings.has(moduleId)) {
      this._moduleTimings.set(moduleId, []);
    }
    const timings = this._moduleTimings.get(moduleId);
    timings.push(elapsed);
    if (timings.length > 50) timings.shift();

    // Track slow modules
    if (elapsed > this.config.slowModuleMs) {
      if (!this._slowModules.has(moduleId)) {
        this._slowModules.set(moduleId, { count: 0, totalMs: 0, avgMs: 0 });
      }
      const slow = this._slowModules.get(moduleId);
      slow.count++;
      slow.totalMs += elapsed;
      slow.avgMs = Math.round(slow.totalMs / slow.count);
    }
  }

  _detectBottlenecks() {
    const detected = [];
    const depGraph = this._getDepGraph();

    // 1. Slow modules (avg tick > threshold)
    for (const [moduleId, timings] of this._moduleTimings) {
      if (timings.length < 3) continue;
      const avg = timings.reduce((a, b) => a + b, 0) / timings.length;
      if (avg > this.config.slowModuleMs) {
        detected.push({
          type: 'slow-module',
          moduleId,
          avgMs: Math.round(avg),
          sampleCount: timings.length,
          threshold: this.config.slowModuleMs,
          timestamp: now(),
        });
      }
    }

    // 2. High-dependency bottlenecks
    if (depGraph) {
      const graphBottlenecks = depGraph.getBottlenecks();
      for (const bn of graphBottlenecks) {
        if (bn.dependentCount >= this.config.bottleneckThreshold) {
          detected.push({
            type: 'dependency-bottleneck',
            moduleId: bn.moduleId,
            dependentCount: bn.dependentCount,
            dependents: bn.dependents,
            timestamp: now(),
          });
        }
      }
    }

    // 3. Modules with high error rates
    for (const [moduleId, ms] of this._moduleStates) {
      if (ms.tickCount > 5 && ms.errors / ms.tickCount > 0.2) {
        detected.push({
          type: 'error-prone',
          moduleId,
          errorRate: Math.round((ms.errors / ms.tickCount) * 100),
          errors: ms.errors,
          ticks: ms.tickCount,
          timestamp: now(),
        });
      }
    }

    // 4. Modules with frequent timeouts
    for (const [moduleId, ms] of this._moduleStates) {
      if (ms.timeouts > 2) {
        detected.push({
          type: 'frequent-timeout',
          moduleId,
          timeouts: ms.timeouts,
          timestamp: now(),
        });
      }
    }

    // 5. Event drop bottlenecks
    for (const [eventType, info] of this._droppedEvents) {
      detected.push({
        type: 'event-drop',
        eventType,
        dropRate: info.dropRate,
        totalDispatched: info.totalDispatched,
        totalDropped: info.totalDropped,
        timestamp: now(),
      });
    }

    if (detected.length > 0) {
      this._bottlenecks = detected;
      this._saveBottlenecks();
      for (const bn of detected) {
        this.emit('bottleneck-detected', bn);
      }
    }

    return detected;
  }

  // ═══════════════════════════════════════════════════════════════
  //  HEALTH MONITORING
  // ═══════════════════════════════════════════════════════════════

  _startHealthMonitor() {
    if (this._healthTimer) return;
    this._healthTimer = setInterval(() => {
      const health = this._computeHealth();
      this._healthHistory.push(health);
      if (this._healthHistory.length > 200) this._healthHistory.shift();
      if (this._healthHistory.length % 10 === 0) this._saveHealth();
    }, this.config.healthCheckInterval);
    if (this._healthTimer.unref) this._healthTimer.unref();
  }

  _stopHealthMonitor() {
    if (this._healthTimer) {
      clearInterval(this._healthTimer);
      this._healthTimer = null;
    }
  }

  _computeHealth() {
    let score = 100;
    const issues = [];

    // Module error rates
    let totalErrors = 0;
    let totalTicks = 0;
    for (const [moduleId, ms] of this._moduleStates) {
      totalErrors += ms.errors;
      totalTicks += ms.tickCount;
      if (ms.state === MODULE_STATE.ERROR) {
        score -= 5;
        issues.push({ type: 'module-error', moduleId, error: ms.lastError });
      }
      if (ms.state === MODULE_STATE.TIMEOUT) {
        score -= 3;
        issues.push({ type: 'module-timeout', moduleId, timeouts: ms.timeouts });
      }
    }

    // Overall error rate
    if (totalTicks > 0) {
      const errorRate = totalErrors / totalTicks;
      if (errorRate > 0.2) score -= 20;
      else if (errorRate > 0.1) score -= 10;
      else if (errorRate > 0.05) score -= 5;
    }

    // Slow modules penalty
    for (const [moduleId, slow] of this._slowModules) {
      if (slow.count > 5) {
        score -= 3;
        issues.push({ type: 'slow-module', moduleId, avgMs: slow.avgMs, count: slow.count });
      }
    }

    // Event drop rate
    if (this._dispatchStats.totalDispatched > 20) {
      const dropRate = this._dispatchStats.totalDropped / this._dispatchStats.totalDispatched;
      if (dropRate > 0.3) score -= 15;
      else if (dropRate > 0.15) score -= 8;
    }

    // Dispatch errors
    if (this._dispatchStats.totalErrors > 10) score -= 10;
    else if (this._dispatchStats.totalErrors > 5) score -= 5;

    // Bottleneck count
    score -= Math.min(20, this._bottlenecks.length * 3);

    score = Math.max(0, Math.min(100, Math.round(score)));

    return {
      score,
      timestamp: now(),
      tickCount: this._tickCount,
      moduleCount: this._moduleStates.size,
      readyModules: [...this._moduleStates.values()].filter(m => m.state === MODULE_STATE.READY).length,
      errorModules: [...this._moduleStates.values()].filter(m => m.state === MODULE_STATE.ERROR).length,
      timeoutModules: [...this._moduleStates.values()].filter(m => m.state === MODULE_STATE.TIMEOUT).length,
      bottleneckCount: this._bottlenecks.length,
      dispatchErrors: this._dispatchStats.totalErrors,
      eventDropRate: this._dispatchStats.totalDispatched > 0
        ? Math.round((this._dispatchStats.totalDropped / this._dispatchStats.totalDispatched) * 100)
        : 0,
      issues,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  //  LIFECYCLE: start / stop
  // ═══════════════════════════════════════════════════════════════

  async start() {
    // Auto-init if needed
    if (this._state === BACKBONE_STATE.IDLE) {
      const initResult = await this.init();
      if (!initResult.success) return initResult;
    }

    if (this._state === BACKBONE_STATE.RUNNING) {
      return { status: 'already-running', tickCount: this._tickCount };
    }

    this._state = BACKBONE_STATE.RUNNING;
    this._startedAt = now();

    // Start the cognitive loop
    const loop = this._getCognitiveLoop();
    if (loop) {
      loop.start(this.config.tickInterval);

      // Intercept tick-complete from cognitive loop to run our tick logic
      loop.on('tick-complete', (tickData) => {
        this._onCognitiveTickComplete(tickData);
      });
    }

    // Start health monitoring
    this._startHealthMonitor();

    // Start optimizer auto-checkpoint
    const optimizer = this._getEventOptimizer();
    if (optimizer) optimizer.startAutoCheckpoint();

    this._saveState();
    return {
      status: 'started',
      tickInterval: this.config.tickInterval,
      moduleCount: this._moduleStates.size,
      bootOrder: this._bootOrder,
    };
  }

  async stop() {
    if (this._state !== BACKBONE_STATE.RUNNING) {
      return { status: 'not-running', state: this._state };
    }

    this._state = BACKBONE_STATE.STOPPING;

    // Stop cognitive loop
    const loop = this._getCognitiveLoop();
    if (loop) loop.stop();

    // Stop health monitor
    this._stopHealthMonitor();

    // Stop optimizer auto-checkpoint
    const optimizer = this._getEventOptimizer();
    if (optimizer) {
      optimizer.stopAutoCheckpoint();
      try { await optimizer.checkpoint(); } catch (_) {}
    }

    // Mark all modules as stopped
    for (const [, ms] of this._moduleStates) {
      if (ms.state === MODULE_STATE.READY || ms.state === MODULE_STATE.RUNNING) {
        ms.state = MODULE_STATE.STOPPED;
      }
    }

    this._state = BACKBONE_STATE.STOPPED;
    this._saveState();
    this._saveDispatchStats();
    this._saveHealth();

    return { status: 'stopped', tickCount: this._tickCount };
  }

  _onCognitiveTickComplete(tickData) {
    // After each cognitive loop tick, run our bottleneck detection
    // and update module states from the loop's registry
    const loop = this._getCognitiveLoop();
    if (!loop) return;

    for (const [moduleId, entry] of loop._registry) {
      const ms = this._moduleStates.get(moduleId);
      if (ms) {
        ms.tickCount = entry.stats.ticks;
        ms.totalTickMs = entry.stats.totalMs;
        ms.avgTickMs = entry.stats.avgMs;
        ms.errors = entry.stats.errors;
        ms.skips = entry.stats.skips;
        if (entry.stats.lastTick) ms.lastTick = entry.stats.lastTick;
      }
    }

    this._tickCount = tickData.tick || this._tickCount;
    this._lastTick = tickData;
    this.emit('tick-complete', tickData);
  }

  // ═══════════════════════════════════════════════════════════════
  //  PUBLIC API: getStatus, getBootOrder, getDispatchStats, etc.
  // ═══════════════════════════════════════════════════════════════

  getStatus() {
    const health = this._computeHealth();
    const optimizerStats = this._getEventOptimizer() ? this._getEventOptimizer().getStats() : {};

    return {
      state: this._state,
      tickCount: this._tickCount,
      startedAt: this._startedAt,
      uptime: this._startedAt ? now() - this._startedAt : 0,
      moduleCount: this._moduleStates.size,
      readyModules: [...this._moduleStates.values()].filter(m => m.state === MODULE_STATE.READY).length,
      errorModules: [...this._moduleStates.values()].filter(m => m.state === MODULE_STATE.ERROR).length,
      bootOrder: this._bootOrder,
      health,
      lastTick: this._lastTick,
      dispatchStats: {
        totalDispatched: this._dispatchStats.totalDispatched,
        totalMatched: this._dispatchStats.totalMatched,
        totalDropped: this._dispatchStats.totalDropped,
        totalErrors: this._dispatchStats.totalErrors,
      },
      optimizerStats,
      bottleneckCount: this._bottlenecks.length,
      config: {
        tickInterval: this.config.tickInterval,
        slowModuleMs: this.config.slowModuleMs,
        moduleTimeoutMs: this.config.moduleTimeoutMs,
      },
    };
  }

  getBootOrder() {
    const depGraph = this._getDepGraph();
    const modules = [];

    for (const moduleId of this._bootOrder) {
      const ms = this._moduleStates.get(moduleId);
      const modInfo = depGraph ? depGraph.modules.get(moduleId) : null;

      modules.push({
        moduleId,
        state: ms ? ms.state : 'unknown',
        bootTime: ms ? ms.bootTime : null,
        priority: modInfo ? modInfo.priority : 'MEDIUM',
        phase: modInfo ? modInfo.phase : 'main',
        energyCost: modInfo ? modInfo.energyCost : 0,
        dependencies: modInfo ? modInfo.dependencies : [],
        provides: modInfo ? modInfo.provides : [],
        consumes: modInfo ? modInfo.consumes : [],
      });
    }

    return {
      order: this._bootOrder,
      modules,
      totalModules: this._bootOrder.length,
      bootLogs: readJSON(BOOT_LOG_PATH, []).slice(-5),
    };
  }

  getDispatchStats() {
    const optimizer = this._getEventOptimizer();
    const optimizerStats = optimizer ? optimizer.getStats() : {};
    const trees = optimizer ? optimizer.getFilterTree() : {};

    return {
      ...this._dispatchStats,
      avgDispatchTimeUs: optimizerStats.avgMatchTimeUs || 0,
      registeredEventTypes: optimizerStats.registeredEventTypes || 0,
      registeredModules: optimizerStats.registeredModules || 0,
      compiledAt: optimizerStats.compiledAt || null,
      reductions: optimizerStats.reductions || 0,
      treeCount: Object.keys(trees).length,
      trees: Object.keys(trees).map(et => ({
        eventType: et,
        type: trees[et] ? trees[et].type : 'unknown',
      })),
    };
  }

  getHealth() {
    const current = this._computeHealth();
    return {
      current,
      history: this._healthHistory.slice(-50),
      moduleHealth: this._getModuleHealth(),
    };
  }

  _getModuleHealth() {
    const result = [];
    for (const [moduleId, ms] of this._moduleStates) {
      const timings = this._moduleTimings.get(moduleId) || [];
      const avgMs = timings.length > 0
        ? Math.round(timings.reduce((a, b) => a + b, 0) / timings.length)
        : 0;

      result.push({
        moduleId,
        state: ms.state,
        tickCount: ms.tickCount,
        avgTickMs: avgMs,
        errors: ms.errors,
        timeouts: ms.timeouts,
        skips: ms.skips,
        lastError: ms.lastError,
        priority: ms.priority,
        phase: ms.phase,
        isSlow: avgMs > this.config.slowModuleMs,
      });
    }

    // Sort by avg tick time descending (slowest first)
    result.sort((a, b) => b.avgTickMs - a.avgTickMs);
    return result;
  }

  getBottlenecks() {
    // Refresh detection
    this._detectBottlenecks();

    return {
      bottlenecks: this._bottlenecks,
      slowModules: [...this._slowModules.entries()].map(([id, s]) => ({
        moduleId: id, ...s,
      })),
      droppedEvents: [...this._droppedEvents.entries()].map(([type, info]) => ({
        eventType: type, ...info,
      })),
      criticalPath: this._getDepGraph() ? this._getDepGraph().getCriticalPath() : [],
      graphBottlenecks: this._getDepGraph() ? this._getDepGraph().getBottlenecks() : [],
    };
  }

  // ═══════════════════════════════════════════════════════════════
  //  RESTART
  // ═══════════════════════════════════════════════════════════════

  async restart() {
    const stopResult = await this.stop();

    // Reset sub-modules to force fresh load
    this._cognitiveLoop = null;
    this._depGraph = null;
    this._eventOptimizer = null;
    this._moduleStates.clear();
    this._moduleTimings.clear();
    this._slowModules.clear();
    this._droppedEvents.clear();
    this._state = BACKBONE_STATE.IDLE;

    const startResult = await this.start();
    return {
      restart: true,
      stop: stopResult,
      start: startResult,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  //  SUMMARY
  // ═══════════════════════════════════════════════════════════════

  getSummary() {
    const health = this._computeHealth();
    return {
      state: this._state,
      tickCount: this._tickCount,
      health: health.score,
      modules: this._moduleStates.size,
      ready: health.readyModules,
      errors: health.errorModules,
      timeouts: health.timeoutModules,
      bottlenecks: this._bottlenecks.length,
      dispatched: this._dispatchStats.totalDispatched,
      dropped: this._dispatchStats.totalDropped,
      uptime: this._startedAt ? now() - this._startedAt : 0,
    };
  }
}

module.exports = BackboneRuntime;
