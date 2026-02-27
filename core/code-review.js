/**
 * ARIES — Code Review System
 * Static analysis via regex patterns. No npm dependencies.
 * Dimensions: security, performance, correctness, maintainability, testing
 * Severities: critical, high, medium, low
 */

const fs = require('fs');
const path = require('path');

const SECURITY_PATTERNS = [
  { pattern: /(\+\s*['"`].*(?:SELECT|INSERT|UPDATE|DELETE|DROP)\b|['"`]\s*\+.*(?:SELECT|INSERT|UPDATE|DELETE|DROP)\b)/gi, message: 'Potential SQL injection — string concatenation in query', severity: 'critical' },
  { pattern: /\.innerHTML\s*=/g, message: 'XSS risk — innerHTML assignment. Use textContent or sanitize.', severity: 'high' },
  { pattern: /dangerouslySetInnerHTML/g, message: 'XSS risk — dangerouslySetInnerHTML usage', severity: 'high' },
  { pattern: /eval\s*\(/g, message: 'Code injection risk — eval() usage', severity: 'critical' },
  { pattern: /new Function\s*\(/g, message: 'Code injection risk — new Function() usage', severity: 'high' },
  { pattern: /child_process.*exec\s*\(/g, message: 'Command injection risk — exec() with potential user input', severity: 'high' },
  { pattern: /(password|secret|apikey|api_key|token|private_key)\s*[:=]\s*['"][^'"]{8,}['"]/gi, message: 'Hardcoded secret detected', severity: 'critical' },
  { pattern: /(?:sk-[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16}|ghp_[a-zA-Z0-9]{36})/g, message: 'API key/token pattern detected in code', severity: 'critical' },
  { pattern: /crypto\.createHash\s*\(\s*['"]md5['"]\s*\)/g, message: 'Weak hash — MD5 is not collision-resistant', severity: 'medium' },
  { pattern: /crypto\.createHash\s*\(\s*['"]sha1['"]\s*\)/g, message: 'Weak hash — SHA1 is deprecated for security', severity: 'medium' },
  { pattern: /rejectUnauthorized\s*:\s*false/g, message: 'TLS verification disabled', severity: 'high' },
  { pattern: /\.createServer\s*\(\s*\).*\.listen\s*\(\s*0\.0\.0\.0/g, message: 'Server binding to 0.0.0.0 — accessible from network', severity: 'medium' },
];

const PERFORMANCE_PATTERNS = [
  { pattern: /for\s*\([^)]*\)\s*\{[^}]*(?:await\s+(?:db|sql|query|fetch|axios|request)\s*\()/gs, message: 'N+1 query — database/network call inside loop', severity: 'high' },
  { pattern: /\.forEach\s*\([^)]*=>\s*\{[^}]*await\s/gs, message: 'Await inside forEach — use for...of or Promise.all', severity: 'medium' },
  { pattern: /JSON\.parse\s*\(\s*JSON\.stringify\s*\(/g, message: 'Inefficient deep clone — use structuredClone() or spread', severity: 'low' },
  { pattern: /new RegExp\s*\(/g, message: 'Dynamic RegExp in hot path? Consider compiling once.', severity: 'low' },
  { pattern: /\.filter\([^)]*\)\.map\(/g, message: 'filter().map() chain — consider .reduce() for single pass', severity: 'low' },
  { pattern: /readFileSync\s*\(/g, message: 'Sync file I/O — may block event loop', severity: 'medium' },
];

const MAINTAINABILITY_PATTERNS = [
  { pattern: /function\s+\w+\s*\([^)]{100,}\)/g, message: 'Too many parameters — consider using an options object', severity: 'medium' },
  { pattern: /\/\/ TODO|\/\/ FIXME|\/\/ HACK|\/\/ XXX/gi, message: 'TODO/FIXME comment found — unresolved issue', severity: 'low' },
  { pattern: /console\.(log|warn|error|debug)\s*\(/g, message: 'Console statement — remove or replace with proper logging', severity: 'low' },
  { pattern: /catch\s*\(\s*\w*\s*\)\s*\{\s*\}/g, message: 'Empty catch block — silently swallowing errors', severity: 'high' },
  { pattern: /^\s{80,}\S/gm, message: 'Excessive indentation — consider refactoring', severity: 'low' },
  { pattern: /if\s*\([^)]*\)\s*\{(?:[^}]*\n){50,}\}/g, message: 'Very long if-block — consider extracting to function', severity: 'medium' },
];

class CodeReview {
  constructor() {
    this.dimensions = ['security', 'performance', 'correctness', 'maintainability', 'testing'];
    this.severities = ['critical', 'high', 'medium', 'low'];
  }

  /**
   * Review files for issues
   * @param {string[]|string} files - file paths or single path
   * @param {object} opts - { dimensions: string[] }
   * @returns {{ issues: Array, summary: string }}
   */
  review(files, opts = {}) {
    if (typeof files === 'string') files = [files];
    const allIssues = [];

    for (const filePath of files) {
      try {
        const code = fs.readFileSync(filePath, 'utf8');
        const filename = path.basename(filePath);
        const dims = opts.dimensions || this.dimensions;

        if (dims.includes('security')) allIssues.push(...this.checkSecurity(code, filename).map(i => ({ ...i, file: filePath })));
        if (dims.includes('performance')) allIssues.push(...this.checkPerformance(code).map(i => ({ ...i, file: filePath })));
        if (dims.includes('maintainability')) allIssues.push(...this.checkMaintainability(code).map(i => ({ ...i, file: filePath })));
      } catch (e) {
        allIssues.push({ severity: 'low', dimension: 'correctness', file: filePath, line: 0, message: `Could not read file: ${e.message}`, suggestion: 'Check file path' });
      }
    }

    // Sort by severity
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    allIssues.sort((a, b) => (order[a.severity] || 3) - (order[b.severity] || 3));

    return { issues: allIssues, summary: this.summarize(allIssues) };
  }

  /** Run security checks */
  checkSecurity(code, filename = '') {
    return this._runPatterns(code, SECURITY_PATTERNS, 'security');
  }

  /** Run performance checks */
  checkPerformance(code) {
    return this._runPatterns(code, PERFORMANCE_PATTERNS, 'performance');
  }

  /** Run maintainability checks */
  checkMaintainability(code) {
    return this._runPatterns(code, MAINTAINABILITY_PATTERNS, 'maintainability');
  }

  /** Internal: run regex patterns against code */
  _runPatterns(code, patterns, dimension) {
    const issues = [];
    const lines = code.split('\n');

    for (const p of patterns) {
      // Reset regex state
      const regex = new RegExp(p.pattern.source, p.pattern.flags);
      let match;
      while ((match = regex.exec(code)) !== null) {
        // Find line number
        const upToMatch = code.substring(0, match.index);
        const lineNum = (upToMatch.match(/\n/g) || []).length + 1;
        issues.push({
          severity: p.severity,
          dimension,
          line: lineNum,
          message: p.message,
          suggestion: p.suggestion || null,
          snippet: lines[lineNum - 1]?.trim().substring(0, 100) || ''
        });
      }
    }

    return issues;
  }

  /** Generate human-readable summary */
  summarize(issues) {
    if (!issues.length) return '✅ No issues found. Code looks clean.';

    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const i of issues) counts[i.severity] = (counts[i.severity] || 0) + 1;

    const dimCounts = {};
    for (const i of issues) dimCounts[i.dimension] = (dimCounts[i.dimension] || 0) + 1;

    let report = `⚡ Code Review: ${issues.length} issue(s) found\n`;
    report += `🔴 Critical: ${counts.critical} | 🟠 High: ${counts.high} | 🟡 Medium: ${counts.medium} | 🔵 Low: ${counts.low}\n`;
    report += `Dimensions: ${Object.entries(dimCounts).map(([k, v]) => `${k}(${v})`).join(', ')}\n\n`;

    for (const issue of issues.slice(0, 20)) {
      const icon = { critical: '🔴', high: '🟠', medium: '🟡', low: '🔵' }[issue.severity] || '⚪';
      report += `${icon} [${issue.dimension}] L${issue.line}: ${issue.message}\n`;
      if (issue.snippet) report += `   → ${issue.snippet}\n`;
    }

    if (issues.length > 20) report += `\n... and ${issues.length - 20} more issues.\n`;

    return report;
  }
}

// Singleton
let _instance = null;
function getInstance() {
  if (!_instance) _instance = new CodeReview();
  return _instance;
}

module.exports = { CodeReview, getInstance };
