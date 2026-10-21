/**
 * Minecraft Bedrock and Java Server Management Dashboard
 */

// Global State
let currentTab = 'home';
let serverEdition = ['bedrock', 'java'].includes(localStorage.getItem('server_edition'))
    ? localStorage.getItem('server_edition')
    : 'bedrock';
let lastBedrockStatus = null;
let lastJavaStatus = null;
let lastPaperUpdateStatus = 'idle';
let autoScroll = true;
let consoleFilter = 'all';
let searchQuery = '';
let commandHistory = JSON.parse(localStorage.getItem('bds_cmd_history') || '[]');
let historyIndex = -1;
let rawLogsCache = [];
let pollInterval = 2000;
let pollTimer = null;

// Minecraft Bedrock Common Commands for Autocomplete
const BDS_COMMANDS = [
    { cmd: "list", desc: "List all connected players" },
    { cmd: "save-all", desc: "Save server state to disk" },
    { cmd: "whitelist on", desc: "Enable allowlist mode" },
    { cmd: "whitelist off", desc: "Disable allowlist mode" },
    { cmd: "whitelist reload", desc: "Reload allowlist.json from disk" },
    { cmd: "time set day", desc: "Set world time to 1000 (day)" },
    { cmd: "time set night", desc: "Set world time to 13000 (night)" },
    { cmd: "weather clear", desc: "Clear rain and thunderstorms" },
    { cmd: "weather rain", desc: "Start rain downfall" },
    { cmd: "gamerule showcoordinates true", desc: "Enable coordinate display" },
    { cmd: "gamerule keepinventory true", desc: "Prevent losing items on death" },
    { cmd: "gamerule mobgriefing false", desc: "Prevent creepers breaking blocks" },
    { cmd: "gamemode survival", desc: "Set default gamemode to survival" },
    { cmd: "gamemode creative", desc: "Set default gamemode to creative" },
    { cmd: "kick", desc: "Kick player from server" },
    { cmd: "tp", desc: "Teleport player" },
    { cmd: "say", desc: "Broadcast public message" },
    { cmd: "stop", desc: "Gracefully shutdown BDS daemon" }
];
const JAVA_COMMANDS = [
    { cmd: 'list', desc: 'List online players' },
    { cmd: 'save-all', desc: 'Save world data' },
    { cmd: 'say', desc: 'Broadcast a message' },
    { cmd: 'whitelist on', desc: 'Enable the whitelist' },
    { cmd: 'whitelist off', desc: 'Disable the whitelist' },
    { cmd: 'op', desc: 'Grant operator access' },
    { cmd: 'deop', desc: 'Remove operator access' },
    { cmd: 'time set day', desc: 'Set the world time to day' },
    { cmd: 'weather clear', desc: 'Clear the weather' },
    { cmd: 'stop', desc: 'Gracefully stop Paper' }
];

/* =========================================================================
   1. ORGANIC DYNAMIC HALFTONE BACKGROUND ENGINE (Zentra Physics)
   ========================================================================= */
function initZentraHalftoneBackground() {
    const canvas = document.getElementById('zentraCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let animationFrameId;

    const mouse = {
        x: -2000,
        y: -2000,
        targetX: -2000,
        targetY: -2000,
        active: false,
        intensity: 0
    };

    function resize() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        width = window.innerWidth;
        height = window.innerHeight;
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        ctx.scale(dpr, dpr);
    }

    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', (e) => {
        mouse.targetX = e.clientX;
        mouse.targetY = e.clientY;
        mouse.active = true;
    }, { passive: true });

    document.addEventListener('mouseleave', () => {
        mouse.active = false;
    });

    resize();

    const SPACING = 38;
    const startTime = performance.now();
    const NODE_RADIUS = 280;
    const MOUSE_RADIUS = 260;

    function render(currentTime) {
        if (mouse.active) {
            mouse.x += (mouse.targetX - mouse.x) * 0.08;
            mouse.y += (mouse.targetY - mouse.y) * 0.08;
            mouse.intensity += (1.0 - mouse.intensity) * 0.08;
        } else {
            mouse.x += (-2000 - mouse.x) * 0.04;
            mouse.y += (-2000 - mouse.y) * 0.04;
            mouse.intensity += (0 - mouse.intensity) * 0.06;
        }

        ctx.clearRect(0, 0, width, height);
        const elapsed = (currentTime - startTime) * 0.001;
        const cols = Math.ceil(width / SPACING) + 2;
        const rows = Math.ceil(height / SPACING) + 2;

        const node1X = width * (0.5 + 0.38 * Math.sin(elapsed * 0.55) * Math.cos(elapsed * 0.28));
        const node1Y = height * (0.5 + 0.36 * Math.cos(elapsed * 0.45) * Math.sin(elapsed * 0.33));
        const node2X = width * (0.5 + 0.34 * Math.cos(elapsed * 0.65 + 1.8));
        const node2Y = height * (0.5 + 0.36 * Math.sin(elapsed * 0.5 + 2.4));

        for (let r = 0; r < rows; r++) {
            const y = r * SPACING;
            const yProgress = Math.max(0, Math.min(1, y / height));
            const baseRadius = 1.4 + Math.pow(yProgress, 1.4) * 6.8;
            const baseAlpha = 0.22 + yProgress * 0.38;

            for (let c = 0; c < cols; c++) {
                const x = c * SPACING;
                const wave1 = Math.sin(x * 0.009 + elapsed * 1.3) * Math.cos(y * 0.009 - elapsed * 1.1);
                const wave2 = Math.sin((x + y) * 0.007 - elapsed * 0.85) * Math.cos(x * 0.006 + elapsed * 0.7);
                const wave3 = Math.sin(x * 0.015 - y * 0.012 + elapsed * 1.6) * 0.5;

                const ambientDriftX = (wave1 * 0.65 + wave2 * 0.35 + wave3 * 0.2) * 6.0;
                const ambientDriftY = (wave2 * 0.65 - wave1 * 0.35 + wave3 * 0.2) * 6.0;
                const ambientScale = (wave1 + wave2) * 1.2;

                let drawX = x + ambientDriftX;
                let drawY = y + ambientDriftY;
                let radius = baseRadius + ambientScale;
                let alpha = baseAlpha;

                // Node 1
                const n1dx = drawX - node1X;
                const n1dy = drawY - node1Y;
                const n1distSq = n1dx * n1dx + n1dy * n1dy;
                if (n1distSq < NODE_RADIUS * NODE_RADIUS) {
                    const dist = Math.sqrt(n1distSq);
                    const factor = Math.cos((dist / NODE_RADIUS) * (Math.PI / 2));
                    radius += factor * 3.0;
                    alpha += factor * 0.2;
                }

                // Node 2
                const n2dx = drawX - node2X;
                const n2dy = drawY - node2Y;
                const n2distSq = n2dx * n2dx + n2dy * n2dy;
                if (n2distSq < NODE_RADIUS * NODE_RADIUS) {
                    const dist = Math.sqrt(n2distSq);
                    const factor = Math.cos((dist / NODE_RADIUS) * (Math.PI / 2));
                    radius += factor * 2.6;
                    alpha += factor * 0.18;
                }

                // Mouse Reaction
                const mdx = drawX - mouse.x;
                const mdy = drawY - mouse.y;
                const mDistSq = mdx * mdx + mdy * mdy;
                if (mDistSq < MOUSE_RADIUS * MOUSE_RADIUS && mouse.intensity > 0.01) {
                    const mDist = Math.sqrt(mDistSq);
                    const mFactor = Math.cos((mDist / MOUSE_RADIUS) * (Math.PI / 2)) * mouse.intensity;
                    radius += mFactor * 3.2;
                    alpha += mFactor * 0.28;
                    if (mDist > 0.5) {
                        const push = mFactor * 9.0;
                        drawX += (mdx / mDist) * push;
                        drawY += (mdy / mDist) * push;
                    }
                }

                if (radius <= 0.3) continue;

                ctx.beginPath();
                ctx.arc(drawX, drawY, Math.max(0.6, radius), 0, Math.PI * 2);
                ctx.fillStyle = `rgba(17, 17, 17, ${Math.min(0.85, Math.max(0.12, alpha))})`;
                ctx.fill();
            }
        }

        animationFrameId = requestAnimationFrame(render);
    }

    animationFrameId = requestAnimationFrame(render);
}

/* =========================================================================
   2. SLIDING PILL TAB NAVIGATION & DUAL DRAG/CLICK CONTROLLER (Zentra Physics)
   ========================================================================= */
let isDraggingTabs = false;
let tabDragStartX = 0;
let tabDragStartY = 0;
let hasDraggedTabs = false;

function updateTabSlider(activeBtn) {
    const slider = document.getElementById('tabSliderPill');
    if (!slider || !activeBtn) return;
    const parent = activeBtn.parentElement;
    if (!parent) return;
    const parentRect = parent.getBoundingClientRect();
    const btnRect = activeBtn.getBoundingClientRect();

    slider.style.left = `${btnRect.left - parentRect.left}px`;
    slider.style.width = `${btnRect.width}px`;
}

function initTabDragSelector() {
    const switcher = document.getElementById('tabSwitcher');
    if (!switcher) return;

    let isPointerDown = false;
    let pointerId = null;

    // Direct click handler on all tab buttons
    switcher.querySelectorAll('.nav-tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (hasDraggedTabs) return; // Ignore if it was a drag gesture
            const tab = btn.getAttribute('data-tab');
            if (tab) switchZentraTab(tab);
        });
    });

    switcher.addEventListener('pointerdown', (e) => {
        // Only react to primary button (left click / touch)
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        isPointerDown = true;
        pointerId = e.pointerId;
        tabDragStartX = e.clientX;
        tabDragStartY = e.clientY;
        hasDraggedTabs = false;
    });

    window.addEventListener('pointermove', (e) => {
        if (!isPointerDown) return;
        const dx = e.clientX - tabDragStartX;
        const dy = e.clientY - tabDragStartY;

        // If pointer moved horizontally beyond threshold, activate drag mode
        if (!hasDraggedTabs && Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy)) {
            hasDraggedTabs = true;
            isDraggingTabs = true;
            switcher.classList.add('dragging');
            try { switcher.setPointerCapture(pointerId); } catch (_) {}
        }

        if (!hasDraggedTabs) return;

        const slider = document.getElementById('tabSliderPill');
        const parentRect = switcher.getBoundingClientRect();
        const currentActiveBtn = switcher.querySelector(`.nav-tab-btn[data-tab="${currentTab}"]`);
        const pillWidth = currentActiveBtn ? currentActiveBtn.getBoundingClientRect().width : 76;

        // Position slider smoothly under cursor
        const relX = e.clientX - parentRect.left;
        const minLeft = 4;
        const maxLeft = parentRect.width - pillWidth - 4;
        const targetLeft = Math.max(minLeft, Math.min(maxLeft, relX - pillWidth / 2));

        if (slider) {
            slider.style.left = `${targetLeft}px`;
            slider.style.width = `${pillWidth}px`;
        }

        // Live visual highlight of the closest tab button while dragging
        const buttons = Array.from(switcher.querySelectorAll('.nav-tab-btn'));
        let closestBtn = null;
        let minDistance = Infinity;

        buttons.forEach(btn => {
            const rect = btn.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const dist = Math.abs(e.clientX - centerX);
            if (dist < minDistance) {
                minDistance = dist;
                closestBtn = btn;
            }
        });

        if (closestBtn) {
            buttons.forEach(b => {
                b.classList.toggle('active', b === closestBtn);
            });
        }
    });

    const handlePointerUp = (e) => {
        if (!isPointerDown) return;
        isPointerDown = false;
        isDraggingTabs = false;
        switcher.classList.remove('dragging');
        try { if (pointerId !== null) switcher.releasePointerCapture(pointerId); } catch (_) {}

        if (hasDraggedTabs) {
            // Find which button the user dropped the slider on
            const buttons = Array.from(switcher.querySelectorAll('.nav-tab-btn'));
            let closestBtn = null;
            let minDistance = Infinity;

            buttons.forEach(btn => {
                const rect = btn.getBoundingClientRect();
                const centerX = rect.left + rect.width / 2;
                const dist = Math.abs(e.clientX - centerX);
                if (dist < minDistance) {
                    minDistance = dist;
                    closestBtn = btn;
                }
            });

            if (closestBtn) {
                const targetTab = closestBtn.getAttribute('data-tab');
                if (targetTab) switchZentraTab(targetTab);
            }

            // Reset dragged state after click event cycle concludes
            setTimeout(() => {
                hasDraggedTabs = false;
            }, 60);
        } else {
            // It was a click: if target was a tab button, ensure it switches
            const targetBtn = e.target.closest('.nav-tab-btn');
            if (targetBtn) {
                const tab = targetBtn.getAttribute('data-tab');
                if (tab) switchZentraTab(tab);
            }
        }
    };

    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    // Keep slider in sync on window resize
    window.addEventListener('resize', () => {
        const activeBtn = switcher.querySelector(`.nav-tab-btn[data-tab="${currentTab}"]`);
        if (activeBtn) updateTabSlider(activeBtn);
    });
}

const PAGE_CONTEXT = {
    home: ['Overview', 'Status, process controls, and edition-specific shortcuts.'],
    map: ['World map', 'Explore the Bedrock world and manage live player locations.'],
    console: ['Server console', 'One console for the selected server edition.'],
    java: ['Paper setup', 'Install, update, and inspect the Paper Java server.'],
    worlds: ['Worlds', 'Manage Bedrock worlds and backups.'],
    players: ['Players', 'Bedrock player sessions, permissions, and allowlist.'],
    addons: ['Addons', 'Install and apply Bedrock behavior and resource packs.'],
    properties: ['Properties', 'Shared settings editor adapted to the selected server.'],
    update: ['Install & update', 'Update the selected server without replacing its worlds.'],
    settings: ['Settings', 'Dashboard preferences and server startup context.']
};

function syncServerEditionUI() {
    document.body.dataset.serverEdition = serverEdition;
    document.querySelectorAll('[data-server-context]').forEach(button => {
        button.classList.toggle('active', button.dataset.serverContext === serverEdition);
    });
    document.querySelectorAll('[data-edition]').forEach(element => {
        element.hidden = element.dataset.edition !== serverEdition;
    });
    const navSubtext = document.getElementById('navSubtext');
    const eyebrow = document.getElementById('pageContextEyebrow');
    const address = document.getElementById('contextServerAddress');
    if (navSubtext) navSubtext.textContent = serverEdition === 'java' ? 'Paper Java server' : 'Bedrock Dedicated Server';
    if (eyebrow) eyebrow.textContent = serverEdition === 'java' ? 'JAVA · PAPER' : 'BEDROCK EDITION';
    if (address) address.textContent = serverEdition === 'java' ? 'TCP 25565' : 'UDP 19132';

    const context = PAGE_CONTEXT[currentTab] || PAGE_CONTEXT.home;
    const title = document.getElementById('pageContextTitle');
    const description = document.getElementById('pageContextDescription');
    if (title) title.textContent = context[0];
    if (description) description.textContent = serverEdition === 'java'
        ? context[1].replace('Bedrock ', '').replace('Bedrock', 'Paper')
        : context[1];

    if (currentTab === 'properties') {
        const pageTitle = document.getElementById('propertiesPageTitle');
        const pageDescription = document.getElementById('propertiesPageDescription');
        if (pageTitle) pageTitle.textContent = serverEdition === 'java' ? 'Java server.properties' : 'Bedrock server.properties';
        if (pageDescription) pageDescription.textContent = serverEdition === 'java'
            ? 'Common Paper settings. Restart Paper after saving to apply changes.'
            : 'Bedrock settings. World-linked settings are saved to the active world configuration.';
    }

    const tabButton = document.querySelector(`.nav-tab-btn[data-tab="${currentTab}"]`);
    if (tabButton && tabButton.hidden) switchZentraTab('home');
}

function switchServerContext(edition) {
    if (!['bedrock', 'java'].includes(edition) || edition === serverEdition) return;
    serverEdition = edition;
    localStorage.setItem('server_edition', edition);
    syncServerEditionUI();
    switchZentraTab('home');
    loadStatus();
}

function switchZentraTab(tabName) {
    if (!tabName) return;
    // Map URL aliases
    if (tabName === 'terminal') tabName = 'console';
    const button = document.querySelector(`.nav-tab-btn[data-tab="${tabName}"]`);
    if (button && button.dataset.edition && button.dataset.edition !== serverEdition) return;

    currentTab = tabName;
    const allTabs = ['home', 'map', 'console', 'java', 'worlds', 'players', 'addons', 'properties', 'update', 'settings'];

    allTabs.forEach(t => {
        const cap = t.charAt(0).toUpperCase() + t.slice(1);
        const view = document.getElementById(`view${cap}`);
        const btn = document.querySelector(`.nav-tab-btn[data-tab="${t}"]`);
        if (view) {
            if (t === tabName) {
                view.style.display = 'block';
                view.classList.add('active');
            } else {
                view.style.display = 'none';
                view.classList.remove('active');
            }
        }
        if (btn) {
            if (t === tabName) {
                btn.classList.add('active');
                updateTabSlider(btn);
            } else {
                btn.classList.remove('active');
            }
        }
    });
    syncServerEditionUI();

    // Update URL hash without forcing window scroll jump
    const desiredHash = `#${tabName}`;
    if (window.location.hash !== desiredHash) {
        history.replaceState(null, null, desiredHash);
    }

    // Always trigger data load for the activated tab
    if (tabName === 'home') {
        loadStatus();
        if (serverEdition === 'bedrock') loadAnnouncements();
    } else if (tabName === 'map') {
        initGodsEyeMap();
        loadGodsEyeData();
    } else if (tabName === 'console') {
        fetchLogs();
        setTimeout(() => {
            const screen = document.getElementById('terminalScreen');
            if (screen && autoScroll) screen.scrollTop = screen.scrollHeight;
        }, 60);
    } else if (tabName === 'java') {
        loadJavaServer();
        loadLatestPaper();
        pollPaperUpdateStatus();
    } else if (tabName === 'worlds') {
        loadWorlds();
    } else if (tabName === 'players') {
        loadPlayers();
    } else if (tabName === 'addons') {
        loadAddons();
    } else if (tabName === 'properties') {
        loadProperties();
    } else if (tabName === 'update') {
        if (serverEdition === 'bedrock') checkBdsUpdates();
        else {
            loadJavaServer();
            loadLatestPaper();
            pollPaperUpdateStatus();
        }
    } else if (tabName === 'settings') {
        loadSettings();
    }
}

/* =========================================================================
   3. TOAST NOTIFICATIONS
   ========================================================================= */
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `zentra-toast ${type}`;
    toast.innerHTML = `<span>${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span> ${message}`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(12px) scale(0.95)';
        toast.style.transition = 'all 0.25s ease';
        setTimeout(() => toast.remove(), 250);
    }, 3200);
}

/* =========================================================================
   4. BUFFED REMOTE TERMINAL CONSOLE ENGINE
   ========================================================================= */
function fetchLogs() {
    const outputEndpoint = serverEdition === 'java' ? '/api/java/output' : '/api/server_output';
    const serverLabel = document.getElementById('terminalServerLabel');
    const prompt = document.getElementById('terminalPrompt');
    const input = document.getElementById('terminalCmdInput');
    const badge = document.getElementById('termConnBadge');
    if (serverLabel) serverLabel.textContent = serverEdition === 'java' ? 'paper.jar · stdin/stdout' : 'bedrock_server · stdin/stdout';
    if (prompt) prompt.textContent = serverEdition === 'java' ? 'paper>' : 'bds>';
    if (input) input.placeholder = serverEdition === 'java'
        ? 'Paper command (e.g. list, whitelist on, say hello)...'
        : 'Bedrock command (e.g. list, gamemode creative, say hello)...';
    if (badge) badge.textContent = serverEdition === 'java' ? 'JAVA · TCP 25565' : 'BEDROCK · UDP 19132';
    fetch(outputEndpoint)
        .then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.text();
        })
        .then(text => {
            const lines = text.split('\n').filter(l => l.trim().length > 0);
            rawLogsCache = lines;
            renderTerminalLines(lines);
            const lineCount = document.getElementById('termLineCount');
            if (lineCount) lineCount.textContent = `${lines.length} lines buffered`;
        })
        .catch(err => console.error("Error fetching logs:", err));
}

function renderTerminalLines(lines) {
    const screen = document.getElementById('terminalScreen');
    if (!screen) return;

    if (!lines || lines.length === 0) {
        screen.innerHTML = `
            <div style="color:var(--zentra-muted); font-style:italic; padding:24px; text-align:center;">
                <p style="margin-bottom:8px; font-weight:600;">Console buffer is currently empty.</p>
                <p style="font-size:12px; color:#8b949e;">Start the selected server to stream live process output here.</p>
            </div>
        `;
        return;
    }

    const timeRegex = /\[(\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}:\d{3})\]/;
    const levelRegex = /\[(INFO|WARN|ERROR|DEBUG)\]/i;

    let filtered = lines;

    // Apply Filter Chips
    if (consoleFilter !== 'all') {
        filtered = filtered.filter(line => {
            if (consoleFilter === 'info') return line.includes('INFO');
            if (consoleFilter === 'warn') return line.includes('WARN');
            if (consoleFilter === 'error') return line.includes('ERROR');
            if (consoleFilter === 'player') return line.includes('Player connected') || line.includes('Player disconnected');
            return true;
        });
    }

    // Apply Search Filter
    if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        filtered = filtered.filter(line => line.toLowerCase().includes(q));
    }

    if (filtered.length === 0) {
        screen.innerHTML = `<div style="color:#6e7681; font-style:italic; padding:12px;">No log entries match your filter.</div>`;
        return;
    }

    let html = '';
    for (const raw of filtered) {
        let timestamp = '';
        let level = 'INFO';
        let content = raw;

        const timeMatch = raw.match(timeRegex);
        if (timeMatch) {
            timestamp = timeMatch[1].split(' ')[1] || timeMatch[1];
            content = content.replace(timeRegex, '');
        }

        const levelMatch = raw.match(levelRegex);
        if (levelMatch) {
            level = levelMatch[1].toUpperCase();
            content = content.replace(levelRegex, '');
        }

        let isPlayerEvent = false;
        if (content.includes('Player connected:')
            || content.includes('Player disconnected:')
            || (serverEdition === 'java' && (content.includes(' joined the game') || content.includes(' left the game')))) {
            level = 'PLAYER';
            isPlayerEvent = true;
        }

        html += `
            <div class="log-row">
                <span class="log-timestamp">${timestamp || '--:--:--'}</span>
                <span class="log-level ${level}">${level}</span>
                <span class="log-msg ${isPlayerEvent ? 'highlight-player' : ''}">${escapeHtml(content.trim())}</span>
            </div>
        `;
    }

    screen.innerHTML = html;

    if (autoScroll) {
        screen.scrollTop = screen.scrollHeight;
    }
}

function handleLogSearch(query) {
    searchQuery = query;
    renderTerminalLines(rawLogsCache);
}

function setConsoleFilter(filterType) {
    consoleFilter = filterType;
    document.querySelectorAll('.chip-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === filterType);
    });
    renderTerminalLines(rawLogsCache);
}

function toggleScrollLock() {
    autoScroll = !autoScroll;
    const btn = document.getElementById('termScrollLockBtn');
    if (btn) {
        btn.classList.toggle('active', autoScroll);
        btn.innerHTML = autoScroll ? '<span>⬇</span> Auto-scroll: ON' : '<span>⏸</span> Auto-scroll: PAUSED';
    }
    if (autoScroll) {
        const screen = document.getElementById('terminalScreen');
        if (screen) screen.scrollTop = screen.scrollHeight;
    }
}

function clearTerminalView() {
    const screen = document.getElementById('terminalScreen');
    if (screen) {
        screen.innerHTML = `<div style="color:#6e7681; font-style:italic; padding:12px;">Terminal view cleared. (Live stream still active)</div>`;
    }
}

function downloadLogs() {
    const text = rawLogsCache.join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${serverEdition}-server-${new Date().toISOString().slice(0, 10)}.log`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Server log file downloaded", "success");
}

function toggleFullscreenTerminal() {
    const win = document.getElementById('terminalWindow');
    if (win) {
        win.classList.toggle('fullscreen');
    }
}

function quickSendCommand(cmd) {
    document.getElementById('terminalCmdInput').value = cmd;
    sendConsoleCommand('terminalCmdInput');
}

function sendConsoleCommand(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const cmd = input.value.trim();
    if (!cmd) return;

    // Save to history
    if (!commandHistory.includes(cmd)) {
        commandHistory.push(cmd);
        if (commandHistory.length > 50) commandHistory.shift();
        localStorage.setItem('bds_cmd_history', JSON.stringify(commandHistory));
    }
    historyIndex = -1;

    const endpoint = serverEdition === 'java' ? '/api/java/command' : '/api/command';
    fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd })
    })
    .then(async r => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.result || `HTTP ${r.status}`);
        return data;
    })
    .then(data => {
        if (data.result === 'sent') {
            showToast(`Executed: ${cmd}`, 'success');
            input.value = '';
            setTimeout(fetchLogs, 400);
        } else {
            showToast(`Server response: ${data.result || 'Failed'}`, 'error');
        }
    })
    .catch(err => {
        showToast(`Failed to execute command: ${err}`, 'error');
    });

    hideAutocomplete();
}

// Arrow Up/Down Command History Navigation & Autocomplete
function initTerminalKeyboard() {
    const input = document.getElementById('terminalCmdInput');
    const box = document.getElementById('autocompleteBox');
    if (!input || !box) return;

    input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (commandHistory.length === 0) return;
            if (historyIndex === -1) historyIndex = commandHistory.length - 1;
            else if (historyIndex > 0) historyIndex--;
            input.value = commandHistory[historyIndex] || '';
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (historyIndex !== -1) {
                if (historyIndex < commandHistory.length - 1) {
                    historyIndex++;
                    input.value = commandHistory[historyIndex];
                } else {
                    historyIndex = -1;
                    input.value = '';
                }
            }
        } else if (e.key === 'Enter') {
            sendConsoleCommand('terminalCmdInput');
        } else if (e.key === 'Escape') {
            hideAutocomplete();
        }
    });

    input.addEventListener('input', () => {
        const val = input.value.trim().toLowerCase();
        if (!val) {
            hideAutocomplete();
            return;
        }

            const commandList = serverEdition === 'java' ? JAVA_COMMANDS : BDS_COMMANDS;
            const matches = commandList.filter(c => c.cmd.toLowerCase().startsWith(val) || c.cmd.toLowerCase().includes(val));
        if (matches.length > 0) {
            box.innerHTML = matches.map(m => `
                <div class="autocomplete-item" onclick="selectAutocomplete('${m.cmd}')">
                    <span>${m.cmd}</span>
                    <span style="font-size:10px; color:#8b949e;">${m.desc}</span>
                </div>
            `).join('');
            box.style.display = 'block';
        } else {
            hideAutocomplete();
        }
    });
}

function selectAutocomplete(cmd) {
    const input = document.getElementById('terminalCmdInput');
    if (input) {
        input.value = cmd;
        input.focus();
    }
    hideAutocomplete();
}

function hideAutocomplete() {
    const box = document.getElementById('autocompleteBox');
    if (box) box.style.display = 'none';
}

/* =========================================================================
   5. SERVER PROCESS OPERATIONS & LIVE STATUS
   ========================================================================= */
function loadStatus() {
    fetch('/api/status')
        .then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
        })
        .then(data => {
            lastBedrockStatus = data;
            renderSelectedServerStatus();
            pollLifecycleStatus();
            loadJavaStatusOnly();
        })
        .catch(err => console.error("Status fetch error:", err));
}

function loadJavaStatusOnly() {
    fetch('/api/java/status')
        .then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
        })
        .then(data => {
            lastJavaStatus = data;
            renderSelectedServerStatus();
        })
        .catch(err => {
            console.error("Paper status fetch error:", err);
            const status = document.getElementById('javaServerStatus');
            if (status) status.textContent = 'Unavailable';
        });
}

function renderSelectedServerStatus() {
    const bedrock = lastBedrockStatus;
    const java = lastJavaStatus;
    const isJava = serverEdition === 'java';
    const running = isJava ? Boolean(java && java.running) : Boolean(bedrock && bedrock.server_running);
    const badge = document.getElementById('navStatusBadge');
    const statusText = document.getElementById('navStatusText');
    const statePill = document.getElementById('homeStatePill');
    const javaHomeCard = document.getElementById('javaHomeCard');
    const isInstalled = java && java.paper_installed;
    const activeWorld = bedrock && bedrock.active_world ? bedrock.active_world : 'World';
    const onlineCount = bedrock ? (bedrock.online_players || []).length : 0;

    if (badge) badge.className = running ? 'status-pill-badge' : 'status-pill-badge stopped';
    if (statusText) statusText.textContent = `${isJava ? 'Paper' : 'Bedrock'} ${running ? 'Running' : 'Stopped'}`;
    if (statePill) {
        statePill.className = running ? 'metric-pill' : 'metric-pill neutral';
        statePill.textContent = running ? '● Running' : '○ Stopped';
    }
    document.querySelectorAll('[data-process-action]').forEach(button => {
        const action = button.dataset.processAction;
        button.style.display = action === 'start'
            ? (running ? 'none' : 'inline-flex')
            : (running ? 'inline-flex' : 'none');
    });

    if (javaHomeCard) javaHomeCard.style.display = isJava ? 'block' : 'none';
    const javaStatus = document.getElementById('javaServerStatus');
    const javaVersion = document.getElementById('javaPaperStatus');
    const javaEula = document.getElementById('javaEulaStatus');
    const javaDir = document.getElementById('javaServerDirectory');
    const backupDir = document.getElementById('javaBackupDirectory');
    const javaHomeState = document.getElementById('javaHomeState');
    const javaHomeVersion = document.getElementById('javaHomeVersion');
    const javaHomeAddress = document.getElementById('javaHomeAddress');
    const javaAddress = document.getElementById('javaServerAddress');
    const javaBedrockStatus = document.getElementById('javaBedrockStatus');
    const eulaConfirm = document.getElementById('paperEulaConfirm');
    if (javaStatus) {
        javaStatus.textContent = java ? (java.running ? 'Paper running' : 'Paper stopped') : 'Checking Paper...';
        javaStatus.className = java && java.running ? 'metric-pill' : 'metric-pill neutral';
    }
    if (javaVersion) javaVersion.textContent = isInstalled ? java.installed_version || 'Installed' : 'Not installed';
    if (javaEula) javaEula.textContent = java && java.eula_accepted ? 'Accepted' : 'Not yet recorded';
    if (javaDir) javaDir.textContent = java ? java.directory : 'Loading...';
    if (backupDir) backupDir.textContent = java && java.directory ? `${java.directory}\\backups` : 'Loading...';
    if (javaBedrockStatus) javaBedrockStatus.textContent = bedrock ? (bedrock.server_running ? 'Running' : 'Stopped') : 'Checking...';
    if (javaHomeState) {
        javaHomeState.textContent = java ? (java.running ? '● Running' : (isInstalled ? '○ Stopped' : 'Setup required')) : 'Checking...';
        javaHomeState.className = java && java.running ? 'metric-pill' : 'metric-pill neutral';
    }
    if (javaHomeVersion) javaHomeVersion.textContent = isInstalled ? java.installed_version || 'Installed' : 'Not installed';
    if (javaHomeAddress) javaHomeAddress.textContent = java ? java.address : 'TCP 25565';
    if (javaAddress) javaAddress.textContent = java ? java.address : 'TCP 25565';
    if (eulaConfirm && java && java.eula_accepted) eulaConfirm.checked = true;
    const paperButton = document.getElementById('paperInstallButton');
    if (paperButton && window.latestPaperVersion && java) {
        paperButton.textContent = java.paper_installed
            ? `Update Paper to ${window.latestPaperVersion}`
            : `Install Paper ${window.latestPaperVersion}`;
    }

    const homeActiveWorld = document.getElementById('homeActiveWorld');
    const homeOnlineCount = document.getElementById('homeOnlineCount');
    const homeVersion = document.getElementById('homeVersion');
    if (homeActiveWorld) homeActiveWorld.textContent = activeWorld;
    if (homeOnlineCount) homeOnlineCount.textContent = `${onlineCount} player${onlineCount === 1 ? '' : 's'}`;
    if (homeVersion) homeVersion.textContent = bedrock ? bedrock.version || 'Unknown' : 'Unknown';
    const quickCommand = document.getElementById('homeCmdInput');
    if (quickCommand) quickCommand.placeholder = isJava
        ? 'e.g. say Hello from the dashboard! or list'
        : 'e.g. say Hello from the dashboard! or list';
    const heroPlayerCountText = document.getElementById('heroPlayerCountText');
    const heroOnlineBadge = document.getElementById('heroOnlineBadge');
    const heroServerName = document.getElementById('heroServerName');
    const heroMotdPreview = document.getElementById('heroMotdPreview');
    if (heroPlayerCountText) heroPlayerCountText.textContent = `👥 ${onlineCount} / 10 Players`;
    if (heroOnlineBadge) {
        heroOnlineBadge.className = running && !isJava ? 'status-pill-badge' : 'status-pill-badge stopped';
        heroOnlineBadge.textContent = running && !isJava ? '● ONLINE' : '○ OFFLINE';
    }
    if (window._currentServerName) {
        if (heroServerName) heroServerName.textContent = window._currentServerName.replace(/§[0-9a-zA-Z]/g, '');
        if (heroMotdPreview) heroMotdPreview.innerHTML = parseMinecraftColorCodes(window._currentServerName);
    }
}

function serverAction(action) {
    if (serverEdition === 'bedrock' && action !== 'start') {
        openLifecycleModal(action);
        return;
    }
    if (action === 'start') {
        const otherEditionRunning = serverEdition === 'java'
            ? Boolean(lastBedrockStatus && lastBedrockStatus.server_running)
            : Boolean(lastJavaStatus && lastJavaStatus.running);
        if (otherEditionRunning) {
            const otherEdition = serverEdition === 'java' ? 'Bedrock' : 'Paper';
            const selectedEdition = serverEdition === 'java' ? 'Paper' : 'Bedrock';
            const accepted = window.confirm(
                `${otherEdition} is already running. This VM has about 1 GiB RAM; running both servers may cause severe lag or an out-of-memory shutdown. Start ${selectedEdition} anyway?`
            );
            if (!accepted) return;
        }
    }
    showToast(`Sending ${action} request to ${serverEdition === 'java' ? 'Paper' : 'Bedrock'}...`, 'info');
    const endpoint = serverEdition === 'java'
        ? `/api/java/${action}`
        : `/api/${action}`;
    fetch(endpoint, { method: 'POST' })
        .then(async r => {
            const data = await r.json();
            if (!r.ok) throw new Error(data.result || `HTTP ${r.status}`);
            return data;
        })
        .then(data => {
            showToast(data.result || `${action} request accepted.`, 'success');
            setTimeout(() => {
                loadStatus();
                if (currentTab === 'console') fetchLogs();
            }, 800);
            setTimeout(fetchLogs, 2000);
        })
        .catch(err => showToast(`Action failed: ${err.message || err}`, 'error'));
}

function loadJavaServer() {
    fetch('/api/java/status')
        .then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
        })
        .then(data => {
            const status = document.getElementById('javaServerStatus');
            lastJavaStatus = data;
            renderSelectedServerStatus();
        })
        .catch(err => {
            const status = document.getElementById('javaServerStatus');
            if (status) status.textContent = `Unavailable: ${err.message}`;
        });
}

function loadLatestPaper() {
        const latest = document.getElementById('javaLatestVersion');
        if (latest) latest.textContent = 'Checking...';
        fetch('/api/java/latest')
            .then(async r => {
                const data = await r.json();
                if (!r.ok) throw new Error(data.result || `HTTP ${r.status}`);
                return data;
            })
            .then(data => {
                if (latest) latest.textContent = `${data.version} · build ${data.build}`;
                const summary = document.getElementById('javaUpdateSummary');
                if (summary) summary.textContent = `Java ${data.java_runtime} installed · Paper ${data.version} requires Java ${data.required_java}`;
                const button = document.getElementById('paperInstallButton');
                if (button && lastJavaStatus) button.textContent = lastJavaStatus.paper_installed
                    ? `Update Paper to ${data.version}`
                    : `Install Paper ${data.version}`;
                window.latestPaperVersion = data.version;
                window.latestPaperJava = data.required_java;
            })
            .catch(error => {
                if (latest) latest.textContent = 'Unavailable';
                const summary = document.getElementById('javaUpdateSummary');
                if (summary) summary.textContent = error.message;
                showToast(`Could not check latest Paper build: ${error.message}`, 'error');
            });
}

function installOrUpdatePaper() {
        const eula = document.getElementById('paperEulaConfirm');
        if (!eula || !eula.checked) {
            showToast('Read and accept the Minecraft EULA before installing Paper.', 'error');
            return;
        }
        const button = document.getElementById('paperInstallButton');
        if (button) button.disabled = true;
        const progress = document.getElementById('paperUpdateProgress');
        if (progress) progress.style.display = 'block';
        fetch('/api/java/install', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ eula_accepted: true })
        })
            .then(async r => {
                const data = await r.json();
                if (!r.ok) throw new Error(data.result || `HTTP ${r.status}`);
                return data;
            })
            .then(data => {
                showToast(data.result || 'Paper install/update started.', 'info');
                pollPaperUpdateStatus();
            })
            .catch(error => {
                if (button) button.disabled = false;
                showToast(`Paper install/update failed: ${error.message}`, 'error');
            });
}

function pollPaperUpdateStatus() {
        fetch('/api/java/update_status')
            .then(r => {
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return r.json();
            })
            .then(state => {
                const progress = document.getElementById('paperUpdateProgress');
                const message = document.getElementById('paperUpdateMessage');
                const percent = document.getElementById('paperUpdatePercent');
                const bar = document.getElementById('paperUpdateBar');
                const error = document.getElementById('paperUpdateError');
                const button = document.getElementById('paperInstallButton');
                if (progress && state.status !== 'idle') progress.style.display = 'block';
                if (message) message.textContent = state.message || state.status;
                if (percent) percent.textContent = `${state.progress}%`;
                if (bar) bar.style.width = `${state.progress}%`;
                if (error) error.textContent = state.error || '';
                const active = ['preparing', 'downloading', 'stopping', 'installing', 'restarting'].includes(state.status);
                if (button) button.disabled = active;
                if (active) setTimeout(pollPaperUpdateStatus, 1200);
                if (state.status === 'success' && lastPaperUpdateStatus !== 'success') {
                    loadJavaServer();
                    showToast(state.message, 'success');
                }
                lastPaperUpdateStatus = state.status;
            })
            .catch(error => console.error('Paper update status fetch failed:', error));
}

/* =========================================================================
   6. WORLDS MANAGEMENT
   ========================================================================= */
function loadWorlds() {
    const tbody = document.getElementById('worldsTableBody');
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--zentra-muted); padding:16px;"><span class="status-dot-pulse"></span> Loading worlds...</td></tr>`;
    }

    fetch('/api/worlds')
        .then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
            return r.json();
        })
        .then(data => {
            const tbody = document.getElementById('worldsTableBody');
            if (!tbody) return;

            const worlds = data.worlds || [];
            const activeWorld = data.active_world;

            if (worlds.length === 0) {
                tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--zentra-muted); padding:16px;">No worlds found on server.</td></tr>`;
                return;
            }

            tbody.innerHTML = worlds.map(w => {
                const wName = typeof w === 'string' ? w : (w.name || '');
                const wSeed = typeof w === 'object' ? (w.seed || '') : '';
                const wGamemode = typeof w === 'object' ? (w.gamemode || 'survival') : 'survival';
                const wDifficulty = typeof w === 'object' ? (w.difficulty || 'easy') : 'easy';
                const wSize = typeof w === 'object' ? (w.size_formatted || '--') : '--';
                const isActive = (typeof w === 'object' && w.is_active !== undefined) ? w.is_active : (wName === activeWorld);

                return `
                    <tr>
                        <td style="font-weight:700;">${escapeHtml(wName)}</td>
                        <td>
                            <span class="metric-pill ${wGamemode === 'creative' ? 'amber' : ''}" style="text-transform:capitalize;">${escapeHtml(wGamemode)}</span>
                        </td>
                        <td>
                            <span class="metric-pill neutral" style="text-transform:capitalize;">${escapeHtml(wDifficulty)}</span>
                        </td>
                        <td>
                            <div style="display:flex; align-items:center; gap:6px;">
                                <span style="font-family:var(--font-mono); font-size:12px;">${escapeHtml(wSeed || '--')}</span>
                                ${wSeed ? `<button class="zentra-btn secondary" style="padding:2px 6px; font-size:11px;" title="Copy Seed" onclick="copyToClipboard('${escapeHtml(wSeed)}')">📋</button>` : ''}
                            </div>
                        </td>
                        <td style="font-size:12px; color:var(--zentra-muted);">${escapeHtml(wSize)}</td>
                        <td>
                            ${isActive ? '<span class="metric-pill">Active World</span>' : '<span class="metric-pill neutral">Inactive</span>'}
                        </td>
                        <td>
                            <div style="display:flex; gap:6px; flex-wrap:wrap;">
                                ${!isActive ? `<button class="zentra-btn emerald" style="padding:4px 10px; font-size:12px;" onclick="setActiveWorld('${escapeHtml(wName)}')">Activate</button>` : ''}
                                <button class="zentra-btn secondary" style="padding:4px 10px; font-size:12px;" onclick="backupWorld('${escapeHtml(wName)}')">Backup</button>
                                <button class="zentra-btn secondary" style="padding:4px 10px; font-size:12px;" onclick="loadBackups('${escapeHtml(wName)}')">Archives</button>
                                ${!isActive ? `<button class="zentra-btn danger" style="padding:4px 10px; font-size:12px;" onclick="deleteWorld('${escapeHtml(wName)}')">Delete</button>` : ''}
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');

            if (activeWorld) {
                loadBackups(activeWorld);
            }
        })
        .catch(err => {
            console.error("Failed to load worlds:", err);
            const tbody = document.getElementById('worldsTableBody');
            if (tbody) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="7" style="text-align:center; color:var(--zentra-red); padding:16px;">
                            <div>Failed to load worlds (${escapeHtml(err.message || String(err))})</div>
                            <button class="zentra-btn secondary" style="margin-top:8px; padding:4px 12px; font-size:12px;" onclick="loadWorlds()">↻ Retry</button>
                        </td>
                    </tr>
                `;
            }
        });
}

function generateRandomSeed() {
    const high = Math.floor(Math.random() * 0x7FFFFFFF);
    const low = Math.floor(Math.random() * 0xFFFFFFFF);
    const sign = Math.random() > 0.5 ? '' : '-';
    const seed = sign + ((BigInt(high) << 32n) | BigInt(low)).toString();
    const el = document.getElementById('newWorldSeed');
    if (el) el.value = seed;
}

function copyToClipboard(text, customMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            showToast(customMsg || `Copied to clipboard: ${text}`, 'success');
        }).catch(() => {
            prompt("Copy:", text);
        });
    } else {
        prompt("Copy:", text);
    }
}

function setActiveWorld(world) {
    if (!confirm(`Activate world '${world}'?\n\nThis will update server.properties to use this world. If the server is running, it will be restarted automatically.`)) return;

    const btn = event && event.target;
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Activating...';
    }

    showToast(`Activating world '${world}'...`, 'info');

    fetch('/api/set_active_world', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ world })
    })
    .then(r => {
        if (!r.ok) return r.json().then(e => Promise.reject(e.result || `HTTP ${r.status}`));
        return r.json();
    })
    .then(data => {
        // Strip Minecraft colour codes (§x) before showing in the UI toast
        const msg = (data.result || `World '${world}' switch initiated!`).replace(/§[0-9a-zA-Z]/g, '');
        showToast(msg, 'success');
        // The switch takes ~10s countdown + ~10s BDS restart.
        // Refresh worlds table after restart completes (~12s), status after fully up (~20s).
        setTimeout(loadWorlds, 12000);
        setTimeout(loadStatus, 20000);
    })
    .catch(err => {
        showToast(`Failed to activate world: ${err}`, 'error');
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Activate';
        }
    });
}

function submitCreateWorld() {
    const name = document.getElementById('newWorldName').value.trim();
    const seed = document.getElementById('newWorldSeed').value.trim();
    const gamemode = document.getElementById('newWorldGamemode') ? document.getElementById('newWorldGamemode').value : 'survival';
    const difficulty = document.getElementById('newWorldDifficulty') ? document.getElementById('newWorldDifficulty').value : 'easy';
    const world_type = document.getElementById('newWorldType') ? document.getElementById('newWorldType').value : 'default';
    const force_gamemode = document.getElementById('newWorldForceGamemode') ? (document.getElementById('newWorldForceGamemode').value === 'true') : true;
    const allow_cheats = document.getElementById('newWorldCheats') ? document.getElementById('newWorldCheats').checked : false;
    const show_coordinates = document.getElementById('newWorldCoords') ? document.getElementById('newWorldCoords').checked : true;
    const pvp = document.getElementById('newWorldPvp') ? document.getElementById('newWorldPvp').checked : true;
    const activate_now = document.getElementById('newWorldActivateNow') ? document.getElementById('newWorldActivateNow').checked : false;

    if (!name) return alert("Please specify a world folder name");

    fetch('/api/worlds/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name,
            seed,
            gamemode,
            difficulty,
            world_type,
            force_gamemode,
            allow_cheats,
            show_coordinates,
            pvp,
            activate_now
        })
    })
    .then(r => r.json())
    .then(data => {
        showToast(data.result || 'World created successfully', 'success');
        closeModal('createWorldModal');
        loadWorlds();
        if (activate_now) {
            setTimeout(() => { loadStatus(); checkCheatsStatus(); }, 2500);
        }
    })
    .catch(err => showToast(`Error creating world: ${err}`, 'error'));
}

function submitUploadWorld() {
    const fileInput = document.getElementById('uploadWorldFileInput');
    if (!fileInput.files || fileInput.files.length === 0) return alert("Please select a world file");

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);

    showToast("Uploading and importing world archive...", "info");
    fetch('/api/worlds/upload', {
        method: 'POST',
        body: formData
    })
    .then(r => r.json())
    .then(data => {
        showToast(data.result || 'Imported successfully', 'success');
        closeModal('uploadWorldModal');
        loadWorlds();
    })
    .catch(err => showToast(`Upload failed: ${err}`, 'error'));
}

function backupWorld(world) {
    showToast(`Creating snapshot archive for '${world}'...`, 'info');
    fetch('/api/backup_world', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ world })
    })
    .then(r => r.json())
    .then(data => {
        showToast(data.result || 'Backup created', 'success');
        loadBackups(world);
    })
    .catch(err => showToast(`Backup failed: ${err}`, 'error'));
}

function loadBackups(world) {
    const container = document.getElementById('backupsListContainer');
    if (!container) return;

    fetch(`/api/list_backups?world=${encodeURIComponent(world)}`)
        .then(r => r.json())
        .then(data => {
            const backups = data.backups || [];
            if (backups.length === 0) {
                container.innerHTML = `<p style="color:var(--zentra-muted); font-size:13px;">No backups found for world '${escapeHtml(world)}'.</p>`;
                return;
            }
            container.innerHTML = `
                <h4 style="font-size:14px; font-weight:700; margin-bottom:10px;">Backups for world: ${escapeHtml(world)}</h4>
                <div class="zentra-table-wrap">
                    <table class="zentra-table">
                        <thead>
                            <tr><th>Filename</th><th>Size</th><th>Created Date</th></tr>
                        </thead>
                        <tbody>
                            ${backups.map(b => `<tr><td style="font-family:var(--font-mono); font-size:12px;">${escapeHtml(b.filename)}</td><td>${escapeHtml(b.size)}</td><td>${escapeHtml(b.date)}</td></tr>`).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        })
        .catch(err => {
            container.innerHTML = `<p style="color:var(--zentra-red); font-size:12px;">Failed to load backups for '${escapeHtml(world)}'.</p>`;
        });
}

function deleteWorld(world) {
    if (!confirm(`Are you sure you want to permanently delete world '${world}'?`)) return;
    fetch('/api/worlds/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ world })
    })
    .then(r => r.json())
    .then(data => {
        showToast(data.result || 'Deleted', 'info');
        loadWorlds();
    })
    .catch(err => showToast(`Delete failed: ${err}`, 'error'));
}

/* =========================================================================
   7. PLAYERS MANAGEMENT (Directory, Cheats, Allowlist & History)
   ========================================================================= */
function loadPlayers() {
    const tbody = document.getElementById('playersTableBody');
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--zentra-muted); padding:16px;"><span class="status-dot-pulse"></span> Loading players...</td></tr>`;
    }

    checkCheatsStatus();
    loadAllowlist();

    fetch('/api/players')
        .then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
            return r.json();
        })
        .then(data => {
            const tbody = document.getElementById('playersTableBody');
            if (!tbody) return;
            const players = data.players || [];
            updatePlayerDropdowns(players);
            if (players.length === 0) {
                tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--zentra-muted); padding:16px;">No player records found.</td></tr>`;
                return;
            }

            tbody.innerHTML = players.map(p => {
                const isOnline = p.status === 'Online';
                return `
                    <tr>
                        <td style="font-weight:700;">${escapeHtml(p.name)}</td>
                        <td style="font-family:var(--font-mono); font-size:11px; color:var(--zentra-muted);">${escapeHtml(p.xuid || '--')}</td>
                        <td>${isOnline ? '<span class="metric-pill">Online</span>' : '<span class="metric-pill neutral">Offline</span>'}</td>
                        <td><span style="font-weight:600; text-transform:capitalize;">${escapeHtml(p.level)}</span></td>
                        <td>${escapeHtml(p.session_time || '--')}</td>
                        <td>${p.in_allowlist ? '<span style="color:#059669; font-weight:600;">Allowed</span>' : '<span style="color:#dc2626; font-weight:600;">Banned</span>'}</td>
                        <td>
                            <div style="display:flex; gap:6px; flex-wrap:wrap;">
                                <button class="zentra-btn secondary" style="padding:4px 8px; font-size:11px; border-color:#f59e0b; color:#d97706;" onclick="selectGmPlayer('${escapeHtml(p.name)}')">🎮 Arsenal</button>
                                ${p.in_allowlist 
                                    ? `<button class="zentra-btn danger" style="padding:4px 8px; font-size:11px;" onclick="playerAction('${escapeHtml(p.name)}', 'ban')">Ban</button>`
                                    : `<button class="zentra-btn emerald" style="padding:4px 8px; font-size:11px;" onclick="playerAction('${escapeHtml(p.name)}', 'unban')">Unban</button>`
                                }
                                <button class="zentra-btn secondary" style="padding:4px 8px; font-size:11px;" onclick="playerAction('${escapeHtml(p.name)}', 'promote')">Promote</button>
                                <button class="zentra-btn secondary" style="padding:4px 8px; font-size:11px;" onclick="playerAction('${escapeHtml(p.name)}', 'demote')">Demote</button>
                                <button class="zentra-btn secondary" style="padding:4px 8px; font-size:11px;" onclick="openPlayerHistory('${escapeHtml(p.name)}')">📜 History</button>
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');
        })
        .catch(err => {
            console.error("Failed to load players:", err);
            const tbody = document.getElementById('playersTableBody');
            if (tbody) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="7" style="text-align:center; color:var(--zentra-red); padding:16px;">
                            <div>Failed to load players (${escapeHtml(err.message || String(err))})</div>
                            <button class="zentra-btn secondary" style="margin-top:8px; padding:4px 12px; font-size:12px;" onclick="loadPlayers()">↻ Retry</button>
                        </td>
                    </tr>
                `;
            }
        });
}

function playerAction(player, action) {
    fetch('/api/player_action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player, action })
    })
    .then(r => r.json())
    .then(data => {
        showToast(data.result || 'Updated', 'success');
        loadPlayers();
    })
    .catch(err => showToast(`Player action failed: ${err}`, 'error'));
}

/* Cheats Controller */
function checkCheatsStatus() {
    fetch('/api/cheats_status')
        .then(r => r.json())
        .then(data => {
            const badge = document.getElementById('cheatsStatusBadge');
            if (!badge) return;
            if (data.cheats_enabled) {
                badge.className = 'metric-pill';
                badge.textContent = '● Cheats Enabled';
            } else {
                badge.className = 'metric-pill neutral';
                badge.textContent = '○ Cheats Disabled';
            }
        })
        .catch(() => {});
}

function toggleCheats() {
    showToast("Toggling world cheats...", "info");
    fetch('/api/cheats/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
    })
    .then(r => r.json())
    .then(data => {
        showToast(data.message || (data.allow_cheats ? "Cheats enabled on world" : "Cheats disabled on world"), 'success');
        checkCheatsStatus();
    })
    .catch(err => showToast(`Failed to toggle cheats: ${err}`, 'error'));
}

function sendPlayerCommand(cmd) {
    if (!cmd) return;
    fetch('/api/player_command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd })
    })
    .then(r => r.json())
    .then(data => {
        if (data.result) {
            showToast(data.result, 'success');
        } else if (data.error) {
            showToast(data.error, 'error');
        }
    })
    .catch(err => showToast(`Failed to run command: ${err}`, 'error'));
}

function executeCustomCheat() {
    const input = document.getElementById('customCheatCmd');
    if (!input || !input.value.trim()) return;
    const cmd = input.value.trim();
    sendPlayerCommand(cmd);
    input.value = '';
}

/* Allowlist Management */
function loadAllowlist() {
    const tbody = document.getElementById('allowlistTableBody');
    if (!tbody) return;

    fetch('/api/allowlist')
        .then(r => r.json())
        .then(data => {
            const list = data.allowlist || [];
            if (list.length === 0) {
                tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--zentra-muted); padding:14px;">Allowlist is currently empty.</td></tr>`;
                return;
            }

            tbody.innerHTML = list.map(item => `
                <tr>
                    <td style="font-weight:700;">${escapeHtml(item.name || '--')}</td>
                    <td style="font-family:var(--font-mono); font-size:11px; color:var(--zentra-muted);">${escapeHtml(item.xuid || '--')}</td>
                    <td>${item.ignoresPlayerLimit ? '<span style="color:#10b981; font-weight:600;">Yes</span>' : '<span style="color:var(--zentra-muted);">No</span>'}</td>
                    <td>
                        <button class="zentra-btn danger" style="padding:3px 8px; font-size:11px;" onclick="removeFromAllowlist('${escapeHtml(item.name || '')}', '${escapeHtml(item.xuid || '')}')">Remove</button>
                    </td>
                </tr>
            `).join('');
        })
        .catch(err => {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--zentra-red);">Failed to load allowlist.</td></tr>`;
        });
}

function submitAddToAllowlist(e) {
    if (e) e.preventDefault();
    const nameInput = document.getElementById('allowlistNewName');
    const xuidInput = document.getElementById('allowlistNewXuid');
    const limitCheck = document.getElementById('allowlistIgnoreLimit');

    const name = nameInput ? nameInput.value.trim() : '';
    const xuid = xuidInput ? xuidInput.value.trim() : '';
    const ignoresPlayerLimit = limitCheck ? limitCheck.checked : false;

    if (!name) return alert("Please specify a player name");

    fetch('/api/allowlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, xuid, ignoresPlayerLimit, action: 'add' })
    })
    .then(r => r.json())
    .then(data => {
        showToast(data.result || 'Added to allowlist', 'success');
        if (nameInput) nameInput.value = '';
        if (xuidInput) xuidInput.value = '';
        if (limitCheck) limitCheck.checked = false;
        loadAllowlist();
        loadPlayers();
    })
    .catch(err => showToast(`Failed to add: ${err}`, 'error'));
}

function removeFromAllowlist(name, xuid) {
    if (!confirm(`Remove '${name || xuid}' from allowlist?`)) return;
    fetch('/api/allowlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, xuid, action: 'remove' })
    })
    .then(r => r.json())
    .then(data => {
        showToast(data.result || 'Removed from allowlist', 'info');
        loadAllowlist();
        loadPlayers();
    })
    .catch(err => showToast(`Failed to remove: ${err}`, 'error'));
}

/* Player Session History Modal */
function openPlayerHistory(player) {
    openModal('playerHistoryModal');
    const titleEl = document.getElementById('historyModalPlayerName');
    const timeEl = document.getElementById('historyModalTotalTime');
    const tbody = document.getElementById('historyTableBody');

    if (titleEl) titleEl.textContent = `Session History: ${player}`;
    if (timeEl) timeEl.textContent = 'Loading records...';
    if (tbody) tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding:16px;"><span class="status-dot-pulse"></span> Loading sessions...</td></tr>`;

    fetch(`/api/player_sessions?player=${encodeURIComponent(player)}`)
        .then(r => r.json())
        .then(data => {
            const sessions = data.sessions || [];
            const totalSecs = data.total || 0;
            const hours = Math.floor(totalSecs / 3600);
            const mins = Math.floor((totalSecs % 3600) / 60);

            if (timeEl) timeEl.textContent = `Total Playtime: ${hours}h ${mins}m (${sessions.length} recorded session${sessions.length === 1 ? '' : 's'})`;

            if (sessions.length === 0) {
                if (tbody) tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--zentra-muted); padding:16px;">No session logs recorded yet for this player.</td></tr>`;
                return;
            }

            if (tbody) {
                tbody.innerHTML = sessions.map(s => `
                    <tr>
                        <td style="font-family:var(--font-mono); font-size:12px;">${escapeHtml(s.start || '--')}</td>
                        <td style="font-family:var(--font-mono); font-size:12px;">${escapeHtml(s.end || '--')}</td>
                        <td style="font-weight:600;">${escapeHtml(s.world || 'Default')}</td>
                    </tr>
                `).reverse().join('');
            }
        })
        .catch(err => {
            if (tbody) tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--zentra-red);">Failed to load history.</td></tr>`;
        });
}

/* =========================================================================
   8. ADDONS MANAGEMENT
   ========================================================================= */
function loadAddons() {
    const bCont = document.getElementById('behaviorPacksContainer');
    const rCont = document.getElementById('resourcePacksContainer');
    if (bCont) bCont.innerHTML = `<p style="color:var(--zentra-muted); font-size:12px;"><span class="status-dot-pulse"></span> Loading behavior packs...</p>`;
    if (rCont) rCont.innerHTML = `<p style="color:var(--zentra-muted); font-size:12px;"><span class="status-dot-pulse"></span> Loading resource packs...</p>`;

    fetch('/api/addons')
        .then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
            return r.json();
        })
        .then(data => {
            const bCont = document.getElementById('behaviorPacksContainer');
            const rCont = document.getElementById('resourcePacksContainer');
            if (!bCont || !rCont) return;

            const bPacks = data.behavior_packs || [];
            const rPacks = data.resource_packs || [];
            const appliedB = (data.applied_behavior || []).map(p => p.pack_id);
            const appliedR = (data.applied_resource || []).map(p => p.pack_id);

            bCont.innerHTML = bPacks.map(p => `
                <label class="stat-box" style="display:flex; align-items:center; gap:10px; cursor:pointer;">
                    <input type="checkbox" name="b_pack" value="${escapeHtml(p.folder)}" ${appliedB.includes(p.uuid) ? 'checked' : ''}>
                    <div>
                        <div style="font-weight:700; font-size:13px;">${escapeHtml(p.name)}</div>
                        <div style="font-size:11px; color:var(--zentra-muted);">${escapeHtml(p.folder)}</div>
                    </div>
                </label>
            `).join('') || '<p style="color:var(--zentra-muted); font-size:12px;">No behavior packs installed</p>';

            rCont.innerHTML = rPacks.map(p => `
                <label class="stat-box" style="display:flex; align-items:center; gap:10px; cursor:pointer;">
                    <input type="checkbox" name="r_pack" value="${escapeHtml(p.folder)}" ${appliedR.includes(p.uuid) ? 'checked' : ''}>
                    <div>
                        <div style="font-weight:700; font-size:13px;">${escapeHtml(p.name)}</div>
                        <div style="font-size:11px; color:var(--zentra-muted);">${escapeHtml(p.folder)}</div>
                    </div>
                </label>
            `).join('') || '<p style="color:var(--zentra-muted); font-size:12px;">No resource packs installed</p>';
        })
        .catch(err => {
            console.error("Failed to load addons:", err);
            const bCont = document.getElementById('behaviorPacksContainer');
            const rCont = document.getElementById('resourcePacksContainer');
            const errHtml = `
                <div style="color:var(--zentra-red); font-size:12px; padding:10px;">
                    <div>Failed to load addons (${escapeHtml(err.message || String(err))})</div>
                    <button class="zentra-btn secondary" style="margin-top:6px; padding:3px 10px; font-size:11px;" onclick="loadAddons()">↻ Retry</button>
                </div>
            `;
            if (bCont) bCont.innerHTML = errHtml;
            if (rCont) rCont.innerHTML = errHtml;
        });
}

function applyAddonsToActiveWorld() {
    const bCheckboxes = document.querySelectorAll('input[name="b_pack"]:checked');
    const rCheckboxes = document.querySelectorAll('input[name="r_pack"]:checked');

    const bFolders = Array.from(bCheckboxes).map(c => c.value);
    const rFolders = Array.from(rCheckboxes).map(c => c.value);

    fetch('/api/addons/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ behavior_packs: bFolders, resource_packs: rFolders })
    })
    .then(r => r.json())
    .then(data => {
        showToast(data.result || 'Addons applied', 'success');
    })
    .catch(err => showToast(`Failed to apply addons: ${err}`, 'error'));
}

function submitUploadAddon() {
    const input = document.getElementById('uploadAddonFileInput');
    if (!input.files || input.files.length === 0) return alert("Select an addon pack");

    const formData = new FormData();
    formData.append('file', input.files[0]);

    showToast("Extracting and installing addon...", "info");
    fetch('/api/addons/upload', {
        method: 'POST',
        body: formData
    })
    .then(r => r.json())
    .then(data => {
        showToast(data.result || 'Addon installed', 'success');
        closeModal('uploadAddonModal');
        loadAddons();
    })
    .catch(err => showToast(`Upload failed: ${err}`, 'error'));
}

/* =========================================================================
   9. SERVER PROPERTIES EDITOR (Robust Schema Form & Realtime Filter)
   ========================================================================= */
let _allPropertiesCache = [];

function loadProperties() {
    const form = document.getElementById('propertiesForm');
    if (!form) return;

    form.innerHTML = `
        <div style="grid-column: 1 / -1; display:flex; align-items:center; gap:12px; padding:24px; color:var(--zentra-muted);">
            <div class="status-dot-pulse"></div>
            <span>Fetching server.properties from dedicated server...</span>
        </div>
    `;

    const endpoint = serverEdition === 'java' ? '/api/java/properties' : '/api/properties';
    fetch(endpoint)
        .then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
            return r.json();
        })
        .then(data => {
            const props = data.properties || [];
            _allPropertiesCache = props;
            renderProperties(props);
            const serverNameProp = props.find(p => p.key === 'server-name');
            if (serverEdition === 'bedrock' && serverNameProp && serverNameProp.value) {
                window._currentServerName = serverNameProp.value;
                const heroServerName = document.getElementById('heroServerName');
                const heroMotdPreview = document.getElementById('heroMotdPreview');
                if (heroServerName) heroServerName.textContent = serverNameProp.value.replace(/§[0-9a-zA-Z]/g, '');
                if (heroMotdPreview) heroMotdPreview.innerHTML = parseMinecraftColorCodes(serverNameProp.value);
            }
        })
        .catch(err => {
            console.error("Failed to load properties:", err);
            form.innerHTML = `
                <div style="grid-column: 1 / -1; padding: 20px; background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 12px; color: var(--zentra-red);">
                    <div style="font-weight: 700; margin-bottom: 6px;">Failed to load server.properties</div>
                    <div style="font-size: 13px; margin-bottom: 12px;">${escapeHtml(err.message || String(err))}</div>
                    <button type="button" class="zentra-btn secondary" onclick="loadProperties()">↻ Retry Loading</button>
                </div>
            `;
            showToast(`Could not load properties: ${err.message || err}`, 'error');
        });
}

function renderProperties(props) {
    const form = document.getElementById('propertiesForm');
    if (!form) return;

    if (!props || props.length === 0) {
        form.innerHTML = `<div style="grid-column: 1 / -1; color: var(--zentra-muted); padding: 16px;">No matching properties found.</div>`;
        return;
    }

    form.innerHTML = props.map(p => {
        let inputHtml = '';
        const curVal = (p.value !== undefined && p.value !== null) ? p.value : p.default;

        if (p.type === 'choice' && p.choices) {
            inputHtml = `
                <select name="${p.key}" class="zentra-input">
                    ${p.choices.map(c => `<option value="${escapeHtml(c)}" ${String(c) === String(curVal) ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
                </select>
            `;
        } else if (p.type === 'bool') {
            const isTrue = String(curVal).toLowerCase() === 'true';
            inputHtml = `
                <select name="${p.key}" class="zentra-input">
                    <option value="true" ${isTrue ? 'selected' : ''}>true (enabled)</option>
                    <option value="false" ${!isTrue ? 'selected' : ''}>false (disabled)</option>
                </select>
            `;
        } else if (p.type === 'int') {
            inputHtml = `<input type="number" step="1" name="${p.key}" value="${escapeHtml(String(curVal ?? ''))}" class="zentra-input">`;
        } else if (p.type === 'float') {
            inputHtml = `<input type="number" step="any" name="${p.key}" value="${escapeHtml(String(curVal ?? ''))}" class="zentra-input">`;
        } else {
            inputHtml = `<input type="text" name="${p.key}" value="${escapeHtml(String(curVal ?? ''))}" class="zentra-input">`;
        }

        return `
            <div class="zentra-input-group" data-prop-key="${escapeHtml(p.key)}" data-prop-label="${escapeHtml(p.label)}">
                <label style="display:flex; justify-content:space-between; align-items:baseline;">
                    <span>${escapeHtml(p.label)}</span>
                    <span style="font-family:var(--font-mono); font-size:10px; color:var(--zentra-muted);">${escapeHtml(p.key)}</span>
                </label>
                ${inputHtml}
            </div>
        `;
    }).join('');
}

function filterProperties(query) {
    const q = (query || '').trim().toLowerCase();
    if (!q) {
        renderProperties(_allPropertiesCache);
        return;
    }

    const filtered = _allPropertiesCache.filter(p => {
        const k = (p.key || '').toLowerCase();
        const l = (p.label || '').toLowerCase();
        const v = String(p.value ?? p.default ?? '').toLowerCase();
        return k.includes(q) || l.includes(q) || v.includes(q);
    });

    renderProperties(filtered);
}

function saveProperties() {
    const form = document.getElementById('propertiesForm');
    if (!form) return;
    const formData = new FormData(form);
    const obj = {};
    formData.forEach((val, key) => { obj[key] = val; });

    showToast(serverEdition === 'java' ? "Saving Paper server properties..." : "Saving properties and updating world config...", "info");
    const endpoint = serverEdition === 'java' ? '/api/java/properties' : '/api/properties';
    fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(obj)
    })
    .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
    })
    .then(data => {
        showToast(data.result || 'Properties saved successfully!', 'success');
        setTimeout(loadProperties, 600);
    })
    .catch(err => {
        showToast(`Failed to save properties: ${err.message || err}`, 'error');
    });
}

/* =========================================================================
   10. BDS VERSION UPDATER
   ========================================================================= */
function checkBdsUpdates() {
    const curEl = document.getElementById('updateCurrentVer');
    const latEl = document.getElementById('updateLatestVer');
    if (curEl) curEl.textContent = 'Checking...';
    if (latEl) latEl.textContent = 'Checking...';

    fetch('/api/status')
        .then(r => r.json())
        .then(data => {
            if (curEl) curEl.textContent = data.version || 'Unknown';
        })
        .catch(() => {
            if (curEl) curEl.textContent = 'Unavailable';
        });

    fetch('/api/latest_version_url')
        .then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
        })
        .then(data => {
            if (latEl) latEl.textContent = data.version || 'Latest';
        })
        .catch(() => {
            if (latEl) latEl.textContent = 'Unable to fetch';
        });
}

function triggerServerUpdate() {
    if (!confirm("This will download and update the Bedrock Dedicated Server binary. Your worlds and properties will be preserved. Proceed?")) return;

    fetch('/api/update_server', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
    })
        .then(r => r.json())
        .then(data => {
            showToast(data.result || 'Update started', 'info');
            document.getElementById('updateProgressCard').style.display = 'block';
            pollUpdateStatus();
        })
        .catch(err => showToast(`Update failed to start: ${err}`, 'error'));
}

function pollUpdateStatus() {
    const timer = setInterval(() => {
        fetch('/api/update_status')
            .then(r => r.json())
            .then(state => {
                document.getElementById('updateStatusMsg').textContent = state.message || state.status;
                document.getElementById('updatePercent').textContent = `${state.progress}%`;
                document.getElementById('updateProgressBar').style.width = `${state.progress}%`;

                if (state.status === 'success' || state.status === 'failed') {
                    clearInterval(timer);
                    showToast(state.message || state.status, state.status === 'success' ? 'success' : 'error');
                }
            })
            .catch(() => {});
    }, 1000);
}

/* =========================================================================
   11. SETTINGS & MODALS HELPERS
   ========================================================================= */
function loadSettings() {
    const intervalSelect = document.getElementById('settingPollInterval');
    const scrollSelect = document.getElementById('settingAutoScroll');
    if (intervalSelect) intervalSelect.value = String(pollInterval);
    if (scrollSelect) scrollSelect.value = String(autoScroll);
}

function saveSettings() {
    const interval = parseInt(document.getElementById('settingPollInterval').value, 10);
    const scroll = document.getElementById('settingAutoScroll').value === 'true';
    pollInterval = interval;
    autoScroll = scroll;
    showToast("Settings saved locally", "success");
}

/* =========================================================================
   11. SMART AUTOMATED ANNOUNCEMENTS
   ========================================================================= */
function loadAnnouncements() {
    fetch('/api/announcements')
        .then(r => r.json())
        .then(data => {
            const enabledEl = document.getElementById('annEnabled');
            const intervalEl = document.getElementById('annInterval');
            const modeEl = document.getElementById('annMode');
            const onlyOnlineEl = document.getElementById('annOnlyOnline');
            const prefixEl = document.getElementById('annPrefix');
            const messagesEl = document.getElementById('annMessages');

            if (enabledEl) enabledEl.value = String(data.enabled);
            if (intervalEl) intervalEl.value = data.interval_seconds || 300;
            if (modeEl) modeEl.value = data.mode || 'sequential';
            if (onlyOnlineEl) onlyOnlineEl.value = String(data.only_when_online);
            if (prefixEl) prefixEl.value = data.prefix || '§l§e[Server]§r §b';
            if (messagesEl && Array.isArray(data.messages)) {
                messagesEl.value = data.messages.join('\n');
            }
        })
        .catch(err => console.error("Failed to load announcements:", err));
}

function saveAnnouncements() {
    const enabledEl = document.getElementById('annEnabled');
    const intervalEl = document.getElementById('annInterval');
    const modeEl = document.getElementById('annMode');
    const onlyOnlineEl = document.getElementById('annOnlyOnline');
    const prefixEl = document.getElementById('annPrefix');
    const messagesEl = document.getElementById('annMessages');

    const enabled = enabledEl ? enabledEl.value === 'true' : true;
    const interval_seconds = intervalEl ? parseInt(intervalEl.value, 10) || 300 : 300;
    const mode = modeEl ? modeEl.value : 'sequential';
    const only_when_online = onlyOnlineEl ? onlyOnlineEl.value === 'true' : true;
    const prefix = prefixEl ? prefixEl.value : '§l§e[Server]§r §b';
    const rawMessages = messagesEl ? messagesEl.value : '';
    const messages = rawMessages.split('\n').map(m => m.trim()).filter(m => m.length > 0);

    const payload = {
        enabled,
        interval_seconds,
        mode,
        only_when_online,
        prefix,
        messages
    };

    fetch('/api/announcements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    .then(r => r.json())
    .then(res => {
        showToast(res.result || "Announcements saved successfully!", "success");
    })
    .catch(err => showToast(`Failed to save announcements: ${err}`, "error"));
}

function broadcastNow() {
    const messagesEl = document.getElementById('annMessages');
    const rawMessages = messagesEl ? messagesEl.value : '';
    const lines = rawMessages.split('\n').map(m => m.trim()).filter(m => m.length > 0);
    const message = lines.length > 0 ? lines[0] : "Test server broadcast.";

    fetch('/api/announcements/broadcast_now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message })
    })
    .then(r => r.json())
    .then(res => {
        showToast(res.result || "Broadcast sent to all players!", "success");
    })
    .catch(err => showToast(`Broadcast failed: ${err}`, "error"));
}

function openModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('open');
}

function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('open');
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/* =========================================================================
   12. MOTD, BRANDING, LIFECYCLE COUNTDOWN & GAMERULES
   ========================================================================= */
function parseMinecraftColorCodes(text) {
    if (!text) return '';
    const colorMap = {
        '0': '#000000', '1': '#0000AA', '2': '#00AA00', '3': '#00AAAA',
        '4': '#AA0000', '5': '#AA00AA', '6': '#FFAA00', '7': '#AAAAAA',
        '8': '#555555', '9': '#5555FF', 'a': '#55FF55', 'b': '#55FFFF',
        'c': '#FF5555', 'd': '#FF55FF', 'e': '#FFFF55', 'f': '#FFFFFF'
    };
    let html = '';
    let currentColor = '#FFFFFF';
    let isBold = false;
    let isItalic = false;

    const parts = text.split(/(§[0-9a-zA-Z])/g);
    for (const part of parts) {
        if (part.startsWith('§')) {
            const code = part.charAt(1).toLowerCase();
            if (code === 'r') {
                currentColor = '#FFFFFF';
                isBold = false;
                isItalic = false;
            } else if (code === 'l') {
                isBold = true;
            } else if (code === 'o') {
                isItalic = true;
            } else if (colorMap[code]) {
                currentColor = colorMap[code];
            }
        } else if (part.length > 0) {
            let style = `color:${currentColor};`;
            if (isBold) style += 'font-weight:bold;';
            if (isItalic) style += 'font-style:italic;';
            html += `<span style="${style}">${escapeHtml(part)}</span>`;
        }
    }
    return html || escapeHtml(text);
}

function updateMotdModalPreview(val) {
    const preview = document.getElementById('motdLiveModalPreview');
    if (preview) {
        preview.innerHTML = parseMinecraftColorCodes(val) || '<span style="color:#6e7681;">Preview will appear here...</span>';
    }
}

function openMotdModal() {
    fetch('/api/properties')
        .then(r => r.json())
        .then(data => {
            const props = data.properties || [];
            const serverNameProp = props.find(p => p.key === 'server-name');
            const currentMotd = serverNameProp && serverNameProp.value ? serverNameProp.value : (window._currentServerName || 'LALALAND');
            const input = document.getElementById('motdInput');
            if (input) input.value = currentMotd;
            updateMotdModalPreview(currentMotd);
            openModal('motdModal');
        })
        .catch(() => {
            openModal('motdModal');
        });
}

function insertMotdCode(code) {
    const input = document.getElementById('motdInput');
    if (!input) return;
    const start = input.selectionStart || input.value.length;
    const end = input.selectionEnd || input.value.length;
    input.value = input.value.substring(0, start) + code + input.value.substring(end);
    input.focus();
    input.setSelectionRange(start + code.length, start + code.length);
    updateMotdModalPreview(input.value);
}

function autoGenerateMotdTemplate() {
    const templates = [
        "§b§lAETERNA SURVIVAL§r §8| §eSurvival SMP §a[1.26] §f• §6Zero Lag",
        "§e§lARCANE REALMS§r §8| §bNetherNet WebRTC §8• §dActive Community",
        "§a§lBEDROCK EXPEDITION§r §8| §6Custom Biomes §8• §eHardcore SMP",
        "§c§lLEGENDS BEDROCK§r §8| §bFast Chunks §8• §a24/7 Dedicated"
    ];
    const picked = templates[Math.floor(Math.random() * templates.length)];
    const input = document.getElementById('motdInput');
    if (input) {
        input.value = picked;
        updateMotdModalPreview(picked);
    }
}

function saveMotdSettings() {
    const input = document.getElementById('motdInput');
    const newMotd = input ? input.value.trim() : '';
    if (!newMotd) {
        showToast("MOTD cannot be empty", "error");
        return;
    }

    fetch('/api/properties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ properties: { "server-name": newMotd } })
    })
    .then(r => r.json())
    .then(res => {
        showToast("MOTD saved and applied to server!", "success");
        window._currentServerName = newMotd;
        closeModal('motdModal');
        loadProperties();
        loadStatus();
    })
    .catch(err => showToast(`Failed to update MOTD: ${err}`, "error"));
}

function openLifecycleModal(action, targetWorld = '') {
    const title = document.getElementById('lifecycleModalTitle');
    const desc = document.getElementById('lifecycleModalDesc');
    const actionInput = document.getElementById('lifecycleActionType');
    const targetInput = document.getElementById('lifecycleTargetWorld');
    const reasonInput = document.getElementById('lifecycleReasonInput');

    if (actionInput) actionInput.value = action;
    if (targetInput) targetInput.value = targetWorld;

    if (action === 'stop') {
        if (title) title.textContent = "Schedule Server Shutdown";
        if (desc) desc.textContent = "Broadcasts in-game countdown alerts to players and saves world data before stopping.";
        if (reasonInput) reasonInput.value = "Scheduled server maintenance";
    } else if (action === 'restart') {
        if (title) title.textContent = "Schedule Server Restart";
        if (desc) desc.textContent = "Warns active players, flushes chunks, and safely boots back up.";
        if (reasonInput) reasonInput.value = "Restarting for performance optimization";
    } else if (action === 'switch_world') {
        if (title) title.textContent = `Schedule World Switch to '${targetWorld}'`;
        if (desc) desc.textContent = `Alerts players, saves current world, and boots into '${targetWorld}'.`;
        if (reasonInput) reasonInput.value = `Switching world to ${targetWorld}`;
    }

    openModal('lifecycleModal');
}

function confirmLifecycleAction() {
    const action = document.getElementById('lifecycleActionType').value;
    const targetWorld = document.getElementById('lifecycleTargetWorld').value;
    const timerSelect = document.getElementById('lifecycleTimerSelect');
    const countdown_seconds = timerSelect ? parseInt(timerSelect.value, 10) : 10;
    const reasonInput = document.getElementById('lifecycleReasonInput');
    const reason = reasonInput ? reasonInput.value.trim() : "Scheduled maintenance";

    const payload = {
        action,
        countdown_seconds,
        reason,
        target_world: targetWorld ? targetWorld : undefined,
        force: countdown_seconds === 0
    };

    fetch('/api/lifecycle/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    .then(r => r.json())
    .then(res => {
        closeModal('lifecycleModal');
        showToast(res.result || "Action scheduled!", "success");
        pollLifecycleStatus();
    })
    .catch(err => showToast(`Action failed: ${err}`, "error"));
}

function abortLifecycleCountdown() {
    fetch('/api/lifecycle/abort', { method: 'POST' })
        .then(r => r.json())
        .then(res => {
            showToast(res.result || "Cancelled", res.aborted ? "success" : "info");
            pollLifecycleStatus();
        })
        .catch(err => showToast(`Abort failed: ${err}`, "error"));
}

function pollLifecycleStatus() {
    fetch('/api/lifecycle/status')
        .then(r => r.json())
        .then(status => {
            const banner = document.getElementById('lifecycleCountdownBanner');
            const titleEl = document.getElementById('lifecycleActionTitle');
            const badgeEl = document.getElementById('lifecycleSecondsBadge');
            const reasonEl = document.getElementById('lifecycleReasonText');

            if (!banner) return;

            if (status.active) {
                banner.style.display = 'flex';
                if (titleEl) titleEl.textContent = `Server ${status.action.toUpperCase()} in progress`;
                if (badgeEl) badgeEl.textContent = `${status.seconds_remaining}s remaining`;
                if (reasonEl) reasonEl.textContent = `Reason: ${status.reason || 'Server maintenance'}`;
            } else {
                banner.style.display = 'none';
            }
        })
        .catch(() => {});
}

function setGamerule(rule, value) {
    showToast(`Setting gamerule ${rule} to ${value}...`, 'info');
    fetch('/api/gamerules/set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rule, value })
    })
    .then(r => r.json())
    .then(data => {
        showToast(data.result || `Gamerule ${rule} updated`, 'success');
    })
    .catch(err => showToast(`Failed to set gamerule: ${err}`, 'error'));
}

/* =========================================================================
   12.5. GOD'S EYE REAL-TIME SATELLITE TACTICAL MAP
   ========================================================================= */
const mapState = {
    initialized: false,
    camX: 0,
    camZ: 0,
    zoom: 1.0,
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
    camStartX: 0,
    camStartZ: 0,
    followPlayerName: null,
    layers: {
        grid: true,
        rings: true,
        radar: true
    },
    radarAngle: 0,
    data: {
        world_name: 'Unicorn',
        spawn_x: 0,
        spawn_y: 64,
        spawn_z: 0,
        time_ticks: 1000,
        time_formatted: 'Day (Morning)',
        weather: 'clear',
        players: [],
        waypoints: []
    },
    hoverCoords: { x: 0, z: 0 },
    contextCoords: { x: 0, z: 0 },
    lightningFlashes: []
};

function initGodsEyeMap() {
    if (mapState.initialized) return;
    const canvas = document.getElementById('godseyeCanvas');
    const viewport = document.getElementById('godseyeViewport');
    if (!canvas || !viewport) return;

    mapState.initialized = true;

    function resizeCanvas() {
        const rect = viewport.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(rect.width * dpr);
        canvas.height = Math.floor(rect.height * dpr);
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;
    }

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    // Mouse drag for panning
    viewport.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        const ctxMenu = document.getElementById('mapContextMenu');
        if (ctxMenu && ctxMenu.style.display !== 'none' && !ctxMenu.contains(e.target)) {
            closeMapContextMenu();
        }

        mapState.isDragging = true;
        mapState.dragStartX = e.clientX;
        mapState.dragStartY = e.clientY;
        mapState.camStartX = mapState.camX;
        mapState.camStartZ = mapState.camZ;
        mapState.followPlayerName = null;
        updateFollowBtnState();
    });

    window.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;

        if (screenX >= 0 && screenX <= rect.width && screenY >= 0 && screenY <= rect.height) {
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;
            const worldX = Math.round(mapState.camX + (screenX - centerX) / mapState.zoom);
            const worldZ = Math.round(mapState.camZ + (screenY - centerY) / mapState.zoom);
            mapState.hoverCoords = { x: worldX, z: worldZ };

            const cursorDisplay = document.getElementById('mapCursorCoords');
            const chunkDisplay = document.getElementById('mapCursorChunk');
            if (cursorDisplay) cursorDisplay.textContent = `X: ${worldX} • Z: ${worldZ}`;
            if (chunkDisplay) {
                const chunkX = Math.floor(worldX / 16);
                const chunkZ = Math.floor(worldZ / 16);
                chunkDisplay.textContent = `Chunk: ${chunkX}, ${chunkZ}`;
            }
        }

        if (mapState.isDragging) {
            const dx = e.clientX - mapState.dragStartX;
            const dy = e.clientY - mapState.dragStartY;
            mapState.camX = mapState.camStartX - dx / mapState.zoom;
            mapState.camZ = mapState.camStartZ - dy / mapState.zoom;
        }
    });

    window.addEventListener('mouseup', () => {
        mapState.isDragging = false;
    });

    // Zoom on wheel
    viewport.addEventListener('wheel', (e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.15 : 0.85;
        zoomMap(factor);
    }, { passive: false });

    // Click anywhere on map to open Tactical Strike Context Menu
    viewport.addEventListener('click', (e) => {
        if (Math.abs(e.clientX - mapState.dragStartX) > 5 || Math.abs(e.clientY - mapState.dragStartY) > 5) {
            return;
        }
        if (e.target.closest('.godseye-canvas-controls') || e.target.closest('.godseye-context-menu')) {
            return;
        }

        const rect = viewport.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;

        const worldX = Math.round(mapState.camX + (clickX - centerX) / mapState.zoom);
        const worldZ = Math.round(mapState.camZ + (clickY - centerY) / mapState.zoom);
        mapState.contextCoords = { x: worldX, z: worldZ };

        openMapContextMenu(clickX, clickY, worldX, worldZ);
    });

    requestAnimationFrame(renderGodsEyeFrame);
}

function loadGodsEyeData() {
    fetch('/api/map/data')
        .then(r => r.json())
        .then(data => {
            mapState.data = data;

            const worldName = document.getElementById('mapWorldName');
            const timeText = document.getElementById('mapTimeText');
            const weatherText = document.getElementById('mapWeatherText');
            const playerCount = document.getElementById('mapPlayerCount');

            if (worldName) worldName.textContent = data.world_name || 'World';
            if (timeText) timeText.textContent = data.time_formatted || 'Day';
            if (weatherText) weatherText.textContent = (data.weather || 'Clear').toUpperCase();
            if (playerCount) playerCount.textContent = data.players.length;

            renderGodsEyePlayerList(data.players);
            renderGodsEyeWaypointList(data.waypoints);

            if (mapState.followPlayerName) {
                const target = data.players.find(p => p.name === mapState.followPlayerName);
                if (target) {
                    mapState.camX += (target.x - mapState.camX) * 0.15;
                    mapState.camZ += (target.z - mapState.camZ) * 0.15;
                }
            }
        })
        .catch(err => console.error("Failed to load map data:", err));
}

function renderGodsEyePlayerList(players) {
    const container = document.getElementById('mapPlayersList');
    if (!container) return;

    if (!players || players.length === 0) {
        container.innerHTML = `<div class="deck-empty-state">No players currently connected.</div>`;
        return;
    }

    container.innerHTML = players.map(p => {
        const isFollowed = mapState.followPlayerName === p.name;
        return `
            <div class="deck-player-item ${isFollowed ? 'selected' : ''}">
                <div>
                    <div style="font-weight:700; font-size:12px; color:#f1f5f9; display:flex; align-items:center; gap:6px;">
                        <span style="color:#10b981;">●</span> ${escapeHtml(p.name)}
                        <span style="font-size:10px; color:var(--zentra-muted); font-weight:normal;">[${escapeHtml(p.gamemode)}]</span>
                    </div>
                    <div style="font-family:'Fira Code',monospace; font-size:11px; color:#38bdf8; margin-top:2px;">
                        X: ${p.x} Y: ${p.y} Z: ${p.z}
                    </div>
                </div>
                <div style="display:flex; gap:4px;">
                    <button class="zentra-btn secondary" style="padding:2px 8px; font-size:10px;" onclick="centerMapOnPlayer('${escapeHtml(p.name)}')">🎯 Focus</button>
                    <button class="zentra-btn secondary" style="padding:2px 8px; font-size:10px;" onclick="quickTeleportPlayerToSpawn('${escapeHtml(p.name)}')">⚡ Spawn</button>
                </div>
            </div>
        `;
    }).join('');
}

function renderGodsEyeWaypointList(waypoints) {
    const container = document.getElementById('mapWaypointsList');
    if (!container) return;

    if (!waypoints || waypoints.length === 0) {
        container.innerHTML = `<div class="deck-empty-state">No waypoints saved yet.</div>`;
        return;
    }

    container.innerHTML = waypoints.map(wp => `
        <div class="deck-waypoint-item" onclick="centerMapOnCoords(${wp.x}, ${wp.z})">
            <div style="display:flex; align-items:center; gap:8px;">
                <span style="font-size:16px;">${wp.icon || '📍'}</span>
                <div>
                    <strong style="font-size:12px; color:#f1f5f9;">${escapeHtml(wp.name)}</strong>
                    <div style="font-family:'Fira Code',monospace; font-size:10px; color:#94a3b8;">X: ${wp.x} • Z: ${wp.z}</div>
                </div>
            </div>
            ${wp.id !== 'spawn' ? `<button class="zentra-btn danger" style="padding:2px 6px; font-size:10px;" onclick="event.stopPropagation(); deleteWaypoint('${wp.id}')">🗑</button>` : ''}
        </div>
    `).join('');
}

function renderGodsEyeFrame() {
    const canvas = document.getElementById('godseyeCanvas');
    if (!canvas || currentTab !== 'map') {
        requestAnimationFrame(renderGodsEyeFrame);
        return;
    }

    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;

    ctx.save();
    ctx.scale(dpr, dpr);

    // Clear background
    ctx.fillStyle = '#060a12';
    ctx.fillRect(0, 0, width, height);

    const centerX = width / 2;
    const centerY = height / 2;
    const zoom = mapState.zoom;
    const camX = mapState.camX;
    const camZ = mapState.camZ;

    function worldToScreen(wx, wz) {
        return {
            x: centerX + (wx - camX) * zoom,
            y: centerY + (wz - camZ) * zoom
        };
    }

    // Procedural Top-Down Biome Topography
    const stepSize = Math.max(32, Math.floor(64 / zoom));
    const startWorldX = Math.floor((camX - centerX / zoom) / stepSize) * stepSize;
    const endWorldX = Math.ceil((camX + centerX / zoom) / stepSize) * stepSize;
    const startWorldZ = Math.floor((camZ - centerY / zoom) / stepSize) * stepSize;
    const endWorldZ = Math.ceil((camZ + centerY / zoom) / stepSize) * stepSize;

    for (let wx = startWorldX; wx <= endWorldX; wx += stepSize) {
        for (let wz = startWorldZ; wz <= endWorldZ; wz += stepSize) {
            const p = worldToScreen(wx, wz);
            const p2 = worldToScreen(wx + stepSize, wz + stepSize);
            const w = p2.x - p.x;
            const h = p2.y - p.y;

            const n = Math.sin(wx * 0.003) * Math.cos(wz * 0.003) + Math.sin(wx * 0.012 + wz * 0.008) * 0.4;
            let biomeColor = '#1e3a1e';

            if (n < -0.35) {
                biomeColor = '#0c2340';
            } else if (n < -0.15) {
                biomeColor = '#1a4b75';
            } else if (n < -0.05) {
                biomeColor = '#c2b280';
            } else if (n < 0.25) {
                biomeColor = '#1f4e24';
            } else if (n < 0.45) {
                biomeColor = '#4a5d4e';
            } else {
                biomeColor = '#d9e2ec';
            }

            ctx.fillStyle = biomeColor;
            ctx.fillRect(p.x, p.y, w + 1, h + 1);
        }
    }

    // 16x16 Chunk Grid Lines
    if (mapState.layers.grid && zoom > 0.4) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
        ctx.lineWidth = 1;

        const chunkStartWX = Math.floor((camX - centerX / zoom) / 16) * 16;
        const chunkEndWX = Math.ceil((camX + centerX / zoom) / 16) * 16;
        const chunkStartWZ = Math.floor((camZ - centerY / zoom) / 16) * 16;
        const chunkEndWZ = Math.ceil((camZ + centerY / zoom) / 16) * 16;

        ctx.beginPath();
        for (let x = chunkStartWX; x <= chunkEndWX; x += 16) {
            const sp = worldToScreen(x, 0);
            ctx.moveTo(sp.x, 0);
            ctx.lineTo(sp.x, height);
        }
        for (let z = chunkStartWZ; z <= chunkEndWZ; z += 16) {
            const sp = worldToScreen(0, z);
            ctx.moveTo(0, sp.y);
            ctx.lineTo(width, sp.y);
        }
        ctx.stroke();
    }

    // Concentric Range Distance Rings
    if (mapState.layers.rings) {
        const spawnScr = worldToScreen(0, 0);
        const ranges = [100, 250, 500, 1000];
        ctx.lineWidth = 1;

        ranges.forEach(r => {
            const radiusPx = r * zoom;
            if (radiusPx > 10 && radiusPx < Math.max(width, height) * 2) {
                ctx.strokeStyle = 'rgba(56, 189, 248, 0.2)';
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.arc(spawnScr.x, spawnScr.y, radiusPx, 0, Math.PI * 2);
                ctx.stroke();
                ctx.setLineDash([]);

                ctx.fillStyle = 'rgba(56, 189, 248, 0.5)';
                ctx.font = '10px "Fira Code", monospace';
                ctx.fillText(`${r}m`, spawnScr.x + radiusPx + 4, spawnScr.y);
            }
        });
    }

    // Radar Sweep Line
    if (mapState.layers.radar) {
        mapState.radarAngle = (mapState.radarAngle + 0.02) % (Math.PI * 2);
        const sweepCenter = worldToScreen(mapState.camX, mapState.camZ);
        const maxDist = Math.max(width, height);

        const sweepEnd = {
            x: sweepCenter.x + Math.cos(mapState.radarAngle) * maxDist,
            y: sweepCenter.y + Math.sin(mapState.radarAngle) * maxDist
        };

        const grad = ctx.createLinearGradient(sweepCenter.x, sweepCenter.y, sweepEnd.x, sweepEnd.y);
        grad.addColorStop(0, 'rgba(16, 185, 129, 0.4)');
        grad.addColorStop(0.5, 'rgba(16, 185, 129, 0.15)');
        grad.addColorStop(1, 'rgba(16, 185, 129, 0)');

        ctx.strokeStyle = grad;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sweepCenter.x, sweepCenter.y);
        ctx.lineTo(sweepEnd.x, sweepEnd.y);
        ctx.stroke();
    }

    // World Spawn Marker
    const spawnP = worldToScreen(mapState.data.spawn_x || 0, mapState.data.spawn_z || 0);
    ctx.save();
    ctx.fillStyle = '#10b981';
    ctx.shadowColor = '#10b981';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(spawnP.x, spawnP.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('WORLD SPAWN (0,0)', spawnP.x, spawnP.y - 12);

    // Saved Waypoints
    if (mapState.data.waypoints) {
        mapState.data.waypoints.forEach(wp => {
            if (wp.id === 'spawn') return;
            const wpScr = worldToScreen(wp.x, wp.z);

            ctx.font = '16px serif';
            ctx.textAlign = 'center';
            ctx.fillText(wp.icon || '📍', wpScr.x, wpScr.y + 4);

            ctx.fillStyle = '#e2e8f0';
            ctx.font = '600 11px Inter, sans-serif';
            ctx.fillText(wp.name, wpScr.x, wpScr.y - 14);
        });
    }

    // Online Players
    if (mapState.data.players) {
        const now = performance.now();
        mapState.data.players.forEach(p => {
            const pScr = worldToScreen(p.x, p.z);

            const pulse = (now * 0.003) % 1.0;
            ctx.strokeStyle = `rgba(56, 189, 248, ${1.0 - pulse})`;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(pScr.x, pScr.y, 8 + pulse * 18, 0, Math.PI * 2);
            ctx.stroke();

            const yawRad = ((p.yaw || 0) * Math.PI) / 180;
            ctx.fillStyle = 'rgba(56, 189, 248, 0.25)';
            ctx.beginPath();
            ctx.moveTo(pScr.x, pScr.y);
            ctx.arc(pScr.x, pScr.y, 22, yawRad - 0.5, yawRad + 0.5);
            ctx.closePath();
            ctx.fill();

            ctx.save();
            ctx.fillStyle = '#38bdf8';
            ctx.shadowColor = '#38bdf8';
            ctx.shadowBlur = 10;
            ctx.beginPath();
            ctx.arc(pScr.x, pScr.y, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 11px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(p.name, pScr.x, pScr.y - 14);

            ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
            ctx.fillRect(pScr.x - 14, pScr.y - 10, 28, 4);
            ctx.fillStyle = '#ef4444';
            const hpWidth = Math.min(28, (p.health / 20) * 28);
            ctx.fillRect(pScr.x - 14, pScr.y - 10, hpWidth, 4);
        });
    }

    // Animated Lightning Bolt Visual Flashes
    if (mapState.lightningFlashes.length > 0) {
        ctx.strokeStyle = '#ffffff';
        ctx.shadowColor = '#38bdf8';
        ctx.shadowBlur = 20;
        ctx.lineWidth = 3;

        for (let i = mapState.lightningFlashes.length - 1; i >= 0; i--) {
            const bolt = mapState.lightningFlashes[i];
            const bScr = worldToScreen(bolt.x, bolt.z);

            ctx.beginPath();
            ctx.moveTo(bScr.x, bScr.y - 120);
            ctx.lineTo(bScr.x - 10, bScr.y - 80);
            ctx.lineTo(bScr.x + 8, bScr.y - 45);
            ctx.lineTo(bScr.x - 6, bScr.y - 20);
            ctx.lineTo(bScr.x, bScr.y);
            ctx.stroke();

            bolt.framesLeft--;
            if (bolt.framesLeft <= 0) {
                mapState.lightningFlashes.splice(i, 1);
            }
        }
    }

    ctx.restore();
    requestAnimationFrame(renderGodsEyeFrame);
}

function zoomMap(factor) {
    mapState.zoom = Math.max(0.15, Math.min(6.0, mapState.zoom * factor));
}

function resetMapZoom() {
    mapState.zoom = 1.0;
    centerMapOnSpawn();
}

function centerMapOnSpawn() {
    mapState.camX = 0;
    mapState.camZ = 0;
    mapState.followPlayerName = null;
    updateFollowBtnState();
}

function centerMapOnPlayer(name) {
    const p = mapState.data.players.find(x => x.name === name);
    if (p) {
        mapState.camX = p.x;
        mapState.camZ = p.z;
        mapState.followPlayerName = name;
        updateFollowBtnState();
    }
}

function centerMapOnCoords(x, z) {
    mapState.camX = x;
    mapState.camZ = z;
    mapState.followPlayerName = null;
    updateFollowBtnState();
}

function toggleFollowPlayer() {
    if (mapState.followPlayerName) {
        mapState.followPlayerName = null;
    } else if (mapState.data.players.length > 0) {
        mapState.followPlayerName = mapState.data.players[0].name;
    }
    updateFollowBtnState();
}

function updateFollowBtnState() {
    const btn = document.getElementById('btnFollowPlayer');
    if (btn) {
        if (mapState.followPlayerName) {
            btn.classList.add('emerald');
            btn.innerHTML = `👁️ Follow: ${escapeHtml(mapState.followPlayerName)}`;
        } else {
            btn.classList.remove('emerald');
            btn.innerHTML = `👁️ Follow: OFF`;
        }
    }
}

function toggleMapLayer(layer) {
    if (mapState.layers.hasOwnProperty(layer)) {
        mapState.layers[layer] = !mapState.layers[layer];
        const btn = document.getElementById(`ctrl${layer.charAt(0).toUpperCase() + layer.slice(1)}Toggle`);
        if (btn) btn.classList.toggle('active', mapState.layers[layer]);
    }
}

function openMapContextMenu(screenX, screenY, worldX, worldZ) {
    const menu = document.getElementById('mapContextMenu');
    const coordsText = document.getElementById('ctxCoordsText');
    if (!menu) return;

    if (coordsText) coordsText.textContent = `TARGET: X: ${worldX}, Z: ${worldZ}`;
    menu.style.left = `${Math.min(screenX, window.innerWidth - 240)}px`;
    menu.style.top = `${Math.min(screenY, window.innerHeight - 280)}px`;
    menu.style.display = 'block';
}

function closeMapContextMenu() {
    const menu = document.getElementById('mapContextMenu');
    if (menu) menu.style.display = 'none';
}

function executeMapContextAction(action) {
    const { x, z } = mapState.contextCoords;
    closeMapContextMenu();

    let payload = { action, x, z };

    if (action === 'teleport') {
        const player = mapState.followPlayerName || (mapState.data.players.length > 0 ? mapState.data.players[0].name : prompt("Enter player name to teleport:"));
        if (!player) return;
        payload.player = player;
    } else if (action === 'summon_golem') {
        payload.action = 'summon';
        payload.entity = 'iron_golem';
    } else if (action === 'lightning') {
        mapState.lightningFlashes.push({ x, z, framesLeft: 8 });
    }

    fetch('/api/map/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    .then(r => r.json())
    .then(res => {
        showToast(res.result || `Action ${action} executed`, 'success');
        loadGodsEyeData();
    })
    .catch(err => showToast(`Failed action: ${err}`, 'error'));
}

function quickTeleportPlayerToSpawn(playerName) {
    fetch('/api/map/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'teleport', player: playerName, x: 0, y: 64, z: 0 })
    })
    .then(r => r.json())
    .then(res => {
        showToast(res.result || `Teleported ${playerName} to spawn`, 'success');
        loadGodsEyeData();
    })
    .catch(err => showToast(`Failed: ${err}`, 'error'));
}

function triggerWorldAtmosphere(type, val) {
    fetch('/api/map/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: type, value: val })
    })
    .then(r => r.json())
    .then(res => {
        showToast(res.result || `Updated ${type} to ${val}`, 'success');
        loadGodsEyeData();
    })
    .catch(err => showToast(`Failed: ${err}`, 'error'));
}

function openAddWaypointModal() {
    const modal = document.getElementById('addWaypointModal');
    if (!modal) return;
    const nameInput = document.getElementById('wpNameInput');
    const xInput = document.getElementById('wpXInput');
    const zInput = document.getElementById('wpZInput');
    if (nameInput) nameInput.value = '';
    if (xInput) xInput.value = Math.round(mapState.camX);
    if (zInput) zInput.value = Math.round(mapState.camZ);
    modal.classList.add('active');
}

function openAddWaypointModalAtCursor() {
    closeMapContextMenu();
    const modal = document.getElementById('addWaypointModal');
    if (!modal) return;
    const nameInput = document.getElementById('wpNameInput');
    const xInput = document.getElementById('wpXInput');
    const zInput = document.getElementById('wpZInput');
    if (nameInput) nameInput.value = 'Tactical Marker';
    if (xInput) xInput.value = Math.round(mapState.contextCoords.x);
    if (zInput) zInput.value = Math.round(mapState.contextCoords.z);
    modal.classList.add('active');
}

function selectWaypointIcon(icon, btn) {
    const group = document.getElementById('wpIconGroup');
    const input = document.getElementById('wpSelectedIcon');
    if (group) {
        group.querySelectorAll('.wp-icon-choice-btn').forEach(b => b.classList.remove('active'));
    }
    if (btn) btn.classList.add('active');
    if (input) input.value = icon;
}

function saveNewWaypoint() {
    const name = document.getElementById('wpNameInput').value.trim() || 'Waypoint';
    const x = parseFloat(document.getElementById('wpXInput').value) || 0;
    const z = parseFloat(document.getElementById('wpZInput').value) || 0;
    const icon = document.getElementById('wpSelectedIcon').value || '📍';

    fetch('/api/map/waypoint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, x, z, icon, color: '#10b981' })
    })
    .then(r => r.json())
    .then(wp => {
        showToast(`Waypoint "${name}" pinned to God's Eye!`, 'success');
        closeModal('addWaypointModal');
        loadGodsEyeData();
    })
    .catch(err => showToast(`Failed to save waypoint: ${err}`, 'error'));
}

function deleteWaypoint(id) {
    fetch('/api/map/waypoint/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
    })
    .then(r => r.json())
    .then(() => {
        showToast("Waypoint removed", 'info');
        loadGodsEyeData();
    })
    .catch(err => showToast(`Failed: ${err}`, 'error'));
}

/* =========================================================================
   13. INITIALIZATION (Hash Routing & Font Alignment)
   ========================================================================= */
document.addEventListener('DOMContentLoaded', () => {
    initZentraHalftoneBackground();
    initTerminalKeyboard();
    initTabDragSelector();
    syncServerEditionUI();

    // Determine initial tab from window.location.hash
    let initialTab = 'home';
    if (window.location.hash) {
        const hash = window.location.hash.replace(/^#/, '').trim().toLowerCase();
        if (hash === 'terminal') initialTab = 'console';
        else if (['home', 'map', 'console', 'java', 'worlds', 'players', 'addons', 'properties', 'update', 'settings'].includes(hash)) {
            initialTab = hash;
        }
    }

    switchZentraTab(initialTab);

    // Update tab slider once fonts are loaded for pixel-perfect pill width
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => {
            const activeBtn = document.querySelector(`.nav-tab-btn[data-tab="${currentTab}"]`);
            if (activeBtn) updateTabSlider(activeBtn);
        });
    }

    // Listen for browser back/forward buttons (hashchange)
    window.addEventListener('hashchange', () => {
        let h = window.location.hash.replace(/^#/, '').trim().toLowerCase();
        if (h === 'terminal') h = 'console';
        if (h && h !== currentTab && ['home', 'map', 'console', 'java', 'worlds', 'players', 'addons', 'properties', 'update', 'settings'].includes(h)) {
            switchZentraTab(h);
        }
    });

    loadStatus();
    if (serverEdition === 'bedrock') loadAnnouncements();
    loadProperties();
    pollLifecycleStatus();
    if (currentTab === 'console') {
        fetchLogs();
    } else if (currentTab === 'map') {
        loadGodsEyeData();
    } else if (currentTab === 'java') {
        loadJavaServer();
        loadLatestPaper();
        pollPaperUpdateStatus();
    }

    initGameMasterArsenal();
    updateBroadcastPreview();

    // Polling loop for status, lifecycle countdown & logs
    setInterval(() => {
        loadStatus();
        pollLifecycleStatus();
        if (currentTab === 'console') {
            fetchLogs();
        } else if (currentTab === 'map') {
            loadGodsEyeData();
        } else if (currentTab === 'java') {
            loadJavaServer();
        }
    }, pollInterval);
});

/* =========================================================================
   13. IN-GAME BROADCASTER & GAME MASTER ARSENAL
   ========================================================================= */
let _currentBroadcastType = 'chat';
let _currentDispenseAmount = 1;

const ARSENAL_ITEMS = [
    { id: 'netherite_sword', name: 'Netherite Sword', icon: '⚔️', rarity: 'mythic' },
    { id: 'netherite_pickaxe', name: 'Netherite Pickaxe', icon: '⛏️', rarity: 'mythic' },
    { id: 'netherite_axe', name: 'Netherite Axe', icon: '🪓', rarity: 'mythic' },
    { id: 'netherite_chestplate', name: 'Netherite Armor', icon: '🛡️', rarity: 'mythic' },
    { id: 'elytra', name: 'Elytra Wings', icon: '🪽', rarity: 'legendary' },
    { id: 'firework_rocket', name: 'Rockets x64', icon: '🎆', rarity: 'epic', defaultAmt: 64 },
    { id: 'enchanted_golden_apple', name: 'God Apple', icon: '🍏', rarity: 'mythic' },
    { id: 'totem_of_undying', name: 'Totem Undying', icon: '🧿', rarity: 'legendary' },
    { id: 'diamond', name: 'Diamond Gem', icon: '💎', rarity: 'rare' },
    { id: 'ender_pearl', name: 'Ender Pearl x16', icon: '🔮', rarity: 'epic', defaultAmt: 16 },
    { id: 'tnt', name: 'TNT Block', icon: '🧨', rarity: 'epic' },
    { id: 'cooked_beef', name: 'Cooked Steak', icon: '🥩', rarity: 'rare' },
    { id: 'bow', name: 'Master Bow', icon: '🏹', rarity: 'epic' },
    { id: 'arrow', name: 'Arrows x64', icon: '🎯', rarity: 'rare', defaultAmt: 64 },
    { id: 'wind_charge', name: 'Wind Charge', icon: '💨', rarity: 'legendary' },
    { id: 'mace', name: 'Heavy Mace', icon: '🔨', rarity: 'mythic' }
];

function initGameMasterArsenal() {
    const grid = document.getElementById('mcArsenalGrid');
    if (!grid) return;

    grid.innerHTML = ARSENAL_ITEMS.map(item => `
        <div class="mc-slot ${item.rarity}" onclick="dispenseItem('${item.id}', 'give', ${item.defaultAmt || _currentDispenseAmount})">
            <div class="mc-slot-icon-row">
                <span class="mc-slot-icon">${item.icon}</span>
                <span style="font-size:10px; font-weight:700; opacity:0.6; text-transform:uppercase;">${item.rarity}</span>
            </div>
            <div class="mc-slot-name">${escapeHtml(item.name)}</div>
            <div class="mc-slot-actions" onclick="event.stopPropagation()">
                <button type="button" class="mc-slot-btn give" onclick="dispenseItem('${item.id}', 'give', ${item.defaultAmt || _currentDispenseAmount})">+ Give</button>
                <button type="button" class="mc-slot-btn clear" onclick="dispenseItem('${item.id}', 'clear_item', ${item.defaultAmt || _currentDispenseAmount})">- Clear</button>
            </div>
        </div>
    `).join('');
}

function updatePlayerDropdowns(players) {
    const bcSelect = document.getElementById('bcTargetPlayer');
    const gmSelect = document.getElementById('gmTargetPlayer');
    if (!bcSelect || !gmSelect) return;

    const bcVal = bcSelect.value || '@a';
    const gmVal = gmSelect.value || '@a';

    const opts = ['<option value="@a">👥 @a - All Players</option>'];
    players.forEach(p => {
        opts.push(`<option value="${escapeHtml(p.name)}">🎮 ${escapeHtml(p.name)} (${p.status})</option>`);
    });

    const optHtml = opts.join('');
    bcSelect.innerHTML = optHtml;
    gmSelect.innerHTML = optHtml;

    if (Array.from(bcSelect.options).some(o => o.value === bcVal)) bcSelect.value = bcVal;
    if (Array.from(gmSelect.options).some(o => o.value === gmVal)) gmSelect.value = gmVal;
}

function selectGmPlayer(playerName) {
    const gmSelect = document.getElementById('gmTargetPlayer');
    if (gmSelect) {
        gmSelect.value = playerName;
    }
    const card = document.getElementById('gmArsenalCard');
    if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.style.outline = '3px solid #f59e0b';
        setTimeout(() => { card.style.outline = 'none'; }, 1500);
    }
    showToast(`Operator controls focused on ${playerName}`, 'info');
}

function syncGmTarget(val) {
    // optional sync
}

/* Broadcaster functions */
function setBroadcastType(type) {
    _currentBroadcastType = type;
    document.querySelectorAll('.bc-type-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.type === type);
    });

    const subGroup = document.getElementById('bcSubtitleGroup');
    if (subGroup) {
        subGroup.style.display = (type === 'title') ? 'block' : 'none';
    }

    const modeLabel = document.getElementById('previewModeLabel');
    if (modeLabel) modeLabel.textContent = type.toUpperCase();

    updateBroadcastPreview();
}

function insertColorCode(code) {
    const input = document.getElementById('bcMessageInput');
    if (!input) return;

    const start = input.selectionStart || input.value.length;
    const end = input.selectionEnd || input.value.length;
    const val = input.value;
    input.value = val.substring(0, start) + code + val.substring(end);
    input.focus();
    input.selectionStart = input.selectionEnd = start + code.length;
    updateBroadcastPreview();
}

function applyBroadcastPreset(key) {
    const input = document.getElementById('bcMessageInput');
    const subInput = document.getElementById('bcSubtitleInput');
    const soundSelect = document.getElementById('bcSoundEffect');

    switch (key) {
        case 'welcome':
            setBroadcastType('title');
            if (input) input.value = "§bWelcome to §eLALALAND§b!";
            if (subInput) subInput.value = "§aHave fun and respect the community rules!";
            if (soundSelect) soundSelect.value = "levelup";
            break;
        case 'restart':
            setBroadcastType('title');
            if (input) input.value = "§c⚠ SERVER RESTART IN 5M ⚠";
            if (subInput) subInput.value = "§ePlease finish your trades and save!";
            if (soundSelect) soundSelect.value = "thunder";
            break;
        case 'pvp':
            setBroadcastType('title');
            if (input) input.value = "§6⚔ PVP ARENA EVENT ⚔";
            if (subInput) subInput.value = "§fStarting now at World Spawn coordinates!";
            if (soundSelect) soundSelect.value = "totem";
            break;
        case 'night':
            setBroadcastType('actionbar');
            if (input) input.value = "§9🌙 Night has fallen! Beware of monsters!";
            if (soundSelect) soundSelect.value = "orb";
            break;
        case 'rules':
            setBroadcastType('chat');
            if (input) input.value = "§e[Server Rules] §7No griefing, no hacked clients, keep chat civil. Have fun!";
            if (soundSelect) soundSelect.value = "none";
            break;
    }
    updateBroadcastPreview();
}

function updateBroadcastPreview() {
    const msg = (document.getElementById('bcMessageInput')?.value || '').trim();
    const sub = (document.getElementById('bcSubtitleInput')?.value || '').trim();

    const titleBox = document.getElementById('previewTitleDisplay');
    const chatBox = document.getElementById('previewChatDisplay');
    const actionbarBox = document.getElementById('previewActionbarDisplay');

    if (!titleBox || !chatBox || !actionbarBox) return;

    titleBox.style.display = 'none';
    chatBox.style.display = 'none';
    actionbarBox.style.display = 'none';

    if (_currentBroadcastType === 'title') {
        titleBox.style.display = 'block';
        const mainEl = document.getElementById('previewMainTitle');
        const subEl = document.getElementById('previewSubTitle');
        if (mainEl) mainEl.innerHTML = parseMinecraftColorCodes(msg || "TITLE BANNER");
        if (subEl) subEl.innerHTML = parseMinecraftColorCodes(sub || "Subtitle text here");
    } else if (_currentBroadcastType === 'actionbar') {
        actionbarBox.style.display = 'block';
        const actEl = document.getElementById('previewActionbarMsg');
        if (actEl) actEl.innerHTML = parseMinecraftColorCodes(msg || "Actionbar toast notification");
    } else {
        // chat or whisper
        chatBox.style.display = 'block';
        const chatMsgEl = document.getElementById('previewChatMsg');
        if (chatMsgEl) chatMsgEl.innerHTML = parseMinecraftColorCodes(msg || "Welcome to the server!");
    }
}

function dispatchCustomBroadcast() {
    const input = document.getElementById('bcMessageInput');
    const msg = input ? input.value.trim() : '';
    if (!msg) return showToast("Enter a message to broadcast", "error");

    const target = document.getElementById('bcTargetPlayer')?.value || '@a';
    const sound = document.getElementById('bcSoundEffect')?.value || 'none';
    const sub = document.getElementById('bcSubtitleInput')?.value.trim() || undefined;

    const payload = {
        message: msg,
        broadcast_type: _currentBroadcastType,
        target_player: target === '@a' ? null : target,
        subtitle: (_currentBroadcastType === 'title' && sub) ? sub : null,
        sound: sound === 'none' ? null : sound
    };

    showToast("Broadcasting message in-game...", "info");
    fetch('/api/broadcast/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    .then(r => r.json())
    .then(data => {
        showToast(data.result || "Broadcast sent!", "success");
        if (input) input.value = '';
        const subInput = document.getElementById('bcSubtitleInput');
        if (subInput) subInput.value = '';
        updateBroadcastPreview();
    })
    .catch(err => showToast(`Broadcast failed: ${err}`, "error"));
}

/* Game Master Arsenal & Controls */
function setItemDispenseAmount(amt, btn) {
    _currentDispenseAmount = amt;
    document.querySelectorAll('.amount-pill-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    initGameMasterArsenal();
}

function dispenseItem(itemId, action, amount) {
    const target = document.getElementById('gmTargetPlayer')?.value || '@a';
    const amt = amount || _currentDispenseAmount || 1;

    showToast(`Sending ${action} for ${amt}x ${itemId}...`, "info");
    fetch('/api/player/gamemaster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            player: target,
            action: action, // "give" or "clear_item"
            item: itemId,
            amount: amt
        })
    })
    .then(r => r.json())
    .then(data => {
        showToast(data.result || "Action executed", "success");
    })
    .catch(err => showToast(`Action failed: ${err}`, "error"));
}

function dispenseCustomItem(action) {
    const itemId = document.getElementById('gmCustomItemId')?.value.trim();
    if (!itemId) return showToast("Enter an item ID (e.g. mace, breeze_rod)", "error");
    const amt = parseInt(document.getElementById('gmCustomItemAmt')?.value, 10) || 1;
    dispenseItem(itemId, action === 'give' ? 'give' : 'clear_item', amt);
}

function clearPlayerInventoryConfirm() {
    const target = document.getElementById('gmTargetPlayer')?.value || '@a';
    if (!confirm(`Are you sure you want to completely clear the inventory of '${target}'?`)) return;

    fetch('/api/player/gamemaster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            player: target,
            action: 'clear_all'
        })
    })
    .then(r => r.json())
    .then(data => showToast(data.result || "Inventory cleared", "success"))
    .catch(err => showToast(`Clear failed: ${err}`, "error"));
}

/* XP & Level Scrubber */
function updateGmLevelInput(val) {
    const input = document.getElementById('gmLevelInput');
    const badge = document.getElementById('mcLevelDisplay');
    const bar = document.getElementById('mcXpBarFill');
    if (input) input.value = val;
    if (badge) badge.textContent = val;
    if (bar) bar.style.width = `${Math.min(100, Math.max(5, (val % 30) / 30 * 100))}%`;
}

function updateGmLevelSlider(val) {
    const slider = document.getElementById('gmLevelSlider');
    const badge = document.getElementById('mcLevelDisplay');
    const bar = document.getElementById('mcXpBarFill');
    const num = parseInt(val, 10) || 0;
    if (slider) slider.value = Math.min(100, num);
    if (badge) badge.textContent = num;
    if (bar) bar.style.width = `${Math.min(100, Math.max(5, (num % 30) / 30 * 100))}%`;
}

function applyGmLevel() {
    const val = parseInt(document.getElementById('gmLevelInput')?.value, 10) || 0;
    setGmLevelDirect(val);
}

function setGmLevelDirect(lvl) {
    const target = document.getElementById('gmTargetPlayer')?.value || '@a';
    updateGmLevelInput(lvl);

    showToast(`Setting ${target}'s level to ${lvl}...`, "info");
    fetch('/api/player/gamemaster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            player: target,
            action: 'set_level',
            level: lvl
        })
    })
    .then(r => r.json())
    .then(data => showToast(data.result || `Level set to ${lvl}`, "success"))
    .catch(err => showToast(`Failed to set level: ${err}`, "error"));
}

function addGmXp(lvl) {
    const target = document.getElementById('gmTargetPlayer')?.value || '@a';
    showToast(`Adding ${lvl} levels to ${target}...`, "info");

    fetch('/api/player/gamemaster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            player: target,
            action: 'add_xp',
            level: lvl
        })
    })
    .then(r => r.json())
    .then(data => {
        showToast(data.result || `Added ${lvl} levels`, "success");
        const cur = parseInt(document.getElementById('gmLevelInput')?.value, 10) || 0;
        updateGmLevelInput(cur + lvl);
    })
    .catch(err => showToast(`Failed to add XP: ${err}`, "error"));
}

/* God Mode Spells & Trolls */
function castGmSpell(spellKey) {
    const target = document.getElementById('gmTargetPlayer')?.value || '@a';

    let action = spellKey;
    let effect = null;
    let duration = 30;
    let amplifier = 1;

    if (spellKey === 'speed') {
        action = 'effect';
        effect = 'speed';
        duration = 30;
        amplifier = 10;
    }

    showToast(`Casting ${spellKey} on ${target}...`, "info");
    fetch('/api/player/gamemaster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            player: target,
            action: action,
            effect: effect,
            duration: duration,
            amplifier: amplifier
        })
    })
    .then(r => r.json())
    .then(data => showToast(data.result || `Spell cast on ${target}`, "success"))
    .catch(err => showToast(`Spell failed: ${err}`, "error"));
}