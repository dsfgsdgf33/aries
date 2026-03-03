/**
 * ARIES — Proof-of-Thought Consensus
 * Byzantine fault tolerance for reasoning. Multiple independent chains must converge.
 *
 * Full potential:
 * - Multiple independent reasoning chains with different framings must converge
 * - Byzantine fault tolerance (minority dissent gets investigated, not silenced)
 * - Confidence scoring based on degree of convergence
 * - Chain diversity enforcement (chains must use genuinely different approaches)
 * - Deadlock resolution when chains can't agree
 * - Historical accuracy tracking per chain type
 * - Minimum chain count configurable (2-5)
 * - Reasoning chain visualization
 */

'use strict';

const path = require('path');
const crypto = require('crypto');

const SharedMemoryStore = require('./shared-memory-store');
const store = SharedMemoryStore.getInstance();
const NS = 'proof-of-thought-consensus';

const DATA_DIR = path.join(__dirname, '..', 'data', 'reasoning');
const CONSENSUS_PATH = path.join(DATA_DIR, 'consensus.json');
const THRESHOLDS_PATH = path.join(DATA_DIR, 'thresholds.json');
const ACCURACY_PATH = path.join(DATA_DIR, 'accuracy.json');
const DISSENT_PATH = path.join(DATA_DIR, 'dissent-log.json');

function ensureDir() {}
function readJSON(p, fb) { return store.get(NS, path.basename(p, '.json'), fb); }
function writeJSON(p, d) { store.set(NS, path.basename(p, '.json'), d); }
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
    this.config = Object.assign({
      defaultChains: 3,
      minChains: 2,
      maxChains: 7,
      diversityThreshold: 0.6,   // minimum diversity score required
      dissentInvestigation: true, // investigate minority dissent
      maxDissentLog: 500,
      maxConsensusLog: 500,
      deadlockMaxRounds: 3,      // max resolution attempts for deadlock
    }, (opts && opts.config) || {});
  }

  /**
   * Multi-chain reasoning with consensus.
   */
  async reason(problem, context, numChains) {
    const chains = Math.max(this.config.minChains, Math.min(this.config.maxChains, numChains || this._getChainsForImportance(problem)));
    const id = uuid();
    const record = {
      id, problem, context: context || null, numChains: chains,
      startedAt: Date.now(), chainResults: [], consensus: null,
      resolution: null, dissentInvestigation: null, completedAt: null,
    };

    try {
      // Select diverse framings
      const framings = this._selectDiverseFramings(chains);

      // Spawn independent chains in parallel
      const promises = [];
      for (let i = 0; i < chains; i++) {
        promises.push(this._executeChain(problem, context, framings[i], i));
      }
      record.chainResults = await Promise.all(promises);

      // Enforce diversity — reject chains that are too similar
      const diversityScore = this._assessDiversity(record.chainResults);
      record.diversityScore = diversityScore;

      if (diversityScore < this.config.diversityThreshold && chains < this.config.maxChains) {
        // Re-run one chain with forced different framing
        const extraFraming = CHAIN_FRAMINGS.find(f => !framings.includes(f)) || 'adversarial';
        const extra = await this._executeChain(problem, context, extraFraming, chains);
        record.chainResults.push(extra);
        record.diversityEnforced = true;
        record.diversityScore = this._assessDiversity(record.chainResults);
      }

      // Check consensus
      record.consensus = await this.checkConsensus(record.chainResults);

      // Byzantine fault tolerance: investigate minority dissent
      if (record.consensus.level !== CONSENSUS_LEVELS.UNANIMOUS && this.config.dissentInvestigation) {
        record.dissentInvestigation = await this._investigateDissent(record.chainResults, record.consensus);
      }

      // Resolve conflicts if needed
      if (record.consensus.level === CONSENSUS_LEVELS.UNANIMOUS) {
        record.resolution = {
          method: 'unanimous', conclusion: record.chainResults[0].conclusion,
          confidence: 95 + Math.min(4, record.chainResults.length),
        };
      } else if (record.consensus.level === CONSENSUS_LEVELS.DEADLOCK) {
        record.resolution = await this._resolveDeadlock(record.chainResults, record.consensus, problem);
      } else {
        record.resolution = await this.resolveConflict(record.chainResults, record.consensus);
      }

      // Generate visualization
      record.visualization = this._visualize(record);

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
      id: uuid(), index, framing, startedAt: Date.now(),
      reasoning: null, conclusion: null, confidence: 50,
      keyPoints: [], assumptions: [],
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
  "keyPoints": ["point1", "point2"],
  "assumptions": ["assumption1", "assumption2"],
  "risks": ["risk if this conclusion is wrong"]
}`;

      try {
        const resp = await this.ai.chat([
          { role: 'system', content: `You are reasoning chain #${index + 1} using ${framing} framing. You CANNOT see other chains. Be genuinely independent. Return ONLY valid JSON.` },
          { role: 'user', content: prompt }
        ]);
        const text = (resp.response || '').replace(/```json\n?/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(text);
        chain.reasoning = parsed.reasoning || '';
        chain.conclusion = parsed.conclusion || '';
        chain.confidence = Math.max(0, Math.min(100, parsed.confidence || 50));
        chain.keyPoints = parsed.keyPoints || [];
        chain.assumptions = parsed.assumptions || [];
        chain.risks = parsed.risks || [];
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
   * Select diverse framings to ensure genuine independence.
   */
  _selectDiverseFramings(count) {
    const framings = [...CHAIN_FRAMINGS];
    // Shuffle
    for (let i = framings.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [framings[i], framings[j]] = [framings[j], framings[i]];
    }
    // If more chains than framings, repeat with suffix
    const selected = [];
    for (let i = 0; i < count; i++) {
      selected.push(framings[i % framings.length]);
    }
    return selected;
  }

  /**
   * Assess diversity of chain outputs (0-1, higher = more diverse).
   */
  _assessDiversity(chainResults) {
    if (chainResults.length < 2) return 1;
    let totalSimilarity = 0;
    let pairs = 0;
    for (let i = 0; i < chainResults.length; i++) {
      for (let j = i + 1; j < chainResults.length; j++) {
        const a = (chainResults[i].conclusion || '').toLowerCase();
        const b = (chainResults[j].conclusion || '').toLowerCase();
        totalSimilarity += this._wordSimilarity(a, b);
        pairs++;
      }
    }
    const avgSimilarity = pairs > 0 ? totalSimilarity / pairs : 0;
    return Math.round((1 - avgSimilarity) * 100) / 100;
  }

  _wordSimilarity(a, b) {
    const wordsA = new Set(a.split(/\W+/).filter(w => w.length > 3));
    const wordsB = new Set(b.split(/\W+/).filter(w => w.length > 3));
    if (wordsA.size === 0 || wordsB.size === 0) return 0;
    let overlap = 0;
    for (const w of wordsA) if (wordsB.has(w)) overlap++;
    return overlap / Math.max(wordsA.size, wordsB.size);
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

    if (this.ai && typeof this.ai.chat === 'function') {
      try {
        const conclusions = chainResults.map((c, i) => `Chain ${i} (${c.framing}, confidence ${c.confidence}%): "${c.conclusion}"`).join('\n');
        const resp = await this.ai.chat([
          { role: 'system', content: 'You compare reasoning conclusions for agreement. Return ONLY valid JSON.' },
          { role: 'user', content: `Compare these conclusions. Group the ones that essentially agree (same core answer, even if worded differently).

${conclusions}

Return JSON:
{
  "groups": [[0, 1], [2]],
  "agreementPercent": 0-100,
  "summary": "brief description of agreement/disagreement",
  "keyDisagreements": ["what specifically they disagree on"]
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
          level, agreement,
          groups: groups.map(g => g.map(i => chainResults[i] ? chainResults[i].id : null).filter(Boolean)),
          summary: parsed.summary || '',
          keyDisagreements: parsed.keyDisagreements || [],
          majorityGroupSize: largestGroup.length,
          minorityCount: chainResults.length - largestGroup.length,
        };
      } catch {}
    }

    return this._naiveConsensus(chainResults);
  }

  _naiveConsensus(chainResults) {
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
   * Investigate minority dissent — Byzantine fault tolerance.
   * Instead of silencing the minority, we investigate their reasoning.
   */
  async _investigateDissent(chainResults, consensus) {
    if (!consensus.groups || consensus.groups.length < 2) return null;
    const allInMajority = new Set(consensus.groups[0] || []);
    const dissenters = chainResults.filter(c => !allInMajority.has(c.id));

    if (dissenters.length === 0) return null;

    const investigation = {
      id: uuid(),
      dissenters: dissenters.map(d => ({ id: d.id, framing: d.framing, conclusion: d.conclusion, confidence: d.confidence })),
      findings: null,
      timestamp: Date.now(),
    };

    if (this.ai && typeof this.ai.chat === 'function') {
      try {
        const majorityConclusion = chainResults.find(c => allInMajority.has(c.id))?.conclusion || 'unknown';
        const dissentText = dissenters.map(d => `[${d.framing}] (confidence ${d.confidence}%): ${d.conclusion}\nReasoning: ${(d.reasoning || '').slice(0, 300)}`).join('\n\n');

        const resp = await this.ai.chat([
          { role: 'system', content: 'You investigate minority dissent in a reasoning process. The minority may have caught something the majority missed. Be fair and thorough. Return ONLY valid JSON.' },
          { role: 'user', content: `The majority concluded: "${majorityConclusion}"

But these chains disagree:
${dissentText}

Investigate: Is the minority seeing something valid that the majority is missing? Could the dissent reveal a blind spot?

Return JSON:
{
  "dissentValid": true/false,
  "blindSpotFound": "description of blind spot if found, or null",
  "recommendation": "accept majority | investigate further | reconsider",
  "reasoning": "why"
}` }
        ]);
        const text = (resp.response || '').replace(/```json\n?/g, '').replace(/```/g, '').trim();
        investigation.findings = JSON.parse(text);
      } catch {
        investigation.findings = { dissentValid: null, blindSpotFound: null, recommendation: 'investigate further', reasoning: 'AI analysis failed' };
      }
    }

    // Log dissent
    const dissentLog = readJSON(DISSENT_PATH, []);
    dissentLog.push(investigation);
    if (dissentLog.length > this.config.maxDissentLog) dissentLog.splice(0, dissentLog.length - this.config.maxDissentLog);
    writeJSON(DISSENT_PATH, dissentLog);

    return investigation;
  }

  /**
   * Deadlock resolution with multiple rounds of deliberation.
   */
  async _resolveDeadlock(chainResults, consensus, problem) {
    if (!this.ai || typeof this.ai.chat !== 'function') {
      const best = chainResults.reduce((a, b) => (a.confidence || 0) > (b.confidence || 0) ? a : b, chainResults[0]);
      return { method: 'deadlock-highest-confidence', conclusion: best.conclusion, confidence: Math.max(20, best.confidence * 0.6), selectedChain: best.id };
    }

    const chainSummaries = chainResults.map((c, i) =>
      `Chain ${i} (${c.framing}, confidence ${c.confidence}%): ${c.conclusion}`
    ).join('\n');

    try {
      const resp = await this.ai.chat([
        { role: 'system', content: 'You are a meta-reasoner breaking a deadlock between reasoning chains that completely disagree. Rather than picking a winner, try to understand WHY they disagree and whether a synthesis is possible. If not, identify which chain has the strongest evidence. Return ONLY valid JSON.' },
        { role: 'user', content: `DEADLOCK: These chains cannot agree on: "${problem}"

${chainSummaries}

Disagreements: ${(consensus.keyDisagreements || []).join('; ')}

Return JSON:
{
  "method": "synthesis" or "selection",
  "conclusion": "the resolved conclusion",
  "confidence": 0-100,
  "reasoning": "why this resolution",
  "deadlockCause": "root cause of the disagreement",
  "unresolvedRisks": ["risks that remain even after resolution"]
}` }
      ]);
      const text = (resp.response || '').replace(/```json\n?/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(text);
      // Deadlock resolution always gets confidence penalty
      parsed.confidence = Math.min(parsed.confidence || 50, 70);
      parsed.deadlockResolved = true;
      return parsed;
    } catch (e) {
      const best = chainResults.reduce((a, b) => (a.confidence || 0) > (b.confidence || 0) ? a : b, chainResults[0]);
      return { method: 'deadlock-fallback', conclusion: best.conclusion, confidence: 30, error: e.message };
    }
  }

  /**
   * AI mediates disagreements between chains.
   */
  async resolveConflict(chainResults, consensus) {
    if (!this.ai || typeof this.ai.chat !== 'function') {
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

${consensus.keyDisagreements?.length ? 'Key disagreements: ' + consensus.keyDisagreements.join('; ') : ''}

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
   * Reasoning chain visualization — structured overview of the consensus process.
   */
  _visualize(record) {
    const chains = record.chainResults || [];
    const consensus = record.consensus || {};

    const lines = [];
    lines.push(`═══ Proof-of-Thought: ${chains.length} chains ═══`);
    lines.push(`Problem: ${(record.problem || '').slice(0, 100)}`);
    lines.push(`Diversity: ${record.diversityScore || 'N/A'}${record.diversityEnforced ? ' (enforced)' : ''}`);
    lines.push('');

    for (const c of chains) {
      const bar = '█'.repeat(Math.round((c.confidence || 0) / 10));
      const pad = '░'.repeat(10 - Math.round((c.confidence || 0) / 10));
      lines.push(`Chain ${c.index} [${c.framing}] ${bar}${pad} ${c.confidence}%`);
      lines.push(`  → ${(c.conclusion || 'no conclusion').slice(0, 80)}`);
      if (c.assumptions?.length) lines.push(`  Assumptions: ${c.assumptions.slice(0, 2).join(', ')}`);
    }

    lines.push('');
    lines.push(`Consensus: ${consensus.level || 'N/A'} (${consensus.agreement || 0}% agreement)`);

    if (record.dissentInvestigation?.findings) {
      const f = record.dissentInvestigation.findings;
      lines.push(`Dissent: ${f.dissentValid ? '⚠️ VALID — ' : '✓ Investigated — '}${f.recommendation}`);
      if (f.blindSpotFound) lines.push(`  Blind spot: ${f.blindSpotFound}`);
    }

    if (record.resolution) {
      lines.push(`Resolution: ${record.resolution.method} (confidence ${record.resolution.confidence}%)`);
      lines.push(`  → ${(record.resolution.conclusion || '').slice(0, 100)}`);
    }

    return lines.join('\n');
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
    const stats = readJSON(ACCURACY_PATH, { total: 0, correct: 0, byLevel: {}, byFraming: {} });
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

    const stats = readJSON(ACCURACY_PATH, { total: 0, correct: 0, byLevel: {}, byFraming: {} });
    stats.total++;
    if (wasCorrect) stats.correct++;
    const level = record.consensus?.level || 'UNKNOWN';
    if (!stats.byLevel[level]) stats.byLevel[level] = { total: 0, correct: 0 };
    stats.byLevel[level].total++;
    if (wasCorrect) stats.byLevel[level].correct++;

    // Track per-framing accuracy
    if (record.chainResults) {
      for (const chain of record.chainResults) {
        if (!stats.byFraming[chain.framing]) stats.byFraming[chain.framing] = { total: 0, correct: 0 };
        stats.byFraming[chain.framing].total++;
        if (wasCorrect) stats.byFraming[chain.framing].correct++;
      }
    }

    writeJSON(ACCURACY_PATH, stats);
    return { recorded: true, overallAccuracy: Math.round((stats.correct / stats.total) * 100) };
  }

  /**
   * Get dissent investigation log.
   */
  getDissentLog(limit) {
    const log = readJSON(DISSENT_PATH, []);
    return log.slice(-(limit || 20)).reverse();
  }

  /**
   * Configure adaptive thresholds.
   */
  setThreshold(importance, requiredChains) {
    const thresholds = readJSON(THRESHOLDS_PATH, {});
    thresholds[importance] = Math.max(1, Math.min(7, requiredChains));
    writeJSON(THRESHOLDS_PATH, thresholds);
    return thresholds;
  }

  getThresholds() {
    return readJSON(THRESHOLDS_PATH, { trivial: 1, low: 2, medium: 3, high: 5, critical: 7 });
  }

  _getChainsForImportance(problem) {
    const thresholds = this.getThresholds();
    const p = (problem || '').toLowerCase();
    const wordCount = p.split(/\s+/).length;
    const hasUrgent = /critical|urgent|important|dangerous|irreversible|delete|destroy|production/.test(p);
    const hasTrivial = /trivial|simple|quick|easy|minor/.test(p);
    if (hasTrivial) return thresholds.trivial || 1;
    if (hasUrgent) return thresholds.critical || 7;
    if (wordCount > 50) return thresholds.high || 5;
    if (wordCount > 20) return thresholds.medium || 3;
    return thresholds.low || 2;
  }

  getHistory(limit) {
    const records = readJSON(CONSENSUS_PATH, []);
    return records.slice(-(limit || 20)).reverse();
  }

  _store(record) {
    const records = readJSON(CONSENSUS_PATH, []);
    records.push(record);
    if (records.length > this.config.maxConsensusLog) records.splice(0, records.length - this.config.maxConsensusLog);
    writeJSON(CONSENSUS_PATH, records);
  }
}

module.exports = ProofOfThoughtConsensus;
