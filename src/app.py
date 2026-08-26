import os
import sys
import time
import json
import re
import zipfile
import shutil
import subprocess
import threading
import requests
from datetime import datetime
from collections import deque
from flask import Flask, jsonify, request, send_from_directory
from werkzeug.utils import secure_filename

class HeadlessMinecraftServerManager:
    def __init__(self, base_dir="/home/ubuntu/minecraft-server"):
        print("Starting Headless MinecraftServerManager...")
        self.base_dir = base_dir
        self.worlds_dir = os.path.join(self.base_dir, "worlds")
        self.backup_dir = os.path.join(self.base_dir, "backups")
        self.server_path = os.path.join(self.base_dir, "bedrock_server")
        self.server_properties = os.path.join(self.base_dir, "server.properties")
        self.resource_packs_dir = os.path.join(self.base_dir, "resource_packs")
        self.behavior_packs_dir = os.path.join(self.base_dir, "behavior_packs")
        
        self.server_process = None
        self.server_output_thread = None
        self.online_players = set()
        self.server_output_lock = threading.Lock()
        
        # Circular buffer to store last 200 lines of server output
        self.backup_output_lines = deque(maxlen=200)
        
        self.player_session_times = {}  # {player: session_start_datetime}
        self.player_history = {}        # {player: {"total": 0, "sessions": [...]}}
        
        # Create directories if missing
        os.makedirs(self.worlds_dir, exist_ok=True)
        os.makedirs(self.backup_dir, exist_ok=True)
        os.makedirs(self.resource_packs_dir, exist_ok=True)
        os.makedirs(self.behavior_packs_dir, exist_ok=True)
        
        # Update progress state
        self.update_state = {
            "status": "idle",
            "progress": 0,
            "message": "",
            "error": ""
        }
        
        # Ensure json files exist
        self.ensure_json_files()
        self.load_player_history()
        
        self.server_start_time = None
        self.server_is_running = False
        self.shutdown_in_progress = False

    def ensure_json_files(self):
        json_dir = os.path.join(self.base_dir, "data")
        os.makedirs(json_dir, exist_ok=True)
        
        global_json = os.path.join(json_dir, "player_list.json")
        if not os.path.exists(global_json):
            with open(global_json, "w", encoding="utf-8") as f:
                json.dump({}, f, indent=2)
                
        hist_json = os.path.join(json_dir, "player_history.json")
        if not os.path.exists(hist_json):
            with open(hist_json, "w", encoding="utf-8") as f:
                json.dump({}, f, indent=2)
                
        settings_json = os.path.join(json_dir, "settings.json")
        if not os.path.exists(settings_json):
            with open(settings_json, "w", encoding="utf-8") as f:
                json.dump({"auto_start": False, "backup_frequency": "1 hour", "max_backups": 10}, f, indent=2)

    def get_global_player_json(self):
        return os.path.join(self.base_dir, "data", "player_list.json")

    def get_player_history_json(self):
        return os.path.join(self.base_dir, "data", "player_history.json")

    def get_settings_json(self):
        return os.path.join(self.base_dir, "data", "settings.json")

    def load_player_history(self):
        hist_path = self.get_player_history_json()
        if os.path.exists(hist_path):
            try:
                with open(hist_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    for player, val in data.items():
                        if isinstance(val, list):
                            self.player_history[player] = {"total": len(val), "sessions": val[-10:]}
                        elif isinstance(val, dict):
                            self.player_history[player] = {
                                "total": val.get("total", len(val.get("sessions", []))),
                                "sessions": val.get("sessions", [])[-10:]
                            }
                        else:
                            self.player_history[player] = {"total": 0, "sessions": []}
            except Exception as e:
                print(f"Error loading player history: {e}")
                self.player_history = {}
        else:
            self.player_history = {}

    def save_player_history(self):
        hist_path = self.get_player_history_json()
        try:
            with open(hist_path, "w", encoding="utf-8") as f:
                json.dump(self.player_history, f, indent=2)
        except Exception as e:
            print(f"Error saving player history: {e}")

    def get_active_world_name(self):
        if os.path.exists(self.server_properties):
            try:
                with open(self.server_properties, 'r', encoding="utf-8") as f:
                    for line in f:
                        if line.startswith("level-name="):
                            return line.strip().split("=", 1)[1]
            except Exception as e:
                print(f"Error reading level-name: {e}")
        return None

    def get_properties_schema(self):
        return [
            {"key": "server-name", "label": "Server Name", "type": "str", "default": "Dedicated Server"},
            {"key": "gamemode", "label": "Game Mode", "type": "choice", "choices": ["survival", "creative", "adventure"], "default": "survival"},
            {"key": "force-gamemode", "label": "Force Gamemode", "type": "bool", "default": False},
            {"key": "difficulty", "label": "Difficulty", "type": "choice", "choices": ["peaceful", "easy", "normal", "hard"], "default": "easy"},
            {"key": "allow-cheats", "label": "Allow Cheats", "type": "bool", "default": False},
            {"key": "max-players", "label": "Max Players", "type": "int", "default": 10},
            {"key": "server-port", "label": "Server Port", "type": "int", "default": 19132},
            {"key": "server-portv6", "label": "Server Port (v6)", "type": "int", "default": 19133},
            {"key": "enable-lan-visibility", "label": "Enable LAN Visibility", "type": "bool", "default": True},
            {"key": "level-name", "label": "Level Name", "type": "str", "default": "Bedrock level"},
            {"key": "level-seed", "label": "Level Seed", "type": "str", "default": ""},
            {"key": "online-mode", "label": "Online Mode", "type": "bool", "default": True},
            {"key": "allow-list", "label": "Allow List", "type": "bool", "default": False},
            {"key": "view-distance", "label": "View Distance", "type": "int", "default": 32},
            {"key": "player-idle-timeout", "label": "Player Idle Timeout", "type": "int", "default": 30},
            {"key": "max-threads", "label": "Max Threads", "type": "int", "default": 8},
            {"key": "tick-distance", "label": "Tick Distance", "type": "int", "default": 4},
            {"key": "default-player-permission-level", "label": "Default Player Permission", "type": "choice", "choices": ["visitor", "member", "operator"], "default": "member"},
            {"key": "texturepack-required", "label": "Texturepack Required", "type": "bool", "default": False},
            {"key": "content-log-file-enabled", "label": "Content Log File Enabled", "type": "bool", "default": False},
            {"key": "compression-threshold", "label": "Compression Threshold", "type": "int", "default": 1},
            {"key": "compression-algorithm", "label": "Compression Algorithm", "type": "choice", "choices": ["zlib", "snappy"], "default": "zlib"},
            {"key": "server-authoritative-movement-strict", "label": "Strict Movement", "type": "bool", "default": False},
            {"key": "server-authoritative-dismount-strict", "label": "Strict Dismount", "type": "bool", "default": False},
            {"key": "server-authoritative-entity-interactions-strict", "label": "Strict Entity Interactions", "type": "bool", "default": False},
            {"key": "player-position-acceptance-threshold", "label": "Position Acceptance Threshold", "type": "float", "default": 0.5},
            {"key": "player-movement-action-direction-threshold", "label": "Movement Action Direction Threshold", "type": "float", "default": 0.85},
            {"key": "server-authoritative-block-breaking", "label": "Server Authoritative Block Breaking", "type": "bool", "default": False},
            {"key": "server-authoritative-block-breaking-pick-range-scalar", "label": "Block Breaking Pick Range Scalar", "type": "float", "default": 1.5},
            {"key": "chat-restriction", "label": "Chat Restriction", "type": "choice", "choices": ["None", "Dropped", "Disabled"], "default": "None"},
            {"key": "disable-player-interaction", "label": "Disable Player Interaction", "type": "bool", "default": False},
            {"key": "client-side-chunk-generation-enabled", "label": "Client-side Chunk Generation Enabled", "type": "bool", "default": True},
            {"key": "block-network-ids-are-hashes", "label": "Block Network IDs Are Hashes", "type": "bool", "default": True},
            {"key": "disable-persona", "label": "Disable Persona", "type": "bool", "default": False},
            {"key": "disable-custom-skins", "label": "Disable Custom Skins", "type": "bool", "default": False},
            {"key": "server-build-radius-ratio", "label": "Server Build Radius Ratio", "type": "str", "default": "Disabled"},
            {"key": "emit-server-telemetry", "label": "Emit Server Telemetry", "type": "bool", "default": True},
        ]

    def get_online_players(self):
        with self.server_output_lock:
            return list(self.online_players)

    def is_server_running(self):
        if self.server_process and self.server_process.poll() is None:
            return True
        try:
            output = subprocess.check_output(["pgrep", "-f", "bedrock_server"]).decode()
            return len(output.strip()) > 0
        except Exception:
            return False

    def start_server(self):
        if self.is_server_running():
            return False
            
        print("Starting Bedrock Dedicated Server...")
        self.ensure_per_world_properties()
        
        env = os.environ.copy()
        env["LD_LIBRARY_PATH"] = os.path.dirname(self.server_path)
        
        self.server_process = subprocess.Popen(
            [self.server_path],
            cwd=os.path.dirname(self.server_path),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            stdin=subprocess.PIPE,
            shell=False,
            universal_newlines=True,
            bufsize=1,
            env=env
        )
        self.server_is_running = True
        self.server_start_time = datetime.now()
        
        self.server_output_thread = threading.Thread(target=self._read_server_output, daemon=True)
        self.server_output_thread.start()
        return True

    def stop_server(self):
        if not self.is_server_running():
            return False
            
        self.send_server_command("stop")
        
        for _ in range(20):
            if not self.is_server_running():
                break
            time.sleep(0.5)
            
        if self.is_server_running():
            try:
                self.server_process.terminate()
                self.server_process.wait(timeout=2)
            except Exception:
                try:
                    self.server_process.kill()
                except Exception:
                    pass
        
        self.server_is_running = False
        with self.server_output_lock:
            self.online_players.clear()
            self.player_session_times.clear()
            
        return True

    def restart_server(self):
        self.stop_server()
        time.sleep(1)
        return self.start_server()

    def graceful_stop_server(self):
        if not self.is_server_running():
            return
            
        def run_sequence():
            try:
                for i in range(5, 0, -1):
                    self.send_server_command(f"say Server stopping in {i} seconds...")
                    time.sleep(1)
                self.stop_server()
            except Exception as e:
                print(f"Error in graceful stop: {e}")
                
        threading.Thread(target=run_sequence, daemon=True).start()

    def send_server_command(self, command):
        if self.server_process and self.server_process.poll() is None:
            try:
                self.server_process.stdin.write(command + '\n')
                self.server_process.stdin.flush()
                return True
            except Exception as e:
                print(f"Failed to send command: {e}")
        return False

    def _read_server_output(self):
        player_connect_re = re.compile(r"Player connected: ([^,]+), xuid: ([0-9]+)")
        player_disconnect_re = re.compile(r"Player disconnected: ([^,]+), xuid: ([0-9]+)")
        version_re = re.compile(r"(?:Bedrock Dedicated Server version|Version:)\s*([0-9.]+)")
        
        try:
            for line in self.server_process.stdout:
                line = line.strip()
                if not line:
                    continue
                    
                with self.server_output_lock:
                    self.backup_output_lines.append(line)
                    
                match_connect = player_connect_re.search(line)
                match_disconnect = player_disconnect_re.search(line)
                match_version = version_re.search(line)
                
                if match_version:
                    v_str = match_version.group(1)
                    v_json = os.path.join(self.base_dir, "data", "last_version.json")
                    try:
                        os.makedirs(os.path.dirname(v_json), exist_ok=True)
                        with open(v_json, "w", encoding="utf-8") as f:
                            json.dump({"version": v_str}, f)
                    except:
                        pass
                elif match_connect:
                    player = match_connect.group(1)
                    xuid = match_connect.group(2)
                    self.handle_player_join(player, xuid)
                elif match_disconnect:
                    player = match_disconnect.group(1)
                    xuid = match_disconnect.group(2)
                    self.handle_player_leave(player, xuid)
                    
        except Exception as e:
            print(f"Error reading server output: {e}")

    def handle_player_join(self, player, xuid):
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        world = self.get_active_world_name() or "Unknown"
        with self.server_output_lock:
            self.online_players.add(player)
            self.player_session_times[player] = {"start": datetime.now(), "world": world}
            
        global_json = self.get_global_player_json()
        global_data = {}
        if os.path.exists(global_json):
            try:
                with open(global_json, "r", encoding="utf-8") as f:
                    global_data = json.load(f)
            except Exception:
                pass
                
        pdata = global_data.get(player, {})
        pdata["last_connected"] = now_str
        pdata["xuid"] = xuid
        global_data[player] = pdata
        
        try:
            with open(global_json, "w", encoding="utf-8") as f:
                json.dump(global_data, f, indent=2)
        except Exception as e:
            print(f"Failed to update player list: {e}")

    def handle_player_leave(self, player, xuid):
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with self.server_output_lock:
            self.online_players.discard(player)
            session_info = self.player_session_times.pop(player, None)
            
        if session_info:
            if isinstance(session_info, dict):
                start_time = session_info["start"]
                world = session_info.get("world", "Unknown")
            else:
                # backward compat: was a raw datetime
                start_time = session_info
                world = "Unknown"
            session = {
                "start": start_time.strftime("%Y-%m-%d %H:%M:%S"),
                "end": now_str,
                "world": world
            }
            pdata = self.player_history.get(player, {"total": 0, "sessions": []})
            pdata["sessions"].append(session)
            pdata["total"] = pdata.get("total", 0) + 1
            if len(pdata["sessions"]) > 10:
                pdata["sessions"] = pdata["sessions"][-10:]
            self.player_history[player] = pdata
            self.save_player_history()
            
        global_json = self.get_global_player_json()
        global_data = {}
        if os.path.exists(global_json):
            try:
                with open(global_json, "r", encoding="utf-8") as f:
                    global_data = json.load(f)
            except Exception:
                pass
                
        pdata = global_data.get(player, {})
        pdata["last_disconnected"] = now_str
        pdata["xuid"] = xuid
        global_data[player] = pdata
        
        try:
            with open(global_json, "w", encoding="utf-8") as f:
                json.dump(global_data, f, indent=2)
        except Exception as e:
            print(f"Failed to update player list: {e}")

    def ensure_per_world_properties(self):
        try:
            level_name = self.get_active_world_name()
            if level_name:
                world_config_dir = os.path.join(self.base_dir, "data", "world_configs")
                os.makedirs(world_config_dir, exist_ok=True)
                world_prop_file = os.path.join(world_config_dir, f"{level_name}.properties")
                if os.path.exists(world_prop_file):
                    with open(world_prop_file, 'r', encoding="utf-8") as wf:
                        lines = wf.readlines()
                    with open(self.server_properties, 'w', encoding="utf-8") as sf:
                        for line in lines:
                            if line.startswith("level-name="):
                                sf.write(f"level-name={level_name}\n")
                            else:
                                sf.write(line)
        except Exception as e:
            print(f"Per-world properties setup error: {e}")

    def format_precise_duration(self, seconds):
        seconds = int(seconds)
        minutes, sec = divmod(seconds, 60)
        hours, min_ = divmod(minutes, 60)
        days, hr = divmod(hours, 24)
        if days > 0:
            return f"{days} days {hr} hours"
        if hours > 0:
            return f"{hours} hours {min_} mins"
        if minutes > 0:
            return f"{minutes} mins {sec} secs"
        return f"{sec} seconds"

def run_web_manager():
    manager = HeadlessMinecraftServerManager()
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    template_dir = os.path.join(base_dir, 'templates')
    static_dir = os.path.join(base_dir, 'static')
    
    app = Flask(__name__, template_folder=template_dir, static_folder=static_dir)

    # Serve web remote
    @app.route("/")
    @app.route("/index.html")
    def index():
        from flask import render_template
        return render_template("index.html")

    # API endpoints
    @app.route("/api/status")
    def api_status():
        # Get server version if possible
        version = "Unknown"
        version_json = os.path.join(manager.base_dir, "data", "last_version.json")
        if os.path.exists(version_json):
            try:
                with open(version_json, "r", encoding="utf-8") as f:
                    version = json.load(f).get("version", "Unknown")
            except:
                pass
                
        if version == "Unknown":
            with manager.server_output_lock:
                log_lines = list(manager.backup_output_lines)
            for line in log_lines:
                match = re.search(r"(?:Bedrock Dedicated Server version|Version:)\s*([0-9.]+)", line)
                if match:
                    version = match.group(1)
                    try:
                        os.makedirs(os.path.dirname(version_json), exist_ok=True)
                        with open(version_json, "w", encoding="utf-8") as f:
                            json.dump({"version": version}, f)
                    except:
                        pass
                    break
        return jsonify({
            "server_running": manager.is_server_running(),
            "online_players": manager.get_online_players(),
            "active_world": manager.get_active_world_name(),
            "version": version
        })

    @app.route("/api/latest_version_url")
    def api_latest_version_url():
        try:
            url = "https://raw.githubusercontent.com/kittizz/bedrock-server-downloads/main/bedrock-server-downloads.json"
            r = requests.get(url, timeout=10)
            if r.status_code == 200:
                data = r.json()
                releases = data.get("release", {})
                if releases:
                    def ver_key(v):
                        return [int(x) for x in v.split('.')]
                    sorted_versions = sorted(releases.keys(), key=ver_key)
                    latest_ver_name = sorted_versions[-1]
                    latest_release = releases[latest_ver_name]
                    linux_info = latest_release.get("linux", {})
                    latest_url = linux_info.get("url")
                    
                    match = re.search(r'bedrock-server-([0-9.]+)\.zip', latest_url)
                    exact_ver = match.group(1) if match else latest_ver_name
                    
                    return jsonify({"url": latest_url, "version": exact_ver})
        except Exception as e:
            print(f"Failed to fetch latest version: {e}")
        return jsonify({"error": "Could not fetch latest version URL automatically."}), 500

    @app.route("/api/update_status")
    def api_update_status():
        return jsonify(manager.update_state)

    @app.route("/api/server_output")
    def api_server_output():
        with manager.server_output_lock:
            lines = list(manager.backup_output_lines)
        return '\n'.join(lines), 200, {'Content-Type': 'text/plain; charset=utf-8'}

    @app.route("/api/properties", methods=["GET"])
    def api_get_properties():
        schema = manager.get_properties_schema()
        current_props = {}
        if os.path.exists(manager.server_properties):
            with open(manager.server_properties, 'r', encoding="utf-8") as f:
                for line in f:
                    if not line.strip() or line.startswith('#') or '=' not in line:
                        continue
                    k, v = line.strip().split('=', 1)
                    current_props[k] = v
        props = []
        for prop in schema:
            key = prop["key"]
            val = current_props.get(key, prop.get("default", ""))
            p = dict(prop)
            p["value"] = val
            props.append(p)
        return jsonify({"properties": props})

    @app.route("/api/properties", methods=["POST"])
    def api_set_properties():
        data = request.get_json(force=True)
        schema = manager.get_properties_schema()
        
        with open(manager.server_properties, 'w', encoding="utf-8") as f:
            for prop in schema:
                key = prop["key"]
                val = data.get(key, prop.get("default", ""))
                f.write(f"{key}={val}\n")
                
        active_world = manager.get_active_world_name()
        if active_world:
            world_configs_dir = os.path.join(manager.base_dir, "data", "world_configs")
            os.makedirs(world_configs_dir, exist_ok=True)
            world_prop_file = os.path.join(world_configs_dir, f"{active_world}.properties")
            with open(world_prop_file, 'w', encoding="utf-8") as f:
                for prop in schema:
                    key = prop["key"]
                    val = data.get(key, prop.get("default", ""))
                    f.write(f"{key}={val}\n")
                    
        return jsonify({"result": "Properties saved."})

    @app.route("/api/worlds")
    def api_worlds():
        try:
            worlds = []
            if os.path.exists(manager.worlds_dir):
                worlds = [w for w in os.listdir(manager.worlds_dir) if os.path.isdir(os.path.join(manager.worlds_dir, w))]
            return jsonify({"worlds": worlds, "active_world": manager.get_active_world_name()})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/worlds/upload", methods=["POST"])
    def api_upload_world():
        if "file" not in request.files:
            return jsonify({"result": "No file uploaded."}), 400
        file = request.files["file"]
        if file.filename == "":
            return jsonify({"result": "Empty filename."}), 400
            
        if not file.filename.lower().endswith(('.zip', '.mcworld')):
            return jsonify({"result": "Only .zip and .mcworld files are allowed."}), 400
            
        filename = secure_filename(file.filename)
        temp_path = os.path.join(manager.base_dir, filename)
        file.save(temp_path)
        
        try:
            with zipfile.ZipFile(temp_path, "r") as zip_ref:
                namelist = zip_ref.namelist()
                
                level_dat_path = None
                for name in namelist:
                    if name.endswith("level.dat"):
                        level_dat_path = name
                        break
                        
                if not level_dat_path:
                    os.remove(temp_path)
                    return jsonify({"result": "Invalid Minecraft world: level.dat not found in archive."}), 400
                
                parts = level_dat_path.split("/")
                if len(parts) > 1:
                    world_folder_name = parts[0]
                else:
                    world_folder_name = os.path.splitext(filename)[0]
                
                dest_dir = os.path.join(manager.worlds_dir, world_folder_name)
                if os.path.exists(dest_dir):
                    shutil.rmtree(dest_dir)
                
                os.makedirs(dest_dir, exist_ok=True)
                
                if len(parts) > 1:
                    prefix = world_folder_name + "/"
                    for member in zip_ref.infolist():
                        if member.filename.startswith(prefix):
                            old_name = member.filename
                            member.filename = member.filename[len(prefix):]
                            if member.filename:
                                zip_ref.extract(member, dest_dir)
                            member.filename = old_name
                else:
                    zip_ref.extractall(dest_dir)
                    
            os.remove(temp_path)
            return jsonify({"result": f"World '{world_folder_name}' imported successfully."})
        except Exception as e:
            if os.path.exists(temp_path):
                os.remove(temp_path)
            return jsonify({"result": f"Failed to import world: {e}"}), 500

    @app.route("/api/set_active_world", methods=["POST"])
    def api_set_active_world():
        data = request.get_json(force=True)
        world = data.get("world")
        if not world:
            return jsonify({"result": "No world specified."}), 400
            
        world_path = os.path.join(manager.worlds_dir, world)
        if not os.path.exists(world_path):
            return jsonify({"result": "World directory does not exist."}), 404
            
        try:
            lines = []
            if os.path.exists(manager.server_properties):
                with open(manager.server_properties, 'r', encoding="utf-8") as f:
                    lines = f.readlines()
                    
            with open(manager.server_properties, 'w', encoding="utf-8") as f:
                found = False
                for line in lines:
                    if line.startswith("level-name="):
                        f.write(f"level-name={world}\n")
                        found = True
                    else:
                        f.write(line)
                if not found:
                    f.write(f"level-name={world}\n")
                    
            if manager.is_server_running():
                manager.restart_server()
                
            return jsonify({"result": f"Active world changed to '{world}'."})
        except Exception as e:
            return jsonify({"result": f"Failed to change active world: {e}"}), 500

    @app.route("/api/worlds/create", methods=["POST"])
    def api_create_world():
        data = request.get_json(force=True)
        name = data.get("name", "").strip()
        seed = data.get("seed", "").strip()
        if not name:
            return jsonify({"result": "World name is required."}), 400
            
        world_path = os.path.join(manager.worlds_dir, name)
        if os.path.exists(world_path):
            return jsonify({"result": "World already exists."}), 409
            
        try:
            os.makedirs(world_path, exist_ok=True)
            if seed:
                # Optionally write to seed.txt or level-seed in properties
                with open(os.path.join(world_path, "seed.txt"), "w", encoding="utf-8") as f:
                    f.write(seed)
            return jsonify({"result": f"World '{name}' created."})
        except Exception as e:
            return jsonify({"result": f"Failed to create world: {e}"}), 500

    @app.route("/api/worlds/delete", methods=["POST"])
    def api_delete_world():
        data = request.get_json(force=True)
        world = data.get("world")
        if not world:
            return jsonify({"result": "No world specified."}), 400
            
        if world == manager.get_active_world_name():
            return jsonify({"result": "Cannot delete the active world."}), 400
            
        world_path = os.path.join(manager.worlds_dir, world)
        if not os.path.exists(world_path):
            return jsonify({"result": "World not found."}), 404
            
        try:
            shutil.rmtree(world_path, ignore_errors=True)
            return jsonify({"result": f"World '{world}' deleted."})
        except Exception as e:
            return jsonify({"result": f"Failed to delete world: {e}"}), 500

    @app.route("/api/backup_world", methods=["POST"])
    def api_backup_world():
        data = request.get_json(force=True)
        world = data.get("world")
        if not world:
            return jsonify({"result": "No world specified."}), 400
        try:
            world_path = os.path.join(manager.worlds_dir, world)
            if not os.path.exists(world_path):
                return jsonify({"result": "World not found."}), 404
                
            timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
            backup_path = os.path.join(manager.backup_dir, world)
            os.makedirs(backup_path, exist_ok=True)
            zip_file = os.path.join(backup_path, f"{world}-{timestamp}.zip")
            
            with zipfile.ZipFile(zip_file, 'w') as zipf:
                for foldername, subfolders, filenames in os.walk(world_path):
                    for filename in filenames:
                        filepath = os.path.join(foldername, filename)
                        arcname = os.path.relpath(filepath, world_path)
                        zipf.write(filepath, arcname)
                        
            return jsonify({"result": f"Backup for '{world}' created successfully."})
        except Exception as e:
            return jsonify({"result": f"Failed to backup world: {e}"}), 500

    @app.route("/api/list_backups")
    def api_list_backups():
        world = request.args.get("world")
        if not world:
            return jsonify({"backups": []})
        try:
            backup_path = os.path.join(manager.backup_dir, world)
            if not os.path.exists(backup_path):
                return jsonify({"backups": []})
            backups = []
            for b in sorted(os.listdir(backup_path), reverse=True):
                full_path = os.path.join(backup_path, b)
                size_kb = os.path.getsize(full_path) // 1024
                mtime = datetime.fromtimestamp(os.path.getmtime(full_path)).strftime("%Y-%m-%d %H:%M:%S")
                backups.append({
                    "filename": b,
                    "size": f"{size_kb} KB",
                    "date": mtime
                })
            return jsonify({"backups": backups})
        except Exception as e:
            return jsonify({"backups": [], "error": str(e)})

    @app.route("/api/start", methods=["POST"])
    def api_start():
        if manager.start_server():
            return jsonify({"result": "starting"})
        return jsonify({"result": "already running"})

    @app.route("/api/stop", methods=["POST"])
    def api_stop():
        if manager.is_server_running():
            manager.graceful_stop_server()
            return jsonify({"result": "stopping"})
        return jsonify({"result": "already stopped"})

    @app.route("/api/restart", methods=["POST"])
    def api_restart():
        if manager.is_server_running():
            manager.restart_server()
            return jsonify({"result": "restarting"})
        return jsonify({"result": "not running"})

    @app.route("/api/command", methods=["POST"])
    def api_command():
        data = request.get_json(force=True)
        cmd = data.get("command", "")
        if cmd:
            if manager.send_server_command(cmd):
                return jsonify({"result": "sent", "command": cmd})
            return jsonify({"result": "server not running"}), 503
        return jsonify({"result": "no command"}), 400

    @app.route("/api/players", methods=["GET"])
    def api_players():
        now = datetime.now()
        global_json = manager.get_global_player_json()
        player_data = {}
        if os.path.exists(global_json):
            try:
                with open(global_json, "r", encoding="utf-8") as f:
                    player_data = json.load(f)
            except Exception:
                pass
                
        permissions_path = os.path.join(manager.base_dir, "permissions.json")
        permissions = []
        if os.path.exists(permissions_path):
            try:
                with open(permissions_path, "r", encoding="utf-8") as f:
                    permissions = json.load(f)
            except Exception:
                pass
                
        online_players_list = manager.get_online_players()
        all_players = set(player_data.keys()) | set(online_players_list)
        
        result = []
        for player in sorted(all_players):
            pdata = player_data.get(player, {})
            xuid = pdata.get("xuid")
            
            level = "member"
            for perm in permissions:
                if str(perm.get("xuid")).strip() == str(xuid).strip():
                    level = perm.get("permission", "member")
                    break
                    
            status = "Online" if player in online_players_list else "Offline"
            last_seen = pdata.get("last_disconnected", "-")
            
            session_time = "--"
            session_start_str = None
            session_world = None
            if status == "Online":
                session_info = manager.player_session_times.get(player)
                if session_info:
                    start = session_info["start"] if isinstance(session_info, dict) else session_info
                    session_world = session_info.get("world") if isinstance(session_info, dict) else None
                    session_seconds = int((now - start).total_seconds())
                    session_time = manager.format_precise_duration(session_seconds)
                    session_start_str = start.strftime("%Y-%m-%d %H:%M:%S")

            # Read ban status from allowlist
            allowlist_path = os.path.join(manager.base_dir, "allowlist.json")
            allowlist_enabled = False
            is_in_allowlist = True
            if os.path.exists(manager.server_properties):
                with open(manager.server_properties, 'r', encoding='utf-8') as f:
                    for ln in f:
                        if ln.strip().startswith("allow-list="):
                            allowlist_enabled = ln.strip().split("=", 1)[1].lower() == "true"

            allowlist_entries = []
            if os.path.exists(allowlist_path):
                try:
                    with open(allowlist_path, "r", encoding="utf-8") as f:
                        allowlist_entries = json.load(f)
                except Exception:
                    pass
            if xuid:
                is_in_allowlist = any(str(e.get("xuid")).strip() == str(xuid).strip() for e in allowlist_entries)

            result.append({
                "name": player,
                "xuid": xuid,
                "level": level,
                "status": status,
                "last_seen": last_seen,
                "session_time": session_time,
                "session_start": session_start_str,
                "session_world": session_world,
                "allowlist_enabled": allowlist_enabled,
                "in_allowlist": is_in_allowlist
            })
        return jsonify({"players": result})

    @app.route("/api/player_action", methods=["POST"])
    def api_player_action():
        data = request.get_json(force=True)
        player = data.get("player")
        action = data.get("action")
        if not player or not action:
            return jsonify({"result": "Missing player or action."}), 400
            
        global_json = manager.get_global_player_json()
        xuid = None
        if os.path.exists(global_json):
            try:
                with open(global_json, "r", encoding="utf-8") as f:
                    player_data = json.load(f)
                xuid = player_data.get(player, {}).get("xuid")
            except Exception:
                pass
                
        if not xuid:
            return jsonify({"result": f"XUID not found for {player}."}), 404
            
        permissions_path = os.path.join(manager.base_dir, "permissions.json")
        allowlist_path = os.path.join(manager.base_dir, "allowlist.json")
        
        if action == "ban":
            allowlist = []
            if os.path.exists(allowlist_path):
                try:
                    with open(allowlist_path, "r", encoding="utf-8") as f:
                        allowlist = json.load(f)
                except Exception:
                    pass
            new_allowlist = [entry for entry in allowlist if str(entry.get("xuid")).strip() != str(xuid).strip()]
            try:
                with open(allowlist_path, "w", encoding="utf-8") as f:
                    json.dump(new_allowlist, f, indent=2)
                manager.send_server_command("allowlist reload")
                manager.send_server_command(f"kick {player} You have been banned from this server.")
                return jsonify({"result": f"Player '{player}' has been banned and kicked."})
            except Exception as e:
                return jsonify({"result": f"Failed to ban player: {e}"}), 500

        elif action == "unban":
            allowlist = []
            if os.path.exists(allowlist_path):
                try:
                    with open(allowlist_path, "r", encoding="utf-8") as f:
                        allowlist = json.load(f)
                except Exception:
                    pass
            if not any(str(e.get("xuid")).strip() == str(xuid).strip() for e in allowlist):
                allowlist.append({"ignoresPlayerLimit": False, "name": player, "xuid": xuid})
                try:
                    with open(allowlist_path, "w", encoding="utf-8") as f:
                        json.dump(allowlist, f, indent=2)
                    manager.send_server_command("allowlist reload")
                    return jsonify({"result": f"Player '{player}' has been unbanned and added to allowlist."})
                except Exception as e:
                    return jsonify({"result": f"Failed to unban player: {e}"}), 500
            return jsonify({"result": f"Player '{player}' is already in the allowlist."})

        elif action in ["promote", "demote"]:
            permissions = []
            if os.path.exists(permissions_path):
                try:
                    with open(permissions_path, "r", encoding="utf-8") as f:
                        permissions = json.load(f)
                except Exception:
                    pass
            
            current = "member"
            for perm in permissions:
                if str(perm.get("xuid")).strip() == str(xuid).strip():
                    current = perm.get("permission", "member")
                    break
                    
            if action == "promote":
                new_level = {"visitor": "member", "member": "operator", "operator": "operator"}.get(current, "member")
            else:
                new_level = {"operator": "member", "member": "visitor", "visitor": "visitor"}.get(current, "visitor")
                
            new_permissions = [entry for entry in permissions if str(entry.get("xuid")).strip() != str(xuid).strip()]
            new_permissions.append({"xuid": int(xuid), "permission": new_level})
            
            try:
                with open(permissions_path, "w", encoding="utf-8") as f:
                    json.dump(new_permissions, f, indent=2)
                manager.send_server_command("permission reload")
                return jsonify({"result": f"Player {player} permission updated to {new_level}."})
            except Exception as e:
                return jsonify({"result": f"Failed to change permission: {e}"}), 500
                
        return jsonify({"result": "Unknown action."}), 400

    @app.route("/api/player_sessions", methods=["GET"])
    def api_player_sessions():
        player = request.args.get("player")
        if not player:
            return jsonify({"result": "Missing player."}), 400
            
        hist_path = manager.get_player_history_json()
        if os.path.exists(hist_path):
            try:
                with open(hist_path, "r", encoding="utf-8") as f:
                    history = json.load(f)
                pdata = history.get(player, {"total": 0, "sessions": []})
                return jsonify({"player": player, "total": pdata.get("total", 0), "sessions": pdata.get("sessions", [])[-10:]})
            except Exception:
                pass
        return jsonify({"player": player, "total": 0, "sessions": []})

    @app.route("/api/allowlist", methods=["GET"])
    def api_allowlist_get():
        allowlist_path = os.path.join(manager.base_dir, "allowlist.json")
        data = []
        if os.path.exists(allowlist_path):
            try:
                with open(allowlist_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
            except Exception:
                pass
        return jsonify({"allowlist": data})

    @app.route("/api/cheats_status", methods=["GET"])
    def api_cheats_status():
        cheats = False
        if os.path.exists(manager.server_properties):
            try:
                with open(manager.server_properties, 'r', encoding='utf-8') as f:
                    for line in f:
                        if line.strip().startswith("allow-cheats="):
                            cheats = line.strip().split("=", 1)[1].strip().lower() == "true"
            except Exception:
                pass
        return jsonify({"cheats_enabled": cheats, "active_world": manager.get_active_world_name()})

    @app.route("/api/player_command", methods=["POST"])
    def api_player_command():
        data = request.get_json(force=True)
        command = data.get("command", "").strip()
        if not command:
            return jsonify({"result": "No command specified."}), 400
        if not manager.is_server_running():
            return jsonify({"result": "Server is not running."}), 503
        # Validate cheats are on before sending cheat commands
        cheats_on = False
        if os.path.exists(manager.server_properties):
            with open(manager.server_properties, 'r', encoding='utf-8') as f:
                for line in f:
                    if line.strip().startswith("allow-cheats="):
                        cheats_on = line.strip().split("=", 1)[1].strip().lower() == "true"
        if not cheats_on:
            return jsonify({"result": "Cheats are not enabled on this world."}), 403
        manager.send_server_command(command)
        return jsonify({"result": f"Command sent: {command}"})

    # --- Addons (Resource / Behavior packs) Endpoints ---
    @app.route("/api/addons", methods=["GET"])
    def api_get_addons():
        world = request.args.get("world") or manager.get_active_world_name()
        
        # Load behavior packs
        b_packs = []
        if os.path.exists(manager.behavior_packs_dir):
            for d in os.listdir(manager.behavior_packs_dir):
                dpath = os.path.join(manager.behavior_packs_dir, d)
                if os.path.isdir(dpath):
                    manifest_path = os.path.join(dpath, "manifest.json")
                    name = d
                    uuid = ""
                    version = ""
                    if os.path.exists(manifest_path):
                        try:
                            with open(manifest_path, "r", encoding="utf-8") as mf:
                                m = json.load(mf)
                                name = m.get("header", {}).get("name", d)
                                uuid = m.get("header", {}).get("uuid", "")
                                version = m.get("header", {}).get("version", "")
                        except:
                            pass
                    b_packs.append({"folder": d, "name": name, "uuid": uuid, "version": version})

        # Load resource packs
        r_packs = []
        if os.path.exists(manager.resource_packs_dir):
            for d in os.listdir(manager.resource_packs_dir):
                dpath = os.path.join(manager.resource_packs_dir, d)
                if os.path.isdir(dpath):
                    manifest_path = os.path.join(dpath, "manifest.json")
                    name = d
                    uuid = ""
                    version = ""
                    if os.path.exists(manifest_path):
                        try:
                            with open(manifest_path, "r", encoding="utf-8") as mf:
                                m = json.load(mf)
                                name = m.get("header", {}).get("name", d)
                                uuid = m.get("header", {}).get("uuid", "")
                                version = m.get("header", {}).get("version", "")
                        except:
                            pass
                    r_packs.append({"folder": d, "name": name, "uuid": uuid, "version": version})

        # Load applied packs for selected world
        applied_behavior = []
        applied_resource = []
        if world:
            wpath = os.path.join(manager.worlds_dir, world)
            b_json = os.path.join(wpath, "world_behavior_packs.json")
            r_json = os.path.join(wpath, "world_resource_packs.json")
            
            if os.path.exists(b_json):
                try:
                    with open(b_json, "r", encoding="utf-8") as f:
                        applied_behavior = json.load(f)
                except:
                    pass
            if os.path.exists(r_json):
                try:
                    with open(r_json, "r", encoding="utf-8") as f:
                        applied_resource = json.load(f)
                except:
                    pass

        return jsonify({
            "behavior_packs": b_packs,
            "resource_packs": r_packs,
            "applied_behavior": applied_behavior,
            "applied_resource": applied_resource
        })

    @app.route("/api/addons/apply", methods=["POST"])
    def api_apply_addons():
        data = request.get_json(force=True)
        world = data.get("world") or manager.get_active_world_name()
        if not world:
            return jsonify({"result": "No world specified."}), 400
            
        behavior_folders = data.get("behavior_packs", [])
        resource_folders = data.get("resource_packs", [])
        
        world_path = os.path.join(manager.worlds_dir, world)
        if not os.path.exists(world_path):
            return jsonify({"result": "World not found."}), 404

        b_list = []
        for d in behavior_folders:
            manifest_path = os.path.join(manager.behavior_packs_dir, d, "manifest.json")
            if os.path.exists(manifest_path):
                try:
                    with open(manifest_path, "r", encoding="utf-8") as f:
                        m = json.load(f)
                        uuid = m.get("header", {}).get("uuid")
                        version = m.get("header", {}).get("version")
                        if uuid and version:
                            b_list.append({"pack_id": uuid, "version": version})
                except:
                    pass

        r_list = []
        for d in resource_folders:
            manifest_path = os.path.join(manager.resource_packs_dir, d, "manifest.json")
            if os.path.exists(manifest_path):
                try:
                    with open(manifest_path, "r", encoding="utf-8") as f:
                        m = json.load(f)
                        uuid = m.get("header", {}).get("uuid")
                        version = m.get("header", {}).get("version")
                        if uuid and version:
                            r_list.append({"pack_id": uuid, "version": version})
                except:
                    pass

        # Write files
        try:
            with open(os.path.join(world_path, "world_behavior_packs.json"), "w", encoding="utf-8") as f:
                json.dump(b_list, f, indent=2)
            with open(os.path.join(world_path, "world_resource_packs.json"), "w", encoding="utf-8") as f:
                json.dump(r_list, f, indent=2)
            return jsonify({"result": "Addons applied to world successfully."})
        except Exception as e:
            return jsonify({"result": f"Failed to apply packs: {e}"}), 500

    @app.route("/api/addons/upload", methods=["POST"])
    def api_upload_addon():
        if "file" not in request.files:
            return jsonify({"result": "No file uploaded."}), 400
        file = request.files["file"]
        if file.filename == "":
            return jsonify({"result": "Empty filename."}), 400
            
        if not file.filename.lower().endswith(('.zip', '.mcpack')):
            return jsonify({"result": "Only .zip and .mcpack archives are allowed."}), 400
            
        filename = secure_filename(file.filename)
        temp_path = os.path.join(manager.base_dir, filename)
        file.save(temp_path)
        
        # Analyze archive and extract
        try:
            with zipfile.ZipFile(temp_path, "r") as zip_ref:
                namelist = zip_ref.namelist()
                manifest_name = None
                for n in namelist:
                    if n.endswith("manifest.json"):
                        manifest_name = n
                        break
                
                if not manifest_name:
                    os.remove(temp_path)
                    return jsonify({"result": "Invalid addon: manifest.json not found inside zip."}), 400
                    
                # Read manifest.json to detect type
                manifest_data = json.loads(zip_ref.read(manifest_name).decode("utf-8"))
                modules = manifest_data.get("modules", [])
                pack_type = "resources"
                for mod in modules:
                    mod_type = mod.get("type", "")
                    if mod_type in ["data", "client_data"]:
                        pack_type = "behavior"
                        break
                        
                # Determine target folder
                target_dir = manager.behavior_packs_dir if pack_type == "behavior" else manager.resource_packs_dir
                
                # Check root directory inside zip to avoid merging everything into root
                parts = manifest_name.split("/")
                if len(parts) > 1:
                    root_folder = parts[0]
                else:
                    root_folder = os.path.splitext(filename)[0]
                    
                extract_dest = os.path.join(target_dir, root_folder)
                if os.path.exists(extract_dest):
                    shutil.rmtree(extract_dest)
                    
                zip_ref.extractall(target_dir)
                
                # Rename if extracted to root directly
                if len(parts) == 1:
                    # Move files from target_dir root if manifest was in root
                    # MCSManager style usually creates subfolder
                    pass
                    
            os.remove(temp_path)
            return jsonify({"result": f"Addon '{root_folder}' uploaded and installed as {pack_type} pack."})
        except Exception as e:
            if os.path.exists(temp_path):
                os.remove(temp_path)
            return jsonify({"result": f"Failed to install addon: {e}"}), 500

    # --- Server Updates (1-Click Linux BDS Installer) ---
    @app.route("/api/update_server", methods=["POST"])
    def api_update_server():
        data = request.get_json(force=True) or {}
        url = data.get("download_url")
        
        if not url:
            # Auto fetch latest URL if not specified
            try:
                latest_info = json.loads(api_latest_version_url().get_data(as_text=True))
                url = latest_info.get("url")
            except Exception as e:
                print(f"Failed to auto-fetch update URL: {e}")
                
        if not url or not url.startswith(("http://", "https://")):
            return jsonify({"result": "Invalid or missing download URL."}), 400
            
        def perform_update():
            try:
                manager.update_state = {
                    "status": "downloading",
                    "progress": 5,
                    "message": "Downloading server update package...",
                    "error": ""
                }
                
                print(f"Downloading server update from: {url}")
                temp_zip = os.path.join(manager.base_dir, "bds_update.zip")
                
                r = requests.get(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}, stream=True)
                if r.status_code != 200:
                    raise Exception(f"Mojang server returned status code {r.status_code} - download blocked.")
                total_length = r.headers.get('content-length')
                
                dl = 0
                total_length = int(total_length) if total_length is not None else None
                
                with open(temp_zip, "wb") as f:
                    for chunk in r.iter_content(chunk_size=8192):
                        if chunk:
                            f.write(chunk)
                            dl += len(chunk)
                            if total_length:
                                # Scale download progress from 5% to 45%
                                percent = 5 + int((dl / total_length) * 40)
                                manager.update_state["progress"] = percent
                                manager.update_state["message"] = f"Downloading server update package ({dl // 1024} KB / {total_length // 1024} KB)..."
                
                manager.update_state = {
                    "status": "stopping",
                    "progress": 50,
                    "message": "Stopping Minecraft Dedicated Server...",
                    "error": ""
                }
                print("Download completed. Stopping server...")
                manager.stop_server()
                
                manager.update_state = {
                    "status": "extracting",
                    "progress": 60,
                    "message": "Extracting update package (preserving worlds and configurations)...",
                    "error": ""
                }
                print("Extracting update package...")
                
                # Extract all files excluding world and config to avoid overwriting them
                with zipfile.ZipFile(temp_zip, "r") as z:
                    infolist = z.infolist()
                    total_files = len(infolist)
                    for idx, member in enumerate(infolist):
                        filename = member.filename
                        # Skip configuration, worlds, and logs
                        if filename.startswith(("worlds/", "server.properties", "allowlist.json", "permissions.json", "data/")):
                            continue
                        z.extract(member, manager.base_dir)
                        # Scale extraction progress from 60% to 85%
                        percent = 60 + int((idx / total_files) * 25)
                        manager.update_state["progress"] = percent
                        manager.update_state["message"] = f"Extracting files ({idx}/{total_files})..."
                        
                os.remove(temp_zip)
                
                manager.update_state = {
                    "status": "setting_permissions",
                    "progress": 90,
                    "message": "Setting file execution permissions...",
                    "error": ""
                }
                print("Setting execution permissions...")
                os.chmod(manager.server_path, 0o755)
                
                manager.update_state = {
                    "status": "restarting",
                    "progress": 95,
                    "message": "Starting updated Bedrock Server...",
                    "error": ""
                }
                print("Update complete. Restarting server...")
                manager.start_server()
                
                manager.update_state = {
                    "status": "success",
                    "progress": 100,
                    "message": "Update completed successfully! Server is online.",
                    "error": ""
                }
                print("Server updated successfully!")
            except Exception as e:
                err_msg = str(e)
                print(f"Error during server update: {err_msg}")
                manager.update_state = {
                    "status": "failed",
                    "progress": 100,
                    "message": "Update failed!",
                    "error": err_msg
                }
                
        threading.Thread(target=perform_update, daemon=True).start()
        return jsonify({"result": "Update process started."})

    # --- Settings Endpoints ---
    @app.route("/api/settings", methods=["GET"])
    def api_get_settings():
        settings_path = manager.get_settings_json()
        if os.path.exists(settings_path):
            with open(settings_path, "r", encoding="utf-8") as f:
                return jsonify(json.load(f))
        return jsonify({})

    @app.route("/api/settings", methods=["POST"])
    def api_set_settings():
        data = request.get_json(force=True)
        settings_path = manager.get_settings_json()
        try:
            with open(settings_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
            return jsonify({"result": "Settings saved successfully."})
        except Exception as e:
            return jsonify({"result": f"Failed to save settings: {e}"}), 500

    app.run(host="127.0.0.1", port=5000, debug=False)

if __name__ == "__main__":
    run_web_manager()
