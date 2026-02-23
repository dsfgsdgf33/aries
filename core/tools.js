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

  async web(urlStr) {
    try {
      const parsedUrl = new (require('url').URL)(urlStr);
      const httpMod = parsedUrl.protocol === 'https:' ? require('https') : require('http');
      const html = await new Promise((resolve, reject) => {
        const req = httpMod.get(parsedUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          timeout: 10000,
          rejectUnauthorized: false
        }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            // Follow redirect
            tools.web(res.headers.location).then(resolve).catch(reject);
            res.resume();
            return;
          }
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => resolve({ success: true, output: data }));
        });
        req.on('error', (e) => reject(e));
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      });
      if (html.success !== undefined) {
        let text = html.output;
        text = text.replace(/<script[\s\S]*?<\/script>/gi, '')
                   .replace(/<style[\s\S]*?<\/style>/gi, '')
                   .replace(/<[^>]+>/g, ' ')
                   .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                   .replace(/\s+/g, ' ').trim();
        if (text.length > 8000) text = text.substring(0, 8000) + '\n[truncated]';
        return { success: true, output: text };
      }
      return html;
    } catch (e) {
      return { success: false, output: e.message };
    }
  },

  async download(urlStr, savePath) {
    try {
      const parsedUrl = new (require('url').URL)(urlStr);
      const httpMod = parsedUrl.protocol === 'https:' ? require('https') : require('http');
      await new Promise((resolve, reject) => {
        const req = httpMod.get(parsedUrl, { timeout: 30000, rejectUnauthorized: false }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            tools.download(res.headers.location, savePath).then(resolve).catch(reject);
            res.resume();
            return;
          }
          fs.mkdirSync(path.dirname(savePath), { recursive: true });
          const ws = fs.createWriteStream(savePath);
          res.pipe(ws);
          ws.on('finish', () => resolve());
          ws.on('error', reject);
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      });
      const stat = fs.statSync(savePath);
      return { success: true, output: `Downloaded ${stat.size} bytes to ${savePath}` };
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

  // ── Additional Admin Tools ──

  async desktopScreenshot(filename) {
    try {
      const savePath = filename || path.join(__dirname, '..', 'data', `desktop-${Date.now()}.png`);
      const ps = `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp=New-Object System.Drawing.Bitmap($b.Width,$b.Height); $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); $bmp.Save('${savePath.replace(/'/g, "''")}'); $g.Dispose(); $bmp.Dispose()`;
      execSync(ps, { shell: 'powershell.exe', timeout: 10000, windowsHide: true });
      return { success: true, output: `Desktop screenshot saved: ${savePath}` };
    } catch (e) {
      return { success: false, output: e.message };
    }
  },

  async tts(text, voice) {
    try {
      const ps = `Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Speak('${text.replace(/'/g, "''")}')`;
      execSync(ps, { shell: 'powershell.exe', timeout: 30000, windowsHide: true });
      return { success: true, output: `Spoke: ${text.substring(0, 100)}` };
    } catch (e) {
      return { success: false, output: e.message };
    }
  },

  async cron(expression, command) {
    try {
      const cronFile = path.join(__dirname, '..', 'data', 'cron-jobs.json');
      let jobs = [];
      try { jobs = JSON.parse(fs.readFileSync(cronFile, 'utf8')); } catch {}
      const job = { id: Date.now().toString(36), expression, command, created: new Date().toISOString() };
      jobs.push(job);
      fs.writeFileSync(cronFile, JSON.stringify(jobs, null, 2));
      return { success: true, output: `Cron job added: ${expression} → ${command}` };
    } catch (e) {
      return { success: false, output: e.message };
    }
  },

  async git(command) {
    try {
      const allowed = ['status', 'log', 'diff', 'branch', 'remote', 'stash', 'add', 'commit', 'push', 'pull', 'checkout', 'fetch', 'tag', 'clone', 'init'];
      const cmd = command.split(' ')[0];
      if (!allowed.includes(cmd)) return { success: false, output: 'Git command not allowed: ' + cmd };
      const output = execSync('git ' + command, { encoding: 'utf8', timeout: 30000, cwd: process.cwd() });
      return { success: true, output: truncate(output.trim()) };
    } catch (e) {
      return { success: false, output: truncate((e.stdout || '') + (e.stderr || '') || e.message) };
    }
  },

  async netscan(subnet) {
    try {
      const target = subnet || '192.168.1';
      const result = await this.shell(`1..254 | ForEach-Object { $ip="${target}.$_"; if(Test-Connection $ip -Count 1 -Quiet -TimeoutSeconds 1){$ip} }`, 60000);
      return result;
    } catch (e) {
      return { success: false, output: e.message };
    }
  },

  async computerControl(action, args) {
    try {
      const cc = require('./computer-control');
      if (typeof cc[action] === 'function') {
        const result = cc[action](args);
        return { success: true, output: typeof result === 'string' ? result : JSON.stringify(result) };
      }
      return { success: false, output: 'Unknown action: ' + action };
    } catch (e) {
      return { success: false, output: e.message };
    }
  },

  async imageAnalysis(imagePath) {
    try {
      if (!fs.existsSync(imagePath)) return { success: false, output: 'File not found: ' + imagePath };
      const base64 = fs.readFileSync(imagePath).toString('base64');
      const ext = path.extname(imagePath).toLowerCase();
      const mime = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : 'image/jpeg';
      return { success: true, output: `Image loaded (${mime}, ${Math.round(base64.length * 0.75 / 1024)}KB). Use AI vision to analyze.`, base64, mediaType: mime };
    } catch (e) {
      return { success: false, output: e.message };
    }
  },

  async spawn(command, args) {
    try {
      const { spawn: spawnChild } = require('child_process');
      const child = spawnChild(command, args || [], { detached: true, stdio: 'ignore', shell: true });
      child.unref();
      return { success: true, output: `Spawned: ${command} (PID ${child.pid})` };
    } catch (e) {
      return { success: false, output: e.message };
    }
  },

  async crypto(action, data) {
    try {
      const crypto = require('crypto');
      if (action === 'hash') return { success: true, output: crypto.createHash('sha256').update(data).digest('hex') };
      if (action === 'uuid') return { success: true, output: crypto.randomUUID() };
      if (action === 'random') return { success: true, output: crypto.randomBytes(parseInt(data) || 32).toString('hex') };
      if (action === 'base64') return { success: true, output: Buffer.from(data).toString('base64') };
      if (action === 'decode64') return { success: true, output: Buffer.from(data, 'base64').toString('utf8') };
      return { success: false, output: 'Actions: hash, uuid, random, base64, decode64' };
    } catch (e) {
      return { success: false, output: e.message };
    }
  },

  async serve(dir, port) {
    try {
      const http = require('http');
      const servePath = dir || '.';
      const servePort = port || 8080;
      const server = http.createServer((req, res) => {
        const filePath = path.join(servePath, req.url === '/' ? 'index.html' : req.url);
        try {
          const content = fs.readFileSync(filePath);
          const ext = path.extname(filePath).toLowerCase();
          const mimes = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
          res.writeHead(200, { 'Content-Type': mimes[ext] || 'text/plain' });
          res.end(content);
        } catch {
          res.writeHead(404); res.end('Not found');
        }
      });
      server.listen(servePort, '127.0.0.1');
      return { success: true, output: `Serving ${servePath} on http://127.0.0.1:${servePort}` };
    } catch (e) {
      return { success: false, output: e.message };
    }
  },

  async canvas(filename, content) {
    try {
      const canvasDir = path.join(__dirname, '..', 'data', 'canvas');
      if (!fs.existsSync(canvasDir)) fs.mkdirSync(canvasDir, { recursive: true });
      const filePath = path.join(canvasDir, filename);
      fs.writeFileSync(filePath, content);
      return { success: true, output: `Canvas created: /canvas/${filename}` };
    } catch (e) {
      return { success: false, output: e.message };
    }
  },

  async sandbox(code, language) {
    try {
      const lang = (language || 'node').toLowerCase();
      if (lang === 'node' || lang === 'javascript' || lang === 'js') {
        const tmpFile = path.join(os.tmpdir(), `aries-sandbox-${Date.now()}.js`);
        fs.writeFileSync(tmpFile, code);
        const result = execSync(`node "${tmpFile}"`, { encoding: 'utf8', timeout: 30000 });
        try { fs.unlinkSync(tmpFile); } catch {}
        return { success: true, output: truncate(result.trim()) };
      } else if (lang === 'python' || lang === 'py') {
        const tmpFile = path.join(os.tmpdir(), `aries-sandbox-${Date.now()}.py`);
        fs.writeFileSync(tmpFile, code);
        const result = execSync(`python "${tmpFile}"`, { encoding: 'utf8', timeout: 30000 });
        try { fs.unlinkSync(tmpFile); } catch {}
        return { success: true, output: truncate(result.trim()) };
      }
      return { success: false, output: 'Supported languages: node, python' };
    } catch (e) {
      return { success: false, output: truncate((e.stdout || '') + (e.stderr || '') || e.message) };
    }
  },

  async memorySearch(query) {
    try {
      const entries = memory.list();
      const q = query.toLowerCase();
      const matches = entries.filter(m => (m.text || '').toLowerCase().includes(q) || (m.category || '').toLowerCase().includes(q));
      if (matches.length === 0) return { success: true, output: 'No matches found' };
      return { success: true, output: matches.slice(0, 10).map(m => `[${m.priority || 'normal'}/${m.category || 'general'}] ${m.text}`).join('\n') };
    } catch (e) {
      return { success: false, output: e.message };
    }
  },

  async http(method, url, body, headers) {
    try {
      const parsedUrl = new (require('url').URL)(url);
      const httpMod = parsedUrl.protocol === 'https:' ? require('https') : require('http');
      return new Promise((resolve) => {
        const opts = { method: method || 'GET', headers: headers || {}, timeout: 15000, rejectUnauthorized: false };
        if (body) opts.headers['Content-Length'] = Buffer.byteLength(body);
        const req = httpMod.request(parsedUrl, opts, (res) => {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => resolve({ success: true, output: truncate(`HTTP ${res.statusCode}\n${data}`) }));
        });
        req.on('error', (e) => resolve({ success: false, output: e.message }));
        req.on('timeout', () => { req.destroy(); resolve({ success: false, output: 'timeout' }); });
        if (body) req.write(body);
        req.end();
      });
    } catch (e) {
      return { success: false, output: e.message };
    }
  },

  async message(target, text) {
    try {
      const msg = require('./messaging');
      if (msg && msg.send) {
        const result = await msg.send(target, text);
        return { success: true, output: `Message sent to ${target}` };
      }
      return { success: false, output: 'Messaging not configured' };
    } catch (e) {
      return { success: false, output: e.message };
    }
  },

  async webapp(name, html) {
    try {
      const canvasDir = path.join(__dirname, '..', 'data', 'canvas');
      if (!fs.existsSync(canvasDir)) fs.mkdirSync(canvasDir, { recursive: true });
      const fileName = (name || 'app') + '.html';
      fs.writeFileSync(path.join(canvasDir, fileName), html);
      return { success: true, output: `Web app created at /canvas/${fileName} — open http://127.0.0.1:3333/canvas/${fileName}` };
    } catch (e) {
      return { success: false, output: e.message };
    }
  },

  async websearch(query) {
    try {
      // Use DuckDuckGo instant answer API (zero deps)
      const https = require('https');
      const q = encodeURIComponent(query);
      return new Promise((resolve) => {
        const req = https.get(`https://api.duckduckgo.com/?q=${q}&format=json&no_html=1`, { timeout: 10000, rejectUnauthorized: false }, (res) => {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => {
            try {
              const j = JSON.parse(data);
              const results = [];
              if (j.Abstract) results.push(`**${j.Heading}**: ${j.Abstract}`);
              if (j.Answer) results.push(`Answer: ${j.Answer}`);
              (j.RelatedTopics || []).slice(0, 5).forEach(t => {
                if (t.Text) results.push(`• ${t.Text}`);
              });
              resolve({ success: true, output: results.length > 0 ? results.join('\n') : 'No instant results. Try <tool:web>https://www.google.com/search?q=' + q + '</tool:web>' });
            } catch { resolve({ success: true, output: 'Search returned no structured results. Use <tool:web> to fetch search page.' }); }
          });
        });
        req.on('error', (e) => resolve({ success: false, output: e.message }));
        req.on('timeout', () => { req.destroy(); resolve({ success: false, output: 'timeout' }); });
      });
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

const MAX_SINGLE_OUTPUT = 10240; // 10KB

/**
 * Execute a single tool call, return result as string. Never throws.
 */
async function executeSingle(toolName, args) {
  try {
    const fn = loggedTools[toolName];
    if (!fn || typeof fn !== 'function') return `[error] Unknown tool: ${toolName}`;
    const result = await fn.apply(loggedTools, Array.isArray(args) ? args : [args]);
    if (!result) return '(no output)';
    const output = typeof result === 'string' ? result : (result.output || JSON.stringify(result));
    const success = result.success !== undefined ? result.success : true;
    const prefix = success ? '✓' : '✗';
    if (output.length > MAX_SINGLE_OUTPUT) {
      return `${prefix} ${output.substring(0, MAX_SINGLE_OUTPUT)}\n... (truncated, ${output.length} bytes total)`;
    }
    return `${prefix} ${output}`;
  } catch (e) {
    return `[error] ${e.message}`;
  }
}

loggedTools.executeSingle = executeSingle;
module.exports = loggedTools;
