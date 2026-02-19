/**
 * ARIES v3.0 — Swarm Coordinator
 * 
 * Manages both local and remote workers.
 * Remote workers connect via WebSocket.
 * Provides load balancing, health checks, and worker management.
 */

const EventEmitter = require('events');
const http = require('http');
let WebSocketServer;
try { WebSocketServer = require('ws').WebSocketServer; } catch { WebSocketServer = null; }

class SwarmCoordinator extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
    this.remoteWorkers = new Map();  // id → { ws, info, lastHeartbeat, status }
    this.server = null;
    this.httpServer = null;
    this.port = config.port || 9700;
    this.secret = config.secret || 'aries-swarm-secret';
    this.heartbeatInterval = null;
    this.heartbeatIntervalMs = config.heartbeatIntervalMs || 10000;
    this.heartbeatTimeoutMs = config.heartbeatTimeoutMs || 30000;
    this._taskIdCounter = 0;
    this._pendingTasks = new Map(); // taskId → { resolve, reject, timeout }
  }

  /**
   * Start the WebSocket server for remote worker connections.
   */
  start() {
    if (!WebSocketServer) {
      this.emit('log', 'ws module not available — remote workers disabled');
      return false;
    }

    this.httpServer = http.createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', workers: this.remoteWorkers.size }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    this.server = new WebSocketServer({ server: this.httpServer });

    this.server.on('connection', (ws, req) => {
      this._handleConnection(ws, req);
    });

    // Catch errors so they don't crash the process
    this.server.on('error', () => {});
    this.httpServer.on('error', (err) => {
      if (err.code !== 'EADDRINUSE') this.emit('error', err);
    });

    try {
      this.httpServer.listen(this.port, '0.0.0.0', () => {
        this.emit('log', `Coordinator listening on port ${this.port}`);
      });
    } catch (e) {
      return false;
    }

    // Start heartbeat checker
    this.heartbeatInterval = setInterval(() => this._checkHeartbeats(), this.heartbeatIntervalMs);
    return true;
  }

  stop() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    for (const [id, worker] of this.remoteWorkers) {
      try { worker.ws.close(); } catch {}
    }
    this.remoteWorkers.clear();
    if (this.server) this.server.close();
    if (this.httpServer) this.httpServer.close();
  }

  _handleConnection(ws, req) {
    let authenticated = false;
    let workerId = null;

    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }

      // Authentication
      if (msg.type === 'auth') {
        if (msg.secret !== this.secret) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid secret' }));
          ws.close();
          return;
        }
        authenticated = true;
        workerId = msg.workerId || `remote-${Date.now().toString(36)}`;
        this.remoteWorkers.set(workerId, {
          ws,
          info: msg.info || {},
          lastHeartbeat: Date.now(),
          status: 'idle',
          tasksCompleted: 0
        });
        ws.send(JSON.stringify({ type: 'auth_ok', workerId }));
        this.emit('worker_connected', workerId, msg.info || {});
        return;
      }

      if (!authenticated) {
        ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated' }));
        return;
      }

      // Heartbeat
      if (msg.type === 'heartbeat') {
        const worker = this.remoteWorkers.get(workerId);
        if (worker) {
          worker.lastHeartbeat = Date.now();
          worker.info = msg.info || worker.info;
        }
        ws.send(JSON.stringify({ type: 'heartbeat_ack' }));
        return;
      }

      // Task result
      if (msg.type === 'task_result') {
        const pending = this._pendingTasks.get(msg.taskId);
        if (pending) {
          clearTimeout(pending.timeout);
          this._pendingTasks.delete(msg.taskId);
          const worker = this.remoteWorkers.get(workerId);
          if (worker) { worker.status = 'idle'; worker.tasksCompleted++; }
          if (msg.error) pending.reject(new Error(msg.error));
          else pending.resolve(msg.result);
        }
        return;
      }
    });

    ws.on('close', () => {
      if (workerId) {
        this.remoteWorkers.delete(workerId);
        this.emit('worker_disconnected', workerId);
      }
    });

    ws.on('error', () => {
      if (workerId) {
        this.remoteWorkers.delete(workerId);
        this.emit('worker_disconnected', workerId);
      }
    });
  }

  _checkHeartbeats() {
    const now = Date.now();
    for (const [id, worker] of this.remoteWorkers) {
      if (now - worker.lastHeartbeat > this.heartbeatTimeoutMs) {
        this.emit('log', `Worker ${id} timed out — disconnecting`);
        try { worker.ws.close(); } catch {}
        this.remoteWorkers.delete(id);
        this.emit('worker_disconnected', id);
      }
    }
  }

  /**
   * Dispatch a task to a remote worker.
   * @param {string} task - Task description
   * @param {string} systemPrompt - System prompt for the worker
   * @param {number} timeoutMs - Timeout in ms
   * @returns {Promise<string>} Worker result
   */
  dispatchRemote(task, systemPrompt, timeoutMs = 90000) {
    // Find an idle remote worker
    for (const [id, worker] of this.remoteWorkers) {
      if (worker.status === 'idle') {
        return this._sendTask(id, worker, task, systemPrompt, timeoutMs);
      }
    }
    return Promise.reject(new Error('No idle remote workers'));
  }

  _sendTask(workerId, worker, task, systemPrompt, timeoutMs) {
    return new Promise((resolve, reject) => {
      const taskId = ++this._taskIdCounter;
      worker.status = 'busy';

      const timeout = setTimeout(() => {
        this._pendingTasks.delete(taskId);
        worker.status = 'idle';
        reject(new Error('Remote worker timed out'));
      }, timeoutMs);

      this._pendingTasks.set(taskId, { resolve, reject, timeout });

      worker.ws.send(JSON.stringify({
        type: 'task',
        taskId,
        task,
        systemPrompt
      }));

      this.emit('task_dispatched', workerId, taskId);
    });
  }

  /**
   * Manually connect to a remote worker host.
   * @param {string} host - host:port string
   */
  connectTo(host) {
    let WebSocket;
    try { WebSocket = require('ws'); } catch { return false; }
    
    const url = host.startsWith('ws') ? host : `ws://${host}`;
    const ws = new WebSocket(url);
    
    ws.on('open', () => {
      // Send auth from coordinator side — this is for connecting to a worker's listen port
      // But our architecture has workers connect TO coordinator, so this is a convenience
      // that triggers the worker to register
      ws.send(JSON.stringify({ type: 'coordinator_hello', secret: this.secret }));
    });
    
    ws.on('error', () => {});
    return true;
  }

  /** Get list of connected remote workers */
  getWorkers() {
    const workers = [];
    for (const [id, w] of this.remoteWorkers) {
      workers.push({
        id,
        status: w.status,
        lastHeartbeat: w.lastHeartbeat,
        info: w.info,
        tasksCompleted: w.tasksCompleted,
        latency: Date.now() - w.lastHeartbeat
      });
    }
    return workers;
  }

  /** Check if any remote workers are available */
  hasIdleWorker() {
    for (const [, w] of this.remoteWorkers) {
      if (w.status === 'idle') return true;
    }
    return false;
  }

  /** Get count of remote workers */
  get workerCount() {
    return this.remoteWorkers.size;
  }
}

module.exports = SwarmCoordinator;
