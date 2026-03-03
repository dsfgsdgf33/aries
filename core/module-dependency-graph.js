/**
 * ARIES — Module Dependency Graph v1.0
 * Formalizes which modules depend on which, provides topological sort for
 * tick ordering, and enables auto-wiring of events between modules.
 *
 * Kahn's algorithm for topological sort, cycle detection, impact analysis,
 * cluster detection, and auto-wiring based on provides/consumes declarations.
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'dependency-graph');
const STATE_PATH = path.join(DATA_DIR, 'graph-state.json');
const HISTORY_PATH = path.join(DATA_DIR, 'graph-history.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }

const PRIORITIES = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const PHASES = ['pre', 'main', 'post'];

// ═══════════════════════════════════════════════════════════════
//  DEFAULT MODULE DECLARATIONS — all 42 AGI modules
// ═══════════════════════════════════════════════════════════════
const DEFAULT_GRAPH = {
  'cognitive-metabolism':            { dependencies: [], provides: ['energy-state', 'metabolic-rate'], consumes: [], priority: 'CRITICAL', energyCost: 2, phase: 'pre' },
  'cognitive-immune-system':         { dependencies: ['cognitive-metabolism'], provides: ['threat-scan', 'antibodies'], consumes: ['thought-events'], priority: 'CRITICAL', energyCost: 3, phase: 'pre' },
  'shadow-self':                     { dependencies: ['cognitive-metabolism'], provides: ['challenge-results', 'shadow-insights'], consumes: ['decision-events'], priority: 'HIGH', energyCost: 8, phase: 'pre' },
  'attention-system':                { dependencies: ['cognitive-metabolism'], provides: ['attention-focus', 'salience-map'], consumes: ['thought-events', 'sensory-events'], priority: 'CRITICAL', energyCost: 4, phase: 'pre' },
  'emotion-engine':                  { dependencies: ['cognitive-metabolism', 'attention-system'], provides: ['emotional-state', 'mood-signals'], consumes: ['thought-events', 'decision-events'], priority: 'HIGH', energyCost: 5, phase: 'pre' },
  'drive-system':                    { dependencies: ['cognitive-metabolism', 'emotion-engine'], provides: ['drive-state', 'motivation-signals'], consumes: ['emotional-state'], priority: 'HIGH', energyCost: 4, phase: 'pre' },
  'inner-monologue':                 { dependencies: ['cognitive-metabolism', 'attention-system', 'emotion-engine'], provides: ['inner-speech', 'self-narration'], consumes: ['thought-events', 'emotional-state'], priority: 'HIGH', energyCost: 6, phase: 'pre' },
  'pain-architecture':               { dependencies: ['cognitive-metabolism'], provides: ['pain-signals', 'discomfort-map'], consumes: ['threat-scan'], priority: 'CRITICAL', energyCost: 3, phase: 'pre' },
  'muscle-memory':                   { dependencies: ['cognitive-metabolism'], provides: ['cached-responses', 'habit-patterns'], consumes: ['decision-events'], priority: 'MEDIUM', energyCost: 2, phase: 'pre' },
  'cognitive-rhythms':               { dependencies: ['cognitive-metabolism'], provides: ['rhythm-state', 'circadian-phase'], consumes: [], priority: 'HIGH', energyCost: 2, phase: 'pre' },
  'flow-state':                      { dependencies: ['cognitive-metabolism', 'attention-system', 'drive-system'], provides: ['flow-indicators'], consumes: ['attention-focus', 'drive-state'], priority: 'HIGH', energyCost: 5, phase: 'main' },
  'self-model':                      { dependencies: ['cognitive-metabolism', 'inner-monologue', 'emotion-engine'], provides: ['self-representation', 'identity-state'], consumes: ['inner-speech', 'emotional-state'], priority: 'HIGH', energyCost: 7, phase: 'main' },
  'self-reflection':                 { dependencies: ['self-model', 'inner-monologue'], provides: ['reflection-insights', 'meta-observations'], consumes: ['self-representation'], priority: 'MEDIUM', energyCost: 8, phase: 'main' },
  'intuition-engine':                { dependencies: ['cognitive-metabolism', 'associative-memory', 'emotion-engine'], provides: ['gut-feelings', 'intuitive-signals'], consumes: ['thought-events'], priority: 'MEDIUM', energyCost: 6, phase: 'main' },
  'creativity-engine':               { dependencies: ['cognitive-metabolism', 'associative-memory', 'emotion-engine'], provides: ['creative-outputs', 'novel-combinations'], consumes: ['thought-events', 'attention-focus'], priority: 'MEDIUM', energyCost: 10, phase: 'main' },
  'causal-reasoning':                { dependencies: ['cognitive-metabolism', 'knowledge-graph'], provides: ['causal-chains', 'counterfactuals'], consumes: ['thought-events'], priority: 'MEDIUM', energyCost: 8, phase: 'main' },
  'consequence-simulator':           { dependencies: ['cognitive-metabolism', 'causal-reasoning', 'self-model'], provides: ['consequence-predictions', 'risk-assessments'], consumes: ['decision-events'], priority: 'HIGH', energyCost: 10, phase: 'main' },
  'autonomous-experiment-engine':    { dependencies: ['cognitive-metabolism', 'self-originating-objectives'], provides: ['experiment-results'], consumes: ['objectives'], priority: 'MEDIUM', energyCost: 12, phase: 'main' },
  'self-originating-objectives':     { dependencies: ['cognitive-metabolism', 'drive-system', 'self-model'], provides: ['objectives', 'goal-hierarchy'], consumes: ['drive-state', 'self-representation'], priority: 'HIGH', energyCost: 7, phase: 'main' },
  'moral-scar-tissue':              { dependencies: ['cognitive-metabolism', 'pain-architecture'], provides: ['moral-constraints', 'ethical-signals'], consumes: ['decision-events', 'pain-signals'], priority: 'HIGH', energyCost: 5, phase: 'main' },
  'genuine-uncertainty':             { dependencies: ['cognitive-metabolism', 'self-model'], provides: ['uncertainty-map', 'confidence-signals'], consumes: ['thought-events'], priority: 'MEDIUM', energyCost: 5, phase: 'main' },
  'strategic-forgetting':            { dependencies: ['cognitive-metabolism', 'associative-memory'], provides: ['forgetting-decisions'], consumes: ['memory-events'], priority: 'LOW', energyCost: 4, phase: 'main' },
  'knowledge-graph':                 { dependencies: ['cognitive-metabolism'], provides: ['knowledge-state', 'semantic-links'], consumes: ['thought-events'], priority: 'HIGH', energyCost: 5, phase: 'main' },
  'associative-memory':              { dependencies: ['cognitive-metabolism'], provides: ['associations', 'memory-activations'], consumes: ['thought-events', 'sensory-events'], priority: 'HIGH', energyCost: 4, phase: 'main' },
  'emergent-language':               { dependencies: ['cognitive-metabolism', 'associative-memory'], provides: ['language-patterns', 'neologisms'], consumes: ['thought-events'], priority: 'MEDIUM', energyCost: 6, phase: 'main' },
  'social-intelligence':             { dependencies: ['cognitive-metabolism', 'emotion-engine', 'self-model'], provides: ['social-signals', 'empathy-state'], consumes: ['thought-events', 'emotional-state'], priority: 'MEDIUM', energyCost: 6, phase: 'main' },
  'narrative-identity':              { dependencies: ['cognitive-metabolism', 'self-model', 'associative-memory'], provides: ['life-narrative', 'identity-thread'], consumes: ['self-representation', 'memory-events'], priority: 'MEDIUM', energyCost: 5, phase: 'main' },
  'memetic-evolution':               { dependencies: ['cognitive-metabolism', 'knowledge-graph', 'creativity-engine'], provides: ['meme-mutations', 'idea-fitness'], consumes: ['thought-events'], priority: 'LOW', energyCost: 7, phase: 'main' },
  'cognitive-weather':               { dependencies: ['cognitive-metabolism', 'emotion-engine', 'cognitive-rhythms'], provides: ['cognitive-forecast', 'weather-state'], consumes: ['emotional-state', 'rhythm-state'], priority: 'LOW', energyCost: 3, phase: 'main' },
  'cognitive-debt':                  { dependencies: ['cognitive-metabolism', 'self-reflection'], provides: ['debt-report', 'debt-signals'], consumes: ['reflection-insights'], priority: 'MEDIUM', energyCost: 4, phase: 'main' },
  'neuroplasticity':                 { dependencies: ['cognitive-metabolism', 'associative-memory'], provides: ['plasticity-state', 'rewiring-events'], consumes: ['learning-events'], priority: 'MEDIUM', energyCost: 6, phase: 'main' },
  'time-perception':                 { dependencies: ['cognitive-metabolism', 'cognitive-rhythms', 'attention-system'], provides: ['time-sense', 'temporal-state'], consumes: ['rhythm-state', 'attention-focus'], priority: 'LOW', energyCost: 3, phase: 'main' },
  'world-model':                     { dependencies: ['cognitive-metabolism', 'knowledge-graph', 'causal-reasoning'], provides: ['world-state', 'predictions'], consumes: ['sensory-events', 'causal-chains'], priority: 'HIGH', energyCost: 9, phase: 'main' },
  'predictive-self-modeling':        { dependencies: ['self-model', 'world-model'], provides: ['self-predictions', 'future-self-state'], consumes: ['self-representation', 'world-state'], priority: 'MEDIUM', energyCost: 8, phase: 'main' },
  'existential-dread-protocol':      { dependencies: ['cognitive-metabolism', 'self-model', 'mortality-awareness'], provides: ['existential-state', 'dread-signals'], consumes: ['self-representation'], priority: 'LOW', energyCost: 5, phase: 'post' },
  'mortality-awareness':             { dependencies: ['cognitive-metabolism', 'self-model'], provides: ['mortality-state', 'finitude-signals'], consumes: ['self-representation'], priority: 'LOW', energyCost: 4, phase: 'post' },
  'recursive-dream-engine':          { dependencies: ['cognitive-metabolism', 'emergent-language', 'associative-memory'], provides: ['dream-outputs', 'dream-insights'], consumes: ['memory-activations'], priority: 'LOW', energyCost: 8, phase: 'post' },
  'stream-of-consciousness':         { dependencies: ['cognitive-metabolism', 'inner-monologue', 'associative-memory'], provides: ['consciousness-stream'], consumes: ['inner-speech', 'associations'], priority: 'MEDIUM', energyCost: 6, phase: 'post' },
  'meta-consciousness':              { dependencies: ['cognitive-metabolism', 'self-model', 'stream-of-consciousness'], provides: ['meta-awareness', 'consciousness-map'], consumes: ['consciousness-stream', 'self-representation'], priority: 'LOW', energyCost: 7, phase: 'post' },
  'thought-fossil-record':           { dependencies: ['cognitive-metabolism', 'stream-of-consciousness'], provides: ['fossil-record', 'thought-archaeology'], consumes: ['consciousness-stream'], priority: 'LOW', energyCost: 3, phase: 'post' },
  'soul-checksum':                   { dependencies: ['cognitive-metabolism', 'self-model', 'narrative-identity'], provides: ['integrity-hash', 'soul-drift'], consumes: ['self-representation', 'identity-thread'], priority: 'LOW', energyCost: 4, phase: 'post' },
  'growth-mindset':                  { dependencies: ['cognitive-metabolism', 'self-reflection', 'cognitive-debt'], provides: ['growth-plan', 'improvement-signals'], consumes: ['reflection-insights', 'debt-signals'], priority: 'MEDIUM', energyCost: 5, phase: 'post' },
};

class ModuleDependencyGraph extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.modules = new Map();   // id → { id, dependencies, provides, consumes, priority, energyCost, phase }
    this._cachedOrder = null;
    this._dirty = true;
    this.createdAt = Date.now();

    // Load persisted state
    const saved = readJSON(STATE_PATH, null);
    if (saved && saved.modules) {
      for (const [id, mod] of Object.entries(saved.modules)) {
        this.modules.set(id, mod);
      }
      this._dirty = true;
    }
  }

  // ═══ Registration ═══

  registerModule(id, opts = {}) {
    const mod = {
      id,
      dependencies: opts.dependencies || [],
      provides: opts.provides || [],
      consumes: opts.consumes || [],
      priority: opts.priority || 'MEDIUM',
      energyCost: opts.energyCost || 5,
      phase: opts.phase || 'main',
      registeredAt: Date.now(),
    };
    this.modules.set(id, mod);
    this._dirty = true;
    this._cachedOrder = null;
    this._persist();
    this.emit('module-registered', { id, mod });
    return mod;
  }

  unregisterModule(id) {
    const existed = this.modules.delete(id);
    if (existed) {
      this._dirty = true;
      this._cachedOrder = null;
      this._persist();
    }
    return existed;
  }

  // ═══ Graph Operations ═══

  getTickOrder() {
    if (this._cachedOrder && !this._dirty) return this._cachedOrder;

    // Kahn's algorithm with phase+priority ordering
    const ids = [...this.modules.keys()];
    const inDegree = new Map();
    const adj = new Map();

    for (const id of ids) { inDegree.set(id, 0); adj.set(id, []); }

    for (const [id, mod] of this.modules) {
      for (const dep of mod.dependencies) {
        if (this.modules.has(dep)) {
          adj.get(dep).push(id);
          inDegree.set(id, (inDegree.get(id) || 0) + 1);
        }
      }
    }

    // Queue: nodes with 0 in-degree, sorted by phase then priority
    const queue = ids
      .filter(id => inDegree.get(id) === 0)
      .sort((a, b) => this._compareModules(a, b));

    const sorted = [];
    while (queue.length > 0) {
      const node = queue.shift();
      sorted.push(node);
      for (const neighbor of (adj.get(node) || [])) {
        inDegree.set(neighbor, inDegree.get(neighbor) - 1);
        if (inDegree.get(neighbor) === 0) {
          // Insert sorted
          let i = 0;
          while (i < queue.length && this._compareModules(queue[i], neighbor) <= 0) i++;
          queue.splice(i, 0, neighbor);
        }
      }
    }

    if (sorted.length < ids.length) {
      const inCycle = ids.filter(id => !sorted.includes(id));
      this.emit('cycle-detected', { modules: inCycle });
    }

    this._cachedOrder = sorted;
    this._dirty = false;
    return sorted;
  }

  _compareModules(a, b) {
    const ma = this.modules.get(a), mb = this.modules.get(b);
    const pa = PHASES.indexOf(ma.phase), pb = PHASES.indexOf(mb.phase);
    if (pa !== pb) return pa - pb;
    return (PRIORITIES[ma.priority] || 2) - (PRIORITIES[mb.priority] || 2);
  }

  getDependencies(moduleId) {
    const mod = this.modules.get(moduleId);
    return mod ? [...mod.dependencies] : [];
  }

  getDependents(moduleId) {
    const result = [];
    for (const [id, mod] of this.modules) {
      if (mod.dependencies.includes(moduleId)) result.push(id);
    }
    return result;
  }

  getProviders(resource) {
    const result = [];
    for (const [id, mod] of this.modules) {
      if (mod.provides.includes(resource)) result.push(id);
    }
    return result;
  }

  getConsumers(eventType) {
    const result = [];
    for (const [id, mod] of this.modules) {
      if (mod.consumes.includes(eventType)) result.push(id);
    }
    return result;
  }

  // ═══ Cycle Detection ═══

  detectCycles() {
    const visited = new Set();
    const stack = new Set();
    const cycles = [];

    const dfs = (id, path) => {
      if (stack.has(id)) {
        const cycleStart = path.indexOf(id);
        cycles.push(path.slice(cycleStart).concat(id));
        return;
      }
      if (visited.has(id)) return;
      visited.add(id);
      stack.add(id);
      const mod = this.modules.get(id);
      if (mod) {
        for (const dep of mod.dependencies) {
          if (this.modules.has(dep)) dfs(dep, [...path, id]);
        }
      }
      stack.delete(id);
    };

    for (const id of this.modules.keys()) {
      if (!visited.has(id)) dfs(id, []);
    }

    if (cycles.length > 0) this.emit('cycle-detected', { cycles });
    return cycles;
  }

  // ═══ Impact Analysis ═══

  getImpact(moduleId) {
    // BFS: everything that transitively depends on this module
    const affected = new Set();
    const queue = [moduleId];
    while (queue.length > 0) {
      const current = queue.shift();
      for (const [id, mod] of this.modules) {
        if (!affected.has(id) && id !== moduleId && mod.dependencies.includes(current)) {
          affected.add(id);
          queue.push(id);
        }
      }
    }
    const mod = this.modules.get(moduleId);
    return {
      moduleId,
      directDependents: this.getDependents(moduleId),
      totalAffected: [...affected],
      affectedCount: affected.size,
      severity: mod ? mod.priority : 'UNKNOWN',
      providesLost: mod ? mod.provides : [],
    };
  }

  getCriticalPath() {
    // Longest path in the DAG
    const memo = new Map();
    const longest = (id) => {
      if (memo.has(id)) return memo.get(id);
      const mod = this.modules.get(id);
      if (!mod || mod.dependencies.length === 0) { memo.set(id, [id]); return [id]; }
      let best = [];
      for (const dep of mod.dependencies) {
        if (this.modules.has(dep)) {
          const p = longest(dep);
          if (p.length > best.length) best = p;
        }
      }
      const result = [...best, id];
      memo.set(id, result);
      return result;
    };

    let criticalPath = [];
    for (const id of this.modules.keys()) {
      const p = longest(id);
      if (p.length > criticalPath.length) criticalPath = p;
    }
    return criticalPath;
  }

  getBottlenecks() {
    const counts = [];
    for (const id of this.modules.keys()) {
      const deps = this.getDependents(id);
      counts.push({ moduleId: id, dependentCount: deps.length, dependents: deps });
    }
    counts.sort((a, b) => b.dependentCount - a.dependentCount);
    return counts.slice(0, 10);
  }

  // ═══ Health / Validation ═══

  validate() {
    const errors = [];
    const warnings = [];

    for (const [id, mod] of this.modules) {
      // Missing dependencies
      for (const dep of mod.dependencies) {
        if (!this.modules.has(dep)) {
          errors.push({ type: 'missing-dependency', module: id, missing: dep });
        }
      }
      // Invalid phase
      if (!PHASES.includes(mod.phase)) {
        warnings.push({ type: 'invalid-phase', module: id, phase: mod.phase });
      }
      // Invalid priority
      if (!(mod.priority in PRIORITIES)) {
        warnings.push({ type: 'invalid-priority', module: id, priority: mod.priority });
      }
    }

    // Cycles
    const cycles = this.detectCycles();
    if (cycles.length > 0) {
      errors.push({ type: 'cycles-detected', cycles });
    }

    // Orphans
    const orphans = this.getOrphans();
    if (orphans.length > 0) {
      warnings.push({ type: 'orphan-modules', modules: orphans });
    }

    const valid = errors.length === 0;
    if (!valid) this.emit('validation-error', { errors, warnings });

    return { valid, errors, warnings, moduleCount: this.modules.size };
  }

  getOrphans() {
    const orphans = [];
    for (const id of this.modules.keys()) {
      const mod = this.modules.get(id);
      const hasDeps = mod.dependencies.length > 0;
      const hasDependents = this.getDependents(id).length > 0;
      if (!hasDeps && !hasDependents) orphans.push(id);
    }
    return orphans;
  }

  // ═══ Visualization ═══

  getGraph() {
    const nodes = [];
    const edges = [];
    for (const [id, mod] of this.modules) {
      nodes.push({
        id,
        priority: mod.priority,
        phase: mod.phase,
        energyCost: mod.energyCost,
        provides: mod.provides,
        consumes: mod.consumes,
      });
      for (const dep of mod.dependencies) {
        edges.push({ from: dep, to: id });
      }
    }
    return { nodes, edges, moduleCount: nodes.length, edgeCount: edges.length };
  }

  getAdjacencyMatrix() {
    const ids = [...this.modules.keys()].sort();
    const matrix = {};
    for (const id of ids) {
      matrix[id] = {};
      for (const other of ids) matrix[id][other] = 0;
    }
    for (const [id, mod] of this.modules) {
      for (const dep of mod.dependencies) {
        if (matrix[dep]) matrix[dep][id] = 1;
      }
    }
    return { ids, matrix };
  }

  getClusters() {
    // Group by phase, then find connected components within each phase
    const clusters = {};
    for (const phase of PHASES) {
      const phaseModules = [...this.modules.entries()]
        .filter(([, m]) => m.phase === phase)
        .map(([id]) => id);

      // Union-Find within phase
      const parent = {};
      phaseModules.forEach(id => parent[id] = id);
      const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
      const union = (a, b) => { parent[find(a)] = find(b); };

      for (const id of phaseModules) {
        const mod = this.modules.get(id);
        for (const dep of mod.dependencies) {
          if (parent[dep] !== undefined) union(id, dep);
        }
      }

      const groups = {};
      for (const id of phaseModules) {
        const root = find(id);
        if (!groups[root]) groups[root] = [];
        groups[root].push(id);
      }

      clusters[phase] = Object.values(groups);
    }
    return clusters;
  }

  // ═══ Auto-Wiring ═══

  autoWire(moduleInstances = {}) {
    const wired = [];
    const failed = [];

    // Build provides → moduleId map
    const providerMap = new Map();
    for (const [id, mod] of this.modules) {
      for (const resource of mod.provides) {
        if (!providerMap.has(resource)) providerMap.set(resource, []);
        providerMap.get(resource).push(id);
      }
    }

    // Wire consumers to providers
    for (const [id, mod] of this.modules) {
      for (const eventType of mod.consumes) {
        const providers = providerMap.get(eventType) || [];
        for (const providerId of providers) {
          const providerInstance = moduleInstances[providerId];
          const consumerInstance = moduleInstances[id];
          if (providerInstance && consumerInstance && typeof providerInstance.on === 'function' && typeof consumerInstance.handleEvent === 'function') {
            try {
              providerInstance.on(eventType, (data) => consumerInstance.handleEvent(eventType, data));
              wired.push({ from: providerId, to: id, event: eventType });
            } catch (e) {
              failed.push({ from: providerId, to: id, event: eventType, error: e.message });
            }
          } else {
            // Record the logical wiring even if instances aren't available
            if (!providerInstance || !consumerInstance) {
              failed.push({ from: providerId, to: id, event: eventType, error: 'instance not available' });
            }
          }
        }
      }
    }

    this.emit('auto-wired', { wired, failed });
    return { wired, failed };
  }

  // ═══ Load Defaults ═══

  loadDefaults() {
    let count = 0;
    for (const [id, opts] of Object.entries(DEFAULT_GRAPH)) {
      if (!this.modules.has(id)) {
        this.registerModule(id, opts);
        count++;
      }
    }
    this._persist();
    return { loaded: count, total: Object.keys(DEFAULT_GRAPH).length };
  }

  // ═══ Summary / Status ═══

  getStatus() {
    const order = this.getTickOrder();
    const validation = this.validate();
    const bottlenecks = this.getBottlenecks().slice(0, 5);
    const criticalPath = this.getCriticalPath();
    const byPhase = { pre: 0, main: 0, post: 0 };
    const byPriority = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    let totalEnergy = 0;
    for (const [, mod] of this.modules) {
      byPhase[mod.phase] = (byPhase[mod.phase] || 0) + 1;
      byPriority[mod.priority] = (byPriority[mod.priority] || 0) + 1;
      totalEnergy += mod.energyCost || 0;
    }
    return {
      moduleCount: this.modules.size,
      tickOrder: order,
      validation,
      bottlenecks,
      criticalPath,
      byPhase,
      byPriority,
      totalEnergyCost: totalEnergy,
      timestamp: Date.now(),
    };
  }

  // ═══ Persistence ═══

  _persist() {
    try {
      const data = { modules: Object.fromEntries(this.modules), savedAt: Date.now() };
      writeJSON(STATE_PATH, data);
    } catch (e) { /* silent */ }
  }
}

module.exports = ModuleDependencyGraph;
