"""
Isolated Configuration Loader for the Local MT5 Bridge (`mt5_bridge/config.py`).
Reads all credentials, port bindings, and risk limits strictly from `mt5_bridge/.env`.
"""

import os
from dataclasses import dataclass
from pathlib import Path
from dotenv import load_dotenv

BRIDGE_DIR = Path(__file__).resolve().parent
ENV_FILE = BRIDGE_DIR / ".env"

# Load mt5_bridge/.env explicitly so running from any working directory works reliably
load_dotenv(dotenv_path=ENV_FILE, override=True)


@dataclass(frozen=True)
class BridgeSettings:
    secret_token: str
    host: str
    port: int
    default_lot_size: float
    max_lot_size: float
    max_slippage_points: int
    magic_number: int
    order_comment_prefix: str
    mt5_terminal_path: str
    mt5_login: int | None
    mt5_password: str
    mt5_server: str
    cloudflare_tunnel_token: str


def load_settings() -> BridgeSettings:
    raw_token = os.getenv("MT5_BRIDGE_SECRET_TOKEN", "").strip()
    if not raw_token:
        raise RuntimeError(
            f"CRITICAL SECURITY ERROR: MT5_BRIDGE_SECRET_TOKEN is missing or empty in {ENV_FILE}."
        )

    raw_login = os.getenv("MT5_LOGIN", "").strip()
    parsed_login = int(raw_login) if raw_login.isdigit() else None

    return BridgeSettings(
        secret_token=raw_token,
        host=os.getenv("MT5_BRIDGE_HOST", "127.0.0.1").strip() or "127.0.0.1",
        port=int(os.getenv("MT5_BRIDGE_PORT", "8001").strip() or "8001"),
        default_lot_size=float(os.getenv("DEFAULT_LOT_SIZE", "0.01").strip() or "0.01"),
        max_lot_size=float(os.getenv("MAX_LOT_SIZE", "5.00").strip() or "5.00"),
        max_slippage_points=int(os.getenv("MAX_SLIPPAGE_POINTS", "20").strip() or "20"),
        magic_number=int(os.getenv("MAGIC_NUMBER", "202605").strip() or "202605"),
        order_comment_prefix=os.getenv("ORDER_COMMENT_PREFIX", "WesSignal").strip() or "WesSignal",
        mt5_terminal_path=os.getenv("MT5_TERMINAL_PATH", "").strip(),
        mt5_login=parsed_login,
        mt5_password=os.getenv("MT5_PASSWORD", "").strip(),
        mt5_server=os.getenv("MT5_SERVER", "").strip(),
        cloudflare_tunnel_token=os.getenv("CLOUDFLARE_TUNNEL_TOKEN", "").strip(),
    )


settings = load_settings()

