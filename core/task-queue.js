/**
 * ARIES v3.0 — Task Queue
 * 
 * Priority queue for tasks. Priorities: low, normal, high, critical.
 * Provides queue visualization and management.
 */

const EventEmitter = require('events');

const PRIORITY_VALUES = { critical: 4, high: 3, normal: 2, low: 1 };

class TaskQueue extends EventEmitter {
  constructor() {
    super();
    this.queue = [];
    this.processing = [];
    this.completed = [];
    this.idCounter = 0;
  }

  /**
   * Add a task to the queue.
   * @param {string} description - Task description
   * @param {string} priority - low|normal|high|critical
   * @param {object} meta - Additional metadata
   * @returns {object} The queued task
   */
  add(description, priority = 'normal', meta = {}) {
    const task = {
      id: ++this.idCounter,
      description,
      priority: PRIORITY_VALUES[priority] ? priority : 'normal',
      priorityValue: PRIORITY_VALUES[priority] || 2,
      status: 'queued',
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
      result: null,
      meta
    };
    this.queue.push(task);
    this._sort();
    this.emit('added', task);
    return task;
  }

  /** Sort queue by priority (highest first), then by creation time */
  _sort() {
    this.queue.sort((a, b) => {
      if (b.priorityValue !== a.priorityValue) return b.priorityValue - a.priorityValue;
      return a.createdAt - b.createdAt;
    });
  }

  /** Get the next task from the queue (highest priority) */
  next() {
    if (this.queue.length === 0) return null;
    const task = this.queue.shift();
    task.status = 'processing';
    task.startedAt = Date.now();
    this.processing.push(task);
    this.emit('started', task);
    return task;
  }

  /** Mark a task as complete */
  complete(taskId, result = '') {
    const idx = this.processing.findIndex(t => t.id === taskId);
    if (idx === -1) return null;
    const task = this.processing.splice(idx, 1)[0];
    task.status = 'complete';
    task.completedAt = Date.now();
    task.result = result;
    this.completed.push(task);
    // Keep only last 50 completed
    if (this.completed.length > 50) this.completed.shift();
    this.emit('completed', task);
    return task;
  }

  /** Mark a task as failed */
  fail(taskId, error = '') {
    const idx = this.processing.findIndex(t => t.id === taskId);
    if (idx === -1) return null;
    const task = this.processing.splice(idx, 1)[0];
    task.status = 'failed';
    task.completedAt = Date.now();
    task.result = error;
    this.completed.push(task);
    this.emit('failed', task);
    return task;
  }

  /** Remove a queued task by ID */
  remove(taskId) {
    const idx = this.queue.findIndex(t => t.id === taskId);
    if (idx === -1) return null;
    const task = this.queue.splice(idx, 1)[0];
    this.emit('removed', task);
    return task;
  }

  /** Get queue status for display */
  status() {
    return {
      queued: this.queue.length,
      processing: this.processing.length,
      completed: this.completed.length,
      tasks: this.queue.map(t => ({
        id: t.id,
        description: t.description.substring(0, 60),
        priority: t.priority,
        age: Math.round((Date.now() - t.createdAt) / 1000) + 's'
      }))
    };
  }

  /** Get formatted queue visualization */
  visualize() {
    const lines = [];
    if (this.processing.length > 0) {
      lines.push('{yellow-fg}▸ Processing:{/}');
      this.processing.forEach(t => {
        const elapsed = ((Date.now() - t.startedAt) / 1000).toFixed(1);
        lines.push(`  {yellow-fg}⟳{/} [${t.id}] ${t.description.substring(0, 50)} (${elapsed}s)`);
      });
    }
    if (this.queue.length > 0) {
      lines.push('{cyan-fg}▸ Queued:{/}');
      this.queue.slice(0, 10).forEach(t => {
        const pColor = { critical: 'red', high: 'yellow', normal: 'white', low: 'gray' }[t.priority];
        lines.push(`  {${pColor}-fg}●{/} [${t.id}] ${t.description.substring(0, 50)} {dim}(${t.priority}){/}`);
      });
      if (this.queue.length > 10) lines.push(`  {dim}... +${this.queue.length - 10} more{/}`);
    }
    if (lines.length === 0) lines.push('{dim}Queue empty.{/}');
    return lines;
  }
}

module.exports = TaskQueue;
