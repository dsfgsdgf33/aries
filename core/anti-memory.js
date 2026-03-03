/**
 * ARIES — Anti-Memory (Strategic Forgetting v2)
 * Systems that can't forget get slower, dumber, more rigid.
 * Manages memory lifecycle: decay, compression, contradiction resolution,
 * irrelevance culling, interference competition, and deliberate forgetting.
 * 
 * 6 forgetting policies, memory graveyard with resurrection, pressure-based GC,
 * exponential decay curves, protected memories, contradiction detection,
 * interference resolution, and forgetting analytics.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

const SharedMemoryStore = require('./shared-memory-store');
const store = SharedMemoryStore.getInstance();
const NS = 'anti-memory';

const DATA_DIR = path.join(__dirname, '..', 'data', 'forgetting');
const GRAVEYARD_PATH = path.join(DATA_DIR, 'graveyard.json');
const ANALYTICS_PATH = path.join(DATA_DIR, 'analytics.json');
const PROTECTED_PATH = path.join(DATA_DIR, 'protected.json');
const STATE_PATH = path.join(DATA_DIR, 'state.json');
const LOG_PATH = path.join(DATA_DIR, 'log.json');

function ensureDir() {}
function readJSON(p, fallback) { return store.get(NS, path.basename(p, '.json'), fallback); }
function writeJSON(p, data) { store.set(NS, path.basename(p, '.json'), data); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }
function now() { return Date.now(); }

const POLICIES = {
  DECAY: 'decay',
  COMPRESSION: 'compression',
  CONTRADICTION: 'contradiction',
  IRRELEVANCE: 'irrelevance',
  INTERFERENCE: 'interference',
  DELIBERATE: 'deliberate',
};

const DEFAULT_CONFIG = {
  maxMemories: 1000,
  pressureThreshold: 0.7,
  criticalPressure: 0.9,
  decayHalfLife: 7 * 24 * 3600 * 1000,
  decayMinStrength: 0.05,
  compressionAgeMs: 14 * 24 * 3600 * 1000,
  compressionBatchSize: 5,
  irrelevanceThreshold: 0,
  irrelevanceAgeMs: 3 * 24 * 3600 * 1000,
  interferenceSimThreshold: 0.75,
  sweepIntervalMs: 3600 * 1000,
  graveyardMaxSize: 500,
  analyticsWindow: 30 * 24 * 3600 * 1000,
  contradictionConfidenceGap: 0.3,
  emergencySweepTarget: 0.6, // target pressure after emergency sweep
};

class AntiMemory extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null;
    this.config = { ...DEFAULT_CONFIG, ...(opts.config || {}) };
    this._lastSweep = 0;
    ensureDir();
    this._loadState();
  }

  // ═══════════════════════════════════════════════════════════
  //  State Management
  // ═══════════════════════════════════════════════════════════

  _loadState() {
    const state = readJSON(STATE_PATH, {});
    this._lastSweep = state.lastSweep || 0;
    this._totalForgotten = state.totalForgotten || 0;
    this._totalCompressed = state.totalCompressed || 0;
    this._totalResurrected = state.totalResurrected || 0;
    this._sweepCount = state.sweepCount || 0;
    this._contradictionsResolved = state.contradictionsResolved || 0;
    this._interferencesResolved = state.interferencesResolved || 0;
  }

  _saveState() {
    writeJSON(STATE_PATH, {
      lastSweep: this._lastSweep,
      totalForgotten: this._totalForgotten,
      totalCompressed: this._totalCompressed,
      totalResurrected: this._totalResurrected,
      sweepCount: this._sweepCount,
      contradictionsResolved: this._contradictionsResolved,
      interferencesResolved: this._interferencesResolved,
    });
  }

  _log(action, data) {
    const log = readJSON(LOG_PATH, []);
    log.push({ action, ...data, at: now() });
    if (log.length > 1000) log.splice(0, log.length - 1000);
    writeJSON(LOG_PATH, log);
  }

  // ═══════════════════════════════════════════════════════════
  //  Memory Source Integration
  // ═══════════════════════════════════════════════════════════

  _gatherMemories() {
    const memories = [];

    // memory.json
    try {
      const memFile = path.join(__dirname, '..', 'data', 'memory.json');
      if (fs.existsSync(memFile)) {
        const data = JSON.parse(fs.readFileSync(memFile, 'utf8'));
        if (Array.isArray(data)) {
          for (const entry of data) {
            memories.push({
              id: entry.key || entry.text?.substring(0, 50),
              text: entry.text || entry.value || '',
              created: entry.created ? new Date(entry.created).getTime() : now(),
              lastAccessed: entry.lastAccessed ? new Date(entry.lastAccessed).getTime() : null,
              accessCount: entry.accessCount || 0,
              category: entry.category || 'general',
              priority: entry.priority || 'normal',
              tags: entry.tags || [],
              source: 'memory.json',
              meta: entry,
            });
          }
        }
      }
    } catch { /* skip */ }

    // cross-session memories
    try {
      const csDir = path.join(__dirname, '..', 'data', 'cross-session');
      if (fs.existsSync(csDir)) {
        const files = fs.readdirSync(csDir).filter(f => f.endsWith('.json'));
        for (const file of files) {
          try {
            const data = JSON.parse(fs.readFileSync(path.join(csDir, file), 'utf8'));
            if (data && data.key) {
              memories.push({
                id: `cs:${data.key}`,
                text: data.value || data.text || '',
                created: data.created ? new Date(data.created).getTime() : now(),
                lastAccessed: data.lastAccessed ? new Date(data.lastAccessed).getTime() : null,
                accessCount: data.accessCount || 0,
                category: data.category || 'cross-session',
                priority: data.priority || 'normal',
                tags: data.tags || [],
                source: 'cross-session',
                meta: data,
              });
            }
          } catch { /* skip */ }
        }
      }
    } catch { /* skip */ }

    // persistent-memory daily notes
    try {
      const memDir = path.join(__dirname, '..', 'data', 'memory');
      if (fs.existsSync(memDir)) {
        const files = fs.readdirSync(memDir).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f));
        for (const file of files) {
          try {
            const dateStr = file.replace('.md', '');
            const content = fs.readFileSync(path.join(memDir, file), 'utf8');
            const lines = content.split('\n').filter(l => l.startsWith('- '));
            for (let i = 0; i < lines.length; i++) {
              memories.push({
                id: `daily:${dateStr}:${i}`,
                text: lines[i],
                created: new Date(dateStr).getTime(),
                lastAccessed: null,
                accessCount: 0,
                category: 'daily-note',
                priority: 'low',
                tags: [],
                source: 'persistent-memory',
                meta: { file, lineIndex: i },
              });
            }
          } catch { /* skip */ }
        }
      }
    } catch { /* skip */ }

    return memories;
  }

  // ═══════════════════════════════════════════════════════════
  //  Protection System (Crystallization)
  // ═══════════════════════════════════════════════════════════

  protect(memoryId, reason) {
    const protected_ = readJSON(PROTECTED_PATH, {});
    protected_[memoryId] = {
      protectedAt: now(),
      reason: reason || 'manually crystallized',
    };
    writeJSON(PROTECTED_PATH, protected_);
    this._log('protect', { memoryId, reason });
    this.emit('protected', { memoryId, reason });
    return { protected: true, id: memoryId };
  }

  unprotect(memoryId) {
    const protected_ = readJSON(PROTECTED_PATH, {});
    if (!protected_[memoryId]) return { unprotected: false, error: 'Not protected' };
    delete protected_[memoryId];
    writeJSON(PROTECTED_PATH, protected_);
    this._log('unprotect', { memoryId });
    this.emit('unprotected', { memoryId });
    return { unprotected: true };
  }

  isProtected(memoryId) {
    return !!readJSON(PROTECTED_PATH, {})[memoryId];
  }

  getProtected() {
    return readJSON(PROTECTED_PATH, {});
  }

  // ═══════════════════════════════════════════════════════════
  //  Decay & Scoring
  // ═══════════════════════════════════════════════════════════

  _decayStrength(memory) {
    const lastTouch = memory.lastAccessed || memory.created;
    const elapsed = now() - lastTouch;
    const halfLife = this.config.decayHalfLife;
    let strength = Math.pow(2, -elapsed / halfLife);
    const accessBoost = Math.min(memory.accessCount * 0.05, 0.5);
    strength = Math.min(1, strength + accessBoost);
    const priorityBoosts = { critical: 0.4, high: 0.2, normal: 0, low: -0.1 };
    strength += priorityBoosts[memory.priority] || 0;
    return Math.max(0, Math.min(1, strength));
  }

  _forgetScore(memory) {
    const age = (now() - memory.created) / (24 * 3600 * 1000);
    const decayStr = this._decayStrength(memory);
    const irrelevance = memory.accessCount === 0 ? 1 : 1 / (1 + memory.accessCount);
    return age * irrelevance * (1 - decayStr);
  }

  // ═══════════════════════════════════════════════════════════
  //  Interference Detection
  // ═══════════════════════════════════════════════════════════

  /**
   * Find memories that are too similar — they compete and interfere.
   * Uses keyword overlap as a similarity proxy (no embeddings needed).
   */
  _findInterferingPairs(memories) {
    const pairs = [];
    const tokenize = (text) => {
      const words = (text || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3);
      return new Set(words);
    };

    const tokenSets = memories.map(m => ({ mem: m, tokens: tokenize(m.text) }));

    for (let i = 0; i < tokenSets.length; i++) {
      for (let j = i + 1; j < tokenSets.length; j++) {
        const a = tokenSets[i], b = tokenSets[j];
        if (a.tokens.size === 0 || b.tokens.size === 0) continue;
        // Jaccard similarity
        let intersection = 0;
        for (const t of a.tokens) { if (b.tokens.has(t)) intersection++; }
        const union = new Set([...a.tokens, ...b.tokens]).size;
        const similarity = union > 0 ? intersection / union : 0;

        if (similarity >= this.config.interferenceSimThreshold) {
          // The weaker memory loses
          const strA = this._decayStrength(a.mem);
          const strB = this._decayStrength(b.mem);
          const loser = strA >= strB ? b.mem : a.mem;
          const winner = strA >= strB ? a.mem : b.mem;
          pairs.push({ winner, loser, similarity: Math.round(similarity * 1000) / 1000 });
        }
      }
    }
    return pairs;
  }

  // ═══════════════════════════════════════════════════════════
  //  Contradiction Detection
  // ═══════════════════════════════════════════════════════════

  /**
   * Use AI to detect contradicting memories. The weaker one gets forgotten.
   * @param {object[]} memories - subset to check
   * @returns {Promise<Array<{memA, memB, loser, reason}>>}
   */
  async detectContradictions(memories) {
    if (!this.ai || memories.length < 2) return [];

    // Sample up to 30 for cost efficiency
    const sample = memories.slice(0, 30);
    const memList = sample.map((m, i) => `[${i}] ${m.text.substring(0, 120)}`).join('\n');

    try {
      const prompt = `Identify any CONTRADICTING pairs in these memories — where one statement directly conflicts with another. Only flag genuine contradictions, not mere differences in topic.

Memories:
${memList}

Return JSON array: [{"indexA": number, "indexB": number, "reason": "why they contradict"}]
Return [] if no contradictions found.`;

      const result = await this.ai.chat([{ role: 'user', content: prompt }], { maxTokens: 500 });
      const text = result.text || result.content || result;
      const match = text.match(/\[[\s\S]*\]/);
      if (!match) return [];

      const contradictions = JSON.parse(match[0]);
      const pairs = [];
      for (const c of contradictions) {
        const a = sample[c.indexA], b = sample[c.indexB];
        if (!a || !b) continue;
        const strA = this._decayStrength(a);
        const strB = this._decayStrength(b);
        pairs.push({
          memA: a,
          memB: b,
          loser: strA >= strB ? b : a,
          winner: strA >= strB ? a : b,
          reason: c.reason,
        });
      }
      return pairs;
    } catch {
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Candidate Analysis
  // ═══════════════════════════════════════════════════════════

  analyzeCandidates(opts = {}) {
    const limit = opts.limit || 50;
    const minScore = opts.minScore || 0;
    const memories = this._gatherMemories();
    const protected_ = readJSON(PROTECTED_PATH, {});
    const candidates = [];

    // Interference detection across all unprotected memories
    const unprotected = memories.filter(m => !protected_[m.id]);
    const interferencePairs = this._findInterferingPairs(unprotected);
    const interferenceVictims = new Set(interferencePairs.map(p => p.loser.id));

    for (const mem of memories) {
      if (protected_[mem.id]) continue;

      const policies = [];
      const reasons = [];
      const score = this._forgetScore(mem);

      // DECAY policy
      const strength = this._decayStrength(mem);
      if (strength < this.config.decayMinStrength) {
        policies.push(POLICIES.DECAY);
        reasons.push(`strength decayed to ${strength.toFixed(3)}`);
      }

      // IRRELEVANCE policy
      if (mem.accessCount <= this.config.irrelevanceThreshold && (now() - mem.created) > this.config.irrelevanceAgeMs) {
        policies.push(POLICIES.IRRELEVANCE);
        reasons.push(`never accessed in ${Math.floor((now() - mem.created) / (24 * 3600 * 1000))} days`);
      }

      // INTERFERENCE policy
      if (interferenceVictims.has(mem.id)) {
        const pair = interferencePairs.find(p => p.loser.id === mem.id);
        policies.push(POLICIES.INTERFERENCE);
        reasons.push(`interferes with stronger memory (sim=${pair?.similarity})`);
      }

      // COMPRESSION candidate
      if ((now() - mem.created) > this.config.compressionAgeMs && strength > this.config.decayMinStrength) {
        policies.push(POLICIES.COMPRESSION);
        reasons.push('old enough for compression');
      }

      if (policies.length > 0 && score >= minScore) {
        candidates.push({ memory: mem, score, strength, policies, reason: reasons.join('; ') });
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    this.emit('analyzed', { candidateCount: candidates.length, totalMemories: memories.length });
    return candidates.slice(0, limit);
  }

  // ═══════════════════════════════════════════════════════════
  //  Forgetting
  // ═══════════════════════════════════════════════════════════

  forget(memoryId, policy, reason) {
    if (this.isProtected(memoryId)) {
      return { forgotten: false, error: 'Memory is crystallized (protected)' };
    }

    const memories = this._gatherMemories();
    const memory = memories.find(m => m.id === memoryId);
    if (!memory) return { forgotten: false, error: 'Memory not found' };

    const tombstone = {
      id: uuid(),
      originalId: memoryId,
      summary: memory.text.substring(0, 200),
      fullText: memory.text,
      category: memory.category,
      source: memory.source,
      created: memory.created,
      forgottenAt: now(),
      policy: policy || POLICIES.DECAY,
      reason: reason || 'no reason given',
      resurrected: false,
      resurrectionCount: 0,
      meta: memory.meta,
    };

    const graveyard = readJSON(GRAVEYARD_PATH, []);
    graveyard.push(tombstone);
    if (graveyard.length > this.config.graveyardMaxSize) {
      let removed = 0;
      const excess = graveyard.length - this.config.graveyardMaxSize;
      for (let i = 0; i < graveyard.length && removed < excess; i++) {
        if (!graveyard[i].resurrected) { graveyard.splice(i, 1); i--; removed++; }
      }
    }
    writeJSON(GRAVEYARD_PATH, graveyard);

    this._removeFromSource(memory);
    this._recordAnalytic('forget', { policy, category: memory.category });

    if (policy === POLICIES.CONTRADICTION) this._contradictionsResolved++;
    if (policy === POLICIES.INTERFERENCE) this._interferencesResolved++;
    this._totalForgotten++;
    this._saveState();
    this._log('forget', { memoryId, policy, reason });
    this.emit('forgotten', { memoryId, policy, reason, tombstone });

    return { forgotten: true, tombstone };
  }

  _removeFromSource(memory) {
    try {
      if (memory.source === 'memory.json') {
        const memFile = path.join(__dirname, '..', 'data', 'memory.json');
        if (!fs.existsSync(memFile)) return;
        const data = JSON.parse(fs.readFileSync(memFile, 'utf8'));
        if (!Array.isArray(data)) return;
        const idx = data.findIndex(e => (e.key || e.text?.substring(0, 50)) === memory.id);
        if (idx >= 0) { data.splice(idx, 1); fs.writeFileSync(memFile, JSON.stringify(data, null, 2)); }
      } else if (memory.source === 'cross-session') {
        const key = memory.id.replace('cs:', '');
        const csDir = path.join(__dirname, '..', 'data', 'cross-session');
        const files = fs.readdirSync(csDir).filter(f => f.endsWith('.json'));
        for (const file of files) {
          try {
            const d = JSON.parse(fs.readFileSync(path.join(csDir, file), 'utf8'));
            if (d.key === key) { fs.unlinkSync(path.join(csDir, file)); break; }
          } catch { /* skip */ }
        }
      }
    } catch { /* best effort */ }
  }

  // ═══════════════════════════════════════════════════════════
  //  Compression
  // ═══════════════════════════════════════════════════════════

  async compress(memoryIds, customSummary) {
    const memories = this._gatherMemories();
    const toCompress = memories.filter(m => memoryIds.includes(m.id));
    if (toCompress.length === 0) return { compressed: false, error: 'No matching memories found' };

    const protected_ = readJSON(PROTECTED_PATH, {});
    const blocked = toCompress.filter(m => protected_[m.id]);
    if (blocked.length > 0) return { compressed: false, error: `${blocked.length} memories are crystallized` };

    let summary = customSummary || null;

    if (!summary && this.ai) {
      try {
        const texts = toCompress.map(m => m.text).join('\n---\n');
        const prompt = `Compress these ${toCompress.length} memory entries into a single concise summary that preserves key facts and insights. Be brief but complete.\n\n${texts}`;
        const result = await this.ai.chat([{ role: 'user', content: prompt }], { maxTokens: 300 });
        summary = result.text || result.content || result;
      } catch {
        summary = toCompress.map(m => m.text.substring(0, 100)).join(' | ');
      }
    }
    if (!summary) summary = toCompress.map(m => m.text.substring(0, 100)).join(' | ');

    for (const mem of toCompress) {
      this.forget(mem.id, POLICIES.COMPRESSION, `compressed with ${toCompress.length - 1} other memories`);
    }

    try {
      const memFile = path.join(__dirname, '..', 'data', 'memory.json');
      const data = fs.existsSync(memFile) ? JSON.parse(fs.readFileSync(memFile, 'utf8')) : [];
      data.push({
        key: `compressed_${uuid().substring(0, 8)}`,
        text: `[Compressed from ${toCompress.length} memories] ${summary}`,
        timestamp: new Date().toISOString(),
        tags: ['compressed'],
        category: toCompress[0].category || 'general',
        priority: 'normal',
        created: new Date().toISOString(),
        lastAccessed: null,
        accessCount: 0,
        ttl: null,
      });
      fs.writeFileSync(memFile, JSON.stringify(data, null, 2));
    } catch { /* best effort */ }

    this._totalCompressed += toCompress.length;
    this._saveState();
    this._recordAnalytic('compress', { count: toCompress.length });
    this._log('compress', { memoryIds, summary: summary.substring(0, 200) });
    this.emit('compressed', { memoryIds, summary });

    return { compressed: true, summary, original: toCompress.length };
  }

  // ═══════════════════════════════════════════════════════════
  //  Graveyard & Resurrection
  // ═══════════════════════════════════════════════════════════

  getGraveyard(filter = {}) {
    let graveyard = readJSON(GRAVEYARD_PATH, []);
    if (filter.policy) graveyard = graveyard.filter(t => t.policy === filter.policy);
    if (filter.category) graveyard = graveyard.filter(t => t.category === filter.category);
    if (filter.resurrected !== undefined) graveyard = graveyard.filter(t => t.resurrected === filter.resurrected);
    if (filter.search) {
      const q = filter.search.toLowerCase();
      graveyard = graveyard.filter(t => t.summary.toLowerCase().includes(q) || (t.fullText || '').toLowerCase().includes(q));
    }
    graveyard.sort((a, b) => b.forgottenAt - a.forgottenAt);
    return graveyard.slice(0, filter.limit || 50);
  }

  resurrect(graveyardId) {
    const graveyard = readJSON(GRAVEYARD_PATH, []);
    const tombstone = graveyard.find(t => t.id === graveyardId);
    if (!tombstone) return { resurrected: false, error: 'Tombstone not found' };

    try {
      const memFile = path.join(__dirname, '..', 'data', 'memory.json');
      const data = fs.existsSync(memFile) ? JSON.parse(fs.readFileSync(memFile, 'utf8')) : [];
      data.push({
        key: tombstone.originalId,
        text: tombstone.fullText || tombstone.summary,
        timestamp: new Date().toISOString(),
        tags: ['resurrected'],
        category: tombstone.category || 'general',
        priority: 'normal',
        created: new Date().toISOString(),
        lastAccessed: new Date().toISOString(),
        accessCount: 1,
        ttl: null,
      });
      fs.writeFileSync(memFile, JSON.stringify(data, null, 2));
    } catch { /* best effort */ }

    tombstone.resurrected = true;
    tombstone.resurrectedAt = now();
    tombstone.resurrectionCount = (tombstone.resurrectionCount || 0) + 1;
    writeJSON(GRAVEYARD_PATH, graveyard);

    this._totalResurrected++;
    this._saveState();
    this._recordAnalytic('resurrect', { policy: tombstone.policy, category: tombstone.category });
    this._log('resurrect', { graveyardId, originalId: tombstone.originalId });
    this.emit('resurrected', { graveyardId, originalId: tombstone.originalId });

    return { resurrected: true, memory: tombstone };
  }

  /**
   * AI-driven contextual resurrection: search graveyard for memories relevant to a query
   * and resurrect them automatically if they'd be useful now.
   * @param {string} query - current context/question
   * @returns {Promise<Array>} resurrected memories
   */
  async contextualResurrect(query) {
    if (!this.ai) return [];
    const graveyard = readJSON(GRAVEYARD_PATH, []);
    const candidates = graveyard.filter(t => !t.resurrected).slice(-50);
    if (candidates.length === 0) return [];

    const tombList = candidates.map((t, i) => `[${i}] ${t.summary}`).join('\n');
    try {
      const prompt = `Given the current context: "${query}"

Which of these forgotten memories would be relevant and useful to bring back?

Forgotten memories:
${tombList}

Return JSON array of indices that should be resurrected: [0, 3, 7] etc. Return [] if none are relevant.`;

      const result = await this.ai.chat([{ role: 'user', content: prompt }], { maxTokens: 200 });
      const text = result.text || result.content || result;
      const match = text.match(/\[[\s\S]*?\]/);
      if (!match) return [];

      const indices = JSON.parse(match[0]);
      const resurrected = [];
      for (const idx of indices) {
        if (idx >= 0 && idx < candidates.length) {
          const r = this.resurrect(candidates[idx].id);
          if (r.resurrected) resurrected.push(r.memory);
        }
      }
      return resurrected;
    } catch { return []; }
  }

  // ═══════════════════════════════════════════════════════════
  //  Memory Pressure
  // ═══════════════════════════════════════════════════════════

  getMemoryPressure() {
    const memories = this._gatherMemories();
    const current = memories.length;
    const max = this.config.maxMemories;
    const pressure = current / max;

    let level = 'low';
    if (pressure >= this.config.criticalPressure) level = 'critical';
    else if (pressure >= this.config.pressureThreshold) level = 'high';
    else if (pressure >= 0.5) level = 'moderate';

    return { current, max, pressure: Math.round(pressure * 1000) / 1000, level };
  }

  // ═══════════════════════════════════════════════════════════
  //  Sweep (Forgetting Cycle)
  // ═══════════════════════════════════════════════════════════

  async sweep(opts = {}) {
    const dryRun = opts.dryRun || false;
    const maxForget = opts.maxForget || 20;
    const pressure = this.getMemoryPressure();

    let aggressive = opts.aggressive || false;
    if (pressure.level === 'critical') aggressive = true;

    // In critical pressure, calculate how many we need to forget to reach target
    let targetForget = maxForget;
    if (aggressive && pressure.level === 'critical') {
      const targetCount = Math.floor(this.config.maxMemories * this.config.emergencySweepTarget);
      targetForget = Math.max(maxForget, pressure.current - targetCount);
    }

    const minScore = aggressive ? 1 : 5;
    const candidates = this.analyzeCandidates({ limit: targetForget * 2, minScore });

    let swept = 0;
    let compressed = 0;
    let contradictionsResolved = 0;
    const forgetCandidates = [];
    const compressCandidates = [];

    for (const c of candidates) {
      if (c.policies.includes(POLICIES.COMPRESSION) && !c.policies.includes(POLICIES.DECAY) && !c.policies.includes(POLICIES.INTERFERENCE)) {
        compressCandidates.push(c);
      } else {
        forgetCandidates.push(c);
      }
    }

    if (!dryRun) {
      // Forget high-score candidates
      for (const c of forgetCandidates.slice(0, targetForget)) {
        const result = this.forget(c.memory.id, c.policies[0], c.reason);
        if (result.forgotten) swept++;
      }

      // Compress groups by category
      if (compressCandidates.length >= 2) {
        const byCategory = {};
        for (const c of compressCandidates) {
          const cat = c.memory.category || 'general';
          if (!byCategory[cat]) byCategory[cat] = [];
          byCategory[cat].push(c.memory.id);
        }
        for (const [, ids] of Object.entries(byCategory)) {
          if (ids.length >= 2) {
            const batch = ids.slice(0, this.config.compressionBatchSize);
            const result = await this.compress(batch);
            if (result.compressed) compressed += batch.length;
          }
        }
      }

      // Contradiction sweep (AI-powered, only if not in emergency)
      if (this.ai && !aggressive) {
        const memories = this._gatherMemories();
        const protected_ = readJSON(PROTECTED_PATH, {});
        const unprotected = memories.filter(m => !protected_[m.id]);
        const contradictions = await this.detectContradictions(unprotected);
        for (const c of contradictions) {
          const result = this.forget(c.loser.id, POLICIES.CONTRADICTION, `Contradicts "${c.winner.text.substring(0, 60)}": ${c.reason}`);
          if (result.forgotten) contradictionsResolved++;
        }
      }

      this._lastSweep = now();
      this._sweepCount++;
      this._saveState();
    }

    const result = { swept, compressed, contradictionsResolved, candidates: candidates.length, pressure, dryRun, aggressive };
    this._log('sweep', result);
    this.emit('swept', result);
    return result;
  }

  // ═══════════════════════════════════════════════════════════
  //  Deliberate Forgetting (AI-driven)
  // ═══════════════════════════════════════════════════════════

  async analyzeDeliberate() {
    if (!this.ai) return { candidates: [], analyzed: 0, error: 'No AI available' };

    const memories = this._gatherMemories();
    const protected_ = readJSON(PROTECTED_PATH, {});
    const unprotected = memories.filter(m => !protected_[m.id]);
    const sample = unprotected.slice(0, 30);
    if (sample.length === 0) return { candidates: [], analyzed: 0 };

    const memList = sample.map((m, i) => `[${i}] (${m.category}) ${m.text.substring(0, 150)}`).join('\n');

    try {
      const prompt = `Analyze these memories and identify any that are actively harmful to retain. Harmful means: outdated assumptions, toxic patterns, incorrect beliefs, or information that causes worse decision-making.

Return a JSON array of objects with { index, reason } for memories that should be deliberately forgotten. Return [] if none are harmful.

Memories:
${memList}

Respond with ONLY a JSON array.`;

      const result = await this.ai.chat([{ role: 'user', content: prompt }], { maxTokens: 500 });
      const text = result.text || result.content || result;
      const match = text.match(/\[[\s\S]*\]/);
      if (!match) return { candidates: [], analyzed: sample.length };

      const harmful = JSON.parse(match[0]);
      const candidates = [];
      for (const h of harmful) {
        if (h.index >= 0 && h.index < sample.length) {
          candidates.push({ memory: sample[h.index], policy: POLICIES.DELIBERATE, reason: h.reason });
        }
      }
      return { candidates, analyzed: sample.length };
    } catch (e) {
      return { candidates: [], analyzed: sample.length, error: e.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Analytics
  // ═══════════════════════════════════════════════════════════

  _recordAnalytic(action, data) {
    const analytics = readJSON(ANALYTICS_PATH, { events: [] });
    analytics.events.push({ action, ...data, at: now() });
    const cutoff = now() - this.config.analyticsWindow;
    analytics.events = analytics.events.filter(e => e.at > cutoff);
    writeJSON(ANALYTICS_PATH, analytics);
  }

  getAnalytics() {
    const analytics = readJSON(ANALYTICS_PATH, { events: [] });
    const graveyard = readJSON(GRAVEYARD_PATH, []);
    const pressure = this.getMemoryPressure();

    const byPolicy = {};
    const byCategory = {};
    let forgetCount = 0, compressCount = 0, resurrectCount = 0;

    for (const event of analytics.events) {
      if (event.action === 'forget') {
        forgetCount++;
        byPolicy[event.policy || 'unknown'] = (byPolicy[event.policy || 'unknown'] || 0) + 1;
        byCategory[event.category || 'unknown'] = (byCategory[event.category || 'unknown'] || 0) + 1;
      } else if (event.action === 'compress') {
        compressCount += event.count || 1;
      } else if (event.action === 'resurrect') {
        resurrectCount++;
      }
    }

    const resurrectionRate = forgetCount > 0 ? resurrectCount / forgetCount : 0;

    // Most forgotten categories / policies
    const topForgottenCategories = Object.entries(byCategory).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const topForgottenPolicies = Object.entries(byPolicy).sort((a, b) => b[1] - a[1]);

    // Resurrection analysis — which policies produce the most resurrections
    const resurrectedByPolicy = {};
    for (const event of analytics.events) {
      if (event.action === 'resurrect' && event.policy) {
        resurrectedByPolicy[event.policy] = (resurrectedByPolicy[event.policy] || 0) + 1;
      }
    }

    return {
      totalForgotten: this._totalForgotten,
      totalCompressed: this._totalCompressed,
      totalResurrected: this._totalResurrected,
      contradictionsResolved: this._contradictionsResolved,
      interferencesResolved: this._interferencesResolved,
      sweepCount: this._sweepCount,
      recentWindow: {
        forgotten: forgetCount,
        compressed: compressCount,
        resurrected: resurrectCount,
        byPolicy,
        byCategory,
      },
      topForgottenCategories,
      topForgottenPolicies,
      resurrectedByPolicy,
      resurrectionRate: Math.round(resurrectionRate * 1000) / 1000,
      graveyardSize: graveyard.length,
      pressure,
      health: resurrectionRate > 0.3 ? 'over-aggressive' : resurrectionRate > 0.1 ? 'slightly-aggressive' : 'healthy',
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  Tick
  // ═══════════════════════════════════════════════════════════

  async tick() {
    const pressure = this.getMemoryPressure();
    const elapsed = now() - this._lastSweep;

    if (pressure.level === 'critical') {
      const result = await this.sweep({ aggressive: true });
      return { action: 'emergency-sweep', result };
    }

    if (pressure.level === 'high' || elapsed > this.config.sweepIntervalMs) {
      const result = await this.sweep();
      return { action: 'scheduled-sweep', result };
    }

    return { action: 'none', pressure };
  }

  // ═══════════════════════════════════════════════════════════
  //  Utility
  // ═══════════════════════════════════════════════════════════

  getLog(limit) {
    return readJSON(LOG_PATH, []).slice(-(limit || 50)).reverse();
  }

  getStatus() {
    const pressure = this.getMemoryPressure();
    const protected_ = readJSON(PROTECTED_PATH, {});
    const graveyard = readJSON(GRAVEYARD_PATH, []);
    return {
      pressure,
      protectedCount: Object.keys(protected_).length,
      graveyardSize: graveyard.length,
      totalForgotten: this._totalForgotten,
      totalCompressed: this._totalCompressed,
      totalResurrected: this._totalResurrected,
      contradictionsResolved: this._contradictionsResolved,
      interferencesResolved: this._interferencesResolved,
      sweepCount: this._sweepCount,
      lastSweep: this._lastSweep ? new Date(this._lastSweep).toISOString() : null,
    };
  }
}

AntiMemory.POLICIES = POLICIES;
module.exports = AntiMemory;
