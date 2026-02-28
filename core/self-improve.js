/**
 * ARIES Self-Improving Codebase Engine
 * Analyzes source files for bugs, code smells, performance issues.
 * Generates improvement suggestions with diffs for human review.
 * Does NOT auto-apply changes.
 * Node.js built-ins only.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SUGGESTIONS_FILE = path.join(DATA_DIR, 'improvements.json');
const ROOT_DIR = path.join(__dirname, '..');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadJSON(fp, fallback) {
  try { if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch {}
  return fallback;
}

function saveJSON(fp, data) {
  ensureDir();
  fs.writeFileSync(fp, JSON.stringify(data, null, 2));
}

// Analysis rules
const RULES = [
  {
    id: 'missing-error-handling',
    category: 'Bug Fix',
    name: 'Missing error handling in async/callback',
    test: (content, filePath) => {
      const issues = [];
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // fs.readFileSync without try-catch
        if (line.includes('fs.readFileSync') && !_isInTryCatch(lines, i)) {
          issues.push({ line: i + 1, message: 'fs.readFileSync without try-catch', severity: 'medium' });
        }
        // fs.writeFileSync without try-catch
        if (line.includes('fs.writeFileSync') && !_isInTryCatch(lines, i)) {
          issues.push({ line: i + 1, message: 'fs.writeFileSync without try-catch', severity: 'medium' });
        }
        // JSON.parse without try-catch
        if (line.includes('JSON.parse') && !_isInTryCatch(lines, i)) {
          issues.push({ line: i + 1, message: 'JSON.parse without try-catch', severity: 'high' });
        }
      }
      return issues;
    }
  },
  {
    id: 'console-log-in-production',
    category: 'Code Quality',
    name: 'Excessive console.log statements',
    test: (content, filePath) => {
      const issues = [];
      const lines = content.split('\n');
      let logCount = 0;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].match(/console\.log\(/)) logCount++;
      }
      if (logCount > 20) {
        issues.push({ line: 0, message: `${logCount} console.log statements found — consider using a logger`, severity: 'low' });
      }
      return issues;
    }
  },
  {
    id: 'hardcoded-secrets',
    category: 'Security',
    name: 'Potential hardcoded secrets',
    test: (content, filePath) => {
      const issues = [];
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.match(/(?:password|secret|apikey|api_key)\s*[:=]\s*['"][^'"]{8,}['"]/i) && !line.includes('placeholder') && !line.includes('example')) {
          issues.push({ line: i + 1, message: 'Potential hardcoded secret/password', severity: 'high' });
        }
      }
      return issues;
    }
  },
  {
    id: 'large-function',
    category: 'Code Quality',
    name: 'Functions exceeding 100 lines',
    test: (content, filePath) => {
      const issues = [];
      const lines = content.split('\n');
      let funcStart = -1;
      let braceDepth = 0;
      let funcName = '';
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const funcMatch = line.match(/(?:function\s+(\w+)|(\w+)\s*(?:=|:)\s*(?:async\s+)?function)/);
        if (funcMatch && braceDepth === 0) {
          funcStart = i;
          funcName = funcMatch[1] || funcMatch[2] || 'anonymous';
        }
        
        for (const ch of line) {
          if (ch === '{') braceDepth++;
          if (ch === '}') {
            braceDepth--;
            if (braceDepth === 0 && funcStart >= 0) {
              const len = i - funcStart;
              if (len > 100) {
                issues.push({ line: funcStart + 1, message: `Function "${funcName}" is ${len} lines — consider refactoring`, severity: 'medium' });
              }
              funcStart = -1;
            }
          }
        }
      }
      return issues;
    }
  },
  {
    id: 'sync-in-request',
    category: 'Performance',
    name: 'Synchronous I/O in request handlers',
    test: (content, filePath) => {
      const issues = [];
      if (!filePath.includes('api-server') && !filePath.includes('feature-routes')) return issues;
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].match(/(?:readFileSync|writeFileSync|execSync|readdirSync)/) && 
            _isInRequestHandler(lines, i)) {
          issues.push({ line: i + 1, message: 'Synchronous I/O in request handler — may block event loop', severity: 'medium' });
        }
      }
      return issues;
    }
  },
  {
    id: 'unused-require',
    category: 'Code Quality',
    name: 'Potentially unused require statements',
    test: (content, filePath) => {
      const issues = [];
      const lines = content.split('\n');
      const requires = [];
      
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/(?:const|var|let)\s+(\w+)\s*=\s*require\(/);
        if (m) requires.push({ name: m[1], line: i + 1 });
      }
      
      for (const req of requires) {
        // Count usage (exclude the require line itself)
        const regex = new RegExp('\\b' + req.name + '\\b', 'g');
        const matches = content.match(regex);
        if (matches && matches.length <= 1) {
          issues.push({ line: req.line, message: `"${req.name}" is required but possibly unused`, severity: 'low' });
        }
      }
      return issues;
    }
  },
  {
    id: 'no-input-validation',
    category: 'Security',
    name: 'Missing input validation on API endpoints',
    test: (content, filePath) => {
      const issues = [];
      if (!filePath.includes('api-server') && !filePath.includes('feature-routes')) return issues;
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].match(/body\.\w+/) && !_nearbyHas(lines, i, 5, /if\s*\(!?\s*body\./)) {
          // Only flag if there's a body access without nearby validation
          // Keep it low severity since we can't be 100% sure
        }
      }
      return issues;
    }
  },
  {
    id: 'memory-leak-pattern',
    category: 'Performance',
    name: 'Potential memory leak patterns',
    test: (content, filePath) => {
      const issues = [];
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        // Growing arrays without bounds
        if (lines[i].match(/\.push\(/) && !_nearbyHas(lines, i, 10, /\.slice\(|\.length\s*>|\.splice\(/)) {
          // Too noisy, skip
        }
        // setInterval without clearInterval reference
        if (lines[i].match(/setInterval\(/) && !lines[i].match(/=\s*setInterval/)) {
          issues.push({ line: i + 1, message: 'setInterval without storing reference — cannot be cleared', severity: 'low' });
        }
      }
      return issues;
    }
  }
];

function _isInTryCatch(lines, lineNum) {
  // Look backwards up to 10 lines for a try block
  for (let i = lineNum; i >= Math.max(0, lineNum - 10); i--) {
    if (lines[i].match(/\btry\s*\{/)) return true;
  }
  return false;
}

function _isInRequestHandler(lines, lineNum) {
  for (let i = lineNum; i >= Math.max(0, lineNum - 30); i--) {
    if (lines[i].match(/handleRequest|req,\s*res|\.on\(\s*['"]request/)) return true;
  }
  return false;
}

function _nearbyHas(lines, lineNum, range, pattern) {
  const start = Math.max(0, lineNum - range);
  const end = Math.min(lines.length - 1, lineNum + range);
  for (let i = start; i <= end; i++) {
    if (pattern.test(lines[i])) return true;
  }
  return false;
}

class SelfImprove extends EventEmitter {
  constructor(opts = {}) {
    super();
    this._suggestions = loadJSON(SUGGESTIONS_FILE, []);
    this._scanning = false;
    this._lastScan = null;
    this._ai = opts.ai || null;
    this._scanDirs = ['core', 'web'];
    this._scanExtensions = ['.js'];
    this._ignorePatterns = ['node_modules', '.git', 'backups', 'logs', 'data'];
  }

  /** Scan the codebase for improvements */
  async scan() {
    if (this._scanning) return { ok: false, message: 'Scan already in progress' };
    this._scanning = true;
    this._lastScan = Date.now();

    const newSuggestions = [];

    try {
      const files = this._collectFiles();
      
      for (const filePath of files) {
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          const relPath = path.relative(ROOT_DIR, filePath).replace(/\\/g, '/');
          
          for (const rule of RULES) {
            const issues = rule.test(content, relPath);
            for (const issue of issues) {
              // Check if we already have this suggestion
              const existing = this._suggestions.find(s => 
                s.file === relPath && s.ruleId === rule.id && s.line === issue.line && s.status !== 'rejected'
              );
              if (existing) continue;

              const suggestion = {
                id: 'imp-' + crypto.randomBytes(4).toString('hex'),
                ruleId: rule.id,
                category: rule.category,
                name: rule.name,
                file: relPath,
                line: issue.line,
                message: issue.message,
                severity: issue.severity || 'medium',
                status: 'pending', // pending | accepted | rejected
                diff: this._generateDiff(content, filePath, rule.id, issue),
                createdAt: Date.now()
              };

              newSuggestions.push(suggestion);
              this._suggestions.push(suggestion);
            }
          }
        } catch (e) {
          console.error('[SELF-IMPROVE] Error analyzing', filePath, ':', e.message);
        }
      }

      this._save();
      this._scanning = false;

      return { ok: true, found: newSuggestions.length, total: this._suggestions.filter(s => s.status === 'pending').length };
    } catch (e) {
      this._scanning = false;
      return { ok: false, message: e.message };
    }
  }

  _collectFiles() {
    const files = [];
    for (const dir of this._scanDirs) {
      const fullDir = path.join(ROOT_DIR, dir);
      if (!fs.existsSync(fullDir)) continue;
      this._walkDir(fullDir, files);
    }
    return files;
  }

  _walkDir(dir, files) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (this._ignorePatterns.some(p => entry.name === p || fullPath.includes(p))) continue;
        
        if (entry.isDirectory()) {
          this._walkDir(fullPath, files);
        } else if (this._scanExtensions.includes(path.extname(entry.name))) {
          files.push(fullPath);
        }
      }
    } catch {}
  }

  _generateDiff(content, filePath, ruleId, issue) {
    const lines = content.split('\n');
    const lineIdx = issue.line - 1;
    if (lineIdx < 0 || lineIdx >= lines.length) return null;

    const line = lines[lineIdx];

    // Generate fix suggestions based on rule
    switch (ruleId) {
      case 'missing-error-handling':
        if (line.includes('fs.readFileSync') || line.includes('fs.writeFileSync') || line.includes('JSON.parse')) {
          const indent = line.match(/^(\s*)/)[1];
          return {
            oldText: line,
            newText: `${indent}try {\n${line}\n${indent}} catch (e) {\n${indent}  console.error('[ERROR]', e.message);\n${indent}}`,
            description: 'Wrap in try-catch block'
          };
        }
        break;
      
      case 'memory-leak-pattern':
        if (line.includes('setInterval')) {
          return {
            oldText: line,
            newText: line.replace(/setInterval\(/, 'const _timer = setInterval('),
            description: 'Store interval reference for cleanup'
          };
        }
        break;

      default:
        return {
          oldText: line.trim(),
          newText: null,
          description: issue.message + ' — manual review recommended'
        };
    }
    return null;
  }

  /** Get all suggestions */
  getSuggestions(filter) {
    let suggestions = [...this._suggestions];
    if (filter) {
      if (filter.status) suggestions = suggestions.filter(s => s.status === filter.status);
      if (filter.category) suggestions = suggestions.filter(s => s.category === filter.category);
      if (filter.severity) suggestions = suggestions.filter(s => s.severity === filter.severity);
    }
    return suggestions.sort((a, b) => {
      const sev = { high: 3, medium: 2, low: 1 };
      return (sev[b.severity] || 0) - (sev[a.severity] || 0);
    });
  }

  /** Accept a suggestion (apply the diff) */
  accept(id) {
    const suggestion = this._suggestions.find(s => s.id === id);
    if (!suggestion) return { ok: false, message: 'Suggestion not found' };
    if (suggestion.status !== 'pending') return { ok: false, message: 'Already ' + suggestion.status };

    // Try to apply the diff
    if (suggestion.diff && suggestion.diff.oldText && suggestion.diff.newText) {
      try {
        const filePath = path.join(ROOT_DIR, suggestion.file);
        let content = fs.readFileSync(filePath, 'utf8');
        
        if (content.includes(suggestion.diff.oldText)) {
          content = content.replace(suggestion.diff.oldText, suggestion.diff.newText);
          fs.writeFileSync(filePath, content);
          suggestion.status = 'accepted';
          suggestion.appliedAt = Date.now();
          this._save();
          return { ok: true, message: 'Diff applied successfully' };
        } else {
          return { ok: false, message: 'Could not find original text in file — code may have changed' };
        }
      } catch (e) {
        return { ok: false, message: 'Failed to apply: ' + e.message };
      }
    }

    // No auto-applicable diff
    suggestion.status = 'accepted';
    suggestion.appliedAt = Date.now();
    this._save();
    return { ok: true, message: 'Marked as accepted (manual fix required)' };
  }

  /** Reject a suggestion */
  reject(id) {
    const suggestion = this._suggestions.find(s => s.id === id);
    if (!suggestion) return { ok: false, message: 'Suggestion not found' };
    suggestion.status = 'rejected';
    suggestion.rejectedAt = Date.now();
    this._save();
    return { ok: true };
  }

  /** Get stats */
  getStats() {
    const s = this._suggestions;
    return {
      total: s.length,
      pending: s.filter(x => x.status === 'pending').length,
      accepted: s.filter(x => x.status === 'accepted').length,
      rejected: s.filter(x => x.status === 'rejected').length,
      byCategory: {
        'Bug Fix': s.filter(x => x.category === 'Bug Fix' && x.status === 'pending').length,
        'Performance': s.filter(x => x.category === 'Performance' && x.status === 'pending').length,
        'Security': s.filter(x => x.category === 'Security' && x.status === 'pending').length,
        'Code Quality': s.filter(x => x.category === 'Code Quality' && x.status === 'pending').length,
      },
      lastScan: this._lastScan,
      scanning: this._scanning
    };
  }

  _save() { saveJSON(SUGGESTIONS_FILE, this._suggestions); }
}

module.exports = SelfImprove;
