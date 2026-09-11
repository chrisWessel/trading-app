'use client';

import React, { useEffect, useState, useRef } from 'react';
import {
  TrendingUp, TrendingDown, Minus, Activity, CandlestickChart,
  RefreshCw, Zap, AlertTriangle, ChevronUp, ChevronDown,
} from 'lucide-react';
import { API_BASE_URL } from '@/lib/apiConfig';

// ─── Types ───────────────────────────────────────────────────────────────────

interface CandleSummary {
  label: string;
  direction: 'BULL' | 'BEAR';
  close: number;
  body_pct: number;
}

interface TrendData {
  direction: 'BULL' | 'BEAR' | 'NEUTRAL';
  strength: 'STRONG' | 'MODERATE' | 'WEAK';
  buyers_pct: number;
  sellers_pct: number;
  sma20: number;
  sma50: number;
  ema8: number;
  ema21: number;
  ema50: number;
  sma20_vs_sma50: 'BULL' | 'BEAR';
  price_vs_sma20: 'ABOVE' | 'BELOW';
  ema_stack: 'ALIGNED_BULL' | 'ALIGNED_BEAR' | 'MIXED';
  obi_score: number;
  continuation_signal: string;
  continuation_text: string;
}

interface CandleData {
  candle_type: 'BULLISH' | 'BEARISH' | 'DOJI';
  candle_pattern: string;
  body_ratio: number;
  upper_wick_pct: number;
  lower_wick_pct: number;
  candle_bias: 'BUYERS_IN_CONTROL' | 'SELLERS_IN_CONTROL' | 'INDECISION';
  candle_signal: 'BUY' | 'SELL' | 'WAIT';
  candle_signal_text: string;
  open: number;
  high: number;
  low: number;
  close: number;
  last_3_candles: CandleSummary[];
}

interface MarketBias {
  symbol: string;
  timeframe: string;
  latest_price: number;
  trend: TrendData;
  candle: CandleData;
  error?: string;
}

interface Props {
  symbol: string;
  timeframe: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PATTERN_DESCRIPTIONS: Record<string, string> = {
  HAMMER:         'Long lower wick — buyers rejected the sell-off strongly',
  SHOOTING_STAR:  'Long upper wick — sellers rejected the rally hard',
  ENGULFING_BULL: 'Bulls fully engulfed previous bear candle — reversal signal',
  ENGULFING_BEAR: 'Bears fully engulfed previous bull candle — reversal signal',
  PINBAR_BULL:    'Pinbar rejection from lows — strong buy pressure',
  PINBAR_BEAR:    'Pinbar rejection from highs — strong sell pressure',
  MARUBOZU_BULL:  'No wicks — pure bull conviction, buyers dominated entire candle',
  MARUBOZU_BEAR:  'No wicks — pure bear conviction, sellers dominated entire candle',
  INSIDE_BAR:     'Inside bar — consolidation, breakout expected next candle',
  DOJI:           'Indecision candle — equal buy and sell pressure, wait for next candle',
  NORMAL:         'Standard candle — no dominant reversal pattern',
};

function strengthColor(s: string) {
  if (s === 'STRONG')   return 'text-emerald-400';
  if (s === 'MODERATE') return 'text-amber-400';
  return 'text-slate-400';
}

function strengthBg(s: string) {
  if (s === 'STRONG')   return 'bg-emerald-500';
  if (s === 'MODERATE') return 'bg-amber-500';
  return 'bg-slate-600';
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function TrendCandlePanel({ symbol, timeframe }: Props) {
  const [activeTab, setActiveTab] = useState<'trend' | 'candle'>('trend');
  const [bias, setBias] = useState<MarketBias | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState('');
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchBias = async () => {
    try {
      setLoading(true);
      const res = await fetch(
        `${API_BASE_URL}/api/signals/market-bias?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}`
      );
      if (res.ok) {
        const data = await res.json();
        if (data.bias && !data.bias.error) {
          setBias(data.bias);
          setLastUpdate(new Date().toLocaleTimeString('en-US', {
            timeZone: 'Africa/Harare', hour12: true,
            hour: '2-digit', minute: '2-digit', second: '2-digit',
          }));
        }
      }
    } catch (_) {
      // silently fail — keep showing last known data
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBias();
    intervalRef.current = setInterval(fetchBias, 3000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [symbol, timeframe]);

  if (!bias) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl flex items-center justify-center gap-3 min-h-[180px]">
        <Activity className="w-5 h-5 text-blue-400 animate-pulse" />
        <span className="text-slate-400 text-sm font-mono">Analysing market bias for {symbol}…</span>
      </div>
    );
  }

  const { trend, candle } = bias;

  // Direction colours
  const isBull   = trend.direction === 'BULL';
  const isBear   = trend.direction === 'BEAR';
  const dirColor = isBull ? 'text-emerald-400' : isBear ? 'text-rose-400' : 'text-slate-400';
  const dirBg    = isBull
    ? 'bg-emerald-950 border-emerald-800'
    : isBear
    ? 'bg-rose-950 border-rose-800'
    : 'bg-slate-900 border-slate-700';

  const continuationBg =
    trend.continuation_signal === 'BUY_CONTINUATION'  ? 'bg-emerald-950/80 border-emerald-700' :
    trend.continuation_signal === 'SELL_CONTINUATION' ? 'bg-rose-950/80 border-rose-700' :
    trend.continuation_signal.startsWith('WEAK')      ? 'bg-amber-950/80 border-amber-700' :
                                                         'bg-slate-900 border-slate-700';
  const continuationText =
    trend.continuation_signal === 'BUY_CONTINUATION'  ? 'text-emerald-300' :
    trend.continuation_signal === 'SELL_CONTINUATION' ? 'text-rose-300' :
    trend.continuation_signal.startsWith('WEAK')      ? 'text-amber-300' :
                                                         'text-slate-400';

  // Candle colours
  const cIsBull    = candle.candle_signal === 'BUY';
  const cIsBear    = candle.candle_signal === 'SELL';
  const candleColor = cIsBull ? 'text-emerald-400' : cIsBear ? 'text-rose-400' : 'text-slate-400';
  const candleBg    = cIsBull
    ? 'bg-emerald-950 border-emerald-800'
    : cIsBear
    ? 'bg-rose-950 border-rose-800'
    : 'bg-slate-900 border-slate-700';
  const signalBg    = cIsBull
    ? 'bg-emerald-950/80 border-emerald-700 text-emerald-300'
    : cIsBear
    ? 'bg-rose-950/80 border-rose-700 text-rose-300'
    : 'bg-slate-900/80 border-slate-700 text-slate-400';

  const patternHR = (candle.candle_pattern || 'NORMAL').replace(/_/g, ' ');
  const patternDesc = PATTERN_DESCRIPTIONS[candle.candle_pattern] || 'Analysing candle structure…';

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="bg-gradient-to-tr from-violet-700 to-indigo-700 p-1.5 rounded-lg shadow-lg">
            <Activity className="w-4 h-4 text-white" />
          </div>
          <div>
            <h2 className="text-sm font-extrabold text-white tracking-tight">Market Bias Engine</h2>
            <p className="text-[10px] text-slate-500 font-mono">{symbol} · {timeframe.toUpperCase()} · Harare</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {loading && <RefreshCw className="w-3 h-3 text-blue-400 animate-spin" />}
          <span className="text-[10px] text-slate-500 font-mono">{lastUpdate}</span>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex border-b border-slate-800">
        <button
          onClick={() => setActiveTab('trend')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-bold transition border-b-2 ${
            activeTab === 'trend'
              ? 'border-violet-500 text-violet-300 bg-violet-950/30'
              : 'border-transparent text-slate-500 hover:text-slate-300'
          }`}
        >
          <TrendingUp className="w-3.5 h-3.5" />
          Trend Trading
        </button>
        <button
          onClick={() => setActiveTab('candle')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-bold transition border-b-2 ${
            activeTab === 'candle'
              ? 'border-amber-500 text-amber-300 bg-amber-950/30'
              : 'border-transparent text-slate-500 hover:text-slate-300'
          }`}
        >
          <CandlestickChart className="w-3.5 h-3.5" />
          Candle Trading
        </button>
      </div>

      {/* ── TAB 1: TREND TRADING ──────────────────────────────── */}
      {activeTab === 'trend' && (
        <div className="p-4 space-y-3">

          {/* Big direction badge */}
          <div className={`flex items-center justify-between rounded-xl border px-4 py-3 shadow-lg ${dirBg}`}>
            <div>
              <div className="text-[10px] text-slate-400 font-bold mb-0.5 uppercase tracking-widest">Market Trend</div>
              <div className={`text-2xl font-black tracking-tight ${dirColor} flex items-center gap-2`}>
                {isBull
                  ? <TrendingUp className="w-6 h-6" />
                  : isBear
                  ? <TrendingDown className="w-6 h-6" />
                  : <Minus className="w-6 h-6" />}
                {trend.direction}
              </div>
              <div className={`text-xs font-bold mt-0.5 ${strengthColor(trend.strength)}`}>
                {trend.strength} MOMENTUM
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-slate-400 mb-1.5">Strength</div>
              <div className="w-20 h-2.5 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${strengthBg(trend.strength)}`}
                  style={{ width: trend.strength === 'STRONG' ? '90%' : trend.strength === 'MODERATE' ? '55%' : '22%' }}
                />
              </div>
              <div className={`text-xs font-mono font-bold mt-1 ${strengthColor(trend.strength)}`}>
                {trend.strength === 'STRONG' ? '90%' : trend.strength === 'MODERATE' ? '55%' : '22%'}
              </div>
            </div>
          </div>

          {/* Buyer vs Seller Volume Split */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              <span>Volume Dominance (Last 20 Bars)</span>
              <span className="font-mono text-slate-500">${bias.latest_price.toFixed(2)}</span>
            </div>
            <div className="flex rounded-full overflow-hidden h-4 text-[9px] font-bold">
              <div
                className="bg-emerald-600 flex items-center justify-center text-white transition-all duration-700"
                style={{ width: `${trend.buyers_pct}%` }}
              >
                {trend.buyers_pct > 18 && `${trend.buyers_pct}%`}
              </div>
              <div
                className="bg-rose-600 flex items-center justify-center text-white transition-all duration-700"
                style={{ width: `${trend.sellers_pct}%` }}
              >
                {trend.sellers_pct > 18 && `${trend.sellers_pct}%`}
              </div>
            </div>
            <div className="flex justify-between text-[10px] font-bold">
              <span className="text-emerald-400">🟢 Buyers {trend.buyers_pct}%</span>
              <span className="text-rose-400">🔴 Sellers {trend.sellers_pct}%</span>
            </div>
          </div>

          {/* EMA & SMA Grid */}
          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 space-y-1">
              <div className="text-slate-500 font-bold uppercase tracking-wider">SMA Cross</div>
              <div className={`font-bold ${trend.sma20_vs_sma50 === 'BULL' ? 'text-emerald-400' : 'text-rose-400'}`}>
                SMA20 {trend.sma20_vs_sma50 === 'BULL' ? '>' : '<'} SMA50
              </div>
              <div className="text-slate-500 font-mono">{trend.sma20.toFixed(2)} / {trend.sma50.toFixed(2)}</div>
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 space-y-1">
              <div className="text-slate-500 font-bold uppercase tracking-wider">Price vs SMA20</div>
              <div className={`font-bold ${trend.price_vs_sma20 === 'ABOVE' ? 'text-emerald-400' : 'text-rose-400'}`}>
                {trend.price_vs_sma20} SMA20
              </div>
              <div className="text-slate-500 font-mono">@ {trend.sma20.toFixed(2)}</div>
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 space-y-1">
              <div className="text-slate-500 font-bold uppercase tracking-wider">EMA Stack 8/21/50</div>
              <div className={`font-bold ${
                trend.ema_stack === 'ALIGNED_BULL' ? 'text-emerald-400' :
                trend.ema_stack === 'ALIGNED_BEAR' ? 'text-rose-400' : 'text-amber-400'
              }`}>
                {trend.ema_stack === 'ALIGNED_BULL' ? '✅ BULL STACK' :
                 trend.ema_stack === 'ALIGNED_BEAR' ? '🔴 BEAR STACK' : '⚠️ MIXED'}
              </div>
              <div className="text-slate-500 font-mono">{trend.ema8.toFixed(2)} / {trend.ema21.toFixed(2)}</div>
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 space-y-1">
              <div className="text-slate-500 font-bold uppercase tracking-wider">Order Book OBI</div>
              <div className={`font-bold font-mono text-sm ${
                trend.obi_score > 0.1 ? 'text-emerald-400' :
                trend.obi_score < -0.1 ? 'text-rose-400' : 'text-slate-400'
              }`}>
                {trend.obi_score > 0 ? '+' : ''}{trend.obi_score.toFixed(3)}
              </div>
              <div className="text-slate-500">
                {trend.obi_score > 0.1 ? 'Bid Heavy' : trend.obi_score < -0.1 ? 'Ask Heavy' : 'Balanced'}
              </div>
            </div>
          </div>

          {/* Continuation Signal Banner */}
          <div className={`rounded-xl border px-4 py-3 text-xs font-bold flex items-center gap-2.5 ${continuationBg} ${continuationText}`}>
            <Zap className="w-4 h-4 flex-shrink-0" />
            <span className="leading-snug">{trend.continuation_text}</span>
          </div>
        </div>
      )}

      {/* ── TAB 2: CANDLE TRADING ─────────────────────────────── */}
      {activeTab === 'candle' && (
        <div className="p-4 space-y-3">

          {/* Current candle type badge */}
          <div className={`flex items-center justify-between rounded-xl border px-4 py-3 ${candleBg}`}>
            <div>
              <div className="text-[10px] text-slate-400 font-bold mb-0.5 uppercase tracking-widest">Current Candle</div>
              <div className={`text-2xl font-black tracking-tight ${candleColor}`}>
                {candle.candle_type}
              </div>
              <div className="text-xs text-slate-400 mt-0.5 font-bold">{patternHR}</div>
            </div>
            {/* Mini candle visual */}
            <div className="flex flex-col items-center gap-0">
              <div className="text-[9px] text-slate-500 mb-1">H/O/C/L</div>
              <div className="flex flex-col items-center" style={{ height: 60, width: 24 }}>
                <div
                  className={`w-px ${cIsBull ? 'bg-emerald-400' : cIsBear ? 'bg-rose-400' : 'bg-slate-500'}`}
                  style={{ height: `${Math.max(candle.upper_wick_pct * 0.5, 4)}px` }}
                />
                <div
                  className={`w-4 rounded-sm ${cIsBull ? 'bg-emerald-500' : cIsBear ? 'bg-rose-500' : 'bg-slate-500'}`}
                  style={{ height: `${Math.max(candle.body_ratio * 0.38, 5)}px` }}
                />
                <div
                  className={`w-px ${cIsBull ? 'bg-emerald-400' : cIsBear ? 'bg-rose-400' : 'bg-slate-500'}`}
                  style={{ height: `${Math.max(candle.lower_wick_pct * 0.5, 4)}px` }}
                />
              </div>
              <div className="text-[8px] text-slate-500 font-mono">{candle.close.toFixed(2)}</div>
            </div>
          </div>

          {/* Pattern description */}
          <div className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5">
            <div className="text-[10px] text-slate-500 font-bold uppercase mb-1">Pattern Insight</div>
            <p className="text-xs text-slate-300 leading-relaxed">{patternDesc}</p>
          </div>

          {/* Body / Wick breakdown */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2">
            <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Candle Structure</div>
            <div className="flex rounded-full overflow-hidden h-3.5 text-[8px] font-bold">
              <div
                className="bg-slate-600 flex items-center justify-center text-slate-300 transition-all"
                style={{ width: `${candle.upper_wick_pct}%` }}
              >
                {candle.upper_wick_pct > 12 && `${candle.upper_wick_pct}%`}
              </div>
              <div
                className={`flex items-center justify-center text-white font-bold transition-all ${
                  cIsBull ? 'bg-emerald-600' : cIsBear ? 'bg-rose-600' : 'bg-slate-500'
                }`}
                style={{ width: `${candle.body_ratio}%` }}
              >
                {candle.body_ratio > 18 && `${candle.body_ratio}%`}
              </div>
              <div
                className="bg-slate-700 flex items-center justify-center text-slate-300 transition-all"
                style={{ width: `${candle.lower_wick_pct}%` }}
              >
                {candle.lower_wick_pct > 12 && `${candle.lower_wick_pct}%`}
              </div>
            </div>
            <div className="flex justify-between text-[9px] text-slate-500 font-mono">
              <span>↑ {candle.upper_wick_pct}% wick</span>
              <span>{candle.body_ratio}% body</span>
              <span>{candle.lower_wick_pct}% wick ↓</span>
            </div>
          </div>

          {/* Last 3 candles */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
            <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-2">Last 3 Candles</div>
            <div className="grid grid-cols-3 gap-2">
              {candle.last_3_candles.map((c3, idx) => (
                <div
                  key={idx}
                  className={`rounded-lg border px-2 py-1.5 text-center ${
                    c3.direction === 'BULL'
                      ? 'bg-emerald-950/60 border-emerald-900'
                      : 'bg-rose-950/60 border-rose-900'
                  }`}
                >
                  <div className="text-[8px] text-slate-500 font-mono">{c3.label}</div>
                  <div className={`text-xs font-black flex items-center justify-center gap-0.5 ${
                    c3.direction === 'BULL' ? 'text-emerald-400' : 'text-rose-400'
                  }`}>
                    {c3.direction === 'BULL'
                      ? <ChevronUp className="w-3 h-3" />
                      : <ChevronDown className="w-3 h-3" />}
                    {c3.direction}
                  </div>
                  <div className="text-[9px] text-slate-400 font-mono">{c3.close.toFixed(2)}</div>
                  <div className="text-[8px] text-slate-600">{c3.body_pct}% body</div>
                </div>
              ))}
            </div>
          </div>

          {/* Candle Signal Banner */}
          <div className={`rounded-xl border px-4 py-3 text-xs font-bold flex items-center gap-2.5 ${signalBg}`}>
            {cIsBull
              ? <ChevronUp className="w-4 h-4 flex-shrink-0" />
              : cIsBear
              ? <ChevronDown className="w-4 h-4 flex-shrink-0" />
              : <AlertTriangle className="w-4 h-4 flex-shrink-0" />}
            <span className="leading-snug">{candle.candle_signal_text}</span>
          </div>
        </div>
      )}
    </div>
  );
}
