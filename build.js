#!/usr/bin/env node
/**
 * ARIES Build Script — Obfuscate critical modules
 * No npm dependencies. Pure Node.js.
 * 
 * Usage: node build.js
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CRITICAL_FILES = [
  'core/tier-system.js',
  'core/referral-system.js',
  'core/integrity.js',
];

// Strings to encode as hex/base64 at runtime
const SENSITIVE_STRINGS = [
  'free', 'contributor', 'pro', 'Pro', 'Contributor', 'Free',
  'everything', 'priority-swarm', 'swarm-intelligence',
  'tier-state.json', '.integrity',
  'Feature locked', 'Unauthorized',
];

function removeComments(code) {
  // Remove single-line comments (but not URLs with //)
  code = code.replace(/(?<!:)\/\/(?!\/)[^\n]*/g, '');
  // Remove multi-line comments
  code = code.replace(/\/\*[\s\S]*?\*\//g, '');
  return code;
}

function minify(code) {
  // Remove empty lines and excess whitespace
  return code
    .split('\n')
    .map(l => l.trimEnd())
    .filter(l => l.trim().length > 0)
    .join('\n');
}

function encodeStrings(code) {
  for (const str of SENSITIVE_STRINGS) {
    // Encode as hex decode at runtime
    const hex = Buffer.from(str).toString('hex');
    const replacement = `Buffer.from('${hex}','hex').toString()`;
    // Only replace string literals, not property names
    const escaped = str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    code = code.replace(new RegExp(`'${escaped}'`, 'g'), replacement);
    code = code.replace(new RegExp(`"${escaped}"`, 'g'), replacement);
  }
  return code;
}

function renameVariables(code) {
  // Simple variable renaming for local vars
  const varMap = {};
  let counter = 0;
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  
  function nextVar() {
    let name = '';
    let n = counter++;
    do {
      name = chars[n % chars.length] + name;
      n = Math.floor(n / chars.length) - 1;
    } while (n >= 0);
    return '_' + name;
  }

  // Find local variable declarations
  const varRegex = /\b(let|var|const)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
  let match;
  const localVars = new Set();
  while ((match = varRegex.exec(code)) !== null) {
    const name = match[2];
    // Don't rename common/exported names
    if (['module', 'exports', 'require', 'process', 'console', 'fs', 'path', 'crypto',
         'Buffer', 'JSON', 'Date', 'Math', 'Error', 'Promise', 'Set', 'Map',
         'TierSystem', 'TIERS', 'ReferralSystem'].includes(name)) continue;
    if (name.length > 2) localVars.add(name);
  }

  for (const v of localVars) {
    const newName = nextVar();
    varMap[v] = newName;
    const re = new RegExp(`\\b${v}\\b`, 'g');
    code = code.replace(re, newName);
  }

  return code;
}

function obfuscateFile(filePath) {
  console.log(`[BUILD] Obfuscating ${filePath}...`);
  let code = fs.readFileSync(filePath, 'utf8');
  
  // Store original for hash
  const originalHash = crypto.createHash('sha256').update(code).digest('hex');
  
  code = removeComments(code);
  code = minify(code);
  code = encodeStrings(code);
  // Note: variable renaming is risky for modules with exports, skip for safety
  // code = renameVariables(code);
  
  // Add header
  const header = `// ARIES v5.4 — Protected Module\n// Integrity: ${originalHash.substring(0, 16)}\n`;
  code = header + code;
  
  fs.writeFileSync(filePath, code);
  console.log(`[BUILD] ✓ ${filePath} obfuscated`);
  
  return { file: path.basename(filePath), hash: originalHash };
}

function generateIntegrityHashes() {
  console.log('[BUILD] Generating integrity hashes...');
  const hashes = {};
  for (const file of CRITICAL_FILES) {
    const filePath = path.join(__dirname, file);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      hashes[path.basename(file)] = crypto.createHash('sha256').update(content).digest('hex');
    }
  }
  
  const hashFile = path.join(__dirname, 'data', '.integrity');
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(hashFile, Buffer.from(JSON.stringify(hashes)).toString('base64'));
  console.log('[BUILD] ✓ Integrity hashes generated');
}

// Main
console.log('═══════════════════════════════════════');
console.log('  ARIES Build — Code Protection');
console.log('═══════════════════════════════════════\n');

const results = [];
for (const file of CRITICAL_FILES) {
  const filePath = path.join(__dirname, file);
  if (fs.existsSync(filePath)) {
    results.push(obfuscateFile(filePath));
  } else {
    console.log(`[BUILD] ⚠ ${file} not found, skipping`);
  }
}

// Generate integrity hashes AFTER obfuscation
generateIntegrityHashes();

console.log('\n[BUILD] ✓ Build complete.');
console.log('[BUILD] Obfuscated files:', results.map(r => r.file).join(', '));
