/**
 * ARIES — Neuroplasticity
 * Dynamic rewiring of module connections based on effectiveness.
 * Tracks inter-module interactions, strengthens/weakens pathways, suggests restructuring.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'neuroplasticity');
const CONNECTIONS_PATH = path.join(DATA_DIR, 'connections.json');
const HISTORY_PATH = path.join(DATA_DIR, 'history.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }

// Known Aries modules
const MODULES = [
  'agent-dreams', 'self-model', 'inner-monologue', 'emotional-engine',
  'stream-of-consciousness', 'true-perception', 'time-perception',
  'user-empathy', 'creativity-engine', 'subconscious', 'reasoning-chains',
  'knowledge-distiller', 'skill-synthesis', 'self-healing', 'self-versioning',
  'cognitive-freeze', 'persona-forking', 'associative-memory', 'cognitive-rhythms',
  'recursive-improvement', 'behavioral-genetics', 'consequence-simulator',
  'soul-checksum', 'ghost-protocol', 'synesthesia'
];

class Neuroplasticity {
  constructor() {
    ensureDir();
    this._initIfNeeded();
  }

  _initIfNeeded() {
    const conns = readJSON(CONNECTIONS_PATH, null);
    if (!conns) {
      // Seed with default connections based on logical relationships
      const connections = {};
      const defaults = [
        ['agent-dreams', 'subconscious', 60], ['agent-dreams', 'creativity-engine', 55],
        ['agent-dreams', 'self-model', 40], ['inner-monologue', 'emotional-engine', 70],
        ['inner-monologue', 'stream-of-consciousness', 65], ['emotional-engine', 'user-empathy', 75],
        ['true-perception', 'time-perception', 50], ['true-perception', 'stream-of-consciousness', 45],
        ['reasoning-chains', 'knowledge-distiller', 60], ['self-model', 'behavioral-genetics', 55],
        ['self-model', 'recursive-improvement', 50], ['cognitive-freeze', 'persona-forking', 45],
        ['associative-memory', 'knowledge-distiller', 65], ['soul-checksum', 'self-model', 50],
        ['ghost-protocol', 'agent-dreams', 40], ['synesthesia', 'creativity-engine', 55],
        ['self-healing', 'self-versioning', 60], ['cognitive-rhythms', 'time-perception', 50],
      ];
      for (const [from, to, strength] of defaults) {
        const key = `${from}→${to}`;
        connections[key] = {
          from, to, strength, frequency: 0, successRate: 100,
          successes: 0, failures: 0, lastUsed: Date.now(), createdAt: Date.now()
        };
      }
      writeJSON(CONNECTIONS_PATH, connections);
      writeJSON(HISTORY_PATH, { events: [] });
    }
  }

  _getKey(from, to) { return `${from}→${to}`; }

  _record(event) {
    const history = readJSON(HISTORY_PATH, { events: [] });
    history.events.push({ ...event, timestamp: Date.now() });
    if (history.events.length > 2000) history.events = history.events.slice(-2000);
    writeJSON(HISTORY_PATH, history);
  }

  /**
   * Record a successful interaction between modules.
   */
  strengthen(from, to) {
    const conns = readJSON(CONNECTIONS_PATH, {});
    const key = this._getKey(from, to);
    if (!conns[key]) {
      conns[key] = { from, to, strength: 30, frequency: 0, successRate: 100, successes: 0, failures: 0, lastUsed: Date.now(), createdAt: Date.now() };
    }
    const c = conns[key];
    c.strength = Math.min(100, c.strength + 3);
    c.frequency++;
    c.successes++;
    c.successRate = Math.round((c.successes / (c.successes + c.failures)) * 100);
    c.lastUsed = Date.now();
    writeJSON(CONNECTIONS_PATH, conns);
    this._record({ type: 'strengthen', from, to, newStrength: c.strength });
    return c;
  }

  /**
   * Record a failed/underperforming interaction.
   */
  weaken(from, to) {
    const conns = readJSON(CONNECTIONS_PATH, {});
    const key = this._getKey(from, to);
    if (!conns[key]) return { error: 'Connection not found' };
    const c = conns[key];
    c.strength = Math.max(0, c.strength - 5);
    c.frequency++;
    c.failures++;
    c.successRate = Math.round((c.successes / (c.successes + c.failures)) * 100);
    c.lastUsed = Date.now();
    writeJSON(CONNECTIONS_PATH, conns);
    this._record({ type: 'weaken', from, to, newStrength: c.strength });
    return c;
  }

  /**
   * Full map of inter-module connections.
   */
  getConnectionMap() {
    const conns = readJSON(CONNECTIONS_PATH, {});
    const modules = new Set();
    const connections = Object.values(conns);
    for (const c of connections) {
      modules.add(c.from);
      modules.add(c.to);
    }
    return {
      modules: [...modules],
      connections,
      totalConnections: connections.length,
      avgStrength: connections.length > 0 ? Math.round(connections.reduce((s, c) => s + c.strength, 0) / connections.length) : 0
    };
  }

  /**
   * Suggest merging redundant modules.
   */
  suggestMerge() {
    const conns = readJSON(CONNECTIONS_PATH, {});
    const connections = Object.values(conns);
    const suggestions = [];

    // Find modules that share many of the same connections with similar strength
    const moduleConns = {};
    for (const c of connections) {
      if (!moduleConns[c.from]) moduleConns[c.from] = new Set();
      if (!moduleConns[c.to]) moduleConns[c.to] = new Set();
      moduleConns[c.from].add(c.to);
      moduleConns[c.to].add(c.from);
    }

    const mods = Object.keys(moduleConns);
    for (let i = 0; i < mods.length; i++) {
      for (let j = i + 1; j < mods.length; j++) {
        const a = moduleConns[mods[i]];
        const b = moduleConns[mods[j]];
        const intersection = [...a].filter(x => b.has(x));
        const union = new Set([...a, ...b]);
        const overlap = union.size > 0 ? intersection.length / union.size : 0;
        if (overlap > 0.6) {
          suggestions.push({
            modules: [mods[i], mods[j]],
            overlap: Math.round(overlap * 100),
            sharedConnections: intersection,
            reason: `${mods[i]} and ${mods[j]} share ${Math.round(overlap * 100)}% of connections — possibly redundant`
          });
        }
      }
    }
    return { suggestions };
  }

  /**
   * Suggest splitting overloaded modules.
   */
  suggestSplit() {
    const conns = readJSON(CONNECTIONS_PATH, {});
    const connections = Object.values(conns);
    const suggestions = [];

    // Count connections per module
    const connCount = {};
    for (const c of connections) {
      connCount[c.from] = (connCount[c.from] || 0) + 1;
      connCount[c.to] = (connCount[c.to] || 0) + 1;
    }

    for (const [mod, count] of Object.entries(connCount)) {
      if (count > 8) {
        suggestions.push({
          module: mod,
          connectionCount: count,
          reason: `${mod} has ${count} connections — may be doing too many things, consider splitting`
        });
      }
    }
    return { suggestions };
  }

  /**
   * Remove connections below threshold.
   */
  prune(threshold) {
    threshold = threshold || 10;
    const conns = readJSON(CONNECTIONS_PATH, {});
    const pruned = [];
    for (const [key, c] of Object.entries(conns)) {
      if (c.strength < threshold) {
        pruned.push({ from: c.from, to: c.to, strength: c.strength });
        delete conns[key];
      }
    }
    writeJSON(CONNECTIONS_PATH, conns);
    this._record({ type: 'prune', threshold, pruned: pruned.length });
    return { pruned, count: pruned.length, threshold };
  }

  /**
   * Most active module pathways.
   */
  getHotPaths() {
    const conns = readJSON(CONNECTIONS_PATH, {});
    return Object.values(conns)
      .filter(c => c.strength >= 60)
      .sort((a, b) => b.strength - a.strength || b.frequency - a.frequency)
      .slice(0, 20);
  }

  /**
   * Dormant connections.
   */
  getColdPaths() {
    const conns = readJSON(CONNECTIONS_PATH, {});
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return Object.values(conns)
      .filter(c => c.strength < 30 || c.lastUsed < oneWeekAgo)
      .sort((a, b) => a.strength - b.strength)
      .slice(0, 20);
  }

  /**
   * Restructure connections for efficiency based on accumulated data.
   */
  rewire() {
    const conns = readJSON(CONNECTIONS_PATH, {});
    const changes = [];

    for (const [key, c] of Object.entries(conns)) {
      // Boost high-success connections
      if (c.successRate > 80 && c.frequency > 5 && c.strength < 90) {
        const boost = Math.min(10, Math.round((c.successRate - 80) / 4));
        c.strength = Math.min(100, c.strength + boost);
        changes.push({ action: 'boosted', connection: key, by: boost, newStrength: c.strength });
      }
      // Dampen low-success connections
      if (c.successRate < 40 && c.frequency > 3) {
        const dampen = Math.min(15, Math.round((40 - c.successRate) / 4));
        c.strength = Math.max(0, c.strength - dampen);
        changes.push({ action: 'dampened', connection: key, by: dampen, newStrength: c.strength });
      }
      // Decay unused connections
      const daysSinceUse = (Date.now() - c.lastUsed) / (24 * 60 * 60 * 1000);
      if (daysSinceUse > 14 && c.strength > 5) {
        const decay = Math.min(c.strength - 5, Math.round(daysSinceUse / 7));
        c.strength -= decay;
        if (decay > 0) changes.push({ action: 'decayed', connection: key, by: decay, newStrength: c.strength });
      }
    }

    writeJSON(CONNECTIONS_PATH, conns);
    this._record({ type: 'rewire', changes: changes.length });
    return { changes, totalRewired: changes.length };
  }

  /**
   * Get suggestions (merge + split combined).
   */
  getSuggestions() {
    return {
      merge: this.suggestMerge().suggestions,
      split: this.suggestSplit().suggestions
    };
  }

  /**
   * Get history of neuroplasticity events.
   */
  getHistory(limit) {
    const history = readJSON(HISTORY_PATH, { events: [] });
    return { events: history.events.slice(-(limit || 50)) };
  }
}

module.exports = Neuroplasticity;
