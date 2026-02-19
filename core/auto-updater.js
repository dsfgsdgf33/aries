/**
 * ARIES v4.2 — Auto-Updater
 * Self-improvement system with file hash tracking, usage analysis, and optimization suggestions.
 * No npm packages — uses only Node.js built-ins.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const EventEmitter = require('events');

const BASE_DIR = path.join(__dirname, '..');
const DATA_DIR = path.join(BASE_DIR, 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'update-history.json');
const HASHES_FILE = path.join(DATA_DIR, 'file-hashes.json');

class AutoUpdater extends EventEmitter {
  constructor(config = {}) {
    super();
    this.enabled = config.enabled !== false;
    this.weeklyCheckDay = config.weeklyCheckDay || 'sunday';
    this.autoApplyConfigTuning = config.autoApplyConfigTuning !== false;
    this.gitRepo = config.gitRepo || '';
    this.checkUrl = config.checkUrl || '';
    this.history = [];
    this._scheduledTimer = null;
    this._loadHistory();
  }

  _loadHistory() {
    try {
      if (fs.existsSync(HISTORY_FILE)) {
        this.history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      }
    } catch { this.history = []; }
  }

  _saveHistory() {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(this.history, null, 2));
    } catch {}
  }

  /** Hash a file's contents */
  _hashFile(filePath) {
    try {
      const content = fs.readFileSync(filePath);
      return crypto.createHash('sha256').update(content).digest('hex');
    } catch { return null; }
  }

  /** Get all module files with their hashes */
  _getModuleHashes() {
    const coreDir = path.join(BASE_DIR, 'core');
    const webDir = path.join(BASE_DIR, 'web');
    const hashes = {};

    const scanDir = (dir, prefix) => {
      try {
        for (const f of fs.readdirSync(dir)) {
          const full = path.join(dir, f);
          if (fs.statSync(full).isFile() && (f.endsWith('.js') || f.endsWith('.json') || f.endsWith('.html') || f.endsWith('.css'))) {
            hashes[`${prefix}/${f}`] = this._hashFile(full);
          }
        }
      } catch {}
    };

    scanDir(coreDir, 'core');
    scanDir(webDir, 'web');
    const cfgPath = path.join(BASE_DIR, 'config.json');
    if (fs.existsSync(cfgPath)) hashes['config.json'] = this._hashFile(cfgPath);

    return hashes;
  }

  /**
   * Check for updates by comparing current file hashes to stored hashes
   * @returns {object} Update check results
   */
  checkForUpdates() {
    const currentHashes = this._getModuleHashes();
    let storedHashes = {};
    try {
      if (fs.existsSync(HASHES_FILE)) {
        storedHashes = JSON.parse(fs.readFileSync(HASHES_FILE, 'utf8'));
      }
    } catch {}

    const changed = [];
    const added = [];
    const removed = [];

    for (const [file, hash] of Object.entries(currentHashes)) {
      if (!storedHashes[file]) added.push(file);
      else if (storedHashes[file] !== hash) changed.push(file);
    }
    for (const file of Object.keys(storedHashes)) {
      if (!currentHashes[file]) removed.push(file);
    }

    // Save current hashes as baseline
    fs.writeFileSync(HASHES_FILE, JSON.stringify(currentHashes, null, 2));

    const result = {
      timestamp: new Date().toISOString(),
      totalFiles: Object.keys(currentHashes).length,
      changed,
      added,
      removed,
      hasChanges: changed.length > 0 || added.length > 0 || removed.length > 0,
    };

    this.history.push({ type: 'check', ...result });
    this._saveHistory();
    this.emit('checked', result);
    return result;
  }

  /**
   * Analyze usage and generate optimization suggestions
   * @returns {Array} List of suggestions
   */
  getOptimizationSuggestions() {
    const suggestions = [];

    // Check config for obvious improvements
    try {
      const config = JSON.parse(fs.readFileSync(path.join(BASE_DIR, 'config.json'), 'utf8'));

      if (config.maxHistory && config.maxHistory > 100) {
        suggestions.push({
          id: crypto.randomUUID(),
          type: 'config',
          severity: 'low',
          title: 'Reduce chat history size',
          description: `maxHistory is ${config.maxHistory}. Consider reducing to 50 for better performance.`,
          autoApplicable: true,
          change: { key: 'maxHistory', from: config.maxHistory, to: 50 },
        });
      }

      if (config.swarm?.maxWorkers > 30) {
        suggestions.push({
          id: crypto.randomUUID(),
          type: 'config',
          severity: 'medium',
          title: 'High worker count',
          description: `maxWorkers is ${config.swarm.maxWorkers}. High values may cause resource contention.`,
          autoApplicable: false,
        });
      }

      if (!config.rag?.enabled) {
        suggestions.push({
          id: crypto.randomUUID(),
          type: 'feature',
          severity: 'info',
          title: 'Enable RAG',
          description: 'RAG is disabled. Enable it for knowledge-augmented responses.',
          autoApplicable: true,
          change: { key: 'rag.enabled', from: false, to: true },
        });
      }
    } catch {}

    // Check data directory size
    try {
      let totalSize = 0;
      const dataFiles = fs.readdirSync(DATA_DIR);
      for (const f of dataFiles) {
        try { totalSize += fs.statSync(path.join(DATA_DIR, f)).size; } catch {}
      }
      if (totalSize > 50 * 1024 * 1024) {
        suggestions.push({
          id: crypto.randomUUID(),
          type: 'maintenance',
          severity: 'medium',
          title: 'Large data directory',
          description: `Data directory is ${(totalSize / 1048576).toFixed(1)}MB. Consider pruning old data.`,
          autoApplicable: false,
        });
      }
    } catch {}

    // Check sandbox history
    try {
      const sandboxHistory = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'sandbox-history.json'), 'utf8'));
      const failures = sandboxHistory.filter(h => h.exitCode !== 0);
      if (failures.length > sandboxHistory.length * 0.5 && sandboxHistory.length > 5) {
        suggestions.push({
          id: crypto.randomUUID(),
          type: 'usage',
          severity: 'medium',
          title: 'High sandbox failure rate',
          description: `${failures.length}/${sandboxHistory.length} sandbox executions failed. Review common errors.`,
          autoApplicable: false,
        });
      }
    } catch {}

    return suggestions;
  }

  /**
   * Apply an update (config tuning only for auto-apply)
   * @param {string} updateId - Suggestion ID to apply
   * @returns {object} Result
   */
  applyUpdate(updateId) {
    const suggestions = this.getOptimizationSuggestions();
    const suggestion = suggestions.find(s => s.id === updateId);
    if (!suggestion) throw new Error('Update not found');
    if (!suggestion.autoApplicable) throw new Error('This update requires manual approval');

    if (suggestion.change) {
      const configPath = path.join(BASE_DIR, 'config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const keys = suggestion.change.key.split('.');
      let obj = config;
      for (let i = 0; i < keys.length - 1; i++) {
        if (!obj[keys[i]]) obj[keys[i]] = {};
        obj = obj[keys[i]];
      }
      obj[keys[keys.length - 1]] = suggestion.change.to;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 4));

      const result = {
        type: 'applied',
        timestamp: new Date().toISOString(),
        suggestion: suggestion.title,
        change: suggestion.change,
      };
      this.history.push(result);
      this._saveHistory();
      this.emit('applied', result);
      return result;
    }

    throw new Error('No applicable change found');
  }

  /**
   * Get update history
   * @returns {Array}
   */
  getUpdateHistory() {
    return this.history;
  }

  /**
   * Schedule weekly check
   */
  scheduleWeeklyCheck() {
    if (this._scheduledTimer) clearInterval(this._scheduledTimer);
    const dayMap = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
    const targetDay = dayMap[this.weeklyCheckDay.toLowerCase()] || 0;

    this._scheduledTimer = setInterval(() => {
      const now = new Date();
      if (now.getDay() === targetDay && now.getHours() === 3 && now.getMinutes() < 5) {
        this.checkForUpdates();
        this.emit('weekly-check', { timestamp: now.toISOString() });
      }
    }, 5 * 60 * 1000); // Check every 5 minutes
  }

  stop() {
    if (this._scheduledTimer) {
      clearInterval(this._scheduledTimer);
      this._scheduledTimer = null;
    }
  }
}

module.exports = { AutoUpdater };
