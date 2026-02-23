const fs = require('fs');
const f = require('path').join(__dirname, 'core', 'websocket.js');
let code = fs.readFileSync(f, 'utf8');

// Add console.log to upgrade handler
const marker = "server.on('upgrade', function(req, socket, head) {";
const idx = code.indexOf(marker);
if (idx === -1) { console.log('MARKER NOT FOUND'); process.exit(1); }
const insertPoint = idx + marker.length;
const debug = "\n      console.log('[WS-DEBUG] Upgrade request:', req.url, 'from', req.socket.remoteAddress);";
code = code.slice(0, insertPoint) + debug + code.slice(insertPoint);
fs.writeFileSync(f, code);
console.log('Debug logging added to websocket.js');
