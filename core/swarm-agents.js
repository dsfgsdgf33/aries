/**
 * ARIES — Dynamic Swarm Agent Factory
 * Creates/manages swarm agents that use different providers.
 * Registers API routes via addRoute callback.
 * @module core/swarm-agents
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

/** Role templates */
const ROLE_TEMPLATES = {
  researcher: { icon: '&#x1F50D;', systemPrompt: 'You are a research agent. Find, verify, and summarize information accurately.' },
  coder: { icon: '&#x1F4BB;', systemPrompt: 'You are a coding agent. Write clean, efficient code and debug issues.' },
  analyst: { icon: '&#x1F4CA;', systemPrompt: 'You are an analysis agent. Analyze data, identify patterns, and provide insights.' },
  scout: { icon: '&#x1F441;', systemPrompt: 'You are a scout agent. Monitor sources and report changes or opportunities.' },
  writer: { icon: '&#x270D;', systemPrompt: 'You are a writing agent. Create clear, engaging content.' },
  planner: { icon: '&#x1F4CB;', systemPrompt: 'You are a planning agent. Break down goals into actionable tasks.' },
  critic: { icon: '&#x1F9D0;', systemPrompt: 'You are a critic agent. Review work and provide constructive feedback.' },
  ops: { icon: '&#x2699;', systemPrompt: 'You are an operations agent. Manage deployments, monitors, and infrastructure.' },
};

class SwarmAgents extends EventEmitter {
  /**
   * @param {Object} opts
   * @param {Object} opts.providerManager - ProviderManager instance
   * @param {string} [opts.dataDir]
   */
  constructor(opts = {}) {
    super();
    this.providerManager = opts.providerManager;
    this.dataDir = opts.dataDir || path.join(__dirname, '..', 'data');
    /** @type {Map<string, Object>} */
    this.agents = new Map();
    this._load();
  }

  /** Load agents from disk */
  _load() {
    try {
      var fp = path.join(this.dataDir, 'swarm-agents.json');
      if (fs.existsSync(fp)) {
        var arr = JSON.parse(fs.readFileSync(fp, 'utf8'));
        for (var i = 0; i < arr.length; i++) {
          this.agents.set(arr[i].id, arr[i]);
        }
      }
    } catch (e) { /* fresh start */ }
  }

  /** Save agents to disk */
  _save() {
    try {
      if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
      var arr = [];
      for (const [, a] of this.agents) arr.push(a);
      fs.writeFileSync(path.join(this.dataDir, 'swarm-agents.json'), JSON.stringify(arr, null, 2));
    } catch (e) {
      this.emit('error', e);
    }
  }

  /**
   * Create a new agent
   * @param {Object} opts
   * @returns {Object}
   */
  createAgent(opts) {
    var id = crypto.randomBytes(8).toString('hex');
    var role = opts.role || 'researcher';
    var template = ROLE_TEMPLATES[role] || ROLE_TEMPLATES.researcher;
    var agent = {
      id: id,
      name: opts.name || role + '-' + id.slice(0, 4),
      role: role,
      icon: template.icon,
      provider: opts.provider || null,
      systemPrompt: opts.systemPrompt || template.systemPrompt,
      status: 'idle',
      created: Date.now(),
      lastActive: null,
      taskCount: 0,
      errors: 0,
    };
    // Auto-assign provider if not specified
    if (!agent.provider && this.providerManager) {
      var best = this.providerManager.getBestProvider();
      if (best) agent.provider = best.name;
    }
    this.agents.set(id, agent);
    this._save();
    this.emit('agent-created', agent);
    return agent;
  }

  /**
   * Remove an agent
   * @param {string} id
   */
  removeAgent(id) {
    this.agents.delete(id);
    this._save();
    this.emit('agent-removed', id);
  }

  /**
   * Run a prompt through an agent
   * @param {string} id
   * @param {string} prompt
   * @returns {Promise<Object>}
   */
  async runAgent(id, prompt) {
    var agent = this.agents.get(id);
    if (!agent) throw new Error('Agent not found: ' + id);
    if (!agent.provider) throw new Error('Agent has no provider assigned');
    if (!this.providerManager) throw new Error('No provider manager');

    agent.status = 'busy';
    agent.lastActive = Date.now();
    this.emit('agent-busy', agent);

    try {
      var messages = [
        { role: 'system', content: agent.systemPrompt },
        { role: 'user', content: prompt },
      ];
      var result = await this.providerManager.callProvider(agent.provider, messages);
      agent.status = 'idle';
      agent.taskCount++;
      this._save();
      this.emit('agent-done', agent);
      return result;
    } catch (e) {
      agent.status = 'error';
      agent.errors++;
      agent.lastError = e.message;
      this._save();
      this.emit('agent-error', { agent: agent, error: e.message });
      throw e;
    }
  }

  /**
   * Test an agent's provider connection
   * @param {string} id
   * @returns {Promise<Object>}
   */
  async testAgent(id) {
    var agent = this.agents.get(id);
    if (!agent) throw new Error('Agent not found');
    if (!agent.provider) return { success: false, error: 'No provider assigned' };
    return this.providerManager.testProvider(agent.provider);
  }

  /**
   * Batch create agents
   * @param {string} role
   * @param {number} count
   * @returns {Object[]}
   */
  batchCreate(role, count) {
    var agents = [];
    for (var i = 0; i < count; i++) {
      agents.push(this.createAgent({ role: role }));
    }
    return agents;
  }

  /**
   * List all agents with status
   * @returns {Object[]}
   */
  listAgents() {
    var arr = [];
    for (const [, a] of this.agents) arr.push(a);
    return arr;
  }

  /**
   * Register API routes
   * @param {Function} addRoute - function(method, path, handler)
   */
  registerRoutes(addRoute) {
    // No-op if no addRoute — routes registered in api-server.js
  }
}

module.exports = { SwarmAgents, ROLE_TEMPLATES };
