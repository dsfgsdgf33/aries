/**
 * ARIES v4.2 — Code Sandbox
 * Safe code execution with timeout, memory limits, and dangerous command blocking.
 * No npm packages — uses only Node.js built-ins.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const EventEmitter = require('events');

const DATA_DIR = path.join(__dirname, '..', 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'sandbox-history.json');

/** Dangerous patterns to block */
const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\//i,
  /rm\s+-rf\s+~/i,
  /rm\s+-rf\s+\*/i,
  /del\s+\/s\s+\/q/i,
  /format\s+[a-z]:/i,
  /mkfs\./i,
  /dd\s+if=.*of=\/dev/i,
  /:\(\)\{.*\|.*&.*\}/,           // fork bomb
  />\s*\/dev\/sd[a-z]/i,
  /shutdown/i,
  /reboot/i,
  /init\s+0/i,
  /halt/i,
  /rm\s+-rf\s+--no-preserve-root/i,
  /Remove-Item\s+-Recurse\s+-Force\s+[A-Z]:\\/i,
  /Stop-Computer/i,
  /Restart-Computer/i,
];

const LANGUAGES = {
  javascript: { cmd: 'node', ext: '.js', name: 'JavaScript (Node.js)' },
  python: { cmd: 'python', ext: '.py', name: 'Python' },
  powershell: { cmd: 'powershell', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File'], ext: '.ps1', name: 'PowerShell' },
  bash: { cmd: 'bash', ext: '.sh', name: 'Bash' },
};

class CodeSandbox extends EventEmitter {
  constructor(config = {}) {
    super();
    this.maxTimeoutMs = config.maxTimeoutMs || 30000;
    this.maxHistory = config.maxHistory || 50;
    this.history = [];
    this._loadHistory();
  }

  _loadHistory() {
    try {
      if (fs.existsSync(HISTORY_FILE)) {
        this.history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      }
    } catch { this.history = []; }
  }

  _saveHistory() {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(this.history.slice(-this.maxHistory), null, 2));
    } catch {}
  }

  /**
   * Check if code contains dangerous patterns
   * @param {string} code
   * @returns {string|null} Matched pattern description or null
   */
  _checkDangerous(code) {
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(code)) {
        return `Blocked dangerous pattern: ${pattern.toString()}`;
      }
    }
    return null;
  }

  /**
   * Execute code in a sandboxed child process
   * @param {string} code - Code to execute
   * @param {string} language - Language (javascript, python, powershell, bash)
   * @param {number} timeout - Timeout in ms (max 30s)
   * @returns {Promise<{stdout: string, stderr: string, exitCode: number, duration: number, language: string}>}
   */
  async execute(code, language = 'javascript', timeout) {
    const lang = LANGUAGES[language.toLowerCase()];
    if (!lang) {
      throw new Error(`Unsupported language: ${language}. Supported: ${Object.keys(LANGUAGES).join(', ')}`);
    }

    // Safety check
    const danger = this._checkDangerous(code);
    if (danger) {
      const entry = {
        id: crypto.randomUUID(),
        language,
        code: code.substring(0, 500),
        stdout: '',
        stderr: danger,
        exitCode: -1,
        duration: 0,
        blocked: true,
        timestamp: new Date().toISOString(),
      };
      this.history.push(entry);
      this._saveHistory();
      throw new Error(danger);
    }

    const timeoutMs = Math.min(timeout || this.maxTimeoutMs, this.maxTimeoutMs);

    // Write code to temp file
    const tmpFile = path.join(os.tmpdir(), `aries-sandbox-${crypto.randomUUID()}${lang.ext}`);
    fs.writeFileSync(tmpFile, code, 'utf8');

    const startTime = Date.now();

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let killed = false;

      const args = lang.args ? [...lang.args, tmpFile] : [tmpFile];
      const child = spawn(lang.cmd, args, {
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=128' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      child.stdout.on('data', d => { stdout += d.toString(); if (stdout.length > 100000) { child.kill(); killed = true; } });
      child.stderr.on('data', d => { stderr += d.toString(); if (stderr.length > 100000) { child.kill(); killed = true; } });

      const timer = setTimeout(() => { child.kill('SIGKILL'); killed = true; }, timeoutMs);

      child.on('close', (exitCode) => {
        clearTimeout(timer);
        // Clean up temp file
        try { fs.unlinkSync(tmpFile); } catch {}

        const duration = Date.now() - startTime;
        if (killed && !stderr.includes('timeout')) {
          stderr += '\n[Execution killed: timeout or output limit exceeded]';
        }

        const result = {
          stdout: stdout.substring(0, 50000),
          stderr: stderr.substring(0, 50000),
          exitCode: exitCode || 0,
          duration,
          language,
        };

        // Save to history
        const entry = {
          id: crypto.randomUUID(),
          language,
          code: code.substring(0, 2000),
          ...result,
          timestamp: new Date().toISOString(),
        };
        this.history.push(entry);
        if (this.history.length > this.maxHistory) {
          this.history = this.history.slice(-this.maxHistory);
        }
        this._saveHistory();
        this.emit('executed', entry);
        resolve(result);
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        try { fs.unlinkSync(tmpFile); } catch {}
        const duration = Date.now() - startTime;
        const result = { stdout: '', stderr: err.message, exitCode: -1, duration, language };
        this.history.push({ id: crypto.randomUUID(), language, code: code.substring(0, 2000), ...result, timestamp: new Date().toISOString() });
        this._saveHistory();
        resolve(result);
      });
    });
  }

  /**
   * Get supported languages
   * @returns {Array}
   */
  getSupportedLanguages() {
    return Object.entries(LANGUAGES).map(([id, lang]) => ({ id, name: lang.name, ext: lang.ext }));
  }

  /**
   * Get execution history
   * @returns {Array}
   */
  getHistory() {
    return this.history.slice(-this.maxHistory);
  }

  /**
   * Clear execution history
   * @returns {{cleared: number}}
   */
  clearHistory() {
    const count = this.history.length;
    this.history = [];
    this._saveHistory();
    return { cleared: count };
  }
}

module.exports = { CodeSandbox };
