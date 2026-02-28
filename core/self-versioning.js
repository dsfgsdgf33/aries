/**
 * ARIES — Self-Versioning System
 * Tracks every self-modification with diffs, snapshots, and rollback capability.
 * Git-like version control for autonomous code changes.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'versions');
const HISTORY_PATH = path.join(DATA_DIR, 'history.json');

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }

/**
 * Simple line-based diff between two strings.
 */
function simpleDiff(before, after) {
  const aLines = (before || '').split('\n');
  const bLines = (after || '').split('\n');
  const changes = [];
  const maxLen = Math.max(aLines.length, bLines.length);

  for (let i = 0; i < maxLen; i++) {
    const a = aLines[i];
    const b = bLines[i];
    if (a === undefined) {
      changes.push({ type: 'add', line: i + 1, content: b });
    } else if (b === undefined) {
      changes.push({ type: 'remove', line: i + 1, content: a });
    } else if (a !== b) {
      changes.push({ type: 'change', line: i + 1, before: a, after: b });
    }
  }

  return {
    additions: changes.filter(c => c.type === 'add').length,
    removals: changes.filter(c => c.type === 'remove').length,
    modifications: changes.filter(c => c.type === 'change').length,
    total: changes.length,
    changes: changes.slice(0, 100), // cap for storage
  };
}

class SelfVersioning {
  constructor(opts) {
    this.ai = opts && opts.ai;
    ensureDir();
  }

  /**
   * Create a version snapshot for one or more file modifications.
   * @param {Array<{path: string, before: string, after: string}>} files — files being modified
   * @param {string} reason — why this change is being made
   * @param {object} opts — { dreamSource, rollbackable }
   * @returns {object} version entry
   */
  createVersion(files, reason, opts) {
    opts = opts || {};
    const history = readJSON(HISTORY_PATH, []);
    const versionNum = history.length + 1;

    const fileEntries = files.map(f => {
      const diff = simpleDiff(f.before, f.after);
      // Store snapshot in data/versions/snapshots/
      const snapshotDir = path.join(DATA_DIR, 'snapshots', String(versionNum));
      if (!fs.existsSync(snapshotDir)) fs.mkdirSync(snapshotDir, { recursive: true });
      const safeName = path.basename(f.path).replace(/[^a-zA-Z0-9._-]/g, '_');
      if (f.before) fs.writeFileSync(path.join(snapshotDir, safeName + '.before'), f.before);
      if (f.after) fs.writeFileSync(path.join(snapshotDir, safeName + '.after'), f.after);

      return {
        path: f.path,
        relativePath: path.relative(path.join(__dirname, '..'), f.path),
        diff,
        snapshotDir,
      };
    });

    const version = {
      id: uuid(),
      version: versionNum,
      timestamp: Date.now(),
      date: new Date().toISOString(),
      files: fileEntries,
      reason: reason || 'Self-modification',
      dreamSource: opts.dreamSource || null,
      rollbackable: opts.rollbackable !== false,
      rolledBack: false,
      totalChanges: fileEntries.reduce((s, f) => s + f.diff.total, 0),
    };

    history.push(version);
    writeJSON(HISTORY_PATH, history);

    console.log('[SELF-VERSION] v' + versionNum + ': ' + reason + ' (' + fileEntries.length + ' files, ' + version.totalChanges + ' changes)');
    return version;
  }

  /**
   * Get version history.
   */
  getHistory(limit) {
    const history = readJSON(HISTORY_PATH, []);
    const sorted = history.sort((a, b) => b.timestamp - a.timestamp);
    return limit ? sorted.slice(0, limit) : sorted;
  }

  /**
   * Get current (latest) version number.
   */
  getCurrentVersion() {
    const history = readJSON(HISTORY_PATH, []);
    return history.length;
  }

  /**
   * Rollback to a specific version by restoring file snapshots.
   */
  rollback(versionId) {
    const history = readJSON(HISTORY_PATH, []);
    const version = history.find(v => v.id === versionId);
    if (!version) return { error: 'Version not found' };
    if (!version.rollbackable) return { error: 'This version is not rollbackable' };
    if (version.rolledBack) return { error: 'Already rolled back' };

    const results = [];
    for (const file of version.files) {
      const snapshotDir = file.snapshotDir;
      const safeName = path.basename(file.path).replace(/[^a-zA-Z0-9._-]/g, '_');
      const beforePath = path.join(snapshotDir, safeName + '.before');

      if (fs.existsSync(beforePath)) {
        try {
          const beforeContent = fs.readFileSync(beforePath, 'utf8');
          fs.writeFileSync(file.path, beforeContent);
          results.push({ file: file.path, status: 'restored' });
        } catch (e) {
          results.push({ file: file.path, status: 'failed', error: e.message });
        }
      } else {
        results.push({ file: file.path, status: 'no-snapshot', note: 'No before-snapshot found' });
      }
    }

    // Mark as rolled back
    version.rolledBack = true;
    version.rolledBackAt = Date.now();
    writeJSON(HISTORY_PATH, history);

    console.log('[SELF-VERSION] Rolled back v' + version.version + ': ' + results.filter(r => r.status === 'restored').length + ' files restored');
    return { version, results };
  }

  /**
   * Compare two versions.
   */
  compare(versionId1, versionId2) {
    const history = readJSON(HISTORY_PATH, []);
    const v1 = history.find(v => v.id === versionId1);
    const v2 = history.find(v => v.id === versionId2);
    if (!v1 || !v2) return { error: 'One or both versions not found' };

    return {
      v1: { id: v1.id, version: v1.version, date: v1.date, reason: v1.reason, files: v1.files.map(f => f.relativePath || f.path) },
      v2: { id: v2.id, version: v2.version, date: v2.date, reason: v2.reason, files: v2.files.map(f => f.relativePath || f.path) },
      commonFiles: v1.files.filter(f1 => v2.files.some(f2 => f2.path === f1.path)).map(f => f.relativePath || f.path),
    };
  }

  /**
   * Get statistics about self-modifications.
   */
  getStats() {
    const history = readJSON(HISTORY_PATH, []);
    const totalVersions = history.length;
    const rollbacks = history.filter(v => v.rolledBack).length;
    const totalChanges = history.reduce((s, v) => s + (v.totalChanges || 0), 0);

    // Most-modified files
    const fileCounts = {};
    for (const v of history) {
      for (const f of (v.files || [])) {
        const key = f.relativePath || f.path;
        fileCounts[key] = (fileCounts[key] || 0) + 1;
      }
    }
    const mostModified = Object.entries(fileCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([file, count]) => ({ file, count }));

    // By dream source
    const bySource = {};
    for (const v of history) {
      const src = v.dreamSource || 'manual';
      bySource[src] = (bySource[src] || 0) + 1;
    }

    return {
      totalVersions,
      rollbacks,
      totalChanges,
      mostModified,
      bySource,
      currentVersion: totalVersions,
    };
  }
}

module.exports = SelfVersioning;
