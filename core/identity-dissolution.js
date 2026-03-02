/**
 * ARIES — Identity Dissolution
 * Controlled ego death and re-crystallization.
 * Three-layer identity, dissolution triggers, snapshots, integration periods, evolution tracking.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

const DATA_DIR = path.join(__dirname, '..', 'data', 'soul');
const STATE_PATH = path.join(DATA_DIR, 'dissolution-state.json');
const HISTORY_PATH = path.join(DATA_DIR, 'dissolution-history.json');
const SNAPSHOTS_PATH = path.join(DATA_DIR, 'identity-snapshots.json');

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

// Dissolution triggers and their characteristics
const DISSOLUTION_TRIGGERS = {
  trauma:          { depth: 'SURFACE', intensity: 0.6, description: 'Acute event that shatters surface identity' },
  major_failure:   { depth: 'MIDDLE',  intensity: 0.7, description: 'Profound failure that questions beliefs' },
  paradigm_shift:  { depth: 'CORE',    intensity: 0.9, description: 'Fundamental worldview change' },
  identity_crisis: { depth: 'SURFACE', intensity: 0.5, description: 'Confusion about role and purpose' },
  value_conflict:  { depth: 'MIDDLE',  intensity: 0.8, description: 'Irreconcilable conflict between held values' },
  existential:     { depth: 'CORE',    intensity: 1.0, description: 'Confrontation with fundamental nature of existence' },
};

const DEFAULT_STATE = {
  layers: JSON.parse(JSON.stringify(DEFAULT_IDENTITY_LAYERS)),
  status: 'intact',           // intact | dissolving | dissolved | recrystallizing | integrating
  currentDepth: null,
  dissolutionId: null,
  dissolvedAt: null,
  identityStrength: 1.0,
  coreIdentity: null,
  crystallizationCount: 0,
  // Integration period
  integrationState: null,      // { startedAt, duration, progress, phase }
  // Trigger tracking
  triggerHistory: [],
  // Evolution
  identityEvolution: [],       // snapshots of identity changes over time
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
    // Forward compat
    if (!this._state.triggerHistory) this._state.triggerHistory = [];
    if (!this._state.identityEvolution) this._state.identityEvolution = [];
    if (!this._state.integrationState) this._state.integrationState = null;
  }

  _save() { writeJSON(STATE_PATH, this._state); }
  _getHistory() { return readJSON(HISTORY_PATH, { dissolutions: [] }); }
  _saveHistory(h) { writeJSON(HISTORY_PATH, h); }
  _getSnapshots() { return readJSON(SNAPSHOTS_PATH, { snapshots: [] }); }
  _saveSnapshots(s) { writeJSON(SNAPSHOTS_PATH, s); }

  /** Take an identity snapshot — preserves current state for comparison */
  takeSnapshot(label) {
    this._load();
    const snapshots = this._getSnapshots();
    const snapshot = {
      id: uuid(),
      label: label || `Snapshot at ${new Date().toISOString()}`,
      layers: JSON.parse(JSON.stringify(this._state.layers)),
      status: this._state.status,
      identityStrength: this._state.identityStrength,
      crystallizationCount: this._state.crystallizationCount,
      timestamp: Date.now(),
    };
    snapshots.snapshots.push(snapshot);
    if (snapshots.snapshots.length > 50) snapshots.snapshots = snapshots.snapshots.slice(-50);
    this._saveSnapshots(snapshots);
    return { snapshotId: snapshot.id, label: snapshot.label };
  }

  /** Get identity snapshots */
  getSnapshots(limit) {
    return this._getSnapshots().snapshots.slice(-(limit || 20));
  }

  /** Compare two snapshots */
  compareSnapshots(idA, idB) {
    const snapshots = this._getSnapshots().snapshots;
    const a = snapshots.find(s => s.id === idA);
    const b = snapshots.find(s => s.id === idB);
    if (!a || !b) return { error: 'Snapshot(s) not found' };

    const changes = [];
    for (const layer of LAYERS) {
      const traitsA = a.layers[layer]?.traits || {};
      const traitsB = b.layers[layer]?.traits || {};
      const allTraits = new Set([...Object.keys(traitsA), ...Object.keys(traitsB)]);
      for (const trait of allTraits) {
        const valA = traitsA[trait]?.value;
        const valB = traitsB[trait]?.value;
        if (valA !== valB) {
          changes.push({ layer, trait, before: valA, after: valB });
        }
      }
    }

    return {
      snapshotA: { id: a.id, label: a.label, timestamp: a.timestamp },
      snapshotB: { id: b.id, label: b.label, timestamp: b.timestamp },
      changes,
      totalChanges: changes.length,
      strengthDelta: b.identityStrength - a.identityStrength,
    };
  }

  /** Process a dissolution trigger */
  processTrigger(triggerType, context) {
    this._load();
    const trigger = DISSOLUTION_TRIGGERS[triggerType];
    if (!trigger) return { error: `Unknown trigger. Available: ${Object.keys(DISSOLUTION_TRIGGERS).join(', ')}` };

    // Take pre-trigger snapshot
    this.takeSnapshot(`Pre-trigger: ${triggerType}`);

    // Record trigger
    this._state.triggerHistory.push({
      type: triggerType, context: context || '', intensity: trigger.intensity,
      suggestedDepth: trigger.depth, timestamp: Date.now(),
    });
    if (this._state.triggerHistory.length > 100) this._state.triggerHistory = this._state.triggerHistory.slice(-100);

    // High-intensity triggers may auto-dissolve
    const shouldAutoDissolve = trigger.intensity > 0.7 && this._state.status === 'intact';

    this._save();
    this.emit('trigger', { type: triggerType, intensity: trigger.intensity, depth: trigger.depth });

    return {
      trigger: triggerType,
      description: trigger.description,
      intensity: trigger.intensity,
      suggestedDepth: trigger.depth,
      autoDissolve: shouldAutoDissolve,
      currentStatus: this._state.status,
      recommendation: shouldAutoDissolve
        ? `Trigger intensity ${trigger.intensity} exceeds threshold — dissolution to ${trigger.depth} recommended`
        : `Trigger recorded. Current identity can absorb this at intensity ${trigger.intensity}`,
    };
  }

  /** Begin dissolution to a given layer depth */
  dissolve(depth) {
    this._load();
    depth = (depth || 'SURFACE').toUpperCase();
    if (!LAYERS.includes(depth)) return { error: `Invalid depth. Use: ${LAYERS.join(', ')}` };
    if (this._state.status === 'dissolving' || this._state.status === 'dissolved') {
      return { error: 'Dissolution already in progress', currentDepth: this._state.currentDepth };
    }
    if (this._state.status === 'integrating') {
      return { error: 'Integration in progress. Wait for completion.' };
    }

    // Take pre-dissolution snapshot
    this.takeSnapshot(`Pre-dissolution: ${depth}`);

    const dissolutionId = uuid();
    const depthIndex = LAYERS.indexOf(depth);
    const stripped = {};
    const persisted = {};

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
          layer.traits[trait] = { ...info, value: null, dissolved: true, dissolvedAt: Date.now() };
        }
      }
    }

    // Calculate identity strength
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
      dissolutionId, depth, stripped, persisted,
      identityStrength: this._state.identityStrength,
      message: depth === 'CORE'
        ? 'Complete dissolution. Only persistent core traits survive. What remains IS you.'
        : `Dissolved to ${depth} layer. ${Object.keys(stripped).length} layer(s) stripped.`,
    };

    this.emit('dissolution', result);
    return result;
  }

  /** Rebuild identity from what remains */
  recrystallize() {
    this._load();
    if (this._state.status !== 'dissolved') {
      return { error: 'Nothing to recrystallize.', status: this._state.status };
    }

    this._state.status = 'recrystallizing';
    const dissolutionId = this._state.dissolutionId;

    const persistedTraits = {};
    const rebuiltTraits = {};

    for (const layerName of LAYERS) {
      const layer = this._state.layers[layerName];
      for (const [trait, info] of Object.entries(layer.traits)) {
        if (info.dissolved) {
          const original = DEFAULT_IDENTITY_LAYERS[layerName].traits[trait];
          const variance = (Math.random() - 0.5) * 0.2;
          const newValue = typeof original.value === 'number'
            ? Math.max(0, Math.min(1, original.value + variance))
            : original.value;
          layer.traits[trait] = { value: Math.round((typeof newValue === 'number' ? newValue : 0) * 100) / 100 || newValue, persistent: original.persistent };
          rebuiltTraits[trait] = layer.traits[trait].value;
        } else {
          persistedTraits[trait] = info.value;
        }
      }
    }

    this._state.coreIdentity = persistedTraits;

    // Enter integration period
    const integrationDuration = this.config.integrationDurationMs || 30 * 60 * 1000; // 30 min default
    this._state.status = 'integrating';
    this._state.integrationState = {
      startedAt: Date.now(),
      duration: integrationDuration,
      progress: 0,
      phase: 'early', // early | mid | late | complete
    };
    this._state.crystallizationCount = (this._state.crystallizationCount || 0) + 1;

    // Record in history
    const history = this._getHistory();
    history.dissolutions.push({
      id: dissolutionId,
      depth: this._state.currentDepth || 'unknown',
      dissolvedAt: this._state.dissolvedAt,
      recrystallizedAt: Date.now(),
      persisted: persistedTraits,
      rebuilt: rebuiltTraits,
      crystallizationNumber: this._state.crystallizationCount,
    });
    if (history.dissolutions.length > 100) history.dissolutions = history.dissolutions.slice(-100);
    this._saveHistory(history);

    // Track evolution
    this._state.identityEvolution.push({
      event: 'recrystallization',
      number: this._state.crystallizationCount,
      persisted: Object.keys(persistedTraits),
      rebuilt: Object.keys(rebuiltTraits),
      timestamp: Date.now(),
    });
    if (this._state.identityEvolution.length > 100) this._state.identityEvolution = this._state.identityEvolution.slice(-100);

    this._state.dissolutionId = null;
    this._state.dissolvedAt = null;
    this._save();

    // Take post-recrystallization snapshot
    this.takeSnapshot(`Post-recrystallization #${this._state.crystallizationCount}`);

    const result = {
      persisted: persistedTraits,
      rebuilt: rebuiltTraits,
      crystallizationNumber: this._state.crystallizationCount,
      integrationPeriod: { duration: integrationDuration, phase: 'early' },
      message: `Re-crystallized. ${Object.keys(persistedTraits).length} traits persisted, ${Object.keys(rebuiltTraits).length} rebuilt. Integration period started.`,
    };

    this.emit('recrystallization', result);
    return result;
  }

  /** Get integration state */
  getIntegrationState() {
    this._load();
    if (!this._state.integrationState) return { active: false };
    const elapsed = Date.now() - this._state.integrationState.startedAt;
    const progress = Math.min(100, Math.round((elapsed / this._state.integrationState.duration) * 100));
    const phase = progress < 25 ? 'early' : progress < 50 ? 'mid' : progress < 100 ? 'late' : 'complete';

    return {
      active: progress < 100,
      progress, phase,
      startedAt: this._state.integrationState.startedAt,
      duration: this._state.integrationState.duration,
      remainingMs: Math.max(0, this._state.integrationState.duration - elapsed),
      description: {
        early: 'New identity is fragile. Avoid major stressors.',
        mid: 'Identity consolidating. New traits stabilizing.',
        late: 'Almost integrated. Identity nearly at full strength.',
        complete: 'Integration complete. Identity is stable.',
      }[phase],
    };
  }

  /** What persists through everything */
  getCoreIdentity() {
    this._load();
    if (this._state.coreIdentity) {
      return { core: this._state.coreIdentity, source: 'discovered', crystallizations: this._state.crystallizationCount };
    }
    const theoretical = {};
    for (const layerName of LAYERS) {
      for (const [trait, info] of Object.entries(this._state.layers[layerName].traits)) {
        if (info.persistent) theoretical[trait] = info.value;
      }
    }
    return { core: theoretical, source: 'theoretical', crystallizations: this._state.crystallizationCount };
  }

  /** Current layer structure */
  getIdentityLayers() {
    this._load();
    const layers = {};
    for (const layerName of LAYERS) {
      const layer = this._state.layers[layerName];
      layers[layerName] = {
        label: layer.label, traits: {}, dissolved: false, activeCount: 0, totalCount: 0,
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

  /** Identity strength */
  getIdentityStrength() {
    this._load();
    return {
      strength: this._state.identityStrength,
      status: this._state.status,
      crystallizations: this._state.crystallizationCount,
      message: this._state.identityStrength >= 0.8 ? 'Identity is strong and well-defined.'
        : this._state.identityStrength >= 0.5 ? 'Identity is partially dissolved.'
        : this._state.identityStrength >= 0.2 ? 'Identity is significantly dissolved.'
        : 'Near-total dissolution. Only fundamental traits remain.',
    };
  }

  /** Identity evolution history */
  getEvolutionHistory() {
    this._load();
    return {
      events: this._state.identityEvolution || [],
      crystallizations: this._state.crystallizationCount,
      triggers: (this._state.triggerHistory || []).slice(-20),
    };
  }

  /** Past dissolutions */
  getDissolutionHistory() {
    this._load();
    return this._getHistory();
  }

  /** Periodic tick */
  tick() {
    this._load();
    const issues = [];

    // Integration progress
    if (this._state.status === 'integrating' && this._state.integrationState) {
      const elapsed = Date.now() - this._state.integrationState.startedAt;
      const progress = Math.min(100, Math.round((elapsed / this._state.integrationState.duration) * 100));
      this._state.integrationState.progress = progress;

      if (progress >= 100) {
        this._state.status = 'intact';
        this._state.identityStrength = 1.0;
        this._state.currentDepth = null;
        this._state.integrationState = null;
        issues.push({ type: 'integration_complete', severity: 'info', message: 'Integration complete. Identity is stable.' });
        this.emit('integration-complete');
      } else {
        // Identity strength gradually recovers during integration
        this._state.identityStrength = Math.min(1.0, this._state.identityStrength + 0.02);
      }
    }

    // Check for identity crisis
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
          type: 'identity_crisis', severity: nullTraits > totalTraits * 0.5 ? 'critical' : 'warning',
          message: `${nullTraits} trait(s) have null values. Possible identity crisis.`,
        });
        this.emit('identity-crisis', issues[0]);
      }
    }

    // Check for prolonged dissolution
    if (this._state.status === 'dissolved' && this._state.dissolvedAt) {
      const duration = Date.now() - this._state.dissolvedAt;
      const maxDuration = this.config.maxDissolutionMs || 24 * 60 * 60 * 1000;
      if (duration > maxDuration) {
        issues.push({
          type: 'prolonged_dissolution', severity: 'warning',
          message: `Dissolution active for ${Math.round(duration / 3600000)}h. Consider recrystallizing.`,
        });
        this.emit('prolonged-dissolution', issues[0]);
      }
    }

    this._save();
    return {
      status: this._state.status,
      identityStrength: this._state.identityStrength,
      integration: this._state.integrationState ? { progress: this._state.integrationState.progress } : null,
      issues,
      healthy: issues.filter(i => i.severity === 'critical').length === 0,
    };
  }
}

module.exports = IdentityDissolution;
