/**
 * Minecraft Bedrock Server Management Dashboard
 * Zentra Design System & Buffed Remote Terminal Controller
 */

// Global State
let currentTab = 'home';
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

function switchZentraTab(tabName) {
    if (!tabName) return;
    // Map URL aliases
    if (tabName === 'terminal') tabName = 'console';

    currentTab = tabName;
    const allTabs = ['home', 'console', 'worlds', 'players', 'addons', 'properties', 'update', 'settings'];

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

    // Update URL hash without forcing window scroll jump
    const desiredHash = `#${tabName}`;
    if (window.location.hash !== desiredHash) {
        history.replaceState(null, null, desiredHash);
    }

    // Always trigger data load for the activated tab
    if (tabName === 'home') {
        loadStatus();
    } else if (tabName === 'console') {
        fetchLogs();
        setTimeout(() => {
            const screen = document.getElementById('terminalScreen');
            if (screen && autoScroll) screen.scrollTop = screen.scrollHeight;
        }, 60);
    } else if (tabName === 'worlds') {
        loadWorlds();
    } else if (tabName === 'players') {
        loadPlayers();
    } else if (tabName === 'addons') {
        loadAddons();
    } else if (tabName === 'properties') {
        loadProperties();
    } else if (tabName === 'update') {
        checkBdsUpdates();
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
    fetch('/api/server_output')
        .then(r => r.text())
        .then(text => {
            const lines = text.split('\n').filter(l => l.trim().length > 0);
            rawLogsCache = lines;
            renderTerminalLines(lines);
            document.getElementById('termLineCount').textContent = `${lines.length} lines buffered`;
        })
        .catch(err => console.error("Error fetching logs:", err));
}

function renderTerminalLines(lines) {
    const screen = document.getElementById('terminalScreen');
    if (!screen) return;

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
        if (content.includes('Player connected:') || content.includes('Player disconnected:')) {
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
    a.download = `bedrock-server-${new Date().toISOString().slice(0, 10)}.log`;
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

    fetch('/api/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd })
    })
    .then(r => r.json())
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

        const matches = BDS_COMMANDS.filter(c => c.cmd.toLowerCase().startsWith(val) || c.cmd.toLowerCase().includes(val));
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
        .then(r => r.json())
        .then(data => {
            const badge = document.getElementById('navStatusBadge');
            const statusText = document.getElementById('navStatusText');
            const statePill = document.getElementById('homeStatePill');
            const homeActiveWorld = document.getElementById('homeActiveWorld');
            const homeOnlineCount = document.getElementById('homeOnlineCount');
            const homeVersion = document.getElementById('homeVersion');

            const isRunning = data.server_running;
            const activeWorld = data.active_world || 'None';
            const onlineCount = (data.online_players || []).length;
            const ver = data.version || 'Bedrock 1.26+';

            if (homeActiveWorld) homeActiveWorld.textContent = activeWorld;
            if (homeOnlineCount) homeOnlineCount.textContent = `${onlineCount} player${onlineCount === 1 ? '' : 's'}`;
            if (homeVersion) homeVersion.textContent = ver;

            if (isRunning) {
                badge.className = 'status-pill-badge';
                statusText.textContent = `Online (${activeWorld})`;
                if (statePill) {
                    statePill.className = 'metric-pill';
                    statePill.textContent = '● Daemon Active';
                }
            } else {
                badge.className = 'status-pill-badge stopped';
                statusText.textContent = 'Server Stopped';
                if (statePill) {
                    statePill.className = 'metric-pill neutral';
                    statePill.textContent = '○ Stopped';
                }
            }
        })
        .catch(err => console.error("Status fetch error:", err));
}

function serverAction(action) {
    showToast(`Sending ${action} request to BDS daemon...`, 'info');
    fetch(`/api/${action}`, { method: 'POST' })
        .then(r => r.json())
        .then(data => {
            showToast(`Server status: ${data.result || 'OK'}`, 'success');
            setTimeout(loadStatus, 1500);
            setTimeout(fetchLogs, 2000);
        })
        .catch(err => showToast(`Action failed: ${err}`, 'error'));
}

/* =========================================================================
   6. WORLDS MANAGEMENT
   ========================================================================= */
function loadWorlds() {
    const tbody = document.getElementById('worldsTableBody');
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--zentra-muted); padding:16px;"><span class="status-dot-pulse"></span> Loading worlds...</td></tr>`;
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
                tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--zentra-muted); padding:16px;">No worlds found on server.</td></tr>`;
                return;
            }

            tbody.innerHTML = worlds.map(w => {
                const isActive = (w === activeWorld);
                return `
                    <tr>
                        <td style="font-weight:700;">${escapeHtml(w)}</td>
                        <td>
                            ${isActive ? '<span class="metric-pill">Active World</span>' : '<span class="metric-pill neutral">Inactive</span>'}
                        </td>
                        <td>
                            <div style="display:flex; gap:8px;">
                                ${!isActive ? `<button class="zentra-btn emerald" style="padding:4px 10px; font-size:12px;" onclick="setActiveWorld('${escapeHtml(w)}')">Activate</button>` : ''}
                                <button class="zentra-btn secondary" style="padding:4px 10px; font-size:12px;" onclick="backupWorld('${escapeHtml(w)}')">Backup</button>
                                <button class="zentra-btn secondary" style="padding:4px 10px; font-size:12px;" onclick="loadBackups('${escapeHtml(w)}')">Archives</button>
                                ${!isActive ? `<button class="zentra-btn danger" style="padding:4px 10px; font-size:12px;" onclick="deleteWorld('${escapeHtml(w)}')">Delete</button>` : ''}
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
                        <td colspan="3" style="text-align:center; color:var(--zentra-red); padding:16px;">
                            <div>Failed to load worlds (${escapeHtml(err.message || String(err))})</div>
                            <button class="zentra-btn secondary" style="margin-top:8px; padding:4px 12px; font-size:12px;" onclick="loadWorlds()">↻ Retry</button>
                        </td>
                    </tr>
                `;
            }
        });
}

function setActiveWorld(world) {
    if (!confirm(`Switch active world to '${world}'? The server will restart automatically.`)) return;
    showToast(`Activating world '${world}'...`, 'info');
    fetch('/api/set_active_world', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ world: world })
    })
    .then(r => r.json())
    .then(data => {
        showToast(data.result || 'World activated', 'success');
        setTimeout(() => { loadWorlds(); loadStatus(); }, 2000);
    })
    .catch(err => showToast(`Error activating world: ${err}`, 'error'));
}

function submitCreateWorld() {
    const name = document.getElementById('newWorldName').value.trim();
    const seed = document.getElementById('newWorldSeed').value.trim();
    if (!name) return alert("Please specify a world name");

    fetch('/api/worlds/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, seed })
    })
    .then(r => r.json())
    .then(data => {
        showToast(data.result || 'Created', 'success');
        closeModal('createWorldModal');
        loadWorlds();
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
   7. PLAYERS MANAGEMENT
   ========================================================================= */
function loadPlayers() {
    const tbody = document.getElementById('playersTableBody');
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--zentra-muted); padding:16px;"><span class="status-dot-pulse"></span> Loading players...</td></tr>`;
    }

    fetch('/api/players')
        .then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
            return r.json();
        })
        .then(data => {
            const tbody = document.getElementById('playersTableBody');
            if (!tbody) return;
            const players = data.players || [];
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
                            <div style="display:flex; gap:6px;">
                                ${p.in_allowlist 
                                    ? `<button class="zentra-btn danger" style="padding:4px 8px; font-size:11px;" onclick="playerAction('${escapeHtml(p.name)}', 'ban')">Ban</button>`
                                    : `<button class="zentra-btn emerald" style="padding:4px 8px; font-size:11px;" onclick="playerAction('${escapeHtml(p.name)}', 'unban')">Unban</button>`
                                }
                                <button class="zentra-btn secondary" style="padding:4px 8px; font-size:11px;" onclick="playerAction('${escapeHtml(p.name)}', 'promote')">Promote</button>
                                <button class="zentra-btn secondary" style="padding:4px 8px; font-size:11px;" onclick="playerAction('${escapeHtml(p.name)}', 'demote')">Demote</button>
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

    fetch('/api/properties')
        .then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
            return r.json();
        })
        .then(data => {
            const props = data.properties || [];
            _allPropertiesCache = props;
            renderProperties(props);
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

    showToast("Saving properties and updating world config...", "info");
    fetch('/api/properties', {
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

    fetch('/api/update_server', { method: 'POST' })
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
   12. INITIALIZATION (Hash Routing & Font Alignment)
   ========================================================================= */
document.addEventListener('DOMContentLoaded', () => {
    initZentraHalftoneBackground();
    initTerminalKeyboard();
    initTabDragSelector();

    // Determine initial tab from window.location.hash
    let initialTab = 'home';
    if (window.location.hash) {
        const hash = window.location.hash.replace(/^#/, '').trim().toLowerCase();
        if (hash === 'terminal') initialTab = 'console';
        else if (['home', 'console', 'worlds', 'players', 'addons', 'properties', 'update', 'settings'].includes(hash)) {
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
        if (h && h !== currentTab && ['home', 'console', 'worlds', 'players', 'addons', 'properties', 'update', 'settings'].includes(h)) {
            switchZentraTab(h);
        }
    });

    loadStatus();
    if (currentTab === 'console') {
        fetchLogs();
    }

    // Polling loop for status & logs
    setInterval(() => {
        loadStatus();
        if (currentTab === 'console') {
            fetchLogs();
        }
    }, pollInterval);
});