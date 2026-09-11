'use client';

import React, { useEffect, useRef } from 'react';
import { Clock, Zap } from 'lucide-react';

interface TradingViewDirectChartProps {
  symbol: string;
  timeframe: string;
  currentPrice?: number;
  onTimeframeChange?: (tf: string) => void;
}

declare global {
  interface Window {
    TradingView: any;
  }
}

const QUICK_TIMEFRAMES = ['1s', '1m', '5m', '15m', '30m', '1h', '4h', '1d'];

export default function TradingViewDirectChart({ symbol, timeframe, currentPrice, onTimeframeChange }: TradingViewDirectChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string>(`tv_widget_${Math.floor(Math.random() * 1000000)}`);

  const getTradingViewSymbol = (sym: string): string => {
    const s = sym.toUpperCase().replace(" ", "").replace("/", "").replace("_", "");
    if (s.includes("XAU") || s.includes("GOLD") || s.includes("PAXG")) return "BINANCE:PAXGUSDT";
    if (s.includes("EURUSD")) return "OANDA:EURUSD";
    if (s.includes("GBPUSD")) return "OANDA:GBPUSD";
    if (s.includes("USDJPY")) return "OANDA:USDJPY";
    if (s.includes("AUDUSD")) return "OANDA:AUDUSD";
    if (s.includes("USDCAD")) return "OANDA:USDCAD";
    if (s.includes("USDCHF")) return "OANDA:USDCHF";
    if (s.includes("NZDUSD")) return "OANDA:NZDUSD";
    if (s.includes("BTC")) return "BINANCE:BTCUSDT";
    if (s.includes("ETH")) return "BINANCE:ETHUSDT";
    if (s.includes("SOL")) return "BINANCE:SOLUSDT";
    if (s.includes("REXT")) return "GATEIO:REXTUSDT";
    return `OANDA:${s}`;
  };

  const tvSymbol = getTradingViewSymbol(symbol);

  const getTradingViewInterval = (tf: string): string => {
    if (tf === '1s') return '1';
    if (tf === '1m') return '1';
    if (tf === '5m') return '5';
    if (tf === '15m') return '15';
    if (tf === '30m') return '30';
    if (tf === '1h') return '60';
    if (tf === '2h') return '120';
    if (tf === '4h') return '240';
    if (tf === '1d') return 'D';
    if (tf === '1w') return 'W';
    if (tf === '1M') return 'M';
    return '1';
  };

  useEffect(() => {
    const scriptId = 'tradingview-widget-script';
    let script = document.getElementById(scriptId) as HTMLScriptElement;

    const initWidget = () => {
      const container = containerRef.current;
      if (window.TradingView && container) {
        container.innerHTML = `<div id="${widgetIdRef.current}" style="width:100%;height:100%;"></div>`;
        new window.TradingView.widget({
          autosize: true,
          symbol: tvSymbol,
          interval: getTradingViewInterval(timeframe),
          timezone: 'Africa/Johannesburg', // Central Africa Time (CAT / UTC+2)
          theme: 'dark',
          style: '1',
          locale: 'en',
          toolbar_bg: '#0F172A',
          enable_publishing: false,
          allow_symbol_change: true,
          hide_side_toolbar: false,
          details: true,
          hotlist: true,
          calendar: true,
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
      // Small timeout ensures container DOM node is ready
      const timer = setTimeout(initWidget, 50);
      return () => clearTimeout(timer);
    }
  }, [symbol, timeframe, tvSymbol]);

  const isHighValue = (currentPrice || 0) > 10.0;
  const precision = isHighValue ? 2 : 4;

  return (
    <div className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 shadow-2xl space-y-3 font-mono">
      {/* Header Bar with Timeframe Switcher & Live Sync Badge */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 bg-blue-950/60 text-blue-400 border border-blue-800/50 px-2.5 py-1 rounded-lg text-xs font-bold">
            <Zap className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
            <span>TradingView Direct Feed: {symbol}</span>
          </div>
          {currentPrice && currentPrice > 0 ? (
            <span className="text-xs bg-emerald-950 text-emerald-400 border border-emerald-800 px-2 py-0.5 rounded font-mono font-bold flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              SPOT LIVE: ${currentPrice.toFixed(precision)}
            </span>
          ) : null}
          <span className="text-[11px] text-slate-400 font-bold uppercase bg-slate-950 px-2 py-1 rounded border border-slate-800">
            INTERVAL: <strong className="text-blue-400">{timeframe.toUpperCase()}</strong>
          </span>
        </div>

        {/* Quick Timeframe Buttons */}
        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
          <Clock className="w-3.5 h-3.5 text-slate-400 ml-1 mr-0.5" />
          {QUICK_TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              type="button"
              onClick={() => onTimeframeChange && onTimeframeChange(tf)}
              className={`px-2.5 py-1 rounded-md font-bold transition ${
                timeframe === tf
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-900/50'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      <div className="w-full h-[520px] rounded-lg overflow-hidden relative bg-slate-950">
        <div ref={containerRef} className="w-full h-full" />
      </div>
    </div>
  );
}
