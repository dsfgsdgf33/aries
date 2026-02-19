/**
 * ARIES v3.0 — Enhanced Persistent Memory System
 * Categories, priorities, TTL, fuzzy search, context injection.
 */

const fs = require('fs');
const path = require('path');

const MEMORY_FILE = path.join(__dirname, '..', 'data', 'memory.json');
const config = (() => { try { return require('../config.json'); } catch { return {}; } })();
const memConfig = config.memory || { maxEntries: 500, autoPrune: true };

const CATEGORIES = ['general', 'trading', 'projects', 'people', 'preferences', 'lessons'];
const PRIORITIES = ['low', 'normal', 'high', 'critical'];

let _cache = null; // In-memory cache

function ensureDir() {
  const dir = path.dirname(MEMORY_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function load() {
  if (_cache) return _cache;
  try {
    const data = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
    _cache = Array.isArray(data) ? data.map(normalize) : [];
  } catch {
    _cache = [];
  }
  return _cache;
}

function normalize(entry) {
  if (typeof entry === 'string') {
    return {
      key: entry.substring(0, 50).replace(/\s+/g, '_'),
      text: entry, timestamp: new Date().toISOString(),
      tags: [], category: 'general', priority: 'normal',
      created: new Date().toISOString(), lastAccessed: null, accessCount: 0, ttl: null
    };
  }
  return {
    key: entry.key || entry.text?.substring(0, 50).replace(/\s+/g, '_') || 'unknown',
    text: entry.text || entry.value || '',
    timestamp: entry.timestamp || new Date().toISOString(),
    tags: entry.tags || [],
    category: entry.category || 'general',
    priority: entry.priority || 'normal',
    created: entry.created || entry.timestamp || new Date().toISOString(),
    lastAccessed: entry.lastAccessed || null,
    accessCount: entry.accessCount || 0,
    ttl: entry.ttl || null, // ms until expiry, null = never
  };
}

function _save(entries) {
  ensureDir();
  _cache = entries;
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(entries, null, 2));
}

function save(entries) {
  _save(entries);
}

/**
 * Save a memory entry.
 * @param {string} keyOrInfo - Key or text to remember
 * @param {string} [value] - Value (if key provided separately)
 * @param {string} [category] - Category
 * @param {string} [priority] - Priority level
 */
function add(keyOrInfo, value, category, priority) {
  const entries = load();
  const isKeyed = value !== undefined;
  const entry = {
    key: isKeyed ? keyOrInfo : keyOrInfo.substring(0, 50).replace(/\s+/g, '_'),
    text: isKeyed ? value : keyOrInfo,
    timestamp: new Date().toISOString(),
    tags: [],
    category: category || 'general',
    priority: priority || 'normal',
    created: new Date().toISOString(),
    lastAccessed: null,
    accessCount: 0,
    ttl: null,
  };

  // Update existing by key
  const idx = entries.findIndex(e => e.key === entry.key);
  if (idx >= 0) {
    entries[idx] = { ...entries[idx], ...entry, accessCount: entries[idx].accessCount };
  } else {
    entries.push(entry);
  }

  if (memConfig.autoPrune && entries.length > memConfig.maxEntries) {
    prune(entries);
  }
  _save(entries);
  return entries.length;
}

/** Get a memory by key */
function get(key) {
  const entries = load();
  const entry = entries.find(e => e.key === key);
  if (entry) {
    entry.lastAccessed = new Date().toISOString();
    entry.accessCount = (entry.accessCount || 0) + 1;
    _save(entries);
  }
  return entry || null;
}

function list(filter = {}) {
  let entries = load();
  // Prune expired entries
  entries = _pruneExpired(entries);
  if (filter.category) entries = entries.filter(e => e.category === filter.category);
  if (filter.tag) entries = entries.filter(e => (e.tags || []).includes(filter.tag));
  if (filter.priority) entries = entries.filter(e => e.priority === filter.priority);
  return entries;
}

function getByCategory(cat) {
  return list({ category: cat });
}

function getAll() {
  return load();
}

/** Fuzzy search across all memories */
function search(query) {
  const q = query.toLowerCase();
  const words = q.split(/\s+/).filter(w => w.length > 1);
  const entries = load();

  return entries
    .map(e => {
      const text = `${e.key} ${e.text} ${(e.tags || []).join(' ')} ${e.category}`.toLowerCase();
      let score = 0;
      // Exact substring match
      if (text.includes(q)) score += 10;
      // Word matches
      for (const w of words) {
        if (text.includes(w)) score += 3;
      }
      return { ...e, _score: score };
    })
    .filter(e => e._score > 0)
    .sort((a, b) => b._score - a._score)
    .map(e => { delete e._score; return e; });
}

/** Get relevant memories for a conversation */
function getRelevant(conversationText, limit = 5) {
  if (!conversationText) return [];
  const results = search(conversationText);
  // Prioritize high-priority entries
  const priorityOrder = { critical: 4, high: 3, normal: 2, low: 1 };
  results.sort((a, b) => (priorityOrder[b.priority] || 2) - (priorityOrder[a.priority] || 2));
  return results.slice(0, limit);
}

function forget(key) {
  const entries = load();
  const idx = entries.findIndex(e => e.key === key);
  if (idx >= 0) {
    entries.splice(idx, 1);
    _save(entries);
    return true;
  }
  // Try by index
  const numIdx = parseInt(key);
  if (!isNaN(numIdx) && numIdx >= 0 && numIdx < entries.length) {
    entries.splice(numIdx, 1);
    _save(entries);
    return true;
  }
  return false;
}

/** Prune expired entries (TTL) */
function _pruneExpired(entries) {
  const now = Date.now();
  const before = entries.length;
  const filtered = entries.filter(e => {
    if (!e.ttl) return true;
    const created = new Date(e.created).getTime();
    return (now - created) < e.ttl;
  });
  if (filtered.length < before) _save(filtered);
  return filtered;
}

/** Prune oldest low-priority entries to stay within maxEntries */
function prune(entries) {
  const max = memConfig.maxEntries || 500;
  if (entries.length <= max) return;
  const priorityOrder = { low: 0, normal: 1, high: 2, critical: 3 };
  entries.sort((a, b) => {
    const pa = priorityOrder[a.priority] || 1;
    const pb = priorityOrder[b.priority] || 1;
    if (pa !== pb) return pa - pb;
    return new Date(a.timestamp) - new Date(b.timestamp);
  });
  entries.splice(0, entries.length - max);
  entries.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

function clear() { _save([]); }

function exportTo(filePath) {
  const entries = load();
  fs.writeFileSync(filePath, JSON.stringify(entries, null, 2));
  return entries.length;
}

function importFrom(filePath) {
  const current = load();
  const imported = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const merged = current.concat(imported.map(normalize));
  _save(merged);
  return imported.length;
}

/** Get memory stats */
function stats() {
  const entries = load();
  const byCat = {};
  const byPri = {};
  for (const e of entries) {
    byCat[e.category] = (byCat[e.category] || 0) + 1;
    byPri[e.priority] = (byPri[e.priority] || 0) + 1;
  }
  return { total: entries.length, byCategory: byCat, byPriority: byPri, categories: CATEGORIES, priorities: PRIORITIES };
}

// Load on require
load();

module.exports = {
  load, save, add, get, list, search, clear, exportTo, importFrom, prune,
  getByCategory, getAll, forget, getRelevant, stats,
  CATEGORIES, PRIORITIES
};
