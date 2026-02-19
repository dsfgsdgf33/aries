/**
 * ARIES v4.4 — Enhanced Persistent Memory System
 * File-based daily notes, long-term memory, session persistence.
 * Uses only Node.js built-in modules.
 */

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

const DATA_DIR = path.join(__dirname, '..', 'data');
const MEMORY_DIR = path.join(DATA_DIR, 'memory');
const LONG_TERM_FILE = path.join(MEMORY_DIR, 'MEMORY.md');
const SESSIONS_FILE = path.join(MEMORY_DIR, 'sessions.json');

class PersistentMemory {
  /**
   * @param {object} config - persistentMemory config section
   */
  constructor(config = {}) {
    this.config = config;
    this.dailyNotes = config.dailyNotes !== false;
    this.maxDays = config.maxDays || 90;
    this.autoContext = config.autoContext !== false;
    this._sessions = {};
    this._ensureDirs();
    this._loadSessions();
  }

  _ensureDirs() {
    try {
      if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });
    } catch {}
  }

  _dateStr(date) {
    const d = date || new Date();
    return d.toISOString().split('T')[0];
  }

  _dailyFile(date) {
    return path.join(MEMORY_DIR, this._dateStr(date) + '.md');
  }

  _loadSessions() {
    try {
      if (fs.existsSync(SESSIONS_FILE)) {
        this._sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
      }
    } catch { this._sessions = {}; }
  }

  _saveSessions() {
    try {
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify(this._sessions, null, 2));
    } catch {}
  }

  // ── Daily Notes ──

  /**
   * Add a note to today's daily file
   * @param {string} text - Note text
   * @param {string} category - Optional category tag
   * @returns {{file: string, lineCount: number}}
   */
  addNote(text, category) {
    try {
      this._ensureDirs();
      const file = this._dailyFile();
      const ts = new Date().toLocaleTimeString();
      const catTag = category ? ` [${category}]` : '';
      const line = `- **${ts}**${catTag}: ${text}\n`;

      if (!fs.existsSync(file)) {
        const header = `# Daily Notes — ${this._dateStr()}\n\n`;
        fs.writeFileSync(file, header + line);
      } else {
        fs.appendFileSync(file, line);
      }

      const content = fs.readFileSync(file, 'utf8');
      const lineCount = content.split('\n').filter(l => l.trim()).length;
      return { file: this._dateStr(), lineCount };
    } catch (e) {
      return { error: e.message };
    }
  }

  /**
   * Add to long-term MEMORY.md
   * @param {string} text - Memory text
   * @param {string} category - Optional category
   * @returns {{added: boolean}}
   */
  addMemory(text, category) {
    try {
      this._ensureDirs();
      const ts = new Date().toISOString().split('T')[0];
      const catTag = category ? ` [${category}]` : '';
      const line = `- (${ts})${catTag} ${text}\n`;

      if (!fs.existsSync(LONG_TERM_FILE)) {
        const header = `# Long-Term Memory\n\nCurated important information.\n\n`;
        fs.writeFileSync(LONG_TERM_FILE, header + line);
      } else {
        fs.appendFileSync(LONG_TERM_FILE, line);
      }
      return { added: true };
    } catch (e) {
      return { added: false, error: e.message };
    }
  }

  /**
   * Search across all memory files
   * @param {string} query - Search query
   * @returns {Array<{file: string, line: string, lineNumber: number}>}
   */
  searchMemory(query) {
    try {
      const results = [];
      const q = query.toLowerCase();
      const files = fs.readdirSync(MEMORY_DIR).filter(f => f.endsWith('.md'));

      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(MEMORY_DIR, file), 'utf8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(q)) {
              results.push({ file, line: lines[i].trim(), lineNumber: i + 1 });
            }
          }
        } catch {}
      }
      return results;
    } catch { return []; }
  }

  /**
   * Get today's notes
   * @returns {string}
   */
  getToday() {
    try {
      const file = this._dailyFile();
      if (fs.existsSync(file)) {
        return fs.readFileSync(file, 'utf8');
      }
      return '';
    } catch { return ''; }
  }

  /**
   * Get recent N days of notes
   * @param {number} days - Number of days
   * @returns {Array<{date: string, content: string}>}
   */
  getRecent(days = 7) {
    try {
      const results = [];
      const now = new Date();
      for (let i = 0; i < days; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dateStr = this._dateStr(d);
        const file = path.join(MEMORY_DIR, dateStr + '.md');
        if (fs.existsSync(file)) {
          results.push({ date: dateStr, content: fs.readFileSync(file, 'utf8') });
        }
      }
      return results;
    } catch { return []; }
  }

  /**
   * Get long-term memory content
   * @returns {string}
   */
  getMemory() {
    try {
      if (fs.existsSync(LONG_TERM_FILE)) {
        return fs.readFileSync(LONG_TERM_FILE, 'utf8');
      }
      return '';
    } catch { return ''; }
  }

  /**
   * Get memory context for AI injection
   * @returns {string}
   */
  getContext() {
    if (!this.autoContext) return '';
    try {
      const parts = [];
      const today = this.getToday();
      if (today) parts.push('=== Today\'s Notes ===\n' + today.substring(0, 1000));
      const memory = this.getMemory();
      if (memory) parts.push('=== Long-Term Memory ===\n' + memory.substring(0, 2000));
      return parts.join('\n\n');
    } catch { return ''; }
  }

  /**
   * Summarize a day's notes (returns raw content — AI summary done at API level)
   * @param {string} date - YYYY-MM-DD
   * @returns {string}
   */
  summarizeDay(date) {
    try {
      const file = path.join(MEMORY_DIR, date + '.md');
      if (fs.existsSync(file)) {
        return fs.readFileSync(file, 'utf8');
      }
      return 'No notes for ' + date;
    } catch { return ''; }
  }

  /**
   * Remove notes older than N days
   * @param {number} daysToKeep - Days to keep
   * @returns {{pruned: number}}
   */
  pruneOld(daysToKeep) {
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - (daysToKeep || this.maxDays));
      const cutoffStr = this._dateStr(cutoff);

      const files = fs.readdirSync(MEMORY_DIR).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f));
      let pruned = 0;
      for (const file of files) {
        const dateStr = file.replace('.md', '');
        if (dateStr < cutoffStr) {
          fs.unlinkSync(path.join(MEMORY_DIR, file));
          pruned++;
        }
      }
      return { pruned };
    } catch (e) { return { pruned: 0, error: e.message }; }
  }

  // ── Session Memory ──

  /**
   * Save session data
   * @param {string} sessionId - Session identifier
   * @param {object} data - Data to store
   */
  saveSession(sessionId, data) {
    this._sessions[sessionId] = { ...data, updatedAt: new Date().toISOString() };
    this._saveSessions();
  }

  /**
   * Get session data
   * @param {string} sessionId - Session identifier
   * @returns {object|null}
   */
  getSession(sessionId) {
    return this._sessions[sessionId] || null;
  }

  /**
   * List all sessions
   * @returns {Array}
   */
  listSessions() {
    return Object.entries(this._sessions).map(([id, data]) => ({ id, ...data }));
  }

  /**
   * Get stats
   * @returns {object}
   */
  getStats() {
    try {
      const files = fs.readdirSync(MEMORY_DIR).filter(f => f.endsWith('.md'));
      const dailyFiles = files.filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f));
      return {
        dailyNotes: dailyFiles.length,
        hasLongTermMemory: fs.existsSync(LONG_TERM_FILE),
        sessions: Object.keys(this._sessions).length,
        oldestNote: dailyFiles.sort()[0] || null,
        newestNote: dailyFiles.sort().pop() || null,
        totalFiles: files.length
      };
    } catch { return { dailyNotes: 0, hasLongTermMemory: false, sessions: 0 }; }
  }

  // ═══════════════════════════════════════════════════════════
  // v5.0 — TF-IDF Semantic Search
  // ═══════════════════════════════════════════════════════════

  /** @returns {Set<string>} Common English stopwords */
  _getStopwords() { return _TFIDF_STOPWORDS; }

  /**
   * Simple suffix stemmer
   * @param {string} word
   * @returns {string}
   */
  _stem(word) {
    try {
      var w = word.toLowerCase();
      if (w.length < 4) return w;
      var suffixes = ['tion', 'ness', 'ment', 'able', 'ible', 'ling', 'ings', 'edly', 'ical'];
      for (var si = 0; si < suffixes.length; si++) {
        if (w.endsWith(suffixes[si]) && w.length - suffixes[si].length >= 3) {
          return w.slice(0, -suffixes[si].length);
        }
      }
      var suffixes2 = ['ing', 'ion', 'ity', 'ous', 'ful', 'ive', 'ary'];
      for (var s2i = 0; s2i < suffixes2.length; s2i++) {
        if (w.endsWith(suffixes2[s2i]) && w.length - suffixes2[s2i].length >= 3) {
          return w.slice(0, -suffixes2[s2i].length);
        }
      }
      if (w.endsWith('ed') && w.length > 4) return w.slice(0, -2);
      if (w.endsWith('ly') && w.length > 4) return w.slice(0, -2);
      if (w.endsWith('es') && w.length > 4) return w.slice(0, -2);
      if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) return w.slice(0, -1);
      return w;
    } catch (e) { return word.toLowerCase(); }
  }

  /**
   * Tokenize text into stemmed terms, removing stopwords
   * @param {string} text
   * @returns {Array<string>}
   */
  _tokenize(text) {
    try {
      var words = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(function(w) { return w.length > 2; });
      var self = this;
      var tokens = [];
      for (var i = 0; i < words.length; i++) {
        if (!_TFIDF_STOPWORDS.has(words[i])) {
          tokens.push(self._stem(words[i]));
        }
      }
      // Add bigrams
      for (var bi = 0; bi < tokens.length - 1; bi++) {
        tokens.push(tokens[bi] + '_' + tokens[bi + 1]);
      }
      return tokens;
    } catch (e) { return []; }
  }

  /**
   * Build TF-IDF index from all memory files
   * @returns {{docCount: number, termCount: number}}
   */
  buildIndex() {
    try {
      this._tfidfDocs = [];
      this._tfidfIdf = {};
      this._indexBuiltAt = Date.now();

      var files = fs.readdirSync(MEMORY_DIR).filter(function(f) { return f.endsWith('.md'); });
      var allTermSets = [];

      for (var fi = 0; fi < files.length; fi++) {
        try {
          var content = fs.readFileSync(path.join(MEMORY_DIR, files[fi]), 'utf8');
          var tokens = this._tokenize(content);
          // Term frequency for this doc
          var tf = {};
          for (var ti = 0; ti < tokens.length; ti++) {
            tf[tokens[ti]] = (tf[tokens[ti]] || 0) + 1;
          }
          // Normalize TF
          var maxTf = 0;
          var terms = Object.keys(tf);
          for (var ki = 0; ki < terms.length; ki++) {
            if (tf[terms[ki]] > maxTf) maxTf = tf[terms[ki]];
          }
          if (maxTf > 0) {
            for (var ni = 0; ni < terms.length; ni++) {
              tf[terms[ni]] = tf[terms[ni]] / maxTf;
            }
          }

          this._tfidfDocs.push({ file: files[fi], tf: tf, content: content, importance: 5 });
          allTermSets.push(new Set(terms));
        } catch (e) { /* skip bad file */ }
      }

      // Compute IDF
      var N = this._tfidfDocs.length;
      var allTerms = new Set();
      for (var ai = 0; ai < allTermSets.length; ai++) {
        allTermSets[ai].forEach(function(t) { allTerms.add(t); });
      }
      allTerms.forEach(function(term) {
        var docFreq = 0;
        for (var di = 0; di < allTermSets.length; di++) {
          if (allTermSets[di].has(term)) docFreq++;
        }
        this._tfidfIdf[term] = Math.log((N + 1) / (docFreq + 1)) + 1;
      }.bind(this));

      return { docCount: N, termCount: allTerms.size };
    } catch (e) { return { docCount: 0, termCount: 0, error: e.message }; }
  }

  /**
   * Levenshtein distance for fuzzy matching
   * @param {string} a
   * @param {string} b
   * @returns {number}
   */
  _levenshtein(a, b) {
    try {
      if (a.length === 0) return b.length;
      if (b.length === 0) return a.length;
      var matrix = [];
      for (var i = 0; i <= b.length; i++) matrix[i] = [i];
      for (var j = 0; j <= a.length; j++) matrix[0][j] = j;
      for (var i2 = 1; i2 <= b.length; i2++) {
        for (var j2 = 1; j2 <= a.length; j2++) {
          var cost = b.charAt(i2 - 1) === a.charAt(j2 - 1) ? 0 : 1;
          matrix[i2][j2] = Math.min(matrix[i2 - 1][j2] + 1, matrix[i2][j2 - 1] + 1, matrix[i2 - 1][j2 - 1] + cost);
        }
      }
      return matrix[b.length][a.length];
    } catch (e) { return 999; }
  }

  /**
   * TF-IDF semantic search
   * @param {string} query
   * @param {number} topK
   * @param {string} category - Optional category filter
   * @returns {Array<{file: string, score: number, snippet: string}>}
   */
  semanticSearch(query, topK, category) {
    try {
      topK = topK || 5;
      // Rebuild index if stale or never built
      if (!this._tfidfDocs || !this._indexBuiltAt || Date.now() - this._indexBuiltAt > 60000) {
        this.buildIndex();
      }

      var queryTokens = this._tokenize(query);
      if (queryTokens.length === 0) return [];

      // Build query TF vector
      var queryTf = {};
      for (var qi = 0; qi < queryTokens.length; qi++) {
        queryTf[queryTokens[qi]] = (queryTf[queryTokens[qi]] || 0) + 1;
      }
      var maxQTf = 0;
      var qTerms = Object.keys(queryTf);
      for (var mi = 0; mi < qTerms.length; mi++) {
        if (queryTf[qTerms[mi]] > maxQTf) maxQTf = queryTf[qTerms[mi]];
      }
      if (maxQTf > 0) {
        for (var mni = 0; mni < qTerms.length; mni++) {
          queryTf[qTerms[mni]] = queryTf[qTerms[mni]] / maxQTf;
        }
      }

      // Compute query TF-IDF vector
      var queryVec = {};
      for (var qvi = 0; qvi < qTerms.length; qvi++) {
        var term = qTerms[qvi];
        var idf = this._tfidfIdf[term] || 0;
        // Fuzzy: if exact not found, try fuzzy match
        if (idf === 0) {
          var idfTerms = Object.keys(this._tfidfIdf);
          for (var fi2 = 0; fi2 < idfTerms.length; fi2++) {
            if (this._levenshtein(term, idfTerms[fi2]) <= 2) {
              idf = this._tfidfIdf[idfTerms[fi2]] * 0.7; // Discount fuzzy
              break;
            }
          }
        }
        queryVec[term] = queryTf[term] * idf;
      }

      // Score each document via cosine similarity
      var scores = [];
      for (var di = 0; di < this._tfidfDocs.length; di++) {
        var doc = this._tfidfDocs[di];
        // Category filter
        if (category && doc.content.indexOf('[' + category + ']') === -1) continue;

        var dotProduct = 0;
        var docMag = 0;
        var queryMag = 0;

        var docTerms = Object.keys(doc.tf);
        for (var dti = 0; dti < docTerms.length; dti++) {
          var dTerm = docTerms[dti];
          var dVal = doc.tf[dTerm] * (this._tfidfIdf[dTerm] || 0);
          docMag += dVal * dVal;
          if (queryVec[dTerm]) {
            dotProduct += dVal * queryVec[dTerm];
          }
        }
        var qvTerms = Object.keys(queryVec);
        for (var qmi = 0; qmi < qvTerms.length; qmi++) {
          queryMag += queryVec[qvTerms[qmi]] * queryVec[qvTerms[qmi]];
        }

        var similarity = 0;
        if (docMag > 0 && queryMag > 0) {
          similarity = dotProduct / (Math.sqrt(docMag) * Math.sqrt(queryMag));
        }

        // Weight by importance
        similarity *= (doc.importance || 5) / 5;

        if (similarity > 0.01) {
          // Extract best matching snippet
          var lines = doc.content.split('\n');
          var bestLine = '';
          var bestLineScore = 0;
          for (var li = 0; li < lines.length; li++) {
            var lineTokens = this._tokenize(lines[li]);
            var lineMatch = 0;
            for (var lti = 0; lti < lineTokens.length; lti++) {
              if (queryVec[lineTokens[lti]]) lineMatch++;
            }
            if (lineMatch > bestLineScore) {
              bestLineScore = lineMatch;
              bestLine = lines[li].trim();
            }
          }

          scores.push({ file: doc.file, score: similarity, snippet: bestLine.substring(0, 300) });
        }
      }

      scores.sort(function(a, b) { return b.score - a.score; });
      return scores.slice(0, topK);
    } catch (e) { return []; }
  }

  /**
   * Get top context snippets for AI injection
   * @param {string} query
   * @returns {string}
   */
  getSemanticContext(query) {
    try {
      if (!query) return '';
      var results = this.semanticSearch(query, 3);
      if (results.length === 0) return '';
      var parts = ['=== Relevant Memory (TF-IDF) ==='];
      for (var i = 0; i < results.length; i++) {
        parts.push('[' + results[i].file + ' score:' + results[i].score.toFixed(3) + '] ' + results[i].snippet);
      }
      return parts.join('\n');
    } catch (e) { return ''; }
  }

  /**
   * Get index status
   * @returns {object}
   */
  getIndexStatus() {
    return {
      built: !!this._tfidfDocs,
      docCount: this._tfidfDocs ? this._tfidfDocs.length : 0,
      termCount: this._tfidfIdf ? Object.keys(this._tfidfIdf).length : 0,
      builtAt: this._indexBuiltAt ? new Date(this._indexBuiltAt).toISOString() : null,
      stale: this._indexBuiltAt ? Date.now() - this._indexBuiltAt > 60000 : true
    };
  }
}

const _TFIDF_STOPWORDS = new Set([
  'the','be','to','of','and','a','in','that','have','i','it','for','not','on','with',
  'he','as','you','do','at','this','but','his','by','from','they','we','her','she',
  'or','an','will','my','one','all','would','there','their','what','so','up','out',
  'if','about','who','get','which','go','me','when','make','can','like','time','no',
  'just','him','know','take','people','into','year','your','good','some','could','them',
  'see','other','than','then','now','look','only','come','its','over','think','also',
  'back','after','use','two','how','our','work','first','well','way','even','new',
  'want','because','any','these','give','day','most','us','is','are','was','were',
  'been','has','had','did','does','am','being','having','doing','should','very','much'
]);

module.exports = { PersistentMemory };
