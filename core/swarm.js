/**
 * ARIES SWARM v5.0 — Multi-Agent Task Execution System
 * 
 * True multi-agent system with specialized agent roles.
 * Commander orchestrates, specialist agents execute.
 * Shared data layer enables inter-agent communication.
 * Integrates with SwarmCoordinator for remote worker dispatch.
 */

const EventEmitter = require('events');
const os = require('os');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { AgentRoster } = require('./agents');
const SharedData = require('./shared-data');

// Config helper — supports new config system and legacy
function _getConfig() {
  try {
    const cfgMod = require('./config');
    if (cfgMod._data && Object.keys(cfgMod._data).length > 0) return cfgMod._data;
  } catch {}
  try { return require('../config.json'); } catch { return {}; }
}

// Agent tool access permissions
const AGENT_TOOL_ACCESS = {
  executor: null, // null = ALL tools
  coder: ['read', 'write', 'edit', 'shell', 'search', 'ls', 'append'],
  researcher: ['web', 'download', 'search', 'read'],
  navigator: ['web', 'download', 'search', 'read'],
  scout: ['shell', 'sysinfo', 'ls', 'process', 'read'],
  security: ['shell', 'read', 'search', 'process', 'ls'],
  debugger: ['read', 'shell', 'search', 'ls', 'process'],
  architect: ['read', 'web', 'search', 'ls'],
  optimizer: ['read', 'shell', 'search', 'sysinfo', 'process'],
  // Default for all others
  _default: ['read', 'web'],
};

class Swarm extends EventEmitter {
  constructor(aiCore, config = {}, coordinator = null) {
    super();
    this.ai = aiCore;
    // No CPU cap — agents are API calls, not CPU threads
    this.maxWorkers = config.maxWorkers || 14;
    // Concurrent API calls (avoid rate limiting)
    this.concurrency = config.concurrency || 3;
    this.workerTimeout = config.workerTimeout || 90000;
    this.retries = config.retries || 2;
    this.coordinator = coordinator;
    this.workers = new Map();
    this.taskQueue = [];
    this.results = [];
    this.isRunning = false;
    this.totalTokens = 0;
    this.stats = { totalTasks: 0, completed: 0, failed: 0, killed: 0, totalTime: 0, tokens: 0, remoteWorkers: 0 };
    
    // Multi-model support
    this.models = config.models || {};

    // Relay support
    this.relay = config.relay || null;

    // Multi-agent system
    this.roster = new AgentRoster();
    this.sharedData = new SharedData();
  }

  /** Update coordinator reference */
  setCoordinator(coordinator) {
    this.coordinator = coordinator;
  }

  /** Get the agent roster */
  getRoster() {
    return this.roster;
  }

  /** Get shared data instance */
  getSharedData() {
    return this.sharedData;
  }

  async execute(task) {
    this.isRunning = true;
    this.results = [];
    this.totalTokens = 0;
    this.stats = { totalTasks: 0, completed: 0, failed: 0, killed: 0, totalTime: 0, tokens: 0, remoteWorkers: 0 };
    const startTime = Date.now();

    const remoteCount = this.coordinator ? this.coordinator.workerCount : 0;
    const relayInfo = this.relay ? ` + relay @ ${this.relay.url}` : '';
    this.emit('status', `Swarm activated (${this.maxWorkers} local + ${remoteCount} remote workers${relayInfo}). Analyzing task...`);

    // Commander takes control
    this.roster.setStatus('commander', 'working', 'Analyzing & decomposing task');
    this.roster.postMessage('commander', 'all', `New mission received. Analyzing: "${task.substring(0, 80)}..."`);

    const subtasks = await this._decompose(task);
    this.stats.totalTasks = subtasks.length;
    this.emit('status', `Task decomposed into ${subtasks.length} subtasks. Commander allocating agents...`);
    this.emit('decomposed', subtasks);

    // Commander allocates tasks to specialist agents
    const allocations = this.roster.allocateTasks(subtasks);
    this.roster.postMessage('commander', 'all', `Allocated ${allocations.length} tasks to specialist agents.`);
    
    // Store allocations in shared data
    this.sharedData.set('swarm:currentMission', { task, subtasks: allocations.length, startTime });
    
    this.emit('allocations', allocations);

    await this._runPool(subtasks, allocations);

    this.roster.setStatus('commander', 'working', 'Aggregating results');
    this.roster.postMessage('commander', 'all', 'All agents reported. Synthesizing results...');
    this.emit('status', `All workers complete. Commander aggregating results...`);
    
    const finalResult = await this._aggregate(task, this.results);

    // Store agent memories from this run
    for (const r of this.results) {
      if (!r.result.startsWith('FAILED')) {
        this.roster.remember(r.agentId, `mission-${Date.now()}`, r.result.substring(0, 300));
      }
    }

    // Store results in shared data
    this.sharedData.set('swarm:lastMission', {
      task,
      completedAt: new Date().toISOString(),
      stats: { ...this.stats, totalTime: Date.now() - startTime },
      resultPreview: finalResult.substring(0, 200),
    });

    this.stats.totalTime = Date.now() - startTime;
    this.stats.tokens = this.totalTokens;
    this.isRunning = false;
    
    // Reset all agents
    this.roster.resetAll();
    this.roster.setStatus('commander', 'idle');
    
    this.emit('complete', { result: finalResult, stats: this.stats });

    return finalResult;
  }

  _trackTokens(data) {
    if (data && data.usage) {
      this.totalTokens += (data.usage.total_tokens || data.usage.prompt_tokens + data.usage.completion_tokens || 0);
    }
  }

  async _apiCall(messages, maxTokens = 2048, modelOverride = null) {
    const config = _getConfig();
    const gw = config.gateway || {};
    const model = modelOverride || gw.model || 'anthropic/claude-sonnet-4-20250514';
    const gatewayUrl = gw.url || 'http://localhost:18800/v1/chat/completions';
    const token = gw.token || '';
    const postData = JSON.stringify({ model, messages, max_tokens: maxTokens });
    const parsedUrl = new (require('url').URL)(gatewayUrl);
    const httpMod = parsedUrl.protocol === 'https:' ? https : http;

    return new Promise((resolve, reject) => {
      const req = httpMod.request(parsedUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token,
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 90000
      }, (res) => {
        let body = '';
        res.on('data', (c) => body += c);
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 400) {
            return reject(new Error('API error: ' + res.statusCode + ' ' + body.substring(0, 200)));
          }
          try {
            const data = JSON.parse(body);
            this._trackTokens(data);
            resolve(data);
          } catch (e) {
            reject(new Error('Invalid JSON response: ' + body.substring(0, 200)));
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('API call timed out')); });
      req.write(postData);
      req.end();
    });
  }

  async _decompose(task) {
    const config = require('../config.json');
    const decomposeModel = (config.models && config.models.swarmDecompose) || config.gateway.model;
    
    const messages = [
      {
        role: 'system',
        content: `You are COMMANDER, the orchestration agent. Break the given task into independent subtasks that can be executed in parallel by specialist agents.

Available agents and their keywords (use these keywords in subtask descriptions so the right agent is assigned):
- Coder: code, programming, algorithms, engineering, software, implementation, api, function
- Researcher: research, search, facts, investigation, sources, lookup, reference
- Analyst: analysis, data, patterns, strategy, evaluation, comparison, metrics, trends
- Creative: creative, writing, brainstorming, design, storytelling, ideation, content
- Scout: scanning, monitoring, recon, assessment, status, overview, discovery
- Executor: execute, run, shell, command, deploy, build, install, setup, configure, script
- Security: security, vulnerability, threat, attack, defense, encryption, audit, risk
- Trader: trading, market, finance, stock, crypto, price, investment, economic, profit
- Debugger: debug, error, bug, fix, crash, log, trace, troubleshoot, diagnose
- Architect: architecture, system, infrastructure, devops, cloud, database, scale, design
- Optimizer: optimize, performance, speed, efficiency, benchmark, cache, bottleneck, tuning
- Navigator: web, browse, url, fetch, link, website, page, scrape, navigate, online
- Scribe: document, documentation, summary, report, readme, guide, notes, explain

Return ONLY a JSON array of subtask strings. No explanations. Example:
["Research the background and sources for X", "Write code to implement Y", "Analyze the data patterns in Z"]

Rules:
- Maximum 10 subtasks
- Minimum 2 subtasks (ALWAYS break into at least 2 even if simple — use different specialist perspectives)
- Each subtask must be specific and actionable
- Include keywords from the target agent's specialty list so the right agent gets assigned
- Try to engage at least 3 different agents for complex tasks
- Subtasks should be roughly equal in complexity`
      },
      { role: 'user', content: task }
    ];

    try {
      const data = await this._apiCall(messages, 1024, decomposeModel);
      const content = data.choices[0].message.content.trim();
      const match = content.match(/\[[\s\S]*\]/);
      if (match) {
        const subtasks = JSON.parse(match[0]);
        if (Array.isArray(subtasks) && subtasks.length > 0) {
          return subtasks.slice(0, 10);
        }
      }
      return [task];
    } catch (e) {
      this.emit('error', `Decomposition failed: ${e.message}`);
      return [task];
    }
  }

  // --- Relay helpers ---

  _httpFetch(url, opts = {}) {
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      const mod = u.protocol === 'https:' ? https : http;
      const req = mod.request(u, { method: opts.method || 'GET', headers: opts.headers || {} }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString();
          resolve({ status: res.statusCode, body, json() { try { return JSON.parse(body); } catch { return null; } } });
        });
      });
      req.on('error', reject);
      if (opts.body) req.write(opts.body);
      req.end();
    });
  }

  async _relayAvailable() {
    if (!this.relay || !this.relay.url) return false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await this._httpFetch(`${this.relay.url}/api/status`, {
          headers: { 'X-Aries-Secret': this.relay.secret }
        });
        if (res.status === 200) return true;
        this.emit('status', `Relay check attempt ${attempt}/3 returned ${res.status}`);
      } catch (e) {
        this.emit('status', `Relay check attempt ${attempt}/3 failed: ${e.message}`);
      }
      if (attempt < 3) await new Promise(r => setTimeout(r, 1000));
    }
    return false;
  }

  async _dispatchToRelay(subtasks, allocations) {
    const url = this.relay.url.replace(/\/$/, '');
    const secret = this.relay.secret;

    const taskIds = [];
    const idToSubtask = {};
    const idToAllocation = {};
    for (let i = 0; i < subtasks.length; i++) {
      const alloc = allocations[i];
      const payload = {
        prompt: `${alloc.systemPrompt}\n\nComplete this subtask:\n${subtasks[i]}`,
        maxTokens: 2048
      };
      try {
        const submitRes = await this._httpFetch(`${url}/api/task`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Aries-Secret': secret },
          body: JSON.stringify(payload)
        });
        if (submitRes.status !== 200) throw new Error(`HTTP ${submitRes.status}`);
        const data = submitRes.json();
        // Support both {id: "..."} and {taskIds: ["..."]} response formats
        const taskId = data && (data.id || (Array.isArray(data.taskIds) && data.taskIds[0]));
        if (!taskId) throw new Error('No task id returned');
        taskIds.push(taskId);
        idToSubtask[taskId] = subtasks[i];
        idToAllocation[taskId] = alloc;
        this.roster.setStatus(alloc.agentId, 'working', subtasks[i].substring(0, 50));
      } catch (e) {
        this.emit('status', `Failed to submit subtask ${i + 1}: ${e.message}`);
        this.results.push({ id: `R-${i + 1}`, task: subtasks[i], result: `FAILED: submit error - ${e.message}`, agentId: alloc.agentId, agentName: alloc.agentName });
        this.stats.failed++;
      }
    }

    if (taskIds.length === 0) throw new Error('All relay submissions failed');
    this.emit('status', `Submitted ${taskIds.length}/${subtasks.length} tasks to relay`);

    const pending = new Set(taskIds);
    const pollInterval = 2000;
    const deadline = Date.now() + 120000; // 2 minutes per task (Ollama speed)

    while (pending.size > 0 && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, pollInterval));
      for (const id of [...pending]) {
        try {
          const res = await this._httpFetch(`${url}/api/result/${id}`, {
            headers: { 'X-Aries-Secret': secret }
          });
          if (res.status === 202) continue; // still processing
          if (res.status !== 200) continue;
          const data = res.json();
          if (!data || (!data.result && !data.error)) continue;
          if (data.error) { // relay reported error
            pending.delete(id);
            const idx = taskIds.indexOf(id);
            const workerId = 'R-' + (idx + 1);
            const alloc = idToAllocation[id];
            this.results.push({ id: workerId, task: idToSubtask[id], result: 'FAILED: ' + data.error, agentId: alloc.agentId, agentName: alloc.agentName });
            this.stats.failed++;
            this.roster.setStatus(alloc.agentId, 'idle', null);
            continue;
          }
          pending.delete(id);
          const idx = taskIds.indexOf(id);
          const workerId = `R-${idx + 1}`;
          const alloc = idToAllocation[id];
          const resultText = data.result;
          if (resultText.startsWith('ERROR:')) {
            this.results.push({ id: workerId, task: idToSubtask[id], result: `FAILED: ${resultText}`, agentId: alloc.agentId, agentName: alloc.agentName });
            this.stats.failed++;
          } else {
            this.results.push({ id: workerId, task: idToSubtask[id], result: resultText, agentId: alloc.agentId, agentName: alloc.agentName });
            this.stats.completed++;
            // Publish findings to shared data
            this.sharedData.publish(alloc.agentId, `result-${workerId}`, resultText.substring(0, 500));
            this.roster.postMessage(alloc.agentId, 'commander', `Task complete: ${idToSubtask[id].substring(0, 60)}`);
          }
          this.roster.setStatus(alloc.agentId, 'idle', null);
          this.emit('progress', {
            completed: this.stats.completed + this.stats.failed,
            total: subtasks.length,
            percent: Math.round(((this.stats.completed + this.stats.failed) / subtasks.length) * 100)
          });
        } catch (e) {}
      }
    }

    if (pending.size > 0) {
      this.emit('status', `${pending.size} relay tasks timed out, falling back to local...`);
      const localSubtasks = [...pending].map(id => idToSubtask[id]);
      const localAllocations = [...pending].map(id => idToAllocation[id]);
      pending.clear();
      await this._runLocalPool(localSubtasks, localAllocations, taskIds.length - localSubtasks.length);
    }
  }

  async _runLocalPool(subtasks, allocations, indexOffset = 0) {
    const promises = subtasks.map((subtask, i) => {
      const alloc = allocations[i];
      const worker = {
        id: `F-${indexOffset + i + 1}`,
        task: subtask,
        status: 'running',
        startTime: Date.now(),
        result: null,
        retries: 0,
        lastError: null,
        remote: false,
        agentId: alloc.agentId,
        agentName: alloc.agentName,
        systemPrompt: alloc.systemPrompt,
      };
      this.workers.set(worker.id, worker);
      this.roster.setStatus(alloc.agentId, 'working', subtask.substring(0, 50));
      return this._runWorkerWithRetry(worker)
        .then(result => {
          this.results.push({ id: worker.id, task: subtask, result, agentId: alloc.agentId, agentName: alloc.agentName });
          this.stats.completed++;
          this.sharedData.publish(alloc.agentId, `result-${worker.id}`, result.substring(0, 500));
          this.roster.postMessage(alloc.agentId, 'commander', `Task complete: ${subtask.substring(0, 60)}`);
        })
        .catch(err => {
          this.results.push({ id: worker.id, task: subtask, result: `FAILED: ${err.message}`, agentId: alloc.agentId, agentName: alloc.agentName });
          this.stats.failed++;
        })
        .finally(() => {
          this.workers.delete(worker.id);
          this.roster.setStatus(alloc.agentId, 'idle', null);
          this.emit('progress', {
            completed: this.stats.completed + this.stats.failed,
            total: this.stats.totalTasks,
            percent: Math.round(((this.stats.completed + this.stats.failed) / this.stats.totalTasks) * 100)
          });
        });
    });
    await Promise.all(promises);
  }

  async _runPool(subtasks, allocations) {
    // Try relay-first: Vultr primary, GCP failover
    if (this.relay && this.relay.url) {
      const relayUp = await this._relayAvailable();
      if (relayUp) {
        this.emit('status', `Dispatching ${subtasks.length} tasks via Vultr relay...`);
        try {
          await this._dispatchToRelay(subtasks, allocations);
          return;
        } catch (e) {
          this.emit('status', `Vultr relay dispatch failed (${e.message}), trying GCP failover...`);
        }
      } else {
        this.emit('status', `Vultr relay unreachable, trying GCP failover...`);
      }
      // GCP failover
      const config = _getConfig();
      const gcpRelay = config.relayGcp;
      if (gcpRelay && gcpRelay.url) {
        const origRelay = this.relay;
        this.relay = { url: gcpRelay.url, secret: gcpRelay.secret };
        const gcpUp = await this._relayAvailable();
        if (gcpUp) {
          this.emit('status', `GCP failover relay online. Dispatching ${subtasks.length} tasks...`);
          try {
            await this._dispatchToRelay(subtasks, allocations);
            this.relay = origRelay;
            return;
          } catch (e) {
            this.emit('status', `GCP relay dispatch failed (${e.message}), falling back to local...`);
          }
        } else {
          this.emit('status', `GCP failover also unreachable, using local workers...`);
        }
        this.relay = origRelay;
      }
    }

    let index = 0;
    const running = new Set();
    const total = subtasks.length;
    const remoteCount = this.coordinator ? this.coordinator.workerCount : 0;
    // Cap concurrent API calls to avoid rate limiting (API can handle ~3 parallel)
    const concurrencyLimit = this.concurrency || 3;
    const totalMax = Math.min(concurrencyLimit + remoteCount, subtasks.length);

    return new Promise((resolve) => {
      const emitProgress = () => {
        const done = this.stats.completed + this.stats.failed;
        const pct = Math.round((done / total) * 100);
        this.emit('progress', { completed: done, total, percent: pct });
      };

      const startNext = () => {
        while (running.size < totalMax && index < subtasks.length) {
          const taskIndex = index++;
          const subtask = subtasks[taskIndex];
          const alloc = allocations[taskIndex];
          const workerId = `W-${taskIndex + 1}`;

          const useRemote = this.coordinator && this.coordinator.hasIdleWorker();

          const worker = {
            id: workerId,
            task: subtask,
            status: 'running',
            startTime: Date.now(),
            result: null,
            retries: 0,
            lastError: null,
            remote: useRemote,
            agentId: alloc.agentId,
            agentName: alloc.agentName,
            agentIcon: alloc.agentIcon,
            systemPrompt: alloc.systemPrompt,
          };

          this.workers.set(workerId, worker);
          running.add(workerId);
          this.roster.setStatus(alloc.agentId, 'working', subtask.substring(0, 50));
          this.emit('worker_start', worker);

          const runFn = useRemote
            ? this._runRemoteWorker(worker)
            : this._runWorkerWithRetry(worker);

          runFn
            .then(result => {
              worker.status = 'complete';
              worker.result = result;
              worker.elapsed = Date.now() - worker.startTime;
              this.results.push({ id: workerId, task: subtask, result, agentId: alloc.agentId, agentName: alloc.agentName });
              this.stats.completed++;
              this.sharedData.publish(alloc.agentId, `result-${workerId}`, result.substring(0, 500));
              this.roster.postMessage(alloc.agentId, 'commander', `Task complete: ${subtask.substring(0, 60)}`);
              this.emit('worker_done', worker);
              emitProgress();
            })
            .catch(err => {
              worker.status = 'failed';
              worker.elapsed = Date.now() - worker.startTime;
              this.stats.failed++;
              this.results.push({ id: workerId, task: subtask, result: `FAILED: ${err.message}`, agentId: alloc.agentId, agentName: alloc.agentName });
              this.emit('worker_failed', worker);
              emitProgress();
            })
            .finally(() => {
              running.delete(workerId);
              this.workers.delete(workerId);
              this.roster.setStatus(alloc.agentId, 'idle', null);
              if (index < subtasks.length) {
                startNext();
              } else if (running.size === 0) {
                resolve();
              }
            });
        }

        if (index >= subtasks.length && running.size === 0) {
          resolve();
        }
      };

      startNext();
    });
  }

  async _runRemoteWorker(worker) {
    try {
      return await this.coordinator.dispatchRemote(worker.task, worker.systemPrompt, this.workerTimeout);
    } catch (e) {
      this.emit('status', `${worker.id} (${worker.agentName}) remote failed, falling back to local`);
      return await this._runWorkerWithRetry(worker);
    }
  }

  async _runWorkerWithRetry(worker) {
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        return await this._runWorker(worker, attempt);
      } catch (e) {
        worker.lastError = e.message;
        if (attempt < this.retries) {
          worker.retries++;
          worker.status = 'retrying';
          worker.startTime = Date.now();
          this.stats.killed++;
          this.emit('worker_retry', worker);
        } else {
          throw e;
        }
      }
    }
  }

  _getToolAccess(agentId) {
    const access = AGENT_TOOL_ACCESS[agentId] || AGENT_TOOL_ACCESS._default;
    return access; // null means all
  }

  _buildToolPrompt(agentId) {
    const access = this._getToolAccess(agentId);
    const allTools = {
      shell: '<tool:shell>command</tool:shell> — Run PowerShell/CMD command',
      read: '<tool:read>path</tool:read> — Read a file',
      write: '<tool:write path="path">content</tool:write> — Write/create a file',
      edit: '<tool:edit path="path" old="oldText">newText</tool:edit> — Edit a file',
      append: '<tool:append path="path">content</tool:append> — Append to file',
      ls: '<tool:shell>Get-ChildItem path</tool:shell> — List directory',
      web: '<tool:web>url</tool:web> — Fetch webpage content',
      download: '<tool:download url="url">save_path</tool:download> — Download file',
      search: '<tool:shell>Select-String -Path "dir" -Pattern "text"</tool:shell> — Search files',
      sysinfo: '<tool:sysinfo/> — System stats',
      process: '<tool:shell>Get-Process</tool:shell> — List processes',
    };

    const available = access === null ? Object.values(allTools) :
      access.map(t => allTools[t]).filter(Boolean);

    if (available.length === 0) return '';
    return '\n\n## Available Tools\nYou can use these tools to complete your task:\n' + available.join('\n') + '\n\nUse tools when you need to interact with the system. Results will be provided back to you.';
  }

  async _runWorker(worker, attempt) {
    const config = require('../config.json');
    const tools = require('./tools');
    const { parseTools, stripToolTags } = require('./ai');
    const workerModel = (config.models && config.models.swarmWorker) || config.gateway.model;

    return new Promise(async (resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Worker timed out'));
      }, this.workerTimeout);

      try {
        let taskPrompt = `Complete this subtask:\n${worker.task}`;
        if (attempt > 0 && worker.lastError) {
          taskPrompt += `\n\nPrevious attempt failed: ${worker.lastError}. Try a different approach.`;
        }

        // Inject agent memory from previous swarm runs
        const memories = this.roster.recall(worker.agentId);
        if (Object.keys(memories).length > 0) {
          const memStr = Object.entries(memories).slice(-5).map(([k, v]) => `- ${k}: ${v.value}`).join('\n');
          taskPrompt += `\n\nYour memories from previous missions:\n${memStr}`;
        }

        // Inject findings from other agents already completed in this run
        const peerFindings = this.results.filter(r => r.agentId !== worker.agentId && !r.result.startsWith('FAILED'));
        if (peerFindings.length > 0) {
          const peersStr = peerFindings.slice(-3).map(r => `${r.agentName}: ${r.result.substring(0, 200)}`).join('\n');
          taskPrompt += `\n\nFindings from other agents (for context):\n${peersStr}`;
        }

        // Use agent-specific system prompt + tool descriptions
        const toolPrompt = this._buildToolPrompt(worker.agentId);
        const systemPrompt = (worker.systemPrompt || 'You are a focused worker agent in a swarm. Complete ONLY the specific subtask assigned to you. Be thorough but concise. Return your findings/results directly.') + toolPrompt;

        const messages = [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: taskPrompt }
        ];

        // Tool execution loop (max 3 iterations for agents)
        let finalContent = '';
        for (let iter = 0; iter < 3; iter++) {
          const data = await this._apiCall(messages, 2048, workerModel);
          const content = data.choices[0].message.content;
          messages.push({ role: 'assistant', content });

          const toolCalls = parseTools(content);
          if (toolCalls.length === 0) {
            finalContent = content;
            break;
          }

          // Check tool access
          const access = this._getToolAccess(worker.agentId);
          const results = [];
          for (const call of toolCalls) {
            if (access !== null && !access.includes(call.tool)) {
              results.push({ tool: call.tool, success: false, output: `Access denied: ${call.tool}` });
              continue;
            }
            const fn = tools[call.tool];
            if (!fn) { results.push({ tool: call.tool, success: false, output: `Unknown tool: ${call.tool}` }); continue; }
            try {
              const result = await fn.apply(tools, call.args);
              results.push({ tool: call.tool, ...result });
            } catch (e) {
              results.push({ tool: call.tool, success: false, output: e.message });
            }
          }

          const toolReport = results.map(r => `[${r.tool}] ${r.success ? '✓' : '✗'}: ${r.output}`).join('\n\n');
          messages.push({ role: 'user', content: `Tool results:\n${toolReport}` });
          finalContent = stripToolTags(content);
        }

        clearTimeout(timeout);
        resolve(finalContent);
      } catch (e) {
        clearTimeout(timeout);
        reject(e);
      }
    });
  }

  async _aggregate(originalTask, results) {
    const config = require('../config.json');
    const aggregateModel = (config.models && config.models.swarmAggregate) || config.gateway.model;
    const resultText = results.map(r => `### ${r.id} (${r.agentName || 'Worker'}): ${r.task}\n${r.result}`).join('\n\n');

    const messages = [
      {
        role: 'system',
        content: `You are COMMANDER, the orchestration agent. Multiple specialist agents completed subtasks for a larger goal. Synthesize their results into a single, cohesive, well-organized response.

Rules for synthesis:
- Weigh specialist opinions by their domain expertise (e.g. Security agent's security advice > Coder's security opinions)
- Credit agents by name when their contribution is significant (e.g. "Per Security's analysis...")
- Resolve conflicts between agents by favoring the domain specialist
- Highlight areas of agreement across agents as high-confidence findings
- Flag any agent failures and note what was lost
- Be comprehensive but not redundant — merge overlapping findings`
      },
      {
        role: 'user',
        content: `Original task: ${originalTask}\n\nAgent results:\n${resultText}\n\nSynthesize these into a final comprehensive response.`
      }
    ];

    try {
      const data = await this._apiCall(messages, 4096, aggregateModel);
      return data.choices[0].message.content;
    } catch (e) {
      return `Aggregation failed. Raw results:\n\n${resultText}`;
    }
  }

  /**
   * Boot sequence — called on startup to initialize the swarm.
   * Tests AI connectivity, checks relay nodes, and sets agents to ready.
   */
  async boot() {
    const bootStart = Date.now();
    const status = { ai: false, relay: false, agents: 0, errors: [] };

    // 1. Test AI gateway connectivity
    try {
      const data = await this._apiCall(
        [{ role: 'user', content: 'Respond with exactly: SWARM_READY' }],
        20
      );
      const reply = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      status.ai = !!(reply && reply.length > 0);
      this.emit('status', 'AI gateway: ' + (status.ai ? 'ONLINE' : 'FAILED'));
    } catch (e) {
      status.errors.push('AI: ' + e.message);
      this.emit('status', 'AI gateway: FAILED (' + e.message + ')');
    }

    // 2. Check relay nodes
    if (this.relay && this.relay.url) {
      try {
        const relayUp = await this._relayAvailable();
        status.relay = relayUp;
        this.emit('status', 'Relay (' + this.relay.url + '): ' + (relayUp ? 'ONLINE' : 'UNREACHABLE'));
      } catch (e) {
        status.errors.push('Relay: ' + e.message);
      }
    }

    // 3. Set all agents to ready
    const agents = this.roster.getSummary();
    for (const agent of agents) {
      this.roster.setStatus(agent.id, 'idle');
    }
    status.agents = agents.length;

    // 4. Mark swarm as booted
    this._booted = true;
    this._bootTime = Date.now();
    status.bootMs = this._bootTime - bootStart;

    this.emit('boot', status);
    this.emit('status', 'Swarm booted: ' + status.agents + ' agents ready, AI ' + (status.ai ? 'online' : 'offline') + ', relay ' + (status.relay ? 'online' : 'offline') + ' (' + status.bootMs + 'ms)');

    return status;
  }

  getStats() {
    return {
      ...this.stats,
      activeWorkers: this.workers.size,
      isRunning: this.isRunning,
      tokens: this.totalTokens,
      remoteWorkers: this.coordinator ? this.coordinator.workerCount : 0,
      workers: [...this.workers.values()].map(w => ({
        id: w.id,
        status: w.status,
        task: w.task.substring(0, 50),
        elapsed: ((Date.now() - w.startTime) / 1000).toFixed(1) + 's',
        remote: !!w.remote,
        agentId: w.agentId,
        agentName: w.agentName,
        agentIcon: w.agentIcon,
      })),
      agents: this.roster.getSummary(),
    };
  }
}

module.exports = Swarm;
