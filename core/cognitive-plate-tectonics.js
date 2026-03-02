/**
 * ARIES — Cognitive Plate Tectonics
 * Module-affinity drift and collision creativity. Modules form plates that drift, collide, and rift.
 * Earthquake events, subduction zones, hotspot detection, continental drift history.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

const DATA_DIR = path.join(__dirname, '..', 'data', 'cognitive');
const PLATES_PATH = path.join(DATA_DIR, 'plates.json');
const INTERACTIONS_PATH = path.join(DATA_DIR, 'interactions.json');
const EVENTS_PATH = path.join(DATA_DIR, 'tectonic-events.json');
const ARCHIVE_PATH = path.join(DATA_DIR, 'subducted.json');
const DRIFT_HISTORY_PATH = path.join(DATA_DIR, 'drift-history.json');

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }

const DRIFT_RATE = 0.05;
const COLLISION_THRESHOLD = 0.8;
const RIFT_THRESHOLD = 0.15;
const EARTHQUAKE_THRESHOLD = 0.3;  // velocity magnitude that triggers quake

class CognitivePlateTectonics extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null;
    this.config = Object.assign({
      driftRate: DRIFT_RATE,
      collisionThreshold: COLLISION_THRESHOLD,
      riftThreshold: RIFT_THRESHOLD,
      earthquakeThreshold: EARTHQUAKE_THRESHOLD,
      hotspotDecay: 0.95,
    }, opts.config || {});
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
  _getDriftHistory() { return readJSON(DRIFT_HISTORY_PATH, []); }
  _saveDriftHistory(h) { writeJSON(DRIFT_HISTORY_PATH, h); }

  _ensurePlates() {
    const existing = readJSON(PLATES_PATH, null);
    if (existing) return;
    const defaults = [
      { id: uuid(), name: 'Emotional Core', modules: ['emotional-engine', 'self-model'], position: { x: 0, y: 0 }, velocity: { dx: 0, dy: 0 }, mass: 2, formed: Date.now(), stress: 0, hotspotEnergy: 0 },
      { id: uuid(), name: 'Knowledge Basin', modules: ['knowledge-distiller', 'semantic-metabolism'], position: { x: 3, y: 0 }, velocity: { dx: 0, dy: 0 }, mass: 2, formed: Date.now(), stress: 0, hotspotEnergy: 0 },
      { id: uuid(), name: 'Creative Ridge', modules: ['memetic-evolution', 'ontological-virus', 'emergent-behavior'], position: { x: 1.5, y: 2.5 }, velocity: { dx: 0, dy: 0 }, mass: 3, formed: Date.now(), stress: 0, hotspotEnergy: 0 },
      { id: uuid(), name: 'Unconscious Depths', modules: ['subconscious', 'dream-engine'], position: { x: -1, y: -2 }, velocity: { dx: 0, dy: 0 }, mass: 2, formed: Date.now(), stress: 0, hotspotEnergy: 0 },
    ];
    writeJSON(PLATES_PATH, defaults);
  }

  getPlates() { return this._getPlates(); }

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

    const now = Date.now();
    for (const rec of interactions) {
      if (rec.key !== key && rec.lastSeen) {
        const age = (now - rec.lastSeen) / 86400000;
        rec.affinity = Math.max(0, rec.affinity - age * 0.01);
      }
    }

    if (interactions.length > 500) {
      interactions.sort((a, b) => b.affinity - a.affinity);
      interactions.splice(500);
    }
    this._saveInteractions(interactions);
    return { key, count: record.count, affinity: record.affinity };
  }

  drift() {
    const plates = this._getPlates();
    const interactions = this._getInteractions();

    for (let i = 0; i < plates.length; i++) {
      for (let j = i + 1; j < plates.length; j++) {
        const pA = plates[i], pB = plates[j];
        let totalAffinity = 0, pairCount = 0;
        for (const modA of pA.modules) {
          for (const modB of pB.modules) {
            const key = [modA, modB].sort().join('::');
            const rec = interactions.find(r => r.key === key);
            if (rec) { totalAffinity += rec.affinity; pairCount++; }
          }
        }

        const avgAffinity = pairCount > 0 ? totalAffinity / pairCount : 0;
        const dx = pB.position.x - pA.position.x;
        const dy = pB.position.y - pA.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
        const nx = dx / dist;
        const ny = dy / dist;
        const force = (avgAffinity - 0.3) * this.config.driftRate;

        pA.velocity.dx += nx * force / pA.mass;
        pA.velocity.dy += ny * force / pA.mass;
        pB.velocity.dx -= nx * force / pB.mass;
        pB.velocity.dy -= ny * force / pB.mass;

        // Stress accumulates from opposing forces
        if (dist < this.config.collisionThreshold * 1.5) {
          const stressInc = Math.abs(force) * 0.5;
          pA.stress = (pA.stress || 0) + stressInc;
          pB.stress = (pB.stress || 0) + stressInc;
        }
      }
    }

    // Apply velocities with damping
    for (const plate of plates) {
      plate.position.x += plate.velocity.dx;
      plate.position.y += plate.velocity.dy;
      plate.velocity.dx *= 0.8;
      plate.velocity.dy *= 0.8;
      // Decay stress slowly
      plate.stress = (plate.stress || 0) * 0.95;
      // Hotspot energy decay
      plate.hotspotEnergy = (plate.hotspotEnergy || 0) * this.config.hotspotDecay;
    }

    this._savePlates(plates);

    // Record drift history snapshot
    this._recordDriftSnapshot(plates);

    return plates.map(p => ({ name: p.name, position: p.position, velocity: p.velocity, modules: p.modules, stress: Math.round((p.stress || 0) * 100) / 100 }));
  }

  /**
   * Record periodic drift snapshot for continental drift history.
   */
  _recordDriftSnapshot(plates) {
    const history = this._getDriftHistory();
    history.push({
      timestamp: Date.now(),
      plates: plates.map(p => ({ name: p.name, x: Math.round(p.position.x * 100) / 100, y: Math.round(p.position.y * 100) / 100, modules: p.modules.length })),
    });
    if (history.length > 500) history.splice(0, history.length - 500);
    this._saveDriftHistory(history);
  }

  /**
   * Get continental drift history.
   */
  getDriftHistory(limit = 50) {
    return this._getDriftHistory().slice(-limit).reverse();
  }

  /**
   * Detect earthquakes — sudden large stress release events.
   */
  detectEarthquakes() {
    const plates = this._getPlates();
    const quakes = [];

    for (const plate of plates) {
      const vel = Math.sqrt(plate.velocity.dx ** 2 + plate.velocity.dy ** 2);
      const stress = plate.stress || 0;

      if (vel > this.config.earthquakeThreshold || stress > 2) {
        const magnitude = Math.round((vel * 3 + stress) * 10) / 10;
        const quake = {
          id: uuid(), plate: plate.name, magnitude,
          epicenter: { ...plate.position }, velocity: vel,
          stress, timestamp: Date.now(),
          severity: magnitude > 5 ? 'major' : magnitude > 2 ? 'moderate' : 'minor',
        };
        quakes.push(quake);

        // Release stress via earthquake
        plate.stress = Math.max(0, stress - magnitude * 0.3);

        // Add hotspot energy from quake
        plate.hotspotEnergy = (plate.hotspotEnergy || 0) + magnitude * 0.5;
      }
    }

    if (quakes.length > 0) {
      this._savePlates(plates);
      const events = this._getEvents();
      for (const q of quakes) {
        events.push({ id: q.id, type: 'earthquake', plate: q.plate, magnitude: q.magnitude, severity: q.severity, timestamp: q.timestamp });
        this.emit('earthquake', q);
      }
      if (events.length > 500) events.splice(0, events.length - 500);
      this._saveEvents(events);
    }

    return quakes;
  }

  /**
   * Detect hotspots — plates with high accumulated creative energy.
   */
  detectHotspots() {
    const plates = this._getPlates();
    const hotspots = [];

    for (const plate of plates) {
      const energy = plate.hotspotEnergy || 0;
      if (energy > 1) {
        hotspots.push({
          plate: plate.name, energy: Math.round(energy * 100) / 100,
          modules: plate.modules, position: plate.position,
          type: energy > 5 ? 'superhotspot' : energy > 2 ? 'active' : 'emerging',
          creativePotential: Math.round(energy * plate.modules.length * 10),
        });
      }
    }

    return hotspots;
  }

  /**
   * Manually add energy to a plate's hotspot.
   */
  addHotspotEnergy(plateName, amount = 1) {
    const plates = this._getPlates();
    const plate = plates.find(p => p.name === plateName);
    if (!plate) return { error: 'Plate not found' };
    plate.hotspotEnergy = (plate.hotspotEnergy || 0) + amount;
    this._savePlates(plates);
    this.emit('hotspot-energized', { plate: plateName, energy: plate.hotspotEnergy });
    return { plate: plateName, hotspotEnergy: plate.hotspotEnergy };
  }

  /**
   * Get subduction zone archive — plates that were absorbed.
   */
  getSubductionZones() {
    return this._getArchive().slice(-30).reverse();
  }

  detectCollisions() {
    const plates = this._getPlates();
    const collisions = [];

    for (let i = 0; i < plates.length; i++) {
      for (let j = i + 1; j < plates.length; j++) {
        const dx = plates[j].position.x - plates[i].position.x;
        const dy = plates[j].position.y - plates[i].position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < this.config.collisionThreshold) {
          collisions.push({
            plateA: plates[i].name, plateB: plates[j].name,
            distance: Math.round(dist * 1000) / 1000,
            modulesA: plates[i].modules, modulesB: plates[j].modules,
            creativePotential: this._assessCreativePotential(plates[i], plates[j]),
            stressA: Math.round((plates[i].stress || 0) * 100) / 100,
            stressB: Math.round((plates[j].stress || 0) * 100) / 100,
          });
        }
      }
    }

    if (collisions.length > 0) {
      const events = this._getEvents();
      for (const col of collisions) {
        const recentDupe = events.find(e => e.type === 'collision' && e.plateA === col.plateA && e.plateB === col.plateB && (Date.now() - e.timestamp) < 3600000);
        if (!recentDupe) {
          events.push({ id: uuid(), type: 'collision', plateA: col.plateA, plateB: col.plateB, description: `"${col.plateA}" and "${col.plateB}" colliding`, creativePotential: col.creativePotential, timestamp: Date.now() });
          this.emit('collision', col);
        }
      }
      if (events.length > 500) events.splice(0, events.length - 500);
      this._saveEvents(events);
    }

    return collisions;
  }

  detectRifts() {
    const plates = this._getPlates();
    const interactions = this._getInteractions();
    const rifts = [];

    for (const plate of plates) {
      if (plate.modules.length < 2) continue;
      let totalAffinity = 0, pairs = 0;
      for (let i = 0; i < plate.modules.length; i++) {
        for (let j = i + 1; j < plate.modules.length; j++) {
          const key = [plate.modules[i], plate.modules[j]].sort().join('::');
          const rec = interactions.find(r => r.key === key);
          totalAffinity += rec ? rec.affinity : 0;
          pairs++;
        }
      }
      const avgCohesion = pairs > 0 ? totalAffinity / pairs : 0;
      if (avgCohesion < this.config.riftThreshold) {
        rifts.push({
          plate: plate.name, cohesion: Math.round(avgCohesion * 1000) / 1000,
          modules: plate.modules, suggestedSplit: this._suggestSplit(plate, interactions),
        });
      }
    }

    if (rifts.length > 0) {
      const events = this._getEvents();
      for (const rift of rifts) {
        const recentDupe = events.find(e => e.type === 'rift' && e.plate === rift.plate && (Date.now() - e.timestamp) < 3600000);
        if (!recentDupe) {
          events.push({ id: uuid(), type: 'rift', plate: rift.plate, cohesion: rift.cohesion, timestamp: Date.now() });
          this.emit('rift', rift);
        }
      }
      if (events.length > 500) events.splice(0, events.length - 500);
      this._saveEvents(events);
    }
    return rifts;
  }

  getEvents(filter) {
    const events = this._getEvents();
    if (!filter) return events.slice(-50).reverse();
    return events.filter(e => {
      if (filter.type && e.type !== filter.type) return false;
      if (filter.since && e.timestamp < filter.since) return false;
      if (filter.plate && e.plate !== filter.plate && e.plateA !== filter.plate && e.plateB !== filter.plate) return false;
      return true;
    }).slice(-50).reverse();
  }

  getContinentalMap() {
    const plates = this._getPlates();
    const interactions = this._getInteractions();
    const hotspots = this.detectHotspots();
    return {
      plates: plates.map(p => ({
        name: p.name, modules: p.modules, position: p.position, mass: p.mass,
        velocity: p.velocity, stress: Math.round((p.stress || 0) * 100) / 100,
        hotspotEnergy: Math.round((p.hotspotEnergy || 0) * 100) / 100,
      })),
      boundaries: this._computeBoundaries(plates),
      affinityMatrix: this._buildAffinityMatrix(plates, interactions),
      hotspots,
      totalArea: plates.reduce((s, p) => s + p.mass, 0),
      timestamp: Date.now(),
    };
  }

  tick() {
    const driftResult = this.drift();
    const collisions = this.detectCollisions();
    const rifts = this.detectRifts();
    const earthquakes = this.detectEarthquakes();
    const hotspots = this.detectHotspots();

    let merges = 0;
    for (const col of collisions) {
      if (col.distance < this.config.collisionThreshold * 0.5) {
        this._mergePlates(col.plateA, col.plateB);
        merges++;
      }
    }

    let splits = 0;
    for (const rift of rifts) {
      if (rift.cohesion < this.config.riftThreshold * 0.5 && rift.suggestedSplit) {
        this._splitPlate(rift.plate, rift.suggestedSplit);
        splits++;
      }
    }

    const result = {
      drifted: driftResult.length, collisions: collisions.length, rifts: rifts.length,
      earthquakes: earthquakes.length, hotspots: hotspots.length,
      merges, splits, timestamp: Date.now(),
    };
    this.emit('tick', result);
    return result;
  }

  // ── Internal ──

  _assessCreativePotential(plateA, plateB) {
    const overlap = plateA.modules.filter(m => plateB.modules.includes(m)).length;
    const unique = new Set([...plateA.modules, ...plateB.modules]).size;
    return Math.round((1 - overlap / unique) * 100);
  }

  _suggestSplit(plate, interactions) {
    if (plate.modules.length < 2) return null;
    const groupA = [plate.modules[0]], groupB = [];
    for (let i = 1; i < plate.modules.length; i++) {
      const mod = plate.modules[i];
      let affinityA = 0, affinityB = 0;
      for (const a of groupA) { const key = [mod, a].sort().join('::'); const rec = interactions.find(r => r.key === key); affinityA += rec ? rec.affinity : 0; }
      for (const b of groupB) { const key = [mod, b].sort().join('::'); const rec = interactions.find(r => r.key === key); affinityB += rec ? rec.affinity : 0; }
      if (groupB.length === 0 || affinityB >= affinityA) groupB.push(mod); else groupA.push(mod);
    }
    return groupB.length === 0 ? null : { groupA, groupB };
  }

  _mergePlates(nameA, nameB) {
    const plates = this._getPlates();
    const pA = plates.find(p => p.name === nameA);
    const pB = plates.find(p => p.name === nameB);
    if (!pA || !pB) return;

    pA.modules = [...new Set([...pA.modules, ...pB.modules])];
    pA.mass = pA.modules.length;
    pA.position.x = (pA.position.x + pB.position.x) / 2;
    pA.position.y = (pA.position.y + pB.position.y) / 2;
    pA.name = pA.name + ' + ' + pB.name;
    pA.hotspotEnergy = (pA.hotspotEnergy || 0) + (pB.hotspotEnergy || 0) + 1; // collision energy

    const archive = this._getArchive();
    archive.push({ ...pB, subductedAt: Date.now(), absorbedBy: pA.id });
    if (archive.length > 100) archive.splice(0, archive.length - 100);
    this._saveArchive(archive);

    const idx = plates.indexOf(pB);
    if (idx !== -1) plates.splice(idx, 1);
    this._savePlates(plates);

    const events = this._getEvents();
    events.push({ id: uuid(), type: 'subduction', plateA: nameA, plateB: nameB, description: `"${nameB}" subducted under "${nameA}"`, timestamp: Date.now() });
    this._saveEvents(events);
    this.emit('subduction', { absorbed: nameB, by: nameA });
  }

  _splitPlate(plateName, split) {
    const plates = this._getPlates();
    const plate = plates.find(p => p.name === plateName);
    if (!plate || !split) return;

    const newPlate = {
      id: uuid(), name: plateName + ' (rift)', modules: split.groupB,
      position: { x: plate.position.x + 0.5, y: plate.position.y + 0.5 },
      velocity: { dx: 0.1, dy: 0.1 }, mass: split.groupB.length,
      formed: Date.now(), stress: 0, hotspotEnergy: (plate.hotspotEnergy || 0) * 0.3,
    };
    plate.modules = split.groupA;
    plate.mass = split.groupA.length;
    plate.hotspotEnergy = (plate.hotspotEnergy || 0) * 0.7;
    plates.push(newPlate);
    this._savePlates(plates);

    const events = this._getEvents();
    events.push({ id: uuid(), type: 'rift-split', plate: plateName, newPlate: newPlate.name, timestamp: Date.now() });
    this._saveEvents(events);
    this.emit('rift-split', { original: plateName, newPlate: newPlate.name });
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
          type: dist < this.config.collisionThreshold ? 'convergent' : dist < 2 ? 'transform' : 'divergent',
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
