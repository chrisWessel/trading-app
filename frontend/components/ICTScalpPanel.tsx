'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Timer, Target, Shield, Layers, Zap, Gauge, Crosshair, Ban,
  RefreshCw, Moon, Sunrise, Radio, CheckCircle2, XCircle, Activity,
} from 'lucide-react';
import { API_BASE_URL } from '@/lib/apiConfig';
import type { SessionWindow, NextKillzone } from '@/components/SessionRibbon';
import ICTStrategyGuide from '@/components/ICTStrategyGuide';

// ─── Types (mirror backend/ict_engine.py) ─────────────────────────────────────

interface SessionInfo {
  name: string;
  phase: string;
  killzone: string | null;
  sub_window: string | null;
  in_killzone: boolean;
  is_weekend: boolean;
  trading_allowed: boolean;
  guidance: string;
  et_time: string;
  harare_time: string;
}

interface AsiaRange {
  high: number;
  low: number;
  midpoint: number;
  range_points: number;
  candles_covered: number;
  complete: boolean;
  high_swept: boolean;
  low_swept: boolean;
  label: string;
}

interface Displacement {
  confirmed: boolean;
  body_ratio: number;
  volume_ratio: number;
  direction: string;
  threshold: number;
}

interface Sweep {
  level: number;
  type: string;
  side: string;
  expected_direction: string;
  swept_at: number;
  candles_ago: number;
  wick_points: number;
}

interface HtfInfo {
  bias: string;
  daily_gap: { direction: string; bottom: number; top: number } | null;
  hourly_gap: { direction: string; bottom: number; top: number } | null;
  previous_day_high: number | null;
  previous_day_low: number | null;
}

// ── Session dynamics: trap filter, raid/MSS, NY scenarios ────────────────────

interface AsiaTrend {
  asia_trend: string;
  close_position: number | null;
  move_fraction: number;
  closes_near_high: boolean;
  closes_near_low: boolean;
  midpoint_shift: number;
}

interface TrapFilter {
  london_early_pump_trap: boolean;
  london_early_dump_trap: boolean;
  trap_bias: string | null;
  inhibited_direction: string | null;
  trap_active: boolean;
  released?: boolean;
  sequence_complete?: boolean;
  note: string;
}

interface Raid {
  level: number;
  side: string;
  raid_direction: string;
  raid_index: number;
  swept_at: number;
  candles_ago: number;
  wick_points: number;
  reclaim_distance: number;
}

interface Mss {
  confirmed: boolean;
  direction: string | null;
  broken_level: number | null;
  broken_at: number | null;
  candles_since_raid: number | null;
  reason: string;
}

interface DisplacementZone {
  kind: string;
  zone_bottom: number;
  zone_top: number;
  formed_at: number;
  direction: string;
}

interface LondonExpansion {
  valid: boolean;
  range_points: number;
  atr_multiple: number;
  direction: string;
  open?: number;
  close?: number;
  high?: number;
  low?: number;
  midpoint?: number;
}

interface HtfDol {
  available: boolean;
  pdh: number | null;
  pdl: number | null;
  pdh_reached: boolean;
  pdl_reached: boolean;
  swept: boolean;
  unreached_target: number | null;
}

interface NyScenario {
  scenario: string | null;
  eligible: boolean;
  conditions: Record<string, boolean>;
  unreached_htf_target: number | null;
  london_direction: string;
  note: string;
}

interface IctSignal {
  status: string;
  direction: string;
  reason?: string;
  entry?: number;
  stop_loss?: number;
  take_profit?: number;
  risk_points?: number;
  reward_points?: number;
  risk_reward?: number;
  min_rr?: number;
  max_stop_points?: number;
  max_stop_reference_points?: number;
  cancelled_reasons?: string[];
  confluence?: Record<string, boolean>;
  confluence_score?: number;
  grade?: string;
  position_size?: string;
  htf_aligned?: boolean;
  scenario?: string | null;
  target_source?: string;
  trap_blocked?: boolean;
  stop_basis?: string;
  displacement_zone?: DisplacementZone | null;
  raid?: Raid | null;
  mss?: Mss | null;
}

interface IctAnalysis {
  status: string;
  symbol: string;
  data_source: string;
  generated_at_et: string;
  session: SessionInfo;
  next_killzone: NextKillzone;
  windows: SessionWindow[];
  anchors: {
    midnight_open_et: string;
    midnight_open_harare: string;
    rth_open_et: string;
    rth_open_harare: string;
    minutes_since_midnight_open: number;
    minutes_to_rth_open: number;
  };
  current_price: number;
  atr: number;
  asia_range: AsiaRange | null;
  asia_trend: AsiaTrend;
  trap_filter: TrapFilter;
  raid: Raid | null;
  mss: Mss;
  displacement_zone: DisplacementZone | null;
  london_expansion: LondonExpansion;
  htf_dol: HtfDol;
  ny_scenario: NyScenario;
  midnight_open_price: number | null;
  liquidity_levels: { price: number; type: string; side: string }[];
  fair_value_gaps: { direction: string; bottom: number; top: number }[];
  ifvgs: { signal: string; direction: string; zone_bottom: number; zone_top: number }[];
  displacement: Displacement;
  sweep: Sweep | null;
  htf: HtfInfo;
  state_machine_state: string;
  signal: IctSignal;
  message?: string;
}

interface Props {
  symbol: string;
  timeframe: string;
  onPublish?: (payload: IctPublish) => void;
}

export interface IctLevels {
  direction: 'LONG' | 'SHORT';
  entry: number;
  stop_loss: number;
  take_profit: number;
}

export interface IctChartLine {
  price: number;
  color: string;
  title: string;
  lineWidth?: 1 | 2 | 3 | 4;
  lineStyle?: 0 | 1 | 2 | 3 | 4;
}

export interface IctSessionSnapshot {
  windows: SessionWindow[];
  nextKillzone: NextKillzone;
  currentEt: string;
  currentHarare: string;
  inKillzone: boolean;
  name: string;
}

export interface IctPublish {
  levels: IctLevels | null;
  lines: IctChartLine[];
  session: IctSessionSnapshot;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CONFLUENCE_LABELS: Record<string, string> = {
  htf_daily_fvg: 'HTF Daily FVG',
  htf_1h_fvg: 'HTF 1H FVG',
  liquidity_sweep: 'Liquidity Sweep',
  displacement: 'Displacement',
  ifvg_trigger: 'IFVG Trigger',
};

const STATE_LABELS: Record<string, string> = {
  IDLE: 'IDLE — no active setup',
  WAIT_FOR_RAID: 'WAIT FOR RAID — watching the Asia boundary',
  SWEEP_DETECTED: 'SWEEP DETECTED',
  MSS_PENDING: 'MSS PENDING — raid done, awaiting structure break',
  DISPLACEMENT_CONFIRMED: 'DISPLACEMENT CONFIRMED',
  IFVG_TRIGGER: 'IFVG TRIGGER',
  NY_CONTINUATION_EVAL: 'NY SCENARIO 1 — continuation',
  NY_REVERSAL_EVAL: 'NY SCENARIO 2 — reversal',
  ENTERED: 'ENTERED',
  MANAGING: 'MANAGING',
  CLOSED: 'CLOSED',
};

function Card({ title, icon, children, className = '' }: { title: string; icon?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 shadow-lg ${className}`}>
      <div className="flex items-center gap-2 text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-2.5">
        {icon}
        <span>{title}</span>
      </div>
      {children}
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

// Turn the analysis into the horizontal levels drawn on the chart. These are
// the reference points you watch before an entry fires.
function buildChartLines(a: IctAnalysis): IctChartLine[] {
  const lines: IctChartLine[] = [];

  if (a.asia_range) {
    lines.push({ price: a.asia_range.high, color: '#f59e0b', title: 'ASIA HIGH', lineWidth: 2, lineStyle: 2 });
    lines.push({ price: a.asia_range.low, color: '#f59e0b', title: 'ASIA LOW', lineWidth: 2, lineStyle: 2 });
  }

  // The raid boundary and the structure it broke are the two levels the London
  // model is actually resolved against.
  if (a.raid) {
    lines.push({
      price: a.raid.level,
      color: '#fb923c',
      title: a.raid.side === 'BUY_SIDE' ? 'ASIA HIGH RAIDED' : 'ASIA LOW RAIDED',
      lineWidth: 2,
      lineStyle: 3,
    });
  }

  if (a.mss && a.mss.broken_level !== null) {
    lines.push({
      price: a.mss.broken_level,
      color: a.mss.confirmed ? '#22d3ee' : '#64748b',
      title: a.mss.confirmed ? 'MSS BROKEN' : 'MSS LEVEL',
      lineWidth: a.mss.confirmed ? 2 : 1,
      lineStyle: 4,
    });
  }

  if (a.displacement_zone) {
    const z = a.displacement_zone;
    lines.push({
      price: z.zone_bottom,
      color: z.direction === 'LONG' ? '#34d399' : '#fb7185',
      title: `${z.kind} ENTRY`,
      lineWidth: 2,
      lineStyle: 0,
    });
    lines.push({
      price: z.zone_top,
      color: z.direction === 'LONG' ? '#34d399' : '#fb7185',
      title: `${z.kind} ENTRY`,
      lineWidth: 2,
      lineStyle: 0,
    });
  }

  // The unreached HTF draw on liquidity is Scenario 1's target.
  if (a.ny_scenario && a.ny_scenario.unreached_htf_target) {
    lines.push({
      price: a.ny_scenario.unreached_htf_target,
      color: '#38bdf8',
      title: 'HTF DOL TARGET',
      lineWidth: 2,
      lineStyle: 2,
    });
  }

  if (a.sweep) {
    lines.push({
      price: a.sweep.level,
      color: '#a855f7',
      title: a.sweep.side === 'BUY_SIDE' ? 'SWEPT HIGHS' : 'SWEPT LOWS',
      lineWidth: 1,
      lineStyle: 3,
    });
  }

  (a.ifvgs || []).slice(-3).forEach((g) => {
    lines.push({
      price: g.zone_bottom,
      color: g.direction === 'LONG' ? '#34d399' : '#fb7185',
      title: `IFVG ${g.zone_bottom}`,
      lineWidth: 1,
      lineStyle: 1,
    });
    lines.push({
      price: g.zone_top,
      color: g.direction === 'LONG' ? '#34d399' : '#fb7185',
      title: `IFVG ${g.zone_top}`,
      lineWidth: 1,
      lineStyle: 1,
    });
  });

  (a.fair_value_gaps || []).slice(-4).forEach((g) => {
    lines.push({
      price: g.bottom,
      color: '#64748b',
      title: `FVG ${g.direction === 'BULLISH' ? '↑' : '↓'}`,
      lineWidth: 1,
      lineStyle: 2,
    });
    lines.push({
      price: g.top,
      color: '#64748b',
      title: `FVG ${g.direction === 'BULLISH' ? '↑' : '↓'}`,
      lineWidth: 1,
      lineStyle: 2,
    });
  });

  (a.liquidity_levels || []).slice(-6).forEach((l) => {
    lines.push({
      price: l.price,
      color: l.side === 'BUY_SIDE' ? '#38bdf8' : '#fb923c',
      title: l.type === 'EQUAL_HIGHS' ? 'EQ HIGHS' : 'EQ LOWS',
      lineWidth: 1,
      lineStyle: 3,
    });
  });

  if (a.htf) {
    if (a.htf.previous_day_high) lines.push({ price: a.htf.previous_day_high, color: '#94a3b8', title: 'PDH', lineWidth: 1, lineStyle: 1 });
    if (a.htf.previous_day_low) lines.push({ price: a.htf.previous_day_low, color: '#94a3b8', title: 'PDL', lineWidth: 1, lineStyle: 1 });
  }

  // De-duplicate by price so we never stack identical lines on the axis.
  const seen = new Set<number>();
  return lines.filter((l) => {
    if (!Number.isFinite(l.price) || l.price <= 0) return false;
    const key = Math.round(l.price * 1000);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default function ICTScalpPanel({ symbol, timeframe, onPublish }: Props) {
  const [data, setData] = useState<IctAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [firedAt, setFiredAt] = useState<string | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchAnalysis = useCallback(async () => {
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/ict/analysis?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}`
      );
      if (!res.ok) throw new Error(`Engine returned ${res.status}`);
      const json = await res.json();
      if (json && json.status !== 'insufficient_data') {
        setData(json);
        setError(null);

        const sig = json.signal as IctSignal;
        const dir = sig?.direction;
        const publishable =
          sig?.status === 'ENTRY_READY' &&
          (dir === 'LONG' || dir === 'SHORT') &&
          Number.isFinite(sig.entry) && Number.isFinite(sig.stop_loss) && Number.isFinite(sig.take_profit);

        // Stamp the moment the setup first armed so the chart can show *when*
        // to place the trade, not just that a trade exists.
        setFiredAt((prev) => {
          if (publishable) return prev ?? (json.generated_at_et || '');
          return null;
        });

        onPublish?.({
          levels: publishable ? {
            direction: dir as IctLevels['direction'],
            entry: sig.entry!,
            stop_loss: sig.stop_loss!,
            take_profit: sig.take_profit!,
          } : null,
          lines: buildChartLines(json),
          session: {
            windows: json.windows || [],
            nextKillzone: json.next_killzone,
            currentEt: json.session?.et_time || '00:00',
            currentHarare: json.session?.harare_time || '00:00',
            inKillzone: !!json.session?.in_killzone,
            name: json.session?.name || 'OFF_HOURS',
          },
        });
      } else {
        setError(json?.message || 'Not enough history to evaluate the setup.');
      }
    } catch (e: any) {
      setError(e?.message || 'ICT engine unreachable.');
    }
  }, [symbol, timeframe, onPublish]);

  useEffect(() => {
    setLoading(true);
    fetchAnalysis();
    intervalRef.current = setInterval(fetchAnalysis, 15000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchAnalysis]);

  if (error && !data) {
    return (
      <div className="bg-slate-900 border border-amber-800/60 rounded-xl p-5 flex items-center gap-3">
        <Ban className="w-5 h-5 text-amber-400" />
        <div>
          <div className="text-amber-300 font-bold text-sm">ICT Engine Unavailable</div>
          <div className="text-slate-400 text-xs font-mono">{error}</div>
        </div>
        <button
          onClick={() => { setLoading(true); fetchAnalysis(); }}
          className="ml-auto flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs font-bold text-slate-200 hover:bg-slate-700"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Retry
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex items-center justify-center gap-3 min-h-[140px]">
        <Activity className="w-5 h-5 text-blue-400 animate-pulse" />
        <span className="text-slate-400 text-sm font-mono">Loading AMD session model for {symbol}…</span>
      </div>
    );
  }

  const {
    session, next_killzone: nextKz, windows, anchors, signal, htf, displacement, sweep,
    asia_range: asia, ifvgs, asia_trend: trend, trap_filter: trap, raid, mss,
    displacement_zone: dispZone, london_expansion: londonExp, htf_dol: dol, ny_scenario: nyScn,
  } = data;
  const isLive = session.in_killzone;
  const isLong = signal.direction === 'LONG';
  const ready = signal.status === 'ENTRY_READY';

  const sessionBorder = isLive
    ? 'border-emerald-600/60 bg-emerald-950/40'
    : 'border-slate-700 bg-slate-950/60';
  const sessionText = isLive ? 'text-emerald-300' : 'text-slate-300';

  const dirAccent = signal.direction === 'LONG'
    ? 'text-emerald-400 border-emerald-700/60 bg-emerald-950/40'
    : signal.direction === 'SHORT'
      ? 'text-rose-400 border-rose-700/60 bg-rose-950/40'
      : 'text-slate-400 border-slate-700 bg-slate-950/60';

  return (
    <div className="space-y-3 font-mono">

      {/* ── WHEN TO TRADE ─────────────────────────────────────────────────── */}
      <div className={`rounded-xl border p-4 ${sessionBorder}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-lg border ${
              isLive ? 'bg-emerald-900/50 border-emerald-700 text-emerald-300 animate-pulse'
                     : 'bg-slate-900 border-slate-700 text-slate-400'
            }`}>
              {isLive ? <Zap className="w-5 h-5" /> : <Timer className="w-5 h-5" />}
            </div>
            <div>
              <div className={`text-lg font-black tracking-tight ${sessionText}`}>
                {isLive ? '🟢 TRADE WINDOW OPEN' : '⏳ STAND ASIDE'}
              </div>
              <div className="text-xs text-slate-400">
                {session.name} SESSION · {session.phase} · {session.et_time} ET / {session.harare_time} CAT
              </div>
            </div>
          </div>

          <div className="text-right">
            <div className="text-[10px] text-slate-500 font-bold uppercase">State Machine</div>
            <div className="text-xs font-black text-blue-300">{STATE_LABELS[data.state_machine_state] || data.state_machine_state}</div>
          </div>
        </div>
        <p className="mt-2.5 text-xs text-slate-300">{session.guidance}</p>

        {!isLive && nextKz.label && (
          <div className="mt-3 flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg bg-slate-950/70 border border-slate-800">
            <Timer className="w-4 h-4 text-amber-400" />
            <span className="text-xs text-slate-400">Next killzone</span>
            <span className="text-sm font-black text-amber-300">{nextKz.label}</span>
            <span className="text-xs text-slate-500">opens in</span>
            <span className="text-sm font-black text-white">{nextKz.countdown}</span>
            <span className="text-[11px] text-slate-500 ml-auto">
              {nextKz.opens_et} ET · {nextKz.opens_harare} CAT
            </span>
          </div>
        )}

        {ready && firedAt && (
          <div className="mt-3 flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg bg-emerald-950/60 border border-emerald-700/70">
            <span className="text-sm font-black text-emerald-300">▶ ENTER NOW</span>
            <span className="text-[11px] text-emerald-200/80">
              Setup armed at <span className="font-black">{firedAt} ET</span> · execute on the 1-minute with a market order
            </span>
          </div>
        )}
      </div>

      {/* ── SESSION TIMETABLE ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {windows.map((w) => {
          const live = w.status === 'LIVE';
          const Icon = w.name === 'ASIA' ? Moon : w.name === 'LONDON' ? Sunrise : Radio;
          return (
            <div
              key={w.name}
              className={`rounded-xl border p-3 ${
                live ? 'border-emerald-600/60 bg-emerald-950/30'
                     : w.status === 'UPCOMING' ? 'border-amber-700/50 bg-amber-950/20'
                     : 'border-slate-800 bg-slate-900/60'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="flex items-center gap-1.5 text-xs font-black tracking-wide">
                  <Icon className={`w-3.5 h-3.5 ${live ? 'text-emerald-400' : 'text-slate-500'}`} />
                  {w.name}
                </span>
                <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${
                  live ? 'bg-emerald-900 text-emerald-300'
                       : w.status === 'UPCOMING' ? 'bg-amber-900 text-amber-300'
                       : 'bg-slate-800 text-slate-500'
                }`}>
                  {w.status === 'UPCOMING' ? `IN ${w.countdown}` : w.status}
                </span>
              </div>
              <div className="text-sm font-bold text-white">{w.opens_et} – {w.closes_et}</div>
              <div className="text-[11px] text-slate-400">{w.opens_harare} – {w.closes_harare} CAT</div>
              <div className="mt-1 text-[10px] text-slate-500">{w.purpose}</div>
              {w.is_killzone && (
                <div className="mt-1 text-[10px] font-bold text-amber-400">◆ KILLZONE — entries permitted</div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── SIGNAL ────────────────────────────────────────────────────────── */}
      <div className={`rounded-xl border p-4 ${dirAccent}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Crosshair className="w-5 h-5" />
            <div>
              <div className="text-lg font-black tracking-tight">
                {signal.status === 'ENTRY_READY' && `${signal.direction} — ENTRY READY`}
                {signal.status === 'ENTRY_CANCELLED' && `${signal.direction} — ENTRY CANCELLED`}
                {signal.status === 'INHIBITED_TRAP' && `${signal.direction} — BLOCKED BY TRAP FILTER`}
                {signal.status === 'WAIT' && 'NO TRADE — WAIT'}
              </div>
              <div className="text-[11px] opacity-90">
                {ready
                  ? `Grade ${signal.grade} · ${signal.confluence_score}/5 confluences · ${signal.position_size} size${signal.htf_aligned ? ' · HTF aligned' : ''}`
                  : signal.reason}
              </div>
              {signal.scenario && signal.status !== 'WAIT' && (
                <div className="text-[10px] font-bold text-sky-300 mt-0.5">
                  {signal.scenario === 'SCENARIO_1' ? 'NY SCENARIO 1 — CONTINUATION' : 'NY SCENARIO 2 — REVERSAL'}
                  {signal.target_source === 'SCENARIO_TARGET' ? ' · target = structural DOL' : ''}
                </div>
              )}
            </div>
          </div>
          {signal.status !== 'WAIT' && signal.confluence_score !== undefined && (
            <div className="text-right">
              <div className="text-[10px] opacity-75 font-bold uppercase">Confluence</div>
              <div className="text-sm font-black">{signal.confluence_score} / 5</div>
            </div>
          )}
        </div>

        {signal.cancelled_reasons && signal.cancelled_reasons.length > 0 && (
          <div className="mt-2 text-[11px] text-rose-300">{signal.cancelled_reasons.join(' ')}</div>
        )}

        {signal.entry !== undefined && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 text-xs">
            <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-2">
              <div className="text-[10px] text-slate-400 font-bold">ENTRY (market)</div>
              <div className="text-white font-black text-base">{signal.entry}</div>
            </div>
            <div className="bg-slate-950/70 border border-rose-900/60 rounded-lg p-2">
              <div className="text-[10px] text-rose-400 font-bold flex items-center gap-1"><Shield className="w-3 h-3" /> STOP</div>
              <div className="text-rose-300 font-black text-base">{signal.stop_loss}</div>
              <div className="text-[10px] text-slate-500">risk {signal.risk_points} · cap {signal.max_stop_points}</div>
            </div>
            <div className="bg-slate-950/70 border border-emerald-900/60 rounded-lg p-2">
              <div className="text-[10px] text-emerald-400 font-bold flex items-center gap-1"><Target className="w-3 h-3" /> TARGET</div>
              <div className="text-emerald-300 font-black text-base">{signal.take_profit}</div>
              <div className="text-[10px] text-slate-500">reward {signal.reward_points}</div>
            </div>
            <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-2">
              <div className="text-[10px] text-slate-400 font-bold flex items-center gap-1"><Gauge className="w-3 h-3" /> R:R</div>
              <div className="text-white font-black text-base">
                {signal.risk_reward} : 1
              </div>
              <div className="text-[10px] text-slate-500">min {signal.min_rr}:1</div>
            </div>
          </div>
        )}

        {signal.confluence && (
          <div className="flex flex-wrap gap-2 mt-3">
            {Object.entries(signal.confluence).map(([key, ok]) => (
              <span
                key={key}
                className={`flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full border ${
                  ok ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                     : 'bg-slate-900 text-slate-500 border-slate-800'
                }`}
              >
                {ok ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                {CONFLUENCE_LABELS[key] || key}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── CONTEXT GRID ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">

        <Card title="Asia Range (Accumulation)" icon={<Layers className="w-3.5 h-3.5 text-blue-400" />}>
          {asia ? (
            <>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div><div className="text-[10px] text-slate-500 font-bold">ASIA HIGH</div><div className="text-white font-black">{asia.high}</div></div>
                <div><div className="text-[10px] text-slate-500 font-bold">ASIA LOW</div><div className="text-white font-black">{asia.low}</div></div>
                <div><div className="text-[10px] text-slate-500 font-bold">RANGE</div><div className="text-white font-black">{asia.range_points}</div></div>
              </div>
              <div className="mt-2 text-[11px] text-slate-400">
                {asia.label} · {asia.complete ? 'complete' : 'still forming'} · {asia.candles_covered} bars
              </div>
              <div className="mt-1.5 flex gap-2 text-[10px] font-bold">
                <span className={`px-1.5 py-0.5 rounded ${asia.high_swept ? 'bg-rose-950 text-rose-300' : 'bg-slate-800 text-slate-500'}`}>
                  HIGH SWEPT {asia.high_swept ? '✓' : '✗'}
                </span>
                <span className={`px-1.5 py-0.5 rounded ${asia.low_swept ? 'bg-rose-950 text-rose-300' : 'bg-slate-800 text-slate-500'}`}>
                  LOW SWEPT {asia.low_swept ? '✓' : '✗'}
                </span>
              </div>
            </>
          ) : (
            <div className="text-xs text-slate-500">Asia range not yet available (need 19:00–02:00 ET history).</div>
          )}
        </Card>

        <Card title="Asia Trap Filter" icon={<Ban className="w-3.5 h-3.5 text-rose-400" />}>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between items-center">
              <span className="text-slate-400">ASIA_TREND</span>
              <span className={`font-black ${trend.asia_trend === 'BULLISH' ? 'text-emerald-300' : trend.asia_trend === 'BEARISH' ? 'text-rose-300' : 'text-slate-300'}`}>
                {trend.asia_trend}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5 text-[10px] font-bold">
              <span className={`px-1.5 py-0.5 rounded ${trap.london_early_pump_trap ? 'bg-amber-950 text-amber-300' : 'bg-slate-800 text-slate-500'}`}>
                PUMP TRAP {trap.london_early_pump_trap ? '✓' : '✗'}
              </span>
              <span className={`px-1.5 py-0.5 rounded ${trap.london_early_dump_trap ? 'bg-amber-950 text-amber-300' : 'bg-slate-800 text-slate-500'}`}>
                DUMP TRAP {trap.london_early_dump_trap ? '✓' : '✗'}
              </span>
              {trap.trap_active && (
                <span className={`px-1.5 py-0.5 rounded ${trap.released ? 'bg-emerald-950 text-emerald-300' : 'bg-rose-950 text-rose-300'}`}>
                  {trap.released ? 'RELEASED — RAID + MSS ✓' : `BLOCKS ${trap.inhibited_direction}`}
                </span>
              )}
            </div>
            <div className="text-[11px] text-slate-400">{trap.note}</div>
          </div>
        </Card>

        <Card title="London Raid → MSS → FVG" icon={<Crosshair className="w-3.5 h-3.5 text-orange-400" />}>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between items-center">
              <span className="text-slate-400">1 · Raid</span>
              {raid ? (
                <span className="text-orange-300 font-black">
                  {raid.side === 'BUY_SIDE' ? 'ASIA HIGH' : 'ASIA LOW'} {raid.level} · wick {raid.wick_points}
                </span>
              ) : (
                <span className="text-slate-500 font-bold">waiting</span>
              )}
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400">2 · MSS</span>
              <span className={mss.confirmed ? 'text-cyan-300 font-black' : 'text-slate-500 font-bold'}>
                {mss.confirmed ? `broken ${mss.broken_level}` : 'pending'}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400">3 · Displacement gap</span>
              {dispZone ? (
                <span className="font-black text-slate-200">
                  {dispZone.kind} {dispZone.zone_bottom}–{dispZone.zone_top}
                </span>
              ) : (
                <span className="text-slate-500 font-bold">none yet</span>
              )}
            </div>
            <div className="text-[11px] text-slate-400">{mss.reason}</div>
          </div>
        </Card>

        <Card title="New York Scenario" icon={<Activity className="w-3.5 h-3.5 text-sky-400" />}>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between items-center">
              <span className="text-slate-400">Window</span>
              <span className="text-slate-200 font-black">
                {session.sub_window ? session.sub_window : '—'}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400">Scenario</span>
              <span className={`font-black ${nyScn.scenario === 'SCENARIO_1' ? 'text-emerald-300' : nyScn.scenario === 'SCENARIO_2' ? 'text-rose-300' : 'text-slate-400'}`}>
                {nyScn.scenario === 'SCENARIO_1' ? '1 — CONTINUATION' : nyScn.scenario === 'SCENARIO_2' ? '2 — REVERSAL' : 'NONE'}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5 text-[10px] font-bold">
              <span className={`px-1.5 py-0.5 rounded ${nyScn.eligible ? 'bg-emerald-950 text-emerald-300' : 'bg-slate-800 text-slate-500'}`}>
                ARMED {nyScn.eligible ? '✓' : '✗'}
              </span>
              <span className={`px-1.5 py-0.5 rounded ${londonExp.valid ? 'bg-emerald-950 text-emerald-300' : 'bg-slate-800 text-slate-500'}`}>
                LONDON EXPANSION {londonExp.atr_multiple.toFixed(1)}x ATR
              </span>
              <span className={`px-1.5 py-0.5 rounded ${dol.swept || dol.pdh_reached || dol.pdl_reached ? 'bg-rose-950 text-rose-300' : 'bg-slate-800 text-slate-500'}`}>
                HTF DOL {dol.swept || dol.pdh_reached || dol.pdl_reached ? 'TAKEN' : 'OPEN'}
              </span>
            </div>
            <div className="text-[11px] text-slate-400">{nyScn.note}</div>
          </div>
        </Card>

        <Card title="Displacement & Sweep" icon={<Zap className="w-3.5 h-3.5 text-amber-400" />}>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-400">Body ratio</span>
              <span className={displacement.confirmed ? 'text-emerald-300 font-black' : 'text-slate-300 font-bold'}>
                {(displacement.body_ratio * 100).toFixed(0)}% / {(displacement.threshold * 100).toFixed(0)}% required
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Volume vs 20-bar MA</span>
              <span className={displacement.volume_ratio >= 1 ? 'text-emerald-300 font-black' : 'text-slate-300 font-bold'}>
                {displacement.volume_ratio.toFixed(2)}×
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Direction</span>
              <span className="text-slate-200 font-bold">{displacement.direction}</span>
            </div>
            <div className="h-1.5 bg-slate-800 rounded overflow-hidden">
              <div
                className={`h-full ${displacement.confirmed ? 'bg-emerald-400' : 'bg-amber-500'}`}
                style={{ width: `${Math.min(100, (displacement.body_ratio / displacement.threshold) * 100)}%` }}
              />
            </div>
            <div className="pt-1 text-slate-400">
              Latest sweep:{' '}
              {sweep ? (
                <span className="text-amber-300 font-bold">
                  {sweep.side.replace('_', '-')} {sweep.level} wick {sweep.wick_points} → expect {sweep.expected_direction}
                </span>
              ) : (
                <span className="text-slate-500">none in last 5 candles</span>
              )}
            </div>
          </div>
        </Card>

        <Card title="Higher Timeframe Bias" icon={<Activity className="w-3.5 h-3.5 text-violet-400" />}>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-400">Daily bias</span>
              <span className={`font-black ${
                htf.bias === 'BULLISH' ? 'text-emerald-300' : htf.bias === 'BEARISH' ? 'text-rose-300' : 'text-slate-300'
              }`}>
                {htf.bias}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Previous day high</span>
              <span className="text-slate-200 font-bold">{htf.previous_day_high ?? '--'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Previous day low</span>
              <span className="text-slate-200 font-bold">{htf.previous_day_low ?? '--'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Daily FVG</span>
              <span className={htf.daily_gap ? 'text-emerald-300 font-bold' : 'text-slate-500'}>
                {htf.daily_gap ? `${htf.daily_gap.bottom} – ${htf.daily_gap.top}` : 'none'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">1H FVG</span>
              <span className={htf.hourly_gap ? 'text-emerald-300 font-bold' : 'text-slate-500'}>
                {htf.hourly_gap ? `${htf.hourly_gap.bottom} – ${htf.hourly_gap.top}` : 'none'}
              </span>
            </div>
          </div>
        </Card>

        <Card title="Anchors & IFVGs" icon={<Target className="w-3.5 h-3.5 text-rose-400" />}>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-400">Midnight open</span>
              <span className="text-slate-200 font-bold">{anchors.midnight_open_et} ET ({anchors.midnight_open_harare} CAT)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">RTH open</span>
              <span className="text-slate-200 font-bold">{anchors.rth_open_et} ET ({anchors.rth_open_harare} CAT)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Active IFVGs</span>
              <span className="text-slate-200 font-bold">{ifvgs.length}</span>
            </div>
            <div className="pt-1 space-y-1">
              {ifvgs.slice(-4).map((g, i) => (
                <div key={i} className="flex items-center gap-2 text-[10px]">
                  <span className={`font-black px-1.5 py-0.5 rounded ${
                    g.direction === 'LONG' ? 'bg-emerald-950 text-emerald-300' : 'bg-rose-950 text-rose-300'
                  }`}>
                    {g.signal.replace('VALID_IFVG_', '')}
                  </span>
                  <span className="text-slate-400">zone {g.zone_bottom} – {g.zone_top}</span>
                </div>
              ))}
              {ifvgs.length === 0 && <div className="text-[10px] text-slate-500">No inversions on the last candles.</div>}
            </div>
          </div>
        </Card>
      </div>

      <div className="text-[10px] text-slate-600 text-center">
        {data.data_source} · analysed {data.generated_at_et} · refreshes every 15s · signals are analytical, not financial advice
      </div>

      <ICTStrategyGuide analysis={data} />
    </div>
  );
}