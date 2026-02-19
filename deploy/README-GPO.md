# Aries Swarm — GPO Mass Deployment

Deploy to 1000+ Windows machines with zero per-machine interaction.

## Quick Setup (5 minutes, one time)

### 1. Share the deploy folder
Put `gpo-startup.ps1` on a network share accessible by all machines:
```
\\YOUR-SERVER\aries-deploy\gpo-startup.ps1
```

### 2. Create Group Policy
1. Open `gpedit.msc` (local) or Group Policy Management Console (domain)
2. Navigate: **Computer Configuration → Windows Settings → Scripts → Startup**
3. Click **Add → PowerShell Scripts**
4. Script: `\\YOUR-SERVER\aries-deploy\gpo-startup.ps1`
5. Click OK

### 3. Done
Every machine that boots will:
- Add Defender exclusions automatically (runs as SYSTEM)
- Install Node.js if missing
- Download and start the Aries worker
- Create a scheduled task for persistence across reboots
- Auto-update when version changes
- Skip entirely if already running and current

## For Workgroup (No Domain)

If your laptops aren't on a domain, use the local GPO method:
```powershell
# Run this ONCE on each machine (can be done via USB or remote)
Copy-Item "\\share\gpo-startup.ps1" "C:\Windows\Scripts\gpo-startup.ps1"
schtasks /create /tn "AriesDeploy" /tr "powershell -ep bypass -f C:\Windows\Scripts\gpo-startup.ps1" /sc onstart /ru SYSTEM /f
```

Or use the USB method — plug in and run `deploy.bat`.

## Updating Workers

Change `$CurrentVer` in the script. On next boot, every machine auto-updates.

## Removing from All Machines

Push this via GPO or run remotely:
```powershell
Stop-Process -Name node -Force -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName "AriesSwarmWorker" -Confirm:$false
Remove-Item "$env:ProgramData\aries-swarm" -Recurse -Force
```
