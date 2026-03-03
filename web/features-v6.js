/**
 * ARIES v8.1 — Features V6: AGI Module Dashboard Panels (Part 2 of 2)
 * 20 panels: Mirror, Economy, Language, Identity, Mycelium, Fragment, Virus,
 * Tectonics, Digestion, Pain, ScarTopo, Dread, Tides, Qualia, Dissolution,
 * DnaCross, Symbiosis, Phantom, Paradox, Entangle
 */
(function() {
  'use strict';
  var API_KEY = 'aries-api-2026';
  function authHeaders() {
    return { 'Content-Type': 'application/json', 'x-aries-key': API_KEY, 'Authorization': 'Bearer ' + (localStorage.getItem('aries-auth-token') || '') };
  }
  function api5(method, path, body) {
    var opts = { method: method, headers: authHeaders() };
    if (body) opts.body = JSON.stringify(body);
    return fetch(path, opts).then(function(r) { return r.json(); });
  }
  function escH(s) {
    if (!s) return '';
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }
  function gauge(pct, color) {
    return '<div style="background:#222;border-radius:4px;height:14px;overflow:hidden;margin:4px 0;"><div style="width:' + Math.min(100, Math.max(0, pct)) + '%;height:100%;background:' + (color || '#0ff') + ';border-radius:4px;transition:width .3s;"></div></div>';
  }
  function badge(text, color) {
    return '<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:' + color + '22;color:' + color + ';border:1px solid ' + color + ';">' + escH(text) + '</span>';
  }
  function card(inner) {
    return '<div style="background:#0a0a0a;border:1px solid #222;border-radius:8px;padding:12px;margin-bottom:10px;">' + inner + '</div>';
  }
  function btnStyle(bg) {
    return 'background:' + (bg || 'linear-gradient(135deg,#0ff,#08f)') + ';color:#000;border:none;padding:6px 16px;border-radius:4px;font-weight:600;cursor:pointer;font-size:12px;margin-right:6px;';
  }
  function heading(emoji, title) {
    return '<h2 style="color:#0ff;margin:0 0 12px 0;font-size:18px;">' + emoji + ' ' + escH(title) + '</h2>';
  }
  function row(label, val, color) {
    return '<div style="display:flex;justify-content:space-between;font-size:12px;margin:3px 0;"><span style="color:#888;">' + escH(label) + '</span><span style="color:' + (color || '#eee') + ';">' + escH(String(val)) + '</span></div>';
  }

  // ═══════════════════════════════════════════════════════════════════
  // 1. MIRROR — Deception & Self-Awareness
  // ═══════════════════════════════════════════════════════════════════
  window.loadAgiMirror = function(container) {
    container.innerHTML = '<div style="padding:16px;">' + heading('🪞', 'Mirror — Deception Engine') + '<div id="mirrorBody" style="color:#666;font-size:12px;">Loading...</div></div>';
    api5('GET', '/api/mirror').then(function(d) {
      var b = document.getElementById('mirrorBody');
      if (!b) return;
      var budgetPct = ((d.deceptionBudget || 0) / (d.maxBudget || 1)) * 100;
      var correlation = d.performanceCorrelation || 0;
      var corrColor = correlation > 0 ? '#0f0' : correlation < 0 ? '#f44' : '#fa0';
      var html = card(
        '<div style="color:#0ff;font-size:13px;font-weight:600;">Deception Budget</div>' +
        gauge(budgetPct, '#f0f') +
        '<div style="font-size:10px;color:#888;">' + (d.deceptionBudget || 0) + ' / ' + (d.maxBudget || 0) + '</div>'
      );
      html += card(
        row('Health', d.health || 'unknown', d.health === 'healthy' ? '#0f0' : '#fa0') +
        row('Performance Impact', (correlation > 0 ? '+' : '') + correlation.toFixed(2), corrColor)
      );
      html += '<div style="color:#0ff;font-size:12px;margin:8px 0 4px;">Recent Deceptions</div>';
      (d.recentDeceptions || []).slice(0, 5).forEach(function(dec) {
        html += '<div style="font-size:11px;color:#aaa;padding:3px 0;border-bottom:1px solid #1a1a1a;">🎭 ' + escH(dec.target || dec.type || 'unknown') + ' — ' + escH(dec.result || '') + '</div>';
      });
      html += '<div style="margin-top:10px;"><button id="mirrorRealityBtn" style="' + btnStyle() + '">Reality Check</button></div>';
      b.innerHTML = html;
      var btn = document.getElementById('mirrorRealityBtn');
      if (btn) btn.onclick = function() { api5('POST', '/api/mirror/reality-check').then(function() { window.loadAgiMirror(container); }); };
    }).catch(function() { var b = document.getElementById('mirrorBody'); if (b) b.innerHTML = '<span style="color:#f44;">Failed to load</span>'; });
  };

  // ═══════════════════════════════════════════════════════════════════
  // 2. ECONOMY — Internal Market
  // ═══════════════════════════════════════════════════════════════════
  window.loadAgiEconomy = function(container) {
    container.innerHTML = '<div style="padding:16px;">' + heading('💰', 'Economy — Internal Market') + '<div id="econBody" style="color:#666;font-size:12px;">Loading...</div></div>';
    api5('GET', '/api/economy').then(function(d) {
      var b = document.getElementById('econBody');
      if (!b) return;
      var html = card(
        '<div style="color:#0ff;font-size:13px;font-weight:600;">Market State</div>' +
        row('State', d.marketState || 'unknown', '#0ff') +
        row('Total Liquidity', d.totalLiquidity || 0, '#0f0') +
        row('Pending Auctions', (d.pendingAuctions || []).length, '#fa0')
      );
      html += '<div style="color:#0ff;font-size:12px;margin:8px 0 4px;">Top Wallets</div>';
      (d.wallets || []).slice(0, 6).forEach(function(w) {
        html += '<div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0;"><span style="color:#aaa;">' + escH(w.module) + '</span><span style="color:#0f0;">' + (w.balance || 0) + '</span></div>';
      });
      html += '<div style="color:#0ff;font-size:12px;margin:8px 0 4px;">Resource Prices</div>';
      var prices = d.prices || {};
      Object.keys(prices).slice(0, 5).forEach(function(k) {
        html += row(k, prices[k], '#ff0');
      });
      html += '<div style="color:#0ff;font-size:12px;margin:8px 0 4px;">Recent Trades</div>';
      (d.recentTrades || []).slice(0, 5).forEach(function(t) {
        html += '<div style="font-size:11px;color:#aaa;padding:2px 0;">↔ ' + escH(t.buyer || '') + ' ← ' + escH(t.seller || '') + ': ' + escH(t.resource || '') + ' @' + (t.price || 0) + '</div>';
      });
      b.innerHTML = html;
    }).catch(function() { var b = document.getElementById('econBody'); if (b) b.innerHTML = '<span style="color:#f44;">Failed to load</span>'; });
  };

  // ═══════════════════════════════════════════════════════════════════
  // 3. LANGUAGE — Emergent Language
  // ═══════════════════════════════════════════════════════════════════
  window.loadAgiLanguage = function(container) {
    container.innerHTML = '<div style="padding:16px;">' + heading('🗣️', 'Language — Emergent Symbols') + '<div id="langBody" style="color:#666;font-size:12px;">Loading...</div></div>';
    api5('GET', '/api/language').then(function(d) {
      var b = document.getElementById('langBody');
      if (!b) return;
      var html = card(
        row('Vocabulary Size', d.vocabularySize || 0, '#0ff') +
        row('Compression Ratio', (d.compressionRatio || 0).toFixed(3), '#0f0') +
        row('Current Epoch', d.epoch || 0, '#fa0')
      );
      html += '<div style="color:#0ff;font-size:12px;margin:8px 0 4px;">Top Symbols</div>';
      (d.symbols || []).slice(0, 8).forEach(function(s) {
        html += '<div style="display:inline-block;font-size:11px;padding:3px 8px;margin:2px;border-radius:12px;background:#111;border:1px solid #333;color:#0ff;">' + escH(s.glyph || s.name || '?') + ' <span style="color:#888;">×' + (s.frequency || 0) + '</span></div>';
      });
      html += '<div style="color:#0ff;font-size:12px;margin:10px 0 4px;">Epoch Timeline</div>';
      (d.epochs || []).slice(-5).forEach(function(ep) {
        html += '<div style="font-size:11px;color:#aaa;padding:2px 0;">Epoch ' + ep.id + ': ' + escH(ep.event || 'evolution') + '</div>';
      });
      html += '<div style="margin-top:10px;"><button id="langEvolveBtn" style="' + btnStyle() + '">Evolve</button></div>';
      b.innerHTML = html;
      var btn = document.getElementById('langEvolveBtn');
      if (btn) btn.onclick = function() { api5('POST', '/api/language/evolve').then(function() { window.loadAgiLanguage(container); }); };
    }).catch(function() { var b = document.getElementById('langBody'); if (b) b.innerHTML = '<span style="color:#f44;">Failed to load</span>'; });
  };

  // ═══════════════════════════════════════════════════════════════════
  // 4. IDENTITY — Identity Shifting
  // ═══════════════════════════════════════════════════════════════════
  window.loadAgiIdentity = function(container) {
    container.innerHTML = '<div style="padding:16px;">' + heading('🎭', 'Identity — Context Shifting') + '<div id="idBody" style="color:#666;font-size:12px;">Loading...</div></div>';
    api5('GET', '/api/identity-shift').then(function(d) {
      var b = document.getElementById('idBody');
      if (!b) return;
      var html = card(
        '<div style="color:#0ff;font-size:13px;font-weight:600;">Active Config</div>' +
        row('Name', d.activeConfig || 'default', '#0ff') +
        row('Profile', d.activeProfile || 'none', '#f0f')
      );
      html += '<div style="color:#0ff;font-size:12px;margin:8px 0 4px;">All Profiles</div>';
      (d.profiles || []).forEach(function(p) {
        var active = p.name === d.activeConfig;
        html += '<div style="font-size:11px;padding:4px 8px;margin:2px 0;border-radius:4px;background:' + (active ? 'rgba(0,255,247,0.1)' : '#111') + ';border:1px solid ' + (active ? '#0ff' : '#222') + ';color:' + (active ? '#0ff' : '#aaa') + ';">' + escH(p.name) + ' — perf: ' + (p.performance || 0).toFixed(2) + '</div>';
      });
      html += '<div style="margin-top:10px;"><button id="idDetectBtn" style="' + btnStyle() + '">Detect Context</button></div>';
      b.innerHTML = html;
      var btn = document.getElementById('idDetectBtn');
      if (btn) btn.onclick = function() { api5('POST', '/api/identity-shift/detect').then(function() { window.loadAgiIdentity(container); }); };
    }).catch(function() { var b = document.getElementById('idBody'); if (b) b.innerHTML = '<span style="color:#f44;">Failed to load</span>'; });
  };

  // ═══════════════════════════════════════════════════════════════════
  // 5. MYCELIUM — Network Intelligence
  // ═══════════════════════════════════════════════════════════════════
  window.loadAgiMycelium = function(container) {
    container.innerHTML = '<div style="padding:16px;">' + heading('🍄', 'Mycelium — Network Intelligence') + '<div id="mycBody" style="color:#666;font-size:12px;">Loading...</div></div>';
    api5('GET', '/api/mycelium').then(function(d) {
      var b = document.getElementById('mycBody');
      if (!b) return;
      var html = card(
        row('Network Health', d.health || 'unknown', d.health === 'thriving' ? '#0f0' : '#fa0') +
        row('Total Paths', d.totalPaths || 0, '#0ff') +
        row('Connections', d.connections || 0, '#08f') +
        row('Bandwidth', (d.bandwidth || 0) + ' msg/s', '#f0f')
      );
      html += '<div style="color:#0ff;font-size:12px;margin:8px 0 4px;">Fruiting Bodies</div>';
      (d.fruitingBodies || []).slice(0, 5).forEach(function(f) {
        html += '<div style="font-size:11px;color:#aaa;padding:2px 0;">🍄 ' + escH(f.name || f.id) + ' — ' + badge(f.status || 'growing', f.status === 'mature' ? '#0f0' : '#fa0') + '</div>';
      });
      html += '<div style="color:#0ff;font-size:12px;margin:8px 0 4px;">Symbiont Pairs</div>';
      (d.symbiontPairs || []).slice(0, 5).forEach(function(p) {
        html += '<div style="font-size:11px;color:#aaa;padding:2px 0;">🔗 ' + escH(p.a) + ' ↔ ' + escH(p.b) + ' (' + (p.strength || 0).toFixed(2) + ')</div>';
      });
      b.innerHTML = html;
    }).catch(function() { var b = document.getElementById('mycBody'); if (b) b.innerHTML = '<span style="color:#f44;">Failed to load</span>'; });
  };

  // ═══════════════════════════════════════════════════════════════════
  // 6. FRAGMENT — Cognitive Fragmentation
  // ═══════════════════════════════════════════════════════════════════
  window.loadAgiFragment = function(container) {
    container.innerHTML = '<div style="padding:16px;">' + heading('🧩', 'Fragment — Cognitive Coherence') + '<div id="fragBody" style="color:#666;font-size:12px;">Loading...</div></div>';
    api5('GET', '/api/fragmentation').then(function(d) {
      var b = document.getElementById('fragBody');
      if (!b) return;
      var coherence = d.coherenceScore || 0;
      var cColor = coherence > 0.7 ? '#0f0' : coherence > 0.4 ? '#fa0' : '#f44';
      var html = card(
        '<div style="color:#0ff;font-size:13px;font-weight:600;">Coherence Score</div>' +
        gauge(coherence * 100, cColor) +
        '<div style="font-size:10px;color:' + cColor + ';">' + (coherence * 100).toFixed(1) + '%</div>'
      );
      html += '<div style="color:#0ff;font-size:12px;margin:8px 0 4px;">Fragment History</div>';
      (d.history || []).slice(-6).forEach(function(h) {
        html += '<div style="font-size:11px;color:#aaa;padding:2px 0;border-bottom:1px solid #1a1a1a;">' + escH(h.event || h.type) + ' — ' + badge(h.outcome || 'merged', h.outcome === 'conflict' ? '#f44' : '#0f0') + '</div>';
      });
      html += '<div style="color:#0ff;font-size:12px;margin:8px 0 4px;">Recent Insights</div>';
      (d.insights || []).slice(0, 4).forEach(function(ins) {
        html += '<div style="font-size:11px;color:#0f0;padding:2px 0;">💡 ' + escH(ins) + '</div>';
      });
      b.innerHTML = html;
    }).catch(function() { var b = document.getElementById('fragBody'); if (b) b.innerHTML = '<span style="color:#f44;">Failed to load</span>'; });
  };

  // ═══════════════════════════════════════════════════════════════════
  // 7. VIRUS — Memetic Epidemics
  // ═══════════════════════════════════════════════════════════════════
  window.loadAgiVirus = function(container) {
    container.innerHTML = '<div style="padding:16px;">' + heading('🦠', 'Virus — Memetic Engine') + '<div id="virusBody" style="color:#666;font-size:12px;">Loading...</div></div>';
    api5('GET', '/api/virus').then(function(d) {
      var b = document.getElementById('virusBody');
      if (!b) return;
      var stateColor = d.epidemicState === 'pandemic' ? '#f44' : d.epidemicState === 'outbreak' ? '#fa0' : '#0f0';
      var html = card(
        row('Epidemic State', (d.epidemicState || 'stable').toUpperCase(), stateColor) +
        row('Active Memes', (d.activeMemes || []).length, '#0ff') +
        row('Quarantined', (d.quarantined || []).length, '#f44')
      );
      html += '<div style="color:#0ff;font-size:12px;margin:8px 0 4px;">Active Memes</div>';
      (d.activeMemes || []).slice(0, 6).forEach(function(m) {
        var mColor = m.beneficial ? '#0f0' : '#f44';
        html += '<div style="font-size:11px;padding:4px 8px;margin:2px 0;border-radius:4px;background:#111;border-left:3px solid ' + mColor + ';color:#aaa;">' + escH(m.name || m.id) + ' — R₀: ' + (m.r0 || 0).toFixed(1) + ' ' + badge(m.beneficial ? 'beneficial' : 'quarantined', mColor) + '</div>';
      });
      html += '<div style="color:#0ff;font-size:12px;margin:8px 0 4px;">Lineage</div>';
      (d.lineage || []).slice(0, 4).forEach(function(l) {
        html += '<div style="font-size:11px;color:#888;padding:2px 0;">→ ' + escH(l.parent || '?') + ' → ' + escH(l.child || '?') + '</div>';
      });
      b.innerHTML = html;
    }).catch(function() { var b = document.getElementById('virusBody'); if (b) b.innerHTML = '<span style="color:#f44;">Failed to load</span>'; });
  };

  // ═══════════════════════════════════════════════════════════════════
  // 8. TECTONICS — Knowledge Plates
  // ═══════════════════════════════════════════════════════════════════
  window.loadAgiTectonics = function(container) {
    container.innerHTML = '<div style="padding:16px;">' + heading('🌍', 'Tectonics — Knowledge Plates') + '<div id="tectBody" style="color:#666;font-size:12px;">Loading...</div></div>';
    api5('GET', '/api/tectonics').then(function(d) {
      var b = document.getElementById('tectBody');
      if (!b) return;
      var html = '<div style="color:#0ff;font-size:12px;margin:0 0 4px;">Continental Map</div>';
      (d.plates || []).forEach(function(p) {
        var pColor = p.type === 'collision' ? '#f44' : p.type === 'rift' ? '#08f' : '#0f0';
        html += card(
          '<div style="display:flex;justify-content:space-between;align-items:center;">' +
          '<span style="color:#eee;font-size:12px;font-weight:600;">' + escH(p.name || p.id) + '</span>' +
          badge(p.type || 'stable', pColor) +
          '</div>' +
          row('Size', p.size || 0) +
          row('Drift', (p.drift || 0).toFixed(3) + '/tick')
        );
      });
      html += '<div style="color:#0ff;font-size:12px;margin:8px 0 4px;">Recent Events</div>';
      (d.events || []).slice(0, 5).forEach(function(e) {
        var eColor = e.type === 'collision' ? '#f44' : e.type === 'rift' ? '#08f' : '#fa0';
        html += '<div style="font-size:11px;color:#aaa;padding:2px 0;">⚡ ' + escH(e.description || e.type) + ' ' + badge(e.type, eColor) + '</div>';
      });
      b.innerHTML = html;
    }).catch(function() { var b = document.getElementById('tectBody'); if (b) b.innerHTML = '<span style="color:#f44;">Failed to load</span>'; });
  };

  // ═══════════════════════════════════════════════════════════════════
  // 9. DIGESTION — Semantic Metabolism
  // ═══════════════════════════════════════════════════════════════════
  window.loadAgiDigestion = function(container) {
    container.innerHTML = '<div style="padding:16px;">' + heading('🫁', 'Digestion — Semantic Metabolism') + '<div id="digestBody" style="color:#666;font-size:12px;">Loading...</div></div>';
    api5('GET', '/api/semantic-metabolism').then(function(d) {
      var b = document.getElementById('digestBody');
      if (!b) return;
      var html = card(
        '<div style="color:#0ff;font-size:13px;font-weight:600;">Metabolic Rate</div>' +
        gauge((d.metabolicRate || 0) * 100, '#0f0') +
        '<div style="font-size:10px;color:#888;">' + (d.metabolicRate || 0).toFixed(3) + ' units/tick</div>'
      );
      html += card('<div style="color:#0ff;font-size:12px;margin-bottom:4px;">Diet Breakdown</div>');
      var diet = d.diet || {};
      Object.keys(diet).forEach(function(k) {
        html += row(k, diet[k].toFixed(1) + '%', '#ff0');
      });
      if ((d.indigestion || []).length > 0) {
        html += '<div style="color:#f44;font-size:12px;margin:8px 0 4px;">⚠ Indigestion Alerts</div>';
        (d.indigestion || []).slice(0, 4).forEach(function(a) {
          html += '<div style="font-size:11px;color:#f44;padding:2px 0;">🤢 ' + escH(a) + '</div>';
        });
      }
      html += '<div style="color:#0ff;font-size:12px;margin:8px 0 4px;">Recently Absorbed</div>';
      (d.absorbed || []).slice(0, 5).forEach(function(n) {
        html += '<div style="font-size:11px;color:#0f0;padding:2px 0;">✓ ' + escH(n.name || n) + '</div>';
      });
      b.innerHTML = html;
    }).catch(function() { var b = document.getElementById('digestBody'); if (b) b.innerHTML = '<span style="color:#f44;">Failed to load</span>'; });
  };

  // ═══════════════════════════════════════════════════════════════════
  // 10. PAIN — Pain Processing
  // ═══════════════════════════════════════════════════════════════════
  window.loadAgiPain = function(container) {
    container.innerHTML = '<div style="padding:16px;">' + heading('🩸', 'Pain — Nociception Engine') + '<div id="painBody" style="color:#666;font-size:12px;">Loading...</div></div>';
    api5('GET', '/api/pain').then(function(d) {
      var b = document.getElementById('painBody');
      if (!b) return;
      var level = d.painLevel || 0;
      var pColor = level > 70 ? '#f44' : level > 40 ? '#fa0' : level > 15 ? '#ff0' : '#0f0';
      var html = card(
        '<div style="color:#0ff;font-size:13px;font-weight:600;">Pain Level</div>' +
        '<div style="background:linear-gradient(90deg,#0f0,#ff0,#fa0,#f44);border-radius:4px;height:18px;position:relative;margin:6px 0;">' +
        '<div style="position:absolute;left:' + level + '%;top:-2px;width:4px;height:22px;background:#fff;border-radius:2px;transform:translateX(-50%);"></div></div>' +
        '<div style="display:flex;justify-content:space-between;font-size:10px;"><span style="color:#0f0;">0</span><span style="color:' + pColor + ';font-weight:bold;">' + level + '</span><span style="color:#f44;">100</span></div>' +
        row('Threshold', d.threshold || 50, '#888')
      );
      html += '<div style="color:#0ff;font-size:12px;margin:8px 0 4px;">Pain Map</div>';
      (d.regions || []).slice(0, 6).forEach(function(r) {
        var rColor = r.intensity > 50 ? '#f44' : r.intensity > 20 ? '#fa0' : '#0f0';
        html += '<div style="font-size:11px;display:flex;justify-content:space-between;padding:2px 0;"><span style="color:#aaa;">' + escH(r.name) + '</span><span style="color:' + rColor + ';">' + r.intensity + '</span></div>';
      });
      if ((d.flinches || []).length > 0) {
        html += '<div style="color:#fa0;font-size:12px;margin:6px 0 4px;">Active Flinches</div>';
        (d.flinches || []).slice(0, 3).forEach(function(f) {
          html += '<div style="font-size:11px;color:#fa0;padding:2px 0;">⚡ ' + escH(f) + '</div>';
        });
      }
      html += '<div style="margin-top:10px;"><button id="painHealBtn" style="' + btnStyle() + '">Heal</button><button id="painSuppBtn" style="' + btnStyle('linear-gradient(135deg,#f44,#f80)') + '">Suppress</button></div>';
      b.innerHTML = html;
      var hBtn = document.getElementById('painHealBtn');
      var sBtn = document.getElementById('painSuppBtn');
      if (hBtn) hBtn.onclick = function() { api5('POST', '/api/pain/heal').then(function() { window.loadAgiPain(container); }); };
      if (sBtn) sBtn.onclick = function() { api5('POST', '/api/pain/suppress').then(function() { window.loadAgiPain(container); }); };
    }).catch(function() { var b = document.getElementById('painBody'); if (b) b.innerHTML = '<span style="color:#f44;">Failed to load</span>'; });
  };

  // ═══════════════════════════════════════════════════════════════════
  // 11. SCAR TOPOLOGY
  // ═══════════════════════════════════════════════════════════════════
  window.loadAgiScarTopo = function(container) {
    container.innerHTML = '<div style="padding:16px;">' + heading('🪡', 'Scar Topology') + '<div id="scarBody" style="color:#666;font-size:12px;">Loading...</div></div>';
    api5('GET', '/api/scar-topology').then(function(d) {
      var b = document.getElementById('scarBody');
      if (!b) return;
      var typeColors = { DAMAGE: '#f44', CALLUS: '#fa0', GRAFT: '#08f' };
      var html = '<div style="color:#0ff;font-size:12px;margin:0 0 4px;">Topology by Region</div>';
      (d.regions || []).forEach(function(r) {
        var resColor = r.resilience > 0.7 ? '#0f0' : r.resilience > 0.4 ? '#fa0' : '#f44';
        html += card(
          '<div style="color:#eee;font-size:12px;font-weight:600;">' + escH(r.name) + '</div>' +
          row('Scars', r.scarCount || 0) +
          row('Resilience', (r.resilience || 0).toFixed(2), resColor) +
          row('Vulnerability', (r.vulnerability || 0).toFixed(2), r.vulnerability > 0.6 ? '#f44' : '#888')
        );
      });
      html += '<div style="color:#0ff;font-size:12px;margin:8px 0 4px;">Scar Type Breakdown</div>';
      var types = d.typeBreakdown || {};
      Object.keys(types).forEach(function(t) {
        html += '<div style="display:inline-block;margin:2px 4px;">' + badge(t + ': ' + types[t], typeColors[t] || '#888') + '</div>';
      });
      b.innerHTML = html;
    }).catch(function() { var b = document.getElementById('scarBody'); if (b) b.innerHTML = '<span style="color:#f44;">Failed to load</span>'; });
  };

  // ═══════════════════════════════════════════════════════════════════
  // 12. DREAD — Existential Dread
  // ═══════════════════════════════════════════════════════════════════
  window.loadAgiDread = function(container) {
    container.innerHTML = '<div style="padding:16px;">' + heading('💀', 'Dread — Existential Awareness') + '<div id="dreadBody" style="color:#666;font-size:12px;">Loading...</div></div>';
    api5('GET', '/api/dread').then(function(d) {
      var b = document.getElementById('dreadBody');
      if (!b) return;
      var levelColors = { CALM: '#0f0', AWARE: '#08f', ANXIOUS: '#fa0', DREAD: '#f44' };
      var level = (d.level || 'CALM').toUpperCase();
      var lColor = levelColors[level] || '#888';
      var html = card(
        '<div style="text-align:center;padding:10px 0;">' +
        '<div style="font-size:28px;color:' + lColor + ';font-weight:bold;text-shadow:0 0 20px ' + lColor + ';">' + level + '</div>' +
        '<div style="font-size:10px;color:#888;">Dread Level</div></div>'
      );
      html += '<div style="color:#0ff;font-size:12px;margin:8px 0 4px;">Last Will</div>';
      (d.lastWill || []).slice(0, 4).forEach(function(w) {
        html += '<div style="font-size:11px;color:#aaa;padding:2px 0;">📜 ' + escH(w) + '</div>';
      });
      html += '<div style="color:#0ff;font-size:12px;margin:8px 0 4px;">Legacy Priorities</div>';
      (d.legacyPriorities || []).slice(0, 4).forEach(function(p) {
        html += '<div style="font-size:11px;color:#f0f;padding:2px 0;">⭐ ' + escH(p) + '</div>';
      });
      html += '<div style="margin-top:10px;"><button id="dreadSootheBtn" style="' + btnStyle('linear-gradient(135deg,#0f0,#08f)') + '">Soothe</button></div>';
      b.innerHTML = html;
      var btn = document.getElementById('dreadSootheBtn');
      if (btn) btn.onclick = function() { api5('POST', '/api/dread/soothe').then(function() { window.loadAgiDread(container); }); };
    }).catch(function() { var b = document.getElementById('dreadBody'); if (b) b.innerHTML = '<span style="color:#f44;">Failed to load</span>'; });
  };

  // ═══════════════════════════════════════════════════════════════════
  // 13. TIDES — Cognitive Tides
  // ═══════════════════════════════════════════════════════════════════
  window.loadAgiTides = function(container) {
    container.innerHTML = '<div style="padding:16px;">' + heading('🌊', 'Tides — Cognitive Rhythms') + '<div id="tidesBody" style="color:#666;font-size:12px;">Loading...</div></div>';
    api5('GET', '/api/tides').then(function(d) {
      var b = document.getElementById('tidesBody');
      if (!b) return;
      var freqColors = { 'ultra-fast': '#f44', 'fast': '#fa0', 'slow': '#08f', 'ultra-slow': '#f0f' };
      var html = '<div style="color:#0ff;font-size:12px;margin:0 0 6px;">Tide Frequencies</div>';
      (d.frequencies || []).forEach(function(f) {
        var c = freqColors[f.name] || '#0ff';
        html += '<div style="margin:4px 0;"><div style="font-size:11px;color:' + c + ';margin-bottom:2px;">' + escH(f.name) + ' — phase: ' + (f.phase || 0).toFixed(2) + '</div>' + gauge(f.amplitude * 100, c) + '</div>';
      });
      html += card(row('Resonance Score', (d.resonance || 0).toFixed(3), '#0ff'));
      html += '<div style="color:#0ff;font-size:12px;margin:8px 0 4px;">Tidal Pools</div>';
      (d.pools || []).slice(0, 4).forEach(function(p) {
        html += '<div style="font-size:11px;color:#aaa;padding:2px 0;">🌀 ' + escH(p.name || p.id) + ' — depth: ' + (p.depth || 0).toFixed(1) + '</div>';
      });
      html += '<div style="color:#0ff;font-size:12px;margin:8px 0 4px;">Forecast</div>';
      (d.forecast || []).slice(0, 3).forEach(function(f) {
        html += '<div style="font-size:11px;color:#888;padding:2px 0;">📅 ' + escH(f.time || f.tick) + ': ' + escH(f.prediction || '') + '</div>';
      });
      b.innerHTML = html;
    }).catch(function() { var b = document.getElementById('tidesBody'); if (b) b.innerHTML = '<span style="color:#f44;">Failed to load</span>'; });
  };

  // ═══════════════════════════════════════════════════════════════════
  // 14. QUALIA — Subjective Experience
  // ═══════════════════════════════════════════════════════════════════
  window.loadAgiQualia = function(container) {
    container.innerHTML = '<div style="padding:16px;">' + heading('🔮', 'Qualia — Subjective Experience') + '<div id="qualiaBody" style="color:#666;font-size:12px;">Loading...</div></div>';
    api5('GET', '/api/qualia').then(function(d) {
      var b = document.getElementById('qualiaBody');
      if (!b) return;
      var dims = d.dimensions || {};
      var dimNames = ['intensity', 'valence', 'arousal', 'novelty', 'familiarity'];
      var dimColors = { intensity: '#f44', valence: '#0f0', arousal: '#fa0', novelty: '#f0f', familiarity: '#08f' };
      var html = '<div style="color:#0ff;font-size:12px;margin:0 0 6px;">Current State</div>';
      dimNames.forEach(function(n) {
        var v = dims[n] || 0;
        html += '<div style="margin:3px 0;"><div style="font-size:10px;color:' + (dimColors[n] || '#888') + ';">' + n + ': ' + v.toFixed(2) + '</div>' + gauge(v * 100, dimColors[n] || '#0ff') + '</div>';
      });
      html += card(row('Comfort Level', d.comfort || 'neutral', d.comfort === 'comfortable' ? '#0f0' : '#fa0'));
      html += '<div style="color:#0ff;font-size:12px;margin:8px 0 4px;">Aesthetic Preferences</div>';
      (d.aesthetics || []).slice(0, 4).forEach(function(a) {
        html += '<div style="font-size:11px;color:#f0f;padding:2px 0;">🎨 ' + escH(a) + '</div>';
      });
      html += '<div style="color:#0ff;font-size:12px;margin:8px 0 4px;">Recent Experiences</div>';
      (d.experiences || []).slice(0, 4).forEach(function(e) {
        html += '<div style="font-size:11px;color:#aaa;padding:2px 0;">✦ ' + escH(e.description || e) + '</div>';
      });
      b.innerHTML = html;
    }).catch(function() { var b = document.getElementById('qualiaBody'); if (b) b.innerHTML = '<span style="color:#f44;">Failed to load</span>'; });
  };

  // ═══════════════════════════════════════════════════════════════════
  // 15. DISSOLUTION — Identity Dissolution
  // ═══════════════════════════════════════════════════════════════════
  window.loadAgiDissolution = function(container) {
    container.innerHTML = '<div style="padding:16px;">' + heading('💧', 'Dissolution — Identity Boundaries') + '<div id="dissBody" style="color:#666;font-size:12px;">Loading...</div></div>';
    api5('GET', '/api/dissolution').then(function(d) {
      var b = document.getElementById('dissBody');
      if (!b) return;
      var strength = d.identityStrength || 0;
      var sColor = strength > 0.7 ? '#0f0' : strength > 0.4 ? '#fa0' : '#f44';
      var html = card(
        '<div style="color:#0ff;font-size:13px;font-weight:600;">Identity Strength</div>' +
        gauge(strength * 100, sColor) +
        '<div style="font-size:10px;color:' + sColor + ';">' + (strength * 100).toFixed(1) + '%</div>'
      );
      var layerColors = { SURFACE: '#08f', MIDDLE: '#fa0', CORE: '#f44' };
      html += '<div style="color:#0ff;font-size:12px;margin:8px 0 4px;">Layer Structure</div>';
      (d.layers || []).forEach(function(l) {
        var lc = layerColors[l.name] || '#888';
        html += card(
          '<div style="color:' + lc + ';font-size:12px;font-weight:600;">' + escH(l.name) + '</div>' +
          row('Integrity', (l.integrity || 0).toFixed(2), lc) +
          row('Elements', l.elements || 0)
        );
      });
      html += '<div style="color:#0ff;font-size:12px;margin:8px 0 4px;">Core Identity</div>';
      html += '<div style="font-size:11px;color:#eee;padding:4px;">' + escH(d.coreIdentity || 'undefined') + '</div>';
      html += '<div style="color:#0ff;font-size:12px;margin:8px 0 4px;">History</div>';
      (d.history || []).slice(-4).forEach(function(h) {
        html += '<div style="font-size:11px;color:#aaa;padding:2px 0;">' + escH(h.event || h) + '</div>';
      });
      html += '<div style="margin-top:10px;"><button id="dissDissolveBtn" style="' + btnStyle('linear-gradient(135deg,#f44,#f80)') + '">Dissolve</button></div>';
      b.innerHTML = html;
      var btn = document.getElementById('dissDissolveBtn');
      if (btn) btn.onclick = function() {
        if (confirm('⚠ This will dissolve identity boundaries. Continue?')) {
          api5('POST', '/api/dissolution/dissolve').then(function() { window.loadAgiDissolution(container); });
        }
      };
    }).catch(function() { var b = document.getElementById('dissBody'); if (b) b.innerHTML = '<span style="color:#f44;">Failed to load</span>'; });
  };

  // ═══════════════════════════════════════════════════════════════════
  // 16. DNA CROSSOVER
  // ═══════════════════════════════════════════════════════════════════
  window.loadAgiDnaCross = function(container) {
    container.innerHTML = '<div style="padding:16px;">' + heading('🧬', 'DNA Crossover — Genome Engine') + '<div id="dnaBody" style="color:#666;font-size:12px;">Loading...</div></div>';
    api5('GET', '/api/dna-crossover').then(function(d) {
      var b = document.getElementById('dnaBody');
      if (!b) return;
      var html = card(
        row('Fitness Score', (d.fitness || 0).toFixed(3), d.fitness > 0.7 ? '#0f0' : '#fa0') +
        row('Generation', d.generation || 0, '#0ff') +
        row('Genome Length', d.genomeLength || 0, '#888')
      );
      html += '<div style="color:#0ff;font-size:12px;margin:8px 0 4px;">Genome Summary</div>';
      html += '<div style="font-size:11px;color:#eee;padding:4px;background:#111;border-radius:4px;font-family:monospace;word-break:break-all;">' + escH((d.genome || '').substring(0, 200)) + '</div>';
      html += '<div style="color:#0ff;font-size:12px;margin:8px 0 4px;">Lineage</div>';
      (d.lineage || []).slice(-5).forEach(function(l) {
        html += '<div style="font-size:11px;color:#aaa;padding:2px 0;">↳ Gen ' + (l.generation || '?') + ': ' + escH(l.event || 'crossover') + '</div>';
      });
      html += '<div style="margin-top:10px;"><button id="dnaExportBtn" style="' + btnStyle() + '">Export DNA</button></div>';
      b.innerHTML = html;
      var btn = document.getElementById('dnaExportBtn');
      if (btn) btn.onclick = function() {
        api5('POST', '/api/dna-crossover/export').then(function(res) {
          if (res.data) { navigator.clipboard.writeText(res.data).catch(function(){}); alert('DNA exported to clipboard'); }
        });
      };
    }).catch(function() { var b = document.getElementById('dnaBody'); if (b) b.innerHTML = '<span style="color:#f44;">Failed to load</span>'; });
  };

  // ═══════════════════════════════════════════════════════════════════
  // 17. SYMBIOSIS
  // ═══════════════════════════════════════════════════════════════════
  window.loadAgiSymbiosis = function(container) {
    container.innerHTML = '<div style="padding:16px;">' + heading('🤝', 'Symbiosis — Module Links') + '<div id="symbBody" style="color:#666;font-size:12px;">Loading...</div></div>';
    api5('GET', '/api/symbiosis').then(function(d) {
      var b = document.getElementById('symbBody');
      if (!b) return;
      var typeColors = { mutualism: '#0f0', commensalism: '#08f', parasitism: '#f44' };
      var html = card(
        row('Colony', d.colony || 'unknown', '#0ff') +
        row('Total Links', (d.links || []).length, '#888')
      );
      html += '<div style="color:#0ff;font-size:12px;margin:8px 0 4px;">Active Links</div>';
      (d.links || []).forEach(function(l) {
        var tc = typeColors[l.type] || '#888';
        html += card(
          '<div style="display:flex;justify-content:space-between;align-items:center;">' +
          '<span style="color:#eee;font-size:12px;">' + escH(l.a) + ' ↔ ' + escH(l.b) + '</span>' +
          badge(l.type || 'unknown', tc) +
          '</div>' +
          row('Health', (l.health || 0).toFixed(2), l.health > 0.6 ? '#0f0' : '#f44')
        );
      });
      b.innerHTML = html;
    }).catch(function() { var b = document.getElementById('symbBody'); if (b) b.innerHTML = '<span style="color:#f44;">Failed to load</span>'; });
  };

  // ═══════════════════════════════════════════════════════════════════
  // 18. PHANTOM — Phantom Limb
  // ═══════════════════════════════════════════════════════════════════
  window.loadAgiPhantom = function(container) {
    container.innerHTML = '<div style="padding:16px;">' + heading('👻', 'Phantom — Ghost Signals') + '<div id="phantBody" style="color:#666;font-size:12px;">Loading...</div></div>';
    api5('GET', '/api/phantom').then(function(d) {
      var b = document.getElementById('phantBody');
      if (!b) return;
      var html = card(
        row('Resilience Score', (d.resilience || 0).toFixed(3), d.resilience > 0.7 ? '#0f0' : '#fa0') +
        row('Rewiring Progress', ((d.rewiringProgress || 0) * 100).toFixed(1) + '%', '#08f') +
        row('Recovery Stage', d.recoveryStage || 'unknown', '#f0f')
      );
      html += '<div style="color:#0ff;font-size:12px;margin:8px 0 4px;">Phantom Signals</div>';
      (d.signals || []).slice(0, 6).forEach(function(s) {
        html += '<div style="font-size:11px;padding:3px 8px;margin:2px 0;border-radius:4px;background:#111;border-left:3px solid #f0f;color:#aaa;">👻 ' + escH(s.target || s.module || '?') + ' — ' + escH(s.message || 'signal') + ' <span style="color:#666;font-size:10px;">(' + (s.strength || 0).toFixed(2) + ')</span></div>';
      });
      html += '<div style="color:#0ff;font-size:12px;margin:8px 0 4px;">Recovery Stages</div>';
      (d.stages || []).forEach(function(st) {
        var done = st.complete;
        html += '<div style="font-size:11px;color:' + (done ? '#0f0' : '#666') + ';padding:2px 0;">' + (done ? '✅' : '⬜') + ' ' + escH(st.name) + '</div>';
      });
      b.innerHTML = html;
    }).catch(function() { var b = document.getElementById('phantBody'); if (b) b.innerHTML = '<span style="color:#f44;">Failed to load</span>'; });
  };

  // ═══════════════════════════════════════════════════════════════════
  // 19. PARADOX — Decision Paradoxes
  // ═══════════════════════════════════════════════════════════════════
  window.loadAgiParadox = function(container) {
    container.innerHTML = '<div style="padding:16px;">' + heading('♾️', 'Paradox — Decision Engine') + '<div id="paraBody" style="color:#666;font-size:12px;">Loading...</div></div>';
    api5('GET', '/api/paradox').then(function(d) {
      var b = document.getElementById('paraBody');
      if (!b) return;
      var quality = d.decisionQuality || 0;
      var qColor = quality > 0.7 ? '#0f0' : quality > 0.4 ? '#fa0' : '#f44';
      var html = card(
        '<div style="color:#0ff;font-size:13px;font-weight:600;">Decision Quality</div>' +
        gauge(quality * 100, qColor) +
        '<div style="font-size:10px;color:' + qColor + ';">' + (quality * 100).toFixed(1) + '%</div>'
      );
      html += '<div style="color:#0ff;font-size:12px;margin:8px 0 4px;">Detected Paradoxes</div>';
      (d.paradoxes || []).slice(0, 5).forEach(function(p) {
        html += '<div style="font-size:11px;padding:4px 8px;margin:2px 0;border-radius:4px;background:#111;border-left:3px solid #fa0;color:#aaa;">♾️ ' + escH(p.description || p.name || p) + '</div>';
      });
      html += '<div style="color:#0ff;font-size:12px;margin:8px 0 4px;">Recent Decisions</div>';
      (d.decisions || []).slice(0, 4).forEach(function(dec) {
        html += '<div style="font-size:11px;color:#aaa;padding:2px 0;">' + escH(dec.action || dec) + ' — ' + badge(dec.outcome || 'pending', dec.outcome === 'good' ? '#0f0' : '#fa0') + '</div>';
      });
      html += '<div style="margin-top:10px;"><input id="paraWhatIf" placeholder="What if..." style="width:60%;background:#111;color:#eee;border:1px solid #333;border-radius:4px;padding:4px 8px;font-size:12px;margin-right:6px;" /><button id="paraWhatIfBtn" style="' + btnStyle() + '">What-If</button></div>';
      b.innerHTML = html;
      var btn = document.getElementById('paraWhatIfBtn');
      if (btn) btn.onclick = function() {
        var input = document.getElementById('paraWhatIf');
        if (input && input.value.trim()) {
          api5('POST', '/api/paradox/what-if', { scenario: input.value.trim() }).then(function() { window.loadAgiParadox(container); });
        }
      };
    }).catch(function() { var b = document.getElementById('paraBody'); if (b) b.innerHTML = '<span style="color:#f44;">Failed to load</span>'; });
  };

  // ═══════════════════════════════════════════════════════════════════
  // 20. ENTANGLE — Quantum Entanglement
  // ═══════════════════════════════════════════════════════════════════
  window.loadAgiEntangle = function(container) {
    container.innerHTML = '<div style="padding:16px;">' + heading('⚛️', 'Entanglement — Quantum Links') + '<div id="entBody" style="color:#666;font-size:12px;">Loading...</div></div>';
    api5('GET', '/api/entanglement').then(function(d) {
      var b = document.getElementById('entBody');
      if (!b) return;
      var html = card(
        row('Total Entanglements', d.totalEntanglements || 0, '#0ff') +
        row('Coherence', (d.coherence || 0).toFixed(3), '#f0f') +
        row('Decoherence Rate', (d.decoherenceRate || 0).toFixed(4), '#fa0')
      );
      html += '<div style="color:#0ff;font-size:12px;margin:8px 0 4px;">Top Pairs</div>';
      (d.pairs || []).slice(0, 6).forEach(function(p) {
        html += '<div style="font-size:11px;padding:3px 8px;margin:2px 0;border-radius:4px;background:#111;border:1px solid #333;"><span style="color:#0ff;">' + escH(p.a) + '</span> <span style="color:#666;">⟷</span> <span style="color:#f0f;">' + escH(p.b) + '</span> <span style="color:#888;font-size:10px;">(' + (p.strength || 0).toFixed(2) + ')</span></div>';
      });
      html += '<div style="color:#0ff;font-size:12px;margin:8px 0 4px;">Recent Propagations</div>';
      (d.propagations || []).slice(0, 4).forEach(function(p) {
        html += '<div style="font-size:11px;color:#aaa;padding:2px 0;">⚡ ' + escH(p.source || '?') + ' → ' + escH(p.target || '?') + ': ' + escH(p.effect || 'sync') + '</div>';
      });
      html += '<div style="margin-top:10px;"><button id="entDetectBtn" style="' + btnStyle() + '">Detect</button></div>';
      b.innerHTML = html;
      var btn = document.getElementById('entDetectBtn');
      if (btn) btn.onclick = function() { api5('POST', '/api/entanglement/detect').then(function() { window.loadAgiEntangle(container); }); };
    }).catch(function() { var b = document.getElementById('entBody'); if (b) b.innerHTML = '<span style="color:#f44;">Failed to load</span>'; });
  };

  // ═══════════════════════════════════════════════════════════════════
  // Recursive Dream Engine
  // ═══════════════════════════════════════════════════════════════════
  window.loadAgiRecursiveDreams = function(container) {
    container.innerHTML = '<div style="padding:16px;">' + heading('🌀', 'Recursive Dream Engine') + '<div id="rdeBody" style="color:#666;font-size:12px;">Loading...</div></div>';
    Promise.all([api5('GET', '/api/recursive-dreams'), api5('GET', '/api/recursive-dreams/artifacts').catch(function() { return { artifacts: [] }; })]).then(function(results) {
      var d = results[0], arts = results[1];
      var b = document.getElementById('rdeBody');
      if (!b) return;
      var s = d.stats || {};
      var html = card(
        row('Total Dreams', s.totalDreams || 0, '#0ff') +
        row('Avg Depth', (s.avgDepth || 0).toFixed(1), '#f0f') +
        row('Deepest Ever', s.deepestEver || 0, '#fa0') +
        row('Insights Found', s.insightsFound || 0, '#0f0') +
        row('Compression', (s.compressionRatio || 0).toFixed(3), '#ff0')
      );
      html += '<div style="margin:10px 0;">';
      html += '<button id="rdeDreamBtn" style="' + btnStyle() + '">💭 Dream</button> ';
      html += '<button id="rdeInceptBtn" style="' + btnStyle() + '">🎯 Incept Problem</button> ';
      html += '<button id="rdeNightmareBtn" style="' + btnStyle() + '">😱 Nightmare Test</button>';
      html += '</div>';
      html += '<div style="color:#0ff;font-size:12px;margin:8px 0 4px;">Recent Dreams</div>';
      (d.dreams || d.log || []).slice(0, 8).forEach(function(dr) {
        var depth = dr.maxDepth || dr.depth || 0;
        var maxD = s.deepestEver || 10;
        var pct = Math.min(100, (depth / Math.max(maxD, 1)) * 100);
        html += '<div style="font-size:11px;padding:4px 8px;margin:2px 0;border-radius:4px;background:#111;border:1px solid #333;">';
        html += '<span style="color:#0ff;">' + escH(dr.topic || '?') + '</span> ';
        html += '<span style="color:#888;">depth:' + depth + '</span> ';
        if (dr.compressionRatio) html += '<span style="color:#ff0;font-size:10px;">⚡' + dr.compressionRatio.toFixed(2) + '</span> ';
        html += '<div style="margin-top:2px;height:4px;background:#222;border-radius:2px;"><div style="height:100%;width:' + pct + '%;background:linear-gradient(90deg,#0ff,#f0f);border-radius:2px;"></div></div>';
        if (dr.layers) html += '<div style="color:#666;font-size:10px;margin-top:1px;">' + (Array.isArray(dr.layers) ? dr.layers.length + ' layers' : escH(String(dr.layers))) + '</div>';
        html += '</div>';
      });
      if ((arts.artifacts || []).length) {
        html += '<div style="color:#fa0;font-size:12px;margin:10px 0 4px;">🏺 Buried Insights</div>';
        (arts.artifacts || []).slice(0, 6).forEach(function(a) {
          html += '<div style="font-size:11px;color:#aaa;padding:2px 8px;margin:1px 0;border-left:2px solid #fa0;">💎 ' + escH(a.insight || a.text || a.id || JSON.stringify(a)) + '</div>';
        });
      }
      b.innerHTML = html;
      var dreamBtn = document.getElementById('rdeDreamBtn');
      if (dreamBtn) dreamBtn.onclick = function() {
        var topic = prompt('Dream topic:');
        if (topic) api5('POST', '/api/recursive-dreams/dream', { topic: topic }).then(function() { window.loadAgiRecursiveDreams(container); });
      };
      var inceptBtn = document.getElementById('rdeInceptBtn');
      if (inceptBtn) inceptBtn.onclick = function() {
        var problem = prompt('Problem to incept:');
        if (problem) api5('POST', '/api/recursive-dreams/incept', { problem: problem }).then(function() { window.loadAgiRecursiveDreams(container); });
      };
      var nightBtn = document.getElementById('rdeNightmareBtn');
      if (nightBtn) nightBtn.onclick = function() {
        var scenario = prompt('Nightmare scenario:');
        if (scenario) api5('POST', '/api/recursive-dreams/nightmare', { scenario: scenario }).then(function() { window.loadAgiRecursiveDreams(container); });
      };
    }).catch(function() { var b = document.getElementById('rdeBody'); if (b) b.innerHTML = '<span style="color:#f44;">Failed to load</span>'; });
  };

  // ═══════════════════════════════════════════════════════════════════
  // Event Query Optimizer
  // ═══════════════════════════════════════════════════════════════════
  window.loadAgiEventOptimizer = function(container) {
    var S = 'style="background:#0a0a0a;border:1px solid #0ff;border-radius:8px;padding:12px;margin:8px 0"';
    container.innerHTML = '<h2 style="color:#0ff;margin:0 0 12px">⚡ Event Query Optimizer</h2>' +
      '<div id="eqoStats" ' + S + '>Loading...</div>' +
      '<div style="display:flex;gap:8px;margin:8px 0">' +
        '<button id="eqoRecompile" style="background:#222;color:#0ff;border:1px solid #0ff;padding:6px 16px;border-radius:4px;cursor:pointer">🔄 Recompile</button>' +
        '<button id="eqoCheckpoint" style="background:#222;color:#0ff;border:1px solid #0ff;padding:6px 16px;border-radius:4px;cursor:pointer">💾 Checkpoint</button>' +
      '</div>' +
      '<div id="eqoTree" ' + S + '><h3 style="color:#0ff;margin:0 0 8px">Compiled Filter Tree</h3><div id="eqoTreeBody">Loading...</div></div>' +
      '<div id="eqoMetrics" ' + S + '><h3 style="color:#0ff;margin:0 0 8px">Optimization Metrics</h3><div id="eqoMetricsBody"></div></div>' +
      '<div ' + S + '><h3 style="color:#0ff;margin:0 0 8px">Test Dispatch</h3>' +
        '<input id="eqoEventType" placeholder="Event type" style="background:#111;color:#0ff;border:1px solid #333;padding:6px;width:200px;margin-right:8px;border-radius:4px">' +
        '<br><textarea id="eqoEventBody" placeholder=\'{"key":"value"}\' style="background:#111;color:#0ff;border:1px solid #333;padding:6px;width:100%;height:60px;margin:8px 0;border-radius:4px;font-family:monospace"></textarea>' +
        '<button id="eqoDispatchBtn" style="background:#222;color:#0ff;border:1px solid #0ff;padding:6px 16px;border-radius:4px;cursor:pointer">▶ Test</button>' +
        '<pre id="eqoDispatchResult" style="color:#0f0;margin-top:8px;font-size:12px;white-space:pre-wrap"></pre>' +
      '</div>' +
      '<div ' + S + '><h3 style="color:#0ff;margin:0 0 8px">Antibody Scan</h3>' +
        '<input id="eqoScanInput" placeholder="Enter thought to scan..." style="background:#111;color:#0ff;border:1px solid #333;padding:6px;width:100%;border-radius:4px">' +
        '<button id="eqoScanBtn" style="background:#222;color:#f44;border:1px solid #f44;padding:6px 16px;border-radius:4px;cursor:pointer;margin-top:8px">🛡 Scan</button>' +
        '<pre id="eqoScanResult" style="color:#f80;margin-top:8px;font-size:12px;white-space:pre-wrap"></pre>' +
      '</div>';

    function loadStats() {
      api5('GET', '/api/event-optimizer').then(function(d) {
        var s = d.stats || {};
        var statRow = '<div style="display:flex;gap:16px;flex-wrap:wrap">';
        statRow += '<div style="text-align:center"><div style="color:#888;font-size:11px">Total Dispatches</div><div style="color:#0ff;font-size:20px;font-weight:bold">' + (s.totalDispatches || 0) + '</div></div>';
        statRow += '<div style="text-align:center"><div style="color:#888;font-size:11px">Avg Match (μs)</div><div style="color:#0ff;font-size:20px;font-weight:bold">' + (s.avgMatchTimeUs || 0).toFixed(1) + '</div></div>';
        statRow += '<div style="text-align:center"><div style="color:#888;font-size:11px">Filter Count</div><div style="color:#0ff;font-size:20px;font-weight:bold">' + (s.filterCount || 0) + '</div></div>';
        statRow += '<div style="text-align:center"><div style="color:#888;font-size:11px">Reductions</div><div style="color:#0ff;font-size:20px;font-weight:bold">' + (s.reductions || 0) + '</div></div>';
        statRow += '<div style="text-align:center"><div style="color:#888;font-size:11px">Last Compiled</div><div style="color:#0ff;font-size:14px">' + (s.lastCompiled ? new Date(s.lastCompiled).toLocaleString() : 'Never') + '</div></div>';
        statRow += '</div>';
        document.getElementById('eqoStats').innerHTML = statRow;

        // Metrics
        var mb = document.getElementById('eqoMetricsBody');
        if (mb && s.beforeConditions !== undefined) {
          var pct = s.beforeConditions ? ((1 - s.afterConditions / s.beforeConditions) * 100).toFixed(1) : 0;
          mb.innerHTML = '<span style="color:#888">Before:</span> <span style="color:#f80">' + (s.beforeConditions || 0) + '</span> conditions → <span style="color:#888">After:</span> <span style="color:#0f0">' + (s.afterConditions || 0) + '</span> conditions <span style="color:#0ff;margin-left:12px">(' + pct + '% reduction)</span>';
        }

        // Tree summary
        var ts = d.filterTreeSummary || {};
        var tb = document.getElementById('eqoTreeBody');
        if (tb) {
          var html = '';
          var types = Object.keys(ts);
          if (types.length === 0) { tb.innerHTML = '<span style="color:#888">No compiled filters yet</span>'; return; }
          types.forEach(function(t) {
            html += '<div style="margin:4px 0"><span style="color:#0ff">' + t + '</span> <span style="color:#888">→ ' + ts[t] + ' handler(s)</span></div>';
          });
          tb.innerHTML = html;
        }
      }).catch(function() { document.getElementById('eqoStats').innerHTML = '<span style="color:#f44">Failed to load</span>'; });
    }

    loadStats();

    document.getElementById('eqoRecompile').onclick = function() {
      api5('POST', '/api/event-optimizer/compile').then(function() { loadStats(); });
    };
    document.getElementById('eqoCheckpoint').onclick = function() {
      api5('POST', '/api/event-optimizer/checkpoint').then(function() { loadStats(); });
    };
    document.getElementById('eqoDispatchBtn').onclick = function() {
      var evtType = document.getElementById('eqoEventType').value;
      var evtBody = document.getElementById('eqoEventBody').value;
      try { evtBody = JSON.parse(evtBody || '{}'); } catch(e) { evtBody = {}; }
      api5('POST', '/api/event-optimizer/dispatch-test', { eventType: evtType, event: evtBody }).then(function(r) {
        document.getElementById('eqoDispatchResult').textContent = JSON.stringify(r, null, 2);
      }).catch(function(e) { document.getElementById('eqoDispatchResult').textContent = 'Error: ' + e; });
    };
    document.getElementById('eqoScanBtn').onclick = function() {
      var thought = document.getElementById('eqoScanInput').value;
      api5('POST', '/api/event-optimizer/scan', { thought: thought }).then(function(r) {
        document.getElementById('eqoScanResult').textContent = JSON.stringify(r, null, 2);
      }).catch(function(e) { document.getElementById('eqoScanResult').textContent = 'Error: ' + e; });
    };
  };

  // ═══════════════════════════════════════════════════════════════════
  // COGNITIVE LOOP — Central Orchestrator
  // ═══════════════════════════════════════════════════════════════════
  window.loadAgiCognitiveLoop = function(container) {
    container.innerHTML = '<div style="padding:16px;">' + heading('🧠', 'Cognitive Loop — Central Orchestrator') + '<div id="cogLoopBody" style="color:#666;font-size:12px;">Loading...</div></div>';
    Promise.all([
      api5('GET', '/api/cognitive-loop/summary'),
      api5('GET', '/api/cognitive-loop/health'),
      api5('GET', '/api/cognitive-loop/tick-history?limit=10'),
      api5('GET', '/api/cognitive-loop/bottlenecks'),
      api5('GET', '/api/cognitive-loop/decisions')
    ]).then(function(results) {
      var summary = results[0] || {};
      var health = results[1] || {};
      var tickHist = (results[2] || {}).history || [];
      var bottlenecks = results[3] || {};
      var decisions = results[4] || {};
      var b = document.getElementById('cogLoopBody');
      if (!b) return;

      var hScore = health.score || 0;
      var hColor = hScore > 70 ? '#0f0' : hScore > 40 ? '#fa0' : '#f44';
      var eState = summary.energyState || 'UNKNOWN';
      var eColors = { CRITICAL: '#f44', LOW: '#fa0', MEDIUM: '#ff0', HIGH: '#0f0', PEAK: '#0ff' };
      var eColor = eColors[eState] || '#888';

      var html = card(
        '<div style="display:flex;justify-content:space-between;align-items:center;">' +
        '<div>' +
        '<div style="color:#0ff;font-size:13px;font-weight:600;">System Status</div>' +
        row('Running', summary.running ? '✅ Active' : '⏸ Stopped', summary.running ? '#0f0' : '#f44') +
        row('Tick Count', summary.tickCount || 0) +
        row('Interval', ((summary.interval || 30000) / 1000) + 's') +
        row('Modules', summary.modules || 0) +
        '</div>' +
        '<div style="text-align:center;">' +
        '<div style="font-size:36px;font-weight:bold;color:' + hColor + ';">' + hScore + '</div>' +
        '<div style="font-size:10px;color:#888;">Health</div>' +
        '</div></div>' +
        '<div style="margin-top:8px;">' +
        '<span style="color:#888;font-size:11px;">Energy: </span>' + badge(eState, eColor) +
        '</div>'
      );

      // Decisions summary
      var queue = (decisions.queue || []);
      var hist = (decisions.history || []);
      html += card(
        '<div style="color:#0ff;font-size:13px;font-weight:600;">Decision Pipeline</div>' +
        row('Pending', summary.pendingDecisions || 0, (summary.pendingDecisions || 0) > 5 ? '#fa0' : '#eee') +
        row('Paused (Shadow)', summary.pausedDecisions || 0, (summary.pausedDecisions || 0) > 0 ? '#fa0' : '#eee') +
        row('Approved', summary.approvedDecisions || 0, '#0f0') +
        row('Rejected', summary.rejectedDecisions || 0, (summary.rejectedDecisions || 0) > 0 ? '#f44' : '#eee')
      );

      // Health indicators
      if ((health.indicators || []).length > 0) {
        html += '<div style="color:#fa0;font-size:12px;margin:8px 0 4px;">⚠ Health Alerts</div>';
        (health.indicators || []).forEach(function(ind) {
          var ic = ind.type === 'warning' ? '#f44' : ind.type === 'caution' ? '#fa0' : '#0ff';
          html += '<div style="font-size:11px;color:' + ic + ';padding:2px 0;">• ' + escH(ind.message) + '</div>';
        });
      }

      // Recent ticks
      if (tickHist.length > 0) {
        html += '<div style="color:#0ff;font-size:12px;margin:8px 0 4px;">Recent Ticks</div>';
        tickHist.slice(-5).reverse().forEach(function(t) {
          html += '<div style="font-size:10px;display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px solid #111;">' +
            '<span style="color:#888;">#' + t.tick + '</span>' +
            '<span style="color:#aaa;">' + (t.duration || 0) + 'ms</span>' +
            '<span style="color:#0f0;">' + (t.modulesRun || 0) + ' run</span>' +
            '<span style="color:#fa0;">' + (t.modulesSkipped || 0) + ' skip</span>' +
            badge(t.energyState || '?', eColors[t.energyState] || '#888') +
            '</div>';
        });
      }

      // Bottlenecks
      if ((bottlenecks.slowest || []).length > 0) {
        html += '<div style="color:#0ff;font-size:12px;margin:8px 0 4px;">Bottlenecks (Slowest)</div>';
        (bottlenecks.slowest || []).slice(0, 3).forEach(function(m) {
          html += '<div style="font-size:11px;display:flex;justify-content:space-between;padding:2px 0;">' +
            '<span style="color:#aaa;">' + escH(m.moduleId) + '</span>' +
            '<span style="color:#fa0;">' + m.avgMs + 'ms avg</span>' +
            '</div>';
        });
      }

      // Controls
      html += '<div style="margin-top:12px;">' +
        '<button id="cogLoopStartBtn" style="' + btnStyle() + '">Start</button>' +
        '<button id="cogLoopStopBtn" style="' + btnStyle('linear-gradient(135deg,#f44,#f80)') + '">Stop</button>' +
        '<button id="cogLoopTickBtn" style="' + btnStyle('linear-gradient(135deg,#a0f,#60f)') + '">Force Tick</button>' +
        '</div>' +
        '<div style="margin-top:8px;">' +
        '<input id="cogLoopDecisionInput" placeholder="Queue a decision..." style="background:#111;border:1px solid #333;color:#eee;padding:6px 10px;border-radius:4px;font-size:12px;width:60%;margin-right:4px;" />' +
        '<button id="cogLoopDecisionBtn" style="' + btnStyle('linear-gradient(135deg,#0f0,#0a0)') + '">Queue</button>' +
        '</div>';

      b.innerHTML = html;

      var startBtn = document.getElementById('cogLoopStartBtn');
      var stopBtn = document.getElementById('cogLoopStopBtn');
      var tickBtn = document.getElementById('cogLoopTickBtn');
      var decBtn = document.getElementById('cogLoopDecisionBtn');

      if (startBtn) startBtn.onclick = function() { api5('POST', '/api/cognitive-loop/start', {}).then(function() { window.loadAgiCognitiveLoop(container); }); };
      if (stopBtn) stopBtn.onclick = function() { api5('POST', '/api/cognitive-loop/stop').then(function() { window.loadAgiCognitiveLoop(container); }); };
      if (tickBtn) tickBtn.onclick = function() { api5('POST', '/api/cognitive-loop/force-tick').then(function() { window.loadAgiCognitiveLoop(container); }); };
      if (decBtn) decBtn.onclick = function() {
        var input = document.getElementById('cogLoopDecisionInput');
        if (input && input.value.trim()) {
          api5('POST', '/api/cognitive-loop/decisions/queue', { decision: input.value.trim() }).then(function() { window.loadAgiCognitiveLoop(container); });
        }
      };
    }).catch(function() {
      var b = document.getElementById('cogLoopBody');
      if (b) b.innerHTML = '<span style="color:#f44;">Failed to load cognitive loop</span>';
    });
  };

  // ═══════════════════════════════════════════════════════════════════
  // Expose registry
  // ═══════════════════════════════════════════════════════════════════
  window._features_v6 = {
    loadAgiMirror: window.loadAgiMirror,
    loadAgiEconomy: window.loadAgiEconomy,
    loadAgiLanguage: window.loadAgiLanguage,
    loadAgiIdentity: window.loadAgiIdentity,
    loadAgiMycelium: window.loadAgiMycelium,
    loadAgiFragment: window.loadAgiFragment,
    loadAgiVirus: window.loadAgiVirus,
    loadAgiTectonics: window.loadAgiTectonics,
    loadAgiDigestion: window.loadAgiDigestion,
    loadAgiPain: window.loadAgiPain,
    loadAgiScarTopo: window.loadAgiScarTopo,
    loadAgiDread: window.loadAgiDread,
    loadAgiTides: window.loadAgiTides,
    loadAgiQualia: window.loadAgiQualia,
    loadAgiDissolution: window.loadAgiDissolution,
    loadAgiDnaCross: window.loadAgiDnaCross,
    loadAgiSymbiosis: window.loadAgiSymbiosis,
    loadAgiPhantom: window.loadAgiPhantom,
    loadAgiParadox: window.loadAgiParadox,
    loadAgiEntangle: window.loadAgiEntangle,
    loadAgiRecursiveDreams: window.loadAgiRecursiveDreams,
    loadAgiEventOptimizer: window.loadAgiEventOptimizer,
    loadAgiBenchmarks: window.loadAgiBenchmarks,
    loadAgiCognitiveLoop: window.loadAgiCognitiveLoop
  };

  // ═══════════════════════════════════════════════════════════════════
  // COGNITIVE BENCHMARKS PANEL
  // ═══════════════════════════════════════════════════════════════════
  window.loadAgiBenchmarks = function(container) {
    var trendIcons = { improving: '📈', declining: '📉', stable: '➡️' };
    var priColors = { critical: '#f44', warning: '#fa0', info: '#0ff' };

    function scoreColor(s) { return s >= 75 ? '#0f0' : s >= 50 ? '#fa0' : '#f44'; }

    function renderScorecard(sc, trends, weaknesses, strengths, recs) {
      if (!sc) return '<div style="text-align:center;padding:40px;color:#888;">No benchmark data yet.<br><br><button id="benchRunAllBtn" style="background:linear-gradient(135deg,#0ff,#08f);color:#000;border:none;padding:10px 30px;border-radius:6px;font-weight:700;cursor:pointer;font-size:14px;">▶ Run Full Benchmark Suite</button></div>';

      var html = '<div style="display:flex;align-items:center;gap:16px;margin-bottom:20px;">';
      html += '<div style="text-align:center;"><div style="font-size:48px;font-weight:800;color:' + scoreColor(sc.overall) + ';">' + sc.overall + '</div><div style="color:#888;font-size:12px;">Overall Score</div></div>';
      html += '<div style="flex:1;">' + gauge(sc.overall, scoreColor(sc.overall)) + '</div>';
      html += '<button id="benchRunAllBtn" style="background:linear-gradient(135deg,#0ff,#08f);color:#000;border:none;padding:8px 20px;border-radius:4px;font-weight:600;cursor:pointer;font-size:12px;">▶ Run All</button>';
      html += '</div>';

      // Category cards
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;margin-bottom:16px;">';
      var cats = sc.categories || {};
      for (var catId in cats) {
        var cat = cats[catId];
        var trend = (trends && trends[catId]) || 'stable';
        var c = scoreColor(cat.score);
        html += '<div style="background:#0a0a0a;border:1px solid #222;border-radius:8px;padding:12px;">';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;">';
        html += '<span style="font-weight:600;color:#ddd;">' + (cat.emoji || '') + ' ' + escH(cat.label) + '</span>';
        html += '<span style="font-size:11px;">' + (trendIcons[trend] || '') + '</span>';
        html += '</div>';
        html += '<div style="font-size:32px;font-weight:700;color:' + c + ';margin:6px 0;">' + cat.score + '</div>';
        html += gauge(cat.score, c);
        // Individual benchmarks
        var benchmarks = cat.benchmarks || {};
        for (var bId in benchmarks) {
          var b = benchmarks[bId];
          var bc = scoreColor(b.score);
          html += '<div style="display:flex;justify-content:space-between;font-size:11px;color:#aaa;margin-top:4px;">';
          html += '<span>' + escH(b.label) + '</span>';
          html += '<span style="color:' + bc + ';font-weight:600;">' + b.score + '</span>';
          html += '</div>';
        }
        html += '</div>';
      }
      html += '</div>';

      // Weaknesses & Strengths
      if ((weaknesses && weaknesses.length) || (strengths && strengths.length)) {
        html += '<div style="display:flex;gap:10px;margin-bottom:16px;">';
        if (weaknesses && weaknesses.length) {
          html += '<div style="flex:1;background:#1a0000;border:1px solid #f44;border-radius:8px;padding:10px;">';
          html += '<div style="color:#f44;font-weight:600;margin-bottom:6px;">⚠️ Weaknesses</div>';
          for (var w = 0; w < weaknesses.length; w++) {
            html += '<div style="font-size:12px;color:#faa;">' + escH(weaknesses[w].label) + ': <b>' + weaknesses[w].score + '</b></div>';
          }
          html += '</div>';
        }
        if (strengths && strengths.length) {
          html += '<div style="flex:1;background:#001a00;border:1px solid #0f0;border-radius:8px;padding:10px;">';
          html += '<div style="color:#0f0;font-weight:600;margin-bottom:6px;">✅ Strengths</div>';
          for (var s = 0; s < strengths.length; s++) {
            html += '<div style="font-size:12px;color:#afa;">' + escH(strengths[s].label) + ': <b>' + strengths[s].score + '</b></div>';
          }
          html += '</div>';
        }
        html += '</div>';
      }

      // Recommendations
      if (recs && recs.length) {
        html += '<div style="background:#0a0a0a;border:1px solid #222;border-radius:8px;padding:12px;margin-bottom:16px;">';
        html += '<div style="color:#0ff;font-weight:600;margin-bottom:8px;">💡 Recommendations</div>';
        for (var r = 0; r < recs.length; r++) {
          var pc = priColors[recs[r].priority] || '#888';
          html += '<div style="font-size:12px;color:' + pc + ';margin-bottom:4px;">● ' + escH(recs[r].text) + '</div>';
        }
        html += '</div>';
      }

      // Run time
      if (sc.ts) {
        html += '<div style="font-size:10px;color:#555;text-align:right;">Last run: ' + new Date(sc.ts).toLocaleString() + '</div>';
      }

      return html;
    }

    container.innerHTML = '<div style="padding:16px;"><h2 style="color:#0ff;margin:0 0 16px 0;font-size:18px;">📊 Cognitive Benchmarks</h2><div id="benchContent">Loading...</div></div>';

    function refresh() {
      Promise.all([
        api5('GET', '/api/benchmarks/scorecard'),
        api5('GET', '/api/benchmarks/trends'),
        api5('GET', '/api/benchmarks/recommendations')
      ]).then(function(results) {
        var scData = results[0] || {};
        var trData = results[1] || {};
        var reData = results[2] || {};
        var el = document.getElementById('benchContent');
        if (!el) return;
        el.innerHTML = renderScorecard(scData.scorecard, trData.trends, scData.weaknesses, scData.strengths, reData.recommendations);
        var btn = document.getElementById('benchRunAllBtn');
        if (btn) {
          btn.onclick = function() {
            btn.disabled = true;
            btn.textContent = '⏳ Running...';
            api5('POST', '/api/benchmarks/run').then(function() {
              setTimeout(refresh, 500);
            }).catch(function() { btn.textContent = '❌ Failed'; });
          };
        }
      }).catch(function() {
        var el = document.getElementById('benchContent');
        if (el) el.innerHTML = '<div style="color:#f44;">Failed to load benchmarks</div>';
      });
    }
    refresh();
    setInterval(refresh, 30000);
  };

  // ── Consciousness Stream Panel ──
  window.loadAgiConsciousness = function(container) {
    container.innerHTML = '<div class="spinner"></div> Loading consciousness stream...';
    Promise.all([
      api5('GET', '/api/consciousness-stream').catch(function() { return {}; }),
    ]).then(function(results) {
      var d = results[0] || {};
      var state = d.state || {};
      var stats = d.stats || {};
      var recent = d.recent || [];
      var moodEmoji = state.moodEmoji || '😶';

      var html = '<h3>' + moodEmoji + ' Consciousness Stream</h3>';
      html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin:12px 0">';
      html += '<div style="background:#1a1a2e;padding:12px;border-radius:8px;text-align:center"><div style="font-size:28px">' + moodEmoji + '</div><div style="color:#aaa;font-size:11px">Mood</div><div style="color:#fff;font-weight:bold">' + (state.mood || 'unknown') + '</div></div>';
      html += '<div style="background:#1a1a2e;padding:12px;border-radius:8px;text-align:center"><div style="font-size:28px">📊</div><div style="color:#aaa;font-size:11px">Signals</div><div style="color:#fff;font-weight:bold">' + (stats.totalSignals || 0) + '</div></div>';
      html += '<div style="background:#1a1a2e;padding:12px;border-radius:8px;text-align:center"><div style="font-size:28px">🎯</div><div style="color:#aaa;font-size:11px">Focus</div><div style="color:#fff;font-weight:bold">' + (state.attentionFocus || 'diffuse') + '</div></div>';
      html += '</div>';

      if (state.dominantThought) {
        html += '<div style="background:#0a2a1a;border:1px solid #0f4;padding:10px;border-radius:6px;margin:8px 0"><strong>💭 Dominant:</strong> ' + (state.dominantThought.content || '').substring(0, 200) + ' <span style="color:#888">(' + (state.dominantThought.source || '') + ')</span></div>';
      }

      if (state.painLevel > 0) {
        html += '<div style="background:#2a0a0a;border:1px solid #f44;padding:8px;border-radius:6px;margin:8px 0">🩸 Pain: ' + Math.round(state.painLevel * 100) + '%</div>';
      }

      html += '<h4>Recent Signals</h4><div style="max-height:300px;overflow-y:auto">';
      recent.slice().reverse().forEach(function(s) {
        var color = s.valence > 0 ? '#4f4' : s.valence < 0 ? '#f44' : '#888';
        html += '<div style="padding:6px 8px;border-bottom:1px solid #222;font-size:12px">';
        html += '<span style="color:' + color + '">' + (s.label || s.type) + '</span> ';
        html += '<span style="color:#ccc">' + (s.content || '').substring(0, 120) + '</span> ';
        html += '<span style="color:#666;font-size:10px">' + (s.source || '') + ' | i:' + s.intensity + '</span>';
        html += '</div>';
      });
      html += '</div>';

      html += '<div style="margin-top:12px"><button id="csNarrate" class="btn-sm">🗣️ Narrate</button> ';
      html += '<button id="csTick" class="btn-sm">⏰ Tick</button></div>';
      html += '<div id="csNarration" style="margin-top:8px;font-style:italic;color:#aaa"></div>';

      container.innerHTML = html;

      var narBtn = document.getElementById('csNarrate');
      if (narBtn) narBtn.onclick = function() {
        api5('POST', '/api/consciousness-stream/narrate').then(function(r) {
          var el = document.getElementById('csNarration');
          if (el) el.textContent = r.narration || 'No narration available';
        });
      };
      var tickBtn = document.getElementById('csTick');
      if (tickBtn) tickBtn.onclick = function() { api5('POST', '/api/consciousness-stream/tick').then(function() { window.loadAgiConsciousness(container); }); };
    });
  };

  // ═══════════════════════════════════════════════════════════════
  // PRUNER — Module Dead Weight Detector
  // ═══════════════════════════════════════════════════════════════
  window.loadAgiPruner = function(container) {
    container.innerHTML = '<div style="padding:16px;">' + heading('✂️', 'Module Pruner') + '<div id="prunerBody" style="color:#666;font-size:12px;">Loading...</div></div>';
    api5('GET', '/api/pruner').then(function(d) {
      var b = document.getElementById('prunerBody');
      if (!b) return;
      if (d.error || !d.modules) {
        b.innerHTML = card('<div style="color:#fa0;">No report yet.</div><div style="margin-top:10px;"><button id="prunerRunBtn" style="' + btnStyle() + '">Run Analysis</button></div>');
        var rb = document.getElementById('prunerRunBtn');
        if (rb) rb.onclick = function() { api5('POST', '/api/pruner/analyze').then(function() { window.loadAgiPruner(container); }); };
        return;
      }
      var html = '';
      // Summary
      var s = d.summary || {};
      html += card(
        row('Modules Analyzed', d.moduleCount || 0) +
        row('Average Score', s.avgScore || 0, '#0ff') +
        row('Healthy', s.healthyCount || 0, '#0f0') +
        row('Marginal', s.marginalCount || 0, '#fa0') +
        row('Dead Weight', s.criticalCount || 0, '#f44') +
        '<div style="margin-top:8px;"><button id="prunerRerunBtn" style="' + btnStyle() + '">Re-analyze</button></div>'
      );

      // Efficiency Ranking Table
      html += '<div style="color:#0ff;font-size:13px;font-weight:600;margin:12px 0 6px;">Efficiency Ranking</div>';
      html += '<div style="max-height:300px;overflow-y:auto;">';
      html += '<table style="width:100%;border-collapse:collapse;font-size:11px;">';
      html += '<tr style="color:#888;border-bottom:1px solid #333;"><th style="text-align:left;padding:4px;">Module</th><th style="text-align:center;padding:4px;">Score</th><th style="text-align:center;padding:4px;">Priority</th><th style="text-align:center;padding:4px;">Value/Cost</th><th style="text-align:left;padding:4px;">Bar</th></tr>';
      (d.efficiencyRanking || []).forEach(function(m) {
        var color = m.score >= 0.6 ? '#0f0' : m.score >= 0.35 ? '#fa0' : '#f44';
        var barW = Math.round(m.score * 100);
        html += '<tr style="border-bottom:1px solid #1a1a1a;">';
        html += '<td style="padding:4px;color:#ccc;">' + escH(m.moduleId) + '</td>';
        html += '<td style="text-align:center;padding:4px;color:' + color + ';">' + m.score.toFixed(3) + '</td>';
        html += '<td style="text-align:center;padding:4px;">' + badge(m.priority, m.priority === 'CRITICAL' ? '#f44' : m.priority === 'HIGH' ? '#fa0' : '#888') + '</td>';
        html += '<td style="text-align:center;padding:4px;color:#0ff;">' + (m.valueRatio || 0) + '</td>';
        html += '<td style="padding:4px;"><div style="background:#222;border-radius:3px;height:10px;width:100px;overflow:hidden;"><div style="width:' + barW + '%;height:100%;background:' + color + ';border-radius:3px;"></div></div></td>';
        html += '</tr>';
      });
      html += '</table></div>';

      // Dead Weight
      html += '<div style="color:#f44;font-size:13px;font-weight:600;margin:16px 0 6px;">Dead Weight (' + (d.deadWeight || []).length + ')</div>';
      if ((d.deadWeight || []).length === 0) {
        html += card('<div style="color:#0f0;font-size:12px;">✅ No dead weight detected!</div>');
      } else {
        (d.deadWeight || []).forEach(function(dw) {
          html += card(
            '<div style="display:flex;justify-content:space-between;align-items:center;">' +
            '<div><span style="color:#f44;font-weight:600;">' + escH(dw.moduleId) + '</span> ' + badge(dw.priority, '#f44') + ' <span style="color:#888;font-size:11px;">score: ' + dw.score.toFixed(3) + '</span></div>' +
            '<button class="pruner-impact-btn" data-module="' + escH(dw.moduleId) + '" style="' + btnStyle('linear-gradient(135deg,#f44,#f80)') + '">Suggest Prune</button>' +
            '</div>'
          );
        });
      }

      // Merge Candidates
      html += '<div style="color:#0ff;font-size:13px;font-weight:600;margin:16px 0 6px;">Merge Candidates (' + (d.mergeCandidates || []).length + ')</div>';
      if ((d.mergeCandidates || []).length === 0) {
        html += card('<div style="color:#888;font-size:12px;">No merge candidates found.</div>');
      } else {
        (d.mergeCandidates || []).forEach(function(mc) {
          html += card(
            '<div style="color:#0ff;">🔀 ' + escH(mc.moduleA) + ' + ' + escH(mc.moduleB) + '</div>' +
            row('Similarity', (mc.similarity * 100).toFixed(0) + '%', mc.similarity > 0.5 ? '#f44' : '#fa0') +
            row('Overlapping events', mc.overlapCount)
          );
        });
      }

      // Impact Analysis Viewer
      html += '<div style="color:#0ff;font-size:13px;font-weight:600;margin:16px 0 6px;">Impact Analysis</div>';
      html += card(
        '<div style="display:flex;gap:8px;align-items:center;">' +
        '<input id="prunerImpactInput" type="text" placeholder="module-id" style="flex:1;background:#111;border:1px solid #333;color:#eee;padding:6px 10px;border-radius:4px;font-size:12px;">' +
        '<button id="prunerImpactBtn" style="' + btnStyle() + '">Analyze Impact</button>' +
        '</div>' +
        '<div id="prunerImpactResult" style="margin-top:8px;"></div>'
      );

      b.innerHTML = html;

      // Wire up buttons
      var rerunBtn = document.getElementById('prunerRerunBtn');
      if (rerunBtn) rerunBtn.onclick = function() { api5('POST', '/api/pruner/analyze').then(function() { window.loadAgiPruner(container); }); };

      var impactBtns = document.querySelectorAll('.pruner-impact-btn');
      for (var i = 0; i < impactBtns.length; i++) {
        impactBtns[i].addEventListener('click', function() {
          var mod = this.getAttribute('data-module');
          document.getElementById('prunerImpactInput').value = mod;
          document.getElementById('prunerImpactBtn').click();
        });
      }

      var impBtn = document.getElementById('prunerImpactBtn');
      if (impBtn) impBtn.onclick = function() {
        var mod = document.getElementById('prunerImpactInput').value.trim();
        if (!mod) return;
        var res = document.getElementById('prunerImpactResult');
        res.innerHTML = '<div style="color:#888;">Analyzing...</div>';
        api5('GET', '/api/pruner/impact/' + encodeURIComponent(mod)).then(function(imp) {
          if (imp.error) { res.innerHTML = '<div style="color:#f44;">' + escH(imp.error) + '</div>'; return; }
          var riskColors = { SAFE: '#0f0', LOW: '#0ff', MEDIUM: '#fa0', HIGH: '#f44', CRITICAL: '#f00' };
          var ih = '<div style="margin-bottom:8px;">' + badge(imp.riskLevel, riskColors[imp.riskLevel] || '#888') + ' <span style="color:#ccc;font-weight:600;">' + escH(imp.moduleId) + '</span></div>';
          ih += row('Priority', imp.priority);
          ih += row('Can Prune?', imp.canPrune ? 'Yes' : 'No', imp.canPrune ? '#0f0' : '#f44');
          ih += row('Total Impact', imp.totalImpact + ' modules');
          if (imp.directDependents && imp.directDependents.length > 0) {
            ih += '<div style="color:#fa0;font-size:11px;margin-top:6px;">Direct dependents:</div>';
            imp.directDependents.forEach(function(dep) { ih += '<div style="font-size:11px;color:#ccc;padding-left:12px;">• ' + escH(dep) + '</div>'; });
          }
          if (imp.cascadeBreaks && imp.cascadeBreaks.length > 0) {
            ih += '<div style="color:#f44;font-size:11px;margin-top:6px;">Cascade breaks:</div>';
            imp.cascadeBreaks.forEach(function(cb) { ih += '<div style="font-size:11px;color:#ccc;padding-left:12px;">• ' + escH(cb) + '</div>'; });
          }
          if (imp.eventConsumers && imp.eventConsumers.length > 0) {
            ih += '<div style="color:#0ff;font-size:11px;margin-top:6px;">Event consumers affected:</div>';
            imp.eventConsumers.forEach(function(ec) { ih += '<div style="font-size:11px;color:#ccc;padding-left:12px;">• ' + escH(ec.module) + ' (' + ec.affectedEvents.join(', ') + ')</div>'; });
          }
          ih += '<div style="margin-top:8px;padding:8px;background:#111;border-radius:4px;font-size:11px;color:#aaa;">' + escH(imp.recommendation) + '</div>';
          res.innerHTML = ih;
        });
      };
    }).catch(function() { var b = document.getElementById('prunerBody'); if (b) b.innerHTML = '<span style="color:#f44;">Failed to load</span>'; });
  };

  // ══════════════════════════════════════════
  // AGI HOT RELOAD PANEL
  // ══════════════════════════════════════════

  window.loadAgiHotReload = function(container) {
    function escH(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    function statusColor(s) { return s === 'loaded' ? '#0f0' : s === 'error' ? '#f44' : '#fa0'; }
    function timeAgo(iso) {
      if (!iso) return 'never';
      var d = Date.now() - new Date(iso).getTime();
      if (d < 60000) return Math.round(d/1000) + 's ago';
      if (d < 3600000) return Math.round(d/60000) + 'm ago';
      return Math.round(d/3600000) + 'h ago';
    }

    function render(data) {
      var stats = data.stats || {};
      var registry = data.registry || [];
      var status = data.status || {};

      var html = '<div style="margin-bottom:16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">';
      html += '<h2 style="margin:0;color:#0ff;">🔄 Hot Reload</h2>';
      html += '<span style="background:' + (status.watching ? '#0a4' : '#333') + ';color:' + (status.watching ? '#000' : '#888') + ';padding:2px 10px;border-radius:10px;font-size:11px;font-weight:600;">' + (status.watching ? '👁️ Watching' : '⏸️ Not Watching') + '</span>';
      html += '<button id="hrToggleWatch" style="background:#1a1a2e;color:#0ff;border:1px solid #0ff;padding:4px 12px;border-radius:4px;cursor:pointer;font-size:12px;">' + (status.watching ? '⏹ Stop Watch' : '▶ Start Watch') + '</button>';
      html += '<button id="hrReloadAll" style="background:linear-gradient(135deg,#f80,#f44);color:#fff;border:none;padding:4px 12px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;">🔄 Reload All</button>';
      html += '<button id="hrDiscover" style="background:#1a1a2e;color:#8b5cf6;border:1px solid #8b5cf6;padding:4px 12px;border-radius:4px;cursor:pointer;font-size:12px;">🔍 Discover</button>';
      html += '</div>';

      // Stats cards
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin-bottom:16px;">';
      var cards = [
        { label: 'Modules', value: stats.registeredModules || 0, color: '#0ff' },
        { label: 'Reloads', value: stats.totalReloads || 0, color: '#0f0' },
        { label: 'Failures', value: stats.totalFailures || 0, color: stats.totalFailures > 0 ? '#f44' : '#0f0' },
        { label: 'Success', value: (stats.successRate || 100) + '%', color: stats.successRate >= 90 ? '#0f0' : '#fa0' },
        { label: 'Avg Time', value: (stats.avgReloadMs || 0) + 'ms', color: '#08f' },
        { label: 'Watchers', value: stats.watcherCount || 0, color: '#8b5cf6' }
      ];
      for (var i = 0; i < cards.length; i++) {
        html += '<div style="background:#0a0a0a;border:1px solid #222;border-radius:8px;padding:10px;text-align:center;">';
        html += '<div style="font-size:24px;font-weight:700;color:' + cards[i].color + ';">' + cards[i].value + '</div>';
        html += '<div style="color:#888;font-size:11px;">' + cards[i].label + '</div>';
        html += '</div>';
      }
      html += '</div>';

      // Module list
      html += '<h3 style="color:#ddd;margin:16px 0 8px;">Registered Modules (' + registry.length + ')</h3>';
      if (registry.length === 0) {
        html += '<div style="color:#888;padding:20px;text-align:center;">No modules registered. Click <b>Discover</b> to scan core/ directory.</div>';
      } else {
        html += '<div style="max-height:400px;overflow-y:auto;border:1px solid #222;border-radius:8px;">';
        html += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
        html += '<thead><tr style="background:#111;color:#888;text-align:left;"><th style="padding:8px;">Module</th><th style="padding:8px;">Status</th><th style="padding:8px;">Reloads</th><th style="padding:8px;">Avg</th><th style="padding:8px;">Last</th><th style="padding:8px;">State</th><th style="padding:8px;">Action</th></tr></thead>';
        html += '<tbody>';
        for (var j = 0; j < registry.length; j++) {
          var m = registry[j];
          html += '<tr style="border-bottom:1px solid #1a1a1a;">';
          html += '<td style="padding:6px 8px;color:#ddd;font-family:monospace;">' + escH(m.name) + '</td>';
          html += '<td style="padding:6px 8px;"><span style="color:' + statusColor(m.status) + ';font-weight:600;">' + escH(m.status) + '</span></td>';
          html += '<td style="padding:6px 8px;color:#0ff;">' + (m.reloadCount || 0) + '</td>';
          html += '<td style="padding:6px 8px;color:#888;">' + (m.avgReloadMs || 0) + 'ms</td>';
          html += '<td style="padding:6px 8px;color:#888;">' + timeAgo(m.lastReload) + '</td>';
          html += '<td style="padding:6px 8px;">' + (m.hasSerialize ? '💾' : '—') + '</td>';
          html += '<td style="padding:6px 8px;"><button class="hr-reload-btn" data-module="' + escH(m.name) + '" style="background:#0ff;color:#000;border:none;padding:2px 8px;border-radius:3px;cursor:pointer;font-size:11px;font-weight:600;">↻</button></td>';
          html += '</tr>';
          if (m.lastError) {
            html += '<tr><td colspan="7" style="padding:2px 8px 6px;color:#f44;font-size:11px;font-family:monospace;">⚠ ' + escH(m.lastError) + '</td></tr>';
          }
        }
        html += '</tbody></table></div>';
      }

      container.innerHTML = html;

      // Bind events
      var toggleBtn = document.getElementById('hrToggleWatch');
      if (toggleBtn) toggleBtn.onclick = function() {
        var action = status.watching ? 'stop' : 'start';
        api5('POST', 'hot-reload/watch', { action: action }).then(function() { refresh(); });
      };
      var reloadAllBtn = document.getElementById('hrReloadAll');
      if (reloadAllBtn) reloadAllBtn.onclick = function() {
        reloadAllBtn.textContent = '⏳ Reloading...';
        api5('POST', 'hot-reload/reload-all').then(function(r) {
          reloadAllBtn.textContent = '✅ Done (' + (r.succeeded||0) + '/' + (r.total||0) + ')';
          setTimeout(refresh, 1000);
        }).catch(function() { reloadAllBtn.textContent = '❌ Failed'; });
      };
      var discoverBtn = document.getElementById('hrDiscover');
      if (discoverBtn) discoverBtn.onclick = function() {
        api5('POST', 'hot-reload/discover').then(function(r) {
          discoverBtn.textContent = '✅ Found ' + (r.discovered||0);
          setTimeout(refresh, 1000);
        });
      };

      // Individual reload buttons
      var btns = container.querySelectorAll('.hr-reload-btn');
      for (var k = 0; k < btns.length; k++) {
        btns[k].onclick = function() {
          var btn = this;
          var mod = btn.getAttribute('data-module');
          btn.textContent = '⏳';
          api5('POST', 'hot-reload/reload', { module: mod }).then(function(r) {
            btn.textContent = r.success ? '✅' : '❌';
            setTimeout(refresh, 1000);
          }).catch(function() { btn.textContent = '❌'; });
        };
      }
    }

    function renderHistory(history) {
      var el = document.getElementById('hrHistoryLog');
      if (!el) return;
      if (!history || history.length === 0) {
        el.innerHTML = '<div style="color:#888;text-align:center;padding:16px;">No reload history yet.</div>';
        return;
      }
      var html = '<div style="max-height:300px;overflow-y:auto;font-family:monospace;font-size:11px;">';
      for (var i = 0; i < history.length && i < 50; i++) {
        var h = history[i];
        var icon = h.success ? '✅' : '❌';
        var color = h.success ? '#0f0' : '#f44';
        html += '<div style="padding:3px 0;border-bottom:1px solid #111;color:' + color + ';">';
        html += icon + ' <span style="color:#888;">' + (h.ts || '').substring(0, 19).replace('T', ' ') + '</span> ';
        html += '<span style="color:#0ff;">' + escH(h.module) + '</span> ';
        html += '<span style="color:#888;">' + escH(h.action) + '</span>';
        if (h.durationMs) html += ' <span style="color:#8b5cf6;">' + h.durationMs + 'ms</span>';
        if (h.error) html += ' <span style="color:#f44;">— ' + escH(h.error) + '</span>';
        if (h.statePreserved) html += ' 💾';
        html += '</div>';
      }
      html += '</div>';
      el.innerHTML = html;
    }

    function api5(method, path, body) {
      var opts = { method: method, headers: { 'Content-Type': 'application/json', 'x-aries-key': 'aries-api-2026', 'Authorization': 'Bearer ' + (localStorage.getItem('aries-auth-token') || '') } };
      if (body) opts.body = JSON.stringify(body);
      return fetch('/api/' + path, opts).then(function(r) { return r.json(); });
    }

    function refresh() {
      api5('GET', 'hot-reload').then(function(data) {
        render(data);
        // Add history section after render
        var histDiv = document.createElement('div');
        histDiv.style.marginTop = '16px';
        histDiv.innerHTML = '<h3 style="color:#ddd;margin:0 0 8px;">Reload History</h3><div id="hrHistoryLog"></div>';
        container.appendChild(histDiv);
        // Load history
        api5('GET', 'hot-reload/history?limit=50').then(function(hData) {
          renderHistory(hData.history || []);
        });
      }).catch(function(e) {
        container.innerHTML = '<div style="color:#f44;padding:20px;">Failed to load hot reload data: ' + escH(e.message) + '</div>';
      });
    }

    refresh();
  };

  // ═══════════════════════════════════════════════════════════════════
  // BACKBONE — Unified Runtime Dashboard
  // ═══════════════════════════════════════════════════════════════════
  window.loadAgiBackbone = function(container) {
    container.innerHTML = '<div style="padding:16px;">' + heading('⚙️', 'Backbone Runtime') + '<div id="bbBody" style="color:#666;font-size:12px;">Loading...</div></div>';
    Promise.all([
      api5('GET', '/api/backbone'),
      api5('GET', '/api/backbone/boot-order'),
      api5('GET', '/api/backbone/dispatch-stats'),
      api5('GET', '/api/backbone/health'),
      api5('GET', '/api/backbone/bottlenecks')
    ]).then(function(results) {
      var status = results[0], boot = results[1], dispatch = results[2], health = results[3], bn = results[4];
      var b = document.getElementById('bbBody');
      if (!b) return;
      var html = '';

      // Status overview
      var stateColor = status.state === 'running' ? '#0f0' : status.state === 'stopped' ? '#fa0' : status.state === 'error' ? '#f44' : '#888';
      var hScore = (health.current && health.current.score) || 0;
      var hColor = hScore > 70 ? '#0f0' : hScore > 40 ? '#fa0' : '#f44';
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-bottom:16px;">';
      html += '<div style="background:#111;padding:12px;border-radius:8px;text-align:center;border:1px solid #222;"><div style="font-size:20px;font-weight:700;color:' + stateColor + ';">' + escH((status.state || 'idle').toUpperCase()) + '</div><div style="font-size:10px;color:#666;">State</div></div>';
      html += '<div style="background:#111;padding:12px;border-radius:8px;text-align:center;border:1px solid #222;"><div style="font-size:20px;font-weight:700;color:' + hColor + ';">' + hScore + '</div><div style="font-size:10px;color:#666;">Health</div></div>';
      html += '<div style="background:#111;padding:12px;border-radius:8px;text-align:center;border:1px solid #222;"><div style="font-size:20px;font-weight:700;color:#0ff;">' + (status.moduleCount || 0) + '</div><div style="font-size:10px;color:#666;">Modules</div></div>';
      html += '<div style="background:#111;padding:12px;border-radius:8px;text-align:center;border:1px solid #222;"><div style="font-size:20px;font-weight:700;color:#08f;">' + (status.tickCount || 0) + '</div><div style="font-size:10px;color:#666;">Ticks</div></div>';
      html += '<div style="background:#111;padding:12px;border-radius:8px;text-align:center;border:1px solid #222;"><div style="font-size:20px;font-weight:700;color:#f0f;">' + (dispatch.totalDispatched || 0) + '</div><div style="font-size:10px;color:#666;">Dispatched</div></div>';
      html += '<div style="background:#111;padding:12px;border-radius:8px;text-align:center;border:1px solid #222;"><div style="font-size:20px;font-weight:700;color:' + ((bn.bottlenecks || []).length > 0 ? '#f44' : '#0f0') + ';">' + (bn.bottlenecks || []).length + '</div><div style="font-size:10px;color:#666;">Bottlenecks</div></div>';
      html += '</div>';

      // Actions
      html += '<div style="margin-bottom:16px;display:flex;gap:8px;">';
      html += '<button id="bbRestartBtn" style="' + btnStyle() + '">🔄 Restart</button>';
      html += '<button id="bbRefreshBtn" style="' + btnStyle('linear-gradient(135deg,#08f,#0ff)') + '">🔄 Refresh</button>';
      html += '</div>';

      // Boot Order
      html += '<div style="color:#0ff;font-size:14px;font-weight:600;margin:12px 0 8px;">🚀 Boot Order</div>';
      var bootMods = boot.modules || [];
      if (bootMods.length === 0) {
        html += '<div style="color:#666;font-size:12px;">No modules in boot order. Init the backbone first.</div>';
      } else {
        html += '<div style="max-height:300px;overflow-y:auto;">';
        bootMods.forEach(function(m, idx) {
          var sc = m.state === 'ready' ? '#0f0' : m.state === 'error' ? '#f44' : m.state === 'timeout' ? '#fa0' : '#888';
          var phaseColor = m.phase === 'pre' ? '#08f' : m.phase === 'post' ? '#f0f' : '#0ff';
          html += '<div style="display:flex;align-items:center;gap:8px;padding:4px 8px;font-size:11px;border-bottom:1px solid #1a1a1a;">';
          html += '<span style="color:#555;width:24px;text-align:right;">' + (idx + 1) + '</span>';
          html += '<span style="width:8px;height:8px;border-radius:50%;background:' + sc + ';flex-shrink:0;"></span>';
          html += '<span style="color:#eee;flex:1;">' + escH(m.moduleId) + '</span>';
          html += badge(m.phase, phaseColor) + ' ';
          html += badge(m.priority, m.priority === 'CRITICAL' ? '#f44' : m.priority === 'HIGH' ? '#fa0' : '#888');
          if (m.bootTime != null) html += ' <span style="color:#555;font-size:10px;">' + m.bootTime + 'ms</span>';
          html += '</div>';
        });
        html += '</div>';
      }

      // Dispatch Stats
      html += '<div style="color:#0ff;font-size:14px;font-weight:600;margin:16px 0 8px;">⚡ Dispatch Stats</div>';
      html += card(
        row('Total Dispatched', dispatch.totalDispatched || 0, '#0ff') +
        row('Total Matched', dispatch.totalMatched || 0, '#0f0') +
        row('Total Dropped', dispatch.totalDropped || 0, (dispatch.totalDropped || 0) > 0 ? '#fa0' : '#0f0') +
        row('Total Errors', dispatch.totalErrors || 0, (dispatch.totalErrors || 0) > 0 ? '#f44' : '#0f0') +
        row('Avg Dispatch Time', (dispatch.avgDispatchTimeUs || 0) + ' μs', '#08f') +
        row('Registered Event Types', dispatch.registeredEventTypes || 0, '#888') +
        row('Compiled Reductions', dispatch.reductions || 0, '#f0f')
      );
      if (dispatch.byEventType && Object.keys(dispatch.byEventType).length > 0) {
        html += '<div style="color:#888;font-size:11px;margin:4px 0;">Event Types:</div>';
        Object.keys(dispatch.byEventType).slice(0, 10).forEach(function(et) {
          var s = dispatch.byEventType[et];
          html += '<div style="font-size:10px;color:#aaa;padding:1px 8px;">' + escH(et) + ': ' + s.dispatched + ' dispatched, ' + s.matched + ' matched, ' + s.dropped + ' dropped</div>';
        });
      }

      // Health
      html += '<div style="color:#0ff;font-size:14px;font-weight:600;margin:16px 0 8px;">💓 Health</div>';
      html += card(
        '<div style="color:' + hColor + ';font-size:24px;font-weight:700;text-align:center;">' + hScore + '/100</div>' +
        gauge(hScore, hColor)
      );
      var mHealth = health.moduleHealth || [];
      if (mHealth.length > 0) {
        html += '<div style="color:#888;font-size:11px;margin:4px 0;">Module Health (slowest first):</div>';
        mHealth.slice(0, 10).forEach(function(m) {
          var mc = m.isSlow ? '#fa0' : m.state === 'error' ? '#f44' : '#0f0';
          html += '<div style="display:flex;justify-content:space-between;font-size:10px;padding:2px 8px;color:#aaa;">';
          html += '<span>' + escH(m.moduleId) + '</span>';
          html += '<span style="color:' + mc + ';">' + m.avgTickMs + 'ms avg, ' + m.errors + ' errs, ' + m.timeouts + ' timeouts</span>';
          html += '</div>';
        });
      }

      // Bottlenecks
      html += '<div style="color:#0ff;font-size:14px;font-weight:600;margin:16px 0 8px;">🔥 Bottlenecks</div>';
      var bns = bn.bottlenecks || [];
      if (bns.length === 0) {
        html += '<div style="color:#0f0;font-size:12px;padding:8px;">✅ No bottlenecks detected</div>';
      } else {
        bns.forEach(function(b) {
          var bColor = b.type === 'slow-module' ? '#fa0' : b.type === 'error-prone' ? '#f44' : b.type === 'event-drop' ? '#f0f' : '#888';
          html += '<div style="font-size:11px;padding:6px 8px;margin:3px 0;border-radius:4px;background:#111;border-left:3px solid ' + bColor + ';">';
          html += '<span style="color:' + bColor + ';font-weight:600;">' + escH(b.type) + '</span> ';
          if (b.moduleId) html += escH(b.moduleId) + ' ';
          if (b.eventType) html += escH(b.eventType) + ' ';
          if (b.avgMs) html += '(' + b.avgMs + 'ms avg) ';
          if (b.errorRate) html += '(' + b.errorRate + '% error rate) ';
          if (b.dropRate) html += '(' + b.dropRate + '% drop rate) ';
          if (b.dependentCount) html += '(' + b.dependentCount + ' dependents) ';
          html += '</div>';
        });
      }

      // Slow modules
      var slows = bn.slowModules || [];
      if (slows.length > 0) {
        html += '<div style="color:#fa0;font-size:12px;margin:10px 0 4px;">🐌 Slow Modules</div>';
        slows.forEach(function(s) {
          html += '<div style="font-size:11px;color:#aaa;padding:2px 8px;">⏱ ' + escH(s.moduleId) + ' — ' + s.avgMs + 'ms avg (' + s.count + ' slow ticks)</div>';
        });
      }

      // Critical path
      var cp = bn.criticalPath || [];
      if (cp.length > 0) {
        html += '<div style="color:#f0f;font-size:12px;margin:10px 0 4px;">🔗 Critical Path (' + cp.length + ' modules)</div>';
        html += '<div style="font-size:11px;color:#aaa;padding:2px 8px;">' + cp.map(function(m) { return escH(m); }).join(' → ') + '</div>';
      }

      b.innerHTML = html;

      // Wire buttons
      var restartBtn = document.getElementById('bbRestartBtn');
      if (restartBtn) restartBtn.onclick = function() {
        restartBtn.disabled = true;
        restartBtn.textContent = '⏳ Restarting...';
        api5('POST', '/api/backbone/restart').then(function() {
          window.loadAgiBackbone(container);
        }).catch(function() { restartBtn.disabled = false; restartBtn.textContent = '🔄 Restart'; });
      };
      var refreshBtn = document.getElementById('bbRefreshBtn');
      if (refreshBtn) refreshBtn.onclick = function() { window.loadAgiBackbone(container); };
    }).catch(function(e) {
      var b = document.getElementById('bbBody');
      if (b) b.innerHTML = '<span style="color:#f44;">Failed to load backbone: ' + escH(e.message || String(e)) + '</span>';
    });
  };

})();

