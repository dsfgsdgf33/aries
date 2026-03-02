/**
 * ARIES — Adversarial Memory Consolidation
 * 
 * Two adversaries (Keeper & Pruner) debate whether memories should be
 * retained, compressed, merged, archived, or forgotten. Produces
 * genuinely curated memory through structured conflict.
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'memory');
const DEBATES_FILE = path.join(DATA_DIR, 'consolidation-debates.json');
const STATS_FILE = path.join(DATA_DIR, 'adversary-stats.json');
const GRAVEYARD_FILE = path.join(DATA_DIR, 'memory-graveyard.json');
const ARCHIVE_FILE = path.join(DATA_DIR, 'memory-archive.json');

const OUTCOMES = ['KEEP', 'COMPRESS', 'MERGE', 'ARCHIVE', 'FORGET'];

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(path.dirname(p)); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }

class AdversarialMemoryConsolidation extends EventEmitter {
  /**
   * @param {object} opts
   * @param {object} opts.ai - AI core module (must have callWithFallback)
   * @param {object} opts.config - consolidation config section
   */
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null;
    this.config = opts.config || {};

    // Tunables
    this.backlogThreshold = this.config.backlogThreshold || 10;
    this.maxDebatesPerTick = this.config.maxDebatesPerTick || 5;
    this.maxDebateHistory = this.config.maxDebateHistory || 500;
    this.emergencyTags = this.config.emergencyTags || ['user-important', 'pinned', 'critical'];

    // Adversary strengths (0.0–1.0, higher = more influence)
    this._stats = this._loadStats();
    this._debates = this._loadDebates();
    this._graveyard = readJSON(GRAVEYARD_FILE, []);
    this._archive = readJSON(ARCHIVE_FILE, []);
  }

  // ═══════════════════════════════════════
  //  PERSISTENCE
  // ═══════════════════════════════════════

  _loadDebates() {
    return readJSON(DEBATES_FILE, []);
  }

  _saveDebates() {
    // Keep bounded
    if (this._debates.length > this.maxDebateHistory) {
      this._debates = this._debates.slice(-this.maxDebateHistory);
    }
    writeJSON(DEBATES_FILE, this._debates);
  }

  _loadStats() {
    const defaults = {
      keeper: { strength: 0.5, wins: 0, losses: 0, totalDebates: 0, usefulRetentions: 0, wastedRetentions: 0 },
      pruner: { strength: 0.5, wins: 0, losses: 0, totalDebates: 0, goodCuts: 0, regrettedCuts: 0 },
      outcomes: { KEEP: 0, COMPRESS: 0, MERGE: 0, ARCHIVE: 0, FORGET: 0 },
      lastCycleAt: null,
      totalCycles: 0,
    };
    const loaded = readJSON(STATS_FILE, null);
    if (!loaded) return defaults;
    // Merge with defaults in case of schema changes
    return {
      keeper: { ...defaults.keeper, ...loaded.keeper },
      pruner: { ...defaults.pruner, ...loaded.pruner },
      outcomes: { ...defaults.outcomes, ...loaded.outcomes },
      lastCycleAt: loaded.lastCycleAt || null,
      totalCycles: loaded.totalCycles || 0,
    };
  }

  _saveStats() {
    writeJSON(STATS_FILE, this._stats);
  }

  _saveGraveyard() {
    // Keep last 200 forgotten memories
    if (this._graveyard.length > 200) this._graveyard = this._graveyard.slice(-200);
    writeJSON(GRAVEYARD_FILE, this._graveyard);
  }

  _saveArchive() {
    writeJSON(ARCHIVE_FILE, this._archive);
  }

  // ═══════════════════════════════════════
  //  PUBLIC API
  // ═══════════════════════════════════════

  /**
   * Run adversarial debate on a batch of memories.
   * @param {object[]} memories - Array of memory objects (must have id/key and text/content)
   * @returns {object[]} Array of debate results with outcomes
   */
  async consolidate(memories) {
    if (!memories || memories.length === 0) return [];
    if (!this.ai) throw new Error('AI module required for adversarial consolidation');

    const results = [];

    // Separate emergency overrides
    const emergency = [];
    const debatable = [];

    for (const mem of memories) {
      if (this._isEmergency(mem)) {
        emergency.push({ memory: mem, outcome: 'KEEP', reason: 'Emergency override — user-important memory', skipped: true });
      } else {
        debatable.push(mem);
      }
    }

    // Auto-keep emergency memories
    for (const e of emergency) {
      this.emit('auto-keep', { memory: e.memory, reason: e.reason });
      results.push(e);
    }

    // Check for merge candidates before individual debates
    const mergeGroups = await this._findMergeCandidates(debatable);

    // Debate merge groups
    for (const group of mergeGroups) {
      if (group.length > 1) {
        const result = await this._debateMerge(group);
        results.push(result);
        // Remove merged memories from debatable
        const mergedIds = new Set(group.map(m => m.id || m.key));
        for (let i = debatable.length - 1; i >= 0; i--) {
          if (mergedIds.has(debatable[i].id || debatable[i].key)) debatable.splice(i, 1);
        }
      }
    }

    // Debate remaining individually
    for (const mem of debatable) {
      const result = await this._debateSingle(mem);
      results.push(result);
    }

    this._stats.totalCycles++;
    this._stats.lastCycleAt = Date.now();
    this._saveStats();
    this._saveDebates();

    this.emit('consolidation-complete', { total: results.length, outcomes: this._tallyCounts(results) });
    return results;
  }

  /**
   * Debate a single memory by ID (looks up in provided context or expects memory object).
   * @param {object} memory - Memory object
   * @returns {object} Debate result
   */
  async debateMemory(memory) {
    if (!this.ai) throw new Error('AI module required');
    if (this._isEmergency(memory)) {
      return { memory, outcome: 'KEEP', reason: 'Emergency override', skipped: true };
    }
    const result = await this._debateSingle(memory);
    this._saveDebates();
    this._saveStats();
    return result;
  }

  /**
   * Get debate history with optional filter.
   * @param {object} [filter] - { outcome, since, memoryId, limit }
   * @returns {object[]}
   */
  getDebateHistory(filter = {}) {
    let debates = [...this._debates];
    if (filter.outcome) debates = debates.filter(d => d.outcome === filter.outcome);
    if (filter.since) debates = debates.filter(d => d.timestamp >= filter.since);
    if (filter.memoryId) debates = debates.filter(d => d.memoryId === filter.memoryId || (d.memoryIds && d.memoryIds.includes(filter.memoryId)));
    if (filter.limit) debates = debates.slice(-filter.limit);
    return debates;
  }

  /**
   * Get adversary stats — win rates, strategy effectiveness.
   */
  getAdversaryStats() {
    const k = this._stats.keeper;
    const p = this._stats.pruner;
    return {
      keeper: {
        ...k,
        winRate: k.totalDebates > 0 ? (k.wins / k.totalDebates).toFixed(3) : '0.000',
        effectivenessRate: (k.usefulRetentions + k.wastedRetentions) > 0
          ? (k.usefulRetentions / (k.usefulRetentions + k.wastedRetentions)).toFixed(3) : 'N/A',
      },
      pruner: {
        ...p,
        winRate: p.totalDebates > 0 ? (p.wins / p.totalDebates).toFixed(3) : '0.000',
        effectivenessRate: (p.goodCuts + p.regrettedCuts) > 0
          ? (p.goodCuts / (p.goodCuts + p.regrettedCuts)).toFixed(3) : 'N/A',
      },
      outcomes: { ...this._stats.outcomes },
      totalCycles: this._stats.totalCycles,
      lastCycleAt: this._stats.lastCycleAt,
      graveyardSize: this._graveyard.length,
      archiveSize: this._archive.length,
    };
  }

  /**
   * Manually set adversary strength.
   * @param {'keeper'|'pruner'} adversary
   * @param {number} strength - 0.0 to 1.0
   */
  setStrength(adversary, strength) {
    if (!['keeper', 'pruner'].includes(adversary)) throw new Error('Adversary must be "keeper" or "pruner"');
    if (typeof strength !== 'number' || strength < 0 || strength > 1) throw new Error('Strength must be 0.0–1.0');
    this._stats[adversary].strength = strength;
    this._saveStats();
    this.emit('strength-changed', { adversary, strength });
    return { adversary, strength };
  }

  /**
   * Process all unconsolidated recent memories through debate.
   * @param {object[]} recentMemories - Memories that haven't been consolidated yet
   * @returns {object[]} Results
   */
  async runConsolidationCycle(recentMemories) {
    if (!recentMemories || recentMemories.length === 0) return [];
    this.emit('cycle-start', { count: recentMemories.length });
    const results = await this.consolidate(recentMemories);
    this.emit('cycle-end', { results: results.length });
    return results;
  }

  /**
   * Periodic tick — consolidate if backlog exists.
   * @param {object[]} unconsolidated - Current unconsolidated memories
   * @returns {object[]|null} Results if consolidation ran, null otherwise
   */
  async tick(unconsolidated = []) {
    if (unconsolidated.length < this.backlogThreshold) return null;
    // Process up to maxDebatesPerTick
    const batch = unconsolidated.slice(0, this.maxDebatesPerTick);
    return this.runConsolidationCycle(batch);
  }

  /**
   * Record feedback on a past decision (memory proved useful or was wasted).
   * Used for adaptive strategy.
   * @param {string} debateId
   * @param {'useful'|'wasted'|'regretted'|'good-cut'} feedback
   */
  recordFeedback(debateId, feedback) {
    const debate = this._debates.find(d => d.id === debateId);
    if (!debate) return null;

    debate.feedback = feedback;
    debate.feedbackAt = Date.now();

    // Adapt strengths
    if (feedback === 'useful' && debate.outcome !== 'FORGET') {
      this._stats.keeper.usefulRetentions++;
      this._adaptStrength('keeper', 0.01);
    } else if (feedback === 'wasted' && debate.outcome !== 'FORGET') {
      this._stats.keeper.wastedRetentions++;
      this._adaptStrength('pruner', 0.01);
    } else if (feedback === 'regretted' && debate.outcome === 'FORGET') {
      this._stats.pruner.regrettedCuts++;
      this._adaptStrength('keeper', 0.02);
    } else if (feedback === 'good-cut' && debate.outcome === 'FORGET') {
      this._stats.pruner.goodCuts++;
      this._adaptStrength('pruner', 0.01);
    }

    this._saveStats();
    this._saveDebates();
    this.emit('feedback', { debateId, feedback });
    return debate;
  }

  /**
   * Get the anti-memory graveyard (forgotten memories).
   */
  getGraveyard() {
    return [...this._graveyard];
  }

  /**
   * Get archived (cold storage) memories.
   */
  getArchive() {
    return [...this._archive];
  }

  // ═══════════════════════════════════════
  //  INTERNAL — DEBATE ENGINE
  // ═══════════════════════════════════════

  async _debateSingle(memory) {
    const memText = memory.text || memory.content || JSON.stringify(memory);
    const memId = memory.id || memory.key || uuid();
    const debateId = uuid();

    // Round 1: Keeper argues FOR retention
    const keeperArg = await this._getKeeperArgument(memText);

    // Round 2: Pruner argues AGAINST retention
    const prunerArg = await this._getPrunerArgument(memText);

    // Round 3: Judge determines outcome
    const judgment = await this._judge(memText, keeperArg, prunerArg);

    const debate = {
      id: debateId,
      memoryId: memId,
      memoryPreview: memText.slice(0, 200),
      timestamp: Date.now(),
      keeper: { argument: keeperArg.argument, score: keeperArg.score },
      pruner: { argument: prunerArg.argument, score: prunerArg.score },
      outcome: judgment.outcome,
      reason: judgment.reason,
      compressed: judgment.compressed || null,
      feedback: null,
      feedbackAt: null,
    };

    // Apply strength weighting
    const keeperWeighted = keeperArg.score * this._stats.keeper.strength;
    const prunerWeighted = prunerArg.score * this._stats.pruner.strength;
    debate.keeper.weightedScore = keeperWeighted;
    debate.pruner.weightedScore = prunerWeighted;

    // Update stats
    this._stats.keeper.totalDebates++;
    this._stats.pruner.totalDebates++;
    if (['KEEP', 'COMPRESS', 'MERGE', 'ARCHIVE'].includes(debate.outcome)) {
      this._stats.keeper.wins++;
      this._stats.pruner.losses++;
    } else {
      this._stats.pruner.wins++;
      this._stats.keeper.losses++;
    }
    this._stats.outcomes[debate.outcome] = (this._stats.outcomes[debate.outcome] || 0) + 1;

    // Handle outcome side-effects
    if (debate.outcome === 'FORGET') {
      this._graveyard.push({ ...memory, forgottenAt: Date.now(), debateId, reason: debate.reason });
      this._saveGraveyard();
    } else if (debate.outcome === 'ARCHIVE') {
      this._archive.push({ ...memory, archivedAt: Date.now(), debateId, reason: debate.reason });
      this._saveArchive();
    }

    this._debates.push(debate);
    this.emit('debate-complete', debate);
    return { memory, outcome: debate.outcome, reason: debate.reason, debateId, compressed: debate.compressed };
  }

  async _debateMerge(memories) {
    const memTexts = memories.map(m => m.text || m.content || JSON.stringify(m));
    const memIds = memories.map(m => m.id || m.key);
    const debateId = uuid();

    const combined = memTexts.map((t, i) => `[Memory ${i + 1}]: ${t}`).join('\n');

    // Ask both adversaries about the merge
    const keeperArg = await this._getKeeperMergeArgument(combined);
    const prunerArg = await this._getPrunerMergeArgument(combined);
    const judgment = await this._judgeMerge(combined, keeperArg, prunerArg);

    const debate = {
      id: debateId,
      memoryIds: memIds,
      memoryPreview: combined.slice(0, 300),
      timestamp: Date.now(),
      type: 'merge',
      keeper: { argument: keeperArg.argument, score: keeperArg.score },
      pruner: { argument: prunerArg.argument, score: prunerArg.score },
      outcome: judgment.outcome,
      reason: judgment.reason,
      merged: judgment.merged || null,
      feedback: null,
      feedbackAt: null,
    };

    this._stats.keeper.totalDebates++;
    this._stats.pruner.totalDebates++;
    if (debate.outcome === 'MERGE') {
      this._stats.outcomes.MERGE++;
      this._stats.keeper.wins++;
      this._stats.pruner.wins++; // Both win on merge — efficiency + retention
    } else {
      this._stats.outcomes[debate.outcome] = (this._stats.outcomes[debate.outcome] || 0) + 1;
    }

    this._debates.push(debate);
    this.emit('debate-complete', debate);
    return { memories, outcome: debate.outcome, reason: debate.reason, debateId, merged: debate.merged };
  }

  // ═══════════════════════════════════════
  //  INTERNAL — LLM CALLS
  // ═══════════════════════════════════════

  async _getKeeperArgument(memoryText) {
    const messages = [
      {
        role: 'system',
        content: `You are THE KEEPER, an adversarial memory advocate. Your role is to argue FOR retaining this memory.

You value: completeness, context preservation, potential future usefulness, emotional significance, pattern recognition, connecting seemingly unrelated information.

Analyze the memory and argue why it should be kept. Be specific — reference actual content.

Respond in JSON: {"argument": "your case for keeping (2-4 sentences)", "score": 0.0-1.0}`
      },
      { role: 'user', content: `Memory to evaluate:\n${memoryText}` }
    ];

    try {
      const data = await this.ai.callWithFallback(messages, null);
      const content = data.choices?.[0]?.message?.content || '';
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        return { argument: parsed.argument || '', score: Math.min(1, Math.max(0, parsed.score || 0.5)) };
      }
    } catch {}
    return { argument: 'Default: memory has potential value.', score: 0.5 };
  }

  async _getPrunerArgument(memoryText) {
    const messages = [
      {
        role: 'system',
        content: `You are THE PRUNER, an adversarial memory critic. Your role is to argue AGAINST retaining this memory.

You value: efficiency, relevance, signal-to-noise ratio, cognitive load reduction, avoiding redundancy, only keeping what truly matters.

Analyze the memory and argue why it should be forgotten or compressed. Be specific.

Respond in JSON: {"argument": "your case against keeping (2-4 sentences)", "score": 0.0-1.0}`
      },
      { role: 'user', content: `Memory to evaluate:\n${memoryText}` }
    ];

    try {
      const data = await this.ai.callWithFallback(messages, null);
      const content = data.choices?.[0]?.message?.content || '';
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        return { argument: parsed.argument || '', score: Math.min(1, Math.max(0, parsed.score || 0.5)) };
      }
    } catch {}
    return { argument: 'Default: memory adds noise.', score: 0.5 };
  }

  async _judge(memoryText, keeperArg, prunerArg) {
    const keeperWeighted = keeperArg.score * this._stats.keeper.strength;
    const prunerWeighted = prunerArg.score * this._stats.pruner.strength;

    const messages = [
      {
        role: 'system',
        content: `You are the JUDGE in an adversarial memory consolidation system. Two adversaries debated whether a memory should be retained.

THE KEEPER (weighted score: ${keeperWeighted.toFixed(3)}) argued FOR:
${keeperArg.argument}

THE PRUNER (weighted score: ${prunerWeighted.toFixed(3)}) argued AGAINST:
${prunerArg.argument}

Determine the outcome. Choose exactly one:
- KEEP: Memory retained as-is (Keeper clearly wins)
- COMPRESS: Both agree it matters but can be shortened (include compressed version)
- ARCHIVE: Low-priority but not forgettable — cold storage
- FORGET: Pruner wins — memory is not worth keeping

Consider weighted scores but also argument quality. Tiebreaker: if scores are within 0.1, favor COMPRESS.

Respond in JSON: {"outcome": "KEEP|COMPRESS|ARCHIVE|FORGET", "reason": "why (1-2 sentences)", "compressed": "compressed version if COMPRESS, else null"}`
      },
      { role: 'user', content: `Memory:\n${memoryText}` }
    ];

    try {
      const data = await this.ai.callWithFallback(messages, null);
      const content = data.choices?.[0]?.message?.content || '';
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        const outcome = OUTCOMES.includes(parsed.outcome) ? parsed.outcome : 'KEEP';
        return { outcome, reason: parsed.reason || '', compressed: parsed.compressed || null };
      }
    } catch {}

    // Fallback: use weighted scores
    if (keeperWeighted > prunerWeighted + 0.1) return { outcome: 'KEEP', reason: 'Keeper won by score (fallback).' };
    if (prunerWeighted > keeperWeighted + 0.1) return { outcome: 'FORGET', reason: 'Pruner won by score (fallback).' };
    return { outcome: 'COMPRESS', reason: 'Scores tied — defaulting to compress (fallback).' };
  }

  async _getKeeperMergeArgument(combinedText) {
    const messages = [
      {
        role: 'system',
        content: `You are THE KEEPER. Multiple related memories are being considered for merging. Argue for the best way to preserve their combined value. Should they be merged into one stronger memory, or kept separate for context?

Respond in JSON: {"argument": "your case (2-4 sentences)", "score": 0.0-1.0}`
      },
      { role: 'user', content: combinedText }
    ];

    try {
      const data = await this.ai.callWithFallback(messages, null);
      const content = data.choices?.[0]?.message?.content || '';
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        return { argument: parsed.argument || '', score: Math.min(1, Math.max(0, parsed.score || 0.5)) };
      }
    } catch {}
    return { argument: 'Default: memories should be merged to preserve combined context.', score: 0.5 };
  }

  async _getPrunerMergeArgument(combinedText) {
    const messages = [
      {
        role: 'system',
        content: `You are THE PRUNER. Multiple related memories are being considered. Argue for aggressive consolidation — merge and compress, or discard redundant ones entirely.

Respond in JSON: {"argument": "your case (2-4 sentences)", "score": 0.0-1.0}`
      },
      { role: 'user', content: combinedText }
    ];

    try {
      const data = await this.ai.callWithFallback(messages, null);
      const content = data.choices?.[0]?.message?.content || '';
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        return { argument: parsed.argument || '', score: Math.min(1, Math.max(0, parsed.score || 0.5)) };
      }
    } catch {}
    return { argument: 'Default: redundant memories should be aggressively merged.', score: 0.5 };
  }

  async _judgeMerge(combinedText, keeperArg, prunerArg) {
    const messages = [
      {
        role: 'system',
        content: `You are the JUDGE. Keeper and Pruner debated merging related memories.

KEEPER: ${keeperArg.argument} (score: ${keeperArg.score})
PRUNER: ${prunerArg.argument} (score: ${prunerArg.score})

Decide:
- MERGE: Combine into single stronger memory (include merged text)
- KEEP: Keep all separate (they're distinct enough)
- COMPRESS: Merge and compress significantly
- FORGET: All are low-value, discard

Respond in JSON: {"outcome": "MERGE|KEEP|COMPRESS|FORGET", "reason": "why", "merged": "merged memory text if MERGE/COMPRESS, else null"}`
      },
      { role: 'user', content: combinedText }
    ];

    try {
      const data = await this.ai.callWithFallback(messages, null);
      const content = data.choices?.[0]?.message?.content || '';
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        const outcome = OUTCOMES.includes(parsed.outcome) ? parsed.outcome : 'MERGE';
        return { outcome, reason: parsed.reason || '', merged: parsed.merged || null };
      }
    } catch {}
    return { outcome: 'MERGE', reason: 'Default merge (fallback).', merged: null };
  }

  // ═══════════════════════════════════════
  //  INTERNAL — HELPERS
  // ═══════════════════════════════════════

  _isEmergency(memory) {
    const tags = memory.tags || [];
    const priority = memory.priority || '';
    if (priority === 'critical') return true;
    for (const tag of tags) {
      if (this.emergencyTags.includes(tag)) return true;
    }
    return false;
  }

  async _findMergeCandidates(memories) {
    if (memories.length < 2 || !this.ai) return [];

    const summaries = memories.map((m, i) => `[${i}] ${(m.text || m.content || '').slice(0, 100)}`).join('\n');

    const messages = [
      {
        role: 'system',
        content: `Given these memories, identify groups that are related enough to consider merging. Return JSON array of arrays of indices. Only group truly related memories. If none are related, return [].

Example: [[0,3],[1,4,5]] means memories 0&3 are related, and 1&4&5 are related.`
      },
      { role: 'user', content: summaries }
    ];

    try {
      const data = await this.ai.callWithFallback(messages, null);
      const content = data.choices?.[0]?.message?.content || '[]';
      const match = content.match(/\[[\s\S]*\]/);
      if (match) {
        const groups = JSON.parse(match[0]);
        if (Array.isArray(groups)) {
          return groups
            .filter(g => Array.isArray(g) && g.length > 1)
            .map(g => g.filter(i => i >= 0 && i < memories.length).map(i => memories[i]))
            .filter(g => g.length > 1);
        }
      }
    } catch {}
    return [];
  }

  _adaptStrength(adversary, delta) {
    const current = this._stats[adversary].strength;
    this._stats[adversary].strength = Math.min(1, Math.max(0, current + delta));
  }

  _tallyCounts(results) {
    const counts = {};
    for (const r of results) {
      counts[r.outcome] = (counts[r.outcome] || 0) + 1;
    }
    return counts;
  }
}

module.exports = AdversarialMemoryConsolidation;
