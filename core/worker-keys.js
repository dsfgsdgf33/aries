/**
 * ARIES — Per-Worker Authentication Keys
 * Manages individual worker keys stored in data/worker-keys.json
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KEYS_FILE = path.join(__dirname, '..', 'data', 'worker-keys.json');

function loadKeys() {
  try {
    return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveKeys(keys) {
  const dir = path.dirname(KEYS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2));
}

function generateKey(workerId, label) {
  const keys = loadKeys();
  const key = 'aries-wk-' + crypto.randomBytes(24).toString('hex');
  keys[workerId] = {
    key,
    label: label || workerId,
    createdAt: new Date().toISOString(),
    lastSeen: null,
    revoked: false
  };
  saveKeys(keys);
  return { workerId, key, label: keys[workerId].label, createdAt: keys[workerId].createdAt };
}

function revokeKey(workerId) {
  const keys = loadKeys();
  if (!keys[workerId]) return false;
  keys[workerId].revoked = true;
  saveKeys(keys);
  return true;
}

function listKeys() {
  const keys = loadKeys();
  const result = {};
  for (const [wId, entry] of Object.entries(keys)) {
    result[wId] = {
      keyPrefix: entry.key ? entry.key.substring(0, 16) + '...' : '???',
      label: entry.label,
      createdAt: entry.createdAt,
      lastSeen: entry.lastSeen,
      revoked: entry.revoked
    };
  }
  return result;
}

/** Validate a token against both global secret and per-worker keys. Returns workerId or null. */
function validateWorkerAuth(token, globalSecret) {
  if (!token) return null;
  // Check global secret first (backward compatible)
  if (globalSecret && token === globalSecret) return '__global__';
  // Check per-worker keys
  const keys = loadKeys();
  for (const [wId, entry] of Object.entries(keys)) {
    if (entry.revoked) continue;
    if (entry.key === token) {
      // Update lastSeen
      entry.lastSeen = new Date().toISOString();
      try { saveKeys(keys); } catch {}
      return wId;
    }
  }
  return null;
}

module.exports = { generateKey, revokeKey, listKeys, validateWorkerAuth, loadKeys, saveKeys };
