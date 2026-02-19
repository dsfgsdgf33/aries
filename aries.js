#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// ARIES v3.0 — Autonomous Runtime Intelligence & Execution System
// ═══════════════════════════════════════════════════════════════
// Optimized: 10-cycle deep optimization pass
//   C1: Batched rendering via queueRender()
//   C2: Timer cleanup & dashboard caching
//   C3: Input responsiveness
//   C4: Enhanced boot sequence
//   C5: Cyberpunk dashboard UI
//   C6: Keybind perfection
//   C7: AI interaction quality
//   C8: Code quality & organization
//   C9: Feature polish
//   C10: Final validation
// ═══════════════════════════════════════════════════════════════

const blessed = require('blessed');
const fs = require('fs');
const path = require('path');
const { execSync, exec, spawn } = require('child_process');

const config = require('./config.json');
const ai = require('./core/ai');
const tools = require('./core/tools');
const memory = require('./core/memory');
const sysModule = require('./core/system');
const events = require('./core/events');
const Swarm = require('./core/swarm');
const SwarmCoordinator = require('./core/swarm-coordinator');
const TaskQueue = require('./core/task-queue');
const pluginLoader = require('./core/plugin-loader');
const selfHeal = require('./core/self-heal');
const apiServer = require('./core/api-server');
const SharedData = require('./core/shared-data');
const { AgentRoster } = require('./core/agents');
const selfUpdate = require('./core/self-update');
const http = require('http');
const https = require('https');

// ═══════════════════════════════════════════════════════════════
// SECTION: Crash Resilience
// ═══════════════════════════════════════════════════════════════

const crashLogPath = path.join(__dirname, 'crash.log');

process.on('uncaughtException', (err) => {
  const entry = `[${new Date().toISOString()}] UNCAUGHT EXCEPTION: ${err.stack || err.message}\n`;
  try { fs.appendFileSync(crashLogPath, entry); } catch {}
  const cat = selfHeal.categorizeCrash(err);
  if (chatLog) {
    try {
      chatLog.log(`{red-fg}[CRASH] ${cat.category} (${cat.severity}): ${escTags(err.message)}{/}`);
      if (cat.suggestion) chatLog.log(`{yellow-fg}  💊 ${escTags(cat.suggestion)}{/}`);
      queueRender();
    } catch {}
  }
});

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.stack : String(reason);
  const entry = `[${new Date().toISOString()}] UNHANDLED REJECTION: ${msg}\n`;
  try { fs.appendFileSync(crashLogPath, entry); } catch {}
  if (chatLog) {
    try {
      chatLog.log(`{red-fg}[CRASH] Unhandled rejection: ${escTags(String(reason && reason.message || reason))}{/}`);
      queueRender();
    } catch {}
  }
});

// ═══════════════════════════════════════════════════════════════
// SECTION: State
// ═══════════════════════════════════════════════════════════════

const historyFile = path.join(__dirname, 'data', 'history.json');
let chatHistory = [];
try { chatHistory = JSON.parse(fs.readFileSync(historyFile, 'utf8')); } catch {}

let aiOnline = false;
let startTime = Date.now();
let thinkingBox = null;
let micRecording = false;
let swarmMode = false;
let inputHistory = [];
let historyIdx = -1;
let streamBuffer = '';
let autoScroll = true;
let compactMode = false;
let pasteBuffer = [];
let sessionStats = { messagesSent: 0, tokensEstimate: 0 };
let lastResponseTime = 0;
let conversationTitle = '';

// Conversation branches
const branches = new Map();
let currentBranch = 'main';
branches.set('main', { history: chatHistory, title: '' });

// Agent personas
const PERSONAS = {
  default:  { name: 'Default',  prompt: 'You are Aries, an advanced AI assistant. Be helpful, concise, and intelligent.' },
  coder:    { name: 'Coder',    prompt: 'You are Aries in Coder mode. Focus on technical accuracy, code quality, and engineering best practices. Provide code examples, explain algorithms, and think systematically. Use technical terminology freely.' },
  creative: { name: 'Creative', prompt: 'You are Aries in Creative mode. Be imaginative, expressive, and inspiring. Help with storytelling, brainstorming, writing, and creative problem-solving. Use vivid language and think outside the box.' },
  analyst:  { name: 'Analyst',  prompt: 'You are Aries in Analyst mode. Be data-focused, structured, and methodical. Use bullet points, tables, and clear frameworks. Analyze problems systematically and provide evidence-based recommendations.' },
};
let currentPersona = 'default';

// Persistent context
let persistentContext = [];

// Stream effect
let streamEffect = config.streamEffect !== undefined ? config.streamEffect : true;

// Search state
let searchMatches = [];
let searchMatchIdx = -1;
let searchQuery = '';

// Code block detection
let lastCodeBlock = '';
let lastCodeLang = '';

// ═══════════════════════════════════════════════════════════════
// SECTION: Themes
// ═══════════════════════════════════════════════════════════════

const THEMES = {
  cyan:    { primary: 'cyan',    accent: 'white',   border: 'cyan',    header: 'cyan',    alert: 'yellow', name: 'Cyan Default' },
  matrix:  { primary: 'green',   accent: 'white',   border: 'green',   header: 'green',   alert: 'yellow', name: 'Matrix' },
  ember:   { primary: 'red',     accent: 'yellow',  border: 'red',     header: 'red',     alert: 'yellow', name: 'Ember' },
  blood:   { primary: '#cc0000', accent: '#ff4444',  border: '#880000', header: '#cc0000', alert: '#ff6666', name: 'Blood' },
  phantom: { primary: 'magenta', accent: '#ff88ff', border: '#880088', header: 'magenta', alert: '#ffaaff', name: 'Phantom' },
  ocean:   { primary: '#4488ff', accent: '#88bbff', border: '#2244aa', header: '#4488ff', alert: '#aaccff', name: 'Ocean' },
  solar:   { primary: '#ffaa00', accent: '#ffcc44', border: '#cc8800', header: '#ffaa00', alert: '#ffdd88', name: 'Solar' },
  ghost:   { primary: '#aaaaaa', accent: '#dddddd', border: '#666666', header: '#aaaaaa', alert: '#cccccc', name: 'Ghost' },
};
let currentTheme = THEMES[config.theme] || THEMES.cyan;
let currentThemeName = config.theme || 'cyan';

// Sound config
const soundOnResponse = config.soundOnResponse !== undefined ? config.soundOnResponse : true;

// ═══════════════════════════════════════════════════════════════
// SECTION: Plugin System
// ═══════════════════════════════════════════════════════════════

const loadedPlugins = pluginLoader.loadAll();

const v2Plugins = [];
const pluginsDir = path.join(__dirname, 'plugins');

function loadV2Plugins() {
  if (!fs.existsSync(pluginsDir)) {
    try { fs.mkdirSync(pluginsDir, { recursive: true }); } catch {}
    return;
  }
  const files = fs.readdirSync(pluginsDir).filter(f => f.endsWith('.js'));
  for (const file of files) {
    try {
      const pluginPath = path.join(pluginsDir, file);
      const plugin = require(pluginPath);
      if (plugin.name) {
        v2Plugins.push(plugin);
        if (plugin.commands) {
          for (const cmd of Object.keys(plugin.commands)) {
            if (!SLASH_COMMANDS.includes(cmd)) SLASH_COMMANDS.push(cmd);
          }
        }
      }
    } catch (e) {
      try { fs.appendFileSync(crashLogPath, `[${new Date().toISOString()}] PLUGIN LOAD ERROR (${file}): ${e.message}\n`); } catch {}
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// SECTION: Task Queue, Swarm & Coordinator
// ═══════════════════════════════════════════════════════════════

const taskQueue = new TaskQueue();

const coordinator = new SwarmCoordinator(config.remoteWorkers || {});

const swarm = new Swarm(
  ai,
  { ...(config.swarm || { maxWorkers: 5, workerTimeout: 60000, retries: 2 }), models: config.models, relay: config.relay },
  coordinator
);

// Safe coordinator start with port scanning
let coordinatorStarted = false;
let coordinatorPort = 9700;

if (config.remoteWorkers && config.remoteWorkers.enabled) {
  const basePort = config.remoteWorkers.port || 9700;
  let started = false;
  for (let port = basePort; port <= basePort + 10; port++) {
    try {
      config.remoteWorkers.port = port;
      coordinatorStarted = coordinator.start();
      coordinatorPort = port;
      started = true;
      break;
    } catch (e) {
      if (e.code === 'EADDRINUSE' || (e.message && e.message.includes('EADDRINUSE'))) continue;
      try { fs.appendFileSync(crashLogPath, `[${new Date().toISOString()}] COORDINATOR START ERROR (port ${port}): ${e.message}\n`); } catch {}
      break;
    }
  }
  if (!started) {
    try { fs.appendFileSync(crashLogPath, `[${new Date().toISOString()}] WARNING: Could not start coordinator on ports ${basePort}-${basePort + 10}\n`); } catch {}
  }
}

coordinator.on('worker_connected', (id, info) => {
  if (chatLog) {
    chatLog.log(`{${currentTheme.primary}-fg}[REMOTE]{/} Worker connected: ${escTags(id)} (${info.hostname || 'unknown'})`);
    queueRender();
  }
  updateHeader();
});

coordinator.on('worker_disconnected', (id) => {
  if (chatLog) {
    chatLog.log(`{red-fg}[REMOTE]{/} Worker disconnected: ${escTags(id)}`);
    queueRender();
  }
  updateHeader();
});

// ═══════════════════════════════════════════════════════════════
// SECTION: Slash Commands Registry
// ═══════════════════════════════════════════════════════════════

const SLASH_COMMANDS = [
  '/help', '/status', '/ps', '/kill', '/launch', '/files', '/disk', '/net',
  '/mem', '/remember', '/forget', '/search', '/watch', '/unwatch',
  '/swarm', '/s', '/workers', '/connect', '/disconnect',
  '/export', '/theme', '/queue', '/clear', '/exit',
  '/find', '/compact', '/paste',
  '/branch', '/branches', '/switch',
  '/persona',
  '/copy', '/save', '/load', '/sessions',
  '/context',
  '/run',
  '/health',
  '/cat', '/edit', '/web',
  '/agents', '/data', '/browse',
  '/memory', '/tools', '/backup', '/update',
];

const COMMAND_DESCRIPTIONS = {
  '/help':       'Show command reference',
  '/status':     'Full system overview',
  '/ps':         'Top processes by CPU',
  '/kill':       'Kill process by name/PID',
  '/launch':     'Launch an application',
  '/files':      'Directory listing',
  '/disk':       'Disk usage info',
  '/net':        'Network information',
  '/mem':        'Show memory entries',
  '/remember':   'Save to memory',
  '/forget':     'Delete memory entry',
  '/search':     'Search memory',
  '/watch':      'Watch file/folder for changes',
  '/unwatch':    'Stop watching',
  '/swarm':      'Deploy parallel swarm workers',
  '/s':          'Swarm shortcut',
  '/workers':    'List remote workers',
  '/connect':    'Connect to remote worker',
  '/disconnect': 'Remove a worker',
  '/export':     'Export chat as markdown',
  '/theme':      'Change color theme',
  '/queue':      'View task queue',
  '/clear':      'Clear chat history',
  '/exit':       'Shutdown Aries',
  '/find':       'Search chat (n/N to navigate)',
  '/compact':    'Toggle compact mode',
  '/paste':      'Toggle multi-line paste mode',
  '/branch':     'Save conversation branch',
  '/branches':   'List conversation branches',
  '/switch':     'Switch to a branch',
  '/persona':    'Switch AI persona',
  '/copy':       'Copy nth message to clipboard',
  '/save':       'Save session to file',
  '/load':       'Load session from file',
  '/sessions':   'List saved sessions',
  '/context':    'Manage persistent context',
  '/run':        'Execute last code block',
  '/health':     'Self-healing system report',
  '/cat':        'Display file contents in chat',
  '/edit':       'Open file in default editor',
  '/web':        'Fetch and display webpage summary',
  '/agents':     'List all swarm agents and status',
  '/data':       'View/set shared data store',
  '/memory':     'View/search/add/forget memories',
  '/tools':      'List all available tools',
  '/backup':     'List/restore backups',
  '/update':     'Self-update capabilities',
  '/browse':     'Built-in browser (Playwright)',
};

// ═══════════════════════════════════════════════════════════════
// SECTION: Screen & Batched Renderer (CYCLE 1)
// ═══════════════════════════════════════════════════════════════

const screen = blessed.screen({
  smartCSR: true,
  fullUnicode: true,
  title: 'ARIES v3.0',
  cursor: { artificial: true, shape: 'line', blink: true, color: 'cyan' }
});

// C1: Single batched renderer — the ONLY place screen.render() is called
// (except after screen.append/screen.remove for overlays that need immediate paint)
let _renderPending = false;
function queueRender() {
  if (_renderPending) return;
  _renderPending = true;
  setImmediate(() => {
    _renderPending = false;
    screen.render();
  });
}

// ═══════════════════════════════════════════════════════════════
// SECTION: Helpers
// ═══════════════════════════════════════════════════════════════

function escTags(text) {
  if (!text) return '';
  return text.replace(/\{/g, '{{').replace(/\}/g, '}}');
}

function stripTools(text) {
  if (!text) return '';
  return text
    .replace(/<tool:[^>]*>[\s\S]*?<\/tool:[^>]*>/g, '')
    .replace(/<tool:[^/]*\/>/g, '')
    .trim();
}

function getTimeStr() {
  return new Date().toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Chicago'
  }) + ' CT';
}

function getTimestamp() {
  return new Date().toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Chicago'
  });
}

function getSessionDuration() {
  const secs = Math.floor((Date.now() - startTime) / 1000);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h${m}m` : `${m}m`;
}

// C5: Cyberpunk visual bar
function makeBar(pct, width = 16) {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  const color = clamped > 90 ? 'red' : clamped > 70 ? 'yellow' : 'green';
  return `{${color}-fg}${'█'.repeat(filled)}{/}{gray-fg}${'░'.repeat(empty)}{/}`;
}

// ═══════════════════════════════════════════════════════════════
// SECTION: Markdown Formatter
// ═══════════════════════════════════════════════════════════════

function formatMarkdown(text) {
  if (!text) return '';
  let lines = text.split('\n');
  let inCodeBlock = false;
  let codeBlockContent = '';
  let codeBlockLang = '';
  let result = [];
  const c = currentTheme.primary;

  for (let line of lines) {
    const codeMatch = line.match(/^```(\w*)/);
    if (codeMatch && !inCodeBlock) {
      inCodeBlock = true;
      codeBlockLang = codeMatch[1] || '';
      codeBlockContent = '';
      const langLabel = codeBlockLang ? ` ${codeBlockLang} ` : ' code ';
      result.push(`{${c}-fg}┌───${langLabel}${'─'.repeat(Math.max(0, 20 - langLabel.length))}{/}`);
      continue;
    }
    if (line.match(/^```/) && inCodeBlock) {
      inCodeBlock = false;
      lastCodeBlock = codeBlockContent;
      lastCodeLang = codeBlockLang;
      result.push(`{${c}-fg}└${'─'.repeat(24)}{/}`);
      continue;
    }
    if (inCodeBlock) {
      codeBlockContent += line + '\n';
      result.push(`{#444444-bg}{yellow-fg} ${escTags(line)} {/}`);
      continue;
    }

    // Headers
    const h1 = line.match(/^# (.+)/);
    const h2 = line.match(/^## (.+)/);
    const h3 = line.match(/^### (.+)/);
    if (h1) { result.push(`{bold}{${c}-fg}═ ${escTags(h1[1])}{/}`); continue; }
    if (h2) { result.push(`{bold}{${c}-fg}─ ${escTags(h2[1])}{/}`); continue; }
    if (h3) { result.push(`{bold}{${c}-fg}  ${escTags(h3[1])}{/}`); continue; }

    // Inline formatting
    let formatted = escTags(line);
    formatted = formatted.replace(/\*\*(.+?)\*\*/g, '{bold}$1{/bold}');
    formatted = formatted.replace(/`([^`]+)`/g, '{yellow-fg}$1{/yellow-fg}');
    formatted = formatted.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, `{${c}-fg}$1{/${c}-fg}`);
    result.push(formatted);
  }

  if (inCodeBlock) {
    lastCodeBlock = codeBlockContent;
    lastCodeLang = codeBlockLang;
    result.push(`{${c}-fg}└${'─'.repeat(24)}{/}`);
  }

  return result.join('\n');
}

// ═══════════════════════════════════════════════════════════════
// SECTION: Boot Sequence (CYCLE 4 — Enhanced)
// ═══════════════════════════════════════════════════════════════

function runBootSequence(callback) {
  let bootDone = false;
  // C4: Track ALL boot timers for guaranteed cleanup
  const bootTimers = [];
  function trackTimer(id) { bootTimers.push(id); return id; }

  function finishBoot() {
    if (bootDone) return;
    bootDone = true;
    // C2/C4: Clear every boot timer
    bootTimers.forEach(t => { clearInterval(t); clearTimeout(t); });
    bootTimers.length = 0;
    if (bootBox) { try { bootBox.detach(); } catch {} }
    screen.render();
    callback();
  }

  // Safety: force boot to complete within 5 seconds max
  const bootSafetyTimer = setTimeout(finishBoot, 5000);
  trackTimer(bootSafetyTimer);

  const bootBox = blessed.box({
    parent: screen,
    top: 0, left: 0, width: '100%', height: '100%',
    style: { bg: 'black', fg: currentTheme.primary },
    tags: true
  });
  screen.render();

  const lines = [];
  const totalScanLines = 20;
  let scanIndex = 0;

  // Phase 1: Scan lines sweep (30ms each)
  trackTimer(setInterval(function scanTick() {
    if (scanIndex >= totalScanLines) {
      clearInterval(bootTimers[bootTimers.length - 1]); // self
      trackTimer(setTimeout(() => phase1_5(), 30));
      return;
    }
    const y = Math.floor((scanIndex / totalScanLines) * screen.height);
    const line = blessed.text({
      parent: bootBox,
      top: y, left: 0, width: '100%', height: 1,
      content: '━'.repeat(screen.width),
      style: { fg: currentTheme.primary, bg: 'black' }
    });
    lines.push(line);
    screen.render();
    scanIndex++;
  }, 30));

  // Phase 1.5: Matrix rain + security check before logo
  function phase1_5() {
    lines.forEach(l => l.detach());
    bootBox.setContent('');
    screen.render();

    const c = currentTheme.primary;
    const matrixChars = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン01';
    const cols = Math.min(screen.width, 80);
    const rainDrops = Array(cols).fill(0).map(() => Math.floor(Math.random() * 8));
    let rainTicks = 0;

    const rainBox = blessed.box({
      parent: bootBox,
      top: 0, left: 'center', width: cols, height: screen.height,
      tags: true, style: { bg: 'black' }
    });

    trackTimer(setInterval(function rainTick() {
      if (rainTicks >= 12) {
        clearInterval(bootTimers[bootTimers.length - 1]);
        rainBox.detach();
        // Security check
        phaseSecurityCheck();
        return;
      }
      let rainContent = '';
      for (let y = 0; y < Math.min(screen.height - 2, 20); y++) {
        let line = '';
        for (let x = 0; x < cols; x++) {
          if (rainDrops[x] === y) {
            line += matrixChars[Math.floor(Math.random() * matrixChars.length)];
          } else if (rainDrops[x] === y - 1) {
            line += matrixChars[Math.floor(Math.random() * matrixChars.length)];
          } else {
            line += ' ';
          }
        }
        rainContent += line + '\n';
      }
      rainBox.setContent(`{green-fg}${rainContent}{/}`);
      screen.render();
      // Advance drops
      for (let x = 0; x < cols; x++) {
        rainDrops[x] += 1;
        if (rainDrops[x] > screen.height + 3) rainDrops[x] = -Math.floor(Math.random() * 8);
      }
      rainTicks++;
    }, 60));
  }

  // Phase 1.75: Fake security check
  function phaseSecurityCheck() {
    bootBox.setContent('');
    const c = currentTheme.primary;
    const secBox = blessed.box({
      parent: bootBox,
      top: 'center', left: 'center', width: 50, height: 7,
      tags: true, style: { bg: 'black' }
    });

    secBox.setContent(`{red-fg}{bold}  ⚠  SYSTEM BREACH DETECTED  ⚠{/}\n\n{yellow-fg}  Scanning intrusion vectors...{/}`);
    screen.render();

    trackTimer(setTimeout(() => {
      secBox.setContent(`{red-fg}{bold}  ⚠  SYSTEM BREACH DETECTED  ⚠{/}\n\n{yellow-fg}  Verifying credentials...{/}\n{gray-fg}  Identity: Master Control{/}`);
      screen.render();
    }, 300));

    trackTimer(setTimeout(() => {
      secBox.setContent(`{red-fg}{bold}  ⚠  SYSTEM BREACH DETECTED  ⚠{/}\n\n{green-fg}{bold}  ✓ AUTHORIZED — ACCESS GRANTED{/}\n{gray-fg}  Identity: Master Control{/}\n{${c}-fg}  Clearance: OMEGA{/}`);
      screen.render();
    }, 700));

    trackTimer(setTimeout(() => {
      secBox.detach();
      phase2();
    }, 1100));
  }

  // Phase 2: ASCII ARIES logo line-by-line (50ms each) with glitch effect
  function phase2() {
    bootBox.setContent('');
    screen.render();

    const c = currentTheme.primary;
    const logo = [
      `{${c}-fg}  ╔══════════════════════════════════════════════╗{/}`,
      `{${c}-fg}  ║                                              ║{/}`,
      `{${c}-fg}  ║{bold}    █▀▀█ █▀▀█ ▀█▀ █▀▀ █▀▀    ▐█▌  ▐█▌   {/}{${c}-fg}║{/}`,
      `{${c}-fg}  ║{bold}    █▄▄█ █▄▄▀  █  █▀▀ ▀▀█     ██    ██    {/}{${c}-fg}║{/}`,
      `{${c}-fg}  ║{bold}    █  █ █  █ ▄█▄ █▄▄ ▄▄█    ▐██▌  ▐██▌   {/}{${c}-fg}║{/}`,
      `{${c}-fg}  ║                                              ║{/}`,
      `{${c}-fg}  ║{bold}  ──────────────── v 3 . 0 ────────────────  {/}{${c}-fg}║{/}`,
      `{${c}-fg}  ║                                              ║{/}`,
      `{${c}-fg}  ╚══════════════════════════════════════════════╝{/}`,
      '',
      `{bold}{${c}-fg}     [ Autonomous Runtime Intelligence ]{/}`,
      `{bold}{${c}-fg}       [ & Execution System  v3.0  ]{/}`,
    ];

    const startY = Math.floor((screen.height - logo.length) / 2);
    const logoBox = blessed.box({
      parent: bootBox,
      top: startY, left: 'center', width: 60, height: logo.length + 2,
      tags: true, style: { bg: 'black' }
    });

    let lineIdx = 0;
    trackTimer(setInterval(function logoTick() {
      if (lineIdx >= logo.length) {
        clearInterval(bootTimers[bootTimers.length - 1]);
        // Glitch effect — 3 rapid glitch frames
        const glitchChars = '░▒▓█▀▄╬╠╣';
        const originalContent = logo.join('\n');
        let glitchCount = 0;
        trackTimer(setInterval(function glitchTick() {
          if (glitchCount >= 3) {
            clearInterval(bootTimers[bootTimers.length - 1]);
            logoBox.setContent(originalContent);
            screen.render();
            trackTimer(setTimeout(() => phase3(startY + logo.length + 2), 150));
            return;
          }
          let glitchContent = '';
          const intensity = 0.2 - (glitchCount * 0.05);
          for (let i = 0; i < originalContent.length; i++) {
            if (originalContent[i] !== '{' && originalContent[i] !== '}' &&
                originalContent[i] !== '\n' && originalContent[i] !== ' ' && Math.random() < intensity) {
              glitchContent += glitchChars[Math.floor(Math.random() * glitchChars.length)];
            } else {
              glitchContent += originalContent[i];
            }
          }
          logoBox.setContent(glitchContent);
          screen.render();
          glitchCount++;
        }, 80));
        return;
      }
      logoBox.setContent(logo.slice(0, lineIdx + 1).join('\n'));
      screen.render();
      lineIdx++;
    }, 50));
  }

  // Phase 3: System checks with progress bars (70ms each)
  function phase3(startY) {
    const remoteStatus = coordinatorStarted ? `LISTENING :${coordinatorPort}` : 'DISABLED';
    const pluginCount = loadedPlugins.length + v2Plugins.length;
    const checks = [
      ['Neural Core',             'ONLINE'],
      ['AI Engine (Opus 4)',      'LINKED'],
      ['Agent Roster (6)',        'ARMED'],
      [`Tool Matrix (${pluginCount}p)`, 'ARMED'],
      ['Memory Bank',             'SYNCED'],
      ['Swarm Coordinator',       remoteStatus],
      ['Shared Data Layer',       'READY'],
      ['All Systems',             'NOMINAL'],
    ];

    const checkBox = blessed.box({
      parent: bootBox,
      top: startY + 1, left: 'center', width: 52, height: checks.length + 2,
      tags: true, border: { type: 'line' },
      style: { border: { fg: currentTheme.border }, bg: 'black' }
    });
    screen.render();

    let checkIdx = 0;
    trackTimer(setInterval(function checkTick() {
      if (checkIdx >= checks.length) {
        clearInterval(bootTimers[bootTimers.length - 1]);
        trackTimer(setTimeout(() => phase4(), 200));
        return;
      }
      const linesArr = [];
      for (let i = 0; i <= checkIdx; i++) {
        const [n, s] = checks[i];
        const barWidth = 12;
        const pct = Math.round(((i + 1) / checks.length) * 100);
        const filled = Math.round((pct / 100) * barWidth);
        const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);
        const color = s === 'NOMINAL' ? 'green' : (s === 'DISABLED' ? 'yellow' : currentTheme.primary);
        const bold = s === 'NOMINAL' ? '{bold}' : '';
        const boldEnd = s === 'NOMINAL' ? '{/bold}' : '';
        linesArr.push(`  {bold}▸{/bold} ${n.padEnd(22)} {gray-fg}${bar}{/} ${bold}{${color}-fg}${s}{/}${boldEnd}`);
      }
      checkBox.setContent(linesArr.join('\n'));
      screen.render();
      checkIdx++;
    }, 70));
  }

  // Phase 4: Welcome message with typewriter effect
  function phase4() {
    bootBox.setContent('');
    const c = currentTheme.primary;

    const welcomeBox = blessed.box({
      parent: bootBox,
      top: 'center', left: 'center', width: 50, height: 10,
      tags: true, style: { bg: 'black' }
    });

    const staticLines = [
      '',
      `{${c}-fg}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━{/}`,
      '',
    ];
    welcomeBox.setContent(staticLines.join('\n'));
    screen.render();

    // C4: Typewriter effect — epic welcome
    const welcomeText = '    Welcome back, Master Control.';
    const line2 = '    All agents standing by. Awaiting orders.';
    let charIdx = 0;

    trackTimer(setInterval(function typeTick() {
      if (charIdx > welcomeText.length + line2.length + 10) {
        clearInterval(bootTimers[bootTimers.length - 1]);
        trackTimer(setTimeout(() => {
          finishBoot();
        }, 800));
        return;
      }

      let display = staticLines.join('\n');
      if (charIdx <= welcomeText.length) {
        display += `\n{bold}{white-fg}${welcomeText.substring(0, charIdx)}{/}`;
      } else {
        display += `\n{bold}{white-fg}${welcomeText}{/}`;
        const line2Idx = charIdx - welcomeText.length - 5;
        if (line2Idx > 0) {
          display += `\n{bold}{white-fg}${line2.substring(0, Math.min(line2Idx, line2.length))}{/}`;
        }
      }
      display += `\n\n{${c}-fg}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━{/}`;
      welcomeBox.setContent(display);
      screen.render();
      charIdx += 2; // 2 chars at a time for speed
    }, 30));
  }
}

// ═══════════════════════════════════════════════════════════════
// SECTION: Main UI
// ═══════════════════════════════════════════════════════════════

let headerBar, chatBox, chatLog, sysBox, procBox, statusBox, inputBox, micBtn, shortcutBar;
let rightPanel, mainArea, quickActionsBar, commandPalette, helpOverlay;

// C2: Dashboard cache — only update DOM if values changed
let _dashCache = { sysContent: '', procContent: '', statusContent: '', headerContent: '', statusBarContent: '' };
let _relayCache = null;

// Poll relay status every 15s for dashboard
if (config.relay && config.relay.url) {
  const _pollRelay = () => {
    const http = require('http');
    try {
      const u = new URL(`${config.relay.url}/api/status`);
      const req = http.request(u, { headers: { 'X-Aries-Secret': config.relay.secret || '' }, timeout: 5000 }, (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => { try { _relayCache = JSON.parse(d); } catch {} });
      });
      req.on('error', () => { _relayCache = null; });
      req.on('timeout', () => { req.destroy(); });
      req.end();
    } catch {}
  };
  _pollRelay();
  setInterval(_pollRelay, 15000);
}
// C2: Track dashboard intervals for cleanup on rebuild
let _dashIntervalId = null;
let _statusIntervalId = null;

function destroyUI() {
  // C2: Clear dashboard timers
  if (_dashIntervalId) { clearInterval(_dashIntervalId); _dashIntervalId = null; }
  if (_statusIntervalId) { clearInterval(_statusIntervalId); _statusIntervalId = null; }
  const children = screen.children.slice();
  children.forEach(child => child.detach());
}

function buildUI() {
  destroyUI();

  const c = currentTheme.primary;
  const borderColor = currentTheme.border;

  // ── Header Bar ──
  headerBar = blessed.box({
    parent: screen, top: 0, left: 0, width: '100%', height: 1,
    tags: true, style: { bg: 'black', fg: currentTheme.primary }
  });
  updateHeader();

  // ── Main Content Area ──
  mainArea = blessed.box({
    parent: screen, top: 1, left: 0, width: '100%', height: '100%-6',
    style: { bg: 'black' }
  });

  // ── Chat Panel ──
  const chatWidth = compactMode ? '100%' : '65%';
  chatBox = blessed.box({
    parent: mainArea, top: 0, left: 0, width: chatWidth, height: '100%',
    border: { type: 'line' },
    style: { border: { fg: borderColor }, bg: 'black' },
    label: ` {${c}-fg}{bold}NEURAL LINK${conversationTitle ? ' ─ ' + escTags(conversationTitle) : ''}{/} `,
    tags: true
  });

  chatLog = blessed.log({
    parent: chatBox, top: 0, left: 1, width: '100%-4', height: '100%-2',
    tags: true, scrollable: true, alwaysScroll: autoScroll,
    scrollbar: { ch: '│', style: { fg: currentTheme.primary } },
    mouse: true, style: { bg: 'black', fg: 'white' }
  });

  // ── Right Panel (C5: Cyberpunk Dashboard) ──
  if (!compactMode) {
    rightPanel = blessed.box({
      parent: mainArea, top: 0, left: '65%', width: '35%', height: '100%',
      style: { bg: 'black' }
    });

    // C5: SYSTEM panel — CPU/RAM as visual bars
    sysBox = blessed.box({
      parent: rightPanel, top: 0, left: 0, width: '100%', height: 10,
      border: { type: 'line' },
      label: ` {${c}-fg}{bold}┤ SYSTEM ├{/} `,
      tags: true,
      style: { border: { fg: borderColor }, bg: 'black', fg: 'white' }
    });

    // C5: SWARM panel — workers with green dots
    procBox = blessed.box({
      parent: rightPanel, top: 10, left: 0, width: '100%', height: '40%-5',
      border: { type: 'line' },
      label: ` {${c}-fg}{bold}┤ SWARM ├{/} `,
      tags: true,
      style: { border: { fg: borderColor }, bg: 'black', fg: 'white' }
    });

    // C5: SESSION panel
    statusBox = blessed.box({
      parent: rightPanel, top: '40%+5', left: 0, width: '100%', height: '60%-5',
      border: { type: 'line' },
      label: ` {${c}-fg}{bold}┤ SESSION ├{/} `,
      tags: true,
      style: { border: { fg: borderColor }, bg: 'black', fg: 'white' }
    });
  } else {
    rightPanel = null;
    sysBox = null;
    procBox = null;
    statusBox = null;
  }

  // ── Quick Actions Bar ──
  quickActionsBar = blessed.box({
    parent: screen, bottom: 4, left: 0, width: '100%', height: 1,
    tags: true, style: { bg: 'black', fg: currentTheme.primary }
  });
  updateQuickActions();

  // ── Bottom Bar ──
  const bottomBar = blessed.box({
    parent: screen, bottom: 1, left: 0, width: '100%', height: 3,
    style: { bg: 'black' }
  });

  inputBox = blessed.textbox({
    parent: bottomBar, top: 0, left: 0, width: '100%-42', height: 3,
    border: { type: 'line' },
    label: ` {${c}-fg}{bold}MC ▸{/} `,
    tags: true, inputOnFocus: true, mouse: true,
    keys: false, // C3: Prevent blessed from eating keys
    style: {
      border: { fg: borderColor }, bg: 'black', fg: 'white',
      focus: { border: { fg: 'white' } }
    }
  });

  micBtn = blessed.box({
    parent: bottomBar, top: 0, left: '100%-42', width: 9, height: 3,
    border: { type: 'line' }, content: '{center} MIC{/center}',
    tags: true, mouse: true,
    style: { border: { fg: borderColor }, bg: 'black', fg: currentTheme.primary,
             hover: { bg: currentTheme.primary, fg: 'black' } }
  });

  blessed.box({
    parent: bottomBar, top: 0, left: '100%-33', width: 33, height: 3,
    border: { type: 'line' }, tags: true,
    content: `{center}{${c}-fg}^J{/}:Mic │ {magenta-fg}^K{/}:Swarm │ {${c}-fg}F1{/}:Help │ {${c}-fg}^Q{/}:Quit{/center}`,
    style: { border: { fg: borderColor }, bg: 'black', fg: 'white' }
  });

  // ── Status Bar ──
  shortcutBar = blessed.box({
    parent: screen, bottom: 0, left: 0, width: '100%', height: 1,
    tags: true, style: { bg: 'black', fg: currentTheme.primary }
  });
  updateStatusBar();

  // ═══════════════════════════════════════════════════════════
  // SECTION: Key Bindings (CYCLE 6)
  // ═══════════════════════════════════════════════════════════

  // C6: Tab completion with argument hints
  inputBox.key('tab', () => {
    const val = inputBox.getValue();
    if (val.startsWith('/')) {
      const parts = val.split(' ');
      const cmd = parts[0].toLowerCase();
      // If command is complete and has a trailing space, show argument hints
      if (parts.length >= 2 && SLASH_COMMANDS.includes(cmd)) {
        const HINTS = {
          '/theme': Object.keys(THEMES),
          '/persona': Object.keys(PERSONAS),
          '/switch': [...branches.keys()],
          '/load': (() => { try { const d = path.join(__dirname, 'sessions'); return fs.existsSync(d) ? fs.readdirSync(d).filter(f => f.endsWith('.json')).map(f => f.replace('.json', '')) : []; } catch { return []; } })(),
          '/context': ['add', 'list', 'clear', 'remove'],
          '/kill': [],
          '/cat': [],
          '/edit': [],
          '/web': [],
        };
        const hints = HINTS[cmd];
        if (hints && hints.length > 0) {
          const partial = parts.slice(1).join(' ').toLowerCase();
          const filtered = partial ? hints.filter(h => h.toLowerCase().startsWith(partial)) : hints;
          if (filtered.length === 1) {
            inputBox.setValue(cmd + ' ' + filtered[0]);
            queueRender();
          } else if (filtered.length > 0) {
            chatLog.log(`{gray-fg}  ${filtered.join('  ')}{/}`);
            queueRender();
          }
        }
        return;
      }
      const matches = SLASH_COMMANDS.filter(c => c.startsWith(val.toLowerCase()));
      if (matches.length === 1) {
        inputBox.setValue(matches[0] + ' ');
        queueRender();
      } else if (matches.length > 1) {
        chatLog.log(`{gray-fg}  ${matches.join('  ')}{/}`);
        queueRender();
      }
    }
  });

  // C6: Ctrl bindings on inputBox (+ screen-level for when input not focused)
  const bindBoth = (key, fn) => {
    inputBox.key(key, fn);
    screen.key([key], fn);
  };

  bindBoth('C-j', () => { activateMic(); });
  bindBoth('C-k', () => {
    chatLog.log('{magenta-fg}[SWARM]{/} Enter task for swarm processing:');
    queueRender();
    swarmMode = true;
    inputBox.focus();
  });
  bindBoth('C-l', () => { refreshDashboard(); });
  bindBoth('C-q', () => { confirmQuit(); });
  bindBoth('C-s', () => { toggleAutoScroll(); });

  // C6: F-keys on both
  inputBox.key('f1', () => { showHelpOverlay(); });
  inputBox.key('f2', () => { activateMic(); });
  inputBox.key('f5', () => { refreshDashboard(); });
  screen.key(['f1'], () => { showHelpOverlay(); });
  screen.key(['f2'], () => { activateMic(); });
  screen.key(['f3'], () => {
    chatLog.log('{magenta-fg}[SWARM]{/} Enter task for swarm processing:');
    queueRender();
    swarmMode = true;
    inputBox.focus();
  });
  screen.key(['f5'], () => { refreshDashboard(); });

  // C6: Escape on both
  inputBox.key('escape', () => { confirmQuit(); });
  screen.key(['escape'], () => { confirmQuit(); });

  // C6: Shift+Enter for multi-line
  inputBox.key('S-enter', () => {
    const val = inputBox.getValue();
    pasteBuffer.push(val);
    inputBox.clearValue();
    chatLog.log(`{gray-fg}  + line added (${pasteBuffer.length} lines buffered, Enter to send){/}`);
    queueRender();
    inputBox.focus();
  });

  // C3: Input history — instant, no render on mere navigation
  inputBox.key('up', () => {
    if (inputHistory.length === 0) return;
    if (historyIdx > 0) { historyIdx--; }
    else if (historyIdx === -1) { historyIdx = inputHistory.length - 1; }
    inputBox.setValue(inputHistory[historyIdx] || '');
    queueRender();
  });
  inputBox.key('down', () => {
    if (historyIdx < inputHistory.length - 1) {
      historyIdx++;
      inputBox.setValue(inputHistory[historyIdx] || '');
    } else {
      historyIdx = inputHistory.length;
      inputBox.clearValue();
    }
    queueRender();
  });

  // Submit
  inputBox.on('submit', (value) => {
    let text = value;
    if (pasteBuffer.length > 0) {
      if (value) pasteBuffer.push(value);
      text = pasteBuffer.join('\n');
      pasteBuffer = [];
    }
    if (text && text.trim()) {
      handleUserInput(text.trim());
    }
    inputBox.clearValue();
    inputBox.focus();
    queueRender();
  });

  // C6: n/N for search navigation (only when search active)
  screen.key(['n'], () => { if (searchMatches.length > 0) navigateSearch(1); });
  screen.key(['S-n'], () => { if (searchMatches.length > 0) navigateSearch(-1); });

  // Mic button click
  micBtn.on('click', () => { activateMic(); });

  // ── Swarm Events ──
  swarm.on('status', msg => { chatLog.log(`{magenta-fg}[SWARM]{/} ${escTags(msg)}`); queueRender(); });
  swarm.on('decomposed', tasks => {
    chatLog.log(`{magenta-fg}[SWARM]{/} Subtasks:`);
    tasks.forEach((t, i) => chatLog.log(`{gray-fg}  ${i + 1}. ${escTags(t)}{/}`));
    queueRender();
  });
  swarm.on('worker_start', w => {
    const loc = w.remote ? '{yellow-fg}[REMOTE]{/}' : '';
    const agent = w.agentName ? ` (${w.agentIcon || ''}${w.agentName})` : '';
    chatLog.log(`{magenta-fg}[SWARM]{/} ${w.id}${agent} ${loc} deployed → ${escTags(w.task.substring(0, 60))}...`);
    queueRender();
  });
  swarm.on('worker_done', w => {
    const elapsed = ((Date.now() - w.startTime) / 1000).toFixed(1);
    const agent = w.agentName ? ` (${w.agentName})` : '';
    chatLog.log(`{green-fg}[SWARM]{/} ${w.id}${agent} complete (${elapsed}s)`);
    queueRender();
  });
  swarm.on('worker_retry', w => { chatLog.log(`{yellow-fg}[SWARM]{/} ${w.id} killed — retrying...`); queueRender(); });
  swarm.on('worker_failed', w => { chatLog.log(`{red-fg}[SWARM]{/} ${w.id} FAILED`); queueRender(); });
  swarm.on('complete', ({ result, stats }) => {
    chatLog.log(`{magenta-fg}[SWARM]{/} ━━━ Mission Complete ━━━`);
    chatLog.log(`{gray-fg}  Workers: ${stats.completed} done, ${stats.failed} failed, ${stats.killed} killed{/}`);
    chatLog.log(`{gray-fg}  Remote workers used: ${stats.remoteWorkers || 0}{/}`);
    chatLog.log(`{gray-fg}  Total time: ${(stats.totalTime / 1000).toFixed(1)}s{/}`);
    chatLog.log(`{bold}{white-fg}ARIES ▸{/} ${escTags(result)}`);
    queueRender();
  });

  // Task Queue Events
  taskQueue.on('added', () => { updateStatusPanel(); });
  taskQueue.on('completed', () => { updateStatusPanel(); });

  // ── Replay chat history ──
  chatHistory.forEach(msg => {
    if (msg.role === 'user') {
      chatLog.log(`{bold}{${c}-fg}MC ▸{/} ${escTags(msg.content)}`);
    } else if (msg.role === 'assistant') {
      chatLog.log(`{bold}{white-fg}ARIES ▸{/} ${formatMarkdown(stripTools(msg.content))}`);
    }
  });

  // Fire plugin onStart handlers
  v2Plugins.forEach(p => {
    if (p.onStart) {
      try { p.onStart({ chatLog, screen, config, escTags }); } catch (e) {
        chatLog.log(`{red-fg}[PLUGIN] ${escTags(p.name)} onStart error: ${escTags(e.message)}{/}`);
      }
    }
  });

  inputBox.focus();
  screen.render(); // Initial paint — direct call is OK here

  // C2: Dashboard refresh at 5000ms minimum
  refreshDashboard();
  const dashMs = Math.max(config.dashRefreshMs || 5000, 5000);
  _dashIntervalId = setInterval(refreshDashboard, dashMs);

  // C2: Status bar refresh at 5000ms
  _statusIntervalId = setInterval(updateStatusBar, 5000);

  testAI();
}

// ═══════════════════════════════════════════════════════════════
// SECTION: UI Update Functions (CYCLE 2 — Cached, CYCLE 5 — Cyberpunk)
// ═══════════════════════════════════════════════════════════════

function toggleAutoScroll() {
  autoScroll = !autoScroll;
  if (chatLog) chatLog.alwaysScroll = autoScroll;
  chatLog.log(`{gray-fg}  Auto-scroll: ${autoScroll ? 'ON' : 'OFF'}{/}`);
  updateStatusBar();
  queueRender();
}

function updateStatusBar() {
  if (!shortcutBar) return;
  const c = currentTheme.primary;
  const scrollIcon = autoScroll ? '▼' : '■';
  const dur = getSessionDuration();
  const modelName = (config.gateway.model || '').split('/').pop();
  const respTime = lastResponseTime > 0 ? `${lastResponseTime}s` : '--';
  const workerCount = coordinator.workerCount || 0;
  const personaName = PERSONAS[currentPersona] ? PERSONAS[currentPersona].name : currentPersona;

  const content = `{${c}-fg} ${modelName} │ ~${sessionStats.tokensEstimate}tok │ ⏱${respTime} │ W:${workerCount} │ ▲${dur} │ 🎭${personaName} │ ⎇${currentBranch} │ Scroll:${scrollIcon} ${' '.repeat(5)}${getTimeStr()}{/}`;
  // C2: Only update if changed
  if (content !== _dashCache.statusBarContent) {
    _dashCache.statusBarContent = content;
    shortcutBar.setContent(content);
    queueRender();
  }
}

function updateQuickActions() {
  if (!quickActionsBar) return;
  const c = currentTheme.primary;
  const actions = [
    { label: 'New Chat', cmd: '/clear' },
    { label: 'Save',     cmd: '/save' },
    { label: 'Export',   cmd: '/export' },
    { label: 'Swarm',    cmd: '/swarm' },
    { label: 'Persona',  cmd: '/persona' },
    { label: 'Branch',   cmd: '/branch' },
  ];
  const bar = actions.map(a => `{${c}-fg}[${a.label}]{/}`).join(' ');
  quickActionsBar.setContent(` ${bar}`);

  quickActionsBar.on('click', (mouse) => {
    const x = mouse.x;
    let pos = 1;
    for (const a of actions) {
      const labelLen = a.label.length + 2;
      if (x >= pos && x < pos + labelLen) {
        if (a.cmd === '/swarm') {
          chatLog.log('{magenta-fg}[SWARM]{/} Enter task for swarm processing:');
          queueRender();
          swarmMode = true;
          inputBox.focus();
        } else if (a.cmd === '/persona') {
          handleUserInput('/persona');
        } else if (a.cmd === '/save') {
          handleUserInput('/save quick');
        } else {
          handleUserInput(a.cmd);
        }
        return;
      }
      pos += labelLen + 1;
    }
  });
}

function updateHeader() {
  if (!headerBar) return;
  const c = currentTheme.primary;
  const sys = sysModule.get();
  const memUsed = (sys.memUsed / 1073741824).toFixed(1);
  const memTotal = (sys.memTotal / 1073741824).toFixed(1);
  const uptime = sysModule.formatUptime((Date.now() - startTime) / 1000);
  const aiStatus = aiOnline ? '{green-fg}●ONLINE{/}' : '{red-fg}●OFFLINE{/}';
  const remoteCount = coordinator.workerCount;
  const workerStr = remoteCount > 0 ? ` ══ W:${remoteCount}` : '';
  const titleStr = conversationTitle ? ` ══ ${escTags(conversationTitle)}` : '';

  const content = `{${c}-fg}{bold}╔══ ARIES v3.0 ══ Master Control ══ ${getTimeStr()} ══ CPU ${sys.cpu}% ══ RAM ${memUsed}/${memTotal}GB ══ AI:${aiStatus}{${c}-fg}${workerStr}${titleStr} ══ ▲${uptime} ══╗{/}`;
  if (content !== _dashCache.headerContent) {
    _dashCache.headerContent = content;
    headerBar.setContent(content);
  }
}

// C5: Cyberpunk dashboard panels
function updateStatusPanel() {
  if (!statusBox) return;
  const c = currentTheme.primary;
  const ev = events.status();
  const mem = memory.list();
  const qStatus = taskQueue.status();
  const workers = coordinator.getWorkers();

  const lines = [
    ` {${c}-fg}┌─ Info ────────────────────┐{/}`,
    ` {${c}-fg}│{/} 🎭 Persona  ${(PERSONAS[currentPersona] ? PERSONAS[currentPersona].name : currentPersona).padEnd(12)} {${c}-fg}│{/}`,
    ` {${c}-fg}│{/} ⎇  Branch   ${currentBranch.padEnd(12)} {${c}-fg}│{/}`,
    ` {${c}-fg}│{/} 📝 Context  ${String(persistentContext.length).padEnd(12)} {${c}-fg}│{/}`,
    ` {${c}-fg}│{/} 💬 History  ${String(chatHistory.length).padEnd(12)} {${c}-fg}│{/}`,
    ` {${c}-fg}│{/} 🧠 Memory   ${String(mem.length).padEnd(12)} {${c}-fg}│{/}`,
    ` {${c}-fg}│{/} 🔌 Plugins  ${String(loadedPlugins.length + v2Plugins.length).padEnd(12)} {${c}-fg}│{/}`,
    ` {${c}-fg}│{/} 📋 Queue    ${(qStatus.queued + '/' + qStatus.processing).padEnd(12)} {${c}-fg}│{/}`,
    ` {${c}-fg}│{/} 👁 Watchers ${String(ev.watchers).padEnd(12)} {${c}-fg}│{/}`,
    ` {${c}-fg}│{/} ⚙  Model    ${((config.gateway.model || '').split('/').pop()).substring(0, 12).padEnd(12)} {${c}-fg}│{/}`,
    ` {${c}-fg}└────────────────────────────┘{/}`,
  ];

  if (workers.length > 0) {
    lines.push('');
    lines.push(` {${c}-fg}── Remote Workers ──{/}`);
    workers.forEach(w => {
      const statusColor = w.status === 'idle' ? 'green' : (w.status === 'busy' ? 'yellow' : 'red');
      const latency = w.latency < 1000 ? `${w.latency}ms` : `${(w.latency / 1000).toFixed(1)}s`;
      lines.push(` {${statusColor}-fg}◉{/} ${escTags(w.id)} [${w.status}] ${latency}`);
    });
  }

  const content = lines.join('\n');
  if (content !== _dashCache.statusContent) {
    _dashCache.statusContent = content;
    statusBox.setContent(content);
  }
}

async function refreshDashboard() {
  let sys;
  try { sys = await sysModule.refresh(); } catch { return; }
  updateHeader();
  updateStatusBar();

  if (compactMode) { queueRender(); return; }

  // C5: SYSTEM panel with visual bars
  if (sysBox) {
    const c = currentTheme.primary;
    const memPct = sys.memTotal > 0 ? Math.round((sys.memUsed / sys.memTotal) * 100) : 0;
    const diskPct = sys.diskTotal > 0 ? Math.round((sys.diskUsed / sys.diskTotal) * 100) : 0;
    const netUp = sysModule.formatBytes(sys.netUp) + '/s';
    const netDown = sysModule.formatBytes(sys.netDown) + '/s';
    const uptime = sysModule.formatUptime((Date.now() - startTime) / 1000);

    const sysLines = [
      ` {${c}-fg}CPU{/} [${makeBar(sys.cpu)}] ${String(sys.cpu).padStart(3)}%`,
      ` {${c}-fg}RAM{/} [${makeBar(memPct)}] ${String(memPct).padStart(3)}%`,
      ` {${c}-fg}DSK{/} [${makeBar(diskPct)}] ${String(diskPct).padStart(3)}%`,
      ` {${c}-fg}NET{/} {${c}-fg}▲{/}${netUp}  {${c}-fg}▼{/}${netDown}`,
      ` {${c}-fg}UP {/} ${uptime}`,
    ];

    if (sys.gpu) {
      sysLines.push(` {${c}-fg}GPU{/} [${makeBar(sys.gpu.utilization)}] ${sys.gpu.utilization}% ${sys.gpu.temp}°C`);
      sysLines.push(` {${c}-fg}VRM{/} ${sys.gpu.vramUsed}/${sys.gpu.vramTotal}MB`);
    }

    const content = sysLines.join('\n');
    if (content !== _dashCache.sysContent) {
      _dashCache.sysContent = content;
      sysBox.setContent(content);
    }
  }

  // C5: SWARM panel with agents
  if (procBox) {
    const c = currentTheme.primary;
    const swarmStats = swarm.getStats();
    const agents = swarm.getRoster().getSummary();
    
    const swarmLines = [];
    // Agent roster with status
    agents.forEach(a => {
      const sIcon = a.status === 'idle' ? '{gray-fg}○{/}' : a.status === 'working' ? `{${a.color}-fg}●{/}` : `{yellow-fg}◐{/}`;
      const taskHint = a.currentTask ? ` ${a.currentTask.substring(0, 15)}` : '';
      swarmLines.push(` ${sIcon} ${a.icon} ${a.name.padEnd(10)} {gray-fg}${taskHint}{/}`);
    });

    swarmLines.push('');
    const relayWorkerCount = _relayCache ? Object.keys(_relayCache.workers || {}).length : 0;
    const relayStatus = _relayCache ? `${_relayCache.completed || 0} done` : '{red-fg}off{/}';
    swarmLines.push(` {${c}-fg}Relay{/} ${relayStatus} {${c}-fg}Tok{/} ${swarmStats.tokens || 0}`);

    const content = swarmLines.join('\n');
    if (content !== _dashCache.procContent) {
      _dashCache.procContent = content;
      procBox.setContent(content);
    }
  }

  updateStatusPanel();
  queueRender();
}

// ═══════════════════════════════════════════════════════════════
// SECTION: Help Overlay (F1)
// ═══════════════════════════════════════════════════════════════

function showHelpOverlay() {
  if (helpOverlay) { helpOverlay.detach(); helpOverlay = null; screen.render(); return; }
  const c = currentTheme.primary;
  const content = [
    `{bold}{${c}-fg}═══ ARIES v3.0 — Help ═══{/}`,
    '',
    '{bold}Keybinds:{/}',
    `  {${c}-fg}F1{/}           Toggle this help`,
    `  {${c}-fg}F2 / Ctrl+J{/}  Voice input`,
    `  {${c}-fg}F3 / Ctrl+K{/}  Swarm mode`,
    `  {${c}-fg}F5 / Ctrl+L{/}  Refresh dashboard`,
    `  {${c}-fg}Ctrl+S{/}       Toggle auto-scroll`,
    `  {${c}-fg}Ctrl+Q / Esc{/} Quit`,
    `  {${c}-fg}Shift+Enter{/}  Multi-line input`,
    `  {${c}-fg}Tab{/}          Complete commands`,
    `  {${c}-fg}Up/Down{/}      Input history`,
    `  {${c}-fg}n/N{/}          Next/prev search match`,
    `  {${c}-fg}!cmd{/}         Execute shell command`,
    '',
    '{bold}Commands:{/}',
    ...Object.entries(COMMAND_DESCRIPTIONS).map(([cmd, desc]) =>
      `  {${c}-fg}${cmd.padEnd(16)}{/} ${desc}`
    ),
    '',
    `{gray-fg}Press Escape/Q/F1 to close{/}`,
  ];

  helpOverlay = blessed.box({
    parent: screen, top: 'center', left: 'center',
    width: '70%', height: '80%',
    border: { type: 'line' },
    label: ` {${c}-fg}{bold}HELP{/} `,
    tags: true, scrollable: true, mouse: true, keys: true,
    alwaysScroll: true,
    scrollbar: { ch: '│', style: { fg: currentTheme.primary } },
    content: content.join('\n'),
    style: { border: { fg: currentTheme.border }, bg: 'black', fg: 'white' }
  });
  helpOverlay.focus();
  helpOverlay.key(['escape', 'q', 'f1'], () => {
    helpOverlay.detach();
    helpOverlay = null;
    inputBox.focus();
    screen.render();
  });
  screen.render(); // Overlay needs immediate paint
}

// ═══════════════════════════════════════════════════════════════
// SECTION: Command Palette
// ═══════════════════════════════════════════════════════════════

function showCommandPalette() {
  if (commandPalette) { commandPalette.detach(); commandPalette = null; screen.render(); return; }
  const c = currentTheme.primary;
  const items = Object.entries(COMMAND_DESCRIPTIONS).map(([cmd, desc]) => `${cmd}  ${desc}`);

  commandPalette = blessed.list({
    parent: screen, top: 'center', left: 'center',
    width: '50%', height: Math.min(items.length + 2, 25),
    border: { type: 'line' },
    label: ` {${c}-fg}{bold}Commands{/} `,
    tags: true, items, mouse: true, keys: true, vi: true,
    scrollbar: { ch: '│', style: { fg: currentTheme.primary } },
    style: {
      border: { fg: currentTheme.border }, bg: 'black', fg: 'white',
      selected: { bg: currentTheme.primary, fg: 'black' },
      item: { bg: 'black', fg: 'white' }
    }
  });
  commandPalette.focus();
  commandPalette.on('select', (item, idx) => {
    const cmd = Object.keys(COMMAND_DESCRIPTIONS)[idx];
    commandPalette.detach();
    commandPalette = null;
    inputBox.setValue(cmd + ' ');
    inputBox.focus();
    screen.render();
  });
  commandPalette.key(['escape', 'q'], () => {
    commandPalette.detach();
    commandPalette = null;
    inputBox.focus();
    screen.render();
  });
  screen.render(); // Overlay needs immediate paint
}

// ═══════════════════════════════════════════════════════════════
// SECTION: Search Navigation
// ═══════════════════════════════════════════════════════════════

function navigateSearch(direction) {
  if (searchMatches.length === 0) return;
  searchMatchIdx = (searchMatchIdx + direction + searchMatches.length) % searchMatches.length;
  const match = searchMatches[searchMatchIdx];
  const c = currentTheme.primary;
  const role = match.role === 'user' ? `{${c}-fg}MC{/}` : '{white-fg}ARIES{/}';
  const snippet = match.content.substring(0, 120);
  const hl = escTags(snippet).replace(
    new RegExp(escTags(searchQuery).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
    (m) => `{yellow-bg}{black-fg}${m}{/}`
  );
  chatLog.log(`{gray-fg}  [${searchMatchIdx + 1}/${searchMatches.length}]{/} ${role}: ${hl}`);
  queueRender();
}

// ═══════════════════════════════════════════════════════════════
// SECTION: Thinking Spinner
// ═══════════════════════════════════════════════════════════════

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function showThinking() {
  const start = Date.now();
  let frameIdx = 0;
  thinkingBox = blessed.text({
    parent: chatBox, bottom: 0, left: 1, width: '100%-4', height: 1,
    content: `{yellow-fg}${SPINNER_FRAMES[0]} Processing... 0.0s{/}`,
    tags: true, style: { fg: 'yellow', bg: 'black' }
  });
  queueRender();

  const interval = setInterval(() => {
    if (!thinkingBox) { clearInterval(interval); return; }
    frameIdx = (frameIdx + 1) % SPINNER_FRAMES.length;
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    thinkingBox.setContent(`{yellow-fg}${SPINNER_FRAMES[frameIdx]} Processing... ${elapsed}s{/}`);
    queueRender();
  }, 80);

  return { start, interval };
}

function hideThinking(timer) {
  if (timer) clearInterval(timer.interval);
  if (thinkingBox) { thinkingBox.detach(); thinkingBox = null; }
  if (timer) return ((Date.now() - timer.start) / 1000).toFixed(1);
  return '0.0';
}

// ═══════════════════════════════════════════════════════════════
// SECTION: Stream Effect
// ═══════════════════════════════════════════════════════════════

function renderWithStreamEffect(text, callback) {
  if (!streamEffect || text.length > 2000) {
    formatMarkdown(text).split('\n').forEach(line => chatLog.log(`  ${line}`));
    queueRender();
    if (callback) callback();
    return;
  }

  const lines = text.split('\n');
  let lineIdx = 0;
  let idx = 0;

  const interval = setInterval(() => {
    if (lineIdx >= lines.length) {
      clearInterval(interval);
      queueRender();
      if (callback) callback();
      return;
    }

    const line = lines[lineIdx];
    idx += Math.min(5, line.length - idx);
    if (idx >= line.length) {
      chatLog.log(`  ${formatMarkdown(line)}`);
      lineIdx++;
      idx = 0;
      queueRender();
    }
  }, 2);
}

// ═══════════════════════════════════════════════════════════════
// SECTION: Auto-title (CYCLE 7)
// ═══════════════════════════════════════════════════════════════

async function autoGenerateTitle() {
  if (conversationTitle || chatHistory.length < 3) return;
  try {
    const recentMsgs = chatHistory.slice(0, 4).map(m => `${m.role}: ${m.content.substring(0, 100)}`).join('\n');
    const titleResult = await ai.chat([
      { role: 'system', content: 'Generate a very short title (3-6 words) for this conversation. Return ONLY the title, nothing else.' },
      { role: 'user', content: recentMsgs }
    ]);
    if (titleResult && titleResult.response) {
      conversationTitle = titleResult.response.trim().replace(/['"]/g, '').substring(0, 50);
      const branch = branches.get(currentBranch);
      if (branch) branch.title = conversationTitle;
      if (chatBox) {
        const c = currentTheme.primary;
        chatBox.setLabel(` {${c}-fg}{bold}NEURAL LINK ─ ${escTags(conversationTitle)}{/} `);
      }
      updateHeader();
      queueRender();
    }
  } catch {}
}

// ═══════════════════════════════════════════════════════════════
// SECTION: AI Interaction (CYCLE 7)
// ═══════════════════════════════════════════════════════════════

async function testAI() {
  try {
    const fetch = require('node-fetch');
    const resp = await fetch(config.gateway.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.gateway.token}` },
      body: JSON.stringify({ model: config.gateway.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 10 }),
      timeout: 10000
    });
    aiOnline = resp.ok;
  } catch {
    aiOnline = false;
  }
  updateHeader();
  queueRender();
}

async function handleUserInput(text) {
  const c = currentTheme.primary;
  const ts = getTimestamp();

  // Track input history
  inputHistory.push(text);
  historyIdx = inputHistory.length;
  sessionStats.messagesSent++;
  updateStatusBar();

  // ── Shell command handler (!) ──
  if (text.startsWith('!')) {
    const shellCmd = text.substring(1).trim();
    if (!shellCmd) return;
    chatLog.log(`{gray-fg}[${ts}]{/} {bold}{${c}-fg}MC ▸{/} ${escTags(text)}`);
    chatLog.log(`{gray-fg}Executing: ${escTags(shellCmd)}{/}`);
    queueRender();
    try {
      const result = await tools.shell(shellCmd);
      chatLog.log(result.success ? escTags(result.output) : `{red-fg}${escTags(result.output)}{/}`);
    } catch (e) { chatLog.log(`{red-fg}Error: ${escTags(e.message)}{/}`); }
    queueRender();
    return;
  }

  // ── Swarm mode intercept ──
  if (swarmMode) {
    swarmMode = false;
    chatLog.log(`{gray-fg}[${ts}]{/} {bold}{${c}-fg}MC ▸{/} ${escTags(text)}`);
    chatLog.log(`{magenta-fg}[SWARM]{/} ━━━ Activating Swarm ━━━`);
    queueRender();
    swarm.execute(text).catch(e => {
      chatLog.log(`{red-fg}[SWARM] Error: ${escTags(e.message)}{/}`);
      queueRender();
    });
    return;
  }

  // ── Slash commands ──
  if (text.startsWith('/')) {
    return handleSlashCommand(text, ts, c);
  }

  // ── Normal AI chat ──
  chatLog.log(`{gray-fg}[${ts}]{/} {bold}{${c}-fg}MC ▸{/} ${escTags(text)}`);
  chatHistory.push({ role: 'user', content: text });
  sessionStats.tokensEstimate += Math.ceil(text.length / 4);

  // Notify plugins
  v2Plugins.forEach(p => {
    if (p.onMessage) {
      try { p.onMessage({ role: 'user', content: text, chatLog, screen, escTags }); } catch {}
    }
  });

  const timer = showThinking();

  try {
    // C7: Build messages with persona + persistent context
    const systemParts = [PERSONAS[currentPersona].prompt];
    if (persistentContext.length > 0) {
      systemParts.push('\n\nPersistent Context:\n' + persistentContext.map((ctx, i) => `${i + 1}. ${ctx}`).join('\n'));
    }

    const messages = [
      { role: 'system', content: systemParts.join('') },
      ...chatHistory.slice(-config.maxHistory)
    ];

    streamBuffer = '';
    let streamLine = '';
    let firstToken = true;

    const result = await ai.chatStream(messages, (token) => {
      if (firstToken) {
        hideThinking(timer);
        firstToken = false;
        chatLog.log(`{gray-fg}[${getTimestamp()}]{/} {bold}{white-fg}ARIES ▸{/} `);
      }
      streamBuffer += token;
      streamLine += token;
      if (token.includes('\n')) {
        const parts = streamLine.split('\n');
        for (let i = 0; i < parts.length - 1; i++) {
          if (parts[i].trim()) chatLog.log(`  ${formatMarkdown(parts[i])}`);
        }
        streamLine = parts[parts.length - 1];
      }
      queueRender();
    }, (toolCall) => {
      const argStr = toolCall.args[0] ? toolCall.args[0].substring(0, 60) : '';
      chatLog.log(`{magenta-fg}  ▸ [${toolCall.tool.toUpperCase()}] ${escTags(argStr)}{/}`);
      queueRender();
    });

    const elapsed = firstToken ? hideThinking(timer) : ((Date.now() - timer.start) / 1000).toFixed(1);
    lastResponseTime = parseFloat(elapsed);

    // Flush remaining stream buffer
    if (streamLine.trim()) chatLog.log(`  ${formatMarkdown(streamLine)}`);

    // Non-stream fallback
    if (firstToken) {
      hideThinking(timer);
      const cleanResponse = stripTools(result.response);
      if (cleanResponse) {
        chatLog.log(`{gray-fg}[${getTimestamp()}]{/} {bold}{white-fg}ARIES ▸{/}`);
        if (streamEffect && cleanResponse.length <= 2000) {
          renderWithStreamEffect(cleanResponse);
        } else {
          formatMarkdown(cleanResponse).split('\n').forEach(line => chatLog.log(`  ${line}`));
        }
      }
    }

    // C7: Show timing subtly
    chatLog.log(`{gray-fg}  (${elapsed}s${result.iterations > 1 ? ' · ' + result.iterations + ' iterations' : ''}){/}`);

    sessionStats.tokensEstimate += Math.ceil((result.response || '').length / 4);
    updateStatusBar();

    if (soundOnResponse) { try { process.stdout.write('\x07'); } catch {} }

    chatHistory.push({ role: 'assistant', content: result.response });

    // Notify plugins
    v2Plugins.forEach(p => {
      if (p.onMessage) {
        try { p.onMessage({ role: 'assistant', content: result.response, chatLog, screen, escTags }); } catch {}
      }
    });

    // Trim history
    if (chatHistory.length > config.maxHistory * 2) {
      chatHistory = chatHistory.slice(-config.maxHistory);
    }

    saveHistory();
    aiOnline = true;

    // C7: Auto-title after 3 messages
    if (chatHistory.length >= 3 && !conversationTitle) {
      autoGenerateTitle();
    }

  } catch (e) {
    hideThinking(timer);
    // C7: Helpful error messages
    let errMsg = e.message || String(e);
    if (errMsg.includes('ECONNREFUSED')) {
      errMsg = 'Cannot reach AI gateway — is it running? Check config.json gateway.url';
    } else if (errMsg.includes('API 401')) {
      errMsg = 'Authentication failed — check your API token in config.json';
    } else if (errMsg.includes('API 429')) {
      errMsg = 'Rate limited — too many requests. Wait a moment and try again.';
    } else if (errMsg.includes('API 5')) {
      errMsg = 'AI server error — the model may be overloaded. Try again shortly.';
    }
    chatLog.log(`{red-fg}  ✗ ${escTags(errMsg)}{/}`);
    aiOnline = false;
  }

  updateHeader();
  queueRender();
  inputBox.focus();
}

// ═══════════════════════════════════════════════════════════════
// SECTION: Slash Command Handler (CYCLE 9 — Feature Polish)
// ═══════════════════════════════════════════════════════════════

async function handleSlashCommand(text, ts, c) {
  const spaceIdx = text.indexOf(' ');
  const cmd = spaceIdx > 0 ? text.substring(0, spaceIdx).toLowerCase() : text.toLowerCase();
  const args = spaceIdx > 0 ? text.substring(spaceIdx + 1).trim() : '';

  // Check v2 plugin commands first
  for (const plugin of v2Plugins) {
    if (plugin.commands && plugin.commands[cmd]) {
      chatLog.log(`{gray-fg}[${ts}]{/} {bold}{${c}-fg}MC ▸{/} ${escTags(text)}`);
      try {
        await plugin.commands[cmd]({ args, chatLog, screen, escTags, config, chatHistory });
      } catch (e) {
        chatLog.log(`{red-fg}[PLUGIN] ${escTags(plugin.name)} error: ${escTags(e.message)}{/}`);
      }
      queueRender();
      return;
    }
  }

  // Command palette on bare "/"
  if (text === '/') { showCommandPalette(); return; }

  // Log the command
  const logCmd = () => chatLog.log(`{gray-fg}[${ts}]{/} {bold}{${c}-fg}MC ▸{/} ${escTags(text)}`);

  // ── Branches ──
  if (cmd === '/branch') {
    logCmd();
    if (!args) { chatLog.log('Usage: /branch <name>'); queueRender(); return; }
    branches.set(currentBranch, { history: [...chatHistory], title: conversationTitle });
    branches.set(args, { history: [...chatHistory], title: conversationTitle });
    chatLog.log(`{green-fg}  Branch "${escTags(args)}" created from current state (${chatHistory.length} messages){/}`);
    queueRender();
    return;
  }

  if (cmd === '/branches') {
    logCmd();
    chatLog.log(`{${c}-fg}━━━ Conversation Branches ━━━{/}`);
    for (const [name, branch] of branches) {
      const marker = name === currentBranch ? '{green-fg}*{/}' : ' ';
      const title = branch.title ? ` ─ ${escTags(branch.title)}` : '';
      chatLog.log(`  ${marker} {bold}${escTags(name)}{/} (${branch.history.length} msgs)${title}`);
    }
    queueRender();
    return;
  }

  if (cmd === '/switch') {
    logCmd();
    if (!args) { chatLog.log('Usage: /switch <branch-name>'); queueRender(); return; }
    if (!branches.has(args)) {
      chatLog.log(`{red-fg}  Branch "${escTags(args)}" not found. Use /branches to list.{/}`);
      queueRender();
      return;
    }
    branches.set(currentBranch, { history: [...chatHistory], title: conversationTitle });
    currentBranch = args;
    const branch = branches.get(args);
    chatHistory = [...branch.history];
    conversationTitle = branch.title || '';
    chatLog.setContent('');
    chatHistory.forEach(msg => {
      if (msg.role === 'user') chatLog.log(`{bold}{${c}-fg}MC ▸{/} ${escTags(msg.content)}`);
      else if (msg.role === 'assistant') chatLog.log(`{bold}{white-fg}ARIES ▸{/} ${formatMarkdown(stripTools(msg.content))}`);
    });
    chatLog.log(`{green-fg}  Switched to branch "${escTags(args)}"{/}`);
    updateHeader();
    updateStatusBar();
    queueRender();
    return;
  }

  // ── Personas ──
  if (cmd === '/persona') {
    logCmd();
    if (!args) {
      chatLog.log(`{${c}-fg}━━━ Personas ━━━{/}`);
      for (const [id, p] of Object.entries(PERSONAS)) {
        const marker = id === currentPersona ? '{green-fg}*{/}' : ' ';
        chatLog.log(`  ${marker} {bold}${id}{/} ─ ${escTags(p.name)}`);
      }
      chatLog.log('');
      chatLog.log('  Usage: /persona <name>');
      chatLog.log('  Create: /persona create <name> <description>');
      queueRender();
      return;
    }
    if (args.startsWith('create ')) {
      const createArgs = args.substring(7).trim();
      const firstSpace = createArgs.indexOf(' ');
      if (firstSpace < 0) { chatLog.log('Usage: /persona create <name> <description>'); queueRender(); return; }
      const pName = createArgs.substring(0, firstSpace).toLowerCase();
      const pDesc = createArgs.substring(firstSpace + 1).trim();
      PERSONAS[pName] = { name: pName.charAt(0).toUpperCase() + pName.slice(1), prompt: pDesc };
      currentPersona = pName;
      chatLog.log(`{green-fg}  Created and switched to persona "${escTags(pName)}"{/}`);
      updateStatusBar();
      queueRender();
      return;
    }
    const pKey = args.toLowerCase();
    if (!PERSONAS[pKey]) {
      chatLog.log(`{red-fg}  Unknown persona "${escTags(args)}". Use /persona to list.{/}`);
      queueRender();
      return;
    }
    currentPersona = pKey;
    chatLog.log(`{green-fg}  Persona switched to: ${PERSONAS[pKey].name}{/}`);
    chatLog.log(`{gray-fg}  ${escTags(PERSONAS[pKey].prompt.substring(0, 100))}...{/}`);
    updateStatusBar();
    queueRender();
    return;
  }

  // ── Context ──
  if (cmd === '/context') {
    logCmd();
    if (!args || args === 'list') {
      if (persistentContext.length === 0) {
        chatLog.log('{gray-fg}  No persistent context set. Use /context add <text>{/}');
      } else {
        chatLog.log(`{${c}-fg}━━━ Persistent Context ━━━{/}`);
        persistentContext.forEach((ctx, i) => chatLog.log(`  {${c}-fg}[${i}]{/} ${escTags(ctx)}`));
      }
      queueRender();
      return;
    }
    if (args.startsWith('add ')) {
      const ctxText = args.substring(4).trim();
      if (!ctxText) { chatLog.log('Usage: /context add <text>'); queueRender(); return; }
      persistentContext.push(ctxText);
      chatLog.log(`{green-fg}  Context added (${persistentContext.length} items total){/}`);
      updateStatusPanel();
      queueRender();
      return;
    }
    if (args === 'clear') {
      const count = persistentContext.length;
      persistentContext.length = 0;
      chatLog.log(`{green-fg}  Cleared ${count} context items{/}`);
      updateStatusPanel();
      queueRender();
      return;
    }
    if (args.startsWith('remove ')) {
      const idx = parseInt(args.substring(7));
      if (isNaN(idx) || idx < 0 || idx >= persistentContext.length) {
        chatLog.log(`{red-fg}  Invalid index. Use /context list{/}`);
      } else {
        persistentContext.splice(idx, 1);
        chatLog.log(`{green-fg}  Removed context item ${idx}{/}`);
      }
      queueRender();
      return;
    }
    chatLog.log('Usage: /context add <text> | /context list | /context clear | /context remove <n>');
    queueRender();
    return;
  }

  // ── Copy ──
  if (cmd === '/copy') {
    logCmd();
    const idx = parseInt(args);
    if (isNaN(idx) || idx < 0 || idx >= chatHistory.length) {
      chatLog.log(`{red-fg}  Invalid index. Range: 0-${chatHistory.length - 1}{/}`);
      queueRender();
      return;
    }
    const msg = chatHistory[idx];
    const content = msg.role === 'assistant' ? stripTools(msg.content) : msg.content;
    try {
      const clipProc = spawn('clip', [], { stdio: ['pipe', 'ignore', 'ignore'] });
      clipProc.stdin.write(content);
      clipProc.stdin.end();
      chatLog.log(`{green-fg}  Copied message #${idx} to clipboard (${content.length} chars){/}`);
    } catch (e) {
      chatLog.log(`{red-fg}  Clipboard error: ${escTags(e.message)}{/}`);
    }
    queueRender();
    return;
  }

  // ── Sessions ──
  if (cmd === '/save') {
    logCmd();
    const sessName = args || `session-${Date.now()}`;
    const sessDir = path.join(__dirname, 'sessions');
    const sessFile = path.join(sessDir, `${sessName}.json`);
    try {
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(sessFile, JSON.stringify({
        name: sessName, title: conversationTitle, persona: currentPersona,
        branch: currentBranch, context: persistentContext, history: chatHistory,
        savedAt: new Date().toISOString()
      }, null, 2));
      chatLog.log(`{green-fg}  Session saved: ${escTags(sessName)} (${chatHistory.length} messages){/}`);
    } catch (e) {
      chatLog.log(`{red-fg}  Save failed: ${escTags(e.message)}{/}`);
    }
    queueRender();
    return;
  }

  if (cmd === '/load') {
    logCmd();
    if (!args) { chatLog.log('Usage: /load <session-name>'); queueRender(); return; }
    const sessFile = path.join(__dirname, 'sessions', `${args}.json`);
    try {
      const data = JSON.parse(fs.readFileSync(sessFile, 'utf8'));
      chatHistory = data.history || [];
      conversationTitle = data.title || '';
      if (data.persona && PERSONAS[data.persona]) currentPersona = data.persona;
      if (data.context) persistentContext = data.context;
      if (data.branch) currentBranch = data.branch;
      chatLog.setContent('');
      chatHistory.forEach(msg => {
        if (msg.role === 'user') chatLog.log(`{bold}{${c}-fg}MC ▸{/} ${escTags(msg.content)}`);
        else if (msg.role === 'assistant') chatLog.log(`{bold}{white-fg}ARIES ▸{/} ${formatMarkdown(stripTools(msg.content))}`);
      });
      chatLog.log(`{green-fg}  Loaded session "${escTags(args)}" (${chatHistory.length} messages){/}`);
      updateHeader();
      updateStatusBar();
    } catch (e) {
      chatLog.log(`{red-fg}  Load failed: ${escTags(e.message)}{/}`);
    }
    queueRender();
    return;
  }

  if (cmd === '/sessions') {
    logCmd();
    const sessDir = path.join(__dirname, 'sessions');
    try {
      if (!fs.existsSync(sessDir)) { chatLog.log('{gray-fg}  No saved sessions.{/}'); queueRender(); return; }
      const files = fs.readdirSync(sessDir).filter(f => f.endsWith('.json'));
      if (files.length === 0) { chatLog.log('{gray-fg}  No saved sessions.{/}'); queueRender(); return; }
      chatLog.log(`{${c}-fg}━━━ Saved Sessions ━━━{/}`);
      for (const f of files) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(sessDir, f), 'utf8'));
          const name = f.replace('.json', '');
          const title = data.title ? ` ─ ${escTags(data.title)}` : '';
          chatLog.log(`  {bold}${escTags(name)}{/} (${(data.history || []).length} msgs)${title} {gray-fg}${data.savedAt || ''}{/}`);
        } catch {
          chatLog.log(`  {gray-fg}${escTags(f)} (unreadable){/}`);
        }
      }
    } catch (e) {
      chatLog.log(`{red-fg}  Error: ${escTags(e.message)}{/}`);
    }
    queueRender();
    return;
  }

  // ── Run last code block ──
  if (cmd === '/run') {
    logCmd();
    if (!lastCodeBlock.trim()) {
      chatLog.log('{red-fg}  No code block to run. Chat with AI and get a code block first.{/}');
      queueRender();
      return;
    }
    const lang = lastCodeLang.toLowerCase() || 'js';
    chatLog.log(`{yellow-fg}  Running ${lang} code block...{/}`);
    queueRender();

    let runCmd;
    const tmpDir = path.join(__dirname, 'data');
    try { fs.mkdirSync(tmpDir, { recursive: true }); } catch {}

    if (['js', 'javascript', 'node'].includes(lang)) {
      const tmpFile = path.join(tmpDir, 'tmp_run.js');
      try { fs.writeFileSync(tmpFile, lastCodeBlock); } catch {}
      runCmd = `node "${tmpFile}"`;
    } else if (['python', 'py'].includes(lang)) {
      const tmpFile = path.join(tmpDir, 'tmp_run.py');
      try { fs.writeFileSync(tmpFile, lastCodeBlock); } catch {}
      runCmd = `python "${tmpFile}"`;
    } else if (['powershell', 'ps1', 'pwsh'].includes(lang)) {
      const tmpFile = path.join(tmpDir, 'tmp_run.ps1');
      try { fs.writeFileSync(tmpFile, lastCodeBlock); } catch {}
      runCmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpFile}"`;
    } else {
      runCmd = lastCodeBlock.trim();
    }

    try {
      const result = await tools.shell(runCmd);
      chatLog.log(result.success ? escTags(result.output || '(no output)') : `{red-fg}${escTags(result.output)}{/}`);
    } catch (e) {
      chatLog.log(`{red-fg}  Execution error: ${escTags(e.message)}{/}`);
    }
    queueRender();
    return;
  }

  // ── Health ──
  if (cmd === '/health') {
    logCmd();
    const report = selfHeal.getHealingReport();
    chatLog.log(`{${c}-fg}━━━ Self-Healing Report ━━━{/}`);
    chatLog.log(`  Total crashes logged: ${report.totalCrashes}`);
    chatLog.log(`  Unique patterns: ${report.uniquePatterns}`);
    chatLog.log(`  Last analysis: ${report.lastAnalysis || 'never'}`);
    chatLog.log(`  Healed: ${report.stats.healed} | Skipped: ${report.stats.skipped}`);
    if (report.topIssues.length > 0) {
      chatLog.log(`{${c}-fg}  ── Top Issues ──{/}`);
      report.topIssues.forEach(issue => {
        chatLog.log(`    {yellow-fg}${escTags(issue.signature)}{/} × ${issue.count} (last: ${issue.lastSeen || '?'})`);
      });
    }
    if (report.recentActions.length > 0) {
      chatLog.log(`{${c}-fg}  ── Recent Actions ──{/}`);
      report.recentActions.forEach(a => {
        const icon = a.success ? '{green-fg}✓{/}' : '{red-fg}✗{/}';
        chatLog.log(`    ${icon} ${escTags(a.action.substring(0, 80))}`);
      });
    }
    if (report.totalCrashes === 0) chatLog.log(`  {green-fg}System is healthy — no crashes detected.{/}`);
    queueRender();
    return;
  }

  // ── Swarm ──
  if (cmd === '/swarm' || cmd === '/s') {
    logCmd();
    if (!args) { chatLog.log('Usage: /swarm <task> | /swarm status'); queueRender(); return; }
    if (args.trim() === 'status') {
      const stats = swarm.getStats();
      const agents = swarm.getRoster().getSummary();
      chatLog.log(`{magenta-fg}[SWARM]{/} ━━━ Swarm Status ━━━`);
      chatLog.log(`  Running: ${stats.isRunning ? '{green-fg}YES{/}' : '{gray-fg}NO{/}'} | Workers: ${stats.activeWorkers} | Tokens: ${stats.tokens}`);
      chatLog.log(`  Tasks: ${stats.completed}/${stats.totalTasks} done, ${stats.failed} failed`);
      const working = agents.filter(a => a.status === 'working');
      if (working.length > 0) {
        chatLog.log(`  {${c}-fg}Active Agents:{/}`);
        working.forEach(a => chatLog.log(`    ${a.icon} ${a.name}: ${escTags(a.currentTask || '...')}`));
      }
      queueRender();
      return;
    }
    chatLog.log(`{magenta-fg}[SWARM]{/} ━━━ Activating Swarm ━━━`);
    queueRender();
    swarm.execute(args).catch(e => {
      chatLog.log(`{red-fg}[SWARM] Error: ${escTags(e.message)}{/}`);
      queueRender();
    });
    return;
  }

  if (cmd === '/workers') {
    logCmd();
    // Show agent roster summary
    const agents = swarm.getRoster().getSummary();
    chatLog.log(`{${c}-fg}━━━ Agent Roster ━━━{/}`);
    agents.forEach(a => {
      const statusColor = a.statusColor;
      chatLog.log(`  {${statusColor}-fg}${a.statusIcon}{/} ${a.icon} {bold}${a.name}{/} (${a.role}) {gray-fg}[${a.status}]{/}`);
    });

    const workers = coordinator.getWorkers();
    if (workers.length > 0) {
      chatLog.log(`{${c}-fg}━━━ Remote Workers ━━━{/}`);
      workers.forEach(w => {
        const statusColor = w.status === 'idle' ? 'green' : (w.status === 'busy' ? 'yellow' : 'red');
        chatLog.log(`  {${statusColor}-fg}◉{/} ${escTags(w.id)} [${w.status}] ─ ${escTags(w.info.hostname || 'unknown')} (${w.info.cpus || '?'} CPUs) ─ ${w.tasksCompleted} tasks`);
      });
    }
    const swarmStats = swarm.getStats();
    chatLog.log(`{gray-fg}  Local max: ${config.swarm.maxWorkers} | WebSocket remote: ${workers.length} | Running: ${swarmStats.isRunning}{/}`);
    
    // Also check relay workers
    if (config.relay && config.relay.url) {
      chatLog.log(`{${c}-fg}━━━ Relay Workers (${config.relay.url}) ━━━{/}`);
      const http = require('http');
      const relayUrl = new URL(`${config.relay.url}/api/status`);
      const req = http.request(relayUrl, { headers: { 'X-Aries-Secret': config.relay.secret }, timeout: 5000 }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const status = JSON.parse(data);
            if (status.workers) {
              Object.entries(status.workers).forEach(([id, w]) => {
                chatLog.log(`  {green-fg}◉{/} ${escTags(id)} ─ last seen ${escTags(w.ago)} ago`);
              });
            }
            chatLog.log(`{gray-fg}  Relay uptime: ${Math.round(status.uptime)}s | Completed: ${status.completed} | Failed: ${status.failed} | Pending: ${status.pending}{/}`);
            if (status.config) {
              chatLog.log(`{gray-fg}  AI URL: ${escTags(status.config.aiUrl)} | Model: ${escTags(status.config.aiModel)}{/}`);
            }
          } catch { chatLog.log('{yellow-fg}  Could not parse relay status{/}'); }
          queueRender();
        });
      });
      req.on('error', () => { chatLog.log('{red-fg}  Relay unreachable{/}'); queueRender(); });
      req.on('timeout', () => { req.destroy(); chatLog.log('{red-fg}  Relay timeout{/}'); queueRender(); });
      req.end();
    }
    queueRender();
    return;
  }

  // ── Agents ──
  if (cmd === '/agents') {
    logCmd();
    const agents = swarm.getRoster().getSummary();
    chatLog.log(`{${c}-fg}━━━ Agent Roster ━━━{/}`);
    agents.forEach(a => {
      const statusColor = a.statusColor;
      const taskStr = a.currentTask ? ` → ${escTags(a.currentTask)}` : '';
      chatLog.log(`  {${statusColor}-fg}${a.statusIcon}{/} ${a.icon} {bold}${a.name}{/} (${a.role}) {gray-fg}[${a.status}]{/} {gray-fg}done:${a.tasksCompleted}${taskStr}{/}`);
    });
    const msgs = swarm.getRoster().getMessages(5);
    if (msgs.length > 0) {
      chatLog.log(`{${c}-fg}━━━ Recent Agent Comms ━━━{/}`);
      msgs.forEach(m => {
        chatLog.log(`  {gray-fg}${m.from} → ${m.to}: ${escTags(m.content.substring(0, 80))}{/}`);
      });
    }
    queueRender();
    return;
  }

  // ── Shared Data ──
  if (cmd === '/data') {
    logCmd();
    const sd = swarm.getSharedData();
    if (!args) {
      const all = sd.getAll();
      const keys = Object.keys(all);
      if (keys.length === 0) {
        chatLog.log('{gray-fg}  Shared data store is empty.{/}');
      } else {
        chatLog.log(`{${c}-fg}━━━ Shared Data (${keys.length} keys) ━━━{/}`);
        keys.slice(0, 20).forEach(k => {
          const v = all[k];
          const display = typeof v === 'object' ? JSON.stringify(v).substring(0, 80) : String(v).substring(0, 80);
          chatLog.log(`  {${c}-fg}${escTags(k)}{/} = ${escTags(display)}`);
        });
        if (keys.length > 20) chatLog.log(`{gray-fg}  ... and ${keys.length - 20} more{/}`);
      }
    } else if (args.startsWith('set ')) {
      const setArgs = args.substring(4);
      const eqIdx = setArgs.indexOf('=');
      if (eqIdx < 0) {
        chatLog.log('Usage: /data set key=value');
      } else {
        const key = setArgs.substring(0, eqIdx).trim();
        const val = setArgs.substring(eqIdx + 1).trim();
        sd.set(key, val);
        chatLog.log(`{green-fg}  Set: ${escTags(key)} = ${escTags(val)}{/}`);
      }
    } else if (args.startsWith('get ')) {
      const key = args.substring(4).trim();
      const val = sd.get(key);
      if (val === undefined) {
        chatLog.log(`{gray-fg}  Key "${escTags(key)}" not found.{/}`);
      } else {
        const display = typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val);
        chatLog.log(`  {${c}-fg}${escTags(key)}{/} = ${escTags(display)}`);
      }
    } else if (args === 'clear') {
      sd.clear();
      chatLog.log('{green-fg}  Shared data cleared.{/}');
    } else {
      chatLog.log('Usage: /data [set key=value | get key | clear]');
    }
    queueRender();
    return;
  }

  if (cmd === '/connect') {
    logCmd();
    if (!args) { chatLog.log('Usage: /connect <host:port>'); queueRender(); return; }
    coordinator.connectTo(args);
    chatLog.log(`{${c}-fg}  Connecting to ${escTags(args)}...{/}`);
    queueRender();
    return;
  }

  if (cmd === '/disconnect') {
    logCmd();
    if (!args) { chatLog.log('Usage: /disconnect <worker-id>'); queueRender(); return; }
    const workers = coordinator.getWorkers();
    const worker = workers.find(w => w.id === args);
    if (!worker) {
      chatLog.log(`{red-fg}  Worker "${escTags(args)}" not found.{/}`);
    } else {
      const wData = coordinator.remoteWorkers.get(args);
      if (wData) { try { wData.ws.close(); } catch {} }
      chatLog.log(`{green-fg}  Disconnected: ${escTags(args)}{/}`);
    }
    queueRender();
    return;
  }

  if (cmd === '/export') {
    logCmd();
    const exportPath = args || path.join(__dirname, 'data', `chat-export-${Date.now()}.md`);
    const md = chatHistory.map(msg => {
      const role = msg.role === 'user' ? '**MC**' : '**ARIES**';
      const content = msg.role === 'assistant' ? stripTools(msg.content) : msg.content;
      return `${role}: ${content}`;
    }).join('\n\n---\n\n');
    try {
      fs.mkdirSync(path.dirname(exportPath), { recursive: true });
      fs.writeFileSync(exportPath, `# ARIES Chat Export\n_Exported: ${new Date().toISOString()}_\n_Persona: ${currentPersona} | Branch: ${currentBranch}_\n\n${md}`);
      chatLog.log(`{green-fg}  Exported ${chatHistory.length} messages to ${escTags(exportPath)}{/}`);
    } catch (e) { chatLog.log(`{red-fg}  Export failed: ${escTags(e.message)}{/}`); }
    queueRender();
    return;
  }

  if (cmd === '/theme') {
    logCmd();
    if (!args || !THEMES[args]) {
      chatLog.log(`  Available themes: ${Object.keys(THEMES).map(t => `{bold}${t}{/} (${THEMES[t].name})`).join(', ')}`);
      chatLog.log(`  Current: {bold}${currentThemeName}{/}`);
      chatLog.log('  Usage: /theme <name>');
      queueRender();
      return;
    }
    currentThemeName = args;
    currentTheme = THEMES[args];
    buildUI();
    chatLog.log(`{green-fg}  Theme changed to: ${currentTheme.name}{/}`);
    queueRender();
    return;
  }

  if (cmd === '/compact') {
    logCmd();
    compactMode = !compactMode;
    buildUI();
    chatLog.log(`{green-fg}  Compact mode: ${compactMode ? 'ON' : 'OFF'}{/}`);
    queueRender();
    return;
  }

  if (cmd === '/find') {
    logCmd();
    if (!args) { chatLog.log('Usage: /find <text> (then n/N to navigate)'); queueRender(); return; }
    searchQuery = args;
    searchMatches = [];
    searchMatchIdx = -1;
    const query = args.toLowerCase();
    chatHistory.forEach((msg, i) => {
      if (msg.content.toLowerCase().includes(query)) {
        searchMatches.push({ ...msg, idx: i });
      }
    });
    if (searchMatches.length === 0) {
      chatLog.log(`{gray-fg}  No matches for "${escTags(args)}"{/}`);
    } else {
      chatLog.log(`{green-fg}  ${searchMatches.length} match(es) found. Press n/N to navigate.{/}`);
      searchMatches.forEach((match) => {
        const role = match.role === 'user' ? `{${c}-fg}MC{/}` : '{white-fg}ARIES{/}';
        const snippet = match.content.substring(0, 120);
        const hl = escTags(snippet).replace(
          new RegExp(escTags(args).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
          (m) => `{yellow-bg}{black-fg}${m}{/}`
        );
        chatLog.log(`  {gray-fg}#${match.idx}{/} ${role}: ${hl}`);
      });
    }
    queueRender();
    return;
  }

  // /paste handled in enhanced section below

  if (cmd === '/queue') {
    logCmd();
    const vis = taskQueue.visualize();
    vis.forEach(l => chatLog.log(l));
    queueRender();
    return;
  }

  if (cmd === '/help') {
    logCmd();
    const helpText = [
      `{${c}-fg}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━{/}`,
      `{bold}{white-fg} ARIES v3.0 — Command Reference{/}`,
      `{${c}-fg}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━{/}`,
      '',
      ' {bold}Core:{/}',
      ' /help             Show this reference',
      ' /status           Full system overview',
      ' /clear            Clear chat (with confirmation)',
      ' /exit             Shutdown Aries',
      '',
      ' {bold}System:{/}',
      ' /ps               Top processes by CPU',
      ' /kill <target>    Kill process by name or PID',
      ' /launch <app>     Launch an application',
      ' /files [path]     Directory listing',
      ' /disk             Disk usage',
      ' /net              Network info',
      '',
      ' {bold}Memory:{/}',
      ' /mem              Show memory entries',
      ' /remember <x>     Save to memory',
      ' /forget <id>      Delete memory entry',
      ' /search <q>       Search memory',
      ' /watch <path>     Watch file/folder',
      '',
      ' {bold}Swarm & Agents:{/}',
      ` {magenta-fg}/swarm <task>{/}     Deploy multi-agent swarm`,
      ` /agents           List all agents and status`,
      ` /workers          List agents + remote workers`,
      ` /data [cmd]       View/set shared data store`,
      ` /connect <host>   Connect to remote worker`,
      ` /disconnect <id>  Remove a worker`,
      '',
      ' {bold}Chat:{/}',
      ` /find <text>      Search chat (n/N to navigate)`,
      ` /copy <n>         Copy message to clipboard`,
      ` /export [path]    Export chat as markdown`,
      ` /run              Execute last code block`,
      '',
      ' {bold}Branches:{/}',
      ` /branch <name>    Save conversation branch`,
      ` /branches         List branches`,
      ` /switch <name>    Switch to branch`,
      '',
      ' {bold}Sessions:{/}',
      ` /save <name>      Save session to file`,
      ` /load <name>      Load session from file`,
      ` /sessions         List saved sessions`,
      '',
      ' {bold}Persona & Context:{/}',
      ` /persona [name]   Switch AI persona`,
      ` /context add <x>  Add persistent context`,
      ` /context list     Show active context`,
      ` /context clear    Remove all context`,
      '',
      ' {bold}System Health:{/}',
      ` /health           Self-healing report`,
      '',
      ' {bold}UI:{/}',
      ` /theme <name>     Change theme (${Object.keys(THEMES).join('/')})`,
      ` /compact          Toggle compact mode`,
      ` /paste            Toggle multi-line paste mode`,
      ` /queue            View task queue`,
      '',
      ' {bold}Shortcuts:{/}',
      ' !<command>        Execute shell command directly',
      ` F1                Help overlay`,
      ` F2 / Ctrl+J       Voice input`,
      ' F3 / Ctrl+K       Swarm mode',
      ` F5 / Ctrl+L       Refresh dashboard`,
      ` Ctrl+S            Toggle auto-scroll`,
      ` Ctrl+Q / Escape   Quit`,
      ` Shift+Enter       Multi-line input`,
      ` Tab               Complete slash commands`,
      ` /                 Command palette`,
      ` n/N               Next/prev search match`,
      `{${c}-fg}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━{/}`,
    ];
    helpText.forEach(l => chatLog.log(l));
    queueRender();
    return;
  }

  if (cmd === '/clear') {
    logCmd();
    const dialog = blessed.question({
      parent: screen, top: 'center', left: 'center',
      width: 44, height: 7, border: { type: 'line' },
      label: ` {${c}-fg}Confirm{/} `, tags: true,
      style: { border: { fg: currentTheme.border }, bg: 'black', fg: 'white' }
    });
    dialog.ask(`{bold}Clear ${chatHistory.length} messages?{/} (y/n)`, (err, ok) => {
      if (ok) {
        chatHistory = [];
        conversationTitle = '';
        chatLog.setContent('');
        chatLog.log(`{green-fg}  Chat cleared.{/}`);
        updateHeader();
        saveHistory();
      }
      dialog.detach();
      inputBox.focus();
      screen.render(); // Dialog removal needs immediate paint
    });
    return;
  }

  if (cmd === '/status') {
    logCmd();
    const sys = sysModule.get();
    const memUsed = (sys.memUsed / 1073741824).toFixed(1);
    const memTotal = (sys.memTotal / 1073741824).toFixed(1);
    const uptime = sysModule.formatUptime((Date.now() - startTime) / 1000);
    const memEntries = memory.list();
    const remoteWorkers = coordinator.getWorkers();
    const allPlugins = [...loadedPlugins, ...v2Plugins.map(p => p.name)];
    chatLog.log(`{${c}-fg}━━━ System Status ━━━{/}`);
    chatLog.log(`  CPU: ${sys.cpu}%`);
    chatLog.log(`  RAM: ${memUsed}/${memTotal} GB`);
    if (sys.gpu) chatLog.log(`  GPU: ${sys.gpu.name} ${sys.gpu.utilization}% ${sys.gpu.temp}°C (${sys.gpu.vramUsed}/${sys.gpu.vramTotal}MB)`);
    chatLog.log(`  AI: ${aiOnline ? '{green-fg}ONLINE{/}' : '{red-fg}OFFLINE{/}'}`);
    chatLog.log(`  Model: ${config.gateway.model}`);
    chatLog.log(`  Persona: ${PERSONAS[currentPersona].name}`);
    chatLog.log(`  Branch: ${currentBranch} (${branches.size} total)`);
    chatLog.log(`  Memory: ${memEntries.length} entries`);
    chatLog.log(`  Context: ${persistentContext.length} items`);
    chatLog.log(`  History: ${chatHistory.length} messages`);
    chatLog.log(`  Remote Workers: ${remoteWorkers.length}`);
    chatLog.log(`  Plugins: ${allPlugins.length} (${allPlugins.join(', ') || 'none'})`);
    chatLog.log(`  Uptime: ${uptime}`);
    chatLog.log(`  Theme: ${currentThemeName} (${currentTheme.name})`);
    chatLog.log(`  Session: ${sessionStats.messagesSent} msgs, ~${sessionStats.tokensEstimate} tokens`);
    chatLog.log(`  Stream Effect: ${streamEffect ? 'ON' : 'OFF'}`);
    if (sys.docker) chatLog.log(`  Docker: ${sys.docker.length} containers`);
    chatLog.log(`  Net connections: ${sys.netConns}`);
    queueRender();
    return;
  }

  // /ps handled in enhanced section below

  if (cmd === '/kill') {
    logCmd();
    if (!args) { chatLog.log('Usage: /kill <process name or PID>'); queueRender(); return; }
    try {
      const result = await tools.kill(args);
      chatLog.log(result.success ? `{green-fg}Killed: ${escTags(args)}{/}` : `{red-fg}${escTags(result.output)}{/}`);
    } catch (e) { chatLog.log(`{red-fg}Error: ${escTags(e.message)}{/}`); }
    queueRender();
    return;
  }

  if (cmd === '/launch') {
    logCmd();
    if (!args) { chatLog.log('Usage: /launch <application>'); queueRender(); return; }
    try {
      const result = await tools.launch(args);
      chatLog.log(result.success ? `{green-fg}${escTags(result.output)}{/}` : `{red-fg}${escTags(result.output)}{/}`);
    } catch (e) { chatLog.log(`{red-fg}Error: ${escTags(e.message)}{/}`); }
    queueRender();
    return;
  }

  // /files handled in enhanced section below

  if (cmd === '/disk') {
    logCmd();
    try {
      const result = await tools.shell('Get-PSDrive -PSProvider FileSystem | Format-Table Name, @{N="Used(GB)";E={[math]::Round($_.Used/1GB,1)}}, @{N="Free(GB)";E={[math]::Round($_.Free/1GB,1)}} -AutoSize | Out-String');
      chatLog.log(result.success ? escTags(result.output) : `{red-fg}${escTags(result.output)}{/}`);
    } catch (e) { chatLog.log(`{red-fg}Error: ${escTags(e.message)}{/}`); }
    queueRender();
    return;
  }

  // /net handled in enhanced section below

  if (cmd === '/mem') {
    logCmd();
    const entries = memory.list();
    if (entries.length === 0) { chatLog.log('{gray-fg}  No memory entries.{/}'); }
    else {
      entries.forEach((e, i) => {
        const pColor = { critical: 'red', high: 'yellow', normal: 'white', low: 'gray' }[e.priority] || 'white';
        const tags = (e.tags && e.tags.length) ? ` {gray-fg}[${e.tags.join(',')}]{/}` : '';
        chatLog.log(`  {${c}-fg}[${i}]{/} {${pColor}-fg}●{/} ${escTags(e.text)}${tags} {gray-fg}(${e.category || 'general'} · ${e.timestamp}){/}`);
      });
    }
    queueRender();
    return;
  }

  if (cmd === '/remember') {
    logCmd();
    if (!args) { chatLog.log('Usage: /remember <text>'); queueRender(); return; }
    const count = memory.add(args);
    chatLog.log(`{green-fg}  Saved to memory (${count} entries){/}`);
    queueRender();
    return;
  }

  if (cmd === '/forget') {
    logCmd();
    if (!args) { chatLog.log('Usage: /forget <index>'); queueRender(); return; }
    const idx = parseInt(args);
    const entries = memory.list();
    if (isNaN(idx) || idx < 0 || idx >= entries.length) {
      chatLog.log(`{red-fg}  Invalid index. Use /mem to see entries (0-${entries.length - 1}){/}`);
    } else {
      entries.splice(idx, 1);
      memory.save(entries);
      chatLog.log(`{green-fg}  Removed memory entry ${idx}. ${entries.length} remaining.{/}`);
    }
    queueRender();
    return;
  }

  if (cmd === '/search') {
    logCmd();
    if (!args) { chatLog.log('Usage: /search <query>'); queueRender(); return; }
    const matches = memory.search(args);
    if (matches.length === 0) { chatLog.log('{gray-fg}  No matches found.{/}'); }
    else {
      matches.forEach(e => {
        chatLog.log(`  {${c}-fg}●{/} ${escTags(e.text)} {gray-fg}(${e.category} · ${e.timestamp}){/}`);
      });
    }
    queueRender();
    return;
  }

  if (cmd === '/watch') {
    logCmd();
    if (!args) { chatLog.log('Usage: /watch <path>'); queueRender(); return; }
    const watchIdx = events.watchFile(args, (event, filePath) => {
      chatLog.log(`{yellow-fg}  👁 [${event}] ${escTags(filePath)}{/}`);
      queueRender();
    });
    chatLog.log(`{green-fg}  Watching: ${escTags(args)} (watcher #${watchIdx}){/}`);
    queueRender();
    return;
  }

  if (cmd === '/exit') {
    confirmQuit();
    return;
  }

  // ── Enhanced /files with sizes ──
  if (cmd === '/files') {
    logCmd();
    const dirPath = args || process.cwd();
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      chatLog.log(`{${c}-fg}━━━ ${escTags(dirPath)} ━━━{/}`);
      entries.forEach(e => {
        if (e.isDirectory()) {
          chatLog.log(`  {${c}-fg}📁{/} ${escTags(e.name)}/`);
        } else {
          try {
            const stat = fs.statSync(path.join(dirPath, e.name));
            const size = stat.size < 1024 ? `${stat.size}B` : stat.size < 1048576 ? `${(stat.size / 1024).toFixed(1)}KB` : `${(stat.size / 1048576).toFixed(1)}MB`;
            chatLog.log(`  {white-fg}📄{/} ${escTags(e.name).padEnd(30)} {gray-fg}${size}{/}`);
          } catch {
            chatLog.log(`  {white-fg}📄{/} ${escTags(e.name)}`);
          }
        }
      });
      chatLog.log(`{gray-fg}  ${entries.length} items{/}`);
    } catch (e) { chatLog.log(`{red-fg}Error: ${escTags(e.message)}{/}`); }
    queueRender();
    return;
  }

  // ── /cat <file> — display file contents ──
  if (cmd === '/cat') {
    logCmd();
    if (!args) { chatLog.log('Usage: /cat <file path>'); queueRender(); return; }
    try {
      const content = fs.readFileSync(args, 'utf8');
      const lines = content.split('\n');
      const ext = path.extname(args).replace('.', '') || 'text';
      chatLog.log(`{${c}-fg}━━━ ${escTags(args)} (${lines.length} lines) ━━━{/}`);
      const display = lines.slice(0, 100);
      display.forEach(line => chatLog.log(`  ${escTags(line)}`));
      if (lines.length > 100) chatLog.log(`{gray-fg}  ... (${lines.length - 100} more lines){/}`);
    } catch (e) { chatLog.log(`{red-fg}Error: ${escTags(e.message)}{/}`); }
    queueRender();
    return;
  }

  // ── /edit <file> — open in default editor ──
  if (cmd === '/edit') {
    logCmd();
    if (!args) { chatLog.log('Usage: /edit <file path>'); queueRender(); return; }
    try {
      exec(`start "" "${args}"`, { windowsHide: true });
      chatLog.log(`{green-fg}  Opened ${escTags(args)} in default editor{/}`);
    } catch (e) { chatLog.log(`{red-fg}Error: ${escTags(e.message)}{/}`); }
    queueRender();
    return;
  }

  // ── /web <url> — fetch and display webpage ──
  if (cmd === '/web') {
    logCmd();
    if (!args) { chatLog.log('Usage: /web <url>'); queueRender(); return; }
    chatLog.log(`{gray-fg}  Fetching ${escTags(args)}...{/}`);
    queueRender();
    try {
      const result = await tools.web(args);
      if (result.success) {
        const text = (result.output || '').substring(0, 3000);
        chatLog.log(`{${c}-fg}━━━ ${escTags(args)} ━━━{/}`);
        text.split('\n').slice(0, 60).forEach(line => chatLog.log(`  ${escTags(line)}`));
      } else {
        chatLog.log(`{red-fg}  ${escTags(result.output)}{/}`);
      }
    } catch (e) { chatLog.log(`{red-fg}Error: ${escTags(e.message)}{/}`); }
    queueRender();
    return;
  }

  // ── /browse — built-in browser control ──
  if (cmd === '/browse') {
    logCmd();
    const browser = require('./core/browser');
    if (!browser.isAvailable()) {
      chatLog.log('{red-fg}  Browser unavailable. Run: npm install playwright{/}');
      queueRender();
      return;
    }
    if (!args) {
      chatLog.log('Usage: /browse <url> | /browse click <sel> | /browse screenshot | /browse close');
      queueRender();
      return;
    }
    if (args === 'close') {
      try {
        const result = await browser.close();
        chatLog.log(`{green-fg}  ${escTags(result)}{/}`);
      } catch (e) { chatLog.log(`{red-fg}  ${escTags(e.message)}{/}`); }
      queueRender();
      return;
    }
    if (args === 'screenshot') {
      try {
        if (!browser.isLaunched()) { chatLog.log('{red-fg}  No browser open. Use /browse <url> first.{/}'); queueRender(); return; }
        const p = path.join(__dirname, 'data', `screenshot-${Date.now()}.png`);
        const result = await browser.screenshot(p);
        chatLog.log(`{green-fg}  Screenshot saved: ${escTags(result)}{/}`);
      } catch (e) { chatLog.log(`{red-fg}  ${escTags(e.message)}{/}`); }
      queueRender();
      return;
    }
    if (args.startsWith('click ')) {
      const sel = args.substring(6).trim();
      try {
        if (!browser.isLaunched()) { chatLog.log('{red-fg}  No browser open. Use /browse <url> first.{/}'); queueRender(); return; }
        const result = await browser.click(sel);
        chatLog.log(`{green-fg}  ${escTags(result)}{/}`);
      } catch (e) { chatLog.log(`{red-fg}  ${escTags(e.message)}{/}`); }
      queueRender();
      return;
    }
    // Default: navigate to URL
    chatLog.log(`{gray-fg}  Browsing ${escTags(args)}...{/}`);
    queueRender();
    try {
      const text = await browser.fetchPage(args);
      chatLog.log(`{${c}-fg}━━━ ${escTags(args)} ━━━{/}`);
      (text || '').split('\n').slice(0, 60).forEach(line => chatLog.log(`  ${escTags(line)}`));
      chatLog.log(`{gray-fg}  (${(text || '').length} chars){/}`);
    } catch (e) { chatLog.log(`{red-fg}  ${escTags(e.message)}{/}`); }
    queueRender();
    return;
  }

  // ── Enhanced /ps — top processes with CPU/RAM ──
  if (cmd === '/ps') {
    logCmd();
    try {
      const result = await tools.shell('Get-Process | Sort-Object CPU -Descending | Select-Object -First 15 | Format-Table Name, Id, @{N="CPU(s)";E={[math]::Round($_.CPU,1)}}, @{N="Mem(MB)";E={[math]::Round($_.WorkingSet64/1MB,1)}}, @{N="Threads";E={$_.Threads.Count}} -AutoSize | Out-String');
      chatLog.log(`{${c}-fg}━━━ Top Processes ━━━{/}`);
      chatLog.log(result.success ? escTags(result.output) : `{red-fg}${escTags(result.output)}{/}`);
    } catch (e) { chatLog.log(`{red-fg}Error: ${escTags(e.message)}{/}`); }
    queueRender();
    return;
  }

  // ── Enhanced /net — connections, ports, external IP ──
  if (cmd === '/net') {
    logCmd();
    chatLog.log(`{${c}-fg}━━━ Network Status ━━━{/}`);
    try {
      // Adapters
      const adapters = await tools.shell('Get-NetAdapter | Where-Object Status -eq Up | Format-Table Name, Status, LinkSpeed | Out-String');
      if (adapters.success) chatLog.log(escTags(adapters.output));
      // Local IPs
      const ips = await tools.shell('Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notlike "*Loopback*" } | Format-Table InterfaceAlias, IPAddress | Out-String');
      if (ips.success) chatLog.log(escTags(ips.output));
      // Listening ports
      const ports = await tools.shell('Get-NetTCPConnection -State Listen | Select-Object -First 10 LocalAddress, LocalPort, OwningProcess | Format-Table -AutoSize | Out-String');
      if (ports.success) { chatLog.log(`{${c}-fg}─ Listening Ports (top 10) ─{/}`); chatLog.log(escTags(ports.output)); }
      // External IP
      const extIp = await tools.shell('(Invoke-WebRequest -Uri "https://api.ipify.org" -UseBasicParsing -TimeoutSec 5).Content');
      if (extIp.success) chatLog.log(`  External IP: {bold}${escTags(extIp.output.trim())}{/}`);
    } catch (e) { chatLog.log(`{red-fg}Error: ${escTags(e.message)}{/}`); }
    queueRender();
    return;
  }

  // ── Enhanced /paste — read clipboard ──
  if (cmd === '/paste') {
    logCmd();
    if (args === 'read' || !args) {
      try {
        const result = await tools.shell('Get-Clipboard');
        if (result.success && result.output.trim()) {
          const clip = result.output.trim();
          chatLog.log(`{${c}-fg}━━━ Clipboard Contents ━━━{/}`);
          clip.split('\n').slice(0, 30).forEach(l => chatLog.log(`  ${escTags(l)}`));
          chatLog.log(`{gray-fg}  (${clip.length} chars — type to use as context){/}`);
        } else {
          chatLog.log('{gray-fg}  Clipboard is empty{/}');
        }
      } catch (e) { chatLog.log(`{red-fg}Error: ${escTags(e.message)}{/}`); }
      queueRender();
      return;
    }
    // Legacy paste mode
    pasteBuffer = [];
    chatLog.log(`{green-fg}  Paste mode: Use Shift+Enter for new lines, Enter to send{/}`);
    queueRender();
    return;
  }

  // ── /memory ──
  if (cmd === '/memory') {
    logCmd();
    if (!args || args === 'list') {
      const st = memory.stats();
      chatLog.log(`{${c}-fg}━━━ Memory Bank (${st.total} entries) ━━━{/}`);
      chatLog.log(`  Categories: ${Object.entries(st.byCategory).map(([k,v]) => `${k}:${v}`).join(', ') || 'none'}`);
      chatLog.log(`  Priorities: ${Object.entries(st.byPriority).map(([k,v]) => `${k}:${v}`).join(', ') || 'none'}`);
      const entries = memory.list();
      entries.slice(-15).forEach((e, i) => {
        const pColor = { critical: 'red', high: 'yellow', normal: 'white', low: 'gray' }[e.priority] || 'white';
        chatLog.log(`  {${c}-fg}[${i}]{/} {${pColor}-fg}●{/} ${escTags(e.text)} {gray-fg}(${e.category} · ${e.priority}){/}`);
      });
      if (entries.length > 15) chatLog.log(`{gray-fg}  ... ${entries.length - 15} more entries{/}`);
    } else if (args.startsWith('add ')) {
      const parts = args.substring(4).trim();
      memory.add(parts);
      chatLog.log(`{green-fg}  Memory saved (${memory.list().length} total){/}`);
    } else if (args.startsWith('search ')) {
      const q = args.substring(7).trim();
      const results = memory.search(q);
      if (results.length === 0) chatLog.log('{gray-fg}  No matches.{/}');
      else results.forEach(e => chatLog.log(`  {${c}-fg}●{/} ${escTags(e.text)} {gray-fg}(${e.category}){/}`));
    } else if (args.startsWith('forget ')) {
      const key = args.substring(7).trim();
      if (memory.forget(key)) chatLog.log(`{green-fg}  Forgotten: ${escTags(key)}{/}`);
      else chatLog.log(`{red-fg}  Not found: ${escTags(key)}{/}`);
    } else if (args.startsWith('cat ')) {
      const cat = args.substring(4).trim();
      const results = memory.getByCategory(cat);
      chatLog.log(`{${c}-fg}━━━ Category: ${escTags(cat)} (${results.length}) ━━━{/}`);
      results.forEach(e => chatLog.log(`  {${c}-fg}●{/} ${escTags(e.text)}`));
    } else {
      chatLog.log('Usage: /memory [list|add <text>|search <q>|forget <key>|cat <category>]');
    }
    queueRender();
    return;
  }

  // ── /tools ──
  if (cmd === '/tools') {
    logCmd();
    const toolList = tools.list();
    chatLog.log(`{${c}-fg}━━━ Available Tools (${toolList.length}) ━━━{/}`);
    const descriptions = {
      shell: 'Run PowerShell/CMD commands',
      launch: 'Launch applications',
      kill: 'Kill processes',
      read: 'Read files (with offset/limit)',
      write: 'Write/create files',
      append: 'Append to files',
      edit: 'Find and replace in files',
      delete: 'Delete files (recycle bin)',
      ls: 'List directory contents',
      web: 'Fetch URL content',
      download: 'Download files from URL',
      search: 'Search files by content',
      clipboard: 'Copy to clipboard',
      process: 'List/kill processes',
      sysinfo: 'System stats',
      notify: 'Windows notification',
      open: 'Open file/URL in default app',
      install: 'npm/pip install',
      memory: 'Save to memory',
    };
    toolList.forEach(t => {
      chatLog.log(`  {${c}-fg}▸{/} {bold}${t}{/} — ${descriptions[t] || 'tool'}`);
    });
    const log = tools.getLog();
    if (log.length > 0) {
      chatLog.log(`{${c}-fg}━━━ Recent Executions (last 5) ━━━{/}`);
      log.slice(-5).forEach(e => {
        const icon = e.success ? '{green-fg}✓{/}' : '{red-fg}✗{/}';
        chatLog.log(`  ${icon} ${e.tool} {gray-fg}${e.timestamp}{/}`);
      });
    }
    queueRender();
    return;
  }

  // ── /backup ──
  if (cmd === '/backup') {
    logCmd();
    if (!args || args === 'list') {
      const result = selfUpdate.listBackups();
      if (!result.success) { chatLog.log(`{red-fg}  ${escTags(result.error)}{/}`); queueRender(); return; }
      chatLog.log(`{${c}-fg}━━━ Backups (${result.total}) ━━━{/}`);
      for (const [key, files] of Object.entries(result.backups)) {
        chatLog.log(`  {bold}${escTags(key)}{/} (${files.length} versions)`);
        files.slice(-3).forEach(f => chatLog.log(`    {gray-fg}${escTags(f.name)} (${f.size}B){/}`));
      }
      if (result.total === 0) chatLog.log('{gray-fg}  No backups found.{/}');
    } else if (args.startsWith('restore ')) {
      const file = args.substring(8).trim();
      const result = selfUpdate.restore(file);
      chatLog.log(result.success ? `{green-fg}  Restored: ${escTags(result.restored)}{/}` : `{red-fg}  ${escTags(result.error)}{/}`);
    } else {
      chatLog.log('Usage: /backup [list|restore <file>]');
    }
    queueRender();
    return;
  }

  // ── /update ──
  if (cmd === '/update') {
    logCmd();
    if (!args) {
      chatLog.log(`{${c}-fg}━━━ Self-Update System ━━━{/}`);
      chatLog.log('  /update read <file>     — Read source file');
      chatLog.log('  /update validate <file> — Check JS syntax');
      chatLog.log('  /update log             — Show modification log');
      queueRender();
      return;
    }
    if (args.startsWith('read ')) {
      const file = args.substring(5).trim();
      const result = selfUpdate.readSource(file);
      if (result.success) {
        chatLog.log(`{${c}-fg}━━━ ${escTags(file)} (${result.size}B) ━━━{/}`);
        result.content.split('\n').slice(0, 50).forEach(l => chatLog.log(`  ${escTags(l)}`));
      } else {
        chatLog.log(`{red-fg}  ${escTags(result.error)}{/}`);
      }
    } else if (args.startsWith('validate ')) {
      const file = args.substring(9).trim();
      const result = selfUpdate.validateJS(file);
      chatLog.log(result.success ? `{green-fg}  ✓ ${escTags(file)} is valid{/}` : `{red-fg}  ✗ ${escTags(result.error)}{/}`);
    } else if (args === 'log') {
      const log = selfUpdate.getLog();
      chatLog.log(`{${c}-fg}━━━ Self-Update Log (${log.length}) ━━━{/}`);
      log.slice(-10).forEach(e => {
        const icon = e.success ? '{green-fg}✓{/}' : '{red-fg}✗{/}';
        chatLog.log(`  ${icon} ${e.action} ${escTags(e.file)} {gray-fg}${e.timestamp}{/}`);
      });
    } else {
      chatLog.log('Usage: /update [read|validate|log] <file>');
    }
    queueRender();
    return;
  }

  // Unknown command — send as AI chat
  chatLog.log(`{gray-fg}[${ts}]{/} {bold}{${c}-fg}MC ▸{/} ${escTags(text)}`);
  chatLog.log(`{yellow-fg}  Unknown command: ${escTags(cmd)}. Sending as message...{/}`);
  queueRender();
}

// ═══════════════════════════════════════════════════════════════
// SECTION: History Persistence
// ═══════════════════════════════════════════════════════════════

function saveHistory() {
  try {
    const dir = path.dirname(historyFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(historyFile, JSON.stringify(chatHistory, null, 2));
  } catch {}
}

// ═══════════════════════════════════════════════════════════════
// SECTION: Voice Input
// ═══════════════════════════════════════════════════════════════

function activateMic() {
  if (micRecording) return;
  micRecording = true;

  micBtn.setContent('{center}{red-fg}● REC{/}{/center}');
  micBtn.style.border.fg = 'red';
  queueRender();

  chatLog.log('{bold}{red-fg}  🎤 RECORDING... (10s max){/}');
  queueRender();

  function resetMic() {
    micRecording = false;
    if (micBtn) {
      micBtn.setContent('{center} MIC{/center}');
      micBtn.style.border.fg = currentTheme.border;
    }
    queueRender();
    if (inputBox) inputBox.focus();
  }

  const voicePath = path.join(__dirname, 'voice.ps1');
  const micProc = exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${voicePath}"`, {
    cwd: __dirname, timeout: 10000
  }, (err, stdout) => {
    clearTimeout(micTimeout);
    resetMic();

    if (err) {
      chatLog.log(err.killed
        ? '{yellow-fg}  🎤 Recording timed out{/}'
        : `{red-fg}  🎤 Voice error: ${escTags(err.message.substring(0, 100))}{/}`);
      queueRender();
      return;
    }

    const text = (stdout || '').trim();
    if (!text || text === '__SILENCE__') {
      chatLog.log('{yellow-fg}  🎤 No speech detected{/}');
      queueRender();
      return;
    }
    if (text.startsWith('__ERROR__:')) {
      chatLog.log(`{red-fg}  🎤 ${escTags(text.replace('__ERROR__:', ''))}{/}`);
      queueRender();
      return;
    }

    chatLog.log(`{yellow-fg}  🎤 Heard: "${escTags(text)}"{/}`);
    inputBox.setValue(text);
    queueRender();
  });

  const micTimeout = setTimeout(() => {
    try { micProc.kill(); } catch {}
    resetMic();
    chatLog.log('{yellow-fg}  🎤 Recording timed out (10s){/}');
    queueRender();
  }, 10000);
}

// ═══════════════════════════════════════════════════════════════
// SECTION: Quit
// ═══════════════════════════════════════════════════════════════

function confirmQuit() {
  const dialog = blessed.question({
    parent: screen, top: 'center', left: 'center',
    width: 40, height: 7, border: { type: 'line' },
    label: ` {${currentTheme.primary}-fg}Confirm{/} `,
    tags: true,
    style: { border: { fg: currentTheme.border }, bg: 'black', fg: 'white' }
  });
  dialog.ask('{bold}Shutdown ARIES?{/} (y/n)', (err, ok) => {
    if (ok) {
      saveHistory();
      events.stopAll();
      coordinator.stop();
      process.exit(0);
    }
    dialog.detach();
    inputBox.focus();
    screen.render(); // Dialog removal needs immediate paint
  });
}

// ═══════════════════════════════════════════════════════════════
// SECTION: Launch
// ═══════════════════════════════════════════════════════════════

loadV2Plugins();

runBootSequence(() => {
  buildUI();
  const c = currentTheme.primary;
  chatLog.log(`{${c}-fg}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━{/}`);
  chatLog.log(`{bold}{white-fg}  ARIES v3.0 — Neural Link Established{/}`);
  chatLog.log('{gray-fg}  Type a command or question. Full autonomy enabled.{/}');
  chatLog.log('{gray-fg}  / for command palette · F1 for help · Shift+Enter for multi-line{/}');
  if (loadedPlugins.length > 0) chatLog.log(`{gray-fg}  Core plugins: ${loadedPlugins.join(', ')}{/}`);
  if (v2Plugins.length > 0) chatLog.log(`{gray-fg}  V2 plugins: ${v2Plugins.map(p => p.name).join(', ')}{/}`);
  if (coordinatorStarted) chatLog.log(`{gray-fg}  Swarm coordinator listening on port ${coordinatorPort}{/}`);
  chatLog.log(`{${c}-fg}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━{/}`);
  chatLog.log('');

  // Start HTTP API Server
  try {
    apiServer.start({
      config,
      ai,
      swarm,
      coordinator,
      sysModule,
      startTime,
      getAiOnline: () => aiOnline,
      getCurrentPersona: () => currentPersona,
      getCurrentBranch: () => currentBranch,
      getChatHistory: () => chatHistory,
      getSessionStats: () => sessionStats,
      getRelayCache: () => _relayCache,
      getPersonaPrompt: () => PERSONAS[currentPersona].prompt,
      saveHistory,
      handleUserInput,
      onStarted: (port) => {
        chatLog.log(`{green-fg}[API]{/} HTTP server listening on port ${port}`);
        queueRender();
      },
      onError: (e) => {
        chatLog.log(`{yellow-fg}[API]{/} Server error: ${escTags(e.message)}`);
        queueRender();
      },
    });
  } catch (e) {
    chatLog.log(`{red-fg}[API]{/} Failed to start: ${escTags(e.message)}`);
    queueRender();
  }

  // Startup sound (Windows notification, once)
  try {
    exec('powershell -c "[System.Media.SystemSounds]::Exclamation.Play()"', { windowsHide: true });
  } catch {}

  // Self-healing on startup
  selfHeal.analyzeAndHeal().then(result => {
    if (result.issues > 0) {
      chatLog.log(`{yellow-fg}[SELF-HEAL]{/} ${escTags(result.message)}`);
      result.actions.forEach(a => {
        const icon = a.success ? '{green-fg}✓{/}' : '{red-fg}✗{/}';
        chatLog.log(`  ${icon} {gray-fg}${escTags(a.signature)}: ${escTags(a.action.substring(0, 100))}{/}`);
      });
    } else {
      chatLog.log('{green-fg}[SELF-HEAL]{/} System clean — no crash patterns detected.');
    }
    queueRender();
  }).catch(() => {});

  queueRender();
});