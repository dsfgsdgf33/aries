const fs = require('fs');
const f = require('path').join(__dirname, 'core', 'websocket.js');
let code = fs.readFileSync(f, 'utf8');

// Make the catch block log errors
code = code.replace(
  /} catch \(e\) \{\s*try \{ socket\.destroy\(\); \} catch \(\) \{\}\s*\}/,
  '} catch (e) { console.error("[WS-DEBUG] UPGRADE ERROR:", e.stack || e.message); try { socket.destroy(); } catch {} }'
);

fs.writeFileSync(f, code);
console.log('Error logging patched');
