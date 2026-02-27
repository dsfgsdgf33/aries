'use strict';

/**
 * @module agent-cloning
 * @description One-click duplication of Hands with different settings. Tracks lineage
 * so clones know their parent and parents know their children.
 */

const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const LINEAGE_FILE = path.join(DATA_DIR, 'clone-lineage.json');

class AgentCloning extends EventEmitter {
  constructor() {
    super();
    this._lineage = {}; // parentId -> [{ cloneId, createdAt, overrides }]
    this._cloneMap = {}; // cloneId -> { parentId, createdAt, overrides }
    this._hands = null;
    this._loaded = false;
  }

  async init() {
    if (this._loaded) return;
    this._loaded = true;
    await fs.promises.mkdir(DATA_DIR, { recursive: true }).catch(() => {});
    await this._load();
  }

  _getHands() {
    if (this._hands) return this._hands;
    try {
      const h = require('./hands.js');
      this._hands = typeof h.getInstance === 'function' ? h.getInstance() : h;
    } catch {
      throw new Error('hands.js module not available');
    }
    return this._hands;
  }

  async _load() {
    try {
      const raw = await fs.promises.readFile(LINEAGE_FILE, 'utf8');
      const data = JSON.parse(raw);
      this._lineage = data.lineage || {};
      this._cloneMap = data.cloneMap || {};
    } catch {}
  }

  async _save() {
    await fs.promises.writeFile(LINEAGE_FILE, JSON.stringify({
      lineage: this._lineage,
      cloneMap: this._cloneMap,
    }, null, 2), 'utf8');
  }

  /**
   * Generate a unique clone ID.
   */
  _generateCloneId(parentId) {
    const existing = (this._lineage[parentId] || []).length;
    return `${parentId}-clone-${existing + 1}`;
  }

  /**
   * Clone a Hand with optional overrides.
   * @param {string} handId - The source Hand ID
   * @param {Object} [overrides={}] - Properties to override in the clone
   * @returns {Object} The cloned Hand definition
   */
  async clone(handId, overrides = {}) {
    await this.init();
    const hands = this._getHands();

    // Get the source hand
    let sourceHand;
    if (typeof hands.status === 'function') {
      sourceHand = hands.status(handId);
    } else if (typeof hands.getHand === 'function') {
      sourceHand = await hands.getHand(handId);
    } else if (typeof hands.get === 'function') {
      sourceHand = await hands.get(handId);
    }
    if (!sourceHand) throw new Error(`Source Hand not found: ${handId}`);

    const cloneId = this._generateCloneId(handId);

    // Deep clone and apply overrides
    const cloneDef = JSON.parse(JSON.stringify(sourceHand));
    cloneDef.id = cloneId;
    Object.assign(cloneDef, overrides);
    cloneDef.id = cloneId; // Ensure ID isn't overridden
    cloneDef.clonedFrom = handId;
    cloneDef.clonedAt = new Date().toISOString();

    // Register the clone with hands module
    if (typeof hands.addHand === 'function') {
      await hands.addHand(cloneDef);
    } else if (typeof hands.register === 'function') {
      await hands.register(cloneDef);
    } else if (typeof hands.add === 'function') {
      await hands.add(cloneDef);
    } else if (typeof hands.create === 'function') {
      await hands.create(cloneDef);
    }

    // Track lineage
    if (!this._lineage[handId]) this._lineage[handId] = [];
    const record = { cloneId, createdAt: cloneDef.clonedAt, overrides: Object.keys(overrides) };
    this._lineage[handId].push(record);
    this._cloneMap[cloneId] = { parentId: handId, createdAt: cloneDef.clonedAt, overrides };

    await this._save();
    this.emit('clone-created', { parentId: handId, cloneId, overrides: Object.keys(overrides) });
    return cloneDef;
  }

  /**
   * Bulk clone a Hand multiple times with different overrides.
   * @param {string} handId
   * @param {number} count
   * @param {Object[]} [overridesArray=[]] - Array of override objects, one per clone
   */
  async cloneMultiple(handId, count, overridesArray = []) {
    await this.init();
    const results = [];
    for (let i = 0; i < count; i++) {
      const overrides = overridesArray[i] || {};
      const clone = await this.clone(handId, overrides);
      results.push(clone);
    }
    this.emit('bulk-clone', { parentId: handId, count, cloneIds: results.map(r => r.id) });
    return results;
  }

  /**
   * Get full lineage tree for a Hand.
   */
  async getLineage(handId) {
    await this.init();
    const result = { handId, parent: null, children: [] };

    // Check if this is a clone
    if (this._cloneMap[handId]) {
      result.parent = this._cloneMap[handId].parentId;
    }

    // Get children
    if (this._lineage[handId]) {
      result.children = this._lineage[handId].map(c => c.cloneId);
    }

    // Recursively get children's children
    const tree = { ...result, descendants: [] };
    const queue = [...result.children];
    while (queue.length > 0) {
      const childId = queue.shift();
      tree.descendants.push(childId);
      if (this._lineage[childId]) {
        for (const c of this._lineage[childId]) {
          queue.push(c.cloneId);
          tree.descendants.push(c.cloneId);
        }
      }
    }

    return tree;
  }

  /**
   * List all clones, optionally filtered by parent.
   */
  async listClones(parentId) {
    await this.init();
    if (parentId) {
      return (this._lineage[parentId] || []).map(c => ({
        cloneId: c.cloneId,
        parentId,
        createdAt: c.createdAt,
        overrides: c.overrides,
      }));
    }
    return Object.entries(this._cloneMap).map(([cloneId, info]) => ({
      cloneId,
      parentId: info.parentId,
      createdAt: info.createdAt,
    }));
  }

  /**
   * Delete a clone.
   */
  async deleteClone(cloneId) {
    await this.init();
    const info = this._cloneMap[cloneId];
    if (!info) throw new Error(`Clone not found: ${cloneId}`);

    // Remove from hands module
    const hands = this._getHands();
    try {
      if (typeof hands.removeHand === 'function') await hands.removeHand(cloneId);
      else if (typeof hands.remove === 'function') await hands.remove(cloneId);
      else if (typeof hands.delete === 'function') await hands.delete(cloneId);
    } catch {}

    // Remove from lineage
    const parentId = info.parentId;
    if (this._lineage[parentId]) {
      this._lineage[parentId] = this._lineage[parentId].filter(c => c.cloneId !== cloneId);
      if (this._lineage[parentId].length === 0) delete this._lineage[parentId];
    }
    delete this._cloneMap[cloneId];

    await this._save();
    this.emit('clone-deleted', { cloneId, parentId });
    return true;
  }

  /**
   * Sync changes from a parent Hand to all its clones.
   * @param {string} parentId
   * @param {Object} [updates] - If provided, apply these specific updates. Otherwise fetches parent's current state.
   */
  async syncFromParent(parentId, updates) {
    await this.init();
    const hands = this._getHands();
    const clones = this._lineage[parentId] || [];
    if (clones.length === 0) return [];

    let parentHand;
    if (!updates) {
      if (typeof hands.getHand === 'function') parentHand = await hands.getHand(parentId);
      else if (typeof hands.get === 'function') parentHand = await hands.get(parentId);
      if (!parentHand) throw new Error(`Parent Hand not found: ${parentId}`);
    }

    const results = [];
    for (const clone of clones) {
      try {
        let cloneHand;
        if (typeof hands.getHand === 'function') cloneHand = await hands.getHand(clone.cloneId);
        else if (typeof hands.get === 'function') cloneHand = await hands.get(clone.cloneId);
        if (!cloneHand) continue;

        // Apply updates, preserving clone-specific overrides
        const cloneOverrides = this._cloneMap[clone.cloneId]?.overrides || {};
        const syncData = updates || parentHand;
        const merged = { ...cloneHand };

        for (const [key, value] of Object.entries(syncData)) {
          if (key === 'id' || key === 'clonedFrom' || key === 'clonedAt') continue;
          // Don't overwrite fields that were originally overridden in the clone
          if (cloneOverrides[key] !== undefined) continue;
          merged[key] = value;
        }

        if (typeof hands.updateHand === 'function') await hands.updateHand(clone.cloneId, merged);
        else if (typeof hands.update === 'function') await hands.update(clone.cloneId, merged);

        results.push({ cloneId: clone.cloneId, synced: true });
      } catch (err) {
        results.push({ cloneId: clone.cloneId, synced: false, error: err.message });
      }
    }

    this.emit('sync-complete', { parentId, results });
    await this._save();
    return results;
  }
}

let _instance = null;
function getInstance() {
  if (!_instance) _instance = new AgentCloning();
  return _instance;
}

module.exports = { AgentCloning, getInstance };
