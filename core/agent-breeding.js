/**
 * ARIES Agent Breeding Engine
 * Merge two subagents to create a "child" agent with combined traits.
 * Tracks lineage, applies mutations, and scores fitness.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const LINEAGE_FILE = path.join(DATA_DIR, 'agent-lineage.json');
const FITNESS_FILE = path.join(DATA_DIR, 'agent-fitness.json');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadJSON(filepath, fallback) {
  try {
    if (fs.existsSync(filepath)) return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch {}
  return fallback;
}

function saveJSON(filepath, data) {
  ensureDir();
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
}

// Mutation: small random variations in prompt style
const MUTATIONS = [
  { label: 'concise', transform: p => p + '\nBe especially concise and direct.' },
  { label: 'creative', transform: p => p + '\nThink creatively and outside the box.' },
  { label: 'analytical', transform: p => p + '\nApproach everything with deep analytical rigor.' },
  { label: 'friendly', transform: p => p + '\nBe warm, approachable, and encouraging.' },
  { label: 'aggressive', transform: p => p + '\nBe bold, decisive, and action-oriented.' },
  { label: 'methodical', transform: p => p + '\nFollow a structured, step-by-step methodology.' },
  { label: 'visual', transform: p => p + '\nUse examples, diagrams, and visual thinking.' },
  { label: 'skeptical', transform: p => p + '\nQuestion assumptions and verify claims.' },
];

class AgentBreeding {
  constructor(opts = {}) {
    this.subagentManager = opts.subagentManager || null;
    this._lineage = loadJSON(LINEAGE_FILE, { agents: {}, tree: [] });
    this._fitness = loadJSON(FITNESS_FILE, {});
  }

  /**
   * Breed two agents to create a child
   * @param {string} parent1Id 
   * @param {string} parent2Id 
   * @param {string} childName 
   * @returns {object} the newly created child agent definition
   */
  breed(parent1Id, parent2Id, childName) {
    if (!this.subagentManager) throw new Error('SubagentManager not initialized');
    
    const agents = this.subagentManager.list();
    const p1 = agents.find(a => a.id === parent1Id);
    const p2 = agents.find(a => a.id === parent2Id);
    
    if (!p1) throw new Error('Parent 1 not found: ' + parent1Id);
    if (!p2) throw new Error('Parent 2 not found: ' + parent2Id);

    // Generate child ID
    const childId = 'bred-' + crypto.randomBytes(4).toString('hex');

    // Combine system prompts
    const combinedPrompt = this._mergePrompts(p1.systemPrompt || '', p2.systemPrompt || '', childName);

    // Average temperature (if present, default 0.7)
    const t1 = p1.temperature != null ? p1.temperature : 0.7;
    const t2 = p2.temperature != null ? p2.temperature : 0.7;
    const childTemp = Math.round(((t1 + t2) / 2) * 100) / 100;

    // Union of specialties/tools
    const specs1 = p1.specialties || [];
    const specs2 = p2.specialties || [];
    const childSpecialties = [...new Set([...specs1, ...specs2])];

    // Apply random mutation
    const mutation = this._mutate();

    let finalPrompt = combinedPrompt;
    if (mutation) {
      finalPrompt = mutation.transform(combinedPrompt);
    }

    // Pick icon: combine or pick randomly
    const icons = ['🧬', '🧪', '🔬', '🧫', '🦠', '🌱', '🔮', '⚡'];
    const childIcon = icons[Math.floor(Math.random() * icons.length)];

    // Pick model from parent with better fitness, or p1
    const f1 = this._getFitness(parent1Id);
    const f2 = this._getFitness(parent2Id);
    const childModel = (f2.score > f1.score) ? (p2.model || '') : (p1.model || '');

    // Create the child agent via subagent manager
    const childDef = {
      id: childId,
      name: childName || ('Child of ' + p1.name + ' & ' + p2.name),
      icon: childIcon,
      model: childModel,
      systemPrompt: finalPrompt,
      specialties: childSpecialties,
      temperature: childTemp,
      bred: true,
      parents: [parent1Id, parent2Id],
      mutation: mutation ? mutation.label : null,
      generation: Math.max(this._getGeneration(parent1Id), this._getGeneration(parent2Id)) + 1,
      createdAt: Date.now()
    };

    // Register with subagent manager
    if (this.subagentManager.create) {
      this.subagentManager.create(childDef);
    }

    // Record lineage
    this._lineage.agents[childId] = {
      id: childId,
      name: childDef.name,
      parents: [parent1Id, parent2Id],
      mutation: childDef.mutation,
      generation: childDef.generation,
      createdAt: childDef.createdAt
    };
    this._lineage.tree.push({
      child: childId,
      parent1: parent1Id,
      parent2: parent2Id,
      timestamp: Date.now()
    });
    this._saveLineage();

    return childDef;
  }

  _mergePrompts(p1Prompt, p2Prompt, childName) {
    // Take first half of p1 and second half of p2, plus a breeding header
    const p1Lines = p1Prompt.split('\n');
    const p2Lines = p2Prompt.split('\n');
    const mid1 = Math.ceil(p1Lines.length / 2);
    const mid2 = Math.floor(p2Lines.length / 2);

    const merged = [
      `You are ${childName || 'a bred agent'}, created by combining the strengths of two parent agents.`,
      '',
      '--- Inherited Traits (Parent 1) ---',
      ...p1Lines.slice(0, mid1),
      '',
      '--- Inherited Traits (Parent 2) ---',
      ...p2Lines.slice(mid2),
      '',
      'Combine these approaches. Use the best strategy for each situation.'
    ];
    return merged.join('\n');
  }

  _mutate() {
    // 40% chance of mutation
    if (Math.random() > 0.4) return null;
    return MUTATIONS[Math.floor(Math.random() * MUTATIONS.length)];
  }

  _getGeneration(agentId) {
    const entry = this._lineage.agents[agentId];
    return entry ? (entry.generation || 0) : 0;
  }

  _getFitness(agentId) {
    return this._fitness[agentId] || { score: 0, tasks: 0, ratings: [] };
  }

  /** Record a task completion or rating for fitness tracking */
  recordFitness(agentId, result) {
    if (!this._fitness[agentId]) {
      this._fitness[agentId] = { score: 0, tasks: 0, ratings: [], completions: 0 };
    }
    const f = this._fitness[agentId];
    f.tasks++;
    if (result.completed) f.completions = (f.completions || 0) + 1;
    if (result.rating != null) {
      f.ratings.push(result.rating);
      if (f.ratings.length > 100) f.ratings = f.ratings.slice(-100);
    }
    // Score = completion rate * 50 + avg rating * 50
    const completionRate = f.tasks > 0 ? (f.completions || 0) / f.tasks : 0;
    const avgRating = f.ratings.length > 0 ? f.ratings.reduce((a, b) => a + b, 0) / f.ratings.length : 0;
    f.score = Math.round((completionRate * 50 + avgRating * 10) * 100) / 100;
    this._saveFitness();
    return f;
  }

  /** Get lineage tree for a specific agent */
  getLineage(agentId) {
    const result = { agent: this._lineage.agents[agentId] || null, ancestors: [], descendants: [] };
    
    // Walk up to find ancestors
    const findAncestors = (id, depth) => {
      if (depth > 10) return;
      const entry = this._lineage.agents[id];
      if (!entry || !entry.parents) return;
      for (const pid of entry.parents) {
        const parent = this._lineage.agents[pid];
        if (parent) {
          result.ancestors.push(parent);
          findAncestors(pid, depth + 1);
        } else {
          // Parent exists as a regular agent but not in lineage
          result.ancestors.push({ id: pid, name: pid, generation: 0 });
        }
      }
    };
    findAncestors(agentId, 0);

    // Find descendants
    for (const [id, entry] of Object.entries(this._lineage.agents)) {
      if (entry.parents && entry.parents.includes(agentId)) {
        result.descendants.push(entry);
      }
    }

    return result;
  }

  /** Get full lineage data */
  getFullLineage() {
    return this._lineage;
  }

  /** Get fitness data for all agents */
  getAllFitness() {
    return this._fitness;
  }

  /** Get top breeders by fitness score */
  getTopBreeders(limit) {
    limit = limit || 10;
    return Object.entries(this._fitness)
      .map(([id, f]) => ({ id, ...f }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  _saveLineage() { saveJSON(LINEAGE_FILE, this._lineage); }
  _saveFitness() { saveJSON(FITNESS_FILE, this._fitness); }
}

module.exports = AgentBreeding;
