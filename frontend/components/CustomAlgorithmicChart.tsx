"use client";

import React, { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, IChartApi, SeriesMarker, Time } from 'lightweight-charts';
import { Loader2, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { API_BASE_URL } from '@/lib/apiConfig';

interface CustomChartProps {
  symbol: string;
  timeframe: string;
  tabId: string;
}

interface TrendInfo {
  status: string;
  color: string;
}

interface TradeLevels {
  signalType: 'BUY/LONG' | 'SELL/SHORT';
  entry: number;
  stopLoss: number;
  takeProfit: number;
}

interface CustomChartProps {
  symbol: string;
  timeframe: string;
  tabId: string;
  tradeLevels?: TradeLevels | null;
}

export default function CustomAlgorithmicChart({ symbol, timeframe, tabId, tradeLevels }: CustomChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trend, setTrend] = useState<TrendInfo | null>(null);
  const [dataSource, setDataSource] = useState<string>('connecting');
  const tradeLevelsRef = useRef<TradeLevels | null | undefined>(tradeLevels);
  tradeLevelsRef.current = tradeLevels;

  useEffect(() => {
    let isMounted = true;
    let pollInterval: NodeJS.Timeout;
    
    async function fetchData(isInitialLoad: boolean = false) {
      try {
        if (isInitialLoad) setLoading(true);
        setError(null);
        
        const res = await fetch(`${API_BASE_URL}/api/chart-data?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&limit=500`);
        if (!res.ok) throw new Error("Failed to fetch chart data");
        const data = await res.json();
        
        if (!isMounted) return;

        const normalizedSymbol = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
        const isGold = ['XAUUSD', 'XAU', 'GOLD'].includes(normalizedSymbol);
        const source = data.data_source || 'unknown';
        setDataSource(source);
        if (data.status === 'success' && (source === 'SIMULATED' || (isGold && source !== 'OANDA'))) {
          setTrend(null);
          setError(isGold ? 'Waiting for OANDA data. Configure OANDA_API_TOKEN in the local .env file to enable matching chart structure.' : 'Market data is simulated; chart disabled.');
          if (chartRef.current) {
            chartRef.current.remove();
            chartRef.current = null;
          }
          return;
        }

        if (data.status === 'success') {
          if (data.trend) setTrend(data.trend);
          renderChart(data.candles, data.pivots, isInitialLoad);
        } else {
          setError("Failed to load market data");
        }
      } catch (err: any) {
        if (isMounted) setError(err.message || "Error fetching data");
      } finally {
        if (isMounted && isInitialLoad) setLoading(false);
      }
    }
    
    fetchData(true);
    pollInterval = setInterval(() => fetchData(false), 5000);
    
    return () => {
      isMounted = false;
      clearInterval(pollInterval);
    };
  }, [symbol, timeframe, tabId]);

  useEffect(() => {
    const chart = chartRef.current as any;
    const series = chart?._candlestickSeries;
    if (!series) return;

    for (const line of chart._signalPriceLines || []) {
      series.removePriceLine(line);
    }

    const levels = tradeLevelsRef.current;
    if (!levels) {
      chart._signalPriceLines = [];
      return;
    }

    const isSell = levels.signalType === 'SELL/SHORT';
    const levelsAreDirectional = isSell
      ? levels.stopLoss > levels.entry && levels.takeProfit < levels.entry
      : levels.stopLoss < levels.entry && levels.takeProfit > levels.entry;
    if (!levelsAreDirectional) {
      chart._signalPriceLines = [];
      return;
    }

    chart._signalPriceLines = [
      series.createPriceLine({ price: levels.entry, color: isSell ? '#f43f5e' : '#3b82f6', lineWidth: 2, axisLabelVisible: true, title: isSell ? 'SELL ENTRY' : 'BUY ENTRY' }),
      series.createPriceLine({ price: levels.stopLoss, color: '#f43f5e', lineWidth: 2, axisLabelVisible: true, title: 'STOP LOSS' }),
      series.createPriceLine({ price: levels.takeProfit, color: '#10b981', lineWidth: 2, axisLabelVisible: true, title: isSell ? 'TAKE PROFIT · BUY BACK' : 'TAKE PROFIT · SELL' }),
    ];
  }, [tradeLevels?.signalType, tradeLevels?.entry, tradeLevels?.stopLoss, tradeLevels?.takeProfit]);
  
  function buildTrendLine(pivots: any[]): { time: number; value: number }[] {
    // Zigzag: connect all pivot points in order
    if (pivots.length < 2) return [];
    const sorted = [...pivots].sort((a, b) => a.time - b.time);
    return sorted.map(p => ({ time: p.time, value: p.price }));
  }
  
  function renderChart(candles: any[], pivots: any[], isInitialLoad: boolean) {
    if (!chartContainerRef.current) return;
    
    const sortedCandles = [...candles].sort((a, b) => a.time - b.time);
    const sortedPivots = [...pivots].sort((a, b) => a.time - b.time);
    
    // Determine trend for line color
    const trendStatus = trend?.status || '';
    const isBullish = trendStatus.includes('Bullish');
    const isBearish = trendStatus.includes('Bearish');
    const lineColor = isBullish ? '#a855f7' : isBearish ? '#ef4444' : '#6366f1'; // purple/red/indigo

    // Markers — circle shape with full label text
    const markers: SeriesMarker<Time>[] = sortedPivots.map(p => {
      const isHigh = p.type === 'HIGH';
      return {
        time: p.time as Time,
        position: isHigh ? 'aboveBar' : 'belowBar',
        color: '#eab308', // yellow
        shape: 'circle',
        text: p.label,
        size: 1,
      };
    });

    // Straight trend line from first to last pivot
    const trendLineData = buildTrendLine(sortedPivots);

    if (isInitialLoad) {
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
      
      const chart = createChart(chartContainerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: '#0f172a' },
          textColor: '#94a3b8',
        },
        grid: {
          vertLines: { color: '#1e293b' },
          horzLines: { color: '#1e293b' },
        },
        timeScale: {
          timeVisible: true,
          secondsVisible: false,
        },
        rightPriceScale: { borderColor: '#1e293b' },
      });
      
      chartRef.current = chart;

      const candlestickSeries = chart.addCandlestickSeries({
        upColor: '#22c55e',
        downColor: '#ef4444',
        borderVisible: false,
        wickUpColor: '#22c55e',
        wickDownColor: '#ef4444',
      });
      candlestickSeries.setData(sortedCandles);

      // Straight trend line
      const trendLine = chart.addLineSeries({
        color: lineColor,
        lineWidth: 3,
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
        lineStyle: 0, // solid
      });
      if (trendLineData.length > 0) {
        trendLine.setData(trendLineData as any);
      }

      candlestickSeries.setMarkers(markers);
      chart.timeScale().fitContent();

      (chart as any)._candlestickSeries = candlestickSeries;
      (chart as any)._trendLine = trendLine;
      (chart as any)._lineColor = lineColor;
    } else if (chartRef.current) {
      const chart: any = chartRef.current;
      if (chart._candlestickSeries) {
        chart._candlestickSeries.setData(sortedCandles);
        chart._candlestickSeries.setMarkers(markers);
      }
      if (chart._trendLine && trendLineData.length > 0) {
        // Update color if trend changed
        chart._trendLine.applyOptions({ color: lineColor });
        chart._trendLine.setData(trendLineData as any);
      }
    }

    const chart: any = chartRef.current;
    const series = chart?._candlestickSeries;
    if (series) {
      for (const line of chart._signalPriceLines || []) {
        series.removePriceLine(line);
      }
      const levels = tradeLevelsRef.current;
      if (levels) {
        const isSell = levels.signalType === 'SELL/SHORT';
        const levelsAreDirectional = isSell
          ? levels.stopLoss > levels.entry && levels.takeProfit < levels.entry
          : levels.stopLoss < levels.entry && levels.takeProfit > levels.entry;
        chart._signalPriceLines = levelsAreDirectional ? [
          series.createPriceLine({ price: levels.entry, color: isSell ? '#f43f5e' : '#3b82f6', lineWidth: 2, axisLabelVisible: true, title: isSell ? 'SELL ENTRY' : 'BUY ENTRY' }),
          series.createPriceLine({ price: levels.stopLoss, color: '#f43f5e', lineWidth: 2, axisLabelVisible: true, title: 'STOP LOSS' }),
          series.createPriceLine({ price: levels.takeProfit, color: '#10b981', lineWidth: 2, axisLabelVisible: true, title: isSell ? 'TAKE PROFIT · BUY BACK' : 'TAKE PROFIT · SELL' }),
        ] : [];
      } else {
        chart._signalPriceLines = [];
      }
    }
  }

  useEffect(() => {
    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };
    
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (chartRef.current) chartRef.current.remove();
    };
  }, []);

  const isBullish = trend?.status?.includes('Bullish');
  const isBearish = trend?.status?.includes('Bearish');

  return (
    <div className="w-full rounded-lg overflow-hidden border border-slate-800 bg-slate-900">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 text-xs font-mono">
        <span className="text-slate-200 font-bold">{symbol} · {timeframe.toUpperCase()}</span>
        <span className={dataSource === 'MetaTrader5' ? 'text-emerald-400' : 'text-amber-300'}>{dataSource.toUpperCase()}</span>
      </div>
      {/* Trend Status Banner */}
      {trend && (
        <div className={`flex items-center justify-center gap-3 py-2.5 px-4 border-b ${
          isBullish 
            ? 'bg-emerald-950/60 border-emerald-700/40' 
            : isBearish 
              ? 'bg-rose-950/60 border-rose-700/40'
              : 'bg-amber-950/60 border-amber-700/40'
        }`}>
          {isBullish && <TrendingUp className="w-5 h-5 text-emerald-400" />}
          {isBearish && <TrendingDown className="w-5 h-5 text-rose-400" />}
          {!isBullish && !isBearish && <Minus className="w-5 h-5 text-amber-400" />}
          <span className={`font-bold text-sm tracking-wide ${
            isBullish ? 'text-emerald-400' : isBearish ? 'text-rose-400' : 'text-amber-400'
          }`}>
            {trend.status}
          </span>
        </div>
      )}
      
      <div className="relative w-full h-[400px]">
        {loading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-900/80 backdrop-blur-sm">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-2" />
            <span className="text-slate-300 font-mono text-sm">Algorithmic Engine Computing...</span>
          </div>
        )}
        
        {error && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-900/80 backdrop-blur-sm">
            <div className="text-rose-500 font-bold mb-1">Chart Engine Error</div>
            <div className="text-slate-400 text-xs">{error}</div>
          </div>
        )}
        
        <div ref={chartContainerRef} className="w-full h-full" />
      </div>
    </div>
  );
}
