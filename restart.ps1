$conn = Get-NetTCPConnection -LocalPort 3333 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($conn) { Stop-Process -Id $conn.OwningProcess -Force; Write-Output "Killed PID $($conn.OwningProcess)" }
Start-Sleep 2
Start-Process -FilePath 'node' -ArgumentList 'launcher.js' -WorkingDirectory 'D:\openclaw\workspace\aries' -WindowStyle Hidden
Start-Sleep 6
try { $r = Invoke-RestMethod 'http://localhost:3333/api/status'; Write-Output "Server up v$($r.version) uptime=$($r.uptime)" } catch { Write-Output "Server not ready: $_" }
