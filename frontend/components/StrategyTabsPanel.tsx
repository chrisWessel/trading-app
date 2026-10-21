'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  Clock,
  Shield,
  Target,
  TrendingUp,
  TrendingDown,
  Zap,
  BookOpen,
  Layers,
  BarChart3,
  Activity,
  Lock,
  Sparkles,
  ExternalLink,
  HelpCircle,
  XCircle,
} from 'lucide-react';
import { API_BASE_URL } from '@/lib/apiConfig';
import type { ChartExtraLine } from '@/components/TradingChart';

export type StrategyTierTabId = 'daily_sweep' | 's_tier' | 'a_tier' | 'b_tier';

export interface StrategyPublishPayload {
  strategyId: StrategyTierTabId;
  tradeLevels: {
    signalType: 'BUY/LONG' | 'SELL/SHORT';
    entry: number;
    stopLoss: number;
    takeProfit: number;
  } | null;
  chartLines: ChartExtraLine[];
}

interface StrategyTabsPanelProps {
  strategyId: StrategyTierTabId;
  symbol: string;
  timeframe: string;
  onPublish?: (payload: StrategyPublishPayload) => void;
  onAutoFillTrade?: (params: any) => void;
}

const TIMEFRAME_HOLD_SECONDS: Record<string, number> = {
  '1s': 15,
  '5s': 20,
  '15s': 30,
  '30s': 45,
  '1m': 60,
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
};

function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h}h ${m}m ${sec}s`;
  }
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec < 10 ? '0' : ''}${sec}s` : `${sec}s`;
}

export default function StrategyTabsPanel({
  strategyId,
  symbol,
  timeframe,
  onPublish,
  onAutoFillTrade,
}: StrategyTabsPanelProps) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [holdRemainingSec, setHoldRemainingSec] = useState<number>(
    TIMEFRAME_HOLD_SECONDS[timeframe] || 300
  );
  const [syncedSignal, setSyncedSignal] = useState<{
    signalType: 'BUY/LONG' | 'SELL/SHORT';
    bias: 'BULLISH' | 'BEARISH';
    probability: number;
    entry?: number;
    stopLoss?: number;
    tp1?: number;
    tp2?: number;
  } | null>(null);

  const lockExpiryRef = useRef<number>(
    Date.now() + (TIMEFRAME_HOLD_SECONDS[timeframe] || 300) * 1000
  );

  // Listen to global Signal Navigator broadcast so direction & timer never diverge
  useEffect(() => {
    const handleSync = (e: Event) => {
      const custom = e as CustomEvent;
      const detail = custom.detail;
      if (!detail) return;
      if (detail.symbol && detail.symbol !== symbol) return;
      const isBuy = String(detail.signal_type || '').toUpperCase().includes('BUY');
      setSyncedSignal({
        signalType: isBuy ? 'BUY/LONG' : 'SELL/SHORT',
        bias: isBuy ? 'BULLISH' : 'BEARISH',
        probability: Number(detail.probability || 84),
        entry: Number(detail.entry || 0),
        stopLoss: Number(detail.stop_loss || 0),
        tp1: Number(detail.tp1 || 0),
        tp2: Number(detail.tp2 || 0),
      });
      if (typeof detail.hold_remaining_sec === 'number' && detail.hold_remaining_sec > 0) {
        setHoldRemainingSec(detail.hold_remaining_sec);
        lockExpiryRef.current = Date.now() + detail.hold_remaining_sec * 1000;
      }
    };
    window.addEventListener('wessignal-signal-sync', handleSync);
    return () => window.removeEventListener('wessignal-signal-sync', handleSync);
  }, [symbol]);

  // Reset countdown when symbol or timeframe changes
  useEffect(() => {
    const total = TIMEFRAME_HOLD_SECONDS[timeframe] || 300;
    lockExpiryRef.current = Date.now() + total * 1000;
    setHoldRemainingSec(total);
  }, [symbol, timeframe]);

  // 1-second live countdown tick
  useEffect(() => {
    const timer = setInterval(() => {
      const rem = Math.max(0, Math.ceil((lockExpiryRef.current - Date.now()) / 1000));
      if (rem <= 0) {
        const total = TIMEFRAME_HOLD_SECONDS[timeframe] || 300;
        lockExpiryRef.current = Date.now() + total * 1000;
        setHoldRemainingSec(total);
      } else {
        setHoldRemainingSec(rem);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [timeframe]);

  const fetchAnalysis = useCallback(async () => {
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/strategies/analysis?symbol=${encodeURIComponent(
          symbol
        )}&timeframe=${encodeURIComponent(timeframe)}`,
        { cache: 'no-store' }
      );
      if (!res.ok) return;
      const json = await res.json();
      if (json.status === 'success' && json.strategies) {
        setData(json);
        if (
          typeof json.signal_sync?.hold_remaining_sec === 'number' &&
          json.signal_sync.hold_remaining_sec > 0
        ) {
          lockExpiryRef.current = Date.now() + json.signal_sync.hold_remaining_sec * 1000;
          setHoldRemainingSec(json.signal_sync.hold_remaining_sec);
        }
      }
    } catch {
      // Keep existing state if backend is momentarily unreachable
    } finally {
      setLoading(false);
    }
  }, [symbol, timeframe]);

  useEffect(() => {
    setLoading(true);
    fetchAnalysis();
    const interval = setInterval(fetchAnalysis, 8000);
    return () => clearInterval(interval);
  }, [fetchAnalysis]);

  const strat = data?.strategies?.[strategyId];
  const precision = data?.precision ?? 2;

  // Enforce strict BUY = BULLISH, SELL = BEARISH synchronization
  const effectiveDirection: 'BUY/LONG' | 'SELL/SHORT' =
    syncedSignal?.signalType ||
    (String(strat?.direction || 'BUY/LONG').includes('SELL') ? 'SELL/SHORT' : 'BUY/LONG');
  const effectiveBias: 'BULLISH' | 'BEARISH' =
    effectiveDirection === 'BUY/LONG' ? 'BULLISH' : 'BEARISH';
  const isBuy = effectiveDirection === 'BUY/LONG';

  const rawSetup = strat?.trade_setup || {};
  const entryPrice = Number(syncedSignal?.entry || rawSetup.entry || data?.latest_price || 0);
  let slPrice = Number(syncedSignal?.stopLoss || rawSetup.stop_loss || 0);
  let tp1Price = Number(syncedSignal?.tp1 || rawSetup.tp1 || 0);
  let tp2Price = Number(syncedSignal?.tp2 || rawSetup.tp2 || 0);

  // Enforce geometric correctness (BUY: SL < Entry < TP1; SELL: SL > Entry > TP1)
  const fallbackDist = entryPrice > 100 ? 4.0 : entryPrice > 10 ? 0.25 : 0.0025;
  if (entryPrice > 0) {
    if (isBuy) {
      if (!(slPrice > 0 && slPrice < entryPrice)) slPrice = Number((entryPrice - fallbackDist).toFixed(precision));
      if (!(tp1Price > entryPrice)) tp1Price = Number((entryPrice + fallbackDist * 1.6).toFixed(precision));
      if (!(tp2Price > tp1Price)) tp2Price = Number((tp1Price + fallbackDist * 1.2).toFixed(precision));
    } else {
      if (!(slPrice > entryPrice)) slPrice = Number((entryPrice + fallbackDist).toFixed(precision));
      if (!(tp1Price > 0 && tp1Price < entryPrice)) tp1Price = Number((entryPrice - fallbackDist * 1.6).toFixed(precision));
      if (!(tp2Price > 0 && tp2Price < tp1Price)) tp2Price = Number((tp1Price - fallbackDist * 1.2).toFixed(precision));
    }
  }

  // Publish chart lines & trade levels to parent TradingChart
  useEffect(() => {
    if (!onPublish || !strat) return;
    onPublish({
      strategyId,
      tradeLevels:
        entryPrice > 0
          ? {
              signalType: effectiveDirection,
              entry: entryPrice,
              stopLoss: slPrice,
              takeProfit: tp1Price,
            }
          : null,
      chartLines: Array.isArray(strat.chart_lines) ? strat.chart_lines : [],
    });
  }, [onPublish, strat, strategyId, effectiveDirection, entryPrice, slPrice, tp1Price]);

  if (loading && !strat) {
    return (
      <div className="bg-slate-950 border border-slate-800 rounded-xl p-6 text-center text-slate-400 font-mono text-xs animate-pulse">
        Loading {strategyId.toUpperCase().replace('_', ' ')} Institutional Telemetry & Rules...
      </div>
    );
  }

  if (!strat) {
    return null;
  }

  const tel = strat.telemetry || {};
  const rrRatio =
    entryPrice > 0 && Math.abs(entryPrice - slPrice) > 0
      ? (Math.abs(tp1Price - entryPrice) / Math.abs(entryPrice - slPrice)).toFixed(2)
      : rawSetup.rr_ratio || '1.60';

  const isTradeNow = String(strat.verdict || '').toUpperCase().includes('TRADE NOW');

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-5 shadow-2xl">
      {/* ── TOP HEADER & SYNCHRONIZED BIAS / HOLD TIMER BANNER ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-800">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold uppercase bg-blue-950 text-blue-300 border border-blue-700/70">
              {strategyId === 'daily_sweep'
                ? '🧹 STRATEGY 1 • JADECAP DAILY SWEEP & SFP'
                : strategyId === 's_tier'
                ? '🏆 STRATEGY 2 • S-TIER (GOD-TIER INSTITUTIONAL)'
                : strategyId === 'a_tier'
                ? '💎 STRATEGY 3 • A-TIER (SMART MONEY CORE)'
                : '🛡️ STRATEGY 4 • B-TIER (ALGO & BANK FOUNDATION)'}
            </span>
            <span className="text-xs font-mono text-slate-400">
              {strat.confluence_score}
            </span>
          </div>
          <h3 className="text-base md:text-lg font-extrabold text-white tracking-tight">
            {strat.title}
          </h3>
          <p className="text-[11px] text-slate-400 font-mono">
            Source Reference: {strat.video_source}
          </p>
        </div>

        {/* Synchronized Bias Badge + Timeframe Hold Timer */}
        <div className="flex flex-wrap items-center gap-2 font-mono">
          <div
            className={`px-3 py-1.5 rounded-lg border text-xs font-extrabold flex items-center gap-1.5 ${
              isTradeNow
                ? 'bg-emerald-950/80 border-emerald-600/80 text-emerald-300'
                : 'bg-amber-950/80 border-amber-600/80 text-amber-300'
            }`}
          >
            {isTradeNow ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-amber-400" />
            )}
            <span>{strat.verdict}</span>
          </div>

          <div
            className={`px-3 py-1.5 rounded-lg border text-xs font-extrabold flex items-center gap-1.5 ${
              isBuy
                ? 'bg-emerald-950/90 border-emerald-500 text-emerald-300'
                : 'bg-rose-950/90 border-rose-500 text-rose-300'
            }`}
          >
            {isBuy ? (
              <TrendingUp className="w-4 h-4 text-emerald-400" />
            ) : (
              <TrendingDown className="w-4 h-4 text-rose-400" />
            )}
            <span>
              {effectiveBias} • {effectiveDirection} ({syncedSignal?.probability || strat.probability}%)
            </span>
          </div>

          <div className="px-3 py-1.5 rounded-lg bg-slate-900 border border-blue-700/70 text-blue-300 text-xs font-bold flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5 text-amber-400" />
            <span>
              HOLD: {formatCountdown(holdRemainingSec)} [{timeframe}]
            </span>
          </div>
        </div>
      </div>

      {/* ── LIVE PRECISION EXECUTION LEVELS BAR ── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 font-mono text-xs">
        <div
          className={`p-3 rounded-lg border ${
            isBuy
              ? 'bg-emerald-950/30 border-emerald-800/70'
              : 'bg-rose-950/30 border-rose-800/70'
          }`}
        >
          <span className="text-[10px] uppercase font-bold text-slate-400 block">
            {isBuy ? '🟢 BUY / LONG ENTRY' : '🔴 SELL / SHORT ENTRY'}
          </span>
          <span className="text-base font-extrabold text-white">
            ${entryPrice.toFixed(precision)}
          </span>
          <span className="text-[10px] text-slate-400 block mt-0.5">
             Bias: {effectiveBias}
          </span>
        </div>

        <div className="p-3 rounded-lg bg-slate-900/90 border border-rose-800/70">
          <span className="text-[10px] uppercase font-bold text-rose-400 block">
            🛑 STOP LOSS ({isBuy ? 'BELOW' : 'ABOVE'})
          </span>
          <span className="text-base font-extrabold text-rose-300">
            ${slPrice.toFixed(precision)}
          </span>
          <span className="text-[10px] text-slate-400 block mt-0.5 truncate" title={rawSetup.sl_rule}>
            {rawSetup.sl_rule}
          </span>
        </div>

        <div className="p-3 rounded-lg bg-slate-900/90 border border-emerald-800/70">
          <span className="text-[10px] uppercase font-bold text-emerald-400 block">
            🎯 TAKE PROFIT 1 (TP1)
          </span>
          <span className="text-base font-extrabold text-emerald-300">
            ${tp1Price.toFixed(precision)}
          </span>
          <span className="text-[10px] text-slate-400 block mt-0.5">
            R:R Ratio 1 : {rrRatio}
          </span>
        </div>

        <div className="p-3 rounded-lg bg-slate-900/90 border border-teal-800/70">
          <span className="text-[10px] uppercase font-bold text-teal-400 block">
            🚀 TAKE PROFIT 2 (TP2)
          </span>
          <span className="text-base font-extrabold text-teal-300">
            ${tp2Price.toFixed(precision)}
          </span>
          <span className="text-[10px] text-slate-400 block mt-0.5 truncate" title={rawSetup.tp_rule}>
            {rawSetup.tp_rule}
          </span>
        </div>

        <div className="p-3 rounded-lg bg-slate-900/90 border border-blue-800/70 flex flex-col justify-between">
          <span className="text-[10px] uppercase font-bold text-blue-400 block">
            ⚡ PAPER DESK EXECUTION
          </span>
          <button
            onClick={() => {
              if (onAutoFillTrade) {
                onAutoFillTrade({
                  symbol,
                  direction: isBuy ? 'BUY' : 'SELL',
                  entry: entryPrice,
                  stop_loss: slPrice,
                  tp1: tp1Price,
                  tp2: tp2Price,
                  strategy: strat.title,
                });
              }
            }}
            className={`mt-1 w-full py-1.5 px-2.5 rounded-md font-bold text-xs text-white shadow transition flex items-center justify-center gap-1 ${
              isBuy
                ? 'bg-emerald-600 hover:bg-emerald-500'
                : 'bg-rose-600 hover:bg-rose-500'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Auto-Fill {isBuy ? 'BUY' : 'SELL'}</span>
          </button>
        </div>
      </div>

      {/* ── STRATEGY-SPECIFIC LIVE TELEMETRY DASHBOARD ── */}
      {strategyId === 'daily_sweep' && (
        <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="text-xs font-extrabold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
              <Layers className="w-4 h-4" />
              <span>JadeCap Daily / Weekly / Session Liquidity Pools & SFP Detector</span>
            </span>
            <span className="text-[11px] font-mono text-slate-400">
              Counterparty Stop-Loss Pools Mapped on Chart Above
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 font-mono text-xs">
            <div className="bg-slate-950 p-3 rounded-lg border border-amber-800/50">
              <span className="text-[10px] text-amber-400 font-bold block">
                PREV DAILY HIGH / LOW (PDH / PDL)
              </span>
              <div className="mt-1 text-white font-bold">
                PDH: ${Number(tel.pdh || 0).toFixed(precision)}
              </div>
              <div className="text-sky-300 font-bold">
                PDL: ${Number(tel.pdl || 0).toFixed(precision)}
              </div>
              <span className="text-[10px] text-slate-500 block mt-1">
                50% Eq: ${Number(tel.equilibrium_50 || 0).toFixed(precision)}
              </span>
            </div>

            <div className="bg-slate-950 p-3 rounded-lg border border-purple-800/50">
              <span className="text-[10px] text-purple-400 font-bold block">
                PREV WEEKLY & ASIA SESSION POOLS
              </span>
              <div className="mt-1 text-slate-200">
                PWH / PWL: ${Number(tel.pwh || 0).toFixed(precision)} / ${Number(tel.pwl || 0).toFixed(precision)}
              </div>
              <div className="text-pink-300">
                Asia H/L: ${Number(tel.asia_high || 0).toFixed(precision)} / ${Number(tel.asia_low || 0).toFixed(precision)}
              </div>
            </div>

            <div className="bg-slate-950 p-3 rounded-lg border border-emerald-800/50">
              <span className="text-[10px] text-emerald-400 font-bold block">
                ACTIVE SWING FAILURE PATTERN (SFP)
              </span>
              <div className="mt-1 text-white font-bold truncate">
                {tel.swept_pool_name}
              </div>
              <div className="text-emerald-300">
                Level: ${Number(tel.swept_level || 0).toFixed(precision)} | Wick: {tel.wick_rejection_pct}%
              </div>
              <span className="text-[10px] text-slate-400 block mt-1">
                SFP Extreme Invalidation: ${Number(tel.sfp_wick_extreme || 0).toFixed(precision)}
              </span>
            </div>

            <div className="bg-slate-950 p-3 rounded-lg border border-blue-800/50">
              <span className="text-[10px] text-blue-400 font-bold block">
                OPPOSING LIQUIDITY DRAW (TARGET)
              </span>
              <div className="mt-1 text-white font-bold">
                {tel.opposing_liquidity_name}
              </div>
              <div className="text-amber-300 font-bold">
                Target Pool: ${Number(tel.opposing_liquidity_price || 0).toFixed(precision)}
              </div>
              <span className="text-[10px] text-slate-400 block mt-1">
                Status: {tel.reclaimed ? '✅ Candle Closed Inside Range' : '⏳ Waiting for Reclaim Close'}
              </span>
            </div>
          </div>
        </div>
      )}

      {strategyId === 's_tier' && (
        <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="text-xs font-extrabold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
              <BarChart3 className="w-4 h-4" />
              <span>S-Tier Live Telemetry: Price Action + Volume Profile (HVN/LVN) + Footprint Order Flow</span>
            </span>
            <span className="text-[11px] font-mono text-emerald-400 font-bold">
              Rank: S-TIER (Top 3 Institutional Tools)
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 font-mono text-xs">
            {/* Pillar 1: Price Action */}
            <div className="bg-slate-950 p-3 rounded-lg border border-blue-800/60 space-y-1.5">
              <span className="text-[10px] text-blue-400 font-bold uppercase block">
                1. PRICE ACTION (ZERO LAG)
              </span>
              <div className="text-sm font-extrabold text-white">
                {tel.price_action_pattern}
              </div>
              <p className="text-[11px] text-slate-400 font-sans">
                Engulfing candles breaking structure signal an immediate shift right now; Inside Bars after an impulse show the market pausing before continuation.
              </p>
            </div>

            {/* Pillar 2: Volume Profile HVN / LVN */}
            <div className="bg-slate-950 p-3 rounded-lg border border-amber-800/60 space-y-1.5">
              <span className="text-[10px] text-amber-400 font-bold uppercase block">
                2. VOLUME PROFILE (WHERE VOLUME TRADED)
              </span>
              <div className="text-white font-bold">
                POC (Max Vol): <span className="text-amber-300">${Number(tel.poc || 0).toFixed(precision)}</span>
              </div>
              <div className="text-emerald-300">
                HVN Institutional Wall: ${Number(tel.nearest_hvn || 0).toFixed(precision)}
              </div>
              <div className="text-rose-300">
                LVN Fast Vacuum Slice: ${Number(tel.nearest_lvn || 0).toFixed(precision)}
              </div>
            </div>

            {/* Pillar 3: Footprint Order Flow */}
            <div className="bg-slate-950 p-3 rounded-lg border border-emerald-800/60 space-y-1.5">
              <span className="text-[10px] text-emerald-400 font-bold uppercase block">
                3. FOOTPRINT BID vs. ASK ABSORPTION
              </span>
              {Array.isArray(tel.footprint_bars) && tel.footprint_bars.slice(-3).map((fp: any, idx: number) => (
                <div key={idx} className="space-y-0.5">
                  <div className="flex justify-between text-[10px]">
                    <span className="text-slate-300">@ ${Number(fp.close).toFixed(precision)}</span>
                    <span className={fp.delta >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                      Ask {fp.buy_pct}% | Δ {fp.delta >= 0 ? `+${fp.delta}` : fp.delta}
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-rose-950 rounded overflow-hidden flex">
                    <div
                      className="bg-emerald-500 h-full"
                      style={{ width: `${Math.min(100, Math.max(5, fp.buy_pct))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {strategyId === 'a_tier' && (
        <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="text-xs font-extrabold uppercase tracking-wider text-purple-400 flex items-center gap-1.5">
              <Activity className="w-4 h-4" />
              <span>A-Tier Live Telemetry: Market Structure (BOS/CHoCH) + Supply/Demand + Volume Truth + TPO Profile</span>
            </span>
            <span className="text-[11px] font-mono text-purple-300 font-bold">
              Rank: A-TIER (Smart Money Institutional Core)
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 font-mono text-xs">
            <div className="bg-slate-950 p-3 rounded-lg border border-blue-800/60 space-y-1">
              <span className="text-[10px] text-blue-400 font-bold block">
                1. MARKET STRUCTURE (BOS / CHoCH)
              </span>
              <div className="text-white font-bold">{tel.structure_event}</div>
              <div className="text-slate-400 text-[11px]">{tel.structure_sequence}</div>
              <div className="text-blue-300 text-[11px]">
                Structure Level: ${Number(tel.bos_level || 0).toFixed(precision)}
              </div>
            </div>

            <div className="bg-slate-950 p-3 rounded-lg border border-emerald-800/60 space-y-1">
              <span className="text-[10px] text-emerald-400 font-bold block">
                2. SUPPLY & DEMAND ZONES (UNFILLED ORDERS)
              </span>
              <div className="text-emerald-300 font-bold">
                Demand: ${Number(tel.demand_zone?.low || 0).toFixed(precision)} – ${Number(tel.demand_zone?.high || 0).toFixed(precision)}
              </div>
              <div className="text-rose-300 font-bold">
                Supply: ${Number(tel.supply_zone?.low || 0).toFixed(precision)} – ${Number(tel.supply_zone?.high || 0).toFixed(precision)}
              </div>
              <span className="text-[10px] text-slate-400 block">
                Shows the CAUSE of institutional impulses
              </span>
            </div>

            <div className="bg-slate-950 p-3 rounded-lg border border-amber-800/60 space-y-1">
              <span className="text-[10px] text-amber-400 font-bold block">
                3. VOLUME — THE TRUTH DETECTOR
              </span>
              <div className="text-white font-extrabold text-sm">
                {tel.volume_ratio}x Average Volume
              </div>
              <div className="text-amber-300 text-[11px]">{tel.volume_truth_verdict}</div>
              <span className="text-[10px] text-slate-400 block">
                Price can lie; Volume never lies
              </span>
            </div>

            <div className="bg-slate-950 p-3 rounded-lg border border-purple-800/60 space-y-1">
              <span className="text-[10px] text-purple-400 font-bold block">
                4. MARKET PROFILE / TPO (TIME BELL CURVE)
              </span>
              <div className="text-amber-300 font-bold">
                TPO POC Magnet: ${Number(tel.tpo_poc || 0).toFixed(precision)}
              </div>
              <div className="text-slate-200">
                70% VA: ${Number(tel.val || 0).toFixed(precision)} – ${Number(tel.vah || 0).toFixed(precision)}
              </div>
              <span className="text-[10px] text-purple-300 block">{tel.va_position}</span>
            </div>
          </div>
        </div>
      )}

      {strategyId === 'b_tier' && (
        <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="text-xs font-extrabold uppercase tracking-wider text-sky-400 flex items-center gap-1.5">
              <Shield className="w-4 h-4" />
              <span>B-Tier Live Telemetry: VWAP + Floor Pivot Points + 20/50/200 MA + S/R + 14-Period ATR Risk Hero</span>
            </span>
            <span className="text-[11px] font-mono text-sky-300 font-bold">
              Rank: B-TIER (Algorithmic & Bank Execution Benchmark)
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 font-mono text-xs">
            <div className="bg-slate-950 p-3 rounded-lg border border-sky-800/60 space-y-1">
              <span className="text-[10px] text-sky-400 font-bold block">
                1. SESSION VWAP (FAIR PRICE)
              </span>
              <div className="text-base font-extrabold text-white">
                ${Number(tel.vwap || 0).toFixed(precision)}
              </div>
              <span className="text-[10px] text-sky-300 block">{tel.vwap_status}</span>
            </div>

            <div className="bg-slate-950 p-3 rounded-lg border border-amber-800/60 space-y-1">
              <span className="text-[10px] text-amber-400 font-bold block">
                2. BOT PIVOT POINTS (P, R1/R2, S1/S2)
              </span>
              <div className="text-amber-300 font-bold">
                Central P: ${Number(tel.pivots?.p || 0).toFixed(precision)}
              </div>
              <div className="text-rose-300 text-[11px]">
                R1: ${Number(tel.pivots?.r1 || 0).toFixed(precision)} | R2: ${Number(tel.pivots?.r2 || 0).toFixed(precision)}
              </div>
              <div className="text-emerald-300 text-[11px]">
                S1: ${Number(tel.pivots?.s1 || 0).toFixed(precision)} | S2: ${Number(tel.pivots?.s2 || 0).toFixed(precision)}
              </div>
            </div>

            <div className="bg-slate-950 p-3 rounded-lg border border-purple-800/60 space-y-1">
              <span className="text-[10px] text-purple-400 font-bold block">
                3. 20 / 50 / 200 MOVING AVERAGES
              </span>
              <div className="text-slate-200 text-[11px]">
                20 MA: ${Number(tel.moving_averages?.ma20 || 0).toFixed(precision)}
              </div>
              <div className="text-slate-200 text-[11px]">
                50 MA: ${Number(tel.moving_averages?.ma50 || 0).toFixed(precision)}
              </div>
              <div className="text-purple-300 font-bold text-[11px]">
                200 MA: ${Number(tel.moving_averages?.ma200 || 0).toFixed(precision)}
              </div>
            </div>

            <div className="bg-slate-950 p-3 rounded-lg border border-blue-800/60 space-y-1">
              <span className="text-[10px] text-blue-400 font-bold block">
                4. MULTI-TOUCH S/R & PSYCH ROUND
              </span>
              <div className="text-emerald-300 text-[11px]">
                Support: ${Number(tel.sr_levels?.support || 0).toFixed(precision)}
              </div>
              <div className="text-rose-300 text-[11px]">
                Resistance: ${Number(tel.sr_levels?.resistance || 0).toFixed(precision)}
              </div>
              <div className="text-slate-300 text-[11px]">
                Psych Level: ${Number(tel.sr_levels?.psychological_round || 0).toFixed(precision)}
              </div>
            </div>

            <div className="bg-slate-950 p-3 rounded-lg border border-emerald-800/60 space-y-1">
              <span className="text-[10px] text-emerald-400 font-bold block">
                5. ATR (14) RISK MANAGEMENT HERO
              </span>
              <div className="text-white font-bold">
                ATR: ${Number(tel.atr_risk?.atr_14 || 0).toFixed(precision)} / bar
              </div>
              <div className="text-emerald-300 text-[11px]">
                Min 1.5x ATR SL: ${Number(tel.atr_risk?.recommended_sl_distance || 0).toFixed(precision)}
              </div>
              <span className="text-[10px] text-slate-400 block">
                {tel.atr_risk?.lot_sizing_guidance}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── SIDE-BY-SIDE EDUCATIONAL & LIVE EXECUTION RULES: WHEN TO TRADE & WHY vs WHEN TO WAIT & WHY ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* LEFT COLUMN: WHEN TO TRADE & WHY */}
        <div className="bg-emerald-950/15 border border-emerald-800/60 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-emerald-800/50 pb-2.5">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              <h4 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">
                WHEN TO TRADE & WHY (Exact Execution Rules)
              </h4>
            </div>
            <span className="text-[10px] font-mono bg-emerald-950 text-emerald-300 px-2 py-0.5 rounded border border-emerald-700">
              GREEN LIGHT CHECKLIST
            </span>
          </div>

          <div className="space-y-3">
            {Array.isArray(strat.when_to_trade) &&
              strat.when_to_trade.map((item: any, idx: number) => (
                <div
                  key={idx}
                  className="bg-slate-950/90 border border-slate-800 rounded-lg p-3 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-extrabold text-white flex items-center gap-1.5">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          item.met ? 'bg-emerald-400' : 'bg-amber-400'
                        }`}
                      />
                      {item.step}
                    </span>
                    <span
                      className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
                        item.met
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/60'
                          : 'bg-amber-950 text-amber-300 border border-amber-700/60'
                      }`}
                    >
                      {item.met ? '✓ CONFIRMED' : '⏳ PENDING'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    <strong className="text-emerald-400">WHY: </strong>
                    {item.why}
                  </p>
                  <div className="text-[11px] font-mono text-sky-300 bg-slate-900/90 px-2.5 py-1.5 rounded border border-slate-800">
                    📊 Live Telemetry: {item.live_reading}
                  </div>
                </div>
              ))}
          </div>
        </div>

        {/* RIGHT COLUMN: WHEN TO WAIT & WHY */}
        <div className="bg-rose-950/15 border border-rose-800/60 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-rose-800/50 pb-2.5">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
              <h4 className="text-sm font-extrabold uppercase tracking-wider text-amber-300">
                WHEN TO WAIT & WHY (Deadly Mistakes & Trap Filters)
              </h4>
            </div>
            <span className="text-[10px] font-mono bg-rose-950 text-rose-300 px-2 py-0.5 rounded border border-rose-700">
              CAPITAL PROTECTION
            </span>
          </div>

          <div className="space-y-3">
            {Array.isArray(strat.when_to_wait) &&
              strat.when_to_wait.map((item: any, idx: number) => (
                <div
                  key={idx}
                  className="bg-slate-950/90 border border-slate-800 rounded-lg p-3 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-extrabold text-rose-200 flex items-center gap-1.5">
                      <XCircle
                        className={`w-4 h-4 shrink-0 ${
                          item.triggered ? 'text-rose-400 animate-pulse' : 'text-slate-500'
                        }`}
                      />
                      {item.mistake}
                    </span>
                    <span
                      className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded shrink-0 ${
                        item.triggered
                          ? 'bg-rose-950 text-rose-300 border border-rose-700'
                          : 'bg-slate-900 text-emerald-400 border border-slate-800'
                      }`}
                    >
                      {item.triggered ? '⚠️ ACTIVE WARNING — WAIT' : '✓ CLEAR'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    <strong className="text-amber-400">WHY YOU MUST WAIT: </strong>
                    {item.why}
                  </p>
                  <div className="text-[11px] font-mono text-amber-300 bg-slate-900/90 px-2.5 py-1.5 rounded border border-slate-800">
                    🛡️ Institutional Rule: {item.action}
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* ── COMPLETE STRATEGY ENCYCLOPEDIA & TIER CONTEXT FOOTER ── */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 space-y-2 text-xs text-slate-300">
        <div className="flex items-center gap-2 font-extrabold text-white uppercase tracking-wider">
          <BookOpen className="w-4 h-4 text-blue-400" />
          <span>
            {strategyId === 'daily_sweep'
              ? 'Master Playbook Summary — JadeCap Daily Sweep & Swing Failure Pattern (SFP)'
              : 'Master Playbook Summary — Why S, A & B Tiers Beat C, D & F Tier Retail Indicators'}
          </span>
        </div>
        {strategyId === 'daily_sweep' ? (
          <p className="leading-relaxed text-slate-300">
            <strong>Core Institutional Secret:</strong> Every trade requires a counterparty. When an institution wants to buy or sell 1,000 to 5,000 lots, entering in the middle of a range causes massive slippage. Instead, they drive price beyond <strong>Previous Daily High/Low (PDH/PDL)</strong>, <strong>Previous Weekly High/Low (PWH/PWL)</strong>, or <strong>Asian Session Highs/Lows</strong> where retail stop-losses and breakout orders are clustered. Once those stops trigger into market orders and fill the institution&apos;s limit orders, price snaps back and <strong>closes back inside the range (Swing Failure Pattern)</strong>. Enter on the candle close back inside, place your Stop Loss strictly beyond the extreme wick of the sweep (allowing a 50% wick retrace), and target 50% Equilibrium (TP1) and the opposite liquidity pool (TP2).
          </p>
        ) : (
          <p className="leading-relaxed text-slate-300">
            <strong>Why We Only Trade S, A, and B Tiers:</strong> In <em>Ranking Every Trading Strategy From Worst to Best</em>, <strong>F-Tier</strong> (Moon Phases, Gann Angles, subjective Elliott Wave redraws), <strong>D-Tier</strong> (Parabolic SAR, Williams %R, CCI chop), and <strong>C-Tier</strong> (blindly fading RSI 70/30 or lagging MACD / Fibonacci lines in isolation) fail because they are lagging mathematical derivatives of price that ignore institutional volume and order flow. By combining <strong>S-Tier</strong> (Zero-Lag Price Action + Volume Profile HVN/LVN + Footprint Order Flow Absorption), <strong>A-Tier</strong> (Market Structure BOS/CHoCH + Supply/Demand Zones + Volume Truth Detector + Market Profile 70% Value Area &amp; POC), and <strong>B-Tier</strong> (VWAP Institutional Fair Value + Bot Pivot Points + 20/50/200 MA + Multi-Touch S/R + 14-Period ATR Risk Hero), you trade alongside bank algorithms with synchronized directional lock.
          </p>
        )}
      </div>
    </div>
  );
}
