/**
 * ARIES v5.0 — Swarm Analytics & Heatmaps
 * 
 * Tracks performance metrics per worker over time, aggregates by provider,
 * generates heatmap data, ranks workers, detects insights/patterns.
 * Rolling 30-day storage with monthly compaction.
 * 
 * Pure Node.js, zero dependencies.
 */

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

const DATA_DIR = path.join(__dirname, '..', 'data', 'analytics');
const SUMMARY_DIR = path.join(DATA_DIR, 'monthly');
const COLLECT_INTERVAL = 60 * 1000;       // aggregate in-memory every 60s
const FLUSH_INTERVAL = 5 * 60 * 1000;     // flush to disk every 5min
const COMPACT_INTERVAL = 6 * 60 * 60 * 1000; // check compaction every 6h
const ROLLING_DAYS = 30;

class SwarmAnalytics extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
    this._workers = new Map();    // workerId → WorkerMetrics
    this._providers = new Map();  // provider → aggregated stats
    this._hourly = {};            // "dow-hour" → { earnings, hashrate, tasks, count }
    this._geo = new Map();        // "lat,lon" → { earnings, workers, region }
    this._insights = [];
    this._running = false;
    this._timers = [];
    this._todayMetrics = [];      // raw metric events for today
    this._dayTag = this._dayStr();
    
    this._ensureDirs();
    this._loadToday();
  }

  // ── Lifecycle ──

  start() {
    if (this._running) return;
    this._running = true;
    this._timers.push(setInterval(() => this._collectCycle(), COLLECT_INTERVAL));
    this._timers.push(setInterval(() => this._flushToday(), FLUSH_INTERVAL));
    this._timers.push(setInterval(() => this._compactOld(), COMPACT_INTERVAL));
    this.emit('log', 'SwarmAnalytics started');
    // Run compaction check on start
    setTimeout(() => this._compactOld(), 5000);
  }

  stop() {
    this._running = false;
    this._timers.forEach(t => clearInterval(t));
    this._timers = [];
    this._flushToday();
    this.emit('log', 'SwarmAnalytics stopped');
  }

  // ── Public API ──

  /**
   * Record a metric event for a worker.
   * @param {string} workerId 
   * @param {object} data - { hashrate, earnings, uptime, tasksCompleted, latency, provider, region, lat, lon }
   */
  recordMetric(workerId, data = {}) {
    const now = Date.now();
    const today = this._dayStr();
    
    // Day rollover
    if (today !== this._dayTag) {
      this._flushToday();
      this._dayTag = today;
      this._todayMetrics = [];
    }

    const event = {
      ts: now,
      worker: workerId,
      hashrate: data.hashrate || 0,
      earnings: data.earnings || 0,
      uptime: data.uptime || 0,
      tasks: data.tasksCompleted || 0,
      latency: data.latency || 0,
      provider: (data.provider || 'unknown').toLowerCase(),
      region: data.region || '',
      lat: data.lat || null,
      lon: data.lon || null,
    };

    this._todayMetrics.push(event);
    this._updateWorker(workerId, event);
    this._updateProvider(event);
    this._updateHourly(event);
    this._updateGeo(event);
  }

  /**
   * Get auto-detected insights/patterns.
   */
  getInsights() {
    this._generateInsights();
    return [...this._insights];
  }

  /**
   * Get high-level summary stats.
   */
  getSummary() {
    const workers = [...this._workers.values()];
    const totalHashrate = workers.reduce((s, w) => s + (w.latest.hashrate || 0), 0);
    const totalEarnings = workers.reduce((s, w) => s + w.totalEarnings, 0);
    const avgUptime = workers.length ? workers.reduce((s, w) => s + w.avgUptime, 0) / workers.length : 0;
    const totalTasks = workers.reduce((s, w) => s + w.totalTasks, 0);
    const avgLatency = workers.length ? workers.reduce((s, w) => s + w.avgLatency, 0) / workers.length : 0;

    return {
      timestamp: Date.now(),
      activeWorkers: workers.filter(w => Date.now() - w.lastSeen < 5 * 60 * 1000).length,
      totalWorkers: workers.length,
      totalHashrate,
      totalEarnings: +totalEarnings.toFixed(8),
      avgUptime: +avgUptime.toFixed(2),
      totalTasks,
      avgLatency: +avgLatency.toFixed(1),
      topWorker: this._getTopWorker(),
      topProvider: this._getTopProvider(),
      metricsToday: this._todayMetrics.length,
      insights: this.getInsights().slice(0, 5),
    };
  }

  /**
   * Get per-worker breakdown with rankings.
   */
  getWorkerBreakdown() {
    const ranked = [...this._workers.entries()].map(([id, w]) => ({
      workerId: id,
      provider: w.provider,
      region: w.region,
      hashrate: w.latest.hashrate || 0,
      earnings: +w.totalEarnings.toFixed(8),
      uptime: +w.avgUptime.toFixed(2),
      tasks: w.totalTasks,
      latency: +w.avgLatency.toFixed(1),
      score: +this._workerScore(w).toFixed(4),
      lastSeen: w.lastSeen,
      samples: w.samples,
    }));

    ranked.sort((a, b) => b.score - a.score);
    ranked.forEach((w, i) => w.rank = i + 1);
    return ranked;
  }

  /**
   * Get provider comparison data.
   */
  getProviderComparison() {
    const result = [];
    for (const [name, p] of this._providers) {
      const avgHashrate = p.count ? p.totalHashrate / p.count : 0;
      const avgLatency = p.count ? p.totalLatency / p.count : 0;
      const avgUptime = p.count ? p.totalUptime / p.count : 0;
      result.push({
        provider: name,
        workers: p.workers.size,
        totalEarnings: +p.totalEarnings.toFixed(8),
        avgHashrate: +avgHashrate.toFixed(2),
        avgUptime: +avgUptime.toFixed(2),
        avgLatency: +avgLatency.toFixed(1),
        totalTasks: p.totalTasks,
        costEfficiency: p.totalEarnings > 0 ? +(p.totalEarnings / Math.max(p.workers.size, 1)).toFixed(8) : 0,
        samples: p.count,
      });
    }
    result.sort((a, b) => b.costEfficiency - a.costEfficiency);
    return result;
  }

  /**
   * Get heatmap data.
   * @param {string} type - 'hourly' | 'geographic' | 'provider'
   */
  getHeatmap(type = 'hourly') {
    switch (type) {
      case 'hourly': return this._hourlyHeatmap();
      case 'geographic': return this._geoHeatmap();
      case 'provider': return this._providerHeatmap();
      default: return { error: `Unknown heatmap type: ${type}` };
    }
  }

  /**
   * Get trend data for a metric over N days.
   * @param {string} metric - 'hashrate' | 'earnings' | 'uptime'
   * @param {number} days - number of days
   */
  getTrends(metric = 'hashrate', days = 30) {
    const validMetrics = ['hashrate', 'earnings', 'uptime', 'latency', 'tasks'];
    if (!validMetrics.includes(metric)) return { error: `Invalid metric: ${metric}` };

    const points = [];
    const now = new Date();

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const tag = this._dayStr(d);
      const dayData = this._loadDayFile(tag);

      if (dayData && dayData.length) {
        const vals = dayData.map(e => e[metric] || 0);
        const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
        const max = Math.max(...vals);
        const min = Math.min(...vals);
        points.push({ date: tag, avg: +avg.toFixed(4), min: +min.toFixed(4), max: +max.toFixed(4), samples: vals.length });
      } else {
        points.push({ date: tag, avg: 0, min: 0, max: 0, samples: 0 });
      }
    }

    return { metric, days, points };
  }

  // ── Route Registration ──

  registerRoutes(addRoute) {
    addRoute('GET', '/api/manage/analytics/summary', (req, res) => {
      this._jsonRes(res, 200, this.getSummary());
    }, { prefix: false });

    addRoute('GET', '/api/manage/analytics/workers', (req, res) => {
      this._jsonRes(res, 200, { workers: this.getWorkerBreakdown() });
    }, { prefix: false });

    addRoute('GET', '/api/manage/analytics/providers', (req, res) => {
      this._jsonRes(res, 200, { providers: this.getProviderComparison() });
    }, { prefix: false });

    addRoute('GET', '/api/manage/analytics/heatmap', (req, res) => {
      const parsed = require('url').parse(req.url, true);
      const type = parsed.query.type || 'hourly';
      this._jsonRes(res, 200, this.getHeatmap(type));
    }, { prefix: false });

    addRoute('GET', '/api/manage/analytics/trends', (req, res) => {
      const parsed = require('url').parse(req.url, true);
      const metric = parsed.query.metric || 'hashrate';
      const days = parseInt(parsed.query.days) || 30;
      this._jsonRes(res, 200, this.getTrends(metric, Math.min(days, 365)));
    }, { prefix: false });

    addRoute('GET', '/api/manage/analytics/insights', (req, res) => {
      this._jsonRes(res, 200, { insights: this.getInsights() });
    }, { prefix: false });
  }

  // ── Internal: Worker Tracking ──

  _updateWorker(id, event) {
    let w = this._workers.get(id);
    if (!w) {
      w = {
        provider: event.provider,
        region: event.region,
        latest: {},
        totalEarnings: 0,
        totalTasks: 0,
        avgUptime: 0,
        avgLatency: 0,
        avgHashrate: 0,
        lastSeen: 0,
        samples: 0,
        history: [],     // last 100 data points
      };
      this._workers.set(id, w);
    }

    w.latest = event;
    w.lastSeen = event.ts;
    w.totalEarnings += event.earnings;
    w.totalTasks += event.tasks;
    w.samples++;
    w.provider = event.provider || w.provider;
    w.region = event.region || w.region;

    // Running averages
    const n = w.samples;
    w.avgUptime = w.avgUptime + (event.uptime - w.avgUptime) / n;
    w.avgLatency = w.avgLatency + (event.latency - w.avgLatency) / n;
    w.avgHashrate = w.avgHashrate + (event.hashrate - w.avgHashrate) / n;

    // Keep last 100 points for trend detection
    w.history.push({ ts: event.ts, hashrate: event.hashrate, earnings: event.earnings, uptime: event.uptime });
    if (w.history.length > 100) w.history.shift();
  }

  // ── Internal: Provider Aggregation ──

  _updateProvider(event) {
    let p = this._providers.get(event.provider);
    if (!p) {
      p = { workers: new Set(), totalEarnings: 0, totalHashrate: 0, totalUptime: 0, totalLatency: 0, totalTasks: 0, count: 0 };
      this._providers.set(event.provider, p);
    }
    p.workers.add(event.worker);
    p.totalEarnings += event.earnings;
    p.totalHashrate += event.hashrate;
    p.totalUptime += event.uptime;
    p.totalLatency += event.latency;
    p.totalTasks += event.tasks;
    p.count++;
  }

  // ── Internal: Hourly Heatmap ──

  _updateHourly(event) {
    const d = new Date(event.ts);
    const dow = d.getDay(); // 0=Sun
    const hour = d.getHours();
    const key = `${dow}-${hour}`;
    
    if (!this._hourly[key]) {
      this._hourly[key] = { earnings: 0, hashrate: 0, tasks: 0, count: 0 };
    }
    const h = this._hourly[key];
    h.earnings += event.earnings;
    h.hashrate += event.hashrate;
    h.tasks += event.tasks;
    h.count++;
  }

  _hourlyHeatmap() {
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const matrix = [];

    for (let dow = 0; dow < 7; dow++) {
      const row = { day: dayNames[dow], hours: [] };
      for (let h = 0; h < 24; h++) {
        const key = `${dow}-${h}`;
        const data = this._hourly[key] || { earnings: 0, hashrate: 0, tasks: 0, count: 0 };
        row.hours.push({
          hour: h,
          avgEarnings: data.count ? +(data.earnings / data.count).toFixed(8) : 0,
          avgHashrate: data.count ? +(data.hashrate / data.count).toFixed(2) : 0,
          totalTasks: data.tasks,
          samples: data.count,
        });
      }
      matrix.push(row);
    }

    // Find most/least profitable hours
    let best = { day: '', hour: 0, earnings: 0 };
    let worst = { day: '', hour: 0, earnings: Infinity };
    matrix.forEach(row => row.hours.forEach(h => {
      if (h.avgEarnings > best.earnings) best = { day: row.day, hour: h.hour, earnings: h.avgEarnings };
      if (h.samples > 0 && h.avgEarnings < worst.earnings) worst = { day: row.day, hour: h.hour, earnings: h.avgEarnings };
    }));
    if (worst.earnings === Infinity) worst = null;

    return { type: 'hourly', matrix, bestSlot: best, worstSlot: worst };
  }

  // ── Internal: Geographic Heatmap ──

  _updateGeo(event) {
    if (!event.lat || !event.lon) return;
    // Round to ~11km grid
    const key = `${(Math.round(event.lat * 10) / 10).toFixed(1)},${(Math.round(event.lon * 10) / 10).toFixed(1)}`;
    
    let g = this._geo.get(key);
    if (!g) {
      g = { lat: event.lat, lon: event.lon, earnings: 0, hashrate: 0, workers: new Set(), region: event.region, count: 0 };
      this._geo.set(key, g);
    }
    g.earnings += event.earnings;
    g.hashrate += event.hashrate;
    g.workers.add(event.worker);
    g.count++;
  }

  _geoHeatmap() {
    const points = [];
    for (const [, g] of this._geo) {
      points.push({
        lat: g.lat,
        lon: g.lon,
        region: g.region,
        earnings: +g.earnings.toFixed(8),
        avgHashrate: g.count ? +(g.hashrate / g.count).toFixed(2) : 0,
        workers: g.workers.size,
        intensity: g.earnings, // for heatmap rendering
      });
    }
    points.sort((a, b) => b.earnings - a.earnings);
    return { type: 'geographic', points };
  }

  // ── Internal: Provider Heatmap ──

  _providerHeatmap() {
    const providers = this.getProviderComparison();
    const maxEarnings = Math.max(...providers.map(p => p.totalEarnings), 0.0001);
    
    return {
      type: 'provider',
      providers: providers.map(p => ({
        ...p,
        intensity: +(p.totalEarnings / maxEarnings).toFixed(4),
      })),
    };
  }

  // ── Internal: Worker Scoring ──

  _workerScore(w) {
    // Composite: normalized uptime × hashrate × earnings
    // Higher = better
    const uptimeFactor = Math.min(w.avgUptime / 100, 1);  // 0-1
    const hashFactor = w.avgHashrate > 0 ? Math.log10(w.avgHashrate + 1) : 0;
    const earnFactor = w.totalEarnings > 0 ? Math.log10(w.totalEarnings * 1e8 + 1) : 0;
    const latencyPenalty = w.avgLatency > 0 ? 1 / (1 + w.avgLatency / 1000) : 1;
    
    return uptimeFactor * hashFactor * earnFactor * latencyPenalty;
  }

  _getTopWorker() {
    let best = null, bestScore = -1;
    for (const [id, w] of this._workers) {
      const s = this._workerScore(w);
      if (s > bestScore) { bestScore = s; best = id; }
    }
    return best ? { workerId: best, score: +bestScore.toFixed(4) } : null;
  }

  _getTopProvider() {
    const providers = this.getProviderComparison();
    return providers.length ? { provider: providers[0].provider, costEfficiency: providers[0].costEfficiency } : null;
  }

  // ── Internal: Insights Engine ──

  _generateInsights() {
    this._insights = [];

    this._insightProviderWeekend();
    this._insightWorkerDegrading();
    this._insightBestHours();
    this._insightProviderComparison();
    this._insightWorkerOutliers();
  }

  _insightProviderWeekend() {
    // Compare weekend vs weekday earnings per provider
    for (const [name] of this._providers) {
      let weekdayEarnings = 0, weekdayCnt = 0, weekendEarnings = 0, weekendCnt = 0;
      
      for (let dow = 0; dow < 7; dow++) {
        const isWeekend = dow === 0 || dow === 6;
        for (let h = 0; h < 24; h++) {
          const key = `${dow}-${h}`;
          const data = this._hourly[key];
          if (!data) continue;
          // We don't track per-provider hourly, so this is aggregate
          if (isWeekend) { weekendEarnings += data.earnings; weekendCnt += data.count; }
          else { weekdayEarnings += data.earnings; weekdayCnt += data.count; }
        }
      }

      if (weekdayCnt > 10 && weekendCnt > 5) {
        const wdAvg = weekdayEarnings / weekdayCnt;
        const weAvg = weekendEarnings / weekendCnt;
        if (weAvg > wdAvg * 1.15) {
          const pct = Math.round((weAvg / wdAvg - 1) * 100);
          this._insights.push({
            type: 'weekend_boost',
            severity: 'info',
            message: `Workers are ${pct}% more profitable on weekends`,
            data: { weekdayAvg: +wdAvg.toFixed(8), weekendAvg: +weAvg.toFixed(8) },
          });
        } else if (wdAvg > weAvg * 1.15) {
          const pct = Math.round((wdAvg / weAvg - 1) * 100);
          this._insights.push({
            type: 'weekday_boost',
            severity: 'info',
            message: `Workers are ${pct}% more profitable on weekdays`,
            data: { weekdayAvg: +wdAvg.toFixed(8), weekendAvg: +weAvg.toFixed(8) },
          });
        }
      }
    }
  }

  _insightWorkerDegrading() {
    // Check if any worker's hashrate is trending down over last 5+ data points
    for (const [id, w] of this._workers) {
      if (w.history.length < 5) continue;
      const recent = w.history.slice(-10);
      const half = Math.floor(recent.length / 2);
      const firstHalf = recent.slice(0, half);
      const secondHalf = recent.slice(half);

      const avg1 = firstHalf.reduce((s, p) => s + p.hashrate, 0) / firstHalf.length;
      const avg2 = secondHalf.reduce((s, p) => s + p.hashrate, 0) / secondHalf.length;

      if (avg1 > 0 && avg2 < avg1 * 0.8) {
        const pct = Math.round((1 - avg2 / avg1) * 100);
        this._insights.push({
          type: 'worker_degrading',
          severity: 'warning',
          message: `${id} hashrate dropped ${pct}% over recent samples`,
          data: { workerId: id, previousAvg: +avg1.toFixed(2), currentAvg: +avg2.toFixed(2) },
        });
      }
    }
  }

  _insightBestHours() {
    const heatmap = this._hourlyHeatmap();
    if (heatmap.bestSlot && heatmap.bestSlot.earnings > 0) {
      this._insights.push({
        type: 'best_hour',
        severity: 'info',
        message: `Most profitable time: ${heatmap.bestSlot.day} ${heatmap.bestSlot.hour}:00 (avg ${heatmap.bestSlot.earnings.toFixed(8)}/sample)`,
        data: heatmap.bestSlot,
      });
    }
  }

  _insightProviderComparison() {
    const providers = this.getProviderComparison();
    if (providers.length >= 2) {
      const best = providers[0];
      const worst = providers[providers.length - 1];
      if (worst.costEfficiency > 0) {
        const ratio = best.costEfficiency / worst.costEfficiency;
        if (ratio > 1.2) {
          this._insights.push({
            type: 'provider_gap',
            severity: 'action',
            message: `${best.provider} is ${Math.round((ratio - 1) * 100)}% more cost-effective than ${worst.provider}`,
            data: { best: best.provider, worst: worst.provider, ratio: +ratio.toFixed(2) },
          });
        }
      }
    }
  }

  _insightWorkerOutliers() {
    const workers = this.getWorkerBreakdown();
    if (workers.length < 3) return;

    const scores = workers.map(w => w.score);
    const avg = scores.reduce((s, v) => s + v, 0) / scores.length;
    const std = Math.sqrt(scores.reduce((s, v) => s + (v - avg) ** 2, 0) / scores.length);

    if (std > 0) {
      workers.forEach(w => {
        if (w.score < avg - 1.5 * std) {
          this._insights.push({
            type: 'underperformer',
            severity: 'warning',
            message: `${w.workerId} is significantly underperforming (score ${w.score} vs avg ${avg.toFixed(4)})`,
            data: { workerId: w.workerId, score: w.score, avgScore: +avg.toFixed(4) },
          });
        }
      });
    }
  }

  // ── Internal: Persistence ──

  _ensureDirs() {
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
    try { fs.mkdirSync(SUMMARY_DIR, { recursive: true }); } catch {}
  }

  _dayStr(d) {
    const dt = d || new Date();
    return dt.toISOString().slice(0, 10); // YYYY-MM-DD
  }

  _dayFilePath(tag) {
    return path.join(DATA_DIR, `${tag}.json`);
  }

  _loadToday() {
    try {
      const raw = fs.readFileSync(this._dayFilePath(this._dayTag), 'utf8');
      this._todayMetrics = JSON.parse(raw);
      // Rebuild in-memory state from today's data
      for (const event of this._todayMetrics) {
        this._updateWorker(event.worker, event);
        this._updateProvider(event);
        this._updateHourly(event);
        this._updateGeo(event);
      }
      this.emit('log', `Loaded ${this._todayMetrics.length} metrics for ${this._dayTag}`);
    } catch {
      this._todayMetrics = [];
    }
  }

  _loadDayFile(tag) {
    // For today, return in-memory
    if (tag === this._dayTag) return this._todayMetrics;
    try {
      const raw = fs.readFileSync(this._dayFilePath(tag), 'utf8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  _flushToday() {
    if (!this._todayMetrics.length) return;
    try {
      fs.writeFileSync(this._dayFilePath(this._dayTag), JSON.stringify(this._todayMetrics), 'utf8');
    } catch (e) {
      this.emit('log', `Failed to flush analytics: ${e.message}`);
    }
  }

  _collectCycle() {
    // Day rollover check
    const today = this._dayStr();
    if (today !== this._dayTag) {
      this._flushToday();
      this._dayTag = today;
      this._todayMetrics = [];
    }
  }

  // ── Internal: Compaction ──

  _compactOld() {
    try {
      const files = fs.readdirSync(DATA_DIR).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f));
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - ROLLING_DAYS);
      const cutoffStr = this._dayStr(cutoff);

      // Group old files by month
      const monthBuckets = {};
      for (const f of files) {
        const tag = f.replace('.json', '');
        if (tag >= cutoffStr) continue; // keep recent
        const month = tag.slice(0, 7); // YYYY-MM
        if (!monthBuckets[month]) monthBuckets[month] = [];
        monthBuckets[month].push(tag);
      }

      for (const [month, tags] of Object.entries(monthBuckets)) {
        const summaryPath = path.join(SUMMARY_DIR, `${month}.json`);
        let summary;
        try {
          summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
        } catch {
          summary = { month, totalEarnings: 0, totalTasks: 0, avgHashrate: 0, avgUptime: 0, avgLatency: 0, samples: 0, workers: {}, providers: {}, days: 0 };
        }

        for (const tag of tags) {
          const dayData = this._loadDayFile(tag);
          if (!dayData || !dayData.length) continue;

          summary.days++;
          for (const e of dayData) {
            summary.totalEarnings += e.earnings || 0;
            summary.totalTasks += e.tasks || 0;
            const n = summary.samples + 1;
            summary.avgHashrate += ((e.hashrate || 0) - summary.avgHashrate) / n;
            summary.avgUptime += ((e.uptime || 0) - summary.avgUptime) / n;
            summary.avgLatency += ((e.latency || 0) - summary.avgLatency) / n;
            summary.samples = n;

            // Per-worker summary
            if (!summary.workers[e.worker]) summary.workers[e.worker] = { earnings: 0, tasks: 0, samples: 0 };
            summary.workers[e.worker].earnings += e.earnings || 0;
            summary.workers[e.worker].tasks += e.tasks || 0;
            summary.workers[e.worker].samples++;

            // Per-provider summary
            if (!summary.providers[e.provider]) summary.providers[e.provider] = { earnings: 0, tasks: 0, samples: 0 };
            summary.providers[e.provider].earnings += e.earnings || 0;
            summary.providers[e.provider].tasks += e.tasks || 0;
            summary.providers[e.provider].samples++;
          }

          // Delete compacted daily file
          try { fs.unlinkSync(this._dayFilePath(tag)); } catch {}
        }

        // Round floats
        summary.totalEarnings = +summary.totalEarnings.toFixed(8);
        summary.avgHashrate = +summary.avgHashrate.toFixed(2);
        summary.avgUptime = +summary.avgUptime.toFixed(2);
        summary.avgLatency = +summary.avgLatency.toFixed(1);

        fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
        this.emit('log', `Compacted ${tags.length} days into ${month} summary`);
      }
    } catch (e) {
      this.emit('log', `Compaction error: ${e.message}`);
    }
  }

  // ── Helpers ──

  _jsonRes(res, code, data) {
    if (res.headersSent || res.writableEnded) return;
    const body = JSON.stringify(data);
    res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(body);
  }
}

module.exports = SwarmAnalytics;
