import os
import sys
import time
import datetime
import random
import requests
import importlib
import threading
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any, Tuple

# Force UTF-8 output encoding for Windows terminals
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

import backend.engine
importlib.reload(backend.engine)

from backend.logger import init_db, log_closed_trade, generate_pdf_monthly_report, get_all_closed_trades
from backend.engine import fetch_ohlcv, calculate_support_resistance, fetch_orderbook, analyze_signal_conditions, analyze_market_bias
from backend.telegram_bot import send_telegram_signal
from backend.ws_stream import ws_router
from backend import ict_engine

# Initialize FastAPI app
app = FastAPI(
    title="WesSignal Terminal Engine",
    description="Institutional multi-asset real-time signal engine, paper simulator, and Telegram dispatcher.",
    version="4.0.0"
)

app.include_router(ws_router)

# Enable CORS for Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SIGNAL_CACHE_TTL_SECONDS = 2.5
SIGNAL_CACHE: Dict[str, Tuple[float, Dict[str, Any]]] = {}
SIGNAL_CACHE_LOCK = threading.Lock()

# Initialize SQLite Database on startup
init_db()

class TradeCloseRequest(BaseModel):
    symbol: str = Field(..., example="XAU/USD")
    signal_type: str = Field(..., example="BUY/LONG")
    entry_price: float = Field(..., example=4310.37)
    exit_price: float = Field(..., example=4330.50)
    stop_loss: float = Field(..., example=4280.00)
    take_profit: float = Field(..., example=4330.50)
    position_size_usd: float = Field(default=100.0, example=500.0)
    outcome: str = Field(..., example="WIN")
    rationale: Optional[str] = Field(default="", example="Simulated trade WIN on Gold Spot")

class SignalCheckRequest(BaseModel):
    symbol: str = Field(default="XAU/USD")
    timeframe: str = Field(default="1m")
    force_dispatch: bool = Field(default=False)

def fetch_market_news(symbol: str = "XAU/USD") -> Dict[str, Any]:
    yahoo_ticker = backend.engine.map_symbol_to_yahoo_ticker(symbol)
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
    url = f"https://query1.finance.yahoo.com/v1/finance/search?q={yahoo_ticker}&newsCount=15"
    
    raw_news = []
    try:
        r = requests.get(url, headers=headers, timeout=3.0)
        if r.status_code == 200:
            data = r.json()
            raw_news = data.get('news', [])
    except Exception as e:
        print("Yahoo news fetch notice:", e)

    if not raw_news:
        news_query = 'XAUUSD gold price' if any(term in symbol.upper() for term in ('XAU', 'GOLD')) else f'{symbol} market'
        try:
            response = requests.get(
                'https://news.google.com/rss/search',
                params={'q': news_query, 'hl': 'en-US', 'gl': 'US', 'ceid': 'US:en'},
                headers=headers,
                timeout=4.0,
            )
            response.raise_for_status()
            feed = ET.fromstring(response.content)
            for item in feed.findall('./channel/item')[:15]:
                published = item.findtext('pubDate', default='')
                try:
                    published_at = parsedate_to_datetime(published).timestamp()
                except (TypeError, ValueError, OverflowError):
                    published_at = time.time()
                raw_news.append({
                    'uuid': item.findtext('guid') or item.findtext('link') or str(random.randint(10000, 99999)),
                    'title': item.findtext('title', default='').rsplit(' - ', 1)[0],
                    'publisher': item.findtext('source', default='Google News'),
                    'link': item.findtext('link', default='#'),
                    'providerPublishTime': int(published_at),
                })
        except Exception as e:
            print("Google News RSS notice:", e)

    news_items = []
    now = time.time()
    
    if raw_news:
        for item in raw_news:
            title = item.get('title', '')
            publisher = item.get('publisher', 'Financial Wire')
            link = item.get('link', '#')
            provider_time = item.get('providerPublishTime', int(now))
            lower = title.lower()

            # Categorize by topic
            if any(w in lower for w in ['war', 'conflict', 'military', 'missile', 'attack', 'tensions', 'gaza', 'ukraine', 'russia', 'iran', 'defense', 'air strike', 'bomb', 'strike']):
                category = 'WAR'
            elif any(w in lower for w in ['election', 'vote', 'ballot', 'campaign', 'presidential', 'poll', 'candidate', 'electoral', 'white house']):
                category = 'ELECTIONS'
            elif any(w in lower for w in ['politics', 'government', 'policy', 'congress', 'senate', 'parliament', 'tariff', 'sanction', 'debt', 'trade war', 'biden', 'trump', 'administration']):
                category = 'POLITICS'
            elif any(w in lower for w in ['fed', 'rate', 'cpi', 'inflation', 'gdp', 'nfp', 'payroll', 'yield', 'central bank', 'powell', 'ecb', 'interest rate', 'economy']):
                category = 'MACRO'
            else:
                category = 'MARKET'

            # Sentiment Analysis
            if any(w in lower for w in ['surge', 'bull', 'gain', 'rise', 'high', 'breakout', 'record', 'soar', 'positive', 'rally', 'boost']):
                sentiment = 'BULLISH'
            elif any(w in lower for w in ['drop', 'bear', 'fall', 'plunge', 'sink', 'low', 'fear', 'loss', 'negative', 'warning', 'retreat', 'crash']):
                sentiment = 'BEARISH'
            else:
                sentiment = 'NEUTRAL'

            is_high = any(w in lower for w in ['war', 'missile', 'fed', 'rate', 'cpi', 'election', 'sanction', 'emergency', 'breakout', 'payroll'])
            impact = 'HIGH' if is_high else 'MEDIUM'

            dt = datetime.datetime.fromtimestamp(provider_time)
            harare_time = dt.strftime('%H:%M')

            news_items.append({
                'id': item.get('uuid', str(random.randint(10000, 99999))),
                'title': title,
                'source': publisher,
                'url': link,
                'timestamp_sec': provider_time,
                'time_harare': harare_time,
                'category': category,
                'sentiment': sentiment,
                'impact': impact,
                'summary': f"Coverage for {symbol} regarding global economic catalysts, {category.lower()} headlines, and order flow."
            })

    all_items = news_items

    # ── SYSTEM RECOMMENDATION ANALYZER ("TRADE" vs "HOLD ON") ────────────
    high_impact_war = [i for i in all_items if i['category'] == 'WAR' and i['impact'] == 'HIGH']
    high_impact_election = [i for i in all_items if i['category'] == 'ELECTIONS' and i['impact'] == 'HIGH']
    high_impact_macro = [i for i in all_items if i['category'] == 'MACRO' and i['impact'] == 'HIGH']
    
    bullish_count = len([i for i in all_items if i['sentiment'] == 'BULLISH'])
    bearish_count = len([i for i in all_items if i['sentiment'] == 'BEARISH'])

    has_extreme_volatility = (len(high_impact_war) >= 2) or (len(high_impact_election) >= 2 and len(high_impact_macro) >= 2)

    if not all_items:
        recommendation = "HOLD ON"
        risk_status = "NO LIVE HEADLINES"
        directive = f"HOLD ON — No live news headlines are currently available for {symbol}; news conditions cannot be assessed."
        confidence = 0
        recommendation_badge = "⚠️ HOLD ON (NO LIVE HEADLINES)"
    elif has_extreme_volatility:
        recommendation = "HOLD ON"
        risk_status = "CRITICAL NEWS VOLATILITY SPIKE"
        directive = "HOLD ON — Major breaking war & election news catalysts are active! Spreads may widen sharply. Wait 15–30 minutes for volatility spikes to normalize before entering trades."
        confidence = 92
        recommendation_badge = "🛑 HOLD ON (HIGH VOLATILITY RISK)"
    elif bullish_count > bearish_count + 1:
        recommendation = "TRADE"
        risk_status = "BULLISH CATALYST ALIGNED"
        directive = f"TRADE CONFIRMED — Geopolitical safe-haven demand & macro news favor {symbol} BUY positions. Technical signals align with news sentiment. Execute with standard SL."
        confidence = 88
        recommendation_badge = "🟢 TRADE (CONFIRMED BULLISH CATALYST)"
    elif bearish_count > bullish_count + 1:
        recommendation = "TRADE"
        risk_status = "BEARISH CATALYST ALIGNED"
        directive = f"TRADE CONFIRMED — Economic policy news favors {symbol} SELL positions. Order flow indicates negative sentiment. Execute with strict risk limits."
        confidence = 85
        recommendation_badge = "🔴 TRADE (CONFIRMED BEARISH CATALYST)"
    else:
        recommendation = "HOLD ON"
        risk_status = "BALANCED / CONFLICTING NEWS"
        directive = "HOLD ON — Macro news sentiment is mixed between bullish safe-haven demand and hawkish central bank policies. Wait for a clearer trend break."
        confidence = 75
        recommendation_badge = "⚠️ HOLD ON (NEUTRAL / MIXED NEWS)"

    system_analysis = {
        "symbol": symbol,
        "recommendation": recommendation,  # "TRADE" or "HOLD ON"
        "badge": recommendation_badge,
        "risk_status": risk_status,
        "directive": directive,
        "confidence": confidence,
        "bullish_count": bullish_count,
        "bearish_count": bearish_count,
        "war_news_count": len([i for i in all_items if i['category'] == 'WAR']),
        "politics_news_count": len([i for i in all_items if i['category'] == 'POLITICS']),
        "elections_news_count": len([i for i in all_items if i['category'] == 'ELECTIONS']),
        "macro_news_count": len([i for i in all_items if i['category'] == 'MACRO']),
        "last_updated_harare": datetime.datetime.now().strftime('%H:%M:%S')
    }

    return {
        "symbol": symbol,
        "news": all_items,
        "recommendation": system_analysis
    }

@app.get("/")
def read_root():
    return {
        "system": "Multi-Asset Trading & Signal Dispatching System",
        "status": "ONLINE",
        "oanda": backend.engine.get_oanda_status(),
        "gold_feed": backend.engine.get_gold_feed_status(),
        "telegram_configured": bool(os.getenv("TELEGRAM_BOT_TOKEN") and os.getenv("TELEGRAM_CHAT_ID")),
        "endpoints": ["/api/candles", "/api/orderbook", "/api/signals/check", "/api/trade/close", "/api/trades/history", "/api/report/pdf", "/api/news", "/api/ict/analysis", "/ws/candles/{symbol}"]
    }

@app.get("/api/candles")
def get_candles(
    symbol: str = Query("XAU/USD", description="Trading Symbol (e.g. XAU/USD, EUR/USD, BTC/USDT)"),
    timeframe: str = Query("1m", description="Timeframe interval (1s, 1m, 5m, 15m, 1h)"),
    limit: int = Query(100, description="Candle limit")
):
    df = fetch_ohlcv(symbol=symbol, timeframe=timeframe, limit=limit)
    support, resistance, df = calculate_support_resistance(df)
    
    candles = df.to_dict(orient="records")
    formatted_candles = []
    for c in candles:
        formatted_candles.append({
            "time": int(c["timestamp"] / 1000),
            "open": c["open"],
            "high": c["high"],
            "low": c["low"],
            "close": c["close"],
            "volume": c["volume"]
        })

    latest_price = float(df['close'].iloc[-1])
    return {
        "symbol": symbol,
        "timeframe": timeframe,
        "data_source": df.attrs.get("data_source", "unknown"),
        "latest_price": latest_price,
        "support": support,
        "resistance": resistance,
        "candles": formatted_candles
    }

@app.get("/api/orderbook")
def get_orderbook(
    symbol: str = Query("XAU/USD", description="Trading Symbol"),
    depth: int = Query(20, description="Order book depth")
):
    return fetch_orderbook(symbol=symbol, depth=depth)

@app.post("/api/signals/check")
def check_signals(req: SignalCheckRequest):
    cache_key = f"{req.symbol.upper()}:{req.timeframe}"
    with SIGNAL_CACHE_LOCK:
        now = time.monotonic()
        cached = SIGNAL_CACHE.get(cache_key)
        if cached and now - cached[0] < SIGNAL_CACHE_TTL_SECONDS:
            analysis = cached[1]
        else:
            analysis = analyze_signal_conditions(symbol=req.symbol, timeframe=req.timeframe)
            SIGNAL_CACHE[cache_key] = (time.monotonic(), analysis)
    telegram_res = None
    if req.force_dispatch and analysis["signal_type"] not in {"NONE", "NEUTRAL"}:
        tp = analysis["trade_params"]
        telegram_res = send_telegram_signal(
            symbol=analysis["symbol"],
            signal_type=analysis["signal_type"],
            entry=tp["entry"],
            sl=tp["stop_loss"],
            tp1=tp["tp1"],
            tp2=tp["tp2"],
            rationale=tp["rationale"]
        )
    return {
        "status": "success",
        "analysis": analysis,
        "telegram_result": telegram_res
    }

@app.get("/api/news")
def get_news(symbol: str = Query("XAU/USD")):
    return fetch_market_news(symbol)

@app.get("/api/signals/market-bias")
def get_market_bias(
    symbol: str = Query("XAU/USD", description="Trading symbol"),
    timeframe: str = Query("1m", description="Timeframe interval")
):
    """Returns trend direction, buyer/seller dominance, and candle pattern analysis."""
    result = analyze_market_bias(symbol=symbol, timeframe=timeframe)
    return {"status": "success", "bias": result}

@app.post("/api/trade/close")
def close_trade(req: TradeCloseRequest):
    entry_p = req.entry_price
    exit_p = req.exit_price
    pos_usd = req.position_size_usd
    
    if req.signal_type.upper().startswith("BUY") or req.signal_type.upper().startswith("LONG"):
        pnl_pct = ((exit_p - entry_p) / entry_p) * 100
    else:
        pnl_pct = ((entry_p - exit_p) / entry_p) * 100
    pnl_usd = pos_usd * (pnl_pct / 100)
    
    log_closed_trade(
        symbol=req.symbol,
        signal_type=req.signal_type,
        entry=entry_p,
        exit_p=exit_p,
        sl=req.stop_loss,
        tp=req.take_profit,
        size_usd=pos_usd,
        outcome=req.outcome.upper(),
        rationale=req.rationale or "",
    )
    return {
        "status": "success",
        "message": "Trade logged successfully to SQLite closed_signals database.",
        "pnl_usd": pnl_usd,
        "pnl_percentage": pnl_pct
    }

@app.get("/api/trades/history")
def trade_history():
    trades = get_all_closed_trades()
    return {"status": "success", "count": len(trades), "trades": trades}

@app.get("/api/report/pdf")
def download_pdf_report():
    pdf_path = generate_pdf_monthly_report()
    if not pdf_path or not os.path.exists(pdf_path):
        raise HTTPException(status_code=404, detail="PDF report creation failed.")
    return FileResponse(
        pdf_path,
        media_type="application/pdf",
        filename=os.path.basename(pdf_path)
    )

@app.get("/api/chart-data")
def get_chart_data(symbol: str = Query("XAU/USD"), timeframe: str = Query("5m"), limit: int = Query(500)):
    # Fetch historical data
    df = fetch_ohlcv(symbol, timeframe, limit=limit)
    if df is None or df.empty:
        raise HTTPException(status_code=404, detail="No historical data found.")
        
    # Prepare candles for lightweight-charts
    # lightweight-charts expects time in seconds if it's a number
    candles = []
    for _, row in df.iterrows():
        # Ensure timestamp is in seconds
        ts = int(row['timestamp'])
        if ts > 10000000000:
            ts = ts // 1000
            
        candles.append({
            'time': ts,
            'open': float(row['open']),
            'high': float(row['high']),
            'low': float(row['low']),
            'close': float(row['close']),
        })
        
    # Calculate Pivot Points (Swing Highs and Lows)
    window = 5
    pivots = []
    for i in range(window, len(df) - window):
        is_high = all(df['high'].iloc[i] > df['high'].iloc[i-j] for j in range(1, window+1)) and \
                  all(df['high'].iloc[i] > df['high'].iloc[i+j] for j in range(1, window+1))
        is_low = all(df['low'].iloc[i] < df['low'].iloc[i-j] for j in range(1, window+1)) and \
                 all(df['low'].iloc[i] < df['low'].iloc[i+j] for j in range(1, window+1))
                 
        ts = int(df['timestamp'].iloc[i])
        if ts > 10000000000:
            ts = ts // 1000
            
        if is_high:
            pivots.append({'time': ts, 'price': float(df['high'].iloc[i]), 'type': 'HIGH'})
        if is_low:
            pivots.append({'time': ts, 'price': float(df['low'].iloc[i]), 'type': 'LOW'})
            
    # Label HH, HL, LH, LL
    labeled_pivots = []
    last_high = None
    last_low = None
    for p in pivots:
        if p['type'] == 'HIGH':
            if last_high is None or p['price'] > last_high:
                p['label'] = 'Higher High' if last_high is not None else 'High'
                p['code'] = 'HH'
            else:
                p['label'] = 'Lower High'
                p['code'] = 'LH'
            p['color'] = '#eab308' # Yellow circles
            last_high = p['price']
            labeled_pivots.append(p)
        elif p['type'] == 'LOW':
            if last_low is None or p['price'] > last_low:
                p['label'] = 'Higher Low'
                p['code'] = 'HL'
            else:
                p['label'] = 'Lower Low' if last_low is not None else 'Low'
                p['code'] = 'LL'
            p['color'] = '#eab308' # Yellow circles
            last_low = p['price']
            labeled_pivots.append(p)
            
    # Determine Trend
    trend_status = "Sideways / Consolidating"
    trend_color = "text-amber-400 border-amber-400"
    if len(labeled_pivots) >= 2:
        codes = [p['code'] for p in labeled_pivots[-4:]] # Look at last 4 pivots
        if 'HH' in codes and 'HL' in codes and 'LL' not in codes[-2:] and 'LH' not in codes[-2:]:
            trend_status = "Bullish Market Structure (Upward Trend)"
            trend_color = "text-emerald-400 border-emerald-400"
        elif 'LL' in codes and 'LH' in codes and 'HH' not in codes[-2:] and 'HL' not in codes[-2:]:
            trend_status = "Bearish Market Structure (Downward Trend)"
            trend_color = "text-rose-400 border-rose-400"
        elif codes[-1] == 'HH' or codes[-1] == 'HL':
             if len(codes) >= 2 and (codes[-2] == 'HH' or codes[-2] == 'HL'):
                 trend_status = "Bullish Market Structure (Upward Trend)"
                 trend_color = "text-emerald-400 border-emerald-400"
        elif codes[-1] == 'LL' or codes[-1] == 'LH':
             if len(codes) >= 2 and (codes[-2] == 'LL' or codes[-2] == 'LH'):
                 trend_status = "Bearish Market Structure (Downward Trend)"
                 trend_color = "text-rose-400 border-rose-400"
            
    return {
        "status": "success",
        "symbol": symbol,
        "timeframe": timeframe,
        "data_source": df.attrs.get("data_source", "unknown"),
        "candles": candles,
        "pivots": labeled_pivots,
        "trend": {
            "status": trend_status,
            "color": trend_color
        }
    }

# ── CANDACE ICT SCALPING ENGINE ───────────────────────────────────────────────
# The strategy is execution-driven on the 1-minute, so this endpoint always
# pulls 1m candles regardless of the timeframe the chart is displaying.

ICT_CACHE_TTL_SECONDS = 5.0
ICT_CACHE: Dict[str, Tuple[float, Dict[str, Any]]] = {}
ICT_CACHE_LOCK = threading.Lock()
ICT_1M_LIMIT = 1200          # ~20h, enough to cover an Asia session
ICT_DAILY_LIMIT = 30


@app.get("/api/ict/analysis")
def get_ict_analysis(
    symbol: str = Query("XAU/USD", description="Trading symbol"),
    timeframe: str = Query("1m", description="Chart timeframe (informational only)")
):
    """Session status, liquidity, displacement, FVG/IFVG state and trade signal."""
    cache_key = symbol.upper()
    with ICT_CACHE_LOCK:
        now = time.monotonic()
        cached = ICT_CACHE.get(cache_key)
        if cached and now - cached[0] < ICT_CACHE_TTL_SECONDS:
            return cached[1]

    df_1m = fetch_ohlcv(symbol=symbol, timeframe="1m", limit=ICT_1M_LIMIT)
    candles_1m = ict_engine._candle_rows(df_1m) if df_1m is not None and not df_1m.empty else []
    data_source = df_1m.attrs.get("data_source", "unknown") if df_1m is not None else "unknown"

    daily_rows: List[Dict[str, Any]] = []
    try:
        df_daily = fetch_ohlcv(symbol=symbol, timeframe="1d", limit=ICT_DAILY_LIMIT)
        if df_daily is not None and not df_daily.empty:
            daily_rows = ict_engine._candle_rows(df_daily)
    except Exception as exc:  # daily bias is an enhancement, not a blocker
        print("ICT daily fetch notice:", exc)

    result = ict_engine.analyze_ict(
        symbol=symbol,
        timeframe=timeframe,
        candles_1m=candles_1m,
        daily=daily_rows,
        data_source=data_source,
    )
    result["candles_1m_returned"] = len(candles_1m)
    result["daily_candles_returned"] = len(daily_rows)

    with ICT_CACHE_LOCK:
        ICT_CACHE[cache_key] = (time.monotonic(), result)
    return result
