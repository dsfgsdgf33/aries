/**
 * ARIES v5.0 — Backup & Restore System
 * 
 * Creates JSON-based backups of all config and data files.
 * Features:
 * - Manual and auto-daily backups
 * - Restore from backup
 * - Retention policy (keep last N days)
 */

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

/**
 * @class Backup
 * @extends EventEmitter
 */
class Backup extends EventEmitter {
  /**
   * @param {Object} config
   * @param {boolean} [config.enabled=true]
   * @param {boolean} [config.autoDaily=true]
   * @param {number} [config.keepDays=7]
   * @param {string} [config.directory='backups']
   * @param {string} [config.baseDir]
   */
  constructor(config = {}) {
    super();
    try {
      this.enabled = config.enabled !== false;
      this.autoDaily = config.autoDaily !== false;
      this.keepDays = config.keepDays || 7;
      this.baseDir = config.baseDir || path.join(__dirname, '..');
      this.backupDir = path.join(this.baseDir, config.directory || 'backups');
      this._dailyTimer = null;
      this._ensureDir();
    } catch (err) {
      console.error('[BACKUP] Init error:', err.message);
      this.enabled = false;
    }
  }

  /**
   * Create a backup of all config and data files.
   * @returns {Object} { path, size, fileCount, timestamp }
   */
  createBackup() {
    try {
      var now = new Date();
      var ts = now.getFullYear() + '-' +
        String(now.getMonth() + 1).padStart(2, '0') + '-' +
        String(now.getDate()).padStart(2, '0') + '-' +
        String(now.getHours()).padStart(2, '0') +
        String(now.getMinutes()).padStart(2, '0') +
        String(now.getSeconds()).padStart(2, '0');
      var filename = 'aries-backup-' + ts + '.json';
      var filePath = path.join(this.backupDir, filename);

      var backup = {
        version: '4.0.0',
        timestamp: now.toISOString(),
        files: {}
      };

      var fileCount = 0;

      // Config
      var configPath = path.join(this.baseDir, 'config.json');
      if (fs.existsSync(configPath)) {
        backup.files['config.json'] = {
          content: fs.readFileSync(configPath, 'utf8'),
          encoding: 'utf8'
        };
        fileCount++;
      }

      // Data JSON files
      var dataDir = path.join(this.baseDir, 'data');
      if (fs.existsSync(dataDir)) {
        var dataFiles = fs.readdirSync(dataDir);
        for (var i = 0; i < dataFiles.length; i++) {
          var f = dataFiles[i];
          if (!f.endsWith('.json')) continue;
          try {
            var fp = path.join(dataDir, f);
            var stat = fs.statSync(fp);
            if (stat.size > 10 * 1024 * 1024) continue; // skip > 10MB
            backup.files['data/' + f] = {
              content: fs.readFileSync(fp, 'utf8'),
              encoding: 'utf8'
            };
            fileCount++;
          } catch (e) {
            // skip unreadable files
          }
        }
      }

      // Data memory markdown files
      var memDir = path.join(this.baseDir, 'data', 'memory');
      if (fs.existsSync(memDir)) {
        var memFiles = fs.readdirSync(memDir);
        for (var j = 0; j < memFiles.length; j++) {
          var mf = memFiles[j];
          if (!mf.endsWith('.md')) continue;
          try {
            backup.files['data/memory/' + mf] = {
              content: fs.readFileSync(path.join(memDir, mf), 'utf8'),
              encoding: 'utf8'
            };
            fileCount++;
          } catch (e) {
            // skip
          }
        }
      }

      var jsonStr = JSON.stringify(backup, null, 2);
      fs.writeFileSync(filePath, jsonStr);

      this.emit('backup-created', { path: filePath, fileCount: fileCount });

      return {
        path: filePath,
        filename: filename,
        size: jsonStr.length,
        fileCount: fileCount,
        timestamp: now.toISOString()
      };
    } catch (err) {
      this.emit('backup-error', { error: err.message });
      return { error: err.message };
    }
  }

  /**
   * Restore from a backup file.
   * @param {string} backupPath
   * @returns {Object} { restored, fileCount }
   */
  restoreBackup(backupPath) {
    try {
      var fullPath = path.isAbsolute(backupPath) ? backupPath : path.join(this.backupDir, backupPath);
      if (!fs.existsSync(fullPath)) {
        return { error: 'Backup file not found' };
      }

      var raw = fs.readFileSync(fullPath, 'utf8');
      var backup = JSON.parse(raw);
      var fileCount = 0;

      for (var key in backup.files) {
        try {
          var entry = backup.files[key];
          var targetPath = path.join(this.baseDir, key);
          var targetDir = path.dirname(targetPath);
          if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
          }
          fs.writeFileSync(targetPath, entry.content);
          fileCount++;
        } catch (e) {
          // skip
        }
      }

      this.emit('backup-restored', { path: fullPath, fileCount: fileCount });
      return { restored: true, fileCount: fileCount, from: backup.timestamp };
    } catch (err) {
      return { error: err.message };
    }
  }

  /**
   * List available backup files.
   * @returns {Array}
   */
  listBackups() {
    try {
      if (!fs.existsSync(this.backupDir)) return [];
      var files = fs.readdirSync(this.backupDir);
      var backups = [];
      for (var i = 0; i < files.length; i++) {
        var f = files[i];
        if (!f.startsWith('aries-backup-') || !f.endsWith('.json')) continue;
        try {
          var fp = path.join(this.backupDir, f);
          var stat = fs.statSync(fp);
          backups.push({
            filename: f,
            size: stat.size,
            created: stat.mtime.toISOString()
          });
        } catch (e) {}
      }
      backups.sort(function(a, b) { return b.created.localeCompare(a.created); });
      return backups;
    } catch (err) {
      return [];
    }
  }

  /**
   * Start auto-daily backup schedule.
   */
  startAutoBackup() {
    try {
      if (!this.autoDaily) return;
      // Run cleanup immediately
      this._cleanup();
      // Check every hour if a daily backup is needed
      this._dailyTimer = setInterval(() => {
        try {
          var backups = this.listBackups();
          var today = new Date().toISOString().slice(0, 10);
          var hasToday = backups.some(function(b) { return b.created.slice(0, 10) === today; });
          if (!hasToday) {
            this.createBackup();
            this._cleanup();
          }
        } catch (e) {}
      }, 3600000); // every hour
    } catch (err) {
      // ignore
    }
  }

  /**
   * Stop auto-backup.
   */
  stop() {
    try {
      if (this._dailyTimer) clearInterval(this._dailyTimer);
    } catch (e) {}
  }

  /** @private */
  _cleanup() {
    try {
      var backups = this.listBackups();
      var cutoff = Date.now() - (this.keepDays * 24 * 60 * 60 * 1000);
      for (var i = 0; i < backups.length; i++) {
        var b = backups[i];
        if (new Date(b.created).getTime() < cutoff) {
          try {
            fs.unlinkSync(path.join(this.backupDir, b.filename));
          } catch (e) {}
        }
      }
    } catch (err) {
      // ignore
    }
  }

  /** @private */
  _ensureDir() {
    try {
      if (!fs.existsSync(this.backupDir)) {
        fs.mkdirSync(this.backupDir, { recursive: true });
      }
    } catch (err) {
      // ignore
    }
  }
}

module.exports = { Backup };
