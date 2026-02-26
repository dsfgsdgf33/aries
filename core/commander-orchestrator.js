'use strict';

const crypto = require('crypto');

class CommanderOrchestrator {
  constructor() {
    this._queue = [];
    this._assignments = new Map(); // taskId → { agentId, task, assignedAt }
    this._agents = new Map(); // agentId → { capabilities, maxLoad, currentLoad }
    this._completed = [];
    this._maxCompleted = 1000;
  }

  addTask(task) {
    if (!task || typeof task !== 'object') throw new Error('Task object required');
    const t = {
      id: task.id || crypto.randomUUID(),
      type: task.type || 'generic',
      priority: task.priority || 5,
      capabilities: task.capabilities || [],
      payload: task.payload || {},
      createdAt: Date.now(),
      status: 'queued',
    };
    this._queue.push(t);
    this._queue.sort((a, b) => a.priority - b.priority);
    return t;
  }

  registerAgent(agentId, opts = {}) {
    this._agents.set(agentId, {
      capabilities: opts.capabilities || [],
      maxLoad: opts.maxLoad || 5,
      currentLoad: 0,
      status: 'idle',
    });
  }

  assignTask(agentId) {
    const agent = this._agents.get(agentId);
    if (!agent) throw new Error(`Agent ${agentId} not registered`);
    if (agent.currentLoad >= agent.maxLoad) return null;

    // Find best matching task
    const idx = this._queue.findIndex(task => {
      if (task.capabilities.length === 0) return true;
      return task.capabilities.every(c => agent.capabilities.includes(c));
    });

    if (idx === -1) return null;

    const task = this._queue.splice(idx, 1)[0];
    task.status = 'assigned';
    this._assignments.set(task.id, {
      agentId,
      task,
      assignedAt: Date.now(),
    });
    agent.currentLoad++;
    agent.status = 'busy';

    return task;
  }

  completeTask(taskId, result) {
    const assignment = this._assignments.get(taskId);
    if (!assignment) throw new Error(`Task ${taskId} not found in assignments`);

    const agent = this._agents.get(assignment.agentId);
    if (agent) {
      agent.currentLoad = Math.max(0, agent.currentLoad - 1);
      if (agent.currentLoad === 0) agent.status = 'idle';
    }

    this._assignments.delete(taskId);
    this._completed.push({
      ...assignment,
      result,
      completedAt: Date.now(),
      duration: Date.now() - assignment.assignedAt,
    });

    if (this._completed.length > this._maxCompleted) {
      this._completed = this._completed.slice(-this._maxCompleted);
    }
  }

  getQueue() {
    return [...this._queue];
  }

  getAssignments() {
    const result = {};
    for (const [taskId, assignment] of this._assignments) {
      result[taskId] = { ...assignment };
    }
    return result;
  }

  getAgentLoad() {
    const result = {};
    for (const [id, agent] of this._agents) {
      result[id] = {
        currentLoad: agent.currentLoad,
        maxLoad: agent.maxLoad,
        utilization: (agent.currentLoad / agent.maxLoad * 100).toFixed(0) + '%',
        status: agent.status,
        capabilities: agent.capabilities,
      };
    }
    return result;
  }

  rebalance() {
    const moves = [];
    const overloaded = [];
    const underloaded = [];

    for (const [id, agent] of this._agents) {
      const util = agent.currentLoad / agent.maxLoad;
      if (util > 0.8) overloaded.push(id);
      else if (util < 0.3) underloaded.push(id);
    }

    // Move tasks from overloaded to underloaded
    for (const overId of overloaded) {
      if (underloaded.length === 0) break;
      const tasks = [...this._assignments.entries()]
        .filter(([, a]) => a.agentId === overId);
      if (tasks.length <= 1) continue;

      const [taskId, assignment] = tasks[tasks.length - 1];
      const underId = underloaded[0];
      const underAgent = this._agents.get(underId);

      if (underAgent.currentLoad < underAgent.maxLoad) {
        const overAgent = this._agents.get(overId);
        overAgent.currentLoad--;
        underAgent.currentLoad++;
        assignment.agentId = underId;
        moves.push({ taskId, from: overId, to: underId });
        if (underAgent.currentLoad / underAgent.maxLoad >= 0.3) {
          underloaded.shift();
        }
      }
    }

    return { moves, overloaded, underloaded };
  }

  getStats() {
    return {
      queued: this._queue.length,
      assigned: this._assignments.size,
      completed: this._completed.length,
      agents: this._agents.size,
    };
  }
}

module.exports = { CommanderOrchestrator };
