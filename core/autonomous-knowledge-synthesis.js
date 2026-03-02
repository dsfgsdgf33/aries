/**
 * ARIES — Autonomous Knowledge Synthesis
 * Random-pairing distant concepts for novel connections.
 * 99% garbage, 1% genuine discovery. That 1% is worth it.
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

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

class AutonomousKnowledgeSynthesis extends EventEmitter {
  /**
   * @param {object} opts
   * @param {object} opts.ai - AI core module
   * @param {object} opts.config - synthesis config section
   */
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null;
    this.config = opts.config || {};
    this.maxConcepts = this.config.maxConcepts || 2000;
    this.maxPairings = this.config.maxPairings || 1000;
    this.maxDiscoveries = this.config.maxDiscoveries || 500;
    this.synthesisPerTick = this.config.synthesisPerTick || 3;
    this._interval = null;
  }

  // ── Concept Extraction ──

  /**
   * Extract concepts/entities from a knowledge source (text).
   * @param {string} source - text to extract from
   * @returns {object[]} extracted concepts
   */
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
            // Deduplicate by label
            const existing = concepts.find(ex => ex.label.toLowerCase() === (c.label || '').toLowerCase());
            if (!existing && c.label) {
              const entry = {
                id: uuid(),
                label: c.label,
                domain: c.domain || 'other',
                description: c.description || '',
                extractedAt: Date.now(),
                usedInPairings: 0,
                discoveryHits: 0,
              };
              concepts.push(entry);
              added.push(entry);
            }
          }
          // Cap size
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
        const entry = { id: uuid(), label: w, domain: 'other', description: '', extractedAt: Date.now(), usedInPairings: 0, discoveryHits: 0 };
        concepts.push(entry);
        added.push(entry);
      }
    }
    if (concepts.length > this.maxConcepts) concepts.splice(0, concepts.length - this.maxConcepts);
    writeJSON(CONCEPTS_FILE, concepts);
    return added;
  }

  /**
   * Get all stored concepts.
   */
  getConcepts(filter) {
    let concepts = readJSON(CONCEPTS_FILE, []);
    if (filter && filter.domain) concepts = concepts.filter(c => c.domain === filter.domain);
    if (filter && filter.search) {
      const s = filter.search.toLowerCase();
      concepts = concepts.filter(c => c.label.toLowerCase().includes(s) || (c.description || '').toLowerCase().includes(s));
    }
    return concepts;
  }

  // ── Random Pairing ──

  /**
   * Generate n random concept pairs, biased toward cross-domain pairings.
   * @param {number} n - number of pairs to generate
   * @returns {object[]} generated pairings
   */
  generatePairings(n = 5) {
    const concepts = readJSON(CONCEPTS_FILE, []);
    if (concepts.length < 2) return [];

    const pairings = readJSON(PAIRINGS_FILE, []);
    const serendipity = readJSON(SERENDIPITY_FILE, { domainPairScores: {}, totalAttempts: 0, totalDiscoveries: 0 });
    const generated = [];

    for (let i = 0; i < n; i++) {
      let a, b, attempts = 0;

      // Try to pick cross-domain pairs, with serendipity bias
      do {
        a = pick(concepts);
        b = pick(concepts);
        attempts++;
      } while (attempts < 20 && (a.id === b.id || a.domain === b.domain && Math.random() < 0.7));

      // Check for duplicate pairing
      const pairKey = [a.id, b.id].sort().join(':');
      if (pairings.find(p => p.pairKey === pairKey)) continue;

      // Check serendipity bias — prefer domain pairs that have produced discoveries
      const domainKey = [a.domain, b.domain].sort().join(':');
      const domainScore = serendipity.domainPairScores[domainKey] || 0;
      // If domain pair has negative score, skip sometimes
      if (domainScore < -3 && Math.random() < 0.5) continue;

      const pairing = {
        id: uuid(),
        pairKey,
        conceptA: { id: a.id, label: a.label, domain: a.domain },
        conceptB: { id: b.id, label: b.label, domain: b.domain },
        domainKey,
        status: 'pending', // pending, synthesized, filtered, discovery, rejected
        createdAt: Date.now(),
      };

      pairings.push(pairing);
      generated.push(pairing);

      // Update usage counts
      a.usedInPairings = (a.usedInPairings || 0) + 1;
      b.usedInPairings = (b.usedInPairings || 0) + 1;
    }

    // Cap pairings
    if (pairings.length > this.maxPairings) pairings.splice(0, pairings.length - this.maxPairings);
    writeJSON(PAIRINGS_FILE, pairings);
    writeJSON(CONCEPTS_FILE, concepts);

    if (generated.length > 0) this.emit('pairings-generated', generated);
    return generated;
  }

  // ── Synthesis ──

  /**
   * AI attempts to find meaningful connections between a paired concept.
   * @param {string} pairId
   * @returns {object} synthesis result
   */
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
          content: `You are a creative knowledge synthesizer. Given two seemingly unrelated concepts, find genuine, non-trivial connections between them. Be rigorous — most pairings will have no meaningful connection, and that's fine. Say so honestly.

Return JSON:
{
  "hasConnection": true/false,
  "connection": "description of the connection (if any)",
  "novelty": 0-100,
  "confidence": 0-100,
  "applications": ["how this insight could be used"],
  "reasoning": "why this connection matters or why there isn't one"
}

Be brutally honest. A forced, trivial, or cliché connection is WORSE than no connection. Only mark hasConnection:true for genuinely interesting, non-obvious links.`
        },
        {
          role: 'user',
          content: `Concept A: "${pairing.conceptA.label}" (domain: ${pairing.conceptA.domain})
Concept B: "${pairing.conceptB.label}" (domain: ${pairing.conceptB.domain})

Find a meaningful, non-trivial connection — or honestly say there isn't one.`
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

      console.log(`[KNOWLEDGE-SYNTHESIS] ${result.hasConnection ? '✨' : '✗'} ${pairing.conceptA.label} × ${pairing.conceptB.label}: ${result.hasConnection ? result.connection.slice(0, 80) : 'no connection'}`);
      return { pairing, result };
    } catch (e) {
      pairing.status = 'rejected';
      pairing.error = e.message;
      writeJSON(PAIRINGS_FILE, pairings);
      return { error: e.message };
    }
  }

  // ── Quality Filter ──

  /**
   * Multi-stage quality gate for synthesized connections.
   * @param {string} pairId - pairing that has been synthesized
   * @returns {object} filter result
   */
  async filterDiscovery(pairId) {
    const pairings = readJSON(PAIRINGS_FILE, []);
    const pairing = pairings.find(p => p.id === pairId);
    if (!pairing || !pairing.synthesis) return { error: 'No synthesis to filter' };
    if (!pairing.synthesis.hasConnection) return { passed: false, reason: 'No connection found' };

    const syn = pairing.synthesis;

    // Stage 1: Score thresholds
    if (syn.novelty < 40 || syn.confidence < 30) {
      pairing.status = 'rejected';
      pairing.filterReason = 'Below score threshold';
      writeJSON(PAIRINGS_FILE, pairings);
      return { passed: false, reason: 'Scores too low', novelty: syn.novelty, confidence: syn.confidence };
    }

    // Stage 2: AI second opinion (if available)
    if (this.ai) {
      try {
        const messages = [
          {
            role: 'system',
            content: `You are a critical evaluator of claimed knowledge connections. Be skeptical. Many claimed connections are trivial, obvious, or forced. 
Return JSON: { "isGenuine": true/false, "critique": "your assessment", "adjustedNovelty": 0-100, "adjustedConfidence": 0-100 }
Only approve genuinely surprising, non-obvious, and potentially useful connections.`
          },
          {
            role: 'user',
            content: `Connection claim: "${pairing.conceptA.label}" and "${pairing.conceptB.label}" are connected because: "${syn.connection}"
Novelty: ${syn.novelty}, Confidence: ${syn.confidence}
Reasoning: ${syn.reasoning}

Is this genuine or garbage?`
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

          // Passed! Create discovery
          syn.novelty = review.adjustedNovelty || syn.novelty;
          syn.confidence = review.adjustedConfidence || syn.confidence;
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
      reasoning: syn.reasoning,
      applications: syn.applications || [],
      novelty: syn.novelty,
      confidence: syn.confidence,
      discoveredAt: Date.now(),
      used: false,
    };

    const discoveries = readJSON(DISCOVERIES_FILE, []);
    discoveries.push(discovery);
    if (discoveries.length > this.maxDiscoveries) discoveries.splice(0, discoveries.length - this.maxDiscoveries);
    writeJSON(DISCOVERIES_FILE, discoveries);

    // Update serendipity engine
    this._updateSerendipity(pairing.domainKey, true);

    // Update concept discovery hits
    const concepts = readJSON(CONCEPTS_FILE, []);
    for (const c of concepts) {
      if (c.id === pairing.conceptA.id || c.id === pairing.conceptB.id) {
        c.discoveryHits = (c.discoveryHits || 0) + 1;
      }
    }
    writeJSON(CONCEPTS_FILE, concepts);

    this.emit('discovery', discovery);
    console.log(`[KNOWLEDGE-SYNTHESIS] 🔬 DISCOVERY: ${discovery.conceptA.label} × ${discovery.conceptB.label} — ${discovery.connection.slice(0, 100)}`);
    return { passed: true, discovery };
  }

  // ── Serendipity Engine ──

  _updateSerendipity(domainKey, wasDiscovery) {
    const serendipity = readJSON(SERENDIPITY_FILE, { domainPairScores: {}, totalAttempts: 0, totalDiscoveries: 0 });
    serendipity.totalAttempts++;
    if (wasDiscovery) serendipity.totalDiscoveries++;
    const current = serendipity.domainPairScores[domainKey] || 0;
    serendipity.domainPairScores[domainKey] = wasDiscovery ? current + 2 : current - 0.5;
    serendipity.lastUpdated = Date.now();
    writeJSON(SERENDIPITY_FILE, serendipity);
  }

  getSerendipityStats() {
    const serendipity = readJSON(SERENDIPITY_FILE, { domainPairScores: {}, totalAttempts: 0, totalDiscoveries: 0 });
    const sorted = Object.entries(serendipity.domainPairScores)
      .sort((a, b) => b[1] - a[1]);
    return {
      totalAttempts: serendipity.totalAttempts,
      totalDiscoveries: serendipity.totalDiscoveries,
      discoveryRate: serendipity.totalAttempts > 0 ? (serendipity.totalDiscoveries / serendipity.totalAttempts * 100).toFixed(1) + '%' : '0%',
      bestDomainPairs: sorted.slice(0, 10).map(([k, v]) => ({ domains: k, score: v })),
      worstDomainPairs: sorted.slice(-5).reverse().map(([k, v]) => ({ domains: k, score: v })),
    };
  }

  // ── Discovery Registry ──

  /**
   * Browse validated discoveries.
   * @param {object} filter - { minNovelty, minConfidence, search, unused }
   */
  getDiscoveries(filter = {}) {
    let discoveries = readJSON(DISCOVERIES_FILE, []);
    if (filter.minNovelty) discoveries = discoveries.filter(d => d.novelty >= filter.minNovelty);
    if (filter.minConfidence) discoveries = discoveries.filter(d => d.confidence >= filter.minConfidence);
    if (filter.unused) discoveries = discoveries.filter(d => !d.used);
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

  /**
   * Mark a discovery as used.
   */
  markUsed(discoveryId) {
    const discoveries = readJSON(DISCOVERIES_FILE, []);
    const d = discoveries.find(x => x.id === discoveryId);
    if (d) { d.used = true; d.usedAt = Date.now(); writeJSON(DISCOVERIES_FILE, discoveries); }
    return d;
  }

  // ── Tick (periodic) ──

  /**
   * Periodic operation: generate pairings, attempt synthesis, filter.
   */
  async tick() {
    const concepts = readJSON(CONCEPTS_FILE, []);
    if (concepts.length < 2) {
      console.log('[KNOWLEDGE-SYNTHESIS] Not enough concepts for synthesis (need ≥2)');
      return { skipped: true, reason: 'insufficient concepts' };
    }

    // Generate new pairings
    const pairings = this.generatePairings(this.synthesisPerTick);

    // Synthesize pending pairings
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

    return {
      conceptCount: concepts.length,
      newPairings: pairings.length,
      synthesized: results.length,
      discoveries: results.filter(r => r.filter && r.filter.passed).length,
    };
  }

  /**
   * Get summary stats.
   */
  stats() {
    const concepts = readJSON(CONCEPTS_FILE, []);
    const pairings = readJSON(PAIRINGS_FILE, []);
    const discoveries = readJSON(DISCOVERIES_FILE, []);
    const serendipity = this.getSerendipityStats();

    return {
      concepts: concepts.length,
      pairings: pairings.length,
      pendingPairings: pairings.filter(p => p.status === 'pending').length,
      discoveries: discoveries.length,
      unusedDiscoveries: discoveries.filter(d => !d.used).length,
      serendipity,
    };
  }
}

let _instance = null;
function getInstance(opts) {
  if (!_instance) _instance = new AutonomousKnowledgeSynthesis(opts);
  return _instance;
}

module.exports = { AutonomousKnowledgeSynthesis, getInstance };
