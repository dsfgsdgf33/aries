/**
 * ARIES v3.0 — Enhanced Tool System
 * All tools with error handling, timeouts, and execution logging.
 */

const { execSync, exec: execCb, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const memory = require('./memory');

const MAX_OUTPUT = 4000;
const TOOL_LOG_FILE = path.join(__dirname, '..', 'data', 'tool-log.json');
const MAX_LOG_ENTRIES = 100;

function truncate(str, max = MAX_OUTPUT) {
  if (!str) return '';
  if (str.length > max) return str.substring(0, max) + '\n[truncated]';
  return str;
}

/** Log tool execution */
function logTool(toolName, args, result) {
  try {
    const dir = path.dirname(TOOL_LOG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    let log = [];
    try { log = JSON.parse(fs.readFileSync(TOOL_LOG_FILE, 'utf8')); } catch {}
    log.push({
      tool: toolName,
      args: Array.isArray(args) ? args.map(a => String(a).substring(0, 200)) : [],
      success: result.success,
      timestamp: new Date().toISOString()
    });
    if (log.length > MAX_LOG_ENTRIES) log = log.slice(-MAX_LOG_ENTRIES);
    fs.writeFileSync(TOOL_LOG_FILE, JSON.stringify(log, null, 2));
  } catch {}
}

/** Wrap a tool function with logging */
function logged(name, fn) {
  return async function(...args) {
    try {
      const result = await fn.apply(tools, args);
      logTool(name, args, result);
      return result;
    } catch (e) {
      const result = { success: false, output: e.message };
      logTool(name, args, result);
      return result;
    }
  };
}

const tools = {
  async shell(cmd, timeoutMs = 30000) {
    try {
      const output = execSync(cmd, {
        encoding: 'utf8',
        timeout: timeoutMs,
        shell: 'powershell.exe',
        cwd: process.cwd(),
        maxBuffer: 1024 * 1024
      });
      return { success: true, output: truncate(output.trim()) };
    } catch (e) {
      const stderr = e.stderr ? e.stderr.toString().trim() : '';
      const stdout = e.stdout ? e.stdout.toString().trim() : '';
      return { success: false, output: truncate(stderr || stdout || e.message) };
    }
  },

  async launch(app) {
    try {
      const child = spawn('cmd', ['/c', 'start', '', app], { detached: true, stdio: 'ignore', shell: true });
      child.unref();
      return { success: true, output: `Launched: ${app}` };
    } catch (e) {
      return { success: false, output: e.message };
    }
  },

  async kill(processName) {
    return await this.shell(`Stop-Process -Name "${processName.replace('.exe', '')}" -Force -ErrorAction SilentlyContinue`);
  },

  async read(filePath, offset, limit) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      if (offset || limit) {
        const lines = content.split('\n');
        const start = (offset || 1) - 1;
        const end = limit ? start + limit : lines.length;
        return { success: true, output: truncate(lines.slice(start, end).join('\n')), totalLines: lines.length };
      }
      return { success: true, output: truncate(content) };
    } catch (e) {
      return { success: false, output: e.message };
    }
  },

  async write(filePath, content) {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content);
      return { success: true, output: `Written: ${filePath} (${content.length} bytes)` };
    } catch (e) {
      return { success: false, output: e.message };
    }
  },

  async append(filePath, content) {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.appendFileSync(filePath, content);
      return { success: true, output: `Appended to: ${filePath}` };
    } catch (e) {
      return { success: false, output: e.message };
    }
  },

  async edit(filePath, oldText, newText) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      if (!content.includes(oldText)) {
        return { success: false, output: 'Old text not found in file' };
      }
      const updated = content.replace(oldText, newText);
      fs.writeFileSync(filePath, updated);
      return { success: true, output: `Edited: ${filePath} (replaced ${oldText.length} chars)` };
    } catch (e) {
      return { success: false, output: e.message };
    }
  },

  async delete(filePath) {
    try {
      // Try recycle bin via PowerShell
      try {
        execSync(`Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('${filePath.replace(/'/g, "''")}', 'OnlyErrorDialogs', 'SendToRecycleBin')`, {
          shell: 'powershell.exe', timeout: 10000
        });
        return { success: true, output: `Recycled: ${filePath}` };
      } catch {
        // Fallback to direct delete
        fs.unlinkSync(filePath);
        return { success: true, output: `Deleted: ${filePath}` };
      }
    } catch (e) {
      return { success: false, output: e.message };
    }
  },

  async ls(dirPath = '.') {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      const items = entries.map(e => {
        try {
          const stat = fs.statSync(path.join(dirPath, e.name));
          const size = e.isDirectory() ? '<DIR>' :
            stat.size < 1024 ? `${stat.size}B` :
            stat.size < 1048576 ? `${(stat.size / 1024).toFixed(1)}KB` :
            `${(stat.size / 1048576).toFixed(1)}MB`;
          return `${e.isDirectory() ? 'd' : '-'} ${size.padStart(10)} ${e.name}`;
        } catch {
          return `? ${e.name}`;
        }
      });
      return { success: true, output: items.join('\n'), count: entries.length };
    } catch (e) {
      return { success: false, output: e.message };
    }
  },

  async web(url) {
    try {
      const fetch = require('node-fetch');
      const resp = await fetch(url, { timeout: 10000, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0' } });
      let text = await resp.text();
      text = text.replace(/<script[\s\S]*?<\/script>/gi, '')
                 .replace(/<style[\s\S]*?<\/style>/gi, '')
                 .replace(/<[^>]+>/g, ' ')
                 .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                 .replace(/\s+/g, ' ').trim();
      if (text.length > 8000) text = text.substring(0, 8000) + '\n[truncated]';
      return { success: true, output: text };
    } catch (e) {
      return { success: false, output: e.message };
    }
  },

  async download(url, savePath) {
    try {
      const fetch = require('node-fetch');
      const resp = await fetch(url, { timeout: 30000 });
      const buffer = await resp.buffer();
      fs.mkdirSync(path.dirname(savePath), { recursive: true });
      fs.writeFileSync(savePath, buffer);
      return { success: true, output: `Downloaded ${buffer.length} bytes to ${savePath}` };
    } catch (e) {
      return { success: false, output: e.message };
    }
  },

  async search(directory, pattern, filePattern = '*') {
    try {
      // Use PowerShell Select-String for grep-like search
      const cmd = `Get-ChildItem -Path "${directory}" -Recurse -Filter "${filePattern}" -File -ErrorAction SilentlyContinue | Select-String -Pattern "${pattern}" -ErrorAction SilentlyContinue | Select-Object -First 30 | ForEach-Object { "$($_.Path):$($_.LineNumber): $($_.Line.Trim())" }`;
      return await this.shell(cmd, 15000);
    } catch (e) {
      return { success: false, output: e.message };
    }
  },

  async clipboard(text) {
    try {
      execSync(`Set-Clipboard -Value "${text.replace(/"/g, '`"')}"`, { shell: 'powershell.exe' });
      return { success: true, output: 'Copied to clipboard' };
    } catch (e) {
      return { success: false, output: e.message };
    }
  },

  async process(action = 'list', target = null) {
    try {
      if (action === 'kill' && target) {
        return await this.kill(target);
      }
      // List top processes
      const result = await this.shell('Get-Process | Sort-Object CPU -Descending | Select-Object -First 20 Name, Id, @{N="CPU";E={[math]::Round($_.CPU,1)}}, @{N="MemMB";E={[math]::Round($_.WorkingSet64/1MB,1)}} | Format-Table -AutoSize | Out-String');
      return result;
    } catch (e) {
      return { success: false, output: e.message };
    }
  },

  async sysinfo() {
    try {
      const cpus = os.cpus();
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      const uptime = os.uptime();

      const info = [
        `Hostname: ${os.hostname()}`,
        `OS: ${os.type()} ${os.release()} (${os.arch()})`,
        `CPU: ${cpus[0].model} (${cpus.length} cores)`,
        `RAM: ${(usedMem / 1073741824).toFixed(1)}/${(totalMem / 1073741824).toFixed(1)} GB (${Math.round(usedMem / totalMem * 100)}%)`,
        `Uptime: ${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
        `Platform: ${os.platform()}`,
      ];

      // Try to get disk info
      try {
        const diskResult = execSync('wmic logicaldisk get size,freespace,caption /format:list', { encoding: 'utf8', timeout: 5000 });
        const lines = diskResult.split('\n').filter(l => l.trim());
        let caption = '', free = 0, size = 0;
        for (const line of lines) {
          if (line.startsWith('Caption=')) caption = line.split('=')[1].trim();
          if (line.startsWith('FreeSpace=')) free = parseInt(line.split('=')[1]) || 0;
          if (line.startsWith('Size=')) {
            size = parseInt(line.split('=')[1]) || 0;
            if (size > 0) {
              info.push(`Disk ${caption}: ${((size - free) / 1073741824).toFixed(0)}/${(size / 1073741824).toFixed(0)} GB (${Math.round((size - free) / size * 100)}%)`);
            }
          }
        }
      } catch {}

      // Network interfaces
      const nets = os.networkInterfaces();
      for (const [name, addrs] of Object.entries(nets)) {
        const ipv4 = addrs.find(a => a.family === 'IPv4' && !a.internal);
        if (ipv4) info.push(`Net ${name}: ${ipv4.address}`);
      }

      return { success: true, output: info.join('\n') };
    } catch (e) {
      return { success: false, output: e.message };
    }
  },

  async notify(message) {
    try {
      const ps = `
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null
        $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
        $xml.LoadXml('<toast><visual><binding template="ToastText02"><text id="1">ARIES</text><text id="2">${message.replace(/'/g, "''")}</text></binding></visual></toast>')
        $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("ARIES").Show($toast)
      `;
      execSync(ps, { shell: 'powershell.exe', timeout: 5000 });
      return { success: true, output: `Notification sent: ${message}` };
    } catch (e) {
      try {
        execSync(`msg * "${message.replace(/"/g, '')}"`, { timeout: 3000 });
        return { success: true, output: `Notification sent: ${message}` };
      } catch {
        return { success: false, output: e.message };
      }
    }
  },

  async open(target) {
    try {
      const child = spawn('cmd', ['/c', 'start', '', target], { detached: true, stdio: 'ignore', shell: true });
      child.unref();
      return { success: true, output: `Opened: ${target}` };
    } catch (e) {
      return { success: false, output: e.message };
    }
  },

  async install(pkg) {
    // Detect pip vs npm
    if (pkg.includes('pip ') || pkg.startsWith('pip3 ')) {
      return await this.shell(pkg, 60000);
    }
    return await this.shell(`npm install ${pkg}`, 60000);
  },

  async memory(info) {
    const count = memory.add(info);
    return { success: true, output: `Saved to memory (${count} entries)` };
  },

  async swarm(task) {
    try {
      const Swarm = require('./swarm');
      const SwarmCoordinator = require('./swarm-coordinator');
      const aiCore = require('./ai');
      const cfg = require('../config.json');
      const coordinator = new SwarmCoordinator(cfg.remoteWorkers || {});
      const swarmInstance = new Swarm(aiCore, { ...(cfg.swarm || {}), models: cfg.models, relay: cfg.relay }, coordinator);
      const result = await swarmInstance.execute(task);
      return { success: true, output: truncate(result, 6000) };
    } catch (e) {
      return { success: false, output: `Swarm error: ${e.message}` };
    }
  },

  async browse(url) {
    try {
      const browser = require('./browser');
      if (!browser.isAvailable()) {
        return { success: false, output: 'Browser unavailable. Install with: npm install playwright' };
      }
      const text = await browser.fetchPage(url);
      return { success: true, output: truncate(text, 6000) };
    } catch (e) {
      return { success: false, output: e.message };
    }
  },

  async click(selector) {
    try {
      const browser = require('./browser');
      if (!browser.isLaunched()) return { success: false, output: 'No browser open. Use <tool:browse>url</tool:browse> first.' };
      const result = await browser.click(selector);
      return { success: true, output: result };
    } catch (e) {
      return { success: false, output: e.message };
    }
  },

  async type(selector, text) {
    try {
      const browser = require('./browser');
      if (!browser.isLaunched()) return { success: false, output: 'No browser open. Use <tool:browse>url</tool:browse> first.' };
      const result = await browser.type(selector, text);
      return { success: true, output: result };
    } catch (e) {
      return { success: false, output: e.message };
    }
  },

  async screenshot(filename) {
    try {
      const browser = require('./browser');
      if (!browser.isLaunched()) return { success: false, output: 'No browser open. Use <tool:browse>url</tool:browse> first.' };
      const savePath = filename || path.join(__dirname, '..', 'data', `screenshot-${Date.now()}.png`);
      const result = await browser.screenshot(savePath);
      return { success: true, output: `Screenshot saved: ${result}` };
    } catch (e) {
      return { success: false, output: e.message };
    }
  },

  async evaluate(js) {
    try {
      const browser = require('./browser');
      if (!browser.isLaunched()) return { success: false, output: 'No browser open. Use <tool:browse>url</tool:browse> first.' };
      const result = await browser.evaluate(js);
      return { success: true, output: truncate(result) };
    } catch (e) {
      return { success: false, output: e.message };
    }
  },

  /** Get list of all available tool names */
  list() {
    return Object.keys(tools).filter(k => typeof tools[k] === 'function' && k !== 'list' && k !== 'getLog');
  },

  /** Get tool execution log */
  getLog() {
    try {
      return JSON.parse(fs.readFileSync(TOOL_LOG_FILE, 'utf8'));
    } catch { return []; }
  }
};

// Wrap all tools with logging
const loggedTools = {};
for (const [name, fn] of Object.entries(tools)) {
  if (typeof fn === 'function' && name !== 'list' && name !== 'getLog') {
    loggedTools[name] = logged(name, fn);
  } else {
    loggedTools[name] = fn;
  }
}

module.exports = loggedTools;
