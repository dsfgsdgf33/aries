/**
 * ARIES — SSE Client for Dashboard
 * Connects to /api/sse for real-time event push.
 * Auto-reconnect with exponential backoff.
 * Updates dashboard panels live without polling.
 */
(function() {
  'use strict';

  var SSE_URL = '/api/sse';
  var DEFAULT_CHANNELS = 'system,metabolism,immune,shadow,pain,consciousness,loop';

  var _source = null;
  var _connected = false;
  var _reconnectTimer = null;
  var _reconnectDelay = 1000;  // start at 1s, exponential backoff
  var _maxReconnectDelay = 30000;
  var _messageCount = 0;
  var _lastEventTime = 0;
  var _handlers = {};  // channel:event -> [callbacks]
  var _globalHandlers = [];  // called for every event
  var _statusListeners = [];

  // ── Public API ──

  window.AriesSSE = {
    connect: connect,
    disconnect: disconnect,
    isConnected: function() { return _connected; },
    getStats: function() {
      return {
        connected: _connected,
        messageCount: _messageCount,
        lastEventTime: _lastEventTime,
        url: SSE_URL + '?channels=' + DEFAULT_CHANNELS,
      };
    },
    on: on,
    off: off,
    onAny: onAny,
    onStatusChange: onStatusChange,
  };

  /**
   * Register a handler for a specific channel:event combo.
   * e.g. AriesSSE.on('metabolism:energy-change', fn)
   */
  function on(eventKey, callback) {
    if (!_handlers[eventKey]) _handlers[eventKey] = [];
    _handlers[eventKey].push(callback);
  }

  function off(eventKey, callback) {
    if (!_handlers[eventKey]) return;
    _handlers[eventKey] = _handlers[eventKey].filter(function(fn) { return fn !== callback; });
  }

  function onAny(callback) {
    _globalHandlers.push(callback);
  }

  function onStatusChange(callback) {
    _statusListeners.push(callback);
  }

  // ── Connection ──

  function connect(channels) {
    if (_source) disconnect();

    var ch = channels || DEFAULT_CHANNELS;
    var url = SSE_URL + '?channels=' + encodeURIComponent(ch);

    try {
      _source = new EventSource(url);
    } catch (e) {
      console.error('[SSE] Failed to create EventSource:', e);
      _scheduleReconnect();
      return;
    }

    _source.onopen = function() {
      _connected = true;
      _reconnectDelay = 1000;  // reset backoff
      _updateStatusUI(true);
      _fireStatusListeners(true);
      console.log('[SSE] Connected');
    };

    _source.onerror = function() {
      if (_connected) {
        _connected = false;
        _updateStatusUI(false);
        _fireStatusListeners(false);
        console.warn('[SSE] Connection lost, will reconnect...');
      }
      // EventSource auto-reconnects, but we manage our own for more control
      if (_source) {
        _source.close();
        _source = null;
      }
      _scheduleReconnect();
    };

    // Listen for the 'connected' welcome event
    _source.addEventListener('connected', function(e) {
      try {
        var data = JSON.parse(e.data);
        console.log('[SSE] Welcome:', data);
      } catch (_) {}
    });

    // Listen for replay-complete
    _source.addEventListener('replay-complete', function(e) {
      try {
        var data = JSON.parse(e.data);
        console.log('[SSE] Replay complete:', data.count, 'events');
      } catch (_) {}
    });

    // Register listeners for each channel:event pattern
    // SSE events come as "channel:event" names
    var channelList = ch.split(',');
    var knownEvents = {
      metabolism: ['energy-change', 'state-change', 'boost', 'crash', 'starvation'],
      pain: ['pain-signal', 'pain-healed', 'flinch', 'chronic-update'],
      consciousness: ['signal', 'mood-change', 'attention-shift', 'narration'],
      immune: ['threat-detected', 'threat-resolved', 'scan-complete', 'autoimmune'],
      shadow: ['challenge', 'observation', 'insight', 'dialogue'],
      loop: ['tick-complete', 'phase-complete', 'energy-gate', 'decision'],
      system: ['status-change', 'module-loaded', 'error', 'shutdown'],
    };

    channelList.forEach(function(channel) {
      var events = knownEvents[channel] || [];
      events.forEach(function(evt) {
        var eventName = channel + ':' + evt;
        if (_source) {
          _source.addEventListener(eventName, function(e) {
            _handleEvent(eventName, e);
          });
        }
      });
    });

    // Also listen for generic 'message' events (fallback)
    _source.onmessage = function(e) {
      _handleEvent('message', e);
    };
  }

  function disconnect() {
    if (_reconnectTimer) {
      clearTimeout(_reconnectTimer);
      _reconnectTimer = null;
    }
    if (_source) {
      _source.close();
      _source = null;
    }
    _connected = false;
    _updateStatusUI(false);
    _fireStatusListeners(false);
  }

  function _scheduleReconnect() {
    if (_reconnectTimer) return;
    _reconnectTimer = setTimeout(function() {
      _reconnectTimer = null;
      console.log('[SSE] Reconnecting (delay: ' + _reconnectDelay + 'ms)...');
      connect();
    }, _reconnectDelay);
    // Exponential backoff
    _reconnectDelay = Math.min(_reconnectDelay * 2, _maxReconnectDelay);
  }

  // ── Event Handling ──

  function _handleEvent(eventName, e) {
    _messageCount++;
    _lastEventTime = Date.now();
    var data = null;
    try { data = JSON.parse(e.data); } catch (_) { data = e.data; }

    // Fire specific handlers
    var handlers = _handlers[eventName];
    if (handlers) {
      handlers.forEach(function(fn) {
        try { fn(data, eventName); } catch (err) {
          console.error('[SSE] Handler error for', eventName, err);
        }
      });
    }

    // Fire global handlers
    _globalHandlers.forEach(function(fn) {
      try { fn(data, eventName); } catch (err) {
        console.error('[SSE] Global handler error:', err);
      }
    });

    // Auto-update dashboard panels based on event channel
    _autoUpdatePanel(eventName, data);
  }

  /**
   * Auto-update dashboard panels when SSE events arrive.
   * Maps channel events to panel DOM updates.
   */
  function _autoUpdatePanel(eventName, data) {
    if (!data) return;

    var parts = eventName.split(':');
    var channel = parts[0];
    var event = parts.slice(1).join(':');

    // Emit a custom DOM event for the dashboard to pick up
    try {
      var customEvent = new CustomEvent('aries-sse', {
        detail: { channel: channel, event: event, data: data, raw: eventName }
      });
      document.dispatchEvent(customEvent);
    } catch (_) {}

    // Direct panel updates for known patterns
    switch (channel) {
      case 'metabolism':
        _updateMetabolismPanel(event, data);
        break;
      case 'pain':
        _updatePainPanel(event, data);
        break;
      case 'consciousness':
        _updateConsciousnessPanel(event, data);
        break;
      case 'immune':
        _updateImmunePanel(event, data);
        break;
      case 'shadow':
        _updateShadowPanel(event, data);
        break;
      case 'loop':
        _updateLoopPanel(event, data);
        break;
    }
  }

  // ── Panel Updaters ──

  function _updateMetabolismPanel(event, data) {
    var el = document.getElementById('metabolism-energy') || document.querySelector('[data-sse="metabolism"]');
    if (!el) return;
    if (data.data && data.data.energy !== undefined) {
      el.textContent = Math.round(data.data.energy) + '%';
    }
    if (data.data && data.data.state) {
      var stateEl = document.getElementById('metabolism-state') || document.querySelector('[data-sse="metabolism-state"]');
      if (stateEl) stateEl.textContent = data.data.state;
    }
  }

  function _updatePainPanel(event, data) {
    var el = document.getElementById('pain-level') || document.querySelector('[data-sse="pain"]');
    if (!el) return;
    if (data.data && data.data.intensity !== undefined) {
      el.textContent = data.data.intensity + '/100';
    }
  }

  function _updateConsciousnessPanel(event, data) {
    var el = document.getElementById('consciousness-mood') || document.querySelector('[data-sse="consciousness"]');
    if (!el) return;
    if (data.data && data.data.mood) {
      el.textContent = data.data.mood;
    }
  }

  function _updateImmunePanel(event, data) {
    var el = document.getElementById('immune-status') || document.querySelector('[data-sse="immune"]');
    if (!el) return;
    if (data.data && data.data.threatLevel) {
      el.textContent = data.data.threatLevel;
    }
  }

  function _updateShadowPanel(event, data) {
    var el = document.getElementById('shadow-latest') || document.querySelector('[data-sse="shadow"]');
    if (!el) return;
    if (data.data && data.data.message) {
      el.textContent = data.data.message.slice(0, 120);
    }
  }

  function _updateLoopPanel(event, data) {
    var el = document.getElementById('loop-tick') || document.querySelector('[data-sse="loop"]');
    if (!el) return;
    if (data.data && data.data.tickNumber !== undefined) {
      el.textContent = 'Tick #' + data.data.tickNumber;
    }
  }

  // ── Status UI ──

  function _updateStatusUI(connected) {
    // Update or create the status indicator
    var indicator = document.getElementById('sse-status-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'sse-status-indicator';
      indicator.style.cssText = 'position:fixed;bottom:10px;right:10px;padding:4px 12px;border-radius:12px;font-size:11px;font-family:monospace;z-index:9999;cursor:pointer;transition:all 0.3s ease;';
      indicator.title = 'SSE Connection Status';
      indicator.onclick = function() {
        if (_connected) {
          console.log('[SSE] Stats:', window.AriesSSE.getStats());
        } else {
          connect();
        }
      };
      document.body.appendChild(indicator);
    }

    if (connected) {
      indicator.innerHTML = '<span style="color:#0f0;">●</span> Live';
      indicator.style.background = 'rgba(0,255,0,0.1)';
      indicator.style.border = '1px solid rgba(0,255,0,0.3)';
      indicator.style.color = '#0f0';
    } else {
      indicator.innerHTML = '<span style="color:#f00;">○</span> Disconnected';
      indicator.style.background = 'rgba(255,0,0,0.1)';
      indicator.style.border = '1px solid rgba(255,0,0,0.3)';
      indicator.style.color = '#f00';
    }
  }

  function _fireStatusListeners(connected) {
    _statusListeners.forEach(function(fn) {
      try { fn(connected); } catch (_) {}
    });
  }

  // ── Auto-connect on load ──
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { connect(); });
  } else {
    connect();
  }

})();
