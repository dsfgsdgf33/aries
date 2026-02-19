/**
 * ARIES Shared Data Layer v3.0
 * 
 * In-memory key-value store with persistence and pub/sub.
 * Agents can publish findings that other agents pick up.
 */

const fs = require('fs');
const path = require('path');

class SharedData {
  constructor(persistPath) {
    this.persistPath = persistPath || path.join(__dirname, '..', 'data', 'shared-store.json');
    this.store = {};
    this.subscribers = new Map(); // key -> [callback]
    this.globalSubscribers = []; // called on any change
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.persistPath)) {
        this.store = JSON.parse(fs.readFileSync(this.persistPath, 'utf8'));
      }
    } catch {
      this.store = {};
    }
  }

  _save() {
    try {
      const dir = path.dirname(this.persistPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.persistPath, JSON.stringify(this.store, null, 2));
    } catch {}
  }

  _notify(key, value) {
    const subs = this.subscribers.get(key);
    if (subs) subs.forEach(cb => { try { cb(key, value); } catch {} });
    this.globalSubscribers.forEach(cb => { try { cb(key, value); } catch {} });
  }

  get(key) {
    return this.store[key];
  }

  set(key, value) {
    this.store[key] = value;
    this._save();
    this._notify(key, value);
    return value;
  }

  delete(key) {
    delete this.store[key];
    this._save();
  }

  getAll() {
    return { ...this.store };
  }

  keys() {
    return Object.keys(this.store);
  }

  /** Subscribe to changes on a specific key */
  subscribe(key, callback) {
    if (!this.subscribers.has(key)) this.subscribers.set(key, []);
    this.subscribers.get(key).push(callback);
    return () => {
      const subs = this.subscribers.get(key);
      if (subs) {
        const idx = subs.indexOf(callback);
        if (idx >= 0) subs.splice(idx, 1);
      }
    };
  }

  /** Subscribe to all changes */
  onAny(callback) {
    this.globalSubscribers.push(callback);
    return () => {
      const idx = this.globalSubscribers.indexOf(callback);
      if (idx >= 0) this.globalSubscribers.splice(idx, 1);
    };
  }

  /** Publish a finding from an agent (stored under agent namespace) */
  publish(agentId, key, value) {
    const fullKey = `agent:${agentId}:${key}`;
    this.set(fullKey, { value, publishedBy: agentId, publishedAt: new Date().toISOString() });
    return fullKey;
  }

  /** Get all findings from a specific agent */
  getAgentFindings(agentId) {
    const prefix = `agent:${agentId}:`;
    const findings = {};
    for (const [key, value] of Object.entries(this.store)) {
      if (key.startsWith(prefix)) {
        findings[key.slice(prefix.length)] = value;
      }
    }
    return findings;
  }

  /** Clear all data */
  clear() {
    this.store = {};
    this._save();
  }
}

module.exports = SharedData;
