/**
 * ARIES — Module Pruner / Dead Weight Detector v1.0
 * Analyzes all registered modules for usefulness metrics and identifies
 * dead weight, merge candidates, and efficiency rankings.
 * Zero external dependencies.
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data', 'pruner');
const REPORT_PATH = path.join(DATA_DIR, 'latest-report.json');
const HISTORY_DIR = path.join(DATA_DIR, 'history');

function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(path.dirname(p)); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }

// ═══════════════════════════════════════════════════════════════
//  ModulePruner
// ═══════════════════════════════════════════════════════════════
class ModulePruner extends EventEmitter {
  constructor(refs) {
    super();
    this.refs = refs || {};
    this.depGraph = null;
    this.graphData = null;
    this.lastReport = readJSON(REPORT_PATH, null);
  }

  // ── Get dependency graph module ──
  _getDepGraph() {
    if (this.depGraph) return this.depGraph;
    try {
      const DG = require('./module-dependency-graph');
      this.depGraph = new DG(this.refs);
      return this.depGraph;
    } catch { return null; }
  }

  // ── Get graph declarations (provides/consumes/dependencies) ──
  _getGraphData() {
    if (this.graphData) return this.graphData;
    const dg = this._getDepGraph();
    if (dg) {
      // modules is a Map in ModuleDependencyGraph
      if (dg.modules instanceof Map) {
        if (dg.modules.size === 0 && dg.loadDefaults) dg.loadDefaults();
        const obj = {};
        for (const [k, v] of dg.modules) obj[k] = v;
        if (Object.keys(obj).length > 0) { this.graphData = obj; return obj; }
      } else if (dg.modules && typeof dg.modules === 'object') {
        this.graphData = dg.modules;
        return this.graphData;
      }
      if (dg.getState) {
        const state = dg.getState();
        if (state && state.modules) {
          const obj = {};
          if (state.modules instanceof Map) { for (const [k, v] of state.modules) obj[k] = v; }
          else Object.assign(obj, state.modules);
          if (Object.keys(obj).length > 0) { this.graphData = obj; return obj; }
        }
      }
    }
    // Fallback: use DEFAULT_GRAPH by requiring the file and bootstrapping
    try {
      const dgSrc = fs.readFileSync(path.join(__dirname, 'module-dependency-graph.js'), 'utf8');
      const m = dgSrc.match(/const DEFAULT_GRAPH\s*=\s*\{/);
      if (m) {
        // Create instance and register defaults
        if (dg && dg.loadDefaults) { dg.loadDefaults(); return this._getGraphDataFromDG(dg); }
      }
    } catch {}
    return {};
  }

  _getGraphDataFromDG(dg) {
    if (dg.modules instanceof Map) {
      const obj = {};
      for (const [k, v] of dg.modules) obj[k] = v;
      return obj;
    }
    return {};
  }

  // ── Get all module IDs from the dependency graph ──
  _getModuleIds() {
    const dg = this._getDepGraph();
    if (dg && dg.getModuleList) return dg.getModuleList();
    if (dg && dg.getAllModules) return dg.getAllModules();
    const gd = this._getGraphData();
    return Object.keys(gd);
  }

  // ── Get module declaration ──
  _getModuleDecl(moduleId) {
    const dg = this._getDepGraph();
    if (dg && dg.getModule) return dg.getModule(moduleId);
    const gd = this._getGraphData();
    return gd[moduleId] || null;
  }

  // ── Count lines of code for a module ──
  _getLOC(moduleId) {
    const candidates = [
      path.join(__dirname, moduleId + '.js'),
      path.join(__dirname, moduleId.replace(/-/g, '_') + '.js')
    ];
    for (const fp of candidates) {
      try {
        const content = fs.readFileSync(fp, 'utf8');
        return content.split('\n').length;
      } catch {}
    }
    return 0;
  }

  // ── Check data staleness for a module ──
  _getDataStaleness(moduleId) {
    const dataDir = path.join(__dirname, '..', 'data', moduleId);
    const altDir = path.join(__dirname, '..', 'data', moduleId.replace(/-/g, '_'));
    let latestMtime = 0;
    let fileCount = 0;
    for (const dir of [dataDir, altDir]) {
      try {
        const files = fs.readdirSync(dir);
        for (const f of files) {
          try {
            const stat = fs.statSync(path.join(dir, f));
            fileCount++;
            if (stat.mtimeMs > latestMtime) latestMtime = stat.mtimeMs;
          } catch {}
        }
      } catch {}
    }
    if (fileCount === 0) return { staleDays: -1, fileCount: 0, hasData: false };
    const staleDays = (Date.now() - latestMtime) / (1000 * 60 * 60 * 24);
    return { staleDays: Math.round(staleDays * 10) / 10, fileCount, hasData: true };
  }

  // ── Get cognitive benchmark scores if available ──
  _getBenchmarkScores() {
    try {
      const CB = require('./cognitive-benchmark');
      const cb = new CB(this.refs);
      if (cb.getScores) return cb.getScores();
      if (cb.getLatest) return cb.getLatest();
    } catch {}
    // Try reading from data
    const benchPath = path.join(__dirname, '..', 'data', 'cognitive-benchmark');
    try {
      const files = fs.readdirSync(benchPath).filter(f => f.endsWith('.json')).sort().reverse();
      if (files.length > 0) return readJSON(path.join(benchPath, files[0]), {});
    } catch {}
    return {};
  }

  // ── Event activity analysis ──
  _analyzeEventActivity(moduleId, decl) {
    if (!decl) return { score: 0.5, emits: 0, receives: 0, detail: 'no declaration' };
    const provides = (decl.provides || []).length;
    const consumes = (decl.consumes || []).length;
    if (provides === 0 && consumes === 0) return { score: 0, emits: provides, receives: consumes, detail: 'no events' };
    if (provides === 0) return { score: 0.3, emits: 0, receives: consumes, detail: 'consumer only' };
    if (consumes === 0) return { score: 0.6, emits: provides, receives: 0, detail: 'producer only' };
    const total = provides + consumes;
    return { score: Math.min(1, total / 6), emits: provides, receives: consumes, detail: 'active' };
  }

  // ── Tick cost analysis ──
  _analyzeTickCost(moduleId, decl, benchmarks) {
    const energyCost = (decl && decl.energyCost) || 5;
    const benchScore = (benchmarks && benchmarks[moduleId]) || null;
    const provides = (decl && decl.provides) ? decl.provides.length : 0;
    // Value = provides count + benchmark score (if available)
    let value = provides * 2;
    if (benchScore && typeof benchScore === 'number') value += benchScore;
    else if (benchScore && benchScore.score) value += benchScore.score;
    else value += 5; // default assumed value
    const ratio = value / Math.max(1, energyCost);
    return {
      score: Math.min(1, ratio / 4),
      energyCost,
      valueProduced: value,
      ratio: Math.round(ratio * 100) / 100,
      detail: ratio < 0.5 ? 'high cost, low value' : ratio < 1 ? 'marginal' : ratio < 2 ? 'efficient' : 'highly efficient'
    };
  }

  // ── Dependency orphan detection ──
  _analyzeDependencyOrphans(moduleId, decl, allDecls) {
    const deps = (decl && decl.dependencies) || [];
    // Check if anything depends on this module
    let dependedOnBy = 0;
    for (const [id, d] of Object.entries(allDecls)) {
      if (id === moduleId) continue;
      if (d.dependencies && d.dependencies.includes(moduleId)) dependedOnBy++;
    }
    const isOrphan = deps.length === 0 && dependedOnBy === 0;
    const isLeaf = dependedOnBy === 0;
    const isRoot = deps.length === 0;
    let score = 0.7;
    if (isOrphan) score = 0.1;
    else if (isLeaf && deps.length <= 1) score = 0.4;
    else if (dependedOnBy > 3) score = 1.0;
    else score = Math.min(1, (dependedOnBy + deps.length) / 8);
    return { score, dependsOn: deps.length, dependedOnBy, isOrphan, isLeaf, isRoot, detail: isOrphan ? 'orphan' : isLeaf ? 'leaf node' : 'connected' };
  }

  // ── Data staleness analysis ──
  _analyzeDataStaleness(moduleId) {
    const staleness = this._getDataStaleness(moduleId);
    if (!staleness.hasData) return { score: 0.5, ...staleness, detail: 'no data directory' };
    if (staleness.staleDays > 30) return { score: 0.1, ...staleness, detail: 'very stale (>' + Math.round(staleness.staleDays) + ' days)' };
    if (staleness.staleDays > 14) return { score: 0.3, ...staleness, detail: 'stale' };
    if (staleness.staleDays > 7) return { score: 0.5, ...staleness, detail: 'aging' };
    if (staleness.staleDays > 1) return { score: 0.7, ...staleness, detail: 'recent' };
    return { score: 1.0, ...staleness, detail: 'fresh' };
  }

  // ── Code size vs output (bloat detection) ──
  _analyzeCodeBloat(moduleId, decl) {
    const loc = this._getLOC(moduleId);
    if (loc === 0) return { score: 0.5, loc: 0, eventsPerLOC: 0, detail: 'file not found' };
    const provides = (decl && decl.provides) ? decl.provides.length : 0;
    const eventsPerLOC = provides / Math.max(1, loc) * 100;
    // Higher events-per-LOC ratio = less bloated
    let score;
    if (loc < 50) score = 0.9;
    else if (loc < 200) score = 0.8;
    else if (loc < 500) score = provides >= 2 ? 0.7 : 0.5;
    else if (loc < 1000) score = provides >= 3 ? 0.6 : 0.3;
    else score = provides >= 4 ? 0.5 : 0.2;
    return {
      score,
      loc,
      provides,
      eventsPerLOC: Math.round(eventsPerLOC * 100) / 100,
      detail: score < 0.3 ? 'bloated' : score < 0.6 ? 'moderate' : 'compact'
    };
  }

  // ── Redundancy analysis ──
  _analyzeRedundancy(moduleId, decl, allDecls) {
    if (!decl) return { score: 1.0, overlaps: [], detail: 'no declaration' };
    const myProvides = new Set(decl.provides || []);
    const myConsumes = new Set(decl.consumes || []);
    const overlaps = [];
    for (const [id, d] of Object.entries(allDecls)) {
      if (id === moduleId) continue;
      const otherProvides = new Set(d.provides || []);
      const otherConsumes = new Set(d.consumes || []);
      let overlapCount = 0;
      for (const p of myProvides) if (otherProvides.has(p)) overlapCount++;
      for (const c of myConsumes) if (otherConsumes.has(c)) overlapCount++;
      if (overlapCount > 0) {
        const totalUnion = new Set([...myProvides, ...myConsumes, ...otherProvides, ...otherConsumes]).size;
        const similarity = overlapCount / Math.max(1, totalUnion);
        overlaps.push({ module: id, overlapCount, similarity: Math.round(similarity * 100) / 100 });
      }
    }
    overlaps.sort((a, b) => b.similarity - a.similarity);
    const maxSim = overlaps.length > 0 ? overlaps[0].similarity : 0;
    return {
      score: 1 - maxSim,
      overlaps: overlaps.slice(0, 5),
      detail: maxSim > 0.5 ? 'high redundancy' : maxSim > 0.2 ? 'some overlap' : 'unique'
    };
  }

  // ═══════════════════════════════════════════════════════════════
  //  Main analysis
  // ═══════════════════════════════════════════════════════════════
  analyze() {
    const dg = this._getDepGraph();
    const allDecls = this._getGraphData();
    const moduleIds = this._getModuleIds();
    const benchmarks = this._getBenchmarkScores();
    const report = {
      timestamp: new Date().toISOString(),
      moduleCount: moduleIds.length,
      modules: {},
      deadWeight: [],
      mergeCandidates: [],
      efficiencyRanking: [],
      summary: {}
    };

    const weights = { eventActivity: 0.2, tickCost: 0.2, dependency: 0.2, staleness: 0.1, codeBloat: 0.15, redundancy: 0.15 };

    for (const moduleId of moduleIds) {
      const decl = allDecls[moduleId] || this._getModuleDecl(moduleId);
      const eventActivity = this._analyzeEventActivity(moduleId, decl);
      const tickCost = this._analyzeTickCost(moduleId, decl, benchmarks);
      const dependency = this._analyzeDependencyOrphans(moduleId, decl, allDecls);
      const staleness = this._analyzeDataStaleness(moduleId);
      const codeBloat = this._analyzeCodeBloat(moduleId, decl);
      const redundancy = this._analyzeRedundancy(moduleId, decl, allDecls);

      const compositeScore =
        eventActivity.score * weights.eventActivity +
        tickCost.score * weights.tickCost +
        dependency.score * weights.dependency +
        staleness.score * weights.staleness +
        codeBloat.score * weights.codeBloat +
        redundancy.score * weights.redundancy;

      report.modules[moduleId] = {
        compositeScore: Math.round(compositeScore * 1000) / 1000,
        priority: (decl && decl.priority) || 'UNKNOWN',
        metrics: { eventActivity, tickCost, dependency, staleness, codeBloat, redundancy }
      };
    }

    // Dead weight detection (score < 0.35)
    for (const [id, data] of Object.entries(report.modules)) {
      if (data.compositeScore < 0.35) {
        report.deadWeight.push({ moduleId: id, score: data.compositeScore, priority: data.priority });
      }
    }
    report.deadWeight.sort((a, b) => a.score - b.score);

    // Merge candidates
    const seen = new Set();
    for (const [id, data] of Object.entries(report.modules)) {
      const overlaps = data.metrics.redundancy.overlaps || [];
      for (const o of overlaps) {
        if (o.similarity >= 0.3) {
          const key = [id, o.module].sort().join('|');
          if (!seen.has(key)) {
            seen.add(key);
            report.mergeCandidates.push({
              moduleA: id,
              moduleB: o.module,
              similarity: o.similarity,
              overlapCount: o.overlapCount,
              reason: 'High overlap in provides/consumes declarations'
            });
          }
        }
      }
    }
    report.mergeCandidates.sort((a, b) => b.similarity - a.similarity);

    // Efficiency ranking
    report.efficiencyRanking = Object.entries(report.modules)
      .map(([id, data]) => ({
        moduleId: id,
        score: data.compositeScore,
        priority: data.priority,
        valueRatio: data.metrics.tickCost.ratio,
        energyCost: data.metrics.tickCost.energyCost
      }))
      .sort((a, b) => b.score - a.score);

    // Summary
    const scores = Object.values(report.modules).map(m => m.compositeScore);
    report.summary = {
      avgScore: Math.round((scores.reduce((a, b) => a + b, 0) / Math.max(1, scores.length)) * 1000) / 1000,
      deadWeightCount: report.deadWeight.length,
      mergeCandidateCount: report.mergeCandidates.length,
      healthyCount: scores.filter(s => s >= 0.6).length,
      marginalCount: scores.filter(s => s >= 0.35 && s < 0.6).length,
      criticalCount: scores.filter(s => s < 0.35).length
    };

    // Persist
    this.lastReport = report;
    writeJSON(REPORT_PATH, report);
    const histFile = path.join(HISTORY_DIR, report.timestamp.replace(/[:.]/g, '-') + '.json');
    ensureDir(HISTORY_DIR);
    writeJSON(histFile, report);

    // Emit events
    this.emit('analysis-complete', report);
    if (report.deadWeight.length > 0) {
      this.emit('dead-weight-detected', report.deadWeight);
    }
    if (report.mergeCandidates.length > 0) {
      this.emit('merge-candidate-found', report.mergeCandidates);
    }

    return report;
  }

  // ═══════════════════════════════════════════════════════════════
  //  Public API methods
  // ═══════════════════════════════════════════════════════════════
  getDeadWeight(threshold) {
    threshold = threshold || 0.35;
    if (!this.lastReport) this.analyze();
    return Object.entries(this.lastReport.modules)
      .filter(([_, data]) => data.compositeScore < threshold)
      .map(([id, data]) => ({ moduleId: id, score: data.compositeScore, priority: data.priority }))
      .sort((a, b) => a.score - b.score);
  }

  getMergeCandidates() {
    if (!this.lastReport) this.analyze();
    return this.lastReport.mergeCandidates || [];
  }

  getEfficiencyRanking() {
    if (!this.lastReport) this.analyze();
    return this.lastReport.efficiencyRanking || [];
  }

  getReport() {
    if (!this.lastReport) return 'No analysis has been run yet. Call analyze() first.';
    const r = this.lastReport;
    const lines = [];
    lines.push('╔══════════════════════════════════════════════════════════╗');
    lines.push('║          MODULE PRUNER — ANALYSIS REPORT               ║');
    lines.push('╚══════════════════════════════════════════════════════════╝');
    lines.push('');
    lines.push(`Timestamp: ${r.timestamp}`);
    lines.push(`Modules analyzed: ${r.moduleCount}`);
    lines.push(`Average score: ${r.summary.avgScore}`);
    lines.push(`Healthy: ${r.summary.healthyCount} | Marginal: ${r.summary.marginalCount} | Critical: ${r.summary.criticalCount}`);
    lines.push('');

    lines.push('── EFFICIENCY RANKING (Top 10) ──');
    (r.efficiencyRanking || []).slice(0, 10).forEach((m, i) => {
      const bar = '█'.repeat(Math.round(m.score * 20)).padEnd(20, '░');
      lines.push(`  ${(i + 1 + '.').padEnd(4)} ${m.moduleId.padEnd(35)} [${bar}] ${m.score.toFixed(3)} (${m.priority})`);
    });
    lines.push('');

    if (r.deadWeight.length > 0) {
      lines.push('── DEAD WEIGHT ──');
      r.deadWeight.forEach(d => {
        lines.push(`  ⚠ ${d.moduleId.padEnd(35)} score: ${d.score.toFixed(3)} (${d.priority})`);
      });
      lines.push('');
    }

    if (r.mergeCandidates.length > 0) {
      lines.push('── MERGE CANDIDATES ──');
      r.mergeCandidates.forEach(mc => {
        lines.push(`  🔀 ${mc.moduleA} + ${mc.moduleB} (similarity: ${mc.similarity}, overlaps: ${mc.overlapCount})`);
      });
      lines.push('');
    }

    // Bottom 10
    lines.push('── BOTTOM 10 (Lowest efficiency) ──');
    (r.efficiencyRanking || []).slice(-10).reverse().forEach((m, i) => {
      const bar = '█'.repeat(Math.round(m.score * 20)).padEnd(20, '░');
      lines.push(`  ${(i + 1 + '.').padEnd(4)} ${m.moduleId.padEnd(35)} [${bar}] ${m.score.toFixed(3)} (${m.priority})`);
    });

    return lines.join('\n');
  }

  suggestPrune(moduleId) {
    const allDecls = this._getGraphData();
    const decl = allDecls[moduleId];
    if (!decl) return { moduleId, error: 'Module not found in dependency graph', canPrune: false };

    // Find what depends on this module
    const dependents = [];
    for (const [id, d] of Object.entries(allDecls)) {
      if (id === moduleId) continue;
      if (d.dependencies && d.dependencies.includes(moduleId)) {
        dependents.push(id);
      }
    }

    // Find what consumes this module's provides
    const consumers = [];
    const myProvides = decl.provides || [];
    for (const [id, d] of Object.entries(allDecls)) {
      if (id === moduleId) continue;
      const theirConsumes = d.consumes || [];
      const affected = myProvides.filter(p => theirConsumes.includes(p));
      if (affected.length > 0) consumers.push({ module: id, affectedEvents: affected });
    }

    // Cascade analysis - what else breaks transitively
    const cascadeSet = new Set(dependents);
    let changed = true;
    while (changed) {
      changed = false;
      for (const [id, d] of Object.entries(allDecls)) {
        if (cascadeSet.has(id)) continue;
        if (d.dependencies && d.dependencies.some(dep => cascadeSet.has(dep))) {
          cascadeSet.add(id);
          changed = true;
        }
      }
    }
    const cascadeBreaks = [...cascadeSet].filter(id => !dependents.includes(id));

    const isCritical = decl.priority === 'CRITICAL';
    const impact = dependents.length + cascadeBreaks.length;
    const riskLevel = isCritical ? 'CRITICAL' : impact > 5 ? 'HIGH' : impact > 2 ? 'MEDIUM' : impact > 0 ? 'LOW' : 'SAFE';

    return {
      moduleId,
      priority: decl.priority,
      riskLevel,
      canPrune: riskLevel === 'SAFE' || riskLevel === 'LOW',
      directDependents: dependents,
      eventConsumers: consumers,
      cascadeBreaks,
      totalImpact: impact,
      provides: decl.provides || [],
      consumes: decl.consumes || [],
      recommendation: riskLevel === 'SAFE'
        ? 'Safe to remove — nothing depends on this module.'
        : riskLevel === 'LOW'
          ? 'Low risk — only ' + dependents.length + ' direct dependent(s). Review before removing.'
          : riskLevel === 'CRITICAL'
            ? 'DO NOT REMOVE — critical infrastructure module.'
            : 'High impact — ' + impact + ' modules would be affected. Refactor instead.'
    };
  }

  getLatestReport() {
    return this.lastReport || readJSON(REPORT_PATH, null);
  }
}

module.exports = ModulePruner;
