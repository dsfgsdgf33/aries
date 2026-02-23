const fs = require('fs');
const f = require('path').join(__dirname, 'core', 'headless.js');
let code = fs.readFileSync(f, 'utf8');

// Comment out the extension bridge upgrade handler
code = code.replace(
  "server.on('upgrade', (req, socket, head) => {\n      try {\n        const pathname = new (require('url').URL)(req.url, 'http://localhost').pathname;\n        if (pathname === '/ext') {",
  "// DISABLED: Extension bridge causes WS issues\n    // server.on('upgrade', (req, socket, head) => {\n    //   try {\n    //     const pathname = new (require('url').URL)(req.url, 'http://localhost').pathname;\n    //     if (pathname === '/ext') {"
);

// Try CRLF version too
code = code.replace(
  "server.on('upgrade', (req, socket, head) => {\r\n      try {\r\n        const pathname = new (require('url').URL)(req.url, 'http://localhost').pathname;\r\n        if (pathname === '/ext') {",
  "// DISABLED: Extension bridge causes WS issues\r\n    // server.on('upgrade', (req, socket, head) => {\r\n    //   try {\r\n    //     const pathname = new (require('url').URL)(req.url, 'http://localhost').pathname;\r\n    //     if (pathname === '/ext') {"
);

fs.writeFileSync(f, code);
console.log('Extension bridge disabled');
