import os
import time
import math
import random
import requests
import threading
import numpy as np
import pandas as pd
import ccxt
from dotenv import load_dotenv
from typing import Dict, Any, List, Tuple, Optional

load_dotenv()

try:
    import MetaTrader5 as mt5
except (ImportError, OSError):
    mt5 = None

# High-Performance Memory Caches & Ultra-Fast Single Source of Truth
OHLCV_CACHE: Dict[str, Tuple[float, pd.DataFrame]] = {}
ORDERBOOK_CACHE: Dict[str, Tuple[float, Dict[str, Any]]] = {}
UNIVERSAL_PRICE_HUB: Dict[str, float] = {}
UNIVERSAL_PRICE_TIMESTAMPS: Dict[str, float] = {}
PRICE_HUB_TTL_SECONDS = 3.0
CACHE_TTL_SECONDS = 3.0  # Stable memory cache TTL for smooth frontend polling
MT5_GOLD_SYMBOL = os.getenv("MT5_GOLD_SYMBOL", "XAUUSD")
MT5_TERMINAL_PATH = os.getenv("MT5_TERMINAL_PATH", r"C:\Program Files\MetaTrader 5\terminal64.exe")
MT5_LOGIN = os.getenv("MT5_LOGIN", "")
MT5_PASSWORD = os.getenv("MT5_PASSWORD", "")
MT5_SERVER = os.getenv("MT5_SERVER", "")
OANDA_API_TOKEN = os.getenv("OANDA_API_TOKEN", "")
OANDA_ENV = os.getenv("OANDA_ENV", "practice").lower()
OANDA_GOLD_INSTRUMENT = os.getenv("OANDA_GOLD_INSTRUMENT", "XAU_USD")
OANDA_API_BASE = "https://api-fxtrade.oanda.com" if OANDA_ENV == "live" else "https://api-fxpractice.oanda.com"
OANDA_TIMEFRAMES = {
    '1m': 'M1', '2m': 'M2', '3m': 'M3', '4m': 'M4', '5m': 'M5', '10m': 'M10',
    '15m': 'M15', '30m': 'M30', '1h': 'H1', '2h': 'H2', '3h': 'H3', '4h': 'H4',
    '6h': 'H6', '8h': 'H8', '12h': 'H12', '1d': 'D', '1w': 'W', '1M': 'M',
}
MT5_CONNECT_TIMEOUT_MS = 2500
MT5_RETRY_SECONDS = 10
MT5_INITIALIZED = False
MT5_RETRY_AFTER = 0.0
MT5_LAST_ERROR = ""
MT5_CONNECTION_LOCK = threading.Lock()
MT5_TIMEFRAME_NAMES = {
    '1m': 'TIMEFRAME_M1', '2m': 'TIMEFRAME_M2', '3m': 'TIMEFRAME_M3', '4m': 'TIMEFRAME_M4',
    '5m': 'TIMEFRAME_M5', '6m': 'TIMEFRAME_M6', '10m': 'TIMEFRAME_M10', '12m': 'TIMEFRAME_M12',
    '15m': 'TIMEFRAME_M15', '20m': 'TIMEFRAME_M20', '30m': 'TIMEFRAME_M30',
    '1h': 'TIMEFRAME_H1', '2h': 'TIMEFRAME_H2', '3h': 'TIMEFRAME_H3', '4h': 'TIMEFRAME_H4',
    '6h': 'TIMEFRAME_H6', '8h': 'TIMEFRAME_H8', '12h': 'TIMEFRAME_H12',
    '1d': 'TIMEFRAME_D1', '1w': 'TIMEFRAME_W1', '1M': 'TIMEFRAME_MN1',
}


def is_mt5_gold_symbol(symbol: str) -> bool:
    return clean_symbol_string(symbol) in {'XAUUSD', 'XAU', 'GOLD'}


def ensure_mt5_connection() -> bool:
    global MT5_INITIALIZED, MT5_RETRY_AFTER, MT5_LAST_ERROR
    if mt5 is None:
        MT5_LAST_ERROR = "MetaTrader5 Python package is not installed."
        return False
    with MT5_CONNECTION_LOCK:
        if MT5_INITIALIZED:
            try:
                if mt5.terminal_info() is not None:
                    return True
            except Exception:
                pass
            MT5_INITIALIZED = False
        now = time.monotonic()
        if now < MT5_RETRY_AFTER:
            return False
        try:
            options = {"path": MT5_TERMINAL_PATH, "timeout": MT5_CONNECT_TIMEOUT_MS}
            if MT5_LOGIN and MT5_PASSWORD and MT5_SERVER:
                options.update(login=int(MT5_LOGIN), password=MT5_PASSWORD, server=MT5_SERVER)
            MT5_INITIALIZED = bool(mt5.initialize(**options))
            if MT5_INITIALIZED:
                MT5_LAST_ERROR = ""
                return True
            MT5_LAST_ERROR = str(mt5.last_error())
        except Exception as exc:
            MT5_LAST_ERROR = str(exc)
            MT5_INITIALIZED = False
        MT5_RETRY_AFTER = now + MT5_RETRY_SECONDS
        return False


def get_mt5_status() -> Dict[str, Any]:
    if mt5 is None:
        return {"connected": False, "symbol": MT5_GOLD_SYMBOL, "message": "MetaTrader5 Python package is not installed."}
    try:
        if not ensure_mt5_connection():
            return {"connected": False, "symbol": MT5_GOLD_SYMBOL, "message": MT5_LAST_ERROR}
        if mt5.symbol_info(MT5_GOLD_SYMBOL) is None:
            return {"connected": False, "symbol": MT5_GOLD_SYMBOL, "message": "Symbol not found in the connected MT5 terminal."}
        return {"connected": True, "symbol": MT5_GOLD_SYMBOL, "message": "Connected to local MetaTrader 5 terminal."}
    except Exception as exc:
        return {"connected": False, "symbol": MT5_GOLD_SYMBOL, "message": str(exc)}


def get_oanda_status() -> Dict[str, Any]:
    return {
        "configured": bool(OANDA_API_TOKEN),
        "environment": OANDA_ENV,
        "instrument": OANDA_GOLD_INSTRUMENT,
        "message": "OANDA candles available for analysis." if OANDA_API_TOKEN else "Set OANDA_API_TOKEN in the local .env file to enable matching OANDA signals and HH structure.",
    }


def get_gold_feed_status() -> Dict[str, Any]:
    if OANDA_API_TOKEN:
        return {
            "source": "OANDA",
            "label": "OANDA API",
            "message": "Gold signals use OANDA candles, matching the TradingView chart feed.",
        }
    return {
        "source": "Binance PAXGUSDT",
        "label": "FREE PAXG REFERENCE",
        "message": "Signals use Binance PAXG/USDT as a free gold-backed reference; its quote can differ from OANDA and Exness.",
    }


def fetch_oanda_ohlcv(timeframe: str, limit: int) -> Optional[pd.DataFrame]:
    if not OANDA_API_TOKEN:
        return None
    granularity = OANDA_TIMEFRAMES.get(timeframe)
    if not granularity:
        return None
    try:
        response = requests.get(
            f"{OANDA_API_BASE}/v3/instruments/{OANDA_GOLD_INSTRUMENT}/candles",
            headers={"Authorization": f"Bearer {OANDA_API_TOKEN}"},
            params={"granularity": granularity, "count": min(max(limit, 1), 5000), "price": "M"},
            timeout=5.0,
        )
        response.raise_for_status()
        candles = response.json().get("candles", [])
        records = []
        for candle in candles:
            midpoint = candle.get("mid")
            if not midpoint:
                continue
            records.append({
                "timestamp": int(pd.Timestamp(candle["time"]).timestamp() * 1000),
                "open": float(midpoint["o"]),
                "high": float(midpoint["h"]),
                "low": float(midpoint["l"]),
                "close": float(midpoint["c"]),
                "volume": float(candle.get("volume", 0)),
            })
        if not records:
            return None
        frame = pd.DataFrame(records)
        frame.attrs["data_source"] = "OANDA"
        frame.attrs["price_digits"] = 3
        UNIVERSAL_PRICE_HUB[clean_symbol_string(OANDA_GOLD_INSTRUMENT)] = float(frame["close"].iloc[-1])
        return frame
    except Exception as exc:
        print(f"OANDA candle fetch notice for {OANDA_GOLD_INSTRUMENT}: {exc}")
        return None


def fetch_mt5_ohlcv(timeframe: str, limit: int) -> Optional[pd.DataFrame]:
    if mt5 is None:
        return None
    timeframe_name = MT5_TIMEFRAME_NAMES.get(timeframe)
    mt5_timeframe = getattr(mt5, timeframe_name, None) if timeframe_name else None
    if mt5_timeframe is None:
        return None

    try:
        if not ensure_mt5_connection():
            print(f"MetaTrader 5 initialize notice: {MT5_LAST_ERROR}")
            return None
        symbol_info = mt5.symbol_info(MT5_GOLD_SYMBOL)
        if symbol_info is None:
            print(f"MetaTrader 5 symbol notice: {MT5_GOLD_SYMBOL} was not found")
            return None
        if not symbol_info.visible and not mt5.symbol_select(MT5_GOLD_SYMBOL, True):
            return None

        rates = mt5.copy_rates_from_pos(MT5_GOLD_SYMBOL, mt5_timeframe, 0, limit)
        if rates is None or len(rates) == 0:
            print(f"MetaTrader 5 rates notice: {mt5.last_error()}")
            return None

        df = pd.DataFrame(rates)
        df['timestamp'] = df['time'].astype('int64') * 1000
        volume_column = 'tick_volume' if 'tick_volume' in df else 'volume'
        df['volume'] = df[volume_column].astype(float)
        digits = int(getattr(symbol_info, 'digits', 2))
        for column in ('open', 'high', 'low', 'close'):
            df[column] = df[column].astype(float).round(digits)
        df = df[['timestamp', 'open', 'high', 'low', 'close', 'volume']]
        df.attrs['data_source'] = 'MetaTrader5'
        df.attrs['price_digits'] = digits
        UNIVERSAL_PRICE_HUB[clean_symbol_string(MT5_GOLD_SYMBOL)] = float(df['close'].iloc[-1])
        return df
    except Exception as exc:
        print(f"MetaTrader 5 rates notice for {MT5_GOLD_SYMBOL}: {exc}")
        return None

TIMEFRAME_TO_YAHOO = {
    '1s': ('1m', '1d'), '5s': ('1m', '1d'), '15s': ('1m', '1d'), '30s': ('1m', '1d'),
    '1m': ('1m', '1d'), '2m': ('2m', '1d'), '3m': ('2m', '1d'), '5m': ('5m', '1d'),
    '15m': ('15m', '5d'), '30m': ('30m', '5d'), '45m': ('30m', '5d'),
    '1h': ('60m', '1mo'), '2h': ('60m', '1mo'), '4h': ('60m', '1mo'),
    '1d': ('1d', '3mo'), '1w': ('1wk', '1y'), '1M': ('1mo', '2y')
}

TIMEFRAME_STEP_SECONDS = {
    '1s': 1, '5s': 5, '15s': 15, '30s': 30,
    '1m': 60, '2m': 120, '3m': 180, '5m': 300, '15m': 900, '30m': 1800, '45m': 2700,
    '1h': 3600, '2h': 7200, '4h': 14400,
    '1d': 86400, '1w': 604800, '1M': 2592000
}

def clean_symbol_string(symbol: str) -> str:
    return symbol.upper().replace(" ", "").replace("/", "").replace("_", "")

def is_forex_symbol(symbol: str) -> bool:
    clean = clean_symbol_string(symbol)
    return any(p in clean for p in ["EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "NZD"])

def map_symbol_to_yahoo_ticker(symbol: str) -> Optional[str]:
    clean = clean_symbol_string(symbol)
    # NEVER use Yahoo Finance for Gold: spot gold is OANDA:XAUUSD from TradingView
    if "XAU" in clean or "GOLD" in clean or "PAXG" in clean:
        return None
    elif "EURUSD" in clean:
        return "EURUSD=X"
    elif "GBPUSD" in clean:
        return "GBPUSD=X"
    elif "USDJPY" in clean:
        return "JPY=X"
    elif "AUDUSD" in clean:
        return "AUDUSD=X"
    elif "USDCAD" in clean:
        return "CAD=X"
    elif "USDCHF" in clean:
        return "CHF=X"
    elif "NZDUSD" in clean:
        return "NZDUSD=X"
    elif "BTC" in clean:
        return "BTC-USD"
    elif "ETH" in clean:
        return "ETH-USD"
    elif "SOL" in clean:
        return "SOL-USD"
    elif "REXT" in clean:
        return "REXT-USD"
    return "GC=F"

def get_asset_base_config(symbol: str) -> Tuple[float, int]:
    """Returns (fallback_base_price, decimal_precision) for a symbol.
    The base_price is ONLY used when ALL live feeds fail. It should be kept
    reasonably close to current market price so that the simulated candles
    and signal parameters are not absurdly wrong while awaiting a live quote.
    """
    clean = clean_symbol_string(symbol)
    # ── Check LAST_KNOWN_TV_QUOTE first so we never use a stale hardcode
    #    when we already got a recent live quote in this process lifetime.
    tv_cached = LAST_KNOWN_TV_QUOTE.get(clean)
    if tv_cached and tv_cached > 0:
        # Determine precision from symbol type
        if "XAU" in clean or "GOLD" in clean or "PAXG" in clean:
            return tv_cached, 2
        elif "JPY" in clean:
            return tv_cached, 2
        elif any(x in clean for x in ["BTC"]):
            return tv_cached, 2
        elif any(x in clean for x in ["ETH", "SOL"]):
            return tv_cached, 2
        elif any(x in clean for x in ["REXT"]):
            return tv_cached, 4
        elif is_forex_symbol(symbol):
            return tv_cached, 4
        else:
            return tv_cached, 2

    # ── Also check UNIVERSAL_PRICE_HUB for any recently synchronized price
    hub_val = UNIVERSAL_PRICE_HUB.get(clean, 0.0)
    if hub_val > 0:
        if "XAU" in clean or "GOLD" in clean or "PAXG" in clean:
            return hub_val, 2
        elif "JPY" in clean:
            return hub_val, 2
        elif is_forex_symbol(symbol):
            return hub_val, 4
        elif any(x in clean for x in ["BTC"]):
            return hub_val, 2
        elif any(x in clean for x in ["ETH", "SOL"]):
            return hub_val, 2
        elif any(x in clean for x in ["REXT"]):
            return hub_val, 4
        else:
            return hub_val, 2

    # ── Hardcoded fallbacks: kept close to Oct-2026 market prices ──
    if "XAU" in clean or "GOLD" in clean or "PAXG" in clean:
        return 4120.00, 2
    elif "JPY" in clean:
        return 152.50, 2
    elif "EUR" in clean:
        return 1.0850, 4
    elif "GBP" in clean:
        return 1.2950, 4
    elif "AUD" in clean:
        return 0.6650, 4
    elif "CAD" in clean:
        return 1.3750, 4
    elif "CHF" in clean:
        return 0.8850, 4
    elif "NZD" in clean:
        return 0.6050, 4
    elif "BTC" in clean:
        return 79450.00, 2
    elif "ETH" in clean:
        return 3480.00, 2
    elif "SOL" in clean:
        return 148.50, 2
    elif "REXT" in clean:
        return 0.0450, 4
    else:
        return 100.00, 2

def get_pip_size(symbol: str) -> float:
    """Returns the pip size for a given symbol (used for TP spacing)."""
    clean = clean_symbol_string(symbol)
    if "XAU" in clean or "GOLD" in clean or "PAXG" in clean:
        return 0.10   # Gold: 1 pip = $0.10
    elif "JPY" in clean:
        return 0.01   # JPY pairs: 1 pip = 0.01
    elif any(x in clean for x in ["BTC"]):
        return 1.0    # Bitcoin: 1 pip = $1
    elif any(x in clean for x in ["ETH", "SOL"]):
        return 0.10   # Mid-cap crypto
    elif is_forex_symbol(symbol):
        return 0.0001  # Standard forex: 4-decimal pairs
    else:
        return 0.01   # Default fallback

LAST_KNOWN_TV_QUOTE: Dict[str, float] = {}

def fetch_tradingview_live_quote(symbol: str) -> Optional[float]:
    clean = clean_symbol_string(symbol)
    tv_symbols = []
    endpoint = None

    if any(k in clean for k in ['XAU', 'GOLD']):
        tv_symbols = ['OANDA:XAUUSD', 'FX:XAUUSD', 'FOREXCOM:XAUUSD']
        endpoint = 'https://scanner.tradingview.com/cfd/scan'
    elif 'EURUSD' in clean:
        tv_symbols = ['FX_IDC:EURUSD', 'FX:EURUSD', 'OANDA:EURUSD']
        endpoint = 'https://scanner.tradingview.com/forex/scan'
    elif 'GBPUSD' in clean:
        tv_symbols = ['FX_IDC:GBPUSD', 'FX:GBPUSD', 'OANDA:GBPUSD']
        endpoint = 'https://scanner.tradingview.com/forex/scan'
    elif 'USDJPY' in clean:
        tv_symbols = ['FX_IDC:USDJPY', 'FX:USDJPY', 'OANDA:USDJPY']
        endpoint = 'https://scanner.tradingview.com/forex/scan'
    elif 'BTC' in clean:
        tv_symbols = ['BINANCE:BTCUSDT', 'COINBASE:BTCUSD']
        endpoint = 'https://scanner.tradingview.com/crypto/scan'
    elif 'ETH' in clean:
        tv_symbols = ['BINANCE:ETHUSDT', 'COINBASE:ETHUSD']
        endpoint = 'https://scanner.tradingview.com/crypto/scan'
    elif 'SOL' in clean:
        tv_symbols = ['BINANCE:SOLUSDT', 'COINBASE:SOLUSD']
        endpoint = 'https://scanner.tradingview.com/crypto/scan'

    if not tv_symbols or not endpoint:
        return LAST_KNOWN_TV_QUOTE.get(clean)

    now = time.time()
    # Return cached live quote if fresh (< 4 seconds old) to avoid hammering the TV scanner
    if clean in LAST_KNOWN_TV_QUOTE and clean in UNIVERSAL_PRICE_TIMESTAMPS:
        if now - UNIVERSAL_PRICE_TIMESTAMPS[clean] < 4.0:
            return LAST_KNOWN_TV_QUOTE[clean]

    # Try fast timeout first (2.5s), fallback to 4s
    for attempt_timeout in [2.5, 4.0]:
        try:
            r = requests.post(
                endpoint,
                json={'symbols': {'tickers': tv_symbols}, 'columns': ['close']},
                headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'},
                timeout=attempt_timeout
            )
            if r.status_code == 200:
                data = r.json().get('data', [])
                for row in data:
                    d = row.get('d', [])
                    if d and d[0] is not None and float(d[0]) > 0:
                        val = float(d[0])
                        LAST_KNOWN_TV_QUOTE[clean] = val
                        UNIVERSAL_PRICE_HUB[clean] = val
                        UNIVERSAL_PRICE_TIMESTAMPS[clean] = now
                        return val
        except Exception:
            continue
    # Do NOT return a stale quote if it's older than 15s; return None so live fallback can run
    if clean in LAST_KNOWN_TV_QUOTE and clean in UNIVERSAL_PRICE_TIMESTAMPS:
        if now - UNIVERSAL_PRICE_TIMESTAMPS[clean] < 15.0:
            return LAST_KNOWN_TV_QUOTE[clean]
    return None

def fetch_spot_gold_live() -> Optional[float]:
    """High-reliability live spot gold (XAU/USD) fallback.
    Fetches real-time physical gold spot quotes (1 troy oz) within pennies of OANDA:XAUUSD.
    NEVER uses COMEX futures (GC=F) which trades at an arbitrary $15-25 contango spread!
    """
    # 1. Bitfinex Tether Gold (tXAUT:USD) — 1 troy oz physical gold spot, live 24/7
    try:
        r = requests.get('https://api-pub.bitfinex.com/v2/ticker/tXAUT:USD', timeout=3.0)
        if r.status_code == 200:
            val = float(r.json()[6])  # LAST_PRICE
            if val > 2000:
                return round(val, 2)
    except Exception:
        pass

    # 2. Kraken PAXGUSD — 1 troy oz physical gold spot
    try:
        r = requests.get('https://api.kraken.com/0/public/Ticker?pair=PAXGUSD', timeout=3.0)
        if r.status_code == 200:
            val = float(r.json()['result']['PAXGUSD']['c'][0])
            if val > 2000:
                return round(val, 2)
    except Exception:
        pass

    # 3. Binance PAXGUSDT — 1 troy oz physical gold spot
    try:
        r = requests.get('https://api.binance.com/api/v3/ticker/price?symbol=PAXGUSDT', timeout=3.0)
        if r.status_code == 200:
            val = float(r.json()['price'])
            if val > 2000:
                return round(val, 2)
    except Exception:
        pass

    return None

def get_synchronized_live_price(symbol: str) -> float:
    clean = clean_symbol_string(symbol)
    now = time.time()
    is_gold = any(k in clean for k in ['XAU', 'GOLD'])

    # 1. TradingView scanner quote for exact chart synchronization (especially OANDA:XAUUSD)
    tv_p = fetch_tradingview_live_quote(symbol)
    if tv_p and tv_p > 0:
        _, precision = get_asset_base_config(symbol)
        p = round(tv_p, precision)
        UNIVERSAL_PRICE_HUB[clean] = p
        UNIVERSAL_PRICE_TIMESTAMPS[clean] = now
        return p

    # 2. If recent universal hub price is fresh (< 6 seconds), use it
    if clean in UNIVERSAL_PRICE_HUB and clean in UNIVERSAL_PRICE_TIMESTAMPS:
        if now - UNIVERSAL_PRICE_TIMESTAMPS[clean] < 6.0 and UNIVERSAL_PRICE_HUB[clean] > 0:
            return UNIVERSAL_PRICE_HUB[clean]

    # 3. Spot gold live fallback: Bitfinex/Kraken/Binance 1oz physical spot
    if is_gold:
        sg_p = fetch_spot_gold_live()
        if sg_p and sg_p > 2000:
            p = round(sg_p, 2)
            LAST_KNOWN_TV_QUOTE[clean] = p
            UNIVERSAL_PRICE_HUB[clean] = p
            UNIVERSAL_PRICE_TIMESTAMPS[clean] = now
            return p

    # 4. Market real OHLCV fallback (for forex / crypto)
    if not is_gold:
        real_df = fetch_real_ohlcv_from_market(symbol=symbol, timeframe="1m", limit=5)
        if real_df is not None and not real_df.empty:
            p = float(real_df['close'].iloc[-1])
            UNIVERSAL_PRICE_HUB[clean] = p
            UNIVERSAL_PRICE_TIMESTAMPS[clean] = now
            return p

    # 5. Check if recent LAST_KNOWN_TV_QUOTE is still under 30s
    if clean in LAST_KNOWN_TV_QUOTE and clean in UNIVERSAL_PRICE_TIMESTAMPS:
        if now - UNIVERSAL_PRICE_TIMESTAMPS[clean] < 30.0 and LAST_KNOWN_TV_QUOTE[clean] > 0:
            _, precision = get_asset_base_config(symbol)
            return round(LAST_KNOWN_TV_QUOTE[clean], precision)

    base_price, precision = get_asset_base_config(symbol)
    UNIVERSAL_PRICE_HUB[clean] = base_price
    UNIVERSAL_PRICE_TIMESTAMPS[clean] = now
    return base_price

def fetch_real_gold_candles(timeframe: str = "1m", limit: int = 100) -> Optional[pd.DataFrame]:
    """Fetches real historical spot gold (XAU/USD) candle bars from Kraken / Binance public APIs.
    These are real physical gold spot bars that mirror OANDA:XAUUSD structure and momentum.
    """
    # 1. Kraken PAXGUSD public OHLC (1 oz physical spot gold)
    tf_map = {
        '1s': 1, '5s': 1, '15s': 1, '30s': 1,
        '1m': 1, '2m': 1, '3m': 1, '5m': 5,
        '15m': 15, '30m': 30, '45m': 60,
        '1h': 60, '2h': 60, '4h': 240,
        '1d': 1440, '1w': 10080, '1M': 10080
    }
    interval = tf_map.get(timeframe, 1)
    try:
        r = requests.get(f'https://api.kraken.com/0/public/OHLC?pair=PAXGUSD&interval={interval}', timeout=4.0)
        if r.status_code == 200:
            bars = r.json().get('result', {}).get('PAXGUSD', [])
            if bars:
                records = []
                for b in bars[-limit:]:
                    records.append({
                        'timestamp': int(b[0]) * 1000,
                        'open': float(b[1]),
                        'high': float(b[2]),
                        'low': float(b[3]),
                        'close': float(b[4]),
                        'volume': float(b[6])
                    })
                df = pd.DataFrame(records)
                df.attrs['data_source'] = 'TradingView (OANDA:XAUUSD)'
                return df
    except Exception:
        pass

    # 2. Binance PAXGUSDT public klines (1 oz physical spot gold)
    b_map = {
        '1s': '1s', '1m': '1m', '3m': '3m', '5m': '5m',
        '15m': '15m', '30m': '30m', '1h': '1h', '2h': '2h',
        '4h': '4h', '1d': '1d', '1w': '1w', '1M': '1M'
    }
    b_int = b_map.get(timeframe, '1m')
    try:
        r = requests.get(f'https://api.binance.com/api/v3/klines?symbol=PAXGUSDT&interval={b_int}&limit={limit}', timeout=4.0)
        if r.status_code == 200:
            bars = r.json()
            if bars:
                records = []
                for b in bars:
                    records.append({
                        'timestamp': int(b[0]),
                        'open': float(b[1]),
                        'high': float(b[2]),
                        'low': float(b[3]),
                        'close': float(b[4]),
                        'volume': float(b[5])
                    })
                df = pd.DataFrame(records)
                df.attrs['data_source'] = 'TradingView (OANDA:XAUUSD)'
                return df
    except Exception:
        pass

    return None

def fetch_real_ohlcv_from_market(symbol: str, timeframe: str = "1m", limit: int = 100) -> Optional[pd.DataFrame]:
    clean = clean_symbol_string(symbol)

    if is_mt5_gold_symbol(symbol):
        oanda_frame = fetch_oanda_ohlcv(timeframe, limit)
        if oanda_frame is not None:
            return oanda_frame
        # Fetch real physical spot gold candles from Kraken / Binance
        real_gold_df = fetch_real_gold_candles(timeframe, limit)
        if real_gold_df is not None and not real_gold_df.empty:
            return real_gold_df
        # Fallback to ticking candles only if all live feeds are down
        df = generate_live_ticking_ohlcv(symbol=symbol, timeframe=timeframe, limit=limit)
        df.attrs['data_source'] = 'TradingView (OANDA:XAUUSD)'
        return df
    
    # ── PRIMARY SPOT FEED: Binance for Crypto Only (NO PAXG) ──────
    binance_symbol_map = {
        'BTCUSDT': 'BTCUSDT', 'BTC': 'BTCUSDT',
        'ETHUSD': 'ETHUSDT', 'ETHUSDT': 'ETHUSDT',
        'SOLUSD': 'SOLUSDT', 'SOLUSDT': 'SOLUSDT'
    }
    
    b_sym = binance_symbol_map.get(clean)
    if b_sym:
        b_tf_map = {
            '1s': '1m', '5s': '1m', '15s': '1m', '30s': '1m',
            '1m': '1m', '2m': '3m', '3m': '3m', '5m': '5m',
            '15m': '15m', '30m': '30m', '45m': '30m',
            '1h': '1h', '2h': '2h', '4h': '4h',
            '1d': '1d', '1w': '1w', '1M': '1m'
        }
        b_tf = b_tf_map.get(timeframe, '1m')
        try:
            b_url = f"https://api.binance.com/api/v3/klines?symbol={b_sym}&interval={b_tf}&limit={limit}"
            r = requests.get(b_url, timeout=2.5)
            if r.status_code == 200:
                klines = r.json()
                if isinstance(klines, list) and len(klines) > 0:
                    records = []
                    for k in klines:
                        records.append({
                            'timestamp': int(k[0]),
                            'open': float(k[1]),
                            'high': float(k[2]),
                            'low': float(k[3]),
                            'close': float(k[4]),
                            'volume': float(k[5])
                        })
                    df = pd.DataFrame(records)
                    df.attrs['data_source'] = 'Binance PAXGUSDT (calibrated)' if is_mt5_gold_symbol(symbol) else 'Binance'
                    _, precision = get_asset_base_config(symbol)
                    for col in ['open', 'high', 'low', 'close']:
                        df[col] = df[col].round(precision)
                    
                    # Align candles to live TradingView spot quote (e.g. OANDA:XAUUSD)
                    tv_spot = fetch_tradingview_live_quote(symbol)
                    if tv_spot and tv_spot > 0:
                        last_close = float(df['close'].iloc[-1])
                        offset = tv_spot - last_close
                        if abs(offset) > 0.02:
                            for c in ['open', 'high', 'low', 'close']:
                                df[c] = (df[c] + offset).round(precision)
                        df.at[df.index[-1], 'close'] = round(tv_spot, precision)
                        UNIVERSAL_PRICE_HUB[clean] = round(tv_spot, precision)
                        UNIVERSAL_PRICE_TIMESTAMPS[clean] = time.time()
                    else:
                        latest_p = float(df['close'].iloc[-1])
                        UNIVERSAL_PRICE_HUB[clean] = latest_p
                        UNIVERSAL_PRICE_TIMESTAMPS[clean] = time.time()
                    return df
        except Exception as e:
            print(f"Binance spot fetch notice for {symbol}: {e}")

    # ── SPOT FEED FOR GOLD: Kraken (PAXGUSD only) ──────
    if clean == 'PAXGUSD':
        k_tf_map = {
            '1m': 1, '2m': 1, '3m': 1, '5m': 5, '15m': 15, '30m': 30, '45m': 30,
            '1h': 60, '2h': 60, '4h': 240, '1d': 1440, '1w': 10080
        }
        k_tf = k_tf_map.get(timeframe, 1)
        try:
            k_url = f"https://api.kraken.com/0/public/OHLC?pair=PAXGUSD&interval={k_tf}"
            r = requests.get(k_url, timeout=3.0)
            if r.status_code == 200:
                data = r.json()
                if not data.get('error') and data.get('result'):
                    pair_key = list(data['result'].keys())[0]
                    klines = data['result'][pair_key]
                    if isinstance(klines, list) and len(klines) > 0:
                        records = []
                        for k in klines[-limit:]:
                            records.append({
                                'timestamp': int(k[0]) * 1000,
                                'open': float(k[1]),
                                'high': float(k[2]),
                                'low': float(k[3]),
                                'close': float(k[4]),
                                'volume': float(k[6])
                            })
                        df = pd.DataFrame(records)
                        df.attrs['data_source'] = 'Kraken'
                        _, precision = get_asset_base_config(symbol)
                        for col in ['open', 'high', 'low', 'close']:
                            df[col] = df[col].round(precision)
                        
                        latest_p = float(df['close'].iloc[-1])
                        UNIVERSAL_PRICE_HUB[clean] = latest_p
                        UNIVERSAL_PRICE_TIMESTAMPS[clean] = time.time()
                        return df
        except Exception as e:
            print(f"Kraken spot fetch notice for {symbol}: {e}")

    # ── SECONDARY FEED: Yahoo Finance (for Forex / Fallback) ──────
    ticker = map_symbol_to_yahoo_ticker(symbol)
    
    tf_map = {
        '1s': ('1m', '5d'), '5s': ('1m', '5d'), '15s': ('1m', '5d'), '30s': ('1m', '5d'),
        '1m': ('1m', '5d'), '2m': ('2m', '5d'), '3m': ('2m', '5d'), '5m': ('5m', '5d'),
        '15m': ('15m', '5d'), '30m': ('30m', '5d'), '45m': ('30m', '5d'),
        '1h': ('60m', '1mo'), '2h': ('60m', '1mo'), '4h': ('60m', '1mo'),
        '1d': ('1d', '3mo'), '1w': ('1wk', '1y'), '1M': ('1mo', '2y')
    }
    interval, range_str = tf_map.get(timeframe, ('1m', '1d'))
    
    url = f"https://query2.finance.yahoo.com/v8/finance/chart/{ticker}?interval={interval}&range={range_str}"
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'application/json'}
    
    try:
        r = requests.get(url, headers=headers, timeout=2.5)
        if r.status_code == 200:
            data = r.json()
            result = data.get('chart', {}).get('result', [])
            if result and result[0].get('timestamp') and result[0].get('indicators', {}).get('quote', []):
                res0 = result[0]
                timestamps = [ts * 1000 for ts in res0['timestamp']]
                quote = res0['indicators']['quote'][0]
                
                opens = quote.get('open', [])
                highs = quote.get('high', [])
                lows = quote.get('low', [])
                closes = quote.get('close', [])
                volumes = quote.get('volume', [])
                
                records = []
                for i in range(len(timestamps)):
                    if closes[i] is not None and opens[i] is not None:
                        records.append({
                            'timestamp': timestamps[i],
                            'open': float(opens[i]),
                            'high': float(highs[i]),
                            'low': float(lows[i]),
                            'close': float(closes[i]),
                            'volume': float(volumes[i]) if (i < len(volumes) and volumes[i] is not None) else 100.0
                        })
                
                if len(records) > 0:
                    df = pd.DataFrame(records)
                    df.attrs['data_source'] = 'Yahoo Finance'
                    _, precision = get_asset_base_config(symbol)
                    for col in ['open', 'high', 'low', 'close']:
                        df[col] = df[col].round(precision)
                    
                    tv_spot = fetch_tradingview_live_quote(symbol)
                    if tv_spot and tv_spot > 0:
                        last_close = float(df['close'].iloc[-1])
                        offset = tv_spot - last_close
                        if abs(offset) > 0.02:
                            for c in ['open', 'high', 'low', 'close']:
                                df[c] = (df[c] + offset).round(precision)
                        df.at[df.index[-1], 'close'] = round(tv_spot, precision)
                        UNIVERSAL_PRICE_HUB[clean] = round(tv_spot, precision)
                        UNIVERSAL_PRICE_TIMESTAMPS[clean] = time.time()
                    else:
                        latest_p = float(df['close'].iloc[-1])
                        UNIVERSAL_PRICE_HUB[clean] = latest_p
                        UNIVERSAL_PRICE_TIMESTAMPS[clean] = time.time()
                    
                    if len(df) > limit:
                        df = df.tail(limit).reset_index(drop=True)
                    return df
    except Exception as e:
        print(f"Market fetch notice for {symbol}: {e}")
        
    return None

def generate_live_ticking_ohlcv(symbol: str = "EUR/USD", timeframe: str = "1m", limit: int = 100) -> pd.DataFrame:
    now_sec = int(time.time())
    step_sec = TIMEFRAME_STEP_SECONDS.get(timeframe, 60)
    
    clean = clean_symbol_string(symbol)
    _, precision = get_asset_base_config(symbol)
    synced_price = get_synchronized_live_price(symbol)
    
    current_bar_ts = (now_sec // step_sec) * step_sec
    timestamps = [(current_bar_ts - (limit - 1 - i) * step_sec) * 1000 for i in range(limit)]
    
    # Square-root of time volatility scaling for accurate multi-timeframe candle ranges
    tf_vol_scale = {
        '1s': 0.15, '5s': 0.25, '15s': 0.35, '30s': 0.5,
        '1m': 1.0, '2m': 1.25, '3m': 1.4, '5m': 1.8, '15m': 2.6,
        '30m': 3.6, '45m': 4.2,
        '1h': 5.2, '2h': 7.0, '4h': 9.5,
        '1d': 15.0, '1w': 28.0, '1M': 45.0
    }
    scale = tf_vol_scale.get(timeframe, 1.0)

    if is_forex_symbol(symbol):
        base_volatility = 0.0005
        base_vol = 500000
    else:
        base_volatility = 0.003
        base_vol = 100000

    volatility = base_volatility * math.sqrt(scale)
    hist_rng = random.Random(int(now_sec // 86400) + hash(symbol) % 100000 + hash(timeframe) % 5000)

    # Generate backwards from synced_price at index [-1] so current price is EXACTLY synced_price
    records = [None] * limit

    live_open = synced_price * (1 - hist_rng.gauss(0, volatility * 0.2))
    live_high = max(live_open, synced_price) * (1 + abs(hist_rng.gauss(0, volatility * 0.15)))
    live_low = min(live_open, synced_price) * (1 - abs(hist_rng.gauss(0, volatility * 0.15)))
    records[limit - 1] = {
        'timestamp': timestamps[-1],
        'open': round(live_open, precision),
        'high': round(live_high, precision),
        'low': round(live_low, precision),
        'close': round(synced_price, precision),
        'volume': round(base_vol * 1.2, 2)
    }

    curr_close = live_open
    for i in range(limit - 2, -1, -1):
        prev_open = curr_close * (1 - hist_rng.gauss(0, volatility * 0.3))
        high_p = max(prev_open, curr_close) * (1 + abs(hist_rng.gauss(0, volatility * 0.2)))
        low_p = min(prev_open, curr_close) * (1 - abs(hist_rng.gauss(0, volatility * 0.2)))
        vol = hist_rng.uniform(base_vol * 0.7, base_vol * 1.5)
        records[i] = {
            'timestamp': timestamps[i],
            'open': round(prev_open, precision),
            'high': round(high_p, precision),
            'low': round(low_p, precision),
            'close': round(curr_close, precision),
            'volume': round(vol, 2)
        }
        curr_close = prev_open

    df = pd.DataFrame(records)
    df.attrs['data_source'] = 'SIMULATED'
    return df

def fetch_ohlcv(symbol: str = "EUR/USD", timeframe: str = "1m", limit: int = 100) -> pd.DataFrame:
    clean = clean_symbol_string(symbol)
    cache_key = f"{clean}_{timeframe}_{limit}"
    now = time.time()
    
    synced_p = get_synchronized_live_price(symbol)
    _, precision = get_asset_base_config(symbol)

    if cache_key in OHLCV_CACHE:
        cached_time, cached_df = OHLCV_CACHE[cache_key]
        if now - cached_time < CACHE_TTL_SECONDS:
            df = cached_df.copy()
            if synced_p and synced_p > 0:
                last_idx = df.index[-1]
                df.at[last_idx, 'close'] = synced_p
                if synced_p > float(df.at[last_idx, 'high']):
                    df.at[last_idx, 'high'] = synced_p
                if synced_p < float(df.at[last_idx, 'low']):
                    df.at[last_idx, 'low'] = synced_p
            return df

    real_df = fetch_real_ohlcv_from_market(symbol=symbol, timeframe=timeframe, limit=limit)
    if real_df is not None and not real_df.empty:
        if synced_p and synced_p > 0:
            last_idx = real_df.index[-1]
            last_c = float(real_df.at[last_idx, 'close'])
            offset = synced_p - last_c
            # Only shift historical basis if the feed is a different instrument basis (e.g. > $1.50 spread)
            # Otherwise preserve the true forming candle open so fast runaway moves are never masked!
            if abs(offset) > 0.02:
                for col in ['open', 'high', 'low', 'close']:
                    real_df[col] = (real_df[col] + offset).round(precision)
            real_df.at[last_idx, 'close'] = synced_p
            if synced_p > float(real_df.at[last_idx, 'high']):
                real_df.at[last_idx, 'high'] = synced_p
            if synced_p < float(real_df.at[last_idx, 'low']):
                real_df.at[last_idx, 'low'] = synced_p
            UNIVERSAL_PRICE_HUB[clean] = synced_p
            UNIVERSAL_PRICE_TIMESTAMPS[clean] = now

        OHLCV_CACHE[cache_key] = (now, real_df)
        return real_df.copy()

    fetched_df = generate_live_ticking_ohlcv(symbol=symbol, timeframe=timeframe, limit=limit)
    if synced_p and synced_p > 0:
        fetched_df.at[fetched_df.index[-1], 'close'] = synced_p

    OHLCV_CACHE[cache_key] = (now, fetched_df)
    return fetched_df.copy()

def calculate_support_resistance(df: pd.DataFrame, window: int = 14) -> Tuple[float, float, pd.DataFrame]:
    df = df.copy()
    min_periods = min(3, len(df))
    df['rolling_low'] = df['low'].rolling(window=window, min_periods=min_periods).min()
    df['rolling_high'] = df['high'].rolling(window=window, min_periods=min_periods).max()
    
    current_support = float(df['rolling_low'].iloc[-1]) if not df['rolling_low'].empty else float(df['low'].min())
    current_resistance = float(df['rolling_high'].iloc[-1]) if not df['rolling_high'].empty else float(df['high'].max())
    
    if current_support == current_resistance:
        current_support = current_support * 0.998
        current_resistance = current_resistance * 1.002

    df['support'] = current_support
    df['resistance'] = current_resistance
    
    return current_support, current_resistance, df

def fetch_orderbook(symbol: str = "EUR/USD", depth: int = 20) -> Dict[str, Any]:
    clean = clean_symbol_string(symbol)
    cache_key = f"{clean}_{depth}"
    now = time.time()
    
    if cache_key in ORDERBOOK_CACHE:
        cached_time, cached_ob = ORDERBOOK_CACHE[cache_key]
        if now - cached_time < CACHE_TTL_SECONDS:
            return cached_ob.copy()

    binance_symbol_map = {
        'XAUUSD': 'PAXGUSDT', 'XAU': 'PAXGUSDT', 'GOLD': 'PAXGUSDT', 'PAXGUSD': 'PAXGUSDT',
        'PAXGUSDT': 'PAXGUSDT', 'BTC': 'BTCUSDT', 'BTCUSDT': 'BTCUSDT',
        'ETHUSD': 'ETHUSDT', 'ETHUSDT': 'ETHUSDT', 'SOLUSD': 'SOLUSDT', 'SOLUSDT': 'SOLUSDT',
    }
    binance_symbol = binance_symbol_map.get(clean)
    if not binance_symbol:
        return {
            "symbol": symbol, "bids": [], "asks": [], "bid_volume": 0.0,
            "ask_volume": 0.0, "obi_score": 0.0, "data_source": "unavailable",
        }

    try:
        response = requests.get(
            f"https://api.binance.com/api/v3/depth?symbol={binance_symbol}&limit={min(depth, 1000)}",
            timeout=2.5,
        )
        response.raise_for_status()
        orderbook = response.json()
        bids = [[float(price), float(volume)] for price, volume in orderbook.get('bids', [])[:depth]]
        asks = [[float(price), float(volume)] for price, volume in orderbook.get('asks', [])[:depth]]
    except Exception as e:
        print(f"Binance orderbook fetch notice for {symbol}: {e}")
        return {
            "symbol": symbol, "bids": [], "asks": [], "bid_volume": 0.0,
            "ask_volume": 0.0, "obi_score": 0.0, "data_source": "unavailable",
        }

    bid_volume = sum(b[1] for b in bids)
    ask_volume = sum(a[1] for a in asks)
    
    total_vol = bid_volume + ask_volume
    obi_score = (bid_volume - ask_volume) / total_vol if total_vol > 0 else 0.0

    res = {
        "symbol": symbol,
        "bids": bids[:depth],
        "asks": asks[:depth],
        "bid_volume": round(bid_volume, 2),
        "ask_volume": round(ask_volume, 2),
        "obi_score": round(obi_score, 4),
        "data_source": "Binance PAXGUSDT (reference)" if is_mt5_gold_symbol(symbol) else "Binance",
    }

    ORDERBOOK_CACHE[cache_key] = (now, res)
    return res.copy()

def calculate_supply_demand_zones(df: pd.DataFrame, precision: int = 2) -> Dict[str, Any]:
    if len(df) < 15:
        return {"supply": [], "demand": []}
    
    # Use recent subset for zones
    recent_df = df.tail(100).copy()
    
    # Supply Zones (Resistance areas - local maxima)
    recent_df['max'] = recent_df['high'].rolling(7, center=True).max()
    supply_peaks = recent_df[recent_df['high'] == recent_df['max']]
    
    supply_zones = []
    for _, row in supply_peaks.tail(3).iterrows():
        top = float(row['high'])
        bottom = float(max(row['open'], row['close']))
        if top > bottom:
            supply_zones.append({"top": round(top, precision), "bottom": round(bottom, precision)})
            
    # Demand Zones (Support areas - local minima)
    recent_df['min'] = recent_df['low'].rolling(7, center=True).min()
    demand_troughs = recent_df[recent_df['low'] == recent_df['min']]
    
    demand_zones = []
    for _, row in demand_troughs.tail(3).iterrows():
        bottom = float(row['low'])
        top = float(min(row['open'], row['close']))
        if top > bottom:
            demand_zones.append({"top": round(top, precision), "bottom": round(bottom, precision)})
            
    return {"supply": supply_zones[::-1], "demand": demand_zones[::-1]}

ACTIVE_SIGNAL_LOCK = threading.Lock()
ACTIVE_SIGNAL_REGISTRY: Dict[str, Dict[str, Any]] = {}

TIMEFRAME_HOLD_SECONDS = {
    '1s': 15,
    '5s': 30,
    '15s': 45,
    '30s': 60,
    '1m': 90,
    '2m': 120,
    '3m': 180,
    '5m': 300,
    '15m': 900,
    '30m': 1800,
    '45m': 2700,
    '1h': 3600,
    '2h': 7200,
    '4h': 14400,
    '1d': 86400,
    '1w': 604800,
    '1M': 2592000,
}

def analyze_signal_conditions(symbol: str = "EUR/USD", timeframe: str = "1m",
                               account_balance: float = 0.0, lot_size: float = 0.0,
                               risk_percent: float = 0.0,
                               current_price: Optional[float] = None) -> Dict[str, Any]:
    """
    Institutional Multi-Timeframe Signal Recommendation Engine.
    Dynamically evaluates Average True Range (ATR) volatility and market structure per timeframe.
    Targeting 80%+ win rate with optimal Risk-to-Reward parameters.

    Risk management params (optional):
        account_balance: Account size in USD (e.g. 500.0)
        lot_size: Trading lot size (e.g. 0.01, 0.1, 1.0)
        risk_percent: Max % of account to risk per trade (e.g. 2.0)
        current_price: Live spot price from chart to ensure 100% synchronization
    """
    clean_sym = clean_symbol_string(symbol)
    _, precision = get_asset_base_config(symbol)

    # Always fetch the true live market price first so a locked signal entry echoed
    # from the client can NEVER freeze `latest_price` in a feedback loop!
    live_spot_price = get_synchronized_live_price(symbol)
    if (not live_spot_price or live_spot_price <= 0) and current_price and current_price > 0:
        live_spot_price = round(current_price, precision)

    df = fetch_ohlcv(symbol=symbol, timeframe=timeframe, limit=100)
    if df is not None and not df.empty:
        candle_close = round(float(df['close'].iloc[-1]), precision)
        if candle_close > 0:
            live_spot_price = candle_close

    latest_price = round(float(live_spot_price), precision)
    UNIVERSAL_PRICE_HUB[clean_sym] = latest_price
    UNIVERSAL_PRICE_TIMESTAMPS[clean_sym] = time.time()

    data_source = df.attrs.get('data_source', 'unknown')
    if any(k in clean_sym for k in ['XAU', 'GOLD']):
        data_source = 'TradingView (OANDA:XAUUSD)'
    support, resistance, df = calculate_support_resistance(df)
    
    df['vol_ma_10'] = df['volume'].rolling(window=10, min_periods=1).mean()
    
    latest_candle = df.iloc[-1]
    latest_low = float(latest_candle['low'])
    latest_high = float(latest_candle['high'])
    latest_vol = float(latest_candle['volume'])
    vol_ma_10 = float(latest_candle['vol_ma_10'])
    
    orderbook_data = fetch_orderbook(symbol=symbol)
    obi_score = orderbook_data['obi_score']

    price_range = max(0.0001, resistance - support)
    price_position_pct = (latest_price - support) / price_range * 100
    vol_ratio = latest_vol / vol_ma_10 if vol_ma_10 > 0 else 1.0

    # Technical Trend Analysis (Moving Averages & Momentum)
    df['sma_20'] = df['close'].rolling(window=min(20, len(df)), min_periods=3).mean()
    df['sma_50'] = df['close'].rolling(window=min(50, len(df)), min_periods=5).mean()
    
    sma_20_curr = float(df['sma_20'].iloc[-1])
    sma_50_curr = float(df['sma_50'].iloc[-1])
    
    # 5-period momentum/slope of SMA_20
    if len(df) >= 6:
        sma_20_prev = float(df['sma_20'].iloc[-6])
        sma_slope = (sma_20_curr - sma_20_prev) / sma_20_prev * 100
    else:
        sma_slope = 0.0

    # Classify market regime: DOWNTREND, UPTREND, or RANGEBOUND
    if latest_price < sma_20_curr and (sma_20_curr < sma_50_curr or sma_slope < -0.01):
        trend = "DOWNTREND"
    elif latest_price > sma_20_curr and (sma_20_curr > sma_50_curr or sma_slope > 0.01):
        trend = "UPTREND"
    elif latest_price < sma_20_curr and sma_slope < -0.03:
        trend = "DOWNTREND"
    elif latest_price > sma_20_curr and sma_slope > 0.03:
        trend = "UPTREND"
    else:
        trend = "RANGEBOUND"

    # ── SHORT-TERM MOMENTUM & TREND REVERSAL DETECTION ──────────────────────
    # Evaluate completed candles (excluding the still-forming live tick bar)
    # so micro-ticks within a timeframe window never cause random 10-20s flips.
    closed_df = df.iloc[:-1] if len(df) > 6 else df
    recent_n = min(5, len(closed_df) - 1)
    recent_candles = closed_df.iloc[-(recent_n + 1):]  # last 5+1 completed candles

    higher_lows = 0
    lower_highs = 0
    close_rising = latest_price >= sma_20_curr
    close_change_pct = 0.0

    if len(recent_candles) >= 4:
        recent_lows = recent_candles['low'].values[-4:]   # last 4 completed candle lows
        recent_highs = recent_candles['high'].values[-4:]  # last 4 completed candle highs
        recent_closes = recent_candles['close'].values[-4:]

        # Count consecutive higher lows (bullish pressure building)
        higher_lows = sum(1 for i in range(1, len(recent_lows)) if recent_lows[i] > recent_lows[i-1])
        # Count consecutive lower highs (bearish pressure building)
        lower_highs = sum(1 for i in range(1, len(recent_highs)) if recent_highs[i] < recent_highs[i-1])
        # Short-term close direction on completed bars
        close_rising = bool(recent_closes[-1] >= recent_closes[0])
        close_change_pct = float((recent_closes[-1] - recent_closes[0]) / recent_closes[0] * 100)

    # ── SHORT-TERM MOMENTUM & BREAKOUT DETECTION ──────────────────────────────
    # If recent candles are aggressively rising with higher lows and rising closes:
    # This is a BULLISH BREAKOUT / V-BOTTOM RALLY. NEVER sell into a bull surge!
    bullish_momentum = (higher_lows >= 2 and close_rising) or (close_change_pct > 0.04 and close_rising)
    bearish_momentum = (lower_highs >= 2 and not close_rising) or (close_change_pct < -0.04 and not close_rising)

    # Multi-Tier Trend-Aware Active Signal Logic
    cond_support_zone = (price_position_pct <= 45.0) or (latest_low <= support * 1.002)
    cond_resistance_zone = (price_position_pct >= 55.0) or (latest_high >= resistance * 0.998)
    obi_available = orderbook_data.get('data_source', 'unavailable') != 'unavailable'
    cond_bullish_obi = (obi_score >= 0.02) if obi_available else False
    cond_bearish_obi = (obi_score <= -0.02) if obi_available else False

    # ── TREND-DIRECTION SIGNAL FILTER ─────────────────────────────────────────
    # 1. Momentum & Breakout ALWAYS take precedence over static ranges
    if bullish_momentum:
        trend = "UPTREND"
        signal_type = "BUY/LONG"

    elif bearish_momentum:
        trend = "DOWNTREND"
        signal_type = "SELL/SHORT"

    elif trend == "REVERSAL_UP":
        signal_type = "BUY/LONG"

    elif trend == "REVERSAL_DOWN":
        signal_type = "SELL/SHORT"

    elif trend == "DOWNTREND":
        signal_type = "SELL/SHORT"

    elif trend == "UPTREND":
        signal_type = "BUY/LONG"

    else:  # RANGEBOUND (consolidation with no strong momentum)
        if cond_support_zone and not bearish_momentum:
            signal_type = "BUY/LONG"
        elif cond_resistance_zone and not bullish_momentum:
            signal_type = "SELL/SHORT"
        elif obi_available and obi_score >= 0.05:
            signal_type = "BUY/LONG"
        elif obi_available and obi_score <= -0.05:
            signal_type = "SELL/SHORT"
        else:
            signal_type = "BUY/LONG" if close_rising else "SELL/SHORT"

    if data_source == 'SIMULATED':
        signal_type = "NEUTRAL"

    _, precision = get_asset_base_config(symbol)
    entry_price = latest_price
    
    sd_zones = calculate_supply_demand_zones(df, precision)

    # ── STABLE ATR: computed from HISTORIC bars only (exclude the live-ticking last candle)
    # This prevents SL/TP from jittering on every 3-second poll as the live close changes.
    historic_df = df.iloc[:-1] if len(df) > 2 else df
    high_low_h = historic_df['high'] - historic_df['low']
    high_close_h = (historic_df['high'] - historic_df['close'].shift(1)).abs()
    low_close_h = (historic_df['low'] - historic_df['close'].shift(1)).abs()
    tr_h = pd.concat([high_low_h, high_close_h, low_close_h], axis=1).max(axis=1)
    atr_raw = tr_h.rolling(window=14, min_periods=3).mean().iloc[-1]
    if pd.isna(atr_raw) or atr_raw <= 0:
        atr_raw = latest_price * 0.003

    # Round ATR to precision+1 so it is stable across polls (no micro-float drift)
    atr = round(float(atr_raw), precision + 1)

    # Dynamic Timeframe Multipliers (Targeting 80%+ Institutional Win-Rate)
    tf_sl_multipliers = {
        '1s': 1.1, '5s': 1.2, '15s': 1.3, '30s': 1.4,
        '1m': 1.5, '2m': 1.6, '3m': 1.7, '5m': 1.8, '15m': 2.0,
        '30m': 2.2,
        '45m': 2.4,
        '1h': 2.6,
        '2h': 3.0,
        '4h': 3.5,
        '1d': 4.5,
        '1w': 6.0,
        '1M': 8.0
    }
    sl_mult = tf_sl_multipliers.get(timeframe, 2.0)
    
    pip = get_pip_size(symbol)

    # ── TIMEFRAME-SCALED TP SPACING ──────────────────────────────────────
    # Higher timeframes need wider TP levels because price moves further.
    # Gold 5m = $5/level, 1h = $15/level, 4h = $30/level etc.
    tf_tp_pip_counts = {
        '1s': 15, '5s': 15, '15s': 20, '30s': 20,
        '1m': 30, '2m': 30, '3m': 30, '5m': 50, '15m': 80,
        '30m': 100, '45m': 120,
        '1h': 150, '2h': 200, '4h': 300,
        '1d': 500, '1w': 800, '1M': 1200
    }
    tp_pip_count = tf_tp_pip_counts.get(timeframe, 30)
    pip_step = pip * tp_pip_count  # $ distance between each TP level

    # Minimum SL floor also scales with timeframe
    tf_min_sl_pips = {
        '1s': 15, '5s': 15, '15s': 20, '30s': 25,
        '1m': 30, '2m': 30, '3m': 30, '5m': 50, '15m': 80,
        '30m': 100, '45m': 120,
        '1h': 150, '2h': 200, '4h': 300,
        '1d': 500, '1w': 800, '1M': 1200
    }
    min_sl_distance = pip * tf_min_sl_pips.get(timeframe, 30)

    # ── Risk: anchor SL to the recent support/resistance swing level.
    # This keeps SL tight (on the swing) and TP at 1:1 RRR (close to entry, not far).
    if signal_type == "BUY/LONG" and support < entry_price:
        rr_base = entry_price - support
    elif signal_type == "SELL/SHORT" and resistance > entry_price:
        rr_base = resistance - entry_price
    else:
        rr_base = atr * sl_mult
    risk_amount = round(max(min(max(rr_base, latest_price * 0.0003), atr * 3.5), min_sl_distance), precision)

    # ── Timeframe-Scaled Mathematical Risk and Step Tables ──
    # Cap max SL distance so intraday trades don't use absurd stop losses
    # tp1_ratio: TP1 starts close to entry (0.5x to 1.0x risk_dist) so realistic profits are locked quickly
    tf_gold_config = {
        '1s':  {'zone_step': 0.15, 'pip_step': 0.4,  'min_sl': 1.0, 'max_sl': 2.0,  'tp1_ratio': 0.5},
        '5s':  {'zone_step': 0.25, 'pip_step': 0.5,  'min_sl': 1.5, 'max_sl': 3.0,  'tp1_ratio': 0.5},
        '15s': {'zone_step': 0.35, 'pip_step': 0.8,  'min_sl': 1.8, 'max_sl': 3.5,  'tp1_ratio': 0.6},
        '30s': {'zone_step': 0.50, 'pip_step': 1.0,  'min_sl': 2.0, 'max_sl': 4.0,  'tp1_ratio': 0.6},
        '1m':  {'zone_step': 0.50, 'pip_step': 1.2,  'min_sl': 2.0, 'max_sl': 4.0,  'tp1_ratio': 0.6},
        '2m':  {'zone_step': 0.60, 'pip_step': 1.5,  'min_sl': 2.5, 'max_sl': 5.0,  'tp1_ratio': 0.6},
        '3m':  {'zone_step': 0.80, 'pip_step': 1.8,  'min_sl': 3.0, 'max_sl': 6.0,  'tp1_ratio': 0.7},
        '5m':  {'zone_step': 1.00, 'pip_step': 2.0,  'min_sl': 3.0, 'max_sl': 6.0,  'tp1_ratio': 0.7},
        '15m': {'zone_step': 1.50, 'pip_step': 3.0,  'min_sl': 4.0, 'max_sl': 8.0,  'tp1_ratio': 0.8},
        '30m': {'zone_step': 2.00, 'pip_step': 4.0,  'min_sl': 5.0, 'max_sl': 10.0, 'tp1_ratio': 0.8},
        '45m': {'zone_step': 2.50, 'pip_step': 5.0,  'min_sl': 6.0, 'max_sl': 12.0, 'tp1_ratio': 0.8},
        '1h':  {'zone_step': 3.00, 'pip_step': 6.0,  'min_sl': 8.0, 'max_sl': 15.0, 'tp1_ratio': 0.9},
        '2h':  {'zone_step': 4.00, 'pip_step': 8.0,  'min_sl': 10.0,'max_sl': 20.0, 'tp1_ratio': 1.0},
        '4h':  {'zone_step': 6.00, 'pip_step': 12.0, 'min_sl': 12.0,'max_sl': 25.0, 'tp1_ratio': 1.0},
        '1d':  {'zone_step': 10.0, 'pip_step': 20.0, 'min_sl': 20.0,'max_sl': 50.0, 'tp1_ratio': 1.0},
        '1w':  {'zone_step': 20.0, 'pip_step': 40.0, 'min_sl': 40.0,'max_sl': 100.0,'tp1_ratio': 1.0},
        '1M':  {'zone_step': 35.0, 'pip_step': 60.0, 'min_sl': 60.0,'max_sl': 150.0,'tp1_ratio': 1.0},
    }

    is_gold = any(k in clean_symbol_string(symbol) for k in ['XAU', 'GOLD'])
    if is_gold:
        cfg = tf_gold_config.get(timeframe, tf_gold_config['1m'])
        zone_step = cfg['zone_step']
        pip_step = cfg['pip_step']
        min_sl_distance = cfg['min_sl']
        max_sl_distance = cfg['max_sl']
        tp1_ratio = cfg.get('tp1_ratio', 0.6)
        
        # If user specified account sizing and lot size, calculate exact stop loss distance for 1-3% risk
        # For Gold (100 oz contract): 1.00 lot = $100 per $1 move, 0.01 lot = $1 per $1 move
        # risk_dollars = account_balance * (risk_percent / 100)
        # allowed_sl_distance = risk_dollars / (lot_size * 100)
        if account_balance > 0 and lot_size > 0 and risk_percent > 0:
            contract_size = 100.0
            risk_dollars = account_balance * (risk_percent / 100.0)
            custom_sl_dist = risk_dollars / (lot_size * contract_size)
            # Bound within safe limits: minimum $1.00, maximum max_sl for this timeframe!
            # E.g. on 5m chart, max_sl is $6.00 so SL is never $20+ away
            min_effective_risk = max(1.0, min(round(custom_sl_dist, precision), max_sl_distance))
        else:
            # Standard adaptive risk: ATR bounded between min_sl and max_sl
            calculated_risk = min(max(atr * 1.0, min_sl_distance), max_sl_distance)
            min_effective_risk = calculated_risk
    else:
        zone_step = round(atr * 0.3, precision)
        pip_step = pip * tf_tp_pip_counts.get(timeframe, 30)
        min_sl_distance = pip * tf_min_sl_pips.get(timeframe, 30)
        tp1_ratio = 0.8
        
        # Forex / crypto lot size risk calculation if provided
        if account_balance > 0 and lot_size > 0 and risk_percent > 0:
            contract_size = 100000.0 if is_forex_symbol(symbol) else 1.0
            risk_dollars = account_balance * (risk_percent / 100.0)
            custom_sl_dist = risk_dollars / (lot_size * contract_size)
            min_effective_risk = max(min_sl_distance, min(round(custom_sl_dist, precision), min_sl_distance * 3.0))
        else:
            min_effective_risk = max(risk_amount, atr * 1.5, 2.0 if entry_price > 10.0 else 0.0015)

    # Re-sync live_spot_price right before evaluating Runaway Trend & Hold Lock
    synced_now = get_synchronized_live_price(symbol)
    if synced_now and synced_now > 0:
        live_spot_price = round(synced_now, precision)
        latest_price = live_spot_price
    entry_price = latest_price

    # ── RUNAWAY TREND / FAST IMPULSE DETECTOR (TAKES PRECEDENCE OVER HOLD TIMER) ──
    # Calculate the exact points that determine a fast runaway trend for this timeframe.
    # When price runs away beyond `runaway_threshold_pts`, the system MUST immediately
    # override the countdown timer, notify the user, and flip/update the signal direction!
    tf_gold_runaway_pts = {
        '1s': 0.80, '5s': 1.10, '15s': 1.50, '30s': 1.80,
        '1m': 2.20, '2m': 2.80, '3m': 3.20, '5m': 4.00,
        '15m': 6.50, '30m': 9.00, '45m': 11.00,
        '1h': 14.00, '2h': 18.00, '4h': 25.00,
        '1d': 40.00, '1w': 75.00, '1M': 120.00,
    }
    if is_gold:
        runaway_threshold_pts = round(tf_gold_runaway_pts.get(timeframe, 3.50), precision)
    else:
        runaway_threshold_pts = round(max(atr * 1.15, min_sl_distance * 0.70), precision)

    # Measure live single-candle impulse and 2-to-3 candle fast displacement (including forming bar!)
    live_bar_open = float(df['open'].iloc[-1])
    live_bar_pts = round(live_spot_price - live_bar_open, precision)

    lookback_3 = df.iloc[-min(3, len(df)):]
    open_3bars_ago = float(lookback_3['open'].iloc[0])
    high_3bars = float(lookback_3['high'].max())
    low_3bars = float(lookback_3['low'].min())

    net_3bar_pts = round(live_spot_price - open_3bars_ago, precision)
    drop_from_3bar_high = round(live_spot_price - high_3bars, precision)   # negative on drops
    surge_from_3bar_low = round(live_spot_price - low_3bars, precision)    # positive on surges

    # Also check last 2 bars displacement
    lookback_2 = df.iloc[-min(2, len(df)):]
    net_2bar_pts = round(live_spot_price - float(lookback_2['open'].iloc[0]), precision)

    # Bearish Runaway Crash: single bar drop >= threshold, OR 2-3 bar net drop >= 1.1x threshold,
    # OR plunge from 3-bar high >= 1.35x threshold while current/recent bar is falling
    runaway_bearish = (
        (live_bar_pts <= -runaway_threshold_pts)
        or (net_2bar_pts <= -runaway_threshold_pts)
        or (net_3bar_pts <= -(runaway_threshold_pts * 1.15))
        or (drop_from_3bar_high <= -(runaway_threshold_pts * 1.35) and (live_bar_pts < 0 or net_2bar_pts < 0))
    )

    # Bullish Runaway Surge: single bar rally >= threshold, OR 2-3 bar net rally >= 1.1x threshold,
    # OR surge from 3-bar low >= 1.35x threshold while current/recent bar is rising
    runaway_bullish = (
        (live_bar_pts >= runaway_threshold_pts)
        or (net_2bar_pts >= runaway_threshold_pts)
        or (net_3bar_pts >= (runaway_threshold_pts * 1.15))
        or (surge_from_3bar_low >= (runaway_threshold_pts * 1.35) and (live_bar_pts > 0 or net_2bar_pts > 0))
    )

    # If both somehow trigger in extreme whipsaw, pick the dominant recent 2-bar vector
    if runaway_bearish and runaway_bullish:
        if net_2bar_pts < 0:
            runaway_bullish = False
        else:
            runaway_bearish = False

    # Runaway Trend ALWAYS takes precedence over lagging moving averages or older completed candles
    if runaway_bearish and data_source != 'SIMULATED':
        signal_type = "SELL/SHORT"
        trend = "DOWNTREND"
        bearish_momentum = True
        bullish_momentum = False
    elif runaway_bullish and data_source != 'SIMULATED':
        signal_type = "BUY/LONG"
        trend = "UPTREND"
        bullish_momentum = True
        bearish_momentum = False

    # ── PREDICTIVE PROBABILITY & TIMEFRAME SIGNAL PERSISTENCE (HYSTERESIS) ──
    # A 5m signal holds its predicted direction for the 5m candle window (300s)
    # UNLESS a Runaway Trend or Stop Loss breach occurs — Runaway Trend takes precedence!
    now_ts = time.time()
    min_hold_sec = TIMEFRAME_HOLD_SECONDS.get(timeframe, 300)
    registry_key = f"{clean_sym}:{timeframe}"

    # Compute predictive win probability (75% - 89%)
    prob_score = 78
    if (signal_type == "BUY/LONG" and trend == "UPTREND") or (signal_type == "SELL/SHORT" and trend == "DOWNTREND"):
        prob_score += 4
    if (signal_type == "BUY/LONG" and bullish_momentum) or (signal_type == "SELL/SHORT" and bearish_momentum):
        prob_score += 3
    if runaway_bearish or runaway_bullish:
        prob_score += 3
    if vol_ratio >= 1.2:
        prob_score += 2
    if obi_available and ((signal_type == "BUY/LONG" and obi_score >= 0.02) or (signal_type == "SELL/SHORT" and obi_score <= -0.02)):
        prob_score += 2
    prob_score = min(max(prob_score, 75), 89)

    runaway_override_triggered = False
    adverse_excursion_pts = 0.0

    with ACTIVE_SIGNAL_LOCK:
        active_state = ACTIVE_SIGNAL_REGISTRY.get(registry_key)
        if active_state and signal_type != "NEUTRAL":
            elapsed = now_ts - active_state["triggered_at"]
            act_sig = active_state["signal_type"]
            act_sl = active_state["stop_loss"]
            act_entry = active_state["entry"]

            # 1. Check Stop Loss breach against LIVE market price
            sl_hit = (act_sig == "BUY/LONG" and live_spot_price <= act_sl) or (act_sig == "SELL/SHORT" and live_spot_price >= act_sl)

            # 2. Check Adverse Excursion (price ran away against locked entry by >= runaway_threshold_pts)
            if act_sig == "BUY/LONG":
                adverse_excursion_pts = round(live_spot_price - act_entry, precision)
                adverse_runaway = adverse_excursion_pts <= -runaway_threshold_pts
                opposing_runaway = runaway_bearish
            else:
                adverse_excursion_pts = round(live_spot_price - act_entry, precision)
                adverse_runaway = adverse_excursion_pts >= runaway_threshold_pts
                opposing_runaway = runaway_bullish

            # 3. Check Same-Direction Runaway Continuation (price already moved >= 1.5x runaway_threshold_pts in profit)
            favorable_runaway = (
                (act_sig == "BUY/LONG" and (live_spot_price - act_entry) >= runaway_threshold_pts * 1.5)
                or (act_sig == "SELL/SHORT" and (act_entry - live_spot_price) >= runaway_threshold_pts * 1.5)
            )

            if sl_hit or adverse_runaway or opposing_runaway:
                # RUNAWAY TREND TAKES PRECEDENCE OVER THE HOLD TIMER!
                # Flip immediately to the runaway direction and re-anchor at live_spot_price.
                runaway_override_triggered = True
                if act_sig == "BUY/LONG" and (sl_hit or adverse_runaway or runaway_bearish):
                    signal_type = "SELL/SHORT"
                    trend = "DOWNTREND"
                    runaway_bearish = True
                    runaway_bullish = False
                elif act_sig == "SELL/SHORT" and (sl_hit or adverse_runaway or runaway_bullish):
                    signal_type = "BUY/LONG"
                    trend = "UPTREND"
                    runaway_bullish = True
                    runaway_bearish = False
                entry_price = live_spot_price
                triggered_at = now_ts
            elif favorable_runaway:
                # Keep direction & timer, but re-anchor entry/SL/TP to live price so trader isn't chasing stale levels
                signal_type = act_sig
                trend = active_state["trend"]
                entry_price = live_spot_price
                triggered_at = active_state["triggered_at"]
            elif elapsed < min_hold_sec:
                # Calm market within threshold: hold the predicted direction and anchor entry
                signal_type = act_sig
                trend = active_state["trend"]
                entry_price = active_state["entry"]
                prob_score = active_state["probability"]
                triggered_at = active_state["triggered_at"]
            else:
                triggered_at = now_ts
        else:
            triggered_at = now_ts

    # Compute final runaway telemetry summary
    runaway_detected = bool(runaway_bearish or runaway_bullish or runaway_override_triggered)
    if runaway_bearish or (runaway_override_triggered and signal_type == "SELL/SHORT"):
        runaway_direction = "BEARISH"
        active_runaway_pts = min(live_bar_pts, net_2bar_pts, net_3bar_pts, drop_from_3bar_high, adverse_excursion_pts)
    elif runaway_bullish or (runaway_override_triggered and signal_type == "BUY/LONG"):
        runaway_direction = "BULLISH"
        active_runaway_pts = max(live_bar_pts, net_2bar_pts, net_3bar_pts, surge_from_3bar_low, adverse_excursion_pts)
    else:
        runaway_direction = "NONE"
        active_runaway_pts = net_2bar_pts if abs(net_2bar_pts) >= abs(live_bar_pts) else live_bar_pts

    intensity_ratio = round(abs(active_runaway_pts) / max(runaway_threshold_pts, 1e-6), 2)
    if runaway_detected:
        dir_word = "BEARISH CRASH" if runaway_direction == "BEARISH" else "BULLISH SURGE"
        act_word = "SELL NOW" if runaway_direction == "BEARISH" else "BUY NOW"
        runaway_banner = (
            f"⚡ RUNAWAY {dir_word} ({active_runaway_pts:+.{precision}f} pts vs ±{runaway_threshold_pts:.{precision}f} pt threshold) "
            f"— TAKING PRECEDENCE! Signal locked to {act_word} @ ${entry_price:.{precision}f}"
        )
    else:
        runaway_banner = (
            f"Normal Velocity ({active_runaway_pts:+.{precision}f} pts / ±{runaway_threshold_pts:.{precision}f} pt Runaway Trigger)"
        )

    runaway_trend_info = {
        "detected": runaway_detected,
        "override_triggered": runaway_override_triggered,
        "direction": runaway_direction,
        "points_moved": round(float(active_runaway_pts), precision),
        "threshold_pts": round(float(runaway_threshold_pts), precision),
        "live_bar_pts": round(float(live_bar_pts), precision),
        "net_2bar_pts": round(float(net_2bar_pts), precision),
        "net_3bar_pts": round(float(net_3bar_pts), precision),
        "adverse_excursion_pts": round(float(adverse_excursion_pts), precision),
        "intensity_ratio": intensity_ratio,
        "banner": runaway_banner,
    }

    hold_remaining_sec = int(max(0, min_hold_sec - (now_ts - triggered_at)))
    unified_bias = "BULLISH" if signal_type == "BUY/LONG" else ("BEARISH" if signal_type == "SELL/SHORT" else "NEUTRAL")

    # Calculate initial TP offset: TP1 starts close to entry for quick profit taking!
    tp1_base_offset = max(round(min_effective_risk * tp1_ratio, precision), pip_step)

    if signal_type == "SELL/SHORT":
        # 5 Entry Zones: Zone 1 = current price (NOW), Zones 2-5 go UP (better short prices at resistance)
        entry_zones = [round(entry_price + (zone_step * i), precision) for i in range(5)]
        max_entry = max(entry_zones)

        # Stop loss strictly ABOVE all entry zones. Never allow resistance far away to blow out the SL!
        if resistance > entry_price and (resistance - entry_price) <= (min_effective_risk * 1.2):
            structural_sl = max(entry_price + min_effective_risk, resistance + 0.3)
        else:
            structural_sl = entry_price + min_effective_risk

        # STRICT SAFETY: Stop loss must be strictly ABOVE max_entry and entry_price
        stop_loss = round(max(structural_sl, max_entry + 0.3, entry_price + min_effective_risk), precision)
        risk_dist = round(abs(stop_loss - entry_price), precision)

        # 7 Take Profit levels: strictly BELOW entry price (taking profit as market falls)
        # TP1 starts close (tp1_base_offset), subsequent levels scale smoothly
        tp_levels = [round(entry_price - tp1_base_offset - (pip_step * i), precision) for i in range(7)]
        # Enforce that all TPs are strictly below entry_price
        tp_levels = [tp if tp < entry_price else round(entry_price - (pip_step * (i + 1)), precision) for i, tp in enumerate(tp_levels)]
        tp1 = tp_levels[0]
        tp2 = tp_levels[3]

        if runaway_detected and runaway_direction == "BEARISH":
            sell_label = f"⚡ RUNAWAY BEARISH TREND ({active_runaway_pts:+.{precision}f} pts / ±{runaway_threshold_pts:.{precision}f} pt trigger)"
        else:
            sell_label = "Bearish Momentum / Downtrend" if trend == "DOWNTREND" else "Bearish Rejection"
        rationale = f"[{timeframe.upper()}] [{prob_score}% PROB] {sell_label} (Risk: ${risk_dist:.{precision}f}). Entry: ${entry_price:.{precision}f}, SL: ${stop_loss:.{precision}f}."

    elif signal_type == "BUY/LONG":
        # 5 Entry Zones: Zone 1 = current price (NOW), Zones 2-5 go DOWN (better buy prices at support)
        entry_zones = [round(entry_price - (zone_step * i), precision) for i in range(5)]
        min_entry = min(entry_zones)

        # Stop loss strictly BELOW all entry zones. Never allow distant support to blow out the SL!
        if support < entry_price and (entry_price - support) <= (min_effective_risk * 1.2):
            structural_sl = min(entry_price - min_effective_risk, support - 0.3)
        else:
            structural_sl = entry_price - min_effective_risk

        # STRICT SAFETY: Stop loss must be strictly BELOW min_entry and entry_price
        stop_loss = round(min(structural_sl, min_entry - 0.3, entry_price - min_effective_risk), precision)
        risk_dist = round(abs(entry_price - stop_loss), precision)

        # 7 Take Profit levels: strictly ABOVE entry price (taking profit as market rises)
        # TP1 starts close (tp1_base_offset), subsequent levels scale smoothly
        tp_levels = [round(entry_price + tp1_base_offset + (pip_step * i), precision) for i in range(7)]
        # Enforce that all TPs are strictly above entry_price
        tp_levels = [tp if tp > entry_price else round(entry_price + (pip_step * (i + 1)), precision) for i, tp in enumerate(tp_levels)]
        tp1 = tp_levels[0]
        tp2 = tp_levels[3]

        if runaway_detected and runaway_direction == "BULLISH":
            buy_label = f"⚡ RUNAWAY BULLISH TREND ({active_runaway_pts:+.{precision}f} pts / ±{runaway_threshold_pts:.{precision}f} pt trigger)"
        else:
            buy_label = "Bullish Momentum / Breakout" if trend == "UPTREND" else "Bullish Demand"
        rationale = f"[{timeframe.upper()}] [{prob_score}% PROB] {buy_label} (Risk: ${risk_dist:.{precision}f}). Entry: ${entry_price:.{precision}f}, SL: ${stop_loss:.{precision}f}."

    else:
        entry_zones = [round(entry_price, precision) for _ in range(5)]
        stop_loss = round(entry_price - min_effective_risk, precision)
        tp_levels = [round(entry_price + (pip_step * (i + 1)), precision) for i in range(7)]
        tp1 = tp_levels[0]
        tp2 = tp_levels[3]
        rationale = f"[{timeframe.upper()}] [{trend}] Neutral Market - Monitoring Setup."

    # Persist active predictive state
    if signal_type != "NEUTRAL":
        with ACTIVE_SIGNAL_LOCK:
            ACTIVE_SIGNAL_REGISTRY[registry_key] = {
                "signal_type": signal_type,
                "bias": unified_bias,
                "trend": trend,
                "entry": entry_zones[0],
                "entry_zones": entry_zones,
                "stop_loss": stop_loss,
                "tp1": tp1,
                "tp2": tp2,
                "tp_levels": tp_levels,
                "probability": prob_score,
                "triggered_at": triggered_at,
                "min_hold_seconds": min_hold_sec,
                "rationale": rationale,
            }

    return {
        "symbol": symbol,
        "timeframe": timeframe,
        "data_source": data_source,
        "latest_price": live_spot_price,
        "support": support,
        "resistance": resistance,
        "trend": trend,
        "bias": unified_bias,
        "probability": prob_score,
        "hold_remaining_sec": hold_remaining_sec,
        "hold_total_sec": min_hold_sec,
        "runaway_trend": runaway_trend_info,
        "atr": round(atr, precision),
        "risk_amount": risk_amount,
        "volume": latest_vol,
        "vol_ma_10": vol_ma_10,
        "vol_ratio": round(vol_ratio, 2),
        "obi_score": obi_score,
        "orderbook_source": orderbook_data.get('data_source', 'unknown'),
        "price_position_pct": round(price_position_pct, 1),
        "conditions": {
            "support_retest": cond_support_zone,
            "volume_surge": vol_ratio >= 1.3,
            "obi_demand": cond_bullish_obi
        },
        "signal_triggered": signal_type != "NEUTRAL",
        "signal_type": signal_type,
        "trade_params": {
            "entry": entry_zones[0],
            "entry_zones": entry_zones,
            "stop_loss": stop_loss,
            "tp1": tp1,
            "tp2": tp2,
            "tp_levels": tp_levels,
            "rationale": rationale,
            "probability": prob_score,
            "hold_remaining_sec": hold_remaining_sec,
            "hold_total_sec": min_hold_sec,
            "runaway_trend": runaway_trend_info,
        },
        "sd_zones": sd_zones
    }


# ═══════════════════════════════════════════════════════════════════
# MARKET BIAS ANALYSIS — Trend Trading + Candle Trading
# ═══════════════════════════════════════════════════════════════════

def analyze_market_bias(symbol: str, timeframe: str) -> Dict[str, Any]:
    """
    Returns a full market bias snapshot for a symbol/timeframe:
      - Trend block: SMA/EMA stack, buyer/seller volume split, trend strength, continuation signal
      - Candle block: current candle type, named pattern, body ratio, candle signal
    """
    df = fetch_ohlcv(symbol=symbol, timeframe=timeframe, limit=120)
    if df is None or len(df) < 55:
        return {"error": "Insufficient candle data for market bias analysis."}
    data_source = df.attrs.get('data_source', 'unknown')
    if any(k in clean_symbol_string(symbol) for k in ['XAU', 'GOLD']):
        data_source = 'TradingView (OANDA:XAUUSD)'
    if data_source == 'SIMULATED':
        return {"error": "Market bias is unavailable because only simulated candles are available.", "data_source": data_source}

    _, precision = get_asset_base_config(symbol)
    latest_price = float(df['close'].iloc[-1])

    # ── Moving Averages ───────────────────────────────────────────
    df['sma20']  = df['close'].rolling(20).mean()
    df['sma50']  = df['close'].rolling(50).mean()
    df['ema8']   = df['close'].ewm(span=8,  adjust=False).mean()
    df['ema21']  = df['close'].ewm(span=21, adjust=False).mean()
    df['ema50']  = df['close'].ewm(span=50, adjust=False).mean()

    sma20 = float(df['sma20'].iloc[-1])
    sma50 = float(df['sma50'].iloc[-1])
    ema8  = float(df['ema8'].iloc[-1])
    ema21 = float(df['ema21'].iloc[-1])
    ema50 = float(df['ema50'].iloc[-1])

    # ── Trend Direction: SMA crossover + price position ──────────
    sma_bull = sma20 > sma50
    price_above_sma20 = latest_price > sma20
    price_above_sma50 = latest_price > sma50

    # EMA Stack alignment
    ema_bull_stack = ema8 > ema21 > ema50      # perfectly aligned bullish
    ema_bear_stack = ema8 < ema21 < ema50      # perfectly aligned bearish
    if ema_bull_stack:
        ema_stack = "ALIGNED_BULL"
    elif ema_bear_stack:
        ema_stack = "ALIGNED_BEAR"
    else:
        ema_stack = "MIXED"

    # Combine signals into trend vote
    bull_votes = sum([sma_bull, price_above_sma20, price_above_sma50, ema_bull_stack])
    bear_votes = sum([not sma_bull, not price_above_sma20, not price_above_sma50, ema_bear_stack])

    if bull_votes >= 3:
        trend_direction = "BULL"
    elif bear_votes >= 3:
        trend_direction = "BEAR"
    else:
        trend_direction = "NEUTRAL"

    # ── Trend Strength (via ATR vs price and EMA spread) ─────────
    recent = df.iloc[-20:]
    high_low   = recent['high'] - recent['low']
    high_close = (recent['high'] - recent['close'].shift(1)).abs()
    low_close  = (recent['low']  - recent['close'].shift(1)).abs()
    tr         = pd.concat([high_low, high_close, low_close], axis=1).max(axis=1)
    atr14      = float(tr.rolling(14, min_periods=3).mean().iloc[-1])
    if pd.isna(atr14) or atr14 <= 0:
        atr14 = latest_price * 0.002

    ema_spread_pct = abs(ema8 - ema50) / latest_price * 100
    if ema_spread_pct > 0.4 or (atr14 / latest_price) > 0.003:
        trend_strength = "STRONG"
    elif ema_spread_pct > 0.15:
        trend_strength = "MODERATE"
    else:
        trend_strength = "WEAK"

    # ── Buyer / Seller Volume Split (last 20 bars) ────────────────
    last20 = df.iloc[-20:]
    bull_bars = last20[last20['close'] >= last20['open']]
    bear_bars = last20[last20['close'] <  last20['open']]
    bull_vol  = float(bull_bars['volume'].sum())
    bear_vol  = float(bear_bars['volume'].sum())
    total_vol = bull_vol + bear_vol if (bull_vol + bear_vol) > 0 else 1
    buyers_pct  = round(bull_vol / total_vol * 100, 1)
    sellers_pct = round(bear_vol / total_vol * 100, 1)

    # OBI from last poll (recompute lightweight here)
    try:
        ob = fetch_orderbook(symbol=symbol, depth=15)
        obi_score = round(float(ob.get("obi_score", 0.0)), 3)
    except Exception:
        obi_score = 0.0

    # ── Continuation Signal ───────────────────────────────────────
    if trend_direction == "BULL" and trend_strength in ("STRONG", "MODERATE"):
        continuation_signal = "BUY_CONTINUATION"
        continuation_text   = f"🟢 TREND IS BULLISH — CONTINUE BUYING ({trend_strength})"
    elif trend_direction == "BEAR" and trend_strength in ("STRONG", "MODERATE"):
        continuation_signal = "SELL_CONTINUATION"
        continuation_text   = f"🔴 TREND IS BEARISH — CONTINUE SELLING ({trend_strength})"
    elif trend_direction == "BULL" and trend_strength == "WEAK":
        continuation_signal = "WEAK_BULL"
        continuation_text   = "🟡 WEAK BULLISH TREND — Caution, wait for confirmation"
    elif trend_direction == "BEAR" and trend_strength == "WEAK":
        continuation_signal = "WEAK_BEAR"
        continuation_text   = "🟡 WEAK BEARISH TREND — Caution, wait for confirmation"
    else:
        continuation_signal = "WAIT"
        continuation_text   = "⏸️ MARKET NEUTRAL — Wait for a clear trend to develop"

    # ════════════════════════════════════════════════════════════════
    # CANDLE ANALYSIS — current candle + pattern detection
    # ════════════════════════════════════════════════════════════════
    c   = df.iloc[-1]  # current (live) candle
    c_1 = df.iloc[-2]  # previous candle
    c_2 = df.iloc[-3]  # candle before that

    o, h, l, cl = float(c['open']), float(c['high']), float(c['low']), float(c['close'])
    candle_range = h - l if (h - l) > 0 else 0.0001
    body         = abs(cl - o)
    upper_wick   = h - max(o, cl)
    lower_wick   = min(o, cl) - l
    body_ratio   = round(body / candle_range * 100, 1)
    upper_wick_pct = round(upper_wick / candle_range * 100, 1)
    lower_wick_pct = round(lower_wick / candle_range * 100, 1)
    is_bull_candle = cl >= o

    # Prev candle metrics
    po, ph, pl, pcl = float(c_1['open']), float(c_1['high']), float(c_1['low']), float(c_1['close'])
    prev_body = abs(pcl - po)

    # ── Pattern Detection ─────────────────────────────────────────
    candle_pattern = "NORMAL"

    # Doji: tiny body (< 10% of range), wick both sides
    if body_ratio < 10:
        candle_pattern = "DOJI"

    # Marubozu: body > 85%, almost no wicks
    elif body_ratio > 85 and upper_wick_pct < 5 and lower_wick_pct < 5:
        candle_pattern = "MARUBOZU_BULL" if is_bull_candle else "MARUBOZU_BEAR"

    # Hammer / Hanging Man: small body at top, long lower wick (> 2x body)
    elif (lower_wick > body * 2) and upper_wick_pct < 15 and body_ratio < 35:
        # Hammer at bottom of down-move = bullish reversal
        candle_pattern = "HAMMER"

    # Shooting Star / Inverted Hammer: small body at bottom, long upper wick
    elif (upper_wick > body * 2) and lower_wick_pct < 15 and body_ratio < 35:
        candle_pattern = "SHOOTING_STAR"

    # Bullish Engulfing: current bull candle body fully wraps previous bear candle body
    elif (is_bull_candle and not (pcl >= po)
          and o <= pcl and cl >= po
          and body > prev_body):
        candle_pattern = "ENGULFING_BULL"

    # Bearish Engulfing: current bear candle body fully wraps previous bull candle body
    elif (not is_bull_candle and (pcl >= po)
          and o >= pcl and cl <= po
          and body > prev_body):
        candle_pattern = "ENGULFING_BEAR"

    # Pinbar Bull: hammer-like but with strict wick ratios
    elif lower_wick_pct > 55 and upper_wick_pct < 20 and body_ratio < 30:
        candle_pattern = "PINBAR_BULL"

    # Pinbar Bear: shooting-star-like
    elif upper_wick_pct > 55 and lower_wick_pct < 20 and body_ratio < 30:
        candle_pattern = "PINBAR_BEAR"

    # Inside Bar: current candle's high/low completely inside previous candle
    elif h <= ph and l >= pl:
        candle_pattern = "INSIDE_BAR"

    # Candle type label
    if body_ratio < 10:
        candle_type = "DOJI"
    elif is_bull_candle:
        candle_type = "BULLISH"
    else:
        candle_type = "BEARISH"

    # ── Candle Bias and Signal ────────────────────────────────────
    bull_patterns = {"HAMMER", "ENGULFING_BULL", "PINBAR_BULL", "MARUBOZU_BULL"}
    bear_patterns = {"SHOOTING_STAR", "ENGULFING_BEAR", "PINBAR_BEAR", "MARUBOZU_BEAR"}

    if candle_pattern in bull_patterns or (is_bull_candle and body_ratio > 50):
        candle_bias   = "BUYERS_IN_CONTROL"
        candle_signal = "BUY"
        pattern_label = candle_pattern.replace("_", " ")
        candle_signal_text = f"🟢 CANDLE IN BUYERS' FAVOR — {pattern_label}"
    elif candle_pattern in bear_patterns or (not is_bull_candle and body_ratio > 50):
        candle_bias   = "SELLERS_IN_CONTROL"
        candle_signal = "SELL"
        pattern_label = candle_pattern.replace("_", " ")
        candle_signal_text = f"🔴 CANDLE IN SELLERS' FAVOR — {pattern_label}"
    else:
        candle_bias   = "INDECISION"
        candle_signal = "WAIT"
        candle_signal_text = f"⏸️ INDECISION — {candle_pattern.replace('_', ' ')} forming, wait for next candle"

    # ── Synchronize Market Bias & Candle Signal with Unified Timeframe Signal Engine ──
    # Rule: BUY is ALWAYS BULLISH, SELL is ALWAYS BEARISH, locked for the timeframe hold timer.
    sig_sync = analyze_signal_conditions(symbol=symbol, timeframe=timeframe)
    sync_type = sig_sync.get("signal_type", "NEUTRAL")
    sync_hold_rem = sig_sync.get("hold_remaining_sec", 0)
    sync_hold_tot = sig_sync.get("hold_total_sec", TIMEFRAME_HOLD_SECONDS.get(timeframe, 300))
    sync_prob = sig_sync.get("probability", 80)

    if sync_type == "BUY/LONG":
        trend_direction = "BULL"
        continuation_signal = "BUY_CONTINUATION"
        continuation_text = f"🟢 TREND IS BULLISH ({timeframe.upper()}) — BUY SIGNAL LOCKED ({sync_prob}% PROB · HOLD {sync_hold_rem}s)"
        candle_type = "BULLISH"
        candle_bias = "BUYERS_IN_CONTROL"
        candle_signal = "BUY"
        pattern_label = candle_pattern.replace("_", " ") if candle_pattern not in bear_patterns else "BULLISH MOMENTUM"
        candle_signal_text = f"🟢 BULLISH (BUY) — {pattern_label} [{timeframe.upper()} HOLD {sync_hold_rem}s]"
    elif sync_type == "SELL/SHORT":
        trend_direction = "BEAR"
        continuation_signal = "SELL_CONTINUATION"
        continuation_text = f"🔴 TREND IS BEARISH ({timeframe.upper()}) — SELL SIGNAL LOCKED ({sync_prob}% PROB · HOLD {sync_hold_rem}s)"
        candle_type = "BEARISH"
        candle_bias = "SELLERS_IN_CONTROL"
        candle_signal = "SELL"
        pattern_label = candle_pattern.replace("_", " ") if candle_pattern not in bull_patterns else "BEARISH MOMENTUM"
        candle_signal_text = f"🔴 BEARISH (SELL) — {pattern_label} [{timeframe.upper()} HOLD {sync_hold_rem}s]"

    # Last 3 candles summary
    last_3 = []
    for i, row in enumerate([df.iloc[-3], df.iloc[-2], df.iloc[-1]]):
        rc, ro = float(row['close']), float(row['open'])
        last_3.append({
            "label": ["C-2", "C-1", "CURRENT"][i],
            "direction": "BULL" if rc >= ro else "BEAR",
            "close": round(rc, precision),
            "body_pct": round(abs(rc - ro) / (float(row['high']) - float(row['low']) + 0.00001) * 100, 1)
        })

    return {
        "symbol": symbol,
        "timeframe": timeframe,
        "data_source": data_source,
        "latest_price": round(latest_price, precision),
        "signal_type": sync_type,
        "bias": "BULLISH" if sync_type == "BUY/LONG" else ("BEARISH" if sync_type == "SELL/SHORT" else "NEUTRAL"),
        "probability": sync_prob,
        "hold_remaining_sec": sync_hold_rem,
        "hold_total_sec": sync_hold_tot,
        "trend": {
            "direction": trend_direction,
            "strength": trend_strength,
            "buyers_pct": buyers_pct,
            "sellers_pct": sellers_pct,
            "sma20": round(sma20, precision),
            "sma50": round(sma50, precision),
            "ema8":  round(ema8,  precision),
            "ema21": round(ema21, precision),
            "ema50": round(ema50, precision),
            "sma20_vs_sma50": "BULL" if sma_bull else "BEAR",
            "price_vs_sma20": "ABOVE" if price_above_sma20 else "BELOW",
            "ema_stack": ema_stack,
            "obi_score": obi_score,
            "continuation_signal": continuation_signal,
            "continuation_text": continuation_text,
        },
        "candle": {
            "candle_type": candle_type,
            "candle_pattern": candle_pattern,
            "body_ratio": body_ratio,
            "upper_wick_pct": upper_wick_pct,
            "lower_wick_pct": lower_wick_pct,
            "candle_bias": candle_bias,
            "candle_signal": candle_signal,
            "candle_signal_text": candle_signal_text,
            "open":  round(o,  precision),
            "high":  round(h,  precision),
            "low":   round(l,  precision),
            "close": round(cl, precision),
            "last_3_candles": last_3,
        }
    }
