/**
 * ARIES v3.0 — Browser Controller
 * Playwright-based browser automation with graceful fallback.
 */

let playwright = null;
let playwrightAvailable = false;

try {
  playwright = require('playwright');
  playwrightAvailable = true;
} catch {
  try {
    playwright = require('puppeteer');
    playwrightAvailable = true;
  } catch {
    playwrightAvailable = false;
  }
}

class BrowserController {
  constructor() {
    this.browser = null;
    this.page = null;
    this.context = null;
    this._type = null; // 'playwright' or 'puppeteer'
  }

  isAvailable() {
    return playwrightAvailable;
  }

  isLaunched() {
    return this.browser !== null && this.page !== null;
  }

  async launch(headless = false) {
    if (!playwrightAvailable) {
      throw new Error('Browser automation unavailable. Run: npm install playwright (or puppeteer)');
    }
    if (this.browser) {
      return 'Browser already running.';
    }
    try {
      if (playwright.chromium) {
        // Playwright API
        this._type = 'playwright';
        this.browser = await playwright.chromium.launch({ headless });
        this.context = await this.browser.newContext();
        this.page = await this.context.newPage();
      } else {
        // Puppeteer API
        this._type = 'puppeteer';
        this.browser = await playwright.launch({ headless });
        this.page = await this.browser.newPage();
        this.context = null;
      }
      return 'Browser launched.';
    } catch (e) {
      this.browser = null;
      this.page = null;
      this.context = null;
      throw new Error(`Failed to launch browser: ${e.message}`);
    }
  }

  async _ensurePage() {
    if (!this.page) {
      await this.launch(true);
    }
  }

  async goto(url) {
    await this._ensurePage();
    try {
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      return `Navigated to ${url}`;
    } catch (e) {
      throw new Error(`Navigation failed: ${e.message}`);
    }
  }

  async screenshot(savePath) {
    await this._ensurePage();
    const p = savePath || `screenshot-${Date.now()}.png`;
    try {
      await this.page.screenshot({ path: p, fullPage: false });
      return p;
    } catch (e) {
      throw new Error(`Screenshot failed: ${e.message}`);
    }
  }

  async click(selector) {
    await this._ensurePage();
    try {
      await this.page.click(selector, { timeout: 10000 });
      return `Clicked: ${selector}`;
    } catch (e) {
      throw new Error(`Click failed on "${selector}": ${e.message}`);
    }
  }

  async type(selector, text) {
    await this._ensurePage();
    try {
      await this.page.fill ? await this.page.fill(selector, text) : await this.page.type(selector, text);
      return `Typed into: ${selector}`;
    } catch (e) {
      throw new Error(`Type failed on "${selector}": ${e.message}`);
    }
  }

  async getText(selector) {
    await this._ensurePage();
    try {
      if (this._type === 'playwright') {
        return await this.page.textContent(selector) || '';
      }
      return await this.page.$eval(selector, el => el.textContent || '');
    } catch (e) {
      throw new Error(`getText failed on "${selector}": ${e.message}`);
    }
  }

  async getPageText() {
    await this._ensurePage();
    try {
      const text = await this.page.evaluate(() => document.body.innerText || '');
      if (text.length > 8000) return text.substring(0, 8000) + '\n[truncated]';
      return text;
    } catch (e) {
      throw new Error(`getPageText failed: ${e.message}`);
    }
  }

  async evaluate(js) {
    await this._ensurePage();
    try {
      const result = await this.page.evaluate(js);
      return typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result);
    } catch (e) {
      throw new Error(`evaluate failed: ${e.message}`);
    }
  }

  async waitFor(selector, timeout = 10000) {
    await this._ensurePage();
    try {
      if (this._type === 'playwright') {
        await this.page.waitForSelector(selector, { timeout });
      } else {
        await this.page.waitForSelector(selector, { timeout });
      }
      return `Element found: ${selector}`;
    } catch (e) {
      throw new Error(`waitFor timed out on "${selector}": ${e.message}`);
    }
  }

  async close() {
    try {
      if (this.context && this._type === 'playwright') await this.context.close();
      if (this.browser) await this.browser.close();
    } catch {}
    this.browser = null;
    this.page = null;
    this.context = null;
    this._type = null;
    return 'Browser closed.';
  }

  // ── Higher-level helpers ──

  async fetchPage(url) {
    await this._ensurePage();
    await this.goto(url);
    return await this.getPageText();
  }

  async fillForm(fields) {
    await this._ensurePage();
    const results = [];
    for (const { selector, value } of fields) {
      try {
        await this.type(selector, value);
        results.push(`✓ ${selector}`);
      } catch (e) {
        results.push(`✗ ${selector}: ${e.message}`);
      }
    }
    return results.join('\n');
  }

  async selectOption(selector, value) {
    await this._ensurePage();
    try {
      if (this._type === 'playwright') {
        await this.page.selectOption(selector, value);
      } else {
        await this.page.select(selector, value);
      }
      return `Selected "${value}" in ${selector}`;
    } catch (e) {
      throw new Error(`selectOption failed: ${e.message}`);
    }
  }

  async scrollTo(selector) {
    await this._ensurePage();
    try {
      await this.page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, selector);
      return `Scrolled to: ${selector}`;
    } catch (e) {
      throw new Error(`scrollTo failed: ${e.message}`);
    }
  }

  async getLinks() {
    await this._ensurePage();
    try {
      const links = await this.page.evaluate(() => {
        return Array.from(document.querySelectorAll('a[href]')).slice(0, 50).map(a => ({
          text: (a.textContent || '').trim().substring(0, 80),
          href: a.href
        }));
      });
      return links.map(l => `${l.text} → ${l.href}`).join('\n') || '(no links found)';
    } catch (e) {
      throw new Error(`getLinks failed: ${e.message}`);
    }
  }

  async downloadFile(url, savePath) {
    await this._ensurePage();
    const fs = require('fs');
    const path = require('path');
    try {
      if (this._type === 'playwright') {
        const [download] = await Promise.all([
          this.page.waitForEvent('download', { timeout: 30000 }),
          this.page.goto(url)
        ]);
        await download.saveAs(savePath);
      } else {
        // Puppeteer fallback: use fetch from page
        const buffer = await this.page.evaluate(async (u) => {
          const resp = await fetch(u);
          const buf = await resp.arrayBuffer();
          return Array.from(new Uint8Array(buf));
        }, url);
        fs.mkdirSync(path.dirname(savePath), { recursive: true });
        fs.writeFileSync(savePath, Buffer.from(buffer));
      }
      return `Downloaded to ${savePath}`;
    } catch (e) {
      throw new Error(`downloadFile failed: ${e.message}`);
    }
  }
}

// Singleton instance
const instance = new BrowserController();

module.exports = instance;
