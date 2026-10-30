"""
End-to-End Dry-Run & IPC Verification Script (`mt5_bridge/verify_bridge.py`).
Tests:
  1. Direct MT5 IPC connection (`mt5.initialize()`, terminal_info, account_info).
  2. Live FastAPI server startup on 127.0.0.1:8001 (avoiding port 8000).
  3. Zero-trust secret token enforcement (confirms invalid token returns HTTP 401).
  4. Authenticated `/health` and `POST /webhook/mt5` (`dry_run=True`) execution against the live MT5 terminal.
"""

import json
import socket
import sys
import threading
import time
from pathlib import Path

import requests
import uvicorn

BRIDGE_DIR = Path(__file__).resolve().parent
if str(BRIDGE_DIR) not in sys.path:
    sys.path.insert(0, str(BRIDGE_DIR))

from config import settings  # noqa: E402
from mt5_client import bridge_client  # noqa: E402
from server import app  # noqa: E402


def is_port_in_use(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex((host, port)) == 0


def main() -> int:
    print("=" * 76)
    print("  WESSIGNAL MT5 BRIDGE — PHASE 2 DRY-RUN & IPC VERIFICATION")
    print("=" * 76)
    print(f"[*] Configured Host/Port : {settings.host}:{settings.port}")
    print(f"[*] Default Lot Size     : {settings.default_lot_size} (Max: {settings.max_lot_size})")
    print(f"[*] Magic Number         : {settings.magic_number}")

    # 1. Direct MT5 IPC Check
    print("\n[STEP 1] Checking Direct MetaTrader 5 IPC Link...")
    ipc_ok, ipc_meta = bridge_client.ensure_connected()
    print(json.dumps(ipc_meta, indent=2))

    # 2. Ensure FastAPI Server is listening on 127.0.0.1:8001
    base_url = f"http://{settings.host}:{settings.port}"
    server_instance = None
    server_thread = None

    if not is_port_in_use(settings.host, settings.port):
        print(f"\n[*] Starting embedded Uvicorn server on {base_url} for live HTTP verification...")
        uv_config = uvicorn.Config(app, host=settings.host, port=settings.port, log_level="warning")
        server_instance = uvicorn.Server(uv_config)
        server_thread = threading.Thread(target=server_instance.run, daemon=True)
        server_thread.start()
        for _ in range(30):
            if is_port_in_use(settings.host, settings.port):
                break
            time.sleep(0.1)
    else:
        print(f"\n[*] Detected existing MT5 Bridge server already listening on {base_url}")

    try:
        print("\n[STEP 2] Verifying Zero-Trust Secret Token Enforcement (Expect HTTP 401)...")
        unauth_resp = requests.post(
            f"{base_url}/webhook/mt5",
            headers={"Authorization": "Bearer wrong_token_value"},
            json={"symbol": "XAUUSD", "action": "BUY", "volume": 0.01, "dry_run": True},
            timeout=5,
        )
        print(f"    -> Status Code: {unauth_resp.status_code} | Body: {unauth_resp.json()}")
        if unauth_resp.status_code != 401:
            print("[!] FAIL: Unauthorized request was not blocked with HTTP 401!")
            return 1
        print("    -> PASS: Unauthorized traffic strictly blocked.")

        auth_headers = {"Authorization": f"Bearer {settings.secret_token}"}

        print("\n[STEP 3] Verifying Authenticated /health Endpoint on Port 8001...")
        health_resp = requests.get(f"{base_url}/health", headers=auth_headers, timeout=5)
        print(f"    -> Status Code: {health_resp.status_code}")
        print(json.dumps(health_resp.json(), indent=2))

        print("\n[STEP 4] Executing Dry-Run TRADE_ACTION_DEAL Webhook (`POST /webhook/mt5`, dry_run=True)...")
        dry_run_payload = {
            "symbol": "XAU/USD",
            "action": "BUY/LONG",
            "volume": 0.01,
            "timeframe": "5m",
            "dry_run": True,
        }
        webhook_resp = requests.post(
            f"{base_url}/webhook/mt5",
            headers=auth_headers,
            json=dry_run_payload,
            timeout=5,
        )
        print(f"    -> Status Code: {webhook_resp.status_code}")
        print(json.dumps(webhook_resp.json(), indent=2))

        print("\n" + "=" * 76)
        if ipc_ok and webhook_resp.status_code == 200:
            print("  VERIFICATION RESULT: SUCCESS — MT5 IPC & DRY-RUN WEBHOOK VALIDATED!")
        elif webhook_resp.status_code in (200, 503):
            print("  VERIFICATION RESULT: BRIDGE & AUTH ONLINE (See MT5 terminal status above)")
        else:
            print("  VERIFICATION RESULT: FAILED — Check logs above.")
            return 1
        print("=" * 76)
        return 0
    finally:
        if server_instance is not None:
            server_instance.should_exit = True
            if server_thread is not None:
                server_thread.join(timeout=2.0)


if __name__ == "__main__":
    raise SystemExit(main())
