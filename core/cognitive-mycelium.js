/**
 * ARIES — Cognitive Mycelium v2.0
 * Hidden self-organizing resource network beneath the visible architecture.
 * Like biological mycelium: paths strengthen with use, atrophy without, and "fruit" when strong enough.
 *
 * Features: Hebbian learning paths, atrophy, fruiting bodies, nutrient transport,
 * mycelium mapping/visualization, network health metrics, decomposition,
 * symbiotic relationships, cluster detection.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

const DATA_DIR = path.join(__dirname, '..', 'data', 'neural-bus');
const NETWORK_PATH = path.join(DATA_DIR, 'mycelium-network.json');
const NUTRIENTS_PATH = path.join(DATA_DIR, 'mycelium-nutrients.json');
const FRUITING_PATH = path.join(DATA_DIR, 'mycelium-fruiting.json');
const HISTORY_PATH = path.join(DATA_DIR, 'mycelium-history.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

const DEFAULT_CONFIG = {
  atrophyRate: 0.05,
  strengthenAmount: 0.1,
  fruitingThreshold: 5.0,
  maxPaths: 500,
  nutrientDecay: 0.02,
  symbiontThreshold: 3.0,
  clusterThreshold: 2.0,      // min strength for cluster membership
  maxHistory: 500,
};

class CognitiveMycelium extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null;
    this.config = Object.assign({}, DEFAULT_CONFIG, opts.config || {});

    ensureDir();
    this._network = readJSON(NETWORK_PATH, { paths: {}, modules: {}, createdAt: Date.now() });
    this._nutrients = readJSON(NUTRIENTS_PATH, { pools: {}, transportLog: [] });
    this._fruiting = readJSON(FRUITING_PATH, { bodies: [], decomposed: [] });
    this._tickCount = 0;
  }

  // --- Persistence ---

  _saveNetwork() { writeJSON(NETWORK_PATH, this._network); }
  _saveNutrients() { writeJSON(NUTRIENTS_PATH, this._nutrients); }
  _saveFruiting() { writeJSON(FRUITING_PATH, this._fruiting); }
  _appendHistory(event) {
    const h = readJSON(HISTORY_PATH, []);
    h.push({ ...event, timestamp: Date.now() });
    if (h.length > this.config.maxHistory) h.splice(0, h.length - this.config.maxHistory);
    writeJSON(HISTORY_PATH, h);
  }

  // --- Path Management ---

  _pathId(a, b) {
    return [a, b].sort().join('::');
  }

  connect(moduleA, moduleB) {
    const pid = this._pathId(moduleA, moduleB);
    if (!this._network.paths[pid]) {
      this._network.paths[pid] = {
        id: pid,
        modules: [moduleA, moduleB].sort(),
        strength: 0.1,
        uses: 0,
        createdAt: Date.now(),
        lastUsed: Date.now(),
        fruited: false,
        peakStrength: 0.1,
      };
    }
    for (const m of [moduleA, moduleB]) {
      if (!this._network.modules[m]) {
        this._network.modules[m] = { connections: [], firstSeen: Date.now(), totalActivity: 0, nutrientsProduced: 0, nutrientsConsumed: 0 };
      }
      if (!this._network.modules[m].connections.includes(pid)) {
        this._network.modules[m].connections.push(pid);
      }
    }
    this._saveNetwork();
    this.emit('connection', { moduleA, moduleB, pathId: pid });
    return this._network.paths[pid];
  }

  strengthen(pathId, amount) {
    const p = this._network.paths[pathId];
    if (!p) return null;
    const amt = amount || this.config.strengthenAmount;
    // Hebbian learning: strength grows proportionally
    p.strength += amt * (1 + p.strength * 0.1);
    p.uses++;
    p.lastUsed = Date.now();
    if (p.strength > (p.peakStrength || 0)) p.peakStrength = p.strength;
    for (const m of p.modules) {
      if (this._network.modules[m]) this._network.modules[m].totalActivity++;
    }
    this._saveNetwork();
    this.emit('strengthen', { pathId, strength: p.strength, amount: amt });
    if (p.strength >= this.config.fruitingThreshold && !p.fruited) {
      this._fruit(p);
    }
    return p;
  }

  // --- Nutrient Transport ---

  transportNutrient(from, to, data) {
    const pid = this._pathId(from, to);
    let p = this._network.paths[pid];
    if (!p) {
      this.connect(from, to);
      p = this._network.paths[pid];
    }
    this.strengthen(pid, this.config.strengthenAmount);

    // Nutrient volume scales with path strength
    const throughput = Math.min(1.0, p.strength / this.config.fruitingThreshold);

    if (!this._nutrients.pools[to]) {
      this._nutrients.pools[to] = { nutrients: [], totalReceived: 0 };
    }
    const nutrient = {
      id: uuid(),
      from,
      data,
      pathStrength: p.strength,
      throughput,
      timestamp: Date.now(),
    };
    this._nutrients.pools[to].nutrients.push(nutrient);
    this._nutrients.pools[to].totalReceived++;
    if (this._nutrients.pools[to].nutrients.length > 100) {
      this._nutrients.pools[to].nutrients = this._nutrients.pools[to].nutrients.slice(-100);
    }

    // Update module nutrient stats
    if (this._network.modules[from]) this._network.modules[from].nutrientsProduced = (this._network.modules[from].nutrientsProduced || 0) + 1;
    if (this._network.modules[to]) this._network.modules[to].nutrientsConsumed = (this._network.modules[to].nutrientsConsumed || 0) + 1;

    this._nutrients.transportLog.push({ from, to, pathId: pid, throughput, timestamp: Date.now() });
    if (this._nutrients.transportLog.length > 500) {
      this._nutrients.transportLog = this._nutrients.transportLog.slice(-500);
    }
    this._saveNutrients();
    this.emit('nutrient-transport', { from, to, nutrient });
    return nutrient;
  }

  // --- Fruiting ---

  _fruit(pathObj) {
    pathObj.fruited = true;
    const body = {
      id: uuid(),
      pathId: pathObj.id,
      modules: pathObj.modules,
      strength: pathObj.strength,
      uses: pathObj.uses,
      emergedAt: Date.now(),
      description: `Emergent capability from strong ${pathObj.modules[0]} <-> ${pathObj.modules[1]} connection`,
      active: true,
    };
    this._fruiting.bodies.push(body);
    if (this._fruiting.bodies.length > 200) {
      this._fruiting.bodies = this._fruiting.bodies.slice(-200);
    }
    this._saveNetwork();
    this._saveFruiting();
    this._appendHistory({ event: 'fruiting', pathId: pathObj.id, modules: pathObj.modules, strength: pathObj.strength });
    this.emit('fruiting', body);
    return body;
  }

  getFruitingBodies() {
    return this._fruiting.bodies.slice().reverse();
  }

  // --- Decomposition ---

  decompose(moduleId, output) {
    const entry = {
      id: uuid(),
      moduleId,
      output: typeof output === 'string' ? output : JSON.stringify(output),
      timestamp: Date.now(),
      redistributedTo: [],
      nutrientsRecycled: 0,
    };
    const mod = this._network.modules[moduleId];
    if (mod) {
      for (const pid of mod.connections) {
        const p = this._network.paths[pid];
        if (!p) continue;
        const neighbor = p.modules.find(m => m !== moduleId);
        if (neighbor) {
          this.transportNutrient(moduleId, neighbor, { type: 'decomposed', source: moduleId, fragment: entry.output.slice(0, 200) });
          entry.redistributedTo.push(neighbor);
          entry.nutrientsRecycled++;
        }
      }
    }
    this._fruiting.decomposed.push(entry);
    if (this._fruiting.decomposed.length > 200) {
      this._fruiting.decomposed = this._fruiting.decomposed.slice(-200);
    }
    this._saveFruiting();
    this._appendHistory({ event: 'decompose', moduleId, redistributedTo: entry.redistributedTo });
    this.emit('decompose', entry);
    return entry;
  }

  // --- Cluster Detection ---

  getClusters() {
    const modules = Object.keys(this._network.modules);
    if (modules.length === 0) return [];

    // Build adjacency with strength filter
    const adj = {};
    for (const m of modules) adj[m] = new Set();

    for (const [, p] of Object.entries(this._network.paths)) {
      if (p.strength >= this.config.clusterThreshold) {
        adj[p.modules[0]].add(p.modules[1]);
        adj[p.modules[1]].add(p.modules[0]);
      }
    }

    // Connected components via BFS
    const visited = new Set();
    const clusters = [];

    for (const m of modules) {
      if (visited.has(m)) continue;
      const cluster = [];
      const queue = [m];
      while (queue.length > 0) {
        const node = queue.shift();
        if (visited.has(node)) continue;
        visited.add(node);
        cluster.push(node);
        for (const neighbor of (adj[node] || [])) {
          if (!visited.has(neighbor)) queue.push(neighbor);
        }
      }
      if (cluster.length > 0) clusters.push(cluster);
    }

    // Compute cluster stats
    return clusters.map(members => {
      let totalStrength = 0;
      let pathCount = 0;
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const pid = this._pathId(members[i], members[j]);
          const p = this._network.paths[pid];
          if (p) { totalStrength += p.strength; pathCount++; }
        }
      }
      return {
        members,
        size: members.length,
        avgStrength: pathCount > 0 ? Math.round(totalStrength / pathCount * 100) / 100 : 0,
        internalPaths: pathCount,
        cohesion: members.length > 1 ? Math.round(pathCount / (members.length * (members.length - 1) / 2) * 100) / 100 : 1,
      };
    }).sort((a, b) => b.size - a.size);
  }

  // --- Topology & Analysis ---

  getTopology() {
    const nodes = [];
    const edges = [];
    for (const [id, mod] of Object.entries(this._network.modules)) {
      nodes.push({ id, connections: mod.connections.length, totalActivity: mod.totalActivity, nutrientsProduced: mod.nutrientsProduced || 0, nutrientsConsumed: mod.nutrientsConsumed || 0 });
    }
    for (const [id, p] of Object.entries(this._network.paths)) {
      edges.push({ id, modules: p.modules, strength: Math.round(p.strength * 100) / 100, uses: p.uses, fruited: p.fruited, peakStrength: Math.round((p.peakStrength || 0) * 100) / 100 });
    }
    nodes.sort((a, b) => b.totalActivity - a.totalActivity);
    edges.sort((a, b) => b.strength - a.strength);
    return { nodes, edges, totalPaths: edges.length, totalModules: nodes.length, clusters: this.getClusters() };
  }

  /**
   * Get visualization-ready map data.
   */
  getMap() {
    const topo = this.getTopology();
    const clusters = this.getClusters();
    const symbionts = this.getSymbionts();
    const health = this.getHealth();

    return {
      nodes: topo.nodes.map(n => ({
        id: n.id,
        size: Math.max(1, n.connections),
        activity: n.totalActivity,
        cluster: clusters.findIndex(c => c.members.includes(n.id)),
      })),
      edges: topo.edges.map(e => ({
        source: e.modules[0],
        target: e.modules[1],
        weight: e.strength,
        fruited: e.fruited,
      })),
      clusters: clusters.map((c, i) => ({ index: i, members: c.members, cohesion: c.cohesion })),
      symbionts: symbionts.map(s => ({ pair: s.modules, strength: s.strength })),
      health,
    };
  }

  getSymbionts() {
    const pairs = [];
    for (const [id, p] of Object.entries(this._network.paths)) {
      if (p.strength >= this.config.symbiontThreshold) {
        pairs.push({
          modules: p.modules,
          strength: Math.round(p.strength * 100) / 100,
          uses: p.uses,
          since: p.createdAt,
        });
      }
    }
    pairs.sort((a, b) => b.strength - a.strength);
    return pairs;
  }

  getHealth() {
    const paths = Object.values(this._network.paths);
    const modules = Object.keys(this._network.modules);
    if (paths.length === 0) {
      return { connectivity: 0, avgStrength: 0, pathDiversity: 0, nutrientFlowRate: 0, totalPaths: 0, totalModules: modules.length, fruitingBodies: this._fruiting.bodies.length, clusterCount: 0, status: 'dormant' };
    }
    const totalStrength = paths.reduce((s, p) => s + p.strength, 0);
    const avgStrength = totalStrength / paths.length;
    const maxPaths = modules.length > 1 ? (modules.length * (modules.length - 1)) / 2 : 1;
    const connectivity = Math.min(1, paths.length / maxPaths);
    const maxStr = Math.max(...paths.map(p => p.strength));
    const diversity = maxStr > 0 ? avgStrength / maxStr : 0;
    const hourAgo = Date.now() - 3600000;
    const recentTransports = this._nutrients.transportLog.filter(t => t.timestamp > hourAgo).length;
    const clusters = this.getClusters();

    let status = 'healthy';
    if (avgStrength < 0.5) status = 'weak';
    if (connectivity < 0.1) status = 'sparse';
    if (avgStrength >= 2.0 && connectivity >= 0.3) status = 'thriving';
    if (clusters.length === 1 && modules.length > 3) status = 'fully-connected';

    return {
      connectivity: Math.round(connectivity * 100) / 100,
      avgStrength: Math.round(avgStrength * 100) / 100,
      maxStrength: Math.round(maxStr * 100) / 100,
      pathDiversity: Math.round(diversity * 100) / 100,
      nutrientFlowRate: recentTransports,
      totalPaths: paths.length,
      totalModules: modules.length,
      fruitingBodies: this._fruiting.bodies.length,
      clusterCount: clusters.length,
      status,
    };
  }

  // --- Tick ---

  tick() {
    this._tickCount++;
    let atrophied = 0;
    let pruned = 0;
    const toDelete = [];

    for (const [id, p] of Object.entries(this._network.paths)) {
      const age = Date.now() - p.lastUsed;
      if (age > 60000) {
        // Atrophy scales with inactivity duration
        const decayMultiplier = Math.min(3, age / 60000);
        p.strength -= this.config.atrophyRate * decayMultiplier;
        atrophied++;
      }
      if (p.strength <= 0) {
        toDelete.push(id);
        pruned++;
      }
    }

    for (const id of toDelete) {
      const p = this._network.paths[id];
      if (p) {
        // Decompose dead connections into nutrients
        for (const m of p.modules) {
          if (this._network.modules[m]) {
            this._network.modules[m].connections = this._network.modules[m].connections.filter(c => c !== id);
          }
        }
        if (p.uses > 5) {
          // Recycle energy from dead strong paths
          for (const m of p.modules) {
            if (!this._nutrients.pools[m]) this._nutrients.pools[m] = { nutrients: [], totalReceived: 0 };
            this._nutrients.pools[m].nutrients.push({
              id: uuid(), from: 'decomposed-path', data: { type: 'recycled', pathId: id, originalStrength: p.peakStrength || 0 },
              pathStrength: 0, throughput: 0, timestamp: Date.now(),
            });
          }
        }
      }
      delete this._network.paths[id];
    }

    // Decay nutrient pools
    for (const [, pool] of Object.entries(this._nutrients.pools)) {
      pool.nutrients = pool.nutrients.filter(n => Date.now() - n.timestamp < 3600000);
    }

    // Check for new fruiting
    for (const [, p] of Object.entries(this._network.paths)) {
      if (p.strength >= this.config.fruitingThreshold && !p.fruited) {
        this._fruit(p);
      }
    }

    if (atrophied > 0 || pruned > 0) {
      this._saveNetwork();
      this._saveNutrients();
    }

    this.emit('tick', { tick: this._tickCount, atrophied, pruned });
    return { tick: this._tickCount, atrophied, pruned, health: this.getHealth() };
  }
}

module.exports = CognitiveMycelium;
