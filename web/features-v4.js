/**
 * ARIES v8.1 — Features V4: Reality Anchoring, Cognitive Architectures, Swarm Intelligence
 */
(function() {
  'use strict';
  var API_KEY = 'aries-api-2026';
  function authHeaders() {
    return { 'Content-Type': 'application/json', 'x-aries-key': API_KEY, 'Authorization': 'Bearer ' + (localStorage.getItem('aries-auth-token') || '') };
  }
  function api4(method, path, body) {
    var opts = { method: method, headers: authHeaders() };
    if (body) opts.body = JSON.stringify(body);
    return fetch(path, opts).then(function(r) { return r.json(); });
  }

  // ═══════════════════════════════════════════════════════════════════
  // 1. REALITY ANCHORING — Confidence badges on chat messages
  // ═══════════════════════════════════════════════════════════════════
  var _anchorConfig = null;

  function initRealityAnchor() {
    api4('GET', '/api/anchor/config').then(function(cfg) { _anchorConfig = cfg; }).catch(function(){});
  }

  // Annotate a chat message bubble with verification badges
  window._annotateWithAnchoring = function(text, bubbleEl) {
    if (!_anchorConfig || !_anchorConfig.enabled) return;
    api4('POST', '/api/anchor/verify', { text: text }).then(function(result) {
      if (!result.anchored || !result.results || result.results.length === 0) return;
      var bar = document.createElement('div');
      bar.className = 'anchor-bar';
      bar.style.cssText = 'display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;';
      result.results.forEach(function(r) {
        var badge = document.createElement('span');
        badge.className = 'anchor-badge anchor-' + r.status;
        badge.textContent = r.badge;
        badge.title = r.type + ': ' + r.detail + '\nClaim: ' + (r.claim || '').substring(0, 120);
        badge.style.cssText = 'cursor:help;font-size:14px;padding:2px 6px;border-radius:8px;background:rgba(0,255,247,0.08);border:1px solid ' +
          (r.status === 'verified' ? '#0f0' : r.status === 'outdated' ? '#f44' : '#fa0') + ';';
        bar.appendChild(badge);
      });
      // Confidence
      var conf = document.createElement('span');
      conf.style.cssText = 'font-size:10px;color:#888;align-self:center;margin-left:auto;';
      conf.textContent = Math.round((result.confidence || 0) * 100) + '% verified';
      bar.appendChild(conf);
      bubbleEl.appendChild(bar);
    }).catch(function(){});
  };

  // ═══════════════════════════════════════════════════════════════════
  // 2. COGNITIVE ARCHITECTURES — Architecture selector per agent
  // ═══════════════════════════════════════════════════════════════════
  var _allArchitectures = {};
  var _cogAssignments = {};

  function loadArchitectures() {
    api4('GET', '/api/cognitive/architectures').then(function(a) { _allArchitectures = a; }).catch(function(){});
    api4('GET', '/api/cognitive/assignments').then(function(a) { _cogAssignments = a; }).catch(function(){});
  }

  window._getCognitiveArchitectures = function() { return _allArchitectures; };
  window._getCognitiveAssignments = function() { return _cogAssignments; };

  window._renderCognitiveSelector = function(agentId, container) {
    var wrap = document.createElement('div');
    wrap.className = 'cog-arch-selector';
    wrap.style.cssText = 'margin:8px 0;';

    var label = document.createElement('span');
    label.textContent = '🧠 Thinking: ';
    label.style.cssText = 'font-size:11px;color:#0ff;margin-right:4px;';
    wrap.appendChild(label);

    var sel = document.createElement('select');
    sel.style.cssText = 'background:#111;color:#0ff;border:1px solid #333;border-radius:4px;padding:2px 6px;font-size:11px;';
    var opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = '— Default —';
    sel.appendChild(opt0);

    Object.keys(_allArchitectures).forEach(function(key) {
      var opt = document.createElement('option');
      opt.value = key;
      opt.textContent = _allArchitectures[key].name;
      if (_cogAssignments[agentId] && _cogAssignments[agentId].key === key) opt.selected = true;
      sel.appendChild(opt);
    });

    sel.onchange = function() {
      if (sel.value) {
        api4('POST', '/api/cognitive/apply', { agentId: agentId, architecture: sel.value }).then(function() { loadArchitectures(); });
      } else {
        api4('DELETE', '/api/cognitive/clear/' + agentId).then(function() { loadArchitectures(); });
      }
    };
    wrap.appendChild(sel);

    // Show active steps
    if (_cogAssignments[agentId]) {
      var stepsDiv = document.createElement('div');
      stepsDiv.style.cssText = 'display:flex;gap:4px;margin-top:4px;flex-wrap:wrap;';
      var a = _cogAssignments[agentId];
      (a.steps || []).forEach(function(step, i) {
        var s = document.createElement('span');
        s.textContent = step;
        s.style.cssText = 'font-size:10px;padding:1px 6px;border-radius:10px;border:1px solid ' + (i === (a.currentStep || 0) ? '#0ff' : '#333') + ';color:' + (i === (a.currentStep || 0) ? '#0ff' : '#666') + ';' + (i === (a.currentStep || 0) ? 'background:rgba(0,255,247,0.1);font-weight:bold;' : '');
        stepsDiv.appendChild(s);
      });
      wrap.appendChild(stepsDiv);
    }

    container.appendChild(wrap);
  };

  // Badge next to agent name
  window._getCogBadge = function(agentId) {
    var a = _cogAssignments[agentId];
    if (!a) return '';
    return ' 🧠' + (a.name || '');
  };

  // ═══════════════════════════════════════════════════════════════════
  // 3. SWARM INTELLIGENCE — Democratic decision-making panel
  // ═══════════════════════════════════════════════════════════════════
  window._renderSwarmIntelPanel = function(container) {
    container.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.style.cssText = 'padding:16px;';

    // Header
    var h = document.createElement('h2');
    h.style.cssText = 'color:#0ff;margin:0 0 16px 0;font-size:18px;';
    h.textContent = '🐝 Swarm Intelligence — Agent Democratic Decisions';
    wrap.appendChild(h);

    // Start form
    var form = document.createElement('div');
    form.style.cssText = 'background:#0a0a0a;border:1px solid #222;border-radius:8px;padding:12px;margin-bottom:16px;';
    form.innerHTML = '<div style="color:#0ff;font-size:13px;margin-bottom:8px;font-weight:600">Start New Decision</div>' +
      '<textarea id="swarmQuestion" placeholder="Pose a question for the swarm..." style="width:100%;height:60px;background:#111;color:#eee;border:1px solid #333;border-radius:4px;padding:8px;font-size:13px;resize:vertical;box-sizing:border-box;"></textarea>' +
      '<input id="swarmAgents" placeholder="Agent IDs (comma-separated)" style="width:100%;margin-top:6px;background:#111;color:#eee;border:1px solid #333;border-radius:4px;padding:6px 8px;font-size:12px;box-sizing:border-box;" />' +
      '<button id="swarmStartBtn" style="margin-top:8px;background:linear-gradient(135deg,#0ff,#08f);color:#000;border:none;padding:6px 18px;border-radius:4px;font-weight:600;cursor:pointer;">Launch Swarm Decision</button>';
    wrap.appendChild(form);

    // History
    var histDiv = document.createElement('div');
    histDiv.id = 'swarmHistory';
    histDiv.innerHTML = '<div style="color:#666;font-size:12px;">Loading history...</div>';
    wrap.appendChild(histDiv);

    container.appendChild(wrap);

    // Wire up
    setTimeout(function() {
      var btn = document.getElementById('swarmStartBtn');
      if (btn) btn.onclick = function() {
        var q = document.getElementById('swarmQuestion').value.trim();
        var agents = document.getElementById('swarmAgents').value.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
        if (!q) return;
        api4('POST', '/api/swarm-intel/start', { question: q, agents: agents }).then(function(s) {
          document.getElementById('swarmQuestion').value = '';
          loadSwarmHistory(histDiv);
        });
      };
      loadSwarmHistory(histDiv);
    }, 0);
  };

  function loadSwarmHistory(container) {
    api4('GET', '/api/swarm-intel/history').then(function(sessions) {
      container.innerHTML = '';
      if (!sessions || sessions.length === 0) {
        container.innerHTML = '<div style="color:#666;font-size:12px;text-align:center;padding:20px;">No swarm decisions yet</div>';
        return;
      }
      sessions.forEach(function(s) {
        var card = document.createElement('div');
        card.style.cssText = 'background:#0a0a0a;border:1px solid #222;border-radius:8px;padding:12px;margin-bottom:10px;cursor:pointer;transition:border-color 0.2s;';
        card.onmouseenter = function() { card.style.borderColor = '#0ff'; };
        card.onmouseleave = function() { card.style.borderColor = '#222'; };

        var statusColor = s.status === 'complete' ? '#0f0' : s.status === 'voting' ? '#fa0' : s.status === 'debating' ? '#08f' : '#666';
        card.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
          '<span style="color:#eee;font-size:13px;font-weight:600;">' + escH(s.question.substring(0, 80)) + '</span>' +
          '<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:' + statusColor + '22;color:' + statusColor + ';border:1px solid ' + statusColor + ';">' + s.status.toUpperCase() + '</span>' +
          '</div>';

        if (s.status === 'complete' && s.consensus) {
          // Pie chart + result
          var resultDiv = document.createElement('div');
          resultDiv.style.cssText = 'display:flex;gap:12px;align-items:center;';
          // Mini CSS pie
          var pieDiv = document.createElement('div');
          pieDiv.style.cssText = 'width:48px;height:48px;border-radius:50%;flex-shrink:0;' + buildPieGradient(s);
          resultDiv.appendChild(pieDiv);
          var info = document.createElement('div');
          info.innerHTML = '<div style="color:#0f0;font-size:12px;">Winner: ' + escH(s.consensus.winnerId) + '</div>' +
            '<div style="color:#aaa;font-size:11px;">' + escH((s.consensus.winnerAnswer || '').substring(0, 100)) + '</div>' +
            '<div style="color:#888;font-size:10px;">Confidence: ' + Math.round(s.confidence * 100) + '% | ' + s.agents.length + ' agents</div>';
          resultDiv.appendChild(info);
          card.appendChild(resultDiv);

          // Dissent
          if (s.dissent && s.dissent.length > 0) {
            var dissDiv = document.createElement('div');
            dissDiv.style.cssText = 'margin-top:6px;padding-top:6px;border-top:1px solid #222;';
            s.dissent.forEach(function(d) {
              dissDiv.innerHTML += '<div style="font-size:10px;color:#f80;">⚡ ' + escH(d.agentId) + ': ' + escH((d.answer || '').substring(0, 80)) + '</div>';
            });
            card.appendChild(dissDiv);
          }
        }

        // Debate view on click
        card.onclick = function() { showSwarmDetail(s.id); };
        container.appendChild(card);
      });
    }).catch(function() {
      container.innerHTML = '<div style="color:#f44;font-size:12px;">Failed to load history</div>';
    });
  }

  function showSwarmDetail(sessionId) {
    api4('GET', '/api/swarm-intel/' + sessionId).then(function(s) {
      if (!s || s.error) return;
      // Create modal
      var overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);z-index:10000;display:flex;align-items:center;justify-content:center;';
      overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };

      var modal = document.createElement('div');
      modal.style.cssText = 'background:#0a0a0a;border:1px solid #0ff;border-radius:12px;padding:20px;max-width:700px;width:90%;max-height:80vh;overflow-y:auto;';

      modal.innerHTML = '<div style="display:flex;justify-content:space-between;margin-bottom:12px;"><h3 style="color:#0ff;margin:0;">🐝 ' + escH(s.question) + '</h3><span onclick="this.closest(\'div[style*=fixed]\').remove()" style="cursor:pointer;color:#666;font-size:20px;">✕</span></div>';

      // Answers
      if (Object.keys(s.answers).length > 0) {
        modal.innerHTML += '<div style="color:#0ff;font-size:12px;margin:12px 0 6px;">Answers</div>';
        for (var aid in s.answers) {
          var a = s.answers[aid];
          modal.innerHTML += '<div style="background:#111;border:1px solid #222;border-radius:6px;padding:8px;margin-bottom:6px;"><div style="color:#08f;font-size:12px;font-weight:600;">🤖 ' + escH(aid) + '</div><div style="color:#eee;font-size:12px;margin-top:4px;">' + escH(a.answer) + '</div><div style="color:#888;font-size:10px;margin-top:2px;">' + escH(a.reasoning || '') + '</div></div>';
        }
      }

      // Debate
      if (s.debate.length > 0) {
        modal.innerHTML += '<div style="color:#0ff;font-size:12px;margin:12px 0 6px;">Debate</div>';
        s.debate.forEach(function(d) {
          modal.innerHTML += '<div style="background:#0a1520;border-left:3px solid #08f;padding:6px 10px;margin-bottom:4px;border-radius:0 6px 6px 0;"><span style="color:#08f;font-size:11px;font-weight:600;">' + escH(d.agentId) + '</span> <span style="color:#666;font-size:10px;">Round ' + (d.round + 1) + '</span><div style="color:#ccc;font-size:12px;margin-top:2px;">' + escH(d.message) + '</div></div>';
        });
      }

      // Votes + Pie
      if (s.status === 'complete' && s.consensus) {
        modal.innerHTML += '<div style="color:#0ff;font-size:12px;margin:12px 0 6px;">Results</div>' +
          '<div style="display:flex;gap:16px;align-items:center;">' +
          '<div style="width:80px;height:80px;border-radius:50%;' + buildPieGradient(s) + '"></div>' +
          '<div><div style="color:#0f0;font-size:14px;">🏆 ' + escH(s.consensus.winnerId) + '</div><div style="color:#eee;font-size:12px;">' + escH(s.consensus.winnerAnswer) + '</div><div style="color:#888;font-size:11px;">Confidence: ' + Math.round(s.confidence * 100) + '%</div></div></div>';
      }

      overlay.appendChild(modal);
      document.body.appendChild(overlay);
    });
  }

  function buildPieGradient(session) {
    var votes = {};
    for (var k in session.votes) votes[session.votes[k]] = (votes[session.votes[k]] || 0) + 1;
    var total = Object.values(votes).reduce(function(a, b) { return a + b; }, 0) || 1;
    var colors = ['#0ff', '#f0f', '#0f0', '#fa0', '#08f', '#f44', '#ff0'];
    var segments = [];
    var offset = 0;
    var i = 0;
    for (var agent in votes) {
      var pct = (votes[agent] / total) * 100;
      segments.push(colors[i % colors.length] + ' ' + offset + '% ' + (offset + pct) + '%');
      offset += pct;
      i++;
    }
    if (segments.length === 0) return 'background:#222;';
    return 'background:conic-gradient(' + segments.join(',') + ');';
  }

  function escH(s) {
    if (!s) return '';
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // ═══════════════════════════════════════════════════════════════════
  // Settings panel additions for Reality Anchor
  // ═══════════════════════════════════════════════════════════════════
  window._renderAnchorSettings = function(container) {
    api4('GET', '/api/anchor/config').then(function(cfg) {
      var div = document.createElement('div');
      div.style.cssText = 'background:#0a0a0a;border:1px solid #222;border-radius:8px;padding:12px;margin-top:12px;';
      div.innerHTML = '<div style="color:#0ff;font-size:13px;font-weight:600;margin-bottom:8px;">🔬 Reality Anchoring</div>';

      // Toggle
      var toggle = document.createElement('label');
      toggle.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;color:#aaa;';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = cfg.enabled;
      cb.onchange = function() { api4('PUT', '/api/anchor/config', { enabled: cb.checked }); };
      toggle.appendChild(cb);
      toggle.appendChild(document.createTextNode('Enable Reality Anchoring'));
      div.appendChild(toggle);

      // Depth
      var depthDiv = document.createElement('div');
      depthDiv.style.cssText = 'margin-top:8px;';
      depthDiv.innerHTML = '<span style="font-size:11px;color:#888;">Verification depth: </span>';
      var depSel = document.createElement('select');
      depSel.style.cssText = 'background:#111;color:#0ff;border:1px solid #333;border-radius:4px;padding:2px 6px;font-size:11px;';
      ['quick', 'thorough'].forEach(function(d) {
        var o = document.createElement('option');
        o.value = d; o.textContent = d; if (cfg.depth === d) o.selected = true;
        depSel.appendChild(o);
      });
      depSel.onchange = function() { api4('PUT', '/api/anchor/config', { depth: depSel.value }); };
      depthDiv.appendChild(depSel);
      div.appendChild(depthDiv);

      // Stats
      api4('GET', '/api/anchor/stats').then(function(stats) {
        var statDiv = document.createElement('div');
        statDiv.style.cssText = 'margin-top:8px;display:flex;gap:12px;';
        statDiv.innerHTML = '<span style="font-size:11px;color:#0f0;">✅ ' + (stats.verified || 0) + '</span>' +
          '<span style="font-size:11px;color:#fa0;">⚠️ ' + (stats.unverified || 0) + '</span>' +
          '<span style="font-size:11px;color:#f44;">❌ ' + (stats.outdated || 0) + '</span>' +
          '<span style="font-size:11px;color:#888;">Cache: ' + (stats.cacheSize || 0) + '</span>';
        div.appendChild(statDiv);
      }).catch(function(){});

      container.appendChild(div);
    }).catch(function(){});
  };

  // ═══════════════════════════════════════════════════════════════════
  // Custom Architecture Creator
  // ═══════════════════════════════════════════════════════════════════
  window._renderArchitectureCreator = function(container) {
    var div = document.createElement('div');
    div.style.cssText = 'background:#0a0a0a;border:1px solid #222;border-radius:8px;padding:12px;margin-top:12px;';
    div.innerHTML = '<div style="color:#0ff;font-size:13px;font-weight:600;margin-bottom:8px;">🧠 Custom Cognitive Architecture</div>' +
      '<input id="customArchKey" placeholder="Key (e.g. hacker)" style="width:100%;background:#111;color:#eee;border:1px solid #333;border-radius:4px;padding:4px 8px;font-size:12px;margin-bottom:4px;box-sizing:border-box;" />' +
      '<input id="customArchName" placeholder="Name (e.g. Hacker Mindset)" style="width:100%;background:#111;color:#eee;border:1px solid #333;border-radius:4px;padding:4px 8px;font-size:12px;margin-bottom:4px;box-sizing:border-box;" />' +
      '<input id="customArchSteps" placeholder="Steps (comma-separated)" style="width:100%;background:#111;color:#eee;border:1px solid #333;border-radius:4px;padding:4px 8px;font-size:12px;margin-bottom:4px;box-sizing:border-box;" />' +
      '<textarea id="customArchPrompt" placeholder="Prompt template..." style="width:100%;height:50px;background:#111;color:#eee;border:1px solid #333;border-radius:4px;padding:4px 8px;font-size:12px;resize:vertical;box-sizing:border-box;"></textarea>' +
      '<button id="customArchBtn" style="margin-top:6px;background:#0ff;color:#000;border:none;padding:4px 14px;border-radius:4px;font-weight:600;font-size:12px;cursor:pointer;">Create Architecture</button>';
    container.appendChild(div);

    setTimeout(function() {
      var btn = document.getElementById('customArchBtn');
      if (btn) btn.onclick = function() {
        var key = document.getElementById('customArchKey').value.trim();
        var name = document.getElementById('customArchName').value.trim();
        var steps = document.getElementById('customArchSteps').value.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
        var prompt = document.getElementById('customArchPrompt').value.trim();
        if (!key || !name || steps.length === 0 || !prompt) return;
        api4('POST', '/api/cognitive/custom', { key: key, name: name, steps: steps, prompt: prompt }).then(function(r) {
          if (r.success) {
            loadArchitectures();
            document.getElementById('customArchKey').value = '';
            document.getElementById('customArchName').value = '';
            document.getElementById('customArchSteps').value = '';
            document.getElementById('customArchPrompt').value = '';
          }
        });
      };
    }, 0);
  };

  // ═══════════════════════════════════════════════════════════════════
  // Init
  // ═══════════════════════════════════════════════════════════════════
  initRealityAnchor();
  loadArchitectures();

  // Expose for sidebar navigation
  window._features_v4 = {
    renderSwarmIntelPanel: window._renderSwarmIntelPanel,
    renderAnchorSettings: window._renderAnchorSettings,
    renderArchitectureCreator: window._renderArchitectureCreator,
    renderCognitiveSelector: window._renderCognitiveSelector,
    annotateWithAnchoring: window._annotateWithAnchoring
  };

})();
