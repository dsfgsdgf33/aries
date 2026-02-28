/**
 * ARIES — Creativity Engine
 * Continuous spontaneous creativity — "shower thoughts" running in background.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'creativity');
const IDEAS_PATH = path.join(DATA_DIR, 'ideas.json');

const METHODS = ['random_collision', 'what_if', 'analogy_transfer', 'constraint_flip', 'recombination'];

const DOMAINS = ['nature', 'music', 'sports', 'cooking', 'architecture', 'biology', 'physics', 'gaming', 'psychology', 'economics'];
const CONCEPTS = [
  'neural networks', 'feedback loops', 'caching', 'distributed systems', 'error handling',
  'memory management', 'event-driven design', 'state machines', 'encryption', 'compression',
  'load balancing', 'garbage collection', 'recursion', 'lazy evaluation', 'pub/sub',
  'microservices', 'monoliths', 'queues', 'trees', 'graphs', 'consensus algorithms',
  'natural selection', 'symbiosis', 'migration patterns', 'fractals', 'resonance',
  'improvisation', 'harmony', 'rhythm', 'counterpoint', 'momentum', 'leverage',
  'fermentation', 'crystallization', 'erosion', 'photosynthesis', 'metamorphosis',
];
const FEATURES = [
  'dream engine', 'reasoning chains', 'emotion engine', 'knowledge graph', 'subagent system',
  'self-healing', 'calibration', 'plugin system', 'voice mode', 'autopilot',
  'memory consolidation', 'skill synthesis', 'instinct engine', 'swarm network',
];
const LIMITATIONS = [
  'context window limits', 'single-threaded processing', 'no persistent memory between sessions',
  'can\'t learn in real-time', 'text-only output', 'no physical embodiment', 'latency on API calls',
  'can\'t run code safely', 'no emotional experience', 'deterministic when temperature=0',
];

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function pickN(arr, n) { const s = [...arr].sort(() => Math.random() - 0.5); return s.slice(0, n); }

class CreativityEngine {
  constructor(opts) {
    this.ai = opts && opts.ai;
    this._interval = null;
    ensureDir();
  }

  /**
   * Start background creative process.
   */
  startCreating() {
    if (this._interval) return;
    const minMs = 10 * 60 * 1000;
    const maxMs = 15 * 60 * 1000;
    const schedule = () => {
      const delay = minMs + Math.random() * (maxMs - minMs);
      this._interval = setTimeout(async () => {
        try { await this.generate(); } catch (e) { console.error('[CREATIVITY] Error:', e.message); }
        schedule();
      }, delay);
      if (this._interval.unref) this._interval.unref();
    };
    schedule();
    console.log('[CREATIVITY] Background creation started (every 10-15 min)');
  }

  stopCreating() {
    if (this._interval) { clearTimeout(this._interval); this._interval = null; }
  }

  /**
   * Generate one creative idea using a random method.
   */
  async generate() {
    const method = pick(METHODS);
    let idea;
    
    switch (method) {
      case 'random_collision': idea = this._randomCollision(); break;
      case 'what_if': idea = this._whatIf(); break;
      case 'analogy_transfer': idea = this._analogyTransfer(); break;
      case 'constraint_flip': idea = this._constraintFlip(); break;
      case 'recombination': idea = this._recombination(); break;
    }

    // If AI available, enhance the idea
    if (this.ai && typeof this.ai.chat === 'function' && idea) {
      try {
        const resp = await this.ai.chat([
          { role: 'system', content: 'You are a creative idea enhancer. Given a raw creative spark, develop it into a concrete, actionable idea. Return JSON: { "idea": "enhanced description", "noveltyScore": 0-100, "usefulness": 0-100 }. Be imaginative but practical.' },
          { role: 'user', content: `Method: ${idea.method}\nInputs: ${JSON.stringify(idea.inputs)}\nRaw idea: ${idea.idea}\n\nEnhance this idea.` }
        ]);
        const text = (resp.response || '').replace(/```json\n?/g, '').replace(/```/g, '').trim();
        try {
          const enhanced = JSON.parse(text);
          if (enhanced.idea) idea.idea = enhanced.idea;
          if (enhanced.noveltyScore) idea.noveltyScore = enhanced.noveltyScore;
          if (enhanced.usefulness) idea.usefulness = enhanced.usefulness;
        } catch {}
      } catch {}
    }

    // Store
    const ideas = readJSON(IDEAS_PATH, []);
    ideas.push(idea);
    if (ideas.length > 500) ideas.splice(0, ideas.length - 500);
    writeJSON(IDEAS_PATH, ideas);

    // Auto-feed high-scoring ideas to dream proposals (if score > 70)
    if (idea.noveltyScore * idea.usefulness / 100 > 70) {
      idea.autoProposed = true;
    }

    console.log(`[CREATIVITY] 💡 ${idea.method}: "${idea.idea.slice(0, 80)}..." (N:${idea.noveltyScore} U:${idea.usefulness})`);
    return idea;
  }

  _randomCollision() {
    const [a, b] = pickN(CONCEPTS, 2);
    const connections = [
      `What if ${a} and ${b} were combined? Maybe a system that uses ${a} principles to enhance ${b}.`,
      `${a} meets ${b}: imagine a hybrid where the strengths of both create something unexpected.`,
      `Cross-pollination: apply the core pattern of ${a} to solve problems in ${b}.`,
    ];
    return this._makeIdea('random_collision', [a, b], pick(connections));
  }

  _whatIf() {
    const feature = pick(FEATURES);
    const flips = [
      `What if ${feature} did the exact opposite? Instead of building up, it tears down — and that's the feature.`,
      `What if ${feature} was user-controlled instead of automatic? Or vice versa?`,
      `What if ${feature} ran backwards — starting from the output and working to the input?`,
      `What if ${feature} was adversarial — actively trying to break things to make them stronger?`,
      `What if ${feature} was social — multiple users collaborating on it simultaneously?`,
    ];
    return this._makeIdea('what_if', [feature], pick(flips));
  }

  _analogyTransfer() {
    const domain = pick(DOMAINS);
    const concept = pick(CONCEPTS);
    const analogies = [
      `In ${domain}, there's a pattern of gradual adaptation. Apply this to ${concept}: what if it evolved slowly based on usage patterns?`,
      `${domain} uses layered complexity. What if ${concept} had multiple "depth levels" users could explore?`,
      `The ${domain} world has natural feedback mechanisms. Build the same into ${concept} — self-correcting, self-balancing.`,
      `${domain} thrives on competition and cooperation. Make ${concept} competitive: multiple approaches race, best wins.`,
    ];
    return this._makeIdea('analogy_transfer', [domain, concept], pick(analogies));
  }

  _constraintFlip() {
    const limitation = pick(LIMITATIONS);
    const flips = [
      `"${limitation}" — but what if this IS the feature? Lean into it. Make it a selling point.`,
      `Flip: "${limitation}" becomes an advantage if you design around it from the start.`,
      `Embrace "${limitation}" — build a system that's BETTER because of this constraint, not despite it.`,
    ];
    return this._makeIdea('constraint_flip', [limitation], pick(flips));
  }

  _recombination() {
    const parts = pickN([...FEATURES, ...CONCEPTS], 3);
    return this._makeIdea('recombination', parts,
      `Frankenstein idea: Take the trigger mechanism of ${parts[0]}, the processing style of ${parts[1]}, and the output format of ${parts[2]}. Mash them into one system.`
    );
  }

  _makeIdea(method, inputs, idea) {
    return {
      id: uuid(),
      method,
      inputs,
      idea,
      noveltyScore: 30 + Math.floor(Math.random() * 50),
      usefulness: 20 + Math.floor(Math.random() * 60),
      timestamp: Date.now(),
      status: 'raw',
    };
  }

  /**
   * Refine a raw idea using AI.
   */
  async refine(ideaId) {
    const ideas = readJSON(IDEAS_PATH, []);
    const idea = ideas.find(i => i.id === ideaId);
    if (!idea) return { error: 'Idea not found' };

    if (this.ai && typeof this.ai.chat === 'function') {
      try {
        const resp = await this.ai.chat([
          { role: 'system', content: 'You are an idea refiner. Take a raw creative idea and develop it into a concrete, implementable proposal. Include: what it does, how to build it, expected impact. Return JSON: { "refined": "detailed description", "implementation": "how to build", "impact": "expected impact", "noveltyScore": 0-100, "usefulness": 0-100 }' },
          { role: 'user', content: `Raw idea (${idea.method}):\n${idea.idea}\n\nInputs: ${JSON.stringify(idea.inputs)}\n\nRefine this into something concrete and buildable.` }
        ]);
        const text = (resp.response || '').replace(/```json\n?/g, '').replace(/```/g, '').trim();
        const refined = JSON.parse(text);
        idea.refined = refined.refined || refined.idea;
        idea.implementation = refined.implementation;
        idea.impact = refined.impact;
        if (refined.noveltyScore) idea.noveltyScore = refined.noveltyScore;
        if (refined.usefulness) idea.usefulness = refined.usefulness;
        idea.status = 'refined';
        idea.refinedAt = Date.now();
      } catch (e) {
        idea.status = 'refined';
        idea.refined = idea.idea + ' [AI refinement failed: ' + e.message + ']';
        idea.refinedAt = Date.now();
      }
    } else {
      idea.status = 'refined';
      idea.refined = idea.idea + ' [No AI available for refinement]';
      idea.refinedAt = Date.now();
    }

    writeJSON(IDEAS_PATH, ideas);
    return idea;
  }

  /**
   * Browse ideas with optional filters.
   */
  getIdeas(status, method) {
    let ideas = readJSON(IDEAS_PATH, []);
    if (status) ideas = ideas.filter(i => i.status === status);
    if (method) ideas = ideas.filter(i => i.method === method);
    return ideas.slice(-100).reverse();
  }

  /**
   * Get best ideas by combined score.
   */
  getBest(limit) {
    const ideas = readJSON(IDEAS_PATH, []);
    return ideas
      .map(i => ({ ...i, combinedScore: (i.noveltyScore * i.usefulness) / 100 }))
      .sort((a, b) => b.combinedScore - a.combinedScore)
      .slice(0, limit || 10);
  }

  /**
   * Get a random recent shower thought.
   */
  getShowerThought() {
    const ideas = readJSON(IDEAS_PATH, []);
    const recent = ideas.slice(-20);
    if (recent.length === 0) return null;
    return pick(recent);
  }
}

module.exports = CreativityEngine;
