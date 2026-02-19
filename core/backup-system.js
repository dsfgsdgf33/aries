/**
 * ARIES v5.0 — Advanced Backup & Snapshot System
 * 
 * Comprehensive backup system with compressed archives, retention policies,
 * diff viewing, worker state capture, and REST API endpoints.
 * 
 * Format: .aries-backup files (gzipped JSON with base64-encoded file contents)
 * No npm dependencies — uses Node.js built-ins: fs, path, zlib, crypto
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const EventEmitter = require('events');

const BACKUP_VERSION = '2.0.0';
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB per file
const MAX_TOTAL_WARN = 500 * 1024 * 1024; // 500MB total warning threshold
const BACKUP_EXT = '.aries-backup';

class BackupSystem extends EventEmitter {
  /**
   * @param {Object} opts
   * @param {string} [opts.baseDir] - Aries root directory
   * @param {Object} [opts.relay] - Relay/worker system reference for worker state backup
   * @param {Object} [opts.swarm] - Swarm manager reference
   * @param {Object} [opts.logger] - Logger instance
   */
  constructor(opts = {}) {
    super();
    this.baseDir = opts.baseDir || path.join(__dirname, '..');
    this.backupDir = path.join(this.baseDir, 'data', 'backups');
    this.relay = opts.relay || null;
    this.swarm = opts.swarm || null;
    this.logger = opts.logger || console;
    this._timers = [];
    this._running = false;

    // Retention policy
    this.retention = {
      daily: 7,
      weekly: 4,
      monthly: 3
    };

    // Directories and file patterns to back up per component
    this._components = {
      config: {
        label: 'Configuration',
        paths: [
          { type: 'file', rel: 'config.json' },
          { type: 'dir', rel: 'config', extensions: ['.json', '.bak', '.enc'] }
        ]
      },
      workers: {
        label: 'Worker States',
        paths: [
          { type: 'file', rel: 'data/worker-metrics.json' },
          { type: 'file', rel: 'data/worker-chat.json' },
          { type: 'file', rel: 'data/swarm-health.json' }
        ],
        dynamic: true // also pulls live worker state via relay
      },
      data: {
        label: 'Application Data',
        paths: [
          { type: 'dir', rel: 'data', extensions: ['.json', '.log'], recursive: false },
          { type: 'dir', rel: 'data/earnings', extensions: ['.json'] },
          { type: 'dir', rel: 'data/memory', extensions: ['.json', '.md'] },
          { type: 'dir', rel: 'data/sessions', extensions: ['.json'] },
          { type: 'dir', rel: 'data/plugins', extensions: ['.json', '.js'] },
          { type: 'dir', rel: 'data/logs', extensions: ['.json', '.log'], maxAge: 7 * 86400000 }
        ]
      },
      schedules: {
        label: 'Schedules & Rules',
        paths: [
          { type: 'file', rel: 'data/scheduler-jobs.json' },
          { type: 'file', rel: 'data/scheduler-history.json' }
        ]
      },
      analytics: {
        label: 'Analytics & History',
        paths: [
          { type: 'file', rel: 'data/history.json' },
          { type: 'file', rel: 'data/chat-history.json' },
          { type: 'file', rel: 'data/price-history.json' },
          { type: 'file', rel: 'data/gateway-usage.json' },
          { type: 'file', rel: 'data/update-history.json' },
          { type: 'file', rel: 'data/tool-log.json' },
          { type: 'file', rel: 'data/skill-registry.json' },
          { type: 'file', rel: 'data/skills-state.json' },
          { type: 'file', rel: 'data/miner-pnl.json' },
          { type: 'file', rel: 'data/gpu-mining.json' },
          { type: 'file', rel: 'data/marketplace.json' }
        ]
      }
    };

    this._ensureDir(this.backupDir);
  }

  // ─── Lifecycle ───────────────────────────────────────────

  start() {
    if (this._running) return;
    this._running = true;
    this._log('Backup system started');

    // Daily backup at 3AM CT
    this._scheduleDailyBackup();

    // Prune on start
    this._pruneRetention();
  }

  stop() {
    this._running = false;
    for (const t of this._timers) clearTimeout(t);
    this._timers = [];
    this._log('Backup system stopped');
  }

  // ─── Core: Create Backup ────────────────────────────────

  /**
   * Create a full or partial backup.
   * @param {Object} [opts]
   * @param {string} [opts.label] - Human-readable label
   * @param {string[]} [opts.components] - Subset: config, workers, data, schedules, analytics. Default: all
   * @param {string} [opts.trigger] - What triggered this: manual, daily, pre-update, api
   * @returns {Object} Backup metadata
   */
  async createBackup(opts = {}) {
    const startTime = Date.now();
    const id = this._generateId();
    const timestamp = new Date().toISOString();
    const components = opts.components || Object.keys(this._components);
    const label = opts.label || null;
    const trigger = opts.trigger || 'manual';

    this._log(`Creating backup ${id} [${trigger}] components=[${components.join(',')}]`);

    const manifest = {
      version: BACKUP_VERSION,
      id,
      timestamp,
      label,
      trigger,
      components,
      files: {},
      workerStates: null,
      stats: { fileCount: 0, totalSize: 0, compressedSize: 0 },
      integrity: null
    };

    // Collect files for each requested component
    for (const comp of components) {
      const def = this._components[comp];
      if (!def) continue;

      for (const p of def.paths) {
        if (p.type === 'file') {
          this._collectFile(manifest, p.rel);
        } else if (p.type === 'dir') {
          this._collectDir(manifest, p.rel, p.extensions, p.recursive !== false, p.maxAge);
        }
      }

      // Pull live worker states via relay
      if (comp === 'workers' && def.dynamic) {
        manifest.workerStates = await this._collectWorkerStates();
      }
    }

    // Compute integrity hash over all file contents
    const hash = crypto.createHash('sha256');
    const sortedKeys = Object.keys(manifest.files).sort();
    for (const k of sortedKeys) {
      hash.update(k);
      hash.update(manifest.files[k].data);
    }
    if (manifest.workerStates) {
      hash.update(JSON.stringify(manifest.workerStates));
    }
    manifest.integrity = hash.digest('hex');
    manifest.stats.fileCount = sortedKeys.length;

    // Compress with gzip
    const jsonStr = JSON.stringify(manifest);
    manifest.stats.totalSize = Buffer.byteLength(jsonStr);

    const compressed = zlib.gzipSync(Buffer.from(jsonStr), { level: 6 });
    manifest.stats.compressedSize = compressed.length;

    // Write backup file
    const filename = `aries-${id}${BACKUP_EXT}`;
    const filePath = path.join(this.backupDir, filename);
    fs.writeFileSync(filePath, compressed);

    const elapsed = Date.now() - startTime;
    const meta = {
      id,
      filename,
      path: filePath,
      timestamp,
      label,
      trigger,
      components,
      fileCount: manifest.stats.fileCount,
      totalSize: manifest.stats.totalSize,
      compressedSize: compressed.length,
      integrity: manifest.integrity,
      elapsed
    };

    // Write sidecar metadata (small JSON for fast listing)
    const metaPath = path.join(this.backupDir, `aries-${id}.meta.json`);
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

    this.emit('backup-created', meta);
    this._log(`Backup ${id} created: ${manifest.stats.fileCount} files, ${this._fmtSize(compressed.length)} compressed in ${elapsed}ms`);

    // Check total size
    this._checkTotalSize();

    // Prune old backups
    this._pruneRetention();

    return meta;
  }

  // ─── Core: Restore ──────────────────────────────────────

  /**
   * Restore from a backup.
   * @param {string} id - Backup ID
   * @param {Object} [opts]
   * @param {string[]} [opts.components] - Which components to restore. Default: all from backup
   * @param {boolean} [opts.dryRun] - If true, list what would be restored without writing
   * @returns {Object} Restore result
   */
  async restore(id, opts = {}) {
    const backup = this._loadBackup(id);
    if (backup.error) return backup;

    const manifest = backup.manifest;
    const requestedComps = opts.components || manifest.components;
    const dryRun = opts.dryRun || false;

    // Verify integrity
    const hash = crypto.createHash('sha256');
    const sortedKeys = Object.keys(manifest.files).sort();
    for (const k of sortedKeys) {
      hash.update(k);
      hash.update(manifest.files[k].data);
    }
    if (manifest.workerStates) {
      hash.update(JSON.stringify(manifest.workerStates));
    }
    const computed = hash.digest('hex');
    if (computed !== manifest.integrity) {
      return { error: 'Integrity check failed — backup may be corrupted', expected: manifest.integrity, got: computed };
    }

    // Determine which files to restore based on component mapping
    const filesToRestore = [];
    for (const [relPath, entry] of Object.entries(manifest.files)) {
      const comp = this._fileToComponent(relPath);
      if (requestedComps.includes('all') || requestedComps.includes(comp)) {
        filesToRestore.push({ relPath, entry, component: comp });
      }
    }

    if (dryRun) {
      return {
        dryRun: true,
        id: manifest.id,
        timestamp: manifest.timestamp,
        fileCount: filesToRestore.length,
        files: filesToRestore.map(f => ({ path: f.relPath, size: f.entry.size, component: f.component }))
      };
    }

    // Create a pre-restore backup
    try {
      await this.createBackup({ label: `pre-restore-${id}`, trigger: 'pre-restore' });
    } catch (e) {
      this._log(`Warning: pre-restore backup failed: ${e.message}`);
    }

    let restored = 0;
    const errors = [];

    for (const { relPath, entry } of filesToRestore) {
      try {
        const targetPath = path.join(this.baseDir, relPath);
        this._ensureDir(path.dirname(targetPath));

        const buf = entry.encoding === 'base64'
          ? Buffer.from(entry.data, 'base64')
          : Buffer.from(entry.data, 'utf8');

        fs.writeFileSync(targetPath, buf);
        restored++;
      } catch (e) {
        errors.push({ file: relPath, error: e.message });
      }
    }

    // Restore worker states if requested
    if ((requestedComps.includes('all') || requestedComps.includes('workers')) && manifest.workerStates) {
      await this._restoreWorkerStates(manifest.workerStates);
    }

    const result = {
      restored: true,
      id: manifest.id,
      timestamp: manifest.timestamp,
      filesRestored: restored,
      errors: errors.length > 0 ? errors : undefined
    };

    this.emit('backup-restored', result);
    this._log(`Restored backup ${id}: ${restored} files` + (errors.length ? `, ${errors.length} errors` : ''));
    return result;
  }

  // ─── List Backups ───────────────────────────────────────

  listBackups() {
    try {
      if (!fs.existsSync(this.backupDir)) return [];

      const files = fs.readdirSync(this.backupDir);
      const backups = [];

      for (const f of files) {
        if (!f.endsWith('.meta.json')) continue;
        try {
          const meta = JSON.parse(fs.readFileSync(path.join(this.backupDir, f), 'utf8'));
          // Verify the actual backup file still exists
          const backupFile = path.join(this.backupDir, meta.filename);
          if (fs.existsSync(backupFile)) {
            const stat = fs.statSync(backupFile);
            meta.compressedSize = stat.size;
            backups.push(meta);
          }
        } catch (e) { /* skip corrupt meta */ }
      }

      backups.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      return backups;
    } catch (e) {
      return [];
    }
  }

  // ─── Delete Backup ──────────────────────────────────────

  deleteBackup(id) {
    const backupFile = path.join(this.backupDir, `aries-${id}${BACKUP_EXT}`);
    const metaFile = path.join(this.backupDir, `aries-${id}.meta.json`);

    if (!fs.existsSync(backupFile)) {
      return { error: 'Backup not found', id };
    }

    try {
      fs.unlinkSync(backupFile);
      if (fs.existsSync(metaFile)) fs.unlinkSync(metaFile);
      this._log(`Deleted backup ${id}`);
      return { deleted: true, id };
    } catch (e) {
      return { error: e.message, id };
    }
  }

  // ─── Diff Two Backups ───────────────────────────────────

  diff(id1, id2) {
    const b1 = this._loadBackup(id1);
    const b2 = this._loadBackup(id2);
    if (b1.error) return { error: `Backup ${id1}: ${b1.error}` };
    if (b2.error) return { error: `Backup ${id2}: ${b2.error}` };

    const m1 = b1.manifest;
    const m2 = b2.manifest;
    const files1 = new Set(Object.keys(m1.files));
    const files2 = new Set(Object.keys(m2.files));

    const added = [];
    const removed = [];
    const modified = [];
    const unchanged = [];

    for (const f of files2) {
      if (!files1.has(f)) {
        added.push({ path: f, size: m2.files[f].size });
      }
    }

    for (const f of files1) {
      if (!files2.has(f)) {
        removed.push({ path: f, size: m1.files[f].size });
      } else {
        const h1 = crypto.createHash('md5').update(m1.files[f].data).digest('hex');
        const h2 = crypto.createHash('md5').update(m2.files[f].data).digest('hex');
        if (h1 !== h2) {
          modified.push({
            path: f,
            sizeBefore: m1.files[f].size,
            sizeAfter: m2.files[f].size,
            sizeDelta: m2.files[f].size - m1.files[f].size
          });
        } else {
          unchanged.push(f);
        }
      }
    }

    return {
      backup1: { id: m1.id, timestamp: m1.timestamp, label: m1.label },
      backup2: { id: m2.id, timestamp: m2.timestamp, label: m2.label },
      summary: {
        added: added.length,
        removed: removed.length,
        modified: modified.length,
        unchanged: unchanged.length
      },
      added,
      removed,
      modified,
      unchanged: unchanged.length <= 50 ? unchanged : `${unchanged.length} files unchanged`
    };
  }

  // ─── Download (return raw buffer) ──────────────────────

  getBackupBuffer(id) {
    const filePath = path.join(this.backupDir, `aries-${id}${BACKUP_EXT}`);
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath);
  }

  // ─── Pre-Update Hook ───────────────────────────────────

  async createPreUpdateBackup() {
    return this.createBackup({ label: 'pre-update', trigger: 'pre-update' });
  }

  // ─── API Route Registration ─────────────────────────────

  /**
   * Register backup API endpoints on an Express-like router/app.
   * @param {Object} app - Express app or router with get/post/delete
   * @param {Function} [authMiddleware] - Optional auth middleware
   */
  registerRoutes(app, authMiddleware) {
    const mw = authMiddleware || ((req, res, next) => next());

    // Create backup
    app.post('/api/manage/backup/create', mw, async (req, res) => {
      try {
        const { label, components } = req.body || {};
        const result = await this.createBackup({ label, components, trigger: 'api' });
        res.json({ ok: true, backup: result });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
      }
    });

    // List backups
    app.get('/api/manage/backup/list', mw, (req, res) => {
      try {
        const backups = this.listBackups();
        const totalSize = backups.reduce((s, b) => s + (b.compressedSize || 0), 0);
        res.json({
          ok: true,
          backups,
          totalSize,
          totalSizeFormatted: this._fmtSize(totalSize),
          warning: totalSize > MAX_TOTAL_WARN ? `Backups exceed ${this._fmtSize(MAX_TOTAL_WARN)}` : undefined
        });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
      }
    });

    // Restore backup
    app.post('/api/manage/backup/restore/:id', mw, async (req, res) => {
      try {
        const { components, dryRun } = req.body || {};
        const result = await this.restore(req.params.id, { components: components || ['all'], dryRun });
        res.json({ ok: !result.error, ...result });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
      }
    });

    // Diff two backups
    app.get('/api/manage/backup/diff/:id1/:id2', mw, (req, res) => {
      try {
        const result = this.diff(req.params.id1, req.params.id2);
        res.json({ ok: !result.error, ...result });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
      }
    });

    // Delete backup
    app.delete('/api/manage/backup/:id', mw, (req, res) => {
      try {
        const result = this.deleteBackup(req.params.id);
        res.json({ ok: !result.error, ...result });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
      }
    });

    // Download backup
    app.get('/api/manage/backup/download/:id', mw, (req, res) => {
      try {
        const buf = this.getBackupBuffer(req.params.id);
        if (!buf) return res.status(404).json({ ok: false, error: 'Backup not found' });
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="aries-${req.params.id}${BACKUP_EXT}"`);
        res.send(buf);
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
      }
    });

    this._log('Backup API routes registered');
  }

  // ─── Private: File Collection ───────────────────────────

  _collectFile(manifest, relPath) {
    try {
      const fullPath = path.join(this.baseDir, relPath);
      if (!fs.existsSync(fullPath)) return;
      const stat = fs.statSync(fullPath);
      if (!stat.isFile() || stat.size > MAX_FILE_SIZE) return;

      const buf = fs.readFileSync(fullPath);
      const isBinary = this._isBinary(buf, relPath);

      manifest.files[relPath] = {
        size: stat.size,
        modified: stat.mtime.toISOString(),
        encoding: isBinary ? 'base64' : 'utf8',
        data: isBinary ? buf.toString('base64') : buf.toString('utf8'),
        hash: crypto.createHash('md5').update(buf).digest('hex')
      };
      manifest.stats.fileCount++;
    } catch (e) { /* skip */ }
  }

  _collectDir(manifest, relDir, extensions, recursive, maxAge) {
    try {
      const fullDir = path.join(this.baseDir, relDir);
      if (!fs.existsSync(fullDir) || !fs.statSync(fullDir).isDirectory()) return;

      const entries = fs.readdirSync(fullDir, { withFileTypes: true });
      const now = Date.now();

      for (const entry of entries) {
        const relPath = relDir + '/' + entry.name;
        const fullPath = path.join(fullDir, entry.name);

        if (entry.isDirectory()) {
          // Skip backup dir itself
          if (fullPath === this.backupDir) continue;
          if (recursive) {
            this._collectDir(manifest, relPath, extensions, true, maxAge);
          }
          continue;
        }

        if (!entry.isFile()) continue;

        // Extension filter
        if (extensions && extensions.length > 0) {
          const ext = path.extname(entry.name).toLowerCase();
          if (!extensions.includes(ext)) continue;
        }

        // Age filter
        if (maxAge) {
          try {
            const stat = fs.statSync(fullPath);
            if (now - stat.mtimeMs > maxAge) continue;
          } catch (e) { continue; }
        }

        this._collectFile(manifest, relPath);
      }
    } catch (e) { /* skip */ }
  }

  // ─── Private: Worker State Collection ───────────────────

  async _collectWorkerStates() {
    const states = {};

    // Try relay system
    if (this.relay && typeof this.relay.getConnectedWorkers === 'function') {
      try {
        const workers = this.relay.getConnectedWorkers();
        for (const w of workers) {
          try {
            const state = typeof this.relay.getWorkerState === 'function'
              ? await this.relay.getWorkerState(w.id || w.name)
              : { id: w.id, name: w.name, status: w.status };
            states[w.id || w.name] = state;
          } catch (e) { /* skip worker */ }
        }
      } catch (e) { /* relay unavailable */ }
    }

    // Try swarm manager
    if (this.swarm && typeof this.swarm.getNodes === 'function') {
      try {
        const nodes = this.swarm.getNodes();
        for (const n of nodes) {
          if (!states[n.id]) {
            states[n.id] = { id: n.id, name: n.name, status: n.status, role: n.role };
          }
        }
      } catch (e) { /* swarm unavailable */ }
    }

    return Object.keys(states).length > 0 ? states : null;
  }

  async _restoreWorkerStates(workerStates) {
    // Worker states are informational — write them to data file
    // Actual worker re-registration happens via their own reconnection
    try {
      const outPath = path.join(this.baseDir, 'data', 'worker-states-restored.json');
      fs.writeFileSync(outPath, JSON.stringify(workerStates, null, 2));
      this._log(`Worker states written to ${outPath}`);
    } catch (e) {
      this._log(`Failed to write worker states: ${e.message}`);
    }
  }

  // ─── Private: Load & Decompress ────────────────────────

  _loadBackup(id) {
    const filePath = path.join(this.backupDir, `aries-${id}${BACKUP_EXT}`);
    if (!fs.existsSync(filePath)) {
      return { error: 'Backup not found' };
    }

    try {
      const compressed = fs.readFileSync(filePath);
      const json = zlib.gunzipSync(compressed).toString('utf8');
      const manifest = JSON.parse(json);
      return { manifest };
    } catch (e) {
      return { error: `Failed to load backup: ${e.message}` };
    }
  }

  // ─── Private: Scheduling ───────────────────────────────

  _scheduleDailyBackup() {
    const scheduleNext = () => {
      const now = new Date();
      // Target 3:00 AM CT (America/Chicago)
      // Calculate next 3AM CT
      const target = new Date(now);

      // Get current CT offset by formatting
      const ctStr = now.toLocaleString('en-US', { timeZone: 'America/Chicago', hour12: false });
      const ctParts = ctStr.split(', ');
      const timeParts = ctParts[1].split(':');
      const ctHour = parseInt(timeParts[0]);
      const ctMin = parseInt(timeParts[1]);

      // Calculate ms until next 3AM CT
      let hoursUntil = 3 - ctHour;
      if (hoursUntil <= 0 || (hoursUntil === 0 && ctMin > 0)) {
        hoursUntil += 24;
      }

      const msUntil = (hoursUntil * 3600000) - (ctMin * 60000);
      const delay = Math.max(msUntil, 60000); // minimum 1 min

      this._log(`Next daily backup in ${Math.round(delay / 3600000 * 10) / 10}h`);

      const timer = setTimeout(async () => {
        try {
          await this.createBackup({ label: 'daily-auto', trigger: 'daily' });
        } catch (e) {
          this._log(`Daily backup failed: ${e.message}`);
        }
        // Schedule next
        if (this._running) scheduleNext();
      }, delay);

      this._timers.push(timer);
    };

    scheduleNext();
  }

  // ─── Private: Retention / Pruning ──────────────────────

  _pruneRetention() {
    try {
      const backups = this.listBackups();
      if (backups.length === 0) return;

      // Categorize backups by day
      const byDate = {};
      for (const b of backups) {
        const day = b.timestamp.slice(0, 10);
        if (!byDate[day]) byDate[day] = [];
        byDate[day].push(b);
      }

      const days = Object.keys(byDate).sort().reverse();
      const keep = new Set();

      // Keep last 7 daily (newest per day)
      let dailyKept = 0;
      for (const day of days) {
        if (dailyKept >= this.retention.daily) break;
        keep.add(byDate[day][0].id);
        dailyKept++;
      }

      // Keep 4 weekly (one per week going back)
      const weeksSeen = new Set();
      for (const day of days) {
        const d = new Date(day);
        const weekKey = this._isoWeek(d);
        if (!weeksSeen.has(weekKey)) {
          weeksSeen.add(weekKey);
          keep.add(byDate[day][0].id);
          if (weeksSeen.size >= this.retention.weekly + this.retention.daily) break;
        }
      }

      // Keep 3 monthly (one per month going back)
      const monthsSeen = new Set();
      for (const day of days) {
        const monthKey = day.slice(0, 7);
        if (!monthsSeen.has(monthKey)) {
          monthsSeen.add(monthKey);
          keep.add(byDate[day][0].id);
          if (monthsSeen.size >= this.retention.monthly + 2) break;
        }
      }

      // Always keep pre-restore and pre-update backups from last 48h
      const cutoff48h = Date.now() - 48 * 3600000;
      for (const b of backups) {
        if (new Date(b.timestamp).getTime() > cutoff48h &&
            (b.trigger === 'pre-restore' || b.trigger === 'pre-update')) {
          keep.add(b.id);
        }
      }

      // Delete non-kept backups
      let deleted = 0;
      for (const b of backups) {
        if (!keep.has(b.id)) {
          this.deleteBackup(b.id);
          deleted++;
        }
      }

      if (deleted > 0) {
        this._log(`Pruned ${deleted} old backups`);
      }
    } catch (e) {
      this._log(`Prune error: ${e.message}`);
    }
  }

  // ─── Private: Size Check ───────────────────────────────

  _checkTotalSize() {
    try {
      const backups = this.listBackups();
      const total = backups.reduce((s, b) => s + (b.compressedSize || 0), 0);
      if (total > MAX_TOTAL_WARN) {
        const msg = `⚠️ Backup storage at ${this._fmtSize(total)} (threshold: ${this._fmtSize(MAX_TOTAL_WARN)})`;
        this._log(msg);
        this.emit('size-warning', { total, threshold: MAX_TOTAL_WARN, formatted: this._fmtSize(total) });
      }
    } catch (e) { /* ignore */ }
  }

  // ─── Private: Component Mapping ────────────────────────

  _fileToComponent(relPath) {
    if (relPath === 'config.json' || relPath.startsWith('config/')) return 'config';
    if (relPath.includes('worker') || relPath.includes('swarm')) return 'workers';
    if (relPath.includes('scheduler')) return 'schedules';
    if (relPath.includes('history') || relPath.includes('analytics') ||
        relPath.includes('earnings') || relPath.includes('mining') ||
        relPath.includes('pnl') || relPath.includes('gateway-usage')) return 'analytics';
    return 'data';
  }

  // ─── Private: Helpers ──────────────────────────────────

  _generateId() {
    const now = new Date();
    const ts = now.getFullYear().toString() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0') + '-' +
      String(now.getHours()).padStart(2, '0') +
      String(now.getMinutes()).padStart(2, '0') +
      String(now.getSeconds()).padStart(2, '0');
    const rand = crypto.randomBytes(3).toString('hex');
    return `${ts}-${rand}`;
  }

  _isoWeek(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
    const week1 = new Date(d.getFullYear(), 0, 4);
    const weekNum = 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
    return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
  }

  _isBinary(buf, relPath) {
    const textExts = ['.json', '.js', '.md', '.txt', '.log', '.csv', '.html', '.xml', '.yaml', '.yml', '.ini', '.cfg', '.env', '.bak'];
    const ext = path.extname(relPath).toLowerCase();
    if (textExts.includes(ext)) return false;
    // Check first 512 bytes for null bytes
    const check = Math.min(buf.length, 512);
    for (let i = 0; i < check; i++) {
      if (buf[i] === 0) return true;
    }
    return false;
  }

  _fmtSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
    return (bytes / 1073741824).toFixed(2) + ' GB';
  }

  _ensureDir(dir) {
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    } catch (e) { /* ignore */ }
  }

  _log(msg) {
    try {
      if (this.logger && typeof this.logger.log === 'function') {
        this.logger.log(`[BACKUP] ${msg}`);
      } else {
        console.log(`[BACKUP] ${msg}`);
      }
    } catch (e) { /* ignore */ }
  }
}

module.exports = { BackupSystem };
