/**
 * ARIES v4.3 — Web Intelligence Engine
 * Dedicated web research module for the self-evolution system.
 * Uses DuckDuckGo HTML search (no API key needed) and built-in HTTP.
 * No npm packages — uses only Node.js built-ins.
 */

const EventEmitter = require('events');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const querystring = require('querystring');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CACHE_FILE = path.join(DATA_DIR, 'web-research-cache.json');

class WebIntelligence extends EventEmitter {
  /**
   * @param {object} opts
   * @param {object} opts.ai - AI module with callWithFallback
   * @param {object} opts.config - research config section
   * @param {object} [opts.webScraper] - WebScraper instance for fetching
   */
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || {};
    this.config = opts.config || {};
    this.webScraper = opts.webScraper || null;
    this.cacheTTLMs = (this.config.research && this.config.research.cacheTTLMs) || 86400000;
    this._cache = {};
    this._loadCache();
  }

  /** Load research cache from disk */
  _loadCache() {
    try {
      if (fs.existsSync(CACHE_FILE)) {
        this._cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      }
    } catch { this._cache = {}; }
  }

  /** Save research cache to disk */
  _saveCache() {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      // Prune expired entries
      const now = Date.now();
      for (const key of Object.keys(this._cache)) {
        if (this._cache[key].expires && this._cache[key].expires < now) {
          delete this._cache[key];
        }
      }
      fs.writeFileSync(CACHE_FILE, JSON.stringify(this._cache, null, 2));
    } catch {}
  }

  /** Generate cache key */
  _cacheKey(str) {
    return crypto.createHash('md5').update(str).digest('hex');
  }

  /** Get from cache if not expired */
  _getFromCache(key) {
    const entry = this._cache[key];
    if (entry && entry.expires > Date.now()) {
      return entry.data;
    }
    return null;
  }

  /** Set cache entry */
  _setCache(key, data) {
    this._cache[key] = {
      data,
      expires: Date.now() + this.cacheTTLMs,
      timestamp: Date.now()
    };
    this._saveCache();
  }

  /**
   * HTTP GET helper using built-in modules
   * @param {string} targetUrl
   * @param {number} timeout
   * @returns {Promise<string>}
   */
  _httpGet(targetUrl, timeout = 15000) {
    return new Promise((resolve, reject) => {
      try {
        const parsed = new URL(targetUrl);
        const mod = parsed.protocol === 'https:' ? https : http;
        const opts = {
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.pathname + parsed.search,
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,*/*',
            'Accept-Language': 'en-US,en;q=0.5',
          },
          timeout,
        };

        const req = mod.request(opts, (res) => {
          if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
            const redirectUrl = new URL(res.headers.location, targetUrl).href;
            this._httpGet(redirectUrl, timeout).then(resolve).catch(reject);
            return;
          }
          let data = '';
          res.setEncoding('utf8');
          res.on('data', c => {
            data += c;
            if (data.length > 2e6) { req.destroy(); reject(new Error('Response too large')); }
          });
          res.on('end', () => resolve(data));
        });

        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
        req.on('error', reject);
        req.end();
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * Strip HTML tags to plain text
   * @param {string} html
   * @returns {string}
   */
  _htmlToText(html) {
    let text = html;
    text = text.replace(/<(script|style|nav|footer|header|noscript)[^>]*>[\s\S]*?<\/\1>/gi, '');
    text = text.replace(/<!--[\s\S]*?-->/g, '');
    text = text.replace(/<\/(p|div|h[1-6]|li|tr|br|section|article)>/gi, '\n');
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<[^>]+>/g, '');
    text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
               .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
    text = text.replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n\n').trim();
    return text;
  }

  /**
   * Search the web using DuckDuckGo HTML search
   * @param {string} query - Search query
   * @returns {Promise<Array<{title: string, url: string, snippet: string}>>}
   */
  async searchWeb(query) {
    try {
      const cacheKey = this._cacheKey('search:' + query);
      const cached = this._getFromCache(cacheKey);
      if (cached) return cached;

      const encoded = querystring.escape(query);
      const searchUrl = 'https://html.duckduckgo.com/html/?q=' + encoded;
      const html = await this._httpGet(searchUrl);

      const results = [];
      // Parse DuckDuckGo HTML results
      const resultRegex = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
      const snippetRegex = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

      let match;
      const urls = [];
      const titles = [];
      while ((match = resultRegex.exec(html)) !== null) {
        let href = match[1] || '';
        // DuckDuckGo wraps URLs in a redirect; extract the actual URL
        const uddgMatch = href.match(/[?&]uddg=([^&]+)/);
        if (uddgMatch) {
          href = decodeURIComponent(uddgMatch[1]);
        }
        const title = match[2].replace(/<[^>]+>/g, '').trim();
        if (href.startsWith('http')) {
          urls.push(href);
          titles.push(title);
        }
      }

      const snippets = [];
      while ((match = snippetRegex.exec(html)) !== null) {
        snippets.push(match[1].replace(/<[^>]+>/g, '').trim());
      }

      const maxResults = (this.config.research && this.config.research.maxResultsPerQuery) || 10;
      for (let i = 0; i < Math.min(urls.length, maxResults); i++) {
        results.push({
          title: titles[i] || '',
          url: urls[i],
          snippet: snippets[i] || '',
        });
      }

      this._setCache(cacheKey, results);
      this.emit('search', { query, resultCount: results.length });
      return results;
    } catch (e) {
      this.emit('error', e);
      return [];
    }
  }

  /**
   * Fetch a URL and summarize its content using AI
   * @param {string} targetUrl
   * @returns {Promise<{url: string, title: string, summary: string, charCount: number}>}
   */
  async fetchAndSummarize(targetUrl) {
    try {
      const cacheKey = this._cacheKey('summary:' + targetUrl);
      const cached = this._getFromCache(cacheKey);
      if (cached) return cached;

      let text = '';
      let title = '';

      if (this.webScraper) {
        const page = await this.webScraper.extractText(targetUrl);
        text = page.text;
        title = page.title;
      } else {
        const html = await this._httpGet(targetUrl);
        const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';
        text = this._htmlToText(html);
      }

      // Truncate for AI
      const truncated = text.substring(0, 8000);

      let summary = truncated.substring(0, 500);
      if (this.ai && this.ai.callWithFallback) {
        try {
          const resp = await this.ai.callWithFallback([
            { role: 'system', content: 'Summarize the following web page content in 2-3 paragraphs. Focus on key tools, technologies, and trends mentioned.' },
            { role: 'user', content: 'Page title: ' + title + '\n\nContent:\n' + truncated }
          ], null, false);
          summary = (resp.choices && resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content) || summary;
        } catch {}
      }

      const result = { url: targetUrl, title, summary, charCount: text.length };
      this._setCache(cacheKey, result);
      return result;
    } catch (e) {
      this.emit('error', e);
      return { url: targetUrl, title: '', summary: 'Failed to fetch: ' + e.message, charCount: 0 };
    }
  }

  /**
   * Research a topic with multiple queries
   * @param {string} topic
   * @returns {Promise<{topic: string, queries: Array, findings: Array, summary: string, timestamp: string}>}
   */
  async researchTopic(topic) {
    try {
      const cacheKey = this._cacheKey('research:' + topic);
      const cached = this._getFromCache(cacheKey);
      if (cached) return cached;

      // Generate search queries from topic
      let queries = [topic, topic + ' tools 2026', topic + ' best practices'];
      if (this.ai && this.ai.callWithFallback) {
        try {
          const resp = await this.ai.callWithFallback([
            { role: 'system', content: 'Generate 3 specific search queries to research this topic. Return JSON array of strings only.' },
            { role: 'user', content: topic }
          ], null, false);
          const content = (resp.choices && resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content) || '';
          const arrMatch = content.match(/\[[\s\S]*?\]/);
          if (arrMatch) {
            try { queries = JSON.parse(arrMatch[0]); } catch {}
          }
        } catch {}
      }

      const findings = [];
      for (const q of queries.slice(0, 3)) {
        try {
          const results = await this.searchWeb(q);
          for (const r of results.slice(0, 3)) {
            findings.push({
              query: q,
              title: r.title,
              url: r.url,
              snippet: r.snippet,
            });
          }
        } catch {}
      }

      // Generate summary
      let summary = 'Found ' + findings.length + ' results across ' + queries.length + ' queries.';
      if (this.ai && this.ai.callWithFallback && findings.length > 0) {
        try {
          const findingsText = findings.map(function(f) {
            return '- ' + f.title + ': ' + f.snippet;
          }).join('\n');
          const resp = await this.ai.callWithFallback([
            { role: 'system', content: 'Synthesize these research findings into a concise report. Highlight key trends, tools, and actionable insights.' },
            { role: 'user', content: 'Topic: ' + topic + '\n\nFindings:\n' + findingsText }
          ], null, false);
          summary = (resp.choices && resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content) || summary;
        } catch {}
      }

      const result = {
        topic,
        queries,
        findings,
        summary,
        timestamp: new Date().toISOString()
      };

      this._setCache(cacheKey, result);
      this.emit('research', result);
      return result;
    } catch (e) {
      this.emit('error', e);
      return { topic, queries: [], findings: [], summary: 'Research failed: ' + e.message, timestamp: new Date().toISOString() };
    }
  }

  /**
   * Find AI tools in a specific category
   * @param {string} category
   * @returns {Promise<Array<{name: string, description: string, url: string, category: string}>>}
   */
  async findAITools(category) {
    try {
      const queries = [
        'best AI ' + category + ' tools 2026',
        category + ' AI framework open source',
      ];

      const tools = [];
      for (const q of queries) {
        const results = await this.searchWeb(q);
        for (const r of results.slice(0, 5)) {
          tools.push({
            name: r.title.split(' - ')[0].split(' | ')[0].trim(),
            description: r.snippet,
            url: r.url,
            category: category,
          });
        }
      }

      return tools;
    } catch (e) {
      this.emit('error', e);
      return [];
    }
  }

  /**
   * Compare Aries with competitor AI platforms
   * @returns {Promise<{competitors: Array, analysis: string, timestamp: string}>}
   */
  async compareWithCompetitors() {
    try {
      const cacheKey = this._cacheKey('competitive-analysis');
      const cached = this._getFromCache(cacheKey);
      if (cached) return cached;

      const queries = [
        'AI agent platforms comparison 2026',
        'best AI assistant frameworks features',
        'autonomous AI agent systems open source',
      ];

      const findings = [];
      for (const q of queries) {
        try {
          const results = await this.searchWeb(q);
          for (const r of results.slice(0, 3)) {
            findings.push({ title: r.title, snippet: r.snippet, url: r.url });
          }
        } catch {}
      }

      let analysis = 'Competitive analysis based on ' + findings.length + ' sources.';
      if (this.ai && this.ai.callWithFallback && findings.length > 0) {
        try {
          const findingsText = findings.map(function(f) {
            return '- ' + f.title + ': ' + f.snippet;
          }).join('\n');
          const resp = await this.ai.callWithFallback([
            { role: 'system', content: 'You are analyzing AI agent platforms for competitive intelligence. ARIES is a multi-agent AI platform with: 14 specialist agents, swarm execution, RAG, web scraping, autonomous goals, agent debates, knowledge graphs, code sandbox, self-evolution, web sentinel, and browser control. Compare ARIES to competitors found in these search results. Return JSON: { "competitors": [{ "name": "...", "strengths": ["..."], "weaknesses": ["..."] }], "ariesAdvantages": ["..."], "ariesGaps": ["..."], "recommendations": ["..."] }' },
            { role: 'user', content: 'Research findings:\n' + findingsText }
          ], null, false);
          const content = (resp.choices && resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content) || '';
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try { analysis = JSON.parse(jsonMatch[0]); } catch { analysis = content; }
          } else {
            analysis = content;
          }
        } catch {}
      }

      const result = {
        competitors: findings,
        analysis: analysis,
        timestamp: new Date().toISOString()
      };

      this._setCache(cacheKey, result);
      this.emit('competitive-analysis', result);
      return result;
    } catch (e) {
      this.emit('error', e);
      return { competitors: [], analysis: 'Analysis failed: ' + e.message, timestamp: new Date().toISOString() };
    }
  }

  /**
   * Get the research cache contents
   * @returns {object}
   */
  getCache() {
    const entries = [];
    const now = Date.now();
    for (const key of Object.keys(this._cache)) {
      const entry = this._cache[key];
      entries.push({
        key,
        expired: entry.expires < now,
        timestamp: new Date(entry.timestamp).toISOString(),
        expires: new Date(entry.expires).toISOString(),
        dataPreview: JSON.stringify(entry.data).substring(0, 200),
      });
    }
    return { entries, totalEntries: entries.length };
  }

  /**
   * Clear the research cache
   * @returns {{cleared: number}}
   */
  clearCache() {
    const count = Object.keys(this._cache).length;
    this._cache = {};
    this._saveCache();
    return { cleared: count };
  }
}

module.exports = { WebIntelligence };
