/**
 * ARIES — Cognitive Weather
 * Internal weather system reporting mind-state conditions.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'weather');
const CURRENT_PATH = path.join(DATA_DIR, 'current.json');
const HISTORY_PATH = path.join(DATA_DIR, 'history.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }

const WEATHER_TYPES = {
  CLEAR:    { icon: '☀️', label: 'Clear', color: '#22c55e', desc: 'High performance, all systems nominal' },
  SUNNY:    { icon: '🌟', label: 'Sunny', color: '#eab308', desc: 'Creative, positive, high energy' },
  CLOUDY:   { icon: '☁️', label: 'Cloudy', color: '#94a3b8', desc: 'Mixed signals, reduced confidence' },
  FOGGY:    { icon: '🌫️', label: 'Foggy', color: '#64748b', desc: 'Low clarity, high uncertainty' },
  STORMY:   { icon: '⛈️', label: 'Stormy', color: '#ef4444', desc: 'Errors, conflicts, low coherence' },
  ELECTRIC: { icon: '⚡', label: 'Electric', color: '#a78bfa', desc: 'High energy, breakthrough potential' },
};

class CognitiveWeather {
  constructor() {
    ensureDir();
    this._updateInterval = null;
  }

  startAutoUpdate() {
    if (this._updateInterval) return;
    this._updateInterval = setInterval(() => this._update(), 15 * 60 * 1000);
    if (this._updateInterval.unref) this._updateInterval.unref();
    this._update();
  }

  stopAutoUpdate() {
    if (this._updateInterval) { clearInterval(this._updateInterval); this._updateInterval = null; }
  }

  _assessFactors() {
    const factors = {
      errorRate: { value: 0, weight: 25, label: 'Error Rate' },
      coherence: { value: 70, weight: 20, label: 'Coherence' },
      emotionalStability: { value: 65, weight: 15, label: 'Emotional Stability' },
      creativityOutput: { value: 50, weight: 15, label: 'Creativity Output' },
      calibrationDrift: { value: 10, weight: 15, label: 'Calibration Drift' },
      insightRate: { value: 30, weight: 10, label: 'Insight Rate' },
    };

    // Try to get real data from other modules
    try {
      const healingPath = path.join(__dirname, '..', 'data', 'self-healing', 'crashes.json');
      const crashes = readJSON(healingPath, []);
      const recentCrashes = crashes.filter(c => Date.now() - (c.timestamp || 0) < 3600000);
      factors.errorRate.value = Math.min(100, recentCrashes.length * 20);
    } catch {}

    try {
      const ideasPath = path.join(__dirname, '..', 'data', 'creativity', 'ideas.json');
      const ideas = readJSON(ideasPath, []);
      const recentIdeas = ideas.filter(i => Date.now() - (i.timestamp || 0) < 3600000);
      factors.creativityOutput.value = Math.min(100, recentIdeas.length * 25);
    } catch {}

    try {
      const calPath = path.join(__dirname, '..', 'data', 'calibration', 'predictions.json');
      const preds = readJSON(calPath, []);
      const resolved = preds.filter(p => p.outcome !== undefined);
      if (resolved.length > 0) {
        const correct = resolved.filter(p => p.outcome === true).length;
        factors.calibrationDrift.value = Math.abs(50 - (correct / resolved.length * 100));
      }
    } catch {}

    return factors;
  }

  _determineWeather(factors) {
    const errorRate = factors.errorRate.value;
    const coherence = factors.coherence.value;
    const creativity = factors.creativityOutput.value;
    const insight = factors.insightRate.value;

    if (errorRate > 60) return 'STORMY';
    if (coherence < 30 && errorRate > 30) return 'FOGGY';
    if (creativity > 70 && insight > 50) return 'ELECTRIC';
    if (creativity > 60 && errorRate < 20) return 'SUNNY';
    if (coherence > 60 && errorRate < 15) return 'CLEAR';
    if (errorRate > 30 || coherence < 50) return 'CLOUDY';
    return 'CLEAR';
  }

  _update() {
    const factors = this._assessFactors();
    const type = this._determineWeather(factors);
    const weather = {
      type,
      ...WEATHER_TYPES[type],
      factors,
      timestamp: Date.now(),
      temperature: Math.round(Object.values(factors).reduce((s, f) => s + f.value * f.weight, 0) / Object.values(factors).reduce((s, f) => s + f.weight, 0)),
    };

    writeJSON(CURRENT_PATH, weather);

    // Append to history
    const history = readJSON(HISTORY_PATH, []);
    history.push({ type, timestamp: Date.now(), temperature: weather.temperature });
    if (history.length > 2000) history.splice(0, history.length - 2000);
    writeJSON(HISTORY_PATH, history);

    return weather;
  }

  getCurrentWeather() {
    const current = readJSON(CURRENT_PATH, null);
    if (!current || Date.now() - (current.timestamp || 0) > 20 * 60 * 1000) {
      return this._update();
    }
    return current;
  }

  getForecast() {
    const history = readJSON(HISTORY_PATH, []);
    const recent = history.slice(-12); // last ~3 hours at 15min intervals
    if (recent.length < 3) return { forecast: 'Insufficient data for forecast', confidence: 'low' };

    const types = recent.map(h => h.type);
    const lastType = types[types.length - 1];
    const typeCounts = {};
    types.forEach(t => typeCounts[t] = (typeCounts[t] || 0) + 1);

    const dominant = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0][0];
    const trend = recent.length >= 2 ? recent[recent.length - 1].temperature - recent[0].temperature : 0;

    return {
      currentType: lastType,
      current: WEATHER_TYPES[lastType],
      predictedType: dominant,
      predicted: WEATHER_TYPES[dominant],
      trend: trend > 5 ? 'improving' : trend < -5 ? 'declining' : 'stable',
      trendValue: Math.round(trend),
      confidence: recent.length >= 8 ? 'high' : recent.length >= 4 ? 'medium' : 'low',
      hoursAnalyzed: Math.round(recent.length * 15 / 60 * 10) / 10,
    };
  }

  getWeatherHistory(days) {
    days = days || 7;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const history = readJSON(HISTORY_PATH, []);
    return history.filter(h => h.timestamp > cutoff).map(h => ({ ...h, ...WEATHER_TYPES[h.type] }));
  }

  getAdvisory() {
    const weather = this.getCurrentWeather();
    const advisories = {
      CLEAR: 'All systems performing well. Good conditions for any task.',
      SUNNY: 'High creative energy! Good time for brainstorming and creative work.',
      CLOUDY: 'Some uncertainty in outputs. Consider verifying important results.',
      FOGGY: 'Low clarity — my accuracy may be reduced. Consider double-checking important outputs.',
      STORMY: '⚠️ My accuracy may be significantly reduced. Consider double-checking ALL important outputs. Multiple system stressors detected.',
      ELECTRIC: '⚡ High breakthrough potential! Good time for creative work, exploration, and big ideas.',
    };

    return {
      weather: weather.type,
      icon: weather.icon,
      advisory: advisories[weather.type] || 'Unknown conditions.',
      temperature: weather.temperature,
      timestamp: weather.timestamp,
    };
  }

  getWeatherFactors() {
    const weather = this.getCurrentWeather();
    return weather.factors || this._assessFactors();
  }
}

module.exports = CognitiveWeather;
