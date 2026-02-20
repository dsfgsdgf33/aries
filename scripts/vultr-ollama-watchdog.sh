#!/bin/bash
# ARIES Vultr Ollama Watchdog Setup
# Run this ONCE on the Vultr VM to ensure Ollama never stays down
# Usage: bash vultr-ollama-watchdog.sh

echo "=== ARIES Ollama Watchdog Setup ==="

# 1. Create systemd service for Ollama
cat > /etc/systemd/system/ollama.service << 'EOF'
[Unit]
Description=Ollama AI Server
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/ollama serve
Restart=always
RestartSec=5
Environment="OLLAMA_HOST=0.0.0.0"
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

# 2. Create a watchdog script that checks every 30s
cat > /usr/local/bin/ollama-watchdog.sh << 'WEOF'
#!/bin/bash
while true; do
    # Check if ollama is responding
    if ! curl -sf http://localhost:11434/api/tags > /dev/null 2>&1; then
        echo "[$(date)] Ollama is DOWN — restarting..."
        systemctl restart ollama
        sleep 10
        # Verify it came back
        if curl -sf http://localhost:11434/api/tags > /dev/null 2>&1; then
            echo "[$(date)] Ollama restarted successfully"
        else
            echo "[$(date)] Ollama restart FAILED — trying again in 30s"
        fi
    fi
    sleep 30
done
WEOF
chmod +x /usr/local/bin/ollama-watchdog.sh

# 3. Create systemd service for the watchdog
cat > /etc/systemd/system/ollama-watchdog.service << 'EOF'
[Unit]
Description=Ollama Watchdog (auto-restart)
After=ollama.service

[Service]
Type=simple
ExecStart=/usr/local/bin/ollama-watchdog.sh
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# 4. Enable and start everything
systemctl daemon-reload
systemctl enable ollama
systemctl enable ollama-watchdog
systemctl start ollama
sleep 3
systemctl start ollama-watchdog

# 5. Also ensure relay auto-restarts
if [ -f /etc/systemd/system/aries-relay.service ]; then
    systemctl enable aries-relay
    systemctl restart aries-relay
fi

echo ""
echo "=== Setup Complete ==="
echo "Ollama: $(systemctl is-active ollama)"
echo "Watchdog: $(systemctl is-active ollama-watchdog)"
echo "Relay: $(systemctl is-active aries-relay 2>/dev/null || echo 'not found')"
echo ""
echo "Ollama will now auto-restart within 30 seconds if it ever goes down."
echo "Check status: systemctl status ollama ollama-watchdog"
