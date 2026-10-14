use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::{Multipart, Query, State};
use axum::http::{header, StatusCode};
use axum::response::{Html, IntoResponse};
use axum::Json;
use chrono::Local;
use regex::Regex;
use serde::Deserialize;
use serde_json::{json, Value};
use walkdir::WalkDir;

use crate::manager::ServerManager;
use crate::models::*;

pub async fn index_page() -> Html<String> {
    // Try to read templates/index.html, fallback to basic dashboard if not found
    if let Ok(content) = fs::read_to_string("templates/index.html") {
        Html(content)
    } else if let Ok(content) = fs::read_to_string("/home/ubuntu/stack/games/minecraft/templates/index.html") {
        Html(content)
    } else {
        Html("<h1>Bedrock Server Dashboard</h1><p>Rust Backend Active</p>".to_string())
    }
}

pub async fn favicon() -> impl IntoResponse {
    let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#10b981"/><path d="M6 10 L16 4 L26 10 L16 16 Z" fill="#34d399"/><path d="M6 10 L16 16 L16 28 L6 22 Z" fill="#059669"/><path d="M26 10 L16 16 L16 28 L26 22 Z" fill="#047857"/></svg>"##;
    ([(header::CONTENT_TYPE, "image/svg+xml"), (header::CACHE_CONTROL, "public, max-age=86400")], svg)
}

pub async fn api_status(State(mgr): State<Arc<ServerManager>>) -> Json<StatusResponse> {
    let mut version = "Unknown".to_string();
    let version_json = mgr.data_dir.join("last_version.json");

    if version_json.exists() {
        if let Ok(content) = fs::read_to_string(&version_json) {
            if let Ok(val) = serde_json::from_str::<Value>(&content) {
                if let Some(v) = val.get("version").and_then(|v| v.as_str()) {
                    version = v.to_string();
                }
            }
        }
    }

    if version == "Unknown" {
        let v_re = Regex::new(r"(?:Bedrock Dedicated Server version|Version:)\s*([0-9.]+)").unwrap();
        let logs = mgr.console_buffer.read().await;
        for line in logs.iter().rev() {
            if let Some(caps) = v_re.captures(line) {
                if let Some(v) = caps.get(1) {
                    version = v.as_str().to_string();
                    let _ = fs::write(&version_json, json!({"version": &version}).to_string());
                    break;
                }
            }
        }
    }

    let running = mgr.is_server_running().await;
    let online: Vec<String> = mgr.online_players.read().await.iter().cloned().collect();
    let active_world = mgr.get_active_world_name();

    Json(StatusResponse {
        server_running: running,
        online_players: online,
        active_world,
        version,
    })
}

pub async fn api_start(State(mgr): State<Arc<ServerManager>>) -> Json<Value> {
    if mgr.start_server().await {
        Json(json!({"result": "starting"}))
    } else {
        Json(json!({"result": "already running"}))
    }
}

pub async fn api_stop(State(mgr): State<Arc<ServerManager>>) -> Json<Value> {
    if mgr.is_server_running().await {
        let m = Arc::clone(&mgr);
        tokio::spawn(async move {
            let _ = m.trigger_lifecycle_action(LifecycleRequest {
                action: "stop".to_string(),
                countdown_seconds: 5,
                reason: Some("Manual stop from dashboard".to_string()),
                target_world: None,
                force: false,
            }).await;
        });
        Json(json!({"result": "stopping"}))
    } else {
        Json(json!({"result": "already stopped"}))
    }
}

pub async fn api_restart(State(mgr): State<Arc<ServerManager>>) -> Json<Value> {
    if mgr.is_server_running().await {
        let m = Arc::clone(&mgr);
        tokio::spawn(async move {
            let _ = m.trigger_lifecycle_action(LifecycleRequest {
                action: "restart".to_string(),
                countdown_seconds: 5,
                reason: Some("Manual restart from dashboard".to_string()),
                target_world: None,
                force: false,
            }).await;
        });
        Json(json!({"result": "restarting"}))
    } else {
        Json(json!({"result": "not running"}))
    }
}

pub async fn api_server_output(State(mgr): State<Arc<ServerManager>>) -> impl IntoResponse {
    let logs = mgr.console_buffer.read().await;
    let text = logs.iter().cloned().collect::<Vec<_>>().join("\n");
    ([(header::CONTENT_TYPE, "text/plain; charset=utf-8")], text)
}

#[derive(Deserialize)]
pub struct CommandPayload {
    pub command: Option<String>,
}

pub async fn api_command(
    State(mgr): State<Arc<ServerManager>>,
    Json(payload): Json<CommandPayload>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let cmd = payload.command.unwrap_or_default().trim().to_string();
    if cmd.is_empty() {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"result": "no command"}))));
    }

    if mgr.send_server_command(&cmd).await {
        Ok(Json(json!({"result": "sent", "command": cmd})))
    } else {
        Err((
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"result": "server not running"})),
        ))
    }
}

pub async fn api_worlds(State(mgr): State<Arc<ServerManager>>) -> Json<WorldsResponse> {
    let mut worlds = Vec::new();
    let active_world = mgr.get_active_world_name();

    if let Ok(entries) = fs::read_dir(&mgr.worlds_dir) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                if let Ok(name) = entry.file_name().into_string() {
                    let profile = mgr.get_world_profile(&name);
                    let folder_size = mgr.calculate_folder_size(&entry.path());
                    let size_formatted = ServerManager::format_bytes(folder_size);
                    let is_active = Some(&name) == active_world.as_ref();

                    worlds.push(WorldItem {
                        name: profile.name,
                        seed: profile.seed,
                        gamemode: profile.gamemode,
                        difficulty: profile.difficulty,
                        allow_cheats: profile.allow_cheats,
                        force_gamemode: profile.force_gamemode,
                        world_type: profile.world_type,
                        is_active,
                        size_formatted,
                    });
                }
            }
        }
    }
    worlds.sort_by(|a, b| a.name.cmp(&b.name));
    Json(WorldsResponse { worlds, active_world })
}

#[derive(Deserialize)]
pub struct ActiveWorldPayload {
    pub world: Option<String>,
    pub world_name: Option<String>,
}

pub async fn api_set_active_world(
    State(mgr): State<Arc<ServerManager>>,
    Json(payload): Json<ActiveWorldPayload>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let target = payload.world.or(payload.world_name).unwrap_or_default();
    if target.is_empty() {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"result": "No world specified."}))));
    }

    let world_path = mgr.worlds_dir.join(&target);
    if !world_path.exists() {
        return Err((StatusCode::NOT_FOUND, Json(json!({"result": "World directory does not exist."}))));
    }

    // Load or initialize world profile and sync its exact gamemode, difficulty, cheats, seed
    let profile = mgr.get_world_profile(&target);
    mgr.sync_world_profile_to_server_properties(&profile);

    // Ensure per-world addons config files exist
    let res_packs = world_path.join("world_resource_packs.json");
    if !res_packs.exists() {
        let _ = fs::write(res_packs, "[]");
    }
    let beh_packs = world_path.join("world_behavior_packs.json");
    if !beh_packs.exists() {
        let _ = fs::write(beh_packs, "[]");
    }

    if mgr.is_server_running().await {
        let m = Arc::clone(&mgr);
        let gmode = profile.gamemode.clone();
        tokio::spawn(async move {
            m.restart_server().await;
            tokio::time::sleep(Duration::from_millis(1500)).await;
            m.send_server_command(&format!("defaultgamemode {}", gmode)).await;
            m.send_server_command(&format!("gamemode {} @a", gmode)).await;
        });
    }

    Ok(Json(json!({"result": format!("Active world changed to '{}' (Mode: {}, Difficulty: {}).", target, profile.gamemode, profile.difficulty)})))
}

#[derive(Deserialize)]
pub struct CreateWorldPayload {
    pub name: Option<String>,
    pub seed: Option<String>,
    pub gamemode: Option<String>,
    pub difficulty: Option<String>,
    pub world_type: Option<String>,
    pub allow_cheats: Option<bool>,
    pub force_gamemode: Option<bool>,
    pub show_coordinates: Option<bool>,
    pub pvp: Option<bool>,
    pub activate_now: Option<bool>,
}

pub async fn api_create_world(
    State(mgr): State<Arc<ServerManager>>,
    Json(payload): Json<CreateWorldPayload>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let name = payload.name.unwrap_or_default().trim().to_string();
    if name.is_empty() {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"result": "World name is required."}))));
    }

    let world_path = mgr.worlds_dir.join(&name);
    if world_path.exists() {
        return Err((StatusCode::CONFLICT, Json(json!({"result": "World already exists."}))));
    }

    if let Err(e) = fs::create_dir_all(&world_path) {
        return Err((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"result": format!("Failed to create world folder: {}", e)}))));
    }

    let seed = payload.seed.unwrap_or_default().trim().to_string();
    let gamemode = payload.gamemode.unwrap_or_else(|| "survival".to_string()).to_lowercase();
    let difficulty = payload.difficulty.unwrap_or_else(|| "easy".to_string()).to_lowercase();
    let world_type = payload.world_type.unwrap_or_else(|| "default".to_string()).to_lowercase();
    let allow_cheats = payload.allow_cheats.unwrap_or(false);
    let force_gamemode = payload.force_gamemode.unwrap_or(true);
    let show_coordinates = payload.show_coordinates.unwrap_or(true);
    let pvp = payload.pvp.unwrap_or(true);

    let profile = WorldProfile {
        name: name.clone(),
        seed: seed.clone(),
        gamemode: gamemode.clone(),
        difficulty: difficulty.clone(),
        allow_cheats,
        force_gamemode,
        world_type,
        show_coordinates,
        pvp,
    };

    let _ = mgr.save_world_profile(&name, &profile);
    let _ = fs::write(world_path.join("levelname.txt"), &name);
    let _ = fs::write(world_path.join("world_resource_packs.json"), "[]");
    let _ = fs::write(world_path.join("world_behavior_packs.json"), "[]");

    let activate_now = payload.activate_now.unwrap_or(false);
    if activate_now {
        mgr.sync_world_profile_to_server_properties(&profile);
        if mgr.is_server_running().await {
            let m = Arc::clone(&mgr);
            tokio::spawn(async move {
                m.restart_server().await;
            });
        }
    }

    Ok(Json(json!({
        "result": format!("World '{}' created successfully.", name),
        "world": profile,
        "activated": activate_now,
    })))
}

#[derive(Deserialize)]
pub struct WorldActionPayload {
    pub world: Option<String>,
}

pub async fn api_delete_world(
    State(mgr): State<Arc<ServerManager>>,
    Json(payload): Json<WorldActionPayload>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let world = payload.world.unwrap_or_default();
    if world.is_empty() {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"result": "No world specified."}))));
    }

    if let Some(active) = mgr.get_active_world_name() {
        if active == world {
            return Err((StatusCode::BAD_REQUEST, Json(json!({"result": "Cannot delete the active world."}))));
        }
    }

    let world_path = mgr.worlds_dir.join(&world);
    if !world_path.exists() {
        return Err((StatusCode::NOT_FOUND, Json(json!({"result": "World not found."}))));
    }

    if let Err(e) = fs::remove_dir_all(&world_path) {
        return Err((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"result": format!("Failed to delete world: {}", e)}))));
    }

    Ok(Json(json!({"result": format!("World '{}' deleted.", world)})))
}

pub async fn api_backup_world(
    State(mgr): State<Arc<ServerManager>>,
    Json(payload): Json<WorldActionPayload>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let world = payload.world.unwrap_or_default();
    if world.is_empty() {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"result": "No world specified."}))));
    }

    let world_path = mgr.worlds_dir.join(&world);
    if !world_path.exists() {
        return Err((StatusCode::NOT_FOUND, Json(json!({"result": "World not found."}))));
    }

    let timestamp = Local::now().format("%Y%m%d-%H%M%S").to_string();
    let backup_dir = mgr.backup_dir.join(&world);
    let _ = fs::create_dir_all(&backup_dir);
    let zip_file_path = backup_dir.join(format!("{}-{}.zip", world, timestamp));

    let file = match File::create(&zip_file_path) {
        Ok(f) => f,
        Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"result": format!("Failed to create backup file: {}", e)})))),
    };

    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    for entry in WalkDir::new(&world_path).into_iter().flatten() {
        let path = entry.path();
        if path.is_file() {
            if let Ok(rel) = path.strip_prefix(&world_path) {
                let name = rel.to_string_lossy().replace('\\', "/");
                let _ = zip.start_file(name, options);
                if let Ok(mut f) = File::open(path) {
                    let mut buf = Vec::new();
                    let _ = f.read_to_end(&mut buf);
                    let _ = zip.write_all(&buf);
                }
            }
        }
    }

    if let Err(e) = zip.finish() {
        return Err((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"result": format!("Failed finalizing zip: {}", e)}))));
    }

    Ok(Json(json!({"result": format!("Backup for '{}' created successfully.", world)})))
}

#[derive(Deserialize)]
pub struct BackupQuery {
    pub world: Option<String>,
}

pub async fn api_list_backups(
    State(mgr): State<Arc<ServerManager>>,
    Query(query): Query<BackupQuery>,
) -> Json<Value> {
    let world = query.world.unwrap_or_default();
    if world.is_empty() {
        return Json(json!({"backups": []}));
    }

    let backup_path = mgr.backup_dir.join(&world);
    if !backup_path.exists() {
        return Json(json!({"backups": []}));
    }

    let mut backups = Vec::new();
    if let Ok(entries) = fs::read_dir(&backup_path) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_file() {
                    let filename = entry.file_name().to_string_lossy().to_string();
                    let size_kb = meta.len() / 1024;
                    let mtime: chrono::DateTime<Local> = meta.modified().unwrap_or(std::time::SystemTime::now()).into();
                    backups.push(BackupItem {
                        filename,
                        size: format!("{} KB", size_kb),
                        date: mtime.format("%Y-%m-%d %H:%M:%S").to_string(),
                    });
                }
            }
        }
    }

    backups.sort_by(|a, b| b.filename.cmp(&a.filename));
    Json(json!({"backups": backups}))
}

pub async fn api_players(State(mgr): State<Arc<ServerManager>>) -> Json<Value> {
    let global_json = mgr.data_dir.join("player_list.json");
    let mut player_data: HashMap<String, GlobalPlayerRecord> = fs::read_to_string(&global_json)
        .ok()
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_default();

    let permissions_path = mgr.base_dir.join("permissions.json");
    let permissions: Vec<PermissionEntry> = fs::read_to_string(&permissions_path)
        .ok()
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_default();

    let allowlist_path = mgr.base_dir.join("allowlist.json");
    let allowlist_entries: Vec<AllowlistEntry> = fs::read_to_string(&allowlist_path)
        .ok()
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_default();

    let mut allowlist_enabled = false;
    if mgr.server_properties.exists() {
        if let Ok(props) = fs::read_to_string(&mgr.server_properties) {
            for line in props.lines() {
                if line.trim().starts_with("allow-list=") {
                    allowlist_enabled = line.trim()["allow-list=".len()..].trim().eq_ignore_ascii_case("true");
                }
            }
        }
    }

    let online_set = mgr.online_players.read().await.clone();
    let sessions_map = mgr.player_session_times.read().await.clone();

    let mut all_players: std::collections::BTreeSet<String> = player_data.keys().cloned().collect();
    for p in &online_set {
        all_players.insert(p.clone());
    }

    let now = Local::now();
    let mut result = Vec::new();

    for player in all_players {
        let pdata = player_data.remove(&player).unwrap_or(GlobalPlayerRecord {
            last_connected: None,
            last_disconnected: None,
            xuid: None,
        });

        let xuid = pdata.xuid.clone();
        let mut level = "member".to_string();
        if let Some(ref x) = xuid {
            for perm in &permissions {
                let perm_xuid = match &perm.xuid {
                    Value::Number(n) => n.to_string(),
                    Value::String(s) => s.clone(),
                    _ => String::new(),
                };
                if perm_xuid == *x {
                    level = perm.permission.clone();
                    break;
                }
            }
        }

        let is_online = online_set.contains(&player);
        let status = if is_online { "Online" } else { "Offline" }.to_string();
        let last_seen = pdata.last_disconnected.unwrap_or_else(|| "-".to_string());

        let mut session_time = "--".to_string();
        let mut session_start = None;
        let mut session_world = None;

        if is_online {
            if let Some((start, world)) = sessions_map.get(&player) {
                let seconds = (now - *start).num_seconds();
                session_time = ServerManager::format_duration(seconds);
                session_start = Some(start.format("%Y-%m-%d %H:%M:%S").to_string());
                session_world = Some(world.clone());
            }
        }

        let in_allowlist = if let Some(ref x) = xuid {
            allowlist_entries.iter().any(|e| e.xuid == *x)
        } else {
            true
        };

        result.push(PlayerInfo {
            name: player,
            xuid,
            level,
            status,
            last_seen,
            session_time,
            session_start,
            session_world,
            allowlist_enabled,
            in_allowlist,
        });
    }

    Json(json!({"players": result}))
}

#[derive(Deserialize)]
pub struct PlayerActionPayload {
    pub player: Option<String>,
    pub action: Option<String>,
}

pub async fn api_player_action(
    State(mgr): State<Arc<ServerManager>>,
    Json(payload): Json<PlayerActionPayload>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let player = payload.player.unwrap_or_default();
    let action = payload.action.unwrap_or_default();

    if player.is_empty() || action.is_empty() {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"result": "Missing player or action."}))));
    }

    let global_json = mgr.data_dir.join("player_list.json");
    let player_data: HashMap<String, GlobalPlayerRecord> = fs::read_to_string(&global_json)
        .ok()
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_default();

    let xuid = match player_data.get(&player).and_then(|p| p.xuid.clone()) {
        Some(x) => x,
        None => return Err((StatusCode::NOT_FOUND, Json(json!({"result": format!("XUID not found for {}.", player)})))),
    };

    let allowlist_path = mgr.base_dir.join("allowlist.json");
    let permissions_path = mgr.base_dir.join("permissions.json");

    match action.as_str() {
        "ban" => {
            let mut allowlist: Vec<AllowlistEntry> = fs::read_to_string(&allowlist_path)
                .ok()
                .and_then(|c| serde_json::from_str(&c).ok())
                .unwrap_or_default();

            allowlist.retain(|e| e.xuid != xuid);
            let _ = fs::write(&allowlist_path, serde_json::to_string_pretty(&allowlist).unwrap_or_default());
            mgr.send_server_command("allowlist reload").await;
            mgr.send_server_command(&format!("kick {} You have been banned from this server.", player)).await;
            Ok(Json(json!({"result": format!("Player '{}' has been banned and kicked.", player)})))
        }
        "unban" => {
            let mut allowlist: Vec<AllowlistEntry> = fs::read_to_string(&allowlist_path)
                .ok()
                .and_then(|c| serde_json::from_str(&c).ok())
                .unwrap_or_default();

            if !allowlist.iter().any(|e| e.xuid == xuid) {
                allowlist.push(AllowlistEntry {
                    ignores_player_limit: false,
                    name: player.clone(),
                    xuid: xuid.clone(),
                });
                let _ = fs::write(&allowlist_path, serde_json::to_string_pretty(&allowlist).unwrap_or_default());
                mgr.send_server_command("allowlist reload").await;
                Ok(Json(json!({"result": format!("Player '{}' has been unbanned and added to allowlist.", player)})))
            } else {
                Ok(Json(json!({"result": format!("Player '{}' is already in the allowlist.", player)})))
            }
        }
        "promote" | "demote" => {
            let mut perms: Vec<PermissionEntry> = fs::read_to_string(&permissions_path)
                .ok()
                .and_then(|c| serde_json::from_str(&c).ok())
                .unwrap_or_default();

            let mut current = "member";
            for p in &perms {
                let px = match &p.xuid {
                    Value::Number(n) => n.to_string(),
                    Value::String(s) => s.clone(),
                    _ => String::new(),
                };
                if px == xuid {
                    current = &p.permission;
                    break;
                }
            }

            let new_level = if action == "promote" {
                match current {
                    "visitor" => "member",
                    "member" => "operator",
                    _ => "operator",
                }
            } else {
                match current {
                    "operator" => "member",
                    "member" => "visitor",
                    _ => "visitor",
                }
            };

            perms.retain(|p| {
                let px = match &p.xuid {
                    Value::Number(n) => n.to_string(),
                    Value::String(s) => s.clone(),
                    _ => String::new(),
                };
                px != xuid
            });

            perms.push(PermissionEntry {
                permission: new_level.to_string(),
                xuid: xuid.parse::<u64>().map(Value::from).unwrap_or_else(|_| Value::String(xuid.clone())),
            });

            let _ = fs::write(&permissions_path, serde_json::to_string_pretty(&perms).unwrap_or_default());
            mgr.send_server_command("permission reload").await;
            Ok(Json(json!({"result": format!("Player {} permission updated to {}.", player, new_level)})))
        }
        _ => Err((StatusCode::BAD_REQUEST, Json(json!({"result": "Unknown action."})))),
    }
}

#[derive(Deserialize)]
pub struct PlayerSessionQuery {
    pub player: Option<String>,
}

pub async fn api_player_sessions(
    State(mgr): State<Arc<ServerManager>>,
    Query(query): Query<PlayerSessionQuery>,
) -> Json<Value> {
    let player = query.player.unwrap_or_default();
    if player.is_empty() {
        return Json(json!({"player": "", "total": 0, "sessions": []}));
    }

    let hist_path = mgr.data_dir.join("player_history.json");
    if let Ok(c) = fs::read_to_string(&hist_path) {
        if let Ok(history) = serde_json::from_str::<HashMap<String, PlayerHistoryData>>(&c) {
            if let Some(pdata) = history.get(&player) {
                let sessions = if pdata.sessions.len() > 10 {
                    pdata.sessions[pdata.sessions.len() - 10..].to_vec()
                } else {
                    pdata.sessions.clone()
                };
                return Json(json!({
                    "player": player,
                    "total": pdata.total,
                    "sessions": sessions,
                }));
            }
        }
    }

    Json(json!({"player": player, "total": 0, "sessions": []}))
}

pub async fn api_allowlist_get(State(mgr): State<Arc<ServerManager>>) -> Json<Value> {
    let allowlist_path = mgr.base_dir.join("allowlist.json");
    let data: Vec<Value> = fs::read_to_string(&allowlist_path)
        .ok()
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_default();
    Json(json!({"allowlist": data}))
}

#[derive(Deserialize)]
pub struct AllowlistPostPayload {
    pub name: Option<String>,
    pub xuid: Option<String>,
    #[serde(rename = "ignoresPlayerLimit", default)]
    pub ignores_player_limit: Option<bool>,
    pub action: Option<String>,
}

pub async fn api_allowlist_post(
    State(mgr): State<Arc<ServerManager>>,
    Json(payload): Json<AllowlistPostPayload>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let allowlist_path = mgr.base_dir.join("allowlist.json");
    let mut allowlist: Vec<AllowlistEntry> = fs::read_to_string(&allowlist_path)
        .ok()
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_default();

    let action = payload.action.unwrap_or_else(|| "add".to_string());
    let name = payload.name.unwrap_or_default().trim().to_string();
    let xuid = payload.xuid.unwrap_or_default().trim().to_string();

    if action == "remove" {
        if name.is_empty() && xuid.is_empty() {
            return Err((StatusCode::BAD_REQUEST, Json(json!({"result": "Name or XUID required to remove."}))));
        }
        allowlist.retain(|e| {
            if !xuid.is_empty() && e.xuid == xuid {
                return false;
            }
            if !name.is_empty() && e.name.eq_ignore_ascii_case(&name) {
                return false;
            }
            true
        });
    } else {
        if name.is_empty() {
            return Err((StatusCode::BAD_REQUEST, Json(json!({"result": "Player name is required."}))));
        }
        allowlist.retain(|e| !e.name.eq_ignore_ascii_case(&name));
        allowlist.push(AllowlistEntry {
            name: name.clone(),
            xuid,
            ignores_player_limit: payload.ignores_player_limit.unwrap_or(false),
        });
    }

    let _ = fs::write(&allowlist_path, serde_json::to_string_pretty(&allowlist).unwrap_or_default());
    mgr.send_server_command("allowlist reload").await;
    Ok(Json(json!({"result": "Allowlist updated successfully."})))
}

pub async fn api_cheats_status(State(mgr): State<Arc<ServerManager>>) -> Json<Value> {
    let mut cheats = false;
    if mgr.server_properties.exists() {
        if let Ok(c) = fs::read_to_string(&mgr.server_properties) {
            for line in c.lines() {
                if line.trim().starts_with("allow-cheats=") {
                    cheats = line.trim()["allow-cheats=".len()..].trim().eq_ignore_ascii_case("true");
                }
            }
        }
    }
    Json(json!({
        "cheats_enabled": cheats,
        "active_world": mgr.get_active_world_name(),
    }))
}

#[derive(Deserialize)]
pub struct PlayerCommandPayload {
    pub command: Option<String>,
}

pub async fn api_player_command(
    State(mgr): State<Arc<ServerManager>>,
    Json(payload): Json<PlayerCommandPayload>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let command = payload.command.unwrap_or_default().trim().to_string();
    if command.is_empty() {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"result": "No command specified."}))));
    }
    if !mgr.is_server_running().await {
        return Err((StatusCode::SERVICE_UNAVAILABLE, Json(json!({"result": "Server is not running."}))));
    }

    // Server console stdin has root permissions, dispatch command directly
    mgr.send_server_command(&command).await;
    Ok(Json(json!({"result": format!("Command dispatched: {}", command)})))
}

pub async fn api_toggle_cheats(State(mgr): State<Arc<ServerManager>>) -> Json<Value> {
    let active = mgr.get_active_world_name().unwrap_or_else(|| "Bedrock level".to_string());
    let mut profile = mgr.get_world_profile(&active);
    profile.allow_cheats = !profile.allow_cheats;
    let _ = mgr.save_world_profile(&active, &profile);
    mgr.sync_world_profile_to_server_properties(&profile);
    mgr.send_server_command(&format!("changesetting allow-cheats {}", profile.allow_cheats)).await;
    Json(json!({
        "result": "success",
        "allow_cheats": profile.allow_cheats,
        "active_world": active,
        "message": format!("Cheats {} on world '{}'", if profile.allow_cheats { "enabled" } else { "disabled" }, active)
    }))
}

#[derive(Deserialize)]
pub struct AddonsQuery {
    pub world: Option<String>,
}

pub async fn api_get_addons(
    State(mgr): State<Arc<ServerManager>>,
    Query(query): Query<AddonsQuery>,
) -> Json<AddonsResponse> {
    let world = query.world.or_else(|| mgr.get_active_world_name());

    let mut b_packs = Vec::new();
    if let Ok(entries) = fs::read_dir(&mgr.behavior_packs_dir) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                let folder = entry.file_name().to_string_lossy().to_string();
                let manifest = entry.path().join("manifest.json");
                let mut name = folder.clone();
                let mut uuid = String::new();
                let mut version = json!("");

                if manifest.exists() {
                    if let Ok(c) = fs::read_to_string(&manifest) {
                        if let Ok(val) = serde_json::from_str::<Value>(&c) {
                            if let Some(h) = val.get("header") {
                                name = h.get("name").and_then(|v| v.as_str()).unwrap_or(&folder).to_string();
                                uuid = h.get("uuid").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                version = h.get("version").cloned().unwrap_or(json!(""));
                            }
                        }
                    }
                }
                b_packs.push(AddonPack { folder, name, uuid, version });
            }
        }
    }

    let mut r_packs = Vec::new();
    if let Ok(entries) = fs::read_dir(&mgr.resource_packs_dir) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                let folder = entry.file_name().to_string_lossy().to_string();
                let manifest = entry.path().join("manifest.json");
                let mut name = folder.clone();
                let mut uuid = String::new();
                let mut version = json!("");

                if manifest.exists() {
                    if let Ok(c) = fs::read_to_string(&manifest) {
                        if let Ok(val) = serde_json::from_str::<Value>(&c) {
                            if let Some(h) = val.get("header") {
                                name = h.get("name").and_then(|v| v.as_str()).unwrap_or(&folder).to_string();
                                uuid = h.get("uuid").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                version = h.get("version").cloned().unwrap_or(json!(""));
                            }
                        }
                    }
                }
                r_packs.push(AddonPack { folder, name, uuid, version });
            }
        }
    }

    let mut applied_behavior = Vec::new();
    let mut applied_resource = Vec::new();

    if let Some(w) = world {
        let wpath = mgr.worlds_dir.join(w);
        let b_json = wpath.join("world_behavior_packs.json");
        let r_json = wpath.join("world_resource_packs.json");

        if let Ok(c) = fs::read_to_string(&b_json) {
            applied_behavior = serde_json::from_str(&c).unwrap_or_default();
        }
        if let Ok(c) = fs::read_to_string(&r_json) {
            applied_resource = serde_json::from_str(&c).unwrap_or_default();
        }
    }

    Json(AddonsResponse {
        behavior_packs: b_packs,
        resource_packs: r_packs,
        applied_behavior,
        applied_resource,
    })
}

#[derive(Deserialize)]
pub struct ApplyAddonsPayload {
    pub world: Option<String>,
    #[serde(default)]
    pub behavior_packs: Vec<String>,
    #[serde(default)]
    pub resource_packs: Vec<String>,
}

pub async fn api_apply_addons(
    State(mgr): State<Arc<ServerManager>>,
    Json(payload): Json<ApplyAddonsPayload>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let world = payload.world.or_else(|| mgr.get_active_world_name()).unwrap_or_default();
    if world.is_empty() {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"result": "No world specified."}))));
    }

    let world_path = mgr.worlds_dir.join(&world);
    if !world_path.exists() {
        return Err((StatusCode::NOT_FOUND, Json(json!({"result": "World not found."}))));
    }

    let mut b_list = Vec::new();
    for d in payload.behavior_packs {
        let manifest = mgr.behavior_packs_dir.join(&d).join("manifest.json");
        if let Ok(c) = fs::read_to_string(manifest) {
            if let Ok(val) = serde_json::from_str::<Value>(&c) {
                if let Some(h) = val.get("header") {
                    let uuid = h.get("uuid").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let version = h.get("version").cloned().unwrap_or(json!(""));
                    if !uuid.is_empty() {
                        b_list.push(AppliedPack { pack_id: uuid, version });
                    }
                }
            }
        }
    }

    let mut r_list = Vec::new();
    for d in payload.resource_packs {
        let manifest = mgr.resource_packs_dir.join(&d).join("manifest.json");
        if let Ok(c) = fs::read_to_string(manifest) {
            if let Ok(val) = serde_json::from_str::<Value>(&c) {
                if let Some(h) = val.get("header") {
                    let uuid = h.get("uuid").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let version = h.get("version").cloned().unwrap_or(json!(""));
                    if !uuid.is_empty() {
                        r_list.push(AppliedPack { pack_id: uuid, version });
                    }
                }
            }
        }
    }

    let b_path = world_path.join("world_behavior_packs.json");
    let r_path = world_path.join("world_resource_packs.json");

    let _ = fs::write(b_path, serde_json::to_string_pretty(&b_list).unwrap_or_default());
    let _ = fs::write(r_path, serde_json::to_string_pretty(&r_list).unwrap_or_default());

    Ok(Json(json!({"result": "Addons applied to world successfully."})))
}

pub async fn api_properties_get(State(mgr): State<Arc<ServerManager>>) -> Json<Value> {
    let schema = mgr.get_properties_schema();
    let mut current_props = HashMap::new();

    if mgr.server_properties.exists() {
        if let Ok(c) = fs::read_to_string(&mgr.server_properties) {
            for line in c.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() || trimmed.starts_with('#') || !trimmed.contains('=') {
                    continue;
                }
                if let Some((k, v)) = trimmed.split_once('=') {
                    current_props.insert(k.trim().to_string(), v.trim().to_string());
                }
            }
        }
    }

    let mut props = Vec::new();
    for mut item in schema {
        let key = &item.key;
        let val_str = current_props.get(key).cloned();
        if let Some(s) = val_str {
            if item.field_type == "bool" {
                item.value = Some(json!(s.eq_ignore_ascii_case("true")));
            } else if item.field_type == "int" {
                item.value = Some(s.parse::<i64>().map(Value::from).unwrap_or_else(|_| json!(s)));
            } else if item.field_type == "float" {
                item.value = Some(s.parse::<f64>().map(Value::from).unwrap_or_else(|_| json!(s)));
            } else {
                item.value = Some(json!(s));
            }
        } else {
            item.value = Some(item.default.clone());
        }
        props.push(item);
    }

    Json(json!({"properties": props}))
}

pub async fn api_properties_post(
    State(mgr): State<Arc<ServerManager>>,
    Json(payload): Json<HashMap<String, Value>>,
) -> Json<Value> {
    let schema = mgr.get_properties_schema();
    let mut out = String::new();

    for item in &schema {
        let key = &item.key;
        let val = payload.get(key).unwrap_or(&item.default);
        let val_str = match val {
            Value::String(s) => s.clone(),
            Value::Bool(b) => b.to_string(),
            Value::Number(n) => n.to_string(),
            _ => val.to_string(),
        };
        out.push_str(&format!("{}={}\n", key, val_str));
    }

    let _ = fs::write(&mgr.server_properties, &out);

    if let Some(active_world) = mgr.get_active_world_name() {
        let world_configs = mgr.data_dir.join("world_configs");
        let _ = fs::create_dir_all(&world_configs);
        let world_prop = world_configs.join(format!("{}.properties", active_world));
        let _ = fs::write(world_prop, &out);
    }

    Json(json!({"result": "Properties saved."}))
}

pub async fn api_latest_version_url() -> Json<Value> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(6))
        .user_agent("Minecraft-Bedrock-Manager/1.0 (Headless Server Controller)")
        .build();

    if let Ok(c) = client {
        if let Ok(res) = c.get("https://raw.githubusercontent.com/kittizz/bedrock-server-downloads/main/bedrock-server-downloads.json").send().await {
            if res.status().is_success() {
                if let Ok(data) = res.json::<Value>().await {
                    if let Some(releases) = data.get("release").and_then(|r| r.as_object()) {
                        let mut versions: Vec<String> = releases.keys().cloned().collect();
                        versions.sort_by(|a, b| {
                            let a_parts: Vec<u32> = a.split('.').filter_map(|s| s.parse().ok()).collect();
                            let b_parts: Vec<u32> = b.split('.').filter_map(|s| s.parse().ok()).collect();
                            a_parts.cmp(&b_parts)
                        });

                        if let Some(latest) = versions.last() {
                            if let Some(rel) = releases.get(latest) {
                                let url = rel.get("linux").and_then(|l| l.get("url")).and_then(|u| u.as_str()).unwrap_or("");
                                let ver_re = Regex::new(r"bedrock-server-([0-9.]+)\.zip").unwrap();
                                let exact_ver = ver_re.captures(url).and_then(|c| c.get(1)).map(|m| m.as_str()).unwrap_or(latest);
                                return Json(json!({"url": url, "version": exact_ver}));
                            }
                        }
                    }
                }
            }
        }
    }

    // High-availability fallback: Latest verified BDS release version
    Json(json!({
        "url": "https://www.minecraft.net/bedrockdedicatedserver/bin-linux/bedrock-server-1.26.52.3.zip",
        "version": "1.26.52.3"
    }))
}

pub async fn api_update_status(State(mgr): State<Arc<ServerManager>>) -> Json<UpdateState> {
    let state = mgr.update_state.read().await.clone();
    Json(state)
}

#[derive(Deserialize)]
pub struct UpdateServerPayload {
    pub download_url: Option<String>,
}

pub async fn api_update_server(
    State(mgr): State<Arc<ServerManager>>,
    payload: Option<Json<UpdateServerPayload>>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let mut url = payload
        .and_then(|p| p.0.download_url)
        .unwrap_or_default();
    if url.is_empty() {
        let Json(latest) = api_latest_version_url().await;
        url = latest.get("url").and_then(|u| u.as_str()).unwrap_or("").to_string();
    }

    if url.is_empty() || (!url.starts_with("http://") && !url.starts_with("https://")) {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"result": "Invalid or missing download URL."}))));
    }

    let mgr_clone = Arc::clone(&mgr);
    tokio::spawn(async move {
        {
            let mut s = mgr_clone.update_state.write().await;
            s.status = "downloading".to_string();
            s.progress = 5;
            s.message = "Downloading server update package...".to_string();
            s.error = String::new();
        }

        let temp_zip = mgr_clone.base_dir.join("bds_update.zip");
        let client = match reqwest::Client::builder().timeout(Duration::from_secs(120)).build() {
            Ok(c) => c,
            Err(e) => {
                let mut s = mgr_clone.update_state.write().await;
                s.status = "failed".to_string();
                s.error = e.to_string();
                return;
            }
        };

        let res = match client.get(&url).header("User-Agent", "Mozilla/5.0").send().await {
            Ok(r) if r.status().is_success() => r,
            Ok(r) => {
                let mut s = mgr_clone.update_state.write().await;
                s.status = "failed".to_string();
                s.error = format!("Download failed with HTTP {}", r.status());
                return;
            }
            Err(e) => {
                let mut s = mgr_clone.update_state.write().await;
                s.status = "failed".to_string();
                s.error = e.to_string();
                return;
            }
        };

        let bytes = match res.bytes().await {
            Ok(b) => b,
            Err(e) => {
                let mut s = mgr_clone.update_state.write().await;
                s.status = "failed".to_string();
                s.error = e.to_string();
                return;
            }
        };

        if let Err(e) = fs::write(&temp_zip, &bytes) {
            let mut s = mgr_clone.update_state.write().await;
            s.status = "failed".to_string();
            s.error = e.to_string();
            return;
        }

        {
            let mut s = mgr_clone.update_state.write().await;
            s.status = "stopping".to_string();
            s.progress = 50;
            s.message = "Stopping Minecraft Dedicated Server...".to_string();
        }
        mgr_clone.stop_server().await;

        {
            let mut s = mgr_clone.update_state.write().await;
            s.status = "extracting".to_string();
            s.progress = 60;
            s.message = "Extracting update package (preserving worlds and configurations)...".to_string();
        }

        if let Ok(file) = File::open(&temp_zip) {
            if let Ok(mut archive) = zip::ZipArchive::new(file) {
                for i in 0..archive.len() {
                    if let Ok(mut item) = archive.by_index(i) {
                        let name = item.name().to_string();
                        if name.starts_with("worlds/")
                            || name.starts_with("server.properties")
                            || name.starts_with("allowlist.json")
                            || name.starts_with("permissions.json")
                            || name.starts_with("data/")
                        {
                            continue;
                        }
                        let outpath = mgr_clone.base_dir.join(&name);
                        if item.is_dir() {
                            let _ = fs::create_dir_all(&outpath);
                        } else {
                            if let Some(p) = outpath.parent() {
                                let _ = fs::create_dir_all(p);
                            }
                            if let Ok(mut outfile) = File::create(&outpath) {
                                let _ = std::io::copy(&mut item, &mut outfile);
                            }
                        }
                    }
                }
            }
        }
        let _ = fs::remove_file(&temp_zip);

        #[cfg(target_os = "linux")]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Ok(meta) = fs::metadata(&mgr_clone.server_path) {
                let mut perms = meta.permissions();
                perms.set_mode(0o755);
                let _ = fs::set_permissions(&mgr_clone.server_path, perms);
            }
        }

        {
            let mut s = mgr_clone.update_state.write().await;
            s.status = "restarting".to_string();
            s.progress = 95;
            s.message = "Starting updated Bedrock Server...".to_string();
        }

        mgr_clone.start_server().await;

        {
            let mut s = mgr_clone.update_state.write().await;
            s.status = "success".to_string();
            s.progress = 100;
            s.message = "Update completed successfully! Server is online.".to_string();
        }
    });

    Ok(Json(json!({"result": "Update process started."})))
}

pub async fn api_get_settings(State(mgr): State<Arc<ServerManager>>) -> Json<Value> {
    let settings_path = mgr.data_dir.join("settings.json");
    if let Ok(c) = fs::read_to_string(settings_path) {
        if let Ok(val) = serde_json::from_str::<Value>(&c) {
            return Json(val);
        }
    }
    Json(json!({}))
}

pub async fn api_set_settings(
    State(mgr): State<Arc<ServerManager>>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let settings_path = mgr.data_dir.join("settings.json");
    if let Ok(c) = serde_json::to_string_pretty(&payload) {
        if let Err(e) = fs::write(settings_path, c) {
            return Err((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"result": format!("Failed to save settings: {}", e)}))));
        }
    }
    Ok(Json(json!({"result": "Settings saved successfully."})))
}

pub async fn api_upload_world(
    State(mgr): State<Arc<ServerManager>>,
    mut multipart: Multipart,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    while let Ok(Some(field)) = multipart.next_field().await {
        let filename = field.file_name().unwrap_or_default().to_string();
        if !filename.ends_with(".zip") && !filename.ends_with(".mcworld") {
            continue;
        }

        let temp_path = mgr.base_dir.join(&filename);
        let bytes = field.bytes().await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"result": e.to_string()}))))?;
        fs::write(&temp_path, bytes).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"result": e.to_string()}))))?;

        let file = File::open(&temp_path).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"result": e.to_string()}))))?;
        let mut archive = zip::ZipArchive::new(file).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"result": e.to_string()}))))?;

        let mut level_dat_path = None;
        for i in 0..archive.len() {
            if let Ok(item) = archive.by_index(i) {
                if item.name().ends_with("level.dat") {
                    level_dat_path = Some(item.name().to_string());
                    break;
                }
            }
        }

        let level_dat = match level_dat_path {
            Some(p) => p,
            None => {
                let _ = fs::remove_file(&temp_path);
                return Err((StatusCode::BAD_REQUEST, Json(json!({"result": "Invalid Minecraft world: level.dat not found in archive."}))));
            }
        };

        let parts: Vec<&str> = level_dat.split('/').collect();
        let world_name = if parts.len() > 1 {
            parts[0].to_string()
        } else {
            Path::new(&filename).file_stem().unwrap_or_default().to_string_lossy().to_string()
        };

        let dest_dir = mgr.worlds_dir.join(&world_name);
        let _ = fs::remove_dir_all(&dest_dir);
        let _ = fs::create_dir_all(&dest_dir);

        let prefix = if parts.len() > 1 { format!("{}/", parts[0]) } else { String::new() };

        for i in 0..archive.len() {
            if let Ok(mut item) = archive.by_index(i) {
                let raw_name = item.name().to_string();
                let sub_path = if !prefix.is_empty() && raw_name.starts_with(&prefix) {
                    &raw_name[prefix.len()..]
                } else if prefix.is_empty() {
                    &raw_name
                } else {
                    continue;
                };

                if sub_path.is_empty() {
                    continue;
                }

                let outpath = dest_dir.join(sub_path);
                if item.is_dir() {
                    let _ = fs::create_dir_all(&outpath);
                } else {
                    if let Some(p) = outpath.parent() {
                        let _ = fs::create_dir_all(p);
                    }
                    if let Ok(mut outfile) = File::create(&outpath) {
                        let _ = std::io::copy(&mut item, &mut outfile);
                    }
                }
            }
        }

        let _ = fs::remove_file(&temp_path);
        return Ok(Json(json!({"result": format!("World '{}' imported successfully.", world_name)})));
    }

    Err((StatusCode::BAD_REQUEST, Json(json!({"result": "No valid world file uploaded."}))))
}

pub async fn api_upload_addon(
    State(mgr): State<Arc<ServerManager>>,
    mut multipart: Multipart,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    while let Ok(Some(field)) = multipart.next_field().await {
        let filename = field.file_name().unwrap_or_default().to_string();
        if !filename.ends_with(".zip") && !filename.ends_with(".mcpack") {
            continue;
        }

        let temp_path = mgr.base_dir.join(&filename);
        let bytes = field.bytes().await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"result": e.to_string()}))))?;
        fs::write(&temp_path, bytes).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"result": e.to_string()}))))?;

        let file = File::open(&temp_path).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"result": e.to_string()}))))?;
        let mut archive = zip::ZipArchive::new(file).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"result": e.to_string()}))))?;

        let mut manifest_name = None;
        let mut manifest_content = String::new();

        for i in 0..archive.len() {
            if let Ok(mut item) = archive.by_index(i) {
                if item.name().ends_with("manifest.json") {
                    manifest_name = Some(item.name().to_string());
                    let mut s = String::new();
                    let _ = item.read_to_string(&mut s);
                    manifest_content = s;
                    break;
                }
            }
        }

        let manifest_file = match manifest_name {
            Some(n) => n,
            None => {
                let _ = fs::remove_file(&temp_path);
                return Err((StatusCode::BAD_REQUEST, Json(json!({"result": "Invalid addon: manifest.json not found inside zip."}))));
            }
        };

        let mut pack_type = "resources";
        if let Ok(val) = serde_json::from_str::<Value>(&manifest_content) {
            if let Some(modules) = val.get("modules").and_then(|m| m.as_array()) {
                for m in modules {
                    if let Some(t) = m.get("type").and_then(|v| v.as_str()) {
                        if t == "data" || t == "client_data" {
                            pack_type = "behavior";
                            break;
                        }
                    }
                }
            }
        }

        let target_dir = if pack_type == "behavior" {
            &mgr.behavior_packs_dir
        } else {
            &mgr.resource_packs_dir
        };

        let parts: Vec<&str> = manifest_file.split('/').collect();
        let folder_name = if parts.len() > 1 {
            parts[0].to_string()
        } else {
            Path::new(&filename).file_stem().unwrap_or_default().to_string_lossy().to_string()
        };

        let extract_dest = target_dir.join(&folder_name);
        let _ = fs::remove_dir_all(&extract_dest);
        let _ = fs::create_dir_all(&extract_dest);

        let prefix = if parts.len() > 1 { format!("{}/", parts[0]) } else { String::new() };

        for i in 0..archive.len() {
            if let Ok(mut item) = archive.by_index(i) {
                let raw_name = item.name().to_string();
                let sub_path = if !prefix.is_empty() && raw_name.starts_with(&prefix) {
                    &raw_name[prefix.len()..]
                } else if prefix.is_empty() {
                    &raw_name
                } else {
                    continue;
                };

                if sub_path.is_empty() {
                    continue;
                }

                let outpath = extract_dest.join(sub_path);
                if item.is_dir() {
                    let _ = fs::create_dir_all(&outpath);
                } else {
                    if let Some(p) = outpath.parent() {
                        let _ = fs::create_dir_all(p);
                    }
                    if let Ok(mut outfile) = File::create(&outpath) {
                        let _ = std::io::copy(&mut item, &mut outfile);
                    }
                }
            }
        }

        let _ = fs::remove_file(&temp_path);
        return Ok(Json(json!({"result": format!("Addon '{}' uploaded and installed as {} pack.", folder_name, pack_type)})));
    }

    Err((StatusCode::BAD_REQUEST, Json(json!({"result": "No file uploaded."}))))
}

pub async fn api_get_announcements(State(mgr): State<Arc<ServerManager>>) -> Json<AnnouncementSettings> {
    Json(mgr.get_announcements())
}

pub async fn api_set_announcements(
    State(mgr): State<Arc<ServerManager>>,
    Json(settings): Json<AnnouncementSettings>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if let Err(e) = mgr.save_announcements(&settings) {
        return Err((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"result": format!("Failed to save announcements: {}", e)}))));
    }
    Ok(Json(json!({"result": "Announcements updated successfully."})))
}

#[derive(Deserialize)]
pub struct BroadcastPayload {
    pub message: Option<String>,
}

pub async fn api_broadcast_now(
    State(mgr): State<Arc<ServerManager>>,
    payload: Option<Json<BroadcastPayload>>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let settings = mgr.get_announcements();
    let text = payload
        .and_then(|p| p.0.message)
        .filter(|m| !m.trim().is_empty())
        .unwrap_or_else(|| {
            settings
                .messages
                .first()
                .cloned()
                .unwrap_or_else(|| "Server announcement test.".to_string())
        });

    let formatted = format!("say {}{}", settings.prefix, text);
    mgr.send_server_command(&formatted).await;
    Ok(Json(json!({
        "result": "Broadcast sent to all players.",
        "message": text
    })))
}

pub async fn api_lifecycle_status(
    State(mgr): State<Arc<ServerManager>>,
) -> Json<CountdownStatus> {
    Json(mgr.get_countdown_status().await)
}

pub async fn api_lifecycle_execute(
    State(mgr): State<Arc<ServerManager>>,
    Json(req): Json<LifecycleRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    match mgr.trigger_lifecycle_action(req).await {
        Ok(msg) => Ok(Json(json!({"result": msg}))),
        Err(err) => Err((StatusCode::BAD_REQUEST, Json(json!({"result": err})))),
    }
}

pub async fn api_lifecycle_abort(
    State(mgr): State<Arc<ServerManager>>,
) -> Json<Value> {
    let aborted = mgr.abort_countdown().await;
    Json(json!({
        "result": if aborted { "Scheduled countdown successfully cancelled." } else { "No active countdown to cancel." },
        "aborted": aborted
    }))
}

pub async fn api_set_gamerule(
    State(mgr): State<Arc<ServerManager>>,
    Json(req): Json<SetGameruleRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let cmd = format!("gamerule {} {}", req.rule, req.value);
    mgr.send_server_command(&cmd).await;
    Ok(Json(json!({
        "result": format!("Gamerule '{}' updated to '{}'", req.rule, req.value)
    })))
}
