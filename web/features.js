/**
 * Aries AI Dashboard - Enhanced Features
 * features.js - Load after app.js
 * 5 Features: Command Palette, Themes, Live Feed, Memory Timeline, PWA
 */
window.AriesFeatures = {};

(function () {
  'use strict';

  const API_BASE = '';
  const AUTH_HEADER = { 'Authorization': 'Bearer aries-api-2026', 'Content-Type': 'application/json' };

  // ========================================================================
  // STYLES
  // ========================================================================
  const style = document.createElement('style');
  style.textContent = `
/* ---- Theme Transitions ---- */
body, body * {
  transition: background-color 300ms ease, color 300ms ease, border-color 300ms ease, box-shadow 300ms ease;
}

/* ---- Theme Definitions ---- */
body[data-theme="cyberpunk"] {
  --bg-primary: #0a0a1a;
  --bg-secondary: #12122a;
  --bg-tertiary: #1a1a3e;
  --text-primary: #e0e0ff;
  --text-secondary: #8888bb;
  --text-accent: #00f0ff;
  --border: #2a2a5a;
  --glow: rgba(0,240,255,0.3);
  --accent: #00f0ff;
  --accent-secondary: #ff00aa;
  --success: #00ff88;
  --error: #ff3366;
  --warning: #ffaa00;
}
body[data-theme="matrix"] {
  --bg-primary: #000800;
  --bg-secondary: #001a00;
  --bg-tertiary: #002200;
  --text-primary: #00ff41;
  --text-secondary: #00aa2a;
  --text-accent: #00ff41;
  --border: #003300;
  --glow: rgba(0,255,65,0.3);
  --accent: #00ff41;
  --accent-secondary: #88ff88;
  --success: #00ff41;
  --error: #ff0000;
  --warning: #ffff00;
}
body[data-theme="bladerunner"] {
  --bg-primary: #0d0a07;
  --bg-secondary: #1a1208;
  --bg-tertiary: #2a1e0e;
  --text-primary: #ffcc66;
  --text-secondary: #aa8844;
  --text-accent: #ff8800;
  --border: #3a2a10;
  --glow: rgba(255,136,0,0.3);
  --accent: #ff8800;
  --accent-secondary: #ff4400;
  --success: #88cc00;
  --error: #ff2200;
  --warning: #ffaa00;
}
body[data-theme="clean"] {
  --bg-primary: #f5f5f7;
  --bg-secondary: #ffffff;
  --bg-tertiary: #e8e8ed;
  --text-primary: #1d1d1f;
  --text-secondary: #6e6e73;
  --text-accent: #0071e3;
  --border: #d2d2d7;
  --glow: rgba(0,113,227,0.15);
  --accent: #0071e3;
  --accent-secondary: #5856d6;
  --success: #34c759;
  --error: #ff3b30;
  --warning: #ff9500;
}

/* ---- Command Palette ---- */
.af-palette-backdrop {
  position: fixed; inset: 0; z-index: 99999;
  background: rgba(0,0,0,0.6); backdrop-filter: blur(4px);
  display: flex; align-items: flex-start; justify-content: center;
  padding-top: 15vh; opacity: 0;
  transition: opacity 150ms ease;
}
.af-palette-backdrop.visible { opacity: 1; }
.af-palette {
  width: 560px; max-width: 92vw; border-radius: 12px; overflow: hidden;
  background: var(--bg-secondary, #12122a);
  border: 1px solid var(--border, #2a2a5a);
  box-shadow: 0 20px 60px rgba(0,0,0,0.5), 0 0 30px var(--glow, rgba(0,240,255,0.15));
  transform: scale(0.95); transition: transform 150ms ease;
}
.af-palette-backdrop.visible .af-palette { transform: scale(1); }
.af-palette input {
  width: 100%; box-sizing: border-box; padding: 16px 20px;
  background: var(--bg-tertiary, #1a1a3e); border: none;
  border-bottom: 1px solid var(--border, #2a2a5a);
  color: var(--text-primary, #e0e0ff); font-size: 16px;
  outline: none; font-family: inherit;
}
.af-palette input::placeholder { color: var(--text-secondary, #8888bb); }
.af-palette-results { max-height: 360px; overflow-y: auto; padding: 6px 0; }
.af-palette-item {
  padding: 10px 20px; cursor: pointer; display: flex; align-items: center; gap: 12px;
  color: var(--text-primary, #e0e0ff); font-size: 14px;
}
.af-palette-item:hover, .af-palette-item.active {
  background: var(--bg-tertiary, #1a1a3e);
}
.af-palette-item .af-pi-icon { font-size: 18px; width: 24px; text-align: center; }
.af-palette-item .af-pi-label { flex: 1; }
.af-palette-item .af-pi-cat {
  font-size: 11px; color: var(--text-secondary); text-transform: uppercase;
  background: var(--bg-primary); padding: 2px 8px; border-radius: 4px;
}
.af-palette-empty {
  padding: 24px; text-align: center; color: var(--text-secondary);
}

/* ---- Theme Picker ---- */
.af-theme-btn {
  position: fixed; bottom: 20px; right: 20px; z-index: 9990;
  width: 48px; height: 48px; border-radius: 50%; border: 2px solid var(--border);
  background: var(--bg-secondary); color: var(--text-accent);
  font-size: 22px; cursor: pointer; display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 16px rgba(0,0,0,0.3);
  transition: transform 200ms ease;
}
.af-theme-btn:hover { transform: scale(1.1); }
.af-theme-menu {
  position: fixed; bottom: 76px; right: 20px; z-index: 9991;
  background: var(--bg-secondary); border: 1px solid var(--border);
  border-radius: 10px; padding: 8px; min-width: 160px;
  box-shadow: 0 8px 30px rgba(0,0,0,0.4);
  display: none;
}
.af-theme-menu.open { display: block; }
.af-theme-opt {
  padding: 10px 14px; cursor: pointer; border-radius: 6px;
  color: var(--text-primary); font-size: 13px; display: flex; align-items: center; gap: 10px;
}
.af-theme-opt:hover { background: var(--bg-tertiary); }
.af-theme-opt .swatch {
  width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--border);
}

/* ---- Live Feed ---- */
.af-feed-toggle {
  position: fixed; bottom: 20px; right: 76px; z-index: 9990;
  width: 48px; height: 48px; border-radius: 50%; border: 2px solid var(--border);
  background: var(--bg-secondary); color: var(--text-accent);
  font-size: 20px; cursor: pointer; display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 16px rgba(0,0,0,0.3);
}
.af-feed-toggle:hover { transform: scale(1.1); }
.af-feed-dot {
  position: absolute; top: 6px; right: 6px; width: 8px; height: 8px;
  border-radius: 50%; background: var(--success, #0f0);
}
.af-feed-dot.disconnected { background: var(--error, #f33); }
.af-feed-panel {
  position: fixed; bottom: 0; right: 0; z-index: 9989;
  width: 380px; max-width: 100vw; height: 50vh;
  background: var(--bg-secondary); border-top: 1px solid var(--border);
  border-left: 1px solid var(--border);
  transform: translateY(100%); transition: transform 300ms ease;
  display: flex; flex-direction: column;
}
.af-feed-panel.open { transform: translateY(0); }
.af-feed-header {
  padding: 12px 16px; border-bottom: 1px solid var(--border);
  display: flex; justify-content: space-between; align-items: center;
  color: var(--text-primary); font-weight: bold; font-size: 14px;
}
.af-feed-header button {
  background: none; border: none; color: var(--text-secondary); cursor: pointer; font-size: 18px;
}
.af-feed-list {
  flex: 1; overflow-y: auto; padding: 8px;
}
.af-feed-event {
  padding: 8px 10px; margin-bottom: 4px; border-radius: 6px;
  background: var(--bg-tertiary); font-size: 12px;
  color: var(--text-primary); display: flex; flex-direction: column; gap: 3px;
}
.af-feed-event .fe-top { display: flex; gap: 8px; align-items: center; }
.af-feed-event .fe-time { color: var(--text-secondary); font-size: 11px; min-width: 55px; }
.af-feed-event .fe-agent { color: var(--text-accent); font-weight: bold; }
.af-feed-event .fe-badge {
  padding: 1px 6px; border-radius: 3px; font-size: 10px; text-transform: uppercase;
  margin-left: auto;
}
.af-feed-event .fe-badge.running { background: var(--accent); color: #000; }
.af-feed-event .fe-badge.success { background: var(--success); color: #000; }
.af-feed-event .fe-badge.error { background: var(--error); color: #fff; }
.af-feed-event .fe-action { color: var(--text-secondary); font-size: 11px; }

/* ---- Memory Timeline ---- */
.af-timeline-overlay {
  position: fixed; inset: 0; z-index: 99998;
  background: var(--bg-primary); overflow-y: auto;
  display: none;
}
.af-timeline-overlay.open { display: block; }
.af-timeline-bar {
  position: sticky; top: 0; z-index: 2;
  padding: 16px 24px; background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
}
.af-timeline-bar h2 { margin: 0; color: var(--text-primary); font-size: 20px; }
.af-timeline-bar input[type="date"] {
  background: var(--bg-tertiary); border: 1px solid var(--border);
  color: var(--text-primary); padding: 6px 10px; border-radius: 6px; font-size: 13px;
}
.af-timeline-bar .close-btn {
  margin-left: auto; background: none; border: none; color: var(--text-secondary);
  font-size: 24px; cursor: pointer;
}
.af-timeline-container {
  max-width: 800px; margin: 40px auto; padding: 0 24px; position: relative;
}
.af-timeline-line {
  position: absolute; left: 50%; top: 0; bottom: 0; width: 2px;
  background: var(--border); transform: translateX(-50%);
}
.af-tl-entry {
  display: flex; margin-bottom: 24px; position: relative;
  animation: af-fadeIn 400ms ease both;
}
@keyframes af-fadeIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
.af-tl-entry.left { flex-direction: row; }
.af-tl-entry.right { flex-direction: row-reverse; }
.af-tl-date {
  width: 46%; text-align: right; padding: 8px 20px;
  color: var(--text-secondary); font-size: 12px; display: flex;
  align-items: flex-start; justify-content: flex-end;
}
.af-tl-entry.right .af-tl-date { text-align: left; justify-content: flex-start; }
.af-tl-dot {
  width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--bg-secondary);
  position: absolute; left: 50%; top: 12px; transform: translateX(-50%); z-index: 1;
}
.af-tl-card {
  width: 46%; padding: 14px 16px; background: var(--bg-secondary);
  border: 1px solid var(--border); border-radius: 8px; cursor: pointer;
}
.af-tl-card h4 { margin: 0 0 4px; color: var(--text-primary); font-size: 14px; }
.af-tl-card p { margin: 0; color: var(--text-secondary); font-size: 12px; }
.af-tl-card .detail { display: none; margin-top: 10px; font-size: 12px; color: var(--text-primary);
  white-space: pre-wrap; border-top: 1px solid var(--border); padding-top: 8px; }
.af-tl-card.expanded .detail { display: block; }
.cat-memory .af-tl-dot { background: #4488ff; }
.cat-decision .af-tl-dot { background: #aa44ff; }
.cat-error .af-tl-dot { background: #ff3366; }
.cat-reflection .af-tl-dot { background: #ffaa00; }
.cat-tool .af-tl-dot { background: #00cc66; }

/* ---- PWA Install ---- */
.af-pwa-banner {
  position: fixed; bottom: 76px; left: 20px; z-index: 9990;
  background: var(--bg-secondary); border: 1px solid var(--border);
  border-radius: 10px; padding: 12px 16px; display: none;
  align-items: center; gap: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.3);
  color: var(--text-primary); font-size: 13px; max-width: 300px;
}
.af-pwa-banner button {
  padding: 6px 14px; border-radius: 6px; border: none; cursor: pointer;
  font-size: 12px; font-weight: bold;
}
.af-pwa-banner .install {
  background: var(--accent); color: #000;
}
.af-pwa-banner .dismiss {
  background: var(--bg-tertiary); color: var(--text-secondary);
}

/* ---- Responsive ---- */
@media (max-width: 640px) {
  .af-palette { width: 100%; border-radius: 0; }
  .af-feed-panel { width: 100%; }
  .af-timeline-line { left: 20px; }
  .af-tl-entry { flex-direction: column !important; padding-left: 40px; }
  .af-tl-entry.right { flex-direction: column !important; }
  .af-tl-date { width: auto; text-align: left !important; justify-content: flex-start !important; padding: 0 0 4px; }
  .af-tl-card { width: auto; }
  .af-tl-dot { left: 20px; }
}
`;
  document.head.appendChild(style);

  // ========================================================================
  // FEATURE 1: Command Palette
  // ========================================================================
  (function CommandPalette() {
    let backdrop, input, resultsList, items = [], activeIdx = -1;

    function fuzzyScore(query, text) {
      query = query.toLowerCase();
      text = text.toLowerCase();
      let qi = 0, score = 0, lastPos = -1;
      for (let ti = 0; ti < text.length && qi < query.length; ti++) {
        if (text[ti] === query[qi]) {
          score += (lastPos === ti - 1) ? 15 : 10;
          if (ti === 0) score += 5;
          lastPos = ti;
          qi++;
        }
      }
      return qi === query.length ? score : 0;
    }

    function getItems() {
      const items = [
        { icon: '⚡', label: 'New Workflow', cat: 'Action', action: () => document.querySelector('[data-section="workflows"]')?.click() },
        { icon: '✋', label: 'Run Hand', cat: 'Action', action: () => document.querySelector('[data-section="hands"]')?.click() },
        { icon: '🏟️', label: 'Open Arena', cat: 'Action', action: () => document.querySelector('[data-section="arena"]')?.click() },
        { icon: '🎨', label: 'Toggle Theme', cat: 'Action', action: () => window.AriesFeatures.ThemeSystem?.toggle() },
        { icon: '📅', label: 'View Timeline', cat: 'Action', action: () => window.AriesFeatures.MemoryTimeline?.open() },
      ];
      // Gather nav sections
      document.querySelectorAll('[data-section]').forEach(el => {
        const name = el.textContent.trim() || el.getAttribute('data-section');
        items.push({ icon: '📂', label: name, cat: 'Section', action: () => el.click() });
      });
      return items;
    }

    function render(query) {
      let scored = getItems().map(it => ({ ...it, score: query ? fuzzyScore(query, it.label) : 50 }))
        .filter(it => it.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);
      items = scored;
      activeIdx = scored.length ? 0 : -1;
      resultsList.innerHTML = scored.length ? '' : '<div class="af-palette-empty">No results</div>';
      scored.forEach((it, i) => {
        const div = document.createElement('div');
        div.className = 'af-palette-item' + (i === 0 ? ' active' : '');
        div.innerHTML = `<span class="af-pi-icon">${it.icon}</span><span class="af-pi-label">${it.label}</span><span class="af-pi-cat">${it.cat}</span>`;
        div.onmouseenter = () => setActive(i);
        div.onclick = () => select(i);
        resultsList.appendChild(div);
      });
    }

    function setActive(i) {
      resultsList.querySelectorAll('.af-palette-item').forEach((el, j) => el.classList.toggle('active', j === i));
      activeIdx = i;
    }

    function select(i) {
      if (items[i]) { close(); items[i].action(); }
    }

    function open() {
      if (backdrop) { close(); return; }
      backdrop = document.createElement('div');
      backdrop.className = 'af-palette-backdrop';
      backdrop.innerHTML = `<div class="af-palette"><input placeholder="Search commands..." /><div class="af-palette-results"></div></div>`;
      document.body.appendChild(backdrop);
      requestAnimationFrame(() => backdrop.classList.add('visible'));
      input = backdrop.querySelector('input');
      resultsList = backdrop.querySelector('.af-palette-results');
      input.focus();
      render('');
      input.oninput = () => render(input.value);
      input.onkeydown = (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(activeIdx + 1, items.length - 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(activeIdx - 1, 0)); }
        else if (e.key === 'Enter') { e.preventDefault(); select(activeIdx); }
        else if (e.key === 'Escape') { close(); }
      };
      backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    }

    function close() {
      if (!backdrop) return;
      backdrop.classList.remove('visible');
      setTimeout(() => { backdrop?.remove(); backdrop = null; }, 160);
    }

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); open(); }
    });

    window.AriesFeatures.CommandPalette = { open, close };
  })();

  // ========================================================================
  // FEATURE 2: Theme System
  // ========================================================================
  (function ThemeSystem() {
    const themes = [
      { id: 'cyberpunk', name: 'Cyberpunk', swatch: '#00f0ff' },
      { id: 'matrix', name: 'Matrix', swatch: '#00ff41' },
      { id: 'bladerunner', name: 'Blade Runner', swatch: '#ff8800' },
      { id: 'clean', name: 'Clean', swatch: '#0071e3' },
    ];
    let menuOpen = false;

    function apply(id) {
      document.body.setAttribute('data-theme', id);
      localStorage.setItem('af-theme', id);
      // Update PWA theme-color
      const meta = document.querySelector('meta[name="theme-color"]');
      const t = themes.find(t => t.id === id);
      if (meta && t) meta.setAttribute('content', t.swatch);
    }

    function toggle() {
      const cur = localStorage.getItem('af-theme') || 'cyberpunk';
      const idx = themes.findIndex(t => t.id === cur);
      apply(themes[(idx + 1) % themes.length].id);
    }

    // Button
    const btn = document.createElement('button');
    btn.className = 'af-theme-btn';
    btn.innerHTML = '🎨';
    btn.title = 'Theme';
    document.body.appendChild(btn);

    // Menu
    const menu = document.createElement('div');
    menu.className = 'af-theme-menu';
    themes.forEach(t => {
      const opt = document.createElement('div');
      opt.className = 'af-theme-opt';
      opt.innerHTML = `<span class="swatch" style="background:${t.swatch}"></span>${t.name}`;
      opt.onclick = () => { apply(t.id); menu.classList.remove('open'); menuOpen = false; };
      menu.appendChild(opt);
    });
    document.body.appendChild(menu);

    btn.onclick = () => { menuOpen = !menuOpen; menu.classList.toggle('open', menuOpen); };
    document.addEventListener('click', (e) => {
      if (menuOpen && !menu.contains(e.target) && e.target !== btn) {
        menu.classList.remove('open'); menuOpen = false;
      }
    });

    // Init
    apply(localStorage.getItem('af-theme') || 'cyberpunk');

    window.AriesFeatures.ThemeSystem = { apply, toggle };
  })();

  // ========================================================================
  // FEATURE 3: Live Agent Feed
  // ========================================================================
  (function LiveFeed() {
    let ws, retries = 0, maxRetries = 10, pollTimer = null, panelOpen = false;
    const MAX_EVENTS = 200;

    // Toggle button
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'af-feed-toggle';
    toggleBtn.innerHTML = '📡<span class="af-feed-dot"></span>';
    document.body.appendChild(toggleBtn);

    // Panel
    const panel = document.createElement('div');
    panel.className = 'af-feed-panel';
    panel.innerHTML = `
      <div class="af-feed-header"><span>Live Feed</span><button class="close-feed">✕</button></div>
      <div class="af-feed-list"></div>`;
    document.body.appendChild(panel);

    const feedList = panel.querySelector('.af-feed-list');
    const dot = toggleBtn.querySelector('.af-feed-dot');

    toggleBtn.onclick = () => { panelOpen = !panelOpen; panel.classList.toggle('open', panelOpen); };
    panel.querySelector('.close-feed').onclick = () => { panelOpen = false; panel.classList.remove('open'); };

    function addEvent(evt) {
      const div = document.createElement('div');
      div.className = 'af-feed-event';
      const time = new Date(evt.timestamp || Date.now()).toLocaleTimeString();
      const status = evt.status || 'running';
      div.innerHTML = `
        <div class="fe-top">
          <span class="fe-time">${time}</span>
          <span class="fe-agent">${evt.agent || 'aries'}</span>
          <span class="fe-badge ${status}">${status}</span>
        </div>
        <div class="fe-action">${evt.action || evt.type || evt.message || 'event'}</div>`;
      feedList.appendChild(div);
      while (feedList.children.length > MAX_EVENTS) feedList.removeChild(feedList.firstChild);
      feedList.scrollTop = feedList.scrollHeight;
    }

    function connectWS() {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${proto}//${location.host}/ws`;
      try {
        ws = new WebSocket(url);
        ws.onopen = () => { retries = 0; dot.classList.remove('disconnected'); if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } };
        ws.onmessage = (e) => { try { addEvent(JSON.parse(e.data)); } catch { addEvent({ action: e.data }); } };
        ws.onclose = () => { dot.classList.add('disconnected'); retry(); };
        ws.onerror = () => { ws.close(); };
      } catch { startPolling(); }
    }

    function retry() {
      if (retries++ < maxRetries) setTimeout(connectWS, 3000);
      else startPolling();
    }

    function startPolling() {
      if (pollTimer) return;
      pollTimer = setInterval(async () => {
        try {
          const r = await fetch(`${API_BASE}/api/activity`, { headers: AUTH_HEADER });
          if (r.ok) {
            const data = await r.json();
            (Array.isArray(data) ? data : data.events || []).forEach(addEvent);
          }
        } catch {}
      }, 5000);
    }

    connectWS();
    window.AriesFeatures.LiveFeed = { addEvent };
  })();

  // ========================================================================
  // FEATURE 4: Memory Timeline
  // ========================================================================
  (function MemoryTimeline() {
    let overlay;

    function categorize(item) {
      const t = (item.type || item.category || item.action || '').toLowerCase();
      if (t.includes('error') || t.includes('fail')) return 'error';
      if (t.includes('decision') || t.includes('decide')) return 'decision';
      if (t.includes('reflect') || t.includes('thought')) return 'reflection';
      if (t.includes('tool') || t.includes('call')) return 'tool';
      return 'memory';
    }

    async function fetchData() {
      const fetcher = (url) => fetch(url, { headers: AUTH_HEADER }).then(r => r.ok ? r.json() : []).catch(() => []);
      const [memories, audit, analytics] = await Promise.all([
        fetcher(`${API_BASE}/api/memory/db/search?q=*&limit=50`),
        fetcher(`${API_BASE}/api/audit/verify`),
        fetcher(`${API_BASE}/api/analytics/report`),
      ]);
      const items = [];
      const push = (arr, fallbackCat) => {
        (Array.isArray(arr) ? arr : arr?.results || arr?.entries || arr?.data || []).forEach(it => {
          items.push({
            date: it.timestamp || it.date || it.created_at || new Date().toISOString(),
            title: it.title || it.action || it.type || it.key || fallbackCat,
            summary: it.summary || it.message || it.content || it.description || JSON.stringify(it).slice(0, 120),
            detail: typeof it === 'object' ? JSON.stringify(it, null, 2) : String(it),
            category: categorize(it),
          });
        });
      };
      push(memories, 'Memory');
      push(audit, 'Audit');
      push(analytics, 'Analytics');
      items.sort((a, b) => new Date(b.date) - new Date(a.date));
      return items;
    }

    async function open() {
      if (overlay) { overlay.classList.add('open'); return; }
      overlay = document.createElement('div');
      overlay.className = 'af-timeline-overlay open';
      overlay.innerHTML = `
        <div class="af-timeline-bar">
          <h2>📅 Memory Timeline</h2>
          <label>From <input type="date" class="date-from"></label>
          <label>To <input type="date" class="date-to"></label>
          <button class="close-btn">✕</button>
        </div>
        <div class="af-timeline-container"><div class="af-timeline-line"></div><div class="af-tl-items"></div></div>`;
      document.body.appendChild(overlay);

      overlay.querySelector('.close-btn').onclick = close;
      const itemsEl = overlay.querySelector('.af-tl-items');
      const dateFrom = overlay.querySelector('.date-from');
      const dateTo = overlay.querySelector('.date-to');

      let allItems = await fetchData();

      function renderItems(items) {
        itemsEl.innerHTML = '';
        items.forEach((it, i) => {
          const side = i % 2 === 0 ? 'left' : 'right';
          const d = new Date(it.date);
          const dateStr = isNaN(d) ? it.date : d.toLocaleString();
          const entry = document.createElement('div');
          entry.className = `af-tl-entry ${side} cat-${it.category}`;
          entry.style.animationDelay = `${i * 50}ms`;
          entry.innerHTML = `
            <div class="af-tl-date">${dateStr}</div>
            <div class="af-tl-dot"></div>
            <div class="af-tl-card">
              <h4>${it.title}</h4>
              <p>${it.summary}</p>
              <div class="detail">${it.detail}</div>
            </div>`;
          entry.querySelector('.af-tl-card').onclick = function () { this.classList.toggle('expanded'); };
          itemsEl.appendChild(entry);
        });
        if (!items.length) itemsEl.innerHTML = '<p style="text-align:center;color:var(--text-secondary);padding:40px">No timeline entries found</p>';
      }

      function filter() {
        const from = dateFrom.value ? new Date(dateFrom.value) : null;
        const to = dateTo.value ? new Date(dateTo.value + 'T23:59:59') : null;
        renderItems(allItems.filter(it => {
          const d = new Date(it.date);
          if (from && d < from) return false;
          if (to && d > to) return false;
          return true;
        }));
      }

      dateFrom.onchange = filter;
      dateTo.onchange = filter;
      renderItems(allItems);
    }

    function close() { if (overlay) overlay.classList.remove('open'); }

    window.AriesFeatures.MemoryTimeline = { open, close };
  })();

  // ========================================================================
  // FEATURE 5: PWA Support
  // ========================================================================
  (function PWASupport() {
    // Meta tags
    const metas = [
      { name: 'theme-color', content: '#00f0ff' },
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
    ];
    if (!document.querySelector('meta[name="viewport"]')) {
      const m = document.createElement('meta');
      m.name = 'viewport'; m.content = 'width=device-width, initial-scale=1';
      document.head.appendChild(m);
    }
    metas.forEach(({ name, content }) => {
      if (!document.querySelector(`meta[name="${name}"]`)) {
        const m = document.createElement('meta');
        m.name = name; m.content = content;
        document.head.appendChild(m);
      }
    });

    // SVG icon as data URL
    const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="80" fill="#0a0a1a"/><text x="256" y="340" text-anchor="middle" font-size="280" font-family="monospace" fill="#00f0ff">A</text></svg>`;
    const iconDataUrl = 'data:image/svg+xml;base64,' + btoa(iconSvg);

    // Manifest
    const manifest = {
      name: 'Aries AI',
      short_name: 'Aries',
      start_url: '/',
      display: 'standalone',
      background_color: '#0a0a1a',
      theme_color: '#00f0ff',
      icons: [{ src: iconDataUrl, sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' }]
    };
    const blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = URL.createObjectURL(blob);
    document.head.appendChild(link);

    // Apple touch icon
    const appleIcon = document.createElement('link');
    appleIcon.rel = 'apple-touch-icon';
    appleIcon.href = iconDataUrl;
    document.head.appendChild(appleIcon);

    // Service Worker
    const swCode = `
const CACHE_NAME = 'aries-v1';
const SHELL = ['/', '/index.html', '/app.js', '/features.js'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => {
    if (res.ok && res.type === 'basic') { const c = res.clone(); caches.open(CACHE_NAME).then(cache => cache.put(e.request, c)); }
    return res;
  }).catch(() => caches.match('/'))));
});`;

    if ('serviceWorker' in navigator) {
      const swBlob = new Blob([swCode], { type: 'application/javascript' });
      const swUrl = URL.createObjectURL(swBlob);
      navigator.serviceWorker.register(swUrl).catch(() => {});
    }

    // Install prompt
    let deferredPrompt = null;
    const banner = document.createElement('div');
    banner.className = 'af-pwa-banner';
    banner.innerHTML = `<span>📱 Install Aries AI as an app</span><button class="install">Install</button><button class="dismiss">✕</button>`;
    document.body.appendChild(banner);

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      banner.style.display = 'flex';
    });

    banner.querySelector('.install').onclick = () => {
      if (deferredPrompt) { deferredPrompt.prompt(); deferredPrompt.userChoice.then(() => { deferredPrompt = null; banner.style.display = 'none'; }); }
    };
    banner.querySelector('.dismiss').onclick = () => { banner.style.display = 'none'; };

    window.AriesFeatures.PWA = {};
  })();

  console.log('[AriesFeatures] All features loaded:', Object.keys(window.AriesFeatures));
})();
