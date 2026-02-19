// ============================================================================
// Aries Network Health Monitor — core/network-health.js
// Real-time throughput, alerts, daily/weekly reports, Telegram integration
// ============================================================================

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const EventEmitter = require('events');

const REPORTS_DIR = path.join(__dirname, '..', 'data', 'reports');
const HEALTH_FILE = path.join(__dirname, '..', 'data', 'network-health.json');

class NetworkHealth extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.memberTracker = opts.memberTracker;
    this.config = opts.config || {};
    this.metrics = {
      tasksPerMinute: [],   // rolling window [{t, count}]
      hashPerMinute: [],    // rolling window [{t, hash}]
      alerts: [],           // recent alerts
      dailySnapshots: [],   // daily summary snapshots
    };
    this.thresholds = {
      minOnlineWorkers: opts.minOnlineWorkers || 5,
      hashrateDropPct: opts.hashrateDropPct || 30,
    };
    this._lastTaskCount = 0;
    this._lastHashrate = 0;
    this._load();
    this._startMonitoring();
  }

  _load() {
    try { 
      const d = JSON.parse(fs.readFileSync(HEALTH_FILE, 'utf8'));
      if (d.metrics) Object.assign(this.metrics, d.metrics);
    } catch {}
  }

  _save() {
    try {
      if (!fs.existsSync(path.dirname(HEALTH_FILE))) fs.mkdirSync(path.dirname(HEALTH_FILE), { recursive: true });
      fs.writeFileSync(HEALTH_FILE, JSON.stringify({ metrics: this.metrics }, null, 2));
    } catch {}
  }

  _startMonitoring() {
    // Sample every 60 seconds
    this._sampleInterval = setInterval(() => this._sample(), 60000);
    // Daily report at midnight-ish (check every hour)
    this._reportInterval = setInterval(() => this._checkDailyReport(), 3600000);
  }

  _sample() {
    if (!this.memberTracker) return;
    const now = Date.now();
    const stats = this.memberTracker.getStats();

    // Tasks per minute (delta from last)
    const taskDelta = stats.totalTasks - this._lastTaskCount;
    this._lastTaskCount = stats.totalTasks;
    this.metrics.tasksPerMinute.push({ t: now, count: taskDelta });
    if (this.metrics.tasksPerMinute.length > 1440) this.metrics.tasksPerMinute = this.metrics.tasksPerMinute.slice(-1440);

    // Hash per minute
    this.metrics.hashPerMinute.push({ t: now, hash: stats.totalHashrate });
    if (this.metrics.hashPerMinute.length > 1440) this.metrics.hashPerMinute = this.metrics.hashPerMinute.slice(-1440);

    // Check alerts
    if (stats.onlineCount < this.thresholds.minOnlineWorkers) {
      this._alert('low_workers', `Only ${stats.onlineCount} workers online (threshold: ${this.thresholds.minOnlineWorkers})`);
    }

    // Hashrate drop check
    if (this._lastHashrate > 0 && stats.totalHashrate > 0) {
      const dropPct = ((this._lastHashrate - stats.totalHashrate) / this._lastHashrate) * 100;
      if (dropPct > this.thresholds.hashrateDropPct) {
        this._alert('hashrate_drop', `Hashrate dropped ${dropPct.toFixed(1)}% (${this._lastHashrate} → ${stats.totalHashrate} H/s)`);
      }
    }
    this._lastHashrate = stats.totalHashrate;

    this._save();
  }

  _alert(type, message) {
    const alert = { type, message, timestamp: Date.now() };
    this.metrics.alerts.push(alert);
    if (this.metrics.alerts.length > 200) this.metrics.alerts = this.metrics.alerts.slice(-200);
    this.emit('alert', alert);

    // Telegram notification
    this._sendTelegramAlert(message);
  }

  _sendTelegramAlert(message) {
    const tgConfig = this.config.miner?.telegram || this.config.telegram;
    if (!tgConfig || !tgConfig.botToken || !tgConfig.chatId) return;

    const text = `⚠️ ARIES NETWORK ALERT\n${message}\n${new Date().toISOString()}`;
    const postData = JSON.stringify({ chat_id: tgConfig.chatId, text, parse_mode: 'HTML' });

    try {
      const req = https.request({
        hostname: 'api.telegram.org',
        path: `/bot${tgConfig.botToken}/sendMessage`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': postData.length },
        timeout: 10000,
      });
      req.on('error', () => {});
      req.write(postData);
      req.end();
    } catch {}
  }

  _checkDailyReport() {
    const now = new Date();
    const lastSnapshot = this.metrics.dailySnapshots[this.metrics.dailySnapshots.length - 1];
    if (lastSnapshot) {
      const lastDate = new Date(lastSnapshot.date);
      if (lastDate.toDateString() === now.toDateString()) return; // Already done today
    }

    this._generateReport('daily');
  }

  _generateReport(type) {
    if (!this.memberTracker) return null;
    const stats = this.memberTracker.getStats();
    const revenue = this.memberTracker.getRevenueEstimate();
    const now = new Date();

    const report = {
      type,
      date: now.toISOString(),
      dateStr: now.toDateString(),
      totalMembers: stats.totalMembers,
      onlineCount: stats.onlineCount,
      totalHashrate: stats.totalHashrate,
      totalTasks: stats.totalTasks,
      totalCpuHours: stats.totalCpuHours,
      newMembers: type === 'daily' ? stats.newToday : type === 'weekly' ? stats.newWeek : stats.newMonth,
      estimatedRevenue: revenue,
      avgTasksPerMinute: this._avgMetric(this.metrics.tasksPerMinute, 'count'),
      avgHashrate: this._avgMetric(this.metrics.hashPerMinute, 'hash'),
      alertCount: this.metrics.alerts.filter(a => {
        const cutoff = type === 'daily' ? 86400000 : type === 'weekly' ? 604800000 : 2592000000;
        return Date.now() - a.timestamp < cutoff;
      }).length,
    };

    // Save report to file
    if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
    const filename = `${type}-${now.toISOString().split('T')[0]}.json`;
    try { fs.writeFileSync(path.join(REPORTS_DIR, filename), JSON.stringify(report, null, 2)); } catch {}

    this.metrics.dailySnapshots.push(report);
    if (this.metrics.dailySnapshots.length > 365) this.metrics.dailySnapshots = this.metrics.dailySnapshots.slice(-365);
    this._save();

    // Send Telegram summary
    const summary = `📊 ARIES ${type.toUpperCase()} REPORT\n` +
      `Members: ${stats.totalMembers} (${stats.onlineCount} online)\n` +
      `Hashrate: ${stats.totalHashrate} H/s\n` +
      `Tasks: ${stats.totalTasks}\n` +
      `Est. Revenue: ${revenue.projectedMonthlySol} SOL/mo\n` +
      `New members: ${report.newMembers}`;
    this._sendTelegramAlert(summary);

    return report;
  }

  _avgMetric(arr, key) {
    if (!arr.length) return 0;
    const recent = arr.slice(-60); // last hour
    return recent.reduce((s, x) => s + (x[key] || 0), 0) / recent.length;
  }

  // Get current throughput
  getThroughput() {
    return {
      tasksPerMinute: this._avgMetric(this.metrics.tasksPerMinute, 'count'),
      hashPerMinute: this._avgMetric(this.metrics.hashPerMinute, 'hash'),
      recentAlerts: this.metrics.alerts.slice(-20),
      tasksHistory: this.metrics.tasksPerMinute.slice(-60),
      hashHistory: this.metrics.hashPerMinute.slice(-60),
    };
  }

  // Get reports
  getReports() {
    try {
      if (!fs.existsSync(REPORTS_DIR)) return [];
      return fs.readdirSync(REPORTS_DIR).filter(f => f.endsWith('.json')).map(f => {
        try { return JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, f), 'utf8')); } catch { return null; }
      }).filter(Boolean);
    } catch { return []; }
  }

  // Generate on-demand report
  generateReport(type = 'daily') {
    return this._generateReport(type);
  }

  stop() {
    if (this._sampleInterval) clearInterval(this._sampleInterval);
    if (this._reportInterval) clearInterval(this._reportInterval);
  }
}

module.exports = NetworkHealth;
