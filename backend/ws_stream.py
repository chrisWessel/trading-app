import time
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
            
            # Fetch latest candles & support/resistance
            df = engine.fetch_ohlcv(symbol=symbol, timeframe=timeframe, limit=100)
            support, resistance, df = engine.calculate_support_resistance(df)
            
            latest_candle = df.iloc[-1]
            last_price = float(latest_candle['close'])
            last_open = float(latest_candle['open'])
            last_high = float(latest_candle['high'])
            last_low = float(latest_candle['low'])
            
            _, precision = engine.get_asset_base_config(symbol)
            data_source = df.attrs.get('data_source', 'unknown')
            
            payload = {
                "symbol": symbol,
                "timeframe": timeframe,
                "time": bar_ts,
                "price": last_price,
                "open": round(last_open, precision),
                "high": round(last_high, precision),
                "low": round(last_low, precision),
                "close": last_price,
                "volume": round(float(latest_candle['volume']), 2),
                "support": round(support, precision),
                "resistance": round(resistance, precision),
                "data_source": data_source,
                "timestamp_ms": int(now_float * 1000)
            }
            
            await websocket.send_text(json.dumps(payload))
            await asyncio.sleep(5)
    except WebSocketDisconnect:
        manager.disconnect(websocket, clean)
    except Exception as e:
        manager.disconnect(websocket, clean)
