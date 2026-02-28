/**
 * ARIES Proxy Mode - OpenAI-compatible API endpoint
 * Routes requests to best provider with caching, rate limiting, cost tracking
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG_PATH = path.join(__dirname, '..', 'data', 'proxy-config.json');
const DEFAULT_CONFIG = {
  enabled: true,
  routes: [
    { pattern: 'gpt-4', provider: 'openai', model: 'gpt-4' },
    { pattern: 'gpt-3.5-turbo', provider: 'openai', model: 'gpt-3.5-turbo' },
    { pattern: 'claude-*', provider: 'anthropic', model: 'claude-3-sonnet-20240229' },
    { pattern: '*', provider: 'ollama', model: 'llama2' }
  ],
  cache: true,
  cacheTTL: 3600000,
  rateLimit: 60,
  fallbackChain: ['openai', 'anthropic', 'ollama'],
  costPerToken: { openai: 0.00003, anthropic: 0.000025, ollama: 0 }
};

let _config = null;
let _cache = new Map();
let _rateLimits = new Map(); // key/ip -> { count, resetAt }
let _stats = { totalRequests: 0, cacheHits: 0, totalCost: 0, clients: new Map(), requestHistory: [] };

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      _config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } else {
      _config = Object.assign({}, DEFAULT_CONFIG);
      saveConfig();
    }
  } catch (e) {
    _config = Object.assign({}, DEFAULT_CONFIG);
  }
  return _config;
}

function saveConfig() {
  try {
    var dir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(_config, null, 2));
  } catch (e) { console.error('[PROXY] Config save error:', e.message); }
}

function hashMessages(messages) {
  return crypto.createHash('md5').update(JSON.stringify(messages)).digest('hex');
}

function checkRateLimit(clientKey) {
  var now = Date.now();
  var limit = _rateLimits.get(clientKey);
  if (!limit || now > limit.resetAt) {
    _rateLimits.set(clientKey, { count: 1, resetAt: now + 60000 });
    return true;
  }
  if (limit.count >= (_config.rateLimit || 60)) return false;
  limit.count++;
  return true;
}

function getClientKey(req) {
  var auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ') && auth.length > 10) return 'key:' + auth.slice(7, 20);
  return 'ip:' + (req.socket?.remoteAddress || 'unknown');
}

function matchRoute(modelName) {
  var routes = _config.routes || [];
  for (var i = 0; i < routes.length; i++) {
    var r = routes[i];
    if (r.pattern === '*') return r;
    if (r.pattern === modelName) return r;
    if (r.pattern.endsWith('*') && modelName.startsWith(r.pattern.slice(0, -1))) return r;
  }
  return routes[routes.length - 1] || { provider: 'ollama', model: 'llama2' };
}

function getAvailableModels() {
  return (_config.routes || []).map(function(r) {
    return { id: r.pattern === '*' ? r.model : r.pattern, object: 'model', owned_by: r.provider, created: Math.floor(Date.now()/1000) };
  });
}

function getStatus() {
  // Clean old cache entries
  var now = Date.now();
  var ttl = _config.cacheTTL || 3600000;
  var cacheSize = 0;
  _cache.forEach(function(v, k) { if (now - v.ts > ttl) _cache.delete(k); else cacheSize++; });
  var clientList = [];
  _stats.clients.forEach(function(v, k) { clientList.push({ key: k, requests: v.count, lastSeen: v.lastSeen }); });
  return {
    enabled: _config.enabled !== false,
    totalRequests: _stats.totalRequests,
    cacheHits: _stats.cacheHits,
    cacheSize: cacheSize,
    totalCost: _stats.totalCost.toFixed(6),
    activeClients: clientList.length,
    clients: clientList,
    rateLimit: _config.rateLimit || 60,
    routes: _config.routes || []
  };
}

function getConfig() { return _config; }
function updateConfig(newCfg) {
  Object.assign(_config, newCfg);
  saveConfig();
  return _config;
}

// Handle /v1/chat/completions
async function handleChatCompletion(req, body, refs) {
  var clientKey = getClientKey(req);
  _stats.totalRequests++;

  // Track client
  var clientInfo = _stats.clients.get(clientKey) || { count: 0, lastSeen: 0 };
  clientInfo.count++;
  clientInfo.lastSeen = Date.now();
  _stats.clients.set(clientKey, clientInfo);

  // Rate limit check
  if (!checkRateLimit(clientKey)) {
    return { status: 429, body: { error: { message: 'Rate limit exceeded', type: 'rate_limit_error', code: 'rate_limit_exceeded' } } };
  }

  var parsed;
  try { parsed = typeof body === 'string' ? JSON.parse(body) : body; } catch (e) {
    return { status: 400, body: { error: { message: 'Invalid JSON', type: 'invalid_request_error' } } };
  }

  var messages = parsed.messages || [];
  var requestedModel = parsed.model || 'gpt-3.5-turbo';

  // Check cache
  if (_config.cache !== false) {
    var hash = hashMessages(messages);
    var cached = _cache.get(hash);
    if (cached && (Date.now() - cached.ts) < (_config.cacheTTL || 3600000)) {
      _stats.cacheHits++;
      return { status: 200, body: cached.response };
    }
  }

  // Route to provider
  var route = matchRoute(requestedModel);
  var response = null;
  var fallbackChain = _config.fallbackChain || [route.provider];
  if (fallbackChain.indexOf(route.provider) === -1) fallbackChain.unshift(route.provider);

  for (var i = 0; i < fallbackChain.length; i++) {
    try {
      response = await callProvider(fallbackChain[i], route.model || requestedModel, parsed, refs);
      if (response) break;
    } catch (e) {
      console.error('[PROXY] Provider ' + fallbackChain[i] + ' failed:', e.message);
    }
  }

  if (!response) {
    return { status: 502, body: { error: { message: 'All providers failed', type: 'server_error' } } };
  }

  // Cost tracking
  var tokens = (response.usage?.total_tokens) || 0;
  var costPerToken = (_config.costPerToken || {})[route.provider] || 0;
  _stats.totalCost += tokens * costPerToken;

  // Cache response
  if (_config.cache !== false) {
    var hash2 = hashMessages(messages);
    _cache.set(hash2, { ts: Date.now(), response: response });
    // Limit cache size
    if (_cache.size > 500) {
      var first = _cache.keys().next().value;
      _cache.delete(first);
    }
  }

  return { status: 200, body: response };
}

async function callProvider(provider, model, params, refs) {
  // Try to use the AI gateway if available
  if (refs && refs.ai && typeof refs.ai.chat === 'function') {
    var result = await refs.ai.chat(params.messages, { model: model, temperature: params.temperature });
    return {
      id: 'chatcmpl-' + crypto.randomBytes(12).toString('hex'),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: model,
      choices: [{ index: 0, message: { role: 'assistant', content: result.content || result.text || String(result) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: result.tokens || 0 }
    };
  }

  // Fallback: call ollama directly
  if (provider === 'ollama') {
    try {
      var http = require('http');
      var data = JSON.stringify({ model: model, messages: params.messages, stream: false });
      var ollamaRes = await new Promise(function(resolve, reject) {
        var req = http.request({ hostname: '127.0.0.1', port: 11434, path: '/api/chat', method: 'POST',
          headers: { 'Content-Type': 'application/json' }, timeout: 30000 }, function(res) {
          var body = '';
          res.on('data', function(c) { body += c; });
          res.on('end', function() { try { resolve(JSON.parse(body)); } catch(e) { reject(e); } });
        });
        req.on('error', reject);
        req.on('timeout', function() { req.destroy(); reject(new Error('timeout')); });
        req.write(data);
        req.end();
      });
      return {
        id: 'chatcmpl-' + crypto.randomBytes(12).toString('hex'),
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [{ index: 0, message: { role: 'assistant', content: ollamaRes.message?.content || '' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: ollamaRes.eval_count || 0 }
      };
    } catch (e) { return null; }
  }

  return null;
}

// Init
loadConfig();

module.exports = { handleChatCompletion, getStatus, getConfig, updateConfig, getAvailableModels, loadConfig };
