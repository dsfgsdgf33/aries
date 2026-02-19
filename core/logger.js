/**
 * ARIES v5.0 — Centralized Logging System
 * 
 * Provides unified logging with:
 * - Log levels: debug, info, warn, error, fatal
 * - Console output (colored)
 * - File output (daily rotation)
 * - In-memory ring buffer
 * - Per-module tagging
 * - Auto-rotate old log files
 */

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3, fatal: 4 };
const LEVEL_NAMES = ['debug', 'info', 'warn', 'error', 'fatal'];
const COLORS = {
  debug: '\x1b[90m',   // gray
  info: '\x1b[36m',    // cyan
  warn: '\x1b[33m',    // yellow
  error: '\x1b[31m',   // red
  fatal: '\x1b[35m',   // magenta
};
const RESET = '\x1b[0m';

/**
 * @class Logger
 * @extends EventEmitter
 * Centralized logging with file, console, and buffer output.
 */
class Logger extends EventEmitter {
  /**
   * @param {Object} config
   * @param {string} [config.level='info']
   * @param {boolean} [config.file=true]
   * @param {boolean} [config.console=true]
   * @param {number} [config.maxDays=30]
   * @param {number} [config.bufferSize=500]
   * @param {string} [config.logDir]
   */
  constructor(config = {}) {
    super();
    try {
      this.level = LEVELS[config.level] !== undefined ? LEVELS[config.level] : LEVELS.info;
      this.fileEnabled = config.file !== false;
      this.consoleEnabled = config.console !== false;
      this.maxDays = config.maxDays || 30;
      this.bufferSize = config.bufferSize || 500;
      this.logDir = config.logDir || path.join(__dirname, '..', 'data', 'logs');
      this._buffer = [];
      this._children = new Map();
      this._ensureLogDir();
      this._rotateOldLogs();
    } catch (err) {
      console.error('[LOGGER] Init error:', err.message);
      this.level = LEVELS.info;
      this.fileEnabled = false;
      this.consoleEnabled = true;
      this.maxDays = 30;
      this.bufferSize = 500;
      this._buffer = [];
      this._children = new Map();
    }
  }

  /**
   * Create a child logger with module prefix.
   * @param {string} moduleName
   * @returns {ChildLogger}
   */
  create(moduleName) {
    try {
      if (this._children.has(moduleName)) return this._children.get(moduleName);
      const child = new ChildLogger(this, moduleName);
      this._children.set(moduleName, child);
      return child;
    } catch (err) {
      return new ChildLogger(this, moduleName || 'UNKNOWN');
    }
  }

  /**
   * Log a message at the given level.
   * @param {string} level
   * @param {string} moduleName
   * @param {string} msg
   * @param {Error} [err]
   */
  log(level, moduleName, msg, err) {
    try {
      const levelNum = LEVELS[level];
      if (levelNum === undefined || levelNum < this.level) return;

      const now = new Date();
      const ts = this._formatTs(now);
      const upperLevel = level.toUpperCase().padEnd(5);
      const mod = moduleName || 'CORE';
      var errStr = '';
      if (err && err.stack) {
        errStr = ' | ' + err.stack.split('\n')[0];
      } else if (err && err.message) {
        errStr = ' | ' + err.message;
      }
      const formatted = '[' + ts + '] [' + upperLevel + '] [' + mod + '] ' + msg + errStr;

      const entry = {
        timestamp: now.toISOString(),
        level: level,
        module: mod,
        message: msg,
        error: err ? (err.message || String(err)) : undefined,
        formatted: formatted,
      };

      // Ring buffer
      this._buffer.push(entry);
      if (this._buffer.length > this.bufferSize) {
        this._buffer.shift();
      }

      // Console
      if (this.consoleEnabled) {
        var color = COLORS[level] || '';
        console.log(color + formatted + RESET);
      }

      // File
      if (this.fileEnabled) {
        this._writeToFile(now, formatted);
      }

      // Emit for WebSocket broadcast
      this.emit('log', entry);
    } catch (e) {
      // Last resort
      console.error('[LOGGER] Write error:', e.message);
    }
  }

  /**
   * Get recent log entries from ring buffer.
   * @param {number} [count=50]
   * @param {string} [level]
   * @param {string} [moduleName]
   * @returns {Array}
   */
  getRecent(count, level, moduleName) {
    try {
      var entries = this._buffer;
      if (level) {
        entries = entries.filter(function(e) { return e.level === level; });
      }
      if (moduleName) {
        entries = entries.filter(function(e) { return e.module === moduleName; });
      }
      var limit = count || 50;
      return entries.slice(-limit);
    } catch (err) {
      return [];
    }
  }

  /**
   * Clear the in-memory log buffer.
   */
  clearBuffer() {
    try {
      this._buffer = [];
    } catch (err) {
      // ignore
    }
  }

  /**
   * Get all unique module names from buffer.
   * @returns {string[]}
   */
  getModules() {
    try {
      var mods = {};
      for (var i = 0; i < this._buffer.length; i++) {
        mods[this._buffer[i].module] = true;
      }
      return Object.keys(mods);
    } catch (err) {
      return [];
    }
  }

  /** @private */
  _formatTs(date) {
    try {
      var y = date.getFullYear();
      var mo = String(date.getMonth() + 1).padStart(2, '0');
      var d = String(date.getDate()).padStart(2, '0');
      var h = String(date.getHours()).padStart(2, '0');
      var mi = String(date.getMinutes()).padStart(2, '0');
      var s = String(date.getSeconds()).padStart(2, '0');
      return y + '-' + mo + '-' + d + ' ' + h + ':' + mi + ':' + s;
    } catch (err) {
      return new Date().toISOString();
    }
  }

  /** @private */
  _getDateStr(date) {
    try {
      var y = date.getFullYear();
      var mo = String(date.getMonth() + 1).padStart(2, '0');
      var d = String(date.getDate()).padStart(2, '0');
      return y + '-' + mo + '-' + d;
    } catch (err) {
      return 'unknown';
    }
  }

  /** @private */
  _ensureLogDir() {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
    } catch (err) {
      // ignore
    }
  }

  /** @private */
  _writeToFile(date, formatted) {
    try {
      var dateStr = this._getDateStr(date);
      var filePath = path.join(this.logDir, 'aries-' + dateStr + '.log');
      fs.appendFileSync(filePath, formatted + '\n');
    } catch (err) {
      // ignore file write errors
    }
  }

  /** @private */
  _rotateOldLogs() {
    try {
      var files = fs.readdirSync(this.logDir);
      var cutoff = Date.now() - (this.maxDays * 24 * 60 * 60 * 1000);
      for (var i = 0; i < files.length; i++) {
        var f = files[i];
        if (!f.startsWith('aries-') || !f.endsWith('.log')) continue;
        var dateStr = f.replace('aries-', '').replace('.log', '');
        var fileDate = new Date(dateStr);
        if (isNaN(fileDate.getTime())) continue;
        if (fileDate.getTime() < cutoff) {
          try {
            fs.unlinkSync(path.join(this.logDir, f));
          } catch (err) {
            // ignore
          }
        }
      }
    } catch (err) {
      // ignore
    }
  }
}

/**
 * @class ChildLogger
 * A child logger that prefixes all messages with a module name.
 */
class ChildLogger {
  /**
   * @param {Logger} parent
   * @param {string} moduleName
   */
  constructor(parent, moduleName) {
    this._parent = parent;
    this._module = moduleName;
  }

  /** @param {string} msg */
  debug(msg) { try { this._parent.log('debug', this._module, msg); } catch (e) {} }

  /** @param {string} msg */
  info(msg) { try { this._parent.log('info', this._module, msg); } catch (e) {} }

  /** @param {string} msg */
  warn(msg) { try { this._parent.log('warn', this._module, msg); } catch (e) {} }

  /**
   * @param {string} msg
   * @param {Error} [err]
   */
  error(msg, err) { try { this._parent.log('error', this._module, msg, err); } catch (e) {} }

  /**
   * @param {string} msg
   * @param {Error} [err]
   */
  fatal(msg, err) { try { this._parent.log('fatal', this._module, msg, err); } catch (e) {} }
}

// Singleton default logger
const defaultLogger = new Logger();

module.exports = { Logger, ChildLogger, defaultLogger };
