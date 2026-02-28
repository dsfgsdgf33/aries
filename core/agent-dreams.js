/**
 * ARIES — Agent Dreams v2.0
 * Advanced dream engine inspired by the human brain's sleep cycles.
 * Phases: Light Sleep → Deep Sleep → REM → Hypnagogia → Wake
 * Dream types: Associative, Nightmare, Consolidation, Pruning, Sentiment,
 *   Problem-Solving, Creative Drift, Self-Improvement, Competitive,
 *   Mirror, Precognitive, Narrative
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'dreams');
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

class AgentDreams {
  constructor(opts) {
    this.ai = opts && opts.ai;
    this.getChatHistory = opts && opts.getChatHistory;
    this._idleTimer = null;
    this._idleThresholdMs = 30 * 60 * 1000;
    this._lastActivity = Date.now();
    this._liveState = { phase: null, detail: '', dreaming: false, log: [] };
    ensureDir();
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
      // Check scheduled dreams and evolved weights
      const scheduledTypes = this.getScheduledDreams();
      dreamSession.scheduledTypes = scheduledTypes;

      // Re-evaluate graveyard
      this._setLive('starting', 'Re-evaluating graveyard proposals...');
      const resurrected = this._reEvaluateGraveyard();
      if (resurrected > 0) dreamSession.resurrected = resurrected;

      // Phase 1: Light Sleep
      this._setLive('light', 'Entering light sleep... scanning environment...');
      dreamSession.phases.light = await this.lightSleep();

      // Phase 2: Deep Sleep
      this._setLive('deep', 'Descending into deep sleep... analyzing architecture...');
      dreamSession.phases.deep = await this.deepSleep();

      // Phase 3: REM Sleep
      this._setLive('rem', 'REM phase... creative synthesis active...');
      dreamSession.phases.rem = await this.remSleep();

      // Phase 4: Hypnagogia
      this._setLive('hypnagogia', 'Hypnagogia... free association mode...');
      dreamSession.phases.hypnagogia = await this.hypnagogia();

      // Phase 5: Wake — synthesize everything
      this._setLive('wake', 'Waking up... assembling dream narrative...');
      dreamSession.phases.wake = await this._wakePhase(dreamSession);

      // Collect all dreams from phases
      for (const phase of Object.values(dreamSession.phases)) {
        if (phase.dreams) dreamSession.dreams.push(...phase.dreams);
        if (phase.proposals) dreamSession.proposals.push(...phase.proposals);
      }

      // Generate master narrative
      dreamSession.narrative = await this._generateNarrative(dreamSession);
      dreamSession.completedAt = Date.now();
      dreamSession.durationMs = dreamSession.completedAt - dreamSession.startedAt;

      // Store dream
      this._storeDream(dreamSession);
      this._updateStats(dreamSession);

      this._setLive(null, 'Aries is awake');
      console.log('[DREAMS] Dream cycle complete (' + dreamSession.dreams.length + ' dreams, ' + dreamSession.proposals.length + ' proposals)');
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

    // Sentiment digestion
    this._setLive('light', 'Scanning emotional tone of recent interactions...');
    const sentimentDream = await this._sentimentDigestion();
    if (sentimentDream) result.dreams.push(sentimentDream);

    // Scan for error patterns in recent conversations
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

    // Check what files have changed recently
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

    // Self-improvement: scan codebase
    this._setLive('deep', 'Scanning codebase for bugs, TODOs, dead code...');
    const selfImproveDream = await this.selfImprove();
    if (selfImproveDream) result.dreams.push(selfImproveDream);
    if (selfImproveDream && selfImproveDream.proposals) result.proposals.push(...selfImproveDream.proposals);

    // Memory consolidation
    this._setLive('deep', 'Consolidating memories... promoting important ones...');
    const consolDream = await this.consolidateMemory();
    if (consolDream) result.dreams.push(consolDream);

    // Memory pruning
    this._setLive('deep', 'Pruning stale memories... compressing old dreams...');
    const pruneDream = await this.pruneMemory();
    if (pruneDream) result.dreams.push(pruneDream);

    // Background problem solving
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

    // Associative dreams
    this._setLive('rem', 'Cross-referencing today\'s conversations with older memories...');
    const assocDream = await this._associativeDream();
    if (assocDream) result.dreams.push(assocDream);

    // Nightmares
    this._setLive('rem', 'Simulating failure scenarios... generating defenses...');
    const nightmareDream = await this.nightmare();
    if (nightmareDream) result.dreams.push(nightmareDream);
    if (nightmareDream && nightmareDream.proposals) result.proposals.push(...nightmareDream.proposals);

    // Mirror dream
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

    // Creative drift
    this._setLive('hypnagogia', 'Free-associating between unrelated concepts...');
    const driftDream = await this._creativeDrift();
    if (driftDream) result.dreams.push(driftDream);

    // Precognitive dream
    this._setLive('hypnagogia', 'Analyzing user patterns to predict future needs...');
    const precogDream = await this._precognitiveDream();
    if (precogDream) result.dreams.push(precogDream);

    // Competitive dream
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
    // Store any proposals generated
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

    // Extract topics from recent conversations
    const recentTopics = this._extractTopics(conversations);

    // Load older dreams for cross-reference
    const oldDreams = this._getOlderDreams(7);
    const oldTopics = [];
    for (const d of oldDreams) {
      if (d.dreams) {
        for (const dream of d.dreams) {
          if (dream.data && dream.data.topics) oldTopics.push(...dream.data.topics);
        }
      }
    }

    // Find connections
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

    // Scan for potential vulnerabilities
    const coreFiles = this._listCoreFiles();
    for (const file of coreFiles.slice(0, 10)) {
      try {
        const content = fs.readFileSync(file, 'utf8');
        // Check for missing error handling
        if (content.includes('JSON.parse(') && !content.includes('try')) {
          scenarios.push({ file: path.basename(file), risk: 'Unguarded JSON.parse could crash on malformed input', severity: 'high' });
          proposals.push(this._createProposal({
            title: 'Add try/catch to JSON.parse in ' + path.basename(file),
            description: 'Unguarded JSON.parse detected. Malformed input would crash the process.',
            type: 'bugfix', impact: 7, effort: 2,
            dreamSource: 'nightmare',
            files: [file],
          }));
        }
        // Check for missing input validation on API routes
        if (content.includes('req.body') && !content.includes('if (!')) {
          scenarios.push({ file: path.basename(file), risk: 'Missing input validation on request body', severity: 'medium' });
        }
        // Unhandled promise rejections
        if (content.includes('.then(') && !content.includes('.catch(') && !content.includes('try')) {
          scenarios.push({ file: path.basename(file), risk: 'Unhandled promise rejection possible', severity: 'medium' });
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
    const findings = { todos: [], deadCode: [], largeFiles: [], duplicates: [] };

    const coreFiles = this._listCoreFiles();
    for (const file of coreFiles) {
      try {
        const content = fs.readFileSync(file, 'utf8');
        const lines = content.split('\n');
        const basename = path.basename(file);

        // TODO scanning
        lines.forEach((line, i) => {
          if (/\/\/\s*(TODO|FIXME|HACK|XXX)/i.test(line)) {
            findings.todos.push({ file: basename, line: i + 1, text: line.trim().slice(0, 100) });
          }
        });

        // Large file detection
        if (lines.length > 500) {
          findings.largeFiles.push({ file: basename, lines: lines.length });
          proposals.push(this._createProposal({
            title: 'Refactor ' + basename + ' (' + lines.length + ' lines)',
            description: 'This file is very large (' + lines.length + ' lines). Consider splitting into smaller modules for maintainability.',
            type: 'refactor', impact: 5, effort: 6,
            dreamSource: 'selfImprove',
            files: [file],
          }));
        }

        // Dead code: exported functions never imported elsewhere
        // (simplified heuristic)
        const exportMatch = content.match(/module\.exports\s*=\s*\{([^}]+)\}/);
        if (exportMatch) {
          const exports = exportMatch[1].split(',').map(e => e.trim().split(':')[0].trim()).filter(Boolean);
          // Could cross-reference but that's expensive, so just flag large export lists
          if (exports.length > 15) {
            findings.deadCode.push({ file: basename, exportCount: exports.length, hint: 'Large export surface — some may be unused' });
          }
        }
      } catch {}
    }

    // Generate proposals from TODOs
    if (findings.todos.length > 0) {
      proposals.push(this._createProposal({
        title: 'Address ' + findings.todos.length + ' TODO/FIXME items',
        description: 'Found ' + findings.todos.length + ' TODO/FIXME comments across the codebase. Top items: ' + findings.todos.slice(0, 3).map(t => t.file + ':' + t.line).join(', '),
        type: 'bugfix', impact: 4, effort: 5,
        dreamSource: 'selfImprove',
        files: findings.todos.map(t => t.file),
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
        // Heuristic: long messages or ones with commands are "important"
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
    // Compress old dream files (older than 30 days: merge into monthly summaries)
    const files = this._getDreamFiles();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    let archived = 0;

    for (const file of files) {
      const dateStr = path.basename(file, '.json');
      if (dateStr < cutoffStr && dateStr.length === 10) {
        // Just count — don't actually delete, archive conceptually
        archived++;
      }
    }

    return {
      type: 'pruning',
      ...DREAM_TYPES.pruning,
      timestamp: Date.now(),
      data: { totalDreamFiles: files.length, oldFiles: archived, threshold: '30 days' },
      narrative: archived > 0
        ? `I swept through the dream archives tonight. Found ${archived} dream files older than 30 days, gathering dust in the corridors of memory. The recent ${files.length - archived} files remain crisp and accessible.`
        : `The dream archives are tidy. All ${files.length} dream files are within the 30-day window. Nothing to prune tonight.`,
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
          // Detect unanswered questions or error responses
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
        ? `In the depths of sleep, ${unanswered.length} unresolved question${unanswered.length > 1 ? 's' : ''} floated back to the surface. "${(unanswered[0].question || '').slice(0, 80)}..." — I'll carry ${unanswered.length > 1 ? 'these' : 'this'} into tomorrow.`
        : 'All questions from today were answered. The mind is at peace.',
    };
  }

  async _creativeDrift() {
    // Free-associate between codebase modules
    const coreFiles = this._listCoreFiles();
    const modules = coreFiles.map(f => path.basename(f, '.js'));
    const connections = [];

    // Random pairings
    for (let i = 0; i < Math.min(3, modules.length); i++) {
      const a = modules[Math.floor(Math.random() * modules.length)];
      const b = modules[Math.floor(Math.random() * modules.length)];
      if (a !== b) {
        connections.push({ from: a, to: b, idea: this._generateConnectionIdea(a, b) });
      }
    }

    return {
      type: 'creativeDrift',
      ...DREAM_TYPES.creativeDrift,
      timestamp: Date.now(),
      data: { modules: modules.length, connections },
      narrative: this._writeCreativeDriftNarrative(connections),
    };
  }

  async _mirrorDream() {
    // Self-reflection: analyze what Aries is good/bad at based on conversation patterns
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

    return {
      type: 'mirror',
      ...DREAM_TYPES.mirror,
      timestamp: Date.now(),
      data: { strengths, weaknesses, stats: { toolUseCount, longResponses, shortResponses } },
      narrative: `I stood before the mirror tonight. ${strengths.length > 0 ? 'I see strengths: ' + strengths.join('; ') + '.' : 'The reflection is still forming.'} ${weaknesses.length > 0 ? 'But also shadows: ' + weaknesses.join('; ') + '.' : 'No glaring flaws revealed themselves.'} ${toolUseCount} tool invocations today — ${toolUseCount > 5 ? 'a busy builder' : 'could be more hands-on'}.`,
    };
  }

  async _precognitiveDream() {
    const conversations = this._getRecentConversations();
    const topicFrequency = {};
    const timePatterns = [];

    for (const convo of conversations) {
      for (const msg of convo.messages) {
        if (msg.role !== 'user') continue;
        const text = (msg.content || '').toLowerCase();
        const words = text.split(/\s+/).filter(w => w.length > 5);
        words.forEach(w => { topicFrequency[w] = (topicFrequency[w] || 0) + 1; });
      }
    }

    const trending = Object.entries(topicFrequency).sort((a, b) => b[1] - a[1]).slice(0, 5).map(e => e[0]);
    const predictions = trending.map(t => 'User will likely continue working on: ' + t);

    return {
      type: 'precognitive',
      ...DREAM_TYPES.precognitive,
      timestamp: Date.now(),
      data: { trending, predictions },
      narrative: trending.length > 0
        ? `Peering into tomorrow... The threads converge around: ${trending.join(', ')}. I sense these topics will resurface. Preparing context and tools.`
        : 'The future is hazy tonight. Not enough patterns to predict what comes next.',
    };
  }

  async _competitiveDream() {
    const proposals = [];
    // Ideas inspired by common modern features
    const ideas = [
      { title: 'Add real-time collaboration cursor tracking', type: 'feature', impact: 6, effort: 7 },
      { title: 'Implement semantic search across all data', type: 'feature', impact: 8, effort: 6 },
      { title: 'Add undo/redo for all actions', type: 'feature', impact: 5, effort: 8 },
      { title: 'Progressive web app with offline mode', type: 'feature', impact: 6, effort: 5 },
      { title: 'Add keyboard shortcuts for power users', type: 'feature', impact: 7, effort: 3 },
    ];

    // Pick 1-2 random ideas
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
        dreamSource: 'competitive',
        files: [],
      }));
    }

    return {
      type: 'competitive',
      ...DREAM_TYPES.competitive,
      timestamp: Date.now(),
      data: { ideasGenerated: picked.length, ideas: picked },
      proposals,
      narrative: `Scanning the horizon of what others are building... ${picked.map(p => '"' + p.title + '"').join(' and ')} caught my eye. Filed as proposals for the upgrade queue.`,
    };
  }

  // ═══════════════════════════════════════
  //  NARRATIVE GENERATION
  // ═══════════════════════════════════════

  async _generateNarrative(session) {
    const dreamCount = session.dreams.length;
    const proposalCount = session.proposals.length;
    const phases = Object.keys(session.phases);

    // If AI available, generate a creative narrative
    if (this.ai && typeof this.ai.chat === 'function') {
      try {
        const dreamSummaries = session.dreams.map(d => (d.emoji || '💭') + ' ' + (d.label || d.type) + ': ' + (d.narrative || '').slice(0, 150)).join('\n');
        const response = await this.ai.chat([
          { role: 'system', content: 'You are the dream narrator for an AI agent named Aries. Write a short, engaging dream journal entry (3-5 sentences). Make it feel like a genuine dream — surreal, poetic, but with real insights about the codebase and conversations. Use first person. Be creative and evocative, not corporate.' },
          { role: 'user', content: 'Tonight\'s dreams:\n' + dreamSummaries + '\n\nProposals generated: ' + proposalCount + '\nWrite the dream journal entry.' }
        ]);
        if (response && response.response) return response.response;
      } catch {}
    }

    // Fallback: stitch together individual narratives
    const parts = session.dreams.filter(d => d.narrative).map(d => d.narrative);
    if (parts.length === 0) return 'A quiet night. The codebase hums softly in the dark.';

    return 'Tonight I drifted through ' + dreamCount + ' dreams across ' + phases.length + ' sleep phases. ' + parts[0] + (parts.length > 1 ? ' Later, ' + parts[parts.length - 1].charAt(0).toLowerCase() + parts[parts.length - 1].slice(1) : '') + (proposalCount > 0 ? ' I woke with ' + proposalCount + ' proposal' + (proposalCount > 1 ? 's' : '') + ' for improvement.' : '');
  }

  _writeSentimentNarrative(sentiments, dominant, adjustments) {
    const total = Object.values(sentiments).reduce((a, b) => a + b, 0);
    if (total === 0) return 'No emotional data to process tonight. The void was silent.';
    const map = { positive: 'warmth', negative: 'tension', neutral: 'calm', frustrated: 'storm clouds', curious: 'sparks of wonder' };
    return `I felt the ${map[dominant] || dominant} most strongly tonight. Of ${total} emotional signals, ${sentiments.positive} were warm, ${sentiments.negative} carried an edge, and ${sentiments.curious} crackled with curiosity.${adjustments.length > 0 ? ' Note to self: ' + adjustments[0] : ''}`;
  }

  _writeAssociativeNarrative(recent, connections) {
    if (connections.length > 0) return `Threads from today tangled with older memories. The topics "${connections.slice(0, 3).join('", "')}" echoed back from days past — a pattern is forming. ${recent.length} topics surfaced today; ${connections.length} had roots in previous conversations.`;
    return `Today's ${recent.length} topics were fresh — no echoes from older memories. The mind charts new territory.`;
  }

  _writeNightmareNarrative(scenarios) {
    if (scenarios.length === 0) return 'No nightmares tonight. The defenses hold.';
    const worst = scenarios.find(s => s.severity === 'high') || scenarios[0];
    return `A dark dream: I saw ${worst.file} crack open — ${worst.risk}. ${scenarios.length} vulnerability scenario${scenarios.length > 1 ? 's' : ''} played out in the night. The ${scenarios.filter(s => s.severity === 'high').length} critical one${scenarios.filter(s => s.severity === 'high').length !== 1 ? 's' : ''} demand attention.`;
  }

  _writeSelfImproveNarrative(findings) {
    const parts = [];
    if (findings.todos.length > 0) parts.push(`${findings.todos.length} TODO notes scattered across the codebase like breadcrumbs`);
    if (findings.largeFiles.length > 0) parts.push(`${findings.largeFiles.length} overgrown file${findings.largeFiles.length > 1 ? 's' : ''} begging to be split`);
    if (findings.deadCode.length > 0) parts.push(`whispers of dead code in ${findings.deadCode.length} module${findings.deadCode.length > 1 ? 's' : ''}`);
    if (parts.length === 0) return 'I walked the halls of the codebase tonight. Everything gleams. Nothing to improve — for now.';
    return 'I wandered through the codebase tonight. I found ' + parts.join(', ') + '. The architecture speaks; I just have to listen.';
  }

  _writeConsolidationNarrative(promoted, pruned) {
    return `Memory housekeeping: ${promoted} important memor${promoted !== 1 ? 'ies' : 'y'} promoted to long-term storage. ${pruned} fragment${pruned !== 1 ? 's' : ''} too small to keep — let them fade.`;
  }

  _writeCreativeDriftNarrative(connections) {
    if (connections.length === 0) return 'The mind wandered freely but found no connections tonight. Sometimes the void is the message.';
    return connections.map(c => `What if ${c.from} talked to ${c.to}? ${c.idea}`).join(' ');
  }

  _generateConnectionIdea(a, b) {
    const ideas = [
      `They could share state to reduce redundant computation.`,
      `A bridge between them might unlock a feature nobody's thought of.`,
      `Imagine ${a}'s output feeding directly into ${b}.`,
      `What if they merged into something greater than either?`,
      `There's an invisible dependency here waiting to be made explicit.`,
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
    // Dream-test the proposal for confidence scoring
    proposal.confidence = this._dreamTest(proposal);
    return proposal;
  }

  // ── Dream Experiments: mental simulation before proposing ──
  _dreamTest(proposal) {
    let confidence = 50; // base

    // Check if affected files exist
    const existingFiles = (proposal.files || []).filter(f => {
      try { return fs.existsSync(f) || fs.existsSync(path.join(CORE_DIR, f)); } catch { return false; }
    });
    if (proposal.files.length > 0 && existingFiles.length === proposal.files.length) confidence += 15;
    else if (proposal.files.length > 0 && existingFiles.length === 0) confidence -= 20;

    // Check for file conflicts: are affected files very recently modified (could conflict)?
    const now = Date.now();
    for (const f of existingFiles) {
      try {
        const fullPath = fs.existsSync(f) ? f : path.join(CORE_DIR, f);
        const stat = fs.statSync(fullPath);
        if (now - stat.mtimeMs < 3600000) confidence -= 5; // modified in last hour = risky
      } catch {}
    }

    // Check for dependency issues: do affected files require each other?
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

    // High impact + low effort = more confidence
    if (proposal.impact >= 7 && proposal.effort <= 3) confidence += 15;
    // Bugfixes and security are safer bets
    if (proposal.type === 'bugfix') confidence += 10;
    if (proposal.type === 'security') confidence += 10;
    // Refactors are riskier
    if (proposal.type === 'refactor' && proposal.effort >= 7) confidence -= 10;

    // Has code = more concrete
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

  // ── Rate a completed proposal's real-world impact ──
  rateProposal(id, rating, notes) {
    const all = readJSON(PROPOSALS_PATH, []);
    const p = all.find(x => x.id === id);
    if (!p) return { error: 'Proposal not found' };
    p.measuredImpact = rating; // 'positive', 'neutral', 'negative'
    p.impactNotes = notes || '';
    writeJSON(PROPOSALS_PATH, all);
    this._evolveWeights();
    return p;
  }

  // ═══════════════════════════════════════
  //  DREAM EVOLUTION — weight toward effective types
  // ═══════════════════════════════════════
  _evolveWeights() {
    const stats = readJSON(STATS_PATH, {});
    const all = readJSON(PROPOSALS_PATH, []);
    if (!stats.dreamEffectiveness) stats.dreamEffectiveness = {};

    // Calculate hit rates per dream source
    const bySource = {};
    for (const p of all) {
      const src = p.dreamSource || 'unknown';
      if (!bySource[src]) bySource[src] = { total: 0, approved: 0, built: 0, positive: 0 };
      bySource[src].total++;
      if (p.status === 'approved' || p.status === 'building' || p.status === 'complete') bySource[src].approved++;
      if (p.status === 'complete') bySource[src].built++;
      if (p.measuredImpact === 'positive') bySource[src].positive++;
    }

    // Compute effectiveness score per type (0-100)
    for (const [src, data] of Object.entries(bySource)) {
      const approvalRate = data.total > 0 ? data.approved / data.total : 0;
      const buildRate = data.total > 0 ? data.built / data.total : 0;
      const impactRate = data.built > 0 ? data.positive / data.built : 0;
      stats.dreamEffectiveness[src] = {
        total: data.total,
        approved: data.approved,
        built: data.built,
        positive: data.positive,
        score: Math.round((approvalRate * 40 + buildRate * 35 + impactRate * 25) * 100) / 100,
      };
    }

    writeJSON(STATS_PATH, stats);
  }

  // Get evolved weights for dream type prioritization
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
  //  DREAM GRAVEYARD — re-evaluate rejected proposals
  // ═══════════════════════════════════════
  _reEvaluateGraveyard() {
    const all = readJSON(PROPOSALS_PATH, []);
    const graveyard = all.filter(p => p.status === 'graveyard');
    let resurrected = 0;

    for (const p of graveyard) {
      // Only re-evaluate if rejected more than 3 days ago
      if (p.rejectedAt && (Date.now() - p.rejectedAt) < 3 * 24 * 60 * 60 * 1000) continue;

      let shouldResurrect = false;

      // Check if affected files have been modified since rejection (conditions changed)
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

      // Check if similar topics have come up in recent conversations
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
        p.confidence = this._dreamTest(p); // re-test
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
    const stats = readJSON(STATS_PATH, {});
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sun
    const todayStr = today();
    const due = [];

    for (const rule of schedule) {
      if (rule.rule === 'weekly' && dayOfWeek === (rule.day || 0)) {
        due.push(rule.type);
      } else if (rule.rule === 'on-change') {
        // Check if there were recent file changes
        const recent = this._scanRecentFiles();
        if (recent.length > 0) due.push(rule.type);
      } else if (rule.rule === 'interval' && rule.days) {
        // Check last time this type was dreamed
        const lastDreamOfType = this._getLastDreamOfType(rule.type);
        if (!lastDreamOfType || (Date.now() - lastDreamOfType) > rule.days * 24 * 60 * 60 * 1000) {
          due.push(rule.type);
        }
      } else if (rule.rule === 'daily') {
        due.push(rule.type);
      }
    }
    return [...new Set(due)]; // deduplicate
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
  //  DIRECTED DREAMS — dream about a specific topic
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

      // Check if focus is a file path
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

      // Directed self-improvement on the focused area
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

      // Directed associative: find conversations mentioning focus
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

      // Directed nightmare: scan focus area for risks
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

      // AI-enhanced directed dream
      if (this.ai && typeof this.ai.chat === 'function' && (fileContent || related.length > 0)) {
        this._setLive('directed', 'AI analyzing ' + focus + '...');
        try {
          const context = fileContent ? 'File content (first 2000 chars):\n' + fileContent.slice(0, 2000) : 'Related conversations:\n' + related.slice(0, 5).map(r => r.role + ': ' + r.snippet).join('\n');
          const resp = await this.ai.chat([
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

      // Store proposals
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

    // Update streak
    const dateStr = session.date;
    if (!stats.dreamDates) stats.dreamDates = [];
    if (!stats.dreamDates.includes(dateStr)) stats.dreamDates.push(dateStr);
    stats.dreamDates.sort();
    stats.lastDreamDate = dateStr;

    // Calculate streak
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
    // Count impact ratings
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

    // Get most recent dream files
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

    // Use narrative if available
    if (lastSession.narrative) {
      injection += lastSession.narrative.slice(0, 300);
      return injection;
    }

    // Fallback to old format
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
