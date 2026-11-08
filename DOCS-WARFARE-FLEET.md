# ⚔️ Nexus Warfare Minecraft Fleet Architecture & Administration Guide

## 1. Executive Summary & Problem Resolution

During high-speed flight and exploration in Creative mode (e.g., using vehicles or jetpacks), rapid chunk generation previously pushed server RAM on the Google Cloud Platform (GCP) edge proxy to **96.6% (3.6 GB / 3.7 GB)**, causing thread stalling and server timeouts:
```text
[Server thread/WARN]: Can't keep up! Is the server overloaded?
[Server thread/ERROR]: Server timed out! (RAM: 96.6% - 3.6 GB / 3.7 GB)
```

To permanently solve this without paying high cloud compute fees, we redesigned the server infrastructure into a **Decoupled Edge-Mesh Architecture**:
1. **Edge VM (`pro` / `35.208.86.56`):**
   - Reclaimed **9.7 GB** of disk space by purging legacy Paper/Java server files, backups, and stale Docker builder caches (disk usage dropped from **78% down to 44%**, leaving **16 GB available**).
   - Functions strictly as a high-speed reverse proxy, public DNS ingress (`mine.faizal.uk`), SSL termination (Nginx), and Dockerized Rust Axum management portal.
   - Local Bedrock hosting remains available on-demand with minimal resource overhead.
2. **Bare-Metal Game Server (`rida@192.168.29.36` / `rida-260-P020il`):**
   - Hosts the heavy Forge 1.20.1 server with 16 GB RAM, dedicated CPU cores, and SSD storage.
   - Pre-generates terrain using **Chunky** to eliminate chunk generation lag permanently.
   - Runs `nexus-agent` with `"minecraft": true` for zero-trust remote management and hardware telemetry.
3. **Encrypted Tunnel Bridge:**
   - Auto-healing reverse SSH tunnel connects the bare-metal server directly to GCP `pro`, exposing game port `25565` and loopback RCON port `25575`.

---

## 2. Infrastructure Architecture Diagram

```
       [ Public Internet / Minecraft Players ]
                         │
                         ▼
             mine.faizal.uk (35.208.86.56)
  ┌────────────────────────────────────────────────────────┐
  │ GCP Compute Engine ("pro" - e2-small / 4GB RAM)        │
  │                                                        │
  │  Nginx Ingress (Port 80/443 SSL)                       │
  │    │                                                   │
  │    ▼                                                   │
  │  Rust Axum Portal (Docker: 127.0.0.1:5000)             │
  │    ├── Zentra Dark Theme UI (index.html + app.js)      │
  │    ├── Async Tokio RCON Client (127.0.0.1:25575)       │
  │    ├── Nexus Mesh Fleet RPC (https://faizal.uk)        │
  │    └── Modpack Server (/download/mods -> 196 MB)       │
  │                                                        │
  │  Game Ingress (TCP 25565)                              │
  └───────────────▲──────────────────────▲─────────────────┘
                  │                      │
       Loopback Reverse Tunnel   Player Traffic Tunnel
          (Port 25575 RCON)         (Port 25565)
                  │                      │
  ┌───────────────┴──────────────────────┴─────────────────┐
  │ Bare-Metal Host (rida-260-P020il / Zorin OS 17)        │
  │                                                        │
  │  systemd: nexus-tunnel-client.service                  │
  │    └── autossh -N -R 25565:localhost:25565             │
  │                   -R 25575:localhost:25575             │
  │                                                        │
  │  systemd: minecraft-server.service                     │
  │    └── OpenJDK 17 + Forge 1.20.1-47.4.20               │
  │        ├── Aikar's Optimized G1GC JVM Flags            │
  │        ├── Chunky Pre-generation (5,000 block radius)  │
  │        ├── Timeless and Classics Zero (TACZ Guns)      │
  │        └── HBM Nuclear Tech & Warfare Modpack          │
  │                                                        │
  │  systemd: nexus-agent.service                          │
  │    └── Fleet Telemetry (CPU, RAM, Temp, Gaming Mode)   │
  └────────────────────────────────────────────────────────┘
```

---

## 3. Chunky World Pre-Generation

### Why Chunky?
In Minecraft 1.20.1, world generation during real-time flight consumes up to 85% of CPU time and triggers severe memory pressure. Pre-generating the world saves all chunk data to disk beforehand so the server only performs fast disk reads when players explore.

### Configuration & Active Task:
- **World:** `overworld`
- **Center:** `X: 0, Z: 0` (Spawn point)
- **Shape:** `Circle`
- **Radius:** `5,000` blocks
- **Total Chunks:** `~96,100` chunks
- **Status:** Actively generating (over 25,400+ chunks completed)
- **Telemetry Integration:** Rate (`cps`), processed chunk count, percentage, and ETA are parsed via async RCON and displayed in real time on `https://mine.faizal.uk`.

### RCON Commands for Chunky:
```bash
# Check generation progress
chunky progress

# Pause generation during intense player warfare
chunky pause

# Resume generation
chunky continue

# Cancel active task
chunky cancel
```

---

## 4. Hardware Telemetry & Headless Gaming Mode

The bare-metal server runs `nexus-agent` which communicates with the Nexus Central Fleet Hub (`https://faizal.uk`).

### Telemetry Tracked:
- **CPU:** Real-time utilization % and logical core count (Intel Core i3-6100 @ 3.70 GHz).
- **RAM:** Total, used, available, and percentage.
- **Thermals:** Core package temperatures in °C.
- **Mode:** Headless Gaming Mode vs Desktop GUI.

### Headless Gaming Mode (`minecraft_mode`):
When activated via the portal or CLI:
1. Stops the Zorin desktop display manager (`systemctl isolate multi-user.target`).
2. Disables Xorg / Wayland and desktop background tasks.
3. Frees **1.2 GB+ of RAM** exclusively for the Minecraft Forge JVM.
4. Switches back seamlessly to `normal_mode` (`systemctl isolate graphical.target`) when desktop use is required.

---

## 5. Web Management Portal (`mine.faizal.uk`)

### Stack:
- **Language:** 100% Rust (Axum 0.7 + Tokio async runtime + Tower HTTP + Reqwest).
- **Frontend:** Responsive Zentra Dark Theme UI with glassmorphism, responsive status badges, drag-and-drop tab navigation, and live polling.
- **Containerization:** Multi-stage Docker build utilizing Temurin Adoptium JRE and Alpine/Ubuntu runner, deployed via GitHub Actions CI/CD with `rust-cache` and `mold` linker.

### Key Routes:
| Endpoint | Method | Description |
|---|---|---|
| `/` | `GET` | Serves main Zentra portal dashboard |
| `/api/status` | `GET` | Aggregated status: Forge RCON players, Chunky stats, node hardware telemetry |
| `/api/java/status` | `GET` | Forge 1.20.1 dedicated status |
| `/api/command` | `POST` | Executes RCON command on Forge server with live terminal feedback |
| `/api/action` | `POST` | Dispatches actions: `minecraft_mode`, `normal_mode`, `restart`, `chunky_pause`, `chunky_resume` |
| `/download/mods` | `GET` | Direct high-speed download of `Warfare_Mods_For_Friend.zip` (196 MB) |

---

## 6. Service & CLI Reference

### A. Bare-Metal Zorin Host Services:
```bash
# Minecraft Forge 1.20.1 Service
sudo systemctl status minecraft-server.service
sudo systemctl restart minecraft-server.service
sudo journalctl -u minecraft-server.service -f -n 100

# Reverse SSH Tunnel Bridge
sudo systemctl status nexus-tunnel-client.service
sudo systemctl restart nexus-tunnel-client.service

# Nexus Fleet Agent
sudo systemctl status nexus-agent.service
sudo journalctl -u nexus-agent.service -f
```

### B. Nexus Fleet CLI Commands:
```bash
# Inspect registered fleet nodes
nexus nodes

# Query bare-metal host telemetry
nexus node rida-260-P020il

# Dispatch Headless Gaming Mode remotely
nexus exec rida-260-P020il "sudo systemctl isolate multi-user.target"

# Dispatch Desktop GUI Mode remotely
nexus exec rida-260-P020il "sudo systemctl isolate graphical.target"
```

### C. GCP Edge Proxy Commands:
```bash
# Check Dockerized Rust Portal
cd /home/ubuntu/minecraft-deploy
docker compose ps
docker compose logs -f --tail=100

# Test local RCON connectivity
nc -zv 127.0.0.1 25575

# Test game port forwarding
nc -zv 127.0.0.1 25565
```

---

## 7. Storage Cleanup Audit

| Location | Prior Usage | Post-Cleanup Usage | Reclaimed Space |
|---|---|---|---|
| GCP `pro` VM `/` Disk | 22 GB (78%) | 12.3 GB (44%) | **~9.7 GB Reclaimed** |
| GCP Java/Paper Folder | 7.2 GB | 0 GB (Removed) | **7.2 GB Reclaimed** |
| GCP Backup Archives | 2.1 GB | 0 GB (Removed) | **2.1 GB Reclaimed** |
| GCP Docker Build Cache| 800 MB | 0 MB (Pruned) | **800 MB Reclaimed** |

