#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  Aries Swarm — Flash-and-Go Raspberry Pi Image Builder
#  Creates a pre-configured Raspbian image that auto-joins swarm
#  Usage: ./flash-and-go.sh [--wifi "SSID" --pass "password"]
#  Then flash to SD card: dd if=aries-rpi.img of=/dev/sdX bs=4M
# ═══════════════════════════════════════════════════════════════

set -e

WIFI_SSID=""
WIFI_PASS=""
COUNTRY="US"
IMG_URL="https://downloads.raspberrypi.com/raspios_lite_arm64/images/raspios_lite_arm64-2024-03-15/2024-03-15-raspios-bookworm-arm64-lite.img.xz"
IMG_FILE="raspios-lite.img.xz"
OUTPUT_IMG="aries-rpi.img"
SETUP_SCRIPT="$(dirname "$0")/setup-rpi.sh"
HOSTNAME_PREFIX="aries-worker"

# ── Parse arguments ──
while [[ $# -gt 0 ]]; do
    case $1 in
        --wifi) WIFI_SSID="$2"; shift 2 ;;
        --pass) WIFI_PASS="$2"; shift 2 ;;
        --country) COUNTRY="$2"; shift 2 ;;
        --img) IMG_URL="$2"; shift 2 ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

log() { echo "[flash-and-go] $1"; }

# ── Check dependencies ──
for cmd in wget xz losetup mount umount; do
    command -v "$cmd" &>/dev/null || { log "Missing: $cmd"; exit 1; }
done

if [ "$(id -u)" -ne 0 ]; then
    log "This script requires root (for image mounting)"
    log "Run: sudo $0 $@"
    exit 1
fi

# ── Download image if needed ──
if [ ! -f "$IMG_FILE" ]; then
    log "Downloading Raspberry Pi OS Lite..."
    wget -q --show-progress "$IMG_URL" -O "$IMG_FILE"
fi

# ── Decompress ──
log "Decompressing image..."
xz -dk "$IMG_FILE" 2>/dev/null || true
RAW_IMG="${IMG_FILE%.xz}"
cp "$RAW_IMG" "$OUTPUT_IMG"

# ── Expand image (add 200MB for our files) ──
log "Expanding image..."
truncate -s +200M "$OUTPUT_IMG"

# ── Mount image ──
log "Mounting image..."
LOOP=$(losetup --find --show --partscan "$OUTPUT_IMG")
BOOT_PART="${LOOP}p1"
ROOT_PART="${LOOP}p2"

# Expand root partition
parted -s "$LOOP" resizepart 2 100% 2>/dev/null || true
e2fsck -fy "$ROOT_PART" 2>/dev/null || true
resize2fs "$ROOT_PART" 2>/dev/null || true

BOOT_MNT=$(mktemp -d)
ROOT_MNT=$(mktemp -d)

mount "$BOOT_PART" "$BOOT_MNT"
mount "$ROOT_PART" "$ROOT_MNT"

# ── Enable SSH ──
log "Enabling SSH..."
touch "$BOOT_MNT/ssh"

# ── Set hostname ──
RANDOM_ID=$(head -c 4 /dev/urandom | xxd -p)
NEW_HOSTNAME="${HOSTNAME_PREFIX}-${RANDOM_ID}"
echo "$NEW_HOSTNAME" > "$ROOT_MNT/etc/hostname"
sed -i "s/127.0.1.1.*/127.0.1.1\t${NEW_HOSTNAME}/" "$ROOT_MNT/etc/hosts"
log "Hostname: $NEW_HOSTNAME"

# ── Configure WiFi (if provided) ──
if [ -n "$WIFI_SSID" ]; then
    log "Configuring WiFi: $WIFI_SSID"
    
    # For Bookworm (NetworkManager)
    mkdir -p "$ROOT_MNT/etc/NetworkManager/system-connections"
    cat > "$ROOT_MNT/etc/NetworkManager/system-connections/aries-wifi.nmconnection" <<EOF
[connection]
id=aries-wifi
type=wifi
autoconnect=true

[wifi]
ssid=$WIFI_SSID
mode=infrastructure

[wifi-security]
key-mgmt=wpa-psk
psk=$WIFI_PASS

[ipv4]
method=auto

[ipv6]
method=auto
EOF
    chmod 600 "$ROOT_MNT/etc/NetworkManager/system-connections/aries-wifi.nmconnection"

    # Legacy wpa_supplicant fallback
    cat > "$BOOT_MNT/wpa_supplicant.conf" <<EOF
ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
update_config=1
country=$COUNTRY

network={
    ssid="$WIFI_SSID"
    psk="$WIFI_PASS"
    key_mgmt=WPA-PSK
}
EOF
fi

# ── Inject setup script as first-boot ──
log "Injecting Aries setup script..."
cp "$SETUP_SCRIPT" "$ROOT_MNT/opt/aries-setup.sh"
chmod +x "$ROOT_MNT/opt/aries-setup.sh"

# Create first-boot service
cat > "$ROOT_MNT/etc/systemd/system/aries-firstboot.service" <<EOF
[Unit]
Description=Aries Swarm First Boot Setup
After=network-online.target
Wants=network-online.target
ConditionPathExists=/opt/aries-setup.sh

[Service]
Type=oneshot
ExecStart=/bin/bash /opt/aries-setup.sh
ExecStartPost=/bin/rm -f /opt/aries-setup.sh
ExecStartPost=/bin/systemctl disable aries-firstboot.service
RemainAfterExit=yes
StandardOutput=journal+console

[Install]
WantedBy=multi-user.target
EOF

# Enable the first-boot service
ln -sf /etc/systemd/system/aries-firstboot.service \
    "$ROOT_MNT/etc/systemd/system/multi-user.target.wants/aries-firstboot.service"

# ── Set default password (pi/aries2026) ──
HASH=$(echo 'aries2026' | openssl passwd -6 -stdin)
echo "pi:${HASH}" > "$BOOT_MNT/userconf.txt"

# ── Cleanup ──
log "Unmounting..."
sync
umount "$BOOT_MNT"
umount "$ROOT_MNT"
losetup -d "$LOOP"
rmdir "$BOOT_MNT" "$ROOT_MNT"

SIZE=$(du -h "$OUTPUT_IMG" | cut -f1)
log "═══════════════════════════════════════"
log "  Image ready: $OUTPUT_IMG ($SIZE)"
log "  Hostname: $NEW_HOSTNAME"
log "  User: pi / aries2026"
if [ -n "$WIFI_SSID" ]; then
    log "  WiFi: $WIFI_SSID"
fi
log ""
log "  Flash to SD card:"
log "    dd if=$OUTPUT_IMG of=/dev/sdX bs=4M status=progress"
log ""
log "  Or use Raspberry Pi Imager with custom image"
log "═══════════════════════════════════════"
