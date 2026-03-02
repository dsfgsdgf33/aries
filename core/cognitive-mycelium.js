/**
 * ARIES — Cognitive Mycelium
 * Hidden self-organizing resource network beneath the visible architecture.
 * Like biological mycelium: paths strengthen with use, atrophy without, and "fruit" when strong enough.
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

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

const DEFAULT_CONFIG = {
  atrophyRate: 0.05,           // strength lost per tick when unused
  strengthenAmount: 0.1,       // default reinforcement per use
  fruitingThreshold: 5.0,      // strength needed to fruit
  maxPaths: 500,               // max connections tracked
  nutrientDecay: 0.02,         // nutrient pool decay per tick
  symbiontThreshold: 3.0,      // mutual strength to count as symbiotic
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
      };
    }
    // Register modules
    for (const m of [moduleA, moduleB]) {
      if (!this._network.modules[m]) {
        this._network.modules[m] = { connections: [], firstSeen: Date.now(), totalActivity: 0 };
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
    p.strength += amt;
    p.uses++;
    p.lastUsed = Date.now();
    // Update module activity
    for (const m of p.modules) {
      if (this._network.modules[m]) this._network.modules[m].totalActivity++;
    }
    this._saveNetwork();
    this.emit('strengthen', { pathId, strength: p.strength, amount: amt });
    // Check for fruiting
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
      // Auto-connect on first transport
      this.connect(from, to);
      p = this._network.paths[pid];
    }
    // Strengthen path on use
    this.strengthen(pid, this.config.strengthenAmount);

    // Add to nutrient pool of destination
    if (!this._nutrients.pools[to]) {
      this._nutrients.pools[to] = { nutrients: [], totalReceived: 0 };
    }
    const nutrient = {
      id: uuid(),
      from,
      data,
      pathStrength: p.strength,
      timestamp: Date.now(),
    };
    this._nutrients.pools[to].nutrients.push(nutrient);
    this._nutrients.pools[to].totalReceived++;
    // Cap stored nutrients per module
    if (this._nutrients.pools[to].nutrients.length > 100) {
      this._nutrients.pools[to].nutrients = this._nutrients.pools[to].nutrients.slice(-100);
    }
    // Transport log
    this._nutrients.transportLog.push({ from, to, pathId: pid, timestamp: Date.now() });
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
    };
    this._fruiting.bodies.push(body);
    if (this._fruiting.bodies.length > 200) {
      this._fruiting.bodies = this._fruiting.bodies.slice(-200);
    }
    this._saveNetwork();
    this._saveFruiting();
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
    };
    // Redistribute as nutrients to connected modules
    const mod = this._network.modules[moduleId];
    if (mod) {
      for (const pid of mod.connections) {
        const p = this._network.paths[pid];
        if (!p) continue;
        const neighbor = p.modules.find(m => m !== moduleId);
        if (neighbor) {
          this.transportNutrient(moduleId, neighbor, { type: 'decomposed', source: moduleId, fragment: entry.output.slice(0, 200) });
          entry.redistributedTo.push(neighbor);
        }
      }
    }
    this._fruiting.decomposed.push(entry);
    if (this._fruiting.decomposed.length > 200) {
      this._fruiting.decomposed = this._fruiting.decomposed.slice(-200);
    }
    this._saveFruiting();
    this.emit('decompose', entry);
    return entry;
  }

  // --- Topology & Analysis ---

  getTopology() {
    const nodes = [];
    const edges = [];
    for (const [id, mod] of Object.entries(this._network.modules)) {
      nodes.push({ id, connections: mod.connections.length, totalActivity: mod.totalActivity });
    }
    for (const [id, p] of Object.entries(this._network.paths)) {
      edges.push({ id, modules: p.modules, strength: Math.round(p.strength * 100) / 100, uses: p.uses, fruited: p.fruited });
    }
    nodes.sort((a, b) => b.totalActivity - a.totalActivity);
    edges.sort((a, b) => b.strength - a.strength);
    return { nodes, edges, totalPaths: edges.length, totalModules: nodes.length };
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
      return { connectivity: 0, avgStrength: 0, pathDiversity: 0, nutrientFlowRate: 0, totalPaths: 0, totalModules: modules.length, fruitingBodies: this._fruiting.bodies.length, status: 'dormant' };
    }
    const totalStrength = paths.reduce((s, p) => s + p.strength, 0);
    const avgStrength = totalStrength / paths.length;
    // Connectivity: ratio of actual to possible connections
    const maxPaths = modules.length > 1 ? (modules.length * (modules.length - 1)) / 2 : 1;
    const connectivity = Math.min(1, paths.length / maxPaths);
    // Path diversity: how evenly distributed is strength
    const maxStr = Math.max(...paths.map(p => p.strength));
    const diversity = maxStr > 0 ? avgStrength / maxStr : 0;
    // Nutrient flow: transports in last hour
    const hourAgo = Date.now() - 3600000;
    const recentTransports = this._nutrients.transportLog.filter(t => t.timestamp > hourAgo).length;

    let status = 'healthy';
    if (avgStrength < 0.5) status = 'weak';
    if (connectivity < 0.1) status = 'sparse';
    if (avgStrength >= 2.0 && connectivity >= 0.3) status = 'thriving';

    return {
      connectivity: Math.round(connectivity * 100) / 100,
      avgStrength: Math.round(avgStrength * 100) / 100,
      pathDiversity: Math.round(diversity * 100) / 100,
      nutrientFlowRate: recentTransports,
      totalPaths: paths.length,
      totalModules: modules.length,
      fruitingBodies: this._fruiting.bodies.length,
      status,
    };
  }

  // --- Tick (periodic maintenance) ---

  tick() {
    this._tickCount++;
    let atrophied = 0;
    let pruned = 0;
    const toDelete = [];

    for (const [id, p] of Object.entries(this._network.paths)) {
      // Atrophy unused paths
      const age = Date.now() - p.lastUsed;
      if (age > 60000) { // unused for >1 minute
        p.strength -= this.config.atrophyRate;
        atrophied++;
      }
      // Prune dead paths
      if (p.strength <= 0) {
        toDelete.push(id);
        pruned++;
      }
    }

    // Remove dead paths
    for (const id of toDelete) {
      const p = this._network.paths[id];
      if (p) {
        for (const m of p.modules) {
          if (this._network.modules[m]) {
            this._network.modules[m].connections = this._network.modules[m].connections.filter(c => c !== id);
          }
        }
      }
      delete this._network.paths[id];
    }

    // Decay nutrient pools
    for (const [modId, pool] of Object.entries(this._nutrients.pools)) {
      const before = pool.nutrients.length;
      pool.nutrients = pool.nutrients.filter(n => Date.now() - n.timestamp < 3600000); // 1hr TTL
    }

    // Check for new fruiting
    for (const [id, p] of Object.entries(this._network.paths)) {
      if (p.strength >= this.config.fruitingThreshold && !p.fruited) {
        this._fruit(p);
      }
    }

    if (atrophied > 0 || pruned > 0) {
      this._saveNetwork();
      this._saveNutrients();
    }

    this.emit('tick', { tick: this._tickCount, atrophied, pruned });
    return { tick: this._tickCount, atrophied, pruned };
  }
}

module.exports = CognitiveMycelium;
