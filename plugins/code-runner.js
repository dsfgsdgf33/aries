/**
 * ARIES Plugin: Code Runner
 * Execute code snippets in various languages.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

module.exports = {
  name: 'code-runner',
  description: 'Execute code snippets (js, python, powershell). Usage: lang:code',
  version: '1.0.0',

  async execute(args) {
    const match = args.match(/^(\w+):([\s\S]+)$/);
    if (!match) return 'Usage: lang:code (e.g., js:console.log("hello"))';

    const lang = match[1].toLowerCase();
    const code = match[2].trim();
    const tmpDir = path.join(os.tmpdir(), 'aries-runner');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const runners = {
      js: { ext: '.js', cmd: (f) => `node "${f}"` },
      javascript: { ext: '.js', cmd: (f) => `node "${f}"` },
      python: { ext: '.py', cmd: (f) => `python "${f}"` },
      py: { ext: '.py', cmd: (f) => `python "${f}"` },
      powershell: { ext: '.ps1', cmd: (f) => `powershell -NoProfile -File "${f}"` },
      ps1: { ext: '.ps1', cmd: (f) => `powershell -NoProfile -File "${f}"` },
      bat: { ext: '.bat', cmd: (f) => `"${f}"` },
    };

    const runner = runners[lang];
    if (!runner) return `Unsupported language: ${lang}. Supported: ${Object.keys(runners).join(', ')}`;

    const tmpFile = path.join(tmpDir, `run${runner.ext}`);
    fs.writeFileSync(tmpFile, code);

    try {
      const output = execSync(runner.cmd(tmpFile), {
        encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return output.trim() || '(no output)';
    } catch (e) {
      return `Error: ${e.stderr || e.message}`;
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  }
};
