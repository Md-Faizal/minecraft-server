use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use std::time::Duration;
use tracing::info;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CpuTelemetry {
    #[serde(default)]
    pub usage_pct: f64,
    pub model: Option<String>,
    #[serde(default)]
    pub logical_cores: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MemoryTelemetry {
    #[serde(default)]
    pub total_bytes: u64,
    #[serde(default)]
    pub used_bytes: u64,
    #[serde(default)]
    pub used_pct: f64,
    pub swap_used_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ThermalTelemetry {
    pub cpu_temp_c: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct NodeTelemetry {
    pub cpu: Option<CpuTelemetry>,
    pub memory: Option<MemoryTelemetry>,
    pub thermals: Option<ThermalTelemetry>,
    pub uptime_secs: Option<u64>,
    pub hostname: Option<String>,
    pub os_label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeInfo {
    pub node_id: String,
    pub hostname: String,
    pub os: String,
    pub os_version: Option<String>,
    pub status: String,
    #[serde(default)]
    pub last_seen_secs: u64,
    #[serde(default)]
    pub features: HashMap<String, bool>,
    pub telemetry: Option<NodeTelemetry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandPayload {
    pub action: String,
    #[serde(default)]
    pub args: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandAck {
    pub command_id: Option<String>,
    pub success: bool,
    pub exit_code: Option<i32>,
    pub stdout: Option<String>,
    pub stderr: Option<String>,
    pub execution_ms: Option<u64>,
    pub message: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NexusMeshClient {
    client: Client,
    pub hub_url: Option<String>,
    pub admin_pin: Option<String>,
    pub target_node_id: Option<String>,
}

impl NexusMeshClient {
    pub fn new() -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(6))
            .build()
            .unwrap_or_default();

        let hub_url = env::var("NEXUS_HUB_URL").ok().filter(|s| !s.trim().is_empty());
        let admin_pin = env::var("NEXUS_ADMIN_PIN").ok().filter(|s| !s.trim().is_empty());
        let target_node_id = env::var("NEXUS_TARGET_NODE_ID").ok().filter(|s| !s.trim().is_empty());

        Self {
            client,
            hub_url,
            admin_pin,
            target_node_id,
        }
    }

    pub fn is_configured(&self) -> bool {
        self.hub_url.is_some()
    }

    /// Retrieve all nodes in the Nexus fleet mesh
    pub async fn get_fleet_nodes(&self) -> Result<Vec<NodeInfo>, String> {
        let hub_url = self.hub_url.as_ref().ok_or_else(|| "Nexus Hub URL is not configured (NEXUS_HUB_URL unset)".to_string())?;
        let url = format!("{}/api/fleet/nodes", hub_url.trim_end_matches('/'));
        let mut req = self.client.get(&url);

        if let Some(pin) = &self.admin_pin {
            req = req.header("X-Admin-Pin", pin)
                .header("Authorization", format!("Bearer {}", pin));
        }

        let res = req
            .send()
            .await
            .map_err(|e| format!("Failed to contact Nexus Hub at {}: {}", url, e))?;

        if !res.status().is_success() {
            return Err(format!("Nexus Hub returned HTTP status {}", res.status()));
        }

        res.json::<Vec<NodeInfo>>()
            .await
            .map_err(|e| format!("Failed to parse Nexus fleet nodes: {}", e))
    }

    /// Dynamically locate the active Minecraft host node in the fleet
    pub async fn get_active_minecraft_node(&self) -> Option<NodeInfo> {
        let nodes = self.get_fleet_nodes().await.ok()?;

        // 1. Look for explicit target node ID if configured
        if let Some(ref target_id) = self.target_node_id {
            if let Some(n) = nodes.iter().find(|n| &n.node_id == target_id) {
                return Some(n.clone());
            }
        }

        // 2. Look for node with "minecraft": true feature flag
        if let Some(n) = nodes
            .iter()
            .find(|n| n.features.get("minecraft") == Some(&true) && n.status == "online")
        {
            return Some(n.clone());
        }

        // 3. Fallback: Return any online node
        nodes.into_iter().find(|n| n.status == "online")
    }

    /// Dispatch a command or action through the Nexus Mesh RPC
    pub async fn dispatch_action(&self, action: &str, args: Vec<String>) -> Result<CommandAck, String> {
        let hub_url = self.hub_url.as_ref().ok_or_else(|| "Nexus Hub URL not configured".to_string())?;
        let node = self
            .get_active_minecraft_node()
            .await
            .ok_or_else(|| "No active Minecraft node discovered in the Nexus fleet mesh".to_string())?;

        let url = format!(
            "{}/api/fleet/nodes/{}/command",
            hub_url.trim_end_matches('/'),
            node.node_id
        );

        let payload = CommandPayload {
            action: action.to_string(),
            args,
        };

        info!("Dispatching Nexus Mesh action '{}' to node {}", action, node.node_id);

        let mut req = self.client.post(&url);
        if let Some(pin) = &self.admin_pin {
            req = req.header("X-Admin-Pin", pin)
                .header("Authorization", format!("Bearer {}", pin));
        }

        let res = req
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("Failed to dispatch command to {}: {}", url, e))?;

        if !res.status().is_success() {
            return Err(format!("Hub returned error code {} during command dispatch", res.status()));
        }

        res.json::<CommandAck>()
            .await
            .map_err(|e| format!("Failed to parse command dispatch response: {}", e))
    }

    /// Extract structured hardware telemetry for the active Minecraft host node
    pub async fn get_active_telemetry(&self) -> Result<crate::models::HardwareTelemetryResponse, String> {
        let node = self
            .get_active_minecraft_node()
            .await
            .ok_or_else(|| "No active Minecraft node discovered in the Nexus fleet mesh".to_string())?;

        let tele = node.telemetry.unwrap_or_default();
        let cpu = tele.cpu.unwrap_or_default();
        let mem = tele.memory.unwrap_or_default();
        let therm = tele.thermals.unwrap_or_default();

        let mem_used_mb = mem.used_bytes / (1024 * 1024);
        let mem_total_mb = mem.total_bytes / (1024 * 1024);
        let swap_used_mb = mem.swap_used_bytes.unwrap_or(0) / (1024 * 1024);

        let mode = if mem_used_mb > 0 && mem_used_mb < 1500 {
            "Headless Gaming Mode (Max RAM)".to_string()
        } else {
            "Desktop GUI Mode".to_string()
        };

        Ok(crate::models::HardwareTelemetryResponse {
            hostname: node.hostname,
            os_label: tele.os_label.unwrap_or_else(|| node.os.clone()),
            mode,
            cpu_pct: cpu.usage_pct,
            cpu_cores: cpu.logical_cores,
            memory_used_mb: mem_used_mb,
            memory_total_mb: mem_total_mb,
            memory_pct: mem.used_pct,
            swap_used_mb,
            temp_c: therm.cpu_temp_c,
            uptime_secs: tele.uptime_secs.unwrap_or(0),
            cpu_model: cpu.model,
            node_os: Some(node.os),
        })
    }
}
