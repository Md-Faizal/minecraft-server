# Universal Minecraft Server Manager (Bedrock & Java)

A high-performance, asynchronous web management portal, telemetry HUD, and headless remote controller for **Minecraft Bedrock Dedicated Server (BDS)** and **Java Edition** (Vanilla, Paper, Forge, Fabric, Purpur, etc.), built in **Rust** (Tokio + Axum).

Designed with a **function-over-form** approach: dynamic auto-detection, zero hardcoded assumptions, deep hardware telemetry, remote host control, and cross-machine command tunneling via Nexus Mesh RPC and RCON.

---

## 🚀 Key Features

- **Dynamic Auto-Detection (Zero Hardcoding)**:
  - Dynamically detects any Bedrock binary (`bedrock_server`, `bedrock_server.exe`, or custom path via `MC_BEDROCK_BIN`).
  - Dynamically discovers Java server jars (Vanilla, Paper, Forge, Fabric, NeoForge, Spigot) and detects Java runtimes without assuming a fixed distribution or version.
  - No hardcoded IPs, hostnames, passwords, or personal paths anywhere in the codebase.
- **Universal Multi-Edition Architecture**:
  - Independent or simultaneous control of Bedrock and Java editions.
  - Full support for Bedrock **NetherNet** and RakNet transport modes.
  - Remote Java server management via **RCON** or **Nexus Mesh Fleet RPC**.
- **Real-Time Remote PC & Hardware Telemetry HUD**:
  - Live CPU utilization, model, and core count.
  - Memory consumption (used vs total) with visual gauges.
  - Remote thermals / CPU package temperatures.
  - System uptime and live host status.
  - **One-Click Host Mode Switcher**: Toggle remote game nodes between **Headless Gaming Mode** (`systemctl isolate multi-user.target`) and **Desktop GUI Mode** (`systemctl isolate graphical.target`) directly from the dashboard to optimize resource allocation on constrained servers.
- **Universal Command Console & Mesh Tunneling**:
  - Interactive multi-edition terminal console with history and auto-complete (`op`, `gamemode`, `whitelist`, `chunky`, `teleport`, etc.).
  - Automatic fallback routing: Local standard input/output $\to$ Remote RCON $\to$ Nexus Mesh CLI Agent Network RPC.
- **Universal Properties Editor**:
  - Complete, safe, and transparent editing of `server.properties`.
  - Zero silent mutations or forced boot-time overrides.
  - Real-time search and filter across Gameplay, Networking, Security, and World parameters, with support for any custom/modded property keys.
- **PIN Authentication & Auto-Login**:
  - Lightweight 4-digit PIN security barrier with SHA-256 hashing.
  - Local browser session caching for seamless auto-login.
  - PIN management and reset directly from the web settings dialog.

---

## 📦 Quick Start with Docker Compose

1. **Clone the repository and copy the environment template**:
   ```bash
   cp .env.example .env
   ```

2. **Configure your `.env` settings**:
   ```env
   PORT=5000
   HOST=0.0.0.0
   MINECRAFT_BASE_DIR=./data
   ADMIN_PIN=1234

   # Optional remote host & Nexus Mesh integration
   NEXUS_HUB_URL=
   NEXUS_ADMIN_PIN=
   RCON_ADDR=
   RCON_PASSWORD=
   ```

3. **Start the manager**:
   ```bash
   docker compose up -d
   ```

4. **Access the Web Dashboard**:
   Open `http://localhost:5000` (or your server's IP address) in your browser.

---

## 🛠️ Direct Binary Build (Rust)

### Prerequisites
- Rust 1.80+ (`cargo`)
- (Optional) Java runtime (JRE 21 or 25) if running local Java servers.

### Build and Run
```bash
# Debug build for development
cargo run

# Optimized production release build
cargo build --release
./target/release/minecraft-server-manager
```

---

## 🌐 API Overview

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/capabilities` | Detects installed editions, active bindings, and mesh status |
| `GET` | `/api/status` | Bedrock server running status, players, memory, world |
| `POST` | `/api/start` | Starts the Bedrock server |
| `POST` | `/api/stop` | Stops the Bedrock server cleanly |
| `GET` | `/api/java/status` | Java server status, remote RCON/Nexus connectivity, Chunky progress |
| `POST` | `/api/java/start` | Starts the Java server |
| `POST` | `/api/java/stop` | Stops the Java server cleanly |
| `POST` | `/api/command` | Dispatches console commands (stdin $\to$ RCON $\to$ Nexus Mesh) |
| `GET` | `/api/telemetry` | Hardware metrics (CPU, RAM, thermals, uptime, active node) |
| `POST` | `/api/host/mode` | Toggles host mode (`minecraft_mode` or `normal_mode`) |
| `GET` | `/api/properties` | Returns complete key-value mapping of `server.properties` |
| `POST` | `/api/properties` | Updates `server.properties` without discarding custom keys |
| `GET` | `/api/auth/status` | Checks if a PIN is configured and verifies session |
| `POST` | `/api/auth/verify` | Authenticates a 4-digit PIN |
| `POST` | `/api/auth/change_pin` | Changes the configured 4-digit PIN |

---

## 🔒 Security Best Practices

- When exposing the dashboard across public networks, place an Nginx / Caddy reverse proxy with SSL termination in front of port 5000.
- Use `ADMIN_PIN` in your environment or set a PIN from the Settings view to guard console commands and server lifecycle controls.
