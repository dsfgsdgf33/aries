/**
 * ARIES — Thought Fossil Record
 * Preserving extinct reasoning patterns.
 * Archaeological record of how Aries used to think.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const DATA_DIR = path.join(__dirname, '..', 'data', 'thoughts');
const FOSSILS_FILE = path.join(DATA_DIR, 'fossils.json');
const LINEAGE_FILE = path.join(DATA_DIR, 'lineage.json');
const ERAS_FILE = path.join(DATA_DIR, 'eras.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

const VALID_TYPES = ['heuristic', 'strategy', 'belief', 'approach'];

class ThoughtFossilRecord extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null;
    this.config = opts.config || {};
    this.maxFossils = this.config.maxFossils || 500;
    ensureDir();
  }

  // ── Persistence ──

  _getFossils() { return readJSON(FOSSILS_FILE, { fossils: [] }); }
  _saveFossils(data) { writeJSON(FOSSILS_FILE, data); }
  _getLineage() { return readJSON(LINEAGE_FILE, { edges: [] }); }
  _saveLineage(data) { writeJSON(LINEAGE_FILE, data); }
  _getEras() { return readJSON(ERAS_FILE, { eras: [] }); }
  _saveEras(data) { writeJSON(ERAS_FILE, data); }

  // ── Core: Fossilize a pattern ──

  /**
   * Preserve an extinct reasoning pattern as a fossil.
   * @param {string} pattern - Description of the reasoning pattern
   * @param {string} era - Era label (e.g. "early-learning", "v2-refactor")
   * @param {string} type - One of: heuristic, strategy, belief, approach
   * @param {string} reason - Why this pattern went extinct
   * @param {object} [meta] - Extra metadata (evolvedInto, parentFossilId, etc.)
   * @returns {object} The fossil record
   */
  fossilize(pattern, era, type, reason, meta = {}) {
    const data = this._getFossils();

    const fossil = {
      id: uuid(),
      pattern: (pattern || '').substring(0, 2000),
      era: era || 'unknown',
      type: VALID_TYPES.includes(type) ? type : 'approach',
      reason: (reason || '').substring(0, 1000),
      timestamp: Date.now(),
      fossilizedAt: new Date().toISOString(),
      resurrectionScore: 0.5,  // default: moderate potential
      resurrected: false,
      resurrectedAt: null,
      classified: false,
      tags: meta.tags || [],
      evolvedInto: meta.evolvedInto || null,
      parentFossilId: meta.parentFossilId || null,
    };

    data.fossils.push(fossil);
    if (data.fossils.length > this.maxFossils) {
      data.fossils = data.fossils.slice(-this.maxFossils);
    }
    this._saveFossils(data);

    // Record lineage if there's a parent
    if (meta.parentFossilId) {
      const lineage = this._getLineage();
      lineage.edges.push({
        from: meta.parentFossilId,
        to: fossil.id,
        relationship: 'evolved-into',
        timestamp: Date.now(),
      });
      this._saveLineage(lineage);
    }

    // Record era if new
    this._ensureEra(era);

    this.emit('fossilized', fossil);
    return fossil;
  }

  /**
   * AI classifies and scores a fossil for resurrection potential.
   * @param {string} fossilId
   * @returns {object|null} Updated fossil
   */
  async classify(fossilId) {
    const data = this._getFossils();
    const fossil = data.fossils.find(f => f.id === fossilId);
    if (!fossil) return null;

    if (!this.ai) {
      // Basic heuristic classification without AI
      fossil.classified = true;
      fossil.resurrectionScore = fossil.type === 'strategy' ? 0.6 : 0.4;
      this._saveFossils(data);
      return fossil;
    }

    const prompt = `Classify this extinct reasoning pattern and assess its resurrection potential.

PATTERN: ${fossil.pattern}
ERA: ${fossil.era}
TYPE: ${fossil.type}
REASON FOR EXTINCTION: ${fossil.reason}

Consider:
1. Could this pattern be useful in a completely different context?
2. Was it abandoned prematurely, or was the extinction well-justified?
3. What conditions would make this pattern valuable again?
4. How unique is this pattern — is it easily reinvented or truly lost knowledge?

Respond in JSON:
{
  "resurrectionScore": 0.0-1.0,
  "resurrectionConditions": "when this might be useful again",
  "tags": ["keyword1", "keyword2"],
  "assessment": "brief assessment"
}`;

    try {
      const response = await this.ai.chat([{ role: 'user', content: prompt }], {
        model: this.config.model,
        temperature: 0.6,
      });

      const text = typeof response === 'string' ? response : (response.content || response.text || '');
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const result = JSON.parse(jsonMatch[0]);
      fossil.classified = true;
      fossil.resurrectionScore = Math.max(0, Math.min(1, result.resurrectionScore || 0.5));
      fossil.resurrectionConditions = result.resurrectionConditions || '';
      fossil.assessment = result.assessment || '';
      if (result.tags && result.tags.length) {
        fossil.tags = [...new Set([...fossil.tags, ...result.tags])];
      }

      this._saveFossils(data);
      this.emit('classified', fossil);
      return fossil;
    } catch (e) {
      console.error('[THOUGHT-FOSSILS] Classify error:', e.message);
      return null;
    }
  }

  /**
   * Search fossils by query string (keyword match + AI if available).
   * @param {string} query
   * @returns {object[]} Matching fossils sorted by relevance
   */
  searchFossils(query) {
    if (!query) return [];
    const data = this._getFossils();
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);

    const scored = data.fossils.map(f => {
      let score = 0;
      const text = `${f.pattern} ${f.era} ${f.type} ${f.reason} ${(f.tags || []).join(' ')}`.toLowerCase();

      for (const word of queryWords) {
        if (text.includes(word)) score += 2;
        if (f.pattern.toLowerCase().includes(word)) score += 3;  // pattern match weighted higher
      }

      // Boost high resurrection potential
      score += f.resurrectionScore * 2;
      // Boost classified fossils
      if (f.classified) score += 1;

      return { ...f, _score: score };
    });

    return scored
      .filter(f => f._score > 0)
      .sort((a, b) => b._score - a._score)
      .slice(0, 20)
      .map(f => { const { _score, ...rest } = f; return rest; });
  }

  /**
   * Reactivate an old pattern — mark it as resurrected.
   * @param {string} fossilId
   * @returns {object|null} The reactivated fossil
   */
  reactivate(fossilId) {
    const data = this._getFossils();
    const fossil = data.fossils.find(f => f.id === fossilId);
    if (!fossil) return null;

    fossil.resurrected = true;
    fossil.resurrectedAt = Date.now();
    this._saveFossils(data);

    this.emit('reactivated', fossil);
    return fossil;
  }

  /**
   * Get the evolutionary record — pattern lineage tree.
   * @returns {object} Lineage graph with nodes and edges
   */
  getEvolutionaryRecord() {
    const data = this._getFossils();
    const lineage = this._getLineage();

    // Build adjacency from lineage edges
    const nodes = data.fossils.map(f => ({
      id: f.id,
      pattern: f.pattern.substring(0, 100),
      era: f.era,
      type: f.type,
      timestamp: f.timestamp,
      resurrected: f.resurrected,
    }));

    return {
      nodes,
      edges: lineage.edges,
      totalFossils: nodes.length,
      totalLineages: lineage.edges.length,
      eras: this._getEras().eras,
    };
  }

  /**
   * Browse fossils by era.
   * @param {string} [era] - If omitted, returns all eras with counts
   * @returns {object}
   */
  getExhibition(era) {
    const data = this._getFossils();

    if (!era) {
      // Return era summary
      const eraCounts = {};
      for (const f of data.fossils) {
        eraCounts[f.era] = (eraCounts[f.era] || 0) + 1;
      }
      return {
        eras: Object.entries(eraCounts)
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count),
        totalFossils: data.fossils.length,
      };
    }

    // Return fossils for a specific era
    const fossils = data.fossils
      .filter(f => f.era === era)
      .sort((a, b) => a.timestamp - b.timestamp);

    const byType = {};
    for (const f of fossils) {
      if (!byType[f.type]) byType[f.type] = [];
      byType[f.type].push(f);
    }

    return {
      era,
      totalFossils: fossils.length,
      byType,
      fossils,
      resurrected: fossils.filter(f => f.resurrected).length,
    };
  }

  /**
   * Periodic tick — classify unclassified fossils.
   * @returns {object[]} Newly classified fossils
   */
  async tick() {
    const data = this._getFossils();
    const unclassified = data.fossils.filter(f => !f.classified).slice(0, 2);
    const results = [];

    for (const fossil of unclassified) {
      const classified = await this.classify(fossil.id);
      if (classified) results.push(classified);
    }

    if (results.length > 0) {
      this.emit('tick-classified', results);
    }
    return results;
  }

  /** Ensure an era exists in the eras registry */
  _ensureEra(era) {
    if (!era || era === 'unknown') return;
    const eras = this._getEras();
    if (!eras.eras.some(e => e.name === era)) {
      eras.eras.push({ name: era, startedAt: Date.now() });
      this._saveEras(eras);
    }
  }

  /** Get summary stats */
  getStats() {
    const data = this._getFossils();
    const lineage = this._getLineage();
    const classified = data.fossils.filter(f => f.classified).length;
    const resurrected = data.fossils.filter(f => f.resurrected).length;
    const avgResurrection = data.fossils.length > 0
      ? Math.round(data.fossils.reduce((s, f) => s + f.resurrectionScore, 0) / data.fossils.length * 100) / 100
      : 0;

    return {
      totalFossils: data.fossils.length,
      classified,
      unclassified: data.fossils.length - classified,
      resurrected,
      avgResurrectionScore: avgResurrection,
      totalLineages: lineage.edges.length,
      eras: this._getEras().eras.length,
    };
  }
}

module.exports = ThoughtFossilRecord;
