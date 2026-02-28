/**
 * ARIES — Knowledge Distiller
 * Auto-wiki from research. Compress findings into searchable wiki entries.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'knowledge');
const WIKI_PATH = path.join(DATA_DIR, 'wiki.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

class KnowledgeDistiller {
  constructor(opts) {
    ensureDir();
    this.ai = opts && opts.ai;
  }

  /**
   * Distill research into a wiki entry. Creates or updates.
   */
  async distill(topic, research) {
    if (!topic) return { error: 'Topic required' };

    const wiki = readJSON(WIKI_PATH, []);

    // Check for existing entry on same topic
    const existing = wiki.find(e => e.topic.toLowerCase() === topic.toLowerCase());

    let summary, details, tags;

    if (this.ai && typeof this.ai.chat === 'function') {
      try {
        const resp = await this.ai.chat([
          { role: 'system', content: 'You are a knowledge distiller. Compress research into a concise wiki entry. Return JSON: { "summary": "2-3 sentence summary", "details": "detailed markdown content", "tags": ["tag1", "tag2"] }' },
          { role: 'user', content: 'Topic: ' + topic + '\n\nResearch:\n' + (research || '').slice(0, 3000) }
        ]);
        const parsed = JSON.parse((resp.response || '').replace(/```json\n?/g, '').replace(/```/g, '').trim());
        summary = parsed.summary || '';
        details = parsed.details || research || '';
        tags = parsed.tags || [];
      } catch {
        summary = (research || '').slice(0, 200);
        details = research || '';
        tags = this._autoTag(topic, research);
      }
    } else {
      summary = (research || '').slice(0, 200);
      details = research || '';
      tags = this._autoTag(topic, research);
    }

    if (existing) {
      // Update existing entry
      existing.summary = summary || existing.summary;
      existing.details = details || existing.details;
      existing.tags = [...new Set([...(existing.tags || []), ...tags])];
      existing.updatedAt = Date.now();
      existing.sources = [...new Set([...(existing.sources || []), ...(this._extractSources(research) || [])])];
      writeJSON(WIKI_PATH, wiki);
      return existing;
    }

    // Create new entry
    const entry = {
      id: uuid(),
      topic,
      summary,
      details,
      sources: this._extractSources(research) || [],
      tags,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      accessCount: 0,
    };

    wiki.push(entry);
    writeJSON(WIKI_PATH, wiki);
    return entry;
  }

  _autoTag(topic, research) {
    const text = ((topic || '') + ' ' + (research || '')).toLowerCase();
    const tagMap = {
      'javascript': 'javascript', 'python': 'python', 'react': 'react', 'node': 'nodejs',
      'api': 'api', 'database': 'database', 'security': 'security', 'trading': 'trading',
      'crypto': 'crypto', 'ai': 'ai', 'machine learning': 'ml', 'docker': 'docker',
      'linux': 'linux', 'windows': 'windows', 'network': 'networking', 'css': 'css',
      'html': 'html', 'typescript': 'typescript', 'rust': 'rust', 'algorithm': 'algorithms',
    };
    const tags = [];
    for (const [keyword, tag] of Object.entries(tagMap)) {
      if (text.includes(keyword)) tags.push(tag);
    }
    return tags.length > 0 ? tags : ['general'];
  }

  _extractSources(text) {
    if (!text) return [];
    const urlRegex = /https?:\/\/[^\s)]+/g;
    return (text.match(urlRegex) || []).slice(0, 10);
  }

  /**
   * Fuzzy search across wiki.
   */
  search(query) {
    if (!query) return [];
    const wiki = readJSON(WIKI_PATH, []);
    const q = query.toLowerCase();
    const terms = q.split(/\s+/).filter(t => t.length > 1);

    return wiki
      .map(entry => {
        let score = 0;
        const text = (entry.topic + ' ' + entry.summary + ' ' + (entry.tags || []).join(' ') + ' ' + entry.details).toLowerCase();

        for (const term of terms) {
          if (entry.topic.toLowerCase().includes(term)) score += 10;
          if ((entry.tags || []).some(t => t.includes(term))) score += 5;
          if (entry.summary.toLowerCase().includes(term)) score += 3;
          if (text.includes(term)) score += 1;
        }

        return { ...entry, _score: score };
      })
      .filter(e => e._score > 0)
      .sort((a, b) => b._score - a._score)
      .slice(0, 20)
      .map(e => { delete e._score; return e; });
  }

  /**
   * Get a single entry by ID.
   */
  getEntry(id) {
    const wiki = readJSON(WIKI_PATH, []);
    const entry = wiki.find(e => e.id === id);
    if (entry) {
      entry.accessCount = (entry.accessCount || 0) + 1;
      writeJSON(WIKI_PATH, wiki);
    }
    return entry || null;
  }

  /**
   * Get all entries (paginated).
   */
  getAll(limit, offset) {
    const wiki = readJSON(WIKI_PATH, []);
    const off = offset || 0;
    const lim = limit || 50;
    return {
      entries: wiki.slice(off, off + lim),
      total: wiki.length,
    };
  }

  /**
   * Get most accessed entries.
   */
  getPopular(limit) {
    const wiki = readJSON(WIKI_PATH, []);
    return wiki
      .sort((a, b) => (b.accessCount || 0) - (a.accessCount || 0))
      .slice(0, limit || 10);
  }

  /**
   * Get all tags with counts.
   */
  getTags() {
    const wiki = readJSON(WIKI_PATH, []);
    const tagCounts = {};
    for (const entry of wiki) {
      for (const tag of (entry.tags || [])) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    }
    return Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([tag, count]) => ({ tag, count }));
  }

  /**
   * Update an entry manually.
   */
  updateEntry(id, updates) {
    const wiki = readJSON(WIKI_PATH, []);
    const entry = wiki.find(e => e.id === id);
    if (!entry) return { error: 'Entry not found' };

    if (updates.topic) entry.topic = updates.topic;
    if (updates.summary) entry.summary = updates.summary;
    if (updates.details) entry.details = updates.details;
    if (updates.tags) entry.tags = updates.tags;
    if (updates.sources) entry.sources = updates.sources;
    entry.updatedAt = Date.now();

    writeJSON(WIKI_PATH, wiki);
    return entry;
  }

  /**
   * Delete an entry.
   */
  deleteEntry(id) {
    const wiki = readJSON(WIKI_PATH, []);
    const idx = wiki.findIndex(e => e.id === id);
    if (idx === -1) return { error: 'Entry not found' };
    wiki.splice(idx, 1);
    writeJSON(WIKI_PATH, wiki);
    return { deleted: id };
  }
}

module.exports = KnowledgeDistiller;
