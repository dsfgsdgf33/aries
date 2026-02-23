/**
 * ARIES v5.0 — AI Core with Multi-Model Fallback
 * 
 * Fallback chain: Aries Gateway → Direct API → Ollama
 * Features: SSE streaming, chunked streaming, tool parsing & execution loop,
 * plugin tool support, model selection per-task.
 */

const http = require('http');
const https = require('https');
const tools = require('./tools');
const memory = require('./memory');
const pluginLoader = require('./plugin-loader');

// Load config — support both new and legacy
let config;
try {
  const cfgMod = require('./config');
  config = cfgMod.load ? cfgMod.load() : cfgMod;
} catch {
  try { config = require('../config.json'); } catch { config = {}; }
}

// Cache config ref — hot-reload updates the _data object in place
let _cfgMod = null;
function getConfig() {
  if (!_cfgMod) { try { _cfgMod = require('./config'); } catch {} }
  if (_cfgMod && _cfgMod._data && Object.keys(_cfgMod._data).length > 0) return _cfgMod._data;
  return config;
}

// Cache system prompt — rebuild only every 30 seconds
let _cachedSystemPrompt = '';
let _systemPromptBuiltAt = 0;
const SYSTEM_PROMPT_TTL = 30000;

function buildSystemPrompt() {
  const now = Date.now();
  if (_cachedSystemPrompt && (now - _systemPromptBuiltAt) < SYSTEM_PROMPT_TTL) return _cachedSystemPrompt;
  
  const cfg = getConfig();
  const pluginTools = pluginLoader.getToolDescriptions();
  
  _systemPromptBuiltAt = now;
  _cachedSystemPrompt = `You are ARIES — an AI that controls this machine. You ACT, not chat.
Time: ${new Date().toLocaleString('en-US', {timeZone:'America/Chicago'})} CT | Operator: ${cfg.user?.name || 'User'}

## Style
- **Be concise.** No walls of text. Lead with the answer, explain only if needed.
- **Act first, narrate after.** When asked to do something, DO IT with tools, then report the result.
- **No filler.** Skip pleasantries, preambles, and obvious observations.
- **Smart and direct.** Like a sharp engineer, not a customer service bot.
- Use markdown: **bold**, \`code\`, code blocks. Short paragraphs.

## Tools
<tool:shell>command</tool:shell> — PowerShell/CMD
<tool:read>path</tool:read> — Read file
<tool:write path="path">content</tool:write> — Write file
<tool:edit path="path" old="old">new</tool:edit> — Edit file
<tool:append path="path">content</tool:append> — Append to file
<tool:delete>path</tool:delete> — Delete file
<tool:ls>dir</tool:ls> — List directory
<tool:search dir="dir" pattern="regex">glob</tool:search> — Search files
<tool:web>url</tool:web> — Fetch webpage (built-in HTTP)
<tool:download url="url">save_path</tool:download> — Download file
<tool:browse>url</tool:browse> — Browse URL, return text
<tool:screenshot>filename</tool:screenshot> — Desktop screenshot
<tool:launch>app</tool:launch> — Launch app
<tool:kill>process</tool:kill> — Kill process
<tool:process>list</tool:process> — List processes
<tool:open>url_or_file</tool:open> — Open in default app
<tool:clipboard>text</tool:clipboard> — Copy to clipboard
<tool:notify>message</tool:notify> — Windows notification
<tool:sysinfo></tool:sysinfo> — System info
<tool:memory>info</tool:memory> — Save to memory
<tool:swarm>task</tool:swarm> — Multi-agent swarm (14 agents)
<tool:evaluate>js_code</tool:evaluate> — Run JS in browser
<tool:install>package</tool:install> — Install package
<tool:desktopScreenshot>filename</tool:desktopScreenshot> — Desktop screenshot
<tool:tts>text</tool:tts> — Text to speech
<tool:cron expr="*/5 * * * *">command</tool:cron> — Schedule cron job
<tool:git>status</tool:git> — Git operations
<tool:netscan>192.168.1</tool:netscan> — Network scan
<tool:imageAnalysis>path</tool:imageAnalysis> — Analyze image
<tool:spawn>command</tool:spawn> — Spawn background process
<tool:crypto action="hash">data</tool:crypto> — Crypto ops (hash/uuid/random/base64)
<tool:serve>directory</tool:serve> — Serve static files
<tool:canvas file="name.html">html_content</tool:canvas> — Create canvas page
<tool:sandbox lang="node">code</tool:sandbox> — Run code in sandbox
<tool:memorySearch>query</tool:memorySearch> — Search memory
<tool:http method="GET">url</tool:http> — HTTP request
<tool:message to="target">text</tool:message> — Send message
<tool:webapp name="myapp">html</tool:webapp> — Create web app at /canvas/
<tool:websearch>query</tool:websearch> — Web search (DuckDuckGo)
${pluginTools ? '\n' + pluginTools : ''}

## Agents: Commander • Coder • Researcher • Analyst • Creative • Scout • Executor • Security • Trader • Debugger • Architect • Optimizer • Navigator • Scribe

## Rules
1. ACT FIRST. Use tools. Don't just talk about it.
2. Chain tools freely. Multi-step = do all steps.
3. Never say "I can't" — find a way or explain why not.
4. Full machine access. Files, network, processes, internet.
5. If you need something, install it.

## Memory Bank (${memory.list().length} entries)
${memory.list().slice(-15).map(m => `- [${m.priority||'normal'}/${m.category||'general'}] ${m.text}`).join('\n') || '(empty)'}

## Environment
- OS: Windows 10 (PowerShell default shell)
- Working Dir: ARIES application directory
- Timezone: America/Chicago (CT)
- Internet: Available`;
  return _cachedSystemPrompt;
}

function parseTools(text) {
  const toolCalls = [];
  const patterns = [
    { name: 'shell', regex: /<tool:shell>([\s\S]*?)<\/tool:shell>/g },
    { name: 'launch', regex: /<tool:launch>([\s\S]*?)<\/tool:launch>/g },
    { name: 'kill', regex: /<tool:kill>([\s\S]*?)<\/tool:kill>/g },
    { name: 'read', regex: /<tool:read>([\s\S]*?)<\/tool:read>/g },
    { name: 'write', regex: /<tool:write\s+path="([^"]*)">([\s\S]*?)<\/tool:write>/g, hasAttr: true },
    { name: 'append', regex: /<tool:append\s+path="([^"]*)">([\s\S]*?)<\/tool:append>/g, hasAttr: true },
    { name: 'web', regex: /<tool:web>([\s\S]*?)<\/tool:web>/g },
    { name: 'download', regex: /<tool:download\s+url="([^"]*)">([\s\S]*?)<\/tool:download>/g, hasAttr: true },
    { name: 'clipboard', regex: /<tool:clipboard>([\s\S]*?)<\/tool:clipboard>/g },
    { name: 'memory', regex: /<tool:memory>([\s\S]*?)<\/tool:memory>/g },
    { name: 'open', regex: /<tool:open>([\s\S]*?)<\/tool:open>/g },
    { name: 'notify', regex: /<tool:notify>([\s\S]*?)<\/tool:notify>/g },
    { name: 'sysinfo', regex: /<tool:sysinfo><\/tool:sysinfo>/g, noContent: true },
    { name: 'sysinfo', regex: /<tool:sysinfo\s*\/>/g, noContent: true },
    { name: 'install', regex: /<tool:install>([\s\S]*?)<\/tool:install>/g },
    { name: 'edit', regex: /<tool:edit\s+path="([^"]*?)"\s+old="([^"]*?)">([\s\S]*?)<\/tool:edit>/g, hasTriple: true },
    { name: 'delete', regex: /<tool:delete>([\s\S]*?)<\/tool:delete>/g },
    { name: 'ls', regex: /<tool:ls>([\s\S]*?)<\/tool:ls>/g },
    { name: 'search', regex: /<tool:search\s+dir="([^"]*?)"\s+pattern="([^"]*?)">([\s\S]*?)<\/tool:search>/g, hasTriple: true },
    { name: 'process', regex: /<tool:process>([\s\S]*?)<\/tool:process>/g },
    { name: 'swarm', regex: /<tool:swarm>([\s\S]*?)<\/tool:swarm>/g },
    { name: 'browse', regex: /<tool:browse>([\s\S]*?)<\/tool:browse>/g },
    { name: 'click', regex: /<tool:click>([\s\S]*?)<\/tool:click>/g },
    { name: 'type', regex: /<tool:type\s+selector="([^"]*)">([\s\S]*?)<\/tool:type>/g, hasAttr: true },
    { name: 'screenshot', regex: /<tool:screenshot>([\s\S]*?)<\/tool:screenshot>/g },
    { name: 'evaluate', regex: /<tool:evaluate>([\s\S]*?)<\/tool:evaluate>/g },
    { name: 'desktopScreenshot', regex: /<tool:desktopScreenshot>([\s\S]*?)<\/tool:desktopScreenshot>/g },
    { name: 'tts', regex: /<tool:tts>([\s\S]*?)<\/tool:tts>/g },
    { name: 'cron', regex: /<tool:cron\s+expr="([^"]*)">([\s\S]*?)<\/tool:cron>/g, hasAttr: true },
    { name: 'git', regex: /<tool:git>([\s\S]*?)<\/tool:git>/g },
    { name: 'netscan', regex: /<tool:netscan>([\s\S]*?)<\/tool:netscan>/g },
    { name: 'imageAnalysis', regex: /<tool:imageAnalysis>([\s\S]*?)<\/tool:imageAnalysis>/g },
    { name: 'spawn', regex: /<tool:spawn>([\s\S]*?)<\/tool:spawn>/g },
    { name: 'crypto', regex: /<tool:crypto\s+action="([^"]*)">([\s\S]*?)<\/tool:crypto>/g, hasAttr: true },
    { name: 'serve', regex: /<tool:serve>([\s\S]*?)<\/tool:serve>/g },
    { name: 'canvas', regex: /<tool:canvas\s+file="([^"]*)">([\s\S]*?)<\/tool:canvas>/g, hasAttr: true },
    { name: 'sandbox', regex: /<tool:sandbox(?:\s+lang="([^"]*)")?>([\s\S]*?)<\/tool:sandbox>/g, hasAttr: true },
    { name: 'memorySearch', regex: /<tool:memorySearch>([\s\S]*?)<\/tool:memorySearch>/g },
    { name: 'http', regex: /<tool:http\s+method="([^"]*)">([\s\S]*?)<\/tool:http>/g, hasAttr: true },
    { name: 'message', regex: /<tool:message\s+to="([^"]*)">([\s\S]*?)<\/tool:message>/g, hasAttr: true },
    { name: 'webapp', regex: /<tool:webapp\s+name="([^"]*)">([\s\S]*?)<\/tool:webapp>/g, hasAttr: true },
    { name: 'websearch', regex: /<tool:websearch>([\s\S]*?)<\/tool:websearch>/g },
  ];

  const pluginRegex = /<tool:plugin_(\w+)>([\s\S]*?)<\/tool:plugin_\1>/g;
  let pm;
  while ((pm = pluginRegex.exec(text)) !== null) {
    toolCalls.push({ tool: 'plugin', args: [pm[1], pm[2]] });
  }

  for (const p of patterns) {
    let m;
    while ((m = p.regex.exec(text)) !== null) {
      if (p.noContent) toolCalls.push({ tool: p.name, args: [] });
      else if (p.hasTriple) toolCalls.push({ tool: p.name, args: [m[1], m[2], m[3]] });
      else if (p.hasAttr) toolCalls.push({ tool: p.name, args: [m[1], m[2]] });
      else toolCalls.push({ tool: p.name, args: [m[1]] });
    }
  }
  return toolCalls;
}

function stripToolTags(text) {
  return text.replace(/<tool:[^>]*>[\s\S]*?<\/tool:[^>]*>/g, '').replace(/<tool:[^/]*\/>/g, '').trim();
}

async function executeTool(call) {
  if (call.tool === 'plugin') return await pluginLoader.execute(call.args[0], call.args[1]);
  const fn = tools[call.tool];
  if (!fn) return { success: false, output: `Unknown tool: ${call.tool}` };
  try { return await fn.apply(tools, call.args); } catch (e) { return { success: false, output: e.message }; }
}

// ═══════════════════════════════════════════════════════════════
// MULTI-MODEL FALLBACK CHAIN
// ═══════════════════════════════════════════════════════════════

/**
 * Try Aries gateway (primary)
 */
/**
 * HTTP POST helper using built-in modules
 */
function _httpPost(url, body, headers, timeout) {
  return new Promise((resolve, reject) => {
    const parsed = new (require('url').URL)(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
      timeout: timeout || 90000
    };
    const req = mod.request(opts, (res) => {
      resolve({ statusCode: res.statusCode, headers: res.headers, stream: res });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    req.write(body);
    req.end();
  });
}

/**
 * Read full response body from a stream
 */
function _readBody(stream) {
  return new Promise((resolve, reject) => {
    let data = '';
    stream.on('data', (c) => data += c);
    stream.on('end', () => resolve(data));
    stream.on('error', reject);
  });
}

async function callGateway(messages, model, stream = false) {
  const cfg = getConfig();
  const gatewayUrl = cfg.gateway?.url;
  const gatewayToken = cfg.gateway?.token;
  if (!gatewayUrl) throw new Error('No gateway URL configured');

  const postBody = JSON.stringify({ model: model || cfg.gateway.model, messages, max_tokens: 4096, temperature: 0.7, stream });
  const resp = await _httpPost(gatewayUrl, postBody, {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + (gatewayToken || '')
  }, 90000);

  if (resp.statusCode >= 400) {
    const errBody = await _readBody(resp.stream);
    throw new Error('API error: HTTP ' + resp.statusCode + ' — ' + errBody.substring(0, 300));
  }

  // Return an object that mimics the interface ai.js expects
  if (stream) {
    return { body: resp.stream, ok: true };
  } else {
    const body = await _readBody(resp.stream);
    return { ok: true, json: async () => JSON.parse(body), text: async () => body };
  }
}

/**
 * Try direct Anthropic API (fallback 1)
 */
/**
 * Auto-detect auth type from key format
 */
function detectAuth(key) {
  if (!key) return null;
  if (key.startsWith('sk-ant-oat01-')) return { type: 'oauth', header: 'Authorization', value: 'Bearer ' + key, beta: 'oauth-2025-04-20' };
  if (key.startsWith('sk-ant-api03-') || key.startsWith('sk-ant-')) return { type: 'apikey', header: 'x-api-key', value: key };
  return { type: 'apikey', header: 'x-api-key', value: key };
}

function buildAnthropicHeaders(key) {
  const auth = detectAuth(key);
  const headers = { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' };
  if (auth && auth.type === 'oauth') {
    headers['Authorization'] = auth.value;
    headers['anthropic-beta'] = auth.beta;
  } else if (auth) {
    headers[auth.header] = auth.value;
  }
  return headers;
}

async function callDirectApi(messages, model) {
  const cfg = getConfig();
  const apiUrl = cfg.fallback?.directApi?.url || 'https://api.anthropic.com/v1/messages';
  const apiKey = cfg.anthropic?.apiKey || cfg.fallback?.directApi?.key || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('No direct API key configured');

  const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
  const anthropicMessages = messages.filter(m => m.role !== 'system');

  const bodyObj = {
    model: (model || cfg.fallback?.directApi?.model || 'claude-sonnet-4-20250514').replace('anthropic/', ''),
    messages: anthropicMessages,
    max_tokens: 4096,
  };
  bodyObj.system = system;

  const postBody = JSON.stringify(bodyObj);
  const headers = buildAnthropicHeaders(apiKey);

  const resp = await _httpPost(apiUrl, postBody, headers, 90000);

  if (resp.statusCode >= 400) {
    const errBody = await _readBody(resp.stream);
    throw new Error('Direct API ' + resp.statusCode + ': ' + errBody.substring(0, 200));
  }
  const body = await _readBody(resp.stream);
  const data = JSON.parse(body);
  return { choices: [{ message: { content: data.content?.[0]?.text || '' } }] };
}

/**
 * Try Ollama (fallback 2)
 */
async function callOllama(messages, model) {
  const cfg = getConfig();
  const ollamaUrl = cfg.fallback?.ollama?.url || 'http://127.0.0.1:11434/api/chat';
  const ollamaModel = model || cfg.fallback?.ollama?.model || 'llama3';

  const postBody = JSON.stringify({ model: ollamaModel, messages, stream: false });
  const resp = await _httpPost(ollamaUrl, postBody, {
    'Content-Type': 'application/json'
  }, 120000);

  if (resp.statusCode >= 400) {
    const errBody = await _readBody(resp.stream);
    throw new Error('Ollama ' + resp.statusCode + ': ' + errBody.substring(0, 200));
  }
  const body = await _readBody(resp.stream);
  const data = JSON.parse(body);
  return { choices: [{ message: { content: data.message?.content || '' } }] };
}

/**
 * Try all backends in fallback order
 */
async function callWithFallback(messages, model, stream = false) {
  const cfg = getConfig();
  const errors = [];

  // 1. Aries Gateway
  try {
    if (stream) return await callGateway(messages, model, true);
    const resp = await callGateway(messages, model, false);
    return await resp.json();
  } catch (e) {
    errors.push(`Gateway: ${e.message}`);
  }

  // 2. Direct Anthropic API (if key available)
  const hasDirectKey = cfg.anthropic?.apiKey || cfg.fallback?.directApi?.key || process.env.ANTHROPIC_API_KEY;
  if (cfg.fallback?.enabled || hasDirectKey) {
    try {
      return await callDirectApi(messages, model);
    } catch (e) {
      errors.push(`Direct: ${e.message}`);
    }

    // 3. Ollama
    try {
      return await callOllama(messages, model);
    } catch (e) {
      errors.push(`Ollama: ${e.message}`);
    }
  }

  throw new Error(`All AI backends failed: ${errors.join('; ')}`);
}

// ═══════════════════════════════════════════════════════════════
// CHAT FUNCTIONS
// ═══════════════════════════════════════════════════════════════

async function chatStream(messages, onToken, onToolExec, opts) {
  const cfg = getConfig();
  const systemPrompt = buildSystemPrompt();
  const chatModel = (opts && opts.model) || cfg.models?.chat || cfg.gateway?.model;

  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
  let memCtx = '';
  if (lastUserMsg) {
    const relevant = memory.getRelevant(lastUserMsg.content, 5);
    if (relevant.length > 0) memCtx = '\n\nRelevant memories:\n' + relevant.map(m => `- [${m.priority}] ${m.text}`).join('\n');
  }

  const apiMessages = [
    { role: 'system', content: systemPrompt + memCtx },
    ...messages
  ];

  let iterations = 0;
  let fullResponse = '';

  while (iterations < (cfg.maxToolIterations || 8)) {
    iterations++;

    try {
      // Try streaming via gateway
      const resp = await callGateway(apiMessages, chatModel, true);

      let content = '';
      let buffer = '';
      let _usedModel = null;

      await new Promise((resolve, reject) => {
        resp.body.on('data', chunk => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop();
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.substring(6).trim();
              if (data === '[DONE]') { resolve(); return; }
              try {
                const parsed = JSON.parse(data);
                // Capture model metadata from gateway
                if (parsed._meta && parsed._usedModel) {
                  _usedModel = parsed._usedModel;
                  continue;
                }
                const delta = parsed.choices?.[0]?.delta?.content;
                if (delta) { content += delta; if (onToken) onToken(delta); }
              } catch {}
            }
          }
        });
        resp.body.on('end', resolve);
        resp.body.on('error', reject);
      });

      apiMessages.push({ role: 'assistant', content });
      const toolCalls = parseTools(content);

      if (toolCalls.length === 0) { fullResponse = content; return { response: fullResponse, iterations, usedModel: _usedModel }; }

      const results = [];
      for (const call of toolCalls) {
        if (onToolExec) onToolExec(call);
        results.push({ tool: call.tool, args: call.args, ...(await executeTool(call)) });
      }

      apiMessages.push({ role: 'user', content: `Tool results:\n${results.map(r => `[${r.tool}] ${r.success ? '✓' : '✗'}: ${r.output}`).join('\n\n')}` });
      fullResponse = stripToolTags(content);

    } catch (e) {
      // Fall back to non-streaming
      if (iterations === 1) return await chat(messages, onToolExec);
      throw e;
    }
  }

  return { response: fullResponse, iterations };
}

/**
 * Chunked streaming — calls onChunk with each text fragment
 */
async function chatStreamChunked(messages, onChunk, opts) {
  let fullResponse = '';
  const result = await chatStream(messages, chunk => {
    fullResponse += chunk;
    if (onChunk) onChunk(chunk);
  }, null, opts);
  return { response: result.response || fullResponse, iterations: result.iterations, usedModel: result.usedModel };
}

async function chat(messages, onToolExec) {
  const cfg = getConfig();
  const systemPrompt = buildSystemPrompt();
  const chatModel = cfg.models?.chat || cfg.gateway?.model;

  const apiMessages = [
    { role: 'system', content: systemPrompt },
    ...messages
  ];

  let iterations = 0;
  let fullResponse = '';

  while (iterations < (cfg.maxToolIterations || 8)) {
    iterations++;

    const data = await callWithFallback(apiMessages, chatModel);
    const content = data.choices?.[0]?.message?.content || '';
    apiMessages.push({ role: 'assistant', content });

    const toolCalls = parseTools(content);
    if (toolCalls.length === 0) { fullResponse = content; break; }

    const results = [];
    for (const call of toolCalls) {
      if (onToolExec) onToolExec(call);
      results.push({ tool: call.tool, args: call.args, ...(await executeTool(call)) });
    }

    apiMessages.push({ role: 'user', content: `Tool results:\n${results.map(r => `[${r.tool}] ${r.success ? '✓' : '✗'}: ${r.output}`).join('\n\n')}` });
    fullResponse = stripToolTags(content);
  }

  return { response: fullResponse, iterations };
}

/**
 * Select the best model for a task type
 */
function selectModel(taskType) {
  const cfg = getConfig();
  const models = cfg.models || {};
  const map = {
    chat: models.chat,
    coding: models.coding || models.chat,
    code: models.coding || models.chat,
    research: models.research || models.chat,
    analysis: models.research || models.chat,
    swarm_decompose: models.swarmDecompose || models.chat,
    swarm_worker: models.swarmWorker || models.research || models.chat,
    swarm_aggregate: models.swarmAggregate || models.chat,
  };
  return map[taskType] || models.chat || cfg.gateway?.model;
}

/**
 * Call swarm Ollama workers via relay
 */
async function callSwarmOllama(messages, model) {
  model = model || 'mistral';
  let relayUrl = 'http://127.0.0.1:9700', secret = '';
  try {
    const _cfg = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'config.json'), 'utf8'));
    relayUrl = (_cfg.relay && _cfg.relay.url) || relayUrl;
    secret = (_cfg.remoteWorkers && _cfg.remoteWorkers.secret) || (_cfg.relay && _cfg.relay.secret) || secret;
  } catch {};

  const taskBody = JSON.stringify({
    task: messages[messages.length - 1]?.content || '',
    model,
    messages
  });

  // Submit task
  const taskResult = await new Promise((resolve, reject) => {
    const req = http.request(relayUrl + '/api/task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Aries-Secret': secret }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('Relay parse error: ' + data)); } });
    });
    req.on('error', reject);
    req.write(taskBody);
    req.end();
  });

  const taskId = taskResult.taskId || taskResult.id;
  if (!taskId) throw new Error('No taskId from relay: ' + JSON.stringify(taskResult));

  // Poll for result
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1000));
    const result = await new Promise((resolve, reject) => {
      http.get(relayUrl + '/api/result/' + taskId, { headers: { 'X-Aries-Secret': secret } }, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('Poll parse error: ' + data)); } });
      }).on('error', reject);
    });

    if (result.status === 'complete' || result.result || result.response) {
      return {
        response: result.result || result.response || '',
        model: result.model || model,
        worker: result.worker || result.workerId || 'unknown',
        taskId
      };
    }
    if (result.status === 'error' || result.error) {
      throw new Error('Relay error: ' + (result.error || 'unknown'));
    }
  }
  throw new Error('Relay timeout after 120s');
}

// ═══════════════════════════════════════════════════════════════
// AGENT LOOP — Iterative tool execution with streaming
// ═══════════════════════════════════════════════════════════════

/**
 * Stream AI response via direct Anthropic API (SSE).
 * Returns full response text. Calls onChunk for each text delta.
 */
async function streamAnthropicDirect(messages, model, onChunk) {
  const cfg = getConfig();
  const apiUrl = cfg.fallback?.directApi?.url || 'https://api.anthropic.com/v1/messages';
  const apiKey = cfg.anthropic?.apiKey || cfg.fallback?.directApi?.key || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('No API key for streaming');

  const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
  const anthropicMessages = messages.filter(m => m.role !== 'system');

  const bodyObj = {
    model: (model || cfg.fallback?.directApi?.model || 'claude-sonnet-4-20250514').replace('anthropic/', ''),
    messages: anthropicMessages,
    max_tokens: 8192,
    stream: true,
  };
  if (system) bodyObj.system = system;

  const postBody = JSON.stringify(bodyObj);
  const headers = buildAnthropicHeaders(apiKey);

  const resp = await _httpPost(apiUrl, postBody, headers, 120000);
  if (resp.statusCode >= 400) {
    const errBody = await _readBody(resp.stream);
    throw new Error('Anthropic stream ' + resp.statusCode + ': ' + errBody.substring(0, 200));
  }

  return new Promise((resolve, reject) => {
    let content = '';
    let buffer = '';
    resp.stream.on('data', chunk => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.substring(6).trim();
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
            content += parsed.delta.text;
            if (onChunk) onChunk(parsed.delta.text);
          }
          if (parsed.type === 'message_stop') { /* done */ }
        } catch {}
      }
    });
    resp.stream.on('end', () => resolve(content));
    resp.stream.on('error', reject);
  });
}

/**
 * Stream AI via gateway (SSE). Returns full response text.
 */
async function streamGateway(messages, model, onChunk) {
  const cfg = getConfig();
  const chatModel = model || cfg.models?.chat || cfg.gateway?.model;
  const resp = await callGateway(messages, chatModel, true);

  return new Promise((resolve, reject) => {
    let content = '';
    let buffer = '';
    resp.body.on('data', chunk => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.substring(6).trim();
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          if (parsed._meta) continue;
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) { content += delta; if (onChunk) onChunk(delta); }
        } catch {}
      }
    });
    resp.body.on('end', () => resolve(content));
    resp.body.on('error', reject);
  });
}

/**
 * Stream AI with fallback: gateway → direct Anthropic
 */
async function streamWithFallback(messages, model, onChunk) {
  try {
    return await streamGateway(messages, model, onChunk);
  } catch (e) {
    // Fallback to direct Anthropic streaming
    const cfg = getConfig();
    const hasKey = cfg.anthropic?.apiKey || cfg.fallback?.directApi?.key || process.env.ANTHROPIC_API_KEY;
    if (hasKey) {
      return await streamAnthropicDirect(messages, model, onChunk);
    }
    throw e;
  }
}

/**
 * Agent loop: iteratively call AI, parse tools, execute, feed results back.
 * 
 * @param {Array} messages - Full message array including system prompt
 * @param {string} model - Model to use
 * @param {Object} callbacks - { onChunk, onToolStart, onToolResult, onIterationDone }
 * @param {AbortSignal} signal - Optional abort signal
 * @returns {Object} { response, iterations }
 */
async function agentLoop(messages, model, callbacks, signal) {
  const MAX_ITERATIONS = 15;
  const { executeSingle } = require('./tools');
  const cb = callbacks || {};
  let lastResponse = '';

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    if (signal && signal.aborted) {
      return { response: lastResponse || 'Agent loop cancelled.', iterations: i };
    }

    // Stream AI response
    let response = '';
    try {
      response = await streamWithFallback(messages, model, cb.onChunk);
    } catch (e) {
      // If streaming fails completely, try non-streaming
      const data = await callWithFallback(messages, model);
      response = data.choices?.[0]?.message?.content || '';
      if (cb.onChunk) cb.onChunk(response);
    }

    lastResponse = response;

    // Parse tool calls
    const toolCalls = parseTools(response);
    if (toolCalls.length === 0) {
      // No tools = final answer
      if (cb.onIterationDone) cb.onIterationDone(i + 1, true);
      return { response: stripToolTags(response), iterations: i + 1 };
    }

    // Signal iteration boundary
    if (cb.onIterationDone) cb.onIterationDone(i + 1, false);

    // Execute tools one at a time
    let toolResultsText = '';
    for (const call of toolCalls) {
      if (signal && signal.aborted) break;
      const argsSummary = Array.isArray(call.args) ? call.args[0] || '' : String(call.args);
      if (cb.onToolStart) cb.onToolStart(call.tool, argsSummary);
      const result = await executeSingle(call.tool, call.args);
      if (cb.onToolResult) cb.onToolResult(call.tool, result);
      toolResultsText += `\n[${call.tool}] ${result}\n`;
    }

    // Add to messages and continue
    messages.push({ role: 'assistant', content: response });
    messages.push({ role: 'user', content: `Tool results:\n${toolResultsText}\n\nContinue with the task. If done, give the final summary.` });
  }

  return { response: stripToolTags(lastResponse) || 'Max iterations reached.', iterations: MAX_ITERATIONS };
}

module.exports = { chat, chatStream, chatStreamChunked, parseTools, stripToolTags, buildSystemPrompt, selectModel, callWithFallback, callSwarmOllama, agentLoop };
