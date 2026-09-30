"""
Candace ICT Scalping Engine
==========================

Implements the AMD (Accumulation / Manipulation / Distribution) session
framework with liquidity-sweep, displacement and Fair Value Gap logic.

Rules implemented (from the strategy brief):
  * Killzone gating  - London 02:00-05:00 ET, New York 09:00-10:00 ET.
                       No trades are permitted outside a killzone.
  * Higher-timeframe bias from Daily / 1-Hour Fair Value Gaps and liquidity
    (previous day high/low, midnight open).
  * Liquidity sweep  - price wicks beyond a pool to take stops, then fails to
                       hold (wick through, close back inside).
  * Displacement     - candle body > 75% of range with volume above the 20
                       period average, breaking structure.
  * FVG / IFVG       - 3-candle imbalance, inverted once a candle *body*
                       closes through the far boundary.
  * Risk             - hard stop behind the order block, capped by a session
                       points limit; minimum 1:2 R:R; setups whose structural
                       stop exceeds the cap are cancelled.

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
NY_KZ = (9, 10)               # 09:00 - 10:00 ET
MIDNIGHT_OPEN_HOUR = 0        # 12:00 AM ET daily open
RTH_OPEN_HOUR = 9             # 09:30 ET regular-trading-hours open (futures)

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
    elif name == "NEW YORK" and hour < NY_KZ[0] + 0.5:
        phase = "MANIPULATION"
    elif name == "NEW YORK":
        phase = "DISTRIBUTION"
    else:
        phase = "NEUTRAL"

    if name in ("LONDON", "NEW YORK"):
        guidance = f"{name} KILLZONE ACTIVE — look for liquidity sweeps, then displacement + IFVG."
    elif name == "ASIA":
        guidance = "ASIA ACCUMULATION — do not trade. Mark the Asia range; wait for the London sweep."
    else:
        guidance = "OUTSIDE KILLZONES — stand aside and wait for London or New York."

    return {
        "name": name,
        "phase": phase,
        "killzone": killzone,
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
        ("LONDON", "Manipulation/Distribution", midnight.replace(hour=LONDON_KZ[0]), midnight.replace(hour=LONDON_KZ[1]), True),
        ("NEW_YORK", "Manipulation/Distribution", midnight.replace(hour=NY_KZ[0]), midnight.replace(hour=NY_KZ[1]), True),
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

def asia_range(candles: List[Dict[str, Any]], now_et: dt.datetime) -> Optional[Dict[str, Any]]:
    """High/low of the current Asia session (19:00 ET -> 02:00 ET)."""
    if not candles:
        return None

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

    window = [c for c in candles if start_ts <= c["time"] < end_ts]
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


# ── Signal assembly ───────────────────────────────────────────────────────────

def _build_signal(
    direction: str,
    entry: float,
    structural_stop: float,
    atr: float,
    killzone: Optional[str],
) -> Dict[str, Any]:
    """Entry / stop / target with the session point cap and 1:2 minimum R:R."""
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

    if is_long:
        target = entry + stop_distance * MIN_RR
    else:
        target = entry - stop_distance * MIN_RR

    rr = (abs(target - entry) / stop_distance) if stop_distance > 0 else 0.0

    return {
        "status": status,
        "direction": direction,
        "entry": round(entry, 2),
        "stop_loss": round(structural_stop, 2),
        "take_profit": round(target, 2),
        "risk_points": round(stop_distance, 2),
        "reward_points": round(abs(target - entry), 2),
        "risk_reward": round(rr, 2),
        "min_rr": MIN_RR,
        "max_stop_points": round(max_points, 2),
        "max_stop_reference_points": ref_points,
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
    levels = detect_equal_levels(candles_1m)
    gaps = detect_fvgs(candles_1m)
    inversions = detect_ifvgs(candles_1m, gaps)
    displacement = detect_displacement(candles_1m)
    sweep = detect_sweep(candles_1m, levels)

    # ── Hard gate: no trades outside a killzone ─────────────────────────────
    if not session["in_killzone"]:
        signal = {
            "status": "WAIT",
            "direction": "NONE",
            "reason": session["guidance"],
        }
        state = "IDLE"
    else:
        direction = None

        if sweep:
            direction = sweep["expected_direction"]
        elif inversions:
            direction = inversions[-1]["direction"]

        if not direction:
            signal = {
                "status": "WAIT",
                "direction": "NONE",
                "reason": "Waiting on a liquidity sweep or an IFVG inversion.",
            }
            state = "SWEEP_DETECTED" if sweep else "IDLE"
        else:
            # Sweep and IFVG must agree; a conflict is treated as no trade.
            if sweep and inversions and sweep["expected_direction"] != inversions[-1]["direction"]:
                signal = {
                    "status": "WAIT",
                    "direction": "NONE",
                    "reason": "Liquidity sweep and IFVG point in opposite directions — standing aside.",
                }
                state = "SWEEP_DETECTED"
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
                                       session["killzone"])

                # Confluence score across the five strategy factors.
                confluence = {
                    "htf_daily_fvg": htf["daily_gap"] is not None,
                    "htf_1h_fvg": htf["hourly_gap"] is not None,
                    "liquidity_sweep": sweep is not None,
                    "displacement": displacement["confirmed"],
                    "ifvg_trigger": bool(inversions),
                }
                score = sum(1 for v in confluence.values() if v)
                signal["confluence"] = confluence
                signal["confluence_score"] = score
                signal["grade"] = "A+" if score == len(CONFLUENCE_FACTORS) else ("B" if score >= 3 else "C")
                signal["position_size"] = "INCREASED" if score == len(CONFLUENCE_FACTORS) else "STANDARD"
                signal["order_block"] = order_block

                aligned = (
                    (direction == "LONG" and htf["bias"] != "BEARISH")
                    or (direction == "SHORT" and htf["bias"] != "BULLISH")
                )
                signal["htf_aligned"] = aligned

                if displacement["confirmed"] and inversions:
                    state = "IFVG_TRIGGER"
                elif sweep:
                    state = "DISPLACEMENT_CONFIRMED"
                else:
                    state = "IDLE"

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
        "liquidity_levels": levels[-12:],
        "fair_value_gaps": gaps[-8:],
        "ifvgs": inversions,
        "displacement": displacement,
        "sweep": sweep,
        "htf": htf,
        "state_machine_state": state,
        "signal": signal,
    }