const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const { promisify } = require('util');
const { spawn, exec } = require('child_process');
const execAsync = promisify(exec);

const MAX_OUTPUT = 4000;
const TOOL_LOG_FILE = path.join(__dirname, '..', 'data', 'tool-log.json');
const MAX_LOG_ENTRIES = 100;

// Background process tracking (kept for compatibility)
const bgProcesses = new Map();
const BG_MAX_BUFFER = 5120;

// Sub-agent job queue (kept for compatibility)
const subAgentJobs = new Map();
const MAX_CONCURRENT_AGENTS = 3;

// Auto-cleanup bg processes after 1 hour
setInterval(() => {
  const cutoff = Date.now() - 3600000;
  for (const [pid, proc] of bgProcesses) {
    if (proc.startedAt < cutoff) {
      try { proc.child && proc.child.kill(); } catch {}
      bgProcesses.delete(pid);
    }
  }
}, 60000);

function truncate(str, max = MAX_OUTPUT) {
  if (!str) return '';
  if (str.length > max) return str.substring(0, max) + '\n[truncated]';
  return str;
}

/** Log tool execution */
async function logTool(toolName, args, result) {
  try {
    const dir = path.dirname(TOOL_LOG_FILE);
    try {
      await fs.access(dir);
    } catch {
      await fs.mkdir(dir, { recursive: true });
    }
    
    let log = [];
    try {
      const data = await fs.readFile(TOOL_LOG_FILE, 'utf8');
      log = JSON.parse(data);
    } catch {}
    
    log.push({
      tool: toolName,
      args: Array.isArray(args) ? args.map(a => String(a).substring(0, 200)) : [],
      success: result.success,
      timestamp: new Date().toISOString()
    });
    
    if (log.length > MAX_LOG_ENTRIES) log = log.slice(-MAX_LOG_ENTRIES);
    await fs.writeFile(TOOL_LOG_FILE, JSON.stringify(log, null, 2));
  } catch {}
}

/** Wrap a tool function with logging */
function logged(name, fn) {
  return async function(...args) {
    try {
      const result = await fn.apply(nativeTools, args);
      await logTool(name, args, result);
      return result;
    } catch (e) {
      const result = { success: false, output: e.message };
      await logTool(name, args, result);
      return result;
    }
  };
}

/** Native file operations replacement for common shell commands */
async function nativeFileOp(operation, ...args) {
  try {
    switch (operation) {
      case 'ls':
      case 'dir': {
        const dirPath = args[0] || '.';
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        const output = entries.map(entry => {
          const type = entry.isDirectory() ? 'DIR' : 'FILE';
          return `${type.padEnd(4)} ${entry.name}`;
        }).join('\n');
        return { success: true, output };
      }
      
      case 'pwd':
      case 'cd': {
        if (args[0]) {
          process.chdir(args[0]);
        }
        return { success: true, output: process.cwd() };
      }
      
      case 'mkdir': {
        const dirPath = args[0];
        if (!dirPath) return { success: false, output: 'mkdir: missing directory name' };
        await fs.mkdir(dirPath, { recursive: true });
        return { success: true, output: `Created directory: ${dirPath}` };
      }
      
      case 'rm':
      case 'del': {
        const filePath = args[0];
        if (!filePath) return { success: false, output: 'rm: missing file name' };
        try {
          const stat = await fs.stat(filePath);
          if (stat.isDirectory()) {
            await fs.rmdir(filePath, { recursive: true });
          } else {
            await fs.unlink(filePath);
          }
          return { success: true, output: `Removed: ${filePath}` };
        } catch (e) {
          return { success: false, output: `rm: ${e.message}` };
        }
      }
      
      case 'cp':
      case 'copy': {
        const [src, dest] = args;
        if (!src || !dest) return { success: false, output: 'cp: missing source or destination' };
        await fs.copyFile(src, dest);
        return { success: true, output: `Copied ${src} to ${dest}` };
      }
      
      case 'mv':
      case 'move': {
        const [src, dest] = args;
        if (!src || !dest) return { success: false, output: 'mv: missing source or destination' };
        await fs.rename(src, dest);
        return { success: true, output: `Moved ${src} to ${dest}` };
      }
      
      case 'cat':
      case 'type': {
        const filePath = args[0];
        if (!filePath) return { success: false, output: 'cat: missing file name' };
        const content = await fs.readFile(filePath, 'utf8');
        return { success: true, output: truncate(content) };
      }
      
      case 'echo': {
        const text = args.join(' ');
        return { success: true, output: text };
      }
      
      default:
        return { success: false, output: `Unsupported file operation: ${operation}` };
    }
  } catch (error) {
    return { success: false, output: `${operation}: ${error.message}` };
  }
}

/** Native system info replacement */
async function nativeSystemInfo(command) {
  try {
    switch (command) {
      case 'ps':
      case 'tasklist': {
        // Use native process info where available
        const info = {
          pid: process.pid,
          memory: process.memoryUsage(),
          uptime: process.uptime(),
          platform: os.platform(),
          arch: os.arch()
        };
        return { success: true, output: JSON.stringify(info, null, 2) };
      }
      
      case 'whoami': {
        const userInfo = os.userInfo();
        return { success: true, output: userInfo.username };
      }
      
      case 'hostname': {
        return { success: true, output: os.hostname() };
      }
      
      case 'uptime': {
        const uptime = os.uptime();
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        return { success: true, output: `${hours}h ${minutes}m` };
      }
      
      case 'df':
      case 'free': {
        const memInfo = {
          total: os.totalmem(),
          free: os.freemem(),
          used: os.totalmem() - os.freemem()
        };
        return { success: true, output: JSON.stringify(memInfo, null, 2) };
      }
      
      default:
        return { success: false, output: `Unsupported system command: ${command}` };
    }
  } catch (error) {
    return { success: false, output: `${command}: ${error.message}` };
  }
}

const nativeTools = {
  /** Enhanced shell with native fallbacks */
  async shell(cmd, timeoutMs = 30000) {
    // Safety: block ANY command that kills node/openclaw/aries processes
    const killPatterns = [
      /stop-process\s+.*-name\s+["']?node/i, /taskkill\s+.*\/im\s+["']?node/i,
      /stop-process\s+.*-name\s+["']?openclaw/i, /taskkill\s+.*\/im\s+["']?openclaw/i,
      /stop-process\s+.*-name\s+["']?aries/i, /get-process\s+.*node.*\|\s*(stop|kill|%\s*\{.*stop)/i,
      /pkill\s+(-\d+\s+)?node/i, /killall\s+node/i,
      /wmic\s+.*node.*call\s+terminate/i,
    ];
    
    for (const pattern of killPatterns) {
      if (pattern.test(cmd)) {
        return { success: false, output: 'BLOCKED: Cannot kill node/openclaw/aries processes.' };
      }
    }
    // Block killing PIDs that are Aries runtime or OpenClaw — allow project node processes
    const _pidMatch = cmd.match(/(?:taskkill\s+.*\/pid\s+|stop-process\s+.*-id\s+|kill\s+(?:-\d+\s+)?)(\d+)/i);
    if (_pidMatch) {
      const _tPid = parseInt(_pidMatch[1]);
      const _protPids = new Set();
      _protPids.add(process.pid);
      if (process.ppid) _protPids.add(process.ppid);
      try {
        const _pl = require('child_process').execSync(
          'powershell -NoProfile -Command "Get-WmiObject Win32_Process | Where-Object { $_.CommandLine -match \'openclaw\' -or $_.CommandLine -match \'watchdog\\.js\' -or $_.CommandLine -match \'aries.launcher\' -or $_.CommandLine -match \'aries\\\\launcher\' } | Select-Object -ExpandProperty ProcessId"',
          { encoding: 'utf8', timeout: 3000 }
        ).trim().split(/\r?\n/);
        for (const p of _pl) { const n = parseInt(p.trim()); if (n) _protPids.add(n); }
      } catch {}
      if (_protPids.has(_tPid)) {
        return { success: false, output: `BLOCKED: PID ${_tPid} is Aries/OpenClaw runtime. Cannot kill.` };
      }
    }

    // Try native implementations first for common commands
    const cmdParts = cmd.trim().split(/\s+/);
    const baseCmd = cmdParts[0].toLowerCase();
    const args = cmdParts.slice(1);
    
    // File operations
    if (['ls', 'dir', 'pwd', 'cd', 'mkdir', 'rm', 'del', 'cp', 'copy', 'mv', 'move', 'cat', 'type', 'echo'].includes(baseCmd)) {
      return await nativeFileOp(baseCmd, ...args);
    }
    
    // System info commands
    if (['ps', 'tasklist', 'whoami', 'hostname', 'uptime', 'df', 'free'].includes(baseCmd)) {
      return await nativeSystemInfo(baseCmd);
    }
    
    // Fallback to shell execution for complex commands
    try {
      const { stdout, stderr } = await execAsync(cmd, {
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024, // 1MB
        env: { ...process.env, PATH: process.env.PATH }
      });
      
      const output = stdout || stderr || '';
      return { success: true, output: truncate(output) };
    } catch (error) {
      return { success: false, output: `Shell error: ${error.message}` };
    }
  },

  /** Native file reading */
  async read(filePath, encoding = 'utf8') {
    try {
      const absolutePath = path.resolve(filePath);
      const content = await fs.readFile(absolutePath, encoding);
      return { success: true, output: truncate(content) };
    } catch (error) {
      return { success: false, output: `Read error: ${error.message}` };
    }
  },

  /** Native file writing */
  async write(filePath, content, mode = 'w') {
    try {
      const absolutePath = path.resolve(filePath);
      const dir = path.dirname(absolutePath);
      
      // Ensure directory exists
      try {
        await fs.access(dir);
      } catch {
        await fs.mkdir(dir, { recursive: true });
      }
      
      if (mode === 'a' || mode === 'append') {
        await fs.appendFile(absolutePath, content, 'utf8');
      } else {
        await fs.writeFile(absolutePath, content, 'utf8');
      }
      
      return { success: true, output: `File ${mode === 'a' ? 'appended' : 'written'}: ${filePath}` };
    } catch (error) {
      return { success: false, output: `Write error: ${error.message}` };
    }
  },

  /** Native HTTP requests */
  async http(url, options = {}) {
    try {
      const {
        method = 'GET',
        headers = {},
        body,
        timeout = 10000
      } = options;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const responseText = await response.text();
      let responseData;
      
      try {
        responseData = JSON.parse(responseText);
      } catch {
        responseData = responseText;
      }

      return {
        success: response.ok,
        output: JSON.stringify({
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          data: responseData
        }, null, 2)
      };
    } catch (error) {
      return { success: false, output: `HTTP error: ${error.message}` };
    }
  },

  /** Process management with native Node.js */
  async spawn(command, args = [], options = {}) {
    return new Promise((resolve) => {
      try {
        const child = spawn(command, args, {
          stdio: 'pipe',
          ...options
        });
        
        let output = '';
        let error = '';
        
        child.stdout?.on('data', (data) => {
          output += data.toString();
        });
        
        child.stderr?.on('data', (data) => {
          error += data.toString();
        });
        
        child.on('close', (code) => {
          const result = {
            success: code === 0,
            output: truncate(output || error),
            exitCode: code
          };
          resolve(result);
        });
        
        child.on('error', (err) => {
          resolve({
            success: false,
            output: `Spawn error: ${err.message}`
          });
        });
        
        // Store for tracking
        if (options.background) {
          const pid = `bg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          bgProcesses.set(pid, {
            child,
            startedAt: Date.now(),
            buffer: '',
            command: `${command} ${args.join(' ')}`
          });
        }
      } catch (error) {
        resolve({
          success: false,
          output: `Spawn setup error: ${error.message}`
        });
      }
    });
  }
};

// Add logging wrappers
const loggedTools = {};
for (const [name, fn] of Object.entries(nativeTools)) {
  loggedTools[name] = logged(name, fn);
}

module.exports = loggedTools;