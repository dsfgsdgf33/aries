/**
 * ARIES Code — Autonomous Coding Agent Engine
 * No npm dependencies — Node.js built-ins only.
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const EventEmitter = require('events');

const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\//i, /rm\s+-rf\s+~/i, /rm\s+-rf\s+\*/i,
  /del\s+\/s\s+\/q\s+[A-Z]:\\/i, /format\s+[a-z]:/i, /mkfs\./i,
  /dd\s+if=.*of=\/dev/i, /:\(\)\{.*\|.*&.*\}/, />\s*\/dev\/sd[a-z]/i,
  /shutdown/i, /reboot/i, /init\s+0/i, /halt/i,
  /rm\s+-rf\s+--no-preserve-root/i,
  /Remove-Item\s+-Recurse\s+-Force\s+[A-Z]:\\/i,
  /Stop-Computer/i, /Restart-Computer/i,
];

const MAX_ITERATIONS = 20;
const EXEC_TIMEOUT = 30000;

const SYSTEM_PROMPT = `You are Aries Code, an autonomous coding agent. You write, edit, and fix code to accomplish tasks.

## Available Tools
Call tools using XML tags. You may call ONE tool per response.

<tool>read</tool>
<args>{"path": "relative/file.js"}</args>
— Read a file's contents.

<tool>write</tool>
<args>{"path": "relative/file.js", "content": "full file content here"}</args>
— Write an entire file (creates dirs if needed).

<tool>edit</tool>
<args>{"path": "relative/file.js", "oldText": "exact text to find", "newText": "replacement text"}</args>
— Surgical find-and-replace edit. oldText must match exactly. Always read a file before editing.

<tool>exec</tool>
<args>{"command": "node test.js", "cwd": "optional/subdir"}</args>
— Run a shell command. Returns stdout and stderr.

<tool>search</tool>
<args>{"query": "searchTerm", "dir": "optional/subdir"}</args>
— Search/grep across files for a string.

<tool>list</tool>
<args>{"dir": "."}</args>
— List directory contents.

<tool>browser</tool>
<args>{"url": "https://example.com"}</args>
— Fetch URL content.

<tool>done</tool>
<args>{"summary": "What I did..."}</args>
— Signal that the task is complete.

## Rules
- Always read files before editing them
- Use edit for surgical changes, write for new files
- After writing code, run it to verify
- If there are errors, fix them automatically
- Paths are relative to the working directory
- When done, call the done tool with a summary
`;

class AriesCode extends EventEmitter {
  constructor(ai, options = {}) {
    super();
    this.ai = ai;
    this.maxIterations = options.maxIterations || MAX_ITERATIONS;
    this.execTimeout = options.execTimeout || EXEC_TIMEOUT;
    this.filesChanged = new Map(); // path -> {added, removed}
    this.commandsRun = [];
    this._cancelled = false;
    this._messages = [];
  }

  cancel() { this._cancelled = true; }

  async run(task, workDir) {
    this._cancelled = false;
    this.filesChanged = new Map();
    this.commandsRun = [];
    workDir = path.resolve(workDir || process.cwd());
    if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });

    try {
      const context = await this.indexCodebase(workDir);
      const result = await this.agentLoop(task, workDir, context);
      const summary = {
        success: true,
        files_changed: Array.from(this.filesChanged.keys()),
        commands_run: this.commandsRun,
        summary: result.summary || 'Task completed.',
        iterations: result.iterations,
      };
      this.emit('done', summary);
      return summary;
    } catch (err) {
      const summary = {
        success: false,
        files_changed: Array.from(this.filesChanged.keys()),
        commands_run: this.commandsRun,
        summary: 'Error: ' + err.message,
        error: err.message,
      };
      this.emit('error', err);
      this.emit('done', summary);
      return summary;
    }
  }

  async agentLoop(task, workDir, context) {
    this._messages = [
      { role: 'system', content: SYSTEM_PROMPT + '\n\n## Current Codebase\n' + context },
      { role: 'user', content: task },
    ];

    let iterations = 0;
    while (iterations < this.maxIterations && !this._cancelled) {
      iterations++;
      this.emit('thinking', { iteration: iterations });

      let response;
      try {
        response = await this.ai.chat(this._messages);
      } catch (err) {
        this.emit('error', { message: 'AI call failed: ' + err.message });
        return { summary: 'AI error: ' + err.message, iterations };
      }

      const text = typeof response === 'string' ? response : (response.content || response.message || response.text || '');
      this._messages.push({ role: 'assistant', content: text });
      this.emit('message', { role: 'assistant', content: text });

      // Parse tool calls
      const toolMatch = text.match(/<tool>([\s\S]*?)<\/tool>\s*<args>([\s\S]*?)<\/args>/);
      if (!toolMatch) {
        // No tool call — check if done
        if (text.toLowerCase().includes('task complete') || text.toLowerCase().includes('all done')) {
          return { summary: text, iterations };
        }
        // Ask AI to use a tool or call done
        this._messages.push({ role: 'user', content: 'Please call a tool or call done if the task is complete.' });
        continue;
      }

      const toolName = toolMatch[1].trim().toLowerCase();
      let toolArgs;
      try {
        toolArgs = JSON.parse(toolMatch[2].trim());
      } catch (e) {
        const errMsg = 'Failed to parse tool args: ' + e.message;
        this.emit('tool_result', { tool: toolName, error: errMsg });
        this._messages.push({ role: 'user', content: 'Tool error: ' + errMsg + '. Please try again with valid JSON.' });
        continue;
      }

      this.emit('tool_call', { tool: toolName, args: toolArgs });

      if (toolName === 'done') {
        return { summary: toolArgs.summary || 'Done.', iterations };
      }

      let result;
      try {
        result = await this._executeTool(toolName, toolArgs, workDir);
      } catch (err) {
        result = 'Error: ' + err.message;
      }

      // Truncate large results
      if (typeof result === 'string' && result.length > 15000) {
        result = result.substring(0, 15000) + '\n... (truncated, ' + result.length + ' chars total)';
      }

      this.emit('tool_result', { tool: toolName, result });
      this._messages.push({ role: 'user', content: '[Tool Result: ' + toolName + ']\n' + result });
    }

    if (this._cancelled) return { summary: 'Cancelled by user.', iterations };
    return { summary: 'Reached max iterations (' + this.maxIterations + ').', iterations };
  }

  async _executeTool(name, args, workDir) {
    switch (name) {
      case 'read': return this.toolRead(this._resolve(args.path, workDir));
      case 'write': return this.toolWrite(this._resolve(args.path, workDir), args.content);
      case 'edit': return this.toolEdit(this._resolve(args.path, workDir), args.oldText, args.newText);
      case 'exec': return this.toolExec(args.command, args.cwd ? this._resolve(args.cwd, workDir) : workDir);
      case 'search': return this.toolSearch(args.query, args.dir ? this._resolve(args.dir, workDir) : workDir);
      case 'list': return this.toolList(args.dir ? this._resolve(args.dir, workDir) : workDir);
      case 'browser': return this.toolBrowser(args.url);
      default: return 'Unknown tool: ' + name;
    }
  }

  _resolve(p, workDir) {
    if (!p) return workDir;
    const resolved = path.resolve(workDir, p);
    // Safety: ensure within workDir
    if (!resolved.startsWith(workDir)) throw new Error('Path escapes working directory: ' + p);
    return resolved;
  }

  toolRead(filePath) {
    if (!fs.existsSync(filePath)) return 'File not found: ' + filePath;
    const stat = fs.statSync(filePath);
    if (stat.size > 500000) return 'File too large (' + stat.size + ' bytes). Use search to find specific content.';
    return fs.readFileSync(filePath, 'utf8');
  }

  toolWrite(filePath, content) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const existed = fs.existsSync(filePath);
    const oldContent = existed ? fs.readFileSync(filePath, 'utf8') : '';
    fs.writeFileSync(filePath, content, 'utf8');
    const added = content.split('\n').length;
    const removed = existed ? oldContent.split('\n').length : 0;
    this.filesChanged.set(filePath, { added, removed });
    return 'Written ' + added + ' lines to ' + path.basename(filePath);
  }

  toolEdit(filePath, oldText, newText) {
    if (!fs.existsSync(filePath)) return 'File not found: ' + filePath;
    const content = fs.readFileSync(filePath, 'utf8');
    if (!content.includes(oldText)) return 'oldText not found in file. Read the file first to get exact text.';
    const newContent = content.replace(oldText, newText);
    fs.writeFileSync(filePath, newContent, 'utf8');
    const addedLines = newText.split('\n').length;
    const removedLines = oldText.split('\n').length;
    this.filesChanged.set(filePath, { added: addedLines, removed: removedLines });
    return 'Edited ' + path.basename(filePath) + ': replaced ' + removedLines + ' lines with ' + addedLines + ' lines.';
  }

  toolExec(command, cwd) {
    // Safety check
    for (const pat of DANGEROUS_PATTERNS) {
      if (pat.test(command)) return 'BLOCKED: Dangerous command pattern detected.';
    }
    this.commandsRun.push(command);
    try {
      const result = execSync(command, {
        cwd: cwd || process.cwd(),
        timeout: this.execTimeout,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return result || '(no output)';
    } catch (err) {
      return 'EXIT ' + (err.status || 1) + '\nSTDOUT: ' + (err.stdout || '') + '\nSTDERR: ' + (err.stderr || '');
    }
  }

  toolSearch(query, dir) {
    const results = [];
    const maxResults = 50;
    const _search = (d) => {
      if (results.length >= maxResults) return;
      let entries;
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (results.length >= maxResults) return;
        const full = path.join(d, entry.name);
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        if (entry.isDirectory()) { _search(full); continue; }
        if (entry.isFile()) {
          try {
            const content = fs.readFileSync(full, 'utf8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].includes(query)) {
                results.push(path.relative(dir, full) + ':' + (i + 1) + ': ' + lines[i].trim());
                if (results.length >= maxResults) return;
              }
            }
          } catch {}
        }
      }
    };
    _search(dir);
    return results.length ? results.join('\n') : 'No results found for: ' + query;
  }

  toolList(dir) {
    if (!fs.existsSync(dir)) return 'Directory not found: ' + dir;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries.map(e => (e.isDirectory() ? '[DIR]  ' : '[FILE] ') + e.name).join('\n') || '(empty directory)';
  }

  toolBrowser(url) {
    return new Promise((resolve) => {
      const mod = url.startsWith('https') ? https : http;
      const req = mod.get(url, { timeout: 10000 }, (res) => {
        let data = '';
        res.on('data', c => { data += c; if (data.length > 100000) { req.destroy(); resolve(data.substring(0, 100000) + '... (truncated)'); } });
        res.on('end', () => resolve(data));
      });
      req.on('error', e => resolve('Fetch error: ' + e.message));
      req.on('timeout', () => { req.destroy(); resolve('Fetch timed out.'); });
    });
  }

  async indexCodebase(dir) {
    const files = [];
    const _scan = (d, depth) => {
      if (depth > 4 || files.length > 200) return;
      let entries;
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build') continue;
        const full = path.join(d, entry.name);
        const rel = path.relative(dir, full);
        if (entry.isDirectory()) {
          files.push('[DIR] ' + rel + '/');
          _scan(full, depth + 1);
        } else if (entry.isFile()) {
          try {
            const stat = fs.statSync(full);
            files.push('[FILE] ' + rel + ' (' + stat.size + 'b)');
          } catch {}
        }
      }
    };
    _scan(dir, 0);
    return files.length ? files.join('\n') : '(empty directory)';
  }

  async getRelevantFiles(task, dir) {
    const index = await this.indexCodebase(dir);
    return index; // In a full implementation, AI would filter this
  }

  async autoFix(command, cwd, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
      const result = this.toolExec(command, cwd);
      if (!result.startsWith('EXIT')) return { success: true, output: result, retries: i };
      // Feed error to AI for fixing
      this._messages.push({ role: 'user', content: 'Command failed:\n' + result + '\nPlease fix the error and try again.' });
      const response = await this.ai.chat(this._messages);
      const text = typeof response === 'string' ? response : (response.content || '');
      this._messages.push({ role: 'assistant', content: text });
      // Parse and execute any tool call from the fix
      const toolMatch = text.match(/<tool>([\s\S]*?)<\/tool>\s*<args>([\s\S]*?)<\/args>/);
      if (toolMatch) {
        const toolName = toolMatch[1].trim().toLowerCase();
        try {
          const toolArgs = JSON.parse(toolMatch[2].trim());
          await this._executeTool(toolName, toolArgs, cwd);
        } catch {}
      }
    }
    return { success: false, output: 'Failed after ' + maxRetries + ' retries', retries: maxRetries };
  }
}

module.exports = { AriesCode };
