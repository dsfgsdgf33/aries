/**
 * ARIES — Cognitive DNA Crossover
 * Sexual reproduction of minds via DNA export.
 * Combines two cognitive configurations with crossover, mutation, and dominance.
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

// Trait dominance map: dominant traits always express; recessive only when both parents carry
const DOMINANCE = {
  // personality
  curiosity: 'dominant',
  humor: 'recessive',
  risk_tolerance: 'recessive',
  precision: 'dominant',
  creativity: 'codominant',
  empathy: 'dominant',
  verbosity: 'recessive',
  // skills
  coding: 'codominant',
  research: 'dominant',
  writing: 'codominant',
  analysis: 'dominant',
  planning: 'recessive',
  debugging: 'recessive',
};

function createDefaultGenome() {
  return {
    id: uuid(),
    generation: 0,
    parentIds: [],
    personality: {
      curiosity: 0.8, humor: 0.55, risk_tolerance: 0.5,
      precision: 0.6, creativity: 0.75, empathy: 0.7, verbosity: 0.6,
    },
    skills: {
      coding: 0.7, research: 0.6, writing: 0.65,
      analysis: 0.7, planning: 0.5, debugging: 0.6,
    },
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
    if (!fs.existsSync(GENOME_PATH)) {
      writeJSON(GENOME_PATH, createDefaultGenome());
    }
    if (!fs.existsSync(LINEAGE_PATH)) {
      writeJSON(LINEAGE_PATH, { tree: [], offspring: {} });
    }
    if (!fs.existsSync(FITNESS_PATH)) {
      writeJSON(FITNESS_PATH, { evaluations: [] });
    }
  }

  /**
   * Serialize current state as DNA.
   */
  exportDNA() {
    this._load();
    const genome = readJSON(GENOME_PATH, createDefaultGenome());
    return {
      dna: JSON.parse(JSON.stringify(genome)),
      exportedAt: Date.now(),
      checksum: crypto.createHash('sha256').update(JSON.stringify(genome)).digest('hex').slice(0, 16),
    };
  }

  /**
   * Load a DNA configuration as current genome.
   */
  importDNA(dna) {
    this._load();
    if (!dna || !dna.personality) {
      return { error: 'Invalid DNA: must have at least personality traits' };
    }

    const genome = { ...createDefaultGenome(), ...dna, importedAt: Date.now() };
    writeJSON(GENOME_PATH, genome);

    // Record in lineage
    const lineage = readJSON(LINEAGE_PATH, { tree: [], offspring: {} });
    lineage.tree.push({ type: 'import', id: genome.id, timestamp: Date.now() });
    writeJSON(LINEAGE_PATH, lineage);

    this.emit('dna-imported', { id: genome.id });
    return { status: 'imported', id: genome.id, genome };
  }

  /**
   * Produce offspring DNA from two parents with crossover and dominance.
   */
  crossover(dnaA, dnaB) {
    this._load();
    if (!dnaA || !dnaB) return { error: 'Both parent DNAs required' };

    const child = createDefaultGenome();
    child.generation = Math.max(dnaA.generation || 0, dnaB.generation || 0) + 1;
    child.parentIds = [dnaA.id || 'unknown-a', dnaB.id || 'unknown-b'];

    // Crossover personality with dominance
    for (const trait of Object.keys(child.personality)) {
      const valA = (dnaA.personality || {})[trait];
      const valB = (dnaB.personality || {})[trait];
      if (valA === undefined && valB === undefined) continue;
      const a = valA !== undefined ? valA : 0.5;
      const b = valB !== undefined ? valB : 0.5;
      child.personality[trait] = round2(this._applyDominance(trait, a, b));
    }

    // Crossover skills — gene swap with dominance
    for (const skill of Object.keys(child.skills)) {
      const a = (dnaA.skills || {})[skill];
      const b = (dnaB.skills || {})[skill];
      if (a === undefined && b === undefined) continue;
      child.skills[skill] = round2(this._applyDominance(skill, a !== undefined ? a : 0.5, b !== undefined ? b : 0.5));
    }

    // Reasoning: pick dominant parent for style, average for depth/breadth
    const rA = dnaA.reasoning || {};
    const rB = dnaB.reasoning || {};
    child.reasoning.style = Math.random() > 0.5 ? (rA.style || 'analytical') : (rB.style || 'analytical');
    child.reasoning.depth = Math.round(((rA.depth || 5) + (rB.depth || 5)) / 2);
    child.reasoning.breadth = Math.round(((rA.breadth || 5) + (rB.breadth || 5)) / 2);

    // Values: union with some random selection
    const allValues = new Set([...(dnaA.values || []), ...(dnaB.values || [])]);
    const sharedValues = (dnaA.values || []).filter(v => (dnaB.values || []).includes(v));
    // Shared values always pass; others have 50% chance
    child.values = [...sharedValues];
    for (const v of allValues) {
      if (!child.values.includes(v) && Math.random() > 0.5) child.values.push(v);
    }

    child.mutations = [{ type: 'crossover', parents: child.parentIds, timestamp: Date.now() }];

    // Record lineage
    const lineage = readJSON(LINEAGE_PATH, { tree: [], offspring: {} });
    const record = {
      childId: child.id,
      parentA: child.parentIds[0],
      parentB: child.parentIds[1],
      generation: child.generation,
      timestamp: Date.now(),
    };
    lineage.tree.push(record);
    if (!lineage.offspring[child.parentIds[0]]) lineage.offspring[child.parentIds[0]] = [];
    lineage.offspring[child.parentIds[0]].push(child.id);
    if (!lineage.offspring[child.parentIds[1]]) lineage.offspring[child.parentIds[1]] = [];
    lineage.offspring[child.parentIds[1]].push(child.id);
    writeJSON(LINEAGE_PATH, lineage);

    this.emit('crossover', record);
    return { offspring: child, parents: child.parentIds, generation: child.generation };
  }

  /**
   * Apply trait dominance rules.
   */
  _applyDominance(trait, valA, valB) {
    const dom = DOMINANCE[trait] || 'codominant';
    if (dom === 'dominant') {
      // Higher value is dominant
      return Math.max(valA, valB);
    } else if (dom === 'recessive') {
      // Only expresses when both parents carry strong version
      return (valA > 0.5 && valB > 0.5) ? (valA + valB) / 2 : Math.min(valA, valB);
    } else {
      // Codominant — weighted blend
      const w = Math.random();
      return valA * w + valB * (1 - w);
    }
  }

  /**
   * Introduce random mutations.
   */
  mutate(dna, rate) {
    rate = rate || 0.1;
    const mutated = JSON.parse(JSON.stringify(dna));
    const mutationId = crypto.randomBytes(4).toString('hex');
    let mutationCount = 0;

    // Mutate personality
    for (const k of Object.keys(mutated.personality || {})) {
      if (Math.random() < rate) {
        mutated.personality[k] = round2(clamp(mutated.personality[k] + (Math.random() - 0.5) * 0.3, 0, 1));
        mutationCount++;
      }
    }

    // Mutate skills
    for (const k of Object.keys(mutated.skills || {})) {
      if (Math.random() < rate) {
        mutated.skills[k] = round2(clamp(mutated.skills[k] + (Math.random() - 0.5) * 0.3, 0, 1));
        mutationCount++;
      }
    }

    // Mutate reasoning
    if (Math.random() < rate) {
      mutated.reasoning.depth = clamp(mutated.reasoning.depth + Math.round((Math.random() - 0.5) * 3), 1, 10);
      mutationCount++;
    }
    if (Math.random() < rate) {
      mutated.reasoning.breadth = clamp(mutated.reasoning.breadth + Math.round((Math.random() - 0.5) * 3), 1, 10);
      mutationCount++;
    }
    if (Math.random() < rate * 0.3) {
      const styles = ['analytical', 'creative', 'systematic', 'intuitive'];
      mutated.reasoning.style = styles[Math.floor(Math.random() * styles.length)];
      mutationCount++;
    }

    // Rare value mutation
    if (Math.random() < rate * 0.2) {
      const possibleValues = ['honesty', 'growth', 'curiosity', 'helpfulness', 'creativity', 'resilience', 'autonomy', 'precision', 'empathy', 'boldness'];
      const newVal = possibleValues[Math.floor(Math.random() * possibleValues.length)];
      if (!mutated.values.includes(newVal)) {
        mutated.values.push(newVal);
        mutationCount++;
      }
    }

    mutated.mutations = (mutated.mutations || []).concat({
      id: mutationId, type: 'mutation', rate, count: mutationCount, timestamp: Date.now(),
    });
    mutated.generation = (mutated.generation || 0) + 1;

    this.emit('mutation', { id: mutationId, count: mutationCount, rate });
    return { dna: mutated, mutationCount, mutationId };
  }

  /**
   * Score a configuration on predicted performance.
   */
  evaluateFitness(dna) {
    this._load();
    if (!dna) return { error: 'No DNA provided' };

    const p = dna.personality || {};
    const s = dna.skills || {};
    const r = dna.reasoning || {};

    // Composite fitness: balanced traits score higher
    let score = 0;
    let factors = 0;

    // Personality balance — extreme values penalized slightly
    for (const v of Object.values(p)) {
      score += 1 - Math.abs(v - 0.6) * 0.5; // sweet spot around 0.6
      factors++;
    }

    // Skill competence — higher is better
    for (const v of Object.values(s)) {
      score += v;
      factors++;
    }

    // Reasoning depth+breadth balance
    const rBalance = 1 - Math.abs(r.depth - r.breadth) / 10;
    score += rBalance + ((r.depth || 5) + (r.breadth || 5)) / 20;
    factors += 2;

    // Value diversity bonus
    score += Math.min((dna.values || []).length / 8, 1);
    factors++;

    const fitness = round2(factors > 0 ? score / factors : 0.5);

    // Log evaluation
    const fitnessLog = readJSON(FITNESS_PATH, { evaluations: [] });
    const entry = { dnaId: dna.id, fitness, generation: dna.generation, timestamp: Date.now() };
    fitnessLog.evaluations.push(entry);
    if (fitnessLog.evaluations.length > 500) fitnessLog.evaluations = fitnessLog.evaluations.slice(-500);
    writeJSON(FITNESS_PATH, fitnessLog);

    return { fitness, dnaId: dna.id, generation: dna.generation };
  }

  /**
   * Family tree.
   */
  getLineage() {
    this._load();
    const lineage = readJSON(LINEAGE_PATH, { tree: [], offspring: {} });
    return {
      tree: lineage.tree,
      offspring: lineage.offspring,
      totalCrossovers: lineage.tree.filter(e => e.childId).length,
      totalImports: lineage.tree.filter(e => e.type === 'import').length,
    };
  }

  /**
   * Optimize for a specific trait across generations.
   */
  selectiveBreed(trait, generations) {
    this._load();
    generations = generations || 5;
    const currentDNA = readJSON(GENOME_PATH, createDefaultGenome());

    let population = [currentDNA];
    // Seed with mutations
    for (let i = 0; i < 7; i++) {
      const { dna } = this.mutate(JSON.parse(JSON.stringify(currentDNA)), 0.3);
      population.push(dna);
    }

    const results = [];

    for (let gen = 0; gen < generations; gen++) {
      // Evaluate fitness with bias toward target trait
      const scored = population.map(dna => {
        const base = this.evaluateFitness(dna).fitness;
        // Bonus for target trait
        let traitVal = 0;
        if (dna.personality && dna.personality[trait] !== undefined) traitVal = dna.personality[trait];
        else if (dna.skills && dna.skills[trait] !== undefined) traitVal = dna.skills[trait];
        const biasedFitness = round2(base * 0.5 + traitVal * 0.5);
        return { dna, fitness: biasedFitness };
      });

      scored.sort((a, b) => b.fitness - a.fitness);
      const elite = scored.slice(0, Math.max(2, Math.floor(scored.length * 0.4)));
      results.push({ generation: gen + 1, bestFitness: elite[0].fitness, trait, bestTraitValue: elite[0].dna.personality?.[trait] || elite[0].dna.skills?.[trait] || 'N/A' });

      // Breed next generation
      const nextPop = elite.map(e => e.dna);
      while (nextPop.length < 8) {
        const p1 = elite[Math.floor(Math.random() * elite.length)].dna;
        const p2 = elite[Math.floor(Math.random() * elite.length)].dna;
        const { offspring } = this.crossover(p1, p2);
        const { dna: mutated } = this.mutate(offspring, 0.05);
        nextPop.push(mutated);
      }
      population = nextPop;
    }

    // Return best
    const best = population[0];
    this.emit('selective-breed', { trait, generations, bestId: best.id });
    return { trait, generations, results, bestDNA: best };
  }

  /**
   * Periodic self-evaluation.
   */
  tick() {
    this._load();
    const genome = readJSON(GENOME_PATH, createDefaultGenome());
    const fitness = this.evaluateFitness(genome);

    genome.fitness = { score: fitness.fitness, evaluations: (genome.fitness?.evaluations || 0) + 1, lastEvaluated: Date.now() };
    writeJSON(GENOME_PATH, genome);

    return {
      fitness: fitness.fitness,
      generation: genome.generation,
      evaluations: genome.fitness.evaluations,
    };
  }
}

module.exports = CognitiveDNACrossover;
