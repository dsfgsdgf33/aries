'use strict';

/**
 * @module scheduled-pipelines
 * @description Engine that chains Hands (autonomous agents) together into multi-step pipelines
 * with cron scheduling, conditional branching, and persistent run history.
 */

const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'pipelines.json');

class ScheduledPipelines extends EventEmitter {
  constructor() {
    super();
    this.pipelines = new Map();
    this.history = [];
    this.timers = new Map();
    this.paused = new Set();
    this._loaded = false;
  }

  async init() {
    if (this._loaded) return;
    this._loaded = true;
    await this._ensureDir();
    await this._load();
    this._startAllCrons();
  }

  async _ensureDir() {
    try { await fs.promises.mkdir(DATA_DIR, { recursive: true }); } catch {}
  }

  async _load() {
    try {
      const raw = await fs.promises.readFile(DATA_FILE, 'utf8');
      const data = JSON.parse(raw);
      if (data.pipelines) {
        for (const p of data.pipelines) this.pipelines.set(p.id, p);
      }
      if (data.history) this.history = data.history;
      if (data.paused) this.paused = new Set(data.paused);
    } catch {}
  }

  async _save() {
    const data = {
      pipelines: Array.from(this.pipelines.values()),
      history: this.history.slice(-500),
      paused: Array.from(this.paused),
    };
    await fs.promises.writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  }

  /**
   * Parse a simple cron expression (minute hour dom month dow) and return ms until next tick.
   * Supports: numbers, '*', and step syntax like '*\/5'.
   */
  _parseCronField(field, current, max) {
    if (field === '*') return true;
    if (field.includes('/')) {
      const step = parseInt(field.split('/')[1], 10);
      return current % step === 0;
    }
    const vals = field.split(',').map(Number);
    return vals.includes(current);
  }

  _cronMatches(schedule) {
    const parts = schedule.trim().split(/\s+/);
    if (parts.length < 5) return false;
    const now = new Date();
    const checks = [
      this._parseCronField(parts[0], now.getMinutes(), 59),
      this._parseCronField(parts[1], now.getHours(), 23),
      this._parseCronField(parts[2], now.getDate(), 31),
      this._parseCronField(parts[3], now.getMonth() + 1, 12),
      this._parseCronField(parts[4], now.getDay(), 6),
    ];
    return checks.every(Boolean);
  }

  _startAllCrons() {
    for (const [id, pipeline] of this.pipelines) {
      if (pipeline.trigger && pipeline.trigger.type === 'cron' && pipeline.trigger.schedule) {
        this._startCron(id);
      }
    }
  }

  _startCron(pipelineId) {
    if (this.timers.has(pipelineId)) return;
    const tick = () => {
      const pipeline = this.pipelines.get(pipelineId);
      if (!pipeline || this.paused.has(pipelineId)) return;
      if (this._cronMatches(pipeline.trigger.schedule)) {
        this.runPipeline(pipelineId, {}).catch(err => {
          this.emit('pipeline-error', { pipelineId, error: err.message });
        });
      }
    };
    const interval = setInterval(tick, 60000);
    this.timers.set(pipelineId, interval);
  }

  _stopCron(pipelineId) {
    const timer = this.timers.get(pipelineId);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(pipelineId);
    }
  }

  /**
   * Add a new pipeline definition.
   * @param {Object} def - { name, steps: [{ handId, config, condition }], trigger: { type, schedule? } }
   * @returns {Object} The created pipeline
   */
  async addPipeline(def) {
    await this.init();
    const pipeline = {
      id: crypto.randomUUID(),
      name: def.name || 'Unnamed Pipeline',
      steps: def.steps || [],
      trigger: def.trigger || { type: 'manual' },
      createdAt: new Date().toISOString(),
    };
    this.pipelines.set(pipeline.id, pipeline);
    if (pipeline.trigger.type === 'cron' && pipeline.trigger.schedule) {
      this._startCron(pipeline.id);
    }
    await this._save();
    return pipeline;
  }

  async removePipeline(id) {
    await this.init();
    this._stopCron(id);
    this.paused.delete(id);
    const deleted = this.pipelines.delete(id);
    await this._save();
    return deleted;
  }

  async listPipelines() {
    await this.init();
    return Array.from(this.pipelines.values());
  }

  /**
   * Execute a pipeline. Each step's output feeds into the next step's input.
   * @param {string} pipelineId
   * @param {*} initialInput
   * @param {Function} [handExecutor] - async (handId, config, input) => output. If not provided, attempts to require hands.js.
   */
  async runPipeline(pipelineId, initialInput, handExecutor) {
    await this.init();
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) throw new Error(`Pipeline not found: ${pipelineId}`);
    if (this.paused.has(pipelineId)) throw new Error(`Pipeline is paused: ${pipelineId}`);

    const runId = crypto.randomUUID();
    const run = {
      runId,
      pipelineId,
      pipelineName: pipeline.name,
      startedAt: new Date().toISOString(),
      steps: [],
      status: 'running',
    };

    this.emit('pipeline-start', { pipelineId, runId, name: pipeline.name });

    let executor = handExecutor;
    if (!executor) {
      try {
        const hands = require('./hands.js');
        const handsInstance = typeof hands.getInstance === 'function' ? hands.getInstance() : hands;
        executor = async (handId, config, input) => {
          if (typeof handsInstance.execute === 'function') return handsInstance.execute(handId, { ...config, input });
          if (typeof handsInstance.run === 'function') return handsInstance.run(handId, { ...config, input });
          throw new Error('hands.js has no execute/run method');
        };
      } catch {
        executor = async (handId, config, input) => ({ handId, config, input, result: 'no-executor' });
      }
    }

    let currentInput = initialInput;
    try {
      for (let i = 0; i < pipeline.steps.length; i++) {
        const step = pipeline.steps[i];

        // Conditional branching
        if (step.condition) {
          try {
            const condFn = new Function('input', 'stepIndex', `return (${step.condition})`);
            const shouldRun = condFn(currentInput, i);
            if (!shouldRun) {
              run.steps.push({ index: i, handId: step.handId, skipped: true });
              this.emit('pipeline-step', { pipelineId, runId, step: i, skipped: true });
              continue;
            }
          } catch (condErr) {
            run.steps.push({ index: i, handId: step.handId, skipped: false, conditionError: condErr.message });
          }
        }

        const stepStart = Date.now();
        const output = await executor(step.handId, step.config || {}, currentInput);
        const stepRecord = {
          index: i,
          handId: step.handId,
          skipped: false,
          durationMs: Date.now() - stepStart,
          outputSummary: typeof output === 'string' ? output.slice(0, 200) : JSON.stringify(output).slice(0, 200),
        };
        run.steps.push(stepRecord);
        this.emit('pipeline-step', { pipelineId, runId, step: i, handId: step.handId, output });
        currentInput = output;
      }

      run.status = 'completed';
      run.completedAt = new Date().toISOString();
      run.finalOutput = typeof currentInput === 'string' ? currentInput.slice(0, 1000) : JSON.stringify(currentInput).slice(0, 1000);
      this.emit('pipeline-complete', { pipelineId, runId, output: currentInput });
    } catch (err) {
      run.status = 'error';
      run.error = err.message;
      run.completedAt = new Date().toISOString();
      this.emit('pipeline-error', { pipelineId, runId, error: err.message });
    }

    this.history.push(run);
    await this._save();
    return run;
  }

  async getPipelineHistory(pipelineId) {
    await this.init();
    if (pipelineId) return this.history.filter(r => r.pipelineId === pipelineId);
    return this.history;
  }

  async pausePipeline(id) {
    await this.init();
    if (!this.pipelines.has(id)) throw new Error(`Pipeline not found: ${id}`);
    this.paused.add(id);
    await this._save();
  }

  async resumePipeline(id) {
    await this.init();
    if (!this.pipelines.has(id)) throw new Error(`Pipeline not found: ${id}`);
    this.paused.delete(id);
    await this._save();
  }

  shutdown() {
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
  }
}

let _instance = null;
function getInstance() {
  if (!_instance) _instance = new ScheduledPipelines();
  return _instance;
}

module.exports = { ScheduledPipelines, getInstance };
