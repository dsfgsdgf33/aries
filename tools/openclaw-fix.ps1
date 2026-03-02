#!/usr/bin/env pwsh
# OpenClaw Gateway Token Mismatch Fixer
# Fixes the 1008 "device token mismatch" error
# 
# Root cause: The gateway auth token is stored in TWO places that get out of sync:
#   1. ~/.openclaw/credentials.json (device token the CLIENT sends)
#   2. The running gateway process (token it loaded at startup)
# When these diverge (e.g., after re-auth, config changes), you get 1008.
#
# Fix: Kill all gateway processes, nuke stale state, re-authenticate, restart gateway.

param(
    [switch]$Force,
    [switch]$DiagOnly
)

$ErrorActionPreference = "Continue"
$openclawDir = "$env:USERPROFILE\.openclaw"

function Write-Step($msg) { Write-Host "`n[*] $msg" -ForegroundColor Cyan }
function Write-OK($msg) { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  [!] $msg" -ForegroundColor Yellow }
function Write-Err($msg) { Write-Host "  [X] $msg" -ForegroundColor Red }
function Write-Info($msg) { Write-Host "  $msg" -ForegroundColor Gray }

Write-Host ""
Write-Host "========================================" -ForegroundColor Magenta
Write-Host "  OpenClaw Gateway Debug & Fix Tool" -ForegroundColor Magenta  
Write-Host "  v1.0 - by ARIES" -ForegroundColor Magenta
Write-Host "========================================" -ForegroundColor Magenta

# ============================================================
# PHASE 1: DIAGNOSIS
# ============================================================
Write-Step "Phase 1: Diagnosing current state..."

# Check if openclaw CLI exists
$openclawCmd = Get-Command openclaw -ErrorAction SilentlyContinue
if ($openclawCmd) {
    Write-OK "OpenClaw CLI found: $($openclawCmd.Source)"
    $version = openclaw --version 2>&1
    Write-Info "Version: $version"
} else {
    Write-Err "OpenClaw CLI not found in PATH!"
    Write-Host "Install with: npm install -g @anthropic-ai/claude-code" -ForegroundColor Yellow
    exit 1
}

# Check config directory
Write-Step "Checking config directory: $openclawDir"
if (Test-Path $openclawDir) {
    $files = Get-ChildItem $openclawDir -Recurse -Name
    Write-OK "Config directory exists with $($files.Count) files:"
    $files | ForEach-Object { Write-Info "  $_" }
} else {
    Write-Warn "Config directory doesn't exist - fresh install?"
}

# Check credentials
Write-Step "Checking credentials..."
$credsPath = "$openclawDir\credentials.json"
if (Test-Path $credsPath) {
    try {
        $creds = Get-Content $credsPath -Raw | ConvertFrom-Json
        $props = $creds.PSObject.Properties
        Write-OK "credentials.json exists with $($props.Count) properties"
        
        # Check for device token
        $deviceToken = $null
        foreach ($prop in $props) {
            if ($prop.Name -match "device|token") {
                $val = "$($prop.Value)"
                $masked = if ($val.Length -gt 12) { $val.Substring(0,8) + "..." + $val.Substring($val.Length-4) } else { "***" }
                Write-Info "  $($prop.Name): $masked"
                if ($prop.Name -match "device") { $deviceToken = $prop.Value }
            }
        }
        if (-not $deviceToken) {
            Write-Warn "No device token found in credentials!"
        }
    } catch {
        Write-Err "Failed to parse credentials.json: $_"
    }
} else {
    Write-Err "credentials.json missing - not authenticated!"
}

# Check auth profiles
Write-Step "Checking auth profiles..."
$authPath = "$openclawDir\auth-profiles.json"
if (Test-Path $authPath) {
    try {
        $auth = Get-Content $authPath -Raw | ConvertFrom-Json
        Write-OK "auth-profiles.json exists"
        # Check for OAuth tokens
        $authStr = Get-Content $authPath -Raw
        if ($authStr -match "sk-ant-oat") {
            Write-OK "OAuth token present (sk-ant-oat...)"
        } else {
            Write-Warn "No OAuth token found in auth profiles"
        }
    } catch {
        Write-Err "Failed to parse auth-profiles.json: $_"
    }
} else {
    Write-Warn "auth-profiles.json missing"
}

# Check settings
Write-Step "Checking settings..."
$settingsPath = "$openclawDir\settings.json"
if (Test-Path $settingsPath) {
    $settings = Get-Content $settingsPath -Raw
    Write-OK "settings.json exists"
    Write-Info "  Content: $settings"
} else {
    Write-Warn "settings.json missing"
}

# Check for running gateway processes
Write-Step "Checking for running gateway processes..."
$nodeProcesses = Get-WmiObject Win32_Process -Filter "Name='node.exe'" 2>$null
$gatewayProcs = @()
foreach ($proc in $nodeProcesses) {
    if ($proc.CommandLine -match "gateway|claude-code|openclaw") {
        $gatewayProcs += $proc
        Write-Warn "Gateway process found: PID $($proc.ProcessId)"
        Write-Info "  CMD: $($proc.CommandLine.Substring(0, [Math]::Min(200, $proc.CommandLine.Length)))"
    }
}
if ($gatewayProcs.Count -eq 0) {
    Write-Info "No gateway processes running"
}

# Check port 18789
Write-Step "Checking port 18789..."
$portCheck = netstat -ano 2>$null | Select-String "18789"
if ($portCheck) {
    Write-Warn "Port 18789 is in use:"
    $portCheck | ForEach-Object { Write-Info "  $_" }
} else {
    Write-Info "Port 18789 is free"
}

# Check for lock files
Write-Step "Checking for stale lock files..."
$lockFiles = Get-ChildItem $openclawDir -Filter "*.lock" -Recurse -ErrorAction SilentlyContinue
$pidFiles = Get-ChildItem $openclawDir -Filter "*.pid" -Recurse -ErrorAction SilentlyContinue
if ($lockFiles) {
    $lockFiles | ForEach-Object { Write-Warn "Lock file: $($_.FullName)" }
} else {
    Write-Info "No lock files found"
}
if ($pidFiles) {
    $pidFiles | ForEach-Object { Write-Warn "PID file: $($_.FullName) = $(Get-Content $_.FullName -Raw)" }
} else {
    Write-Info "No PID files found"
}

# Check scheduled tasks
Write-Step "Checking scheduled tasks..."
$tasks = Get-ScheduledTask 2>$null | Where-Object { 
    $_.TaskName -match "openclaw|claude|gateway|anthropic" -or
    ($_.Actions | ForEach-Object { $_.Execute + " " + $_.Arguments }) -match "openclaw|claude-code|gateway"
}
if ($tasks) {
    $tasks | ForEach-Object {
        Write-Warn "Scheduled task: $($_.TaskName) (State: $($_.State))"
        $_.Actions | ForEach-Object { Write-Info "  Execute: $($_.Execute) $($_.Arguments)" }
    }
} else {
    Write-Info "No OpenClaw scheduled tasks found"
}

# Run openclaw doctor
Write-Step "Running openclaw doctor..."
$doctorOutput = openclaw doctor 2>&1
Write-Info ($doctorOutput | Out-String)

if ($DiagOnly) {
    Write-Host "`n========================================" -ForegroundColor Magenta
    Write-Host "  Diagnosis complete (diag-only mode)" -ForegroundColor Magenta
    Write-Host "========================================" -ForegroundColor Magenta
    exit 0
}

# ============================================================
# PHASE 2: FIX
# ============================================================
Write-Host "`n" 
Write-Host "========================================" -ForegroundColor Red
Write-Host "  Phase 2: FIXING" -ForegroundColor Red
Write-Host "========================================" -ForegroundColor Red

if (-not $Force) {
    $confirm = Read-Host "`nThis will kill gateway processes and reset auth state. Continue? (y/N)"
    if ($confirm -ne "y" -and $confirm -ne "Y") {
        Write-Host "Aborted." -ForegroundColor Yellow
        exit 0
    }
}

# Step 1: Kill ALL gateway processes
Write-Step "Step 1: Killing all gateway processes..."
foreach ($proc in $gatewayProcs) {
    Write-Info "Killing PID $($proc.ProcessId)..."
    try {
        taskkill /PID $proc.ProcessId /F 2>$null | Out-Null
        Write-OK "Killed PID $($proc.ProcessId)"
    } catch {
        Write-Err "Failed to kill PID $($proc.ProcessId): $_"
        Write-Warn "Try manually: taskkill /PID $($proc.ProcessId) /F"
    }
}

# Also kill anything on port 18789
$portProcs = netstat -ano 2>$null | Select-String "18789" | ForEach-Object {
    if ($_ -match "\s+(\d+)\s*$") { $matches[1] }
} | Select-Object -Unique
foreach ($pid in $portProcs) {
    if ($pid -and $pid -ne "0") {
        Write-Info "Killing process on port 18789: PID $pid"
        taskkill /PID $pid /F 2>$null | Out-Null
    }
}

Start-Sleep -Seconds 2

# Verify port is free
$portCheck2 = netstat -ano 2>$null | Select-String "18789"
if ($portCheck2) {
    Write-Err "Port 18789 still in use! Manual intervention needed."
    Write-Warn "Run: netstat -ano | findstr 18789"
    Write-Warn "Then: taskkill /PID <pid> /F"
} else {
    Write-OK "Port 18789 is now free"
}

# Step 2: Remove stale lock/pid files
Write-Step "Step 2: Removing stale lock/pid files..."
Get-ChildItem $openclawDir -Filter "*.lock" -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
    Remove-Item $_.FullName -Force
    Write-OK "Removed $($_.Name)"
}
Get-ChildItem $openclawDir -Filter "*.pid" -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
    Remove-Item $_.FullName -Force
    Write-OK "Removed $($_.Name)"
}

# Step 3: Stop any scheduled tasks
Write-Step "Step 3: Stopping scheduled tasks..."
if ($tasks) {
    foreach ($task in $tasks) {
        try {
            Stop-ScheduledTask -TaskName $task.TaskName -ErrorAction SilentlyContinue
            Unregister-ScheduledTask -TaskName $task.TaskName -Confirm:$false -ErrorAction SilentlyContinue
            Write-OK "Removed task: $($task.TaskName)"
        } catch {
            Write-Warn "Could not remove task $($task.TaskName): $_"
        }
    }
} else {
    Write-Info "No tasks to stop"
}

# Step 4: Nuclear token reset
Write-Step "Step 4: Resetting authentication state..."

# Logout first
Write-Info "Running openclaw auth logout..."
openclaw auth logout 2>&1 | Out-Null

# Delete credentials (device token)
if (Test-Path $credsPath) {
    Remove-Item $credsPath -Force
    Write-OK "Deleted credentials.json"
}

# Delete settings (gateway token)  
if (Test-Path $settingsPath) {
    Remove-Item $settingsPath -Force
    Write-OK "Deleted settings.json"
}

# Keep auth-profiles.json (has OAuth token we need)
if (Test-Path $authPath) {
    Write-OK "Kept auth-profiles.json (OAuth token)"
} else {
    Write-Warn "No auth-profiles.json - you'll need to re-login"
}

# Step 5: Re-authenticate
Write-Step "Step 5: Re-authenticating..."
Write-Info "Checking auth status..."
$authStatus = openclaw auth status 2>&1
Write-Info ($authStatus | Out-String)

# Try to start gateway - this should trigger re-auth if needed
Write-Step "Step 6: Starting fresh gateway..."
Write-Info "Running: openclaw gateway start"

# Start gateway in background
$gatewayJob = Start-Process -FilePath "openclaw" -ArgumentList "gateway","start" -PassThru -NoNewWindow -RedirectStandardOutput "$openclawDir\gateway-start-stdout.log" -RedirectStandardError "$openclawDir\gateway-start-stderr.log"

Write-Info "Gateway start process PID: $($gatewayJob.Id)"
Write-Info "Waiting 8 seconds for gateway to initialize..."
Start-Sleep -Seconds 8

# Check if it started
$portCheck3 = netstat -ano 2>$null | Select-String "18789"
if ($portCheck3) {
    Write-OK "Gateway is listening on port 18789!"
    $portCheck3 | ForEach-Object { Write-Info "  $_" }
} else {
    Write-Err "Gateway did NOT start on port 18789"
    
    # Check logs
    if (Test-Path "$openclawDir\gateway-start-stdout.log") {
        $stdout = Get-Content "$openclawDir\gateway-start-stdout.log" -Raw
        if ($stdout) { Write-Info "STDOUT: $stdout" }
    }
    if (Test-Path "$openclawDir\gateway-start-stderr.log") {
        $stderr = Get-Content "$openclawDir\gateway-start-stderr.log" -Raw
        if ($stderr) { Write-Err "STDERR: $stderr" }
    }
    
    Write-Host "`n  Manual steps needed:" -ForegroundColor Yellow
    Write-Host "  1. Run: openclaw auth login" -ForegroundColor Yellow
    Write-Host "     (This opens a browser for OAuth)" -ForegroundColor Yellow
    Write-Host "  2. After login, run: openclaw gateway start" -ForegroundColor Yellow
    Write-Host "  3. Verify: netstat -ano | findstr 18789" -ForegroundColor Yellow
}

# Step 7: Verify
Write-Step "Step 7: Final verification..."

# Check credentials were regenerated
if (Test-Path $credsPath) {
    Write-OK "credentials.json regenerated"
} else {
    Write-Warn "credentials.json not regenerated yet"
}

if (Test-Path $settingsPath) {
    Write-OK "settings.json regenerated"
} else {
    Write-Warn "settings.json not regenerated yet"
}

# Final gateway status
$finalStatus = openclaw gateway status 2>&1
Write-Info "Gateway status: $($finalStatus | Out-String)"

# Test connection
Write-Step "Testing gateway connection..."
try {
    $testResult = openclaw doctor 2>&1
    Write-Info ($testResult | Out-String)
} catch {
    Write-Warn "Doctor check failed: $_"
}

Write-Host "`n========================================" -ForegroundColor Magenta
Write-Host "  Fix attempt complete!" -ForegroundColor Magenta
Write-Host "========================================" -ForegroundColor Magenta
Write-Host ""
Write-Host "If the gateway still won't start:" -ForegroundColor Yellow
Write-Host "  1. openclaw auth login    (re-authenticate)" -ForegroundColor Yellow
Write-Host "  2. openclaw gateway start (start gateway)" -ForegroundColor Yellow
Write-Host ""
Write-Host "If you still get 1008 token mismatch:" -ForegroundColor Yellow
Write-Host "  1. Delete entire config: Remove-Item ~\.openclaw -Recurse -Force" -ForegroundColor Yellow
Write-Host "  2. Re-login: openclaw auth login" -ForegroundColor Yellow
Write-Host "  3. Start gateway: openclaw gateway start" -ForegroundColor Yellow
Write-Host ""
Write-Host "Run with -DiagOnly to just diagnose without fixing." -ForegroundColor Gray
Write-Host "Run with -Force to skip confirmation prompt." -ForegroundColor Gray
