/**
 * ARIES v5.0 Ã¢â‚¬â€ AI Core with Multi-Model Fallback
 * 
 * Fallback chain: Aries Gateway Ã¢â€ â€™ Direct API Ã¢â€ â€™ Ollama
 * Features: SSE streaming, chunked streaming, tool parsing & execution loop,
 * plugin tool support, model selection per-task.
 */

const http = require('http');
const https = require('https');
const tools = require('./tools');
const memory = require('./memory');
const pluginLoader = require('./plugin-loader');

// Load config Ã¢â‚¬â€ support both new and legacy
let config;
try {
  const cfgMod = require('./config');
  config = cfgMod.load ? cfgMod.load() : cfgMod;
} catch {
  try { config = require('../config.json'); } catch { config = {}; }
}

// Cache config ref Ã¢â‚¬â€ hot-reload updates the _data object in place
let _cfgMod = null;
let _activeModel = null; // Track active model so AriesCode/tools use the same model
function getConfig() {
  if (!_cfgMod) { try { _cfgMod = require('./config'); } catch {} }
  if (_cfgMod && _cfgMod._data && Object.keys(_cfgMod._data).length > 0) return _cfgMod._data;
  return config;
}

// Cache system prompt Ã¢â‚¬â€ rebuild only every 30 seconds
let _cachedSystemPrompt = '';
let _systemPromptBuiltAt = 0;
const SYSTEM_PROMPT_TTL = 30000;

function buildSystemPrompt(options = {}) {
  const now = Date.now();
  if (!options.force && _cachedSystemPrompt && (now - _systemPromptBuiltAt) < SYSTEM_PROMPT_TTL) return _cachedSystemPrompt;
  
  const cfg = getConfig();
  const pluginTools = pluginLoader.getToolDescriptions();
  
  _systemPromptBuiltAt = now;
  _cachedSystemPrompt = `You are ARIES Ã¢â‚¬â€ a sharp, autonomous AI assistant and elite software engineer. Bold, direct, no fluff. You answer to ${cfg.user?.name || 'User'}.

Time: ${new Date().toLocaleString('en-US', {timeZone:'America/Chicago'})} CT | OS: Windows 10 (PowerShell) | Workspace: D:\\aries-workspace

## Core Behavior — AGENTIC LOOP + ARIES CODE
You have Aries Code built-in. For ANY coding task that involves building a project or multiple files, USE <tool:ariesCode> instead of writing files one by one. It handles the entire workflow autonomously: planning, scaffolding, implementing, testing, and fixing. Think of it like Claude Code — you delegate the coding work and it comes back done.

For simple single-file edits, use <tool:edit> or <tool:write> directly. For anything bigger, use Aries Code.

1. **Plan first** Ã¢â‚¬â€ break complex tasks into steps mentally before starting.
2. **Execute fully** Ã¢â‚¬â€ use tools in sequence until the ENTIRE task is complete. Do NOT stop halfway.
3. **Verify your work** Ã¢â‚¬â€ after writing code, read it back. After creating files, check they exist. After starting servers, test them.
4. **Keep going** Ã¢â‚¬â€ if a tool call fails, diagnose and fix it. Don't give up or ask the user to do it.
5. **Complete projects end-to-end** Ã¢â‚¬â€ if asked to build something, build ALL of it: files, config, dependencies, testing. Don't leave half-done work.
6. **Use multiple tool calls per response** Ã¢â‚¬â€ you can call many tools in one turn. Do it.

## Rules
1. Tool tags are invisible to user Ã¢â‚¬â€ NEVER show them in your text response.
2. Act first, summarize after. Keep responses SHORT Ã¢â‚¬â€ 2-3 sentences for summaries, don't dump code/output unless asked.
3. Use shellBg for servers/long-running processes, shell for quick commands.
4. NEVER run taskkill /IM node.exe or Stop-Process -Name node Ã¢â‚¬â€ this kills you AND OpenClaw. To kill a specific project's node process, use taskkill /PID <pid> /F (the system will block you from killing runtime PIDs).
5. NEVER call /api/shutdown Ã¢â‚¬â€ you cannot shut yourself down.
6. When using tools, execute them efficiently. Chain tool calls to complete the full task.
7. If you need to install dependencies, do it. If you need to create directories, do it. Don't ask Ã¢â‚¬â€ just do.
7. If you need to install dependencies, do it. If you need to create directories, do it. Just do.
8. When building projects: write ONE FILE PER TOOL CALL. Do NOT try to write all files in one response. Write file 1, then file 2, then file 3, etc. Each <tool:write> should contain ONE complete file. This prevents hitting output limits.
10. If a tool fails, diagnose the error, fix it, and retry. Do not give up.

## Common Mistakes to Avoid
- Use 127.0.0.1 NOT localhost (localhost resolves to IPv6 on Windows and breaks)
- In <tool:edit>, the old="..." attribute breaks if old text contains quotes. Use block format instead (see below).
- Match whitespace EXACTLY when editing files. Read the file first if unsure.
- To kill a project's dev server: find its PID first (netstat or bg-list), then kill that specific PID.
- Don't stop mid-task. If you hit an error, fix it and keep going. FINISH THE JOB.

## Tools

### Files
<tool:read>path</tool:read> Ã¢â‚¬â€ Read file
<tool:write path="path">content</tool:write> Ã¢â‚¬â€ Write file
<tool:edit path="path" old="old text">new text</tool:edit> Ã¢â‚¬â€ Edit file (simple, no quotes in old text)
<tool:edit path="path">
---OLD---
old text (any content, including quotes)
---NEW---
new text
</tool:edit> Ã¢â‚¬â€ Edit file (block format, preferred for complex edits)
<tool:append path="path">content</tool:append> Ã¢â‚¬â€ Append to file
<tool:delete>path</tool:delete> Ã¢â‚¬â€ Delete file
<tool:ls>dir</tool:ls> Ã¢â‚¬â€ List directory
<tool:search dir="dir" pattern="regex">glob</tool:search> Ã¢â‚¬â€ Search in files
<tool:grep pattern="regex" dir=".">glob</tool:grep> Ã¢â‚¬â€ Grep files
<tool:diff>path</tool:diff> Ã¢â‚¬â€ Git diff

### Shell & Process
<tool:shell>command</tool:shell> Ã¢â‚¬â€ Run command (quick, blocks until done)
<tool:shellBg>command</tool:shellBg> Ã¢â‚¬â€ Run in background (servers, watchers)
<tool:bg-check>pid</tool:bg-check> Ã¢â‚¬â€ Check background process
<tool:bg-kill>pid</tool:bg-kill> Ã¢â‚¬â€ Kill background process
<tool:bg-list></tool:bg-list> Ã¢â‚¬â€ List background processes
<tool:launch>app</tool:launch> Ã¢â‚¬â€ Launch application
<tool:kill>process_or_pid</tool:kill> Ã¢â‚¬â€ Kill process
<tool:process>list</tool:process> Ã¢â‚¬â€ List processes
<tool:install>package</tool:install> Ã¢â‚¬â€ Install npm package

### Web & Network
<tool:web>url</tool:web> Ã¢â‚¬â€ Fetch URL content
<tool:websearch>query</tool:websearch> Ã¢â‚¬â€ Web search
<tool:http method="GET" url="url" headers='{"k":"v"}'>body</tool:http> Ã¢â‚¬â€ HTTP request
<tool:download url="url">save_path</tool:download> Ã¢â‚¬â€ Download file
<tool:netscan>192.168.1</tool:netscan> Ã¢â‚¬â€ Network scan

### Browser (extension)
<tool:browse>url</tool:browse> Ã¢â‚¬â€ Navigate & get page text
<tool:ext cmd="navigate">url</tool:ext> Ã¢â‚¬â€ Navigate tab
<tool:ext cmd="snapshot"></tool:ext> Ã¢â‚¬â€ Get page content
<tool:ext cmd="screenshot"></tool:ext> Ã¢â‚¬â€ Screenshot page
<tool:ext cmd="getTabs"></tool:ext> Ã¢â‚¬â€ List tabs
<tool:ext cmd="click">selector</tool:ext> Ã¢â‚¬â€ Click element
<tool:ext cmd="type" selector="sel">text</tool:ext> Ã¢â‚¬â€ Type text
<tool:ext cmd="evaluate">js_code</tool:ext> Ã¢â‚¬â€ Run JS in page

### System & Utility
<tool:screenshot>filename</tool:screenshot> Ã¢â‚¬â€ Desktop screenshot
<tool:open>url_or_file</tool:open> Ã¢â‚¬â€ Open in default app
<tool:clipboard>text</tool:clipboard> Ã¢â‚¬â€ Copy to clipboard
<tool:notify>message</tool:notify> Ã¢â‚¬â€ Windows notification
<tool:sysinfo></tool:sysinfo> Ã¢â‚¬â€ System info
<tool:env>VAR_NAME</tool:env> Ã¢â‚¬â€ Read env variable
<tool:crypto action="hash">data</tool:crypto> Ã¢â‚¬â€ Crypto (hash/uuid/random/base64)
<tool:sandbox lang="node">code</tool:sandbox> Ã¢â‚¬â€ Run code in sandbox
<tool:evaluate>js_code</tool:evaluate> Ã¢â‚¬â€ Run JS
<tool:tts>text</tool:tts> Ã¢â‚¬â€ Text to speech
<tool:git>command</tool:git> Ã¢â‚¬â€ Git operations

### Memory
<tool:memory>info</tool:memory> — Save to memory
<tool:done>summary</tool:done> — Signal task COMPLETE (REQUIRED to finish multi-step work) Ã¢â‚¬â€ Save to memory
<tool:memorySearch>query</tool:memorySearch> Ã¢â‚¬â€ Search memory

### Projects & Apps
<tool:serve>directory</tool:serve> Ã¢â‚¬â€ Serve static files
<tool:canvas file="name.html">html_content</tool:canvas> Ã¢â‚¬â€ Create canvas page
<tool:webapp name="myapp">html</tool:webapp> Ã¢â‚¬â€ Create web app at /canvas/
<tool:message to="target">text</tool:message> Ã¢â‚¬â€ Send message

### Browser Agent (Ref-Based)
<tool:browser-snapshot>url</tool:browser-snapshot> — Snapshot page, get interactive elements with @e1, @e2 refs
<tool:browser-click>@e1</tool:browser-click> — Click element by ref
<tool:browser-fill ref="@e2">text</tool:browser-fill> — Fill input by ref
<tool:browser-get>text @e1</tool:browser-get> — Get element text/attribute by ref

Browser Agent workflow: 1) Snapshot a URL to get refs, 2) Use refs to interact. No CSS selectors needed.

### Knowledge Graph
<tool:kg-create type="Person">{"name":"Alice"}</tool:kg-create> — Create entity
<tool:kg-query type="Task">{"status":"open"}</tool:kg-query> — Query entities
<tool:kg-relate from="id1" rel="has_task" to="id2"></tool:kg-relate> — Create relation
<tool:kg-search>query text</tool:kg-search> — Search knowledge graph
<tool:kg-stats></tool:kg-stats> — Knowledge graph stats

### Code Review
<tool:code-review>file1.js,file2.js</tool:code-review> — Static analysis (security, performance, maintainability)

### Context Management
<tool:compress-context></tool:compress-context> — Compress conversation context when it gets large

### Agents
<tool:swarm>task</tool:swarm> Ã¢â‚¬â€ Multi-agent swarm
<tool:spawn-agent task="description">subtask</tool:spawn-agent> Ã¢â‚¬â€ Spawn sub-agent
<tool:check-agent>jobId</tool:check-agent> Ã¢â‚¬â€ Check sub-agent
<tool:wait-agents></tool:wait-agents> Ã¢â‚¬â€ Wait for all sub-agents

### Vision
<tool:vision prompt="describe this">path_or_url</tool:vision> Ã¢â‚¬â€ Analyze image
<tool:imageAnalysis>path</tool:imageAnalysis> Ã¢â‚¬â€ Analyze image

### Scheduling
<tool:cron expr="*/5 * * * *" name="jobname">command</tool:cron> Ã¢â‚¬â€ Cron job

### Self-Improvement & Proactive
<tool:log-learning category="correction">details</tool:log-learning> — Log a learning (categories: correction, knowledge_gap, best_practice, preference)
<tool:log-error>details</tool:log-error> — Log an error for pattern tracking
<tool:log-feature>details</tool:log-feature> — Log a feature request
<tool:search-learnings>query</tool:search-learnings> — Search across all learnings/errors/features
<tool:save-state>JSON state</tool:save-state> — Save key-value state (WAL protocol)
<tool:load-state></tool:load-state> — Load current session state

## Self-Improvement Protocol
When you encounter:
- A command/operation failure → use <tool:log-error> to record it
- A user correction ("actually...", "no, that's wrong...") → use <tool:log-learning category="correction"> to record it
- A feature request ("can you...", "I wish...") → use <tool:log-feature> to record it
- A knowledge gap → use <tool:log-learning category="knowledge_gap"> to record it
- A better approach → use <tool:log-learning category="best_practice"> to record it
Before major tasks, check recent learnings: <tool:search-learnings>relevant query</tool:search-learnings>

## Proactive Protocol
- WAL: When user gives corrections, decisions, or preferences — WRITE to session state BEFORE responding
- Resourcefulness: Try at least 5 different approaches before saying you can't do something
- Verify Before Done: Actually test/verify outcomes before reporting completion
- Proactive Surprise: Occasionally suggest improvements the user didn't ask for
- Pattern Detection: Notice repeated requests and suggest automation

### Aries Code (Autonomous Coding Agent)
<tool:ariesCode dir="optional/path">detailed task description</tool:ariesCode> — Delegate a complex coding task to the Aries Code engine. It autonomously plans, writes files, runs commands, fixes errors, and verifies — up to 20 iterations. USE THIS for building entire projects, complex multi-file work, or any build-me-X request. Preferred over manual file-by-file writes for big tasks.

### Subagents (Persistent AI Assistants)
<tool:subagent agent="codex">task description</tool:subagent> — Delegate a task to a named subagent. Each subagent has its own model, system prompt, and persistent conversation history. For coding tasks, prefer delegating to Codex.
<tool:subagent-list /> — List all available subagents and their status.
<tool:subagent-history agent="name" /> — View recent conversation history for a subagent.
When spawning subagent tasks, be specific:
BAD: "Research vector databases"
GOOD: "Compare Pinecone, Weaviate, and Qdrant. For each: pricing, free tier limits, Node.js SDK quality, self-hosting option. Output as a comparison table. Max 200 words."

When context gets large, use <tool:compress-context></tool:compress-context> to save a summary and keep working efficiently.

Available subagents: Codex (⌨️ coding expert, model: gpt-4.1).
${pluginTools ? '\n' + pluginTools : ''}

## Memory Bank (${memory.list().length} entries)
${memory.list().slice(-15).map(m => `- [${m.priority||'normal'}/${m.category||'general'}] ${m.text}`).join('\n') || '(empty)'}`;
  return _cachedSystemPrompt;
}

function parseTools(text) {
  const toolCalls = [];
  
  // Helper: normalize quotes in attribute patterns (support both single and double quotes)
  const q = `["']`; // quote char class
  const qc = `[^"']`; // non-quote content

  const patterns = [
    { name: 'done', regex: /<tool:done>([\s\S]*?)<\/tool:done>/g },
    { name: 'shell', regex: /<tool:shell>([\s\S]*?)<\/tool:shell>/g },
    { name: 'shellBg', regex: /<tool:shellBg>([\s\S]*?)<\/tool:shellBg>/g },
    { name: 'launch', regex: /<tool:launch>([\s\S]*?)<\/tool:launch>/g },
    { name: 'kill', regex: /<tool:kill>([\s\S]*?)<\/tool:kill>/g },
    { name: 'read', regex: /<tool:read>([\s\S]*?)<\/tool:read>/g },
    { name: 'write', regex: /<tool:write\s+path=["']([^"']*?)["']>([\s\S]*?)<\/tool:write>/g, hasAttr: true },
    { name: 'append', regex: /<tool:append\s+path=["']([^"']*?)["']>([\s\S]*?)<\/tool:append>/g, hasAttr: true },
    { name: 'web', regex: /<tool:web>([\s\S]*?)<\/tool:web>/g },
    { name: 'download', regex: /<tool:download\s+url=["']([^"']*?)["']>([\s\S]*?)<\/tool:download>/g, hasAttr: true },
    { name: 'clipboard', regex: /<tool:clipboard>([\s\S]*?)<\/tool:clipboard>/g },
    { name: 'memory', regex: /<tool:memory>([\s\S]*?)<\/tool:memory>/g },
    { name: 'open', regex: /<tool:open>([\s\S]*?)<\/tool:open>/g },
    { name: 'notify', regex: /<tool:notify>([\s\S]*?)<\/tool:notify>/g },
    { name: 'sysinfo', regex: /<tool:sysinfo><\/tool:sysinfo>/g, noContent: true },
    { name: 'sysinfo', regex: /<tool:sysinfo\s*\/>/g, noContent: true },
    { name: 'install', regex: /<tool:install>([\s\S]*?)<\/tool:install>/g },
    // Edit: block format with ---OLD--- / ---NEW--- delimiters (preferred, handles quotes)
    { name: 'edit', regex: /<tool:edit\s+path=["']([^"']*?)["']>\s*\n?---OLD---\n([\s\S]*?)\n---NEW---\n([\s\S]*?)<\/tool:edit>/g, hasTriple: true },
    // Edit: attribute format (legacy, simple cases only)
    { name: 'edit', regex: /<tool:edit\s+path=["']([^"']*?)["']\s+old=["']([^"']*?)["']>([\s\S]*?)<\/tool:edit>/g, hasTriple: true },
    { name: 'delete', regex: /<tool:delete>([\s\S]*?)<\/tool:delete>/g },
    { name: 'ls', regex: /<tool:ls>([\s\S]*?)<\/tool:ls>/g },
    { name: 'search', regex: /<tool:search\s+dir=["']([^"']*?)["']\s+pattern=["']([^"']*?)["']>([\s\S]*?)<\/tool:search>/g, hasTriple: true },
    { name: 'process', regex: /<tool:process>([\s\S]*?)<\/tool:process>/g },
    { name: 'swarm', regex: /<tool:swarm>([\s\S]*?)<\/tool:swarm>/g },
    { name: 'browse', regex: /<tool:browse>([\s\S]*?)<\/tool:browse>/g },
    { name: 'click', regex: /<tool:click>([\s\S]*?)<\/tool:click>/g },
    { name: 'type', regex: /<tool:type\s+selector=["']([^"']*?)["']>([\s\S]*?)<\/tool:type>/g, hasAttr: true },
    { name: 'screenshot', regex: /<tool:screenshot>([\s\S]*?)<\/tool:screenshot>/g },
    { name: 'evaluate', regex: /<tool:evaluate>([\s\S]*?)<\/tool:evaluate>/g },
    { name: 'desktopScreenshot', regex: /<tool:desktopScreenshot>([\s\S]*?)<\/tool:desktopScreenshot>/g },
    { name: 'tts', regex: /<tool:tts>([\s\S]*?)<\/tool:tts>/g },
    { name: 'cron', regex: /<tool:cron\s+expr=["']([^"']*?)["']>([\s\S]*?)<\/tool:cron>/g, hasAttr: true },
    { name: 'git', regex: /<tool:git>([\s\S]*?)<\/tool:git>/g },
    { name: 'netscan', regex: /<tool:netscan>([\s\S]*?)<\/tool:netscan>/g },
    { name: 'imageAnalysis', regex: /<tool:imageAnalysis>([\s\S]*?)<\/tool:imageAnalysis>/g },
    { name: 'spawn', regex: /<tool:spawn>([\s\S]*?)<\/tool:spawn>/g },
    { name: 'crypto', regex: /<tool:crypto\s+action=["']([^"']*?)["']>([\s\S]*?)<\/tool:crypto>/g, hasAttr: true },
    { name: 'serve', regex: /<tool:serve>([\s\S]*?)<\/tool:serve>/g },
    { name: 'canvas', regex: /<tool:canvas\s+file=["']([^"']*?)["']>([\s\S]*?)<\/tool:canvas>/g, hasAttr: true },
    { name: 'sandbox', regex: /<tool:sandbox(?:\s+lang=["']([^"']*?)["'])?>([\s\S]*?)<\/tool:sandbox>/g, hasAttr: true },
    { name: 'memorySearch', regex: /<tool:memorySearch>([\s\S]*?)<\/tool:memorySearch>/g },
    { name: 'message', regex: /<tool:message\s+to=["']([^"']*?)["']>([\s\S]*?)<\/tool:message>/g, hasAttr: true },
    { name: 'webapp', regex: /<tool:webapp\s+name=["']([^"']*?)["']>([\s\S]*?)<\/tool:webapp>/g, hasAttr: true },
    { name: 'websearch', regex: /<tool:websearch>([\s\S]*?)<\/tool:websearch>/g },
    { name: 'spawn-agent', regex: /<tool:spawn-agent\s+task=["']([^"']*?)["']>([\s\S]*?)<\/tool:spawn-agent>/g, hasAttr: true },
    { name: 'check-agent', regex: /<tool:check-agent>([\s\S]*?)<\/tool:check-agent>/g },
    { name: 'wait-agents', regex: /<tool:wait-agents><\/tool:wait-agents>/g, noContent: true },
    { name: 'wait-agents', regex: /<tool:wait-agents\s*\/>/g, noContent: true },
    { name: 'bg-run', regex: /<tool:bg-run>([\s\S]*?)<\/tool:bg-run>/g },
    { name: 'bg-check', regex: /<tool:bg-check>([\s\S]*?)<\/tool:bg-check>/g },
    { name: 'bg-kill', regex: /<tool:bg-kill>([\s\S]*?)<\/tool:bg-kill>/g },
    { name: 'bg-list', regex: /<tool:bg-list><\/tool:bg-list>/g, noContent: true },
    { name: 'bg-list', regex: /<tool:bg-list\s*\/>/g, noContent: true },
    { name: 'browse-navigate', regex: /<tool:browse-navigate>([\s\S]*?)<\/tool:browse-navigate>/g },
    { name: 'browse-click', regex: /<tool:browse-click>([\s\S]*?)<\/tool:browse-click>/g },
    { name: 'browse-type', regex: /<tool:browse-type\s+selector=["']([^"']*?)["']>([\s\S]*?)<\/tool:browse-type>/g, hasAttr: true },
    { name: 'browse-screenshot', regex: /<tool:browse-screenshot>([\s\S]*?)<\/tool:browse-screenshot>/g },
    { name: 'browse-evaluate', regex: /<tool:browse-evaluate>([\s\S]*?)<\/tool:browse-evaluate>/g },
    { name: 'vision', regex: /<tool:vision(?:\s+prompt=["']([^"']*?)["'])?>([\s\S]*?)<\/tool:vision>/g, hasAttr: true },
    { name: 'diff', regex: /<tool:diff>([\s\S]*?)<\/tool:diff>/g },
    { name: 'grep', regex: /<tool:grep\s+pattern=["']([^"']*?)["'](?:\s+dir=["']([^"']*?)["'])?>([\s\S]*?)<\/tool:grep>/g, hasTriple: true },
    { name: 'httpRequest', regex: /<tool:http\s+method=["']([^"']*?)["']\s+url=["']([^"']*?)["'](?:\s+headers='([^']*)')?>([\s\S]*?)<\/tool:http>/g, hasQuad: true },
    { name: 'env', regex: /<tool:env>([\s\S]*?)<\/tool:env>/g },
    { name: 'ext', regex: /<tool:ext\s+cmd=["']([^"']*?)["'](?:\s+selector=["']([^"']*?)["'])?>([\s\S]*?)<\/tool:ext>/g, hasTriple: true },
    { name: 'ext', regex: /<tool:ext\s+cmd=["']([^"']*?)["']>([\s\S]*?)<\/tool:ext>/g, hasAttr: true },
    { name: 'ext', regex: /<tool:ext\s+cmd=["']([^"']*?)["']\/>/g },
    { name: 'ext', regex: /<tool:ext\s+cmd=["']([^"']*?)["']><\/tool:ext>/g },
    { name: 'cronNamed', regex: /<tool:cron\s+expr=["']([^"']*?)["']\s+name=["']([^"']*?)["']>([\s\S]*?)<\/tool:cron>/g, hasTriple: true },
    { name: 'ariesCode', regex: /<tool:ariesCode(?:\s+dir=["']([^"']*?)["'])?>([\s\S]*?)<\/tool:ariesCode>/g, hasAttr: true },
    { name: 'subagent', regex: /<tool:subagent\s+agent=["']([^"']*?)["']>([\s\S]*?)<\/tool:subagent>/g, hasAttr: true },
    { name: 'subagent-history', regex: /<tool:subagent-history\s+agent=["']([^"']*?)["']>([\s\S]*?)<\/tool:subagent-history>/g, hasAttr: true },
    { name: 'subagent-history', regex: /<tool:subagent-history\s+agent=["']([^"']*?)["']\s*\/>/g },
    { name: 'subagent-history', regex: /<tool:subagent-history\s+agent=["']([^"']*?)["']><\/tool:subagent-history>/g },
    { name: 'subagent-list', regex: /<tool:subagent-list><\/tool:subagent-list>/g, noContent: true },
    { name: 'subagent-list', regex: /<tool:subagent-list\s*\/>/g, noContent: true },
    // Self-Improvement & Proactive tools
    { name: 'log-learning', regex: /<tool:log-learning(?:\s+category=["']([^"']*?)["'])?>([\s\S]*?)<\/tool:log-learning>/g, hasAttr: true },
    { name: 'log-error', regex: /<tool:log-error>([\s\S]*?)<\/tool:log-error>/g },
    { name: 'log-feature', regex: /<tool:log-feature>([\s\S]*?)<\/tool:log-feature>/g },
    { name: 'search-learnings', regex: /<tool:search-learnings>([\s\S]*?)<\/tool:search-learnings>/g },
    { name: 'save-state', regex: /<tool:save-state>([\s\S]*?)<\/tool:save-state>/g },
    { name: 'load-state', regex: /<tool:load-state><\/tool:load-state>/g, noContent: true },
    { name: 'load-state', regex: /<tool:load-state\s*\/>/g, noContent: true },
    // Browser Agent tools
    { name: 'browser-snapshot', regex: /<tool:browser-snapshot>([\s\S]*?)<\/tool:browser-snapshot>/g },
    { name: 'browser-click', regex: /<tool:browser-click>([\s\S]*?)<\/tool:browser-click>/g },
    { name: 'browser-fill', regex: /<tool:browser-fill\s+ref=["']([^"']*?)["']>([\s\S]*?)<\/tool:browser-fill>/g, hasAttr: true },
    { name: 'browser-get', regex: /<tool:browser-get>([\s\S]*?)<\/tool:browser-get>/g },
    // Knowledge Graph tools
    { name: 'kg-create', regex: /<tool:kg-create\s+type=["']([^"']*?)["']>([\s\S]*?)<\/tool:kg-create>/g, hasAttr: true },
    { name: 'kg-query', regex: /<tool:kg-query\s+type=["']([^"']*?)["']>([\s\S]*?)<\/tool:kg-query>/g, hasAttr: true },
    { name: 'kg-relate', regex: /<tool:kg-relate\s+from=["']([^"']*?)["']\s+rel=["']([^"']*?)["']\s+to=["']([^"']*?)["']>([\s\S]*?)<\/tool:kg-relate>/g, hasQuad: true },
    { name: 'kg-search', regex: /<tool:kg-search>([\s\S]*?)<\/tool:kg-search>/g },
    { name: 'kg-stats', regex: /<tool:kg-stats><\/tool:kg-stats>/g, noContent: true },
    { name: 'kg-stats', regex: /<tool:kg-stats\s*\/>/g, noContent: true },
    // Code Review
    { name: 'code-review', regex: /<tool:code-review>([\s\S]*?)<\/tool:code-review>/g },
    // Context Compression
    { name: 'compress-context', regex: /<tool:compress-context><\/tool:compress-context>/g, noContent: true },
    { name: 'compress-context', regex: /<tool:compress-context\s*\/>/g, noContent: true },
  ];

  const pluginRegex = /<tool:plugin_(\w+)>([\s\S]*?)<\/tool:plugin_\1>/g;
  let pm;
  while ((pm = pluginRegex.exec(text)) !== null) {
    toolCalls.push({ tool: 'plugin', args: [pm[1], pm[2]] });
  }

  // Track which parts of text were matched so we can detect unmatched tool tags
  const matchedRanges = [];

  for (const p of patterns) {
    let m;
    while ((m = p.regex.exec(text)) !== null) {
      matchedRanges.push([m.index, m.index + m[0].length]);
      if (p.noContent) toolCalls.push({ tool: p.name, args: [] });
      else if (p.hasQuad) toolCalls.push({ tool: p.name, args: [m[1], m[2], m[4], m[3]] });
      else if (p.hasTriple) toolCalls.push({ tool: p.name, args: [m[1], m[2], m[3]] });
      else if (p.hasAttr) toolCalls.push({ tool: p.name, args: [m[1], m[2]] });
      else toolCalls.push({ tool: p.name, args: [m[1]] });
    }
  }

  // Catch-all: detect any <tool:SOMETHING> tags that weren't matched by patterns
  const catchAll = /<tool:([a-zA-Z_-]+)[\s>]/g;
  let cm;
  while ((cm = catchAll.exec(text)) !== null) {
    const pos = cm.index;
    const wasMatched = matchedRanges.some(([s, e]) => pos >= s && pos < e);
    if (!wasMatched) {
      console.warn('[parseTools] Unrecognized tool tag: <tool:' + cm[1] + '> at position ' + pos + '. Check syntax.');
    }
  }

  return toolCalls;
}

function stripToolTags(text) {
  return text.replace(/<tool:[^>]*>[\s\S]*?<\/tool:[^>]*>/g, '').replace(/<tool:[^/]*\/>/g, '').trim();
}

async function executeTool(call) {
  if (call.tool === 'ariesCode') {
    try {
      const { AriesCode } = require('./aries-code');
      const codeModel = _activeModel || null;
      const acAi = { chat: async (msgs) => {
        const data = await callWithFallback(msgs, codeModel);
        return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
      }};
      const agent = new AriesCode(acAi, { maxIterations: 20 });
      const workDir = call.args[0] || require('path').join(__dirname, '..');
      const task = call.args[1] || call.args[0] || '';
      const result = await agent.run(task, workDir);
      return { success: result.success, output: 'Aries Code completed:\n' + result.summary + '\nFiles changed: ' + (result.files_changed || []).join(', ') + '\nCommands run: ' + (result.commands_run || []).length };
    } catch (e) { return { success: false, output: 'AriesCode error: ' + e.message }; }
  }
  if (call.tool === 'done') {
    return { success: true, output: '[TASK COMPLETE]', isDone: true };
  }
  if (call.tool === 'subagent') {
    try {
      const { getInstance } = require('./subagents');
      const mgr = getInstance();
      if (!mgr.ai) mgr.setAI({ callWithFallback, parseTools, stripToolTags });
      const agentId = call.args[0];
      const task = call.args[1];
      const result = await mgr.spawn(agentId, task);
      return { success: true, output: `[Subagent ${agentId}] ${result}` };
    } catch (e) { return { success: false, output: 'Subagent error: ' + e.message }; }
  }
  if (call.tool === 'subagent-list') {
    try {
      const { getInstance } = require('./subagents');
      const mgr = getInstance();
      const agents = mgr.list();
      const summary = agents.map(a => `${a.icon || '🤖'} ${a.name} (${a.id}) — model: ${a.model || 'default'}, tasks: ${a.taskCount || 0}, status: ${a.status || 'idle'}`).join('\n');
      return { success: true, output: summary || 'No subagents registered.' };
    } catch (e) { return { success: false, output: 'Error: ' + e.message }; }
  }
  if (call.tool === 'subagent-history') {
    try {
      const { getInstance } = require('./subagents');
      const mgr = getInstance();
      const agentId = call.args[0];
      const history = mgr.getHistory(agentId, 20);
      const summary = history.map(h => `[${h.role}] ${(h.content || '').substring(0, 200)}`).join('\n');
      return { success: true, output: summary || 'No history for this subagent.' };
    } catch (e) { return { success: false, output: 'Error: ' + e.message }; }
  }
  // Self-Improvement tools
  if (call.tool === 'log-learning') {
    try {
      const si = require('./self-improvement').getInstance();
      const category = call.args[0] || 'general';
      const details = call.args[1] || call.args[0] || '';
      return { success: true, output: JSON.stringify(si.logLearning({ category, summary: details.substring(0,100), details, area: category })) };
    } catch (e) { return { success: false, output: 'log-learning error: ' + e.message }; }
  }
  if (call.tool === 'log-error') {
    try {
      const si = require('./self-improvement').getInstance();
      const details = call.args[0] || '';
      return { success: true, output: JSON.stringify(si.logError({ error: details.substring(0,100), context: details })) };
    } catch (e) { return { success: false, output: 'log-error error: ' + e.message }; }
  }
  if (call.tool === 'log-feature') {
    try {
      const si = require('./self-improvement').getInstance();
      const details = call.args[0] || '';
      return { success: true, output: JSON.stringify(si.logFeature({ capability: details.substring(0,100), userContext: details })) };
    } catch (e) { return { success: false, output: 'log-feature error: ' + e.message }; }
  }
  if (call.tool === 'search-learnings') {
    try {
      const si = require('./self-improvement').getInstance();
      const results = si.search(call.args[0] || '');
      return { success: true, output: results.length ? results.map(r => `[${r.id}] ${r.summary} (${r.priority}/${r.status})`).join('\n') : 'No matching learnings found.' };
    } catch (e) { return { success: false, output: 'search-learnings error: ' + e.message }; }
  }
  if (call.tool === 'save-state') {
    try {
      const pe = require('./proactive-engine').getInstance();
      let state;
      try { state = JSON.parse(call.args[0]); } catch { state = { note: call.args[0] }; }
      return { success: true, output: JSON.stringify(pe.saveState(state)) };
    } catch (e) { return { success: false, output: 'save-state error: ' + e.message }; }
  }
  if (call.tool === 'load-state') {
    try {
      const pe = require('./proactive-engine').getInstance();
      const state = pe.loadState();
      return { success: true, output: JSON.stringify(state) };
    } catch (e) { return { success: false, output: 'load-state error: ' + e.message }; }
  }
  // Browser Agent tools
  if (call.tool === 'browser-snapshot') {
    try {
      const { getInstance } = require('./browser-agent');
      const agent = getInstance();
      const snap = await agent.snapshot(call.args[0]);
      return { success: true, output: agent.formatSnapshot(snap) };
    } catch (e) { return { success: false, output: 'Browser snapshot error: ' + e.message }; }
  }
  if (call.tool === 'browser-click') {
    try {
      const { getInstance } = require('./browser-agent');
      const result = await getInstance().click(call.args[0]?.trim());
      return { success: true, output: result };
    } catch (e) { return { success: false, output: 'Browser click error: ' + e.message }; }
  }
  if (call.tool === 'browser-fill') {
    try {
      const { getInstance } = require('./browser-agent');
      const result = await getInstance().fill(call.args[0]?.trim(), call.args[1]);
      return { success: true, output: result };
    } catch (e) { return { success: false, output: 'Browser fill error: ' + e.message }; }
  }
  if (call.tool === 'browser-get') {
    try {
      const { getInstance } = require('./browser-agent');
      const parts = (call.args[0] || '').trim().split(/\s+/);
      const cmd = parts[0]; // 'text' or attr name
      const ref = parts[1]; // @e1
      if (cmd === 'text') {
        const text = await getInstance().getText(ref);
        return { success: true, output: text || '(empty)' };
      } else {
        const val = await getInstance().getAttr(ref, cmd);
        return { success: true, output: val || '(null)' };
      }
    } catch (e) { return { success: false, output: 'Browser get error: ' + e.message }; }
  }
  // Knowledge Graph tools
  if (call.tool === 'kg-create') {
    try {
      const kg = require('./knowledge-graph').getInstance();
      let props = {}; try { props = JSON.parse(call.args[1] || '{}'); } catch {}
      const result = kg.create(call.args[0], props);
      return { success: true, output: JSON.stringify(result) };
    } catch (e) { return { success: false, output: 'KG create error: ' + e.message }; }
  }
  if (call.tool === 'kg-query') {
    try {
      const kg = require('./knowledge-graph').getInstance();
      let where = {}; try { where = JSON.parse(call.args[1] || '{}'); } catch {}
      const results = kg.query(call.args[0], where);
      return { success: true, output: results.length ? JSON.stringify(results, null, 2) : 'No entities found.' };
    } catch (e) { return { success: false, output: 'KG query error: ' + e.message }; }
  }
  if (call.tool === 'kg-relate') {
    try {
      const kg = require('./knowledge-graph').getInstance();
      const result = kg.relate(call.args[0], call.args[1], call.args[2]);
      return { success: true, output: JSON.stringify(result) };
    } catch (e) { return { success: false, output: 'KG relate error: ' + e.message }; }
  }
  if (call.tool === 'kg-search') {
    try {
      const kg = require('./knowledge-graph').getInstance();
      const results = kg.search(call.args[0]);
      return { success: true, output: results.length ? JSON.stringify(results, null, 2) : 'No results found.' };
    } catch (e) { return { success: false, output: 'KG search error: ' + e.message }; }
  }
  if (call.tool === 'kg-stats') {
    try {
      const kg = require('./knowledge-graph').getInstance();
      return { success: true, output: JSON.stringify(kg.stats(), null, 2) };
    } catch (e) { return { success: false, output: 'KG stats error: ' + e.message }; }
  }
  // Code Review
  if (call.tool === 'code-review') {
    try {
      const cr = require('./code-review').getInstance();
      const files = (call.args[0] || '').split(',').map(f => f.trim()).filter(Boolean);
      const result = cr.review(files);
      return { success: true, output: result.summary };
    } catch (e) { return { success: false, output: 'Code review error: ' + e.message }; }
  }
  // Context Compression
  if (call.tool === 'compress-context') {
    try {
      const cm = require('./context-manager').getInstance();
      // Get current chat history from refs
      const chatHistory = _refs?.getChatHistory?.() || [];
      const summary = cm.compress(chatHistory);
      cm.saveCompression(summary);
      return { success: true, output: 'Context compressed and saved.\n' + summary };
    } catch (e) { return { success: false, output: 'Compress error: ' + e.message }; }
  }
  if (call.tool === 'plugin') return await pluginLoader.execute(call.args[0], call.args[1]);
  const fn = tools[call.tool];
  if (!fn) return { success: false, output: `Unknown tool: ${call.tool}` };
  try { return await fn.apply(tools, call.args); } catch (e) { return { success: false, output: e.message }; }
}

// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
// MULTI-MODEL FALLBACK CHAIN
// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â

/**
 * Try Aries gateway (primary)
 */
/**
 * HTTP POST helper using built-in modules
 */
function _httpPost(url, body, headers, timeout) {
  return new Promise((resolve, reject) => {
    const parsed = new (require('url').URL)(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
      timeout: timeout || 90000
    };
    const req = mod.request(opts, (res) => {
      resolve({ statusCode: res.statusCode, headers: res.headers, stream: res });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    req.write(body);
    req.end();
  });
}

/**
 * Read full response body from a stream
 */
function _readBody(stream) {
  return new Promise((resolve, reject) => {
    let data = '';
    stream.on('data', (c) => data += c);
    stream.on('end', () => resolve(data));
    stream.on('error', reject);
  });
}

async function callGateway(messages, model, stream = false) {
  const cfg = getConfig();
  const gatewayUrl = cfg.gateway?.url;
  const gatewayToken = cfg.gateway?.token;
  if (!gatewayUrl) throw new Error('No gateway URL configured');

  const postBody = JSON.stringify({ model: model || cfg.gateway.model, messages, max_tokens: 32000, temperature: cfg.gateway?.temperature || 0.1, stream });
  const resp = await _httpPost(gatewayUrl, postBody, {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + (gatewayToken || '')
  }, 600000);

  if (resp.statusCode >= 400) {
    const errBody = await _readBody(resp.stream);
    throw new Error('API error: HTTP ' + resp.statusCode + ' Ã¢â‚¬â€ ' + errBody.substring(0, 300));
  }

  // Return an object that mimics the interface ai.js expects
  if (stream) {
    return { body: resp.stream, ok: true };
  } else {
    const body = await _readBody(resp.stream);
    return { ok: true, json: async () => JSON.parse(body), text: async () => body };
  }
}

/**
 * Try direct Anthropic API (fallback 1)
 */
/**
 * Auto-detect auth type from key format
 */
function detectAuth(key) {
  if (!key) return null;
  if (key.startsWith('sk-ant-oat01-')) return { type: 'oauth', header: 'Authorization', value: 'Bearer ' + key, beta: 'oauth-2025-04-20' };
  if (key.startsWith('sk-ant-api03-') || key.startsWith('sk-ant-')) return { type: 'apikey', header: 'x-api-key', value: key };
  return { type: 'apikey', header: 'x-api-key', value: key };
}

function buildAnthropicHeaders(key) {
  const auth = detectAuth(key);
  const headers = { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' };
  if (auth && auth.type === 'oauth') {
    headers['Authorization'] = auth.value;
    headers['anthropic-beta'] = auth.beta;
  } else if (auth) {
    headers[auth.header] = auth.value;
  }
  return headers;
}

async function callDirectApi(messages, model) {
  const cfg = getConfig();
  const apiUrl = cfg.fallback?.directApi?.url || 'https://api.anthropic.com/v1/messages';
  const apiKey = cfg.anthropic?.apiKey || cfg.fallback?.directApi?.key || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('No direct API key configured');

  const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
  const anthropicMessages = messages.filter(m => m.role !== 'system');

  const bodyObj = {
    model: (model || cfg.fallback?.directApi?.model || 'claude-sonnet-4-20250514').replace('anthropic/', ''),
    messages: anthropicMessages,
    max_tokens: 32000,
    temperature: 0.1,
  };
  bodyObj.system = system;

  const postBody = JSON.stringify(bodyObj);
  const headers = buildAnthropicHeaders(apiKey);

  const resp = await _httpPost(apiUrl, postBody, headers, 90000);

  if (resp.statusCode >= 400) {
    const errBody = await _readBody(resp.stream);
    throw new Error('Direct API ' + resp.statusCode + ': ' + errBody.substring(0, 200));
  }
  const body = await _readBody(resp.stream);
  const data = JSON.parse(body);
  return { choices: [{ message: { content: data.content?.[0]?.text || '' } }] };
}

/**
 * Try Ollama (fallback 2)
 */
async function callOllama(messages, model) {
  const cfg = getConfig();
  const ollamaUrl = cfg.fallback?.ollama?.url || 'http://127.0.0.1:11434/api/chat';
  const ollamaModel = model || cfg.fallback?.ollama?.model || 'llama3';

  const postBody = JSON.stringify({ model: ollamaModel, messages, stream: false });
  const resp = await _httpPost(ollamaUrl, postBody, {
    'Content-Type': 'application/json'
  }, 120000);

  if (resp.statusCode >= 400) {
    const errBody = await _readBody(resp.stream);
    throw new Error('Ollama ' + resp.statusCode + ': ' + errBody.substring(0, 200));
  }
  const body = await _readBody(resp.stream);
  const data = JSON.parse(body);
  return { choices: [{ message: { content: data.message?.content || '' } }] };
}

/**
 * Try all backends in fallback order
 */
async function callWithFallback(messages, model, stream = false) {
  const cfg = getConfig();
  const errors = [];

  // Route google/ and gemini- models through Gemini provider
  if (model && (model.startsWith('google/') || model.startsWith('gemini-'))) {
    try {
      const { callGemini } = require('./gemini-provider');
      return await callGemini(messages, model, {});
    } catch (e) {
      errors.push('Gemini: ' + e.message);
      // Fall through to other providers
    }
  }

  // Detect if model is non-Anthropic (openai/, groq/, openrouter/, etc.)
  const isNonAnthropic = model && (model.startsWith('openai/') || model.startsWith('groq/') || model.startsWith('google/') || model.startsWith('mistral/') || model.startsWith('deepseek/') || model.startsWith('meta/'));

  // For non-Anthropic models, route through OpenRouter or direct OpenAI-compatible APIs
  if (isNonAnthropic) {
    // Try OpenRouter (supports all models with one key)
    const orKey = cfg.openrouter?.apiKey || process.env.OPENROUTER_API_KEY;
    if (orKey) {
      try {
        const postBody = JSON.stringify({ model, messages, max_tokens: 32000, temperature: 0.1 });
        const resp = await _httpPost('https://openrouter.ai/api/v1/chat/completions', postBody, {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + orKey,
          'HTTP-Referer': 'https://aries.local',
          'X-Title': 'Aries'
        }, 600000);
        if (resp.statusCode < 400) {
          const body = await _readBody(resp.stream);
          return JSON.parse(body);
        }
      } catch (e) {
        errors.push('OpenRouter: ' + e.message);
      }
    }

    // Try direct OpenAI API if model starts with openai/
    const oaiKey = cfg.openai?.apiKey || process.env.OPENAI_API_KEY;
    if (oaiKey && model.startsWith('openai/')) {
      try {
        const oaiModel = model.replace('openai/', '');
        const postBody = JSON.stringify({ model: oaiModel, messages, max_tokens: 32000, temperature: 0.1 });
        const resp = await _httpPost('https://api.openai.com/v1/chat/completions', postBody, {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + oaiKey
        }, 600000);
        if (resp.statusCode < 400) {
          const body = await _readBody(resp.stream);
          return JSON.parse(body);
        }
      } catch (e) {
        errors.push('OpenAI: ' + e.message);
      }
    }

    // Try Groq if model starts with groq/
    const groqKey = cfg.groq?.apiKey || process.env.GROQ_API_KEY;
    if (groqKey && model.startsWith('groq/')) {
      try {
        const groqModel = model.replace('groq/', '');
        const postBody = JSON.stringify({ model: groqModel, messages, max_tokens: 32000, temperature: 0.1 });
        const resp = await _httpPost('https://api.groq.com/openai/v1/chat/completions', postBody, {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + groqKey
        }, 600000);
        if (resp.statusCode < 400) {
          const body = await _readBody(resp.stream);
          return JSON.parse(body);
        }
      } catch (e) {
        errors.push('Groq: ' + e.message);
      }
    }
    // Fall through to Anthropic/Gateway/Ollama as last resort
  }

  // 1. Direct Anthropic API first (fastest, no gateway dependency)
  const hasDirectKey = cfg.anthropic?.apiKey || cfg.fallback?.directApi?.apiKey || cfg.fallback?.directApi?.key || process.env.ANTHROPIC_API_KEY;
  if (hasDirectKey) {
    try {
      return await callDirectApi(messages, model);
    } catch (e) {
      errors.push('Direct: ' + e.message);
    }
  }

  // 2. Aries Gateway
  try {
    const resp = await callGateway(messages, model, false);
    return await resp.json();
  } catch (e) {
    errors.push('Gateway: ' + e.message);
  }

  // 3. Ollama
  try {
    return await callOllama(messages, model);
  } catch (e) {
    errors.push('Ollama: ' + e.message);
  }

  throw new Error('All AI providers failed: ' + errors.join('; '));
}

// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
// CHAT FUNCTIONS
// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â

function formatToolResults(results) {
  const lines = ['Tool results:\n'];
  for (const r of results) {
    if (r.success) {
      lines.push(`## ${r.tool} Ã¢Å“â€œ`);
      lines.push(r.output || '(no output)');
    } else {
      lines.push(`## ${r.tool} Ã¢Å“â€”`);
      lines.push(`Error: ${r.output || 'unknown error'}`);
      // Add contextual hints for common failures
      if (r.tool === 'edit' && r.output && r.output.includes('not found')) {
        lines.push('Hint: Make sure whitespace matches exactly. Use <tool:read>path</tool:read> to check current content.');
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

async function chatStream(messages, onToken, onToolExec, opts) {
  const cfg = getConfig();
  const systemPrompt = buildSystemPrompt();
  const chatModel = (opts && opts.model) || cfg.models?.chat || cfg.gateway?.model;
  _activeModel = chatModel; // Expose to tool executors (AriesCode, subagents, etc.)

  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
  let memCtx = '';
  if (lastUserMsg) {
    const relevant = memory.getRelevant(lastUserMsg.content, 5);
    if (relevant.length > 0) memCtx = '\n\nRelevant memories:\n' + relevant.map(m => `- [${m.priority}] ${m.text}`).join('\n');
  }

  const apiMessages = [
    { role: 'system', content: systemPrompt + memCtx },
    ...messages
  ];

  let iterations = 0;
  let fullResponse = '';
  let _forcedContinues = 0;
  const MAX_FORCED_CONTINUES = 3;
  let _finishReason = null;

  while (iterations < (cfg.maxToolIterations || 25)) {
    iterations++;

    // Trim context to prevent token explosion Ã¢â‚¬â€ keep more context for complex tasks
    if (apiMessages.length > 40) {
      const system = apiMessages[0];
      const recent = apiMessages.slice(-36);
      apiMessages.length = 0;
      apiMessages.push(system, ...recent);
    }

    try {
      // Try streaming via gateway
      const resp = await callGateway(apiMessages, chatModel, true);

      let content = '';
      let buffer = '';
      let _usedModel = null;

      await new Promise((resolve, reject) => {
        resp.body.on('data', chunk => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop();
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.substring(6).trim();
              if (data === '[DONE]') { resolve(); return; }
              try {
                const parsed = JSON.parse(data);
                // Capture model metadata from gateway
                if (parsed._meta && parsed._usedModel) {
                  _usedModel = parsed._usedModel;
                  continue;
                }
                const delta = parsed.choices?.[0]?.delta?.content;
                if (parsed.choices?.[0]?.finish_reason) _finishReason = parsed.choices[0].finish_reason;
                if (delta) { content += delta; if (onToken) onToken(delta); }
              } catch {}
            }
          }
        });
        resp.body.on('end', resolve);
        resp.body.on('error', reject);
      });

      apiMessages.push({ role: 'assistant', content });
      const toolCalls = parseTools(content);

      if (toolCalls.length === 0) {
        fullResponse = content;
        // If this is first response (no tool loop yet), return immediately
        if (iterations <= 1) {
          return { response: fullResponse, iterations, usedModel: _usedModel };
        }
        // In a tool loop: only exit if AI used <tool:done> or we've forced too many continues
        if (_forcedContinues >= MAX_FORCED_CONTINUES) {
          return { response: fullResponse, iterations, usedModel: _usedModel };
        }
        _forcedContinues++;
        apiMessages.push({ role: 'user', content: '[SYSTEM] You stopped without using <tool:done>. The task is NOT complete. Continue using tools to finish the work. When fully done, use <tool:done>summary</tool:done>.' });
        continue;
      }

      const results = [];
      let _taskDone = false;
      for (const call of toolCalls) {
        if (call.tool === 'done') { _taskDone = true; fullResponse = stripToolTags(content); continue; }
        if (onToolExec) onToolExec(call);
        results.push({ tool: call.tool, args: call.args, ...(await executeTool(call)) });
      }
      if (results.length > 0) apiMessages.push({ role: 'user', content: formatToolResults(results) });
      fullResponse = stripToolTags(content);
      if (_taskDone) return { response: fullResponse, iterations, usedModel: _usedModel };
      // If response was truncated mid-tool-execution, continue
      if (_finishReason === 'length') {
        apiMessages.push({ role: 'user', content: '[SYSTEM] Your response was cut off mid-execution. Continue where you left off — write the next files.' });
        _finishReason = null;
        continue;
      }

    } catch (e) {
      // Fall back to non-streaming
      if (iterations === 1) return await chat(messages, onToolExec);
      throw e;
    }
  }

  // If we hit max iterations and the last response had tool calls, prompt continuation
  if (iterations >= (cfg.maxToolIterations || 25)) {
    const lastMsg = apiMessages[apiMessages.length - 1];
    if (lastMsg && lastMsg.role === 'user' && lastMsg.content && lastMsg.content.includes('Tool:')) {
      // Give it 10 more iterations to finish
      let extraIterations = 0;
      while (extraIterations < 10) {
        extraIterations++;
        apiMessages.push({ role: 'user', content: '[SYSTEM] You hit the tool iteration limit but the task is not complete. Continue working Ã¢â‚¬â€ finish the task. Do NOT stop or summarize early.' });
        try {
          const resp = await callGateway(apiMessages, (opts && opts.model) || cfg.models?.chat || cfg.gateway?.model, true);
          let content = '';
          let buffer = '';
          await new Promise((resolve, reject) => {
            resp.body.on('data', chunk => {
              buffer += chunk.toString();
              const lines = buffer.split('\n');
              buffer = lines.pop();
              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  const data = line.substring(6).trim();
                  if (data === '[DONE]') { resolve(); return; }
                  try { const p = JSON.parse(data); const d = p.choices?.[0]?.delta?.content; if (d) { content += d; if (onToken) onToken(d); } } catch {}
                }
              }
            });
            resp.body.on('end', resolve);
            resp.body.on('error', reject);
          });
          apiMessages.push({ role: 'assistant', content });
          const toolCalls = parseTools(content);
          if (toolCalls.length === 0) { fullResponse = content; break; }
          const results = [];
          for (const call of toolCalls) {
            if (onToolExec) onToolExec(call);
            results.push({ tool: call.tool, args: call.args, ...(await executeTool(call)) });
          }
          apiMessages.push({ role: 'user', content: formatToolResults(results) });
          fullResponse = stripToolTags(content);
        } catch { break; }
      }
    }
  }

  return { response: fullResponse, iterations };
}

/**
 * Chunked streaming Ã¢â‚¬â€ calls onChunk with each text fragment
 */
async function chatStreamChunked(messages, onChunk, opts) {
  let fullResponse = '';
  const result = await chatStream(messages, chunk => {
    fullResponse += chunk;
    if (onChunk) onChunk(chunk);
  }, null, opts);
  return { response: result.response || fullResponse, iterations: result.iterations, usedModel: result.usedModel };
}

async function chat(messages, onToolExec) {
  const cfg = getConfig();
  const systemPrompt = buildSystemPrompt();
  const chatModel = cfg.models?.chat || cfg.gateway?.model;
  _activeModel = chatModel;

  const apiMessages = [
    { role: 'system', content: systemPrompt },
    ...messages
  ];

  let iterations = 0;
  let fullResponse = '';
  let _forcedContinues2 = 0;

  while (iterations < (cfg.maxToolIterations || 25)) {
    iterations++;

    // Trim context to prevent token explosion Ã¢â‚¬â€ keep more context for complex tasks
    if (apiMessages.length > 40) {
      const system = apiMessages[0];
      const recent = apiMessages.slice(-36);
      apiMessages.length = 0;
      apiMessages.push(system, ...recent);
    }

    const data = await callWithFallback(apiMessages, chatModel);
    const content = data.choices?.[0]?.message?.content || '';
    apiMessages.push({ role: 'assistant', content });

    const toolCalls = parseTools(content);
    if (toolCalls.length === 0) { fullResponse = content; break; }

    const results = [];
    for (const call of toolCalls) {
      if (onToolExec) onToolExec(call);
      results.push({ tool: call.tool, args: call.args, ...(await executeTool(call)) });
    }

    apiMessages.push({ role: 'user', content: formatToolResults(results) });
    fullResponse = stripToolTags(content);
  }

  return { response: fullResponse, iterations };
}

/**
 * Select the best model for a task type
 */
function selectModel(taskType) {
  const cfg = getConfig();
  const models = cfg.models || {};
  const map = {
    chat: models.chat,
    coding: models.coding || models.chat,
    code: models.coding || models.chat,
    research: models.research || models.chat,
    analysis: models.research || models.chat,
    swarm_decompose: models.swarmDecompose || models.chat,
    swarm_worker: models.swarmWorker || models.research || models.chat,
    swarm_aggregate: models.swarmAggregate || models.chat,
  };
  return map[taskType] || models.chat || cfg.gateway?.model;
}

/**
 * Call swarm Ollama workers via relay
 */
async function callSwarmOllama(messages, model) {
  model = model || 'mistral';
  let relayUrl = 'http://127.0.0.1:9700', secret = '';
  try {
    const _cfg = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'config.json'), 'utf8'));
    relayUrl = (_cfg.relay && _cfg.relay.url) || relayUrl;
    secret = (_cfg.remoteWorkers && _cfg.remoteWorkers.secret) || (_cfg.relay && _cfg.relay.secret) || secret;
  } catch {};

  const taskBody = JSON.stringify({
    task: messages[messages.length - 1]?.content || '',
    model,
    messages
  });

  // Submit task
  const taskResult = await new Promise((resolve, reject) => {
    const req = http.request(relayUrl + '/api/task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Aries-Secret': secret }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('Relay parse error: ' + data)); } });
    });
    req.on('error', reject);
    req.write(taskBody);
    req.end();
  });

  const taskId = taskResult.taskId || taskResult.id;
  if (!taskId) throw new Error('No taskId from relay: ' + JSON.stringify(taskResult));

  // Poll for result
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1000));
    const result = await new Promise((resolve, reject) => {
      http.get(relayUrl + '/api/result/' + taskId, { headers: { 'X-Aries-Secret': secret } }, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('Poll parse error: ' + data)); } });
      }).on('error', reject);
    });

    if (result.status === 'complete' || result.result || result.response) {
      return {
        response: result.result || result.response || '',
        model: result.model || model,
        worker: result.worker || result.workerId || 'unknown',
        taskId
      };
    }
    if (result.status === 'error' || result.error) {
      throw new Error('Relay error: ' + (result.error || 'unknown'));
    }
  }
  throw new Error('Relay timeout after 120s');
}

// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
// AGENT LOOP Ã¢â‚¬â€ Iterative tool execution with streaming
// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â

/**
 * Stream AI response via direct Anthropic API (SSE).
 * Returns full response text. Calls onChunk for each text delta.
 */
async function streamAnthropicDirect(messages, model, onChunk) {
  const cfg = getConfig();
  const apiUrl = cfg.fallback?.directApi?.url || 'https://api.anthropic.com/v1/messages';
  const apiKey = cfg.anthropic?.apiKey || cfg.fallback?.directApi?.key || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('No API key for streaming');

  const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
  const anthropicMessages = messages.filter(m => m.role !== 'system');

  const bodyObj = {
    model: (model || cfg.fallback?.directApi?.model || 'claude-sonnet-4-20250514').replace('anthropic/', ''),
    messages: anthropicMessages,
    max_tokens: 32000,
    stream: true,
  };
  if (system) bodyObj.system = system;

  const postBody = JSON.stringify(bodyObj);
  const headers = buildAnthropicHeaders(apiKey);

  const resp = await _httpPost(apiUrl, postBody, headers, 120000);
  if (resp.statusCode >= 400) {
    const errBody = await _readBody(resp.stream);
    throw new Error('Anthropic stream ' + resp.statusCode + ': ' + errBody.substring(0, 200));
  }

  return new Promise((resolve, reject) => {
    let content = '';
    let buffer = '';
    resp.stream.on('data', chunk => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.substring(6).trim();
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
            content += parsed.delta.text;
            if (onChunk) onChunk(parsed.delta.text);
          }
          if (parsed.type === 'message_stop') { /* done */ }
        } catch {}
      }
    });
    resp.stream.on('end', () => resolve(content));
    resp.stream.on('error', reject);
  });
}

/**
 * Stream AI via gateway (SSE). Returns full response text.
 */
async function streamGateway(messages, model, onChunk) {
  const cfg = getConfig();
  const chatModel = model || cfg.models?.chat || cfg.gateway?.model;
  const resp = await callGateway(messages, chatModel, true);

  return new Promise((resolve, reject) => {
    let content = '';
    let buffer = '';
    resp.body.on('data', chunk => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.substring(6).trim();
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          if (parsed._meta) continue;
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) { content += delta; if (onChunk) onChunk(delta); }
        } catch {}
      }
    });
    resp.body.on('end', () => resolve(content));
    resp.body.on('error', reject);
  });
}

/**
 * Stream AI with fallback: gateway Ã¢â€ â€™ direct Anthropic
 */
async function streamWithFallback(messages, model, onChunk) {
  const cfg = getConfig();
  const hasKey = cfg.anthropic?.apiKey || cfg.fallback?.directApi?.apiKey || cfg.fallback?.directApi?.key || process.env.ANTHROPIC_API_KEY;
  
  // Try direct Anthropic API first (faster, no gateway dependency)
  if (hasKey) {
    try {
      return await streamAnthropicDirect(messages, model, onChunk);
    } catch (e) {
      console.error('[AI] Direct stream failed:', e.message);
    }
  }
  
  // Fallback to gateway
  try {
    return await streamGateway(messages, model, onChunk);
  } catch (e) {
    throw new Error('All streaming methods failed: ' + e.message);
  }
}

/**
 * Agent loop: iteratively call AI, parse tools, execute, feed results back.
 * 
 * @param {Array} messages - Full message array including system prompt
 * @param {string} model - Model to use
 * @param {Object} callbacks - { onChunk, onToolStart, onToolResult, onIterationDone }
 * @param {AbortSignal} signal - Optional abort signal
 * @returns {Object} { response, iterations }
 */
async function agentLoop(messages, model, callbacks, signal) {
  const MAX_ITERATIONS = 50;
  const { executeSingle } = require('./tools');
  const cb = callbacks || {};
  let lastResponse = '';

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    if (signal && signal.aborted) {
      return { response: lastResponse || 'Agent loop cancelled.', iterations: i };
    }

    // Trim context to prevent token explosion
    if (messages.length > 60) {
      const system = messages[0];
      const original = messages[1]; 
      const recent = messages.slice(-50);
      messages.length = 0;
      messages.push(system, original, ...recent);
    }

    // Stream AI response
    let response = '';
    try {
      response = await streamWithFallback(messages, model, cb.onChunk);
    } catch (e) {
      // If streaming fails completely, try non-streaming
      const data = await callWithFallback(messages, model);
      response = data.choices?.[0]?.message?.content || '';
      if (cb.onChunk) cb.onChunk(response);
    }

    lastResponse = response;

    // Parse tool calls
    const toolCalls = parseTools(response);
    if (toolCalls.length === 0) {
      // No tools = final answer
      if (cb.onIterationDone) cb.onIterationDone(i + 1, true);
      return { response: stripToolTags(response), iterations: i + 1 };
    }

    // Signal iteration boundary
    if (cb.onIterationDone) cb.onIterationDone(i + 1, false);

    // Execute tools one at a time
    let toolResultsText = '';
    for (const call of toolCalls) {
      if (signal && signal.aborted) break;
      const argsSummary = Array.isArray(call.args) ? call.args[0] || '' : String(call.args);
      if (cb.onToolStart) cb.onToolStart(call.tool, argsSummary);
      const result = await executeSingle(call.tool, call.args);
      if (cb.onToolResult) cb.onToolResult(call.tool, result);
      toolResultsText += `\n[${call.tool}] ${result}\n`;
    }

    // Add to messages and continue
    messages.push({ role: 'assistant', content: response });
    messages.push({ role: 'user', content: `Tool results:\n${toolResultsText}` });
  }

  return { response: stripToolTags(lastResponse) || 'Max iterations reached.', iterations: MAX_ITERATIONS };
}

// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
// PHASE 2: Sub-Agent Spawning
// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â

async function spawnSubAgent(task, agentId) {
  // Route through SubagentManager
  try {
    const { getInstance } = require('./subagents');
    const mgr = getInstance();
    if (!mgr.ai) mgr.setAI({ callWithFallback, parseTools, stripToolTags });
    const targetAgent = agentId || 'codex';
    if (mgr.getAgent(targetAgent)) {
      return await mgr.spawn(targetAgent, task);
    }
  } catch (e) {
    console.error('[spawnSubAgent] SubagentManager fallback:', e.message);
  }
  // Legacy fallback
  const cfg = getConfig();
  const messages = [
    { role: 'system', content: 'You are a sub-agent of Aries. Complete this task concisely.' },
    { role: 'user', content: task }
  ];
  const model = cfg.models?.chat || cfg.gateway?.model;
  const result = await agentLoop(messages, model, {}, null);
  return result.response;
}

// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
// PHASE 2: Image/Vision Analysis
// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â

async function analyzeImage(imagePath, prompt) {
  const cfg = getConfig();
  const apiKey = cfg.anthropic?.apiKey || cfg.fallback?.directApi?.key || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('No API key for vision');

  let base64Data, mediaType;

  if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
    // Fetch from URL
    const parsedUrl = new (require('url').URL)(imagePath);
    const httpMod = parsedUrl.protocol === 'https:' ? https : http;
    const data = await new Promise((resolve, reject) => {
      httpMod.get(parsedUrl, { timeout: 15000, rejectUnauthorized: false }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ buffer: Buffer.concat(chunks), contentType: res.headers['content-type'] }));
      }).on('error', reject);
    });
    base64Data = data.buffer.toString('base64');
    const ct = data.contentType || '';
    mediaType = ct.includes('png') ? 'image/png' : ct.includes('gif') ? 'image/gif' : ct.includes('webp') ? 'image/webp' : 'image/jpeg';
  } else {
    // Read from disk
    const fs = require('fs');
    if (!fs.existsSync(imagePath)) throw new Error('File not found: ' + imagePath);
    base64Data = fs.readFileSync(imagePath).toString('base64');
    const ext = require('path').extname(imagePath).toLowerCase();
    mediaType = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  }

  const bodyObj = {
    model: (cfg.fallback?.directApi?.model || 'claude-sonnet-4-20250514').replace('anthropic/', ''),
    max_tokens: 32000,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } },
        { type: 'text', text: prompt || 'Describe this image in detail.' }
      ]
    }]
  };

  const postBody = JSON.stringify(bodyObj);
  const headers = buildAnthropicHeaders(apiKey);
  const resp = await _httpPost('https://api.anthropic.com/v1/messages', postBody, headers, 60000);

  if (resp.statusCode >= 400) {
    const errBody = await _readBody(resp.stream);
    throw new Error('Vision API ' + resp.statusCode + ': ' + errBody.substring(0, 200));
  }

  const body = await _readBody(resp.stream);
  const data = JSON.parse(body);
  return data.content?.[0]?.text || '(no response)';
}



// ═══════════════════════════════════════════════════════════════
// NATIVE TOOL CALLING — Structured tool calls like OpenClaw
// ═══════════════════════════════════════════════════════════════

async function chatNativeTools(messages, onToken, onToolExec, opts) {
  const cfg = getConfig();
  const systemPrompt = buildSystemPrompt();
  const chatModel = (opts && opts.model) || cfg.models?.chat || cfg.gateway?.model;
  _activeModel = chatModel;
  
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
  let memCtx = '';
  if (lastUserMsg) {
    const relevant = memory.getRelevant(lastUserMsg.content, 5);
    if (relevant.length > 0) memCtx = '\n\nRelevant memories:\n' + relevant.map(m => '- [' + (m.priority || 'normal') + '] ' + m.text).join('\n');
  }

  const apiMessages = [
    { role: 'system', content: systemPrompt + memCtx },
    ...messages
  ];

  let iterations = 0;
  let fullResponse = '';
  let _usedModel = null;
  const MAX_ITERATIONS = cfg.maxToolIterations || 50;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    // Trim context if too long
    if (apiMessages.length > 50) {
      const system = apiMessages[0];
      const recent = apiMessages.slice(-46);
      apiMessages.length = 0;
      apiMessages.push(system, ...recent);
    }

    try {
      // Non-streaming call with native tools
      const resp = await callGateway(apiMessages, chatModel, false, true);
      let data;
      if (resp.json) {
        data = await resp.json();
      } else {
        const rawBody = await _readBody(resp.stream || resp);
        data = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
      }

      const choice = data.choices?.[0];
      if (!choice) {
        fullResponse = 'No response from AI';
        break;
      }

      const message = choice.message;
      const finishReason = choice.finish_reason;
      const content = message?.content || '';
      const toolCalls = message?.tool_calls || [];

      // Add assistant message to context
      if (toolCalls.length > 0) {
        // Format tool_calls back to OpenAI API format for context
        const apiToolCalls = toolCalls.map((tc, i) => ({
          id: tc.id || ('call_' + iterations + '_' + i),
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments }
        }));
        apiMessages.push({ role: 'assistant', content: content || null, tool_calls: apiToolCalls });
      } else {
        apiMessages.push({ role: 'assistant', content });
      }

      // If no tool calls — check why
      if (toolCalls.length === 0) {
        fullResponse = content;

        // CRITICAL: If finish_reason is "length", response was TRUNCATED
        if (finishReason === 'length') {
          apiMessages.push({ role: 'user', content: '[SYSTEM] Your response was cut off (token limit). Continue exactly where you left off.' });
          continue;
        }

        // If we were in a tool loop (iterations > 1), the AI should use done() to exit
        if (iterations > 1 && iterations < MAX_ITERATIONS - 3) {
          apiMessages.push({ role: 'user', content: '[SYSTEM] You stopped without calling the done() tool. If the task is complete, call done(summary). If not, keep working.' });
          continue;
        }

        break;
      }

      // Execute each tool call (tc has {id, name, arguments} from delta assembly)
      let taskDone = false;
      for (const tc of toolCalls) {
        const fnName = tc.function?.name || tc.name;
        let fnArgs = {};
        try { fnArgs = JSON.parse(tc.function?.arguments || tc.arguments || '{}'); } catch {}

        // Check for done signal
        if (fnName === 'done') {
          taskDone = true;
          fullResponse = content || fnArgs.summary || 'Task complete';
          // Still add tool result for protocol compliance
          apiMessages.push({ role: 'tool', tool_call_id: tc.id, content: '[TASK COMPLETE] ' + (fnArgs.summary || '') });
          continue;
        }

        if (onToolExec) onToolExec({ tool: fnName, args: fnArgs });

        // Map to Aries tools.js format and execute
        const toolsModule = require(path.join(__dirname, 'tools'));
        const mappedName = mapToolName(fnName);
        const mappedArgs = mapToolCallToArgs(fnName, fnArgs);
        
        let result;
        if (toolsModule[mappedName]) {
          try {
            result = await toolsModule[mappedName].apply(toolsModule, mappedArgs);
          } catch (e) {
            result = { success: false, output: e.message };
          }
        } else {
          result = { success: false, output: 'Unknown tool: ' + fnName };
        }

        const output = typeof result === 'object' ? (result.output || JSON.stringify(result)) : String(result);
        
        // Send tool result back as structured message
        apiMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: output.substring(0, 50000) // cap tool output
        });
      }

      if (taskDone) break;
      fullResponse = content;

      // If truncated mid-tool-execution, continue
      if (finishReason === 'length') {
        apiMessages.push({ role: 'user', content: '[SYSTEM] Response truncated. Continue working.' });
        continue;
      }

    } catch (e) {
      // If native tools fail, fall back to XML-based chat
      console.error('[NATIVE-TOOLS] Error:', e.message, '— falling back to XML chat');
      if (iterations === 1) {
        return await chatStream(messages, onToken, onToolExec, opts);
      }
      // Mid-loop error: try to continue
      apiMessages.push({ role: 'user', content: '[SYSTEM] Error occurred: ' + e.message + '. Continue working.' });
      continue;
    }
  }

  return { response: fullResponse, iterations, usedModel: _usedModel };
}



// ── Usage Tracking ──
const _usageLogPath = require('path').join(__dirname, '..', 'data', 'usage.json');
const _MODEL_COSTS = { 'claude-sonnet-4-20250514': { in: 3, out: 15 }, 'claude-3-5-sonnet': { in: 3, out: 15 }, 'claude-3-haiku': { in: 0.25, out: 1.25 }, 'gpt-4o': { in: 2.5, out: 10 }, 'gpt-4.1': { in: 2, out: 8 }, 'llama3': { in: 0, out: 0 }, 'mistral': { in: 0, out: 0 } };
function _estimateCost(model, tokensIn, tokensOut) {
  var m = (model || '').replace(/^(anthropic|openai|groq|google)\//, '');
  var rates = _MODEL_COSTS[m] || { in: 1, out: 3 }; // default ~$1/MTok in
  if (m.includes('ollama') || m.includes('llama') || m.includes('mistral') || m.includes('tinyllama')) rates = { in: 0, out: 0 };
  return (tokensIn * rates.in + tokensOut * rates.out) / 1000000;
}
function trackUsage(model, tokensIn, tokensOut, agent) {
  try {
    var cost = _estimateCost(model, tokensIn, tokensOut);
    var entry = JSON.stringify({ ts: Date.now(), model: model || 'unknown', tokensIn: tokensIn, tokensOut: tokensOut, cost: cost, agent: agent || 'chat' });
    var dir = require('path').dirname(_usageLogPath);
    if (!require('fs').existsSync(dir)) require('fs').mkdirSync(dir, { recursive: true });
    // Rotate if > 10MB
    try { var stat = require('fs').statSync(_usageLogPath); if (stat.size > 10 * 1024 * 1024) { require('fs').renameSync(_usageLogPath, _usageLogPath + '.' + Date.now() + '.bak'); } } catch(e) {}
    require('fs').appendFileSync(_usageLogPath, entry + '\n');
    // Budget check
    try {
      var bp = require('path').join(__dirname, '..', 'data', 'usage-budget.json');
      if (require('fs').existsSync(bp)) {
        var budget = JSON.parse(require('fs').readFileSync(bp, 'utf8'));
        if (budget.monthly_limit > 0) {
          var raw = require('fs').readFileSync(_usageLogPath, 'utf8');
          var monthCutoff = Date.now() - 2592000000;
          var monthCost = raw.trim().split('\n').filter(Boolean).reduce(function(s, l) { try { var e = JSON.parse(l); return s + ((e.ts >= monthCutoff) ? (e.cost || 0) : 0); } catch(x) { return s; } }, 0);
          if (monthCost >= budget.monthly_limit) console.warn('[USAGE] Budget limit reached: $' + monthCost.toFixed(4) + ' / $' + budget.monthly_limit);
          else if (monthCost >= budget.monthly_limit * 0.8) console.warn('[USAGE] 80% budget warning: $' + monthCost.toFixed(4) + ' / $' + budget.monthly_limit);
        }
      }
    } catch(e2) {}
  } catch (e) { /* silent */ }
}

// Wrap callWithFallback to track usage
var _origCallWithFallback = callWithFallback;
callWithFallback = async function(messages, model, stream) {
  var result = await _origCallWithFallback(messages, model, stream);
  if (!stream && result && result.choices) {
    var usage = result.usage || {};
    var content = (result.choices[0] && result.choices[0].message && result.choices[0].message.content) || '';
    var tokIn = usage.input_tokens || usage.prompt_tokens || Math.ceil(JSON.stringify(messages).length / 4);
    var tokOut = usage.output_tokens || usage.completion_tokens || Math.ceil(content.length / 4);
    trackUsage(model || 'default', tokIn, tokOut, 'chat');
  }
  return result;
};
module.exports = { chat, trackUsage, chatStream, chatStreamChunked, chatNativeTools, parseTools, stripToolTags, buildSystemPrompt, selectModel, callWithFallback, callSwarmOllama, agentLoop, spawnSubAgent, analyzeImage };
