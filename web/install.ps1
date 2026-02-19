# ARIES v5.3 — Windows One-Liner Installer
# Usage: irm https://raw.githubusercontent.com/dsfgsdgf33/aries/main/web/install.ps1 | iex
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$InstallDir = "$env:LOCALAPPDATA\Aries"

Write-Host @"

  ╔═══════════════════════════════════════╗
  ║     ARIES v5.3 — Quick Install        ║
  ╚═══════════════════════════════════════╝

"@ -ForegroundColor Cyan

# ── Node.js ──
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host "[!] Node.js not found. Installing portable Node.js..." -ForegroundColor Yellow
    $arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
    $nodeVer = "20.18.0"
    $nodeUrl = "https://nodejs.org/dist/v$nodeVer/node-v$nodeVer-win-$arch.zip"
    $nodeZip = "$env:TEMP\node-portable.zip"
    $nodeDir = "$InstallDir\node"

    Write-Host "[*] Downloading Node.js v$nodeVer..." -ForegroundColor Cyan
    Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeZip -UseBasicParsing
    Write-Host "[*] Extracting..." -ForegroundColor Cyan
    if (Test-Path $nodeDir) { Remove-Item $nodeDir -Recurse -Force }
    Expand-Archive -Path $nodeZip -DestinationPath $nodeDir -Force
    $inner = Get-ChildItem $nodeDir -Directory | Select-Object -First 1
    if ($inner) {
        Get-ChildItem $inner.FullName | Move-Item -Destination $nodeDir -Force -ErrorAction SilentlyContinue
        Remove-Item $inner.FullName -Recurse -Force -ErrorAction SilentlyContinue
    }
    $env:Path = "$nodeDir;$env:Path"
    Remove-Item $nodeZip -Force
    Write-Host "[+] Node.js installed!" -ForegroundColor Green
} else {
    $ver = & node -v
    Write-Host "[+] Node.js $ver found" -ForegroundColor Green
}

# ── Git ──
$git = Get-Command git -ErrorAction SilentlyContinue
if (-not $git) {
    Write-Host "[!] Git not found. Installing portable git..." -ForegroundColor Yellow
    $gitUrl = "https://github.com/git-for-windows/git/releases/download/v2.43.0.windows.1/MinGit-2.43.0-64-bit.zip"
    $gitZip = "$env:TEMP\mingit.zip"
    $gitDir = "$InstallDir\git"
    Invoke-WebRequest -Uri $gitUrl -OutFile $gitZip -UseBasicParsing
    if (Test-Path $gitDir) { Remove-Item $gitDir -Recurse -Force }
    Expand-Archive -Path $gitZip -DestinationPath $gitDir -Force
    $env:Path = "$gitDir\cmd;$env:Path"
    Remove-Item $gitZip -Force
    Write-Host "[+] Git installed!" -ForegroundColor Green
}

# ── Clone or Update ──
if (Test-Path "$InstallDir\.git") {
    Write-Host "[*] Updating existing installation..." -ForegroundColor Yellow
    Push-Location $InstallDir
    & git pull --ff-only 2>$null
    Pop-Location
} else {
    Write-Host "[*] Downloading Aries..." -ForegroundColor Cyan
    if (Test-Path $InstallDir) { Remove-Item $InstallDir -Recurse -Force }
    & git clone https://github.com/dsfgsdgf33/aries.git $InstallDir
}

# ── Install dependencies ──
Push-Location $InstallDir
Write-Host "[*] Installing dependencies..." -ForegroundColor Cyan
& npm install --no-fund --no-audit
Write-Host "[+] Dependencies installed!" -ForegroundColor Green

# ── Run setup ──
Write-Host "`n[*] Starting setup wizard..." -ForegroundColor Cyan
& node setup.js

# ── Create Desktop Shortcut ──
Write-Host "[*] Creating desktop shortcut..." -ForegroundColor Cyan
try {
    $WshShell = New-Object -ComObject WScript.Shell
    $Desktop = $WshShell.SpecialFolders("Desktop")
    $Shortcut = $WshShell.CreateShortcut("$Desktop\ARIES.lnk")
    $Shortcut.TargetPath = "$InstallDir\launch.bat"
    $Shortcut.WorkingDirectory = $InstallDir
    $icoPath = "$InstallDir\aries.ico"
    if (Test-Path $icoPath) { $Shortcut.IconLocation = $icoPath }
    $Shortcut.Description = "ARIES - Autonomous Runtime Intelligence"
    $Shortcut.Save()
    Write-Host "[+] Desktop shortcut created!" -ForegroundColor Green
} catch {
    Write-Host "[!] Could not create shortcut (non-critical)" -ForegroundColor Yellow
}

# ── Create Start Menu Entry ──
try {
    $StartMenu = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs"
    $Shortcut2 = $WshShell.CreateShortcut("$StartMenu\ARIES.lnk")
    $Shortcut2.TargetPath = "$InstallDir\launch.bat"
    $Shortcut2.WorkingDirectory = $InstallDir
    if (Test-Path $icoPath) { $Shortcut2.IconLocation = $icoPath }
    $Shortcut2.Description = "ARIES - Autonomous Runtime Intelligence"
    $Shortcut2.Save()
    Write-Host "[+] Start Menu entry created!" -ForegroundColor Green
} catch {}

Pop-Location

# ── Browser Extension ──
Write-Host @"

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  BROWSER EXTENSION
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Aries includes a Chrome extension for AI overlay.
  Location: $InstallDir\extensions\aries-browser\

  Install: Chrome > chrome://extensions > Load unpacked

"@ -ForegroundColor Yellow

try { Start-Process "chrome://extensions" -ErrorAction SilentlyContinue } catch {}

Write-Host @"

  ╔═══════════════════════════════════════╗
  ║       Installation complete!           ║
  ╚═══════════════════════════════════════╝

  Location: $InstallDir
  Launch:   Double-click the ARIES shortcut on your desktop
  Or run:   cd "$InstallDir" && node launcher.js

"@ -ForegroundColor Green
