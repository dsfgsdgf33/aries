/**
 * ARIES — Information Entanglement
 * Bidirectional semantic coupling between concepts.
 * When two concepts become entangled, changes to one ripple to the other.
 */

'use strict';

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'knowledge');
const ENTANGLEMENTS_PATH = path.join(DATA_DIR, 'entanglements.json');
const OCCURRENCES_PATH = path.join(DATA_DIR, 'co-occurrences.json');
const PINGS_PATH = path.join(DATA_DIR, 'entanglement-pings.json');

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }

function pairKey(a, b) { return [a, b].sort().join('⇌'); }

class InformationEntanglement extends EventEmitter {
  /**
   * @param {object} opts
   * @param {object} opts.ai - AI core module
   * @param {object} opts.config - entanglement config section
   */
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null;
    this.config = opts.config || {};
    this.entanglementThreshold = this.config.entanglementThreshold || 5; // co-occurrences to auto-entangle
    this.decayRate = this.config.decayRate || 0.02;
    ensureDir();
  }

  _getEntanglements() { return readJSON(ENTANGLEMENTS_PATH, {}); }
  _saveEntanglements(d) { writeJSON(ENTANGLEMENTS_PATH, d); }
  _getOccurrences() { return readJSON(OCCURRENCES_PATH, {}); }
  _saveOccurrences(d) { writeJSON(OCCURRENCES_PATH, d); }
  _getPings() { return readJSON(PINGS_PATH, []); }
  _savePings(d) { writeJSON(PINGS_PATH, d); }

  /**
   * Create or strengthen entanglement between two concepts
   * @param {string} conceptA
   * @param {string} conceptB
   * @param {number} [strength=0.5] - coupling strength 0-1
   * @returns {object}
   */
  entangle(conceptA, conceptB, strength = 0.5) {
    if (conceptA === conceptB) return { error: 'cannot_self_entangle' };

    const ent = this._getEntanglements();
    const key = pairKey(conceptA, conceptB);

    if (ent[key]) {
      ent[key].strength = Math.max(0, Math.min(1, Math.max(ent[key].strength, strength)));
      ent[key].reinforcements++;
      ent[key].lastReinforced = Date.now();
    } else {
      ent[key] = {
        id: uuid(),
        conceptA,
        conceptB,
        strength: Math.max(0, Math.min(1, strength)),
        reinforcements: 1,
        propagations: 0,
        createdAt: Date.now(),
        lastReinforced: Date.now(),
        lastPropagated: null,
      };
    }

    this._saveEntanglements(ent);
    this.emit('entangled', ent[key]);
    return ent[key];
  }

  /**
   * Break entanglement between two concepts
   * @param {string} conceptA
   * @param {string} conceptB
   * @returns {object}
   */
  disentangle(conceptA, conceptB) {
    const ent = this._getEntanglements();
    const key = pairKey(conceptA, conceptB);

    if (!ent[key]) return { error: 'not_entangled', conceptA, conceptB };

    const removed = ent[key];
    delete ent[key];
    this._saveEntanglements(ent);

    this.emit('disentangled', { conceptA, conceptB });
    return { removed, conceptA, conceptB };
  }

  /**
   * Propagate a change from one concept to its entangled partners
   * @param {string} concept - the changed concept
   * @param {object} change - { type, description, magnitude }
   * @returns {object} propagation results
   */
  propagate(concept, change = {}) {
    const ent = this._getEntanglements();
    const affected = [];

    for (const [key, pair] of Object.entries(ent)) {
      let partner = null;
      if (pair.conceptA === concept) partner = pair.conceptB;
      else if (pair.conceptB === concept) partner = pair.conceptA;
      if (!partner) continue;

      const impact = (change.magnitude || 0.5) * pair.strength;
      affected.push({
        concept: partner,
        strength: pair.strength,
        impact: Math.round(impact * 100) / 100,
        change: {
          type: change.type || 'update',
          description: change.description || `Propagated from ${concept}`,
          originalMagnitude: change.magnitude || 0.5,
          attenuatedMagnitude: impact,
        },
      });

      pair.propagations++;
      pair.lastPropagated = Date.now();
    }

    this._saveEntanglements(ent);

    // Sort by impact
    affected.sort((a, b) => b.impact - a.impact);

    this.emit('propagated', { source: concept, affected });
    return { source: concept, change, affected, totalAffected: affected.length };
  }

  /**
   * Record co-occurrence of concepts and detect natural entanglement
   * @param {string[]} concepts - concepts that appeared together
   */
  recordCoOccurrence(concepts) {
    if (!concepts || concepts.length < 2) return;

    const occ = this._getOccurrences();

    for (let i = 0; i < concepts.length; i++) {
      for (let j = i + 1; j < concepts.length; j++) {
        const key = pairKey(concepts[i], concepts[j]);
        if (!occ[key]) {
          occ[key] = { conceptA: concepts[i], conceptB: concepts[j], count: 0, firstSeen: Date.now(), lastSeen: null };
        }
        occ[key].count++;
        occ[key].lastSeen = Date.now();
      }
    }

    this._saveOccurrences(occ);
  }

  /**
   * Detect naturally forming entanglements from co-occurrence data
   * @returns {object[]} newly detected entanglements
   */
  detect() {
    const occ = this._getOccurrences();
    const ent = this._getEntanglements();
    const detected = [];

    for (const [key, pair] of Object.entries(occ)) {
      if (pair.count >= this.entanglementThreshold && !ent[key]) {
        // Auto-entangle with strength proportional to co-occurrence
        const strength = Math.min(0.8, 0.2 + (pair.count - this.entanglementThreshold) * 0.05);
        const result = this.entangle(pair.conceptA, pair.conceptB, strength);
        detected.push({
          conceptA: pair.conceptA,
          conceptB: pair.conceptB,
          coOccurrences: pair.count,
          strength,
          ...result,
        });
      }
    }

    if (detected.length > 0) this.emit('auto-detected', detected);
    return detected;
  }

  /**
   * Get the full entanglement network map
   * @returns {object}
   */
  getMap() {
    const ent = this._getEntanglements();
    const pairs = Object.values(ent);
    const concepts = new Set();

    for (const p of pairs) {
      concepts.add(p.conceptA);
      concepts.add(p.conceptB);
    }

    // Calculate per-concept stats
    const conceptStats = {};
    for (const c of concepts) {
      const connections = pairs.filter(p => p.conceptA === c || p.conceptB === c);
      const avgStrength = connections.length > 0
        ? Math.round(connections.reduce((s, p) => s + p.strength, 0) / connections.length * 100) / 100
        : 0;
      conceptStats[c] = {
        concept: c,
        connections: connections.length,
        avgStrength,
        partners: connections.map(p => p.conceptA === c ? p.conceptB : p.conceptA),
      };
    }

    return {
      concepts: [...concepts],
      pairs,
      conceptStats,
      totalConcepts: concepts.size,
      totalEntanglements: pairs.length,
      avgStrength: pairs.length > 0
        ? Math.round(pairs.reduce((s, p) => s + p.strength, 0) / pairs.length * 100) / 100
        : 0,
    };
  }

  /**
   * Access a concept, activating ("pinging") its entangled partners
   * Increases salience of entangled concepts — spooky action at a distance
   * @param {string} concept
   * @returns {object} activated partners
   */
  ping(concept) {
    const ent = this._getEntanglements();
    const activated = [];

    for (const pair of Object.values(ent)) {
      let partner = null;
      if (pair.conceptA === concept) partner = pair.conceptB;
      else if (pair.conceptB === concept) partner = pair.conceptA;
      if (!partner) continue;

      activated.push({
        concept: partner,
        strength: pair.strength,
        salience: Math.round(pair.strength * 100),
      });
    }

    // Record ping
    const pings = this._getPings();
    pings.push({
      concept,
      activated: activated.map(a => a.concept),
      timestamp: Date.now(),
    });
    if (pings.length > 500) pings.splice(0, pings.length - 500);
    this._savePings(pings);

    activated.sort((a, b) => b.strength - a.strength);

    this.emit('pinged', { concept, activated });
    return { concept, activated, totalActivated: activated.length };
  }

  /**
   * Periodic maintenance: detect new entanglements, decay weak ones
   * @returns {object} tick summary
   */
  tick() {
    const ent = this._getEntanglements();
    const decayed = [];
    const pruned = [];

    // Decay all entanglements slightly
    for (const [key, pair] of Object.entries(ent)) {
      const daysSinceReinforced = (Date.now() - (pair.lastReinforced || pair.createdAt)) / (24 * 60 * 60 * 1000);

      // Only decay if not recently reinforced
      if (daysSinceReinforced > 1) {
        pair.strength = Math.max(0, pair.strength - this.decayRate);
        if (pair.strength <= 0.01) {
          pruned.push({ conceptA: pair.conceptA, conceptB: pair.conceptB });
          delete ent[key];
        } else {
          decayed.push({ key, newStrength: Math.round(pair.strength * 100) / 100 });
        }
      }
    }

    this._saveEntanglements(ent);

    // Auto-detect new entanglements
    const detected = this.detect();

    return {
      decayed: decayed.length,
      pruned: pruned.length,
      detected: detected.length,
      totalEntanglements: Object.keys(ent).length,
    };
  }
}

let _instance = null;
function getInstance(opts) {
  if (!_instance) _instance = new InformationEntanglement(opts);
  return _instance;
}

module.exports = { InformationEntanglement, getInstance };
