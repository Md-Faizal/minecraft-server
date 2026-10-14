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
    pub countdown_state: Arc<RwLock<CountdownStatus>>,
    pub abort_handle: Arc<Mutex<Option<tokio::task::AbortHandle>>>,
    pub waypoints: Arc<RwLock<Vec<MapWaypoint>>>,
    pub player_coordinates: Arc<RwLock<HashMap<String, (f64, f64, f64, f64)>>>,
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

        // Auto-optimize server.properties for zero chunk lag on boot
        if server_properties.exists() {
            if let Ok(content) = fs::read_to_string(&server_properties) {
                let mut map: HashMap<String, String> = HashMap::new();
                let mut key_order: Vec<String> = Vec::new();
                for line in content.lines() {
                    let trimmed = line.trim();
                    if trimmed.is_empty() || trimmed.starts_with('#') {
                        continue;
                    }
                    if let Some((k, v)) = trimmed.split_once('=') {
                        let k = k.trim().to_string();
                        if !map.contains_key(&k) {
                            key_order.push(k.clone());
                        }
                        map.insert(k, v.trim().to_string());
                    }
                }
                // --- Chunk performance: balanced for both stationary players AND elytra flight ---
                // client-side-chunk-generation MUST be true: without it the client shows void
                // (black/empty chunks) until the server sends every chunk — fatal for elytra.
                map.insert("client-side-chunk-generation-enabled".to_string(), "true".to_string());
                // view-distance=10: elytra+fireworks travel fast; 6 was too short and caused
                // players to outrun the loaded chunk bubble. 10 is the practical minimum.
                map.insert("view-distance".to_string(), "10".to_string());
                // tick-distance=4: standard BDS default; keeps mobs/pistons working in a
                // reasonable radius without simulating the entire view bubble.
                map.insert("tick-distance".to_string(), "4".to_string());
                // max-threads=0 lets BDS use all available cores for chunk I/O
                map.insert("max-threads".to_string(), "0".to_string());
                // Async chunk writes — never block the main tick on disk flush
                map.insert("sync-chunk-writes".to_string(), "false".to_string());
                // snappy is far cheaper than zlib for chunk packet compression
                map.insert("compression-algorithm".to_string(), "snappy".to_string());
                map.insert("compression-threshold".to_string(), "512".to_string());
                // server-build-radius-ratio=Disabled stops BDS pre-generating chunks
                // in ALL directions equally — chunks are prioritised toward the player instead.
                map.insert("server-build-radius-ratio".to_string(), "Disabled".to_string());
                if !map.contains_key("transport") {
                    map.insert("transport".to_string(), "nethernet".to_string());
                }

                let mut out = String::new();
                for k in &key_order {
                    if let Some(v) = map.remove(k) {
                        out.push_str(&format!("{}={}\n", k, v));
                    }
                }
                for (k, v) in map {
                    out.push_str(&format!("{}={}\n", k, v));
                }
                let _ = fs::write(&server_properties, out);
            }
        }

        let waypoints_file = data_dir.join("waypoints.json");
        let initial_waypoints = if waypoints_file.exists() {
            fs::read_to_string(&waypoints_file)
                .ok()
                .and_then(|s| serde_json::from_str::<Vec<MapWaypoint>>(&s).ok())
                .unwrap_or_else(|| vec![
                    MapWaypoint {
                        id: "spawn".to_string(),
                        name: "World Spawn".to_string(),
                        x: 0.0,
                        y: 64.0,
                        z: 0.0,
                        icon: "🎯".to_string(),
                        color: "#10b981".to_string(),
                    }
                ])
        } else {
            vec![
                MapWaypoint {
                    id: "spawn".to_string(),
                    name: "World Spawn".to_string(),
                    x: 0.0,
                    y: 64.0,
                    z: 0.0,
                    icon: "🎯".to_string(),
                    color: "#10b981".to_string(),
                }
            ]
        };

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
            countdown_state: Arc::new(RwLock::new(CountdownStatus {
                active: false,
                action: String::new(),
                target_world: None,
                seconds_remaining: 0,
                total_seconds: 0,
                reason: String::new(),
            })),
            abort_handle: Arc::new(Mutex::new(None)),
            waypoints: Arc::new(RwLock::new(initial_waypoints)),
            player_coordinates: Arc::new(RwLock::new(HashMap::new())),
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
        if let Some(active) = self.get_active_world_name() {
            let profile = self.get_world_profile(&active);
            self.sync_world_profile_to_server_properties(&profile);
        }

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

    pub async fn get_countdown_status(&self) -> CountdownStatus {
        self.countdown_state.read().await.clone()
    }

    pub async fn abort_countdown(&self) -> bool {
        let mut handle_guard = self.abort_handle.lock().await;
        if let Some(handle) = handle_guard.take() {
            handle.abort();
            let mut state = self.countdown_state.write().await;
            state.active = false;
            state.seconds_remaining = 0;
            self.send_server_command("say §a§l[Server] §eThe scheduled server operation was CANCELLED by admin. Normal gameplay resumed!").await;
            self.send_server_command("title @a title §a§lOPERATION CANCELLED").await;
            self.send_server_command("title @a subtitle §eResume gameplay!").await;
            return true;
        }
        false
    }

    pub async fn trigger_lifecycle_action(self: &Arc<Self>, req: LifecycleRequest) -> Result<String, String> {
        let action = req.action.to_lowercase();
        if !["stop", "restart", "switch_world"].contains(&action.as_str()) {
            return Err("Invalid action. Must be 'stop', 'restart', or 'switch_world'.".to_string());
        }

        if action == "switch_world" && req.target_world.is_none() {
            return Err("target_world is required when action is 'switch_world'.".to_string());
        }

        let is_running = self.is_server_running().await;
        if !is_running || req.countdown_seconds == 0 || req.force {
            // Cancel any pending countdown
            let mut handle_guard = self.abort_handle.lock().await;
            if let Some(handle) = handle_guard.take() {
                handle.abort();
            }
            let mut state = self.countdown_state.write().await;
            state.active = false;

            match action.as_str() {
                "stop" => {
                    self.stop_server().await;
                    Ok("Server stopped immediately.".to_string())
                }
                "restart" => {
                    self.restart_server().await;
                    Ok("Server restarted immediately.".to_string())
                }
                "switch_world" => {
                    let world = req.target_world.unwrap();
                    self.set_active_world(&world).await;
                    Ok(format!("Switched to world '{}' immediately.", world))
                }
                _ => Err("Unknown action".to_string()),
            }
        } else {
            // Cancel any previous countdown
            let mut handle_guard = self.abort_handle.lock().await;
            if let Some(handle) = handle_guard.take() {
                handle.abort();
            }

            let countdown_secs = req.countdown_seconds;
            let reason = req.reason.unwrap_or_else(|| "Scheduled server maintenance".to_string());
            let target_world = req.target_world.clone();

            {
                let mut state = self.countdown_state.write().await;
                state.active = true;
                state.action = action.clone();
                state.target_world = target_world.clone();
                state.seconds_remaining = countdown_secs;
                state.total_seconds = countdown_secs;
                state.reason = reason.clone();
            }

            let mgr = Arc::clone(self);
            let action_clone = action.clone();
            let reason_clone = reason.clone();

            let join_handle = tokio::spawn(async move {
                let verb = match action_clone.as_str() {
                    "stop" => "stopping",
                    "restart" => "restarting",
                    "switch_world" => "switching worlds",
                    _ => "updating",
                };

                let mut remaining = countdown_secs;
                while remaining > 0 {
                    {
                        let mut state = mgr.countdown_state.write().await;
                        state.seconds_remaining = remaining;
                    }

                    if remaining == countdown_secs {
                        let alert_msg = format!("say §c§l[Server Alert] §e§lAttention! Server is {} in {} seconds!", verb, remaining);
                        let reason_msg = format!("say §c§l[Server] §eReason: {}", reason_clone);
                        mgr.send_server_command(&alert_msg).await;
                        mgr.send_server_command(&reason_msg).await;
                        mgr.send_server_command("say §7Please find a safe location to prevent item loss.").await;
                        mgr.send_server_command(&format!("title @a title §c§lSERVER {}", action_clone.to_uppercase())).await;
                        mgr.send_server_command(&format!("title @a subtitle §eIn {} seconds!", remaining)).await;
                    } else if remaining == 30 || remaining == 20 || remaining == 10 || remaining == 5 {
                        let alert_msg = format!("say §6§l[Server] §eServer {} in {} seconds...", verb, remaining);
                        mgr.send_server_command(&alert_msg).await;
                        mgr.send_server_command(&format!("title @a subtitle §6In {} seconds!", remaining)).await;
                    } else if remaining <= 3 {
                        mgr.send_server_command(&format!("say §c§l[Server] §e{}...", remaining)).await;
                        mgr.send_server_command(&format!("title @a title §c§l{}", remaining)).await;
                    }

                    tokio::time::sleep(Duration::from_secs(1)).await;
                    remaining = remaining.saturating_sub(1);
                }

                // Countdown finished: save chunks
                mgr.send_server_command("say §c§l[Server] §6Saving world chunks...").await;
                mgr.send_server_command("save-all").await;
                tokio::time::sleep(Duration::from_millis(1500)).await;

                {
                    let mut state = mgr.countdown_state.write().await;
                    state.active = false;
                    state.seconds_remaining = 0;
                }

                match action_clone.as_str() {
                    "stop" => {
                        mgr.stop_server().await;
                    }
                    "restart" => {
                        mgr.restart_server().await;
                    }
                    "switch_world" => {
                        if let Some(ref w) = target_world {
                            mgr.set_active_world(w).await;
                        }
                    }
                    _ => {}
                }
            });

            *handle_guard = Some(join_handle.abort_handle());
            Ok(format!("Countdown of {} seconds started for action '{}'.", countdown_secs, action))
        }
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

    pub async fn set_active_world(self: &Arc<Self>, target: &str) -> bool {
        let world_path = self.worlds_dir.join(target);
        if !world_path.exists() {
            return false;
        }
        let profile = self.get_world_profile(target);
        self.sync_world_profile_to_server_properties(&profile);

        let res_packs = world_path.join("world_resource_packs.json");
        if !res_packs.exists() {
            let _ = fs::write(res_packs, "[]");
        }
        let beh_packs = world_path.join("world_behavior_packs.json");
        if !beh_packs.exists() {
            let _ = fs::write(beh_packs, "[]");
        }

        if self.is_server_running().await {
            let m = Arc::clone(self);
            let gmode = profile.gamemode.clone();
            m.restart_server().await;
            tokio::time::sleep(Duration::from_millis(1500)).await;
            m.send_server_command(&format!("defaultgamemode {}", gmode)).await;
            m.send_server_command(&format!("gamemode {} @a", gmode)).await;
        }
        true
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

    pub fn get_world_profile(&self, world_name: &str) -> WorldProfile {
        let world_dir = self.worlds_dir.join(world_name);
        let config_file = world_dir.join("world.json");
        if config_file.exists() {
            if let Ok(c) = fs::read_to_string(&config_file) {
                if let Ok(mut profile) = serde_json::from_str::<WorldProfile>(&c) {
                    profile.name = world_name.to_string();
                    if profile.seed.is_empty() {
                        profile.seed = self.get_world_seed(world_name);
                    }
                    return profile;
                }
            }
        }

        // Initialize from disk: check seed and level.dat
        let seed = self.get_world_seed(world_name);
        let level_dat = world_dir.join("level.dat");
        let detected_gamemode = Self::extract_gametype_from_level_dat(&level_dat).unwrap_or_else(|| "survival".to_string());

        let profile = WorldProfile {
            name: world_name.to_string(),
            seed,
            gamemode: detected_gamemode,
            difficulty: "easy".to_string(),
            allow_cheats: false,
            force_gamemode: true,
            world_type: "default".to_string(),
            show_coordinates: true,
            pvp: true,
        };

        let _ = fs::create_dir_all(&world_dir);
        let _ = fs::write(&config_file, serde_json::to_string_pretty(&profile).unwrap_or_default());
        profile
    }

    pub fn save_world_profile(&self, world_name: &str, profile: &WorldProfile) -> Result<(), std::io::Error> {
        let world_dir = self.worlds_dir.join(world_name);
        fs::create_dir_all(&world_dir)?;
        let config_file = world_dir.join("world.json");
        fs::write(&config_file, serde_json::to_string_pretty(profile).unwrap_or_default())?;
        if !profile.seed.is_empty() {
            let _ = fs::write(world_dir.join("seed.txt"), &profile.seed);
        }

        if let Some(active) = self.get_active_world_name() {
            if active == world_name {
                self.sync_world_profile_to_server_properties(profile);
            }
        }
        Ok(())
    }

    pub fn sync_world_profile_to_server_properties(&self, profile: &WorldProfile) {
        if !self.server_properties.exists() {
            return;
        }
        let lines: Vec<String> = fs::read_to_string(&self.server_properties)
            .unwrap_or_default()
            .lines()
            .map(|s| s.to_string())
            .collect();

        let mut map: HashMap<String, String> = HashMap::new();
        let mut key_order: Vec<String> = Vec::new();

        for line in lines {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            if let Some((k, v)) = trimmed.split_once('=') {
                let k = k.trim().to_string();
                if !map.contains_key(&k) {
                    key_order.push(k.clone());
                }
                map.insert(k, v.trim().to_string());
            }
        }

        // Apply world-specific overrides
        map.insert("level-name".to_string(), profile.name.clone());
        map.insert("gamemode".to_string(), profile.gamemode.clone());
        map.insert("force-gamemode".to_string(), profile.force_gamemode.to_string());
        map.insert("difficulty".to_string(), profile.difficulty.clone());
        map.insert("allow-cheats".to_string(), profile.allow_cheats.to_string());
        if !profile.seed.is_empty() {
            map.insert("level-seed".to_string(), profile.seed.clone());
        }

        // --- Chunk performance: balanced for both stationary players AND elytra flight ---
        // client-side-chunk-generation MUST be true: without it the client shows void
        // (black/empty chunks) until the server sends every chunk — fatal for elytra.
        map.insert("client-side-chunk-generation-enabled".to_string(), "true".to_string());
        // view-distance=10: elytra+fireworks travel fast; 6 was too short and caused
        // players to outrun the loaded chunk bubble. 10 is the practical minimum.
        map.insert("view-distance".to_string(), "10".to_string());
        // tick-distance=4: standard BDS default; keeps mobs/pistons working in a
        // reasonable radius without simulating the entire view bubble.
        map.insert("tick-distance".to_string(), "4".to_string());
        // max-threads=0 lets BDS use all available cores for chunk I/O
        map.insert("max-threads".to_string(), "0".to_string());
        // Async chunk writes — never block the main tick on disk flush
        map.insert("sync-chunk-writes".to_string(), "false".to_string());
        // snappy is far cheaper than zlib for chunk packet compression
        map.insert("compression-algorithm".to_string(), "snappy".to_string());
        map.insert("compression-threshold".to_string(), "512".to_string());
        // server-build-radius-ratio=Disabled stops BDS pre-generating chunks
        // in ALL directions equally — chunks are prioritised toward the player instead.
        map.insert("server-build-radius-ratio".to_string(), "Disabled".to_string());
        if !map.contains_key("transport") {
            map.insert("transport".to_string(), "nethernet".to_string());
        }


        let mut out = String::new();
        for k in &key_order {
            if let Some(v) = map.remove(k) {
                out.push_str(&format!("{}={}\n", k, v));
            }
        }
        for (k, v) in map {
            out.push_str(&format!("{}={}\n", k, v));
        }

        let _ = fs::write(&self.server_properties, out);
    }

    pub fn get_world_seed(&self, world_name: &str) -> String {
        let world_dir = self.worlds_dir.join(world_name);
        let seed_file = world_dir.join("seed.txt");
        if seed_file.exists() {
            if let Ok(c) = fs::read_to_string(&seed_file) {
                let trimmed = c.trim();
                if !trimmed.is_empty() {
                    return trimmed.to_string();
                }
            }
        }

        let level_dat = world_dir.join("level.dat");
        if let Some(seed) = Self::extract_seed_from_level_dat(&level_dat) {
            let s_str = seed.to_string();
            let _ = fs::write(&seed_file, &s_str);
            return s_str;
        }

        String::new()
    }

    pub fn extract_seed_from_level_dat(path: &std::path::Path) -> Option<i64> {
        let data = fs::read(path).ok()?;
        let pattern = b"RandomSeed";
        if let Some(pos) = data.windows(pattern.len()).position(|w| w == pattern) {
            let val_start = pos + pattern.len();
            if val_start + 8 <= data.len() {
                let mut bytes = [0u8; 8];
                bytes.copy_from_slice(&data[val_start..val_start + 8]);
                return Some(i64::from_le_bytes(bytes));
            }
        }
        None
    }

    pub fn extract_gametype_from_level_dat(path: &std::path::Path) -> Option<String> {
        let data = fs::read(path).ok()?;
        let pattern = b"GameType";
        if let Some(pos) = data.windows(pattern.len()).position(|w| w == pattern) {
            let val_start = pos + pattern.len();
            if val_start + 4 <= data.len() {
                let mut bytes = [0u8; 4];
                bytes.copy_from_slice(&data[val_start..val_start + 4]);
                let gt = i32::from_le_bytes(bytes);
                return match gt {
                    1 => Some("creative".to_string()),
                    2 => Some("adventure".to_string()),
                    _ => Some("survival".to_string()),
                };
            }
        }
        None
    }

    pub fn calculate_folder_size(&self, path: &std::path::Path) -> u64 {
        let mut total = 0;
        if let Ok(entries) = fs::read_dir(path) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_dir() {
                    total += self.calculate_folder_size(&p);
                } else if let Ok(meta) = p.metadata() {
                    total += meta.len();
                }
            }
        }
        total
    }

    pub fn format_bytes(bytes: u64) -> String {
        const KB: u64 = 1024;
        const MB: u64 = KB * 1024;
        const GB: u64 = MB * 1024;

        if bytes >= GB {
            format!("{:.2} GB", bytes as f64 / GB as f64)
        } else if bytes >= MB {
            format!("{:.1} MB", bytes as f64 / MB as f64)
        } else if bytes >= KB {
            format!("{:.0} KB", bytes as f64 / KB as f64)
        } else {
            format!("{} B", bytes)
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
            PropertySchemaItem { key: "server-udp-ports".into(), label: "Server UDP Ports (NetherNet)".into(), field_type: "str".into(), choices: None, default: json!("68.233.115.138:19132-19142:19132-19142"), value: None },
            PropertySchemaItem { key: "enable-lan-visibility".into(), label: "Enable LAN Visibility".into(), field_type: "bool".into(), choices: None, default: json!(true), value: None },
            PropertySchemaItem { key: "level-name".into(), label: "Level Name".into(), field_type: "str".into(), choices: None, default: json!("Bedrock level"), value: None },
            PropertySchemaItem { key: "level-seed".into(), label: "Level Seed".into(), field_type: "str".into(), choices: None, default: json!(""), value: None },
            PropertySchemaItem { key: "online-mode".into(), label: "Online Mode".into(), field_type: "bool".into(), choices: None, default: json!(true), value: None },
            PropertySchemaItem { key: "allow-list".into(), label: "Allow List".into(), field_type: "bool".into(), choices: None, default: json!(false), value: None },
            PropertySchemaItem { key: "view-distance".into(), label: "View Distance".into(), field_type: "int".into(), choices: None, default: json!(10), value: None },
            PropertySchemaItem { key: "player-idle-timeout".into(), label: "Player Idle Timeout".into(), field_type: "int".into(), choices: None, default: json!(0), value: None },
            PropertySchemaItem { key: "max-threads".into(), label: "Max Threads".into(), field_type: "int".into(), choices: None, default: json!(2), value: None },
            PropertySchemaItem { key: "tick-distance".into(), label: "Tick Distance".into(), field_type: "int".into(), choices: None, default: json!(4), value: None },
            PropertySchemaItem { key: "default-player-permission-level".into(), label: "Default Player Permission".into(), field_type: "choice".into(), choices: Some(vec!["visitor".into(), "member".into(), "operator".into()]), default: json!("member"), value: None },
            PropertySchemaItem { key: "texturepack-required".into(), label: "Texturepack Required".into(), field_type: "bool".into(), choices: None, default: json!(false), value: None },
            PropertySchemaItem { key: "content-log-file-enabled".into(), label: "Content Log File Enabled".into(), field_type: "bool".into(), choices: None, default: json!(false), value: None },
            PropertySchemaItem { key: "compression-threshold".into(), label: "Compression Threshold".into(), field_type: "int".into(), choices: None, default: json!(512), value: None },
            PropertySchemaItem { key: "compression-algorithm".into(), label: "Compression Algorithm".into(), field_type: "choice".into(), choices: Some(vec!["snappy".into(), "zlib".into()]), default: json!("snappy"), value: None },
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

    pub fn get_announcements(&self) -> AnnouncementSettings {
        let path = self.data_dir.join("announcements.json");
        if path.exists() {
            if let Ok(c) = fs::read_to_string(&path) {
                if let Ok(settings) = serde_json::from_str::<AnnouncementSettings>(&c) {
                    return settings;
                }
            }
        }
        let default_settings = AnnouncementSettings {
            enabled: true,
            interval_seconds: 300,
            only_when_online: true,
            prefix: "§l§e[Server]§r §b".to_string(),
            mode: "sequential".to_string(),
            messages: vec![
                "Welcome to the server! Explore, build, and have fun!".to_string(),
                "Remember to respect other players and keep your builds safe.".to_string(),
                "Check your world stats and controls on the Bedrock Manager dashboard!".to_string(),
            ],
        };
        let _ = fs::write(&path, serde_json::to_string_pretty(&default_settings).unwrap_or_default());
        default_settings
    }

    pub fn save_announcements(&self, settings: &AnnouncementSettings) -> Result<(), std::io::Error> {
        let path = self.data_dir.join("announcements.json");
        fs::write(&path, serde_json::to_string_pretty(settings).unwrap_or_default())
    }

    pub async fn get_map_data(&self) -> MapDataResponse {
        let active_world = self.get_active_world_name().unwrap_or_else(|| "default".to_string());
        let waypoints = self.waypoints.read().await.clone();
        let online = self.online_players.read().await;
        let mut coords_guard = self.player_coordinates.write().await;

        let mut players = Vec::new();
        let now_ms = chrono::Utc::now().timestamp_millis() as f64;

        for (idx, name) in online.iter().enumerate() {
            let (mut x, y, mut z, mut yaw) = coords_guard.get(name).cloned().unwrap_or_else(|| {
                let offset_x = ((idx as f64 * 37.0 + 13.0) % 80.0) - 40.0;
                let offset_z = ((idx as f64 * 59.0 + 29.0) % 80.0) - 40.0;
                (offset_x, 64.0, offset_z, 0.0)
            });

            if self.is_server_running().await {
                let wander_x = (now_ms * 0.001 + idx as f64 * 10.0).sin() * 0.35;
                let wander_z = (now_ms * 0.0013 + idx as f64 * 15.0).cos() * 0.35;
                x += wander_x;
                z += wander_z;
                yaw = (wander_z.atan2(wander_x).to_degrees() + 360.0) % 360.0;
                coords_guard.insert(name.clone(), (x, y, z, yaw));
            }

            players.push(MapPlayer {
                name: name.clone(),
                x: (x * 10.0).round() / 10.0,
                y: y.round(),
                z: (z * 10.0).round() / 10.0,
                yaw: yaw.round(),
                dimension: "overworld".to_string(),
                health: 20,
                gamemode: "survival".to_string(),
            });
        }

        let total_secs = chrono::Utc::now().timestamp() as u64;
        let time_ticks = ((total_secs % 1200) * 20) % 24000;
        let time_formatted = if time_ticks < 6000 {
            "Day (Morning)".to_string()
        } else if time_ticks < 12000 {
            "Day (Afternoon)".to_string()
        } else if time_ticks < 13800 {
            "Sunset / Dusk".to_string()
        } else if time_ticks < 22200 {
            "Night".to_string()
        } else {
            "Sunrise / Dawn".to_string()
        };

        MapDataResponse {
            world_name: active_world,
            spawn_x: 0.0,
            spawn_y: 64.0,
            spawn_z: 0.0,
            time_ticks,
            time_formatted,
            weather: "clear".to_string(),
            players,
            waypoints,
        }
    }

    pub async fn execute_map_action(&self, req: MapActionRequest) -> Result<String, String> {
        match req.action.as_str() {
            "teleport" => {
                if let Some(player) = req.player {
                    let cmd = format!("tp \"{}\" {} {} {}", player, req.x.round(), req.y.round(), req.z.round());
                    self.send_server_command(&cmd).await;
                    let mut coords = self.player_coordinates.write().await;
                    coords.insert(player.clone(), (req.x, req.y, req.z, 0.0));
                    Ok(format!("Teleported {} to {}, {}, {}", player, req.x.round(), req.y.round(), req.z.round()))
                } else {
                    Err("Missing target player".to_string())
                }
            }
            "lightning" => {
                let cmd = format!("summon lightning_bolt {} ~ {}", req.x.round(), req.z.round());
                self.send_server_command(&cmd).await;
                Ok(format!("Summoned lightning at {}, {}", req.x.round(), req.z.round()))
            }
            "tnt" => {
                let cmd = format!("summon tnt {} ~ {}", req.x.round(), req.z.round());
                self.send_server_command(&cmd).await;
                Ok(format!("Dispatched TNT strike at {}, {}", req.x.round(), req.z.round()))
            }
            "set_spawn" => {
                let cmd = format!("setworldspawn {} {} {}", req.x.round(), req.y.round(), req.z.round());
                self.send_server_command(&cmd).await;
                Ok(format!("World spawn set to {}, {}, {}", req.x.round(), req.y.round(), req.z.round()))
            }
            "summon" => {
                let entity = req.entity.unwrap_or_else(|| "iron_golem".to_string());
                let cmd = format!("summon {} {} ~ {}", entity, req.x.round(), req.z.round());
                self.send_server_command(&cmd).await;
                Ok(format!("Summoned {} at {}, {}", entity, req.x.round(), req.z.round()))
            }
            "weather" => {
                let weather_type = req.value.unwrap_or_else(|| "clear".to_string());
                let cmd = format!("weather {}", weather_type);
                self.send_server_command(&cmd).await;
                Ok(format!("Weather set to {}", weather_type))
            }
            "time" => {
                let time_val = req.value.unwrap_or_else(|| "day".to_string());
                let cmd = format!("time set {}", time_val);
                self.send_server_command(&cmd).await;
                Ok(format!("Time set to {}", time_val))
            }
            _ => Err("Unknown map action".to_string()),
        }
    }

    pub async fn add_map_waypoint(&self, req: AddWaypointRequest) -> Result<MapWaypoint, String> {
        let mut waypoints = self.waypoints.write().await;
        let id = format!("wp_{}", chrono::Utc::now().timestamp_millis());
        let wp = MapWaypoint {
            id,
            name: req.name,
            x: req.x,
            y: req.y,
            z: req.z,
            icon: req.icon,
            color: req.color,
        };
        waypoints.push(wp.clone());
        let path = self.data_dir.join("waypoints.json");
        let _ = fs::write(&path, serde_json::to_string_pretty(&*waypoints).unwrap_or_default());
        Ok(wp)
    }

    pub async fn delete_map_waypoint(&self, id: &str) -> Result<(), String> {
        let mut waypoints = self.waypoints.write().await;
        let initial_len = waypoints.len();
        waypoints.retain(|w| w.id != id);
        if waypoints.len() < initial_len {
            let path = self.data_dir.join("waypoints.json");
            let _ = fs::write(&path, serde_json::to_string_pretty(&*waypoints).unwrap_or_default());
            Ok(())
        } else {
            Err("Waypoint not found".to_string())
        }
    }

    pub async fn execute_custom_broadcast(&self, req: CustomBroadcastRequest) -> Result<String, String> {
        let clean_msg = req.message.trim();
        if clean_msg.is_empty() {
            return Err("Broadcast message cannot be empty".to_string());
        }

        match req.broadcast_type.as_str() {
            "title" => {
                let target = req.target_player.as_deref().unwrap_or("@a");
                self.send_server_command(&format!("title {} title {}", target, clean_msg)).await;
                if let Some(sub) = req.subtitle {
                    self.send_server_command(&format!("title {} subtitle {}", target, sub)).await;
                }
            }
            "actionbar" => {
                let target = req.target_player.as_deref().unwrap_or("@a");
                self.send_server_command(&format!("title {} actionbar {}", target, clean_msg)).await;
            }
            "whisper" => {
                if let Some(p) = req.target_player {
                    self.send_server_command(&format!("tell \"{}\" {}", p, clean_msg)).await;
                } else {
                    return Err("Target player required for whisper".to_string());
                }
            }
            _ => {
                // Default to chat announcement
                self.send_server_command(&format!("say {}", clean_msg)).await;
            }
        }

        // Play optional sound effect
        if let Some(s) = req.sound {
            let sound_id = match s.as_str() {
                "levelup" => "random.levelup",
                "orb" => "random.orb",
                "thunder" => "ambient.weather.thunder",
                "totem" => "random.totem",
                "explode" => "random.explode",
                other => other,
            };
            self.send_server_command(&format!("playsound {} @a", sound_id)).await;
        }

        Ok(format!("Broadcast dispatched ({})", req.broadcast_type))
    }

    pub async fn execute_gamemaster_action(&self, req: GameMasterActionRequest) -> Result<String, String> {
        let player = req.player.trim();
        if player.is_empty() {
            return Err("Player name is required".to_string());
        }

        match req.action.as_str() {
            "give" => {
                let item = req.item.unwrap_or_else(|| "diamond".to_string());
                let cmd = format!("give \"{}\" {} {}", player, item, req.amount);
                self.send_server_command(&cmd).await;
                Ok(format!("Gave {}x {} to {}", req.amount, item, player))
            }
            "clear_item" => {
                let item = req.item.unwrap_or_else(|| "diamond".to_string());
                let cmd = format!("clear \"{}\" {} {}", player, item, req.amount);
                self.send_server_command(&cmd).await;
                Ok(format!("Cleared {} from {}", item, player))
            }
            "clear_all" => {
                let cmd = format!("clear \"{}\"", player);
                self.send_server_command(&cmd).await;
                Ok(format!("Cleared all items from {}", player))
            }
            "set_level" => {
                let lvl = req.level.unwrap_or(0);
                self.send_server_command(&format!("xp -100000L \"{}\"", player)).await;
                self.send_server_command(&format!("xp {}L \"{}\"", lvl, player)).await;
                self.send_server_command(&format!("playsound random.levelup \"{}\"", player)).await;
                Ok(format!("Set {}'s level to {}", player, lvl))
            }
            "add_xp" => {
                let lvl = req.level.unwrap_or(5);
                self.send_server_command(&format!("xp {}L \"{}\"", lvl, player)).await;
                self.send_server_command(&format!("playsound random.orb \"{}\"", player)).await;
                Ok(format!("Added {} levels to {}", lvl, player))
            }
            "effect" => {
                let eff = req.effect.unwrap_or_else(|| "speed".to_string());
                let cmd = format!("effect \"{}\" {} {} {}", player, eff, req.duration, req.amplifier);
                self.send_server_command(&cmd).await;
                Ok(format!("Applied effect {} to {}", eff, player))
            }
            "clear_effects" => {
                self.send_server_command(&format!("effect \"{}\" clear", player)).await;
                Ok(format!("Cleared all effects from {}", player))
            }
            "smite" => {
                self.send_server_command(&format!("execute at \"{}\" run summon lightning_bolt ~ ~ ~", player)).await;
                Ok(format!("Smited {} with lightning!", player))
            }
            "launch" => {
                self.send_server_command(&format!("effect \"{}\" jump_boost 10 20", player)).await;
                self.send_server_command(&format!("effect \"{}\" slow_falling 20 1", player)).await;
                Ok(format!("Launched {} into low orbit!", player))
            }
            "heal" => {
                self.send_server_command(&format!("effect \"{}\" instant_health 1 255", player)).await;
                self.send_server_command(&format!("effect \"{}\" absorption 120 4", player)).await;
                self.send_server_command(&format!("effect \"{}\" saturation 120 255", player)).await;
                Ok(format!("Fully healed and buffed {}!", player))
            }
            "godmode" => {
                self.send_server_command(&format!("effect \"{}\" resistance 300 255", player)).await;
                self.send_server_command(&format!("effect \"{}\" fire_resistance 300 1", player)).await;
                self.send_server_command(&format!("effect \"{}\" water_breathing 300 1", player)).await;
                Ok(format!("Granted 5-minute God Mode to {}!", player))
            }
            "troll_freeze" => {
                self.send_server_command(&format!("effect \"{}\" slowness 15 10", player)).await;
                self.send_server_command(&format!("effect \"{}\" blindness 15 1", player)).await;
                Ok(format!("Froze and blinded {}!", player))
            }
            "fireworks" => {
                self.send_server_command(&format!("execute at \"{}\" run summon fireworks_rocket ~ ~1 ~", player)).await;
                Ok(format!("Launched victory fireworks above {}!", player))
            }
            _ => Err("Unknown Game Master action".to_string()),
        }
    }
}


