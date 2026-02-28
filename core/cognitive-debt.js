/**
 * ARIES — Cognitive Debt
 * Track shortcuts and assumptions that need to be paid down.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'cognitive-debt');
const LEDGER_PATH = path.join(DATA_DIR, 'ledger.json');

const DEBT_TYPES = ['ASSUMPTION', 'SHORTCUT', 'INCOMPLETE', 'UNTESTED', 'STALE'];
const INTEREST_RATES = { low: 1, medium: 3, high: 5 }; // per day

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

function getSeverityBand(severity) {
  if (severity <= 3) return 'low';
  if (severity <= 6) return 'medium';
  return 'high';
}

function calcInterest(entry) {
  if (entry.paidAt) return 0;
  const daysOld = (Date.now() - entry.createdAt) / (24 * 60 * 60 * 1000);
  const rate = INTEREST_RATES[getSeverityBand(entry.severity)] || 1;
  return Math.round(daysOld * rate * 10) / 10;
}

class CognitiveDebt {
  constructor() { ensureDir(); }

  _getLedger() {
    const ledger = readJSON(LEDGER_PATH, []);
    // Recalculate interest
    for (const entry of ledger) {
      entry.interest = calcInterest(entry);
    }
    return ledger;
  }

  incur(type, description, context, severity) {
    if (!DEBT_TYPES.includes(type)) return { error: 'Invalid type. Valid: ' + DEBT_TYPES.join(', ') };
    severity = Math.max(1, Math.min(10, severity || 5));
    const ledger = this._getLedger();
    const entry = {
      id: uuid(),
      type,
      description,
      context: context || '',
      severity,
      createdAt: Date.now(),
      paidAt: null,
      resolution: null,
      interest: 0,
    };
    ledger.push(entry);
    writeJSON(LEDGER_PATH, ledger);
    return entry;
  }

  getDebt() {
    return this._getLedger()
      .filter(e => !e.paidAt)
      .sort((a, b) => (b.severity * (b.interest || 1)) - (a.severity * (a.interest || 1)));
  }

  pay(debtId, resolution) {
    const ledger = this._getLedger();
    const entry = ledger.find(e => e.id === debtId);
    if (!entry) return { error: 'Debt not found' };
    if (entry.paidAt) return { error: 'Already paid' };
    entry.paidAt = Date.now();
    entry.resolution = resolution || 'Resolved';
    entry.interest = calcInterest(entry);
    writeJSON(LEDGER_PATH, ledger);
    return entry;
  }

  getInterest() {
    const debts = this._getLedger().filter(e => !e.paidAt);
    return {
      totalInterest: Math.round(debts.reduce((s, e) => s + (e.interest || 0), 0) * 10) / 10,
      debtCount: debts.length,
      items: debts.map(e => ({ id: e.id, type: e.type, interest: e.interest, severity: e.severity, description: e.description.slice(0, 80) })),
    };
  }

  getCritical() {
    return this._getLedger().filter(e => !e.paidAt && (e.severity > 7 || (e.interest || 0) > 50));
  }

  autoDetect(action) {
    const text = (action || '').toLowerCase();
    const detected = [];
    const hedgeWords = [
      { words: ['probably', 'maybe', 'i think', 'likely', 'presumably'], type: 'ASSUMPTION', desc: 'Hedging language detected' },
      { words: ['for now', 'quick fix', 'hack', 'workaround', 'temporary'], type: 'SHORTCUT', desc: 'Shortcut/temporary solution' },
      { words: ['todo', 'fixme', 'later', 'eventually', 'skip'], type: 'INCOMPLETE', desc: 'Incomplete work flagged' },
      { words: ['untested', 'no tests', 'should work', 'seems to'], type: 'UNTESTED', desc: 'Unverified/untested claim' },
      { words: ['last time i checked', 'used to be', 'i remember', 'from before'], type: 'STALE', desc: 'Potentially outdated information' },
    ];

    for (const check of hedgeWords) {
      for (const word of check.words) {
        if (text.includes(word)) {
          detected.push({ type: check.type, trigger: word, description: check.desc + ': "' + word + '"', severity: 4 });
          break;
        }
      }
    }
    return detected;
  }

  getDebtReport() {
    const ledger = this._getLedger();
    const outstanding = ledger.filter(e => !e.paidAt);
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const paidThisWeek = ledger.filter(e => e.paidAt && e.paidAt > oneWeekAgo);
    const byType = {};
    for (const e of outstanding) {
      byType[e.type] = (byType[e.type] || 0) + 1;
    }
    const ages = outstanding.map(e => (Date.now() - e.createdAt) / (24 * 60 * 60 * 1000));
    const avgAge = ages.length > 0 ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length * 10) / 10 : 0;

    return {
      totalOutstanding: outstanding.length,
      totalPaid: ledger.filter(e => e.paidAt).length,
      byType,
      averageAgeDays: avgAge,
      criticalCount: this.getCritical().length,
      paidThisWeek: paidThisWeek.length,
      totalInterest: Math.round(outstanding.reduce((s, e) => s + (e.interest || 0), 0) * 10) / 10,
    };
  }
}

module.exports = CognitiveDebt;
