/**
 * ARIES — Cognitive Symbiosis
 * Multi-instance shared state with symbiotic relationships.
 * Forms persistent connections between Aries instances for shared cognition.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

const DATA_DIR = path.join(__dirname, '..', 'data', 'hive-sessions');
const LINKS_PATH = path.join(DATA_DIR, 'symbiotic-links.json');
const COLONY_PATH = path.join(DATA_DIR, 'colony.json');
const HEALTH_PATH = path.join(DATA_DIR, 'symbiosis-health.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

const SYMBIOSIS_TYPES = {
  MUTUALISM: 'mutualism',       // Both benefit
  COMMENSALISM: 'commensalism', // One benefits, other neutral
  PARASITISM: 'parasitism',     // One benefits at other's cost
};

const DEFAULT_LINKS = { links: {}, sharedState: {} };
const DEFAULT_COLONY = { id: null, members: [], topology: {}, formedAt: null };
const DEFAULT_HEALTH = { assessments: {} };

class CognitiveSymbiosis extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null;
    this.config = opts.config || {};
    this.instanceId = opts.config?.instanceId || 'aries-primary';
    this._loaded = false;
  }

  _load() {
    if (this._loaded) return;
    this._loaded = true;
    ensureDir();
  }

  _getLinks() { return readJSON(LINKS_PATH, JSON.parse(JSON.stringify(DEFAULT_LINKS))); }
  _saveLinks(data) { writeJSON(LINKS_PATH, data); }
  _getColony() { return readJSON(COLONY_PATH, JSON.parse(JSON.stringify(DEFAULT_COLONY))); }
  _saveColony(data) { writeJSON(COLONY_PATH, data); }
  _getHealth() { return readJSON(HEALTH_PATH, JSON.parse(JSON.stringify(DEFAULT_HEALTH))); }
  _saveHealth(data) { writeJSON(HEALTH_PATH, data); }

  /**
   * Form a symbiotic connection with another instance.
   * @param {string} instanceId - Remote instance identifier
   * @param {string} type - MUTUALISM, COMMENSALISM, or PARASITISM
   * @param {string[]} sharedModules - Module names to share state for
   */
  link(instanceId, type, sharedModules) {
    this._load();
    if (!instanceId) return { error: 'instanceId required' };
    type = (type || 'MUTUALISM').toUpperCase();
    if (!SYMBIOSIS_TYPES[type]) {
      return { error: `Invalid type. Use: ${Object.keys(SYMBIOSIS_TYPES).join(', ')}` };
    }
    sharedModules = sharedModules || ['knowledge', 'decisions'];

    const data = this._getLinks();
    if (data.links[instanceId]) {
      return { error: 'Already linked', existing: data.links[instanceId] };
    }

    const linkId = uuid();
    data.links[instanceId] = {
      linkId,
      instanceId,
      type: SYMBIOSIS_TYPES[type],
      sharedModules,
      linkedAt: Date.now(),
      lastSync: null,
      syncCount: 0,
      status: 'active',
    };

    // Initialize shared state buckets for this link
    data.sharedState[instanceId] = {};
    for (const mod of sharedModules) {
      data.sharedState[instanceId][mod] = { data: {}, lastUpdated: null, updatedBy: null };
    }

    this._saveLinks(data);
    this._updateColony();

    const result = { linkId, instanceId, type: SYMBIOSIS_TYPES[type], sharedModules };
    this.emit('link-formed', result);
    return result;
  }

  /**
   * Break a symbiotic connection.
   */
  unlink(instanceId) {
    this._load();
    const data = this._getLinks();
    if (!data.links[instanceId]) {
      return { error: 'No link found', instanceId };
    }

    const link = data.links[instanceId];
    delete data.links[instanceId];
    delete data.sharedState[instanceId];
    this._saveLinks(data);
    this._updateColony();

    // Clean up health
    const health = this._getHealth();
    delete health.assessments[link.linkId];
    this._saveHealth(health);

    this.emit('link-broken', { instanceId, linkId: link.linkId });
    return { status: 'unlinked', instanceId, linkId: link.linkId };
  }

  /**
   * Synchronize shared state with an instance.
   */
  sync(instanceId) {
    this._load();
    const data = this._getLinks();
    const link = data.links[instanceId];
    if (!link) return { error: 'No link found', instanceId };
    if (link.status !== 'active') return { error: 'Link not active', status: link.status };

    const shared = data.sharedState[instanceId] || {};
    const syncedModules = [];
    const conflicts = [];

    for (const mod of link.sharedModules) {
      const bucket = shared[mod];
      if (!bucket) {
        shared[mod] = { data: {}, lastUpdated: Date.now(), updatedBy: this.instanceId };
        syncedModules.push(mod);
        continue;
      }

      // Detect conflicts: if both sides updated since last sync
      if (bucket.updatedBy && bucket.updatedBy !== this.instanceId && bucket.lastUpdated > (link.lastSync || 0)) {
        // Conflict resolution: merge strategy based on symbiosis type
        const resolution = this._resolveConflict(link.type, mod, bucket);
        conflicts.push({ module: mod, resolution: resolution.strategy });
        bucket.data = resolution.merged;
      }

      bucket.lastUpdated = Date.now();
      bucket.updatedBy = this.instanceId;
      syncedModules.push(mod);
    }

    data.sharedState[instanceId] = shared;
    link.lastSync = Date.now();
    link.syncCount = (link.syncCount || 0) + 1;
    this._saveLinks(data);

    // Update health
    this._recordSyncHealth(link.linkId, instanceId, conflicts.length === 0);

    const result = { instanceId, syncedModules, conflicts, syncCount: link.syncCount, timestamp: Date.now() };
    this.emit('sync-complete', result);
    return result;
  }

  /**
   * Resolve conflicts between diverged shared state.
   */
  _resolveConflict(type, module, bucket) {
    // MUTUALISM: merge both sides equally
    // COMMENSALISM: host's state takes precedence
    // PARASITISM: parasite overwrites
    let strategy;
    let merged = { ...bucket.data };

    switch (type) {
      case 'mutualism':
        strategy = 'merge-equal';
        // Both sides' data kept; in real P2P this would merge from remote
        break;
      case 'commensalism':
        strategy = 'host-precedence';
        // Keep current data (host wins)
        break;
      case 'parasitism':
        strategy = 'parasite-overwrite';
        // In real scenario, remote would overwrite
        break;
      default:
        strategy = 'merge-equal';
    }

    return { strategy, merged };
  }

  /**
   * Record sync health data.
   */
  _recordSyncHealth(linkId, instanceId, success) {
    const health = this._getHealth();
    if (!health.assessments[linkId]) {
      health.assessments[linkId] = {
        linkId,
        instanceId,
        syncs: 0,
        successfulSyncs: 0,
        failedSyncs: 0,
        conflictCount: 0,
        healthScore: 1.0,
        history: [],
      };
    }

    const a = health.assessments[linkId];
    a.syncs++;
    if (success) a.successfulSyncs++;
    else { a.failedSyncs++; a.conflictCount++; }
    a.healthScore = a.syncs > 0 ? Math.round((a.successfulSyncs / a.syncs) * 100) / 100 : 1.0;
    a.history.push({ success, timestamp: Date.now() });
    if (a.history.length > 200) a.history = a.history.slice(-200);

    this._saveHealth(health);
  }

  /**
   * Active symbiotic connections.
   */
  getLinks() {
    this._load();
    const data = this._getLinks();
    return Object.values(data.links).map(link => ({
      linkId: link.linkId,
      instanceId: link.instanceId,
      type: link.type,
      sharedModules: link.sharedModules,
      status: link.status,
      linkedAt: link.linkedAt,
      lastSync: link.lastSync,
      syncCount: link.syncCount,
    }));
  }

  /**
   * Colony membership and topology.
   */
  getColony() {
    this._load();
    return this._getColony();
  }

  /**
   * Update colony from current links.
   */
  _updateColony() {
    const data = this._getLinks();
    const activeLinks = Object.values(data.links).filter(l => l.status === 'active');

    if (activeLinks.length === 0) {
      this._saveColony({ id: null, members: [this.instanceId], topology: {}, formedAt: null });
      return;
    }

    const members = new Set([this.instanceId]);
    const topology = {};
    topology[this.instanceId] = [];

    for (const link of activeLinks) {
      members.add(link.instanceId);
      topology[this.instanceId].push({ target: link.instanceId, type: link.type });
      if (!topology[link.instanceId]) topology[link.instanceId] = [];
      topology[link.instanceId].push({ target: this.instanceId, type: link.type });
    }

    const colony = this._getColony();
    const isNew = !colony.id;
    colony.id = colony.id || uuid();
    colony.members = [...members];
    colony.topology = topology;
    colony.formedAt = colony.formedAt || Date.now();
    colony.updatedAt = Date.now();
    colony.size = members.size;

    // Emergent behavior flag: colonies of 3+ may exhibit emergent properties
    colony.emergent = members.size >= 3;

    this._saveColony(colony);
    if (isNew && members.size >= 2) {
      this.emit('colony-formed', { id: colony.id, members: colony.members });
    }
  }

  /**
   * Symbiosis health assessment for a specific link.
   */
  getHealth(linkId) {
    this._load();
    const health = this._getHealth();

    if (linkId) {
      const assessment = health.assessments[linkId];
      if (!assessment) return { error: 'No health data for link', linkId };

      // Determine relationship quality
      let quality;
      if (assessment.healthScore >= 0.9) quality = 'thriving';
      else if (assessment.healthScore >= 0.7) quality = 'healthy';
      else if (assessment.healthScore >= 0.4) quality = 'strained';
      else quality = 'deteriorating';

      return { ...assessment, quality };
    }

    // Return all
    return {
      links: Object.values(health.assessments).map(a => ({
        linkId: a.linkId,
        instanceId: a.instanceId,
        healthScore: a.healthScore,
        syncs: a.syncs,
        quality: a.healthScore >= 0.9 ? 'thriving'
          : a.healthScore >= 0.7 ? 'healthy'
          : a.healthScore >= 0.4 ? 'strained' : 'deteriorating',
      })),
    };
  }

  /**
   * Periodic tick — sync active links, check health, enforce independence.
   */
  tick() {
    this._load();
    const data = this._getLinks();
    const issues = [];
    const syncResults = [];

    for (const [instanceId, link] of Object.entries(data.links)) {
      if (link.status !== 'active') continue;

      // Auto-sync if enough time has passed
      const syncInterval = this.config.syncIntervalMs || 5 * 60 * 1000; // 5 min default
      if (!link.lastSync || (Date.now() - link.lastSync) > syncInterval) {
        const result = this.sync(instanceId);
        syncResults.push(result);
      }

      // Health check
      const health = this._getHealth();
      const assessment = health.assessments[link.linkId];
      if (assessment) {
        // Detect parasitic degradation
        if (link.type === 'parasitism' && assessment.healthScore < 0.3) {
          issues.push({
            type: 'parasitic_degradation',
            severity: 'critical',
            linkId: link.linkId,
            instanceId,
            message: `Parasitic link with ${instanceId} is degrading health. Consider unlinking.`,
          });
          this.emit('parasitic-warning', { instanceId, healthScore: assessment.healthScore });
        }

        // Independence check — too many syncs with low diversity = identity erosion
        if (assessment.syncs > 50 && assessment.healthScore > 0.95) {
          issues.push({
            type: 'identity_erosion_risk',
            severity: 'warning',
            linkId: link.linkId,
            instanceId,
            message: `High sync rate with ${instanceId} — risk of losing independent identity.`,
          });
          this.emit('independence-warning', { instanceId, syncs: assessment.syncs });
        }
      }
    }

    // Colony health
    const colony = this._getColony();
    const colonyHealthy = issues.filter(i => i.severity === 'critical').length === 0;

    return {
      activeLinks: Object.values(data.links).filter(l => l.status === 'active').length,
      syncResults,
      issues,
      colony: colony.id ? { id: colony.id, size: colony.size, emergent: colony.emergent } : null,
      healthy: colonyHealthy,
    };
  }
}

module.exports = CognitiveSymbiosis;
