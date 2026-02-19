# ARIES One-Click Installer for Windows
# Run: irm https://raw.githubusercontent.com/dsfgsdgf33/aries/main/install-windows.ps1 | iex

$ErrorActionPreference = 'Stop'
Write-Host "`n  ▲ ARIES — AI Command Center Installer`n" -ForegroundColor Cyan

# Check Node.js
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host "  Installing Node.js..." -ForegroundColor Yellow
    winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements 2>$null
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        Write-Host "  Please install Node.js 18+ from https://nodejs.org and re-run this script" -ForegroundColor Red
        exit 1
    }
}
Write-Host "  ✓ Node.js $(node --version)" -ForegroundColor Green

# Clone or update
$installDir = "$env:LOCALAPPDATA\Aries"
if (Test-Path "$installDir\launcher.js") {
    Write-Host "  Updating existing installation..." -ForegroundColor Yellow
    Push-Location $installDir
    git pull origin main 2>$null
    Pop-Location
} else {
    Write-Host "  Downloading Aries..." -ForegroundColor Yellow
    git clone https://github.com/dsfgsdgf33/aries.git $installDir 2>$null
    if (-not $?) {
        # Git not available, use zip
        $zip = "$env:TEMP\aries.zip"
        Invoke-WebRequest -Uri "https://github.com/dsfgsdgf33/aries/archive/refs/heads/main.zip" -OutFile $zip
        Expand-Archive -Path $zip -DestinationPath "$env:TEMP\aries-extract" -Force
        Move-Item "$env:TEMP\aries-extract\aries-main" $installDir
        Remove-Item $zip, "$env:TEMP\aries-extract" -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# Create desktop shortcut
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut("$env:USERPROFILE\Desktop\ARIES.lnk")
$shortcut.TargetPath = "node"
$shortcut.Arguments = "`"$installDir\launcher.js`""
$shortcut.WorkingDirectory = $installDir
$shortcut.Description = "ARIES AI Command Center"
if (Test-Path "$installDir\aries.ico") { $shortcut.IconLocation = "$installDir\aries.ico" }
$shortcut.Save()

# Create Start Menu shortcut
$startMenu = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs"
$shortcut2 = $shell.CreateShortcut("$startMenu\ARIES.lnk")
$shortcut2.TargetPath = "node"
$shortcut2.Arguments = "`"$installDir\launcher.js`""
$shortcut2.WorkingDirectory = $installDir
$shortcut2.Description = "ARIES AI Command Center"
if (Test-Path "$installDir\aries.ico") { $shortcut2.IconLocation = "$installDir\aries.ico" }
$shortcut2.Save()

Write-Host "`n  ✓ ARIES installed to $installDir" -ForegroundColor Green
Write-Host "  ✓ Desktop shortcut created" -ForegroundColor Green
Write-Host "  ✓ Start Menu shortcut created" -ForegroundColor Green

# Launch
Write-Host "`n  Starting ARIES..." -ForegroundColor Cyan
Start-Process "http://localhost:3333" -ErrorAction SilentlyContinue
Push-Location $installDir
node launcher.js
