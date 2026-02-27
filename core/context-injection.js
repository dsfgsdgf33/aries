'use strict';

/**
 * @module context-injection
 * @description Before any AI call, automatically enriches the prompt with relevant context
 * using TF-IDF scoring across knowledge graph, memory DB, conversation history, and reflection insights.
 */

const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
  'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
  'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'both',
  'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
  'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just',
  'don', 'now', 'and', 'but', 'or', 'if', 'it', 'its', 'i', 'me', 'my',
  'we', 'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her', 'they',
  'them', 'their', 'this', 'that', 'these', 'those', 'what', 'which', 'who',
]);

class ContextInjection extends EventEmitter {
  constructor() {
    super();
    this._config = {
      maxTokens: 2000,
      relevanceThreshold: 0.1,
      sources: { knowledgeGraph: true, memoryDb: true, recentContext: true, insights: true },
      maxMemories: 5,
      maxEntities: 5,
      maxRecentContext: 3,
      maxInsights: 5,
    };
    this._stats = { enrichCalls: 0, totalMemories: 0, totalEntities: 0, totalInsights: 0, avgRelevance: 0 };
    this._knowledgeGraph = null;
    this._memoryDb = null;
    this._selfReflection = null;
  }

  /**
   * Lazily load dependent modules.
   */
  _getKnowledgeGraph() {
    if (this._knowledgeGraph) return this._knowledgeGraph;
    try {
      const kg = require('./knowledge-graph.js');
      this._knowledgeGraph = typeof kg.getInstance === 'function' ? kg.getInstance() : kg;
    } catch {}
    return this._knowledgeGraph;
  }

  _getMemoryDb() {
    if (this._memoryDb) return this._memoryDb;
    try {
      const mem = require('./sqlite-memory.js');
      this._memoryDb = typeof mem.getInstance === 'function' ? mem.getInstance() : mem;
    } catch {}
    return this._memoryDb;
  }

  _getSelfReflection() {
    if (this._selfReflection) return this._selfReflection;
    try {
      const sr = require('./self-reflection.js');
      this._selfReflection = typeof sr.getInstance === 'function' ? sr.getInstance() : sr;
    } catch {}
    return this._selfReflection;
  }

  /**
   * Tokenize text into meaningful terms.
   */
  _tokenize(text) {
    return text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w));
  }

  /**
   * Compute term frequency for a token array.
   */
  _tf(tokens) {
    const freq = {};
    for (const t of tokens) freq[t] = (freq[t] || 0) + 1;
    const max = Math.max(...Object.values(freq), 1);
    const tf = {};
    for (const t in freq) tf[t] = freq[t] / max;
    return tf;
  }

  /**
   * Compute IDF across a corpus of documents (arrays of tokens).
   */
  _idf(corpus) {
    const N = corpus.length;
    const df = {};
    for (const doc of corpus) {
      const seen = new Set(doc);
      for (const t of seen) df[t] = (df[t] || 0) + 1;
    }
    const idf = {};
    for (const t in df) idf[t] = Math.log((N + 1) / (df[t] + 1)) + 1;
    return idf;
  }

  /**
   * Score relevance of a candidate text against query tokens using TF-IDF cosine similarity.
   */
  _scoreRelevance(queryTokens, queryTf, idf, candidateTokens) {
    const candTf = this._tf(candidateTokens);
    let dot = 0, magQ = 0, magC = 0;
    const allTerms = new Set([...Object.keys(queryTf), ...Object.keys(candTf)]);
    for (const t of allTerms) {
      const qw = (queryTf[t] || 0) * (idf[t] || 1);
      const cw = (candTf[t] || 0) * (idf[t] || 1);
      dot += qw * cw;
      magQ += qw * qw;
      magC += cw * cw;
    }
    const denom = Math.sqrt(magQ) * Math.sqrt(magC);
    return denom > 0 ? dot / denom : 0;
  }

  /**
   * Enrich a user message with relevant context from all configured sources.
   * @param {string} message - The user's message
   * @param {Object} [options] - Override config for this call
   * @returns {Object} { memories: [], entities: [], recentContext: [], insights: [], contextBlock: string }
   */
  async enrich(message, options = {}) {
    const cfg = { ...this._config, ...options };
    const queryTokens = this._tokenize(message);
    const queryTf = this._tf(queryTokens);
    const result = { memories: [], entities: [], recentContext: [], insights: [], contextBlock: '' };
    const allDocs = [queryTokens]; // corpus for IDF

    // Collect candidates from all sources
    const candidates = [];

    // 1. Memory DB
    if (cfg.sources.memoryDb) {
      const db = this._getMemoryDb();
      if (db) {
        try {
          let memories = [];
          if (typeof db.search === 'function') {
            memories = await db.search(message, cfg.maxMemories * 3);
          } else if (typeof db.getAll === 'function') {
            memories = await db.getAll();
          } else if (typeof db.query === 'function') {
            memories = await db.query(message);
          }
          for (const m of (memories || [])) {
            const text = typeof m === 'string' ? m : (m.content || m.text || m.value || JSON.stringify(m));
            const tokens = this._tokenize(text);
            allDocs.push(tokens);
            candidates.push({ type: 'memory', text, tokens, original: m });
          }
        } catch {}
      }
    }

    // 2. Knowledge Graph
    if (cfg.sources.knowledgeGraph) {
      const kg = this._getKnowledgeGraph();
      if (kg) {
        try {
          let entities = [];
          if (typeof kg.search === 'function') {
            entities = await kg.search(message);
          } else if (typeof kg.getEntities === 'function') {
            entities = await kg.getEntities();
          } else if (typeof kg.query === 'function') {
            entities = await kg.query(message);
          }
          for (const e of (entities || [])) {
            const text = typeof e === 'string' ? e : (e.name || '') + ' ' + (e.description || '') + ' ' + JSON.stringify(e.properties || {});
            const tokens = this._tokenize(text);
            allDocs.push(tokens);
            candidates.push({ type: 'entity', text, tokens, original: e });
          }
        } catch {}
      }
    }

    // 3. Recent conversation context (from memory files)
    if (cfg.sources.recentContext) {
      try {
        const memDir = path.join(__dirname, 'memory');
        const files = await fs.promises.readdir(memDir).catch(() => []);
        const dateFiles = files.filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort().reverse().slice(0, 3);
        for (const f of dateFiles) {
          try {
            const content = await fs.promises.readFile(path.join(memDir, f), 'utf8');
            const chunks = content.split(/\n#{1,3}\s/).filter(c => c.trim().length > 20);
            for (const chunk of chunks.slice(-10)) {
              const tokens = this._tokenize(chunk);
              allDocs.push(tokens);
              candidates.push({ type: 'recentContext', text: chunk.slice(0, 500), tokens, original: { file: f } });
            }
          } catch {}
        }
      } catch {}
    }

    // 4. Reflection insights
    if (cfg.sources.insights) {
      const sr = this._getSelfReflection();
      if (sr) {
        try {
          const insights = await sr.getInsights(cfg.maxInsights * 3);
          for (const i of (insights || [])) {
            const text = i.text || '';
            const tokens = this._tokenize(text);
            allDocs.push(tokens);
            candidates.push({ type: 'insight', text, tokens, original: i });
          }
        } catch {}
      }
    }

    // Compute IDF across all collected docs
    const idf = this._idf(allDocs);

    // Score and rank each candidate
    const scored = candidates.map(c => ({
      ...c,
      score: this._scoreRelevance(queryTokens, queryTf, idf, c.tokens),
    })).filter(c => c.score >= cfg.relevanceThreshold).sort((a, b) => b.score - a.score);

    // Distribute into result buckets with limits
    const limits = { memory: cfg.maxMemories, entity: cfg.maxEntities, recentContext: cfg.maxRecentContext, insight: cfg.maxInsights };
    const counts = { memory: 0, entity: 0, recentContext: 0, insight: 0 };
    let totalChars = 0;
    const approxMaxChars = cfg.maxTokens * 4; // rough token-to-char ratio

    for (const item of scored) {
      if (totalChars >= approxMaxChars) break;
      if (counts[item.type] >= limits[item.type]) continue;

      const entry = { text: item.text, score: Math.round(item.score * 1000) / 1000, source: item.original };
      const bucket = item.type === 'memory' ? 'memories' : item.type === 'entity' ? 'entities' : item.type === 'recentContext' ? 'recentContext' : 'insights';
      result[bucket].push(entry);
      counts[item.type]++;
      totalChars += item.text.length;
    }

    // Build context block string
    const parts = [];
    if (result.memories.length) parts.push(`## Relevant Memories\n${result.memories.map(m => `- ${m.text}`).join('\n')}`);
    if (result.entities.length) parts.push(`## Related Entities\n${result.entities.map(e => `- ${e.text}`).join('\n')}`);
    if (result.recentContext.length) parts.push(`## Recent Context\n${result.recentContext.map(c => `- ${c.text.slice(0, 200)}`).join('\n')}`);
    if (result.insights.length) parts.push(`## Insights\n${result.insights.map(i => `- ${i.text}`).join('\n')}`);
    result.contextBlock = parts.join('\n\n');

    // Update stats
    this._stats.enrichCalls++;
    this._stats.totalMemories += result.memories.length;
    this._stats.totalEntities += result.entities.length;
    this._stats.totalInsights += result.insights.length;
    const allScores = scored.map(s => s.score);
    if (allScores.length) {
      this._stats.avgRelevance = Math.round((allScores.reduce((a, b) => a + b, 0) / allScores.length) * 1000) / 1000;
    }

    return result;
  }

  /**
   * Update configuration.
   */
  configure(settings) {
    Object.assign(this._config, settings);
    if (settings.sources) this._config.sources = { ...this._config.sources, ...settings.sources };
  }

  getStats() {
    return { ...this._stats };
  }
}

let _instance = null;
function getInstance() {
  if (!_instance) _instance = new ContextInjection();
  return _instance;
}

module.exports = { ContextInjection, getInstance };
