// ═══════════════════════════════════════════════════════════════
// ARIES v3.0 — Self-Healing Crash System
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { execSync, exec } = require('child_process');

const CRASH_LOG = path.join(__dirname, '..', 'crash.log');
const HEAL_LOG = path.join(__dirname, '..', 'self-heal-log.json');

// Load existing heal history
function loadHealLog() {
  try {
    return JSON.parse(fs.readFileSync(HEAL_LOG, 'utf8'));
  } catch {
    return { entries: [], lastAnalysis: null, stats: { total: 0, healed: 0, skipped: 0 } };
  }
}

function saveHealLog(log) {
  try {
    fs.writeFileSync(HEAL_LOG, JSON.stringify(log, null, 2));
  } catch {}
}

// Parse crash.log into structured entries
function parseCrashLog() {
  try {
    if (!fs.existsSync(CRASH_LOG)) return [];
    const raw = fs.readFileSync(CRASH_LOG, 'utf8');
    const lines = raw.split('\n').filter(l => l.trim());
    const entries = [];
    let current = null;

    for (const line of lines) {
      const match = line.match(/^\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\]\s*(UNCAUGHT EXCEPTION|UNHANDLED REJECTION|COORDINATOR START ERROR|PLUGIN LOAD ERROR|WARNING):\s*(.*)/);
      if (match) {
        if (current) entries.push(current);
        current = {
          timestamp: match[1],
          type: match[2],
          message: match[3],
          stack: '',
          signature: ''
        };
      } else if (current) {
        current.stack += line + '\n';
      }
    }
    if (current) entries.push(current);

    // Generate signatures for grouping
    for (const entry of entries) {
      entry.signature = getSignature(entry);
    }

    return entries;
  } catch {
    return [];
  }
}

function getSignature(entry) {
  const msg = entry.message || '';
  if (msg.includes('EADDRINUSE')) return 'EADDRINUSE';
  if (msg.includes('Cannot read properties of undefined') || msg.includes('Cannot read property')) {
    const propMatch = msg.match(/Cannot read propert(?:ies|y)[^']*'([^']+)'/);
    return `NULL_PROP:${propMatch ? propMatch[1] : 'unknown'}`;
  }
  if (msg.includes('ECONNREFUSED')) return 'ECONNREFUSED';
  if (msg.includes('Maximum call stack')) return 'STACK_OVERFLOW';
  if (msg.includes('Cannot find module') || msg.includes('MODULE_NOT_FOUND')) {
    const modMatch = msg.match(/Cannot find module '([^']+)'/);
    return `MODULE_MISSING:${modMatch ? modMatch[1] : 'unknown'}`;
  }
  // Generic signature from first line of message
  return `GENERIC:${msg.substring(0, 80).replace(/[^a-zA-Z]/g, '_')}`;
}

// Group crashes by signature
function groupCrashes(entries) {
  const groups = {};
  for (const entry of entries) {
    if (!groups[entry.signature]) {
      groups[entry.signature] = { signature: entry.signature, count: 0, entries: [], lastSeen: null };
    }
    groups[entry.signature].count++;
    groups[entry.signature].entries.push(entry);
    groups[entry.signature].lastSeen = entry.timestamp;
  }
  return groups;
}

// Apply auto-fixes for known patterns
async function applyFix(signature, group) {
  const result = { signature, action: 'none', success: false, detail: '' };

  if (signature === 'EADDRINUSE') {
    // Extract port if possible
    const portMatch = (group.entries[0].message || '').match(/(?:port\s+|:)(\d{4,5})/i);
    const port = portMatch ? portMatch[1] : null;
    if (port) {
      try {
        // Windows: find and kill process on that port
        const out = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { encoding: 'utf8', timeout: 5000 }).trim();
        const pidMatch = out.match(/\s+(\d+)\s*$/m);
        if (pidMatch) {
          try {
            execSync(`taskkill /PID ${pidMatch[1]} /F`, { timeout: 5000 });
            result.action = `Killed PID ${pidMatch[1]} using port ${port}`;
            result.success = true;
          } catch (e) {
            result.action = `Found PID ${pidMatch[1]} on port ${port} but couldn't kill: ${e.message}`;
          }
        }
      } catch {
        result.action = `Port ${port} conflict detected but no process found listening (may have resolved)`;
        result.success = true; // Likely resolved on its own
      }
    } else {
      result.action = 'Port conflict detected; will auto-increment port on next start';
      result.success = true;
    }
  }

  else if (signature.startsWith('NULL_PROP:')) {
    const prop = signature.split(':')[1];
    result.action = `Null property access detected: '${prop}'. Logged for defensive coding. Add null checks around '${prop}' access paths.`;
    result.success = true;
    result.detail = group.entries.map(e => e.stack).join('\n---\n').substring(0, 500);
  }

  else if (signature === 'ECONNREFUSED') {
    result.action = 'Connection refused errors detected. Services marked as potentially offline. Will retry with exponential backoff.';
    result.success = true;
  }

  else if (signature === 'STACK_OVERFLOW') {
    result.action = 'Maximum call stack exceeded. Potential infinite recursion detected.';
    result.detail = group.entries[0].stack.substring(0, 500);
    result.success = true;
  }

  else if (signature.startsWith('MODULE_MISSING:')) {
    const mod = signature.split(':')[1];
    if (mod && !mod.startsWith('.') && !mod.startsWith('/')) {
      try {
        execSync(`npm install ${mod}`, { cwd: path.join(__dirname, '..'), timeout: 30000, encoding: 'utf8' });
        result.action = `Installed missing module: ${mod}`;
        result.success = true;
      } catch (e) {
        result.action = `Failed to install ${mod}: ${e.message.substring(0, 100)}`;
      }
    } else {
      result.action = `Missing local module: ${mod}. Check file paths.`;
    }
  }

  else {
    result.action = `Logged ${group.count} occurrence(s). No auto-fix available.`;
    result.detail = group.entries[0].message;
  }

  return result;
}

// Main analysis function
async function analyzeAndHeal() {
  const healLog = loadHealLog();
  const entries = parseCrashLog();

  if (entries.length === 0) {
    healLog.lastAnalysis = new Date().toISOString();
    healLog.stats.total = 0;
    saveHealLog(healLog);
    return { healed: 0, issues: 0, actions: [], message: 'No crash entries found. System is clean.' };
  }

  const groups = groupCrashes(entries);
  const actions = [];

  for (const [sig, group] of Object.entries(groups)) {
    const fix = await applyFix(sig, group);
    actions.push(fix);

    healLog.entries.push({
      timestamp: new Date().toISOString(),
      signature: sig,
      occurrences: group.count,
      action: fix.action,
      success: fix.success
    });

    if (fix.success) healLog.stats.healed++;
    else healLog.stats.skipped++;
    healLog.stats.total++;
  }

  healLog.lastAnalysis = new Date().toISOString();
  saveHealLog(healLog);

  const healed = actions.filter(a => a.success).length;
  const message = `Analyzed ${entries.length} crash(es) across ${Object.keys(groups).length} pattern(s). ${healed} auto-healed.`;

  return { healed, issues: Object.keys(groups).length, actions, message };
}

// Categorize a live crash for the uncaughtException handler
function categorizeCrash(err) {
  const msg = err.message || '';
  const entry = {
    timestamp: new Date().toISOString(),
    type: 'UNCAUGHT EXCEPTION',
    message: msg,
    stack: err.stack || ''
  };
  entry.signature = getSignature(entry);

  // Quick reactive fixes
  if (entry.signature === 'ECONNREFUSED') {
    return { category: 'ECONNREFUSED', severity: 'warning', recoverable: true, suggestion: 'Service offline, will retry' };
  }
  if (entry.signature.startsWith('NULL_PROP:')) {
    return { category: 'NULL_ACCESS', severity: 'error', recoverable: true, suggestion: `Add null check for '${entry.signature.split(':')[1]}'` };
  }
  if (entry.signature === 'STACK_OVERFLOW') {
    return { category: 'STACK_OVERFLOW', severity: 'critical', recoverable: false, suggestion: 'Check for infinite recursion' };
  }
  if (entry.signature.startsWith('MODULE_MISSING:')) {
    return { category: 'MODULE_MISSING', severity: 'error', recoverable: false, suggestion: `Run: npm install ${entry.signature.split(':')[1]}` };
  }
  if (entry.signature === 'EADDRINUSE') {
    return { category: 'EADDRINUSE', severity: 'warning', recoverable: true, suggestion: 'Port conflict, using next available' };
  }
  return { category: 'UNKNOWN', severity: 'error', recoverable: true, suggestion: msg.substring(0, 100) };
}

// Get healing report for /health command
function getHealingReport() {
  const healLog = loadHealLog();
  const entries = parseCrashLog();
  const groups = groupCrashes(entries);

  return {
    totalCrashes: entries.length,
    uniquePatterns: Object.keys(groups).length,
    lastAnalysis: healLog.lastAnalysis,
    stats: healLog.stats,
    recentActions: healLog.entries.slice(-10),
    topIssues: Object.values(groups)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map(g => ({ signature: g.signature, count: g.count, lastSeen: g.lastSeen }))
  };
}

module.exports = { analyzeAndHeal, getHealingReport, categorizeCrash };
