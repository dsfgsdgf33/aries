/**
 * ARIES Proactive Engine
 * WAL protocol, working buffer, session state, and proactive features.
 */
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

class ProactiveEngine extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.dataDir = opts.dataDir || path.join(__dirname, '..', 'data');
    this.walPath = path.join(this.dataDir, 'wal.json');
    this.statePath = path.join(this.dataDir, 'session-state.json');
    this.bufferPath = path.join(this.dataDir, 'working-buffer.md');
    this._ensureDir();
  }

  _ensureDir() {
    try { fs.mkdirSync(this.dataDir, { recursive: true }); } catch {}
  }

  _readJson(p) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
  }

  _writeJson(p, data) {
    fs.writeFileSync(p, JSON.stringify(data, null, 2));
  }

  // === WAL Protocol ===
  walWrite(entry) {
    const wal = this._readJson(this.walPath) || { entries: [] };
    wal.entries.push({ ...entry, timestamp: new Date().toISOString() });
    // Keep last 200 entries
    if (wal.entries.length > 200) wal.entries = wal.entries.slice(-200);
    this._writeJson(this.walPath, wal);
    this.emit('wal-write', entry);
    return { status: 'written', count: wal.entries.length };
  }

  walRead() {
    const wal = this._readJson(this.walPath) || { entries: [] };
    return wal.entries;
  }

  // === Working Buffer ===
  bufferExchange(human, agent) {
    const ts = new Date().toISOString();
    const entry = `\n## [${ts}]\n**Human:** ${human}\n**Agent:** ${(agent || '').substring(0, 500)}\n---\n`;
    try { fs.appendFileSync(this.bufferPath, entry); } catch {}
    this.emit('buffer-exchange', { human, agent: (agent||'').substring(0,100) });
    return { status: 'buffered' };
  }

  getBuffer() {
    try { return fs.readFileSync(this.bufferPath, 'utf8'); } catch { return ''; }
  }

  clearBuffer() {
    try { fs.writeFileSync(this.bufferPath, '# Working Buffer\n\n'); } catch {}
    return { status: 'cleared' };
  }

  // === Session State ===
  saveState(state) {
    const current = this._readJson(this.statePath) || {};
    const merged = { ...current, ...state, _lastUpdated: new Date().toISOString() };
    this._writeJson(this.statePath, merged);
    this.emit('state-saved', merged);
    return { status: 'saved' };
  }

  loadState() {
    return this._readJson(this.statePath) || {};
  }

  // === Proactive Features ===
  analyzePatterns() {
    const wal = this.walRead();
    const recent = wal.slice(-50);
    const types = {};
    for (const e of recent) {
      const t = e.type || 'unknown';
      types[t] = (types[t] || 0) + 1;
    }
    return { recentCount: recent.length, typeFrequency: types };
  }

  suggestActions() {
    const patterns = this.analyzePatterns();
    const suggestions = [];
    if (patterns.typeFrequency.correction > 3) {
      suggestions.push({ type: 'automation', detail: 'Frequent corrections detected — consider updating system prompt or defaults' });
    }
    if (patterns.typeFrequency.preference > 2) {
      suggestions.push({ type: 'preference', detail: 'Multiple preferences logged — review and consolidate' });
    }
    if (patterns.recentCount > 40) {
      suggestions.push({ type: 'cleanup', detail: 'WAL growing large — consider compaction' });
    }
    return suggestions;
  }

  // === Recovery ===
  recover() {
    const state = this.loadState();
    const buffer = this.getBuffer();
    const wal = this.walRead().slice(-20);
    return {
      state,
      recentWal: wal,
      bufferSize: buffer.length,
      bufferPreview: buffer.substring(buffer.length - 1000),
      recovered: true
    };
  }
}

let _instance;
function getInstance(opts) {
  if (!_instance) _instance = new ProactiveEngine(opts);
  return _instance;
}

module.exports = { ProactiveEngine, getInstance };
