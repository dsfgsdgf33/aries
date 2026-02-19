/**
 * ARIES v5.0 — Audit Trail
 * Request logging for security and debugging.
 */

const fs = require('fs');
const path = require('path');

const AUDIT_FILE = path.join(__dirname, '..', 'logs', 'audit.jsonl');
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

class AuditLog {
  constructor() {
    this._ensureDir();
  }

  _ensureDir() {
    const dir = path.dirname(AUDIT_FILE);
    try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch {}
  }

  log(entry) {
    const record = {
      ts: new Date().toISOString(),
      ...entry,
    };

    try {
      fs.appendFileSync(AUDIT_FILE, JSON.stringify(record) + '\n');
      
      // Rotate if too large
      const stat = fs.statSync(AUDIT_FILE);
      if (stat.size > MAX_SIZE) {
        const backup = AUDIT_FILE + '.1';
        try { fs.unlinkSync(backup); } catch {}
        fs.renameSync(AUDIT_FILE, backup);
      }
    } catch {}
  }

  /** Log an API request */
  request(req, statusCode, durationMs) {
    this.log({
      type: 'request',
      method: req.method,
      path: req.url,
      ip: req.socket?.remoteAddress,
      status: statusCode,
      duration: durationMs,
      ua: req.headers?.['user-agent']?.substring(0, 100),
    });
  }

  /** Log a security event */
  security(event, details) {
    this.log({ type: 'security', event, ...details });
  }

  /** Read recent entries */
  recent(limit = 100) {
    try {
      const data = fs.readFileSync(AUDIT_FILE, 'utf8');
      return data.trim().split('\n').slice(-limit).map(l => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);
    } catch {
      return [];
    }
  }
}

module.exports = new AuditLog();
