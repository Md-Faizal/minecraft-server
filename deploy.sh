#!/usr/bin/env bash
# Shell 1-Click Remote Deploy Script
# Usage: ./deploy.sh [REMOTE_HOST]

set -euo pipefail

REMOTE_HOST="${1:-my-mac}"
REMOTE_DIR="/home/ubuntu/stack/games/minecraft"

echo "=========================================="
echo " Minecraft Server Manager: Remote Deploy "
echo "=========================================="
echo "Target Host: $REMOTE_HOST"
echo "Target Path: $REMOTE_DIR"

echo -e "\n[1/3] Syncing files to remote host..."
ssh "$REMOTE_HOST" "mkdir -p $REMOTE_DIR/src $REMOTE_DIR/static $REMOTE_DIR/templates"
scp Cargo.toml "$REMOTE_HOST:$REMOTE_DIR/Cargo.toml"
scp -r src/* "$REMOTE_HOST:$REMOTE_DIR/src/"
scp -r static/* "$REMOTE_HOST:$REMOTE_DIR/static/"
scp -r templates/* "$REMOTE_HOST:$REMOTE_DIR/templates/"

echo -e "\n[2/3] Building Rust release binary on remote host..."
ssh "$REMOTE_HOST" bash << EOF
    set -euo pipefail
    cd "$REMOTE_DIR"
    source ~/.cargo/env 2>/dev/null || true
    echo "Running cargo build --release..."
    cargo build --release
    install -m 755 target/release/minecraft-server-manager ./minecraft-server-manager
EOF

echo -e "\n[3/3] Updating systemd service and restarting..."
ssh "$REMOTE_HOST" bash << EOF
    set -euo pipefail
    SERVICE_FILE="/etc/systemd/system/mc-manager.service"
    if grep -q "python3 src/app.py" "\$SERVICE_FILE"; then
        echo "Updating systemd service to use Rust binary..."
        sudo sed -i 's|ExecStart=.*|ExecStart=$REMOTE_DIR/minecraft-server-manager|g' "\$SERVICE_FILE"
        sudo systemctl daemon-reload
    fi
    echo "Restarting mc-manager service..."
    sudo systemctl restart mc-manager
    sleep 2
    curl -fsS http://127.0.0.1:5000/api/status
    echo ""
    echo "Service is UP and running healthy!"
EOF

echo -e "\nDeployment completed successfully!"
