"""
Candace ICT Scalping Engine
==========================

Implements the AMD (Accumulation / Manipulation / Distribution) session
framework with liquidity-sweep, displacement and Fair Value Gap logic.

Rules implemented (from the strategy brief):
  * Session trap filter - an Asia session that extends and closes on its own
     boundary is flagged as a London-open pump/dump trap. The counter-trend
     side is inhibited until a raid and MSS confirm it.
  * London model      - raid the Asia boundary, require a market structure
     shift with displacement, then take the market order on the retest of the
     displacement FVG/IFVG with the stop beyond the displacement swing.
  * New York model    - two scenarios selected by the HTF draw-on-liquidity
     state at the NY open: Scenario 1 continues the London trend off a retrace
     toward an unreached PDH/PDL, Scenario 2 fades the London Close exhaustion
     toward internal London liquidity or the midnight open.
  * Killzone gating  - London 02:00-05:00 ET, New York 09:00-12:00 ET.
     No trades are permitted outside a killzone.
  * Higher-timeframe bias from Daily / 1-Hour Fair Value Gaps and liquidity
     (previous day high/low, midnight open).
  * Liquidity sweep  - price wicks beyond a pool to take stops, then fails to
     hold (wick through, close back inside).
  * Displacement     - candle body > 75% of range with volume above the 20
     period average, breaking structure.
  * FVG / IFVG       - 3-candle imbalance, inverted once a candle *body*
     closes through the far boundary.
  * Risk             - hard stop behind the structural swing, capped by a
     session points limit; minimum 1:2 R:R; setups whose structural stop
     exceeds the cap are cancelled.

Instruments in this app (gold, FX, crypto) are not quoted in NQ index points,
so the published point limits are scaled by ATR to keep their intended
economic meaning. On NQ -- where ATR(14) on the 1-minute is roughly 25 points
-- the caps land on exactly the documented 25 (London) and 40 (New York).
"""

import datetime as dt
from typing import Any, Dict, List, Optional, Tuple

try:  # pragma: no cover - zoneinfo is stdlib on 3.9+, needs tzdata on Windows
    from zoneinfo import ZoneInfo

    ET = ZoneInfo("America/New_York")
    HARARE = ZoneInfo("Africa/Harare")
except Exception:  # pragma: no cover
    ET = dt.timezone(dt.timedelta(hours=-5))
    HARARE = dt.timezone(dt.timedelta(hours=2))

# ── Session framework ─────────────────────────────────────────────────────────
# Asia accumulates liquidity for the next session; London and New York are the
# two killzones where manipulation -> distribution is traded.

ASIA_START_HOUR = 19          # 19:00 ET (previous day)
ASIA_END_HOUR = 2             # 02:00 ET
LONDON_KZ = (2, 5)            # 02:00 - 05:00 ET
# New York is split into two evaluation windows. Continuation plays the London
# trend off a retrace in the first hour; reversal plays the exhaustion after
# London has already reached its draw on liquidity.
NY_CONTINUATION_KZ = (9, 10)   # 09:00 - 10:00 ET
NY_REVERSAL_KZ = (10, 12)      # 10:00 - 12:00 ET
NY_KZ = (NY_CONTINUATION_KZ[0], NY_REVERSAL_KZ[1])   # 09:00 - 12:00 ET
MIDNIGHT_OPEN_HOUR = 0        # 12:00 AM ET daily open
RTH_OPEN_HOUR = 9             # 09:30 ET regular-trading-hours open (futures)

# ── Session trap filter ───────────────────────────────────────────────────────
# How far into the Asia range the session must close, as a fraction of that
# range, before the move counts as an extended ("trapped") finish.
ASIA_TRAP_CLOSE_THRESHOLD = 0.30
# Asia must also have travelled at least this share of its own range in one
# direction; a flat drift to the high is not a strong trend.
ASIA_TREND_MIN_MOVE = 0.50

# ── New York scenario selection ───────────────────────────────────────────────
# London must expand by at least this multiple of ATR(14) to count as a "clean,
# strong expansion move" for the continuation scenario.
LONDON_EXPANSION_ATR_MULT = 1.0

# ── Risk parameters ───────────────────────────────────────────────────────────

LONDON_MAX_REF_POINTS = 25.0
NY_MAX_REF_POINTS = 40.0
REFERENCE_ATR_POINTS = 25.0   # typical NQ 1-minute ATR in index points
MIN_RR = 2.0
DISPLACEMENT_BODY_RATIO = 0.75
VOLUME_LOOKBACK = 20
FVG_MAX_AGE_CANDLES = 60      # only gaps formed recently are actionable

CONFLUENCE_FACTORS = [
    "htf_daily_fvg",
    "htf_1h_fvg",
    "liquidity_sweep",
    "displacement",
    "ifvg_trigger",
]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _fmt(dt_value: Optional[dt.datetime]) -> str:
    if dt_value is None:
        return "--:--"
    return dt_value.strftime("%H:%M")


def _fmt_countdown(seconds: float) -> str:
    seconds = int(max(0, seconds))
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    if h > 0:
        return f"{h}h {m:02d}m"
    if m > 0:
        return f"{m}m {s:02d}s"
    return f"{s}s"


def _candle_rows(df) -> List[Dict[str, Any]]:
    """Normalise an OHLCV DataFrame into plain dicts with second timestamps."""
    rows: List[Dict[str, Any]] = []
    for _, row in df.iterrows():
        ts = int(row["timestamp"])
        if ts > 10000000000:
            ts //= 1000
        rows.append({
            "time": ts,
            "open": float(row["open"]),
            "high": float(row["high"]),
            "low": float(row["low"]),
            "close": float(row["close"]),
            "volume": float(row.get("volume", 0) or 0),
        })
    return rows


def drop_forming_candle(rows: List[Dict[str, Any]], timeframe_seconds: int = 60) -> List[Dict[str, Any]]:
    """Drop the trailing still-forming candle.

    Live 1-minute feeds include the in-progress bar, which has a partial (often
    zero) range and no volume. Including it corrupts displacement, sweep and
    FVG detection, so it is removed before any analysis runs.
    """
    if not rows:
        return rows
    current_bucket = int(dt.datetime.now(ET).timestamp()) // timeframe_seconds * timeframe_seconds
    if rows[-1]["time"] >= current_bucket:
        return rows[:-1]
    return rows


def _resample(rows: List[Dict[str, Any]], step_seconds: int) -> List[Dict[str, Any]]:
    """Aggregate 1-minute candles into a higher timeframe."""
    buckets: Dict[int, Dict[str, float]] = {}
    order: List[int] = []
    for r in rows:
        key = (r["time"] // step_seconds) * step_seconds
        if key not in buckets:
            buckets[key] = {
                "time": key, "open": r["open"], "high": r["high"],
                "low": r["low"], "close": r["close"], "volume": r["volume"],
            }
            order.append(key)
        else:
            b = buckets[key]
            b["high"] = max(b["high"], r["high"])
            b["low"] = min(b["low"], r["low"])
            b["close"] = r["close"]
            b["volume"] += r["volume"]
    return [buckets[k] for k in order]


def _true_range(candles: List[Dict[str, Any]], period: int = 14) -> float:
    if len(candles) < 2:
        return 0.0
    window = candles[-(period + 1):]
    ranges = []
    for prev, cur in zip(window, window[1:]):
        ranges.append(max(
            cur["high"] - cur["low"],
            abs(cur["high"] - prev["close"]),
            abs(cur["low"] - prev["close"]),
        ))
    if not ranges:
        return 0.0
    return sum(ranges) / len(ranges)


# ── Session classification ────────────────────────────────────────────────────

def classify_session(now_et: dt.datetime) -> Dict[str, Any]:
    """Return the active session, its AMD phase and killzone status."""
    weekday = now_et.weekday()          # 0=Mon .. 6=Sun
    hour = now_et.hour + now_et.minute / 60.0

    is_weekend = weekday >= 5

    in_asia = hour >= ASIA_START_HOUR or hour < ASIA_END_HOUR
    in_london = LONDON_KZ[0] <= hour < LONDON_KZ[1]
    in_ny = NY_KZ[0] <= hour < NY_KZ[1]

    if in_london:
        name, killzone = "LONDON", "LONDON"
    elif in_ny:
        name, killzone = "NEW YORK", "NEW_YORK"
    elif in_asia:
        name, killzone = "ASIA", None
    else:
        name, killzone = "OFF_HOURS", None

# AMD: Asia accumulates, the first hour of a killzone manipulates, the
    # remainder distributes away from the swept pool.
    if name == "ASIA":
        phase = "ACCUMULATION"
    elif name == "LONDON" and hour < LONDON_KZ[0] + 1:
        phase = "MANIPULATION"
    elif name == "LONDON":
        phase = "DISTRIBUTION"
    elif name == "NEW YORK" and hour < NY_CONTINUATION_KZ[1]:
        phase = "MANIPULATION"
    elif name == "NEW YORK":
        phase = "DISTRIBUTION"
    else:
        phase = "NEUTRAL"

    if name == "NEW YORK":
        sub_window = ("CONTINUATION" if hour < NY_CONTINUATION_KZ[1] else "REVERSAL")
    else:
        sub_window = None

    if name == "LONDON":
        guidance = "LONDON KILLZONE — wait for the Asia-range raid, then MSS + FVG/IFVG."
    elif name == "NEW YORK" and sub_window == "CONTINUATION":
        guidance = "NY CONTINUATION WINDOW — London trend continuation off a London FVG/OB retrace."
    elif name == "NEW YORK":
        guidance = "NY REVERSAL WINDOW — London reached its DOL; look for exhaustion and reversal."
    elif name == "ASIA":
        guidance = "ASIA ACCUMULATION — do not trade. Mark the Asia range; wait for the London sweep."
    else:
        guidance = "OUTSIDE KILLZONES — stand aside and wait for London or New York."

    return {
        "name": name,
        "phase": phase,
        "killzone": killzone,
        "sub_window": sub_window,
        "in_killzone": killzone is not None,
        "is_weekend": is_weekend,
        "trading_allowed": bool(killzone) and not is_weekend,
        "guidance": guidance,
        "et_time": _fmt(now_et),
        "harare_time": _fmt(now_et.astimezone(HARARE)),
    }


def next_killzone(now_et: dt.datetime) -> Dict[str, Any]:
    """Return the upcoming killzone and a countdown to its open."""
    candidates: List[Tuple[str, dt.datetime, dt.datetime]] = []
    for offset in (0, 1):
        day = (now_et + dt.timedelta(days=offset)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        for label, (start_h, end_h) in (("LONDON", LONDON_KZ), ("NEW_YORK", NY_KZ)):
            opens = day.replace(hour=start_h)
            closes = day.replace(hour=end_h)
            if closes > now_et:
                candidates.append((label, opens, closes))

    if not candidates:
        return {"label": None, "seconds_until": None, "countdown": "--:--",
                "opens_et": None, "opens_harare": None}

    candidates.sort(key=lambda c: c[1])
    label, opens, closes = candidates[0]
    seconds = (opens - now_et).total_seconds()
    return {
        "label": label,
        "seconds_until": int(max(0, seconds)),
        "countdown": _fmt_countdown(seconds),
        "opens_et": opens.strftime("%H:%M"),
        "opens_harare": opens.astimezone(HARARE).strftime("%H:%M"),
    }


def session_windows(now_et: dt.datetime) -> List[Dict[str, Any]]:
    """Today's session schedule with live status, in ET and Harare local time."""
    midnight = now_et.replace(hour=0, minute=0, second=0, microsecond=0)
    specs = [
        ("ASIA", "Accumulation", midnight - dt.timedelta(hours=5), midnight.replace(hour=ASIA_END_HOUR), False),
        ("LONDON", "Raid -> MSS -> FVG", midnight.replace(hour=LONDON_KZ[0]), midnight.replace(hour=LONDON_KZ[1]), True),
        ("NEW YORK", "Continuation (Scenario 1)", midnight.replace(hour=NY_CONTINUATION_KZ[0]), midnight.replace(hour=NY_CONTINUATION_KZ[1]), True),
        ("NEW YORK", "Reversal (Scenario 2)", midnight.replace(hour=NY_REVERSAL_KZ[0]), midnight.replace(hour=NY_REVERSAL_KZ[1]), True),
    ]
    out = []
    for name, purpose, opens, closes, is_kz in specs:
        state = "LIVE" if opens <= now_et < closes else ("UPCOMING" if opens > now_et else "CLOSED")
        out.append({
            "name": name,
            "purpose": purpose,
            "is_killzone": is_kz,
            "opens_et": opens.strftime("%H:%M"),
            "closes_et": closes.strftime("%H:%M"),
            "opens_harare": opens.astimezone(HARARE).strftime("%H:%M"),
            "closes_harare": closes.astimezone(HARARE).strftime("%H:%M"),
            "status": state,
            "countdown": _fmt_countdown((opens - now_et).total_seconds()) if state == "UPCOMING" else "--:--",
        })
    return out


def session_anchors(now_et: dt.datetime) -> Dict[str, Any]:
    """Midnight open price and the developing RTH gap."""
    midnight = now_et.replace(hour=MIDNIGHT_OPEN_HOUR, minute=0, second=0, microsecond=0)
    rth_open = now_et.replace(hour=RTH_OPEN_HOUR, minute=30, second=0, microsecond=0)
    return {
        "midnight_open_et": midnight.strftime("%H:%M"),
        "midnight_open_harare": midnight.astimezone(HARARE).strftime("%H:%M"),
        "rth_open_et": rth_open.strftime("%H:%M"),
        "rth_open_harare": rth_open.astimezone(HARARE).strftime("%H:%M"),
        "minutes_since_midnight_open": int((now_et - midnight).total_seconds() // 60),
        "minutes_to_rth_open": int((rth_open - now_et).total_seconds() // 60),
    }


# ── Asia range ────────────────────────────────────────────────────────────────

def asia_session_candles(candles: List[Dict[str, Any]], now_et: dt.datetime) -> List[Dict[str, Any]]:
    """Candles belonging to the Asia session that contains "now"."""
    if not candles:
        return []

    # Anchor to the Asia session that contains "now": if now is before 02:00 the
    # session started on the previous evening at 19:00, otherwise it started
    # today at 19:00 (i.e. it has not begun yet).
    if now_et.hour >= ASIA_START_HOUR:
        anchor_day = now_et.date()
    else:
        anchor_day = (now_et - dt.timedelta(days=1)).date()

    start_ts = int(dt.datetime.combine(
        anchor_day, dt.time(ASIA_START_HOUR), tzinfo=ET).timestamp())
    # The session opens on the evening of `anchor_day` and closes at 02:00 on
    # the FOLLOWING day, so the end date is anchor_day + 1.
    end_ts = int(dt.datetime.combine(
        anchor_day + dt.timedelta(days=1), dt.time(ASIA_END_HOUR), tzinfo=ET).timestamp())

    return [c for c in candles if start_ts <= c["time"] < end_ts]


def asia_range(candles: List[Dict[str, Any]], now_et: dt.datetime) -> Optional[Dict[str, Any]]:
    """High/low of the current Asia session (19:00 ET -> 02:00 ET)."""
    if not candles:
        return None

    window = asia_session_candles(candles, now_et)
    if len(window) < 5:
        return None

    highs = [c["high"] for c in window]
    lows = [c["low"] for c in window]
    asia_high, asia_low = max(highs), min(lows)
    current_price = candles[-1]["close"]

    return {
        "high": round(asia_high, 2),
        "low": round(asia_low, 2),
        "midpoint": round((asia_high + asia_low) / 2, 2),
        "range_points": round(asia_high - asia_low, 2),
        "candles_covered": len(window),
        "complete": now_et.hour >= ASIA_END_HOUR,
        "high_swept": current_price > asia_high,
        "low_swept": current_price < asia_low,
        "label": "ASIA HIGH" if current_price > asia_high else ("ASIA LOW" if current_price < asia_low else "INSIDE ASIA RANGE"),
    }


# ── Fair Value Gaps ───────────────────────────────────────────────────────────

def detect_fvgs(candles: List[Dict[str, Any]], max_age: int = FVG_MAX_AGE_CANDLES) -> List[Dict[str, Any]]:
    """3-candle imbalances. Bullish when c1.high < c3.low, bearish when c1.low > c3.high."""
    gaps: List[Dict[str, Any]] = []
    n = len(candles)
    for i in range(2, n):
        c1, c3 = candles[i - 2], candles[i]
        if c1["high"] < c3["low"]:
            gaps.append({
                "direction": "BULLISH",
                "bottom": round(c1["high"], 2),
                "top": round(c3["low"], 2),
                "formed_at": c1["time"],
                "age": n - 1 - i,
            })
        elif c1["low"] > c3["high"]:
            gaps.append({
                "direction": "BEARISH",
                "bottom": round(c3["high"], 2),
                "top": round(c1["low"], 2),
                "formed_at": c1["time"],
                "age": n - 1 - i,
            })
    return [g for g in gaps if g["age"] <= max_age]


def detect_ifvgs(candles: List[Dict[str, Any]], gaps: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """A gap inverts once a candle *body* closes through its far boundary.

    Bearish gap (zone [c3.high, c1.low]) turns bullish when a close prints above
    the top boundary. Bullish gap turns bearish when a close prints below the
    bottom boundary.
    """
    inversions: List[Dict[str, Any]] = []
    if not candles:
        return inversions
    latest = candles[-1]
    n = len(candles)

    for gap in gaps:
        # Only gaps that existed before the most recent candle can invert.
        idx = None
        for j in range(n - 1, 1, -1):
            if candles[j - 2]["time"] == gap["formed_at"]:
                idx = j
                break
        if idx is None or idx >= n - 1:
            continue

        if gap["direction"] == "BEARISH" and latest["close"] > gap["top"]:
            inversions.append({
                "signal": "VALID_IFVG_LONG",
                "direction": "LONG",
                "zone_bottom": gap["bottom"],
                "zone_top": gap["top"],
                "formed_at": gap["formed_at"],
                "inverted_at": latest["time"],
            })
        elif gap["direction"] == "BULLISH" and latest["close"] < gap["bottom"]:
            inversions.append({
                "signal": "VALID_IFVG_SHORT",
                "direction": "SHORT",
                "zone_bottom": gap["bottom"],
                "zone_top": gap["top"],
                "formed_at": gap["formed_at"],
                "inverted_at": latest["time"],
            })
    return inversions


# ── Liquidity & displacement ──────────────────────────────────────────────────

def detect_equal_levels(candles: List[Dict[str, Any]], tolerance: float = 0.0005,
                        lookback: int = 120) -> List[Dict[str, Any]]:
    """Relative equal highs / lows (LRLR) that act as liquidity pools."""
    window = candles[-lookback:]
    if len(window) < 20:
        return []

    highs = sorted({round(c["high"], 5) for c in window})
    lows = sorted({round(c["low"], 5) for c in window})

    def cluster(values: List[float]) -> List[float]:
        groups: List[List[float]] = []
        for v in values:
            if groups and abs(v - groups[-1][-1]) / max(groups[-1][-1], 1e-9) <= tolerance:
                groups[-1].append(v)
            else:
                groups.append([v])
        return [sum(g) / len(g) for g in groups if len(g) >= 2]

    levels = []
    for lvl in cluster(highs):
        levels.append({"price": round(lvl, 2), "type": "EQUAL_HIGHS", "side": "BUY_SIDE"})
    for lvl in cluster(lows):
        levels.append({"price": round(lvl, 2), "type": "EQUAL_LOWS", "side": "SELL_SIDE"})
    return levels


def detect_displacement(candles: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Body ratio plus volume expansion on the most recent candles."""
    if len(candles) < VOLUME_LOOKBACK + 2:
        return {"confirmed": False, "body_ratio": 0.0, "volume_ratio": 0.0, "direction": "NONE"}

    recent = candles[-1]
    rng = recent["high"] - recent["low"]
    body_ratio = abs(recent["close"] - recent["open"]) / rng if rng > 0 else 0.0

    vols = [c["volume"] for c in candles[-(VOLUME_LOOKBACK + 1):-1]]
    avg_vol = sum(vols) / len(vols) if vols else 0.0
    volume_ratio = (recent["volume"] / avg_vol) if avg_vol > 0 else 1.0

    direction = "NONE"
    if recent["close"] > recent["open"]:
        direction = "BULLISH"
    elif recent["close"] < recent["open"]:
        direction = "BEARISH"

    confirmed = body_ratio >= DISPLACEMENT_BODY_RATIO and volume_ratio >= 1.0

    return {
        "confirmed": bool(confirmed),
        "body_ratio": round(body_ratio, 3),
        "volume_ratio": round(volume_ratio, 3),
        "direction": direction,
        "threshold": DISPLACEMENT_BODY_RATIO,
    }


def detect_sweep(candles: List[Dict[str, Any]], levels: List[Dict[str, Any]],
                 lookback: int = 5) -> Optional[Dict[str, Any]]:
    """Most recent candle that wicked through a pool then closed back inside."""
    if not candles or not levels:
        return None

    for offset in range(0, min(lookback, len(candles))):
        idx = len(candles) - 1 - offset
        candle = candles[idx]
        for level in levels:
            price = level["price"]
            # Sweep of buy-side liquidity: wick above, close back below.
            if candle["high"] > price and candle["close"] < price:
                return {
                    "level": price,
                    "type": level["type"],
                    "side": "BUY_SIDE",
                    "expected_direction": "SHORT",
                    "swept_at": candle["time"],
                    "candles_ago": offset,
                    "wick_points": round(candle["high"] - price, 2),
                }
            # Sweep of sell-side liquidity: wick below, close back above.
            if candle["low"] < price and candle["close"] > price:
                return {
                    "level": price,
                    "type": level["type"],
                    "side": "SELL_SIDE",
                    "expected_direction": "LONG",
                    "swept_at": candle["time"],
                    "candles_ago": offset,
                    "wick_points": round(price - candle["low"], 2),
                }
    return None


def find_order_block(candles: List[Dict[str, Any]], direction: str,
                     lookback: int = 15) -> Optional[Dict[str, Any]]:
    """Last opposing candle before the displacement leg."""
    window = candles[-lookback:]
    for i in range(len(window) - 2, -1, -1):
        c = window[i]
        if direction == "LONG" and c["close"] < c["open"]:
            return {"time": c["time"], "top": round(c["high"], 2), "bottom": round(c["low"], 2)}
        if direction == "SHORT" and c["close"] > c["open"]:
            return {"time": c["time"], "top": round(c["high"], 2), "bottom": round(c["low"], 2)}
    return None


# ── HTF bias ──────────────────────────────────────────────────────────────────

def higher_timeframe_bias(daily: List[Dict[str, Any]], hourly: List[Dict[str, Any]],
                          current_price: float) -> Dict[str, Any]:
    """Bias from Daily/1H fair value gaps and previous-day liquidity."""
    daily_gaps = detect_fvgs(daily, max_age=30) if daily else []
    hourly_gaps = detect_fvgs(hourly, max_age=40) if hourly else []

    bias = "NEUTRAL"
    if daily:
        closes = [c["close"] for c in daily]
        sma = sum(closes[-20:]) / len(closes[-20:]) if closes else 0.0
        if current_price > sma and daily[-1]["close"] > daily[-1]["open"]:
            bias = "BULLISH"
        elif current_price < sma and daily[-1]["close"] < daily[-1]["open"]:
            bias = "BEARISH"

    prev_day = daily[-2] if len(daily) >= 2 else None

    return {
        "bias": bias,
        "daily_gap": daily_gaps[-1] if daily_gaps else None,
        "hourly_gap": hourly_gaps[-1] if hourly_gaps else None,
        "previous_day_high": round(prev_day["high"], 2) if prev_day else None,
        "previous_day_low": round(prev_day["low"], 2) if prev_day else None,
    }


# ── Session trap filter: Asia range extension ─────────────────────────────────

def asia_trend(asia: Optional[Dict[str, Any]], asia_candles: List[Dict[str, Any]],
               atr: float) -> Dict[str, Any]:
    """Classify Asia's directional character.

    A range is only "trending" if the session both travelled a meaningful share
    of its own range and finished pressed against the boundary it moved toward.
    Without the travel test a session that drifted sideways into the high would
    be misread as a bullish trap.
    """
    if not asia or not asia_candles:
        return {
            "asia_trend": "NEUTRAL", "close_position": None, "move_fraction": 0.0,
            "closes_near_high": False, "closes_near_low": False, "midpoint_shift": 0.0,
        }

    rng = asia["high"] - asia["low"]
    if rng <= 0 or atr <= 0:
        return {
            "asia_trend": "NEUTRAL", "close_position": None, "move_fraction": 0.0,
            "closes_near_high": False, "closes_near_low": False, "midpoint_shift": 0.0,
        }

    asia_close = asia_candles[-1]["close"]
    first_close = asia_candles[0]["open"]

    # Where in its own range Asia closed, as a fraction from the low.
    close_position = (asia_close - asia["low"]) / rng
    # Share of the range covered in the direction of the net move.
    move_fraction = abs(asia_close - first_close) / rng

    closes_near_high = close_position >= (1.0 - ASIA_TRAP_CLOSE_THRESHOLD)
    closes_near_low = close_position <= ASIA_TRAP_CLOSE_THRESHOLD

    strong = move_fraction >= ASIA_TREND_MIN_MOVE
    if closes_near_high and strong and asia_close > first_close:
        trend = "BULLISH"
    elif closes_near_low and strong and asia_close < first_close:
        trend = "BEARISH"
    else:
        trend = "NEUTRAL"

    return {
        "asia_trend": trend,
        "close_position": round(close_position, 3),
        "move_fraction": round(move_fraction, 3),
        "closes_near_high": bool(closes_near_high),
        "closes_near_low": bool(closes_near_low),
        "midpoint_shift": round((asia_close - asia["midpoint"]) / atr, 3),
    }


def asia_trap_filter(trend: Dict[str, Any]) -> Dict[str, Any]:
    """Flag the London-open pump/dump traps and the direction they inhibit.

    An extended Asia that closes on its high traps the breakout longs. The
    engine must not fade that move at the London open on the strength of Asia's
    direction alone -- the counter-trend side stays inhibited until the raid and
    the market structure shift actually confirm it.
    """
    pump = trend["asia_trend"] == "BULLISH" and trend["closes_near_high"]
    dump = trend["asia_trend"] == "BEARISH" and trend["closes_near_low"]

    if pump:
        bias, inhibited = "SHORT", "SHORT"
    elif dump:
        bias, inhibited = "LONG", "LONG"
    else:
        bias, inhibited = None, None

    if pump:
        note = ("Asia extended up into its high — buy-side breakout is trapped. "
                "No SHORT until London raids ASIA HIGH and confirms MSS.")
    elif dump:
        note = ("Asia extended down into its low — sell-side breakout is trapped. "
                "No LONG until London raids ASIA LOW and confirms MSS.")
    else:
        note = "No Asia extension trap. Standard sweep + MSS execution applies."

    return {
        "london_early_pump_trap": bool(pump),
        "london_early_dump_trap": bool(dump),
        "trap_bias": bias,
        "inhibited_direction": inhibited,
        "trap_active": bool(pump or dump),
        "note": note,
    }


# ── London raid + market structure shift ──────────────────────────────────────

def london_window_candles(candles: List[Dict[str, Any]], now_et: dt.datetime) -> List[Dict[str, Any]]:
    """Candles inside today's London session (02:00 - 05:00 ET)."""
    start_ts = int(now_et.replace(hour=LONDON_KZ[0], minute=0, second=0, microsecond=0).timestamp())
    end_ts = int(now_et.replace(hour=LONDON_KZ[1], minute=0, second=0, microsecond=0).timestamp())
    return [c for c in candles if start_ts <= c["time"] < end_ts]


def detect_asia_raid(candles: List[Dict[str, Any]], asia: Optional[Dict[str, Any]],
                     bias: Optional[str], max_age: int = 90) -> Optional[Dict[str, Any]]:
    """London sweeping the Asia boundary that the trap expects to be raided.

    The raid is deliberately asymmetric: it must *wick* through the Asia
    boundary and close back inside it, which is what distinguishes a liquidity
    raid from a genuine breakout.
    """
    if not asia or bias not in ("LONG", "SHORT"):
        return None

    n = len(candles)
    for offset in range(0, min(max_age, n)):
        idx = n - 1 - offset
        c = candles[idx]
        if bias == "SHORT":
            # Raid buy-side: wick above ASIA HIGH, close back below it.
            if c["high"] > asia["high"] and c["close"] < asia["high"]:
                return {
                    "level": asia["high"], "side": "BUY_SIDE", "raid_direction": "SHORT",
                    "raid_index": idx, "swept_at": c["time"], "candles_ago": offset,
                    "wick_points": round(c["high"] - asia["high"], 2),
                    "reclaim_distance": round(asia["high"] - c["close"], 2),
                }
        else:
            # Raid sell-side: wick below ASIA LOW, close back above it.
            if c["low"] < asia["low"] and c["close"] > asia["low"]:
                return {
                    "level": asia["low"], "side": "SELL_SIDE", "raid_direction": "LONG",
                    "raid_index": idx, "swept_at": c["time"], "candles_ago": offset,
                    "wick_points": round(asia["low"] - c["low"], 2),
                    "reclaim_distance": round(c["close"] - asia["low"], 2),
                }
    return None


def detect_mss(candles: List[Dict[str, Any]], raid: Optional[Dict[str, Any]],
               direction: str) -> Dict[str, Any]:
    """Market structure shift after the raid: a close beyond the nearest swing.

    For a short the nearest swing is the lowest low printed after the raid; the
    MSS is the first close beneath it. Using the post-raid extreme rather than a
    fractal swing avoids needing a right-side confirmation bar that would arrive
    too late to be tradeable.
    """
    pending = {
        "confirmed": False, "direction": direction, "broken_level": None,
        "broken_at": None, "candles_since_raid": None, "reason": "No raid confirmed yet.",
    }
    if not raid or direction not in ("LONG", "SHORT"):
        return pending

    start = raid["raid_index"] + 1
    if start >= len(candles):
        return {**pending, "reason": "Raid just printed — watching for the structure break."}

    extreme: Optional[float] = None
    for i in range(start, len(candles)):
        c = candles[i]
        if extreme is None:
            extreme = c["low"] if direction == "SHORT" else c["high"]
            continue
        if direction == "SHORT" and c["close"] < extreme:
            return {
                "confirmed": True, "direction": direction, "broken_level": round(extreme, 2),
                "broken_at": c["time"], "candles_since_raid": i - start,
                "reason": "Close below the post-raid low confirms the MSS.",
            }
        if direction == "LONG" and c["close"] > extreme:
            return {
                "confirmed": True, "direction": direction, "broken_level": round(extreme, 2),
                "broken_at": c["time"], "candles_since_raid": i - start,
                "reason": "Close above the post-raid high confirms the MSS.",
            }
        if direction == "SHORT":
            extreme = min(extreme, c["low"])
        else:
            extreme = max(extreme, c["high"])

    return {
        **pending,
        "broken_level": round(extreme, 2) if extreme is not None else None,
        "reason": "Raid in place, structure not yet broken.",
    }


def london_displacement_zone(candles: List[Dict[str, Any]], raid: Optional[Dict[str, Any]],
                             direction: str) -> Optional[Dict[str, Any]]:
    """FVG / IFVG created by the displacement leg that broke structure."""
    if not raid:
        return None
    start = raid["raid_index"] + 1
    leg = candles[start:]
    if len(leg) < 3:
        return None

    gaps = detect_fvgs(leg)
    for gap in reversed(gaps):
        if gap["direction"] == ("BULLISH" if direction == "LONG" else "BEARISH"):
            return {
                "kind": "FVG", "zone_bottom": gap["bottom"], "zone_top": gap["top"],
                "formed_at": leg[max(0, 0)]["time"], "direction": direction,
            }

    inv = detect_ifvgs(leg, gaps)
    for iv in reversed(inv):
        if iv["direction"] == direction:
            return {
                "kind": "IFVG", "zone_bottom": iv["zone_bottom"], "zone_top": iv["zone_top"],
                "formed_at": leg[0]["time"], "direction": direction,
            }
    return None


# ── New York dual-scenario engine ─────────────────────────────────────────────

def london_expansion(london: List[Dict[str, Any]], atr: float) -> Dict[str, Any]:
    """Was London a clean, strong expansion move?"""
    if len(london) < 5 or atr <= 0:
        return {"valid": False, "range_points": 0.0, "atr_multiple": 0.0, "direction": "NONE"}

    high = max(c["high"] for c in london)
    low = min(c["low"] for c in london)
    span = high - low
    open_ = london[0]["open"]
    close_ = london[-1]["close"]

    if close_ > open_:
        direction = "BULLISH"
    elif close_ < open_:
        direction = "BEARISH"
    else:
        direction = "NEUTRAL"

    atr_multiple = span / atr
    return {
        "valid": bool(direction != "NEUTRAL" and atr_multiple >= LONDON_EXPANSION_ATR_MULT),
        "range_points": round(span, 2),
        "atr_multiple": round(atr_multiple, 3),
        "direction": direction,
        "open": round(open_, 2),
        "close": round(close_, 2),
        "high": round(high, 2),
        "low": round(low, 2),
        "midpoint": round((high + low) / 2, 2),
    }


def midnight_open_price(candles: List[Dict[str, Any]], now_et: dt.datetime) -> Optional[float]:
    """Price of the 00:00 ET open for the current New York day."""
    midnight = now_et.replace(hour=MIDNIGHT_OPEN_HOUR, minute=0, second=0, microsecond=0)
    start_ts = int(midnight.timestamp())
    end_ts = start_ts + 3600
    for c in candles:
        if start_ts <= c["time"] < end_ts:
            return round(c["open"], 2)
    return None


def htf_draw_on_liquidity(daily: List[Dict[str, Any]], london: List[Dict[str, Any]],
                          current_price: float) -> Dict[str, Any]:
    """Has the London move already reached or swept its higher-timeframe DOL?

    An unreached previous-day high/low is the continuation scenario's target.
    Once London has taken it, the same move becomes the reversal scenario's
    completed objective.
    """
    if len(daily) < 2 or not london:
        return {"available": False, "pdh": None, "pdl": None, "pdh_reached": False,
                "pdl_reached": False, "swept": False, "unreached_target": None}

    prev = daily[-2]
    pdh, pdl = round(prev["high"], 2), round(prev["low"], 2)
    london_high = max(c["high"] for c in london)
    london_low = min(c["low"] for c in london)

    pdh_reached = london_high >= pdh
    pdl_reached = london_low <= pdl
    swept = london_high > pdh or london_low < pdl

    if pdh_reached or swept:
        unreached = None
    elif current_price < pdh:
        unreached = pdh
    else:
        unreached = pdl

    return {
        "available": True,
        "pdh": pdh,
        "pdl": pdl,
        "pdh_reached": bool(pdh_reached),
        "pdl_reached": bool(pdl_reached),
        "swept": bool(swept),
        "unreached_target": unreached,
    }


def ny_scenario(dol: Dict[str, Any], expansion: Dict[str, Any],
                sub_window: Optional[str]) -> Dict[str, Any]:
    """Pick Scenario 1 (continuation) or Scenario 2 (reversal)."""
    if sub_window == "CONTINUATION":
        active = "SCENARIO_1"
        conditions = {
            "london_expansion": expansion.get("valid", False),
            "htf_dol_unreached": bool(dol.get("unreached_target") is not None),
        }
        ok = all(conditions.values())
        return {
            "scenario": active, "eligible": ok, "conditions": conditions,
            "unreached_htf_target": dol.get("unreached_target"),
            "london_direction": expansion.get("direction"),
            "note": ("London expanded and its HTF draw on liquidity is still open — "
                     "buy the NY retrace into a London FVG/OB, target the unreached PDH/PDL."
                     if ok else
                     "Continuation scenario not armed: London expansion and an unreached "
                     "HTF DOL are both required."),
        }

    if sub_window == "REVERSAL":
        active = "SCENARIO_2"
        conditions = {
            "london_reached_htf_dol": bool(dol.get("pdh_reached") or dol.get("pdl_reached")
                                           or dol.get("swept")),
        }
        ok = all(conditions.values())
        return {
            "scenario": active, "eligible": ok, "conditions": conditions,
            "unreached_htf_target": None,
            "london_direction": expansion.get("direction"),
            "note": ("London already reached its HTF draw on liquidity — fade the London Close / "
                     "NY midday exhaustion toward internal London liquidity or the midnight open."
                     if ok else
                     "Reversal scenario not armed: London has not yet reached its HTF DOL."),
        }

    return {
        "scenario": None, "eligible": False, "conditions": {},
        "unreached_htf_target": None, "london_direction": expansion.get("direction"),
        "note": "Outside the New York evaluation windows.",
    }


# ── Signal assembly ───────────────────────────────────────────────────────────

def _build_signal(
    direction: str,
    entry: float,
    structural_stop: float,
    atr: float,
    killzone: Optional[str],
    target_override: Optional[float] = None,
    scenario: Optional[str] = None,
    trap: Optional[Dict[str, Any]] = None,
    trap_released: bool = False,
) -> Dict[str, Any]:
    """Entry / stop / target with the session point cap and 1:2 minimum R:R.

    `target_override` carries the scenario's structural target (the unreached
    HTF draw on liquidity for a continuation, or internal London liquidity /
    the midnight open for a reversal). It still has to clear the same minimum
    R:R and stop-distance cap as an ATR-derived target, so a scenario can never
    buy its way past the risk rules.
    """
    scale = (atr / REFERENCE_ATR_POINTS) if atr > 0 else 1.0
    ref_points = LONDON_MAX_REF_POINTS if killzone == "LONDON" else NY_MAX_REF_POINTS
    max_points = ref_points * scale

    is_long = direction == "LONG"
    stop_distance = abs(entry - structural_stop)
    status = "ENTRY_READY"
    reasons: List[str] = []

    if stop_distance <= 0 or stop_distance > max_points:
        status = "ENTRY_CANCELLED"
        reasons.append(
            f"Structural stop {stop_distance:.2f} exceeds the {killzone or 'session'} "
            f"limit of {max_points:.2f} points."
        )

    if target_override is not None:
        target = target_override
        reward = abs(target - entry)
        rr = (reward / stop_distance) if stop_distance > 0 else 0.0
        if stop_distance > 0 and rr < MIN_RR:
            status = "ENTRY_CANCELLED"
            reasons.append(
                f"Scenario target offers only {rr:.2f}R against the required {MIN_RR:.2f}R."
            )
    elif is_long:
        target = entry + stop_distance * MIN_RR
    else:
        target = entry - stop_distance * MIN_RR

    reward_points = abs(target - entry)
    rr = (reward_points / stop_distance) if stop_distance > 0 else 0.0

# The Asia trap filter overrides everything downstream, but only until the
    # raid and the MSS have completed: the brief inhibits the counter-trend side
    # "until the explicit Liquidity Raid & Shift sequence completes". Once that
    # sequence is confirmed the very trade it anticipated becomes permitted.
    trap_blocked = False
    if (trap and trap.get("trap_active") and not trap_released
            and direction == trap.get("inhibited_direction")):
        status = "INHIBITED_TRAP"
        trap_blocked = True
        reasons.append(trap.get("note") or "Blocked by the Asia trap filter.")
    elif trap and trap.get("trap_active") and trap_released \
            and direction == trap.get("inhibited_direction"):
        reasons.append("Asia trap released: raid and MSS confirmed.")

    return {
        "status": status,
        "direction": direction,
        "scenario": scenario,
        "entry": round(entry, 2),
        "stop_loss": round(structural_stop, 2),
        "take_profit": round(target, 2),
        "risk_points": round(stop_distance, 2),
        "reward_points": round(reward_points, 2),
        "risk_reward": round(rr, 2),
        "min_rr": MIN_RR,
        "max_stop_points": round(max_points, 2),
        "max_stop_reference_points": ref_points,
        "target_source": "SCENARIO_TARGET" if target_override is not None else "ATR_MULTIPLE",
        "trap_blocked": trap_blocked,
        "cancelled_reasons": reasons,
    }


def analyze_ict(
    symbol: str,
    timeframe: str = "1m",
    candles_1m: Optional[List[Dict[str, Any]]] = None,
    daily: Optional[List[Dict[str, Any]]] = None,
    now_et: Optional[dt.datetime] = None,
    data_source: str = "unknown",
) -> Dict[str, Any]:
    """Run the full strategy and return the session, signal and level state."""
    now_et = now_et or dt.datetime.now(ET)
    # Analyse only completed bars -- a still-forming candle has no reliable
    # range or volume and would poison displacement/FVG detection.
    candles_1m = drop_forming_candle(candles_1m or [])
    daily = daily or []

    session = classify_session(now_et)
    upcoming = next_killzone(now_et)
    anchors = session_anchors(now_et)
    windows = session_windows(now_et)

    if len(candles_1m) < 30:
        return {
            "status": "insufficient_data",
            "symbol": symbol,
            "timeframe": timeframe,
            "data_source": data_source,
            "session": session,
            "next_killzone": upcoming,
            "windows": windows,
            "anchors": anchors,
            "message": "Not enough 1-minute history to evaluate the setup.",
        }

    current_price = candles_1m[-1]["close"]
    hourly = _resample(candles_1m, 3600)
    atr = _true_range(candles_1m)

    htf = higher_timeframe_bias(daily, hourly, current_price)
    asia = asia_range(candles_1m, now_et)
    asia_candles = asia_session_candles(candles_1m, now_et)
    levels = detect_equal_levels(candles_1m)
    gaps = detect_fvgs(candles_1m)
    inversions = detect_ifvgs(candles_1m, gaps)
    displacement = detect_displacement(candles_1m)
    sweep = detect_sweep(candles_1m, levels)

    # ── Asia trap filter ────────────────────────────────────────────────────
    trend = asia_trend(asia, asia_candles, atr)
    trap = asia_trap_filter(trend)

    # ── London raid -> MSS -> displacement FVG/IFVG ─────────────────────────
    # A raid can be engineered regardless of the trap, so both sides are
    # checked and the most recent one wins.
    raid = None
    for bias in ("SHORT", "LONG"):
        candidate = detect_asia_raid(candles_1m, asia, bias)
        if candidate and (raid is None or candidate["candles_ago"] < raid["candles_ago"]):
            raid = candidate

    mss = detect_mss(candles_1m, raid, raid["raid_direction"]) if raid else {
        "confirmed": False, "direction": raid["raid_direction"] if raid else None,
        "broken_level": None, "broken_at": None, "candles_since_raid": None,
        "reason": "No raid confirmed yet.",
    }

    disp_zone = london_displacement_zone(candles_1m, raid, raid["raid_direction"]) \
        if (raid and mss["confirmed"]) else None

    # The trap filter is released only once the raid AND the shift have both
    # printed; that is the moment the anticipated trade becomes permitted.
    sequence_complete = bool(raid and mss["confirmed"])
    trap["released"] = sequence_complete
    trap["sequence_complete"] = sequence_complete

    # ── New York dual-scenario engine ───────────────────────────────────────
    london_candles = london_window_candles(candles_1m, now_et)
    expansion = london_expansion(london_candles, atr)
    dol = htf_draw_on_liquidity(daily, london_candles, current_price)
    scenario = ny_scenario(dol, expansion, session["sub_window"])
    midnight_price = midnight_open_price(candles_1m, now_et)

    # ── Hard gate: no trades outside a killzone ─────────────────────────────
    if not session["in_killzone"]:
        signal = {
            "status": "WAIT",
            "direction": "NONE",
            "reason": session["guidance"],
        }
        state = "IDLE"

    elif session["name"] == "LONDON":
        # London is a strictly sequential model: raid, then MSS, then the
        # displacement gap, then the retest. Each unmet step blocks the trade.
        if not raid:
            signal = {
                "status": "WAIT", "direction": "NONE",
                "reason": "Raid pending — waiting for London to sweep the Asia boundary "
                          "and close back inside it.",
            }
            state = "WAIT_FOR_RAID"
        elif not mss["confirmed"]:
            signal = {
                "status": "WAIT", "direction": "NONE",
                "reason": f"Raid of {'ASIA HIGH' if raid['side'] == 'BUY_SIDE' else 'ASIA LOW'} "
                          f"in place. {mss['reason']}",
            }
            state = "MSS_PENDING"
        elif not disp_zone:
            signal = {
                "status": "WAIT", "direction": "NONE",
                "reason": "MSS confirmed — waiting for the displacement leg to leave an FVG/IFVG.",
            }
            state = "MSS_PENDING"
        else:
            direction = raid["raid_direction"]
            in_zone = disp_zone["zone_bottom"] <= current_price <= disp_zone["zone_top"]

            if not in_zone:
                signal = {
                    "status": "WAIT", "direction": "NONE",
                    "reason": f"Price left the {disp_zone['kind']} "
                              f"({disp_zone['zone_bottom']} - {disp_zone['zone_top']}). "
                              "Waiting for the retest entry.",
                }
                state = "IFVG_TRIGGER"
            else:
                # Stop goes strictly beyond the displacement swing: the raid
                # extreme for a short, the raid low for a long.
                if direction == "SHORT":
                    structural_stop = max(
                        c["high"] for c in candles_1m[raid["raid_index"]:]) + 0.1
                else:
                    structural_stop = min(
                        c["low"] for c in candles_1m[raid["raid_index"]:]) - 0.1

                signal = _build_signal(direction, current_price, structural_stop, atr,
                                       session["killzone"], trap=trap,
                                       trap_released=sequence_complete)
                signal["displacement_zone"] = disp_zone
                signal["raid"] = raid
                signal["mss"] = mss
                signal["stop_basis"] = "DISPLACEMENT_SWING"
                signal["confluence"] = {
                    "htf_daily_fvg": htf["daily_gap"] is not None,
                    "htf_1h_fvg": htf["hourly_gap"] is not None,
                    "liquidity_sweep": True,
                    "displacement": True,
                    "ifvg_trigger": True,
                }
                score = sum(1 for v in signal["confluence"].values() if v)
                signal["confluence_score"] = score
                signal["grade"] = "A+" if score == len(CONFLUENCE_FACTORS) else ("B" if score >= 3 else "C")
                signal["position_size"] = "INCREASED" if score == len(CONFLUENCE_FACTORS) else "STANDARD"
                signal["htf_aligned"] = (
                    (direction == "LONG" and htf["bias"] != "BEARISH")
                    or (direction == "SHORT" and htf["bias"] != "BULLISH")
                )
                state = "IFVG_TRIGGER"

    else:  # NEW YORK
        # Scenario selection is driven entirely by the HTF draw-on-liquidity
        # state at the NY open, which fixes both the direction and the target.
        if scenario["scenario"] == "SCENARIO_1":
            state = "NY_CONTINUATION_EVAL"
        else:
            state = "NY_REVERSAL_EVAL"

        direction = None
        if inversions:
            direction = inversions[-1]["direction"]
        elif sweep:
            direction = sweep["expected_direction"]

        if scenario["scenario"] == "SCENARIO_1" and direction:
            # Continuation must agree with the London trend.
            if expansion["direction"] != "NONE" and direction != expansion["direction"]:
                direction = None

        if scenario["scenario"] == "SCENARIO_2" and direction:
            # Reversal must oppose the London trend.
            if expansion["direction"] != "NONE" and direction == expansion["direction"]:
                direction = None

        target_override = None
        if direction:
            if scenario["scenario"] == "SCENARIO_1":
                target_override = dol.get("unreached_target")
            elif scenario["scenario"] == "SCENARIO_2":
                # Internal London liquidity, falling back to the midnight open.
                if direction == "SHORT":
                    internal = expansion.get("midpoint") if london_candles else None
                    target_override = internal if internal else midnight_price
                else:
                    internal = expansion.get("midpoint") if london_candles else None
                    target_override = midnight_price if midnight_price else internal

        if not scenario["eligible"]:
            signal = {
                "status": "WAIT", "direction": "NONE",
                "reason": scenario["note"],
            }
        elif not direction:
            signal = {
                "status": "WAIT", "direction": "NONE",
                "reason": "Scenario armed — waiting on a micro-structure shift in the "
                          "1m/5m against the target liquidity.",
            }
        else:
            order_block = find_order_block(candles_1m, direction)
            if order_block:
                structural_stop = order_block["bottom"] if direction == "LONG" else order_block["top"]
            else:
                structural_stop = (
                    min(c["low"] for c in candles_1m[-10:]) if direction == "LONG"
                    else max(c["high"] for c in candles_1m[-10:])
                )

            signal = _build_signal(direction, current_price, structural_stop, atr,
                                   session["killzone"],
                                   target_override=target_override,
                                   scenario=scenario["scenario"],
                                   trap=trap,
                                   trap_released=sequence_complete)
            signal["order_block"] = order_block
            signal["confluence"] = {
                "htf_daily_fvg": htf["daily_gap"] is not None,
                "htf_1h_fvg": htf["hourly_gap"] is not None,
                "liquidity_sweep": sweep is not None,
                "displacement": displacement["confirmed"],
                "ifvg_trigger": bool(inversions),
            }
            score = sum(1 for v in signal["confluence"].values() if v)
            signal["confluence_score"] = score
            signal["grade"] = "A+" if score == len(CONFLUENCE_FACTORS) else ("B" if score >= 3 else "C")
            signal["position_size"] = "INCREASED" if score == len(CONFLUENCE_FACTORS) else "STANDARD"
            signal["htf_aligned"] = (
                (direction == "LONG" and htf["bias"] != "BEARISH")
                or (direction == "SHORT" and htf["bias"] != "BULLISH")
            )

    return {
        "status": "success",
        "symbol": symbol,
        "timeframe": timeframe,
        "data_source": data_source,
        "generated_at_et": now_et.strftime("%Y-%m-%d %H:%M:%S %Z"),
        "session": session,
        "next_killzone": upcoming,
        "windows": windows,
        "anchors": anchors,
        "current_price": round(current_price, 2),
        "atr": round(atr, 2),
        "asia_range": asia,
        "asia_trend": trend,
        "trap_filter": trap,
        "raid": raid,
        "mss": mss,
        "displacement_zone": disp_zone,
        "london_expansion": expansion,
        "htf_dol": dol,
        "ny_scenario": scenario,
        "midnight_open_price": midnight_price,
        "liquidity_levels": levels[-12:],
        "fair_value_gaps": gaps[-8:],
        "ifvgs": inversions,
        "displacement": displacement,
        "sweep": sweep,
        "htf": htf,
        "state_machine_state": state,
        "signal": signal,
    }