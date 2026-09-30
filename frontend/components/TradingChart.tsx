'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { RefreshCw, Zap, ChevronDown, Clock, Radio, ArrowUpRight, ArrowDownRight, Shield, Target, AlertOctagon, Activity, ArrowRightLeft, TrendingUp } from 'lucide-react';
import { API_BASE_URL } from '@/lib/apiConfig';
import ICTScalpPanel, { type IctPublish } from '@/components/ICTScalpPanel';
import SessionRibbon from '@/components/SessionRibbon';


export type ChartTabId = 'live_signals' | 'algo_market_structure' | 'ict_scalp';

interface TradingChartProps {
  symbol: string;
  timeframe: string;
  onTimeframeChange: (tf: string) => void;
  activeTab: ChartTabId;
  onActiveTabChange: (tab: ChartTabId) => void;
  onLatestDataUpdate?: (data: { price: number; support: number; resistance: number }) => void;
}

declare global {
  interface Window {
    TradingView: any;
  }
}

const QUICK_TIMEFRAMES = ['1s', '1m', '5m', '15m', '1h', '4h', '1d'];

const INTERVAL_CATEGORIES = [
  {
    category: 'SECONDS',
    items: [
      { tf: '1s', label: '1 second' },
      { tf: '5s', label: '5 seconds' },
      { tf: '15s', label: '15 seconds' },
      { tf: '30s', label: '30 seconds' },
    ],
  },
  {
    category: 'MINUTES',
    items: [
      { tf: '1m', label: '1 minute' },
      { tf: '2m', label: '2 minutes' },
      { tf: '3m', label: '3 minutes' },
      { tf: '5m', label: '5 minutes' },
      { tf: '15m', label: '15 minutes' },
      { tf: '30m', label: '30 minutes' },
      { tf: '45m', label: '45 minutes' },
    ],
  },
  {
    category: 'HOURS',
    items: [
      { tf: '1h', label: '1 hour' },
      { tf: '2h', label: '2 hours' },
      { tf: '4h', label: '4 hours' },
    ],
  },
  {
    category: 'DAYS & WEEKS',
    items: [
      { tf: '1d', label: '1 day' },
      { tf: '1w', label: '1 week' },
      { tf: '1M', label: '1 month' },
    ],
  },
];

// ── Map symbols to TradingView ticker format (identical to TradingViewDirectChart) ──
const getTradingViewSymbol = (sym: string): string => {
  const s = sym.toUpperCase().replace(' ', '').replace('/', '').replace('_', '');
  if (s.includes('XAU') || s.includes('GOLD')) return 'OANDA:XAUUSD';
  if (s.includes('PAXG')) return 'BINANCE:PAXGUSDT';
  if (s.includes('EURUSD')) return 'OANDA:EURUSD';
  if (s.includes('GBPUSD')) return 'OANDA:GBPUSD';
  if (s.includes('USDJPY')) return 'OANDA:USDJPY';
  if (s.includes('AUDUSD')) return 'OANDA:AUDUSD';
  if (s.includes('USDCAD')) return 'OANDA:USDCAD';
  if (s.includes('USDCHF')) return 'OANDA:USDCHF';
  if (s.includes('NZDUSD')) return 'OANDA:NZDUSD';
  if (s.includes('BTC')) return 'BINANCE:BTCUSDT';
  if (s.includes('ETH')) return 'BINANCE:ETHUSDT';
  if (s.includes('SOL')) return 'BINANCE:SOLUSDT';
  if (s.includes('REXT')) return 'GATEIO:REXTUSDT';
  return `OANDA:${s}`;
};

const getTradingViewInterval = (tf: string): string => {
  if (tf === '1s') return '1';
  if (tf === '1m') return '1';
  if (tf === '2m') return '3';
  if (tf === '3m') return '3';
  if (tf === '5m') return '5';
  if (tf === '15m') return '15';
  if (tf === '30m') return '30';
  if (tf === '45m') return '30';
  if (tf === '1h') return '60';
  if (tf === '2h') return '120';
  if (tf === '4h') return '240';
  if (tf === '1d') return 'D';
  if (tf === '1w') return 'W';
  if (tf === '1M') return 'M';
  return '5';
};

// ── TVWidgetTab Component for Tabs ──
export interface ChartExtraLine {
  price: number;
  color: string;
  title: string;
  lineWidth?: 1 | 2 | 3 | 4;
  lineStyle?: 0 | 1 | 2 | 3 | 4;
}

// Structural equality for a published ICT payload, so the parent only commits
// to a new object when something a chart line depends on actually changed.
function ictPublishEqual(a: IctPublish, b: IctPublish): boolean {
  const la = a.levels;
  const lb = b.levels;
  if ((la === null) !== (lb === null)) return false;
  if (la && lb && (
    la.direction !== lb.direction ||
    la.entry !== lb.entry ||
    la.stop_loss !== lb.stop_loss ||
    la.take_profit !== lb.take_profit
  )) return false;

  if (a.lines.length !== b.lines.length) return false;
  for (let i = 0; i < a.lines.length; i++) {
    if (a.lines[i].price !== b.lines[i].price || a.lines[i].title !== b.lines[i].title) return false;
  }

  return (
    a.session.inKillzone === b.session.inKillzone &&
    a.session.currentEt === b.session.currentEt &&
    a.session.name === b.session.name &&
    a.session.nextKillzone.countdown === b.session.nextKillzone.countdown
  );
}

function TVWidgetTab({ symbol, timeframe, tabId, instructions, studies, tradeLevels, extraLines }: { symbol: string, timeframe: string, tabId: string, instructions?: React.ReactNode, studies?: string[], tradeLevels?: { signalType: 'BUY/LONG' | 'SELL/SHORT'; entry: number; stopLoss: number; takeProfit: number; support?: number; resistance?: number } | null, extraLines?: ChartExtraLine[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string>(`tv_signal_widget_${tabId}_${Math.floor(Math.random() * 1000000)}`);
  const widgetRef = useRef<any>(null);
  const chartApiRef = useRef<any>(null);
  const priceLineIdsRef = useRef<any[]>([]);
  const extraLineIdsRef = useRef<any[]>([]);
  const [chartReady, setChartReady] = useState(false);
  const CHART_HEIGHT = 520;

  useEffect(() => {
    const scriptId = 'tradingview-widget-script';
    let script = document.getElementById(scriptId) as HTMLScriptElement | null;
    let loadPoll: NodeJS.Timeout | null = null;
    let readyPoll: NodeJS.Timeout | null = null;
    let cancelled = false;

    const tvSymbol = getTradingViewSymbol(symbol);
    const symbolKey = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const widgetStudies = studies ?? (['XAUUSD', 'XAU', 'GOLD'].includes(symbolKey)
      ? ['STD;Pivot Points High Low']
      : []);

    const initWidget = () => {
      const container = containerRef.current;
      if (cancelled || !window.TradingView || !container) return;
      try {
        container.innerHTML = `<div id="${widgetIdRef.current}" style="width:100%;height:100%;"></div>`;
        const w = new window.TradingView.widget({
          autosize: true,
          symbol: tvSymbol,
          interval: getTradingViewInterval(timeframe),
          timezone: 'Africa/Johannesburg',
          theme: 'dark',
          style: '1',
          locale: 'en',
          toolbar_bg: '#0F172A',
          enable_publishing: false,
          allow_symbol_change: false,
          hide_side_toolbar: false,
          hide_top_toolbar: true,
          details: false,
          hotlist: false,
          calendar: false,
          studies: widgetStudies,
          container_id: widgetIdRef.current,
        });
        widgetRef.current = w;

        const tryRegisterChartReady = () => {
          try {
            if (typeof w.on === 'function') {
              w.on('chartReady', () => {
                try {
                  const chart = w.chart();
                  if (chart && typeof chart.createPriceLine === 'function') {
                    chartApiRef.current = chart;
                    setChartReady(true);
                  }
                } catch {}
              });
              return true;
            }
          } catch {}
          return false;
        };

        if (!tryRegisterChartReady()) {
          // Older/newer tv.js builds return an instance without the event API,
          // so fall back to polling for the chart handle.
          if (typeof w.chart !== 'function') return;
          const pollStart = Date.now();
          readyPoll = setInterval(() => {
            if (cancelled) { if (readyPoll) clearInterval(readyPoll); return; }
            try {
              const chart = w.chart();
              if (chart && typeof chart.createPriceLine === 'function') {
                chartApiRef.current = chart;
                setChartReady(true);
                if (readyPoll) clearInterval(readyPoll);
              } else if (Date.now() - pollStart > 10000) {
                if (readyPoll) clearInterval(readyPoll);
              }
            } catch {}
          }, 100);
        }
      } catch {
        // A failed widget init must not take down the page.
        if (readyPoll) clearInterval(readyPoll);
      }
    };

    if (window.TradingView) {
      initWidget();
    } else {
      if (!script) {
        script = document.createElement('script');
        script.id = scriptId;
        script.src = 'https://s3.tradingview.com/tv.js';
        script.async = true;
        document.head.appendChild(script);
      }
      const startedAt = Date.now();
      loadPoll = setInterval(() => {
        if (window.TradingView) {
          if (loadPoll) clearInterval(loadPoll);
          initWidget();
        } else if (Date.now() - startedAt > 15000 && loadPoll) {
          clearInterval(loadPoll);
        }
      }, 50);
    }

    return () => {
      cancelled = true;
      if (loadPoll) clearInterval(loadPoll);
      if (readyPoll) clearInterval(readyPoll);
      setChartReady(false);
      priceLineIdsRef.current = [];
      extraLineIdsRef.current = [];
      chartApiRef.current = null;
      try { widgetRef.current?.remove?.(); } catch {}
      widgetRef.current = null;
      if (containerRef.current) containerRef.current.innerHTML = '';
    };
  }, [symbol, timeframe, tabId, studies]);

  useEffect(() => {
    if (!chartReady || !tradeLevels || tradeLevels.entry <= 0) return;
    const chart = chartApiRef.current;
    if (!chart) return;

    priceLineIdsRef.current.forEach(id => { try { chart.removePriceLine(id); } catch {} });
    priceLineIdsRef.current = [];

    const levels = tradeLevels;
    const isSell = levels.signalType === 'SELL/SHORT';
    const levelsAreDirectional = isSell
      ? levels.stopLoss > levels.entry && levels.takeProfit < levels.entry
      : levels.stopLoss < levels.entry && levels.takeProfit > levels.entry;
    if (!levelsAreDirectional) return;

    const tryCreate = (price: number, color: string, title: string) => {
      try {
        const id = chart.createPriceLine({ price, color, lineWidth: 2, lineStyle: 1, axisLabelVisible: true, title });
        priceLineIdsRef.current.push(id);
      } catch {}
    };

    tryCreate(levels.entry, isSell ? '#f43f5e' : '#3b82f6', isSell ? 'SELL ENTRY' : 'BUY ENTRY');
    tryCreate(levels.stopLoss, '#f43f5e', 'STOP LOSS');
    tryCreate(levels.takeProfit, '#10b981', isSell ? 'TAKE PROFIT · BUY BACK' : 'TAKE PROFIT · SELL');
    if (levels.support && levels.support > 0) tryCreate(levels.support, '#22c55e', 'SUPPORT');
    if (levels.resistance && levels.resistance > 0) tryCreate(levels.resistance, '#f97316', 'RESISTANCE');
  }, [chartReady, tradeLevels]);

  // Structural levels (Asia high/low, liquidity pools, FVG/IFVG zones) are
  // drawn independently of the trade levels so they persist without a signal.
  const extraKey = useMemo(
    () => (extraLines || []).map(l => `${l.price}:${l.title}`).join('|'),
    [extraLines]
  );

  useEffect(() => {
    const chart = chartApiRef.current;
    if (!chart) return;

    extraLineIdsRef.current.forEach(id => { try { chart.removePriceLine(id); } catch {} });
    extraLineIdsRef.current = [];

    if (!extraLines || extraLines.length === 0) return;

    extraLines.forEach(line => {
      if (!Number.isFinite(line.price) || line.price <= 0) return;
      try {
        const id = chart.createPriceLine({
          price: line.price,
          color: line.color,
          lineWidth: line.lineWidth ?? 1,
          lineStyle: line.lineStyle ?? 2,
          axisLabelVisible: true,
          title: line.title,
        });
        extraLineIdsRef.current.push(id);
      } catch {}
    });
  }, [chartReady, extraKey]);

  const renderHtmlOverlay = () => {
    if (!tradeLevels || tradeLevels.entry <= 0 || chartReady) return null;

    const prices = [tradeLevels.entry, tradeLevels.stopLoss, tradeLevels.takeProfit];
    if (tradeLevels.support && tradeLevels.support > 0) prices.push(tradeLevels.support);
    if (tradeLevels.resistance && tradeLevels.resistance > 0) prices.push(tradeLevels.resistance);
    const valid = prices.filter(p => p > 0);
    if (valid.length === 0) return null;

    const minP = Math.min(...valid);
    const maxP = Math.max(...valid);
    const range = maxP - minP || 1;
    const pad = range * 0.15;
    const adjMin = minP - pad;
    const adjMax = maxP + pad;
    const adjRange = adjMax - adjMin;

    const isSell = tradeLevels.signalType === 'SELL/SHORT';
    const lines = [
      { price: tradeLevels.entry, color: isSell ? '#f43f5e' : '#3b82f6', label: isSell ? 'SELL ENTRY' : 'BUY ENTRY' },
      { price: tradeLevels.stopLoss, color: '#f43f5e', label: 'STOP LOSS' },
      { price: tradeLevels.takeProfit, color: '#10b981', label: isSell ? 'TP BUY BACK' : 'TP SELL' },
    ];
    if (tradeLevels.support && tradeLevels.support > 0) lines.push({ price: tradeLevels.support, color: '#22c55e', label: 'SUPPORT' });
    if (tradeLevels.resistance && tradeLevels.resistance > 0) lines.push({ price: tradeLevels.resistance, color: '#f97316', label: 'RESISTANCE' });

    return (
      <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 10 }}>
        {lines.map((line, i) => {
          const y = ((adjMax - line.price) / adjRange) * CHART_HEIGHT;
          return (
            <div key={i} className="absolute left-0 right-0" style={{ top: `${y}px` }}>
              <div className="absolute inset-x-0 h-px" style={{ backgroundColor: line.color, opacity: 0.7 }}></div>
              <span className="absolute left-1 top-0 text-xs font-mono px-1.5 py-0.5 rounded"
                style={{ backgroundColor: 'rgba(0,0,0,0.85)', color: line.color }}>
                {line.label} {line.price.toFixed(2)}
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      {instructions && (
        <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-slate-300 text-xs">
          {instructions}
        </div>
      )}
      <div className="relative w-full h-[520px] rounded-lg overflow-hidden border border-slate-950">
        <div ref={containerRef} className="w-full h-full" />
        {renderHtmlOverlay()}
      </div>
    </div>
  );
}

// ── SVG Zigzag Arrow Structure Visualization ──
function StructureArrowChart({ pivots }: { pivots: any[] }) {
  const W = 900;
  const H = 250;
  const PAD_X = 48;
  const PAD_Y = 28;
  const PAD_BOTTOM = 24; // space for time labels
  const innerW = W - PAD_X * 2;
  const innerH = H - PAD_Y - PAD_BOTTOM;

  if (!pivots || pivots.length < 2) {
    return (
      <div className="flex items-center justify-center h-32 text-slate-500 text-sm">
        Calculating market structure...
      </div>
    );
  }

  // Last 20 pivots
  const recent = pivots.slice(-20);

  const prices = recent.map((p: any) => p.price);
  const times  = recent.map((p: any) => p.time as number); // unix seconds
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const minT = Math.min(...times);
  const maxT = Math.max(...times);
  const priceRange = maxP - minP || 1;
  const timeRange  = maxT - minT || 1;

  // Map: price → Y (inverted), time → X
  const toX = (t: number) => PAD_X + ((t - minT) / timeRange) * innerW;
  const toY = (price: number) => PAD_Y + innerH - ((price - minP) / priceRange) * innerH;

  // Format unix-seconds as HH:MM (local time)
  const fmtTime = (t: number) => {
    const d = new Date(t * 1000);
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  };

  const points = recent.map((p: any) => ({
    x: toX(p.time), y: toY(p.price),
    price: p.price, code: p.code, label: p.label, type: p.type, time: p.time,
  }));

  // Arrow helper
  const arrowHead = (x1: number, y1: number, x2: number, y2: number, color: string, id: string) => {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const arrowLen = 12; const spread = 0.4;
    const ax = x2 - arrowLen * Math.cos(angle - spread);
    const ay = y2 - arrowLen * Math.sin(angle - spread);
    const bx = x2 - arrowLen * Math.cos(angle + spread);
    const by = y2 - arrowLen * Math.sin(angle + spread);
    return <polygon key={`arrow-${id}`} points={`${x2},${y2} ${ax},${ay} ${bx},${by}`} fill={color} />;
  };

  const segments: JSX.Element[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i]; const to = points[i + 1];
    const goingUp = to.y < from.y;
    const color = goingUp ? '#22c55e' : '#ef4444';
    const ratio = 0.85;
    const mx = from.x + (to.x - from.x) * ratio;
    const my = from.y + (to.y - from.y) * ratio;
    segments.push(
      <g key={`seg-${i}`}>
        <line x1={from.x} y1={from.y} x2={mx} y2={my} stroke={color} strokeWidth={2.5} />
        {arrowHead(from.x, from.y, to.x, to.y, color, `${i}`)}
      </g>
    );
  }

  const labelEl = (p: { x: number; y: number; code: string; label: string; type: string }, i: number) => {
    const isHigh = p.type === 'HIGH';
    const boxColor = (p.code === 'HH' || p.code === 'HL') ? '#16a34a' : '#dc2626';
    const textLen = p.code.length * 7 + 8;
    return (
      <g key={`lbl-${i}`}>
        <circle cx={p.x} cy={p.y} r={6} fill="#eab308" stroke="#0f172a" strokeWidth={1.5} />
        <rect x={p.x - textLen / 2} y={isHigh ? p.y - 38 : p.y + 14} width={textLen} height={18} rx={3} fill={boxColor} opacity={0.9} />
        <text x={p.x} y={isHigh ? p.y - 25 : p.y + 26} fill="white" fontSize={10} fontWeight="bold" textAnchor="middle" fontFamily="monospace">
          {p.code}
        </text>
      </g>
    );
  };

  // Time axis: pick ~8 evenly spaced time labels from the pivot timestamps
  const step = Math.max(1, Math.floor(recent.length / 8));
  const timeTicks = recent.filter((_: any, i: number) => i % step === 0 || i === recent.length - 1);

  return (
    <div className="w-full bg-slate-950 rounded-lg border border-slate-800 overflow-hidden">
      <div className="px-3 py-1.5 border-b border-slate-800 flex items-center gap-2">
        <span className="text-xs text-slate-400 font-mono">▲ STRUCTURE ANALYSIS</span>
        <span className="text-[10px] text-slate-600">— Python pivot engine · timestamps match chart above (last {recent.length} swings)</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" className="block">
        {/* Price grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map(t => {
          const py = PAD_Y + innerH - t * innerH;
          const price = minP + t * priceRange;
          return (
            <g key={`grid-${t}`}>
              <line x1={PAD_X} y1={py} x2={W - PAD_X} y2={py} stroke="#1e293b" strokeWidth={1} strokeDasharray="3,4" />
              <text x={PAD_X - 4} y={py + 4} fill="#475569" fontSize={9} textAnchor="end" fontFamily="monospace">
                {price.toFixed(1)}
              </text>
            </g>
          );
        })}

        {/* Time axis baseline */}
        <line x1={PAD_X} y1={PAD_Y + innerH} x2={W - PAD_X} y2={PAD_Y + innerH} stroke="#334155" strokeWidth={1} />

        {/* Time tick marks + labels */}
        {timeTicks.map((p: any, i: number) => {
          const tx = toX(p.time);
          return (
            <g key={`tick-${i}`}>
              <line x1={tx} y1={PAD_Y + innerH} x2={tx} y2={PAD_Y + innerH + 5} stroke="#475569" strokeWidth={1} />
              <text x={tx} y={PAD_Y + innerH + 16} fill="#64748b" fontSize={9} textAnchor="middle" fontFamily="monospace">
                {fmtTime(p.time)}
              </text>
            </g>
          );
        })}

        {/* Vertical dashed lines at each time tick */}
        {timeTicks.map((p: any, i: number) => {
          const tx = toX(p.time);
          return (
            <line key={`vline-${i}`} x1={tx} y1={PAD_Y} x2={tx} y2={PAD_Y + innerH} stroke="#1e293b" strokeWidth={1} strokeDasharray="2,5" />
          );
        })}

        {/* Zigzag segments with arrows */}
        {segments}
        {/* Pivot labels on top */}
        {points.map((p, i) => labelEl(p, i))}
      </svg>
    </div>
  );
}

// ── AlgoStructureTab: OANDA chart + algo analysis overlay ──
function AlgoStructureTab({ symbol, timeframe, algoTrend, fetchAlgoAnalysis, tradeLevels }: {
  symbol: string; timeframe: string;
  algoTrend: { status: string; pivots: any[]; dataSource: string } | null;
  fetchAlgoAnalysis: () => void;
  tradeLevels: {
    signalType: 'BUY/LONG' | 'SELL/SHORT';
    entry: number;
    stopLoss: number;
    takeProfit: number;
    support: number;
    resistance: number;
  } | null;
}) {
  useEffect(() => {
    fetchAlgoAnalysis();
    const interval = setInterval(fetchAlgoAnalysis, 10000);
    return () => clearInterval(interval);
  }, [symbol, timeframe, fetchAlgoAnalysis]);

  const isBullish = algoTrend?.status?.includes('Bullish');
  const isBearish = algoTrend?.status?.includes('Bearish');

  const hhCount = algoTrend?.pivots?.filter((p: any) => p.code === 'HH').length ?? 0;
  const hlCount = algoTrend?.pivots?.filter((p: any) => p.code === 'HL').length ?? 0;
  const lhCount = algoTrend?.pivots?.filter((p: any) => p.code === 'LH').length ?? 0;
  const llCount = algoTrend?.pivots?.filter((p: any) => p.code === 'LL').length ?? 0;

  return (
    <div className="flex flex-col gap-3">
      {/* Trend Status Banner */}
      {algoTrend && (
        <div className={`flex items-center justify-center gap-3 py-2.5 px-4 rounded-lg border font-bold text-sm tracking-wide ${
          isBullish
            ? 'bg-emerald-950/60 border-emerald-700/40 text-emerald-400'
            : isBearish
              ? 'bg-rose-950/60 border-rose-700/40 text-rose-400'
              : 'bg-amber-950/60 border-amber-700/40 text-amber-400'
        }`}>
          {isBullish ? '📈' : isBearish ? '📉' : '↔️'} {algoTrend.status}
        </div>
      )}

      {/* Pivot Stats */}
      {algoTrend && (
        <div className="grid grid-cols-4 gap-2 text-xs font-mono">
          <div className="bg-slate-950 p-2 rounded-lg border border-emerald-800/50 text-center">
            <div className="text-emerald-400 font-bold text-base">{hhCount}</div>
            <div className="text-slate-400">Higher Highs</div>
          </div>
          <div className="bg-slate-950 p-2 rounded-lg border border-emerald-800/50 text-center">
            <div className="text-emerald-400 font-bold text-base">{hlCount}</div>
            <div className="text-slate-400">Higher Lows</div>
          </div>
          <div className="bg-slate-950 p-2 rounded-lg border border-rose-800/50 text-center">
            <div className="text-rose-400 font-bold text-base">{lhCount}</div>
            <div className="text-slate-400">Lower Highs</div>
          </div>
          <div className="bg-slate-950 p-2 rounded-lg border border-rose-800/50 text-center">
            <div className="text-rose-400 font-bold text-base">{llCount}</div>
            <div className="text-slate-400">Lower Lows</div>
          </div>
        </div>
      )}

      <TVWidgetTab
        symbol={symbol}
        timeframe={timeframe}
        tabId="algo_market_structure_tv"
        tradeLevels={tradeLevels}
      />
      {!algoTrend && (symbol.toUpperCase().includes('XAU') || symbol.toUpperCase().includes('GOLD')) && (
        <div className="rounded-lg border border-amber-800/60 bg-slate-950 p-3 text-xs font-mono text-amber-300">
          TradingView pivots appear immediately. Connecting the free PAXG gold reference for matched HH/HL/LH/LL labels.
        </div>
      )}

      {/* SVG Arrow Structure Visualization */}
      {algoTrend && algoTrend.pivots.length > 1 && (
        <StructureArrowChart pivots={algoTrend.pivots} />
      )}
    </div>
  );
}

export default function TradingChart({
  symbol,
  timeframe,
  onTimeframeChange,
  activeTab,
  onActiveTabChange,
  onLatestDataUpdate,
}: TradingChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string>(`tv_signal_widget_${Math.floor(Math.random() * 1000000)}`);

  const [latestPrice, setLatestPrice] = useState<number>(0);
  const [supportLevel, setSupportLevel] = useState<number>(0);
  const [resistanceLevel, setResistanceLevel] = useState<number>(0);
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [showDropdown, setShowDropdown] = useState<boolean>(false);

  const [signalType, setSignalType] = useState<string>('NEUTRAL');
  const [tradeParams, setTradeParams] = useState<any>(null);
  const [marketDataSource, setMarketDataSource] = useState<string>('unknown');
  const [algoTrend, setAlgoTrend] = useState<{ status: string; pivots: any[]; dataSource: string } | null>(null);
  const [ictData, setIctData] = useState<IctPublish | null>(null);

  // Keep stable identities unless the values actually change, so the chart
  // price-line effects do not re-run (and redraw) on every render.
  const handleIctPublish = useCallback((next: IctPublish) => {
    setIctData((prev) => {
      if (prev && ictPublishEqual(prev, next)) return prev;
      return next;
    });
  }, []);

  const ictTradeLevels = useMemo(() => {
    const lv = ictData?.levels;
    if (!lv || !(lv.entry > 0)) return null;
    return {
      signalType: (lv.direction === 'SHORT' ? 'SELL/SHORT' : 'BUY/LONG') as 'SELL/SHORT' | 'BUY/LONG',
      entry: lv.entry,
      stopLoss: lv.stop_loss,
      takeProfit: lv.take_profit,
    };
  }, [ictData]);

  const ictChartLines = useMemo<ChartExtraLine[]>(() => ictData?.lines ?? [], [ictData]);

  const isHighValueAsset = latestPrice > 10.0;
  const precision = isHighValueAsset ? 2 : 4;

  const isSellSignal = signalType === 'SELL/SHORT';
  const isBuySignal = signalType === 'BUY/LONG';
  const isGoldSymbol = symbol.toUpperCase().includes('XAU') || symbol.toUpperCase().includes('GOLD');
  const hasDirectionalSignal = isSellSignal || isBuySignal;
  const signalEntryPrice = Number(tradeParams?.entry ?? latestPrice);
  const rawStopLoss = Number(tradeParams?.stop_loss);
  const riskAmount = Number.isFinite(rawStopLoss) && rawStopLoss > 0
    ? Math.abs(signalEntryPrice - rawStopLoss)
    : Math.max(Math.abs(resistanceLevel - supportLevel) * 0.1, signalEntryPrice * 0.001, 0.0001);
  const stopLossPrice = signalEntryPrice > 0 && (Number.isFinite(rawStopLoss) && rawStopLoss > 0)
    ? Number((signalEntryPrice + (isSellSignal ? riskAmount : -riskAmount)).toFixed(precision))
    : 0;
  const rawTakeProfit = Number(tradeParams?.tp1);
  const targetDistance = Number.isFinite(rawTakeProfit) && rawTakeProfit > 0 && rawTakeProfit !== signalEntryPrice
    ? Math.abs(signalEntryPrice - rawTakeProfit)
    : riskAmount * 1.5;
  const takeProfitPrice = signalEntryPrice > 0 && (Number.isFinite(rawTakeProfit) && rawTakeProfit > 0 && rawTakeProfit !== signalEntryPrice)
    ? Number((signalEntryPrice + (isSellSignal ? -targetDistance : targetDistance)).toFixed(precision))
    : 0;

  // ── Fetch algo market structure analysis from backend ──
  const fetchAlgoAnalysis = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/chart-data?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&limit=200`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.status === 'success') {
        setMarketDataSource(data.data_source || 'unknown');
        setAlgoTrend({ status: data.trend?.status || '', pivots: data.pivots || [], dataSource: data.data_source || 'unknown' });
      }
    } catch { /* silent */ }
  }, [symbol, timeframe]);

  // ── Fetch signal data from backend (for overlay lines, NOT for chart candles) ──
  const fetchSignalData = useCallback(async () => {
    try {
      const sigRes = await fetch(`${API_BASE_URL}/api/signals/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, timeframe }),
      });
      if (sigRes.ok) {
        const sigData = await sigRes.json();
        if (sigData.analysis) {
          setMarketDataSource(sigData.analysis.data_source || 'unknown');
          setSignalType(sigData.analysis.signal_type);
          setTradeParams(sigData.analysis.trade_params);
          setLatestPrice(sigData.analysis.latest_price);
          setSupportLevel(sigData.analysis.support);
          setResistanceLevel(sigData.analysis.resistance);

          if (onLatestDataUpdate) {
            onLatestDataUpdate({
              price: sigData.analysis.latest_price,
              support: sigData.analysis.support,
              resistance: sigData.analysis.resistance,
            });
          }
        }
      }
    } catch (e) {
      // Backend offline — signal overlays won't show but chart still works from TradingView
    }
  }, [symbol, timeframe, onLatestDataUpdate]);

  // TV widget initialization moved to TVWidgetTab component

  // ── Fetch signals on mount and on interval ──
  useEffect(() => {
    fetchSignalData();

    const interval = setInterval(() => {
      fetchSignalData();
    }, 10000);

    return () => clearInterval(interval);
  }, [fetchSignalData]);

  // ── WebSocket for live price updates ──
  useEffect(() => {
    if (isGoldSymbol) {
      setWsConnected(false);
      return;
    }

    let ws: WebSocket | null = null;
    let reconnectTimer: NodeJS.Timeout | null = null;

    const connectWebSocket = () => {
      try {
        const { getWsUrl } = require('@/lib/apiConfig');
        const wsUrl = getWsUrl(`/ws/candles/${encodeURIComponent(symbol)}`);
        ws = new WebSocket(wsUrl);

        ws.onopen = () => setWsConnected(true);

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.data_source === 'SIMULATED') return;
            if (data.price && data.price > 0) {
              setLatestPrice(data.price);
              if (data.support) setSupportLevel(data.support);
              if (data.resistance) setResistanceLevel(data.resistance);

              if (onLatestDataUpdate) {
                onLatestDataUpdate({
                  price: data.price,
                  support: data.support || supportLevel,
                  resistance: data.resistance || resistanceLevel,
                });
              }
            }
          } catch (_) {}
        };

        ws.onerror = () => setWsConnected(false);
        ws.onclose = () => {
          setWsConnected(false);
          reconnectTimer = setTimeout(connectWebSocket, 3000);
        };
      } catch (_) {
        setWsConnected(false);
      }
    };

    connectWebSocket();

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, [symbol, isGoldSymbol]);

  const isSell = isSellSignal;
  const sl = stopLossPrice;
  const tp = takeProfitPrice;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl space-y-3">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-blue-950/60 text-blue-400 border border-blue-800/50 px-3 py-1.5 rounded-lg text-sm font-semibold">
            <Zap className="w-4 h-4 text-blue-400 animate-pulse" />
            <span>{symbol}</span>
          </div>
          <div className="flex items-center gap-2">
            {latestPrice > 0 && (
              <span className="text-2xl font-bold font-mono text-white">${latestPrice.toFixed(precision)}</span>
            )}
            <span className={`flex items-center gap-1.5 text-xs border px-2.5 py-0.5 rounded-full font-mono font-bold transition ${
              isGoldSymbol || wsConnected
                ? 'bg-emerald-950 text-emerald-400 border-emerald-800/80'
                : 'bg-amber-950 text-amber-400 border-amber-800/80'
            }`}>
              <Radio className={`w-3.5 h-3.5 ${isGoldSymbol || wsConnected ? 'animate-pulse text-emerald-400' : 'text-amber-400'}`} />
              <span>{isGoldSymbol ? 'OANDA TradingView' : wsConnected ? 'Connected' : 'Connecting...'}</span>
            </span>
          </div>
        </div>

        {/* Intervals Control Bar */}
        <div className="flex items-center gap-1.5 relative bg-slate-950 p-1 rounded-lg border border-slate-800">
          <div className="flex items-center gap-1">
            {QUICK_TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                onClick={() => onTimeframeChange(tf)}
                className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all ${
                  timeframe === tf
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-900/50'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          <div className="relative border-l border-slate-800 pl-1">
            <button
              onClick={() => setShowDropdown(!showDropdown)}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-slate-300 hover:text-white bg-slate-900 hover:bg-slate-800 rounded-md border border-slate-800 transition"
            >
              <Clock className="w-3.5 h-3.5 text-blue-400" />
              <span>Intervals</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
            </button>

            {showDropdown && (
              <div className="absolute right-0 top-9 z-50 w-56 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-2 space-y-2 max-h-96 overflow-y-auto font-mono text-xs">
                {INTERVAL_CATEGORIES.map((cat) => (
                  <div key={cat.category} className="space-y-1">
                    <div className="text-[10px] font-sans font-bold text-slate-400 px-2 pt-1 border-b border-slate-800 pb-0.5">
                      {cat.category}
                    </div>
                    <div className="space-y-0.5">
                      {cat.items.map((item) => (
                        <button
                          key={item.tf}
                          onClick={() => {
                            onTimeframeChange(item.tf);
                            setShowDropdown(false);
                          }}
                          className={`w-full text-left px-2.5 py-1.5 rounded-md flex items-center justify-between transition ${
                            timeframe === item.tf
                              ? 'bg-blue-600 text-white font-bold'
                              : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                          }`}
                        >
                          <span className="font-bold">{item.tf}</span>
                          <span className="text-[11px] text-slate-400 font-sans">{item.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={() => fetchSignalData()}
            title="Refresh signal data"
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-md transition border-l border-slate-800 pl-1"
          >
            <RefreshCw className="w-3.5 h-3.5 text-blue-400" />
          </button>
        </div>
      </div>

      {/* Tabs Switcher */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-3">
        {[
          { id: 'live_signals', label: 'Live Signals & Lines' },
          { id: 'algo_market_structure', label: 'Algo Market Structure (Live Feed)' },
          { id: 'ict_scalp', label: '⚡ ICT Scalp (AMD Sessions)' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              onActiveTabChange(tab.id as ChartTabId);
            }}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
              activeTab === tab.id
                ? 'bg-blue-600 text-white shadow-md shadow-blue-900/40'
                : 'bg-slate-950 text-slate-400 hover:bg-slate-800 hover:text-slate-200 border border-slate-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Visual Technical Trading Decision Lines Guide Bar - ONLY on Live Signals */}
      {activeTab === 'live_signals' && (
        signalType === 'SELL/SHORT' ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
            <div className="bg-slate-950 p-2 rounded-lg border border-rose-800/60 flex items-center justify-between">
              <div>
                <span className="text-rose-400 block text-[10px] font-bold">🔴 WHEN TO SELL / SHORT (ENTRY)</span>
                <span className="text-white font-bold">${signalEntryPrice > 0 ? signalEntryPrice.toFixed(precision) : '---'}</span>
              </div>
              <ArrowDownRight className="w-4 h-4 text-rose-400" />
            </div>

            <div className="bg-slate-950 p-2 rounded-lg border border-rose-800/60 flex items-center justify-between">
              <div>
                <span className="text-rose-400 block text-[10px] font-bold">🛑 STOP LOSS LINE</span>
                <span className="text-rose-300 font-bold">${sl > 0 ? sl.toFixed(precision) : '---'}</span>
              </div>
              <Shield className="w-4 h-4 text-rose-400" />
            </div>

            <div className="bg-slate-950 p-2 rounded-lg border border-emerald-800/60 flex items-center justify-between">
              <div>
                <span className="text-emerald-400 block text-[10px] font-bold">🎯 TAKE PROFIT (BUY BACK)</span>
                <span className="text-emerald-300 font-bold">${tp > 0 ? tp.toFixed(precision) : '---'}</span>
              </div>
              <Target className="w-4 h-4 text-emerald-400" />
            </div>

            <div className="bg-slate-950 p-2 rounded-lg border border-amber-800/60 flex items-center justify-between">
              <div>
                <span className="text-amber-400 block text-[10px] font-bold">⛔ WHEN NOT TO SELL</span>
                <span className="text-slate-300 text-[10px]">OBI &gt; 0 or Near Support</span>
              </div>
              <AlertOctagon className="w-4 h-4 text-amber-400" />
            </div>
          </div>
        ) : signalType === 'BUY/LONG' ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
            <div className="bg-slate-950 p-2 rounded-lg border border-blue-800/60 flex items-center justify-between">
              <div>
                <span className="text-blue-400 block text-[10px] font-bold">🔵 WHEN TO BUY (ENTRY)</span>
                <span className="text-white font-bold">${signalEntryPrice > 0 ? signalEntryPrice.toFixed(precision) : '---'}</span>
              </div>
              <ArrowUpRight className="w-4 h-4 text-blue-400" />
            </div>

            <div className="bg-slate-950 p-2 rounded-lg border border-rose-800/60 flex items-center justify-between">
              <div>
                <span className="text-rose-400 block text-[10px] font-bold">🛑 STOP LOSS LINE</span>
                <span className="text-rose-300 font-bold">${sl > 0 ? sl.toFixed(precision) : '---'}</span>
              </div>
              <Shield className="w-4 h-4 text-rose-400" />
            </div>

            <div className="bg-slate-950 p-2 rounded-lg border border-emerald-800/60 flex items-center justify-between">
              <div>
                <span className="text-emerald-400 block text-[10px] font-bold">🎯 TAKE PROFIT (SELL)</span>
                <span className="text-emerald-300 font-bold">${tp > 0 ? tp.toFixed(precision) : '---'}</span>
              </div>
              <Target className="w-4 h-4 text-emerald-400" />
            </div>

            <div className="bg-slate-950 p-2 rounded-lg border border-amber-800/60 flex items-center justify-between">
              <div>
                <span className="text-amber-400 block text-[10px] font-bold">⛔ WHEN NOT TO BUY</span>
                <span className="text-slate-300 text-[10px]">Downtrend or Near Resistance</span>
              </div>
              <AlertOctagon className="w-4 h-4 text-amber-400" />
            </div>
          </div>
         ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
            <div className="bg-slate-950 p-2 rounded-lg border border-slate-700 flex items-center justify-between">
              <div>
                <span className="text-slate-400 block text-[10px] font-bold">◇ ENTRY / CURRENT PRICE</span>
                <span className="text-white font-bold">${signalEntryPrice > 0 ? signalEntryPrice.toFixed(precision) : '---'}</span>
              </div>
              <Activity className="w-4 h-4 text-slate-400" />
            </div>

            <div className="bg-slate-950 p-2 rounded-lg border border-slate-700 flex items-center justify-between">
              <div>
                <span className="text-slate-400 block text-[10px] font-bold">🛑 STOP LOSS LINE</span>
                <span className="text-slate-300 font-bold">${sl > 0 ? sl.toFixed(precision) : '---'}</span>
              </div>
              <Shield className="w-4 h-4 text-slate-400" />
            </div>

            <div className="bg-slate-950 p-2 rounded-lg border border-slate-700 flex items-center justify-between">
              <div>
                <span className="text-slate-400 block text-[10px] font-bold">🎯 TAKE PROFIT (TARGET)</span>
                <span className="text-slate-300 font-bold">${tp > 0 ? tp.toFixed(precision) : '---'}</span>
              </div>
              <Target className="w-4 h-4 text-slate-400" />
            </div>

            <div className="bg-slate-950 p-2 rounded-lg border border-slate-700 flex items-center justify-between">
              <div>
                <span className="text-slate-400 block text-[10px] font-bold">⛔ NO ACTIVE SIGNAL</span>
                <span className="text-slate-400 text-[10px]">Monitor trend / OBI for entry</span>
              </div>
              <AlertOctagon className="w-4 h-4 text-slate-400" />
            </div>
          </div>
        )
      )}

      {/* Tab Content Render */}
      {activeTab === 'live_signals' && (
        <TVWidgetTab
          symbol={symbol}
          timeframe={timeframe}
          tabId="live_signals_tv"
          tradeLevels={signalEntryPrice > 0 && (sl > 0 || tp > 0) ? {
            signalType: (signalType === 'SELL/SHORT' ? 'SELL/SHORT' : 'BUY/LONG'),
            entry: signalEntryPrice,
            stopLoss: sl,
            takeProfit: tp,
            support: supportLevel,
            resistance: resistanceLevel,
          } : null}
        />
      )}
      
      {activeTab === 'algo_market_structure' && (
        <AlgoStructureTab
          symbol={symbol}
          timeframe={timeframe}
          algoTrend={algoTrend}
          fetchAlgoAnalysis={fetchAlgoAnalysis}
          tradeLevels={signalEntryPrice > 0 && (sl > 0 || tp > 0) ? {
            signalType: (signalType === 'SELL/SHORT' ? 'SELL/SHORT' : 'BUY/LONG'),
            entry: signalEntryPrice,
            stopLoss: sl,
            takeProfit: tp,
            support: supportLevel,
            resistance: resistanceLevel,
          } : null}
        />
      )}

      {activeTab === 'ict_scalp' && (
        <div className="space-y-3">
          {ictData && (
            <SessionRibbon
              windows={ictData.session.windows}
              nextKillzone={ictData.session.nextKillzone}
              currentEt={ictData.session.currentEt}
              currentHarare={ictData.session.currentHarare}
              inKillzone={ictData.session.inKillzone}
            />
          )}
          <TVWidgetTab
            symbol={symbol}
            timeframe={timeframe}
            tabId="ict_scalp_tv"
            tradeLevels={ictTradeLevels}
            extraLines={ictChartLines}
          />
          <ICTScalpPanel symbol={symbol} timeframe={timeframe} onPublish={handleIctPublish} />
        </div>
      )}
    </div>
  );
}
