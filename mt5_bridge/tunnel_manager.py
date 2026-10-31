"""
Automated Cloudflare Tunnel & GitHub/Vercel Sync Manager (`mt5_bridge/tunnel_manager.py`).
When triggered via Button 1 ("Execute") or `start_bridge.bat`:
  1. Ensures `cloudflared tunnel --url http://127.0.0.1:8001` is running.
  2. Extracts the live `https://*.trycloudflare.com` URL.
  3. Writes the URL to `frontend/public/mt5_tunnel.json` and `mt5_bridge/tunnel_state.json`.
  4. Commits and pushes `frontend/public/mt5_tunnel.json` to `origin/main` so Vercel
     automatically receives the new tunnel URL and redeploys (and can also read it
     immediately from GitHub Raw without waiting for build completion).
"""

import json
import re
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import requests

from config import settings, BRIDGE_DIR

REPO_ROOT = BRIDGE_DIR.parent
PUBLIC_TUNNEL_JSON = REPO_ROOT / "frontend" / "public" / "mt5_tunnel.json"
LOCAL_STATE_JSON = BRIDGE_DIR / "tunnel_state.json"
CLOUDFLARED_LOG = BRIDGE_DIR / "cloudflared_runtime.log"
CLOUDFLARED_EXE = BRIDGE_DIR / "cloudflared.exe"

TRYCLOUDFLARE_REGEX = re.compile(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com")


def read_saved_tunnel_url() -> Optional[str]:
    for path in (LOCAL_STATE_JSON, PUBLIC_TUNNEL_JSON):
        if path.exists():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                url = str(data.get("tunnel_url", "")).strip().rstrip("/")
                if url.startswith("https://"):
                    return url
            except Exception:
                pass
    return None


def is_tunnel_url_alive(tunnel_url: str) -> bool:
    if not tunnel_url:
        return False
    try:
        resp = requests.get(
            f"{tunnel_url.rstrip('/')}/health",
            headers={"Authorization": f"Bearer {settings.secret_token}"},
            timeout=3.5,
        )
        return resp.status_code == 200
    except Exception:
        return False


def extract_url_from_logfile(log_path: Path) -> Optional[str]:
    if not log_path.exists():
        return None
    try:
        content = log_path.read_text(encoding="utf-8", errors="ignore")
        matches = TRYCLOUDFLARE_REGEX.findall(content)
        if matches:
            return matches[-1].rstrip("/")
    except Exception:
        pass
    return None


def start_or_get_cloudflare_tunnel() -> tuple[bool, str, str]:
    """
    Returns (success, tunnel_url, message).
    Reuses existing tunnel if healthy; otherwise starts a new cloudflared Quick Tunnel.
    """
    # 1. Check if the currently saved tunnel URL is already online and responding
    existing_url = read_saved_tunnel_url()
    if existing_url and is_tunnel_url_alive(existing_url):
        return True, existing_url, "Reused active healthy Cloudflare Quick Tunnel."

    # 2. Check if cloudflared_runtime.log already has a live tunnel
    log_url = extract_url_from_logfile(CLOUDFLARED_LOG)
    if log_url and is_tunnel_url_alive(log_url):
        return True, log_url, "Attached to running Cloudflare Quick Tunnel from log."

    # 3. Spawn a fresh cloudflared Quick Tunnel process
    cf_bin = str(CLOUDFLARED_EXE) if CLOUDFLARED_EXE.exists() else "cloudflared"
    if CLOUDFLARED_LOG.exists():
        try:
            CLOUDFLARED_LOG.unlink()
        except Exception:
            pass

    cmd = [
        cf_bin,
        "tunnel",
        "--url",
        f"http://{settings.host}:{settings.port}",
        "--logfile",
        str(CLOUDFLARED_LOG),
    ]

    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
    try:
        subprocess.Popen(
            cmd,
            cwd=str(BRIDGE_DIR),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=creationflags,
        )
    except Exception as exc:
        return False, "", f"Failed to start cloudflared: {exc}"

    # Poll log file up to 15 seconds for the generated https://*.trycloudflare.com URL
    for _ in range(30):
        time.sleep(0.5)
        found = extract_url_from_logfile(CLOUDFLARED_LOG)
        if found:
            return True, found, "Generated new Cloudflare Quick Tunnel URL."

    return False, "", "Timed out waiting for cloudflared to generate a trycloudflare.com URL."


def persist_and_push_tunnel(tunnel_url: str, mt5_meta: dict[str, Any]) -> dict[str, Any]:
    """
    Saves the active tunnel URL to `frontend/public/mt5_tunnel.json` and
    pushes it to `origin/main` so Vercel automatically gets the new URL.
    """
    clean_url = tunnel_url.strip().rstrip("/")
    now_iso = datetime.now(timezone.utc).isoformat()

    payload = {
        "tunnel_url": clean_url,
        "webhook_url": f"{clean_url}/webhook/mt5",
        "health_url": f"{clean_url}/health",
        "port": settings.port,
        "updated_at_utc": now_iso,
        "mt5_connected": bool(mt5_meta.get("connected")),
        "mt5_terminal_name": mt5_meta.get("terminal_name"),
        "mt5_account_login": mt5_meta.get("account_login"),
        "mt5_account_server": mt5_meta.get("account_server"),
    }

    PUBLIC_TUNNEL_JSON.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC_TUNNEL_JSON.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    LOCAL_STATE_JSON.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    git_result = {"committed": False, "pushed": False, "git_output": ""}
    try:
        subprocess.run(
            ["git", "add", "frontend/public/mt5_tunnel.json"],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            timeout=10,
        )
        commit_proc = subprocess.run(
            [
                "git",
                "commit",
                "-m",
                f"chore(mt5-bridge): sync active Cloudflare tunnel URL ({clean_url})",
            ],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            timeout=15,
        )
        committed = commit_proc.returncode == 0
        push_proc = subprocess.run(
            ["git", "push", "origin", "main"],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            timeout=30,
        )
        git_result = {
            "committed": committed,
            "pushed": push_proc.returncode == 0,
            "git_output": (commit_proc.stdout + "\n" + push_proc.stdout + "\n" + push_proc.stderr).strip(),
        }
    except Exception as exc:
        git_result["git_output"] = f"Git sync warning: {exc}"

    return {
        **payload,
        "git_sync": git_result,
    }
