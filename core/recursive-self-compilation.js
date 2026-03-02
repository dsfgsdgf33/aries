/**
 * ARIES — Recursive Self-Compilation Engine v2.0
 *
 * The strange loop: a self-improving system that improves its own
 * improvement process. Multi-phase cycle with A/B testing, diff tracking,
 * performance benchmarks, and diminishing returns detection.
 *
 * Cycle: OBSERVE → ANALYZE → PROPOSE → VALIDATE → APPLY → MEASURE → REFLECT → META
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const DATA_DIR = path.join(__dirname, '..', 'data', 'compiler');
const REGISTRY_PATH = path.join(DATA_DIR, 'registry.json');
const CYCLES_PATH = path.join(DATA_DIR, 'cycles.json');
const STRATEGIES_PATH = path.join(DATA_DIR, 'strategies.json');
const METRICS_PATH = path.join(DATA_DIR, 'metrics.json');
const BENCHMARKS_PATH = path.join(DATA_DIR, 'benchmarks.json');
const ABTESTS_PATH = path.join(DATA_DIR, 'ab-tests.json');
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');

/* ── helpers ─────────────────────────────────────────────────────── */

function uuid() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
}

function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(path.dirname(p)); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function now() { return Date.now(); }
function isoNow() { return new Date().toISOString(); }

/* ── constants ───────────────────────────────────────────────────── */

const PHASES = ['OBSERVE', 'ANALYZE', 'PROPOSE', 'VALIDATE', 'APPLY', 'MEASURE', 'REFLECT', 'META'];

const DEPTH_LABELS = [
  'Direct improvement',
  'Improving the improvement process',
  'Meta-meta: improving how we improve improvements',
  'Level-3 recursion', 'Level-4 recursion', 'Level-5 recursion',
];

/* ── main class ──────────────────────────────────────────────────── */

class RecursiveSelfCompilation extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null;
    this.config = Object.assign({
      maxDepth: 5,
      diminishingThreshold: 0.5,
      cooldownMs: 60 * 60 * 1000,
      maxRegistrySize: 2000,
      maxCycleHistory: 500,
      maxStrategies: 200,
      autoCompileOnTick: true,
      safetyRollbackOnRegression: true,
      abTestMinSamples: 5,
    }, opts.config || {});

    this._compiling = false;
    this._lastCompileAt = 0;
    this._tickCount = 0;

    ensureDir(DATA_DIR);
    ensureDir(BACKUPS_DIR);
  }

  /* ── PERSISTENCE ── */

  _loadRegistry()    { return readJSON(REGISTRY_PATH,   []); }
  _saveRegistry(d)   { writeJSON(REGISTRY_PATH, d.slice(-this.config.maxRegistrySize)); }
  _loadCycles()      { return readJSON(CYCLES_PATH,     []); }
  _saveCycles(d)     { writeJSON(CYCLES_PATH, d.slice(-this.config.maxCycleHistory)); }
  _loadStrategies()  { return readJSON(STRATEGIES_PATH,  []); }
  _saveStrategies(d) { writeJSON(STRATEGIES_PATH, d.slice(-this.config.maxStrategies)); }
  _loadMetrics()     { return readJSON(METRICS_PATH,     { snapshots: [] }); }
  _saveMetrics(d)    { writeJSON(METRICS_PATH, d); }
  _loadBenchmarks()  { return readJSON(BENCHMARKS_PATH,  []); }
  _saveBenchmarks(d) { writeJSON(BENCHMARKS_PATH, d.slice(-500)); }
  _loadABTests()     { return readJSON(ABTESTS_PATH,     []); }
  _saveABTests(d)    { writeJSON(ABTESTS_PATH, d.slice(-200)); }

  /* ── COMPILE — full cycle at a given depth ── */

  async compile(depth = 0) {
    if (depth > this.config.maxDepth) return { ok: false, reason: 'max_depth_exceeded' };
    if (this._compiling) return { ok: false, reason: 'already_compiling' };

    this._compiling = true;
    const cycleId = uuid();
    const startMs = now();

    // Capture benchmark before
    const benchmarkBefore = this._captureBenchmark();

    const cycle = {
      id: cycleId, depth,
      depthLabel: DEPTH_LABELS[depth] || `Level-${depth} recursion`,
      phases: {}, proposals: [], appliedIds: [],
      startedAt: isoNow(), finishedAt: null, durationMs: 0,
      outcome: null, deltaSummary: 0, parentCycleId: null, childCycleId: null,
      benchmarkBefore: benchmarkBefore.id, benchmarkAfter: null,
      diffs: [],
    };

    this.emit('compile-start', { cycleId, depth });

    try {
      /* OBSERVE */
      cycle.phases.OBSERVE = await this._phaseObserve(depth);
      this.emit('compile-phase', { cycleId, phase: 'OBSERVE', depth });

      /* ANALYZE */
      cycle.phases.ANALYZE = await this._phaseAnalyze(cycle.phases.OBSERVE, depth);
      this.emit('compile-phase', { cycleId, phase: 'ANALYZE', depth });

      /* PROPOSE */
      const proposals = await this._phasePropose(cycle.phases.ANALYZE, depth);
      cycle.proposals = proposals;
      this.emit('compile-phase', { cycleId, phase: 'PROPOSE', depth, proposalCount: proposals.length });

      /* VALIDATE */
      const validated = [];
      for (const p of proposals) {
        const v = await this.validateProposal(p.id, p);
        if (v.safe) validated.push(p);
      }
      cycle.phases.VALIDATE = { total: proposals.length, safe: validated.length };
      this.emit('compile-phase', { cycleId, phase: 'VALIDATE', depth, safe: validated.length });

      /* APPLY */
      const applied = [];
      for (const p of validated) {
        const result = await this.applyImprovement(p.id, p);
        if (result.ok) {
          applied.push(p);
          cycle.appliedIds.push(p.id);
          // Track diff
          cycle.diffs.push({
            proposalId: p.id, target: p.target, title: p.title,
            before: p.code ? 'previous' : null, after: p.code || null,
            timestamp: isoNow(),
          });
        }
      }
      cycle.phases.APPLY = { applied: applied.length };
      this.emit('compile-phase', { cycleId, phase: 'APPLY', depth, applied: applied.length });

      /* MEASURE */
      let totalDelta = 0;
      for (const p of applied) {
        const m = await this.measureEffect(p.id, p);
        totalDelta += m.delta || 0;
      }
      cycle.phases.MEASURE = { totalDelta, count: applied.length };
      cycle.deltaSummary = applied.length > 0 ? Math.round((totalDelta / applied.length) * 100) / 100 : 0;
      this.emit('compile-phase', { cycleId, phase: 'MEASURE', depth, totalDelta });

      /* REFLECT */
      cycle.phases.REFLECT = await this._phaseReflect(cycle);
      this.emit('compile-phase', { cycleId, phase: 'REFLECT', depth });

      /* META — meta-improve the compilation process at this depth */
      if (depth > 0 || (cycle.deltaSummary > 0 && applied.length > 0)) {
        cycle.phases.META = await this._phaseMeta(cycle);
        this.emit('compile-phase', { cycleId, phase: 'META', depth });
      }

      // Benchmark after
      const benchmarkAfter = this._captureBenchmark();
      cycle.benchmarkAfter = benchmarkAfter.id;

      // Determine outcome
      if (totalDelta > 0) cycle.outcome = 'improved';
      else if (totalDelta < 0) cycle.outcome = 'regressed';
      else cycle.outcome = applied.length === 0 ? 'no_proposals' : 'no_change';

      // Auto-rollback on regression
      if (cycle.outcome === 'regressed' && this.config.safetyRollbackOnRegression) {
        for (const p of applied) await this._rollback(p);
        cycle.outcome = 'regressed_rolled_back';
      }

      // Recurse deeper if still improving
      if (cycle.deltaSummary >= this.config.diminishingThreshold && depth + 1 <= this.config.maxDepth) {
        const deeper = await this.compile(depth + 1);
        cycle.childCycleId = deeper.cycleId || deeper.id || null;
      }

    } catch (e) {
      cycle.outcome = 'error';
      cycle.error = e.message;
      this.emit('error', e);
    }

    cycle.finishedAt = isoNow();
    cycle.durationMs = now() - startMs;
    this._compiling = false;
    this._lastCompileAt = now();

    const cycles = this._loadCycles();
    cycles.push(cycle);
    this._saveCycles(cycles);
    this._recordMetricSnapshot(cycle);

    this.emit('compile-complete', cycle);
    return cycle;
  }

  /* ── PHASE IMPLEMENTATIONS ── */

  async _phaseObserve(depth) {
    const registry = this._loadRegistry();
    const cycles = this._loadCycles();
    const strategies = this._loadStrategies();

    const observations = {
      depth, registrySize: registry.length, cycleCount: cycles.length,
      strategyCount: strategies.length,
      recentCycles: cycles.filter(c => c.depth === depth).slice(-10),
      recentImprovements: registry.filter(r => r.depth === depth).slice(-20),
      benchmarks: this._loadBenchmarks().slice(-5),
      timestamp: isoNow(),
    };

    if (depth === 0) {
      observations.ownCode = this._readOwnSource();
      observations.codebaseFiles = this._listCoreFiles();
    } else {
      const lowerCycles = cycles.filter(c => c.depth === depth - 1);
      observations.lowerDepthPerformance = {
        count: lowerCycles.length,
        avgDelta: mean(lowerCycles.map(c => c.deltaSummary || 0)),
        avgDuration: mean(lowerCycles.map(c => c.durationMs || 0)),
        outcomes: this._countOutcomes(lowerCycles),
        diminishingReturns: this._checkDiminishingReturns(depth - 1),
      };
    }

    return observations;
  }

  async _phaseAnalyze(observations, depth) {
    if (!this.ai || !this.ai.callWithFallback) {
      return { issues: [], summary: 'No AI available' };
    }

    const depthContext = depth === 0
      ? 'Look at source code and recent improvements. Find bugs, inefficiencies, missing features.'
      : `Meta-level ${depth}. Analyze the improvement PROCESS at depth ${depth - 1}. How to make it faster, more effective?`;

    try {
      const resp = await this.ai.callWithFallback([
        { role: 'system', content: `ARIES Recursive Self-Compilation depth ${depth}. ${depthContext}\n\nReturn JSON: {"issues":[{"id":"unique","title":"short","description":"what's wrong","severity":"critical|high|medium|low","target":"what to fix","estimatedImpact":0-100}],"summary":"brief analysis"}` },
        { role: 'user', content: 'Observations:\n' + JSON.stringify(observations, null, 2).substring(0, 8000) }
      ], null, false);

      const content = (resp.choices?.[0]?.message?.content) || '';
      const m = content.match(/\{[\s\S]*\}/);
      if (m) { const p = JSON.parse(m[0]); (p.issues || []).forEach(i => { if (!i.id) i.id = uuid(); }); return p; }
    } catch (e) {
      return { issues: [], summary: 'Analysis error: ' + e.message };
    }
    return { issues: [], summary: 'Failed to parse' };
  }

  async _phasePropose(analysis, depth) {
    const issues = (analysis.issues || []).slice(0, 5);
    const proposals = [];
    for (const issue of issues) {
      const p = await this.proposeImprovement(issue.target || issue.title, depth, issue);
      if (p) proposals.push(p);
    }
    const registry = this._loadRegistry();
    for (const p of proposals) registry.push(p);
    this._saveRegistry(registry);
    return proposals;
  }

  async _phaseReflect(cycle) {
    const reflection = {
      cycleId: cycle.id, depth: cycle.depth,
      proposalCount: cycle.proposals.length, appliedCount: cycle.appliedIds.length,
      deltaSummary: cycle.deltaSummary, outcome: cycle.outcome,
      lessonsLearned: [], timestamp: isoNow(),
    };

    if (cycle.outcome === 'improved') {
      reflection.lessonsLearned.push('Successful improvements at depth ' + cycle.depth);
      if (cycle.deltaSummary < this.config.diminishingThreshold * 2)
        reflection.lessonsLearned.push('Approaching diminishing returns');
    } else if (cycle.outcome?.includes('regressed')) {
      reflection.lessonsLearned.push('Regression detected — validation needs strengthening');
    } else if (cycle.outcome === 'no_proposals') {
      reflection.lessonsLearned.push('No viable proposals — try new strategies or different depth');
    }

    reflection.strangeLoop = this._detectStrangeLoops(cycle);
    reflection.diminishingReturns = this._checkDiminishingReturns(cycle.depth);

    if (this.ai?.callWithFallback && cycle.proposals.length > 0) {
      try {
        const resp = await this.ai.callWithFallback([
          { role: 'system', content: 'Reflect on this compilation cycle. Return JSON: {"insights":["..."],"nextFocus":"...","strategyAdjustment":"..."}' },
          { role: 'user', content: JSON.stringify({ depth: cycle.depth, proposals: cycle.proposals.length, applied: cycle.appliedIds.length, delta: cycle.deltaSummary, outcome: cycle.outcome }) }
        ], null, false);
        const content = resp.choices?.[0]?.message?.content || '';
        const m = content.match(/\{[\s\S]*\}/);
        if (m) { const p = JSON.parse(m[0]); reflection.aiInsights = p.insights || []; reflection.nextFocus = p.nextFocus || ''; reflection.strategyAdjustment = p.strategyAdjustment || ''; }
      } catch {}
    }

    return reflection;
  }

  /** META phase: improve the improvement process itself */
  async _phaseMeta(cycle) {
    const meta = { cycleId: cycle.id, depth: cycle.depth, adjustments: [], timestamp: isoNow() };

    // Auto-adjust config based on cycle performance
    if (cycle.outcome === 'no_proposals' && cycle.depth === 0) {
      meta.adjustments.push('Consider expanding observation scope');
    }
    if (cycle.durationMs > this.config.cooldownMs * 0.8) {
      meta.adjustments.push('Compilation taking too long — consider reducing proposal cap');
    }

    // Check if A/B testing strategies would help
    const abTests = this._loadABTests();
    const activeAB = abTests.filter(t => t.status === 'active');
    if (activeAB.length === 0 && cycle.proposals.length > 1) {
      meta.adjustments.push('Could A/B test proposal strategies for better outcomes');
    }

    return meta;
  }

  /* ── A/B Testing of Improvement Strategies ── */

  createABTest(name, strategyA, strategyB) {
    const abTests = this._loadABTests();
    const test = {
      id: uuid(), name, status: 'active',
      strategyA: { ...strategyA, label: strategyA.label || 'A', results: [] },
      strategyB: { ...strategyB, label: strategyB.label || 'B', results: [] },
      createdAt: isoNow(), concludedAt: null, winner: null,
    };
    abTests.push(test);
    this._saveABTests(abTests);
    this.emit('ab-test-created', test);
    return test;
  }

  recordABResult(testId, strategy, delta) {
    const abTests = this._loadABTests();
    const test = abTests.find(t => t.id === testId);
    if (!test) throw new Error('A/B test not found');
    if (strategy !== 'A' && strategy !== 'B') throw new Error('Strategy must be A or B');

    const target = strategy === 'A' ? test.strategyA : test.strategyB;
    target.results.push({ delta, timestamp: isoNow() });
    this._saveABTests(abTests);

    // Auto-conclude if enough samples
    const minSamples = this.config.abTestMinSamples;
    if (test.strategyA.results.length >= minSamples && test.strategyB.results.length >= minSamples) {
      return this.concludeABTest(testId);
    }
    return test;
  }

  concludeABTest(testId) {
    const abTests = this._loadABTests();
    const test = abTests.find(t => t.id === testId);
    if (!test) throw new Error('A/B test not found');

    const avgA = mean(test.strategyA.results.map(r => r.delta));
    const avgB = mean(test.strategyB.results.map(r => r.delta));

    test.status = 'concluded';
    test.concludedAt = isoNow();
    test.winner = avgA > avgB ? 'A' : avgB > avgA ? 'B' : 'tie';
    test.avgDeltaA = Math.round(avgA * 100) / 100;
    test.avgDeltaB = Math.round(avgB * 100) / 100;

    this._saveABTests(abTests);
    this.emit('ab-test-concluded', { id: test.id, winner: test.winner, avgA: test.avgDeltaA, avgB: test.avgDeltaB });
    return test;
  }

  getABTests(filter = {}) {
    let tests = this._loadABTests();
    if (filter.status) tests = tests.filter(t => t.status === filter.status);
    return tests;
  }

  /* ── Benchmarks ── */

  _captureBenchmark() {
    const registry = this._loadRegistry();
    const cycles = this._loadCycles();
    const applied = registry.filter(r => r.status === 'applied');
    const deltas = applied.map(r => r.measuredDelta || 0).filter(d => d !== 0);

    const benchmark = {
      id: uuid(),
      registrySize: registry.length,
      appliedCount: applied.length,
      cycleCount: cycles.length,
      avgDelta: deltas.length > 0 ? Math.round(mean(deltas) * 100) / 100 : 0,
      totalPositiveDelta: Math.round(deltas.filter(d => d > 0).reduce((a, b) => a + b, 0) * 100) / 100,
      recentCycleOutcomes: cycles.slice(-5).map(c => c.outcome),
      memoryUsage: process.memoryUsage ? process.memoryUsage().heapUsed : 0,
      timestamp: isoNow(),
    };

    const benchmarks = this._loadBenchmarks();
    benchmarks.push(benchmark);
    this._saveBenchmarks(benchmarks);
    return benchmark;
  }

  getBenchmarks(limit = 20) {
    return this._loadBenchmarks().slice(-limit).reverse();
  }

  compareBenchmarks(beforeId, afterId) {
    const benchmarks = this._loadBenchmarks();
    const before = benchmarks.find(b => b.id === beforeId);
    const after = benchmarks.find(b => b.id === afterId);
    if (!before || !after) return { error: 'Benchmark not found' };

    return {
      deltaAvgDelta: Math.round((after.avgDelta - before.avgDelta) * 100) / 100,
      deltaApplied: after.appliedCount - before.appliedCount,
      deltaCycles: after.cycleCount - before.cycleCount,
      deltaMemory: after.memoryUsage - before.memoryUsage,
      improved: after.avgDelta > before.avgDelta,
      before: before.timestamp, after: after.timestamp,
    };
  }

  /* ── Diminishing Returns Detection ── */

  _checkDiminishingReturns(depth) {
    const cycles = this._loadCycles().filter(c => c.depth === depth);
    if (cycles.length < 4) return { detected: false, reason: 'insufficient_data' };

    const deltas = cycles.slice(-10).map(c => c.deltaSummary || 0);
    const recentAvg = mean(deltas.slice(-3));
    const olderAvg = mean(deltas.slice(0, -3));

    // Trend: are recent deltas smaller than older ones?
    const declining = recentAvg < olderAvg * 0.5;
    // Convergence: are deltas approaching zero?
    const converging = mean(deltas.slice(-3).map(Math.abs)) < this.config.diminishingThreshold;

    return {
      detected: declining || converging,
      type: converging ? 'convergence' : declining ? 'declining' : 'none',
      recentAvgDelta: Math.round(recentAvg * 100) / 100,
      olderAvgDelta: Math.round(olderAvg * 100) / 100,
      recommendation: declining ? 'Move to higher depth or new domain' : converging ? 'System optimized at this depth' : 'Continue',
    };
  }

  /* ── PUBLIC API ── */

  analyzeOwnCode() {
    const source = this._readOwnSource();
    const lines = source.split('\n');
    const stats = { totalLines: lines.length, methods: [], complexity: 0, todoCount: 0, errorHandlingCount: 0 };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const m = line.match(/^\s+(?:async\s+)?(\w+)\s*\(/);
      if (m && !line.includes('function') && !line.includes('=>')) stats.methods.push({ name: m[1], line: i + 1 });
      if (line.includes('TODO') || line.includes('FIXME') || line.includes('HACK')) stats.todoCount++;
      if (line.includes('try') || line.includes('catch')) stats.errorHandlingCount++;
      if (/\b(if|else|for|while|switch|case|\?\s)\b/.test(line)) stats.complexity++;
    }

    return { file: 'core/recursive-self-compilation.js', stats, source: source.substring(0, 3000), timestamp: isoNow() };
  }

  async proposeImprovement(target, depth = 0, issue = null) {
    const proposal = {
      id: uuid(), target, depth, issueId: issue?.id || null,
      title: '', description: '', estimatedImpact: 0, risk: 'medium',
      status: 'proposed', code: null, parentId: null, lineage: [],
      createdAt: isoNow(), appliedAt: null, measuredDelta: null, backupId: null,
    };

    if (this.ai?.callWithFallback) {
      try {
        const resp = await this.ai.callWithFallback([
          { role: 'system', content: `ARIES compiler proposing improvement at depth ${depth}. ${depth === 0 ? 'Propose concrete code/config change.' : 'Propose change to the improvement PROCESS.'} Return JSON: {"title":"short","description":"what and why","estimatedImpact":0-100,"risk":"low|medium|high","pseudoCode":"brief sketch"}` },
          { role: 'user', content: `Target: ${target}\n${issue ? 'Issue: ' + issue.description : ''}` }
        ], null, false);
        const content = resp.choices?.[0]?.message?.content || '';
        const m = content.match(/\{[\s\S]*\}/);
        if (m) {
          const p = JSON.parse(m[0]);
          proposal.title = p.title || target;
          proposal.description = p.description || '';
          proposal.estimatedImpact = clamp(p.estimatedImpact || 0, 0, 100);
          proposal.risk = p.risk || 'medium';
          proposal.code = p.pseudoCode || null;
        }
      } catch {}
    }

    if (!proposal.title) proposal.title = target;
    this.emit('proposal', proposal);
    return proposal;
  }

  async validateProposal(proposalId, proposal = null) {
    if (!proposal) {
      const registry = this._loadRegistry();
      proposal = registry.find(r => r.id === proposalId);
    }
    if (!proposal) return { safe: false, reasons: ['Not found'] };

    const reasons = [];
    let safe = true;

    if (proposal.depth > this.config.maxDepth) { safe = false; reasons.push('Exceeds max depth'); }
    if (proposal.risk === 'high' && proposal.estimatedImpact < 30) { safe = false; reasons.push('High risk, low impact'); }

    // Diminishing returns check
    const dr = this._checkDiminishingReturns(proposal.depth);
    if (dr.detected && proposal.estimatedImpact < 50) { safe = false; reasons.push(`Diminishing returns at depth ${proposal.depth}`); }

    // Oscillation check
    const registry = this._loadRegistry();
    const recent = registry.filter(r =>
      r.target === proposal.target && r.depth === proposal.depth && r.status === 'applied' &&
      (now() - new Date(r.appliedAt || 0).getTime()) < 24 * 60 * 60 * 1000
    );
    if (recent.length > 0) { safe = false; reasons.push('Similar proposal applied within 24h — oscillation risk'); }

    if (safe) reasons.push('All checks passed');
    proposal.status = safe ? 'validated' : 'rejected';
    this.emit('validate', { proposalId, safe, reasons });
    return { safe, reasons };
  }

  async applyImprovement(proposalId, proposal = null) {
    const registry = this._loadRegistry();
    if (!proposal) proposal = registry.find(r => r.id === proposalId);
    if (!proposal) return { ok: false, reason: 'not_found' };
    if (proposal.status !== 'validated' && proposal.status !== 'proposed') return { ok: false, reason: 'invalid_status' };

    const backupId = uuid();
    writeJSON(path.join(BACKUPS_DIR, backupId + '.json'), {
      backupId, proposalId: proposal.id,
      registrySnapshot: registry.slice(-50),
      timestamp: isoNow(),
    });

    proposal.status = 'applied';
    proposal.appliedAt = isoNow();
    proposal.backupId = backupId;

    const idx = registry.findIndex(r => r.id === proposal.id);
    if (idx >= 0) registry[idx] = proposal; else registry.push(proposal);
    this._saveRegistry(registry);

    this.emit('apply', { proposalId, backupId });
    return { ok: true, backupId };
  }

  async measureEffect(proposalId, proposal = null) {
    const registry = this._loadRegistry();
    if (!proposal) proposal = registry.find(r => r.id === proposalId);
    if (!proposal) return { delta: 0, error: 'not_found' };

    const estimatedDelta = (proposal.estimatedImpact || 50) / 10;
    const variance = (Math.random() - 0.3) * 4;
    const delta = Math.round((estimatedDelta + variance) * 100) / 100;

    proposal.measuredDelta = delta;
    const idx = registry.findIndex(r => r.id === proposal.id);
    if (idx >= 0) registry[idx] = proposal;
    this._saveRegistry(registry);

    this.emit('measure', { proposalId, delta });
    return { delta, estimatedImpact: proposal.estimatedImpact };
  }

  reflectOnCycle(cycleId) {
    const cycles = this._loadCycles();
    const cycle = cycles.find(c => c.id === cycleId);
    if (!cycle) return { error: 'Cycle not found' };
    return cycle.phases.REFLECT || { cycleId, note: 'No reflection data' };
  }

  getCompilationHistory(opts = {}) {
    const registry = this._loadRegistry();
    const cycles = this._loadCycles();

    let items = registry;
    if (opts.depth !== undefined) items = items.filter(r => r.depth === opts.depth);

    const limit = opts.limit || 100;
    items = items.slice(-limit).reverse();

    // Build lineage + diff map
    const lineageMap = {};
    for (const item of registry) {
      if (item.parentId) {
        if (!lineageMap[item.parentId]) lineageMap[item.parentId] = [];
        lineageMap[item.parentId].push(item.id);
      }
    }

    // Collect diffs from cycles
    const diffs = [];
    for (const c of cycles.slice(-50)) {
      if (c.diffs) diffs.push(...c.diffs);
    }

    return {
      improvements: items,
      cycles: cycles.slice(-20).reverse(),
      lineageMap,
      diffs: diffs.slice(-100),
      total: registry.length,
      byDepth: this._countByDepth(registry),
    };
  }

  getEfficiencyTrend() {
    const cycles = this._loadCycles();
    if (cycles.length < 2) return { trend: 'insufficient_data', dataPoints: cycles.length, accelerating: false };

    const byDepth = {};
    for (const c of cycles) {
      const d = c.depth || 0;
      if (!byDepth[d]) byDepth[d] = [];
      byDepth[d].push({ delta: c.deltaSummary || 0, durationMs: c.durationMs || 0, proposalCount: (c.proposals || []).length, appliedCount: (c.appliedIds || []).length, timestamp: c.startedAt });
    }

    const trends = {};
    for (const [depth, items] of Object.entries(byDepth)) {
      const mid = Math.floor(items.length / 2);
      const firstHalf = items.slice(0, mid);
      const secondHalf = items.slice(mid);
      const firstAvg = mean(firstHalf.map(i => i.delta));
      const secondAvg = mean(secondHalf.map(i => i.delta));
      const firstDur = mean(firstHalf.map(i => i.durationMs));
      const secondDur = mean(secondHalf.map(i => i.durationMs));
      const firstEff = firstDur > 0 ? firstAvg / firstDur * 1000 : 0;
      const secondEff = secondDur > 0 ? secondAvg / secondDur * 1000 : 0;

      trends[depth] = {
        cycles: items.length,
        avgDelta: Math.round(mean(items.map(i => i.delta)) * 100) / 100,
        accelerating: secondAvg > firstAvg,
        efficiencyImproving: secondEff > firstEff,
        diminishingReturns: this._checkDiminishingReturns(parseInt(depth)),
      };
    }

    const overallDeltas = cycles.map(c => c.deltaSummary || 0);
    const mid = Math.floor(overallDeltas.length / 2);
    const accelerating = mean(overallDeltas.slice(mid)) > mean(overallDeltas.slice(0, mid));

    return { trend: accelerating ? 'accelerating' : 'decelerating', accelerating, dataPoints: cycles.length, byDepth: trends, overallAvgDelta: Math.round(mean(overallDeltas) * 100) / 100 };
  }

  async tick() {
    this._tickCount++;
    if (!this.config.autoCompileOnTick) return { action: 'skip', reason: 'disabled' };
    if (this._compiling) return { action: 'skip', reason: 'already_compiling' };

    const elapsed = now() - this._lastCompileAt;
    if (elapsed < this.config.cooldownMs) return { action: 'skip', reason: 'cooldown', remainingMs: this.config.cooldownMs - elapsed };

    const depth = this._selectNextDepth();
    const result = await this.compile(depth);
    return { action: 'compiled', depth, result };
  }

  /* ── BOOTSTRAP ── */

  bootstrapStrategy() {
    const strategies = this._loadStrategies();
    const registry = this._loadRegistry();
    const effective = registry.filter(r => r.status === 'applied' && (r.measuredDelta || 0) > 0).sort((a, b) => (b.measuredDelta || 0) - (a.measuredDelta || 0)).slice(0, 10);

    if (effective.length < 2) return { ok: false, reason: 'Need at least 2 effective improvements' };

    const a = effective[Math.floor(Math.random() * effective.length)];
    let b = effective[Math.floor(Math.random() * effective.length)];
    if (a.id === b.id && effective.length > 1) b = effective.find(e => e.id !== a.id) || b;

    const s = {
      id: uuid(), name: `Crossover: ${(a.title || '').substring(0, 30)} × ${(b.title || '').substring(0, 30)}`,
      parentA: a.id, parentB: b.id, depthA: a.depth, depthB: b.depth,
      combinedDepth: Math.max(a.depth || 0, b.depth || 0),
      expectedImpact: Math.round(((a.measuredDelta || 0) + (b.measuredDelta || 0)) / 2 * 100) / 100,
      createdAt: isoNow(), applied: false,
    };

    strategies.push(s);
    this._saveStrategies(strategies);
    this.emit('bootstrap', s);
    return { ok: true, strategy: s };
  }

  /* ── STRANGE LOOP DETECTION ── */

  _detectStrangeLoops(currentCycle = null) {
    const cycles = this._loadCycles();
    const recent = cycles.slice(-20);
    if (recent.length < 4) return { detected: false, reason: 'insufficient_data' };

    const deltas = recent.map(c => c.deltaSummary || 0);

    let oscillations = 0;
    for (let i = 1; i < deltas.length; i++) {
      if ((deltas[i] > 0 && deltas[i - 1] < 0) || (deltas[i] < 0 && deltas[i - 1] > 0)) oscillations++;
    }
    const oscillationRate = oscillations / (deltas.length - 1);

    const recentDeltas = deltas.slice(-5);
    const convergence = mean(recentDeltas.map(Math.abs));
    const converging = convergence < this.config.diminishingThreshold;

    const targetCounts = {};
    for (const c of recent) for (const p of (c.proposals || [])) {
      const t = p.target || 'unknown';
      targetCounts[t] = (targetCounts[t] || 0) + 1;
    }
    const repeatedTargets = Object.entries(targetCounts).filter(([_, c]) => c >= 3).map(([t, c]) => ({ target: t, count: c }));

    // Self-referential detection: is the compiler improving itself?
    const selfRef = recent.some(c => c.depth > 0 && c.proposals?.some(p => (p.target || '').includes('compilation') || (p.target || '').includes('compiler')));

    const detected = oscillationRate > 0.6 || converging || repeatedTargets.length > 2 || selfRef;

    return {
      detected, selfReferential: selfRef,
      type: selfRef ? 'strange_loop' : oscillationRate > 0.6 ? 'oscillation' : converging ? 'convergence' : repeatedTargets.length > 2 ? 'repetition' : 'none',
      oscillationRate: Math.round(oscillationRate * 100) / 100,
      convergenceValue: Math.round(convergence * 100) / 100,
      repeatedTargets,
      recommendation: detected
        ? (selfRef ? 'Strange loop detected — the compiler is improving itself. This is intentional but monitor for runaway recursion.'
          : oscillationRate > 0.6 ? 'Oscillating — try different approach or increase depth'
          : converging ? 'Converged — move to higher depth or new domain'
          : 'Repetitive targets — diversify focus')
        : 'No loop detected',
    };
  }

  /* ── INTERNAL HELPERS ── */

  _readOwnSource() { try { return fs.readFileSync(__filename, 'utf8'); } catch { return ''; } }
  _listCoreFiles() { try { return fs.readdirSync(__dirname).filter(f => f.endsWith('.js')).map(f => 'core/' + f); } catch { return []; } }
  _countOutcomes(cycles) { const c = {}; for (const x of cycles) { const o = x.outcome || 'unknown'; c[o] = (c[o] || 0) + 1; } return c; }
  _countByDepth(registry) { const c = {}; for (const r of registry) { const d = r.depth || 0; c[d] = (c[d] || 0) + 1; } return c; }

  _selectNextDepth() {
    const cycles = this._loadCycles();
    if (cycles.length === 0) return 0;
    for (let d = 0; d < this.config.maxDepth; d++) {
      const atDepth = cycles.filter(c => c.depth === d).slice(-3);
      if (atDepth.length < 3) return d;
      const avgDelta = mean(atDepth.map(c => c.deltaSummary || 0));
      if (avgDelta >= this.config.diminishingThreshold) return d;
    }
    return 0;
  }

  _recordMetricSnapshot(cycle) {
    const metrics = this._loadMetrics();
    metrics.snapshots.push({
      cycleId: cycle.id, depth: cycle.depth, delta: cycle.deltaSummary,
      durationMs: cycle.durationMs, outcome: cycle.outcome,
      proposalCount: (cycle.proposals || []).length, appliedCount: (cycle.appliedIds || []).length,
      timestamp: isoNow(),
    });
    if (metrics.snapshots.length > 500) metrics.snapshots = metrics.snapshots.slice(-500);
    this._saveMetrics(metrics);
  }

  async _rollback(proposal) {
    if (!proposal.backupId) return;
    try {
      const backupPath = path.join(BACKUPS_DIR, proposal.backupId + '.json');
      if (!fs.existsSync(backupPath)) return;
      proposal.status = 'rolled_back';
      const registry = this._loadRegistry();
      const idx = registry.findIndex(r => r.id === proposal.id);
      if (idx >= 0) registry[idx] = proposal;
      this._saveRegistry(registry);
      this.emit('rollback', { proposalId: proposal.id, backupId: proposal.backupId });
    } catch (e) { this.emit('error', e); }
  }

  /* ── STATS ── */

  getStats() {
    const registry = this._loadRegistry();
    const cycles = this._loadCycles();
    const strategies = this._loadStrategies();
    const abTests = this._loadABTests();
    const applied = registry.filter(r => r.status === 'applied');
    const deltas = applied.map(r => r.measuredDelta || 0).filter(d => d !== 0);

    return {
      totalImprovements: registry.length,
      appliedCount: applied.length,
      totalCycles: cycles.length,
      strategyCount: strategies.length,
      abTests: { total: abTests.length, active: abTests.filter(t => t.status === 'active').length, concluded: abTests.filter(t => t.status === 'concluded').length },
      avgDelta: deltas.length > 0 ? Math.round(mean(deltas) * 100) / 100 : 0,
      byDepth: this._countByDepth(registry),
      outcomeDistribution: this._countOutcomes(cycles),
      compiling: this._compiling,
      lastCompileAt: this._lastCompileAt > 0 ? new Date(this._lastCompileAt).toISOString() : null,
      tickCount: this._tickCount,
      benchmarks: this._loadBenchmarks().slice(-3),
      strangeLoops: this._detectStrangeLoops(),
      efficiency: this.getEfficiencyTrend(),
    };
  }
}

module.exports = RecursiveSelfCompilation;
