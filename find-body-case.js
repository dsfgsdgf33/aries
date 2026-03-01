const fs = require('fs');
const app = fs.readFileSync('web/app.js', 'utf8');
const idx = app.indexOf("case 'body'");
if (idx === -1) { console.log('NOT FOUND'); process.exit(); }
const snippet = app.slice(idx, idx + 300);
console.log(snippet);
