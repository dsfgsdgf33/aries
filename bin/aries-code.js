#!/usr/bin/env node
/**
 * Aries Code CLI — Standalone coding agent
 * No npm dependencies. Uses Node.js built-ins only.
 *
 * Usage:
 *   node aries-code.js "build a REST API"
 *   node aries-code.js --dir ./myproject "add auth"
 *   node aries-code.js --interactive
 *   node aries-code.js --model gpt-4o "refactor utils"
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const readline = require('readline');
const { URL } = require('url');

// ANSI colors
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m',
  white: '\x1b[37m', gray: '\x1b[90m',
  bgBlack: '\x1b[40m',
};

function log(prefix, color, msg) {
  const ts = new Date().toLocaleTimeString();
  console.log(C.gray + ts + ' ' + color + C.bold + prefix + C.reset + ' ' + msg);
}

// ── Minimal OpenAI-compatible AI client ──
class MinimalAI {
  constructor(opts) {
    this.baseUrl = opts.baseUrl || 'https://api.openai.com';
    this.apiKey = opts.apiKey;
    this.model = opts.model || 'gpt-4o-mini';
  }

  chat(messages) {
    return new Promise((resolve, reject) => {
      const url = new URL(this.baseUrl);
      const payload = JSON.stringify({
        model: this.model,
        messages: messages,
        max_tokens: 4096,
        temperature: 0.2,
      });
      const opts = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: (url.pathname === '/' ? '' : url.pathname) + '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + this.apiKey,
          'Content-Length': Buffer.byteLength(payload),
        },
      };
      const mod = url.protocol === 'https:' ? https : http;
      const req = mod.request(opts, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.error) return reject(new Error(json.error.message || JSON.stringify(json.error)));
            const content = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
            resolve(content || '');
          } catch (e) { reject(new Error('Parse error: ' + e.message + '\nBody: ' + data.substring(0, 500))); }
        });
      });
      req.on('error', reject);
      req.setTimeout(120000, () => { req.destroy(); reject(new Error('Request timed out')); });
      req.write(payload);
      req.end();
    });
  }
}

// ── Config loading ──
function loadConfig() {
  // Try aries config
  const cfgPaths = [
    path.join(__dirname, '..', 'config', 'aries.json'),
    path.join(__dirname, '..', 'config.json'),
  ];
  for (const p of cfgPaths) {
    try {
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {}
  }
  return {};
}

function getAIConfig(cfg, cliModel) {
  const provider = process.env.ARIES_AI_PROVIDER || cfg.gateway?.provider || cfg.ai?.provider || 'openai';
  const apiKey = process.env.ARIES_AI_KEY || cfg.gateway?.apiKey || cfg.ai?.apiKey || '';
  const model = cliModel || process.env.ARIES_AI_MODEL || cfg.gateway?.model || cfg.ai?.model || 'gpt-4o-mini';

  let baseUrl = 'https://api.openai.com';
  if (provider === 'anthropic') baseUrl = 'https://api.anthropic.com';
  else if (provider === 'openrouter') baseUrl = 'https://openrouter.ai/api';
  else if (cfg.gateway?.baseUrl) baseUrl = cfg.gateway.baseUrl;

  // Override with env
  if (process.env.ARIES_AI_BASE_URL) baseUrl = process.env.ARIES_AI_BASE_URL;

  return { baseUrl, apiKey, model };
}

// ── Parse CLI args ──
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { dir: process.cwd(), model: null, interactive: false, task: null, api: false };
  const positional = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dir' || args[i] === '-d') { opts.dir = args[++i]; }
    else if (args[i] === '--model' || args[i] === '-m') { opts.model = args[++i]; }
    else if (args[i] === '--interactive' || args[i] === '-i') { opts.interactive = true; }
    else if (args[i] === '--api') { opts.api = true; }
    else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
${C.cyan}${C.bold}Aries Code${C.reset} — Autonomous Coding Agent

${C.bold}Usage:${C.reset}
  node aries-code.js ${C.green}"task description"${C.reset}
  node aries-code.js ${C.yellow}--dir${C.reset} ./project ${C.green}"add auth"${C.reset}
  node aries-code.js ${C.yellow}--interactive${C.reset}
  node aries-code.js ${C.yellow}--model${C.reset} gpt-4o ${C.green}"task"${C.reset}

${C.bold}Options:${C.reset}
  --dir, -d       Working directory (default: cwd)
  --model, -m     AI model to use
  --interactive, -i  REPL mode
  --api           Connect to running Aries instance
  --help, -h      Show this help
`);
      process.exit(0);
    }
    else { positional.push(args[i]); }
  }

  if (positional.length) opts.task = positional.join(' ');
  return opts;
}

// ── Run with AriesCode engine ──
async function runWithEngine(task, workDir, ai) {
  const { AriesCode } = require(path.join(__dirname, '..', 'core', 'aries-code'));
  const agent = new AriesCode(ai);

  agent.on('thinking', d => log('[THINKING]', C.magenta, 'Iteration ' + d.iteration));
  agent.on('tool_call', d => {
    const colors = { read: C.blue, write: C.green, edit: C.yellow, exec: C.cyan, search: C.magenta, list: C.gray, browser: C.blue, done: C.green };
    const c = colors[d.tool] || C.white;
    const argStr = d.args ? (d.args.path || d.args.command || d.args.query || d.args.url || d.args.dir || '') : '';
    log('[' + d.tool.toUpperCase() + ']', c, argStr);
  });
  agent.on('tool_result', d => {
    if (d.error) { log('[ERROR]', C.red, d.error); return; }
    const preview = (d.result || '').substring(0, 200).replace(/\n/g, ' ');
    log('[RESULT]', C.dim, preview + (d.result && d.result.length > 200 ? '...' : ''));
  });
  agent.on('error', d => log('[ERROR]', C.red, d.message || String(d)));
  agent.on('message', d => {
    // Show AI reasoning (non-tool text)
    const text = d.content || '';
    const lines = text.split('\n').filter(l => !l.includes('<tool>') && !l.includes('<args>'));
    const reasoning = lines.join('\n').trim();
    if (reasoning) {
      console.log(C.gray + '─'.repeat(60) + C.reset);
      console.log(reasoning);
      console.log(C.gray + '─'.repeat(60) + C.reset);
    }
  });

  const result = await agent.run(task, workDir);
  console.log();
  if (result.success) {
    log('[DONE]', C.green, result.summary);
    if (result.files_changed.length) {
      console.log(C.bold + '\nFiles changed:' + C.reset);
      result.files_changed.forEach(f => console.log('  ' + C.green + '✓' + C.reset + ' ' + f));
    }
    if (result.commands_run.length) {
      console.log(C.bold + '\nCommands run:' + C.reset);
      result.commands_run.forEach(c => console.log('  ' + C.cyan + '$' + C.reset + ' ' + c));
    }
  } else {
    log('[FAILED]', C.red, result.summary);
  }
  return result;
}

// ── Run via API ──
async function runViaApi(task, workDir) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ task, workDir });
    const req = http.request({
      hostname: '127.0.0.1', port: 3333,
      path: '/api/aries-code/run', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.runId) {
            log('[STARTED]', C.cyan, 'Run ID: ' + json.runId);
            streamFromApi(json.runId).then(resolve).catch(reject);
          } else {
            resolve(json);
          }
        } catch (e) { reject(e); }
      });
    });
    req.on('error', e => {
      log('[ERROR]', C.red, 'Cannot connect to Aries at localhost:3333: ' + e.message);
      reject(e);
    });
    req.write(payload);
    req.end();
  });
}

function streamFromApi(runId) {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:3333/api/aries-code/' + runId + '/stream', (res) => {
      res.setEncoding('utf8');
      let buffer = '';
      res.on('data', chunk => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const evt = JSON.parse(line.slice(6));
              if (evt.type === 'thinking') log('[THINKING]', C.magenta, 'Iteration ' + (evt.iteration || ''));
              else if (evt.type === 'tool_call') log('[' + (evt.tool || '').toUpperCase() + ']', C.cyan, JSON.stringify(evt.args || ''));
              else if (evt.type === 'tool_result') log('[RESULT]', C.dim, (evt.result || '').substring(0, 200));
              else if (evt.type === 'done') { log('[DONE]', C.green, evt.summary || ''); resolve(evt); }
              else if (evt.type === 'error') log('[ERROR]', C.red, evt.message || '');
            } catch {}
          }
        }
      });
      res.on('end', () => resolve({}));
    }).on('error', reject);
  });
}

// ── Interactive REPL ──
async function interactiveMode(workDir, ai) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log(C.cyan + C.bold + '┌─────────────────────────────────┐' + C.reset);
  console.log(C.cyan + C.bold + '│   Aries Code — Interactive Mode │' + C.reset);
  console.log(C.cyan + C.bold + '└─────────────────────────────────┘' + C.reset);
  console.log(C.gray + 'Working directory: ' + workDir + C.reset);
  console.log(C.gray + 'Type a task, or "exit" to quit.' + C.reset);
  console.log();

  const prompt = () => {
    rl.question(C.cyan + 'aries> ' + C.reset, async (input) => {
      input = input.trim();
      if (!input || input === 'exit' || input === 'quit') { rl.close(); return; }
      if (input === 'cd') { console.log(workDir); prompt(); return; }
      if (input.startsWith('cd ')) {
        const newDir = path.resolve(workDir, input.slice(3).trim());
        if (fs.existsSync(newDir)) { workDir = newDir; console.log(C.green + 'Changed to: ' + workDir + C.reset); }
        else console.log(C.red + 'Directory not found: ' + newDir + C.reset);
        prompt(); return;
      }
      try { await runWithEngine(input, workDir, ai); } catch (e) { log('[ERROR]', C.red, e.message); }
      console.log();
      prompt();
    });
  };
  prompt();
}

// ── Main ──
async function main() {
  const opts = parseArgs();

  console.log(C.cyan + C.bold + '⌨️  Aries Code' + C.reset + C.gray + ' — Autonomous Coding Agent' + C.reset);
  console.log();

  if (opts.api) {
    if (!opts.task && !opts.interactive) { log('[ERROR]', C.red, 'Provide a task or use --interactive'); process.exit(1); }
    if (opts.task) await runViaApi(opts.task, opts.dir);
    return;
  }

  const cfg = loadConfig();
  const aiCfg = getAIConfig(cfg, opts.model);

  if (!aiCfg.apiKey) {
    log('[WARN]', C.yellow, 'No API key found. Set ARIES_AI_KEY env var or configure in aries config.');
    log('[INFO]', C.gray, 'Trying to connect to running Aries instance...');
    if (opts.task) { await runViaApi(opts.task, opts.dir); return; }
  }

  const ai = new MinimalAI(aiCfg);
  log('[CONFIG]', C.gray, 'Model: ' + aiCfg.model + ' | Base: ' + aiCfg.baseUrl);

  if (opts.interactive) {
    await interactiveMode(path.resolve(opts.dir), ai);
  } else if (opts.task) {
    await runWithEngine(opts.task, path.resolve(opts.dir), ai);
  } else {
    log('[ERROR]', C.red, 'No task provided. Use --help for usage.');
    process.exit(1);
  }
}

main().catch(e => { console.error(C.red + 'Fatal: ' + e.message + C.reset); process.exit(1); });
