/**
 * ARIES — Neural Bus
 * Central event bus connecting ALL modules. The nervous system.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'neural-bus');
const LOG_PATH = path.join(DATA_DIR, 'log.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

const EVENT_TYPES = [
  'THOUGHT', 'EMOTION_CHANGE', 'PERCEPTION', 'DREAM', 'DRIVE_CHANGE',
  'PROPOSAL', 'FLOW_CHANGE', 'ATTENTION_SHIFT', 'INTUITION', 'INSIGHT',
  'CHAOS_EVENT', 'WEATHER_CHANGE'
];

class NeuralBus {
  constructor() {
    this._subscribers = {};       // event -> Set<callback>
    this._allSubscribers = new Set(); // broadcast subscribers
    this._rateLimits = {};        // source -> { count, windowStart }
    this._eventLog = [];
    this._stats = { byType: {}, byPublisher: {}, bySubscriber: {}, totalEvents: 0, startedAt: Date.now() };
    this._topology = {};          // source -> Set<event>
    this._subscriberTopology = {}; // event -> Set<subscriberName>
    ensureDir();
    this._loadLog();
  }

  _loadLog() {
    const stored = readJSON(LOG_PATH, []);
    this._eventLog = stored.slice(-1000);
  }

  _persistLog() {
    writeJSON(LOG_PATH, this._eventLog.slice(-1000));
  }

  _checkRateLimit(source) {
    const now = Date.now();
    if (!this._rateLimits[source]) {
      this._rateLimits[source] = { count: 0, windowStart: now };
    }
    const rl = this._rateLimits[source];
    if (now - rl.windowStart > 60000) {
      rl.count = 0;
      rl.windowStart = now;
    }
    if (rl.count >= 100) return false;
    rl.count++;
    return true;
  }

  publish(event, source, data) {
    if (!this._checkRateLimit(source)) {
      return { error: 'Rate limited', source, event };
    }

    const entry = { id: uuid(), event, source, data, timestamp: Date.now() };
    this._eventLog.push(entry);
    if (this._eventLog.length > 1000) this._eventLog = this._eventLog.slice(-1000);

    // Stats
    this._stats.totalEvents++;
    this._stats.byType[event] = (this._stats.byType[event] || 0) + 1;
    this._stats.byPublisher[source] = (this._stats.byPublisher[source] || 0) + 1;

    // Topology
    if (!this._topology[source]) this._topology[source] = new Set();
    this._topology[source].add(event);

    // Deliver to subscribers
    const subs = this._subscribers[event];
    if (subs) {
      for (const cb of subs) {
        try { cb(entry); } catch (e) { console.error('[NEURAL-BUS] subscriber error:', e.message); }
      }
    }

    // Persist periodically
    if (this._stats.totalEvents % 50 === 0) this._persistLog();

    return entry;
  }

  subscribe(event, callback, name) {
    if (!this._subscribers[event]) this._subscribers[event] = new Set();
    this._subscribers[event].add(callback);
    const subName = name || 'anonymous';
    if (!this._subscriberTopology[event]) this._subscriberTopology[event] = new Set();
    this._subscriberTopology[event].add(subName);
    this._stats.bySubscriber[subName] = (this._stats.bySubscriber[subName] || 0) + 1;
    return { subscribed: event, subscriber: subName };
  }

  unsubscribe(event, callback) {
    if (this._subscribers[event]) {
      this._subscribers[event].delete(callback);
    }
  }

  broadcast(event, data) {
    const source = 'broadcast';
    const entry = { id: uuid(), event, source, data, timestamp: Date.now(), broadcast: true };
    this._eventLog.push(entry);
    if (this._eventLog.length > 1000) this._eventLog = this._eventLog.slice(-1000);
    this._stats.totalEvents++;
    this._stats.byType[event] = (this._stats.byType[event] || 0) + 1;

    // Deliver to ALL event subscribers
    for (const [evt, subs] of Object.entries(this._subscribers)) {
      if (evt === event || event === '*') {
        for (const cb of subs) {
          try { cb(entry); } catch (e) { /* ignore */ }
        }
      }
    }
    return entry;
  }

  getEventLog(limit, type) {
    let events = [...this._eventLog];
    if (type) events = events.filter(e => e.event === type);
    return events.slice(-(limit || 50)).reverse();
  }

  getEventStats() {
    const elapsed = (Date.now() - this._stats.startedAt) / 60000;
    return {
      totalEvents: this._stats.totalEvents,
      eventsPerMinute: elapsed > 0 ? Math.round(this._stats.totalEvents / elapsed * 10) / 10 : 0,
      byType: this._stats.byType,
      mostActivePublishers: Object.entries(this._stats.byPublisher).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => ({ source: k, events: v })),
      mostActiveSubscribers: Object.entries(this._stats.bySubscriber).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => ({ subscriber: k, subscriptions: v })),
      eventTypes: EVENT_TYPES,
      uptimeMinutes: Math.round(elapsed),
    };
  }

  getTopology() {
    const publishers = {};
    for (const [source, events] of Object.entries(this._topology)) {
      publishers[source] = [...events];
    }
    const subscribers = {};
    for (const [event, names] of Object.entries(this._subscriberTopology)) {
      subscribers[event] = [...names];
    }
    return { publishers, subscribers };
  }
}

module.exports = NeuralBus;
