/**
 * ARIES v5.0 — Clipboard Monitor
 * Watch clipboard changes, log history, set clipboard via API
 */
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

class ClipboardMonitor {
  constructor() {
    this.logFile = path.join(__dirname, '..', 'data', 'clipboard-log.json');
    this.history = [];
    this.lastContent = '';
    this.interval = null;
    this.refs = null;
  }

  start(refs) {
    this.refs = refs;
    try { this.history = JSON.parse(fs.readFileSync(this.logFile, 'utf8')); } catch { this.history = []; }
    this.interval = setInterval(() => this.poll(), 2000);
  }

  stop() { if (this.interval) clearInterval(this.interval); }

  poll() {
    exec('powershell -NoProfile -Command "Get-Clipboard"', { timeout: 3000 }, (err, stdout) => {
      if (err) return;
      const content = stdout.trim();
      if (content && content !== this.lastContent) {
        this.lastContent = content;
        const entry = { content, timestamp: Date.now() };
        this.history.push(entry);
        if (this.history.length > 500) this.history = this.history.slice(-500);
        try { fs.writeFileSync(this.logFile, JSON.stringify(this.history, null, 2)); } catch {}
        // WebSocket broadcast
        if (this.refs && this.refs.wsServer) {
          try { this.refs.wsServer.broadcast('clipboard', entry); } catch {}
        }
      }
    });
  }

  getCurrent() { return this.lastContent; }
  getHistory() { return this.history.slice(-100); }

  setClipboard(text) {
    return new Promise((resolve, reject) => {
      const escaped = text.replace(/'/g, "''");
      exec(`powershell -NoProfile -Command "Set-Clipboard -Value '${escaped}'"`, { timeout: 3000 }, (err) => {
        if (err) return reject(err);
        this.lastContent = text;
        resolve({ ok: true });
      });
    });
  }

  registerRoutes(addRoute) {
    addRoute('GET', '/api/clipboard', (req, res, json) => {
      json(res, 200, { ok: true, content: this.getCurrent(), timestamp: Date.now() });
    });
    addRoute('GET', '/api/clipboard/history', (req, res, json) => {
      json(res, 200, { ok: true, history: this.getHistory() });
    });
    addRoute('POST', '/api/clipboard', async (req, res, json, body) => {
      try {
        const data = JSON.parse(body);
        await this.setClipboard(data.content || '');
        json(res, 200, { ok: true });
      } catch (e) { json(res, 500, { error: e.message }); }
    });
  }
}

module.exports = { ClipboardMonitor };
