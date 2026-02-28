/**
 * ARIES Developer Power Tools — 5 panels
 * Git Integration, Database Viewer, API Playground, Plugin IDE, Log Streaming
 * Vanilla JS, no deps, cyberpunk theme
 */
(function() {
  'use strict';
  var API_KEY = 'aries-api-2026';

  function authHeaders() {
    return { 'Content-Type': 'application/json', 'x-aries-key': API_KEY, 'Authorization': 'Bearer ' + (localStorage.getItem('aries-auth-token') || '') };
  }
  function api(method, path, body) {
    var opts = { method: method, headers: authHeaders() };
    if (body) opts.body = JSON.stringify(body);
    return fetch('/api/' + path, opts).then(function(r) { return r.json(); });
  }
  function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
  function toast(msg, type) { if (window.aries && window.aries._toast) window.aries._toast(msg, type); }

  // ══════════════════════════════════════════
  //  1. GIT INTEGRATION PANEL (Enhanced)
  // ══════════════════════════════════════════
  function loadGitPanel() {
    var el = document.getElementById('gitPanelContent');
    if (!el) return;
    el.innerHTML = '<div style="text-align:center;padding:40px;color:#555">Loading git...</div>';
    Promise.all([
      api('GET', 'git/status'),
      api('GET', 'git/log'),
      api('GET', 'git/branches')
    ]).then(function(r) {
      var status = r[0], log = r[1], branches = r[2];
      var html = '';

      // Branch bar
      html += '<div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap">';
      html += '<span style="color:var(--accent);font-weight:bold;font-size:14px">⎇ ' + esc(status.branch || 'unknown') + '</span>';
      if (branches.branches && branches.branches.length) {
        html += '<select id="gitBranchSelect" onchange="window.devtools.gitCheckout(this.value)" style="background:#111;color:var(--accent);border:1px solid #333;border-radius:6px;padding:4px 8px;font-size:12px">';
        for (var bi = 0; bi < branches.branches.length; bi++) {
          var b = branches.branches[bi].replace(/^\*\s*/, '').trim();
          html += '<option value="' + esc(b) + '"' + (b === (status.branch || '').trim() ? ' selected' : '') + '>' + esc(b) + '</option>';
        }
        html += '</select>';
      }
      html += '<input id="gitNewBranch" placeholder="new-branch-name" style="background:#111;color:#ccc;border:1px solid #333;border-radius:6px;padding:4px 8px;font-size:12px;width:140px" />';
      html += '<button class="btn-sm" onclick="window.devtools.gitCreateBranch()">+ Branch</button>';
      html += '<div style="flex:1"></div>';
      html += '<button class="btn-sm" onclick="window.devtools.gitPull()" style="color:#0f0">⬇ Pull</button>';
      html += '<button class="btn-sm" onclick="window.devtools.gitPush()" style="color:#ff0">⬆ Push</button>';
      html += '</div>';

      // File status
      html += '<div class="card" style="margin-bottom:12px"><h3 style="margin:0 0 8px;color:var(--accent);font-size:13px">📁 Working Tree</h3>';
      if (status.files && status.files.length) {
        html += '<div style="max-height:200px;overflow-y:auto">';
        for (var fi = 0; fi < status.files.length; fi++) {
          var f = status.files[fi];
          var badge = f.status || '?';
          var badgeColor = badge.indexOf('M') >= 0 ? '#ff0' : badge.indexOf('A') >= 0 ? '#0f0' : badge.indexOf('D') >= 0 ? '#f44' : badge.indexOf('?') >= 0 ? '#888' : '#0ff';
          html += '<div style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:12px;font-family:monospace;border-bottom:1px solid #1a1a2e">';
          html += '<span style="display:inline-block;min-width:22px;text-align:center;padding:1px 4px;border-radius:3px;font-size:10px;font-weight:bold;background:' + badgeColor + '22;color:' + badgeColor + ';border:1px solid ' + badgeColor + '44">' + esc(badge) + '</span>';
          html += '<span style="flex:1;color:#ccc;cursor:pointer" onclick="window.devtools.gitDiff(\'' + esc(f.file).replace(/'/g, "\\'") + '\')">' + esc(f.file) + '</span>';
          html += '</div>';
        }
        html += '</div>';
      } else {
        html += '<div style="color:#0f0;font-size:12px">✓ Working tree clean</div>';
      }
      html += '</div>';

      // Commit form
      html += '<div class="card" style="margin-bottom:12px"><h3 style="margin:0 0 8px;color:var(--accent);font-size:13px">💾 Commit</h3>';
      html += '<div style="display:flex;gap:8px">';
      html += '<input id="gitCommitMsg" placeholder="Commit message..." style="flex:1;background:#111;color:#ccc;border:1px solid #333;border-radius:6px;padding:8px;font-size:12px" />';
      html += '<button class="btn-primary" onclick="window.devtools.gitCommit()">Commit All</button>';
      html += '</div></div>';

      // Log timeline
      html += '<div class="card"><h3 style="margin:0 0 8px;color:var(--accent);font-size:13px">📜 Recent Commits</h3>';
      html += '<div style="max-height:300px;overflow-y:auto">';
      var commits = log.commits || [];
      for (var ci = 0; ci < commits.length; ci++) {
        var c = commits[ci];
        html += '<div style="display:flex;gap:8px;padding:4px 0;font-size:12px;font-family:monospace;border-bottom:1px solid #1a1a2e">';
        html += '<span style="color:#ff0;min-width:60px">' + esc(c.hash) + '</span>';
        html += '<span style="color:#888;min-width:75px;font-size:11px">' + esc(c.date) + '</span>';
        html += '<span style="color:#ccc;flex:1">' + esc(c.message) + '</span>';
        html += '<span style="color:#555;font-size:11px">' + esc(c.author) + '</span>';
        html += '</div>';
      }
      if (!commits.length) html += '<div style="color:#555;font-size:12px">No commits found</div>';
      html += '</div></div>';

      // Diff viewer
      html += '<div id="gitDiffViewer" class="card" style="display:none;margin-top:12px"><h3 id="gitDiffTitle" style="margin:0 0 8px;color:var(--accent);font-size:13px">Diff</h3>';
      html += '<pre id="gitDiffContent" style="max-height:400px;overflow:auto;font-size:11px;line-height:1.5;margin:0"></pre></div>';

      el.innerHTML = html;
    }).catch(function(e) { el.innerHTML = '<div style="color:#f44;padding:20px">' + esc(e.message) + '</div>'; });
  }

  function gitCheckout(branch) {
    api('POST', 'git/checkout', { branch: branch }).then(function(d) {
      if (d.error) toast(d.error, 'error'); else { toast('Switched to ' + branch, 'success'); loadGitPanel(); }
    });
  }
  function gitCreateBranch() {
    var name = document.getElementById('gitNewBranch'); if (!name || !name.value.trim()) return;
    api('POST', 'git/checkout', { branch: name.value.trim(), create: true }).then(function(d) {
      if (d.error) toast(d.error, 'error'); else { toast('Created ' + name.value, 'success'); loadGitPanel(); }
    });
  }
  function gitPull() { api('POST', 'git/pull').then(function(d) { toast(d.output || d.error || 'Pull complete', d.error ? 'error' : 'success'); loadGitPanel(); }); }
  function gitPush() { api('POST', 'git/push').then(function(d) { toast(d.output || d.error || 'Push complete', d.error ? 'error' : 'success'); }); }
  function gitCommit() {
    var msg = document.getElementById('gitCommitMsg'); if (!msg || !msg.value.trim()) { toast('Enter commit message', 'error'); return; }
    api('POST', 'git/commit', { message: msg.value.trim() }).then(function(d) {
      if (d.error) toast(d.error, 'error'); else { toast('Committed!', 'success'); msg.value = ''; loadGitPanel(); }
    });
  }
  function gitDiff(file) {
    var viewer = document.getElementById('gitDiffViewer');
    var title = document.getElementById('gitDiffTitle');
    var content = document.getElementById('gitDiffContent');
    if (!viewer) return;
    viewer.style.display = 'block';
    title.textContent = 'Diff: ' + file;
    content.innerHTML = '<span style="color:#555">Loading...</span>';
    api('GET', 'git/diff?file=' + encodeURIComponent(file)).then(function(d) {
      var lines = (d.diff || 'No changes').split('\n');
      var html = '';
      for (var i = 0; i < lines.length; i++) {
        var l = lines[i];
        var color = l.charAt(0) === '+' ? '#0f0' : l.charAt(0) === '-' ? '#f44' : l.substring(0,2) === '@@' ? '#0ff' : '#888';
        html += '<div style="color:' + color + '">' + esc(l) + '</div>';
      }
      content.innerHTML = html;
    });
  }

  // ══════════════════════════════════════════
  //  2. DATABASE VIEWER
  // ══════════════════════════════════════════
  function loadDataViewer() {
    var el = document.getElementById('dataViewerContent');
    if (!el) return;
    el.innerHTML = '<div style="text-align:center;padding:40px;color:#555">Loading data files...</div>';
    api('GET', 'data/files').then(function(d) {
      var files = d.files || [];
      var html = '<div style="display:flex;gap:12px;height:calc(100vh - 200px);min-height:400px">';
      // Left: file tree
      html += '<div style="min-width:200px;max-width:250px;border-right:1px solid #1a1a2e;padding-right:12px;overflow-y:auto">';
      html += '<div style="margin-bottom:8px"><input id="dataSearch" placeholder="Search files..." oninput="window.devtools.dataSearchFilter()" style="width:100%;background:#111;color:#ccc;border:1px solid #333;border-radius:6px;padding:6px;font-size:12px" /></div>';
      for (var i = 0; i < files.length; i++) {
        var fname = files[i];
        var icon = fname.endsWith('.json') ? '📄' : '📁';
        html += '<div class="data-file-item" data-file="' + esc(fname) + '" onclick="window.devtools.openDataFile(\'' + esc(fname).replace(/'/g, "\\'") + '\')" style="padding:5px 8px;cursor:pointer;font-size:12px;border-radius:4px;color:#aaa;display:flex;align-items:center;gap:6px;transition:background .15s"';
        html += ' onmouseover="this.style.background=\'#1a1a2e\'" onmouseout="this.style.background=\'transparent\'">';
        html += icon + ' ' + esc(fname) + '</div>';
      }
      if (!files.length) html += '<div style="color:#555;font-size:12px">No data files</div>';
      html += '</div>';
      // Right: viewer
      html += '<div id="dataFileViewer" style="flex:1;overflow:auto;padding-left:12px">';
      html += '<div style="color:#555;font-size:13px;padding:40px;text-align:center">← Select a file to view</div>';
      html += '</div></div>';
      el.innerHTML = html;
    }).catch(function(e) { el.innerHTML = '<div style="color:#f44;padding:20px">' + esc(e.message) + '</div>'; });
  }

  function dataSearchFilter() {
    var q = (document.getElementById('dataSearch').value || '').toLowerCase();
    var items = document.querySelectorAll('.data-file-item');
    for (var i = 0; i < items.length; i++) {
      items[i].style.display = items[i].getAttribute('data-file').toLowerCase().indexOf(q) >= 0 ? '' : 'none';
    }
  }

  function openDataFile(fname) {
    var viewer = document.getElementById('dataFileViewer');
    if (!viewer) return;
    viewer.innerHTML = '<div style="text-align:center;padding:20px;color:#555">Loading...</div>';
    api('GET', 'data/file/' + encodeURIComponent(fname)).then(function(d) {
      var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
      html += '<h3 style="margin:0;color:var(--accent);font-size:14px">📄 ' + esc(fname) + '</h3>';
      html += '<div style="display:flex;gap:6px">';
      html += '<button class="btn-sm" onclick="window.devtools.editDataFile(\'' + esc(fname).replace(/'/g, "\\'") + '\')">✏️ Edit Raw</button>';
      html += '</div></div>';
      html += '<div id="dataJsonView" style="font-family:monospace;font-size:12px;line-height:1.6;max-height:calc(100vh - 260px);overflow:auto">';
      html += renderJsonSyntax(d.content, fname, '');
      html += '</div>';
      viewer.innerHTML = html;
    }).catch(function(e) { viewer.innerHTML = '<div style="color:#f44">' + esc(e.message) + '</div>'; });
  }

  function renderJsonSyntax(val, file, keyPath) {
    if (val === null) return '<span style="color:#f0f">null</span>';
    if (typeof val === 'boolean') return '<span style="color:#ff6b6b">' + val + '</span>';
    if (typeof val === 'number') return '<span style="color:#ffd43b">' + val + '</span>';
    if (typeof val === 'string') return '<span style="color:#69db7c">"' + esc(val.length > 200 ? val.substring(0,200) + '...' : val) + '"</span>';
    if (Array.isArray(val)) {
      if (val.length === 0) return '<span style="color:#555">[]</span>';
      var html = '<span style="color:#555">[</span> <span style="color:#444;font-size:10px">' + val.length + ' items</span><div style="padding-left:16px;border-left:1px solid #1a1a2e">';
      for (var i = 0; i < Math.min(val.length, 100); i++) {
        var kp = keyPath + '[' + i + ']';
        html += '<div><span style="color:#555">' + i + ':</span> ' + renderJsonSyntax(val[i], file, kp);
        html += ' <span class="data-del-btn" onclick="window.devtools.deleteDataEntry(\'' + esc(file).replace(/'/g, "\\'") + '\',\'' + esc(kp).replace(/'/g, "\\'") + '\')" style="color:#f44;cursor:pointer;font-size:10px;opacity:0.3;margin-left:4px" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.3">✕</span></div>';
      }
      if (val.length > 100) html += '<div style="color:#555">...and ' + (val.length - 100) + ' more</div>';
      html += '</div><span style="color:#555">]</span>';
      return html;
    }
    if (typeof val === 'object') {
      var keys = Object.keys(val);
      if (keys.length === 0) return '<span style="color:#555">{}</span>';
      var html = '<span style="color:#555">{</span> <span style="color:#444;font-size:10px">' + keys.length + ' keys</span><div style="padding-left:16px;border-left:1px solid #1a1a2e">';
      for (var ki = 0; ki < keys.length; ki++) {
        var k = keys[ki];
        var kp = keyPath ? keyPath + '.' + k : k;
        html += '<div><span style="color:#74c0fc">"' + esc(k) + '"</span>: ' + renderJsonSyntax(val[k], file, kp);
        html += ' <span class="data-del-btn" onclick="window.devtools.deleteDataEntry(\'' + esc(file).replace(/'/g, "\\'") + '\',\'' + esc(kp).replace(/'/g, "\\'") + '\')" style="color:#f44;cursor:pointer;font-size:10px;opacity:0.3;margin-left:4px" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.3">✕</span></div>';
      }
      html += '</div><span style="color:#555">}</span>';
      return html;
    }
    return esc(String(val));
  }

  function editDataFile(fname) {
    var viewer = document.getElementById('dataFileViewer');
    if (!viewer) return;
    api('GET', 'data/file/' + encodeURIComponent(fname)).then(function(d) {
      var raw = JSON.stringify(d.content, null, 2);
      var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
      html += '<h3 style="margin:0;color:var(--accent);font-size:14px">✏️ Editing: ' + esc(fname) + '</h3>';
      html += '<div style="display:flex;gap:6px">';
      html += '<button class="btn-primary" onclick="window.devtools.saveDataFile(\'' + esc(fname).replace(/'/g, "\\'") + '\')">💾 Save</button>';
      html += '<button class="btn-sm" onclick="window.devtools.openDataFile(\'' + esc(fname).replace(/'/g, "\\'") + '\')">Cancel</button>';
      html += '</div></div>';
      html += '<div id="dataEditError" style="color:#f44;font-size:12px;margin-bottom:4px;display:none"></div>';
      html += '<textarea id="dataEditArea" style="width:100%;height:calc(100vh - 280px);background:#0a0a0f;color:#ccc;border:1px solid #333;border-radius:6px;padding:10px;font-family:monospace;font-size:12px;resize:none;tab-size:2">' + esc(raw) + '</textarea>';
      viewer.innerHTML = html;
      // Tab key support
      var ta = document.getElementById('dataEditArea');
      ta.addEventListener('keydown', function(e) {
        if (e.key === 'Tab') { e.preventDefault(); var s = ta.selectionStart, end = ta.selectionEnd; ta.value = ta.value.substring(0, s) + '  ' + ta.value.substring(end); ta.selectionStart = ta.selectionEnd = s + 2; }
      });
    });
  }

  function saveDataFile(fname) {
    var ta = document.getElementById('dataEditArea');
    var errEl = document.getElementById('dataEditError');
    if (!ta) return;
    try { var parsed = JSON.parse(ta.value); } catch (e) { if (errEl) { errEl.textContent = 'JSON Error: ' + e.message; errEl.style.display = 'block'; } return; }
    api('PUT', 'data/file/' + encodeURIComponent(fname), { content: parsed }).then(function(d) {
      if (d.error) toast(d.error, 'error'); else { toast('Saved ' + fname, 'success'); openDataFile(fname); }
    });
  }

  function deleteDataEntry(fname, keyPath) {
    if (!confirm('Delete "' + keyPath + '" from ' + fname + '?')) return;
    api('DELETE', 'data/entry/' + encodeURIComponent(fname) + '/' + encodeURIComponent(keyPath)).then(function(d) {
      if (d.error) toast(d.error, 'error'); else { toast('Deleted ' + keyPath, 'success'); openDataFile(fname); }
    });
  }

  // ══════════════════════════════════════════
  //  3. API PLAYGROUND
  // ══════════════════════════════════════════
  function loadPlayground() {
    var el = document.getElementById('playgroundContent');
    if (!el) return;
    // Load saved favorites
    var favs = [];
    try { favs = JSON.parse(localStorage.getItem('aries-playground-favs') || '[]'); } catch(e) {}

    api('GET', 'playground/endpoints').then(function(d) {
      var endpoints = d.endpoints || [];
      var html = '<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px">';
      html += '<div><label style="color:#888;font-size:11px;display:block;margin-bottom:2px">Method</label>';
      html += '<select id="pgMethod" style="background:#111;color:var(--accent);border:1px solid #333;border-radius:6px;padding:8px;font-size:13px;font-weight:bold">';
      html += '<option value="GET" style="color:#0f0">GET</option><option value="POST" style="color:#ff0">POST</option><option value="PUT" style="color:#0af">PUT</option><option value="DELETE" style="color:#f44">DELETE</option>';
      html += '</select></div>';
      html += '<div style="flex:1;min-width:200px"><label style="color:#888;font-size:11px;display:block;margin-bottom:2px">URL</label>';
      html += '<input id="pgUrl" value="http://localhost:3333/api/" style="width:100%;background:#111;color:#ccc;border:1px solid #333;border-radius:6px;padding:8px;font-size:13px;font-family:monospace" /></div>';
      html += '<button class="btn-primary" onclick="window.devtools.pgSend()" style="padding:8px 20px;font-size:13px">▶ Send</button>';
      html += '<button class="btn-sm" onclick="window.devtools.pgSaveFav()" title="Save as favorite">⭐</button>';
      html += '</div>';

      // Endpoint picker
      html += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">';
      for (var i = 0; i < endpoints.length; i++) {
        var ep = endpoints[i];
        var mc = ep.method === 'GET' ? '#0f0' : ep.method === 'POST' ? '#ff0' : ep.method === 'DELETE' ? '#f44' : '#0af';
        html += '<button class="btn-sm" onclick="document.getElementById(\'pgMethod\').value=\'' + ep.method + '\';document.getElementById(\'pgUrl\').value=\'http://localhost:3333' + esc(ep.path) + '\'" style="font-size:10px" title="' + esc(ep.desc || '') + '">';
        html += '<span style="color:' + mc + ';font-weight:bold">' + ep.method + '</span> ' + esc(ep.path) + '</button>';
      }
      html += '</div>';

      // Favorites
      if (favs.length) {
        html += '<div style="margin-bottom:8px"><span style="color:#888;font-size:11px">⭐ Favorites:</span> ';
        for (var fi = 0; fi < favs.length; fi++) {
          html += '<button class="btn-sm" onclick="window.devtools.pgLoadFav(' + fi + ')" style="font-size:10px">' + esc(favs[fi].method) + ' ' + esc(favs[fi].path) + '</button> ';
        }
        html += '<button class="btn-sm" onclick="window.devtools.pgClearFavs()" style="font-size:10px;color:#f44">Clear</button></div>';
      }

      // Body editor
      html += '<div style="margin-bottom:8px"><label style="color:#888;font-size:11px">Request Body (JSON)</label>';
      html += '<textarea id="pgBody" style="width:100%;height:100px;background:#0a0a0f;color:#ccc;border:1px solid #333;border-radius:6px;padding:8px;font-family:monospace;font-size:12px;resize:vertical" placeholder=\'{"key": "value"}\'></textarea></div>';

      // Response
      html += '<div id="pgResponse" class="card" style="display:none">';
      html += '<div style="display:flex;justify-content:space-between;margin-bottom:8px">';
      html += '<span id="pgStatus" style="font-weight:bold;font-size:13px"></span>';
      html += '<span id="pgTiming" style="color:#888;font-size:12px"></span>';
      html += '</div>';
      html += '<pre id="pgResponseBody" style="max-height:400px;overflow:auto;font-size:12px;line-height:1.5;margin:0;color:#ccc"></pre>';
      html += '</div>';

      el.innerHTML = html;
    }).catch(function(e) { el.innerHTML = '<div style="color:#f44;padding:20px">' + esc(e.message) + '</div>'; });
  }

  function pgSend() {
    var method = document.getElementById('pgMethod').value;
    var urlStr = document.getElementById('pgUrl').value;
    var bodyStr = document.getElementById('pgBody').value.trim();
    var respDiv = document.getElementById('pgResponse');
    var statusEl = document.getElementById('pgStatus');
    var timingEl = document.getElementById('pgTiming');
    var bodyEl = document.getElementById('pgResponseBody');
    respDiv.style.display = 'block';
    statusEl.innerHTML = '<span style="color:#ff0">⏳ Sending...</span>';
    bodyEl.textContent = '';
    timingEl.textContent = '';

    var opts = { method: method, headers: authHeaders() };
    if (bodyStr && method !== 'GET') {
      try { JSON.parse(bodyStr); opts.body = bodyStr; } catch(e) { statusEl.innerHTML = '<span style="color:#f44">Invalid JSON: ' + esc(e.message) + '</span>'; return; }
    }

    var t0 = performance.now();
    fetch(urlStr, opts).then(function(r) {
      var elapsed = Math.round(performance.now() - t0);
      var sc = r.status;
      var color = sc < 300 ? '#0f0' : sc < 400 ? '#ff0' : '#f44';
      statusEl.innerHTML = '<span style="color:' + color + '">' + sc + ' ' + r.statusText + '</span>';
      timingEl.textContent = elapsed + 'ms';
      return r.text().then(function(text) {
        try { var j = JSON.parse(text); bodyEl.innerHTML = renderJsonSyntax(j, '', ''); } catch(e) { bodyEl.textContent = text; }
      });
    }).catch(function(e) {
      statusEl.innerHTML = '<span style="color:#f44">Error: ' + esc(e.message) + '</span>';
    });
  }

  function pgSaveFav() {
    var method = document.getElementById('pgMethod').value;
    var urlStr = document.getElementById('pgUrl').value;
    var path = urlStr.replace(/^https?:\/\/[^/]+/, '');
    var favs = [];
    try { favs = JSON.parse(localStorage.getItem('aries-playground-favs') || '[]'); } catch(e) {}
    favs.push({ method: method, path: path, body: document.getElementById('pgBody').value });
    localStorage.setItem('aries-playground-favs', JSON.stringify(favs));
    toast('Saved favorite', 'success');
    loadPlayground();
  }
  function pgLoadFav(idx) {
    var favs = [];
    try { favs = JSON.parse(localStorage.getItem('aries-playground-favs') || '[]'); } catch(e) {}
    if (!favs[idx]) return;
    document.getElementById('pgMethod').value = favs[idx].method;
    document.getElementById('pgUrl').value = 'http://localhost:3333' + favs[idx].path;
    if (favs[idx].body) document.getElementById('pgBody').value = favs[idx].body;
  }
  function pgClearFavs() { localStorage.removeItem('aries-playground-favs'); loadPlayground(); }

  // ══════════════════════════════════════════
  //  4. PLUGIN IDE
  // ══════════════════════════════════════════
  var _currentPlugin = null;

  function loadPluginIDE() {
    var el = document.getElementById('pluginIDEContent');
    if (!el) return;
    el.innerHTML = '<div style="text-align:center;padding:40px;color:#555">Loading plugins...</div>';
    api('GET', 'plugins/files').then(function(d) {
      var files = d.files || [];
      var html = '<div style="display:flex;gap:12px;height:calc(100vh - 200px);min-height:400px">';
      // Left: file browser
      html += '<div style="min-width:180px;max-width:220px;border-right:1px solid #1a1a2e;padding-right:12px;overflow-y:auto">';
      html += '<button class="btn-sm" onclick="window.devtools.newPlugin()" style="width:100%;margin-bottom:8px;color:#0f0">+ New Plugin</button>';
      html += '<button class="btn-sm" onclick="window.devtools.reloadPlugins()" style="width:100%;margin-bottom:12px;color:#ff0">↻ Reload All</button>';
      for (var i = 0; i < files.length; i++) {
        html += '<div onclick="window.devtools.openPlugin(\'' + esc(files[i]).replace(/'/g, "\\'") + '\')" style="padding:5px 8px;cursor:pointer;font-size:12px;color:#aaa;border-radius:4px;font-family:monospace;transition:background .15s"';
        html += ' onmouseover="this.style.background=\'#1a1a2e\'" onmouseout="this.style.background=\'transparent\'">📦 ' + esc(files[i]) + '</div>';
      }
      if (!files.length) html += '<div style="color:#555;font-size:12px">No plugins</div>';
      html += '</div>';
      // Right: editor
      html += '<div id="pluginEditor" style="flex:1;display:flex;flex-direction:column;overflow:hidden">';
      html += '<div style="color:#555;font-size:13px;padding:40px;text-align:center">← Select or create a plugin</div>';
      html += '</div></div>';
      el.innerHTML = html;
    }).catch(function(e) { el.innerHTML = '<div style="color:#f44;padding:20px">' + esc(e.message) + '</div>'; });
  }

  function openPlugin(name) {
    _currentPlugin = name;
    var editor = document.getElementById('pluginEditor');
    if (!editor) return;
    editor.innerHTML = '<div style="text-align:center;padding:20px;color:#555">Loading...</div>';
    api('GET', 'plugins/file/' + encodeURIComponent(name)).then(function(d) {
      var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
      html += '<span style="color:var(--accent);font-weight:bold;font-size:13px">📦 ' + esc(name) + '</span>';
      html += '<div style="display:flex;gap:6px">';
      html += '<button class="btn-primary" onclick="window.devtools.savePlugin()">💾 Save</button>';
      html += '<button class="btn-sm" onclick="window.devtools.reloadPlugins()">↻ Reload</button>';
      html += '</div></div>';
      html += '<div id="pluginSyntaxErr" style="color:#f44;font-size:12px;margin-bottom:4px;display:none;padding:4px 8px;background:#1a0000;border-radius:4px"></div>';
      html += '<div style="position:relative;flex:1;display:flex;overflow:hidden">';
      html += '<div id="pluginLineNums" style="min-width:36px;padding:10px 4px;text-align:right;color:#444;font-family:monospace;font-size:12px;line-height:1.5;background:#0a0a0a;border-right:1px solid #1a1a2e;overflow:hidden;user-select:none"></div>';
      html += '<textarea id="pluginCode" style="flex:1;background:#0a0a0f;color:#ccc;border:none;padding:10px;font-family:monospace;font-size:12px;line-height:1.5;resize:none;outline:none;tab-size:2" spellcheck="false">' + esc(d.content || '') + '</textarea>';
      html += '</div>';
      editor.innerHTML = html;

      var code = document.getElementById('pluginCode');
      var lineNums = document.getElementById('pluginLineNums');
      function updateLineNums() {
        var lines = code.value.split('\n').length;
        var nums = '';
        for (var i = 1; i <= lines; i++) nums += i + '\n';
        lineNums.textContent = nums;
      }
      code.addEventListener('input', updateLineNums);
      code.addEventListener('scroll', function() { lineNums.scrollTop = code.scrollTop; });
      code.addEventListener('keydown', function(e) {
        if (e.key === 'Tab') {
          e.preventDefault();
          var s = code.selectionStart, end = code.selectionEnd;
          code.value = code.value.substring(0, s) + '  ' + code.value.substring(end);
          code.selectionStart = code.selectionEnd = s + 2;
        }
      });
      updateLineNums();
    });
  }

  function savePlugin() {
    if (!_currentPlugin) return;
    var code = document.getElementById('pluginCode');
    var errEl = document.getElementById('pluginSyntaxErr');
    if (!code) return;
    // Basic syntax check
    try { new Function(code.value); if (errEl) errEl.style.display = 'none'; } catch(e) {
      if (errEl) { errEl.textContent = '⚠ Syntax: ' + e.message; errEl.style.display = 'block'; }
    }
    api('PUT', 'plugins/file/' + encodeURIComponent(_currentPlugin), { content: code.value }).then(function(d) {
      if (d.error) toast(d.error, 'error'); else toast('Saved ' + _currentPlugin, 'success');
    });
  }

  function newPlugin() {
    var name = prompt('Plugin filename (e.g. my-plugin.js):');
    if (!name) return;
    if (!name.endsWith('.js')) name += '.js';
    var template = "/**\n * " + name + " — Aries Plugin\n */\nmodule.exports = {\n  name: '" + name.replace('.js', '') + "',\n  version: '1.0.0',\n  init(api) {\n    console.log('[PLUGIN] " + name.replace('.js', '') + " loaded');\n  },\n  destroy() {\n    console.log('[PLUGIN] " + name.replace('.js', '') + " unloaded');\n  }\n};\n";
    api('PUT', 'plugins/file/' + encodeURIComponent(name), { content: template }).then(function(d) {
      if (d.error) toast(d.error, 'error'); else { toast('Created ' + name, 'success'); loadPluginIDE(); setTimeout(function() { openPlugin(name); }, 300); }
    });
  }

  function reloadPlugins() {
    api('POST', 'plugins/reload').then(function(d) {
      toast(d.error || 'Plugins reloaded!', d.error ? 'error' : 'success');
    });
  }

  // ══════════════════════════════════════════
  //  5. LOG STREAMING
  // ══════════════════════════════════════════
  var _logWs = null;
  var _logEntries = [];
  var _logAutoScroll = true;
  var _logMaxEntries = 1000;

  function loadLogStream() {
    var el = document.getElementById('logStreamContent');
    if (!el) return;
    var html = '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap">';
    html += '<select id="lsLevel" onchange="window.devtools.filterLogs()" style="background:#111;color:var(--accent);border:1px solid #333;border-radius:6px;padding:4px 8px;font-size:12px">';
    html += '<option value="">All Levels</option><option value="DEBUG">DEBUG</option><option value="INFO">INFO</option><option value="WARN">WARN</option><option value="ERROR">ERROR</option></select>';
    html += '<select id="lsSource" onchange="window.devtools.filterLogs()" style="background:#111;color:var(--accent);border:1px solid #333;border-radius:6px;padding:4px 8px;font-size:12px">';
    html += '<option value="">All Sources</option><option value="agent">Agent</option><option value="system">System</option><option value="api">API</option></select>';
    html += '<input id="lsSearch" placeholder="Search logs..." oninput="window.devtools.filterLogs()" style="flex:1;min-width:120px;background:#111;color:#ccc;border:1px solid #333;border-radius:6px;padding:4px 8px;font-size:12px" />';
    html += '<span id="lsLive" style="color:#0f0;font-size:11px;font-weight:bold">● LIVE</span>';
    html += '<button class="btn-sm" onclick="window.devtools.clearLogs()">🗑 Clear</button>';
    html += '<button class="btn-sm" onclick="window.devtools.exportLogs()">📥 Export</button>';
    html += '</div>';
    html += '<div id="lsEntries" style="height:calc(100vh - 220px);min-height:300px;overflow-y:auto;background:#0a0a0a;border:1px solid #1a1a2e;border-radius:6px;padding:8px;font-family:monospace;font-size:11px;line-height:1.6"></div>';
    el.innerHTML = html;

    // Connect WebSocket for live logs
    connectLogWs();
    // Load recent
    api('GET', 'logs?limit=200').then(function(d) {
      var entries = d.entries || [];
      for (var i = 0; i < entries.length; i++) _logEntries.push(entries[i]);
      while (_logEntries.length > _logMaxEntries) _logEntries.shift();
      renderLogs();
    });

    // Scroll detection
    var lsEl = document.getElementById('lsEntries');
    if (lsEl) {
      lsEl.addEventListener('scroll', function() {
        _logAutoScroll = (lsEl.scrollTop + lsEl.clientHeight >= lsEl.scrollHeight - 30);
        var live = document.getElementById('lsLive');
        if (live) { live.textContent = _logAutoScroll ? '● LIVE' : '⏸ PAUSED'; live.style.color = _logAutoScroll ? '#0f0' : '#ff0'; }
      });
    }
  }

  function connectLogWs() {
    if (_logWs) try { _logWs.close(); } catch(e) {}
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    _logWs = new WebSocket(proto + '//' + location.host + '/ws');
    _logWs.onmessage = function(e) {
      try {
        var msg = JSON.parse(e.data);
        if (msg.type === 'log') {
          _logEntries.push(msg);
          while (_logEntries.length > _logMaxEntries) _logEntries.shift();
          renderLogs();
        }
      } catch(err) {}
    };
    _logWs.onclose = function() { setTimeout(connectLogWs, 3000); };
  }

  function renderLogs() {
    var el = document.getElementById('lsEntries');
    if (!el) return;
    var level = (document.getElementById('lsLevel') || {}).value || '';
    var source = (document.getElementById('lsSource') || {}).value || '';
    var search = ((document.getElementById('lsSearch') || {}).value || '').toLowerCase();
    var html = '';
    for (var i = 0; i < _logEntries.length; i++) {
      var e = _logEntries[i];
      var lv = (e.level || 'info').toUpperCase();
      var mod = (e.module || e.source || 'system').toLowerCase();
      if (level && lv !== level) continue;
      if (source && mod.indexOf(source) < 0) continue;
      var msg = e.message || e.msg || JSON.stringify(e);
      if (search && msg.toLowerCase().indexOf(search) < 0 && mod.indexOf(search) < 0) continue;
      var time = e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : '';
      var lvColor = lv === 'ERROR' ? '#f44' : lv === 'WARN' ? '#ff0' : lv === 'DEBUG' ? '#888' : '#0f0';
      html += '<div style="border-bottom:1px solid #111;padding:1px 0"><span style="color:#555">' + time + '</span> <span style="color:' + lvColor + ';font-weight:bold;min-width:50px;display:inline-block">[' + lv + ']</span> <span style="color:#0af">[' + esc(e.module || e.source || 'sys') + ']</span> <span style="color:#ccc">' + esc(msg) + '</span></div>';
    }
    el.innerHTML = html || '<div style="color:#555;padding:20px;text-align:center">No log entries</div>';
    if (_logAutoScroll) el.scrollTop = el.scrollHeight;
  }

  function filterLogs() { renderLogs(); }
  function clearLogs() { _logEntries = []; renderLogs(); api('DELETE', 'logs'); }
  function exportLogs() {
    var text = _logEntries.map(function(e) {
      return (e.timestamp ? new Date(e.timestamp).toISOString() : '') + ' [' + (e.level || 'INFO').toUpperCase() + '] [' + (e.module || 'sys') + '] ' + (e.message || e.msg || '');
    }).join('\n');
    var blob = new Blob([text], { type: 'text/plain' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'aries-logs-' + new Date().toISOString().substring(0, 10) + '.txt';
    a.click();
  }

  // ══════════════════════════════════════════
  //  EXPOSE TO WINDOW
  // ══════════════════════════════════════════
  window.devtools = {
    loadGitPanel: loadGitPanel, gitCheckout: gitCheckout, gitCreateBranch: gitCreateBranch,
    gitPull: gitPull, gitPush: gitPush, gitCommit: gitCommit, gitDiff: gitDiff,
    loadDataViewer: loadDataViewer, dataSearchFilter: dataSearchFilter, openDataFile: openDataFile,
    editDataFile: editDataFile, saveDataFile: saveDataFile, deleteDataEntry: deleteDataEntry,
    loadPlayground: loadPlayground, pgSend: pgSend, pgSaveFav: pgSaveFav, pgLoadFav: pgLoadFav, pgClearFavs: pgClearFavs,
    loadPluginIDE: loadPluginIDE, openPlugin: openPlugin, savePlugin: savePlugin, newPlugin: newPlugin, reloadPlugins: reloadPlugins,
    loadLogStream: loadLogStream, filterLogs: filterLogs, clearLogs: clearLogs, exportLogs: exportLogs
  };
})();
