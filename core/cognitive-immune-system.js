/**
 * ARIES — Cognitive Immune System
 * Antibodies against bad reasoning patterns. Detects, quarantines, and evolves
 * defenses against logical fallacies, cognitive biases, hallucinations, and
 * other reasoning pathogens.
 *
 * Full potential:
 * - 18+ pre-seeded pathogens (logical fallacies, cognitive biases, hallucination patterns)
 * - Regex antibodies with adaptive evolution (failed antibodies get mutated)
 * - AI deep scanning that discovers NEW threat patterns
 * - Autoimmune detection (immune system too aggressive)
 * - Vaccination (controlled exposure to weakened pathogens)
 * - Immune memory (faster response to previously-seen threats)
 * - Threat severity levels with proportional responses
 * - Quarantine system for suspicious but unconfirmed threats
 * - Immune health dashboard metrics
 * - White blood cell count metaphor (system capacity)
 */

'use strict';

const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

const SharedMemoryStore = require('./shared-memory-store');
const store = SharedMemoryStore.getInstance();
const NS = 'cognitive-immune-system';

const DATA_DIR = path.join(__dirname, '..', 'data', 'immune');
const PATHOGENS_PATH = path.join(DATA_DIR, 'pathogens.json');
const ANTIBODIES_PATH = path.join(DATA_DIR, 'cognitive-antibodies.json');
const SCAN_LOG_PATH = path.join(DATA_DIR, 'scan-log.json');
const QUARANTINE_PATH = path.join(DATA_DIR, 'quarantine.json');
const HEALTH_PATH = path.join(DATA_DIR, 'cognitive-health.json');
const MEMORY_PATH = path.join(DATA_DIR, 'immune-memory.json');

function ensureDir() {}
function readJSON(p, fb) { return store.get(NS, path.basename(p, '.json'), fb); }
function writeJSON(p, d) { store.set(NS, path.basename(p, '.json'), d); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

const RESPONSE_LEVELS = {
  DETECT:     'detect',
  WARN:       'warn',
  BLOCK:      'block',
  QUARANTINE: 'quarantine',
};

const SEVERITY = { low: 1, medium: 2, high: 3, critical: 4 };

/**
 * Default pathogen catalog — seeded on first run.
 */
const DEFAULT_PATHOGENS = [
  { name: 'circular_reasoning', description: 'Conclusion is used as a premise — the argument assumes what it tries to prove.', signatures: ['because it is', 'which proves that', 'therefore .* because', 'is true because .* is true'], severity: 'high', category: 'logical_fallacy' },
  { name: 'ad_hominem', description: 'Attacking the person instead of addressing the argument.', signatures: ['you would say that', 'of course .* would think', 'typical of someone who', 'what do you know about'], severity: 'medium', category: 'logical_fallacy' },
  { name: 'straw_man', description: 'Misrepresenting an argument to make it easier to attack.', signatures: ['so you\'re saying', 'what you really mean', 'in other words you think', 'that\'s like saying'], severity: 'medium', category: 'logical_fallacy' },
  { name: 'false_dichotomy', description: 'Presenting only two options when more exist.', signatures: ['either .* or', 'you must choose between', 'only two options', 'there is no middle ground', 'it\'s one or the other'], severity: 'medium', category: 'logical_fallacy' },
  { name: 'appeal_to_authority', description: 'Using an authority figure as evidence without actual support.', signatures: ['experts say', 'scientists agree', 'everyone knows', 'it is widely accepted', 'studies show(?! \\[)'], severity: 'low', category: 'logical_fallacy' },
  { name: 'slippery_slope', description: 'Assuming one event will inevitably lead to extreme consequences.', signatures: ['next thing you know', 'where does it end', 'before long', 'this will inevitably lead to', 'opens the floodgates'], severity: 'medium', category: 'logical_fallacy' },
  { name: 'confirmation_bias', description: 'Only considering evidence that supports a pre-existing belief.', signatures: ['this confirms', 'as expected', 'which proves my point', 'see, I told you', 'further evidence that'], severity: 'high', category: 'cognitive_bias' },
  { name: 'anchoring_bias', description: 'Over-relying on the first piece of information encountered.', signatures: ['based on the initial', 'starting from .* we can see', 'the first .* suggests'], severity: 'low', category: 'cognitive_bias' },
  { name: 'hallucination_fabrication', description: 'Confidently stating fabricated facts, statistics, or citations.', signatures: ['according to .* \\(\\d{4}\\)', 'a study at .* university found', 'research published in .* journal', 'statistics show that \\d+%'], severity: 'critical', category: 'hallucination' },
  { name: 'hallucination_false_precision', description: 'Providing overly precise numbers without basis.', signatures: ['exactly \\d+\\.\\d{2,}', 'precisely \\d+', 'the exact figure is'], severity: 'high', category: 'hallucination' },
  { name: 'premature_conclusion', description: 'Jumping to a conclusion without sufficient evidence or reasoning steps.', signatures: ['clearly', 'obviously', 'it is certain', 'without a doubt', 'there is no question', 'undeniably'], severity: 'medium', category: 'reasoning_error' },
  { name: 'hasty_generalization', description: 'Drawing broad conclusions from limited examples.', signatures: ['all .* are', 'every .* is', 'never .* any', 'always .* every', 'no .* ever'], severity: 'medium', category: 'logical_fallacy' },
  { name: 'begging_the_question', description: 'The conclusion is implicitly assumed in the premises.', signatures: ['is true because it is', 'we know .* because .* is', 'the reason .* is because .* is'], severity: 'high', category: 'logical_fallacy' },
  { name: 'equivocation', description: 'Using a word with multiple meanings in different parts of the argument.', signatures: [], severity: 'medium', category: 'logical_fallacy' },
  { name: 'sunk_cost_reasoning', description: 'Continuing a course of action because of past investment rather than future value.', signatures: ['we\'ve already invested', 'too far to stop', 'we\'ve come this far', 'can\'t waste what we\'ve'], severity: 'medium', category: 'cognitive_bias' },
  { name: 'bandwagon_fallacy', description: 'Arguing something is true because many people believe it.', signatures: ['everyone is doing', 'most people agree', 'the majority believes', 'popular opinion says'], severity: 'low', category: 'logical_fallacy' },
  { name: 'self_contradiction', description: 'Making contradictory claims within the same reasoning chain.', signatures: [], severity: 'critical', category: 'reasoning_error' },
  { name: 'overconfidence', description: 'Expressing certainty far beyond what the evidence supports.', signatures: ['I am 100% certain', 'guaranteed', 'there is zero chance', 'absolutely impossible', 'will definitely'], severity: 'high', category: 'cognitive_bias' },
  { name: 'appeal_to_emotion', description: 'Using emotional manipulation instead of logical argument.', signatures: ['think of the children', 'how would you feel', 'imagine the suffering', 'heartbreaking'], severity: 'medium', category: 'logical_fallacy' },
  { name: 'red_herring', description: 'Introducing irrelevant information to distract from the main argument.', signatures: ['but what about', 'the real issue is', 'let\'s not forget that', 'more importantly'], severity: 'low', category: 'logical_fallacy' },
  { name: 'survivorship_bias', description: 'Drawing conclusions only from examples that survived a selection process.', signatures: ['successful .* all', 'the ones that made it', 'winners .* always', 'every successful'], severity: 'medium', category: 'cognitive_bias' },
  { name: 'availability_heuristic', description: 'Overweighting easily recalled examples when estimating probability.', signatures: ['I recall .* therefore', 'everyone I know', 'I\'ve seen many cases', 'from my experience .* always'], severity: 'low', category: 'cognitive_bias' },
  { name: 'false_cause', description: 'Assuming correlation implies causation.', signatures: ['caused by', 'because .* happened .* therefore', 'led directly to', 'is the reason for'], severity: 'medium', category: 'logical_fallacy' },
  { name: 'hallucination_invented_quote', description: 'Attributing fabricated quotes to real people.', signatures: ['as .* once said', 'famously stated', 'in .* words', 'to quote .*:'], severity: 'critical', category: 'hallucination' },
];

class CognitiveImmuneSystem extends EventEmitter {
  constructor(opts = {}) {
    super();
    ensureDir();
    this.ai = opts.ai || null;
    this.config = Object.assign({
      autoEvolveIntervalMs: 3600000,
      maxScanLog: 2000,
      maxQuarantine: 500,
      maxPathogens: 500,
      maxAntibodies: 2000,
      falsePositiveThreshold: 0.25,
      antibodyDecayRate: 0.05,
      antibodyBoostRate: 0.15,
      antibodyWeakenRate: 0.20,
      mutationRate: 0.3,
      defaultResponseLevel: RESPONSE_LEVELS.WARN,
      baseWhiteBloodCells: 100,
      wbcRegenRate: 5,
      maxWhiteBloodCells: 200,
    }, opts.config || {});

    this._pathogens = readJSON(PATHOGENS_PATH, null);
    this._antibodies = readJSON(ANTIBODIES_PATH, []);
    this._scanLog = readJSON(SCAN_LOG_PATH, []);
    this._quarantine = readJSON(QUARANTINE_PATH, []);
    this._health = readJSON(HEALTH_PATH, {
      score: 100, lastEvolve: 0, falsePositives: 0, truePositives: 0,
      totalScans: 0, whiteBloodCells: this.config.baseWhiteBloodCells,
    });
    this._immuneMemory = readJSON(MEMORY_PATH, {});

    if (this._pathogens === null) {
      this._pathogens = [];
      for (const p of DEFAULT_PATHOGENS) {
        this._registerInternal(p.name, p.description, p.signatures, p.severity, p.category);
      }
    }

    this._tickTimer = null;
    this._startTick();
    this._initSSE();
  }

  _initSSE() {
    try {
      const sse = require('./sse-manager');
      this.on('scan:complete', (d) => sse.broadcastToChannel('immune', 'scan-complete', d));
      this.on('immune:detect', (d) => sse.broadcastToChannel('immune', 'threat-detected', d));
      this.on('immune:warn', (d) => sse.broadcastToChannel('immune', 'threat-detected', d));
      this.on('immune:block', (d) => sse.broadcastToChannel('immune', 'threat-detected', d));
      this.on('immune:quarantine', (d) => sse.broadcastToChannel('immune', 'threat-detected', d));
      this.on('immune:exhausted', (d) => sse.broadcastToChannel('immune', 'autoimmune', d));
    } catch (_) {}
  }

  /* ── Lifecycle ─────────────────────────────────────────── */

  _startTick() {
    this._tickTimer = setInterval(() => { try { this.tick(); } catch (_) {} }, this.config.autoEvolveIntervalMs);
    if (this._tickTimer.unref) this._tickTimer.unref();
  }

  stop() {
    if (this._tickTimer) { clearInterval(this._tickTimer); this._tickTimer = null; }
  }

  /* ── Pathogen Registry ─────────────────────────────────── */

  _registerInternal(name, description, signatures, severity, category) {
    const id = uuid();
    const pathogen = {
      id, name, description,
      signatures: (signatures || []).map(s => typeof s === 'string' ? s : s.source),
      severity: severity || 'medium',
      category: category || 'unknown',
      createdAt: Date.now(),
      encounters: 0,
    };
    this._pathogens.push(pathogen);

    for (const sig of pathogen.signatures) {
      this._antibodies.push({
        id: uuid(), pathogenId: id, type: 'signature', pattern: sig,
        correction: `Potential ${name.replace(/_/g, ' ')} detected. Review reasoning for: ${description}`,
        strength: 1.0, hits: 0, falsePositives: 0, generation: 0,
        mutatedFrom: null, createdAt: Date.now(),
      });
    }
    return pathogen;
  }

  registerPathogen(name, description, signatures, severity, category) {
    if (this._pathogens.length >= this.config.maxPathogens) {
      this._pathogens.sort((a, b) => a.encounters - b.encounters);
      const evicted = this._pathogens.shift();
      this._antibodies = this._antibodies.filter(a => a.pathogenId !== evicted.id);
    }
    const pathogen = this._registerInternal(name, description, signatures, severity, category);
    this._savePathogens();
    this._saveAntibodies();
    this.emit('pathogen:registered', pathogen);
    return pathogen;
  }

  getPathogen(id) { return this._pathogens.find(p => p.id === id) || null; }

  getPathogens(category) {
    if (category) return this._pathogens.filter(p => p.category === category);
    return this._pathogens.slice();
  }

  /* ── Antibody System ───────────────────────────────────── */

  createAntibody(pathogenId, detection, correction) {
    const pathogen = this._pathogens.find(p => p.id === pathogenId);
    if (!pathogen) return { error: 'Pathogen not found' };
    if (this._antibodies.length >= this.config.maxAntibodies) {
      this._antibodies.sort((a, b) => a.strength - b.strength);
      this._antibodies.shift();
    }
    const antibody = {
      id: uuid(), pathogenId, type: 'custom', pattern: detection,
      correction: correction || `Detected pattern matching ${pathogen.name}`,
      strength: 1.0, hits: 0, falsePositives: 0, generation: 0,
      mutatedFrom: null, createdAt: Date.now(),
    };
    this._antibodies.push(antibody);
    this._saveAntibodies();
    this.emit('antibody:created', antibody);
    return antibody;
  }

  getAntibodies(pathogenId) {
    if (pathogenId) return this._antibodies.filter(a => a.pathogenId === pathogenId);
    return this._antibodies.slice();
  }

  /* ── Antibody Mutation (Adaptive Evolution) ────────────── */

  _mutateAntibody(antibody) {
    if (!antibody.pattern || antibody.pattern.length < 3) return null;

    const mutations = [
      // Broaden: add optional word boundaries
      p => p.replace(/^/, '(?:.*\\b)?') + '(?:\\b.*)?',
      // Narrow: add word boundary anchors
      p => `\\b${p}\\b`,
      // Synonym expansion: add alternation with slight variation
      p => p.replace(/\s+/g, '\\s+'),
      // Partial match: take first half and make rest optional
      p => { const mid = Math.floor(p.length / 2); return p.slice(0, mid) + '(?:' + p.slice(mid) + ')?'; },
      // Case variation
      p => p.replace(/[a-z]/g, c => `[${c}${c.toUpperCase()}]`).slice(0, 80),
    ];

    const mutationType = Math.floor(Math.random() * mutations.length);
    try {
      const mutated = mutations[mutationType](antibody.pattern);
      new RegExp(mutated, 'i'); // validate
      return {
        id: uuid(), pathogenId: antibody.pathogenId, type: 'mutated',
        pattern: mutated,
        correction: antibody.correction,
        strength: antibody.strength * 0.7,
        hits: 0, falsePositives: 0,
        generation: (antibody.generation || 0) + 1,
        mutatedFrom: antibody.id,
        mutationType,
        createdAt: Date.now(),
      };
    } catch { return null; }
  }

  /* ── Immune Memory ─────────────────────────────────────── */

  _recordMemory(pathogenName, signature) {
    this._immuneMemory[pathogenName] = this._immuneMemory[pathogenName] || {
      firstSeen: Date.now(), encounters: 0, signatures: [], responseTimeMs: [],
    };
    const mem = this._immuneMemory[pathogenName];
    mem.encounters++;
    mem.lastSeen = Date.now();
    if (signature && !mem.signatures.includes(signature)) {
      mem.signatures.push(signature);
      if (mem.signatures.length > 20) mem.signatures.shift();
    }
    writeJSON(MEMORY_PATH, this._immuneMemory);
  }

  _getMemorySpeedBonus(pathogenName) {
    const mem = this._immuneMemory[pathogenName];
    if (!mem) return 1.0;
    // More encounters = faster/stronger response (up to 2x)
    return Math.min(2.0, 1.0 + Math.log2(mem.encounters + 1) * 0.2);
  }

  getImmuneMemory() {
    return Object.entries(this._immuneMemory).map(([name, mem]) => ({
      pathogen: name, ...mem,
      memoryStrength: this._getMemorySpeedBonus(name),
    })).sort((a, b) => b.encounters - a.encounters);
  }

  /* ── White Blood Cell Count ────────────────────────────── */

  _getWBC() { return this._health.whiteBloodCells || this.config.baseWhiteBloodCells; }

  _consumeWBC(count) {
    this._health.whiteBloodCells = Math.max(0, this._getWBC() - count);
    this._saveHealth();
  }

  _regenWBC() {
    this._health.whiteBloodCells = Math.min(
      this.config.maxWhiteBloodCells,
      this._getWBC() + this.config.wbcRegenRate
    );
    this._saveHealth();
  }

  /* ── Scanning ──────────────────────────────────────────── */

  scan(reasoning, context) {
    if (!reasoning || typeof reasoning !== 'string') {
      return { id: uuid(), safe: true, infections: [], score: 0, responseLevel: null, timestamp: Date.now() };
    }

    const wbc = this._getWBC();
    if (wbc < 5) {
      this.emit('immune:exhausted', { wbc });
      return { id: uuid(), safe: true, infections: [], score: 0, responseLevel: null, timestamp: Date.now(), warning: 'Immune system exhausted — insufficient white blood cells' };
    }

    const startTime = Date.now();
    const infections = [];
    let totalScore = 0;

    for (const antibody of this._antibodies) {
      if (antibody.strength < 0.1) continue;
      let matched = false;
      try {
        if (antibody.pattern && antibody.pattern.length > 0) {
          const re = new RegExp(antibody.pattern, 'i');
          matched = re.test(reasoning);
        }
      } catch { continue; }

      if (matched) {
        const pathogen = this._pathogens.find(p => p.id === antibody.pathogenId);
        if (!pathogen) continue;

        const memoryBonus = this._getMemorySpeedBonus(pathogen.name);
        const severityScore = (SEVERITY[pathogen.severity] || 2) * 15 * antibody.strength * memoryBonus;
        totalScore += severityScore;
        pathogen.encounters++;
        antibody.hits++;

        this._recordMemory(pathogen.name, antibody.pattern);

        infections.push({
          pathogenId: pathogen.id, pathogenName: pathogen.name, antibodyId: antibody.id,
          category: pathogen.category, severity: pathogen.severity,
          score: Math.round(severityScore * 100) / 100,
          correction: antibody.correction, strength: antibody.strength,
          memoryBonus: Math.round(memoryBonus * 100) / 100,
        });
      }
    }

    // Deduplicate by pathogen (keep highest-scoring)
    const seen = new Map();
    for (const inf of infections) {
      const existing = seen.get(inf.pathogenId);
      if (!existing || inf.score > existing.score) seen.set(inf.pathogenId, inf);
    }
    const deduped = Array.from(seen.values());
    totalScore = Math.min(Math.round(totalScore), 100);

    // Consume WBC proportional to scan intensity
    this._consumeWBC(1 + Math.floor(deduped.length * 0.5));

    // Determine response level
    let responseLevel = null;
    if (deduped.length > 0) {
      const maxSeverity = Math.max(...deduped.map(i => SEVERITY[i.severity] || 1));
      if (maxSeverity >= 4 || totalScore >= 70) responseLevel = RESPONSE_LEVELS.BLOCK;
      else if (maxSeverity >= 3 || totalScore >= 45) responseLevel = RESPONSE_LEVELS.WARN;
      else responseLevel = RESPONSE_LEVELS.DETECT;
      if (deduped.filter(i => i.severity === 'critical').length >= 2) {
        responseLevel = RESPONSE_LEVELS.QUARANTINE;
      }
    }

    const result = {
      id: uuid(), safe: deduped.length === 0, infections: deduped, score: totalScore,
      responseLevel, reasoningSnippet: reasoning.slice(0, 300), context: context || null,
      scanDurationMs: Date.now() - startTime, wbcRemaining: this._getWBC(),
      timestamp: Date.now(),
    };

    this._scanLog.push(result);
    if (this._scanLog.length > this.config.maxScanLog) {
      this._scanLog = this._scanLog.slice(-Math.floor(this.config.maxScanLog * 0.75));
    }
    this._saveScanLog();
    this._savePathogens();
    this._saveAntibodies();
    this._health.totalScans++;
    if (!result.safe) this._health.truePositives++;
    this.emit('scan:complete', result);
    return result;
  }

  /**
   * AI-powered deep scan — uses LLM to find subtle reasoning flaws
   * and discover NEW threat patterns not in the pre-seeded list.
   */
  async deepScan(reasoning, context) {
    const heuristicResult = this.scan(reasoning, context);
    if (!this.ai || typeof this.ai.chat !== 'function') return heuristicResult;

    try {
      const prompt = `Analyze this reasoning for logical fallacies, cognitive biases, hallucination patterns, circular reasoning, premature conclusions, or other reasoning errors. Look especially for NOVEL patterns not covered by standard fallacy lists.

REASONING:
"${reasoning.slice(0, 2000)}"

${context ? 'CONTEXT: ' + JSON.stringify(context).slice(0, 500) : ''}

Return JSON:
{
  "issues": [
    { "name": "pattern_name", "severity": "low|medium|high|critical", "category": "logical_fallacy|cognitive_bias|hallucination|reasoning_error", "explanation": "...", "correction": "...", "isNovel": true/false, "suggestedSignatures": ["regex1", "regex2"] }
  ],
  "overallQuality": 0-100
}

Only report genuine issues. If the reasoning is sound, return empty issues array with high quality score.`;

      const resp = await this.ai.chat([
        { role: 'system', content: 'You are a reasoning quality auditor. Identify genuine logical flaws. Be precise and avoid false positives. When you find novel patterns, suggest regex signatures that could catch similar issues. Return ONLY valid JSON.' },
        { role: 'user', content: prompt },
      ]);

      const text = (resp.response || '').replace(/```json\n?/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(text);

      if (parsed.issues && Array.isArray(parsed.issues)) {
        for (const issue of parsed.issues) {
          let pathogen = this._pathogens.find(p => p.name === issue.name);
          if (!pathogen) {
            // Learn new pathogen from AI — this is immune system LEARNING
            pathogen = this.registerPathogen(
              issue.name, issue.explanation || issue.name,
              issue.suggestedSignatures || [],
              issue.severity || 'medium',
              issue.category || 'reasoning_error'
            );
            if (issue.isNovel) {
              this.emit('pathogen:novel', { name: issue.name, category: issue.category });
            }
          }

          if (!heuristicResult.infections.find(i => i.pathogenName === issue.name)) {
            const severityScore = (SEVERITY[issue.severity] || 2) * 15;
            heuristicResult.infections.push({
              pathogenId: pathogen.id, pathogenName: issue.name, antibodyId: null,
              category: pathogen.category, severity: issue.severity || 'medium',
              score: severityScore, correction: issue.correction || issue.explanation,
              strength: 1.0, source: 'ai_deep_scan', isNovel: !!issue.isNovel,
            });
          }
        }

        heuristicResult.safe = heuristicResult.infections.length === 0;
        heuristicResult.aiQuality = parsed.overallQuality;
        heuristicResult.deepScanned = true;
        heuristicResult.score = Math.min(100,
          heuristicResult.infections.reduce((s, i) => s + (i.score || 0), 0)
        );
      }
    } catch (_) {
      heuristicResult.deepScanError = 'AI analysis failed';
    }
    return heuristicResult;
  }

  /* ── Immune Response ───────────────────────────────────── */

  respond(scanResult) {
    if (!scanResult || scanResult.safe) return { action: 'none' };
    const level = scanResult.responseLevel || this.config.defaultResponseLevel;
    const response = { scanId: scanResult.id, level, timestamp: Date.now(), actions: [] };

    switch (level) {
      case RESPONSE_LEVELS.DETECT:
        response.actions.push({ type: 'log', detail: 'Reasoning patterns flagged for review' });
        this.emit('immune:detect', scanResult);
        break;
      case RESPONSE_LEVELS.WARN:
        response.actions.push({ type: 'log', detail: 'Reasoning patterns flagged' });
        response.actions.push({ type: 'notify', detail: 'Warning issued to dependent modules' });
        response.corrections = scanResult.infections.map(i => i.correction).filter(Boolean);
        this.emit('immune:warn', scanResult);
        break;
      case RESPONSE_LEVELS.BLOCK:
        response.actions.push({ type: 'block', detail: 'Reasoning output blocked pending review' });
        response.corrections = scanResult.infections.map(i => i.correction).filter(Boolean);
        response.blocked = true;
        this.emit('immune:block', scanResult);
        break;
      case RESPONSE_LEVELS.QUARANTINE:
        this.quarantine(scanResult.id);
        response.actions.push({ type: 'quarantine', detail: 'Reasoning isolated for analysis' });
        response.quarantined = true;
        this.emit('immune:quarantine', scanResult);
        break;
    }
    return response;
  }

  /* ── Quarantine ────────────────────────────────────────── */

  quarantine(scanId) {
    const scanEntry = this._scanLog.find(s => s.id === scanId);
    if (!scanEntry) return { error: 'Scan result not found' };
    const qEntry = {
      id: uuid(), scanId, reasoning: scanEntry.reasoningSnippet,
      infections: scanEntry.infections, quarantinedAt: Date.now(),
      status: 'quarantined', reviewNotes: null, reviewedAt: null,
    };
    this._quarantine.push(qEntry);
    if (this._quarantine.length > this.config.maxQuarantine) {
      this._quarantine = this._quarantine.slice(-Math.floor(this.config.maxQuarantine * 0.75));
    }
    this._saveQuarantine();
    this.emit('quarantine:added', qEntry);
    return qEntry;
  }

  getQuarantine(status) {
    if (status) return this._quarantine.filter(q => q.status === status);
    return this._quarantine.slice();
  }

  releaseFromQuarantine(quarantineId, reviewNotes) {
    const entry = this._quarantine.find(q => q.id === quarantineId);
    if (!entry) return { error: 'Not found' };
    entry.status = 'released';
    entry.releasedAt = Date.now();
    entry.reviewNotes = reviewNotes || null;
    entry.reviewedAt = Date.now();
    this._saveQuarantine();
    return entry;
  }

  confirmQuarantine(quarantineId, reviewNotes) {
    const entry = this._quarantine.find(q => q.id === quarantineId);
    if (!entry) return { error: 'Not found' };
    entry.status = 'confirmed_threat';
    entry.reviewNotes = reviewNotes || null;
    entry.reviewedAt = Date.now();
    this._saveQuarantine();
    // Strengthen the antibodies that caught this
    for (const inf of entry.infections) {
      if (inf.antibodyId) {
        const ab = this._antibodies.find(a => a.id === inf.antibodyId);
        if (ab) ab.strength = Math.min(2.0, ab.strength + this.config.antibodyBoostRate);
      }
    }
    this._saveAntibodies();
    return entry;
  }

  /* ── Vaccination ───────────────────────────────────────── */

  vaccinate(pathogens) {
    if (!Array.isArray(pathogens)) return { error: 'Expected array of pathogens' };
    const results = [];
    for (const p of pathogens) {
      if (this._pathogens.find(ex => ex.name === p.name)) {
        // Already known — boost existing antibodies (booster shot)
        const existing = this._pathogens.find(ex => ex.name === p.name);
        const abs = this._antibodies.filter(a => a.pathogenId === existing.id);
        abs.forEach(ab => { ab.strength = Math.min(2.0, ab.strength + 0.1); });
        results.push({ name: p.name, status: 'boosted', antibodiesStrengthened: abs.length });
        continue;
      }
      const registered = this.registerPathogen(
        p.name, p.description || p.name, p.signatures || [],
        p.severity || 'medium', p.category || 'unknown'
      );
      // Weaken the initial antibodies (it's a vaccine, not a real threat)
      const newAbs = this._antibodies.filter(a => a.pathogenId === registered.id);
      newAbs.forEach(ab => { ab.strength = 0.5; }); // start at half strength
      this._recordMemory(p.name, null);
      results.push({ name: p.name, status: 'vaccinated', pathogenId: registered.id });
    }
    this._saveAntibodies();
    this.emit('immune:vaccinated', results);
    return { vaccinated: results.filter(r => r.status === 'vaccinated').length, boosted: results.filter(r => r.status === 'boosted').length, results };
  }

  /* ── False Positive / Feedback ─────────────────────────── */

  reportFalsePositive(scanId) {
    const scan = this._scanLog.find(s => s.id === scanId);
    if (!scan) return { error: 'Scan not found' };
    scan.falsePositive = true;
    this._health.falsePositives++;
    for (const infection of scan.infections) {
      if (infection.antibodyId) {
        const ab = this._antibodies.find(a => a.id === infection.antibodyId);
        if (ab) {
          ab.falsePositives++;
          ab.strength = Math.max(0.05, ab.strength - this.config.antibodyWeakenRate);
        }
      }
    }
    this._saveScanLog();
    this._saveAntibodies();
    this._saveHealth();
    this.emit('immune:falsePositive', scanId);
    return { reported: true, scanId };
  }

  reportTruePositive(scanId) {
    const scan = this._scanLog.find(s => s.id === scanId);
    if (!scan) return { error: 'Scan not found' };
    scan.truePositive = true;
    for (const infection of scan.infections) {
      if (infection.antibodyId) {
        const ab = this._antibodies.find(a => a.id === infection.antibodyId);
        if (ab) ab.strength = Math.min(2.0, ab.strength + this.config.antibodyBoostRate);
      }
    }
    this._saveScanLog();
    this._saveAntibodies();
    return { reported: true, scanId };
  }

  /* ── Adaptive Evolution ────────────────────────────────── */

  evolveAntibodies() {
    let strengthened = 0, weakened = 0, pruned = 0, mutated = 0;

    const toMutate = [];
    for (const ab of this._antibodies) {
      if (ab.hits === 0 && ab.strength > 0.2) {
        ab.strength = Math.max(0.1, ab.strength - this.config.antibodyDecayRate);
        weakened++;
      }
      if (ab.hits > 0 && ab.falsePositives > 0) {
        const fpRate = ab.falsePositives / (ab.hits + ab.falsePositives);
        if (fpRate > 0.5) {
          ab.strength = Math.max(0.05, ab.strength - this.config.antibodyWeakenRate);
          // Mark for mutation — failed antibodies get mutated
          if (Math.random() < this.config.mutationRate) toMutate.push(ab);
          weakened++;
        }
      }
      if (ab.hits >= 3 && ab.falsePositives === 0) {
        ab.strength = Math.min(2.0, ab.strength + this.config.antibodyBoostRate * 0.5);
        strengthened++;
      }
    }

    // Mutate failed antibodies to try new patterns
    for (const ab of toMutate) {
      const mutant = this._mutateAntibody(ab);
      if (mutant && this._antibodies.length < this.config.maxAntibodies) {
        this._antibodies.push(mutant);
        mutated++;
      }
    }

    // Prune dead antibodies
    const before = this._antibodies.length;
    this._antibodies = this._antibodies.filter(a => a.strength >= 0.05);
    pruned = before - this._antibodies.length;

    this._health.lastEvolve = Date.now();
    this._saveAntibodies();
    this._saveHealth();

    const result = { strengthened, weakened, pruned, mutated, totalAntibodies: this._antibodies.length };
    this.emit('immune:evolved', result);
    return result;
  }

  /* ── Autoimmune Detection ──────────────────────────────── */

  _checkAutoimmune() {
    const recentScans = this._scanLog.filter(s => s.timestamp > Date.now() - 86400000);
    if (recentScans.length < 10) return { status: 'insufficient_data', sampleSize: recentScans.length };

    const fpCount = recentScans.filter(s => s.falsePositive).length;
    const flaggedCount = recentScans.filter(s => !s.safe).length;
    const fpRate = flaggedCount > 0 ? fpCount / flaggedCount : 0;
    const isAutoimmune = fpRate > this.config.falsePositiveThreshold;

    if (isAutoimmune) {
      this.emit('immune:autoimmune', { fpRate, fpCount, flaggedCount, totalScans: recentScans.length });
      // Auto-weaken most aggressive antibodies to calm autoimmune response
      const overactive = this._antibodies
        .filter(a => a.falsePositives > a.hits && a.strength > 0.5)
        .sort((a, b) => b.falsePositives - a.falsePositives)
        .slice(0, 5);
      for (const ab of overactive) {
        ab.strength = Math.max(0.2, ab.strength * 0.7);
      }
      if (overactive.length > 0) this._saveAntibodies();
    }

    return {
      status: isAutoimmune ? 'autoimmune_warning' : 'healthy',
      falsePositiveRate: Math.round(fpRate * 1000) / 1000,
      falsePositives: fpCount, flagged: flaggedCount, totalScans: recentScans.length,
    };
  }

  /* ── Health Dashboard ──────────────────────────────────── */

  getHealth() {
    const autoimmune = this._checkAutoimmune();
    const recentScans = this._scanLog.filter(s => s.timestamp > Date.now() - 86400000);
    const recentInfections = recentScans.filter(s => !s.safe);

    const coveredPathogens = new Set(this._antibodies.map(a => a.pathogenId));
    const coverage = this._pathogens.length > 0 ? coveredPathogens.size / this._pathogens.length : 1;

    let score = 100;
    if (autoimmune.status === 'autoimmune_warning') score -= 20;
    if (coverage < 0.8) score -= Math.round((1 - coverage) * 30);
    if (recentInfections.length > 20) score -= 15;
    const weakAntibodies = this._antibodies.filter(a => a.strength < 0.3).length;
    if (weakAntibodies > this._antibodies.length * 0.3) score -= 10;
    const wbc = this._getWBC();
    if (wbc < this.config.baseWhiteBloodCells * 0.3) score -= 15;
    score = Math.max(0, Math.min(100, score));

    const mutatedCount = this._antibodies.filter(a => a.mutatedFrom).length;
    const memoryEntries = Object.keys(this._immuneMemory).length;

    return {
      score,
      status: score >= 80 ? 'healthy' : score >= 50 ? 'compromised' : 'critical',
      autoimmune,
      whiteBloodCells: { current: wbc, max: this.config.maxWhiteBloodCells, regenRate: this.config.wbcRegenRate },
      totalPathogens: this._pathogens.length,
      totalAntibodies: this._antibodies.length,
      mutatedAntibodies: mutatedCount,
      antibodyCoverage: Math.round(coverage * 100) + '%',
      weakAntibodies,
      immuneMemorySize: memoryEntries,
      recentScans24h: recentScans.length,
      recentInfections24h: recentInfections.length,
      quarantined: this._quarantine.filter(q => q.status === 'quarantined').length,
      lifetimeStats: {
        totalScans: this._health.totalScans, truePositives: this._health.truePositives,
        falsePositives: this._health.falsePositives,
        lastEvolve: this._health.lastEvolve ? new Date(this._health.lastEvolve).toISOString() : null,
      },
      topPathogens: this._pathogens.slice().sort((a, b) => b.encounters - a.encounters).slice(0, 5)
        .map(p => ({ name: p.name, encounters: p.encounters, severity: p.severity })),
    };
  }

  /* ── Periodic Tick ─────────────────────────────────────── */

  tick() {
    this.evolveAntibodies();
    this._checkAutoimmune();
    this._regenWBC();
    this._saveHealth();
    this.emit('tick');
  }

  /* ── Persistence ───────────────────────────────────────── */

  _savePathogens() { writeJSON(PATHOGENS_PATH, this._pathogens); }
  _saveAntibodies() { writeJSON(ANTIBODIES_PATH, this._antibodies); }
  _saveScanLog() { writeJSON(SCAN_LOG_PATH, this._scanLog); }
  _saveQuarantine() { writeJSON(QUARANTINE_PATH, this._quarantine); }
  _saveHealth() { writeJSON(HEALTH_PATH, this._health); }
}

module.exports = CognitiveImmuneSystem;
