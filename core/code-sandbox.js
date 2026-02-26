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

  // ── Enhanced: Process Management ──

  /**
   * Run a long-lived process with health monitoring
   * @param {string} cmd - Command to run
   * @param {string[]} args - Arguments
   * @param {object} opts - { cwd, env, maxRestarts, autoRestart }
   * @returns {{ pid: number, stop: Function, status: Function }}
   */
  runManaged(cmd, args = [], opts = {}) {
    const maxRestarts = opts.maxRestarts || 3;
    const autoRestart = opts.autoRestart !== false;
    let restarts = 0;
    let currentChild = null;
    let stopped = false;
    let _startTime = Date.now();

    const state = {
      pid: null,
      status: 'starting',
      restarts: 0,
      stdout: '',
      stderr: '',
      exitCode: null,
      startedAt: _startTime,
    };

    const launch = () => {
      const child = spawn(cmd, args, {
        cwd: opts.cwd || process.cwd(),
        env: { ...process.env, ...(opts.env || {}) },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      currentChild = child;
      state.pid = child.pid;
      state.status = 'running';

      child.stdout.on('data', (d) => {
        const chunk = d.toString();
        state.stdout += chunk;
        if (state.stdout.length > 100000) state.stdout = state.stdout.slice(-50000);
        this.emit('managed:stdout', { pid: child.pid, data: chunk });
      });

      child.stderr.on('data', (d) => {
        const chunk = d.toString();
        state.stderr += chunk;
        if (state.stderr.length > 100000) state.stderr = state.stderr.slice(-50000);
        this.emit('managed:stderr', { pid: child.pid, data: chunk });
      });

      child.on('close', (code) => {
        state.exitCode = code;
        state.status = 'stopped';
        this.emit('managed:exit', { pid: child.pid, code });

        if (!stopped && autoRestart && restarts < maxRestarts && code !== 0) {
          restarts++;
          state.restarts = restarts;
          state.status = 'restarting';
          this.emit('managed:restart', { pid: child.pid, attempt: restarts });
          setTimeout(launch, 1000 * restarts);
        }
      });

      child.on('error', (err) => {
        state.status = 'error';
        state.stderr += '\n' + err.message;
        this.emit('managed:error', { pid: child.pid, error: err.message });
      });
    };

    launch();

    return {
      get pid() { return state.pid; },
      status: () => ({ ...state }),
      stop: () => {
        stopped = true;
        state.status = 'stopping';
        if (currentChild) {
          try { currentChild.kill('SIGTERM'); } catch {}
          setTimeout(() => { try { currentChild.kill('SIGKILL'); } catch {} }, 3000);
        }
      },
      isAlive: () => {
        if (!state.pid) return false;
        try { process.kill(state.pid, 0); return true; } catch { return false; }
      },
    };
  }

  /**
   * Get memory/CPU usage for a PID (best-effort)
   * @param {number} pid
   * @returns {{ memoryMB: number, cpu: string } | null}
   */
  getProcessStats(pid) {
    if (!pid) return null;
    try {
      const out = require('child_process').execSync(
        process.platform === 'win32'
          ? `powershell -NoProfile -Command "(Get-Process -Id ${pid} -ErrorAction SilentlyContinue | Select-Object WorkingSet64, CPU | ConvertTo-Json)"`
          : `ps -p ${pid} -o rss=,pcpu=`,
        { encoding: 'utf8', timeout: 5000 }
      ).trim();
      if (process.platform === 'win32') {
        const data = JSON.parse(out);
        return { memoryMB: Math.round((data.WorkingSet64 || 0) / 1048576), cpu: String(data.CPU || 0) };
      } else {
        const [rss, cpu] = out.trim().split(/\s+/);
        return { memoryMB: Math.round(parseInt(rss) / 1024), cpu: cpu || '0' };
      }
    } catch { return null; }
  }
}

module.exports = { CodeSandbox };
