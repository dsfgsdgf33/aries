/**
 * shared-memory-store.js — Fast in-memory store with periodic disk flush
 * Replaces per-module synchronous JSON reads with O(1) memory lookups.
 * Singleton pattern — require() always returns the same instance.
 */

'use strict';

const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data', 'store');

class SharedMemoryStore extends EventEmitter {
  constructor(opts = {}) {
    super();
    this._dataDir = opts.dataDir || DATA_DIR;
    this._autoFlushMs = opts.autoFlushMs || 5000;
    this._memoryThreshold = opts.memoryThreshold || 100 * 1024 * 1024; // 100MB

    // Map<namespace, Map<key, value>>
    this._store = new Map();
    // Set<namespace> — namespaces with unflushed changes
    this._dirty = new Set();
    // Map<namespace, number> — last access timestamp for LRU eviction
    this._lastAccess = new Map();
    // Map<namespace, Promise> — serialized flush per namespace
    this._flushLocks = new Map();

    // Stats
    this._stats = {
      flushCount: 0,
      totalFlushMs: 0,
      hits: 0,
      misses: 0,
    };

    this._autoFlushTimer = null;

    // Ensure data directory exists
    try {
      fs.mkdirSync(this._dataDir, { recursive: true });
    } catch (e) {
      // ignore if exists
    }
  }

  // ════════════════════════════════════════
  //  Core Operations
  // ════════════════════════════════════════

  get(namespace, key, fallback) {
    const ns = this._store.get(namespace);
    if (!ns) {
      this._stats.misses++;
      return fallback;
    }
    this._lastAccess.set(namespace, Date.now());
    if (!ns.has(key)) {
      this._stats.misses++;
      return fallback;
    }
    this._stats.hits++;
    return ns.get(key);
  }

  set(namespace, key, value) {
    let ns = this._store.get(namespace);
    if (!ns) {
      ns = new Map();
      this._store.set(namespace, ns);
    }
    ns.set(key, value);
    this._dirty.add(namespace);
    this._lastAccess.set(namespace, Date.now());
    this._checkMemoryPressure();
    return this;
  }

  delete(namespace, key) {
    const ns = this._store.get(namespace);
    if (!ns) return false;
    const had = ns.delete(key);
    if (had) {
      this._dirty.add(namespace);
      this._lastAccess.set(namespace, Date.now());
    }
    return had;
  }

  has(namespace, key) {
    const ns = this._store.get(namespace);
    if (!ns) return false;
    this._lastAccess.set(namespace, Date.now());
    return ns.has(key);
  }

  getNamespace(namespace) {
    const ns = this._store.get(namespace);
    if (!ns) return {};
    this._lastAccess.set(namespace, Date.now());
    const obj = {};
    for (const [k, v] of ns) obj[k] = v;
    return obj;
  }

  setNamespace(namespace, data) {
    const ns = new Map();
    if (data && typeof data === 'object') {
      for (const [k, v] of Object.entries(data)) {
        ns.set(k, v);
      }
    }
    this._store.set(namespace, ns);
    this._dirty.add(namespace);
    this._lastAccess.set(namespace, Date.now());
    this._checkMemoryPressure();
    return this;
  }

  // ════════════════════════════════════════
  //  Batch Operations
  // ════════════════════════════════════════

  mget(namespace, keys) {
    const ns = this._store.get(namespace);
    if (!ns) {
      this._stats.misses += keys.length;
      return keys.map(() => undefined);
    }
    this._lastAccess.set(namespace, Date.now());
    return keys.map(k => {
      if (ns.has(k)) { this._stats.hits++; return ns.get(k); }
      this._stats.misses++;
      return undefined;
    });
  }

  mset(namespace, entries) {
    let ns = this._store.get(namespace);
    if (!ns) {
      ns = new Map();
      this._store.set(namespace, ns);
    }
    for (const [k, v] of Object.entries(entries)) {
      ns.set(k, v);
    }
    this._dirty.add(namespace);
    this._lastAccess.set(namespace, Date.now());
    this._checkMemoryPressure();
    return this;
  }

  // ════════════════════════════════════════
  //  Persistence
  // ════════════════════════════════════════

  _nsPath(namespace) {
    // Sanitize namespace to prevent path traversal
    const safe = String(namespace).replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this._dataDir, `${safe}.json`);
  }

  async flush(namespace) {
    if (namespace) {
      return this._flushOne(namespace);
    }
    const promises = [];
    for (const ns of this._dirty) {
      promises.push(this._flushOne(ns));
    }
    await Promise.all(promises);
  }

  async _flushOne(namespace) {
    if (!this._dirty.has(namespace)) return;

    // Serialize flushes per namespace
    const prev = this._flushLocks.get(namespace) || Promise.resolve();
    const p = prev.then(() => this._doFlush(namespace)).catch(() => {});
    this._flushLocks.set(namespace, p);
    return p;
  }

  async _doFlush(namespace) {
    if (!this._dirty.has(namespace)) return;
    const ns = this._store.get(namespace);
    if (!ns) {
      this._dirty.delete(namespace);
      return;
    }

    const start = Date.now();
    const obj = {};
    for (const [k, v] of ns) obj[k] = v;
    const json = JSON.stringify(obj, null, 2);
    const filePath = this._nsPath(namespace);

    await fs.promises.writeFile(filePath, json, 'utf8');
    this._dirty.delete(namespace);

    const durationMs = Date.now() - start;
    this._stats.flushCount++;
    this._stats.totalFlushMs += durationMs;

    this.emit('flush', { namespace, keys: ns.size, durationMs });
  }

  flushSync(namespace) {
    const namespaces = namespace ? [namespace] : [...this._dirty];
    for (const ns of namespaces) {
      if (!this._dirty.has(ns)) continue;
      const data = this._store.get(ns);
      if (!data) { this._dirty.delete(ns); continue; }

      const obj = {};
      for (const [k, v] of data) obj[k] = v;

      const start = Date.now();
      fs.writeFileSync(this._nsPath(ns), JSON.stringify(obj, null, 2), 'utf8');
      this._dirty.delete(ns);

      const durationMs = Date.now() - start;
      this._stats.flushCount++;
      this._stats.totalFlushMs += durationMs;
      this.emit('flush', { namespace: ns, keys: data.size, durationMs });
    }
  }

  load(namespace) {
    const filePath = this._nsPath(namespace);
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const obj = JSON.parse(raw);
      const ns = new Map();
      for (const [k, v] of Object.entries(obj)) {
        ns.set(k, v);
      }
      this._store.set(namespace, ns);
      this._lastAccess.set(namespace, Date.now());
      this.emit('load', { namespace, keys: ns.size });
      return true;
    } catch (e) {
      return false;
    }
  }

  loadAll() {
    let loaded = 0;
    try {
      const files = fs.readdirSync(this._dataDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const namespace = file.slice(0, -5);
        if (this.load(namespace)) loaded++;
      }
    } catch (e) {
      // directory may not exist yet
    }
    return loaded;
  }

  // ════════════════════════════════════════
  //  Auto-flush
  // ════════════════════════════════════════

  startAutoFlush(intervalMs) {
    this.stopAutoFlush();
    const ms = intervalMs || this._autoFlushMs;
    this._autoFlushTimer = setInterval(() => {
      if (this._dirty.size > 0) {
        this.flush().catch(() => {});
      }
    }, ms);
    if (this._autoFlushTimer.unref) this._autoFlushTimer.unref();
    return this;
  }

  stopAutoFlush() {
    if (this._autoFlushTimer) {
      clearInterval(this._autoFlushTimer);
      this._autoFlushTimer = null;
    }
    return this;
  }

  // ════════════════════════════════════════
  //  Migration Helper
  // ════════════════════════════════════════

  migrateNamespace(namespace, jsonFilePath) {
    try {
      const raw = fs.readFileSync(jsonFilePath, 'utf8');
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        this.setNamespace(namespace, obj);
        return { migrated: true, keys: Object.keys(obj).length };
      }
      // If it's an array or primitive, store as single key
      this.set(namespace, '_data', obj);
      return { migrated: true, keys: 1 };
    } catch (e) {
      return { migrated: false, error: e.message };
    }
  }

  // ════════════════════════════════════════
  //  Stats
  // ════════════════════════════════════════

  getStats() {
    let totalKeys = 0;
    for (const ns of this._store.values()) totalKeys += ns.size;

    const totalRequests = this._stats.hits + this._stats.misses;
    return {
      namespaces: this._store.size,
      totalKeys,
      dirtyNamespaces: this._dirty.size,
      dirtyList: [...this._dirty],
      flushCount: this._stats.flushCount,
      avgFlushMs: this._stats.flushCount > 0
        ? Math.round(this._stats.totalFlushMs / this._stats.flushCount * 100) / 100
        : 0,
      hitRate: totalRequests > 0
        ? Math.round(this._stats.hits / totalRequests * 10000) / 100
        : 0,
      hits: this._stats.hits,
      misses: this._stats.misses,
      autoFlush: !!this._autoFlushTimer,
    };
  }

  getMemoryUsage() {
    let bytes = 0;
    for (const [nsName, ns] of this._store) {
      bytes += nsName.length * 2; // rough string size
      for (const [k, v] of ns) {
        bytes += k.length * 2;
        try {
          bytes += JSON.stringify(v).length * 2;
        } catch {
          bytes += 256; // fallback estimate
        }
      }
    }
    return bytes;
  }

  getNamespaceDetails() {
    const details = [];
    for (const [name, ns] of this._store) {
      details.push({
        name,
        keys: ns.size,
        dirty: this._dirty.has(name),
        lastAccess: this._lastAccess.get(name) || null,
      });
    }
    details.sort((a, b) => b.keys - a.keys);
    return details;
  }

  // ════════════════════════════════════════
  //  Cache / LRU Eviction
  // ════════════════════════════════════════

  evictStale(maxAgeMs) {
    const threshold = maxAgeMs || 3600000; // 1 hour default
    const now = Date.now();
    let evicted = 0;

    for (const [namespace, lastAccess] of this._lastAccess) {
      if (now - lastAccess > threshold) {
        // Flush before evicting if dirty
        if (this._dirty.has(namespace)) {
          this.flushSync(namespace);
        }
        this._store.delete(namespace);
        this._lastAccess.delete(namespace);
        this._flushLocks.delete(namespace);
        evicted++;
        this.emit('evict', { namespace, reason: 'stale', ageMs: now - lastAccess });
      }
    }
    return evicted;
  }

  // ════════════════════════════════════════
  //  Memory Pressure Detection
  // ════════════════════════════════════════

  _checkMemoryPressure() {
    const usage = this.getMemoryUsage();
    if (usage > this._memoryThreshold) {
      this.emit('memory-pressure', { usageBytes: usage, threshold: this._memoryThreshold });
      // Auto-evict oldest 25% of namespaces
      const sorted = [...this._lastAccess.entries()].sort((a, b) => a[1] - b[1]);
      const evictCount = Math.max(1, Math.floor(sorted.length * 0.25));
      for (let i = 0; i < evictCount && i < sorted.length; i++) {
        const ns = sorted[i][0];
        if (this._dirty.has(ns)) this.flushSync(ns);
        this._store.delete(ns);
        this._lastAccess.delete(ns);
        this._flushLocks.delete(ns);
        this.emit('evict', { namespace: ns, reason: 'memory-pressure' });
      }
    }
  }

  // ════════════════════════════════════════
  //  Shutdown
  // ════════════════════════════════════════

  shutdown() {
    this.stopAutoFlush();
    this.flushSync();
  }

  // ════════════════════════════════════════
  //  Utility
  // ════════════════════════════════════════

  clear(namespace) {
    if (namespace) {
      this._store.delete(namespace);
      this._dirty.delete(namespace);
      this._lastAccess.delete(namespace);
      this._flushLocks.delete(namespace);
      return;
    }
    this._store.clear();
    this._dirty.clear();
    this._lastAccess.clear();
    this._flushLocks.clear();
  }

  listNamespaces() {
    return [...this._store.keys()];
  }

  keys(namespace) {
    const ns = this._store.get(namespace);
    return ns ? [...ns.keys()] : [];
  }

  size(namespace) {
    if (namespace) {
      const ns = this._store.get(namespace);
      return ns ? ns.size : 0;
    }
    let total = 0;
    for (const ns of this._store.values()) total += ns.size;
    return total;
  }
}

// ════════════════════════════════════════
//  Singleton
// ════════════════════════════════════════

let _instance = null;

function getInstance(opts) {
  if (!_instance) {
    _instance = new SharedMemoryStore(opts);
  }
  return _instance;
}

module.exports = SharedMemoryStore;
module.exports.getInstance = getInstance;
module.exports.SharedMemoryStore = SharedMemoryStore;
