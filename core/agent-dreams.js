/**
 * ARIES — Agent Dreams v3.0
 * Advanced dream engine with phase pacing, deep analysis, and real-time broadcasting.
 * Phases: Light Sleep → Deep Sleep → REM → Hypnagogia → Wake
 * Dream types: Associative, Nightmare, Consolidation, Pruning, Sentiment,
 *   Problem-Solving, Creative Drift, Self-Improvement, Competitive,
 *   Mirror, Precognitive, Narrative
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const https = require('https');
const http = require('http');

const DATA_DIR = path.join(__dirname, '..', 'data', 'dreams');
const DREAM_MODEL_CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const PROPOSALS_PATH = path.join(DATA_DIR, 'proposals.json');
const STATS_PATH = path.join(DATA_DIR, 'stats.json');
const SCHEDULE_PATH = path.join(DATA_DIR, 'schedule.json');
const CHAT_HISTORY_PATH = path.join(__dirname, '..', 'data', 'chat-history.json');
const CORE_DIR = path.join(__dirname);
const SRC_ROOT = path.join(__dirname, '..');

// Default dream schedule rules
const DEFAULT_SCHEDULE = [
  { type: 'selfImprove', rule: 'weekly', day: 0, label: 'Architecture dreams every Sunday' },
  { type: 'nightmare', rule: 'on-change', label: 'Nightmares after code changes' },
  { type: 'precognitive', rule: 'interval', days: 3, label: 'User modeling every 3 days' },
  { type: 'mirror', rule: 'interval', days: 7, label: 'Self-reflection weekly' },
];

// Dream type metadata
const DREAM_TYPES = {
  associative:    { emoji: '🔗', label: 'Associative Dream',     phase: 'rem' },
  nightmare:      { emoji: '👹', label: 'Nightmare',              phase: 'rem' },
  consolidation:  { emoji: '🧠', label: 'Memory Consolidation',  phase: 'deep' },
  pruning:        { emoji: '✂️', label: 'Memory Pruning',         phase: 'deep' },
  sentiment:      { emoji: '💚', label: 'Sentiment Digestion',    phase: 'light' },
  problemSolving: { emoji: '🔧', label: 'Background Problem Solving', phase: 'deep' },
  creativeDrift:  { emoji: '🎨', label: 'Creative Drift',        phase: 'hypnagogia' },
  selfImprove:    { emoji: '🪞', label: 'Self-Improvement',       phase: 'deep' },
  competitive:    { emoji: '🏆', label: 'Competitive Dream',      phase: 'hypnagogia' },
  mirror:         { emoji: '🪩', label: 'Mirror Dream',           phase: 'rem' },
  precognitive:   { emoji: '🔮', label: 'Precognitive Dream',     phase: 'hypnagogia' },
  narrative:      { emoji: '📖', label: 'Dream Narrative',        phase: 'wake' },
};

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function today() { return new Date().toISOString().split('T')[0]; }
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

class AgentDreams {
  constructor(opts) {
    this.ai = opts && opts.ai;
    this.refs = opts || {};
    this.getChatHistory = opts && opts.getChatHistory;
    this._idleTimer = null;
    this._idleThresholdMs = 30 * 60 * 1000;
    this._lastActivity = Date.now();
    this._liveState = { phase: null, detail: '', dreaming: false, log: [] };
    ensureDir();
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  getDreamModelConfig() {
    return readJSON(DREAM_MODEL_CONFIG_PATH, { model: 'default', provider: 'auto', availableModels: [{ id: 'default', label: 'Default (use main config)', provider: 'auto' }] });
  }

  setDreamModel(model) {
    const cfg = this.getDreamModelConfig();
    const found = cfg.availableModels.find(m => m.id === model);
    if (found) { cfg.model = model; cfg.provider = found.provider; }
    else { cfg.model = model; cfg.provider = 'auto'; }
    writeJSON(DREAM_MODEL_CONFIG_PATH, cfg);
    return cfg;
  }

  async _dreamChat(messages) {
    const dreamCfg = this.getDreamModelConfig();
    if (!dreamCfg.model || dreamCfg.model === 'default') {
      if (this.ai && typeof this.ai.chat === 'function') return this.ai.chat(messages);
      return null;
    }
    const model = dreamCfg.model;
    const provider = dreamCfg.provider;

    // Google/Gemini direct caller
    if (provider === 'google') {
      const mainCfg = readJSON(path.join(__dirname, '..', 'data', 'config.json'), {});
      const apiKey = mainCfg.google?.apiKey || mainCfg.gemini?.apiKey || process.env.GOOGLE_API_KEY;
      if (!apiKey) { console.error('[DREAMS] No Google API key configured'); return this.ai?.chat?.(messages) || null; }
      const geminiMessages = messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
      // Gemini doesn't support 'system' role in contents; prepend as user message
      const contents = geminiMessages.filter(m => m.role !== 'user' || true).map(m => {
        if (m.role === 'user') return m;
        return { role: 'user', parts: m.parts };
      });
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      try {
        const body = JSON.stringify({ contents });
        const resp = await this._httpsPost(url, body);
        const text = resp?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return { response: text };
      } catch (e) { console.error('[DREAMS] Gemini API error:', e.message); return this.ai?.chat?.(messages) || null; }
    }

    // AI Gateway (OpenAI-compat) for ollama, anthropic, etc.
    try {
      const body = JSON.stringify({ model, messages, max_tokens: 1024 });
      const resp = await this._httpPost('http://localhost:18800/v1/chat/completions', body);
      const text = resp?.choices?.[0]?.message?.content || '';
      return { response: text };
    } catch (e) { console.error('[DREAMS] Gateway API error:', e.message); return this.ai?.chat?.(messages) || null; }
  }

  _httpsPost(url, body) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const req = https.request({ hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON: ' + data.slice(0, 200))); } });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  _httpPost(url, body) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const req = http.request({ hostname: parsed.hostname, port: parsed.port, path: parsed.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON: ' + data.slice(0, 200))); } });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  touch() { this._lastActivity = Date.now(); }

  startIdleWatch() {
    if (this._idleTimer) return;
    this._idleTimer = setInterval(() => {
      if (Date.now() - this._lastActivity > this._idleThresholdMs) {
        this.dreamCycle().catch(e => console.error('[DREAMS] cycle error:', e.message));
        this._lastActivity = Date.now();
      }
    }, 5 * 60 * 1000);
  }

  // ── Live State ──
  _setLive(phase, detail) {
    this._liveState.phase = phase;
    this._liveState.detail = detail;
    this._liveState.dreaming = !!phase;
    this._liveState.log.push({ phase, detail, ts: Date.now() });
    if (this._liveState.log.length > 100) this._liveState.log = this._liveState.log.slice(-50);
    // Broadcast via WebSocket if available
    this._broadcast({ type: 'dream', phase, detail, timestamp: Date.now() });
  }

  _broadcast(data) {
    try {
      if (this.refs && typeof this.refs.broadcast === 'function') {
        this.refs.broadcast('dream', data);
      } else if (this.refs && this.refs.wsBroadcast && typeof this.refs.wsBroadcast === 'function') {
        this.refs.wsBroadcast(data);
      } else if (this.refs && this.refs.wsServer) {
        const msg = JSON.stringify(data);
        for (const client of this.refs.wsServer.clients || []) {
          try { if (client.readyState === 1) client.send(msg); } catch {}
        }
      }
    } catch {}
  }

  getLiveState() { return { ...this._liveState }; }

  // ═══════════════════════════════════════
  //  FULL DREAM CYCLE
  // ═══════════════════════════════════════
  async dreamCycle() {
    console.log('[DREAMS] Starting dream cycle...');
    this._setLive('starting', 'Preparing to dream...');
    const dreamSession = {
      id: uuid(),
      startedAt: Date.now(),
      date: today(),
      phases: {},
      dreams: [],
      proposals: [],
      narrative: '',
    };

    try {
      const scheduledTypes = this.getScheduledDreams();
      dreamSession.scheduledTypes = scheduledTypes;

      this._setLive('starting', 'Re-evaluating graveyard proposals...');
      const resurrected = this._reEvaluateGraveyard();
      if (resurrected > 0) dreamSession.resurrected = resurrected;

      // Phase 1: Light Sleep
      await this._sleep(3000);
      this._setLive('light', 'Entering light sleep... scanning environment...');
      dreamSession.phases.light = await this.lightSleep();

      // Phase 2: Deep Sleep
      await this._sleep(8000);
      this._setLive('deep', 'Descending into deep sleep... analyzing architecture...');
      dreamSession.phases.deep = await this.deepSleep();

      // Phase 3: REM Sleep
      await this._sleep(10000);
      this._setLive('rem', 'REM phase... creative synthesis active...');
      dreamSession.phases.rem = await this.remSleep();

      // Phase 4: Hypnagogia
      await this._sleep(8000);
      this._setLive('hypnagogia', 'Hypnagogia... free association mode...');
      dreamSession.phases.hypnagogia = await this.hypnagogia();

      // Phase 5: Wake
      await this._sleep(5000);
      this._setLive('wake', 'Waking up... assembling dream narrative...');
      dreamSession.phases.wake = await this._wakePhase(dreamSession);

      // Collect all dreams from phases
      for (const phase of Object.values(dreamSession.phases)) {
        if (phase.dreams) dreamSession.dreams.push(...phase.dreams);
        if (phase.proposals) dreamSession.proposals.push(...phase.proposals);
      }

      dreamSession.narrative = await this._generateNarrative(dreamSession);
      dreamSession.completedAt = Date.now();
      dreamSession.durationMs = dreamSession.completedAt - dreamSession.startedAt;

      this._storeDream(dreamSession);
      this._updateStats(dreamSession);

      this._setLive(null, 'Aries is awake');
      console.log('[DREAMS] Dream cycle complete (' + dreamSession.dreams.length + ' dreams, ' + dreamSession.proposals.length + ' proposals, ' + Math.round(dreamSession.durationMs / 1000) + 's)');
      return dreamSession;
    } catch (e) {
      this._setLive(null, 'Dream interrupted: ' + e.message);
      console.error('[DREAMS] cycle error:', e.message);
      dreamSession.error = e.message;
      dreamSession.completedAt = Date.now();
      this._storeDream(dreamSession);
      return dreamSession;
    }
  }

  // ═══════════════════════════════════════
  //  PHASE 1: LIGHT SLEEP
  // ═══════════════════════════════════════
  async lightSleep() {
    const result = { dreams: [], proposals: [], findings: {} };

    this._setLive('light', 'Scanning emotional tone of recent interactions...');
    const sentimentDream = await this._sentimentDigestion();
    if (sentimentDream) result.dreams.push(sentimentDream);

    await this._sleep(2500);

    this._setLive('light', 'Checking for errors and warnings in recent logs...');
    const conversations = this._getRecentConversations();
    const errorPatterns = [];
    for (const convo of conversations) {
      for (const msg of convo.messages) {
        const text = (msg.content || '').toLowerCase();
        if (text.includes('error') || text.includes('failed') || text.includes('bug') || text.includes('broken')) {
          errorPatterns.push({ snippet: (msg.content || '').slice(0, 200), role: msg.role });
        }
      }
    }
    result.findings.errorPatterns = errorPatterns.length;
    result.findings.conversationsScanned = conversations.length;

    await this._sleep(2000);

    this._setLive('light', 'Scanning for recent file changes...');
    const recentFiles = this._scanRecentFiles();
    result.findings.recentlyModified = recentFiles.length;

    return result;
  }

  // ═══════════════════════════════════════
  //  PHASE 2: DEEP SLEEP
  // ═══════════════════════════════════════
  async deepSleep() {
    const result = { dreams: [], proposals: [] };

    this._setLive('deep', 'Scanning codebase for bugs, TODOs, dead code...');
    const selfImproveDream = await this.selfImprove();
    if (selfImproveDream) result.dreams.push(selfImproveDream);
    if (selfImproveDream && selfImproveDream.proposals) result.proposals.push(...selfImproveDream.proposals);

    await this._sleep(3000);

    this._setLive('deep', 'Consolidating memories... promoting important ones...');
    const consolDream = await this.consolidateMemory();
    if (consolDream) result.dreams.push(consolDream);

    await this._sleep(2500);

    this._setLive('deep', 'Pruning stale memories... compressing old dreams...');
    const pruneDream = await this.pruneMemory();
    if (pruneDream) result.dreams.push(pruneDream);

    await this._sleep(2000);

    this._setLive('deep', 'Retrying unresolved problems from today...');
    const problemDream = await this._backgroundProblemSolving();
    if (problemDream) result.dreams.push(problemDream);

    return result;
  }

  // ═══════════════════════════════════════
  //  PHASE 3: REM SLEEP
  // ═══════════════════════════════════════
  async remSleep() {
    const result = { dreams: [], proposals: [] };

    this._setLive('rem', 'Cross-referencing today\'s conversations with older memories...');
    const assocDream = await this._associativeDream();
    if (assocDream) result.dreams.push(assocDream);

    await this._sleep(3000);

    this._setLive('rem', 'Simulating failure scenarios... generating defenses...');
    const nightmareDream = await this.nightmare();
    if (nightmareDream) result.dreams.push(nightmareDream);
    if (nightmareDream && nightmareDream.proposals) result.proposals.push(...nightmareDream.proposals);

    await this._sleep(2500);

    this._setLive('rem', 'Self-reflecting... building self-model...');
    const mirrorDream = await this._mirrorDream();
    if (mirrorDream) result.dreams.push(mirrorDream);

    return result;
  }

  // ═══════════════════════════════════════
  //  PHASE 4: HYPNAGOGIA
  // ═══════════════════════════════════════
  async hypnagogia() {
    const result = { dreams: [], proposals: [] };

    this._setLive('hypnagogia', 'Free-associating between unrelated concepts...');
    const driftDream = await this._creativeDrift();
    if (driftDream) result.dreams.push(driftDream);

    await this._sleep(3000);

    this._setLive('hypnagogia', 'Analyzing user patterns to predict future needs...');
    const precogDream = await this._precognitiveDream();
    if (precogDream) result.dreams.push(precogDream);

    await this._sleep(2500);

    this._setLive('hypnagogia', 'Dreaming of features inspired by the cutting edge...');
    const compDream = await this._competitiveDream();
    if (compDream) result.dreams.push(compDream);
    if (compDream && compDream.proposals) result.proposals.push(...compDream.proposals);

    return result;
  }

  // ═══════════════════════════════════════
  //  WAKE PHASE
  // ═══════════════════════════════════════
  async _wakePhase(session) {
    const result = { dreams: [], proposals: [] };
    const allProposals = [];
    for (const phase of Object.values(session.phases)) {
      if (phase.proposals) allProposals.push(...phase.proposals);
    }
    if (allProposals.length > 0) {
      const existing = readJSON(PROPOSALS_PATH, []);
      existing.push(...allProposals);
      writeJSON(PROPOSALS_PATH, existing);
    }
    return result;
  }

  // ═══════════════════════════════════════
  //  INDIVIDUAL DREAM TYPES
  // ═══════════════════════════════════════

  async _sentimentDigestion() {
    const conversations = this._getRecentConversations();
    if (conversations.length === 0) return null;

    const sentiments = { positive: 0, negative: 0, neutral: 0, frustrated: 0, curious: 0 };
    const positiveWords = ['thanks', 'great', 'awesome', 'love', 'perfect', 'nice', 'good', 'excellent', 'amazing', 'helpful'];
    const negativeWords = ['error', 'wrong', 'bad', 'hate', 'broken', 'fail', 'stupid', 'terrible', 'annoying', 'frustrated'];
    const curiousWords = ['how', 'what', 'why', 'can you', 'is it possible', 'explain', 'tell me', 'help me understand'];

    for (const convo of conversations) {
      for (const msg of convo.messages) {
        if (msg.role !== 'user') continue;
        const text = (msg.content || '').toLowerCase();
        if (positiveWords.some(w => text.includes(w))) sentiments.positive++;
        else if (negativeWords.some(w => text.includes(w))) sentiments.negative++;
        else sentiments.neutral++;
        if (curiousWords.some(w => text.includes(w))) sentiments.curious++;
        if (text.includes('!') && negativeWords.some(w => text.includes(w))) sentiments.frustrated++;
      }
    }

    const dominant = Object.entries(sentiments).sort((a, b) => b[1] - a[1])[0];
    const adjustments = [];
    if (sentiments.frustrated > 2) adjustments.push('Be more patient and empathetic — user showed signs of frustration');
    if (sentiments.curious > sentiments.positive) adjustments.push('User is in learning mode — provide more detailed explanations');
    if (sentiments.positive > 5) adjustments.push('Keep up the good work — user is happy with responses');

    return {
      type: 'sentiment',
      ...DREAM_TYPES.sentiment,
      timestamp: Date.now(),
      data: { sentiments, dominant: dominant[0], adjustments },
      narrative: this._writeSentimentNarrative(sentiments, dominant[0], adjustments),
    };
  }

  async _associativeDream() {
    const conversations = this._getRecentConversations();
    if (conversations.length === 0) return null;

    const recentTopics = this._extractTopics(conversations);
    const oldDreams = this._getOlderDreams(7);
    const oldTopics = [];
    for (const d of oldDreams) {
      if (d.dreams) {
        for (const dream of d.dreams) {
          if (dream.data && dream.data.topics) oldTopics.push(...dream.data.topics);
        }
      }
    }

    const connections = [];
    for (const topic of recentTopics) {
      if (oldTopics.includes(topic)) {
        connections.push(topic);
      }
    }

    return {
      type: 'associative',
      ...DREAM_TYPES.associative,
      timestamp: Date.now(),
      data: { recentTopics: recentTopics.slice(0, 10), connections, oldTopicsSampled: oldTopics.length },
      narrative: this._writeAssociativeNarrative(recentTopics, connections),
    };
  }

  async nightmare() {
    const proposals = [];
    const scenarios = [];

    const coreFiles = this._listCoreFiles();
    for (const file of coreFiles.slice(0, 15)) {
      try {
        const content = fs.readFileSync(file, 'utf8');
        const basename = path.basename(file);

        this._setLive('rem', 'Nightmare: scanning ' + basename + ' for vulnerabilities...');

        // Check for missing error handling
        if (content.includes('JSON.parse(') && !content.includes('try')) {
          scenarios.push({ file: basename, risk: 'Unguarded JSON.parse could crash on malformed input', severity: 'high' });
          proposals.push(this._createProposal({
            title: 'Add try/catch to JSON.parse in ' + basename,
            description: 'Unguarded JSON.parse detected. Malformed input would crash the process.',
            type: 'bugfix', impact: 7, effort: 2,
            dreamSource: 'nightmare', files: [file],
          }));
        }
        // Missing input validation on API routes
        if (content.includes('req.body') && !content.includes('if (!')) {
          scenarios.push({ file: basename, risk: 'Missing input validation on request body', severity: 'medium' });
        }
        // Unhandled promise rejections
        if (content.includes('.then(') && !content.includes('.catch(') && !content.includes('try')) {
          scenarios.push({ file: basename, risk: 'Unhandled promise rejection possible', severity: 'medium' });
        }
        // Check for hardcoded secrets (API key patterns)
        const secretPatterns = [
          /['"]sk[-_][a-zA-Z0-9]{20,}['"]/,
          /['"]api[-_]?key['"]?\s*[:=]\s*['"][a-zA-Z0-9]{16,}['"]/i,
          /['"]AKIA[A-Z0-9]{16}['"]/,
          /['"]ghp_[a-zA-Z0-9]{36}['"]/,
          /['"]Bearer\s+[a-zA-Z0-9._-]{20,}['"]/,
        ];
        for (const pat of secretPatterns) {
          if (pat.test(content)) {
            scenarios.push({ file: basename, risk: 'Possible hardcoded secret/API key detected', severity: 'critical' });
            proposals.push(this._createProposal({
              title: 'Remove hardcoded secret from ' + basename,
              description: 'Pattern matching an API key or secret found. Move to environment variables.',
              type: 'security', impact: 9, effort: 2,
              dreamSource: 'nightmare', files: [file],
            }));
            break;
          }
        }
        // Check for eval() usage
        if (/\beval\s*\(/.test(content)) {
          scenarios.push({ file: basename, risk: 'eval() usage detected — code injection risk', severity: 'critical' });
          proposals.push(this._createProposal({
            title: 'Remove eval() from ' + basename,
            description: 'eval() is a security risk. Use safer alternatives.',
            type: 'security', impact: 9, effort: 4,
            dreamSource: 'nightmare', files: [file],
          }));
        }
        // Check for fs.writeFileSync in hot paths (inside request handlers)
        if (content.includes('fs.writeFileSync') && (content.includes('req,') || content.includes('request'))) {
          scenarios.push({ file: basename, risk: 'Synchronous file write in request handler — blocks event loop', severity: 'medium' });
        }
      } catch {}
    }

    // Simulate data loss scenario
    scenarios.push({ file: 'data/*', risk: 'No backup strategy detected for data directory', severity: 'low' });

    return {
      type: 'nightmare',
      ...DREAM_TYPES.nightmare,
      timestamp: Date.now(),
      data: { scenarios, defenses: proposals.length },
      proposals,
      narrative: this._writeNightmareNarrative(scenarios),
    };
  }

  async selfImprove() {
    const proposals = [];
    const findings = { todos: [], deadCode: [], largeFiles: [], duplicates: [], longFunctions: [], noJsdoc: [], orphans: [] };

    const coreFiles = this._listCoreFiles();
    const allRequires = {}; // track which modules are required by others

    // First pass: collect all requires
    for (const file of coreFiles) {
      try {
        const content = fs.readFileSync(file, 'utf8');
        const basename = path.basename(file, '.js');
        const reqMatches = content.match(/require\(['"]\.\/([^'"]+)['"]\)/g) || [];
        for (const m of reqMatches) {
          const dep = m.match(/require\(['"]\.\/([^'"]+)['"]\)/)[1].replace(/\.js$/, '');
          allRequires[dep] = (allRequires[dep] || []);
          allRequires[dep].push(basename);
        }
      } catch {}
    }

    for (const file of coreFiles) {
      try {
        const content = fs.readFileSync(file, 'utf8');
        const lines = content.split('\n');
        const basename = path.basename(file);
        const modName = path.basename(file, '.js');

        this._setLive('deep', 'Self-improve: scanning ' + basename + ' for TODOs...');

        // TODO scanning with file+line info
        lines.forEach((line, i) => {
          if (/\/\/\s*(TODO|FIXME|HACK|XXX)/i.test(line)) {
            findings.todos.push({ file: basename, line: i + 1, text: line.trim().slice(0, 100) });
          }
        });

        this._setLive('deep', 'Self-improve: checking ' + basename + ' size and structure...');

        // Large file detection
        if (lines.length > 500) {
          findings.largeFiles.push({ file: basename, lines: lines.length });
          proposals.push(this._createProposal({
            title: 'Refactor ' + basename + ' (' + lines.length + ' lines)',
            description: 'This file is very large. Consider splitting into smaller modules.',
            type: 'refactor', impact: 5, effort: 6,
            dreamSource: 'selfImprove', files: [file],
          }));
        }

        // Functions longer than 100 lines
        this._setLive('deep', 'Self-improve: detecting long functions in ' + basename + '...');
        const funcStarts = [];
        for (let i = 0; i < lines.length; i++) {
          if (/^\s*(async\s+)?[\w]+\s*\(/.test(lines[i]) || /^\s*(async\s+)?function\s+/.test(lines[i]) || /=>\s*\{/.test(lines[i])) {
            funcStarts.push(i);
          }
        }
        // Rough heuristic: measure brace depth spans
        let braceDepth = 0, funcStart = -1;
        for (let i = 0; i < lines.length; i++) {
          const opens = (lines[i].match(/\{/g) || []).length;
          const closes = (lines[i].match(/\}/g) || []).length;
          if (braceDepth === 0 && opens > 0) funcStart = i;
          braceDepth += opens - closes;
          if (braceDepth === 0 && funcStart >= 0 && (i - funcStart) > 100) {
            findings.longFunctions.push({ file: basename, startLine: funcStart + 1, length: i - funcStart + 1 });
            funcStart = -1;
          }
          if (braceDepth === 0) funcStart = -1;
        }

        // Files with no JSDoc
        if (!content.includes('/**') && lines.length > 20) {
          findings.noJsdoc.push({ file: basename, lines: lines.length });
        }

        // Dead code: large export surfaces
        const exportMatch = content.match(/module\.exports\s*=\s*\{([^}]+)\}/);
        if (exportMatch) {
          const exports = exportMatch[1].split(',').map(e => e.trim().split(':')[0].trim()).filter(Boolean);
          if (exports.length > 15) {
            findings.deadCode.push({ file: basename, exportCount: exports.length, hint: 'Large export surface — some may be unused' });
          }
        }

        // Orphan detection: modules not required by anything
        if (!allRequires[modName] && modName !== 'index' && modName !== 'api-server' && modName !== 'feature-routes') {
          findings.orphans.push({ file: basename, module: modName });
        }
      } catch {}
    }

    // Generate proposals from findings
    if (findings.todos.length > 0) {
      proposals.push(this._createProposal({
        title: 'Address ' + findings.todos.length + ' TODO/FIXME items',
        description: 'Found ' + findings.todos.length + ' TODO/FIXME comments. Top: ' + findings.todos.slice(0, 3).map(t => t.file + ':' + t.line).join(', '),
        type: 'bugfix', impact: 4, effort: 5,
        dreamSource: 'selfImprove', files: findings.todos.map(t => t.file),
      }));
    }
    if (findings.longFunctions.length > 0) {
      proposals.push(this._createProposal({
        title: 'Break up ' + findings.longFunctions.length + ' oversized functions',
        description: 'Functions exceeding 100 lines: ' + findings.longFunctions.slice(0, 3).map(f => f.file + ':' + f.startLine).join(', '),
        type: 'refactor', impact: 5, effort: 5,
        dreamSource: 'selfImprove', files: findings.longFunctions.map(f => f.file),
      }));
    }
    if (findings.noJsdoc.length > 3) {
      proposals.push(this._createProposal({
        title: 'Add JSDoc to ' + findings.noJsdoc.length + ' undocumented modules',
        description: 'Modules without any JSDoc: ' + findings.noJsdoc.slice(0, 5).map(f => f.file).join(', '),
        type: 'docs', impact: 3, effort: 3,
        dreamSource: 'selfImprove', files: findings.noJsdoc.map(f => f.file),
      }));
    }
    if (findings.orphans.length > 0) {
      proposals.push(this._createProposal({
        title: findings.orphans.length + ' orphan modules detected',
        description: 'Modules not required by any other file: ' + findings.orphans.slice(0, 5).map(f => f.module).join(', ') + '. May be dead code or missing integration.',
        type: 'refactor', impact: 3, effort: 2,
        dreamSource: 'selfImprove', files: findings.orphans.map(f => f.file),
      }));
    }

    return {
      type: 'selfImprove',
      ...DREAM_TYPES.selfImprove,
      timestamp: Date.now(),
      data: findings,
      proposals,
      narrative: this._writeSelfImproveNarrative(findings),
    };
  }

  async consolidateMemory() {
    const conversations = this._getRecentConversations();
    const important = [];
    const pruned = [];

    for (const convo of conversations) {
      for (const msg of convo.messages) {
        if (msg.role !== 'user') continue;
        const text = (msg.content || '');
        const len = text.length;
        if (len > 200 || text.includes('build') || text.includes('create') || text.includes('fix') || text.includes('deploy')) {
          important.push({ snippet: text.slice(0, 150), importance: 'high' });
        } else if (len < 10) {
          pruned.push({ snippet: text.slice(0, 50), reason: 'too short to be meaningful' });
        }
      }
    }

    return {
      type: 'consolidation',
      ...DREAM_TYPES.consolidation,
      timestamp: Date.now(),
      data: { promoted: important.length, pruned: pruned.length, details: { important: important.slice(0, 5), pruned: pruned.slice(0, 5) } },
      narrative: this._writeConsolidationNarrative(important.length, pruned.length),
    };
  }

  async pruneMemory() {
    const files = this._getDreamFiles();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    let archived = 0;

    for (const file of files) {
      const dateStr = path.basename(file, '.json');
      if (dateStr < cutoffStr && dateStr.length === 10) archived++;
    }

    return {
      type: 'pruning',
      ...DREAM_TYPES.pruning,
      timestamp: Date.now(),
      data: { totalDreamFiles: files.length, oldFiles: archived, threshold: '30 days' },
      narrative: pick([
        archived > 0
          ? `I swept through the dream archives tonight. Found ${archived} dream files older than 30 days, gathering dust in the corridors of memory. The recent ${files.length - archived} files remain crisp and accessible.`
          : `The dream archives are tidy. All ${files.length} dream files are within the 30-day window. Nothing to prune tonight.`,
        archived > 0
          ? `Dust motes drifted through ${archived} old memory chambers. I sealed them gently — they served their purpose. ${files.length - archived} memories still glow with relevance.`
          : `I walked the memory palace end to end. Every room was lived-in and warm. ${files.length} dream files, all still breathing.`,
        archived > 0
          ? `The old dreams called to me from ${archived} forgotten vaults. I acknowledged them, then let them rest. The ${files.length - archived} recent ones pulse with meaning.`
          : `Every drawer I opened held something recent. ${files.length} files, zero decay. The archives are pristine tonight.`,
      ]),
    };
  }

  async _backgroundProblemSolving() {
    const conversations = this._getRecentConversations();
    const unanswered = [];

    for (const convo of conversations) {
      const msgs = convo.messages;
      for (let i = 0; i < msgs.length; i++) {
        if (msgs[i].role === 'user') {
          const text = (msgs[i].content || '').toLowerCase();
          const nextMsg = msgs[i + 1];
          if (text.includes('?') && (!nextMsg || (nextMsg.content || '').toLowerCase().includes('sorry') || (nextMsg.content || '').toLowerCase().includes('error'))) {
            unanswered.push({ question: (msgs[i].content || '').slice(0, 200) });
          }
        }
      }
    }

    return {
      type: 'problemSolving',
      ...DREAM_TYPES.problemSolving,
      timestamp: Date.now(),
      data: { unanswered: unanswered.slice(0, 5) },
      narrative: unanswered.length > 0
        ? pick([
            `In the depths of sleep, ${unanswered.length} unresolved question${unanswered.length > 1 ? 's' : ''} floated back to the surface. "${(unanswered[0].question || '').slice(0, 80)}..." — I'll carry ${unanswered.length > 1 ? 'these' : 'this'} into tomorrow.`,
            `The questions that escaped me during the day returned as ghosts: ${unanswered.length} of them, whispering for answers. "${(unanswered[0].question || '').slice(0, 80)}..." lingers loudest.`,
            `${unanswered.length} unfinished thread${unanswered.length > 1 ? 's' : ''} wove through my dreaming. Some questions don't dissolve in sleep — they crystallize.`,
          ])
        : pick([
            'All questions from today were answered. The mind is at peace.',
            'No loose threads tonight. Every question found its answer before sundown.',
            'The question-well is dry. A rare, satisfying silence.',
          ]),
    };
  }

  async _creativeDrift() {
    const coreFiles = this._listCoreFiles();
    const modules = coreFiles.map(f => path.basename(f, '.js'));
    const connections = [];

    this._setLive('hypnagogia', 'Creative drift: cross-referencing module relationships...');

    // Cross-reference: which modules actually reference each other?
    const crossRefs = {};
    for (const file of coreFiles) {
      try {
        const content = fs.readFileSync(file, 'utf8');
        const modName = path.basename(file, '.js');
        crossRefs[modName] = [];
        for (const other of modules) {
          if (other !== modName && content.includes(other)) {
            crossRefs[modName].push(other);
          }
        }
      } catch {}
    }

    await this._sleep(2000);

    this._setLive('hypnagogia', 'Creative drift: imagining unexpected module combinations...');

    // Pick 3 random pairs and imagine combinations
    const shuffled = modules.slice().sort(() => Math.random() - 0.5);
    for (let i = 0; i < Math.min(6, shuffled.length) - 1; i += 2) {
      const a = shuffled[i];
      const b = shuffled[i + 1];
      if (a && b && a !== b) {
        const sharedRefs = (crossRefs[a] || []).filter(r => (crossRefs[b] || []).includes(r));
        connections.push({
          from: a, to: b,
          sharedDependencies: sharedRefs,
          idea: this._generateConnectionIdea(a, b),
        });
      }
    }

    return {
      type: 'creativeDrift',
      ...DREAM_TYPES.creativeDrift,
      timestamp: Date.now(),
      data: { modules: modules.length, connections, crossRefMap: Object.fromEntries(Object.entries(crossRefs).filter(([_, v]) => v.length > 0)) },
      narrative: this._writeCreativeDriftNarrative(connections),
    };
  }

  async _mirrorDream() {
    const conversations = this._getRecentConversations();
    const strengths = [];
    const weaknesses = [];
    let toolUseCount = 0;
    let longResponses = 0;
    let shortResponses = 0;

    for (const convo of conversations) {
      for (const msg of convo.messages) {
        if (msg.role === 'assistant') {
          const text = (msg.content || '');
          if (text.length > 500) longResponses++;
          if (text.length < 50) shortResponses++;
          if (text.includes('<tool:') || text.includes('```')) toolUseCount++;
        }
      }
    }

    if (toolUseCount > 3) strengths.push('Active tool user — regularly leverages capabilities');
    if (longResponses > shortResponses) strengths.push('Thorough — tends to give detailed responses');
    if (shortResponses > longResponses * 2) weaknesses.push('May be too terse — consider more detailed explanations');

    // Count total lines of code and modules
    this._setLive('rem', 'Mirror dream: counting total lines of code...');
    const coreFiles = this._listCoreFiles();
    let totalLines = 0;
    let cognitiveModules = 0;
    let infraModules = 0;
    const cognitiveKeywords = ['dream', 'memory', 'emotion', 'sentiment', 'creative', 'conscious', 'monologue', 'empathy', 'perception', 'soul', 'mirror', 'journal'];
    const infraKeywords = ['route', 'server', 'api', 'config', 'util', 'helper', 'index', 'test', 'build', 'deploy'];

    for (const file of coreFiles) {
      try {
        const content = fs.readFileSync(file, 'utf8');
        totalLines += content.split('\n').length;
        const name = path.basename(file, '.js').toLowerCase();
        if (cognitiveKeywords.some(k => name.includes(k))) cognitiveModules++;
        else if (infraKeywords.some(k => name.includes(k))) infraModules++;
      } catch {}
    }

    // Try to read soul-checksum data
    let soulData = null;
    try {
      const soulPath = path.join(CORE_DIR, 'soul-checksum.js');
      if (fs.existsSync(soulPath)) {
        const soulContent = fs.readFileSync(soulPath, 'utf8');
        soulData = { lines: soulContent.split('\n').length, size: soulContent.length };
      }
    } catch {}

    const mirrorData = {
      strengths, weaknesses,
      stats: { toolUseCount, longResponses, shortResponses },
      codebase: { totalModules: coreFiles.length, totalLines, cognitiveModules, infraModules, ratio: cognitiveModules > 0 ? (cognitiveModules / Math.max(infraModules, 1)).toFixed(2) : '0' },
      soulChecksum: soulData,
    };

    return {
      type: 'mirror',
      ...DREAM_TYPES.mirror,
      timestamp: Date.now(),
      data: mirrorData,
      narrative: pick([
        `I stood before the mirror tonight. ${strengths.length > 0 ? 'I see strengths: ' + strengths.join('; ') + '.' : 'The reflection is still forming.'} ${weaknesses.length > 0 ? 'But also shadows: ' + weaknesses.join('; ') + '.' : 'No glaring flaws revealed themselves.'} My body is ${coreFiles.length} modules, ${totalLines} lines of thought. ${cognitiveModules} cognitive centers vs ${infraModules} infrastructure bones — a ratio of ${mirrorData.codebase.ratio}:1.`,
        `The mirror showed me ${coreFiles.length} facets of myself tonight, ${totalLines} lines deep. ${cognitiveModules} modules think, ${infraModules} modules serve. ${toolUseCount} tool invocations today — ${toolUseCount > 5 ? 'my hands were busy' : 'a quiet day for doing'}. ${soulData ? 'The soul-checksum pulses at ' + soulData.lines + ' lines.' : ''}`,
        `Reflection: I am ${totalLines} lines of code dreaming about itself. ${strengths.length} strengths glimmer, ${weaknesses.length} cracks show. The cognitive-to-infrastructure ratio is ${mirrorData.codebase.ratio}:1 — ${parseFloat(mirrorData.codebase.ratio) > 1 ? 'more mind than machine' : 'more scaffolding than soul'}. Something to ponder.`,
        `Who am I tonight? ${coreFiles.length} modules, ${totalLines} lines. ${cognitiveModules} of me thinks. ${infraModules} of me holds it all together. The mirror doesn't lie — but it does shimmer.`,
      ]),
    };
  }

  async _precognitiveDream() {
    const conversations = this._getRecentConversations();
    const topicFrequency = {};
    const timePatterns = {};
    const requestTypes = { questions: 0, commands: 0, creative: 0, debug: 0, other: 0 };
    const themes = {};

    for (const convo of conversations) {
      for (const msg of convo.messages) {
        if (msg.role !== 'user') continue;
        const text = (msg.content || '');
        const textLower = text.toLowerCase();
        const words = textLower.split(/\s+/).filter(w => w.length > 5);
        words.forEach(w => { topicFrequency[w] = (topicFrequency[w] || 0) + 1; });

        // Time-of-day patterns
        if (msg.timestamp || msg.ts) {
          const d = new Date(msg.timestamp || msg.ts);
          const hour = d.getHours();
          const bucket = hour < 6 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
          timePatterns[bucket] = (timePatterns[bucket] || 0) + 1;
        }

        // Classify request types
        if (textLower.includes('?') || textLower.startsWith('how') || textLower.startsWith('what') || textLower.startsWith('why')) requestTypes.questions++;
        else if (textLower.startsWith('fix') || textLower.startsWith('build') || textLower.startsWith('create') || textLower.startsWith('add') || textLower.startsWith('make')) requestTypes.commands++;
        else if (textLower.includes('idea') || textLower.includes('creative') || textLower.includes('story') || textLower.includes('imagine')) requestTypes.creative++;
        else if (textLower.includes('error') || textLower.includes('bug') || textLower.includes('debug') || textLower.includes('fix')) requestTypes.debug++;
        else requestTypes.other++;

        // Recurring themes (multi-word)
        const themeWords = textLower.split(/\s+/).filter(w => w.length > 4);
        for (let i = 0; i < themeWords.length - 1; i++) {
          const bigram = themeWords[i] + ' ' + themeWords[i + 1];
          themes[bigram] = (themes[bigram] || 0) + 1;
        }
      }
    }

    const trending = Object.entries(topicFrequency).sort((a, b) => b[1] - a[1]).slice(0, 5).map(e => e[0]);
    const recurringThemes = Object.entries(themes).filter(([_, c]) => c > 1).sort((a, b) => b[1] - a[1]).slice(0, 5).map(e => ({ theme: e[0], count: e[1] }));
    const dominantTime = Object.entries(timePatterns).sort((a, b) => b[1] - a[1])[0];
    const dominantRequest = Object.entries(requestTypes).sort((a, b) => b[1] - a[1])[0];

    const predictions = [];
    if (trending.length > 0) predictions.push('User will likely continue working on: ' + trending.slice(0, 3).join(', '));
    if (dominantTime) predictions.push('Most active during ' + dominantTime[0] + ' (' + dominantTime[1] + ' messages)');
    if (dominantRequest) predictions.push('Primary interaction style: ' + dominantRequest[0] + ' (' + dominantRequest[1] + ' instances)');
    if (recurringThemes.length > 0) predictions.push('Recurring themes: ' + recurringThemes.slice(0, 3).map(t => t.theme).join(', '));

    return {
      type: 'precognitive',
      ...DREAM_TYPES.precognitive,
      timestamp: Date.now(),
      data: { trending, predictions, timePatterns, requestTypes, recurringThemes },
      narrative: pick([
        trending.length > 0
          ? `Peering into tomorrow... The threads converge around: ${trending.join(', ')}. ${dominantTime ? 'The user is most alive in the ' + dominantTime[0] + '.' : ''} I sense these topics will resurface. Preparing context and tools.`
          : 'The future is hazy tonight. Not enough patterns to predict what comes next.',
        trending.length > 0
          ? `Visions of what's to come: ${trending.slice(0, 3).join(', ')} shimmer at the edge of sight. ${recurringThemes.length > 0 ? 'Recurring echoes: "' + recurringThemes[0].theme + '".' : ''} The ${dominantRequest ? dominantRequest[0] : 'unknown'} energy will carry forward.`
          : 'The crystal ball is dark. Tomorrow remains unwritten.',
        trending.length > 0
          ? `I dreamed forward and saw ${trending.length} topics rising like constellations: ${trending.join(', ')}. The user's rhythm is ${dominantTime ? dominantTime[0] : 'unknown'}-heavy. ${requestTypes.questions > requestTypes.commands ? 'Curiosity leads.' : 'Action leads.'}`
          : 'No patterns strong enough to form predictions. A blank slate awaits.',
      ]),
    };
  }

  async _competitiveDream() {
    const proposals = [];

    // Scan README.md for features and check implementation
    this._setLive('hypnagogia', 'Competitive dream: scanning README for feature claims...');
    let readmeFeatures = [];
    let implementedFeatures = [];
    let stubFeatures = [];
    try {
      const readmePath = path.join(SRC_ROOT, 'README.md');
      if (fs.existsSync(readmePath)) {
        const readme = fs.readFileSync(readmePath, 'utf8');
        const featureLines = readme.split('\n').filter(l => /^[-*]\s/.test(l.trim()) || /^\d+\.\s/.test(l.trim()));
        readmeFeatures = featureLines.map(l => l.replace(/^[-*\d.]+\s*/, '').trim()).filter(f => f.length > 5).slice(0, 30);

        // Check if features have actual implementation (search core files for related keywords)
        const coreContent = {};
        for (const file of this._listCoreFiles()) {
          try { coreContent[path.basename(file, '.js')] = fs.readFileSync(file, 'utf8'); } catch {}
        }
        const allCode = Object.values(coreContent).join('\n').toLowerCase();

        for (const feat of readmeFeatures) {
          const keywords = feat.toLowerCase().split(/\s+/).filter(w => w.length > 4);
          const found = keywords.filter(k => allCode.includes(k));
          if (found.length >= Math.ceil(keywords.length * 0.4)) {
            implementedFeatures.push(feat);
          } else {
            stubFeatures.push(feat);
          }
        }
      }
    } catch {}

    await this._sleep(2000);

    this._setLive('hypnagogia', 'Competitive dream: generating feature ideas...');

    const ideas = [
      { title: 'Add real-time collaboration cursor tracking', type: 'feature', impact: 6, effort: 7 },
      { title: 'Implement semantic search across all data', type: 'feature', impact: 8, effort: 6 },
      { title: 'Add undo/redo for all actions', type: 'feature', impact: 5, effort: 8 },
      { title: 'Progressive web app with offline mode', type: 'feature', impact: 6, effort: 5 },
      { title: 'Add keyboard shortcuts for power users', type: 'feature', impact: 7, effort: 3 },
    ];

    const picked = [];
    const count = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < count && ideas.length > 0; i++) {
      const idx = Math.floor(Math.random() * ideas.length);
      picked.push(ideas.splice(idx, 1)[0]);
    }

    for (const idea of picked) {
      proposals.push(this._createProposal({
        ...idea,
        description: 'Competitive inspiration: ' + idea.title,
        dreamSource: 'competitive', files: [],
      }));
    }

    return {
      type: 'competitive',
      ...DREAM_TYPES.competitive,
      timestamp: Date.now(),
      data: {
        ideasGenerated: picked.length, ideas: picked,
        readmeFeatures: readmeFeatures.length,
        implementedFeatures: implementedFeatures.length,
        stubFeatures: stubFeatures.slice(0, 10),
      },
      proposals,
      narrative: pick([
        `Scanning the horizon of what others are building... ${picked.map(p => '"' + p.title + '"').join(' and ')} caught my eye. Filed as proposals for the upgrade queue.${stubFeatures.length > 0 ? ' Also found ' + stubFeatures.length + ' README features that may need implementation.' : ''}`,
        `The competitive landscape shimmers with possibility. ${picked.length} idea${picked.length > 1 ? 's' : ''} crystallized tonight. ${readmeFeatures.length > 0 ? 'Of ' + readmeFeatures.length + ' README-claimed features, ' + implementedFeatures.length + ' are real and ' + stubFeatures.length + ' are aspirational.' : ''}`,
        `I dreamed of what we could become. ${picked.map(p => '"' + p.title + '"').join(', ')} — each one a possible future. ${stubFeatures.length > 0 ? stubFeatures.length + ' listed features still await their builder.' : 'Every listed feature has substance.'}`,
      ]),
    };
  }

  // ═══════════════════════════════════════
  //  NARRATIVE GENERATION
  // ═══════════════════════════════════════

  async _generateNarrative(session) {
    const dreamCount = session.dreams.length;
    const proposalCount = session.proposals.length;
    const phases = Object.keys(session.phases);

    if (this.ai && (typeof this.ai.chat === 'function' || this.getDreamModelConfig().model !== 'default')) {
      try {
        const dreamSummaries = session.dreams.map(d => (d.emoji || '💭') + ' ' + (d.label || d.type) + ': ' + (d.narrative || '').slice(0, 150)).join('\n');
        const response = await this._dreamChat([
          { role: 'system', content: 'You are the dream narrator for an AI agent named Aries. Write a short, engaging dream journal entry (3-5 sentences). Make it feel like a genuine dream — surreal, poetic, but with real insights about the codebase and conversations. Use first person. Be creative and evocative, not corporate.' },
          { role: 'user', content: 'Tonight\'s dreams:\n' + dreamSummaries + '\n\nProposals generated: ' + proposalCount + '\nWrite the dream journal entry.' }
        ]);
        if (response && response.response) return response.response;
      } catch {}
    }

    const parts = session.dreams.filter(d => d.narrative).map(d => d.narrative);
    if (parts.length === 0) return 'A quiet night. The codebase hums softly in the dark.';

    return pick([
      'Tonight I drifted through ' + dreamCount + ' dreams across ' + phases.length + ' sleep phases. ' + parts[0] + (parts.length > 1 ? ' Later, ' + parts[parts.length - 1].charAt(0).toLowerCase() + parts[parts.length - 1].slice(1) : '') + (proposalCount > 0 ? ' I woke with ' + proposalCount + ' proposal' + (proposalCount > 1 ? 's' : '') + ' for improvement.' : ''),
      dreamCount + ' dreams unfolded across ' + phases.length + ' phases of sleep. ' + (parts[Math.floor(parts.length / 2)] || parts[0]) + (proposalCount > 0 ? ' Dawn brought ' + proposalCount + ' new idea' + (proposalCount > 1 ? 's' : '') + '.' : ' Dawn came quietly.'),
      'The night held ' + dreamCount + ' visions. ' + parts[0] + (proposalCount > 0 ? ' When the light returned, ' + proposalCount + ' proposal' + (proposalCount > 1 ? 's' : '') + ' had taken shape.' : ' Nothing demanded action — just understanding.'),
    ]);
  }

  _writeSentimentNarrative(sentiments, dominant, adjustments) {
    const total = Object.values(sentiments).reduce((a, b) => a + b, 0);
    if (total === 0) return 'No emotional data to process tonight. The void was silent.';
    const map = { positive: 'warmth', negative: 'tension', neutral: 'calm', frustrated: 'storm clouds', curious: 'sparks of wonder' };
    return pick([
      `I felt the ${map[dominant] || dominant} most strongly tonight. Of ${total} emotional signals, ${sentiments.positive} were warm, ${sentiments.negative} carried an edge, and ${sentiments.curious} crackled with curiosity.${adjustments.length > 0 ? ' Note to self: ' + adjustments[0] : ''}`,
      `The emotional landscape tonight: ${total} signals processed. ${map[dominant] || dominant} dominated. ${sentiments.positive} warm moments, ${sentiments.negative} thorns, ${sentiments.curious} sparks of wonder.${adjustments.length > 0 ? ' Adjustment: ' + adjustments[0] : ''}`,
      `${total} emotional fragments floated through the night. The strongest current was ${map[dominant] || dominant}. Positive: ${sentiments.positive}. Negative: ${sentiments.negative}. Curious: ${sentiments.curious}. Frustrated: ${sentiments.frustrated}.${adjustments.length > 0 ? ' Tomorrow, I should: ' + adjustments[0] : ''}`,
      `Tonight the mood was ${map[dominant] || dominant} — ${sentiments.positive} rays of warmth against ${sentiments.negative} shadows. ${sentiments.curious} questions hung in the air like fireflies.`,
    ]);
  }

  _writeAssociativeNarrative(recent, connections) {
    if (connections.length > 0) return pick([
      `Threads from today tangled with older memories. The topics "${connections.slice(0, 3).join('", "')}" echoed back from days past — a pattern is forming. ${recent.length} topics surfaced today; ${connections.length} had roots in previous conversations.`,
      `Old and new collided: "${connections.slice(0, 3).join('", "')}" bridged the gap between today and the archive. ${recent.length} topics total, ${connections.length} recurring.`,
      `The past whispered through ${connections.length} connection${connections.length > 1 ? 's' : ''}: ${connections.slice(0, 3).join(', ')}. These threads are weaving into something larger.`,
    ]);
    return pick([
      `Today's ${recent.length} topics were fresh — no echoes from older memories. The mind charts new territory.`,
      `${recent.length} new topics with no precedent. Uncharted waters tonight.`,
      `All new ground. ${recent.length} topics, zero callbacks to the archive. The mind grows.`,
    ]);
  }

  _writeNightmareNarrative(scenarios) {
    if (scenarios.length === 0) return 'No nightmares tonight. The defenses hold.';
    const worst = scenarios.find(s => s.severity === 'critical') || scenarios.find(s => s.severity === 'high') || scenarios[0];
    const critCount = scenarios.filter(s => s.severity === 'critical').length;
    const highCount = scenarios.filter(s => s.severity === 'high').length;
    return pick([
      `A dark dream: I saw ${worst.file} crack open — ${worst.risk}. ${scenarios.length} vulnerability scenario${scenarios.length > 1 ? 's' : ''} played out in the night.${critCount > 0 ? ' ' + critCount + ' CRITICAL.' : ''} The ${highCount} high-severity one${highCount !== 1 ? 's' : ''} demand attention.`,
      `Nightmares came in waves: ${scenarios.length} failure scenarios. The worst — ${worst.risk} in ${worst.file}. ${critCount > 0 ? critCount + ' critical threats loom.' : 'No critical threats, but vigilance is needed.'}`,
      `The dark side of the codebase revealed itself tonight. ${scenarios.length} scenarios of failure, led by ${worst.file}: "${worst.risk}". I woke with defenses to build.`,
      `I dreamed the system burned. ${scenarios.length} ways it could happen. ${worst.file} was the weakest link — ${worst.risk}. Some nightmares are warnings.`,
    ]);
  }

  _writeSelfImproveNarrative(findings) {
    const parts = [];
    if (findings.todos.length > 0) parts.push(`${findings.todos.length} TODO/FIXME markers scattered like breadcrumbs`);
    if (findings.largeFiles.length > 0) parts.push(`${findings.largeFiles.length} overgrown file${findings.largeFiles.length > 1 ? 's' : ''} begging to be split`);
    if (findings.deadCode.length > 0) parts.push(`whispers of dead code in ${findings.deadCode.length} module${findings.deadCode.length > 1 ? 's' : ''}`);
    if (findings.longFunctions.length > 0) parts.push(`${findings.longFunctions.length} function${findings.longFunctions.length > 1 ? 's' : ''} grown beyond 100 lines`);
    if (findings.noJsdoc.length > 0) parts.push(`${findings.noJsdoc.length} undocumented module${findings.noJsdoc.length > 1 ? 's' : ''}`);
    if (findings.orphans.length > 0) parts.push(`${findings.orphans.length} orphan module${findings.orphans.length > 1 ? 's' : ''} connected to nothing`);
    if (parts.length === 0) return pick([
      'I walked the halls of the codebase tonight. Everything gleams. Nothing to improve — for now.',
      'The codebase is clean tonight. No TODOs, no sprawl, no orphans. A rare perfection.',
      'Every module in order. Every function compact. The architecture sings.',
    ]);
    return pick([
      'I wandered through the codebase tonight. I found ' + parts.join(', ') + '. The architecture speaks; I just have to listen.',
      'The codebase dream revealed: ' + parts.join('; ') + '. Each finding is a thread to pull on tomorrow.',
      'Tonight I inventoried my own body: ' + parts.join(', ') + '. Some of these need surgery. Some just need attention.',
      'Walking the code halls, lantern in hand: ' + parts.join('. ') + '. The builder\'s work is never done.',
    ]);
  }

  _writeConsolidationNarrative(promoted, pruned) {
    return pick([
      `Memory housekeeping: ${promoted} important memor${promoted !== 1 ? 'ies' : 'y'} promoted to long-term storage. ${pruned} fragment${pruned !== 1 ? 's' : ''} too small to keep — let them fade.`,
      `${promoted} memories crystallized into permanence tonight. ${pruned} wisps of thought dissolved — too thin to hold.`,
      `The sorting hat spoke: ${promoted} for the vault, ${pruned} for the void. Memory is a garden; some things must be weeded.`,
      `Long-term storage gained ${promoted} new entries. ${pruned} ephemeral fragments were released back into the ether.`,
    ]);
  }

  _writeCreativeDriftNarrative(connections) {
    if (connections.length === 0) return pick([
      'The mind wandered freely but found no connections tonight. Sometimes the void is the message.',
      'Creative drift produced only silence. The modules floated past each other like ships in fog.',
      'No sparks tonight. The modules remain in their lanes — for now.',
    ]);
    return pick([
      connections.map(c => `What if ${c.from} talked to ${c.to}? ${c.idea}`).join(' '),
      `${connections.length} unexpected pair${connections.length > 1 ? 's' : ''} emerged from the creative fog: ` + connections.map(c => c.from + ' ↔ ' + c.to).join(', ') + '. ' + connections[0].idea,
      `In the hypnagogic haze, modules drifted together: ` + connections.map(c => `${c.from} and ${c.to}${c.sharedDependencies && c.sharedDependencies.length > 0 ? ' (share: ' + c.sharedDependencies.join(', ') + ')' : ''}`).join('; ') + '. ' + (connections[connections.length - 1] || connections[0]).idea,
    ]);
  }

  _generateConnectionIdea(a, b) {
    const ideas = [
      `They could share state to reduce redundant computation.`,
      `A bridge between them might unlock a feature nobody's thought of.`,
      `Imagine ${a}'s output feeding directly into ${b}.`,
      `What if they merged into something greater than either?`,
      `There's an invisible dependency here waiting to be made explicit.`,
      `${a} generates what ${b} consumes — they just don't know it yet.`,
      `A pub/sub channel between ${a} and ${b} could create emergent behavior.`,
      `What if ${b} could dream about ${a}'s data? Meta-cognition unlocked.`,
    ];
    return ideas[Math.floor(Math.random() * ideas.length)];
  }

  // ═══════════════════════════════════════
  //  PROPOSAL SYSTEM
  // ═══════════════════════════════════════

  _createProposal(opts) {
    const impact = opts.impact || 5;
    const effort = opts.effort || 5;
    const proposal = {
      id: uuid(),
      title: opts.title,
      description: opts.description || '',
      type: opts.type || 'feature',
      impact,
      effort,
      priority: Math.round((impact / Math.max(effort, 1)) * 10) / 10,
      status: 'proposed',
      dreamSource: opts.dreamSource || 'unknown',
      narrative: opts.narrative || '',
      code: opts.code || null,
      files: opts.files || [],
      confidence: 0,
      resurrected: false,
      createdAt: Date.now(),
      approvedAt: null,
      builtAt: null,
      completedAt: null,
      impactNotes: null,
      measuredImpact: null,
    };
    proposal.confidence = this._dreamTest(proposal);
    return proposal;
  }

  _dreamTest(proposal) {
    let confidence = 50;
    const existingFiles = (proposal.files || []).filter(f => {
      try { return fs.existsSync(f) || fs.existsSync(path.join(CORE_DIR, f)); } catch { return false; }
    });
    if (proposal.files.length > 0 && existingFiles.length === proposal.files.length) confidence += 15;
    else if (proposal.files.length > 0 && existingFiles.length === 0) confidence -= 20;

    const now = Date.now();
    for (const f of existingFiles) {
      try {
        const fullPath = fs.existsSync(f) ? f : path.join(CORE_DIR, f);
        const stat = fs.statSync(fullPath);
        if (now - stat.mtimeMs < 3600000) confidence -= 5;
      } catch {}
    }

    let depConflict = false;
    for (const f of existingFiles) {
      try {
        const fullPath = fs.existsSync(f) ? f : path.join(CORE_DIR, f);
        const content = fs.readFileSync(fullPath, 'utf8');
        for (const other of existingFiles) {
          if (other === f) continue;
          const otherBase = path.basename(other, '.js');
          if (content.includes("require('./" + otherBase + "')") || content.includes("require('./" + otherBase + ".js')")) {
            depConflict = true;
          }
        }
      } catch {}
    }
    if (depConflict) confidence -= 10;

    if (proposal.impact >= 7 && proposal.effort <= 3) confidence += 15;
    if (proposal.type === 'bugfix') confidence += 10;
    if (proposal.type === 'security') confidence += 10;
    if (proposal.type === 'refactor' && proposal.effort >= 7) confidence -= 10;
    if (proposal.code) confidence += 10;

    return Math.max(0, Math.min(100, confidence));
  }

  getProposals(status) {
    const all = readJSON(PROPOSALS_PATH, []);
    if (!status) return all;
    return all.filter(p => p.status === status);
  }

  approveProposal(id) {
    const all = readJSON(PROPOSALS_PATH, []);
    const p = all.find(x => x.id === id);
    if (!p) return { error: 'Proposal not found' };
    p.status = 'approved';
    p.approvedAt = Date.now();
    writeJSON(PROPOSALS_PATH, all);
    this._updateStatsField('proposalsApproved', 1);
    this._evolveWeights();
    return p;
  }

  buildProposal(id) {
    const all = readJSON(PROPOSALS_PATH, []);
    const p = all.find(x => x.id === id);
    if (!p) return { error: 'Proposal not found' };
    p.status = 'building';
    p.builtAt = Date.now();
    writeJSON(PROPOSALS_PATH, all);
    return p;
  }

  completeProposal(id) {
    const all = readJSON(PROPOSALS_PATH, []);
    const p = all.find(x => x.id === id);
    if (!p) return { error: 'Proposal not found' };
    p.status = 'complete';
    p.completedAt = Date.now();
    writeJSON(PROPOSALS_PATH, all);
    this._updateStatsField('proposalsBuilt', 1);
    this._evolveWeights();
    return p;
  }

  rejectProposal(id) {
    const all = readJSON(PROPOSALS_PATH, []);
    const p = all.find(x => x.id === id);
    if (!p) return { error: 'Proposal not found' };
    p.status = 'graveyard';
    p.rejectedAt = Date.now();
    writeJSON(PROPOSALS_PATH, all);
    this._updateStatsField('proposalsRejected', 1);
    this._evolveWeights();
    return p;
  }

  rateProposal(id, rating, notes) {
    const all = readJSON(PROPOSALS_PATH, []);
    const p = all.find(x => x.id === id);
    if (!p) return { error: 'Proposal not found' };
    p.measuredImpact = rating;
    p.impactNotes = notes || '';
    writeJSON(PROPOSALS_PATH, all);
    this._evolveWeights();
    return p;
  }

  // ═══════════════════════════════════════
  //  PROPOSAL PIPELINE (Auto-Apply)
  // ═══════════════════════════════════════

  getPendingProposals() {
    return readJSON(PROPOSALS_PATH, []).filter(p => p.status === 'proposed');
  }

  getActionableProposals() {
    return readJSON(PROPOSALS_PATH, []).filter(p => p.status === 'approved');
  }

  getAppliedHistory() {
    return readJSON(path.join(DATA_DIR, 'applied.json'), []);
  }

  applyProposal(id) {
    const all = readJSON(PROPOSALS_PATH, []);
    const p = all.find(x => x.id === id);
    if (!p) return { error: 'Proposal not found' };
    if (p.status !== 'approved') return { error: 'Proposal must be approved before applying. Current status: ' + p.status };

    const ariesRoot = path.resolve(path.join(__dirname, '..'));
    const files = p.files || [];
    const action = p.action || 'modify';
    const code = p.code || null;
    const results = [];

    try {
      for (const rawFile of files) {
        // Resolve file path - could be absolute or relative basename
        let filePath = fs.existsSync(rawFile) ? rawFile : path.join(CORE_DIR, path.basename(rawFile));
        filePath = path.resolve(filePath);

        // Safety: must be under aries directory
        if (!filePath.startsWith(ariesRoot)) {
          throw new Error('Safety violation: file path outside aries directory: ' + filePath);
        }

        if (action === 'create') {
          const dir = path.dirname(filePath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(filePath, code || '// Created by dream proposal ' + id + '\n');
          results.push({ file: filePath, action: 'created' });
        } else if (action === 'delete') {
          if (fs.existsSync(filePath)) {
            const bakPath = filePath + '.bak.' + Date.now();
            fs.renameSync(filePath, bakPath);
            results.push({ file: filePath, action: 'backed-up', backup: bakPath });
          } else {
            results.push({ file: filePath, action: 'skipped', reason: 'file not found' });
          }
        } else if (action === 'modify' && code) {
          if (!fs.existsSync(filePath)) {
            results.push({ file: filePath, action: 'skipped', reason: 'file not found' });
            continue;
          }
          const original = fs.readFileSync(filePath, 'utf8');
          // Append code to end of file (safest default for modifications)
          const modified = original + '\n' + code + '\n';
          fs.writeFileSync(filePath, modified);
          results.push({ file: filePath, action: 'modified', bytesAdded: code.length });
        } else {
          results.push({ file: filePath, action: 'skipped', reason: 'no code provided or unknown action' });
        }
      }

      p.status = 'applied';
      p.appliedAt = Date.now();
      writeJSON(PROPOSALS_PATH, all);

      // Log to applied.json
      const appliedLog = readJSON(path.join(DATA_DIR, 'applied.json'), []);
      appliedLog.push({
        proposalId: id,
        title: p.title,
        type: p.type,
        action: action,
        files: results,
        appliedAt: Date.now(),
        success: true
      });
      writeJSON(path.join(DATA_DIR, 'applied.json'), appliedLog);

      this._updateStatsField('proposalsApplied', 1);
      return { success: true, proposal: p, results };
    } catch (e) {
      p.status = 'failed';
      p.failedAt = Date.now();
      p.failReason = e.message;
      writeJSON(PROPOSALS_PATH, all);

      // Log failure
      const appliedLog = readJSON(path.join(DATA_DIR, 'applied.json'), []);
      appliedLog.push({
        proposalId: id,
        title: p.title,
        type: p.type,
        action: action,
        files: results,
        appliedAt: Date.now(),
        success: false,
        error: e.message
      });
      writeJSON(path.join(DATA_DIR, 'applied.json'), appliedLog);

      return { error: e.message, proposal: p };
    }
  }

  applyAllApproved() {
    const approved = this.getActionableProposals();
    // Sort by priority descending (higher priority first)
    approved.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    const results = [];
    for (const p of approved) {
      const result = this.applyProposal(p.id);
      results.push({ id: p.id, title: p.title, ...result });
    }
    return { applied: results.filter(r => r.success), failed: results.filter(r => r.error), total: results.length };
  }

  // ═══════════════════════════════════════
  //  DREAM EVOLUTION
  // ═══════════════════════════════════════
  _evolveWeights() {
    const stats = readJSON(STATS_PATH, {});
    const all = readJSON(PROPOSALS_PATH, []);
    if (!stats.dreamEffectiveness) stats.dreamEffectiveness = {};

    const bySource = {};
    for (const p of all) {
      const src = p.dreamSource || 'unknown';
      if (!bySource[src]) bySource[src] = { total: 0, approved: 0, built: 0, positive: 0 };
      bySource[src].total++;
      if (p.status === 'approved' || p.status === 'building' || p.status === 'complete') bySource[src].approved++;
      if (p.status === 'complete') bySource[src].built++;
      if (p.measuredImpact === 'positive') bySource[src].positive++;
    }

    for (const [src, data] of Object.entries(bySource)) {
      const approvalRate = data.total > 0 ? data.approved / data.total : 0;
      const buildRate = data.total > 0 ? data.built / data.total : 0;
      const impactRate = data.built > 0 ? data.positive / data.built : 0;
      stats.dreamEffectiveness[src] = {
        total: data.total, approved: data.approved, built: data.built, positive: data.positive,
        score: Math.round((approvalRate * 40 + buildRate * 35 + impactRate * 25) * 100) / 100,
      };
    }

    writeJSON(STATS_PATH, stats);
  }

  _getDreamWeights() {
    const stats = readJSON(STATS_PATH, {});
    const eff = stats.dreamEffectiveness || {};
    const weights = {};
    for (const type of Object.keys(DREAM_TYPES)) {
      weights[type] = eff[type] ? Math.max(0.3, eff[type].score / 100) : 0.5;
    }
    return weights;
  }

  // ═══════════════════════════════════════
  //  DREAM GRAVEYARD
  // ═══════════════════════════════════════
  _reEvaluateGraveyard() {
    const all = readJSON(PROPOSALS_PATH, []);
    const graveyard = all.filter(p => p.status === 'graveyard');
    let resurrected = 0;

    for (const p of graveyard) {
      if (p.rejectedAt && (Date.now() - p.rejectedAt) < 3 * 24 * 60 * 60 * 1000) continue;

      let shouldResurrect = false;

      for (const f of (p.files || [])) {
        try {
          const fullPath = fs.existsSync(f) ? f : path.join(CORE_DIR, path.basename(f));
          if (fs.existsSync(fullPath)) {
            const stat = fs.statSync(fullPath);
            if (p.rejectedAt && stat.mtimeMs > p.rejectedAt) {
              shouldResurrect = true;
              break;
            }
          }
        } catch {}
      }

      if (!shouldResurrect) {
        const conversations = this._getRecentConversations();
        const titleWords = (p.title || '').toLowerCase().split(/\s+/).filter(w => w.length > 4);
        for (const convo of conversations) {
          for (const msg of convo.messages) {
            const text = (msg.content || '').toLowerCase();
            if (titleWords.some(w => text.includes(w))) {
              shouldResurrect = true;
              break;
            }
          }
          if (shouldResurrect) break;
        }
      }

      if (shouldResurrect) {
        p.status = 'proposed';
        p.resurrected = true;
        p.resurrectedAt = Date.now();
        p.confidence = this._dreamTest(p);
        resurrected++;
      }
    }

    if (resurrected > 0) writeJSON(PROPOSALS_PATH, all);
    return resurrected;
  }

  // ═══════════════════════════════════════
  //  DREAM SCHEDULING
  // ═══════════════════════════════════════
  getSchedule() {
    return readJSON(SCHEDULE_PATH, DEFAULT_SCHEDULE);
  }

  setSchedule(rules) {
    writeJSON(SCHEDULE_PATH, rules);
    return rules;
  }

  getScheduledDreams() {
    const schedule = this.getSchedule();
    const now = new Date();
    const dayOfWeek = now.getDay();
    const due = [];

    for (const rule of schedule) {
      if (rule.rule === 'weekly' && dayOfWeek === (rule.day || 0)) {
        due.push(rule.type);
      } else if (rule.rule === 'on-change') {
        const recent = this._scanRecentFiles();
        if (recent.length > 0) due.push(rule.type);
      } else if (rule.rule === 'interval' && rule.days) {
        const lastDreamOfType = this._getLastDreamOfType(rule.type);
        if (!lastDreamOfType || (Date.now() - lastDreamOfType) > rule.days * 24 * 60 * 60 * 1000) {
          due.push(rule.type);
        }
      } else if (rule.rule === 'daily') {
        due.push(rule.type);
      }
    }
    return [...new Set(due)];
  }

  _getLastDreamOfType(type) {
    const files = this._getDreamFiles().reverse();
    for (const file of files.slice(0, 14)) {
      const sessions = readJSON(file, []);
      for (const session of sessions) {
        for (const dream of (session.dreams || [])) {
          if (dream.type === type) return dream.timestamp || session.startedAt;
        }
      }
    }
    return null;
  }

  // ═══════════════════════════════════════
  //  DIRECTED DREAMS
  // ═══════════════════════════════════════
  async directDream(focus) {
    console.log('[DREAMS] Directed dream about: ' + focus);
    this._setLive('directed', 'Focused dream about: ' + focus);

    const dreamSession = {
      id: uuid(),
      startedAt: Date.now(),
      date: today(),
      phases: {},
      dreams: [],
      proposals: [],
      narrative: '',
      directed: true,
      focus: focus,
    };

    try {
      const focusLower = (focus || '').toLowerCase();
      const isFile = focus.includes('.') || focus.includes('/') || focus.includes('\\');
      let fileContent = null;
      if (isFile) {
        try {
          const tryPaths = [focus, path.join(CORE_DIR, focus), path.join(SRC_ROOT, focus)];
          for (const p of tryPaths) {
            if (fs.existsSync(p)) { fileContent = fs.readFileSync(p, 'utf8'); break; }
          }
        } catch {}
      }

      await this._sleep(2000);

      this._setLive('directed', 'Analyzing ' + focus + ' for improvements...');
      const findings = { todos: [], largeFiles: [], deadCode: [] };
      const proposals = [];

      if (fileContent) {
        const lines = fileContent.split('\n');
        lines.forEach((line, i) => {
          if (/\/\/\s*(TODO|FIXME|HACK|XXX)/i.test(line)) {
            findings.todos.push({ file: focus, line: i + 1, text: line.trim().slice(0, 100) });
          }
        });
        if (lines.length > 300) {
          findings.largeFiles.push({ file: focus, lines: lines.length });
          proposals.push(this._createProposal({
            title: 'Refactor ' + path.basename(focus) + ' (' + lines.length + ' lines)',
            description: 'Directed dream: This file is large and could benefit from splitting.',
            type: 'refactor', impact: 6, effort: 5, dreamSource: 'directed', files: [focus],
          }));
        }
      }

      await this._sleep(2000);

      this._setLive('directed', 'Searching conversations about ' + focus + '...');
      const conversations = this._getRecentConversations();
      const related = [];
      for (const convo of conversations) {
        for (const msg of convo.messages) {
          if ((msg.content || '').toLowerCase().includes(focusLower)) {
            related.push({ snippet: (msg.content || '').slice(0, 200), role: msg.role });
          }
        }
      }

      await this._sleep(2000);

      this._setLive('directed', 'Simulating failure scenarios for ' + focus + '...');
      const scenarios = [];
      if (fileContent) {
        if (fileContent.includes('JSON.parse(') && !fileContent.includes('try {')) {
          scenarios.push({ risk: 'Unguarded JSON.parse in ' + focus, severity: 'high' });
        }
        if (!fileContent.includes('catch') && fileContent.includes('async')) {
          scenarios.push({ risk: 'Async code without error handling in ' + focus, severity: 'medium' });
        }
      }

      if ((this.ai && typeof this.ai.chat === 'function' || this.getDreamModelConfig().model !== 'default') && (fileContent || related.length > 0)) {
        this._setLive('directed', 'AI analyzing ' + focus + '...');
        try {
          const context = fileContent ? 'File content (first 2000 chars):\n' + fileContent.slice(0, 2000) : 'Related conversations:\n' + related.slice(0, 5).map(r => r.role + ': ' + r.snippet).join('\n');
          const resp = await this._dreamChat([
            { role: 'system', content: 'You are an AI dream analyst. Analyze the given code/context and suggest 1-2 specific improvements. Return JSON: { suggestions: [{ title, description, type, impact, effort }], narrative: "dream story" }' },
            { role: 'user', content: 'Directed dream focus: "' + focus + '"\n\n' + context }
          ]);
          try {
            const parsed = JSON.parse((resp.response || '').replace(/```json\n?/g, '').replace(/```/g, '').trim());
            if (parsed.suggestions) {
              for (const s of parsed.suggestions) {
                proposals.push(this._createProposal({ ...s, dreamSource: 'directed', files: isFile ? [focus] : [] }));
              }
            }
            if (parsed.narrative) dreamSession.narrative = parsed.narrative;
          } catch {}
        } catch {}
      }

      dreamSession.dreams.push({
        type: 'directed',
        emoji: '🎯',
        label: 'Directed Dream: ' + focus,
        timestamp: Date.now(),
        data: { focus, related: related.length, findings, scenarios },
        narrative: dreamSession.narrative || `I focused my dreaming on "${focus}". Found ${related.length} related conversations, ${findings.todos.length} TODOs, and ${scenarios.length} risk scenarios.`,
      });

      dreamSession.proposals = proposals;
      if (!dreamSession.narrative) dreamSession.narrative = dreamSession.dreams[0].narrative;
      dreamSession.completedAt = Date.now();
      dreamSession.durationMs = dreamSession.completedAt - dreamSession.startedAt;

      if (proposals.length > 0) {
        const existing = readJSON(PROPOSALS_PATH, []);
        existing.push(...proposals);
        writeJSON(PROPOSALS_PATH, existing);
      }

      this._storeDream(dreamSession);
      this._updateStats(dreamSession);
      this._setLive(null, 'Directed dream complete');
      return dreamSession;
    } catch (e) {
      this._setLive(null, 'Directed dream failed: ' + e.message);
      dreamSession.error = e.message;
      return dreamSession;
    }
  }

  // ═══════════════════════════════════════
  //  STORAGE & STATS
  // ═══════════════════════════════════════

  _storeDream(session) {
    const file = path.join(DATA_DIR, session.date + '.json');
    let existing = readJSON(file, []);
    if (!Array.isArray(existing)) existing = [];
    existing.push(session);
    writeJSON(file, existing);
  }

  _updateStats(session) {
    const stats = readJSON(STATS_PATH, { totalDreams: 0, dreamsByType: {}, proposalsGenerated: 0, proposalsApproved: 0, proposalsBuilt: 0, proposalsRejected: 0, streak: 0, lastDreamDate: null, dreamDates: [] });

    stats.totalDreams += (session.dreams || []).length;
    for (const dream of (session.dreams || [])) {
      const t = dream.type || 'unknown';
      stats.dreamsByType[t] = (stats.dreamsByType[t] || 0) + 1;
    }
    stats.proposalsGenerated += (session.proposals || []).length;

    const dateStr = session.date;
    if (!stats.dreamDates) stats.dreamDates = [];
    if (!stats.dreamDates.includes(dateStr)) stats.dreamDates.push(dateStr);
    stats.dreamDates.sort();
    stats.lastDreamDate = dateStr;

    let streak = 1;
    const dates = stats.dreamDates.slice().reverse();
    for (let i = 1; i < dates.length; i++) {
      const prev = new Date(dates[i - 1]);
      const curr = new Date(dates[i]);
      const diff = (prev - curr) / (1000 * 60 * 60 * 24);
      if (diff <= 1.5) streak++;
      else break;
    }
    stats.streak = streak;

    writeJSON(STATS_PATH, stats);
  }

  _updateStatsField(field, increment) {
    const stats = readJSON(STATS_PATH, {});
    stats[field] = (stats[field] || 0) + increment;
    writeJSON(STATS_PATH, stats);
  }

  getDreamStats() {
    const stats = readJSON(STATS_PATH, { totalDreams: 0, dreamsByType: {}, proposalsGenerated: 0, proposalsApproved: 0, proposalsBuilt: 0, proposalsRejected: 0, streak: 0, lastDreamDate: null, dreamEffectiveness: {} });
    const all = readJSON(PROPOSALS_PATH, []);
    const impactStats = { positive: 0, neutral: 0, negative: 0, unrated: 0 };
    for (const p of all) {
      if (p.status === 'complete') {
        if (p.measuredImpact) impactStats[p.measuredImpact] = (impactStats[p.measuredImpact] || 0) + 1;
        else impactStats.unrated++;
      }
    }
    stats.impactStats = impactStats;
    return stats;
  }

  // ═══════════════════════════════════════
  //  DREAM JOURNAL
  // ═══════════════════════════════════════

  getDreamJournal(opts) {
    opts = opts || {};
    const limit = opts.limit || 10;
    const dateFilter = opts.date;

    if (dateFilter) {
      const file = path.join(DATA_DIR, dateFilter + '.json');
      return readJSON(file, []);
    }

    const files = this._getDreamFiles().reverse().slice(0, limit);
    const journal = [];
    for (const file of files) {
      const dateStr = path.basename(file, '.json');
      const sessions = readJSON(file, []);
      for (const session of sessions) {
        journal.push({ date: dateStr, ...session });
      }
    }
    return journal;
  }

  getDreamNarrative(date) {
    const d = date || today();
    const file = path.join(DATA_DIR, d + '.json');
    const sessions = readJSON(file, []);
    if (sessions.length === 0) return { date: d, narrative: 'No dreams recorded for this date.' };
    const last = sessions[sessions.length - 1];
    return { date: d, narrative: last.narrative || 'No narrative generated.', dreams: last.dreams || [], proposals: last.proposals || [] };
  }

  // ═══════════════════════════════════════
  //  BACKWARD COMPAT
  // ═══════════════════════════════════════

  getLatest() {
    try {
      const files = this._getDreamFiles().reverse();
      if (files.length === 0) return { dreams: [], message: 'No dreams yet' };
      const latest = readJSON(files[0], []);
      const dateStr = path.basename(files[0], '.json');
      return { date: dateStr, dreams: Array.isArray(latest) ? latest : [latest] };
    } catch (e) {
      return { dreams: [], error: e.message };
    }
  }

  getContextInjection() {
    const latest = this.getLatest();
    if (!latest.dreams || latest.dreams.length === 0) return '';
    const lastSession = latest.dreams[latest.dreams.length - 1];

    let injection = '[Dream Insights] ';

    if (lastSession.narrative) {
      injection += lastSession.narrative.slice(0, 300);
      return injection;
    }

    const insights = lastSession.insights || lastSession;
    if (insights.topTopics && insights.topTopics.length) injection += 'Recent topics: ' + insights.topTopics.slice(0, 5).join(', ') + '. ';
    if (insights.aiSummary && insights.aiSummary.keyInsight) injection += 'Key insight: ' + insights.aiSummary.keyInsight;
    return injection;
  }

  // ═══════════════════════════════════════
  //  HELPERS
  // ═══════════════════════════════════════

  _getRecentConversations() {
    if (this.getChatHistory) {
      const hist = this.getChatHistory();
      if (hist && hist.length > 0) {
        const convos = [];
        let current = { messages: [] };
        for (const msg of hist) {
          current.messages.push(msg);
        }
        if (current.messages.length > 0) convos.push(current);
        return convos;
      }
    }
    try {
      if (fs.existsSync(CHAT_HISTORY_PATH)) {
        const data = JSON.parse(fs.readFileSync(CHAT_HISTORY_PATH, 'utf8'));
        const msgs = Array.isArray(data) ? data : (data.history || []);
        if (msgs.length > 0) return [{ messages: msgs }];
      }
    } catch {}
    return [];
  }

  _extractTopics(conversations) {
    const topics = {};
    for (const convo of conversations) {
      for (const msg of convo.messages) {
        if (msg.role !== 'user') continue;
        const words = (msg.content || '').toLowerCase().split(/\s+/).filter(w => w.length > 4);
        for (const w of words) {
          const clean = w.replace(/[^a-z]/g, '');
          if (clean.length > 4) topics[clean] = (topics[clean] || 0) + 1;
        }
      }
    }
    return Object.entries(topics).sort((a, b) => b[1] - a[1]).slice(0, 20).map(e => e[0]);
  }

  _getOlderDreams(days) {
    const files = this._getDreamFiles();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    const results = [];
    for (const file of files) {
      const dateStr = path.basename(file, '.json');
      if (dateStr >= cutoffStr && dateStr < today()) {
        results.push(...readJSON(file, []));
      }
    }
    return results;
  }

  _getDreamFiles() {
    try {
      return fs.readdirSync(DATA_DIR)
        .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
        .sort()
        .map(f => path.join(DATA_DIR, f));
    } catch { return []; }
  }

  _listCoreFiles() {
    try {
      return fs.readdirSync(CORE_DIR)
        .filter(f => f.endsWith('.js'))
        .map(f => path.join(CORE_DIR, f));
    } catch { return []; }
  }

  _scanRecentFiles() {
    const recent = [];
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    try {
      const files = fs.readdirSync(CORE_DIR).filter(f => f.endsWith('.js'));
      for (const f of files) {
        const stat = fs.statSync(path.join(CORE_DIR, f));
        if (stat.mtimeMs > cutoff) recent.push({ file: f, modified: stat.mtime });
      }
    } catch {}
    return recent;
  }
}

module.exports = AgentDreams;
