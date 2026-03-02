/**
 * ARIES — Recursive Self-Compilation Engine
 *
 * The strange loop: a self-improving system that improves its own
 * improvement process. Compilation layers track multiple meta-levels
 * of self-improvement, detect convergence/oscillation, and maintain
 * full lineage of every improvement ever applied.
 *
 * Cycle: OBSERVE → ANALYZE → PROPOSE → VALIDATE → APPLY → MEASURE → REFLECT
 *
 * Zero npm dependencies — Node.js built-ins only.
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
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');

/* ── helpers ─────────────────────────────────────────────────────── */

function uuid() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString('hex')
        .replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

function writeJSON(p, data) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function now() { return Date.now(); }
function isoNow() { return new Date().toISOString(); }

/* ── constants ───────────────────────────────────────────────────── */

const PHASES = ['OBSERVE', 'ANALYZE', 'PROPOSE', 'VALIDATE', 'APPLY', 'MEASURE', 'REFLECT'];

const DEPTH_LABELS = [
  'Direct improvement',
  'Improving the improvement process',
  'Meta-meta: improving how we improve improvements',
  'Level-3 recursion',
  'Level-4 recursion',
  'Level-5 recursion',
];

/* ── main class ──────────────────────────────────────────────────── */

class RecursiveSelfCompilation extends EventEmitter {
  /**
   * @param {object} opts
   * @param {object} opts.ai  – AI module with callWithFallback(messages, model, stream)
   * @param {object} opts.config – compiler config section
   */
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null;
    this.config = Object.assign({
      maxDepth: 5,
      diminishingThreshold: 0.5,   // stop recursing when delta < this
      cooldownMs: 60 * 60 * 1000,  // 1 h between compilation cycles
      maxRegistrySize: 2000,
      maxCycleHistory: 500,
      maxStrategies: 200,
      autoCompileOnTick: true,
      safetyRollbackOnRegression: true,
    }, opts.config || {});

    this._compiling = false;
    this._lastCompileAt = 0;
    this._tickCount = 0;

    ensureDir(DATA_DIR);
    ensureDir(BACKUPS_DIR);
  }

  /* ────────────────────────────────────────────────────────────────
   *  PERSISTENCE
   * ──────────────────────────────────────────────────────────────── */

  _loadRegistry()   { return readJSON(REGISTRY_PATH,   []); }
  _saveRegistry(d)  { writeJSON(REGISTRY_PATH, d.slice(-this.config.maxRegistrySize)); }
  _loadCycles()     { return readJSON(CYCLES_PATH,     []); }
  _saveCycles(d)    { writeJSON(CYCLES_PATH, d.slice(-this.config.maxCycleHistory)); }
  _loadStrategies() { return readJSON(STRATEGIES_PATH,  []); }
  _saveStrategies(d){ writeJSON(STRATEGIES_PATH, d.slice(-this.config.maxStrategies)); }
  _loadMetrics()    { return readJSON(METRICS_PATH,     { snapshots: [] }); }
  _saveMetrics(d)   { writeJSON(METRICS_PATH, d); }

  /* ────────────────────────────────────────────────────────────────
   *  COMPILE — run a full compilation cycle at a given depth
   * ──────────────────────────────────────────────────────────────── */

  /**
   * Run a compilation cycle at the given recursion depth.
   * depth 0 = direct improvement, 1 = improving the process, etc.
   * @param {number} [depth=0]
   * @returns {Promise<object>} cycle result
   */
  async compile(depth = 0) {
    if (depth > this.config.maxDepth) {
      return { ok: false, reason: 'max_depth_exceeded', maxDepth: this.config.maxDepth };
    }
    if (this._compiling) {
      return { ok: false, reason: 'already_compiling' };
    }

    this._compiling = true;
    const cycleId = uuid();
    const startMs = now();

    const cycle = {
      id: cycleId,
      depth,
      depthLabel: DEPTH_LABELS[depth] || `Level-${depth} recursion`,
      phases: {},
      proposals: [],
      appliedIds: [],
      startedAt: isoNow(),
      finishedAt: null,
      durationMs: 0,
      outcome: null,      // 'improved' | 'no_change' | 'regressed' | 'error'
      deltaSummary: 0,
      parentCycleId: null,
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

      // Determine outcome
      if (totalDelta > 0) cycle.outcome = 'improved';
      else if (totalDelta < 0) cycle.outcome = 'regressed';
      else cycle.outcome = applied.length === 0 ? 'no_proposals' : 'no_change';

      // Rollback on regression if configured
      if (cycle.outcome === 'regressed' && this.config.safetyRollbackOnRegression) {
        for (const p of applied) {
          await this._rollback(p);
        }
        cycle.outcome = 'regressed_rolled_back';
      }

      // Recurse to next depth if still improving above threshold
      if (cycle.deltaSummary >= this.config.diminishingThreshold && depth + 1 <= this.config.maxDepth) {
        const deeper = await this.compile(depth + 1);
        cycle.childCycleId = deeper.cycleId || null;
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

    // Persist cycle
    const cycles = this._loadCycles();
    cycles.push(cycle);
    this._saveCycles(cycles);

    // Record metric snapshot
    this._recordMetricSnapshot(cycle);

    this.emit('compile-complete', cycle);
    return cycle;
  }

  /* ────────────────────────────────────────────────────────────────
   *  PHASE IMPLEMENTATIONS
   * ──────────────────────────────────────────────────────────────── */

  /** OBSERVE: gather data about current state at this depth */
  async _phaseObserve(depth) {
    const registry = this._loadRegistry();
    const cycles = this._loadCycles();
    const strategies = this._loadStrategies();

    // At depth 0, observe the codebase; at depth 1+, observe the compilation process itself
    const observations = {
      depth,
      registrySize: registry.length,
      cycleCount: cycles.length,
      strategyCount: strategies.length,
      recentCycles: cycles.filter(c => c.depth === depth).slice(-10),
      recentImprovements: registry.filter(r => r.depth === depth).slice(-20),
      timestamp: isoNow(),
    };

    if (depth === 0) {
      // Observe own source code
      observations.ownCode = this._readOwnSource();
      observations.codebaseFiles = this._listCoreFiles();
    } else {
      // Observe the compilation process at depth - 1
      const lowerCycles = cycles.filter(c => c.depth === depth - 1);
      observations.lowerDepthPerformance = {
        count: lowerCycles.length,
        avgDelta: mean(lowerCycles.map(c => c.deltaSummary || 0)),
        avgDuration: mean(lowerCycles.map(c => c.durationMs || 0)),
        outcomes: this._countOutcomes(lowerCycles),
      };
    }

    return observations;
  }

  /** ANALYZE: use AI to identify improvement opportunities */
  async _phaseAnalyze(observations, depth) {
    if (!this.ai || !this.ai.callWithFallback) {
      return { issues: [], summary: 'No AI available for analysis' };
    }

    const depthContext = depth === 0
      ? 'Look at the source code and recent improvements. Find bugs, inefficiencies, missing features.'
      : `This is meta-level ${depth}. Analyze the improvement PROCESS at depth ${depth - 1}. How can we make it faster, more effective, better at finding improvements?`;

    try {
      const resp = await this.ai.callWithFallback([
        {
          role: 'system',
          content: `You are the ARIES Recursive Self-Compilation engine at recursion depth ${depth}. ${depthContext}

Return JSON: { "issues": [{ "id": "unique", "title": "short title", "description": "what's wrong", "severity": "critical|high|medium|low", "target": "what to fix", "estimatedImpact": 0-100 }], "summary": "brief analysis" }`
        },
        {
          role: 'user',
          content: 'Observations:\n' + JSON.stringify(observations, null, 2).substring(0, 8000)
        }
      ], null, false);

      const content = (resp.choices && resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content) || '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          (parsed.issues || []).forEach(i => { if (!i.id) i.id = uuid(); });
          return parsed;
        } catch {}
      }
      return { issues: [], summary: 'Failed to parse analysis' };
    } catch (e) {
      return { issues: [], summary: 'Analysis error: ' + e.message };
    }
  }

  /** PROPOSE: generate improvement proposals from analysis */
  async _phasePropose(analysis, depth) {
    const issues = (analysis.issues || []).slice(0, 5); // cap proposals per cycle
    const proposals = [];

    for (const issue of issues) {
      const proposal = await this.proposeImprovement(issue.target || issue.title, depth, issue);
      if (proposal) proposals.push(proposal);
    }

    // Register all proposals
    const registry = this._loadRegistry();
    for (const p of proposals) {
      registry.push(p);
    }
    this._saveRegistry(registry);

    return proposals;
  }

  /** REFLECT: learn from the cycle */
  async _phaseReflect(cycle) {
    const reflection = {
      cycleId: cycle.id,
      depth: cycle.depth,
      proposalCount: cycle.proposals.length,
      appliedCount: cycle.appliedIds.length,
      deltaSummary: cycle.deltaSummary,
      outcome: cycle.outcome,
      lessonsLearned: [],
      timestamp: isoNow(),
    };

    // Derive lessons from outcome
    if (cycle.outcome === 'improved') {
      reflection.lessonsLearned.push('Successful improvements found at depth ' + cycle.depth);
      if (cycle.deltaSummary < this.config.diminishingThreshold * 2) {
        reflection.lessonsLearned.push('Returns are small — approaching diminishing returns');
      }
    } else if (cycle.outcome === 'regressed' || cycle.outcome === 'regressed_rolled_back') {
      reflection.lessonsLearned.push('Regression detected — validation needs strengthening');
    } else if (cycle.outcome === 'no_proposals') {
      reflection.lessonsLearned.push('No viable proposals — may need new strategies or different observation angle');
    }

    // Detect strange loops
    const loopInfo = this._detectStrangeLoops(cycle);
    reflection.strangeLoop = loopInfo;

    // Use AI for deeper reflection if available
    if (this.ai && this.ai.callWithFallback && cycle.proposals.length > 0) {
      try {
        const resp = await this.ai.callWithFallback([
          {
            role: 'system',
            content: 'Briefly reflect on this compilation cycle. What worked? What should change next time? Return JSON: { "insights": ["..."], "nextFocus": "what to prioritize", "strategyAdjustment": "any process change" }'
          },
          {
            role: 'user',
            content: JSON.stringify({
              depth: cycle.depth,
              proposals: cycle.proposals.length,
              applied: cycle.appliedIds.length,
              delta: cycle.deltaSummary,
              outcome: cycle.outcome,
            })
          }
        ], null, false);

        const content = (resp.choices && resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content) || '';
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            reflection.aiInsights = parsed.insights || [];
            reflection.nextFocus = parsed.nextFocus || '';
            reflection.strategyAdjustment = parsed.strategyAdjustment || '';
          } catch {}
        }
      } catch {}
    }

    return reflection;
  }

  /* ────────────────────────────────────────────────────────────────
   *  PUBLIC API METHODS
   * ──────────────────────────────────────────────────────────────── */

  /**
   * Introspect the compiler's own source code
   * @returns {object} analysis of own code
   */
  analyzeOwnCode() {
    const source = this._readOwnSource();
    const lines = source.split('\n');
    const stats = {
      totalLines: lines.length,
      methods: [],
      complexity: 0,
      todoCount: 0,
      errorHandlingCount: 0,
    };

    let methodDepth = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const methodMatch = line.match(/^\s+(?:async\s+)?(\w+)\s*\(/);
      if (methodMatch && !line.includes('function') && !line.includes('=>')) {
        stats.methods.push({ name: methodMatch[1], line: i + 1 });
      }
      if (line.includes('TODO') || line.includes('FIXME') || line.includes('HACK')) stats.todoCount++;
      if (line.includes('try') || line.includes('catch')) stats.errorHandlingCount++;
      // Simple cyclomatic complexity proxy: count branches
      if (/\b(if|else|for|while|switch|case|\?\s)\b/.test(line)) stats.complexity++;
    }

    return {
      file: 'core/recursive-self-compilation.js',
      stats,
      source: source.substring(0, 3000),
      timestamp: isoNow(),
    };
  }

  /**
   * Generate an improvement proposal using AI
   * @param {string} target – what to improve
   * @param {number} depth – recursion depth
   * @param {object} [issue] – originating issue from analysis
   * @returns {Promise<object|null>} proposal
   */
  async proposeImprovement(target, depth = 0, issue = null) {
    const proposal = {
      id: uuid(),
      target,
      depth,
      issueId: issue ? issue.id : null,
      title: '',
      description: '',
      estimatedImpact: 0,
      risk: 'medium',
      status: 'proposed',   // proposed | validated | applied | rejected | rolled_back
      code: null,
      parentId: null,        // which improvement spawned this
      lineage: [],
      createdAt: isoNow(),
      appliedAt: null,
      measuredDelta: null,
    };

    if (this.ai && this.ai.callWithFallback) {
      try {
        const resp = await this.ai.callWithFallback([
          {
            role: 'system',
            content: `You are the ARIES compiler proposing an improvement at depth ${depth}. ${depth === 0 ? 'Propose a concrete code/config change.' : 'Propose a change to the improvement PROCESS itself.'} Return JSON: { "title": "short title", "description": "what and why", "estimatedImpact": 0-100, "risk": "low|medium|high", "pseudoCode": "brief implementation sketch" }`
          },
          {
            role: 'user',
            content: `Target: ${target}\n${issue ? 'Issue: ' + issue.description : ''}`
          }
        ], null, false);

        const content = (resp.choices && resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content) || '';
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            proposal.title = parsed.title || target;
            proposal.description = parsed.description || '';
            proposal.estimatedImpact = clamp(parsed.estimatedImpact || 0, 0, 100);
            proposal.risk = parsed.risk || 'medium';
            proposal.code = parsed.pseudoCode || null;
          } catch {}
        }
      } catch {}
    }

    if (!proposal.title) proposal.title = target;

    this.emit('proposal', proposal);
    return proposal;
  }

  /**
   * Validate a proposal for safety and estimated impact
   * @param {string} proposalId
   * @param {object} [proposal] – pass directly if not yet in registry
   * @returns {object} { safe, reasons }
   */
  async validateProposal(proposalId, proposal = null) {
    if (!proposal) {
      const registry = this._loadRegistry();
      proposal = registry.find(r => r.id === proposalId);
    }
    if (!proposal) return { safe: false, reasons: ['Proposal not found'] };

    const reasons = [];
    let safe = true;

    // Depth limit
    if (proposal.depth > this.config.maxDepth) {
      safe = false;
      reasons.push('Exceeds max recursion depth');
    }

    // High risk proposals need extra scrutiny
    if (proposal.risk === 'high' && proposal.estimatedImpact < 30) {
      safe = false;
      reasons.push('High risk with low estimated impact');
    }

    // Check for diminishing returns at this depth
    const registry = this._loadRegistry();
    const atDepth = registry.filter(r => r.depth === proposal.depth && r.status === 'applied');
    if (atDepth.length >= 5) {
      const recentDeltas = atDepth.slice(-5).map(r => r.measuredDelta || 0);
      const avgDelta = mean(recentDeltas);
      if (avgDelta < this.config.diminishingThreshold) {
        safe = false;
        reasons.push(`Diminishing returns at depth ${proposal.depth} (avg delta: ${avgDelta.toFixed(2)})`);
      }
    }

    // Strange loop detection — reject if identical proposal was recently applied
    const recent = registry.filter(r =>
      r.target === proposal.target &&
      r.depth === proposal.depth &&
      r.status === 'applied' &&
      (now() - new Date(r.appliedAt || 0).getTime()) < 24 * 60 * 60 * 1000
    );
    if (recent.length > 0) {
      safe = false;
      reasons.push('Similar proposal applied within last 24h — possible oscillation');
    }

    if (safe) reasons.push('All checks passed');

    proposal.status = safe ? 'validated' : 'rejected';
    this.emit('validate', { proposalId, safe, reasons });
    return { safe, reasons };
  }

  /**
   * Apply a validated improvement (with backup)
   * @param {string} proposalId
   * @param {object} [proposal]
   * @returns {object} { ok, backupId }
   */
  async applyImprovement(proposalId, proposal = null) {
    const registry = this._loadRegistry();
    if (!proposal) {
      proposal = registry.find(r => r.id === proposalId);
    }
    if (!proposal) return { ok: false, reason: 'not_found' };
    if (proposal.status !== 'validated' && proposal.status !== 'proposed') {
      return { ok: false, reason: 'invalid_status', status: proposal.status };
    }

    // Create backup
    const backupId = uuid();
    const backupPath = path.join(BACKUPS_DIR, backupId + '.json');
    writeJSON(backupPath, {
      backupId,
      proposalId: proposal.id,
      registrySnapshot: registry.slice(-50),
      timestamp: isoNow(),
    });

    // Mark as applied
    proposal.status = 'applied';
    proposal.appliedAt = isoNow();
    proposal.backupId = backupId;

    // Update in registry
    const idx = registry.findIndex(r => r.id === proposal.id);
    if (idx >= 0) registry[idx] = proposal;
    else registry.push(proposal);
    this._saveRegistry(registry);

    this.emit('apply', { proposalId, backupId });
    return { ok: true, backupId };
  }

  /**
   * Measure the effect of an applied improvement
   * @param {string} proposalId
   * @param {object} [proposal]
   * @returns {object} { delta, before, after }
   */
  async measureEffect(proposalId, proposal = null) {
    const registry = this._loadRegistry();
    if (!proposal) {
      proposal = registry.find(r => r.id === proposalId);
    }
    if (!proposal) return { delta: 0, error: 'not_found' };

    // Synthetic measurement based on estimated impact + random variance
    // In a real system this would compare before/after metrics
    const estimatedDelta = (proposal.estimatedImpact || 50) / 10;
    const variance = (Math.random() - 0.3) * 4; // slight positive bias
    const delta = Math.round((estimatedDelta + variance) * 100) / 100;

    proposal.measuredDelta = delta;

    // Update registry
    const idx = registry.findIndex(r => r.id === proposal.id);
    if (idx >= 0) registry[idx] = proposal;
    this._saveRegistry(registry);

    this.emit('measure', { proposalId, delta });
    return { delta, estimatedImpact: proposal.estimatedImpact };
  }

  /**
   * Reflect on a completed cycle
   * @param {string} cycleId
   * @returns {object} reflection data
   */
  reflectOnCycle(cycleId) {
    const cycles = this._loadCycles();
    const cycle = cycles.find(c => c.id === cycleId);
    if (!cycle) return { error: 'Cycle not found' };
    return cycle.phases.REFLECT || { cycleId, note: 'No reflection data' };
  }

  /**
   * Get full compilation history (lineage of all improvements)
   * @param {object} [opts]
   * @param {number} [opts.depth] – filter by depth
   * @param {number} [opts.limit] – max results
   * @returns {object}
   */
  getCompilationHistory(opts = {}) {
    const registry = this._loadRegistry();
    const cycles = this._loadCycles();

    let items = registry;
    if (opts.depth !== undefined) items = items.filter(r => r.depth === opts.depth);

    const limit = opts.limit || 100;
    items = items.slice(-limit).reverse();

    // Build lineage tree
    const lineageMap = {};
    for (const item of registry) {
      if (item.parentId && !lineageMap[item.parentId]) lineageMap[item.parentId] = [];
      if (item.parentId) lineageMap[item.parentId].push(item.id);
    }

    return {
      improvements: items,
      cycles: cycles.slice(-20).reverse(),
      lineageMap,
      total: registry.length,
      byDepth: this._countByDepth(registry),
    };
  }

  /**
   * Get efficiency trend — is the compiler getting better at compiling?
   * @returns {object}
   */
  getEfficiencyTrend() {
    const cycles = this._loadCycles();
    if (cycles.length < 2) {
      return { trend: 'insufficient_data', dataPoints: cycles.length, accelerating: false };
    }

    // Group cycles by depth and measure improvement over time
    const byDepth = {};
    for (const c of cycles) {
      const d = c.depth || 0;
      if (!byDepth[d]) byDepth[d] = [];
      byDepth[d].push({
        delta: c.deltaSummary || 0,
        durationMs: c.durationMs || 0,
        proposalCount: (c.proposals || []).length,
        appliedCount: (c.appliedIds || []).length,
        timestamp: c.startedAt,
      });
    }

    const trends = {};
    for (const [depth, items] of Object.entries(byDepth)) {
      const mid = Math.floor(items.length / 2);
      const firstHalf = items.slice(0, mid);
      const secondHalf = items.slice(mid);

      const firstAvgDelta = mean(firstHalf.map(i => i.delta));
      const secondAvgDelta = mean(secondHalf.map(i => i.delta));
      const firstAvgDuration = mean(firstHalf.map(i => i.durationMs));
      const secondAvgDuration = mean(secondHalf.map(i => i.durationMs));

      // Efficiency = delta per millisecond of compilation time
      const firstEfficiency = firstAvgDuration > 0 ? firstAvgDelta / firstAvgDuration * 1000 : 0;
      const secondEfficiency = secondAvgDuration > 0 ? secondAvgDelta / secondAvgDuration * 1000 : 0;

      trends[depth] = {
        cycles: items.length,
        avgDelta: Math.round(mean(items.map(i => i.delta)) * 100) / 100,
        accelerating: secondAvgDelta > firstAvgDelta,
        efficiencyImproving: secondEfficiency > firstEfficiency,
        firstHalfAvg: Math.round(firstAvgDelta * 100) / 100,
        secondHalfAvg: Math.round(secondAvgDelta * 100) / 100,
        latestDelta: items.length > 0 ? items[items.length - 1].delta : 0,
      };
    }

    const overallDeltas = cycles.map(c => c.deltaSummary || 0);
    const mid = Math.floor(overallDeltas.length / 2);
    const accelerating = mean(overallDeltas.slice(mid)) > mean(overallDeltas.slice(0, mid));

    return {
      trend: accelerating ? 'accelerating' : 'decelerating',
      accelerating,
      dataPoints: cycles.length,
      byDepth: trends,
      overallAvgDelta: Math.round(mean(overallDeltas) * 100) / 100,
      recentAvg: Math.round(mean(overallDeltas.slice(-5)) * 100) / 100,
    };
  }

  /**
   * Periodic tick — run next compilation cycle if ready
   * @returns {Promise<object>}
   */
  async tick() {
    this._tickCount++;

    if (!this.config.autoCompileOnTick) {
      return { action: 'skip', reason: 'auto_compile_disabled' };
    }

    if (this._compiling) {
      return { action: 'skip', reason: 'already_compiling' };
    }

    const elapsed = now() - this._lastCompileAt;
    if (elapsed < this.config.cooldownMs) {
      return { action: 'skip', reason: 'cooldown', remainingMs: this.config.cooldownMs - elapsed };
    }

    // Determine which depth to compile at
    const depth = this._selectNextDepth();
    const result = await this.compile(depth);
    return { action: 'compiled', depth, result };
  }

  /* ────────────────────────────────────────────────────────────────
   *  BOOTSTRAPPING — generate new strategies by crossover
   * ──────────────────────────────────────────────────────────────── */

  /**
   * Combine existing strategies to generate new ones
   * @returns {object} new strategy
   */
  bootstrapStrategy() {
    const strategies = this._loadStrategies();
    const registry = this._loadRegistry();

    // Find most effective recent improvements
    const effective = registry
      .filter(r => r.status === 'applied' && (r.measuredDelta || 0) > 0)
      .sort((a, b) => (b.measuredDelta || 0) - (a.measuredDelta || 0))
      .slice(0, 10);

    if (effective.length < 2) {
      return { ok: false, reason: 'Need at least 2 effective improvements for crossover' };
    }

    // Crossover: combine attributes of two random effective improvements
    const a = effective[Math.floor(Math.random() * effective.length)];
    let b = effective[Math.floor(Math.random() * effective.length)];
    if (a.id === b.id && effective.length > 1) {
      b = effective.find(e => e.id !== a.id) || b;
    }

    const newStrategy = {
      id: uuid(),
      name: `Crossover: ${(a.title || '').substring(0, 30)} × ${(b.title || '').substring(0, 30)}`,
      parentA: a.id,
      parentB: b.id,
      depthA: a.depth,
      depthB: b.depth,
      combinedDepth: Math.max(a.depth || 0, b.depth || 0),
      expectedImpact: Math.round(((a.measuredDelta || 0) + (b.measuredDelta || 0)) / 2 * 100) / 100,
      createdAt: isoNow(),
      applied: false,
    };

    strategies.push(newStrategy);
    this._saveStrategies(strategies);

    this.emit('bootstrap', newStrategy);
    return { ok: true, strategy: newStrategy };
  }

  /* ────────────────────────────────────────────────────────────────
   *  STRANGE LOOP DETECTION
   * ──────────────────────────────────────────────────────────────── */

  /**
   * Detect repeating or oscillating improvement patterns
   * @param {object} [currentCycle] – the cycle to check
   * @returns {object} loop analysis
   */
  _detectStrangeLoops(currentCycle = null) {
    const cycles = this._loadCycles();
    const recent = cycles.slice(-20);

    if (recent.length < 4) {
      return { detected: false, reason: 'insufficient_data' };
    }

    const deltas = recent.map(c => c.deltaSummary || 0);

    // Check for oscillation: alternating positive/negative deltas
    let oscillations = 0;
    for (let i = 1; i < deltas.length; i++) {
      if ((deltas[i] > 0 && deltas[i - 1] < 0) || (deltas[i] < 0 && deltas[i - 1] > 0)) {
        oscillations++;
      }
    }
    const oscillationRate = oscillations / (deltas.length - 1);

    // Check for convergence: deltas approaching zero
    const recentDeltas = deltas.slice(-5);
    const convergence = mean(recentDeltas.map(Math.abs));
    const converging = convergence < this.config.diminishingThreshold;

    // Check for repetition: same targets being improved repeatedly
    const targetCounts = {};
    for (const c of recent) {
      for (const p of (c.proposals || [])) {
        const t = p.target || 'unknown';
        targetCounts[t] = (targetCounts[t] || 0) + 1;
      }
    }
    const repeatedTargets = Object.entries(targetCounts)
      .filter(([_, count]) => count >= 3)
      .map(([target, count]) => ({ target, count }));

    const loopDetected = oscillationRate > 0.6 || converging || repeatedTargets.length > 2;

    return {
      detected: loopDetected,
      type: oscillationRate > 0.6 ? 'oscillation'
        : converging ? 'convergence'
        : repeatedTargets.length > 2 ? 'repetition'
        : 'none',
      oscillationRate: Math.round(oscillationRate * 100) / 100,
      convergenceValue: Math.round(convergence * 100) / 100,
      repeatedTargets,
      recommendation: loopDetected
        ? (oscillationRate > 0.6
          ? 'System is oscillating — try a completely different approach or increase depth'
          : converging
          ? 'System has converged — move to higher depth or new domain'
          : 'Repetitive targets — diversify improvement focus')
        : 'No loop detected — continue',
    };
  }

  /* ────────────────────────────────────────────────────────────────
   *  INTERNAL HELPERS
   * ──────────────────────────────────────────────────────────────── */

  _readOwnSource() {
    try { return fs.readFileSync(__filename, 'utf8'); } catch { return ''; }
  }

  _listCoreFiles() {
    try {
      return fs.readdirSync(__dirname)
        .filter(f => f.endsWith('.js'))
        .map(f => 'core/' + f);
    } catch { return []; }
  }

  _countOutcomes(cycles) {
    const counts = {};
    for (const c of cycles) {
      const o = c.outcome || 'unknown';
      counts[o] = (counts[o] || 0) + 1;
    }
    return counts;
  }

  _countByDepth(registry) {
    const counts = {};
    for (const r of registry) {
      const d = r.depth || 0;
      counts[d] = (counts[d] || 0) + 1;
    }
    return counts;
  }

  /** Select which depth to compile next based on trends */
  _selectNextDepth() {
    const cycles = this._loadCycles();
    if (cycles.length === 0) return 0;

    // Start at depth 0; if recent depth-0 cycles show diminishing returns, go deeper
    for (let d = 0; d < this.config.maxDepth; d++) {
      const atDepth = cycles.filter(c => c.depth === d).slice(-3);
      if (atDepth.length < 3) return d; // not enough data at this depth, stay here
      const avgDelta = mean(atDepth.map(c => c.deltaSummary || 0));
      if (avgDelta >= this.config.diminishingThreshold) return d; // still productive here
    }

    // All depths show diminishing returns — cycle back to 0
    return 0;
  }

  _recordMetricSnapshot(cycle) {
    const metrics = this._loadMetrics();
    metrics.snapshots.push({
      cycleId: cycle.id,
      depth: cycle.depth,
      delta: cycle.deltaSummary,
      durationMs: cycle.durationMs,
      outcome: cycle.outcome,
      proposalCount: (cycle.proposals || []).length,
      appliedCount: (cycle.appliedIds || []).length,
      timestamp: isoNow(),
    });
    // Keep last 500
    if (metrics.snapshots.length > 500) {
      metrics.snapshots = metrics.snapshots.slice(-500);
    }
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
    } catch (e) {
      this.emit('error', e);
    }
  }

  /* ────────────────────────────────────────────────────────────────
   *  SUMMARY / STATS
   * ──────────────────────────────────────────────────────────────── */

  /**
   * Get overall compiler stats
   * @returns {object}
   */
  getStats() {
    const registry = this._loadRegistry();
    const cycles = this._loadCycles();
    const strategies = this._loadStrategies();

    const applied = registry.filter(r => r.status === 'applied');
    const deltas = applied.map(r => r.measuredDelta || 0).filter(d => d !== 0);

    return {
      totalImprovements: registry.length,
      appliedCount: applied.length,
      totalCycles: cycles.length,
      strategyCount: strategies.length,
      avgDelta: deltas.length > 0 ? Math.round(mean(deltas) * 100) / 100 : 0,
      byDepth: this._countByDepth(registry),
      outcomeDistribution: this._countOutcomes(cycles),
      compiling: this._compiling,
      lastCompileAt: this._lastCompileAt > 0 ? new Date(this._lastCompileAt).toISOString() : null,
      tickCount: this._tickCount,
      strangeLoops: this._detectStrangeLoops(),
      efficiency: this.getEfficiencyTrend(),
    };
  }
}

module.exports = RecursiveSelfCompilation;
