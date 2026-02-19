/**
 * ARIES v4.2 — RAG Engine (Retrieval-Augmented Generation)
 * Vector-free RAG using keyword extraction + TF-IDF scoring.
 * No npm packages — uses only Node.js built-ins.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DOCS_FILE = path.join(DATA_DIR, 'rag-documents.json');

/** Stop words to exclude from TF-IDF */
const STOP_WORDS = new Set([
  'the','a','an','is','are','was','were','be','been','being','have','has','had',
  'do','does','did','will','would','could','should','may','might','shall','can',
  'to','of','in','for','on','with','at','by','from','as','into','through','during',
  'before','after','above','below','between','out','off','over','under','again',
  'further','then','once','here','there','when','where','why','how','all','both',
  'each','few','more','most','other','some','such','no','nor','not','only','own',
  'same','so','than','too','very','just','because','but','and','or','if','it','its',
  'this','that','these','those','i','me','my','we','our','you','your','he','him',
  'his','she','her','they','them','their','what','which','who','whom',
]);

class RAGEngine extends EventEmitter {
  constructor(config = {}) {
    super();
    this.chunkSize = config.chunkSize || 500;
    this.chunkOverlap = config.chunkOverlap || 100;
    this.topK = config.topK || 5;
    this.documents = [];
    this._load();
  }

  /** Load documents from disk */
  _load() {
    try {
      if (fs.existsSync(DOCS_FILE)) {
        this.documents = JSON.parse(fs.readFileSync(DOCS_FILE, 'utf8'));
      }
    } catch (e) {
      console.error('[RAG] Failed to load documents:', e.message);
      this.documents = [];
    }
  }

  /** Save documents to disk */
  _save() {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DOCS_FILE, JSON.stringify(this.documents, null, 2));
    } catch (e) {
      console.error('[RAG] Failed to save:', e.message);
    }
  }

  /** Split text into overlapping chunks */
  _chunk(text) {
    const chunks = [];
    const clean = text.replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
    if (clean.length <= this.chunkSize) {
      return [clean];
    }
    let start = 0;
    while (start < clean.length) {
      const end = Math.min(start + this.chunkSize, clean.length);
      chunks.push(clean.substring(start, end).trim());
      start += this.chunkSize - this.chunkOverlap;
      if (end >= clean.length) break;
    }
    return chunks.filter(c => c.length > 10);
  }

  /** Extract keywords from text (lowercase, no stop words, length >= 3) */
  _extractKeywords(text) {
    return text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3 && !STOP_WORDS.has(w));
  }

  /** Compute TF-IDF score for a query against a chunk */
  _score(queryKeywords, chunkText) {
    const chunkWords = this._extractKeywords(chunkText);
    if (chunkWords.length === 0) return 0;
    const chunkWordFreq = {};
    for (const w of chunkWords) {
      chunkWordFreq[w] = (chunkWordFreq[w] || 0) + 1;
    }

    let score = 0;
    const totalDocs = Math.max(this.documents.length, 1);

    for (const qw of queryKeywords) {
      const tf = (chunkWordFreq[qw] || 0) / chunkWords.length;
      if (tf === 0) continue;
      // IDF: how many documents contain this word
      let docsWithWord = 0;
      for (const doc of this.documents) {
        if (doc.chunks.some(c => c.toLowerCase().includes(qw))) {
          docsWithWord++;
        }
      }
      const idf = Math.log((totalDocs + 1) / (docsWithWord + 1)) + 1;
      score += tf * idf;
    }
    return score;
  }

  /**
   * Ingest raw text into the knowledge base
   * @param {string} text - The text to ingest
   * @param {string} source - Source identifier
   * @returns {object} The created document
   */
  ingest(text, source = 'manual') {
    const id = crypto.randomUUID();
    const chunks = this._chunk(text);
    const doc = {
      id,
      source,
      chunks,
      metadata: {
        ingestedAt: new Date().toISOString(),
        charCount: text.length,
        chunkCount: chunks.length,
      },
    };
    this.documents.push(doc);
    this._save();
    this.emit('ingested', doc);
    return doc;
  }

  /**
   * Ingest a text file
   * @param {string} filePath - Path to the file
   * @returns {object} The created document
   */
  ingestFile(filePath) {
    const resolved = path.resolve(filePath);
    const text = fs.readFileSync(resolved, 'utf8');
    return this.ingest(text, `file:${resolved}`);
  }

  /**
   * Query the knowledge base and return scored chunks
   * @param {string} question - The query
   * @param {number} topK - Number of results to return
   * @returns {Array} Scored chunks
   */
  query(question, topK) {
    const k = topK || this.topK;
    const queryKeywords = this._extractKeywords(question);
    if (queryKeywords.length === 0) return [];

    const scored = [];
    for (const doc of this.documents) {
      for (let i = 0; i < doc.chunks.length; i++) {
        const s = this._score(queryKeywords, doc.chunks[i]);
        if (s > 0) {
          scored.push({
            score: s,
            text: doc.chunks[i],
            source: doc.source,
            docId: doc.id,
            chunkIndex: i,
          });
        }
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }

  /**
   * Build context string from RAG for injection into AI prompt
   * @param {string} question - The query
   * @returns {string} Context string
   */
  buildContext(question) {
    const results = this.query(question);
    if (results.length === 0) return '';
    let ctx = '=== RELEVANT KNOWLEDGE BASE CONTEXT ===\n';
    for (const r of results) {
      ctx += `[Source: ${r.source} | Relevance: ${r.score.toFixed(3)}]\n${r.text}\n\n`;
    }
    ctx += '=== END CONTEXT ===\n';
    return ctx;
  }

  /**
   * List all documents
   * @returns {Array} Document summaries
   */
  listDocuments() {
    return this.documents.map(d => ({
      id: d.id,
      source: d.source,
      chunkCount: d.chunks.length,
      metadata: d.metadata,
    }));
  }

  /**
   * Delete a document by ID
   * @param {string} id - Document ID
   * @returns {boolean} Whether it was deleted
   */
  deleteDocument(id) {
    const idx = this.documents.findIndex(d => d.id === id);
    if (idx === -1) return false;
    this.documents.splice(idx, 1);
    this._save();
    this.emit('deleted', id);
    return true;
  }
}

module.exports = { RAGEngine };
