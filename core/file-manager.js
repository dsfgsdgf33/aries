/**
 * ARIES v5.0 — Remote File Manager
 * Browse, read, write, delete, move, search, zip files
 */
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const zlib = require('zlib');
const url = require('url');

class FileManager {
  constructor() { this.refs = null; }
  start(refs) { this.refs = refs; }

  listDir(dirPath) {
    const p = dirPath || process.cwd();
    try {
      const entries = fs.readdirSync(p, { withFileTypes: true });
      return entries.map(e => ({
        name: e.name, isDir: e.isDirectory(),
        size: e.isFile() ? (fs.statSync(path.join(p, e.name)).size) : 0,
        modified: fs.statSync(path.join(p, e.name)).mtimeMs
      })).sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name));
    } catch (e) { return []; }
  }

  readFile(filePath) {
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > 10 * 1024 * 1024) return { error: 'File too large (>10MB)' };
      return { content: fs.readFileSync(filePath, 'utf8'), size: stat.size };
    } catch (e) { return { error: e.message }; }
  }

  writeFile(filePath, content) {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, content);
      return { ok: true };
    } catch (e) { return { error: e.message }; }
  }

  mkdir(dirPath) {
    try { fs.mkdirSync(dirPath, { recursive: true }); return { ok: true }; }
    catch (e) { return { error: e.message }; }
  }

  deleteFile(filePath) {
    try {
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) fs.rmSync(filePath, { recursive: true, force: true });
      else fs.unlinkSync(filePath);
      return { ok: true };
    } catch (e) { return { error: e.message }; }
  }

  moveFile(from, to) {
    try { fs.renameSync(from, to); return { ok: true }; }
    catch (e) { return { error: e.message }; }
  }

  search(dir, pattern, content) {
    const results = [];
    const maxResults = 100;
    const regex = pattern ? new RegExp(pattern, 'i') : null;
    const contentRegex = content ? new RegExp(content, 'i') : null;

    function walk(d, depth) {
      if (depth > 5 || results.length >= maxResults) return;
      try {
        const entries = fs.readdirSync(d, { withFileTypes: true });
        for (const e of entries) {
          if (results.length >= maxResults) break;
          const full = path.join(d, e.name);
          if (e.isDirectory()) {
            if (regex && regex.test(e.name)) results.push({ path: full, isDir: true });
            walk(full, depth + 1);
          } else {
            if (regex && regex.test(e.name)) results.push({ path: full, isDir: false });
            else if (contentRegex) {
              try {
                const txt = fs.readFileSync(full, 'utf8').slice(0, 50000);
                if (contentRegex.test(txt)) results.push({ path: full, isDir: false, match: 'content' });
              } catch {}
            }
          }
        }
      } catch {}
    }
    walk(dir || process.cwd(), 0);
    return results;
  }

  createZip(files, output) {
    return new Promise((resolve, reject) => {
      // Use PowerShell Compress-Archive
      const fileList = files.map(f => `'${f}'`).join(',');
      exec(`powershell -NoProfile -Command "Compress-Archive -Path ${fileList} -DestinationPath '${output}' -Force"`, { timeout: 30000 }, (err) => {
        if (err) return reject(err);
        resolve({ ok: true, output });
      });
    });
  }

  registerRoutes(addRoute) {
    addRoute('GET', '/api/files', (req, res, json) => {
      const parsed = url.parse(req.url, true);
      json(res, 200, { ok: true, path: parsed.query.path || process.cwd(), files: this.listDir(parsed.query.path) });
    });
    addRoute('GET', '/api/files/read', (req, res, json) => {
      const parsed = url.parse(req.url, true);
      const result = this.readFile(parsed.query.path);
      json(res, result.error ? 400 : 200, result);
    });
    addRoute('POST', '/api/files/write', (req, res, json, body) => {
      try {
        const data = JSON.parse(body);
        json(res, 200, this.writeFile(data.path, data.content));
      } catch (e) { json(res, 400, { error: e.message }); }
    });
    addRoute('POST', '/api/files/mkdir', (req, res, json, body) => {
      try {
        const data = JSON.parse(body);
        json(res, 200, this.mkdir(data.path));
      } catch (e) { json(res, 400, { error: e.message }); }
    });
    addRoute('DELETE', '/api/files', (req, res, json) => {
      const parsed = url.parse(req.url, true);
      json(res, 200, this.deleteFile(parsed.query.path));
    });
    addRoute('POST', '/api/files/move', (req, res, json, body) => {
      try {
        const data = JSON.parse(body);
        json(res, 200, this.moveFile(data.from, data.to));
      } catch (e) { json(res, 400, { error: e.message }); }
    });
    addRoute('POST', '/api/files/search', (req, res, json, body) => {
      try {
        const data = JSON.parse(body);
        json(res, 200, { ok: true, results: this.search(data.dir, data.pattern, data.content) });
      } catch (e) { json(res, 400, { error: e.message }); }
    });
    addRoute('GET', '/api/files/download', (req, res, json) => {
      const parsed = url.parse(req.url, true);
      const fp = parsed.query.path;
      try {
        const stat = fs.statSync(fp);
        if (stat.size > 100 * 1024 * 1024) return json(res, 400, { error: 'Too large' });
        const data = fs.readFileSync(fp);
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${path.basename(fp)}"`,
          'Content-Length': data.length,
          'Access-Control-Allow-Origin': '*'
        });
        res.end(data);
      } catch (e) { json(res, 404, { error: e.message }); }
    });
    addRoute('POST', '/api/files/zip', async (req, res, json, body) => {
      try {
        const data = JSON.parse(body);
        const result = await this.createZip(data.files, data.output);
        json(res, 200, result);
      } catch (e) { json(res, 500, { error: e.message }); }
    });
  }
}

module.exports = { FileManager };
