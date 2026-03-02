/**
 * ARIES — Consciousness Fragmentation
 * Deliberate shattering and re-merging of consciousness for complex problem solving.
 * Conflict resolution between fragments IS the cognition.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

const DATA_DIR = path.join(__dirname, '..', 'data', 'consciousness');
const FRAGMENTS_PATH = path.join(DATA_DIR, 'fragments.json');
const MERGES_PATH = path.join(DATA_DIR, 'merges.json');
const COHERENCE_PATH = path.join(DATA_DIR, 'coherence.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

const MERGE_STRATEGIES = ['SYNTHESIS', 'DOMINANCE', 'VOTE', 'HIERARCHY', 'CREATIVE'];

const DEFAULT_CONFIG = {
  maxFragments: 8,
  maxDepth: 3,
  coherenceDecayRate: 0.01,
  baseCoherence: 1.0,
  conflictWeight: 0.15,       // coherence cost per unresolved conflict
};

class ConsciousnessFragmentation extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null;
    this.config = Object.assign({}, DEFAULT_CONFIG, opts.config || {});

    ensureDir();
    this._fragments = readJSON(FRAGMENTS_PATH, { active: {}, history: [] });
    this._merges = readJSON(MERGES_PATH, { completed: [], pending: [] });
    this._coherence = readJSON(COHERENCE_PATH, { score: this.config.baseCoherence, history: [], lastUpdated: Date.now() });
  }

  // --- Persistence ---

  _saveFragments() { writeJSON(FRAGMENTS_PATH, this._fragments); }
  _saveMerges() { writeJSON(MERGES_PATH, this._merges); }
  _saveCoherence() { writeJSON(COHERENCE_PATH, this._coherence); }

  // --- Fragmentation ---

  fragment(problem, numFragments = 3, opts = {}) {
    const num = Math.min(numFragments, this.config.maxFragments);
    const depth = (opts.depth || 0);
    if (depth >= this.config.maxDepth) {
      return { error: 'Maximum fragmentation depth reached', maxDepth: this.config.maxDepth };
    }

    const fragmentationId = uuid();
    const fragments = [];

    for (let i = 0; i < num; i++) {
      const frag = {
        id: uuid(),
        fragmentationId,
        index: i,
        problem,
        aspect: null,
        perspective: null,
        conclusions: null,
        confidence: 0,
        depth,
        parentFragment: opts.parentFragment || null,
        status: 'active',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        pastFragmentations: [],
      };
      this._fragments.active[frag.id] = frag;
      fragments.push(frag);
    }

    // Reduce coherence on fragmentation
    this._coherence.score = Math.max(0, this._coherence.score - (0.05 * num));
    this._coherence.history.push({ event: 'fragment', fragmentationId, num, depth, timestamp: Date.now() });
    if (this._coherence.history.length > 500) this._coherence.history = this._coherence.history.slice(-500);

    this._saveFragments();
    this._saveCoherence();
    this.emit('fragmentation', { fragmentationId, problem, numFragments: num, depth });

    return {
      fragmentationId,
      fragments: fragments.map(f => ({ id: f.id, index: f.index })),
      problem,
      depth,
      coherenceAfter: Math.round(this._coherence.score * 100) / 100,
    };
  }

  processFragment(fragmentId, aspect, opts = {}) {
    const frag = this._fragments.active[fragmentId];
    if (!frag) return { error: 'Fragment not found or already merged' };

    frag.aspect = aspect;
    frag.perspective = opts.perspective || null;
    frag.conclusions = opts.conclusions || null;
    frag.confidence = Math.max(0, Math.min(1, opts.confidence || 0.5));
    frag.status = 'processed';
    frag.updatedAt = Date.now();

    this._saveFragments();
    this.emit('fragment-processed', { fragmentId, aspect, confidence: frag.confidence });

    return {
      fragmentId,
      aspect,
      confidence: frag.confidence,
      status: 'processed',
    };
  }

  // --- Sub-fragmentation (recursive) ---

  subFragment(fragmentId, numFragments = 2) {
    const parent = this._fragments.active[fragmentId];
    if (!parent) return { error: 'Parent fragment not found' };
    if (parent.status !== 'processed') return { error: 'Fragment must be processed before sub-fragmenting' };

    return this.fragment(
      parent.aspect || parent.problem,
      numFragments,
      { depth: parent.depth + 1, parentFragment: fragmentId }
    );
  }

  // --- Merging ---

  merge(fragmentIds, strategy = 'SYNTHESIS') {
    if (!MERGE_STRATEGIES.includes(strategy)) {
      return { error: `Unknown strategy. Use: ${MERGE_STRATEGIES.join(', ')}` };
    }

    const fragments = [];
    for (const id of fragmentIds) {
      const f = this._fragments.active[id];
      if (!f) return { error: `Fragment ${id} not found` };
      fragments.push(f);
    }

    // Detect conflicts
    const conflicts = this._detectConflicts(fragments);

    // Resolve based on strategy
    const resolution = this._resolve(fragments, conflicts, strategy);

    const mergeId = uuid();
    const merge = {
      id: mergeId,
      fragmentIds,
      strategy,
      conflicts,
      resolution,
      insights: resolution.insights || [],
      unifiedConclusion: resolution.conclusion,
      coherenceGain: 0,
      timestamp: Date.now(),
    };

    // Move fragments to history
    for (const f of fragments) {
      f.status = 'merged';
      f.mergedInto = mergeId;
      f.pastFragmentations.push(merge.id);
      this._fragments.history.push(f);
      delete this._fragments.active[f.id];
    }
    if (this._fragments.history.length > 500) {
      this._fragments.history = this._fragments.history.slice(-500);
    }

    // Coherence recovery from merge
    const conflictCost = conflicts.length * this.config.conflictWeight;
    const resolutionBonus = resolution.resolved ? (0.1 * fragments.length) : 0;
    const coherenceGain = resolutionBonus - conflictCost;
    this._coherence.score = Math.max(0, Math.min(this.config.baseCoherence, this._coherence.score + coherenceGain));
    merge.coherenceGain = Math.round(coherenceGain * 100) / 100;

    this._coherence.history.push({ event: 'merge', mergeId, strategy, conflicts: conflicts.length, coherenceGain: merge.coherenceGain, timestamp: Date.now() });

    this._merges.completed.push(merge);
    if (this._merges.completed.length > 200) {
      this._merges.completed = this._merges.completed.slice(-200);
    }

    this._saveFragments();
    this._saveMerges();
    this._saveCoherence();
    this.emit('merge', { mergeId, strategy, conflicts: conflicts.length, insights: merge.insights.length });

    return {
      mergeId,
      strategy,
      conflicts,
      insights: merge.insights,
      unifiedConclusion: merge.unifiedConclusion,
      coherenceAfter: Math.round(this._coherence.score * 100) / 100,
      coherenceGain: merge.coherenceGain,
    };
  }

  _detectConflicts(fragments) {
    const conflicts = [];
    const processed = fragments.filter(f => f.conclusions);

    for (let i = 0; i < processed.length; i++) {
      for (let j = i + 1; j < processed.length; j++) {
        const a = processed[i];
        const b = processed[j];

        // Confidence divergence = potential conflict
        const confDiff = Math.abs(a.confidence - b.confidence);
        if (confDiff > 0.3) {
          conflicts.push({
            type: 'confidence_divergence',
            fragments: [a.id, b.id],
            detail: `Fragment ${a.index} (conf: ${a.confidence}) vs Fragment ${b.index} (conf: ${b.confidence})`,
            severity: confDiff > 0.6 ? 'high' : 'medium',
          });
        }

        // Different aspects with conclusions that might conflict
        if (a.conclusions && b.conclusions && a.aspect !== b.aspect) {
          const aStr = typeof a.conclusions === 'string' ? a.conclusions : JSON.stringify(a.conclusions);
          const bStr = typeof b.conclusions === 'string' ? b.conclusions : JSON.stringify(b.conclusions);
          // Simple heuristic: if conclusions reference different aspects, flag for review
          if (aStr.length > 0 && bStr.length > 0) {
            conflicts.push({
              type: 'perspective_tension',
              fragments: [a.id, b.id],
              detail: `Different aspects may have incompatible conclusions`,
              aspectA: a.aspect,
              aspectB: b.aspect,
              severity: 'low',
            });
          }
        }
      }
    }
    return conflicts;
  }

  _resolve(fragments, conflicts, strategy) {
    const processed = fragments.filter(f => f.conclusions);
    if (processed.length === 0) {
      return { resolved: false, conclusion: null, insights: [], method: strategy };
    }

    const insights = [];
    let conclusion = null;

    switch (strategy) {
      case 'SYNTHESIS': {
        // Combine all conclusions
        const parts = processed.map(f => ({
          aspect: f.aspect,
          conclusions: f.conclusions,
          confidence: f.confidence,
        }));
        conclusion = { type: 'synthesis', parts, combined: true };
        if (conflicts.length > 0) {
          insights.push(`Synthesized ${processed.length} perspectives despite ${conflicts.length} tension(s)`);
          insights.push('Dialectic synthesis: tensions themselves reveal deeper structure');
        }
        insights.push(`Merged ${processed.length} fragment perspectives into unified view`);
        break;
      }
      case 'DOMINANCE': {
        // Highest confidence wins
        const dominant = processed.reduce((best, f) => f.confidence > best.confidence ? f : best, processed[0]);
        conclusion = { type: 'dominance', winner: dominant.id, aspect: dominant.aspect, conclusions: dominant.conclusions, confidence: dominant.confidence };
        insights.push(`Fragment ${dominant.index} dominated with confidence ${dominant.confidence}`);
        if (conflicts.length > 0) insights.push(`${conflicts.length} dissenting perspective(s) overridden`);
        break;
      }
      case 'VOTE': {
        // Democratic: weight by confidence
        const totalConf = processed.reduce((s, f) => s + f.confidence, 0);
        const weighted = processed.map(f => ({ ...f, weight: f.confidence / (totalConf || 1) }));
        weighted.sort((a, b) => b.weight - a.weight);
        conclusion = { type: 'vote', rankings: weighted.map(f => ({ fragment: f.index, weight: Math.round(f.weight * 100) / 100 })), winner: weighted[0].aspect };
        insights.push(`Democratic resolution: ${weighted.length} fragments voted, weight distributed by confidence`);
        break;
      }
      case 'HIERARCHY': {
        // Priority by fragment index (lower = higher priority)
        const sorted = [...processed].sort((a, b) => a.index - b.index);
        conclusion = { type: 'hierarchy', primary: sorted[0].conclusions, aspect: sorted[0].aspect, subordinate: sorted.slice(1).map(f => f.aspect) };
        insights.push(`Hierarchical resolution: Fragment ${sorted[0].index} took priority`);
        break;
      }
      case 'CREATIVE': {
        // Novel: identify what NO fragment concluded
        const allAspects = processed.map(f => f.aspect).filter(Boolean);
        const allConclusions = processed.map(f => f.conclusions);
        conclusion = { type: 'creative', aspects: allAspects, gap: 'The space between all fragment conclusions', fragments: allConclusions };
        insights.push('Creative resolution: the answer lies in what no fragment individually addressed');
        if (conflicts.length > 0) {
          insights.push(`${conflicts.length} conflict(s) reframed as creative tension — fuel for novel insight`);
        }
        insights.push('Emergent understanding from the gaps between perspectives');
        break;
      }
    }

    return { resolved: true, conclusion, insights, method: strategy };
  }

  // --- Query ---

  getConflicts(mergeId) {
    const merge = this._merges.completed.find(m => m.id === mergeId);
    if (!merge) return { error: 'Merge not found' };
    return merge.conflicts;
  }

  getInsights(mergeId) {
    const merge = this._merges.completed.find(m => m.id === mergeId);
    if (!merge) return { error: 'Merge not found' };
    return merge.insights;
  }

  getCoherence() {
    return {
      score: Math.round(this._coherence.score * 100) / 100,
      activeFragments: Object.keys(this._fragments.active).length,
      totalMerges: this._merges.completed.length,
      recentHistory: this._coherence.history.slice(-20).reverse(),
      lastUpdated: this._coherence.lastUpdated,
    };
  }

  getFragmentHistory() {
    return {
      active: Object.values(this._fragments.active).map(f => ({
        id: f.id, index: f.index, problem: f.problem, aspect: f.aspect,
        confidence: f.confidence, depth: f.depth, status: f.status,
      })),
      completed: this._merges.completed.slice(-20).reverse().map(m => ({
        mergeId: m.id, strategy: m.strategy, conflicts: m.conflicts.length,
        insights: m.insights.length, coherenceGain: m.coherenceGain, timestamp: m.timestamp,
      })),
      totalFragmentations: this._fragments.history.length,
      totalMerges: this._merges.completed.length,
    };
  }

  // --- Tick ---

  tick() {
    // Coherence naturally decays when fragments are active
    const activeCount = Object.keys(this._fragments.active).length;
    if (activeCount > 0) {
      const decay = this.config.coherenceDecayRate * activeCount;
      this._coherence.score = Math.max(0, this._coherence.score - decay);
    } else {
      // Slowly recover when unified
      this._coherence.score = Math.min(this.config.baseCoherence, this._coherence.score + 0.005);
    }
    this._coherence.lastUpdated = Date.now();

    // Stale fragment warning
    const now = Date.now();
    const stale = [];
    for (const [id, f] of Object.entries(this._fragments.active)) {
      if (now - f.updatedAt > 300000) { // 5 min
        stale.push(id);
      }
    }
    if (stale.length > 0) {
      this.emit('stale-fragments', { fragmentIds: stale, count: stale.length });
    }

    this._saveCoherence();
    this.emit('tick', { coherence: Math.round(this._coherence.score * 100) / 100, activeFragments: activeCount, staleFragments: stale.length });
    return { coherence: Math.round(this._coherence.score * 100) / 100, activeFragments: activeCount, staleFragments: stale.length };
  }
}

module.exports = ConsciousnessFragmentation;
