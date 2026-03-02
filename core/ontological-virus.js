/**
 * ARIES — Ontological Virus
 * Memetic evolution through module-hopping. Ideas propagate, mutate, infect, and get selected.
 * Fitness scoring, mutation rate control, genealogy trees, pandemic detection,
 * meme vaccination, beneficial amplification, extinction tracking.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

const DATA_DIR = path.join(__dirname, '..', 'data', 'memetic');
const MEMES_PATH = path.join(DATA_DIR, 'viruses.json');
const INFECTIONS_PATH = path.join(DATA_DIR, 'infections.json');
const QUARANTINE_PATH = path.join(DATA_DIR, 'quarantine.json');
const LINEAGE_PATH = path.join(DATA_DIR, 'lineage.json');
const VACCINATIONS_PATH = path.join(DATA_DIR, 'vaccinations.json');
const EXTINCTIONS_PATH = path.join(DATA_DIR, 'extinctions.json');

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }

const MAX_MEMES = 200;
const QUARANTINE_THRESHOLD = -30;

const KNOWN_MODULES = ['emotional-engine', 'self-model', 'subconscious', 'emergent-behavior', 'memetic-evolution', 'knowledge-distiller', 'dream-engine', 'cognitive-plate-tectonics', 'semantic-metabolism'];

class OntologicalVirus extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null;
    this.config = Object.assign({
      mutationRate: 0.3,
      spreadChance: 0.4,
      pandemicThreshold: 5,   // infections in >N modules = pandemic
      amplificationFactor: 2, // beneficial memes spread this much faster
    }, opts.config || {});
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
  _getVaccinations() { return readJSON(VACCINATIONS_PATH, []); }
  _saveVaccinations(v) { writeJSON(VACCINATIONS_PATH, v); }
  _getExtinctions() { return readJSON(EXTINCTIONS_PATH, []); }
  _saveExtinctions(e) { writeJSON(EXTINCTIONS_PATH, e); }

  /**
   * Seed a new meme.
   */
  createMeme(idea, properties = {}) {
    const memes = this._getMemes();
    const meme = {
      id: uuid(),
      idea: typeof idea === 'string' ? idea : JSON.stringify(idea),
      virulence: properties.virulence || 50,
      potency: properties.potency || 50,
      stability: properties.stability || 50,
      beneficial: properties.beneficial || false,
      tags: properties.tags || [],
      parentId: null,
      generation: 0,
      mutationChain: [],
      infectedModules: [],
      fitness: { score: 50, evaluations: 0, trend: 'unknown' },
      impactScore: 0,
      quarantined: false,
      extinct: false,
      born: Date.now(),
      lastSpread: null,
      spreadCount: 0,
    };

    memes.push(meme);
    this._enforceCap(memes);
    this._saveMemes(memes);
    this._recordLineage({ type: 'birth', memeId: meme.id, idea: meme.idea, timestamp: Date.now() });
    this.emit('meme-created', { id: meme.id, idea: meme.idea.slice(0, 80) });
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
    if (meme.extinct) return { error: 'Meme is extinct' };

    // Check vaccination
    const vaccinations = this._getVaccinations();
    const isVaccinated = vaccinations.some(v => v.moduleId === moduleId && v.memePattern && meme.idea.includes(v.memePattern) && v.active);
    if (isVaccinated) {
      return { status: 'vaccinated', message: `Module ${moduleId} is vaccinated against this meme pattern` };
    }

    const infections = this._getInfections();
    if (infections.find(i => i.memeId === memeId && i.moduleId === moduleId && i.active)) {
      return { error: 'Module already infected by this meme' };
    }

    const infection = {
      id: uuid(), memeId, moduleId, timestamp: Date.now(), active: true,
      impact: 0, behaviorDelta: this._computeBehaviorDelta(meme),
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
    this.emit('infection', { memeId, moduleId });

    // Pandemic detection
    if (meme.infectedModules.length >= this.config.pandemicThreshold) {
      this.emit('pandemic', { memeId, idea: meme.idea.slice(0, 80), infectedCount: meme.infectedModules.length });
    }

    return { status: 'infected', infection };
  }

  /**
   * Create a mutant variant.
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
      fitness: { score: parent.fitness.score, evaluations: 0, trend: 'unknown' },
      impactScore: 0,
      quarantined: false,
      extinct: false,
      born: Date.now(),
      lastSpread: null,
      spreadCount: 0,
    };

    memes.push(child);
    this._enforceCap(memes);
    this._saveMemes(memes);
    this._recordLineage({ type: 'mutation', parentId: parent.id, childId: child.id, mutationType: mutation.type, timestamp: Date.now() });
    this.emit('mutation', { parentId: parent.id, childId: child.id, type: mutation.type });
    return child;
  }

  /**
   * Evaluate fitness of a meme based on spread, impact, survival.
   */
  evaluateFitness(memeId) {
    const memes = this._getMemes();
    const meme = memes.find(m => m.id === memeId);
    if (!meme) return { error: 'Meme not found' };

    const age = (Date.now() - meme.born) / 86400000; // days
    const spreadRate = age > 0 ? meme.spreadCount / age : 0;
    const moduleReach = meme.infectedModules.length / KNOWN_MODULES.length;
    const impactNorm = Math.max(0, Math.min(100, 50 + meme.impactScore));
    const stabilityBonus = meme.stability / 100;
    const beneficialBonus = meme.beneficial ? 20 : 0;

    const score = Math.round(
      spreadRate * 15 +
      moduleReach * 25 +
      impactNorm * 0.3 +
      stabilityBonus * 10 +
      beneficialBonus
    );

    const prev = meme.fitness.score;
    meme.fitness.score = Math.max(0, Math.min(100, score));
    meme.fitness.evaluations++;
    meme.fitness.trend = score > prev + 3 ? 'rising' : score < prev - 3 ? 'falling' : 'stable';
    meme.fitness.lastEvaluated = Date.now();

    this._saveMemes(memes);
    return { memeId, fitness: meme.fitness, spreadRate: Math.round(spreadRate * 100) / 100, moduleReach: Math.round(moduleReach * 100) };
  }

  /**
   * Get/set mutation rate.
   */
  getMutationRate() { return this.config.mutationRate; }
  setMutationRate(rate) {
    this.config.mutationRate = Math.max(0, Math.min(1, rate));
    this.emit('mutation-rate-changed', { rate: this.config.mutationRate });
    return { mutationRate: this.config.mutationRate };
  }

  /**
   * Vaccinate a module against a meme pattern.
   */
  vaccinate(moduleId, memePattern, reason) {
    const vaccinations = this._getVaccinations();
    vaccinations.push({
      id: uuid(), moduleId, memePattern, reason: reason || 'preventive',
      active: true, vaccinatedAt: Date.now(),
    });
    if (vaccinations.length > 200) vaccinations.splice(0, vaccinations.length - 200);
    this._saveVaccinations(vaccinations);
    this.emit('vaccination', { moduleId, pattern: memePattern });
    return { status: 'vaccinated', moduleId, pattern: memePattern };
  }

  /**
   * Amplify beneficial memes — boost their virulence and spread chance.
   */
  amplifyBeneficial(memeId) {
    const memes = this._getMemes();
    const meme = memes.find(m => m.id === memeId);
    if (!meme) return { error: 'Meme not found' };
    if (!meme.beneficial) return { error: 'Only beneficial memes can be amplified' };

    const factor = this.config.amplificationFactor;
    meme.virulence = Math.min(100, meme.virulence * factor);
    meme.potency = Math.min(100, meme.potency * 1.5);
    meme.impactScore += 10;
    this._saveMemes(memes);

    this._recordLineage({ type: 'amplification', memeId, factor, timestamp: Date.now() });
    this.emit('amplification', { memeId, virulence: meme.virulence });
    return { amplified: true, meme: { id: meme.id, virulence: meme.virulence, potency: meme.potency } };
  }

  /**
   * Detect pandemic conditions.
   */
  detectPandemic() {
    const memes = this._getMemes();
    const pandemics = [];
    for (const meme of memes) {
      if (!meme.quarantined && !meme.extinct && meme.infectedModules.length >= this.config.pandemicThreshold) {
        pandemics.push({
          memeId: meme.id, idea: meme.idea.slice(0, 80),
          infectedModules: meme.infectedModules,
          coverage: Math.round(meme.infectedModules.length / KNOWN_MODULES.length * 100),
          virulence: meme.virulence, beneficial: meme.beneficial,
          severity: meme.beneficial ? 'positive' : meme.infectedModules.length >= 7 ? 'critical' : 'moderate',
        });
      }
    }
    return { pandemics, count: pandemics.length };
  }

  /**
   * Declare a meme extinct — remove from active population.
   */
  declareExtinct(memeId, reason) {
    const memes = this._getMemes();
    const meme = memes.find(m => m.id === memeId);
    if (!meme) return { error: 'Meme not found' };

    meme.extinct = true;
    meme.extinctAt = Date.now();
    meme.extinctReason = reason || 'natural';

    // Deactivate infections
    const infections = this._getInfections();
    let deactivated = 0;
    for (const inf of infections) {
      if (inf.memeId === memeId && inf.active) { inf.active = false; inf.deactivatedReason = 'extinction'; deactivated++; }
    }

    const extinctions = this._getExtinctions();
    extinctions.push({
      memeId, idea: meme.idea, generation: meme.generation, reason: reason || 'natural',
      peakSpread: meme.spreadCount, lifetime: Date.now() - meme.born, extinctAt: Date.now(),
    });
    if (extinctions.length > 200) extinctions.splice(0, extinctions.length - 200);

    this._saveMemes(memes);
    this._saveInfections(infections);
    this._saveExtinctions(extinctions);
    this._recordLineage({ type: 'extinction', memeId, reason, timestamp: Date.now() });
    this.emit('extinction', { memeId, reason });
    return { extinct: memeId, infectionsDeactivated: deactivated };
  }

  /**
   * Get extinction history.
   */
  getExtinctions(limit = 30) {
    return this._getExtinctions().slice(-limit).reverse();
  }

  /**
   * Get full genealogy tree for a meme.
   */
  getGenealogyTree(memeId) {
    const memes = this._getMemes();
    const target = memes.find(m => m.id === memeId);
    if (!target) return { error: 'Meme not found' };

    const ancestors = [];
    let current = target;
    let depth = 0;
    while (current.parentId && depth < 50) {
      const parent = memes.find(m => m.id === current.parentId);
      if (!parent) break;
      ancestors.unshift({ id: parent.id, idea: parent.idea.slice(0, 80), generation: parent.generation, fitness: parent.fitness.score });
      current = parent;
      depth++;
    }

    const descendants = [];
    const findChildren = (parentId, d) => {
      if (d > 20) return;
      for (const m of memes) {
        if (m.parentId === parentId) {
          descendants.push({ id: m.id, idea: m.idea.slice(0, 80), generation: m.generation, fitness: m.fitness.score, depth: d, extinct: m.extinct });
          findChildren(m.id, d + 1);
        }
      }
    };
    findChildren(memeId, 1);

    return {
      meme: { id: target.id, idea: target.idea, generation: target.generation, fitness: target.fitness },
      ancestors, descendants, mutationChain: target.mutationChain,
      totalLineageSize: ancestors.length + descendants.length + 1,
      extinctInLineage: descendants.filter(d => d.extinct).length,
    };
  }

  quarantine(memeId) {
    const memes = this._getMemes();
    const meme = memes.find(m => m.id === memeId);
    if (!meme) return { error: 'Meme not found' };

    meme.quarantined = true;
    meme.quarantinedAt = Date.now();

    const infections = this._getInfections();
    let deactivated = 0;
    for (const inf of infections) {
      if (inf.memeId === memeId && inf.active) { inf.active = false; inf.deactivatedReason = 'quarantine'; deactivated++; }
    }

    const quarantineList = this._getQuarantine();
    quarantineList.push({ memeId: meme.id, idea: meme.idea, quarantinedAt: Date.now(), impactScore: meme.impactScore });
    if (quarantineList.length > 200) quarantineList.splice(0, quarantineList.length - 200);

    this._saveMemes(memes);
    this._saveInfections(infections);
    this._saveQuarantine(quarantineList);
    this._recordLineage({ type: 'quarantine', memeId, timestamp: Date.now() });
    this.emit('quarantine', { memeId });
    return { quarantined: memeId, infectionsDeactivated: deactivated };
  }

  getEpidemicState() {
    const memes = this._getMemes();
    const infections = this._getInfections();
    const quarantine = this._getQuarantine();
    const extinctions = this._getExtinctions();

    const activeMemes = memes.filter(m => !m.quarantined && !m.extinct);
    const activeInfections = infections.filter(i => i.active);
    const hotMemes = activeMemes.sort((a, b) => b.spreadCount - a.spreadCount).slice(0, 5);
    const moduleInfectionCounts = {};
    for (const inf of activeInfections) moduleInfectionCounts[inf.moduleId] = (moduleInfectionCounts[inf.moduleId] || 0) + 1;

    const pandemics = this.detectPandemic();

    return {
      totalMemes: memes.length,
      activeMemes: activeMemes.length,
      quarantinedMemes: quarantine.length,
      extinctMemes: extinctions.length,
      activeInfections: activeInfections.length,
      totalSpreadEvents: memes.reduce((s, m) => s + m.spreadCount, 0),
      hotMemes: hotMemes.map(m => ({ id: m.id, idea: m.idea.slice(0, 80), spreadCount: m.spreadCount, virulence: m.virulence, fitness: m.fitness.score })),
      moduleInfectionCounts,
      pandemics: pandemics.count,
      avgFitness: activeMemes.length > 0 ? Math.round(activeMemes.reduce((s, m) => s + m.fitness.score, 0) / activeMemes.length) : 0,
      avgGeneration: activeMemes.length > 0 ? Math.round(activeMemes.reduce((s, m) => s + m.generation, 0) / activeMemes.length * 10) / 10 : 0,
      mutationRate: this.config.mutationRate,
    };
  }

  getBeneficialMemes() {
    return this._getMemes()
      .filter(m => m.beneficial || m.impactScore > 20)
      .sort((a, b) => b.fitness.score - a.fitness.score)
      .map(m => ({ id: m.id, idea: m.idea.slice(0, 80), fitness: m.fitness, spreadCount: m.spreadCount, generation: m.generation }));
  }

  tick() {
    const memes = this._getMemes();
    const infections = this._getInfections();
    const results = { spread: 0, mutated: 0, quarantined: 0, died: 0, amplified: 0, fitnessEvaluated: 0 };

    const activeMemes = memes.filter(m => !m.quarantined && !m.extinct);

    for (const meme of activeMemes) {
      const spreadChance = this.config.spreadChance * (meme.virulence / 100) * (meme.beneficial ? this.config.amplificationFactor : 1);
      if (Math.random() < spreadChance) {
        const targets = KNOWN_MODULES.filter(m => !meme.infectedModules.includes(m));
        if (targets.length > 0) {
          const target = targets[Math.floor(Math.random() * targets.length)];
          const result = this.infect(meme.id, target);
          if (result.status === 'infected') results.spread++;
        }
      }

      if (Math.random() < this.config.mutationRate * (1 - meme.stability / 100)) {
        this.mutate(meme.id);
        results.mutated++;
      }

      // Impact tracking
      const activeInf = infections.filter(i => i.memeId === meme.id && i.active);
      if (activeInf.length > 0) {
        meme.impactScore += activeInf.length * (meme.beneficial ? 1 : -0.5);
        if (meme.beneficial) results.amplified++;
      } else {
        meme.impactScore -= 1;
      }

      // Fitness evaluation (periodic)
      if (!meme.fitness.lastEvaluated || Date.now() - meme.fitness.lastEvaluated > 3600000) {
        this.evaluateFitness(meme.id);
        results.fitnessEvaluated++;
      }

      // Auto-quarantine
      if (meme.impactScore < QUARANTINE_THRESHOLD && !meme.quarantined) {
        this.quarantine(meme.id);
        results.quarantined++;
      }
    }

    // Natural death / extinction
    const now = Date.now();
    for (const m of memes) {
      if (!m.quarantined && !m.extinct && m.spreadCount === 0 && m.impactScore < -10 && (now - m.born) > 86400000) {
        this.declareExtinct(m.id, 'natural-death');
        results.died++;
      }
    }

    this._saveMemes(memes);
    this.emit('tick', results);
    return { ...results, timestamp: now, totalActive: memes.filter(m => !m.quarantined && !m.extinct).length };
  }

  // ── Internal ──

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
    return { direction: meme.idea.slice(0, 50), strength: meme.potency / 100, type: meme.beneficial ? 'enhancement' : 'alteration' };
  }

  _recordLineage(event) {
    const lineage = this._getLineage();
    lineage.push(event);
    if (lineage.length > 1000) lineage.splice(0, lineage.length - 1000);
    this._saveLineage(lineage);
  }

  _enforceCap(memes) {
    if (memes.length <= MAX_MEMES) return;
    memes.sort((a, b) => {
      if (a.extinct && !b.extinct) return -1;
      if (!a.extinct && b.extinct) return 1;
      if (a.quarantined && !b.quarantined) return -1;
      if (!a.quarantined && b.quarantined) return 1;
      return a.born - b.born;
    });
    memes.splice(0, memes.length - MAX_MEMES);
  }
}

module.exports = OntologicalVirus;
