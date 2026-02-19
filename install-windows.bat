@echo off
setlocal enabledelayedexpansion
title Aries Installer
color 0B

echo.
echo   ╔═══════════════════════════════════════╗
echo   ║     ARIES v5.3 - One Click Setup      ║
echo   ╚═══════════════════════════════════════╝
echo.

:: ── Check Node.js ──
echo [*] Checking for Node.js...
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [!] Node.js not found. Downloading installer...
    echo.
    powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi' -OutFile '%TEMP%\node-installer.msi' -UseBasicParsing"
    if !ERRORLEVEL! NEQ 0 (
        echo [X] Failed to download Node.js. Please install manually from https://nodejs.org
        pause
        exit /b 1
    )
    echo [*] Installing Node.js ^(this may take a minute^)...
    msiexec /i "%TEMP%\node-installer.msi" /qn /norestart
    if !ERRORLEVEL! NEQ 0 (
        echo [!] Silent install failed. Launching interactive installer...
        msiexec /i "%TEMP%\node-installer.msi"
    )
    del "%TEMP%\node-installer.msi" 2>nul

    :: Refresh PATH
    set "PATH=%ProgramFiles%\nodejs;%PATH%"

    where node >nul 2>nul
    if !ERRORLEVEL! NEQ 0 (
        echo [X] Node.js installation failed. Please install manually from https://nodejs.org
        echo     Then re-run this installer.
        pause
        exit /b 1
    )
    echo [+] Node.js installed successfully!
) else (
    for /f "tokens=*" %%v in ('node -v') do echo [+] Node.js %%v found
)
echo.

:: ── Install dependencies ──
echo [*] Installing dependencies...
call npm install --no-fund --no-audit
if %ERRORLEVEL% NEQ 0 (
    echo [X] npm install failed. Check your internet connection.
    pause
    exit /b 1
)
echo [+] Dependencies installed!
echo.

:: ── Run setup wizard ──
echo [*] Starting setup wizard...
echo ────────────────────────────────────────────
node setup.js
echo ────────────────────────────────────────────
echo.

:: ── Create desktop shortcut ──
echo [*] Creating desktop shortcut...
node install-shortcut.js 2>nul
echo.

:: ── Browser Extension ──
echo   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo   BROWSER EXTENSION
echo   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo   Aries includes a Chrome extension for AI overlay.
echo   Location: %CD%\extensions\aries-browser\
echo   Install: Chrome ^> chrome://extensions ^> Load unpacked
echo.
start chrome://extensions 2>nul

echo   ╔═══════════════════════════════════════╗
echo   ║       Setup complete!                  ║
echo   ║   Double-click 'launch.bat' to start   ║
echo   ║   or run: node launcher.js              ║
echo   ╚═══════════════════════════════════════╝
echo.
pause
