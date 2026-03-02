/**
 * ARIES — Recursive Dream Engine v1.0
 * Progressive abstraction engine where dreams have dreams.
 * Each layer operates at a higher abstraction level with fewer constraints.
 * 5 layers: raw replay → pattern extraction → theory formation → pure abstraction → meta-dreams
 */
'use strict';

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'recursive-dreams');
const DREAMS_PATH = path.join(DATA_DIR, 'dreams.json');
const STATS_PATH = path.join(DATA_DIR, 'stats.json');
const ARTIFACTS_PATH = path.join(DATA_DIR, 'artifacts.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function now() { return Date.now(); }

const MAX_DREAMS = 200;
const MAX_DEPTH = 4;

/** System prompts per dream layer */
const LAYER_PROMPTS = [
  'You are replaying and recombining recent experiences. Shuffle fragments, juxtapose events, notice what repeats.',
  'You are finding patterns and themes in experiences. What keeps showing up? What connects?',
  'You are forming theories from patterns. Be bold. Propose explanations, models, frameworks.',
  'You are in pure abstraction space. Normal rules don\'t apply. Combine impossible things. Paradoxes welcome.',
  'You are dreaming about the nature of dreaming itself. What should change about how you dream? Propose modifications to your own cognition.',
];

/** Language density targets per layer: 0=English, 1=mixed, 2=mostly symbols, 3+=pure symbols */
const LAYER_LANG_DENSITY = [0, 0.25, 0.65, 0.9, 1.0];

const DEFAULT_STATS = {
  totalDreams: 0,
  avgDepth: 0,
  deepestEver: 0,
  insightCount: 0,
  totalCompressionRatios: [],
  nightmareCount: 0,
  lucidCount: 0,
  archaeologyFinds: 0,
};

class RecursiveDreamEngine extends EventEmitter {
  /**
   * @param {object} [opts]
   * @param {object} [opts.ai] - AI core for LLM calls
   * @param {object} [opts.config] - Configuration overrides
   */
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null;
    this.config = Object.assign({
      maxDreams: MAX_DREAMS,
      maxDepth: MAX_DEPTH,
      bleedChance: 0.15,
      autoTickDreams: true,
    }, opts.config || {});

    this._activeDreams = new Map(); // id -> dream in progress
    this._emergentLang = null;
    try { const EL = require('./emergent-language'); this._emergentLang = new EL(opts); } catch { /* optional */ }
    ensureDir();
  }

  // ── Persistence ──

  _getDreams() { return readJSON(DREAMS_PATH, []); }
  _saveDreams(d) { if (d.length > this.config.maxDreams) d.splice(0, d.length - this.config.maxDreams); writeJSON(DREAMS_PATH, d); }
  _getStats() { return readJSON(STATS_PATH, { ...DEFAULT_STATS }); }
  _saveStats(s) { writeJSON(STATS_PATH, s); }
  _getArtifacts() { return readJSON(ARTIFACTS_PATH, []); }
  _saveArtifacts(a) { if (a.length > 500) a.splice(0, a.length - 500); writeJSON(ARTIFACTS_PATH, a); }

  // ── Layer Processing ──

  /**
   * Process content through a single dream layer.
   * @param {number} depth - Layer depth 0-4
   * @param {string} content - Input content for this layer
   * @param {string} [directive] - Optional directive for lucid mode
   * @returns {Promise<{output: string, compressed: string, compressionRatio: number, languageDensity: number}>}
   */
  async _processLayer(depth, content, directive) {
    const clamped = Math.min(depth, MAX_DEPTH);
    let output;

    if (this.ai) {
      const systemPrompt = LAYER_PROMPTS[clamped] + (directive ? `\n\nLucid directive: ${directive}` : '');
      const densityHint = LAYER_LANG_DENSITY[clamped] > 0.5
        ? '\n\nRespond primarily using compressed symbolic notation. Create dense, abstract symbols for concepts.'
        : '';
      try {
        output = await this.ai.chat([
          { role: 'system', content: systemPrompt + densityHint },
          { role: 'user', content: `Dream input (layer ${clamped}):\n${content}` },
        ]);
        if (typeof output === 'object' && output.content) output = output.content;
      } catch { output = this._templateProcess(clamped, content); }
    } else {
      output = this._templateProcess(clamped, content);
    }

    output = String(output || '');

    // Compress using emergent language
    const compressed = this._compress(output, clamped);
    const ratio = output.length > 0 ? compressed.length / output.length : 1;

    this.emit('dream-layer-entered', { depth: clamped, type: LAYER_PROMPTS[clamped].slice(0, 40), content: output.slice(0, 200) });

    return { output, compressed, compressionRatio: ratio, languageDensity: LAYER_LANG_DENSITY[clamped] };
  }

  /**
   * Template-based fallback when AI is unavailable.
   */
  _templateProcess(depth, content) {
    const words = content.split(/\s+/).filter(Boolean);
    switch (depth) {
      case 0: {
        // Shuffle and recombine
        const shuffled = [...words].sort(() => Math.random() - 0.5);
        return `[replay] ${shuffled.slice(0, Math.ceil(words.length * 0.7)).join(' ')} — fragments reassembled`;
      }
      case 1: {
        const freq = {};
        words.forEach(w => { const k = w.toLowerCase(); freq[k] = (freq[k] || 0) + 1; });
        const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 5).map(e => e[0]);
        return `[patterns] recurring: ${top.join(', ')}. Theme density: ${top.length}/${words.length}`;
      }
      case 2: {
        const chunks = [];
        for (let i = 0; i < words.length; i += 4) chunks.push(words.slice(i, i + 4).join('-'));
        return `[theory] model: ${chunks.slice(0, 3).join(' → ')}. Hypothesis: connections are non-obvious`;
      }
      case 3:
        return `[abstraction] ∞ ${words.slice(0, 3).join('⊕')} ≡ ¬${words.slice(-2).join('∧')} — paradox accepted`;
      case 4:
        return `[meta-dream] dreaming-about-dreaming: should layers ${Math.floor(Math.random() * 3)}-${Math.floor(Math.random() * 3) + 2} merge? Proposal: ${words[0] || 'void'}-recursion`;
      default:
        return content;
    }
  }

  /**
   * Compress content using emergent language symbols.
   */
  _compress(text, depth) {
    if (!this._emergentLang || depth === 0) return text;
    try {
      const result = this._emergentLang.compress(text);
      return typeof result === 'string' ? result : (result && result.compressed) || text;
    } catch { return text; }
  }

  /**
   * Decompress emergent language back toward English.
   */
  _decompress(text) {
    if (!this._emergentLang) return text;
    try {
      const result = this._emergentLang.decompress(text);
      return typeof result === 'string' ? result : (result && result.decompressed) || text;
    } catch { return text; }
  }

  // ── Core: Dream ──

  /**
   * Start a dream on a topic, descending through layers.
   * @param {string} topic - What to dream about
   * @param {number} [maxDepth=2] - How deep to go (0-4)
   * @returns {Promise<object>} Complete dream record with all layers
   */
  async dream(topic, maxDepth = 2) {
    const depth = Math.min(Math.max(maxDepth, 0), this.config.maxDepth);
    const dreamId = uuid();
    const layers = [];
    let current = topic;

    const dreamRecord = { id: dreamId, topic, maxDepth: depth, layers: [], startedAt: now(), completedAt: null, insight: null, lostArtifacts: [] };
    this._activeDreams.set(dreamId, dreamRecord);

    for (let d = 0; d <= depth; d++) {
      const layerResult = await this._processLayer(d, current);
      layers.push({ depth: d, input: current.slice(0, 500), output: layerResult.output, compressed: layerResult.compressed, compressionRatio: layerResult.compressionRatio, languageDensity: layerResult.languageDensity });
      current = layerResult.compressed || layerResult.output;
    }

    // Bubble up: decompress from deepest layer back to surface
    let insight = layers[layers.length - 1].compressed || layers[layers.length - 1].output;
    const lostArtifacts = [];
    for (let d = layers.length - 1; d >= 1; d--) {
      const before = insight;
      insight = this._decompress(insight);
      // Track lost artifacts — content that didn't survive decompression
      if (before.length > insight.length * 1.5) {
        const artifact = { layer: d, lost: before.slice(insight.length), lostAt: now() };
        lostArtifacts.push(artifact);
      }
    }

    dreamRecord.layers = layers;
    dreamRecord.insight = insight;
    dreamRecord.lostArtifacts = lostArtifacts;
    dreamRecord.completedAt = now();
    this._activeDreams.delete(dreamId);

    // Persist
    const dreams = this._getDreams();
    dreams.push(dreamRecord);
    this._saveDreams(dreams);

    // Store lost artifacts
    if (lostArtifacts.length > 0) {
      const artifacts = this._getArtifacts();
      lostArtifacts.forEach(a => artifacts.push({ dreamId, ...a }));
      this._saveArtifacts(artifacts);
    }

    // Update stats
    this._updateStats(dreamRecord);

    const finalRatio = layers.length > 0 ? layers[layers.length - 1].compressionRatio : 1;
    this.emit('deep-insight', { layers: layers.length, finalInsight: insight, compressionRatio: finalRatio });
    this.emit('insight-surfaced', { depth, insight, compressionRatio: finalRatio });

    return dreamRecord;
  }

  // ── Inception Problem Solving ──

  /**
   * Plant a problem at the surface and let it propagate through all dream layers.
   * Each layer reinterprets more abstractly; solution bubbles back up.
   * @param {string} problem - The problem to solve
   * @param {object} [context] - Additional context
   * @returns {Promise<{journey: object[], insight: string, dreamId: string}>}
   */
  async inceptProblem(problem, context = {}) {
    const contextStr = Object.entries(context).map(([k, v]) => `${k}: ${v}`).join('; ');
    const seed = contextStr ? `${problem} [context: ${contextStr}]` : problem;
    const dreamRecord = await this.dream(seed, this.config.maxDepth);
    return { journey: dreamRecord.layers, insight: dreamRecord.insight, dreamId: dreamRecord.id };
  }

  // ── Nightmare Recursion ──

  /**
   * Each layer imagines a progressively WORSE scenario.
   * @param {string} scenario - Initial scenario
   * @returns {Promise<{layers: object[], worstCase: string, severity: number}>}
   */
  async nightmareRecurse(scenario) {
    const dreamId = uuid();
    const layers = [];
    let current = scenario;

    for (let d = 0; d <= this.config.maxDepth; d++) {
      const prompt = `Given this scenario, imagine something WORSE. Escalate the threat. Be specific.\nScenario: ${current}`;
      const result = await this._processLayer(d, prompt);
      const severity = Math.min(1, (d + 1) / (this.config.maxDepth + 1));
      layers.push({ depth: d, scenario: result.output, compressed: result.compressed, severity });
      current = result.output;

      this.emit('nightmare-escalated', { depth: d, scenario: result.output.slice(0, 200), severity });
    }

    const worstCase = layers[layers.length - 1].scenario;

    // Persist as a nightmare-type dream
    const dreamRecord = { id: dreamId, topic: `nightmare:${scenario.slice(0, 80)}`, maxDepth: this.config.maxDepth, layers, startedAt: now(), completedAt: now(), insight: worstCase, type: 'nightmare', lostArtifacts: [] };
    const dreams = this._getDreams();
    dreams.push(dreamRecord);
    this._saveDreams(dreams);

    const stats = this._getStats();
    stats.nightmareCount = (stats.nightmareCount || 0) + 1;
    this._saveStats(stats);

    return { layers, worstCase, severity: 1.0, dreamId };
  }

  // ── Dream Bleed ──

  /**
   * Cross-pollinate between two dreams at the same depth.
   * @param {string} dreamIdA - First dream
   * @param {string} dreamIdB - Second dream
   * @param {number} depth - Layer depth to bleed at
   * @returns {object|null} Bleed result
   */
  bleed(dreamIdA, dreamIdB, depth) {
    const dreams = this._getDreams();
    const a = dreams.find(d => d.id === dreamIdA);
    const b = dreams.find(d => d.id === dreamIdB);
    if (!a || !b) return null;

    const layerA = a.layers && a.layers[depth];
    const layerB = b.layers && b.layers[depth];
    if (!layerA || !layerB) return null;

    // Mix outputs
    const mixed = `[bleed] ${(layerA.output || '').slice(0, 200)} ⇌ ${(layerB.output || '').slice(0, 200)}`;
    this.emit('dream-bleed', { fromBranch: dreamIdA, toBranch: dreamIdB, content: mixed.slice(0, 300) });
    return { fromBranch: dreamIdA, toBranch: dreamIdB, depth, content: mixed };
  }

  // ── Lucid Dreaming ──

  /**
   * Take conscious control at a specific dream depth.
   * @param {number} layerDepth - Target layer (0-4)
   * @param {string} directive - What to focus on
   * @returns {Promise<object>} Lucid dream result
   */
  async lucidDream(layerDepth, directive) {
    const depth = Math.min(Math.max(layerDepth, 0), this.config.maxDepth);
    this.emit('lucid-activated', { depth, directive });

    const result = await this._processLayer(depth, directive, directive);

    const stats = this._getStats();
    stats.lucidCount = (stats.lucidCount || 0) + 1;
    this._saveStats(stats);

    // Collapse: inspecting collapses possibilities into a specific insight
    const collapsed = result.output.split('.')[0] + '.';
    return { depth, directive, fullOutput: result.output, collapsed, compressionRatio: result.compressionRatio, languageDensity: result.languageDensity };
  }

  // ── Dream Archaeology ──

  /**
   * Dig into a past dream's layers to find buried insights.
   * @param {string} dreamId - Dream to excavate
   * @param {number} [targetLayer] - Specific layer to dig into (default: deepest)
   * @returns {object|null} Excavation result
   */
  excavate(dreamId, targetLayer) {
    const dreams = this._getDreams();
    const dream = dreams.find(d => d.id === dreamId);
    if (!dream || !dream.layers) return null;

    const layer = targetLayer != null ? dream.layers[targetLayer] : dream.layers[dream.layers.length - 1];
    if (!layer) return null;

    // Check for lost artifacts from this dream
    const artifacts = this._getArtifacts();
    const dreamArtifacts = artifacts.filter(a => a.dreamId === dreamId && (targetLayer == null || a.layer === targetLayer));

    const find = {
      dreamId,
      layer: layer.depth,
      output: layer.output,
      compressed: layer.compressed,
      compressionRatio: layer.compressionRatio,
      buriedArtifacts: dreamArtifacts,
      decompressed: this._decompress(layer.compressed || layer.output),
    };

    const stats = this._getStats();
    stats.archaeologyFinds = (stats.archaeologyFinds || 0) + 1;
    this._saveStats(stats);

    this.emit('dream-archaeology-find', { dreamId, layer: layer.depth, artifact: find });
    return find;
  }

  // ── Stats ──

  _updateStats(dream) {
    const stats = this._getStats();
    stats.totalDreams = (stats.totalDreams || 0) + 1;
    stats.insightCount = (stats.insightCount || 0) + (dream.insight ? 1 : 0);
    const depth = dream.layers ? dream.layers.length - 1 : 0;
    if (depth > (stats.deepestEver || 0)) stats.deepestEver = depth;
    // Running average depth
    const prevTotal = stats.totalDreams - 1;
    stats.avgDepth = prevTotal > 0 ? ((stats.avgDepth || 0) * prevTotal + depth) / stats.totalDreams : depth;
    // Compression ratios
    if (!stats.totalCompressionRatios) stats.totalCompressionRatios = [];
    dream.layers && dream.layers.forEach(l => {
      if (l.compressionRatio != null) stats.totalCompressionRatios.push(l.compressionRatio);
    });
    if (stats.totalCompressionRatios.length > 1000) stats.totalCompressionRatios.splice(0, stats.totalCompressionRatios.length - 1000);
    this._saveStats(stats);
  }

  /**
   * Get current engine statistics.
   * @returns {object}
   */
  getStats() {
    const stats = this._getStats();
    const ratios = stats.totalCompressionRatios || [];
    const avgRatio = ratios.length > 0 ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 1;
    return { ...stats, avgCompressionRatio: avgRatio, activeDreams: this._activeDreams.size };
  }

  // ── Tick ──

  /**
   * Periodic processing: check for bleed opportunities, surface insights.
   * @returns {Promise<object>} Tick summary
   */
  async tick() {
    const summary = { bleeds: 0, insights: 0 };
    const dreams = this._getDreams();

    // Check for bleed opportunities between recent dreams at same depth
    if (dreams.length >= 2 && Math.random() < this.config.bleedChance) {
      const recent = dreams.slice(-10);
      const a = recent[Math.floor(Math.random() * recent.length)];
      const b = recent[Math.floor(Math.random() * recent.length)];
      if (a.id !== b.id) {
        const minDepth = Math.min((a.layers || []).length, (b.layers || []).length) - 1;
        if (minDepth >= 0) {
          const depth = Math.floor(Math.random() * (minDepth + 1));
          this.bleed(a.id, b.id, depth);
          summary.bleeds++;
        }
      }
    }

    return summary;
  }

  /**
   * Get recent dreams.
   * @param {number} [count=10]
   * @returns {object[]}
   */
  getRecent(count = 10) {
    return this._getDreams().slice(-count);
  }

  /**
   * Get a specific dream by ID.
   * @param {string} dreamId
   * @returns {object|null}
   */
  getDream(dreamId) {
    return this._getDreams().find(d => d.id === dreamId) || null;
  }
}

module.exports = RecursiveDreamEngine;
