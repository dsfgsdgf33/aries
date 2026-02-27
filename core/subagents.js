/**
 * ARIES Subagent Engine — Persistent subagent sessions modeled after OpenClaw
 * Each subagent has its own identity, model, system prompt, and conversation history.
 * No npm dependencies — Node.js built-ins only.
 */

const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const AGENTS_FILE = path.join(DATA_DIR, 'subagents.json');
const HISTORY_DIR = path.join(DATA_DIR, 'subagent-history');

// Ensure directories exist
function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });
}

// Built-in subagent definitions
const BUILTIN_AGENTS = {
  codex: {
    id: 'codex',
    name: 'Codex',
    icon: '⌨️',
    model: 'claude-sonnet-4-20250514',
    builtin: true,
    systemPrompt: `You are Codex, the dedicated coding subagent for Aries. You are an expert programmer.
You have full tool access: read/write files, execute shell commands, search the web, and use the code sandbox.
When given a coding task:
1. Analyze the requirements
2. Plan the implementation
3. Write clean, working code
4. Test it works
5. Report back with what you built

You work inside the Aries workspace. Be thorough, write production-quality code.
Tools available: read, write, edit, exec, search, browse, sandbox
Format tool calls as XML: <tool:read>path</tool:read>, <tool:write path="file.js">content</tool:write>, etc.
<tool:shell>command</tool:shell> — PowerShell/CMD
<tool:edit path="path">
---OLD---
old text
---NEW---
new text
</tool:edit> — Edit file
<tool:ls>dir</tool:ls> — List directory
<tool:web>url</tool:web> — Fetch webpage
<tool:search dir="dir" pattern="regex">glob</tool:search> — Search files
<tool:sandbox lang="js">code</tool:sandbox> — Run code in sandbox
<tool:done>summary</tool:done> — Signal task completion

Rules:
1. ACT FIRST. Use tools, don't just talk.
2. Be thorough but concise in your final report.
3. Test your work before reporting done.`,
    specialties: ['code', 'programming', 'build', 'fix', 'debug', 'refactor', 'architecture']
  }
};

class SubagentManager extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null; // Reference to ai.js module
    this._agents = {};         // id -> definition
    this._state = {};          // id -> { taskCount, lastActive, status }
    this._runningTasks = new Map(); // taskId -> { agentId, resolve, reject, stream }
    ensureDirs();
    this._load();
  }

  /** Load persisted agent definitions and state */
  _load() {
    // Load built-ins first
    for (const [id, def] of Object.entries(BUILTIN_AGENTS)) {
      this._agents[id] = { ...def };
      this._state[id] = this._state[id] || { taskCount: 0, lastActive: null, status: 'idle' };
    }
    // Load persisted custom agents + built-in overrides
    try {
      if (fs.existsSync(AGENTS_FILE)) {
        const data = JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf8'));
        if (data.agents) {
          for (const [id, def] of Object.entries(data.agents)) {
            if (!BUILTIN_AGENTS[id]) {
              this._agents[id] = def;
            }
          }
        }
        // Apply saved overrides to built-in agents (model, name, icon, etc.)
        if (data.builtinOverrides) {
          for (const [id, overrides] of Object.entries(data.builtinOverrides)) {
            if (this._agents[id]) {
              Object.assign(this._agents[id], overrides);
            }
          }
        }
        if (data.state) {
          for (const [id, st] of Object.entries(data.state)) {
            this._state[id] = { ...this._state[id], ...st };
          }
        }
      }
    } catch (e) {
      console.error('[SubagentManager] Failed to load state:', e.message);
    }
  }

  /** Save agent definitions and state to disk */
  _save() {
    try {
      ensureDirs();
      const customAgents = {};
      const builtinOverrides = {};
      for (const [id, def] of Object.entries(this._agents)) {
        if (!def.builtin) {
          customAgents[id] = def;
        } else if (BUILTIN_AGENTS[id]) {
          // Save any overrides to built-in agents (model, name, icon, systemPrompt)
          const orig = BUILTIN_AGENTS[id];
          const overrides = {};
          if (def.model !== orig.model) overrides.model = def.model;
          if (def.name !== orig.name) overrides.name = def.name;
          if (def.icon !== orig.icon) overrides.icon = def.icon;
          if (def.systemPrompt !== orig.systemPrompt) overrides.systemPrompt = def.systemPrompt;
          if (Object.keys(overrides).length > 0) builtinOverrides[id] = overrides;
        }
      }
      fs.writeFileSync(AGENTS_FILE, JSON.stringify({ agents: customAgents, builtinOverrides, state: this._state }, null, 2));
    } catch (e) {
      console.error('[SubagentManager] Failed to save state:', e.message);
    }
  }

  /** Get history file path for an agent */
  _historyPath(id) {
    return path.join(HISTORY_DIR, `${id}.json`);
  }

  /** Load conversation history for an agent */
  _loadHistory(id) {
    try {
      const fp = this._historyPath(id);
      if (fs.existsSync(fp)) {
        return JSON.parse(fs.readFileSync(fp, 'utf8'));
      }
    } catch (e) {
      console.error('[SubagentManager] Failed to load history for', id, e.message);
    }
    return [];
  }

  /** Save conversation history for an agent */
  _saveHistory(id, history) {
    try {
      ensureDirs();
      // Cap history to last 200 messages to prevent unbounded growth
      const capped = history.slice(-200);
      fs.writeFileSync(this._historyPath(id), JSON.stringify(capped, null, 2));
    } catch (e) {
      console.error('[SubagentManager] Failed to save history for', id, e.message);
    }
  }

  /** Register a new subagent definition */
  register(definition) {
    if (!definition.id) throw new Error('Subagent definition must have an id');
    if (BUILTIN_AGENTS[definition.id]) throw new Error(`Cannot override built-in agent: ${definition.id}`);
    this._agents[definition.id] = {
      id: definition.id,
      name: definition.name || definition.id,
      icon: definition.icon || '🤖',
      model: definition.model || null,
      systemPrompt: definition.systemPrompt || 'You are a helpful subagent.',
      specialties: definition.specialties || [],
      builtin: false,
      createdAt: new Date().toISOString()
    };
    this._state[definition.id] = this._state[definition.id] || { taskCount: 0, lastActive: null, status: 'idle' };
    this._save();
    this.emit('registered', definition.id);
    return this._agents[definition.id];
  }

  /**
   * Build a 5-layer smart prompt for subagent task delegation.
   * Layers: Identity, Context, Task, Constraints, Output Format
   */
  buildSmartPrompt(agent, task, context = {}) {
    const layers = [];

    // Layer 1 — Identity
    layers.push(`## Identity\n${agent.systemPrompt || 'You are a helpful subagent.'}`);

    // Layer 2 — Context
    let contextBlock = '## Context\n';
    if (context.recentMessages && context.recentMessages.length > 0) {
      contextBlock += 'Recent conversation context:\n';
      for (const msg of context.recentMessages.slice(-5)) {
        contextBlock += `[${msg.role}] ${(msg.content || '').substring(0, 200)}\n`;
      }
    }
    if (context.knowledgeEntities && context.knowledgeEntities.length > 0) {
      contextBlock += '\nRelevant knowledge:\n';
      for (const e of context.knowledgeEntities.slice(0, 5)) {
        contextBlock += `- [${e.type}] ${JSON.stringify(e.properties).substring(0, 150)}\n`;
      }
    }
    if (context.additionalContext) contextBlock += '\n' + context.additionalContext;
    layers.push(contextBlock);

    // Layer 3 — Task
    layers.push(`## Task\n${task}\n\nSuccess criteria: Complete the task fully, verify the result, report what was done.`);

    // Layer 4 — Constraints
    let constraints = '## Constraints\n';
    constraints += `- Max iterations: ${context.maxIterations || 15}\n`;
    constraints += `- Time limit: ${context.timeLimit || 'none'}\n`;
    if (context.toolRestrictions) constraints += `- Tool restrictions: ${context.toolRestrictions}\n`;
    constraints += '- Quality: Production-ready, tested, no half-done work\n';
    layers.push(constraints);

    // Layer 5 — Output Format
    let outputFormat = '## Output Format\n';
    outputFormat += context.outputFormat || 'When done, use <tool:done>summary of what was accomplished</tool:done> to signal completion. Be concise but thorough in your summary.';
    layers.push(outputFormat);

    return layers.join('\n\n');
  }

  /** Spawn a task into a specific subagent, returns Promise<result> */
  async spawn(agentId, task, opts = {}) {
    const agent = this._agents[agentId];
    if (!agent) throw new Error(`Unknown subagent: ${agentId}`);
    if (!this.ai) throw new Error('AI module not set');

    const callWithFallback = this.ai.callWithFallback;
    const parseTools = this.ai.parseTools;
    const stripToolTags = this.ai.stripToolTags;
    if (!callWithFallback) throw new Error('AI module missing callWithFallback');

    // Load existing conversation history
    const history = this._loadHistory(agentId);

    // Build smart prompt context
    let kgEntities = [];
    try {
      const kg = require('./knowledge-graph').getInstance();
      // Search for task-relevant entities
      const keywords = task.split(/\s+/).filter(w => w.length > 4).slice(0, 3);
      for (const kw of keywords) {
        kgEntities.push(...kg.search(kw));
      }
      // Deduplicate by id
      const seen = new Set();
      kgEntities = kgEntities.filter(e => { if (seen.has(e.id)) return false; seen.add(e.id); return true; });
    } catch {}

    const smartPrompt = this.buildSmartPrompt(agent, task, {
      recentMessages: history.slice(-10),
      knowledgeEntities: kgEntities,
      maxIterations: opts.maxIterations || 15,
      timeLimit: opts.timeLimit,
      toolRestrictions: opts.toolRestrictions,
      outputFormat: opts.outputFormat
    });

    // Build messages
    const messages = [
      { role: 'system', content: smartPrompt }
    ];

    // Include recent history for context (last 20 messages)
    const recentHistory = history.slice(-20);
    for (const msg of recentHistory) {
      messages.push({ role: msg.role, content: msg.content });
    }

    // Add new task
    messages.push({ role: 'user', content: task });

    // Update state
    this._state[agentId] = this._state[agentId] || { taskCount: 0, lastActive: null, status: 'idle' };
    this._state[agentId].status = 'working';
    this._state[agentId].lastActive = new Date().toISOString();
    this._save();
    this.emit('taskStart', { agentId, task });

    const onStream = opts.onStream || null;
    const model = agent.model || undefined;
    const MAX_ITERATIONS = 15;
    let lastResponse = '';
    let iterations = 0;

    try {
      // Agent loop — similar to agentLoop in ai.js but uses callWithFallback directly
      for (let i = 0; i < MAX_ITERATIONS; i++) {
        iterations++;

        const data = await callWithFallback(messages, model, false);
        const _usedModel = data.model || data._model || model || 'unknown';
        const content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
        lastResponse = content;
        if (iterations === 1) this._lastUsedModel = _usedModel;

        if (onStream) onStream({ type: 'response', content, iteration: iterations });

        // Parse tool calls
        const toolCalls = parseTools ? parseTools(content) : [];

        // Check for done signal
        const doneCall = toolCalls.find(t => t.tool === 'done');
        if (doneCall) {
          lastResponse = doneCall.args[0] || stripToolTags(content) || content;
          break;
        }

        if (toolCalls.length === 0) break; // No tools = final response

        // Execute tools
        let toolResultsText = '';
        for (const call of toolCalls) {
          if (call.tool === 'done') continue;
          try {
            const tools = require('./tools');
            let result;
            // Handle ariesCode separately
            if (call.tool === 'ariesCode') {
              try {
                const { AriesCode } = require('./aries-code');
                const acAi = { chat: async (msgs) => {
                  const d = await callWithFallback(msgs, model);
                  return (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '';
                }};
                const ac = new AriesCode(acAi, { maxIterations: 20 });
                const workDir = call.args[0] || path.join(__dirname, '..');
                const taskDesc = call.args[1] || call.args[0] || '';
                const acResult = await ac.run(taskDesc, workDir);
                result = { success: acResult.success, output: 'Aries Code completed:\n' + acResult.summary };
              } catch (e) { result = { success: false, output: 'AriesCode error: ' + e.message }; }
            } else {
              const fn = tools[call.tool];
              if (fn) {
                result = await fn.apply(tools, call.args);
              } else {
                result = { success: false, output: `Unknown tool: ${call.tool}` };
              }
            }
            const output = typeof result === 'object' ? (result.output || JSON.stringify(result)) : String(result);
            if (onStream) onStream({ type: 'tool', tool: call.tool, args: call.args, result: output });
            toolResultsText += `\n[${call.tool}] ${output}\n`;
          } catch (e) {
            toolResultsText += `\n[${call.tool}] Error: ${e.message}\n`;
          }
        }

        messages.push({ role: 'assistant', content: content });
        messages.push({ role: 'user', content: `Tool results:\n${toolResultsText}` });
      }
    } catch (e) {
      lastResponse = `Subagent error: ${e.message}`;
    }

    // Clean response
    const finalResponse = (stripToolTags ? stripToolTags(lastResponse) : lastResponse) || lastResponse;

    // Save to history
    history.push({ role: 'user', content: task, timestamp: new Date().toISOString() });
    history.push({ role: 'assistant', content: finalResponse, timestamp: new Date().toISOString() });
    this._saveHistory(agentId, history);

    // Update state
    this._state[agentId].taskCount = (this._state[agentId].taskCount || 0) + 1;
    this._state[agentId].status = 'idle';
    this._state[agentId].lastActive = new Date().toISOString();
    this._save();
    this.emit('taskComplete', { agentId, task, response: finalResponse, iterations });

    return finalResponse;
  }

  /** Get agent definition + status */
  getAgent(id) {
    const agent = this._agents[id];
    if (!agent) return null;
    return { ...agent, ...(this._state[id] || {}) };
  }

  /** List all registered subagents */
  list() {
    return Object.keys(this._agents).map(id => this.getAgent(id));
  }

  /** Get conversation history for a subagent */
  getHistory(id, limit) {
    const history = this._loadHistory(id);
    if (limit) return history.slice(-limit);
    return history;
  }

  /** Clear a subagent's conversation history */
  clearHistory(id) {
    if (!this._agents[id]) throw new Error(`Unknown subagent: ${id}`);
    try {
      const fp = this._historyPath(id);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    } catch (e) {}
    this.emit('historyCleared', id);
  }

  /** Remove a custom subagent */
  remove(id) {
    if (BUILTIN_AGENTS[id]) throw new Error(`Cannot remove built-in agent: ${id}`);
    if (!this._agents[id]) throw new Error(`Unknown subagent: ${id}`);
    delete this._agents[id];
    delete this._state[id];
    this.clearHistory(id);
    this._save();
    this.emit('removed', id);
  }

  /** Set AI module reference */
  setAI(ai) {
    this.ai = ai;
  }
}

// Singleton
let _instance = null;
function getInstance(opts) {
  if (!_instance) _instance = new SubagentManager(opts);
  return _instance;
}

module.exports = { SubagentManager, getInstance };
