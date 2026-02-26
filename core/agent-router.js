'use strict';

class AgentRouter {
  constructor() {
    this._agents = new Map(); // id → { capabilities: string[], load: number, maxLoad: number, registeredAt }
  }

  registerAgent(id, capabilities, opts = {}) {
    if (!id) throw new Error('Agent id required');
    this._agents.set(id, {
      id,
      capabilities: Array.isArray(capabilities) ? capabilities : [],
      load: 0,
      maxLoad: opts.maxLoad || 10,
      registeredAt: Date.now(),
    });
  }

  unregisterAgent(id) {
    return this._agents.delete(id);
  }

  route(task) {
    if (!task || typeof task !== 'object') throw new Error('Task object required');
    const required = task.capabilities || [];

    let bestId = null;
    let bestScore = -Infinity;

    for (const [id, agent] of this._agents) {
      // Skip overloaded agents
      if (agent.load >= agent.maxLoad) continue;

      // Calculate capability match score
      let capScore = 0;
      if (required.length === 0) {
        capScore = 1;
      } else {
        const matches = required.filter(c => agent.capabilities.includes(c)).length;
        if (matches < required.length) continue; // must have all required
        capScore = matches / Math.max(agent.capabilities.length, 1);
      }

      // Factor in available capacity (prefer less loaded agents)
      const availableCapacity = 1 - (agent.load / agent.maxLoad);
      const score = capScore * 0.6 + availableCapacity * 0.4;

      if (score > bestScore) {
        bestScore = score;
        bestId = id;
      }
    }

    return bestId;
  }

  getLoad() {
    const result = {};
    for (const [id, agent] of this._agents) {
      result[id] = {
        load: agent.load,
        maxLoad: agent.maxLoad,
        utilization: agent.maxLoad > 0 ? (agent.load / agent.maxLoad * 100).toFixed(0) + '%' : '0%',
        available: agent.load < agent.maxLoad,
      };
    }
    return result;
  }

  updateLoad(agentId, delta) {
    const agent = this._agents.get(agentId);
    if (!agent) throw new Error(`Agent ${agentId} not registered`);
    agent.load = Math.max(0, Math.min(agent.maxLoad, agent.load + delta));
    return agent.load;
  }

  getAgents() {
    return [...this._agents.values()].map(a => ({
      id: a.id,
      capabilities: a.capabilities,
      load: a.load,
      maxLoad: a.maxLoad,
    }));
  }
}

module.exports = { AgentRouter };
