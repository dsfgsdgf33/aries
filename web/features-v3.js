/**
 * Aries AI Dashboard — Features v3: ABSOLUTE MADNESS
 * 1. Agent Personas Market  2. Time Travel Debug  3. Aries TV  4. Battle Mode
 * Pure vanilla JS, no dependencies. Loads after app.js
 */
(function() {
  'use strict';

  var AUTH = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (localStorage.getItem('aries-auth-token') || '') };
  function api(method, path, body) {
    var opts = { method: method, headers: AUTH };
    if (body) opts.body = JSON.stringify(body);
    return fetch('/api/' + path, opts).then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  function escapeHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function toast(msg, type) { if (window.aries && window.aries.toast) window.aries.toast(msg, type); }

  // ========================================================================
  // STYLES
  // ========================================================================
  var css = document.createElement('style');
  css.textContent = `
/* ── Persona Cards ── */
.persona-card { background: var(--bg-card,#0a0a1a); border: 1px solid var(--border,#222); border-radius: 12px; padding: 16px; transition: transform 0.2s, box-shadow 0.2s; cursor: pointer; position: relative; overflow: hidden; }
.persona-card:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,255,200,0.1); }
.persona-card .persona-icon { font-size: 36px; margin-bottom: 8px; }
.persona-card .persona-name { font-size: 15px; font-weight: 700; color: var(--accent,#0ff); margin-bottom: 4px; }
.persona-card .persona-desc { font-size: 12px; color: var(--text-dim,#888); margin-bottom: 8px; line-height: 1.4; }
.persona-card .persona-sample { background: rgba(0,255,200,0.05); border: 1px solid rgba(0,255,200,0.1); border-radius: 8px; padding: 8px 10px; font-size: 11px; color: #aaa; font-style: italic; margin-bottom: 8px; max-height: 60px; overflow: hidden; }
.persona-card .persona-pop { font-size: 11px; color: var(--text-dim); }
.persona-card .persona-apply-btn { padding: 6px 14px; background: var(--accent,#0ff); color: #000; border: none; border-radius: 6px; font-weight: 700; font-size: 12px; cursor: pointer; }
.persona-card .persona-apply-btn:hover { opacity: 0.85; }

/* ── Time Travel ── */
.tt-timeline { position: relative; padding: 8px 0; margin: 12px 0; }
.tt-slider { width: 100%; -webkit-appearance: none; appearance: none; height: 6px; background: linear-gradient(90deg, #0ff, #bf00ff); border-radius: 3px; outline: none; cursor: pointer; }
.tt-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 18px; height: 18px; border-radius: 50%; background: #0ff; border: 2px solid #000; cursor: pointer; box-shadow: 0 0 8px rgba(0,255,255,0.5); }
.tt-msg-faded { opacity: 0.25; filter: grayscale(0.8); transition: opacity 0.3s, filter 0.3s; }
.tt-branch-tree { background: #0a0a12; border: 1px solid var(--border); border-radius: 8px; padding: 12px; font-family: monospace; font-size: 12px; color: #0ff; }
.tt-branch-node { padding: 4px 0; cursor: pointer; }
.tt-branch-node:hover { color: #fff; }
.tt-branch-node.active { color: #0f0; font-weight: bold; }

/* ── Aries TV ── */
.aries-tv-fullscreen { position: fixed; inset: 0; z-index: 99999; background: #000; display: flex; flex-direction: column; overflow: hidden; }
.aries-tv-agent { text-align: center; padding: 40px; flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; position: relative; z-index: 2; }
.aries-tv-avatar { font-size: 80px; margin-bottom: 16px; animation: tvPulse 2s ease-in-out infinite; }
@keyframes tvPulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.05); } }
.aries-tv-name { font-size: 28px; font-weight: 800; color: #0ff; text-shadow: 0 0 20px rgba(0,255,255,0.5); margin-bottom: 8px; }
.aries-tv-action { font-size: 16px; color: #0f0; margin-bottom: 16px; text-transform: uppercase; letter-spacing: 2px; }
.aries-tv-snippet { font-family: monospace; font-size: 14px; color: #888; max-width: 600px; text-align: center; line-height: 1.6; }
.aries-tv-ticker { position: absolute; bottom: 0; left: 0; right: 0; background: rgba(0,0,0,0.8); border-top: 1px solid #0ff3; padding: 8px 16px; display: flex; justify-content: space-around; font-size: 13px; color: #0ff; z-index: 3; }
.aries-tv-close { position: absolute; top: 16px; right: 16px; z-index: 10; background: rgba(0,0,0,0.6); border: 1px solid #333; border-radius: 50%; width: 40px; height: 40px; color: #fff; font-size: 20px; cursor: pointer; display: flex; align-items: center; justify-content: center; }

/* ── Battle Mode ── */
.battle-arena { background: linear-gradient(135deg, #0a0a1a, #1a0a2a); border: 1px solid var(--border); border-radius: 12px; padding: 20px; }
.battle-vs { text-align: center; font-size: 48px; font-weight: 900; color: #f44; text-shadow: 0 0 30px rgba(255,68,68,0.5); margin: 16px 0; }
.battle-bubble { padding: 14px 18px; border-radius: 12px; margin-bottom: 12px; max-width: 80%; font-size: 13px; line-height: 1.5; position: relative; }
.battle-bubble.left { background: rgba(0,255,255,0.08); border: 1px solid rgba(0,255,255,0.2); margin-right: auto; color: #ddd; border-bottom-left-radius: 4px; }
.battle-bubble.right { background: rgba(191,0,255,0.08); border: 1px solid rgba(191,0,255,0.2); margin-left: auto; color: #ddd; border-bottom-right-radius: 4px; text-align: right; }
.battle-bubble .bb-label { font-size: 11px; font-weight: 700; margin-bottom: 6px; }
.battle-bubble.left .bb-label { color: #0ff; }
.battle-bubble.right .bb-label { color: #bf00ff; }
.battle-vote-btn { padding: 8px 20px; border: 2px solid; border-radius: 8px; font-weight: 700; font-size: 13px; cursor: pointer; background: transparent; transition: all 0.2s; }
.battle-vote-btn:hover { transform: scale(1.05); }
.battle-vote-btn.vote1 { color: #0ff; border-color: #0ff; }
.battle-vote-btn.vote1:hover { background: rgba(0,255,255,0.15); }
.battle-vote-btn.vote2 { color: #bf00ff; border-color: #bf00ff; }
.battle-vote-btn.vote2:hover { background: rgba(191,0,255,0.15); }
.battle-lb-row { display: flex; align-items: center; gap: 12px; padding: 8px 12px; border-bottom: 1px solid var(--border,#222); font-size: 13px; }
.battle-lb-row:last-child { border-bottom: none; }
.battle-lb-rank { font-size: 18px; font-weight: 900; color: var(--accent); width: 30px; text-align: center; }
`;
  document.head.appendChild(css);

  // ========================================================================
  // 1. AGENT PERSONAS MARKET
  // ========================================================================
  function loadPersonas() {
    var el = document.getElementById('personasContent');
    if (!el) return;
    el.innerHTML = '<div class="spinner"></div> Loading personas...';

    api('GET', 'personas').then(function(d) {
      var personas = d.personas || [];
      var html = '';

      // Create form
      html += '<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:20px">';
      html += '<h3 style="color:var(--accent);margin:0 0 12px;font-size:14px">✨ Create Custom Persona</h3>';
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">';
      html += '<input id="newPersonaName" placeholder="Persona name" style="padding:10px;background:#0a0a0a;color:#eee;border:1px solid #333;border-radius:8px" />';
      html += '<input id="newPersonaIcon" placeholder="Icon emoji (e.g. 🎭)" style="padding:10px;background:#0a0a0a;color:#eee;border:1px solid #333;border-radius:8px" />';
      html += '</div>';
      html += '<textarea id="newPersonaDesc" placeholder="Description..." rows="2" style="width:100%;padding:10px;background:#0a0a0a;color:#eee;border:1px solid #333;border-radius:8px;resize:vertical;margin-bottom:10px;box-sizing:border-box"></textarea>';
      html += '<textarea id="newPersonaPrompt" placeholder="Personality prompt (how they speak, quirks, style)..." rows="3" style="width:100%;padding:10px;background:#0a0a0a;color:#eee;border:1px solid #333;border-radius:8px;resize:vertical;margin-bottom:10px;box-sizing:border-box"></textarea>';
      html += '<input id="newPersonaStyle" placeholder="Speaking style (e.g. aggressive, calm, dramatic)" style="width:100%;padding:10px;background:#0a0a0a;color:#eee;border:1px solid #333;border-radius:8px;margin-bottom:10px;box-sizing:border-box" />';
      html += '<button onclick="window._createPersona()" class="btn-primary" style="padding:8px 20px">🎭 Create Persona</button>';
      html += '</div>';

      // Persona grid
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px">';
      for (var i = 0; i < personas.length; i++) {
        var p = personas[i];
        html += '<div class="persona-card">';
        html += '<div class="persona-icon">' + (p.icon || '🎭') + '</div>';
        html += '<div class="persona-name">' + escapeHtml(p.name) + '</div>';
        html += '<div class="persona-desc">' + escapeHtml(p.description || '') + '</div>';
        if (p.sampleResponse) {
          html += '<div class="persona-sample">"' + escapeHtml(p.sampleResponse.substring(0, 120)) + '..."</div>';
        }
        html += '<div style="display:flex;justify-content:space-between;align-items:center">';
        html += '<div class="persona-pop">🔥 ' + (p.popularity || 0) + ' uses</div>';
        html += '<button class="persona-apply-btn" onclick="window._applyPersona(\'' + escapeHtml(p.id) + '\')">Apply</button>';
        html += '</div></div>';
      }
      html += '</div>';
      if (personas.length === 0) html += '<p style="color:var(--text-dim);text-align:center;padding:20px">No personas yet. Create one above!</p>';

      el.innerHTML = html;
    }).catch(function(e) { el.innerHTML = '<p style="color:var(--red)">Failed to load personas: ' + escapeHtml(e.message) + '</p>'; });
  }

  window._createPersona = function() {
    var name = (document.getElementById('newPersonaName') || {}).value || '';
    var icon = (document.getElementById('newPersonaIcon') || {}).value || '🎭';
    var desc = (document.getElementById('newPersonaDesc') || {}).value || '';
    var prompt = (document.getElementById('newPersonaPrompt') || {}).value || '';
    var style = (document.getElementById('newPersonaStyle') || {}).value || '';
    if (!name.trim()) { toast('Name is required', 'error'); return; }
    api('POST', 'personas', { name: name.trim(), icon: icon.trim(), description: desc.trim(), personalityPrompt: prompt.trim(), speakingStyle: style.trim() }).then(function() {
      toast('Persona created: ' + name, 'success');
      loadPersonas();
    }).catch(function(e) { toast('Error: ' + e.message, 'error'); });
  };

  window._applyPersona = function(personaId) {
    // Show subagent picker
    api('GET', 'subagents').then(function(d) {
      var subs = d.subagents || [];
      if (subs.length === 0) { toast('No subagents to apply persona to', 'error'); return; }
      var options = subs.map(function(s) { return s.name + ' (' + s.id + ')'; }).join('\n');
      var choice = prompt('Apply persona to which subagent?\n\n' + options + '\n\nEnter subagent ID:', subs[0].id);
      if (!choice) return;
      api('POST', 'personas/' + encodeURIComponent(personaId) + '/apply', { agentId: choice.trim() }).then(function(d) {
        toast('Persona applied to ' + choice + '!', 'success');
      }).catch(function(e) { toast('Error: ' + e.message, 'error'); });
    });
  };

  // ========================================================================
  // 2. TIME TRAVEL DEBUG
  // ========================================================================
  var _ttCurrentConv = 'main';
  var _ttCurrentBranch = 'main';
  var _ttSnapshots = [];
  var _ttBranches = [];

  function loadTimeTravel() {
    var el = document.getElementById('timeTravelContent');
    if (!el) return;
    el.innerHTML = '<div class="spinner"></div> Loading time travel data...';

    api('GET', 'timetravel/' + encodeURIComponent(_ttCurrentConv) + '/snapshots').then(function(d) {
      _ttSnapshots = d.snapshots || [];
      _ttBranches = d.branches || [];
      renderTimeTravel(el);
    }).catch(function(e) { el.innerHTML = '<p style="color:var(--red)">Failed: ' + escapeHtml(e.message) + '</p>'; });
  }

  function renderTimeTravel(el) {
    var snaps = _ttSnapshots;
    var html = '';

    // Branch tree
    html += '<div style="display:flex;gap:16px;margin-bottom:16px;flex-wrap:wrap">';
    html += '<div style="flex:1;min-width:200px">';
    html += '<h4 style="color:var(--accent2);margin:0 0 8px;font-size:13px">🌳 Conversation Branches</h4>';
    html += '<div class="tt-branch-tree">';
    html += '<div class="tt-branch-node' + (_ttCurrentBranch === 'main' ? ' active' : '') + '" onclick="window._ttSwitchBranch(\'main\')">📌 main (' + snaps.length + ' messages)</div>';
    for (var b = 0; b < _ttBranches.length; b++) {
      var br = _ttBranches[b];
      html += '<div class="tt-branch-node' + (_ttCurrentBranch === br.id ? ' active' : '') + '" onclick="window._ttSwitchBranch(\'' + escapeHtml(br.id) + '\')" style="padding-left:' + ((br.depth || 1) * 16) + 'px">├─ ' + escapeHtml(br.name || br.id) + ' (from msg #' + (br.fromIndex || 0) + ')</div>';
    }
    html += '</div></div>';

    // Stats
    html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;flex:1">';
    html += '<div style="background:#0a0a12;border:1px solid var(--border);border-radius:8px;padding:12px;text-align:center"><div style="font-size:22px;font-weight:bold;color:#0ff">' + snaps.length + '</div><div style="font-size:11px;color:#888">Messages</div></div>';
    html += '<div style="background:#0a0a12;border:1px solid var(--border);border-radius:8px;padding:12px;text-align:center"><div style="font-size:22px;font-weight:bold;color:#bf00ff">' + _ttBranches.length + '</div><div style="font-size:11px;color:#888">Branches</div></div>';
    html += '<div style="background:#0a0a12;border:1px solid var(--border);border-radius:8px;padding:12px;text-align:center"><div style="font-size:22px;font-weight:bold;color:#0f0">' + _ttCurrentBranch + '</div><div style="font-size:11px;color:#888">Current</div></div>';
    html += '</div></div>';

    // Timeline slider
    if (snaps.length > 0) {
      html += '<div class="tt-timeline">';
      html += '<div style="display:flex;justify-content:space-between;font-size:11px;color:#666;margin-bottom:4px"><span>Message 1</span><span>Message ' + snaps.length + '</span></div>';
      html += '<input type="range" class="tt-slider" min="0" max="' + (snaps.length - 1) + '" value="' + (snaps.length - 1) + '" id="ttSlider" oninput="window._ttSlide(this.value)" />';
      html += '<div style="text-align:center;margin-top:4px"><span id="ttSliderLabel" style="font-size:12px;color:#0ff">Showing all ' + snaps.length + ' messages</span></div>';
      html += '</div>';

      // Branch from here button
      html += '<div style="margin-bottom:16px;display:flex;gap:8px;align-items:center">';
      html += '<button onclick="window._ttBranchFromHere()" class="btn-sm" style="color:#bf00ff;border-color:#bf00ff">🌿 Branch from current point</button>';
      html += '<input id="ttBranchMsg" placeholder="New message for branch..." style="flex:1;padding:8px;background:#0a0a0a;color:#eee;border:1px solid #333;border-radius:8px;font-size:12px" />';
      html += '</div>';

      // Messages
      html += '<div id="ttMessages" style="max-height:400px;overflow-y:auto;background:#05050a;border:1px solid var(--border);border-radius:8px;padding:12px">';
      for (var i = 0; i < snaps.length; i++) {
        var s = snaps[i];
        var isUser = s.role === 'user';
        var bg = isUser ? 'rgba(0,255,255,0.05)' : 'rgba(191,0,255,0.05)';
        var border = isUser ? 'rgba(0,255,255,0.15)' : 'rgba(191,0,255,0.15)';
        var label = isUser ? '👤 You' : '🤖 Aries';
        var time = s.timestamp ? new Date(s.timestamp).toLocaleTimeString() : '';
        html += '<div class="tt-msg" data-idx="' + i + '" style="background:' + bg + ';border:1px solid ' + border + ';border-radius:8px;padding:10px;margin-bottom:8px">';
        html += '<div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px"><span style="color:' + (isUser ? '#0ff' : '#bf00ff') + '">' + label + ' #' + (i + 1) + '</span><span style="color:#555">' + time + '</span></div>';
        html += '<div style="color:#ccc;font-size:13px;white-space:pre-wrap;word-break:break-word">' + escapeHtml((s.content || '').substring(0, 500)) + '</div>';
        html += '</div>';
      }
      html += '</div>';
    } else {
      html += '<p style="color:var(--text-dim);text-align:center;padding:30px">No conversation snapshots yet. Start chatting to build timeline!</p>';
    }

    el.innerHTML = html;
  }

  window._ttSlide = function(val) {
    var idx = parseInt(val);
    var label = document.getElementById('ttSliderLabel');
    if (label) label.textContent = 'Showing messages 1-' + (idx + 1) + ' of ' + _ttSnapshots.length;
    var msgs = document.querySelectorAll('.tt-msg');
    for (var i = 0; i < msgs.length; i++) {
      var msgIdx = parseInt(msgs[i].getAttribute('data-idx'));
      if (msgIdx > idx) msgs[i].classList.add('tt-msg-faded');
      else msgs[i].classList.remove('tt-msg-faded');
    }
  };

  window._ttBranchFromHere = function() {
    var slider = document.getElementById('ttSlider');
    var fromIdx = slider ? parseInt(slider.value) : _ttSnapshots.length - 1;
    var newMsg = (document.getElementById('ttBranchMsg') || {}).value || '';
    api('POST', 'timetravel/' + encodeURIComponent(_ttCurrentConv) + '/branch', { fromIndex: fromIdx, newMessage: newMsg || undefined }).then(function(d) {
      toast('Branch created from message #' + (fromIdx + 1) + '!', 'success');
      loadTimeTravel();
    }).catch(function(e) { toast('Error: ' + e.message, 'error'); });
  };

  window._ttSwitchBranch = function(branchId) {
    _ttCurrentBranch = branchId;
    loadTimeTravel();
  };

  // ========================================================================
  // 3. ARIES TV
  // ========================================================================
  var _tvOverlay = null;
  var _tvInterval = null;
  var _tvCanvas = null;
  var _tvCtx = null;
  var _tvAgents = [];
  var _tvCurrentIdx = 0;

  function loadAriesTv() {
    var el = document.getElementById('ariesTvContent');
    if (!el) return;
    el.innerHTML = '<div style="text-align:center;padding:40px">' +
      '<div style="font-size:64px;margin-bottom:16px">📺</div>' +
      '<h2 style="color:var(--accent);margin:0 0 8px">Aries TV</h2>' +
      '<p style="color:var(--text-dim);max-width:400px;margin:0 auto 24px">Watch your agents work in real-time. Matrix rain, live activity, and stats — it\'s like a screensaver, but useful.</p>' +
      '<button onclick="window._tvStart()" class="btn-primary" style="padding:12px 32px;font-size:16px">▶ Launch Aries TV</button>' +
      '<div style="margin-top:20px">' +
      '<h4 style="color:var(--accent2);margin:0 0 8px;font-size:13px">📡 Live Activity Feed</h4>' +
      '<div id="tvFeedPreview" style="max-height:300px;overflow-y:auto;background:#05050a;border:1px solid var(--border);border-radius:8px;padding:12px;font-size:12px;font-family:monospace;color:#0f0">' +
      'Waiting for agent activity...' +
      '</div></div></div>';

    // Start polling activity for preview
    refreshTvFeed();
  }

  function refreshTvFeed() {
    api('GET', 'tv/feed').then(function(d) {
      _tvAgents = d.agents || [];
      var feed = d.feed || [];
      var preview = document.getElementById('tvFeedPreview');
      if (!preview) return;
      if (feed.length === 0) { preview.innerHTML = '<span style="color:#555">No recent activity</span>'; return; }
      var html = '';
      for (var i = 0; i < feed.length; i++) {
        var f = feed[i];
        var color = f.status === 'working' ? '#0f0' : f.status === 'thinking' ? '#0ff' : '#666';
        html += '<div style="margin-bottom:4px"><span style="color:#555">[' + (f.time || '') + ']</span> <span style="color:' + color + '">' + escapeHtml(f.agent || 'aries') + '</span> <span style="color:#888">' + escapeHtml(f.action || 'idle') + '</span>';
        if (f.snippet) html += ' <span style="color:#444">→ ' + escapeHtml(f.snippet.substring(0, 60)) + '</span>';
        html += '</div>';
      }
      preview.innerHTML = html;
    }).catch(function() {});
  }

  window._tvStart = function() {
    if (_tvOverlay) return;
    _tvOverlay = document.createElement('div');
    _tvOverlay.className = 'aries-tv-fullscreen';

    // Matrix canvas
    _tvOverlay.innerHTML = '<canvas id="tvMatrixCanvas" style="position:absolute;inset:0;z-index:1"></canvas>' +
      '<div class="aries-tv-agent" id="tvAgentDisplay">' +
      '<div class="aries-tv-avatar" id="tvAvatar">🤖</div>' +
      '<div class="aries-tv-name" id="tvName">ARIES</div>' +
      '<div class="aries-tv-action" id="tvAction">● INITIALIZING</div>' +
      '<div class="aries-tv-snippet" id="tvSnippet">Loading agent activity...</div>' +
      '</div>' +
      '<div class="aries-tv-ticker">' +
      '<span>📊 Tasks/hr: <span id="tvTasksHr">0</span></span>' +
      '<span>🔤 Tokens: <span id="tvTokens">0</span></span>' +
      '<span>🤖 Active: <span id="tvActive">0</span></span>' +
      '<span>⏱ Uptime: <span id="tvUptime">00:00</span></span>' +
      '</div>' +
      '<button class="aries-tv-close" onclick="window._tvStop()">✕</button>';

    document.body.appendChild(_tvOverlay);
    initMatrixRain();
    _tvInterval = setInterval(cycleTvAgent, 5000);
    cycleTvAgent();
  };

  window._tvStop = function() {
    if (_tvOverlay) { _tvOverlay.remove(); _tvOverlay = null; }
    if (_tvInterval) { clearInterval(_tvInterval); _tvInterval = null; }
  };

  function initMatrixRain() {
    var canvas = document.getElementById('tvMatrixCanvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    var cols = Math.floor(canvas.width / 14);
    var drops = [];
    for (var i = 0; i < cols; i++) drops[i] = Math.random() * canvas.height / 14;
    var chars = 'ARIESAI01アイリスデータフロー';

    function draw() {
      if (!_tvOverlay) return;
      ctx.fillStyle = 'rgba(0,0,0,0.05)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#0f03';
      ctx.font = '14px monospace';
      for (var i = 0; i < drops.length; i++) {
        var ch = chars[Math.floor(Math.random() * chars.length)];
        ctx.fillText(ch, i * 14, drops[i] * 14);
        if (drops[i] * 14 > canvas.height && Math.random() > 0.975) drops[i] = 0;
        drops[i]++;
      }
      requestAnimationFrame(draw);
    }
    draw();
  }

  function cycleTvAgent() {
    api('GET', 'tv/feed').then(function(d) {
      var agents = d.agents || [];
      var stats = d.stats || {};
      if (agents.length === 0) return;
      _tvCurrentIdx = (_tvCurrentIdx + 1) % agents.length;
      var a = agents[_tvCurrentIdx];
      var el = function(id) { return document.getElementById(id); };
      if (el('tvAvatar')) el('tvAvatar').textContent = a.icon || '🤖';
      if (el('tvName')) el('tvName').textContent = a.name || 'Agent';
      if (el('tvAction')) { el('tvAction').textContent = '● ' + (a.action || 'IDLE').toUpperCase(); el('tvAction').style.color = a.action === 'working' ? '#0f0' : a.action === 'thinking' ? '#0ff' : '#888'; }
      if (el('tvSnippet')) el('tvSnippet').textContent = a.snippet || 'Waiting for tasks...';
      if (el('tvTasksHr')) el('tvTasksHr').textContent = stats.tasksPerHour || 0;
      if (el('tvTokens')) el('tvTokens').textContent = (stats.tokensUsed || 0).toLocaleString();
      if (el('tvActive')) el('tvActive').textContent = stats.activeAgents || 0;
      if (el('tvUptime')) el('tvUptime').textContent = stats.uptime || '00:00';
    }).catch(function() {});
  }

  // ========================================================================
  // 4. BATTLE MODE
  // ========================================================================
  var _currentBattle = null;

  function loadBattle() {
    var el = document.getElementById('battleContent');
    if (!el) return;
    el.innerHTML = '<div class="spinner"></div> Loading battle arena...';

    Promise.all([
      api('GET', 'subagents').catch(function() { return { subagents: [] }; }),
      api('GET', 'battle/leaderboard').catch(function() { return { leaderboard: [] }; }),
      api('GET', 'battle/history').catch(function() { return { battles: [] }; })
    ]).then(function(results) {
      var subs = results[0].subagents || [];
      var lb = results[1].leaderboard || [];
      var history = results[2].battles || [];
      var html = '';

      // Start battle form
      html += '<div class="battle-arena" style="margin-bottom:20px">';
      html += '<h3 style="color:#f44;margin:0 0 16px;text-align:center;font-size:18px">⚔️ BATTLE ARENA</h3>';
      html += '<div style="display:grid;grid-template-columns:1fr auto 1fr;gap:16px;align-items:center">';
      html += '<div><label style="font-size:11px;color:#0ff;text-transform:uppercase;letter-spacing:1px">Fighter 1</label>';
      html += '<select id="battleAgent1" style="width:100%;padding:10px;background:#0a0a0a;color:#0ff;border:1px solid #0ff3;border-radius:8px;margin-top:4px">';
      for (var i = 0; i < subs.length; i++) html += '<option value="' + escapeHtml(subs[i].id) + '">' + escapeHtml(subs[i].icon || '🤖') + ' ' + escapeHtml(subs[i].name) + '</option>';
      html += '</select></div>';
      html += '<div class="battle-vs">VS</div>';
      html += '<div><label style="font-size:11px;color:#bf00ff;text-transform:uppercase;letter-spacing:1px">Fighter 2</label>';
      html += '<select id="battleAgent2" style="width:100%;padding:10px;background:#0a0a0a;color:#bf00ff;border:1px solid #bf00ff3;border-radius:8px;margin-top:4px">';
      for (var i = 0; i < subs.length; i++) html += '<option value="' + escapeHtml(subs[i].id) + '"' + (i === 1 ? ' selected' : '') + '>' + escapeHtml(subs[i].icon || '🤖') + ' ' + escapeHtml(subs[i].name) + '</option>';
      html += '</select></div>';
      html += '</div>';

      html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin:16px 0">';
      html += '<div><label style="font-size:11px;color:#888;text-transform:uppercase">Topic</label><input id="battleTopic" placeholder="e.g. Is AI sentient?" style="width:100%;padding:8px;background:#0a0a0a;color:#eee;border:1px solid #333;border-radius:8px;margin-top:4px;box-sizing:border-box" /></div>';
      html += '<div><label style="font-size:11px;color:#888;text-transform:uppercase">Category</label><select id="battleCategory" style="width:100%;padding:8px;background:#0a0a0a;color:#eee;border:1px solid #333;border-radius:8px;margin-top:4px"><option value="debate">🎙 Debate</option><option value="coding">💻 Coding</option><option value="creative">🎨 Creative Writing</option><option value="analysis">📊 Analysis</option><option value="trivia">🧠 Trivia</option></select></div>';
      html += '<div><label style="font-size:11px;color:#888;text-transform:uppercase">Rounds</label><select id="battleRounds" style="width:100%;padding:8px;background:#0a0a0a;color:#eee;border:1px solid #333;border-radius:8px;margin-top:4px"><option value="3">3 Rounds</option><option value="5">5 Rounds</option></select></div>';
      html += '</div>';
      html += '<div style="text-align:center"><button onclick="window._startBattle()" class="btn-primary" style="padding:12px 40px;font-size:16px;font-weight:900;background:linear-gradient(90deg,#f44,#ff8800);border:none;border-radius:8px;color:#fff">⚔️ START BATTLE</button></div>';
      html += '</div>';

      // Live battle area
      html += '<div id="battleLiveArea"></div>';

      // Leaderboard
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:20px">';
      html += '<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:16px">';
      html += '<h4 style="color:var(--accent);margin:0 0 12px;font-size:14px">🏆 Leaderboard</h4>';
      if (lb.length === 0) html += '<p style="color:var(--text-dim);font-size:12px">No battles yet</p>';
      for (var l = 0; l < lb.length; l++) {
        var entry = lb[l];
        var medals = ['🥇','🥈','🥉'];
        html += '<div class="battle-lb-row"><div class="battle-lb-rank">' + (medals[l] || (l + 1)) + '</div><div style="flex:1;color:#eee">' + escapeHtml(entry.name || entry.agentId) + '</div><div style="color:#0f0;font-weight:700">' + (entry.wins || 0) + 'W</div><div style="color:#f44">' + (entry.losses || 0) + 'L</div></div>';
      }
      html += '</div>';

      // Recent battles
      html += '<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:16px">';
      html += '<h4 style="color:var(--accent2);margin:0 0 12px;font-size:14px">📜 Recent Battles</h4>';
      if (history.length === 0) html += '<p style="color:var(--text-dim);font-size:12px">No battle history</p>';
      for (var h = 0; h < Math.min(history.length, 8); h++) {
        var b = history[h];
        html += '<div style="padding:6px 0;border-bottom:1px solid #222;font-size:12px">';
        html += '<span style="color:#0ff">' + escapeHtml(b.agent1) + '</span> vs <span style="color:#bf00ff">' + escapeHtml(b.agent2) + '</span>';
        html += ' — <span style="color:#0f0;font-weight:700">' + escapeHtml(b.winner || 'draw') + ' wins</span>';
        html += ' <span style="color:#555">(' + escapeHtml(b.topic || '').substring(0, 30) + ')</span>';
        html += '</div>';
      }
      html += '</div></div>';

      el.innerHTML = html;
    });
  }

  window._startBattle = function() {
    var a1 = (document.getElementById('battleAgent1') || {}).value;
    var a2 = (document.getElementById('battleAgent2') || {}).value;
    var topic = (document.getElementById('battleTopic') || {}).value || 'Which programming language is best?';
    var category = (document.getElementById('battleCategory') || {}).value || 'debate';
    var rounds = parseInt((document.getElementById('battleRounds') || {}).value) || 3;
    if (!a1 || !a2) { toast('Select two agents', 'error'); return; }
    if (a1 === a2) { toast('Pick two DIFFERENT agents!', 'error'); return; }

    var area = document.getElementById('battleLiveArea');
    if (!area) return;
    area.innerHTML = '<div style="text-align:center;padding:20px;color:#f44;font-size:14px">⚔️ Battle starting... preparing fighters...</div>';

    api('POST', 'battle/start', { agent1: a1, agent2: a2, topic: topic, category: category, rounds: rounds }).then(function(d) {
      _currentBattle = d;
      renderBattleLive(area, d);
    }).catch(function(e) { area.innerHTML = '<div style="color:var(--red);padding:16px">Battle error: ' + escapeHtml(e.message) + '</div>'; });
  };

  function renderBattleLive(area, battle) {
    var rounds = battle.rounds || [];
    var html = '<div class="battle-arena" style="margin-top:16px">';
    html += '<h3 style="text-align:center;color:#f44;margin:0 0 16px">⚔️ ' + escapeHtml(battle.agent1Name || battle.agent1) + ' vs ' + escapeHtml(battle.agent2Name || battle.agent2) + '</h3>';
    html += '<div style="text-align:center;color:#888;font-size:12px;margin-bottom:16px">Topic: ' + escapeHtml(battle.topic) + ' | Category: ' + escapeHtml(battle.category) + '</div>';

    for (var r = 0; r < rounds.length; r++) {
      var round = rounds[r];
      html += '<div style="margin-bottom:16px;border-top:1px solid #222;padding-top:12px">';
      html += '<div style="text-align:center;font-size:12px;color:#f44;font-weight:700;margin-bottom:8px">ROUND ' + (r + 1) + '</div>';
      if (round.agent1Response) {
        html += '<div class="battle-bubble left"><div class="bb-label">' + escapeHtml(battle.agent1Name || battle.agent1) + '</div>' + escapeHtml(round.agent1Response.substring(0, 500)) + '</div>';
      }
      if (round.agent2Response) {
        html += '<div class="battle-bubble right"><div class="bb-label">' + escapeHtml(battle.agent2Name || battle.agent2) + '</div>' + escapeHtml(round.agent2Response.substring(0, 500)) + '</div>';
      }
      // Vote buttons
      if (!round.vote) {
        html += '<div style="display:flex;justify-content:center;gap:16px;margin-top:8px">';
        html += '<button class="battle-vote-btn vote1" onclick="window._battleVote(\'' + escapeHtml(battle.id) + '\',' + r + ',\'' + escapeHtml(battle.agent1) + '\')">👍 ' + escapeHtml(battle.agent1Name || battle.agent1) + '</button>';
        html += '<button class="battle-vote-btn vote2" onclick="window._battleVote(\'' + escapeHtml(battle.id) + '\',' + r + ',\'' + escapeHtml(battle.agent2) + '\')">👍 ' + escapeHtml(battle.agent2Name || battle.agent2) + '</button>';
        html += '</div>';
      } else {
        html += '<div style="text-align:center;font-size:12px;color:#0f0;margin-top:4px">✓ Vote: ' + escapeHtml(round.vote) + '</div>';
      }
      html += '</div>';
    }

    // Final score
    if (battle.winner) {
      html += '<div style="text-align:center;padding:20px;background:linear-gradient(135deg,rgba(0,255,0,0.05),rgba(0,255,255,0.05));border-radius:8px;margin-top:16px">';
      html += '<div style="font-size:32px;margin-bottom:8px">🏆</div>';
      html += '<div style="font-size:20px;font-weight:900;color:#0f0">' + escapeHtml(battle.winner) + ' WINS!</div>';
      html += '<div style="font-size:13px;color:#888;margin-top:4px">Score: ' + (battle.score1 || 0) + ' - ' + (battle.score2 || 0) + '</div>';
      html += '</div>';
    }

    html += '</div>';
    area.innerHTML = html;
  }

  window._battleVote = function(battleId, round, winner) {
    api('POST', 'battle/' + encodeURIComponent(battleId) + '/vote', { round: round, winner: winner }).then(function(d) {
      toast('Vote recorded!', 'success');
      _currentBattle = d;
      var area = document.getElementById('battleLiveArea');
      if (area) renderBattleLive(area, d);
    }).catch(function(e) { toast('Vote error: ' + e.message, 'error'); });
  };

  // ========================================================================
  // HOOK INTO PANEL LOADING
  // ========================================================================
  function hookPanelLoading() {
    // Override loadPanelData for our new panels
    var origSwitch = window.aries && window.aries.switchPanel;
    if (!origSwitch) return;

    // Add to _loadedPanels tracking
    var _loadedPanels = (window.aries && window.aries._loadedPanels) || {};

    // Listen for panel switches
    var checkInterval = setInterval(function() {
      if (!window.aries) return;
      // Hook into the panel system
      var panels = document.querySelectorAll('.panel.active');
      for (var i = 0; i < panels.length; i++) {
        var id = panels[i].id;
        if (id === 'panel-personas' && !_loadedPanels['personas-v3']) { _loadedPanels['personas-v3'] = true; loadPersonas(); }
        if (id === 'panel-timetravel' && !_loadedPanels['timetravel-v3']) { _loadedPanels['timetravel-v3'] = true; loadTimeTravel(); }
        if (id === 'panel-aries-tv' && !_loadedPanels['ariestv-v3']) { _loadedPanels['ariestv-v3'] = true; loadAriesTv(); }
        if (id === 'panel-battle' && !_loadedPanels['battle-v3']) { _loadedPanels['battle-v3'] = true; loadBattle(); }
      }
    }, 500);
  }

  // ========================================================================
  // EXPOSE FOR MANUAL REFRESH
  // ========================================================================
  window._loadPersonas = loadPersonas;
  window._loadTimeTravel = loadTimeTravel;
  window._loadAriesTv = loadAriesTv;
  window._loadBattle = loadBattle;
  window._refreshTvFeed = refreshTvFeed;

  // ========================================================================
  // INIT
  // ========================================================================
  function init() {
    hookPanelLoading();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else setTimeout(init, 200);

  console.log('[AriesFeatures v3] Loaded: Personas Market, Time Travel, Aries TV, Battle Mode');
})();
