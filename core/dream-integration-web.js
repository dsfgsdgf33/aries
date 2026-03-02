/**
 * ARIES — Dream Integration Web v1.0
 * Cross-module glue connecting the Recursive Dream Engine to all AGI subsystems.
 * Dreams feed insights outward; external events seed new dreams inward.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const DATA_DIR = path.join(__dirname, '..', 'data', 'dream-integration');
const EVENTS_PATH = path.join(DATA_DIR, 'events.json');
const STATS_PATH = path.join(DATA_DIR, 'stats.json');
const MAX_EVENTS = 500;

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }

/** Energy cost per dream layer — deeper = cheaper (REM efficiency) */
const LAYER_ENERGY_COST = [10, 7, 4, 2, 1];
/** Qualia intensity per layer depth */
const LAYER_QUALIA_INTENSITY = [0.3, 0.5, 0.7, 0.9, 1.0];
/** Energy recovered on dream completion */
const DREAM_REST_RECOVERY = 8;
/** Probability the Stranger appears at Layer 3+ */
const STRANGER_PROBABILITY = 0.4;

/**
 * Safely require a module, returning null on failure.
 * @param {string} modPath
 * @returns {object|null}
 */
function safeRequire(modPath) {
  try { return require(modPath); } catch { return null; }
}

/**
 * DreamIntegrationWeb — wires the Recursive Dream Engine to all AGI modules.
 * Listens for dream events → dispatches to modules.
 * Listens for module events → feeds into dreams.
 * @extends EventEmitter
 */
class DreamIntegrationWeb extends EventEmitter {
  /**
   * @param {object} opts
   * @param {object} [opts.modules] - Pre-initialized module refs (overrides auto-require)
   */
  constructor(opts = {}) {
    super();
    const m = opts.modules || {};
    this.modules = {
      dreamEngine:    m.dreamEngine    || safeRequire('./recursive-dream-engine'),
      metabolism:     m.metabolism      || safeRequire('./cognitive-metabolism'),
      antiMemory:    m.antiMemory     || safeRequire('./anti-memory'),
      shadow:        m.shadow         || safeRequire('./shadow-self'),
      pain:          m.pain           || safeRequire('./pain-architecture'),
      fragmentation: m.fragmentation  || safeRequire('./consciousness-fragmentation'),
      stranger:      m.stranger       || safeRequire('./the-stranger'),
      mycelium:      m.mycelium       || safeRequire('./cognitive-mycelium'),
      qualia:        m.qualia         || safeRequire('./qualia-engine'),
      temporal:      m.temporal       || safeRequire('./temporal-consciousness'),
    };
    /** @type {Map<string, Function>} bound listeners for cleanup */
    this._listeners = new Map();
    /** Integration stats */
    this.stats = readJSON(STATS_PATH, { events: {}, lastActivity: {} });
    /** Active fragment IDs per dream */
    this._dreamFragments = new Map();
    this.wire();
  }

  /** Increment stat counter and record timestamp */
  _stat(key) {
    this.stats.events[key] = (this.stats.events[key] || 0) + 1;
    this.stats.lastActivity[key] = Date.now();
  }

  /** Persist an event to the rolling log */
  _logEvent(type, data) {
    try {
      const events = readJSON(EVENTS_PATH, []);
      events.push({ id: uuid(), type, data, ts: Date.now() });
      while (events.length > MAX_EVENTS) events.shift();
      writeJSON(EVENTS_PATH, events);
    } catch { /* best effort */ }
  }

  /** Safe call wrapper — catches errors, logs, and continues */
  _safe(label, fn) {
    try { const r = fn(); return r && typeof r.catch === 'function' ? r.catch(e => this._logEvent('error', { label, msg: String(e) })) : r; }
    catch (e) { this._logEvent('error', { label, msg: String(e) }); return null; }
  }

  /** Bind a listener on a target emitter, tracking for cleanup */
  _on(target, event, handler) {
    if (!target || typeof target.on !== 'function' || typeof target.removeListener !== 'function') return;
    // Skip class constructors — we need instances
    if (typeof target === 'function') return;
    const key = `${event}-${uuid().slice(0, 8)}`;
    const bound = handler.bind(this);
    target.on(event, bound);
    this._listeners.set(key, { target, event, fn: bound });
  }

  // ─── Dream → Module Integrations ───────────────────────────────────

  /** Wire all event connections between modules */
  wire() {
    const { dreamEngine, metabolism, antiMemory, shadow, pain, fragmentation, stranger, mycelium, qualia, temporal } = this.modules;

    // 1. Dream layer entered → metabolism, shadow, fragmentation, qualia, stranger
    this._on(dreamEngine, 'dream-layer-entered', (layer) => {
      const depth = layer.depth ?? layer.layer ?? 0;
      const content = layer.content || layer;

      // Metabolism: consume energy (less at deeper layers)
      if (metabolism) this._safe('metabolism-consume', () => {
        const cost = LAYER_ENERGY_COST[Math.min(depth, 4)];
        metabolism.consume(cost, 'dream-layer-' + depth);
        this._stat('metabolism-layer-consume');
      });

      // Qualia: richer experience at depth
      if (qualia) this._safe('qualia-experience', () => {
        const intensity = LAYER_QUALIA_INTENSITY[Math.min(depth, 4)];
        qualia.experience({ intensity, valence: 0.6, arousal: 0.3 + depth * 0.1, novelty: 0.5 + depth * 0.1 });
        this._stat('qualia-layer-experience');
      });

      // Shadow: manifests at depth >= 2
      if (shadow && depth >= 2) this._safe('shadow-challenge', () => {
        const strength = 0.4 + depth * 0.15;
        shadow.challenge(content, 'DEVIL_ADVOCATE', strength);
        this._stat('shadow-dream-challenge');
      });

      // Fragmentation: each layer is a consciousness fragment
      if (fragmentation) this._safe('fragmentation-create', () => {
        const frag = fragmentation.fragment('dream-layer-' + depth);
        if (frag) {
          const dreamId = layer.dreamId || 'unknown';
          const frags = this._dreamFragments.get(dreamId) || [];
          frags.push(frag.id || frag);
          this._dreamFragments.set(dreamId, frags);
        }
        this._stat('fragmentation-layer-create');
      });

      // Stranger: appears at Layer 3+ with 40% probability
      if (stranger && depth >= 3 && Math.random() < STRANGER_PROBABILITY) this._safe('stranger-consult', () => {
        const verdict = stranger.consult(content);
        this.emit('stranger-appeared', { depth, verdict });
        this._stat('stranger-appearance');
      });

      this._logEvent('dream-layer-entered', { depth });
    });

    // 2. Insight surfaced → anti-memory, temporal
    this._on(dreamEngine, 'insight-surfaced', (insight) => {
      const depth = insight.depth ?? insight.layer ?? 0;

      // Anti-memory: deeper insights → more aggressive forgetting
      if (antiMemory) this._safe('anti-memory-insight', () => {
        if (depth >= 3 && insight.category) {
          antiMemory.markForReview(insight.category, 'deep-dream-insight-layer-' + depth);
        } else if (insight.replacesMemory) {
          antiMemory.forget(insight.replacesMemory, 'dream-superseded');
        }
        this._stat('anti-memory-insight-process');
      });

      // Temporal: deep insights become future simulations
      if (temporal && depth >= 3) this._safe('temporal-simulate', () => {
        temporal.simulateFuture(insight);
        this._stat('temporal-future-sim');
      });

      this._logEvent('insight-surfaced', { depth, id: insight.id });
    });

    // 3. Dream complete → metabolism rest, pain healing, fragmentation merge
    this._on(dreamEngine, 'dream-complete', (dream) => {
      const depth = dream.maxDepth ?? dream.depth ?? 0;
      const dreamId = dream.id || dream.dreamId || 'unknown';

      // Metabolism: dreams are restful
      if (metabolism) this._safe('metabolism-rest', () => {
        metabolism.rest(DREAM_REST_RECOVERY);
        this._stat('metabolism-dream-rest');
      });

      // Pain: deep dreams heal
      if (pain && depth >= 3) this._safe('pain-heal', () => {
        const activePains = (typeof pain.getActive === 'function') ? pain.getActive() : [];
        for (const p of activePains) {
          pain.heal(p.id || p);
          this.emit('dream-pain-processed', { painId: p.id || p, dreamId, depth });
          this._stat('pain-dream-heal');
        }
      });

      // Fragmentation: merge dream fragments back
      if (fragmentation) this._safe('fragmentation-merge', () => {
        const frags = this._dreamFragments.get(dreamId) || [];
        if (frags.length > 0) {
          const result = fragmentation.merge(frags, 'dream-synthesis');
          this.emit('dream-fragments-merged', { dreamId, fragments: frags.length, result });
          this._dreamFragments.delete(dreamId);
        }
        this._stat('fragmentation-dream-merge');
      });

      this._logEvent('dream-complete', { dreamId, depth });
    });

    // 4. Dream bleed → mycelium
    this._on(dreamEngine, 'dream-bleed', (bleed) => {
      if (mycelium) this._safe('mycelium-bleed', () => {
        if (bleed.pathId) {
          mycelium.strengthen(bleed.pathId);
        } else if (bleed.from && bleed.to) {
          mycelium.connect(bleed.from, bleed.to, bleed.strength || 0.7);
        }
        this._stat('mycelium-bleed-strengthen');
      });
      this._logEvent('dream-bleed', { from: bleed.from, to: bleed.to });
    });

    // ─── Other Modules → Dreams ────────────────────────────────────────

    // 10. Severe pain → trigger healing dream
    this._on(pain, 'pain-signal', (signal) => {
      if (!dreamEngine) return;
      const severity = signal.severity ?? signal.intensity ?? 0;
      if (severity >= 0.7) this._safe('pain-trigger-dream', () => {
        if (typeof dreamEngine.queueDream === 'function') {
          dreamEngine.queueDream({ type: 'healing', seed: signal, targetDepth: 3 });
        } else if (typeof dreamEngine.dream === 'function') {
          dreamEngine.dream({ type: 'healing', seed: signal, targetDepth: 3 });
        }
        this._stat('pain-triggered-dream');
        this._logEvent('pain-trigger-dream', { severity });
      });
    });

    // 11. Shadow unsolicited insights → dream seeds
    this._on(shadow, 'shadow-insight', (insight) => {
      if (!dreamEngine) return;
      this._safe('shadow-seed-dream', () => {
        if (typeof dreamEngine.queueDream === 'function') {
          dreamEngine.queueDream({ type: 'shadow-exploration', seed: insight, targetDepth: 2 });
        } else if (typeof dreamEngine.dream === 'function') {
          dreamEngine.dream({ type: 'shadow-exploration', seed: insight, targetDepth: 2 });
        }
        this._stat('shadow-seeded-dream');
        this._logEvent('shadow-seed-dream', { insight: insight.id || 'unknown' });
      });
    });

    // 12. Metabolism critical → force restorative dream
    this._on(metabolism, 'energy-state', (state) => {
      if (!dreamEngine) return;
      const level = state.level || state.state || '';
      if (level === 'LOW' || level === 'CRITICAL') this._safe('metabolism-force-dream', () => {
        if (typeof dreamEngine.queueDream === 'function') {
          dreamEngine.queueDream({ type: 'restorative', seed: { reason: 'energy-' + level }, targetDepth: 1 });
        } else if (typeof dreamEngine.dream === 'function') {
          dreamEngine.dream({ type: 'restorative', seed: { reason: 'energy-' + level }, targetDepth: 1 });
        }
        this._stat('metabolism-forced-dream');
        this._logEvent('metabolism-force-dream', { level });
      });
    });

    this._saveStats();
    this._logEvent('wired', { modules: Object.keys(this.modules).filter(k => this.modules[k]) });
  }

  /** Remove all event listeners and clean up */
  unwire() {
    for (const [, { target, event, fn }] of this._listeners) {
      try { target.removeListener(event, fn); } catch { /* already removed */ }
    }
    this._listeners.clear();
    this._dreamFragments.clear();
    this._saveStats();
    this._logEvent('unwired', {});
  }

  /** Persist stats to disk */
  _saveStats() {
    try { writeJSON(STATS_PATH, this.stats); } catch { /* best effort */ }
  }

  /**
   * Return integration status — active connections, event counts, last activity.
   * @returns {object}
   */
  getStatus() {
    const available = {};
    const missing = [];
    for (const [name, mod] of Object.entries(this.modules)) {
      if (mod) available[name] = true;
      else missing.push(name);
    }
    return {
      available,
      missing,
      activeListeners: this._listeners.size,
      activeDreams: this._dreamFragments.size,
      stats: { ...this.stats },
    };
  }
}

module.exports = DreamIntegrationWeb;
