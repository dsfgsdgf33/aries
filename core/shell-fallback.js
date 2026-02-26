'use strict';

const { execSync, exec: cpExec } = require('child_process');

const strategies = new Map();

function execPromise(cmd, shell) {
  return new Promise((resolve, reject) => {
    cpExec(cmd, { shell, maxBuffer: 10 * 1024 * 1024, windowsHide: true, timeout: 30000 }, (err, stdout, stderr) => {
      if (err) {
        const e = new Error(err.message);
        e.stdout = stdout;
        e.stderr = stderr;
        e.code = err.code;
        reject(e);
      } else {
        resolve({ stdout: stdout.trimEnd(), stderr: stderr.trimEnd(), code: 0 });
      }
    });
  });
}

// Default strategies
strategies.set('powershell', {
  name: 'powershell',
  available: process.platform === 'win32',
  priority: 1,
  exec: (cmd) => execPromise(cmd, 'powershell.exe'),
});

strategies.set('cmd', {
  name: 'cmd',
  available: process.platform === 'win32',
  priority: 2,
  exec: (cmd) => execPromise(cmd, 'cmd.exe'),
});

strategies.set('sh', {
  name: 'sh',
  available: process.platform !== 'win32',
  priority: 1,
  exec: (cmd) => execPromise(cmd, '/bin/sh'),
});

strategies.set('bash', {
  name: 'bash',
  available: process.platform !== 'win32',
  priority: 2,
  exec: (cmd) => execPromise(cmd, '/bin/bash'),
});

strategies.set('node-eval', {
  name: 'node-eval',
  available: true,
  priority: 10,
  exec: (cmd) => {
    return new Promise((resolve, reject) => {
      try {
        // Only for simple commands we can translate
        const child = require('child_process').spawn(process.execPath, ['-e', cmd], {
          windowsHide: true,
          timeout: 30000,
        });
        let stdout = '', stderr = '';
        child.stdout.on('data', (d) => { stdout += d; });
        child.stderr.on('data', (d) => { stderr += d; });
        child.on('close', (code) => {
          if (code !== 0) reject(new Error(`Exit code ${code}: ${stderr}`));
          else resolve({ stdout: stdout.trimEnd(), stderr: stderr.trimEnd(), code: 0 });
        });
        child.on('error', reject);
      } catch (e) {
        reject(e);
      }
    });
  },
});

async function exec(command) {
  const sorted = [...strategies.values()]
    .filter(s => s.available)
    .sort((a, b) => a.priority - b.priority);

  const errors = [];

  for (const strategy of sorted) {
    try {
      const result = await strategy.exec(command);
      return {
        ...result,
        strategy: strategy.name,
        attempts: errors.length + 1,
      };
    } catch (err) {
      errors.push({ strategy: strategy.name, error: err.message });
    }
  }

  return {
    stdout: '',
    stderr: errors.map(e => `[${e.strategy}] ${e.error}`).join('\n'),
    code: -1,
    strategy: null,
    attempts: errors.length,
    failed: true,
    errors,
  };
}

function getStrategies() {
  return [...strategies.values()].map(s => ({
    name: s.name,
    available: s.available,
    priority: s.priority,
  }));
}

function addStrategy(name, fn, opts = {}) {
  if (!name || typeof fn !== 'function') throw new Error('Name and function required');
  strategies.set(name, {
    name,
    available: opts.available !== false,
    priority: opts.priority || 5,
    exec: fn,
  });
}

module.exports = { exec, getStrategies, addStrategy };
