#!/usr/bin/env python3
"""
Mutual-Exclusion GPU Model Orchestrator Daemon for fedora-mark-desktop (RTX 4070 Super 12GB + 64GB RAM).
Features:
  - Strictly ensures Strata (Qwen3.8-Flash-Next) and KoboldCPP never run simultaneously on the GPU.
  - Exposes folder scanning to list .gguf files dynamically.
  - Automatically unloads model from VRAM after configurable idle timeout (default: 30 minutes).
Run with: python3 scripts/strata-orchestrator.py
"""
import glob
import json
import os
import signal
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

PORT = int(os.environ.get("STRATA_ORCHESTRATOR_PORT", "8765"))
STATE = {
    "activeSlot": "none",
    "pid": None,
    "startedAt": None,
    "lastActivityAt": time.time(),
    "idleUnloadMinutes": 30,
    "command": None,
}

def stop_current_process():
    pid = STATE.get("pid")
    if pid:
        try:
            os.killpg(os.getpgid(pid), signal.SIGTERM)
            time.sleep(1.5)
        except Exception:
            pass
    subprocess.run(["pkill", "-f", "strata serve"], stderr=subprocess.DEVNULL)
    subprocess.run(["pkill", "-f", "koboldcpp.py"], stderr=subprocess.DEVNULL)
    time.sleep(1.0)
    STATE["activeSlot"] = "none"
    STATE["pid"] = None
    STATE["command"] = None

def start_slot(slot_name: str, cmd: str, idle_mins: int = 30):
    stop_current_process()
    if slot_name == "none" or not cmd.strip():
        return {"status": "unloaded", "activeSlot": "none"}
    
    # Expand home tilde in paths
    expanded_cmd = os.path.expanduser(cmd)
    proc = subprocess.Popen(
        expanded_cmd,
        shell=True,
        preexec_fn=os.setsid,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    STATE["activeSlot"] = slot_name
    STATE["pid"] = proc.pid
    STATE["startedAt"] = time.time()
    STATE["lastActivityAt"] = time.time()
    STATE["idleUnloadMinutes"] = max(5, idle_mins)
    STATE["command"] = cmd
    return {"status": f"loaded {slot_name} (pid={proc.pid})", "activeSlot": slot_name, "pid": proc.pid}

def idle_watchdog_thread():
    while True:
        time.sleep(30)
        if STATE["activeSlot"] != "none" and STATE["pid"]:
            idle_sec = time.time() - STATE["lastActivityAt"]
            max_idle_sec = STATE["idleUnloadMinutes"] * 60
            if idle_sec >= max_idle_sec:
                print(f"[Watchdog] Auto-unloading {STATE['activeSlot']} after {STATE['idleUnloadMinutes']} mins of idle.")
                stop_current_process()

threading.Thread(target=idle_watchdog_thread, daemon=True).start()

class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, payload: dict):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/status":
            self._send(200, STATE)
        elif parsed.path == "/scan":
            params = parse_qs(parsed.query)
            folder = params.get("folder", ["~/models"])[0]
            expanded = os.path.expanduser(folder)
            files = []
            if os.path.exists(expanded):
                ggufs = glob.glob(os.path.join(expanded, "**/*.gguf"), recursive=True) + glob.glob(os.path.join(expanded, "*.gguf"))
                files = sorted(list(set(os.path.basename(f) for f in ggufs)))
            self._send(200, {"folder": folder, "files": files})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path == "/switch":
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
            data = json.loads(raw)
            target = data.get("targetSlot", "none")
            idle_mins = int(data.get("idleUnloadMinutes", 30))
            if target == "chat":
                cmd = data.get("chatSlot", {}).get("startCommand", "")
                res = start_slot("chat", cmd, idle_mins)
            elif target == "report":
                cmd = data.get("reportSlot", {}).get("startCommand", "")
                res = start_slot("report", cmd, idle_mins)
            else:
                res = start_slot("none", "", idle_mins)
            self._send(200, res)
        elif self.path == "/ping":
            STATE["lastActivityAt"] = time.time()
            self._send(200, {"ok": True, "activeSlot": STATE["activeSlot"]})
        else:
            self._send(404, {"error": "not found"})

if __name__ == "__main__":
    print(f"[Strata Orchestrator] Listening on 0.0.0.0:{PORT} (Mutual-Exclusion GPU Manager)")
    HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
