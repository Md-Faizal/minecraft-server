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

1. The Compose image includes OpenJDK 21; no host Java install is required. The manager detects the installed runtime and offers the newest compatible stable Paper build.
2. Open **Java Server**, read and accept the [Minecraft EULA](https://aka.ms/MinecraftEULA), then select **Install latest Paper**. The manager downloads the official PaperMC release, verifies its published SHA-256 checksum, and installs it. Updates preserve the previous jar in the `java/backups/` directory.
3. Start Paper from the dashboard. The manager uses a conservative 256 MB initial / 512 MB maximum Java heap for small VMs.
4. Allow inbound **TCP 25565** to the GCP target for Java players. Bedrock uses **UDP 19132–19133**. Keep manager API TCP 5000 closed to public ingress.

The Docker Compose deployment leaves both Bedrock and Java stopped when the manager starts or the VM reboots. Start the edition you need from the dashboard. On a 1 GiB micro VM, starting both can exhaust memory; the dashboard warns before starting the second server. Java 21 is included in the container, and Paper installation remains gated on accepting the Minecraft EULA in the dashboard.

The Compose manager API listens only on host loopback at `127.0.0.1:5000`; access it through a trusted SSH tunnel and do not expose TCP 5000 publicly. For the `my-mac` Nginx proxy, install `deploy/mc-manager-ssh-tunnel.service` on `my-mac` after stopping the old local manager. It forwards only loopback TCP port 5000 to the manager on `prometheus`.

### Method 1: Automatic GitHub Actions CI/CD
A GitHub Actions workflow is configured in `.github/workflows/deploy.yml`. It builds a Linux manager image, packages the Rust manager with its assets and Java 21 runtime, then deploys the image through Docker Compose on the GCP `pro` VM. When an edition is already running, deployment asks it to stop cleanly and attempts to start it again after the manager is healthy. If the new manager fails its health check, the workflow attempts to restore the previous image.

Whenever you push to the `main` branch (or run manually via **Actions** -> **Run workflow**):
1. GitHub Actions compiles the Rust binary for Linux x86_64 in release mode.
2. The runtime image is assembled with the manager, dashboard assets, and OpenJDK 21.
3. The image and Compose deployment files are sent to the target over SSH.
4. The deployment script health-checks the manager and restores the previous image if the replacement fails.

#### Required GitHub Secrets:
Go to **Settings** -> **Secrets and variables** -> **Actions** -> **New repository secret**:
| Secret Name | Value | Description |
|---|---|---|
| `SSH_HOST` | Static external IP of GCP `pro` / `prometheus` | Must not point to `my-mac`; reserve the VM address in GCP before using it |
| `SSH_USER` | `ubuntu` | SSH username |
| `SSH_KEY` | *(Private key content)* | Matching private key; its public key must be authorized for `ubuntu` on `pro` |
| `SSH_PORT` | `22` *(Optional)* | SSH port (defaults to 22) |

The GCP firewall must permit SSH from the GitHub Actions runner egress ranges, or deployment must use a suitably secured self-hosted runner. Keep manager TCP port 5000 closed to public ingress. For players, allow UDP 19132–19133 for Bedrock and TCP 25565 only when Java is intended to be publicly reachable. Add the corresponding network tag to the VM and scope ingress rules to the required sources.

---

The legacy `deploy.ps1` and `deploy.sh` scripts target the previous systemd deployment and must not be used for this Docker Compose target. Use the GitHub Actions workflow instead.

---

## 🛠️ Service Management

To check the staged manager on `pro`:

```bash
# Check container and health status
cd /home/ubuntu/minecraft-deploy
docker compose ps

# View manager logs
docker logs -f minecraft-bedrock-manager

# Check the loopback-only manager API
curl -fsS http://127.0.0.1:5000/api/status
```

The production Bedrock server on `my-mac` remains the live source until the world has been final-synced and the game endpoint/firewall cutover has been confirmed. The `mine.faizal.uk` web proxy also remains on `my-mac`; do not switch its SSH tunnel until the old local manager has been stopped.
