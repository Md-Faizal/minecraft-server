use std::env;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::timeout;

const SERVERDATA_AUTH: i32 = 3;
const SERVERDATA_AUTH_RESPONSE: i32 = 2;
const SERVERDATA_EXECCOMMAND: i32 = 2;
#[allow(dead_code)]
const SERVERDATA_RESPONSE_VALUE: i32 = 0;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ChunkyStats {
    pub active: bool,
    pub status: String, // "running", "paused", "idle", "complete"
    pub processed: u64,
    pub total: u64,
    pub percent: f32,
    pub rate_cps: f32,
    pub eta: String,
    pub raw: String,
}

impl Default for ChunkyStats {
    fn default() -> Self {
        Self {
            active: false,
            status: "idle".to_string(),
            processed: 0,
            total: 0,
            percent: 0.0,
            rate_cps: 0.0,
            eta: "--:--".to_string(),
            raw: String::new(),
        }
    }
}

pub struct RconClient {
    pub addr: String,
    pub password: String,
}

impl RconClient {
    pub fn new() -> Self {
        let addr = env::var("RCON_ADDR").unwrap_or_else(|_| "127.0.0.1:25575".to_string());
        let password = env::var("RCON_PASSWORD").unwrap_or_else(|_| "nexuswarfare123".to_string());
        Self { addr, password }
    }

    /// Connect, authenticate, execute a single command, and return response
    pub async fn execute(&self, cmd: &str) -> Result<String, String> {
        let res = timeout(Duration::from_secs(6), async {
            let mut stream = TcpStream::connect(&self.addr)
                .await
                .map_err(|e| format!("Failed to connect to RCON at {}: {}", self.addr, e))?;

            // 1. Authenticate
            Self::send_packet(&mut stream, 1, SERVERDATA_AUTH, &self.password).await?;
            let (auth_id, auth_type, _) = Self::read_packet(&mut stream).await?;

            if auth_id == -1 || auth_type != SERVERDATA_AUTH_RESPONSE {
                return Err("RCON authentication failed: invalid credentials".to_string());
            }

            // 2. Send Command
            Self::send_packet(&mut stream, 2, SERVERDATA_EXECCOMMAND, cmd).await?;
            let (_, _, body) = Self::read_packet(&mut stream).await?;

            Ok(body)
        })
        .await;

        match res {
            Ok(inner) => inner,
            Err(_) => Err("RCON operation timed out (6s)".to_string()),
        }
    }

    /// Query connected players via RCON
    pub async fn get_players(&self) -> Result<Vec<String>, String> {
        let output = self.execute("list").await?;
        if let Some(idx) = output.find(':') {
            let players_str = &output[idx + 1..];
            Ok(players_str
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect())
        } else {
            Ok(Vec::new())
        }
    }

    /// Query Chunky pre-generation progress
    pub async fn get_chunky_progress(&self) -> Result<ChunkyStats, String> {
        let output = self.execute("chunky progress").await?;
        let clean = output.trim();
        if clean.to_lowercase().contains("no tasks running") || clean.to_lowercase().contains("no tasks currently running") {
            return Ok(ChunkyStats {
                active: false,
                status: "idle".to_string(),
                raw: clean.to_string(),
                ..Default::default()
            });
        }

        // Parse: "Progress: 14600/96100 (15.19%), Rate: 12.3 cps, ETA: 1:50:23"
        let mut stats = ChunkyStats {
            active: true,
            status: if clean.to_lowercase().contains("paused") { "paused".to_string() } else { "running".to_string() },
            raw: clean.to_string(),
            ..Default::default()
        };

        // Extract progress numbers
        if let Some(p_idx) = clean.find("Progress:") {
            let sub = &clean[p_idx + 9..];
            if let Some(slash_idx) = sub.find('/') {
                let processed_str = sub[..slash_idx].trim();
                if let Ok(p) = processed_str.parse::<u64>() {
                    stats.processed = p;
                }

                let rest = &sub[slash_idx + 1..];
                if let Some(space_idx) = rest.find(' ') {
                    let total_str = rest[..space_idx].trim();
                    if let Ok(t) = total_str.parse::<u64>() {
                        stats.total = t;
                    }
                }
            }

            if let Some(pct_start) = sub.find('(') {
                if let Some(pct_end) = sub.find("%)") {
                    let pct_str = sub[pct_start + 1..pct_end].trim();
                    if let Ok(pct) = pct_str.parse::<f32>() {
                        stats.percent = pct;
                    }
                }
            }
        }

        // Extract Rate
        if let Some(r_idx) = clean.find("Rate:") {
            let sub = &clean[r_idx + 5..];
            if let Some(cps_idx) = sub.find("cps") {
                let rate_str = sub[..cps_idx].trim();
                if let Ok(r) = rate_str.parse::<f32>() {
                    stats.rate_cps = r;
                }
            }
        }

        // Extract ETA
        if let Some(e_idx) = clean.find("ETA:") {
            let sub = &clean[e_idx + 4..];
            stats.eta = sub.trim().split_whitespace().next().unwrap_or("--:--").to_string();
        }

        Ok(stats)
    }

    async fn send_packet(stream: &mut TcpStream, id: i32, p_type: i32, body: &str) -> Result<(), String> {
        let body_bytes = body.as_bytes();
        let length = (4 + 4 + body_bytes.len() + 2) as i32; // id (4) + type (4) + body + 2 null bytes

        let mut buf = Vec::with_capacity((length + 4) as usize);
        buf.extend_from_slice(&length.to_le_bytes());
        buf.extend_from_slice(&id.to_le_bytes());
        buf.extend_from_slice(&p_type.to_le_bytes());
        buf.extend_from_slice(body_bytes);
        buf.push(0x00);
        buf.push(0x00);

        stream.write_all(&buf).await.map_err(|e| format!("RCON write error: {}", e))
    }

    async fn read_packet(stream: &mut TcpStream) -> Result<(i32, i32, String), String> {
        let mut len_buf = [0u8; 4];
        stream.read_exact(&mut len_buf).await.map_err(|e| format!("RCON read length error: {}", e))?;
        let length = i32::from_le_bytes(len_buf) as usize;

        if length < 8 || length > 65536 {
            return Err(format!("Invalid RCON packet length: {}", length));
        }

        let mut packet_data = vec![0u8; length];
        stream.read_exact(&mut packet_data).await.map_err(|e| format!("RCON read body error: {}", e))?;

        let id = i32::from_le_bytes([packet_data[0], packet_data[1], packet_data[2], packet_data[3]]);
        let p_type = i32::from_le_bytes([packet_data[4], packet_data[5], packet_data[6], packet_data[7]]);

        let body_end = if length >= 10 {
            // Drop trailing 2 null bytes
            let mut end = length - 2;
            while end > 8 && packet_data[end] == 0 {
                end -= 1;
            }
            end + 1
        } else {
            8
        };

        let body = String::from_utf8_lossy(&packet_data[8..body_end]).to_string();
        Ok((id, p_type, body))
    }
}
