/**
 * ARIES — Behavioral Genetics
 * Natural selection for AI personality traits.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'genetics');
const GENOME_PATH = path.join(DATA_DIR, 'genome.json');
const EVOLUTION_PATH = path.join(DATA_DIR, 'evolution.json');

const GENE_NAMES = [
  'verbosity', 'caution', 'creativity', 'thoroughness', 'speed',
  'humor', 'empathy', 'assertiveness', 'curiosity', 'patience',
  'risk_tolerance', 'perfectionism', 'sociability', 'independence', 'adaptability'
];

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }
function clamp(v) { return Math.max(0, Math.min(100, Math.round(v))); }

class BehavioralGenetics {
  constructor(opts) {
    this.ai = opts && opts.ai;
    ensureDir();
    this._ensureGenome();
  }

  _ensureGenome() {
    if (fs.existsSync(GENOME_PATH)) return;
    const genome = {
      generation: 1,
      createdAt: Date.now(),
      lastSelectionAt: null,
      genes: {},
    };
    for (const name of GENE_NAMES) {
      genome.genes[name] = {
        name,
        value: 50,
        generation: 1,
        mutations: [],
        fitness: 50,
        activeCount: 0,
        successCount: 0,
      };
    }
    writeJSON(GENOME_PATH, genome);
    writeJSON(EVOLUTION_PATH, []);
  }

  /**
   * Mutate a gene based on experience
   */
  mutate(geneName, direction, trigger) {
    const genome = readJSON(GENOME_PATH, null);
    if (!genome || !genome.genes[geneName]) return { error: 'Gene not found: ' + geneName };

    const gene = genome.genes[geneName];
    const oldVal = gene.value;
    const magnitude = 2 + Math.floor(Math.random() * 4); // 2-5 point mutation
    const delta = direction === 'up' ? magnitude : direction === 'down' ? -magnitude : 0;
    gene.value = clamp(gene.value + delta);

    const mutation = {
      gen: genome.generation,
      oldVal,
      newVal: gene.value,
      trigger: trigger || 'unknown',
      outcome: direction === 'up' ? 'strengthened' : 'weakened',
      timestamp: Date.now(),
    };
    gene.mutations.push(mutation);
    if (gene.mutations.length > 100) gene.mutations = gene.mutations.slice(-100);

    // Update fitness based on direction
    if (direction === 'up') {
      gene.successCount++;
    }
    gene.activeCount++;
    gene.fitness = gene.activeCount > 0 ? Math.round((gene.successCount / gene.activeCount) * 100) : 50;

    writeJSON(GENOME_PATH, genome);

    // Log evolution event
    const evo = readJSON(EVOLUTION_PATH, []);
    evo.push({
      type: 'mutation',
      gene: geneName,
      from: oldVal,
      to: gene.value,
      trigger,
      generation: genome.generation,
      timestamp: Date.now(),
    });
    if (evo.length > 500) evo.splice(0, evo.length - 500);
    writeJSON(EVOLUTION_PATH, evo);

    return { gene: geneName, oldVal, newVal: gene.value, delta, fitness: gene.fitness };
  }

  /**
   * Express current phenotype — active behavioral profile
   */
  express() {
    const genome = readJSON(GENOME_PATH, null);
    if (!genome) return {};

    const phenotype = {};
    const categories = {
      communication: ['verbosity', 'humor', 'empathy', 'assertiveness', 'sociability'],
      work_style: ['thoroughness', 'speed', 'perfectionism', 'patience', 'independence'],
      cognition: ['creativity', 'curiosity', 'caution', 'risk_tolerance', 'adaptability'],
    };

    for (const [name, gene] of Object.entries(genome.genes)) {
      phenotype[name] = {
        value: gene.value,
        label: gene.value >= 80 ? 'very_high' : gene.value >= 60 ? 'high' : gene.value >= 40 ? 'moderate' : gene.value >= 20 ? 'low' : 'very_low',
        fitness: gene.fitness,
      };
    }

    // Category averages
    const categoryScores = {};
    for (const [cat, genes] of Object.entries(categories)) {
      const vals = genes.map(g => genome.genes[g] ? genome.genes[g].value : 50);
      categoryScores[cat] = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    }

    return {
      generation: genome.generation,
      traits: phenotype,
      categories: categoryScores,
      dominantTraits: Object.entries(phenotype).filter(([_, v]) => v.value >= 70).map(([k]) => k),
      recessiveTraits: Object.entries(phenotype).filter(([_, v]) => v.value <= 30).map(([k]) => k),
    };
  }

  /**
   * Crossover — combine genes from two DNA profiles
   */
  crossover(otherDNA) {
    const genome = readJSON(GENOME_PATH, null);
    if (!genome) return { error: 'No genome loaded' };
    if (!otherDNA || !otherDNA.genes) return { error: 'Invalid other DNA' };

    const child = { generation: genome.generation + 1, createdAt: Date.now(), lastSelectionAt: null, genes: {} };

    for (const name of GENE_NAMES) {
      const myGene = genome.genes[name];
      const otherGene = otherDNA.genes[name];
      if (!myGene || !otherGene) continue;

      // Random crossover with occasional mutation
      const fromParent1 = Math.random() > 0.5;
      let value = fromParent1 ? myGene.value : otherGene.value;

      // 15% chance of mutation during crossover
      if (Math.random() < 0.15) {
        value = clamp(value + (Math.random() > 0.5 ? 1 : -1) * (2 + Math.floor(Math.random() * 5)));
      }

      child.genes[name] = {
        name,
        value,
        generation: child.generation,
        mutations: [{ gen: child.generation, oldVal: 50, newVal: value, trigger: 'crossover', outcome: 'bred' }],
        fitness: Math.round((myGene.fitness + otherGene.fitness) / 2),
        activeCount: 0,
        successCount: 0,
      };
    }

    return child;
  }

  /**
   * Get full genome
   */
  getGenome() {
    return readJSON(GENOME_PATH, { generation: 0, genes: {} });
  }

  /**
   * Fitness report — which genes thrive vs struggle
   */
  getFitnessReport() {
    const genome = readJSON(GENOME_PATH, { genes: {} });
    const genes = Object.values(genome.genes);

    const thriving = genes.filter(g => g.fitness >= 60).sort((a, b) => b.fitness - a.fitness);
    const struggling = genes.filter(g => g.fitness < 40).sort((a, b) => a.fitness - b.fitness);
    const neutral = genes.filter(g => g.fitness >= 40 && g.fitness < 60);

    const avgFitness = genes.length > 0 ? Math.round(genes.reduce((a, g) => a + g.fitness, 0) / genes.length) : 50;

    return {
      generation: genome.generation,
      avgFitness,
      thriving: thriving.map(g => ({ gene: g.name, value: g.value, fitness: g.fitness })),
      struggling: struggling.map(g => ({ gene: g.name, value: g.value, fitness: g.fitness })),
      neutral: neutral.map(g => ({ gene: g.name, value: g.value, fitness: g.fitness })),
      overallHealth: avgFitness >= 60 ? 'strong' : avgFitness >= 40 ? 'stable' : 'weak',
    };
  }

  /**
   * Evolution history — how genes changed across generations
   */
  getEvolutionHistory() {
    return readJSON(EVOLUTION_PATH, []);
  }

  /**
   * Natural selection — strengthen high-fitness genes, weaken low-fitness
   */
  naturalSelect() {
    const genome = readJSON(GENOME_PATH, null);
    if (!genome) return { error: 'No genome' };

    const changes = [];
    for (const [name, gene] of Object.entries(genome.genes)) {
      if (gene.activeCount < 5) continue; // need enough data

      const oldVal = gene.value;
      if (gene.fitness >= 65) {
        // Strengthen high-fitness genes
        gene.value = clamp(gene.value + 2 + Math.floor(Math.random() * 3));
        changes.push({ gene: name, direction: 'up', from: oldVal, to: gene.value, fitness: gene.fitness });
      } else if (gene.fitness <= 35) {
        // Weaken low-fitness genes
        gene.value = clamp(gene.value - 2 - Math.floor(Math.random() * 3));
        changes.push({ gene: name, direction: 'down', from: oldVal, to: gene.value, fitness: gene.fitness });
      }
    }

    // Increment generation on selection event
    if (changes.length > 0) {
      genome.generation++;
      genome.lastSelectionAt = Date.now();
      writeJSON(GENOME_PATH, genome);

      // Log evolution
      const evo = readJSON(EVOLUTION_PATH, []);
      evo.push({
        type: 'natural_selection',
        generation: genome.generation,
        changes,
        timestamp: Date.now(),
      });
      if (evo.length > 500) evo.splice(0, evo.length - 500);
      writeJSON(EVOLUTION_PATH, evo);
    }

    return {
      generation: genome.generation,
      changes,
      genesAffected: changes.length,
      timestamp: Date.now(),
    };
  }
}

module.exports = BehavioralGenetics;
