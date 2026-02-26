'use strict';

const { exec: cpExec, spawn } = require('child_process');

const config = {
  defaultTimeout: 30000,
  maxTimeout: 300000,
  killSignal: 'SIGTERM',
  killGracePeriod: 2000,
  shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
};

function exec(command, timeoutMs) {
  const timeout = Math.min(
    Math.max(timeoutMs || config.defaultTimeout, 100),
    config.maxTimeout
  );

  return new Promise((resolve) => {
    let timedOut = false;
    let stdout = '';
    let stderr = '';

    const child = cpExec(command, {
      timeout: 0, // we manage timeout ourselves
      shell: config.shell,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
        } else {
          child.kill(config.killSignal);
          setTimeout(() => {
            try { child.kill('SIGKILL'); } catch (_) {}
          }, config.killGracePeriod);
        }
      } catch (_) {}
    }, timeout);

    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        stdout: stdout.trimEnd(),
        stderr: stderr.trimEnd(),
        code,
        timedOut,
        duration: undefined, // caller can measure
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr: stderr || err.message,
        code: -1,
        timedOut,
        error: err.message,
      });
    });
  });
}

function getConfig() {
  return { ...config };
}

function setConfig(opts) {
  if (!opts || typeof opts !== 'object') throw new Error('Options object required');
  if (opts.defaultTimeout != null) config.defaultTimeout = Number(opts.defaultTimeout);
  if (opts.maxTimeout != null) config.maxTimeout = Number(opts.maxTimeout);
  if (opts.killSignal != null) config.killSignal = String(opts.killSignal);
  if (opts.killGracePeriod != null) config.killGracePeriod = Number(opts.killGracePeriod);
  if (opts.shell != null) config.shell = String(opts.shell);
}

module.exports = { exec, getConfig, setConfig };
