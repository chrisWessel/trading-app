'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Calendar, Flame, ShieldAlert, Compass, Target, Shield, Clock,
  TrendingDown, TrendingUp, AlertTriangle, ArrowRight, CheckCircle2,
  XCircle, ExternalLink, RefreshCw, Filter, Sparkles, HelpCircle,
  ChevronDown, ChevronRight, Eye, Play, BarChart2, Radio, Info, Layers,
  ChevronUp, Zap, Check, Bell, Globe
} from 'lucide-react';
import { API_BASE_URL } from '@/lib/apiConfig';

export interface NewsStrategyPublish {
  setup: {
    type: string;
    direction: string;
    phase: string;
    confidence: number;
    entry_price: number;
    stop_loss: number;
    take_profit_1_5r: number;
    take_profit_fair: number;
    fair_price: number;
    risk_points: number;
    reward_points_1_5r: number;
    rr_ratio_1_5r: number;
    counter_wick_ratio: number;
    counter_wick_valid: boolean;
    counter_wick_notes: string;
    atr14: number;
  } | null;
  chartLines: Array<{
    price: number;
    color: string;
    title: string;
    lineWidth?: 1 | 2 | 3 | 4;
    lineStyle?: 0 | 1 | 2 | 3 | 4;
  }>;
}

export interface EconomicEvent {
  id: string;
  title: string;
  country: string;
  impact: 'High' | 'Medium' | 'Low' | 'Holiday';
  impact_color: 'red' | 'orange' | 'yellow' | 'gray';
  impact_weight: number;
  date_iso: string;
  date_str: string;
  date_cat?: string;
  date_iso_day?: string;
  time_str: string;
  time_et?: string;
  time_cat?: string;
  time_gmt?: string;
  time_stacked?: string;
  is_gold_mover?: boolean;
  is_crypto_mover?: boolean;
  impacted_assets?: string[];
  forecast: string;
  previous: string;
  actual: string;
  actual_sentiment: 'better' | 'worse' | 'neutral';
  market_impact_forecast?: string;
  gold_impact_notes?: string;
  crypto_impact_notes?: string;
  diff_minutes: number;
  status: 'UPCOMING' | 'RELEASING_SOON' | 'RELEASING_NOW' | 'RECENT' | 'PAST';
  countdown: string;
  is_red_folder: boolean;
}

interface AvailableDate {
  date_str: string;
  date_iso_day: string;
  total: number;
  high_count: number;
  diff_minutes: number;
}

interface MarkedCandle {
  tag: 'FAIR_PRICE' | 'NEWS_SPIKE' | 'ENTRY_TRIGGER';
  badge: string;
  price: number;
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  counter_wick_ratio?: number;
  counter_wick_valid?: boolean;
  role: string;
}

interface ProjectionStep {
  step: number;
  title: string;
  desc: string;
}

interface NewsAnalysisResponse {
  status: string;
  symbol: string;
  timeframe: string;
  data_source: string;
  current_price: number;
  active_news_event: EconomicEvent | null;
  upcoming_events: EconomicEvent[];
  all_relevant_events: EconomicEvent[];
  setup: NewsStrategyPublish['setup'];
  projection: {
    summary: string;
    steps: ProjectionStep[];
    target_price: number;
    ultimate_target: number;
  } | null;
  marked_candles: MarkedCandle[];
  chart_lines: NewsStrategyPublish['chartLines'];
}

interface NewsTradingPanelProps {
  symbol: string;
  timeframe: string;
  onPublish?: (data: NewsStrategyPublish) => void;
  onAutoFillTrade?: (tradeParams: any) => void;
}

type TimeZoneOption = 'STACKED' | 'CAT' | 'ET' | 'GMT';
type AssetCategoryFilter = 'GOLD' | 'ALL' | 'CRYPTO' | 'FOREX';

export default function NewsTradingPanel({
  symbol,
  timeframe,
  onPublish,
  onAutoFillTrade,
}: NewsTradingPanelProps) {
  const [data, setData] = useState<NewsAnalysisResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [calendarEvents, setCalendarEvents] = useState<EconomicEvent[]>([]);
  const [availableDates, setAvailableDates] = useState<AvailableDate[]>([]);
  const [calLoading, setCalLoading] = useState<boolean>(true);
  const [selectedDate, setSelectedDate] = useState<string>('ALL');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [impactFilter, setImpactFilter] = useState<'ALL' | 'HIGH_ONLY' | 'MED_HIGH'>('HIGH_ONLY');

  // Detect default asset category filter based on the active symbol
  const isGoldAsset = useMemo(() => {
    const s = symbol.toUpperCase();
    return s.includes('XAU') || s.includes('GOLD');
  }, [symbol]);

  const isCryptoAsset = useMemo(() => {
    const s = symbol.toUpperCase();
    return s.includes('BTC') || s.includes('ETH') || s.includes('SOL') || s.includes('REXT');
  }, [symbol]);

  const [assetFilter, setAssetFilter] = useState<AssetCategoryFilter>(() => {
    if (isGoldAsset) return 'GOLD';
    if (isCryptoAsset) return 'CRYPTO';
    return 'ALL';
  });

  // Time zone filter: Default to STACKED (CAT + ET) as requested
  const [timeZoneMode, setTimeZoneMode] = useState<TimeZoneOption>('STACKED');
  const [calendarTab, setCalendarTab] = useState<'feed' | 'webview'>('feed');
  const [showEducation, setShowEducation] = useState<boolean>(false);
  const [lastRefreshed, setLastRefreshed] = useState<string>('');

  // Update assetFilter automatically if user switches active symbol to/from Gold
  useEffect(() => {
    if (isGoldAsset) {
      setAssetFilter('GOLD');
    } else if (isCryptoAsset) {
      setAssetFilter('CRYPTO');
    }
  }, [isGoldAsset, isCryptoAsset]);

  const fetchAnalysis = useCallback(async () => {
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/news/analysis?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}`,
        { cache: 'no-store' }
      );
      if (res.ok) {
        const json: NewsAnalysisResponse = await res.json();
        setData(json);
        if (onPublish) {
          onPublish({
            setup: json.setup,
            chartLines: json.chart_lines || [],
          });
        }
      }
    } catch (e) {
      console.error('Error fetching news analysis:', e);
    } finally {
      setLoading(false);
    }
  }, [symbol, timeframe, onPublish]);

  const fetchCalendar = useCallback(async () => {
    setCalLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/news/calendar`, { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        setCalendarEvents(json.events || []);
        if (json.available_dates) {
          setAvailableDates(json.available_dates);
        }
      }
    } catch (e) {
      console.error('Error fetching calendar:', e);
    } finally {
      setCalLoading(false);
      const d = new Date();
      setLastRefreshed(`${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`);
    }
  }, []);

  useEffect(() => {
    fetchAnalysis();
    fetchCalendar();
    const interval = setInterval(fetchAnalysis, 8000);
    const calInterval = setInterval(fetchCalendar, 45000);
    return () => {
      clearInterval(interval);
      clearInterval(calInterval);
    };
  }, [fetchAnalysis, fetchCalendar]);

  // Filtered calendar events based on Asset Class, Date, and Impact
  const filteredEvents = useMemo(() => {
    return calendarEvents.filter((ev) => {
      // 1. Asset Class Filter
      if (assetFilter === 'GOLD') {
        const isGoldMover = ev.is_gold_mover || ev.country === 'USD' || ev.title.toLowerCase().includes('gold');
        if (!isGoldMover) return false;
      } else if (assetFilter === 'CRYPTO') {
        const isCryptoMover = ev.is_crypto_mover || (ev.country === 'USD' && ['cpi', 'rate', 'fomc', 'nfp', 'payroll', 'gdp'].some(k => ev.title.toLowerCase().includes(k)));
        if (!isCryptoMover) return false;
      } else if (assetFilter === 'FOREX') {
        // Exclude generic crypto if needed, show all foreign exchange currencies
        const isFx = ['EUR', 'GBP', 'USD', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD'].includes(ev.country);
        if (!isFx) return false;
      }

      // 2. Date Filter
      if (selectedDate === 'UPCOMING_ONLY') {
        if (ev.diff_minutes < -15) return false;
      } else if (selectedDate !== 'ALL') {
        if (ev.date_str !== selectedDate && ev.date_iso_day !== selectedDate && ev.date_cat !== selectedDate) return false;
      }

      // 3. Impact Filter
      if (impactFilter === 'HIGH_ONLY' && ev.impact !== 'High') return false;
      if (impactFilter === 'MED_HIGH' && ev.impact !== 'High' && ev.impact !== 'Medium') return false;

      return true;
    });
  }, [calendarEvents, assetFilter, selectedDate, impactFilter]);

  // Nearest upcoming high-impact event
  const nextHighImpact = useMemo(() => {
    return calendarEvents.find((e) => e.impact === 'High' && e.diff_minutes >= -5);
  }, [calendarEvents]);

  // Event currently selected for inspection / forecasting details
  const inspectedEvent = useMemo<EconomicEvent | null>(() => {
    if (selectedEventId) {
      const found = calendarEvents.find((e) => e.id === selectedEventId);
      if (found) return found;
    }
    // If Gold mode is active, prioritize next Gold mover
    if (assetFilter === 'GOLD') {
      const goldNext = calendarEvents.find((e) => e.is_gold_mover && e.impact === 'High' && e.diff_minutes >= -5);
      if (goldNext) return goldNext;
    }
    return nextHighImpact || calendarEvents.find((e) => e.diff_minutes >= -15) || calendarEvents[0] || null;
  }, [selectedEventId, calendarEvents, assetFilter, nextHighImpact]);

  const setup = data?.setup;
  const projection = data?.projection;
  const isLong = setup?.direction === 'BUY/LONG';
  const isShort = setup?.direction === 'SELL/SHORT';
  const isEntryReady = setup?.phase === 'ENTRY_READY';

  const handleCopyLevelsToPaperTrade = () => {
    if (!setup || !onAutoFillTrade) return;
    onAutoFillTrade({
      symbol,
      signalType: isShort ? 'SELL/SHORT' : 'BUY/LONG',
      entryPrice: setup.entry_price,
      stopLoss: setup.stop_loss,
      takeProfit: setup.take_profit_1_5r,
      setupName: `News Fair Price Reversion (${setup.direction})`,
      rationale: `JJ Simon News Strategy: Fair Price at ${setup.fair_price}, Counter-Wick at ${setup.counter_wick_ratio}%, 1.5R Target`,
    });
  };

  // Helper to format event times based on active timezone selection
  const renderTimeCell = (ev: EconomicEvent) => {
    const cat = ev.time_cat || `${ev.time_str.replace(' ET', '')} CAT`;
    const et = ev.time_et || ev.time_str;
    const gmt = ev.time_gmt || `${ev.time_str.replace(' ET', '')} GMT`;

    if (timeZoneMode === 'CAT') {
      return (
        <div className="flex flex-col">
          <span className="font-bold text-amber-300 text-xs">{cat}</span>
          <span className="text-[10px] text-slate-500 font-mono">CAT (Harare)</span>
        </div>
      );
    }
    if (timeZoneMode === 'ET') {
      return (
        <div className="flex flex-col">
          <span className="font-bold text-blue-300 text-xs">{et}</span>
          <span className="text-[10px] text-slate-500 font-mono">ET (New York)</span>
        </div>
      );
    }
    if (timeZoneMode === 'GMT') {
      return (
        <div className="flex flex-col">
          <span className="font-bold text-slate-200 text-xs">{gmt}</span>
          <span className="text-[10px] text-slate-500 font-mono">GMT / UTC</span>
        </div>
      );
    }

    // Default: STACKED (CAT on top in Amber, ET below in Slate)
    return (
      <div className="flex flex-col leading-tight">
        <span className="font-bold text-amber-300 text-xs">
          {cat}
        </span>
        <span className="text-[10px] text-slate-400 font-mono">
          {et}
        </span>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4 text-slate-100">
      {/* ── TOP BANNER: Real-Time News Strategy Action Card ── */}
      <div className={`p-4 rounded-xl border transition-all ${
        isEntryReady
          ? isLong
            ? 'bg-gradient-to-r from-emerald-950/80 via-slate-900 to-emerald-950/80 border-emerald-500/50 shadow-lg shadow-emerald-950/40'
            : 'bg-gradient-to-r from-rose-950/80 via-slate-900 to-rose-950/80 border-rose-500/50 shadow-lg shadow-rose-950/40'
          : setup?.direction === 'WAIT'
            ? 'bg-slate-900/90 border-slate-800'
            : 'bg-amber-950/40 border-amber-500/40'
      }`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-lg ${
              isEntryReady
                ? isLong ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                : 'bg-amber-500/20 text-amber-400'
            }`}>
              {isLong ? <TrendingUp className="w-6 h-6" /> : isShort ? <TrendingDown className="w-6 h-6" /> : <Clock className="w-6 h-6" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs uppercase tracking-wider font-bold text-slate-400">
                  JJ SIMON FAIR PRICE NEWS STRATEGY
                </span>
                {isGoldAsset && (
                  <span className="px-2 py-0.5 text-[10px] font-black rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                    🥇 GOLD (XAU/USD) MODE
                  </span>
                )}
                {isCryptoAsset && (
                  <span className="px-2 py-0.5 text-[10px] font-black rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                    ⚡ CRYPTO MODE
                  </span>
                )}
                <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full ${
                  isEntryReady
                    ? 'bg-emerald-500 text-slate-950 font-black animate-pulse'
                    : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                }`}>
                  {setup?.phase.replace(/_/g, ' ') || 'ANALYZING'}
                </span>
              </div>
              <h2 className="text-lg font-black tracking-tight text-white flex items-center gap-2">
                {isEntryReady
                  ? `${setup?.direction === 'BUY/LONG' ? '🟢 BUY / LONG' : '🔴 SELL / SHORT'} ENTRY CONFIRMED`
                  : setup?.direction === 'WAIT'
                    ? 'STANDBY: TRADING AT FAIR PRICE EQUILIBRIUM'
                    : 'IMPULSE ACTIVE: AWAITING EXHAUSTION DISPLACEMENT'}
                <span className="text-xs font-normal text-slate-400">
                  ({setup?.confidence || 0}% Win-Probability Metric)
                </span>
              </h2>
            </div>
          </div>

          {/* Action Button: Auto-fill Trade */}
          {setup && setup.direction !== 'WAIT' && (
            <button
              onClick={handleCopyLevelsToPaperTrade}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold text-xs shadow-md shadow-blue-900/40 transition active:scale-95"
            >
              <Play className="w-4 h-4 fill-white" />
              Pre-fill in Paper Desk
            </button>
          )}
        </div>

        {/* Trade Execution Metrics Row */}
        {setup && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 mt-3 pt-3 border-t border-slate-800 text-xs font-mono">
            {/* Entry Price */}
            <div className="bg-slate-950/70 p-2.5 rounded-lg border border-slate-800">
              <span className="text-[10px] text-slate-400 block font-sans">RECOMMENDED ENTRY</span>
              <span className="text-sm font-bold text-blue-400">
                ${setup.entry_price > 0 ? setup.entry_price.toFixed(2) : '---'}
              </span>
            </div>

            {/* Stop Loss with ATR */}
            <div className="bg-slate-950/70 p-2.5 rounded-lg border border-rose-900/40">
              <span className="text-[10px] text-rose-400 block font-sans">STOP LOSS (ATR BUFFER)</span>
              <span className="text-sm font-bold text-rose-300">
                ${setup.stop_loss > 0 ? setup.stop_loss.toFixed(2) : '---'}
              </span>
              <span className="text-[9px] text-slate-500 block">Risk: {setup.risk_points.toFixed(2)} pts</span>
            </div>

            {/* 1.5R Take Profit */}
            <div className="bg-slate-950/70 p-2.5 rounded-lg border border-emerald-900/40">
              <span className="text-[10px] text-emerald-400 block font-sans">TARGET 1 (1.5R PROJECTION)</span>
              <span className="text-sm font-bold text-emerald-300">
                ${setup.take_profit_1_5r > 0 ? setup.take_profit_1_5r.toFixed(2) : '---'}
              </span>
              <span className="text-[9px] text-emerald-500/80 block">Reward: {setup.reward_points_1_5r.toFixed(2)} pts (1:{setup.rr_ratio_1_5r})</span>
            </div>

            {/* Pre-News Fair Price Magnet */}
            <div className="bg-slate-950/70 p-2.5 rounded-lg border border-amber-900/40">
              <span className="text-[10px] text-amber-400 block font-sans">PRE-NEWS FAIR PRICE</span>
              <span className="text-sm font-bold text-amber-300">
                ${setup.fair_price > 0 ? setup.fair_price.toFixed(2) : '---'}
              </span>
              <span className="text-[9px] text-amber-500/80 block">Institutional Equilibrium</span>
            </div>

            {/* Counter-Wick 20% Rule Meter */}
            <div className={`p-2.5 rounded-lg border ${
              setup.counter_wick_valid
                ? 'bg-slate-950/70 border-emerald-600/50'
                : 'bg-rose-950/30 border-rose-600/50'
            }`}>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-400 font-sans">COUNTER-WICK RULE</span>
                <span className={`text-[10px] font-black ${setup.counter_wick_valid ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {setup.counter_wick_ratio}% {setup.counter_wick_valid ? '✓ PASS' : '✗ FAIL'}
                </span>
              </div>
              <div className="w-full bg-slate-800 h-1.5 rounded-full mt-1.5 overflow-hidden">
                <div
                  className={`h-full rounded-full ${setup.counter_wick_valid ? 'bg-emerald-500' : 'bg-rose-500'}`}
                  style={{ width: `${Math.min(setup.counter_wick_ratio, 100)}%` }}
                />
              </div>
              <span className="text-[9px] text-slate-500 block mt-1">Must be &le; 20% of range</span>
            </div>
          </div>
        )}
      </div>

      {/* ── 2-COLUMN SECTION: MARKET PROJECTION & MARKED CANDLES ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Market Direction & Path Projection */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Compass className="w-4 h-4 text-blue-400" />
                <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wide">
                  Projected Market Direction & Trajectory
                </h3>
              </div>
              <span className="text-[10px] font-mono text-slate-400">
                Expected Path
              </span>
            </div>

            <div className="my-3 p-3 bg-slate-950 rounded-lg border border-slate-800">
              <div className="flex items-center gap-2">
                <Target className="w-4 h-4 text-emerald-400 shrink-0" />
                <div className="text-xs font-bold text-white">
                  {projection?.summary || 'Analyzing price vector...'}
                </div>
              </div>
              <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                {setup?.direction === 'SELL/SHORT'
                  ? 'Price tapped high premium liquidity following the news injection and met strong rejection. The market is projected to revert back toward pre-news Fair Price.'
                  : setup?.direction === 'BUY/LONG'
                    ? 'Price swept discount sell stops on the news drop and snapped back with heavy buying displacement. Projected to mean-revert toward pre-news Fair Price.'
                    : 'Market is holding near pre-news baseline. Stand by for the news catalyst to initiate liquidity grab before triggering the mean-reversion move.'}
              </p>
            </div>

            {/* Stepper Roadmap */}
            <div className="space-y-2.5">
              {projection?.steps.map((st) => (
                <div key={st.step} className="flex items-start gap-2.5 text-xs">
                  <div className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-950 border border-blue-600/60 text-blue-300 font-bold text-[10px] shrink-0 mt-0.5">
                    {st.step}
                  </div>
                  <div>
                    <span className="font-bold text-slate-200 block text-xs">{st.title}</span>
                    <span className="text-[11px] text-slate-400 leading-snug">{st.desc}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
            <span className="flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-slate-500" />
              Dynamic Invalidation: Stop Loss at structural wick extreme + 0.5 ATR
            </span>
            <span className="font-mono text-emerald-400 font-bold">Target 1: 1.5R</span>
          </div>
        </div>

        {/* Marked Candles Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-amber-400" />
                <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wide">
                  Marked Strategy Candles (JJ Simon Anchors)
                </h3>
              </div>
              <span className="text-[10px] font-mono text-slate-400">
                1-Minute Precision
              </span>
            </div>

            <p className="text-[11px] text-slate-400 my-2">
              The engine marks key institutional candles on your chart to execute without emotion:
            </p>

            <div className="space-y-2 mt-2">
              {data?.marked_candles.map((mc, idx) => (
                <div key={idx} className="bg-slate-950 p-2.5 rounded-lg border border-slate-800/80">
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                      mc.tag === 'FAIR_PRICE'
                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        : mc.tag === 'NEWS_SPIKE'
                          ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                          : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                    }`}>
                      {mc.badge}
                    </span>
                    <span className="text-xs font-mono font-bold text-white">
                      ${mc.price.toFixed(2)}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {mc.role}
                  </div>
                  <div className="grid grid-cols-4 gap-1 text-[10px] font-mono text-slate-500 mt-1.5 pt-1 border-t border-slate-900">
                    <span>O: {mc.open.toFixed(2)}</span>
                    <span>H: {mc.high.toFixed(2)}</span>
                    <span>L: {mc.low.toFixed(2)}</span>
                    <span>C: {mc.close.toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-3 pt-2 text-[10px] text-slate-500 flex items-center justify-between">
            <span>Chart overlays: Gold = Fair Price, Purple = Spike High/Low, Blue = Entry</span>
            <span className="text-amber-400 font-bold">Auto-plotted on TradingView above</span>
          </div>
        </div>
      </div>

      {/* ── FOREX FACTORY NEWS EMBEDDED VIEWER (IN-APP) ── */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        {/* Calendar Header with Controls */}
        <div className="p-3.5 bg-slate-950 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-red-500/20 text-red-400">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white tracking-wide">
                  ECONOMIC CATALYST CALENDAR & ACTUAL RELEASES
                </h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-300 border border-red-500/30 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                  LIVE PARSED FEED
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Gold & Metals • Crypto • Forex Releases with CAT & ET Timezones and Live Actual Prints
              </p>
            </div>
          </div>

          {/* Timezone Switcher & View Mode Toggle */}
          <div className="flex flex-wrap items-center gap-2">
            {/* TIMEZONE SELECTOR */}
            <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800 text-xs font-mono">
              <span className="text-slate-400 px-1 text-[11px] flex items-center gap-1">
                <Clock className="w-3 h-3 text-amber-400" /> TZ:
              </span>
              <button
                onClick={() => setTimeZoneMode('STACKED')}
                title="Display both Central Africa Time (CAT) and New York Time (ET) stacked"
                className={`px-2 py-1 rounded text-[11px] font-bold transition ${
                  timeZoneMode === 'STACKED'
                    ? 'bg-amber-500 text-slate-950 shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                🥞 Stacked (CAT + ET)
              </button>
              <button
                onClick={() => setTimeZoneMode('CAT')}
                title="Central Africa Time (Harare / Johannesburg UTC+2)"
                className={`px-2 py-1 rounded text-[11px] font-bold transition ${
                  timeZoneMode === 'CAT'
                    ? 'bg-amber-500 text-slate-950 shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                🇿🇼 CAT
              </button>
              <button
                onClick={() => setTimeZoneMode('ET')}
                title="Eastern Time (New York / Wall Street)"
                className={`px-2 py-1 rounded text-[11px] font-bold transition ${
                  timeZoneMode === 'ET'
                    ? 'bg-blue-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                🇺🇸 ET
              </button>
              <button
                onClick={() => setTimeZoneMode('GMT')}
                title="Greenwich Mean Time (UTC)"
                className={`px-2 py-1 rounded text-[11px] font-bold transition ${
                  timeZoneMode === 'GMT'
                    ? 'bg-blue-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                🌐 GMT
              </button>
            </div>

            {/* View Mode Toggle */}
            <div className="flex bg-slate-900 p-0.5 rounded-lg border border-slate-800 text-xs">
              <button
                onClick={() => setCalendarTab('feed')}
                className={`px-3 py-1 rounded-md font-bold transition ${
                  calendarTab === 'feed'
                    ? 'bg-blue-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                📊 Interactive Feed
              </button>
              <button
                onClick={() => setCalendarTab('webview')}
                className={`px-3 py-1 rounded-md font-bold transition flex items-center gap-1 ${
                  calendarTab === 'webview'
                    ? 'bg-blue-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Eye className="w-3.5 h-3.5" />
                Institutional Widget
              </button>
            </div>

            <button
              onClick={fetchCalendar}
              disabled={calLoading}
              title="Refresh Forex Factory news"
              className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 transition"
            >
              <RefreshCw className={`w-4 h-4 ${calLoading ? 'animate-spin text-blue-400' : ''}`} />
            </button>
          </div>
        </div>

        {/* Next Major Catalyst Alert Ribbon with Dual CAT & ET Times */}
        {nextHighImpact && (
          <div className="bg-gradient-to-r from-red-950/60 via-slate-900 to-red-950/60 px-4 py-2 border-b border-red-900/40 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="p-1 bg-red-500/20 rounded text-red-400 font-bold text-[10px]">
                🚨 NEXT HIGH-IMPACT RELEASE
              </span>
              <span className="font-bold text-white font-mono">{nextHighImpact.country} {nextHighImpact.title}</span>
              <span className="text-amber-300 font-mono font-bold text-xs">
                ({nextHighImpact.time_cat || nextHighImpact.time_str})
              </span>
              <span className="text-slate-400 font-mono text-xs">
                · {nextHighImpact.time_et}
              </span>
              {nextHighImpact.is_gold_mover && (
                <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold text-[10px] border border-amber-500/30">
                  🥇 GOLD MOVER
                </span>
              )}
              {nextHighImpact.is_crypto_mover && (
                <span className="px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-bold text-[10px] border border-cyan-500/30">
                  ⚡ CRYPTO MOVER
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-400">Countdown:</span>
              <span className="px-2 py-0.5 rounded bg-red-600 text-white font-mono font-black text-xs animate-pulse">
                {nextHighImpact.countdown}
              </span>
            </div>
          </div>
        )}

        {/* ── UPCOMING FORECAST & REPRICING DETAILS CARD (HIGHLIGHTED EVENT) ── */}
        {inspectedEvent && (
          <div className="mx-4 mt-4 p-4 rounded-xl bg-slate-950 border border-slate-800 shadow-inner">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className={`px-2.5 py-1 rounded-md text-xs font-black uppercase tracking-wide ${
                  inspectedEvent.impact === 'High'
                    ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                    : inspectedEvent.impact === 'Medium'
                      ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                      : 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30'
                }`}>
                  {inspectedEvent.country} · {inspectedEvent.impact} Impact
                </span>
                <h4 className="text-sm font-bold text-white">
                  {inspectedEvent.title}
                </h4>

                {inspectedEvent.is_gold_mover && (
                  <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-black">
                    🥇 GOLD (XAU/USD) CATALYST
                  </span>
                )}
                {inspectedEvent.is_crypto_mover && (
                  <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-[10px] font-black">
                    ⚡ CRYPTO DRIVER
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 text-xs font-mono">
                <span className="text-amber-300 font-bold">{inspectedEvent.time_cat || inspectedEvent.time_str}</span>
                <span className="text-slate-400">({inspectedEvent.time_et})</span>
                <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                  inspectedEvent.status === 'RELEASING_NOW'
                    ? 'bg-red-600 text-white animate-pulse'
                    : inspectedEvent.status === 'RELEASING_SOON'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      : inspectedEvent.status === 'UPCOMING'
                        ? 'bg-blue-950 text-blue-300 border border-blue-800'
                        : 'bg-slate-800 text-slate-300'
                }`}>
                  {inspectedEvent.countdown}
                </span>
              </div>
            </div>

            {/* 3-Column Metrics: Previous vs Forecast vs Actual */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 my-3">
              <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                <span className="text-[10px] text-slate-500 block uppercase font-bold">PREVIOUS PRINT</span>
                <span className="text-base font-bold font-mono text-slate-300">{inspectedEvent.previous || '—'}</span>
              </div>

              <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                <span className="text-[10px] text-slate-500 block uppercase font-bold">CONSENSUS FORECAST</span>
                <span className="text-base font-bold font-mono text-blue-400">{inspectedEvent.forecast || '—'}</span>
              </div>

              <div className={`p-2.5 rounded-lg border ${
                inspectedEvent.actual !== '—'
                  ? inspectedEvent.actual_sentiment === 'better'
                    ? 'bg-emerald-950/40 border-emerald-600/50'
                    : inspectedEvent.actual_sentiment === 'worse'
                      ? 'bg-rose-950/40 border-rose-600/50'
                      : 'bg-slate-900 border-slate-700'
                  : 'bg-slate-900/60 border-slate-800'
              }`}>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-400 block uppercase font-bold">ACTUAL RELEASED</span>
                  {inspectedEvent.actual !== '—' && (
                    <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${
                      inspectedEvent.actual_sentiment === 'better'
                        ? 'bg-emerald-500 text-slate-950 font-black'
                        : inspectedEvent.actual_sentiment === 'worse'
                          ? 'bg-rose-500 text-white font-black'
                          : 'bg-slate-700 text-slate-300'
                    }`}>
                      {inspectedEvent.actual_sentiment === 'better' ? '▲ BEAT' : inspectedEvent.actual_sentiment === 'worse' ? '▼ MISS' : 'IN-LINE'}
                    </span>
                  )}
                </div>
                <span className={`text-base font-bold font-mono ${
                  inspectedEvent.actual !== '—'
                    ? inspectedEvent.actual_sentiment === 'better'
                      ? 'text-emerald-400'
                      : inspectedEvent.actual_sentiment === 'worse'
                        ? 'text-rose-400'
                        : 'text-white'
                    : 'text-slate-500'
                }`}>
                  {inspectedEvent.actual !== '—' ? inspectedEvent.actual : 'Pending Release'}
                </span>
              </div>
            </div>

            {/* Dedicated Gold & Metals Action Playbook */}
            {inspectedEvent.is_gold_mover && (
              <div className="p-3 mb-2 bg-amber-950/30 rounded-lg border border-amber-600/40 text-xs text-slate-200 space-y-1.5 font-sans">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-amber-400 font-bold text-xs uppercase tracking-wide">
                    <Flame className="w-4 h-4 text-amber-400" />
                    <span>🥇 GOLD (XAU/USD) CATALYST PLAYBOOK & PRICE ACTION REPRICING</span>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono font-bold text-[10px] border border-amber-500/30">
                    Expected Range: 15.0 - 35.0 Points ($15 - $35/oz)
                  </span>
                </div>
                <p className="text-[11px] text-amber-100/90 leading-relaxed">
                  {inspectedEvent.gold_impact_notes || 'All USD high-impact events directly impact Gold. High inflation or strong payroll prints strengthen Dollar yields, pushing Gold downwards. Softer prints spark rapid dovish rallies.'}
                </p>
                <div className="text-[10px] text-amber-400/80 pt-1 border-t border-amber-800/40 flex items-center justify-between">
                  <span>JJ Simon Fair Price Rule: Mark candle at {inspectedEvent.time_cat || inspectedEvent.time_str} close $\to$ Fade after liquidity spike with counter-wick &le; 20%</span>
                  <span className="text-white font-bold">Target: 1.5R + Fair Price Magnet</span>
                </div>
              </div>
            )}

            {/* Dedicated Crypto Liquidity Impact Box */}
            {inspectedEvent.is_crypto_mover && (
              <div className="p-3 mb-2 bg-cyan-950/30 rounded-lg border border-cyan-600/40 text-xs text-slate-200 space-y-1 font-sans">
                <div className="flex items-center gap-1.5 text-cyan-400 font-bold text-xs uppercase tracking-wide">
                  <Sparkles className="w-4 h-4 text-cyan-400" />
                  <span>⚡ CRYPTO (BTC / ETH) MACRO LIQUIDITY IMPACT</span>
                </div>
                <p className="text-[11px] text-cyan-100/90 leading-relaxed">
                  {inspectedEvent.crypto_impact_notes || 'Bitcoin tracks global USD liquidity. Dovish releases fuel capital inflows; hawkish prints trigger fast long liquidations.'}
                </p>
              </div>
            )}

            {/* General Macro Sensitivity Note */}
            <div className="p-2.5 bg-blue-950/30 rounded-lg border border-blue-900/40 text-xs text-slate-300 font-sans flex items-center justify-between">
              <span className="text-[11px] text-slate-300">
                {inspectedEvent.market_impact_forecast || 'Macro catalyst expected to generate high orderbook volatility.'}
              </span>
              <span className="text-amber-400 font-bold text-[10px]">Click any row below to inspect its playbook</span>
            </div>
          </div>
        )}

        {/* Tab 1: Interactive Clean Feed */}
        {calendarTab === 'feed' && (
          <div className="p-4 space-y-3">
            {/* Filter Bar with Asset Class Selector, Date Dropdown, and Impact */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-slate-800 text-xs">
              {/* ASSET CLASS SELECTOR (GOLD, CRYPTO, FOREX, ALL) */}
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400 font-mono text-[11px] flex items-center gap-1 font-bold">
                  Asset Class:
                </span>
                <button
                  onClick={() => setAssetFilter('GOLD')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-black transition flex items-center gap-1.5 ${
                    assetFilter === 'GOLD'
                      ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-950/50'
                      : 'bg-slate-950 text-slate-300 hover:bg-slate-800 border border-slate-800'
                  }`}
                >
                  <span>🥇 Gold & Metals (XAU/USD)</span>
                </button>
                <button
                  onClick={() => setAssetFilter('CRYPTO')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-black transition flex items-center gap-1.5 ${
                    assetFilter === 'CRYPTO'
                      ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-950/50'
                      : 'bg-slate-950 text-slate-300 hover:bg-slate-800 border border-slate-800'
                  }`}
                >
                  <span>⚡ Crypto (BTC/ETH)</span>
                </button>
                <button
                  onClick={() => setAssetFilter('FOREX')}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1 ${
                    assetFilter === 'FOREX'
                      ? 'bg-blue-600 text-white shadow'
                      : 'bg-slate-950 text-slate-400 hover:bg-slate-800 border border-slate-800'
                  }`}
                >
                  <span>💱 Forex Majors</span>
                </button>
                <button
                  onClick={() => setAssetFilter('ALL')}
                  className={`px-2 py-1.5 rounded-lg text-xs font-bold transition ${
                    assetFilter === 'ALL'
                      ? 'bg-slate-700 text-white shadow'
                      : 'bg-slate-950 text-slate-400 hover:bg-slate-800 border border-slate-800'
                  }`}
                >
                  All Releases
                </button>
              </div>

              {/* Date Dropdown */}
              <div className="flex items-center gap-2">
                <span className="text-slate-400 font-mono text-[11px] flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-blue-400" /> Date:
                </span>
                <select
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="bg-slate-950 border border-slate-700 text-slate-200 rounded-lg px-2.5 py-1 text-xs font-mono font-bold hover:border-blue-500 focus:outline-none focus:border-blue-500 transition cursor-pointer"
                >
                  <option value="ALL">📅 All Dates (This Week)</option>
                  <option value="UPCOMING_ONLY">⏳ Upcoming Dates Only</option>
                  {availableDates.map((ad) => (
                    <option key={ad.date_str} value={ad.date_str}>
                      {ad.date_str} ({ad.total} events{ad.high_count > 0 ? ` · ${ad.high_count} Red` : ''})
                    </option>
                  ))}
                </select>
              </div>

              {/* Impact Filter */}
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400 font-mono text-[11px] flex items-center gap-1">
                  <Filter className="w-3 h-3 text-slate-500" /> Impact:
                </span>
                <button
                  onClick={() => setImpactFilter('HIGH_ONLY')}
                  className={`px-2 py-1 rounded text-[11px] font-bold ${
                    impactFilter === 'HIGH_ONLY'
                      ? 'bg-red-500 text-white'
                      : 'bg-slate-950 text-slate-400 hover:bg-slate-800 border border-slate-800'
                  }`}
                >
                  🔴 High (Red)
                </button>
                <button
                  onClick={() => setImpactFilter('MED_HIGH')}
                  className={`px-2 py-1 rounded text-[11px] font-bold ${
                    impactFilter === 'MED_HIGH'
                      ? 'bg-amber-500 text-slate-950'
                      : 'bg-slate-950 text-slate-400 hover:bg-slate-800 border border-slate-800'
                  }`}
                >
                  🟠 Med + High
                </button>
                <button
                  onClick={() => setImpactFilter('ALL')}
                  className={`px-2 py-1 rounded text-[11px] font-bold ${
                    impactFilter === 'ALL'
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-950 text-slate-400 hover:bg-slate-800 border border-slate-800'
                  }`}
                >
                  All
                </button>
              </div>
            </div>

            {/* Economic Events Table with Actuals and Multiple Timezones */}
            <div className="overflow-x-auto rounded-lg border border-slate-800 max-h-[440px] overflow-y-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-slate-950 sticky top-0 border-b border-slate-800 text-[10px] text-slate-400 uppercase z-10">
                  <tr>
                    <th className="py-2.5 px-3">
                      {timeZoneMode === 'STACKED' ? 'Time (CAT / ET)' : timeZoneMode === 'CAT' ? 'Time (CAT)' : timeZoneMode === 'ET' ? 'Time (ET)' : 'Time (GMT)'}
                    </th>
                    <th className="py-2.5 px-3">Impacted Assets & Cur</th>
                    <th className="py-2.5 px-3">Impact</th>
                    <th className="py-2.5 px-3">Event Title</th>
                    <th className="py-2.5 px-3 text-right">Actual</th>
                    <th className="py-2.5 px-3 text-right">Forecast</th>
                    <th className="py-2.5 px-3 text-right">Previous</th>
                    <th className="py-2.5 px-3 text-center">Status / Countdown</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-850 bg-slate-900/60">
                  {filteredEvents.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-slate-500 font-sans">
                        No economic releases matching the active filter ({assetFilter} · {impactFilter}).
                      </td>
                    </tr>
                  ) : (
                    filteredEvents.map((ev) => {
                      const isSelected = inspectedEvent?.id === ev.id;
                      return (
                        <tr
                          key={ev.id}
                          onClick={() => setSelectedEventId(ev.id)}
                          className={`cursor-pointer transition ${
                            isSelected
                              ? 'bg-blue-950/60 border-l-4 border-l-amber-500'
                              : ev.status === 'RELEASING_NOW'
                                ? 'bg-red-950/40 hover:bg-red-900/40'
                                : 'hover:bg-slate-800/60'
                          }`}
                        >
                          {/* TIME COLUMN (FORMATTED PER TIMEZONE MODE) */}
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <span className="text-[10px] text-slate-500 block">{ev.date_cat || ev.date_str}</span>
                            {renderTimeCell(ev)}
                          </td>

                          {/* IMPACTED ASSETS & CURRENCY COLUMN */}
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <div className="flex flex-col gap-1 items-start">
                              <span className="font-bold text-white text-xs">{ev.country}</span>
                              <div className="flex items-center gap-1 flex-wrap">
                                {ev.is_gold_mover && (
                                  <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-bold text-[9px] border border-amber-500/40">
                                    🥇 GOLD
                                  </span>
                                )}
                                {ev.is_crypto_mover && (
                                  <span className="px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-300 font-bold text-[9px] border border-cyan-500/40">
                                    ⚡ CRYPTO
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>

                          {/* IMPACT BADGE */}
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${
                              ev.impact === 'High'
                                ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                                : ev.impact === 'Medium'
                                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                                  : 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30'
                            }`}>
                              <span className={`w-2 h-2 rounded-full ${
                                ev.impact === 'High'
                                  ? 'bg-red-500'
                                  : ev.impact === 'Medium'
                                    ? 'bg-amber-500'
                                    : 'bg-yellow-400'
                              }`} />
                              {ev.impact}
                            </span>
                          </td>

                          {/* EVENT TITLE */}
                          <td className="py-2.5 px-3 text-white font-sans font-medium text-xs max-w-[260px] truncate">
                            <span className={isSelected ? 'text-amber-300 font-bold' : ''}>
                              {ev.title}
                            </span>
                          </td>

                          {/* ACTUAL COLUMN */}
                          <td className="py-2.5 px-3 text-right whitespace-nowrap">
                            {ev.actual !== '—' ? (
                              <span className={`inline-block px-2 py-0.5 rounded font-bold text-xs ${
                                ev.actual_sentiment === 'better'
                                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                                  : ev.actual_sentiment === 'worse'
                                    ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                                    : 'bg-slate-800 text-slate-200'
                              }`}>
                                {ev.actual} {ev.actual_sentiment === 'better' ? '▲' : ev.actual_sentiment === 'worse' ? '▼' : ''}
                              </span>
                            ) : (
                              <span className="text-slate-500 text-[11px]">—</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-300 whitespace-nowrap">
                            {ev.forecast}
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-400 whitespace-nowrap">
                            {ev.previous}
                          </td>
                          <td className="py-2.5 px-3 text-center whitespace-nowrap">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              ev.status === 'RELEASING_NOW'
                                ? 'bg-red-600 text-white animate-pulse'
                                : ev.status === 'RELEASING_SOON'
                                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                  : ev.status === 'UPCOMING'
                                    ? 'bg-blue-950 text-blue-300 border border-blue-800'
                                    : 'text-slate-500'
                            }`}>
                              {ev.countdown}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1">
              <span>Source: Forex Factory Live Data Feed (NFS & Live HTML Actuals) • Formatted in Central Africa Time (CAT) & New York Time (ET)</span>
              <span>Updated: {lastRefreshed || 'Just now'}</span>
            </div>
          </div>
        )}

        {/* Tab 2: Embedded Institutional Calendar Widget (With zero iframe blocks) */}
        {calendarTab === 'webview' && (
          <div className="p-4 space-y-3">
            <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-slate-300">
                  Institutional Dark-Theme Economic Calendar (Embed-authorized, live updating):
                </span>
              </div>
              <a
                href="https://www.forexfactory.com/calendar"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-md font-bold transition text-xs shadow"
              >
                <span>Open Forex Factory in Full Window</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>

            <div className="w-full h-[540px] rounded-lg border border-slate-800 overflow-hidden bg-slate-950 relative">
              <iframe
                src="https://s.tradingview.com/embed-widget/events/?locale=en#%7B%22colorTheme%22%3A%22dark%22%2C%22isTransparent%22%3Atrue%2C%22width%22%3A%22100%25%22%2C%22height%22%3A%22100%25%22%2C%22importanceFilter%22%3A%22-1%2C0%2C1%22%2C%22countryFilter%22%3A%22us%2Ceu%2Cgb%2Cjp%2Cau%2Cca%2Cch%2Cnz%22%7D"
                title="Institutional Economic Calendar"
                className="w-full h-full border-0"
              />
            </div>

            <p className="text-[10px] text-slate-500 italic">
              Note: Forex Factory uses browser security policies (`X-Frame-Options: SAMEORIGIN`) to prevent direct cross-domain embedding. Our terminal solves this by providing both the direct scraped feed with Actuals & Sentiments in the first tab and the embed-compatible TradingView Institutional Calendar above.
            </p>
          </div>
        )}
      </div>

      {/* ── EDUCATIONAL GUIDE ACCORDION (JJ Simon Framework Explained) ── */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <button
          onClick={() => setShowEducation(!showEducation)}
          className="w-full p-3.5 bg-slate-950 flex items-center justify-between text-left hover:bg-slate-900 transition"
        >
          <div className="flex items-center gap-2.5">
            <HelpCircle className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-bold text-white uppercase tracking-wider">
              JJ Simon $1.3M Strategy Breakdown & Rules Explained
            </span>
          </div>
          {showEducation ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
        </button>

        {showEducation && (
          <div className="p-4 space-y-4 text-xs text-slate-300 leading-relaxed border-t border-slate-800 bg-slate-950/60 font-sans">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="p-3 bg-slate-900 rounded-lg border border-slate-800">
                <h4 className="text-amber-400 font-bold mb-1 flex items-center gap-1.5">
                  <Target className="w-3.5 h-3.5" />
                  1. Pre-News "Fair Price" Anchor
                </h4>
                <p className="text-[11px] text-slate-400">
                  The candle body immediately before the high-impact release represents the agreed equilibrium price between buyers and sellers. When news is injected, algorithms violently displace price into premium or discount. 75%+ of these initial spikes are fake liquidity raids that mean-revert back to this exact Fair Price.
                </p>
              </div>

              <div className="p-3 bg-slate-900 rounded-lg border border-slate-800">
                <h4 className="text-rose-400 font-bold mb-1 flex items-center gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  2. The Counter-Wick 20% Rule
                </h4>
                <p className="text-[11px] text-slate-400">
                  JJ Simon's primary filter for entering after news: On the entry displacement candle, the wick pointing AGAINST your trade direction cannot exceed 20% of the candle's total range. If counter-wick &gt; 20%, it signals strong opposing institutional absorption and invalidates the entry.
                </p>
              </div>

              <div className="p-3 bg-slate-900 rounded-lg border border-slate-800">
                <h4 className="text-emerald-400 font-bold mb-1 flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5" />
                  3. Fixed 1.5R + Fair Price Projection
                </h4>
                <p className="text-[11px] text-slate-400">
                  Never gamble on 1:10 miracles during news. Placing your stop beyond the news spike extreme (+ 0.5 ATR buffer) and securing a fixed 1.5R profit creates unbeatable mathematical expectancy when coupled with a 75%+ win rate setup.
                </p>
              </div>
            </div>

            <div className="p-3 bg-blue-950/40 rounded-lg border border-blue-900/40 flex items-start gap-2.5">
              <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
              <div className="text-[11px] text-blue-200">
                <span className="font-bold text-white block">Why we don't trade during the release minute:</span>
                Spreads widen from 0.2 to 5.0+ points and brokers slip market orders by hundreds of dollars. By waiting 2 to 5 minutes for the spike to exhaust and the counter-wick displacement to confirm, you execute with tight spreads, deep liquidity, and institutional backing.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
