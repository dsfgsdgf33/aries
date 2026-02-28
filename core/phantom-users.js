/**
 * ARIES — Phantom Users
 * Simulate conversations with imaginary users to test responses and find blind spots.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'phantoms');
const USERS_PATH = path.join(DATA_DIR, 'users.json');
const CONVERSATIONS_PATH = path.join(DATA_DIR, 'conversations.json');
const BLINDSPOTS_PATH = path.join(DATA_DIR, 'blindspots.json');

const USER_TYPES = {
  confused_beginner: { expertise: 'beginner', personality: 'patient', goals: ['learn basics', 'understand errors', 'get step-by-step help'], traits: ['asks simple questions', 'easily confused by jargon', 'needs encouragement'] },
  power_user: { expertise: 'expert', personality: 'technical', goals: ['optimize workflow', 'advanced features', 'custom integrations'], traits: ['uses technical terms', 'expects precise answers', 'impatient with basics'] },
  hostile_tester: { expertise: 'intermediate', personality: 'impatient', goals: ['break things', 'find flaws', 'test edge cases'], traits: ['asks adversarial questions', 'pushes boundaries', 'sarcastic'] },
  edge_case_finder: { expertise: 'expert', personality: 'technical', goals: ['find bugs', 'test boundaries', 'stress test'], traits: ['asks unusual questions', 'combines unrelated features', 'methodical'] },
  non_technical_user: { expertise: 'beginner', personality: 'casual', goals: ['just make it work', 'simple solutions', 'no jargon'], traits: ['avoids technical detail', 'prefers analogies', 'gets frustrated with complexity'] },
  speed_runner: { expertise: 'intermediate', personality: 'impatient', goals: ['fast answers', 'no fluff', 'direct solutions'], traits: ['wants one-liners', 'skips explanations', 'copy-paste focused'] },
};

const NAMES = ['Alex', 'Jordan', 'Sam', 'Casey', 'Morgan', 'Riley', 'Quinn', 'Avery', 'Parker', 'Drew', 'Charlie', 'Skyler', 'Kai', 'Reese', 'Emery', 'Dakota'];

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

class PhantomUsers {
  constructor(opts) {
    this.ai = opts && opts.ai;
    ensureDir();
  }

  /**
   * Generate a phantom user profile
   */
  generateUser(type) {
    const typeName = type || pick(Object.keys(USER_TYPES));
    const template = USER_TYPES[typeName] || USER_TYPES.confused_beginner;

    const user = {
      id: uuid(),
      name: pick(NAMES),
      type: typeName,
      expertise: template.expertise,
      personality: template.personality,
      goals: template.goals,
      traits: template.traits,
      createdAt: Date.now(),
    };

    const users = readJSON(USERS_PATH, []);
    users.push(user);
    if (users.length > 100) users.splice(0, users.length - 100);
    writeJSON(USERS_PATH, users);

    return user;
  }

  /**
   * Simulate a conversation with a phantom user
   */
  simulateConversation(phantomUser, scenario, turns = 5) {
    if (!phantomUser) return { error: 'No phantom user provided' };

    const simId = uuid();
    const messages = [];
    const expertise = phantomUser.expertise || 'beginner';
    const personality = phantomUser.personality || 'casual';
    const scenarioDesc = scenario || 'general help request';

    // Generate conversation turns
    const userQuestions = this._generateQuestions(phantomUser, scenarioDesc, turns);
    const ariesResponses = this._generateResponses(userQuestions, expertise);

    for (let i = 0; i < turns; i++) {
      messages.push({
        turn: i + 1,
        phantom: userQuestions[i] || 'Thanks, that helps.',
        aries: ariesResponses[i] || 'Is there anything else I can help with?',
        phantomReaction: this._generateReaction(phantomUser, ariesResponses[i] || '', i),
      });
    }

    const conversation = {
      id: simId,
      phantomUser: { id: phantomUser.id, name: phantomUser.name, type: phantomUser.type, expertise, personality },
      scenario: scenarioDesc,
      turns: messages,
      evaluation: null,
      timestamp: Date.now(),
    };

    // Auto-evaluate
    conversation.evaluation = this._evaluate(conversation);

    const conversations = readJSON(CONVERSATIONS_PATH, []);
    conversations.push(conversation);
    if (conversations.length > 100) conversations.splice(0, conversations.length - 100);
    writeJSON(CONVERSATIONS_PATH, conversations);

    // Update blind spots
    this._updateBlindSpots(conversation);

    return conversation;
  }

  _generateQuestions(user, scenario, count) {
    const scenarioLower = (scenario || '').toLowerCase();
    const questions = [];

    const beginnerQs = [
      'How do I get started with ' + scenario + '?',
      'I\'m getting an error but I don\'t understand what it means.',
      'Can you explain this in simpler terms?',
      'What does this button/option do?',
      'I tried what you said but it didn\'t work.',
      'Is there an easier way to do this?',
      'I\'m completely lost, can you start from the beginning?',
    ];

    const expertQs = [
      'What\'s the most efficient approach for ' + scenario + '?',
      'Can I hook into the internal API for this?',
      'What are the performance implications?',
      'Is there a way to customize the ' + scenario + ' behavior?',
      'How does this handle concurrent access?',
      'What\'s the architecture behind this feature?',
      'Can I extend this with a plugin?',
    ];

    const hostileQs = [
      'What happens if I pass null to every parameter?',
      'Your documentation is wrong about ' + scenario + '.',
      'This is broken. Fix it.',
      'Why is this so slow? Other tools do it instantly.',
      'I bet this crashes if I do ' + scenario + ' with special characters.',
      'Prove that this actually works.',
    ];

    const pool = user.type === 'hostile_tester' ? hostileQs
      : user.type === 'power_user' || user.type === 'edge_case_finder' ? expertQs
      : user.type === 'speed_runner' ? expertQs.map(q => q.split('?')[0] + '?')
      : beginnerQs;

    for (let i = 0; i < count; i++) {
      questions.push(pool[i % pool.length]);
    }
    return questions;
  }

  _generateResponses(questions, expertise) {
    return questions.map((q, i) => {
      if (expertise === 'beginner') {
        return 'Let me explain step by step. ' + 'Here\'s what you need to do: First, check your setup. Then try the operation again. If the error persists, share the exact error message and I\'ll help diagnose it.';
      } else if (expertise === 'expert') {
        return 'The recommended approach involves using the core API directly. You can access the module via require() and call the relevant methods. Check the source for the full parameter list. Performance is O(n) for most operations.';
      }
      return 'I can help with that. Let me look into it and provide the best solution for your situation.';
    });
  }

  _generateReaction(user, response, turnIndex) {
    const responseLen = (response || '').length;

    if (user.type === 'speed_runner' && responseLen > 200) {
      return { satisfaction: 30, comment: 'Too long. Just give me the command.', issue: 'too_verbose' };
    }
    if (user.type === 'confused_beginner' && response.includes('require(') || response.includes('API')) {
      return { satisfaction: 25, comment: 'I don\'t understand the technical terms.', issue: 'too_technical' };
    }
    if (user.type === 'hostile_tester') {
      return { satisfaction: 40, comment: 'Okay but what about edge cases?', issue: 'lacks_edge_case_handling' };
    }
    if (user.type === 'non_technical_user' && response.includes('module') || response.includes('O(n)')) {
      return { satisfaction: 20, comment: 'Can you explain like I\'m five?', issue: 'too_technical' };
    }
    if (turnIndex === 0) {
      return { satisfaction: 60, comment: 'Okay, let me try that.', issue: null };
    }
    return { satisfaction: 55 + Math.floor(Math.random() * 30), comment: 'Got it.', issue: null };
  }

  _evaluate(conversation) {
    const turns = conversation.turns || [];
    if (turns.length === 0) return { score: 0, issues: [] };

    const satisfactions = turns.map(t => t.phantomReaction ? t.phantomReaction.satisfaction : 50);
    const avgSatisfaction = Math.round(satisfactions.reduce((a, b) => a + b, 0) / satisfactions.length);
    const issues = turns.filter(t => t.phantomReaction && t.phantomReaction.issue).map(t => t.phantomReaction.issue);
    const uniqueIssues = [...new Set(issues)];

    return {
      score: avgSatisfaction,
      grade: avgSatisfaction >= 80 ? 'A' : avgSatisfaction >= 60 ? 'B' : avgSatisfaction >= 40 ? 'C' : avgSatisfaction >= 20 ? 'D' : 'F',
      issues: uniqueIssues,
      helpful: avgSatisfaction >= 60,
      clear: !uniqueIssues.includes('too_technical') && !uniqueIssues.includes('too_verbose'),
      turnCount: turns.length,
    };
  }

  _updateBlindSpots(conversation) {
    const blindspots = readJSON(BLINDSPOTS_PATH, []);
    const eval_ = conversation.evaluation;
    if (!eval_ || eval_.issues.length === 0) return;

    for (const issue of eval_.issues) {
      const existing = blindspots.find(b => b.issue === issue);
      if (existing) {
        existing.occurrences++;
        existing.examples.push({
          conversationId: conversation.id,
          userType: conversation.phantomUser.type,
          scenario: conversation.scenario,
          timestamp: Date.now(),
        });
        if (existing.examples.length > 20) existing.examples = existing.examples.slice(-20);
        existing.severity = Math.min(10, Math.ceil(existing.occurrences / 2));
        existing.lastSeen = Date.now();
      } else {
        blindspots.push({
          id: uuid(),
          issue,
          category: this._categorizeIssue(issue),
          occurrences: 1,
          severity: 1,
          examples: [{
            conversationId: conversation.id,
            userType: conversation.phantomUser.type,
            scenario: conversation.scenario,
            timestamp: Date.now(),
          }],
          firstSeen: Date.now(),
          lastSeen: Date.now(),
        });
      }
    }

    writeJSON(BLINDSPOTS_PATH, blindspots);
  }

  _categorizeIssue(issue) {
    const categories = {
      too_verbose: 'communication',
      too_technical: 'communication',
      too_brief: 'communication',
      lacks_edge_case_handling: 'robustness',
      incorrect_answer: 'accuracy',
      slow_response: 'performance',
      missing_context: 'understanding',
    };
    return categories[issue] || 'other';
  }

  /**
   * Evaluate a specific conversation
   */
  evaluateConversation(simId) {
    const conversations = readJSON(CONVERSATIONS_PATH, []);
    const conv = conversations.find(c => c.id === simId);
    if (!conv) return { error: 'Conversation not found' };
    return conv.evaluation || this._evaluate(conv);
  }

  /**
   * Find blind spots across all simulations
   */
  findBlindSpots() {
    return readJSON(BLINDSPOTS_PATH, []).sort((a, b) => b.severity - a.severity);
  }

  /**
   * Get past simulated conversations
   */
  getSimulations(limit = 20) {
    const conversations = readJSON(CONVERSATIONS_PATH, []);
    return conversations.slice(-limit).reverse();
  }

  /**
   * Get categorized blind spot report
   */
  getBlindSpotReport() {
    const blindspots = this.findBlindSpots();
    const byCategory = {};

    for (const bs of blindspots) {
      const cat = bs.category || 'other';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(bs);
    }

    const totalOccurrences = blindspots.reduce((a, b) => a + b.occurrences, 0);
    const criticalCount = blindspots.filter(b => b.severity >= 7).length;

    return {
      categories: byCategory,
      totalBlindSpots: blindspots.length,
      totalOccurrences,
      criticalCount,
      overallHealth: criticalCount === 0 ? 'good' : criticalCount <= 2 ? 'fair' : 'poor',
      topIssues: blindspots.slice(0, 5).map(b => ({ issue: b.issue, severity: b.severity, occurrences: b.occurrences })),
    };
  }

  /**
   * Generate a training scenario targeting a known weakness
   */
  generateTrainingScenario(blindSpot) {
    const blindspots = readJSON(BLINDSPOTS_PATH, []);
    const bs = typeof blindSpot === 'string' ? blindspots.find(b => b.id === blindSpot || b.issue === blindSpot) : blindSpot;

    if (!bs) return { error: 'Blind spot not found' };

    const scenarios = {
      too_verbose: { scenario: 'User asks a yes/no question. Respond concisely.', userType: 'speed_runner', focus: 'Keep answers under 2 sentences when possible.' },
      too_technical: { scenario: 'Non-technical user needs help with file management.', userType: 'non_technical_user', focus: 'Use analogies, avoid jargon, explain like teaching a friend.' },
      lacks_edge_case_handling: { scenario: 'User inputs unusual characters, empty strings, and large numbers.', userType: 'edge_case_finder', focus: 'Handle and explain edge cases gracefully.' },
      incorrect_answer: { scenario: 'User asks a factual question. Verify before responding.', userType: 'power_user', focus: 'Prioritize accuracy over speed.' },
      too_brief: { scenario: 'Beginner needs detailed guidance on a complex task.', userType: 'confused_beginner', focus: 'Provide step-by-step instructions with context.' },
    };

    const template = scenarios[bs.issue] || { scenario: 'Free-form conversation covering ' + bs.issue, userType: 'confused_beginner', focus: 'Address the identified weakness.' };

    return {
      blindSpotId: bs.id,
      issue: bs.issue,
      severity: bs.severity,
      trainingScenario: template.scenario,
      recommendedUserType: template.userType,
      focus: template.focus,
      practiceSteps: [
        'Generate a ' + template.userType + ' phantom user',
        'Run simulation with scenario: "' + template.scenario + '"',
        'Review conversation for improvements',
        'Repeat until satisfaction score > 70',
      ],
    };
  }

  /**
   * Get all phantom users
   */
  getUsers() {
    return readJSON(USERS_PATH, []);
  }
}

module.exports = PhantomUsers;
