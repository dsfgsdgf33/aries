/**
 * ARIES v5.0 — Model Context Protocol (MCP) Client
 * 
 * Connects to MCP servers via stdio or HTTP/SSE transport.
 * Discovers tools and makes them available to Aries agents.
 */

const EventEmitter = require('events');
const { spawn } = require('child_process');
const http = require('http');
const https = require('https');
const crypto = require('crypto');

const JSONRPC_VERSION = '2.0';

class MCPClient extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, MCPConnection>} */
    this.connections = new Map();
    /** @type {Map<string, { tool: object, serverId: string }>} */
    this.tools = new Map();
  }

  /**
   * Connect to an MCP server
   * @param {object} serverConfig
   * @param {string} serverConfig.id - Unique server identifier
   * @param {string} serverConfig.name - Display name
   * @param {string} serverConfig.transport - 'stdio' or 'sse'
   * @param {string} [serverConfig.command] - For stdio: command to spawn
   * @param {string[]} [serverConfig.args] - For stdio: command arguments
   * @param {string} [serverConfig.url] - For SSE: server URL
   * @param {object} [serverConfig.env] - Environment variables for stdio
   * @returns {Promise<{ tools: object[] }>}
   */
  async connect(serverConfig) {
    const id = serverConfig.id || serverConfig.name || crypto.randomBytes(4).toString('hex');

    if (this.connections.has(id)) {
      await this.disconnect(id);
    }

    let conn;
    if (serverConfig.transport === 'stdio') {
      conn = new StdioConnection(id, serverConfig);
    } else if (serverConfig.transport === 'sse') {
      conn = new SSEConnection(id, serverConfig);
    } else {
      throw new Error(`Unknown transport: ${serverConfig.transport}`);
    }

    conn.on('error', (err) => this.emit('error', { serverId: id, error: err.message }));
    conn.on('closed', () => {
      this.connections.delete(id);
      // Remove tools from this server
      for (const [name, entry] of this.tools) {
        if (entry.serverId === id) this.tools.delete(name);
      }
      this.emit('disconnected', { serverId: id });
    });

    await conn.connect();
    this.connections.set(id, conn);

    // Initialize
    await conn.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'aries', version: '4.0.0' },
    });

    await conn.sendNotification('notifications/initialized', {});

    // Discover tools
    const toolsResult = await conn.sendRequest('tools/list', {});
    const tools = toolsResult?.tools || [];

    // Register tools
    for (const tool of tools) {
      this.tools.set(tool.name, { tool, serverId: id });
    }

    this.emit('connected', { serverId: id, name: serverConfig.name, toolCount: tools.length });
    return { tools };
  }

  /**
   * Disconnect from an MCP server
   * @param {string} serverId
   */
  async disconnect(serverId) {
    const conn = this.connections.get(serverId);
    if (conn) {
      conn.close();
      this.connections.delete(serverId);
      // Remove tools
      for (const [name, entry] of this.tools) {
        if (entry.serverId === serverId) this.tools.delete(name);
      }
    }
  }

  /**
   * List all available tools from all connected servers
   * @returns {object[]}
   */
  listTools() {
    return Array.from(this.tools.entries()).map(([name, entry]) => ({
      name,
      description: entry.tool.description || '',
      inputSchema: entry.tool.inputSchema || {},
      serverId: entry.serverId,
    }));
  }

  /**
   * Call a tool on a connected MCP server
   * @param {string} name - Tool name
   * @param {object} args - Tool arguments
   * @returns {Promise<object>}
   */
  async callTool(name, args = {}) {
    const entry = this.tools.get(name);
    if (!entry) throw new Error(`Unknown MCP tool: ${name}`);

    const conn = this.connections.get(entry.serverId);
    if (!conn) throw new Error(`MCP server ${entry.serverId} not connected`);

    const result = await conn.sendRequest('tools/call', { name, arguments: args });
    return result;
  }

  /**
   * Get connection status
   * @returns {object[]}
   */
  getStatus() {
    return Array.from(this.connections.entries()).map(([id, conn]) => ({
      id,
      name: conn.name,
      transport: conn.transport,
      connected: conn.connected,
      toolCount: Array.from(this.tools.values()).filter(t => t.serverId === id).length,
    }));
  }

  /**
   * Disconnect all servers
   */
  disconnectAll() {
    for (const [id] of this.connections) {
      this.disconnect(id);
    }
  }
}

// ── Stdio Transport ──

class StdioConnection extends EventEmitter {
  constructor(id, config) {
    super();
    this.id = id;
    this.name = config.name || id;
    this.transport = 'stdio';
    this.command = config.command;
    this.args = config.args || [];
    this.env = config.env || {};
    this.process = null;
    this.connected = false;
    this._nextId = 1;
    this._pending = new Map();
    this._buffer = '';
  }

  async connect() {
    return new Promise((resolve, reject) => {
      try {
        this.process = spawn(this.command, this.args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, ...this.env },
          shell: process.platform === 'win32',
        });

        this.process.stdout.on('data', (data) => this._onData(data.toString()));
        this.process.stderr.on('data', (data) => this.emit('error', new Error(data.toString().trim())));
        this.process.on('close', (code) => {
          this.connected = false;
          this.emit('closed', { code });
        });
        this.process.on('error', (err) => {
          this.connected = false;
          this.emit('error', err);
          reject(err);
        });

        this.connected = true;
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  }

  _onData(data) {
    this._buffer += data;
    const lines = this._buffer.split('\n');
    this._buffer = lines.pop();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        this._handleMessage(msg);
      } catch {}
    }
  }

  _handleMessage(msg) {
    if (msg.id !== undefined && this._pending.has(msg.id)) {
      const { resolve, reject } = this._pending.get(msg.id);
      this._pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  }

  async sendRequest(method, params) {
    return new Promise((resolve, reject) => {
      const id = this._nextId++;
      this._pending.set(id, { resolve, reject });

      const msg = JSON.stringify({ jsonrpc: JSONRPC_VERSION, id, method, params }) + '\n';
      try {
        this.process.stdin.write(msg);
      } catch (err) {
        this._pending.delete(id);
        reject(err);
      }

      // Timeout
      setTimeout(() => {
        if (this._pending.has(id)) {
          this._pending.delete(id);
          reject(new Error(`MCP request timed out: ${method}`));
        }
      }, 30000);
    });
  }

  async sendNotification(method, params) {
    const msg = JSON.stringify({ jsonrpc: JSONRPC_VERSION, method, params }) + '\n';
    try { this.process.stdin.write(msg); } catch {}
  }

  close() {
    this.connected = false;
    if (this.process) {
      try { this.process.kill(); } catch {}
      this.process = null;
    }
    for (const [id, { reject }] of this._pending) {
      reject(new Error('Connection closed'));
    }
    this._pending.clear();
  }
}

// ── SSE Transport ──

class SSEConnection extends EventEmitter {
  constructor(id, config) {
    super();
    this.id = id;
    this.name = config.name || id;
    this.transport = 'sse';
    this.url = config.url;
    this.connected = false;
    this._nextId = 1;
    this._pending = new Map();
    this._messageEndpoint = null;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(this.url);
      const mod = parsedUrl.protocol === 'https:' ? https : http;

      const req = mod.get(this.url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`SSE connect failed: ${res.statusCode}`));
          return;
        }

        this.connected = true;
        let buffer = '';

        res.on('data', (chunk) => {
          buffer += chunk.toString();
          const events = buffer.split('\n\n');
          buffer = events.pop();

          for (const event of events) {
            this._handleSSEEvent(event);
          }
        });

        res.on('end', () => {
          this.connected = false;
          this.emit('closed', {});
        });

        resolve();
      });

      req.on('error', (err) => {
        this.connected = false;
        reject(err);
      });

      req.setTimeout(60000);
    });
  }

  _handleSSEEvent(event) {
    const lines = event.split('\n');
    let eventType = 'message';
    let data = '';

    for (const line of lines) {
      if (line.startsWith('event: ')) eventType = line.substring(7).trim();
      else if (line.startsWith('data: ')) data += line.substring(6);
    }

    if (eventType === 'endpoint' && data) {
      this._messageEndpoint = data.trim();
      return;
    }

    if (data) {
      try {
        const msg = JSON.parse(data);
        this._handleMessage(msg);
      } catch {}
    }
  }

  _handleMessage(msg) {
    if (msg.id !== undefined && this._pending.has(msg.id)) {
      const { resolve, reject } = this._pending.get(msg.id);
      this._pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  }

  async sendRequest(method, params) {
    const endpoint = this._messageEndpoint;
    if (!endpoint) throw new Error('No message endpoint from SSE server');

    const id = this._nextId++;
    const body = JSON.stringify({ jsonrpc: JSONRPC_VERSION, id, method, params });

    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject });

      const parsedUrl = new URL(endpoint, this.url);
      const mod = parsedUrl.protocol === 'https:' ? https : http;

      const req = mod.request(parsedUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          // Response may come via SSE, not HTTP response
          if (res.statusCode !== 200 && res.statusCode !== 202) {
            this._pending.delete(id);
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('error', (err) => {
        this._pending.delete(id);
        reject(err);
      });

      req.write(body);
      req.end();

      setTimeout(() => {
        if (this._pending.has(id)) {
          this._pending.delete(id);
          reject(new Error(`MCP request timed out: ${method}`));
        }
      }, 30000);
    });
  }

  async sendNotification(method, params) {
    if (!this._messageEndpoint) return;
    const body = JSON.stringify({ jsonrpc: JSONRPC_VERSION, method, params });
    try {
      const parsedUrl = new URL(this._messageEndpoint, this.url);
      const mod = parsedUrl.protocol === 'https:' ? https : http;
      const req = mod.request(parsedUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      req.on('error', () => {});
      req.write(body);
      req.end();
    } catch {}
  }

  close() {
    this.connected = false;
    for (const [id, { reject }] of this._pending) {
      reject(new Error('Connection closed'));
    }
    this._pending.clear();
  }
}

module.exports = { MCPClient };
