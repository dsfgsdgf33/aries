/**
 * ARIES v7.0 — MCP Server (Model Context Protocol)
 * 
 * Exposes Aries capabilities as an MCP server that Claude Desktop,
 * Cursor, VS Code Copilot, and other MCP clients can connect to.
 * 
 * Supports stdio transport (for local integration) and SSE transport.
 * Zero npm dependencies — uses only Node.js built-ins.
 */

const EventEmitter = require('events');
const http = require('http');
const crypto = require('crypto');

const JSONRPC_VERSION = '2.0';

const SERVER_INFO = {
  name: 'aries',
  version: '7.0.0',
};

const CAPABILITIES = {
  tools: { listChanged: false },
};

/** Define all tools Aries exposes via MCP */
function getToolDefinitions(refs) {
  const tools = [
    {
      name: 'aries_chat',
      description: 'Send a message to Aries AI and get a response. Supports multiple AI models via Ollama or cloud APIs.',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'The message to send to the AI' },
          persona: { type: 'string', description: 'AI persona: default, coder, creative, analyst', default: 'default' },
        },
        required: ['message'],
      },
    },
    {
      name: 'aries_search',
      description: 'Search the web using Aries built-in web search and return summarized results.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          maxResults: { type: 'number', description: 'Maximum results to return', default: 5 },
        },
        required: ['query'],
      },
    },
    {
      name: 'aries_memory_search',
      description: 'Search Aries persistent memory bank for relevant stored information.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query for memory' },
          limit: { type: 'number', description: 'Max results', default: 10 },
        },
        required: ['query'],
      },
    },
    {
      name: 'aries_memory_save',
      description: 'Save information to Aries persistent memory for future retrieval.',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Information to remember' },
          category: { type: 'string', description: 'Category (general, code, research, personal)', default: 'general' },
          priority: { type: 'string', description: 'Priority (low, normal, high, critical)', default: 'normal' },
        },
        required: ['text'],
      },
    },
    {
      name: 'aries_rag_query',
      description: 'Query documents indexed in Aries RAG (Retrieval-Augmented Generation) system.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Question to ask about indexed documents' },
          topK: { type: 'number', description: 'Number of relevant chunks to retrieve', default: 5 },
        },
        required: ['query'],
      },
    },
    {
      name: 'aries_run_code',
      description: 'Execute code in Aries sandboxed environment. Supports JavaScript, Python, PowerShell, Bash.',
      inputSchema: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Code to execute' },
          language: { type: 'string', description: 'Language: javascript, python, powershell, bash', default: 'javascript' },
        },
        required: ['code'],
      },
    },
    {
      name: 'aries_screenshot',
      description: 'Capture a screenshot of the current screen.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'aries_system_status',
      description: 'Get Aries system status including CPU, RAM, uptime, active agents, and connected workers.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
  ];

  return tools;
}

class MCPServer extends EventEmitter {
  constructor(config = {}) {
    super();
    this.refs = null;
    this.ssePort = config.ssePort || 18801;
    this._sseServer = null;
    this._sseClients = new Set();
    this._initialized = false;
  }

  start(refs) {
    this.refs = refs;
    this._startStdioIfNeeded();
    console.log('[MCP Server] Ready — tools available for Claude Desktop, Cursor, VS Code');
  }

  /** Start SSE transport server */
  startSSE() {
    if (this._sseServer) return;
    this._sseServer = http.createServer((req, res) => this._handleSSE(req, res));
    this._sseServer.listen(this.ssePort, '127.0.0.1', () => {
      console.log(`[MCP Server] SSE transport listening on http://127.0.0.1:${this.ssePort}`);
    });
  }

  /** Handle a JSON-RPC request */
  async handleRequest(request) {
    const { method, id, params } = request;

    switch (method) {
      case 'initialize':
        this._initialized = true;
        return {
          jsonrpc: JSONRPC_VERSION, id,
          result: {
            protocolVersion: '2024-11-05',
            serverInfo: SERVER_INFO,
            capabilities: CAPABILITIES,
          },
        };

      case 'initialized':
        return null; // notification, no response

      case 'tools/list':
        return {
          jsonrpc: JSONRPC_VERSION, id,
          result: { tools: getToolDefinitions(this.refs) },
        };

      case 'tools/call':
        return await this._handleToolCall(id, params);

      case 'ping':
        return { jsonrpc: JSONRPC_VERSION, id, result: {} };

      default:
        return {
          jsonrpc: JSONRPC_VERSION, id,
          error: { code: -32601, message: `Method not found: ${method}` },
        };
    }
  }

  /** Execute a tool call */
  async _handleToolCall(id, params) {
    const { name, arguments: args } = params || {};
    let result;

    try {
      switch (name) {
        case 'aries_chat': {
          const ai = require('./ai');
          const resp = await ai.chat([{ role: 'user', content: args.message }]);
          result = [{ type: 'text', text: resp.response }];
          break;
        }
        case 'aries_search': {
          const webSearch = this.refs?.webSearch;
          if (!webSearch) throw new Error('Web search not available');
          const results = await webSearch.search(args.query, args.maxResults || 5);
          result = [{ type: 'text', text: JSON.stringify(results, null, 2) }];
          break;
        }
        case 'aries_memory_search': {
          const memory = require('./memory');
          const results = memory.getRelevant(args.query, args.limit || 10);
          result = [{ type: 'text', text: JSON.stringify(results, null, 2) }];
          break;
        }
        case 'aries_memory_save': {
          const memory = require('./memory');
          memory.add(args.text, args.category || 'general', args.priority || 'normal');
          result = [{ type: 'text', text: 'Saved to memory.' }];
          break;
        }
        case 'aries_rag_query': {
          const rag = this.refs?.rag;
          if (!rag) throw new Error('RAG engine not available');
          const results = rag.query(args.query, args.topK || 5);
          result = [{ type: 'text', text: JSON.stringify(results, null, 2) }];
          break;
        }
        case 'aries_run_code': {
          const sandbox = this.refs?.sandbox;
          if (!sandbox) throw new Error('Code sandbox not available');
          const execResult = await sandbox.execute(args.code, args.language || 'javascript');
          result = [{ type: 'text', text: execResult.output || execResult.error || '(no output)' }];
          break;
        }
        case 'aries_screenshot': {
          const screenshot = this.refs?.screenshotTool;
          if (!screenshot) throw new Error('Screenshot tool not available');
          const capture = await screenshot.capture();
          result = [
            { type: 'text', text: `Screenshot captured: ${capture.filename}` },
            { type: 'image', data: capture.base64, mimeType: 'image/png' },
          ];
          break;
        }
        case 'aries_system_status': {
          const os = require('os');
          result = [{ type: 'text', text: JSON.stringify({
            platform: os.platform(),
            arch: os.arch(),
            cpus: os.cpus().length,
            totalMemory: Math.round(os.totalmem() / 1024 / 1024 / 1024) + 'GB',
            freeMemory: Math.round(os.freemem() / 1024 / 1024 / 1024) + 'GB',
            uptime: Math.round(os.uptime() / 3600) + 'h',
            hostname: os.hostname(),
          }, null, 2) }];
          break;
        }
        default:
          return {
            jsonrpc: JSONRPC_VERSION, id,
            error: { code: -32602, message: `Unknown tool: ${name}` },
          };
      }
    } catch (e) {
      result = [{ type: 'text', text: `Error: ${e.message}` }];
      return { jsonrpc: JSONRPC_VERSION, id, result: { content: result, isError: true } };
    }

    return { jsonrpc: JSONRPC_VERSION, id, result: { content: result } };
  }

  /** Handle SSE HTTP requests */
  _handleSSE(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url === '/sse' && req.method === 'GET') {
      // SSE stream
      const clientId = crypto.randomBytes(8).toString('hex');
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write(`event: endpoint\ndata: /message?sessionId=${clientId}\n\n`);
      this._sseClients.add({ id: clientId, res });
      req.on('close', () => {
        for (const client of this._sseClients) {
          if (client.id === clientId) { this._sseClients.delete(client); break; }
        }
      });
      return;
    }

    if (req.url?.startsWith('/message') && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const request = JSON.parse(body);
          const response = await this.handleRequest(request);
          if (response) {
            // Send via SSE to the client
            const urlParams = new (require('url').URL)('http://localhost' + req.url).searchParams;
            const sessionId = urlParams.get('sessionId');
            for (const client of this._sseClients) {
              if (client.id === sessionId) {
                client.res.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
                break;
              }
            }
          }
          res.writeHead(202);
          res.end('Accepted');
        } catch (e) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  }

  /** Stdio transport — used by Claude Desktop */
  _startStdioIfNeeded() {
    // Only activate if launched with --mcp-stdio flag
    if (!process.argv.includes('--mcp-stdio')) return;

    let buffer = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', async (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const request = JSON.parse(line);
          const response = await this.handleRequest(request);
          if (response) {
            process.stdout.write(JSON.stringify(response) + '\n');
          }
        } catch (e) {
          process.stdout.write(JSON.stringify({
            jsonrpc: JSONRPC_VERSION,
            error: { code: -32700, message: 'Parse error' },
          }) + '\n');
        }
      }
    });
  }

  /** Generate config snippets for various clients */
  static getConfigExamples() {
    const ariesPath = require('path').resolve(__dirname, '..');
    return {
      claudeDesktop: {
        description: 'Add to ~/Library/Application Support/Claude/claude_desktop_config.json (macOS) or %APPDATA%/Claude/claude_desktop_config.json (Windows)',
        config: {
          mcpServers: {
            aries: {
              command: 'node',
              args: [require('path').join(ariesPath, 'launcher.js'), '--mcp-stdio'],
            }
          }
        }
      },
      cursor: {
        description: 'Add to .cursor/mcp.json in your project root',
        config: {
          mcpServers: {
            aries: {
              command: 'node',
              args: [require('path').join(ariesPath, 'launcher.js'), '--mcp-stdio'],
            }
          }
        }
      },
      vscode: {
        description: 'Add to VS Code settings.json',
        config: {
          'mcp.servers': {
            aries: {
              command: 'node',
              args: [require('path').join(ariesPath, 'launcher.js'), '--mcp-stdio'],
            }
          }
        }
      },
    };
  }
}

module.exports = MCPServer;
