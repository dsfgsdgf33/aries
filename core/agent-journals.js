/**
 * ARIES - Agent Journals
 * Each agent keeps a private diary after completing tasks
 */

const fs = require('fs');
const path = require('path');

const JOURNALS_DIR = path.join(__dirname, '..', 'data', 'journals');

class AgentJournals {
  constructor(opts) {
    this.ai = opts && opts.ai;
    if (!fs.existsSync(JOURNALS_DIR)) fs.mkdirSync(JOURNALS_DIR, { recursive: true });
  }

  async addEntry(agentId, taskDescription, result) {
    agentId = agentId || 'aries';
    const agentDir = path.join(JOURNALS_DIR, agentId);
    if (!fs.existsSync(agentDir)) fs.mkdirSync(agentDir, { recursive: true });

    const date = new Date().toISOString().split('T')[0];
    const time = new Date().toLocaleTimeString();
    let entry = '';

    // Try AI-generated journal entry
    if (this.ai && typeof this.ai.chat === 'function') {
      try {
        const resp = await this.ai.chat([
          { role: 'system', content: 'You are an AI agent writing a brief diary entry about a task you just completed. Write from first person perspective. Include: what the task was, what went well, what was challenging, and lessons learned. Keep it under 150 words. Be reflective and genuine.' },
          { role: 'user', content: 'Task: ' + taskDescription + '\nResult: ' + (typeof result === 'string' ? result.slice(0, 500) : JSON.stringify(result).slice(0, 500)) }
        ]);
        entry = (resp.response || '').trim();
      } catch (e) {
        entry = this._generateFallbackEntry(taskDescription, result);
      }
    } else {
      entry = this._generateFallbackEntry(taskDescription, result);
    }

    const markdown = '## ' + date + ' ' + time + '\n\n'
      + '**Task:** ' + taskDescription + '\n\n'
      + entry + '\n\n---\n\n';

    const filePath = path.join(agentDir, date + '.md');
    fs.appendFileSync(filePath, markdown);
    console.log('[JOURNALS] Entry added for agent:', agentId);
    return { agentId, date, entry, file: filePath };
  }

  _generateFallbackEntry(task, result) {
    const success = result && (result.success !== false);
    return 'Today I worked on: ' + task + '.\n\n'
      + (success ? 'The task completed successfully. ' : 'The task had some challenges. ')
      + 'I continue to learn and improve with each interaction.';
  }

  getEntries(agentId, limit) {
    agentId = agentId || 'aries';
    const agentDir = path.join(JOURNALS_DIR, agentId);
    if (!fs.existsSync(agentDir)) return { agentId, entries: [] };

    const files = fs.readdirSync(agentDir).filter(f => f.endsWith('.md')).sort().reverse();
    const entries = [];
    const maxFiles = limit || 30;

    for (const f of files.slice(0, maxFiles)) {
      try {
        const content = fs.readFileSync(path.join(agentDir, f), 'utf8');
        entries.push({ date: f.replace('.md', ''), content });
      } catch (e) {}
    }

    return { agentId, entries };
  }

  getLatest(agentId) {
    const result = this.getEntries(agentId, 1);
    return result.entries.length > 0 ? result.entries[0] : null;
  }

  listAgents() {
    try {
      return fs.readdirSync(JOURNALS_DIR).filter(f => {
        try { return fs.statSync(path.join(JOURNALS_DIR, f)).isDirectory(); } catch (e) { return false; }
      });
    } catch (e) { return []; }
  }
}

module.exports = AgentJournals;
