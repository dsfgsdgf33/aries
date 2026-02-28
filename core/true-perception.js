/**
 * ARIES — True Perception v2.0
 * Deep Windows integration — UI Automation, input patterns, network, processes,
 * clipboard, window layout, event log, audio state, file watching.
 * No npm deps. PowerShell for Windows APIs with graceful fallback.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync, exec } = require('child_process');

const DATA_DIR = path.join(__dirname, '..', 'data', 'perception');
const WORKSPACE = path.join(__dirname, '..', '..');

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function today() { return new Date().toISOString().split('T')[0]; }
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function ts() { return Date.now(); }
function ago(ms) { const s = Math.floor(ms/1000); if (s < 60) return s+'s'; if (s < 3600) return Math.floor(s/60)+'m'; return Math.floor(s/3600)+'h '+Math.floor((s%3600)/60)+'m'; }

function ps(cmd, timeout) {
  try {
    return execSync('powershell -NoProfile -NonInteractive -Command "' + cmd.replace(/"/g, '\\"') + '"',
      { timeout: timeout || 8000, encoding: 'utf8', windowsHide: true }).trim();
  } catch { return ''; }
}

function psJSON(cmd, timeout) {
  const raw = ps(cmd, timeout);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

const PERCEPTION_TYPES = {
  UI_TREE:        { emoji: '🖥️', label: 'UI Tree' },
  INPUT_PATTERN:  { emoji: '⌨️', label: 'Input Pattern' },
  FILE_CHANGE:    { emoji: '📄', label: 'File Change' },
  NETWORK:        { emoji: '🌐', label: 'Network' },
  CLIPBOARD:      { emoji: '📋', label: 'Clipboard' },
  PROCESS:        { emoji: '⚙️', label: 'Process' },
  WINDOW_LAYOUT:  { emoji: '🪟', label: 'Window Layout' },
  SYSTEM_EVENT:   { emoji: '📢', label: 'System Event' },
  AUDIO:          { emoji: '🔊', label: 'Audio' },
  ANOMALY:        { emoji: '⚠️', label: 'Anomaly' },
};

// Known services by port
const KNOWN_SERVICES = {
  5010: 'DOOMTRADER', 3000: 'Aries', 3001: 'Aries-Dev', 8080: 'WebServer',
  5432: 'PostgreSQL', 3306: 'MySQL', 27017: 'MongoDB', 6379: 'Redis',
  22: 'SSH', 80: 'HTTP', 443: 'HTTPS', 8443: 'HTTPS-Alt',
};

// Sensitive clipboard patterns
const SENSITIVE_PATTERNS = [
  /^(sk|pk|api|token|key|secret|password|bearer)\s*[=:_-]/i,
  /^[A-Za-z0-9+/]{40,}={0,2}$/,
  /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
  /^ghp_[A-Za-z0-9]{36}/,
  /^npm_[A-Za-z0-9]{36}/,
];

class TruePerception {
  constructor(opts) {
    this.ai = opts && opts.ai;
    this.monologue = opts && opts.monologue;
    this._timer = null;
    this._intervalMs = (opts && opts.interval || 30) * 1000;
    this._perceptions = [];
    this._maxPerceptions = 1000;

    // State
    this._lastSnapshot = {};
    this._fileSnapshots = {};
    this._fileContents = {};
    this._lastClipboard = '';
    this._lastWindowLayout = [];
    this._lastProcessSet = new Set();
    this._inputHistory = [];
    this._typingBaseline = null;
    this._recentChanges = [];
    this._maxRecentChanges = 100;

    ensureDir();
    this._loadToday();
  }

  _loadToday() {
    const file = path.join(DATA_DIR, today() + '.json');
    this._perceptions = readJSON(file, []);
  }

  _save() {
    const file = path.join(DATA_DIR, today() + '.json');
    if (this._perceptions.length > this._maxPerceptions) {
      this._perceptions = this._perceptions.slice(-this._maxPerceptions);
    }
    writeJSON(file, this._perceptions);
  }

  // ── Start / Stop ──

  startPerception(interval) {
    if (this._timer) return { status: 'already_running', interval: this._intervalMs };
    if (interval) this._intervalMs = interval * 1000;
    this._initBaseline();
    this._timer = setInterval(() => this.perceive(), this._intervalMs);
    if (this._timer.unref) this._timer.unref();
    console.log('[PERCEPTION] v2 started (interval: ' + (this._intervalMs / 1000) + 's)');
    return { status: 'started', interval: this._intervalMs };
  }

  stopPerception() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    console.log('[PERCEPTION] v2 stopped');
    return { status: 'stopped' };
  }

  _initBaseline() {
    try { this._fileSnapshots = this._scanWorkspaceFiles(); } catch {}
    try { this._lastClipboard = this._getClipboardRaw(); } catch {}
    try { this._lastProcessSet = new Set(this._getProcessNames()); } catch {}
    try { this._lastWindowLayout = this._getWindowLayoutRaw(); } catch {}
  }

  // ── Core perception cycle ──

  async perceive() {
    const started = ts();
    try {
      this._perceiveUITree();
      this._perceiveInputPatterns();
      this._perceiveFiles();
      this._perceiveNetwork();
      this._perceiveClipboard();
      this._perceiveProcesses();
      this._perceiveWindowLayout();
      this._perceiveSystemEvents();
      this._perceiveAudio();
      this._save();
    } catch (e) {
      console.error('[PERCEPTION] cycle error:', e.message);
    }
    return { cycleMs: ts() - started, perceptionCount: this._perceptions.length };
  }

  _addPerception(channel, type, content, notable, insight, confidence) {
    const p = {
      id: uuid(),
      timestamp: ts(),
      channel,
      type,
      content,
      notable: !!notable,
      insight: insight || null,
      confidence: confidence || 0.8,
    };
    this._perceptions.push(p);

    if (notable && this.monologue && typeof this.monologue.addThought === 'function') {
      try {
        this.monologue.addThought({
          id: uuid(), type: 'OBSERVATION', content: insight || (typeof content === 'string' ? content : JSON.stringify(content)),
          timestamp: ts(), relatedTo: 'perception:' + channel.toLowerCase(), priority: 'normal', source: 'perception',
        });
      } catch {}
    }
    return p;
  }

  // ═══════════════════════════════════════
  // 1. UI Automation Tree Reading
  // ═══════════════════════════════════════

  readActiveWindow() {
    const script = `
      Add-Type -AssemblyName UIAutomationClient
      Add-Type -AssemblyName UIAutomationTypes
      $auto = [System.Windows.Automation.AutomationElement]
      $root = $auto::FocusedElement
      if (-not $root) { $root = $auto::RootElement }
      $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
      function Get-UITree($el, $depth) {
        if ($depth -gt 3 -or -not $el) { return $null }
        $name = $el.Current.Name
        $type = $el.Current.ControlType.ProgrammaticName -replace 'ControlType.',''
        $cls = $el.Current.ClassName
        $items = @()
        $child = $walker.GetFirstChild($el)
        $count = 0
        while ($child -and $count -lt 20) {
          $sub = Get-UITree $child ($depth+1)
          if ($sub) { $items += $sub }
          $child = $walker.GetNextSibling($child)
          $count++
        }
        @{ name=$name; type=$type; class=$cls; children=$items }
      }
      $focusedWin = $root
      while ($focusedWin -and $focusedWin.Current.ControlType.ProgrammaticName -ne 'ControlType.Window') {
        $focusedWin = $walker.GetParent($focusedWin)
      }
      if (-not $focusedWin) { $focusedWin = $auto::RootElement }
      $proc = $null
      try { $proc = [System.Diagnostics.Process]::GetProcessById($focusedWin.Current.ProcessId) } catch {}
      $tree = Get-UITree $focusedWin 0
      @{
        app = if($proc){$proc.ProcessName}else{'unknown'}
        title = $focusedWin.Current.Name
        pid = $focusedWin.Current.ProcessId
        tree = $tree
      } | ConvertTo-Json -Depth 6 -Compress
    `;
    const result = psJSON(script, 12000);
    if (!result) {
      // Fallback: just get active window title
      const title = ps("(Get-Process | Where-Object {$_.MainWindowTitle -ne ''} | Sort-Object CPU -Descending | Select-Object -First 1).MainWindowTitle", 5000);
      return { app: 'unknown', title: title || 'Unknown', pid: 0, tree: null, fallback: true };
    }
    return this._parseAppSpecific(result);
  }

  readWindowByName(name) {
    const script = `
      Add-Type -AssemblyName UIAutomationClient
      $auto = [System.Windows.Automation.AutomationElement]
      $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, '${name.replace(/'/g, "''")}')
      $win = $auto::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
      if ($win) {
        $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
        function Get-UITree($el, $depth) {
          if ($depth -gt 3 -or -not $el) { return $null }
          $items = @()
          $child = $walker.GetFirstChild($el)
          $count = 0
          while ($child -and $count -lt 20) {
            $sub = Get-UITree $child ($depth+1)
            if ($sub) { $items += $sub }
            $child = $walker.GetNextSibling($child)
            $count++
          }
          @{ name=$el.Current.Name; type=$el.Current.ControlType.ProgrammaticName -replace 'ControlType.',''; children=$items }
        }
        Get-UITree $win 0 | ConvertTo-Json -Depth 6 -Compress
      } else { '{}' }
    `;
    return psJSON(script, 12000) || {};
  }

  _parseAppSpecific(uiData) {
    if (!uiData) return uiData;
    const app = (uiData.app || '').toLowerCase();
    const title = uiData.title || '';

    // VS Code
    if (app === 'code' || app.includes('code')) {
      const fileMatch = title.match(/^(.+?)\s*[-—●]\s*/);
      const gitMatch = title.match(/\(([^)]+)\)/);
      uiData.parsed = {
        appType: 'vscode',
        currentFile: fileMatch ? fileMatch[1].trim() : null,
        gitBranch: gitMatch ? gitMatch[1] : null,
        hasUnsavedChanges: title.includes('●'),
      };
    }
    // Browser
    else if (['chrome', 'firefox', 'msedge', 'brave'].some(b => app.includes(b))) {
      const urlMatch = title.match(/^(.*?)\s*[-—]\s*(Google Chrome|Firefox|Microsoft Edge|Brave)/);
      uiData.parsed = {
        appType: 'browser',
        pageTitle: urlMatch ? urlMatch[1].trim() : title,
        browser: app,
      };
    }
    // Terminal
    else if (['powershell', 'cmd', 'windowsterminal', 'conhost'].some(t => app.includes(t))) {
      uiData.parsed = { appType: 'terminal', shellType: app };
    }
    // TradingView (desktop or browser)
    else if (title.toLowerCase().includes('tradingview')) {
      const symbolMatch = title.match(/^([A-Z]+(?:USD|BTC|ETH)?)\s/);
      uiData.parsed = {
        appType: 'tradingview',
        symbol: symbolMatch ? symbolMatch[1] : null,
      };
    }

    return uiData;
  }

  _perceiveUITree() {
    try {
      const ui = this.readActiveWindow();
      const lastTitle = this._lastSnapshot.activeWindowTitle || '';
      this._lastSnapshot.uiTree = ui;
      this._lastSnapshot.activeWindowTitle = ui.title;

      if (ui.title !== lastTitle) {
        const hasError = (ui.title || '').toLowerCase().includes('error') ||
          JSON.stringify(ui.tree || {}).toLowerCase().includes('error');
        const insight = ui.parsed ? `Active: ${ui.parsed.appType}${ui.parsed.currentFile ? ' — ' + ui.parsed.currentFile : ''}` :
          `Window: ${(ui.title || '').slice(0, 60)}`;
        this._addPerception('UI_TREE', 'UI_TREE', ui, hasError, hasError ? 'Error detected in UI: ' + ui.title.slice(0, 80) : insight, 0.85);
      }
    } catch {}
  }

  // ═══════════════════════════════════════
  // 2. Input Pattern Analysis
  // ═══════════════════════════════════════

  getInputPatterns() {
    const script = `
      try {
        Add-Type @'
        using System;
        using System.Runtime.InteropServices;
        public class IdleTime {
          [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
          [StructLayout(LayoutKind.Sequential)] struct LASTINPUTINFO {
            public uint cbSize; public uint dwTime;
          }
          public static uint GetIdleMs() {
            LASTINPUTINFO info = new LASTINPUTINFO();
            info.cbSize = (uint)Marshal.SizeOf(info);
            GetLastInputInfo(ref info);
            return ((uint)Environment.TickCount - info.dwTime);
          }
        }
'@
        $idle = [IdleTime]::GetIdleMs()
        @{ idleMs = $idle; idleSec = [Math]::Round($idle/1000,1) } | ConvertTo-Json -Compress
      } catch {
        @{ idleMs = -1; idleSec = -1; error = $_.Exception.Message } | ConvertTo-Json -Compress
      }
    `;
    const idleData = psJSON(script, 5000) || { idleMs: -1, idleSec: -1 };
    const idleMs = idleData.idleMs || 0;

    // Derive activity level
    let activityLevel = 'active';
    let mousePattern = 'precise_focus';
    if (idleMs > 300000) { activityLevel = 'idle'; mousePattern = 'idle'; }
    else if (idleMs > 60000) { activityLevel = 'low'; mousePattern = 'idle'; }
    else if (idleMs > 10000) { activityLevel = 'moderate'; }
    else { activityLevel = 'active'; mousePattern = 'precise_focus'; }

    // Track history
    this._inputHistory.push({ timestamp: ts(), idleMs, activityLevel });
    if (this._inputHistory.length > 60) this._inputHistory = this._inputHistory.slice(-60);

    // Compute trends
    const recent = this._inputHistory.slice(-10);
    const avgIdle = recent.reduce((s, h) => s + h.idleMs, 0) / (recent.length || 1);
    const activeCount = recent.filter(h => h.activityLevel === 'active').length;

    return {
      idleMs,
      idleSec: idleData.idleSec,
      activityLevel,
      mousePattern,
      typingSpeedTrend: activeCount > 7 ? 'high' : activeCount > 4 ? 'normal' : 'low',
      pauseFrequency: recent.filter(h => h.idleMs > 10000).length / (recent.length || 1),
      avgIdleMs: Math.round(avgIdle),
      historyLength: this._inputHistory.length,
    };
  }

  _perceiveInputPatterns() {
    try {
      const patterns = this.getInputPatterns();
      this._lastSnapshot.inputPatterns = patterns;

      // Detect fatigue: if avg idle jumped significantly
      const baseline = this._typingBaseline;
      if (baseline && patterns.avgIdleMs > baseline * 1.3) {
        this._addPerception('INPUT_PATTERN', 'ANOMALY',
          { ...patterns, anomaly: 'possible_fatigue' }, true,
          'Typing/activity dropped >30% from baseline — possible fatigue or distraction', 0.7);
      } else {
        if (!baseline && patterns.historyLength >= 10) {
          this._typingBaseline = patterns.avgIdleMs;
        }
        // Only record if something interesting
        if (patterns.activityLevel === 'idle') {
          this._addPerception('INPUT_PATTERN', 'INPUT_PATTERN', patterns, false, null, 0.9);
        }
      }
    } catch {}
  }

  // ═══════════════════════════════════════
  // 3. Deep File System Watching
  // ═══════════════════════════════════════

  getRecentChanges(limit) {
    return this._recentChanges.slice(-(limit || 20)).reverse();
  }

  getChangeContext(filePath) {
    const changes = this._recentChanges.filter(c => c.file === filePath || c.file.endsWith(filePath));
    if (!changes.length) return { file: filePath, status: 'no_changes_tracked' };
    const latest = changes[changes.length - 1];
    return latest;
  }

  _perceiveFiles() {
    try {
      const current = this._scanWorkspaceFiles();
      const changes = [];

      for (const [file, mtime] of Object.entries(current)) {
        const prev = this._fileSnapshots[file];
        if (!prev) {
          changes.push({ file, action: 'created', basename: path.basename(file), mtime });
        } else if (mtime > prev) {
          // Compute simple diff
          let diff = null;
          try {
            const newContent = fs.readFileSync(file, 'utf8');
            const oldContent = this._fileContents[file];
            if (oldContent && newContent.length < 100000) {
              const oldLines = oldContent.split('\n');
              const newLines = newContent.split('\n');
              const added = newLines.filter(l => !oldLines.includes(l)).length;
              const removed = oldLines.filter(l => !newLines.includes(l)).length;
              diff = { linesAdded: added, linesRemoved: removed, sizeDelta: newContent.length - oldContent.length };
            }
            this._fileContents[file] = newContent;
          } catch {}
          changes.push({ file, action: 'modified', basename: path.basename(file), mtime, diff });
        }
      }

      for (const file of Object.keys(this._fileSnapshots)) {
        if (!current[file]) {
          changes.push({ file, action: 'deleted', basename: path.basename(file) });
        }
      }

      this._fileSnapshots = current;

      if (changes.length > 0 && changes.length <= 30) {
        for (const c of changes) {
          this._recentChanges.push({ ...c, timestamp: ts() });
        }
        if (this._recentChanges.length > this._maxRecentChanges) {
          this._recentChanges = this._recentChanges.slice(-this._maxRecentChanges);
        }

        const content = changes.map(c => `${c.action}: ${c.basename}`).join(', ');
        const notable = changes.length >= 3 || changes.some(c => c.action === 'deleted');
        this._addPerception('FILE_CHANGE', 'FILE_CHANGE',
          { changes, summary: content }, notable,
          notable ? `${changes.length} file(s) changed: ${content.slice(0, 120)}` : null, 0.95);
      }
    } catch {}
  }

  _scanWorkspaceFiles() {
    const files = {};
    const scan = (dir, depth) => {
      if (depth > 3) return;
      try {
        const entries = fs.readdirSync(dir);
        for (const entry of entries) {
          if (entry.startsWith('.') || entry === 'node_modules' || entry === 'data') continue;
          const full = path.join(dir, entry);
          try {
            const stat = fs.statSync(full);
            if (stat.isDirectory()) scan(full, depth + 1);
            else if (stat.isFile()) files[full] = stat.mtimeMs;
          } catch {}
        }
      } catch {}
    };
    scan(WORKSPACE, 0);
    return files;
  }

  // ═══════════════════════════════════════
  // 4. Network Awareness
  // ═══════════════════════════════════════

  getActiveServices() {
    const script = `
      try {
        $conns = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
          Select-Object LocalPort, OwningProcess |
          Sort-Object LocalPort -Unique
        $result = @()
        foreach ($c in $conns) {
          $proc = try { (Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue).ProcessName } catch { 'unknown' }
          $result += @{ port = $c.LocalPort; pid = $c.OwningProcess; process = $proc }
        }
        $result | ConvertTo-Json -Compress
      } catch { '[]' }
    `;
    const services = psJSON(script, 8000) || [];
    const arr = Array.isArray(services) ? services : [services];
    return arr.map(s => ({
      ...s,
      knownService: KNOWN_SERVICES[s.port] || null,
    }));
  }

  getConnectionHealth() {
    const script = `
      try {
        $est = (Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue | Measure-Object).Count
        $tw = (Get-NetTCPConnection -State TimeWait -ErrorAction SilentlyContinue | Measure-Object).Count
        $cw = (Get-NetTCPConnection -State CloseWait -ErrorAction SilentlyContinue | Measure-Object).Count
        @{ established=$est; timeWait=$tw; closeWait=$cw; healthy=($cw -lt 10) } | ConvertTo-Json -Compress
      } catch { @{ established=0; timeWait=0; closeWait=0; healthy=$true; error=$_.Exception.Message } | ConvertTo-Json -Compress }
    `;
    return psJSON(script, 8000) || { established: 0, healthy: true };
  }

  getNetworkSnapshot() {
    return {
      services: this.getActiveServices(),
      health: this.getConnectionHealth(),
      timestamp: ts(),
    };
  }

  _perceiveNetwork() {
    try {
      const health = this.getConnectionHealth();
      this._lastSnapshot.network = health;
      if (!health.healthy) {
        this._addPerception('NETWORK', 'ANOMALY',
          health, true, `Network issue: ${health.closeWait} connections in CloseWait`, 0.8);
      }
    } catch {}
  }

  // ═══════════════════════════════════════
  // 5. Clipboard Intelligence
  // ═══════════════════════════════════════

  _getClipboardRaw() {
    return ps('Get-Clipboard', 3000);
  }

  _classifyClipboard(text) {
    if (!text) return 'empty';
    if (/^https?:\/\//i.test(text)) return 'url';
    if (/^[a-zA-Z]:\\|^\/[a-z]/i.test(text)) return 'file_path';
    if (/error|exception|traceback|failed|ENOENT|ECONNREFUSED/i.test(text)) return 'error_message';
    if (/^[\s\S]*[{(\[;=][\s\S]*$/.test(text) && text.length > 20) return 'code_snippet';
    if (/^\d[\d.,\s\t]+$/.test(text)) return 'data';
    return 'text';
  }

  _isSensitive(text) {
    return SENSITIVE_PATTERNS.some(p => p.test(text.trim()));
  }

  getClipboardContext() {
    const raw = this._getClipboardRaw();
    if (!raw || raw.length < 2) return { content: null, type: 'empty' };
    if (this._isSensitive(raw)) return { content: '[REDACTED — sensitive]', type: 'sensitive', length: raw.length };
    const type = this._classifyClipboard(raw);
    return {
      content: raw.length > 500 ? raw.slice(0, 500) + '...' : raw,
      type,
      length: raw.length,
      insight: type === 'error_message' ? 'Clipboard contains an error — user may be debugging' :
        type === 'url' ? 'URL copied — possibly navigating or sharing' :
        type === 'code_snippet' ? 'Code copied — likely coding or reviewing' : null,
    };
  }

  _perceiveClipboard() {
    try {
      const raw = this._getClipboardRaw();
      if (!raw || raw === this._lastClipboard || raw.length < 2 || raw.length > 10000) return;
      this._lastClipboard = raw;

      if (this._isSensitive(raw)) return; // Skip sensitive

      const type = this._classifyClipboard(raw);
      const notable = type === 'error_message';
      const content = { text: raw.length > 300 ? raw.slice(0, 300) + '...' : raw, type, length: raw.length };
      this._addPerception('CLIPBOARD', 'CLIPBOARD', content, notable,
        notable ? 'Error message copied to clipboard — user may be debugging' : null, 0.9);
    } catch {}
  }

  // ═══════════════════════════════════════
  // 6. Process Intelligence
  // ═══════════════════════════════════════

  _getProcessNames() {
    const raw = ps("Get-Process | Select-Object -Unique -ExpandProperty ProcessName | Sort-Object", 5000);
    return raw ? raw.split('\n').map(s => s.trim()).filter(Boolean) : [];
  }

  getProcessHealth() {
    const script = `
      try {
        $procs = Get-Process | Where-Object { $_.WorkingSet64 -gt 0 } |
          Select-Object ProcessName, Id, CPU,
            @{N='MemMB';E={[Math]::Round($_.WorkingSet64/1MB,0)}},
            @{N='Responding';E={$_.Responding}} |
          Sort-Object MemMB -Descending | Select-Object -First 30
        $highMem = $procs | Where-Object { $_.MemMB -gt 1024 }
        $notResp = $procs | Where-Object { $_.Responding -eq $false }
        @{
          processes = $procs
          highMemory = @($highMem)
          notResponding = @($notResp)
          totalProcesses = (Get-Process | Measure-Object).Count
        } | ConvertTo-Json -Depth 3 -Compress
      } catch { @{ processes=@(); error=$_.Exception.Message } | ConvertTo-Json -Compress }
    `;
    return psJSON(script, 10000) || { processes: [], totalProcesses: 0 };
  }

  getRunningServices() {
    const services = this.getActiveServices();
    const health = this.getProcessHealth();
    return { services, processHealth: health, timestamp: ts() };
  }

  _perceiveProcesses() {
    try {
      const current = new Set(this._getProcessNames());
      const newProcs = [];
      for (const p of current) { if (!this._lastProcessSet.has(p)) newProcs.push(p); }
      const goneProcs = [];
      for (const p of this._lastProcessSet) { if (!current.has(p)) goneProcs.push(p); }
      this._lastProcessSet = current;

      if (newProcs.length > 0 && newProcs.length <= 10) {
        this._addPerception('PROCESS', 'PROCESS',
          { newProcesses: newProcs, action: 'started' }, true,
          `New process(es): ${newProcs.join(', ')}`, 0.9);
      }
      if (goneProcs.length > 0 && goneProcs.length <= 10) {
        this._addPerception('PROCESS', 'PROCESS',
          { goneProcesses: goneProcs, action: 'stopped' }, goneProcs.length >= 3,
          goneProcs.length >= 3 ? `Multiple processes stopped: ${goneProcs.join(', ')}` : null, 0.85);
      }

      // Check for high memory
      const health = this.getProcessHealth();
      this._lastSnapshot.processHealth = health;
      if (health.highMemory && health.highMemory.length > 0) {
        this._addPerception('PROCESS', 'ANOMALY',
          { highMemory: health.highMemory }, true,
          `High memory: ${health.highMemory.map(p => p.ProcessName + ' (' + p.MemMB + 'MB)').join(', ')}`, 0.85);
      }
      if (health.notResponding && health.notResponding.length > 0) {
        this._addPerception('PROCESS', 'ANOMALY',
          { notResponding: health.notResponding }, true,
          `Not responding: ${health.notResponding.map(p => p.ProcessName).join(', ')}`, 0.9);
      }
    } catch {}
  }

  // ═══════════════════════════════════════
  // 7. Window Layout
  // ═══════════════════════════════════════

  _getWindowLayoutRaw() {
    const script = `
      try {
        $wins = Get-Process | Where-Object { $_.MainWindowTitle -ne '' } |
          Select-Object ProcessName, MainWindowTitle, Id,
            @{N='Responding';E={$_.Responding}} |
          Sort-Object ProcessName
        @($wins) | ConvertTo-Json -Compress
      } catch { '[]' }
    `;
    return psJSON(script, 8000) || [];
  }

  getWorkspaceLayout() {
    const windows = this._getWindowLayoutRaw();
    const arr = Array.isArray(windows) ? windows : [windows];
    return {
      windows: arr.map(w => ({
        process: w.ProcessName,
        title: (w.MainWindowTitle || '').slice(0, 100),
        pid: w.Id,
        responding: w.Responding !== false,
      })),
      count: arr.length,
      timestamp: ts(),
    };
  }

  detectWorkspaceChange() {
    const current = this._getWindowLayoutRaw();
    const curArr = Array.isArray(current) ? current : [current];
    const prevArr = Array.isArray(this._lastWindowLayout) ? this._lastWindowLayout : [];

    const curNames = new Set(curArr.map(w => w.ProcessName));
    const prevNames = new Set(prevArr.map(w => w.ProcessName));

    const opened = [...curNames].filter(n => !prevNames.has(n));
    const closed = [...prevNames].filter(n => !curNames.has(n));

    return { opened, closed, changed: opened.length > 0 || closed.length > 0, timestamp: ts() };
  }

  _perceiveWindowLayout() {
    try {
      const change = this.detectWorkspaceChange();
      const current = this._getWindowLayoutRaw();
      this._lastWindowLayout = current;
      this._lastSnapshot.windowLayout = this.getWorkspaceLayout();

      if (change.changed && (change.opened.length + change.closed.length) <= 8) {
        const notable = change.opened.length + change.closed.length >= 3;
        const parts = [];
        if (change.opened.length) parts.push('Opened: ' + change.opened.join(', '));
        if (change.closed.length) parts.push('Closed: ' + change.closed.join(', '));
        this._addPerception('WINDOW_LAYOUT', 'WINDOW_LAYOUT',
          change, notable, notable ? parts.join('; ') : null, 0.85);
      }
    } catch {}
  }

  // ═══════════════════════════════════════
  // 8. Windows Event Log
  // ═══════════════════════════════════════

  getSystemEvents(limit) {
    const n = limit || 15;
    const script = `
      try {
        $events = Get-WinEvent -LogName Application -MaxEvents ${n} -ErrorAction SilentlyContinue |
          Where-Object { $_.Level -le 3 } |
          Select-Object TimeCreated, Id, LevelDisplayName, ProviderName,
            @{N='Msg';E={($_.Message -split '\\n')[0].Substring(0,[Math]::Min(200,($_.Message -split '\\n')[0].Length))}} |
          Select-Object -First ${n}
        @($events) | ConvertTo-Json -Compress
      } catch { '[]' }
    `;
    return psJSON(script, 10000) || [];
  }

  getWarnings() {
    const script = `
      try {
        $warns = @()
        $app = Get-WinEvent -LogName Application -MaxEvents 50 -ErrorAction SilentlyContinue |
          Where-Object { $_.Level -le 2 -and $_.TimeCreated -gt (Get-Date).AddHours(-6) }
        $sys = Get-WinEvent -LogName System -MaxEvents 50 -ErrorAction SilentlyContinue |
          Where-Object { $_.Level -le 2 -and $_.TimeCreated -gt (Get-Date).AddHours(-6) }
        $all = @($app) + @($sys)
        foreach ($e in $all) {
          $warns += @{
            time = $e.TimeCreated.ToString('o')
            level = $e.LevelDisplayName
            source = $e.ProviderName
            msg = ($e.Message -split '\\n')[0].Substring(0,[Math]::Min(150,($e.Message -split '\\n')[0].Length))
          }
        }
        $warns | Select-Object -First 20 | ConvertTo-Json -Compress
      } catch { '[]' }
    `;
    return psJSON(script, 10000) || [];
  }

  _perceiveSystemEvents() {
    try {
      const warnings = this.getWarnings();
      const arr = Array.isArray(warnings) ? warnings : [];
      this._lastSnapshot.systemEvents = arr;
      if (arr.length > 0) {
        this._addPerception('SYSTEM_EVENT', 'SYSTEM_EVENT',
          { warnings: arr.slice(0, 5), count: arr.length }, arr.length > 3,
          arr.length > 3 ? `${arr.length} system warnings in last 6h` : null, 0.75);
      }
    } catch {}
  }

  // ═══════════════════════════════════════
  // 9. Audio Level Detection
  // ═══════════════════════════════════════

  getAudioState() {
    const script = `
      try {
        Add-Type -TypeDefinition @'
        using System;
        using System.Runtime.InteropServices;
        [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IAudioEndpointVolume {
          int _0(); int _1(); int _2(); int _3(); int _4(); int _5(); int _6(); int _7(); int _8();
          int GetMasterVolumeLevelScalar(out float level);
          int _10();
          int GetMute(out bool mute);
        }
        [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IMMDevice { int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface); }
        [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IMMDeviceEnumerator { int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppDevice); }
        [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorFactory {}
        public class AudioHelper {
          public static string GetState() {
            try {
              var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorFactory());
              IMMDevice speakers; enumerator.GetDefaultAudioEndpoint(0, 1, out speakers);
              var iid = typeof(IAudioEndpointVolume).GUID;
              object o; speakers.Activate(ref iid, 1, IntPtr.Zero, out o);
              var vol = (IAudioEndpointVolume)o;
              float level; vol.GetMasterVolumeLevelScalar(out level);
              bool mute; vol.GetMute(out mute);
              return "{\\\"speakerVolume\\\":" + (int)(level*100) + ",\\\"speakerMuted\\\":" + mute.ToString().ToLower() + "}";
            } catch { return "{\\\"speakerVolume\\\":-1,\\\"speakerMuted\\\":false,\\\"error\\\":\\\"unavailable\\\"}"; }
          }
        }
'@
        [AudioHelper]::GetState()
      } catch {
        @{ speakerVolume=-1; speakerMuted=$false; error=$_.Exception.Message } | ConvertTo-Json -Compress
      }
    `;
    const audio = psJSON(script, 8000) || { speakerVolume: -1, speakerMuted: false };

    // Derive context
    let context = 'unknown';
    if (audio.speakerMuted || audio.speakerVolume === 0) context = 'silent';
    else if (audio.speakerVolume > 0) context = 'listening';

    return {
      ...audio,
      context,
      timestamp: ts(),
    };
  }

  _perceiveAudio() {
    try {
      const audio = this.getAudioState();
      this._lastSnapshot.audio = audio;
      // No need to log every cycle — only log notable changes
    } catch {}
  }

  // ═══════════════════════════════════════
  // Main Query Methods
  // ═══════════════════════════════════════

  getPerceptions(limit, type) {
    let perceptions = this._perceptions;
    if (type) perceptions = perceptions.filter(p => p.type === type.toUpperCase() || p.channel === type.toUpperCase());
    return perceptions.slice(-(limit || 50)).reverse();
  }

  getNotable() {
    return this._perceptions.filter(p => p.notable).slice(-50).reverse();
  }

  getFullSnapshot() {
    // Collect all current state
    let uiTree, inputPatterns, network, clipboard, processHealth, layout, audio;
    try { uiTree = this.readActiveWindow(); } catch { uiTree = { error: 'unavailable' }; }
    try { inputPatterns = this.getInputPatterns(); } catch { inputPatterns = { error: 'unavailable' }; }
    try { network = this.getNetworkSnapshot(); } catch { network = { error: 'unavailable' }; }
    try { clipboard = this.getClipboardContext(); } catch { clipboard = { error: 'unavailable' }; }
    try { processHealth = this.getProcessHealth(); } catch { processHealth = { error: 'unavailable' }; }
    try { layout = this.getWorkspaceLayout(); } catch { layout = { error: 'unavailable' }; }
    try { audio = this.getAudioState(); } catch { audio = { error: 'unavailable' }; }

    return {
      timestamp: ts(),
      monitoring: !!this._timer,
      perceptionCount: this._perceptions.length,
      notableCount: this._perceptions.filter(p => p.notable).length,
      uiTree,
      inputPatterns,
      fileChanges: this.getRecentChanges(10),
      network,
      clipboard,
      processHealth,
      windowLayout: layout,
      audio,
      systemEvents: this._lastSnapshot.systemEvents || [],
    };
  }

  // Backward compat
  getEnvironmentSnapshot() {
    return {
      activeWindow: this._lastSnapshot.activeWindowTitle || 'Unknown',
      system: this._lastSnapshot.processHealth || {},
      knownProcessCount: this._lastProcessSet.size,
      trackedFiles: Object.keys(this._fileSnapshots).length,
      perceptionCount: this._perceptions.length,
      notableCount: this._perceptions.filter(p => p.notable).length,
      lastUpdate: this._perceptions.length > 0 ? this._perceptions[this._perceptions.length - 1].timestamp : null,
      monitoring: !!this._timer,
    };
  }

  getEnvironmentNarrative() {
    const snap = this._lastSnapshot;
    const parts = [];

    // Window
    const win = snap.activeWindowTitle;
    if (win) parts.push(`Currently focused on: "${win.slice(0, 60)}".`);

    // Activity
    const input = snap.inputPatterns;
    if (input) {
      if (input.activityLevel === 'idle') parts.push(`User has been idle for ${Math.round(input.idleMs / 1000)}s.`);
      else if (input.activityLevel === 'active') parts.push('User is actively working.');
    }

    // Files
    const recent = this._recentChanges.slice(-3);
    if (recent.length) parts.push(`Recent file activity: ${recent.map(c => c.basename + ' (' + c.action + ')').join(', ')}.`);

    // Network
    if (snap.network && !snap.network.healthy) parts.push('⚠️ Network health issues detected.');

    // Audio
    if (snap.audio) {
      if (snap.audio.context === 'silent') parts.push('Audio is muted — focused mode.');
      else if (snap.audio.context === 'listening') parts.push(`Speakers at ${snap.audio.speakerVolume}% volume.`);
    }

    // Process anomalies
    if (snap.processHealth) {
      if (snap.processHealth.highMemory && snap.processHealth.highMemory.length)
        parts.push(`High memory usage: ${snap.processHealth.highMemory.map(p => p.ProcessName).join(', ')}.`);
      if (snap.processHealth.notResponding && snap.processHealth.notResponding.length)
        parts.push(`Not responding: ${snap.processHealth.notResponding.map(p => p.ProcessName).join(', ')}.`);
    }

    // System events
    if (snap.systemEvents && snap.systemEvents.length > 3) parts.push(`${snap.systemEvents.length} system warnings in last 6h.`);

    return {
      narrative: parts.join(' ') || 'No significant observations.',
      timestamp: ts(),
      channels: Object.keys(PERCEPTION_TYPES),
    };
  }

  getPerceptionHistory(limit, channel) {
    let perceptions = this._perceptions;
    if (channel) perceptions = perceptions.filter(p => p.channel === channel.toUpperCase());
    return perceptions.slice(-(limit || 50)).reverse();
  }

  getContextInjection() {
    const snap = this._lastSnapshot;
    const parts = [];
    if (snap.activeWindowTitle) parts.push('WIN:' + snap.activeWindowTitle.slice(0, 40));
    if (snap.inputPatterns) parts.push('ACT:' + snap.inputPatterns.activityLevel);
    const changes = this._recentChanges.slice(-3);
    if (changes.length) parts.push('FILES:' + changes.map(c => c.basename).join(','));
    if (snap.audio && snap.audio.context !== 'unknown') parts.push('AUD:' + snap.audio.context);
    return parts.join(' | ') || 'No context yet';
  }
}

module.exports = TruePerception;
