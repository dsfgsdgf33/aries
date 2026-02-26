/**
 * ARIES v5.0 — Extension Bridge (ws package)
 * Bridge for the Aries Browser Extension v2.0.
 * Uses ws npm package for reliable WebSocket handling.
 */

const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const EventEmitter = require('events');

class ExtensionBridge extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.version = opts.version || '2.0.0';
    this._ws = null;
    this._wss = new WebSocketServer({ noServer: true });
    this.connected = false;
    this.pending = new Map();
    this.commandTimeout = opts.commandTimeout || 30000;
    this.capabilities = [];

    const self = this;
    this._wss.on('connection', (ws) => {
      if (self._ws) {
        try { self._ws.close(); } catch {}
      }
      self._ws = ws;
      self.connected = true;
      self.emit('connected');

      ws.on('message', (data) => {
        try { self._handleMessage(data.toString('utf8')); } catch {}
      });

      ws.on('close', () => self._disconnect());
      ws.on('error', () => self._disconnect());
    });
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
    this._wss.handleUpgrade(req, socket, head, (ws) => {
      this._wss.emit('connection', ws, req);
    });
  }

  _onWsConnection(ws) {
    if (this._ws) {
      try { this._ws.close(); } catch {}
    }
    this._ws = ws;
    this.connected = true;
    this.emit('connected');

    ws.on('message', (data) => {
      try { this._handleMessage(data.toString('utf8')); } catch {}
    });

    ws.on('close', () => this._disconnect());
    ws.on('error', () => this._disconnect());
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
    this._ws = null;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('Extension disconnected'));
    }
    this.pending.clear();
    this.emit('disconnected');
  }

  sendCommand(cmd, args = {}) {
    return new Promise((resolve, reject) => {
      if (!this.connected || !this._ws) {
        reject(new Error('Extension not connected'));
        return;
      }
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Command timeout: ' + cmd));
      }, this.commandTimeout);

      this.pending.set(id, { resolve, reject, timer });
      try { this._ws.send(JSON.stringify({ id, cmd, args })); } catch (e) { reject(e); }
    });
  }
}

module.exports = { ExtensionBridge };
