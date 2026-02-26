'use strict';

class ShellDiagnostics {
  constructor() {
    this._records = [];
    this._maxRecords = 5000;
    this._errorCategories = new Map();
  }

  record(command, result, duration) {
    const entry = {
      command: String(command).trim().substring(0, 500),
      success: !!(result && (result.code === 0 || result.code === undefined && !result.error)),
      code: result ? result.code : -1,
      duration: Number(duration) || 0,
      timestamp: Date.now(),
      error: result && result.stderr ? String(result.stderr).substring(0, 200) : null,
    };

    this._records.push(entry);

    if (this._records.length > this._maxRecords) {
      this._records = this._records.slice(-this._maxRecords);
    }

    if (!entry.success && entry.error) {
      this._categorizeError(entry);
    }

    return entry;
  }

  _categorizeError(entry) {
    const err = entry.error.toLowerCase();
    let category = 'unknown';
    if (err.includes('not found') || err.includes('not recognized') || err.includes('no such file')) {
      category = 'command_not_found';
    } else if (err.includes('permission') || err.includes('access denied') || err.includes('eacces')) {
      category = 'permission_denied';
    } else if (err.includes('timeout') || err.includes('timed out')) {
      category = 'timeout';
    } else if (err.includes('enomem') || err.includes('out of memory')) {
      category = 'out_of_memory';
    } else if (err.includes('enoent')) {
      category = 'file_not_found';
    } else if (err.includes('econnrefused') || err.includes('network')) {
      category = 'network_error';
    } else if (err.includes('syntax')) {
      category = 'syntax_error';
    }

    const count = this._errorCategories.get(category) || 0;
    this._errorCategories.set(category, count + 1);
  }

  getReport() {
    const total = this._records.length;
    if (total === 0) return { total: 0, message: 'No records' };

    const successes = this._records.filter(r => r.success).length;
    const failures = total - successes;
    const durations = this._records.filter(r => r.duration > 0).map(r => r.duration);
    const avgDuration = durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0;

    // Command frequency
    const cmdFreq = {};
    for (const r of this._records) {
      const base = r.command.split(/\s+/)[0];
      cmdFreq[base] = (cmdFreq[base] || 0) + 1;
    }
    const topCommands = Object.entries(cmdFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([cmd, count]) => ({ command: cmd, count }));

    return {
      total,
      successes,
      failures,
      successRate: (successes / total * 100).toFixed(1) + '%',
      avgDurationMs: avgDuration,
      topCommands,
      errorCategories: Object.fromEntries(this._errorCategories),
      oldestRecord: this._records[0] ? new Date(this._records[0].timestamp).toISOString() : null,
      newestRecord: this._records[total - 1] ? new Date(this._records[total - 1].timestamp).toISOString() : null,
    };
  }

  getFailureAnalysis() {
    const failures = this._records.filter(r => !r.success);
    if (failures.length === 0) return { total: 0, message: 'No failures recorded' };

    // Most failed commands
    const failFreq = {};
    for (const r of failures) {
      const base = r.command.split(/\s+/)[0];
      failFreq[base] = (failFreq[base] || 0) + 1;
    }
    const mostFailed = Object.entries(failFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([cmd, count]) => ({ command: cmd, count }));

    // Recent failures
    const recent = failures.slice(-5).map(r => ({
      command: r.command,
      error: r.error,
      timestamp: new Date(r.timestamp).toISOString(),
    }));

    return {
      total: failures.length,
      mostFailed,
      errorCategories: Object.fromEntries(this._errorCategories),
      recentFailures: recent,
    };
  }

  reset() {
    this._records = [];
    this._errorCategories.clear();
  }

  getRecords(limit) {
    return this._records.slice(-(limit || 100));
  }
}

const instance = new ShellDiagnostics();

module.exports = {
  record: (cmd, result, dur) => instance.record(cmd, result, dur),
  getReport: () => instance.getReport(),
  getFailureAnalysis: () => instance.getFailureAnalysis(),
  reset: () => instance.reset(),
  getRecords: (n) => instance.getRecords(n),
  ShellDiagnostics,
};
