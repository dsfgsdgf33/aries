/**
 * ARIES — Associative Memory
 * Graph-based memory network with weighted connections and spreading activation.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'memory-graph');
const NODES_PATH = path.join(DATA_DIR, 'nodes.json');
const EDGES_PATH = path.join(DATA_DIR, 'edges.json');

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(path.dirname(p)); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }

const VALID_NODE_TYPES = ['fact', 'event', 'preference', 'skill', 'insight', 'person', 'concept'];
const VALID_EDGE_TYPES = ['causes', 'relates', 'contradicts', 'supports', 'reminds', 'follows'];

class AssociativeMemory {
  constructor(opts) {
    this.refs = opts || {};
    ensureDir(DATA_DIR);
  }

  _getNodes() { return readJSON(NODES_PATH, []); }
  _getEdges() { return readJSON(EDGES_PATH, []); }
  _saveNodes(n) { writeJSON(NODES_PATH, n); }
  _saveEdges(e) { writeJSON(EDGES_PATH, e); }

  /**
   * Add a memory node
   */
  addMemory(content, type, tags) {
    if (!content) return { error: 'Content required' };
    type = VALID_NODE_TYPES.includes(type) ? type : 'concept';
    tags = Array.isArray(tags) ? tags : (tags ? [tags] : []);

    const nodes = this._getNodes();
    const node = {
      id: uuid(),
      content,
      type,
      tags,
      createdAt: Date.now(),
      accessCount: 0,
      lastAccessed: null,
      strength: 80
    };
    nodes.push(node);
    this._saveNodes(nodes);
    return node;
  }

  /**
   * Create an edge between two memory nodes
   */
  connect(id1, id2, type, weight) {
    type = VALID_EDGE_TYPES.includes(type) ? type : 'relates';
    weight = Math.max(0, Math.min(100, weight || 50));

    const nodes = this._getNodes();
    if (!nodes.find(n => n.id === id1)) return { error: 'Node ' + id1 + ' not found' };
    if (!nodes.find(n => n.id === id2)) return { error: 'Node ' + id2 + ' not found' };

    const edges = this._getEdges();
    // Update existing edge or create new
    const existing = edges.find(e => (e.from === id1 && e.to === id2) || (e.from === id2 && e.to === id1));
    if (existing) {
      existing.weight = weight;
      existing.type = type;
    } else {
      edges.push({ from: id1, to: id2, weight, type, createdAt: Date.now() });
    }
    this._saveEdges(edges);
    return { connected: true, from: id1, to: id2, weight, type };
  }

  /**
   * Recall with spreading activation
   */
  recall(query) {
    if (!query) return { primary: [], associated: [] };
    const nodes = this._getNodes();
    const edges = this._getEdges();
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);

    // Score primary matches
    const scored = nodes.map(node => {
      let score = 0;
      const contentLower = (node.content || '').toLowerCase();
      const tagStr = (node.tags || []).join(' ').toLowerCase();

      // Exact content match
      if (contentLower.includes(queryLower)) score += 50;
      // Word matches
      for (const word of queryWords) {
        if (contentLower.includes(word)) score += 10;
        if (tagStr.includes(word)) score += 15;
      }
      // Type bonus
      if (node.type === 'fact' || node.type === 'insight') score += 5;
      // Strength bonus
      score += (node.strength || 50) * 0.1;

      return { node, score };
    }).filter(s => s.score > 0).sort((a, b) => b.score - a.score);

    const primary = scored.slice(0, 10);
    const primaryIds = new Set(primary.map(p => p.node.id));

    // Spreading activation: find connected nodes
    const activation = new Map();
    for (const { node, score } of primary) {
      const connected = edges.filter(e => e.from === node.id || e.to === node.id);
      for (const edge of connected) {
        const neighborId = edge.from === node.id ? edge.to : edge.from;
        if (primaryIds.has(neighborId)) continue;
        const spread = score * (edge.weight / 100) * 0.5;
        activation.set(neighborId, (activation.get(neighborId) || 0) + spread);
      }
    }

    // Second-degree activation (weaker)
    for (const [nodeId, actScore] of activation) {
      const connected = edges.filter(e => e.from === nodeId || e.to === nodeId);
      for (const edge of connected) {
        const neighborId = edge.from === nodeId ? edge.to : edge.from;
        if (primaryIds.has(neighborId) || activation.has(neighborId)) continue;
        const spread = actScore * (edge.weight / 100) * 0.2;
        if (spread > 1) activation.set(neighborId, (activation.get(neighborId) || 0) + spread);
      }
    }

    const associated = [];
    for (const [nodeId, actScore] of [...activation.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
      const node = nodes.find(n => n.id === nodeId);
      if (node) associated.push({ node, activationScore: Math.round(actScore * 100) / 100 });
    }

    // Strengthen accessed nodes
    const accessed = primary.map(p => p.node.id);
    this._strengthenBatch(accessed);

    return {
      query,
      primary: primary.map(p => ({ ...p.node, matchScore: Math.round(p.score * 100) / 100 })),
      associated: associated.map(a => ({ ...a.node, activationScore: a.activationScore })),
      totalActivated: primary.length + associated.length
    };
  }

  /**
   * Increase strength on access
   */
  strengthen(id) {
    const nodes = this._getNodes();
    const node = nodes.find(n => n.id === id);
    if (!node) return { error: 'Node not found' };
    node.strength = Math.min(100, (node.strength || 50) + 5);
    node.accessCount = (node.accessCount || 0) + 1;
    node.lastAccessed = Date.now();
    this._saveNodes(nodes);
    return node;
  }

  _strengthenBatch(ids) {
    const nodes = this._getNodes();
    let changed = false;
    for (const id of ids) {
      const node = nodes.find(n => n.id === id);
      if (node) {
        node.strength = Math.min(100, (node.strength || 50) + 2);
        node.accessCount = (node.accessCount || 0) + 1;
        node.lastAccessed = Date.now();
        changed = true;
      }
    }
    if (changed) this._saveNodes(nodes);
  }

  /**
   * Decay all memories over time
   */
  decay() {
    const nodes = this._getNodes();
    const now = Date.now();
    let decayed = 0;
    let archived = 0;

    for (const node of nodes) {
      const age = now - (node.lastAccessed || node.createdAt);
      const daysSinceAccess = age / (24 * 60 * 60 * 1000);

      // Decay rate: lose 1 strength per day without access, minimum 1
      const loss = Math.min(node.strength - 1, Math.floor(daysSinceAccess * 0.5));
      if (loss > 0) {
        node.strength = Math.max(1, node.strength - loss);
        decayed++;
      }
      if (node.strength <= 5) archived++;
    }

    this._saveNodes(nodes);
    return { decayed, archived, total: nodes.length };
  }

  /**
   * Get subgraph around a node
   */
  getNetwork(centerId, depth) {
    depth = depth || 2;
    const nodes = this._getNodes();
    const edges = this._getEdges();

    const visited = new Set();
    const resultNodes = [];
    const resultEdges = [];
    const queue = [{ id: centerId, d: 0 }];

    while (queue.length > 0) {
      const { id, d } = queue.shift();
      if (visited.has(id) || d > depth) continue;
      visited.add(id);

      const node = nodes.find(n => n.id === id);
      if (node) resultNodes.push(node);

      if (d < depth) {
        const connected = edges.filter(e => e.from === id || e.to === id);
        for (const edge of connected) {
          resultEdges.push(edge);
          const neighborId = edge.from === id ? edge.to : edge.from;
          if (!visited.has(neighborId)) queue.push({ id: neighborId, d: d + 1 });
        }
      }
    }

    return { center: centerId, depth, nodes: resultNodes, edges: resultEdges };
  }

  /**
   * Detect clusters and patterns
   */
  findPatterns() {
    const nodes = this._getNodes();
    const edges = this._getEdges();

    // Find clusters via connected components
    const adjMap = new Map();
    for (const node of nodes) adjMap.set(node.id, []);
    for (const edge of edges) {
      if (adjMap.has(edge.from)) adjMap.get(edge.from).push(edge.to);
      if (adjMap.has(edge.to)) adjMap.get(edge.to).push(edge.from);
    }

    const visited = new Set();
    const clusters = [];
    for (const node of nodes) {
      if (visited.has(node.id)) continue;
      const cluster = [];
      const stack = [node.id];
      while (stack.length > 0) {
        const id = stack.pop();
        if (visited.has(id)) continue;
        visited.add(id);
        cluster.push(id);
        const neighbors = adjMap.get(id) || [];
        for (const n of neighbors) if (!visited.has(n)) stack.push(n);
      }
      if (cluster.length > 1) clusters.push(cluster);
    }

    // Find hub nodes (most connections)
    const connectionCount = {};
    for (const edge of edges) {
      connectionCount[edge.from] = (connectionCount[edge.from] || 0) + 1;
      connectionCount[edge.to] = (connectionCount[edge.to] || 0) + 1;
    }
    const hubs = Object.entries(connectionCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, count]) => {
        const node = nodes.find(n => n.id === id);
        return { id, connections: count, content: node ? node.content.slice(0, 80) : '?' };
      });

    // Strong connections
    const strongEdges = edges.filter(e => e.weight >= 70)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 10)
      .map(e => {
        const from = nodes.find(n => n.id === e.from);
        const to = nodes.find(n => n.id === e.to);
        return { from: from ? from.content.slice(0, 50) : e.from, to: to ? to.content.slice(0, 50) : e.to, weight: e.weight, type: e.type };
      });

    return {
      totalNodes: nodes.length,
      totalEdges: edges.length,
      clusters: clusters.map(c => ({ size: c.length, nodeIds: c.slice(0, 5) })),
      clusterCount: clusters.length,
      hubs,
      strongConnections: strongEdges,
      isolatedNodes: nodes.filter(n => !connectionCount[n.id]).length
    };
  }

  /**
   * Strongest memories
   */
  getStrongest(limit) {
    limit = limit || 10;
    return this._getNodes().sort((a, b) => (b.strength || 0) - (a.strength || 0)).slice(0, limit);
  }

  /**
   * Weakest (fading) memories
   */
  getWeakest(limit) {
    limit = limit || 10;
    return this._getNodes().sort((a, b) => (a.strength || 0) - (b.strength || 0)).slice(0, limit);
  }

  /**
   * Get all nodes and edges for graph viz
   */
  getAll() {
    return { nodes: this._getNodes(), edges: this._getEdges() };
  }
}

module.exports = AssociativeMemory;
