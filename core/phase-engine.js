'use strict';

/**
 * ARIES — Phase Engine (VibeSDK-inspired)
 * 
 * 5-phase AI code generation pipeline:
 *   Phase 1: Plan — AI analyzes request, outputs plan
 *   Phase 2: Scaffold — Generate project skeleton
 *   Phase 3: Implement — Generate code file by file
 *   Phase 4: Fix — Run code, auto-fix errors (max 3 retries)
 *   Phase 5: Serve — Start app on a port, return URL
 *
 * No npm dependencies — Node.js built-ins only.
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execSync } = require('child_process');

const PROJECTS_DIR = path.join(__dirname, '..', 'data', 'projects');

const PHASES = ['plan', 'scaffold', 'implement', 'fix', 'serve'];

class PhaseEngine extends EventEmitter {
  constructor(ai, opts = {}) {
    super();
    this.ai = ai;
    this.maxFixRetries = opts.maxFixRetries || 3;
    this.projects = new Map(); // id -> project state
    this._ensureDir(PROJECTS_DIR);
    this._loadProjects();
  }

  _ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  _loadProjects() {
    try {
      const dirs = fs.readdirSync(PROJECTS_DIR);
      for (const d of dirs) {
        const stateFile = path.join(PROJECTS_DIR, d, 'state.json');
        if (fs.existsSync(stateFile)) {
          try {
            const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
            this.projects.set(d, state);
          } catch {}
        }
      }
    } catch {}
  }

  _saveState(id) {
    const state = this.projects.get(id);
    if (!state) return;
    const dir = path.join(PROJECTS_DIR, id);
    this._ensureDir(dir);
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state, null, 2));
  }

  _log(id, msg) {
    const state = this.projects.get(id);
    if (!state) return;
    const entry = `[${new Date().toISOString()}] ${msg}`;
    state.logs.push(entry);
    this.emit('log', { projectId: id, message: msg, phase: state.currentPhase });
  }

  getProject(id) { return this.projects.get(id) || null; }
  listProjects() { return Array.from(this.projects.values()); }

  /**
   * Run the full 5-phase pipeline
   * @param {string} prompt — user's natural language description
   * @param {object} opts — { port }
   * @returns {Promise<object>} — final project state
   */
  async run(prompt, opts = {}) {
    const id = crypto.randomUUID().split('-')[0];
    const projectDir = path.join(PROJECTS_DIR, id);
    this._ensureDir(projectDir);

    const state = {
      id,
      prompt,
      projectDir,
      currentPhase: null,
      status: 'starting',
      plan: null,
      files: [],
      port: opts.port || null,
      url: null,
      pid: null,
      logs: [],
      errors: [],
      fixAttempts: 0,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };
    this.projects.set(id, state);
    this._saveState(id);

    try {
      for (const phase of PHASES) {
        state.currentPhase = phase;
        state.status = phase;
        this.emit('phase', { projectId: id, phase });
        this._log(id, `Starting phase: ${phase}`);
        this._saveState(id);

        await this['_phase_' + phase](id);

        this._log(id, `Completed phase: ${phase}`);
        this._saveState(id);
      }
      state.status = 'running';
      state.completedAt = new Date().toISOString();
    } catch (err) {
      state.status = 'failed';
      state.errors.push(err.message);
      this._log(id, `FAILED: ${err.message}`);
      this.emit('error', { projectId: id, error: err.message });
    }

    this._saveState(id);
    return state;
  }

  // ── Phase 1: Plan ──
  async _phase_plan(id) {
    const state = this.projects.get(id);
    const response = await this.ai.chat([
      { role: 'system', content: `You are a senior software architect. Given a user request, output a JSON plan with these fields:
- "name": project name (short, kebab-case)
- "description": one-line description
- "techStack": array of technologies (e.g. ["react","tailwind"])
- "files": array of file paths to create (relative to project root)
- "hasServer": boolean — does this need a Node.js server?
- "hasBuildStep": boolean — does this need npm build?
- "entryPoint": the main file to run/serve (e.g. "server.js" or "index.html")
- "dependencies": object of npm dependencies (name: version) or empty {}
- "steps": array of implementation step descriptions

RESPOND WITH ONLY VALID JSON. No markdown, no explanation.` },
      { role: 'user', content: state.prompt }
    ]);

    let plan;
    try {
      // Extract JSON from response (handle markdown code blocks)
      let jsonStr = typeof response === 'string' ? response : (response.content || response.message || JSON.stringify(response));
      const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) jsonStr = match[1];
      plan = JSON.parse(jsonStr.trim());
    } catch (e) {
      throw new Error('AI returned invalid plan JSON: ' + e.message);
    }

    state.plan = plan;
    this._log(id, `Plan: ${plan.name} — ${plan.files.length} files, stack: ${(plan.techStack || []).join(', ')}`);
  }

  // ── Phase 2: Scaffold ──
  async _phase_scaffold(id) {
    const state = this.projects.get(id);
    const plan = state.plan;
    const dir = state.projectDir;

    // Create directories for all planned files
    for (const f of plan.files) {
      const fullPath = path.join(dir, f);
      this._ensureDir(path.dirname(fullPath));
    }

    // Create package.json if there are dependencies
    if (plan.dependencies && Object.keys(plan.dependencies).length > 0) {
      const pkg = {
        name: plan.name || 'aries-project',
        version: '1.0.0',
        private: true,
        dependencies: plan.dependencies,
        scripts: {}
      };
      if (plan.hasBuildStep) {
        pkg.scripts.build = 'npx react-scripts build || npx vite build || echo "no build configured"';
        pkg.scripts.start = 'npx react-scripts start || npx vite || node server.js';
      } else if (plan.hasServer) {
        pkg.scripts.start = `node ${plan.entryPoint || 'server.js'}`;
      }
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2));
      state.files.push('package.json');
      this._log(id, `Created package.json with ${Object.keys(plan.dependencies).length} deps`);
    }

    this._log(id, `Scaffold complete — ${plan.files.length} files planned`);
  }

  // ── Phase 3: Implement ──
  async _phase_implement(id) {
    const state = this.projects.get(id);
    const plan = state.plan;

    for (const filePath of plan.files) {
      this._log(id, `Generating: ${filePath}`);
      const response = await this.ai.chat([
        { role: 'system', content: `You are an expert coder. Generate the complete contents of the file "${filePath}" for this project.

Project: ${plan.name} — ${plan.description}
Tech stack: ${(plan.techStack || []).join(', ')}
All files in project: ${plan.files.join(', ')}
Entry point: ${plan.entryPoint}
Has server: ${plan.hasServer}

Output ONLY the file contents. No markdown code fences, no explanation. Just raw code.` },
        { role: 'user', content: `Generate the complete code for "${filePath}". The project is: ${state.prompt}` }
      ]);

      let content = typeof response === 'string' ? response : (response.content || response.message || '');
      // Strip markdown code fences if present
      const fenceMatch = content.match(/^```[\w]*\n([\s\S]*?)\n```$/);
      if (fenceMatch) content = fenceMatch[1];

      const fullPath = path.join(state.projectDir, filePath);
      this._ensureDir(path.dirname(fullPath));
      fs.writeFileSync(fullPath, content, 'utf8');
      state.files.push(filePath);
    }

    // Install npm deps if needed
    if (fs.existsSync(path.join(state.projectDir, 'package.json'))) {
      this._log(id, 'Installing npm dependencies...');
      try {
        execSync('npm install --production 2>&1', {
          cwd: state.projectDir,
          timeout: 120000,
          encoding: 'utf8',
          maxBuffer: 1024 * 1024,
        });
        this._log(id, 'npm install complete');
      } catch (e) {
        this._log(id, `npm install warning: ${e.message.substring(0, 500)}`);
      }
    }
  }

  // ── Phase 4: Fix ──
  async _phase_fix(id) {
    const state = this.projects.get(id);
    const plan = state.plan;

    if (!plan.hasServer && !plan.hasBuildStep) {
      this._log(id, 'Static project — skipping fix phase');
      return;
    }

    for (let attempt = 0; attempt < this.maxFixRetries; attempt++) {
      state.fixAttempts = attempt + 1;
      this._log(id, `Fix attempt ${attempt + 1}/${this.maxFixRetries}`);

      const error = await this._tryRun(id);
      if (!error) {
        this._log(id, 'No errors detected');
        return;
      }

      this._log(id, `Error: ${error.substring(0, 300)}`);
      state.errors.push(error);

      // Ask AI to fix
      const response = await this.ai.chat([
        { role: 'system', content: `You are a debugging expert. The project "${plan.name}" has an error. Fix it.
Respond with JSON: { "file": "path/to/file", "content": "...full fixed file content..." }
If multiple files need fixing, respond with an array of such objects.
Output ONLY valid JSON. No explanation.` },
        { role: 'user', content: `Error:\n${error}\n\nProject files: ${state.files.join(', ')}\nEntry point: ${plan.entryPoint}` }
      ]);

      try {
        let jsonStr = typeof response === 'string' ? response : (response.content || response.message || '');
        const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (match) jsonStr = match[1];
        let fixes = JSON.parse(jsonStr.trim());
        if (!Array.isArray(fixes)) fixes = [fixes];

        for (const fix of fixes) {
          if (fix.file && fix.content) {
            const fullPath = path.join(state.projectDir, fix.file);
            this._ensureDir(path.dirname(fullPath));
            fs.writeFileSync(fullPath, fix.content, 'utf8');
            this._log(id, `Fixed: ${fix.file}`);
          }
        }
      } catch (e) {
        this._log(id, `Could not parse fix response: ${e.message}`);
      }
    }
  }

  /**
   * Try running the project, return error string or null if OK
   */
  async _tryRun(id) {
    const state = this.projects.get(id);
    const plan = state.plan;
    const entry = plan.entryPoint || 'server.js';

    return new Promise((resolve) => {
      const child = spawn('node', [entry], {
        cwd: state.projectDir,
        timeout: 10000,
        env: { ...process.env, PORT: String(state.port || 4000) },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stderr = '';
      let stdout = '';
      child.stdout.on('data', d => { stdout += d.toString(); });
      child.stderr.on('data', d => { stderr += d.toString(); });

      const timer = setTimeout(() => {
        child.kill();
        // If no errors after 5s, it's probably running OK
        resolve(stderr && !stdout ? stderr.substring(0, 2000) : null);
      }, 5000);

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0 && code !== null) {
          resolve((stderr || stdout || 'Process exited with code ' + code).substring(0, 2000));
        } else {
          resolve(null);
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve(err.message);
      });
    });
  }

  // ── Phase 5: Serve ──
  async _phase_serve(id) {
    const state = this.projects.get(id);
    const plan = state.plan;

    if (!plan.hasServer) {
      // Static files — serve with a simple HTTP server
      const port = state.port;
      if (!port) {
        this._log(id, 'No port assigned — skipping serve');
        return;
      }

      // Create a minimal static server file
      const serverCode = `
const http = require('http');
const fs = require('fs');
const path = require('path');
const PORT = process.env.PORT || ${port};
const MIME = { '.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon' };
http.createServer((req, res) => {
  let fp = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
  if (!fs.existsSync(fp)) { res.writeHead(404); res.end('Not found'); return; }
  if (fs.statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  const ext = path.extname(fp);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain', 'Access-Control-Allow-Origin': '*' });
  fs.createReadStream(fp).pipe(res);
}).listen(PORT, () => console.log('Serving on http://localhost:' + PORT));
`;
      fs.writeFileSync(path.join(state.projectDir, '_aries_server.js'), serverCode);
      state.plan.entryPoint = '_aries_server.js';
    }

    const port = state.port;
    if (!port) return;

    const entry = state.plan.entryPoint || 'server.js';
    const child = spawn('node', [entry], {
      cwd: state.projectDir,
      detached: true,
      env: { ...process.env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.unref();
    state.pid = child.pid;
    state.url = `http://localhost:${port}`;

    child.stdout.on('data', d => this._log(id, `[stdout] ${d.toString().trim()}`));
    child.stderr.on('data', d => this._log(id, `[stderr] ${d.toString().trim()}`));
    child.on('close', code => {
      this._log(id, `Process exited with code ${code}`);
      if (state.status === 'running') state.status = 'stopped';
      this._saveState(id);
    });

    this._log(id, `Serving at ${state.url} (PID: ${child.pid})`);

    // Wait a moment for server to start
    await new Promise(r => setTimeout(r, 2000));
  }

  /**
   * Stop a running project
   */
  stop(id) {
    const state = this.projects.get(id);
    if (!state || !state.pid) return false;
    try {
      process.kill(state.pid, 'SIGTERM');
      setTimeout(() => {
        try { process.kill(state.pid, 'SIGKILL'); } catch {}
      }, 3000);
    } catch {}
    state.status = 'stopped';
    state.pid = null;
    this._saveState(id);
    return true;
  }
}

module.exports = { PhaseEngine };
