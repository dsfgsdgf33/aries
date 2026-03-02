/**
 * ARIES — Failure Archaeology
 * Re-analyzing old mistakes with current intelligence.
 * Pattern mining across failures, root cause templates, failure chains, lessons extraction.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const DATA_DIR = path.join(__dirname, '..', 'data', 'learnings');
const CATALOG_FILE = path.join(DATA_DIR, 'failure-catalog.json');
const DISCOVERIES_FILE = path.join(DATA_DIR, 'discoveries.json');
const PATTERNS_FILE = path.join(DATA_DIR, 'patterns.json');
const CHAINS_FILE = path.join(DATA_DIR, 'failure-chains.json');
const LESSONS_FILE = path.join(DATA_DIR, 'lessons.json');
const TEMPLATES_FILE = path.join(DATA_DIR, 'root-cause-templates.json');
const SCHEDULE_FILE = path.join(DATA_DIR, 'dig-schedule.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

// ── Root Cause Templates ──
const DEFAULT_ROOT_CAUSE_TEMPLATES = [
  { id: 'assumption-violation', name: 'Assumption Violation', description: 'An unstated assumption turned out to be false', signals: ['unexpected', 'assumed', 'should have'] },
  { id: 'cascading-dependency', name: 'Cascading Dependency', description: 'Failure in one component propagated through dependencies', signals: ['downstream', 'triggered', 'chain'] },
  { id: 'incomplete-model', name: 'Incomplete Mental Model', description: 'The mental model of the system was missing critical aspects', signals: ['didn\'t consider', 'overlooked', 'forgot'] },
  { id: 'premature-optimization', name: 'Premature Optimization', description: 'Optimized before understanding the real problem', signals: ['too early', 'wrong thing', 'premature'] },
  { id: 'communication-gap', name: 'Communication Gap', description: 'Failure due to misunderstanding between components or humans', signals: ['misunderstood', 'miscommunication', 'ambiguous'] },
  { id: 'edge-case-blind', name: 'Edge Case Blindness', description: 'Failed to anticipate an edge case or boundary condition', signals: ['edge case', 'boundary', 'corner case', 'unexpected input'] },
  { id: 'temporal-coupling', name: 'Temporal Coupling', description: 'Failure due to timing, ordering, or race conditions', signals: ['race', 'timing', 'order', 'before', 'after'] },
  { id: 'overconfidence', name: 'Overconfidence Bias', description: 'Proceeded with too much certainty, skipped validation', signals: ['confident', 'obvious', 'clearly', 'skip'] },
  { id: 'complexity-debt', name: 'Complexity Debt', description: 'Accumulated complexity made the failure inevitable', signals: ['complex', 'tangled', 'hard to understand'] },
  { id: 'context-loss', name: 'Context Loss', description: 'Critical context was lost between stages or sessions', signals: ['forgot', 'lost track', 'context', 'session'] },
];

class FailureArchaeology extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null;
    this.config = opts.config || {};
    this.digsPerTick = this.config.digsPerTick || 1;
    this.maxCatalog = this.config.maxCatalog || 500;
    this.maxLessons = this.config.maxLessons || 200;
    ensureDir();
    this._ensureTemplates();
  }

  // ── Persistence helpers ──

  _getCatalog() { return readJSON(CATALOG_FILE, { failures: [] }); }
  _saveCatalog(data) { writeJSON(CATALOG_FILE, data); }
  _getDiscoveries() { return readJSON(DISCOVERIES_FILE, { discoveries: [] }); }
  _saveDiscoveries(data) { writeJSON(DISCOVERIES_FILE, data); }
  _getPatterns() { return readJSON(PATTERNS_FILE, { patterns: [], lastAnalysis: null }); }
  _savePatterns(data) { writeJSON(PATTERNS_FILE, data); }
  _getChains() { return readJSON(CHAINS_FILE, { chains: [] }); }
  _saveChains(data) { writeJSON(CHAINS_FILE, data); }
  _getLessons() { return readJSON(LESSONS_FILE, { lessons: [], lastExtraction: null }); }
  _saveLessons(data) { writeJSON(LESSONS_FILE, data); }
  _getTemplates() { return readJSON(TEMPLATES_FILE, { templates: DEFAULT_ROOT_CAUSE_TEMPLATES, custom: [] }); }
  _saveTemplates(data) { writeJSON(TEMPLATES_FILE, data); }
  _getSchedule() { return readJSON(SCHEDULE_FILE, { queue: [], lastRun: null, priorities: {} }); }
  _saveSchedule(data) { writeJSON(SCHEDULE_FILE, data); }

  _ensureTemplates() {
    const t = this._getTemplates();
    if (!t.templates || t.templates.length === 0) {
      t.templates = DEFAULT_ROOT_CAUSE_TEMPLATES;
      this._saveTemplates(t);
    }
  }

  // ── Core: Catalog a failure ──

  catalogFailure(description, context = {}, originalAnalysis = '') {
    const catalog = this._getCatalog();

    const failure = {
      id: uuid(),
      description: (description || '').substring(0, 2000),
      context,
      originalAnalysis: (originalAnalysis || '').substring(0, 2000),
      timestamp: Date.now(),
      catalogedAt: new Date().toISOString(),
      impact: context.impact || 'unknown',
      tags: context.tags || [],
      digCount: 0,
      lastDigAt: null,
      discoveries: [],
      currentLesson: originalAnalysis || '',
      rootCauseTemplateId: null,
      chainIds: [],
      lessonIds: [],
      priority: this._computePriority(context),
      epoch: this._currentEpoch(),
    };

    // Auto-match root cause template
    failure.rootCauseTemplateId = this._matchTemplate(description + ' ' + originalAnalysis);

    catalog.failures.push(failure);
    if (catalog.failures.length > this.maxCatalog) {
      catalog.failures = catalog.failures.slice(-this.maxCatalog);
    }

    this._saveCatalog(catalog);
    this._updateSchedule(failure);
    this.emit('failure-cataloged', failure);
    return failure;
  }

  /**
   * AI re-analyzes an old failure with current intelligence.
   */
  async dig(failureId) {
    if (!this.ai) return null;

    const catalog = this._getCatalog();
    const failure = catalog.failures.find(f => f.id === failureId);
    if (!failure) return null;

    const templates = this._getTemplates();
    const matchedTemplate = templates.templates.find(t => t.id === failure.rootCauseTemplateId);
    const lessons = this._getLessons();
    const relatedLessons = lessons.lessons.filter(l => l.failureIds && l.failureIds.includes(failureId));

    const prompt = `You are re-analyzing an old failure with fresh eyes and current intelligence.

FAILURE: ${failure.description}
CONTEXT: ${JSON.stringify(failure.context, null, 2)}
ORIGINAL ANALYSIS: ${failure.originalAnalysis}
TIMES PREVIOUSLY RE-EXAMINED: ${failure.digCount}
${failure.discoveries.length > 0 ? `PREVIOUS DISCOVERIES:\n${failure.discoveries.map(d => '- ' + d).join('\n')}` : ''}
${matchedTemplate ? `MATCHED ROOT CAUSE TEMPLATE: ${matchedTemplate.name} — ${matchedTemplate.description}` : ''}
${relatedLessons.length > 0 ? `RELATED LESSONS:\n${relatedLessons.map(l => '- ' + l.text).join('\n')}` : ''}

Instructions:
1. Re-analyze with fresh perspective — what did the original analysis miss?
2. Look for root causes, systemic factors, hidden assumptions
3. Consider if this failure connects to other failure patterns (chain effects)
4. Extract a concrete, reusable lesson
5. Rate the severity with fresh eyes

Respond in JSON:
{
  "hasNewInsight": true/false,
  "newInsight": "...",
  "updatedLesson": "...",
  "confidence": 0.0-1.0,
  "rootCauses": ["..."],
  "hiddenFactors": ["..."],
  "suggestedRootCauseTemplate": "template-id or null",
  "chainConnections": ["descriptions of related failure patterns"],
  "extractedLesson": { "text": "concise reusable lesson", "domain": "general|technical|process|communication", "applicability": "narrow|moderate|broad" },
  "revisedSeverity": "low|medium|high|critical"
}`;

    try {
      const response = await this.ai.chat([{ role: 'user', content: prompt }], {
        model: this.config.model,
        temperature: 0.7,
      });

      const text = typeof response === 'string' ? response : (response.content || response.text || '');
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const result = JSON.parse(jsonMatch[0]);

      failure.digCount++;
      failure.lastDigAt = Date.now();

      if (result.suggestedRootCauseTemplate) {
        failure.rootCauseTemplateId = result.suggestedRootCauseTemplate;
      }
      if (result.revisedSeverity) {
        failure.impact = result.revisedSeverity;
      }

      // Extract lesson
      if (result.extractedLesson && result.extractedLesson.text) {
        const lesson = this._addLesson(result.extractedLesson.text, result.extractedLesson.domain || 'general', result.extractedLesson.applicability || 'moderate', [failureId]);
        failure.lessonIds.push(lesson.id);
      }

      // Detect chain connections
      if (result.chainConnections && result.chainConnections.length > 0) {
        this._detectChains(failure, result.chainConnections);
      }

      if (result.hasNewInsight && result.newInsight) {
        failure.discoveries.push(result.newInsight);
        failure.currentLesson = result.updatedLesson || failure.currentLesson;

        const discovery = {
          id: uuid(),
          failureId,
          insight: result.newInsight,
          updatedLesson: result.updatedLesson || '',
          confidence: result.confidence || 0.5,
          rootCauses: result.rootCauses || [],
          hiddenFactors: result.hiddenFactors || [],
          discoveredAt: Date.now(),
          digNumber: failure.digCount,
          chainConnections: result.chainConnections || [],
        };

        const discoveries = this._getDiscoveries();
        discoveries.discoveries.push(discovery);
        if (discoveries.discoveries.length > 1000) {
          discoveries.discoveries = discoveries.discoveries.slice(-1000);
        }
        this._saveDiscoveries(discoveries);
        this._saveCatalog(catalog);
        this.emit('discovery', discovery);
        return discovery;
      }

      this._saveCatalog(catalog);
      return null;
    } catch (e) {
      console.error('[FAILURE-ARCHAEOLOGY] Dig error:', e.message);
      return null;
    }
  }

  /**
   * Cross-failure pattern mining using AI.
   */
  async discoverPatterns() {
    if (!this.ai) return null;

    const catalog = this._getCatalog();
    if (catalog.failures.length < 3) return null;

    const sorted = [...catalog.failures].sort((a, b) => {
      const impactOrder = { critical: 4, high: 3, medium: 2, low: 1, unknown: 0 };
      return (impactOrder[b.impact] || 0) - (impactOrder[a.impact] || 0);
    });
    const sample = sorted.slice(0, 25);

    const summaries = sample.map((f, i) =>
      `${i + 1}. [${f.catalogedAt}] ${f.description.substring(0, 200)}\n   Original: ${(f.originalAnalysis || 'none').substring(0, 150)}\n   Tags: ${(f.tags || []).join(', ') || 'none'}\n   Template: ${f.rootCauseTemplateId || 'none'}\n   Digs: ${f.digCount}, Discoveries: ${f.discoveries.length}`
    ).join('\n\n');

    const chains = this._getChains();
    const chainSummary = chains.chains.slice(-5).map(c => `Chain: ${c.failures.map(f => f.substring(0, 40)).join(' → ')}`).join('\n');

    const prompt = `Analyze these failures for cross-cutting patterns, recurring themes, and systemic root causes.

FAILURES:
${summaries}

${chainSummary ? `KNOWN FAILURE CHAINS:\n${chainSummary}` : ''}

Look for:
1. Recurring failure modes (same mistake, different contexts)
2. Common root causes across unrelated failures
3. Temporal patterns (clusters, escalation sequences)
4. Systemic issues that multiple failures point to
5. Blind spots — types of failures that keep surprising
6. Evolution patterns — are failures getting more or less sophisticated?
7. Failure archetypes — can you name recurring failure "characters"?

Respond in JSON:
{
  "patterns": [
    { "name": "...", "description": "...", "failureIndices": [1,2,3], "severity": "low/medium/high", "frequency": "rare/occasional/frequent", "archetype": "optional archetype name" }
  ],
  "systemicIssues": ["..."],
  "blindSpots": ["..."],
  "evolutionTrend": "improving|stable|degrading",
  "failureArchetypes": [{ "name": "...", "description": "...", "frequency": 0.0-1.0 }],
  "recommendations": ["actionable recommendations"]
}`;

    try {
      const response = await this.ai.chat([{ role: 'user', content: prompt }], {
        model: this.config.model,
        temperature: 0.6,
      });

      const text = typeof response === 'string' ? response : (response.content || response.text || '');
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const result = JSON.parse(jsonMatch[0]);
      const patternData = this._getPatterns();
      patternData.patterns = result.patterns || [];
      patternData.systemicIssues = result.systemicIssues || [];
      patternData.blindSpots = result.blindSpots || [];
      patternData.evolutionTrend = result.evolutionTrend || 'stable';
      patternData.failureArchetypes = result.failureArchetypes || [];
      patternData.recommendations = result.recommendations || [];
      patternData.lastAnalysis = Date.now();
      patternData.failureCount = catalog.failures.length;
      this._savePatterns(patternData);

      this.emit('patterns-discovered', result);
      return result;
    } catch (e) {
      console.error('[FAILURE-ARCHAEOLOGY] Pattern discovery error:', e.message);
      return null;
    }
  }

  // ── Failure Chains ──

  /**
   * Detect and record chain relationships between failures.
   */
  _detectChains(failure, chainDescriptions) {
    const catalog = this._getCatalog();
    const chains = this._getChains();

    for (const desc of chainDescriptions) {
      const descLower = desc.toLowerCase();
      // Find potential linked failures by keyword match
      const linked = catalog.failures.filter(f =>
        f.id !== failure.id &&
        (f.description.toLowerCase().includes(descLower.substring(0, 30)) ||
         descLower.includes(f.description.substring(0, 30).toLowerCase()))
      );

      if (linked.length > 0) {
        const chain = {
          id: uuid(),
          failures: [failure.description.substring(0, 100), ...linked.map(l => l.description.substring(0, 100))],
          failureIds: [failure.id, ...linked.map(l => l.id)],
          description: desc,
          detectedAt: Date.now(),
          strength: linked.length,
        };
        chains.chains.push(chain);
        failure.chainIds.push(chain.id);

        for (const l of linked) {
          if (!l.chainIds) l.chainIds = [];
          l.chainIds.push(chain.id);
        }
      }
    }

    if (chains.chains.length > 200) chains.chains = chains.chains.slice(-200);
    this._saveChains(chains);
  }

  /**
   * Get failure chains — sequences of causally connected failures.
   */
  getChains(opts = {}) {
    const chains = this._getChains();
    let result = chains.chains;
    if (opts.minStrength) result = result.filter(c => c.strength >= opts.minStrength);
    if (opts.limit) result = result.slice(-opts.limit);
    return result;
  }

  /**
   * Manually link two failures as a chain.
   */
  linkFailures(failureId1, failureId2, description = '') {
    const catalog = this._getCatalog();
    const f1 = catalog.failures.find(f => f.id === failureId1);
    const f2 = catalog.failures.find(f => f.id === failureId2);
    if (!f1 || !f2) return null;

    const chains = this._getChains();
    const chain = {
      id: uuid(),
      failures: [f1.description.substring(0, 100), f2.description.substring(0, 100)],
      failureIds: [failureId1, failureId2],
      description: description || `Manual link: ${f1.description.substring(0, 50)} → ${f2.description.substring(0, 50)}`,
      detectedAt: Date.now(),
      strength: 1,
      manual: true,
    };
    chains.chains.push(chain);
    this._saveChains(chains);

    if (!f1.chainIds) f1.chainIds = [];
    if (!f2.chainIds) f2.chainIds = [];
    f1.chainIds.push(chain.id);
    f2.chainIds.push(chain.id);
    this._saveCatalog(catalog);

    this.emit('chain-linked', chain);
    return chain;
  }

  // ── Lessons Extraction ──

  /**
   * Add a lesson learned.
   */
  _addLesson(text, domain, applicability, failureIds = []) {
    const lessons = this._getLessons();

    // Deduplicate
    const existing = lessons.lessons.find(l => this._similarity(l.text, text) > 0.6);
    if (existing) {
      existing.reinforcementCount = (existing.reinforcementCount || 1) + 1;
      existing.lastReinforced = Date.now();
      existing.failureIds = [...new Set([...(existing.failureIds || []), ...failureIds])];
      this._saveLessons(lessons);
      return existing;
    }

    const lesson = {
      id: uuid(),
      text,
      domain: domain || 'general',
      applicability: applicability || 'moderate',
      failureIds,
      reinforcementCount: 1,
      createdAt: Date.now(),
      lastReinforced: Date.now(),
      applied: false,
      appliedCount: 0,
    };

    lessons.lessons.push(lesson);
    if (lessons.lessons.length > this.maxLessons) {
      // Keep most reinforced
      lessons.lessons.sort((a, b) => (b.reinforcementCount || 1) - (a.reinforcementCount || 1));
      lessons.lessons = lessons.lessons.slice(0, this.maxLessons);
    }
    lessons.lastExtraction = Date.now();
    this._saveLessons(lessons);
    this.emit('lesson-extracted', lesson);
    return lesson;
  }

  /**
   * Bulk extract lessons from all unprocessed failures.
   */
  async extractLessons() {
    if (!this.ai) return { lessons: [], message: 'AI required' };

    const catalog = this._getCatalog();
    const existing = this._getLessons();
    const processed = new Set(existing.lessons.flatMap(l => l.failureIds || []));
    const unprocessed = catalog.failures.filter(f => !processed.has(f.id) && f.digCount > 0);

    if (unprocessed.length === 0) return { lessons: [], message: 'No new failures to process' };

    const batch = unprocessed.slice(0, 15);
    const summaries = batch.map((f, i) =>
      `${i + 1}. ${f.description.substring(0, 200)}\n   Lesson so far: ${f.currentLesson || 'none'}\n   Discoveries: ${f.discoveries.join('; ') || 'none'}`
    ).join('\n\n');

    const existingLessons = existing.lessons.slice(0, 20).map(l => `- ${l.text}`).join('\n');

    const prompt = `Extract reusable lessons from these analyzed failures. Each lesson should be:
- Concise (1-2 sentences)
- Actionable (tells you what to do differently)
- General enough to apply beyond the specific failure

Failures:
${summaries}

Existing lessons (don't duplicate):
${existingLessons || '(none yet)'}

Respond in JSON:
{
  "lessons": [
    { "text": "...", "domain": "general|technical|process|communication", "applicability": "narrow|moderate|broad", "fromFailures": [1,2] }
  ]
}`;

    try {
      const response = await this.ai.chat([{ role: 'user', content: prompt }], {
        model: this.config.model,
        temperature: 0.5,
      });
      const text = typeof response === 'string' ? response : (response.content || response.text || '');
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return { lessons: [], message: 'Parse failed' };

      const result = JSON.parse(jsonMatch[0]);
      const added = [];
      for (const l of (result.lessons || [])) {
        const failureIds = (l.fromFailures || []).map(i => batch[i - 1]?.id).filter(Boolean);
        const lesson = this._addLesson(l.text, l.domain, l.applicability, failureIds);
        added.push(lesson);
      }
      return { lessons: added, count: added.length };
    } catch (e) {
      console.error('[FAILURE-ARCHAEOLOGY] Lesson extraction error:', e.message);
      return { lessons: [], message: e.message };
    }
  }

  /**
   * Get all extracted lessons.
   */
  getLessons(opts = {}) {
    const lessons = this._getLessons();
    let result = lessons.lessons;
    if (opts.domain) result = result.filter(l => l.domain === opts.domain);
    if (opts.applicability) result = result.filter(l => l.applicability === opts.applicability);
    result.sort((a, b) => (b.reinforcementCount || 1) - (a.reinforcementCount || 1));
    if (opts.limit) result = result.slice(0, opts.limit);
    return result;
  }

  /**
   * Mark a lesson as applied.
   */
  applyLesson(lessonId) {
    const lessons = this._getLessons();
    const lesson = lessons.lessons.find(l => l.id === lessonId);
    if (!lesson) return null;
    lesson.applied = true;
    lesson.appliedCount = (lesson.appliedCount || 0) + 1;
    lesson.lastApplied = Date.now();
    this._saveLessons(lessons);
    this.emit('lesson-applied', lesson);
    return lesson;
  }

  // ── Root Cause Templates ──

  /**
   * Match a description to the best root cause template.
   */
  _matchTemplate(text) {
    if (!text) return null;
    const templates = this._getTemplates();
    const lower = text.toLowerCase();
    let bestMatch = null;
    let bestScore = 0;

    for (const t of [...templates.templates, ...(templates.custom || [])]) {
      let score = 0;
      for (const signal of (t.signals || [])) {
        if (lower.includes(signal.toLowerCase())) score++;
      }
      if (score > bestScore) {
        bestScore = score;
        bestMatch = t.id;
      }
    }
    return bestScore > 0 ? bestMatch : null;
  }

  /**
   * Get all root cause templates.
   */
  getTemplates() {
    const t = this._getTemplates();
    return [...t.templates, ...(t.custom || [])];
  }

  /**
   * Add a custom root cause template.
   */
  addTemplate(name, description, signals = []) {
    const t = this._getTemplates();
    if (!t.custom) t.custom = [];
    const template = { id: `custom-${uuid().substring(0, 8)}`, name, description, signals, custom: true, createdAt: Date.now() };
    t.custom.push(template);
    this._saveTemplates(t);
    this.emit('template-added', template);
    return template;
  }

  /**
   * Get failures grouped by root cause template.
   */
  getByTemplate() {
    const catalog = this._getCatalog();
    const templates = this.getTemplates();
    const groups = {};
    for (const t of templates) {
      groups[t.id] = { template: t, failures: [] };
    }
    groups['unmatched'] = { template: { id: 'unmatched', name: 'Unmatched' }, failures: [] };

    for (const f of catalog.failures) {
      const key = f.rootCauseTemplateId || 'unmatched';
      if (!groups[key]) groups[key] = { template: { id: key, name: key }, failures: [] };
      groups[key].failures.push({ id: f.id, description: f.description.substring(0, 100), impact: f.impact, timestamp: f.timestamp });
    }

    return Object.values(groups).filter(g => g.failures.length > 0).sort((a, b) => b.failures.length - a.failures.length);
  }

  // ── Prioritized Dig Scheduling ──

  _computePriority(context) {
    const impactScores = { critical: 100, high: 70, medium: 40, low: 10, unknown: 20 };
    let score = impactScores[context.impact || 'unknown'] || 20;
    if (context.recurring) score += 30;
    if (context.recentlyRepeated) score += 50;
    if (context.userFlagged) score += 40;
    return score;
  }

  _updateSchedule(failure) {
    const schedule = this._getSchedule();
    schedule.queue.push({
      failureId: failure.id,
      priority: failure.priority || 20,
      addedAt: Date.now(),
      scheduledFor: null,
      completed: false,
    });
    // Sort by priority descending
    schedule.queue.sort((a, b) => b.priority - a.priority);
    if (schedule.queue.length > 200) schedule.queue = schedule.queue.slice(0, 200);
    this._saveSchedule(schedule);
  }

  /**
   * Get prioritized dig schedule.
   */
  getDigSchedule(n = 5) {
    const catalog = this._getCatalog();
    const impactOrder = { critical: 4, high: 3, medium: 2, low: 1, unknown: 0 };

    const scored = catalog.failures.map(f => {
      let score = f.priority || 0;
      if (f.digCount === 0) score += 100;
      score += (impactOrder[f.impact] || 0) * 10;
      if (f.lastDigAt) {
        const daysSinceDig = (Date.now() - f.lastDigAt) / 86400000;
        score += Math.min(daysSinceDig, 30);
      } else {
        const age = (Date.now() - f.timestamp) / 86400000;
        score += Math.min(age, 50);
      }
      // Bonus for failures in chains
      if (f.chainIds && f.chainIds.length > 0) score += 15 * f.chainIds.length;
      // Bonus for failures without lessons
      if (!f.lessonIds || f.lessonIds.length === 0) score += 10;
      return { ...f, _score: score };
    });

    return scored
      .sort((a, b) => b._score - a._score)
      .slice(0, n)
      .map(f => { const { _score, ...rest } = f; return rest; });
  }

  /**
   * Reprioritize a failure manually.
   */
  reprioritize(failureId, priority) {
    const catalog = this._getCatalog();
    const f = catalog.failures.find(x => x.id === failureId);
    if (!f) return null;
    f.priority = priority;
    this._saveCatalog(catalog);
    return f;
  }

  // ── Query Methods ──

  getDiscoveries() {
    return this._getDiscoveries().discoveries.sort((a, b) => b.discoveredAt - a.discoveredAt);
  }

  getCatalog(opts = {}) {
    const catalog = this._getCatalog();
    let failures = catalog.failures;
    if (opts.impact) failures = failures.filter(f => f.impact === opts.impact);
    if (opts.tag) failures = failures.filter(f => (f.tags || []).includes(opts.tag));
    if (opts.templateId) failures = failures.filter(f => f.rootCauseTemplateId === opts.templateId);
    if (opts.hasChain) failures = failures.filter(f => f.chainIds && f.chainIds.length > 0);
    if (opts.neverDug) failures = failures.filter(f => f.digCount === 0);
    if (opts.limit) failures = failures.slice(-opts.limit);
    return failures;
  }

  getPatterns() {
    return this._getPatterns();
  }

  /**
   * Search failures by keyword.
   */
  search(query) {
    if (!query) return [];
    const catalog = this._getCatalog();
    const lower = query.toLowerCase();
    const words = lower.split(/\s+/).filter(w => w.length > 2);

    return catalog.failures
      .map(f => {
        let score = 0;
        const text = `${f.description} ${f.originalAnalysis} ${(f.tags || []).join(' ')} ${f.currentLesson}`.toLowerCase();
        for (const w of words) {
          if (text.includes(w)) score += 1;
          if (f.description.toLowerCase().includes(w)) score += 2;
        }
        return { ...f, _score: score };
      })
      .filter(f => f._score > 0)
      .sort((a, b) => b._score - a._score)
      .slice(0, 20)
      .map(f => { const { _score, ...rest } = f; return rest; });
  }

  _currentEpoch() {
    const d = new Date();
    return `${d.getFullYear()}-Q${Math.ceil((d.getMonth() + 1) / 3)}`;
  }

  _similarity(a, b) {
    const wordsA = new Set((a || '').toLowerCase().split(/\W+/).filter(w => w.length > 3));
    const wordsB = new Set((b || '').toLowerCase().split(/\W+/).filter(w => w.length > 3));
    if (wordsA.size === 0 || wordsB.size === 0) return 0;
    let overlap = 0;
    for (const w of wordsA) if (wordsB.has(w)) overlap++;
    return overlap / Math.max(wordsA.size, wordsB.size);
  }

  /**
   * Get epoch-level failure analysis.
   */
  getEpochAnalysis() {
    const catalog = this._getCatalog();
    const epochs = {};
    for (const f of catalog.failures) {
      const epoch = f.epoch || 'unknown';
      if (!epochs[epoch]) epochs[epoch] = { count: 0, impacts: {}, templates: {}, discoveries: 0 };
      epochs[epoch].count++;
      epochs[epoch].impacts[f.impact] = (epochs[epoch].impacts[f.impact] || 0) + 1;
      if (f.rootCauseTemplateId) epochs[epoch].templates[f.rootCauseTemplateId] = (epochs[epoch].templates[f.rootCauseTemplateId] || 0) + 1;
      epochs[epoch].discoveries += f.discoveries.length;
    }
    return epochs;
  }

  /**
   * Periodic tick — performs scheduled digs + pattern mining + lesson extraction.
   */
  async tick() {
    const schedule = this.getDigSchedule(this.digsPerTick);
    const discoveries = [];

    for (const failure of schedule) {
      const discovery = await this.dig(failure.id);
      if (discovery) discoveries.push(discovery);
    }

    // Periodically mine patterns (every 10 digs)
    const catalog = this._getCatalog();
    const totalDigs = catalog.failures.reduce((s, f) => s + f.digCount, 0);
    let patternResult = null;
    if (totalDigs > 0 && totalDigs % 10 === 0) {
      patternResult = await this.discoverPatterns();
    }

    // Periodically extract lessons
    let lessonResult = null;
    const lessons = this._getLessons();
    if (!lessons.lastExtraction || Date.now() - lessons.lastExtraction > 3600000) {
      lessonResult = await this.extractLessons();
    }

    if (discoveries.length > 0) {
      this.emit('tick-discoveries', discoveries);
    }

    return { discoveries, patterns: patternResult, lessons: lessonResult };
  }

  /** Get summary stats */
  getStats() {
    const catalog = this._getCatalog();
    const discoveries = this._getDiscoveries();
    const patterns = this._getPatterns();
    const chains = this._getChains();
    const lessons = this._getLessons();
    const neverDug = catalog.failures.filter(f => f.digCount === 0).length;
    const templates = this.getTemplates();

    return {
      totalFailures: catalog.failures.length,
      totalDiscoveries: discoveries.discoveries.length,
      totalPatterns: (patterns.patterns || []).length,
      totalChains: chains.chains.length,
      totalLessons: lessons.lessons.length,
      totalTemplates: templates.length,
      neverExamined: neverDug,
      lastPatternAnalysis: patterns.lastAnalysis,
      lastLessonExtraction: lessons.lastExtraction,
      evolutionTrend: patterns.evolutionTrend || 'unknown',
      blindSpots: patterns.blindSpots || [],
      topLessons: lessons.lessons.sort((a, b) => (b.reinforcementCount || 1) - (a.reinforcementCount || 1)).slice(0, 5).map(l => l.text),
      epochAnalysis: this.getEpochAnalysis(),
    };
  }
}

module.exports = FailureArchaeology;
