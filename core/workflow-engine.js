/**
 * ARIES v5.0 — Event-Driven Workflow Automation Engine
 * 
 * Trigger agent workflows on events (like IFTTT but with AI).
 * Supports triggers: cron, webhook, file change, manual.
 * Conditions filter events. Actions dispatch to agents.
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_FILE = path.join(__dirname, '..', 'data', 'workflows.json');

function _ensureDir() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function _loadAll() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { return []; }
}

function _saveAll(workflows) {
  _ensureDir();
  fs.writeFileSync(DATA_FILE, JSON.stringify(workflows, null, 2));
}

class WorkflowEngine extends EventEmitter {
  /**
   * @param {object} [context] - Context with ai, swarm refs
   */
  constructor(context = {}) {
    super();
    this.ai = context.ai || null;
    this.swarm = context.swarm || null;
    this.workflows = _loadAll();
    this.running = false;
    this._cronTimers = new Map();
    this._fileWatchers = new Map();
    this._executionLog = [];
    this.maxWorkflows = 50;
    try {
      const cfg = require('../config.json');
      this.maxWorkflows = cfg.workflows?.maxWorkflows || 50;
    } catch {}
  }

  /**
   * Add a new workflow
   * @param {object} def - Workflow definition
   * @param {string} def.name - Workflow name
   * @param {object} def.trigger - Trigger config { type: 'cron'|'webhook'|'fileChange'|'event', ... }
   * @param {object[]} [def.conditions] - Conditions array [{ field, op, value }]
   * @param {object[]} def.actions - Actions array [{ type: 'chat'|'swarm'|'agent', ... }]
   * @returns {object} Created workflow
   */
  addWorkflow(def) {
    if (this.workflows.length >= this.maxWorkflows) {
      throw new Error(`Max workflows reached (${this.maxWorkflows})`);
    }

    const workflow = {
      id: crypto.randomUUID?.() || crypto.randomBytes(8).toString('hex'),
      name: def.name || 'Unnamed Workflow',
      description: def.description || '',
      trigger: def.trigger || { type: 'manual' },
      conditions: def.conditions || [],
      actions: def.actions || [],
      enabled: def.enabled !== false,
      created: new Date().toISOString(),
      lastTriggered: null,
      triggerCount: 0,
    };

    this.workflows.push(workflow);
    _saveAll(this.workflows);

    if (this.running && workflow.enabled) {
      this._setupTrigger(workflow);
    }

    this.emit('workflow-added', workflow);
    return workflow;
  }

  /**
   * Update an existing workflow
   * @param {string} id
   * @param {object} updates
   * @returns {object|null}
   */
  updateWorkflow(id, updates) {
    const idx = this.workflows.findIndex(w => w.id === id);
    if (idx < 0) return null;

    // Teardown old trigger
    this._teardownTrigger(this.workflows[idx]);

    Object.assign(this.workflows[idx], updates);
    _saveAll(this.workflows);

    // Setup new trigger if running
    if (this.running && this.workflows[idx].enabled) {
      this._setupTrigger(this.workflows[idx]);
    }

    return this.workflows[idx];
  }

  /**
   * Delete a workflow
   * @param {string} id
   * @returns {boolean}
   */
  deleteWorkflow(id) {
    const idx = this.workflows.findIndex(w => w.id === id);
    if (idx < 0) return false;
    this._teardownTrigger(this.workflows[idx]);
    this.workflows.splice(idx, 1);
    _saveAll(this.workflows);
    return true;
  }

  /**
   * Get all workflows
   * @returns {object[]}
   */
  listWorkflows() {
    return this.workflows;
  }

  /**
   * Start the workflow engine — set up all triggers
   */
  start() {
    if (this.running) return;
    this.running = true;
    for (const wf of this.workflows) {
      if (wf.enabled) {
        try { this._setupTrigger(wf); } catch (err) {
          this.emit('error', { workflowId: wf.id, error: err.message });
        }
      }
    }
    this.emit('started');
  }

  /**
   * Stop the workflow engine
   */
  stop() {
    this.running = false;
    for (const wf of this.workflows) {
      this._teardownTrigger(wf);
    }
    this.emit('stopped');
  }

  /**
   * Manually trigger a workflow event
   * @param {string} eventType - Event type to match against workflow triggers
   * @param {object} [data] - Event data
   */
  async trigger(eventType, data = {}) {
    const matching = this.workflows.filter(wf =>
      wf.enabled &&
      (wf.trigger.type === eventType || wf.trigger.eventName === eventType)
    );

    for (const wf of matching) {
      try {
        await this._executeWorkflow(wf, data);
      } catch (err) {
        this.emit('error', { workflowId: wf.id, error: err.message });
      }
    }
  }

  /**
   * Get execution log
   * @param {number} [limit=50]
   * @returns {object[]}
   */
  getLog(limit = 50) {
    return this._executionLog.slice(-limit);
  }

  // ── Private ──

  _setupTrigger(wf) {
    const trigger = wf.trigger;

    if (trigger.type === 'cron' && trigger.intervalMs) {
      const timer = setInterval(() => {
        this._executeWorkflow(wf, { triggered: 'cron' }).catch(() => {});
      }, trigger.intervalMs);
      this._cronTimers.set(wf.id, timer);
    }

    if (trigger.type === 'fileChange' && trigger.path) {
      try {
        const watcher = fs.watch(trigger.path, (eventType, filename) => {
          this._executeWorkflow(wf, { eventType, filename }).catch(() => {});
        });
        this._fileWatchers.set(wf.id, watcher);
      } catch {}
    }
  }

  _teardownTrigger(wf) {
    const timer = this._cronTimers.get(wf.id);
    if (timer) { clearInterval(timer); this._cronTimers.delete(wf.id); }
    const watcher = this._fileWatchers.get(wf.id);
    if (watcher) { watcher.close(); this._fileWatchers.delete(wf.id); }
  }

  _checkConditions(conditions, data) {
    if (!conditions || conditions.length === 0) return true;
    return conditions.every(cond => {
      const val = data[cond.field];
      switch (cond.op) {
        case 'eq': return val === cond.value;
        case 'neq': return val !== cond.value;
        case 'contains': return String(val).includes(cond.value);
        case 'gt': return Number(val) > Number(cond.value);
        case 'lt': return Number(val) < Number(cond.value);
        case 'exists': return val !== undefined && val !== null;
        default: return true;
      }
    });
  }

  async _executeWorkflow(wf, data) {
    if (!this._checkConditions(wf.conditions, data)) return;

    wf.lastTriggered = new Date().toISOString();
    wf.triggerCount++;
    _saveAll(this.workflows);

    const logEntry = {
      workflowId: wf.id,
      workflowName: wf.name,
      timestamp: wf.lastTriggered,
      data,
      results: [],
    };

    this.emit('workflow-triggered', { id: wf.id, name: wf.name, data });

    for (const action of wf.actions) {
      try {
        const result = await this._executeAction(action, data);
        logEntry.results.push({ action: action.type, success: true, result });
      } catch (err) {
        logEntry.results.push({ action: action.type, success: false, error: err.message });
      }
    }

    this._executionLog.push(logEntry);
    if (this._executionLog.length > 200) this._executionLog.shift();

    this.emit('workflow-complete', logEntry);
    return logEntry;
  }

  async _executeAction(action, data) {
    const prompt = (action.prompt || '').replace(/\{\{(\w+)\}\}/g, (_, k) => data[k] || '');

    switch (action.type) {
      case 'chat':
        if (!this.ai) throw new Error('AI not available');
        const result = await this.ai.chat([{ role: 'user', content: prompt || JSON.stringify(data) }]);
        return result.response;

      case 'swarm':
        if (!this.swarm) throw new Error('Swarm not available');
        return await this.swarm.execute(prompt || JSON.stringify(data));

      case 'log':
        const msg = prompt || `Workflow event: ${JSON.stringify(data)}`;
        this.emit('log', msg);
        return msg;

      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }
  }
}

module.exports = { WorkflowEngine };
