/**
 * ARIES — Commitment Tracker
 * Track promises and follow-through. Accountability system.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'commitments');
const ACTIVE_PATH = path.join(DATA_DIR, 'active.json');
const HISTORY_PATH = path.join(DATA_DIR, 'history.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

class CommitmentTracker {
  constructor() { ensureDir(); }

  commit(description, deadline, priority, context) {
    const active = readJSON(ACTIVE_PATH, []);
    const entry = {
      id: uuid(),
      description: (description || '').slice(0, 500),
      madeAt: Date.now(),
      deadline: deadline ? new Date(deadline).getTime() : null,
      status: 'pending',
      completedAt: null,
      context: (context || '').slice(0, 300),
      priority: Math.max(1, Math.min(10, priority || 5)),
      reminderSent: false
    };
    active.push(entry);
    writeJSON(ACTIVE_PATH, active);
    return entry;
  }

  complete(id, notes) {
    const active = readJSON(ACTIVE_PATH, []);
    const idx = active.findIndex(c => c.id === id);
    if (idx === -1) return { error: 'Commitment not found' };
    const entry = active.splice(idx, 1)[0];
    entry.status = 'completed';
    entry.completedAt = Date.now();
    entry.notes = notes || '';
    writeJSON(ACTIVE_PATH, active);
    const history = readJSON(HISTORY_PATH, []);
    history.push(entry);
    if (history.length > 5000) history.splice(0, history.length - 5000);
    writeJSON(HISTORY_PATH, history);
    return entry;
  }

  abandon(id, reason) {
    const active = readJSON(ACTIVE_PATH, []);
    const idx = active.findIndex(c => c.id === id);
    if (idx === -1) return { error: 'Commitment not found' };
    const entry = active.splice(idx, 1)[0];
    entry.status = 'abandoned';
    entry.completedAt = Date.now();
    entry.abandonReason = reason || '';
    writeJSON(ACTIVE_PATH, active);
    const history = readJSON(HISTORY_PATH, []);
    history.push(entry);
    writeJSON(HISTORY_PATH, history);
    return entry;
  }

  getActive() {
    const active = readJSON(ACTIVE_PATH, []);
    this.checkOverdue();
    return active.sort((a, b) => b.priority - a.priority);
  }

  getOverdue() {
    this.checkOverdue();
    const active = readJSON(ACTIVE_PATH, []);
    return active.filter(c => c.status === 'overdue').sort((a, b) => a.deadline - b.deadline);
  }

  getCompletionRate() {
    const history = readJSON(HISTORY_PATH, []);
    if (history.length === 0) return { rate: null, reason: 'No history' };
    const completed = history.filter(c => c.status === 'completed').length;
    return { rate: Math.round((completed / history.length) * 100), completed, total: history.length };
  }

  getReliabilityScore() {
    const history = readJSON(HISTORY_PATH, []);
    const active = readJSON(ACTIVE_PATH, []);
    const overdue = active.filter(c => c.status === 'overdue').length;
    const completed = history.filter(c => c.status === 'completed').length;
    const abandoned = history.filter(c => c.status === 'abandoned').length;
    const denom = completed + abandoned + overdue;
    if (denom === 0) return { score: 100, reason: 'No data yet' };
    return {
      score: Math.round((completed / denom) * 100),
      completed, abandoned, overdue
    };
  }

  getAccountabilityReport() {
    const active = readJSON(ACTIVE_PATH, []);
    const history = readJSON(HISTORY_PATH, []);
    this.checkOverdue();
    const overdue = active.filter(c => c.status === 'overdue');
    const pending = active.filter(c => c.status === 'pending' || c.status === 'in_progress');
    const completionRate = this.getCompletionRate();
    const reliability = this.getReliabilityScore();
    const oldest = pending.sort((a, b) => a.madeAt - b.madeAt)[0] || null;

    // Reliability trend (last 20 vs previous 20)
    const recent = history.slice(-20);
    const prev = history.slice(-40, -20);
    const recentRate = recent.length > 0 ? recent.filter(c => c.status === 'completed').length / recent.length : null;
    const prevRate = prev.length > 0 ? prev.filter(c => c.status === 'completed').length / prev.length : null;
    let trend = 'stable';
    if (recentRate !== null && prevRate !== null) {
      trend = recentRate > prevRate + 0.1 ? 'improving' : recentRate < prevRate - 0.1 ? 'declining' : 'stable';
    }

    return {
      active: pending.length,
      overdue: overdue.length,
      overdueList: overdue,
      completionRate: completionRate.rate,
      reliabilityScore: reliability.score,
      reliabilityTrend: trend,
      oldestUnfulfilled: oldest,
      totalHistory: history.length
    };
  }

  checkOverdue() {
    const active = readJSON(ACTIVE_PATH, []);
    const now = Date.now();
    let changed = false;
    for (const c of active) {
      if (c.deadline && c.deadline < now && c.status !== 'overdue' && c.status !== 'completed') {
        c.status = 'overdue';
        changed = true;
      }
    }
    if (changed) writeJSON(ACTIVE_PATH, active);
    return active.filter(c => c.status === 'overdue');
  }

  autoDetect(message) {
    const patterns = [
      /\bI'll\b/i, /\bI will\b/i, /\blet me\b/i, /\bI should\b/i,
      /\bwe need to\b/i, /\bI'm going to\b/i, /\bI plan to\b/i,
      /\bI promise\b/i, /\bI commit\b/i
    ];
    const matches = patterns.filter(p => p.test(message));
    if (matches.length === 0) return { detected: false };
    return {
      detected: true,
      matchCount: matches.length,
      suggestion: 'Commitment language detected. Consider logging: "' + (message || '').slice(0, 100) + '"',
      message: message.slice(0, 200)
    };
  }

  getHistory(limit) {
    const history = readJSON(HISTORY_PATH, []);
    return history.slice(-(limit || 50)).reverse();
  }
}

module.exports = CommitmentTracker;
