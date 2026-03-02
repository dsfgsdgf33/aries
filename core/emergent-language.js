/**
 * ARIES — Emergent Language System v2.0
 * Internal compression that evolves. The system developing its own cognitive shortcuts.
 * Symbols are created, compete, merge, mutate, and die — producing an ever-evolving internal vocabulary.
 *
 * Features: Symbol creation with glyph generation, fitness-based survival, mutation (meaning drift),
 * symbol merging, compression/decompression, language epochs, symbol genealogy,
 * compression ratio tracking, cross-module adoption tracking, dictionary/glossary generation.
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
const GENEALOGY_PATH = path.join(DATA_DIR, 'symbol-genealogy.json');
const ADOPTION_PATH = path.join(DATA_DIR, 'module-adoption.json');

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function now() { return Date.now(); }

// Generate glyph: § prefix + base-36 hash fragment
function mintGlyph(concept) {
  const hash = crypto.createHash('sha256').update(concept + now()).digest('hex');
  return '§' + parseInt(hash.slice(0, 8), 16).toString(36).toUpperCase().slice(0, 5);
}

class EmergentLanguage extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null;
    this.config = Object.assign({
      maxSymbols: 500,
      mergeThreshold: 0.85,
      decayRate: 0.02,
      mutationRate: 0.05,
      epochThreshold: 20,
      minFitnessToSurvive: 0.1,
    }, opts.config || {});

    ensureDir();
    this._changesSinceEpoch = 0;
  }

  // ── Persistence helpers ──

  _getVocab() { return readJSON(VOCAB_PATH, { symbols: {}, deprecated: [] }); }
  _saveVocab(v) { writeJSON(VOCAB_PATH, v); }
  _getEpochs() { return readJSON(EPOCHS_PATH, []); }
  _saveEpochs(e) { writeJSON(EPOCHS_PATH, e); }
  _getStats() { return readJSON(STATS_PATH, { totalCreated: 0, totalDeprecated: 0, totalMerges: 0, totalMutations: 0, totalCompressions: 0, totalDecompressions: 0, totalCharsRaw: 0, totalCharsCompressed: 0 }); }
  _saveStats(s) { writeJSON(STATS_PATH, s); }
  _getGenealogy() { return readJSON(GENEALOGY_PATH, { trees: {}, events: [] }); }
  _saveGenealogy(g) { writeJSON(GENEALOGY_PATH, g); }
  _getAdoption() { return readJSON(ADOPTION_PATH, {}); }
  _saveAdoption(a) { writeJSON(ADOPTION_PATH, a); }

  // ── Core Methods ──

  /**
   * Mint a new internal symbol for a concept.
   */
  createSymbol(concept, context) {
    if (!concept || typeof concept !== 'string') return { error: 'concept required' };

    const vocab = this._getVocab();
    const stats = this._getStats();

    // Check for existing exact match
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
      adoptedBy: [],   // modules that use this symbol
    };

    vocab.symbols[glyph] = symbol;

    if (Object.keys(vocab.symbols).length > this.config.maxSymbols) {
      this._pruneWeakest(vocab);
    }

    stats.totalCreated++;
    this._changesSinceEpoch++;

    // Record in genealogy
    this._recordGenealogy('birth', { glyph, concept, generation: 0, parent: null });

    this._saveVocab(vocab);
    this._saveStats(stats);
    this.emit('symbol-created', symbol);

    return symbol;
  }

  /**
   * Record that a module is using a symbol (cross-module adoption tracking).
   */
  recordAdoption(glyph, moduleId) {
    const vocab = this._getVocab();
    const sym = vocab.symbols[glyph];
    if (!sym) return { error: 'Symbol not found' };

    if (!sym.adoptedBy) sym.adoptedBy = [];
    if (!sym.adoptedBy.includes(moduleId)) {
      sym.adoptedBy.push(moduleId);
      sym.fitness = Math.min(1.0, sym.fitness + 0.05);
    }
    sym.useCount++;
    sym.lastUsed = now();
    this._saveVocab(vocab);

    // Track per-module adoption
    const adoption = this._getAdoption();
    if (!adoption[moduleId]) adoption[moduleId] = { symbols: [], totalAdoptions: 0 };
    if (!adoption[moduleId].symbols.includes(glyph)) {
      adoption[moduleId].symbols.push(glyph);
    }
    adoption[moduleId].totalAdoptions++;
    adoption[moduleId].lastAdoption = now();
    this._saveAdoption(adoption);

    return { glyph, moduleId, totalAdopters: sym.adoptedBy.length };
  }

  /**
   * Get cross-module adoption stats.
   */
  getAdoptionStats() {
    const adoption = this._getAdoption();
    const vocab = this._getVocab();

    const moduleStats = Object.entries(adoption).map(([mod, data]) => ({
      moduleId: mod,
      symbolCount: data.symbols.length,
      totalAdoptions: data.totalAdoptions,
    })).sort((a, b) => b.symbolCount - a.symbolCount);

    // Most widely adopted symbols
    const symbolAdoption = Object.entries(vocab.symbols)
      .filter(([, sym]) => (sym.adoptedBy || []).length > 0)
      .map(([glyph, sym]) => ({
        glyph,
        concept: sym.concept,
        adopters: sym.adoptedBy.length,
        modules: sym.adoptedBy,
      }))
      .sort((a, b) => b.adopters - a.adopters)
      .slice(0, 20);

    return { moduleStats, symbolAdoption };
  }

  /**
   * Evolve the vocabulary: mutate, compete, merge, deprecate.
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
      const ageSinceUse = (now() - (sym.lastUsed || sym.createdAt)) / (1000 * 60 * 60);
      if (ageSinceUse < 1) sym.fitness = Math.min(1.0, sym.fitness + 0.05);
      // Adoption bonus: widely adopted symbols are fitter
      if ((sym.adoptedBy || []).length > 2) sym.fitness = Math.min(1.0, sym.fitness + 0.02);
    }

    // 2. Mutate: small meaning drift on random symbols
    for (const glyph of glyphs) {
      if (Math.random() < this.config.mutationRate) {
        const sym = vocab.symbols[glyph];
        const grounding = sym.grounding || [];
        if (grounding.length > 0) {
          for (const g of grounding) {
            g.weight = Math.max(0.01, Math.min(1.0, g.weight + (Math.random() - 0.5) * 0.1));
          }
          sym.mutations = (sym.mutations || 0) + 1;
          summary.mutations++;
          stats.totalMutations = (stats.totalMutations || 0) + 1;

          this._recordGenealogy('mutation', {
            glyph,
            concept: sym.concept,
            generation: sym.generation,
            mutationCount: sym.mutations,
          });
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
          const [winner, loser, winGlyph, loseGlyph] = a.fitness >= b.fitness
            ? [a, b, glyphs[i], glyphs[j]]
            : [b, a, glyphs[j], glyphs[i]];

          winner.fitness = Math.min(1.0, winner.fitness + loser.fitness * 0.5);
          winner.useCount = (winner.useCount || 0) + (loser.useCount || 0);
          winner.grounding = (winner.grounding || []).concat(loser.grounding || []);
          const seen = new Set();
          winner.grounding = winner.grounding.filter(g => {
            const k = g.meaning.toLowerCase();
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          });
          // Merge adoption lists
          winner.adoptedBy = [...new Set([...(winner.adoptedBy || []), ...(loser.adoptedBy || [])])];

          vocab.deprecated.push({ glyph: loseGlyph, mergedInto: winGlyph, concept: loser.concept, at: now() });

          this._recordGenealogy('merge', {
            winner: winGlyph,
            loser: loseGlyph,
            winnerConcept: winner.concept,
            loserConcept: loser.concept,
          });

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
        this._recordGenealogy('death', { glyph, concept: sym.concept, fitness: sym.fitness });
        delete vocab.symbols[glyph];
        summary.deprecated++;
        stats.totalDeprecated++;
        this._changesSinceEpoch++;
      } else {
        summary.survived++;
      }
    }

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
   */
  compress(text) {
    if (!text) return { compressed: '', ratio: 1.0, symbolsUsed: [] };

    const vocab = this._getVocab();
    const stats = this._getStats();
    let compressed = text;
    const used = [];

    const entries = Object.entries(vocab.symbols)
      .sort((a, b) => b[1].concept.length - a[1].concept.length);

    for (const [glyph, sym] of entries) {
      const regex = new RegExp(this._escapeRegex(sym.concept), 'gi');
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
   */
  decompress(compressed) {
    if (!compressed) return '';

    const vocab = this._getVocab();
    const stats = this._getStats();
    let expanded = compressed;

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
        adopters: (s.adoptedBy || []).length,
        age: now() - s.createdAt,
      }));
  }

  /**
   * Generate a human-readable dictionary/glossary.
   */
  generateDictionary() {
    const vocab = this._getVocab();
    const entries = Object.values(vocab.symbols)
      .sort((a, b) => a.glyph.localeCompare(b.glyph));

    const dictionary = entries.map(sym => {
      const primaryMeaning = (sym.grounding && sym.grounding.length > 0)
        ? sym.grounding.reduce((best, g) => g.weight > best.weight ? g : best, sym.grounding[0]).meaning
        : sym.concept;
      const altMeanings = (sym.grounding || [])
        .filter(g => g.meaning !== primaryMeaning)
        .sort((a, b) => b.weight - a.weight)
        .map(g => ({ meaning: g.meaning, weight: Math.round(g.weight * 100) / 100 }));

      return {
        glyph: sym.glyph,
        primaryMeaning,
        altMeanings,
        context: sym.context,
        fitness: Math.round(sym.fitness * 100) / 100,
        useCount: sym.useCount || 0,
        mutations: sym.mutations || 0,
        generation: sym.generation || 0,
        parentGlyph: sym.parentGlyph,
        adopters: (sym.adoptedBy || []).length,
        createdAt: sym.createdAt,
        lastUsed: sym.lastUsed,
      };
    });

    return {
      title: 'Aries Internal Language Dictionary',
      generatedAt: now(),
      totalSymbols: entries.length,
      totalDeprecated: vocab.deprecated.length,
      entries,
    };
  }

  /**
   * Get symbol genealogy — ancestry and descendants.
   */
  getSymbolGenealogy(glyph) {
    const genealogy = this._getGenealogy();

    if (glyph) {
      const events = genealogy.events.filter(e =>
        e.glyph === glyph || e.winner === glyph || e.loser === glyph
      );
      return { glyph, events };
    }

    // Return full genealogy summary
    const births = genealogy.events.filter(e => e.type === 'birth').length;
    const deaths = genealogy.events.filter(e => e.type === 'death').length;
    const merges = genealogy.events.filter(e => e.type === 'merge').length;
    const mutations = genealogy.events.filter(e => e.type === 'mutation').length;

    return {
      totalEvents: genealogy.events.length,
      births,
      deaths,
      merges,
      mutations,
      recentEvents: genealogy.events.slice(-20).reverse(),
    };
  }

  /**
   * Overall compression ratio.
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
      savedChars: stats.totalCharsRaw - stats.totalCharsCompressed,
      savingsPercent: stats.totalCharsRaw > 0
        ? Math.round((1 - stats.totalCharsCompressed / stats.totalCharsRaw) * 10000) / 100
        : 0,
      symbolCount: Object.keys(this._getVocab().symbols).length,
      totalCompressions: stats.totalCompressions,
      totalDecompressions: stats.totalDecompressions,
    };
  }

  /**
   * Get language evolution epochs.
   */
  getEpochs() {
    return this._getEpochs();
  }

  /**
   * Periodic evolution tick.
   */
  tick() {
    return this.evolve();
  }

  // ── Internal helpers ──

  _escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  _conceptSimilarity(a, b) {
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
    const removeCount = Math.max(1, Math.floor(entries.length * 0.1));
    for (let i = 0; i < removeCount; i++) {
      const [glyph, sym] = entries[i];
      vocab.deprecated.push({ glyph, concept: sym.concept, reason: 'pruned', at: now() });
      this._recordGenealogy('death', { glyph, concept: sym.concept, reason: 'pruned' });
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
      compressionRatio: this.getCompressionRatio().ratio,
    };
    epochs.push(epoch);
    if (epochs.length > 100) epochs.splice(0, epochs.length - 100);
    this._saveEpochs(epochs);
    this.emit('epoch', epoch);
  }

  _recordGenealogy(type, data) {
    const genealogy = this._getGenealogy();
    genealogy.events.push({ type, ...data, timestamp: now() });
    if (genealogy.events.length > 1000) genealogy.events = genealogy.events.slice(-1000);
    this._saveGenealogy(genealogy);
  }
}

module.exports = EmergentLanguage;
