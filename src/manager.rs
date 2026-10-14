use std::collections::{HashMap, HashSet, VecDeque};
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Local};
use regex::Regex;
use serde_json::{json, Value};
use tokio::io::AsyncWriteExt;
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, Mutex, RwLock};
use tracing::{error, info};

use crate::models::*;

pub struct ServerManager {
    pub base_dir: PathBuf,
    pub worlds_dir: PathBuf,
    pub backup_dir: PathBuf,
    pub server_path: PathBuf,
    pub server_properties: PathBuf,
    pub resource_packs_dir: PathBuf,
    pub behavior_packs_dir: PathBuf,
    pub data_dir: PathBuf,

    child_process: Arc<Mutex<Option<Child>>>,
    stdin_tx: Arc<Mutex<Option<mpsc::UnboundedSender<String>>>>,
    pub console_buffer: Arc<RwLock<VecDeque<String>>>,
    pub online_players: Arc<RwLock<HashSet<String>>>,
    pub player_session_times: Arc<RwLock<HashMap<String, (DateTime<Local>, String)>>>,
    pub update_state: Arc<RwLock<UpdateState>>,
    pub is_running: Arc<AtomicBool>,
}

impl ServerManager {
    pub fn new(base_dir: PathBuf) -> Arc<Self> {
        info!("Initializing ServerManager at {:?}", base_dir);
        let worlds_dir = base_dir.join("worlds");
        let backup_dir = base_dir.join("backups");
        let server_path = base_dir.join("bedrock_server");
        let server_properties = base_dir.join("server.properties");
        let resource_packs_dir = base_dir.join("resource_packs");
        let behavior_packs_dir = base_dir.join("behavior_packs");
        let data_dir = base_dir.join("data");

        let _ = fs::create_dir_all(&worlds_dir);
        let _ = fs::create_dir_all(&backup_dir);
        let _ = fs::create_dir_all(&resource_packs_dir);
        let _ = fs::create_dir_all(&behavior_packs_dir);
        let _ = fs::create_dir_all(&data_dir);

        let global_json = data_dir.join("player_list.json");
        if !global_json.exists() {
            let _ = fs::write(&global_json, "{}");
        }

        let hist_json = data_dir.join("player_history.json");
        if !hist_json.exists() {
            let _ = fs::write(&hist_json, "{}");
        }

        Arc::new(Self {
            base_dir,
            worlds_dir,
            backup_dir,
            server_path,
            server_properties,
            resource_packs_dir,
            behavior_packs_dir,
            data_dir,
            child_process: Arc::new(Mutex::new(None)),
            stdin_tx: Arc::new(Mutex::new(None)),
            console_buffer: Arc::new(RwLock::new(VecDeque::with_capacity(250))),
            online_players: Arc::new(RwLock::new(HashSet::new())),
            player_session_times: Arc::new(RwLock::new(HashMap::new())),
            update_state: Arc::new(RwLock::new(UpdateState::default())),
            is_running: Arc::new(AtomicBool::new(false)),
        })
    }

    pub async fn is_server_running(&self) -> bool {
        let mut proc_guard = self.child_process.lock().await;
        if let Some(child) = proc_guard.as_mut() {
            match child.try_wait() {
                Ok(None) => return true,
                _ => {
                    *proc_guard = None;
                    self.is_running.store(false, Ordering::SeqCst);
                }
            }
        }

        // On Linux, check if process exists via pgrep
        #[cfg(target_os = "linux")]
        {
            if let Ok(output) = std::process::Command::new("pgrep")
                .arg("-f")
                .arg("bedrock_server")
                .output()
            {
                if !output.stdout.is_empty() {
                    return true;
                }
            }
        }

        self.is_running.load(Ordering::SeqCst)
    }

    pub async fn start_server(self: &Arc<Self>) -> bool {
        if self.is_server_running().await {
            info!("Start requested but server is already running");
            return false;
        }

        info!("Starting Bedrock Dedicated Server...");
        self.ensure_per_world_properties();

        let mut cmd = Command::new(&self.server_path);
        cmd.current_dir(&self.base_dir);
        cmd.stdin(Stdio::piped());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        #[cfg(target_os = "linux")]
        {
            cmd.env("LD_LIBRARY_PATH", &self.base_dir);
        }

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                error!("Failed to spawn bedrock_server: {}", e);
                return false;
            }
        };

        let stdin = child.stdin.take();
        let (tx, mut rx) = mpsc::unbounded_channel::<String>();
        *self.stdin_tx.lock().await = Some(tx);

        if let Some(mut stdin_pipe) = stdin {
            tokio::spawn(async move {
                while let Some(command) = rx.recv().await {
                    let mut line = command;
                    if !line.ends_with('\n') {
                        line.push('\n');
                    }
                    if let Err(e) = stdin_pipe.write_all(line.as_bytes()).await {
                        error!("Failed to write to server stdin: {}", e);
                        break;
                    }
                    let _ = stdin_pipe.flush().await;
                }
            });
        }

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        *self.child_process.lock().await = Some(child);
        self.is_running.store(true, Ordering::SeqCst);

        // Reader task for stdout & stderr
        let manager_clone = Arc::clone(self);
        tokio::spawn(async move {
            let connect_re = Regex::new(r"Player connected: ([^,]+), xuid: ([0-9]+)").unwrap();
            let disconnect_re = Regex::new(r"Player disconnected: ([^,]+), xuid: ([0-9]+)").unwrap();
            let version_re = Regex::new(r"(?:Bedrock Dedicated Server version|Version:)\s*([0-9.]+)").unwrap();

            use tokio::io::AsyncBufReadExt;

            if let Some(stdout) = stdout {
                let mut reader = tokio::io::BufReader::new(stdout).lines();
                let mgr = Arc::clone(&manager_clone);
                let c_re = connect_re.clone();
                let d_re = disconnect_re.clone();
                let v_re = version_re.clone();

                tokio::spawn(async move {
                    while let Ok(Some(line)) = reader.next_line().await {
                        let trimmed = line.trim();
                        if trimmed.is_empty() {
                            continue;
                        }

                        {
                            let mut buf = mgr.console_buffer.write().await;
                            if buf.len() >= 200 {
                                buf.pop_front();
                            }
                            buf.push_back(trimmed.to_string());
                        }

                        if let Some(caps) = v_re.captures(trimmed) {
                            if let Some(v) = caps.get(1) {
                                let v_str = v.as_str().to_string();
                                let v_path = mgr.data_dir.join("last_version.json");
                                let _ = fs::write(v_path, json!({"version": v_str}).to_string());
                            }
                        } else if let Some(caps) = c_re.captures(trimmed) {
                            let player = caps.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
                            let xuid = caps.get(2).map(|m| m.as_str().to_string()).unwrap_or_default();
                            mgr.handle_player_join(&player, &xuid).await;
                        } else if let Some(caps) = d_re.captures(trimmed) {
                            let player = caps.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
                            let xuid = caps.get(2).map(|m| m.as_str().to_string()).unwrap_or_default();
                            mgr.handle_player_leave(&player, &xuid).await;
                        }
                    }
                });
            }

            if let Some(stderr) = stderr {
                let mut reader = tokio::io::BufReader::new(stderr).lines();
                let mgr = Arc::clone(&manager_clone);
                tokio::spawn(async move {
                    while let Ok(Some(line)) = reader.next_line().await {
                        let trimmed = line.trim();
                        if !trimmed.is_empty() {
                            let mut buf = mgr.console_buffer.write().await;
                            if buf.len() >= 200 {
                                buf.pop_front();
                            }
                            buf.push_back(trimmed.to_string());
                        }
                    }
                });
            }
        });

        true
    }

    pub async fn stop_server(&self) -> bool {
        if !self.is_server_running().await {
            return false;
        }

        info!("Stopping Bedrock Dedicated Server...");
        self.send_server_command("stop").await;

        for _ in 0..20 {
            tokio::time::sleep(Duration::from_millis(500)).await;
            if !self.is_server_running().await {
                break;
            }
        }

        let mut proc_guard = self.child_process.lock().await;
        if let Some(mut child) = proc_guard.take() {
            let _ = child.kill().await;
        }

        *self.stdin_tx.lock().await = None;
        self.is_running.store(false, Ordering::SeqCst);
        self.online_players.write().await.clear();
        self.player_session_times.write().await.clear();
        true
    }

    pub async fn restart_server(self: &Arc<Self>) -> bool {
        self.stop_server().await;
        tokio::time::sleep(Duration::from_secs(1)).await;
        self.start_server().await
    }

    pub fn graceful_stop_server(self: &Arc<Self>) {
        let mgr = Arc::clone(self);
        tokio::spawn(async move {
            if !mgr.is_server_running().await {
                return;
            }
            for i in (1..=5).rev() {
                mgr.send_server_command(&format!("say Server stopping in {} seconds...", i)).await;
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
            mgr.stop_server().await;
        });
    }

    pub async fn send_server_command(&self, cmd: &str) -> bool {
        let tx_guard = self.stdin_tx.lock().await;
        if let Some(tx) = tx_guard.as_ref() {
            tx.send(cmd.to_string()).is_ok()
        } else {
            false
        }
    }

    pub async fn handle_player_join(&self, player: &str, xuid: &str) {
        let now = Local::now();
        let now_str = now.format("%Y-%m-%d %H:%M:%S").to_string();
        let world = self.get_active_world_name().unwrap_or_else(|| "Unknown".to_string());

        {
            let mut online = self.online_players.write().await;
            online.insert(player.to_string());
        }
        {
            let mut sessions = self.player_session_times.write().await;
            sessions.insert(player.to_string(), (now, world));
        }

        let global_json = self.data_dir.join("player_list.json");
        let mut map: HashMap<String, Value> = fs::read_to_string(&global_json)
            .ok()
            .and_then(|c| serde_json::from_str(&c).ok())
            .unwrap_or_default();

        let mut pdata = map.remove(player).unwrap_or_else(|| json!({}));
        pdata["last_connected"] = json!(now_str);
        pdata["xuid"] = json!(xuid);
        map.insert(player.to_string(), pdata);

        if let Ok(content) = serde_json::to_string_pretty(&map) {
            let _ = fs::write(global_json, content);
        }
    }

    pub async fn handle_player_leave(&self, player: &str, xuid: &str) {
        let now = Local::now();
        let now_str = now.format("%Y-%m-%d %H:%M:%S").to_string();

        {
            let mut online = self.online_players.write().await;
            online.remove(player);
        }
        let session_info = {
            let mut sessions = self.player_session_times.write().await;
            sessions.remove(player)
        };

        if let Some((start_time, world)) = session_info {
            let hist_path = self.data_dir.join("player_history.json");
            let mut history: HashMap<String, PlayerHistoryData> = fs::read_to_string(&hist_path)
                .ok()
                .and_then(|c| serde_json::from_str(&c).ok())
                .unwrap_or_default();

            let mut pdata = history.remove(player).unwrap_or_default();
            pdata.sessions.push(SessionEntry {
                start: start_time.format("%Y-%m-%d %H:%M:%S").to_string(),
                end: now_str.clone(),
                world,
            });
            pdata.total += 1;
            if pdata.sessions.len() > 10 {
                let start = pdata.sessions.len() - 10;
                pdata.sessions = pdata.sessions[start..].to_vec();
            }
            history.insert(player.to_string(), pdata);

            if let Ok(content) = serde_json::to_string_pretty(&history) {
                let _ = fs::write(hist_path, content);
            }
        }

        let global_json = self.data_dir.join("player_list.json");
        let mut map: HashMap<String, Value> = fs::read_to_string(&global_json)
            .ok()
            .and_then(|c| serde_json::from_str(&c).ok())
            .unwrap_or_default();

        let mut pdata = map.remove(player).unwrap_or_else(|| json!({}));
        pdata["last_disconnected"] = json!(now_str);
        pdata["xuid"] = json!(xuid);
        map.insert(player.to_string(), pdata);

        if let Ok(content) = serde_json::to_string_pretty(&map) {
            let _ = fs::write(global_json, content);
        }
    }

    pub fn get_active_world_name(&self) -> Option<String> {
        if !self.server_properties.exists() {
            return None;
        }
        let file = File::open(&self.server_properties).ok()?;
        let reader = BufReader::new(file);
        for line in reader.lines().flatten() {
            let trimmed = line.trim();
            if trimmed.starts_with("level-name=") {
                return Some(trimmed["level-name=".len()..].trim().to_string());
            }
        }
        None
    }

    pub fn ensure_per_world_properties(&self) {
        if let Some(level_name) = self.get_active_world_name() {
            let world_config_dir = self.data_dir.join("world_configs");
            let _ = fs::create_dir_all(&world_config_dir);
            let world_prop_file = world_config_dir.join(format!("{}.properties", level_name));

            if world_prop_file.exists() {
                if let Ok(lines) = fs::read_to_string(&world_prop_file) {
                    let mut out = String::new();
                    for line in lines.lines() {
                        if line.starts_with("level-name=") {
                            out.push_str(&format!("level-name={}\n", level_name));
                        } else {
                            out.push_str(line);
                            out.push('\n');
                        }
                    }
                    let _ = fs::write(&self.server_properties, out);
                }
            }
        }
    }

    pub fn get_properties_schema(&self) -> Vec<PropertySchemaItem> {
        vec![
            PropertySchemaItem { key: "server-name".into(), label: "Server Name".into(), field_type: "str".into(), choices: None, default: json!("Dedicated Server"), value: None },
            PropertySchemaItem { key: "gamemode".into(), label: "Game Mode".into(), field_type: "choice".into(), choices: Some(vec!["survival".into(), "creative".into(), "adventure".into()]), default: json!("survival"), value: None },
            PropertySchemaItem { key: "force-gamemode".into(), label: "Force Gamemode".into(), field_type: "bool".into(), choices: None, default: json!(false), value: None },
            PropertySchemaItem { key: "difficulty".into(), label: "Difficulty".into(), field_type: "choice".into(), choices: Some(vec!["peaceful".into(), "easy".into(), "normal".into(), "hard".into()]), default: json!("easy"), value: None },
            PropertySchemaItem { key: "allow-cheats".into(), label: "Allow Cheats".into(), field_type: "bool".into(), choices: None, default: json!(false), value: None },
            PropertySchemaItem { key: "max-players".into(), label: "Max Players".into(), field_type: "int".into(), choices: None, default: json!(10), value: None },
            PropertySchemaItem { key: "server-port".into(), label: "Server Port".into(), field_type: "int".into(), choices: None, default: json!(19132), value: None },
            PropertySchemaItem { key: "server-portv6".into(), label: "Server Port (v6)".into(), field_type: "int".into(), choices: None, default: json!(19133), value: None },
            PropertySchemaItem { key: "transport".into(), label: "Transport".into(), field_type: "choice".into(), choices: Some(vec!["nethernet".into(), "raknet".into()]), default: json!("nethernet"), value: None },
            PropertySchemaItem { key: "server-udp-ports".into(), label: "Server UDP Ports (NetherNet)".into(), field_type: "str".into(), choices: None, default: json!("68.233.115.138:19132:19132"), value: None },
            PropertySchemaItem { key: "enable-lan-visibility".into(), label: "Enable LAN Visibility".into(), field_type: "bool".into(), choices: None, default: json!(true), value: None },
            PropertySchemaItem { key: "level-name".into(), label: "Level Name".into(), field_type: "str".into(), choices: None, default: json!("Bedrock level"), value: None },
            PropertySchemaItem { key: "level-seed".into(), label: "Level Seed".into(), field_type: "str".into(), choices: None, default: json!(""), value: None },
            PropertySchemaItem { key: "online-mode".into(), label: "Online Mode".into(), field_type: "bool".into(), choices: None, default: json!(true), value: None },
            PropertySchemaItem { key: "allow-list".into(), label: "Allow List".into(), field_type: "bool".into(), choices: None, default: json!(false), value: None },
            PropertySchemaItem { key: "view-distance".into(), label: "View Distance".into(), field_type: "int".into(), choices: None, default: json!(32), value: None },
            PropertySchemaItem { key: "player-idle-timeout".into(), label: "Player Idle Timeout".into(), field_type: "int".into(), choices: None, default: json!(30), value: None },
            PropertySchemaItem { key: "max-threads".into(), label: "Max Threads".into(), field_type: "int".into(), choices: None, default: json!(8), value: None },
            PropertySchemaItem { key: "tick-distance".into(), label: "Tick Distance".into(), field_type: "int".into(), choices: None, default: json!(4), value: None },
            PropertySchemaItem { key: "default-player-permission-level".into(), label: "Default Player Permission".into(), field_type: "choice".into(), choices: Some(vec!["visitor".into(), "member".into(), "operator".into()]), default: json!("member"), value: None },
            PropertySchemaItem { key: "texturepack-required".into(), label: "Texturepack Required".into(), field_type: "bool".into(), choices: None, default: json!(false), value: None },
            PropertySchemaItem { key: "content-log-file-enabled".into(), label: "Content Log File Enabled".into(), field_type: "bool".into(), choices: None, default: json!(false), value: None },
            PropertySchemaItem { key: "compression-threshold".into(), label: "Compression Threshold".into(), field_type: "int".into(), choices: None, default: json!(1), value: None },
            PropertySchemaItem { key: "compression-algorithm".into(), label: "Compression Algorithm".into(), field_type: "choice".into(), choices: Some(vec!["zlib".into(), "snappy".into()]), default: json!("zlib"), value: None },
            PropertySchemaItem { key: "server-authoritative-movement-strict".into(), label: "Strict Movement".into(), field_type: "bool".into(), choices: None, default: json!(false), value: None },
            PropertySchemaItem { key: "server-authoritative-dismount-strict".into(), label: "Strict Dismount".into(), field_type: "bool".into(), choices: None, default: json!(false), value: None },
            PropertySchemaItem { key: "server-authoritative-entity-interactions-strict".into(), label: "Strict Entity Interactions".into(), field_type: "bool".into(), choices: None, default: json!(false), value: None },
            PropertySchemaItem { key: "player-position-acceptance-threshold".into(), label: "Position Acceptance Threshold".into(), field_type: "float".into(), choices: None, default: json!(0.5), value: None },
            PropertySchemaItem { key: "player-movement-action-direction-threshold".into(), label: "Movement Action Direction Threshold".into(), field_type: "float".into(), choices: None, default: json!(0.85), value: None },
            PropertySchemaItem { key: "server-authoritative-block-breaking".into(), label: "Server Authoritative Block Breaking".into(), field_type: "bool".into(), choices: None, default: json!(false), value: None },
            PropertySchemaItem { key: "server-authoritative-block-breaking-pick-range-scalar".into(), label: "Block Breaking Pick Range Scalar".into(), field_type: "float".into(), choices: None, default: json!(1.5), value: None },
            PropertySchemaItem { key: "chat-restriction".into(), label: "Chat Restriction".into(), field_type: "choice".into(), choices: Some(vec!["None".into(), "Dropped".into(), "Disabled".into()]), default: json!("None"), value: None },
            PropertySchemaItem { key: "disable-player-interaction".into(), label: "Disable Player Interaction".into(), field_type: "bool".into(), choices: None, default: json!(false), value: None },
            PropertySchemaItem { key: "client-side-chunk-generation-enabled".into(), label: "Client-side Chunk Generation Enabled".into(), field_type: "bool".into(), choices: None, default: json!(true), value: None },
            PropertySchemaItem { key: "block-network-ids-are-hashes".into(), label: "Block Network IDs Are Hashes".into(), field_type: "bool".into(), choices: None, default: json!(true), value: None },
            PropertySchemaItem { key: "disable-persona".into(), label: "Disable Persona".into(), field_type: "bool".into(), choices: None, default: json!(false), value: None },
            PropertySchemaItem { key: "disable-custom-skins".into(), label: "Disable Custom Skins".into(), field_type: "bool".into(), choices: None, default: json!(false), value: None },
            PropertySchemaItem { key: "server-build-radius-ratio".into(), label: "Server Build Radius Ratio".into(), field_type: "str".into(), choices: None, default: json!("Disabled"), value: None },
            PropertySchemaItem { key: "emit-server-telemetry".into(), label: "Emit Server Telemetry".into(), field_type: "bool".into(), choices: None, default: json!(true), value: None },
        ]
    }

    pub fn format_duration(seconds: i64) -> String {
        let minutes = seconds / 60;
        let sec = seconds % 60;
        let hours = minutes / 60;
        let min = minutes % 60;
        let days = hours / 24;
        let hr = hours % 24;

        if days > 0 {
            format!("{} days {} hours", days, hr)
        } else if hours > 0 {
            format!("{} hours {} mins", hours, min)
        } else if minutes > 0 {
            format!("{} mins {} secs", minutes, sec)
        } else {
            format!("{} seconds", sec)
        }
    }
}
