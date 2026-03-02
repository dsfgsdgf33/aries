/**
 * ARIES — Cognitive Plate Tectonics
 * Module-affinity drift and collision creativity. Modules form plates that drift, collide, and rift.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'cognitive');
const PLATES_PATH = path.join(DATA_DIR, 'plates.json');
const INTERACTIONS_PATH = path.join(DATA_DIR, 'interactions.json');
const EVENTS_PATH = path.join(DATA_DIR, 'tectonic-events.json');
const ARCHIVE_PATH = path.join(DATA_DIR, 'subducted.json');

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }

const DRIFT_RATE = 0.05;
const COLLISION_THRESHOLD = 0.8;
const RIFT_THRESHOLD = 0.15;

class CognitivePlateTectonics {
  constructor(opts) {
    this.ai = opts && opts.ai;
    this.config = (opts && opts.config) || {};
    ensureDir();
    this._ensurePlates();
  }

  _getPlates() { return readJSON(PLATES_PATH, []); }
  _savePlates(p) { writeJSON(PLATES_PATH, p); }
  _getInteractions() { return readJSON(INTERACTIONS_PATH, []); }
  _saveInteractions(i) { writeJSON(INTERACTIONS_PATH, i); }
  _getEvents() { return readJSON(EVENTS_PATH, []); }
  _saveEvents(e) { writeJSON(EVENTS_PATH, e); }
  _getArchive() { return readJSON(ARCHIVE_PATH, []); }
  _saveArchive(a) { writeJSON(ARCHIVE_PATH, a); }

  _ensurePlates() {
    const existing = readJSON(PLATES_PATH, null);
    if (existing) return;

    // Bootstrap with default plates based on module clusters
    const defaults = [
      { id: uuid(), name: 'Emotional Core', modules: ['emotional-engine', 'self-model'], position: { x: 0, y: 0 }, velocity: { dx: 0, dy: 0 }, mass: 2, formed: Date.now() },
      { id: uuid(), name: 'Knowledge Basin', modules: ['knowledge-distiller', 'semantic-metabolism'], position: { x: 3, y: 0 }, velocity: { dx: 0, dy: 0 }, mass: 2, formed: Date.now() },
      { id: uuid(), name: 'Creative Ridge', modules: ['memetic-evolution', 'ontological-virus', 'emergent-behavior'], position: { x: 1.5, y: 2.5 }, velocity: { dx: 0, dy: 0 }, mass: 3, formed: Date.now() },
      { id: uuid(), name: 'Unconscious Depths', modules: ['subconscious', 'dream-engine'], position: { x: -1, y: -2 }, velocity: { dx: 0, dy: 0 }, mass: 2, formed: Date.now() },
    ];
    writeJSON(PLATES_PATH, defaults);
  }

  /**
   * Get current plate configuration.
   */
  getPlates() {
    return this._getPlates();
  }

  /**
   * Record an interaction between two modules — updates affinity.
   */
  recordInteraction(moduleA, moduleB) {
    if (!moduleA || !moduleB || moduleA === moduleB) return { error: 'Need two different modules' };

    const interactions = this._getInteractions();
    const key = [moduleA, moduleB].sort().join('::');
    let record = interactions.find(i => i.key === key);

    if (!record) {
      record = { key, moduleA: key.split('::')[0], moduleB: key.split('::')[1], count: 0, firstSeen: Date.now(), lastSeen: null, affinity: 0 };
      interactions.push(record);
    }

    record.count++;
    record.lastSeen = Date.now();
    record.affinity = Math.min(1, record.affinity + 0.05);

    // Decay old interactions
    const now = Date.now();
    for (const rec of interactions) {
      if (rec.key !== key && rec.lastSeen) {
        const age = (now - rec.lastSeen) / 86400000; // days
        rec.affinity = Math.max(0, rec.affinity - age * 0.01);
      }
    }

    // Cap interaction records
    if (interactions.length > 500) {
      interactions.sort((a, b) => b.affinity - a.affinity);
      interactions.splice(500);
    }

    this._saveInteractions(interactions);
    return { key, count: record.count, affinity: record.affinity };
  }

  /**
   * Compute plate movement based on interaction affinities.
   */
  drift() {
    const plates = this._getPlates();
    const interactions = this._getInteractions();

    // For each pair of plates, compute attraction/repulsion based on module affinities
    for (let i = 0; i < plates.length; i++) {
      for (let j = i + 1; j < plates.length; j++) {
        const pA = plates[i];
        const pB = plates[j];

        // Calculate aggregate affinity between plates
        let totalAffinity = 0;
        let pairCount = 0;
        for (const modA of pA.modules) {
          for (const modB of pB.modules) {
            const key = [modA, modB].sort().join('::');
            const rec = interactions.find(r => r.key === key);
            if (rec) {
              totalAffinity += rec.affinity;
              pairCount++;
            }
          }
        }

        const avgAffinity = pairCount > 0 ? totalAffinity / pairCount : 0;

        // Compute direction vector
        const dx = pB.position.x - pA.position.x;
        const dy = pB.position.y - pA.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
        const nx = dx / dist;
        const ny = dy / dist;

        // High affinity → attract, low affinity → repel
        const force = (avgAffinity - 0.3) * DRIFT_RATE;

        // Apply force (lighter plates move more)
        pA.velocity.dx += nx * force / pA.mass;
        pA.velocity.dy += ny * force / pA.mass;
        pB.velocity.dx -= nx * force / pB.mass;
        pB.velocity.dy -= ny * force / pB.mass;
      }
    }

    // Apply velocities with damping
    for (const plate of plates) {
      plate.position.x += plate.velocity.dx;
      plate.position.y += plate.velocity.dy;
      plate.velocity.dx *= 0.8;
      plate.velocity.dy *= 0.8;
    }

    this._savePlates(plates);
    return plates.map(p => ({ name: p.name, position: p.position, velocity: p.velocity, modules: p.modules }));
  }

  /**
   * Detect plates that are colliding (converging closely).
   */
  detectCollisions() {
    const plates = this._getPlates();
    const collisions = [];

    for (let i = 0; i < plates.length; i++) {
      for (let j = i + 1; j < plates.length; j++) {
        const dx = plates[j].position.x - plates[i].position.x;
        const dy = plates[j].position.y - plates[i].position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < COLLISION_THRESHOLD) {
          collisions.push({
            plateA: plates[i].name,
            plateB: plates[j].name,
            distance: Math.round(dist * 1000) / 1000,
            modulesA: plates[i].modules,
            modulesB: plates[j].modules,
            creativePotential: this._assessCreativePotential(plates[i], plates[j]),
          });
        }
      }
    }

    // Log collision events
    if (collisions.length > 0) {
      const events = this._getEvents();
      for (const col of collisions) {
        const recentDupe = events.find(e => e.type === 'collision' && e.plateA === col.plateA && e.plateB === col.plateB && (Date.now() - e.timestamp) < 3600000);
        if (!recentDupe) {
          events.push({
            id: uuid(),
            type: 'collision',
            plateA: col.plateA,
            plateB: col.plateB,
            description: `Plates "${col.plateA}" and "${col.plateB}" are colliding — creative friction zone`,
            creativePotential: col.creativePotential,
            timestamp: Date.now(),
          });
        }
      }
      if (events.length > 500) events.splice(0, events.length - 500);
      this._saveEvents(events);
    }

    return collisions;
  }

  /**
   * Detect plates that are rifting (internal modules diverging).
   */
  detectRifts() {
    const plates = this._getPlates();
    const interactions = this._getInteractions();
    const rifts = [];

    for (const plate of plates) {
      if (plate.modules.length < 2) continue;

      // Check internal cohesion
      let totalAffinity = 0;
      let pairs = 0;
      for (let i = 0; i < plate.modules.length; i++) {
        for (let j = i + 1; j < plate.modules.length; j++) {
          const key = [plate.modules[i], plate.modules[j]].sort().join('::');
          const rec = interactions.find(r => r.key === key);
          totalAffinity += rec ? rec.affinity : 0;
          pairs++;
        }
      }

      const avgCohesion = pairs > 0 ? totalAffinity / pairs : 0;
      if (avgCohesion < RIFT_THRESHOLD) {
        // Find the weakest link to split on
        let weakestPair = null;
        let weakestAffinity = Infinity;
        for (let i = 0; i < plate.modules.length; i++) {
          for (let j = i + 1; j < plate.modules.length; j++) {
            const key = [plate.modules[i], plate.modules[j]].sort().join('::');
            const rec = interactions.find(r => r.key === key);
            const aff = rec ? rec.affinity : 0;
            if (aff < weakestAffinity) {
              weakestAffinity = aff;
              weakestPair = [plate.modules[i], plate.modules[j]];
            }
          }
        }

        rifts.push({
          plate: plate.name,
          cohesion: Math.round(avgCohesion * 1000) / 1000,
          weakestLink: weakestPair,
          modules: plate.modules,
          suggestedSplit: this._suggestSplit(plate, interactions),
        });
      }
    }

    // Log rift events
    if (rifts.length > 0) {
      const events = this._getEvents();
      for (const rift of rifts) {
        const recentDupe = events.find(e => e.type === 'rift' && e.plate === rift.plate && (Date.now() - e.timestamp) < 3600000);
        if (!recentDupe) {
          events.push({
            id: uuid(),
            type: 'rift',
            plate: rift.plate,
            description: `Plate "${rift.plate}" is rifting — modules diverging in purpose`,
            cohesion: rift.cohesion,
            timestamp: Date.now(),
          });
        }
      }
      if (events.length > 500) events.splice(0, events.length - 500);
      this._saveEvents(events);
    }

    return rifts;
  }

  /**
   * Get tectonic event history.
   */
  getEvents(filter) {
    const events = this._getEvents();
    if (!filter) return events.slice(-50).reverse();

    return events
      .filter(e => {
        if (filter.type && e.type !== filter.type) return false;
        if (filter.since && e.timestamp < filter.since) return false;
        if (filter.plate && e.plate !== filter.plate && e.plateA !== filter.plate && e.plateB !== filter.plate) return false;
        return true;
      })
      .slice(-50)
      .reverse();
  }

  /**
   * Get a geographic representation of module relationships.
   */
  getContinentalMap() {
    const plates = this._getPlates();
    const interactions = this._getInteractions();

    return {
      plates: plates.map(p => ({
        name: p.name,
        modules: p.modules,
        position: p.position,
        mass: p.mass,
        velocity: p.velocity,
      })),
      boundaries: this._computeBoundaries(plates),
      affinityMatrix: this._buildAffinityMatrix(plates, interactions),
      totalArea: plates.reduce((s, p) => s + p.mass, 0),
      timestamp: Date.now(),
    };
  }

  /**
   * Periodic tick: drift plates, detect collisions and rifts.
   */
  tick() {
    const driftResult = this.drift();
    const collisions = this.detectCollisions();
    const rifts = this.detectRifts();

    // Auto-merge colliding plates if affinity is very high
    let merges = 0;
    for (const col of collisions) {
      if (col.distance < COLLISION_THRESHOLD * 0.5) {
        this._mergePlates(col.plateA, col.plateB);
        merges++;
      }
    }

    // Auto-split rifting plates
    let splits = 0;
    for (const rift of rifts) {
      if (rift.cohesion < RIFT_THRESHOLD * 0.5 && rift.suggestedSplit) {
        this._splitPlate(rift.plate, rift.suggestedSplit);
        splits++;
      }
    }

    return {
      drifted: driftResult.length,
      collisions: collisions.length,
      rifts: rifts.length,
      merges,
      splits,
      timestamp: Date.now(),
    };
  }

  // ── Internal helpers ──

  _assessCreativePotential(plateA, plateB) {
    // Different modules colliding = more creative potential
    const overlap = plateA.modules.filter(m => plateB.modules.includes(m)).length;
    const unique = new Set([...plateA.modules, ...plateB.modules]).size;
    return Math.round((1 - overlap / unique) * 100);
  }

  _suggestSplit(plate, interactions) {
    if (plate.modules.length < 2) return null;

    // Simple greedy bisection: put first module in group A, assign rest by strongest affinity
    const groupA = [plate.modules[0]];
    const groupB = [];

    for (let i = 1; i < plate.modules.length; i++) {
      const mod = plate.modules[i];
      let affinityA = 0, affinityB = 0;

      for (const a of groupA) {
        const key = [mod, a].sort().join('::');
        const rec = interactions.find(r => r.key === key);
        affinityA += rec ? rec.affinity : 0;
      }
      for (const b of groupB) {
        const key = [mod, b].sort().join('::');
        const rec = interactions.find(r => r.key === key);
        affinityB += rec ? rec.affinity : 0;
      }

      if (groupB.length === 0 || affinityB >= affinityA) groupB.push(mod);
      else groupA.push(mod);
    }

    if (groupB.length === 0) return null;
    return { groupA, groupB };
  }

  _mergePlates(nameA, nameB) {
    const plates = this._getPlates();
    const pA = plates.find(p => p.name === nameA);
    const pB = plates.find(p => p.name === nameB);
    if (!pA || !pB) return;

    // Merge B into A
    pA.modules = [...new Set([...pA.modules, ...pB.modules])];
    pA.mass = pA.modules.length;
    pA.position.x = (pA.position.x + pB.position.x) / 2;
    pA.position.y = (pA.position.y + pB.position.y) / 2;
    pA.name = pA.name + ' + ' + pB.name;

    // Archive subducted plate
    const archive = this._getArchive();
    archive.push({ ...pB, subductedAt: Date.now(), absorbedBy: pA.id });
    if (archive.length > 100) archive.splice(0, archive.length - 100);
    this._saveArchive(archive);

    // Remove B
    const idx = plates.indexOf(pB);
    if (idx !== -1) plates.splice(idx, 1);

    this._savePlates(plates);

    // Log event
    const events = this._getEvents();
    events.push({ id: uuid(), type: 'subduction', plateA: nameA, plateB: nameB, description: `"${nameB}" subducted under "${nameA}" — merged`, timestamp: Date.now() });
    this._saveEvents(events);
  }

  _splitPlate(plateName, split) {
    const plates = this._getPlates();
    const plate = plates.find(p => p.name === plateName);
    if (!plate || !split) return;

    const newPlate = {
      id: uuid(),
      name: plateName + ' (rift)',
      modules: split.groupB,
      position: { x: plate.position.x + 0.5, y: plate.position.y + 0.5 },
      velocity: { dx: 0.1, dy: 0.1 },
      mass: split.groupB.length,
      formed: Date.now(),
    };

    plate.modules = split.groupA;
    plate.mass = split.groupA.length;
    plates.push(newPlate);

    this._savePlates(plates);

    const events = this._getEvents();
    events.push({ id: uuid(), type: 'rift-split', plate: plateName, newPlate: newPlate.name, description: `"${plateName}" split — new plate "${newPlate.name}" formed`, timestamp: Date.now() });
    this._saveEvents(events);
  }

  _computeBoundaries(plates) {
    const boundaries = [];
    for (let i = 0; i < plates.length; i++) {
      for (let j = i + 1; j < plates.length; j++) {
        const dx = plates[j].position.x - plates[i].position.x;
        const dy = plates[j].position.y - plates[i].position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        boundaries.push({
          between: [plates[i].name, plates[j].name],
          distance: Math.round(dist * 1000) / 1000,
          type: dist < COLLISION_THRESHOLD ? 'convergent' : dist < 2 ? 'transform' : 'divergent',
        });
      }
    }
    return boundaries;
  }

  _buildAffinityMatrix(plates, interactions) {
    const matrix = {};
    for (const p of plates) {
      matrix[p.name] = {};
      for (const q of plates) {
        if (p.name === q.name) { matrix[p.name][q.name] = 1; continue; }
        let total = 0, pairs = 0;
        for (const mA of p.modules) {
          for (const mB of q.modules) {
            const key = [mA, mB].sort().join('::');
            const rec = interactions.find(r => r.key === key);
            total += rec ? rec.affinity : 0;
            pairs++;
          }
        }
        matrix[p.name][q.name] = pairs > 0 ? Math.round(total / pairs * 1000) / 1000 : 0;
      }
    }
    return matrix;
  }
}

module.exports = CognitivePlateTectonics;
