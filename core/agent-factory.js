/**
 * ARIES v5.0 — Dynamic Agent Creation Factory
 * 
 * Creates new specialist agents from natural language descriptions.
 * Integrates with AgentRoster for swarm availability.
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_FILE = path.join(__dirname, '..', 'data', 'custom-agents.json');

const ICONS = ['🤖', '🧬', '🔮', '💎', '🌟', '🚀', '🎯', '⚗️', '🧪', '🏆', '🌐', '🎲', '🔬', '🧲', '💡', '🦾', '🛸', '🎭', '🏴‍☠️', '🧊'];
const COLORS = ['cyan', 'magenta', 'green', 'yellow', 'blue', 'red', 'white'];

class AgentFactory extends EventEmitter {
  /**
   * @param {object} opts
   * @param {object} opts.ai - AI core module
   * @param {object} opts.roster - AgentRoster instance (optional, for integration)
   * @param {object} opts.config - agentFactory config section
   */
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null;
    this.roster = opts.roster || null;
    this.config = opts.config || {};
    this.maxCustomAgents = this.config.maxCustomAgents || 20;
    this._agents = this._load();
    this._registerAll();
  }

  _load() {
    try {
      if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch {}
    return [];
  }

  _save() {
    try {
      const dir = path.dirname(DATA_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(this._agents, null, 2));
    } catch {}
  }

  _registerAll() {
    if (!this.roster) return;
    for (const agent of this._agents) {
      this._registerWithRoster(agent);
    }
  }

  _registerWithRoster(agent) {
    if (!this.roster) return;
    if (this.roster.agents.has(agent.id)) return;
    this.roster.agents.set(agent.id, {
      ...agent,
      status: 'idle',
      currentTask: null,
      tasksCompleted: 0,
      lastActive: null,
    });
  }

  /**
   * Create a new agent from natural language description
   * @param {string} description - e.g. "An agent that specializes in cryptocurrency analysis"
   * @returns {object} Generated agent definition
   */
  async createAgent(description) {
    if (this._agents.length >= this.maxCustomAgents) {
      throw new Error(`Max custom agents (${this.maxCustomAgents}) reached`);
    }

    if (!this.ai) throw new Error('AI module required for agent creation');

    const messages = [
      {
        role: 'system',
        content: `Generate a specialist AI agent definition from the description. Return ONLY a JSON object:
{
  "name": "AgentName",
  "role": "one-word-role",
  "systemPrompt": "Detailed system prompt for the agent (2-4 paragraphs)",
  "specialties": ["keyword1", "keyword2", ...],
  "toolAccess": ["read", "web", "shell", "write", "edit", "search"]
}

Rules:
- Name should be catchy, 1-2 words
- Role should be a single descriptive word
- System prompt should be detailed and specific
- Specialties should be 5-15 keywords for task matching
- Tool access should be appropriate for the role (subset of: read, write, edit, shell, web, search, download, sysinfo, process, ls, append)`
      },
      { role: 'user', content: description }
    ];

    const data = await this.ai.callWithFallback(messages, null);
    const content = data.choices?.[0]?.message?.content || '{}';
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Failed to generate agent definition');

    const def = JSON.parse(match[0]);
    const id = 'custom_' + (def.name || 'agent').toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + crypto.randomBytes(3).toString('hex');

    const agent = {
      id,
      name: def.name || 'Custom Agent',
      role: def.role || 'specialist',
      icon: ICONS[Math.floor(Math.random() * ICONS.length)],
      systemPrompt: def.systemPrompt || `You are ${def.name}, a specialist AI agent.`,
      specialties: Array.isArray(def.specialties) ? def.specialties : [def.role],
      toolAccess: Array.isArray(def.toolAccess) ? def.toolAccess : ['read', 'web'],
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      custom: true,
      createdAt: Date.now(),
      createdFrom: description,
    };

    this._agents.push(agent);
    this._save();
    this._registerWithRoster(agent);
    this.emit('agent-created', agent);

    return agent;
  }

  /**
   * Clone and modify an existing agent
   * @param {string} agentId - Source agent ID
   * @param {object} modifications - { name, systemPrompt, specialties, etc. }
   * @returns {object} New agent
   */
  cloneAgent(agentId, modifications = {}) {
    if (this._agents.length >= this.maxCustomAgents) {
      throw new Error(`Max custom agents (${this.maxCustomAgents}) reached`);
    }

    // Find source in roster or custom agents
    let source = null;
    if (this.roster) source = this.roster.get(agentId);
    if (!source) source = this._agents.find(a => a.id === agentId);
    if (!source) throw new Error(`Agent ${agentId} not found`);

    const id = 'custom_' + (modifications.name || source.name).toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + crypto.randomBytes(3).toString('hex');

    const agent = {
      id,
      name: modifications.name || source.name + ' (Clone)',
      role: modifications.role || source.role,
      icon: modifications.icon || ICONS[Math.floor(Math.random() * ICONS.length)],
      systemPrompt: modifications.systemPrompt || source.systemPrompt,
      specialties: modifications.specialties || [...(source.specialties || [])],
      toolAccess: modifications.toolAccess || source.toolAccess || ['read', 'web'],
      color: modifications.color || source.color,
      custom: true,
      clonedFrom: agentId,
      createdAt: Date.now(),
    };

    this._agents.push(agent);
    this._save();
    this._registerWithRoster(agent);
    this.emit('agent-created', agent);

    return agent;
  }

  /**
   * List all custom agents
   */
  listCustomAgents() {
    return this._agents.map(a => ({
      id: a.id,
      name: a.name,
      role: a.role,
      icon: a.icon,
      specialties: a.specialties,
      color: a.color,
      createdAt: a.createdAt,
      createdFrom: a.createdFrom || null,
      clonedFrom: a.clonedFrom || null,
    }));
  }

  /**
   * Delete a custom agent
   * @param {string} agentId
   */
  deleteAgent(agentId) {
    const idx = this._agents.findIndex(a => a.id === agentId);
    if (idx === -1) throw new Error(`Custom agent ${agentId} not found`);
    this._agents.splice(idx, 1);
    this._save();
    if (this.roster) this.roster.agents.delete(agentId);
    this.emit('agent-deleted', agentId);
    return { deleted: agentId };
  }
}

module.exports = { AgentFactory };
