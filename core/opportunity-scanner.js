/**
 * ARIES — Opportunity Scanner
 * Analyze user skills, tools, and market conditions to find money-making opportunities.
 * Integrates with dream cycles as a dream type.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'opportunities');
const IDEAS_PATH = path.join(DATA_DIR, 'ideas.json');

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }

// Opportunity templates by type
const OPPORTUNITY_TEMPLATES = {
  saas: [
    { title: 'AI-Powered Code Review SaaS', description: 'Automated code review tool using LLMs to catch bugs, suggest improvements, and enforce style guides.', estimatedRevenue: '$500-5000/mo', effort: 8, timeToFirstDollar: '2-4 weeks', requiredSkills: ['javascript', 'ai', 'web-dev'] },
    { title: 'Internal Tool Builder', description: 'No-code platform for building internal dashboards and admin panels from databases.', estimatedRevenue: '$1000-10000/mo', effort: 9, timeToFirstDollar: '4-8 weeks', requiredSkills: ['full-stack', 'databases', 'ui-design'] },
    { title: 'API Monitoring Dashboard', description: 'Real-time API health monitoring with alerting, uptime tracking, and performance analytics.', estimatedRevenue: '$300-3000/mo', effort: 6, timeToFirstDollar: '1-3 weeks', requiredSkills: ['backend', 'monitoring', 'web-dev'] },
    { title: 'AI Writing Assistant Plugin', description: 'Browser extension or API that helps with grammar, tone, and content generation.', estimatedRevenue: '$200-2000/mo', effort: 5, timeToFirstDollar: '1-2 weeks', requiredSkills: ['javascript', 'ai', 'browser-extensions'] },
  ],
  freelance: [
    { title: 'AI Integration Consulting', description: 'Help businesses integrate LLMs and AI tools into their existing workflows.', estimatedRevenue: '$2000-10000/project', effort: 4, timeToFirstDollar: '1-2 days', requiredSkills: ['ai', 'consulting', 'integration'] },
    { title: 'Automation Scripts for Hire', description: 'Build custom automation scripts (web scraping, data processing, CI/CD) for clients.', estimatedRevenue: '$500-3000/project', effort: 3, timeToFirstDollar: '1-3 days', requiredSkills: ['scripting', 'automation', 'python'] },
    { title: 'Discord/Telegram Bot Development', description: 'Custom bot development for communities, businesses, and crypto projects.', estimatedRevenue: '$300-2000/bot', effort: 3, timeToFirstDollar: '1-2 days', requiredSkills: ['javascript', 'bots', 'apis'] },
  ],
  trading: [
    { title: 'Crypto Arbitrage Bot', description: 'Automated trading bot that exploits price differences across exchanges.', estimatedRevenue: '$100-5000/mo', effort: 7, timeToFirstDollar: '1-2 weeks', requiredSkills: ['trading', 'crypto', 'algorithms'] },
    { title: 'Market Sentiment Analyzer', description: 'Tool that scrapes social media and news to gauge market sentiment for trading signals.', estimatedRevenue: '$200-3000/mo', effort: 6, timeToFirstDollar: '1-3 weeks', requiredSkills: ['nlp', 'data-analysis', 'trading'] },
  ],
  automation: [
    { title: 'Email Outreach Automation', description: 'Automated cold email system with personalization, follow-ups, and analytics.', estimatedRevenue: '$500-5000/mo', effort: 5, timeToFirstDollar: '3-7 days', requiredSkills: ['email', 'automation', 'copywriting'] },
    { title: 'Social Media Content Pipeline', description: 'AI-powered content generation and scheduling across multiple platforms.', estimatedRevenue: '$300-3000/mo', effort: 4, timeToFirstDollar: '2-5 days', requiredSkills: ['ai', 'social-media', 'content'] },
    { title: 'Lead Scraping Service', description: 'Automated lead generation by scraping directories, LinkedIn, and business databases.', estimatedRevenue: '$500-5000/mo', effort: 5, timeToFirstDollar: '3-7 days', requiredSkills: ['scraping', 'databases', 'sales'] },
  ],
  content: [
    { title: 'AI Newsletter', description: 'Curated AI/tech newsletter with commentary, monetized through sponsors and paid tiers.', estimatedRevenue: '$200-5000/mo', effort: 3, timeToFirstDollar: '2-4 weeks', requiredSkills: ['writing', 'ai', 'marketing'] },
    { title: 'Technical YouTube Channel', description: 'Tutorial and explainer videos on coding, AI, and tech topics.', estimatedRevenue: '$100-10000/mo', effort: 6, timeToFirstDollar: '4-12 weeks', requiredSkills: ['video', 'teaching', 'technical'] },
    { title: 'Digital Product Store', description: 'Sell templates, prompts, scripts, and digital tools on Gumroad/Lemonsqueezy.', estimatedRevenue: '$100-5000/mo', effort: 3, timeToFirstDollar: '1-2 weeks', requiredSkills: ['content-creation', 'marketing', 'design'] },
  ],
};

class OpportunityScanner {
  constructor(opts) {
    this.ai = opts && opts.ai;
    ensureDir();
  }

  /**
   * Scan for opportunities based on user profile
   */
  scan(userProfile) {
    const profile = userProfile || {};
    const userSkills = (profile.skills || ['javascript', 'ai', 'automation', 'web-dev']).map(s => s.toLowerCase());
    const ideas = readJSON(IDEAS_PATH, []);
    const newOpportunities = [];

    for (const [type, templates] of Object.entries(OPPORTUNITY_TEMPLATES)) {
      for (const tmpl of templates) {
        // Check if already exists
        const exists = ideas.some(i => i.title === tmpl.title);
        if (exists) continue;

        // Calculate match score
        const requiredSkills = tmpl.requiredSkills || [];
        const matched = requiredSkills.filter(s => userSkills.includes(s));
        const matchScore = requiredSkills.length > 0 ? Math.round((matched.length / requiredSkills.length) * 100) : 50;

        const opportunity = {
          id: uuid(),
          title: tmpl.title,
          description: tmpl.description,
          type,
          estimatedRevenue: tmpl.estimatedRevenue,
          effort: tmpl.effort,
          timeToFirstDollar: tmpl.timeToFirstDollar,
          requiredSkills: tmpl.requiredSkills,
          matchScore,
          steps: [],
          status: 'idea',
          createdAt: Date.now(),
          validatedAt: null,
          pursuedAt: null,
          abandonedAt: null,
          progress: 0,
          notes: '',
        };

        ideas.push(opportunity);
        newOpportunities.push(opportunity);
      }
    }

    writeJSON(IDEAS_PATH, ideas);
    return { scanned: newOpportunities.length, total: ideas.length, new: newOpportunities };
  }

  /**
   * Validate an opportunity — research deeper
   */
  validate(id) {
    const ideas = readJSON(IDEAS_PATH, []);
    const opp = ideas.find(i => i.id === id);
    if (!opp) return { error: 'Opportunity not found' };

    opp.status = 'researching';
    opp.validatedAt = Date.now();

    // Generate validation steps
    opp.steps = [
      { step: 'Market Research', description: 'Analyze competitors and market size', status: 'pending' },
      { step: 'MVP Definition', description: 'Define minimum viable product scope', status: 'pending' },
      { step: 'Cost Analysis', description: 'Estimate development and operational costs', status: 'pending' },
      { step: 'Revenue Model', description: 'Define pricing and monetization strategy', status: 'pending' },
      { step: 'Go/No-Go Decision', description: 'Final decision based on research', status: 'pending' },
    ];

    writeJSON(IDEAS_PATH, ideas);
    return opp;
  }

  /**
   * Mark opportunity as actively pursued
   */
  pursue(id) {
    const ideas = readJSON(IDEAS_PATH, []);
    const opp = ideas.find(i => i.id === id);
    if (!opp) return { error: 'Opportunity not found' };

    opp.status = 'pursuing';
    opp.pursuedAt = Date.now();

    // Generate action plan
    if (!opp.steps || opp.steps.length === 0) {
      opp.steps = [
        { step: 'Setup', description: 'Set up project structure and tools', status: 'pending' },
        { step: 'Build MVP', description: 'Build the minimum viable product', status: 'pending' },
        { step: 'Launch', description: 'Launch to first users/customers', status: 'pending' },
        { step: 'Iterate', description: 'Gather feedback and improve', status: 'pending' },
        { step: 'Scale', description: 'Scale marketing and operations', status: 'pending' },
      ];
    }

    writeJSON(IDEAS_PATH, ideas);
    return opp;
  }

  /**
   * Abandon an opportunity
   */
  abandon(id) {
    const ideas = readJSON(IDEAS_PATH, []);
    const opp = ideas.find(i => i.id === id);
    if (!opp) return { error: 'Opportunity not found' };

    opp.status = 'abandoned';
    opp.abandonedAt = Date.now();
    writeJSON(IDEAS_PATH, ideas);
    return opp;
  }

  /**
   * Get all opportunities, optionally filtered
   */
  getAll(filter) {
    const ideas = readJSON(IDEAS_PATH, []);
    if (!filter || filter === 'all') return ideas;
    return ideas.filter(i => i.status === filter || i.type === filter);
  }

  /**
   * Get actively pursued opportunities
   */
  getActive() {
    return this.getAll().filter(i => i.status === 'pursuing');
  }

  /**
   * Get best matching opportunities
   */
  getBestMatch(limit) {
    const ideas = this.getAll();
    return ideas
      .filter(i => i.status !== 'abandoned')
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, limit || 10);
  }

  /**
   * Update opportunity progress
   */
  updateProgress(id, progress, notes) {
    const ideas = readJSON(IDEAS_PATH, []);
    const opp = ideas.find(i => i.id === id);
    if (!opp) return { error: 'Opportunity not found' };

    if (progress !== undefined) opp.progress = Math.max(0, Math.min(100, progress));
    if (notes) opp.notes = notes;
    opp.updatedAt = Date.now();

    writeJSON(IDEAS_PATH, ideas);
    return opp;
  }

  /**
   * Get stats
   */
  getStats() {
    const ideas = readJSON(IDEAS_PATH, []);
    const byStatus = {};
    const byType = {};
    for (const i of ideas) {
      byStatus[i.status] = (byStatus[i.status] || 0) + 1;
      byType[i.type] = (byType[i.type] || 0) + 1;
    }
    const active = ideas.filter(i => i.status === 'pursuing');
    const bestMatch = ideas.filter(i => i.status !== 'abandoned').sort((a, b) => b.matchScore - a.matchScore)[0];
    return {
      total: ideas.length,
      byStatus,
      byType,
      activeCount: active.length,
      bestMatch: bestMatch ? { title: bestMatch.title, matchScore: bestMatch.matchScore } : null,
    };
  }
}

module.exports = OpportunityScanner;
