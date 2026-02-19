/**
 * ARIES Plugin: File Manager
 * Advanced file operations: tree, find, diff, zip.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

module.exports = {
  name: 'file-manager',
  description: 'Advanced file ops: tree, find, size, recent. Usage: command args',
  version: '1.0.0',

  async execute(args) {
    const [cmd, ...rest] = args.trim().split(/\s+/);
    const arg = rest.join(' ');

    switch (cmd) {
      case 'tree': {
        const dir = arg || '.';
        try {
          const output = execSync(`tree "${dir}" /F /A`, { encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] });
          return output.substring(0, 4000);
        } catch (e) { return `Error: ${e.message}`; }
      }
      case 'find': {
        const [dir, pattern] = arg.split(' ', 2);
        try {
          const output = execSync(`dir /S /B "${dir || '.'}" | findstr /I "${pattern || '*'}"`, { encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] });
          return output.substring(0, 4000);
        } catch { return 'No matches found'; }
      }
      case 'size': {
        const target = arg || '.';
        try {
          const stat = fs.statSync(target);
          if (stat.isFile()) return `${target}: ${(stat.size / 1024).toFixed(1)} KB`;
          const output = execSync(`powershell -c "(Get-ChildItem '${target}' -Recurse | Measure-Object -Property Length -Sum).Sum"`, { encoding: 'utf8', timeout: 10000 });
          const bytes = parseInt(output.trim());
          return `${target}: ${(bytes / 1048576).toFixed(1)} MB`;
        } catch (e) { return `Error: ${e.message}`; }
      }
      case 'recent': {
        const dir = arg || '.';
        try {
          const output = execSync(`powershell -c "Get-ChildItem '${dir}' -Recurse -File | Sort LastWriteTime -Desc | Select -First 10 | Format-Table Name, LastWriteTime, Length -Auto"`, { encoding: 'utf8', timeout: 10000 });
          return output.trim();
        } catch (e) { return `Error: ${e.message}`; }
      }
      default:
        return 'Commands: tree [dir], find [dir] [pattern], size [path], recent [dir]';
    }
  }
};
