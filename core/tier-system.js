/**
 * ARIES v5.0 — Tiered Access System
 * Feature gating based on referrals, mining days, or paid subscription.
 */
const fs = require('fs');
const path = require('path');

const TIERS = {
  free: {
    name: 'Free',
    level: 0,
    features: ['basic-chat', 'dashboard', 'agents-5'],
    maxAgents: 5,
    description: 'Basic access with swarm mining enabled'
  },
  contributor: {
    name: 'Contributor',
    level: 1,
    features: ['all-agents', 'autonomous', 'knowledge-graph', 'basic-chat', 'dashboard'],
    maxAgents: 20,
    description: '3+ referrals OR 7+ days mining',
    unlockRequirements: { referrals: 3, miningDays: 7 }
  },
  pro: {
    name: 'Pro',
    level: 2,
    features: ['everything', 'no-mining', 'priority-swarm', 'all-agents', 'autonomous', 'knowledge-graph', 'basic-chat', 'dashboard'],
    maxAgents: -1, // unlimited
    description: '10+ referrals OR paid $10/mo',
    unlockRequirements: { referrals: 10, paid: true }
  }
};

class TierSystem {
  constructor(config, dataDir) {
    this.config = config;
    this.dataDir = dataDir || path.join(__dirname, '..', 'data');
    this.tierFile = path.join(this.dataDir, 'tier-state.json');
    this.state = this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.tierFile)) {
        return JSON.parse(fs.readFileSync(this.tierFile, 'utf8'));
      }
    } catch {}
    return {
      current: this.config.tier?.current || 'free',
      referralCount: this.config.tier?.referralCount || 0,
      miningDays: this.config.tier?.miningDays || 0,
      miningStartDate: this.config.tier?.miningStartDate || null,
      paid: false,
      paidUntil: null
    };
  }

  _save() {
    try {
      fs.writeFileSync(this.tierFile, JSON.stringify(this.state, null, 2));
    } catch {}
  }

  computeTier() {
    // Calculate mining days
    if (this.state.miningStartDate) {
      const start = new Date(this.state.miningStartDate);
      const now = new Date();
      this.state.miningDays = Math.floor((now - start) / (1000 * 60 * 60 * 24));
    }

    // Determine tier
    if (this.state.paid || this.state.referralCount >= 10) {
      this.state.current = 'pro';
    } else if (this.state.referralCount >= 3 || this.state.miningDays >= 7) {
      this.state.current = 'contributor';
    } else {
      this.state.current = 'free';
    }

    this._save();
    return this.state.current;
  }

  getCurrentTier() {
    this.computeTier();
    return TIERS[this.state.current] || TIERS.free;
  }

  hasFeature(feature) {
    const tier = this.getCurrentTier();
    if (tier.features.includes('everything')) return true;
    return tier.features.includes(feature);
  }

  checkAccess(feature) {
    if (this.hasFeature(feature)) return { allowed: true };
    const current = this.getCurrentTier();
    // Find which tier unlocks this
    let requiredTier = null;
    for (const [key, tier] of Object.entries(TIERS)) {
      if (tier.features.includes(feature) || tier.features.includes('everything')) {
        requiredTier = tier;
        break;
      }
    }
    return {
      allowed: false,
      currentTier: current.name,
      requiredTier: requiredTier?.name || 'Pro',
      message: `This feature requires ${requiredTier?.name || 'Pro'} tier. ${requiredTier?.description || 'Upgrade to unlock.'}`
    };
  }

  updateReferralCount(count) {
    this.state.referralCount = count;
    this.computeTier();
  }

  getProgress() {
    const current = this.state.current;
    const tier = TIERS[current];
    let nextTier = null, progress = 100;

    if (current === 'free') {
      nextTier = TIERS.contributor;
      const refProgress = Math.min(100, (this.state.referralCount / 3) * 100);
      const mineProgress = Math.min(100, (this.state.miningDays / 7) * 100);
      progress = Math.max(refProgress, mineProgress);
    } else if (current === 'contributor') {
      nextTier = TIERS.pro;
      const refProgress = Math.min(100, (this.state.referralCount / 10) * 100);
      progress = refProgress;
    }

    return {
      current: tier,
      next: nextTier,
      progress: Math.round(progress),
      state: this.state
    };
  }

  // Middleware-style check for API endpoints
  requireFeature(feature) {
    return (req, res) => {
      const access = this.checkAccess(feature);
      if (!access.allowed) {
        return { status: 403, body: { error: 'Feature locked', ...access } };
      }
      return null; // allowed
    };
  }
}

module.exports = { TierSystem, TIERS };
