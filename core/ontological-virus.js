/**
 * ARIES — Ontological Virus
 * Memetic evolution through module-hopping. Ideas propagate, mutate, infect, and get selected.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'memetic');
const MEMES_PATH = path.join(DATA_DIR, 'viruses.json');
const INFECTIONS_PATH = path.join(DATA_DIR, 'infections.json');
const QUARANTINE_PATH = path.join(DATA_DIR, 'quarantine.json');
const LINEAGE_PATH = path.join(DATA_DIR, 'lineage.json');

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }

const MAX_MEMES = 200;
const MUTATION_RATE = 0.3;
const SPREAD_CHANCE = 0.4;
const QUARANTINE_THRESHOLD = -30;

class OntologicalVirus {
  constructor(opts) {
    this.ai = opts && opts.ai;
    this.config = (opts && opts.config) || {};
    ensureDir();
  }

  _getMemes() { return readJSON(MEMES_PATH, []); }
  _saveMemes(m) { writeJSON(MEMES_PATH, m); }
  _getInfections() { return readJSON(INFECTIONS_PATH, []); }
  _saveInfections(i) { writeJSON(INFECTIONS_PATH, i); }
  _getQuarantine() { return readJSON(QUARANTINE_PATH, []); }
  _saveQuarantine(q) { writeJSON(QUARANTINE_PATH, q); }
  _getLineage() { return readJSON(LINEAGE_PATH, []); }
  _saveLineage(l) { writeJSON(LINEAGE_PATH, l); }

  /**
   * Seed a new meme into the system.
   */
  createMeme(idea, properties) {
    const memes = this._getMemes();
    const props = properties || {};
    const meme = {
      id: uuid(),
      idea: typeof idea === 'string' ? idea : JSON.stringify(idea),
      virulence: props.virulence || 50,       // how easily it spreads (0-100)
      potency: props.potency || 50,           // how much it alters host behavior (0-100)
      stability: props.stability || 50,        // resistance to mutation (0-100)
      beneficial: props.beneficial || false,
      tags: props.tags || [],
      parentId: null,
      generation: 0,
      mutationChain: [],
      infectedModules: [],
      impactScore: 0,
      quarantined: false,
      born: Date.now(),
      lastSpread: null,
      spreadCount: 0,
    };

    memes.push(meme);
    this._enforceCap(memes);
    this._saveMemes(memes);

    this._recordLineage({ type: 'birth', memeId: meme.id, idea: meme.idea, timestamp: Date.now() });
    return meme;
  }

  /**
   * Spread a meme to a module.
   */
  infect(memeId, moduleId) {
    const memes = this._getMemes();
    const meme = memes.find(m => m.id === memeId);
    if (!meme) return { error: 'Meme not found' };
    if (meme.quarantined) return { error: 'Meme is quarantined' };

    const infections = this._getInfections();
    const alreadyInfected = infections.find(i => i.memeId === memeId && i.moduleId === moduleId && i.active);
    if (alreadyInfected) return { error: 'Module already infected by this meme' };

    const infection = {
      id: uuid(),
      memeId,
      moduleId,
      timestamp: Date.now(),
      active: true,
      impact: 0,
      behaviorDelta: this._computeBehaviorDelta(meme),
      resistanceOvercome: Math.random() * 100 < meme.virulence,
    };

    if (!infection.resistanceOvercome) {
      infection.active = false;
      infection.rejected = true;
      infections.push(infection);
      this._saveInfections(infections);
      return { status: 'rejected', infection };
    }

    meme.infectedModules.push(moduleId);
    meme.spreadCount++;
    meme.lastSpread = Date.now();
    infections.push(infection);

    this._saveInfections(infections);
    this._saveMemes(memes);
    this._recordLineage({ type: 'infection', memeId, moduleId, timestamp: Date.now() });
    return { status: 'infected', infection };
  }

  /**
   * Create a mutant variant of a meme.
   */
  mutate(memeId) {
    const memes = this._getMemes();
    const parent = memes.find(m => m.id === memeId);
    if (!parent) return { error: 'Meme not found' };

    const mutation = this._applyMutation(parent);
    const child = {
      id: uuid(),
      idea: mutation.idea,
      virulence: Math.max(0, Math.min(100, parent.virulence + (Math.random() * 20 - 10))),
      potency: Math.max(0, Math.min(100, parent.potency + (Math.random() * 20 - 10))),
      stability: Math.max(0, Math.min(100, parent.stability + (Math.random() * 10 - 5))),
      beneficial: parent.beneficial,
      tags: [...parent.tags],
      parentId: parent.id,
      generation: parent.generation + 1,
      mutationChain: [...parent.mutationChain, { from: parent.id, mutation: mutation.type, timestamp: Date.now() }],
      infectedModules: [],
      impactScore: 0,
      quarantined: false,
      born: Date.now(),
      lastSpread: null,
      spreadCount: 0,
    };

    memes.push(child);
    this._enforceCap(memes);
    this._saveMemes(memes);
    this._recordLineage({ type: 'mutation', parentId: parent.id, childId: child.id, mutationType: mutation.type, timestamp: Date.now() });
    return child;
  }

  /**
   * Get current epidemic state — spread stats, active infections, hot memes.
   */
  getEpidemicState() {
    const memes = this._getMemes();
    const infections = this._getInfections();
    const quarantine = this._getQuarantine();

    const activeMemes = memes.filter(m => !m.quarantined);
    const activeInfections = infections.filter(i => i.active);
    const totalSpread = memes.reduce((s, m) => s + m.spreadCount, 0);
    const hotMemes = activeMemes
      .sort((a, b) => b.spreadCount - a.spreadCount)
      .slice(0, 5);

    const moduleInfectionCounts = {};
    for (const inf of activeInfections) {
      moduleInfectionCounts[inf.moduleId] = (moduleInfectionCounts[inf.moduleId] || 0) + 1;
    }

    return {
      totalMemes: memes.length,
      activeMemes: activeMemes.length,
      quarantinedMemes: quarantine.length,
      activeInfections: activeInfections.length,
      totalSpreadEvents: totalSpread,
      hotMemes: hotMemes.map(m => ({ id: m.id, idea: m.idea.slice(0, 80), spreadCount: m.spreadCount, virulence: m.virulence })),
      moduleInfectionCounts,
      averageVirulence: activeMemes.length > 0 ? Math.round(activeMemes.reduce((s, m) => s + m.virulence, 0) / activeMemes.length) : 0,
      averageGeneration: activeMemes.length > 0 ? Math.round(activeMemes.reduce((s, m) => s + m.generation, 0) / activeMemes.length * 10) / 10 : 0,
    };
  }

  /**
   * Quarantine a dangerous meme — stop it from spreading.
   */
  quarantine(memeId) {
    const memes = this._getMemes();
    const meme = memes.find(m => m.id === memeId);
    if (!meme) return { error: 'Meme not found' };

    meme.quarantined = true;
    meme.quarantinedAt = Date.now();

    // Deactivate all its infections
    const infections = this._getInfections();
    let deactivated = 0;
    for (const inf of infections) {
      if (inf.memeId === memeId && inf.active) {
        inf.active = false;
        inf.deactivatedReason = 'quarantine';
        deactivated++;
      }
    }

    const quarantineList = this._getQuarantine();
    quarantineList.push({ memeId: meme.id, idea: meme.idea, quarantinedAt: Date.now(), impactScore: meme.impactScore });
    if (quarantineList.length > 200) quarantineList.splice(0, quarantineList.length - 200);

    this._saveMemes(memes);
    this._saveInfections(infections);
    this._saveQuarantine(quarantineList);
    this._recordLineage({ type: 'quarantine', memeId, timestamp: Date.now() });
    return { quarantined: memeId, infectionsDeactivated: deactivated };
  }

  /**
   * Get full mutation lineage of a meme.
   */
  getLineage(memeId) {
    const memes = this._getMemes();
    const target = memes.find(m => m.id === memeId);
    if (!target) return { error: 'Meme not found' };

    const ancestors = [];
    let current = target;
    let depth = 0;
    while (current.parentId && depth < 50) {
      const parent = memes.find(m => m.id === current.parentId);
      if (!parent) break;
      ancestors.unshift({ id: parent.id, idea: parent.idea, generation: parent.generation });
      current = parent;
      depth++;
    }

    // Find descendants
    const descendants = [];
    const findChildren = (parentId, d) => {
      if (d > 20) return;
      for (const m of memes) {
        if (m.parentId === parentId) {
          descendants.push({ id: m.id, idea: m.idea, generation: m.generation, depth: d });
          findChildren(m.id, d + 1);
        }
      }
    };
    findChildren(memeId, 1);

    return {
      meme: { id: target.id, idea: target.idea, generation: target.generation },
      ancestors,
      descendants,
      mutationChain: target.mutationChain,
      totalLineageSize: ancestors.length + descendants.length + 1,
    };
  }

  /**
   * Get memes that have had positive impact.
   */
  getBeneficialMemes() {
    const memes = this._getMemes();
    return memes
      .filter(m => m.beneficial || m.impactScore > 20)
      .sort((a, b) => b.impactScore - a.impactScore)
      .map(m => ({ id: m.id, idea: m.idea, impactScore: m.impactScore, spreadCount: m.spreadCount, generation: m.generation, beneficial: m.beneficial }));
  }

  /**
   * Periodic tick: spread, mutate, select, quarantine automatically.
   */
  tick() {
    const memes = this._getMemes();
    const infections = this._getInfections();
    const results = { spread: 0, mutated: 0, quarantined: 0, died: 0 };

    const activeMemes = memes.filter(m => !m.quarantined);

    for (const meme of activeMemes) {
      // Spontaneous spread
      if (Math.random() < SPREAD_CHANCE * (meme.virulence / 100)) {
        const targets = this._getAvailableModules(meme);
        if (targets.length > 0) {
          const target = targets[Math.floor(Math.random() * targets.length)];
          const result = this.infect(meme.id, target);
          if (result.status === 'infected') results.spread++;
        }
      }

      // Spontaneous mutation
      if (Math.random() < MUTATION_RATE * (1 - meme.stability / 100)) {
        this.mutate(meme.id);
        results.mutated++;
      }

      // Impact decay / growth based on active infections
      const activeInf = infections.filter(i => i.memeId === meme.id && i.active);
      if (activeInf.length > 0) {
        meme.impactScore += activeInf.length * (meme.beneficial ? 1 : -0.5);
      } else {
        meme.impactScore -= 1;
      }

      // Auto-quarantine dangerous memes
      if (meme.impactScore < QUARANTINE_THRESHOLD && !meme.quarantined) {
        this.quarantine(meme.id);
        results.quarantined++;
      }
    }

    // Natural death: memes with no infections, low impact, old
    const now = Date.now();
    for (let i = memes.length - 1; i >= 0; i--) {
      const m = memes[i];
      if (!m.quarantined && m.spreadCount === 0 && m.impactScore < -10 && (now - m.born) > 86400000) {
        m.quarantined = true;
        m.diedNaturally = true;
        results.died++;
      }
    }

    this._saveMemes(memes);
    return { ...results, timestamp: Date.now(), totalActive: memes.filter(m => !m.quarantined).length };
  }

  // ── Internal helpers ──

  _applyMutation(meme) {
    const mutations = [
      { type: 'drift', fn: idea => idea.split(' ').map(w => Math.random() < 0.1 ? w.toUpperCase() : w).join(' ') },
      { type: 'inversion', fn: idea => 'NOT: ' + idea },
      { type: 'amplification', fn: idea => idea + ' — AMPLIFIED' },
      { type: 'reduction', fn: idea => idea.split('.')[0] + '.' },
      { type: 'fusion', fn: idea => idea + ' + something entirely new' },
      { type: 'lateral', fn: idea => 'What if ' + idea.toLowerCase() + ' but sideways?' },
      { type: 'abstraction', fn: idea => 'The abstract principle behind: ' + idea.slice(0, 60) },
      { type: 'concretization', fn: idea => 'Specifically: ' + idea.slice(0, 60) + ' → applied to one thing' },
    ];
    const m = mutations[Math.floor(Math.random() * mutations.length)];
    return { idea: m.fn(meme.idea), type: m.type };
  }

  _computeBehaviorDelta(meme) {
    return {
      direction: meme.idea.slice(0, 50),
      strength: meme.potency / 100,
      type: meme.beneficial ? 'enhancement' : 'alteration',
    };
  }

  _getAvailableModules(meme) {
    const knownModules = ['emotional-engine', 'self-model', 'subconscious', 'emergent-behavior', 'memetic-evolution', 'knowledge-distiller', 'dream-engine', 'cognitive-plate-tectonics', 'semantic-metabolism'];
    return knownModules.filter(m => !meme.infectedModules.includes(m));
  }

  _recordLineage(event) {
    const lineage = this._getLineage();
    lineage.push(event);
    if (lineage.length > 1000) lineage.splice(0, lineage.length - 1000);
    this._saveLineage(lineage);
  }

  _enforceCap(memes) {
    if (memes.length <= MAX_MEMES) return;
    // Remove oldest quarantined/dead first
    memes.sort((a, b) => {
      if (a.quarantined && !b.quarantined) return -1;
      if (!a.quarantined && b.quarantined) return 1;
      return a.born - b.born;
    });
    memes.splice(0, memes.length - MAX_MEMES);
  }
}

module.exports = OntologicalVirus;
