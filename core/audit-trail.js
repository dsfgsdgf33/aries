'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const GENESIS_HASH = '0'.repeat(64);

class AuditTrail {
  constructor(options = {}) {
    this.baseDir = options.baseDir || path.resolve(__dirname, '..', 'data', 'audit');
    this.filename = 'audit-chain.jsonl';
    this._ensureDir();
  }

  _ensureDir() {
    fs.mkdirSync(this.baseDir, { recursive: true });
  }

  _filePath() {
    return path.join(this.baseDir, this.filename);
  }

  _rotatedPath() {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    return path.join(this.baseDir, `audit-chain-${ts}.jsonl`);
  }

  _hash(prevHash, action, actor, details, timestamp) {
    const data = `${prevHash}${action}${actor}${details}${timestamp}`;
    return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
  }

  _getLastEntry() {
    const fp = this._filePath();
    if (!fs.existsSync(fp)) return null;

    const stat = fs.statSync(fp);
    if (stat.size === 0) return null;

    // Read last line efficiently
    const buf = Buffer.alloc(Math.min(stat.size, 4096));
    const fd = fs.openSync(fp, 'r');
    fs.readSync(fd, buf, 0, buf.length, Math.max(0, stat.size - buf.length));
    fs.closeSync(fd);

    const lines = buf.toString('utf8').trim().split('\n');
    const last = lines[lines.length - 1].trim();
    if (!last) return null;

    try { return JSON.parse(last); }
    catch { return null; }
  }

  _maybeRotate() {
    const fp = this._filePath();
    if (!fs.existsSync(fp)) return;
    try {
      const stat = fs.statSync(fp);
      if (stat.size >= MAX_FILE_SIZE) {
        fs.renameSync(fp, this._rotatedPath());
      }
    } catch { /* ignore */ }
  }

  log(action, actor, details = '') {
    this._maybeRotate();

    const last = this._getLastEntry();
    const prevHash = last ? last.hash : GENESIS_HASH;
    const id = last ? last.id + 1 : 1;
    const timestamp = new Date().toISOString();
    const detailStr = typeof details === 'string' ? details : JSON.stringify(details);
    const hash = this._hash(prevHash, action, actor, detailStr, timestamp);

    const entry = { id, timestamp, action, actor, details: detailStr, hash, prevHash };
    fs.appendFileSync(this._filePath(), JSON.stringify(entry) + '\n', 'utf8');
    return entry;
  }

  verify() {
    const fp = this._filePath();
    if (!fs.existsSync(fp)) return { valid: true, brokenAt: null };

    const content = fs.readFileSync(fp, 'utf8').trim();
    if (!content) return { valid: true, brokenAt: null };

    const lines = content.split('\n');
    let prevHash = GENESIS_HASH;

    for (let i = 0; i < lines.length; i++) {
      let entry;
      try { entry = JSON.parse(lines[i]); }
      catch { return { valid: false, brokenAt: i + 1 }; }

      if (entry.prevHash !== prevHash) {
        return { valid: false, brokenAt: entry.id };
      }

      const expected = this._hash(entry.prevHash, entry.action, entry.actor, entry.details, entry.timestamp);
      if (entry.hash !== expected) {
        return { valid: false, brokenAt: entry.id };
      }

      prevHash = entry.hash;
    }

    return { valid: true, brokenAt: null };
  }

  query({ action, actor, from, to, limit } = {}) {
    const fp = this._filePath();
    if (!fs.existsSync(fp)) return [];

    const content = fs.readFileSync(fp, 'utf8').trim();
    if (!content) return [];

    let entries = content.split('\n').map(line => {
      try { return JSON.parse(line); }
      catch { return null; }
    }).filter(Boolean);

    if (action) entries = entries.filter(e => e.action === action);
    if (actor) entries = entries.filter(e => e.actor === actor);
    if (from) {
      const fromDate = new Date(from).toISOString();
      entries = entries.filter(e => e.timestamp >= fromDate);
    }
    if (to) {
      const toDate = new Date(to).toISOString();
      entries = entries.filter(e => e.timestamp <= toDate);
    }
    if (limit && limit > 0) entries = entries.slice(-limit);

    return entries;
  }

  export(format = 'json') {
    const entries = this.query();

    if (format === 'csv') {
      if (entries.length === 0) return '';
      const headers = 'id,timestamp,action,actor,details,hash,prevHash';
      const rows = entries.map(e => {
        const details = `"${(e.details || '').replace(/"/g, '""')}"`;
        return `${e.id},${e.timestamp},${e.action},${e.actor},${details},${e.hash},${e.prevHash}`;
      });
      return [headers, ...rows].join('\n');
    }

    return JSON.stringify(entries, null, 2);
  }
}

let _instance = null;
function getInstance(options) {
  if (!_instance) _instance = new AuditTrail(options);
  return _instance;
}

module.exports = { AuditTrail, getInstance };
