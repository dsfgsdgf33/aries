/**
 * ARIES Self-Improvement Engine
 * Manages learnings, errors, and feature requests with structured tracking.
 */
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

class SelfImprovement extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.dataDir = opts.dataDir || path.join(__dirname, '..', 'data', 'learnings');
    this._ensureDir();
  }

  _ensureDir() {
    try { fs.mkdirSync(this.dataDir, { recursive: true }); } catch {}
  }

  _genId(prefix) {
    const d = new Date();
    const ds = d.toISOString().slice(0,10).replace(/-/g,'');
    const r = String(Math.floor(Math.random()*999)).padStart(3,'0');
    return `${prefix}-${ds}-${r}`;
  }

  _readFile(name) {
    const p = path.join(this.dataDir, name);
    try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
  }

  _appendToFile(name, text) {
    const p = path.join(this.dataDir, name);
    this._ensureDir();
    fs.appendFileSync(p, text + '\n');
  }

  _parseEntries(content) {
    const entries = [];
    const blocks = content.split(/\n(?=### )/);
    for (const block of blocks) {
      const idMatch = block.match(/### \[([A-Z]+-\d{8}-\d{3})\]/);
      if (!idMatch) continue;
      const id = idMatch[1];
      const priority = (block.match(/Priority:\*?\*?\s*(\w+)/) || [])[1] || 'medium';
      const status = (block.match(/Status:\*?\*?\s*(\w+)/) || [])[1] || 'pending';
      const summary = (block.match(/Summary:\*?\*?\s*(.+)/) || [])[1] || '';
      const area = (block.match(/Area:\*?\*?\s*(.+)/) || [])[1] || '';
      const category = (block.match(/Category:\*?\*?\s*(.+)/) || [])[1] || '';
      entries.push({ id, priority, status, summary, area, category, raw: block.trim() });
    }
    return entries;
  }

  logLearning(entry) {
    const id = this._genId('LRN');
    const ts = new Date().toISOString();
    const block = `
### [${id}] ${entry.summary || 'Learning'}
- **Date:** ${ts}
- **Category:** ${entry.category || 'general'}
- **Priority:** ${entry.priority || 'medium'}
- **Status:** pending
- **Area:** ${entry.area || 'general'}
- **Summary:** ${entry.summary || ''}
- **Details:** ${entry.details || ''}
- **Suggested Action:** ${entry.suggestedAction || 'none'}
`;
    this._appendToFile('LEARNINGS.md', block);
    this.emit('learning', { id, ...entry });
    return { id, status: 'logged' };
  }

  logError(entry) {
    const id = this._genId('ERR');
    const ts = new Date().toISOString();
    const block = `
### [${id}] ${entry.error || 'Error'}
- **Date:** ${ts}
- **Command:** ${entry.command || 'N/A'}
- **Priority:** ${entry.priority || 'high'}
- **Status:** pending
- **Context:** ${entry.context || ''}
- **Error:** ${entry.error || ''}
- **Suggested Fix:** ${entry.suggestedFix || 'none'}
`;
    this._appendToFile('ERRORS.md', block);
    this.emit('error-logged', { id, ...entry });
    return { id, status: 'logged' };
  }

  logFeature(entry) {
    const id = this._genId('FEAT');
    const ts = new Date().toISOString();
    const block = `
### [${id}] ${entry.capability || 'Feature Request'}
- **Date:** ${ts}
- **Capability:** ${entry.capability || ''}
- **Priority:** ${entry.priority || 'medium'}
- **Status:** pending
- **Complexity:** ${entry.complexity || 'unknown'}
- **User Context:** ${entry.userContext || ''}
- **Suggested Implementation:** ${entry.suggestedImpl || 'none'}
`;
    this._appendToFile('FEATURE_REQUESTS.md', block);
    this.emit('feature', { id, ...entry });
    return { id, status: 'logged' };
  }

  search(query) {
    const q = query.toLowerCase();
    const results = [];
    for (const file of ['LEARNINGS.md', 'ERRORS.md', 'FEATURE_REQUESTS.md']) {
      const entries = this._parseEntries(this._readFile(file));
      for (const e of entries) {
        if (e.raw.toLowerCase().includes(q)) results.push(e);
      }
    }
    return results;
  }

  getPending() {
    return this._allEntries().filter(e => e.status === 'pending');
  }

  getByPriority(p) {
    return this._allEntries().filter(e => e.priority === p);
  }

  _allEntries() {
    const all = [];
    for (const file of ['LEARNINGS.md', 'ERRORS.md', 'FEATURE_REQUESTS.md']) {
      all.push(...this._parseEntries(this._readFile(file)));
    }
    return all;
  }

  resolve(id, notes) {
    for (const file of ['LEARNINGS.md', 'ERRORS.md', 'FEATURE_REQUESTS.md']) {
      const fp = path.join(this.dataDir, file);
      let content;
      try { content = fs.readFileSync(fp, 'utf8'); } catch { continue; }
      if (content.includes(`[${id}]`)) {
        content = content.replace(
          new RegExp(`(### \\[${id}\\][\\s\\S]*?Status:\\s*)pending`),
          `$1resolved (${notes || 'resolved'})`
        );
        fs.writeFileSync(fp, content);
        return { id, status: 'resolved' };
      }
    }
    return { id, status: 'not_found' };
  }

  promote(id, target) {
    const entry = this._allEntries().find(e => e.id === id);
    if (!entry) return { id, status: 'not_found' };
    // Append to a PROMOTED.md file
    const block = `\n### [PROMOTED from ${id}] ${entry.summary}\n${entry.raw}\n---\n`;
    this._appendToFile('PROMOTED.md', block);
    this.resolve(id, 'promoted to ' + (target || 'permanent memory'));
    return { id, status: 'promoted' };
  }

  findRelated(entry) {
    const words = (entry.summary || entry.error || entry.capability || '').toLowerCase().split(/\s+/);
    return this._allEntries().filter(e => {
      const raw = e.raw.toLowerCase();
      return words.filter(w => w.length > 3 && raw.includes(w)).length >= 2;
    });
  }

  detectRecurring() {
    const all = this._allEntries();
    const freq = {};
    for (const e of all) {
      const key = (e.area || 'general') + ':' + (e.category || 'general');
      freq[key] = (freq[key] || 0) + 1;
    }
    return Object.entries(freq).filter(([,c]) => c >= 3).map(([k,c]) => ({ pattern: k, count: c }));
  }

  stats() {
    const all = this._allEntries();
    const s = { total: all.length, byType: {}, byPriority: {}, byStatus: {} };
    for (const e of all) {
      const type = e.id.startsWith('LRN') ? 'learning' : e.id.startsWith('ERR') ? 'error' : 'feature';
      s.byType[type] = (s.byType[type] || 0) + 1;
      s.byPriority[e.priority] = (s.byPriority[e.priority] || 0) + 1;
      s.byStatus[e.status] = (s.byStatus[e.status] || 0) + 1;
    }
    return s;
  }
}

let _instance;
function getInstance(opts) {
  if (!_instance) _instance = new SelfImprovement(opts);
  return _instance;
}

module.exports = { SelfImprovement, getInstance };
