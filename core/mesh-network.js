/**
 * ARIES Mesh Network — Multi-Instance Discovery & Task Delegation
 * Uses UDP broadcast for auto-discovery and HTTP for task delegation.
 * Node.js built-ins only (dgram, http, os).
 */
const dgram = require('dgram');
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const BROADCAST_PORT = 9710;
const BROADCAST_INTERVAL = 30000;
const PEER_TIMEOUT = 90000; // consider peer dead after 90s

class MeshNetwork extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.id = opts.id || crypto.randomBytes(8).toString('hex');
    this.port = opts.port || 3333;
    this.hostname = os.hostname();
    this.agents = [];
    this.capabilities = opts.capabilities || ['chat', 'code', 'search', 'browse'];
    this._peers = new Map(); // peerId -> { id, hostname, host, port, agents, capabilities, lastSeen }
    this._udpSocket = null;
    this._broadcastTimer = null;
    this._cleanupTimer = null;
    this._running = false;
    this._subagentManager = opts.subagentManager || null;
    this._ai = opts.ai || null;
  }

  /** Start mesh discovery */
  start() {
    if (this._running) return;
    this._running = true;

    // Refresh agent list
    this._refreshAgents();

    try {
      this._udpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      
      this._udpSocket.on('message', (msg, rinfo) => {
        try {
          const data = JSON.parse(msg.toString());
          if (data.type === 'aries-mesh-announce' && data.id !== this.id) {
            this._handleAnnounce(data, rinfo);
          }
        } catch {}
      });

      this._udpSocket.on('error', (err) => {
        console.error('[MESH] UDP error:', err.message);
      });

      this._udpSocket.bind(BROADCAST_PORT, () => {
        this._udpSocket.setBroadcast(true);
        console.log('[MESH] Listening on UDP port', BROADCAST_PORT);
        
        // Start broadcasting
        this._broadcast();
        this._broadcastTimer = setInterval(() => this._broadcast(), BROADCAST_INTERVAL);
        
        // Cleanup stale peers
        this._cleanupTimer = setInterval(() => this._cleanupPeers(), PEER_TIMEOUT / 2);
      });
    } catch (e) {
      console.error('[MESH] Failed to start UDP:', e.message);
      // Even without UDP, manual peer add still works
    }

    console.log('[MESH] Network started. Instance ID:', this.id);
    return this;
  }

  /** Stop mesh network */
  stop() {
    this._running = false;
    if (this._broadcastTimer) clearInterval(this._broadcastTimer);
    if (this._cleanupTimer) clearInterval(this._cleanupTimer);
    if (this._udpSocket) {
      try { this._udpSocket.close(); } catch {}
      this._udpSocket = null;
    }
    console.log('[MESH] Network stopped');
  }

  _refreshAgents() {
    if (this._subagentManager) {
      try {
        this.agents = this._subagentManager.list().map(a => ({
          id: a.id, name: a.name, icon: a.icon || '🤖',
          specialties: a.specialties || []
        }));
      } catch {}
    }
  }

  _broadcast() {
    if (!this._udpSocket) return;
    this._refreshAgents();
    
    const msg = JSON.stringify({
      type: 'aries-mesh-announce',
      id: this.id,
      hostname: this.hostname,
      port: this.port,
      agents: this.agents,
      capabilities: this.capabilities,
      version: '8.1',
      ts: Date.now()
    });

    const buf = Buffer.from(msg);
    
    // Broadcast to all network interfaces
    const interfaces = os.networkInterfaces();
    for (const [name, addrs] of Object.entries(interfaces)) {
      for (const addr of addrs) {
        if (addr.family === 'IPv4' && !addr.internal) {
          // Calculate broadcast address
          const parts = addr.address.split('.');
          const mask = addr.netmask.split('.');
          const broadcast = parts.map((p, i) => (parseInt(p) | (~parseInt(mask[i]) & 255)).toString()).join('.');
          try {
            this._udpSocket.send(buf, 0, buf.length, BROADCAST_PORT, broadcast);
          } catch {}
        }
      }
    }
  }

  _handleAnnounce(data, rinfo) {
    const existing = this._peers.get(data.id);
    const peer = {
      id: data.id,
      hostname: data.hostname,
      host: rinfo.address,
      port: data.port,
      agents: data.agents || [],
      capabilities: data.capabilities || [],
      version: data.version || 'unknown',
      lastSeen: Date.now(),
      discovered: existing ? existing.discovered : 'auto'
    };
    
    if (!existing) {
      console.log('[MESH] Discovered peer:', peer.hostname, '@', peer.host + ':' + peer.port);
      this.emit('peer-discovered', peer);
    }
    
    this._peers.set(data.id, peer);
  }

  _cleanupPeers() {
    const now = Date.now();
    for (const [id, peer] of this._peers) {
      if (peer.discovered === 'manual') continue; // don't remove manual peers
      if (now - peer.lastSeen > PEER_TIMEOUT) {
        console.log('[MESH] Peer timed out:', peer.hostname);
        this._peers.delete(id);
        this.emit('peer-lost', peer);
      }
    }
  }

  /** Add a peer manually */
  addPeer(host, port) {
    const peerId = 'manual-' + crypto.randomBytes(4).toString('hex');
    
    // Try to fetch peer info via HTTP
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: host, port: port,
        path: '/api/mesh/info',
        method: 'GET',
        timeout: 5000
      }, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          try {
            const info = JSON.parse(body);
            const peer = {
              id: info.id || peerId,
              hostname: info.hostname || host,
              host: host,
              port: port,
              agents: info.agents || [],
              capabilities: info.capabilities || [],
              version: info.version || 'unknown',
              lastSeen: Date.now(),
              discovered: 'manual'
            };
            this._peers.set(peer.id, peer);
            this.emit('peer-discovered', peer);
            resolve(peer);
          } catch {
            // Add as basic peer even if info endpoint not available
            const peer = { id: peerId, hostname: host, host, port, agents: [], capabilities: [], lastSeen: Date.now(), discovered: 'manual' };
            this._peers.set(peerId, peer);
            resolve(peer);
          }
        });
      });
      req.on('error', () => {
        // Add anyway
        const peer = { id: peerId, hostname: host, host, port, agents: [], capabilities: [], lastSeen: Date.now(), discovered: 'manual' };
        this._peers.set(peerId, peer);
        resolve(peer);
      });
      req.on('timeout', () => { req.destroy(); });
      req.end();
    });
  }

  /** Remove a peer */
  removePeer(peerId) {
    return this._peers.delete(peerId);
  }

  /** List all known peers */
  listPeers() {
    return Array.from(this._peers.values());
  }

  /** Delegate a task to a remote peer's agent */
  delegateTask(peerId, agentId, task) {
    const peer = this._peers.get(peerId);
    if (!peer) return Promise.reject(new Error('Peer not found: ' + peerId));

    return new Promise((resolve, reject) => {
      const postData = JSON.stringify({ agentId, task });
      const req = http.request({
        hostname: peer.host, port: peer.port,
        path: '/api/subagents/' + agentId + '/task',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'X-Mesh-From': this.id
        },
        timeout: 60000
      }, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch { resolve({ ok: true, response: body }); }
        });
      });
      req.on('error', e => reject(new Error('Delegation failed: ' + e.message)));
      req.on('timeout', () => { req.destroy(); reject(new Error('Delegation timed out')); });
      req.write(postData);
      req.end();
    });
  }

  /** Get info about this instance (for /api/mesh/info endpoint) */
  getInfo() {
    this._refreshAgents();
    return {
      id: this.id,
      hostname: this.hostname,
      port: this.port,
      agents: this.agents,
      capabilities: this.capabilities,
      version: '8.1',
      peers: this._peers.size,
      uptime: process.uptime()
    };
  }

  /** Get status summary */
  getStatus() {
    return {
      running: this._running,
      id: this.id,
      hostname: this.hostname,
      peerCount: this._peers.size,
      peers: this.listPeers()
    };
  }

  /** Get topology for dashboard */
  getTopology() {
    return {
      gateway: null,
      peers: this.listPeers(),
      self: { id: this.id, hostname: this.hostname, port: this.port, agents: this.agents }
    };
  }

  /** Get stats for dashboard */
  getStats() {
    return {
      role: 'peer',
      peers: this._peers.size,
      messagesRelayed: 0,
      bytesRelayed: 0,
      uptime: process.uptime(),
      gatewayIp: null,
      queueSize: 0
    };
  }
}

module.exports = MeshNetwork;
