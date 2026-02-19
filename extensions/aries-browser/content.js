/**
 * Aries Browser Extension v2.0 — Content Script
 * Advanced DOM manipulation: aria tree, element targeting, form filling,
 * console capture, file upload, clipboard, highlighting, scroll control, page readiness.
 */

(() => {
  'use strict';

  // ─── Console Interceptor ───
  const consoleLogs = [];
  const MAX_LOGS = 1000;
  const origConsole = { log: console.log, warn: console.warn, error: console.error, info: console.info };

  function interceptConsole() {
    ['log', 'warn', 'error', 'info'].forEach(level => {
      console[level] = function (...args) {
        consoleLogs.push({
          level,
          message: args.map(a => {
            try { return typeof a === 'object' ? JSON.stringify(a) : String(a); }
            catch { return String(a); }
          }).join(' '),
          timestamp: Date.now()
        });
        if (consoleLogs.length > MAX_LOGS) consoleLogs.shift();
        origConsole[level].apply(console, args);
      };
    });
  }

  // Also capture uncaught errors
  window.addEventListener('error', (e) => {
    consoleLogs.push({ level: 'error', message: `Uncaught: ${e.message} at ${e.filename}:${e.lineno}`, timestamp: Date.now() });
  });

  window.addEventListener('unhandledrejection', (e) => {
    consoleLogs.push({ level: 'error', message: `Unhandled rejection: ${e.reason}`, timestamp: Date.now() });
  });

  interceptConsole();

  // ─── Aria Ref Counter ───
  let refCounter = 0;
  const refMap = new Map(); // ref -> element

  // ─── Message Handler ───
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg._aries) return false;
    handleCommand(msg.cmd, msg.args || {}).then(
      result => sendResponse({ ok: true, data: result }),
      err => sendResponse({ ok: false, error: err.message || String(err) })
    );
    return true;
  });

  // ─── Element Finding ───

  function findElement(selector, method) {
    if (!selector) return null;
    method = method || 'css';

    // By aria ref
    if (method === 'ref' || method === 'aria') {
      return refMap.get(selector) || refMap.get(String(selector));
    }

    if (method === 'xpath') {
      const r = document.evaluate(selector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      return r.singleNodeValue;
    }

    if (method === 'text') {
      return findByText(selector);
    }

    if (method === 'label') {
      return findByLabel(selector);
    }

    if (method === 'placeholder') {
      return document.querySelector(`[placeholder*="${CSS.escape(selector)}" i]`);
    }

    if (method === 'role') {
      return document.querySelector(`[role="${CSS.escape(selector)}"]`);
    }

    // Default: CSS selector
    return document.querySelector(selector);
  }

  function findByText(text) {
    // First try exact matches on buttons, links, labels
    const candidates = document.querySelectorAll('button, a, label, [role="button"], [role="link"], [role="tab"], [role="menuitem"], h1, h2, h3, h4, h5, h6, span, p, div, li, td, th');
    for (const el of candidates) {
      if (el.textContent.trim() === text) return el;
    }
    // Then partial
    for (const el of candidates) {
      if (el.textContent.trim().includes(text) && el.children.length === 0) return el;
    }
    // Fallback: tree walker
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) {
      if (walk.currentNode.textContent.trim().includes(text)) {
        return walk.currentNode.parentElement;
      }
    }
    return null;
  }

  function findByLabel(labelText) {
    const labels = document.querySelectorAll('label');
    for (const label of labels) {
      if (label.textContent.trim().toLowerCase().includes(labelText.toLowerCase())) {
        const input = label.querySelector('input, textarea, select');
        if (input) return input;
        if (label.htmlFor) return document.getElementById(label.htmlFor);
      }
    }
    // Try aria-label
    return document.querySelector(`[aria-label*="${CSS.escape(labelText)}" i]`);
  }

  function smartFind(spec) {
    if (!spec) return null;
    if (typeof spec === 'string') {
      // Try ref first
      const byRef = refMap.get(spec);
      if (byRef) return byRef;
      // Try CSS
      try { const el = document.querySelector(spec); if (el) return el; } catch (e) {}
      // Try text
      return findByText(spec);
    }
    // Object spec: { selector, method, text, label, placeholder, role, ref }
    if (spec.ref) return refMap.get(String(spec.ref));
    if (spec.selector) return findElement(spec.selector, spec.method);
    if (spec.text) return findByText(spec.text);
    if (spec.label) return findByLabel(spec.label);
    if (spec.placeholder) return document.querySelector(`[placeholder*="${CSS.escape(spec.placeholder)}" i]`);
    if (spec.role) return document.querySelector(`[role="${CSS.escape(spec.role)}"]`);
    return null;
  }

  // ─── Simulation Helpers ───

  function getElementCenter(el) {
    const rect = el.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }

  function simulateClick(el, opts) {
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const center = getElementCenter(el);
    const eventOpts = { bubbles: true, cancelable: true, clientX: center.x, clientY: center.y, button: 0 };
    if (opts && opts.doubleClick) {
      el.dispatchEvent(new MouseEvent('dblclick', eventOpts));
    } else {
      el.dispatchEvent(new MouseEvent('mousedown', eventOpts));
      el.dispatchEvent(new MouseEvent('mouseup', eventOpts));
      el.dispatchEvent(new MouseEvent('click', eventOpts));
    }
  }

  function simulateHover(el) {
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const center = getElementCenter(el);
    el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: center.x, clientY: center.y }));
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: center.x, clientY: center.y }));
    el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: center.x, clientY: center.y }));
  }

  function simulateType(el, text, clear) {
    el.focus();
    if (clear) {
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    // Use execCommand for better React/framework compat
    if (clear) {
      el.select();
      document.execCommand('delete');
    }
    // Try insertText first (works with React)
    const inserted = document.execCommand('insertText', false, text);
    if (!inserted) {
      // Fallback to manual events
      for (const ch of text) {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keypress', { key: ch, bubbles: true }));
        el.value = (el.value || '') + ch;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
      }
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function simulateDrag(startEl, endEl) {
    const startCenter = getElementCenter(startEl);
    const endCenter = getElementCenter(endEl);
    startEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: startCenter.x, clientY: startCenter.y }));
    startEl.dispatchEvent(new DragEvent('dragstart', { bubbles: true, clientX: startCenter.x, clientY: startCenter.y }));
    endEl.dispatchEvent(new DragEvent('dragenter', { bubbles: true, clientX: endCenter.x, clientY: endCenter.y }));
    endEl.dispatchEvent(new DragEvent('dragover', { bubbles: true, clientX: endCenter.x, clientY: endCenter.y }));
    endEl.dispatchEvent(new DragEvent('drop', { bubbles: true, clientX: endCenter.x, clientY: endCenter.y }));
    startEl.dispatchEvent(new DragEvent('dragend', { bubbles: true, clientX: endCenter.x, clientY: endCenter.y }));
  }

  // ─── Command Handlers ───

  async function handleCommand(cmd, args) {
    switch (cmd) {
      case 'snapshot': return getSnapshot(args);
      case 'ariaTree': return getAriaTree(args);
      case 'click': return doClick(args);
      case 'type': return doType(args);
      case 'fill': return doFill(args);
      case 'select': return doSelect(args);
      case 'hover': return doHover(args);
      case 'drag': return doDrag(args);
      case 'findElement': return doFindElement(args);
      case 'formFill': return doFormFill(args);
      case 'evaluate': return doEvaluate(args);
      case 'scroll': return doScroll(args);
      case 'highlight': return doHighlight(args);
      case 'waitFor': return doWaitFor(args);
      case 'waitForIdle': return doWaitForIdle(args);
      case 'consoleLogs': return doConsoleLogs(args);
      case 'fileUpload': return doFileUpload(args);
      case 'clipboard': return doClipboard(args);
      case 'getLinks': return getLinks();
      case 'getText': return getText();
      case 'getTables': return getTables();
      default: throw new Error('Unknown content command: ' + cmd);
    }
  }

  // ─── Snapshot ───

  function getSnapshot(args) {
    const mode = args.mode || 'text';
    if (mode === 'html') {
      return { html: document.documentElement.outerHTML.slice(0, 500000) };
    }
    if (mode === 'clean') {
      const clone = document.body.cloneNode(true);
      clone.querySelectorAll('script,style,noscript,svg,link[rel=stylesheet]').forEach(e => e.remove());
      return { html: clone.innerHTML.slice(0, 300000) };
    }
    if (mode === 'aria' || mode === 'accessibility') {
      return getAriaTree(args);
    }
    return { text: document.body.innerText.slice(0, 200000), title: document.title, url: location.href };
  }

  // ─── Aria / Accessibility Tree ───

  function getAriaTree(args) {
    refCounter = 0;
    refMap.clear();
    const maxDepth = args.maxDepth || 50;
    const tree = buildAriaNode(document.body, 0, maxDepth);
    return { tree, url: location.href, title: document.title, refCount: refCounter };
  }

  function buildAriaNode(el, depth, maxDepth) {
    if (!el || depth > maxDepth) return null;
    if (el.nodeType === Node.TEXT_NODE) {
      const text = el.textContent.trim();
      if (!text) return null;
      return { type: 'text', text: text.slice(0, 500) };
    }
    if (el.nodeType !== Node.ELEMENT_NODE) return null;

    const tag = el.tagName.toLowerCase();
    // Skip invisible and non-semantic
    if (['script', 'style', 'noscript', 'link', 'meta'].includes(tag)) return null;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return null;

    const role = el.getAttribute('role') || getImplicitRole(el);
    const name = getAccessibleName(el);
    const value = getAccessibleValue(el);
    const ref = 'e' + (refCounter++);
    refMap.set(ref, el);

    const node = { ref, tag };
    if (role) node.role = role;
    if (name) node.name = name;
    if (value !== undefined && value !== '') node.value = value;

    // Attributes that matter
    if (el.id) node.id = el.id;
    if (el.className && typeof el.className === 'string') {
      const cls = el.className.trim();
      if (cls) node.class = cls.slice(0, 100);
    }
    if (el.href) node.href = el.href;
    if (el.type) node.type = el.type;
    if (el.placeholder) node.placeholder = el.placeholder;
    if (el.disabled) node.disabled = true;
    if (el.checked) node.checked = true;
    if (el.readOnly) node.readOnly = true;
    if (el.required) node.required = true;
    if (el.getAttribute('aria-expanded')) node.expanded = el.getAttribute('aria-expanded');
    if (el.getAttribute('aria-selected')) node.selected = el.getAttribute('aria-selected');
    if (el.getAttribute('aria-pressed')) node.pressed = el.getAttribute('aria-pressed');

    // Bounding rect for interactive elements
    if (isInteractive(el)) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        node.rect = { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) };
      }
    }

    // Children
    const children = [];
    for (const child of el.childNodes) {
      const childNode = buildAriaNode(child, depth + 1, maxDepth);
      if (childNode) children.push(childNode);
    }
    if (children.length) node.children = children;

    // Prune empty non-interactive containers
    if (!children.length && !name && !value && !isInteractive(el) && !role) {
      const text = el.textContent.trim();
      if (!text) return null;
      if (text.length < 200) return { type: 'text', text };
    }

    return node;
  }

  function isInteractive(el) {
    const tag = el.tagName.toLowerCase();
    if (['a', 'button', 'input', 'textarea', 'select', 'details', 'summary'].includes(tag)) return true;
    if (el.getAttribute('role') && ['button', 'link', 'tab', 'menuitem', 'checkbox', 'radio', 'switch', 'textbox', 'combobox', 'slider', 'spinbutton'].includes(el.getAttribute('role'))) return true;
    if (el.onclick || el.getAttribute('onclick') || el.tabIndex >= 0) return true;
    return false;
  }

  function getImplicitRole(el) {
    const tag = el.tagName.toLowerCase();
    const roleMap = {
      'a': el.href ? 'link' : null,
      'button': 'button',
      'input': getInputRole(el),
      'textarea': 'textbox',
      'select': 'combobox',
      'img': 'img',
      'nav': 'navigation',
      'main': 'main',
      'header': 'banner',
      'footer': 'contentinfo',
      'aside': 'complementary',
      'form': 'form',
      'table': 'table',
      'tr': 'row',
      'th': 'columnheader',
      'td': 'cell',
      'ul': 'list',
      'ol': 'list',
      'li': 'listitem',
      'h1': 'heading', 'h2': 'heading', 'h3': 'heading', 'h4': 'heading', 'h5': 'heading', 'h6': 'heading',
      'dialog': 'dialog',
      'details': 'group',
      'summary': 'button',
    };
    return roleMap[tag] || null;
  }

  function getInputRole(el) {
    const type = (el.type || 'text').toLowerCase();
    const map = {
      'text': 'textbox', 'email': 'textbox', 'tel': 'textbox', 'url': 'textbox', 'search': 'searchbox',
      'password': 'textbox', 'number': 'spinbutton', 'range': 'slider',
      'checkbox': 'checkbox', 'radio': 'radio', 'button': 'button', 'submit': 'button', 'reset': 'button',
      'file': 'button',
    };
    return map[type] || 'textbox';
  }

  function getAccessibleName(el) {
    // aria-label takes priority
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.slice(0, 200);
    // aria-labelledby
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const parts = labelledBy.split(/\s+/).map(id => {
        const ref = document.getElementById(id);
        return ref ? ref.textContent.trim() : '';
      }).filter(Boolean);
      if (parts.length) return parts.join(' ').slice(0, 200);
    }
    // For inputs: associated label
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) return label.textContent.trim().slice(0, 200);
    }
    // alt text for images
    if (el.alt) return el.alt.slice(0, 200);
    // title
    if (el.title) return el.title.slice(0, 200);
    // placeholder
    if (el.placeholder) return el.placeholder.slice(0, 200);
    // Direct text for buttons/links (leaf text only)
    const tag = el.tagName.toLowerCase();
    if (['button', 'a', 'label', 'summary', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {
      const text = el.textContent.trim();
      if (text.length < 200) return text;
    }
    return null;
  }

  function getAccessibleValue(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea') {
      if (el.type === 'password') return '••••••';
      return el.value || '';
    }
    if (tag === 'select') {
      return el.options[el.selectedIndex]?.textContent || el.value || '';
    }
    if (el.getAttribute('aria-valuenow')) return el.getAttribute('aria-valuenow');
    return undefined;
  }

  // ─── Click ───

  function doClick(args) {
    const el = smartFind(args.selector || args.ref || args);
    if (!el) throw new Error('Element not found: ' + JSON.stringify(args.selector || args.ref));
    simulateClick(el, { doubleClick: args.doubleClick });
    return { clicked: true, tag: el.tagName.toLowerCase() };
  }

  // ─── Type ───

  function doType(args) {
    const el = smartFind(args.selector || args.ref || args);
    if (!el) throw new Error('Element not found: ' + JSON.stringify(args.selector || args.ref));
    simulateType(el, args.text || '', args.clear);
    if (args.submit) {
      const form = el.closest('form');
      if (form) form.dispatchEvent(new Event('submit', { bubbles: true }));
      else el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    }
    return { typed: true };
  }

  // ─── Fill (legacy compat) ───

  function doFill(args) {
    const fields = args.fields || {};
    const results = {};
    for (const [key, value] of Object.entries(fields)) {
      let el = document.querySelector(`[name="${key}"], [id="${key}"], [placeholder*="${key}" i]`);
      if (!el) el = findByLabel(key);
      if (!el) {
        // Try as CSS selector directly
        try { el = document.querySelector(key); } catch (e) {}
      }
      if (el) {
        if (el.tagName === 'SELECT') {
          el.value = value;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          simulateType(el, value, true);
        }
        results[key] = 'filled';
      } else {
        results[key] = 'not found';
      }
    }
    return { results };
  }

  // ─── Select ───

  function doSelect(args) {
    const el = smartFind(args.selector || args.ref);
    if (!el) throw new Error('Element not found');
    if (args.values) {
      // Multi-select
      for (const opt of el.options) {
        opt.selected = args.values.includes(opt.value) || args.values.includes(opt.textContent.trim());
      }
    } else {
      el.value = args.value;
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { selected: args.value || args.values };
  }

  // ─── Hover ───

  function doHover(args) {
    const el = smartFind(args.selector || args.ref);
    if (!el) throw new Error('Element not found');
    simulateHover(el);
    return { hovered: true };
  }

  // ─── Drag ───

  function doDrag(args) {
    const startEl = smartFind(args.startSelector || args.startRef);
    const endEl = smartFind(args.endSelector || args.endRef);
    if (!startEl) throw new Error('Start element not found');
    if (!endEl) throw new Error('End element not found');
    simulateDrag(startEl, endEl);
    return { dragged: true };
  }

  // ─── Smart Find Element ───

  function doFindElement(args) {
    const el = smartFind(args);
    if (!el) return { found: false };
    const ref = 'e' + (refCounter++);
    refMap.set(ref, el);
    const rect = el.getBoundingClientRect();
    return {
      found: true,
      ref,
      tag: el.tagName.toLowerCase(),
      text: el.textContent.trim().slice(0, 200),
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      visible: rect.width > 0 && rect.height > 0
    };
  }

  // ─── Form Fill (smart, by field specs) ───

  function doFormFill(args) {
    const fields = args.fields; // [{ label?, name?, placeholder?, selector?, value, type? }]
    if (!Array.isArray(fields)) throw new Error('fields must be an array');
    const results = [];
    for (const spec of fields) {
      let el = null;
      if (spec.selector) el = smartFind(spec.selector);
      if (!el && spec.label) el = findByLabel(spec.label);
      if (!el && spec.name) el = document.querySelector(`[name="${CSS.escape(spec.name)}"]`);
      if (!el && spec.placeholder) el = document.querySelector(`[placeholder*="${CSS.escape(spec.placeholder)}" i]`);
      if (!el && spec.id) el = document.getElementById(spec.id);

      if (el) {
        const tag = el.tagName.toLowerCase();
        if (tag === 'select') {
          // Find option by value or text
          for (const opt of el.options) {
            if (opt.value === spec.value || opt.textContent.trim() === spec.value) {
              opt.selected = true;
              break;
            }
          }
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (el.type === 'checkbox' || el.type === 'radio') {
          const shouldCheck = spec.value === true || spec.value === 'true' || spec.value === 'on';
          if (el.checked !== shouldCheck) simulateClick(el);
        } else {
          simulateType(el, String(spec.value), true);
        }
        results.push({ field: spec.label || spec.name || spec.placeholder || spec.selector, status: 'filled' });
      } else {
        results.push({ field: spec.label || spec.name || spec.placeholder || spec.selector, status: 'not found' });
      }
    }

    // Submit if requested
    if (args.submit) {
      const form = document.querySelector('form');
      if (form) {
        const submit = form.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
        if (submit) simulateClick(submit);
        else form.dispatchEvent(new Event('submit', { bubbles: true }));
      }
    }

    return { results, filled: results.filter(r => r.status === 'filled').length, total: results.length };
  }

  // ─── Evaluate ───

  function doEvaluate(args) {
    try {
      const result = new Function(args.code)();
      return { result: result === undefined ? null : (typeof result === 'object' ? JSON.parse(JSON.stringify(result)) : result) };
    } catch (e) {
      throw new Error('Eval error: ' + e.message);
    }
  }

  // ─── Scroll ───

  function doScroll(args) {
    // Scroll to element
    if (args.selector || args.ref) {
      const el = smartFind(args.selector || args.ref);
      if (el) {
        el.scrollIntoView({ behavior: args.smooth !== false ? 'smooth' : 'instant', block: args.block || 'center' });
        return { scrolled: 'element', tag: el.tagName.toLowerCase() };
      }
    }

    // Scroll to top/bottom
    if (args.to === 'top') { window.scrollTo({ top: 0, behavior: 'smooth' }); return { scrolled: 'top' }; }
    if (args.to === 'bottom') { window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); return { scrolled: 'bottom' }; }

    // Scroll by pixels
    const x = args.x || 0;
    const y = args.y || 500;
    window.scrollBy({ top: y, left: x, behavior: args.smooth !== false ? 'smooth' : 'instant' });

    // Infinite scroll detection
    const atBottom = (window.innerHeight + window.scrollY) >= (document.body.scrollHeight - 50);
    return {
      scrolled: 'position',
      scrollY: window.scrollY,
      scrollHeight: document.body.scrollHeight,
      viewportHeight: window.innerHeight,
      atBottom
    };
  }

  // ─── Highlight ───

  let highlightOverlays = [];

  function doHighlight(args) {
    // Clear previous highlights
    if (args.clear || args.action === 'clear') {
      highlightOverlays.forEach(o => o.remove());
      highlightOverlays = [];
      return { cleared: true };
    }

    const el = smartFind(args.selector || args.ref);
    if (!el) throw new Error('Element not found');

    const rect = el.getBoundingClientRect();
    const overlay = document.createElement('div');
    const color = args.color || '#00e5ff';
    overlay.style.cssText = `
      position: fixed; z-index: 999999; pointer-events: none;
      left: ${rect.x - 2}px; top: ${rect.y - 2}px;
      width: ${rect.width + 4}px; height: ${rect.height + 4}px;
      border: 2px solid ${color}; border-radius: 3px;
      background: ${color}22;
      box-shadow: 0 0 8px ${color}66;
      transition: opacity 0.3s;
    `;

    // Label
    if (args.label) {
      const label = document.createElement('div');
      label.textContent = args.label;
      label.style.cssText = `
        position: absolute; top: -20px; left: 0;
        background: ${color}; color: #000; font-size: 11px;
        padding: 1px 5px; border-radius: 2px; font-family: monospace;
      `;
      overlay.appendChild(label);
    }

    document.body.appendChild(overlay);
    highlightOverlays.push(overlay);

    // Auto-remove after duration
    const duration = args.duration || 5000;
    if (duration > 0) {
      setTimeout(() => {
        overlay.style.opacity = '0';
        setTimeout(() => { overlay.remove(); highlightOverlays = highlightOverlays.filter(o => o !== overlay); }, 300);
      }, duration);
    }

    return { highlighted: true, rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) } };
  }

  // ─── Wait For ───

  async function doWaitFor(args) {
    const timeout = args.timeout || 10000;
    const interval = args.interval || 200;
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (args.selector || args.ref) {
        const el = smartFind(args.selector || args.ref);
        if (el) {
          if (args.visible) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) return { found: true, elapsed: Date.now() - start };
          } else {
            return { found: true, elapsed: Date.now() - start };
          }
        }
      }
      if (args.text) {
        if (document.body.innerText.includes(args.text)) return { found: true, elapsed: Date.now() - start };
      }
      if (args.textGone) {
        if (!document.body.innerText.includes(args.textGone)) return { found: true, elapsed: Date.now() - start };
      }
      if (args.urlContains) {
        if (location.href.includes(args.urlContains)) return { found: true, elapsed: Date.now() - start };
      }
      await new Promise(r => setTimeout(r, interval));
    }
    if (args.optional) return { found: false, elapsed: Date.now() - start };
    throw new Error('Timeout waiting for: ' + (args.selector || args.text || args.textGone || args.urlContains));
  }

  // ─── Wait For Idle (network + DOM stable) ───

  async function doWaitForIdle(args) {
    const timeout = args.timeout || 15000;
    const idleThreshold = args.idleMs || 500;
    const start = Date.now();
    let lastActivity = Date.now();

    // Observe DOM mutations
    const observer = new MutationObserver(() => { lastActivity = Date.now(); });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });

    // Observe XHR/fetch
    const origXhrOpen = XMLHttpRequest.prototype.open;
    const origXhrSend = XMLHttpRequest.prototype.send;
    let pendingXhr = 0;
    XMLHttpRequest.prototype.open = function () { return origXhrOpen.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function () {
      pendingXhr++;
      lastActivity = Date.now();
      this.addEventListener('loadend', () => { pendingXhr--; lastActivity = Date.now(); });
      return origXhrSend.apply(this, arguments);
    };

    try {
      while (Date.now() - start < timeout) {
        await new Promise(r => setTimeout(r, 100));
        if (pendingXhr === 0 && Date.now() - lastActivity >= idleThreshold) {
          return { idle: true, elapsed: Date.now() - start };
        }
      }
      return { idle: false, elapsed: Date.now() - start, pending: pendingXhr };
    } finally {
      observer.disconnect();
      XMLHttpRequest.prototype.open = origXhrOpen;
      XMLHttpRequest.prototype.send = origXhrSend;
    }
  }

  // ─── Console Logs ───

  function doConsoleLogs(args) {
    if (args.clear) {
      consoleLogs.length = 0;
      return { cleared: true };
    }
    const level = args.level; // filter by level
    const limit = args.limit || 100;
    let logs = consoleLogs;
    if (level) logs = logs.filter(l => l.level === level);
    if (args.since) logs = logs.filter(l => l.timestamp > args.since);
    return { logs: logs.slice(-limit), total: consoleLogs.length };
  }

  // ─── File Upload ───

  function doFileUpload(args) {
    const el = smartFind(args.selector || args.ref || 'input[type="file"]');
    if (!el || el.type !== 'file') throw new Error('File input not found');

    // Decode base64 data to a File
    const data = atob(args.data);
    const bytes = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i);
    const file = new File([bytes], args.filename || 'file', { type: args.mimeType || 'application/octet-stream' });

    // Set files via DataTransfer
    const dt = new DataTransfer();
    dt.items.add(file);
    el.files = dt.files;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return { uploaded: true, filename: file.name, size: file.size };
  }

  // ─── Clipboard ───

  async function doClipboard(args) {
    if (args.action === 'write' || args.write) {
      await navigator.clipboard.writeText(args.text || args.write);
      return { written: true };
    }
    // Read
    try {
      const text = await navigator.clipboard.readText();
      return { text };
    } catch (e) {
      // Fallback: try execCommand
      const ta = document.createElement('textarea');
      ta.style.position = 'fixed'; ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      document.execCommand('paste');
      const text = ta.value;
      ta.remove();
      return { text, fallback: true };
    }
  }

  // ─── Links, Text, Tables ───

  function getLinks() {
    const links = [];
    document.querySelectorAll('a[href]').forEach(a => {
      links.push({ text: a.textContent.trim().slice(0, 200), href: a.href });
    });
    return { links: links.slice(0, 1000) };
  }

  function getText() {
    return { text: document.body.innerText.slice(0, 200000), title: document.title, url: location.href };
  }

  function getTables() {
    const tables = [];
    document.querySelectorAll('table').forEach(table => {
      const rows = [];
      table.querySelectorAll('tr').forEach(tr => {
        const cells = [];
        tr.querySelectorAll('td,th').forEach(td => cells.push(td.textContent.trim()));
        rows.push(cells);
      });
      tables.push(rows);
    });
    return { tables };
  }
})();
