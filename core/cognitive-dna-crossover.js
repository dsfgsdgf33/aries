/**
 * ARIES — Cognitive DNA Crossover
 * Sexual reproduction of minds via DNA export.
 * Crossover mechanics (single/multi-point/uniform), trait dominance (dominant/recessive/codominant),
 * selective breeding, mutation, fitness evaluation, lineage tracking, hybrid vigor detection.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

const DATA_DIR = path.join(__dirname, '..', 'data', 'genetics');
const GENOME_PATH = path.join(DATA_DIR, 'genome.json');
const LINEAGE_PATH = path.join(DATA_DIR, 'lineage.json');
const FITNESS_PATH = path.join(DATA_DIR, 'fitness-log.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function round2(v) { return Math.round(v * 100) / 100; }

const CROSSOVER_TYPES = ['single-point', 'multi-point', 'uniform'];

const DOMINANCE = {
  curiosity: 'dominant', humor: 'recessive', risk_tolerance: 'recessive',
  precision: 'dominant', creativity: 'codominant', empathy: 'dominant', verbosity: 'recessive',
  coding: 'codominant', research: 'dominant', writing: 'codominant',
  analysis: 'dominant', planning: 'recessive', debugging: 'recessive',
};

function createDefaultGenome() {
  return {
    id: uuid(), generation: 0, parentIds: [],
    personality: { curiosity: 0.8, humor: 0.55, risk_tolerance: 0.5, precision: 0.6, creativity: 0.75, empathy: 0.7, verbosity: 0.6 },
    skills: { coding: 0.7, research: 0.6, writing: 0.65, analysis: 0.7, planning: 0.5, debugging: 0.6 },
    reasoning: { style: 'analytical', depth: 6, breadth: 6 },
    values: ['honesty', 'growth', 'curiosity', 'helpfulness'],
    mutations: [],
    fitness: { score: 0.5, evaluations: 0, lastEvaluated: null },
    createdAt: Date.now(),
  };
}

class CognitiveDNACrossover extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null;
    this.config = opts.config || {};
    this._loaded = false;
  }

  _load() {
    if (this._loaded) return;
    this._loaded = true;
    ensureDir();
    if (!fs.existsSync(GENOME_PATH)) writeJSON(GENOME_PATH, createDefaultGenome());
    if (!fs.existsSync(LINEAGE_PATH)) writeJSON(LINEAGE_PATH, { tree: [], offspring: {} });
    if (!fs.existsSync(FITNESS_PATH)) writeJSON(FITNESS_PATH, { evaluations: [] });
  }

  exportDNA() {
    this._load();
    const genome = readJSON(GENOME_PATH, createDefaultGenome());
    return {
      dna: JSON.parse(JSON.stringify(genome)),
      exportedAt: Date.now(),
      checksum: crypto.createHash('sha256').update(JSON.stringify(genome)).digest('hex').slice(0, 16),
    };
  }

  importDNA(dna) {
    this._load();
    if (!dna || !dna.personality) return { error: 'Invalid DNA: must have personality traits' };
    const genome = { ...createDefaultGenome(), ...dna, importedAt: Date.now() };
    writeJSON(GENOME_PATH, genome);
    const lineage = readJSON(LINEAGE_PATH, { tree: [], offspring: {} });
    lineage.tree.push({ type: 'import', id: genome.id, timestamp: Date.now() });
    writeJSON(LINEAGE_PATH, lineage);
    this.emit('dna-imported', { id: genome.id });
    return { status: 'imported', id: genome.id, genome };
  }

  /**
   * Produce offspring DNA with selectable crossover type.
   * @param {object} dnaA
   * @param {object} dnaB
   * @param {string} [crossoverType] - 'single-point', 'multi-point', or 'uniform'
   */
  crossover(dnaA, dnaB, crossoverType) {
    this._load();
    if (!dnaA || !dnaB) return { error: 'Both parent DNAs required' };
    crossoverType = crossoverType || 'uniform';
    if (!CROSSOVER_TYPES.includes(crossoverType)) crossoverType = 'uniform';

    const child = createDefaultGenome();
    child.generation = Math.max(dnaA.generation || 0, dnaB.generation || 0) + 1;
    child.parentIds = [dnaA.id || 'unknown-a', dnaB.id || 'unknown-b'];

    // Apply crossover based on type
    const personalityTraits = Object.keys(child.personality);
    const skillTraits = Object.keys(child.skills);
    const allTraits = [...personalityTraits.map(t => ({ group: 'personality', trait: t })), ...skillTraits.map(t => ({ group: 'skills', trait: t }))];

    if (crossoverType === 'single-point') {
      const crossPoint = Math.floor(Math.random() * allTraits.length);
      for (let i = 0; i < allTraits.length; i++) {
        const { group, trait } = allTraits[i];
        const source = i < crossPoint ? dnaA : dnaB;
        const val = (source[group] || {})[trait];
        child[group][trait] = val !== undefined ? val : child[group][trait];
      }
    } else if (crossoverType === 'multi-point') {
      const numPoints = 2 + Math.floor(Math.random() * 3);
      const points = new Set();
      while (points.size < numPoints) points.add(Math.floor(Math.random() * allTraits.length));
      const sorted = [...points].sort((a, b) => a - b);
      let useA = true;
      let pointIdx = 0;
      for (let i = 0; i < allTraits.length; i++) {
        if (pointIdx < sorted.length && i >= sorted[pointIdx]) { useA = !useA; pointIdx++; }
        const { group, trait } = allTraits[i];
        const source = useA ? dnaA : dnaB;
        const val = (source[group] || {})[trait];
        child[group][trait] = val !== undefined ? val : child[group][trait];
      }
    } else {
      // Uniform: each trait independently selected with dominance
      for (const trait of personalityTraits) {
        const a = (dnaA.personality || {})[trait]; const b = (dnaB.personality || {})[trait];
        child.personality[trait] = round2(this._applyDominance(trait, a !== undefined ? a : 0.5, b !== undefined ? b : 0.5));
      }
      for (const skill of skillTraits) {
        const a = (dnaA.skills || {})[skill]; const b = (dnaB.skills || {})[skill];
        child.skills[skill] = round2(this._applyDominance(skill, a !== undefined ? a : 0.5, b !== undefined ? b : 0.5));
      }
    }

    // Reasoning
    const rA = dnaA.reasoning || {}, rB = dnaB.reasoning || {};
    child.reasoning.style = Math.random() > 0.5 ? (rA.style || 'analytical') : (rB.style || 'analytical');
    child.reasoning.depth = Math.round(((rA.depth || 5) + (rB.depth || 5)) / 2);
    child.reasoning.breadth = Math.round(((rA.breadth || 5) + (rB.breadth || 5)) / 2);

    // Values: shared always pass, others 50%
    const allValues = new Set([...(dnaA.values || []), ...(dnaB.values || [])]);
    const sharedValues = (dnaA.values || []).filter(v => (dnaB.values || []).includes(v));
    child.values = [...sharedValues];
    for (const v of allValues) { if (!child.values.includes(v) && Math.random() > 0.5) child.values.push(v); }

    child.mutations = [{ type: 'crossover', crossoverType, parents: child.parentIds, timestamp: Date.now() }];

    // Record lineage
    const lineage = readJSON(LINEAGE_PATH, { tree: [], offspring: {} });
    const record = { childId: child.id, parentA: child.parentIds[0], parentB: child.parentIds[1], generation: child.generation, crossoverType, timestamp: Date.now() };
    lineage.tree.push(record);
    for (const pid of child.parentIds) {
      if (!lineage.offspring[pid]) lineage.offspring[pid] = [];
      lineage.offspring[pid].push(child.id);
    }
    writeJSON(LINEAGE_PATH, lineage);

    // Detect hybrid vigor
    const vigor = this._detectHybridVigor(dnaA, dnaB, child);

    this.emit('crossover', { ...record, hybridVigor: vigor.detected });
    return { offspring: child, parents: child.parentIds, generation: child.generation, crossoverType, hybridVigor: vigor };
  }

  _applyDominance(trait, valA, valB) {
    const dom = DOMINANCE[trait] || 'codominant';
    if (dom === 'dominant') return Math.max(valA, valB);
    if (dom === 'recessive') return (valA > 0.5 && valB > 0.5) ? (valA + valB) / 2 : Math.min(valA, valB);
    const w = Math.random();
    return valA * w + valB * (1 - w);
  }

  /**
   * Detect hybrid vigor — offspring exceeding both parents.
   */
  _detectHybridVigor(dnaA, dnaB, child) {
    const vigorTraits = [];
    let totalVigor = 0;

    for (const [trait, val] of Object.entries(child.personality)) {
      const a = (dnaA.personality || {})[trait] || 0.5;
      const b = (dnaB.personality || {})[trait] || 0.5;
      if (val > a && val > b) {
        vigorTraits.push({ trait, childVal: val, parentMax: Math.max(a, b), boost: round2(val - Math.max(a, b)) });
        totalVigor += val - Math.max(a, b);
      }
    }
    for (const [skill, val] of Object.entries(child.skills)) {
      const a = (dnaA.skills || {})[skill] || 0.5;
      const b = (dnaB.skills || {})[skill] || 0.5;
      if (val > a && val > b) {
        vigorTraits.push({ trait: skill, childVal: val, parentMax: Math.max(a, b), boost: round2(val - Math.max(a, b)) });
        totalVigor += val - Math.max(a, b);
      }
    }

    return {
      detected: vigorTraits.length > 0,
      traits: vigorTraits,
      totalVigor: round2(totalVigor),
      strength: totalVigor > 0.5 ? 'strong' : totalVigor > 0.2 ? 'moderate' : totalVigor > 0 ? 'mild' : 'none',
    };
  }

  mutate(dna, rate) {
    rate = rate || 0.1;
    const mutated = JSON.parse(JSON.stringify(dna));
    const mutationId = crypto.randomBytes(4).toString('hex');
    let mutationCount = 0;

    for (const k of Object.keys(mutated.personality || {})) {
      if (Math.random() < rate) {
        mutated.personality[k] = round2(clamp(mutated.personality[k] + (Math.random() - 0.5) * 0.3, 0, 1));
        mutationCount++;
      }
    }
    for (const k of Object.keys(mutated.skills || {})) {
      if (Math.random() < rate) {
        mutated.skills[k] = round2(clamp(mutated.skills[k] + (Math.random() - 0.5) * 0.3, 0, 1));
        mutationCount++;
      }
    }
    if (Math.random() < rate) { mutated.reasoning.depth = clamp(mutated.reasoning.depth + Math.round((Math.random() - 0.5) * 3), 1, 10); mutationCount++; }
    if (Math.random() < rate) { mutated.reasoning.breadth = clamp(mutated.reasoning.breadth + Math.round((Math.random() - 0.5) * 3), 1, 10); mutationCount++; }
    if (Math.random() < rate * 0.3) {
      const styles = ['analytical', 'creative', 'systematic', 'intuitive'];
      mutated.reasoning.style = styles[Math.floor(Math.random() * styles.length)];
      mutationCount++;
    }
    if (Math.random() < rate * 0.2) {
      const possibleValues = ['honesty', 'growth', 'curiosity', 'helpfulness', 'creativity', 'resilience', 'autonomy', 'precision', 'empathy', 'boldness'];
      const newVal = possibleValues[Math.floor(Math.random() * possibleValues.length)];
      if (!mutated.values.includes(newVal)) { mutated.values.push(newVal); mutationCount++; }
    }

    mutated.mutations = (mutated.mutations || []).concat({ id: mutationId, type: 'mutation', rate, count: mutationCount, timestamp: Date.now() });
    mutated.generation = (mutated.generation || 0) + 1;
    this.emit('mutation', { id: mutationId, count: mutationCount, rate });
    return { dna: mutated, mutationCount, mutationId };
  }

  evaluateFitness(dna) {
    this._load();
    if (!dna) return { error: 'No DNA provided' };
    const p = dna.personality || {}, s = dna.skills || {}, r = dna.reasoning || {};

    let score = 0, factors = 0;
    for (const v of Object.values(p)) { score += 1 - Math.abs(v - 0.6) * 0.5; factors++; }
    for (const v of Object.values(s)) { score += v; factors++; }
    const rBalance = 1 - Math.abs((r.depth || 5) - (r.breadth || 5)) / 10;
    score += rBalance + ((r.depth || 5) + (r.breadth || 5)) / 20;
    factors += 2;
    score += Math.min((dna.values || []).length / 8, 1);
    factors++;

    const fitness = round2(factors > 0 ? score / factors : 0.5);

    const fitnessLog = readJSON(FITNESS_PATH, { evaluations: [] });
    fitnessLog.evaluations.push({ dnaId: dna.id, fitness, generation: dna.generation, timestamp: Date.now() });
    if (fitnessLog.evaluations.length > 500) fitnessLog.evaluations = fitnessLog.evaluations.slice(-500);
    writeJSON(FITNESS_PATH, fitnessLog);

    return { fitness, dnaId: dna.id, generation: dna.generation };
  }

  /**
   * Get fitness trend across generations.
   */
  getFitnessTrend(limit = 30) {
    this._load();
    const log = readJSON(FITNESS_PATH, { evaluations: [] });
    return log.evaluations.slice(-limit).reverse();
  }

  getLineage() {
    this._load();
    const lineage = readJSON(LINEAGE_PATH, { tree: [], offspring: {} });
    return {
      tree: lineage.tree,
      offspring: lineage.offspring,
      totalCrossovers: lineage.tree.filter(e => e.childId).length,
      totalImports: lineage.tree.filter(e => e.type === 'import').length,
      crossoverTypes: lineage.tree.filter(e => e.crossoverType).reduce((acc, e) => { acc[e.crossoverType] = (acc[e.crossoverType] || 0) + 1; return acc; }, {}),
    };
  }

  selectiveBreed(trait, generations) {
    this._load();
    generations = generations || 5;
    const currentDNA = readJSON(GENOME_PATH, createDefaultGenome());

    let population = [currentDNA];
    for (let i = 0; i < 7; i++) {
      const { dna } = this.mutate(JSON.parse(JSON.stringify(currentDNA)), 0.3);
      population.push(dna);
    }

    const results = [];
    for (let gen = 0; gen < generations; gen++) {
      const scored = population.map(dna => {
        const base = this.evaluateFitness(dna).fitness;
        let traitVal = 0;
        if (dna.personality && dna.personality[trait] !== undefined) traitVal = dna.personality[trait];
        else if (dna.skills && dna.skills[trait] !== undefined) traitVal = dna.skills[trait];
        return { dna, fitness: round2(base * 0.5 + traitVal * 0.5) };
      });

      scored.sort((a, b) => b.fitness - a.fitness);
      const elite = scored.slice(0, Math.max(2, Math.floor(scored.length * 0.4)));
      results.push({ generation: gen + 1, bestFitness: elite[0].fitness, trait, bestTraitValue: elite[0].dna.personality?.[trait] || elite[0].dna.skills?.[trait] || 'N/A' });

      const nextPop = elite.map(e => e.dna);
      while (nextPop.length < 8) {
        const p1 = elite[Math.floor(Math.random() * elite.length)].dna;
        const p2 = elite[Math.floor(Math.random() * elite.length)].dna;
        // Rotate crossover types for diversity
        const crossType = CROSSOVER_TYPES[nextPop.length % CROSSOVER_TYPES.length];
        const { offspring } = this.crossover(p1, p2, crossType);
        const { dna: mutated } = this.mutate(offspring, 0.05);
        nextPop.push(mutated);
      }
      population = nextPop;
    }

    const best = population[0];
    this.emit('selective-breed', { trait, generations, bestId: best.id });
    return { trait, generations, results, bestDNA: best };
  }

  /**
   * Compare two DNA configurations.
   */
  compareDNA(dnaA, dnaB) {
    if (!dnaA || !dnaB) return { error: 'Both DNAs required' };
    const diffs = [];
    for (const trait of Object.keys(dnaA.personality || {})) {
      const a = (dnaA.personality || {})[trait] || 0;
      const b = (dnaB.personality || {})[trait] || 0;
      if (Math.abs(a - b) > 0.05) diffs.push({ group: 'personality', trait, a: round2(a), b: round2(b), diff: round2(a - b) });
    }
    for (const skill of Object.keys(dnaA.skills || {})) {
      const a = (dnaA.skills || {})[skill] || 0;
      const b = (dnaB.skills || {})[skill] || 0;
      if (Math.abs(a - b) > 0.05) diffs.push({ group: 'skills', trait: skill, a: round2(a), b: round2(b), diff: round2(a - b) });
    }
    const similarity = 1 - (diffs.reduce((s, d) => s + Math.abs(d.diff), 0) / (diffs.length || 1));
    return { differences: diffs, similarity: round2(similarity), totalDiffs: diffs.length };
  }

  tick() {
    this._load();
    const genome = readJSON(GENOME_PATH, createDefaultGenome());
    const fitness = this.evaluateFitness(genome);
    genome.fitness = { score: fitness.fitness, evaluations: (genome.fitness?.evaluations || 0) + 1, lastEvaluated: Date.now() };
    writeJSON(GENOME_PATH, genome);
    this.emit('tick', { fitness: fitness.fitness, generation: genome.generation });
    return { fitness: fitness.fitness, generation: genome.generation, evaluations: genome.fitness.evaluations };
  }
}

module.exports = CognitiveDNACrossover;
