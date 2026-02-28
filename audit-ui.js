const fs = require('fs');
const html = fs.readFileSync('web/index.html', 'utf8');

// Get all panels
const panels = [...html.matchAll(/id="panel-([^"]+)"/g)].map(m => m[1]);
console.log('Total panels:', panels.length);
console.log('\nAll panels:');
panels.forEach((p, i) => console.log(`  ${i+1}. ${p}`));

// Get nav items
const navItems = [...html.matchAll(/switchPanel\('([^']+)'\)/g)].map(m => m[1]);
console.log('\nNav items (clickable):', navItems.length);
navItems.forEach(n => console.log('  -', n));

// Check which panels have NO nav entry
const navSet = new Set(navItems);
const orphans = panels.filter(p => !navSet.has(p));
console.log('\nOrphan panels (no nav link):', orphans.length);
orphans.forEach(o => console.log('  ⚠️', o));

// Get sidebar structure
const sidebarMatch = html.match(/class="sidebar"[\s\S]*?<\/nav>/);
if (sidebarMatch) {
  const categories = [...sidebarMatch[0].matchAll(/<div[^>]*class="nav-category"[^>]*>([\s\S]*?)<\/div>/g)];
  console.log('\nSidebar categories:', categories.length);
}

// Check app.js for switchPanel function
const appJs = fs.readFileSync('web/app.js', 'utf8');
const switchCases = [...appJs.matchAll(/case\s+'([^']+)':/g)].map(m => m[1]);
console.log('\nswitchPanel cases in app.js:', switchCases.length);
switchCases.forEach(c => console.log('  -', c));

// Panels with no switchPanel case
const caseSet = new Set(switchCases);
const noCasePanel = panels.filter(p => !caseSet.has(p));
console.log('\nPanels with no switchPanel case:', noCasePanel.length);
noCasePanel.forEach(p => console.log('  ❌', p));
