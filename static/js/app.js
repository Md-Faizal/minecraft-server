let playersInterval = null;
    let playersSecTimer = null;

    // Tab controller
    function showTab(tabId) {
        document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
        document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
        
        document.getElementById('tab' + tabId.charAt(0).toUpperCase() + tabId.slice(1)).style.display = 'block';
        document.getElementById('tab' + tabId.charAt(0).toUpperCase() + tabId.slice(1) + 'Btn').classList.add('active');

        // Stop polling by default when leaving tabs
        if (tabId !== 'console') stopConsolePolling();
        if (tabId !== 'players') stopPlayersPolling();

        // Populate tabs
        if (tabId === 'home') refreshStatus();
        if (tabId === 'worlds') loadWorlds();
        if (tabId === 'players') startPlayersPolling();
        if (tabId === 'addons') loadAddons();
        if (tabId === 'properties') loadProperties();
        if (tabId === 'console') startConsolePolling();
        if (tabId === 'update') checkVersion();
        if (tabId === 'settings') loadSettings();
    }

    // Modal helpers
    function openModal(id) { document.getElementById(id).style.display = 'flex'; }
    function closeModal(id) { document.getElementById(id).style.display = 'none'; }

    // Home status
    function refreshStatus() {
        fetch('/api/status').then(r => r.json()).then(data => {
            document.getElementById('statusActiveWorld').textContent = "Active World: " + (data.active_world || 'None');
            let badge = document.getElementById('statusBadge');
            let text = document.getElementById('statusText');
            if (data.server_running) {
                badge.className = 'status-badge online';
                text.textContent = 'ONLINE';
            } else {
                badge.className = 'status-badge offline';
                text.textContent = 'OFFLINE';
            }
        });
    }

    function serverAction(action) {
        fetch('/api/' + action, {method: 'POST'}).then(r => r.json()).then(res => {
            setTimeout(refreshStatus, 1500);
        });
    }

    // Console Logs
    let consoleInterval = null;
    function startConsolePolling() {
        updateConsole();
        consoleInterval = setInterval(updateConsole, 2000);
    }
    function stopConsolePolling() {
        if (consoleInterval) clearInterval(consoleInterval);
    }
    function updateConsole() {
        fetch('/api/server_output').then(r => r.text()).then(logs => {
            let el = document.getElementById('terminalLogs');
            el.textContent = logs || 'Terminal is active. No logs generated yet.';
            el.scrollTop = el.scrollHeight;
        });
    }

    function sendConsoleCommand(inputId) {
        let input = document.getElementById(inputId);
        let cmd = input.value.trim();
        if (!cmd) return;
        fetch('/api/command', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({command: cmd})
        }).then(r => r.json()).then(res => {
            input.value = '';
            if (inputId === 'homeCmdInput') {
                let msg = document.getElementById('homeCmdMsg');
                msg.textContent = 'Command sent: ' + cmd;
                msg.className = 'msg-alert success';
                msg.style.display = 'block';
                setTimeout(() => msg.style.display = 'none', 3000);
            } else {
                updateConsole();
            }
        });
    }

    // Worlds Tab
    function loadWorlds() {
        fetch('/api/worlds').then(r => r.json()).then(data => {
            let html = '';
            if (data.worlds && data.worlds.length) {
                html = '<ul class="item-list">';
                data.worlds.forEach(w => {
                    let isActive = w === data.active_world;
                    html += `<li>
                        <div>
                            <strong style="font-size:1.05em;">${w}</strong>
                            ${isActive ? '<span style="color:var(--success); margin-left:8px; font-size:0.8em; font-weight:600;">ACTIVE</span>' : ''}
                        </div>
                        <div style="display:flex; gap:8px;">
                            ${!isActive ? `<button style="background:var(--success); padding:6px 12px; font-size:0.85em; width:auto; margin:0;" onclick="setActiveWorld('${w}')">Activate</button>` : ''}
                            <button style="background:var(--primary); padding:6px 12px; font-size:0.85em; width:auto; margin:0;" onclick="loadBackups('${w}')">Backups</button>
                            <button style="background:var(--danger); padding:6px 12px; font-size:0.85em; width:auto; margin:0;" onclick="deleteWorld('${w}')">Delete</button>
                        </div>
                    </li>`;
                });
                html += '</ul>';
            } else {
                html = '<p style="color:var(--text-muted);">No worlds found on the server.</p>';
            }
            document.getElementById('worldsList').innerHTML = html;
        });
    }

    function setActiveWorld(name) {
        fetch('/api/set_active_world', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({world: name})
        }).then(r => r.json()).then(res => {
            loadWorlds();
        });
    }

    function createWorld() {
        let name = document.getElementById('newWorldName').value.trim();
        let seed = document.getElementById('newWorldSeed').value.trim();
        if (!name) return;
        fetch('/api/worlds/create', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({name: name, seed: seed})
        }).then(r => r.json()).then(res => {
            closeModal('createWorldModal');
            loadWorlds();
        });
    }

    function deleteWorld(name) {
        if (!confirm(`Are you absolutely sure you want to permanently delete world '${name}'? This cannot be undone.`)) return;
        fetch('/api/worlds/delete', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({world: name})
        }).then(r => r.json()).then(res => {
            loadWorlds();
        });
    }

    function loadBackups(worldName) {
        document.getElementById('worldBackupsCard').style.display = 'block';
        fetch('/api/list_backups?world=' + encodeURIComponent(worldName)).then(r => r.json()).then(data => {
            let html = `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                <h4 style="color:var(--text-muted);">World: ${worldName}</h4>
                <button class="action-btn start" style="padding:6px 12px; font-size:0.8em; width:auto; margin:0;" onclick="createBackup('${worldName}')">Create Backup Now</button>
            </div>`;
            if (data.backups && data.backups.length) {
                html += '<ul class="item-list">';
                data.backups.forEach(b => {
                    html += `<li>
                        <div>
                            <strong>${b.filename}</strong>
                            <div style="font-size:0.8em; color:var(--text-muted); margin-top:2px;">Size: ${b.size} | Date: ${b.date}</div>
                        </div>
                    </li>`;
                });
                html += '</ul>';
            } else {
                html += '<p style="color:var(--text-muted);">No backups exist for this world.</p>';
            }
            document.getElementById('backupsList').innerHTML = html;
        });
    }

    function createBackup(worldName) {
        fetch('/api/backup_world', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({world: worldName})
        }).then(r => r.json()).then(res => {
            loadBackups(worldName);
        });
    }

    // Players Tab
    function startPlayersPolling() {
        loadPlayers();
        loadCheatsStatus();
        loadAllowlist();
        if (playersInterval) clearInterval(playersInterval);
        playersInterval = setInterval(loadPlayers, 3000);

        if (playersSecTimer) clearInterval(playersSecTimer);
        playersSecTimer = setInterval(tickPlayersTimers, 1000);
    }

    function stopPlayersPolling() {
        if (playersInterval) clearInterval(playersInterval);
        if (playersSecTimer) clearInterval(playersSecTimer);
    }

    function tickPlayersTimers() {
        document.querySelectorAll('.ticking-duration').forEach(el => {
            let status = el.getAttribute('data-status');
            let timeStr = el.getAttribute('data-time');
            if (!timeStr || timeStr === '-') return;

            // Parse timestamp as local time (no timezone conversion)
            let targetDt = new Date(timeStr.replace(' ', 'T'));
            if (isNaN(targetDt.getTime())) return;

            let diffSec = Math.floor(Math.abs(new Date() - targetDt) / 1000);
            
            if (status === 'online') {
                el.textContent = `Online for: ${formatDuration(diffSec)}`;
            } else {
                el.textContent = `Offline for: ${formatDuration(diffSec)}`;
            }
        });
    }

    function formatDuration(sec) {
        if (sec < 60) return sec + "s";
        let min = Math.floor(sec / 60);
        let s = sec % 60;
        if (min < 60) return `${min}m ${s}s`;
        let hr = Math.floor(min / 60);
        let m = min % 60;
        if (hr < 24) return `${hr}h ${m}m`;
        let d = Math.floor(hr / 24);
        let h = hr % 24;
        return `${d}d ${h}h`;
    }

    function loadPlayers() {
        fetch('/api/players').then(r => r.json()).then(data => {
            let html = '';
            if (data.players && data.players.length) {
                html = `<div style="margin-bottom:12px; font-size:0.85em; color:var(--text-muted); display:grid; grid-template-columns: 1.2fr 1.5fr 1fr auto; padding:0 16px;">
                    <div>Gamertag</div>
                    <div>Status</div>
                    <div>Permissions</div>
                    <div>Actions</div>
                </div>`;
                data.players.forEach(p => {
                    let isOnline = p.status === 'Online';
                    let timeAttribute = isOnline ? p.session_start : p.last_seen;
                    let isBanned = p.allowlist_enabled && !p.in_allowlist;
                    
                    html += `<div class="player-row" style="grid-template-columns: 1.2fr 1.5fr 1fr auto;">
                        <div>
                            <strong>${p.name}</strong>
                            ${isBanned ? '<span style="margin-left:6px; font-size:0.72em; background:rgba(231,76,60,0.15); color:var(--danger); border:1px solid rgba(231,76,60,0.3); padding:1px 6px; border-radius:10px; vertical-align:middle;">BANNED</span>' : ''}
                            <div style="font-size:0.75em; color:var(--text-muted); margin-top:2px;">XUID: ${p.xuid || 'None'}</div>
                        </div>
                        <div>
                            <span style="color: ${isOnline ? 'var(--success)' : 'var(--danger)'}; font-weight:600; font-size:0.9em;">${p.status}</span>
                            <div class="ticking-duration" data-status="${isOnline ? 'online' : 'offline'}" data-time="${timeAttribute}" style="font-size:0.75em; color:var(--text-muted); margin-top:2px;">
                                Calculating...
                            </div>
                        </div>
                        <div style="text-transform: capitalize; font-size:0.9em;">${p.level}</div>
                        <div style="display:flex; gap:6px; flex-wrap:wrap;">
                            <button style="background:var(--primary); padding:6px 10px; font-size:0.8em; width:auto; margin:0;" onclick="playerAction('${p.name}', 'promote')">Promote</button>
                            <button style="background:var(--warning); color:#000; padding:6px 10px; font-size:0.8em; width:auto; margin:0;" onclick="playerAction('${p.name}', 'demote')">Demote</button>
                            ${isBanned
                                ? `<button style="background:var(--success); padding:6px 10px; font-size:0.8em; width:auto; margin:0;" onclick="playerAction('${p.name}', 'unban')">Unban</button>`
                                : `<button style="background:var(--danger); padding:6px 10px; font-size:0.8em; width:auto; margin:0;" onclick="confirmBan('${p.name}')">Ban</button>`
                            }
                            <button style="background:rgba(255,255,255,0.08); padding:6px 10px; font-size:0.8em; width:auto; margin:0; border:1px solid var(--border-color);" onclick="viewPlayerHistory('${p.name}')">History</button>
                        </div>
                    </div>`;
                });
            } else {
                html = '<p style="color:var(--text-muted);">No player records found.</p>';
            }
            document.getElementById('playersList').innerHTML = html;
            tickPlayersTimers();
        });
    }

    function confirmBan(name) {
        if (!confirm(`Are you sure you want to ban "${name}"? They will be kicked and removed from the allowlist.`)) return;
        playerAction(name, 'ban');
    }

    function viewPlayerHistory(name) {
        document.getElementById('historyModalTitle').textContent = `${name}'s Session History`;
        let tbody = document.getElementById('historyTableBody');
        tbody.innerHTML = '<tr><td colspan="4" style="padding: 10px; text-align: center; color: var(--text-muted);">Loading...</td></tr>';
        openModal('playerHistoryModal');

        fetch(`/api/player_sessions?player=${encodeURIComponent(name)}`).then(r => r.json()).then(data => {
            let html = '';
            if (data.sessions && data.sessions.length) {
                let reversed = [...data.sessions].reverse();
                reversed.forEach(s => {
                    let start = s.start || '-';
                    let end = s.end || 'Active';
                    let world = s.world || '-';
                    let durStr = '-';
                    if (s.start && s.end) {
                        let diffSec = Math.floor(Math.abs(new Date(s.end.replace(" ", "T")) - new Date(s.start.replace(" ", "T"))) / 1000);
                        durStr = formatDuration(diffSec);
                    }
                    html += `<tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                        <td style="padding: 8px;">${start}</td>
                        <td style="padding: 8px;">${end}</td>
                        <td style="padding: 8px;">${durStr}</td>
                        <td style="padding: 8px; color:var(--primary);">${world}</td>
                    </tr>`;
                });
            } else {
                html = '<tr><td colspan="4" style="padding: 10px; text-align: center; color: var(--text-muted);">No session records found.</td></tr>';
            }
            tbody.innerHTML = html;
        }).catch(err => {
            tbody.innerHTML = '<tr><td colspan="4" style="padding: 10px; text-align: center; color: var(--danger);">Failed to load history.</td></tr>';
        });
    }

    function playerAction(name, action) {
        fetch('/api/player_action', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({player: name, action: action})
        }).then(r => r.json()).then(res => {
            loadPlayers();
            loadAllowlist();
        });
    }

    // Cheat commands
    function loadCheatsStatus() {
        fetch('/api/cheats_status').then(r => r.json()).then(data => {
            let panel = document.getElementById('cheatCommandsPanel');
            let badge = document.getElementById('cheatsStatusBadge');
            let worldLabel = document.getElementById('cheatsWorldLabel');
            
            worldLabel.textContent = `World: ${data.active_world || 'None'}`;
            
            if (data.cheats_enabled) {
                badge.innerHTML = ' <span style="color:var(--success); background:rgba(46,204,113,0.1); border:1px solid rgba(46,204,113,0.25); padding:2px 8px; border-radius:10px;">Cheats ON</span>';
                panel.classList.remove('cheats-disabled-overlay');
                panel.querySelectorAll('.cheat-btn, button').forEach(b => b.disabled = false);
            } else {
                badge.innerHTML = ' <span style="color:var(--danger); background:rgba(231,76,60,0.1); border:1px solid rgba(231,76,60,0.25); padding:2px 8px; border-radius:10px;">Cheats OFF</span>';
                panel.classList.add('cheats-disabled-overlay');
                panel.querySelectorAll('.cheat-btn, button').forEach(b => b.disabled = true);
            }
        });
    }

    function sendCheatCmd(type) {
        let cmd = '';
        if (type === 'give') {
            let p = document.getElementById('give_player').value.trim();
            let item = document.getElementById('give_item').value.trim();
            let amt = document.getElementById('give_amount').value || 1;
            if (!p || !item) return showCheatMsg('Fill in player name and item.', 'error');
            cmd = `give ${p} ${item} ${amt}`;
        } else if (type === 'tp') {
            let p = document.getElementById('tp_player').value.trim();
            let x = document.getElementById('tp_x').value.trim();
            let y = document.getElementById('tp_y').value.trim();
            let z = document.getElementById('tp_z').value.trim();
            if (!p || !x || !y || !z) return showCheatMsg('Fill in player name and coordinates.', 'error');
            cmd = `tp ${p} ${x} ${y} ${z}`;
        } else if (type === 'kill') {
            let p = document.getElementById('kill_player').value.trim();
            if (!p) return showCheatMsg('Fill in player name or @a.', 'error');
            cmd = `kill ${p}`;
        } else if (type === 'effect') {
            let p = document.getElementById('effect_player').value.trim();
            let eff = document.getElementById('effect_name').value.trim();
            let dur = document.getElementById('effect_duration').value || 30;
            let lvl = document.getElementById('effect_level').value || 1;
            if (!p || !eff) return showCheatMsg('Fill in player name and effect.', 'error');
            cmd = `effect ${p} ${eff} ${dur} ${lvl}`;
        }
        sendRawCmd(cmd);
    }

    function sendRawCmd(cmd) {
        fetch('/api/player_command', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({command: cmd})
        }).then(r => r.json()).then(res => {
            showCheatMsg(res.result, res.result.includes('failed') || res.result.includes('not') ? 'error' : 'success');
        }).catch(err => showCheatMsg('Failed to send command.', 'error'));
    }

    function showCheatMsg(text, type) {
        let msg = document.getElementById('cheatCmdMsg');
        msg.textContent = text;
        msg.className = `msg-alert ${type}`;
        msg.style.display = 'block';
        setTimeout(() => msg.style.display = 'none', 4000);
    }

    // Allowlist
    function loadAllowlist() {
        fetch('/api/allowlist').then(r => r.json()).then(data => {
            let container = document.getElementById('allowlistContainer');
            let list = data.allowlist || [];
            if (!list.length) {
                container.innerHTML = '<p style="color:var(--text-muted);">No entries in allowlist.json.</p>';
                return;
            }
            let html = '<ul class="item-list">';
            list.forEach(e => {
                html += `<li>
                    <div>
                        <strong>${e.name || 'Unknown'}</strong>
                        <div style="font-size:0.75em; color:var(--text-muted); margin-top:2px;">XUID: ${e.xuid || 'N/A'}</div>
                    </div>
                    <div style="display:flex; gap:6px;">
                        <button style="background:var(--danger); padding:5px 10px; font-size:0.8em; width:auto; margin:0;" onclick="playerAction('${e.name}', 'ban')">Remove</button>
                    </div>
                </li>`;
            });
            html += '</ul>';
            container.innerHTML = html;
        });
    }

    // Addons Tab
    function loadAddons() {
        fetch('/api/addons').then(r => r.json()).then(data => {
            // Populate behavior packs
            let bHtml = '';
            if (data.behavior_packs && data.behavior_packs.length) {
                data.behavior_packs.forEach(p => {
                    let applied = data.applied_behavior.some(ab => ab.pack_id === p.uuid);
                    bHtml += `<div style="margin-bottom:8px;"><label><input type="checkbox" name="behaviorPack" value="${p.folder}" ${applied?'checked':''}> ${p.name}</label></div>`;
                });
            } else {
                bHtml = '<p style="color:var(--text-muted);">No behavior packs installed.</p>';
            }
            document.getElementById('behaviorPacksList').innerHTML = bHtml;

            // Populate resource packs
            let rHtml = '';
            if (data.resource_packs && data.resource_packs.length) {
                data.resource_packs.forEach(p => {
                    let applied = data.applied_resource.some(ar => ar.pack_id === p.uuid);
                    rHtml += `<div style="margin-bottom:8px;"><label><input type="checkbox" name="resourcePack" value="${p.folder}" ${applied?'checked':''}> ${p.name}</label></div>`;
                });
            } else {
                rHtml = '<p style="color:var(--text-muted);">No resource packs installed.</p>';
            }
            document.getElementById('resourcePacksList').innerHTML = rHtml;
        });
    }

    function uploadAddonFile(file) {
        if (!file) return;
        let formData = new FormData();
        formData.append("file", file);
        let msg = document.getElementById('uploadMsg');
        msg.textContent = 'Uploading addon package...';
        msg.className = 'msg-alert success';
        msg.style.display = 'block';

        fetch('/api/addons/upload', {
            method: 'POST',
            body: formData
        }).then(r => r.json()).then(res => {
            msg.textContent = res.result;
            loadAddons();
            setTimeout(() => msg.style.display = 'none', 5000);
        }).catch(err => {
            msg.textContent = 'Upload failed.';
            msg.className = 'msg-alert error';
        });
    }

    function applyAddonsToWorld() {
        let bSelected = Array.from(document.querySelectorAll('input[name="behaviorPack"]:checked')).map(el => el.value);
        let rSelected = Array.from(document.querySelectorAll('input[name="resourcePack"]:checked')).map(el => el.value);
        
        let msg = document.getElementById('addonApplyMsg');
        fetch('/api/addons/apply', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({behavior_packs: bSelected, resource_packs: rSelected})
        }).then(r => r.json()).then(res => {
            msg.textContent = res.result;
            msg.className = 'msg-alert success';
            msg.style.display = 'block';
            setTimeout(() => msg.style.display = 'none', 3000);
        });
    }

    // Drag & Drop Setup (Addons)
    let zone = document.getElementById('uploadZone');
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', e => {
        e.preventDefault();
        zone.classList.remove('dragover');
        uploadAddonFile(e.dataTransfer.files[0]);
    });

    // Drag & Drop Setup (Worlds)
    function uploadWorldFile(file) {
        if (!file) return;
        let formData = new FormData();
        formData.append("file", file);
        let msg = document.getElementById('worldUploadMsg');
        msg.textContent = 'Importing world archive (this may take a few moments)...';
        msg.className = 'msg-alert success';
        msg.style.display = 'block';

        fetch('/api/worlds/upload', {
            method: 'POST',
            body: formData
        }).then(r => r.json()).then(res => {
            msg.textContent = res.result;
            loadWorlds();
            setTimeout(() => msg.style.display = 'none', 5000);
        }).catch(err => {
            msg.textContent = 'Import failed.';
            msg.className = 'msg-alert error';
        });
    }

    let worldZone = document.getElementById('worldUploadZone');
    worldZone.addEventListener('dragover', e => { e.preventDefault(); worldZone.classList.add('dragover'); });
    worldZone.addEventListener('dragleave', () => worldZone.classList.remove('dragover'));
    worldZone.addEventListener('drop', e => {
        e.preventDefault();
        worldZone.classList.remove('dragover');
        uploadWorldFile(e.dataTransfer.files[0]);
    });

    // Properties Tab
    function loadProperties() {
        fetch('/api/properties').then(r => r.json()).then(data => {
            let html = '';
            if (data.properties) {
                data.properties.forEach(p => {
                    html += `<div class="form-group">
                        <label>${p.label || p.key}</label>`;
                    if (p.type === 'choice') {
                        html += `<select name="${p.key}">`;
                        p.choices.forEach(opt => {
                            html += `<option value="${opt}" ${opt == p.value ? 'selected' : ''}>${opt}</option>`;
                        });
                        html += `</select>`;
                    } else if (p.type === 'bool') {
                        html += `<select name="${p.key}">
                            <option value="true" ${p.value === 'true' || p.value === true ? 'selected' : ''}>true</option>
                            <option value="false" ${p.value === 'false' || p.value === false ? 'selected' : ''}>false</option>
                        </select>`;
                    } else {
                        html += `<input type="${p.type === 'int' || p.type === 'float' ? 'number' : 'text'}" name="${p.key}" value="${p.value || ''}">`;
                    }
                    html += `</div>`;
                });
            }
            document.getElementById('propertiesForm').innerHTML = html;
        });
    }

    function saveProperties() {
        let data = {};
        let form = document.getElementById('propertiesForm');
        let formData = new FormData(form);
        formData.forEach((val, key) => data[key] = val);

        // Include selects since FormData doesn't auto-read disabled or some custom tags, but standard form inputs are fine
        let msg = document.getElementById('propertiesMsg');
        fetch('/api/properties', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(data)
        }).then(r => r.json()).then(res => {
            msg.textContent = res.result + " Restart the server to apply changes.";
            msg.className = 'msg-alert success';
            msg.style.display = 'block';
            setTimeout(() => msg.style.display = 'none', 5000);
        });
    }

    // Version update tab
    let progressInterval = null;

    const SVG_SPINNER = `<svg class="spinner-svg" viewBox="0 0 50 50"><circle class="spinner-circle" cx="25" cy="25" r="20"></circle></svg>`;
    const SVG_CHECK = `<svg class="checkmark-svg" viewBox="0 0 52 52"><circle class="checkmark-circle" cx="26" cy="26" r="25"/><path class="checkmark-check" d="M14.1 27.2l7.1 7.2 16.7-16.8"/></svg>`;
    const SVG_PENDING = `<div style="width:10px; height:10px; border-radius:50%; background:rgba(255,255,255,0.15);"></div>`;

    function checkVersion() {
        fetch('/api/update_status').then(r => r.json()).then(state => {
            if (state.status !== 'idle' && state.status !== 'success' && state.status !== 'failed') {
                showProgressArea();
                startProgressPolling();
                return;
            }

            // Normal check
            document.getElementById('updateStepper').style.display = 'none';
            document.getElementById('updateSuccessCard').style.display = 'none';
            document.getElementById('updateMsg').style.display = 'none';
            document.getElementById('btnTriggerUpdate').style.display = 'none';

            fetch('/api/status').then(r => r.json()).then(data => {
                document.getElementById('currentServerVersion').textContent = data.version || 'Offline / Unknown';
                
                fetch('/api/latest_version_url').then(r => r.json()).then(latest => {
                    if (latest.version) {
                        document.getElementById('latestServerVersion').textContent = latest.version;
                        
                        let msg = document.getElementById('updateMsg');
                        let btn = document.getElementById('btnTriggerUpdate');
                        
                        if (data.version && data.version !== 'Unknown' && data.version !== latest.version) {
                            msg.innerHTML = `<strong>A new server version is available: ${latest.version}</strong> (Current version: ${data.version}).`;
                            msg.className = 'msg-alert warning';
                            msg.style.display = 'block';
                            btn.textContent = `Upgrade Server to ${latest.version}`;
                            btn.style.display = 'block';
                        } else {
                            msg.innerHTML = `Your server is fully up to date! Latest version: ${latest.version}.`;
                            msg.className = 'msg-alert success';
                            msg.style.display = 'block';
                            btn.style.display = 'none';
                        }
                    }
                }).catch(e => {
                    console.log("Failed to fetch latest version info.", e);
                    document.getElementById('latestServerVersion').textContent = 'Error';
                });
            });
        });
    }

    function triggerServerUpdate() {
        if (!confirm("Are you sure you want to upgrade the server? This will stop the server and install the latest Bedrock files.")) return;
        
        let btn = document.getElementById('btnTriggerUpdate');
        btn.style.display = 'none';
        
        showProgressArea();
        
        fetch('/api/update_server', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({})
        }).then(r => r.json()).then(res => {
            startProgressPolling();
        }).catch(err => {
            showError("Failed to initiate update process.");
        });
    }

    function showProgressArea() {
        document.getElementById('updateStepper').style.display = 'flex';
        document.getElementById('updateSuccessCard').style.display = 'none';
        document.getElementById('updateMsg').style.display = 'none';
        document.getElementById('btnTriggerUpdate').style.display = 'none';
        
        // Reset steps
        ['download', 'stopping', 'extracting', 'restarting'].forEach(step => {
            let el = document.getElementById(`stepItem_${step}`);
            el.className = 'step-item pending';
            document.getElementById(`stepIcon_${step}`).innerHTML = SVG_PENDING;
            document.getElementById(`stepConsole_${step}`).style.display = 'none';
        });
    }

    function startProgressPolling() {
        if (progressInterval) clearInterval(progressInterval);
        progressInterval = setInterval(checkUpdateProgress, 800);
    }

    function updateStepUI(stepId, state, message = '') {
        let item = document.getElementById(`stepItem_${stepId}`);
        let icon = document.getElementById(`stepIcon_${stepId}`);
        let consoleDiv = document.getElementById(`stepConsole_${stepId}`);
        let desc = document.getElementById(`stepDesc_${stepId}`);

        if (state === 'completed') {
            item.className = 'step-item completed';
            icon.innerHTML = SVG_CHECK;
            consoleDiv.style.display = 'none';
            desc.textContent = 'Completed.';
        } else if (state === 'active') {
            item.className = 'step-item active';
            icon.innerHTML = SVG_SPINNER;
            desc.textContent = 'Processing...';
            if (message) {
                consoleDiv.style.display = 'block';
                consoleDiv.textContent = message;
            } else {
                consoleDiv.style.display = 'none';
            }
        } else {
            item.className = 'step-item pending';
            icon.innerHTML = SVG_PENDING;
            consoleDiv.style.display = 'none';
            desc.textContent = 'Pending...';
        }
    }

    function checkUpdateProgress() {
        fetch('/api/update_status').then(r => r.json()).then(state => {
            let status = state.status;
            let msg = state.message;
            
            if (status === 'downloading') {
                updateStepUI('download', 'active', msg);
                updateStepUI('stopping', 'pending');
                updateStepUI('extracting', 'pending');
                updateStepUI('restarting', 'pending');
            } else if (status === 'stopping') {
                updateStepUI('download', 'completed');
                updateStepUI('stopping', 'active', msg);
                updateStepUI('extracting', 'pending');
                updateStepUI('restarting', 'pending');
            } else if (status === 'extracting') {
                updateStepUI('download', 'completed');
                updateStepUI('stopping', 'completed');
                updateStepUI('extracting', 'active', msg);
                updateStepUI('restarting', 'pending');
            } else if (status === 'setting_permissions' || status === 'restarting') {
                updateStepUI('download', 'completed');
                updateStepUI('stopping', 'completed');
                updateStepUI('extracting', 'completed');
                updateStepUI('restarting', 'active', msg);
            } else if (status === 'success') {
                clearInterval(progressInterval);
                updateStepUI('download', 'completed');
                updateStepUI('stopping', 'completed');
                updateStepUI('extracting', 'completed');
                updateStepUI('restarting', 'completed');
                
                setTimeout(() => {
                    document.getElementById('updateStepper').style.display = 'none';
                    document.getElementById('updateSuccessCard').style.display = 'block';
                }, 1000);
            } else if (status === 'failed') {
                clearInterval(progressInterval);
                showError(`Update failed! Error: ${state.error}`);
            }
        }).catch(e => {
            clearInterval(progressInterval);
            showError("Connection lost during update monitoring.");
        });
    }

    function showError(errMsg) {
        let msg = document.getElementById('updateMsg');
        msg.textContent = errMsg;
        msg.className = 'msg-alert error';
        msg.style.display = 'block';
        document.getElementById('updateStepper').style.display = 'none';
        document.getElementById('btnTriggerUpdate').style.display = 'block';
    }

    // Settings tab
    function loadSettings() {
        fetch('/api/settings').then(r => r.json()).then(data => {
            document.getElementById('settingAutoStart').value = (data.auto_start || false).toString();
            document.getElementById('settingBackupFreq').value = data.backup_frequency || '1 hour';
            document.getElementById('settingMaxBackups').value = data.max_backups || 10;
        });
    }

    function saveSettings() {
        let autoStart = document.getElementById('settingAutoStart').value === 'true';
        let backupFreq = document.getElementById('settingBackupFreq').value;
        let maxBackups = parseInt(document.getElementById('settingMaxBackups').value) || 0;

        let msg = document.getElementById('settingsMsg');
        fetch('/api/settings', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                auto_start: autoStart,
                backup_frequency: backupFreq,
                max_backups: maxBackups
            })
        }).then(r => r.json()).then(res => {
            msg.textContent = res.result;
            msg.className = 'msg-alert success';
            msg.style.display = 'block';
            setTimeout(() => msg.style.display = 'none', 3000);
        });
    }

    // Initial status check
    refreshStatus();