# ============================================================
# OpenClaw All-In-One Debug & Fix Tool v1.0
# Built by ARIES for Jay
# ============================================================
# Usage: powershell -ExecutionPolicy Bypass -File openclaw-doctor.ps1
# Or just: .\openclaw-doctor.ps1
# ============================================================

param(
    [switch]$Fix,        # Auto-fix issues found
    [switch]$Nuclear,    # Full reset (logout + re-auth + clean restart)
    [switch]$Quiet       # Minimal output
)

$ErrorActionPreference = "SilentlyContinue"
$script:issues = @()
$script:fixes = @()

# --- Colors & Output ---
function Write-Header($text) { Write-Host "`n╔══════════════════════════════════════════════════╗" -ForegroundColor Cyan; Write-Host "║  $text" -ForegroundColor Cyan; Write-Host "╚══════════════════════════════════════════════════╝" -ForegroundColor Cyan }
function Write-Check($text) { Write-Host "  [CHECK] $text" -ForegroundColor Gray }
function Write-OK($text) { Write-Host "  [  OK ] $text" -ForegroundColor Green }
function Write-WARN($text) { Write-Host "  [ WARN] $text" -ForegroundColor Yellow }
function Write-FAIL($text) { Write-Host "  [ FAIL] $text" -ForegroundColor Red; $script:issues += $text }
function Write-FIX($text) { Write-Host "  [ FIX ] $text" -ForegroundColor Magenta; $script:fixes += $text }
function Write-INFO($text) { Write-Host "  [ INFO] $text" -ForegroundColor DarkGray }

Write-Host ""
Write-Host "  ╔═══════════════════════════════════════════╗" -ForegroundColor Red
Write-Host "  ║   OpenClaw Doctor v1.0 — by ARIES         ║" -ForegroundColor Red
Write-Host "  ║   All-In-One Debug & Fix Tool              ║" -ForegroundColor Red
Write-Host "  ╚═══════════════════════════════════════════╝" -ForegroundColor Red
Write-Host ""

# ============================================================
# PHASE 1: Environment Check
# ============================================================
Write-Header "PHASE 1: Environment"

# Check OpenClaw installed
Write-Check "OpenClaw CLI installed..."
$ocPath = (Get-Command openclaw -ErrorAction SilentlyContinue).Source
if ($ocPath) {
    Write-OK "Found: $ocPath"
} else {
    Write-FAIL "OpenClaw CLI not found in PATH"
}

# Version
Write-Check "OpenClaw version..."
$ocVersion = & openclaw --version 2>&1
if ($ocVersion) {
    Write-OK "Version: $ocVersion"
} else {
    Write-WARN "Could not determine version"
}

# Node.js
Write-Check "Node.js..."
$nodeVersion = & node --version 2>&1
if ($nodeVersion) {
    Write-OK "Node: $nodeVersion"
} else {
    Write-FAIL "Node.js not found"
}

# ============================================================
# PHASE 2: Config Files
# ============================================================
Write-Header "PHASE 2: Configuration Files"

$ocHome = "$env:USERPROFILE\.openclaw"
Write-Check "OpenClaw home: $ocHome"

if (Test-Path $ocHome) {
    Write-OK "Directory exists"
} else {
    Write-FAIL "OpenClaw home directory missing: $ocHome"
}

# List all files
Write-Check "Config files..."
$allFiles = Get-ChildItem -Path $ocHome -Recurse -File -ErrorAction SilentlyContinue
if ($allFiles) {
    foreach ($f in $allFiles) {
        $relPath = $f.FullName.Replace($ocHome, "~\.openclaw")
        $size = "{0:N0}" -f $f.Length
        Write-INFO "$relPath ($size bytes, modified: $($f.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')))"
    }
} else {
    Write-FAIL "No config files found"
}

# Check openclaw.json
Write-Check "openclaw.json..."
$ocJson = "$ocHome\openclaw.json"
if (Test-Path $ocJson) {
    $config = Get-Content $ocJson -Raw | ConvertFrom-Json -ErrorAction SilentlyContinue
    if ($config) {
        Write-OK "Valid JSON"
        
        # Check gateway config
        if ($config.gateway) {
            Write-OK "Gateway config present"
            if ($config.gateway.auth -and $config.gateway.auth.token) {
                $token = $config.gateway.auth.token
                $tokenPreview = $token.Substring(0, [Math]::Min(12, $token.Length)) + "..."
                Write-OK "Gateway auth token: $tokenPreview (length: $($token.Length))"
            } else {
                Write-WARN "No gateway auth token in config"
            }
            if ($config.gateway.port) {
                Write-OK "Gateway port: $($config.gateway.port)"
            }
        } else {
            Write-WARN "No gateway section in config"
        }
    } else {
        Write-FAIL "openclaw.json is invalid JSON"
    }
} else {
    Write-FAIL "openclaw.json not found"
}

# Check auth profiles
Write-Check "Auth profiles..."
$authFile = "$ocHome\auth-profiles.json"
if (Test-Path $authFile) {
    $auth = Get-Content $authFile -Raw | ConvertFrom-Json -ErrorAction SilentlyContinue
    if ($auth) {
        Write-OK "Valid JSON"
        # Check for tokens
        $authStr = Get-Content $authFile -Raw
        if ($authStr -match "sk-ant") {
            Write-OK "Anthropic API token found"
        }
        if ($authStr -match "oat01") {
            Write-OK "Anthropic OAuth token found"
        }
    } else {
        Write-FAIL "auth-profiles.json is invalid JSON"
    }
} else {
    Write-WARN "auth-profiles.json not found"
}

# Check device identity
Write-Check "Device identity..."
$deviceFile = "$ocHome\identity\device.json"
if (Test-Path $deviceFile) {
    $device = Get-Content $deviceFile -Raw | ConvertFrom-Json -ErrorAction SilentlyContinue
    if ($device) {
        Write-OK "Device identity exists"
        if ($device.deviceId) { Write-INFO "Device ID: $($device.deviceId)" }
    } else {
        Write-FAIL "device.json is invalid"
    }
} else {
    Write-WARN "No device identity file (may not be required)"
}

# ============================================================
# PHASE 3: Process Check
# ============================================================
Write-Header "PHASE 3: Running Processes"

# Find all openclaw/gateway processes
Write-Check "OpenClaw processes..."
$ocProcesses = Get-Process | Where-Object { 
    $_.ProcessName -match "openclaw|gateway" -or 
    ($_.ProcessName -eq "node" -and (
        (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)" -ErrorAction SilentlyContinue).CommandLine -match "openclaw|gateway"
    ))
}

$nodeProcesses = Get-Process -Name "node" -ErrorAction SilentlyContinue
$gatewayPids = @()

if ($nodeProcesses) {
    foreach ($proc in $nodeProcesses) {
        $cmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId=$($proc.Id)" -ErrorAction SilentlyContinue).CommandLine
        if ($cmdLine -match "gateway|openclaw") {
            $gatewayPids += $proc.Id
            Write-WARN "Gateway process: PID $($proc.Id) — $cmdLine"
        }
    }
}

if ($gatewayPids.Count -eq 0) {
    Write-INFO "No gateway processes found running"
} elseif ($gatewayPids.Count -eq 1) {
    Write-OK "Single gateway process running (PID: $($gatewayPids[0]))"
} else {
    Write-FAIL "MULTIPLE gateway processes running! PIDs: $($gatewayPids -join ', ') — THIS CAUSES TOKEN MISMATCH"
}

# ============================================================
# PHASE 4: Port Check
# ============================================================
Write-Header "PHASE 4: Network / Ports"

$gatewayPort = 18789
Write-Check "Gateway port $gatewayPort..."

$portCheck = netstat -ano | Select-String ":$gatewayPort "
if ($portCheck) {
    foreach ($line in $portCheck) {
        Write-INFO $line.ToString().Trim()
    }
    $listeningPids = ($portCheck | ForEach-Object { ($_ -split '\s+')[-1] } | Sort-Object -Unique)
    if ($listeningPids.Count -gt 1) {
        Write-FAIL "Multiple PIDs on port $gatewayPort`: $($listeningPids -join ', ')"
    } else {
        Write-OK "Port $gatewayPort held by PID: $($listeningPids -join ', ')"
    }
} else {
    Write-WARN "Nothing listening on port $gatewayPort"
}

# Try to connect
Write-Check "Gateway HTTP probe..."
try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:$gatewayPort/health" -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
    Write-OK "Gateway responded: $($response.StatusCode) ($($response.Content.Substring(0, [Math]::Min(100, $response.Content.Length))))"
} catch {
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$gatewayPort/" -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
        Write-OK "Gateway responded on /: $($response.StatusCode)"
    } catch {
        Write-FAIL "Cannot connect to gateway on port $gatewayPort — $($_.Exception.Message)"
    }
}

# WebSocket test
Write-Check "Gateway WebSocket probe..."
try {
    $ws = New-Object System.Net.WebSockets.ClientWebSocket
    $cts = New-Object System.Threading.CancellationTokenSource(5000)
    $uri = [Uri]"ws://127.0.0.1:$gatewayPort"
    $ws.ConnectAsync($uri, $cts.Token).Wait()
    if ($ws.State -eq 'Open') {
        Write-OK "WebSocket connected successfully"
        $ws.CloseAsync('NormalClosure', '', [System.Threading.CancellationToken]::None).Wait()
    } else {
        Write-WARN "WebSocket state: $($ws.State)"
    }
} catch {
    $errMsg = $_.Exception.InnerException.Message
    if ($errMsg -match "1008|unauthorized|token") {
        Write-FAIL "WebSocket rejected: TOKEN MISMATCH — $errMsg"
    } else {
        Write-WARN "WebSocket probe failed: $errMsg"
    }
}

# ============================================================
# PHASE 5: Token Consistency Check
# ============================================================
Write-Header "PHASE 5: Token Consistency"

# Check if gateway token in config matches what's in environment
Write-Check "Environment token..."
$envToken = $env:OPENCLAW_GATEWAY_TOKEN
if ($envToken) {
    $envPreview = $envToken.Substring(0, [Math]::Min(12, $envToken.Length)) + "..."
    Write-INFO "OPENCLAW_GATEWAY_TOKEN env var: $envPreview (length: $($envToken.Length))"
    
    # Compare with config
    if ($config -and $config.gateway -and $config.gateway.auth -and $config.gateway.auth.token) {
        $configToken = $config.gateway.auth.token
        if ($envToken -eq $configToken) {
            Write-OK "Environment token MATCHES config token"
        } else {
            Write-FAIL "TOKEN MISMATCH! Environment token != config token"
            Write-INFO "Config:  $($configToken.Substring(0, 12))... (len $($configToken.Length))"
            Write-INFO "Env var: $($envToken.Substring(0, 12))... (len $($envToken.Length))"
        }
    }
} else {
    Write-INFO "No OPENCLAW_GATEWAY_TOKEN environment variable set"
}

# Check Windows service / scheduled task for token
Write-Check "Windows services for OpenClaw..."
$services = Get-Service | Where-Object { $_.Name -match "openclaw|gateway" }
if ($services) {
    foreach ($svc in $services) {
        Write-INFO "Service: $($svc.Name) — Status: $($svc.Status)"
    }
} else {
    Write-INFO "No OpenClaw Windows services found"
}

# Check scheduled tasks
Write-Check "Scheduled tasks..."
$tasks = Get-ScheduledTask | Where-Object { $_.TaskName -match "openclaw|gateway" } -ErrorAction SilentlyContinue
if ($tasks) {
    foreach ($task in $tasks) {
        Write-INFO "Task: $($task.TaskName) — State: $($task.State)"
        $actions = $task.Actions
        foreach ($action in $actions) {
            Write-INFO "  Action: $($action.Execute) $($action.Arguments)"
        }
    }
} else {
    Write-INFO "No OpenClaw scheduled tasks found"
}

# Check nssm or other service wrappers
Write-Check "NSSM service wrapper..."
$nssmPath = (Get-Command nssm -ErrorAction SilentlyContinue).Source
if ($nssmPath) {
    Write-INFO "NSSM found: $nssmPath"
    $nssmServices = & nssm list 2>&1 | Select-String "openclaw|gateway"
    if ($nssmServices) {
        Write-WARN "NSSM-managed OpenClaw services found — check token in service config"
    }
} else {
    Write-INFO "NSSM not installed"
}

# Check PM2
Write-Check "PM2 process manager..."
$pm2Path = (Get-Command pm2 -ErrorAction SilentlyContinue).Source
if ($pm2Path) {
    Write-INFO "PM2 found: $pm2Path"
    $pm2List = & pm2 list 2>&1
    if ($pm2List -match "openclaw|gateway") {
        Write-WARN "PM2-managed OpenClaw processes found"
        Write-INFO $pm2List
    }
} else {
    Write-INFO "PM2 not installed"
}

# ============================================================
# PHASE 6: OpenClaw Doctor
# ============================================================
Write-Header "PHASE 6: OpenClaw Built-in Doctor"

Write-Check "Running openclaw doctor..."
$doctorOutput = & openclaw doctor 2>&1
if ($doctorOutput) {
    foreach ($line in $doctorOutput) {
        $lineStr = $line.ToString()
        if ($lineStr -match "fail|error|mismatch") {
            Write-FAIL $lineStr
        } elseif ($lineStr -match "warn") {
            Write-WARN $lineStr
        } else {
            Write-INFO $lineStr
        }
    }
} else {
    Write-WARN "openclaw doctor produced no output"
}

# ============================================================
# PHASE 7: Log Analysis
# ============================================================
Write-Header "PHASE 7: Recent Logs"

$logDirs = @(
    "$ocHome\logs",
    "$ocHome\log",
    "$ocHome\gateway.log"
)

foreach ($logDir in $logDirs) {
    if (Test-Path $logDir) {
        if ((Get-Item $logDir).PSIsContainer) {
            $recentLogs = Get-ChildItem $logDir -File | Sort-Object LastWriteTime -Descending | Select-Object -First 3
            foreach ($log in $recentLogs) {
                Write-INFO "Log: $($log.Name) ($('{0:N0}' -f $log.Length) bytes)"
                $tail = Get-Content $log.FullName -Tail 20 -ErrorAction SilentlyContinue
                foreach ($line in $tail) {
                    if ($line -match "1008|mismatch|unauthorized|error|fail") {
                        Write-FAIL "  $line"
                    }
                }
            }
        } else {
            Write-INFO "Log file: $logDir"
            $tail = Get-Content $logDir -Tail 20 -ErrorAction SilentlyContinue
            foreach ($line in $tail) {
                if ($line -match "1008|mismatch|unauthorized|error|fail") {
                    Write-FAIL "  $line"
                }
            }
        }
    }
}

# ============================================================
# PHASE 8: Auto-Fix (if -Fix flag)
# ============================================================
if ($Fix -or $Nuclear) {
    Write-Header "PHASE 8: AUTO-FIX"
    
    # Kill duplicate gateway processes
    if ($gatewayPids.Count -gt 1) {
        Write-FIX "Killing duplicate gateway processes..."
        foreach ($pid in $gatewayPids) {
            Write-FIX "  Killing PID $pid..."
            & taskkill /PID $pid /F 2>&1 | Out-Null
        }
        Start-Sleep -Seconds 2
        Write-OK "Killed all gateway processes"
    } elseif ($gatewayPids.Count -eq 1) {
        Write-FIX "Killing stale gateway process PID $($gatewayPids[0])..."
        & taskkill /PID $gatewayPids[0] /F 2>&1 | Out-Null
        Start-Sleep -Seconds 2
        Write-OK "Killed gateway process"
    }
    
    # Sync token from config to environment
    if ($config -and $config.gateway -and $config.gateway.auth -and $config.gateway.auth.token) {
        $correctToken = $config.gateway.auth.token
        Write-FIX "Setting OPENCLAW_GATEWAY_TOKEN environment variable..."
        [System.Environment]::SetEnvironmentVariable("OPENCLAW_GATEWAY_TOKEN", $correctToken, "User")
        $env:OPENCLAW_GATEWAY_TOKEN = $correctToken
        Write-OK "Token synced to environment"
    }
    
    if ($Nuclear) {
        Write-FIX "NUCLEAR: Full re-authentication..."
        
        # Logout
        Write-FIX "  Logging out..."
        & openclaw auth logout 2>&1 | ForEach-Object { Write-INFO "  $_" }
        Start-Sleep -Seconds 2
        
        # Delete identity files
        Write-FIX "  Removing device identity..."
        $identityDir = "$ocHome\identity"
        if (Test-Path $identityDir) {
            Remove-Item $identityDir -Recurse -Force
            Write-OK "  Identity directory removed"
        }
        
        # Reconfigure
        Write-FIX "  Running configure --force..."
        & openclaw configure --force 2>&1 | ForEach-Object { Write-INFO "  $_" }
        Start-Sleep -Seconds 2
        
        # Re-login
        Write-FIX "  Logging in..."
        Write-Host ""
        Write-Host "  *** BROWSER WILL OPEN — Complete the Anthropic login ***" -ForegroundColor Yellow
        Write-Host ""
        & openclaw auth login 2>&1 | ForEach-Object { Write-INFO "  $_" }
        Start-Sleep -Seconds 5
    }
    
    # Restart gateway
    Write-FIX "Starting fresh gateway..."
    & openclaw gateway 2>&1 | ForEach-Object { Write-INFO "  $_" }
    Start-Sleep -Seconds 3
    
    # Verify
    Write-Check "Verifying fix..."
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$gatewayPort/health" -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
        Write-OK "Gateway is responding! Status: $($response.StatusCode)"
    } catch {
        try {
            $response = Invoke-WebRequest -Uri "http://127.0.0.1:$gatewayPort/" -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
            Write-OK "Gateway is responding on /! Status: $($response.StatusCode)"
        } catch {
            Write-FAIL "Gateway still not responding after fix"
        }
    }
}

# ============================================================
# SUMMARY
# ============================================================
Write-Header "SUMMARY"

if ($script:issues.Count -eq 0) {
    Write-Host "  ✅ No issues found!" -ForegroundColor Green
} else {
    Write-Host "  ❌ Found $($script:issues.Count) issue(s):" -ForegroundColor Red
    foreach ($issue in $script:issues) {
        Write-Host "     • $issue" -ForegroundColor Red
    }
}

if ($script:fixes.Count -gt 0) {
    Write-Host ""
    Write-Host "  🔧 Applied $($script:fixes.Count) fix(es):" -ForegroundColor Magenta
    foreach ($fix in $script:fixes) {
        Write-Host "     • $fix" -ForegroundColor Magenta
    }
}

if (-not $Fix -and $script:issues.Count -gt 0) {
    Write-Host ""
    Write-Host "  💡 Run with -Fix to auto-fix issues:" -ForegroundColor Yellow
    Write-Host "     .\openclaw-doctor.ps1 -Fix" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  💣 Run with -Nuclear for full reset:" -ForegroundColor Yellow
    Write-Host "     .\openclaw-doctor.ps1 -Nuclear" -ForegroundColor Yellow
}

Write-Host ""
