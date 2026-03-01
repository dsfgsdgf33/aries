/**
 * Knowledge Hub — Layer 8
 * Ingestion engine that converts siloed data into compound intelligence.
 * Pure JS, no dependencies. Simple TF-IDF search.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'knowledge-hub');
const ENTRIES_FILE = path.join(DATA_DIR, 'entries.json');
const INDEX_FILE = path.join(DATA_DIR, 'search-index.json');
const CHUNKS_DIR = path.join(DATA_DIR, 'chunks');

const STOPWORDS = new Set(['the','a','an','is','are','was','were','be','been','being','have','has','had',
  'do','does','did','will','would','shall','should','may','might','must','can','could',
  'i','me','my','we','our','you','your','he','him','his','she','her','it','its','they','them','their',
  'this','that','these','those','am','in','on','at','to','for','of','with','by','from','as','into',
  'through','during','before','after','above','below','between','out','off','over','under','again',
  'further','then','once','here','there','when','where','why','how','all','both','each','few','more',
  'most','other','some','such','no','nor','not','only','own','same','so','than','too','very','and',
  'but','or','if','while','about','up','down','just','also','any','because','what','which','who']);

function ensureDir() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
  try { fs.mkdirSync(CHUNKS_DIR, { recursive: true }); } catch {}
}

function loadJSON(fp, fallback) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return fallback; }
}
function saveJSON(fp, data) {
  ensureDir();
  fs.writeFileSync(fp, JSON.stringify(data, null, 2));
}

function tokenize(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 1 && !STOPWORDS.has(w));
}

class KnowledgeHub {
  constructor() {
    ensureDir();
    this._index = loadJSON(INDEX_FILE, { documents: {}, df: {}, totalDocs: 0 });
  }

  // ── Chunking ──
  _chunk(text, metadata) {
    const chunks = [];
    const paragraphs = text.split(/\n\s*\n/);
    let lineNum = 1;

    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (!trimmed) { lineNum += para.split('\n').length; continue; }

      if (trimmed.length <= 500) {
        chunks.push({ id: crypto.randomUUID(), text: trimmed, metadata: { ...metadata, line: lineNum } });
      } else {
        // Split by sentence
        const sentences = trimmed.match(/[^.!?]+[.!?]+/g) || [trimmed];
        let buf = '';
        for (const s of sentences) {
          if ((buf + s).length > 500 && buf) {
            chunks.push({ id: crypto.randomUUID(), text: buf.trim(), metadata: { ...metadata, line: lineNum } });
            // Overlap: keep last 50 chars
            buf = buf.slice(-50) + s;
          } else {
            buf += s;
          }
        }
        if (buf.trim()) chunks.push({ id: crypto.randomUUID(), text: buf.trim(), metadata: { ...metadata, line: lineNum } });
      }
      lineNum += para.split('\n').length;
    }

    return chunks;
  }

  // ── Entity Extraction ──
  extractEntities(text) {
    const entities = new Set();
    // Capitalized multi-word names (2-4 words)
    const nameRe = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\b/g;
    let m;
    while ((m = nameRe.exec(text))) entities.add(m[1]);
    // Numbers with units
    const numRe = /\b(\d+(?:\.\d+)?\s*(?:miles|km|kg|lbs|dollars|\$|USD|EUR|hours|minutes|mph|GB|MB|TB))\b/gi;
    while ((m = numRe.exec(text))) entities.add(m[1]);
    // Dates
    const dateRe = /\b(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/g;
    while ((m = dateRe.exec(text))) entities.add(m[1]);
    // Emails
    const emailRe = /\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g;
    while ((m = emailRe.exec(text))) entities.add(m[1]);
    // URLs
    const urlRe = /\bhttps?:\/\/[^\s<>]+/g;
    while ((m = urlRe.exec(text))) entities.add(m[0]);

    return Array.from(entities);
  }

  // ── TF-IDF Indexing ──
  _addToIndex(entryId, chunks) {
    const allText = chunks.map(c => c.text).join(' ');
    const tokens = tokenize(allText);
    const tf = {};
    for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
    // Normalize TF
    const maxTf = Math.max(...Object.values(tf), 1);
    const normalizedTf = {};
    for (const [word, count] of Object.entries(tf)) normalizedTf[word] = count / maxTf;

    this._index.documents[entryId] = normalizedTf;
    // Update DF
    for (const word of Object.keys(tf)) {
      this._index.df[word] = (this._index.df[word] || 0) + 1;
    }
    this._index.totalDocs = Object.keys(this._index.documents).length;
    saveJSON(INDEX_FILE, this._index);
  }

  _removeFromIndex(entryId) {
    const doc = this._index.documents[entryId];
    if (doc) {
      for (const word of Object.keys(doc)) {
        if (this._index.df[word]) { this._index.df[word]--; if (this._index.df[word] <= 0) delete this._index.df[word]; }
      }
      delete this._index.documents[entryId];
      this._index.totalDocs = Object.keys(this._index.documents).length;
      saveJSON(INDEX_FILE, this._index);
    }
  }

  // ── CSV Parser ──
  _parseCSV(text) {
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length === 0) return '';
    const headers = this._splitCSVLine(lines[0]);
    const rows = lines.slice(1).map(l => this._splitCSVLine(l));
    return headers.join(' | ') + '\n' + rows.map(r => r.join(' | ')).join('\n');
  }

  _splitCSVLine(line) {
    const fields = [];
    let current = '', inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQuotes = !inQuotes; }
      else if (c === ',' && !inQuotes) { fields.push(current.trim()); current = ''; }
      else { current += c; }
    }
    fields.push(current.trim());
    return fields;
  }

  // ── Ingest ──
  ingestText(text, metadata = {}) {
    const id = 'kh_' + crypto.randomUUID();
    const type = metadata.type || 'text';
    const chunks = this._chunk(text, metadata);
    const entities = this.extractEntities(text);

    const entry = {
      id,
      source: { type, filename: metadata.filename || 'inline', ingested: new Date().toISOString() },
      chunks,
      entities_extracted: entities,
      cross_references: [],
      stats: { chunks: chunks.length, entities: entities.length, size_bytes: Buffer.byteLength(text, 'utf8') }
    };

    // Save entry
    const entries = loadJSON(ENTRIES_FILE, []);
    entries.push(entry);
    saveJSON(ENTRIES_FILE, entries);

    // Index
    this._addToIndex(id, chunks);

    return entry;
  }

  ingest(filePath, type) {
    if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

    const ext = path.extname(filePath).toLowerCase();
    const detectedType = type || { '.csv': 'csv', '.tsv': 'csv', '.json': 'json', '.md': 'text', '.txt': 'text', '.sql': 'sql', '.pdf': 'pdf' }[ext] || 'text';

    if (detectedType === 'pdf') {
      return { error: 'PDF requires pre-extraction. Use ingestText() with extracted text, or use a PDF-to-text tool first.', filePath };
    }

    let text = fs.readFileSync(filePath, 'utf8');
    const filename = path.basename(filePath);

    if (detectedType === 'csv') text = this._parseCSV(text);
    if (detectedType === 'json') {
      try { const obj = JSON.parse(text); text = JSON.stringify(obj, null, 2); } catch {}
    }

    return this.ingestText(text, { type: detectedType, filename });
  }

  // ── Search (TF-IDF) ──
  search(query, limit = 10) {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    const N = this._index.totalDocs || 1;
    const scores = {};

    for (const [docId, tf] of Object.entries(this._index.documents)) {
      let score = 0;
      for (const token of queryTokens) {
        if (tf[token]) {
          const idf = Math.log(N / (this._index.df[token] || 1));
          score += tf[token] * idf;
        }
      }
      if (score > 0) scores[docId] = score;
    }

    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, limit);
    const entries = loadJSON(ENTRIES_FILE, []);

    return sorted.map(([id, score]) => {
      const entry = entries.find(e => e.id === id);
      return { id, score: Math.round(score * 1000) / 1000, source: entry ? entry.source : null, stats: entry ? entry.stats : null };
    });
  }

  // ── CRUD ──
  getEntry(id) {
    return loadJSON(ENTRIES_FILE, []).find(e => e.id === id) || null;
  }

  listEntries(filters = {}) {
    let entries = loadJSON(ENTRIES_FILE, []);
    if (filters.type) entries = entries.filter(e => e.source.type === filters.type);
    if (filters.filename) entries = entries.filter(e => e.source.filename.includes(filters.filename));
    return entries.map(e => ({ id: e.id, source: e.source, stats: e.stats, entities_extracted: e.entities_extracted }));
  }

  deleteEntry(id) {
    const entries = loadJSON(ENTRIES_FILE, []);
    const filtered = entries.filter(e => e.id !== id);
    if (filtered.length === entries.length) return false;
    saveJSON(ENTRIES_FILE, filtered);
    this._removeFromIndex(id);
    return true;
  }

  // ── Cross Reference ──
  crossReference(entryId) {
    const entries = loadJSON(ENTRIES_FILE, []);
    const target = entries.find(e => e.id === entryId);
    if (!target) return [];

    const targetEntities = new Set(target.entities_extracted.map(e => e.toLowerCase()));
    const results = [];

    for (const e of entries) {
      if (e.id === entryId) continue;
      const overlap = e.entities_extracted.filter(ent => targetEntities.has(ent.toLowerCase()));
      if (overlap.length > 0) {
        results.push({ id: e.id, source: e.source, sharedEntities: overlap, overlapCount: overlap.length });
      }
    }

    return results.sort((a, b) => b.overlapCount - a.overlapCount);
  }

  // ── Stats ──
  getStats() {
    const entries = loadJSON(ENTRIES_FILE, []);
    const byType = {};
    let totalChunks = 0, totalEntities = 0, totalBytes = 0;

    for (const e of entries) {
      const t = e.source.type;
      byType[t] = (byType[t] || 0) + 1;
      totalChunks += e.stats.chunks;
      totalEntities += e.stats.entities;
      totalBytes += e.stats.size_bytes;
    }

    return { totalEntries: entries.length, totalChunks, totalEntities, totalBytes, byType };
  }
}

module.exports = KnowledgeHub;
