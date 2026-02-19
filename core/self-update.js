/**
 * ARIES v3.0 — Self-Update System
 * Safely read/write/edit Aries source code with automatic backups and validation.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ARIES_ROOT = path.join(__dirname, '..');
const BACKUPS_DIR = path.join(ARIES_ROOT, 'backups');
const LOG_FILE = path.join(ARIES_ROOT, 'data', 'self-update-log.json');
const MAX_BACKUPS_PER_FILE = 10;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function logAction(action, filePath, success, detail = '') {
  ensureDir(path.dirname(LOG_FILE));
  let log = [];
  try { log = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')); } catch {}
  log.push({ action, file: filePath, success, detail, timestamp: new Date().toISOString() });
  if (log.length > 200) log = log.slice(-200);
  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
}

/** Get safe relative path within aries dir */
function safePath(filePath) {
  const resolved = path.resolve(ARIES_ROOT, filePath);
  if (!resolved.startsWith(ARIES_ROOT)) throw new Error('Path outside aries directory');
  return resolved;
}

/** Backup key for a file (flattened path) */
function backupKey(filePath) {
  return path.relative(ARIES_ROOT, filePath).replace(/[\\/]/g, '_');
}

const selfUpdate = {
  /** Read any file in the aries directory */
  readSource(filePath) {
    try {
      const full = safePath(filePath);
      const content = fs.readFileSync(full, 'utf8');
      return { success: true, content, path: full, size: content.length };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  /** Create a timestamped backup of a file */
  backup(filePath) {
    try {
      const full = safePath(filePath);
      if (!fs.existsSync(full)) return { success: false, error: 'File does not exist' };
      ensureDir(BACKUPS_DIR);
      const key = backupKey(full);
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const backupName = `${key}__${ts}`;
      const backupPath = path.join(BACKUPS_DIR, backupName);
      fs.copyFileSync(full, backupPath);
      // Prune old backups for this file
      this._pruneBackups(key);
      return { success: true, backupPath };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  /** Prune backups keeping only last MAX_BACKUPS_PER_FILE */
  _pruneBackups(key) {
    try {
      const files = fs.readdirSync(BACKUPS_DIR)
        .filter(f => f.startsWith(key + '__'))
        .sort();
      while (files.length > MAX_BACKUPS_PER_FILE) {
        fs.unlinkSync(path.join(BACKUPS_DIR, files.shift()));
      }
    } catch {}
  },

  /** Write to an aries file with backup and validation */
  writeSource(filePath, content) {
    try {
      const full = safePath(filePath);
      // Backup if exists
      if (fs.existsSync(full)) {
        const bk = this.backup(filePath);
        if (!bk.success) return { success: false, error: `Backup failed: ${bk.error}` };
      }
      ensureDir(path.dirname(full));
      fs.writeFileSync(full, content);
      // Validate JS
      if (full.endsWith('.js')) {
        const valid = this.validateJS(filePath);
        if (!valid.success) {
          // Restore from backup
          this.restore(filePath);
          logAction('write', filePath, false, `Validation failed: ${valid.error}`);
          return { success: false, error: `Syntax error, auto-restored: ${valid.error}` };
        }
      }
      logAction('write', filePath, true, `${content.length} bytes`);
      return { success: true, path: full, size: content.length };
    } catch (e) {
      logAction('write', filePath, false, e.message);
      return { success: false, error: e.message };
    }
  },

  /** Surgical edit: find and replace text in a file */
  editSource(filePath, oldText, newText) {
    try {
      const full = safePath(filePath);
      const content = fs.readFileSync(full, 'utf8');
      if (!content.includes(oldText)) {
        return { success: false, error: 'Old text not found in file' };
      }
      const updated = content.replace(oldText, newText);
      return this.writeSource(filePath, updated);
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  /** Restore file from latest backup */
  restore(filePath) {
    try {
      const full = safePath(filePath);
      const key = backupKey(full);
      ensureDir(BACKUPS_DIR);
      const backups = fs.readdirSync(BACKUPS_DIR)
        .filter(f => f.startsWith(key + '__'))
        .sort();
      if (backups.length === 0) return { success: false, error: 'No backups found' };
      const latest = backups[backups.length - 1];
      fs.copyFileSync(path.join(BACKUPS_DIR, latest), full);
      logAction('restore', filePath, true, latest);
      return { success: true, restored: latest };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  /** Validate JS syntax using node -c */
  validateJS(filePath) {
    try {
      const full = safePath(filePath);
      execSync(`node -c "${full}"`, { encoding: 'utf8', timeout: 10000 });
      return { success: true };
    } catch (e) {
      return { success: false, error: (e.stderr || e.message || '').substring(0, 300) };
    }
  },

  /** List all backups */
  listBackups() {
    try {
      ensureDir(BACKUPS_DIR);
      const files = fs.readdirSync(BACKUPS_DIR).sort();
      const grouped = {};
      for (const f of files) {
        const parts = f.split('__');
        const key = parts[0];
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push({ name: f, timestamp: parts[1] || '', size: fs.statSync(path.join(BACKUPS_DIR, f)).size });
      }
      return { success: true, backups: grouped, total: files.length };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  /** Get the update log */
  getLog() {
    try {
      return JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
    } catch { return []; }
  }
};

module.exports = selfUpdate;
