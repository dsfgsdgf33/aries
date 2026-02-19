/**
 * ARIES v5.0 — AI Playground
 * Multi-model comparison, benchmarking
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

class AIPlayground {
  constructor() {
    this.historyFile = path.join(__dirname, '..', 'data', 'playground-history.json');
    this.history = [];
    this.refs = null;
  }

  start(refs) {
    this.refs = refs;
    try { this.history = JSON.parse(fs.readFileSync(this.historyFile, 'utf8')); } catch { this.history = []; }
  }

  _save() {
    try { fs.writeFileSync(this.historyFile, JSON.stringify(this.history.slice(-50), null, 2)); } catch {}
  }

  async queryModel(model, prompt) {
    const config = this.refs?.config || {};
    const gateway = config.gateway || {};
    const start = Date.now();

    // Route to appropriate backend
    if (model === 'claude' || model.startsWith('claude')) {
      return this._queryGateway(gateway, model, prompt, start);
    } else if (model === 'ollama' || model.startsWith('llama') || model.startsWith('mistral') || model.startsWith('deepseek')) {
      return this._queryOllama(model, prompt, start);
    } else {
      // Try gateway with model name
      return this._queryGateway(gateway, model, prompt, start);
    }
  }

  _queryGateway(gateway, model, prompt, start) {
    const url = gateway.url || 'http://localhost:18800/v1/chat/completions';
    const token = gateway.token || '';
    return this._httpPost(url, {
      model: model === 'claude' ? (gateway.model || 'claude-sonnet-4-20250514') : model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1000
    }, { 'Authorization': `Bearer ${token}` }, start);
  }

  _queryOllama(model, prompt, start) {
    const modelName = model === 'ollama' ? 'llama3' : model;
    return this._httpPost('http://localhost:11434/api/chat', {
      model: modelName,
      messages: [{ role: 'user', content: prompt }],
      stream: false
    }, {}, start);
  }

  _httpPost(urlStr, body, extraHeaders, start) {
    return new Promise((resolve) => {
      try {
        const parsed = new URL(urlStr);
        const mod = parsed.protocol === 'https:' ? https : http;
        const postData = JSON.stringify(body);
        const req = mod.request(parsed, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData), ...extraHeaders },
          timeout: 30000
        }, (res) => {
          let d = ''; res.on('data', c => d += c);
          res.on('end', () => {
            const elapsed = Date.now() - start;
            try {
              const json = JSON.parse(d);
              const text = json.choices?.[0]?.message?.content || json.message?.content || d.slice(0, 2000);
              const tokens = json.usage?.total_tokens || text.split(/\s+/).length;
              resolve({ model: body.model, text, tokens, elapsed, status: res.statusCode });
            } catch {
              resolve({ model: body.model, text: d.slice(0, 2000), tokens: 0, elapsed, status: res.statusCode });
            }
          });
        });
        req.on('error', (e) => resolve({ model: body.model, text: '', error: e.message, elapsed: Date.now() - start }));
        req.on('timeout', () => { req.destroy(); resolve({ model: body.model, text: '', error: 'timeout', elapsed: Date.now() - start }); });
        req.write(postData);
        req.end();
      } catch (e) { resolve({ model: body.model || 'unknown', text: '', error: e.message, elapsed: Date.now() - start }); }
    });
  }

  async compare(prompt, models) {
    const modelList = models || ['claude'];
    const results = await Promise.all(modelList.map(m => this.queryModel(m, prompt)));
    const entry = { prompt, results, timestamp: Date.now() };
    this.history.push(entry);
    this._save();
    return entry;
  }

  registerRoutes(addRoute) {
    addRoute('POST', '/api/playground/compare', async (req, res, json, body) => {
      try {
        const data = JSON.parse(body);
        const result = await this.compare(data.prompt, data.models);
        json(res, 200, { ok: true, ...result });
      } catch (e) { json(res, 500, { error: e.message }); }
    });
    addRoute('GET', '/api/playground/history', (req, res, json) => {
      json(res, 200, { ok: true, history: this.history.slice(-20) });
    });
  }
}

module.exports = { AIPlayground };
