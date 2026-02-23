/**
 * ARIES v5.0 — WebSocket Server (Zero Dependencies)
 * Minimal RFC 6455 WebSocket implementation using built-in Node.js modules.
 */

const EventEmitter = require('events');
const crypto = require('crypto');
const os = require('os');

const GUID = '258EAFA5-E914-47DA-95CA-5AB5DC786616';

class WebSocketServer extends EventEmitter {
  constructor(config) {
    super();
    config = config || {};
    this._clients = new Map();
    this._clientId = 0;
    this._apiKey = config.apiKey || '';
    this._heartbeatMs = config.heartbeatMs || 30000;
    this._heartbeatTimer = null;
    this._metricsTimer = null;
    this._started = false;
  }

  get clientCount() { return this._clients.size; }

  attach(server) {
    const self = this;
    server.on('upgrade', function(req, socket, head) {
      try {
        const urlParts = require('url').parse(req.url, true);
        if (urlParts.pathname !== '/ws') return; // Let other handlers deal with non-/ws

        // Auth check
        if (self._apiKey) {
          const key = urlParts.query.key || '';
          const ip = (req.socket && req.socket.remoteAddress) || '';
          const isLocal = (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1');
          if (!isLocal && key !== self._apiKey) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
          }
        }

        // WebSocket handshake
        const wsKey = req.headers['sec-websocket-key'];
        if (!wsKey) { socket.destroy(); return; }
        const accept = crypto.createHash('sha1').update(wsKey + GUID).digest('base64');
        socket.write(
          'HTTP/1.1 101 Switching Protocols\r\n' +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
        );

        const clientId = ++self._clientId;
        const client = { id: clientId, socket, alive: true, ip: req.socket.remoteAddress };
        self._clients.set(clientId, client);

        socket.on('data', function(buf) {
          try {
            const frame = self._parseFrame(buf);
            if (!frame) return;
            if (frame.opcode === 0x8) { // Close
              self._clients.delete(clientId);
              socket.end();
              return;
            }
            if (frame.opcode === 0xA) { // Pong
              client.alive = true;
              return;
            }
            if (frame.opcode === 0x1) { // Text
              self.emit('message', clientId, frame.data.toString('utf8'));
            }
          } catch {}
        });

        socket.on('close', function() { self._clients.delete(clientId); });
        socket.on('error', function() { self._clients.delete(clientId); });

        self.emit('connection', clientId);
      } catch (e) {
        try { socket.destroy(); } catch {}
      }
    });

    // Heartbeat
    this._heartbeatTimer = setInterval(function() {
      for (const [id, client] of self._clients) {
        if (!client.alive) {
          self._clients.delete(id);
          try { client.socket.destroy(); } catch {}
          continue;
        }
        client.alive = false;
        try { self._sendRaw(client.socket, Buffer.alloc(0), 0x9); } catch {} // Ping
      }
    }, this._heartbeatMs);

    // System metrics broadcast
    this._metricsTimer = setInterval(function() {
      if (self._clients.size === 0) return;
      const cpus = os.cpus();
      let totalIdle = 0, totalTick = 0;
      for (const cpu of cpus) {
        for (const type of Object.keys(cpu.times)) totalTick += cpu.times[type];
        totalIdle += cpu.times.idle;
      }
      const cpuUsage = Math.round((1 - totalIdle / totalTick) * 100);
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      self.broadcast('metrics', {
        cpu: cpuUsage,
        memUsed: Math.round((totalMem - freeMem) / 1048576),
        memTotal: Math.round(totalMem / 1048576),
        uptime: Math.round(os.uptime()),
        clients: self._clients.size
      });
    }, 5000);

    this._started = true;
  }

  broadcast(type, data) {
    if (this._clients.size === 0) return;
    const msg = JSON.stringify({ type, data, ts: Date.now() });
    const buf = this._encodeFrame(msg);
    for (const [id, client] of this._clients) {
      try { client.socket.write(buf); } catch { this._clients.delete(id); }
    }
  }

  send(clientId, type, data) {
    const client = this._clients.get(clientId);
    if (!client) return;
    const msg = JSON.stringify({ type, data, ts: Date.now() });
    try { client.socket.write(this._encodeFrame(msg)); } catch {}
  }

  stop() {
    if (this._heartbeatTimer) { clearInterval(this._heartbeatTimer); this._heartbeatTimer = null; }
    if (this._metricsTimer) { clearInterval(this._metricsTimer); this._metricsTimer = null; }
    for (const [, client] of this._clients) {
      try { client.socket.destroy(); } catch {}
    }
    this._clients.clear();
  }

  _parseFrame(buf) {
    if (buf.length < 2) return null;
    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    let payloadLen = buf[1] & 0x7f;
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
    let mask = null;
    if (masked) {
      if (buf.length < offset + 4) return null;
      mask = buf.slice(offset, offset + 4);
      offset += 4;
    }
    if (buf.length < offset + payloadLen) return null;
    const data = buf.slice(offset, offset + payloadLen);
    if (mask) {
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
    }
    return { opcode, data };
  }

  _encodeFrame(text) {
    const data = Buffer.from(text, 'utf8');
    const len = data.length;
    let header;
    if (len < 126) {
      header = Buffer.alloc(2);
      header[0] = 0x81; // FIN + text
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    return Buffer.concat([header, data]);
  }

  _sendRaw(socket, data, opcode) {
    const len = data.length;
    let header;
    if (len < 126) {
      header = Buffer.alloc(2);
      header[0] = 0x80 | opcode;
      header[1] = len;
    } else {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    }
    socket.write(Buffer.concat([header, data]));
  }
}

module.exports = { WebSocketServer };
