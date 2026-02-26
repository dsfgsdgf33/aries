'use strict';

const DANGEROUS_PATTERNS = [
  /rm\s+(-[a-z]*f[a-z]*\s+)?(-[a-z]*r[a-z]*\s+)?\/(\s|$)/i,
  /rm\s+(-[a-z]*r[a-z]*\s+)?(-[a-z]*f[a-z]*\s+)?\/(\s|$)/i,
  /mkfs\./i,
  /format\s+[a-z]:/i,
  /dd\s+.*of=\/dev\/[sh]d/i,
  />\s*\/dev\/[sh]d/i,
  /chmod\s+(-R\s+)?777\s+\//i,
  /chown\s+(-R\s+)?.*\s+\//i,
  /:(){ :\|:& };:/,
  /fork\s*bomb/i,
  /shutdown/i,
  /reboot/i,
  /init\s+0/i,
  /halt(\s|$)/i,
  /poweroff/i,
  /del\s+\/[sfq]\s+[a-z]:\\/i,
  /rd\s+\/s\s+\/q\s+[a-z]:\\/i,
  /format\s+[a-z]:\s*\/[qy]/i,
  /reg\s+delete\s+hk/i,
  /bcdedit/i,
  /diskpart/i,
  /cipher\s+\/w/i,
  /net\s+user\s+.*\/delete/i,
  /net\s+stop/i,
  /taskkill\s+\/f\s+\/im\s+(csrss|winlogon|lsass|svchost)/i,
];

const WARN_PATTERNS = [
  { pattern: /curl\s+.*\|\s*(ba)?sh/i, reason: 'Piping remote content to shell' },
  { pattern: /wget\s+.*-O\s*-\s*\|\s*(ba)?sh/i, reason: 'Piping remote content to shell' },
  { pattern: /eval\s*\(/i, reason: 'Dynamic eval detected' },
  { pattern: />(>)?\s*\/etc\//i, reason: 'Writing to system config' },
  { pattern: /npm\s+.*--unsafe-perm/i, reason: 'Unsafe npm permissions' },
  { pattern: /Set-ExecutionPolicy\s+Unrestricted/i, reason: 'Unrestricted execution policy' },
];

class ShellValidator {
  constructor() {
    this._whitelist = [];
    this._blacklist = [];
  }

  validate(command) {
    if (!command || typeof command !== 'string') {
      return { safe: false, reason: 'Empty or invalid command' };
    }

    const trimmed = command.trim();
    if (trimmed.length === 0) {
      return { safe: false, reason: 'Empty command' };
    }

    // Check whitelist first (explicit allow)
    for (const entry of this._whitelist) {
      const re = entry instanceof RegExp ? entry : new RegExp(entry, 'i');
      if (re.test(trimmed)) {
        return { safe: true, reason: 'Whitelisted' };
      }
    }

    // Check custom blacklist
    for (const entry of this._blacklist) {
      const re = entry instanceof RegExp ? entry : new RegExp(entry, 'i');
      if (re.test(trimmed)) {
        return { safe: false, reason: `Matches blacklist pattern: ${re.source}` };
      }
    }

    // Check dangerous patterns
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(trimmed)) {
        return { safe: false, reason: `Dangerous pattern detected: ${pattern.source}` };
      }
    }

    // Check warning patterns
    for (const { pattern, reason } of WARN_PATTERNS) {
      if (pattern.test(trimmed)) {
        return { safe: false, reason: `Warning: ${reason}` };
      }
    }

    // Check for excessively long commands (possible injection)
    if (trimmed.length > 4096) {
      return { safe: false, reason: 'Command exceeds maximum length (4096 chars)' };
    }

    // Check for null bytes
    if (trimmed.includes('\0')) {
      return { safe: false, reason: 'Command contains null bytes' };
    }

    return { safe: true, reason: 'Passed all checks' };
  }

  addToWhitelist(pattern) {
    if (!pattern) throw new Error('Pattern required');
    this._whitelist.push(pattern instanceof RegExp ? pattern : String(pattern));
  }

  addToBlacklist(pattern) {
    if (!pattern) throw new Error('Pattern required');
    this._blacklist.push(pattern instanceof RegExp ? pattern : String(pattern));
  }

  getWhitelist() { return [...this._whitelist]; }
  getBlacklist() { return [...this._blacklist]; }

  clearWhitelist() { this._whitelist = []; }
  clearBlacklist() { this._blacklist = []; }
}

const instance = new ShellValidator();

module.exports = {
  validate: (cmd) => instance.validate(cmd),
  addToWhitelist: (p) => instance.addToWhitelist(p),
  addToBlacklist: (p) => instance.addToBlacklist(p),
  getWhitelist: () => instance.getWhitelist(),
  getBlacklist: () => instance.getBlacklist(),
  clearWhitelist: () => instance.clearWhitelist(),
  clearBlacklist: () => instance.clearBlacklist(),
  ShellValidator,
};
