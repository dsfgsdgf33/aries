#!/usr/bin/env node
// ARIES Build System — Creates obfuscated distribution
// Usage: node scripts/build-dist.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const LICENSE_HEADER = '// ARIES v8.2 - Proprietary. Unauthorized copying prohibited.\n// Copyright (c) 2024-2026 Aries Project. All rights reserved.\n';

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyRecursive(src, dest, filter) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    ensureDir(dest);
    for (const item of fs.readdirSync(src)) {
      if (item === 'node_modules' || item === '.git' || item === 'dist' || item === 'data' || item === 'config') continue;
      copyRecursive(path.join(src, item), path.join(dest, item), filter);
    }
  } else {
    if (filter && !filter(src)) return;
    fs.copyFileSync(src, dest);
  }
}

function stripComments(code) {
  // Remove single-line comments (but not URLs with //)
  let result = code.replace(/(?<!:)\/\/(?!\/)[^\n]*/g, '');
  // Remove multi-line comments
  result = result.replace(/\/\*[\s\S]*?\*\//g, '');
  return result;
}

function minify(code) {
  let result = stripComments(code);
  // Collapse multiple blank lines into one
  result = result.replace(/\n{3,}/g, '\n\n');
  // Remove trailing whitespace
  result = result.replace(/[ \t]+$/gm, '');
  return result.trim();
}

function obfuscateCore(code, filePath) {
  // For core JS files: base64 encode and wrap in eval
  const minified = minify(code);
  const encoded = Buffer.from(minified).toString('base64');
  return LICENSE_HEADER + `(function(){eval(Buffer.from('${encoded}','base64').toString())})();\n`;
}

function obfuscateWeb(code) {
  // For web files: just minify (browser needs to parse directly)
  return LICENSE_HEADER + minify(code) + '\n';
}

// Clean dist
if (fs.existsSync(DIST)) {
  fs.rmSync(DIST, { recursive: true, force: true });
}

console.log('[ARIES BUILD] Creating distribution...');

// Copy everything
copyRecursive(ROOT, DIST);

// Obfuscate core/*.js files
const coreDir = path.join(DIST, 'core');
if (fs.existsSync(coreDir)) {
  const processDir = (dir) => {
    for (const file of fs.readdirSync(dir)) {
      const full = path.join(dir, file);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        processDir(full);
      } else if (file.endsWith('.js')) {
        console.log(`  [obfuscate] ${path.relative(DIST, full)}`);
        const code = fs.readFileSync(full, 'utf8');
        fs.writeFileSync(full, obfuscateCore(code, full));
      }
    }
  };
  processDir(coreDir);
}

// Obfuscate web/app.js
const webApp = path.join(DIST, 'web', 'app.js');
if (fs.existsSync(webApp)) {
  console.log('  [minify] web/app.js');
  const code = fs.readFileSync(webApp, 'utf8');
  fs.writeFileSync(webApp, obfuscateWeb(code));
}

// Obfuscate launcher.js
const launcher = path.join(DIST, 'launcher.js');
if (fs.existsSync(launcher)) {
  console.log('  [obfuscate] launcher.js');
  const code = fs.readFileSync(launcher, 'utf8');
  fs.writeFileSync(launcher, obfuscateCore(code, launcher));
}

// Count files
let jsCount = 0;
const countJs = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) countJs(full);
    else if (f.endsWith('.js')) jsCount++;
  }
};
countJs(DIST);

console.log(`\n[ARIES BUILD] ✅ Distribution created in dist/`);
console.log(`  ${jsCount} JS files obfuscated`);
console.log(`  Ready for release.`);
