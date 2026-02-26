/**
 * ARIES v5.0 — WebSocket Server (using ws package)
 */
const EventEmitter = require('events');
const os = require('os');
const { WebSocket: WS, WebSocketServer: WSS } = require('ws');

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

  get clientCount() { return this._clients.size; }

  handleUpgrade(req, socket, head) {
    this._wss.handleUpgrade(req, socket, head, (ws) => {
      this._wss.emit('connection', ws, req);
    });
  }

  attach(server) {
    const self = this;
    this._wss = new WSS({ noServer: true });

    this._wss.on('connection', function(ws, req) {
      // Auth check
      if (self._apiKey) {
        const url = require('url').parse(req.url, true);
        const key = url.query.key || '';
        const ip = (req.socket && req.socket.remoteAddress) || '';
        const isLocal = (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1');
        if (!isLocal && key !== self._apiKey) {
          ws.close(1008, 'Unauthorized');
          return;
        }
      }

      const clientId = ++self._clientId;
      self._clients.set(clientId, ws);

      ws.on('message', function(data) {
        try { self.emit('message', clientId, data.toString('utf8')); } catch {}
      });

      ws.on('close', function() { self._clients.delete(clientId); });
      ws.on('error', function() { self._clients.delete(clientId); });

      self.emit('connection', clientId);
    });

    // Heartbeat
    this._heartbeatTimer = setInterval(function() {
      for (const [id, ws] of self._clients) {
        if (ws.readyState !== WS.OPEN) { self._clients.delete(id); continue; }
        try { ws.ping(); } catch { self._clients.delete(id); }
      }
    }, this._heartbeatMs);

    // System metrics broadcast
    this._metricsTimer = setInterval(function() {
      if (self._clients.size === 0) return;
      const cpus = os.cpus();
      let totalIdle = 0, totalTick = 0;
      for (const cpu of cpus) {
        for (const type of Object.keys(cpu.times)) totalTick += cpu.times[type];
        totalIdle += cpu.times.idle;
      }
      const cpuUsage = Math.round((1 - totalIdle / totalTick) * 100);
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      self.broadcast('metrics', {
        cpu: cpuUsage,
        memUsed: Math.round((totalMem - freeMem) / 1048576),
        memTotal: Math.round(totalMem / 1048576),
        uptime: Math.round(os.uptime()),
        clients: self._clients.size
      });
    }, 5000);

    this._started = true;
  }

  broadcast(type, data) {
    if (this._clients.size === 0) return;
    const msg = JSON.stringify({ type, data, ts: Date.now() });
    for (const [id, ws] of this._clients) {
      try {
        if (ws.readyState === WS.OPEN) ws.send(msg);
        else this._clients.delete(id);
      } catch { this._clients.delete(id); }
    }
  }

  send(clientId, type, data) {
    const ws = this._clients.get(clientId);
    if (!ws || ws.readyState !== WS.OPEN) return;
    try { ws.send(JSON.stringify({ type, data, ts: Date.now() })); } catch {}
  }

  stop() {
    if (this._heartbeatTimer) { clearInterval(this._heartbeatTimer); this._heartbeatTimer = null; }
    if (this._metricsTimer) { clearInterval(this._metricsTimer); this._metricsTimer = null; }
    if (this._wss) { this._wss.close(); this._wss = null; }
    this._clients.clear();
  }
}

module.exports = { WebSocketServer };
