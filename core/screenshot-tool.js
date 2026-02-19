/**
 * ARIES v5.0 — Screenshot Tool
 * Remote screenshot & screen capture via PowerShell
 */
const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class ScreenshotTool {
  constructor() {
    this.dataDir = path.join(__dirname, '..', 'data', 'screenshots');
    this.refs = null;
  }

  start(refs) {
    this.refs = refs;
    if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
  }

  capture() {
    return new Promise((resolve, reject) => {
      const filename = `screenshot-${Date.now()}.png`;
      const filepath = path.join(this.dataDir, filename);
      const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$gfx = [System.Drawing.Graphics]::FromImage($bmp)
$gfx.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$gfx.Dispose()
$bmp.Save('${filepath.replace(/\\/g, '\\\\')}')
$bmp.Dispose()
$bytes = [System.IO.File]::ReadAllBytes('${filepath.replace(/\\/g, '\\\\')}')
[Convert]::ToBase64String($bytes)
`.trim();
      exec(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"').replace(/\n/g, '; ')}"`, { maxBuffer: 50 * 1024 * 1024, timeout: 15000 }, (err, stdout, stderr) => {
        if (err) return reject(err);
        resolve({ filename, path: filepath, base64: stdout.trim(), timestamp: Date.now() });
      });
    });
  }

  captureWorkers() {
    // Request screenshots from swarm workers via relay
    const refs = this.refs;
    if (!refs) return Promise.resolve([]);
    // Placeholder — would broadcast to workers
    return Promise.resolve([]);
  }

  list() {
    try {
      return fs.readdirSync(this.dataDir)
        .filter(f => f.endsWith('.png'))
        .map(f => ({ name: f, path: path.join(this.dataDir, f), time: fs.statSync(path.join(this.dataDir, f)).mtimeMs }))
        .sort((a, b) => b.time - a.time)
        .slice(0, 50);
    } catch { return []; }
  }

  registerRoutes(addRoute) {
    addRoute('GET', '/api/screenshot', async (req, res, json) => {
      try {
        const result = await this.capture();
        json(res, 200, { ok: true, filename: result.filename, base64: result.base64, timestamp: result.timestamp });
      } catch (e) { json(res, 500, { error: e.message }); }
    });

    addRoute('GET', '/api/screenshot/list', (req, res, json) => {
      json(res, 200, { ok: true, screenshots: this.list() });
    });

    addRoute('GET', '/api/screenshot/workers', async (req, res, json) => {
      const results = await this.captureWorkers();
      json(res, 200, { ok: true, results });
    });
  }
}

module.exports = { ScreenshotTool };
