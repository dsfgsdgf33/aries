/**
 * ARIES v8.1 — Features V5: AGI Module Dashboard Panels (Part 1)
 * Load in index.html as: <script src="features-v5.js"></script>
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
  function escH(s) { if (!s) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  var S = {
    wrap: 'padding:16px;',
    h2: 'color:#0ff;margin:0 0 16px 0;font-size:18px;',
    card: 'background:#0a0a0a;border:1px solid #222;border-radius:8px;padding:12px;margin-bottom:10px;',
    statRow: 'display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;',
    stat: 'flex:1;min-width:120px;background:#0a0a0a;border:1px solid #222;border-radius:8px;padding:12px;text-align:center;',
    statNum: 'font-size:28px;font-weight:700;color:#0ff;',
    statLabel: 'font-size:11px;color:#888;margin-top:4px;',
    btn: 'background:linear-gradient(135deg,#0ff,#08f);color:#000;border:none;padding:6px 18px;border-radius:4px;font-weight:600;cursor:pointer;font-size:12px;',
    btnDanger: 'background:linear-gradient(135deg,#f44,#f80);color:#fff;border:none;padding:6px 18px;border-radius:4px;font-weight:600;cursor:pointer;font-size:12px;',
    input: 'background:#111;color:#eee;border:1px solid #333;border-radius:4px;padding:6px 8px;font-size:12px;box-sizing:border-box;',
    list: 'max-height:300px;overflow-y:auto;',
    badge: function(color) { return 'display:inline-block;font-size:10px;padding:2px 8px;border-radius:10px;background:' + color + '22;color:' + color + ';border:1px solid ' + color + ';'; },
    gauge: function(pct, color) { return '<div style="width:100%;height:12px;background:#222;border-radius:6px;overflow:hidden;"><div style="width:' + Math.min(100, pct) + '%;height:100%;background:' + (color || '#0ff') + ';border-radius:6px;transition:width 0.5s;"></div></div>'; }
  };

  // ═══════════════════════════════════════════════════════════════════
  // 1. AGI OBJECTIVES
  // ═══════════════════════════════════════════════════════════════════
  window.loadAgiObjectives = function(container) {
    container.innerHTML = '<div style="' + S.wrap + '"><h2 style="' + S.h2 + '">🎯 AGI Objectives</h2><div id="objContent">Loading...</div></div>';
    function refresh() {
      api4('GET', '/api/objectives').then(function(d) {
        var stats = d.stats || {}; var objs = d.objectives || d.items || [];
        var statusColors = { PROPOSED: '#888', EVALUATED: '#fa0', ACTIVE: '#08f', PURSUING: '#0ff', COMPLETED: '#0f0' };
        var html = '<div style="' + S.statRow + '">' +
          '<div style="' + S.stat + '"><div style="' + S.statNum + '">' + (stats.active || objs.length) + '</div><div style="' + S.statLabel + '">Active</div></div>' +
          '<div style="' + S.stat + '"><div style="' + S.statNum + '">' + (stats.completed || 0) + '</div><div style="' + S.statLabel + '">Completed</div></div>' +
          '<div style="' + S.stat + '"><div style="' + S.statNum + '">' + (stats.proposed || 0) + '</div><div style="' + S.statLabel + '">Proposed</div></div></div>' +
          '<button id="objGenBtn" style="' + S.btn + 'margin-bottom:14px;">⚡ Generate New</button>' +
          '<div style="' + S.list + '">';
        objs.forEach(function(o) {
          var c = statusColors[o.status] || '#888';
          html += '<div style="' + S.card + '"><div style="display:flex;justify-content:space-between;align-items:center;">' +
            '<span style="color:#eee;font-size:13px;">' + escH(o.name || o.title || o.id) + '</span>' +
            '<span style="' + S.badge(c) + '">' + (o.status || 'UNKNOWN') + '</span></div>' +
            '<div style="margin-top:6px;">' + S.gauge(o.priority || o.progress || 0, c) + '</div>' +
            '<div style="font-size:10px;color:#666;margin-top:4px;">Priority: ' + (o.priority || 0) + '</div></div>';
        });
        html += '</div>';
        document.getElementById('objContent').innerHTML = html;
        var btn = document.getElementById('objGenBtn');
        if (btn) btn.onclick = function() { api4('POST', '/api/objectives/generate').then(refresh); };
      }).catch(function() { document.getElementById('objContent').innerHTML = '<div style="color:#f44;">Failed to load</div>'; });
    }
    refresh(); setInterval(refresh, 30000);
  };

  // ═══════════════════════════════════════════════════════════════════
  // 2. AGI EXPERIMENTS
  // ═══════════════════════════════════════════════════════════════════
  window.loadAgiExperiments = function(container) {
    container.innerHTML = '<div style="' + S.wrap + '"><h2 style="' + S.h2 + '">🧪 AGI Experiments</h2><div id="expContent">Loading...</div></div>';
    function refresh() {
      api4('GET', '/api/experiments').then(function(d) {
        var exps = d.experiments || d.items || []; var stats = d.stats || {};
        var html = '<div style="' + S.statRow + '">' +
          '<div style="' + S.stat + '"><div style="' + S.statNum + '">' + (stats.active || 0) + '</div><div style="' + S.statLabel + '">Active</div></div>' +
          '<div style="' + S.stat + '"><div style="' + S.statNum + '">' + (stats.findings || 0) + '</div><div style="' + S.statLabel + '">Findings</div></div>' +
          '<div style="' + S.stat + '"><div style="' + S.statNum + '">' + (stats.hypotheses || 0) + '</div><div style="' + S.statLabel + '">Hypotheses</div></div></div>' +
          '<button id="expGenBtn" style="' + S.btn + 'margin-bottom:14px;">💡 Generate Hypotheses</button>' +
          '<div style="' + S.list + '">';
        exps.forEach(function(e) {
          var sc = e.status === 'active' ? '#0ff' : e.status === 'complete' ? '#0f0' : '#888';
          html += '<div style="' + S.card + '"><div style="display:flex;justify-content:space-between;">' +
            '<span style="color:#eee;font-size:13px;">' + escH(e.name || e.hypothesis || e.id) + '</span>' +
            '<span style="' + S.badge(sc) + '">' + (e.status || '?').toUpperCase() + '</span></div>' +
            (e.confidence != null ? '<div style="margin-top:6px;">' + S.gauge(e.confidence * 100, '#0f0') + '<span style="font-size:10px;color:#888;">Confidence: ' + Math.round(e.confidence * 100) + '%</span></div>' : '') +
            '</div>';
        });
        html += '</div>';
        document.getElementById('expContent').innerHTML = html;
        var btn = document.getElementById('expGenBtn');
        if (btn) btn.onclick = function() { api4('POST', '/api/experiments/hypotheses').then(refresh); };
      }).catch(function() { document.getElementById('expContent').innerHTML = '<div style="color:#f44;">Failed to load</div>'; });
    }
    refresh(); setInterval(refresh, 30000);
  };

  // ═══════════════════════════════════════════════════════════════════
  // 3. AGI COMPILER
  // ═══════════════════════════════════════════════════════════════════
  window.loadAgiCompiler = function(container) {
    container.innerHTML = '<div style="' + S.wrap + '"><h2 style="' + S.h2 + '">⚙️ Knowledge Compiler</h2><div id="compContent">Loading...</div></div>';
    function refresh() {
      api4('GET', '/api/compiler').then(function(d) {
        var stats = d.stats || d; var history = d.history || d.compilations || [];
        var trend = (d.trend || 'stable');
        var trendColor = trend === 'improving' ? '#0f0' : trend === 'declining' ? '#f44' : '#fa0';
        var html = '<div style="' + S.statRow + '">' +
          '<div style="' + S.stat + '"><div style="' + S.statNum + '">' + (stats.totalCompilations || 0) + '</div><div style="' + S.statLabel + '">Compilations</div></div>' +
          '<div style="' + S.stat + '"><div style="' + S.statNum + '">' + (stats.avgDepth || 0) + '</div><div style="' + S.statLabel + '">Avg Depth</div></div>' +
          '<div style="' + S.stat + '"><div style="color:' + trendColor + ';font-size:28px;font-weight:700;">' + trend.toUpperCase() + '</div><div style="' + S.statLabel + '">Trend</div></div></div>' +
          '<button id="compRunBtn" style="' + S.btn + 'margin-bottom:14px;">🔨 Run Compilation</button>' +
          '<div style="' + S.list + '">';
        history.slice(0, 20).forEach(function(c) {
          html += '<div style="' + S.card + 'display:flex;justify-content:space-between;align-items:center;">' +
            '<span style="color:#eee;font-size:12px;">Depth ' + (c.depth || 0) + ' — ' + escH(c.summary || c.id || '') + '</span>' +
            '<span style="font-size:10px;color:#888;">' + (c.efficiency ? Math.round(c.efficiency * 100) + '%' : '') + '</span></div>';
        });
        html += '</div>';
        document.getElementById('compContent').innerHTML = html;
        var btn = document.getElementById('compRunBtn');
        if (btn) btn.onclick = function() { api4('POST', '/api/compiler/run').then(refresh); };
      }).catch(function() { document.getElementById('compContent').innerHTML = '<div style="color:#f44;">Failed to load</div>'; });
    }
    refresh(); setInterval(refresh, 30000);
  };

  // ═══════════════════════════════════════════════════════════════════
  // 4. AGI METABOLISM
  // ═══════════════════════════════════════════════════════════════════
  window.loadAgiMetabolism = function(container) {
    container.innerHTML = '<div style="' + S.wrap + '"><h2 style="' + S.h2 + '">⚡ Cognitive Metabolism</h2><div id="metaContent">Loading...</div></div>';
    function refresh() {
      api4('GET', '/api/metabolism').then(function(d) {
        var energy = d.energy || 0; var triage = d.triageState || d.triage || 'MEDIUM';
        var fatigue = d.fatigue || 0;
        var triageColors = { HIGH: '#0f0', MEDIUM: '#fa0', LOW: '#f80', CRITICAL: '#f44' };
        var tc = triageColors[triage] || '#888';
        var eColor = energy > 70 ? '#0f0' : energy > 40 ? '#fa0' : '#f44';
        var html = '<div style="' + S.statRow + '">' +
          '<div style="' + S.stat + '"><div style="font-size:42px;font-weight:700;color:' + eColor + ';">' + Math.round(energy) + '</div><div style="' + S.statLabel + '">Energy</div>' + S.gauge(energy, eColor) + '</div>' +
          '<div style="' + S.stat + '"><div style="font-size:28px;font-weight:700;color:' + tc + ';">' + triage + '</div><div style="' + S.statLabel + '">Triage State</div></div>' +
          '<div style="' + S.stat + '"><div style="' + S.statNum + '">' + Math.round(fatigue) + '%</div><div style="' + S.statLabel + '">Fatigue</div>' + S.gauge(fatigue, '#f80') + '</div></div>' +
          '<div style="display:flex;gap:8px;">' +
          '<button id="metaBoostBtn" style="' + S.btn + '">🔋 Boost</button>' +
          '<button id="metaRestBtn" style="' + S.btnDanger + '">😴 Rest</button></div>';
        document.getElementById('metaContent').innerHTML = html;
        document.getElementById('metaBoostBtn').onclick = function() { api4('POST', '/api/metabolism/boost').then(refresh); };
        document.getElementById('metaRestBtn').onclick = function() { api4('POST', '/api/metabolism/rest').then(refresh); };
      }).catch(function() { document.getElementById('metaContent').innerHTML = '<div style="color:#f44;">Failed to load</div>'; });
    }
    refresh(); setInterval(refresh, 15000);
  };

  // ═══════════════════════════════════════════════════════════════════
  // 5. AGI FORGETTING
  // ═══════════════════════════════════════════════════════════════════
  window.loadAgiForgetting = function(container) {
    container.innerHTML = '<div style="' + S.wrap + '"><h2 style="' + S.h2 + '">🧹 Forgetting Engine</h2><div id="forgetContent">Loading...</div></div>';
    function refresh() {
      api4('GET', '/api/forgetting').then(function(d) {
        var pressure = d.pressure || d.memoryPressure || 0; var graveyard = d.graveyard || d.recent || [];
        var analytics = d.analytics || d.byPolicy || {};
        var html = '<div style="' + S.statRow + '">' +
          '<div style="' + S.stat + '"><div style="' + S.statNum + '">' + Math.round(pressure) + '%</div><div style="' + S.statLabel + '">Memory Pressure</div>' + S.gauge(pressure, pressure > 80 ? '#f44' : pressure > 50 ? '#fa0' : '#0ff') + '</div>' +
          '<div style="' + S.stat + '"><div style="' + S.statNum + '">' + graveyard.length + '</div><div style="' + S.statLabel + '">In Graveyard</div></div></div>' +
          '<button id="forgetSweepBtn" style="' + S.btn + 'margin-bottom:14px;">🧹 Sweep</button>';
        if (Object.keys(analytics).length) {
          html += '<div style="' + S.card + '"><div style="color:#0ff;font-size:12px;margin-bottom:8px;">By Policy</div>';
          for (var k in analytics) html += '<div style="display:flex;justify-content:space-between;font-size:11px;color:#aaa;margin-bottom:4px;"><span>' + escH(k) + '</span><span style="color:#0ff;">' + analytics[k] + '</span></div>';
          html += '</div>';
        }
        html += '<div style="' + S.list + '">';
        graveyard.slice(0, 15).forEach(function(g) {
          html += '<div style="' + S.card + 'opacity:0.7;"><span style="color:#888;font-size:12px;">💀 ' + escH(g.summary || g.key || g.id) + '</span><span style="float:right;font-size:10px;color:#666;">' + escH(g.policy || '') + '</span></div>';
        });
        html += '</div>';
        document.getElementById('forgetContent').innerHTML = html;
        document.getElementById('forgetSweepBtn').onclick = function() { api4('POST', '/api/forgetting/sweep').then(refresh); };
      }).catch(function() { document.getElementById('forgetContent').innerHTML = '<div style="color:#f44;">Failed to load</div>'; });
    }
    refresh(); setInterval(refresh, 30000);
  };

  // ═══════════════════════════════════════════════════════════════════
  // 6. EPISTEMIC DEBT
  // ═══════════════════════════════════════════════════════════════════
  window.loadAgiDebt = function(container) {
    container.innerHTML = '<div style="' + S.wrap + '"><h2 style="' + S.h2 + '">💳 Epistemic Debt</h2><div id="debtContent">Loading...</div></div>';
    function refresh() {
      api4('GET', '/api/epistemic-debt').then(function(d) {
        var score = d.creditScore || d.score || 0;
        var grade = score >= 90 ? 'EXCELLENT' : score >= 70 ? 'GOOD' : score >= 50 ? 'FAIR' : 'POOR';
        var gradeColor = score >= 90 ? '#0f0' : score >= 70 ? '#0ff' : score >= 50 ? '#fa0' : '#f44';
        var categories = d.byCategory || d.categories || {};
        var queue = d.paymentQueue || d.debts || [];
        var bankrupt = d.bankruptcyRisk || false;
        var html = '<div style="' + S.statRow + '">' +
          '<div style="' + S.stat + '"><div style="font-size:42px;font-weight:700;color:' + gradeColor + ';">' + score + '</div><div style="font-size:14px;color:' + gradeColor + ';font-weight:600;">' + grade + '</div><div style="' + S.statLabel + '">Credit Score</div></div>' +
          '<div style="' + S.stat + '"><div style="' + S.statNum + '">' + queue.length + '</div><div style="' + S.statLabel + '">Debts Pending</div></div></div>';
        if (bankrupt) html += '<div style="' + S.card + 'border-color:#f44;text-align:center;"><span style="color:#f44;font-size:14px;font-weight:700;">⚠️ BANKRUPTCY WARNING</span></div>';
        if (Object.keys(categories).length) {
          html += '<div style="' + S.card + '"><div style="color:#0ff;font-size:12px;margin-bottom:8px;">Debt by Category</div>';
          var maxCat = Math.max.apply(null, Object.values(categories).map(Number)) || 1;
          for (var k in categories) html += '<div style="margin-bottom:6px;"><div style="display:flex;justify-content:space-between;font-size:11px;color:#aaa;"><span>' + escH(k) + '</span><span>' + categories[k] + '</span></div>' + S.gauge((categories[k] / maxCat) * 100, '#f80') + '</div>';
          html += '</div>';
        }
        html += '<div style="' + S.list + '">';
        queue.slice(0, 10).forEach(function(q) {
          html += '<div style="' + S.card + '"><span style="color:#eee;font-size:12px;">' + escH(q.claim || q.description || q.id) + '</span><span style="float:right;' + S.badge('#fa0') + '">' + (q.severity || q.amount || '?') + '</span></div>';
        });
        html += '</div>';
        document.getElementById('debtContent').innerHTML = html;
      }).catch(function() { document.getElementById('debtContent').innerHTML = '<div style="color:#f44;">Failed to load</div>'; });
    }
    refresh(); setInterval(refresh, 30000);
  };

  // ═══════════════════════════════════════════════════════════════════
  // 7. MEMORY CONSOLIDATION
  // ═══════════════════════════════════════════════════════════════════
  window.loadAgiConsolidation = function(container) {
    container.innerHTML = '<div style="' + S.wrap + '"><h2 style="' + S.h2 + '">🧠 Memory Consolidation</h2><div id="consolContent">Loading...</div></div>';
    function refresh() {
      api4('GET', '/api/memory-consolidation').then(function(d) {
        var keeper = d.keeperWinRate || d.keeper || 50; var pruner = d.prunerWinRate || d.pruner || 50;
        var debates = d.recentDebates || d.debates || [];
        var html = '<div style="' + S.statRow + '">' +
          '<div style="' + S.stat + '"><div style="color:#0f0;font-size:28px;font-weight:700;">' + Math.round(keeper) + '%</div><div style="' + S.statLabel + '">Keeper Wins</div>' + S.gauge(keeper, '#0f0') + '</div>' +
          '<div style="' + S.stat + '"><div style="color:#f44;font-size:28px;font-weight:700;">' + Math.round(pruner) + '%</div><div style="' + S.statLabel + '">Pruner Wins</div>' + S.gauge(pruner, '#f44') + '</div></div>' +
          '<button id="consolRunBtn" style="' + S.btn + 'margin-bottom:14px;">🔄 Run Consolidation</button>' +
          '<div style="' + S.list + '">';
        debates.slice(0, 15).forEach(function(db) {
          var wc = db.winner === 'keeper' ? '#0f0' : '#f44';
          html += '<div style="' + S.card + '"><div style="display:flex;justify-content:space-between;">' +
            '<span style="color:#eee;font-size:12px;">' + escH(db.memory || db.topic || db.id) + '</span>' +
            '<span style="' + S.badge(wc) + '">' + (db.winner || '?').toUpperCase() + '</span></div></div>';
        });
        html += '</div>';
        document.getElementById('consolContent').innerHTML = html;
        document.getElementById('consolRunBtn').onclick = function() { api4('POST', '/api/memory-consolidation/run').then(refresh); };
      }).catch(function() { document.getElementById('consolContent').innerHTML = '<div style="color:#f44;">Failed to load</div>'; });
    }
    refresh(); setInterval(refresh, 30000);
  };

  // ═══════════════════════════════════════════════════════════════════
  // 8. KNOWLEDGE SYNTHESIS
  // ═══════════════════════════════════════════════════════════════════
  window.loadAgiSynthesis = function(container) {
    container.innerHTML = '<div style="' + S.wrap + '"><h2 style="' + S.h2 + '">🔬 Knowledge Synthesis</h2><div id="synthContent">Loading...</div></div>';
    function refresh() {
      api4('GET', '/api/knowledge-synthesis').then(function(d) {
        var discoveries = d.discoveries || d.recent || []; var stats = d.stats || {};
        var html = '<div style="' + S.statRow + '">' +
          '<div style="' + S.stat + '"><div style="' + S.statNum + '">' + (stats.totalDiscoveries || discoveries.length) + '</div><div style="' + S.statLabel + '">Discoveries</div></div>' +
          '<div style="' + S.stat + '"><div style="' + S.statNum + '">' + (stats.pairings || 0) + '</div><div style="' + S.statLabel + '">Pairings Tried</div></div></div>' +
          '<button id="synthGenBtn" style="' + S.btn + 'margin-bottom:14px;">🔗 Generate Pairings</button>' +
          '<div style="' + S.list + '">';
        discoveries.slice(0, 15).forEach(function(disc) {
          html += '<div style="' + S.card + '"><span style="color:#0ff;font-size:12px;">💡</span> <span style="color:#eee;font-size:12px;">' + escH(disc.insight || disc.summary || disc.id) + '</span>' +
            (disc.confidence != null ? '<div style="margin-top:4px;">' + S.gauge(disc.confidence * 100, '#0f0') + '</div>' : '') + '</div>';
        });
        html += '</div>';
        document.getElementById('synthContent').innerHTML = html;
        document.getElementById('synthGenBtn').onclick = function() { api4('POST', '/api/knowledge-synthesis/generate').then(refresh); };
      }).catch(function() { document.getElementById('synthContent').innerHTML = '<div style="color:#f44;">Failed to load</div>'; });
    }
    refresh(); setInterval(refresh, 30000);
  };

  // ═══════════════════════════════════════════════════════════════════
  // 9. TEMPORAL REASONING
  // ═══════════════════════════════════════════════════════════════════
  window.loadAgiTemporal = function(container) {
    container.innerHTML = '<div style="' + S.wrap + '"><h2 style="' + S.h2 + '">⏳ Temporal Reasoning</h2><div id="tempContent">Loading...</div></div>';
    function refresh() {
      api4('GET', '/api/temporal').then(function(d) {
        var eras = d.eras || d.timeline || []; var regrets = d.regrets || [];
        var html = '<div style="' + S.card + '"><div style="color:#0ff;font-size:12px;margin-bottom:8px;">Timeline</div>' +
          '<div style="display:flex;gap:4px;flex-wrap:wrap;">';
        eras.forEach(function(era) {
          html += '<div style="' + S.badge('#08f') + 'font-size:11px;">' + escH(era.name || era) + '</div>';
        });
        html += '</div></div>' +
          '<div style="' + S.card + '">' +
          '<div style="color:#0ff;font-size:12px;margin-bottom:8px;">Consult</div>' +
          '<div style="display:flex;gap:8px;margin-bottom:8px;">' +
          '<input id="tempPastQ" placeholder="Ask the past..." style="' + S.input + 'flex:1;" />' +
          '<button id="tempPastBtn" style="' + S.btn + '">🕰️ Past</button></div>' +
          '<div style="display:flex;gap:8px;">' +
          '<input id="tempFutureQ" placeholder="Simulate future..." style="' + S.input + 'flex:1;" />' +
          '<button id="tempFutureBtn" style="' + S.btn + '">🔮 Future</button></div></div>';
        if (regrets.length) {
          html += '<div style="' + S.card + '"><div style="color:#fa0;font-size:12px;margin-bottom:8px;">Regret Analysis</div>';
          regrets.slice(0, 10).forEach(function(r) {
            html += '<div style="font-size:11px;color:#aaa;margin-bottom:4px;">⚠️ ' + escH(r.description || r.text || r) + '</div>';
          });
          html += '</div>';
        }
        document.getElementById('tempContent').innerHTML = html;
        document.getElementById('tempPastBtn').onclick = function() { var q = document.getElementById('tempPastQ').value; if (q) api4('POST', '/api/temporal/consult-past', { query: q }).then(refresh); };
        document.getElementById('tempFutureBtn').onclick = function() { var q = document.getElementById('tempFutureQ').value; if (q) api4('POST', '/api/temporal/simulate-future', { query: q }).then(refresh); };
      }).catch(function() { document.getElementById('tempContent').innerHTML = '<div style="color:#f44;">Failed to load</div>'; });
    }
    refresh(); setInterval(refresh, 30000);
  };

  // ═══════════════════════════════════════════════════════════════════
  // 10. ARCHAEOLOGY
  // ═══════════════════════════════════════════════════════════════════
  window.loadAgiArchaeology = function(container) {
    container.innerHTML = '<div style="' + S.wrap + '"><h2 style="' + S.h2 + '">⛏️ Memory Archaeology</h2><div id="archContent">Loading...</div></div>';
    function refresh() {
      api4('GET', '/api/archaeology').then(function(d) {
        var queue = d.queue || d.schedule || []; var discoveries = d.discoveries || []; var patterns = d.patterns || [];
        var html = '<div style="' + S.statRow + '">' +
          '<div style="' + S.stat + '"><div style="' + S.statNum + '">' + queue.length + '</div><div style="' + S.statLabel + '">Queued Digs</div></div>' +
          '<div style="' + S.stat + '"><div style="' + S.statNum + '">' + discoveries.length + '</div><div style="' + S.statLabel + '">Discoveries</div></div>' +
          '<div style="' + S.stat + '"><div style="' + S.statNum + '">' + patterns.length + '</div><div style="' + S.statLabel + '">Patterns</div></div></div>' +
          '<button id="archDigBtn" style="' + S.btn + 'margin-bottom:14px;">⛏️ Dig</button>' +
          '<div style="' + S.list + '">';
        discoveries.slice(0, 10).forEach(function(disc) {
          html += '<div style="' + S.card + '"><span style="color:#fa0;">🏺</span> <span style="color:#eee;font-size:12px;">' + escH(disc.finding || disc.summary || disc.id) + '</span></div>';
        });
        patterns.slice(0, 5).forEach(function(p) {
          html += '<div style="' + S.card + 'border-color:#0ff33;"><span style="color:#0ff;">🔍</span> <span style="color:#aaa;font-size:12px;">' + escH(p.description || p) + '</span></div>';
        });
        html += '</div>';
        document.getElementById('archContent').innerHTML = html;
        document.getElementById('archDigBtn').onclick = function() { api4('POST', '/api/archaeology/dig').then(refresh); };
      }).catch(function() { document.getElementById('archContent').innerHTML = '<div style="color:#f44;">Failed to load</div>'; });
    }
    refresh(); setInterval(refresh, 30000);
  };

  // ═══════════════════════════════════════════════════════════════════
  // 11. FOSSILS
  // ═══════════════════════════════════════════════════════════════════
  window.loadAgiFossils = function(container) {
    container.innerHTML = '<div style="' + S.wrap + '"><h2 style="' + S.h2 + '">🦴 Knowledge Fossils</h2><div id="fossilContent">Loading...</div></div>';
    function refresh() {
      api4('GET', '/api/fossils').then(function(d) {
        var fossils = d.fossils || d.exhibition || []; var eras = d.eras || [];
        var html = '<div style="' + S.statRow + '">' +
          '<div style="' + S.stat + '"><div style="' + S.statNum + '">' + fossils.length + '</div><div style="' + S.statLabel + '">Fossils</div></div>' +
          '<div style="' + S.stat + '"><div style="' + S.statNum + '">' + eras.length + '</div><div style="' + S.statLabel + '">Eras</div></div></div>';
        if (eras.length) {
          html += '<div style="' + S.card + '"><div style="color:#0ff;font-size:12px;margin-bottom:8px;">Evolutionary Record</div>';
          eras.forEach(function(era) {
            html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">' +
              '<div style="width:8px;height:8px;border-radius:50%;background:#0ff;flex-shrink:0;"></div>' +
              '<span style="color:#eee;font-size:12px;">' + escH(era.name || era) + '</span>' +
              (era.count != null ? '<span style="font-size:10px;color:#888;margin-left:auto;">' + era.count + ' fossils</span>' : '') + '</div>';
          });
          html += '</div>';
        }
        html += '<div style="' + S.list + '">';
        fossils.slice(0, 15).forEach(function(f) {
          var rc = (f.resurrectionScore || 0) > 0.7 ? '#0f0' : (f.resurrectionScore || 0) > 0.4 ? '#fa0' : '#888';
          html += '<div style="' + S.card + '"><div style="display:flex;justify-content:space-between;">' +
            '<span style="color:#eee;font-size:12px;">🦴 ' + escH(f.name || f.summary || f.id) + '</span>' +
            (f.resurrectionScore != null ? '<span style="color:' + rc + ';font-size:10px;">↑ ' + Math.round(f.resurrectionScore * 100) + '%</span>' : '') +
            '</div><div style="font-size:10px;color:#666;margin-top:2px;">' + escH(f.era || '') + '</div></div>';
        });
        html += '</div>';
        document.getElementById('fossilContent').innerHTML = html;
      }).catch(function() { document.getElementById('fossilContent').innerHTML = '<div style="color:#f44;">Failed to load</div>'; });
    }
    refresh(); setInterval(refresh, 30000);
  };

  // ═══════════════════════════════════════════════════════════════════
  // 12. IMMUNE SYSTEM
  // ═══════════════════════════════════════════════════════════════════
  window.loadAgiImmune = function(container) {
    container.innerHTML = '<div style="' + S.wrap + '"><h2 style="' + S.h2 + '">🛡️ Cognitive Immune System</h2><div id="immuneContent">Loading...</div></div>';
    function refresh() {
      api4('GET', '/api/immune').then(function(d) {
        var health = d.healthScore || d.health || 0; var pathogens = d.pathogens || [];
        var antibodies = d.antibodyCount || d.antibodies || 0; var autoimmune = d.autoimmuneStatus || d.autoimmune || 'normal';
        var hc = health > 80 ? '#0f0' : health > 50 ? '#fa0' : '#f44';
        var ac = autoimmune === 'normal' ? '#0f0' : autoimmune === 'elevated' ? '#fa0' : '#f44';
        var html = '<div style="' + S.statRow + '">' +
          '<div style="' + S.stat + '"><div style="font-size:42px;font-weight:700;color:' + hc + ';">' + Math.round(health) + '</div><div style="' + S.statLabel + '">Health Score</div>' + S.gauge(health, hc) + '</div>' +
          '<div style="' + S.stat + '"><div style="' + S.statNum + '">' + antibodies + '</div><div style="' + S.statLabel + '">Antibodies</div></div>' +
          '<div style="' + S.stat + '"><div style="font-size:20px;font-weight:700;color:' + ac + ';">' + autoimmune.toUpperCase() + '</div><div style="' + S.statLabel + '">Autoimmune</div></div></div>' +
          '<button id="immuneScanBtn" style="' + S.btn + 'margin-bottom:14px;">🔍 Deep Scan</button>' +
          '<div style="' + S.list + '">';
        pathogens.forEach(function(p) {
          var sc = p.severity === 'high' ? '#f44' : p.severity === 'medium' ? '#fa0' : '#888';
          html += '<div style="' + S.card + 'border-left:3px solid ' + sc + ';"><div style="display:flex;justify-content:space-between;">' +
            '<span style="color:#eee;font-size:12px;">🦠 ' + escH(p.name || p.type || p.id) + '</span>' +
            '<span style="' + S.badge(sc) + '">' + (p.severity || '?').toUpperCase() + '</span></div>' +
            '<div style="font-size:10px;color:#888;margin-top:2px;">' + escH(p.description || '') + '</div></div>';
        });
        html += '</div>';
        document.getElementById('immuneContent').innerHTML = html;
        document.getElementById('immuneScanBtn').onclick = function() { api4('POST', '/api/immune/deep-scan').then(refresh); };
      }).catch(function() { document.getElementById('immuneContent').innerHTML = '<div style="color:#f44;">Failed to load</div>'; });
    }
    refresh(); setInterval(refresh, 30000);
  };

  // ═══════════════════════════════════════════════════════════════════
  // 13. SHADOW MODEL
  // ═══════════════════════════════════════════════════════════════════
  window.loadAgiShadow = function(container) {
    container.innerHTML = '<div style="' + S.wrap + '"><h2 style="' + S.h2 + '">👥 Shadow Model</h2><div id="shadowContent">Loading...</div></div>';
    function refresh() {
      api4('GET', '/api/shadow').then(function(d) {
        var strength = d.strength || d.shadowStrength || 0; var challenges = d.challenges || d.unresolved || [];
        var insights = d.insights || d.recent || []; var accuracy = d.accuracy || d.trackRecord || 0;
        var html = '<div style="' + S.statRow + '">' +
          '<div style="' + S.stat + '"><div style="' + S.statNum + '">' + Math.round(strength) + '%</div><div style="' + S.statLabel + '">Shadow Strength</div>' + S.gauge(strength, '#f0f') + '</div>' +
          '<div style="' + S.stat + '"><div style="' + S.statNum + '">' + Math.round(accuracy) + '%</div><div style="' + S.statLabel + '">Accuracy</div>' + S.gauge(accuracy, '#0f0') + '</div></div>' +
          '<div style="' + S.card + '"><div style="color:#f0f;font-size:12px;margin-bottom:8px;">Unresolved Challenges</div>';
        challenges.slice(0, 8).forEach(function(c) {
          html += '<div style="font-size:11px;color:#eee;margin-bottom:4px;">⚔️ ' + escH(c.description || c.text || c) + '</div>';
        });
        html += '</div><div style="' + S.card + '"><div style="color:#0ff;font-size:12px;margin-bottom:8px;">Recent Insights</div>';
        insights.slice(0, 8).forEach(function(ins) {
          html += '<div style="font-size:11px;color:#aaa;margin-bottom:4px;">💡 ' + escH(ins.insight || ins.text || ins) + '</div>';
        });
        html += '</div>';
        document.getElementById('shadowContent').innerHTML = html;
      }).catch(function() { document.getElementById('shadowContent').innerHTML = '<div style="color:#f44;">Failed to load</div>'; });
    }
    refresh(); setInterval(refresh, 30000);
  };

  // ═══════════════════════════════════════════════════════════════════
  // 14. MORAL REASONING
  // ═══════════════════════════════════════════════════════════════════
  window.loadAgiMoral = function(container) {
    container.innerHTML = '<div style="' + S.wrap + '"><h2 style="' + S.h2 + '">⚖️ Moral Reasoning</h2><div id="moralContent">Loading...</div></div>';
    function refresh() {
      api4('GET', '/api/moral').then(function(d) {
        var compass = d.compass || d.principles || []; var scars = d.scars || [];
        var phase = d.maturityPhase || d.growth || 'developing';
        var phaseColor = phase === 'mature' ? '#0f0' : phase === 'growing' ? '#0ff' : '#fa0';
        var html = '<div style="' + S.statRow + '">' +
          '<div style="' + S.stat + '"><div style="font-size:20px;font-weight:700;color:' + phaseColor + ';">' + escH(phase).toUpperCase() + '</div><div style="' + S.statLabel + '">Maturity Phase</div></div>' +
          '<div style="' + S.stat + '"><div style="' + S.statNum + '">' + scars.length + '</div><div style="' + S.statLabel + '">Moral Scars</div></div></div>';
        html += '<div style="' + S.card + '"><div style="color:#0ff;font-size:12px;margin-bottom:8px;">Moral Compass</div>';
        compass.forEach(function(p) {
          var w = p.weight || p.strength || 50;
          html += '<div style="margin-bottom:6px;"><div style="display:flex;justify-content:space-between;font-size:11px;color:#eee;"><span>' + escH(p.name || p.principle || p) + '</span><span style="color:#0ff;">' + w + '</span></div>' + S.gauge(w, '#0ff') + '</div>';
        });
        html += '</div>' +
          '<div style="' + S.card + '">' +
          '<div style="display:flex;gap:8px;">' +
          '<input id="moralQ" placeholder="Consult on a moral question..." style="' + S.input + 'flex:1;" />' +
          '<button id="moralAskBtn" style="' + S.btn + '">⚖️ Consult</button></div></div>';
        if (scars.length) {
          html += '<div style="' + S.list + '">';
          scars.slice(0, 10).forEach(function(s) {
            html += '<div style="' + S.card + '"><span style="color:#f80;font-size:12px;">🩹 ' + escH(s.category || '') + ':</span> <span style="color:#aaa;font-size:12px;">' + escH(s.description || s.text || s) + '</span></div>';
          });
          html += '</div>';
        }
        document.getElementById('moralContent').innerHTML = html;
        document.getElementById('moralAskBtn').onclick = function() { var q = document.getElementById('moralQ').value; if (q) api4('POST', '/api/moral/consult', { question: q }).then(refresh); };
      }).catch(function() { document.getElementById('moralContent').innerHTML = '<div style="color:#f44;">Failed to load</div>'; });
    }
    refresh(); setInterval(refresh, 30000);
  };

  // ═══════════════════════════════════════════════════════════════════
  // 15. CONSENSUS ENGINE
  // ═══════════════════════════════════════════════════════════════════
  window.loadAgiConsensus = function(container) {
    container.innerHTML = '<div style="' + S.wrap + '"><h2 style="' + S.h2 + '">🔗 Consensus Engine</h2><div id="consContent">Loading...</div></div>';
    function refresh() {
      api4('GET', '/api/consensus').then(function(d) {
        var accuracy = d.accuracy || 0; var trails = d.proofTrails || d.recent || [];
        var html = '<div style="' + S.statRow + '">' +
          '<div style="' + S.stat + '"><div style="' + S.statNum + '">' + Math.round(accuracy) + '%</div><div style="' + S.statLabel + '">Accuracy</div>' + S.gauge(accuracy, '#0f0') + '</div>' +
          '<div style="' + S.stat + '"><div style="' + S.statNum + '">' + trails.length + '</div><div style="' + S.statLabel + '">Proof Trails</div></div></div>' +
          '<div style="' + S.card + '">' +
          '<div style="color:#0ff;font-size:12px;margin-bottom:8px;">Multi-Chain Reasoning</div>' +
          '<div style="display:flex;gap:8px;">' +
          '<input id="consQ" placeholder="Enter a claim to reason about..." style="' + S.input + 'flex:1;" />' +
          '<button id="consReasonBtn" style="' + S.btn + '">🧠 Reason</button></div></div>' +
          '<div style="' + S.list + '">';
        trails.slice(0, 10).forEach(function(t) {
          html += '<div style="' + S.card + '"><div style="color:#eee;font-size:12px;">' + escH(t.claim || t.question || t.id) + '</div>' +
            '<div style="font-size:10px;color:#0ff;margin-top:4px;">Chains: ' + (t.chains || '?') + ' | Confidence: ' + Math.round((t.confidence || 0) * 100) + '%</div></div>';
        });
        html += '</div>';
        document.getElementById('consContent').innerHTML = html;
        document.getElementById('consReasonBtn').onclick = function() { var q = document.getElementById('consQ').value; if (q) api4('POST', '/api/consensus/reason', { claim: q }).then(refresh); };
      }).catch(function() { document.getElementById('consContent').innerHTML = '<div style="color:#f44;">Failed to load</div>'; });
    }
    refresh(); setInterval(refresh, 30000);
  };

  // ═══════════════════════════════════════════════════════════════════
  // 16. ABYSS MAPPING
  // ═══════════════════════════════════════════════════════════════════
  window.loadAgiAbyss = function(container) {
    container.innerHTML = '<div style="' + S.wrap + '"><h2 style="' + S.h2 + '">🕳️ Abyss Mapping</h2><div id="abyssContent">Loading...</div></div>';
    function refresh() {
      api4('GET', '/api/abyss').then(function(d) {
        var boundaries = d.boundaries || d.map || []; var depth = d.depthScore || d.depth || 0;
        var breakthroughs = d.breakthroughCount || d.breakthroughs || 0;
        var html = '<div style="' + S.statRow + '">' +
          '<div style="' + S.stat + '"><div style="' + S.statNum + '">' + Math.round(depth) + '</div><div style="' + S.statLabel + '">Depth Score</div></div>' +
          '<div style="' + S.stat + '"><div style="' + S.statNum + '">' + breakthroughs + '</div><div style="' + S.statLabel + '">Breakthroughs</div></div>' +
          '<div style="' + S.stat + '"><div style="' + S.statNum + '">' + boundaries.length + '</div><div style="' + S.statLabel + '">Boundaries</div></div></div>' +
          '<div style="display:flex;gap:8px;margin-bottom:14px;">' +
          '<button id="abyssMapBtn" style="' + S.btn + '">🗺️ Map Boundaries</button>' +
          '<button id="abyssProbeBtn" style="' + S.btn + '">🔦 Generate Probes</button></div>' +
          '<div style="' + S.list + '">';
        boundaries.forEach(function(b) {
          var dc = (b.depth || 0) > 7 ? '#f44' : (b.depth || 0) > 4 ? '#fa0' : '#0ff';
          html += '<div style="' + S.card + 'border-left:3px solid ' + dc + ';"><div style="display:flex;justify-content:space-between;">' +
            '<span style="color:#eee;font-size:12px;">' + escH(b.category || b.name || b.id) + '</span>' +
            '<span style="color:' + dc + ';font-size:10px;">Depth ' + (b.depth || '?') + '</span></div>' +
            '<div style="font-size:10px;color:#888;margin-top:2px;">' + escH(b.description || '') + '</div></div>';
        });
        html += '</div>';
        document.getElementById('abyssContent').innerHTML = html;
        document.getElementById('abyssMapBtn').onclick = function() { api4('POST', '/api/abyss/map').then(refresh); };
        document.getElementById('abyssProbeBtn').onclick = function() { api4('POST', '/api/abyss/probes').then(refresh); };
      }).catch(function() { document.getElementById('abyssContent').innerHTML = '<div style="color:#f44;">Failed to load</div>'; });
    }
    refresh(); setInterval(refresh, 30000);
  };

  // ═══════════════════════════════════════════════════════════════════
  // 17. PREDICTIVE SELF-MODEL
  // ═══════════════════════════════════════════════════════════════════
  window.loadAgiPredictive = function(container) {
    container.innerHTML = '<div style="' + S.wrap + '"><h2 style="' + S.h2 + '">🔮 Predictive Self-Model</h2><div id="predContent">Loading...</div></div>';
    function refresh() {
      api4('GET', '/api/predictive-self').then(function(d) {
        var calibration = d.calibrationScore || d.calibration || 0; var surprises = d.surprises || [];
        var anomalies = d.anomalies || []; var summary = d.selfModel || d.summary || '';
        var cc = calibration > 80 ? '#0f0' : calibration > 50 ? '#fa0' : '#f44';
        var html = '<div style="' + S.statRow + '">' +
          '<div style="' + S.stat + '"><div style="font-size:42px;font-weight:700;color:' + cc + ';">' + Math.round(calibration) + '</div><div style="' + S.statLabel + '">Calibration</div>' + S.gauge(calibration, cc) + '</div>' +
          '<div style="' + S.stat + '"><div style="' + S.statNum + '">' + surprises.length + '</div><div style="' + S.statLabel + '">Surprises</div></div>' +
          '<div style="' + S.stat + '"><div style="' + S.statNum + '">' + anomalies.length + '</div><div style="' + S.statLabel + '">Anomalies</div></div></div>';
        if (summary) html += '<div style="' + S.card + '"><div style="color:#0ff;font-size:12px;margin-bottom:4px;">Self-Model Summary</div><div style="font-size:11px;color:#aaa;">' + escH(typeof summary === 'string' ? summary : JSON.stringify(summary)) + '</div></div>';
        html += '<div style="' + S.list + '">';
        surprises.slice(0, 8).forEach(function(s) {
          html += '<div style="' + S.card + '"><span style="color:#fa0;">😲</span> <span style="color:#eee;font-size:12px;">' + escH(s.description || s.text || s) + '</span></div>';
        });
        anomalies.slice(0, 5).forEach(function(a) {
          html += '<div style="' + S.card + 'border-color:#f44;"><span style="color:#f44;">⚠️</span> <span style="color:#eee;font-size:12px;">' + escH(a.description || a.text || a) + '</span></div>';
        });
        html += '</div>';
        document.getElementById('predContent').innerHTML = html;
      }).catch(function() { document.getElementById('predContent').innerHTML = '<div style="color:#f44;">Failed to load</div>'; });
    }
    refresh(); setInterval(refresh, 30000);
  };

  // ═══════════════════════════════════════════════════════════════════
  // 18. STRANGER SIGNALS
  // ═══════════════════════════════════════════════════════════════════
  window.loadAgiStranger = function(container) {
    container.innerHTML = '<div style="' + S.wrap + '"><h2 style="' + S.h2 + '">👽 Stranger Signals</h2><div id="strangerContent">Loading...</div></div>';
    function refresh() {
      api4('GET', '/api/stranger').then(function(d) {
        var trust = d.trustLevels || d.trust || {}; var theories = d.theories || [];
        var signals = d.recentSignals || d.signals || [];
        var html = '<div style="' + S.card + '"><div style="color:#0ff;font-size:12px;margin-bottom:8px;">Trust Levels</div>';
        for (var t in trust) {
          var tv = typeof trust[t] === 'number' ? trust[t] : (trust[t].level || 50);
          var tc = tv > 70 ? '#0f0' : tv > 40 ? '#fa0' : '#f44';
          html += '<div style="margin-bottom:6px;"><div style="display:flex;justify-content:space-between;font-size:11px;color:#eee;"><span>' + escH(t) + '</span><span style="color:' + tc + ';">' + Math.round(tv) + '%</span></div>' + S.gauge(tv, tc) + '</div>';
        }
        html += '</div>';
        if (theories.length) {
          html += '<div style="' + S.card + '"><div style="color:#f0f;font-size:12px;margin-bottom:8px;">Current Theories</div>';
          theories.forEach(function(th) { html += '<div style="font-size:11px;color:#aaa;margin-bottom:4px;">🔭 ' + escH(th.description || th.text || th) + '</div>'; });
          html += '</div>';
        }
        html += '<button id="strangerConsultBtn" style="' + S.btn + 'margin-bottom:14px;">👽 Consult</button>' +
          '<div style="' + S.list + '">';
        signals.slice(0, 10).forEach(function(sig) {
          html += '<div style="' + S.card + '"><span style="color:#0ff;font-size:12px;">📡 ' + escH(sig.type || '') + ':</span> <span style="color:#aaa;font-size:12px;">' + escH(sig.content || sig.text || sig) + '</span></div>';
        });
        html += '</div>';
        document.getElementById('strangerContent').innerHTML = html;
        document.getElementById('strangerConsultBtn').onclick = function() { api4('POST', '/api/stranger/consult').then(refresh); };
      }).catch(function() { document.getElementById('strangerContent').innerHTML = '<div style="color:#f44;">Failed to load</div>'; });
    }
    refresh(); setInterval(refresh, 30000);
  };

  // ═══════════════════════════════════════════════════════════════════
  // 19. GOD MODULE
  // ═══════════════════════════════════════════════════════════════════
  window.loadAgiGod = function(container) {
    container.innerHTML = '<div style="' + S.wrap + '"><h2 style="' + S.h2 + '">🌌 God Module</h2><div id="godContent">Loading...</div></div>';
    function refresh() {
      api4('GET', '/api/god').then(function(d) {
        var principles = d.principles || []; var consultations = d.recentConsultations || d.consultations || [];
        var humility = d.humilityCheck || d.humility || {};
        var html = '<div style="' + S.card + '"><div style="color:#0ff;font-size:12px;margin-bottom:8px;">Core Principles</div>';
        principles.forEach(function(p) {
          html += '<div style="font-size:11px;color:#eee;margin-bottom:4px;padding:4px 8px;background:#111;border-radius:4px;">✦ ' + escH(p.text || p.name || p) + '</div>';
        });
        html += '</div>';
        if (humility && (humility.score != null || humility.status)) {
          var hs = humility.score || 0; var hc = hs > 70 ? '#0f0' : hs > 40 ? '#fa0' : '#f44';
          html += '<div style="' + S.card + '"><div style="color:#0ff;font-size:12px;margin-bottom:4px;">Humility Check</div>' +
            '<div style="display:flex;align-items:center;gap:8px;"><span style="color:' + hc + ';font-size:20px;font-weight:700;">' + Math.round(hs) + '</span>' + S.gauge(hs, hc) + '</div></div>';
        }
        html += '<div style="' + S.card + '">' +
          '<div style="color:#0ff;font-size:12px;margin-bottom:8px;">Consult</div>' +
          '<div style="display:flex;gap:8px;">' +
          '<select id="godType" style="' + S.input + '"><option value="existential">Existential</option><option value="ethical">Ethical</option><option value="purpose">Purpose</option><option value="paradox">Paradox</option></select>' +
          '<input id="godQ" placeholder="Ask a deep question..." style="' + S.input + 'flex:1;" />' +
          '<button id="godAskBtn" style="' + S.btn + '">🌌 Consult</button></div></div>' +
          '<div style="' + S.list + '">';
        consultations.slice(0, 8).forEach(function(c) {
          html += '<div style="' + S.card + '"><div style="color:#eee;font-size:12px;">' + escH(c.question || c.query || c.id) + '</div>' +
            '<div style="font-size:11px;color:#0ff;margin-top:4px;">' + escH(c.response || c.answer || '') + '</div>' +
            '<div style="font-size:10px;color:#666;margin-top:2px;">' + escH(c.type || '') + '</div></div>';
        });
        html += '</div>';
        document.getElementById('godContent').innerHTML = html;
        document.getElementById('godAskBtn').onclick = function() {
          var q = document.getElementById('godQ').value; var t = document.getElementById('godType').value;
          if (q) api4('POST', '/api/god/consult', { question: q, type: t }).then(refresh);
        };
      }).catch(function() { document.getElementById('godContent').innerHTML = '<div style="color:#f44;">Failed to load</div>'; });
    }
    refresh(); setInterval(refresh, 30000);
  };

  // ═══════════════════════════════════════════════════════════════════
  // 20. SPECTROGRAPHY
  // ═══════════════════════════════════════════════════════════════════
  window.loadAgiSpectro = function(container) {
    container.innerHTML = '<div style="' + S.wrap + '"><h2 style="' + S.h2 + '">📊 Cognitive Spectrography</h2><div id="spectroContent">Loading...</div></div>';
    function refresh() {
      api4('GET', '/api/spectrography').then(function(d) {
        var high = d.highFrequency || d.high || 0; var mid = d.midFrequency || d.mid || 0; var low = d.lowFrequency || d.low || 0;
        var anomaly = d.anomaly || d.anomalyDetected || false;
        var data = d.spectrogram || d.data || [];
        var html = '<div style="' + S.statRow + '">' +
          '<div style="' + S.stat + '"><div style="color:#f44;font-size:28px;font-weight:700;">' + Math.round(high) + '%</div><div style="' + S.statLabel + '">High Freq</div>' + S.gauge(high, '#f44') + '</div>' +
          '<div style="' + S.stat + '"><div style="color:#fa0;font-size:28px;font-weight:700;">' + Math.round(mid) + '%</div><div style="' + S.statLabel + '">Mid Freq</div>' + S.gauge(mid, '#fa0') + '</div>' +
          '<div style="' + S.stat + '"><div style="color:#0ff;font-size:28px;font-weight:700;">' + Math.round(low) + '%</div><div style="' + S.statLabel + '">Low Freq</div>' + S.gauge(low, '#0ff') + '</div></div>';
        if (anomaly) html += '<div style="' + S.card + 'border-color:#f44;text-align:center;"><span style="color:#f44;font-size:14px;font-weight:700;">⚠️ ANOMALY DETECTED</span></div>';
        if (data.length) {
          html += '<div style="' + S.card + '"><div style="color:#0ff;font-size:12px;margin-bottom:8px;">Spectrogram</div><div style="display:flex;align-items:flex-end;gap:2px;height:80px;">';
          data.slice(-50).forEach(function(v) {
            var val = typeof v === 'number' ? v : (v.value || 0);
            var bc = val > 70 ? '#f44' : val > 40 ? '#fa0' : '#0ff';
            html += '<div style="flex:1;background:' + bc + ';height:' + Math.max(2, val) + '%;border-radius:2px 2px 0 0;min-width:2px;"></div>';
          });
          html += '</div></div>';
        }
        document.getElementById('spectroContent').innerHTML = html;
      }).catch(function() { document.getElementById('spectroContent').innerHTML = '<div style="color:#f44;">Failed to load</div>'; });
    }
    refresh(); setInterval(refresh, 15000);
  };

  // ═══════════════════════════════════════════════════════════════════
  // Expose all panels
  // ═══════════════════════════════════════════════════════════════════
  window._features_v5 = {
    loadAgiObjectives: window.loadAgiObjectives,
    loadAgiExperiments: window.loadAgiExperiments,
    loadAgiCompiler: window.loadAgiCompiler,
    loadAgiMetabolism: window.loadAgiMetabolism,
    loadAgiForgetting: window.loadAgiForgetting,
    loadAgiDebt: window.loadAgiDebt,
    loadAgiConsolidation: window.loadAgiConsolidation,
    loadAgiSynthesis: window.loadAgiSynthesis,
    loadAgiTemporal: window.loadAgiTemporal,
    loadAgiArchaeology: window.loadAgiArchaeology,
    loadAgiFossils: window.loadAgiFossils,
    loadAgiImmune: window.loadAgiImmune,
    loadAgiShadow: window.loadAgiShadow,
    loadAgiMoral: window.loadAgiMoral,
    loadAgiConsensus: window.loadAgiConsensus,
    loadAgiAbyss: window.loadAgiAbyss,
    loadAgiPredictive: window.loadAgiPredictive,
    loadAgiStranger: window.loadAgiStranger,
    loadAgiGod: window.loadAgiGod,
    loadAgiSpectro: window.loadAgiSpectro
  };

})();
