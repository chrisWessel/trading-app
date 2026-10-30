"""
Pydantic v2 Request & Response Schemas for `mt5_bridge/schemas.py`.
"""

from typing import Literal, Optional, Any
from pydantic import BaseModel, Field, field_validator


class WebhookOrderRequest(BaseModel):
    symbol: str = Field(
        ...,
        description="Instrument symbol from Vercel webhook (e.g., 'XAU/USD', 'XAUUSD', 'BTCUSD', 'EURUSD').",
        examples=["XAUUSD"],
    )
    action: str = Field(
        ...,
        description="Trade direction: 'BUY', 'LONG', 'BUY/LONG', 'SELL', 'SHORT', or 'SELL/SHORT'.",
        examples=["BUY"],
    )
    volume: Optional[float] = Field(
        default=None,
        gt=0,
        description="Requested lot size. Falls back to DEFAULT_LOT_SIZE and broker volume_min/step if omitted.",
        examples=[0.01],
    )
    stop_loss: Optional[float] = Field(
        default=None,
        ge=0,
        alias="sl",
        description="Optional Stop Loss price level.",
    )
    take_profit: Optional[float] = Field(
        default=None,
        ge=0,
        alias="tp",
        description="Optional Take Profit price level.",
    )
    timeframe: Optional[str] = Field(
        default="5m",
        description="Signal timeframe for order tagging/commenting.",
    )
    deviation: Optional[int] = Field(
        default=None,
        ge=0,
        le=500,
        description="Max allowed slippage in points (overrides MAX_SLIPPAGE_POINTS if provided).",
    )
    magic: Optional[int] = Field(
        default=None,
        description="Custom MT5 Expert Advisor Magic Number.",
    )
    comment: Optional[str] = Field(
        default=None,
        max_length=31,
        description="Custom MT5 order comment (max 31 chars per MetaQuotes spec).",
    )
    dry_run: bool = Field(
        default=False,
        description="If True, runs full IPC symbol resolution, live tick check, margin check, and order_check without dispatching order_send.",
    )

    model_config = {
        "populate_by_name": True,
        "extra": "ignore",
    }

    @field_validator("action")
    @classmethod
    def normalize_action(cls, v: str) -> str:
        clean = v.strip().upper()
        if clean in {"BUY", "LONG", "BUY/LONG", "BUY_NOW", "BULLISH"}:
            return "BUY"
        if clean in {"SELL", "SHORT", "SELL/SHORT", "SELL_NOW", "BEARISH"}:
            return "SELL"
        raise ValueError(
            f"Unsupported trade action '{v}'. Must be BUY/LONG or SELL/SHORT."
        )


class ClosePositionRequest(BaseModel):
    ticket: Optional[int] = Field(
        default=None,
        description="Specific position ticket ID to close. If omitted, closes all open positions matching `symbol`.",
    )
    symbol: Optional[str] = Field(
        default=None,
        description="Optional symbol filter when closing open positions.",
    )


class OrderExecutionResponse(BaseModel):
    status: Literal["executed", "dry_run_validated", "rejected", "error"]
    symbol_requested: str
    symbol_resolved: str
    direction: Literal["BUY", "SELL"]
    volume_requested: Optional[float]
    volume_normalized: float
    volumetric_fallback_note: Optional[str] = None
    live_tick: dict[str, Any]
    request_payload: dict[str, Any]
    retcode: Optional[int] = None
    retcode_name: str
    deal_ticket: Optional[int] = None
    order_ticket: Optional[int] = None
    executed_price: Optional[float] = None
    executed_volume: Optional[float] = None
    sl: Optional[float] = None
    tp: Optional[float] = None
    broker_comment: Optional[str] = None
    mt5_last_error: Optional[Any] = None
    timestamp_utc: str

