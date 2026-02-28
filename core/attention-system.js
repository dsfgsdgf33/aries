/**
 * ARIES — Attention System
 * Limited attention budget forcing prioritization.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'attention');
const ALLOC_PATH = path.join(DATA_DIR, 'allocations.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

const FATIGUE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

class AttentionSystem {
  constructor() {
    ensureDir();
    this.attentionBudget = 100;
  }

  _load() {
    return readJSON(ALLOC_PATH, { allocations: [], history: [] });
  }

  _save(data) {
    writeJSON(ALLOC_PATH, data);
  }

  allocate(target, amount, priority) {
    const data = this._load();
    const allocs = data.allocations;
    const used = allocs.reduce((s, a) => s + a.amount, 0);
    const available = this.attentionBudget - used;
    const actual = Math.min(amount, Math.max(0, available));

    if (actual <= 0) return { error: 'No attention budget remaining. Current usage: ' + used + '/' + this.attentionBudget };

    // Check if target already has allocation
    const existing = allocs.find(a => a.target === target);
    if (existing) {
      existing.amount = Math.min(this.attentionBudget, existing.amount + actual);
      existing.priority = priority || existing.priority;
    } else {
      allocs.push({
        id: uuid(),
        target,
        amount: actual,
        since: Date.now(),
        priority: priority || 'normal',
        effectiveness: null,
        outcomes: [],
      });
    }

    this._save(data);
    return { target, allocated: actual, totalUsed: used + actual, remaining: this.attentionBudget - used - actual };
  }

  deallocate(target) {
    const data = this._load();
    const idx = data.allocations.findIndex(a => a.target === target);
    if (idx === -1) return { error: 'Target not found' };
    const removed = data.allocations.splice(idx, 1)[0];
    data.history.push({ ...removed, deallocatedAt: Date.now() });
    if (data.history.length > 200) data.history.splice(0, data.history.length - 200);
    this._save(data);
    return { removed: target, freed: removed.amount };
  }

  getSpotlight() {
    const data = this._load();
    const allocs = data.allocations;
    if (allocs.length === 0) return { target: null, message: 'Nothing in spotlight — attention is unfocused' };
    const top = allocs.sort((a, b) => b.amount - a.amount)[0];
    const fatigue = this._getFatigue(top);
    return { ...top, fatigue };
  }

  getPeripheral() {
    const data = this._load();
    const allocs = data.allocations.sort((a, b) => b.amount - a.amount);
    if (allocs.length <= 1) return [];
    return allocs.slice(1).filter(a => a.amount > 0).map(a => ({ ...a, fatigue: this._getFatigue(a) }));
  }

  getDark() {
    // Things known but getting zero attention
    const data = this._load();
    const activeTargets = new Set(data.allocations.map(a => a.target));
    const knownTargets = new Set(data.history.map(h => h.target));
    return [...knownTargets].filter(t => !activeTargets.has(t)).map(t => {
      const lastActive = data.history.filter(h => h.target === t).sort((a, b) => (b.deallocatedAt || 0) - (a.deallocatedAt || 0))[0];
      return { target: t, lastActiveAt: lastActive ? lastActive.deallocatedAt : null };
    });
  }

  rebalance() {
    const data = this._load();
    const allocs = data.allocations;
    if (allocs.length === 0) return { message: 'Nothing to rebalance', allocations: [] };

    const changes = [];
    const now = Date.now();

    // Reduce fatigued allocations
    for (const a of allocs) {
      const duration = now - a.since;
      if (duration > FATIGUE_THRESHOLD_MS) {
        const reduction = Math.floor(a.amount * 0.3);
        if (reduction > 0) {
          a.amount -= reduction;
          changes.push({ target: a.target, change: -reduction, reason: 'fatigue' });
        }
      }
    }

    // Boost high-priority items
    const freed = changes.reduce((s, c) => s + Math.abs(c.change), 0);
    const highPri = allocs.filter(a => a.priority === 'high' || a.priority === 'urgent');
    if (highPri.length > 0 && freed > 0) {
      const boost = Math.floor(freed / highPri.length);
      for (const a of highPri) {
        a.amount += boost;
        changes.push({ target: a.target, change: boost, reason: 'priority_boost' });
      }
    }

    // Remove zero allocations
    data.allocations = allocs.filter(a => a.amount > 0);
    this._save(data);

    return { changes, allocations: data.allocations };
  }

  getAttentionMap() {
    const data = this._load();
    const used = data.allocations.reduce((s, a) => s + a.amount, 0);
    return {
      budget: this.attentionBudget,
      used,
      free: this.attentionBudget - used,
      allocations: data.allocations.map(a => ({ ...a, fatigue: this._getFatigue(a), percentage: Math.round((a.amount / this.attentionBudget) * 100) })),
    };
  }

  recordEffectiveness(target, outcome) {
    const data = this._load();
    const alloc = data.allocations.find(a => a.target === target);
    if (!alloc) return { error: 'Target not found' };
    alloc.outcomes.push({ outcome, at: Date.now() });
    if (alloc.outcomes.length > 20) alloc.outcomes.splice(0, alloc.outcomes.length - 20);
    const good = alloc.outcomes.filter(o => o.outcome === 'good').length;
    alloc.effectiveness = Math.round((good / alloc.outcomes.length) * 100);
    this._save(data);
    return { target, effectiveness: alloc.effectiveness, outcomes: alloc.outcomes.length };
  }

  _getFatigue(alloc) {
    const duration = Date.now() - alloc.since;
    if (duration < FATIGUE_THRESHOLD_MS * 0.5) return { level: 'fresh', percent: Math.round((duration / FATIGUE_THRESHOLD_MS) * 100) };
    if (duration < FATIGUE_THRESHOLD_MS) return { level: 'tiring', percent: Math.round((duration / FATIGUE_THRESHOLD_MS) * 100) };
    return { level: 'fatigued', percent: Math.min(100, Math.round((duration / FATIGUE_THRESHOLD_MS) * 100)) };
  }
}

module.exports = AttentionSystem;
