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

  const isHighValueAsset = latestPrice > 10.0;
  const precision = isHighValueAsset ? 2 : 4;

  const buyEntryPrice = latestPrice;
  const stopLossPrice = tradeParams?.stop_loss ?? Number((supportLevel * 0.985).toFixed(precision));
  const riskAmount = Math.max(0.0001, Math.abs(buyEntryPrice - stopLossPrice));
  const takeProfitPrice = tradeParams?.tp1 ?? Number((buyEntryPrice + riskAmount * 1.5).toFixed(precision));

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
          { id: 'market_structure', label: 'Market Structure' },
          { id: 'dow_theory', label: 'Dow Theory / Trend' },
          { id: 'sideways', label: 'Sideways Channel' },
          { id: 'swing_analysis', label: 'Swing Analysis (BOS/CHOCH)' },
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
      
      {activeTab === 'market_structure' && (
        <div className="space-y-2 mt-4">
          <div className="flex items-center gap-2 mb-2 p-3 bg-slate-900 border border-slate-800 rounded-lg">
            <Shield className="w-4 h-4 text-blue-400 flex-shrink-0" />
            <span className="text-sm"><strong className="text-white">Market Structure (Python Engine):</strong> Live Pivot Points calculated by backend engine.</span>
          </div>
          <CustomAlgorithmicChart symbol={symbol} timeframe={timeframe} tabId="market_structure" />
        </div>
      )}

      {activeTab === 'dow_theory' && (
        <div className="space-y-2 mt-4">
          <div className="flex items-center gap-2 mb-2 p-3 bg-slate-900 border border-slate-800 rounded-lg">
            <Activity className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <span className="text-sm"><strong className="text-white">Dow Theory (Python Engine):</strong> Algorithmic Highs and Lows tracking the trend.</span>
          </div>
          <CustomAlgorithmicChart symbol={symbol} timeframe={timeframe} tabId="dow_theory" />
        </div>
      )}

      {activeTab === 'sideways' && (
        <div className="space-y-2 mt-4">
          <div className="flex items-center gap-2 mb-2 p-3 bg-slate-900 border border-slate-800 rounded-lg">
            <ArrowRightLeft className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <span className="text-sm"><strong className="text-white">Sideways Trend:</strong> Showing custom support and resistance mapping.</span>
          </div>
          <CustomAlgorithmicChart symbol={symbol} timeframe={timeframe} tabId="sideways" />
        </div>
      )}

      {activeTab === 'swing_analysis' && (
        <div className="space-y-2 mt-4">
          <div className="flex items-center gap-2 mb-2 p-3 bg-slate-900 border border-slate-800 rounded-lg">
            <TrendingUp className="w-4 h-4 text-purple-400 flex-shrink-0" />
            <span className="text-sm">
              <strong className="text-white">Swing Analysis (BOS/CHOCH):</strong> Algorithmic zig-zag and markers.
            </span>
          </div>
          <CustomAlgorithmicChart symbol={symbol} timeframe={timeframe} tabId="swing_analysis" />
        </div>
      )}
    </div>
  );
}
