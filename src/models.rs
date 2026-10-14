use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateState {
    pub status: String,
    pub progress: u32,
    pub message: String,
    pub error: String,
}

impl Default for UpdateState {
    fn default() -> Self {
        Self {
            status: "idle".to_string(),
            progress: 0,
            message: String::new(),
            error: String::new(),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct StatusResponse {
    pub server_running: bool,
    pub online_players: Vec<String>,
    pub active_world: Option<String>,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PropertySchemaItem {
    pub key: String,
    pub label: String,
    #[serde(rename = "type")]
    pub field_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub choices: Option<Vec<String>>,
    pub default: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldProfile {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub seed: String,
    #[serde(default = "default_gamemode")]
    pub gamemode: String,
    #[serde(default = "default_difficulty")]
    pub difficulty: String,
    #[serde(default)]
    pub allow_cheats: bool,
    #[serde(default = "default_true")]
    pub force_gamemode: bool,
    #[serde(default = "default_world_type")]
    pub world_type: String,
    #[serde(default = "default_true")]
    pub show_coordinates: bool,
    #[serde(default = "default_true")]
    pub pvp: bool,
}

fn default_gamemode() -> String { "survival".to_string() }
fn default_difficulty() -> String { "easy".to_string() }
fn default_world_type() -> String { "default".to_string() }
fn default_true() -> bool { true }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldItem {
    pub name: String,
    pub seed: String,
    pub gamemode: String,
    pub difficulty: String,
    pub allow_cheats: bool,
    pub force_gamemode: bool,
    pub world_type: String,
    pub is_active: bool,
    pub size_formatted: String,
}

#[derive(Debug, Serialize)]
pub struct WorldsResponse {
    pub worlds: Vec<WorldItem>,
    pub active_world: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct BackupItem {
    pub filename: String,
    pub size: String,
    pub date: String,
}

#[derive(Debug, Serialize)]
pub struct PlayerInfo {
    pub name: String,
    pub xuid: Option<String>,
    pub level: String,
    pub status: String,
    pub last_seen: String,
    pub session_time: String,
    pub session_start: Option<String>,
    pub session_world: Option<String>,
    pub allowlist_enabled: bool,
    pub in_allowlist: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionEntry {
    pub start: String,
    pub end: String,
    pub world: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PlayerHistoryData {
    #[serde(default)]
    pub total: u64,
    #[serde(default)]
    pub sessions: Vec<SessionEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlobalPlayerRecord {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_connected: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_disconnected: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub xuid: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AllowlistEntry {
    #[serde(rename = "ignoresPlayerLimit", default)]
    pub ignores_player_limit: bool,
    pub name: String,
    pub xuid: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionEntry {
    pub permission: String,
    pub xuid: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddonPack {
    pub folder: String,
    pub name: String,
    pub uuid: String,
    pub version: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppliedPack {
    pub pack_id: String,
    pub version: serde_json::Value,
}

#[derive(Debug, Serialize)]
pub struct AddonsResponse {
    pub behavior_packs: Vec<AddonPack>,
    pub resource_packs: Vec<AddonPack>,
    pub applied_behavior: Vec<AppliedPack>,
    pub applied_resource: Vec<AppliedPack>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnnouncementSettings {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_announcement_interval")]
    pub interval_seconds: u64,
    #[serde(default = "default_true")]
    pub only_when_online: bool,
    #[serde(default = "default_announcement_prefix")]
    pub prefix: String,
    #[serde(default = "default_announcement_mode")]
    pub mode: String,
    #[serde(default = "default_messages")]
    pub messages: Vec<String>,
}

fn default_announcement_interval() -> u64 { 300 }
fn default_announcement_prefix() -> String { "§l§e[Server]§r §b".to_string() }
fn default_announcement_mode() -> String { "sequential".to_string() }
fn default_messages() -> Vec<String> {
    vec![
        "Welcome to the server! Explore, build, and have fun!".to_string(),
        "Remember to respect other players and keep your builds safe.".to_string(),
        "Check your world stats and controls on the Bedrock Manager dashboard!".to_string(),
    ]
}
