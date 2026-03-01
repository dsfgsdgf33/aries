const fs = require('fs');
const idx = fs.readFileSync('web/index.html', 'utf8');
const app = fs.readFileSync('web/app.js', 'utf8');

// Nav items
const navRe = /data-panel="([^"]+)"/g;
const navPanels = new Set();
let m;
while (m = navRe.exec(idx)) navPanels.add(m[1]);

// Panel sections in HTML
const sectionRe = /id="panel-([^"]+)"/g;
const sections = new Set();
while (m = sectionRe.exec(idx)) sections.add(m[1]);

// loadPanelData cases in app.js
const caseRe = /case '([^']+)'/g;
const cases = new Set();
while (m = caseRe.exec(app)) cases.add(m[1]);

console.log('Nav items:', navPanels.size);
console.log('HTML sections:', sections.size);
console.log('app.js cases:', cases.size);

console.log('\n--- Nav items WITHOUT HTML section ---');
for (const p of navPanels) { if (!sections.has(p)) console.log('  MISSING section: ' + p); }

console.log('\n--- Nav items WITHOUT app.js case ---');
for (const p of navPanels) { if (!cases.has(p)) console.log('  NO CASE: ' + p); }

console.log('\n--- HTML sections WITHOUT nav item ---');
for (const p of sections) { if (!navPanels.has(p)) console.log('  ORPHAN section: ' + p); }
