/**
 * ARIES — Autonomous Knowledge Synthesis
 * Random-pairing distant concepts for novel connections.
 * 99% garbage, 1% genuine discovery. That 1% is worth it.
 * 
 * Features: cross-domain random pairing, two-stage quality filter,
 * serendipity engine, synthesis categories, novelty scoring,
 * validation pipeline, synthesis chains, domain distance metric.
 */

'use strict';

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'knowledge');
const CONCEPTS_FILE = path.join(DATA_DIR, 'concepts.json');
const PAIRINGS_FILE = path.join(DATA_DIR, 'pairings.json');
const DISCOVERIES_FILE = path.join(DATA_DIR, 'discoveries.json');
const SERENDIPITY_FILE = path.join(DATA_DIR, 'serendipity.json');
const CHAINS_FILE = path.join(DATA_DIR, 'synthesis-chains.json');
const VALIDATION_FILE = path.join(DATA_DIR, 'validation-queue.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// Synthesis categories
const SYNTHESIS_CATEGORIES = {
  ANALOGICAL: 'analogical',     // A is like B because...
  CAUSAL: 'causal',             // A causes/affects B
  STRUCTURAL: 'structural',     // A and B share structure
  FUNCTIONAL: 'functional',     // A and B serve similar purpose
  EMERGENT: 'emergent',         // combining A+B creates something new
};

// Domain ordering for distance metric
const DOMAIN_ORDER = ['personal', 'social', 'art', 'philosophy', 'nature', 'science', 'technology', 'other'];

class AutonomousKnowledgeSynthesis extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null;
    this.config = opts.config || {};
    this.maxConcepts = this.config.maxConcepts || 2000;
    this.maxPairings = this.config.maxPairings || 1000;
    this.maxDiscoveries = this.config.maxDiscoveries || 500;
    this.synthesisPerTick = this.config.synthesisPerTick || 3;
    this.noveltyThreshold = this.config.noveltyThreshold || 40;
    this.confidenceThreshold = this.config.confidenceThreshold || 30;
    this._interval = null;
  }

  // ═══════════════════════════════════════════
  //  Domain Distance Metric
  // ═══════════════════════════════════════════

  /**
   * Compute distance between two domains (0-1).
   * Further apart = higher potential but lower probability of connection.
   */
  domainDistance(domainA, domainB) {
    if (domainA === domainB) return 0;
    const idxA = DOMAIN_ORDER.indexOf(domainA);
    const idxB = DOMAIN_ORDER.indexOf(domainB);
    if (idxA < 0 || idxB < 0) return 0.5;
    return Math.abs(idxA - idxB) / (DOMAIN_ORDER.length - 1);
  }

  // ═══════════════════════════════════════════
  //  Concept Extraction
  // ═══════════════════════════════════════════

  async extractConcepts(source) {
    if (!source || typeof source !== 'string') return [];
    const concepts = readJSON(CONCEPTS_FILE, []);

    if (this.ai) {
      try {
        const messages = [
          {
            role: 'system',
            content: `Extract distinct concepts, entities, and ideas from the text. Return JSON array:
[{"label":"...", "domain":"technology|science|philosophy|art|social|nature|personal|other", "description":"one-line description"}]
Extract 3-10 concepts. Focus on substantial ideas, not trivial words.`
          },
          { role: 'user', content: source.slice(0, 3000) }
        ];
        const resp = await this.ai.chat(messages);
        const text = (resp.response || '').replace(/```json\n?/g, '').replace(/```/g, '').trim();
        const match = text.match(/\[[\s\S]*\]/);
        if (match) {
          const extracted = JSON.parse(match[0]);
          const added = [];
          for (const c of extracted) {
            const existing = concepts.find(ex => ex.label.toLowerCase() === (c.label || '').toLowerCase());
            if (!existing && c.label) {
              const entry = {
                id: uuid(), label: c.label, domain: c.domain || 'other',
                description: c.description || '', extractedAt: Date.now(),
                usedInPairings: 0, discoveryHits: 0, chainParticipation: 0,
              };
              concepts.push(entry);
              added.push(entry);
            }
          }
          if (concepts.length > this.maxConcepts) concepts.splice(0, concepts.length - this.maxConcepts);
          writeJSON(CONCEPTS_FILE, concepts);
          this.emit('concepts-extracted', added);
          return added;
        }
      } catch (e) {
        console.error('[KNOWLEDGE-SYNTHESIS] Extraction error:', e.message);
      }
    }

    // Fallback: naive keyword extraction
    const words = [...new Set(source.toLowerCase().match(/\b[a-z]{5,}\b/g) || [])].slice(0, 10);
    const added = [];
    for (const w of words) {
      if (!concepts.find(c => c.label.toLowerCase() === w)) {
        const entry = { id: uuid(), label: w, domain: 'other', description: '', extractedAt: Date.now(), usedInPairings: 0, discoveryHits: 0, chainParticipation: 0 };
        concepts.push(entry);
        added.push(entry);
      }
    }
    if (concepts.length > this.maxConcepts) concepts.splice(0, concepts.length - this.maxConcepts);
    writeJSON(CONCEPTS_FILE, concepts);
    return added;
  }

  getConcepts(filter) {
    let concepts = readJSON(CONCEPTS_FILE, []);
    if (filter && filter.domain) concepts = concepts.filter(c => c.domain === filter.domain);
    if (filter && filter.search) {
      const s = filter.search.toLowerCase();
      concepts = concepts.filter(c => c.label.toLowerCase().includes(s) || (c.description || '').toLowerCase().includes(s));
    }
    return concepts;
  }

  // ═══════════════════════════════════════════
  //  Random Pairing with Distance Bias
  // ═══════════════════════════════════════════

  generatePairings(n = 5) {
    const concepts = readJSON(CONCEPTS_FILE, []);
    if (concepts.length < 2) return [];

    const pairings = readJSON(PAIRINGS_FILE, []);
    const serendipity = readJSON(SERENDIPITY_FILE, { domainPairScores: {}, totalAttempts: 0, totalDiscoveries: 0 });
    const generated = [];

    for (let i = 0; i < n; i++) {
      let a, b, attempts = 0;

      do {
        a = pick(concepts);
        b = pick(concepts);
        attempts++;
      } while (attempts < 20 && (a.id === b.id || (a.domain === b.domain && Math.random() < 0.7)));

      const pairKey = [a.id, b.id].sort().join(':');
      if (pairings.find(p => p.pairKey === pairKey)) continue;

      const domainKey = [a.domain, b.domain].sort().join(':');
      const domainScore = serendipity.domainPairScores[domainKey] || 0;
      if (domainScore < -3 && Math.random() < 0.5) continue;

      const distance = this.domainDistance(a.domain, b.domain);

      const pairing = {
        id: uuid(),
        pairKey,
        conceptA: { id: a.id, label: a.label, domain: a.domain },
        conceptB: { id: b.id, label: b.label, domain: b.domain },
        domainKey,
        domainDistance: Math.round(distance * 1000) / 1000,
        status: 'pending',
        createdAt: Date.now(),
      };

      pairings.push(pairing);
      generated.push(pairing);
      a.usedInPairings = (a.usedInPairings || 0) + 1;
      b.usedInPairings = (b.usedInPairings || 0) + 1;
    }

    if (pairings.length > this.maxPairings) pairings.splice(0, pairings.length - this.maxPairings);
    writeJSON(PAIRINGS_FILE, pairings);
    writeJSON(CONCEPTS_FILE, concepts);
    if (generated.length > 0) this.emit('pairings-generated', generated);
    return generated;
  }

  // ═══════════════════════════════════════════
  //  Synthesis with Category Classification
  // ═══════════════════════════════════════════

  async synthesize(pairId) {
    if (!this.ai) return { error: 'AI module required for synthesis' };

    const pairings = readJSON(PAIRINGS_FILE, []);
    const pairing = pairings.find(p => p.id === pairId);
    if (!pairing) return { error: 'Pairing not found' };
    if (pairing.status !== 'pending') return { error: `Pairing already ${pairing.status}` };

    try {
      const messages = [
        {
          role: 'system',
          content: `You are a creative knowledge synthesizer. Given two concepts, find genuine, non-trivial connections.

Domain distance: ${pairing.domainDistance || 'unknown'} (higher = more distant domains)

Return JSON:
{
  "hasConnection": true/false,
  "connection": "description of the connection",
  "category": "analogical|causal|structural|functional|emergent",
  "novelty": 0-100,
  "confidence": 0-100,
  "applications": ["how this insight could be used"],
  "reasoning": "why this matters or why there isn't a connection",
  "testable": true/false,
  "testMethod": "how to validate this connection (if testable)"
}

Categories:
- analogical: A is like B because...
- causal: A causes/affects B  
- structural: A and B share deep structure
- functional: A and B serve similar purposes in different domains
- emergent: combining A+B creates novel insight

Be brutally honest. Forced connections are WORSE than no connection.`
        },
        {
          role: 'user',
          content: `Concept A: "${pairing.conceptA.label}" (domain: ${pairing.conceptA.domain})
Concept B: "${pairing.conceptB.label}" (domain: ${pairing.conceptB.domain})`
        }
      ];

      const resp = await this.ai.chat(messages);
      const text = (resp.response || '').replace(/```json\n?/g, '').replace(/```/g, '').trim();
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('No JSON in response');

      const result = JSON.parse(match[0]);
      pairing.synthesis = result;
      pairing.synthesizedAt = Date.now();
      pairing.status = result.hasConnection ? 'synthesized' : 'rejected';

      writeJSON(PAIRINGS_FILE, pairings);
      this.emit('synthesis-complete', { pairing, result });
      return { pairing, result };
    } catch (e) {
      pairing.status = 'rejected';
      pairing.error = e.message;
      writeJSON(PAIRINGS_FILE, pairings);
      return { error: e.message };
    }
  }

  // ═══════════════════════════════════════════
  //  Two-Stage Quality Filter
  // ═══════════════════════════════════════════

  async filterDiscovery(pairId) {
    const pairings = readJSON(PAIRINGS_FILE, []);
    const pairing = pairings.find(p => p.id === pairId);
    if (!pairing || !pairing.synthesis) return { error: 'No synthesis to filter' };
    if (!pairing.synthesis.hasConnection) return { passed: false, reason: 'No connection found' };

    const syn = pairing.synthesis;

    // Stage 1: Score thresholds
    if (syn.novelty < this.noveltyThreshold || syn.confidence < this.confidenceThreshold) {
      pairing.status = 'rejected';
      pairing.filterReason = 'Below score threshold';
      writeJSON(PAIRINGS_FILE, pairings);
      return { passed: false, reason: 'Scores too low', novelty: syn.novelty, confidence: syn.confidence };
    }

    // Stage 2: Skeptical AI review
    if (this.ai) {
      try {
        const messages = [
          {
            role: 'system',
            content: `You are a SKEPTICAL evaluator of knowledge connections. Be harsh. Most claimed connections are trivial, obvious, or forced.

Evaluate:
1. Is this genuinely non-obvious?
2. Is the ${syn.category || 'unknown'} categorization correct?
3. Could this lead to actionable insight?
4. Is it testable/verifiable?

Return JSON: { "isGenuine": true/false, "critique": "assessment", "adjustedNovelty": 0-100, "adjustedConfidence": 0-100, "correctedCategory": "analogical|causal|structural|functional|emergent|null" }`
          },
          {
            role: 'user',
            content: `"${pairing.conceptA.label}" ↔ "${pairing.conceptB.label}"
Category: ${syn.category}
Connection: "${syn.connection}"
Novelty: ${syn.novelty}, Confidence: ${syn.confidence}
Reasoning: ${syn.reasoning}
Testable: ${syn.testable}, Method: ${syn.testMethod || 'none'}`
          }
        ];

        const resp = await this.ai.chat(messages);
        const text = (resp.response || '').replace(/```json\n?/g, '').replace(/```/g, '').trim();
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
          const review = JSON.parse(match[0]);
          pairing.review = review;

          if (!review.isGenuine) {
            pairing.status = 'rejected';
            pairing.filterReason = review.critique;
            writeJSON(PAIRINGS_FILE, pairings);
            this._updateSerendipity(pairing.domainKey, false);
            return { passed: false, reason: review.critique };
          }

          syn.novelty = review.adjustedNovelty || syn.novelty;
          syn.confidence = review.adjustedConfidence || syn.confidence;
          if (review.correctedCategory && Object.values(SYNTHESIS_CATEGORIES).includes(review.correctedCategory)) {
            syn.category = review.correctedCategory;
          }
        }
      } catch {}
    }

    // Promote to discovery
    pairing.status = 'discovery';
    writeJSON(PAIRINGS_FILE, pairings);

    const discovery = {
      id: uuid(),
      pairId: pairing.id,
      conceptA: pairing.conceptA,
      conceptB: pairing.conceptB,
      connection: syn.connection,
      category: syn.category || 'emergent',
      reasoning: syn.reasoning,
      applications: syn.applications || [],
      novelty: syn.novelty,
      confidence: syn.confidence,
      domainDistance: pairing.domainDistance || 0,
      testable: syn.testable || false,
      testMethod: syn.testMethod || null,
      discoveredAt: Date.now(),
      used: false,
      chainedFrom: null,
      chainedTo: [],
      validated: false,
    };

    const discoveries = readJSON(DISCOVERIES_FILE, []);
    discoveries.push(discovery);
    if (discoveries.length > this.maxDiscoveries) discoveries.splice(0, discoveries.length - this.maxDiscoveries);
    writeJSON(DISCOVERIES_FILE, discoveries);

    this._updateSerendipity(pairing.domainKey, true);

    // Update concept stats
    const concepts = readJSON(CONCEPTS_FILE, []);
    for (const c of concepts) {
      if (c.id === pairing.conceptA.id || c.id === pairing.conceptB.id) {
        c.discoveryHits = (c.discoveryHits || 0) + 1;
      }
    }
    writeJSON(CONCEPTS_FILE, concepts);

    // Add to validation queue if testable
    if (discovery.testable) {
      const queue = readJSON(VALIDATION_FILE, []);
      queue.push({ discoveryId: discovery.id, testMethod: discovery.testMethod, addedAt: Date.now(), status: 'pending' });
      writeJSON(VALIDATION_FILE, queue);
    }

    this.emit('discovery', discovery);
    return { passed: true, discovery };
  }

  // ═══════════════════════════════════════════
  //  Validation Pipeline
  // ═══════════════════════════════════════════

  /**
   * Get testable discoveries awaiting validation.
   */
  getValidationQueue() {
    return readJSON(VALIDATION_FILE, []).filter(v => v.status === 'pending');
  }

  /**
   * Record validation result for a discovery.
   */
  validateDiscovery(discoveryId, passed, evidence) {
    const discoveries = readJSON(DISCOVERIES_FILE, []);
    const d = discoveries.find(x => x.id === discoveryId);
    if (!d) return { error: 'Discovery not found' };

    d.validated = true;
    d.validationPassed = passed;
    d.validationEvidence = (evidence || '').slice(0, 500);
    d.validatedAt = Date.now();
    writeJSON(DISCOVERIES_FILE, discoveries);

    // Update validation queue
    const queue = readJSON(VALIDATION_FILE, []);
    const item = queue.find(v => v.discoveryId === discoveryId);
    if (item) {
      item.status = passed ? 'passed' : 'failed';
      item.resolvedAt = Date.now();
      writeJSON(VALIDATION_FILE, queue);
    }

    // Boost serendipity for validated discoveries
    if (passed && d.conceptA && d.conceptB) {
      const domainKey = [d.conceptA.domain, d.conceptB.domain].sort().join(':');
      this._updateSerendipity(domainKey, true);
    }

    this.emit('discovery-validated', { discoveryId, passed });
    return d;
  }

  // ═══════════════════════════════════════════
  //  Synthesis Chains
  // ═══════════════════════════════════════════

  /**
   * Attempt to chain a new synthesis from an existing discovery.
   * Takes a discovery and pairs one of its concepts with a new random concept.
   */
  async chainSynthesis(discoveryId) {
    const discoveries = readJSON(DISCOVERIES_FILE, []);
    const source = discoveries.find(d => d.id === discoveryId);
    if (!source) return { error: 'Source discovery not found' };

    const concepts = readJSON(CONCEPTS_FILE, []);
    if (concepts.length < 3) return { error: 'Not enough concepts' };

    // Pick which concept to extend from
    const baseConcept = Math.random() < 0.5 ? source.conceptA : source.conceptB;
    const usedIds = new Set([source.conceptA.id, source.conceptB.id]);

    // Find a new concept not in the original pair
    const available = concepts.filter(c => !usedIds.has(c.id));
    if (available.length === 0) return { error: 'No available concepts for chaining' };
    const newConcept = pick(available);

    // Create a chained pairing
    const pairings = readJSON(PAIRINGS_FILE, []);
    const pairKey = [baseConcept.id, newConcept.id].sort().join(':');
    if (pairings.find(p => p.pairKey === pairKey)) return { error: 'Pairing already exists' };

    const pairing = {
      id: uuid(),
      pairKey,
      conceptA: { id: baseConcept.id, label: baseConcept.label, domain: baseConcept.domain },
      conceptB: { id: newConcept.id, label: newConcept.label, domain: newConcept.domain },
      domainKey: [baseConcept.domain, newConcept.domain].sort().join(':'),
      domainDistance: this.domainDistance(baseConcept.domain, newConcept.domain),
      status: 'pending',
      createdAt: Date.now(),
      chainedFrom: discoveryId,
    };
    pairings.push(pairing);
    writeJSON(PAIRINGS_FILE, pairings);

    // Synthesize immediately
    const synResult = await this.synthesize(pairing.id);
    if (synResult.result && synResult.result.hasConnection) {
      const filterResult = await this.filterDiscovery(pairing.id);
      if (filterResult.passed) {
        // Record chain link
        const chains = readJSON(CHAINS_FILE, []);
        chains.push({
          fromDiscovery: discoveryId,
          toDiscovery: filterResult.discovery.id,
          chainedAt: Date.now(),
        });
        writeJSON(CHAINS_FILE, chains);

        // Update source and new discovery
        source.chainedTo = source.chainedTo || [];
        source.chainedTo.push(filterResult.discovery.id);
        filterResult.discovery.chainedFrom = discoveryId;
        writeJSON(DISCOVERIES_FILE, discoveries);

        // Update concept chain participation
        const allConcepts = readJSON(CONCEPTS_FILE, []);
        for (const c of allConcepts) {
          if (c.id === baseConcept.id || c.id === newConcept.id) {
            c.chainParticipation = (c.chainParticipation || 0) + 1;
          }
        }
        writeJSON(CONCEPTS_FILE, allConcepts);

        this.emit('chain-extended', { source: discoveryId, newDiscovery: filterResult.discovery.id });
        return { chained: true, discovery: filterResult.discovery };
      }
    }

    return { chained: false, reason: 'No valid connection found in chain' };
  }

  /**
   * Get synthesis chains (linked discoveries).
   */
  getSynthesisChains() {
    return readJSON(CHAINS_FILE, []);
  }

  // ═══════════════════════════════════════════
  //  Serendipity Engine
  // ═══════════════════════════════════════════

  _updateSerendipity(domainKey, wasDiscovery) {
    const serendipity = readJSON(SERENDIPITY_FILE, { domainPairScores: {}, totalAttempts: 0, totalDiscoveries: 0, categoryHits: {} });
    serendipity.totalAttempts++;
    if (wasDiscovery) serendipity.totalDiscoveries++;
    const current = serendipity.domainPairScores[domainKey] || 0;
    serendipity.domainPairScores[domainKey] = wasDiscovery ? current + 2 : current - 0.5;
    serendipity.lastUpdated = Date.now();
    writeJSON(SERENDIPITY_FILE, serendipity);
  }

  getSerendipityStats() {
    const serendipity = readJSON(SERENDIPITY_FILE, { domainPairScores: {}, totalAttempts: 0, totalDiscoveries: 0 });
    const sorted = Object.entries(serendipity.domainPairScores).sort((a, b) => b[1] - a[1]);

    // Category distribution from discoveries
    const discoveries = readJSON(DISCOVERIES_FILE, []);
    const catDist = {};
    for (const d of discoveries) {
      catDist[d.category || 'unknown'] = (catDist[d.category || 'unknown'] || 0) + 1;
    }

    return {
      totalAttempts: serendipity.totalAttempts,
      totalDiscoveries: serendipity.totalDiscoveries,
      discoveryRate: serendipity.totalAttempts > 0 ? (serendipity.totalDiscoveries / serendipity.totalAttempts * 100).toFixed(1) + '%' : '0%',
      bestDomainPairs: sorted.slice(0, 10).map(([k, v]) => ({ domains: k, score: v })),
      worstDomainPairs: sorted.slice(-5).reverse().map(([k, v]) => ({ domains: k, score: v })),
      categoryDistribution: catDist,
    };
  }

  // ═══════════════════════════════════════════
  //  Discovery Registry
  // ═══════════════════════════════════════════

  getDiscoveries(filter = {}) {
    let discoveries = readJSON(DISCOVERIES_FILE, []);
    if (filter.minNovelty) discoveries = discoveries.filter(d => d.novelty >= filter.minNovelty);
    if (filter.minConfidence) discoveries = discoveries.filter(d => d.confidence >= filter.minConfidence);
    if (filter.unused) discoveries = discoveries.filter(d => !d.used);
    if (filter.category) discoveries = discoveries.filter(d => d.category === filter.category);
    if (filter.validated !== undefined) discoveries = discoveries.filter(d => d.validated === filter.validated);
    if (filter.search) {
      const s = filter.search.toLowerCase();
      discoveries = discoveries.filter(d =>
        d.connection.toLowerCase().includes(s) ||
        d.conceptA.label.toLowerCase().includes(s) ||
        d.conceptB.label.toLowerCase().includes(s)
      );
    }
    return discoveries.sort((a, b) => b.discoveredAt - a.discoveredAt);
  }

  markUsed(discoveryId) {
    const discoveries = readJSON(DISCOVERIES_FILE, []);
    const d = discoveries.find(x => x.id === discoveryId);
    if (d) { d.used = true; d.usedAt = Date.now(); writeJSON(DISCOVERIES_FILE, discoveries); }
    return d;
  }

  // ═══════════════════════════════════════════
  //  Tick
  // ═══════════════════════════════════════════

  async tick() {
    const concepts = readJSON(CONCEPTS_FILE, []);
    if (concepts.length < 2) {
      return { skipped: true, reason: 'insufficient concepts' };
    }

    const pairings = this.generatePairings(this.synthesisPerTick);

    const allPairings = readJSON(PAIRINGS_FILE, []);
    const pending = allPairings.filter(p => p.status === 'pending').slice(0, this.synthesisPerTick);
    const results = [];

    for (const p of pending) {
      const synResult = await this.synthesize(p.id);
      if (synResult.result && synResult.result.hasConnection) {
        const filterResult = await this.filterDiscovery(p.id);
        results.push({ pairId: p.id, synthesis: synResult, filter: filterResult });
      } else {
        results.push({ pairId: p.id, synthesis: synResult, filter: null });
      }
    }

    // Attempt to chain from a random recent discovery (low probability)
    const discoveries = readJSON(DISCOVERIES_FILE, []);
    if (discoveries.length > 0 && Math.random() < 0.2) {
      const recent = discoveries.slice(-10);
      const source = pick(recent);
      await this.chainSynthesis(source.id).catch(() => {});
    }

    return {
      conceptCount: concepts.length,
      newPairings: pairings.length,
      synthesized: results.length,
      discoveries: results.filter(r => r.filter && r.filter.passed).length,
    };
  }

  stats() {
    const concepts = readJSON(CONCEPTS_FILE, []);
    const pairings = readJSON(PAIRINGS_FILE, []);
    const discoveries = readJSON(DISCOVERIES_FILE, []);
    const chains = readJSON(CHAINS_FILE, []);
    const validationQueue = readJSON(VALIDATION_FILE, []);
    const serendipity = this.getSerendipityStats();

    return {
      concepts: concepts.length,
      pairings: pairings.length,
      pendingPairings: pairings.filter(p => p.status === 'pending').length,
      discoveries: discoveries.length,
      unusedDiscoveries: discoveries.filter(d => !d.used).length,
      validatedDiscoveries: discoveries.filter(d => d.validated).length,
      pendingValidation: validationQueue.filter(v => v.status === 'pending').length,
      synthChains: chains.length,
      serendipity,
    };
  }
}

AutonomousKnowledgeSynthesis.CATEGORIES = SYNTHESIS_CATEGORIES;

let _instance = null;
function getInstance(opts) {
  if (!_instance) _instance = new AutonomousKnowledgeSynthesis(opts);
  return _instance;
}

module.exports = AutonomousKnowledgeSynthesis;
