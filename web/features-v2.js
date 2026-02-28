/**
 * Aries AI Dashboard — Features v2
 * 1. Usage Dashboard  2. Changelog Feed  3. Mobile PWA  4. Voice Assistant
 * Pure vanilla JS, no dependencies. Loads after app.js
 */
(function() {
  'use strict';

  var AUTH = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (localStorage.getItem('aries-auth-token') || '') };
  function api(method, path, body) {
    var opts = { method: method, headers: AUTH };
    if (body) opts.body = JSON.stringify(body);
    return fetch('/api/' + path, opts).then(function(r) { return r.json(); });
  }

  // ========================================================================
  // STYLES for all 4 features
  // ========================================================================
  var css = document.createElement('style');
  css.textContent = [
    '/* ── Usage Dashboard ── */',
    '.usage-bar { height: 20px; border-radius: 4px; background: var(--bg-input, #0c0c1e); overflow: hidden; margin: 4px 0; }',
    '.usage-bar-fill { height: 100%; border-radius: 4px; transition: width 0.5s ease; }',
    '.usage-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; margin-bottom: 16px; }',
    '.usage-card { background: var(--bg-card, #0a0a1a); border: 1px solid var(--border); border-radius: 8px; padding: 14px; text-align: center; }',
    '.usage-card .uc-val { font-size: 22px; font-weight: 800; color: var(--accent); margin: 4px 0; }',
    '.usage-card .uc-label { font-size: 11px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 1px; }',
    '.usage-chart-row { display: flex; align-items: center; gap: 8px; margin: 4px 0; font-size: 12px; }',
    '.usage-chart-label { width: 120px; color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.usage-chart-bar { flex: 1; height: 14px; border-radius: 3px; background: var(--bg-input); overflow: hidden; }',
    '.usage-chart-fill { height: 100%; border-radius: 3px; background: linear-gradient(90deg, var(--accent), var(--accent2, #bf00ff)); transition: width 0.4s; }',
    '.usage-chart-val { width: 60px; text-align: right; color: var(--text); font-weight: 600; font-variant-numeric: tabular-nums; }',
    '',
    '/* ── Changelog ── */',
    '.cl-badge { position: absolute; top: -4px; right: -4px; min-width: 16px; height: 16px; border-radius: 8px; background: var(--red, #f44); color: #fff; font-size: 9px; font-weight: 700; display: flex; align-items: center; justify-content: center; padding: 0 4px; }',
    '.cl-entry { background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 14px; margin-bottom: 10px; }',
    '.cl-entry.unread { border-left: 3px solid var(--accent); }',
    '.cl-version { font-size: 16px; font-weight: 700; color: var(--accent); }',
    '.cl-date { font-size: 11px; color: var(--text-dim); margin-left: 8px; }',
    '.cl-change { padding: 3px 0; font-size: 13px; color: var(--text); }',
    '.cl-type { display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; text-transform: uppercase; margin-right: 6px; }',
    '.cl-type-feature { background: rgba(0,255,136,0.15); color: #00ff88; }',
    '.cl-type-fix { background: rgba(255,68,68,0.15); color: #f44; }',
    '.cl-type-improvement { background: rgba(0,229,255,0.15); color: var(--accent); }',
    '',
    '/* ── Mobile Bottom Nav ── */',
    '.mobile-bottom-nav { display: none; position: fixed; bottom: 0; left: 0; right: 0; z-index: 600; background: var(--bg-sidebar, #0f0f2a); border-top: 1px solid var(--border); padding: 4px 0 env(safe-area-inset-bottom, 0); }',
    '.mobile-bottom-nav-inner { display: flex; justify-content: space-around; align-items: center; }',
    '.mbn-item { display: flex; flex-direction: column; align-items: center; padding: 6px 0; cursor: pointer; color: var(--text-dim); font-size: 10px; min-width: 60px; transition: color 0.2s; -webkit-tap-highlight-color: transparent; }',
    '.mbn-item.active { color: var(--accent); }',
    '.mbn-item span:first-child { font-size: 20px; margin-bottom: 2px; }',
    '@media (max-width: 768px) {',
    '  .mobile-bottom-nav { display: block; }',
    '  #content { padding-bottom: 64px !important; }',
    '  .panel { padding-bottom: 70px !important; }',
    '  #sidebar { display: none !important; }',
    '  #sidebar.open { display: flex !important; }',
    '  .hamburger-btn { display: flex !important; }',
    '}',
    '.hamburger-btn { display: none; background: none; border: none; color: var(--accent); font-size: 24px; cursor: pointer; padding: 4px 8px; -webkit-tap-highlight-color: transparent; }',
    '',
    '/* ── Voice Assistant ── */',
    '.voice-fab { position: fixed; bottom: 80px; right: 20px; z-index: 700; width: 56px; height: 56px; border-radius: 50%; border: 2px solid var(--border); background: var(--bg-card); color: var(--accent); font-size: 24px; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 16px rgba(0,0,0,0.3); transition: all 0.3s; }',
    '.voice-fab:hover { transform: scale(1.1); box-shadow: 0 0 20px var(--accent-glow, rgba(0,229,255,0.3)); }',
    '.voice-fab.listening { border-color: var(--accent); animation: voicePulse 1.5s ease-in-out infinite; }',
    '.voice-fab.processing { border-color: var(--yellow, #ffaa00); animation: voiceSpin 1s linear infinite; }',
    '.voice-fab.speaking { border-color: var(--green, #00ff88); animation: voicePulse 0.8s ease-in-out infinite; }',
    '@keyframes voicePulse { 0%,100% { box-shadow: 0 0 8px var(--accent-glow); } 50% { box-shadow: 0 0 24px var(--accent-glow), 0 0 48px var(--accent-glow); } }',
    '@keyframes voiceSpin { to { transform: rotate(360deg); } }',
    '.voice-status { position: fixed; bottom: 142px; right: 20px; z-index: 700; background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 6px 12px; font-size: 11px; color: var(--text-dim); display: none; white-space: nowrap; }',
    '@media (max-width: 768px) { .voice-fab { bottom: 76px; right: 12px; width: 48px; height: 48px; font-size: 20px; } .voice-status { bottom: 130px; right: 12px; } }',
  ].join('\n');
  document.head.appendChild(css);

  // ========================================================================
  // 1. USAGE DASHBOARD
  // ========================================================================
  function loadUsageDashboard(container) {
    container.innerHTML = '<div class="spinner"></div> Loading usage data...';
    var period = 'month';

    function render() {
      api('GET', 'usage/stats?period=' + period).then(function(d) {
        var html = '';
        // Period selector
        html += '<div style="display:flex;gap:8px;margin-bottom:16px;align-items:center">';
        html += '<span style="color:var(--text-dim);font-size:13px">Period:</span>';
        ['day', 'week', 'month'].forEach(function(p) {
          var active = p === period ? 'background:var(--accent-dim,rgba(0,229,255,0.15));color:var(--accent);border-color:var(--accent)' : '';
          html += '<button class="btn-sm" style="' + active + '" onclick="window._usagePeriod=\'' + p + '\';window._renderUsage()">' + p.charAt(0).toUpperCase() + p.slice(1) + '</button>';
        });
        html += '</div>';

        // Stat cards
        html += '<div class="usage-grid">';
        html += '<div class="usage-card"><div class="uc-val">$' + (d.totalCost || 0).toFixed(4) + '</div><div class="uc-label">Total Cost</div></div>';
        html += '<div class="usage-card"><div class="uc-val">' + ((d.totalIn || 0) + (d.totalOut || 0)).toLocaleString() + '</div><div class="uc-label">Total Tokens</div></div>';
        html += '<div class="usage-card"><div class="uc-val">' + (d.requests || 0) + '</div><div class="uc-label">Requests</div></div>';
        var budgetPct = d.budget && d.budget.monthly_limit > 0 ? Math.min(100, (d.monthTotal / d.budget.monthly_limit) * 100) : 0;
        var budgetColor = budgetPct >= 100 ? 'var(--red)' : budgetPct >= 80 ? 'var(--yellow)' : 'var(--green)';
        html += '<div class="usage-card"><div class="uc-val" style="color:' + budgetColor + '">$' + (d.monthTotal || 0).toFixed(4) + '</div><div class="uc-label">Monthly (' + (d.budget && d.budget.monthly_limit > 0 ? '$' + d.budget.monthly_limit + ' limit' : 'no limit') + ')</div></div>';
        html += '</div>';

        // Budget bar
        if (d.budget && d.budget.monthly_limit > 0) {
          html += '<div style="margin-bottom:16px"><div style="font-size:12px;color:var(--text-dim);margin-bottom:4px">Budget: $' + (d.monthTotal || 0).toFixed(4) + ' / $' + d.budget.monthly_limit + ' (' + budgetPct.toFixed(0) + '%)</div>';
          html += '<div class="usage-bar"><div class="usage-bar-fill" style="width:' + budgetPct + '%;background:' + budgetColor + '"></div></div></div>';
        }

        // Cost by Model chart
        var models = Object.keys(d.byModel || {});
        var maxModelCost = Math.max.apply(null, models.map(function(m) { return d.byModel[m]; }).concat([0.0001]));
        html += '<h4 style="color:var(--accent);margin:0 0 8px;font-size:13px">Cost by Model</h4>';
        models.sort(function(a, b) { return d.byModel[b] - d.byModel[a]; }).forEach(function(m) {
          var pct = (d.byModel[m] / maxModelCost * 100).toFixed(0);
          html += '<div class="usage-chart-row"><div class="usage-chart-label">' + m.replace(/^(anthropic|openai)\//, '') + '</div><div class="usage-chart-bar"><div class="usage-chart-fill" style="width:' + pct + '%"></div></div><div class="usage-chart-val">$' + d.byModel[m].toFixed(4) + '</div></div>';
        });
        if (models.length === 0) html += '<div style="color:var(--text-dim);font-size:12px">No usage data yet</div>';

        // Cost by Agent chart
        var agents = Object.keys(d.byAgent || {});
        var maxAgentCost = Math.max.apply(null, agents.map(function(a) { return d.byAgent[a]; }).concat([0.0001]));
        html += '<h4 style="color:var(--accent);margin:16px 0 8px;font-size:13px">Cost by Agent</h4>';
        agents.sort(function(a, b) { return d.byAgent[b] - d.byAgent[a]; }).forEach(function(a) {
          var pct = (d.byAgent[a] / maxAgentCost * 100).toFixed(0);
          html += '<div class="usage-chart-row"><div class="usage-chart-label">' + a + '</div><div class="usage-chart-bar"><div class="usage-chart-fill" style="width:' + pct + '%;background:linear-gradient(90deg,var(--green,#0f8),var(--accent))"></div></div><div class="usage-chart-val">$' + d.byAgent[a].toFixed(4) + '</div></div>';
        });

        // Budget setting
        html += '<h4 style="color:var(--accent);margin:20px 0 8px;font-size:13px">Monthly Budget Limit</h4>';
        html += '<div style="display:flex;gap:8px;align-items:center"><span style="color:var(--text-dim);font-size:14px">$</span><input id="usageBudgetInput" type="number" step="0.1" min="0" value="' + ((d.budget && d.budget.monthly_limit) || '') + '" placeholder="0 = no limit" class="input-field" style="width:120px" />';
        html += '<button class="btn-primary" onclick="window._saveUsageBudget()">Set Limit</button>';
        html += '<span style="font-size:11px;color:var(--text-dim)">Warn at 80%, stop at 100%</span></div>';

        container.innerHTML = html;
      }).catch(function() { container.innerHTML = '<p style="color:var(--red)">Failed to load usage data</p>'; });
    }

    window._usagePeriod = period;
    window._renderUsage = function() { period = window._usagePeriod || 'month'; render(); };
    window._saveUsageBudget = function() {
      var v = parseFloat(document.getElementById('usageBudgetInput').value) || 0;
      api('POST', 'usage/budget', { monthly_limit: v }).then(function() {
        if (window.aries && window.aries._toast) window.aries._toast('Budget set to $' + v, 'success');
        render();
      });
    };
    render();
  }

  // ========================================================================
  // 2. CHANGELOG FEED
  // ========================================================================
  var _changelogRead = JSON.parse(localStorage.getItem('aries-changelog-read') || '[]');

  function getUnreadCount(changelog) {
    var count = 0;
    (changelog || []).forEach(function(entry) {
      if (_changelogRead.indexOf(entry.version) === -1) count += entry.changes.length;
    });
    return count;
  }

  function markRead(version) {
    if (_changelogRead.indexOf(version) === -1) {
      _changelogRead.push(version);
      localStorage.setItem('aries-changelog-read', JSON.stringify(_changelogRead));
    }
    updateChangelogBadge();
  }

  function updateChangelogBadge() {
    var badge = document.getElementById('changelogBadge');
    if (!badge) return;
    api('GET', 'changelog').then(function(d) {
      var count = getUnreadCount(d.changelog);
      badge.textContent = count;
      badge.style.display = count > 0 ? 'flex' : 'none';
    }).catch(function() {});
  }

  function showChangelog() {
    var modal = document.getElementById('changelogModal');
    if (!modal) return;
    modal.style.display = 'flex';
    var content = document.getElementById('changelogContent');
    content.innerHTML = '<div class="spinner"></div>';
    api('GET', 'changelog').then(function(d) {
      var html = '';
      (d.changelog || []).forEach(function(entry) {
        var isUnread = _changelogRead.indexOf(entry.version) === -1;
        html += '<div class="cl-entry' + (isUnread ? ' unread' : '') + '">';
        html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">';
        html += '<div><span class="cl-version">v' + entry.version + '</span><span class="cl-date">' + entry.date + '</span></div>';
        if (isUnread) html += '<button class="btn-sm" onclick="window._markClRead(\'' + entry.version + '\',this)" style="font-size:10px">Mark Read</button>';
        html += '</div>';
        (entry.changes || []).forEach(function(c) {
          var cls = 'cl-type-' + c.type;
          html += '<div class="cl-change"><span class="cl-type ' + cls + '">' + c.type + '</span>' + c.text + '</div>';
        });
        html += '</div>';
      });
      if (!d.changelog || d.changelog.length === 0) html = '<p style="color:var(--text-dim);text-align:center;padding:20px">No changelog entries</p>';
      content.innerHTML = html;
    });
  }

  window._markClRead = function(version, btn) {
    markRead(version);
    if (btn) {
      var entry = btn.closest('.cl-entry');
      if (entry) entry.classList.remove('unread');
      btn.remove();
    }
  };

  // ========================================================================
  // 3. MOBILE PWA ENHANCEMENT
  // ========================================================================
  function initMobilePWA() {
    // Bottom navigation bar
    var nav = document.createElement('div');
    nav.className = 'mobile-bottom-nav';
    nav.innerHTML = '<div class="mobile-bottom-nav-inner">' +
      '<div class="mbn-item active" data-panel="chat" onclick="window._mbnSwitch(\'chat\',this)"><span>💬</span>Chat</div>' +
      '<div class="mbn-item" data-panel="subagents" onclick="window._mbnSwitch(\'subagents\',this)"><span>🤖</span>Agents</div>' +
      '<div class="mbn-item" data-panel="workflows" onclick="window._mbnSwitch(\'workflows\',this)"><span>⚡</span>Flows</div>' +
      '<div class="mbn-item" data-panel="settings" onclick="window._mbnSwitch(\'settings\',this)"><span>⚙️</span>Settings</div>' +
      '<div class="mbn-item" onclick="window._mbnToggleSidebar()"><span>☰</span>More</div>' +
      '</div>';
    document.body.appendChild(nav);

    window._mbnSwitch = function(panel, el) {
      if (window.aries && window.aries.switchPanel) window.aries.switchPanel(panel);
      document.querySelectorAll('.mbn-item').forEach(function(i) { i.classList.remove('active'); });
      if (el) el.classList.add('active');
      var sb = document.getElementById('sidebar');
      if (sb) sb.classList.remove('open');
    };
    window._mbnToggleSidebar = function() {
      var sb = document.getElementById('sidebar');
      if (sb) sb.classList.toggle('open');
    };

    // Hamburger button in topbar
    var topLeft = document.querySelector('.topbar-left');
    if (topLeft) {
      var ham = document.createElement('button');
      ham.className = 'hamburger-btn';
      ham.innerHTML = '☰';
      ham.onclick = function() { window._mbnToggleSidebar(); };
      topLeft.insertBefore(ham, topLeft.firstChild);
    }

    // Swipe gesture for panel navigation
    var touchStartX = 0, touchStartY = 0;
    var content = document.getElementById('content');
    if (content) {
      content.addEventListener('touchstart', function(e) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
      }, { passive: true });
      content.addEventListener('touchend', function(e) {
        var dx = e.changedTouches[0].clientX - touchStartX;
        var dy = e.changedTouches[0].clientY - touchStartY;
        if (Math.abs(dx) < 80 || Math.abs(dy) > Math.abs(dx)) return;
        var panels = ['chat', 'subagents', 'workflows', 'settings'];
        var cur = window.aries && window.aries._currentPanel ? window.aries._currentPanel : 'chat';
        // Find current panel in the mobile tabs
        var idx = -1;
        for (var i = 0; i < panels.length; i++) { if (panels[i] === cur) { idx = i; break; } }
        if (idx === -1) return;
        var next = dx < 0 ? Math.min(idx + 1, panels.length - 1) : Math.max(idx - 1, 0);
        if (next !== idx) {
          window._mbnSwitch(panels[next], document.querySelector('.mbn-item[data-panel="' + panels[next] + '"]'));
        }
      }, { passive: true });
    }

    // Enhanced manifest
    var manifest = document.querySelector('link[rel="manifest"]');
    if (manifest) {
      try {
        var m = {
          name: 'ARIES \u2014 AI Command Center',
          short_name: 'ARIES',
          description: 'Personal AI Command Center',
          start_url: '/',
          display: 'standalone',
          background_color: '#0a0a1a',
          theme_color: '#00fff7',
          orientation: 'any',
          icons: [
            { src: '/api/icon/192', sizes: '192x192', type: 'image/png' },
            { src: '/api/icon/512', sizes: '512x512', type: 'image/png' }
          ],
          categories: ['productivity', 'utilities']
        };
        var blob = new Blob([JSON.stringify(m)], { type: 'application/json' });
        manifest.href = URL.createObjectURL(blob);
      } catch(e) {}
    }

    // PWA install prompt
    var installPrompt = null;
    window.addEventListener('beforeinstallprompt', function(e) {
      e.preventDefault();
      installPrompt = e;
      showInstallBanner();
    });

    function showInstallBanner() {
      if (localStorage.getItem('aries-pwa-dismissed')) return;
      var banner = document.createElement('div');
      banner.style.cssText = 'position:fixed;bottom:70px;left:12px;right:12px;z-index:800;background:var(--bg-card);border:1px solid var(--accent);border-radius:10px;padding:12px 16px;display:flex;align-items:center;gap:12px;box-shadow:0 4px 20px rgba(0,0,0,0.4);font-size:13px;color:var(--text)';
      banner.innerHTML = '📱 Install ARIES as an app <button style="margin-left:auto;padding:6px 14px;border:none;border-radius:6px;background:var(--accent);color:#000;font-weight:700;cursor:pointer" id="pwaInstallBtn">Install</button><button style="padding:6px 10px;border:none;border-radius:6px;background:var(--bg-input);color:var(--text-dim);cursor:pointer" id="pwaDismissBtn">\u2715</button>';
      document.body.appendChild(banner);
      document.getElementById('pwaInstallBtn').onclick = function() {
        if (installPrompt) { installPrompt.prompt(); installPrompt = null; }
        banner.remove();
      };
      document.getElementById('pwaDismissBtn').onclick = function() {
        localStorage.setItem('aries-pwa-dismissed', '1');
        banner.remove();
      };
    }

    // Push notification setup in existing service worker
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      navigator.serviceWorker.ready.then(function(reg) {
        // Push subscription available for future use
      }).catch(function() {});
    }
  }

  // ========================================================================
  // 4. VOICE ASSISTANT MODE (Always-Listening)
  // ========================================================================
  function initVoiceAssistant() {
    var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return; // Browser doesn't support it

    var state = 'idle'; // idle, listening, processing, speaking
    var wakeEnabled = localStorage.getItem('aries-voice-wake') !== 'false';
    var recognition = null;
    var commandRecognition = null;

    // Create floating mic button
    var fab = document.createElement('button');
    fab.className = 'voice-fab';
    fab.innerHTML = '🎤';
    fab.title = 'Voice Assistant (Hey Aries)';
    document.body.appendChild(fab);

    var statusEl = document.createElement('div');
    statusEl.className = 'voice-status';
    document.body.appendChild(statusEl);

    function setState(s) {
      state = s;
      fab.className = 'voice-fab' + (s !== 'idle' ? ' ' + s : '');
      fab.innerHTML = s === 'processing' ? '⏳' : s === 'speaking' ? '🔊' : '🎤';
      statusEl.style.display = s !== 'idle' ? 'block' : 'none';
      var labels = { idle: '', listening: '🎙 Listening...', processing: '⚡ Processing...', speaking: '🔊 Speaking...' };
      statusEl.textContent = labels[s] || '';
    }

    function startWakeWordListener() {
      if (!wakeEnabled || recognition) return;
      try {
        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';
        recognition.onresult = function(e) {
          for (var i = e.resultIndex; i < e.results.length; i++) {
            var transcript = e.results[i][0].transcript.toLowerCase().trim();
            if (transcript.indexOf('hey aries') !== -1 || transcript.indexOf('hey iris') !== -1 || transcript.indexOf('hey areas') !== -1) {
              stopWakeWordListener();
              startCommandCapture();
              return;
            }
          }
        };
        recognition.onerror = function(e) {
          if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
            wakeEnabled = false;
            localStorage.setItem('aries-voice-wake', 'false');
            return;
          }
          // Restart on other errors
          setTimeout(function() { stopWakeWordListener(); if (wakeEnabled) startWakeWordListener(); }, 2000);
        };
        recognition.onend = function() {
          recognition = null;
          if (wakeEnabled && state === 'idle') setTimeout(startWakeWordListener, 1000);
        };
        recognition.start();
      } catch(e) {}
    }

    function stopWakeWordListener() {
      if (recognition) { try { recognition.stop(); } catch(e) {} recognition = null; }
    }

    function startCommandCapture() {
      setState('listening');
      try {
        commandRecognition = new SpeechRecognition();
        commandRecognition.continuous = false;
        commandRecognition.interimResults = false;
        commandRecognition.lang = 'en-US';
        commandRecognition.onresult = function(e) {
          var transcript = e.results[0][0].transcript.trim();
          if (transcript) processVoiceCommand(transcript);
          else { setState('idle'); startWakeWordListener(); }
        };
        commandRecognition.onerror = function() { setState('idle'); startWakeWordListener(); };
        commandRecognition.onend = function() { commandRecognition = null; if (state === 'listening') { setState('idle'); startWakeWordListener(); } };
        commandRecognition.start();
      } catch(e) { setState('idle'); startWakeWordListener(); }
    }

    function processVoiceCommand(text) {
      setState('processing');
      // Show in chat
      if (window.aries && window.aries.switchPanel) window.aries.switchPanel('chat');
      var chatInput = document.getElementById('chatInput');
      if (chatInput) { chatInput.value = text; }

      // Send to chat API
      fetch('/api/chat', {
        method: 'POST',
        headers: AUTH,
        body: JSON.stringify({ message: text })
      }).then(function(r) { return r.json(); }).then(function(d) {
        var response = d.response || '';
        // Speak response using TTS
        if (response && 'speechSynthesis' in window) {
          setState('speaking');
          var utter = new SpeechSynthesisUtterance(response.substring(0, 500));
          utter.rate = 1.0;
          utter.onend = function() { setState('idle'); startWakeWordListener(); };
          utter.onerror = function() { setState('idle'); startWakeWordListener(); };
          speechSynthesis.speak(utter);
        } else {
          setState('idle');
          startWakeWordListener();
        }
      }).catch(function() { setState('idle'); startWakeWordListener(); });
    }

    // FAB click: toggle or start command
    fab.onclick = function() {
      if (state === 'idle') {
        startCommandCapture();
      } else if (state === 'listening') {
        if (commandRecognition) { try { commandRecognition.stop(); } catch(e) {} }
        setState('idle');
        startWakeWordListener();
      } else if (state === 'speaking') {
        speechSynthesis.cancel();
        setState('idle');
        startWakeWordListener();
      }
    };

    // Start wake word listener if enabled
    if (wakeEnabled) {
      // Delay start so page finishes loading
      setTimeout(startWakeWordListener, 3000);
    }

    // Expose toggle for settings
    window._toggleVoiceWake = function(enabled) {
      wakeEnabled = enabled;
      localStorage.setItem('aries-voice-wake', enabled ? 'true' : 'false');
      if (enabled) startWakeWordListener();
      else { stopWakeWordListener(); setState('idle'); }
    };
  }

  // ========================================================================
  // INTEGRATION: Hook into existing Settings panel and Dashboard
  // ========================================================================
  function hookIntoSettings() {
    // Override loadSettings to add usage dashboard section
    var origLoadSettings = null;
    if (window.aries && window.aries._loadedPanels) {
      // Observe the settings panel for content changes
      var observer = new MutationObserver(function(mutations) {
        var el = document.getElementById('settingsContent');
        if (!el || el.querySelector('#usageDashboardSection')) return;
        if (el.innerHTML.indexOf('spinner') !== -1) return;

        // Add Usage Dashboard section
        var usageSection = document.createElement('div');
        usageSection.id = 'usageDashboardSection';
        usageSection.className = 'card';
        usageSection.style.cssText = 'margin:0 0 16px;border:1px solid var(--accent2,#bf00ff)';
        usageSection.innerHTML = '<h3 style="margin:0 0 12px;color:var(--accent2,#bf00ff)">📊 API Usage & Costs</h3><div id="usageDashContainer"></div>';
        el.insertBefore(usageSection, el.firstChild);
        loadUsageDashboard(document.getElementById('usageDashContainer'));

        // Add Voice toggle
        var voiceSection = document.createElement('div');
        voiceSection.className = 'card';
        voiceSection.style.cssText = 'margin:0 0 16px;border:1px solid var(--green,#0f8)';
        var wakeOn = localStorage.getItem('aries-voice-wake') !== 'false';
        voiceSection.innerHTML = '<h3 style="margin:0 0 8px;color:var(--green,#0f8)">🎤 Voice Assistant</h3>' +
          '<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text);cursor:pointer"><input type="checkbox" id="voiceWakeToggle" ' + (wakeOn ? 'checked' : '') + ' onchange="window._toggleVoiceWake(this.checked)" /> Enable "Hey Aries" wake word (always-listening)</label>' +
          '<p style="font-size:11px;color:var(--text-dim);margin:8px 0 0">Uses browser SpeechRecognition API. Mic access required. Click the floating 🎤 button to manually activate.</p>';
        el.insertBefore(voiceSection, usageSection.nextSibling);
      });
      var settingsEl = document.getElementById('settingsContent');
      if (settingsEl) observer.observe(settingsEl, { childList: true, subtree: true });
    }
  }

  function addChangelogButton() {
    // Add "What's New" button to topbar
    var topRight = document.querySelector('.topbar-right');
    if (!topRight) return;
    var btn = document.createElement('div');
    btn.style.cssText = 'position:relative;cursor:pointer;font-size:16px;padding:4px 8px;border-radius:6px;transition:background 0.2s';
    btn.title = "What's New";
    btn.innerHTML = '🆕<span id="changelogBadge" class="cl-badge" style="display:none">0</span>';
    btn.onclick = showChangelog;
    btn.onmouseover = function() { btn.style.background = 'var(--accent-dim)'; };
    btn.onmouseout = function() { btn.style.background = 'none'; };
    var notifBell = document.getElementById('notifBell');
    if (notifBell) topRight.insertBefore(btn, notifBell);
    else topRight.appendChild(btn);

    // Changelog modal
    var modal = document.createElement('div');
    modal.id = 'changelogModal';
    modal.style.cssText = 'display:none;position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);align-items:center;justify-content:center';
    modal.innerHTML = '<div style="background:var(--bg-card);border:1px solid var(--accent);border-radius:12px;max-width:600px;width:92%;max-height:80vh;overflow-y:auto;padding:24px;position:relative">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h3 style="margin:0;color:var(--accent)">🆕 What\'s New</h3><button class="btn-sm" onclick="document.getElementById(\'changelogModal\').style.display=\'none\'">✕</button></div>' +
      '<div id="changelogContent"></div></div>';
    modal.onclick = function(e) { if (e.target === modal) modal.style.display = 'none'; };
    document.body.appendChild(modal);

    // Check for unread
    updateChangelogBadge();
  }

  // ========================================================================
  // INIT
  // ========================================================================
  function init() {
    addChangelogButton();
    initMobilePWA();
    initVoiceAssistant();
    hookIntoSettings();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else setTimeout(init, 100);

  console.log('[AriesFeatures v2] Loaded: Usage Dashboard, Changelog, Mobile PWA, Voice Assistant');
})();
