/**
 * ARIES v5.0 — Seamless Agent-to-Agent Handoffs
 * 
 * Enables agents to transfer conversations to other specialists mid-task.
 * Tracks handoff chains for debugging/transparency.
 * Maximum handoff depth to prevent loops.
 */

const EventEmitter = require('events');
const crypto = require('crypto');

class AgentHandoffs extends EventEmitter {
  /**
   * @param {object} opts
   * @param {object} [opts.config] - handoffs config section
   * @param {object} [opts.roster] - AgentRoster for agent lookups
   * @param {object} [opts.ai] - AI module with callWithFallback
   */
  constructor(opts = {}) {
    super();
    this.maxDepth = (opts.config && opts.config.maxDepth) || 5;
    this.roster = opts.roster || null;
    this.ai = opts.ai || null;
    this._chains = new Map(); // taskId -> chain array
    this._stats = { totalHandoffs: 0, successfulHandoffs: 0, failedHandoffs: 0, loopsPrevented: 0, byAgent: {} };
  }

  /**
   * Initiate a handoff from one agent to another
   * @param {string} fromAgent - Source agent ID
   * @param {string} toAgent - Target agent ID
   * @param {object} context - Handoff context
   * @param {string} context.taskId - Task identifier (creates new if not provided)
   * @param {string} context.summary - Context summary for receiving agent
   * @param {*} context.partialResults - Any partial results from source agent
   * @param {object} [context.metadata] - Additional metadata
   * @param {string} reason - Why the handoff is happening
   * @returns {object} handoff result
   */
  handoff(fromAgent, toAgent, context, reason) {
    try {
      const taskId = (context && context.taskId) || crypto.randomBytes(8).toString('hex');
      const handoffId = crypto.randomBytes(6).toString('hex');

      // Get or create chain
      if (!this._chains.has(taskId)) {
        this._chains.set(taskId, []);
      }
      const chain = this._chains.get(taskId);

      // Check depth limit
      if (chain.length >= this.maxDepth) {
        this._stats.loopsPrevented++;
        this.emit('loop-prevented', { taskId, fromAgent, toAgent, depth: chain.length });
        return {
          success: false,
          error: `Maximum handoff depth (${this.maxDepth}) reached. Possible loop detected.`,
          taskId,
          depth: chain.length,
        };
      }

      // Check for circular handoffs (same agent appearing twice in chain)
      const agentHistory = chain.map(h => h.toAgent);
      if (agentHistory.includes(toAgent)) {
        this._stats.loopsPrevented++;
        this.emit('loop-prevented', { taskId, fromAgent, toAgent, reason: 'circular' });
        return {
          success: false,
          error: `Circular handoff detected: ${toAgent} already handled this task.`,
          taskId,
          depth: chain.length,
        };
      }

      // Build handoff entry
      const entry = {
        id: handoffId,
        taskId,
        fromAgent,
        toAgent,
        reason,
        summary: context ? context.summary : '',
        partialResults: context ? context.partialResults : null,
        metadata: context ? context.metadata : null,
        depth: chain.length + 1,
        timestamp: new Date().toISOString(),
      };

      chain.push(entry);
      this._stats.totalHandoffs++;
      this._stats.successfulHandoffs++;

      // Track per-agent stats
      if (!this._stats.byAgent[fromAgent]) this._stats.byAgent[fromAgent] = { sentHandoffs: 0, receivedHandoffs: 0 };
      if (!this._stats.byAgent[toAgent]) this._stats.byAgent[toAgent] = { sentHandoffs: 0, receivedHandoffs: 0 };
      this._stats.byAgent[fromAgent].sentHandoffs++;
      this._stats.byAgent[toAgent].receivedHandoffs++;

      // Update roster statuses if available
      if (this.roster) {
        try {
          this.roster.setStatus(fromAgent, 'idle', null);
          this.roster.setStatus(toAgent, 'working', 'Handoff: ' + (reason || '').substring(0, 50));
          this.roster.postMessage(fromAgent, toAgent, 'Handing off: ' + (reason || '').substring(0, 100));
        } catch {}
      }

      this.emit('handoff', entry);

      return {
        success: true,
        handoffId,
        taskId,
        fromAgent,
        toAgent,
        depth: entry.depth,
        chain: chain.map(h => ({ from: h.fromAgent, to: h.toAgent, reason: h.reason })),
      };
    } catch (e) {
      this._stats.failedHandoffs++;
      this.emit('error', e);
      return { success: false, error: e.message };
    }
  }

  /**
   * Get the handoff chain for a task
   * @param {string} taskId
   * @returns {object} chain info
   */
  getChain(taskId) {
    const chain = this._chains.get(taskId);
    if (!chain) {
      return { taskId, found: false, chain: [], depth: 0 };
    }
    return {
      taskId,
      found: true,
      chain,
      depth: chain.length,
      agents: chain.map(h => h.toAgent),
      startedBy: chain.length > 0 ? chain[0].fromAgent : null,
      endedWith: chain.length > 0 ? chain[chain.length - 1].toAgent : null,
    };
  }

  /**
   * Get handoff statistics
   * @returns {object} stats
   */
  getStats() {
    return {
      ...this._stats,
      activeChains: this._chains.size,
      chains: [...this._chains.entries()].map(([taskId, chain]) => ({
        taskId,
        depth: chain.length,
        agents: chain.map(h => h.toAgent),
        lastHandoff: chain.length > 0 ? chain[chain.length - 1].timestamp : null,
      })),
    };
  }

  /**
   * Clear completed chains (older than given ms)
   * @param {number} [olderThanMs=3600000] - 1 hour default
   */
  clearOldChains(olderThanMs) {
    const cutoff = Date.now() - (olderThanMs || 3600000);
    for (const [taskId, chain] of this._chains) {
      if (chain.length > 0) {
        const lastTs = new Date(chain[chain.length - 1].timestamp).getTime();
        if (lastTs < cutoff) {
          this._chains.delete(taskId);
        }
      }
    }
  }
}

module.exports = { AgentHandoffs };
