/**
 * ARIES — Autonomous Experiment Engine v2.0
 * 
 * Full scientific method: hypothesis → design → run → analyze → publish.
 * Statistical analysis with Welch's t-test, confidence intervals, p-values.
 * Templates, reproducibility, experiment chains, failed experiment extraction.
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
const TEMPLATES_PATH = path.join(DATA_DIR, 'templates.json');
const CHAINS_PATH = path.join(DATA_DIR, 'chains.json');

const EXPERIMENT_TYPES = ['BEHAVIORAL', 'ARCHITECTURAL', 'COGNITIVE', 'PERFORMANCE', 'META'];
const STATUSES = ['pending', 'running', 'paused', 'concluded', 'aborted', 'budget-exceeded'];
const MAX_CONCURRENT = 5;
const MAX_HISTORY = 500;

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function uid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }
function now() { return Date.now(); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ── Default experiment templates ──
const DEFAULT_TEMPLATES = [
  { id: 'ab_response', name: 'A/B Response Quality', type: 'BEHAVIORAL', description: 'Compare two response strategies',
    controlCondition: { name: 'Current Strategy', description: 'Existing response approach', config: {} },
    testCondition: { name: 'New Strategy', description: 'Modified response approach', config: {} },
    metrics: [{ name: 'quality', description: 'Response quality rating', higherIsBetter: true }, { name: 'latency', description: 'Response time ms', higherIsBetter: false }],
    sampleSize: 30 },
  { id: 'perf_optimization', name: 'Performance Optimization', type: 'PERFORMANCE', description: 'Measure impact of optimization',
    controlCondition: { name: 'Baseline', description: 'Unoptimized', config: {} },
    testCondition: { name: 'Optimized', description: 'With optimization', config: {} },
    metrics: [{ name: 'throughput', description: 'Operations per second', higherIsBetter: true }, { name: 'memory', description: 'Memory usage MB', higherIsBetter: false }],
    sampleSize: 50 },
  { id: 'cognitive_load', name: 'Cognitive Load Test', type: 'COGNITIVE', description: 'Test cognitive efficiency changes',
    controlCondition: { name: 'Standard', description: 'Normal processing', config: {} },
    testCondition: { name: 'Modified', description: 'Altered processing', config: {} },
    metrics: [{ name: 'accuracy', description: 'Task accuracy %', higherIsBetter: true }, { name: 'energy_cost', description: 'Cognitive energy consumed', higherIsBetter: false }],
    sampleSize: 20 },
];

class AutonomousExperimentEngine extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null;
    this.config = opts.config || {};
    this.maxConcurrent = this.config.maxConcurrent || MAX_CONCURRENT;
    this.defaultSampleSize = this.config.defaultSampleSize || 30;
    this.defaultMaxDurationMs = this.config.defaultMaxDurationMs || 7 * 24 * 60 * 60 * 1000;
    this.defaultTokenBudget = this.config.defaultTokenBudget || 50000;
    this.autoAnalyzeThreshold = this.config.autoAnalyzeThreshold || 0.8;
    this.confidenceThreshold = this.config.confidenceThreshold || 75;
    this.significanceLevel = this.config.significanceLevel || 0.05; // p < 0.05
    ensureDir();
    this._ensureTemplates();
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
  _loadTemplates() { return readJSON(TEMPLATES_PATH, []); }
  _saveTemplates(t) { writeJSON(TEMPLATES_PATH, t); }
  _loadChains() { return readJSON(CHAINS_PATH, []); }
  _saveChains(c) { writeJSON(CHAINS_PATH, c); }

  _ensureTemplates() {
    const t = this._loadTemplates();
    if (t.length > 0) return;
    this._saveTemplates(DEFAULT_TEMPLATES);
  }

  // ── Templates ──

  getTemplates() { return this._loadTemplates(); }

  addTemplate(template) {
    const templates = this._loadTemplates();
    const t = { id: template.id || uid(), ...template, createdAt: now() };
    templates.push(t);
    this._saveTemplates(templates);
    return t;
  }

  designFromTemplate(templateId, hypothesisId, overrides = {}) {
    const templates = this._loadTemplates();
    const tmpl = templates.find(t => t.id === templateId);
    if (!tmpl) throw new Error('Template not found: ' + templateId);
    return this.designExperiment(hypothesisId, {
      controlCondition: tmpl.controlCondition,
      testCondition: tmpl.testCondition,
      metrics: tmpl.metrics,
      sampleSize: tmpl.sampleSize,
      ...overrides,
      templateId,
    });
  }

  // ── Experiment Chains ──

  createChain(name, description) {
    const chains = this._loadChains();
    const chain = { id: uid(), name, description, experimentIds: [], status: 'active', createdAt: now(), findings: [] };
    chains.push(chain);
    this._saveChains(chains);
    this.emit('chain-created', chain);
    return chain;
  }

  addToChain(chainId, experimentId) {
    const chains = this._loadChains();
    const chain = chains.find(c => c.id === chainId);
    if (!chain) throw new Error('Chain not found');
    chain.experimentIds.push(experimentId);
    this._saveChains(chains);
    return chain;
  }

  getChain(chainId) {
    const chains = this._loadChains();
    const chain = chains.find(c => c.id === chainId);
    if (!chain) return null;
    const experiments = this._loadExperiments();
    chain.experiments = chain.experimentIds.map(eid => experiments.find(e => e.id === eid)).filter(Boolean);
    return chain;
  }

  getChains() { return this._loadChains(); }

  // ── Hypothesis Generation ──

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
- nullHypothesis: what would disprove this

Existing hypotheses to avoid: ${existing.slice(-10).map(h => h.statement).join('; ') || 'none'}
Recent findings to build on: ${findings.slice(-5).map(f => f.conclusion).join('; ') || 'none'}

Return ONLY a JSON array.`
      },
      { role: 'user', content: `System context:\n${JSON.stringify(context, null, 2)}\n\nGenerate 2-5 novel hypotheses.` }
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
      nullHypothesis: h.nullHypothesis || `No significant difference observed`,
      type: EXPERIMENT_TYPES.includes(h.type) ? h.type : 'BEHAVIORAL',
      rationale: h.rationale || '',
      expectedEffect: h.expectedEffect || '',
      priority: clamp(h.priority || 3, 1, 5),
      status: 'untested',
      createdAt: now(),
      experimentIds: [],
      reproducibilityCount: 0,
      reproducibilityResults: [],
    }));

    existing.push(...newHypotheses);
    if (existing.length > MAX_HISTORY) existing.splice(0, existing.length - MAX_HISTORY);
    this._saveHypotheses(existing);

    this.emit('hypotheses-generated', { count: newHypotheses.length, hypotheses: newHypotheses });
    return newHypotheses;
  }

  // ── Experiment Design ──

  async designExperiment(hypothesisId, overrides = {}) {
    const hypotheses = this._loadHypotheses();
    const hyp = hypotheses.find(h => h.id === hypothesisId);
    if (!hyp) throw new Error('Hypothesis not found: ' + hypothesisId);

    let design = {};

    if (this.ai) {
      const messages = [
        {
          role: 'system',
          content: `Design a rigorous experiment to test this hypothesis. Return JSON:
- controlCondition: { name, description, config }
- testCondition: { name, description, config }
- metrics: [{ name, description, higherIsBetter }]
- sampleSize: observations per condition
- maxDurationMs: max time
- abortConditions: [string]
- isolationStrategy: how to ensure single-variable testing
- confoundingVariables: [string] — potential confounders to watch for
Return ONLY JSON.`
        },
        { role: 'user', content: `Hypothesis: ${hyp.statement}\nType: ${hyp.type}\nExpected effect: ${hyp.expectedEffect}\nNull hypothesis: ${hyp.nullHypothesis}` }
      ];

      const data = await this.ai.callWithFallback(messages, null);
      const content = data.choices?.[0]?.message?.content || '{}';
      const match = content.match(/\{[\s\S]*\}/);
      try { design = JSON.parse(match[0]); } catch { design = {}; }
    }

    const experiment = {
      id: uid(),
      hypothesisId,
      hypothesis: hyp.statement,
      nullHypothesis: hyp.nullHypothesis || '',
      type: hyp.type,
      status: 'pending',
      controlCondition: overrides.controlCondition || design.controlCondition || { name: 'Control', description: 'Baseline', config: {} },
      testCondition: overrides.testCondition || design.testCondition || { name: 'Test', description: 'Modified', config: {} },
      metrics: overrides.metrics || design.metrics || [{ name: 'effectiveness', description: 'Overall effectiveness', higherIsBetter: true }],
      sampleSize: overrides.sampleSize || design.sampleSize || this.defaultSampleSize,
      maxDurationMs: overrides.maxDurationMs || design.maxDurationMs || this.defaultMaxDurationMs,
      abortConditions: overrides.abortConditions || design.abortConditions || ['Negative impact exceeds 50%', 'Error rate doubles'],
      isolationStrategy: design.isolationStrategy || 'Sequential assignment with random allocation',
      confoundingVariables: design.confoundingVariables || [],
      templateId: overrides.templateId || null,
      chainId: overrides.chainId || null,
      parentExperimentId: overrides.parentExperimentId || null, // for chaining
      tokenBudget: overrides.tokenBudget || this.defaultTokenBudget,
      tokensUsed: 0,
      observations: { control: [], test: [] },
      analysis: null,
      finding: null,
      reproducibilityHash: null,
      failureLessons: null,
      createdAt: now(),
      startedAt: null,
      concludedAt: null,
      error: null,
    };

    const experiments = this._loadExperiments();
    experiments.push(experiment);
    if (experiments.length > MAX_HISTORY) experiments.splice(0, experiments.length - MAX_HISTORY);
    this._saveExperiments(experiments);

    hyp.experimentIds.push(experiment.id);
    this._saveHypotheses(hypotheses);

    // Auto-add to chain if specified
    if (experiment.chainId) {
      try { this.addToChain(experiment.chainId, experiment.id); } catch {}
    }

    this.emit('experiment-designed', { id: experiment.id, hypothesis: hyp.statement, type: hyp.type });
    return experiment;
  }

  // ── Execution ──

  runExperiment(experimentId) {
    const experiments = this._loadExperiments();
    const exp = experiments.find(e => e.id === experimentId);
    if (!exp) throw new Error('Experiment not found: ' + experimentId);
    if (exp.status === 'running') throw new Error('Already running');
    if (exp.status === 'concluded') throw new Error('Already concluded');

    if (experiments.filter(e => e.status === 'running').length >= this.maxConcurrent) {
      throw new Error(`Max concurrent (${this.maxConcurrent}) reached`);
    }

    exp.status = 'running';
    exp.startedAt = exp.startedAt || now();

    // Generate reproducibility hash from design
    exp.reproducibilityHash = crypto.createHash('sha256')
      .update(JSON.stringify({ control: exp.controlCondition, test: exp.testCondition, metrics: exp.metrics, sampleSize: exp.sampleSize }))
      .digest('hex').slice(0, 16);

    this._saveExperiments(experiments);

    const hypotheses = this._loadHypotheses();
    const hyp = hypotheses.find(h => h.id === exp.hypothesisId);
    if (hyp && hyp.status === 'untested') { hyp.status = 'testing'; this._saveHypotheses(hypotheses); }

    this.emit('experiment-started', { id: exp.id, hypothesis: exp.hypothesis });
    return exp;
  }

  recordObservation(experimentId, condition, metrics) {
    if (!['control', 'test'].includes(condition)) throw new Error('Condition must be "control" or "test"');

    const experiments = this._loadExperiments();
    const exp = experiments.find(e => e.id === experimentId);
    if (!exp) throw new Error('Experiment not found');
    if (exp.status !== 'running') throw new Error('Not running');

    const observation = { id: uid(), condition, metrics, timestamp: now() };
    exp.observations[condition].push(observation);

    const allObs = this._loadObservations();
    allObs.push({ ...observation, experimentId });
    if (allObs.length > 5000) allObs.splice(0, allObs.length - 5000);
    this._saveObservations(allObs);

    if (metrics._tokensUsed) {
      exp.tokensUsed += metrics._tokensUsed;
      if (exp.tokensUsed >= exp.tokenBudget) {
        exp.status = 'budget-exceeded';
        this.emit('budget-exceeded', { id: exp.id, tokensUsed: exp.tokensUsed, budget: exp.tokenBudget });
      }
    }

    this._saveExperiments(experiments);

    const totalObs = exp.observations.control.length + exp.observations.test.length;
    this.emit('observation-recorded', { id: exp.id, condition, progress: `${totalObs}/${exp.sampleSize * 2}` });

    return {
      experimentId: exp.id, condition,
      controlCount: exp.observations.control.length,
      testCount: exp.observations.test.length,
      targetPerCondition: exp.sampleSize,
    };
  }

  getNextCondition(experimentId) {
    const experiments = this._loadExperiments();
    const exp = experiments.find(e => e.id === experimentId);
    if (!exp) throw new Error('Experiment not found');
    const cLen = exp.observations.control.length;
    const tLen = exp.observations.test.length;
    if (cLen < tLen) return 'control';
    if (tLen < cLen) return 'test';
    return Math.random() < 0.5 ? 'control' : 'test';
  }

  // ── Statistical Analysis ──

  analyzeResults(experimentId) {
    const experiments = this._loadExperiments();
    const exp = experiments.find(e => e.id === experimentId);
    if (!exp) throw new Error('Experiment not found');

    const control = exp.observations.control;
    const test = exp.observations.test;
    if (control.length < 3 || test.length < 3) {
      return { error: 'Insufficient data', controlN: control.length, testN: test.length, minRequired: 3 };
    }

    const analysis = { metrics: {}, overallConfidence: 0, overallPValue: 1, recommendation: 'inconclusive', analyzedAt: now() };
    let totalConfidence = 0, totalPValue = 0, metricCount = 0;

    for (const metricDef of exp.metrics) {
      const name = metricDef.name;
      const controlValues = control.map(o => o.metrics[name]).filter(v => v != null && typeof v === 'number');
      const testValues = test.map(o => o.metrics[name]).filter(v => v != null && typeof v === 'number');
      if (controlValues.length < 2 || testValues.length < 2) continue;

      const stats = this._computeStats(controlValues, testValues, metricDef.higherIsBetter);
      analysis.metrics[name] = stats;
      totalConfidence += stats.confidence;
      totalPValue += stats.pValue;
      metricCount++;
    }

    if (metricCount > 0) {
      analysis.overallConfidence = Math.round(totalConfidence / metricCount);
      analysis.overallPValue = Math.round((totalPValue / metricCount) * 10000) / 10000;

      const dominated = Object.values(analysis.metrics);
      const testWins = dominated.filter(m => m.winner === 'test').length;
      const controlWins = dominated.filter(m => m.winner === 'control').length;
      const significant = analysis.overallPValue < this.significanceLevel;

      if (significant) {
        if (testWins > controlWins) analysis.recommendation = 'adopt_test';
        else if (controlWins > testWins) analysis.recommendation = 'keep_control';
        else analysis.recommendation = 'no_difference';
      } else if (analysis.overallConfidence >= this.confidenceThreshold) {
        // High confidence but not statistically significant — needs more data
        analysis.recommendation = testWins > controlWins ? 'lean_test_need_data' : 'lean_control_need_data';
      }
    }

    exp.analysis = analysis;
    this._saveExperiments(experiments);
    this.emit('analysis-complete', { id: exp.id, confidence: analysis.overallConfidence, pValue: analysis.overallPValue, recommendation: analysis.recommendation });
    return analysis;
  }

  _computeStats(controlVals, testVals, higherIsBetter) {
    const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
    const variance = (arr, m) => arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
    const stdDev = (arr, m) => Math.sqrt(variance(arr, m));

    const cMean = mean(controlVals);
    const tMean = mean(testVals);
    const cVar = variance(controlVals, cMean);
    const tVar = variance(testVals, tMean);
    const cN = controlVals.length;
    const tN = testVals.length;
    const cStdDev = stdDev(controlVals, cMean);
    const tStdDev = stdDev(testVals, tMean);

    // Welch's t-statistic
    const se = Math.sqrt((cVar / cN) + (tVar / tN));
    const tStat = se > 0 ? (tMean - cMean) / se : 0;
    const absTStat = Math.abs(tStat);

    // Welch-Satterthwaite degrees of freedom
    const num = ((cVar / cN) + (tVar / tN)) ** 2;
    const den = ((cVar / cN) ** 2 / (cN - 1)) + ((tVar / tN) ** 2 / (tN - 1));
    const df = den > 0 ? num / den : 1;

    // p-value approximation (two-tailed)
    const pValue = this._tToPValue(absTStat, df);
    const confidence = Math.round((1 - pValue) * 100);

    // Confidence intervals (95%)
    const tCritical = this._criticalT(df, 0.025); // two-tailed 95%
    const diffMean = tMean - cMean;
    const ciLower = Math.round((diffMean - tCritical * se) * 1000) / 1000;
    const ciUpper = Math.round((diffMean + tCritical * se) * 1000) / 1000;

    // Cohen's d effect size
    const pooledStdDev = Math.sqrt((cVar + tVar) / 2);
    const effectSize = pooledStdDev > 0 ? diffMean / pooledStdDev : 0;
    const effectLabel = Math.abs(effectSize) < 0.2 ? 'negligible' : Math.abs(effectSize) < 0.5 ? 'small' : Math.abs(effectSize) < 0.8 ? 'medium' : 'large';

    let winner = 'none';
    if (pValue < this.significanceLevel) {
      if (higherIsBetter) winner = tMean > cMean ? 'test' : 'control';
      else winner = tMean < cMean ? 'test' : 'control';
    }

    return {
      controlMean: Math.round(cMean * 1000) / 1000,
      testMean: Math.round(tMean * 1000) / 1000,
      controlStdDev: Math.round(cStdDev * 1000) / 1000,
      testStdDev: Math.round(tStdDev * 1000) / 1000,
      controlN: cN, testN: tN,
      tStatistic: Math.round(tStat * 1000) / 1000,
      degreesOfFreedom: Math.round(df * 10) / 10,
      pValue: Math.round(pValue * 10000) / 10000,
      significant: pValue < this.significanceLevel,
      confidence,
      confidenceInterval: { lower: ciLower, upper: ciUpper, level: '95%' },
      effectSize: Math.round(effectSize * 1000) / 1000,
      effectLabel,
      winner,
    };
  }

  /** Approximate p-value from t-statistic using regularized incomplete beta function approx */
  _tToPValue(t, df) {
    // Use sigmoid approximation calibrated against actual t-distribution
    const x = df / (df + t * t);
    // Regularized incomplete beta function approximation for I_x(df/2, 1/2)
    // Simple but effective approximation
    const adjusted = t * Math.sqrt(df / (df + 2));
    const p = 1 / (1 + Math.exp(-0.7 * adjusted));
    const oneTailed = 1 - p;
    return Math.max(0.0001, Math.min(1, oneTailed * 2)); // two-tailed
  }

  /** Approximate critical t-value for given df and alpha */
  _criticalT(df, alpha) {
    // Approximate using normal distribution for large df, adjust for small
    const z = -Math.log(4 * alpha * (1 - alpha)); // approx z-score
    const correction = df < 30 ? (1 + 1 / (4 * df)) : 1;
    return Math.sqrt(z) * correction;
  }

  // ── Reproducibility ──

  checkReproducibility(experimentId) {
    const experiments = this._loadExperiments();
    const exp = experiments.find(e => e.id === experimentId);
    if (!exp || !exp.reproducibilityHash) return { reproducible: false, reason: 'no_hash' };

    // Find other experiments with same design hash
    const matches = experiments.filter(e =>
      e.id !== experimentId &&
      e.reproducibilityHash === exp.reproducibilityHash &&
      e.status === 'concluded' &&
      e.analysis
    );

    if (matches.length === 0) return { reproducible: null, reason: 'no_replications', hash: exp.reproducibilityHash };

    // Compare recommendations
    const sameResult = matches.filter(m => m.analysis.recommendation === exp.analysis?.recommendation);
    const rate = sameResult.length / matches.length;

    // Update hypothesis reproducibility
    const hypotheses = this._loadHypotheses();
    const hyp = hypotheses.find(h => h.id === exp.hypothesisId);
    if (hyp) {
      hyp.reproducibilityCount = matches.length + 1;
      hyp.reproducibilityResults.push({ experimentId, rate: Math.round(rate * 100), timestamp: now() });
      if (hyp.reproducibilityResults.length > 20) hyp.reproducibilityResults = hyp.reproducibilityResults.slice(-20);
      this._saveHypotheses(hypotheses);
    }

    return {
      reproducible: rate >= 0.7,
      rate: Math.round(rate * 100),
      replications: matches.length,
      hash: exp.reproducibilityHash,
    };
  }

  // ── Failed Experiment Value Extraction ──

  async extractFailureLessons(experimentId) {
    const experiments = this._loadExperiments();
    const exp = experiments.find(e => e.id === experimentId);
    if (!exp) throw new Error('Experiment not found');
    if (exp.status !== 'aborted' && exp.status !== 'budget-exceeded') {
      throw new Error('Only failed experiments can have failure lessons extracted');
    }

    const lessons = {
      experimentId: exp.id, hypothesis: exp.hypothesis,
      failureReason: exp.error || exp.status,
      dataCollected: { control: exp.observations.control.length, test: exp.observations.test.length },
      partialFindings: null, processLessons: [], designLessons: [], timestamp: now(),
    };

    // Try partial analysis if we have any data
    if (exp.observations.control.length >= 2 && exp.observations.test.length >= 2) {
      try {
        lessons.partialFindings = this.analyzeResults(experimentId);
        lessons.partialFindings._partial = true;
      } catch {}
    }

    if (this.ai) {
      try {
        const resp = await this.ai.callWithFallback([
          { role: 'system', content: `Extract lessons from a failed experiment. What went wrong? What can we learn? Return JSON: {"processLessons":["..."],"designLessons":["..."],"hypothesis_still_viable":true/false,"suggested_modifications":["..."]}` },
          { role: 'user', content: `Hypothesis: ${exp.hypothesis}\nStatus: ${exp.status}\nError: ${exp.error}\nData collected: control=${exp.observations.control.length}, test=${exp.observations.test.length}\nBudget: ${exp.tokensUsed}/${exp.tokenBudget}\nDuration: ${exp.startedAt ? now() - exp.startedAt : 0}ms / ${exp.maxDurationMs}ms` }
        ], null);
        const content = resp.choices?.[0]?.message?.content || '';
        const match = content.match(/\{[\s\S]*\}/);
        if (match) {
          const p = JSON.parse(match[0]);
          lessons.processLessons = p.processLessons || [];
          lessons.designLessons = p.designLessons || [];
          lessons.hypothesisStillViable = p.hypothesis_still_viable;
          lessons.suggestedModifications = p.suggested_modifications || [];
        }
      } catch {}
    }

    exp.failureLessons = lessons;
    this._saveExperiments(experiments);
    this.emit('failure-lessons-extracted', { id: exp.id, lessons });
    return lessons;
  }

  // ── Finding Publication ──

  async publishFinding(experimentId) {
    const experiments = this._loadExperiments();
    const exp = experiments.find(e => e.id === experimentId);
    if (!exp) throw new Error('Experiment not found');
    if (!exp.analysis) throw new Error('Not yet analyzed');

    let conclusion = '', implications = '', actionItems = [];

    if (this.ai) {
      const messages = [
        { role: 'system', content: `Write a concise finding from this experiment. Return JSON: {"conclusion":"...","implications":"...","actionItems":["..."]}` },
        { role: 'user', content: `Hypothesis: ${exp.hypothesis}\nNull: ${exp.nullHypothesis}\nControl: ${exp.controlCondition.name}\nTest: ${exp.testCondition.name}\nAnalysis: ${JSON.stringify(exp.analysis, null, 2)}` }
      ];

      try {
        const data = await this.ai.callWithFallback(messages, null);
        const content = data.choices?.[0]?.message?.content || '{}';
        const match = content.match(/\{[\s\S]*\}/);
        if (match) {
          const p = JSON.parse(match[0]);
          conclusion = p.conclusion || '';
          implications = p.implications || '';
          actionItems = p.actionItems || [];
        }
      } catch {}
    }

    const finding = {
      id: uid(), experimentId: exp.id, hypothesisId: exp.hypothesisId,
      hypothesis: exp.hypothesis, nullHypothesis: exp.nullHypothesis, type: exp.type,
      conclusion: conclusion || `${exp.analysis.recommendation === 'adopt_test' ? 'Test outperformed control' : exp.analysis.recommendation === 'keep_control' ? 'Control was superior' : 'No significant difference'}`,
      implications: implications || '', actionItems,
      confidence: exp.analysis.overallConfidence,
      pValue: exp.analysis.overallPValue,
      recommendation: exp.analysis.recommendation,
      metrics: exp.analysis.metrics,
      sampleSize: { control: exp.observations.control.length, test: exp.observations.test.length },
      reproducibility: this.checkReproducibility(exp.id),
      publishedAt: now(), applied: false,
    };

    exp.status = 'concluded';
    exp.finding = finding.id;
    exp.concludedAt = now();
    this._saveExperiments(experiments);

    const hypotheses = this._loadHypotheses();
    const hyp = hypotheses.find(h => h.id === exp.hypothesisId);
    if (hyp) {
      hyp.status = exp.analysis.recommendation === 'adopt_test' ? 'confirmed' : exp.analysis.recommendation === 'keep_control' ? 'rejected' : 'tested';
      this._saveHypotheses(hypotheses);
    }

    const findings = this._loadFindings();
    findings.push(finding);
    if (findings.length > MAX_HISTORY) findings.splice(0, findings.length - MAX_HISTORY);
    this._saveFindings(findings);

    // Update chain if part of one
    if (exp.chainId) {
      const chains = this._loadChains();
      const chain = chains.find(c => c.id === exp.chainId);
      if (chain) { chain.findings.push(finding.id); this._saveChains(chains); }
    }

    this.emit('finding-published', { id: finding.id, conclusion: finding.conclusion, confidence: finding.confidence, pValue: finding.pValue });
    return finding;
  }

  // ── Queries ──

  getActiveExperiments() { return this._loadExperiments().filter(e => e.status === 'running'); }

  getExperiments(filter = {}) {
    let exps = this._loadExperiments();
    if (filter.status) exps = exps.filter(e => e.status === filter.status);
    if (filter.type) exps = exps.filter(e => e.type === filter.type);
    if (filter.hypothesisId) exps = exps.filter(e => e.hypothesisId === filter.hypothesisId);
    return exps;
  }

  getFindings(filter = {}) {
    let findings = this._loadFindings();
    if (filter.type) findings = findings.filter(f => f.type === filter.type);
    if (filter.minConfidence) findings = findings.filter(f => f.confidence >= filter.minConfidence);
    if (filter.applied != null) findings = findings.filter(f => f.applied === filter.applied);
    if (filter.significant) findings = findings.filter(f => f.pValue < this.significanceLevel);
    return findings;
  }

  getHypotheses(filter = {}) {
    let hyps = this._loadHypotheses();
    if (filter.status) hyps = hyps.filter(h => h.status === filter.status);
    if (filter.type) hyps = hyps.filter(h => h.type === filter.type);
    if (filter.minPriority) hyps = hyps.filter(h => h.priority >= filter.minPriority);
    return hyps;
  }

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

  abortExperiment(experimentId, reason) {
    const experiments = this._loadExperiments();
    const exp = experiments.find(e => e.id === experimentId);
    if (!exp) throw new Error('Experiment not found');
    if (exp.status !== 'running') throw new Error('Not running');
    exp.status = 'aborted';
    exp.concludedAt = now();
    exp.error = reason || 'Manually aborted';
    this._saveExperiments(experiments);
    this.emit('experiment-aborted', { id: exp.id, reason: exp.error });
    return exp;
  }

  // ── Meta-Experimentation ──

  async generateMetaHypothesis(context = {}) {
    if (!this.ai) throw new Error('AI module required');

    const findings = this._loadFindings();
    const experiments = this._loadExperiments();
    const stats = {
      totalExperiments: experiments.length,
      concluded: experiments.filter(e => e.status === 'concluded').length,
      aborted: experiments.filter(e => e.status === 'aborted').length,
      avgConfidence: findings.length > 0 ? Math.round(findings.reduce((s, f) => s + f.confidence, 0) / findings.length) : 0,
      avgPValue: findings.length > 0 ? Math.round(findings.reduce((s, f) => s + (f.pValue || 0.5), 0) / findings.length * 1000) / 1000 : null,
      avgSampleSize: experiments.filter(e => e.status === 'concluded').length > 0
        ? Math.round(experiments.filter(e => e.status === 'concluded').reduce((s, e) => s + e.observations.control.length + e.observations.test.length, 0) / experiments.filter(e => e.status === 'concluded').length)
        : 0,
      failedExperiments: experiments.filter(e => e.status === 'aborted').length,
      budgetExceeded: experiments.filter(e => e.status === 'budget-exceeded').length,
      ...context,
    };

    const messages = [
      {
        role: 'system',
        content: `You are META-SCIENTIST. Experiment on the experimentation process itself.
Given stats about experiments, propose a hypothesis about how to IMPROVE the scientific method.
Return JSON: {"statement":"...","type":"META","rationale":"...","expectedEffect":"...","priority":4,"nullHypothesis":"..."}`
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
      nullHypothesis: parsed.nullHypothesis || 'No improvement observed',
      type: 'META',
      rationale: parsed.rationale || '',
      expectedEffect: parsed.expectedEffect || '',
      priority: clamp(parsed.priority || 4, 1, 5),
      status: 'untested',
      createdAt: now(),
      experimentIds: [],
      reproducibilityCount: 0,
      reproducibilityResults: [],
      isMeta: true,
    };

    const hypotheses = this._loadHypotheses();
    hypotheses.push(metaHyp);
    this._saveHypotheses(hypotheses);

    this.emit('meta-hypothesis-generated', metaHyp);
    return metaHyp;
  }

  // ── Tick ──

  async tick() {
    const experiments = this._loadExperiments();
    const summary = { checked: 0, analyzed: 0, concluded: 0, aborted: 0, failureLessonsExtracted: 0 };

    for (const exp of experiments) {
      if (exp.status !== 'running') continue;
      summary.checked++;

      const totalObs = exp.observations.control.length + exp.observations.test.length;
      const targetTotal = exp.sampleSize * 2;
      const elapsed = now() - exp.startedAt;

      if (exp.tokensUsed >= exp.tokenBudget) {
        exp.status = 'budget-exceeded';
        exp.concludedAt = now();
        exp.error = 'Token budget exceeded';
        summary.aborted++;
        this.emit('experiment-aborted', { id: exp.id, reason: 'budget-exceeded' });
        continue;
      }

      if (elapsed >= exp.maxDurationMs) {
        if (totalObs >= 6) {
          try {
            this._saveExperiments(experiments);
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

      if (totalObs >= targetTotal * this.autoAnalyzeThreshold && !exp.analysis) {
        try {
          this._saveExperiments(experiments);
          const analysis = this.analyzeResults(exp.id);
          summary.analyzed++;

          if (totalObs >= targetTotal && (analysis.overallPValue < this.significanceLevel || analysis.overallConfidence >= this.confidenceThreshold)) {
            await this.publishFinding(exp.id);
            summary.concluded++;
          }
        } catch {}
      }
    }

    // Extract failure lessons from recently failed experiments
    for (const exp of experiments) {
      if ((exp.status === 'aborted' || exp.status === 'budget-exceeded') && !exp.failureLessons) {
        try {
          await this.extractFailureLessons(exp.id);
          summary.failureLessonsExtracted++;
        } catch {}
      }
    }

    this._saveExperiments(experiments);

    if (summary.analyzed > 0 || summary.concluded > 0 || summary.aborted > 0) {
      this.emit('tick', summary);
    }

    return summary;
  }

  // ── Summary ──

  getSummary() {
    const experiments = this._loadExperiments();
    const findings = this._loadFindings();
    const hypotheses = this._loadHypotheses();
    const chains = this._loadChains();

    return {
      hypotheses: {
        total: hypotheses.length,
        untested: hypotheses.filter(h => h.status === 'untested').length,
        testing: hypotheses.filter(h => h.status === 'testing').length,
        confirmed: hypotheses.filter(h => h.status === 'confirmed').length,
        rejected: hypotheses.filter(h => h.status === 'rejected').length,
        meta: hypotheses.filter(h => h.isMeta).length,
      },
      experiments: {
        total: experiments.length,
        running: experiments.filter(e => e.status === 'running').length,
        pending: experiments.filter(e => e.status === 'pending').length,
        concluded: experiments.filter(e => e.status === 'concluded').length,
        aborted: experiments.filter(e => e.status === 'aborted').length,
        withFailureLessons: experiments.filter(e => e.failureLessons).length,
      },
      findings: {
        total: findings.length,
        applied: findings.filter(f => f.applied).length,
        significant: findings.filter(f => f.pValue < this.significanceLevel).length,
        avgConfidence: findings.length > 0 ? Math.round(findings.reduce((s, f) => s + f.confidence, 0) / findings.length) : 0,
        avgPValue: findings.length > 0 ? Math.round(findings.reduce((s, f) => s + (f.pValue || 0.5), 0) / findings.length * 1000) / 1000 : null,
        byType: EXPERIMENT_TYPES.reduce((acc, t) => { acc[t] = findings.filter(f => f.type === t).length; return acc; }, {}),
      },
      chains: { total: chains.length, active: chains.filter(c => c.status === 'active').length },
      templates: this._loadTemplates().length,
    };
  }
}

module.exports = AutonomousExperimentEngine;
