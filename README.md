# Minecraft Bedrock & Java Server Web Manager

A high-performance, asynchronous web management portal and headless controller for Minecraft Bedrock Dedicated Server (BDS) and Paper for Java Edition, rewritten in **Rust** (Tokio + Axum).

---

## ⚡ Recent Fixes & Upgrades

### 1. NetherNet Transport Support (Minecraft Bedrock 1.26+)
In recent releases of the Minecraft Bedrock Dedicated Server, NetherNet (WebRTC-based signaling + UDP peer-to-peer transport) is the required transport type.
- **Error Resolved**:
  ```text
  [ERROR] Your current connection type is not set to NetherNet. In this release, NetherNet is the only supported transport type.
  [ERROR] Players will not be able to connect to your game without NetherNet.
  [ERROR] To switch, set 'transport=nethernet' in server.properties.
  ```
- **Fix Applied**:
  - `transport=nethernet` was configured in `server.properties` and in world configurations (`data/world_configs/`).
  - The properties schema now includes `transport` (choices: `nethernet`, `raknet`, default `nethernet`) so saving settings never strips this directive.

### 2. High-Performance Rust Backend
- Replaced Python/Flask with **Tokio + Axum 0.7**.
- Native non-blocking I/O, asynchronous subprocess piping, and streaming console buffer.
- Sub-millisecond latency, minimal memory usage (< 5MB RAM vs 90MB+ in Python), and zero garbage collection spikes.
- Full API compatibility with the web dashboard.

---

## 🚀 Deployment Options

## ☕ Paper Java Server

The dashboard has a separate **Java Server** page for Paper installation, updates, lifecycle controls, and console commands. Paper data lives in a separate `java/` folder under the manager's data directory; it does not modify Bedrock worlds or settings.

1. Install a Java runtime on the manager host. Java 21 supports current Minecraft 1.20–1.21 Paper releases; newer Minecraft releases may require Java 25 or later. The manager detects the installed Java version and offers the newest compatible stable Paper build.
2. Open **Java Server**, read and accept the [Minecraft EULA](https://aka.ms/MinecraftEULA), then select **Install latest Paper**. The manager downloads the official PaperMC release, verifies its published SHA-256 checksum, and installs it. Updates preserve the previous jar in the `java/backups/` directory.
3. Start Paper from the dashboard. The manager uses a conservative 256 MB initial / 512 MB maximum Java heap for small VMs.
4. Allow inbound **TCP 25565** in the cloud firewall and host firewall. Bedrock continues to use its existing UDP ports.

Bedrock remains configured to auto-start by default for backwards compatibility; Java auto-start is off by default. For Java-only mode, set `MC_AUTO_START_BEDROCK=false` and `MC_AUTO_START_JAVA=true` in the manager's service environment (or in the Compose `.env` file), then restart the manager. If you keep Bedrock auto-start enabled, stop it from its existing controls before starting Paper to conserve memory. Both processes can be run, but a micro VM may run out of memory.

### Method 1: Automatic GitHub Actions CI/CD
A GitHub Actions workflow is configured in `.github/workflows/deploy.yml`.

Whenever you push to the `main` branch (or run manually via **Actions** -> **Run workflow**):
1. GitHub Actions compiles the Rust binary for Linux x86_64 in release mode (`--release`).
2. Artifacts are cached with `Swatinem/rust-cache` for fast build times (~20-30s).
3. The binary and static assets are copied to the VM over SSH.
4. The systemd service `mc-manager.service` is updated and restarted automatically.
5. An automated health check tests `/api/status`.

#### Required GitHub Secrets:
Go to **Settings** -> **Secrets and variables** -> **Actions** -> **New repository secret**:
| Secret Name | Value | Description |
|---|---|---|
| `SSH_HOST` | `68.233.115.138` | VM Host / IP address |
| `SSH_USER` | `ubuntu` | SSH Username |
| `SSH_KEY` | *(Private Key Content)* | SSH private key (`ssh-key-2026-03-08.key`) |
| `SSH_PORT` | `22` *(Optional)* | SSH port (defaults to 22) |

---

### Method 2: Local 1-Click PowerShell Deploy (Windows)
Run directly from PowerShell:
```powershell
.\deploy.ps1
```
*Custom host or directory:*
```powershell
.\deploy.ps1 -RemoteHost "my-mac" -RemoteDir "/home/ubuntu/stack/games/minecraft"
```

### Method 3: Local 1-Click Bash Deploy (Linux / macOS)
```bash
chmod +x deploy.sh
./deploy.sh my-mac
```

---

## 🛠️ Service Management

To check logs or status on the remote server (`my-mac`):

```bash
# Check service status
sudo systemctl status mc-manager

# View live service logs
journalctl -u mc-manager.service -f

# Restart service
sudo systemctl restart mc-manager
```

Web management interface URL: `https://mine.faizal.uk`
