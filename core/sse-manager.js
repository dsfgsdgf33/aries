/**
 * ARIES — SSE (Server-Sent Events) Manager
 * Real-time push to dashboard clients. Replaces polling with live event streams.
 *
 * Singleton pattern — require once, use everywhere.
 * Zero npm deps. Node.js built-ins only.
 *
 * Channels: system, metabolism, immune, shadow, pain, economy, consciousness, loop
 * Clients subscribe via query param: /api/sse?channels=metabolism,pain
 * Heartbeat ping every 30s keeps connections alive.
 *
 * Usage:
 *   const sse = require('./sse-manager');
 *   sse.broadcast('system', 'status-change', { status: 'online' });
 *   sse.addClient(res);                          // subscribe to ALL channels
 *   sse.addClient(res, ['metabolism', 'pain']);    // filtered subscription
 */

'use strict';

// ── Channel Definitions ──
const CHANNELS = [
  'system',
  'metabolism',
  'immune',
  'shadow',
  'pain',
  'economy',
  'consciousness',
  'loop',
  'dreams',
  'weather',
  'mycelium',
  'perception',
];

// ── Client Class ──

/**
 * Wraps an HTTP response object as an SSE client.
 * Tracks subscribed channels, connection time, and message count.
 */
class SSEClient {
  /**
   * @param {import('http').ServerResponse} res
   * @param {string[]} channels  — list of channel names (empty = all)
   * @param {string}   clientId  — unique identifier
   */
  constructor(res, channels, clientId) {
    this.id = clientId;
    this.res = res;
    this.channels = channels.length ? new Set(channels) : null; // null = subscribed to all
    this.connectedAt = Date.now();
    this.messagesSent = 0;
    this.alive = true;
    this.lastActivity = Date.now();
  }

  /**
   * Returns true if client is subscribed to the given channel.
   * @param {string} channel
   * @returns {boolean}
   */
  subscribedTo(channel) {
    if (!this.alive) return false;
    if (!this.channels) return true;  // null means all channels
    return this.channels.has(channel);
  }

  /**
   * Send a raw SSE message to this client.
   * @param {string} eventName
   * @param {*} data
   * @param {string} [id]
   * @returns {boolean} success
   */
  send(eventName, data, id) {
    if (!this.alive) return false;
    try {
      let msg = '';
      if (id) msg += 'id: ' + id + '\n';
      if (eventName) msg += 'event: ' + eventName + '\n';
      const payload = typeof data === 'string' ? data : JSON.stringify(data);
      // SSE spec: multi-line data needs each line prefixed with "data: "
      const lines = payload.split('\n');
      for (let i = 0; i < lines.length; i++) {
        msg += 'data: ' + lines[i] + '\n';
      }
      msg += '\n'; // blank line terminates the event
      this.res.write(msg);
      this.messagesSent++;
      this.lastActivity = Date.now();
      return true;
    } catch (e) {
      this.alive = false;
      return false;
    }
  }

  /**
   * Send a comment line (used for heartbeat/keepalive).
   * @param {string} text
   * @returns {boolean}
   */
  sendComment(text) {
    if (!this.alive) return false;
    try {
      this.res.write(': ' + text + '\n\n');
      this.lastActivity = Date.now();
      return true;
    } catch (e) {
      this.alive = false;
      return false;
    }
  }

  /**
   * Close the connection.
   */
  close() {
    this.alive = false;
    try { this.res.end(); } catch (_) { /* already closed */ }
  }

  /**
   * Serialize for stats/debugging.
   */
  toJSON() {
    return {
      id: this.id,
      channels: this.channels ? Array.from(this.channels) : '*',
      connectedAt: this.connectedAt,
      messagesSent: this.messagesSent,
      alive: this.alive,
      lastActivity: this.lastActivity,
      uptimeMs: Date.now() - this.connectedAt,
    };
  }
}

// ── SSE Manager (Singleton) ──

class SSEManager {
  constructor() {
    /** @type {Map<string, SSEClient>} */
    this.clients = new Map();

    /** @type {Map<string, Set<string>>} channel → set of client IDs */
    this.channelIndex = new Map();
    for (const ch of CHANNELS) {
      this.channelIndex.set(ch, new Set());
    }

    // Stats
    this.totalMessagesSent = 0;
    this.totalConnections = 0;
    this.totalDisconnections = 0;
    this.startedAt = Date.now();

    // Message ID counter
    this._msgId = 0;

    // Event history ring buffer (last N events per channel for replay on connect)
    this._replayBufferSize = 50;
    /** @type {Map<string, Array>} */
    this._replayBuffers = new Map();
    for (const ch of CHANNELS) {
      this._replayBuffers.set(ch, []);
    }

    // Heartbeat interval
    this._heartbeatInterval = null;
    this._heartbeatMs = 30000;

    // Cleanup interval (remove dead clients)
    this._cleanupInterval = null;
    this._cleanupMs = 60000;

    // Start background tasks
    this._startHeartbeat();
    this._startCleanup();

    // Log
    this._log('SSE Manager initialized. Channels: ' + CHANNELS.join(', '));
  }

  // ── Client Management ──

  /**
   * Register a new SSE client from an HTTP response.
   * @param {import('http').ServerResponse} res
   * @param {string[]} [channels=[]] — channels to subscribe (empty = all)
   * @param {string} [clientId] — optional custom ID
   * @returns {SSEClient}
   */
  addClient(res, channels, clientId) {
    channels = channels || [];
    clientId = clientId || this._generateId();

    // Validate channels
    const validChannels = channels.filter(ch => CHANNELS.includes(ch));

    const client = new SSEClient(res, validChannels, clientId);
    this.clients.set(clientId, client);
    this.totalConnections++;

    // Update channel index
    if (client.channels) {
      for (const ch of client.channels) {
        const set = this.channelIndex.get(ch);
        if (set) set.add(clientId);
      }
    } else {
      // Subscribed to all — add to every channel
      for (const [ch, set] of this.channelIndex) {
        set.add(clientId);
      }
    }

    // Handle disconnect
    res.on('close', () => {
      this.removeClient(clientId);
    });
    res.on('error', () => {
      this.removeClient(clientId);
    });

    // Send welcome event
    client.send('connected', {
      clientId: clientId,
      channels: validChannels.length ? validChannels : CHANNELS,
      serverTime: Date.now(),
      replayAvailable: true,
    }, this._nextMsgId());

    // Replay recent events for subscribed channels
    this._replayForClient(client);

    this._log('Client connected: ' + clientId + ' channels=' + (validChannels.length ? validChannels.join(',') : '*'));
    return client;
  }

  /**
   * Remove a client by ID.
   * @param {string} clientId
   */
  removeClient(clientId) {
    const client = this.clients.get(clientId);
    if (!client) return;

    client.alive = false;
    this.clients.delete(clientId);
    this.totalDisconnections++;

    // Remove from channel index
    for (const [ch, set] of this.channelIndex) {
      set.delete(clientId);
    }

    this._log('Client disconnected: ' + clientId);
  }

  /**
   * Remove a client by response object.
   * @param {import('http').ServerResponse} res
   */
  removeClientByRes(res) {
    for (const [id, client] of this.clients) {
      if (client.res === res) {
        this.removeClient(id);
        return;
      }
    }
  }

  // ── Broadcasting ──

  /**
   * Broadcast an event to a specific channel.
   * @param {string} channel
   * @param {string} event — event name
   * @param {*} data — JSON-serializable payload
   * @returns {number} number of clients that received it
   */
  broadcastToChannel(channel, event, data) {
    const msgId = this._nextMsgId();
    const envelope = {
      channel: channel,
      event: event,
      data: data,
      timestamp: Date.now(),
      id: msgId,
    };

    // Store in replay buffer
    this._pushReplay(channel, envelope);

    // Send to subscribed clients
    let sent = 0;
    const dead = [];

    for (const [id, client] of this.clients) {
      if (!client.alive) {
        dead.push(id);
        continue;
      }
      if (client.subscribedTo(channel)) {
        const ok = client.send(channel + ':' + event, envelope, msgId);
        if (ok) {
          sent++;
        } else {
          dead.push(id);
        }
      }
    }

    // Cleanup dead clients
    for (const id of dead) this.removeClient(id);

    this.totalMessagesSent += sent;
    return sent;
  }

  /**
   * Broadcast to the 'system' channel (convenience).
   * @param {string} event
   * @param {*} data
   * @returns {number}
   */
  broadcast(event, data) {
    return this.broadcastToChannel('system', event, data);
  }

  /**
   * Broadcast to ALL channels simultaneously (rare — used for shutdown etc.).
   * @param {string} event
   * @param {*} data
   * @returns {number}
   */
  broadcastAll(event, data) {
    let total = 0;
    for (const ch of CHANNELS) {
      total += this.broadcastToChannel(ch, event, data);
    }
    return total;
  }

  // ── Stats ──

  /**
   * Get current SSE stats.
   * @returns {Object}
   */
  getStats() {
    const channelStats = {};
    for (const [ch, set] of this.channelIndex) {
      channelStats[ch] = {
        subscribers: set.size,
        replayBufferSize: (this._replayBuffers.get(ch) || []).length,
      };
    }

    const clientList = [];
    for (const [id, client] of this.clients) {
      clientList.push(client.toJSON());
    }

    return {
      connectedClients: this.clients.size,
      totalConnections: this.totalConnections,
      totalDisconnections: this.totalDisconnections,
      totalMessagesSent: this.totalMessagesSent,
      channels: channelStats,
      activeChannels: Object.keys(channelStats).filter(ch => channelStats[ch].subscribers > 0).length,
      clients: clientList,
      uptimeMs: Date.now() - this.startedAt,
      heartbeatMs: this._heartbeatMs,
    };
  }

  /**
   * Get list of valid channel names.
   * @returns {string[]}
   */
  getChannels() {
    return CHANNELS.slice();
  }

  // ── HTTP Endpoint Handler ──

  /**
   * Handle an SSE HTTP request. Sets headers and registers the client.
   * Call this from your route handler for GET /api/sse.
   *
   * @param {import('http').IncomingMessage} req
   * @param {import('http').ServerResponse} res
   * @returns {SSEClient}
   */
  handleRequest(req, res) {
    // Parse channels from query string
    const parsed = new (require('url').URL)('http://localhost' + req.url);
    const channelsParam = parsed.searchParams.get('channels') || '';
    const channels = channelsParam
      ? channelsParam.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    // Get optional client ID
    const clientId = parsed.searchParams.get('clientId') || undefined;

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      'X-Accel-Buffering': 'no', // disable nginx buffering
    });

    // Flush headers immediately
    res.flushHeaders();

    // Register client
    return this.addClient(res, channels, clientId);
  }

  // ── Internal ──

  /**
   * Replay recent events for a newly connected client.
   * @param {SSEClient} client
   * @private
   */
  _replayForClient(client) {
    let replayed = 0;
    for (const [channel, buffer] of this._replayBuffers) {
      if (!client.subscribedTo(channel)) continue;
      for (const envelope of buffer) {
        client.send('replay:' + channel + ':' + envelope.event, envelope, envelope.id);
        replayed++;
      }
    }
    if (replayed > 0) {
      client.send('replay-complete', { count: replayed }, this._nextMsgId());
    }
  }

  /**
   * Push event to replay buffer (ring buffer per channel).
   * @param {string} channel
   * @param {Object} envelope
   * @private
   */
  _pushReplay(channel, envelope) {
    const buf = this._replayBuffers.get(channel);
    if (!buf) return;
    buf.push(envelope);
    if (buf.length > this._replayBufferSize) {
      buf.shift();
    }
  }

  /**
   * Start heartbeat pings every 30s.
   * @private
   */
  _startHeartbeat() {
    if (this._heartbeatInterval) return;
    this._heartbeatInterval = setInterval(() => {
      const dead = [];
      for (const [id, client] of this.clients) {
        if (!client.alive) {
          dead.push(id);
          continue;
        }
        const ok = client.sendComment('heartbeat ' + Date.now());
        if (!ok) dead.push(id);
      }
      for (const id of dead) this.removeClient(id);
    }, this._heartbeatMs);

    // Don't prevent process exit
    if (this._heartbeatInterval.unref) this._heartbeatInterval.unref();
  }

  /**
   * Start periodic cleanup of dead clients.
   * @private
   */
  _startCleanup() {
    if (this._cleanupInterval) return;
    this._cleanupInterval = setInterval(() => {
      const dead = [];
      for (const [id, client] of this.clients) {
        if (!client.alive) dead.push(id);
        // Also remove clients that haven't had activity in 5 minutes
        if (Date.now() - client.lastActivity > 300000) {
          client.alive = false;
          dead.push(id);
        }
      }
      for (const id of dead) this.removeClient(id);
    }, this._cleanupMs);

    if (this._cleanupInterval.unref) this._cleanupInterval.unref();
  }

  /**
   * Stop all background intervals (for shutdown).
   */
  shutdown() {
    this._log('Shutting down SSE Manager...');
    this.broadcastAll('shutdown', { reason: 'server-shutdown', timestamp: Date.now() });

    if (this._heartbeatInterval) {
      clearInterval(this._heartbeatInterval);
      this._heartbeatInterval = null;
    }
    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval);
      this._cleanupInterval = null;
    }

    // Close all client connections
    for (const [id, client] of this.clients) {
      client.close();
    }
    this.clients.clear();
    for (const [ch, set] of this.channelIndex) {
      set.clear();
    }

    this._log('SSE Manager shut down. Total messages sent: ' + this.totalMessagesSent);
  }

  /**
   * Generate a unique client ID.
   * @returns {string}
   * @private
   */
  _generateId() {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 8);
    return 'sse-' + ts + '-' + rand;
  }

  /**
   * Generate next message ID.
   * @returns {string}
   * @private
   */
  _nextMsgId() {
    this._msgId++;
    return String(this._msgId);
  }

  /**
   * Internal log helper.
   * @param {string} msg
   * @private
   */
  _log(msg) {
    console.log('[SSE]', msg);
  }
}

// ── Singleton ──
const instance = new SSEManager();

module.exports = instance;
