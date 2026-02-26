'use strict';

const crypto = require('crypto');

class SwarmActivator {
  constructor(opts = {}) {
    this._agents = new Map(); // agentId → { status, lastActive, capabilities, taskCount }
    this._idleThreshold = opts.idleThreshold || 60000; // 1 minute
    this._generatedTasks = [];
    this._activationLog = [];
    this._maxLog = 500;
    this._taskTemplates = [
      { type: 'health_check', description: 'Run system health check', capabilities: ['diagnostics'], priority: 8 },
      { type: 'cache_cleanup', description: 'Clear expired cache entries', capabilities: ['cache'], priority: 9 },
      { type: 'log_rotation', description: 'Rotate and compress old logs', capabilities: ['filesystem'], priority: 9 },
      { type: 'metrics_snapshot', description: 'Capture performance metrics snapshot', capabilities: ['monitoring'], priority: 7 },
      { type: 'self_test', description: 'Run self-diagnostic tests', capabilities: ['diagnostics'], priority: 10 },
      { type: 'memory_report', description: 'Generate memory usage report', capabilities: ['monitoring'], priority: 8 },
    ];
  }

  registerAgent(agentId, opts = {}) {
    this._agents.set(agentId, {
      id: agentId,
      status: opts.status || 'idle',
      lastActive: opts.lastActive || Date.now(),
      capabilities: opts.capabilities || [],
      taskCount: 0,
    });
  }

  updateAgentStatus(agentId, status) {
    const agent = this._agents.get(agentId);
    if (!agent) throw new Error(`Agent ${agentId} not registered`);
    agent.status = status;
    if (status === 'busy') agent.lastActive = Date.now();
  }

  getIdleAgents() {
    const now = Date.now();
    const idle = [];
    for (const [id, agent] of this._agents) {
      if (agent.status === 'idle' || (now - agent.lastActive > this._idleThreshold)) {
        idle.push({ ...agent });
      }
    }
    return idle;
  }

  generateTasks() {
    const idle = this.getIdleAgents();
    if (idle.length === 0) return [];

    const tasks = [];
    for (const agent of idle) {
      // Find a matching task template
      const matching = this._taskTemplates.filter(t =>
        t.capabilities.length === 0 ||
        t.capabilities.some(c => agent.capabilities.includes(c))
      );

      const template = matching.length > 0
        ? matching[Math.floor(Math.random() * matching.length)]
        : this._taskTemplates[0]; // fallback to health check

      const task = {
        id: crypto.randomUUID(),
        type: template.type,
        description: template.description,
        capabilities: template.capabilities,
        priority: template.priority,
        targetAgent: agent.id,
        generatedAt: Date.now(),
        source: 'swarm-activator',
      };
      tasks.push(task);
    }

    this._generatedTasks.push(...tasks);
    return tasks;
  }

  activate() {
    const tasks = this.generateTasks();
    const results = [];

    for (const task of tasks) {
      const agent = this._agents.get(task.targetAgent);
      if (agent) {
        agent.status = 'busy';
        agent.lastActive = Date.now();
        agent.taskCount++;
        results.push({
          agentId: task.targetAgent,
          task: task,
          activated: true,
        });
      }
    }

    this._activationLog.push({
      timestamp: Date.now(),
      agentsActivated: results.length,
      tasks: results.map(r => r.task.id),
    });

    if (this._activationLog.length > this._maxLog) {
      this._activationLog = this._activationLog.slice(-this._maxLog);
    }

    return {
      activated: results.length,
      tasks: results,
    };
  }

  getStatus() {
    const agents = [...this._agents.values()];
    const idle = agents.filter(a => a.status === 'idle').length;
    const busy = agents.filter(a => a.status === 'busy').length;

    return {
      totalAgents: agents.length,
      idle,
      busy,
      totalTasksGenerated: this._generatedTasks.length,
      totalActivations: this._activationLog.length,
      recentActivations: this._activationLog.slice(-5),
    };
  }

  addTaskTemplate(template) {
    if (!template || !template.type) throw new Error('Template with type required');
    this._taskTemplates.push({
      type: template.type,
      description: template.description || template.type,
      capabilities: template.capabilities || [],
      priority: template.priority || 5,
    });
  }
}

module.exports = { SwarmActivator };
