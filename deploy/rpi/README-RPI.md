# Aries Swarm — Raspberry Pi Deployment

## Method 1: Quick Setup (Existing Pi)

SSH into your Pi and run:

```bash
curl -sL https://gateway.doomtrader.com:9700/api/deploy/rpi-script | sudo bash
```

Or download and run manually:
```bash
wget https://gateway.doomtrader.com:9700/api/deploy/rpi-script -O setup-rpi.sh
sudo bash setup-rpi.sh
```

### What it does:
- Installs Node.js 20 (ARM auto-detected)
- Downloads xmrig (ARM binary)
- Downloads worker from relay
- Creates systemd service (auto-start on boot)
- Optimizes Pi: performance governor, 16MB GPU, disables bluetooth/avahi

## Method 2: Flash-and-Go (New Pi)

Build a pre-configured SD card image:

```bash
# Without WiFi (ethernet only)
sudo ./flash-and-go.sh

# With WiFi
sudo ./flash-and-go.sh --wifi "MyNetwork" --pass "MyPassword"
```

Flash the output image:
```bash
dd if=aries-rpi.img of=/dev/sdX bs=4M status=progress
```

Or use **Raspberry Pi Imager** → Choose OS → Use custom → select `aries-rpi.img`

Boot the Pi → it auto-joins the swarm. Default login: `pi` / `aries2026`

## Supported Hardware

| Model | Arch | Performance | Notes |
|-------|------|-------------|-------|
| Pi Zero 2 W | armv7l | ~50 H/s | Low power, WiFi only |
| Pi 3 B+ | armv7l | ~80 H/s | Good starter |
| Pi 4 (4GB+) | arm64 | ~200 H/s | Best value |
| Pi 5 | arm64 | ~350 H/s | Top performer |

## Management

```bash
# Check status
systemctl status aries-worker

# View logs
journalctl -u aries-worker -f

# Restart
systemctl restart aries-worker

# Stop
systemctl stop aries-worker

# Uninstall
systemctl stop aries-worker
systemctl disable aries-worker
rm -rf /opt/aries-swarm /etc/systemd/system/aries-worker.service
systemctl daemon-reload
```

## Bulk Deploy

For deploying to many Pis at once, combine with Ansible:

```bash
# In deploy/ansible/inventory.ini, add Pi hosts
# Then run:
ansible-playbook -i inventory.ini deploy/ansible/playbook.yml
```
