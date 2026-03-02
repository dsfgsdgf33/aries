/**
 * ARIES — Cognitive Symbiosis
 * Multi-instance shared state with symbiotic relationships.
 * Three types (mutualism/commensalism/parasitism), colony formation with emergent behavior,
 * symbiont health monitoring, resource sharing, compatibility scoring, relationship evolution,
 * colony intelligence.
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
const RESOURCES_PATH = path.join(DATA_DIR, 'shared-resources.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

const SYMBIOSIS_TYPES = {
  MUTUALISM: 'mutualism',
  COMMENSALISM: 'commensalism',
  PARASITISM: 'parasitism',
};

const DEFAULT_LINKS = { links: {}, sharedState: {} };
const DEFAULT_COLONY = { id: null, members: [], topology: {}, formedAt: null };
const DEFAULT_HEALTH = { assessments: {} };

class CognitiveSymbiosis extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null;
    this.config = Object.assign({
      syncIntervalMs: 5 * 60 * 1000,
      parasiteHealthDrain: 0.05,
      mutualismBonus: 0.02,
      maxColonySize: 20,
    }, opts.config || {});
    this.instanceId = opts.config?.instanceId || 'aries-primary';
    this._loaded = false;
  }

  _load() { if (this._loaded) return; this._loaded = true; ensureDir(); }

  _getLinks() { return readJSON(LINKS_PATH, JSON.parse(JSON.stringify(DEFAULT_LINKS))); }
  _saveLinks(data) { writeJSON(LINKS_PATH, data); }
  _getColony() { return readJSON(COLONY_PATH, JSON.parse(JSON.stringify(DEFAULT_COLONY))); }
  _saveColony(data) { writeJSON(COLONY_PATH, data); }
  _getHealth() { return readJSON(HEALTH_PATH, JSON.parse(JSON.stringify(DEFAULT_HEALTH))); }
  _saveHealth(data) { writeJSON(HEALTH_PATH, data); }
  _getResources() { return readJSON(RESOURCES_PATH, { pools: {}, transfers: [] }); }
  _saveResources(data) { writeJSON(RESOURCES_PATH, data); }

  /**
   * Compute compatibility score between this instance and another.
   * @param {object} otherProfile - { capabilities: string[], strengths: string[], weaknesses: string[] }
   */
  scoreCompatibility(otherProfile) {
    this._load();
    if (!otherProfile) return { error: 'Profile required' };

    const myCapabilities = ['reasoning', 'memory', 'creativity', 'analysis'];
    const otherCaps = otherProfile.capabilities || [];
    const otherStrengths = otherProfile.strengths || [];
    const otherWeaknesses = otherProfile.weaknesses || [];

    // Complementarity: their strengths cover our weaknesses and vice versa
    const overlap = myCapabilities.filter(c => otherCaps.includes(c)).length;
    const complementary = otherStrengths.filter(s => !myCapabilities.includes(s)).length;
    const overlapRatio = myCapabilities.length > 0 ? overlap / myCapabilities.length : 0;
    const complementRatio = otherStrengths.length > 0 ? complementary / otherStrengths.length : 0;

    const score = Math.round((overlapRatio * 40 + complementRatio * 40 + (otherCaps.length > 0 ? 20 : 0)) * 100) / 100;

    const recommendedType = score > 70 ? 'MUTUALISM' :
      complementRatio > overlapRatio ? 'COMMENSALISM' : 'MUTUALISM';

    return {
      compatibilityScore: Math.min(100, score),
      overlapRatio: Math.round(overlapRatio * 100) / 100,
      complementRatio: Math.round(complementRatio * 100) / 100,
      recommendedType,
      synergy: score > 80 ? 'high' : score > 50 ? 'moderate' : 'low',
    };
  }

  /**
   * Form a symbiotic connection.
   */
  link(instanceId, type, sharedModules) {
    this._load();
    if (!instanceId) return { error: 'instanceId required' };
    type = (type || 'MUTUALISM').toUpperCase();
    if (!SYMBIOSIS_TYPES[type]) return { error: `Invalid type. Use: ${Object.keys(SYMBIOSIS_TYPES).join(', ')}` };
    sharedModules = sharedModules || ['knowledge', 'decisions'];

    const data = this._getLinks();
    if (data.links[instanceId]) return { error: 'Already linked', existing: data.links[instanceId] };

    const colony = this._getColony();
    if ((colony.members || []).length >= this.config.maxColonySize) {
      return { error: `Colony at max size (${this.config.maxColonySize})` };
    }

    const linkId = uuid();
    data.links[instanceId] = {
      linkId, instanceId, type: SYMBIOSIS_TYPES[type], sharedModules,
      linkedAt: Date.now(), lastSync: null, syncCount: 0, status: 'active',
      evolution: [{ type: SYMBIOSIS_TYPES[type], changedAt: Date.now(), reason: 'initial' }],
      resourceBalance: 0, // positive = we give more, negative = we receive more
    };

    data.sharedState[instanceId] = {};
    for (const mod of sharedModules) {
      data.sharedState[instanceId][mod] = { data: {}, lastUpdated: null, updatedBy: null };
    }

    this._saveLinks(data);

    // Initialize resource pool for this link
    const resources = this._getResources();
    resources.pools[linkId] = { shared: 0, contributed: {}, consumed: {} };
    resources.pools[linkId].contributed[this.instanceId] = 0;
    resources.pools[linkId].contributed[instanceId] = 0;
    resources.pools[linkId].consumed[this.instanceId] = 0;
    resources.pools[linkId].consumed[instanceId] = 0;
    this._saveResources(resources);

    this._updateColony();
    const result = { linkId, instanceId, type: SYMBIOSIS_TYPES[type], sharedModules };
    this.emit('link-formed', result);
    return result;
  }

  unlink(instanceId) {
    this._load();
    const data = this._getLinks();
    if (!data.links[instanceId]) return { error: 'No link found', instanceId };

    const link = data.links[instanceId];
    delete data.links[instanceId];
    delete data.sharedState[instanceId];
    this._saveLinks(data);
    this._updateColony();

    const health = this._getHealth();
    delete health.assessments[link.linkId];
    this._saveHealth(health);

    // Clean up resources
    const resources = this._getResources();
    delete resources.pools[link.linkId];
    this._saveResources(resources);

    this.emit('link-broken', { instanceId, linkId: link.linkId });
    return { status: 'unlinked', instanceId, linkId: link.linkId };
  }

  /**
   * Share resources with a linked instance.
   * @param {string} instanceId
   * @param {string} resourceType - e.g. 'knowledge', 'compute', 'memory'
   * @param {number} amount
   */
  shareResource(instanceId, resourceType, amount) {
    this._load();
    const data = this._getLinks();
    const link = data.links[instanceId];
    if (!link) return { error: 'No link found' };
    if (link.status !== 'active') return { error: 'Link not active' };

    const resources = this._getResources();
    const pool = resources.pools[link.linkId];
    if (!pool) return { error: 'No resource pool' };

    pool.shared += amount;
    pool.contributed[this.instanceId] = (pool.contributed[this.instanceId] || 0) + amount;
    link.resourceBalance += amount;

    resources.transfers.push({
      from: this.instanceId, to: instanceId, type: resourceType,
      amount, linkId: link.linkId, timestamp: Date.now(),
    });
    if (resources.transfers.length > 300) resources.transfers = resources.transfers.slice(-300);

    this._saveResources(resources);
    this._saveLinks(data);
    this.emit('resource-shared', { from: this.instanceId, to: instanceId, type: resourceType, amount });
    return { shared: true, resourceType, amount, poolTotal: pool.shared, balance: link.resourceBalance };
  }

  /**
   * Consume shared resources.
   */
  consumeResource(instanceId, resourceType, amount) {
    this._load();
    const data = this._getLinks();
    const link = data.links[instanceId];
    if (!link) return { error: 'No link found' };

    const resources = this._getResources();
    const pool = resources.pools[link.linkId];
    if (!pool || pool.shared < amount) return { error: 'Insufficient shared resources', available: pool ? pool.shared : 0 };

    pool.shared -= amount;
    pool.consumed[this.instanceId] = (pool.consumed[this.instanceId] || 0) + amount;
    link.resourceBalance -= amount;

    resources.transfers.push({
      from: instanceId, to: this.instanceId, type: resourceType,
      amount, linkId: link.linkId, timestamp: Date.now(),
    });
    if (resources.transfers.length > 300) resources.transfers = resources.transfers.slice(-300);

    this._saveResources(resources);
    this._saveLinks(data);
    return { consumed: true, resourceType, amount, poolRemaining: pool.shared };
  }

  /**
   * Evolve a relationship type based on interaction history.
   */
  evolveRelationship(instanceId) {
    this._load();
    const data = this._getLinks();
    const link = data.links[instanceId];
    if (!link) return { error: 'No link found' };

    const health = this._getHealth();
    const assessment = health.assessments[link.linkId];
    const oldType = link.type;
    let newType = oldType;
    let reason = 'no change';

    if (assessment) {
      // If health is degrading and link is mutualism → might become commensalism
      if (oldType === 'mutualism' && assessment.healthScore < 0.4) {
        newType = 'commensalism';
        reason = 'Health declining — asymmetric benefit detected';
      }
      // If resource balance very negative → parasitism
      if (link.resourceBalance < -10) {
        newType = 'parasitism';
        reason = 'Consuming far more than contributing';
      }
      // If commensalism with high health → upgrade to mutualism
      if (oldType === 'commensalism' && assessment.healthScore > 0.85 && link.resourceBalance > -2) {
        newType = 'mutualism';
        reason = 'Balanced, healthy interaction — upgrading';
      }
      // Parasitism recovery
      if (oldType === 'parasitism' && link.resourceBalance > 0 && assessment.healthScore > 0.6) {
        newType = 'commensalism';
        reason = 'Contributing positively — recovering from parasitism';
      }
    }

    if (newType !== oldType) {
      link.type = newType;
      link.evolution = link.evolution || [];
      link.evolution.push({ type: newType, changedAt: Date.now(), reason, from: oldType });
      this._saveLinks(data);
      this.emit('relationship-evolved', { instanceId, from: oldType, to: newType, reason });
    }

    return { instanceId, previousType: oldType, currentType: newType, reason, evolved: newType !== oldType };
  }

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
      if (bucket.updatedBy && bucket.updatedBy !== this.instanceId && bucket.lastUpdated > (link.lastSync || 0)) {
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
    this._recordSyncHealth(link.linkId, instanceId, conflicts.length === 0);

    const result = { instanceId, syncedModules, conflicts, syncCount: link.syncCount, timestamp: Date.now() };
    this.emit('sync-complete', result);
    return result;
  }

  _resolveConflict(type, module, bucket) {
    let strategy, merged = { ...bucket.data };
    switch (type) {
      case 'mutualism': strategy = 'merge-equal'; break;
      case 'commensalism': strategy = 'host-precedence'; break;
      case 'parasitism': strategy = 'parasite-overwrite'; break;
      default: strategy = 'merge-equal';
    }
    return { strategy, merged };
  }

  _recordSyncHealth(linkId, instanceId, success) {
    const health = this._getHealth();
    if (!health.assessments[linkId]) {
      health.assessments[linkId] = {
        linkId, instanceId, syncs: 0, successfulSyncs: 0, failedSyncs: 0,
        conflictCount: 0, healthScore: 1.0, history: [],
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

  getLinks() {
    this._load();
    const data = this._getLinks();
    return Object.values(data.links).map(link => ({
      linkId: link.linkId, instanceId: link.instanceId, type: link.type,
      sharedModules: link.sharedModules, status: link.status,
      linkedAt: link.linkedAt, lastSync: link.lastSync, syncCount: link.syncCount,
      resourceBalance: link.resourceBalance,
      evolution: (link.evolution || []).slice(-5),
    }));
  }

  getColony() { this._load(); return this._getColony(); }

  /**
   * Get colony intelligence — emergent capabilities from collective.
   */
  getColonyIntelligence() {
    this._load();
    const colony = this._getColony();
    const data = this._getLinks();
    const health = this._getHealth();

    if (!colony.id || (colony.members || []).length < 2) {
      return { active: false, message: 'No colony formed — need at least 2 members' };
    }

    const links = Object.values(data.links).filter(l => l.status === 'active');
    const totalSyncs = links.reduce((s, l) => s + (l.syncCount || 0), 0);
    const avgHealth = Object.values(health.assessments);
    const overallHealth = avgHealth.length > 0 ? avgHealth.reduce((s, a) => s + a.healthScore, 0) / avgHealth.length : 0;

    // Emergent capabilities based on colony size and health
    const emergentCapabilities = [];
    const size = colony.members.length;
    if (size >= 2) emergentCapabilities.push('parallel-reasoning');
    if (size >= 3) emergentCapabilities.push('multi-perspective-analysis');
    if (size >= 4) emergentCapabilities.push('distributed-memory');
    if (size >= 5) emergentCapabilities.push('swarm-creativity');
    if (overallHealth > 0.8 && size >= 3) emergentCapabilities.push('consensus-decision-making');
    if (totalSyncs > 100) emergentCapabilities.push('deep-synchronization');

    // Collective intelligence score
    const rawIQ = size * 20 + overallHealth * 30 + Math.min(totalSyncs / 10, 30) + emergentCapabilities.length * 5;
    const colonyIQ = Math.round(Math.min(200, rawIQ));

    // Relationship map
    const relationships = {};
    for (const link of links) {
      relationships[link.instanceId] = { type: link.type, health: null, resourceBalance: link.resourceBalance };
      const a = health.assessments[link.linkId];
      if (a) relationships[link.instanceId].health = a.healthScore;
    }

    return {
      active: true,
      colonyId: colony.id,
      size,
      colonyIQ,
      overallHealth: Math.round(overallHealth * 100) / 100,
      emergentCapabilities,
      totalSyncs,
      relationships,
      emergent: colony.emergent,
    };
  }

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
    colony.emergent = members.size >= 3;

    this._saveColony(colony);
    if (isNew && members.size >= 2) this.emit('colony-formed', { id: colony.id, members: colony.members });
  }

  getHealth(linkId) {
    this._load();
    const health = this._getHealth();
    if (linkId) {
      const a = health.assessments[linkId];
      if (!a) return { error: 'No health data', linkId };
      return { ...a, quality: a.healthScore >= 0.9 ? 'thriving' : a.healthScore >= 0.7 ? 'healthy' : a.healthScore >= 0.4 ? 'strained' : 'deteriorating' };
    }
    return {
      links: Object.values(health.assessments).map(a => ({
        linkId: a.linkId, instanceId: a.instanceId, healthScore: a.healthScore, syncs: a.syncs,
        quality: a.healthScore >= 0.9 ? 'thriving' : a.healthScore >= 0.7 ? 'healthy' : a.healthScore >= 0.4 ? 'strained' : 'deteriorating',
      })),
    };
  }

  /**
   * Get resource sharing summary.
   */
  getResourceSummary() {
    this._load();
    const resources = this._getResources();
    const summary = {};
    for (const [linkId, pool] of Object.entries(resources.pools)) {
      summary[linkId] = {
        totalShared: pool.shared,
        contributed: pool.contributed,
        consumed: pool.consumed,
      };
    }
    return { pools: summary, recentTransfers: (resources.transfers || []).slice(-20).reverse() };
  }

  tick() {
    this._load();
    const data = this._getLinks();
    const issues = [];
    const syncResults = [];

    for (const [instanceId, link] of Object.entries(data.links)) {
      if (link.status !== 'active') continue;

      // Auto-sync
      if (!link.lastSync || (Date.now() - link.lastSync) > this.config.syncIntervalMs) {
        syncResults.push(this.sync(instanceId));
      }

      // Relationship evolution check
      this.evolveRelationship(instanceId);

      // Health monitoring
      const health = this._getHealth();
      const assessment = health.assessments[link.linkId];
      if (assessment) {
        // Parasitic health drain
        if (link.type === 'parasitism') {
          assessment.healthScore = Math.max(0, assessment.healthScore - this.config.parasiteHealthDrain);
          this._saveHealth(health);
        }
        // Mutualism bonus
        if (link.type === 'mutualism') {
          assessment.healthScore = Math.min(1, assessment.healthScore + this.config.mutualismBonus);
          this._saveHealth(health);
        }

        if (link.type === 'parasitism' && assessment.healthScore < 0.3) {
          issues.push({ type: 'parasitic_degradation', severity: 'critical', linkId: link.linkId, instanceId,
            message: `Parasitic link with ${instanceId} degrading health.` });
          this.emit('parasitic-warning', { instanceId, healthScore: assessment.healthScore });
        }

        if (assessment.syncs > 50 && assessment.healthScore > 0.95) {
          issues.push({ type: 'identity_erosion_risk', severity: 'warning', linkId: link.linkId, instanceId,
            message: `High sync rate with ${instanceId} — identity erosion risk.` });
          this.emit('independence-warning', { instanceId, syncs: assessment.syncs });
        }
      }
    }

    const colony = this._getColony();
    const colonyHealthy = issues.filter(i => i.severity === 'critical').length === 0;
    const intelligence = this.getColonyIntelligence();

    const result = {
      activeLinks: Object.values(data.links).filter(l => l.status === 'active').length,
      syncResults, issues,
      colony: colony.id ? { id: colony.id, size: colony.size, emergent: colony.emergent, iq: intelligence.colonyIQ } : null,
      healthy: colonyHealthy,
    };
    this.emit('tick', result);
    return result;
  }
}

module.exports = CognitiveSymbiosis;
