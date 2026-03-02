/**
 * Event Query Optimizer — Compiled filter & dispatch tree for Aries
 * Inspired by Goldrush (Erlang) query reduction pipeline.
 * Routes events through compiled dispatch functions instead of O(n) listener iteration.
 * @module core/event-query-optimizer
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Filter node types
const F = { EQ: 'eq', NEQ: 'neq', GT: 'gt', LT: 'lt', GTE: 'gte', LTE: 'lte', WC: 'wc', NF: 'nf', REGEX: 'regex', ALL: 'all', ANY: 'any', NOT: 'not' };

class EventQueryOptimizer extends EventEmitter {
  /**
   * @param {object} opts
   * @param {object} [opts.ai] - AI interface
   * @param {object} [opts.config] - Configuration overrides
   */
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null;
    this.config = Object.assign({
      dataDir: path.join(process.cwd(), 'data', 'event-optimizer'),
      checkpointIntervalMs: 5 * 60 * 1000,
      checkpointEveryN: 10000,
      maxCompileFnCache: 200
    }, opts.config);

    /** @type {Map<string, Map<string, {filter: object, handler: Function}>>} eventType → moduleId → reg */
    this.registrations = new Map();
    /** @type {Map<string, Function>} eventType → compiled dispatch fn */
    this.compiled = new Map();
    /** @type {Map<string, object>} eventType → optimized tree (for inspection) */
    this.trees = new Map();

    this.stats = { totalDispatches: 0, totalMatches: 0, totalTimeUs: 0, filterCount: 0, compiledAt: null, reductions: 0, dispatchesSinceCheckpoint: 0 };
    this._checkpointTimer = null;
    this._dirty = false;
  }

  // ═══════════════════════ Filter DSL (static) ═══════════════════════

  /** Field equals value */
  static eq(field, value) { return { type: F.EQ, field, value }; }
  /** Field not equals value */
  static neq(field, value) { return { type: F.NEQ, field, value }; }
  /** Field greater than */
  static gt(field, value) { return { type: F.GT, field, value }; }
  /** Field less than */
  static lt(field, value) { return { type: F.LT, field, value }; }
  /** Field >= value */
  static gte(field, value) { return { type: F.GTE, field, value }; }
  /** Field <= value */
  static lte(field, value) { return { type: F.LTE, field, value }; }
  /** Field exists (wildcard) */
  static wc(field) { return { type: F.WC, field }; }
  /** Field not found */
  static nf(field) { return { type: F.NF, field }; }
  /** Field matches regex */
  static regex(field, pattern) {
    const src = pattern instanceof RegExp ? pattern.source : String(pattern);
    const flags = pattern instanceof RegExp ? pattern.flags : '';
    return { type: F.REGEX, field, source: src, flags };
  }
  /** AND — all must match */
  static all(filters) { return { type: F.ALL, filters: Array.isArray(filters) ? filters : [filters] }; }
  /** OR — any must match */
  static any(filters) { return { type: F.ANY, filters: Array.isArray(filters) ? filters : [filters] }; }
  /** NOT — negate */
  static not(filter) { return { type: F.NOT, filter }; }

  // ═══════════════════════ Registration ═══════════════════════

  /**
   * Register a module's interest in an event type with a filter condition.
   * @param {string} moduleId
   * @param {string} eventType
   * @param {object} filter - Filter DSL node
   * @param {Function} handler - Called with (event, moduleId) on match
   */
  register(moduleId, eventType, filter, handler) {
    if (!this.registrations.has(eventType)) this.registrations.set(eventType, new Map());
    this.registrations.get(eventType).set(moduleId, { filter, handler });
    this._dirty = true;
  }

  /**
   * Unregister a module from one or all event types.
   * @param {string} moduleId
   * @param {string} [eventType] - If omitted, unregister from all
   */
  unregister(moduleId, eventType) {
    if (eventType) {
      const m = this.registrations.get(eventType);
      if (m) { m.delete(moduleId); if (m.size === 0) this.registrations.delete(eventType); }
      this.compiled.delete(eventType);
    } else {
      for (const [et, m] of this.registrations) {
        m.delete(moduleId);
        if (m.size === 0) this.registrations.delete(et);
        this.compiled.delete(et);
      }
    }
    this._dirty = true;
  }

  // ═══════════════════════ Optimization Pipeline ═══════════════════════

  /** Rebuild all compiled dispatch trees from current registrations. */
  compile() {
    let totalReductions = 0;
    let totalFilters = 0;

    for (const [eventType, modules] of this.registrations) {
      const entries = [];
      for (const [moduleId, reg] of modules) {
        entries.push({ moduleId, filter: reg.filter, handler: reg.handler });
      }
      totalFilters += entries.length;

      // Optimize: flatten, dedup, factor common
      const flattened = entries.map(e => ({ ...e, filter: this._flatten(e.filter) }));
      const { tree, reductions } = this._buildDispatchTree(flattened);
      totalReductions += reductions;

      this.trees.set(eventType, tree);
      const fn = this._compileDispatch(tree, entries);
      this.compiled.set(eventType, fn);

      this.emit('compiled', { eventType, filterCount: entries.length, reductions, compiledAt: Date.now() });
    }

    this.stats.filterCount = totalFilters;
    this.stats.reductions = totalReductions;
    this.stats.compiledAt = Date.now();
    this._dirty = false;

    this.emit('optimization', { before: totalFilters, after: totalFilters - totalReductions, reductionPct: totalFilters ? Math.round(totalReductions / totalFilters * 100) : 0 });
  }

  /**
   * Flatten nested all/any of same type, unwrap single-element wrappers.
   * @param {object} node
   * @returns {object}
   */
  _flatten(node) {
    if (!node || !node.type) return node;
    if (node.type === F.ALL || node.type === F.ANY) {
      let filters = node.filters.map(f => this._flatten(f));
      // Absorb same-type children
      const merged = [];
      for (const f of filters) {
        if (f.type === node.type) merged.push(...f.filters);
        else merged.push(f);
      }
      if (merged.length === 1) return merged[0];
      return { type: node.type, filters: merged };
    }
    if (node.type === F.NOT) return { type: F.NOT, filter: this._flatten(node.filter) };
    return node;
  }

  /**
   * Hash a filter node for deduplication.
   * @param {object} node
   * @returns {string}
   */
  _filterHash(node) {
    if (!node) return 'null';
    switch (node.type) {
      case F.ALL: return `all(${node.filters.map(f => this._filterHash(f)).sort().join(',')})`;
      case F.ANY: return `any(${node.filters.map(f => this._filterHash(f)).sort().join(',')})`;
      case F.NOT: return `not(${this._filterHash(node.filter)})`;
      case F.REGEX: return `regex(${node.field},/${node.source}/${node.flags})`;
      default: return `${node.type}(${node.field},${node.value !== undefined ? JSON.stringify(node.value) : ''})`;
    }
  }

  /**
   * Build an optimized dispatch tree by factoring common conditions.
   * @param {Array} entries - [{moduleId, filter, handler}]
   * @returns {{tree: object, reductions: number}}
   */
  _buildDispatchTree(entries) {
    if (entries.length <= 1) return { tree: { type: 'leaf', entries }, reductions: 0 };

    // Collect all leaf conditions per entry
    const entryConditions = entries.map(e => {
      const leaves = this._extractLeaves(e.filter);
      return { ...e, leaves, hashes: new Set(leaves.map(l => this._filterHash(l))) };
    });

    // Find conditions common to ALL entries
    let commonHashes = new Set(entryConditions[0].hashes);
    for (let i = 1; i < entryConditions.length; i++) {
      commonHashes = new Set([...commonHashes].filter(h => entryConditions[i].hashes.has(h)));
    }

    if (commonHashes.size === 0) return { tree: { type: 'leaf', entries }, reductions: 0 };

    // Extract the actual common filter nodes from first entry
    const commonFilters = [];
    const firstLeaves = this._extractLeaves(entryConditions[0].filter);
    const usedHashes = new Set();
    for (const leaf of firstLeaves) {
      const h = this._filterHash(leaf);
      if (commonHashes.has(h) && !usedHashes.has(h)) {
        commonFilters.push(leaf);
        usedHashes.add(h);
      }
    }

    // Remove common conditions from each entry's filter
    const reducedEntries = entryConditions.map(ec => {
      const reduced = this._removeConditions(ec.filter, commonHashes);
      return { moduleId: ec.moduleId, filter: reduced, handler: ec.handler };
    });

    const reductions = commonHashes.size * (entries.length - 1);

    return {
      tree: {
        type: 'guarded',
        guard: commonFilters.length === 1 ? commonFilters[0] : { type: F.ALL, filters: commonFilters },
        children: reducedEntries
      },
      reductions
    };
  }

  /** Extract all leaf (non-compound) filter nodes. */
  _extractLeaves(node) {
    if (!node) return [];
    if (node.type === F.ALL || node.type === F.ANY) {
      return node.filters.flatMap(f => this._extractLeaves(f));
    }
    if (node.type === F.NOT) return this._extractLeaves(node.filter);
    return [node];
  }

  /** Remove conditions matching given hashes from a filter tree. */
  _removeConditions(node, hashes) {
    if (!node) return null;
    if (node.type === F.ALL || node.type === F.ANY) {
      const remaining = node.filters
        .map(f => this._removeConditions(f, hashes))
        .filter(f => f !== null);
      if (remaining.length === 0) return null;
      if (remaining.length === 1) return remaining[0];
      return { type: node.type, filters: remaining };
    }
    if (node.type === F.NOT) {
      // Don't remove inside NOT
      return node;
    }
    return hashes.has(this._filterHash(node)) ? null : node;
  }

  /**
   * Compile a dispatch tree into an optimized function.
   * @param {object} tree
   * @param {Array} entries - original entries for handler references
   * @returns {Function} (event) => [{moduleId, handler}]
   */
  _compileDispatch(tree, entries) {
    // Build handler lookup
    const handlers = new Map();
    for (const e of entries) handlers.set(e.moduleId, e.handler);

    if (tree.type === 'leaf') {
      // No common factoring — test each individually
      const checks = tree.entries.map(e => ({
        moduleId: e.moduleId,
        test: this._compileFilter(e.filter),
        handler: e.handler
      }));
      return (event) => {
        const matched = [];
        for (const c of checks) {
          if (c.test(event)) matched.push({ moduleId: c.moduleId, handler: c.handler });
        }
        return matched;
      };
    }

    // Guarded tree: test guard first, then children
    const guardTest = this._compileFilter(tree.guard);
    const childChecks = tree.children.map(c => ({
      moduleId: c.moduleId,
      test: c.filter ? this._compileFilter(c.filter) : () => true,
      handler: handlers.get(c.moduleId) || c.handler
    }));

    return (event) => {
      if (!guardTest(event)) return [];
      const matched = [];
      for (const c of childChecks) {
        if (c.test(event)) matched.push({ moduleId: c.moduleId, handler: c.handler });
      }
      return matched;
    };
  }

  /**
   * Compile a single filter node into a predicate function.
   * @param {object} node
   * @returns {Function} (event) => boolean
   */
  _compileFilter(node) {
    if (!node) return () => true;
    switch (node.type) {
      case F.EQ: return (e) => this._getField(e, node.field) === node.value;
      case F.NEQ: return (e) => this._getField(e, node.field) !== node.value;
      case F.GT: return (e) => this._getField(e, node.field) > node.value;
      case F.LT: return (e) => this._getField(e, node.field) < node.value;
      case F.GTE: return (e) => this._getField(e, node.field) >= node.value;
      case F.LTE: return (e) => this._getField(e, node.field) <= node.value;
      case F.WC: return (e) => this._getField(e, node.field) !== undefined && this._getField(e, node.field) !== null;
      case F.NF: return (e) => this._getField(e, node.field) === undefined || this._getField(e, node.field) === null;
      case F.REGEX: {
        const re = new RegExp(node.source, node.flags);
        return (e) => { const v = this._getField(e, node.field); return typeof v === 'string' && re.test(v); };
      }
      case F.ALL: {
        const tests = node.filters.map(f => this._compileFilter(f));
        return (e) => { for (const t of tests) if (!t(e)) return false; return true; };
      }
      case F.ANY: {
        const tests = node.filters.map(f => this._compileFilter(f));
        return (e) => { for (const t of tests) if (t(e)) return true; return false; };
      }
      case F.NOT: {
        const inner = this._compileFilter(node.filter);
        return (e) => !inner(e);
      }
      default: return () => true;
    }
  }

  /** Resolve dotted field paths: 'a.b.c' → event.a.b.c */
  _getField(event, field) {
    if (!field.includes('.')) return event[field];
    const parts = field.split('.');
    let v = event;
    for (const p of parts) { if (v == null) return undefined; v = v[p]; }
    return v;
  }

  // ═══════════════════════ Dispatch ═══════════════════════

  /**
   * Route an event through the compiled dispatch tree.
   * @param {string} eventType
   * @param {object} event
   * @returns {Array<{moduleId: string}>} matched handlers (already invoked)
   */
  dispatch(eventType, event) {
    const start = process.hrtime.bigint();

    // Auto-compile if dirty
    if (this._dirty) this.compile();

    const fn = this.compiled.get(eventType);
    if (!fn) return [];

    const matched = fn(event);

    // Invoke handlers
    for (const m of matched) {
      try { m.handler(event, m.moduleId); } catch (err) { this.emit('error', { moduleId: m.moduleId, eventType, error: err }); }
    }

    const elapsed = Number(process.hrtime.bigint() - start) / 1000; // microseconds
    this.stats.totalDispatches++;
    this.stats.totalMatches += matched.length;
    this.stats.totalTimeUs += elapsed;
    this.stats.dispatchesSinceCheckpoint++;

    this.emit('dispatch', { eventType, matchCount: matched.length, timeUs: Math.round(elapsed) });

    // Auto-checkpoint
    if (this.stats.dispatchesSinceCheckpoint >= this.config.checkpointEveryN) {
      this.checkpoint().catch(() => {});
    }

    return matched.map(m => ({ moduleId: m.moduleId }));
  }

  // ═══════════════════════ Stats ═══════════════════════

  /** @returns {object} Current performance statistics */
  getStats() {
    return {
      ...this.stats,
      avgMatchTimeUs: this.stats.totalDispatches ? Math.round(this.stats.totalTimeUs / this.stats.totalDispatches) : 0,
      registeredEventTypes: this.registrations.size,
      registeredModules: new Set([...this.registrations.values()].flatMap(m => [...m.keys()])).size
    };
  }

  /**
   * Visualize the compiled filter tree.
   * @param {string} [eventType] - If omitted, returns all trees
   * @returns {object}
   */
  getFilterTree(eventType) {
    if (eventType) return this.trees.get(eventType) || null;
    const result = {};
    for (const [et, tree] of this.trees) result[et] = tree;
    return result;
  }

  // ═══════════════════════ Hot Reload ═══════════════════════

  /**
   * Recompile only branches affected by a specific module.
   * @param {string} moduleId
   */
  recompilePartial(moduleId) {
    const affected = [];
    for (const [eventType, modules] of this.registrations) {
      if (modules.has(moduleId)) {
        affected.push(eventType);
        // Recompile just this event type
        const entries = [];
        for (const [mid, reg] of modules) entries.push({ moduleId: mid, filter: this._flatten(reg.filter), handler: reg.handler });
        const { tree, reductions } = this._buildDispatchTree(entries);
        this.trees.set(eventType, tree);
        this.compiled.set(eventType, this._compileDispatch(tree, entries));
      }
    }
    this._dirty = false;
    this.emit('hot-reload', { moduleId, affected });
  }

  // ═══════════════════════ Antibody Integration ═══════════════════════

  /**
   * Bulk-register immune patterns, auto-optimizing overlapping regexes.
   * @param {Array<{id: string, pattern: RegExp|string, severity?: string}>} antibodyPatterns
   */
  registerAntibodies(antibodyPatterns) {
    for (const ab of antibodyPatterns) {
      const pat = ab.pattern instanceof RegExp ? ab.pattern : new RegExp(ab.pattern, 'i');
      this.register(
        `antibody:${ab.id}`,
        'thought',
        EventQueryOptimizer.all([
          EventQueryOptimizer.wc('content'),
          EventQueryOptimizer.regex('content', pat)
        ]),
        (event) => ({ antibodyId: ab.id, severity: ab.severity || 'medium', match: pat.exec(event.content) })
      );
    }
    this.compile();
  }

  /**
   * Optimized pathogen scan using compiled antibody tree.
   * @param {object} thought - { content: string, ... }
   * @returns {Array<{antibodyId: string, severity: string, match: any}>}
   */
  scanForPathogens(thought) {
    const fn = this.compiled.get('thought');
    if (!fn) return [];
    // Run compiled dispatch but collect results instead of side-effects
    const results = [];
    const matched = fn(thought);
    for (const m of matched) {
      if (m.moduleId.startsWith('antibody:')) {
        try { const r = m.handler(thought, m.moduleId); if (r) results.push(r); } catch (_) {}
      }
    }
    return results;
  }

  // ═══════════════════════ Economy Integration ═══════════════════════

  /**
   * Compile bidder requirements into a decision tree.
   * @param {Array<{bidderId: string, filter: object}>} auctionRules
   */
  registerAuctionFilters(auctionRules) {
    for (const rule of auctionRules) {
      this.register(`bidder:${rule.bidderId}`, 'auction', rule.filter, (event) => ({ bidderId: rule.bidderId, event }));
    }
    this.compile();
  }

  /**
   * Find matching bidders for a resource via compiled tree.
   * @param {object} resource
   * @returns {Array<string>} matching bidder IDs
   */
  matchBidders(resource) {
    const fn = this.compiled.get('auction');
    if (!fn) return [];
    return fn(resource).map(m => m.moduleId.replace('bidder:', ''));
  }

  // ═══════════════════════ Persistence ═══════════════════════

  /** Ensure data directory exists. */
  _ensureDir() {
    const dir = this.config.dataDir;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  /** Read JSON file or return default. */
  _readJSON(filename, def = null) {
    try {
      const fp = path.join(this.config.dataDir, filename);
      return JSON.parse(fs.readFileSync(fp, 'utf8'));
    } catch { return def; }
  }

  /** Write JSON file. */
  _writeJSON(filename, data) {
    this._ensureDir();
    fs.writeFileSync(path.join(this.config.dataDir, filename), JSON.stringify(data, null, 2));
  }

  /**
   * Checkpoint current registrations and stats to disk.
   * Handlers are not serialized — only filter structures and module IDs.
   */
  async checkpoint() {
    const regs = {};
    for (const [eventType, modules] of this.registrations) {
      regs[eventType] = {};
      for (const [moduleId, reg] of modules) {
        regs[eventType][moduleId] = { filter: reg.filter };
      }
    }
    this._writeJSON('registrations.json', regs);
    this._writeJSON('stats.json', this.stats);
    this._writeJSON('checkpoints.json', { timestamp: Date.now(), registrations: regs });
    this.stats.dispatchesSinceCheckpoint = 0;
    this.emit('checkpoint', { registrations: Object.keys(regs).length, timestamp: Date.now() });
  }

  /**
   * Restore registrations from last checkpoint.
   * Note: handlers must be re-registered by modules — only filter structures are restored.
   * @returns {object|null} Restored registration structure (without handlers)
   */
  restore() {
    const data = this._readJSON('checkpoints.json');
    if (!data) return null;
    const savedStats = this._readJSON('stats.json');
    if (savedStats) Object.assign(this.stats, savedStats);
    return data.registrations;
  }

  /** Start auto-checkpoint timer. */
  startAutoCheckpoint() {
    if (this._checkpointTimer) return;
    this._checkpointTimer = setInterval(() => this.checkpoint().catch(() => {}), this.config.checkpointIntervalMs);
    if (this._checkpointTimer.unref) this._checkpointTimer.unref();
  }

  /** Stop auto-checkpoint timer. */
  stopAutoCheckpoint() {
    if (this._checkpointTimer) { clearInterval(this._checkpointTimer); this._checkpointTimer = null; }
  }
}

module.exports = EventQueryOptimizer;
