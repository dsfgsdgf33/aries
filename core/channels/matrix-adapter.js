'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');
const { EventEmitter } = require('events');
const crypto = require('crypto');

class MatrixAdapter extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} opts.homeserverUrl - e.g. https://matrix.org
   * @param {string} opts.accessToken
   * @param {string} [opts.userId] - e.g. @bot:matrix.org
   * @param {number} [opts.syncTimeout=30000]
   */
  constructor(opts = {}) {
    super();
    this.homeserverUrl = (opts.homeserverUrl || process.env.MATRIX_HOMESERVER || '').replace(/\/$/, '');
    this.accessToken = opts.accessToken || process.env.MATRIX_ACCESS_TOKEN;
    this.userId = opts.userId || process.env.MATRIX_USER_ID || null;
    this.syncTimeout = opts.syncTimeout || 30000;

    if (!this.homeserverUrl) throw new Error('MatrixAdapter: homeserverUrl required');
    if (!this.accessToken) throw new Error('MatrixAdapter: accessToken required');

    this._nextBatch = null;
    this._syncing = false;
    this._shouldSync = false;
    this._parsedUrl = new URL(this.homeserverUrl);
  }

  // ── HTTP helper ──

  _request(method, path, body) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.homeserverUrl);
      const mod = url.protocol === 'https:' ? https : http;
      const payload = body ? JSON.stringify(body) : null;

      const opts = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
        },
      };

      if (payload) {
        opts.headers['Content-Type'] = 'application/json';
        opts.headers['Content-Length'] = Buffer.byteLength(payload);
      }

      const req = mod.request(opts, (res) => {
        let data = '';
        res.on('data', (c) => data += c);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode >= 400) {
              return reject(new Error(`Matrix ${method} ${path}: ${res.statusCode} ${json.errcode || ''} ${json.error || ''}`));
            }
            resolve(json);
          } catch (e) {
            if (res.statusCode >= 400) return reject(new Error(`Matrix ${res.statusCode}: ${data}`));
            resolve(data);
          }
        });
      });

      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  _txnId() {
    return `m${Date.now()}.${crypto.randomBytes(4).toString('hex')}`;
  }

  // ── Sync loop ──

  async connect() {
    if (!this.userId) {
      const whoami = await this._request('GET', '/_matrix/client/v3/account/whoami');
      this.userId = whoami.user_id;
    }
    this._shouldSync = true;
    this.emit('connected');
    this._syncLoop();
  }

  disconnect() {
    this._shouldSync = false;
    this.emit('disconnected');
  }

  async _syncLoop() {
    if (this._syncing) return;
    this._syncing = true;

    while (this._shouldSync) {
      try {
        let path = `/_matrix/client/v3/sync?timeout=${this.syncTimeout}`;
        if (this._nextBatch) path += `&since=${encodeURIComponent(this._nextBatch)}`;
        else path += '&filter={"room":{"timeline":{"limit":0}}}'; // initial sync: skip history

        const res = await this._request('GET', path);
        this._nextBatch = res.next_batch;

        // Process room events
        const joinedRooms = res.rooms?.join || {};
        for (const [roomId, room] of Object.entries(joinedRooms)) {
          const events = room.timeline?.events || [];
          for (const event of events) {
            if (event.sender === this.userId) continue; // ignore own messages

            if (event.type === 'm.room.message') {
              const content = event.content || {};
              this.emit('message', {
                platform: 'matrix',
                roomId,
                sender: event.sender,
                eventId: event.event_id,
                type: content.msgtype || 'm.text',
                text: content.body || '',
                formatted: content.formatted_body || null,
                relatesTo: content['m.relates_to'] || null,
                raw: event,
              });
            } else if (event.type === 'm.reaction') {
              this.emit('reaction', {
                platform: 'matrix',
                roomId,
                sender: event.sender,
                eventId: event.event_id,
                targetEventId: event.content?.['m.relates_to']?.event_id,
                key: event.content?.['m.relates_to']?.key,
                raw: event,
              });
            }
          }

          // Invites
          const inviteRooms = res.rooms?.invite || {};
          for (const [invRoomId] of Object.entries(inviteRooms)) {
            this.emit('invite', { roomId: invRoomId });
          }
        }
      } catch (err) {
        this.emit('error', err);
        if (this._shouldSync) {
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
    }

    this._syncing = false;
  }

  // ── Public API ──

  async joinRoom(roomIdOrAlias) {
    return this._request('POST', `/_matrix/client/v3/join/${encodeURIComponent(roomIdOrAlias)}`, {});
  }

  async leaveRoom(roomId) {
    return this._request('POST', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/leave`, {});
  }

  async sendMessage(roomId, text, opts = {}) {
    const txnId = this._txnId();
    const content = { msgtype: opts.msgtype || 'm.text', body: text };

    if (opts.html) {
      content.format = 'org.matrix.custom.html';
      content.formatted_body = opts.html;
    }

    if (opts.replyTo) {
      content['m.relates_to'] = {
        'm.in_reply_to': { event_id: opts.replyTo },
      };
    }

    return this._request(
      'PUT',
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`,
      content
    );
  }

  async sendReaction(roomId, eventId, emoji) {
    const txnId = this._txnId();
    return this._request(
      'PUT',
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.reaction/${txnId}`,
      {
        'm.relates_to': {
          rel_type: 'm.annotation',
          event_id: eventId,
          key: emoji,
        },
      }
    );
  }

  async sendImage(roomId, url, body, info = {}) {
    const txnId = this._txnId();
    return this._request(
      'PUT',
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`,
      { msgtype: 'm.image', body, url, info }
    );
  }

  async sendNotice(roomId, text, opts = {}) {
    return this.sendMessage(roomId, text, { ...opts, msgtype: 'm.notice' });
  }

  async setDisplayName(displayName) {
    return this._request('PUT', `/_matrix/client/v3/profile/${encodeURIComponent(this.userId)}/displayname`, {
      displayname: displayName,
    });
  }

  async getRoomMembers(roomId) {
    return this._request('GET', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/members`);
  }

  // TODO: Full E2E encryption requires libolm bindings.
  // For now, the adapter works in unencrypted rooms and rooms where
  // the homeserver handles encryption (e.g., Conduit with appservice).
  // To add E2E: implement key upload, key claiming, Megolm session management,
  // and message encrypt/decrypt using olm/megolm via native addon or WASM.
}

module.exports = { MatrixAdapter };
