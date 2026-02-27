'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { EventEmitter } = require('events');

class SignalAdapter extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} [opts.apiUrl=http://localhost:8080] - signal-cli REST API URL
   * @param {string} opts.phoneNumber - Registered Signal number (e.g. +1234567890)
   * @param {number} [opts.pollInterval=2000] - Polling interval in ms
   */
  constructor(opts = {}) {
    super();
    this.apiUrl = (opts.apiUrl || process.env.SIGNAL_API_URL || 'http://localhost:8080').replace(/\/$/, '');
    this.phoneNumber = opts.phoneNumber || process.env.SIGNAL_PHONE_NUMBER;
    this.pollInterval = opts.pollInterval || 2000;

    if (!this.phoneNumber) throw new Error('SignalAdapter: phoneNumber required');

    this._polling = false;
    this._pollTimer = null;
    this._parsedUrl = new URL(this.apiUrl);
  }

  // ── HTTP helper ──

  _request(method, urlPath, body) {
    return new Promise((resolve, reject) => {
      const url = new URL(urlPath, this.apiUrl);
      const mod = url.protocol === 'https:' ? https : http;
      const payload = body ? JSON.stringify(body) : null;

      const opts = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: {},
      };

      if (payload) {
        opts.headers['Content-Type'] = 'application/json';
        opts.headers['Content-Length'] = Buffer.byteLength(payload);
      }

      const req = mod.request(opts, (res) => {
        let data = '';
        res.on('data', (c) => data += c);
        res.on('end', () => {
          if (res.statusCode >= 400) {
            return reject(new Error(`Signal API ${method} ${urlPath}: ${res.statusCode} ${data}`));
          }
          try {
            resolve(data ? JSON.parse(data) : null);
          } catch {
            resolve(data);
          }
        });
      });

      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  // ── Polling ──

  async connect() {
    this._polling = true;
    this.emit('connected');
    this._poll();
  }

  disconnect() {
    this._polling = false;
    if (this._pollTimer) clearTimeout(this._pollTimer);
    this._pollTimer = null;
    this.emit('disconnected');
  }

  async _poll() {
    if (!this._polling) return;

    try {
      const encoded = encodeURIComponent(this.phoneNumber);
      const messages = await this._request('GET', `/v1/receive/${encoded}`);

      if (Array.isArray(messages)) {
        for (const envelope of messages) {
          this._processEnvelope(envelope);
        }
      }
    } catch (err) {
      this.emit('error', err);
    }

    if (this._polling) {
      this._pollTimer = setTimeout(() => this._poll(), this.pollInterval);
    }
  }

  _processEnvelope(envelope) {
    const env = envelope.envelope || envelope;
    const source = env.sourceNumber || env.source;
    const timestamp = env.timestamp;

    // Data message (regular text)
    const dataMsg = env.dataMessage;
    if (dataMsg) {
      const groupInfo = dataMsg.groupInfo || null;
      this.emit('message', {
        platform: 'signal',
        from: source,
        timestamp,
        text: dataMsg.message || '',
        attachments: (dataMsg.attachments || []).map(a => ({
          contentType: a.contentType,
          filename: a.filename,
          id: a.id,
          size: a.size,
        })),
        groupId: groupInfo?.groupId || null,
        groupName: groupInfo?.groupName || null,
        isGroup: !!groupInfo,
        quote: dataMsg.quote || null,
        reaction: null,
        raw: env,
      });
      return;
    }

    // Reaction
    const reaction = env.dataMessage?.reaction || env.reactionMessage;
    if (reaction) {
      this.emit('reaction', {
        platform: 'signal',
        from: source,
        emoji: reaction.emoji,
        targetAuthor: reaction.targetAuthorNumber || reaction.targetAuthor,
        targetTimestamp: reaction.targetSentTimestamp,
        isRemove: reaction.isRemove || false,
      });
      return;
    }

    // Receipt
    const receipt = env.receiptMessage;
    if (receipt) {
      this.emit('receipt', {
        from: source,
        type: receipt.type, // delivery, read
        timestamps: receipt.timestamps || [],
      });
    }

    // Typing indicator
    const typing = env.typingMessage;
    if (typing) {
      this.emit('typing', {
        from: source,
        action: typing.action, // STARTED, STOPPED
        groupId: typing.groupId || null,
      });
    }
  }

  // ── Public API ──

  async sendMessage(recipient, text, opts = {}) {
    const body = {
      message: text,
      number: this.phoneNumber,
      recipients: Array.isArray(recipient) ? recipient : [recipient],
    };

    if (opts.attachments) {
      body.base64_attachments = opts.attachments.map(a => {
        if (a.base64) return a.base64;
        if (a.filePath) {
          const data = fs.readFileSync(a.filePath);
          const mime = a.contentType || 'application/octet-stream';
          return `data:${mime};filename=${path.basename(a.filePath)};base64,${data.toString('base64')}`;
        }
        return a;
      });
    }

    return this._request('POST', '/v2/send', body);
  }

  async sendGroupMessage(groupId, text, opts = {}) {
    const body = {
      message: text,
      number: this.phoneNumber,
      recipients: [`group.${groupId}`],
    };

    if (opts.attachments) {
      body.base64_attachments = opts.attachments.map(a => {
        if (a.base64) return a.base64;
        if (a.filePath) {
          const data = fs.readFileSync(a.filePath);
          const mime = a.contentType || 'application/octet-stream';
          return `data:${mime};filename=${path.basename(a.filePath)};base64,${data.toString('base64')}`;
        }
        return a;
      });
    }

    return this._request('POST', '/v2/send', body);
  }

  async sendReaction(recipient, emoji, targetAuthor, targetTimestamp) {
    return this._request('POST', '/v1/reactions/' + encodeURIComponent(this.phoneNumber), {
      recipient,
      reaction: emoji,
      target_author: targetAuthor,
      target_sent_timestamp: targetTimestamp,
    });
  }

  async removeReaction(recipient, targetAuthor, targetTimestamp) {
    return this._request('DELETE', '/v1/reactions/' + encodeURIComponent(this.phoneNumber), {
      recipient,
      target_author: targetAuthor,
      target_sent_timestamp: targetTimestamp,
    });
  }

  async getGroups() {
    return this._request('GET', `/v1/groups/${encodeURIComponent(this.phoneNumber)}`);
  }

  async getContacts() {
    return this._request('GET', `/v1/contacts/${encodeURIComponent(this.phoneNumber)}`);
  }

  async getProfile(recipient) {
    return this._request('GET', `/v1/profiles/${encodeURIComponent(this.phoneNumber)}/${encodeURIComponent(recipient)}`);
  }

  async setTrustMode(recipient, trustMode = 'always') {
    return this._request('PUT', `/v1/configuration/${encodeURIComponent(this.phoneNumber)}/trust/${encodeURIComponent(recipient)}`, {
      trust_mode: trustMode,
    });
  }
}

module.exports = { SignalAdapter };
