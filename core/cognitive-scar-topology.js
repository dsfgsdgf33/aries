/**
 * ARIES — Cognitive Scar Topology
 * Topology mapping of accumulated damage and learning across cognitive regions.
 * Scars shape processing — calluses speed things up, damage slows them down, grafts add capability.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

const DATA_DIR = path.join(__dirname, '..', 'data', 'cognitive');
const TOPOLOGY_PATH = path.join(DATA_DIR, 'topology.json');
const HISTORY_PATH = path.join(DATA_DIR, 'history.json');
const PATTERNS_PATH = path.join(DATA_DIR, 'scar-patterns.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

const SCAR_TYPES = {
  DAMAGE:  { label: 'damage',  effect: 'slower',         flexibility: 0.8, speed: 0.6 },
  CALLUS:  { label: 'callus',  effect: 'faster-rigid',   flexibility: 0.5, speed: 1.4 },
  GRAFT:   { label: 'graft',   effect: 'new-capability', flexibility: 1.2, speed: 1.0 },
};

const REGIONS = ['reasoning', 'creativity', 'memory', 'social', 'technical', 'ethical'];

// Adjacent regions for interaction effects
const ADJACENCY = {
  reasoning:  ['memory', 'technical', 'ethical'],
  creativity: ['memory', 'social'],
  memory:     ['reasoning', 'creativity'],
  social:     ['creativity', 'ethical'],
  technical:  ['reasoning', 'memory'],
  ethical:    ['reasoning', 'social'],
};

function defaultTopology() {
  const regions = {};
  for (const r of REGIONS) {
    regions[r] = {
      scars: [],
      totalDamage: 0,
      totalCallus: 0,
      totalGraft: 0,
      resilience: 50,
      vulnerability: 50,
    };
  }
  return { regions, createdAt: Date.now(), lastEvolved: Date.now(), evolutionCount: 0 };
}

class CognitiveScarTopology extends EventEmitter {
  constructor(opts) {
    super();
    this.ai = opts && opts.ai || null;
    this.config = opts && opts.config || {};
    ensureDir();
    this._topo = readJSON(TOPOLOGY_PATH, null);
    if (!this._topo) {
      this._topo = defaultTopology();
      this._save();
    }
    for (const r of REGIONS) {
      if (!this._topo.regions[r]) {
        this._topo.regions[r] = { scars: [], totalDamage: 0, totalCallus: 0, totalGraft: 0, resilience: 50, vulnerability: 50 };
      }
    }
    this._history = readJSON(HISTORY_PATH, { events: [] });
    this._patterns = readJSON(PATTERNS_PATH, { detected: [] });
  }

  _save() { writeJSON(TOPOLOGY_PATH, this._topo); }
  _saveHistory() { writeJSON(HISTORY_PATH, this._history); }
  _savePatterns() { writeJSON(PATTERNS_PATH, this._patterns); }

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
      originalSeverity: severity,
      cause: cause || 'unknown',
      createdAt: Date.now(),
      age: 0,
      calcified: false,
      interactions: [],  // effects from nearby scars
    };

    this._topo.regions[region].scars.push(scar);

    // Scar interaction: nearby scars in adjacent regions influence each other
    this._applyScarInteractions(region, scar);

    // Pattern detection
    this._detectPattern(region, type, cause);

    this._recalcRegion(region);
    this._save();
    this._record({ type: 'add_scar', region, scarType: type, severity, cause });
    this.emit('scar-added', { scar, region });

    return { scar, region, resilience: this._topo.regions[region].resilience };
  }

  /**
   * Scar interaction — nearby scars in adjacent regions influence the new scar.
   */
  _applyScarInteractions(region, newScar) {
    const adjacent = ADJACENCY[region] || [];
    for (const adjRegion of adjacent) {
      const adjScars = (this._topo.regions[adjRegion] || {}).scars || [];
      for (const adjScar of adjScars) {
        if (adjScar.age > 20) continue; // only recent scars interact
        // Same-type scars amplify; different types modulate
        if (adjScar.type === newScar.type) {
          newScar.severity = Math.min(100, Math.round(newScar.severity * 1.1));
          newScar.interactions.push({ from: adjRegion, scarId: adjScar.id, effect: 'amplified', type: adjScar.type });
        } else if (adjScar.type === 'CALLUS' && newScar.type === 'DAMAGE') {
          newScar.severity = Math.max(1, Math.round(newScar.severity * 0.85));
          newScar.interactions.push({ from: adjRegion, scarId: adjScar.id, effect: 'dampened', type: 'callus_protection' });
        } else if (adjScar.type === 'GRAFT') {
          newScar.interactions.push({ from: adjRegion, scarId: adjScar.id, effect: 'modulated', type: 'graft_influence' });
        }
      }
    }
  }

  /**
   * Detect recurring injury patterns.
   */
  _detectPattern(region, type, cause) {
    // Look for same cause+type in same region within recent history
    const recentEvents = this._history.events.filter(
      e => e.type === 'add_scar' && e.region === region && e.scarType === type && e.cause === cause &&
        Date.now() - e.timestamp < 7 * 24 * 60 * 60 * 1000
    );

    if (recentEvents.length >= 3) {
      const existing = this._patterns.detected.find(
        p => p.region === region && p.scarType === type && p.cause === cause && !p.resolved
      );
      if (!existing) {
        const pattern = {
          id: uuid(),
          region,
          scarType: type,
          cause,
          occurrences: recentEvents.length,
          firstSeen: recentEvents[0].timestamp,
          lastSeen: Date.now(),
          resolved: false,
          warning: `Recurring ${type} injury pattern in ${region}: "${cause}" (${recentEvents.length}x in 7 days)`,
        };
        this._patterns.detected.push(pattern);
        if (this._patterns.detected.length > 200) this._patterns.detected = this._patterns.detected.slice(-200);
        this._savePatterns();
        this.emit('pattern-detected', pattern);
      } else {
        existing.occurrences = recentEvents.length;
        existing.lastSeen = Date.now();
        this._savePatterns();
      }
    }
  }

  /**
   * Transplant a GRAFT scar from one region to another.
   */
  transplant(scarId, fromRegion, toRegion) {
    const srcRegion = this._topo.regions[fromRegion];
    if (!srcRegion) return { error: 'Source region not found' };
    const scarIdx = srcRegion.scars.findIndex(s => s.id === scarId && s.type === 'GRAFT');
    if (scarIdx === -1) return { error: 'GRAFT scar not found in source region' };

    if (!this._topo.regions[toRegion]) {
      this._topo.regions[toRegion] = { scars: [], totalDamage: 0, totalCallus: 0, totalGraft: 0, resilience: 50, vulnerability: 50 };
    }

    const scar = srcRegion.scars.splice(scarIdx, 1)[0];
    // Transplant penalty: severity reduces slightly
    scar.severity = Math.max(1, Math.round(scar.severity * 0.8));
    scar.interactions.push({ from: fromRegion, effect: 'transplanted', timestamp: Date.now() });

    this._topo.regions[toRegion].scars.push(scar);
    this._recalcRegion(fromRegion);
    this._recalcRegion(toRegion);
    this._save();
    this._record({ type: 'transplant', scarId, from: fromRegion, to: toRegion });
    this.emit('scar-transplanted', { scarId, from: fromRegion, to: toRegion });

    return { transplanted: true, scarId, from: fromRegion, to: toRegion, newSeverity: scar.severity };
  }

  /** Full scar topology. */
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

  /** Detailed view of a specific region. */
  getRegion(name) {
    const region = this._topo.regions[name];
    if (!region) return { error: 'Unknown region' };
    return {
      name,
      scars: region.scars.map(s => ({
        ...s,
        ageLabel: s.age < 5 ? 'fresh' : s.age < 15 ? 'healing' : s.age < 30 ? 'mature' : 'ancient',
      })),
      totalDamage: region.totalDamage,
      totalCallus: region.totalCallus,
      totalGraft: region.totalGraft,
      resilience: region.resilience,
      vulnerability: region.vulnerability,
      adjacentRegions: ADJACENCY[name] || [],
      terrainEffect: this._getTerrainEffect(name),
    };
  }

  /** How scarring affects processing in a region. */
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

  /** Region vulnerability scoring — composite risk assessment. */
  getVulnerabilityScores() {
    const scores = {};
    for (const [name, region] of Object.entries(this._topo.regions)) {
      const recentDamage = region.scars.filter(s => s.type === 'DAMAGE' && s.age < 10).length;
      const patterns = this._patterns.detected.filter(p => p.region === name && !p.resolved);
      const adjacent = ADJACENCY[name] || [];
      const adjacentDamage = adjacent.reduce((sum, adj) => {
        const adjR = this._topo.regions[adj];
        return sum + (adjR ? adjR.totalDamage : 0);
      }, 0);

      scores[name] = {
        baseVulnerability: region.vulnerability,
        recentDamageCount: recentDamage,
        activePatterns: patterns.length,
        adjacentDamageSpillover: Math.round(adjacentDamage * 0.1),
        compositeRisk: Math.min(100, Math.round(
          region.vulnerability + recentDamage * 3 + patterns.length * 5 + adjacentDamage * 0.05
        )),
      };
    }
    return scores;
  }

  /** Detected scar patterns (recurring injuries). */
  getPatterns() {
    return {
      active: this._patterns.detected.filter(p => !p.resolved),
      resolved: this._patterns.detected.filter(p => p.resolved).slice(-20),
      total: this._patterns.detected.length,
    };
  }

  /** Weakest points. */
  getVulnerabilities() {
    return Object.entries(this._topo.regions)
      .map(([name, r]) => ({ region: name, vulnerability: r.vulnerability, damage: r.totalDamage, scarCount: r.scars.length }))
      .sort((a, b) => b.vulnerability - a.vulnerability)
      .slice(0, 6);
  }

  /** Strongest points. */
  getResilience() {
    return Object.entries(this._topo.regions)
      .map(([name, r]) => ({ region: name, resilience: r.resilience, callus: r.totalCallus, graft: r.totalGraft }))
      .sort((a, b) => b.resilience - a.resilience)
      .slice(0, 6);
  }

  /** Topological map visualization data. */
  getVisualizationData() {
    const nodes = [];
    const edges = [];
    for (const [name, region] of Object.entries(this._topo.regions)) {
      nodes.push({
        id: name,
        scarCount: region.scars.length,
        resilience: region.resilience,
        vulnerability: region.vulnerability,
        terrain: this._getTerrainEffect(name),
        color: region.resilience > 70 ? '#4CAF50' : region.resilience > 40 ? '#FFC107' : '#F44336',
      });
      for (const adj of (ADJACENCY[name] || [])) {
        if (name < adj) {
          edges.push({ source: name, target: adj, weight: 1 });
        }
      }
    }
    return { nodes, edges, totalScars: nodes.reduce((s, n) => s + n.scarCount, 0) };
  }

  /**
   * Evolve topology: damage→callus, calcification, scar fade, interaction update.
   */
  evolve() {
    const changes = [];

    for (const [name, region] of Object.entries(this._topo.regions)) {
      for (const scar of region.scars) {
        scar.age++;

        // Damage→callus (learned from it)
        if (scar.type === 'DAMAGE' && scar.age > 10 && !scar.calcified && Math.random() < 0.15) {
          scar.type = 'CALLUS';
          scar.severity = Math.round(scar.severity * 0.7);
          changes.push({ action: 'damage_to_callus', region: name, scarId: scar.id });
          this.emit('scar-evolved', { scarId: scar.id, from: 'DAMAGE', to: 'CALLUS', region: name });
        }

        // Calcification
        if (scar.age > 30 && !scar.calcified) {
          scar.calcified = true;
          scar.severity = Math.round(scar.severity * 0.6);
          changes.push({ action: 'calcified', region: name, scarId: scar.id, type: scar.type });
        }

        // Very old weak scars fade
        if (scar.age > 50 && scar.severity < 5) {
          scar.severity = 0;
          changes.push({ action: 'faded', region: name, scarId: scar.id });
        }
      }

      region.scars = region.scars.filter(s => s.severity > 0);
      this._recalcRegion(name);
    }

    // Resolve old patterns
    for (const pattern of this._patterns.detected) {
      if (!pattern.resolved && Date.now() - pattern.lastSeen > 14 * 24 * 60 * 60 * 1000) {
        pattern.resolved = true;
        changes.push({ action: 'pattern_resolved', id: pattern.id });
      }
    }
    this._savePatterns();

    this._topo.evolutionCount++;
    this._topo.lastEvolved = Date.now();
    this._save();

    if (changes.length > 0) this._record({ type: 'evolve', changes: changes.length });
    return { changes, evolutionCount: this._topo.evolutionCount };
  }

  /** Periodic tick — runs evolution. */
  tick() { return this.evolve(); }

  /** Cross-scar analysis. */
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
      activePatterns: this._patterns.detected.filter(p => !p.resolved).length,
    };
  }

  /** Get event history. */
  getHistory(limit) { return { events: this._history.events.slice(-(limit || 50)) }; }
}

module.exports = CognitiveScarTopology;
