/**
 * ARIES v4.2 — Web Scraper
 * Intelligent URL fetcher with HTML-to-text extraction, rate limiting, and caching.
 * No npm packages — uses only Node.js built-ins.
 */

const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CACHE_FILE = path.join(DATA_DIR, 'scraper-cache.json');

class WebScraper extends EventEmitter {
  constructor(config = {}) {
    super();
    this.maxRatePerSec = config.maxRatePerSec || 2;
    this.cacheTTLMs = config.cacheTTLMs || 3600000;
    this.maxCrawlDepth = config.maxCrawlDepth || 2;
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
      fs.writeFileSync(CACHE_FILE, JSON.stringify(this._cache, null, 2));
    } catch {}
  }

  _hash(str) {
    return crypto.createHash('md5').update(str).digest('hex');
  }

  /** Rate-limit: wait if needed */
  async _rateLimit() {
    const minInterval = 1000 / this.maxRatePerSec;
    const elapsed = Date.now() - this._lastRequestTime;
    if (elapsed < minInterval) {
      await new Promise(r => setTimeout(r, minInterval - elapsed));
    }
    this._lastRequestTime = Date.now();
  }

  /**
   * Fetch raw HTML from a URL
   * @param {string} targetUrl - URL to fetch
   * @param {number} timeout - Timeout in ms (default 15000)
   * @returns {Promise<{statusCode: number, headers: object, body: string}>}
   */
  async fetch(targetUrl, timeout = 15000) {
    // Check cache
    const hash = this._hash(targetUrl);
    const cached = this._cache[hash];
    if (cached && (Date.now() - cached.timestamp) < this.cacheTTLMs) {
      return { statusCode: 200, headers: {}, body: cached.content, cached: true };
    }

    await this._rateLimit();

    return new Promise((resolve, reject) => {
      const parsed = new URL(targetUrl);
      const mod = parsed.protocol === 'https:' ? https : http;
      const opts = {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: {
          'User-Agent': 'AriesBot/4.2 (+https://aries.ai)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        timeout,
      };

      const req = mod.request(opts, (res) => {
        // Handle redirects
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, targetUrl).href;
          this.fetch(redirectUrl, timeout).then(resolve).catch(reject);
          return;
        }

        let data = '';
        res.setEncoding('utf8');
        res.on('data', c => { data += c; if (data.length > 5e6) { req.destroy(); reject(new Error('Response too large')); } });
        res.on('end', () => {
          // Cache result
          this._cache[hash] = { content: data, timestamp: Date.now(), url: targetUrl };
          this._saveCache();
          resolve({ statusCode: res.statusCode, headers: res.headers, body: data });
        });
      });

      req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
      req.on('error', reject);
      req.end();
    });
  }

  /**
   * Strip HTML tags and extract meaningful text
   * @param {string} html - Raw HTML
   * @returns {string} Clean text
   */
  _htmlToText(html) {
    let text = html;
    // Remove script/style/nav/footer
    text = text.replace(/<(script|style|nav|footer|header|noscript)[^>]*>[\s\S]*?<\/\1>/gi, '');
    // Remove HTML comments
    text = text.replace(/<!--[\s\S]*?-->/g, '');
    // Convert common block elements to newlines
    text = text.replace(/<\/(p|div|h[1-6]|li|tr|br|section|article)>/gi, '\n');
    text = text.replace(/<br\s*\/?>/gi, '\n');
    // Strip remaining tags
    text = text.replace(/<[^>]+>/g, '');
    // Decode common HTML entities
    text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
               .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
    // Collapse whitespace
    text = text.replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n\n').trim();
    return text;
  }

  /**
   * Fetch a URL and extract clean text
   * @param {string} targetUrl - URL to scrape
   * @returns {Promise<{url: string, text: string, title: string, charCount: number}>}
   */
  async extractText(targetUrl) {
    const result = await this.fetch(targetUrl);
    const text = this._htmlToText(result.body);
    // Extract title
    const titleMatch = result.body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';
    return { url: targetUrl, text, title, charCount: text.length, cached: result.cached || false };
  }

  /**
   * Extract all links from a page
   * @param {string} targetUrl - URL to scrape
   * @returns {Promise<Array<{href: string, text: string}>>}
   */
  async extractLinks(targetUrl) {
    const result = await this.fetch(targetUrl);
    const links = [];
    const regex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = regex.exec(result.body)) !== null) {
      try {
        const href = new URL(match[1], targetUrl).href;
        const text = match[2].replace(/<[^>]+>/g, '').trim();
        if (href.startsWith('http')) links.push({ href, text });
      } catch {}
    }
    return links;
  }

  /**
   * Crawl starting from a URL up to a given depth
   * @param {string} startUrl - Starting URL
   * @param {number} depth - Max depth (default from config)
   * @returns {Promise<Array<{url: string, text: string, title: string}>>}
   */
  async crawl(startUrl, depth) {
    const maxDepth = depth || this.maxCrawlDepth;
    const visited = new Set();
    const results = [];
    const baseHost = new URL(startUrl).hostname;

    const _crawl = async (crawlUrl, d) => {
      if (d > maxDepth || visited.has(crawlUrl) || visited.size > 20) return;
      visited.add(crawlUrl);
      try {
        const page = await this.extractText(crawlUrl);
        results.push(page);
        this.emit('crawled', { url: crawlUrl, depth: d, pages: results.length });

        if (d < maxDepth) {
          const links = await this.extractLinks(crawlUrl);
          const sameHost = links.filter(l => {
            try { return new URL(l.href).hostname === baseHost; } catch { return false; }
          });
          for (const link of sameHost.slice(0, 5)) {
            await _crawl(link.href, d + 1);
          }
        }
      } catch (e) {
        this.emit('crawl-error', { url: crawlUrl, error: e.message });
      }
    };

    await _crawl(startUrl, 0);
    return results;
  }

  /**
   * Clear the scraper cache
   * @returns {{cleared: number}}
   */
  clearCache() {
    const count = Object.keys(this._cache).length;
    this._cache = {};
    this._saveCache();
    return { cleared: count };
  }
}

module.exports = { WebScraper };
