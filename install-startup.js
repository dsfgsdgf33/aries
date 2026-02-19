const fs = require('fs');
const path = require('path');
const os = require('os');

const startupDir = path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const batPath = path.join(__dirname, 'launch.bat');
const vbsPath = path.join(startupDir, 'ARIES-startup.vbs');

const vbs = `
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """${batPath.replace(/\\/g, '\\')}""", 1, False
`;

try {
  fs.writeFileSync(vbsPath, vbs.trim());
  console.log('✓ ARIES added to Windows Startup');
  console.log('  File:', vbsPath);
} catch (e) {
  console.error('✗ Failed:', e.message);
}
