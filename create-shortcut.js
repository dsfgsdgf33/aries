const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const desktop = path.join(os.homedir(), 'Desktop');
const ariesDir = __dirname;
const batPath = path.join(ariesDir, 'launch.bat');
const icoPath = path.join(ariesDir, 'aries.ico');
const shortcutPath = path.join(desktop, 'ARIES.lnk');

// Step 1: Generate Tron-style icon (cyan A on black with cyan border)
const iconPS = `
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap(64,64)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.Clear([System.Drawing.Color]::Black)
$font = New-Object System.Drawing.Font("Consolas", 36, [System.Drawing.FontStyle]::Bold)
$brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(0, 255, 255))
$g.DrawString("A", $font, $brush, 8, 6)
$pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(0, 255, 255), 2)
$g.DrawRectangle($pen, 1, 1, 62, 62)
$g.Dispose()
$icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
$stream = [System.IO.File]::Create("${icoPath.replace(/\\/g, '\\\\')}")
$icon.Save($stream)
$stream.Close()
$bmp.Dispose()
Write-Output "Icon created"
`;

console.log('Generating ARIES icon...');
exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${path.join(ariesDir, 'gen-icon.ps1')}"`, (err, stdout) => {
  if (err) {
    console.log('Icon generation failed, using fallback icon');
  } else {
    console.log('✓ Icon generated:', icoPath);
  }

  // Step 2: Create shortcut via VBS
  const iconLoc = fs.existsSync(icoPath) ? icoPath : 'shell32.dll,13';
  const vbs = `
Set WshShell = CreateObject("WScript.Shell")
Set shortcut = WshShell.CreateShortcut("${shortcutPath.replace(/\\/g, '\\')}")
shortcut.TargetPath = "${batPath.replace(/\\/g, '\\')}"
shortcut.WorkingDirectory = "${ariesDir.replace(/\\/g, '\\')}"
shortcut.WindowStyle = 1
shortcut.Description = "ARIES - Autonomous Runtime Intelligence & Execution System"
shortcut.IconLocation = "${iconLoc.replace(/\\/g, '\\')}"
shortcut.Save
WScript.Echo "done"
`;

  const vbsPath = path.join(ariesDir, '_temp.vbs');
  fs.writeFileSync(vbsPath, vbs);

  exec(`cscript //nologo "${vbsPath}"`, (err2) => {
    try { fs.unlinkSync(vbsPath); } catch {}
    if (err2) {
      console.error('✗ Shortcut creation failed:', err2.message);
    } else {
      console.log('✓ ARIES shortcut created on Desktop');
      console.log('  Location:', shortcutPath);
    }
  });
});
