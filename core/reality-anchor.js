// ============================================================================
// Aries Reality Anchoring — core/reality-anchor.js
// Agents verify their outputs against real-world data before responding
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CACHE_PATH = path.join(__dirname, '..', 'data', 'anchor-cache.json');
const CONFIG_PATH = path.join(__dirname, '..', 'data', 'anchor-config.json');
const CACHE_TTL = 3600000; // 1 hour

class RealityAnchor {
  constructor(opts) {
    this.refs = opts || {};
    this.cache = this._loadJSON(CACHE_PATH, { entries: {}, stats: { verified: 0, unverified: 0, outdated: 0 } });
    this.config = this._loadJSON(CONFIG_PATH, {
      enabled: true,
      perAgent: {},
      depth: 'quick', // quick | thorough
      anchorTypes: { web_verify: true, code_verify: true, data_freshness: true, link_verify: true }
    });
    this.recentVerifications = [];
  }

  _loadJSON(p, fallback) {
    try {
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) {}
    return fallback;
  }

  _saveJSON(p, data) {
    try {
      const dir = path.dirname(p);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(p, JSON.stringify(data, null, 2));
    } catch (e) {}
  }

  _saveCache() { this._saveJSON(CACHE_PATH, this.cache); }
  _saveConfig() { this._saveJSON(CONFIG_PATH, this.config); }

  getConfig() { return this.config; }

  updateConfig(updates) {
    Object.assign(this.config, updates);
    this._saveConfig();
    return this.config;
  }

  // Extract verifiable claims from text
  _extractClaims(text) {
    const claims = [];
    // URLs
    const urlRegex = /https?:\/\/[^\s\)>\]"']+/g;
    let m;
    while ((m = urlRegex.exec(text)) !== null) {
      claims.push({ type: 'link_verify', content: m[0], priority: 2 });
    }
    // Code blocks
    const codeRegex = /```(?:js|javascript|python|bash|sh|node)\n([\s\S]*?)```/g;
    while ((m = codeRegex.exec(text)) !== null) {
      claims.push({ type: 'code_verify', content: m[1].trim(), priority: 3 });
    }
    // Factual claims (sentences with numbers, dates, named entities)
    const sentences = text.replace(/```[\s\S]*?```/g, '').split(/[.!?\n]+/);
    for (const s of sentences) {
      const trimmed = s.trim();
      if (trimmed.length < 20) continue;
      // Sentences with specific numbers, years, percentages, or "is/was/are" factual patterns
      if (/\d{4}|\d+%|\$[\d,.]+|according to|is (?:the|a)|was (?:the|a)|are (?:the|a)|founded|created|released/i.test(trimmed)) {
        claims.push({ type: 'web_verify', content: trimmed, priority: 1 });
      }
    }
    // Sort by priority, take top claims based on depth
    claims.sort((a, b) => a.priority - b.priority);
    const max = this.config.depth === 'thorough' ? 5 : 3;
    return claims.slice(0, max);
  }

  // Check cache
  _checkCache(claim) {
    const key = claim.type + ':' + claim.content.substring(0, 200);
    const entry = this.cache.entries[key];
    if (entry && (Date.now() - entry.ts) < CACHE_TTL) return entry;
    return null;
  }

  _cacheResult(claim, result) {
    const key = claim.type + ':' + claim.content.substring(0, 200);
    this.cache.entries[key] = { ...result, ts: Date.now() };
    // Prune old entries
    const keys = Object.keys(this.cache.entries);
    if (keys.length > 500) {
      const sorted = keys.sort((a, b) => this.cache.entries[a].ts - this.cache.entries[b].ts);
      for (let i = 0; i < 100; i++) delete this.cache.entries[sorted[i]];
    }
    this._saveCache();
  }

  // Verify a single claim
  async _verifyClaim(claim) {
    const cached = this._checkCache(claim);
    if (cached) return cached;

    let result = { status: 'unverified', badge: '⚠️', detail: 'Could not verify', claim: claim.content, type: claim.type };

    try {
      if (claim.type === 'link_verify') {
        result = await this._verifyLink(claim);
      } else if (claim.type === 'code_verify' && this.config.anchorTypes.code_verify) {
        result = await this._verifyCode(claim);
      } else if (claim.type === 'web_verify' && this.config.anchorTypes.web_verify) {
        result = await this._verifyWeb(claim);
      } else if (claim.type === 'data_freshness') {
        result = await this._verifyFreshness(claim);
      }
    } catch (e) {
      result.detail = 'Verification error: ' + e.message;
    }

    this._cacheResult(claim, result);
    return result;
  }

  async _verifyLink(claim) {
    const url = claim.content;
    try {
      const http = url.startsWith('https') ? require('https') : require('http');
      const status = await new Promise((resolve, reject) => {
        const req = http.request(url, { method: 'HEAD', timeout: 5000 }, (res) => resolve(res.statusCode));
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        req.end();
      });
      if (status >= 200 && status < 400) {
        return { status: 'verified', badge: '✅', detail: 'URL responds with HTTP ' + status, claim: url, type: 'link_verify' };
      } else if (status >= 400) {
        return { status: 'outdated', badge: '❌', detail: 'URL returns HTTP ' + status, claim: url, type: 'link_verify' };
      }
    } catch (e) {
      return { status: 'outdated', badge: '❌', detail: 'URL unreachable: ' + e.message, claim: url, type: 'link_verify' };
    }
    return { status: 'unverified', badge: '⚠️', detail: 'Could not determine URL status', claim: url, type: 'link_verify' };
  }

  async _verifyCode(claim) {
    // Only verify short JS/Node snippets for safety
    const code = claim.content;
    if (code.length > 500 || /require\s*\(|import |process\.|fs\.|child_process|exec|spawn|eval\(|Function\(/i.test(code)) {
      return { status: 'unverified', badge: '⚠️', detail: 'Code too complex or unsafe to auto-verify', claim: code.substring(0, 100), type: 'code_verify' };
    }
    try {
      const result = execSync('node -e ' + JSON.stringify(code), { timeout: 3000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      return { status: 'verified', badge: '✅', detail: 'Code executes without error', claim: code.substring(0, 100), type: 'code_verify' };
    } catch (e) {
      return { status: 'outdated', badge: '❌', detail: 'Code execution failed: ' + (e.stderr || e.message).substring(0, 200), claim: code.substring(0, 100), type: 'code_verify' };
    }
  }

  async _verifyWeb(claim) {
    // Use web search if available
    const webSearch = this.refs.webSearch || this.refs.tools?.webSearch;
    if (webSearch && typeof webSearch === 'function') {
      try {
        const results = await webSearch(claim.content.substring(0, 100));
        if (results && results.length > 0) {
          return { status: 'verified', badge: '✅', detail: 'Found corroborating web results: ' + (results[0].title || results[0].snippet || '').substring(0, 150), claim: claim.content.substring(0, 100), type: 'web_verify' };
        }
      } catch (e) {}
    }
    return { status: 'unverified', badge: '⚠️', detail: 'Web verification unavailable or no results', claim: claim.content.substring(0, 100), type: 'web_verify' };
  }

  async _verifyFreshness(claim) {
    return { status: 'unverified', badge: '⚠️', detail: 'Data freshness check not yet implemented for this claim', claim: claim.content.substring(0, 100), type: 'data_freshness' };
  }

  // Main verification pipeline
  async verify(text, agentId) {
    if (!this.config.enabled) return { anchored: false, results: [], text };
    if (agentId && this.config.perAgent[agentId] === false) return { anchored: false, results: [], text };

    const claims = this._extractClaims(text);
    if (claims.length === 0) return { anchored: true, results: [], text, confidence: 1.0 };

    const results = [];
    for (const claim of claims) {
      const r = await this._verifyClaim(claim);
      results.push(r);
      // Update stats
      if (r.status === 'verified') this.cache.stats.verified++;
      else if (r.status === 'outdated') this.cache.stats.outdated++;
      else this.cache.stats.unverified++;
    }

    // Calculate overall confidence
    const verified = results.filter(r => r.status === 'verified').length;
    const total = results.length;
    const confidence = total > 0 ? verified / total : 1.0;

    const entry = { timestamp: Date.now(), text: text.substring(0, 200), results, confidence, agentId };
    this.recentVerifications.unshift(entry);
    if (this.recentVerifications.length > 50) this.recentVerifications.pop();

    this._saveCache();
    return { anchored: true, results, confidence, text };
  }

  getStats() {
    return {
      ...this.cache.stats,
      recentCount: this.recentVerifications.length,
      cacheSize: Object.keys(this.cache.entries).length
    };
  }

  getRecent(limit) {
    return this.recentVerifications.slice(0, limit || 20);
  }

  // Register API routes
  registerRoutes(addRoute) {
    const self = this;

    addRoute('POST', '/api/anchor/verify', async (req, res, json, body) => {
      const data = JSON.parse(body);
      if (!data.text) return json(res, 400, { error: 'Missing text field' });
      const result = await self.verify(data.text, data.agentId);
      json(res, 200, result);
    });

    addRoute('GET', '/api/anchor/config', async (req, res, json) => {
      json(res, 200, self.getConfig());
    });

    addRoute('PUT', '/api/anchor/config', async (req, res, json, body) => {
      const data = JSON.parse(body);
      const config = self.updateConfig(data);
      json(res, 200, config);
    });

    addRoute('GET', '/api/anchor/stats', async (req, res, json) => {
      json(res, 200, self.getStats());
    });

    addRoute('GET', '/api/anchor/recent', async (req, res, json) => {
      json(res, 200, self.getRecent());
    });
  }
}

module.exports = RealityAnchor;
