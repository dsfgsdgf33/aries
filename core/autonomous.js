/**
 * ARIES v5.0 — Autonomous Goal Pursuit System
 * 
 * Decomposes high-level goals into task trees, executes them
 * autonomously with checkpointing, budgets, and pause/resume.
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_FILE = path.join(__dirname, '..', 'data', 'autonomous-runs.json');

class AutonomousRunner extends EventEmitter {
  /**
   * @param {object} opts
   * @param {object} opts.ai - AI core module
   * @param {object} opts.swarm - Swarm instance
   * @param {object} opts.config - autonomous config section
   */
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null;
    this.swarm = opts.swarm || null;
    this.config = opts.config || {};
    this.maxBudgetTokens = this.config.maxBudgetTokens || 500000;
    this.checkpointIntervalMs = this.config.checkpointIntervalMs || 60000;
    this.maxConcurrentGoals = this.config.maxConcurrentGoals || 3;
    /** @type {Map<string, object>} */
    this.activeRuns = new Map();
    this._checkpointTimers = new Map();
    this._loadRuns();
  }

  // ── Persistence ──

  _loadRuns() {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        this._savedRuns = Array.isArray(data) ? data : [];
      } else {
        this._savedRuns = [];
      }
    } catch { this._savedRuns = []; }
  }

  _saveRuns() {
    try {
      const dir = path.dirname(DATA_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      // Merge active + saved (replace saved entries with active versions)
      const activeArr = [...this.activeRuns.values()].map(r => this._serialize(r));
      const ids = new Set(activeArr.map(r => r.id));
      const merged = [...activeArr, ...this._savedRuns.filter(r => !ids.has(r.id))];
      fs.writeFileSync(DATA_FILE, JSON.stringify(merged.slice(-100), null, 2));
    } catch (e) { this.emit('error', e); }
  }

  _serialize(run) {
    return {
      id: run.id,
      goal: run.goal,
      status: run.status,
      createdAt: run.createdAt,
      updatedAt: Date.now(),
      tokensUsed: run.tokensUsed,
      budgetLimit: run.budgetLimit,
      taskTree: run.taskTree,
      completedTasks: run.completedTasks,
      totalTasks: run.totalTasks,
      progressPct: run.progressPct,
      reports: run.reports || [],
      finalResult: run.finalResult || null,
      error: run.error || null,
    };
  }

  // ── Core API ──

  /**
   * Start autonomous pursuit of a goal
   * @param {string} goal - High-level goal description
   * @param {object} [config] - Override config for this run
   * @returns {object} Run state
   */
  async startGoal(goal, config = {}) {
    if (this.activeRuns.size >= this.maxConcurrentGoals) {
      throw new Error(`Max concurrent goals (${this.maxConcurrentGoals}) reached`);
    }

    const id = crypto.randomBytes(8).toString('hex');
    const run = {
      id,
      goal,
      status: 'decomposing', // decomposing | running | paused | completed | aborted | failed | budget-exceeded
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tokensUsed: 0,
      budgetLimit: config.maxBudgetTokens || this.maxBudgetTokens,
      taskTree: [],
      completedTasks: 0,
      totalTasks: 0,
      progressPct: 0,
      reports: [],
      finalResult: null,
      error: null,
      _aborted: false,
      _paused: false,
      _pauseResolve: null,
    };

    this.activeRuns.set(id, run);
    this.emit('progress', { id, status: 'decomposing', goal });

    // Start checkpoint timer
    const timer = setInterval(() => {
      this._checkpoint(id);
    }, this.checkpointIntervalMs);
    this._checkpointTimers.set(id, timer);

    // Run async — don't await
    this._executeGoal(run).catch(e => {
      run.status = 'failed';
      run.error = e.message;
      this.emit('progress', { id, status: 'failed', error: e.message });
      this._cleanup(id);
    });

    return { id, goal, status: run.status };
  }

  /**
   * Pause a running goal
   * @param {string} [id] - Run ID (pauses first active if omitted)
   */
  pause(id) {
    const run = id ? this.activeRuns.get(id) : [...this.activeRuns.values()].find(r => r.status === 'running');
    if (!run) throw new Error('No active run found');
    if (run.status !== 'running') throw new Error(`Cannot pause run in status: ${run.status}`);
    run._paused = true;
    run.status = 'paused';
    this.emit('progress', { id: run.id, status: 'paused' });
    this._saveRuns();
    return { id: run.id, status: 'paused' };
  }

  /**
   * Resume a paused goal
   * @param {string} [id] - Run ID
   */
  resume(id) {
    const run = id ? this.activeRuns.get(id) : [...this.activeRuns.values()].find(r => r.status === 'paused');
    if (!run) throw new Error('No paused run found');
    if (run.status !== 'paused') throw new Error(`Cannot resume run in status: ${run.status}`);
    run._paused = false;
    run.status = 'running';
    if (run._pauseResolve) { run._pauseResolve(); run._pauseResolve = null; }
    this.emit('progress', { id: run.id, status: 'running' });
    return { id: run.id, status: 'running' };
  }

  /**
   * Abort a running/paused goal
   * @param {string} [id] - Run ID
   */
  abort(id) {
    const run = id ? this.activeRuns.get(id) : [...this.activeRuns.values()].find(r => r.status === 'running' || r.status === 'paused');
    if (!run) throw new Error('No active run found');
    run._aborted = true;
    run._paused = false;
    run.status = 'aborted';
    if (run._pauseResolve) { run._pauseResolve(); run._pauseResolve = null; }
    this.emit('progress', { id: run.id, status: 'aborted' });
    this._cleanup(run.id);
    return { id: run.id, status: 'aborted' };
  }

  /**
   * Get progress of a run
   * @param {string} id - Run ID
   */
  getProgress(id) {
    const run = this.activeRuns.get(id);
    if (run) return this._serialize(run);
    return this._savedRuns.find(r => r.id === id) || null;
  }

  /**
   * List all runs (active + saved)
   */
  listRuns() {
    const activeArr = [...this.activeRuns.values()].map(r => this._serialize(r));
    const ids = new Set(activeArr.map(r => r.id));
    return [...activeArr, ...this._savedRuns.filter(r => !ids.has(r.id))].sort((a, b) => b.createdAt - a.createdAt);
  }

  // ── Internal ──

  async _executeGoal(run) {
    try {
      // Step 1: Decompose goal into task tree
      run.taskTree = await this._decomposeGoal(run);
      run.totalTasks = run.taskTree.length;
      run.status = 'running';
      this.emit('progress', { id: run.id, status: 'running', totalTasks: run.totalTasks });
      this._saveRuns();

      // Step 2: Execute tasks in dependency order
      for (let i = 0; i < run.taskTree.length; i++) {
        // Check abort
        if (run._aborted) return;

        // Check pause
        if (run._paused) {
          await new Promise(resolve => { run._pauseResolve = resolve; });
          if (run._aborted) return;
        }

        // Check budget
        if (run.tokensUsed >= run.budgetLimit) {
          run.status = 'budget-exceeded';
          this.emit('budget-warning', { id: run.id, tokensUsed: run.tokensUsed, limit: run.budgetLimit });
          this._cleanup(run.id);
          return;
        }

        // Warn at 80% budget
        if (run.tokensUsed > run.budgetLimit * 0.8) {
          this.emit('budget-warning', { id: run.id, tokensUsed: run.tokensUsed, limit: run.budgetLimit, pct: Math.round(run.tokensUsed / run.budgetLimit * 100) });
        }

        const task = run.taskTree[i];
        task.status = 'running';
        this.emit('progress', { id: run.id, taskIndex: i, task: task.description, status: 'task-running' });

        try {
          const result = await this._executeTask(run, task);
          task.status = 'completed';
          task.result = result.text;
          run.tokensUsed += result.tokens || 0;
          run.completedTasks++;
          run.progressPct = Math.round((run.completedTasks / run.totalTasks) * 100);

          // Generate progress report every 3 tasks
          if (run.completedTasks % 3 === 0 || run.completedTasks === run.totalTasks) {
            const report = await this._generateReport(run);
            run.reports.push({ timestamp: Date.now(), text: report });
          }

          this.emit('progress', { id: run.id, taskIndex: i, status: 'task-complete', progressPct: run.progressPct, tokensUsed: run.tokensUsed });
        } catch (e) {
          task.status = 'failed';
          task.error = e.message;
          this.emit('progress', { id: run.id, taskIndex: i, status: 'task-failed', error: e.message });
        }
      }

      // Step 3: Final synthesis
      if (!run._aborted) {
        run.finalResult = await this._synthesize(run);
        run.status = 'completed';
        this.emit('complete', { id: run.id, result: run.finalResult });
      }
    } catch (e) {
      run.status = 'failed';
      run.error = e.message;
      this.emit('progress', { id: run.id, status: 'failed', error: e.message });
    } finally {
      this._cleanup(run.id);
    }
  }

  async _decomposeGoal(run) {
    const messages = [
      {
        role: 'system',
        content: `You are COMMANDER. Decompose the given goal into an ordered task tree. Each task should have:
- description: what to do
- successCriteria: how to know it's done
- dependsOn: array of task indices this depends on (empty for independent tasks)

Return ONLY a JSON array like:
[{"description":"...", "successCriteria":"...", "dependsOn":[]}, ...]

Rules:
- 3-15 tasks depending on complexity
- Tasks should be concrete and actionable
- Order matters: earlier tasks provide context for later ones
- Include a final synthesis/review task`
      },
      { role: 'user', content: run.goal }
    ];

    const data = await this.ai.callWithFallback(messages, null);
    const content = data.choices?.[0]?.message?.content || '[]';
    run.tokensUsed += this._estimateTokens(content);
    const match = content.match(/\[[\s\S]*\]/);
    if (match) {
      const tasks = JSON.parse(match[0]);
      return tasks.map((t, i) => ({
        index: i,
        description: t.description || `Task ${i + 1}`,
        successCriteria: t.successCriteria || 'Completed successfully',
        dependsOn: t.dependsOn || [],
        status: 'pending',
        result: null,
        error: null,
      }));
    }
    return [{ index: 0, description: run.goal, successCriteria: 'Goal achieved', dependsOn: [], status: 'pending', result: null, error: null }];
  }

  async _executeTask(run, task) {
    // Use swarm if available, otherwise direct AI call
    if (this.swarm && task.description.length > 50) {
      try {
        const result = await this.swarm.execute(task.description);
        return { text: result, tokens: this._estimateTokens(result) };
      } catch {
        // Fall back to direct AI
      }
    }

    const prevResults = run.taskTree
      .filter(t => t.status === 'completed' && t.result)
      .slice(-3)
      .map(t => `[${t.description}]: ${t.result.substring(0, 300)}`)
      .join('\n');

    const messages = [
      { role: 'system', content: 'You are an autonomous agent executing a subtask. Be thorough and complete. Provide actionable results.' },
      { role: 'user', content: `Goal: ${run.goal}\n\nCurrent task: ${task.description}\nSuccess criteria: ${task.successCriteria}\n\n${prevResults ? 'Previous results:\n' + prevResults : ''}` }
    ];

    const data = await this.ai.callWithFallback(messages, null);
    const content = data.choices?.[0]?.message?.content || '';
    return { text: content, tokens: this._estimateTokens(content) };
  }

  async _generateReport(run) {
    const completed = run.taskTree.filter(t => t.status === 'completed');
    const pending = run.taskTree.filter(t => t.status === 'pending');
    const failed = run.taskTree.filter(t => t.status === 'failed');

    return `## Progress Report — ${new Date().toISOString()}\n` +
      `**Goal:** ${run.goal}\n` +
      `**Progress:** ${run.progressPct}% (${run.completedTasks}/${run.totalTasks})\n` +
      `**Tokens Used:** ${run.tokensUsed.toLocaleString()} / ${run.budgetLimit.toLocaleString()}\n` +
      `**Completed:** ${completed.map(t => '✓ ' + t.description).join('\n')}\n` +
      `**Pending:** ${pending.map(t => '○ ' + t.description).join('\n')}\n` +
      (failed.length ? `**Failed:** ${failed.map(t => '✗ ' + t.description + ': ' + t.error).join('\n')}\n` : '');
  }

  async _synthesize(run) {
    const results = run.taskTree
      .filter(t => t.result)
      .map(t => `### ${t.description}\n${t.result}`)
      .join('\n\n');

    const messages = [
      { role: 'system', content: 'You are COMMANDER. Synthesize all task results into a final comprehensive deliverable for the original goal. Be thorough.' },
      { role: 'user', content: `Original goal: ${run.goal}\n\nTask results:\n${results}` }
    ];

    try {
      const data = await this.ai.callWithFallback(messages, null);
      const content = data.choices?.[0]?.message?.content || results;
      run.tokensUsed += this._estimateTokens(content);
      return content;
    } catch {
      return results;
    }
  }

  _checkpoint(id) {
    const run = this.activeRuns.get(id);
    if (!run) return;
    this.emit('checkpoint', { id, progressPct: run.progressPct, tokensUsed: run.tokensUsed });
    this._saveRuns();
  }

  _cleanup(id) {
    const run = this.activeRuns.get(id);
    if (run) {
      this._saveRuns();
      this.activeRuns.delete(id);
    }
    const timer = this._checkpointTimers.get(id);
    if (timer) { clearInterval(timer); this._checkpointTimers.delete(id); }
  }

  _estimateTokens(text) {
    return Math.ceil((text || '').length / 4);
  }
}

module.exports = { AutonomousRunner };
