import time
import math
import random
import asyncio
import json
from typing import List, Dict
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import backend.engine as engine

ws_router = APIRouter()

class ConnectionManager:
    def __init__(self):
        # Map symbol -> list of connected WebSockets
        self.active_connections: Dict[str, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, symbol: str):
        await websocket.accept()
        clean = engine.clean_symbol_string(symbol)
        if clean not in self.active_connections:
            self.active_connections[clean] = []
        self.active_connections[clean].append(websocket)

    def disconnect(self, websocket: WebSocket, symbol: str):
        clean = engine.clean_symbol_string(symbol)
        if clean in self.active_connections:
            if websocket in self.active_connections[clean]:
                self.active_connections[clean].remove(websocket)

    async def broadcast_to_symbol(self, symbol: str, message: str):
        clean = engine.clean_symbol_string(symbol)
        if clean in self.active_connections:
            for connection in list(self.active_connections[clean]):
                try:
                    await connection.send_text(message)
                except Exception:
                    self.disconnect(connection, symbol)

manager = ConnectionManager()

@ws_router.websocket("/ws/candles/{symbol:path}")
async def websocket_candles_endpoint(websocket: WebSocket, symbol: str, timeframe: str = "1m"):
    clean = engine.clean_symbol_string(symbol)
    await manager.connect(websocket, clean)
    
    try:
        while True:
            now_float = time.time()
            now_sec = int(now_float)
            step_sec = engine.TIMEFRAME_STEP_SECONDS.get(timeframe, 60)
            
            # AUTO-INCREMENT TIME TO NEW MINUTE BAR IN REAL TIME
            bar_ts = (now_sec // step_sec) * step_sec
            
            # Fetch latest authentic candles & support/resistance
            df = engine.fetch_ohlcv(symbol=symbol, timeframe=timeframe, limit=100)
            support, resistance, df = engine.calculate_support_resistance(df)
            
            latest_candle = df.iloc[-1]
            last_price = float(latest_candle['close'])
            last_open = float(latest_candle['open'])
            last_high = float(latest_candle['high'])
            last_low = float(latest_candle['low'])
            
            base_price, precision = engine.get_asset_base_config(symbol)
            spread = 0.0002 if precision == 4 else 0.20
            
            # Continuous live ticking simulation on the active forming bar
            tick_scale = 0.0002 if precision == 4 else 0.35
            tick_delta = (math.sin(now_float * 3.5) * tick_scale) + (random.uniform(-0.5, 0.5) * tick_scale)
            live_price = max(0.0001, round(last_price + tick_delta, precision))
            
            live_high = max(last_high, live_price)
            live_low = min(last_low, live_price)
            
            payload = {
                "symbol": symbol,
                "timeframe": timeframe,
                "time": bar_ts,  # Auto-advances to 11:55, 11:56, 11:57... in real time!
                "price": live_price,
                "open": round(last_open, precision),
                "high": round(live_high, precision),
                "low": round(live_low, precision),
                "close": live_price,
                "volume": round(float(latest_candle['volume']), 2),
                "support": round(support, precision),
                "resistance": round(resistance, precision),
                "bid": round(live_price - spread, precision),
                "ask": round(live_price + spread, precision),
                "timestamp_ms": int(now_float * 1000)
            }
            
            await websocket.send_text(json.dumps(payload))
            await asyncio.sleep(0.25)  # High-frequency 4Hz tick stream
    except WebSocketDisconnect:
        manager.disconnect(websocket, clean)
    except Exception as e:
        manager.disconnect(websocket, clean)
