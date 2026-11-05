#!/usr/bin/env python3
"""
Mutual-Exclusion GPU Model Orchestrator for fedora-mark-desktop (RTX 4070 Super 12GB + 64GB RAM).
Ensures Strata (Qwen3.8-Flash-Next) and KoboldCPP (Report/Audit Engine) NEVER run simultaneously.
Run with: python3 scripts/strata-orchestrator.py
"""
import json
import os
import signal
import subprocess
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = int(os.environ.get("STRATA_ORCHESTRATOR_PORT", "8765"))
STATE = {
    "activeSlot": "none",
    "pid": None,
    "startedAt": None,
    "lastActivityAt": time.time(),
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
    # Also ensure any stray strata or koboldcpp processes release VRAM
    subprocess.run(["pkill", "-f", "strata serve"], stderr=subprocess.DEVNULL)
    subprocess.run(["pkill", "-f", "koboldcpp.py"], stderr=subprocess.DEVNULL)
    time.sleep(1.0)
    STATE["activeSlot"] = "none"
    STATE["pid"] = None
    STATE["command"] = None

def start_slot(slot_name: str, cmd: str):
    stop_current_process()
    if slot_name == "none" or not cmd.strip():
        return {"status": "unloaded", "activeSlot": "none"}
    proc = subprocess.Popen(
        cmd,
        shell=True,
        preexec_fn=os.setsid,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    STATE["activeSlot"] = slot_name
    STATE["pid"] = proc.pid
    STATE["startedAt"] = time.time()
    STATE["lastActivityAt"] = time.time()
    STATE["command"] = cmd
    return {"status": f"loaded {slot_name} (pid={proc.pid})", "activeSlot": slot_name, "pid": proc.pid}

class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, payload: dict):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/status":
            self._send(200, STATE)
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path == "/switch":
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
            data = json.loads(raw)
            target = data.get("targetSlot", "none")
            if target == "chat":
                cmd = data.get("chatSlot", {}).get("startCommand", "")
                res = start_slot("chat", cmd)
            elif target == "report":
                cmd = data.get("reportSlot", {}).get("startCommand", "")
                res = start_slot("report", cmd)
            else:
                res = start_slot("none", "")
            self._send(200, res)
        else:
            self._send(404, {"error": "not found"})

if __name__ == "__main__":
    print(f"[Strata Orchestrator] Listening on 0.0.0.0:{PORT} (Mutual-Exclusion GPU Manager)")
    HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
