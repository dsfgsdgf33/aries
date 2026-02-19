/**
 * ARIES v5.0 — Agent Pipeline System
 * 
 * Chain agents in sequence (DAG-style). A pipeline is an array of steps
 * where each step specifies an agent, and the output feeds into the next.
 * Supports parallel branches that merge.
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_FILE = path.join(__dirname, '..', 'data', 'pipelines.json');

function _ensureDir() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function _loadAll() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { return []; }
}

function _saveAll(pipelines) {
  _ensureDir();
  fs.writeFileSync(DATA_FILE, JSON.stringify(pipelines, null, 2));
}

/**
 * Pipeline step definition
 * @typedef {Object} PipelineStep
 * @property {string} id - Unique step ID
 * @property {string} agent - Agent role (e.g. 'researcher', 'coder')
 * @property {string} [prompt] - Custom prompt template. Use {{input}} for previous output.
 * @property {string[]} [dependsOn] - Step IDs this step depends on (for parallel branches)
 * @property {object} [config] - Additional config for the step
 */

class Pipeline extends EventEmitter {
  /**
   * @param {string} [name] - Pipeline name
   * @param {string} [description] - Pipeline description
   */
  constructor(name, description) {
    super();
    this.id = crypto.randomUUID?.() || crypto.randomBytes(8).toString('hex');
    this.name = name || 'Unnamed Pipeline';
    this.description = description || '';
    this.steps = [];
    this.created = new Date().toISOString();
    this.lastRun = null;
    this.runCount = 0;
  }

  /**
   * Add a step to the pipeline
   * @param {string} agent - Agent role
   * @param {object} [config] - Step configuration
   * @returns {Pipeline} this (for chaining)
   */
  addStep(agent, config = {}) {
    const step = {
      id: config.id || `step-${this.steps.length + 1}`,
      agent,
      prompt: config.prompt || null,
      dependsOn: config.dependsOn || [],
      config: config.config || {},
    };

    // Validate max steps
    let maxSteps = 20;
    try {
      const cfg = require('../config.json');
      maxSteps = cfg.pipelines?.maxSteps || 20;
    } catch {}

    if (this.steps.length >= maxSteps) {
      throw new Error(`Pipeline exceeds max steps (${maxSteps})`);
    }

    this.steps.push(step);
    return this;
  }

  /**
   * Execute the pipeline
   * @param {string} input - Initial input
   * @param {object} [context] - Execution context with ai, swarm refs
   * @returns {Promise<{ output: string, stepResults: object[] }>}
   */
  async run(input, context = {}) {
    if (this.steps.length === 0) throw new Error('Pipeline has no steps');

    const ai = context.ai;
    if (!ai) throw new Error('AI core required to run pipeline');

    this.emit('start', { pipelineId: this.id, input });
    const stepResults = {};
    const completed = new Set();

    // Build dependency graph
    const getReady = () => this.steps.filter(s =>
      !completed.has(s.id) &&
      s.dependsOn.every(dep => completed.has(dep))
    );

    while (completed.size < this.steps.length) {
      const ready = getReady();
      if (ready.length === 0 && completed.size < this.steps.length) {
        throw new Error('Pipeline deadlock: circular dependencies detected');
      }

      // Execute ready steps in parallel
      const results = await Promise.allSettled(ready.map(async (step) => {
        // Resolve input for this step
        let stepInput;
        if (step.dependsOn.length > 0) {
          // Merge outputs from dependencies
          stepInput = step.dependsOn.map(dep => stepResults[dep]?.output || '').join('\n\n---\n\n');
        } else {
          stepInput = input;
        }

        // Build prompt
        const prompt = step.prompt
          ? step.prompt.replace(/\{\{input\}\}/g, stepInput)
          : `You are the ${step.agent} agent. Process this input and provide your output:\n\n${stepInput}`;

        this.emit('step-start', { stepId: step.id, agent: step.agent });

        try {
          const result = await ai.chat([
            { role: 'user', content: prompt }
          ]);
          const output = result.response || '';
          stepResults[step.id] = { output, agent: step.agent, success: true };
          this.emit('step-complete', { stepId: step.id, agent: step.agent, output });
          return { stepId: step.id, output };
        } catch (err) {
          stepResults[step.id] = { output: `Error: ${err.message}`, agent: step.agent, success: false };
          this.emit('step-error', { stepId: step.id, agent: step.agent, error: err.message });
          return { stepId: step.id, error: err.message };
        }
      }));

      for (const r of results) {
        if (r.status === 'fulfilled') completed.add(r.value.stepId);
        else {
          // Mark as completed even on failure to avoid deadlock
          const failedStep = ready.find(s => !completed.has(s.id));
          if (failedStep) completed.add(failedStep.id);
        }
      }
    }

    // Final output = last step's output (or merge of terminal nodes)
    const terminalSteps = this.steps.filter(s =>
      !this.steps.some(other => other.dependsOn.includes(s.id))
    );
    const finalOutput = terminalSteps.map(s => stepResults[s.id]?.output || '').join('\n\n');

    this.lastRun = new Date().toISOString();
    this.runCount++;
    this.emit('complete', { pipelineId: this.id, output: finalOutput });

    return {
      output: finalOutput,
      stepResults: Object.entries(stepResults).map(([id, r]) => ({ id, ...r })),
    };
  }

  /**
   * Serialize pipeline to JSON
   * @returns {object}
   */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      steps: this.steps,
      created: this.created,
      lastRun: this.lastRun,
      runCount: this.runCount,
    };
  }

  /**
   * Deserialize pipeline from JSON
   * @param {object} data
   * @returns {Pipeline}
   */
  static fromJSON(data) {
    const p = new Pipeline(data.name, data.description);
    p.id = data.id || p.id;
    p.steps = data.steps || [];
    p.created = data.created || p.created;
    p.lastRun = data.lastRun || null;
    p.runCount = data.runCount || 0;
    return p;
  }
}

// ── Pipeline Store ──

/**
 * Save a pipeline definition
 * @param {Pipeline} pipeline
 */
function savePipeline(pipeline) {
  const all = _loadAll();
  const idx = all.findIndex(p => p.id === pipeline.id);
  const data = pipeline.toJSON ? pipeline.toJSON() : pipeline;
  if (idx >= 0) all[idx] = data; else all.push(data);
  _saveAll(all);
}

/**
 * List all saved pipelines
 * @returns {object[]}
 */
function listPipelines() {
  return _loadAll();
}

/**
 * Get a pipeline by ID
 * @param {string} id
 * @returns {Pipeline|null}
 */
function getPipeline(id) {
  const all = _loadAll();
  const data = all.find(p => p.id === id);
  return data ? Pipeline.fromJSON(data) : null;
}

/**
 * Delete a pipeline
 * @param {string} id
 * @returns {boolean}
 */
function deletePipeline(id) {
  const all = _loadAll();
  const filtered = all.filter(p => p.id !== id);
  if (filtered.length === all.length) return false;
  _saveAll(filtered);
  return true;
}

module.exports = { Pipeline, savePipeline, listPipelines, getPipeline, deletePipeline };
