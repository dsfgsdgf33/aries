'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class LearningBridge {
  constructor(dataDir) {
    this._dataDir = dataDir || path.join(__dirname, '..', 'data');
    this._recommendations = [];
    this._patterns = [];
    this._appliedIds = new Set();
  }

  _readJson(filename) {
    try {
      const filepath = path.join(this._dataDir, filename);
      if (!fs.existsSync(filepath)) return [];
      const raw = fs.readFileSync(filepath, 'utf8');
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch (e) {
      return [];
    }
  }

  analyze() {
    const toolLog = this._readJson('tool-log.json');
    const history = this._readJson('history.json');
    this._patterns = [];
    this._recommendations = [];

    // Analyze tool usage patterns
    if (toolLog.length > 0) {
      const toolUsage = {};
      const toolErrors = {};
      for (const entry of toolLog) {
        const tool = entry.tool || entry.name || 'unknown';
        toolUsage[tool] = (toolUsage[tool] || 0) + 1;
        if (entry.error || entry.success === false) {
          toolErrors[tool] = (toolErrors[tool] || 0) + 1;
        }
      }

      // Pattern: frequently failing tools
      for (const [tool, errCount] of Object.entries(toolErrors)) {
        const total = toolUsage[tool] || 1;
        const failRate = errCount / total;
        if (failRate > 0.3 && errCount >= 3) {
          const id = crypto.randomUUID();
          this._patterns.push({
            type: 'high_failure_rate',
            tool,
            failRate: (failRate * 100).toFixed(0) + '%',
            occurrences: errCount,
          });
          this._recommendations.push({
            id,
            type: 'reduce_tool_failures',
            priority: failRate > 0.5 ? 'high' : 'medium',
            description: `Tool "${tool}" has ${(failRate * 100).toFixed(0)}% failure rate (${errCount}/${total}). Consider adding validation or fallback.`,
            tool,
            applied: false,
          });
        }
      }

      // Pattern: underused tools
      const avgUsage = Object.values(toolUsage).reduce((a, b) => a + b, 0) / Math.max(Object.keys(toolUsage).length, 1);
      for (const [tool, count] of Object.entries(toolUsage)) {
        if (count < avgUsage * 0.1 && count >= 1) {
          this._patterns.push({
            type: 'underused_tool',
            tool,
            usage: count,
            avgUsage: Math.round(avgUsage),
          });
        }
      }
    }

    // Analyze conversation history patterns
    if (history.length > 0) {
      const taskTypes = {};
      const responseTimes = [];
      for (const entry of history) {
        const type = entry.type || entry.intent || 'general';
        taskTypes[type] = (taskTypes[type] || 0) + 1;
        if (entry.duration || entry.responseTime) {
          responseTimes.push(entry.duration || entry.responseTime);
        }
      }

      // Pattern: common task types
      const sorted = Object.entries(taskTypes).sort((a, b) => b[1] - a[1]);
      if (sorted.length > 0) {
        this._patterns.push({
          type: 'common_tasks',
          tasks: sorted.slice(0, 5).map(([type, count]) => ({ type, count })),
        });

        // Recommend optimization for top tasks
        if (sorted[0][1] > 10) {
          this._recommendations.push({
            id: crypto.randomUUID(),
            type: 'optimize_common_task',
            priority: 'medium',
            description: `Task type "${sorted[0][0]}" is most common (${sorted[0][1]}x). Consider creating a specialized handler or shortcut.`,
            applied: false,
          });
        }
      }

      // Pattern: slow response times
      if (responseTimes.length > 0) {
        const avg = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
        const slow = responseTimes.filter(t => t > avg * 2);
        if (slow.length > responseTimes.length * 0.2) {
          this._patterns.push({
            type: 'slow_responses',
            avgMs: Math.round(avg),
            slowCount: slow.length,
            total: responseTimes.length,
          });
          this._recommendations.push({
            id: crypto.randomUUID(),
            type: 'improve_response_time',
            priority: 'high',
            description: `${slow.length}/${responseTimes.length} responses are significantly slower than average (${Math.round(avg)}ms). Consider caching or parallel execution.`,
            applied: false,
          });
        }
      }
    }

    return {
      patternsFound: this._patterns.length,
      recommendationsGenerated: this._recommendations.length,
      dataAnalyzed: { toolLogEntries: toolLog.length, historyEntries: history.length },
    };
  }

  getRecommendations() {
    return this._recommendations.map(r => ({
      ...r,
      applied: this._appliedIds.has(r.id),
    }));
  }

  getPatterns() {
    return [...this._patterns];
  }

  applyRecommendation(id) {
    const rec = this._recommendations.find(r => r.id === id);
    if (!rec) throw new Error(`Recommendation ${id} not found`);
    if (this._appliedIds.has(id)) return { status: 'already_applied', id };
    this._appliedIds.add(id);
    rec.applied = true;
    return { status: 'applied', recommendation: rec };
  }
}

module.exports = { LearningBridge };
