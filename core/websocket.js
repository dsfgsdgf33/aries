/**
 * ARIES v5.0 — WebSocket Server
 * Uses the 'ws' npm module for RFC 6455 compliance.
 */

const EventEmitter = require('events');
const os = require('os');
const WebSocket = require('ws');

class WebSocketServer extends EventEmitter {
  constructor(config) {
    super();
    config = config || {};
    this._clients = new Map();
    this._clientId = 0;
    this._apiKey = config.apiKey || '';
    this._heartbeatMs = config.heartbeatMs || 30000;
    this._heartbeatTimer = null;
    this._metricsTimer = null;
    this._wss = null;
    this._started = false;
  }

  attach(server) {
    var self = this;
    this._wss = new WebSocket.Server({ noServer: true });

    server.on('upgrade', function(req, socket, head) {
      try {
        var urlParts = require('url').parse(req.url, true);
        if (urlParts.pathname !== '/ws') {
          // Let other upgrade handlers (extension bridge) handle non-/ws paths
          return;
        }

        // Auth check
        if (self._apiKey) {
          var key = urlParts.query.key || '';
          var ip = (req.socket && req.socket.remoteAddress) || '';
          var isLocal = (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1');
          if (!isLocal && key !== self._apiKey) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
          }
        }

        self._wss.handleUpgrade(req, socket, head, function(ws) {
          self._onConnection(ws, req);
        });
      } catch (err) {
        try { socket.destroy(); } catch (e) {}
      }
    });

    this._startHeartbeat();
    this._startMetrics();
    this._started = true;
  }

  _onConnection(ws, req) {
    var id = ++this._clientId;
    var ip = (req.socket && req.socket.remoteAddress) || 'unknown';
    var entry = {
      id: id,
      ws: ws,
      ip: ip,
      connectedAt: Date.now(),
      alive: true
    };
    this._clients.set(id, entry);
    this.emit('connection', { id: id, ip: ip });

    var self = this;
    ws.on('pong', function() { entry.alive = true; });
    ws.on('message', function(data) {
      try {
        var parsed = JSON.parse(data.toString());
        self.emit('message', { clientId: id, data: parsed });
      } catch (e) {}
    });
    ws.on('close', function() { self._clients.delete(id); self.emit('disconnect', { id: id }); });
    ws.on('error', function() { self._clients.delete(id); });
  }

  broadcast(event, data) {
    var msg = JSON.stringify({ event: event, data: data, timestamp: Date.now() });
    for (var entry of this._clients.values()) {
      try {
        if (entry.ws.readyState === WebSocket.OPEN) {
          entry.ws.send(msg);
        }
      } catch (e) {
        this._clients.delete(entry.id);
      }
    }
  }

  send(clientId, event, data) {
    var client = this._clients.get(clientId);
    if (!client || client.ws.readyState !== WebSocket.OPEN) return;
    try {
      client.ws.send(JSON.stringify({ event: event, data: data, timestamp: Date.now() }));
    } catch (e) {}
  }

  getClients() {
    var result = [];
    for (var entry of this._clients.values()) {
      result.push({ id: entry.id, ip: entry.ip, connectedAt: entry.connectedAt, alive: entry.alive });
    }
    return result;
  }

  get clientCount() {
    return this._clients.size;
  }

  stop() {
    if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);
    if (this._metricsTimer) clearInterval(this._metricsTimer);
    for (var entry of this._clients.values()) {
      try { entry.ws.close(); } catch (e) {}
    }
    this._clients.clear();
    if (this._wss) { try { this._wss.close(); } catch (e) {} }
    this._started = false;
  }

  _startHeartbeat() {
    var self = this;
    this._heartbeatTimer = setInterval(function() {
      for (var entry of self._clients.values()) {
        if (!entry.alive) {
          try { entry.ws.terminate(); } catch (e) {}
          self._clients.delete(entry.id);
          continue;
        }
        entry.alive = false;
        try { entry.ws.ping(); } catch (e) {}
      }
    }, this._heartbeatMs);
  }

  _startMetrics() {
    var self = this;
    this._metricsTimer = setInterval(function() {
      if (self._clients.size === 0) return;
      var cpus = os.cpus();
      var totalIdle = 0, totalTick = 0;
      for (var i = 0; i < cpus.length; i++) {
        for (var type in cpus[i].times) totalTick += cpus[i].times[type];
        totalIdle += cpus[i].times.idle;
      }
      var cpuPct = Math.round(100 - (totalIdle / totalTick * 100));
      var totalMem = os.totalmem();
      var freeMem = os.freemem();
      var usedMem = totalMem - freeMem;
      self.broadcast('system', {
        cpu: cpuPct,
        memUsed: usedMem,
        memTotal: totalMem,
        memPct: Math.round(usedMem / totalMem * 100),
        uptime: os.uptime(),
        platform: os.platform()
      });
    }, 5000);
  }
}

module.exports = { WebSocketServer };
