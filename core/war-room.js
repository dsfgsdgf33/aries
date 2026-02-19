/**
 * ARIES v5.0 — Real-Time Streaming War Room
 * 
 * WebSocket-powered real-time view of all agent activity.
 * Circular buffer for events, live metrics, agent status board.
 */

const EventEmitter = require('events');

class WarRoom extends EventEmitter {
  /**
   * @param {object} opts
   * @param {object} opts.config - warRoom config section
   * @param {Function} opts.wsBroadcast - WebSocket broadcast function
   */
  constructor(opts = {}) {
    super();
    this.config = opts.config || {};
    this.wsBroadcast = opts.wsBroadcast || (() => {});
    this.maxEvents = this.config.maxEvents || 500;

    /** @type {object[]} Circular buffer */
    this._events = [];
    this._eventIndex = 0;

    /** @type {Map<string, object>} Active task tracking */
    this._activeTasks = new Map();

    /** @type {Map<string, string>} Agent status: agentId -> status */
    this._agentStatus = new Map();

    // Metrics
    this._metrics = {
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      tokensUsed: 0,
      costEstimate: 0,
      startTime: Date.now(),
      throughput: [], // timestamps of completions for rate calc
    };
  }

  /**
   * Track a task being executed by an agent
   * @param {string} taskId
   * @param {string} agentId
   * @param {object} [meta] - Additional metadata
   */
  trackTask(taskId, agentId, meta = {}) {
    const entry = {
      taskId,
      agentId,
      status: 'running',
      startTime: Date.now(),
      meta,
    };
    this._activeTasks.set(taskId, entry);
    this._agentStatus.set(agentId, 'busy');
    this._metrics.totalTasks++;

    this._pushEvent({
      type: 'task-start',
      taskId,
      agentId,
      agentName: meta.agentName || agentId,
      agentIcon: meta.agentIcon || '🤖',
      description: meta.description || taskId,
      timestamp: Date.now(),
    });
  }

  /**
   * Mark a task as complete
   * @param {string} taskId
   * @param {object} [result]
   */
  completeTask(taskId, result = {}) {
    const task = this._activeTasks.get(taskId);
    if (task) {
      task.status = 'complete';
      task.elapsed = Date.now() - task.startTime;
      this._agentStatus.set(task.agentId, 'idle');
      this._activeTasks.delete(taskId);
      this._metrics.completedTasks++;
      this._metrics.throughput.push(Date.now());

      if (result.tokens) {
        this._metrics.tokensUsed += result.tokens;
        this._metrics.costEstimate = this._metrics.tokensUsed * 0.000003; // rough estimate
      }

      this._pushEvent({
        type: 'task-complete',
        taskId,
        agentId: task.agentId,
        agentName: task.meta.agentName || task.agentId,
        agentIcon: task.meta.agentIcon || '🤖',
        elapsed: task.elapsed,
        tokens: result.tokens || 0,
        preview: (result.text || '').substring(0, 200),
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Mark a task as failed
   * @param {string} taskId
   * @param {string} error
   */
  failTask(taskId, error) {
    const task = this._activeTasks.get(taskId);
    if (task) {
      this._agentStatus.set(task.agentId, 'error');
      this._activeTasks.delete(taskId);
      this._metrics.failedTasks++;

      this._pushEvent({
        type: 'task-failed',
        taskId,
        agentId: task.agentId,
        agentName: task.meta.agentName || task.agentId,
        agentIcon: task.meta.agentIcon || '🤖',
        error,
        timestamp: Date.now(),
      });

      // Reset to idle after a delay
      setTimeout(() => {
        if (this._agentStatus.get(task.agentId) === 'error') {
          this._agentStatus.set(task.agentId, 'idle');
        }
      }, 5000);
    }
  }

  /**
   * Broadcast an arbitrary event
   * @param {object} event
   */
  broadcast(event) {
    const entry = {
      ...event,
      timestamp: event.timestamp || Date.now(),
    };
    this._pushEvent(entry);
  }

  /**
   * Log agent thinking/action
   * @param {string} agentId
   * @param {string} action - thinking | tool-call | tool-result | message
   * @param {string} content
   */
  logActivity(agentId, action, content, meta = {}) {
    this._pushEvent({
      type: 'activity',
      agentId,
      agentName: meta.agentName || agentId,
      agentIcon: meta.agentIcon || '🤖',
      action,
      content: (content || '').substring(0, 500),
      timestamp: Date.now(),
    });
  }

  /**
   * Get the activity feed
   * @param {number} [limit=50]
   * @returns {object[]}
   */
  getActivityFeed(limit = 50) {
    return this._events.slice(-limit);
  }

  /**
   * Get live metrics
   * @returns {object}
   */
  getMetrics() {
    // Calculate throughput (tasks per minute over last 5 min)
    const fiveMinAgo = Date.now() - 300000;
    const recentCompletions = this._metrics.throughput.filter(t => t > fiveMinAgo);
    const throughputPerMin = recentCompletions.length > 0
      ? (recentCompletions.length / 5).toFixed(1)
      : 0;

    return {
      totalTasks: this._metrics.totalTasks,
      completedTasks: this._metrics.completedTasks,
      failedTasks: this._metrics.failedTasks,
      activeTasks: this._activeTasks.size,
      tokensUsed: this._metrics.tokensUsed,
      costEstimate: parseFloat(this._metrics.costEstimate.toFixed(4)),
      throughputPerMin: parseFloat(throughputPerMin),
      uptime: Math.floor((Date.now() - this._metrics.startTime) / 1000),
      agentStatus: Object.fromEntries(this._agentStatus),
      activeTaskDetails: [...this._activeTasks.values()].map(t => ({
        taskId: t.taskId,
        agentId: t.agentId,
        elapsed: Date.now() - t.startTime,
        description: t.meta.description || t.taskId,
      })),
    };
  }

  // ── Internal ──

  _pushEvent(event) {
    this._events.push(event);
    // Trim circular buffer
    if (this._events.length > this.maxEvents) {
      this._events = this._events.slice(-this.maxEvents);
    }
    // Broadcast via WebSocket
    try {
      this.wsBroadcast({ type: 'warroom', ...event });
    } catch {}
    this.emit('event', event);
  }
}

module.exports = { WarRoom };
