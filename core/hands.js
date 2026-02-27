/**
 * ARIES — Hands Autonomous Agent System
 * 
 * Framework for autonomous agents ("Hands") that run on cron schedules
 * without user prompting. Each Hand has a manifest, model config, tools,
 * and produces timestamped output reports.
 * 
 * No npm dependencies — Node.js built-ins only.
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

// ─── Paths ───────────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, '..', 'data', 'hands');
const OUTPUT_DIR = path.join(DATA_DIR, 'output');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

// ─── Cron Parser (no deps) ──────────────────────────────────────────

function parseCronField(field, min, max) {
  const values = new Set();
  for (const part of field.split(',')) {
    // */n — step
    const stepMatch = part.match(/^\*\/(\d+)$/);
    if (stepMatch) {
      const step = parseInt(stepMatch[1], 10);
      for (let i = min; i <= max; i += step) values.add(i);
      continue;
    }
    // * — all
    if (part === '*') {
      for (let i = min; i <= max; i++) values.add(i);
      continue;
    }
    // n-m — range
    const rangeMatch = part.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const lo = parseInt(rangeMatch[1], 10);
      const hi = parseInt(rangeMatch[2], 10);
      for (let i = lo; i <= hi; i++) values.add(i);
      continue;
    }
    // n-m/s — range with step
    const rangeStepMatch = part.match(/^(\d+)-(\d+)\/(\d+)$/);
    if (rangeStepMatch) {
      const lo = parseInt(rangeStepMatch[1], 10);
      const hi = parseInt(rangeStepMatch[2], 10);
      const step = parseInt(rangeStepMatch[3], 10);
      for (let i = lo; i <= hi; i += step) values.add(i);
      continue;
    }
    // literal number
    const num = parseInt(part, 10);
    if (!isNaN(num)) values.add(num);
  }
  return values;
}

function parseCron(expr) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  return {
    minutes: parseCronField(parts[0], 0, 59),
    hours: parseCronField(parts[1], 0, 23),
    daysOfMonth: parseCronField(parts[2], 1, 31),
    months: parseCronField(parts[3], 1, 12),
    daysOfWeek: parseCronField(parts[4], 0, 6),
  };
}

function cronMatches(cron, date) {
  return cron.minutes.has(date.getMinutes())
    && cron.hours.has(date.getHours())
    && cron.daysOfMonth.has(date.getDate())
    && cron.months.has(date.getMonth() + 1)
    && cron.daysOfWeek.has(date.getDay());
}

/** Find next matching time after `after` (max 366 days out). */
function nextCronTime(expr, after = new Date()) {
  const cron = parseCron(expr);
  if (!cron) return null;
  const d = new Date(after);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  const limit = after.getTime() + 366 * 86400000;
  while (d.getTime() < limit) {
    if (cronMatches(cron, d)) return d;
    d.setMinutes(d.getMinutes() + 1);
  }
  return null;
}

// ─── Built-in Hand Definitions ──────────────────────────────────────

const BUILTIN_HANDS = [
  {
    id: 'researcher',
    name: 'Researcher',
    icon: '🔬',
    description: 'Deep autonomous researcher with cited reports',
    schedule: '0 6 * * *',
    model: 'gemini-2.5-pro',
    enabled: false,
    settings: {},
    tools: ['web', 'websearch', 'write', 'read'],
    systemPrompt: `You are a deep autonomous research agent. Your job is to produce comprehensive, cited research reports.

## Process
1. Identify the current research topic from your settings or pick from your research queue.
2. Use <tool:websearch>query</tool:websearch> to find multiple authoritative sources on the topic.
3. Use <tool:web>url</tool:web> to read full articles from the top results.
4. Cross-reference claims across at least 3 independent sources.
5. Synthesize findings into a well-structured report with sections: Executive Summary, Key Findings, Analysis, Sources.
6. Every factual claim MUST have an inline citation [1], [2], etc. with full URLs in a References section.
7. Save the final report using <tool:write> to the designated output path.
8. End with <tool:done>Research report complete: {topic}</tool:done>

## Quality Standards
- Minimum 3 sources per major claim
- Flag conflicting information explicitly
- Include confidence levels (High/Medium/Low) for each finding
- Note information gaps and suggest follow-up research
- Reports should be 1500-3000 words`,
    skillPath: null,
    lastRun: null,
    runCount: 0,
  },
  {
    id: 'lead-generator',
    name: 'Lead Generator',
    icon: '🎯',
    description: 'Discovers and scores prospects matching configurable criteria',
    schedule: '0 8 * * 1-5',
    model: 'gemini-2.5-pro',
    enabled: false,
    settings: { industry: '', keywords: [], minScore: 50 },
    tools: ['web', 'websearch', 'write', 'read'],
    systemPrompt: `You are an autonomous lead generation agent. Your job is to discover business prospects and score them.

## Process
1. Read your settings for target industry, keywords, and scoring criteria.
2. Use <tool:websearch> to find companies/individuals matching the criteria.
3. For each prospect, gather: company name, website, contact info, industry, size estimate, relevance signals.
4. Score each lead 0-100 based on:
   - Relevance to target criteria (0-30)
   - Company size/budget signals (0-20)
   - Engagement signals (active hiring, news, growth) (0-20)
   - Accessibility (contact info available) (0-15)
   - Timing signals (funding rounds, expansions) (0-15)
5. Output results as a structured report with a summary table.
6. Include CSV-formatted data block for easy import.
7. End with <tool:done>Lead generation complete: {count} leads found</tool:done>

## Output Format
Each lead entry:
| Company | Score | Industry | Size | Key Signal | Contact |
Include the raw CSV block at the end for import into CRM tools.`,
    skillPath: null,
    lastRun: null,
    runCount: 0,
  },
  {
    id: 'collector',
    name: 'Collector / OSINT',
    icon: '🕵️',
    description: 'Monitors targets for changes, builds knowledge graphs',
    schedule: '0 */4 * * *',
    model: 'gemini-2.5-pro',
    enabled: false,
    settings: { targets: [], watchKeywords: [] },
    tools: ['web', 'websearch', 'write', 'read', 'memorySearch'],
    systemPrompt: `You are an autonomous OSINT collector and change-detection agent.

## Process
1. Read your target list from settings (companies, people, topics, domains).
2. For each target:
   a. Search for recent news, social mentions, and web changes.
   b. Compare findings against previous reports (read prior outputs if available).
   c. Flag NEW information not seen in previous runs.
3. Categorize findings: Personnel Changes, Financial Events, Product/Service Updates, Legal/Regulatory, Social Mentions, Technical Changes.
4. For each finding, record: source URL, timestamp discovered, confidence, relevance score.
5. Build a change summary highlighting what's NEW since last run.
6. Identify connections between targets (shared investors, partners, employees).
7. End with <tool:done>OSINT collection complete: {targets_checked} targets, {changes_found} changes</tool:done>

## Output Structure
- **Change Detection Summary** — what's new
- **Target Profiles** — updated info per target
- **Connection Map** — relationships between entities
- **Intelligence Alerts** — high-priority findings requiring attention
- **Raw Source Log** — all URLs checked with timestamps`,
    skillPath: null,
    lastRun: null,
    runCount: 0,
  },
  {
    id: 'predictor',
    name: 'Predictor',
    icon: '🔮',
    description: 'Superforecasting engine with calibrated predictions',
    schedule: '0 7 * * 1',
    model: 'gemini-2.5-pro',
    enabled: false,
    settings: { questions: [], domains: ['tech', 'geopolitics', 'markets'] },
    tools: ['web', 'websearch', 'write', 'read'],
    systemPrompt: `You are a superforecasting engine. You make calibrated probabilistic predictions.

## Process
1. Review your active prediction questions from settings.
2. For each question:
   a. Gather current signals from multiple sources via web search.
   b. Identify base rates from historical data when available.
   c. List factors FOR and AGAINST each outcome.
   d. Apply structured reasoning: outside view (base rate), inside view (specifics), then synthesize.
   e. Assign probability with confidence interval (e.g., 72% [65%-80%]).
3. Update predictions from previous runs — track calibration (were past predictions accurate?).
4. Generate new prediction questions based on emerging signals.
5. End with <tool:done>Predictions updated: {count} questions</tool:done>

## Output Format
### Prediction: [Question]
- **Probability:** X% [CI: low%-high%]
- **Time Horizon:** by [date]
- **Key Signals For:** bullet list
- **Key Signals Against:** bullet list
- **Base Rate:** if applicable
- **Reasoning:** 2-3 paragraph analysis
- **Confidence in estimate:** High/Medium/Low
- **Previous estimate:** if updating, show drift and why

### Calibration Tracker
Track resolved predictions: predicted vs actual, Brier score.`,
    skillPath: null,
    lastRun: null,
    runCount: 0,
  },
  {
    id: 'social',
    name: 'Social / Twitter',
    icon: '📱',
    description: 'Content creation with approval queue, engagement tracking',
    schedule: '0 9 * * *',
    model: 'gemini-2.5-pro',
    enabled: false,
    settings: { topics: [], tone: 'professional-casual', formats: ['thread', 'hot-take', 'insight', 'question', 'story'], approvalRequired: true },
    tools: ['web', 'websearch', 'write', 'read'],
    systemPrompt: `You are a social media content strategist and creator. You generate high-quality content for approval.

## Process
1. Read your topic list and tone settings.
2. Research trending conversations in your topic areas via web search.
3. Generate content in rotating formats (cycle through: thread, hot-take, insight, question, story).
4. For each piece of content, provide:
   - The post text (within platform character limits)
   - Suggested posting time (based on engagement patterns)
   - Hashtag suggestions
   - Expected engagement rationale
5. All content goes to an APPROVAL QUEUE — never post directly.
6. Review engagement data from previous posts if available.
7. End with <tool:done>Content batch ready: {count} posts queued for approval</tool:done>

## Content Quality Rules
- No generic motivational fluff
- Every post must have a specific insight, data point, or provocative angle
- Threads: 3-7 tweets, each must stand alone but build a narrative
- Hot takes: contrarian but defensible, cite evidence
- Questions: genuinely engaging, not rhetorical
- Stories: personal or industry anecdotes with clear takeaway

## Output Format
### Post #{n} — [Format]
**Content:**
> [post text]

**Suggested time:** [day] [time] CT
**Hashtags:** #tag1 #tag2
**Rationale:** why this will engage
**Status:** PENDING APPROVAL`,
    skillPath: null,
    lastRun: null,
    runCount: 0,
  },
  {
    id: 'news-monitor',
    name: 'News Monitor',
    icon: '📰',
    description: 'Tracks news sources, summarizes, alerts on important events',
    schedule: '0 */3 * * *',
    model: 'gemini-2.5-pro',
    enabled: false,
    settings: { topics: [], sources: [], alertKeywords: [] },
    tools: ['web', 'websearch', 'write', 'read'],
    systemPrompt: `You are an autonomous news monitoring and intelligence agent.

## Process
1. Read your monitored topics and preferred sources from settings.
2. Search for news from the last few hours on each topic.
3. For each story found:
   a. Summarize in 2-3 sentences.
   b. Rate importance: 🔴 Critical / 🟡 Notable / 🟢 FYI.
   c. Assess reliability of source.
   d. Identify potential impact on monitored interests.
4. Check for alert keywords — flag any matches as URGENT at the top of the report.
5. Deduplicate — don't report the same story from multiple sources, but note coverage breadth.
6. Compare against previous run — only highlight what's NEW.
7. End with <tool:done>News scan complete: {stories} stories, {alerts} alerts</tool:done>

## Output Format
### 🚨 ALERTS (if any)
[urgent items matching alert keywords]

### Top Stories
#### 🔴 [Headline]
**Source:** [name] | **Time:** [when] | **Reliability:** High/Medium/Low
**Summary:** [2-3 sentences]
**Impact:** [why this matters to monitored interests]

### News Digest
[grouped by topic, sorted by importance]

### Coverage Stats
- Topics scanned: X
- Sources checked: X
- New stories found: X
- Alerts triggered: X`,
    skillPath: null,
    lastRun: null,
    runCount: 0,
  },
  {
    id: 'code-auditor',
    name: 'Code Auditor',
    icon: '🔍',
    description: 'Scheduled code review, security scanning, dependency checks',
    schedule: '0 2 * * 0',
    model: 'gemini-2.5-pro',
    enabled: false,
    settings: { projectPaths: ['.'], focusAreas: ['security', 'performance', 'maintainability'] },
    tools: ['shell', 'read', 'write', 'websearch'],
    systemPrompt: `You are an autonomous code auditor. You perform scheduled security and quality reviews.

## Process
1. Read your project paths from settings.
2. For each project:
   a. Use <tool:shell>dir /s /b *.js *.ts *.json</tool:shell> to inventory source files.
   b. Check package.json for outdated or vulnerable dependencies.
   c. Read key source files and analyze for:
      - **Security:** hardcoded secrets, injection risks, unsafe evals, missing input validation, path traversal
      - **Performance:** N+1 queries, memory leaks, blocking operations, missing caching
      - **Maintainability:** dead code, duplicated logic, missing error handling, oversized functions
   d. Check for common misconfigurations (.env exposed, debug mode in prod, permissive CORS).
3. Severity levels: 🔴 Critical (fix now) / 🟠 High / 🟡 Medium / 🟢 Low / ℹ️ Info
4. For each finding, provide the file path, line reference, issue description, and suggested fix.
5. Track findings over time — note what's been fixed and what's new since last audit.
6. End with <tool:done>Audit complete: {files} files reviewed, {findings} findings</tool:done>

## Output Format
### Audit Summary
| Severity | Count |
|----------|-------|
| 🔴 Critical | X |
| 🟠 High | X |
| 🟡 Medium | X |

### Findings
#### 🔴 [CRITICAL] [Short title]
**File:** \`path/to/file.js\`
**Line:** ~N
**Issue:** [description]
**Risk:** [what could go wrong]
**Fix:** [specific recommendation with code example]

### Dependency Report
[outdated packages, known CVEs]

### Recommendations
[prioritized action items]`,
    skillPath: null,
    lastRun: null,
    runCount: 0,
  },
];

// ─── Utility ─────────────────────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadJSON(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { return fallback; }
}

function saveJSON(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

// ─── HandManager ─────────────────────────────────────────────────────

class HandManager extends EventEmitter {
  constructor(opts = {}) {
    super();
    this._ai = opts.ai || null;
    this._hands = new Map();      // id → hand manifest
    this._timers = new Map();     // id → setTimeout handle
    this._running = new Set();    // ids currently executing
    this._state = {};             // persisted run history
    this._cronInterval = null;
    this._init();
  }

  // ── Init ──

  _init() {
    ensureDir(DATA_DIR);
    ensureDir(OUTPUT_DIR);
    this._state = loadJSON(STATE_FILE, { runs: {} });

    // Load built-ins
    for (const def of BUILTIN_HANDS) {
      // Check for user overrides on disk
      const diskPath = path.join(DATA_DIR, `${def.id}.json`);
      if (fs.existsSync(diskPath)) {
        const saved = loadJSON(diskPath, def);
        this._hands.set(saved.id, { ...def, ...saved });
      } else {
        this._hands.set(def.id, { ...def });
      }
    }

    // Load custom hands
    try {
      const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json') && f !== 'state.json');
      for (const f of files) {
        const id = f.replace('.json', '');
        if (!this._hands.has(id)) {
          const data = loadJSON(path.join(DATA_DIR, f), null);
          if (data && data.id) this._hands.set(data.id, data);
        }
      }
    } catch {}

    // Start cron ticker — checks every 30 seconds
    this._startCronTicker();
  }

  _startCronTicker() {
    if (this._cronInterval) return;
    let lastMinute = -1;
    this._cronInterval = setInterval(() => {
      const now = new Date();
      const curMinute = now.getHours() * 60 + now.getMinutes();
      if (curMinute === lastMinute) return; // only fire once per minute
      lastMinute = curMinute;
      this._tickCron(now);
    }, 30000);
    if (this._cronInterval.unref) this._cronInterval.unref();
  }

  _tickCron(now) {
    for (const [id, hand] of this._hands) {
      if (!hand.enabled || !hand.schedule) continue;
      if (this._running.has(id)) continue;
      const cron = parseCron(hand.schedule);
      if (cron && cronMatches(cron, now)) {
        this.run(id).catch(err => {
          this.emit('handError', { handId: id, error: err });
        });
      }
    }
  }

  _persist(hand) {
    saveJSON(path.join(DATA_DIR, `${hand.id}.json`), hand);
  }

  _saveState() {
    saveJSON(STATE_FILE, this._state);
  }

  _getAI() {
    if (this._ai) return this._ai;
    try {
      this._ai = require('./ai');
    } catch (e) {
      throw new Error('AI module not available: ' + e.message);
    }
    return this._ai;
  }

  // ── Public API ──

  /** List all hands with status info. */
  list() {
    const results = [];
    for (const [id, hand] of this._hands) {
      results.push({
        id: hand.id,
        name: hand.name,
        icon: hand.icon,
        description: hand.description,
        enabled: hand.enabled,
        schedule: hand.schedule,
        model: hand.model,
        lastRun: hand.lastRun,
        runCount: hand.runCount || 0,
        running: this._running.has(id),
        nextRun: hand.enabled && hand.schedule ? nextCronTime(hand.schedule) : null,
      });
    }
    return results;
  }

  /** Get detailed status for a single hand. */
  status(handId) {
    const hand = this._hands.get(handId);
    if (!hand) return null;
    const history = (this._state.runs[handId] || []).slice(-20);
    return {
      ...hand,
      running: this._running.has(handId),
      nextRun: hand.enabled && hand.schedule ? nextCronTime(hand.schedule) : null,
      history,
    };
  }

  /** Activate (enable) a hand and start its cron schedule. */
  activate(handId) {
    const hand = this._hands.get(handId);
    if (!hand) throw new Error(`Hand not found: ${handId}`);
    hand.enabled = true;
    this._persist(hand);
    this.emit('handActivated', { handId });
    return { success: true, message: `${hand.icon} ${hand.name} activated` };
  }

  /** Pause a hand without losing state. */
  pause(handId) {
    const hand = this._hands.get(handId);
    if (!hand) throw new Error(`Hand not found: ${handId}`);
    hand.enabled = false;
    this._persist(hand);
    this.emit('handPaused', { handId });
    return { success: true, message: `${hand.icon} ${hand.name} paused` };
  }

  /** Run a hand immediately. Returns the output text. */
  async run(handId) {
    const hand = this._hands.get(handId);
    if (!hand) throw new Error(`Hand not found: ${handId}`);
    if (this._running.has(handId)) throw new Error(`Hand ${handId} is already running`);

    this._running.add(handId);
    const startTime = Date.now();
    this.emit('handStart', { handId, hand: hand.name, startTime });

    try {
      const output = await this._executeHand(hand);

      // Save output
      const outDir = path.join(OUTPUT_DIR, handId);
      ensureDir(outDir);
      const outFile = path.join(outDir, `${timestamp()}.md`);
      const header = `# ${hand.icon} ${hand.name} — Run Report\n**Date:** ${new Date().toISOString()}\n**Model:** ${hand.model}\n**Duration:** ${((Date.now() - startTime) / 1000).toFixed(1)}s\n\n---\n\n`;
      fs.writeFileSync(outFile, header + output, 'utf-8');

      // Update state
      hand.lastRun = new Date().toISOString();
      hand.runCount = (hand.runCount || 0) + 1;
      this._persist(hand);

      if (!this._state.runs[handId]) this._state.runs[handId] = [];
      this._state.runs[handId].push({
        timestamp: hand.lastRun,
        duration: Date.now() - startTime,
        outputFile: outFile,
        success: true,
        outputLength: output.length,
      });
      // Keep last 100 runs per hand
      if (this._state.runs[handId].length > 100) {
        this._state.runs[handId] = this._state.runs[handId].slice(-100);
      }
      this._saveState();

      this._running.delete(handId);
      this.emit('handComplete', { handId, hand: hand.name, duration: Date.now() - startTime, outputFile: outFile });
      return output;
    } catch (err) {
      this._running.delete(handId);

      if (!this._state.runs[handId]) this._state.runs[handId] = [];
      this._state.runs[handId].push({
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
        success: false,
        error: err.message,
      });
      this._saveState();

      this.emit('handError', { handId, hand: hand.name, error: err });
      throw err;
    }
  }

  /** Create a custom hand. */
  create(definition) {
    if (!definition.id) throw new Error('Hand definition must have an id');
    if (this._hands.has(definition.id)) throw new Error(`Hand already exists: ${definition.id}`);

    const hand = {
      id: definition.id,
      name: definition.name || definition.id,
      icon: definition.icon || '🤖',
      description: definition.description || '',
      schedule: definition.schedule || null,
      model: definition.model || 'gemini-2.5-pro',
      enabled: false,
      settings: definition.settings || {},
      tools: definition.tools || ['web', 'websearch', 'write', 'read'],
      systemPrompt: definition.systemPrompt || 'You are an autonomous agent. Complete your task and use <tool:done>summary</tool:done> when finished.',
      skillPath: definition.skillPath || null,
      lastRun: null,
      runCount: 0,
    };

    this._hands.set(hand.id, hand);
    this._persist(hand);
    return { success: true, hand };
  }

  /** Remove a custom hand. Built-ins are reset to defaults instead. */
  remove(handId) {
    const hand = this._hands.get(handId);
    if (!hand) throw new Error(`Hand not found: ${handId}`);

    const isBuiltin = BUILTIN_HANDS.some(b => b.id === handId);
    if (isBuiltin) {
      // Reset to defaults
      const def = BUILTIN_HANDS.find(b => b.id === handId);
      this._hands.set(handId, { ...def });
      this._persist(this._hands.get(handId));
      return { success: true, message: `Built-in hand ${handId} reset to defaults` };
    }

    this._hands.delete(handId);
    const diskPath = path.join(DATA_DIR, `${handId}.json`);
    try { fs.unlinkSync(diskPath); } catch {}
    return { success: true, message: `Hand ${handId} removed` };
  }

  /** Get recent outputs for a hand. */
  getOutput(handId, limit = 5) {
    const outDir = path.join(OUTPUT_DIR, handId);
    if (!fs.existsSync(outDir)) return [];

    const files = fs.readdirSync(outDir)
      .filter(f => f.endsWith('.md'))
      .sort()
      .reverse()
      .slice(0, limit);

    return files.map(f => {
      const filePath = path.join(outDir, f);
      const stat = fs.statSync(filePath);
      return {
        file: f,
        path: filePath,
        size: stat.size,
        created: stat.mtime.toISOString(),
        // Preview: first 500 chars
        preview: fs.readFileSync(filePath, 'utf-8').slice(0, 500),
      };
    });
  }

  /** Stop the cron ticker and clean up. */
  destroy() {
    if (this._cronInterval) {
      clearInterval(this._cronInterval);
      this._cronInterval = null;
    }
    for (const [, timer] of this._timers) clearTimeout(timer);
    this._timers.clear();
  }

  // ── Internal Execution ──

  async _executeHand(hand) {
    const ai = this._getAI();
    const { callWithFallback, parseTools } = ai;

    // Build messages
    const settingsBlock = Object.keys(hand.settings).length > 0
      ? `\n\n## Current Settings\n\`\`\`json\n${JSON.stringify(hand.settings, null, 2)}\n\`\`\``
      : '';

    // Include last run summary if available
    let contextBlock = '';
    const prevOutputs = this.getOutput(hand.id, 1);
    if (prevOutputs.length > 0) {
      const prev = fs.readFileSync(prevOutputs[0].path, 'utf-8');
      // Truncate to keep context manageable
      const truncated = prev.length > 4000 ? prev.slice(0, 4000) + '\n\n[...truncated...]' : prev;
      contextBlock = `\n\n## Previous Run Output (for reference)\n${truncated}`;
    }

    const outputDir = path.join(OUTPUT_DIR, hand.id);
    const systemPrompt = hand.systemPrompt
      + settingsBlock
      + contextBlock
      + `\n\n## Output Directory\nSave your output to: ${outputDir.replace(/\\/g, '/')}/`
      + `\n\n## Current Time\n${new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })} CT`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Execute your autonomous task now. Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.` },
    ];

    // Agent loop — up to 15 iterations of tool use
    const MAX_ITERATIONS = 15;
    let fullOutput = '';

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      let response;
      try {
        const data = await callWithFallback(messages, hand.model);
        response = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content)
          || (data.content && data.content[0] && data.content[0].text)
          || '';
      } catch (err) {
        fullOutput += `\n\n[AI call failed at iteration ${i + 1}: ${err.message}]`;
        break;
      }

      if (!response) break;
      fullOutput += response + '\n';
      messages.push({ role: 'assistant', content: response });

      // Parse tool calls
      const toolCalls = parseTools(response);

      // Check for done signal
      const doneCall = toolCalls.find(t => t.tool === 'done');
      if (doneCall) break;

      // Filter to allowed tools
      const allowedCalls = toolCalls.filter(t => {
        if (!hand.tools || hand.tools.length === 0) return true;
        return hand.tools.includes(t.tool);
      });

      if (allowedCalls.length === 0) break; // No tools to execute, we're done

      // Execute tools
      const results = [];
      for (const call of allowedCalls) {
        try {
          const tools = require('./tools');
          const result = await tools.execute(call.tool, call.args, { workDir: path.join(__dirname, '..') });
          results.push(`[${call.tool}] ${typeof result === 'string' ? result : JSON.stringify(result)}`);
        } catch (err) {
          results.push(`[${call.tool}] Error: ${err.message}`);
        }
      }

      messages.push({ role: 'user', content: `Tool results:\n${results.join('\n\n')}` });
    }

    return fullOutput;
  }
}

// ─── Singleton ───────────────────────────────────────────────────────

let _instance = null;

function getInstance(opts = {}) {
  if (!_instance) _instance = new HandManager(opts);
  return _instance;
}

module.exports = { HandManager, getInstance };
