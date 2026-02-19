/**
 * ARIES v5.0 — Worker Chat
 * Inter-worker communication system. Messages stored in memory + disk.
 * Pure Node.js, zero dependencies.
 */

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

const CHAT_FILE = path.join(__dirname, '..', 'data', 'worker-chat.json');
const MAX_MESSAGES = 100;

class WorkerChat extends EventEmitter {
  constructor() {
    super();
    this._messages = [];
    this._loadMessages();
  }

  _loadMessages() {
    try {
      this._messages = JSON.parse(fs.readFileSync(CHAT_FILE, 'utf8'));
      if (!Array.isArray(this._messages)) this._messages = [];
    } catch { this._messages = []; }
  }

  _saveMessages() {
    try {
      const dir = path.dirname(CHAT_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(CHAT_FILE, JSON.stringify(this._messages, null, 2));
    } catch (e) { console.error('[CHAT] Save error:', e.message); }
  }

  addMessage(from, text, to) {
    const msg = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
      from: from || 'master',
      to: to || 'all',
      text: text,
      timestamp: Date.now()
    };
    this._messages.push(msg);
    if (this._messages.length > MAX_MESSAGES) {
      this._messages = this._messages.slice(-MAX_MESSAGES);
    }
    this._saveMessages();
    this.emit('message', msg);
    return msg;
  }

  getMessages(limit, workerId) {
    let msgs = this._messages;
    if (workerId) {
      msgs = msgs.filter(m => m.from === workerId || m.to === workerId || m.to === 'all');
    }
    const n = limit || 50;
    return msgs.slice(-n);
  }

  getWorkers() {
    const workers = new Set();
    for (const m of this._messages) {
      if (m.from && m.from !== 'master') workers.add(m.from);
    }
    return Array.from(workers);
  }
}

module.exports = { WorkerChat };
