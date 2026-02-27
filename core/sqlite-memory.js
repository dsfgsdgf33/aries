/**
 * sqlite-memory.js — JSON-backed memory store with TF-IDF search
 * 
 * No external dependencies. Uses filesystem JSON as a simple indexed store.
 * Database location: data/memory/memory.db.json
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── Mutex ───────────────────────────────────────────────────────────────────

class Mutex {
  constructor() { this._queue = []; this._locked = false; }
  acquire() {
    return new Promise(resolve => {
      if (!this._locked) { this._locked = true; return resolve(); }
      this._queue.push(resolve);
    });
  }
  release() {
    if (this._queue.length > 0) { this._queue.shift()(); }
    else { this._locked = false; }
  }
}

// ─── TF-IDF Engine ──────────────────────────────────────────────────────────

class TfIdf {
  static tokenize(text) {
    return text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 1 && !STOP_WORDS.has(t));
  }

  static termFrequency(tokens) {
    const tf = {};
    for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
    const len = tokens.length || 1;
    for (const t in tf) tf[t] /= len;
    return tf;
  }

  static score(queryTokens, docTokens, idf) {
    const docTf = TfIdf.termFrequency(docTokens);
    let score = 0;
    for (const qt of queryTokens) {
      if (docTf[qt]) score += docTf[qt] * (idf[qt] || 1);
    }
    return score;
  }

  static buildIdf(documents) {
    const N = documents.length || 1;
    const df = {};
    for (const doc of documents) {
      const seen = new Set(doc);
      for (const t of seen) df[t] = (df[t] || 0) + 1;
    }
    const idf = {};
    for (const t in df) idf[t] = Math.log(N / df[t]) + 1;
    return idf;
  }
}

const STOP_WORDS = new Set([
  'the','a','an','is','are','was','were','be','been','being','have','has','had',
  'do','does','did','will','would','could','should','may','might','shall','can',
  'to','of','in','for','on','with','at','by','from','as','into','through','during',
  'before','after','above','below','between','out','off','over','under','again',
  'further','then','once','here','there','when','where','why','how','all','each',
  'every','both','few','more','most','other','some','such','no','nor','not','only',
  'own','same','so','than','too','very','just','because','but','and','or','if','it',
  'its','this','that','these','those','he','she','we','they','i','me','my','your',
  'his','her','our','their','what','which','who','whom'
]);

// ─── Auto-categorization ────────────────────────────────────────────────────

const CATEGORY_KEYWORDS = {
  technical: ['code','bug','error','api','function','server','database','deploy','git','npm','docker','config'],
  personal: ['feel','mood','happy','sad','angry','love','friend','family','health','sleep','exercise'],
  project: ['task','milestone','deadline','plan','goal','feature','release','sprint','roadmap','ticket'],
  learning: ['learn','study','read','book','course','tutorial','concept','theory','understand','research'],
  decision: ['decide','choice','option','tradeoff','pros','cons','alternative','evaluate','compare'],
  reference: ['link','url','resource','tool','library','framework','documentation','example','template'],
};

function autoCategory(text) {
  const lower = text.toLowerCase();
  let best = 'general', bestCount = 0;
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    const count = keywords.filter(k => lower.includes(k)).length;
    if (count > bestCount) { bestCount = count; best = cat; }
  }
  return best;
}

function extractKeywords(text, n = 10) {
  const tokens = TfIdf.tokenize(text);
  const tf = TfIdf.termFrequency(tokens);
  return Object.entries(tf).sort((a, b) => b[1] - a[1]).slice(0, n).map(e => e[0]);
}

// ─── MemoryDB ───────────────────────────────────────────────────────────────

const EMPTY_DB = () => ({
  memories: [],
  conversations: [],
  entities: [],
  summaries: [],
  meta: { created: Date.now(), version: 1, lastCompact: 0 }
});

let _instance = null;

class MemoryDB {
  /**
   * @param {string} [baseDir] — project root (defaults to cwd)
   */
  constructor(baseDir) {
    this.baseDir = baseDir || process.cwd();
    this.dbPath = path.join(this.baseDir, 'data', 'memory', 'memory.db.json');
    this.mutex = new Mutex();
    this.dirty = false;
    this.db = null;
    this._saveTimer = null;
    this._indexes = { memoryText: {}, entityName: {} };
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  async init() {
    await this.mutex.acquire();
    try {
      this._ensureDir();
      if (fs.existsSync(this.dbPath)) {
        const raw = fs.readFileSync(this.dbPath, 'utf-8');
        this.db = JSON.parse(raw);
        // Ensure all tables exist (forward compat)
        for (const k of ['memories', 'conversations', 'entities', 'summaries']) {
          if (!this.db[k]) this.db[k] = [];
        }
        if (!this.db.meta) this.db.meta = { created: Date.now(), version: 1, lastCompact: 0 };
      } else {
        this.db = EMPTY_DB();
        this._writeToDisk();
      }
      this._rebuildIndexes();
    } finally {
      this.mutex.release();
    }

    // Auto-save interval
    this._saveTimer = setInterval(() => this._autoSave(), 30_000);
    if (this._saveTimer.unref) this._saveTimer.unref();

    // Save on exit
    const exitHandler = () => { this._syncSave(); };
    process.on('exit', exitHandler);
    process.on('SIGINT', () => { exitHandler(); process.exit(0); });
    process.on('SIGTERM', () => { exitHandler(); process.exit(0); });

    return this;
  }

  _ensureDir() {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  _writeToDisk() {
    const tmp = this.dbPath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2), 'utf-8');
    fs.renameSync(tmp, this.dbPath);
    this.dirty = false;
  }

  _syncSave() {
    if (this.dirty && this.db) {
      try { this._writeToDisk(); } catch (_) { /* best effort */ }
    }
  }

  async _autoSave() {
    if (!this.dirty) return;
    await this.mutex.acquire();
    try { this._writeToDisk(); } finally { this.mutex.release(); }
  }

  _rebuildIndexes() {
    this._indexes.entityName = {};
    for (let i = 0; i < this.db.entities.length; i++) {
      const e = this.db.entities[i];
      this._indexes.entityName[e.name.toLowerCase()] = i;
    }
  }

  _uid() { return crypto.randomUUID(); }

  close() {
    if (this._saveTimer) { clearInterval(this._saveTimer); this._saveTimer = null; }
    this._syncSave();
    _instance = null;
  }

  // ── Memories ───────────────────────────────────────────────────────────

  async addMemory(text, opts = {}) {
    await this.mutex.acquire();
    try {
      const mem = {
        id: this._uid(),
        text,
        category: opts.category || autoCategory(text),
        priority: opts.priority ?? 0,
        tags: opts.tags || extractKeywords(text, 5),
        embedding: null,
        timestamp: opts.timestamp || Date.now(),
        source: opts.source || 'manual',
      };
      this.db.memories.push(mem);
      this.dirty = true;
      return mem;
    } finally { this.mutex.release(); }
  }

  async search(query, limit = 10) {
    const qTokens = TfIdf.tokenize(query);
    if (qTokens.length === 0) return [];

    const docs = this.db.memories.map(m => TfIdf.tokenize(m.text));
    const idf = TfIdf.buildIdf(docs);

    const scored = this.db.memories.map((m, i) => ({
      memory: m,
      score: TfIdf.score(qTokens, docs[i], idf),
    })).filter(r => r.score > 0);

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  async getRelevant(query, limit = 10) {
    const keywords = extractKeywords(query, 8);
    const expandedQuery = keywords.join(' ') + ' ' + query;
    return this.search(expandedQuery, limit);
  }

  // ── Conversations ──────────────────────────────────────────────────────

  async addConversation(sessionId, role, content, model) {
    await this.mutex.acquire();
    try {
      const entry = {
        id: this._uid(),
        sessionId,
        role,
        content,
        model: model || null,
        timestamp: Date.now(),
        tokenCount: Math.ceil(content.length / 4), // rough estimate
      };
      this.db.conversations.push(entry);
      this.dirty = true;
      return entry;
    } finally { this.mutex.release(); }
  }

  // ── Entities ───────────────────────────────────────────────────────────

  async addEntity(type, name, properties = {}) {
    await this.mutex.acquire();
    try {
      const key = name.toLowerCase();
      const idx = this._indexes.entityName[key];
      if (idx !== undefined && idx < this.db.entities.length) {
        const existing = this.db.entities[idx];
        Object.assign(existing.properties, properties);
        existing.lastSeen = Date.now();
        if (type) existing.type = type;
        this.dirty = true;
        return existing;
      }
      const entity = {
        id: this._uid(),
        type,
        name,
        properties,
        relations: [],
        lastSeen: Date.now(),
      };
      this._indexes.entityName[key] = this.db.entities.length;
      this.db.entities.push(entity);
      this.dirty = true;
      return entity;
    } finally { this.mutex.release(); }
  }

  async getEntity(name) {
    const idx = this._indexes.entityName[name.toLowerCase()];
    if (idx === undefined) return null;
    return this.db.entities[idx] || null;
  }

  async linkEntities(id1, id2, relation) {
    await this.mutex.acquire();
    try {
      const e1 = this.db.entities.find(e => e.id === id1);
      const e2 = this.db.entities.find(e => e.id === id2);
      if (!e1 || !e2) throw new Error('Entity not found');
      e1.relations.push({ target: id2, relation, timestamp: Date.now() });
      e2.relations.push({ target: id1, relation: `inverse:${relation}`, timestamp: Date.now() });
      this.dirty = true;
    } finally { this.mutex.release(); }
  }

  // ── Compact / Summarize ────────────────────────────────────────────────

  async compact(olderThan) {
    const cutoff = olderThan instanceof Date ? olderThan.getTime()
      : typeof olderThan === 'number' ? Date.now() - olderThan
      : Date.now() - 7 * 86400_000; // default 7 days

    await this.mutex.acquire();
    try {
      // Group old conversations by session
      const old = this.db.conversations.filter(c => c.timestamp < cutoff);
      if (old.length === 0) return { summarized: 0, deduped: 0 };

      const sessions = {};
      for (const c of old) {
        (sessions[c.sessionId] = sessions[c.sessionId] || []).push(c);
      }

      let summarized = 0;
      for (const [sid, convos] of Object.entries(sessions)) {
        const text = convos.map(c => `${c.role}: ${c.content.slice(0, 200)}`).join('\n');
        const summary = {
          id: this._uid(),
          sourceIds: convos.map(c => c.id),
          summary: `Session ${sid}: ${convos.length} messages. Topics: ${extractKeywords(text, 5).join(', ')}`,
          period: { from: convos[0].timestamp, to: convos[convos.length - 1].timestamp },
          timestamp: Date.now(),
        };
        this.db.summaries.push(summary);
        summarized += convos.length;
      }

      // Remove compacted conversations
      const oldIds = new Set(old.map(c => c.id));
      this.db.conversations = this.db.conversations.filter(c => !oldIds.has(c.id));

      // Deduplicate memories (exact text match)
      const seen = new Set();
      let deduped = 0;
      this.db.memories = this.db.memories.filter(m => {
        const key = m.text.trim().toLowerCase();
        if (seen.has(key)) { deduped++; return false; }
        seen.add(key);
        return true;
      });

      this.db.meta.lastCompact = Date.now();
      this.dirty = true;
      this._rebuildIndexes();
      return { summarized, deduped };
    } finally { this.mutex.release(); }
  }

  // ── Stats & Export ─────────────────────────────────────────────────────

  getStats() {
    let diskSize = 0;
    try { diskSize = fs.statSync(this.dbPath).size; } catch (_) {}
    return {
      memories: this.db.memories.length,
      conversations: this.db.conversations.length,
      entities: this.db.entities.length,
      summaries: this.db.summaries.length,
      diskSize,
      lastCompact: this.db.meta.lastCompact,
    };
  }

  export() {
    return JSON.parse(JSON.stringify(this.db));
  }

  // ── Import from file-based memory ─────────────────────────────────────

  async importFromFiles(memoryDir) {
    const report = { memories: 0, errors: [] };
    const dir = memoryDir || path.join(this.baseDir);

    // Import MEMORY.md
    const memoryMd = path.join(dir, 'MEMORY.md');
    if (fs.existsSync(memoryMd)) {
      try {
        const content = fs.readFileSync(memoryMd, 'utf-8');
        const sections = content.split(/^##\s+/m).filter(Boolean);
        for (const section of sections) {
          const lines = section.trim().split('\n');
          const title = lines[0]?.trim() || 'Imported';
          const body = lines.slice(1).join('\n').trim();
          if (body.length > 10) {
            await this.addMemory(body, {
              source: 'import:MEMORY.md',
              tags: extractKeywords(title + ' ' + body, 5),
              category: autoCategory(body),
            });
            report.memories++;
          }
        }
      } catch (err) {
        report.errors.push(`MEMORY.md: ${err.message}`);
      }
    }

    // Import memory/*.md
    const memDir = path.join(dir, 'memory');
    if (fs.existsSync(memDir)) {
      const files = fs.readdirSync(memDir).filter(f => f.endsWith('.md'));
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(memDir, file), 'utf-8');
          // Parse date from filename if possible (YYYY-MM-DD.md)
          const dateMatch = file.match(/(\d{4}-\d{2}-\d{2})/);
          const timestamp = dateMatch ? new Date(dateMatch[1]).getTime() : Date.now();

          // Split by headings
          const sections = content.split(/^##?\s+/m).filter(s => s.trim().length > 10);
          if (sections.length === 0 && content.trim().length > 10) {
            sections.push(content);
          }
          for (const section of sections) {
            await this.addMemory(section.trim(), {
              source: `import:memory/${file}`,
              timestamp,
            });
            report.memories++;
          }
        } catch (err) {
          report.errors.push(`memory/${file}: ${err.message}`);
        }
      }
    }

    return report;
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

async function getInstance(baseDir) {
  if (!_instance) {
    _instance = new MemoryDB(baseDir);
    await _instance.init();
  }
  return _instance;
}

module.exports = { MemoryDB, getInstance };
