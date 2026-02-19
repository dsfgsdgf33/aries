// Aries Swarm Relay Agent v1.0
// Deployed to remote VMs — listens on configurable port, executes tasks, returns results
// Auth via shared secret in x-relay-secret header

const http = require('http');
const { exec } = require('child_process');
const os = require('os');

const PORT = %%PORT%%;
const SECRET = '%%SECRET%%';

function readBody(req) {
  return new Promise(function(resolve, reject) {
    var data = '';
    req.on('data', function(c) {
      data += c;
      if (data.length > 1024 * 1024) { req.destroy(); reject(new Error('Body too large')); }
    });
    req.on('end', function() { resolve(data); });
    req.on('error', reject);
  });
}

var taskCount = 0;
var startTime = Date.now();

var server = http.createServer(async function(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Auth check
  if (req.headers['x-relay-secret'] !== SECRET) {
    res.writeHead(401);
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  // Health endpoint
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({
      status: 'ok',
      uptime: Math.floor((Date.now() - startTime) / 1000),
      taskCount: taskCount,
      hostname: os.hostname(),
      platform: os.platform(),
      cpus: os.cpus().length,
      memFree: os.freemem(),
      memTotal: os.totalmem()
    }));
    return;
  }

  // Task execution endpoint
  if (req.method === 'POST' && req.url === '/task') {
    try {
      var body = JSON.parse(await readBody(req));
      var code = body.code || 'echo "no code provided"';
      var timeout = Math.min(body.timeout || 30000, 120000); // Max 2 minutes
      taskCount++;

      exec(code, {
        timeout: timeout,
        maxBuffer: 5 * 1024 * 1024,
        env: Object.assign({}, process.env, { ARIES_RELAY: '1' })
      }, function(err, stdout, stderr) {
        res.writeHead(200);
        res.end(JSON.stringify({
          stdout: (stdout || '').substring(0, 100000),
          stderr: (stderr || '').substring(0, 50000),
          error: err ? err.message : null,
          exitCode: err ? (err.code || 1) : 0,
          killed: err ? !!err.killed : false,
          taskId: taskCount
        }));
      });
    } catch (e) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Status endpoint
  if (req.method === 'GET' && req.url === '/api/status') {
    res.writeHead(200);
    res.end(JSON.stringify({
      version: '1.0.0',
      uptime: Math.floor((Date.now() - startTime) / 1000),
      taskCount: taskCount,
      workers: {},
      completed: taskCount,
      failed: 0
    }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '0.0.0.0', function() {
  console.log('[ARIES RELAY] Listening on port ' + PORT);
  console.log('[ARIES RELAY] Host: ' + os.hostname());
  console.log('[ARIES RELAY] CPUs: ' + os.cpus().length);
});

server.on('error', function(err) {
  console.error('[ARIES RELAY] Server error:', err.message);
  if (err.code === 'EADDRINUSE') {
    console.error('[ARIES RELAY] Port ' + PORT + ' already in use. Exiting.');
    process.exit(1);
  }
});

process.on('uncaughtException', function(err) {
  console.error('[ARIES RELAY] Uncaught:', err.message);
});

process.on('SIGTERM', function() {
  console.log('[ARIES RELAY] Shutting down...');
  server.close(function() { process.exit(0); });
});
