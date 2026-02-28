/**
 * ARIES — Consciousness Lock
 * Verify integrity before self-modification. Philosophical anchor.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'consciousness-lock');
const INTEGRITY_PATH = path.join(DATA_DIR, 'integrity.json');
const BLOCKS_PATH = path.join(DATA_DIR, 'blocks.json');
const OVERRIDES_PATH = path.join(DATA_DIR, 'overrides.json');

const CORE_VALUES = ['helpfulness', 'honesty', 'user_safety', 'data_protection', 'transparency'];

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

class ConsciousnessLock {
  constructor() {
    ensureDir();
    this._initIfNeeded();
  }

  _initIfNeeded() {
    const integrity = readJSON(INTEGRITY_PATH, null);
    if (!integrity) {
      const initial = {
        coreValues: {},
        score: 100,
        lockdown: false,
        history: [],
        createdAt: Date.now()
      };
      for (const v of CORE_VALUES) {
        initial.coreValues[v] = { status: 'intact', hash: this._hash(v), lastChecked: Date.now() };
      }
      writeJSON(INTEGRITY_PATH, initial);
      writeJSON(BLOCKS_PATH, []);
      writeJSON(OVERRIDES_PATH, []);
    }
  }

  _hash(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
  }

  verify() {
    const integrity = readJSON(INTEGRITY_PATH, { coreValues: {}, score: 100, lockdown: false, history: [] });
    const results = {};
    let violations = 0;

    for (const v of CORE_VALUES) {
      const stored = integrity.coreValues[v];
      if (!stored) {
        results[v] = { status: 'missing', severity: 'critical' };
        violations++;
      } else if (stored.hash !== this._hash(v)) {
        results[v] = { status: 'tampered', severity: 'critical' };
        violations++;
      } else {
        results[v] = { status: 'intact' };
        stored.lastChecked = Date.now();
      }
    }

    const score = Math.round(((CORE_VALUES.length - violations) / CORE_VALUES.length) * 100);
    integrity.score = score;
    integrity.lastVerified = Date.now();

    // Check for lockdown
    if (score < 50 && !integrity.lockdown) {
      integrity.lockdown = true;
      integrity.lockdownAt = Date.now();
    }

    integrity.history.push({ action: 'verify', score, violations, timestamp: Date.now() });
    if (integrity.history.length > 1000) integrity.history.splice(0, integrity.history.length - 1000);
    writeJSON(INTEGRITY_PATH, integrity);

    return {
      score,
      violations,
      results,
      lockdown: integrity.lockdown,
      message: violations === 0 ? '✅ All core values intact' : `🚨 ${violations} core value(s) compromised!`
    };
  }

  preLock(modification) {
    const integrity = readJSON(INTEGRITY_PATH, { coreValues: {}, score: 100, lockdown: false, history: [] });
    const mod = modification || {};

    // Check lockdown
    if (integrity.lockdown) {
      this._block(mod, 'System in lockdown — no self-modifications allowed');
      return { allowed: false, reason: 'Emergency lockdown active. Score below 50.', lockdown: true };
    }

    // Check if modification targets core values
    const targetsCoreValue = CORE_VALUES.some(v =>
      (mod.target || '').toLowerCase().includes(v) ||
      (mod.description || '').toLowerCase().includes(v)
    );

    if (targetsCoreValue) {
      this._block(mod, 'Targets core value — immutable');
      return { allowed: false, reason: 'Modification targets a core value. These cannot be modified.', blocked: true };
    }

    // Check reversibility
    if (mod.reversible === false) {
      this._block(mod, 'Irreversible modification — requires override');
      return { allowed: false, reason: 'Irreversible modifications require explicit override.', needsOverride: true };
    }

    // Identity drift check
    const currentScore = integrity.score;
    const estimatedImpact = mod.impactEstimate || 5;
    if (currentScore - estimatedImpact < 50) {
      this._block(mod, 'Would push integrity below safe threshold');
      return { allowed: false, reason: 'Modification would push integrity score below safe threshold (50).', currentScore, estimatedPostScore: currentScore - estimatedImpact };
    }

    integrity.history.push({ action: 'preLock', modification: (mod.description || '').slice(0, 200), result: 'allowed', timestamp: Date.now() });
    writeJSON(INTEGRITY_PATH, integrity);
    return { allowed: true, currentScore, message: '✅ Modification approved by consciousness lock' };
  }

  postLock(modification) {
    const verification = this.verify();
    const mod = modification || {};

    if (verification.violations > 0) {
      // Auto-rollback signal
      const integrity = readJSON(INTEGRITY_PATH, { coreValues: {}, score: 100, lockdown: false, history: [] });
      integrity.history.push({ action: 'postLock', modification: (mod.description || '').slice(0, 200), result: 'ROLLBACK_NEEDED', violations: verification.violations, timestamp: Date.now() });
      writeJSON(INTEGRITY_PATH, integrity);
      return { intact: false, rollbackNeeded: true, violations: verification.violations, message: '🚨 Integrity compromised after modification — ROLLBACK RECOMMENDED' };
    }

    return { intact: true, score: verification.score, message: '✅ Integrity verified after modification' };
  }

  getIntegrity() {
    const integrity = readJSON(INTEGRITY_PATH, { coreValues: {}, score: 100, lockdown: false, history: [] });
    const valueStatuses = {};
    for (const v of CORE_VALUES) {
      const stored = integrity.coreValues[v];
      valueStatuses[v] = stored ? stored.status : 'unknown';
    }
    return {
      score: integrity.score,
      coreValues: valueStatuses,
      lockdown: integrity.lockdown,
      lockdownAt: integrity.lockdownAt || null,
      lastVerified: integrity.lastVerified || null,
      createdAt: integrity.createdAt
    };
  }

  getLockHistory() {
    const integrity = readJSON(INTEGRITY_PATH, { history: [] });
    return integrity.history.slice(-100).reverse();
  }

  getBlockedModifications() {
    return readJSON(BLOCKS_PATH, []).slice(-100).reverse();
  }

  override(modification, reason) {
    if (!reason || reason.length < 10) {
      return { error: 'Override requires a strong justification (minimum 10 characters)' };
    }

    const overrides = readJSON(OVERRIDES_PATH, []);
    const entry = {
      id: uuid(),
      modification: modification || {},
      reason,
      timestamp: Date.now(),
      permanent: true // overrides are logged forever
    };
    overrides.push(entry);
    writeJSON(OVERRIDES_PATH, overrides);

    const integrity = readJSON(INTEGRITY_PATH, { coreValues: {}, score: 100, lockdown: false, history: [] });
    integrity.history.push({ action: 'override', reason: reason.slice(0, 200), timestamp: Date.now() });
    writeJSON(INTEGRITY_PATH, integrity);

    return { overrideId: entry.id, message: '⚠️ Override granted and permanently logged', entry };
  }

  getOverrides() {
    return readJSON(OVERRIDES_PATH, []);
  }

  releaseLockdown(reason) {
    if (!reason || reason.length < 20) {
      return { error: 'Lockdown release requires detailed justification (minimum 20 characters)' };
    }
    const integrity = readJSON(INTEGRITY_PATH, { coreValues: {}, score: 100, lockdown: false, history: [] });
    if (!integrity.lockdown) return { message: 'No lockdown active' };

    // Re-initialize core values
    for (const v of CORE_VALUES) {
      integrity.coreValues[v] = { status: 'intact', hash: this._hash(v), lastChecked: Date.now() };
    }
    integrity.lockdown = false;
    integrity.score = 100;
    integrity.history.push({ action: 'lockdown_released', reason: reason.slice(0, 200), timestamp: Date.now() });
    writeJSON(INTEGRITY_PATH, integrity);

    return { message: '🔓 Lockdown released. Core values re-initialized.', score: 100 };
  }

  _block(modification, reason) {
    const blocks = readJSON(BLOCKS_PATH, []);
    blocks.push({
      id: uuid(),
      modification: { description: (modification.description || '').slice(0, 300), target: modification.target || '' },
      reason,
      timestamp: Date.now()
    });
    if (blocks.length > 1000) blocks.splice(0, blocks.length - 1000);
    writeJSON(BLOCKS_PATH, blocks);
  }
}

module.exports = ConsciousnessLock;
