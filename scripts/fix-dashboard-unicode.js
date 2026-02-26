
const fs = require('fs');
let code = fs.readFileSync('app/page.tsx', 'utf8');

// Replace \\u{XXXX} with actual Unicode characters
code = code.replace(/\\u\{([0-9A-Fa-f]+)\}/g, (match, hex) => {
  return String.fromCodePoint(parseInt(hex, 16));
});

fs.writeFileSync('app/page.tsx', code);
console.log('Fixed unicode escapes');
console.log('Sample:', code.substring(code.indexOf('icon:'), code.indexOf('icon:') + 50));
