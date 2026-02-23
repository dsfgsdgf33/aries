const fs = require('fs');
const f = require('path').join(__dirname, 'core', 'websocket.js');
let code = fs.readFileSync(f, 'utf8');

// Add debug to socket data handler
const marker = "socket.on('data', function(buf) {";
const idx = code.indexOf(marker);
if (idx === -1) { console.log('MARKER NOT FOUND'); process.exit(1); }
const insertPoint = idx + marker.length;
const debug = "\n          console.log('[WS-DEBUG] Data received:', buf.length, 'bytes, opcode guess:', (buf[0] & 0x0f));";
code = code.slice(0, insertPoint) + debug + code.slice(insertPoint);

// Add debug to socket close/error  
const closeMarker = "socket.on('close', function() { self._clients.delete(clientId); });";
const closeIdx = code.indexOf(closeMarker);
if (closeIdx !== -1) {
  code = code.replace(closeMarker, "socket.on('close', function() { console.log('[WS-DEBUG] Client', clientId, 'socket closed'); self._clients.delete(clientId); });");
}

const errMarker = "socket.on('error', function() { self._clients.delete(clientId); });";
const errIdx = code.indexOf(errMarker);
if (errIdx !== -1) {
  code = code.replace(errMarker, "socket.on('error', function(e) { console.log('[WS-DEBUG] Client', clientId, 'socket error:', e.message); self._clients.delete(clientId); });");
}

// Add debug after handshake
const handshakeMarker = "self._clients.set(clientId, client);";
const hIdx = code.indexOf(handshakeMarker);
if (hIdx !== -1) {
  code = code.replace(handshakeMarker, handshakeMarker + "\n        console.log('[WS-DEBUG] Client', clientId, 'connected, total clients:', self._clients.size);");
}

fs.writeFileSync(f, code);
console.log('Debug v2 added');
