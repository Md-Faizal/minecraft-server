/**
 * Minecraft Server Control Deck - Universal Management Client
 * Clean, data-driven, function-first architecture.
 */

// Global Application State
let activeEdition = localStorage.getItem('mc_edition') || 'java';
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
                    const verifyRes = await fetch('/api/auth/verify', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ pin: cachedPin })
                    });
                    const verifyData = await verifyRes.json();
                    if (verifyData.authenticated) {
                        isAuthenticated = true;
                    } else {
                        localStorage.removeItem('mc_auth_pin');
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
        if (data.authenticated) {
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
                errBox.textContent = 'Incorrect PIN. Access denied.';
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
    activeEdition = edition;
    if (save) localStorage.setItem('mc_edition', edition);

    ['btnEditionBedrock', 'btnEditionJava', 'btnEditionAll'].forEach(id => {
        document.getElementById(id)?.classList.remove('active');
    });

    const cardJava = document.getElementById('cardJava');
    const cardBedrock = document.getElementById('cardBedrock');
    const tag = document.getElementById('consoleTargetTag');

    if (edition === 'bedrock') {
        document.getElementById('btnEditionBedrock')?.classList.add('active');
        if (cardJava) cardJava.style.display = 'none';
        if (cardBedrock) cardBedrock.style.display = 'block';
        if (tag) tag.textContent = 'Target: Bedrock Dedicated Server';
    } else if (edition === 'java') {
        document.getElementById('btnEditionJava')?.classList.add('active');
        if (cardJava) cardJava.style.display = 'block';
        if (cardBedrock) cardBedrock.style.display = 'none';
        if (tag) tag.textContent = 'Target: Java Edition (RCON / Nexus Tunnel)';
    } else {
        document.getElementById('btnEditionAll')?.classList.add('active');
        if (cardJava) cardJava.style.display = 'block';
        if (cardBedrock) cardBedrock.style.display = 'block';
        if (tag) tag.textContent = 'Target: Dual Fleet (Java & Bedrock)';
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
        const res = await fetch('/api/telemetry');
        if (!res.ok) return;
        const data = await res.json();

        // CPU
        const cpuUsage = data.cpu_usage_pct || 0;
        const cpuEl = document.getElementById('hudCpuUsage');
        const cpuBar = document.getElementById('hudCpuBar');
        const cpuModel = document.getElementById('hudCpuModel');
        if (cpuEl) cpuEl.textContent = `${cpuUsage.toFixed(1)}%`;
        if (cpuBar) cpuBar.style.width = `${Math.min(cpuUsage, 100)}%`;
        if (cpuModel) cpuModel.textContent = data.cpu_model || `${data.cpu_cores || 0} Cores`;

        // RAM
        const usedMb = data.memory_used_mb || 0;
        const totalMb = data.memory_total_mb || 1;
        const ramPct = Math.round((usedMb / totalMb) * 100);
        const ramEl = document.getElementById('hudRamUsage');
        const ramPctEl = document.getElementById('hudRamPercent');
        const ramBar = document.getElementById('hudRamBar');
        if (ramEl) ramEl.textContent = `${(usedMb / 1024).toFixed(1)} / ${(totalMb / 1024).toFixed(1)} GB`;
        if (ramPctEl) ramPctEl.textContent = `${ramPct}% allocated`;
        if (ramBar) ramBar.style.width = `${Math.min(ramPct, 100)}%`;

        // Thermals
        const tempEl = document.getElementById('hudTemp');
        const tempStatus = document.getElementById('hudTempStatus');
        if (tempEl) {
            if (data.cpu_temp_c !== null && data.cpu_temp_c !== undefined) {
                tempEl.textContent = `${data.cpu_temp_c.toFixed(0)}°C`;
                if (tempStatus) {
                    tempStatus.textContent = data.cpu_temp_c > 80 ? 'High Temp Warning' : 'Normal Thermal Range';
                }
            } else {
                tempEl.textContent = 'N/A';
                if (tempStatus) tempStatus.textContent = 'No thermal sensor';
            }
        }

        // Uptime & Host Status
        const uptimeEl = document.getElementById('hudUptime');
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
        const res = await fetch('/api/logs');
        if (!res.ok) return;
        const data = await res.json();
        const logs = data.logs || [];
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
        alert(data.message || `${edition.toUpperCase()} server start triggered.`);
        fetchServerStatuses();
    } catch (err) {
        alert(`Failed to start ${edition} server.`);
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
    try {
        const res = await fetch('/api/properties');
        if (!res.ok) throw new Error('Failed to load properties');
        propertiesData = await res.json();
        renderPropertiesList();
    } catch (err) {
        container.innerHTML = `<div class="console-line error">Could not load properties: ${err}</div>`;
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

    try {
        const res = await fetch('/api/properties', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updateObj)
        });
        const data = await res.json();
        alert(data.message || 'Properties saved successfully. Restart the server to apply changes.');
        loadProperties();
    } catch (err) {
        alert('Failed to save properties.');
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
