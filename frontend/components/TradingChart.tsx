'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createChart, IChartApi, ISeriesApi, ColorType, LineStyle, IPriceLine } from 'lightweight-charts';
import { RefreshCw, Zap, ShieldAlert, ChevronDown, Clock, Radio, ArrowUpRight, ArrowDownRight, Shield, Target, AlertOctagon } from 'lucide-react';
import { API_BASE_URL, getWsUrl } from '@/lib/apiConfig';

interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface TradingChartProps {
  symbol: string;
  timeframe: string;
  onTimeframeChange: (tf: string) => void;
  onLatestDataUpdate?: (data: { price: number; support: number; resistance: number }) => void;
}

const HARARE_TZ_OFFSET_SEC = 2 * 3600; // Africa/Harare (CAT / UTC+2)

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

export default function TradingChart({
  symbol,
  timeframe,
  onTimeframeChange,
  onLatestDataUpdate,
}: TradingChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const lastBarTimeRef = useRef<number>(0);

  const [initialLoading, setInitialLoading] = useState<boolean>(false); // 0ms Instant Flash Load
  const [error, setError] = useState<string | null>(null);
  const [latestPrice, setLatestPrice] = useState<number>(4310.37);
  const [supportLevel, setSupportLevel] = useState<number>(4280.0);
  const [resistanceLevel, setResistanceLevel] = useState<number>(4330.0);
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [showDropdown, setShowDropdown] = useState<boolean>(false);

  const [signalType, setSignalType] = useState<string>('BUY/LONG');
  const [tradeParams, setTradeParams] = useState<any>(null);
  const [sdZones, setSdZones] = useState<any>(null);

  const isHighValueAsset = latestPrice > 10.0;
  const precision = isHighValueAsset ? 2 : 4;

  const buyEntryPrice = latestPrice;
  const stopLossPrice = Number((supportLevel * 0.985).toFixed(precision));
  const riskAmount = Math.max(0.0001, buyEntryPrice - stopLossPrice);
  const takeProfitPrice = Number((buyEntryPrice + (riskAmount * 1.5)).toFixed(precision));

  const clearPriceLines = () => {
    if (candlestickSeriesRef.current && priceLinesRef.current.length > 0) {
      for (const line of priceLinesRef.current) {
        try {
          candlestickSeriesRef.current.removePriceLine(line);
        } catch (e) {
          // Ignore
        }
      }
      priceLinesRef.current = [];
    }
  };

  const drawTechnicalPriceLines = (supp: number, resis: number, price: number, sigType?: string, tp?: any, zones?: any) => {
    if (!candlestickSeriesRef.current) return;
    clearPriceLines();

    const isSell = sigType === 'SELL/SHORT';
    const sl = tp?.stop_loss ?? (isSell ? Number((resis * 1.015).toFixed(precision)) : Number((supp * 0.985).toFixed(precision)));
    const takeProfit = tp?.tp1 ?? (isSell ? Number((price - Math.abs(price - sl) * 1.5).toFixed(precision)) : Number((price + Math.abs(price - sl) * 1.5).toFixed(precision)));

    try {
      // 🔴 Resistance Line
      const resLine = candlestickSeriesRef.current.createPriceLine({
        price: resis,
        color: '#EF4444',
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: `🔴 RESISTANCE: $${resis.toFixed(precision)}`,
      });

      // 🟢 Support Line
      const suppLine = candlestickSeriesRef.current.createPriceLine({
        price: supp,
        color: '#10B981',
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: `🟢 SUPPORT: $${supp.toFixed(precision)}`,
      });

      // Entry Line
      const entryLine = candlestickSeriesRef.current.createPriceLine({
        price: price,
        color: isSell ? '#EF4444' : '#3B82F6',
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: isSell ? `🔴 SELL ENTRY: $${price.toFixed(precision)}` : `🔵 BUY ENTRY: $${price.toFixed(precision)}`,
      });

      // 🛑 Stop Loss Line
      const slLine = candlestickSeriesRef.current.createPriceLine({
        price: sl,
        color: '#F43F5E',
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: `🛑 STOP LOSS: $${sl.toFixed(precision)}`,
      });

      // 🎯 Take Profit Line
      const tpLine = candlestickSeriesRef.current.createPriceLine({
        price: takeProfit,
        color: '#10B981',
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: `🎯 TAKE PROFIT: $${takeProfit.toFixed(precision)}`,
      });

      priceLinesRef.current = [resLine, suppLine, entryLine, slLine, tpLine];

      // 📦 Supply & Demand Zones
      if (zones?.supply) {
        zones.supply.forEach((zone: any) => {
          const l1 = candlestickSeriesRef.current!.createPriceLine({
            price: zone.top,
            color: 'rgba(239, 68, 68, 0.4)',
            lineWidth: 2,
            lineStyle: LineStyle.Solid,
            axisLabelVisible: false,
            title: 'Supply Zone',
          });
          const l2 = candlestickSeriesRef.current!.createPriceLine({
            price: zone.bottom,
            color: 'rgba(239, 68, 68, 0.4)',
            lineWidth: 2,
            lineStyle: LineStyle.Solid,
            axisLabelVisible: false,
            title: '',
          });
          priceLinesRef.current.push(l1, l2);
        });
      }

      if (zones?.demand) {
        zones.demand.forEach((zone: any) => {
          const l1 = candlestickSeriesRef.current!.createPriceLine({
            price: zone.top,
            color: 'rgba(59, 130, 246, 0.4)',
            lineWidth: 2,
            lineStyle: LineStyle.Solid,
            axisLabelVisible: false,
            title: 'Demand Zone',
          });
          const l2 = candlestickSeriesRef.current!.createPriceLine({
            price: zone.bottom,
            color: 'rgba(59, 130, 246, 0.4)',
            lineWidth: 2,
            lineStyle: LineStyle.Solid,
            axisLabelVisible: false,
            title: '',
          });
          priceLinesRef.current.push(l1, l2);
        });
      }

    } catch (e) {
      console.error('Failed to draw price lines:', e);
    }
  };

  const fetchInitialHistory = async () => {
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}&limit=100`);
      if (!res.ok) {
        throw new Error(`API error: ${res.statusText}`);
      }
      const data = await res.json();

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

      let fetchedSigType = 'BUY/LONG';
      let fetchedParams = null;
      let fetchedZones = null;
      try {
        const sigRes = await fetch(`${API_BASE_URL}/api/signals/check`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol, timeframe }),
        });
        if (sigRes.ok) {
          const sigData = await sigRes.json();
          if (sigData.analysis) {
            fetchedSigType = sigData.analysis.signal_type;
            fetchedParams = sigData.analysis.trade_params;
            fetchedZones = sigData.analysis.sd_zones;
            setSignalType(sigData.analysis.signal_type);
            setTradeParams(sigData.analysis.trade_params);
            setSdZones(sigData.analysis.sd_zones);
          }
        }
      } catch (e) {
        // Quiet fail
      }

      if (candlestickSeriesRef.current && data.candles && data.candles.length > 0) {
        const sortedCandles = [...data.candles].sort((a: any, b: any) => a.time - b.time);
        
        const uniqueCandles: CandleData[] = [];
        const seenTimes = new Set();
        for (const c of sortedCandles) {
          const rawSec = c.time > 20000000000 ? Math.floor(c.time / 1000) : c.time;
          const harareSec = rawSec + HARARE_TZ_OFFSET_SEC;
          if (!seenTimes.has(harareSec)) {
            seenTimes.add(harareSec);
            uniqueCandles.push({ ...c, time: harareSec });
          }
        }

        if (uniqueCandles.length > 0) {
          lastBarTimeRef.current = uniqueCandles[uniqueCandles.length - 1].time;
        }

        candlestickSeriesRef.current.setData(uniqueCandles as any);

        if (volumeSeriesRef.current) {
          const volumeData = uniqueCandles.map((c) => ({
            time: c.time as any,
            value: c.volume,
            color: c.close >= c.open ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)',
          }));
          volumeSeriesRef.current.setData(volumeData as any);
        }

        drawTechnicalPriceLines(data.support, data.resistance, data.latest_price, fetchedSigType, fetchedParams, fetchedZones);
        chartRef.current?.timeScale().fitContent();
      }
    } catch (err: any) {
      console.error('Failed to fetch candles:', err);
      setError('Backend connection error. Make sure FastAPI server is running on port 8000.');
    }
  };

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#0F172A' },
        textColor: '#94A3B8',
      },
      grid: {
        vertLines: { color: 'rgba(51, 65, 85, 0.4)' },
        horzLines: { color: 'rgba(51, 65, 85, 0.4)' },
      },
      width: chartContainerRef.current.clientWidth,
      height: 420,
      rightPriceScale: {
        borderColor: '#334155',
        scaleMargins: { top: 0.1, bottom: 0.25 },
      },
      timeScale: {
        borderColor: '#334155',
        timeVisible: true,
        secondsVisible: true,
        shiftVisibleRangeOnNewBar: true,
        rightOffset: 3,
      },
      crosshair: {
        vertLine: { color: '#64748B', style: 1 },
        horzLine: { color: '#64748B', style: 1 },
      },
    });

    const candlestickSeries = chart.addCandlestickSeries({
      upColor: '#10B981',
      downColor: '#EF4444',
      borderVisible: false,
      wickUpColor: '#10B981',
      wickDownColor: '#EF4444',
    });

    const volumeSeries = chart.addHistogramSeries({
      color: '#3B82F6',
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    } as any);

    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    chartRef.current = chart;
    candlestickSeriesRef.current = candlestickSeries;
    volumeSeriesRef.current = volumeSeries;

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
        });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, []);

  useEffect(() => {
    fetchInitialHistory();

    let ws: WebSocket | null = null;
    let reconnectTimer: NodeJS.Timeout | null = null;

    const connectWebSocket = () => {
      try {
        const wsUrl = getWsUrl(`/ws/candles/${encodeURIComponent(symbol)}`);
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          setWsConnected(true);
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.price) {
              setLatestPrice(data.price);
              setSupportLevel(data.support);
              setResistanceLevel(data.resistance);

              if (onLatestDataUpdate) {
                onLatestDataUpdate({
                  price: data.price,
                  support: data.support,
                  resistance: data.resistance,
                });
              }

              const rawSec = data.time > 20000000000 ? Math.floor(data.time / 1000) : data.time;
              const harareSec = rawSec + HARARE_TZ_OFFSET_SEC;

              const validTime = Math.max(harareSec, lastBarTimeRef.current);
              lastBarTimeRef.current = validTime;

              if (candlestickSeriesRef.current) {
                candlestickSeriesRef.current.update({
                  time: validTime as any,
                  open: data.open,
                  high: data.high,
                  low: data.low,
                  close: data.price,
                });
              }

              if (volumeSeriesRef.current && data.volume) {
                volumeSeriesRef.current.update({
                  time: validTime as any,
                  value: data.volume,
                  color: data.price >= data.open ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)',
                });
              }
            }
          } catch (err) {
            // Quiet fail
          }
        };

        ws.onerror = () => {
          setWsConnected(false);
        };

        ws.onclose = () => {
          setWsConnected(false);
          reconnectTimer = setTimeout(() => connectWebSocket(), 2000);
        };
      } catch (e) {
        setWsConnected(false);
      }
    };

    connectWebSocket();

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, [timeframe, symbol]);

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
              ${latestPrice.toFixed(precision)}
            </span>
            <span className={`flex items-center gap-1.5 text-xs border px-2.5 py-0.5 rounded-full font-mono font-bold transition ${
              wsConnected
                ? 'bg-emerald-950 text-emerald-400 border-emerald-800/80'
                : 'bg-amber-950 text-amber-400 border-amber-800/80'
            }`}>
              <Radio className={`w-3.5 h-3.5 ${wsConnected ? 'animate-pulse text-emerald-400' : 'text-amber-400'}`} />
              <span>{wsConnected ? 'Flash WebSocket Stream' : 'Connecting...'}</span>
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
            onClick={fetchInitialHistory}
            title="Refresh chart data"
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-md transition border-l border-slate-800 pl-1"
          >
            <RefreshCw className="w-3.5 h-3.5 text-blue-400" />
          </button>
        </div>
      </div>

      {/* Visual Technical Trading Decision Lines Guide Bar */}
      {signalType === 'SELL/SHORT' ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
          <div className="bg-slate-950 p-2 rounded-lg border border-rose-800/60 flex items-center justify-between">
            <div>
              <span className="text-rose-400 block text-[10px] font-bold">🔴 WHEN TO SELL / SHORT (ENTRY)</span>
              <span className="text-white font-bold">${latestPrice.toFixed(precision)}</span>
            </div>
            <ArrowDownRight className="w-4 h-4 text-rose-400" />
          </div>

          <div className="bg-slate-950 p-2 rounded-lg border border-rose-800/60 flex items-center justify-between">
            <div>
              <span className="text-rose-400 block text-[10px] font-bold">🛑 STOP LOSS LINE</span>
              <span className="text-rose-300 font-bold">${(tradeParams?.stop_loss ?? stopLossPrice).toFixed(precision)}</span>
            </div>
            <Shield className="w-4 h-4 text-rose-400" />
          </div>

          <div className="bg-slate-950 p-2 rounded-lg border border-emerald-800/60 flex items-center justify-between">
            <div>
              <span className="text-emerald-400 block text-[10px] font-bold">🎯 TAKE PROFIT (BUY BACK)</span>
              <span className="text-emerald-300 font-bold">${(tradeParams?.tp1 ?? takeProfitPrice).toFixed(precision)}</span>
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
              <span className="text-white font-bold">${buyEntryPrice.toFixed(precision)}</span>
            </div>
            <ArrowUpRight className="w-4 h-4 text-blue-400" />
          </div>

          <div className="bg-slate-950 p-2 rounded-lg border border-rose-800/60 flex items-center justify-between">
            <div>
              <span className="text-rose-400 block text-[10px] font-bold">🛑 STOP LOSS LINE</span>
              <span className="text-rose-300 font-bold">${(tradeParams?.stop_loss ?? stopLossPrice).toFixed(precision)}</span>
            </div>
            <Shield className="w-4 h-4 text-rose-400" />
          </div>

          <div className="bg-slate-950 p-2 rounded-lg border border-emerald-800/60 flex items-center justify-between">
            <div>
              <span className="text-emerald-400 block text-[10px] font-bold">🎯 TAKE PROFIT (SELL)</span>
              <span className="text-emerald-300 font-bold">${(tradeParams?.tp1 ?? takeProfitPrice).toFixed(precision)}</span>
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
      )}

      {/* Chart Canvas (Flash 0ms Load) */}
      <div className="relative w-full h-[420px] rounded-lg overflow-hidden border border-slate-950">
        {error && (
          <div className="absolute inset-0 bg-slate-900/90 z-10 flex flex-col items-center justify-center p-4 text-center">
            <ShieldAlert className="w-8 h-8 text-rose-500 mb-2" />
            <p className="text-rose-400 font-semibold text-sm">{error}</p>
            <button
              onClick={fetchInitialHistory}
              className="mt-3 px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg"
            >
              Retry Connection
            </button>
          </div>
        )}
        <div ref={chartContainerRef} className="w-full h-full" />
      </div>
    </div>
  );
}
