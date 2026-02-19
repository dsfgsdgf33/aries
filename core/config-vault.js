/**
 * ARIES — Config Vault (Encrypted Config at Rest)
 * AES-256-GCM encryption for sensitive config fields.
 * Master key derived from machine-specific data.
 */

const crypto = require('crypto');
const os = require('os');

// Sensitive field names (exact match or substring)
const SENSITIVE_EXACT = ['miner.wallet', 'ariesGateway.anthropicApiKey', 'relay.secret', 'remoteWorkers.secret'];
const SENSITIVE_SUBSTRINGS = ['token', 'key', 'secret', 'password'];

function getMasterKey() {
  const machineId = os.hostname() + os.userInfo().username + os.cpus()[0].model;
  return crypto.createHash('sha256').update(machineId).digest();
}

function isSensitiveKey(keyPath) {
  const lower = keyPath.toLowerCase();
  if (SENSITIVE_EXACT.includes(keyPath)) return true;
  const lastPart = keyPath.split('.').pop().toLowerCase();
  return SENSITIVE_SUBSTRINGS.some(s => lastPart.includes(s));
}

function isEncryptedValue(val) {
  return val && typeof val === 'object' && val.encrypted && val.iv && val.tag;
}

function encryptValue(plaintext) {
  if (plaintext === null || plaintext === undefined || plaintext === '') return plaintext;
  const key = getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const str = typeof plaintext === 'string' ? plaintext : JSON.stringify(plaintext);
  let encrypted = cipher.update(str, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const tag = cipher.getAuthTag();
  return { encrypted, iv: iv.toString('hex'), tag: tag.toString('hex') };
}

function decryptValue(obj) {
  if (!isEncryptedValue(obj)) return obj;
  try {
    const key = getMasterKey();
    const iv = Buffer.from(obj.iv, 'hex');
    const tag = Buffer.from(obj.tag, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(obj.encrypted, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    // Try to parse as JSON (for non-string values)
    try { return JSON.parse(decrypted); } catch { return decrypted; }
  } catch (e) {
    console.error('[CONFIG-VAULT] Decryption failed:', e.message);
    return obj; // Return as-is if decryption fails
  }
}

function walkAndTransform(obj, transform, parentPath) {
  parentPath = parentPath || '';
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    const keyPath = parentPath ? parentPath + '.' + k : k;
    // Skip the security config itself
    if (k === 'security') { result[k] = v; continue; }
    if (v && typeof v === 'object' && !Array.isArray(v) && !isEncryptedValue(v)) {
      result[k] = walkAndTransform(v, transform, keyPath);
    } else if (isSensitiveKey(keyPath) || isEncryptedValue(v)) {
      result[k] = transform(v, keyPath);
    } else {
      result[k] = v;
    }
  }
  return result;
}

function encryptConfig(config) {
  return walkAndTransform(config, (val, keyPath) => {
    if (isEncryptedValue(val)) return val; // Already encrypted
    return encryptValue(val);
  });
}

function decryptConfig(config) {
  return walkAndTransform(config, (val, keyPath) => {
    if (isEncryptedValue(val)) return decryptValue(val);
    return val;
  });
}

function hasEncryptedFields(config) {
  let found = false;
  walkAndTransform(config, (val) => {
    if (isEncryptedValue(val)) found = true;
    return val;
  });
  return found;
}

module.exports = { encryptConfig, decryptConfig, hasEncryptedFields, encryptValue, decryptValue, isSensitiveKey };
