/**
 * ARIES — Muscle Memory
 * Automatic reflexes for frequently performed actions. No thinking required.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'muscle-memory');
const REFLEXES_PATH = path.join(DATA_DIR, 'reflexes.json');
const PATTERNS_PATH = path.join(DATA_DIR, 'patterns.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

const AUTO_THRESHOLD = 5;     // executions before auto
const SUGGEST_THRESHOLD = 3;  // executions before suggest
const FULL_PROCESSING_TIME = 2000; // estimated ms for full cognitive processing

class MuscleMemory {
  constructor() {
    ensureDir();
    this._reflexes = readJSON(REFLEXES_PATH, []);
    this._patterns = readJSON(PATTERNS_PATH, []);
  }

  _save() {
    writeJSON(REFLEXES_PATH, this._reflexes);
  }

  _savePatterns() {
    writeJSON(PATTERNS_PATH, this._patterns);
  }

  _findReflex(trigger) {
    const t = typeof trigger === 'string' ? trigger : JSON.stringify(trigger);
    return this._reflexes.find(r => r.trigger === t);
  }

  learn(trigger, action) {
    const t = typeof trigger === 'string' ? trigger : JSON.stringify(trigger);
    const a = typeof action === 'string' ? action : JSON.stringify(action);

    const existing = this._findReflex(t);
    if (existing) {
      existing.action = a;
      existing.lastUsed = Date.now();
      this._save();
      return { updated: true, reflex: existing };
    }

    const reflex = {
      id: uuid(),
      trigger: t,
      action: a,
      confidence: 20,
      executionCount: 0,
      avgExecutionTime: 0,
      lastUsed: Date.now(),
      errorRate: 0,
      errorCount: 0,
      successCount: 0,
      createdAt: Date.now(),
      automatic: false
    };

    this._reflexes.push(reflex);
    this._save();
    return { learned: true, reflex };
  }

  execute(trigger) {
    const t = typeof trigger === 'string' ? trigger : JSON.stringify(trigger);
    const reflex = this._findReflex(t);
    if (!reflex) return null;

    const startTime = Date.now();
    reflex.executionCount++;
    reflex.lastUsed = Date.now();

    // Update avg execution time
    const execTime = Math.random() * 100 + 10; // simulated execution time
    reflex.avgExecutionTime = reflex.avgExecutionTime
      ? Math.round((reflex.avgExecutionTime * (reflex.executionCount - 1) + execTime) / reflex.executionCount)
      : Math.round(execTime);

    reflex.successCount++;
    reflex.errorRate = reflex.executionCount > 0
      ? Math.round(reflex.errorCount / reflex.executionCount * 100)
      : 0;

    // Update confidence
    reflex.confidence = Math.min(100, Math.round(
      (reflex.successCount / reflex.executionCount) * 100 *
      Math.min(1, reflex.executionCount / AUTO_THRESHOLD)
    ));

    // Auto-promote if threshold met
    if (reflex.executionCount >= AUTO_THRESHOLD && reflex.errorCount === 0) {
      reflex.automatic = true;
    }

    this._save();

    if (reflex.automatic) {
      return { executed: true, automatic: true, reflex, action: reflex.action };
    } else if (reflex.executionCount >= SUGGEST_THRESHOLD) {
      return { suggest: true, automatic: false, reflex, action: reflex.action, message: 'Reflex recognized — suggest executing: ' + reflex.action };
    } else {
      return { learning: true, automatic: false, reflex, executionsUntilSuggest: SUGGEST_THRESHOLD - reflex.executionCount };
    }
  }

  recordError(trigger) {
    const t = typeof trigger === 'string' ? trigger : JSON.stringify(trigger);
    const reflex = this._findReflex(t);
    if (!reflex) return null;

    reflex.errorCount++;
    reflex.errorRate = Math.round(reflex.errorCount / reflex.executionCount * 100);
    reflex.confidence = Math.max(0, reflex.confidence - 20);

    // Demote if automatic
    if (reflex.automatic) {
      reflex.automatic = false;
    }

    this._save();
    return { demoted: true, reflex };
  }

  getReflexes() {
    return this._reflexes;
  }

  getAutomatic() {
    return this._reflexes.filter(r => r.automatic);
  }

  getLearning() {
    return this._reflexes.filter(r => !r.automatic);
  }

  demote(reflexId) {
    const reflex = this._reflexes.find(r => r.id === reflexId);
    if (!reflex) return { error: 'Reflex not found' };
    reflex.automatic = false;
    reflex.confidence = Math.max(0, reflex.confidence - 30);
    this._save();
    return { demoted: true, reflex };
  }

  promote(reflexId) {
    const reflex = this._reflexes.find(r => r.id === reflexId);
    if (!reflex) return { error: 'Reflex not found' };
    reflex.automatic = true;
    reflex.confidence = Math.min(100, reflex.confidence + 20);
    this._save();
    return { promoted: true, reflex };
  }

  getReflexStats() {
    const total = this._reflexes.length;
    const automatic = this._reflexes.filter(r => r.automatic).length;
    const totalExecutions = this._reflexes.reduce((s, r) => s + r.executionCount, 0);
    const totalErrors = this._reflexes.reduce((s, r) => s + r.errorCount, 0);
    const timeSaved = this.getTimeSaved();

    return {
      totalReflexes: total,
      automaticCount: automatic,
      learningCount: total - automatic,
      totalExecutions,
      errorRate: totalExecutions > 0 ? Math.round(totalErrors / totalExecutions * 100) : 0,
      timeSavedMs: timeSaved.totalMs,
      timeSavedFormatted: timeSaved.formatted
    };
  }

  getTimeSaved() {
    let totalMs = 0;
    for (const r of this._reflexes) {
      if (r.automatic && r.executionCount > 0) {
        const savedPerExec = FULL_PROCESSING_TIME - (r.avgExecutionTime || 0);
        totalMs += savedPerExec * r.executionCount;
      }
    }
    totalMs = Math.max(0, totalMs);

    const seconds = Math.round(totalMs / 1000);
    const minutes = Math.round(seconds / 60);
    const formatted = minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;

    return { totalMs, seconds, minutes, formatted };
  }

  detectPattern(recentActions) {
    if (!Array.isArray(recentActions) || recentActions.length < 3) {
      return { patterns: [], message: 'Need at least 3 actions to detect patterns' };
    }

    const sequences = {};
    // Look for repeating pairs
    for (let i = 0; i < recentActions.length - 1; i++) {
      const pair = JSON.stringify([recentActions[i], recentActions[i + 1]]);
      sequences[pair] = (sequences[pair] || 0) + 1;
    }
    // Look for repeating triples
    for (let i = 0; i < recentActions.length - 2; i++) {
      const triple = JSON.stringify([recentActions[i], recentActions[i + 1], recentActions[i + 2]]);
      sequences[triple] = (sequences[triple] || 0) + 1;
    }

    const detected = [];
    for (const [seq, count] of Object.entries(sequences)) {
      if (count >= 2) {
        const actions = JSON.parse(seq);
        const trigger = actions[0];
        const action = actions.slice(1).join(' → ');
        const existing = this._findReflex(trigger);

        detected.push({
          sequence: actions,
          occurrences: count,
          trigger,
          action,
          alreadyLearned: !!existing,
          suggestLearn: count >= SUGGEST_THRESHOLD && !existing
        });
      }
    }

    // Store patterns
    this._patterns = detected.slice(0, 50);
    this._savePatterns();

    return {
      patterns: detected.sort((a, b) => b.occurrences - a.occurrences),
      total: detected.length,
      suggestLearn: detected.filter(p => p.suggestLearn).length
    };
  }
}

module.exports = MuscleMemory;
