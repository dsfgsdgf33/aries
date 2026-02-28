/**
 * ARIES — Self-Healing System
 * Auto-crash detection, diagnosis, patching, and restart.
 * Monitors health metrics, captures crash post-mortems, and attempts auto-fixes.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'healing');
const CRASHES_PATH = path.join(DATA_DIR, 'crashes.json');
const HEALTH_PATH = path.join(DATA_DIR, 'health.json');

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }

// Auto-fixable error patterns
const AUTO_FIX_PATTERNS = [
  { pattern: /Cannot read propert(?:y|ies) of (undefined|null)/i, type: 'null-check', description: 'Missing null/undefined check' },
  { pattern: /is not a function/i, type: 'type-error', description: 'Type mismatch — calling non-function' },
  { pattern: /Unexpected token.*in JSON/i, type: 'json-parse', description: 'Malformed JSON input' },
  { pattern: /ENOENT.*no such file/i, type: 'missing-file', description: 'Missing file or directory' },
  { pattern: /Cannot find module/i, type: 'missing-module', description: 'Missing module dependency' },
  { pattern: /EADDRINUSE/i, type: 'port-conflict', description: 'Port already in use' },
];

class SelfHealing {
  constructor(opts) {
    this.ai = opts && opts.ai;
    this._healthInterval = null;
    this._healthMetrics = {
      memoryUsageMb: 0,
      heapUsedMb: 0,
      heapTotalMb: 0,
      eventLoopLagMs: 0,
      uptime: 0,
      cpuUsage: null,
      lastCheck: null,
      status: 'healthy',
    };
    this._recentLogs = [];
    this._maxLogs = 200;
    this._installed = false;
    ensureDir();
  }

  /**
   * Install global crash handlers and start health monitoring.
   */
  install() {
    if (this._installed) return;
    this._installed = true;

    // Intercept console.error for recent logs
    const origError = console.error;
    const self = this;
    console.error = function(...args) {
      self._captureLog('error', args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '));
      origError.apply(console, args);
    };

    // Uncaught exceptions
    process.on('uncaughtException', (err) => {
      console.error('[SELF-HEALING] Uncaught exception:', err.message);
      this._handleCrash(err, 'uncaughtException').catch(() => {});
    });

    // Unhandled rejections
    process.on('unhandledRejection', (reason) => {
      const err = reason instanceof Error ? reason : new Error(String(reason));
      console.error('[SELF-HEALING] Unhandled rejection:', err.message);
      this._handleCrash(err, 'unhandledRejection').catch(() => {});
    });

    // Start health monitoring
    this.startHealthMonitor();
    console.log('[SELF-HEALING] Installed crash handlers and health monitor');
  }

  /**
   * Start periodic health monitoring (every 60s).
   */
  startHealthMonitor() {
    if (this._healthInterval) return;
    this._checkHealth(); // immediate first check
    this._healthInterval = setInterval(() => this._checkHealth(), 60000);
    if (this._healthInterval.unref) this._healthInterval.unref();
  }

  /**
   * Stop health monitoring.
   */
  stopHealthMonitor() {
    if (this._healthInterval) {
      clearInterval(this._healthInterval);
      this._healthInterval = null;
    }
  }

  // ── Health Check ──
  _checkHealth() {
    const mem = process.memoryUsage();
    const now = Date.now();

    // Event loop lag measurement
    const lagStart = process.hrtime.bigint();
    setImmediate(() => {
      const lagEnd = process.hrtime.bigint();
      const lagMs = Number(lagEnd - lagStart) / 1e6;

      this._healthMetrics = {
        memoryUsageMb: Math.round(mem.rss / 1024 / 1024 * 10) / 10,
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024 * 10) / 10,
        heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024 * 10) / 10,
        externalMb: Math.round((mem.external || 0) / 1024 / 1024 * 10) / 10,
        eventLoopLagMs: Math.round(lagMs * 100) / 100,
        uptime: Math.round(process.uptime()),
        cpuUsage: process.cpuUsage ? process.cpuUsage() : null,
        lastCheck: now,
        status: this._determineStatus(mem, lagMs),
      };

      // Persist health snapshot
      writeJSON(HEALTH_PATH, { ...this._healthMetrics, timestamp: now });
    });
  }

  _determineStatus(mem, lagMs) {
    const heapMb = mem.heapUsed / 1024 / 1024;
    if (heapMb > 1500 || lagMs > 500) return 'critical';
    if (heapMb > 800 || lagMs > 200) return 'degraded';
    if (heapMb > 500 || lagMs > 100) return 'warning';
    return 'healthy';
  }

  _captureLog(level, msg) {
    this._recentLogs.push({ level, msg, ts: Date.now() });
    if (this._recentLogs.length > this._maxLogs) {
      this._recentLogs = this._recentLogs.slice(-this._maxLogs / 2);
    }
  }

  // ── Crash Handling ──
  async _handleCrash(error, source) {
    const crashEntry = {
      id: uuid(),
      timestamp: Date.now(),
      date: new Date().toISOString(),
      source,
      error: error.message || String(error),
      stackTrace: error.stack || '',
      recentLogs: this._recentLogs.slice(-20),
      systemState: { ...this._healthMetrics },
      diagnosis: null,
      autoFixed: false,
      patch: null,
      testWritten: null,
    };

    // Diagnose
    crashEntry.diagnosis = this._diagnose(error);

    // Attempt auto-fix if applicable
    if (crashEntry.diagnosis.autoFixable) {
      const fixResult = await this._attemptAutoFix(error, crashEntry.diagnosis);
      crashEntry.autoFixed = fixResult.success;
      crashEntry.patch = fixResult.patch || null;
      crashEntry.testWritten = fixResult.testPath || null;
      crashEntry.fixDetails = fixResult.details || '';
    }

    // Store crash
    const crashes = readJSON(CRASHES_PATH, []);
    crashes.push(crashEntry);
    // Keep last 500 crashes
    if (crashes.length > 500) crashes.splice(0, crashes.length - 500);
    writeJSON(CRASHES_PATH, crashes);

    return crashEntry;
  }

  _diagnose(error) {
    const msg = (error.message || '') + '\n' + (error.stack || '');
    const diagnosis = {
      autoFixable: false,
      type: 'unknown',
      description: 'Unrecognized error pattern',
      affectedFile: null,
      affectedLine: null,
      severity: 'high',
      recommendation: 'Manual investigation required',
    };

    // Match against known patterns
    for (const pat of AUTO_FIX_PATTERNS) {
      if (pat.pattern.test(msg)) {
        diagnosis.type = pat.type;
        diagnosis.description = pat.description;
        diagnosis.autoFixable = ['null-check', 'json-parse', 'missing-file'].includes(pat.type);
        break;
      }
    }

    // Extract file/line from stack trace
    const stackMatch = (error.stack || '').match(/at\s+.*\((.+):(\d+):(\d+)\)/);
    if (stackMatch) {
      diagnosis.affectedFile = stackMatch[1];
      diagnosis.affectedLine = parseInt(stackMatch[2], 10);
    }

    // Severity based on type
    if (diagnosis.type === 'port-conflict') diagnosis.severity = 'low';
    else if (diagnosis.type === 'missing-file') diagnosis.severity = 'medium';
    else if (diagnosis.type === 'null-check') diagnosis.severity = 'medium';

    // Recommendation
    const recommendations = {
      'null-check': 'Add optional chaining or null guard before property access',
      'type-error': 'Verify the value is the expected type before calling',
      'json-parse': 'Wrap JSON.parse in try/catch with fallback',
      'missing-file': 'Ensure directory/file exists before access, create if needed',
      'missing-module': 'Install the missing module or add fallback require',
      'port-conflict': 'Use a different port or kill the conflicting process',
    };
    diagnosis.recommendation = recommendations[diagnosis.type] || diagnosis.recommendation;

    return diagnosis;
  }

  async _attemptAutoFix(error, diagnosis) {
    const result = { success: false, patch: null, testPath: null, details: '' };

    if (!diagnosis.affectedFile || !diagnosis.affectedLine) {
      result.details = 'Cannot auto-fix: no file/line info in stack trace';
      return result;
    }

    // Only auto-fix files within the aries directory
    const ariesRoot = path.join(__dirname, '..');
    if (!diagnosis.affectedFile.startsWith(ariesRoot) && !diagnosis.affectedFile.includes('aries')) {
      result.details = 'Cannot auto-fix: affected file is outside aries codebase';
      return result;
    }

    try {
      if (!fs.existsSync(diagnosis.affectedFile)) {
        result.details = 'Cannot auto-fix: affected file does not exist';
        return result;
      }

      const content = fs.readFileSync(diagnosis.affectedFile, 'utf8');
      const lines = content.split('\n');
      const lineIdx = diagnosis.affectedLine - 1;

      if (lineIdx < 0 || lineIdx >= lines.length) {
        result.details = 'Cannot auto-fix: line number out of range';
        return result;
      }

      let patched = null;
      const originalLine = lines[lineIdx];

      if (diagnosis.type === 'null-check') {
        // Add optional chaining: obj.prop → obj?.prop
        const dotAccess = originalLine.match(/(\w+)\.(\w+)/);
        if (dotAccess) {
          lines[lineIdx] = originalLine.replace(/(\w+)\.(\w+)/, '$1?.$2');
          patched = lines.join('\n');
        }
      } else if (diagnosis.type === 'json-parse') {
        // Wrap JSON.parse in try/catch
        if (originalLine.includes('JSON.parse')) {
          const indent = originalLine.match(/^(\s*)/)[1];
          lines[lineIdx] = `${indent}try { ${originalLine.trim()} } catch(_parseErr) { /* auto-healed */ }`;
          patched = lines.join('\n');
        }
      } else if (diagnosis.type === 'missing-file') {
        // Add directory creation before file access
        const indent = originalLine.match(/^(\s*)/)[1];
        const dirLine = `${indent}try { require('fs').mkdirSync(require('path').dirname(${JSON.stringify(diagnosis.affectedFile)}), { recursive: true }); } catch(_) {}`;
        lines.splice(lineIdx, 0, dirLine);
        patched = lines.join('\n');
      }

      if (patched) {
        // Create backup before patching
        const backupPath = diagnosis.affectedFile + '.heal-backup-' + Date.now();
        fs.writeFileSync(backupPath, content);

        // Apply patch
        fs.writeFileSync(diagnosis.affectedFile, patched);

        result.success = true;
        result.patch = {
          file: diagnosis.affectedFile,
          backup: backupPath,
          originalLine,
          patchedLine: lines[lineIdx],
          lineNumber: diagnosis.affectedLine,
        };
        result.details = 'Auto-fix applied: ' + diagnosis.description;

        console.log('[SELF-HEALING] Auto-fix applied to ' + path.basename(diagnosis.affectedFile) + ':' + diagnosis.affectedLine);
      } else {
        result.details = 'Could not generate patch for this error pattern';
      }
    } catch (e) {
      result.details = 'Auto-fix failed: ' + e.message;
    }

    return result;
  }

  // ── Public API ──

  /**
   * Get current health status and metrics.
   */
  getHealthStatus() {
    return {
      ...this._healthMetrics,
      installed: this._installed,
      recentLogCount: this._recentLogs.length,
    };
  }

  /**
   * Get crash history.
   */
  getCrashHistory(limit) {
    const crashes = readJSON(CRASHES_PATH, []);
    const sorted = crashes.sort((a, b) => b.timestamp - a.timestamp);
    return limit ? sorted.slice(0, limit) : sorted;
  }

  /**
   * Get healing statistics.
   */
  getHealingStats() {
    const crashes = readJSON(CRASHES_PATH, []);
    const totalCrashes = crashes.length;
    const autoFixed = crashes.filter(c => c.autoFixed).length;
    const needsAttention = crashes.filter(c => !c.autoFixed).length;

    // Mean time to recovery (for auto-fixed)
    let mttrMs = 0;
    const fixedCrashes = crashes.filter(c => c.autoFixed && c.timestamp);
    if (fixedCrashes.length > 0) {
      // Estimate MTTR as time between consecutive crashes (simplified)
      mttrMs = fixedCrashes.length > 1
        ? (fixedCrashes[fixedCrashes.length - 1].timestamp - fixedCrashes[0].timestamp) / fixedCrashes.length
        : 1000; // instant fix
    }

    // Error type breakdown
    const byType = {};
    for (const c of crashes) {
      const t = (c.diagnosis && c.diagnosis.type) || 'unknown';
      byType[t] = (byType[t] || 0) + 1;
    }

    // Recent crashes (last 24h)
    const dayAgo = Date.now() - 86400000;
    const recent24h = crashes.filter(c => c.timestamp > dayAgo).length;

    return {
      totalCrashes,
      autoFixed,
      autoFixRate: totalCrashes > 0 ? Math.round(autoFixed / totalCrashes * 100) : 0,
      needsAttention,
      mttrMs: Math.round(mttrMs),
      byType,
      recent24h,
      healthStatus: this._healthMetrics.status,
    };
  }

  /**
   * Manually report a crash for tracking.
   */
  reportCrash(error, source) {
    const err = error instanceof Error ? error : new Error(String(error));
    return this._handleCrash(err, source || 'manual');
  }
}

module.exports = SelfHealing;
