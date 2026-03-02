/**
 * ARIES — Proof-of-Thought Consensus
 * Byzantine fault tolerance for reasoning. Multiple independent chains must converge.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'reasoning');
const CONSENSUS_PATH = path.join(DATA_DIR, 'consensus.json');
const THRESHOLDS_PATH = path.join(DATA_DIR, 'thresholds.json');
const ACCURACY_PATH = path.join(DATA_DIR, 'accuracy.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

const CONSENSUS_LEVELS = {
  UNANIMOUS: 'UNANIMOUS',
  MAJORITY: 'MAJORITY',
  SPLIT: 'SPLIT',
  DEADLOCK: 'DEADLOCK',
};

const CHAIN_FRAMINGS = [
  'analytical',    // cold logic, step by step
  'adversarial',   // assume the opposite, try to disprove
  'creative',      // lateral thinking, unexpected angles
  'conservative',  // cautious, worst-case focused
  'empirical',     // evidence and data focused
];

class ProofOfThoughtConsensus {
  constructor(opts) {
    ensureDir();
    this.ai = opts && opts.ai;
    this.config = (opts && opts.config) || {};
    this.defaultChains = this.config.defaultChains || 3;
  }

  /**
   * Multi-chain reasoning with consensus.
   */
  async reason(problem, context, numChains) {
    const chains = numChains || this._getChainsForImportance(problem);
    const id = uuid();
    const record = {
      id,
      problem,
      context: context || null,
      numChains: chains,
      startedAt: Date.now(),
      chainResults: [],
      consensus: null,
      resolution: null,
      completedAt: null,
    };

    try {
      // Spawn independent chains in parallel
      const promises = [];
      for (let i = 0; i < chains; i++) {
        const framing = CHAIN_FRAMINGS[i % CHAIN_FRAMINGS.length];
        promises.push(this._executeChain(problem, context, framing, i));
      }
      record.chainResults = await Promise.all(promises);

      // Check consensus
      record.consensus = await this.checkConsensus(record.chainResults);

      // Resolve conflicts if needed
      if (record.consensus.level !== CONSENSUS_LEVELS.UNANIMOUS) {
        record.resolution = await this.resolveConflict(record.chainResults, record.consensus);
      } else {
        record.resolution = {
          method: 'unanimous',
          conclusion: record.chainResults[0].conclusion,
          confidence: 99,
        };
      }

      record.completedAt = Date.now();
      record.durationMs = record.completedAt - record.startedAt;
      this._store(record);
      return record;

    } catch (e) {
      record.error = e.message;
      record.completedAt = Date.now();
      this._store(record);
      return record;
    }
  }

  /**
   * Execute a single independent reasoning chain.
   */
  async _executeChain(problem, context, framing, index) {
    const chain = {
      id: uuid(),
      index,
      framing,
      startedAt: Date.now(),
      reasoning: null,
      conclusion: null,
      confidence: 50,
    };

    if (this.ai && typeof this.ai.chat === 'function') {
      const framingPrompts = {
        analytical: 'Analyze this problem with pure logic. Be systematic and precise. Show each step.',
        adversarial: 'Play devil\'s advocate. Try to find flaws, counterarguments, and hidden assumptions. Then give your honest conclusion.',
        creative: 'Think laterally. Consider unconventional angles, metaphors, and unexpected connections. Then conclude.',
        conservative: 'Be cautious. Consider worst cases, risks, and what could go wrong. Give a conservative conclusion.',
        empirical: 'Focus on evidence, data, and observable facts. Avoid speculation. What does the evidence say?',
      };

      const prompt = `${framingPrompts[framing] || 'Analyze this problem carefully.'}

Problem: "${problem}"
${context ? 'Context: ' + JSON.stringify(context) : ''}

Return JSON:
{
  "reasoning": "your step-by-step reasoning",
  "conclusion": "your final conclusion (1-3 sentences)",
  "confidence": 0-100,
  "keyPoints": ["point1", "point2"]
}`;

      try {
        const resp = await this.ai.chat([
          { role: 'system', content: `You are reasoning chain #${index + 1} using ${framing} framing. You CANNOT see other chains. Return ONLY valid JSON.` },
          { role: 'user', content: prompt }
        ]);
        const text = (resp.response || '').replace(/```json\n?/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(text);
        chain.reasoning = parsed.reasoning || '';
        chain.conclusion = parsed.conclusion || '';
        chain.confidence = Math.max(0, Math.min(100, parsed.confidence || 50));
        chain.keyPoints = parsed.keyPoints || [];
      } catch (e) {
        chain.reasoning = 'Chain execution failed: ' + e.message;
        chain.conclusion = 'Unable to reason about this problem.';
        chain.confidence = 0;
        chain.error = e.message;
      }
    } else {
      chain.reasoning = `Heuristic ${framing} analysis of: ${problem}`;
      chain.conclusion = `Requires AI for ${framing} reasoning. Problem has ${(problem || '').split(/\s+/).length} words.`;
      chain.confidence = 30;
    }

    chain.completedAt = Date.now();
    chain.durationMs = chain.completedAt - chain.startedAt;
    return chain;
  }

  /**
   * Determine consensus level from chain results.
   */
  async checkConsensus(chainResults) {
    if (!chainResults || chainResults.length === 0) {
      return { level: CONSENSUS_LEVELS.DEADLOCK, agreement: 0, groups: [] };
    }

    if (chainResults.length === 1) {
      return { level: CONSENSUS_LEVELS.UNANIMOUS, agreement: 100, groups: [chainResults.map(c => c.id)] };
    }

    // Use AI to cluster conclusions by similarity
    if (this.ai && typeof this.ai.chat === 'function') {
      try {
        const conclusions = chainResults.map((c, i) => `Chain ${i}: "${c.conclusion}"`).join('\n');
        const resp = await this.ai.chat([
          { role: 'system', content: 'You compare reasoning conclusions for agreement. Return ONLY valid JSON.' },
          { role: 'user', content: `Compare these conclusions. Group the ones that essentially agree (same core answer, even if worded differently).

${conclusions}

Return JSON:
{
  "groups": [[0, 1], [2]],
  "agreementPercent": 0-100,
  "summary": "brief description of agreement/disagreement"
}` }
        ]);
        const text = (resp.response || '').replace(/```json\n?/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(text);
        const groups = parsed.groups || [];
        const largestGroup = groups.reduce((max, g) => g.length > max.length ? g : max, []);
        const agreement = parsed.agreementPercent || Math.round((largestGroup.length / chainResults.length) * 100);

        let level;
        if (largestGroup.length === chainResults.length) level = CONSENSUS_LEVELS.UNANIMOUS;
        else if (largestGroup.length > chainResults.length / 2) level = CONSENSUS_LEVELS.MAJORITY;
        else if (groups.length < chainResults.length) level = CONSENSUS_LEVELS.SPLIT;
        else level = CONSENSUS_LEVELS.DEADLOCK;

        return {
          level,
          agreement,
          groups: groups.map(g => g.map(i => chainResults[i] ? chainResults[i].id : null).filter(Boolean)),
          summary: parsed.summary || '',
        };
      } catch {}
    }

    // Fallback: naive string similarity
    return this._naiveConsensus(chainResults);
  }

  _naiveConsensus(chainResults) {
    // Simple: if all confidence > 70 and conclusions share keywords, call it majority
    const highConf = chainResults.filter(c => c.confidence >= 60);
    if (highConf.length === chainResults.length) {
      return { level: CONSENSUS_LEVELS.MAJORITY, agreement: 60, groups: [chainResults.map(c => c.id)], summary: 'Heuristic: all chains reasonably confident' };
    }
    if (highConf.length > chainResults.length / 2) {
      return { level: CONSENSUS_LEVELS.SPLIT, agreement: 40, groups: [], summary: 'Heuristic: mixed confidence levels' };
    }
    return { level: CONSENSUS_LEVELS.DEADLOCK, agreement: 20, groups: [], summary: 'Heuristic: low overall confidence' };
  }

  /**
   * AI mediates disagreements between chains.
   */
  async resolveConflict(chainResults, consensus) {
    if (!this.ai || typeof this.ai.chat !== 'function') {
      // Pick highest confidence chain
      const best = chainResults.reduce((a, b) => (a.confidence || 0) > (b.confidence || 0) ? a : b, chainResults[0]);
      return { method: 'highest-confidence', conclusion: best.conclusion, confidence: best.confidence, selectedChain: best.id };
    }

    const chainSummaries = chainResults.map((c, i) =>
      `Chain ${i} (${c.framing}, confidence ${c.confidence}%): ${c.conclusion}\nReasoning: ${(c.reasoning || '').slice(0, 300)}`
    ).join('\n\n');

    try {
      const resp = await this.ai.chat([
        { role: 'system', content: 'You are a mediator resolving disagreements between independent reasoning chains. Be fair and precise. Return ONLY valid JSON.' },
        { role: 'user', content: `These reasoning chains disagree. Consensus level: ${consensus.level}.

${chainSummaries}

Analyze the disagreements and either pick the best conclusion or synthesize a better one.

Return JSON:
{
  "method": "pick" or "synthesize",
  "conclusion": "the resolved conclusion",
  "confidence": 0-100,
  "reasoning": "why this resolution",
  "selectedChain": null or chain index if picking
}` }
      ]);
      const text = (resp.response || '').replace(/```json\n?/g, '').replace(/```/g, '').trim();
      return JSON.parse(text);
    } catch (e) {
      const best = chainResults.reduce((a, b) => (a.confidence || 0) > (b.confidence || 0) ? a : b, chainResults[0]);
      return { method: 'fallback-highest-confidence', conclusion: best.conclusion, confidence: best.confidence, error: e.message };
    }
  }

  /**
   * Get full audit trail for a reasoning session.
   */
  getProofTrail(reasoningId) {
    const records = readJSON(CONSENSUS_PATH, []);
    return records.find(r => r.id === reasoningId) || null;
  }

  /**
   * Get consensus accuracy stats.
   */
  getAccuracy() {
    const stats = readJSON(ACCURACY_PATH, { total: 0, correct: 0, byLevel: {} });
    return {
      ...stats,
      overallAccuracy: stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : null,
    };
  }

  /**
   * Record whether a consensus result was correct (for accuracy tracking).
   */
  recordOutcome(reasoningId, wasCorrect) {
    const records = readJSON(CONSENSUS_PATH, []);
    const record = records.find(r => r.id === reasoningId);
    if (!record) return { error: 'Reasoning session not found' };

    record.outcomeCorrect = !!wasCorrect;
    record.outcomeRecordedAt = Date.now();
    writeJSON(CONSENSUS_PATH, records);

    // Update accuracy stats
    const stats = readJSON(ACCURACY_PATH, { total: 0, correct: 0, byLevel: {} });
    stats.total++;
    if (wasCorrect) stats.correct++;
    const level = record.consensus && record.consensus.level || 'UNKNOWN';
    if (!stats.byLevel[level]) stats.byLevel[level] = { total: 0, correct: 0 };
    stats.byLevel[level].total++;
    if (wasCorrect) stats.byLevel[level].correct++;
    writeJSON(ACCURACY_PATH, stats);

    return { recorded: true, overallAccuracy: Math.round((stats.correct / stats.total) * 100) };
  }

  /**
   * Configure adaptive thresholds: importance level -> required chains.
   */
  setThreshold(importance, requiredChains) {
    const thresholds = readJSON(THRESHOLDS_PATH, {});
    thresholds[importance] = Math.max(1, Math.min(7, requiredChains));
    writeJSON(THRESHOLDS_PATH, thresholds);
    return thresholds;
  }

  /**
   * Get configured thresholds.
   */
  getThresholds() {
    return readJSON(THRESHOLDS_PATH, { trivial: 1, low: 2, medium: 3, high: 5, critical: 7 });
  }

  /**
   * Determine how many chains based on problem importance (heuristic).
   */
  _getChainsForImportance(problem) {
    const thresholds = this.getThresholds();
    const p = (problem || '').toLowerCase();
    // Simple heuristic: longer/more complex problems get more chains
    const wordCount = p.split(/\s+/).length;
    const hasUrgent = /critical|urgent|important|dangerous|irreversible|delete|destroy|production/.test(p);
    const hasTrivial = /trivial|simple|quick|easy|minor/.test(p);

    if (hasTrivial) return thresholds.trivial || 1;
    if (hasUrgent) return thresholds.critical || 7;
    if (wordCount > 50) return thresholds.high || 5;
    if (wordCount > 20) return thresholds.medium || 3;
    return thresholds.low || 2;
  }

  /**
   * Get reasoning history.
   */
  getHistory(limit) {
    const records = readJSON(CONSENSUS_PATH, []);
    return records.slice(-(limit || 20)).reverse();
  }

  _store(record) {
    const records = readJSON(CONSENSUS_PATH, []);
    records.push(record);
    if (records.length > 200) records.splice(0, records.length - 200);
    writeJSON(CONSENSUS_PATH, records);
  }
}

module.exports = ProofOfThoughtConsensus;
