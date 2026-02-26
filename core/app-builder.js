'use strict';

/**
 * ARIES — App Builder
 * High-level wrapper around PhaseEngine for building apps from natural language.
 * No npm dependencies — Node.js built-ins only.
 */

const { PhaseEngine } = require('./phase-engine');
const net = require('net');

const PORT_MIN = 4000;
const PORT_MAX = 4999;
const usedPorts = new Set();

class AppBuilder {
  constructor(ai, opts = {}) {
    this.ai = ai;
    this.engine = new PhaseEngine(ai, opts);

    // Forward events
    this.engine.on('phase', e => this.engine.emit('phase', e));
    this.engine.on('log', e => this.engine.emit('log', e));
    this.engine.on('error', e => this.engine.emit('error', e));
  }

  /**
   * Find a free port in the 4000-4999 range
   */
  async _findFreePort() {
    for (let port = PORT_MIN; port <= PORT_MAX; port++) {
      if (usedPorts.has(port)) continue;
      const free = await new Promise((resolve) => {
        const srv = net.createServer();
        srv.once('error', () => resolve(false));
        srv.once('listening', () => { srv.close(); resolve(true); });
        srv.listen(port, '127.0.0.1');
      });
      if (free) {
        usedPorts.add(port);
        return port;
      }
    }
    throw new Error('No free ports available in range 4000-4999');
  }

  /**
   * Build an app from a prompt
   * @param {string} prompt — natural language description
   * @returns {Promise<{url: string, projectDir: string, files: string[], projectId: string, port: number}>}
   */
  async build(prompt) {
    const port = await this._findFreePort();
    const result = await this.engine.run(prompt, { port });

    return {
      projectId: result.id,
      url: result.url || `http://localhost:${port}`,
      projectDir: result.projectDir,
      files: result.files || [],
      port,
      status: result.status,
      plan: result.plan,
    };
  }

  /**
   * Stop a running project and free its port
   */
  stop(projectId) {
    const project = this.engine.getProject(projectId);
    if (project && project.port) usedPorts.delete(project.port);
    return this.engine.stop(projectId);
  }

  /**
   * Get project status
   */
  getProject(id) { return this.engine.getProject(id); }
  listProjects() { return this.engine.listProjects(); }

  /**
   * Get the underlying phase engine (for event listeners)
   */
  getEngine() { return this.engine; }
}

module.exports = { AppBuilder };
