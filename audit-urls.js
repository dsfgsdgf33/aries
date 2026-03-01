const fs = require('fs');
const app = fs.readFileSync('web/app.js', 'utf8');
const idx = fs.readFileSync('web/index.html', 'utf8');
const combined = app + idx;

// Find all fetch('/api/...') and api('GET', '/api/...') calls
const urls = new Set();
const re1 = /fetch\(['`]([^'`]+)['`]/g;
const re2 = /api\(['"](?:GET|POST|PUT|DELETE)['"],\s*['"]([^'"]+)['"]/g;

let m;
while (m = re1.exec(combined)) { if (m[1].startsWith('/api')) urls.add(m[1]); }
while (m = re2.exec(combined)) { if (m[1].startsWith('/api')) urls.add(m[1]); }

const sorted = [...urls].sort();
sorted.forEach(u => console.log(u));
