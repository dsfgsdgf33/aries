/**
 * ARIES — Thought Fossil Record
 * Preserving extinct reasoning patterns.
 * Resurrection scoring, evolutionary lineage, fossil dating, comparative analysis, pattern DNA extraction.
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
const DNA_FILE = path.join(DATA_DIR, 'pattern-dna.json');
const COMPARISONS_FILE = path.join(DATA_DIR, 'fossil-comparisons.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

const VALID_TYPES = ['heuristic', 'strategy', 'belief', 'approach', 'reflex', 'habit', 'assumption'];

// Era classification based on age
const ERA_THRESHOLDS = [
  { name: 'recent', maxDays: 7, label: 'Recent Extinction' },
  { name: 'modern', maxDays: 30, label: 'Modern Era' },
  { name: 'classical', maxDays: 90, label: 'Classical Era' },
  { name: 'ancient', maxDays: 365, label: 'Ancient Era' },
  { name: 'primordial', maxDays: Infinity, label: 'Primordial Era' },
];

class ThoughtFossilRecord extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null;
    this.config = opts.config || {};
    this.maxFossils = this.config.maxFossils || 500;
    this.maxComparisons = this.config.maxComparisons || 200;
    ensureDir();
  }

  // ── Persistence ──

  _getFossils() { return readJSON(FOSSILS_FILE, { fossils: [] }); }
  _saveFossils(data) { writeJSON(FOSSILS_FILE, data); }
  _getLineage() { return readJSON(LINEAGE_FILE, { edges: [], trees: [] }); }
  _saveLineage(data) { writeJSON(LINEAGE_FILE, data); }
  _getEras() { return readJSON(ERAS_FILE, { eras: [], transitions: [] }); }
  _saveEras(data) { writeJSON(ERAS_FILE, data); }
  _getDNA() { return readJSON(DNA_FILE, { patterns: [] }); }
  _saveDNA(data) { writeJSON(DNA_FILE, data); }
  _getComparisons() { return readJSON(COMPARISONS_FILE, { comparisons: [] }); }
  _saveComparisons(data) { writeJSON(COMPARISONS_FILE, data); }

  // ── Core: Fossilize a pattern ──

  fossilize(pattern, era, type, reason, meta = {}) {
    const data = this._getFossils();

    const fossil = {
      id: uuid(),
      pattern: (pattern || '').substring(0, 2000),
      era: era || 'unknown',
      autoEra: this._classifyEra(Date.now()),
      type: VALID_TYPES.includes(type) ? type : 'approach',
      reason: (reason || '').substring(0, 1000),
      timestamp: Date.now(),
      fossilizedAt: new Date().toISOString(),
      resurrectionScore: 0.5,
      resurrected: false,
      resurrectedAt: null,
      resurrectionHistory: [],
      classified: false,
      tags: meta.tags || [],
      evolvedInto: meta.evolvedInto || null,
      parentFossilId: meta.parentFossilId || null,
      dna: null,
      fossilAge: 0,
      depth: meta.depth || 1,
      context: meta.context || null,
      strength: meta.strength || 1.0,
      mutations: [],
    };

    // Extract pattern DNA immediately
    fossil.dna = this._extractDNALocal(fossil);

    data.fossils.push(fossil);
    if (data.fossils.length > this.maxFossils) {
      data.fossils = data.fossils.slice(-this.maxFossils);
    }
    this._saveFossils(data);

    // Record lineage
    if (meta.parentFossilId) {
      this._recordLineageEdge(meta.parentFossilId, fossil.id, 'evolved-into');
    }

    // Record era
    this._ensureEra(era);
    this._recordDNA(fossil);

    this.emit('fossilized', fossil);
    return fossil;
  }

  /**
   * AI classifies and scores a fossil for resurrection potential.
   */
  async classify(fossilId) {
    const data = this._getFossils();
    const fossil = data.fossils.find(f => f.id === fossilId);
    if (!fossil) return null;

    // Update fossil age
    fossil.fossilAge = Math.floor((Date.now() - fossil.timestamp) / 86400000);
    fossil.autoEra = this._classifyEra(fossil.timestamp);

    if (!this.ai) {
      fossil.classified = true;
      fossil.resurrectionScore = this._heuristicResurrectionScore(fossil);
      this._saveFossils(data);
      return fossil;
    }

    const lineage = this._getLineage();
    const descendants = lineage.edges.filter(e => e.from === fossilId);
    const ancestors = lineage.edges.filter(e => e.to === fossilId);

    const prompt = `Classify this extinct reasoning pattern and assess its resurrection potential.

PATTERN: ${fossil.pattern}
ERA: ${fossil.era} (auto-classified: ${fossil.autoEra})
TYPE: ${fossil.type}
REASON FOR EXTINCTION: ${fossil.reason}
AGE: ${fossil.fossilAge} days
DEPTH: ${fossil.depth}
HAS DESCENDANTS: ${descendants.length > 0 ? 'Yes (' + descendants.length + ')' : 'No'}
HAS ANCESTORS: ${ancestors.length > 0 ? 'Yes' : 'No'}
${fossil.context ? `CONTEXT: ${JSON.stringify(fossil.context)}` : ''}

Consider:
1. Could this pattern be useful in a completely different context?
2. Was it abandoned prematurely, or was the extinction well-justified?
3. What conditions would make this pattern valuable again?
4. How unique is this pattern — easily reinvented or truly lost knowledge?
5. Does it contain "genetic material" worth preserving in new patterns?
6. What mutations might make it viable again?

Respond in JSON:
{
  "resurrectionScore": 0.0-1.0,
  "resurrectionConditions": "when this might be useful again",
  "tags": ["keyword1", "keyword2"],
  "assessment": "brief assessment",
  "uniqueness": 0.0-1.0,
  "viableMutations": ["possible mutations that could revive this"],
  "dnaTraits": ["core traits that define this pattern"],
  "relatedModernPatterns": ["modern equivalents or successors"]
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
      fossil.uniqueness = Math.max(0, Math.min(1, result.uniqueness || 0.5));
      fossil.viableMutations = result.viableMutations || [];
      fossil.relatedModernPatterns = result.relatedModernPatterns || [];
      if (result.tags && result.tags.length) {
        fossil.tags = [...new Set([...fossil.tags, ...result.tags])];
      }
      if (result.dnaTraits) {
        fossil.dna = { ...fossil.dna, traits: result.dnaTraits };
        this._recordDNA(fossil);
      }

      this._saveFossils(data);
      this.emit('classified', fossil);
      return fossil;
    } catch (e) {
      console.error('[THOUGHT-FOSSILS] Classify error:', e.message);
      return null;
    }
  }

  // ── Resurrection System ──

  _heuristicResurrectionScore(fossil) {
    let score = 0.4;
    if (fossil.type === 'strategy') score += 0.15;
    if (fossil.type === 'heuristic') score += 0.1;
    if (fossil.fossilAge > 30) score += 0.05; // old patterns gain mystique
    if (fossil.depth > 2) score += 0.1;
    if (fossil.strength > 0.7) score += 0.1;
    return Math.min(1, score);
  }

  /**
   * Attempt to resurrect a fossil — bring it back with possible mutations.
   */
  reactivate(fossilId, mutation = null) {
    const data = this._getFossils();
    const fossil = data.fossils.find(f => f.id === fossilId);
    if (!fossil) return null;

    fossil.resurrected = true;
    fossil.resurrectedAt = Date.now();

    const record = {
      timestamp: Date.now(),
      mutation: mutation || null,
      context: 'manual',
    };
    if (!fossil.resurrectionHistory) fossil.resurrectionHistory = [];
    fossil.resurrectionHistory.push(record);

    if (mutation) {
      fossil.mutations.push({ text: mutation, appliedAt: Date.now() });
    }

    this._saveFossils(data);
    this.emit('reactivated', fossil);
    return fossil;
  }

  /**
   * Get top resurrection candidates — highest scoring unresurrected fossils.
   */
  getResurrectionCandidates(n = 10) {
    const data = this._getFossils();
    return data.fossils
      .filter(f => !f.resurrected && f.classified)
      .sort((a, b) => b.resurrectionScore - a.resurrectionScore)
      .slice(0, n)
      .map(f => ({
        id: f.id,
        pattern: f.pattern.substring(0, 200),
        era: f.era,
        type: f.type,
        resurrectionScore: f.resurrectionScore,
        resurrectionConditions: f.resurrectionConditions || '',
        viableMutations: f.viableMutations || [],
        uniqueness: f.uniqueness || 0,
      }));
  }

  // ── Evolutionary Lineage ──

  _recordLineageEdge(fromId, toId, relationship) {
    const lineage = this._getLineage();
    lineage.edges.push({
      from: fromId,
      to: toId,
      relationship: relationship || 'evolved-into',
      timestamp: Date.now(),
    });
    this._saveLineage(lineage);
  }

  /**
   * Build the evolutionary tree for a fossil.
   */
  getLineageTree(fossilId) {
    const data = this._getFossils();
    const lineage = this._getLineage();

    const visited = new Set();
    const tree = { root: null, nodes: [], edges: [] };

    const buildUp = (id) => {
      if (visited.has(id)) return;
      visited.add(id);
      const fossil = data.fossils.find(f => f.id === id);
      if (!fossil) return;
      tree.nodes.push({ id, pattern: fossil.pattern.substring(0, 100), era: fossil.era, type: fossil.type, resurrected: fossil.resurrected });
      // Find ancestors
      for (const e of lineage.edges) {
        if (e.to === id) {
          tree.edges.push(e);
          buildUp(e.from);
        }
      }
      // Find descendants
      for (const e of lineage.edges) {
        if (e.from === id) {
          tree.edges.push(e);
          buildUp(e.to);
        }
      }
    };

    buildUp(fossilId);
    tree.root = fossilId;
    tree.depth = this._treeDepth(fossilId, lineage.edges);
    return tree;
  }

  _treeDepth(rootId, edges, direction = 'down', visited = new Set()) {
    if (visited.has(rootId)) return 0;
    visited.add(rootId);
    const children = direction === 'down'
      ? edges.filter(e => e.from === rootId).map(e => e.to)
      : edges.filter(e => e.to === rootId).map(e => e.from);
    if (children.length === 0) return 1;
    return 1 + Math.max(...children.map(c => this._treeDepth(c, edges, direction, visited)));
  }

  getEvolutionaryRecord() {
    const data = this._getFossils();
    const lineage = this._getLineage();

    const nodes = data.fossils.map(f => ({
      id: f.id,
      pattern: f.pattern.substring(0, 100),
      era: f.era,
      autoEra: f.autoEra,
      type: f.type,
      timestamp: f.timestamp,
      resurrected: f.resurrected,
      resurrectionScore: f.resurrectionScore,
      uniqueness: f.uniqueness || 0,
    }));

    // Find longest lineage chains
    const roots = nodes.filter(n => !lineage.edges.some(e => e.to === n.id));
    const longestChains = roots.map(r => ({
      root: r.id,
      depth: this._treeDepth(r.id, lineage.edges),
    })).sort((a, b) => b.depth - a.depth).slice(0, 5);

    return {
      nodes,
      edges: lineage.edges,
      totalFossils: nodes.length,
      totalLineages: lineage.edges.length,
      eras: this._getEras().eras,
      longestChains,
    };
  }

  // ── Fossil Dating / Era Classification ──

  _classifyEra(timestamp) {
    const ageDays = (Date.now() - timestamp) / 86400000;
    for (const era of ERA_THRESHOLDS) {
      if (ageDays <= era.maxDays) return era.name;
    }
    return 'primordial';
  }

  /**
   * Get fossils grouped by geological era.
   */
  getByEra() {
    const data = this._getFossils();
    const eras = {};
    for (const f of data.fossils) {
      const era = f.autoEra || this._classifyEra(f.timestamp);
      if (!eras[era]) eras[era] = [];
      eras[era].push(f);
    }
    const result = {};
    for (const [era, fossils] of Object.entries(eras)) {
      const threshold = ERA_THRESHOLDS.find(t => t.name === era);
      result[era] = {
        label: threshold ? threshold.label : era,
        count: fossils.length,
        types: this._countBy(fossils, 'type'),
        avgResurrectionScore: fossils.length > 0
          ? Math.round(fossils.reduce((s, f) => s + f.resurrectionScore, 0) / fossils.length * 100) / 100
          : 0,
        resurrected: fossils.filter(f => f.resurrected).length,
      };
    }
    return result;
  }

  _countBy(arr, key) {
    const counts = {};
    for (const item of arr) counts[item[key]] = (counts[item[key]] || 0) + 1;
    return counts;
  }

  /**
   * Record era transitions — when eras begin and end.
   */
  recordEraTransition(fromEra, toEra, reason) {
    const eras = this._getEras();
    if (!eras.transitions) eras.transitions = [];
    eras.transitions.push({ from: fromEra, to: toEra, reason, timestamp: Date.now() });
    this._saveEras(eras);
    this.emit('era-transition', { from: fromEra, to: toEra, reason });
  }

  // ── Comparative Analysis ──

  /**
   * Compare two fossils — find similarities and differences.
   */
  async compareFossils(fossilId1, fossilId2) {
    const data = this._getFossils();
    const f1 = data.fossils.find(f => f.id === fossilId1);
    const f2 = data.fossils.find(f => f.id === fossilId2);
    if (!f1 || !f2) return null;

    let comparison;

    if (this.ai) {
      const prompt = `Compare these two extinct reasoning patterns. Find similarities, differences, and evolutionary relationships.

FOSSIL A:
  Pattern: ${f1.pattern}
  Era: ${f1.era} | Type: ${f1.type}
  Reason for extinction: ${f1.reason}
  DNA traits: ${JSON.stringify(f1.dna?.traits || [])}

FOSSIL B:
  Pattern: ${f2.pattern}
  Era: ${f2.era} | Type: ${f2.type}
  Reason for extinction: ${f2.reason}
  DNA traits: ${JSON.stringify(f2.dna?.traits || [])}

Respond in JSON:
{
  "similarity": 0.0-1.0,
  "sharedTraits": ["..."],
  "divergences": ["..."],
  "evolutionaryRelationship": "ancestor|descendant|sibling|convergent|unrelated",
  "couldMerge": true/false,
  "mergedPattern": "hypothetical merged pattern if applicable",
  "insight": "what this comparison reveals"
}`;

      try {
        const response = await this.ai.chat([{ role: 'user', content: prompt }], {
          model: this.config.model,
          temperature: 0.6,
        });
        const text = typeof response === 'string' ? response : (response.content || response.text || '');
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          comparison = JSON.parse(jsonMatch[0]);
        }
      } catch (e) {
        console.error('[THOUGHT-FOSSILS] Compare error:', e.message);
      }
    }

    if (!comparison) {
      // Heuristic comparison
      const dna1 = new Set((f1.dna?.traits || []).map(t => t.toLowerCase()));
      const dna2 = new Set((f2.dna?.traits || []).map(t => t.toLowerCase()));
      let overlap = 0;
      for (const t of dna1) if (dna2.has(t)) overlap++;
      const similarity = (dna1.size + dna2.size) > 0 ? overlap / Math.max(dna1.size, dna2.size) : 0;
      comparison = {
        similarity,
        sharedTraits: [...dna1].filter(t => dna2.has(t)),
        divergences: [`Type: ${f1.type} vs ${f2.type}`, `Era: ${f1.era} vs ${f2.era}`],
        evolutionaryRelationship: f1.parentFossilId === f2.id || f2.parentFossilId === f1.id ? 'ancestor' : 'unrelated',
        couldMerge: similarity > 0.5,
        mergedPattern: null,
        insight: 'Heuristic comparison — use AI for deeper analysis',
      };
    }

    const record = {
      id: uuid(),
      fossilId1,
      fossilId2,
      ...comparison,
      timestamp: Date.now(),
    };

    const comps = this._getComparisons();
    comps.comparisons.push(record);
    if (comps.comparisons.length > this.maxComparisons) comps.comparisons = comps.comparisons.slice(-this.maxComparisons);
    this._saveComparisons(comps);

    this.emit('comparison', record);
    return record;
  }

  /**
   * Find the most similar fossil to a given description.
   */
  findSimilar(description, n = 5) {
    const data = this._getFossils();
    const words = new Set((description || '').toLowerCase().split(/\W+/).filter(w => w.length > 3));

    return data.fossils
      .map(f => {
        const fWords = new Set(`${f.pattern} ${(f.tags || []).join(' ')} ${(f.dna?.traits || []).join(' ')}`.toLowerCase().split(/\W+/).filter(w => w.length > 3));
        let overlap = 0;
        for (const w of words) if (fWords.has(w)) overlap++;
        const score = fWords.size > 0 ? overlap / Math.max(words.size, fWords.size) : 0;
        return { ...f, _score: score };
      })
      .filter(f => f._score > 0)
      .sort((a, b) => b._score - a._score)
      .slice(0, n)
      .map(f => { const { _score, ...rest } = f; return rest; });
  }

  // ── Pattern DNA Extraction ──

  _extractDNALocal(fossil) {
    const text = `${fossil.pattern} ${fossil.reason}`.toLowerCase();
    const words = text.split(/\W+/).filter(w => w.length > 4);
    const freq = {};
    for (const w of words) freq[w] = (freq[w] || 0) + 1;
    const traits = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([w]) => w);

    return {
      traits,
      type: fossil.type,
      strength: fossil.strength || 1.0,
      extractedAt: Date.now(),
    };
  }

  _recordDNA(fossil) {
    if (!fossil.dna) return;
    const dnaData = this._getDNA();
    const existing = dnaData.patterns.find(p => p.fossilId === fossil.id);
    if (existing) {
      Object.assign(existing, fossil.dna, { fossilId: fossil.id });
    } else {
      dnaData.patterns.push({ fossilId: fossil.id, ...fossil.dna });
    }
    if (dnaData.patterns.length > this.maxFossils) dnaData.patterns = dnaData.patterns.slice(-this.maxFossils);
    this._saveDNA(dnaData);
  }

  /**
   * AI-powered deep DNA extraction for a fossil.
   */
  async extractDNA(fossilId) {
    const data = this._getFossils();
    const fossil = data.fossils.find(f => f.id === fossilId);
    if (!fossil) return null;

    if (!this.ai) {
      fossil.dna = this._extractDNALocal(fossil);
      this._saveFossils(data);
      this._recordDNA(fossil);
      return fossil.dna;
    }

    const prompt = `Extract the "DNA" of this reasoning pattern — the core traits that define it independent of context.

PATTERN: ${fossil.pattern}
TYPE: ${fossil.type}
ERA: ${fossil.era}
REASON FOR EXTINCTION: ${fossil.reason}

Respond in JSON:
{
  "traits": ["core trait 1", "core trait 2", ...],
  "structure": "sequential|branching|recursive|parallel|cyclical",
  "energyProfile": "high|medium|low",
  "adaptability": 0.0-1.0,
  "complexity": 0.0-1.0,
  "dependencies": ["what this pattern needs to function"],
  "antiPatterns": ["what kills this pattern"],
  "genome": "a short 'genetic code' string summarizing the pattern"
}`;

    try {
      const response = await this.ai.chat([{ role: 'user', content: prompt }], {
        model: this.config.model,
        temperature: 0.5,
      });
      const text = typeof response === 'string' ? response : (response.content || response.text || '');
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return fossil.dna;

      const result = JSON.parse(jsonMatch[0]);
      fossil.dna = { ...fossil.dna, ...result, extractedAt: Date.now() };
      this._saveFossils(data);
      this._recordDNA(fossil);
      this.emit('dna-extracted', { fossilId, dna: fossil.dna });
      return fossil.dna;
    } catch (e) {
      console.error('[THOUGHT-FOSSILS] DNA extraction error:', e.message);
      return fossil.dna;
    }
  }

  /**
   * Find fossils with similar DNA.
   */
  findBySimilarDNA(fossilId, n = 5) {
    const data = this._getFossils();
    const target = data.fossils.find(f => f.id === fossilId);
    if (!target || !target.dna?.traits) return [];

    const targetTraits = new Set(target.dna.traits.map(t => t.toLowerCase()));

    return data.fossils
      .filter(f => f.id !== fossilId && f.dna?.traits)
      .map(f => {
        const fTraits = new Set(f.dna.traits.map(t => t.toLowerCase()));
        let overlap = 0;
        for (const t of targetTraits) if (fTraits.has(t)) overlap++;
        const similarity = Math.max(targetTraits.size, fTraits.size) > 0 ? overlap / Math.max(targetTraits.size, fTraits.size) : 0;
        return { ...f, _similarity: similarity };
      })
      .filter(f => f._similarity > 0.1)
      .sort((a, b) => b._similarity - a._similarity)
      .slice(0, n)
      .map(f => { const { _similarity, ...rest } = f; return { ...rest, similarity: f._similarity }; });
  }

  // ── Search & Browse ──

  searchFossils(query) {
    if (!query) return [];
    const data = this._getFossils();
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);

    const scored = data.fossils.map(f => {
      let score = 0;
      const text = `${f.pattern} ${f.era} ${f.type} ${f.reason} ${(f.tags || []).join(' ')} ${(f.dna?.traits || []).join(' ')}`.toLowerCase();

      for (const word of queryWords) {
        if (text.includes(word)) score += 2;
        if (f.pattern.toLowerCase().includes(word)) score += 3;
      }
      score += f.resurrectionScore * 2;
      if (f.classified) score += 1;
      if (f.uniqueness) score += f.uniqueness;

      return { ...f, _score: score };
    });

    return scored
      .filter(f => f._score > 0)
      .sort((a, b) => b._score - a._score)
      .slice(0, 20)
      .map(f => { const { _score, ...rest } = f; return rest; });
  }

  getExhibition(era) {
    const data = this._getFossils();

    if (!era) {
      const eraCounts = {};
      for (const f of data.fossils) {
        eraCounts[f.era] = (eraCounts[f.era] || 0) + 1;
      }
      return {
        eras: Object.entries(eraCounts)
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count),
        totalFossils: data.fossils.length,
        byAutoEra: this.getByEra(),
      };
    }

    const fossils = data.fossils
      .filter(f => f.era === era || f.autoEra === era)
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
      avgResurrectionScore: fossils.length > 0
        ? Math.round(fossils.reduce((s, f) => s + f.resurrectionScore, 0) / fossils.length * 100) / 100
        : 0,
    };
  }

  // ── Era management ──

  _ensureEra(era) {
    if (!era || era === 'unknown') return;
    const eras = this._getEras();
    if (!eras.eras.some(e => e.name === era)) {
      eras.eras.push({ name: era, startedAt: Date.now(), fossilCount: 0 });
      this._saveEras(eras);
    }
    // Update count
    const existing = eras.eras.find(e => e.name === era);
    if (existing) {
      existing.fossilCount = (existing.fossilCount || 0) + 1;
      existing.lastFossil = Date.now();
      this._saveEras(eras);
    }
  }

  // ── Tick ──

  async tick() {
    const data = this._getFossils();
    const results = { classified: [], dnaExtracted: [], comparisons: [] };

    // Classify unclassified fossils
    const unclassified = data.fossils.filter(f => !f.classified).slice(0, 2);
    for (const fossil of unclassified) {
      const classified = await this.classify(fossil.id);
      if (classified) results.classified.push(classified);
    }

    // Extract DNA for fossils missing it
    const missingDNA = data.fossils.filter(f => !f.dna || !f.dna.traits || f.dna.traits.length === 0).slice(0, 2);
    for (const fossil of missingDNA) {
      const dna = await this.extractDNA(fossil.id);
      if (dna) results.dnaExtracted.push({ fossilId: fossil.id, dna });
    }

    // Update all fossil ages
    for (const f of data.fossils) {
      f.fossilAge = Math.floor((Date.now() - f.timestamp) / 86400000);
      f.autoEra = this._classifyEra(f.timestamp);
    }
    this._saveFossils(data);

    if (results.classified.length > 0) {
      this.emit('tick-classified', results.classified);
    }
    return results;
  }

  /** Get summary stats */
  getStats() {
    const data = this._getFossils();
    const lineage = this._getLineage();
    const dnaData = this._getDNA();
    const classified = data.fossils.filter(f => f.classified).length;
    const resurrected = data.fossils.filter(f => f.resurrected).length;
    const withDNA = data.fossils.filter(f => f.dna?.traits?.length > 0).length;
    const avgResurrection = data.fossils.length > 0
      ? Math.round(data.fossils.reduce((s, f) => s + f.resurrectionScore, 0) / data.fossils.length * 100) / 100
      : 0;

    return {
      totalFossils: data.fossils.length,
      classified,
      unclassified: data.fossils.length - classified,
      resurrected,
      withDNA,
      avgResurrectionScore: avgResurrection,
      totalLineages: lineage.edges.length,
      totalDNARecords: dnaData.patterns.length,
      eras: this._getEras().eras.length,
      byType: this._countBy(data.fossils, 'type'),
      byAutoEra: this._countBy(data.fossils, 'autoEra'),
      totalComparisons: this._getComparisons().comparisons.length,
      resurrectionCandidates: data.fossils.filter(f => !f.resurrected && f.classified && f.resurrectionScore > 0.7).length,
    };
  }
}

module.exports = ThoughtFossilRecord;
