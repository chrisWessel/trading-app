"use client";

import React, { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, IChartApi, SeriesMarker, Time } from 'lightweight-charts';
import { Loader2 } from 'lucide-react';
import { API_BASE_URL } from '@/lib/apiConfig';

interface CustomChartProps {
  symbol: string;
  timeframe: string;
  tabId: string;
}

export default function CustomAlgorithmicChart({ symbol, timeframe, tabId }: CustomChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    let pollInterval: NodeJS.Timeout;
    
    async function fetchData(isInitialLoad: boolean = false) {
      try {
        if (isInitialLoad) {
          setLoading(true);
        }
        setError(null);
        
        const res = await fetch(`${API_BASE_URL}/api/chart-data?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&limit=300`);
        if (!res.ok) throw new Error("Failed to fetch chart data");
        const data = await res.json();
        
        if (!isMounted) return;

        if (data.status === 'success') {
          renderChart(data.candles, data.pivots, isInitialLoad);
        } else {
          setError("Failed to load market data");
        }
      } catch (err: any) {
        if (isMounted) setError(err.message || "Error fetching data");
      } finally {
        if (isMounted && isInitialLoad) {
          setLoading(false);
        }
      }
    }
    
    // Initial fetch
    fetchData(true);
    
    // Setup polling every 5 seconds for live feed
    pollInterval = setInterval(() => {
      fetchData(false);
    }, 5000);
    
    return () => {
      isMounted = false;
      clearInterval(pollInterval);
    };
  }, [symbol, timeframe, tabId]);
  
  function renderChart(candles: any[], pivots: any[], isInitialLoad: boolean) {
    if (!chartContainerRef.current) return;
    
    // Only rebuild the chart completely on initial load to avoid flickering
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
      rightPriceScale: {
        borderColor: '#1e293b',
      },
    });
    
    chartRef.current = chart;
    
      
      const sortedCandles = [...candles].sort((a, b) => a.time - b.time);
      
      const candlestickSeries = chart.addCandlestickSeries({
        upColor: '#22c55e',
        downColor: '#ef4444',
        borderVisible: false,
        wickUpColor: '#22c55e',
        wickDownColor: '#ef4444',
      });
      
      candlestickSeries.setData(sortedCandles);
      
      const lineSeries = chart.addLineSeries({
        color: '#3b82f6',
        lineWidth: 2,
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
      });
      
      const sortedPivots = [...pivots].sort((a, b) => a.time - b.time);
      const lineData = sortedPivots.map(p => ({ time: p.time, value: p.price }));
      if (lineData.length > 0) {
        lineSeries.setData(lineData as any);
      }
      
      const markers: SeriesMarker<Time>[] = sortedPivots.map(p => {
        const isHigh = p.type === 'HIGH';
        return {
          time: p.time as Time,
          position: isHigh ? 'aboveBar' : 'belowBar',
          color: p.color,
          shape: isHigh ? 'arrowDown' : 'arrowUp',
          text: p.label,
          size: 1,
        };
      });
      
      candlestickSeries.setMarkers(markers);
      chart.timeScale().fitContent();
      
      // Store references on the chart object so we can update them on next polls
      (chart as any)._candlestickSeries = candlestickSeries;
      (chart as any)._lineSeries = lineSeries;
    } else if (chartRef.current) {
      // Update existing chart seamlessly
      const chart: any = chartRef.current;
      if (chart._candlestickSeries && chart._lineSeries) {
        const sortedCandles = [...candles].sort((a, b) => a.time - b.time);
        chart._candlestickSeries.setData(sortedCandles);
        
        const sortedPivots = [...pivots].sort((a, b) => a.time - b.time);
        const lineData = sortedPivots.map(p => ({ time: p.time, value: p.price }));
        if (lineData.length > 0) {
          chart._lineSeries.setData(lineData as any);
        }
        
        const markers: SeriesMarker<Time>[] = sortedPivots.map(p => {
          const isHigh = p.type === 'HIGH';
          return {
            time: p.time as Time,
            position: isHigh ? 'aboveBar' : 'belowBar',
            color: p.color,
            shape: isHigh ? 'arrowDown' : 'arrowUp',
            text: p.label,
            size: 1,
          };
        });
        chart._candlestickSeries.setMarkers(markers);
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
      if (chartRef.current) {
        chartRef.current.remove();
      }
    };
  }, []);

  return (
    <div className="w-full h-[420px] rounded-lg overflow-hidden border border-slate-950 relative bg-slate-900">
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
  );
}
