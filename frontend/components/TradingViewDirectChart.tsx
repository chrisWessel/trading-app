'use client';

import React, { useEffect, useRef } from 'react';

interface TradingViewDirectChartProps {
  symbol: string;
  timeframe: string;
}

declare global {
  interface Window {
    TradingView: any;
  }
}

export default function TradingViewDirectChart({ symbol, timeframe }: TradingViewDirectChartProps) {
  const containerId = useRef<string>(`tv_chart_${Math.random().toString(36).substring(2, 9)}`);

  const getTradingViewSymbol = (sym: string): string => {
    const s = sym.toUpperCase().replace(" ", "").replace("/", "").replace("_", "");
    if (s.includes("XAU") || s.includes("GOLD")) return "OANDA:XAUUSD"; // Real-Time 0-Delay Gold Spot
    if (s.includes("PAXG")) return "BINANCE:PAXGUSDT";
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
    if (tf.endsWith('s')) return '1';
    if (tf === '1m') return '1';
    if (tf === '5m') return '5';
    if (tf === '15m') return '15';
    if (tf === '30m') return '30';
    if (tf === '1h') return '60';
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
      if (window.TradingView && document.getElementById(containerId.current)) {
        document.getElementById(containerId.current)!.innerHTML = '';
        new window.TradingView.widget({
          autosize: true,
          symbol: tvSymbol,
          interval: getTradingViewInterval(timeframe),
          timezone: 'Africa/Johannesburg', // Central Africa Time (CAT / UTC+2) - Zimbabwe Local Time
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
          container_id: containerId.current,
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
      initWidget();
    }
  }, [symbol, timeframe, tvSymbol]);

  return (
    <div className="w-full h-[480px] bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl relative">
      <div id={containerId.current} className="w-full h-full" />
    </div>
  );
}
