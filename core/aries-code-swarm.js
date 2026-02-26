/**
 * ARIES Code Swarm — Multi-Agent Coding System
 * No npm dependencies — Node.js built-ins only.
 */

const EventEmitter = require('events');
const { AriesCode } = require('./aries-code');

class AriesCodeSwarm extends EventEmitter {
  constructor(ai, options = {}) {
    super();
    this.ai = ai;
    this.options = options;
    this.maxCoders = options.maxCoders || 5;
    this._cancelled = false;
  }

  cancel() {
    this._cancelled = true;
    if (this._agents) this._agents.forEach(a => a.cancel());
  }

  async run(task, workDir) {
    this._cancelled = false;
    this._agents = [];
    const startTime = Date.now();

    try {
      this.emit('phase', { phase: 'plan', status: 'started' });
      const codebaseContext = await new AriesCode(this.ai).indexCodebase(workDir);
      const plan = await this.planPhase(task, codebaseContext);
      this.emit('phase', { phase: 'plan', status: 'done', plan });

      if (this._cancelled) return this._result(false, 'Cancelled', startTime);

      this.emit('phase', { phase: 'code', status: 'started' });
      const codeResults = await this.codePhase(plan, workDir);
      this.emit('phase', { phase: 'code', status: 'done', results: codeResults });

      if (this._cancelled) return this._result(false, 'Cancelled', startTime);

      const changedFiles = codeResults.flatMap(r => r.files_changed || []);

      this.emit('phase', { phase: 'review', status: 'started' });
      const reviewResult = await this.reviewPhase(changedFiles, workDir);
      this.emit('phase', { phase: 'review', status: 'done', review: reviewResult });

      if (reviewResult.issues && reviewResult.issues.length > 0 && !this._cancelled) {
        this.emit('phase', { phase: 'fix', status: 'started' });
        await this.fixPhase(reviewResult.issues, workDir);
        this.emit('phase', { phase: 'fix', status: 'done' });
      }

      if (plan.testCommand && !this._cancelled) {
        this.emit('phase', { phase: 'test', status: 'started' });
        const testResult = await this.testPhase(workDir, plan.testCommand);
        this.emit('phase', { phase: 'test', status: 'done', test: testResult });
      }

      return this._result(true, codeResults.map(r => r.summary).join('\n'), startTime, changedFiles);
    } catch (err) {
      this.emit('error', err);
      return this._result(false, 'Error: ' + err.message, startTime);
    }
  }

  _result(success, summary, startTime, files) {
    const result = {
      success,
      summary,
      files_changed: files || [],
      duration_ms: Date.now() - startTime,
    };
    this.emit('done', result);
    return result;
  }

  async planPhase(task, codebaseContext) {
    const messages = [
      { role: 'system', content: `You are the Architect agent. Analyze the task and codebase, then create a plan.
Respond with a JSON object (no markdown fences):
{
  "description": "What we're building",
  "subtasks": [
    {"id": 1, "description": "task description", "files": ["file1.js", "file2.js"], "dependencies": []},
    ...
  ],
  "testCommand": "node test.js" or null
}
Keep subtasks independent where possible so they can run in parallel.` },
      { role: 'user', content: 'Task: ' + task + '\n\nCodebase:\n' + codebaseContext },
    ];

    const response = await this.ai.chat(messages);
    const text = typeof response === 'string' ? response : (response.content || response.text || '');

    try {
      // Try to extract JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch {}

    // Fallback plan
    return {
      description: task,
      subtasks: [{ id: 1, description: task, files: [], dependencies: [] }],
      testCommand: null,
    };
  }

  async codePhase(plan, workDir) {
    const subtasks = plan.subtasks || [];
    // Group independent tasks (no dependencies)
    const independent = subtasks.filter(t => !t.dependencies || t.dependencies.length === 0);
    const dependent = subtasks.filter(t => t.dependencies && t.dependencies.length > 0);

    const results = [];

    // Run independent tasks in parallel (limited concurrency)
    if (independent.length > 0) {
      const batches = [];
      for (let i = 0; i < independent.length; i += this.maxCoders) {
        batches.push(independent.slice(i, i + this.maxCoders));
      }
      for (const batch of batches) {
        if (this._cancelled) break;
        const promises = batch.map(subtask => {
          const agent = new AriesCode(this.ai, this.options);
          this._agents.push(agent);
          agent.on('tool_call', d => this.emit('tool_call', { agent: subtask.id, ...d }));
          agent.on('tool_result', d => this.emit('tool_result', { agent: subtask.id, ...d }));
          agent.on('message', d => this.emit('message', { agent: subtask.id, ...d }));
          const scopeNote = subtask.files.length
            ? '\n\nFocus on these files: ' + subtask.files.join(', ')
            : '';
          return agent.run(subtask.description + scopeNote, workDir);
        });
        const batchResults = await Promise.all(promises);
        results.push(...batchResults);
      }
    }

    // Run dependent tasks sequentially
    for (const subtask of dependent) {
      if (this._cancelled) break;
      const agent = new AriesCode(this.ai, this.options);
      this._agents.push(agent);
      agent.on('tool_call', d => this.emit('tool_call', { agent: subtask.id, ...d }));
      agent.on('tool_result', d => this.emit('tool_result', { agent: subtask.id, ...d }));
      const result = await agent.run(subtask.description, workDir);
      results.push(result);
    }

    return results;
  }

  async reviewPhase(changedFiles, workDir) {
    const fs = require('fs');
    const path = require('path');
    const fileContents = changedFiles.map(f => {
      try {
        const full = path.resolve(workDir, f);
        return f + ':\n```\n' + fs.readFileSync(full, 'utf8').substring(0, 5000) + '\n```';
      } catch { return f + ': (could not read)'; }
    }).join('\n\n');

    const messages = [
      { role: 'system', content: 'You are a code reviewer. Review the following files for bugs, issues, and improvements. Respond with JSON: {"issues": [{"file": "path", "line": 0, "severity": "error|warning", "description": "..."}], "approved": true/false}' },
      { role: 'user', content: fileContents || 'No files changed.' },
    ];

    const response = await this.ai.chat(messages);
    const text = typeof response === 'string' ? response : (response.content || '');
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch {}
    return { issues: [], approved: true };
  }

  async testPhase(workDir, testCommand) {
    const agent = new AriesCode(this.ai, this.options);
    const result = agent.toolExec(testCommand || 'echo "No test command"', workDir);
    const passed = !result.startsWith('EXIT');
    return { passed, output: result };
  }

  async fixPhase(issues, workDir) {
    const errorIssues = issues.filter(i => i.severity === 'error');
    if (errorIssues.length === 0) return;
    const task = 'Fix these issues:\n' + errorIssues.map(i => '- ' + i.file + ': ' + i.description).join('\n');
    const agent = new AriesCode(this.ai, this.options);
    this._agents.push(agent);
    agent.on('tool_call', d => this.emit('tool_call', { agent: 'fixer', ...d }));
    return agent.run(task, workDir);
  }
}

module.exports = { AriesCodeSwarm };
