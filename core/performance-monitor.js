'use strict';

const os = require('os');

class PerformanceMonitor {
  constructor(opts = {}) {
    this._interval = opts.interval || 15000;
    this._historyMax = opts.historyMax || 240; // 1 hour at 15s intervals
    this._timer = null;
    this._history = [];
    this._alerts = [];
    this._maxAlerts = 100;
    this._thresholds = {
      cpuPercent: opts.cpuThreshold || 90,
      memoryPercent: opts.memoryThreshold || 90,
      ...opts.thresholds,
    };
    this._lastCpus = null;
    this._customMetrics = {};
  }

  start() {
    if (this._timer) return;
    this._lastCpus = os.cpus();
    this._timer = setInterval(() => this._collect(), this._interval);
    this._collect();
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  _getCpuUsage() {
    const cpus = os.cpus();
    if (!this._lastCpus) {
      this._lastCpus = cpus;
      return 0;
    }
    let totalIdle = 0, totalTick = 0;
    for (let i = 0; i < cpus.length; i++) {
      const prev = this._lastCpus[i] ? this._lastCpus[i].times : cpus[i].times;
      const curr = cpus[i].times;
      for (const type of Object.keys(curr)) {
        totalTick += curr[type] - (prev[type] || 0);
      }
      totalIdle += curr.idle - (prev.idle || 0);
    }
    this._lastCpus = cpus;
    return totalTick > 0 ? Math.round((1 - totalIdle / totalTick) * 100) : 0;
  }

  _collect() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const cpuPercent = this._getCpuUsage();
    const memPercent = Math.round(usedMem / totalMem * 100);

    const snapshot = {
      timestamp: Date.now(),
      cpu: {
        percent: cpuPercent,
        cores: os.cpus().length,
        loadAvg: os.loadavg(),
      },
      memory: {
        total: totalMem,
        used: usedMem,
        free: freeMem,
        percent: memPercent,
      },
      process: {
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        pid: process.pid,
      },
      custom: { ...this._customMetrics },
    };

    this._history.push(snapshot);
    if (this._history.length > this._historyMax) {
      this._history = this._history.slice(-this._historyMax);
    }

    // Check thresholds
    if (cpuPercent >= this._thresholds.cpuPercent) {
      this._addAlert('cpu_high', `CPU at ${cpuPercent}% (threshold: ${this._thresholds.cpuPercent}%)`);
    }
    if (memPercent >= this._thresholds.memoryPercent) {
      this._addAlert('memory_high', `Memory at ${memPercent}% (threshold: ${this._thresholds.memoryPercent}%)`);
    }

    return snapshot;
  }

  _addAlert(type, message) {
    this._alerts.push({ type, message, timestamp: Date.now() });
    if (this._alerts.length > this._maxAlerts) {
      this._alerts = this._alerts.slice(-this._maxAlerts);
    }
  }

  getMetrics() {
    if (this._history.length === 0) {
      return this._collect();
    }
    return this._history[this._history.length - 1];
  }

  getHistory(minutes) {
    if (!minutes) return [...this._history];
    const cutoff = Date.now() - minutes * 60000;
    return this._history.filter(s => s.timestamp >= cutoff);
  }

  getAlerts(since) {
    if (!since) return [...this._alerts];
    return this._alerts.filter(a => a.timestamp >= since);
  }

  setCustomMetric(name, value) {
    this._customMetrics[name] = value;
  }

  clearAlerts() {
    this._alerts = [];
  }

  isRunning() {
    return this._timer !== null;
  }
}

module.exports = { PerformanceMonitor };
