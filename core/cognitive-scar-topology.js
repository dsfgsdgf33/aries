/**
 * ARIES — Cognitive Scar Topology
 * Topology mapping of accumulated damage and learning across cognitive regions.
 * Scars shape how Aries processes — calluses speed things up, damage slows them down.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'cognitive');
const TOPOLOGY_PATH = path.join(DATA_DIR, 'topology.json');
const HISTORY_PATH = path.join(DATA_DIR, 'history.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

const SCAR_TYPES = {
  DAMAGE:  { label: 'damage',  effect: 'slower',        flexibility: 0.8, speed: 0.6 },
  CALLUS:  { label: 'callus',  effect: 'faster-rigid',  flexibility: 0.5, speed: 1.4 },
  GRAFT:   { label: 'graft',   effect: 'new-capability', flexibility: 1.2, speed: 1.0 },
};

const REGIONS = ['reasoning', 'creativity', 'memory', 'social', 'technical', 'ethical'];

function defaultTopology() {
  const regions = {};
  for (const r of REGIONS) {
    regions[r] = {
      scars: [],
      totalDamage: 0,
      totalCallus: 0,
      totalGraft: 0,
      resilience: 50,   // 0-100
      vulnerability: 50, // 0-100
    };
  }
  return { regions, createdAt: Date.now(), lastEvolved: Date.now(), evolutionCount: 0 };
}

class CognitiveScarTopology {
  constructor(opts) {
    this.ai = opts && opts.ai || null;
    this.config = opts && opts.config || {};
    ensureDir();
    this._topo = readJSON(TOPOLOGY_PATH, null);
    if (!this._topo) {
      this._topo = defaultTopology();
      this._save();
    }
    // Ensure all regions exist (forward compat)
    for (const r of REGIONS) {
      if (!this._topo.regions[r]) {
        this._topo.regions[r] = { scars: [], totalDamage: 0, totalCallus: 0, totalGraft: 0, resilience: 50, vulnerability: 50 };
      }
    }
    this._history = readJSON(HISTORY_PATH, { events: [] });
  }

  _save() { writeJSON(TOPOLOGY_PATH, this._topo); }
  _saveHistory() { writeJSON(HISTORY_PATH, this._history); }

  _record(event) {
    this._history.events.push({ ...event, timestamp: Date.now() });
    if (this._history.events.length > 2000) this._history.events = this._history.events.slice(-2000);
    this._saveHistory();
  }

  _recalcRegion(name) {
    const region = this._topo.regions[name];
    if (!region) return;
    const scars = region.scars;
    region.totalDamage = scars.filter(s => s.type === 'DAMAGE').reduce((a, s) => a + s.severity, 0);
    region.totalCallus = scars.filter(s => s.type === 'CALLUS').reduce((a, s) => a + s.severity, 0);
    region.totalGraft  = scars.filter(s => s.type === 'GRAFT').reduce((a, s) => a + s.severity, 0);

    // Resilience: calluses + grafts increase it, damage decreases
    const positive = region.totalCallus * 1.5 + region.totalGraft;
    const negative = region.totalDamage;
    region.resilience = Math.round(Math.max(0, Math.min(100, 50 + (positive - negative) * 0.3)));
    region.vulnerability = Math.round(100 - region.resilience);
  }

  /**
   * Record a scar in a cognitive region.
   */
  addScar(region, type, severity, cause) {
    type = (type || 'DAMAGE').toUpperCase();
    if (!SCAR_TYPES[type]) type = 'DAMAGE';
    region = region || 'reasoning';
    if (!this._topo.regions[region]) {
      this._topo.regions[region] = { scars: [], totalDamage: 0, totalCallus: 0, totalGraft: 0, resilience: 50, vulnerability: 50 };
    }

    severity = Math.max(1, Math.min(100, severity || 20));

    const scar = {
      id: uuid(),
      type,
      severity,
      cause: cause || 'unknown',
      createdAt: Date.now(),
      age: 0,       // ticks since creation
      calcified: false,
    };

    this._topo.regions[region].scars.push(scar);
    this._recalcRegion(region);
    this._save();
    this._record({ type: 'add_scar', region, scarType: type, severity, cause });

    return { scar, region, resilience: this._topo.regions[region].resilience };
  }

  /**
   * Full scar topology.
   */
  getTopology() {
    const summary = {};
    for (const [name, region] of Object.entries(this._topo.regions)) {
      summary[name] = {
        scarCount: region.scars.length,
        totalDamage: region.totalDamage,
        totalCallus: region.totalCallus,
        totalGraft: region.totalGraft,
        resilience: region.resilience,
        vulnerability: region.vulnerability,
        terrainEffect: this._getTerrainEffect(name),
      };
    }
    return {
      regions: summary,
      evolutionCount: this._topo.evolutionCount,
      lastEvolved: this._topo.lastEvolved,
    };
  }

  /**
   * Detailed view of a specific region.
   */
  getRegion(name) {
    const region = this._topo.regions[name];
    if (!region) return { error: 'Unknown region' };
    return {
      name,
      scars: region.scars,
      totalDamage: region.totalDamage,
      totalCallus: region.totalCallus,
      totalGraft: region.totalGraft,
      resilience: region.resilience,
      vulnerability: region.vulnerability,
      terrainEffect: this._getTerrainEffect(name),
    };
  }

  /**
   * How scarring affects processing in a region.
   */
  _getTerrainEffect(name) {
    const region = this._topo.regions[name];
    if (!region || region.scars.length === 0) return { speed: 1.0, flexibility: 1.0, description: 'pristine' };

    let speedMod = 1.0;
    let flexMod = 1.0;
    for (const s of region.scars) {
      const typeInfo = SCAR_TYPES[s.type] || SCAR_TYPES.DAMAGE;
      const weight = s.severity / 100;
      speedMod += (typeInfo.speed - 1.0) * weight;
      flexMod += (typeInfo.flexibility - 1.0) * weight;
    }

    speedMod = Math.round(Math.max(0.3, Math.min(2.0, speedMod)) * 100) / 100;
    flexMod = Math.round(Math.max(0.2, Math.min(2.0, flexMod)) * 100) / 100;

    let description = 'normal';
    if (region.totalCallus > region.totalDamage + region.totalGraft) description = 'hardened';
    else if (region.totalDamage > region.totalCallus + region.totalGraft) description = 'wounded';
    else if (region.totalGraft > region.totalDamage) description = 'augmented';

    return { speed: speedMod, flexibility: flexMod, description };
  }

  /**
   * Weakest points across all regions.
   */
  getVulnerabilities() {
    return Object.entries(this._topo.regions)
      .map(([name, r]) => ({ region: name, vulnerability: r.vulnerability, damage: r.totalDamage, scarCount: r.scars.length }))
      .sort((a, b) => b.vulnerability - a.vulnerability)
      .slice(0, 6);
  }

  /**
   * Strongest points across all regions.
   */
  getResilience() {
    return Object.entries(this._topo.regions)
      .map(([name, r]) => ({ region: name, resilience: r.resilience, callus: r.totalCallus, graft: r.totalGraft }))
      .sort((a, b) => b.resilience - a.resilience)
      .slice(0, 6);
  }

  /**
   * Evolve topology: damage can become calluses over time, old scars calcify.
   */
  evolve() {
    const changes = [];

    for (const [name, region] of Object.entries(this._topo.regions)) {
      for (const scar of region.scars) {
        scar.age++;

        // Old damage can become callus (learned from it)
        if (scar.type === 'DAMAGE' && scar.age > 10 && !scar.calcified && Math.random() < 0.15) {
          scar.type = 'CALLUS';
          scar.severity = Math.round(scar.severity * 0.7); // Callus is less intense
          changes.push({ action: 'damage_to_callus', region: name, scarId: scar.id });
        }

        // Old scars calcify (permanent but reduced effect)
        if (scar.age > 30 && !scar.calcified) {
          scar.calcified = true;
          scar.severity = Math.round(scar.severity * 0.6);
          changes.push({ action: 'calcified', region: name, scarId: scar.id, type: scar.type });
        }

        // Very old, very weak scars fade
        if (scar.age > 50 && scar.severity < 5) {
          scar.severity = 0; // Will be pruned
          changes.push({ action: 'faded', region: name, scarId: scar.id });
        }
      }

      // Prune dead scars
      region.scars = region.scars.filter(s => s.severity > 0);
      this._recalcRegion(name);
    }

    this._topo.evolutionCount++;
    this._topo.lastEvolved = Date.now();
    this._save();

    if (changes.length > 0) {
      this._record({ type: 'evolve', changes: changes.length });
    }
    return { changes, evolutionCount: this._topo.evolutionCount };
  }

  /**
   * Periodic tick — runs evolution.
   */
  tick() {
    return this.evolve();
  }

  /**
   * Cross-scar analysis: unified view connecting pain and moral systems.
   */
  getCrossAnalysis() {
    const topo = this.getTopology();
    const vulns = this.getVulnerabilities();
    const strong = this.getResilience();

    return {
      topology: topo.regions,
      mostVulnerable: vulns[0] || null,
      mostResilient: strong[0] || null,
      overallHealth: Math.round(
        Object.values(this._topo.regions).reduce((s, r) => s + r.resilience, 0) / REGIONS.length
      ),
      scarTotal: Object.values(this._topo.regions).reduce((s, r) => s + r.scars.length, 0),
    };
  }

  /**
   * Get event history.
   */
  getHistory(limit) {
    return { events: this._history.events.slice(-(limit || 50)) };
  }
}

module.exports = CognitiveScarTopology;
