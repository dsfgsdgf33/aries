/**
 * ARIES v5.0 — Unified Notification Hub
 * Aggregate notifications, push to dashboard, priority levels
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class NotificationHub {
  constructor() {
    this.dataFile = path.join(__dirname, '..', 'data', 'notifications.json');
    this.notifications = [];
    this.refs = null;
  }

  start(refs) {
    this.refs = refs;
    try { this.notifications = JSON.parse(fs.readFileSync(this.dataFile, 'utf8')); } catch { this.notifications = []; }
  }

  _save() {
    try { fs.writeFileSync(this.dataFile, JSON.stringify(this.notifications.slice(-200), null, 2)); } catch {}
  }

  add(notification) {
    const n = {
      id: crypto.randomUUID(),
      title: notification.title || 'Notification',
      body: notification.body || '',
      source: notification.source || 'system',
      priority: notification.priority || 'normal', // urgent, normal, low
      read: false,
      timestamp: Date.now()
    };
    this.notifications.push(n);
    if (this.notifications.length > 200) this.notifications = this.notifications.slice(-200);
    this._save();

    // WebSocket broadcast
    if (this.refs && this.refs.wsServer) {
      try { this.refs.wsServer.broadcast('notification', n); } catch {}
    }

    return n;
  }

  markRead(id) {
    const n = this.notifications.find(n => n.id === id);
    if (n) { n.read = true; this._save(); }
    return { ok: true };
  }

  markAllRead() {
    for (const n of this.notifications) n.read = true;
    this._save();
    return { ok: true };
  }

  getUnread() {
    return this.notifications.filter(n => !n.read);
  }

  getAll(limit) {
    return this.notifications.slice(-(limit || 50));
  }

  registerRoutes(addRoute) {
    addRoute('GET', '/api/notifications', (req, res, json) => {
      const parsed = require('url').parse(req.url, true);
      const limit = parseInt(parsed.query.limit) || 50;
      json(res, 200, { ok: true, notifications: this.getAll(limit) });
    });
    addRoute('GET', '/api/notifications/unread', (req, res, json) => {
      const unread = this.getUnread();
      json(res, 200, { ok: true, count: unread.length, notifications: unread });
    });
    addRoute('POST', '/api/notifications/read', (req, res, json, body) => {
      try {
        const data = JSON.parse(body);
        if (data.all) return json(res, 200, this.markAllRead());
        json(res, 200, this.markRead(data.id));
      } catch (e) { json(res, 400, { error: e.message }); }
    });
    addRoute('POST', '/api/notifications', (req, res, json, body) => {
      try {
        const data = JSON.parse(body);
        json(res, 200, { ok: true, notification: this.add(data) });
      } catch (e) { json(res, 400, { error: e.message }); }
    });
  }
}

module.exports = { NotificationHub };
