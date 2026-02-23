/**
 * ARIES v5.0 — Extension Bridge (Zero Dependencies)
 * Full-featured bridge for the Aries Browser Extension v2.0.
 * Uses built-in Node.js for WebSocket handling.
 */

const crypto = require('crypto');
const EventEmitter = require('events');

const WS_GUID = '258EAFA5-E914-47DA-95CA-5AB5DC786616';

class ExtensionBridge extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.version = opts.version || '2.0.0';
    this._socket = null;
    this.connected = false;
    this.pending = new Map();
    this.commandTimeout = opts.commandTimeout || 30000;
    this.capabilities = [];
  }

  registerRoutes(addRoute) {
    const self = this;

    addRoute('GET', '/api/extension/status', () => ({
      connected: self.connected, version: self.version, capabilities: self.capabilities
    }));

    addRoute('POST', '/api/extension/command', async (body) => self.sendCommand(body.cmd, body.args || {}));
    addRoute('GET', '/api/extension/tabs', async () => self.sendCommand('getTabs'));
    addRoute('POST', '/api/extension/tabs/open', async (body) => self.sendCommand('openTab', { url: body.url, background: body.background }));
    addRoute('POST', '/api/extension/tabs/close', async (body) => self.sendCommand('closeTab', { tabId: body.tabId, urlPattern: body.urlPattern }));
    addRoute('POST', '/api/extension/navigate', async (body) => self.sendCommand('navigate', body));
    addRoute('POST', '/api/extension/snapshot', async (body) => self.sendCommand('snapshot', { mode: body.mode || 'text', tabId: body.tabId }));
    addRoute('POST', '/api/extension/click', async (body) => self.sendCommand('click', body));
    addRoute('POST', '/api/extension/type', async (body) => self.sendCommand('type', body));
    addRoute('POST', '/api/extension/evaluate', async (body) => self.sendCommand('evaluate', { code: body.code, tabId: body.tabId }));
    addRoute('POST', '/api/extension/screenshot', async (body) => self.sendCommand('screenshot', body));
    addRoute('POST', '/api/extension/console', async (body) => self.sendCommand('consoleLogs', body));
  }

  handleUpgrade(req, socket, head) {
    const wsKey = req.headers['sec-websocket-key'];
    if (!wsKey) { socket.destroy(); return; }
    const accept = crypto.createHash('sha1').update(wsKey + WS_GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
    );

    if (this._socket) {
      try { this._socket.destroy(); } catch {}
      this._disconnect();
    }

    this._socket = socket;
    this.connected = true;
    this.emit('connected');

    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 2) {
        const frame = this._parseFrame(buffer);
        if (!frame) break;
        buffer = buffer.slice(frame.totalLen);
        if (frame.opcode === 0x8) { this._disconnect(); return; }
        if (frame.opcode === 0x1) {
          try { this._handleMessage(frame.data.toString('utf8')); } catch {}
        }
      }
    });

    socket.on('close', () => this._disconnect());
    socket.on('error', () => this._disconnect());
  }

  _handleMessage(text) {
    let msg;
    try { msg = JSON.parse(text); } catch { return; }

    if (msg.event) {
      if (msg.event === 'connected' && msg.data?.capabilities) {
        this.capabilities = msg.data.capabilities;
      }
      this.emit(msg.event, msg.data);
      return;
    }

    if (msg.id && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.data);
      else p.reject(new Error(msg.error || 'Extension error'));
    }
  }

  _disconnect() {
    if (!this.connected) return;
    this.connected = false;
    this._socket = null;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('Extension disconnected'));
    }
    this.pending.clear();
    this.emit('disconnected');
  }

  sendCommand(cmd, args = {}) {
    return new Promise((resolve, reject) => {
      if (!this.connected || !this._socket) {
        reject(new Error('Extension not connected'));
        return;
      }
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Command timeout: ' + cmd));
      }, this.commandTimeout);

      this.pending.set(id, { resolve, reject, timer });
      this._sendText(JSON.stringify({ id, cmd, args }));
    });
  }

  _sendText(text) {
    if (!this._socket) return;
    const data = Buffer.from(text, 'utf8');
    const len = data.length;
    let header;
    if (len < 126) {
      header = Buffer.alloc(2);
      header[0] = 0x81;
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
    try { this._socket.write(Buffer.concat([header, data])); } catch {}
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
    const totalLen = offset + payloadLen;
    if (buf.length < totalLen) return null;
    const data = Buffer.from(buf.slice(offset, totalLen));
    if (mask) {
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
    }
    return { opcode, data, totalLen };
  }
}

module.exports = { ExtensionBridge };
