// ============================================================================
// Aries Swarm Intelligence — core/swarm-intelligence.js
// Workers share discoveries. If one finds better algo/pool/config, all benefit.
// ============================================================================

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'swarm-intelligence.json');

class SwarmIntelligence extends EventEmitter {
  constructor(opts) {
    super();
    this.swarmRelay = opts.swarmRelay || null;
    this.knownWorkers = opts.knownWorkers || {};
    this.autoOptimizeEnabled = false;
    this._autoOptimizeInterval = null;
    this.db = {
      algos: {},
      pools: {},
      cpuProfiles: {},
      solutions: {},
      consensus: { bestAlgo: null, bestPool: null, lastUpdate: null },
      recommendations: []
    };
    this._load();
  }

  _load() {
    try {
      var data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      if (data.algos) this.db.algos = data.algos;
      if (data.pools) this.db.pools = data.pools;
      if (data.cpuProfiles) this.db.cpuProfiles = data.cpuProfiles;
      if (data.solutions) this.db.solutions = data.solutions;
      if (data.consensus) this.db.consensus = data.consensus;
      if (data.recommendations) this.db.recommendations = data.recommendations;
    } catch (e) {}
  }

  _save() {
    try {
      var dir = path.dirname(DATA_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(this.db, null, 2));
    } catch (e) {}
  }

  // Process a discovery from a worker
  processDiscovery(workerId, discovery) {
    if (!discovery || !discovery.type) return;
    this.emit('discovery', { workerId: workerId, discovery: discovery });

    switch (discovery.type) {
      case 'algo_performance':
        this._processAlgo(workerId, discovery);
        break;
      case 'pool_latency':
        this._processPool(workerId, discovery);
        break;
      case 'thread_optimal':
        this._processThreads(workerId, discovery);
        break;
      case 'error_solution':
        this._processSolution(workerId, discovery);
        break;
    }

    this._updateConsensus();
    this._save();
  }

  _processAlgo(workerId, d) {
    var algo = d.algo || 'randomx';
    if (!this.db.algos[algo]) {
      this.db.algos[algo] = { avgHashrate: 0, totalHashrate: 0, reports: 0, avgEarnings: 0, totalEarnings: 0, workers: {} };
    }
    var a = this.db.algos[algo];
    a.workers[workerId] = { hashrate: d.hashrate || 0, earnings: d.earnings || 0, timestamp: Date.now() };
    a.reports++;
    a.totalHashrate = (a.totalHashrate || 0) + (d.hashrate || 0);
    a.totalEarnings = (a.totalEarnings || 0) + (d.earnings || 0);
    a.avgHashrate = Math.round(a.totalHashrate / a.reports);
    a.avgEarnings = a.reports > 0 ? a.totalEarnings / a.reports : 0;
  }

  _processPool(workerId, d) {
    var pool = d.pool;
    if (!pool) return;
    if (!this.db.pools[pool]) {
      this.db.pools[pool] = { avgLatency: 0, totalLatency: 0, uptime: 100, reports: 0, successes: 0, failures: 0, workers: {} };
    }
    var p = this.db.pools[pool];
    p.workers[workerId] = { latency: d.latency || 0, success: d.success !== false, timestamp: Date.now() };
    p.reports++;
    p.totalLatency = (p.totalLatency || 0) + (d.latency || 0);
    p.avgLatency = Math.round(p.totalLatency / p.reports);
    if (d.success !== false) p.successes++; else p.failures++;
    p.uptime = p.reports > 0 ? Math.round(p.successes / p.reports * 1000) / 10 : 100;
  }

  _processThreads(workerId, d) {
    var cpu = d.cpuModel || 'unknown';
    if (!this.db.cpuProfiles[cpu]) {
      this.db.cpuProfiles[cpu] = { bestThreads: 0, bestHashrate: 0, reports: 0, results: {} };
    }
    var cp = this.db.cpuProfiles[cpu];
    var threads = d.threads || 0;
    var hashrate = d.hashrate || 0;
    if (!cp.results[threads]) cp.results[threads] = { totalHashrate: 0, count: 0 };
    cp.results[threads].totalHashrate += hashrate;
    cp.results[threads].count++;
    cp.reports++;

    // Find best thread count
    var bestThreads = 0, bestAvg = 0;
    for (var t in cp.results) {
      var avg = cp.results[t].totalHashrate / cp.results[t].count;
      if (avg > bestAvg) { bestAvg = avg; bestThreads = parseInt(t); }
    }
    cp.bestThreads = bestThreads;
    cp.bestHashrate = Math.round(bestAvg);
  }

  _processSolution(workerId, d) {
    var errorType = d.errorType || 'unknown';
    if (!this.db.solutions[errorType]) {
      this.db.solutions[errorType] = { fix: d.fix || '', successes: 0, failures: 0, reports: 0, successRate: 0 };
    }
    var s = this.db.solutions[errorType];
    if (d.fix) s.fix = d.fix;
    s.reports++;
    if (d.success) s.successes++; else s.failures++;
    s.successRate = s.reports > 0 ? Math.round(s.successes / s.reports * 100) / 100 : 0;
  }

  _updateConsensus() {
    var oldConsensus = JSON.stringify(this.db.consensus);

    // Best algo by earnings
    var bestAlgo = null, bestEarnings = 0;
    for (var algo in this.db.algos) {
      var a = this.db.algos[algo];
      if (a.avgEarnings > bestEarnings && a.reports >= 3) {
        bestEarnings = a.avgEarnings;
        bestAlgo = algo;
      }
    }

    // Best pool by latency + uptime
    var bestPool = null, bestScore = -Infinity;
    for (var pool in this.db.pools) {
      var p = this.db.pools[pool];
      if (p.reports < 3) continue;
      // Score: higher uptime and lower latency = better
      var score = p.uptime - (p.avgLatency / 10);
      if (score > bestScore) { bestScore = score; bestPool = pool; }
    }

    this.db.consensus.bestAlgo = bestAlgo || this.db.consensus.bestAlgo;
    this.db.consensus.bestPool = bestPool || this.db.consensus.bestPool;
    this.db.consensus.lastUpdate = new Date().toISOString();

    if (JSON.stringify(this.db.consensus) !== oldConsensus) {
      this.emit('consensus-changed', this.db.consensus);
    }
  }

  getConsensus(type) {
    if (type === 'algo') return { bestAlgo: this.db.consensus.bestAlgo, algos: this.db.algos };
    if (type === 'pool') return { bestPool: this.db.consensus.bestPool, pools: this.db.pools };
    if (type === 'threads') return this.db.cpuProfiles;
    return this.db.consensus;
  }

  getRecommendations() {
    var recs = [];
    var id = 0;

    // Algo recommendation
    if (this.db.consensus.bestAlgo) {
      var algoData = this.db.algos[this.db.consensus.bestAlgo];
      recs.push({
        id: 'algo-' + (++id),
        type: 'algo_switch',
        description: 'Switch all workers to ' + this.db.consensus.bestAlgo + ' (avg earnings: ' + (algoData ? algoData.avgEarnings.toFixed(6) : '?') + ')',
        algo: this.db.consensus.bestAlgo,
        confidence: algoData ? Math.min(100, algoData.reports * 2) : 0,
        affectedWorkers: Object.keys(this.knownWorkers).length
      });
    }

    // Pool recommendation
    if (this.db.consensus.bestPool) {
      var poolData = this.db.pools[this.db.consensus.bestPool];
      recs.push({
        id: 'pool-' + (++id),
        type: 'pool_switch',
        description: 'Switch to pool ' + this.db.consensus.bestPool + ' (latency: ' + (poolData ? poolData.avgLatency : '?') + 'ms, uptime: ' + (poolData ? poolData.uptime : '?') + '%)',
        pool: this.db.consensus.bestPool,
        confidence: poolData ? Math.min(100, poolData.reports) : 0,
        affectedWorkers: Object.keys(this.knownWorkers).length
      });
    }

    // Thread recommendations per CPU model
    for (var cpu in this.db.cpuProfiles) {
      var cp = this.db.cpuProfiles[cpu];
      if (cp.reports >= 5 && cp.bestThreads > 0) {
        recs.push({
          id: 'threads-' + (++id),
          type: 'thread_change',
          description: 'Set ' + cpu + ' workers to ' + cp.bestThreads + ' threads (best hashrate: ' + cp.bestHashrate + ' H/s)',
          cpuModel: cpu,
          threads: cp.bestThreads,
          confidence: Math.min(100, cp.reports * 4),
          affectedWorkers: this._countWorkersByCpu(cpu)
        });
      }
    }

    this.db.recommendations = recs;
    return recs;
  }

  _countWorkersByCpu(cpuModel) {
    var count = 0;
    for (var id in this.knownWorkers) {
      if ((this.knownWorkers[id].cpu || '').indexOf(cpuModel) >= 0) count++;
    }
    return count;
  }

  // Apply a recommendation by broadcasting to workers
  applyRecommendation(recId) {
    var rec = this.db.recommendations.find(function(r) { return r.id === recId; });
    if (!rec) return { success: false, error: 'Recommendation not found' };

    var task = {
      id: 'intel-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6),
      type: 'swarm-intelligence',
      recommendation: rec,
      timestamp: Date.now()
    };

    this.broadcastIntelligence(task);
    this.emit('applied', { recommendation: rec });
    return { success: true, recommendation: rec, taskId: task.id };
  }

  // Broadcast intelligence to all workers via relay
  broadcastIntelligence(task) {
    if (!task) {
      task = {
        id: 'intel-broadcast-' + Date.now(),
        type: 'swarm-intelligence',
        consensus: this.db.consensus,
        recommendations: this.getRecommendations(),
        timestamp: Date.now()
      };
    }

    if (this.swarmRelay && this.swarmRelay.broadcastTask) {
      this.swarmRelay.broadcastTask(task);
    }
  }

  // Toggle auto-optimize
  autoOptimize(enabled) {
    this.autoOptimizeEnabled = enabled;
    if (this._autoOptimizeInterval) {
      clearInterval(this._autoOptimizeInterval);
      this._autoOptimizeInterval = null;
    }
    if (enabled) {
      var self = this;
      this._autoOptimizeInterval = setInterval(function() {
        var recs = self.getRecommendations();
        var highConfidence = recs.filter(function(r) { return r.confidence >= 70; });
        if (highConfidence.length > 0) {
          self.broadcastIntelligence();
          self.emit('recommendation', { auto: true, count: highConfidence.length });
        }
      }, 3600000); // every hour
    }
    return { enabled: this.autoOptimizeEnabled };
  }

  getCpuProfiles() {
    return this.db.cpuProfiles;
  }

  getPoolStats() {
    return this.db.pools;
  }

  getAlgoStats() {
    return this.db.algos;
  }

  // ── Collective Memory ──
  // Workers share learned knowledge via a keyword index (no vectors needed)
  addToCollectiveMemory(workerId, entry) {
    if (!entry || !entry.keywords || !entry.content) return;
    if (!this.db.collectiveMemory) this.db.collectiveMemory = [];
    this.db.collectiveMemory.push({
      workerId,
      keywords: Array.isArray(entry.keywords) ? entry.keywords : entry.keywords.split(',').map(k => k.trim().toLowerCase()),
      content: entry.content,
      category: entry.category || 'general',
      timestamp: Date.now(),
      score: 1,
    });
    // Cap at 5000 entries
    if (this.db.collectiveMemory.length > 5000) this.db.collectiveMemory = this.db.collectiveMemory.slice(-5000);
    this._save();
  }

  searchCollectiveMemory(query) {
    if (!this.db.collectiveMemory) return [];
    const terms = query.toLowerCase().split(/\s+/);
    return this.db.collectiveMemory
      .map(entry => {
        const matches = terms.filter(t => entry.keywords.some(k => k.includes(t)));
        return { ...entry, relevance: matches.length / terms.length };
      })
      .filter(e => e.relevance > 0)
      .sort((a, b) => b.relevance - a.relevance || b.score - a.score)
      .slice(0, 20);
  }

  // ── Consensus Voting ──
  // For important answers, query multiple workers and take best/majority
  async consensusQuery(question, workerIds, opts = {}) {
    const minVotes = opts.minVotes || 3;
    const timeout = opts.timeout || 30000;
    const responses = [];

    // This returns a structure; actual dispatch is done by the caller (api-server)
    return {
      questionId: 'consensus-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6),
      question,
      targetWorkers: workerIds.slice(0, Math.max(minVotes, 5)),
      minVotes,
      timeout,
      responses,
      status: 'pending',
    };
  }

  processConsensusVote(questionId, workerId, response) {
    if (!this.db.consensusVotes) this.db.consensusVotes = {};
    if (!this.db.consensusVotes[questionId]) {
      this.db.consensusVotes[questionId] = { responses: [], resolved: false };
    }
    const cv = this.db.consensusVotes[questionId];
    cv.responses.push({ workerId, response, timestamp: Date.now() });

    // Simple majority: if 3+ responses, pick most common (or longest/most detailed)
    if (cv.responses.length >= 3 && !cv.resolved) {
      cv.resolved = true;
      // Pick the longest response as "best" (heuristic: more detail = more thorough)
      const best = cv.responses.sort((a, b) => (b.response || '').length - (a.response || '').length)[0];
      cv.winner = best;
      this._save();
      return { resolved: true, winner: best, allResponses: cv.responses };
    }
    return { resolved: false, votesNeeded: 3 - cv.responses.length };
  }

  // ── Specialization Tracking ──
  // Track which workers are best at which task types
  recordSpecialization(workerId, taskType, score, durationMs) {
    if (!this.db.specializations) this.db.specializations = {};
    if (!this.db.specializations[workerId]) this.db.specializations[workerId] = {};
    const spec = this.db.specializations[workerId];
    if (!spec[taskType]) spec[taskType] = { totalScore: 0, count: 0, avgDuration: 0, totalDuration: 0 };
    spec[taskType].totalScore += score;
    spec[taskType].count++;
    spec[taskType].avgScore = spec[taskType].totalScore / spec[taskType].count;
    spec[taskType].totalDuration += (durationMs || 0);
    spec[taskType].avgDuration = spec[taskType].totalDuration / spec[taskType].count;
    this._save();
  }

  getBestWorkerForTaskType(taskType) {
    if (!this.db.specializations) return null;
    let best = null, bestScore = -1;
    for (const [wid, specs] of Object.entries(this.db.specializations)) {
      if (specs[taskType] && specs[taskType].avgScore > bestScore && specs[taskType].count >= 3) {
        bestScore = specs[taskType].avgScore;
        best = wid;
      }
    }
    return best;
  }

  getSpecializations() {
    return this.db.specializations || {};
  }

  // ── Cascade Queries ──
  // Returns ordered list of workers to try for a query (fastest first)
  getCascadeOrder(taskType) {
    if (!this.db.specializations) return [];
    const candidates = [];
    for (const [wid, specs] of Object.entries(this.db.specializations)) {
      const s = specs[taskType];
      if (s) {
        // Score = quality / time (higher quality, lower time = better)
        const efficiency = s.avgScore / Math.max(s.avgDuration, 1) * 1000;
        candidates.push({ workerId: wid, efficiency, avgScore: s.avgScore, avgDuration: s.avgDuration });
      }
    }
    return candidates.sort((a, b) => b.efficiency - a.efficiency).map(c => c.workerId);
  }
}

module.exports = SwarmIntelligence;
