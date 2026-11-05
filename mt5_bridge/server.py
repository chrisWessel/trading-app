"""
FastAPI Local MT5 Webhook Bridge (`mt5_bridge/server.py`).
Binds explicitly to 127.0.0.1:8001 (avoiding port 8000 used by main backend) and
enforces constant-time secret Authorization token verification on all incoming webhooks.
"""

import secrets
import sys
import threading
from pathlib import Path
from typing import Optional

from fastapi import Body, Depends, FastAPI, Header, HTTPException, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

# Runtime Auto-Bot Armed State (True = Ready/Active, False = Stopped by Kill-Switch)
BOT_RUNTIME_STATE = {
    "bot_armed": True,
    "auto_bot_enabled": False,
}

# Ensure local imports inside mt5_bridge/ resolve cleanly regardless of cwd
BRIDGE_DIR = Path(__file__).resolve().parent
if str(BRIDGE_DIR) not in sys.path:
    sys.path.insert(0, str(BRIDGE_DIR))

from config import settings  # noqa: E402
from schemas import WebhookOrderRequest, OrderExecutionResponse  # noqa: E402
from mt5_client import bridge_client  # noqa: E402
from tunnel_manager import (  # noqa: E402
    read_saved_tunnel_url,
    start_or_get_cloudflare_tunnel,
    persist_and_push_tunnel,
)

app = FastAPI(
    title="WesSignal Local MT5 Execution Bridge",
    description="Zero-trust FastAPI + MetaTrader5 IPC webhook bridge for Vercel trade signals.",
    version="1.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Bridge-Token", "Access-Control-Request-Private-Network"],
)


@app.middleware("http")
async def add_private_network_cors_headers(request: Request, call_next):
    """
    Allows Chrome/Edge on an HTTPS Vercel domain to directly call http://127.0.0.1:8001
    via Private Network Access (PNA) preflight headers.
    """
    if request.method == "OPTIONS":
        return Response(
            status_code=204,
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Bridge-Token, Access-Control-Request-Private-Network",
                "Access-Control-Allow-Private-Network": "true",
            },
        )
    response = await call_next(request)
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response


@app.on_event("startup")
def auto_start_tunnel_on_boot():
    """
    Automatically starts the Cloudflare Quick Tunnel and pushes the new URL to GitHub/Vercel
    whenever server.py boots up, so the user never sees 'fetch failed' after a PC restart.
    """
    def _bg_boot():
        try:
            tunnel_ok, tunnel_url, _ = start_or_get_cloudflare_tunnel()
            if tunnel_ok and tunnel_url:
                persist_and_push_tunnel(tunnel_url)
        except Exception:
            pass

    threading.Thread(target=_bg_boot, daemon=True).start()


def verify_secret_token(
    authorization: Optional[str] = Header(default=None),
    x_bridge_token: Optional[str] = Header(default=None),
) -> str:
    """
    Hard security constraint: blocks any request that does not carry the exact
    MT5_BRIDGE_SECRET_TOKEN configured in `mt5_bridge/.env`.
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


@app.get("/bars")
def bridge_live_bars(symbol: str = "XAU/USD", timeframe: str = "5m", limit: int = 120):
    """
    Read-only live OHLCV bars + Bid/Ask tick endpoint directly from the Exness MT5 terminal.
    Ensures the Signal Navigator and Stop Loss always match the live MT5 chart price.
    """
    return bridge_client.get_live_bars(symbol=symbol, timeframe=timeframe, limit=limit)


@app.get("/health", dependencies=[Depends(verify_secret_token)])
def bridge_health():
    """Authenticated health endpoint verifying live IPC connectivity to the Windows MT5 terminal."""
    ok, meta = bridge_client.ensure_connected()
    tunnel_url = read_saved_tunnel_url()
    open_positions = bridge_client.list_open_positions() if ok else []
    return {
        "bridge": "online",
        "port": settings.port,
        "bot_armed": BOT_RUNTIME_STATE["bot_armed"],
        "auto_bot_enabled": BOT_RUNTIME_STATE["auto_bot_enabled"],
        "open_positions_count": len(open_positions),
        "open_positions": open_positions,
        "tunnel_url": tunnel_url,
        "webhook_url": f"{tunnel_url}/webhook/mt5" if tunnel_url else None,
        "mt5_ipc_connected": ok,
        "mt5_terminal": meta,
    }


@app.post("/bridge/execute-sync", dependencies=[Depends(verify_secret_token)])
def execute_bridge_and_sync_git():
    """
    Button 1 ("Execute Bridge & Sync to Git/Vercel"):
      1. Re-arms the MT5 bridge (`bot_armed = True`).
      2. Verifies MT5 IPC connection to the local Windows MT5 terminal.
      3. Starts (or verifies) the Cloudflare Quick Tunnel (`cloudflared tunnel --url http://127.0.0.1:8001`).
      4. Writes the generated `https://*.trycloudflare.com` URL to `frontend/public/mt5_tunnel.json`.
      5. Commits and pushes `frontend/public/mt5_tunnel.json` to `origin/main` so Vercel automatically
         receives the new tunnel URL and redeploys!
    """
    BOT_RUNTIME_STATE["bot_armed"] = True
    mt5_ok, mt5_meta = bridge_client.ensure_connected()
    tunnel_ok, tunnel_url, tunnel_msg = start_or_get_cloudflare_tunnel()
    if not tunnel_ok or not tunnel_url:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "status": "error",
                "message": tunnel_msg,
                "mt5_terminal": mt5_meta,
            },
        )

    sync_data = persist_and_push_tunnel(tunnel_url, mt5_meta)
    return {
        "status": "synced",
        "bot_armed": True,
        "message": tunnel_msg,
        "tunnel_url": sync_data["tunnel_url"],
        "webhook_url": sync_data["webhook_url"],
        "mt5_ipc_connected": mt5_ok,
        "mt5_terminal": mt5_meta,
        "git_sync": sync_data["git_sync"],
        "updated_at_utc": sync_data["updated_at_utc"],
    }


@app.post("/bridge/cancel-close", dependencies=[Depends(verify_secret_token)])
def cancel_or_close_trade(payload: dict = Body(default={})):
    """
    Button 3 ("Cancel / Close Trade"):
    Closes open position(s) and cancels pending orders on MT5 for the specified symbol
    (or all symbols if `close_all: true`).
    """
    symbol = payload.get("symbol")
    ticket = payload.get("ticket")
    close_all = bool(payload.get("close_all", False))
    return bridge_client.close_positions_and_cancel_orders(
        symbol=symbol,
        ticket=ticket,
        close_all=close_all,
    )


@app.post("/bridge/modify-position", dependencies=[Depends(verify_secret_token)])
def modify_open_position(payload: dict = Body(default={})):
    """
    Autonomous Bot SL/TP Modifier:
    Moves an open MT5 position's Stop Loss to Breakeven (`move_to_breakeven: true`)
    or updates `sl` / `tp` dynamically as price moves into profit.
    """
    ticket = int(payload.get("ticket", 0) or 0)
    if ticket <= 0:
        raise HTTPException(status_code=400, detail="Valid 'ticket' is required.")
    sl = payload.get("sl")
    tp = payload.get("tp")
    move_to_breakeven = bool(payload.get("move_to_breakeven", False))
    return bridge_client.modify_position_sl_tp(
        ticket=ticket,
        sl=float(sl) if sl is not None else None,
        tp=float(tp) if tp is not None else None,
        move_to_breakeven=move_to_breakeven,
    )


@app.post("/bridge/stop-bot", dependencies=[Depends(verify_secret_token)])
def stop_bot_and_close_all(payload: dict = Body(default={})):
    """
    Button 4 ("Stop Bot / Emergency Kill-Switch"):
    1. Disarms the auto-bot (`bot_armed = False`, `auto_bot_enabled = False`) so no new trades are opened.
    2. Closes all open positions & cancels all pending orders on MT5 (unless `close_all_trades` is explicitly False).
    """
    BOT_RUNTIME_STATE["bot_armed"] = False
    BOT_RUNTIME_STATE["auto_bot_enabled"] = False
    close_all_trades = bool(payload.get("close_all_trades", True))
    close_report = (
        bridge_client.close_positions_and_cancel_orders(close_all=True)
        if close_all_trades
        else {"closed_positions_count": 0, "cancelled_orders_count": 0, "message": "Bot disarmed without closing open trades."}
    )
    return {
        "status": "stopped",
        "bot_armed": False,
        "auto_bot_enabled": False,
        "message": f"🛑 Auto-Bot STOPPED & Disarmed. {close_report.get('message', '')}",
        "close_report": close_report,
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
    Button 2 ("Place Order / Trade Now") & Primary Webhook Endpoint:
    Validates secret token, resolves symbol, checks live ask/bid tick,
    applies volumetric fallbacks, and dispatches `TRADE_ACTION_DEAL` via MT5 IPC.
    """
    result = bridge_client.execute_market_deal(payload)
    if result.status == "error":
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=result.model_dump())
    return result


if __name__ == "__main__":
    uvicorn.run(
        app,
        host=settings.host,
        port=settings.port,
        workers=1,
        reload=False,
    )
