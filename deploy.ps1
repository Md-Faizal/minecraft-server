# PowerShell 1-Click Remote Deploy Script
# Usage: .\deploy.ps1 [-HostName "my-mac"]

param(
    [string]$RemoteHost = "my-mac",
    [string]$RemoteDir = "/home/ubuntu/stack/games/minecraft"
)

$ErrorActionPreference = "Stop"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " Minecraft Server Manager: Remote Deploy " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Target Host: $RemoteHost" -ForegroundColor Yellow
Write-Host "Target Path: $RemoteDir" -ForegroundColor Yellow

# Step 1: Sync source code, templates, and static assets
Write-Host "`n[1/3] Syncing files to remote host..." -ForegroundColor Green
ssh $RemoteHost "mkdir -p $RemoteDir/src $RemoteDir/static $RemoteDir/templates"

scp Cargo.toml "$($RemoteHost):$($RemoteDir)/Cargo.toml"
scp -r src/* "$($RemoteHost):$($RemoteDir)/src/"
scp -r static/* "$($RemoteHost):$($RemoteDir)/static/"
scp -r templates/* "$($RemoteHost):$($RemoteDir)/templates/"

# Step 2: Build release binary on the remote host (native Linux x86_64)
Write-Host "`n[2/3] Building Rust release binary on remote host..." -ForegroundColor Green
ssh $RemoteHost @"
    set -e
    cd $RemoteDir
    source ~/.cargo/env 2>/dev/null || true
    echo "Running cargo build --release..."
    cargo build --release
    cp target/release/minecraft-server-manager ./minecraft-server-manager
    chmod +x ./minecraft-server-manager
"@

# Step 3: Update systemd and restart service
Write-Host "`n[3/3] Updating systemd service and restarting..." -ForegroundColor Green
ssh $RemoteHost @'
    set -e
    SERVICE_FILE="/etc/systemd/system/mc-manager.service"
    TARGET_DIR="/home/ubuntu/stack/games/minecraft"
    if grep -q "python3 src/app.py" "$SERVICE_FILE"; then
        echo "Updating systemd service to use Rust binary..."
        sudo sed -i 's|ExecStart=.*|ExecStart=/home/ubuntu/stack/games/minecraft/minecraft-server-manager|g' "$SERVICE_FILE"
        sudo systemctl daemon-reload
    fi
    echo "Restarting mc-manager service..."
    sudo systemctl restart mc-manager
    sleep 2
    curl -fsS http://127.0.0.1:5000/api/status
    echo ""
    echo "Service is UP and running healthy!"
'@

Write-Host "`nDeployment completed successfully!" -ForegroundColor Green
