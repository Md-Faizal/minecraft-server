use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::extract::DefaultBodyLimit;
use axum::routing::{get, post};
use axum::Router;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::ServeDir;
use tower_http::trace::TraceLayer;
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod handlers;
mod manager;
mod models;

use manager::ServerManager;

#[tokio::main]
async fn main() {
    // Initialize logging
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "minecraft_server_manager=debug,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Determine base directory
    let base_dir_str = std::env::var("MINECRAFT_BASE_DIR").unwrap_or_else(|_| {
        if Path::new("/home/ubuntu/minecraft-server").exists() {
            "/home/ubuntu/minecraft-server".to_string()
        } else if Path::new("Path.txt").exists() {
            std::fs::read_to_string("Path.txt")
                .map(|s| s.trim().to_string())
                .unwrap_or_else(|_| ".".to_string())
        } else {
            ".".to_string()
        }
    });

    let base_dir = PathBuf::from(base_dir_str);
    let manager = ServerManager::new(base_dir);

    // Static dir detection
    let static_dir = if Path::new("static").exists() {
        "static"
    } else if Path::new("/home/ubuntu/stack/games/minecraft/static").exists() {
        "/home/ubuntu/stack/games/minecraft/static"
    } else {
        "static"
    };

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/", get(handlers::index_page))
        .route("/index.html", get(handlers::index_page))
        .route("/api/status", get(handlers::api_status))
        .route("/api/start", post(handlers::api_start))
        .route("/api/stop", post(handlers::api_stop))
        .route("/api/restart", post(handlers::api_restart))
        .route("/api/server_output", get(handlers::api_server_output))
        .route("/api/command", post(handlers::api_command))
        .route("/api/worlds", get(handlers::api_worlds))
        .route("/api/set_active_world", post(handlers::api_set_active_world))
        .route("/api/worlds/active", post(handlers::api_set_active_world))
        .route("/api/worlds/create", post(handlers::api_create_world))
        .route("/api/worlds/delete", post(handlers::api_delete_world))
        .route("/api/worlds/backup", post(handlers::api_backup_world))
        .route("/api/backup_world", post(handlers::api_backup_world))
        .route("/api/list_backups", get(handlers::api_list_backups))
        .route("/api/backups", get(handlers::api_list_backups))
        .route("/api/players", get(handlers::api_players))
        .route("/api/player_action", post(handlers::api_player_action))
        .route("/api/player/action", post(handlers::api_player_action))
        .route("/api/player_sessions", get(handlers::api_player_sessions))
        .route("/favicon.ico", get(handlers::favicon))
        .route("/api/allowlist", get(handlers::api_allowlist_get).post(handlers::api_allowlist_post))
        .route("/api/cheats_status", get(handlers::api_cheats_status))
        .route("/api/cheats", get(handlers::api_cheats_status))
        .route("/api/cheats/toggle", post(handlers::api_toggle_cheats))
        .route("/api/player_command", post(handlers::api_player_command))
        .route("/api/addons", get(handlers::api_get_addons))
        .route("/api/addons/apply", post(handlers::api_apply_addons))
        .route("/api/addons/upload", post(handlers::api_upload_addon))
        .route("/api/worlds/upload", post(handlers::api_upload_world))
        .route(
            "/api/properties",
            get(handlers::api_properties_get).post(handlers::api_properties_post),
        )
        .route("/api/latest_version_url", get(handlers::api_latest_version_url))
        .route("/api/latest_version", get(handlers::api_latest_version_url))
        .route("/api/update_status", get(handlers::api_update_status))
        .route("/api/update_server", post(handlers::api_update_server))
        .route(
            "/api/settings",
            get(handlers::api_get_settings).post(handlers::api_set_settings),
        )
        .route(
            "/api/announcements",
            get(handlers::api_get_announcements).post(handlers::api_set_announcements),
        )
        .route("/api/announcements/broadcast_now", post(handlers::api_broadcast_now))
        .route("/api/lifecycle/status", get(handlers::api_lifecycle_status))
        .route("/api/lifecycle/execute", post(handlers::api_lifecycle_execute))
        .route("/api/lifecycle/abort", post(handlers::api_lifecycle_abort))
        .route("/api/gamerules/set", post(handlers::api_set_gamerule))
        .route("/api/map/data", get(handlers::api_map_data))
        .route("/api/map/action", post(handlers::api_map_action))
        .route("/api/map/waypoint", post(handlers::api_map_add_waypoint))
        .route("/api/map/waypoint/delete", post(handlers::api_map_delete_waypoint))
        .nest_service("/static", ServeDir::new(static_dir))
        .layer(DefaultBodyLimit::max(500 * 1024 * 1024)) // 500 MB max for world uploads
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(Arc::clone(&manager));

    // Automatically ensure the Bedrock Dedicated Server starts when manager daemon boots
    let auto_start_mgr = Arc::clone(&manager);
    tokio::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_millis(600)).await;
        if !auto_start_mgr.is_server_running().await {
            info!("🎮 Auto-starting Bedrock Dedicated Server daemon on manager boot...");
            auto_start_mgr.start_server().await;
        }
    });

    // Smart Automated In-Game Announcements daemon
    let ann_mgr = Arc::clone(&manager);
    tokio::spawn(async move {
        let mut msg_idx = 0usize;
        loop {
            let settings = ann_mgr.get_announcements();
            let interval = if settings.enabled && !settings.messages.is_empty() {
                settings.interval_seconds.max(10)
            } else {
                30
            };
            tokio::time::sleep(tokio::time::Duration::from_secs(interval)).await;

            let current_settings = ann_mgr.get_announcements();
            if !current_settings.enabled || current_settings.messages.is_empty() {
                continue;
            }

            if !ann_mgr.is_server_running().await {
                continue;
            }

            if current_settings.only_when_online {
                let online = ann_mgr.online_players.read().await;
                if online.is_empty() {
                    continue;
                }
            }

            let message = if current_settings.mode == "random" {
                let now_ms = chrono::Utc::now().timestamp_millis() as usize;
                let idx = now_ms % current_settings.messages.len();
                current_settings.messages.get(idx).cloned()
            } else {
                let msg = current_settings.messages.get(msg_idx % current_settings.messages.len()).cloned();
                msg_idx = (msg_idx + 1) % current_settings.messages.len();
                msg
            };

            if let Some(msg) = message {
                let formatted = format!("say {}{}", current_settings.prefix, msg);
                info!("📢 Broadcasting automated announcement: {}", formatted);
                ann_mgr.send_server_command(&formatted).await;
            }
        }
    });

    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "5000".to_string())
        .parse()
        .unwrap_or(5000);

    let host = std::env::var("HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
    let addr: SocketAddr = format!("{}:{}", host, port)
        .parse()
        .expect("Invalid listen address");

    info!("🚀 Minecraft Server Manager (Rust) running at http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
