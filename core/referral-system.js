/**
 * ARIES v5.0 — Referral System
 * Tracks referrals and unlocks tiers.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TIERS = {
  0: { name: 'Free', features: ['basic-chat', 'dashboard', 'agents-5'] },
  3: { name: 'Contributor', features: ['all-agents', 'autonomous', 'knowledge-graph'] },
  10: { name: 'Pro', features: ['everything', 'no-mining', 'priority-swarm'] },
  25: { name: 'Swarm Commander', features: ['full-swarm-commander', 'enterprise-features'] }
};

class ReferralSystem {
  constructor(config, dataDir) {
    this.config = config;
    this.dataDir = dataDir || path.join(__dirname, '..', 'data');
    this.referralFile = path.join(this.dataDir, 'referrals.json');
    this.myCode = config.referral?.myCode || 'aries-' + crypto.randomBytes(4).toString('hex');
    this.referredBy = config.referral?.referredBy || null;
    this.referrals = this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.referralFile)) {
        return JSON.parse(fs.readFileSync(this.referralFile, 'utf8'));
      }
    } catch {}
    return { code: this.myCode, count: 0, users: [], tier: 'Free' };
  }

  _save() {
    try {
      fs.writeFileSync(this.referralFile, JSON.stringify(this.referrals, null, 2));
    } catch {}
  }

  addReferral(newUserCode, workerName) {
    this.referrals.count++;
    this.referrals.users.push({
      code: newUserCode,
      worker: workerName,
      date: new Date().toISOString()
    });
    this.referrals.tier = this.getTierName();
    this._save();
    return this.referrals;
  }

  getTierName() {
    const count = this.referrals.count;
    let tier = 'Free';
    for (const [threshold, info] of Object.entries(TIERS)) {
      if (count >= parseInt(threshold)) tier = info.name;
    }
    return tier;
  }

  getTierInfo() {
    const count = this.referrals.count;
    const tierName = this.getTierName();
    let nextTier = null;
    let nextThreshold = null;
    const thresholds = Object.keys(TIERS).map(Number).sort((a, b) => a - b);
    for (const t of thresholds) {
      if (count < t) { nextTier = TIERS[t].name; nextThreshold = t; break; }
    }
    return {
      code: this.myCode,
      count,
      tier: tierName,
      nextTier,
      nextThreshold,
      progress: nextThreshold ? Math.round((count / nextThreshold) * 100) : 100
    };
  }

  getStats() {
    return {
      ...this.getTierInfo(),
      referredBy: this.referredBy,
      users: this.referrals.users
    };
  }

  // Register API routes
  registerRoutes(routeHandler) {
    routeHandler('/api/referral/stats', 'GET', (req, res) => {
      return { status: 200, body: this.getStats() };
    });

    routeHandler('/api/referral/register', 'POST', (req, res, body) => {
      try {
        const data = JSON.parse(body);
        if (data.referrerCode === this.myCode) {
          this.addReferral(data.newUserCode, data.workerName);
          return { status: 200, body: { ok: true, count: this.referrals.count } };
        }
        return { status: 200, body: { ok: true, message: 'forwarded' } };
      } catch {
        return { status: 400, body: { error: 'Invalid body' } };
      }
    });
  }
}

module.exports = ReferralSystem;
