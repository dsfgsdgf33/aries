/**
 * ARIES v5.0 — Knowledge Graph Memory
 * 
 * Structured memory with nodes (entities) and edges (relationships).
 * Supports querying, pathfinding, AI auto-extraction, and visualization.
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_FILE = path.join(__dirname, '..', 'data', 'knowledge-graph.json');

class KnowledgeGraph extends EventEmitter {
  /**
   * @param {object} opts
   * @param {object} opts.ai - AI core module
   * @param {object} opts.config - knowledgeGraph config section
   */
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null;
    this.config = opts.config || {};
    this.maxNodes = this.config.maxNodes || 5000;
    this.autoExtractEnabled = this.config.autoExtract !== false;
    /** @type {Map<string, object>} */
    this.nodes = new Map();
    /** @type {Map<string, object>} */
    this.edges = new Map();
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        if (data.nodes) for (const n of data.nodes) this.nodes.set(n.id, n);
        if (data.edges) for (const e of data.edges) this.edges.set(e.id, e);
      }
    } catch {}
  }

  _save() {
    try {
      const dir = path.dirname(DATA_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify({
        nodes: [...this.nodes.values()],
        edges: [...this.edges.values()],
      }, null, 2));
    } catch {}
  }

  /**
   * Add a node (entity) to the graph
   * @param {object} node - { type, label, properties }
   * @returns {object} Created node
   */
  addNode(node) {
    if (this.nodes.size >= this.maxNodes) throw new Error(`Max nodes (${this.maxNodes}) reached`);
    const id = node.id || crypto.randomBytes(6).toString('hex');
    const entry = {
      id,
      type: node.type || 'concept', // person, project, tool, concept, etc.
      label: node.label || node.name || 'Unknown',
      properties: node.properties || {},
      createdAt: Date.now(),
    };
    this.nodes.set(id, entry);
    this._save();
    this.emit('node-added', entry);
    return entry;
  }

  /**
   * Add an edge (relationship) between two nodes
   * @param {object} edge - { from, to, type, properties }
   * @returns {object} Created edge
   */
  addEdge(edge) {
    if (!this.nodes.has(edge.from)) throw new Error(`Source node ${edge.from} not found`);
    if (!this.nodes.has(edge.to)) throw new Error(`Target node ${edge.to} not found`);
    const id = edge.id || crypto.randomBytes(6).toString('hex');
    const entry = {
      id,
      from: edge.from,
      to: edge.to,
      type: edge.type || 'related_to', // uses, created, depends_on, related_to, etc.
      properties: edge.properties || {},
      createdAt: Date.now(),
    };
    this.edges.set(id, entry);
    this._save();
    this.emit('edge-added', entry);
    return entry;
  }

  /**
   * Remove a node and all its edges
   * @param {string} nodeId
   */
  removeNode(nodeId) {
    this.nodes.delete(nodeId);
    for (const [eid, e] of this.edges) {
      if (e.from === nodeId || e.to === nodeId) this.edges.delete(eid);
    }
    this._save();
  }

  /**
   * Remove an edge
   * @param {string} edgeId
   */
  removeEdge(edgeId) {
    this.edges.delete(edgeId);
    this._save();
  }

  /**
   * Query the graph
   * @param {object} q - { type, label, property, value, nodeId }
   * @returns {object} Query results
   */
  query(q = {}) {
    let results = [...this.nodes.values()];

    if (q.type) results = results.filter(n => n.type === q.type);
    if (q.label) results = results.filter(n => n.label.toLowerCase().includes(q.label.toLowerCase()));
    if (q.property && q.value !== undefined) {
      results = results.filter(n => n.properties[q.property] === q.value);
    }

    // If nodeId specified, get neighbors
    if (q.nodeId) {
      const neighbors = this._getNeighbors(q.nodeId);
      return { node: this.nodes.get(q.nodeId), neighbors, edges: this._getNodeEdges(q.nodeId) };
    }

    return { nodes: results, total: results.length };
  }

  /**
   * Find path between two nodes (BFS)
   * @param {string} fromId
   * @param {string} toId
   * @returns {object[]} Path as array of { node, edge } objects, or null
   */
  findPath(fromId, toId) {
    if (!this.nodes.has(fromId) || !this.nodes.has(toId)) return null;
    if (fromId === toId) return [{ node: this.nodes.get(fromId), edge: null }];

    const adjacency = this._buildAdjacency();
    const visited = new Set([fromId]);
    const queue = [[fromId]];

    while (queue.length > 0) {
      const currentPath = queue.shift();
      const current = currentPath[currentPath.length - 1];
      const neighbors = adjacency.get(current) || [];

      for (const { nodeId, edgeId } of neighbors) {
        if (visited.has(nodeId)) continue;
        const newPath = [...currentPath, nodeId];
        if (nodeId === toId) {
          // Build full path with nodes and edges
          return newPath.map((nid, i) => ({
            node: this.nodes.get(nid),
            edge: i > 0 ? this._findEdgeBetween(newPath[i - 1], nid) : null,
          }));
        }
        visited.add(nodeId);
        queue.push(newPath);
      }
    }
    return null; // No path found
  }

  /**
   * Auto-extract entities and relationships from text using AI
   * @param {string} text
   * @returns {object} Extracted nodes and edges
   */
  async autoExtract(text) {
    if (!this.ai) throw new Error('AI module required for auto-extraction');

    const messages = [
      {
        role: 'system',
        content: `Extract entities and relationships from the given text. Return ONLY a JSON object:
{
  "nodes": [{"label":"...", "type":"person|project|tool|concept|organization|location", "properties":{}}],
  "edges": [{"fromLabel":"...", "toLabel":"...", "type":"uses|created|depends_on|related_to|works_at|part_of|owns"}]
}
Be precise. Only extract clearly stated entities and relationships.`
      },
      { role: 'user', content: text }
    ];

    try {
      const data = await this.ai.callWithFallback(messages, null);
      const content = data.choices?.[0]?.message?.content || '{}';
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) return { nodes: [], edges: [] };

      const extracted = JSON.parse(match[0]);
      const addedNodes = [];
      const addedEdges = [];
      const labelToId = new Map();

      // Add nodes (deduplicate by label)
      for (const n of (extracted.nodes || [])) {
        const existing = [...this.nodes.values()].find(
          ex => ex.label.toLowerCase() === (n.label || '').toLowerCase()
        );
        if (existing) {
          labelToId.set(n.label, existing.id);
        } else {
          const node = this.addNode(n);
          labelToId.set(n.label, node.id);
          addedNodes.push(node);
        }
      }

      // Add edges
      for (const e of (extracted.edges || [])) {
        const fromId = labelToId.get(e.fromLabel);
        const toId = labelToId.get(e.toLabel);
        if (fromId && toId) {
          try {
            const edge = this.addEdge({ from: fromId, to: toId, type: e.type });
            addedEdges.push(edge);
          } catch {}
        }
      }

      return { nodes: addedNodes, edges: addedEdges };
    } catch (e) {
      return { nodes: [], edges: [], error: e.message };
    }
  }

  /**
   * Get visualization data for d3.js rendering
   * @returns {object} { nodes: [...], edges: [...] }
   */
  getVisualizationData() {
    const colorMap = {
      person: '#ff4466', project: '#00d4ff', tool: '#00ff88',
      concept: '#ffaa00', organization: '#ff00ff', location: '#0af',
    };

    return {
      nodes: [...this.nodes.values()].map(n => ({
        id: n.id,
        label: n.label,
        type: n.type,
        color: colorMap[n.type] || '#888',
        properties: n.properties,
      })),
      edges: [...this.edges.values()].map(e => ({
        id: e.id,
        source: e.from,
        target: e.to,
        type: e.type,
        label: e.type,
      })),
      stats: {
        nodeCount: this.nodes.size,
        edgeCount: this.edges.size,
        types: this._countTypes(),
      },
    };
  }

  /**
   * Search nodes by term
   * @param {string} term
   * @returns {object[]} Matching nodes
   */
  search(term) {
    const lower = term.toLowerCase();
    return [...this.nodes.values()].filter(n =>
      n.label.toLowerCase().includes(lower) ||
      n.type.toLowerCase().includes(lower) ||
      Object.values(n.properties || {}).some(v => String(v).toLowerCase().includes(lower))
    );
  }

  // ── Internal helpers ──

  _getNeighbors(nodeId) {
    const neighbors = [];
    for (const e of this.edges.values()) {
      if (e.from === nodeId) neighbors.push({ node: this.nodes.get(e.to), edge: e, direction: 'outgoing' });
      if (e.to === nodeId) neighbors.push({ node: this.nodes.get(e.from), edge: e, direction: 'incoming' });
    }
    return neighbors;
  }

  _getNodeEdges(nodeId) {
    return [...this.edges.values()].filter(e => e.from === nodeId || e.to === nodeId);
  }

  _buildAdjacency() {
    const adj = new Map();
    for (const e of this.edges.values()) {
      if (!adj.has(e.from)) adj.set(e.from, []);
      if (!adj.has(e.to)) adj.set(e.to, []);
      adj.get(e.from).push({ nodeId: e.to, edgeId: e.id });
      adj.get(e.to).push({ nodeId: e.from, edgeId: e.id });
    }
    return adj;
  }

  _findEdgeBetween(a, b) {
    for (const e of this.edges.values()) {
      if ((e.from === a && e.to === b) || (e.from === b && e.to === a)) return e;
    }
    return null;
  }

  _countTypes() {
    const counts = {};
    for (const n of this.nodes.values()) {
      counts[n.type] = (counts[n.type] || 0) + 1;
    }
    return counts;
  }
}

module.exports = { KnowledgeGraph };
