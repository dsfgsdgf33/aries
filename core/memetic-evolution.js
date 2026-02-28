/**
 * ARIES — Memetic Evolution
 * Ideas evolve like genes — reproduce, mutate, breed, compete, survive.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'memetic');
const POP_PATH = path.join(DATA_DIR, 'population.json');
const GRAVE_PATH = path.join(DATA_DIR, 'graveyard.json');

const POP_CAP = 100;

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }

class MemeticEvolution {
  constructor(refs) {
    this.refs = refs || {};
    ensureDir();
  }

  _getPop() { return readJSON(POP_PATH, []); }
  _savePop(p) { writeJSON(POP_PATH, p); }
  _getGrave() { return readJSON(GRAVE_PATH, []); }
  _saveGrave(g) { writeJSON(GRAVE_PATH, g); }

  spawn(idea) {
    const pop = this._getPop();
    const meme = {
      id: uuid(),
      content: typeof idea === 'string' ? idea : (idea.content || idea.idea || JSON.stringify(idea)),
      fitness: 50,
      generation: 0,
      parentIds: [],
      mutations: [],
      offspring: [],
      born: Date.now(),
      lastTested: null,
      alive: true,
      testCount: 0,
      tags: idea.tags || [],
    };
    pop.push(meme);
    this._enforcePopCap(pop);
    this._savePop(pop);
    return meme;
  }

  reproduce(memeId) {
    const pop = this._getPop();
    const parent = pop.find(m => m.id === memeId);
    if (!parent) return { error: 'Meme not found' };

    const mutation = this._mutate(parent.content);
    const child = {
      id: uuid(),
      content: mutation.content,
      fitness: Math.max(10, parent.fitness - 10 + Math.floor(Math.random() * 20)),
      generation: parent.generation + 1,
      parentIds: [parent.id],
      mutations: [mutation.description],
      offspring: [],
      born: Date.now(),
      lastTested: null,
      alive: true,
      testCount: 0,
      tags: [...parent.tags],
    };

    parent.offspring.push(child.id);
    pop.push(child);
    this._enforcePopCap(pop);
    this._savePop(pop);
    return child;
  }

  breed(id1, id2) {
    const pop = this._getPop();
    const p1 = pop.find(m => m.id === id1);
    const p2 = pop.find(m => m.id === id2);
    if (!p1 || !p2) return { error: 'Parent meme(s) not found' };

    const combined = this._crossover(p1.content, p2.content);
    const child = {
      id: uuid(),
      content: combined.content,
      fitness: Math.round((p1.fitness + p2.fitness) / 2),
      generation: Math.max(p1.generation, p2.generation) + 1,
      parentIds: [p1.id, p2.id],
      mutations: [combined.description],
      offspring: [],
      born: Date.now(),
      lastTested: null,
      alive: true,
      testCount: 0,
      tags: [...new Set([...p1.tags, ...p2.tags])],
    };

    p1.offspring.push(child.id);
    p2.offspring.push(child.id);
    pop.push(child);
    this._enforcePopCap(pop);
    this._savePop(pop);
    return child;
  }

  test(memeId, outcome) {
    const pop = this._getPop();
    const meme = pop.find(m => m.id === memeId);
    if (!meme) return { error: 'Meme not found' };

    meme.lastTested = Date.now();
    meme.testCount = (meme.testCount || 0) + 1;

    if (outcome === 'success' || outcome === 'positive' || outcome === true) {
      meme.fitness = Math.min(100, meme.fitness + 10);
    } else if (outcome === 'failure' || outcome === 'negative' || outcome === false) {
      meme.fitness = Math.max(0, meme.fitness - 15);
    } else if (typeof outcome === 'number') {
      meme.fitness = Math.max(0, Math.min(100, outcome));
    } else {
      // neutral
      meme.fitness = Math.max(0, meme.fitness - 2);
    }

    this._savePop(pop);
    return meme;
  }

  select() {
    const pop = this._getPop();
    const grave = this._getGrave();

    if (pop.length <= POP_CAP / 2) {
      return { killed: 0, reproduced: 0, message: 'Population too small for selection' };
    }

    // Sort by fitness
    pop.sort((a, b) => a.fitness - b.fitness);

    // Kill bottom 20%
    const killCount = Math.floor(pop.length * 0.2);
    const killed = [];
    for (let i = 0; i < killCount; i++) {
      const victim = pop[i];
      victim.alive = false;
      victim.diedAt = Date.now();
      victim.causeOfDeath = 'natural selection (fitness: ' + victim.fitness + ')';
      grave.push(victim);
      killed.push(victim.id);
    }

    // Remove killed from population
    const surviving = pop.filter(m => !killed.includes(m.id));

    // Reproduce top 20%
    const topCount = Math.floor(surviving.length * 0.2);
    const reproduced = [];
    for (let i = surviving.length - 1; i >= surviving.length - topCount && i >= 0; i--) {
      const parent = surviving[i];
      const mutation = this._mutate(parent.content);
      const child = {
        id: uuid(),
        content: mutation.content,
        fitness: Math.max(20, parent.fitness - 5),
        generation: parent.generation + 1,
        parentIds: [parent.id],
        mutations: [mutation.description],
        offspring: [],
        born: Date.now(),
        lastTested: null,
        alive: true,
        testCount: 0,
        tags: [...parent.tags],
      };
      parent.offspring.push(child.id);
      surviving.push(child);
      reproduced.push(child.id);
    }

    if (grave.length > 500) grave.splice(0, grave.length - 500);
    this._savePop(surviving);
    this._saveGrave(grave);

    return { killed: killed.length, reproduced: reproduced.length, population: surviving.length };
  }

  getPopulation() {
    return this._getPop().filter(m => m.alive);
  }

  getGraveyard() {
    return this._getGrave().slice(-50).reverse();
  }

  getFittest(limit) {
    const pop = this._getPop().filter(m => m.alive);
    return pop.sort((a, b) => b.fitness - a.fitness).slice(0, limit || 10);
  }

  getLineage(memeId) {
    const pop = this._getPop();
    const grave = this._getGrave();
    const all = [...pop, ...grave];

    const target = all.find(m => m.id === memeId);
    if (!target) return { error: 'Meme not found' };

    const ancestors = [];
    const descendants = [];

    // Walk up
    const findAncestors = (ids, depth) => {
      if (depth > 10) return;
      for (const id of ids) {
        const parent = all.find(m => m.id === id);
        if (parent) {
          ancestors.push({ ...parent, depth });
          findAncestors(parent.parentIds || [], depth + 1);
        }
      }
    };
    findAncestors(target.parentIds || [], 1);

    // Walk down
    const findDescendants = (id, depth) => {
      if (depth > 10) return;
      const meme = all.find(m => m.id === id);
      if (!meme) return;
      for (const childId of (meme.offspring || [])) {
        const child = all.find(m => m.id === childId);
        if (child) {
          descendants.push({ ...child, depth });
          findDescendants(childId, depth + 1);
        }
      }
    };
    findDescendants(memeId, 1);

    return { meme: target, ancestors, descendants, totalLineage: ancestors.length + descendants.length + 1 };
  }

  getGenerationStats() {
    const pop = this._getPop();
    const grave = this._getGrave();
    const all = [...pop, ...grave];
    const byGen = {};

    for (const m of all) {
      const g = m.generation || 0;
      if (!byGen[g]) byGen[g] = { generation: g, count: 0, totalFitness: 0, alive: 0, dead: 0 };
      byGen[g].count++;
      byGen[g].totalFitness += m.fitness || 0;
      if (m.alive) byGen[g].alive++;
      else byGen[g].dead++;
    }

    return Object.values(byGen).map(g => ({
      ...g,
      avgFitness: g.count > 0 ? Math.round(g.totalFitness / g.count) : 0,
    })).sort((a, b) => a.generation - b.generation);
  }

  // ── Genetic operations ──

  _mutate(content) {
    const mutations = [
      { desc: 'word swap', fn: c => { const w = c.split(' '); if (w.length > 2) { const i = Math.floor(Math.random() * (w.length - 1)); [w[i], w[i+1]] = [w[i+1], w[i]]; } return w.join(' '); }},
      { desc: 'emphasis added', fn: c => c + ' (with emphasis)' },
      { desc: 'simplified', fn: c => c.split('.')[0] + '.' },
      { desc: 'inverted', fn: c => 'Instead of "' + c.slice(0, 50) + '", try the opposite approach' },
      { desc: 'extended', fn: c => c + ' — and also consider the broader implications' },
      { desc: 'questioned', fn: c => 'What if: ' + c + '?' },
      { desc: 'constrained', fn: c => c + ' (with minimal resources)' },
      { desc: 'amplified', fn: c => c + ' — taken to the extreme' },
    ];

    const m = mutations[Math.floor(Math.random() * mutations.length)];
    return { content: m.fn(content), description: m.desc };
  }

  _crossover(content1, content2) {
    const words1 = content1.split(' ');
    const words2 = content2.split(' ');
    const mid1 = Math.floor(words1.length / 2);
    const mid2 = Math.floor(words2.length / 2);
    const combined = [...words1.slice(0, mid1), ...words2.slice(mid2)].join(' ');
    return { content: combined, description: 'crossover of two parent ideas' };
  }

  _enforcePopCap(pop) {
    const alive = pop.filter(m => m.alive);
    if (alive.length <= POP_CAP) return;

    // Kill weakest
    alive.sort((a, b) => a.fitness - b.fitness);
    const grave = this._getGrave();
    const toKill = alive.length - POP_CAP;
    for (let i = 0; i < toKill; i++) {
      alive[i].alive = false;
      alive[i].diedAt = Date.now();
      alive[i].causeOfDeath = 'population cap exceeded (fitness: ' + alive[i].fitness + ')';
      grave.push(alive[i]);
    }
    // Remove dead from pop array
    const deadIds = new Set(alive.slice(0, toKill).map(m => m.id));
    for (let i = pop.length - 1; i >= 0; i--) {
      if (deadIds.has(pop[i].id)) pop.splice(i, 1);
    }
    if (grave.length > 500) grave.splice(0, grave.length - 500);
    this._saveGrave(grave);
  }
}

module.exports = MemeticEvolution;
