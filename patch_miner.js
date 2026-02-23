const fs = require('fs');
const f = require('path').join(__dirname, 'core', 'api-server.js');
let code = fs.readFileSync(f, 'utf8');

// Add miner.enabled check to auto-resume
code = code.replace(
  "if (savedState && savedState.mining) {",
  "if (savedState && savedState.mining && cfg.miner && cfg.miner.enabled !== false) {"
);

fs.writeFileSync(f, code);
console.log('Miner auto-resume now respects config.miner.enabled');
