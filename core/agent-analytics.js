/**
 * Agent Analytics — Track performance, costs, and generate optimization suggestions.
 * No external dependencies.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data', 'analytics');
const ANALYTICS_FILE = path.join(DATA_DIR, 'analytics.json');

function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }

// Cost per 1M tokens (input/output) — updated pricing
const MODEL_PRICING = {
  // Anthropic
  'claude-opus-4': { input: 15, output: 75 },
  'claude-sonnet-4': { input: 3, output: 15 },
  'claude-sonnet-3.5': { input: 3, output: 15 },
  'claude-haiku-3.5': { input: 0.8, output: 4 },
  // OpenAI
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4-turbo': { input: 10, output: 30 },
  'o1': { input: 15, output: 60 },
  'o1-mini': { input: 3, output: 12 },
  'o3-mini': { input: 1.1, output: 4.4 },
  // Google
  'gemini-2.5-pro': { input: 1.25, output: 10 },
  'gemini-2.5-flash': { input: 0.15, output: 0.6 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
  // Groq (hosted, much cheaper)
  'llama-3.3-70b': { input: 0.59, output: 0.79 },
  'llama-3.1-8b': { input: 0.05, output: 0.08 },
  'mixtral-8x7b': { input: 0.24, output: 0.24 },
  // DeepSeek
  'deepseek-chat': { input: 0.14, output: 0.28 },
  'deepseek-reasoner': { input: 0.55, output: 2.19 },
};

function calcCost(model, inputTokens, outputTokens) {
  // Try exact match, then prefix match
  let pricing = MODEL_PRICING[model];
  if (!pricing) {
    const key = Object.keys(MODEL_PRICING).find(k => model.toLowerCase().includes(k.toLowerCase()));
    if (key) pricing = MODEL_PRICING[key];
  }
  if (!pricing) return null;
  return (inputTokens / 1e6) * pricing.input + (outputTokens / 1e6) * pricing.output;
}

class Analytics {
  constructor() {
    this._load();
  }

  _load() {
    ensureDir(DATA_DIR);
    try {
      this.data = JSON.parse(fs.readFileSync(ANALYTICS_FILE, 'utf8'));
    } catch {
      this.data = { events: [], dailySummaries: {} };
    }
    if (!this.data.events) this.data.events = [];
    if (!this.data.dailySummaries) this.data.dailySummaries = {};
  }

  _save() {
    ensureDir(DATA_DIR);
    // Compact: keep only last 10k events in file, summarize older ones
    if (this.data.events.length > 10000) {
      this._compactEvents();
    }
    fs.writeFileSync(ANALYTICS_FILE, JSON.stringify(this.data, null, 2));
  }

  _compactEvents() {
    // Summarize events older than 7 days into daily summaries
    const cutoff = Date.now() - 7 * 86400000;
    const old = this.data.events.filter(e => new Date(e.timestamp).getTime() < cutoff);
    const keep = this.data.events.filter(e => new Date(e.timestamp).getTime() >= cutoff);

    for (const event of old) {
      const day = event.timestamp.slice(0, 10);
      if (!this.data.dailySummaries[day]) {
        this.data.dailySummaries[day] = { models: {}, tools: {}, agents: {}, totalCost: 0, eventCount: 0 };
      }
      const s = this.data.dailySummaries[day];
      s.eventCount++;
      this._aggregateEvent(s, event);
    }
    this.data.events = keep;
  }

  _aggregateEvent(summary, event) {
    if (event.type === 'llm' && event.model) {
      if (!summary.models[event.model]) summary.models[event.model] = { requests: 0, inputTokens: 0, outputTokens: 0, totalLatency: 0, successes: 0, failures: 0, totalCost: 0 };
      const m = summary.models[event.model];
      m.requests++;
      m.inputTokens += event.tokens?.input || 0;
      m.outputTokens += event.tokens?.output || 0;
      m.totalLatency += event.latency || 0;
      if (event.success !== false) m.successes++; else m.failures++;
      m.totalCost += event.cost || 0;
      summary.totalCost += event.cost || 0;
    } else if (event.type === 'tool' && event.tool) {
      if (!summary.tools[event.tool]) summary.tools[event.tool] = { count: 0, totalLatency: 0, errors: 0 };
      const t = summary.tools[event.tool];
      t.count++;
      t.totalLatency += event.latency || 0;
      if (event.success === false) t.errors++;
    } else if (event.type === 'agent' && event.agent) {
      if (!summary.agents[event.agent]) summary.agents[event.agent] = { tasks: 0, totalQuality: 0, tools: {} };
      const a = summary.agents[event.agent];
      a.tasks++;
      if (event.quality) a.totalQuality += event.quality;
      if (event.tool) a.tools[event.tool] = (a.tools[event.tool] || 0) + 1;
    }
  }

  /**
   * Record an analytics event.
   * event: { type: 'llm'|'tool'|'agent', model?, tool?, agent?, tokens?: {input, output}, latency?, success?, cost?, quality? }
   */
  record(event) {
    const entry = {
      ...event,
      timestamp: new Date().toISOString()
    };

    // Auto-calculate cost for LLM events
    if (event.type === 'llm' && event.model && event.tokens && entry.cost == null) {
      const cost = calcCost(event.model, event.tokens.input || 0, event.tokens.output || 0);
      if (cost !== null) entry.cost = Math.round(cost * 1e6) / 1e6; // 6 decimal places
    }

    this.data.events.push(entry);
    this._save();
    return entry;
  }

  /**
   * Get report for a period: 'today', 'week', 'month', or 'all'.
   */
  getReport(period = 'today') {
    const now = Date.now();
    const cutoffs = {
      today: now - 86400000,
      week: now - 7 * 86400000,
      month: now - 30 * 86400000,
      all: 0
    };
    const cutoff = cutoffs[period] || cutoffs.today;

    const events = this.data.events.filter(e => new Date(e.timestamp).getTime() >= cutoff);

    const models = {};
    const tools = {};
    const agents = {};
    let totalCost = 0;

    for (const e of events) {
      if (e.type === 'llm' && e.model) {
        if (!models[e.model]) models[e.model] = { requests: 0, inputTokens: 0, outputTokens: 0, latencies: [], successes: 0, failures: 0, cost: 0 };
        const m = models[e.model];
        m.requests++;
        m.inputTokens += e.tokens?.input || 0;
        m.outputTokens += e.tokens?.output || 0;
        if (e.latency) m.latencies.push(e.latency);
        if (e.success !== false) m.successes++; else m.failures++;
        m.cost += e.cost || 0;
        totalCost += e.cost || 0;
      }
      if (e.type === 'tool') {
        const name = e.tool || 'unknown';
        if (!tools[name]) tools[name] = { count: 0, latencies: [], errors: 0 };
        tools[name].count++;
        if (e.latency) tools[name].latencies.push(e.latency);
        if (e.success === false) tools[name].errors++;
      }
      if (e.type === 'agent') {
        const name = e.agent || 'unknown';
        if (!agents[name]) agents[name] = { tasks: 0, qualities: [], toolUsage: {} };
        agents[name].tasks++;
        if (e.quality) agents[name].qualities.push(e.quality);
        if (e.tool) agents[name].toolUsage[e.tool] = (agents[name].toolUsage[e.tool] || 0) + 1;
      }
    }

    // Compute averages
    const modelReport = {};
    for (const [name, m] of Object.entries(models)) {
      modelReport[name] = {
        requests: m.requests,
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        avgLatencyMs: m.latencies.length ? Math.round(m.latencies.reduce((a, b) => a + b, 0) / m.latencies.length) : null,
        p95LatencyMs: m.latencies.length ? m.latencies.sort((a, b) => a - b)[Math.floor(m.latencies.length * 0.95)] : null,
        successRate: m.requests ? (m.successes / m.requests * 100).toFixed(1) + '%' : 'N/A',
        cost: Math.round(m.cost * 1e4) / 1e4
      };
    }

    const toolReport = {};
    for (const [name, t] of Object.entries(tools)) {
      toolReport[name] = {
        count: t.count,
        avgLatencyMs: t.latencies.length ? Math.round(t.latencies.reduce((a, b) => a + b, 0) / t.latencies.length) : null,
        errorRate: t.count ? (t.errors / t.count * 100).toFixed(1) + '%' : '0%'
      };
    }

    const agentReport = {};
    for (const [name, a] of Object.entries(agents)) {
      agentReport[name] = {
        tasks: a.tasks,
        avgQuality: a.qualities.length ? (a.qualities.reduce((x, y) => x + y, 0) / a.qualities.length).toFixed(2) : null,
        favoriteTools: Object.entries(a.toolUsage).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t, c]) => `${t} (${c})`)
      };
    }

    return {
      period, eventCount: events.length, totalCost: Math.round(totalCost * 1e4) / 1e4,
      models: modelReport, tools: toolReport, agents: agentReport
    };
  }

  getModelComparison() {
    const report = this.getReport('all');
    const models = Object.entries(report.models).map(([name, m]) => ({
      model: name, ...m,
      costPer1kRequests: m.requests ? Math.round(m.cost / m.requests * 1000 * 100) / 100 : null,
      tokensPerDollar: m.cost > 0 ? Math.round((m.inputTokens + m.outputTokens) / m.cost) : null
    }));
    return models.sort((a, b) => (a.costPer1kRequests || Infinity) - (b.costPer1kRequests || Infinity));
  }

  getSuggestions() {
    const suggestions = [];
    const report = this.getReport('week');

    // Find expensive models that could be replaced
    const modelEntries = Object.entries(report.models);
    for (const [name, stats] of modelEntries) {
      if (stats.cost > 1 && name.includes('opus')) {
        suggestions.push({
          type: 'cost', priority: 'high',
          message: `${name} cost $${stats.cost.toFixed(2)} this week (${stats.requests} requests). Consider using claude-sonnet for routine tasks — 5x cheaper with similar quality for most tasks.`
        });
      }
      if (stats.cost > 0.5 && (name.includes('gpt-4o') && !name.includes('mini'))) {
        suggestions.push({
          type: 'cost', priority: 'medium',
          message: `${name} cost $${stats.cost.toFixed(2)} this week. gpt-4o-mini is 16x cheaper and handles most tasks well.`
        });
      }
      if (stats.avgLatencyMs && stats.avgLatencyMs > 10000) {
        suggestions.push({
          type: 'performance', priority: 'medium',
          message: `${name} avg latency is ${(stats.avgLatencyMs / 1000).toFixed(1)}s. Consider Gemini Flash or Groq Llama for latency-sensitive tasks.`
        });
      }
      const successNum = parseFloat(stats.successRate);
      if (successNum < 95 && stats.requests > 10) {
        suggestions.push({
          type: 'reliability', priority: 'high',
          message: `${name} success rate is only ${stats.successRate} (${stats.requests} requests). Investigate failures or add fallback model.`
        });
      }
    }

    // Tool suggestions
    for (const [name, stats] of Object.entries(report.tools)) {
      const errRate = parseFloat(stats.errorRate);
      if (errRate > 10 && stats.count > 5) {
        suggestions.push({
          type: 'reliability', priority: 'high',
          message: `Tool "${name}" has ${stats.errorRate} error rate. Check implementation or add retry logic.`
        });
      }
    }

    // General cost suggestion
    if (report.totalCost > 10) {
      suggestions.push({
        type: 'cost', priority: 'medium',
        message: `Total weekly spend is $${report.totalCost.toFixed(2)}. Review if all requests need premium models. Batching and caching can reduce costs 30-50%.`
      });
    }

    return suggestions.sort((a, b) => (a.priority === 'high' ? 0 : 1) - (b.priority === 'high' ? 0 : 1));
  }

  getCostForecast(days = 30) {
    // Calculate daily cost trend from last 14 days
    const now = Date.now();
    const dailyCosts = {};

    for (const e of this.data.events) {
      if (e.cost && e.cost > 0) {
        const day = e.timestamp.slice(0, 10);
        dailyCosts[day] = (dailyCosts[day] || 0) + e.cost;
      }
    }

    // Include compacted summaries
    for (const [day, s] of Object.entries(this.data.dailySummaries || {})) {
      if (s.totalCost) dailyCosts[day] = (dailyCosts[day] || 0) + s.totalCost;
    }

    const sortedDays = Object.entries(dailyCosts).sort((a, b) => a[0].localeCompare(b[0]));
    if (sortedDays.length === 0) {
      return { forecast: 0, dailyAvg: 0, trend: 'no data', confidence: 'low', days };
    }

    // Use last 14 days for trend
    const recent = sortedDays.slice(-14);
    const costs = recent.map(([_, c]) => c);
    const avg = costs.reduce((a, b) => a + b, 0) / costs.length;

    // Simple linear regression for trend
    let trend = 'stable';
    if (costs.length >= 3) {
      const firstHalf = costs.slice(0, Math.floor(costs.length / 2));
      const secondHalf = costs.slice(Math.floor(costs.length / 2));
      const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
      const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
      if (avgSecond > avgFirst * 1.2) trend = 'increasing';
      else if (avgSecond < avgFirst * 0.8) trend = 'decreasing';
    }

    const forecast = Math.round(avg * days * 100) / 100;
    return {
      forecast,
      dailyAvg: Math.round(avg * 10000) / 10000,
      trend,
      confidence: costs.length >= 7 ? 'medium' : 'low',
      days,
      recentDays: recent.map(([day, cost]) => ({ day, cost: Math.round(cost * 10000) / 10000 }))
    };
  }

  /**
   * Get raw event count.
   */
  getEventCount() { return this.data.events.length; }

  /**
   * Clear all analytics data.
   */
  reset() {
    this.data = { events: [], dailySummaries: {} };
    this._save();
  }
}

let _instance;
function getInstance() {
  if (!_instance) _instance = new Analytics();
  return _instance;
}

module.exports = { Analytics, getInstance };
