/**
 * ARIES — Agent DNA / Genetic Code System
 * Every agent has a structured genome that drives behavior.
 * Supports mutation, crossover, evolution, and DNA↔prompt compilation.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DNA_DIR = path.join(__dirname, '..', 'data', 'agent-dna');

function ensureDir() {
  if (!fs.existsSync(DNA_DIR)) fs.mkdirSync(DNA_DIR, { recursive: true });
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function clamp01(v) { return clamp(v, 0, 1); }
function clampBias(v) { return clamp(v, -1, 1); }
function roundN(v, n) { return Math.round(v * Math.pow(10, n)) / Math.pow(10, n); }

function createDefaultGenome() {
  return {
    personality: { creativity: 0.5, precision: 0.5, verbosity: 0.5, risk_tolerance: 0.5, humor: 0.5 },
    skills: { coding: 0.5, research: 0.5, writing: 0.5, analysis: 0.5, planning: 0.5, debugging: 0.5 },
    biases: { cautious_vs_bold: 0, detail_vs_big_picture: 0, speed_vs_quality: 0 },
    reasoning: { style: 'analytical', depth: 5, breadth: 5 },
    mutations: [],
    generation: 0,
    fitness: { tasks_completed: 0, success_rate: 0, avg_rating: 0, specialization_score: 0 }
  };
}

// Extract DNA from a system prompt using keyword heuristics
function extractDnaFromPrompt(prompt) {
  const dna = createDefaultGenome();
  if (!prompt) return dna;
  const lp = prompt.toLowerCase();

  // Personality extraction
  if (/creativ|imaginat|innovat/.test(lp)) dna.personality.creativity = 0.8;
  if (/precis|exact|accurat|rigorous/.test(lp)) dna.personality.precision = 0.8;
  if (/verbose|detail|thorough|comprehensive/.test(lp)) dna.personality.verbosity = 0.8;
  if (/concise|brief|short|terse/.test(lp)) dna.personality.verbosity = 0.2;
  if (/bold|risk|aggress|daring/.test(lp)) dna.personality.risk_tolerance = 0.8;
  if (/cautious|careful|conservat/.test(lp)) dna.personality.risk_tolerance = 0.2;
  if (/humor|funny|witty|joke/.test(lp)) dna.personality.humor = 0.8;
  if (/serious|formal|professional/.test(lp)) dna.personality.humor = 0.2;

  // Skills extraction
  if (/code|program|develop|engineer|software/.test(lp)) dna.skills.coding = 0.8;
  if (/research|investigat|study/.test(lp)) dna.skills.research = 0.8;
  if (/writ|author|content|copy/.test(lp)) dna.skills.writing = 0.8;
  if (/analy|data|statistic|insight/.test(lp)) dna.skills.analysis = 0.8;
  if (/plan|strateg|organiz|project/.test(lp)) dna.skills.planning = 0.8;
  if (/debug|fix|troubleshoot|diagnos/.test(lp)) dna.skills.debugging = 0.8;

  // Reasoning style
  if (/systematic|methodic|structured/.test(lp)) dna.reasoning.style = 'systematic';
  if (/creativ|lateral|outside.the.box/.test(lp)) dna.reasoning.style = 'creative';
  if (/intuit|gut|instinct/.test(lp)) dna.reasoning.style = 'intuitive';

  return dna;
}

// Compile DNA genome into system prompt modifier text
function compileDnaToPrompt(dna) {
  const parts = [];

  // Personality
  const p = dna.personality || {};
  if (p.creativity > 0.7) parts.push('Be highly creative and innovative.');
  else if (p.creativity < 0.3) parts.push('Stick to conventional approaches.');
  if (p.precision > 0.7) parts.push('Be extremely precise and accurate.');
  if (p.verbosity > 0.7) parts.push('Provide thorough, detailed responses.');
  else if (p.verbosity < 0.3) parts.push('Be concise and brief.');
  if (p.risk_tolerance > 0.7) parts.push('Take bold, ambitious approaches.');
  else if (p.risk_tolerance < 0.3) parts.push('Be cautious and conservative.');
  if (p.humor > 0.7) parts.push('Include wit and humor where appropriate.');
  else if (p.humor < 0.3) parts.push('Maintain a serious, professional tone.');

  // Skills emphasis
  const s = dna.skills || {};
  const topSkills = Object.entries(s).filter(([,v]) => v > 0.7).map(([k]) => k);
  if (topSkills.length > 0) parts.push('Specializations: ' + topSkills.join(', ') + '.');

  // Biases
  const b = dna.biases || {};
  if (b.cautious_vs_bold > 0.5) parts.push('Lean bold and decisive.');
  else if (b.cautious_vs_bold < -0.5) parts.push('Lean cautious and thorough.');
  if (b.detail_vs_big_picture > 0.5) parts.push('Focus on the big picture.');
  else if (b.detail_vs_big_picture < -0.5) parts.push('Focus on details.');
  if (b.speed_vs_quality > 0.5) parts.push('Prioritize quality over speed.');
  else if (b.speed_vs_quality < -0.5) parts.push('Prioritize speed over perfection.');

  // Reasoning
  const r = dna.reasoning || {};
  parts.push('Reasoning style: ' + (r.style || 'analytical') + ' (depth: ' + (r.depth || 5) + '/10, breadth: ' + (r.breadth || 5) + '/10).');

  return '[DNA PROFILE] ' + parts.join(' ');
}

// Mutate: small random perturbations
function mutate(dna, intensity) {
  intensity = intensity || 0.1;
  const mutated = JSON.parse(JSON.stringify(dna));
  const mutationId = crypto.randomBytes(4).toString('hex');

  // Mutate personality
  Object.keys(mutated.personality).forEach(k => {
    mutated.personality[k] = roundN(clamp01(mutated.personality[k] + (Math.random() - 0.5) * 2 * intensity), 2);
  });
  // Mutate skills
  Object.keys(mutated.skills).forEach(k => {
    mutated.skills[k] = roundN(clamp01(mutated.skills[k] + (Math.random() - 0.5) * 2 * intensity), 2);
  });
  // Mutate biases
  Object.keys(mutated.biases).forEach(k => {
    mutated.biases[k] = roundN(clampBias(mutated.biases[k] + (Math.random() - 0.5) * 2 * intensity), 2);
  });
  // Mutate reasoning depth/breadth
  mutated.reasoning.depth = clamp(Math.round(mutated.reasoning.depth + (Math.random() - 0.5) * 2 * intensity * 10), 1, 10);
  mutated.reasoning.breadth = clamp(Math.round(mutated.reasoning.breadth + (Math.random() - 0.5) * 2 * intensity * 10), 1, 10);
  // Possibly mutate reasoning style
  if (Math.random() < intensity * 0.5) {
    const styles = ['analytical', 'creative', 'systematic', 'intuitive'];
    mutated.reasoning.style = styles[Math.floor(Math.random() * styles.length)];
  }

  mutated.mutations = (mutated.mutations || []).concat({ id: mutationId, type: 'mutation', intensity, timestamp: Date.now() });
  mutated.generation = (mutated.generation || 0) + 1;
  return mutated;
}

// Crossover: blend two genomes
function crossover(parent1, parent2) {
  const child = createDefaultGenome();
  const crossId = crypto.randomBytes(4).toString('hex');

  // Weighted average with random dominance
  Object.keys(child.personality).forEach(k => {
    const w = Math.random();
    child.personality[k] = roundN(clamp01(parent1.personality[k] * w + parent2.personality[k] * (1 - w)), 2);
  });
  Object.keys(child.skills).forEach(k => {
    // Gene swap: randomly pick from one parent
    child.skills[k] = Math.random() > 0.5 ? parent1.skills[k] : parent2.skills[k];
  });
  Object.keys(child.biases).forEach(k => {
    const w = Math.random();
    child.biases[k] = roundN(clampBias(parent1.biases[k] * w + parent2.biases[k] * (1 - w)), 2);
  });
  // Reasoning: dominant parent
  const dominant = Math.random() > 0.5 ? parent1 : parent2;
  child.reasoning.style = dominant.reasoning.style;
  child.reasoning.depth = Math.round((parent1.reasoning.depth + parent2.reasoning.depth) / 2);
  child.reasoning.breadth = Math.round((parent1.reasoning.breadth + parent2.reasoning.breadth) / 2);

  child.generation = Math.max(parent1.generation || 0, parent2.generation || 0) + 1;
  child.mutations = [{ id: crossId, type: 'crossover', parents: ['parent1', 'parent2'], timestamp: Date.now() }];
  return child;
}

// Evolution: select top by fitness, breed, replace worst
function evolve(population, generations) {
  generations = generations || 1;
  let pop = population.map(p => JSON.parse(JSON.stringify(p)));

  for (let g = 0; g < generations; g++) {
    // Sort by fitness (success_rate * tasks_completed as proxy)
    pop.sort((a, b) => {
      const fa = (a.fitness.success_rate || 0) * Math.log2(1 + (a.fitness.tasks_completed || 0));
      const fb = (b.fitness.success_rate || 0) * Math.log2(1 + (b.fitness.tasks_completed || 0));
      return fb - fa;
    });

    const elite = pop.slice(0, Math.max(2, Math.floor(pop.length * 0.3)));
    const newPop = elite.slice(); // keep elite

    while (newPop.length < pop.length) {
      const p1 = elite[Math.floor(Math.random() * elite.length)];
      const p2 = elite[Math.floor(Math.random() * elite.length)];
      let child = crossover(p1, p2);
      child = mutate(child, 0.05); // small mutation
      newPop.push(child);
    }
    pop = newPop;
  }
  return pop;
}

// File I/O
function getDna(agentId) {
  ensureDir();
  const fp = path.join(DNA_DIR, agentId + '.json');
  if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, 'utf8'));
  return null;
}

function saveDna(agentId, dna) {
  ensureDir();
  const fp = path.join(DNA_DIR, agentId + '.json');
  fs.writeFileSync(fp, JSON.stringify(dna, null, 2));
}

function listAll() {
  ensureDir();
  const files = fs.readdirSync(DNA_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(DNA_DIR, f), 'utf8'));
      return { agentId: f.replace('.json', ''), ...data };
    } catch { return null; }
  }).filter(Boolean);
}

module.exports = {
  createDefaultGenome,
  extractDnaFromPrompt,
  compileDnaToPrompt,
  mutate,
  crossover,
  evolve,
  getDna,
  saveDna,
  listAll
};
