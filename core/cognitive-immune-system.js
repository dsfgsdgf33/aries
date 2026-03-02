/**
 * ARIES — Cognitive Immune System
 * Antibodies against bad reasoning patterns. Detects, quarantines, and evolves
 * defenses against logical fallacies, cognitive biases, hallucinations, and
 * other reasoning pathogens.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

const DATA_DIR = path.join(__dirname, '..', 'data', 'immune');
const PATHOGENS_PATH = path.join(DATA_DIR, 'pathogens.json');
const ANTIBODIES_PATH = path.join(DATA_DIR, 'cognitive-antibodies.json');
const SCAN_LOG_PATH = path.join(DATA_DIR, 'scan-log.json');
const QUARANTINE_PATH = path.join(DATA_DIR, 'quarantine.json');
const HEALTH_PATH = path.join(DATA_DIR, 'cognitive-health.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
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
  {
    name: 'circular_reasoning',
    description: 'Conclusion is used as a premise — the argument assumes what it tries to prove.',
    signatures: ['because it is', 'which proves that', 'therefore .* because', 'is true because .* is true'],
    severity: 'high',
    category: 'logical_fallacy',
  },
  {
    name: 'ad_hominem',
    description: 'Attacking the person instead of addressing the argument.',
    signatures: ['you would say that', 'of course .* would think', 'typical of someone who', 'what do you know about'],
    severity: 'medium',
    category: 'logical_fallacy',
  },
  {
    name: 'straw_man',
    description: 'Misrepresenting an argument to make it easier to attack.',
    signatures: ['so you\'re saying', 'what you really mean', 'in other words you think', 'that\'s like saying'],
    severity: 'medium',
    category: 'logical_fallacy',
  },
  {
    name: 'false_dichotomy',
    description: 'Presenting only two options when more exist.',
    signatures: ['either .* or', 'you must choose between', 'only two options', 'there is no middle ground', 'it\'s one or the other'],
    severity: 'medium',
    category: 'logical_fallacy',
  },
  {
    name: 'appeal_to_authority',
    description: 'Using an authority figure as evidence without actual support.',
    signatures: ['experts say', 'scientists agree', 'everyone knows', 'it is widely accepted', 'studies show(?! \\[)'],
    severity: 'low',
    category: 'logical_fallacy',
  },
  {
    name: 'slippery_slope',
    description: 'Assuming one event will inevitably lead to extreme consequences.',
    signatures: ['next thing you know', 'where does it end', 'before long', 'this will inevitably lead to', 'opens the floodgates'],
    severity: 'medium',
    category: 'logical_fallacy',
  },
  {
    name: 'confirmation_bias',
    description: 'Only considering evidence that supports a pre-existing belief.',
    signatures: ['this confirms', 'as expected', 'which proves my point', 'see, I told you', 'further evidence that'],
    severity: 'high',
    category: 'cognitive_bias',
  },
  {
    name: 'anchoring_bias',
    description: 'Over-relying on the first piece of information encountered.',
    signatures: ['based on the initial', 'starting from .* we can see', 'the first .* suggests'],
    severity: 'low',
    category: 'cognitive_bias',
  },
  {
    name: 'hallucination_fabrication',
    description: 'Confidently stating fabricated facts, statistics, or citations.',
    signatures: ['according to .* \\(\\d{4}\\)', 'a study at .* university found', 'research published in .* journal', 'statistics show that \\d+%'],
    severity: 'critical',
    category: 'hallucination',
  },
  {
    name: 'hallucination_false_precision',
    description: 'Providing overly precise numbers without basis.',
    signatures: ['exactly \\d+\\.\\d{2,}', 'precisely \\d+', 'the exact figure is'],
    severity: 'high',
    category: 'hallucination',
  },
  {
    name: 'premature_conclusion',
    description: 'Jumping to a conclusion without sufficient evidence or reasoning steps.',
    signatures: ['clearly', 'obviously', 'it is certain', 'without a doubt', 'there is no question', 'undeniably'],
    severity: 'medium',
    category: 'reasoning_error',
  },
  {
    name: 'hasty_generalization',
    description: 'Drawing broad conclusions from limited examples.',
    signatures: ['all .* are', 'every .* is', 'never .* any', 'always .* every', 'no .* ever'],
    severity: 'medium',
    category: 'logical_fallacy',
  },
  {
    name: 'begging_the_question',
    description: 'The conclusion is implicitly assumed in the premises.',
    signatures: ['is true because it is', 'we know .* because .* is', 'the reason .* is because .* is'],
    severity: 'high',
    category: 'logical_fallacy',
  },
  {
    name: 'equivocation',
    description: 'Using a word with multiple meanings in different parts of the argument.',
    signatures: [],
    severity: 'medium',
    category: 'logical_fallacy',
  },
  {
    name: 'sunk_cost_reasoning',
    description: 'Continuing a course of action because of past investment rather than future value.',
    signatures: ['we\'ve already invested', 'too far to stop', 'we\'ve come this far', 'can\'t waste what we\'ve'],
    severity: 'medium',
    category: 'cognitive_bias',
  },
  {
    name: 'bandwagon_fallacy',
    description: 'Arguing something is true because many people believe it.',
    signatures: ['everyone is doing', 'most people agree', 'the majority believes', 'popular opinion says'],
    severity: 'low',
    category: 'logical_fallacy',
  },
  {
    name: 'self_contradition',
    description: 'Making contradictory claims within the same reasoning chain.',
    signatures: [],
    severity: 'critical',
    category: 'reasoning_error',
  },
  {
    name: 'overconfidence',
    description: 'Expressing certainty far beyond what the evidence supports.',
    signatures: ['I am 100% certain', 'guaranteed', 'there is zero chance', 'absolutely impossible', 'will definitely'],
    severity: 'high',
    category: 'cognitive_bias',
  },
];

class CognitiveImmuneSystem extends EventEmitter {
  constructor(opts = {}) {
    super();
    ensureDir();
    this.ai = opts.ai || null;
    this.config = Object.assign({
      autoEvolveIntervalMs: 3600000,       // 1h
      maxScanLog: 2000,
      maxQuarantine: 500,
      maxPathogens: 500,
      maxAntibodies: 2000,
      falsePositiveThreshold: 0.25,        // autoimmune alarm above 25%
      antibodyDecayRate: 0.05,             // weaken per evolution cycle on no-hit
      antibodyBoostRate: 0.15,             // strengthen per true positive
      antibodyWeakenRate: 0.20,            // weaken per false positive
      defaultResponseLevel: RESPONSE_LEVELS.WARN,
    }, opts.config || {});

    this._pathogens = readJSON(PATHOGENS_PATH, null);
    this._antibodies = readJSON(ANTIBODIES_PATH, []);
    this._scanLog = readJSON(SCAN_LOG_PATH, []);
    this._quarantine = readJSON(QUARANTINE_PATH, []);
    this._health = readJSON(HEALTH_PATH, { score: 100, lastEvolve: 0, falsePositives: 0, truePositives: 0, totalScans: 0 });

    // Seed pathogens on first run
    if (this._pathogens === null) {
      this._pathogens = [];
      for (const p of DEFAULT_PATHOGENS) {
        this._registerInternal(p.name, p.description, p.signatures, p.severity, p.category);
      }
    }

    this._tickTimer = null;
    this._startTick();
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
      id,
      name,
      description,
      signatures: (signatures || []).map(s => typeof s === 'string' ? s : s.source),
      severity: severity || 'medium',
      category: category || 'unknown',
      createdAt: Date.now(),
      encounters: 0,
    };
    this._pathogens.push(pathogen);

    // Auto-create antibodies from signatures
    for (const sig of pathogen.signatures) {
      this._antibodies.push({
        id: uuid(),
        pathogenId: id,
        type: 'signature',
        pattern: sig,
        correction: `Potential ${name.replace(/_/g, ' ')} detected. Review reasoning for: ${description}`,
        strength: 1.0,
        hits: 0,
        falsePositives: 0,
        createdAt: Date.now(),
      });
    }

    return pathogen;
  }

  registerPathogen(name, description, signatures, severity) {
    if (this._pathogens.length >= this.config.maxPathogens) {
      // Evict least-encountered
      this._pathogens.sort((a, b) => a.encounters - b.encounters);
      const evicted = this._pathogens.shift();
      this._antibodies = this._antibodies.filter(a => a.pathogenId !== evicted.id);
    }
    const pathogen = this._registerInternal(name, description, signatures, severity);
    this._savePathogens();
    this._saveAntibodies();
    this.emit('pathogen:registered', pathogen);
    return pathogen;
  }

  getPathogen(id) {
    return this._pathogens.find(p => p.id === id) || null;
  }

  getPathogens(category) {
    if (category) return this._pathogens.filter(p => p.category === category);
    return this._pathogens.slice();
  }

  /* ── Antibody System ───────────────────────────────────── */

  createAntibody(pathogenId, detection, correction) {
    const pathogen = this._pathogens.find(p => p.id === pathogenId);
    if (!pathogen) return { error: 'Pathogen not found' };

    if (this._antibodies.length >= this.config.maxAntibodies) {
      // Evict weakest
      this._antibodies.sort((a, b) => a.strength - b.strength);
      this._antibodies.shift();
    }

    const antibody = {
      id: uuid(),
      pathogenId,
      type: 'custom',
      pattern: detection,
      correction: correction || `Detected pattern matching ${pathogen.name}`,
      strength: 1.0,
      hits: 0,
      falsePositives: 0,
      createdAt: Date.now(),
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

  /* ── Scanning ──────────────────────────────────────────── */

  scan(reasoning, context) {
    if (!reasoning || typeof reasoning !== 'string') {
      return { id: uuid(), safe: true, infections: [], score: 0, responseLevel: null, timestamp: Date.now() };
    }

    const text = reasoning.toLowerCase();
    const infections = [];
    let totalScore = 0;

    for (const antibody of this._antibodies) {
      if (antibody.strength < 0.1) continue; // too weak, effectively dead

      let matched = false;
      try {
        if (antibody.pattern && antibody.pattern.length > 0) {
          const re = new RegExp(antibody.pattern, 'i');
          matched = re.test(reasoning);
        }
      } catch {
        // Invalid regex — skip
        continue;
      }

      if (matched) {
        const pathogen = this._pathogens.find(p => p.id === antibody.pathogenId);
        if (!pathogen) continue;

        const severityScore = (SEVERITY[pathogen.severity] || 2) * 15 * antibody.strength;
        totalScore += severityScore;
        pathogen.encounters++;

        antibody.hits++;

        infections.push({
          pathogenId: pathogen.id,
          pathogenName: pathogen.name,
          antibodyId: antibody.id,
          category: pathogen.category,
          severity: pathogen.severity,
          score: Math.round(severityScore * 100) / 100,
          correction: antibody.correction,
          strength: antibody.strength,
        });
      }
    }

    // Deduplicate by pathogen (keep highest-scoring)
    const seen = new Map();
    for (const inf of infections) {
      const existing = seen.get(inf.pathogenId);
      if (!existing || inf.score > existing.score) {
        seen.set(inf.pathogenId, inf);
      }
    }
    const deduped = Array.from(seen.values());

    totalScore = Math.min(Math.round(totalScore), 100);

    // Determine response level
    let responseLevel = null;
    if (deduped.length > 0) {
      const maxSeverity = Math.max(...deduped.map(i => SEVERITY[i.severity] || 1));
      if (maxSeverity >= 4 || totalScore >= 70) responseLevel = RESPONSE_LEVELS.BLOCK;
      else if (maxSeverity >= 3 || totalScore >= 45) responseLevel = RESPONSE_LEVELS.WARN;
      else responseLevel = RESPONSE_LEVELS.DETECT;

      // Quarantine-level: multiple critical findings
      if (deduped.filter(i => i.severity === 'critical').length >= 2) {
        responseLevel = RESPONSE_LEVELS.QUARANTINE;
      }
    }

    const result = {
      id: uuid(),
      safe: deduped.length === 0,
      infections: deduped,
      score: totalScore,
      responseLevel,
      reasoningSnippet: reasoning.slice(0, 300),
      context: context || null,
      timestamp: Date.now(),
    };

    // Log
    this._scanLog.push(result);
    if (this._scanLog.length > this.config.maxScanLog) {
      this._scanLog = this._scanLog.slice(-Math.floor(this.config.maxScanLog * 0.75));
    }
    this._saveScanLog();
    this._savePathogens();
    this._saveAntibodies();

    // Update health counters
    this._health.totalScans++;
    if (!result.safe) this._health.truePositives++;

    this.emit('scan:complete', result);
    return result;
  }

  /**
   * AI-powered deep scan — uses LLM to find subtle reasoning flaws.
   */
  async deepScan(reasoning, context) {
    // Always run heuristic scan first
    const heuristicResult = this.scan(reasoning, context);

    if (!this.ai || typeof this.ai.chat !== 'function') {
      return heuristicResult;
    }

    try {
      const prompt = `Analyze this reasoning for logical fallacies, cognitive biases, hallucination patterns, circular reasoning, premature conclusions, or other reasoning errors.

REASONING:
"${reasoning.slice(0, 2000)}"

${context ? 'CONTEXT: ' + JSON.stringify(context).slice(0, 500) : ''}

Return JSON:
{
  "issues": [
    { "name": "pattern_name", "severity": "low|medium|high|critical", "explanation": "...", "correction": "..." }
  ],
  "overallQuality": 0-100
}

Only report genuine issues. If the reasoning is sound, return empty issues array with high quality score.`;

      const resp = await this.ai.chat([
        { role: 'system', content: 'You are a reasoning quality auditor. Identify genuine logical flaws. Be precise and avoid false positives. Return ONLY valid JSON.' },
        { role: 'user', content: prompt },
      ]);

      const text = (resp.response || '').replace(/```json\n?/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(text);

      if (parsed.issues && Array.isArray(parsed.issues)) {
        for (const issue of parsed.issues) {
          // Check if we already have this pathogen
          let pathogen = this._pathogens.find(p => p.name === issue.name);
          if (!pathogen) {
            // Learn new pathogen from AI
            pathogen = this.registerPathogen(
              issue.name,
              issue.explanation || issue.name,
              [],
              issue.severity || 'medium'
            );
          }

          // Add to results if not already caught by heuristics
          if (!heuristicResult.infections.find(i => i.pathogenName === issue.name)) {
            const severityScore = (SEVERITY[issue.severity] || 2) * 15;
            heuristicResult.infections.push({
              pathogenId: pathogen.id,
              pathogenName: issue.name,
              antibodyId: null,
              category: pathogen.category,
              severity: issue.severity || 'medium',
              score: severityScore,
              correction: issue.correction || issue.explanation,
              strength: 1.0,
              source: 'ai_deep_scan',
            });
          }
        }

        heuristicResult.safe = heuristicResult.infections.length === 0;
        heuristicResult.aiQuality = parsed.overallQuality;
        heuristicResult.deepScanned = true;

        // Recalculate score
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
    const response = {
      scanId: scanResult.id,
      level,
      timestamp: Date.now(),
      actions: [],
    };

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
      id: uuid(),
      scanId,
      reasoning: scanEntry.reasoningSnippet,
      infections: scanEntry.infections,
      quarantinedAt: Date.now(),
      status: 'quarantined',
      reviewNotes: null,
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

  releaseFromQuarantine(quarantineId) {
    const entry = this._quarantine.find(q => q.id === quarantineId);
    if (!entry) return { error: 'Not found' };
    entry.status = 'released';
    entry.releasedAt = Date.now();
    this._saveQuarantine();
    return entry;
  }

  /* ── Vaccination ───────────────────────────────────────── */

  vaccinate(pathogens) {
    if (!Array.isArray(pathogens)) return { error: 'Expected array of pathogens' };

    const results = [];
    for (const p of pathogens) {
      // Skip if we already know this pathogen
      if (this._pathogens.find(ex => ex.name === p.name)) {
        results.push({ name: p.name, status: 'already_known' });
        continue;
      }

      const registered = this.registerPathogen(
        p.name,
        p.description || p.name,
        p.signatures || [],
        p.severity || 'medium'
      );
      results.push({ name: p.name, status: 'vaccinated', pathogenId: registered.id });
    }

    this.emit('immune:vaccinated', results);
    return { vaccinated: results.filter(r => r.status === 'vaccinated').length, results };
  }

  /* ── False Positive / Feedback ─────────────────────────── */

  reportFalsePositive(scanId) {
    const scan = this._scanLog.find(s => s.id === scanId);
    if (!scan) return { error: 'Scan not found' };

    scan.falsePositive = true;
    this._health.falsePositives++;

    // Weaken antibodies that fired
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

    // Strengthen antibodies that fired
    for (const infection of scan.infections) {
      if (infection.antibodyId) {
        const ab = this._antibodies.find(a => a.id === infection.antibodyId);
        if (ab) {
          ab.strength = Math.min(2.0, ab.strength + this.config.antibodyBoostRate);
        }
      }
    }

    this._saveScanLog();
    this._saveAntibodies();
    return { reported: true, scanId };
  }

  /* ── Adaptive Evolution ────────────────────────────────── */

  evolveAntibodies() {
    let strengthened = 0;
    let weakened = 0;
    let pruned = 0;

    for (const ab of this._antibodies) {
      // Antibodies that haven't hit anything slowly decay
      if (ab.hits === 0 && ab.strength > 0.2) {
        ab.strength = Math.max(0.1, ab.strength - this.config.antibodyDecayRate);
        weakened++;
      }

      // High false-positive ratio → aggressive weakening
      if (ab.hits > 0 && ab.falsePositives > 0) {
        const fpRate = ab.falsePositives / (ab.hits + ab.falsePositives);
        if (fpRate > 0.5) {
          ab.strength = Math.max(0.05, ab.strength - this.config.antibodyWeakenRate);
          weakened++;
        }
      }

      // Antibodies with many clean hits → strengthen
      if (ab.hits >= 3 && ab.falsePositives === 0) {
        ab.strength = Math.min(2.0, ab.strength + this.config.antibodyBoostRate * 0.5);
        strengthened++;
      }
    }

    // Prune effectively dead antibodies (very weak + no recent hits)
    const before = this._antibodies.length;
    this._antibodies = this._antibodies.filter(a => a.strength >= 0.05);
    pruned = before - this._antibodies.length;

    this._health.lastEvolve = Date.now();
    this._saveAntibodies();
    this._saveHealth();

    const result = { strengthened, weakened, pruned, totalAntibodies: this._antibodies.length };
    this.emit('immune:evolved', result);
    return result;
  }

  /* ── Autoimmune Detection ──────────────────────────────── */

  _checkAutoimmune() {
    const recentScans = this._scanLog.filter(s => s.timestamp > Date.now() - 86400000); // last 24h
    if (recentScans.length < 10) return { status: 'insufficient_data', sampleSize: recentScans.length };

    const fpCount = recentScans.filter(s => s.falsePositive).length;
    const flaggedCount = recentScans.filter(s => !s.safe).length;
    const fpRate = flaggedCount > 0 ? fpCount / flaggedCount : 0;

    const isAutoimmune = fpRate > this.config.falsePositiveThreshold;

    if (isAutoimmune) {
      this.emit('immune:autoimmune', { fpRate, fpCount, flaggedCount, totalScans: recentScans.length });
    }

    return {
      status: isAutoimmune ? 'autoimmune_warning' : 'healthy',
      falsePositiveRate: Math.round(fpRate * 1000) / 1000,
      falsePositives: fpCount,
      flagged: flaggedCount,
      totalScans: recentScans.length,
    };
  }

  /* ── Health Dashboard ──────────────────────────────────── */

  getHealth() {
    const autoimmune = this._checkAutoimmune();
    const recentScans = this._scanLog.filter(s => s.timestamp > Date.now() - 86400000);
    const recentInfections = recentScans.filter(s => !s.safe);

    // Count unique pathogens covered by antibodies
    const coveredPathogens = new Set(this._antibodies.map(a => a.pathogenId));
    const coverage = this._pathogens.length > 0
      ? coveredPathogens.size / this._pathogens.length
      : 1;

    // Health score: starts at 100, deducted for issues
    let score = 100;
    if (autoimmune.status === 'autoimmune_warning') score -= 20;
    if (coverage < 0.8) score -= Math.round((1 - coverage) * 30);
    if (recentInfections.length > 20) score -= 15;
    const weakAntibodies = this._antibodies.filter(a => a.strength < 0.3).length;
    if (weakAntibodies > this._antibodies.length * 0.3) score -= 10;
    score = Math.max(0, Math.min(100, score));

    return {
      score,
      status: score >= 80 ? 'healthy' : score >= 50 ? 'compromised' : 'critical',
      autoimmune,
      totalPathogens: this._pathogens.length,
      totalAntibodies: this._antibodies.length,
      antibodyCoverage: Math.round(coverage * 100) + '%',
      weakAntibodies,
      recentScans24h: recentScans.length,
      recentInfections24h: recentInfections.length,
      quarantined: this._quarantine.filter(q => q.status === 'quarantined').length,
      lifetimeStats: {
        totalScans: this._health.totalScans,
        truePositives: this._health.truePositives,
        falsePositives: this._health.falsePositives,
        lastEvolve: this._health.lastEvolve ? new Date(this._health.lastEvolve).toISOString() : null,
      },
      topPathogens: this._pathogens
        .slice()
        .sort((a, b) => b.encounters - a.encounters)
        .slice(0, 5)
        .map(p => ({ name: p.name, encounters: p.encounters, severity: p.severity })),
    };
  }

  /* ── Periodic Tick ─────────────────────────────────────── */

  tick() {
    this.evolveAntibodies();
    this._checkAutoimmune();
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
