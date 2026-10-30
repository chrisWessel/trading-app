"""
FastAPI Local MT5 Webhook Bridge (`mt5_bridge/server.py`).
Binds explicitly to 127.0.0.1:8001 (avoiding port 8000 used by main backend) and
enforces constant-time secret Authorization token verification on all incoming webhooks.
"""

import secrets
import sys
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

# Ensure local imports inside mt5_bridge/ resolve cleanly regardless of cwd
BRIDGE_DIR = Path(__file__).resolve().parent
if str(BRIDGE_DIR) not in sys.path:
    sys.path.insert(0, str(BRIDGE_DIR))

from config import settings  # noqa: E402
from schemas import WebhookOrderRequest, OrderExecutionResponse  # noqa: E402
from mt5_client import bridge_client  # noqa: E402

app = FastAPI(
    title="WesSignal Local MT5 Execution Bridge",
    description="Zero-trust FastAPI + MetaTrader5 IPC webhook bridge for Vercel trade signals.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Bridge-Token"],
)


def verify_secret_token(
    authorization: Optional[str] = Header(default=None),
    x_bridge_token: Optional[str] = Header(default=None),
) -> str:
    """
    Hard security constraint: blocks any request that does not carry the exact
    MT5_BRIDGE_SECRET_TOKEN configured in `mt5_bridge/.env`.
    Accepts either:
      - `Authorization: Bearer <token>`
      - `Authorization: <token>`
      - `X-Bridge-Token: <token>`
    """
    extracted = ""
    if authorization:
        parts = authorization.strip().split(" ", 1)
        if len(parts) == 2 and parts[0].lower() == "bearer":
            extracted = parts[1].strip()
        else:
            extracted = authorization.strip()
    elif x_bridge_token:
        extracted = x_bridge_token.strip()

    if not extracted or not secrets.compare_digest(extracted, settings.secret_token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized: invalid or missing MT5_BRIDGE_SECRET_TOKEN.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return extracted


@app.get("/health", dependencies=[Depends(verify_secret_token)])
def bridge_health():
    """Authenticated health endpoint verifying live IPC connectivity to the Windows MT5 terminal."""
    ok, meta = bridge_client.ensure_connected()
    return {
        "bridge": "online",
        "port": settings.port,
        "mt5_ipc_connected": ok,
        "mt5_terminal": meta,
    }


@app.get("/tick/{symbol}", dependencies=[Depends(verify_secret_token)])
def get_live_tick(symbol: str):
    """Authenticated endpoint returning the current MT5 bid/ask tick and volume specs for a symbol."""
    import MetaTrader5 as mt5

    ok, meta = bridge_client.ensure_connected()
    if not ok:
        raise HTTPException(status_code=503, detail=meta)

    resolved, sym_info = bridge_client.resolve_broker_symbol(symbol)
    if not resolved or sym_info is None:
        raise HTTPException(status_code=404, detail=f"Symbol '{symbol}' not found in MT5 Market Watch.")

    tick = mt5.symbol_info_tick(resolved)
    if tick is None:
        raise HTTPException(status_code=503, detail=f"No live tick available for '{resolved}'.")

    return {
        "symbol_requested": symbol,
        "symbol_resolved": resolved,
        "bid": float(tick.bid),
        "ask": float(tick.ask),
        "spread_points": round((tick.ask - tick.bid) / max(float(sym_info.point), 1e-9), 1),
        "digits": int(sym_info.digits),
        "volume_min": float(sym_info.volume_min),
        "volume_max": float(sym_info.volume_max),
        "volume_step": float(sym_info.volume_step),
        "trade_stops_level": int(sym_info.trade_stops_level),
    }


@app.get("/positions", dependencies=[Depends(verify_secret_token)])
def get_open_positions(symbol: Optional[str] = None):
    """Authenticated endpoint listing open MT5 positions."""
    return {
        "status": "ok",
        "positions": bridge_client.list_open_positions(symbol=symbol),
    }


@app.post(
    "/webhook/mt5",
    response_model=OrderExecutionResponse,
    dependencies=[Depends(verify_secret_token)],
)
def execute_webhook_signal(payload: WebhookOrderRequest):
    """
    Primary webhook ingress endpoint called by the Vercel app.
    Validates secret token, resolves symbol, checks live ask/bid tick,
    applies volumetric fallbacks, and dispatches `TRADE_ACTION_DEAL` via MT5 IPC.
    """
    result = bridge_client.execute_market_deal(payload)
    if result.status == "error":
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=result.model_dump())
    return result


if __name__ == "__main__":
    uvicorn.run(
        "server:app",
        host=settings.host,
        port=settings.port,
        workers=1,
        reload=False,
    )

