/**
 * ARIES — Browser Agent with Ref-Based Snapshot System
 * Wraps existing browser.js with @e1, @e2, @e3 element references.
 * Inspired by OpenClaw's browser tool pattern.
 * No npm dependencies — uses existing browser.js.
 */

class BrowserAgent {
  constructor(browser) {
    this.browser = browser; // existing BrowserController instance
    this._refs = {};         // @e1 -> { selector, tag, text, type, role }
    this._refCounter = 0;
  }

  /** Reset ref map */
  _resetRefs() {
    this._refs = {};
    this._refCounter = 0;
  }

  /** Generate next ref */
  _nextRef() {
    this._refCounter++;
    return `@e${this._refCounter}`;
  }

  /** Get selector for a ref */
  _getSelector(ref) {
    const entry = this._refs[ref];
    if (!entry) throw new Error(`Unknown ref: ${ref}. Take a snapshot first.`);
    return entry.selector;
  }

  /**
   * Take a snapshot of a page, returning interactive elements with refs.
   * @param {string} url - URL to navigate to (optional if already on page)
   * @param {object} opts - { includeText: bool, maxElements: number }
   * @returns {object} { url, title, elements: [{ref, tag, type, text, role, name, href}] }
   */
  async snapshot(url, opts = {}) {
    if (!this.browser || !this.browser.isAvailable()) {
      throw new Error('Browser not available. Install playwright or puppeteer.');
    }

    if (url) {
      await this.browser.goto(url);
    }

    await this.browser._ensurePage();
    this._resetRefs();

    const maxElements = opts.maxElements || 100;

    // Extract interactive elements via page.evaluate
    const elements = await this.browser.page.evaluate((max) => {
      const interactive = [];
      const selectors = [
        'a[href]', 'button', 'input', 'textarea', 'select',
        '[role="button"]', '[role="link"]', '[role="tab"]',
        '[role="menuitem"]', '[role="checkbox"]', '[role="radio"]',
        '[onclick]', '[tabindex]', 'summary', 'details',
        'label', '[contenteditable="true"]'
      ];

      const seen = new Set();
      for (const sel of selectors) {
        for (const el of document.querySelectorAll(sel)) {
          if (seen.has(el) || interactive.length >= max) continue;
          seen.add(el);

          // Build a unique CSS selector
          let cssSelector = '';
          if (el.id) {
            cssSelector = '#' + CSS.escape(el.id);
          } else {
            const tag = el.tagName.toLowerCase();
            const idx = Array.from(el.parentElement?.children || []).filter(c => c.tagName === el.tagName).indexOf(el);
            cssSelector = tag;
            if (el.name) cssSelector += `[name="${el.name}"]`;
            else if (el.className && typeof el.className === 'string') cssSelector += '.' + el.className.trim().split(/\s+/).slice(0, 2).map(c => CSS.escape(c)).join('.');
            if (idx > 0) cssSelector += `:nth-of-type(${idx + 1})`;
          }

          interactive.push({
            tag: el.tagName.toLowerCase(),
            type: el.type || null,
            text: (el.textContent || '').trim().substring(0, 80),
            role: el.getAttribute('role') || null,
            name: el.getAttribute('name') || el.getAttribute('aria-label') || null,
            href: el.href || null,
            placeholder: el.placeholder || null,
            value: el.value || null,
            selector: cssSelector,
            visible: el.offsetParent !== null || el.tagName === 'BODY'
          });
        }
      }
      return interactive;
    }, maxElements);

    // Assign refs, prefer visible elements
    const visible = elements.filter(e => e.visible);
    const result = [];

    for (const el of visible) {
      const ref = this._nextRef();
      this._refs[ref] = { selector: el.selector, tag: el.tag, type: el.type };
      result.push({
        ref,
        tag: el.tag,
        type: el.type,
        text: el.text,
        role: el.role,
        name: el.name,
        href: el.href,
        placeholder: el.placeholder,
        value: el.value
      });
    }

    const title = await this.browser.page.title();
    const currentUrl = this.browser.page.url();

    return {
      url: currentUrl,
      title,
      elementCount: result.length,
      elements: result
    };
  }

  /**
   * Click an element by ref
   * @param {string} ref - e.g. "@e1"
   */
  async click(ref) {
    const selector = this._getSelector(ref);
    await this.browser.click(selector);
    return `Clicked ${ref} (${selector})`;
  }

  /**
   * Fill an input by ref
   * @param {string} ref - e.g. "@e2"
   * @param {string} text - text to type
   */
  async fill(ref, text) {
    const selector = this._getSelector(ref);
    await this.browser._ensurePage();
    // Clear and type
    if (this.browser._type === 'playwright') {
      await this.browser.page.fill(selector, text);
    } else {
      // Puppeteer fallback
      await this.browser.page.click(selector, { clickCount: 3 });
      await this.browser.page.type(selector, text);
    }
    return `Filled ${ref} with "${text.substring(0, 50)}"`;
  }

  /**
   * Get text content of an element by ref
   * @param {string} ref - e.g. "@e1"
   */
  async getText(ref) {
    const selector = this._getSelector(ref);
    await this.browser._ensurePage();
    const text = await this.browser.page.evaluate((sel) => {
      const el = document.querySelector(sel);
      return el ? (el.textContent || '').trim() : null;
    }, selector);
    return text;
  }

  /**
   * Get attribute of an element by ref
   * @param {string} ref - e.g. "@e1"
   * @param {string} attr - attribute name
   */
  async getAttr(ref, attr) {
    const selector = this._getSelector(ref);
    await this.browser._ensurePage();
    const value = await this.browser.page.evaluate((sel, a) => {
      const el = document.querySelector(sel);
      return el ? el.getAttribute(a) : null;
    }, selector, attr);
    return value;
  }

  /**
   * Take a screenshot
   * @param {string} savePath - file path
   */
  async screenshot(savePath) {
    return await this.browser.screenshot(savePath);
  }

  /**
   * Close the browser
   */
  async close() {
    if (this.browser) {
      await this.browser.close();
    }
    this._resetRefs();
  }

  /**
   * Format snapshot for AI consumption
   */
  formatSnapshot(snapshot) {
    let out = `📄 ${snapshot.title}\n🔗 ${snapshot.url}\n\nInteractive elements (${snapshot.elementCount}):\n`;
    for (const el of snapshot.elements) {
      let desc = `${el.ref} [${el.tag}`;
      if (el.type) desc += `:${el.type}`;
      if (el.role) desc += ` role=${el.role}`;
      desc += ']';
      if (el.name) desc += ` name="${el.name}"`;
      if (el.placeholder) desc += ` placeholder="${el.placeholder}"`;
      if (el.text) desc += ` "${el.text}"`;
      if (el.href) desc += ` → ${el.href.substring(0, 60)}`;
      if (el.value) desc += ` value="${el.value.substring(0, 40)}"`;
      out += desc + '\n';
    }
    return out;
  }
}

// Singleton
let _instance = null;
function getInstance(browser) {
  if (!_instance) {
    const BrowserController = require('./browser');
    _instance = new BrowserAgent(browser || new BrowserController());
  }
  return _instance;
}

module.exports = { BrowserAgent, getInstance };
