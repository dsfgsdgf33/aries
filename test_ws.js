const http = require('http');
const crypto = require('crypto');

const key = crypto.randomBytes(16).toString('base64');
const req = http.request({
  host: '127.0.0.1',
  port: 3333,
  path: '/ws',
  method: 'GET',
  headers: {
    'Upgrade': 'websocket',
    'Connection': 'Upgrade',
    'Sec-WebSocket-Key': key,
    'Sec-WebSocket-Version': '13'
  }
});

req.on('upgrade', (res, socket) => {
  console.log('WS connected!');
  socket.on('data', buf => {
    // Parse WS frame
    let offset = 2;
    const masked = (buf[1] & 0x80) !== 0;
    let len = buf[1] & 0x7f;
    if (len === 126) { len = buf.readUInt16BE(2); offset = 4; }
    else if (len === 127) { offset = 10; len = Number(buf.readBigUInt64BE(2)); }
    if (masked) offset += 4;
    const data = buf.slice(offset, offset + len);
    try {
      const msg = JSON.parse(data.toString('utf8'));
      console.log('Got:', msg.type, JSON.stringify(msg.data).substring(0, 100));
    } catch(e) {
      console.log('Raw:', data.toString('utf8').substring(0, 100));
    }
  });
  setTimeout(() => { console.log('Done'); process.exit(0); }, 3000);
});

req.on('error', e => { console.log('Error:', e.message); process.exit(1); });
req.end();
