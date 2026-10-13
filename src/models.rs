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

#[derive(Debug, Serialize)]
pub struct WorldsResponse {
    pub worlds: Vec<String>,
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
