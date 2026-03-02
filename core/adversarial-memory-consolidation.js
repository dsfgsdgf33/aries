/**
 * ARIES — Adversarial Memory Consolidation
 * 
 * Two adversaries (Keeper & Pruner) debate whether memories should be
 * retained, compressed, merged, archived, or forgotten. Produces
 * genuinely curated memory through structured conflict.
 * 
 * Features: 5 outcomes, adaptive strength, multi-angle importance scoring,
 * configurable consolidation frequency, merge detection, archive tier,
 * debate history pattern analysis.
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
const PATTERNS_FILE = path.join(DATA_DIR, 'debate-patterns.json');

const OUTCOMES = ['KEEP', 'COMPRESS', 'MERGE', 'ARCHIVE', 'FORGET'];

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(path.dirname(p)); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }

// Importance dimensions for multi-angle scoring
const IMPORTANCE_DIMENSIONS = [
  'emotional',    // emotional weight
  'practical',    // practical utility
  'connective',   // connects to other memories
  'temporal',     // time-sensitive relevance
  'identity',     // core to identity/personality
  'novelty',      // unique information
];

class AdversarialMemoryConsolidation extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null;
    this.config = opts.config || {};

    this.backlogThreshold = this.config.backlogThreshold || 10;
    this.maxDebatesPerTick = this.config.maxDebatesPerTick || 5;
    this.maxDebateHistory = this.config.maxDebateHistory || 500;
    this.emergencyTags = this.config.emergencyTags || ['user-important', 'pinned', 'critical'];
    this.consolidationIntervalMs = this.config.consolidationIntervalMs || 6 * 3600 * 1000; // 6 hours
    this.adaptationRate = this.config.adaptationRate || 0.02;
    this.winRateEquilibrium = this.config.winRateEquilibrium || 0.5; // target 50/50

    this._stats = this._loadStats();
    this._debates = this._loadDebates();
    this._graveyard = readJSON(GRAVEYARD_FILE, []);
    this._archive = readJSON(ARCHIVE_FILE, []);
  }

  // ═══════════════════════════════════════
  //  PERSISTENCE
  // ═══════════════════════════════════════

  _loadDebates() { return readJSON(DEBATES_FILE, []); }
  _saveDebates() {
    if (this._debates.length > this.maxDebateHistory) this._debates = this._debates.slice(-this.maxDebateHistory);
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
    return {
      keeper: { ...defaults.keeper, ...loaded.keeper },
      pruner: { ...defaults.pruner, ...loaded.pruner },
      outcomes: { ...defaults.outcomes, ...loaded.outcomes },
      lastCycleAt: loaded.lastCycleAt || null,
      totalCycles: loaded.totalCycles || 0,
    };
  }

  _saveStats() { writeJSON(STATS_FILE, this._stats); }
  _saveGraveyard() {
    if (this._graveyard.length > 200) this._graveyard = this._graveyard.slice(-200);
    writeJSON(GRAVEYARD_FILE, this._graveyard);
  }
  _saveArchive() { writeJSON(ARCHIVE_FILE, this._archive); }

  // ═══════════════════════════════════════
  //  ADAPTIVE STRENGTH
  // ═══════════════════════════════════════

  /**
   * Auto-balance adversary strengths toward equilibrium.
   * If Keeper wins too much, Pruner gets stronger (and vice versa).
   */
  _autoAdaptStrength() {
    const k = this._stats.keeper;
    const p = this._stats.pruner;
    if (k.totalDebates < 5) return; // need enough data

    const keeperWinRate = k.wins / k.totalDebates;
    const drift = keeperWinRate - this.winRateEquilibrium;
    const rate = this.adaptationRate;

    if (Math.abs(drift) > 0.05) {
      // Keeper winning too much → strengthen Pruner
      if (drift > 0) {
        this._stats.pruner.strength = Math.min(1, p.strength + rate * Math.abs(drift));
        this._stats.keeper.strength = Math.max(0, k.strength - rate * Math.abs(drift) * 0.5);
      } else {
        this._stats.keeper.strength = Math.min(1, k.strength + rate * Math.abs(drift));
        this._stats.pruner.strength = Math.max(0, p.strength - rate * Math.abs(drift) * 0.5);
      }
    }
  }

  // ═══════════════════════════════════════
  //  MULTI-ANGLE IMPORTANCE SCORING
  // ═══════════════════════════════════════

  /**
   * Score a memory's importance across multiple dimensions.
   */
  async scoreImportance(memory) {
    const memText = memory.text || memory.content || JSON.stringify(memory);
    if (!this.ai) {
      return IMPORTANCE_DIMENSIONS.reduce((acc, dim) => { acc[dim] = 0.5; return acc; }, { overall: 0.5 });
    }

    try {
      const messages = [{
        role: 'system',
        content: `Score this memory on each importance dimension (0.0-1.0):
- emotional: emotional weight/significance
- practical: real-world utility
- connective: links to other knowledge
- temporal: time-sensitive relevance
- identity: core to personality/identity
- novelty: unique, hard-to-reconstruct information

Return JSON: {"emotional":0.0,"practical":0.0,"connective":0.0,"temporal":0.0,"identity":0.0,"novelty":0.0}`
      }, { role: 'user', content: `Memory: ${memText.slice(0, 500)}` }];

      const data = await this.ai.callWithFallback(messages, null);
      const content = data.choices?.[0]?.message?.content || '';
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        const scores = JSON.parse(match[0]);
        const values = IMPORTANCE_DIMENSIONS.map(d => Math.max(0, Math.min(1, scores[d] || 0.5)));
        scores.overall = Math.round(values.reduce((a, b) => a + b, 0) / values.length * 1000) / 1000;
        return scores;
      }
    } catch {}
    return IMPORTANCE_DIMENSIONS.reduce((acc, dim) => { acc[dim] = 0.5; return acc; }, { overall: 0.5 });
  }

  // ═══════════════════════════════════════
  //  PUBLIC API
  // ═══════════════════════════════════════

  async consolidate(memories) {
    if (!memories || memories.length === 0) return [];
    if (!this.ai) throw new Error('AI module required for adversarial consolidation');

    const results = [];
    const emergency = [];
    const debatable = [];

    for (const mem of memories) {
      if (this._isEmergency(mem)) {
        emergency.push({ memory: mem, outcome: 'KEEP', reason: 'Emergency override — user-important memory', skipped: true });
      } else {
        debatable.push(mem);
      }
    }

    for (const e of emergency) {
      this.emit('auto-keep', { memory: e.memory, reason: e.reason });
      results.push(e);
    }

    // Find merge candidates
    const mergeGroups = await this._findMergeCandidates(debatable);
    for (const group of mergeGroups) {
      if (group.length > 1) {
        const result = await this._debateMerge(group);
        results.push(result);
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

    // Auto-adapt strengths after batch
    this._autoAdaptStrength();

    this._stats.totalCycles++;
    this._stats.lastCycleAt = Date.now();
    this._saveStats();
    this._saveDebates();

    this.emit('consolidation-complete', { total: results.length, outcomes: this._tallyCounts(results) });
    return results;
  }

  async debateMemory(memory) {
    if (!this.ai) throw new Error('AI module required');
    if (this._isEmergency(memory)) return { memory, outcome: 'KEEP', reason: 'Emergency override', skipped: true };
    const result = await this._debateSingle(memory);
    this._autoAdaptStrength();
    this._saveDebates();
    this._saveStats();
    return result;
  }

  getDebateHistory(filter = {}) {
    let debates = [...this._debates];
    if (filter.outcome) debates = debates.filter(d => d.outcome === filter.outcome);
    if (filter.since) debates = debates.filter(d => d.timestamp >= filter.since);
    if (filter.memoryId) debates = debates.filter(d => d.memoryId === filter.memoryId || (d.memoryIds && d.memoryIds.includes(filter.memoryId)));
    if (filter.limit) debates = debates.slice(-filter.limit);
    return debates;
  }

  getAdversaryStats() {
    const k = this._stats.keeper;
    const p = this._stats.pruner;
    const kWinRate = k.totalDebates > 0 ? k.wins / k.totalDebates : 0;
    const pWinRate = p.totalDebates > 0 ? p.wins / p.totalDebates : 0;

    return {
      keeper: {
        ...k,
        winRate: kWinRate.toFixed(3),
        effectivenessRate: (k.usefulRetentions + k.wastedRetentions) > 0
          ? (k.usefulRetentions / (k.usefulRetentions + k.wastedRetentions)).toFixed(3) : 'N/A',
      },
      pruner: {
        ...p,
        winRate: pWinRate.toFixed(3),
        effectivenessRate: (p.goodCuts + p.regrettedCuts) > 0
          ? (p.goodCuts / (p.goodCuts + p.regrettedCuts)).toFixed(3) : 'N/A',
      },
      balance: Math.abs(kWinRate - pWinRate) < 0.1 ? 'balanced' : kWinRate > pWinRate ? 'keeper-dominant' : 'pruner-dominant',
      outcomes: { ...this._stats.outcomes },
      totalCycles: this._stats.totalCycles,
      lastCycleAt: this._stats.lastCycleAt,
      graveyardSize: this._graveyard.length,
      archiveSize: this._archive.length,
    };
  }

  setStrength(adversary, strength) {
    if (!['keeper', 'pruner'].includes(adversary)) throw new Error('Adversary must be "keeper" or "pruner"');
    if (typeof strength !== 'number' || strength < 0 || strength > 1) throw new Error('Strength must be 0.0–1.0');
    this._stats[adversary].strength = strength;
    this._saveStats();
    this.emit('strength-changed', { adversary, strength });
    return { adversary, strength };
  }

  async runConsolidationCycle(recentMemories) {
    if (!recentMemories || recentMemories.length === 0) return [];
    this.emit('cycle-start', { count: recentMemories.length });
    const results = await this.consolidate(recentMemories);
    this.emit('cycle-end', { results: results.length });
    return results;
  }

  async tick(unconsolidated = []) {
    if (unconsolidated.length < this.backlogThreshold) return null;
    const batch = unconsolidated.slice(0, this.maxDebatesPerTick);
    return this.runConsolidationCycle(batch);
  }

  recordFeedback(debateId, feedback) {
    const debate = this._debates.find(d => d.id === debateId);
    if (!debate) return null;

    debate.feedback = feedback;
    debate.feedbackAt = Date.now();

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

  getGraveyard() { return [...this._graveyard]; }
  getArchive() { return [...this._archive]; }

  /**
   * Retrieve archived memory by ID (cold storage retrieval).
   */
  retrieveFromArchive(memoryId) {
    const idx = this._archive.findIndex(m => (m.id || m.key) === memoryId);
    if (idx < 0) return null;
    const mem = this._archive.splice(idx, 1)[0];
    mem.retrievedFromArchiveAt = Date.now();
    this._saveArchive();
    this.emit('archive-retrieved', mem);
    return mem;
  }

  // ═══════════════════════════════════════
  //  DEBATE PATTERN ANALYSIS
  // ═══════════════════════════════════════

  /**
   * Analyze debate history for recurring patterns.
   */
  analyzeDebatePatterns() {
    if (this._debates.length < 10) return { error: 'Need at least 10 debates for pattern analysis' };

    const recent = this._debates.slice(-100);
    const patterns = {
      outcomeTrend: {},
      avgKeeperScore: 0,
      avgPrunerScore: 0,
      feedbackStats: { useful: 0, wasted: 0, regretted: 0, 'good-cut': 0, none: 0 },
      streaks: [],
      timePatterns: {},
    };

    // Outcome distribution
    for (const d of recent) {
      patterns.outcomeTrend[d.outcome] = (patterns.outcomeTrend[d.outcome] || 0) + 1;
      if (d.keeper) patterns.avgKeeperScore += d.keeper.score || 0;
      if (d.pruner) patterns.avgPrunerScore += d.pruner.score || 0;
      patterns.feedbackStats[d.feedback || 'none']++;
    }
    patterns.avgKeeperScore = Math.round(patterns.avgKeeperScore / recent.length * 1000) / 1000;
    patterns.avgPrunerScore = Math.round(patterns.avgPrunerScore / recent.length * 1000) / 1000;

    // Detect streaks
    let currentStreak = { outcome: null, count: 0 };
    for (const d of recent) {
      if (d.outcome === currentStreak.outcome) {
        currentStreak.count++;
      } else {
        if (currentStreak.count >= 3) patterns.streaks.push({ ...currentStreak });
        currentStreak = { outcome: d.outcome, count: 1 };
      }
    }
    if (currentStreak.count >= 3) patterns.streaks.push({ ...currentStreak });

    // Time-of-day patterns (hour buckets)
    for (const d of recent) {
      const hour = new Date(d.timestamp).getHours();
      const bucket = hour < 6 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
      if (!patterns.timePatterns[bucket]) patterns.timePatterns[bucket] = {};
      patterns.timePatterns[bucket][d.outcome] = (patterns.timePatterns[bucket][d.outcome] || 0) + 1;
    }

    // Regret rate — key health metric
    const totalForget = recent.filter(d => d.outcome === 'FORGET').length;
    const regretted = recent.filter(d => d.outcome === 'FORGET' && d.feedback === 'regretted').length;
    patterns.regretRate = totalForget > 0 ? Math.round(regretted / totalForget * 1000) / 1000 : 0;

    writeJSON(PATTERNS_FILE, { ...patterns, analyzedAt: Date.now(), debateCount: recent.length });
    this.emit('patterns-analyzed', patterns);
    return patterns;
  }

  // ═══════════════════════════════════════
  //  INTERNAL — DEBATE ENGINE
  // ═══════════════════════════════════════

  async _debateSingle(memory) {
    const memText = memory.text || memory.content || JSON.stringify(memory);
    const memId = memory.id || memory.key || uuid();
    const debateId = uuid();

    // Score importance from multiple angles
    const importance = await this.scoreImportance(memory);

    const keeperArg = await this._getKeeperArgument(memText, importance);
    const prunerArg = await this._getPrunerArgument(memText, importance);
    const judgment = await this._judge(memText, keeperArg, prunerArg, importance);

    const debate = {
      id: debateId,
      memoryId: memId,
      memoryPreview: memText.slice(0, 200),
      timestamp: Date.now(),
      importance,
      keeper: { argument: keeperArg.argument, score: keeperArg.score },
      pruner: { argument: prunerArg.argument, score: prunerArg.score },
      outcome: judgment.outcome,
      reason: judgment.reason,
      compressed: judgment.compressed || null,
      feedback: null,
      feedbackAt: null,
    };

    const keeperWeighted = keeperArg.score * this._stats.keeper.strength;
    const prunerWeighted = prunerArg.score * this._stats.pruner.strength;
    debate.keeper.weightedScore = keeperWeighted;
    debate.pruner.weightedScore = prunerWeighted;

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

    if (debate.outcome === 'FORGET') {
      this._graveyard.push({ ...memory, forgottenAt: Date.now(), debateId, reason: debate.reason });
      this._saveGraveyard();
    } else if (debate.outcome === 'ARCHIVE') {
      this._archive.push({ ...memory, archivedAt: Date.now(), debateId, reason: debate.reason });
      this._saveArchive();
    }

    this._debates.push(debate);
    this.emit('debate-complete', debate);
    return { memory, outcome: debate.outcome, reason: debate.reason, debateId, compressed: debate.compressed, importance };
  }

  async _debateMerge(memories) {
    const memTexts = memories.map(m => m.text || m.content || JSON.stringify(m));
    const memIds = memories.map(m => m.id || m.key);
    const debateId = uuid();
    const combined = memTexts.map((t, i) => `[Memory ${i + 1}]: ${t}`).join('\n');

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
      this._stats.pruner.wins++;
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

  async _getKeeperArgument(memoryText, importance) {
    const impContext = importance ? `\nImportance scores: ${JSON.stringify(importance)}` : '';
    const messages = [
      {
        role: 'system',
        content: `You are THE KEEPER, an adversarial memory advocate. Argue FOR retaining this memory.
You value: completeness, context preservation, future usefulness, emotional significance, pattern recognition.${impContext}
Respond in JSON: {"argument": "your case (2-4 sentences)", "score": 0.0-1.0}`
      },
      { role: 'user', content: `Memory:\n${memoryText}` }
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

  async _getPrunerArgument(memoryText, importance) {
    const impContext = importance ? `\nImportance scores: ${JSON.stringify(importance)}` : '';
    const messages = [
      {
        role: 'system',
        content: `You are THE PRUNER, an adversarial memory critic. Argue AGAINST retaining this memory.
You value: efficiency, relevance, signal-to-noise, cognitive load reduction, avoiding redundancy.${impContext}
Respond in JSON: {"argument": "your case (2-4 sentences)", "score": 0.0-1.0}`
      },
      { role: 'user', content: `Memory:\n${memoryText}` }
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

  async _judge(memoryText, keeperArg, prunerArg, importance) {
    const kw = keeperArg.score * this._stats.keeper.strength;
    const pw = prunerArg.score * this._stats.pruner.strength;
    const impOverall = importance?.overall || 0.5;

    const messages = [
      {
        role: 'system',
        content: `You are the JUDGE in adversarial memory consolidation.

KEEPER (weighted: ${kw.toFixed(3)}): ${keeperArg.argument}
PRUNER (weighted: ${pw.toFixed(3)}): ${prunerArg.argument}
Overall importance: ${impOverall.toFixed(3)}

Outcomes: KEEP, COMPRESS (include compressed), ARCHIVE (cold storage), FORGET.
Tiebreaker: if within 0.1, favor COMPRESS.

JSON: {"outcome": "...", "reason": "1-2 sentences", "compressed": "if COMPRESS, else null"}`
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
    if (kw > pw + 0.1) return { outcome: 'KEEP', reason: 'Keeper won by score (fallback).' };
    if (pw > kw + 0.1) return { outcome: 'FORGET', reason: 'Pruner won by score (fallback).' };
    return { outcome: 'COMPRESS', reason: 'Scores tied — default compress (fallback).' };
  }

  async _getKeeperMergeArgument(combinedText) {
    const messages = [{
      role: 'system',
      content: `You are THE KEEPER. Multiple related memories are considered for merging. Argue for the best preservation strategy.
JSON: {"argument": "2-4 sentences", "score": 0.0-1.0}`
    }, { role: 'user', content: combinedText }];
    try {
      const data = await this.ai.callWithFallback(messages, null);
      const content = data.choices?.[0]?.message?.content || '';
      const match = content.match(/\{[\s\S]*\}/);
      if (match) { const p = JSON.parse(match[0]); return { argument: p.argument || '', score: Math.min(1, Math.max(0, p.score || 0.5)) }; }
    } catch {}
    return { argument: 'Default: merge to preserve context.', score: 0.5 };
  }

  async _getPrunerMergeArgument(combinedText) {
    const messages = [{
      role: 'system',
      content: `You are THE PRUNER. Multiple related memories are considered. Argue for aggressive consolidation.
JSON: {"argument": "2-4 sentences", "score": 0.0-1.0}`
    }, { role: 'user', content: combinedText }];
    try {
      const data = await this.ai.callWithFallback(messages, null);
      const content = data.choices?.[0]?.message?.content || '';
      const match = content.match(/\{[\s\S]*\}/);
      if (match) { const p = JSON.parse(match[0]); return { argument: p.argument || '', score: Math.min(1, Math.max(0, p.score || 0.5)) }; }
    } catch {}
    return { argument: 'Default: aggressively merge redundant memories.', score: 0.5 };
  }

  async _judgeMerge(combinedText, keeperArg, prunerArg) {
    const messages = [{
      role: 'system',
      content: `You are the JUDGE. Keeper and Pruner debated merging related memories.
KEEPER: ${keeperArg.argument} (${keeperArg.score})
PRUNER: ${prunerArg.argument} (${prunerArg.score})
Decide: MERGE (include merged text), KEEP (separate), COMPRESS, FORGET.
JSON: {"outcome":"...","reason":"why","merged":"text if MERGE/COMPRESS, else null"}`
    }, { role: 'user', content: combinedText }];
    try {
      const data = await this.ai.callWithFallback(messages, null);
      const content = data.choices?.[0]?.message?.content || '';
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        const p = JSON.parse(match[0]);
        return { outcome: OUTCOMES.includes(p.outcome) ? p.outcome : 'MERGE', reason: p.reason || '', merged: p.merged || null };
      }
    } catch {}
    return { outcome: 'MERGE', reason: 'Default merge (fallback).', merged: null };
  }

  // ═══════════════════════════════════════
  //  INTERNAL — HELPERS
  // ═══════════════════════════════════════

  _isEmergency(memory) {
    const tags = memory.tags || [];
    if (memory.priority === 'critical') return true;
    for (const tag of tags) { if (this.emergencyTags.includes(tag)) return true; }
    return false;
  }

  async _findMergeCandidates(memories) {
    if (memories.length < 2 || !this.ai) return [];
    const summaries = memories.map((m, i) => `[${i}] ${(m.text || m.content || '').slice(0, 100)}`).join('\n');
    const messages = [{
      role: 'system',
      content: `Identify groups of related memories to consider merging. Return JSON array of index arrays. Only truly related. [] if none.
Example: [[0,3],[1,4,5]]`
    }, { role: 'user', content: summaries }];
    try {
      const data = await this.ai.callWithFallback(messages, null);
      const content = data.choices?.[0]?.message?.content || '[]';
      const match = content.match(/\[[\s\S]*\]/);
      if (match) {
        const groups = JSON.parse(match[0]);
        if (Array.isArray(groups)) {
          return groups.filter(g => Array.isArray(g) && g.length > 1)
            .map(g => g.filter(i => i >= 0 && i < memories.length).map(i => memories[i]))
            .filter(g => g.length > 1);
        }
      }
    } catch {}
    return [];
  }

  _adaptStrength(adversary, delta) {
    this._stats[adversary].strength = Math.min(1, Math.max(0, this._stats[adversary].strength + delta));
  }

  _tallyCounts(results) {
    const counts = {};
    for (const r of results) counts[r.outcome] = (counts[r.outcome] || 0) + 1;
    return counts;
  }
}

AdversarialMemoryConsolidation.OUTCOMES = OUTCOMES;
AdversarialMemoryConsolidation.IMPORTANCE_DIMENSIONS = IMPORTANCE_DIMENSIONS;
module.exports = AdversarialMemoryConsolidation;
