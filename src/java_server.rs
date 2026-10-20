use std::collections::VecDeque;
use std::fs;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, Mutex, RwLock};
use tracing::{error, info};

pub struct JavaServerManager {
    pub server_dir: PathBuf,
    pub paper_jar: PathBuf,
    child_process: Mutex<Option<Child>>,
    stdin_tx: Mutex<Option<mpsc::UnboundedSender<String>>>,
    pub console_buffer: RwLock<VecDeque<String>>,
    lifecycle_lock: Mutex<()>,
}

impl JavaServerManager {
    pub fn new(server_dir: PathBuf) -> Arc<Self> {
        if let Err(error) = fs::create_dir_all(&server_dir) {
            error!(
                "Unable to create Paper server directory {}: {error}",
                server_dir.display()
            );
        }
        Arc::new(Self {
            paper_jar: server_dir.join("paper.jar"),
            server_dir,
            child_process: Mutex::new(None),
            stdin_tx: Mutex::new(None),
            console_buffer: RwLock::new(VecDeque::with_capacity(250)),
            lifecycle_lock: Mutex::new(()),
        })
    }

    pub async fn is_running(&self) -> bool {
        let mut process = self.child_process.lock().await;
        if let Some(child) = process.as_mut() {
            match child.try_wait() {
                Ok(None) => return true,
                Ok(Some(_)) => {
                    *process = None;
                    *self.stdin_tx.lock().await = None;
                }
                Err(error) => {
                    error!("Could not check Paper process status: {error}");
                    return true;
                }
            }
        }
        false
    }

    pub async fn start(self: &Arc<Self>) -> Result<(), String> {
        let _lifecycle_guard = self.lifecycle_lock.lock().await;
        if self.is_running().await {
            return Err("Paper is already running.".to_string());
        }
        if !self.paper_jar.is_file() {
            return Err(format!(
                "Paper is not installed. Download the Paper server jar and save it as {}.",
                self.paper_jar.display()
            ));
        }

        let eula_path = self.server_dir.join("eula.txt");
        let eula = fs::read_to_string(&eula_path).map_err(|_| {
            format!(
                "Paper requires an explicit EULA acceptance. Review https://aka.ms/MinecraftEULA, then create {} containing eula=true.",
                eula_path.display()
            )
        })?;
        let accepted = eula.lines().any(|line| {
            line.split_once('=')
                .map(|(key, value)| {
                    key.trim().eq_ignore_ascii_case("eula")
                        && value.trim().eq_ignore_ascii_case("true")
                })
                .unwrap_or(false)
        });
        if !accepted {
            return Err(format!(
                "Paper EULA is not accepted. Review https://aka.ms/MinecraftEULA, then set eula=true in {}.",
                eula_path.display()
            ));
        }

        let mut command = Command::new("java");
        command
            .current_dir(&self.server_dir)
            .arg("-Xms256M")
            .arg("-Xmx512M")
            .arg("-jar")
            .arg(&self.paper_jar)
            .arg("--nogui")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = command.spawn().map_err(|error| {
            format!("Could not start Java. Install a compatible Java runtime and retry: {error}")
        })?;
        let stdin = child.stdin.take();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let (tx, mut rx) = mpsc::unbounded_channel::<String>();
        *self.stdin_tx.lock().await = Some(tx);

        if let Some(mut stdin) = stdin {
            tokio::spawn(async move {
                while let Some(command) = rx.recv().await {
                    let mut line = command;
                    line.push('\n');
                    if let Err(error) = stdin.write_all(line.as_bytes()).await {
                        error!("Failed to write to Paper stdin: {error}");
                        break;
                    }
                    if let Err(error) = stdin.flush().await {
                        error!("Failed to flush Paper stdin: {error}");
                        break;
                    }
                }
            });
        }

        *self.child_process.lock().await = Some(child);
        self.console_buffer.write().await.clear();
        info!(
            "Started Paper Java server from {}",
            self.paper_jar.display()
        );

        if let Some(stdout) = stdout {
            Self::spawn_log_reader(stdout, Arc::clone(self));
        }
        if let Some(stderr) = stderr {
            Self::spawn_log_reader(stderr, Arc::clone(self));
        }

        Ok(())
    }

    fn spawn_log_reader<R>(stream: R, manager: Arc<Self>)
    where
        R: tokio::io::AsyncRead + Unpin + Send + 'static,
    {
        tokio::spawn(async move {
            let mut lines = tokio::io::BufReader::new(stream).lines();
            loop {
                let line = match lines.next_line().await {
                    Ok(Some(line)) => line,
                    Ok(None) => break,
                    Err(error) => {
                        error!("Failed to read Paper console output: {error}");
                        break;
                    }
                };
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                let mut buffer = manager.console_buffer.write().await;
                if buffer.len() >= 200 {
                    buffer.pop_front();
                }
                buffer.push_back(line.to_string());
            }
        });
    }

    pub async fn stop(&self) -> Result<(), String> {
        let _lifecycle_guard = self.lifecycle_lock.lock().await;
        if !self.is_running().await {
            return Err("Paper is not running.".to_string());
        }
        self.send_command("stop").await?;

        for _ in 0..20 {
            tokio::time::sleep(Duration::from_millis(500)).await;
            if !self.is_running().await {
                return Ok(());
            }
        }

        let mut process = self.child_process.lock().await;
        if let Some(mut child) = process.take() {
            child.kill().await.map_err(|error| {
                format!("Paper did not stop cleanly and could not be killed: {error}")
            })?;
        }
        *self.stdin_tx.lock().await = None;
        Ok(())
    }

    pub async fn send_command(&self, command: &str) -> Result<(), String> {
        if command.trim().is_empty() || command.chars().any(char::is_control) {
            return Err("Enter one non-empty command without control characters.".to_string());
        }
        let sender = self.stdin_tx.lock().await;
        let sender = sender
            .as_ref()
            .ok_or_else(|| "Paper is not running.".to_string())?;
        sender
            .send(command.trim().to_string())
            .map_err(|_| "Paper console is no longer available.".to_string())
    }
}
