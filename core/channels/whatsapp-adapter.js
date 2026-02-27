'use strict';

const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { EventEmitter } = require('events');

class WhatsAppAdapter extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} opts.phoneNumberId - WhatsApp Business phone number ID
   * @param {string} opts.accessToken - Meta access token
   * @param {string} opts.verifyToken - Webhook verification token
   * @param {string} [opts.appSecret] - App secret for webhook signature verification
   * @param {number} [opts.webhookPort=3000]
   * @param {string} [opts.apiVersion=v21.0]
   */
  constructor(opts = {}) {
    super();
    this.phoneNumberId = opts.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;
    this.accessToken = opts.accessToken || process.env.WHATSAPP_ACCESS_TOKEN;
    this.verifyToken = opts.verifyToken || process.env.WHATSAPP_VERIFY_TOKEN || 'aries_verify';
    this.appSecret = opts.appSecret || process.env.WHATSAPP_APP_SECRET || null;
    this.webhookPort = opts.webhookPort || parseInt(process.env.WHATSAPP_WEBHOOK_PORT) || 3000;
    this.apiVersion = opts.apiVersion || 'v21.0';

    if (!this.phoneNumberId) throw new Error('WhatsAppAdapter: phoneNumberId required');
    if (!this.accessToken) throw new Error('WhatsAppAdapter: accessToken required');

    this._server = null;
    this._messageStatus = new Map(); // messageId -> status
    this._statusTTL = 24 * 60 * 60 * 1000; // 24h
  }

  // ── API helper ──

  _apiCall(method, path, body) {
    return new Promise((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : null;
      const opts = {
        hostname: 'graph.facebook.com',
        path: `/${this.apiVersion}/${path}`,
        method,
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
        },
      };

      if (payload) {
        opts.headers['Content-Type'] = 'application/json';
        opts.headers['Content-Length'] = Buffer.byteLength(payload);
      }

      const req = https.request(opts, (res) => {
        let data = '';
        res.on('data', (c) => data += c);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.error) return reject(new Error(`WhatsApp API: ${json.error.message} (${json.error.code})`));
            resolve(json);
          } catch (e) { reject(e); }
        });
      });

      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  // ── Webhook server ──

  async connect() {
    return new Promise((resolve) => {
      this._server = http.createServer((req, res) => this._handleRequest(req, res));
      this._server.listen(this.webhookPort, () => {
        this.emit('connected');
        resolve();
      });
    });
  }

  disconnect() {
    if (this._server) {
      this._server.close();
      this._server = null;
    }
    this.emit('disconnected');
  }

  _handleRequest(req, res) {
    if (req.method === 'GET' && req.url?.startsWith('/webhook')) {
      return this._handleVerification(req, res);
    }

    if (req.method === 'POST' && req.url?.startsWith('/webhook')) {
      let body = '';
      req.on('data', (c) => body += c);
      req.on('end', () => {
        // Verify signature if app secret configured
        if (this.appSecret) {
          const sig = req.headers['x-hub-signature-256'];
          if (!sig) { res.writeHead(401); res.end(); return; }
          const expected = 'sha256=' + crypto.createHmac('sha256', this.appSecret).update(body).digest('hex');
          if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
            res.writeHead(401); res.end(); return;
          }
        }

        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('EVENT_RECEIVED');

        try {
          const data = JSON.parse(body);
          this._processWebhook(data);
        } catch (e) {
          this.emit('error', e);
        }
      });
      return;
    }

    // Health check
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', adapter: 'whatsapp' }));
      return;
    }

    res.writeHead(404);
    res.end();
  }

  _handleVerification(req, res) {
    const url = new URL(req.url, `http://localhost:${this.webhookPort}`);
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    if (mode === 'subscribe' && token === this.verifyToken) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(challenge);
    } else {
      res.writeHead(403);
      res.end('Forbidden');
    }
  }

  _processWebhook(data) {
    const entries = data.entry || [];
    for (const entry of entries) {
      const changes = entry.changes || [];
      for (const change of changes) {
        if (change.field !== 'messages') continue;
        const value = change.value || {};

        // Message status updates
        const statuses = value.statuses || [];
        for (const status of statuses) {
          this._messageStatus.set(status.id, {
            status: status.status, // sent, delivered, read, failed
            timestamp: parseInt(status.timestamp) * 1000,
            recipientId: status.recipient_id,
          });
          this.emit('status', {
            messageId: status.id,
            status: status.status,
            recipientId: status.recipient_id,
            errors: status.errors || null,
          });
        }

        // Incoming messages
        const messages = value.messages || [];
        const contacts = value.contacts || [];
        const contactMap = {};
        for (const c of contacts) contactMap[c.wa_id] = c.profile?.name || c.wa_id;

        for (const msg of messages) {
          const parsed = {
            platform: 'whatsapp',
            messageId: msg.id,
            from: msg.from,
            fromName: contactMap[msg.from] || msg.from,
            timestamp: parseInt(msg.timestamp) * 1000,
            type: msg.type,
            text: null,
            media: null,
            location: null,
            context: msg.context || null, // reply context
            raw: msg,
          };

          switch (msg.type) {
            case 'text':
              parsed.text = msg.text?.body || '';
              break;
            case 'image':
            case 'video':
            case 'audio':
            case 'document':
            case 'sticker':
              parsed.media = msg[msg.type];
              parsed.text = msg[msg.type]?.caption || '';
              break;
            case 'location':
              parsed.location = msg.location;
              break;
            case 'reaction':
              this.emit('reaction', {
                platform: 'whatsapp',
                from: msg.from,
                messageId: msg.reaction?.message_id,
                emoji: msg.reaction?.emoji,
              });
              continue;
            case 'button':
              parsed.text = msg.button?.text || '';
              break;
            case 'interactive':
              parsed.text = msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || '';
              break;
            default:
              break;
          }

          this.emit('message', parsed);
        }
      }
    }
  }

  // ── Cleanup old statuses periodically ──
  _cleanStatuses() {
    const now = Date.now();
    for (const [id, s] of this._messageStatus) {
      if (now - s.timestamp > this._statusTTL) this._messageStatus.delete(id);
    }
  }

  // ── Public API ──

  async sendMessage(to, text, opts = {}) {
    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body: text, preview_url: opts.previewUrl || false },
    };

    if (opts.replyTo) {
      body.context = { message_id: opts.replyTo };
    }

    const res = await this._apiCall('POST', `${this.phoneNumberId}/messages`, body);
    const msgId = res.messages?.[0]?.id;
    if (msgId) this._messageStatus.set(msgId, { status: 'sent', timestamp: Date.now() });
    return res;
  }

  async sendMedia(to, type, mediaUrl, opts = {}) {
    const mediaObj = {};
    if (mediaUrl.startsWith('http')) {
      mediaObj.link = mediaUrl;
    } else {
      mediaObj.id = mediaUrl; // media ID from upload
    }
    if (opts.caption) mediaObj.caption = opts.caption;
    if (opts.filename) mediaObj.filename = opts.filename;

    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type, // image, video, audio, document, sticker
      [type]: mediaObj,
    };

    if (opts.replyTo) body.context = { message_id: opts.replyTo };

    return this._apiCall('POST', `${this.phoneNumberId}/messages`, body);
  }

  async sendTemplate(to, templateName, languageCode = 'en_US', components = []) {
    return this._apiCall('POST', `${this.phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        components,
      },
    });
  }

  async sendReaction(to, messageId, emoji) {
    return this._apiCall('POST', `${this.phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'reaction',
      reaction: { message_id: messageId, emoji },
    });
  }

  async markAsRead(messageId) {
    return this._apiCall('POST', `${this.phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    });
  }

  getMessageStatus(messageId) {
    return this._messageStatus.get(messageId) || null;
  }

  async getMediaUrl(mediaId) {
    return this._apiCall('GET', `${mediaId}`);
  }
}

module.exports = { WhatsAppAdapter };
