
# Kill the stale OpenClaw gateway process
$pid = 18460
Write-Host "Killing OpenClaw gateway PID $pid..."
Stop-Process -Id $pid -Force
Write-Host "Done. Verifying..."
Start-Sleep 2
$check = netstat -ano | Select-String "18789"
if ($check) {
    Write-Host "WARNING: Port 18789 still in use"
    Write-Host $check
} else {
    Write-Host "Port 18789 is free. Run: openclaw gateway start"
}
