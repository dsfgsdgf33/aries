// Test if upgrade events fire on the api-server's HTTP server
const http = require('http');

const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('ok');
});

server.on('upgrade', (req, socket, head) => {
  console.log('UPGRADE EVENT:', req.url, req.headers['sec-websocket-key'] ? 'has ws key' : 'no ws key');
  const crypto = require('crypto');
  const GUID = '258EAFA5-E914-47DA-95CA-5AB5DC786616';
  const wsKey = req.headers['sec-websocket-key'];
  const accept = crypto.createHash('sha1').update(wsKey + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );
  console.log('Handshake sent');
  
  // Send a test message
  const msg = JSON.stringify({ type: 'test', data: 'hello' });
  const buf = Buffer.from(msg);
  const frame = Buffer.alloc(2 + buf.length);
  frame[0] = 0x81;
  frame[1] = buf.length;
  buf.copy(frame, 2);
  socket.write(frame);
  console.log('Test message sent');
});

server.listen(9999, '127.0.0.1', () => {
  console.log('Test server on 9999 — open http://127.0.0.1:9999 in browser and run:');
  console.log('  new WebSocket("ws://127.0.0.1:9999/ws")');
  setTimeout(() => { server.close(); process.exit(0); }, 10000);
});
