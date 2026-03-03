/**
 * hot-reload.js — Hot Reload System for Aries AI Platform
 * Reload modules at runtime without restarting the server.
 * Zero npm deps. Node.js built-ins only.
 */

'use strict';

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data', 'hot-reload');

class HotReload extends EventEmitter {
  constructor(opts) {
    super();
    this._opts = opts || {};
    this._registry = new Map();       // moduleName -> { filePath, instance, opts, status, reloadCount, lastReload, lastError, avgReloadMs }
    this._watchers = new Map();        // filePath -> fs.FSWatcher
    this._watching = false;
    this._debounceTimers = new Map();
    this._debounceDuration = this._opts.debounce || 500;
    this._history = [];                // { ts, module, action, success, durationMs, error? }
    this._stats = { totalReloads: 0, totalFailures: 0, totalReloadMs: 0 };
    this._maxHistory = this._opts.maxHistory || 500;

    this._ensureDataDir();
    this._loadHistory();
  }

  // ══════════════════════════════════════════
  // DATA PERSISTENCE
  // ══════════════════════════════════════════

  _ensureDataDir() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
    } catch (e) { /* ignore */ }
  }

  _historyFile() {
    return path.join(DATA_DIR, 'reload-history.json');
  }

  _loadHistory() {
    try {
      if (fs.existsSync(this._historyFile())) {
        const raw = fs.readFileSync(this._historyFile(), 'utf8');
        const data = JSON.parse(raw);
        this._history = Array.isArray(data.history) ? data.history : [];
        if (data.stats) {
          this._stats.totalReloads = data.stats.totalReloads || 0;
          this._stats.totalFailures = data.stats.totalFailures || 0;
          this._stats.totalReloadMs = data.stats.totalReloadMs || 0;
        }
      }
    } catch (e) { /* fresh start */ }
  }

  _saveHistory() {
    try {
      this._ensureDataDir();
      const trimmed = this._history.slice(-this._maxHistory);
      fs.writeFileSync(this._historyFile(), JSON.stringify({
        stats: this._stats,
        history: trimmed,
        savedAt: new Date().toISOString()
      }, null, 2), 'utf8');
    } catch (e) { /* ignore */ }
  }

  _addHistory(entry) {
    this._history.push(entry);
    if (this._history.length > this._maxHistory) {
      this._history = this._history.slice(-this._maxHistory);
    }
    this._saveHistory();
  }

  // ══════════════════════════════════════════
  // MODULE REGISTRATION
  // ══════════════════════════════════════════

  /**
   * Register a module for hot-reloading.
   * @param {string} name - Unique module name
   * @param {string} filePath - Absolute path to the module file
   * @param {object} instance - The loaded module instance
   * @param {object} opts - Original options used to configure the module
   */
  register(name, filePath, instance, opts) {
    const resolved = path.resolve(filePath);
    this._registry.set(name, {
      name: name,
      filePath: resolved,
      instance: instance,
      opts: opts || {},
      status: 'loaded',
      reloadCount: 0,
      lastReload: null,
      lastError: null,
      avgReloadMs: 0,
      totalReloadMs: 0,
      registeredAt: new Date().toISOString()
    });
    return this;
  }

  /**
   * Unregister a module from hot-reload tracking.
   */
  unregister(name) {
    const entry = this._registry.get(name);
    if (!entry) return false;
    this._registry.delete(name);
    return true;
  }

  // ══════════════════════════════════════════
  // CORE RELOAD
  // ══════════════════════════════════════════

  /**
   * Reload a single module by name.
   * Preserves state via serialize/deserialize if available.
   * On failure, keeps old module running.
   */
  reload(moduleName) {
    const entry = this._registry.get(moduleName);
    if (!entry) {
      return { success: false, error: 'Module not found: ' + moduleName };
    }

    const startTime = Date.now();
    this.emit('reload-start', { module: moduleName, timestamp: new Date().toISOString() });

    // 1. Serialize state if module supports it
    let savedState = null;
    let statePreserved = false;
    try {
      if (entry.instance && typeof entry.instance.serialize === 'function') {
        savedState = entry.instance.serialize();
        statePreserved = true;
      }
    } catch (serErr) {
      // Non-fatal: proceed without state
      savedState = null;
    }

    // 2. Teardown old module if it has cleanup
    try {
      if (entry.instance && typeof entry.instance.shutdown === 'function') {
        entry.instance.shutdown();
      } else if (entry.instance && typeof entry.instance.destroy === 'function') {
        entry.instance.destroy();
      } else if (entry.instance && typeof entry.instance.stop === 'function') {
        entry.instance.stop();
      }
    } catch (cleanupErr) {
      // Non-fatal
    }

    // 3. Clear require cache
    const resolvedPath = this._resolveRequirePath(entry.filePath);
    if (resolvedPath) {
      this._clearRequireCache(resolvedPath);
    }

    // 4. Re-require and re-instantiate
    try {
      const ModuleClass = require(entry.filePath);
      let newInstance;

      if (typeof ModuleClass === 'function') {
        // It's a constructor/class
        try {
          newInstance = new ModuleClass(entry.opts);
        } catch (constructErr) {
          // Maybe it's a plain function, not a constructor
          newInstance = ModuleClass;
        }
      } else {
        newInstance = ModuleClass;
      }

      // 5. Deserialize state
      if (savedState !== null && newInstance && typeof newInstance.deserialize === 'function') {
        try {
          newInstance.deserialize(savedState);
          this.emit('state-preserved', { module: moduleName, timestamp: new Date().toISOString() });
        } catch (deserErr) {
          // State restoration failed - non-fatal
        }
      }

      // 6. Update registry
      const durationMs = Date.now() - startTime;
      entry.instance = newInstance;
      entry.status = 'loaded';
      entry.reloadCount++;
      entry.lastReload = new Date().toISOString();
      entry.lastError = null;
      entry.totalReloadMs += durationMs;
      entry.avgReloadMs = Math.round(entry.totalReloadMs / entry.reloadCount);

      this._stats.totalReloads++;
      this._stats.totalReloadMs += durationMs;

      const histEntry = {
        ts: new Date().toISOString(),
        module: moduleName,
        action: 'reload',
        success: true,
        durationMs: durationMs,
        statePreserved: statePreserved
      };
      this._addHistory(histEntry);

      this.emit('reload-complete', {
        module: moduleName,
        durationMs: durationMs,
        statePreserved: statePreserved,
        reloadCount: entry.reloadCount,
        timestamp: new Date().toISOString()
      });

      return { success: true, module: moduleName, durationMs: durationMs, statePreserved: statePreserved, reloadCount: entry.reloadCount };

    } catch (reloadErr) {
      // KEEP OLD MODULE - reload failed
      const durationMs = Date.now() - startTime;
      entry.status = 'error';
      entry.lastError = reloadErr.message;

      this._stats.totalFailures++;

      // Re-register require cache with old module if possible
      if (resolvedPath && entry.instance) {
        try {
          require.cache[resolvedPath] = { id: resolvedPath, filename: resolvedPath, loaded: true, exports: entry.instance.constructor || entry.instance };
        } catch (e) { /* best effort */ }
      }

      const histEntry = {
        ts: new Date().toISOString(),
        module: moduleName,
        action: 'reload',
        success: false,
        durationMs: durationMs,
        error: reloadErr.message
      };
      this._addHistory(histEntry);

      this.emit('reload-error', {
        module: moduleName,
        error: reloadErr.message,
        durationMs: durationMs,
        timestamp: new Date().toISOString()
      });

      return { success: false, module: moduleName, error: reloadErr.message, durationMs: durationMs };
    }
  }

  /**
   * Reload all registered modules in dependency order if available.
   */
  reloadAll() {
    const results = [];
    let order = Array.from(this._registry.keys());

    // Try to use module-dependency-graph for ordering
    try {
      const MDG = require('./module-dependency-graph');
      const depGraph = new MDG();
      if (depGraph.modules && depGraph.modules.size === 0 && typeof depGraph.loadDefaults === 'function') {
        depGraph.loadDefaults();
      }
      if (typeof depGraph.getTickOrder === 'function') {
        const tickOrder = depGraph.getTickOrder();
        if (Array.isArray(tickOrder) && tickOrder.length > 0) {
          // Filter to only registered modules, preserving dependency order
          const registeredNames = new Set(this._registry.keys());
          const ordered = tickOrder.filter(function(m) { return registeredNames.has(m); });
          // Add any registered modules not in the dependency graph
          const remaining = order.filter(function(m) { return !tickOrder.includes(m); });
          order = ordered.concat(remaining);
        }
      }
    } catch (e) {
      // No dependency graph - reload in registration order
    }

    this.emit('reload-start', { module: '*', action: 'reload-all', count: order.length, timestamp: new Date().toISOString() });

    for (var i = 0; i < order.length; i++) {
      var result = this.reload(order[i]);
      results.push(result);
    }

    var succeeded = results.filter(function(r) { return r.success; }).length;
    var failed = results.filter(function(r) { return !r.success; }).length;

    return {
      total: results.length,
      succeeded: succeeded,
      failed: failed,
      results: results
    };
  }

  // ══════════════════════════════════════════
  // FILE WATCHING
  // ══════════════════════════════════════════

  /**
   * Start watching for file changes in core/ directory.
   */
  startWatching(watchPaths) {
    if (this._watching) return { watching: true, message: 'Already watching' };

    var self = this;
    var paths = watchPaths || [path.join(__dirname)]; // default: core/

    paths.forEach(function(watchPath) {
      try {
        var resolved = path.resolve(watchPath);
        if (!fs.existsSync(resolved)) return;

        var watcher = fs.watch(resolved, { recursive: false }, function(eventType, filename) {
          if (!filename || !filename.endsWith('.js')) return;

          self.emit('watch-change', { file: filename, eventType: eventType, dir: resolved, timestamp: new Date().toISOString() });

          // Debounce
          var key = path.join(resolved, filename);
          if (self._debounceTimers.has(key)) {
            clearTimeout(self._debounceTimers.get(key));
          }

          self._debounceTimers.set(key, setTimeout(function() {
            self._debounceTimers.delete(key);
            self._onFileChanged(resolved, filename);
          }, self._debounceDuration));
        });

        self._watchers.set(resolved, watcher);
      } catch (e) {
        // Can't watch this path
      }
    });

    this._watching = true;

    var histEntry = {
      ts: new Date().toISOString(),
      module: '*',
      action: 'watch-start',
      success: true,
      durationMs: 0,
      paths: paths
    };
    this._addHistory(histEntry);

    return { watching: true, paths: paths, watcherCount: this._watchers.size };
  }

  /**
   * Stop watching for file changes.
   */
  stopWatching() {
    this._watchers.forEach(function(watcher, key) {
      try { watcher.close(); } catch (e) { /* ignore */ }
    });
    this._watchers.clear();

    this._debounceTimers.forEach(function(timer) {
      clearTimeout(timer);
    });
    this._debounceTimers.clear();

    this._watching = false;

    var histEntry = {
      ts: new Date().toISOString(),
      module: '*',
      action: 'watch-stop',
      success: true,
      durationMs: 0
    };
    this._addHistory(histEntry);

    return { watching: false };
  }

  /**
   * Handle a file change event - find matching module and reload it.
   */
  _onFileChanged(dir, filename) {
    var fullPath = path.join(dir, filename);
    var found = false;

    this._registry.forEach(function(entry, name) {
      if (path.normalize(entry.filePath) === path.normalize(fullPath)) {
        found = true;
        this.reload(name);
      }
    }.bind(this));

    if (!found) {
      // Log unmatched change
      this._addHistory({
        ts: new Date().toISOString(),
        module: filename,
        action: 'file-changed-unmatched',
        success: true,
        durationMs: 0
      });
    }
  }

  // ══════════════════════════════════════════
  // REQUIRE CACHE MANAGEMENT
  // ══════════════════════════════════════════

  _resolveRequirePath(filePath) {
    try {
      return require.resolve(filePath);
    } catch (e) {
      return null;
    }
  }

  _clearRequireCache(resolvedPath) {
    if (!resolvedPath) return;

    var cached = require.cache[resolvedPath];
    if (!cached) return;

    // Remove from parent's children
    if (cached.parent && cached.parent.children) {
      cached.parent.children = cached.parent.children.filter(function(child) {
        return child.id !== resolvedPath;
      });
    }

    // Delete from cache
    delete require.cache[resolvedPath];
  }

  // ══════════════════════════════════════════
  // REGISTRY & STATS
  // ══════════════════════════════════════════

  /**
   * Get the full registry of reloadable modules.
   */
  getRegistry() {
    var modules = [];
    this._registry.forEach(function(entry, name) {
      modules.push({
        name: name,
        filePath: entry.filePath,
        status: entry.status,
        reloadCount: entry.reloadCount,
        lastReload: entry.lastReload,
        lastError: entry.lastError,
        avgReloadMs: entry.avgReloadMs,
        registeredAt: entry.registeredAt,
        hasSerialize: !!(entry.instance && typeof entry.instance.serialize === 'function'),
        hasDeserialize: !!(entry.instance && typeof entry.instance.deserialize === 'function')
      });
    });
    return modules;
  }

  /**
   * Get reload statistics.
   */
  getStats() {
    var avgMs = this._stats.totalReloads > 0
      ? Math.round(this._stats.totalReloadMs / this._stats.totalReloads)
      : 0;

    return {
      totalReloads: this._stats.totalReloads,
      totalFailures: this._stats.totalFailures,
      successRate: this._stats.totalReloads > 0
        ? Math.round(((this._stats.totalReloads - this._stats.totalFailures) / this._stats.totalReloads) * 100)
        : 100,
      avgReloadMs: avgMs,
      totalReloadMs: this._stats.totalReloadMs,
      registeredModules: this._registry.size,
      watching: this._watching,
      watcherCount: this._watchers.size,
      historyCount: this._history.length
    };
  }

  /**
   * Get reload history.
   */
  getHistory(limit) {
    var max = limit || 100;
    return this._history.slice(-max).reverse();
  }

  /**
   * Get a specific module's instance (useful after reload).
   */
  getInstance(name) {
    var entry = this._registry.get(name);
    return entry ? entry.instance : null;
  }

  /**
   * Auto-discover and register all core modules.
   */
  discoverModules() {
    var coreDir = path.join(__dirname);
    var registered = 0;

    try {
      var files = fs.readdirSync(coreDir);
      for (var i = 0; i < files.length; i++) {
        var file = files[i];
        if (!file.endsWith('.js')) continue;
        if (file === 'hot-reload.js') continue; // Don't register self

        var moduleName = file.replace('.js', '');
        if (this._registry.has(moduleName)) continue; // Already registered

        var filePath = path.join(coreDir, file);
        try {
          var mod = require(filePath);
          var instance = null;

          if (typeof mod === 'function') {
            try { instance = new mod(); } catch (e) { instance = mod; }
          } else {
            instance = mod;
          }

          this.register(moduleName, filePath, instance, {});
          registered++;
        } catch (e) {
          // Module failed to load - register as errored
          this._registry.set(moduleName, {
            name: moduleName,
            filePath: filePath,
            instance: null,
            opts: {},
            status: 'error',
            reloadCount: 0,
            lastReload: null,
            lastError: e.message,
            avgReloadMs: 0,
            totalReloadMs: 0,
            registeredAt: new Date().toISOString()
          });
        }
      }
    } catch (e) { /* ignore */ }

    return { discovered: registered, total: this._registry.size };
  }

  /**
   * Get status summary.
   */
  getStatus() {
    var loaded = 0, errored = 0;
    this._registry.forEach(function(entry) {
      if (entry.status === 'loaded') loaded++;
      else if (entry.status === 'error') errored++;
    });

    return {
      registered: this._registry.size,
      loaded: loaded,
      errored: errored,
      watching: this._watching,
      watcherCount: this._watchers.size,
      stats: this.getStats()
    };
  }

  /**
   * Clear all history.
   */
  clearHistory() {
    this._history = [];
    this._stats = { totalReloads: 0, totalFailures: 0, totalReloadMs: 0 };
    this._saveHistory();
    return { cleared: true };
  }

  /**
   * Shutdown - stop watching and clean up.
   */
  shutdown() {
    this.stopWatching();
    this._saveHistory();
    this.removeAllListeners();
  }
}

module.exports = HotReload;
