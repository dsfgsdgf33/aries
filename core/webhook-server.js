/**
 * ARIES v5.0 — Webhook Receiver & Sender
 * Receive/send webhooks, route to handlers
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

class WebhookServer {
  constructor() {
    this.dataFile = path.join(__dirname, '..', 'data', 'webhooks.json');
    this.webhooks = [];
    this.logs = new Map(); // webhook id -> log entries
    this.refs = null;
  }

  start(refs) {
    this.refs = refs;
    try { this.webhooks = JSON.parse(fs.readFileSync(this.dataFile, 'utf8')); } catch { this.webhooks = []; }
  }

  _save() {
    try { fs.writeFileSync(this.dataFile, JSON.stringify(this.webhooks, null, 2)); } catch {}
  }

  createWebhook(data) {
    const wh = {
      id: crypto.randomUUID(),
      name: data.name || 'Unnamed',
      path: data.path || `/hook/${crypto.randomBytes(8).toString('hex')}`,
      action: data.action || 'log', // log, broadcast, telegram
      created: Date.now(),
      enabled: true
    };
    this.webhooks.push(wh);
    this._save();
    return wh;
  }

  deleteWebhook(id) {
    this.webhooks = this.webhooks.filter(w => w.id !== id);
    this._save();
    this.logs.delete(id);
    return { ok: true };
  }

  handleIncoming(webhookId, body, headers) {
    const wh = this.webhooks.find(w => w.id === webhookId);
    if (!wh) return;
    const entry = { timestamp: Date.now(), body: typeof body === 'string' ? body.slice(0, 5000) : body, headers: { 'content-type': headers['content-type'], 'user-agent': headers['user-agent'] } };
    if (!this.logs.has(webhookId)) this.logs.set(webhookId, []);
    const log = this.logs.get(webhookId);
    log.push(entry);
    if (log.length > 50) log.splice(0, log.length - 50);

    // Broadcast to WS
    if (this.refs && this.refs.wsServer) {
      try { this.refs.wsServer.broadcast('webhook', { id: webhookId, name: wh.name, ...entry }); } catch {}
    }
  }

  sendWebhook(url, data) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const mod = parsed.protocol === 'https:' ? https : http;
      const postData = JSON.stringify(data);
      const req = mod.request(parsed, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
        timeout: 10000
      }, (res) => {
        let d = ''; res.on('data', c => d += c);
        res.on('end', () => resolve({ status: res.statusCode, body: d.slice(0, 1000) }));
      });
      req.on('error', (e) => reject(e));
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.write(postData);
      req.end();
    });
  }

  registerRoutes(addRoute) {
    addRoute('GET', '/api/webhooks', (req, res, json) => {
      json(res, 200, { ok: true, webhooks: this.webhooks });
    });
    addRoute('POST', '/api/webhooks', (req, res, json, body) => {
      try {
        const data = JSON.parse(body);
        json(res, 200, { ok: true, webhook: this.createWebhook(data) });
      } catch (e) { json(res, 400, { error: e.message }); }
    });
    addRoute('DELETE', '/api/webhooks', (req, res, json) => {
      const parsed = require('url').parse(req.url, true);
      json(res, 200, this.deleteWebhook(parsed.query.id));
    });
    addRoute('POST', '/api/webhooks/send', async (req, res, json, body) => {
      try {
        const data = JSON.parse(body);
        const result = await this.sendWebhook(data.url, data.data);
        json(res, 200, { ok: true, ...result });
      } catch (e) { json(res, 500, { error: e.message }); }
    });
    addRoute('GET', '/api/webhooks/log', (req, res, json) => {
      const parsed = require('url').parse(req.url, true);
      const id = parsed.query.id;
      json(res, 200, { ok: true, log: this.logs.get(id) || [] });
    });
    // Catch-all for incoming webhooks: /api/hook/*
    addRoute('POST', '/api/hook/', (req, res, json, body) => {
      const hookPath = require('url').parse(req.url).pathname;
      const wh = this.webhooks.find(w => `/api${w.path}` === hookPath || w.path === hookPath);
      if (wh) {
        this.handleIncoming(wh.id, body, req.headers);
        json(res, 200, { ok: true, received: true });
      } else {
        json(res, 404, { error: 'Webhook not found' });
      }
    }, { prefix: true });
  }
}

module.exports = { WebhookServer };
