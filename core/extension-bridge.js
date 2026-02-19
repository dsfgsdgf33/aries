/**
 * ARIES v5.0 — Extension Bridge
 * Full-featured bridge for the Aries Browser Extension v2.0.
 * Exposes all 30+ browser control capabilities via HTTP API.
 * Uses the `ws` module for WebSocket handling.
 */

const crypto = require('crypto');
const EventEmitter = require('events');
const WebSocket = require('ws');

class ExtensionBridge extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.version = opts.version || '2.0.0';
    this.ws = null;
    this.connected = false;
    this.pending = new Map();
    this.commandTimeout = opts.commandTimeout || 30000;
    this.capabilities = [];
    this._wss = new WebSocket.Server({ noServer: true });
    this._wss.on('connection', (ws) => this._onConnection(ws));
  }

  /**
   * Register all routes on the API server.
   */
  registerRoutes(addRoute) {
    const self = this;

    // ─── Status & Info ───
    addRoute('GET', '/api/extension/status', () => ({
      connected: self.connected,
      version: self.version,
      capabilities: self.capabilities
    }));

    addRoute('GET', '/api/extension/version', () => ({
      version: self.version
    }));

    addRoute('GET', '/api/extension/capabilities', () => ({
      capabilities: self.capabilities,
      connected: self.connected
    }));

    // ─── Generic Command ───
    addRoute('POST', '/api/extension/command', async (body) => {
      return self.sendCommand(body.cmd, body.args || {});
    });

    // ─── Tabs ───
    addRoute('GET', '/api/extension/tabs', async () => {
      return self.sendCommand('getTabs');
    });

    addRoute('POST', '/api/extension/tabs/open', async (body) => {
      return self.sendCommand('openTab', { url: body.url, background: body.background });
    });

    addRoute('POST', '/api/extension/tabs/close', async (body) => {
      return self.sendCommand('closeTab', { tabId: body.tabId, urlPattern: body.urlPattern });
    });

    addRoute('POST', '/api/extension/tabs/focus', async (body) => {
      return self.sendCommand('focusTab', { tabId: body.tabId });
    });

    addRoute('POST', '/api/extension/tabs/group', async (body) => {
      return self.sendCommand('groupTabs', body);
    });

    addRoute('POST', '/api/extension/tabs/dedup', async () => {
      return self.sendCommand('closeDuplicates');
    });

    // ─── Navigation ───
    addRoute('POST', '/api/extension/navigate', async (body) => {
      return self.sendCommand('navigate', {
        url: body.url, newTab: body.newTab, background: body.background,
        tabId: body.tabId, waitForLoad: body.waitForLoad
      });
    });

    // ─── DOM Snapshot / Aria Tree ───
    addRoute('POST', '/api/extension/snapshot', async (body) => {
      return self.sendCommand('snapshot', { mode: body.mode || 'text', tabId: body.tabId });
    });

    addRoute('POST', '/api/extension/aria', async (body) => {
      return self.sendCommand('ariaTree', { maxDepth: body.maxDepth, tabId: body.tabId });
    });

    // ─── Element Interaction ───
    addRoute('POST', '/api/extension/click', async (body) => {
      return self.sendCommand('click', {
        selector: body.selector, ref: body.ref, method: body.method,
        doubleClick: body.doubleClick, tabId: body.tabId
      });
    });

    addRoute('POST', '/api/extension/type', async (body) => {
      return self.sendCommand('type', {
        selector: body.selector, ref: body.ref, method: body.method,
        text: body.text, clear: body.clear, submit: body.submit, tabId: body.tabId
      });
    });

    addRoute('POST', '/api/extension/fill', async (body) => {
      return self.sendCommand('fill', { fields: body.fields, tabId: body.tabId });
    });

    addRoute('POST', '/api/extension/select', async (body) => {
      return self.sendCommand('select', {
        selector: body.selector, ref: body.ref, method: body.method,
        value: body.value, values: body.values, tabId: body.tabId
      });
    });

    addRoute('POST', '/api/extension/hover', async (body) => {
      return self.sendCommand('hover', { selector: body.selector, ref: body.ref, method: body.method, tabId: body.tabId });
    });

    addRoute('POST', '/api/extension/drag', async (body) => {
      return self.sendCommand('drag', {
        startSelector: body.startSelector, startRef: body.startRef,
        endSelector: body.endSelector, endRef: body.endRef, tabId: body.tabId
      });
    });

    // ─── Smart Find ───
    addRoute('POST', '/api/extension/find', async (body) => {
      return self.sendCommand('findElement', {
        selector: body.selector, text: body.text, label: body.label,
        placeholder: body.placeholder, role: body.role, ref: body.ref,
        method: body.method, tabId: body.tabId
      });
    });

    // ─── Form Fill ───
    addRoute('POST', '/api/extension/form', async (body) => {
      return self.sendCommand('formFill', { fields: body.fields, submit: body.submit, tabId: body.tabId });
    });

    // ─── Evaluate ───
    addRoute('POST', '/api/extension/evaluate', async (body) => {
      return self.sendCommand('evaluate', { code: body.code, tabId: body.tabId });
    });

    // ─── Screenshots ───
    addRoute('POST', '/api/extension/screenshot', async (body) => {
      return self.sendCommand('screenshot', { format: body.format, quality: body.quality });
    });

    addRoute('POST', '/api/extension/screenshot/full', async (body) => {
      return self.sendCommand('fullPageScreenshot', { format: body.format, quality: body.quality, tabId: body.tabId });
    });

    // ─── PDF ───
    addRoute('POST', '/api/extension/pdf', async (body) => {
      return self.sendCommand('pdf', {
        landscape: body.landscape, printBackground: body.printBackground,
        scale: body.scale, paperWidth: body.paperWidth, paperHeight: body.paperHeight,
        tabId: body.tabId
      });
    });

    // ─── Console ───
    addRoute('POST', '/api/extension/console', async (body) => {
      return self.sendCommand('consoleLogs', {
        clear: body.clear, level: body.level, limit: body.limit, since: body.since, tabId: body.tabId
      });
    });

    // ─── Network Interception ───
    addRoute('POST', '/api/extension/network', async (body) => {
      return self.sendCommand('networkIntercept', { action: body.action, tabId: body.tabId, maxEntries: body.maxEntries });
    });

    addRoute('POST', '/api/extension/network/log', async (body) => {
      return self.sendCommand('networkGetLog', { filter: body.filter, limit: body.limit, tabId: body.tabId });
    });

    // ─── Dialog Handling ───
    addRoute('POST', '/api/extension/dialog', async (body) => {
      return self.sendCommand('dialogHandle', {
        action: body.action, autoRespond: body.autoRespond,
        dialogAction: body.dialogAction, accept: body.accept,
        promptText: body.promptText, tabId: body.tabId
      });
    });

    // ─── File Upload ───
    addRoute('POST', '/api/extension/upload', async (body) => {
      return self.sendCommand('fileUpload', {
        selector: body.selector, ref: body.ref,
        data: body.data, filename: body.filename, mimeType: body.mimeType, tabId: body.tabId
      });
    });

    // ─── Cookies ───
    addRoute('GET', '/api/extension/cookies', async (body, query) => {
      return self.sendCommand('getCookies', { url: query.url, domain: query.domain, name: query.name });
    });

    addRoute('POST', '/api/extension/cookies', async (body) => {
      if (body.action === 'delete') {
        return self.sendCommand('deleteCookie', { url: body.url, name: body.name });
      }
      return self.sendCommand('setCookie', body);
    });

    // ─── Scroll ───
    addRoute('POST', '/api/extension/scroll', async (body) => {
      return self.sendCommand('scroll', {
        selector: body.selector, ref: body.ref, x: body.x, y: body.y,
        to: body.to, smooth: body.smooth, block: body.block, tabId: body.tabId
      });
    });

    // ─── Highlight ───
    addRoute('POST', '/api/extension/highlight', async (body) => {
      return self.sendCommand('highlight', {
        selector: body.selector, ref: body.ref, color: body.color,
        label: body.label, duration: body.duration, clear: body.clear, tabId: body.tabId
      });
    });

    // ─── Wait / Readiness ───
    addRoute('POST', '/api/extension/wait', async (body) => {
      return self.sendCommand('waitFor', {
        selector: body.selector, text: body.text, textGone: body.textGone,
        urlContains: body.urlContains, visible: body.visible,
        timeout: body.timeout, optional: body.optional, tabId: body.tabId
      });
    });

    addRoute('POST', '/api/extension/wait/idle', async (body) => {
      return self.sendCommand('waitForIdle', { timeout: body.timeout, idleMs: body.idleMs, tabId: body.tabId });
    });

    // ─── Clipboard ───
    addRoute('POST', '/api/extension/clipboard', async (body) => {
      return self.sendCommand('clipboard', { action: body.action, text: body.text, write: body.write, tabId: body.tabId });
    });

    // ─── Multi-Tab Orchestration ───
    addRoute('POST', '/api/extension/multitab', async (body) => {
      return self.sendCommand('multiTabRun', {
        commands: body.commands, parallel: body.parallel, stopOnError: body.stopOnError
      });
    });

    // ─── Page Content ───
    addRoute('POST', '/api/extension/links', async (body) => {
      return self.sendCommand('getLinks', { tabId: body.tabId });
    });

    addRoute('POST', '/api/extension/text', async (body) => {
      return self.sendCommand('getText', { tabId: body.tabId });
    });

    addRoute('POST', '/api/extension/tables', async (body) => {
      return self.sendCommand('getTables', { tabId: body.tabId });
    });

    // ─── Watches ───
    addRoute('POST', '/api/extension/watch', async (body) => {
      return self.sendCommand('watch', { url: body.url, interval: body.interval, ignoreSelectors: body.ignoreSelectors });
    });

    addRoute('POST', '/api/extension/unwatch', async (body) => {
      return self.sendCommand('unwatch', { url: body.url });
    });

    addRoute('GET', '/api/extension/watches', async () => {
      return self.sendCommand('listWatches');
    });

    // ─── Auth ───
    addRoute('POST', '/api/extension/auth', async (body) => {
      return self.sendCommand('autoLogin', { domain: body.domain, tabId: body.tabId });
    });

    addRoute('POST', '/api/extension/credentials', async (body) => {
      if (body.action === 'delete') return self.sendCommand('deleteCredentials', { domain: body.domain });
      if (body.action === 'list') return self.sendCommand('listCredentials');
      return self.sendCommand('saveCredentials', body);
    });
  }

  /**
   * Handle WebSocket upgrade for /ext path.
   */
  handleUpgrade(req, socket, head) {
    this._wss.handleUpgrade(req, socket, head, (ws) => {
      this._wss.emit('connection', ws, req);
    });
  }

  _onConnection(ws) {
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
      this._disconnect();
    }

    this.ws = ws;
    this.connected = true;
    this.emit('connected');
    console.log('[EXT-BRIDGE] Extension v2.0 connected');

    ws.on('message', (data) => {
      try {
        this._handleMessage(data.toString('utf8'));
      } catch (e) {
        console.error('[EXT-BRIDGE] Message error:', e.message);
      }
    });

    ws.on('close', () => this._disconnect());
    ws.on('error', () => this._disconnect());
  }

  _handleMessage(text) {
    let msg;
    try { msg = JSON.parse(text); } catch { return; }

    if (msg.event) {
      if (msg.event === 'connected' && msg.data && msg.data.capabilities) {
        this.capabilities = msg.data.capabilities;
      }
      this.emit(msg.event, msg.data);
      console.log('[EXT-BRIDGE] Event:', msg.event);
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
    this.ws = null;
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('Extension disconnected'));
    }
    this.pending.clear();
    this.emit('disconnected');
    console.log('[EXT-BRIDGE] Extension disconnected');
  }

  /**
   * Send a command to the extension and wait for response.
   */
  sendCommand(cmd, args = {}) {
    return new Promise((resolve, reject) => {
      if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Extension not connected'));
        return;
      }
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Command timeout: ' + cmd));
      }, this.commandTimeout);

      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, cmd, args }));
    });
  }
}

module.exports = { ExtensionBridge };
