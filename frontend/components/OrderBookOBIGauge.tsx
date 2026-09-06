'use client';

import React, { useEffect, useState } from 'react';
import { Layers, Gauge } from 'lucide-react';
import { API_BASE_URL } from '@/lib/apiConfig';

interface OrderBookData {
  symbol: string;
  bids: [number, number][];
  asks: [number, number][];
  bid_volume: number;
  ask_volume: number;
  obi_score: number;
}

interface OrderBookOBIGaugeProps {
  symbol: string;
}

export default function OrderBookOBIGauge({ symbol }: OrderBookOBIGaugeProps) {
  const [orderbook, setOrderbook] = useState<OrderBookData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const fetchOrderBook = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/orderbook?symbol=${encodeURIComponent(symbol)}`);
      if (res.ok) {
        const data = await res.json();
        setOrderbook(data);
      }
    } catch (err) {
      console.error('Orderbook fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrderBook();
    const interval = setInterval(fetchOrderBook, 2000);
    return () => clearInterval(interval);
  }, [symbol]);

  const obi = orderbook?.obi_score ?? 0;
  const gaugePercent = Math.min(100, Math.max(0, ((obi + 1) / 2) * 100));

  const isHighValue = (orderbook?.bids?.[0]?.[0] || 0) > 10.0;
  const precision = isHighValue ? 2 : 4;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl flex flex-col gap-4 h-full min-h-[460px]">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <Layers className="w-5 h-5 text-blue-400" />
          <h2 className="text-lg font-bold text-white">Order Book & OBI Gauge</h2>
        </div>
        <span className="text-xs bg-slate-950 text-slate-400 border border-slate-800 px-2.5 py-1 rounded-full font-mono">
          Depth 20 Levels
        </span>
      </div>

      {/* Order Imbalance Indicator Gauge Bar */}
      <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-2 shrink-0">
        <div className="flex items-center justify-between text-xs font-mono">
          <span className="text-rose-400 font-bold">SELLER DOMINANCE (-1.0)</span>
          <div className="flex items-center gap-1.5 font-extrabold text-sm">
            <Gauge className="w-4 h-4 text-blue-400" />
            <span className={obi > 0.3 ? 'text-emerald-400' : obi < -0.3 ? 'text-rose-400' : 'text-amber-400'}>
              OBI Score: {obi >= 0 ? `+${obi.toFixed(2)}` : obi.toFixed(2)}
            </span>
          </div>
          <span className="text-emerald-400 font-bold">BUYER DEMAND (+1.0)</span>
        </div>

        {/* Dynamic Visual Gauge Progress */}
        <div className="w-full bg-slate-900 h-3.5 rounded-full overflow-hidden p-0.5 border border-slate-800 relative">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              obi > 0.3 ? 'bg-emerald-500' : obi < -0.3 ? 'bg-rose-500' : 'bg-amber-500'
            }`}
            style={{ width: `${gaugePercent}%` }}
          />
        </div>
      </div>

      {/* Order Book Depth Table Stretched Down to Fill Entire Height */}
      <div className="grid grid-cols-2 gap-3 flex-1 font-mono text-xs overflow-hidden">
        {/* Bids Column (Green) */}
        <div className="bg-slate-950 border border-slate-800/80 rounded-lg p-3 space-y-1.5 overflow-y-auto h-full flex flex-col justify-start">
          <div className="text-[10px] text-emerald-400 font-sans font-bold flex justify-between pb-1.5 border-b border-slate-800 sticky top-0 bg-slate-950">
            <span>BUY BIDS ($)</span>
            <span>QTY</span>
          </div>
          <div className="space-y-1">
            {orderbook?.bids?.slice(0, 16).map(([price, vol], idx) => (
              <div key={idx} className="flex justify-between text-[11px] hover:bg-emerald-950/30 px-1 py-0.5 rounded transition">
                <span className="text-emerald-400 font-bold">${price.toFixed(precision)}</span>
                <span className="text-slate-300">{vol.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Asks Column (Red) */}
        <div className="bg-slate-950 border border-slate-800/80 rounded-lg p-3 space-y-1.5 overflow-y-auto h-full flex flex-col justify-start">
          <div className="text-[10px] text-rose-400 font-sans font-bold flex justify-between pb-1.5 border-b border-slate-800 sticky top-0 bg-slate-950">
            <span>SELL ASKS ($)</span>
            <span>QTY</span>
          </div>
          <div className="space-y-1">
            {orderbook?.asks?.slice(0, 16).map(([price, vol], idx) => (
              <div key={idx} className="flex justify-between text-[11px] hover:bg-rose-950/30 px-1 py-0.5 rounded transition">
                <span className="text-rose-400 font-bold">${price.toFixed(precision)}</span>
                <span className="text-slate-300">{vol.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
