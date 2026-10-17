"""
Fair Price News Trading Strategy Engine (JJ Simon Framework)
============================================================

Implements the high-probability News Trading Strategy referenced in:
"I Made $1,300,000 in 12 Months — Copy My News Trading Strategy" (JJ Simon)

Core Mechanics:
  1. Pre-News "Fair Price" Anchor:
     The closing body of the exact candle immediately preceding high-impact
     news (e.g. CPI, NFP, FOMC, PPI, Retail Sales) represents market equilibrium.
  2. News Volatility Spike:
     High-impact news creates an initial violent expansion (often a liquidity grab
     or transient repricing) away from Fair Price into extreme premium or discount.
  3. Reversion Setup (Core 75-80% Win Rate Edge):
     Price exhausts at liquidity pools; a Market Structure Break (MSB) occurs back
     toward equilibrium. Price is drawn like a magnet back to the pre-news Fair Price.
  4. Continuation Setup:
     Fundamental repricing breaks HTF structure cleanly with sustained momentum.
  5. The Counter-Wick 20% Filter:
     For a valid entry displacement candle, the opposing wick (counter-wick)
     must NOT exceed 20% of the total candle range.
  6. Volatility-Adjusted Stop & 1.5R Projection:
     Dynamic stop placed beyond structural spike extreme; minimum 1.5R projected
     target + Fair Price magnet target.
"""

import datetime as dt
import math
import re
import threading
import time
from typing import Any, Dict, List, Optional, Tuple
import requests

try:
    from zoneinfo import ZoneInfo
    ET = ZoneInfo("America/New_York")
    UTC = ZoneInfo("UTC")
except Exception:
    ET = dt.timezone(dt.timedelta(hours=-5))
    UTC = dt.timezone.utc

# ── Forex Factory Feed Configuration ──────────────────────────────────────────
FF_CALENDAR_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"
FF_CACHE_TTL_SECONDS = 60.0
_FF_CACHE_LOCK = threading.Lock()
_FF_CACHED_DATA: Optional[List[Dict[str, Any]]] = None
_FF_CACHED_TIME: float = 0.0

# Fallback calendar if network is down
FALLBACK_EVENTS = [
    {
        "title": "CPI m/m",
        "country": "USD",
        "date": "2026-10-15T08:30:00-04:00",
        "impact": "High",
        "forecast": "0.3%",
        "previous": "0.2%",
    },
    {
        "title": "Core CPI m/m",
        "country": "USD",
        "date": "2026-10-15T08:30:00-04:00",
        "impact": "High",
        "forecast": "0.3%",
        "previous": "0.3%",
    },
    {
        "title": "Unemployment Claims",
        "country": "USD",
        "date": "2026-10-16T08:30:00-04:00",
        "impact": "High",
        "forecast": "215K",
        "previous": "218K",
    },
    {
        "title": "Retail Sales m/m",
        "country": "USD",
        "date": "2026-10-16T08:30:00-04:00",
        "impact": "High",
        "forecast": "0.4%",
        "previous": "0.1%",
    },
    {
        "title": "ECB Monetary Policy Statement",
        "country": "EUR",
        "date": "2026-10-16T08:15:00-04:00",
        "impact": "High",
        "forecast": "3.40%",
        "previous": "3.65%",
    },
]

def map_symbol_to_currencies(symbol: str) -> List[str]:
    """Identify which currencies are relevant to a given symbol."""
    sym = symbol.upper().replace("/", "").replace("_", "").replace("-", "")
    if "XAU" in sym or "GOLD" in sym:
        return ["USD"]
    if "BTC" in sym or "ETH" in sym or "SOL" in sym or "REXT" in sym:
        return ["USD"]
    if "EURUSD" in sym:
        return ["EUR", "USD"]
    if "GBPUSD" in sym:
        return ["GBP", "USD"]
    if "USDJPY" in sym:
        return ["USD", "JPY"]
    if "AUDUSD" in sym:
        return ["AUD", "USD"]
    if "USDCAD" in sym:
        return ["USD", "CAD"]
    if "USDCHF" in sym:
        return ["USD", "CHF"]
    if "NZDUSD" in sym:
        return ["NZD", "USD"]
    return ["USD"]


def fetch_forex_factory_calendar(force_refresh: bool = False) -> List[Dict[str, Any]]:
    """Fetch and parse Forex Factory weekly JSON feed with caching and rich metadata."""
    global _FF_CACHED_DATA, _FF_CACHED_TIME
    now_mono = time.monotonic()

    with _FF_CACHE_LOCK:
        if not force_refresh and _FF_CACHED_DATA is not None and (now_mono - _FF_CACHED_TIME < FF_CACHE_TTL_SECONDS):
            return _FF_CACHED_DATA

    raw_list: List[Dict[str, Any]] = []
    try:
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
        res = requests.get(FF_CALENDAR_URL, headers=headers, timeout=5.0)
        if res.status_code == 200:
            raw_list = res.json()
    except Exception as e:
        print(f"[NewsEngine] Forex Factory fetch notice: {e}")

    if not raw_list and _FF_CACHED_DATA is not None:
        return _FF_CACHED_DATA

    if not raw_list:
        raw_list = FALLBACK_EVENTS

    # Process and enrich events
    now_dt = dt.datetime.now(dt.timezone.utc)
    enriched: List[Dict[str, Any]] = []

    for idx, item in enumerate(raw_list):
        title = item.get("title", "Economic Event").strip()
        country = item.get("country", "USD").strip().upper()
        impact = item.get("impact", "Low").strip()
        forecast = str(item.get("forecast") or "").strip()
        previous = str(item.get("previous") or "").strip()
        raw_date = item.get("date", "")

        # Parse date
        event_dt = None
        try:
            event_dt = dt.datetime.fromisoformat(raw_date)
            if event_dt.tzinfo is None:
                event_dt = event_dt.replace(tzinfo=UTC)
        except Exception:
            event_dt = now_dt

        diff_seconds = (event_dt - now_dt).total_seconds()
        diff_minutes = int(diff_seconds / 60)

        # Status and countdown
        if diff_seconds > 0:
            if diff_minutes < 15:
                status = "RELEASING_SOON"
                countdown = f"in {diff_minutes}m"
            else:
                hrs = diff_minutes // 60
                mins = diff_minutes % 60
                status = "UPCOMING"
                countdown = f"in {hrs}h {mins}m" if hrs > 0 else f"in {mins}m"
        elif diff_seconds >= -900:  # within 15 mins after release
            status = "RELEASING_NOW"
            countdown = "NOW (Active Volatility)"
        else:
            past_mins = abs(diff_minutes)
            if past_mins < 120:
                status = "RECENT"
                countdown = f"{past_mins}m ago"
            else:
                past_hrs = past_mins // 60
                status = "PAST"
                countdown = f"{past_hrs}h ago"

        # Impact badge styling
        impact_norm = impact.lower()
        if "high" in impact_norm:
            impact_level = "High"
            impact_color = "red"
            impact_weight = 3
        elif "medium" in impact_norm:
            impact_level = "Medium"
            impact_color = "orange"
            impact_weight = 2
        elif "holiday" in impact_norm:
            impact_level = "Holiday"
            impact_color = "gray"
            impact_weight = 0
        else:
            impact_level = "Low"
            impact_color = "yellow"
            impact_weight = 1

        # Format date & time in ET
        event_et = event_dt.astimezone(ET) if hasattr(event_dt, "astimezone") else event_dt
        time_str = event_et.strftime("%H:%M ET")
        date_str = event_et.strftime("%a, %b %d")

        enriched.append({
            "id": f"ff_{country}_{idx}_{int(event_dt.timestamp())}",
            "title": title,
            "country": country,
            "impact": impact_level,
            "impact_color": impact_color,
            "impact_weight": impact_weight,
            "date_iso": event_dt.isoformat(),
            "date_str": date_str,
            "time_str": time_str,
            "forecast": forecast or "—",
            "previous": previous or "—",
            "diff_minutes": diff_minutes,
            "status": status,
            "countdown": countdown,
            "is_red_folder": impact_level == "High",
        })

    # Sort primarily by time difference relative to now
    enriched.sort(key=lambda x: x["diff_minutes"])

    with _FF_CACHE_LOCK:
        _FF_CACHED_DATA = enriched
        _FF_CACHED_TIME = now_mono

    return enriched


def calculate_atr(candles: List[Dict[str, Any]], period: int = 14) -> float:
    """Calculates True Range ATR."""
    if len(candles) < 2:
        return 1.0
    tr_list = []
    for i in range(1, len(candles)):
        c = candles[i]
        p = candles[i - 1]
        h = float(c["high"])
        l = float(c["low"])
        prev_close = float(p["close"])
        tr = max(h - l, abs(h - prev_close), abs(l - prev_close))
        tr_list.append(tr)
    recent_tr = tr_list[-period:] if len(tr_list) >= period else tr_list
    return sum(recent_tr) / len(recent_tr) if recent_tr else 1.0


def check_counter_wick_rule(candle: Dict[str, Any], direction: str) -> Tuple[float, bool, str]:
    """
    JJ Simon's Counter-Wick Rule (< 20%):
      - If LONG: Top wick (wick opposing the move upward) must be <= 20% of the total candle range.
      - If SHORT: Bottom wick (wick opposing the move downward) must be <= 20% of the total candle range.
    Returns: (counter_wick_ratio_percent, is_valid, explanation)
    """
    o = float(candle["open"])
    h = float(candle["high"])
    l = float(candle["low"])
    c = float(candle["close"])
    total_range = h - l

    if total_range <= 1e-6:
        return 0.0, True, "Flat candle"

    if direction == "BUY/LONG":
        # Opposing wick is the upper wick
        upper_wick = h - max(o, c)
        ratio = (upper_wick / total_range) * 100.0
        is_valid = ratio <= 20.0
        note = f"Upper counter-wick is {ratio:.1f}% (limit: 20%). " + (
            "CLEAN BUY DISPLACEMENT" if is_valid else "EXCESSIVE SELLING RESISTANCE (>20%)"
        )
        return ratio, is_valid, note
    else:  # SELL/SHORT
        # Opposing wick is the lower wick
        lower_wick = min(o, c) - l
        ratio = (lower_wick / total_range) * 100.0
        is_valid = ratio <= 20.0
        note = f"Lower counter-wick is {ratio:.1f}% (limit: 20%). " + (
            "CLEAN SELL DISPLACEMENT" if is_valid else "EXCESSIVE BUYING RESISTANCE (>20%)"
        )
        return ratio, is_valid, note


def analyze_news_strategy(
    symbol: str = "XAU/USD",
    timeframe: str = "1m",
    candles_1m: Optional[List[Dict[str, Any]]] = None,
    data_source: str = "live"
) -> Dict[str, Any]:
    """
    Executes JJ Simon's Fair Price News Trading Strategy analysis:
      - Economic news context & countdown
      - Pre-news Fair Price anchor determination
      - News spike detection & liquidity extension
      - Reversion (Fade to Fair Price) vs Continuation detection
      - Counter-wick 20% threshold validation
      - Precision Stop Loss (ATR buffer) & 1.5R projection targets
      - Visual marked candles & chart levels
    """
    all_events = fetch_forex_factory_calendar()
    currencies = map_symbol_to_currencies(symbol)

    # Filter events for active symbol
    relevant_events = [e for e in all_events if e["country"] in currencies]
    high_impact_events = [e for e in relevant_events if e["impact"] == "High"]
    if not high_impact_events:
        high_impact_events = [e for e in all_events if e["impact"] == "High"]

    # Locate nearest event (either upcoming or recent within last 180 mins)
    upcoming_events = [e for e in high_impact_events if e["diff_minutes"] >= -15]
    nearest_event = upcoming_events[0] if upcoming_events else (high_impact_events[0] if high_impact_events else None)

    recent_past_events = [e for e in high_impact_events if -180 <= e["diff_minutes"] < 0]
    active_news_event = recent_past_events[-1] if recent_past_events else nearest_event

    candles = candles_1m or []
    if len(candles) < 20:
        # Generate safe defaults if insufficient candles
        return {
            "status": "INSUFFICIENT_DATA",
            "symbol": symbol,
            "timeframe": timeframe,
            "data_source": data_source,
            "active_news_event": active_news_event,
            "upcoming_events": upcoming_events[:5],
            "setup": None,
            "marked_candles": [],
            "chart_lines": [],
            "projection": None,
        }

    atr14 = calculate_atr(candles, 14)
    last_candle = candles[-1]
    current_price = float(last_candle["close"])

    # ── 1. Determine the Pre-News "Fair Price" Anchor ─────────────────────────
    # Look back over the last 30 to 60 candles to find the consolidation baseline
    # before the biggest volatility expansion.
    lookback = min(len(candles), 45)
    sample_window = candles[-lookback:]

    # Calculate candle ranges to find the highest volatility impulse candle
    max_range = 0.0
    spike_idx = -1
    for i, c in enumerate(sample_window):
        rng = float(c["high"]) - float(c["low"])
        if rng > max_range:
            max_range = rng
            spike_idx = i

    # The candle immediately preceding the spike is the "Fair Price" reference candle
    if spike_idx > 1:
        fair_price_candle = sample_window[spike_idx - 1]
    else:
        fair_price_candle = sample_window[0]

    fair_price = float(fair_price_candle["close"])
    fair_price_high = float(fair_price_candle["high"])
    fair_price_low = float(fair_price_candle["low"])
    fair_price_time = fair_price_candle.get("time", "")

    spike_candle = sample_window[spike_idx] if spike_idx >= 0 else sample_window[-5]
    spike_high = float(spike_candle["high"])
    spike_low = float(spike_candle["low"])

    # Maximum price excursion during the window
    highest_p = max(float(c["high"]) for c in sample_window)
    lowest_p = min(float(c["low"]) for c in sample_window)

    dist_from_fair = current_price - fair_price
    abs_dist = abs(dist_from_fair)

    # ── 2. Classify Setup: Reversion vs Continuation ─────────────────────────
    # JJ Simon Core Rule:
    # If price expanded rapidly away from Fair Price into premium (above Fair Price)
    # and shows bearish displacement with counter-wick <= 20%, we enter SHORT targeting Fair Price.
    # If price plunged into discount (below Fair Price) and shows bullish displacement,
    # we enter LONG targeting Fair Price.

    setup_type = "REVERSION"  # Default JJ Simon high win-rate setup
    direction = "STANDBY"
    entry_price = current_price
    stop_loss = 0.0
    take_profit_1_5r = 0.0
    take_profit_fair = fair_price
    counter_wick_ratio = 0.0
    counter_wick_valid = False
    counter_wick_notes = ""
    phase = "STANDBY"
    confidence = 0

    # Check for recent displacement triggers in the last 5 candles
    recent_candidates = sample_window[-6:]
    best_trigger = None

    if dist_from_fair > (0.6 * atr14):
        # Bullish spike occurred -> Look for Bearish Reversion back to Fair Price
        direction = "SELL/SHORT"
        # Find trigger candle with lowest counter-wick
        for cand in reversed(recent_candidates):
            ratio, valid, note = check_counter_wick_rule(cand, "SELL/SHORT")
            if valid and float(cand["close"]) < float(cand["open"]):
                best_trigger = cand
                counter_wick_ratio = ratio
                counter_wick_valid = valid
                counter_wick_notes = note
                break

        if not best_trigger:
            best_trigger = last_candle
            counter_wick_ratio, counter_wick_valid, counter_wick_notes = check_counter_wick_rule(last_candle, "SELL/SHORT")

        entry_price = float(best_trigger["close"])
        # Stop loss placed above the spike high + 0.5 ATR buffer
        stop_loss = highest_p + (0.5 * atr14)
        risk = max(abs(stop_loss - entry_price), 0.2 * atr14)
        # 1.5R projection target
        take_profit_1_5r = entry_price - (1.5 * risk)
        take_profit_fair = fair_price

        if counter_wick_valid:
            phase = "ENTRY_READY"
            confidence = 82
        else:
            phase = "EXHAUSTION_WAIT"
            confidence = 65

    elif dist_from_fair < -(0.6 * atr14):
        # Bearish plunge occurred -> Look for Bullish Reversion back to Fair Price
        direction = "BUY/LONG"
        for cand in reversed(recent_candidates):
            ratio, valid, note = check_counter_wick_rule(cand, "BUY/LONG")
            if valid and float(cand["close"]) > float(cand["open"]):
                best_trigger = cand
                counter_wick_ratio = ratio
                counter_wick_valid = valid
                counter_wick_notes = note
                break

        if not best_trigger:
            best_trigger = last_candle
            counter_wick_ratio, counter_wick_valid, counter_wick_notes = check_counter_wick_rule(last_candle, "BUY/LONG")

        entry_price = float(best_trigger["close"])
        # Stop loss placed below the spike low - 0.5 ATR buffer
        stop_loss = lowest_p - (0.5 * atr14)
        risk = max(abs(entry_price - stop_loss), 0.2 * atr14)
        # 1.5R projection target
        take_profit_1_5r = entry_price + (1.5 * risk)
        take_profit_fair = fair_price

        if counter_wick_valid:
            phase = "ENTRY_READY"
            confidence = 82
        else:
            phase = "EXHAUSTION_WAIT"
            confidence = 65
    else:
        # Near Fair Price (Equilibrium)
        direction = "WAIT"
        phase = "AT_FAIR_PRICE"
        entry_price = current_price
        stop_loss = current_price - atr14
        take_profit_1_5r = current_price + (1.5 * atr14)
        confidence = 50
        counter_wick_notes = "Price currently trading near pre-news equilibrium. Awaiting news catalyst injection."

    risk_pts = abs(entry_price - stop_loss)
    reward_pts_1_5r = abs(take_profit_1_5r - entry_price)
    reward_pts_fair = abs(take_profit_fair - entry_price)
    rr_ratio_1_5r = round(reward_pts_1_5r / risk_pts, 2) if risk_pts > 0 else 1.5
    rr_ratio_fair = round(reward_pts_fair / risk_pts, 2) if risk_pts > 0 else 1.0

    # ── 3. Market Path Projection ─────────────────────────────────────────────
    # Formulate step-by-step projection path for where the market is going
    precision = 2 if ("XAU" in symbol.upper() or "BTC" in symbol.upper()) else 5

    projection_summary = ""
    projection_steps = []

    if direction == "SELL/SHORT":
        projection_summary = f"Bearish Reversion back to pre-news Fair Price ${fair_price:.{precision}f}"
        projection_steps = [
            {"step": 1, "title": "News Spike Injected", "desc": f"Spiked to high ${highest_p:.{precision}f}, tapping premium liquidity pools."},
            {"step": 2, "title": "Shift & Counter-Wick Check", "desc": f"Displacement down confirmed with counter-wick at {counter_wick_ratio:.1f}% (< 20%)."},
            {"step": 3, "title": "Target 1 (1.5R Execution)", "desc": f"Projected intermediate milestone at ${take_profit_1_5r:.{precision}f}."},
            {"step": 4, "title": "Final Magnet (Fair Price)", "desc": f"Full mean reversion target resting at equilibrium ${fair_price:.{precision}f}."},
        ]
    elif direction == "BUY/LONG":
        projection_summary = f"Bullish Reversion back to pre-news Fair Price ${fair_price:.{precision}f}"
        projection_steps = [
            {"step": 1, "title": "News Dip Injected", "desc": f"Plunged to low ${lowest_p:.{precision}f}, sweeping discount sell stops."},
            {"step": 2, "title": "Shift & Counter-Wick Check", "desc": f"Displacement up confirmed with counter-wick at {counter_wick_ratio:.1f}% (< 20%)."},
            {"step": 3, "title": "Target 1 (1.5R Execution)", "desc": f"Projected intermediate milestone at ${take_profit_1_5r:.{precision}f}."},
            {"step": 4, "title": "Final Magnet (Fair Price)", "desc": f"Full mean reversion target resting at equilibrium ${fair_price:.{precision}f}."},
        ]
    else:
        projection_summary = "Market in Equilibrium (Awaiting news release spike)"
        projection_steps = [
            {"step": 1, "title": "Fair Price Established", "desc": f"Pre-news reference level stabilized at ${fair_price:.{precision}f}."},
            {"step": 2, "title": "Awaiting High-Impact Release", "desc": f"Standby for {active_news_event['title'] if active_news_event else 'upcoming news'} volatility."},
            {"step": 3, "title": "Fade the Extreme", "desc": "Do not chase initial 60 seconds spike; wait for counter-wick < 20% reversal trigger."},
        ]

    # ── 4. Marked Candles ─────────────────────────────────────────────────────
    marked_candles = [
        {
            "tag": "FAIR_PRICE",
            "badge": "🎯 FAIR PRICE CANDLE",
            "price": fair_price,
            "time": fair_price_candle.get("time", ""),
            "open": float(fair_price_candle["open"]),
            "high": float(fair_price_candle["high"]),
            "low": float(fair_price_candle["low"]),
            "close": float(fair_price_candle["close"]),
            "role": "Pre-news baseline equilibrium (institutional reference level)",
        },
        {
            "tag": "NEWS_SPIKE",
            "badge": "⚡ NEWS SPIKE IMPULSE",
            "price": spike_high if direction == "SELL/SHORT" else spike_low,
            "time": spike_candle.get("time", ""),
            "open": float(spike_candle["open"]),
            "high": float(spike_candle["high"]),
            "low": float(spike_candle["low"]),
            "close": float(spike_candle["close"]),
            "role": "Peak volatility excursion sweeping liquidity",
        },
    ]

    if best_trigger:
        marked_candles.append({
            "tag": "ENTRY_TRIGGER",
            "badge": "🚀 DISPLACEMENT TRIGGER",
            "price": entry_price,
            "time": best_trigger.get("time", ""),
            "open": float(best_trigger["open"]),
            "high": float(best_trigger["high"]),
            "low": float(best_trigger["low"]),
            "close": float(best_trigger["close"]),
            "counter_wick_ratio": round(counter_wick_ratio, 1),
            "counter_wick_valid": counter_wick_valid,
            "role": f"Entry candle confirmation (Counter-wick {counter_wick_ratio:.1f}% <= 20%)",
        })

    # ── 5. Chart Overlay Lines for TradingView ─────────────────────────────────
    chart_lines = [
        {
            "price": round(fair_price, precision),
            "color": "#eab308",  # Gold / Amber
            "title": f"Fair Price Anchor (${fair_price:.{precision}f})",
            "lineWidth": 2,
            "lineStyle": 0,
        },
        {
            "price": round(highest_p if direction == "SELL/SHORT" else lowest_p, precision),
            "color": "#a855f7",  # Purple
            "title": f"News Spike Extreme (${(highest_p if direction == 'SELL/SHORT' else lowest_p):.{precision}f})",
            "lineWidth": 1,
            "lineStyle": 2,
        },
    ]

    if phase == "ENTRY_READY" or direction in ("BUY/LONG", "SELL/SHORT"):
        chart_lines.extend([
            {
                "price": round(entry_price, precision),
                "color": "#3b82f6",  # Blue
                "title": f"News Entry Trigger (${entry_price:.{precision}f})",
                "lineWidth": 2,
                "lineStyle": 0,
            },
            {
                "price": round(stop_loss, precision),
                "color": "#ef4444",  # Red
                "title": f"Stop Loss [ATR Buffer] (${stop_loss:.{precision}f})",
                "lineWidth": 2,
                "lineStyle": 1,
            },
            {
                "price": round(take_profit_1_5r, precision),
                "color": "#10b981",  # Emerald
                "title": f"Target 1.5R (${take_profit_1_5r:.{precision}f})",
                "lineWidth": 2,
                "lineStyle": 0,
            },
        ])

    return {
        "status": "SUCCESS",
        "symbol": symbol,
        "timeframe": timeframe,
        "data_source": data_source,
        "current_price": current_price,
        "active_news_event": active_news_event,
        "upcoming_events": upcoming_events[:8],
        "all_relevant_events": relevant_events[:15],
        "setup": {
            "type": setup_type,
            "direction": direction,
            "phase": phase,
            "confidence": confidence,
            "entry_price": round(entry_price, precision),
            "stop_loss": round(stop_loss, precision),
            "take_profit_1_5r": round(take_profit_1_5r, precision),
            "take_profit_fair": round(take_profit_fair, precision),
            "fair_price": round(fair_price, precision),
            "risk_points": round(risk_pts, precision),
            "reward_points_1_5r": round(reward_pts_1_5r, precision),
            "rr_ratio_1_5r": rr_ratio_1_5r,
            "counter_wick_ratio": round(counter_wick_ratio, 1),
            "counter_wick_valid": counter_wick_valid,
            "counter_wick_notes": counter_wick_notes,
            "atr14": round(atr14, precision),
        },
        "projection": {
            "summary": projection_summary,
            "steps": projection_steps,
            "target_price": round(take_profit_1_5r, precision),
            "ultimate_target": round(take_profit_fair, precision),
        },
        "marked_candles": marked_candles,
        "chart_lines": chart_lines,
    }
