/**
 * ARES Credits — Swarm Training Credits & Access Tiers
 * Tracks contribution and gates access to the evolving model.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const CREDITS_FILE = path.join(DATA_DIR, 'ares-credits.json');

const CREDIT_RATES = {
  gpu_training: 10,   // 10 credits per hour of GPU training
  cpu_inference: 1,    // 1 credit per hour of CPU inference
  mining: 2,           // 2 credits per hour of mining
  uptime: 0.5,         // 0.5 credits per hour of uptime
  storage: 0.1,        // 0.1 credits per GB-hour of storage
};

const TIERS = {
  FREE: { name: 'Free', level: 0, minCredits: 0, description: 'Basic Ollama model access' },
  CONTRIBUTOR: { name: 'Contributor', level: 1, minCredits: 100, description: 'Access to latest ARES model for inference' },
  TRAINER: { name: 'Trainer', level: 2, minCredits: 500, description: 'Priority access, higher rate limits', gpuRequired: true },
  CORE: { name: 'Core', level: 3, minCredits: 1000, description: 'Unlimited access, early model releases', gpuRequired: true },
};

class AresCredits {
  constructor(config) {
    this.config = config || {};
    this.state = this._load();
  }

  _load() {
    try {
      if (fs.existsSync(CREDITS_FILE)) return JSON.parse(fs.readFileSync(CREDITS_FILE, 'utf8'));
    } catch (e) {}
    return { workers: {}, created: new Date().toISOString() };
  }

  _save() {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(CREDITS_FILE, JSON.stringify(this.state, null, 2));
    } catch (e) { console.error('[ARES-CREDITS] Save error:', e.message); }
  }

  _ensureWorker(workerId) {
    if (!this.state.workers[workerId]) {
      this.state.workers[workerId] = {
        totalCredits: 0,
        creditsByType: {},
        history: [],
        tier: 'FREE',
        hasGpuContribution: false,
        firstSeen: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
      };
    }
    return this.state.workers[workerId];
  }

  addCredits(workerId, type, amount) {
    var worker = this._ensureWorker(workerId);
    var rate = CREDIT_RATES[type] || 1;
    var credits = amount * rate;

    worker.totalCredits += credits;
    worker.creditsByType[type] = (worker.creditsByType[type] || 0) + credits;
    worker.lastActivity = new Date().toISOString();

    if (type === 'gpu_training') worker.hasGpuContribution = true;

    worker.history.push({
      type: type,
      amount: amount,
      credits: credits,
      timestamp: new Date().toISOString(),
    });

    // Keep only last 1000 history entries
    if (worker.history.length > 1000) worker.history = worker.history.slice(-1000);

    // Recalculate tier
    worker.tier = this._calculateTier(worker);
    this._save();

    return { ok: true, credits: credits, totalCredits: worker.totalCredits, tier: worker.tier };
  }

  _calculateTier(worker) {
    if (worker.totalCredits >= TIERS.CORE.minCredits && worker.hasGpuContribution) return 'CORE';
    if (worker.totalCredits >= TIERS.TRAINER.minCredits && worker.hasGpuContribution) return 'TRAINER';
    if (worker.totalCredits >= TIERS.CONTRIBUTOR.minCredits) return 'CONTRIBUTOR';
    return 'FREE';
  }

  getCredits(workerId) {
    var worker = this.state.workers[workerId];
    if (!worker) return { totalCredits: 0, tier: 'FREE', creditsByType: {} };
    return {
      totalCredits: worker.totalCredits,
      tier: worker.tier,
      tierInfo: TIERS[worker.tier],
      creditsByType: worker.creditsByType,
      hasGpuContribution: worker.hasGpuContribution,
      firstSeen: worker.firstSeen,
      lastActivity: worker.lastActivity,
    };
  }

  getTier(workerId) {
    var worker = this.state.workers[workerId];
    if (!worker) return { tier: 'FREE', tierInfo: TIERS.FREE };
    return { tier: worker.tier, tierInfo: TIERS[worker.tier] };
  }

  canAccessModel(workerId, modelVersion) {
    var worker = this.state.workers[workerId];
    if (!worker) return { allowed: false, reason: 'Unknown worker', requiredTier: 'CONTRIBUTOR' };

    var tier = TIERS[worker.tier];
    if (tier.level >= 1) return { allowed: true, tier: worker.tier };

    return { allowed: false, reason: 'Insufficient credits. Need ' + TIERS.CONTRIBUTOR.minCredits + '+ credits.', requiredTier: 'CONTRIBUTOR', currentCredits: worker.totalCredits };
  }

  getLeaderboard(limit) {
    limit = limit || 10;
    var entries = [];
    var ids = Object.keys(this.state.workers);
    for (var i = 0; i < ids.length; i++) {
      var w = this.state.workers[ids[i]];
      entries.push({
        workerId: ids[i],
        totalCredits: w.totalCredits,
        tier: w.tier,
        hasGpu: w.hasGpuContribution,
        lastActivity: w.lastActivity,
      });
    }
    entries.sort(function(a, b) { return b.totalCredits - a.totalCredits; });
    return entries.slice(0, limit);
  }

  getCreditHistory(workerId) {
    var worker = this.state.workers[workerId];
    if (!worker) return [];
    return worker.history.slice(-100);
  }

  getTierBreakdown() {
    var breakdown = { FREE: 0, CONTRIBUTOR: 0, TRAINER: 0, CORE: 0 };
    var ids = Object.keys(this.state.workers);
    for (var i = 0; i < ids.length; i++) {
      var tier = this.state.workers[ids[i]].tier || 'FREE';
      breakdown[tier] = (breakdown[tier] || 0) + 1;
    }
    return { breakdown: breakdown, total: ids.length, tiers: TIERS };
  }
}

module.exports = { AresCredits, TIERS, CREDIT_RATES };
