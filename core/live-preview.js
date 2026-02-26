'use strict';

/**
 * ARIES — Live Preview Server
 * Manages multiple running app previews with hot reload, process monitoring, and cleanup.
 * No npm dependencies — Node.js built-ins only.
 */

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

const MIME_TYPES = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.map': 'application/json',
};

class LivePreview extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.previews = new Map(); // port -> { projectDir, process, server, watcher, restarts, maxRestarts }
    this.maxRestarts = opts.maxRestarts || 5;
    this._cleanupBound = this._cleanup.bind(this);
    process.on('exit', this._cleanupBound);
    process.on('SIGINT', this._cleanupBound);
    process.on('SIGTERM', this._cleanupBound);
  }

  /**
   * Start a preview for a project directory on a given port
   * @param {string} projectDir — absolute path to project
   * @param {number} port
   * @param {object} opts — { entryPoint, isStatic }
   */
  async start(projectDir, port, opts = {}) {
    if (this.previews.has(port)) {
      await this.stop(port);
    }

    const entry = {
      projectDir,
      port,
      process: null,
      server: null,
      watcher: null,
      restarts: 0,
      maxRestarts: this.maxRestarts,
      startedAt: Date.now(),
      status: 'starting',
    };

    const pkgPath = path.join(projectDir, 'package.json');
    const hasServer = opts.entryPoint || (fs.existsSync(path.join(projectDir, 'server.js')));
    const isStatic = opts.isStatic || (!hasServer && fs.existsSync(path.join(projectDir, 'index.html')));

    if (isStatic || !hasServer) {
      // Serve static files
      const server = http.createServer((req, res) => {
        let filePath = path.join(projectDir, req.url === '/' ? 'index.html' : decodeURIComponent(req.url));
        if (!filePath.startsWith(projectDir)) { res.writeHead(403); res.end('Forbidden'); return; }
        if (!fs.existsSync(filePath)) { res.writeHead(404); res.end('Not found'); return; }
        if (fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, 'index.html');
        if (!fs.existsSync(filePath)) { res.writeHead(404); res.end('Not found'); return; }
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
        fs.createReadStream(filePath).pipe(res);
      });

      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, () => resolve());
      });
      entry.server = server;
      entry.status = 'running';
    } else {
      // Run as Node.js process
      const entryPoint = opts.entryPoint || 'server.js';
      this._spawnProcess(entry, entryPoint);
    }

    // Set up file watcher for hot reload
    try {
      entry.watcher = fs.watch(projectDir, { recursive: true }, (eventType, filename) => {
        if (!filename || filename.startsWith('node_modules') || filename.startsWith('.')) return;
        this.emit('fileChange', { port, file: filename });
        // Debounce restart
        if (entry._restartTimer) clearTimeout(entry._restartTimer);
        entry._restartTimer = setTimeout(() => this.restart(port), 500);
      });
    } catch {}

    this.previews.set(port, entry);
    this.emit('started', { port, projectDir });
    return { port, status: entry.status, url: `http://localhost:${port}` };
  }

  _spawnProcess(entry, entryPoint) {
    const child = spawn('node', [entryPoint], {
      cwd: entry.projectDir,
      env: { ...process.env, PORT: String(entry.port) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    entry.process = child;
    entry.status = 'running';

    child.stdout.on('data', d => this.emit('stdout', { port: entry.port, data: d.toString() }));
    child.stderr.on('data', d => this.emit('stderr', { port: entry.port, data: d.toString() }));

    child.on('close', (code) => {
      if (entry.status === 'stopping') return;
      entry.status = 'crashed';
      this.emit('crashed', { port: entry.port, code });
      // Auto-restart
      if (entry.restarts < entry.maxRestarts) {
        entry.restarts++;
        this.emit('restarting', { port: entry.port, attempt: entry.restarts });
        setTimeout(() => this._spawnProcess(entry, entryPoint), 1000);
      } else {
        entry.status = 'failed';
        this.emit('failed', { port: entry.port, reason: 'Max restarts exceeded' });
      }
    });

    child.on('error', (err) => {
      entry.status = 'error';
      this.emit('error', { port: entry.port, error: err.message });
    });
  }

  /**
   * Stop a preview on a given port
   */
  async stop(port) {
    const entry = this.previews.get(port);
    if (!entry) return false;

    entry.status = 'stopping';

    if (entry.watcher) { try { entry.watcher.close(); } catch {} }
    if (entry._restartTimer) clearTimeout(entry._restartTimer);

    if (entry.server) {
      await new Promise(r => entry.server.close(r));
    }

    if (entry.process) {
      try { entry.process.kill('SIGTERM'); } catch {}
      await new Promise(r => {
        const t = setTimeout(() => {
          try { entry.process.kill('SIGKILL'); } catch {}
          r();
        }, 3000);
        entry.process.once('close', () => { clearTimeout(t); r(); });
      });
    }

    this.previews.delete(port);
    this.emit('stopped', { port });
    return true;
  }

  /**
   * List all active previews
   */
  list() {
    const result = [];
    for (const [port, entry] of this.previews) {
      result.push({
        port,
        projectDir: entry.projectDir,
        status: entry.status,
        restarts: entry.restarts,
        startedAt: entry.startedAt,
        url: `http://localhost:${port}`,
      });
    }
    return result;
  }

  /**
   * Restart a preview
   */
  async restart(port) {
    const entry = this.previews.get(port);
    if (!entry) return false;
    const dir = entry.projectDir;
    const opts = {};
    if (entry.server) opts.isStatic = true;
    await this.stop(port);
    await this.start(dir, port, opts);
    return true;
  }

  /**
   * Cleanup all previews
   */
  _cleanup() {
    for (const port of this.previews.keys()) {
      try { this.stop(port); } catch {}
    }
  }
}

module.exports = { LivePreview };
