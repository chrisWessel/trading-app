'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { RefreshCw, Zap, ChevronDown, Clock, Radio, ArrowUpRight, ArrowDownRight, Shield, Target, AlertOctagon, Activity, ArrowRightLeft, TrendingUp } from 'lucide-react';
import { API_BASE_URL } from '@/lib/apiConfig';
import CustomAlgorithmicChart from './CustomAlgorithmicChart';

interface TradingChartProps {
  symbol: string;
  timeframe: string;
  onTimeframeChange: (tf: string) => void;
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

// ── Signal Price Line Overlay (absolute-positioned labels over the chart) ──
interface SignalLine {
  label: string;
  price: number;
  color: string;
  borderColor: string;
  icon: string;
  dashed?: boolean;
}

function SignalOverlay({ lines, chartHeight }: { lines: SignalLine[]; chartHeight: number }) {
  if (!lines.length) return null;

  // Calculate price range from the lines to position them proportionally
  const prices = lines.map((l) => l.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const range = maxPrice - minPrice || 1;
  const padding = range * 0.15; // 15% padding top/bottom

  return (
    <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden">
      {lines.map((line, i) => {
        // Map price to Y position (inverted: high price = top)
        const pct = 1 - (line.price - (minPrice - padding)) / (range + 2 * padding);
        const top = Math.max(4, Math.min(chartHeight - 24, pct * chartHeight));

        return (
          <div key={i} className="absolute left-0 right-0" style={{ top: `${top}px` }}>
            {/* Horizontal line */}
            <div
              className="absolute left-0 right-16 h-px"
              style={{
                backgroundColor: line.color,
                opacity: 0.7,
                borderTop: line.dashed ? `1px dashed ${line.color}` : undefined,
              }}
            />
            {/* Price label */}
            <div
              className="absolute right-0 px-2 py-0.5 text-[10px] font-mono font-bold rounded-l-md whitespace-nowrap"
              style={{
                backgroundColor: line.color,
                color: '#fff',
                transform: 'translateY(-50%)',
              }}
            >
              {line.icon} {line.label}: ${line.price.toFixed(2)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── TVWidgetTab Component for Tabs ──
function TVWidgetTab({ symbol, timeframe, tabId, showSignalOverlay, signalLines, instructions, studies }: { symbol: string, timeframe: string, tabId: string, showSignalOverlay?: boolean, signalLines?: SignalLine[], instructions?: React.ReactNode, studies?: string[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string>(`tv_signal_widget_${tabId}_${Math.floor(Math.random() * 1000000)}`);

  useEffect(() => {
    const scriptId = 'tradingview-widget-script';
    let script = document.getElementById(scriptId) as HTMLScriptElement;

    const tvSymbol = getTradingViewSymbol(symbol);

    const initWidget = () => {
      const container = containerRef.current;
      if (window.TradingView && container) {
        container.innerHTML = `<div id="${widgetIdRef.current}" style="width:100%;height:100%;"></div>`;
        new window.TradingView.widget({
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
          hide_side_toolbar: false, // Turn ON drawing tools for these analysis tabs!
          hide_top_toolbar: true,
          details: false,
          hotlist: false,
          calendar: false,
          studies: studies,
          container_id: widgetIdRef.current,
        });
      }
    };

    if (!script) {
      script = document.createElement('script');
      script.id = scriptId;
      script.src = 'https://s3.tradingview.com/tv.js';
      script.async = true;
      script.onload = initWidget;
      document.head.appendChild(script);
    } else {
      const timer = setTimeout(initWidget, 50);
      return () => clearTimeout(timer);
    }
  }, [symbol, timeframe, tabId]);

  return (
    <div className="flex flex-col gap-3">
      {instructions && (
        <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-slate-300 text-xs">
          {instructions}
        </div>
      )}
      <div className="relative w-full h-[420px] rounded-lg overflow-hidden border border-slate-950">
        <div ref={containerRef} className="w-full h-full" />
        {showSignalOverlay && signalLines && <SignalOverlay lines={signalLines} chartHeight={420} />}
      </div>
    </div>
  );
}

// ── SVG Zigzag Arrow Structure Visualization ──
function StructureArrowChart({ pivots }: { pivots: any[] }) {
  const W = 900;
  const H = 220;
  const PAD_X = 40;
  const PAD_Y = 30;
  const innerW = W - PAD_X * 2;
  const innerH = H - PAD_Y * 2;

  if (!pivots || pivots.length < 2) {
    return (
      <div className="flex items-center justify-center h-32 text-slate-500 text-sm">
        Calculating market structure...
      </div>
    );
  }

  // Only take the last 20 pivots for clarity
  const recent = pivots.slice(-20);

  const prices = recent.map((p: any) => p.price);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const priceRange = maxP - minP || 1;

  // Map price → Y, index → X
  const toX = (i: number) => PAD_X + (i / (recent.length - 1)) * innerW;
  const toY = (price: number) => PAD_Y + innerH - ((price - minP) / priceRange) * innerH;

  const points = recent.map((p: any, i: number) => ({
    x: toX(i), y: toY(p.price),
    price: p.price, code: p.code, label: p.label, type: p.type,
  }));

  // Arrow marker helper
  const arrowHead = (x1: number, y1: number, x2: number, y2: number, color: string, id: string) => {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const arrowLen = 12;
    const spread = 0.4;
    const ax = x2 - arrowLen * Math.cos(angle - spread);
    const ay = y2 - arrowLen * Math.sin(angle - spread);
    const bx = x2 - arrowLen * Math.cos(angle + spread);
    const by = y2 - arrowLen * Math.sin(angle + spread);
    return (
      <polygon
        key={`arrow-${id}`}
        points={`${x2},${y2} ${ax},${ay} ${bx},${by}`}
        fill={color}
      />
    );
  };

  const segments: JSX.Element[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i];
    const to = points[i + 1];
    const goingUp = to.y < from.y;
    const color = goingUp ? '#22c55e' : '#ef4444';
    // Midpoint for the line (end slightly before tip for clean arrowhead)
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
    const labelY = isHigh ? p.y - 22 : p.y + 30;
    const boxColor = (p.code === 'HH' || p.code === 'HL') ? '#16a34a' : '#dc2626';
    const textLen = p.code.length * 7 + 8;

    return (
      <g key={`lbl-${i}`}>
        {/* Yellow circle pivot */}
        <circle cx={p.x} cy={p.y} r={6} fill="#eab308" stroke="#0f172a" strokeWidth={1.5} />
        {/* Label box */}
        <rect x={p.x - textLen / 2} y={isHigh ? p.y - 38 : p.y + 14} width={textLen} height={18}
          rx={3} fill={boxColor} opacity={0.9} />
        <text x={p.x} y={isHigh ? p.y - 25 : p.y + 26}
          fill="white" fontSize={10} fontWeight="bold" textAnchor="middle" fontFamily="monospace">
          {p.code}
        </text>
      </g>
    );
  };

  return (
    <div className="w-full bg-slate-950 rounded-lg border border-slate-800 overflow-hidden">
      <div className="px-3 py-1.5 border-b border-slate-800 flex items-center gap-2">
        <span className="text-xs text-slate-400 font-mono">▲ STRUCTURE ANALYSIS</span>
        <span className="text-[10px] text-slate-600">— Python pivot engine (last {recent.length} swings)</span>
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
        {/* Zigzag segments with arrows */}
        {segments}
        {/* Pivot labels on top */}
        {points.map((p, i) => labelEl(p, i))}
      </svg>
    </div>
  );
}

// ── AlgoStructureTab: OANDA chart + algo analysis overlay ──
function AlgoStructureTab({ symbol, timeframe, algoTrend, fetchAlgoAnalysis }: {
  symbol: string; timeframe: string;
  algoTrend: { status: string; pivots: any[] } | null;
  fetchAlgoAnalysis: () => void;
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

      {/* SAME TradingView OANDA chart as Live Signals */}
      <TVWidgetTab symbol={symbol} timeframe={timeframe} tabId="algo_market_structure_tv" />

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
  onLatestDataUpdate,
}: TradingChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string>(`tv_signal_widget_${Math.floor(Math.random() * 1000000)}`);

  const [latestPrice, setLatestPrice] = useState<number>(0);
  const [supportLevel, setSupportLevel] = useState<number>(0);
  const [resistanceLevel, setResistanceLevel] = useState<number>(0);
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [showDropdown, setShowDropdown] = useState<boolean>(false);

  const [signalType, setSignalType] = useState<string>('BUY/LONG');
  const [tradeParams, setTradeParams] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<string>('live_signals');
  const [algoTrend, setAlgoTrend] = useState<{ status: string; pivots: any[] } | null>(null);

  const isHighValueAsset = latestPrice > 10.0;
  const precision = isHighValueAsset ? 2 : 4;

  const buyEntryPrice = latestPrice;
  const stopLossPrice = tradeParams?.stop_loss ?? Number((supportLevel * 0.985).toFixed(precision));
  const riskAmount = Math.max(0.0001, Math.abs(buyEntryPrice - stopLossPrice));
  const takeProfitPrice = tradeParams?.tp1 ?? Number((buyEntryPrice + riskAmount * 1.5).toFixed(precision));

  // ── Fetch algo market structure analysis from backend ──
  const fetchAlgoAnalysis = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/chart-data?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&limit=500`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.status === 'success') {
        setAlgoTrend({ status: data.trend?.status || '', pivots: data.pivots || [] });
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

  // ── Also try a simple candle fetch for price if signals endpoint fails ──
  const fetchPriceData = useCallback(async () => {
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}&limit=2`
      );
      if (res.ok) {
        const data = await res.json();
        if (data.latest_price && data.latest_price > 0) {
          setLatestPrice(data.latest_price);
          setSupportLevel(data.support);
          setResistanceLevel(data.resistance);

          if (onLatestDataUpdate) {
            onLatestDataUpdate({
              price: data.latest_price,
              support: data.support,
              resistance: data.resistance,
            });
          }
        }
      }
    } catch (_) {}
  }, [symbol, timeframe, onLatestDataUpdate]);

  // TV widget initialization moved to TVWidgetTab component

  // ── Fetch signals on mount and on interval ──
  useEffect(() => {
    fetchSignalData();
    fetchPriceData();

    const interval = setInterval(() => {
      fetchSignalData();
    }, 5000);

    return () => clearInterval(interval);
  }, [fetchSignalData, fetchPriceData]);

  // ── WebSocket for live price updates ──
  useEffect(() => {
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
  }, [symbol]);

  // ── Build signal overlay lines ──
  const isSell = signalType === 'SELL/SHORT';
  const sl = tradeParams?.stop_loss ?? stopLossPrice;
  const tp = tradeParams?.tp1 ?? takeProfitPrice;

  const signalLines: SignalLine[] = [];

  if (latestPrice > 0 && supportLevel > 0 && resistanceLevel > 0) {
    signalLines.push(
      { label: 'RESISTANCE', price: resistanceLevel, color: '#EF4444', borderColor: '#EF4444', icon: '🔴', dashed: true },
      { label: 'SUPPORT', price: supportLevel, color: '#10B981', borderColor: '#10B981', icon: '🟢', dashed: true },
      {
        label: isSell ? 'SELL ENTRY' : 'BUY ENTRY',
        price: latestPrice,
        color: isSell ? '#EF4444' : '#3B82F6',
        borderColor: isSell ? '#EF4444' : '#3B82F6',
        icon: isSell ? '🔴' : '🔵',
      },
      { label: 'STOP LOSS', price: sl, color: '#F43F5E', borderColor: '#F43F5E', icon: '🛑' },
      { label: 'TAKE PROFIT', price: tp, color: '#10B981', borderColor: '#10B981', icon: '🎯' },
    );
  }

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
            <span className="text-2xl font-bold font-mono text-white">
              ${latestPrice > 0 ? latestPrice.toFixed(precision) : '---'}
            </span>
            <span className={`flex items-center gap-1.5 text-xs border px-2.5 py-0.5 rounded-full font-mono font-bold transition ${
              wsConnected
                ? 'bg-emerald-950 text-emerald-400 border-emerald-800/80'
                : 'bg-amber-950 text-amber-400 border-amber-800/80'
            }`}>
              <Radio className={`w-3.5 h-3.5 ${wsConnected ? 'animate-pulse text-emerald-400' : 'text-amber-400'}`} />
              <span>{wsConnected ? 'Connected' : 'Connecting...'}</span>
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
            onClick={() => { fetchSignalData(); fetchPriceData(); }}
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
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
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
                <span className="text-white font-bold">${latestPrice > 0 ? latestPrice.toFixed(precision) : '---'}</span>
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
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
            <div className="bg-slate-950 p-2 rounded-lg border border-blue-800/60 flex items-center justify-between">
              <div>
                <span className="text-blue-400 block text-[10px] font-bold">🔵 WHEN TO BUY (ENTRY)</span>
                <span className="text-white font-bold">${latestPrice > 0 ? latestPrice.toFixed(precision) : '---'}</span>
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
        )
      )}

      {/* Tab Content Render */}
      {activeTab === 'live_signals' && (
        <TVWidgetTab 
          symbol={symbol} 
          timeframe={timeframe} 
          tabId="live_signals" 
          showSignalOverlay={true} 
          signalLines={signalLines} 
        />
      )}
      
      {activeTab === 'algo_market_structure' && (
        <AlgoStructureTab symbol={symbol} timeframe={timeframe} algoTrend={algoTrend} fetchAlgoAnalysis={fetchAlgoAnalysis} />
      )}
    </div>
  );
}
