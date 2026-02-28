/**
 * ARIES — Intention Broadcast
 * Before complex actions, broadcast intent to all modules for distributed decision-making.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'intentions');
const HISTORY_PATH = path.join(DATA_DIR, 'history.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

class IntentionBroadcast {
  constructor() {
    ensureDir();
    this._listeners = [];
    this._pending = new Map();
  }

  onIntention(callback) {
    this._listeners.push(callback);
  }

  async broadcast(intention) {
    const intent = {
      id: intention.id || uuid(),
      action: intention.action || 'unknown',
      description: intention.description || '',
      category: intention.category || 'general',
      context: intention.context || {},
      timestamp: Date.now(),
      votes: [],
      consensus: null,
      outcome: null,
    };

    // Broadcast to all listeners with 2s timeout
    const votePromises = this._listeners.map((cb, i) => {
      return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), 2000);
        try {
          const result = cb(intent);
          if (result && typeof result.then === 'function') {
            result.then(v => { clearTimeout(timer); resolve(v); }).catch(() => { clearTimeout(timer); resolve(null); });
          } else {
            clearTimeout(timer);
            resolve(result);
          }
        } catch { clearTimeout(timer); resolve(null); }
      });
    });

    const responses = await Promise.all(votePromises);
    intent.votes = responses.filter(Boolean).map(r => ({
      module: r.module || 'unknown',
      vote: ['proceed', 'caution', 'abort'].includes(r.vote) ? r.vote : 'proceed',
      confidence: Math.max(0, Math.min(100, r.confidence || 50)),
      reason: r.reason || '',
      critical: !!r.critical,
    }));

    intent.consensus = this._computeConsensus(intent.votes);

    // Store
    const history = readJSON(HISTORY_PATH, []);
    history.push(intent);
    if (history.length > 1000) history.splice(0, history.length - 1000);
    writeJSON(HISTORY_PATH, history);

    this._pending.set(intent.id, intent);
    return intent;
  }

  _computeConsensus(votes) {
    if (votes.length === 0) return { decision: 'proceed', reason: 'No voters responded — proceeding by default' };

    // Abort if any critical module says abort
    const criticalAbort = votes.find(v => v.critical && v.vote === 'abort');
    if (criticalAbort) return { decision: 'abort', reason: 'Critical module "' + criticalAbort.module + '" says abort: ' + criticalAbort.reason };

    const counts = { proceed: 0, caution: 0, abort: 0 };
    votes.forEach(v => counts[v.vote]++);

    if (counts.abort > votes.length / 2) return { decision: 'abort', reason: 'Majority voted abort (' + counts.abort + '/' + votes.length + ')' };
    if (counts.proceed >= votes.length / 2) return { decision: 'proceed', reason: 'Majority voted proceed (' + counts.proceed + '/' + votes.length + ')' };
    return { decision: 'caution', reason: 'Mixed votes — proceed with caution (' + counts.proceed + ' proceed, ' + counts.caution + ' caution, ' + counts.abort + ' abort)' };
  }

  getConsensus(intentionId) {
    const history = readJSON(HISTORY_PATH, []);
    const intent = history.find(i => i.id === intentionId);
    if (!intent) return { error: 'Intention not found' };
    return { id: intent.id, consensus: intent.consensus, votes: intent.votes, outcome: intent.outcome };
  }

  getIntentionHistory(limit) {
    const history = readJSON(HISTORY_PATH, []);
    return history.slice(-(limit || 50)).reverse();
  }

  wasCorrect(intentionId, outcome) {
    const history = readJSON(HISTORY_PATH, []);
    const intent = history.find(i => i.id === intentionId);
    if (!intent) return { error: 'Intention not found' };
    intent.outcome = outcome; // 'good', 'bad', 'neutral'
    intent.outcomeAt = Date.now();
    writeJSON(HISTORY_PATH, history);
    return intent;
  }

  getModuleAccuracy() {
    const history = readJSON(HISTORY_PATH, []);
    const resolved = history.filter(i => i.outcome);
    const modules = {};

    for (const intent of resolved) {
      const correctDecision = intent.outcome === 'good' ? 'proceed' : intent.outcome === 'bad' ? 'abort' : null;
      if (!correctDecision) continue;

      for (const vote of intent.votes) {
        if (!modules[vote.module]) modules[vote.module] = { total: 0, correct: 0 };
        modules[vote.module].total++;
        if (vote.vote === correctDecision || (vote.vote === 'caution' && intent.outcome !== 'bad')) {
          modules[vote.module].correct++;
        }
      }
    }

    return Object.entries(modules).map(([mod, data]) => ({
      module: mod,
      total: data.total,
      correct: data.correct,
      accuracy: data.total > 0 ? Math.round((data.correct / data.total) * 100) : 0,
    })).sort((a, b) => b.accuracy - a.accuracy);
  }
}

module.exports = IntentionBroadcast;
