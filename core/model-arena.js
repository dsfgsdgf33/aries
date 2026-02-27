'use strict';

/**
 * @fileoverview ModelArena - Multi-model comparison arena for Aries AI platform.
 * Send the same prompt to multiple models simultaneously, compare and score results.
 * @module model-arena
 */

const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data', 'arena');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const LEADERBOARD_FILE = path.join(DATA_DIR, 'leaderboard.json');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJSON(filepath, fallback) {
  try {
    if (fs.existsSync(filepath)) return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch (_) { /* ignore */ }
  return fallback;
}

function writeJSON(filepath, data) {
  ensureDir(path.dirname(filepath));
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Score a response on multiple dimensions.
 * @param {object} result - { text, durationMs, model }
 * @returns {object} scores
 */
function autoScore(result) {
  const text = result.text || '';
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const words = text.split(/\s+/).filter(Boolean);
  const sentenceCount = sentences.length;
  const avgSentenceLen = sentenceCount > 0 ? words.length / sentenceCount : 0;

  // Length score: more content is generally better, diminishing returns
  const lengthScore = Math.min(10, Math.log2(Math.max(1, words.length)) * 1.5);

  // Coherence: good avg sentence length (10-25 words) scores highest
  let coherenceScore = 0;
  if (avgSentenceLen >= 10 && avgSentenceLen <= 25) coherenceScore = 10;
  else if (avgSentenceLen > 0) coherenceScore = Math.max(0, 10 - Math.abs(avgSentenceLen - 17.5) * 0.5);

  // Speed score: faster is better (inverse of duration, normalized)
  const speedScore = Math.max(0, 10 - (result.durationMs / 2000));

  // Composite
  const total = (lengthScore * 0.25) + (coherenceScore * 0.35) + (speedScore * 0.4);

  return {
    length: Math.round(lengthScore * 100) / 100,
    coherence: Math.round(coherenceScore * 100) / 100,
    speed: Math.round(speedScore * 100) / 100,
    total: Math.round(total * 100) / 100,
    meta: { wordCount: words.length, sentenceCount, avgSentenceLen: Math.round(avgSentenceLen * 10) / 10 }
  };
}

class ModelArena extends EventEmitter {
  constructor() {
    super();
    ensureDir(DATA_DIR);
    this._history = readJSON(HISTORY_FILE, []);
    this._leaderboard = readJSON(LEADERBOARD_FILE, {});
  }

  /**
   * Run an arena comparison.
   * @param {string} prompt - The prompt to send to all models.
   * @param {string[]} models - Array of model identifiers.
   * @param {object} [options={}]
   * @param {function} options.aiFunction - async (model, messages) => { text, usage? }
   * @param {string} [options.category='general'] - Category for leaderboard tracking.
   * @param {object} [options.params] - Extra params forwarded to aiFunction.
   * @returns {Promise<object>} Arena result with all responses, scores, and winner.
   */
  async arena(prompt, models, options = {}) {
    if (!options.aiFunction || typeof options.aiFunction !== 'function') {
      throw new Error('options.aiFunction is required — async (model, messages) => { text }');
    }
    if (!Array.isArray(models) || models.length < 2) {
      throw new Error('At least 2 models are required for an arena comparison');
    }

    const arenaId = crypto.randomUUID();
    const category = options.category || 'general';
    const messages = [{ role: 'user', content: prompt }];

    this.emit('arena-start', { arenaId, prompt, models, category });

    const tasks = models.map(async (model) => {
      const start = Date.now();
      try {
        const response = await options.aiFunction(model, messages, options.params);
        const durationMs = Date.now() - start;
        const result = {
          model,
          text: response.text || response.content || '',
          durationMs,
          usage: response.usage || null,
          error: null
        };
        result.scores = autoScore(result);
        this.emit('model-response', { arenaId, ...result });
        return result;
      } catch (err) {
        const durationMs = Date.now() - start;
        const result = { model, text: '', durationMs, usage: null, error: err.message, scores: { length: 0, coherence: 0, speed: 0, total: 0, meta: {} } };
        this.emit('model-response', { arenaId, ...result });
        return result;
      }
    });

    const results = await Promise.all(tasks);

    // Determine winner by highest total score (excluding errors)
    const valid = results.filter(r => !r.error);
    const winner = valid.length > 0
      ? valid.reduce((a, b) => a.scores.total >= b.scores.total ? a : b).model
      : null;

    const record = {
      arenaId,
      prompt,
      category,
      models,
      results,
      winner,
      humanVote: null,
      timestamp: new Date().toISOString()
    };

    // Persist
    this._history.push(record);
    writeJSON(HISTORY_FILE, this._history);

    // Update leaderboard with auto-score winner
    if (winner) this._updateLeaderboard(winner, category, models);

    this.emit('arena-complete', record);
    return record;
  }

  /**
   * Record a human vote for an arena result, overriding auto-score.
   * @param {string} arenaId
   * @param {string} modelId - The model the human preferred.
   * @returns {object|null} Updated record or null if not found.
   */
  recordVote(arenaId, modelId) {
    const record = this._history.find(r => r.arenaId === arenaId);
    if (!record) return null;
    if (!record.models.includes(modelId)) throw new Error(`Model ${modelId} was not in arena ${arenaId}`);

    // Undo previous winner's leaderboard entry, apply vote winner
    if (record.humanVote) {
      this._undoLeaderboard(record.humanVote, record.category);
    } else if (record.winner) {
      this._undoLeaderboard(record.winner, record.category);
    }

    record.humanVote = modelId;
    this._updateLeaderboard(modelId, record.category, record.models);
    writeJSON(HISTORY_FILE, this._history);
    return record;
  }

  /**
   * Get the leaderboard, optionally filtered by category.
   * @param {string} [category]
   * @returns {object} Leaderboard data.
   */
  getLeaderboard(category) {
    if (category) {
      const cat = this._leaderboard[category] || {};
      return this._sortLeaderboard(cat);
    }
    const combined = {};
    for (const cat of Object.values(this._leaderboard)) {
      for (const [model, stats] of Object.entries(cat)) {
        if (!combined[model]) combined[model] = { wins: 0, appearances: 0 };
        combined[model].wins += stats.wins;
        combined[model].appearances += stats.appearances;
      }
    }
    return this._sortLeaderboard(combined);
  }

  _sortLeaderboard(data) {
    return Object.entries(data)
      .map(([model, stats]) => ({
        model,
        wins: stats.wins,
        appearances: stats.appearances,
        winRate: stats.appearances > 0 ? Math.round((stats.wins / stats.appearances) * 10000) / 100 : 0
      }))
      .sort((a, b) => b.winRate - a.winRate || b.wins - a.wins);
  }

  /**
   * Get arena history.
   * @param {number} [limit=50]
   * @returns {object[]}
   */
  getHistory(limit = 50) {
    return this._history.slice(-limit);
  }

  /**
   * Get the best model for a category based on win rate.
   * @param {string} [category='general']
   * @returns {string|null}
   */
  getBestModel(category = 'general') {
    const lb = this.getLeaderboard(category);
    return lb.length > 0 ? lb[0].model : null;
  }

  _updateLeaderboard(winner, category, allModels) {
    if (!this._leaderboard[category]) this._leaderboard[category] = {};
    const cat = this._leaderboard[category];
    for (const m of allModels) {
      if (!cat[m]) cat[m] = { wins: 0, appearances: 0 };
      cat[m].appearances++;
    }
    cat[winner].wins++;
    writeJSON(LEADERBOARD_FILE, this._leaderboard);
  }

  _undoLeaderboard(winner, category) {
    const cat = this._leaderboard[category];
    if (!cat || !cat[winner]) return;
    cat[winner].wins = Math.max(0, cat[winner].wins - 1);
    // Don't undo appearances since the arena still happened
  }
}

let _instance = null;

/**
 * Get or create singleton instance.
 * @returns {ModelArena}
 */
function getInstance() {
  if (!_instance) _instance = new ModelArena();
  return _instance;
}

module.exports = { ModelArena, getInstance };
