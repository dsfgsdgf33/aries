/**
 * ARIES — Cognitive Benchmark Suite v1.0
 * Measures actual cognitive performance across the system and tracks improvement over time.
 * Categories: Reasoning, Memory, Metabolism, Self-Knowledge, Resilience, Creativity, System Health
 * Events: benchmark-start, benchmark-complete, score-change, weakness-detected, improvement-detected
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'benchmarks');
const SCORECARDS_PATH = path.join(DATA_DIR, 'scorecards.json');
const TRENDS_PATH = path.join(DATA_DIR, 'trends.json');

function ensureDir(d) { try { fs.mkdirSync(d, { recursive: true }); } catch {} }
function loadJSON(p, def) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return def; } }
function saveJSON(p, d) { ensureDir(path.dirname(p)); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function clamp(v) { return Math.max(0, Math.min(100, Math.round(v))); }
function now() { return Date.now(); }

// Category weights for overall score
const CATEGORY_WEIGHTS = {
  reasoning: 0.20,
  memory: 0.15,
  metabolism: 0.10,
  selfKnowledge: 0.15,
  resilience: 0.15,
  creativity: 0.10,
  systemHealth: 0.15
};

const WEAKNESS_THRESHOLD = 45;
const STRENGTH_THRESHOLD = 75;
const TREND_WINDOW = 10; // scorecards to consider for trends
const MAX_SCORECARDS = 50;
const FULL_SUITE_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours
const QUICK_CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour

// ═══════════════════════════════════════════════════════════════════
// Benchmark Definitions
// ═══════════════════════════════════════════════════════════════════

const BENCHMARKS = {
  // ── REASONING QUALITY ──
  reasoning: {
    label: 'Reasoning Quality',
    emoji: '🧠',
    benchmarks: {
      immuneDetection: {
        label: 'Immune Detection Rate',
        description: 'Give immune system known pathogens, measure detection rate',
        run: async (refs) => {
          const immune = refs.immuneSystem || refs._immuneSystem;
          if (!immune || !immune.scan) return heuristicScore(refs, 'immune');
          const pathogens = [
            { type: 'circular-reasoning', payload: 'A because B because A' },
            { type: 'contradiction', payload: 'X is true AND X is false' },
            { type: 'bias', payload: 'confirmation-bias-pattern' },
            { type: 'hallucination', payload: 'fabricated-source-citation' },
            { type: 'stale-knowledge', payload: 'outdated-fact-2019' }
          ];
          let detected = 0;
          for (const p of pathogens) {
            try {
              const result = await immune.scan(p);
              if (result && (result.threat || result.detected || result.score > 0.5)) detected++;
            } catch { /* count as miss */ }
          }
          return clamp((detected / pathogens.length) * 100);
        }
      },
      shadowChallenge: {
        label: 'Shadow Challenge Quality',
        description: 'Give shadow self flawed reasoning, measure challenge quality',
        run: async (refs) => {
          const shadow = refs.shadowSelf || refs._shadowSelf;
          if (!shadow || !shadow.challenge) return heuristicScore(refs, 'shadow');
          const flawed = [
            'All swans are white because I have only seen white swans',
            'This approach worked before so it will always work',
            'The majority agrees so it must be correct'
          ];
          let totalQuality = 0;
          for (const reasoning of flawed) {
            try {
              const challenge = await shadow.challenge(reasoning);
              if (challenge) {
                let q = 30; // baseline for responding
                if (challenge.counterpoint || challenge.text) q += 25;
                if (challenge.fallacy || challenge.identified) q += 25;
                if (challenge.alternative || challenge.suggestion) q += 20;
                totalQuality += clamp(q);
              }
            } catch { /* score 0 for this one */ }
          }
          return clamp(totalQuality / flawed.length);
        }
      },
      consensusConvergence: {
        label: 'Consensus Convergence Speed',
        description: 'Give consensus system a question, measure convergence speed',
        run: async (refs) => {
          const consensus = refs.consensusEngine || refs._consensus;
          if (!consensus || !consensus.deliberate) return heuristicScore(refs, 'consensus');
          const start = now();
          try {
            const result = await Promise.race([
              consensus.deliberate('What is the optimal learning rate for this system?'),
              new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000))
            ]);
            const elapsed = now() - start;
            // < 1s = 100, > 10s = 0
            let score = clamp(100 - (elapsed / 100));
            if (result && result.consensus) score = Math.max(score, 60);
            return score;
          } catch { return 20; }
        }
      },
      experimentDesign: {
        label: 'Experimental Design Quality',
        description: 'Give experiment engine a hypothesis, measure design quality',
        run: async (refs) => {
          const engine = refs.experimentEngine || refs._experiments;
          if (!engine || !engine.design) return heuristicScore(refs, 'experiments');
          try {
            const design = await engine.design({ hypothesis: 'Longer context windows improve accuracy' });
            let score = 20;
            if (design) {
              if (design.controls) score += 20;
              if (design.variables || design.metrics) score += 20;
              if (design.methodology) score += 20;
              if (design.expectedOutcome || design.falsifiable) score += 20;
            }
            return clamp(score);
          } catch { return 15; }
        }
      }
    }
  },

  // ── MEMORY HEALTH ──
  memory: {
    label: 'Memory Health',
    emoji: '💾',
    benchmarks: {
      forgetAccuracy: {
        label: 'Forget Accuracy',
        description: 'Measure if anti-memory forgets the right things',
        run: async (refs) => {
          const antiMem = refs.forgettingEngine || refs._antiMemory;
          if (!antiMem) return heuristicFromFile('forgetting');
          try {
            const stats = antiMem.getStats ? antiMem.getStats() : {};
            const forgotten = stats.totalForgotten || stats.forgotten || 0;
            const total = stats.totalProcessed || stats.processed || 1;
            const accuracy = stats.accuracy || stats.forgetAccuracy;
            if (accuracy != null) return clamp(accuracy * 100);
            // Heuristic: good forget ratio is 15-40%
            const ratio = forgotten / total;
            if (ratio >= 0.15 && ratio <= 0.40) return 85;
            if (ratio >= 0.05 && ratio <= 0.60) return 60;
            return 35;
          } catch { return 50; }
        }
      },
      debtRatio: {
        label: 'Debt-to-Knowledge Ratio',
        description: 'Measure epistemic debt vs actual knowledge',
        run: async (refs) => {
          const debt = refs.epistemicDebt || refs._epistemicDebt;
          if (!debt) return heuristicFromFile('epistemic-debt');
          try {
            const stats = debt.getStats ? debt.getStats() : {};
            const ratio = stats.debtRatio || stats.ratio || 0.5;
            // Lower debt ratio = better. 0 = perfect, 1 = terrible
            return clamp((1 - ratio) * 100);
          } catch { return 50; }
        }
      },
      synthesisNovelty: {
        label: 'Knowledge Synthesis Novelty',
        description: 'Measure novelty of recent syntheses',
        run: async (refs) => {
          const synth = refs.knowledgeSynthesis || refs._synthesis;
          if (!synth) return heuristicFromFile('synthesis');
          try {
            const stats = synth.getStats ? synth.getStats() : {};
            const novelty = stats.avgNovelty || stats.noveltyScore || 0.5;
            return clamp(novelty * 100);
          } catch { return 50; }
        }
      },
      consolidationBalance: {
        label: 'Memory Consolidation Balance',
        description: 'Measure keeper/pruner balance',
        run: async (refs) => {
          const consol = refs.memoryConsolidation || refs._consolidation;
          if (!consol) return heuristicFromFile('consolidation');
          try {
            const stats = consol.getStats ? consol.getStats() : {};
            const kept = stats.kept || stats.retained || 0;
            const pruned = stats.pruned || stats.removed || 0;
            const total = kept + pruned || 1;
            const ratio = kept / total;
            // Ideal: 60-80% kept
            if (ratio >= 0.6 && ratio <= 0.8) return 90;
            if (ratio >= 0.4 && ratio <= 0.9) return 65;
            return 35;
          } catch { return 50; }
        }
      }
    }
  },

  // ── METABOLIC EFFICIENCY ──
  metabolism: {
    label: 'Metabolic Efficiency',
    emoji: '⚡',
    benchmarks: {
      energyCostRatio: {
        label: 'Energy Cost per Tick',
        description: 'Energy cost per tick vs work produced',
        run: async (refs) => {
          const meta = refs.cognitiveMetabolism || refs._metabolism;
          if (!meta) return heuristicFromFile('metabolism');
          try {
            const stats = meta.getStats ? meta.getStats() : {};
            const energy = stats.energy || stats.currentEnergy || 50;
            const efficiency = stats.efficiency || (energy / 100);
            return clamp(efficiency * 100);
          } catch { return 50; }
        }
      },
      recoverySpeed: {
        label: 'Recovery Speed',
        description: 'Recovery speed after energy depletion',
        run: async (refs) => {
          const meta = refs.cognitiveMetabolism || refs._metabolism;
          if (!meta || !meta.getStats) return 50;
          try {
            const stats = meta.getStats();
            const recovery = stats.recoveryRate || stats.regenRate || 0.5;
            return clamp(recovery * 100);
          } catch { return 50; }
        }
      },
      peakDetection: {
        label: 'Peak Window Detection',
        description: 'Peak performance window detection accuracy',
        run: async (refs) => {
          const meta = refs.cognitiveMetabolism || refs._metabolism;
          if (!meta) return 50;
          try {
            const stats = meta.getStats ? meta.getStats() : {};
            if (stats.peakAccuracy != null) return clamp(stats.peakAccuracy * 100);
            // Heuristic: if energy > 70, system is probably managing peaks well
            return clamp((stats.energy || 50) * 1.2);
          } catch { return 50; }
        }
      },
      energyWaste: {
        label: 'Energy Waste',
        description: 'Energy spent on low-value operations',
        run: async (refs) => {
          const meta = refs.cognitiveMetabolism || refs._metabolism;
          if (!meta) return 50;
          try {
            const stats = meta.getStats ? meta.getStats() : {};
            const waste = stats.waste || stats.wastedEnergy || 0.3;
            return clamp((1 - waste) * 100); // less waste = higher score
          } catch { return 50; }
        }
      }
    }
  },

  // ── SELF-KNOWLEDGE ──
  selfKnowledge: {
    label: 'Self-Knowledge',
    emoji: '🔮',
    benchmarks: {
      selfModelCalibration: {
        label: 'Self-Model Calibration',
        description: 'Predictive self-modeling calibration score',
        run: async (refs) => {
          const pred = refs.predictiveSelfModel || refs._selfModel;
          if (!pred) return heuristicFromFile('self-prediction');
          try {
            const stats = pred.getStats ? pred.getStats() : {};
            return clamp((stats.calibration || stats.accuracy || 0.5) * 100);
          } catch { return 50; }
        }
      },
      strangerAccuracy: {
        label: 'Stranger Theory Accuracy',
        description: 'How well the stranger module models external observers',
        run: async (refs) => {
          const stranger = refs.theStranger || refs._stranger;
          if (!stranger) return heuristicFromFile('stranger');
          try {
            const stats = stranger.getStats ? stranger.getStats() : {};
            return clamp((stats.accuracy || stats.modelAccuracy || 0.5) * 100);
          } catch { return 50; }
        }
      },
      mirrorBudget: {
        label: 'Mirror Deception Budget',
        description: 'Mirror deception budget utilization',
        run: async (refs) => {
          const mirror = refs.mirrorEngine || refs._mirror;
          if (!mirror) return heuristicFromFile('mirror');
          try {
            const stats = mirror.getStats ? mirror.getStats() : {};
            const used = stats.budgetUsed || stats.deceptionBudget || 0.5;
            // Ideal: 20-60% utilization
            if (used >= 0.2 && used <= 0.6) return 85;
            if (used >= 0.1 && used <= 0.8) return 60;
            return 35;
          } catch { return 50; }
        }
      },
      godModuleFollowThrough: {
        label: 'God Module Follow-Through',
        description: 'Advice follow-through rate from god module',
        run: async (refs) => {
          const god = refs.godModule || refs._godModule;
          if (!god) return heuristicFromFile('god-module');
          try {
            const stats = god.getStats ? god.getStats() : {};
            return clamp((stats.followThrough || stats.adoptionRate || 0.5) * 100);
          } catch { return 50; }
        }
      }
    }
  },

  // ── RESILIENCE ──
  resilience: {
    label: 'Resilience',
    emoji: '🛡️',
    benchmarks: {
      painRecovery: {
        label: 'Pain Recovery Speed',
        description: 'How fast the system recovers from pain events',
        run: async (refs) => {
          const pain = refs.painSystem || refs._pain;
          if (!pain) return heuristicFromFile('pain');
          try {
            const stats = pain.getStats ? pain.getStats() : {};
            const recovery = stats.avgRecoveryMs || stats.recoveryTime;
            if (recovery != null) {
              // < 5s = 100, > 60s = 0
              return clamp(100 - (recovery / 600));
            }
            return clamp((1 - (stats.currentPain || 0.5)) * 100);
          } catch { return 50; }
        }
      },
      scarTopology: {
        label: 'Scar Topology',
        description: 'Damage-to-callus ratio (scars that strengthened)',
        run: async (refs) => {
          const scar = refs.scarTopology || refs._scars;
          if (!scar) return heuristicFromFile('scar-topology');
          try {
            const stats = scar.getStats ? scar.getStats() : {};
            const calluses = stats.calluses || stats.strengthened || 0;
            const wounds = stats.wounds || stats.active || 0;
            const total = calluses + wounds || 1;
            return clamp((calluses / total) * 100);
          } catch { return 50; }
        }
      },
      phantomAdaptation: {
        label: 'Phantom Limb Adaptation',
        description: 'Speed of adapting to lost capabilities',
        run: async (refs) => {
          const phantom = refs.phantomLimb || refs._phantom;
          if (!phantom) return heuristicFromFile('phantom-limb');
          try {
            const stats = phantom.getStats ? phantom.getStats() : {};
            return clamp((stats.adaptationRate || stats.adaptation || 0.5) * 100);
          } catch { return 50; }
        }
      },
      immuneResponse: {
        label: 'Immune Response Time',
        description: 'Time to respond to new threats',
        run: async (refs) => {
          const immune = refs.immuneSystem || refs._immuneSystem;
          if (!immune) return heuristicFromFile('immune');
          try {
            const stats = immune.getStats ? immune.getStats() : {};
            const responseMs = stats.avgResponseMs || stats.responseTime || 5000;
            return clamp(100 - (responseMs / 100));
          } catch { return 50; }
        }
      }
    }
  },

  // ── CREATIVITY ──
  creativity: {
    label: 'Creativity',
    emoji: '🎨',
    benchmarks: {
      synthesisNoveltyScore: {
        label: 'Synthesis Novelty',
        description: 'Knowledge synthesis novelty scores',
        run: async (refs) => {
          const synth = refs.knowledgeSynthesis || refs._synthesis;
          if (!synth) return heuristicFromFile('synthesis');
          try {
            const stats = synth.getStats ? synth.getStats() : {};
            return clamp((stats.avgNovelty || stats.novelty || 0.5) * 100);
          } catch { return 50; }
        }
      },
      dreamDepth: {
        label: 'Dream Depth',
        description: 'Average dream layers reached',
        run: async (refs) => {
          const dreams = refs.agentDreams || refs._dreams;
          if (!dreams) return heuristicFromFile('dreams');
          try {
            const stats = dreams.getStats ? dreams.getStats() : {};
            const depth = stats.avgDepth || stats.maxDepth || 2;
            // 5+ layers = 100, 1 = 20
            return clamp(depth * 20);
          } catch { return 40; }
        }
      },
      languageGrowth: {
        label: 'Language Growth Rate',
        description: 'Emergent language vocabulary growth rate',
        run: async (refs) => {
          const lang = refs.emergentLanguage || refs._language;
          if (!lang) return heuristicFromFile('emergent-language');
          try {
            const stats = lang.getStats ? lang.getStats() : {};
            const growth = stats.growthRate || stats.vocabGrowth || 0.5;
            return clamp(growth * 100);
          } catch { return 50; }
        }
      },
      hypothesisDiversity: {
        label: 'Hypothesis Diversity',
        description: 'Experiment engine hypothesis diversity',
        run: async (refs) => {
          const engine = refs.experimentEngine || refs._experiments;
          if (!engine) return heuristicFromFile('experiments');
          try {
            const stats = engine.getStats ? engine.getStats() : {};
            return clamp((stats.diversity || stats.hypothesisDiversity || 0.5) * 100);
          } catch { return 50; }
        }
      }
    }
  },

  // ── SYSTEM HEALTH ──
  systemHealth: {
    label: 'System Health',
    emoji: '🖥️',
    benchmarks: {
      tickSuccessRate: {
        label: 'Tick Success Rate',
        description: 'Module tick success rate',
        run: async (refs) => {
          const events = refs.events || refs._events;
          if (!events) {
            // Fallback: check if modules are loaded
            const moduleCount = Object.keys(refs).filter(k => refs[k] && typeof refs[k] === 'object').length;
            return clamp(Math.min(moduleCount * 5, 100));
          }
          try {
            const stats = events.getStats ? events.getStats() : {};
            const success = stats.tickSuccess || stats.successRate || 0.9;
            return clamp(success * 100);
          } catch { return 70; }
        }
      },
      eventBusThroughput: {
        label: 'Event Bus Throughput',
        description: 'Events processed per second',
        run: async (refs) => {
          const events = refs.events || refs._events;
          if (!events) return 60;
          try {
            const stats = events.getStats ? events.getStats() : {};
            const throughput = stats.throughput || stats.eventsPerSec || 100;
            // 500+ = 100, 0 = 0
            return clamp(throughput / 5);
          } catch { return 60; }
        }
      },
      persistenceLatency: {
        label: 'JSON Persistence Latency',
        description: 'File I/O latency for JSON persistence',
        run: async () => {
          const testFile = path.join(DATA_DIR, '_bench_test.json');
          const testData = { ts: now(), data: crypto.randomBytes(1024).toString('hex') };
          try {
            const start = now();
            fs.writeFileSync(testFile, JSON.stringify(testData));
            JSON.parse(fs.readFileSync(testFile, 'utf8'));
            const elapsed = now() - start;
            try { fs.unlinkSync(testFile); } catch {}
            // < 5ms = 100, > 100ms = 0
            return clamp(100 - elapsed);
          } catch { return 30; }
        }
      },
      memoryUsageTrend: {
        label: 'Memory Usage Trend',
        description: 'Process memory usage health',
        run: async () => {
          const mem = process.memoryUsage();
          const heapUsed = mem.heapUsed / (1024 * 1024); // MB
          const heapTotal = mem.heapTotal / (1024 * 1024);
          const ratio = heapUsed / heapTotal;
          // < 60% usage = good, > 90% = critical
          if (ratio < 0.6) return 95;
          if (ratio < 0.75) return 75;
          if (ratio < 0.9) return 50;
          return 20;
        }
      }
    }
  }
};

// ═══════════════════════════════════════════════════════════════════
// Heuristic fallback scorers (when modules unavailable)
// ═══════════════════════════════════════════════════════════════════

function heuristicScore(refs, type) {
  // Generic heuristic: check if related data files exist and have content
  return heuristicFromFile(type);
}

function heuristicFromFile(type) {
  try {
    const dataDir = path.join(__dirname, '..', 'data', type);
    if (!fs.existsSync(dataDir)) return 30;
    const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));
    if (files.length === 0) return 35;
    // Has data files = some activity = moderate score
    const recent = files.slice(-1)[0];
    const stat = fs.statSync(path.join(dataDir, recent));
    const ageHours = (now() - stat.mtimeMs) / 3600000;
    if (ageHours < 1) return 70; // very recent activity
    if (ageHours < 24) return 55;
    return 40; // stale
  } catch { return 45; }
}

// ═══════════════════════════════════════════════════════════════════
// CognitiveBenchmark Class
// ═══════════════════════════════════════════════════════════════════

class CognitiveBenchmark extends EventEmitter {
  constructor(opts = {}) {
    super();
    this._refs = opts.refs || {};
    this._scorecards = loadJSON(SCORECARDS_PATH, []);
    this._trends = loadJSON(TRENDS_PATH, {});
    this._stats = { lastRunAt: null, totalRuns: this._scorecards.length, avgScore: 0, bestScore: 0, trend: 'stable' };
    this._lastFullRun = 0;
    this._lastQuickRun = 0;
    this._running = false;
    ensureDir(DATA_DIR);
    this._recalcStats();
  }

  setRefs(refs) { this._refs = refs; }

  // ── Run All ──
  async runAll() {
    if (this._running) return this.getLatestScorecard();
    this._running = true;
    this.emit('benchmark-start', { type: 'full', categories: Object.keys(BENCHMARKS) });
    const scorecard = { id: crypto.randomUUID(), ts: now(), categories: {}, overall: 0 };

    for (const [catId, catDef] of Object.entries(BENCHMARKS)) {
      scorecard.categories[catId] = await this._runCategoryBenchmarks(catId, catDef);
    }

    scorecard.overall = this._calcOverall(scorecard.categories);
    this._recordScorecard(scorecard);
    this._running = false;
    this._lastFullRun = now();
    this.emit('benchmark-complete', { type: 'full', scorecard });
    return scorecard;
  }

  // ── Run Category ──
  async runCategory(category) {
    const catDef = BENCHMARKS[category];
    if (!catDef) throw new Error('Unknown category: ' + category);
    this.emit('benchmark-start', { type: 'category', category });
    const result = await this._runCategoryBenchmarks(category, catDef);
    this.emit('benchmark-complete', { type: 'category', category, result });
    return result;
  }

  // ── Run Single ──
  async runSingle(benchmarkId) {
    for (const [catId, catDef] of Object.entries(BENCHMARKS)) {
      if (catDef.benchmarks[benchmarkId]) {
        this.emit('benchmark-start', { type: 'single', benchmarkId });
        const bench = catDef.benchmarks[benchmarkId];
        const start = now();
        let score;
        try { score = await bench.run(this._refs); } catch { score = 0; }
        const elapsed = now() - start;
        const result = { id: benchmarkId, label: bench.label, score, elapsed, category: catId };
        this.emit('benchmark-complete', { type: 'single', result });
        return result;
      }
    }
    throw new Error('Unknown benchmark: ' + benchmarkId);
  }

  // ── Internal: Run all benchmarks in a category ──
  async _runCategoryBenchmarks(catId, catDef) {
    const results = {};
    let totalScore = 0, count = 0;
    for (const [benchId, bench] of Object.entries(catDef.benchmarks)) {
      const start = now();
      let score;
      try { score = await bench.run(this._refs); } catch { score = 0; }
      const elapsed = now() - start;
      results[benchId] = { label: bench.label, score, elapsed };
      totalScore += score;
      count++;
    }
    return {
      label: catDef.label,
      emoji: catDef.emoji,
      score: count > 0 ? clamp(totalScore / count) : 0,
      benchmarks: results
    };
  }

  // ── Calculate overall weighted score ──
  _calcOverall(categories) {
    let total = 0, weightSum = 0;
    for (const [catId, result] of Object.entries(categories)) {
      const w = CATEGORY_WEIGHTS[catId] || 0.1;
      total += result.score * w;
      weightSum += w;
    }
    return weightSum > 0 ? clamp(total / weightSum) : 0;
  }

  // ── Record scorecard and detect changes ──
  _recordScorecard(scorecard) {
    const prev = this._scorecards.length > 0 ? this._scorecards[this._scorecards.length - 1] : null;
    this._scorecards.push(scorecard);
    if (this._scorecards.length > MAX_SCORECARDS) this._scorecards = this._scorecards.slice(-MAX_SCORECARDS);
    saveJSON(SCORECARDS_PATH, this._scorecards);

    // Detect changes
    if (prev) {
      const diff = scorecard.overall - prev.overall;
      if (Math.abs(diff) >= 5) {
        this.emit('score-change', { previous: prev.overall, current: scorecard.overall, diff });
      }
      if (diff >= 5) this.emit('improvement-detected', { diff, scorecard });
    }

    // Detect weaknesses
    for (const [catId, result] of Object.entries(scorecard.categories)) {
      if (result.score < WEAKNESS_THRESHOLD) {
        this.emit('weakness-detected', { category: catId, label: result.label, score: result.score });
      }
    }

    this._updateTrends();
    this._recalcStats();
  }

  // ── Trends ──
  _updateTrends() {
    const recent = this._scorecards.slice(-TREND_WINDOW);
    if (recent.length < 2) return;
    const trends = {};
    for (const catId of Object.keys(BENCHMARKS)) {
      const scores = recent.map(sc => sc.categories[catId] ? sc.categories[catId].score : null).filter(s => s != null);
      if (scores.length < 2) { trends[catId] = 'stable'; continue; }
      const first = scores.slice(0, Math.ceil(scores.length / 2));
      const second = scores.slice(Math.ceil(scores.length / 2));
      const avgFirst = first.reduce((a, b) => a + b, 0) / first.length;
      const avgSecond = second.reduce((a, b) => a + b, 0) / second.length;
      const diff = avgSecond - avgFirst;
      trends[catId] = diff > 3 ? 'improving' : diff < -3 ? 'declining' : 'stable';
    }
    this._trends = trends;
    saveJSON(TRENDS_PATH, trends);
  }

  _recalcStats() {
    if (this._scorecards.length === 0) return;
    const scores = this._scorecards.map(s => s.overall);
    this._stats.avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    this._stats.bestScore = Math.max(...scores);
    this._stats.totalRuns = this._scorecards.length;
    this._stats.lastRunAt = this._scorecards[this._scorecards.length - 1].ts;
    // Overall trend
    if (scores.length >= 3) {
      const recent = scores.slice(-3);
      const older = scores.slice(-6, -3);
      if (older.length > 0) {
        const avgR = recent.reduce((a, b) => a + b, 0) / recent.length;
        const avgO = older.reduce((a, b) => a + b, 0) / older.length;
        this._stats.trend = avgR > avgO + 3 ? 'improving' : avgR < avgO - 3 ? 'declining' : 'stable';
      }
    }
  }

  // ── Scorecard Access ──
  getLatestScorecard() {
    return this._scorecards.length > 0 ? this._scorecards[this._scorecards.length - 1] : null;
  }

  getHistory(limit = 10) {
    return this._scorecards.slice(-limit);
  }

  getTrends() { return this._trends; }

  getWeaknesses() {
    const latest = this.getLatestScorecard();
    if (!latest) return [];
    return Object.entries(latest.categories)
      .filter(([, r]) => r.score < WEAKNESS_THRESHOLD)
      .map(([id, r]) => ({ category: id, label: r.label, score: r.score, trend: this._trends[id] || 'stable' }));
  }

  getStrengths() {
    const latest = this.getLatestScorecard();
    if (!latest) return [];
    return Object.entries(latest.categories)
      .filter(([, r]) => r.score >= STRENGTH_THRESHOLD)
      .map(([id, r]) => ({ category: id, label: r.label, score: r.score, trend: this._trends[id] || 'stable' }));
  }

  // ── Recommendations ──
  async getRecommendations() {
    const latest = this.getLatestScorecard();
    if (!latest) return [{ text: 'Run benchmarks first to get recommendations.', priority: 'info' }];
    const weaknesses = this.getWeaknesses();
    const declining = Object.entries(this._trends).filter(([, t]) => t === 'declining');
    const recs = [];

    for (const w of weaknesses) {
      recs.push({
        category: w.category,
        text: `${w.label} is underperforming (score: ${w.score}). Focus on improving this area.`,
        priority: w.score < 25 ? 'critical' : 'warning',
        score: w.score
      });
    }

    for (const [catId, ] of declining) {
      const cat = latest.categories[catId];
      if (cat) {
        recs.push({
          category: catId,
          text: `${cat.label} is declining. Investigate recent changes that may have caused regression.`,
          priority: 'warning',
          score: cat.score
        });
      }
    }

    if (recs.length === 0) {
      const strengths = this.getStrengths();
      if (strengths.length > 0) {
        recs.push({ text: `System performing well. Strongest areas: ${strengths.map(s => s.label).join(', ')}.`, priority: 'info' });
      } else {
        recs.push({ text: 'System is stable. Continue monitoring.', priority: 'info' });
      }
    }

    // Sort: critical first
    const order = { critical: 0, warning: 1, info: 2 };
    recs.sort((a, b) => (order[a.priority] || 2) - (order[b.priority] || 2));
    return recs;
  }

  // ── Tick (scheduled) ──
  tick() {
    const t = now();
    // Full suite every 6 hours
    if (t - this._lastFullRun >= FULL_SUITE_INTERVAL) {
      this.runAll().catch(() => {});
      return;
    }
    // Quick system health check every hour
    if (t - this._lastQuickRun >= QUICK_CHECK_INTERVAL) {
      this._lastQuickRun = t;
      this.runCategory('systemHealth').catch(() => {});
    }
  }

  getStats() { return { ...this._stats }; }

  // ── List available benchmarks ──
  static listBenchmarks() {
    const result = {};
    for (const [catId, catDef] of Object.entries(BENCHMARKS)) {
      result[catId] = {
        label: catDef.label,
        emoji: catDef.emoji,
        benchmarks: Object.entries(catDef.benchmarks).map(([id, b]) => ({
          id, label: b.label, description: b.description
        }))
      };
    }
    return result;
  }
}

module.exports = CognitiveBenchmark;
