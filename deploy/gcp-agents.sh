#!/bin/bash
# ARIES — GCP Swarm Agent Deployment
# Deploys provider manager + swarm agents to GCP VM
# Usage: bash deploy/gcp-agents.sh [GCP_INSTANCE] [ZONE]

set -e

INSTANCE="${1:-aries-monitor}"
ZONE="${2:-us-central1-a}"
PROJECT="$(gcloud config get-value project 2>/dev/null)"
REMOTE_DIR="/opt/aries"

echo "=== ARIES Swarm Agent Deployment ==="
echo "Instance: $INSTANCE | Zone: $ZONE | Project: $PROJECT"

# Files to deploy
FILES=(
  "core/provider-manager.js"
  "core/swarm-agents.js"
  "core/headless.js"
  "core/api-server.js"
  "web/index.html"
  "web/app.js"
)

echo ""
echo "[1/4] Validating syntax locally..."
for f in "${FILES[@]}"; do
  if [[ "$f" == *.js ]]; then
    node -c "$f" && echo "  ✓ $f" || { echo "  ✗ $f FAILED"; exit 1; }
  fi
done

echo ""
echo "[2/4] Copying files to GCP..."
for f in "${FILES[@]}"; do
  dir=$(dirname "$f")
  gcloud compute ssh "$INSTANCE" --zone="$ZONE" --command="mkdir -p $REMOTE_DIR/$dir" 2>/dev/null
  gcloud compute scp "$f" "$INSTANCE:$REMOTE_DIR/$f" --zone="$ZONE"
  echo "  → $f"
done

echo ""
echo "[3/4] Ensuring data directory exists..."
gcloud compute ssh "$INSTANCE" --zone="$ZONE" --command="mkdir -p $REMOTE_DIR/data"

echo ""
echo "[4/4] Restarting Aries service..."
gcloud compute ssh "$INSTANCE" --zone="$ZONE" --command="
  cd $REMOTE_DIR
  # Check syntax on remote
  for f in core/provider-manager.js core/swarm-agents.js core/headless.js core/api-server.js; do
    node -c \$f || exit 1
  done
  # Restart if systemd service exists, otherwise use pm2 or direct
  if systemctl is-active --quiet aries 2>/dev/null; then
    sudo systemctl restart aries
    echo 'Restarted via systemd'
  elif command -v pm2 &>/dev/null && pm2 list | grep -q aries; then
    pm2 restart aries
    echo 'Restarted via pm2'
  else
    # Kill existing and restart
    pkill -f 'node.*headless' || true
    sleep 1
    nohup node core/headless.js > /tmp/aries.log 2>&1 &
    echo 'Started directly (PID: $!)'
  fi
"

echo ""
echo "=== Deployment Complete ==="
echo "Dashboard: http://$(gcloud compute instances describe $INSTANCE --zone=$ZONE --format='get(networkInterfaces[0].accessConfigs[0].natIP)'):3333"
echo ""
echo "Next steps:"
echo "  1. Add API keys via dashboard → Swarm Manager → +Provider"
echo "  2. Test providers"
echo "  3. Create swarm agents"
