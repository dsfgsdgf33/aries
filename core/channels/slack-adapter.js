'use strict';

const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { EventEmitter } = require('events');

class MinimalWebSocket extends EventEmitter {
  constructor(url) {
    super();
    this._url = new URL(url);
    this._socket = null;
    this._closed = false;
  }

  connect() {
    const key = crypto.randomBytes(16).toString('base64');
    const opts = {
      hostname: this._url.hostname,
      port: this._url.port || (this._url.protocol === 'wss:' ? 443 : 80),
      path: this._url.pathname + this._url.search,
      method: 'GET',
      headers: {
        'Upgrade': 'websocket',
        'Connection': 'Upgrade',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13',
      },
    };

    const mod = this._url.protocol === 'wss:' ? https : http;
    const req = mod.request(opts);

    req.on('upgrade', (res, socket) => {
      this._socket = socket;
      this.emit('open');

      let buf = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        while (buf.length >= 2) {
          const result = this._parseFrame(buf);
          if (!result) break;
          buf = result.rest;
          if (result.opcode === 0x1) {
            this.emit('message', result.payload.toString('utf8'));
          } else if (result.opcode === 0x8) {
            this.close();
          } else if (result.opcode === 0x9) {
            this._sendFrame(0xA, result.payload); // pong
          }
        }
      });

      socket.on('close', () => { this._closed = true; this.emit('close'); });
      socket.on('error', (e) => this.emit('error', e));
    });

    req.on('error', (e) => this.emit('error', e));
    req.end();
  }

  _parseFrame(buf) {
    if (buf.length < 2) return null;
    const fin = (buf[0] & 0x80) !== 0;
    const opcode = buf[0] & 0x0F;
    const masked = (buf[1] & 0x80) !== 0;
    let payloadLen = buf[1] & 0x7F;
    let offset = 2;

    if (payloadLen === 126) {
      if (buf.length < 4) return null;
      payloadLen = buf.readUInt16BE(2);
      offset = 4;
    } else if (payloadLen === 127) {
      if (buf.length < 10) return null;
      payloadLen = Number(buf.readBigUInt64BE(2));
      offset = 10;
    }

    if (masked) {
      if (buf.length < offset + 4 + payloadLen) return null;
      const mask = buf.slice(offset, offset + 4);
      offset += 4;
      const payload = buf.slice(offset, offset + payloadLen);
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      return { fin, opcode, payload, rest: buf.slice(offset + payloadLen) };
    }

    if (buf.length < offset + payloadLen) return null;
    const payload = buf.slice(offset, offset + payloadLen);
    return { fin, opcode, payload, rest: buf.slice(offset + payloadLen) };
  }

  _sendFrame(opcode, data) {
    if (this._closed || !this._socket) return;
    const payload = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    const mask = crypto.randomBytes(4);
    let header;

    if (payload.length < 126) {
      header = Buffer.alloc(6);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | payload.length;
      mask.copy(header, 2);
    } else if (payload.length < 65536) {
      header = Buffer.alloc(8);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(payload.length, 2);
      mask.copy(header, 4);
    } else {
      header = Buffer.alloc(14);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(payload.length), 2);
      mask.copy(header, 10);
    }

    const masked = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i % 4];
    this._socket.write(Buffer.concat([header, masked]));
  }

  send(data) { this._sendFrame(0x1, data); }

  close() {
    if (this._closed) return;
    this._closed = true;
    this._sendFrame(0x8, Buffer.alloc(0));
    if (this._socket) this._socket.end();
  }
}

// ─── Rate Limiter ───
class RateLimiter {
  constructor(interval = 1000) {
    this._interval = interval;
    this._queue = [];
    this._timer = null;
  }

  enqueue(fn) {
    return new Promise((resolve, reject) => {
      this._queue.push(() => fn().then(resolve, reject));
      this._drain();
    });
  }

  _drain() {
    if (this._timer || this._queue.length === 0) return;
    const fn = this._queue.shift();
    fn();
    if (this._queue.length > 0) {
      this._timer = setTimeout(() => { this._timer = null; this._drain(); }, this._interval);
    }
  }

  destroy() { clearTimeout(this._timer); this._queue.length = 0; }
}

// ─── Slack Adapter ───
class SlackAdapter extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} opts.botToken - xoxb-...
   * @param {string} opts.appToken - xapp-...
   */
  constructor(opts = {}) {
    super();
    this.botToken = opts.botToken || process.env.SLACK_BOT_TOKEN;
    this.appToken = opts.appToken || process.env.SLACK_APP_TOKEN;
    if (!this.botToken) throw new Error('SlackAdapter: botToken required');
    if (!this.appToken) throw new Error('SlackAdapter: appToken required');

    this._ws = null;
    this._limiter = new RateLimiter(1000);
    this._connected = false;
    this._reconnectDelay = 2000;
    this._maxReconnectDelay = 30000;
    this._shouldReconnect = true;
  }

  // ── API helpers ──

  _apiCall(method, body) {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(body || {});
      const req = https.request({
        hostname: 'slack.com',
        path: `/api/${method}`,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.botToken}`,
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(payload),
        },
      }, (res) => {
        let data = '';
        res.on('data', (c) => data += c);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (!json.ok) return reject(new Error(`Slack API ${method}: ${json.error}`));
            resolve(json);
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  _apiUpload(channel, filename, content, threadTs) {
    return new Promise((resolve, reject) => {
      const boundary = `----FormBoundary${crypto.randomBytes(8).toString('hex')}`;
      const fileBuf = Buffer.isBuffer(content) ? content : Buffer.from(content);
      const parts = [];

      const field = (name, value) => {
        parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
      };
      field('channels', channel);
      if (threadTs) field('thread_ts', threadTs);
      field('filename', filename);
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
      parts.push(fileBuf);
      parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

      const body = Buffer.concat(parts);
      const req = https.request({
        hostname: 'slack.com',
        path: '/api/files.upload',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.botToken}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
        },
      }, (res) => {
        let data = '';
        res.on('data', (c) => data += c);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (!json.ok) return reject(new Error(`Slack upload: ${json.error}`));
            resolve(json);
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  // ── Socket Mode ──

  async connect() {
    this._shouldReconnect = true;
    const res = await this._openConnection();
    const wsUrl = res.url;
    this._connectWs(wsUrl);
  }

  _openConnection() {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify({});
      const req = https.request({
        hostname: 'slack.com',
        path: '/api/apps.connections.open',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.appToken}`,
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(payload),
        },
      }, (res) => {
        let data = '';
        res.on('data', (c) => data += c);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (!json.ok) return reject(new Error(`Socket open: ${json.error}`));
            resolve(json);
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  _connectWs(url) {
    const ws = new MinimalWebSocket(url);
    this._ws = ws;

    ws.on('open', () => {
      this._connected = true;
      this._reconnectDelay = 2000;
      this.emit('connected');
    });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      // Acknowledge envelope
      if (msg.envelope_id) {
        ws.send(JSON.stringify({ envelope_id: msg.envelope_id }));
      }

      if (msg.type === 'events_api') {
        const event = msg.payload?.event;
        if (event?.type === 'message' && !event.subtype && !event.bot_id) {
          this.emit('message', {
            platform: 'slack',
            channel: event.channel,
            user: event.user,
            text: event.text || '',
            ts: event.ts,
            threadTs: event.thread_ts || null,
            raw: event,
          });
        }
      } else if (msg.type === 'slash_commands') {
        this.emit('slash_command', msg.payload);
      } else if (msg.type === 'interactive') {
        this.emit('interactive', msg.payload);
      }
    });

    ws.on('close', () => {
      this._connected = false;
      this.emit('disconnected');
      if (this._shouldReconnect) this._scheduleReconnect();
    });

    ws.on('error', (err) => {
      this.emit('error', err);
      if (this._shouldReconnect) this._scheduleReconnect();
    });

    ws.connect();
  }

  _scheduleReconnect() {
    setTimeout(async () => {
      try { await this.connect(); } catch (e) {
        this.emit('error', e);
        this._reconnectDelay = Math.min(this._reconnectDelay * 2, this._maxReconnectDelay);
        this._scheduleReconnect();
      }
    }, this._reconnectDelay);
  }

  disconnect() {
    this._shouldReconnect = false;
    this._limiter.destroy();
    if (this._ws) this._ws.close();
  }

  // ── Public API ──

  sendMessage(channel, text, opts = {}) {
    return this._limiter.enqueue(() => this._apiCall('chat.postMessage', {
      channel,
      text,
      thread_ts: opts.threadTs || undefined,
      unfurl_links: opts.unfurlLinks !== undefined ? opts.unfurlLinks : false,
      blocks: opts.blocks || undefined,
    }));
  }

  sendReply(channel, threadTs, text, opts = {}) {
    return this.sendMessage(channel, text, { ...opts, threadTs });
  }

  addReaction(channel, ts, emoji) {
    return this._limiter.enqueue(() => this._apiCall('reactions.add', {
      channel,
      timestamp: ts,
      name: emoji.replace(/:/g, ''),
    }));
  }

  uploadFile(channel, filename, content, opts = {}) {
    return this._limiter.enqueue(() => this._apiUpload(channel, filename, content, opts.threadTs));
  }

  updateMessage(channel, ts, text, opts = {}) {
    return this._limiter.enqueue(() => this._apiCall('chat.update', {
      channel, ts, text,
      blocks: opts.blocks || undefined,
    }));
  }

  deleteMessage(channel, ts) {
    return this._limiter.enqueue(() => this._apiCall('chat.delete', { channel, ts }));
  }

  getChannelInfo(channel) {
    return this._apiCall('conversations.info', { channel });
  }

  getUserInfo(user) {
    return this._apiCall('users.info', { user });
  }
}

module.exports = { SlackAdapter };
