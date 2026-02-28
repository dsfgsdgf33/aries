/**
 * ARIES — Causal Reasoning
 * Track genuine causation, not just correlation.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'causal');
const CHAINS_PATH = path.join(DATA_DIR, 'chains.json');
const PATTERNS_PATH = path.join(DATA_DIR, 'patterns.json');

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }

const CATEGORIES = {
  code_change: 'bug',
  config_change: 'behavior',
  user_action: 'response',
  system_event: 'cascade',
};

class CausalReasoning {
  constructor(refs) {
    this.refs = refs || {};
    ensureDir();
  }

  _getChains() { return readJSON(CHAINS_PATH, []); }
  _saveChains(c) { writeJSON(CHAINS_PATH, c); }
  _getPatterns() { return readJSON(PATTERNS_PATH, []); }
  _savePatterns(p) { writeJSON(PATTERNS_PATH, p); }

  recordEvent(event, cause, evidence) {
    const chains = this._getChains();
    const eventId = uuid();
    const entry = {
      event: event,
      id: eventId,
      timestamp: Date.now(),
      causedBy: cause || null,
      evidence: evidence || null,
      category: this._categorize(event),
    };

    // Find or create chain
    let chain = null;
    if (cause) {
      // Find chain containing the cause event
      chain = chains.find(c => c.events.some(e => e.id === cause || e.event === cause));
    }

    if (chain) {
      chain.events.push(entry);
      chain.impact = this._assessImpact(chain);
      chain.confidence = this._assessConfidence(chain);
    } else {
      chain = {
        id: uuid(),
        events: [entry],
        rootCause: event,
        impact: 'unknown',
        confidence: cause ? 60 : 30,
        createdAt: Date.now(),
      };
      chains.push(chain);
    }

    // Update patterns
    this._updatePatterns(entry);

    if (chains.length > 500) chains.splice(0, chains.length - 500);
    this._saveChains(chains);

    return { eventId, chainId: chain.id, entry };
  }

  traceRoot(eventId) {
    const chains = this._getChains();
    for (const chain of chains) {
      const eventIdx = chain.events.findIndex(e => e.id === eventId);
      if (eventIdx === -1) continue;

      const trace = [];
      let current = chain.events[eventIdx];
      trace.push(current);

      // Walk backwards through causedBy links
      while (current.causedBy) {
        const parent = chain.events.find(e => e.id === current.causedBy || e.event === current.causedBy);
        if (!parent || trace.includes(parent)) break;
        trace.unshift(parent);
        current = parent;
      }

      return {
        rootCause: trace[0].event,
        chain: trace,
        depth: trace.length,
        confidence: chain.confidence,
      };
    }
    return { error: 'Event not found', eventId };
  }

  predict(event) {
    const patterns = this._getPatterns();
    const category = this._categorize(event);
    const predictions = [];

    for (const pattern of patterns) {
      if (pattern.cause === event || pattern.causeCategory === category) {
        predictions.push({
          likelyEffect: pattern.effect,
          confidence: Math.min(95, pattern.occurrences * 15),
          basedOn: pattern.occurrences + ' past occurrences',
          pattern: pattern.description,
        });
      }
    }

    // Sort by confidence
    predictions.sort((a, b) => b.confidence - a.confidence);
    return { event, predictions: predictions.slice(0, 10), totalPatterns: patterns.length };
  }

  getCausalMap() {
    const chains = this._getChains();
    const nodes = new Map();
    const edges = [];

    for (const chain of chains) {
      for (const event of chain.events) {
        if (!nodes.has(event.event)) {
          nodes.set(event.event, { id: event.id, event: event.event, category: event.category, count: 0 });
        }
        nodes.get(event.event).count++;

        if (event.causedBy) {
          const parent = chain.events.find(e => e.id === event.causedBy || e.event === event.causedBy);
          if (parent) {
            edges.push({ from: parent.event, to: event.event, chainId: chain.id });
          }
        }
      }
    }

    return {
      nodes: Array.from(nodes.values()),
      edges,
      chainCount: chains.length,
    };
  }

  findRootCause(symptom) {
    const chains = this._getChains();
    const matches = [];

    for (const chain of chains) {
      const symEvent = chain.events.find(e =>
        e.event.toLowerCase().includes(symptom.toLowerCase()) ||
        symptom.toLowerCase().includes(e.event.toLowerCase())
      );
      if (symEvent) {
        const trace = [];
        let current = symEvent;
        while (current.causedBy) {
          const parent = chain.events.find(e => e.id === current.causedBy || e.event === current.causedBy);
          if (!parent || trace.includes(parent)) break;
          trace.unshift(parent);
          current = parent;
        }
        matches.push({
          chainId: chain.id,
          rootCause: trace.length > 0 ? trace[0].event : symEvent.event,
          depth: trace.length + 1,
          confidence: chain.confidence,
          trace: [...trace, symEvent].map(e => e.event),
        });
      }
    }

    // Also check patterns
    const patterns = this._getPatterns();
    const patternMatches = patterns.filter(p =>
      p.effect.toLowerCase().includes(symptom.toLowerCase())
    ).map(p => ({
      likelyCause: p.cause,
      confidence: Math.min(90, p.occurrences * 12),
      occurrences: p.occurrences,
      source: 'pattern',
    }));

    return {
      symptom,
      directTraces: matches,
      patternSuggestions: patternMatches,
      bestGuess: matches[0] ? matches[0].rootCause : (patternMatches[0] ? patternMatches[0].likelyCause : 'unknown'),
    };
  }

  getChain(eventId) {
    const chains = this._getChains();
    for (const chain of chains) {
      if (chain.id === eventId || chain.events.some(e => e.id === eventId)) {
        return chain;
      }
    }
    return null;
  }

  getCausalPatterns() {
    return this._getPatterns().sort((a, b) => b.occurrences - a.occurrences);
  }

  getHistory(limit) {
    const chains = this._getChains();
    return chains.slice(-(limit || 20)).reverse();
  }

  // ── Internal ──

  _categorize(event) {
    const e = (event || '').toLowerCase();
    if (e.includes('code') || e.includes('commit') || e.includes('edit')) return 'code_change';
    if (e.includes('config') || e.includes('setting') || e.includes('parameter')) return 'config_change';
    if (e.includes('user') || e.includes('click') || e.includes('request')) return 'user_action';
    return 'system_event';
  }

  _assessImpact(chain) {
    const len = chain.events.length;
    if (len > 5) return 'high';
    if (len > 2) return 'medium';
    return 'low';
  }

  _assessConfidence(chain) {
    let conf = 40;
    for (const e of chain.events) {
      if (e.evidence) conf += 10;
      if (e.causedBy) conf += 5;
    }
    return Math.min(95, conf);
  }

  _updatePatterns(entry) {
    if (!entry.causedBy) return;
    const patterns = this._getPatterns();
    const existing = patterns.find(p => p.cause === entry.causedBy && p.effect === entry.event);
    if (existing) {
      existing.occurrences++;
      existing.lastSeen = Date.now();
    } else {
      patterns.push({
        id: uuid(),
        cause: entry.causedBy,
        effect: entry.event,
        causeCategory: this._categorize(entry.causedBy),
        effectCategory: entry.category,
        occurrences: 1,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        description: entry.causedBy + ' → ' + entry.event,
      });
    }
    if (patterns.length > 300) patterns.splice(0, patterns.length - 300);
    this._savePatterns(patterns);
  }
}

module.exports = CausalReasoning;
