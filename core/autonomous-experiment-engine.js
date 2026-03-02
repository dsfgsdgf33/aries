/**
 * ARIES — Autonomous Experiment Engine
 * 
 * Aries as its own scientist. Forms hypotheses, designs experiments,
 * runs them with proper isolation, analyzes results, publishes findings.
 * Replaces and vastly extends micro-experiments.js.
 */

'use strict';

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'experiments');
const EXPERIMENTS_PATH = path.join(DATA_DIR, 'experiments.json');
const HYPOTHESES_PATH = path.join(DATA_DIR, 'hypotheses.json');
const FINDINGS_PATH = path.join(DATA_DIR, 'findings.json');
const OBSERVATIONS_PATH = path.join(DATA_DIR, 'observations.json');

const EXPERIMENT_TYPES = ['BEHAVIORAL', 'ARCHITECTURAL', 'COGNITIVE', 'PERFORMANCE'];
const STATUSES = ['pending', 'running', 'paused', 'concluded', 'aborted', 'budget-exceeded'];
const MAX_CONCURRENT = 5;
const MAX_HISTORY = 500;

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function uid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }
function now() { return Date.now(); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

class AutonomousExperimentEngine extends EventEmitter {
  /**
   * @param {object} opts
   * @param {object} opts.ai - AI core for LLM access (callWithFallback)
   * @param {object} opts.config - experiment engine config
   */
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null;
    this.config = opts.config || {};
    this.maxConcurrent = this.config.maxConcurrent || MAX_CONCURRENT;
    this.defaultSampleSize = this.config.defaultSampleSize || 30;
    this.defaultMaxDurationMs = this.config.defaultMaxDurationMs || 7 * 24 * 60 * 60 * 1000; // 7 days
    this.defaultTokenBudget = this.config.defaultTokenBudget || 50000;
    this.autoAnalyzeThreshold = this.config.autoAnalyzeThreshold || 0.8; // analyze at 80% samples
    this.confidenceThreshold = this.config.confidenceThreshold || 75; // publish at 75% confidence
    ensureDir();
  }

  // ── Persistence ──

  _loadHypotheses() { return readJSON(HYPOTHESES_PATH, []); }
  _saveHypotheses(h) { writeJSON(HYPOTHESES_PATH, h); }
  _loadExperiments() { return readJSON(EXPERIMENTS_PATH, []); }
  _saveExperiments(e) { writeJSON(EXPERIMENTS_PATH, e); }
  _loadFindings() { return readJSON(FINDINGS_PATH, []); }
  _saveFindings(f) { writeJSON(FINDINGS_PATH, f); }
  _loadObservations() { return readJSON(OBSERVATIONS_PATH, []); }
  _saveObservations(o) { writeJSON(OBSERVATIONS_PATH, o); }

  // ── Hypothesis Generation ──

  /**
   * AI observes system state and proposes testable hypotheses.
   * @param {object} [context] - Optional system state / performance data
   * @returns {Promise<object[]>} Array of generated hypotheses
   */
  async generateHypotheses(context = {}) {
    if (!this.ai) throw new Error('AI module required for hypothesis generation');

    const existing = this._loadHypotheses();
    const findings = this._loadFindings();

    const messages = [
      {
        role: 'system',
        content: `You are SCIENTIST — Aries's internal research engine.
Observe the provided system context and generate testable hypotheses.

Each hypothesis must have:
- statement: clear, falsifiable claim
- type: one of ${EXPERIMENT_TYPES.join(', ')}
- rationale: why this is worth testing
- expectedEffect: what measurable change is predicted
- priority: 1-5 (5 = most important)

Existing hypotheses to avoid duplicating: ${existing.slice(-10).map(h => h.statement).join('; ') || 'none'}
Recent findings to build upon: ${findings.slice(-5).map(f => f.conclusion).join('; ') || 'none'}

Return ONLY a JSON array of hypothesis objects.`
      },
      {
        role: 'user',
        content: `System context:\n${JSON.stringify(context, null, 2)}\n\nGenerate 2-5 novel hypotheses.`
      }
    ];

    const data = await this.ai.callWithFallback(messages, null);
    const content = data.choices?.[0]?.message?.content || '[]';
    const match = content.match(/\[[\s\S]*\]/);
    if (!match) return [];

    let parsed;
    try { parsed = JSON.parse(match[0]); } catch { return []; }

    const newHypotheses = parsed.map(h => ({
      id: uid(),
      statement: h.statement || 'Unknown hypothesis',
      type: EXPERIMENT_TYPES.includes(h.type) ? h.type : 'BEHAVIORAL',
      rationale: h.rationale || '',
      expectedEffect: h.expectedEffect || '',
      priority: clamp(h.priority || 3, 1, 5),
      status: 'untested', // untested | testing | tested | rejected
      createdAt: now(),
      experimentIds: [],
    }));

    existing.push(...newHypotheses);
    if (existing.length > MAX_HISTORY) existing.splice(0, existing.length - MAX_HISTORY);
    this._saveHypotheses(existing);

    this.emit('hypotheses-generated', { count: newHypotheses.length, hypotheses: newHypotheses });
    return newHypotheses;
  }

  // ── Experiment Design ──

  /**
   * Design a structured experiment for a hypothesis.
   * @param {string} hypothesisId
   * @param {object} [overrides] - Override experiment parameters
   * @returns {Promise<object>} Designed experiment
   */
  async designExperiment(hypothesisId, overrides = {}) {
    const hypotheses = this._loadHypotheses();
    const hyp = hypotheses.find(h => h.id === hypothesisId);
    if (!hyp) throw new Error('Hypothesis not found: ' + hypothesisId);

    let design;

    if (this.ai) {
      const messages = [
        {
          role: 'system',
          content: `You are SCIENTIST. Design a rigorous experiment to test this hypothesis.

Return a JSON object with:
- controlCondition: { name, description, config } — the baseline
- testCondition: { name, description, config } — the treatment
- metrics: [{ name, description, higherIsBetter }] — what to measure
- sampleSize: number of observations needed per condition
- maxDurationMs: max time before auto-conclude
- abortConditions: [string] — when to stop early
- isolationStrategy: how to ensure one-variable-at-a-time

Return ONLY JSON.`
        },
        {
          role: 'user',
          content: `Hypothesis: ${hyp.statement}\nType: ${hyp.type}\nExpected effect: ${hyp.expectedEffect}`
        }
      ];

      const data = await this.ai.callWithFallback(messages, null);
      const content = data.choices?.[0]?.message?.content || '{}';
      const match = content.match(/\{[\s\S]*\}/);
      try { design = JSON.parse(match[0]); } catch { design = {}; }
    } else {
      design = {};
    }

    const experiment = {
      id: uid(),
      hypothesisId,
      hypothesis: hyp.statement,
      type: hyp.type,
      status: 'pending',
      controlCondition: overrides.controlCondition || design.controlCondition || { name: 'Control', description: 'Baseline behavior', config: {} },
      testCondition: overrides.testCondition || design.testCondition || { name: 'Test', description: 'Modified behavior', config: {} },
      metrics: overrides.metrics || design.metrics || [{ name: 'effectiveness', description: 'Overall effectiveness', higherIsBetter: true }],
      sampleSize: overrides.sampleSize || design.sampleSize || this.defaultSampleSize,
      maxDurationMs: overrides.maxDurationMs || design.maxDurationMs || this.defaultMaxDurationMs,
      abortConditions: overrides.abortConditions || design.abortConditions || ['Negative impact exceeds 50%', 'Error rate doubles'],
      isolationStrategy: design.isolationStrategy || 'Sequential assignment with random allocation',
      tokenBudget: overrides.tokenBudget || this.defaultTokenBudget,
      tokensUsed: 0,
      observations: { control: [], test: [] },
      analysis: null,
      finding: null,
      createdAt: now(),
      startedAt: null,
      concludedAt: null,
      error: null,
    };

    const experiments = this._loadExperiments();
    experiments.push(experiment);
    if (experiments.length > MAX_HISTORY) experiments.splice(0, experiments.length - MAX_HISTORY);
    this._saveExperiments(experiments);

    // Link experiment to hypothesis
    hyp.experimentIds.push(experiment.id);
    this._saveHypotheses(hypotheses);

    this.emit('experiment-designed', { id: experiment.id, hypothesis: hyp.statement, type: hyp.type });
    return experiment;
  }

  // ── Experiment Execution ──

  /**
   * Start running an experiment.
   * @param {string} experimentId
   * @returns {object} Updated experiment
   */
  runExperiment(experimentId) {
    const experiments = this._loadExperiments();
    const exp = experiments.find(e => e.id === experimentId);
    if (!exp) throw new Error('Experiment not found: ' + experimentId);
    if (exp.status === 'running') throw new Error('Experiment already running');
    if (exp.status === 'concluded') throw new Error('Experiment already concluded');

    const running = experiments.filter(e => e.status === 'running');
    if (running.length >= this.maxConcurrent) {
      throw new Error(`Max concurrent experiments (${this.maxConcurrent}) reached`);
    }

    exp.status = 'running';
    exp.startedAt = exp.startedAt || now();
    this._saveExperiments(experiments);

    // Update hypothesis status
    const hypotheses = this._loadHypotheses();
    const hyp = hypotheses.find(h => h.id === exp.hypothesisId);
    if (hyp && hyp.status === 'untested') {
      hyp.status = 'testing';
      this._saveHypotheses(hypotheses);
    }

    this.emit('experiment-started', { id: exp.id, hypothesis: exp.hypothesis });
    return exp;
  }

  /**
   * Record an observation for a running experiment.
   * @param {string} experimentId
   * @param {'control'|'test'} condition
   * @param {object} metrics - Key-value pairs of metric measurements
   * @returns {object} Updated experiment summary
   */
  recordObservation(experimentId, condition, metrics) {
    if (!['control', 'test'].includes(condition)) {
      throw new Error('Condition must be "control" or "test"');
    }

    const experiments = this._loadExperiments();
    const exp = experiments.find(e => e.id === experimentId);
    if (!exp) throw new Error('Experiment not found: ' + experimentId);
    if (exp.status !== 'running') throw new Error('Experiment not running');

    const observation = {
      id: uid(),
      condition,
      metrics,
      timestamp: now(),
    };

    exp.observations[condition].push(observation);

    // Also persist to observations log
    const allObs = this._loadObservations();
    allObs.push({ ...observation, experimentId });
    if (allObs.length > 5000) allObs.splice(0, allObs.length - 5000);
    this._saveObservations(allObs);

    // Budget check
    if (metrics._tokensUsed) {
      exp.tokensUsed += metrics._tokensUsed;
      if (exp.tokensUsed >= exp.tokenBudget) {
        exp.status = 'budget-exceeded';
        this.emit('budget-exceeded', { id: exp.id, tokensUsed: exp.tokensUsed, budget: exp.tokenBudget });
      }
    }

    this._saveExperiments(experiments);

    const totalObs = exp.observations.control.length + exp.observations.test.length;
    const targetTotal = exp.sampleSize * 2;

    this.emit('observation-recorded', {
      id: exp.id,
      condition,
      progress: `${totalObs}/${targetTotal}`,
    });

    return {
      experimentId: exp.id,
      condition,
      controlCount: exp.observations.control.length,
      testCount: exp.observations.test.length,
      targetPerCondition: exp.sampleSize,
    };
  }

  /**
   * Get which condition to assign next (balanced allocation).
   * @param {string} experimentId
   * @returns {'control'|'test'}
   */
  getNextCondition(experimentId) {
    const experiments = this._loadExperiments();
    const exp = experiments.find(e => e.id === experimentId);
    if (!exp) throw new Error('Experiment not found');

    const cLen = exp.observations.control.length;
    const tLen = exp.observations.test.length;

    // Balanced allocation with slight randomization
    if (cLen < tLen) return 'control';
    if (tLen < cLen) return 'test';
    return Math.random() < 0.5 ? 'control' : 'test';
  }

  // ── Statistical Analysis ──

  /**
   * Analyze results of an experiment.
   * @param {string} experimentId
   * @returns {object} Analysis results
   */
  analyzeResults(experimentId) {
    const experiments = this._loadExperiments();
    const exp = experiments.find(e => e.id === experimentId);
    if (!exp) throw new Error('Experiment not found: ' + experimentId);

    const control = exp.observations.control;
    const test = exp.observations.test;

    if (control.length < 3 || test.length < 3) {
      return { error: 'Insufficient data', controlN: control.length, testN: test.length, minRequired: 3 };
    }

    const analysis = { metrics: {}, overallConfidence: 0, recommendation: 'inconclusive', analyzedAt: now() };
    let totalConfidence = 0;
    let metricCount = 0;

    for (const metricDef of exp.metrics) {
      const name = metricDef.name;
      const controlValues = control.map(o => o.metrics[name]).filter(v => v != null && typeof v === 'number');
      const testValues = test.map(o => o.metrics[name]).filter(v => v != null && typeof v === 'number');

      if (controlValues.length < 2 || testValues.length < 2) continue;

      const stats = this._computeStats(controlValues, testValues, metricDef.higherIsBetter);
      analysis.metrics[name] = stats;
      totalConfidence += stats.confidence;
      metricCount++;
    }

    if (metricCount > 0) {
      analysis.overallConfidence = Math.round(totalConfidence / metricCount);

      // Determine recommendation
      const dominated = Object.values(analysis.metrics);
      const testWins = dominated.filter(m => m.winner === 'test').length;
      const controlWins = dominated.filter(m => m.winner === 'control').length;

      if (analysis.overallConfidence >= this.confidenceThreshold) {
        if (testWins > controlWins) analysis.recommendation = 'adopt_test';
        else if (controlWins > testWins) analysis.recommendation = 'keep_control';
        else analysis.recommendation = 'no_difference';
      }
    }

    exp.analysis = analysis;
    this._saveExperiments(experiments);

    this.emit('analysis-complete', { id: exp.id, confidence: analysis.overallConfidence, recommendation: analysis.recommendation });
    return analysis;
  }

  /**
   * Compute comparative statistics between two samples.
   * Uses Welch's t-test approximation for confidence.
   */
  _computeStats(controlVals, testVals, higherIsBetter) {
    const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
    const variance = (arr, m) => arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);

    const cMean = mean(controlVals);
    const tMean = mean(testVals);
    const cVar = variance(controlVals, cMean);
    const tVar = variance(testVals, tMean);
    const cN = controlVals.length;
    const tN = testVals.length;

    // Welch's t-statistic
    const se = Math.sqrt((cVar / cN) + (tVar / tN));
    const tStat = se > 0 ? Math.abs(tMean - cMean) / se : 0;

    // Approximate degrees of freedom (Welch-Satterthwaite)
    const num = ((cVar / cN) + (tVar / tN)) ** 2;
    const den = ((cVar / cN) ** 2 / (cN - 1)) + ((tVar / tN) ** 2 / (tN - 1));
    const df = den > 0 ? num / den : 1;

    // Approximate p-value using t-distribution CDF approximation
    const confidence = this._tToConfidence(tStat, df);

    const effectSize = se > 0 ? (tMean - cMean) / Math.sqrt((cVar + tVar) / 2) : 0; // Cohen's d

    let winner = 'none';
    if (confidence >= 60) {
      if (higherIsBetter) winner = tMean > cMean ? 'test' : 'control';
      else winner = tMean < cMean ? 'test' : 'control';
    }

    return {
      controlMean: Math.round(cMean * 1000) / 1000,
      testMean: Math.round(tMean * 1000) / 1000,
      controlN: cN,
      testN: tN,
      tStatistic: Math.round(tStat * 1000) / 1000,
      degreesOfFreedom: Math.round(df * 10) / 10,
      effectSize: Math.round(effectSize * 1000) / 1000,
      confidence,
      winner,
    };
  }

  /**
   * Approximate confidence % from t-statistic and degrees of freedom.
   * Uses a simple sigmoid approximation of the t-distribution CDF.
   */
  _tToConfidence(t, df) {
    // Approximation: as t grows, confidence approaches 100
    // Adjusts for degrees of freedom
    const adjusted = t * Math.sqrt(df / (df + 2));
    // Sigmoid-style mapping: t=0 → 50%, t=2 → ~90%, t=3 → ~97%
    const p = 1 / (1 + Math.exp(-0.7 * adjusted));
    // Convert to two-tailed confidence percentage
    const confidence = Math.round((2 * p - 1) * 100);
    return clamp(confidence, 0, 99);
  }

  // ── Finding Publication ──

  /**
   * Publish a finding from a concluded or analyzed experiment.
   * @param {string} experimentId
   * @returns {Promise<object>} Published finding
   */
  async publishFinding(experimentId) {
    const experiments = this._loadExperiments();
    const exp = experiments.find(e => e.id === experimentId);
    if (!exp) throw new Error('Experiment not found: ' + experimentId);
    if (!exp.analysis) throw new Error('Experiment not yet analyzed — call analyzeResults first');

    let conclusion = '';
    let implications = '';

    if (this.ai) {
      const messages = [
        {
          role: 'system',
          content: `You are SCIENTIST. Write a concise finding from this experiment.
Return JSON: { "conclusion": "...", "implications": "...", "actionItems": ["..."] }`
        },
        {
          role: 'user',
          content: `Hypothesis: ${exp.hypothesis}
Type: ${exp.type}
Control: ${exp.controlCondition.name} — ${exp.controlCondition.description}
Test: ${exp.testCondition.name} — ${exp.testCondition.description}
Analysis: ${JSON.stringify(exp.analysis, null, 2)}`
        }
      ];

      try {
        const data = await this.ai.callWithFallback(messages, null);
        const content = data.choices?.[0]?.message?.content || '{}';
        const match = content.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          conclusion = parsed.conclusion || '';
          implications = parsed.implications || '';
          var actionItems = parsed.actionItems || [];
        }
      } catch { /* use defaults */ }
    }

    const finding = {
      id: uid(),
      experimentId: exp.id,
      hypothesisId: exp.hypothesisId,
      hypothesis: exp.hypothesis,
      type: exp.type,
      conclusion: conclusion || `${exp.analysis.recommendation === 'adopt_test' ? 'Test condition outperformed control' : exp.analysis.recommendation === 'keep_control' ? 'Control condition was superior' : 'No significant difference found'}`,
      implications: implications || '',
      actionItems: actionItems || [],
      confidence: exp.analysis.overallConfidence,
      recommendation: exp.analysis.recommendation,
      metrics: exp.analysis.metrics,
      sampleSize: { control: exp.observations.control.length, test: exp.observations.test.length },
      publishedAt: now(),
      applied: false,
    };

    // Conclude experiment
    exp.status = 'concluded';
    exp.finding = finding.id;
    exp.concludedAt = now();
    this._saveExperiments(experiments);

    // Update hypothesis
    const hypotheses = this._loadHypotheses();
    const hyp = hypotheses.find(h => h.id === exp.hypothesisId);
    if (hyp) {
      hyp.status = exp.analysis.recommendation === 'adopt_test' ? 'confirmed' : exp.analysis.recommendation === 'keep_control' ? 'rejected' : 'tested';
      this._saveHypotheses(hypotheses);
    }

    // Save finding
    const findings = this._loadFindings();
    findings.push(finding);
    if (findings.length > MAX_HISTORY) findings.splice(0, findings.length - MAX_HISTORY);
    this._saveFindings(findings);

    this.emit('finding-published', { id: finding.id, conclusion: finding.conclusion, confidence: finding.confidence });
    return finding;
  }

  // ── Queries ──

  /**
   * Get all currently active (running) experiments.
   */
  getActiveExperiments() {
    return this._loadExperiments().filter(e => e.status === 'running');
  }

  /**
   * Get all experiments matching an optional filter.
   * @param {object} [filter] - { status, type, hypothesisId }
   */
  getExperiments(filter = {}) {
    let exps = this._loadExperiments();
    if (filter.status) exps = exps.filter(e => e.status === filter.status);
    if (filter.type) exps = exps.filter(e => e.type === filter.type);
    if (filter.hypothesisId) exps = exps.filter(e => e.hypothesisId === filter.hypothesisId);
    return exps;
  }

  /**
   * Get published findings with optional filter.
   * @param {object} [filter] - { type, minConfidence, applied }
   */
  getFindings(filter = {}) {
    let findings = this._loadFindings();
    if (filter.type) findings = findings.filter(f => f.type === filter.type);
    if (filter.minConfidence) findings = findings.filter(f => f.confidence >= filter.minConfidence);
    if (filter.applied != null) findings = findings.filter(f => f.applied === filter.applied);
    return findings;
  }

  /**
   * Get hypotheses with optional filter.
   * @param {object} [filter] - { status, type, minPriority }
   */
  getHypotheses(filter = {}) {
    let hyps = this._loadHypotheses();
    if (filter.status) hyps = hyps.filter(h => h.status === filter.status);
    if (filter.type) hyps = hyps.filter(h => h.type === filter.type);
    if (filter.minPriority) hyps = hyps.filter(h => h.priority >= filter.minPriority);
    return hyps;
  }

  /**
   * Mark a finding as applied (adopted into system behavior).
   * @param {string} findingId
   */
  applyFinding(findingId) {
    const findings = this._loadFindings();
    const f = findings.find(x => x.id === findingId);
    if (!f) throw new Error('Finding not found');
    f.applied = true;
    f.appliedAt = now();
    this._saveFindings(findings);
    this.emit('finding-applied', { id: f.id, conclusion: f.conclusion });
    return f;
  }

  /**
   * Abort a running experiment.
   * @param {string} experimentId
   * @param {string} [reason]
   */
  abortExperiment(experimentId, reason) {
    const experiments = this._loadExperiments();
    const exp = experiments.find(e => e.id === experimentId);
    if (!exp) throw new Error('Experiment not found');
    if (exp.status !== 'running') throw new Error('Experiment not running');
    exp.status = 'aborted';
    exp.concludedAt = now();
    exp.error = reason || 'Manually aborted';
    this._saveExperiments(experiments);
    this.emit('experiment-aborted', { id: exp.id, reason: exp.error });
    return exp;
  }

  // ── Meta-Experimentation ──

  /**
   * Generate a meta-experiment — experimenting on the experimentation process itself.
   * @param {object} [context] - Current engine performance data
   * @returns {Promise<object>} Meta-hypothesis
   */
  async generateMetaHypothesis(context = {}) {
    if (!this.ai) throw new Error('AI module required');

    const findings = this._loadFindings();
    const experiments = this._loadExperiments();
    const stats = {
      totalExperiments: experiments.length,
      concluded: experiments.filter(e => e.status === 'concluded').length,
      aborted: experiments.filter(e => e.status === 'aborted').length,
      avgConfidence: findings.length > 0 ? Math.round(findings.reduce((s, f) => s + f.confidence, 0) / findings.length) : 0,
      avgSampleSize: experiments.filter(e => e.status === 'concluded').length > 0
        ? Math.round(experiments.filter(e => e.status === 'concluded').reduce((s, e) => s + e.observations.control.length + e.observations.test.length, 0) / experiments.filter(e => e.status === 'concluded').length)
        : 0,
      ...context,
    };

    const messages = [
      {
        role: 'system',
        content: `You are META-SCIENTIST. You experiment on the experimentation process itself.
Given stats about how experiments have been running, propose a hypothesis about how to IMPROVE the scientific method being used.

Examples: "Increasing sample size from 30 to 50 improves finding confidence by 10%", "Running COGNITIVE experiments in parallel reduces total time without quality loss"

Return JSON: { "statement": "...", "type": "META", "rationale": "...", "expectedEffect": "...", "priority": 4 }`
      },
      { role: 'user', content: JSON.stringify(stats) }
    ];

    const data = await this.ai.callWithFallback(messages, null);
    const content = data.choices?.[0]?.message?.content || '{}';
    const match = content.match(/\{[\s\S]*\}/);
    let parsed;
    try { parsed = JSON.parse(match[0]); } catch { return null; }

    const metaHyp = {
      id: uid(),
      statement: parsed.statement || 'Meta-experiment hypothesis',
      type: 'META',
      rationale: parsed.rationale || '',
      expectedEffect: parsed.expectedEffect || '',
      priority: clamp(parsed.priority || 4, 1, 5),
      status: 'untested',
      createdAt: now(),
      experimentIds: [],
      isMeta: true,
    };

    const hypotheses = this._loadHypotheses();
    hypotheses.push(metaHyp);
    this._saveHypotheses(hypotheses);

    this.emit('meta-hypothesis-generated', metaHyp);
    return metaHyp;
  }

  // ── Tick (Periodic) ──

  /**
   * Periodic tick — check running experiments, auto-analyze/conclude mature ones.
   * @returns {object} Tick summary
   */
  async tick() {
    const experiments = this._loadExperiments();
    const summary = { checked: 0, analyzed: 0, concluded: 0, aborted: 0 };

    for (const exp of experiments) {
      if (exp.status !== 'running') continue;
      summary.checked++;

      const totalObs = exp.observations.control.length + exp.observations.test.length;
      const targetTotal = exp.sampleSize * 2;
      const elapsed = now() - exp.startedAt;

      // Budget exceeded
      if (exp.tokensUsed >= exp.tokenBudget) {
        exp.status = 'budget-exceeded';
        exp.concludedAt = now();
        exp.error = 'Token budget exceeded';
        summary.aborted++;
        this.emit('experiment-aborted', { id: exp.id, reason: 'budget-exceeded' });
        continue;
      }

      // Duration exceeded
      if (elapsed >= exp.maxDurationMs) {
        // Auto-analyze whatever we have if enough data
        if (totalObs >= 6) {
          try {
            this._saveExperiments(experiments); // save state before analysis
            this.analyzeResults(exp.id);
            summary.analyzed++;
            await this.publishFinding(exp.id);
            summary.concluded++;
          } catch {
            exp.status = 'aborted';
            exp.concludedAt = now();
            exp.error = 'Duration exceeded with insufficient data';
            summary.aborted++;
          }
        } else {
          exp.status = 'aborted';
          exp.concludedAt = now();
          exp.error = 'Duration exceeded with insufficient data';
          summary.aborted++;
        }
        continue;
      }

      // Auto-analyze at threshold
      if (totalObs >= targetTotal * this.autoAnalyzeThreshold && !exp.analysis) {
        try {
          this._saveExperiments(experiments);
          const analysis = this.analyzeResults(exp.id);
          summary.analyzed++;

          // Auto-conclude if we have enough samples and high confidence
          if (totalObs >= targetTotal && analysis.overallConfidence >= this.confidenceThreshold) {
            await this.publishFinding(exp.id);
            summary.concluded++;
          }
        } catch { /* not enough data yet, continue */ }
      }
    }

    this._saveExperiments(experiments);

    if (summary.analyzed > 0 || summary.concluded > 0 || summary.aborted > 0) {
      this.emit('tick', summary);
    }

    return summary;
  }

  // ── Summary / Dashboard ──

  /**
   * Get a high-level summary of the experiment engine state.
   */
  getSummary() {
    const experiments = this._loadExperiments();
    const findings = this._loadFindings();
    const hypotheses = this._loadHypotheses();

    return {
      hypotheses: {
        total: hypotheses.length,
        untested: hypotheses.filter(h => h.status === 'untested').length,
        testing: hypotheses.filter(h => h.status === 'testing').length,
        confirmed: hypotheses.filter(h => h.status === 'confirmed').length,
        rejected: hypotheses.filter(h => h.status === 'rejected').length,
      },
      experiments: {
        total: experiments.length,
        running: experiments.filter(e => e.status === 'running').length,
        pending: experiments.filter(e => e.status === 'pending').length,
        concluded: experiments.filter(e => e.status === 'concluded').length,
        aborted: experiments.filter(e => e.status === 'aborted').length,
      },
      findings: {
        total: findings.length,
        applied: findings.filter(f => f.applied).length,
        avgConfidence: findings.length > 0 ? Math.round(findings.reduce((s, f) => s + f.confidence, 0) / findings.length) : 0,
        byType: EXPERIMENT_TYPES.reduce((acc, t) => { acc[t] = findings.filter(f => f.type === t).length; return acc; }, {}),
      },
    };
  }
}

module.exports = { AutonomousExperimentEngine };
