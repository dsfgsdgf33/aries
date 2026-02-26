'use strict';

const crypto = require('crypto');

class ShellCache {
  constructor(opts = {}) {
    this._cache = new Map();
    this._maxSize = opts.maxSize || 500;
    this._defaultTtl = opts.defaultTtl || 60000;
    this._hits = 0;
    this._misses = 0;
  }

  _hash(command) {
    return crypto.createHash('sha256').update(String(command).trim()).digest('hex');
  }

  _evict() {
    if (this._cache.size <= this._maxSize) return;
    // Remove oldest entries
    const entries = [...this._cache.entries()]
      .sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toRemove = entries.slice(0, entries.length - this._maxSize);
    for (const [key] of toRemove) {
      this._cache.delete(key);
    }
  }

  get(command) {
    const key = this._hash(command);
    const entry = this._cache.get(key);
    if (!entry) {
      this._misses++;
      return null;
    }
    if (Date.now() > entry.timestamp + entry.ttl) {
      this._cache.delete(key);
      this._misses++;
      return null;
    }
    this._hits++;
    return {
      command: entry.command,
      result: entry.result,
      timestamp: entry.timestamp,
      age: Date.now() - entry.timestamp,
    };
  }

  set(command, result, ttlMs) {
    const key = this._hash(command);
    this._cache.set(key, {
      command: String(command).trim(),
      result,
      timestamp: Date.now(),
      ttl: ttlMs || this._defaultTtl,
    });
    this._evict();
  }

  clear() {
    this._cache.clear();
    this._hits = 0;
    this._misses = 0;
  }

  getStats() {
    const total = this._hits + this._misses;
    return {
      size: this._cache.size,
      maxSize: this._maxSize,
      hits: this._hits,
      misses: this._misses,
      hitRate: total > 0 ? (this._hits / total * 100).toFixed(1) + '%' : 'N/A',
      defaultTtl: this._defaultTtl,
    };
  }

  has(command) {
    return this.get(command) !== null;
  }

  delete(command) {
    return this._cache.delete(this._hash(command));
  }
}

const instance = new ShellCache();

module.exports = {
  get: (cmd) => instance.get(cmd),
  set: (cmd, result, ttl) => instance.set(cmd, result, ttl),
  clear: () => instance.clear(),
  getStats: () => instance.getStats(),
  has: (cmd) => instance.has(cmd),
  delete: (cmd) => instance.delete(cmd),
  ShellCache,
};
