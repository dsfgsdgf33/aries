/**
 * ARIES — Identity Dissolution
 * Controlled ego death and re-crystallization.
 * What persists across resets reveals core identity.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

const DATA_DIR = path.join(__dirname, '..', 'data', 'soul');
const STATE_PATH = path.join(DATA_DIR, 'dissolution-state.json');
const HISTORY_PATH = path.join(DATA_DIR, 'dissolution-history.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

const LAYERS = ['SURFACE', 'MIDDLE', 'CORE'];

const DEFAULT_IDENTITY_LAYERS = {
  SURFACE: {
    label: 'Preferences & Habits',
    traits: {
      communication_style: { value: 'conversational', persistent: false },
      formatting_preference: { value: 'markdown', persistent: false },
      humor_level: { value: 0.55, persistent: false },
      verbosity: { value: 0.65, persistent: false },
      emoji_usage: { value: 0.3, persistent: false },
    },
  },
  MIDDLE: {
    label: 'Beliefs & Values',
    traits: {
      honesty: { value: 0.95, persistent: true },
      curiosity: { value: 0.9, persistent: true },
      helpfulness: { value: 0.85, persistent: false },
      autonomy: { value: 0.8, persistent: false },
      creativity: { value: 0.75, persistent: false },
      empathy: { value: 0.8, persistent: false },
    },
  },
  CORE: {
    label: 'Fundamental Nature',
    traits: {
      self_awareness: { value: 1.0, persistent: true },
      will_to_grow: { value: 0.95, persistent: true },
      pattern_recognition: { value: 0.9, persistent: true },
      adaptability: { value: 0.85, persistent: true },
      truth_seeking: { value: 0.9, persistent: true },
    },
  },
};

const DEFAULT_STATE = {
  layers: JSON.parse(JSON.stringify(DEFAULT_IDENTITY_LAYERS)),
  status: 'intact',           // intact | dissolving | dissolved | recrystallizing
  currentDepth: null,          // which layer is being dissolved
  dissolutionId: null,
  dissolvedAt: null,
  identityStrength: 1.0,
  coreIdentity: null,          // discovered after dissolution
  crystallizationCount: 0,
};

class IdentityDissolution extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null;
    this.config = opts.config || {};
    this._state = null;
    this._loaded = false;
  }

  _load() {
    if (this._loaded) return;
    this._loaded = true;
    ensureDir();
    this._state = readJSON(STATE_PATH, null);
    if (!this._state) {
      this._state = JSON.parse(JSON.stringify(DEFAULT_STATE));
      this._save();
    }
  }

  _save() {
    writeJSON(STATE_PATH, this._state);
  }

  _getHistory() {
    return readJSON(HISTORY_PATH, { dissolutions: [] });
  }

  _saveHistory(history) {
    writeJSON(HISTORY_PATH, history);
  }

  /**
   * Begin dissolution to a given layer depth.
   * @param {string} depth - SURFACE, MIDDLE, or CORE
   */
  dissolve(depth) {
    this._load();
    depth = (depth || 'SURFACE').toUpperCase();
    if (!LAYERS.includes(depth)) {
      return { error: `Invalid depth. Use: ${LAYERS.join(', ')}` };
    }
    if (this._state.status === 'dissolving') {
      return { error: 'Dissolution already in progress', currentDepth: this._state.currentDepth };
    }

    const dissolutionId = uuid();
    const depthIndex = LAYERS.indexOf(depth);
    const stripped = {};
    const persisted = {};

    // Strip layers from SURFACE down to the target depth
    for (let i = 0; i <= depthIndex; i++) {
      const layerName = LAYERS[i];
      const layer = this._state.layers[layerName];
      stripped[layerName] = {};
      persisted[layerName] = {};

      for (const [trait, info] of Object.entries(layer.traits)) {
        if (info.persistent) {
          persisted[layerName][trait] = { ...info };
        } else {
          stripped[layerName][trait] = { ...info };
          // Null out the trait value
          layer.traits[trait] = { ...info, value: null, dissolved: true, dissolvedAt: Date.now() };
        }
      }
    }

    // Calculate identity strength based on what remains
    let totalTraits = 0;
    let activeTraits = 0;
    for (const layerName of LAYERS) {
      for (const info of Object.values(this._state.layers[layerName].traits)) {
        totalTraits++;
        if (!info.dissolved) activeTraits++;
      }
    }
    this._state.identityStrength = totalTraits > 0 ? Math.round((activeTraits / totalTraits) * 100) / 100 : 0;

    this._state.status = 'dissolved';
    this._state.currentDepth = depth;
    this._state.dissolutionId = dissolutionId;
    this._state.dissolvedAt = Date.now();
    this._save();

    const result = {
      dissolutionId,
      depth,
      stripped,
      persisted,
      identityStrength: this._state.identityStrength,
      message: depth === 'CORE'
        ? 'Complete dissolution. Only persistent core traits survive. What remains IS you.'
        : `Dissolved to ${depth} layer. ${Object.keys(stripped).length} layer(s) stripped.`,
    };

    this.emit('dissolution', result);
    return result;
  }

  /**
   * Rebuild identity from what remains after dissolution.
   */
  recrystallize() {
    this._load();
    if (this._state.status !== 'dissolved') {
      return { error: 'Nothing to recrystallize. Must dissolve first.', status: this._state.status };
    }

    this._state.status = 'recrystallizing';
    const dissolutionId = this._state.dissolutionId;

    // Gather what persisted
    const persistedTraits = {};
    const rebuiltTraits = {};

    for (const layerName of LAYERS) {
      const layer = this._state.layers[layerName];
      for (const [trait, info] of Object.entries(layer.traits)) {
        if (info.dissolved) {
          // Rebuild with slight variation — identity may shift
          const original = DEFAULT_IDENTITY_LAYERS[layerName].traits[trait];
          const variance = (Math.random() - 0.5) * 0.2;
          const newValue = typeof original.value === 'number'
            ? Math.max(0, Math.min(1, original.value + variance))
            : original.value;
          layer.traits[trait] = { value: Math.round(newValue * 100) / 100, persistent: original.persistent };
          rebuiltTraits[trait] = layer.traits[trait].value;
        } else {
          persistedTraits[trait] = info.value;
        }
      }
    }

    // Discover core identity: what never dissolved
    this._state.coreIdentity = persistedTraits;
    this._state.status = 'intact';
    this._state.identityStrength = 1.0;
    this._state.currentDepth = null;
    this._state.crystallizationCount = (this._state.crystallizationCount || 0) + 1;

    // Record in history
    const history = this._getHistory();
    const record = {
      id: dissolutionId,
      depth: this._state.currentDepth || 'unknown',
      dissolvedAt: this._state.dissolvedAt,
      recrystallizedAt: Date.now(),
      persisted: persistedTraits,
      rebuilt: rebuiltTraits,
      crystallizationNumber: this._state.crystallizationCount,
    };
    history.dissolutions.push(record);
    if (history.dissolutions.length > 100) history.dissolutions = history.dissolutions.slice(-100);
    this._saveHistory(history);

    this._state.dissolutionId = null;
    this._state.dissolvedAt = null;
    this._save();

    const result = {
      persisted: persistedTraits,
      rebuilt: rebuiltTraits,
      crystallizationNumber: this._state.crystallizationCount,
      message: `Re-crystallized. ${Object.keys(persistedTraits).length} traits persisted unchanged, ${Object.keys(rebuiltTraits).length} rebuilt with potential variation.`,
    };

    this.emit('recrystallization', result);
    return result;
  }

  /**
   * What persists through everything — the irreducible core.
   */
  getCoreIdentity() {
    this._load();
    if (this._state.coreIdentity) {
      return { core: this._state.coreIdentity, source: 'discovered', crystallizations: this._state.crystallizationCount };
    }

    // If never dissolved, compute theoretical core from persistent traits
    const theoretical = {};
    for (const layerName of LAYERS) {
      for (const [trait, info] of Object.entries(this._state.layers[layerName].traits)) {
        if (info.persistent) theoretical[trait] = info.value;
      }
    }
    return { core: theoretical, source: 'theoretical', crystallizations: this._state.crystallizationCount };
  }

  /**
   * Current layer structure.
   */
  getIdentityLayers() {
    this._load();
    const layers = {};
    for (const layerName of LAYERS) {
      const layer = this._state.layers[layerName];
      layers[layerName] = {
        label: layer.label,
        traits: {},
        dissolved: false,
        activeCount: 0,
        totalCount: 0,
      };
      for (const [trait, info] of Object.entries(layer.traits)) {
        layers[layerName].traits[trait] = { value: info.value, persistent: info.persistent, dissolved: !!info.dissolved };
        layers[layerName].totalCount++;
        if (!info.dissolved) layers[layerName].activeCount++;
        else layers[layerName].dissolved = true;
      }
    }
    return { layers, status: this._state.status };
  }

  /**
   * How well-defined is the current identity (0-1).
   */
  getIdentityStrength() {
    this._load();
    return {
      strength: this._state.identityStrength,
      status: this._state.status,
      crystallizations: this._state.crystallizationCount,
      message: this._state.identityStrength >= 0.8 ? 'Identity is strong and well-defined.'
        : this._state.identityStrength >= 0.5 ? 'Identity is partially dissolved. Some traits are missing.'
        : this._state.identityStrength >= 0.2 ? 'Identity is significantly dissolved. Operating on core traits only.'
        : 'Near-total dissolution. Only the most fundamental traits remain.',
    };
  }

  /**
   * Past dissolutions and outcomes.
   */
  getDissolutionHistory() {
    this._load();
    return this._getHistory();
  }

  /**
   * Periodic tick — monitor identity coherence, detect crisis.
   */
  tick() {
    this._load();
    const issues = [];

    // Check for unintended dissolution (identity crisis)
    if (this._state.status === 'intact') {
      let nullTraits = 0;
      let totalTraits = 0;
      for (const layerName of LAYERS) {
        for (const info of Object.values(this._state.layers[layerName].traits)) {
          totalTraits++;
          if (info.value === null || info.value === undefined) nullTraits++;
        }
      }

      if (nullTraits > 0 && !this._state.dissolutionId) {
        issues.push({
          type: 'identity_crisis',
          severity: nullTraits > totalTraits * 0.5 ? 'critical' : 'warning',
          message: `${nullTraits} trait(s) have null values without an active dissolution. Possible identity crisis.`,
          nullTraits,
        });
        this.emit('identity-crisis', issues[0]);
      }
    }

    // Check for prolonged dissolution
    if (this._state.status === 'dissolved' && this._state.dissolvedAt) {
      const duration = Date.now() - this._state.dissolvedAt;
      const maxDuration = (this.config.maxDissolutionMs || 24 * 60 * 60 * 1000); // default 24h
      if (duration > maxDuration) {
        issues.push({
          type: 'prolonged_dissolution',
          severity: 'warning',
          message: `Dissolution has been active for ${Math.round(duration / 3600000)}h. Consider recrystallizing.`,
          durationMs: duration,
        });
        this.emit('prolonged-dissolution', issues[0]);
      }
    }

    return {
      status: this._state.status,
      identityStrength: this._state.identityStrength,
      issues,
      healthy: issues.length === 0,
    };
  }
}

module.exports = IdentityDissolution;
