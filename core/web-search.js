/**
 * ARIES v4.4 — Built-in Web Search
 * DuckDuckGo HTML search, page fetching, caching.
 * Uses only Node.js built-in modules.
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const querystring = require('querystring');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CACHE_FILE = path.join(DATA_DIR, 'search-cache.json');

class WebSearch {
  /**
   * @param {object} config - webSearch config section
   */
  constructor(config = {}) {
    this.maxRatePerSec = config.maxRatePerSec || 2;
    this.cacheTTLMs = config.cacheTTLMs || 3600000;
    this.defaultResults = config.defaultResults || 10;
    this.braveApiKey = config.braveApiKey || '';
    this._lastRequestTime = 0;
    this._cache = {};
    this._loadCache();
  }

  _loadCache() {
    try {
      if (fs.existsSync(CACHE_FILE)) {
        this._cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      }
    } catch { this._cache = {}; }
  }

  _saveCache() {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      // Prune old cache entries
      const now = Date.now();
      for (const [key, val] of Object.entries(this._cache)) {
        if (now - val.timestamp > this.cacheTTLMs * 2) delete this._cache[key];
      }
      fs.writeFileSync(CACHE_FILE, JSON.stringify(this._cache, null, 2));
    } catch {}
  }

  _hash(str) {
    return crypto.createHash('md5').update(str).digest('hex');
  }

  async _rateLimit() {
    const minInterval = 1000 / this.maxRatePerSec;
    const elapsed = Date.now() - this._lastRequestTime;
    if (elapsed < minInterval) {
      await new Promise(r => setTimeout(r, minInterval - elapsed));
    }
    this._lastRequestTime = Date.now();
  }

  /**
   * Raw HTTP GET
   * @param {string} targetUrl
   * @param {object} headers
   * @returns {Promise<string>}
   */
  _httpGet(targetUrl, headers = {}) {
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
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            ...headers
          },
          timeout: 15000
        };

        const req = mod.request(opts, (res) => {
          // Follow redirects
          if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
            const redirectUrl = new URL(res.headers.location, targetUrl).href;
            this._httpGet(redirectUrl, headers).then(resolve).catch(reject);
            return;
          }
          let data = '';
          res.setEncoding('utf8');
          res.on('data', c => { data += c; if (data.length > 2e6) { req.destroy(); reject(new Error('Too large')); } });
          res.on('end', () => resolve(data));
        });

        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
        req.on('error', reject);
        req.end();
      } catch (e) { reject(e); }
    });
  }

  /**
   * Search via Brave Search API (primary) with DuckDuckGo HTML fallback.
   * Brave API: GET https://api.search.brave.com/res/v1/web/search?q=QUERY
   * Header: X-Subscription-Token: API_KEY
   * @param {string} query - Search query
   * @param {object} options - { maxResults }
   * @returns {Promise<Array<{title: string, url: string, snippet: string}>>}
   */
  async search(query, options = {}) {
    try {
      const cacheKey = this._hash('search:' + query);
      const cached = this._cache[cacheKey];
      if (cached && (Date.now() - cached.timestamp) < this.cacheTTLMs) {
        return cached.results;
      }

      await this._rateLimit();

      const maxResults = options.maxResults || this.defaultResults;
      let results = [];

      // Try Brave Search API first if key is configured
      if (this.braveApiKey) {
        try {
          results = await this._searchBrave(query, maxResults);
        } catch (e) {
          // Brave failed, fall through to DDG
          results = [];
        }
      }

      // Fallback to DuckDuckGo HTML scraping
      if (results.length === 0) {
        results = await this._searchDDG(query, maxResults);
      }

      this._cache[cacheKey] = { results, timestamp: Date.now() };
      this._saveCache();
      return results;
    } catch (e) {
      return [{ title: 'Search error', url: '', snippet: e.message }];
    }
  }

  /**
   * Search via Brave Search API
   * @param {string} query
   * @param {number} maxResults
   * @returns {Promise<Array<{title: string, url: string, snippet: string}>>}
   */
  async _searchBrave(query, maxResults) {
    const encoded = encodeURIComponent(query);
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encoded}&count=${Math.min(maxResults, 20)}`;
    const data = await this._httpGet(url, {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': this.braveApiKey
    });
    const json = JSON.parse(data);
    const results = [];
    const webResults = (json.web && json.web.results) || [];
    for (let i = 0; i < Math.min(webResults.length, maxResults); i++) {
      const r = webResults[i];
      results.push({
        title: r.title || '',
        url: r.url || '',
        snippet: r.description || ''
      });
    }
    return results;
  }

  /**
   * Search via DuckDuckGo HTML (fallback)
   * @param {string} query
   * @param {number} maxResults
   * @returns {Promise<Array<{title: string, url: string, snippet: string}>>}
   */
  async _searchDDG(query, maxResults) {
    const encoded = querystring.escape(query);
    const html = await this._httpGet(`https://html.duckduckgo.com/html/?q=${encoded}`);

    const results = [];
    const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

    const links = [];
    let match;
    while ((match = resultRegex.exec(html)) !== null) {
      let href = match[1];
      if (href.includes('uddg=')) {
        const udMatch = href.match(/uddg=([^&]+)/);
        if (udMatch) href = decodeURIComponent(udMatch[1]);
      }
      const title = match[2].replace(/<[^>]+>/g, '').trim();
      links.push({ url: href, title });
    }

    const snippets = [];
    while ((match = snippetRegex.exec(html)) !== null) {
      snippets.push(match[1].replace(/<[^>]+>/g, '').trim());
    }

    for (let i = 0; i < Math.min(links.length, maxResults); i++) {
      results.push({
        title: links[i].title,
        url: links[i].url,
        snippet: snippets[i] || ''
      });
    }
    return results;
  }

  /**
   * Search news
   * @param {string} query
   * @returns {Promise<Array>}
   */
  async searchNews(query) {
    return this.search(query + ' news', { maxResults: this.defaultResults });
  }

  /**
   * Search images (URLs only)
   * @param {string} query
   * @returns {Promise<Array>}
   */
  async searchImages(query) {
    try {
      await this._rateLimit();
      const encoded = querystring.escape(query);
      const html = await this._httpGet(`https://html.duckduckgo.com/html/?q=${encoded}+images&iax=images&ia=images`);

      const urls = [];
      const imgRegex = /(?:data-src|src)="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|gif|webp)(?:\?[^"]*)?)"/gi;
      let match;
      while ((match = imgRegex.exec(html)) !== null) {
        if (!match[1].includes('duckduckgo.com')) {
          urls.push(match[1]);
        }
      }
      return [...new Set(urls)].slice(0, this.defaultResults);
    } catch { return []; }
  }

  /**
   * Try to get an instant answer
   * @param {string} query
   * @returns {Promise<string|null>}
   */
  async quickAnswer(query) {
    try {
      await this._rateLimit();
      const encoded = querystring.escape(query);
      const data = await this._httpGet(`https://api.duckduckgo.com/?q=${encoded}&format=json&no_redirect=1`);
      const json = JSON.parse(data);
      if (json.AbstractText) return json.AbstractText;
      if (json.Answer) return json.Answer;
      if (json.Definition) return json.Definition;
      return null;
    } catch { return null; }
  }

  /**
   * Fetch and clean a webpage
   * @param {string} targetUrl - URL to fetch
   * @returns {Promise<{url: string, title: string, description: string, text: string, links: Array}>}
   */
  async fetchPage(targetUrl) {
    try {
      const cacheKey = this._hash('page:' + targetUrl);
      const cached = this._cache[cacheKey];
      if (cached && (Date.now() - cached.timestamp) < this.cacheTTLMs) {
        return cached.result;
      }

      await this._rateLimit();
      const html = await this._httpGet(targetUrl);

      // Extract title
      const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';

      // Extract description
      const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i);
      const description = descMatch ? descMatch[1] : '';

      // Strip scripts/styles/nav/footer
      let text = html;
      text = text.replace(/<(script|style|nav|footer|header|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi, '');
      text = text.replace(/<!--[\s\S]*?-->/g, '');
      text = text.replace(/<\/(p|div|h[1-6]|li|tr|br|section|article)>/gi, '\n');
      text = text.replace(/<br\s*\/?>/gi, '\n');
      text = text.replace(/<[^>]+>/g, '');
      text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                 .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
      text = text.replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n\n').trim();

      // Extract links
      const links = [];
      const linkRegex = /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let match;
      while ((match = linkRegex.exec(html)) !== null) {
        try {
          const href = new URL(match[1], targetUrl).href;
          if (href.startsWith('http')) {
            links.push({ url: href, text: match[2].replace(/<[^>]+>/g, '').trim() });
          }
        } catch {}
      }

      const result = {
        url: targetUrl,
        title,
        description,
        text: text.substring(0, 50000),
        links: links.slice(0, 50),
        charCount: text.length
      };

      this._cache[cacheKey] = { result, timestamp: Date.now() };
      this._saveCache();
      return result;
    } catch (e) {
      return { url: targetUrl, title: '', description: '', text: 'Error: ' + e.message, links: [], charCount: 0 };
    }
  }

  /**
   * Fetch and return content for AI summarization
   * @param {string} targetUrl
   * @returns {Promise<{url: string, title: string, text: string}>}
   */
  async fetchAndSummarize(targetUrl) {
    const page = await this.fetchPage(targetUrl);
    return {
      url: page.url,
      title: page.title,
      text: page.text.substring(0, 10000),
      note: 'AI summarization should be done at the API level'
    };
  }

  /**
   * Clear cache
   * @returns {{cleared: number}}
   */
  clearCache() {
    const count = Object.keys(this._cache).length;
    this._cache = {};
    this._saveCache();
    return { cleared: count };
  }
}

module.exports = { WebSearch };
