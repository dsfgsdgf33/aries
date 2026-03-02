/**
 * ARIES — Anti-Memory (Strategic Forgetting v2)
 * Systems that can't forget get slower, dumber, more rigid.
 * Manages memory lifecycle: decay, compression, contradiction resolution,
 * irrelevance culling, interference competition, and deliberate forgetting.
 * 
 * Replaces and vastly extends strategic-forgetting.js.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

const DATA_DIR = path.join(__dirname, '..', 'data', 'forgetting');
const GRAVEYARD_PATH = path.join(DATA_DIR, 'graveyard.json');
const ANALYTICS_PATH = path.join(DATA_DIR, 'analytics.json');
const PROTECTED_PATH = path.join(DATA_DIR, 'protected.json');
const STATE_PATH = path.join(DATA_DIR, 'state.json');
const LOG_PATH = path.join(DATA_DIR, 'log.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }
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
  pressureThreshold: 0.7,       // Start aggressive forgetting at 70% capacity
  criticalPressure: 0.9,        // Emergency sweep at 90%
  decayHalfLife: 7 * 24 * 3600 * 1000, // 7 days half-life
  decayMinStrength: 0.05,       // Below this, candidate for forgetting
  compressionAgeMs: 14 * 24 * 3600 * 1000, // Compress memories older than 14 days
  compressionBatchSize: 5,      // Compress up to 5 memories at once
  irrelevanceThreshold: 0,      // Memories with 0 decision influence get culled
  interferenceSimThreshold: 0.8,// Similarity above which memories compete
  sweepIntervalMs: 3600 * 1000, // Sweep every hour
  graveyardMaxSize: 500,        // Max tombstones before pruning graveyard itself
  analyticsWindow: 30 * 24 * 3600 * 1000, // 30-day analytics window
};

class AntiMemory extends EventEmitter {
  /**
   * @param {object} opts
   * @param {object} opts.ai - LLM access for compression/deliberate forgetting
   * @param {object} opts.config - Override default config
   */
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
  }

  _saveState() {
    writeJSON(STATE_PATH, {
      lastSweep: this._lastSweep,
      totalForgotten: this._totalForgotten,
      totalCompressed: this._totalCompressed,
      totalResurrected: this._totalResurrected,
      sweepCount: this._sweepCount,
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

  /**
   * Gather all memories from known sources.
   * Returns array of { id, text, created, lastAccessed, accessCount, category, priority, source, meta }
   */
  _gatherMemories() {
    const memories = [];

    // memory.json (core memory module)
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

  /**
   * Crystallize a memory — make it immune to forgetting
   * @param {string} memoryId
   * @param {string} reason
   * @returns {{protected: boolean, id: string}}
   */
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

  /**
   * Remove crystallization from a memory
   * @param {string} memoryId
   * @returns {{unprotected: boolean}}
   */
  unprotect(memoryId) {
    const protected_ = readJSON(PROTECTED_PATH, {});
    if (!protected_[memoryId]) return { unprotected: false, error: 'Not protected' };
    delete protected_[memoryId];
    writeJSON(PROTECTED_PATH, protected_);
    this._log('unprotect', { memoryId });
    this.emit('unprotected', { memoryId });
    return { unprotected: true };
  }

  /**
   * Check if a memory is crystallized
   * @param {string} memoryId
   * @returns {boolean}
   */
  isProtected(memoryId) {
    const protected_ = readJSON(PROTECTED_PATH, {});
    return !!protected_[memoryId];
  }

  /**
   * Get all protected memory IDs
   * @returns {object}
   */
  getProtected() {
    return readJSON(PROTECTED_PATH, {});
  }

  // ═══════════════════════════════════════════════════════════
  //  Decay Scoring
  // ═══════════════════════════════════════════════════════════

  /**
   * Compute decay strength for a memory (exponential decay based on time since last access)
   * @param {object} memory
   * @returns {number} 0-1 strength
   */
  _decayStrength(memory) {
    const lastTouch = memory.lastAccessed || memory.created;
    const elapsed = now() - lastTouch;
    const halfLife = this.config.decayHalfLife;
    // Exponential decay: strength = 2^(-elapsed/halfLife)
    let strength = Math.pow(2, -elapsed / halfLife);
    // Boost for access count (more accessed = slower decay)
    const accessBoost = Math.min(memory.accessCount * 0.05, 0.5);
    strength = Math.min(1, strength + accessBoost);
    // Priority boost
    const priorityBoosts = { critical: 0.4, high: 0.2, normal: 0, low: -0.1 };
    strength += priorityBoosts[memory.priority] || 0;
    return Math.max(0, Math.min(1, strength));
  }

  /**
   * Compute forget-worthiness score (higher = more forgettable)
   * @param {object} memory
   * @returns {number}
   */
  _forgetScore(memory) {
    const age = (now() - memory.created) / (24 * 3600 * 1000); // days
    const decayStr = this._decayStrength(memory);
    const irrelevance = memory.accessCount === 0 ? 1 : 1 / (1 + memory.accessCount);
    const redundancy = 0; // Would need comparison with other memories — computed in analyzeCandidates

    // forget-worthiness = age × irrelevance × (1 - strength)
    return age * irrelevance * (1 - decayStr);
  }

  // ═══════════════════════════════════════════════════════════
  //  Candidate Analysis
  // ═══════════════════════════════════════════════════════════

  /**
   * Scan all memories and score them for forgetting
   * @param {object} opts - { limit, minScore, policies }
   * @returns {Array<{memory: object, score: number, policies: string[], reason: string}>}
   */
  analyzeCandidates(opts = {}) {
    const limit = opts.limit || 50;
    const minScore = opts.minScore || 0;
    const memories = this._gatherMemories();
    const protected_ = readJSON(PROTECTED_PATH, {});
    const candidates = [];

    for (const mem of memories) {
      // Skip protected memories
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
      if (mem.accessCount <= this.config.irrelevanceThreshold && (now() - mem.created) > 3 * 24 * 3600 * 1000) {
        policies.push(POLICIES.IRRELEVANCE);
        reasons.push(`never accessed in ${Math.floor((now() - mem.created) / (24 * 3600 * 1000))} days`);
      }

      // COMPRESSION candidate (old but not worthless)
      if ((now() - mem.created) > this.config.compressionAgeMs && strength > this.config.decayMinStrength) {
        policies.push(POLICIES.COMPRESSION);
        reasons.push('old enough for compression');
      }

      if (policies.length > 0 && score >= minScore) {
        candidates.push({
          memory: mem,
          score,
          strength,
          policies,
          reason: reasons.join('; '),
        });
      }
    }

    // Sort by score descending (most forgettable first)
    candidates.sort((a, b) => b.score - a.score);

    this.emit('analyzed', { candidateCount: candidates.length, totalMemories: memories.length });
    return candidates.slice(0, limit);
  }

  // ═══════════════════════════════════════════════════════════
  //  Forgetting
  // ═══════════════════════════════════════════════════════════

  /**
   * Move a memory to the graveyard
   * @param {string} memoryId
   * @param {string} policy - Which policy triggered this
   * @param {string} reason - Human-readable reason
   * @returns {{forgotten: boolean, tombstone: object}}
   */
  forget(memoryId, policy, reason) {
    if (this.isProtected(memoryId)) {
      return { forgotten: false, error: 'Memory is crystallized (protected)' };
    }

    // Find the memory
    const memories = this._gatherMemories();
    const memory = memories.find(m => m.id === memoryId);
    if (!memory) return { forgotten: false, error: 'Memory not found' };

    // Create tombstone
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
      meta: memory.meta,
    };

    // Add to graveyard
    const graveyard = readJSON(GRAVEYARD_PATH, []);
    graveyard.push(tombstone);
    // Prune graveyard if too large
    if (graveyard.length > this.config.graveyardMaxSize) {
      // Remove oldest non-resurrected tombstones
      const excess = graveyard.length - this.config.graveyardMaxSize;
      let removed = 0;
      for (let i = 0; i < graveyard.length && removed < excess; i++) {
        if (!graveyard[i].resurrected) {
          graveyard.splice(i, 1);
          i--;
          removed++;
        }
      }
    }
    writeJSON(GRAVEYARD_PATH, graveyard);

    // Remove from source
    this._removeFromSource(memory);

    // Update analytics
    this._recordAnalytic('forget', { policy, category: memory.category });

    this._totalForgotten++;
    this._saveState();
    this._log('forget', { memoryId, policy, reason });
    this.emit('forgotten', { memoryId, policy, reason, tombstone });

    return { forgotten: true, tombstone };
  }

  /**
   * Remove a memory from its source store
   * @param {object} memory
   */
  _removeFromSource(memory) {
    try {
      if (memory.source === 'memory.json') {
        const memFile = path.join(__dirname, '..', 'data', 'memory.json');
        if (!fs.existsSync(memFile)) return;
        const data = JSON.parse(fs.readFileSync(memFile, 'utf8'));
        if (!Array.isArray(data)) return;
        const idx = data.findIndex(e => (e.key || e.text?.substring(0, 50)) === memory.id);
        if (idx >= 0) {
          data.splice(idx, 1);
          fs.writeFileSync(memFile, JSON.stringify(data, null, 2));
        }
      } else if (memory.source === 'cross-session') {
        const key = memory.id.replace('cs:', '');
        const csDir = path.join(__dirname, '..', 'data', 'cross-session');
        // Try to find and remove the file
        const files = fs.readdirSync(csDir).filter(f => f.endsWith('.json'));
        for (const file of files) {
          try {
            const d = JSON.parse(fs.readFileSync(path.join(csDir, file), 'utf8'));
            if (d.key === key) {
              fs.unlinkSync(path.join(csDir, file));
              break;
            }
          } catch { /* skip */ }
        }
      }
      // persistent-memory daily notes: don't delete lines from daily notes (too destructive)
    } catch { /* best effort */ }
  }

  // ═══════════════════════════════════════════════════════════
  //  Compression
  // ═══════════════════════════════════════════════════════════

  /**
   * Compress multiple memories into a single summary
   * @param {string[]} memoryIds - IDs to compress
   * @param {string} [customSummary] - Provide summary instead of AI-generating one
   * @returns {Promise<{compressed: boolean, summary: string, original: number}>}
   */
  async compress(memoryIds, customSummary) {
    const memories = this._gatherMemories();
    const toCompress = memories.filter(m => memoryIds.includes(m.id));
    if (toCompress.length === 0) return { compressed: false, error: 'No matching memories found' };

    // Check for protected
    const protected_ = readJSON(PROTECTED_PATH, {});
    const blocked = toCompress.filter(m => protected_[m.id]);
    if (blocked.length > 0) {
      return { compressed: false, error: `${blocked.length} memories are crystallized` };
    }

    let summary = customSummary || null;

    // Use AI for summarization if available
    if (!summary && this.ai) {
      try {
        const texts = toCompress.map(m => m.text).join('\n---\n');
        const prompt = `Compress these ${toCompress.length} memory entries into a single concise summary that preserves key facts and insights. Be brief but complete.\n\n${texts}`;
        const result = await this.ai.chat([{ role: 'user', content: prompt }], { maxTokens: 300 });
        summary = result.text || result.content || result;
      } catch {
        // Fallback: simple concatenation
        summary = toCompress.map(m => m.text.substring(0, 100)).join(' | ');
      }
    }

    if (!summary) {
      summary = toCompress.map(m => m.text.substring(0, 100)).join(' | ');
    }

    // Forget originals, move to graveyard
    for (const mem of toCompress) {
      this.forget(mem.id, POLICIES.COMPRESSION, `compressed with ${toCompress.length - 1} other memories`);
    }

    // Add compressed summary as new memory
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
  //  Graveyard
  // ═══════════════════════════════════════════════════════════

  /**
   * Browse forgotten memories
   * @param {object} filter - { policy, category, limit, search }
   * @returns {Array}
   */
  getGraveyard(filter = {}) {
    let graveyard = readJSON(GRAVEYARD_PATH, []);

    if (filter.policy) graveyard = graveyard.filter(t => t.policy === filter.policy);
    if (filter.category) graveyard = graveyard.filter(t => t.category === filter.category);
    if (filter.resurrected !== undefined) graveyard = graveyard.filter(t => t.resurrected === filter.resurrected);
    if (filter.search) {
      const q = filter.search.toLowerCase();
      graveyard = graveyard.filter(t => t.summary.toLowerCase().includes(q) || (t.fullText || '').toLowerCase().includes(q));
    }

    // Sort by forgottenAt descending
    graveyard.sort((a, b) => b.forgottenAt - a.forgottenAt);

    const limit = filter.limit || 50;
    return graveyard.slice(0, limit);
  }

  /**
   * Resurrect a forgotten memory
   * @param {string} graveyardId - Tombstone ID
   * @returns {{resurrected: boolean, memory: object}}
   */
  resurrect(graveyardId) {
    const graveyard = readJSON(GRAVEYARD_PATH, []);
    const tombstone = graveyard.find(t => t.id === graveyardId);
    if (!tombstone) return { resurrected: false, error: 'Tombstone not found' };
    if (tombstone.resurrected) return { resurrected: false, error: 'Already resurrected' };

    // Re-add to memory.json
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

    // Mark tombstone as resurrected
    tombstone.resurrected = true;
    tombstone.resurrectedAt = now();
    writeJSON(GRAVEYARD_PATH, graveyard);

    this._totalResurrected++;
    this._saveState();
    this._recordAnalytic('resurrect', { policy: tombstone.policy });
    this._log('resurrect', { graveyardId, originalId: tombstone.originalId });
    this.emit('resurrected', { graveyardId, originalId: tombstone.originalId });

    return { resurrected: true, memory: tombstone };
  }

  // ═══════════════════════════════════════════════════════════
  //  Memory Pressure
  // ═══════════════════════════════════════════════════════════

  /**
   * Get current memory load vs capacity
   * @returns {{current: number, max: number, pressure: number, level: string}}
   */
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

  /**
   * Run a complete forgetting cycle
   * @param {object} opts - { dryRun, aggressive, maxForget }
   * @returns {{swept: number, compressed: number, candidates: number, pressure: object}}
   */
  async sweep(opts = {}) {
    const dryRun = opts.dryRun || false;
    const maxForget = opts.maxForget || 20;
    const pressure = this.getMemoryPressure();

    // Determine aggressiveness based on pressure
    let aggressive = opts.aggressive || false;
    if (pressure.level === 'critical') aggressive = true;

    const minScore = aggressive ? 1 : 5;
    const candidates = this.analyzeCandidates({ limit: maxForget * 2, minScore });

    let swept = 0;
    let compressed = 0;
    const forgetCandidates = [];
    const compressCandidates = [];

    for (const c of candidates) {
      if (c.policies.includes(POLICIES.COMPRESSION) && !c.policies.includes(POLICIES.DECAY)) {
        compressCandidates.push(c);
      } else {
        forgetCandidates.push(c);
      }
    }

    if (!dryRun) {
      // Forget high-score candidates
      for (const c of forgetCandidates.slice(0, maxForget)) {
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
        for (const [cat, ids] of Object.entries(byCategory)) {
          if (ids.length >= 2) {
            const batch = ids.slice(0, this.config.compressionBatchSize);
            const result = await this.compress(batch);
            if (result.compressed) compressed += batch.length;
          }
        }
      }

      this._lastSweep = now();
      this._sweepCount++;
      this._saveState();
    }

    const result = {
      swept,
      compressed,
      candidates: candidates.length,
      pressure,
      dryRun,
      aggressive,
    };

    this._log('sweep', result);
    this.emit('swept', result);
    return result;
  }

  // ═══════════════════════════════════════════════════════════
  //  Deliberate Forgetting (AI-driven)
  // ═══════════════════════════════════════════════════════════

  /**
   * Use AI to decide what's actively harmful to remember
   * @returns {Promise<{candidates: Array, analyzed: number}>}
   */
  async analyzeDeliberate() {
    if (!this.ai) return { candidates: [], analyzed: 0, error: 'No AI available' };

    const memories = this._gatherMemories();
    const protected_ = readJSON(PROTECTED_PATH, {});

    // Sample up to 30 unprotected memories for analysis
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

      // Parse JSON from response
      const match = text.match(/\[[\s\S]*\]/);
      if (!match) return { candidates: [], analyzed: sample.length };

      const harmful = JSON.parse(match[0]);
      const candidates = [];
      for (const h of harmful) {
        const idx = h.index;
        if (idx >= 0 && idx < sample.length) {
          candidates.push({
            memory: sample[idx],
            policy: POLICIES.DELIBERATE,
            reason: h.reason,
          });
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
    // Prune old events
    const cutoff = now() - this.config.analyticsWindow;
    analytics.events = analytics.events.filter(e => e.at > cutoff);
    writeJSON(ANALYTICS_PATH, analytics);
  }

  /**
   * Get forgetting statistics
   * @returns {object}
   */
  getAnalytics() {
    const analytics = readJSON(ANALYTICS_PATH, { events: [] });
    const graveyard = readJSON(GRAVEYARD_PATH, []);
    const pressure = this.getMemoryPressure();

    // Count by policy
    const byPolicy = {};
    const byCategory = {};
    let forgetCount = 0;
    let compressCount = 0;
    let resurrectCount = 0;

    for (const event of analytics.events) {
      if (event.action === 'forget') {
        forgetCount++;
        const p = event.policy || 'unknown';
        byPolicy[p] = (byPolicy[p] || 0) + 1;
        const c = event.category || 'unknown';
        byCategory[c] = (byCategory[c] || 0) + 1;
      } else if (event.action === 'compress') {
        compressCount += event.count || 1;
      } else if (event.action === 'resurrect') {
        resurrectCount++;
      }
    }

    // Resurrection rate (indicator of over-aggressive forgetting)
    const resurrectionRate = forgetCount > 0 ? resurrectCount / forgetCount : 0;

    return {
      totalForgotten: this._totalForgotten,
      totalCompressed: this._totalCompressed,
      totalResurrected: this._totalResurrected,
      sweepCount: this._sweepCount,
      recentWindow: {
        forgotten: forgetCount,
        compressed: compressCount,
        resurrected: resurrectCount,
        byPolicy,
        byCategory,
      },
      resurrectionRate: Math.round(resurrectionRate * 1000) / 1000,
      graveyardSize: graveyard.length,
      pressure,
      health: resurrectionRate > 0.3 ? 'over-aggressive' : resurrectionRate > 0.1 ? 'slightly-aggressive' : 'healthy',
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  Tick (Periodic)
  // ═══════════════════════════════════════════════════════════

  /**
   * Periodic check — runs sweep if pressure is high or enough time has passed
   * @returns {Promise<{action: string, result?: object}>}
   */
  async tick() {
    const pressure = this.getMemoryPressure();
    const elapsed = now() - this._lastSweep;

    // Critical pressure: sweep immediately
    if (pressure.level === 'critical') {
      const result = await this.sweep({ aggressive: true });
      return { action: 'emergency-sweep', result };
    }

    // High pressure or interval elapsed: normal sweep
    if (pressure.level === 'high' || elapsed > this.config.sweepIntervalMs) {
      const result = await this.sweep();
      return { action: 'scheduled-sweep', result };
    }

    return { action: 'none', pressure };
  }

  // ═══════════════════════════════════════════════════════════
  //  Utility
  // ═══════════════════════════════════════════════════════════

  /**
   * Get log entries
   * @param {number} limit
   * @returns {Array}
   */
  getLog(limit) {
    const log = readJSON(LOG_PATH, []);
    return log.slice(-(limit || 50)).reverse();
  }

  /**
   * Get status overview
   * @returns {object}
   */
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
      sweepCount: this._sweepCount,
      lastSweep: this._lastSweep ? new Date(this._lastSweep).toISOString() : null,
    };
  }
}

AntiMemory.POLICIES = POLICIES;

module.exports = AntiMemory;
