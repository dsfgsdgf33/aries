/**
 * ARIES — Emergent Language System
 * Internal compression that evolves. The system developing its own cognitive shortcuts.
 * Symbols are created, compete, merge, and die — producing an ever-evolving internal vocabulary.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

const DATA_DIR = path.join(__dirname, '..', 'data', 'emergent');
const VOCAB_PATH = path.join(DATA_DIR, 'vocabulary.json');
const EPOCHS_PATH = path.join(DATA_DIR, 'language-epochs.json');
const STATS_PATH = path.join(DATA_DIR, 'language-stats.json');

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function now() { return Date.now(); }

// Generate a short symbol glyph: Σ followed by a base-36 hash fragment
function mintGlyph(concept) {
  const hash = crypto.createHash('sha256').update(concept + now()).digest('hex');
  return 'Σ' + parseInt(hash.slice(0, 8), 16).toString(36).toUpperCase().slice(0, 5);
}

class EmergentLanguage extends EventEmitter {
  /**
   * @param {object} [opts]
   * @param {object} [opts.ai] - AI core for semantic analysis
   * @param {object} [opts.config] - Settings overrides
   */
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null;
    this.config = Object.assign({
      maxSymbols: 500,
      mergeThreshold: 0.85,       // similarity above which symbols merge
      decayRate: 0.02,            // per-tick fitness decay
      mutationRate: 0.05,         // chance of symbol mutation per tick
      epochThreshold: 20,         // vocabulary changes that trigger a new epoch
      minFitnessToSurvive: 0.1,   // symbols below this get deprecated
    }, opts.config || {});

    ensureDir();
    this._changesSinceEpoch = 0;
  }

  // ── Persistence helpers ──

  _getVocab() { return readJSON(VOCAB_PATH, { symbols: {}, deprecated: [] }); }
  _saveVocab(v) { writeJSON(VOCAB_PATH, v); }
  _getEpochs() { return readJSON(EPOCHS_PATH, []); }
  _saveEpochs(e) { writeJSON(EPOCHS_PATH, e); }
  _getStats() { return readJSON(STATS_PATH, { totalCreated: 0, totalDeprecated: 0, totalMerges: 0, totalCompressions: 0, totalDecompressions: 0, totalCharsRaw: 0, totalCharsCompressed: 0 }); }
  _saveStats(s) { writeJSON(STATS_PATH, s); }

  // ── Core Methods ──

  /**
   * Mint a new internal symbol for a concept.
   * @param {string} concept - The full concept/phrase to compress
   * @param {string} [context] - Where/why this symbol was created
   * @returns {object} The new symbol record
   */
  createSymbol(concept, context) {
    if (!concept || typeof concept !== 'string') return { error: 'concept required' };

    const vocab = this._getVocab();
    const stats = this._getStats();

    // Check if a symbol already covers this concept closely
    for (const [glyph, sym] of Object.entries(vocab.symbols)) {
      if (sym.concept.toLowerCase() === concept.toLowerCase()) {
        sym.useCount = (sym.useCount || 0) + 1;
        sym.lastUsed = now();
        this._saveVocab(vocab);
        return { existing: true, symbol: sym };
      }
    }

    const glyph = mintGlyph(concept);
    const symbol = {
      glyph,
      concept,
      context: context || null,
      grounding: [{ meaning: concept, weight: 1.0, assignedAt: now() }],
      fitness: 1.0,
      useCount: 0,
      createdAt: now(),
      lastUsed: now(),
      mutations: 0,
      generation: 0,
      parentGlyph: null,
    };

    vocab.symbols[glyph] = symbol;

    // Cap vocabulary size
    if (Object.keys(vocab.symbols).length > this.config.maxSymbols) {
      this._pruneWeakest(vocab);
    }

    stats.totalCreated++;
    this._changesSinceEpoch++;

    this._saveVocab(vocab);
    this._saveStats(stats);
    this.emit('symbol-created', symbol);

    return symbol;
  }

  /**
   * Evolve the vocabulary: mutate, compete, merge, deprecate.
   * @returns {object} Evolution summary
   */
  evolve() {
    const vocab = this._getVocab();
    const stats = this._getStats();
    const glyphs = Object.keys(vocab.symbols);
    const summary = { mutations: 0, merges: 0, deprecated: 0, survived: 0 };

    if (glyphs.length === 0) return summary;

    // 1. Decay fitness
    for (const glyph of glyphs) {
      const sym = vocab.symbols[glyph];
      sym.fitness = Math.max(0, sym.fitness - this.config.decayRate);
      // Usage recency bonus
      const ageSinceUse = (now() - (sym.lastUsed || sym.createdAt)) / (1000 * 60 * 60); // hours
      if (ageSinceUse < 1) sym.fitness = Math.min(1.0, sym.fitness + 0.05);
    }

    // 2. Mutate: small meaning drift on random symbols
    for (const glyph of glyphs) {
      if (Math.random() < this.config.mutationRate) {
        const sym = vocab.symbols[glyph];
        const grounding = sym.grounding || [];
        if (grounding.length > 0) {
          // Shift weights slightly
          for (const g of grounding) {
            g.weight = Math.max(0.01, Math.min(1.0, g.weight + (Math.random() - 0.5) * 0.1));
          }
          sym.mutations = (sym.mutations || 0) + 1;
          summary.mutations++;
        }
      }
    }

    // 3. Merge similar symbols
    const checked = new Set();
    for (let i = 0; i < glyphs.length; i++) {
      for (let j = i + 1; j < glyphs.length; j++) {
        const a = vocab.symbols[glyphs[i]];
        const b = vocab.symbols[glyphs[j]];
        if (!a || !b) continue;
        const key = glyphs[i] + ':' + glyphs[j];
        if (checked.has(key)) continue;
        checked.add(key);

        const sim = this._conceptSimilarity(a.concept, b.concept);
        if (sim >= this.config.mergeThreshold) {
          // Merge b into a (keep the fitter one)
          const [winner, loser, winGlyph, loseGlyph] = a.fitness >= b.fitness
            ? [a, b, glyphs[i], glyphs[j]]
            : [b, a, glyphs[j], glyphs[i]];

          winner.fitness = Math.min(1.0, winner.fitness + loser.fitness * 0.5);
          winner.useCount = (winner.useCount || 0) + (loser.useCount || 0);
          // Absorb grounding
          winner.grounding = (winner.grounding || []).concat(loser.grounding || []);
          // Deduplicate grounding by meaning
          const seen = new Set();
          winner.grounding = winner.grounding.filter(g => {
            const k = g.meaning.toLowerCase();
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          });

          vocab.deprecated.push({ glyph: loseGlyph, mergedInto: winGlyph, concept: loser.concept, at: now() });
          delete vocab.symbols[loseGlyph];

          summary.merges++;
          stats.totalMerges++;
          this._changesSinceEpoch++;
        }
      }
    }

    // 4. Deprecate unfit symbols
    for (const glyph of Object.keys(vocab.symbols)) {
      const sym = vocab.symbols[glyph];
      if (sym.fitness < this.config.minFitnessToSurvive && sym.useCount < 2) {
        vocab.deprecated.push({ glyph, concept: sym.concept, fitness: sym.fitness, at: now() });
        delete vocab.symbols[glyph];
        summary.deprecated++;
        stats.totalDeprecated++;
        this._changesSinceEpoch++;
      } else {
        summary.survived++;
      }
    }

    // Cap deprecated log
    if (vocab.deprecated.length > 500) vocab.deprecated = vocab.deprecated.slice(-500);

    // 5. Check for epoch
    if (this._changesSinceEpoch >= this.config.epochThreshold) {
      this._recordEpoch(vocab, summary);
      this._changesSinceEpoch = 0;
    }

    this._saveVocab(vocab);
    this._saveStats(stats);
    this.emit('evolved', summary);

    return summary;
  }

  /**
   * Compress text using internal vocabulary.
   * @param {string} text
   * @returns {{ compressed: string, ratio: number, symbolsUsed: string[] }}
   */
  compress(text) {
    if (!text) return { compressed: '', ratio: 1.0, symbolsUsed: [] };

    const vocab = this._getVocab();
    const stats = this._getStats();
    let compressed = text;
    const used = [];

    // Sort symbols by concept length descending (replace longest matches first)
    const entries = Object.entries(vocab.symbols)
      .sort((a, b) => b[1].concept.length - a[1].concept.length);

    for (const [glyph, sym] of entries) {
      const concept = sym.concept;
      // Case-insensitive replacement
      const regex = new RegExp(this._escapeRegex(concept), 'gi');
      if (regex.test(compressed)) {
        compressed = compressed.replace(regex, glyph);
        sym.useCount = (sym.useCount || 0) + 1;
        sym.lastUsed = now();
        sym.fitness = Math.min(1.0, sym.fitness + 0.1);
        used.push(glyph);
      }
    }

    const ratio = text.length > 0 ? compressed.length / text.length : 1.0;

    stats.totalCompressions++;
    stats.totalCharsRaw += text.length;
    stats.totalCharsCompressed += compressed.length;

    this._saveVocab(vocab);
    this._saveStats(stats);

    return { compressed, ratio: Math.round(ratio * 1000) / 1000, symbolsUsed: used };
  }

  /**
   * Decompress internal language back to full text.
   * @param {string} compressed
   * @returns {string}
   */
  decompress(compressed) {
    if (!compressed) return '';

    const vocab = this._getVocab();
    const stats = this._getStats();
    let expanded = compressed;

    // Replace all known glyphs with their primary concept
    for (const [glyph, sym] of Object.entries(vocab.symbols)) {
      if (expanded.includes(glyph)) {
        const primary = (sym.grounding && sym.grounding.length > 0)
          ? sym.grounding.reduce((best, g) => g.weight > best.weight ? g : best, sym.grounding[0]).meaning
          : sym.concept;
        expanded = expanded.split(glyph).join(primary);
      }
    }

    stats.totalDecompressions++;
    this._saveStats(stats);

    return expanded;
  }

  /**
   * Get current vocabulary.
   * @returns {object[]}
   */
  getVocabulary() {
    const vocab = this._getVocab();
    return Object.values(vocab.symbols)
      .sort((a, b) => (b.useCount || 0) - (a.useCount || 0))
      .map(s => ({
        glyph: s.glyph,
        concept: s.concept,
        fitness: Math.round(s.fitness * 100) / 100,
        useCount: s.useCount || 0,
        groundingCount: (s.grounding || []).length,
        generation: s.generation || 0,
        mutations: s.mutations || 0,
        age: now() - s.createdAt,
      }));
  }

  /**
   * Overall compression ratio.
   * @returns {{ ratio: number, totalRaw: number, totalCompressed: number }}
   */
  getCompressionRatio() {
    const stats = this._getStats();
    const ratio = stats.totalCharsRaw > 0
      ? stats.totalCharsCompressed / stats.totalCharsRaw
      : 1.0;
    return {
      ratio: Math.round(ratio * 1000) / 1000,
      totalRaw: stats.totalCharsRaw,
      totalCompressed: stats.totalCharsCompressed,
      symbolCount: Object.keys(this._getVocab().symbols).length,
    };
  }

  /**
   * Get language evolution epochs.
   * @returns {object[]}
   */
  getEpochs() {
    return this._getEpochs();
  }

  /**
   * Periodic evolution tick.
   * @returns {object}
   */
  tick() {
    return this.evolve();
  }

  // ── Internal helpers ──

  _escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  _conceptSimilarity(a, b) {
    // Simple word-overlap Jaccard similarity
    const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
    const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
    if (wordsA.size === 0 && wordsB.size === 0) return 1.0;
    let intersection = 0;
    for (const w of wordsA) { if (wordsB.has(w)) intersection++; }
    const union = new Set([...wordsA, ...wordsB]).size;
    return union > 0 ? intersection / union : 0;
  }

  _pruneWeakest(vocab) {
    const entries = Object.entries(vocab.symbols)
      .sort((a, b) => a[1].fitness - b[1].fitness);
    // Remove bottom 10%
    const removeCount = Math.max(1, Math.floor(entries.length * 0.1));
    for (let i = 0; i < removeCount; i++) {
      const [glyph, sym] = entries[i];
      vocab.deprecated.push({ glyph, concept: sym.concept, reason: 'pruned', at: now() });
      delete vocab.symbols[glyph];
      this._changesSinceEpoch++;
    }
  }

  _recordEpoch(vocab, summary) {
    const epochs = this._getEpochs();
    const activeSymbols = Object.values(vocab.symbols);
    const epoch = {
      id: uuid(),
      number: epochs.length + 1,
      timestamp: now(),
      vocabSize: activeSymbols.length,
      avgFitness: activeSymbols.length > 0
        ? Math.round(activeSymbols.reduce((s, sym) => s + sym.fitness, 0) / activeSymbols.length * 100) / 100
        : 0,
      topSymbols: activeSymbols
        .sort((a, b) => (b.useCount || 0) - (a.useCount || 0))
        .slice(0, 5)
        .map(s => ({ glyph: s.glyph, concept: s.concept, uses: s.useCount })),
      trigger: summary,
      deprecatedTotal: vocab.deprecated.length,
    };
    epochs.push(epoch);
    if (epochs.length > 100) epochs.splice(0, epochs.length - 100);
    this._saveEpochs(epochs);
    this.emit('epoch', epoch);
  }
}

module.exports = EmergentLanguage;
