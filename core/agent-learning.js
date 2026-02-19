/**
 * ARIES v5.0 — Agent Learning System
 * 
 * Agents learn from feedback. After each task, stores task+result+feedback.
 * Uses history to improve future prompts by injecting relevant past successes.
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'agent-learning.json');
const MAX_HISTORY = 1000;

function _ensureDir() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { return { outcomes: [] }; }
}

function _save(data) {
  _ensureDir();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

class AgentLearning {
  constructor() {
    this.data = _load();
    this.maxHistory = MAX_HISTORY;
    try {
      const cfg = require('../config.json');
      this.maxHistory = cfg.learning?.maxHistory || MAX_HISTORY;
    } catch {}
  }

  /**
   * Record an outcome for learning
   * @param {string} agentId - Agent identifier
   * @param {string} task - Task description
   * @param {string} result - Task result/output
   * @param {number} rating - Rating: 1 (bad) to 5 (excellent)
   * @param {object} [meta] - Additional metadata
   */
  recordOutcome(agentId, task, result, rating, meta = {}) {
    if (!agentId || !task) return;

    const outcome = {
      agentId,
      task: task.substring(0, 500),
      result: (result || '').substring(0, 1000),
      rating: Math.max(1, Math.min(5, rating || 3)),
      timestamp: new Date().toISOString(),
      keywords: this._extractKeywords(task),
      ...meta,
    };

    this.data.outcomes.push(outcome);

    // Prune if over max
    if (this.data.outcomes.length > this.maxHistory) {
      // Remove lowest-rated old entries first
      this.data.outcomes.sort((a, b) => {
        if (a.rating !== b.rating) return a.rating - b.rating;
        return new Date(a.timestamp) - new Date(b.timestamp);
      });
      this.data.outcomes = this.data.outcomes.slice(-this.maxHistory);
    }

    _save(this.data);
    return outcome;
  }

  /**
   * Get relevant past experiences for a task
   * @param {string} agentId - Agent identifier
   * @param {string} task - Current task description
   * @param {number} [limit=5] - Max results
   * @returns {object[]} Relevant past outcomes sorted by relevance
   */
  getRelevantExperience(agentId, task, limit = 5) {
    if (!task) return [];

    const keywords = this._extractKeywords(task);
    const agentOutcomes = this.data.outcomes.filter(o =>
      o.agentId === agentId && o.rating >= 3
    );

    // Score by keyword overlap
    const scored = agentOutcomes.map(o => {
      const okw = o.keywords || [];
      let score = 0;
      for (const kw of keywords) {
        if (okw.includes(kw)) score += 3;
        if (o.task.toLowerCase().includes(kw)) score += 1;
      }
      // Recency bonus
      const age = Date.now() - new Date(o.timestamp).getTime();
      const dayAge = age / 86400000;
      score += Math.max(0, 5 - dayAge * 0.1);
      // Rating bonus
      score += o.rating * 2;
      return { ...o, _score: score };
    });

    return scored
      .filter(o => o._score > 0)
      .sort((a, b) => b._score - a._score)
      .slice(0, limit)
      .map(o => { const { _score, ...rest } = o; return rest; });
  }

  /**
   * Build a learning context string to inject into prompts
   * @param {string} agentId
   * @param {string} task
   * @returns {string}
   */
  buildLearningContext(agentId, task) {
    const experiences = this.getRelevantExperience(agentId, task, 3);
    if (experiences.length === 0) return '';

    return '\n\nRelevant past successes:\n' + experiences.map(e =>
      `- Task: "${e.task.substring(0, 100)}" → Rating: ${e.rating}/5`
    ).join('\n');
  }

  /**
   * Get learning stats per agent
   * @returns {object}
   */
  getStats() {
    const stats = {};
    for (const o of this.data.outcomes) {
      if (!stats[o.agentId]) {
        stats[o.agentId] = { total: 0, avgRating: 0, totalRating: 0, good: 0, bad: 0 };
      }
      const s = stats[o.agentId];
      s.total++;
      s.totalRating += o.rating;
      s.avgRating = Math.round((s.totalRating / s.total) * 10) / 10;
      if (o.rating >= 4) s.good++;
      if (o.rating <= 2) s.bad++;
    }
    return {
      totalOutcomes: this.data.outcomes.length,
      agents: stats,
    };
  }

  /**
   * Get stats for a specific agent
   * @param {string} agentId
   * @returns {object}
   */
  getAgentStats(agentId) {
    const outcomes = this.data.outcomes.filter(o => o.agentId === agentId);
    if (outcomes.length === 0) return { total: 0, avgRating: 0, successRate: 0 };

    const totalRating = outcomes.reduce((s, o) => s + o.rating, 0);
    const good = outcomes.filter(o => o.rating >= 4).length;
    return {
      total: outcomes.length,
      avgRating: Math.round((totalRating / outcomes.length) * 10) / 10,
      successRate: Math.round((good / outcomes.length) * 100),
      recentOutcomes: outcomes.slice(-5),
    };
  }

  /**
   * Extract keywords from text
   * @private
   */
  _extractKeywords(text) {
    const stop = new Set(['the','a','an','is','are','was','were','be','been','being','have','has','had',
      'do','does','did','will','would','could','should','may','might','shall','can',
      'to','of','in','for','on','with','at','by','from','as','into','through','during',
      'and','but','or','nor','not','so','yet','both','either','neither','this','that','it','i','you','we','they']);

    return text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stop.has(w))
      .slice(0, 20);
  }

  /** Reload data from disk */
  reload() { this.data = _load(); }
}

module.exports = { AgentLearning };
