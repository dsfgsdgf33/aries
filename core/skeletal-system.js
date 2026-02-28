/**
 * ARIES — Skeletal System
 * Immutable core infrastructure protection. The bones holding everything up.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'skeleton');
const BASELINE_PATH = path.join(DATA_DIR, 'baseline.json');
const ATTEMPTS_PATH = path.join(DATA_DIR, 'attempts.json');
const PROTECTED_PATH = path.join(DATA_DIR, 'protected.json');
const CORE_DIR = path.join(__dirname);

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

function hashFile(filePath) {
  try {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch { return null; }
}

const DEFAULT_PROTECTED = [
  { file: 'api-server.js', reason: 'Core server — backbone of all API communication', addedAt: Date.now() },
  { file: 'aries.js', reason: 'Main entry point — the brain stem', addedAt: Date.now() },
  { file: 'launcher.js', reason: 'System launcher — startup sequence', addedAt: Date.now() },
  { file: 'skeletal-system.js', reason: 'Self-protection — bones protect themselves', addedAt: Date.now() },
  { file: 'consciousness-lock.js', reason: 'Safety system — prevents dangerous modifications', addedAt: Date.now() },
  { file: 'neural-bus.js', reason: 'Nervous system — event bus connecting all modules', addedAt: Date.now() },
];

class SkeletalSystem {
  constructor() {
    ensureDir();
    this._protected = readJSON(PROTECTED_PATH, null);
    if (!this._protected) {
      this._protected = DEFAULT_PROTECTED;
      writeJSON(PROTECTED_PATH, this._protected);
    }
    this._baseline = readJSON(BASELINE_PATH, {});
    this._attempts = readJSON(ATTEMPTS_PATH, []);
    if (Object.keys(this._baseline).length === 0) {
      this.setBaseline();
    }
  }

  _resolvePath(filePath) {
    if (path.isAbsolute(filePath)) return filePath;
    return path.join(CORE_DIR, filePath);
  }

  _normalizeFile(filePath) {
    const base = path.basename(filePath);
    // Check if it's one of the known core files
    const known = this._protected.find(p => p.file === base || p.file === filePath);
    return known ? known.file : filePath;
  }

  getProtectedFiles() {
    return this._protected.map(p => ({
      file: p.file,
      reason: p.reason,
      addedAt: p.addedAt,
      fullPath: this._resolvePath(p.file),
      exists: fs.existsSync(this._resolvePath(p.file))
    }));
  }

  isProtected(filePath) {
    const base = path.basename(filePath);
    return this._protected.some(p => p.file === base || p.file === filePath);
  }

  protect(filePath, reason) {
    const name = path.basename(filePath);
    if (this.isProtected(name)) {
      return { already: true, file: name };
    }
    const entry = { file: name, reason: reason || 'Manually protected', addedAt: Date.now() };
    this._protected.push(entry);
    writeJSON(PROTECTED_PATH, this._protected);
    // Update baseline for new file
    const fullPath = this._resolvePath(name);
    const hash = hashFile(fullPath);
    if (hash) {
      this._baseline[name] = { hash, timestamp: Date.now() };
      writeJSON(BASELINE_PATH, this._baseline);
    }
    return { protected: true, file: name, reason: entry.reason };
  }

  unprotect(filePath, reason, override) {
    if (!override) {
      return { error: 'Override required to remove protection. Pass override=true with justification.' };
    }
    const name = path.basename(filePath);
    const idx = this._protected.findIndex(p => p.file === name);
    if (idx === -1) return { error: 'File not protected', file: name };

    const removed = this._protected.splice(idx, 1)[0];
    writeJSON(PROTECTED_PATH, this._protected);

    // Log permanently
    this._attempts.push({
      id: uuid(),
      type: 'unprotect',
      file: name,
      reason: reason || 'No reason given',
      override: true,
      previousProtection: removed,
      timestamp: Date.now()
    });
    writeJSON(ATTEMPTS_PATH, this._attempts);

    return { unprotected: true, file: name, reason };
  }

  verifyIntegrity() {
    const results = [];
    let allIntact = true;
    const alerts = [];

    for (const p of this._protected) {
      const fullPath = this._resolvePath(p.file);
      const currentHash = hashFile(fullPath);
      const baselineEntry = this._baseline[p.file];

      let status;
      if (!currentHash) {
        status = 'missing';
        allIntact = false;
        alerts.push({ file: p.file, issue: 'FILE MISSING', severity: 'critical' });
      } else if (!baselineEntry) {
        status = 'no_baseline';
      } else if (currentHash === baselineEntry.hash) {
        status = 'intact';
      } else {
        status = 'modified';
        allIntact = false;
        alerts.push({ file: p.file, issue: 'MODIFIED since baseline', severity: 'high' });
      }

      results.push({
        file: p.file,
        status,
        currentHash,
        baselineHash: baselineEntry ? baselineEntry.hash : null,
        reason: p.reason
      });
    }

    return { intact: allIntact, files: results, alerts, verifiedAt: Date.now() };
  }

  getIntegrityReport() {
    return this.verifyIntegrity();
  }

  setBaseline() {
    const baseline = {};
    for (const p of this._protected) {
      const fullPath = this._resolvePath(p.file);
      const hash = hashFile(fullPath);
      if (hash) {
        baseline[p.file] = { hash, timestamp: Date.now() };
      }
    }
    this._baseline = baseline;
    writeJSON(BASELINE_PATH, this._baseline);
    return { baselineSet: true, files: Object.keys(baseline).length, timestamp: Date.now() };
  }

  getModificationAttempts() {
    return this._attempts.slice(-100).reverse();
  }

  enforce(filePath, source) {
    const name = path.basename(filePath);
    const protected_ = this.isProtected(name);

    const attempt = {
      id: uuid(),
      type: 'enforce_check',
      file: name,
      source: source || 'unknown',
      protected: protected_,
      result: protected_ ? 'DENIED' : 'ALLOWED',
      timestamp: Date.now()
    };

    this._attempts.push(attempt);
    if (this._attempts.length > 1000) this._attempts = this._attempts.slice(-500);
    writeJSON(ATTEMPTS_PATH, this._attempts);

    return {
      allowed: !protected_,
      file: name,
      reason: protected_ ? 'File is protected by skeletal system' : 'File is not protected'
    };
  }
}

module.exports = SkeletalSystem;
