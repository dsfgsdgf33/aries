/**
 * ARIES — Consciousness Fragmentation
 * Deliberate shattering and re-merging of consciousness for complex problem solving.
 * 5 merge strategies, fragment specialization, bandwidth limits, emergency defragmentation.
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

const MERGE_STRATEGIES = ['MAJORITY_VOTE', 'WEIGHTED_AVERAGE', 'SYNTHESIS', 'DEBATE', 'HIERARCHICAL'];

const SPECIALIZATIONS = {
  analytical:  { strengths: ['logic', 'data', 'precision'], weaknesses: ['creativity', 'emotion'] },
  creative:    { strengths: ['novelty', 'association', 'metaphor'], weaknesses: ['precision', 'data'] },
  emotional:   { strengths: ['empathy', 'intuition', 'values'], weaknesses: ['logic', 'data'] },
  critical:    { strengths: ['skepticism', 'risk', 'validation'], weaknesses: ['novelty', 'speed'] },
  integrative: { strengths: ['synthesis', 'connections', 'balance'], weaknesses: ['depth', 'specialization'] },
  pragmatic:   { strengths: ['action', 'feasibility', 'speed'], weaknesses: ['theory', 'depth'] },
};

const DEFAULT_CONFIG = {
  maxFragments: 8,
  maxDepth: 3,
  coherenceDecayRate: 0.01,
  baseCoherence: 1.0,
  conflictWeight: 0.15,
  bandwidthLimit: 3,         // max messages between fragments per tick
  emergencyThreshold: 0.15,  // coherence below this triggers emergency defrag
};

class ConsciousnessFragmentation extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null;
    this.config = Object.assign({}, DEFAULT_CONFIG, opts.config || {});
    ensureDir();
    this._fragments = readJSON(FRAGMENTS_PATH, { active: {}, history: [] });
    this._merges = readJSON(MERGES_PATH, { completed: [], pending: [] });
    this._coherence = readJSON(COHERENCE_PATH, {
      score: this.config.baseCoherence, history: [], lastUpdated: Date.now(),
      bandwidth: { messagesThisTick: 0, totalMessages: 0 },
    });
  }

  _saveFragments() { writeJSON(FRAGMENTS_PATH, this._fragments); }
  _saveMerges() { writeJSON(MERGES_PATH, this._merges); }
  _saveCoherence() { writeJSON(COHERENCE_PATH, this._coherence); }

  /**
   * Fragment consciousness into independent pieces.
   * @param {string} problem
   * @param {number} numFragments
   * @param {object} opts - { depth, parentFragment, specializations: string[] }
   */
  fragment(problem, numFragments = 3, opts = {}) {
    const num = Math.min(numFragments, this.config.maxFragments);
    const depth = (opts.depth || 0);
    if (depth >= this.config.maxDepth) {
      return { error: 'Maximum fragmentation depth reached', maxDepth: this.config.maxDepth };
    }

    // Emergency check
    if (this._coherence.score < this.config.emergencyThreshold) {
      return { error: 'Coherence critically low — cannot fragment. Run emergencyDefragment() first.' };
    }

    const fragmentationId = uuid();
    const requestedSpecs = opts.specializations || [];
    const availableSpecs = Object.keys(SPECIALIZATIONS);
    const fragments = [];

    for (let i = 0; i < num; i++) {
      const spec = requestedSpecs[i] || availableSpecs[i % availableSpecs.length];
      const specDef = SPECIALIZATIONS[spec] || SPECIALIZATIONS.integrative;

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
        specialization: spec,
        strengths: specDef.strengths,
        weaknesses: specDef.weaknesses,
        status: 'active',
        messages: [],       // inter-fragment communication
        messagesSent: 0,
        messagesReceived: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isolationLevel: 0,  // 0=full access, 1=fully isolated
      };
      this._fragments.active[frag.id] = frag;
      fragments.push(frag);
    }

    this._coherence.score = Math.max(0, this._coherence.score - (0.05 * num));
    this._coherence.history.push({ event: 'fragment', fragmentationId, num, depth, timestamp: Date.now() });
    if (this._coherence.history.length > 500) this._coherence.history = this._coherence.history.slice(-500);

    this._saveFragments();
    this._saveCoherence();
    this.emit('fragmentation', { fragmentationId, problem, numFragments: num, depth });

    return {
      fragmentationId,
      fragments: fragments.map(f => ({ id: f.id, index: f.index, specialization: f.specialization, strengths: f.strengths })),
      problem, depth,
      coherenceAfter: Math.round(this._coherence.score * 100) / 100,
    };
  }

  /**
   * Process a fragment — give it conclusions.
   */
  processFragment(fragmentId, aspect, opts = {}) {
    const frag = this._fragments.active[fragmentId];
    if (!frag) return { error: 'Fragment not found or already merged' };

    frag.aspect = aspect;
    frag.perspective = opts.perspective || null;
    frag.conclusions = opts.conclusions || null;
    frag.confidence = Math.max(0, Math.min(1, opts.confidence || 0.5));

    // Specialization bonus: if aspect aligns with strengths, boost confidence
    if (frag.strengths.some(s => (aspect || '').toLowerCase().includes(s))) {
      frag.confidence = Math.min(1, frag.confidence + 0.1);
    }
    if (frag.weaknesses.some(w => (aspect || '').toLowerCase().includes(w))) {
      frag.confidence = Math.max(0, frag.confidence - 0.1);
    }

    frag.status = 'processed';
    frag.updatedAt = Date.now();
    this._saveFragments();
    this.emit('fragment-processed', { fragmentId, aspect, confidence: frag.confidence, specialization: frag.specialization });

    return { fragmentId, aspect, confidence: frag.confidence, specialization: frag.specialization, status: 'processed' };
  }

  /**
   * Send a message between fragments (bandwidth-limited).
   */
  sendMessage(fromId, toId, message) {
    const from = this._fragments.active[fromId];
    const to = this._fragments.active[toId];
    if (!from || !to) return { error: 'Fragment(s) not found' };

    // Bandwidth check
    if (this._coherence.bandwidth.messagesThisTick >= this.config.bandwidthLimit) {
      return { error: 'Bandwidth exhausted this tick', limit: this.config.bandwidthLimit };
    }

    // Isolation check
    if (from.isolationLevel > 0.8 || to.isolationLevel > 0.8) {
      return { error: 'Fragment too isolated for communication' };
    }

    const msg = { from: fromId, to: toId, content: message, timestamp: Date.now() };
    to.messages.push(msg);
    if (to.messages.length > 20) to.messages = to.messages.slice(-20);
    from.messagesSent++;
    to.messagesReceived++;
    this._coherence.bandwidth.messagesThisTick++;
    this._coherence.bandwidth.totalMessages++;

    this._saveFragments();
    this._saveCoherence();
    this.emit('fragment-message', { from: fromId, to: toId });
    return { sent: true, bandwidthRemaining: this.config.bandwidthLimit - this._coherence.bandwidth.messagesThisTick };
  }

  /**
   * Sub-fragment a processed fragment.
   */
  subFragment(fragmentId, numFragments = 2) {
    const parent = this._fragments.active[fragmentId];
    if (!parent) return { error: 'Parent fragment not found' };
    if (parent.status !== 'processed') return { error: 'Fragment must be processed before sub-fragmenting' };

    return this.fragment(parent.aspect || parent.problem, numFragments, {
      depth: parent.depth + 1, parentFragment: fragmentId,
    });
  }

  /**
   * Merge fragments using one of 5 strategies.
   */
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

    const conflicts = this._detectConflicts(fragments);
    const resolution = this._resolve(fragments, conflicts, strategy);

    const mergeId = uuid();
    const merge = {
      id: mergeId, fragmentIds, strategy, conflicts, resolution,
      insights: resolution.insights || [],
      unifiedConclusion: resolution.conclusion,
      coherenceGain: 0, timestamp: Date.now(),
    };

    for (const f of fragments) {
      f.status = 'merged';
      f.mergedInto = mergeId;
      this._fragments.history.push(f);
      delete this._fragments.active[f.id];
    }
    if (this._fragments.history.length > 500) this._fragments.history = this._fragments.history.slice(-500);

    const conflictCost = conflicts.length * this.config.conflictWeight;
    const resolutionBonus = resolution.resolved ? (0.1 * fragments.length) : 0;
    const coherenceGain = resolutionBonus - conflictCost;
    this._coherence.score = Math.max(0, Math.min(this.config.baseCoherence, this._coherence.score + coherenceGain));
    merge.coherenceGain = Math.round(coherenceGain * 100) / 100;
    this._coherence.history.push({ event: 'merge', mergeId, strategy, conflicts: conflicts.length, coherenceGain: merge.coherenceGain, timestamp: Date.now() });

    this._merges.completed.push(merge);
    if (this._merges.completed.length > 200) this._merges.completed = this._merges.completed.slice(-200);

    this._saveFragments();
    this._saveMerges();
    this._saveCoherence();
    this.emit('merge', { mergeId, strategy, conflicts: conflicts.length, insights: merge.insights.length });

    return {
      mergeId, strategy, conflicts, insights: merge.insights,
      unifiedConclusion: merge.unifiedConclusion,
      coherenceAfter: Math.round(this._coherence.score * 100) / 100,
      coherenceGain: merge.coherenceGain,
    };
  }

  /**
   * Emergency defragmentation — force-merge ALL active fragments immediately.
   */
  emergencyDefragment() {
    const activeIds = Object.keys(this._fragments.active);
    if (activeIds.length === 0) return { status: 'nothing-to-defragment', coherence: this._coherence.score };

    this.emit('emergency-defragment', { fragmentCount: activeIds.length });

    // Force all fragments to merged state, recover coherence
    for (const id of activeIds) {
      const f = this._fragments.active[id];
      f.status = 'emergency-merged';
      f.emergencyAt = Date.now();
      this._fragments.history.push(f);
      delete this._fragments.active[id];
    }
    if (this._fragments.history.length > 500) this._fragments.history = this._fragments.history.slice(-500);

    // Major coherence recovery
    this._coherence.score = Math.min(this.config.baseCoherence, this._coherence.score + 0.4);
    this._coherence.history.push({ event: 'emergency-defragment', count: activeIds.length, timestamp: Date.now() });

    const mergeId = uuid();
    this._merges.completed.push({
      id: mergeId, fragmentIds: activeIds, strategy: 'EMERGENCY',
      conflicts: [], resolution: { resolved: true, conclusion: 'Emergency defragmentation — all fragments collapsed', insights: ['Emergency: coherence was critically low'], method: 'EMERGENCY' },
      insights: ['Emergency defragmentation performed'], unifiedConclusion: 'Emergency collapse',
      coherenceGain: 0.4, timestamp: Date.now(),
    });

    this._saveFragments();
    this._saveMerges();
    this._saveCoherence();

    return {
      status: 'defragmented', fragmentsMerged: activeIds.length,
      coherenceAfter: Math.round(this._coherence.score * 100) / 100,
    };
  }

  _detectConflicts(fragments) {
    const conflicts = [];
    const processed = fragments.filter(f => f.conclusions);

    for (let i = 0; i < processed.length; i++) {
      for (let j = i + 1; j < processed.length; j++) {
        const a = processed[i], b = processed[j];
        const confDiff = Math.abs(a.confidence - b.confidence);
        if (confDiff > 0.3) {
          conflicts.push({
            type: 'confidence_divergence', fragments: [a.id, b.id],
            detail: `Fragment ${a.index}[${a.specialization}] (${a.confidence}) vs Fragment ${b.index}[${b.specialization}] (${b.confidence})`,
            severity: confDiff > 0.6 ? 'high' : 'medium',
          });
        }
        if (a.conclusions && b.conclusions && a.aspect !== b.aspect) {
          conflicts.push({
            type: 'perspective_tension', fragments: [a.id, b.id],
            detail: `${a.specialization} vs ${b.specialization} perspectives may conflict`,
            aspectA: a.aspect, aspectB: b.aspect, severity: 'low',
          });
        }
        // Specialization conflict: opposite strengths
        if (a.specialization && b.specialization) {
          const aWeak = new Set(SPECIALIZATIONS[a.specialization]?.weaknesses || []);
          const bStr = SPECIALIZATIONS[b.specialization]?.strengths || [];
          if (bStr.some(s => aWeak.has(s))) {
            conflicts.push({
              type: 'specialization_tension', fragments: [a.id, b.id],
              detail: `${a.specialization}'s weakness is ${b.specialization}'s strength — productive tension`,
              severity: 'creative',
            });
          }
        }
      }
    }
    return conflicts;
  }

  _resolve(fragments, conflicts, strategy) {
    const processed = fragments.filter(f => f.conclusions);
    if (processed.length === 0) return { resolved: false, conclusion: null, insights: [], method: strategy };

    const insights = [];
    let conclusion = null;

    switch (strategy) {
      case 'MAJORITY_VOTE': {
        // Each fragment votes; grouped by similar conclusions, majority wins
        const votes = {};
        for (const f of processed) {
          const key = typeof f.conclusions === 'string' ? f.conclusions.slice(0, 100) : JSON.stringify(f.conclusions).slice(0, 100);
          if (!votes[key]) votes[key] = { conclusions: f.conclusions, voters: [], totalConfidence: 0 };
          votes[key].voters.push(f.index);
          votes[key].totalConfidence += f.confidence;
        }
        const sorted = Object.values(votes).sort((a, b) => b.voters.length - a.voters.length || b.totalConfidence - a.totalConfidence);
        conclusion = { type: 'majority_vote', winner: sorted[0].conclusions, votes: sorted[0].voters.length, total: processed.length, alternatives: sorted.slice(1).length };
        insights.push(`Majority vote: ${sorted[0].voters.length}/${processed.length} fragments agreed`);
        if (sorted.length > 1) insights.push(`${sorted.length - 1} dissenting position(s) recorded`);
        break;
      }
      case 'WEIGHTED_AVERAGE': {
        // Confidence-weighted blend of all conclusions
        const totalConf = processed.reduce((s, f) => s + f.confidence, 0) || 1;
        const weighted = processed.map(f => ({
          fragment: f.index, specialization: f.specialization,
          weight: Math.round((f.confidence / totalConf) * 100) / 100,
          aspect: f.aspect, conclusions: f.conclusions,
        }));
        weighted.sort((a, b) => b.weight - a.weight);
        conclusion = { type: 'weighted_average', weights: weighted, dominantAspect: weighted[0].aspect };
        insights.push(`Weighted average across ${processed.length} fragments, confidence-proportional`);
        insights.push(`Dominant contributor: fragment ${weighted[0].fragment} (${weighted[0].specialization}) at ${weighted[0].weight} weight`);
        break;
      }
      case 'SYNTHESIS': {
        const parts = processed.map(f => ({ aspect: f.aspect, conclusions: f.conclusions, confidence: f.confidence, specialization: f.specialization }));
        conclusion = { type: 'synthesis', parts, combined: true };
        if (conflicts.length > 0) {
          insights.push(`Synthesized ${processed.length} perspectives despite ${conflicts.length} tension(s)`);
          insights.push('Dialectic synthesis: tensions reveal deeper structure');
        }
        insights.push(`Merged ${processed.length} specialized fragment perspectives into unified view`);
        break;
      }
      case 'DEBATE': {
        // Fragments argue in rounds; strongest argument wins
        const rounds = [];
        let remaining = [...processed];
        let round = 0;
        while (remaining.length > 1 && round < 5) {
          const winners = [];
          for (let i = 0; i < remaining.length; i += 2) {
            if (i + 1 >= remaining.length) { winners.push(remaining[i]); continue; }
            const a = remaining[i], b = remaining[i + 1];
            // "Debate" score: confidence + specialization diversity bonus
            const aScore = a.confidence + (a.specialization !== b.specialization ? 0.05 : 0);
            const bScore = b.confidence + (a.specialization !== b.specialization ? 0.05 : 0);
            const winner = aScore >= bScore ? a : b;
            const loser = aScore >= bScore ? b : a;
            winners.push(winner);
            rounds.push({ round, winner: winner.index, loser: loser.index, margin: Math.abs(aScore - bScore) });
          }
          remaining = winners;
          round++;
        }
        const champion = remaining[0];
        conclusion = { type: 'debate', champion: champion.index, specialization: champion.specialization, conclusions: champion.conclusions, rounds, totalRounds: round };
        insights.push(`Debate resolved in ${round} round(s) — fragment ${champion.index} (${champion.specialization}) won`);
        if (rounds.some(r => r.margin < 0.05)) insights.push('Some rounds were extremely close — consider synthesis for richer result');
        break;
      }
      case 'HIERARCHICAL': {
        // Priority: by depth (deeper = more refined), then by specialization match, then index
        const sorted = [...processed].sort((a, b) => {
          if (a.depth !== b.depth) return b.depth - a.depth;
          if (a.confidence !== b.confidence) return b.confidence - a.confidence;
          return a.index - b.index;
        });
        conclusion = {
          type: 'hierarchical', primary: sorted[0].conclusions,
          primarySpec: sorted[0].specialization, aspect: sorted[0].aspect,
          subordinate: sorted.slice(1).map(f => ({ index: f.index, aspect: f.aspect, specialization: f.specialization })),
        };
        insights.push(`Hierarchical: fragment ${sorted[0].index} (${sorted[0].specialization}, depth ${sorted[0].depth}) took authority`);
        insights.push(`${sorted.length - 1} subordinate perspective(s) preserved as context`);
        break;
      }
    }

    return { resolved: true, conclusion, insights, method: strategy };
  }

  getConflicts(mergeId) {
    const merge = this._merges.completed.find(m => m.id === mergeId);
    return merge ? merge.conflicts : { error: 'Merge not found' };
  }

  getInsights(mergeId) {
    const merge = this._merges.completed.find(m => m.id === mergeId);
    return merge ? merge.insights : { error: 'Merge not found' };
  }

  getCoherence() {
    return {
      score: Math.round(this._coherence.score * 100) / 100,
      activeFragments: Object.keys(this._fragments.active).length,
      totalMerges: this._merges.completed.length,
      bandwidth: this._coherence.bandwidth,
      emergencyThreshold: this.config.emergencyThreshold,
      needsEmergency: this._coherence.score < this.config.emergencyThreshold,
      recentHistory: this._coherence.history.slice(-20).reverse(),
    };
  }

  getFragmentHistory() {
    return {
      active: Object.values(this._fragments.active).map(f => ({
        id: f.id, index: f.index, problem: f.problem, aspect: f.aspect,
        confidence: f.confidence, depth: f.depth, status: f.status,
        specialization: f.specialization, messagesSent: f.messagesSent, messagesReceived: f.messagesReceived,
      })),
      completed: this._merges.completed.slice(-20).reverse().map(m => ({
        mergeId: m.id, strategy: m.strategy, conflicts: m.conflicts.length,
        insights: m.insights.length, coherenceGain: m.coherenceGain, timestamp: m.timestamp,
      })),
      totalFragmentations: this._fragments.history.length,
      totalMerges: this._merges.completed.length,
      specializations: SPECIALIZATIONS,
    };
  }

  tick() {
    // Reset bandwidth each tick
    this._coherence.bandwidth.messagesThisTick = 0;

    const activeCount = Object.keys(this._fragments.active).length;
    if (activeCount > 0) {
      const decay = this.config.coherenceDecayRate * activeCount;
      this._coherence.score = Math.max(0, this._coherence.score - decay);
    } else {
      this._coherence.score = Math.min(this.config.baseCoherence, this._coherence.score + 0.005);
    }
    this._coherence.lastUpdated = Date.now();

    // Emergency check
    if (this._coherence.score < this.config.emergencyThreshold && activeCount > 0) {
      this.emit('coherence-critical', { score: this._coherence.score, activeFragments: activeCount });
    }

    // Stale fragment warning
    const now = Date.now();
    const stale = [];
    for (const [id, f] of Object.entries(this._fragments.active)) {
      if (now - f.updatedAt > 300000) stale.push(id);
      // Increase isolation over time
      f.isolationLevel = Math.min(1, (f.isolationLevel || 0) + 0.02);
    }
    if (stale.length > 0) this.emit('stale-fragments', { fragmentIds: stale, count: stale.length });

    this._saveFragments();
    this._saveCoherence();
    const result = { coherence: Math.round(this._coherence.score * 100) / 100, activeFragments: activeCount, staleFragments: stale.length };
    this.emit('tick', result);
    return result;
  }
}

module.exports = ConsciousnessFragmentation;
