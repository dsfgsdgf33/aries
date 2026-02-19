// ============================================================================
// Aries Auto-Optimization Engine — core/auto-optimizer.js
// Analyze productivity, reassign tasks, prune dead workers, optimize routing
// ============================================================================

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

const OPT_FILE = path.join(__dirname, '..', 'data', 'auto-optimizer.json');

class AutoOptimizer extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.memberTracker = opts.memberTracker;
    this.config = opts.config || {};
    this.data = {
      workerScores: {},      // workerId → productivity score
      taskRouting: {},       // taskType → [best workerIds]
      responseTimeHistory: {}, // workerId → [ms]
      weeklyReports: [],
      lastPrune: 0,
      lastOptimize: 0,
    };
    this._load();
    this._startOptimization();
  }

  _load() {
    try { Object.assign(this.data, JSON.parse(fs.readFileSync(OPT_FILE, 'utf8'))); } catch {}
  }

  _save() {
    try {
      const dir = path.dirname(OPT_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(OPT_FILE, JSON.stringify(this.data, null, 2));
    } catch {}
  }

  _startOptimization() {
    // Run optimization every 15 minutes
    this._interval = setInterval(() => this.optimize(), 900000);
    // Prune dead workers every 6 hours
    this._pruneInterval = setInterval(() => this.pruneDeadWorkers(), 21600000);
    // Weekly report every 7 days
    this._weeklyInterval = setInterval(() => this._weeklyReport(), 604800000);
  }

  optimize() {
    if (!this.memberTracker) return;
    const now = Date.now();
    this.data.lastOptimize = now;

    const members = Object.values(this.memberTracker.members);

    // Score each worker
    for (const m of members) {
      if (m.status === 'offline' || m.status === 'banned') continue;
      const uptime = (now - m.connectedSince) / 3600000;
      const taskRate = uptime > 0 ? (m.tasksCompleted || 0) / uptime : 0;
      const hashrateScore = (m.hashrate || 0) / 100;
      const reliabilityScore = m.lastHeartbeat ? Math.max(0, 1 - (now - m.lastHeartbeat) / 300000) : 0;

      this.data.workerScores[m.workerId] = {
        productivity: Math.round((taskRate * 10 + hashrateScore + reliabilityScore * 5) * 100) / 100,
        taskRate: Math.round(taskRate * 100) / 100,
        hashrate: m.hashrate || 0,
        reliability: Math.round(reliabilityScore * 100) / 100,
        lastScored: now,
      };
    }

    // Sort workers by productivity for task routing
    const scored = Object.entries(this.data.workerScores)
      .sort((a, b) => b[1].productivity - a[1].productivity);

    // Top workers get complex tasks, bottom get simple
    const topWorkers = scored.slice(0, Math.ceil(scored.length * 0.3)).map(s => s[0]);
    const bottomWorkers = scored.slice(-Math.ceil(scored.length * 0.3)).map(s => s[0]);

    this.data.taskRouting = {
      complex: topWorkers,
      simple: bottomWorkers,
      any: scored.map(s => s[0]),
    };

    this._save();
    this.emit('optimized', { workerCount: scored.length, topWorkers: topWorkers.length });
  }

  recordResponseTime(workerId, ms) {
    if (!this.data.responseTimeHistory[workerId]) this.data.responseTimeHistory[workerId] = [];
    this.data.responseTimeHistory[workerId].push(ms);
    if (this.data.responseTimeHistory[workerId].length > 100) {
      this.data.responseTimeHistory[workerId] = this.data.responseTimeHistory[workerId].slice(-100);
    }
  }

  getAvgResponseTime(workerId) {
    const hist = this.data.responseTimeHistory[workerId] || [];
    if (!hist.length) return Infinity;
    return hist.reduce((s, v) => s + v, 0) / hist.length;
  }

  getBestWorkerForTask(taskType = 'any') {
    const candidates = this.data.taskRouting[taskType] || this.data.taskRouting.any || [];
    if (!candidates.length) return null;

    // Pick fastest response time among candidates
    let best = null, bestTime = Infinity;
    for (const wid of candidates) {
      const m = this.memberTracker?.getMember(wid);
      if (!m || m.status === 'offline' || m.status === 'banned') continue;
      const avg = this.getAvgResponseTime(wid);
      if (avg < bestTime) { bestTime = avg; best = wid; }
    }
    return best;
  }

  pruneDeadWorkers() {
    if (!this.memberTracker) return;
    const now = Date.now();
    const cutoff = 24 * 3600000; // 24 hours
    let pruned = 0;

    for (const [wid, m] of Object.entries(this.memberTracker.members)) {
      if (m.status === 'banned') continue;
      if (m.lastHeartbeat && (now - m.lastHeartbeat) > cutoff) {
        m.status = 'dead';
        pruned++;
        this.emit('worker-pruned', { workerId: wid, lastSeen: m.lastHeartbeat });
      }
    }

    this.data.lastPrune = now;
    if (pruned > 0) this._save();
    return pruned;
  }

  _weeklyReport() {
    if (!this.memberTracker) return;
    const stats = this.memberTracker.getStats();
    const prevReport = this.data.weeklyReports[this.data.weeklyReports.length - 1];

    const growth = prevReport ? ((stats.totalMembers - prevReport.totalMembers) / (prevReport.totalMembers || 1) * 100).toFixed(1) : 0;
    const revGrowth = prevReport && prevReport.monthlyRevenue ?
      ((this.memberTracker.getRevenueEstimate().projectedMonthlySol - prevReport.monthlyRevenue) / prevReport.monthlyRevenue * 100).toFixed(1) : 0;

    const report = {
      date: new Date().toISOString(),
      totalMembers: stats.totalMembers,
      onlineCount: stats.onlineCount,
      totalHashrate: stats.totalHashrate,
      totalTasks: stats.totalTasks,
      growthPct: parseFloat(growth),
      revenueGrowthPct: parseFloat(revGrowth),
      workersPruned: this.pruneDeadWorkers(),
      monthlyRevenue: this.memberTracker.getRevenueEstimate().projectedMonthlySol,
      summary: `Network grew ${growth}%, revenue ${revGrowth > 0 ? 'up' : 'down'} ${Math.abs(revGrowth)}%`,
    };

    this.data.weeklyReports.push(report);
    if (this.data.weeklyReports.length > 52) this.data.weeklyReports = this.data.weeklyReports.slice(-52);
    this._save();
    this.emit('weekly-report', report);
    return report;
  }

  getScores() { return this.data.workerScores; }
  getRouting() { return this.data.taskRouting; }
  getWeeklyReports() { return this.data.weeklyReports; }

  stop() {
    if (this._interval) clearInterval(this._interval);
    if (this._pruneInterval) clearInterval(this._pruneInterval);
    if (this._weeklyInterval) clearInterval(this._weeklyInterval);
  }
}

module.exports = AutoOptimizer;
