/**
 * Minecraft Server Control Deck - Universal Management Client
 * Clean, data-driven, function-first architecture.
 */

// Global Application State
let activeEdition = localStorage.getItem('mc_edition') || 'bedrock';
if (activeEdition !== 'bedrock' && activeEdition !== 'java') activeEdition = 'bedrock';
let activeTab = 'home';
let capabilities = null;
let isAuthenticated = false;
let autoScroll = true;
let consoleLogs = [];
let commandHistory = JSON.parse(localStorage.getItem('mc_history') || '[]');
let historyIdx = -1;
let propertiesData = [];
let activePropCategory = 'all';
let pollInterval = null;

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
    initPinInputs();
    initAmbientCanvas();
    bootstrapApp();
});

/* =========================================================================
   1. BOOTSTRAP & AUTHENTICATION
   ========================================================================= */
async function bootstrapApp() {
    try {
        // 1. Fetch Engine Capabilities
        const capRes = await fetch('/api/capabilities');
        if (capRes.ok) {
            capabilities = await capRes.json();
            renderCapabilities(capabilities);
        }

        // 2. Check Auth Status & Cache
        const authRes = await fetch('/api/auth/status');
        if (authRes.ok) {
            const auth = await authRes.json();
            if (auth.pin_configured) {
                const cachedPin = localStorage.getItem('mc_auth_pin');
                if (cachedPin) {
                    try {
                        const verifyRes = await fetch('/api/auth/verify', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ pin: cachedPin })
                        });
                        const verifyData = await verifyRes.json();
                        if (verifyRes.ok && (verifyData.authenticated || verifyData.success)) {
                            isAuthenticated = true;
                        } else {
                            localStorage.removeItem('mc_auth_pin');
                            showPinModal();
                        }
                    } catch (e) {
                        showPinModal();
                    }
                } else {
                    showPinModal();
                }
            } else {
                isAuthenticated = true;
            }
        }

        // Apply saved edition
        setEdition(activeEdition, false);

        // Start Periodic Polling (Telemetry, Status, Logs)
        startPolling();

        // Initial Data Load
        refreshAllData();
    } catch (err) {
        console.error('Bootstrap error:', err);
        updateGlobalStatus('offline', 'Connection Error');
    }
}

function showPinModal() {
    const modal = document.getElementById('pinModal');
    if (modal) modal.style.display = 'flex';
    document.getElementById('pinD1')?.focus();
}

function initPinInputs() {
    const inputs = [
        document.getElementById('pinD1'),
        document.getElementById('pinD2'),
        document.getElementById('pinD3'),
        document.getElementById('pinD4')
    ];

    inputs.forEach((input, index) => {
        if (!input) return;
        input.addEventListener('input', (e) => {
            if (e.target.value.length === 1 && index < 3) {
                inputs[index + 1].focus();
            }
            if (inputs.every(inp => inp.value.length === 1)) {
                submitPin();
            }
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && !input.value && index > 0) {
                inputs[index - 1].focus();
            } else if (e.key === 'Enter') {
                submitPin();
            }
        });
    });
}

async function submitPin() {
    const p1 = document.getElementById('pinD1')?.value || '';
    const p2 = document.getElementById('pinD2')?.value || '';
    const p3 = document.getElementById('pinD3')?.value || '';
    const p4 = document.getElementById('pinD4')?.value || '';
    const pin = `${p1}${p2}${p3}${p4}`.trim();
    const errBox = document.getElementById('pinError');

    if (pin.length !== 4) {
        if (errBox) {
            errBox.textContent = 'Please enter a 4-digit PIN.';
            errBox.style.display = 'block';
        }
        return;
    }

    try {
        const res = await fetch('/api/auth/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin })
        });
        const data = await res.json();
        if (res.ok && (data.authenticated || data.success)) {
            isAuthenticated = true;
            if (document.getElementById('chkRememberPin')?.checked) {
                localStorage.setItem('mc_auth_pin', pin);
            }
            const modal = document.getElementById('pinModal');
            if (modal) modal.style.display = 'none';
            if (errBox) errBox.style.display = 'none';
            refreshAllData();
        } else {
            if (errBox) {
                errBox.textContent = data.message || 'Incorrect PIN. Access denied.';
                errBox.style.display = 'block';
            }
            ['pinD1', 'pinD2', 'pinD3', 'pinD4'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });
            document.getElementById('pinD1')?.focus();
        }
    } catch (err) {
        if (errBox) {
            errBox.textContent = 'Failed to verify PIN. Check server status.';
            errBox.style.display = 'block';
        }
    }
}

function lockConsole() {
    localStorage.removeItem('mc_auth_pin');
    isAuthenticated = false;
    ['pinD1', 'pinD2', 'pinD3', 'pinD4'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    showPinModal();
}

/* =========================================================================
   2. EDITION & TAB CONTROLS
   ========================================================================= */
function setEdition(edition, save = true) {
    if (edition !== 'bedrock' && edition !== 'java') {
        edition = 'bedrock';
    }
    activeEdition = edition;
    if (save) localStorage.setItem('mc_edition', edition);

    const btnBedrock = document.getElementById('btnEditionBedrock');
    const btnJava = document.getElementById('btnEditionJava');
    if (btnBedrock) btnBedrock.classList.toggle('active', edition === 'bedrock');
    if (btnJava) btnJava.classList.toggle('active', edition === 'java');

    const cardJava = document.getElementById('cardJava');
    const cardBedrock = document.getElementById('cardBedrock');
    const tag = document.getElementById('consoleTargetTag');

    const cardUpdateBedrock = document.getElementById('cardUpdateBedrock');
    const cardUpdateJava = document.getElementById('cardUpdateJava');

    const addonsTitle = document.getElementById('addonsHeaderTitle');
    const addonsSubtitle = document.getElementById('addonsHeaderSubtitle');
    const btnUploadAddon = document.getElementById('btnUploadAddon');

    if (edition === 'bedrock') {
        if (cardJava) cardJava.style.display = 'none';
        if (cardBedrock) cardBedrock.style.display = 'block';
        if (cardUpdateBedrock) cardUpdateBedrock.style.display = 'block';
        if (cardUpdateJava) cardUpdateJava.style.display = 'none';
        if (tag) tag.textContent = 'Target: Bedrock Dedicated Server';
        if (addonsTitle) addonsTitle.textContent = 'Bedrock Behavior & Resource Packs';
        if (addonsSubtitle) addonsSubtitle.textContent = 'Manage behavior and resource packs installed on this server instance';
        if (btnUploadAddon) btnUploadAddon.textContent = '+ Upload Pack (.mcpack)';
    } else {
        if (cardJava) cardJava.style.display = 'block';
        if (cardBedrock) cardBedrock.style.display = 'none';
        if (cardUpdateBedrock) cardUpdateBedrock.style.display = 'none';
        if (cardUpdateJava) cardUpdateJava.style.display = 'block';
        if (tag) tag.textContent = 'Target: Java Edition (RCON / Nexus Tunnel)';
        if (addonsTitle) addonsTitle.textContent = 'Java Server Mods (Forge / Fabric / NeoForge)';
        if (addonsSubtitle) addonsSubtitle.textContent = 'Remotely managed and monitored via Nexus CLI tunnel';
        if (btnUploadAddon) btnUploadAddon.textContent = '+ Install Mod from URL';
    }

    updateHostModeVisibility();
    updateJavaControls();

    if (activeTab === 'properties') {
        loadProperties();
    } else if (activeTab === 'worlds') {
        loadWorlds();
    } else if (activeTab === 'addons') {
        loadAddons();
    } else if (activeTab === 'update') {
        loadUpdateTab();
    }

    fetchTelemetry();
    fetchServerStatuses();
}

function updateHostModeVisibility() {
    const hostModeBox = document.getElementById('hudModeContainer');
    if (!hostModeBox) return;

    // Remote Host Mode is strictly scoped to Java on remote Linux PCs running via Nexus services
    const isJava = activeEdition === 'java';
    const isLinux = capabilities && capabilities.java_node_os && capabilities.java_node_os.toLowerCase().includes('linux');
    const isNodeReady = capabilities && capabilities.java_node_available;

    if (isJava && isLinux && isNodeReady) {
        hostModeBox.style.display = 'flex';
    } else {
        hostModeBox.style.display = 'none';
    }
}

function updateJavaControls() {
    const notice = document.getElementById('javaNoNodeNotice');
    const btnStart = document.getElementById('btnJavaStart');
    const btnStop = document.getElementById('btnJavaStop');

    const nodeAvailable = capabilities && capabilities.java_node_available;

    if (!nodeAvailable) {
        if (notice) notice.style.display = 'flex';
        if (btnStart) {
            btnStart.disabled = true;
            btnStart.style.opacity = '0.5';
            btnStart.title = 'No compatible remote PC is online in Nexus network';
        }
        if (btnStop) {
            btnStop.disabled = true;
            btnStop.style.opacity = '0.5';
            btnStop.title = 'No compatible remote PC is online in Nexus network';
        }
    } else {
        if (notice) notice.style.display = 'none';
        if (btnStart) {
            btnStart.disabled = false;
            btnStart.style.opacity = '1';
            btnStart.title = '';
        }
        if (btnStop) {
            btnStop.disabled = false;
            btnStop.style.opacity = '1';
            btnStop.title = '';
        }
    }
}

function showTab(tabId) {
    activeTab = tabId;
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });

    const target = document.getElementById(`tab${tabId.charAt(0).toUpperCase() + tabId.slice(1)}`);
    if (target) target.classList.add('active');

    // Trigger specific tab loaders
    if (tabId === 'console') {
        fetchLogs();
        scrollConsoleBottom();
    } else if (tabId === 'properties') {
        loadProperties();
    } else if (tabId === 'worlds') {
        loadWorlds();
    } else if (tabId === 'players') {
        loadPlayers();
    } else if (tabId === 'map') {
        renderTacticalMap();
    } else if (tabId === 'addons') {
        loadAddons();
    } else if (tabId === 'update') {
        loadUpdateTab();
    }
}

/* =========================================================================
   3. POLLING & TELEMETRY
   ========================================================================= */
function startPolling() {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(() => {
        fetchTelemetry();
        fetchServerStatuses();
        if (activeTab === 'console') fetchLogs();
    }, 2500);
}

async function refreshAllData() {
    await Promise.allSettled([
        fetchTelemetry(),
        fetchServerStatuses(),
        fetchLogs()
    ]);
}

async function fetchTelemetry() {
    try {
        const res = await fetch(`/api/telemetry?edition=${activeEdition}`);
        if (!res.ok) return;
        const data = await res.json();

        // CPU
        const cpuUsage = data.cpu_usage_pct ?? data.cpu_pct ?? data.hardware?.cpu_pct ?? 0;
        const cpuEl = document.getElementById('hudCpuUsage');
        const cpuBar = document.getElementById('hudCpuBar');
        const cpuModel = document.getElementById('hudCpuModel');
        if (cpuEl) cpuEl.textContent = `${Number(cpuUsage).toFixed(1)}%`;
        if (cpuBar) cpuBar.style.width = `${Math.min(Math.max(cpuUsage, 0), 100)}%`;
        if (cpuModel) cpuModel.textContent = data.cpu_model || data.hardware?.cpu_model || `${data.cpu_cores || data.hardware?.cpu_cores || 0} Cores`;

        // RAM
        const usedMb = data.memory_used_mb ?? data.hardware?.memory_used_mb ?? 0;
        const totalMb = data.memory_total_mb ?? data.hardware?.memory_total_mb ?? 1;
        const ramPct = data.memory_pct ?? data.hardware?.memory_pct ?? Math.round((usedMb / Math.max(totalMb, 1)) * 100);
        const ramEl = document.getElementById('hudRamUsage');
        const ramPctEl = document.getElementById('hudRamPercent');
        const ramBar = document.getElementById('hudRamBar');
        if (ramEl) ramEl.textContent = `${(usedMb / 1024).toFixed(1)} / ${(totalMb / 1024).toFixed(1)} GB`;
        if (ramPctEl) ramPctEl.textContent = `${ramPct}% allocated`;
        if (ramBar) ramBar.style.width = `${Math.min(Math.max(ramPct, 0), 100)}%`;

        // Thermals
        const tempEl = document.getElementById('hudTemp');
        const tempStatus = document.getElementById('hudTempStatus');
        const tempVal = data.cpu_temp_c ?? data.temp_c ?? data.hardware?.temp_c;
        if (tempEl) {
            if (tempVal !== null && tempVal !== undefined) {
                tempEl.textContent = `${Number(tempVal).toFixed(0)}°C`;
                if (tempStatus) {
                    tempStatus.textContent = tempVal > 80 ? 'High Temp Warning' : 'Normal Thermal Range';
                }
            } else {
                tempEl.textContent = 'N/A';
                if (tempStatus) tempStatus.textContent = 'Sensor unavailable';
            }
        }

        // Uptime & Host Status
        const uptimeEl = document.getElementById('hudUptime');
        if (uptimeEl) {
            const s = data.uptime_seconds ?? data.uptime_secs ?? data.hardware?.uptime_secs ?? 0;
            const d = Math.floor(s / 86400);
            const h = Math.floor((s % 86400) / 3600);
            const m = Math.floor((s % 3600) / 60);
            uptimeEl.textContent = d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;
        }
        if (uptimeEl) {
            const s = data.uptime_seconds || 0;
            const d = Math.floor(s / 86400);
            const h = Math.floor((s % 86400) / 3600);
            const m = Math.floor((s % 3600) / 60);
            uptimeEl.textContent = d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;
        }

        // Host Mode
        const modeNameEl = document.getElementById('hudModeName');
        const isGameMode = (usedMb > 0 && usedMb < 1300) || (data.mode && data.mode.includes('Gaming'));
        if (modeNameEl) {
            modeNameEl.textContent = isGameMode ? 'Gaming (Headless)' : 'Desktop GUI';
        }
        document.getElementById('btnModeGame')?.classList.toggle('active', isGameMode);
        document.getElementById('btnModeDesktop')?.classList.toggle('active', !isGameMode);

        updateHostModeVisibility();
        updateJavaControls();

        // Active node tag in navbar
        const nodeBadge = document.getElementById('activeNodeBadge');
        if (nodeBadge && data.node_id) {
            nodeBadge.textContent = `Node: ${data.node_id}`;
        }
    } catch (err) {
        console.debug('Telemetry fetch skipped:', err);
    }
}

async function setHostMode(mode) {
    try {
        const res = await fetch('/api/host/mode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode })
        });
        const data = await res.json();
        if (data.success) {
            fetchTelemetry();
        } else {
            alert(`Could not switch host mode: ${data.error || 'Request failed'}`);
        }
    } catch (err) {
        alert('Network error communicating with host mode switcher.');
    }
}

async function fetchServerStatuses() {
    let anyOnline = false;

    // 1. Bedrock Status
    try {
        const res = await fetch('/api/status');
        if (res.ok) {
            const data = await res.json();
            const isRunning = data.server_running === true;
            if (isRunning) anyOnline = true;

            const badge = document.getElementById('bedrockStatusBadge');
            if (badge) {
                badge.textContent = isRunning ? 'Online' : 'Offline';
                badge.className = `badge ${isRunning ? 'online' : 'offline'}`;
            }

            const ep = document.getElementById('bedrockEndpoint');
            if (ep) ep.textContent = data.endpoint || '127.0.0.1:19132';

            const world = document.getElementById('bedrockWorld');
            if (world) world.textContent = data.active_world || '--';

            const players = document.getElementById('bedrockPlayersVal');
            if (players) players.textContent = `${data.online_players || 0} players`;

            const transport = document.getElementById('bedrockTransport');
            if (transport) transport.textContent = data.transport || 'NetherNet WebRTC';

            const ver = document.getElementById('bedrockVersionLabel');
            if (ver && data.version) ver.textContent = `Bedrock ${data.version}`;
        }
    } catch (err) {
        console.debug('Bedrock status error:', err);
    }

    // 2. Java Status
    try {
        const res = await fetch('/api/java/status');
        if (res.ok) {
            const data = await res.json();
            const isRunning = data.running === true;
            if (isRunning) anyOnline = true;

            const badge = document.getElementById('javaStatusBadge');
            if (badge) {
                badge.textContent = isRunning ? 'Online' : 'Offline';
                badge.className = `badge ${isRunning ? 'online' : 'offline'}`;
            }

            const ep = document.getElementById('javaEndpoint');
            if (ep) ep.textContent = data.address || '--:25565';

            const typeLabel = document.getElementById('javaTypeLabel');
            if (typeLabel) typeLabel.textContent = data.server_type || 'Java Dedicated Server';

            const players = document.getElementById('javaPlayersVal');
            if (players) {
                const count = Array.isArray(data.players) ? data.players.length : (data.players_count || 0);
                players.textContent = `${count} players`;
            }

            // Chunky Stats
            const chunkyBox = document.getElementById('chunkyBox');
            if (chunkyBox) {
                if (data.chunky && data.chunky.percent_done !== undefined) {
                    chunkyBox.style.display = 'block';
                    document.getElementById('chunkyPct').textContent = `${data.chunky.percent_done.toFixed(1)}%`;
                    document.getElementById('chunkyBar').style.width = `${data.chunky.percent_done}%`;
                    document.getElementById('chunkyRate').textContent = `${data.chunky.rate_cps || 0} cps`;
                    document.getElementById('chunkyCount').textContent = `${data.chunky.chunks_processed || 0} / ${data.chunky.total_chunks || 0}`;
                    document.getElementById('chunkyEta').textContent = `ETA: ${data.chunky.eta_seconds || '--'}s`;
                } else {
                    chunkyBox.style.display = 'none';
                }
            }
        }
    } catch (err) {
        console.debug('Java status error:', err);
    }

    updateGlobalStatus(anyOnline ? 'online' : 'offline', anyOnline ? 'Fleet Online' : 'All Servers Stopped');
}

function updateGlobalStatus(state, text) {
    const dot = document.querySelector('.status-dot');
    const textEl = document.getElementById('globalStatusText');
    if (dot) {
        dot.className = `status-dot ${state}`;
    }
    if (textEl) textEl.textContent = text;
}

/* =========================================================================
   4. CONSOLE & COMMANDS
   ========================================================================= */
async function fetchLogs() {
    try {
        let logs = [];
        const res = await fetch('/api/logs');
        if (res.ok) {
            const data = await res.json();
            logs = data.logs || [];
        } else {
            const altRes = await fetch('/api/server_output');
            if (altRes.ok) {
                const text = await altRes.text();
                logs = text.split('\n').filter(Boolean);
            }
        }
        if (logs.length > 0) {
            consoleLogs = logs;
            renderConsoleLogs();
        }
    } catch (err) {
        console.debug('Logs fetch skipped:', err);
    }
}

function renderConsoleLogs() {
    const screen = document.getElementById('terminalScreen');
    if (!screen) return;
    const filter = document.getElementById('logLevelFilter')?.value || 'all';

    const lines = consoleLogs.filter(line => {
        if (filter === 'all') return true;
        const l = line.toLowerCase();
        if (filter === 'error') return l.includes('error') || l.includes('exception') || l.includes('fatal');
        if (filter === 'warn') return l.includes('warn');
        if (filter === 'info') return !l.includes('error') && !l.includes('warn');
        return true;
    });

    screen.innerHTML = lines.map(line => {
        let cls = 'info';
        const l = line.toLowerCase();
        if (l.includes('error') || l.includes('fail')) cls = 'error';
        else if (l.includes('warn')) cls = 'warn';
        return `<div class="console-line ${cls}">${escapeHtml(line)}</div>`;
    }).join('');

    if (autoScroll) scrollConsoleBottom();
}

function scrollConsoleBottom() {
    const screen = document.getElementById('terminalScreen');
    if (screen) screen.scrollTop = screen.scrollHeight;
}

function clearConsole() {
    consoleLogs = [];
    renderConsoleLogs();
}

function filterLogs() {
    renderConsoleLogs();
}

function insertCommand(cmd) {
    const input = document.getElementById('cmdInput');
    if (input) {
        input.value = cmd;
        input.focus();
    }
}

async function sendConsoleCommand(e) {
    e.preventDefault();
    const input = document.getElementById('cmdInput');
    if (!input) return;
    const cmd = input.value.trim();
    if (!cmd) return;

    if (activeEdition === 'java' && capabilities && !capabilities.java_node_available) {
        alert('Cannot send command: No compatible remote PC is currently online in the Nexus Fleet.');
        return;
    }

    // Save history
    commandHistory.push(cmd);
    if (commandHistory.length > 50) commandHistory.shift();
    localStorage.setItem('mc_history', JSON.stringify(commandHistory));
    historyIdx = -1;
    input.value = '';

    const endpoint = activeEdition === 'java' ? '/api/java/command' : '/api/command';

    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: cmd })
        });
        const data = await res.json();
        const result = data.result || 'Command dispatched.';
        consoleLogs.push(`> ${cmd}`);
        consoleLogs.push(result);
        renderConsoleLogs();
    } catch (err) {
        consoleLogs.push(`[Error] Command failed to dispatch: ${err}`);
        renderConsoleLogs();
    }
}

// Arrow Key Navigation in Command History
document.getElementById('cmdInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') {
        if (commandHistory.length > 0) {
            historyIdx = historyIdx === -1 ? commandHistory.length - 1 : Math.max(0, historyIdx - 1);
            e.target.value = commandHistory[historyIdx];
        }
    } else if (e.key === 'ArrowDown') {
        if (historyIdx !== -1) {
            historyIdx = Math.min(commandHistory.length - 1, historyIdx + 1);
            e.target.value = commandHistory[historyIdx] || '';
        }
    }
});

/* =========================================================================
   5. SERVER LIFECYCLE (START / STOP / RESTART)
   ========================================================================= */
async function startServer(edition) {
    const ep = edition === 'java' ? '/api/java/start' : '/api/start';
    try {
        const res = await fetch(ep, { method: 'POST' });
        const data = await res.json();
        if (!res.ok || data.success === false) {
            alert(`⚠️ Error starting ${edition.toUpperCase()} server:\n\n${data.error || data.message || 'Unknown startup error'}`);
        } else {
            alert(data.message || `${edition.toUpperCase()} server start triggered.`);
        }
        fetchServerStatuses();
    } catch (err) {
        alert(`Failed to start ${edition} server: ${err.message}`);
    }
}

async function stopServer(edition) {
    if (!confirm(`Are you sure you want to stop the ${edition.toUpperCase()} server?`)) return;
    const ep = edition === 'java' ? '/api/java/stop' : '/api/stop';
    try {
        const res = await fetch(ep, { method: 'POST' });
        const data = await res.json();
        alert(data.message || `${edition.toUpperCase()} server stop initiated.`);
        fetchServerStatuses();
    } catch (err) {
        alert(`Failed to stop ${edition} server.`);
    }
}

function restartBedrockModal() {
    const modal = document.getElementById('restartModal');
    if (modal) modal.style.display = 'flex';
}

function closeRestartModal() {
    const modal = document.getElementById('restartModal');
    if (modal) modal.style.display = 'none';
}

async function confirmRestart() {
    const seconds = parseInt(document.getElementById('restartSeconds')?.value || '10', 10);
    const reason = document.getElementById('restartReason')?.value || 'Maintenance restart';
    closeRestartModal();

    try {
        const res = await fetch('/api/restart', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ countdown_seconds: seconds, reason })
        });
        const data = await res.json();
        alert(data.message || 'Restart scheduled with countdown.');
    } catch (err) {
        alert('Failed to schedule restart.');
    }
}

async function controlChunky(action) {
    try {
        const res = await fetch(`/api/chunky/${action}`, { method: 'POST' });
        const data = await res.json();
        alert(data.result || `Chunky ${action} executed.`);
        fetchServerStatuses();
    } catch (err) {
        alert(`Failed to execute chunky ${action}`);
    }
}

/* =========================================================================
   6. SERVER PROPERTIES (UNIVERSAL)
   ========================================================================= */
async function loadProperties() {
    const container = document.getElementById('propertiesList');
    if (!container) return;
    const ep = activeEdition === 'java' ? '/api/java/properties' : '/api/properties';
    try {
        const res = await fetch(ep);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (Array.isArray(json)) {
            propertiesData = json;
        } else if (typeof json === 'object') {
            propertiesData = Object.entries(json).map(([k, v]) => ({
                key: k,
                value: String(v),
                known: true,
                category: 'gameplay'
            }));
        }
        renderPropertiesList();
    } catch (err) {
        container.innerHTML = `<div class="console-line error">Could not load ${activeEdition} properties: ${err}</div>`;
    }
}

function filterPropsCategory(cat) {
    activePropCategory = cat;
    document.querySelectorAll('.btn-filter').forEach(btn => {
        btn.classList.toggle('active', btn.textContent.toLowerCase() === cat.toLowerCase());
    });
    renderPropertiesList();
}

function renderPropertiesList() {
    const container = document.getElementById('propertiesList');
    if (!container) return;
    const search = document.getElementById('propsSearch')?.value.toLowerCase().trim() || '';

    const filtered = propertiesData.filter(item => {
        const matchesSearch = !search || item.key.toLowerCase().includes(search) || (item.desc && item.desc.toLowerCase().includes(search));
        if (!matchesSearch) return false;
        if (activePropCategory === 'all') return true;
        if (activePropCategory === 'custom') return !item.known;
        return item.category === activePropCategory;
    });

    if (filtered.length === 0) {
        container.innerHTML = '<div class="loading-spinner">No properties match your filter.</div>';
        return;
    }

    container.innerHTML = filtered.map(item => `
        <div class="prop-card">
            <div class="prop-key">${escapeHtml(item.key)}</div>
            ${item.desc ? `<div class="prop-desc">${escapeHtml(item.desc)}</div>` : ''}
            <div class="prop-input-wrap">
                <input type="text" class="prop-input" data-key="${escapeHtml(item.key)}" value="${escapeHtml(item.value)}">
            </div>
        </div>
    `).join('');
}

function addCustomProperty() {
    const key = document.getElementById('newPropKey')?.value.trim();
    const val = document.getElementById('newPropVal')?.value.trim();
    if (!key) {
        alert('Please enter a property key.');
        return;
    }
    propertiesData.push({ key, value: val, known: false, category: 'custom' });
    document.getElementById('newPropKey').value = '';
    document.getElementById('newPropVal').value = '';
    renderPropertiesList();
}

async function saveProperties() {
    const inputs = document.querySelectorAll('.prop-input');
    const updateObj = {};
    inputs.forEach(input => {
        const k = input.dataset.key;
        if (k) updateObj[k] = input.value.trim();
    });

    const ep = activeEdition === 'java' ? '/api/java/properties' : '/api/properties';
    try {
        const res = await fetch(ep, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updateObj)
        });
        const data = await res.json();
        alert(data.message || `${activeEdition.toUpperCase()} properties saved successfully. Restart the server to apply changes.`);
        loadProperties();
    } catch (err) {
        alert(`Failed to save ${activeEdition} properties.`);
    }
}

/* =========================================================================
   7. WORLDS & PLAYERS
   ========================================================================= */
async function loadWorlds() {
    const container = document.getElementById('worldsList');
    if (!container) return;
    try {
        const res = await fetch('/api/worlds');
        if (!res.ok) throw new Error('Failed to load worlds');
        const data = await res.json();
        const worlds = data.worlds || [];

        container.innerHTML = worlds.map(w => `
            <div class="world-card ${w.is_active ? 'active' : ''}">
                <h4>${escapeHtml(w.name)} ${w.is_active ? '<span class="badge online">Active</span>' : ''}</h4>
                <p class="prop-desc">Backups: ${w.backup_count || 0}</p>
                <div style="margin-top: 10px; display: flex; gap: 6px;">
                    ${!w.is_active ? `<button type="button" class="btn btn-xs btn-primary" onclick="switchWorld('${escapeHtml(w.name)}')">Switch to World</button>` : ''}
                    <button type="button" class="btn btn-xs" onclick="backupSpecificWorld('${escapeHtml(w.name)}')">Backup</button>
                </div>
            </div>
        `).join('');
    } catch (err) {
        container.innerHTML = `<div class="console-line error">Could not load worlds: ${err}</div>`;
    }
}

async function createWorldBackup() {
    try {
        const res = await fetch('/api/backup', { method: 'POST' });
        const data = await res.json();
        alert(data.message || 'Backup creation initiated.');
        loadWorlds();
    } catch (err) {
        alert('Failed to create backup.');
    }
}

async function loadPlayers() {
    const tbody = document.getElementById('playersTableBody');
    if (!tbody) return;
    try {
        const res = await fetch('/api/players');
        if (!res.ok) throw new Error('Failed to load players');
        const data = await res.json();
        const players = data.players || [];

        if (players.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" class="text-center">No players currently connected</td></tr>';
            return;
        }

        tbody.innerHTML = players.map(p => `
            <tr>
                <td><strong>${escapeHtml(p.name)}</strong></td>
                <td>${escapeHtml(p.session_duration || 'Active')}</td>
                <td>
                    <button type="button" class="btn btn-xs btn-danger" onclick="kickPlayer('${escapeHtml(p.name)}')">Kick</button>
                    <button type="button" class="btn btn-xs btn-secondary" onclick="opPlayer('${escapeHtml(p.name)}')">OP</button>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="3" class="text-center text-danger">Error loading players: ${err}</td></tr>`;
    }
}

async function kickPlayer(name) {
    if (!confirm(`Kick ${name} from server?`)) return;
    const cmd = `kick ${name} Kicked by server administrator`;
    const ep = activeEdition === 'java' ? '/api/java/command' : '/api/command';
    await fetch(ep, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: cmd }) });
    loadPlayers();
}

async function opPlayer(name) {
    const cmd = `op ${name}`;
    const ep = activeEdition === 'java' ? '/api/java/command' : '/api/command';
    await fetch(ep, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: cmd }) });
    alert(`Granted operator status to ${name}`);
}

/* =========================================================================
   8. TACTICAL MAP & RADAR
   ========================================================================= */
function renderTacticalMap() {
    const canvas = document.getElementById('tacticalMapCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#0a0f1d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw grid
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.1)';
    ctx.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
    }

    // World Center Origin
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    ctx.fillStyle = '#3b82f6';
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#9ca3af';
    ctx.font = '11px Fira Code';
    ctx.fillText('Spawn (0, 0)', cx + 8, cy - 8);
}

function resetMapZoom() {
    renderTacticalMap();
}

/* =========================================================================
   9. SETTINGS & PIN CHANGE
   ========================================================================= */
async function changePin() {
    const current = document.getElementById('pinOld')?.value || '';
    const newPin = document.getElementById('pinNew')?.value || '';
    const confirmPin = document.getElementById('pinConfirm')?.value || '';
    const msg = document.getElementById('pinChangeMsg');

    if (!msg) return;

    if (newPin !== confirmPin) {
        msg.innerHTML = '<span style="color:#ef4444;">New PINs do not match.</span>';
        return;
    }
    if (newPin.length < 4 || newPin.length > 8 || !/^\d+$/.test(newPin)) {
        msg.innerHTML = '<span style="color:#ef4444;">PIN must be 4 to 8 digits.</span>';
        return;
    }

    try {
        const res = await fetch('/api/auth/change_pin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ current_pin: current, new_pin: newPin })
        });
        const data = await res.json();
        if (data.success) {
            msg.innerHTML = '<span style="color:#10b981;">PIN changed successfully!</span>';
            localStorage.setItem('mc_auth_pin', newPin);
            document.getElementById('pinOld').value = '';
            document.getElementById('pinNew').value = '';
            document.getElementById('pinConfirm').value = '';
        } else {
            msg.innerHTML = `<span style="color:#ef4444;">${data.error || 'Failed to change PIN.'}</span>`;
        }
    } catch (err) {
        msg.innerHTML = '<span style="color:#ef4444;">Network error changing PIN.</span>';
    }
}

function renderCapabilities(cap) {
    const box = document.getElementById('capabilitiesInfo');
    if (box) {
        box.textContent = JSON.stringify(cap, null, 2);
    }
}

/* =========================================================================
   10. AMBIENT BACKGROUND CANVAS
   ========================================================================= */
function initAmbientCanvas() {
    const canvas = document.getElementById('ambientCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    window.addEventListener('resize', resize);
    resize();

    let angle = 0;
    function render() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const grad = ctx.createRadialGradient(
            canvas.width / 2 + Math.cos(angle) * 100,
            canvas.height / 2 + Math.sin(angle) * 100,
            50,
            canvas.width / 2,
            canvas.height / 2,
            canvas.width * 0.8
        );
        grad.addColorStop(0, 'rgba(59, 130, 246, 0.05)');
        grad.addColorStop(1, 'rgba(11, 15, 25, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        angle += 0.002;
        requestAnimationFrame(render);
    }
    render();
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/* =========================================================================
   11. MODS & ADDONS (EDITION-AWARE)
   ========================================================================= */
let cachedBedrockAddons = null;

async function loadAddons() {
    const container = document.getElementById('addonsList');
    if (!container) return;
    container.innerHTML = '<div class="loading-spinner">Loading modifications...</div>';

    if (activeEdition === 'bedrock') {
        try {
            const res = await fetch('/api/addons');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            cachedBedrockAddons = data;

            const bPacks = data.behavior_packs || [];
            const rPacks = data.resource_packs || [];
            const appliedB = new Set((data.applied_behavior || []).map(p => p.pack_id));
            const appliedR = new Set((data.applied_resource || []).map(p => p.pack_id));

            if (bPacks.length === 0 && rPacks.length === 0) {
                container.innerHTML = '<div class="loading-spinner">No Bedrock addons installed. Click "+ Add New" to upload a pack (.mcpack or .zip).</div>';
                return;
            }

            let html = '<div style="width:100%;"><h4 style="margin-bottom:12px; color:var(--accent);">Behavior Packs</h4><div class="addons-grid" style="margin-bottom:24px;">';
            if (bPacks.length === 0) {
                html += '<div class="loading-spinner">No behavior packs found.</div>';
            } else {
                html += bPacks.map(p => {
                    const isApplied = appliedB.has(p.uuid);
                    return `
                        <div class="world-card ${isApplied ? 'active' : ''}">
                            <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                                <h4>${escapeHtml(p.name)}</h4>
                                <span class="badge ${isApplied ? 'online' : 'offline'}">${isApplied ? 'Active in World' : 'Inactive'}</span>
                            </div>
                            <p class="prop-desc">Folder: <code>${escapeHtml(p.folder)}</code></p>
                            <p class="prop-desc" style="font-size:11px;">UUID: ${escapeHtml(p.uuid)}</p>
                            <div style="margin-top:12px; display:flex; justify-content:space-between; align-items:center;">
                                <button type="button" class="btn btn-xs ${isApplied ? 'btn-secondary' : 'btn-primary'}" onclick="toggleBedrockPack('${escapeHtml(p.uuid)}', false, ${!isApplied})">
                                    ${isApplied ? 'Deactivate' : 'Activate'}
                                </button>
                                <button type="button" class="btn btn-xs btn-danger" onclick="deleteBedrockPack('${escapeHtml(p.folder)}')">Delete</button>
                            </div>
                        </div>
                    `;
                }).join('');
            }
            html += '</div>';

            html += '<h4 style="margin-bottom:12px; color:#3b82f6;">Resource Packs</h4><div class="addons-grid">';
            if (rPacks.length === 0) {
                html += '<div class="loading-spinner">No resource packs found.</div>';
            } else {
                html += rPacks.map(p => {
                    const isApplied = appliedR.has(p.uuid);
                    return `
                        <div class="world-card ${isApplied ? 'active' : ''}">
                            <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                                <h4>${escapeHtml(p.name)}</h4>
                                <span class="badge ${isApplied ? 'online' : 'offline'}">${isApplied ? 'Active in World' : 'Inactive'}</span>
                            </div>
                            <p class="prop-desc">Folder: <code>${escapeHtml(p.folder)}</code></p>
                            <p class="prop-desc" style="font-size:11px;">UUID: ${escapeHtml(p.uuid)}</p>
                            <div style="margin-top:12px; display:flex; justify-content:space-between; align-items:center;">
                                <button type="button" class="btn btn-xs ${isApplied ? 'btn-secondary' : 'btn-primary'}" onclick="toggleBedrockPack('${escapeHtml(p.uuid)}', true, ${!isApplied})">
                                    ${isApplied ? 'Deactivate' : 'Activate'}
                                </button>
                                <button type="button" class="btn btn-xs btn-danger" onclick="deleteBedrockPack('${escapeHtml(p.folder)}')">Delete</button>
                            </div>
                        </div>
                    `;
                }).join('');
            }
            html += '</div></div>';
            container.innerHTML = html;
        } catch (err) {
            container.innerHTML = `<div class="console-line error">Failed to load Bedrock addons: ${err.message}</div>`;
        }
    } else {
        // Java Mode
        try {
            const res = await fetch('/api/java/mods');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const mods = data.mods || [];

            if (mods.length === 0) {
                container.innerHTML = '<div class="loading-spinner">No mods detected in remote Java server mods/ directory. Click "+ Add New" to install via URL.</div>';
                return;
            }

            container.innerHTML = mods.map(m => `
                <div class="world-card ${m.enabled ? 'active' : ''}">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                        <h4>${escapeHtml(m.name)}</h4>
                        <span class="badge ${m.enabled ? 'online' : 'offline'}">${m.enabled ? 'Enabled' : 'Disabled'}</span>
                    </div>
                    <p class="prop-desc">File: <code>${escapeHtml(m.filename)}</code></p>
                    <p class="prop-desc" style="font-size:11px;">Size: ${escapeHtml(m.size_formatted || '0 KB')}</p>
                    <div style="margin-top:12px; display:flex; justify-content:space-between; align-items:center;">
                        <button type="button" class="btn btn-xs ${m.enabled ? 'btn-secondary' : 'btn-primary'}" onclick="toggleJavaMod('${escapeHtml(m.filename)}')">
                            ${m.enabled ? 'Disable Mod' : 'Enable Mod'}
                        </button>
                        <button type="button" class="btn btn-xs btn-danger" onclick="deleteJavaMod('${escapeHtml(m.filename)}')">Delete</button>
                    </div>
                </div>
            `).join('');
        } catch (err) {
            container.innerHTML = `<div class="console-line error">Failed to load remote Java mods: ${err.message}</div>`;
        }
    }
}

function openAddonModal() {
    const modal = document.getElementById('addonModal');
    if (!modal) return;
    const title = document.getElementById('modalAddonTitle');
    const desc = document.getElementById('modalAddonDesc');
    const bView = document.getElementById('modalBedrockUpload');
    const jView = document.getElementById('modalJavaInstall');

    if (activeEdition === 'bedrock') {
        if (title) title.textContent = 'Upload Bedrock Addon Pack';
        if (desc) desc.textContent = 'Select a .mcpack or .zip file containing behavior or resource modules.';
        if (bView) bView.style.display = 'block';
        if (jView) jView.style.display = 'none';
    } else {
        if (title) title.textContent = 'Install Remote Java Mod';
        if (desc) desc.textContent = 'Enter the direct download URL for the mod jar (e.g. Modrinth, CurseForge).';
        if (bView) bView.style.display = 'none';
        if (jView) jView.style.display = 'block';
    }
    modal.style.display = 'flex';
}

function closeAddonModal() {
    const modal = document.getElementById('addonModal');
    if (modal) modal.style.display = 'none';
}

async function submitAddonUpload() {
    const input = document.getElementById('addonFileInput');
    if (!input || !input.files || input.files.length === 0) {
        alert('Please choose an addon (.mcpack or .zip) file.');
        return;
    }
    const file = input.files[0];
    const formData = new FormData();
    formData.append('file', file);

    closeAddonModal();
    alert('Uploading and extracting addon pack. Please wait...');

    try {
        const res = await fetch('/api/addons/upload', {
            method: 'POST',
            body: formData,
        });
        const data = await res.json();
        alert(data.result || 'Addon pack installed successfully!');
        loadAddons();
    } catch (err) {
        alert(`Failed to upload addon: ${err.message}`);
    }
}

async function submitJavaModInstall() {
    const url = document.getElementById('javaModUrl')?.value.trim();
    const name = document.getElementById('javaModFilename')?.value.trim();
    if (!url) {
        alert('Please provide a mod download URL.');
        return;
    }

    closeAddonModal();
    alert('Dispatching mod installation to remote PC via Nexus CLI. Please wait...');

    try {
        const res = await fetch('/api/java/mods/install', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, name: name || undefined }),
        });
        const data = await res.json();
        alert(data.message || data.result || 'Mod installed successfully!');
        loadAddons();
    } catch (err) {
        alert(`Failed to install mod: ${err.message}`);
    }
}

async function toggleBedrockPack(uuid, isResource, makeActive) {
    if (!cachedBedrockAddons) return;
    const bList = (cachedBedrockAddons.applied_behavior || []).map(p => p.pack_id);
    const rList = (cachedBedrockAddons.applied_resource || []).map(p => p.pack_id);

    let newB = [...bList];
    let newR = [...rList];

    if (isResource) {
        if (makeActive) {
            if (!newR.includes(uuid)) newR.push(uuid);
        } else {
            newR = newR.filter(id => id !== uuid);
        }
    } else {
        if (makeActive) {
            if (!newB.includes(uuid)) newB.push(uuid);
        } else {
            newB = newB.filter(id => id !== uuid);
        }
    }

    try {
        const res = await fetch('/api/addons/apply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ behavior_packs: newB, resource_packs: newR })
        });
        const data = await res.json();
        alert(data.result || 'Packs updated for active world.');
        loadAddons();
    } catch (err) {
        alert(`Failed to update packs: ${err.message}`);
    }
}

async function deleteBedrockPack(folder) {
    if (!confirm(`Permanently remove addon folder '${folder}' from server?`)) return;
    try {
        const res = await fetch('/api/addons/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folder })
        });
        const data = await res.json();
        alert(data.result || 'Addon pack removed.');
        loadAddons();
    } catch (err) {
        alert(`Failed to remove addon: ${err.message}`);
    }
}

async function toggleJavaMod(name) {
    try {
        const res = await fetch('/api/java/mods/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        const data = await res.json();
        alert(data.message || data.result || 'Mod toggled.');
        loadAddons();
    } catch (err) {
        alert(`Failed to toggle mod: ${err.message}`);
    }
}

async function deleteJavaMod(name) {
    if (!confirm(`Delete mod file '${name}' from remote server?`)) return;
    try {
        const res = await fetch('/api/java/mods/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        const data = await res.json();
        alert(data.message || data.result || 'Mod deleted.');
        loadAddons();
    } catch (err) {
        alert(`Failed to delete mod: ${err.message}`);
    }
}

/* =========================================================================
   12. SOFTWARE & UPDATES ENGINE
   ========================================================================= */
let updatePollTimer = null;

async function loadUpdateTab() {
    if (activeEdition === 'bedrock') {
        try {
            const res = await fetch('/api/installer/versions?edition=bedrock');
            if (res.ok) {
                const data = await res.json();
                const channels = data.channels || [];
                const stable = channels.find(c => c.id === 'stable');
                const preview = channels.find(c => c.id === 'preview');

                const stEl = document.getElementById('bdsLatestStableVer');
                const prEl = document.getElementById('bdsLatestPreviewVer');
                if (stEl) stEl.textContent = stable ? stable.version : 'Unknown';
                if (prEl) prEl.textContent = preview ? preview.version : 'Unknown';
            }
            const statusRes = await fetch('/api/status');
            if (statusRes.ok) {
                const st = await statusRes.json();
                const instEl = document.getElementById('bdsInstalledVer');
                if (instEl) instEl.textContent = st.version || 'Unknown';
            }
        } catch (err) {
            console.debug('Bedrock versions error:', err);
        }
    } else {
        const flavor = document.querySelector('input[name="javaFlavor"]:checked')?.value || 'paper';
        await fetchJavaVersions(flavor);
    }
}

function onBdsChannelChange() {
    const channel = document.querySelector('input[name="bdsChannel"]:checked')?.value;
    const urlGroup = document.getElementById('bdsCustomUrlGroup');
    if (urlGroup) urlGroup.style.display = channel === 'custom' ? 'block' : 'none';
}

function onJavaFlavorChange() {
    const flavor = document.querySelector('input[name="javaFlavor"]:checked')?.value || 'paper';
    const verGroup = document.getElementById('javaVersionGroup');
    const buildGroup = document.getElementById('javaBuildGroup');
    const customGroup = document.getElementById('javaCustomUrlGroup');

    if (flavor === 'custom') {
        if (verGroup) verGroup.style.display = 'none';
        if (buildGroup) buildGroup.style.display = 'none';
        if (customGroup) customGroup.style.display = 'block';
    } else {
        if (verGroup) verGroup.style.display = 'block';
        if (buildGroup) buildGroup.style.display = 'block';
        if (customGroup) customGroup.style.display = 'none';
        fetchJavaVersions(flavor);
    }
}

async function fetchJavaVersions(flavor) {
    const select = document.getElementById('javaVersionSelect');
    if (!select) return;
    select.innerHTML = '<option value="">Loading versions...</option>';

    try {
        const res = await fetch(`/api/installer/versions?edition=java&flavor=${flavor}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const versions = data.versions || [];

        if (versions.length === 0) {
            select.innerHTML = '<option value="1.21.4">1.21.4 (Default)</option>';
            return;
        }

        select.innerHTML = versions.map((v, idx) => `<option value="${escapeHtml(v)}" ${idx === 0 ? 'selected' : ''}>${escapeHtml(v)}</option>`).join('');
    } catch (err) {
        select.innerHTML = '<option value="1.21.4">1.21.4 (Default)</option>';
    }
}

function onJavaVersionSelect() {
    // Optional version change callback
}

async function triggerBedrockUpdate() {
    const channel = document.querySelector('input[name="bdsChannel"]:checked')?.value;
    let url = undefined;

    if (channel === 'custom') {
        url = document.getElementById('bdsCustomUrl')?.value.trim();
        if (!url) {
            alert('Please provide a valid download URL for the Bedrock server ZIP.');
            return;
        }
    }

    if (!confirm('Start Bedrock Server update? The server will be stopped, files extracted with world preservation, and restarted.')) {
        return;
    }

    const btn = document.getElementById('btnTriggerBedrockUpdate');
    if (btn) btn.disabled = true;

    try {
        const res = await fetch('/api/update_server', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ download_url: url })
        });
        const data = await res.json();
        startUpdatePolling();
    } catch (err) {
        alert(`Failed to initiate Bedrock update: ${err.message}`);
        if (btn) btn.disabled = false;
    }
}

function startUpdatePolling() {
    const card = document.getElementById('updateProgressCard');
    if (card) card.style.display = 'block';

    if (updatePollTimer) clearInterval(updatePollTimer);
    updatePollTimer = setInterval(async () => {
        try {
            const res = await fetch('/api/update_status');
            if (!res.ok) return;
            const state = await res.json();

            const bar = document.getElementById('updateProgressBar');
            const badge = document.getElementById('updateProgressBadge');
            const msg = document.getElementById('updateProgressMsg');

            if (bar) bar.style.width = `${state.progress || 0}%`;
            if (badge) badge.textContent = `${state.progress || 0}%`;
            if (msg) msg.textContent = state.message || state.status;

            // Update step highlights
            ['step1', 'step2', 'step3', 'step4', 'step5'].forEach(s => {
                document.getElementById(s)?.classList.remove('active', 'done');
            });

            if (state.progress >= 10) document.getElementById('step1')?.classList.add('done');
            if (state.progress >= 40) document.getElementById('step2')?.classList.add('done');
            if (state.progress >= 70) document.getElementById('step3')?.classList.add('done');
            if (state.progress >= 90) document.getElementById('step4')?.classList.add('done');
            if (state.progress >= 100) document.getElementById('step5')?.classList.add('done');

            if (state.status === 'success') {
                clearInterval(updatePollTimer);
                alert('Update completed successfully! Server is online.');
                document.getElementById('btnTriggerBedrockUpdate')?.removeAttribute('disabled');
                loadUpdateTab();
                fetchServerStatuses();
            } else if (state.status === 'failed') {
                clearInterval(updatePollTimer);
                alert(`Update failed: ${state.error || 'Unknown error'}`);
                document.getElementById('btnTriggerBedrockUpdate')?.removeAttribute('disabled');
            }
        } catch (e) {
            console.debug('Update status poll error:', e);
        }
    }, 1500);
}

async function triggerJavaEngineInstall() {
    const flavor = document.querySelector('input[name="javaFlavor"]:checked')?.value || 'paper';
    const version = document.getElementById('javaVersionSelect')?.value || '1.21.4';
    const build = document.getElementById('javaBuildInput')?.value.trim() || 'latest';
    const customUrl = document.getElementById('javaCustomUrl')?.value.trim();
    const jvmXmx = document.getElementById('javaJvmXmx')?.value || '4G';
    const eulaAgree = document.getElementById('javaEulaAgree')?.checked;

    if (!eulaAgree) {
        alert('You must accept the Minecraft EULA before installing.');
        return;
    }

    if (flavor === 'custom' && !customUrl) {
        alert('Please provide a custom JAR download URL.');
        return;
    }

    if (!confirm(`Remotely install/switch Java engine to ${flavor.toUpperCase()} ${version} via Nexus CLI?`)) {
        return;
    }

    const btn = document.getElementById('btnTriggerJavaInstall');
    if (btn) btn.disabled = true;

    alert('Dispatching engine deployment to remote machine via Nexus CLI tunnel. Please wait...');

    try {
        const res = await fetch('/api/java/installer/install', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                flavor,
                version,
                build: build || undefined,
                download_url: customUrl || undefined,
                jvm_heap: jvmXmx,
                eula_accepted: true,
            })
        });
        const data = await res.json();
        if (res.ok && (data.success !== false)) {
            alert(data.message || data.result || 'Engine deployment completed successfully!');
        } else {
            alert(`⚠️ Engine deployment error:\n\n${data.error || data.result || 'Installation failed'}`);
        }
        fetchServerStatuses();
    } catch (err) {
        alert(`Failed to dispatch Java engine install: ${err.message}`);
    } finally {
        if (btn) btn.disabled = false;
    }
}
