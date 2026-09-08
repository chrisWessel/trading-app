'use client';

import React, { useEffect, useState } from 'react';
import { Bell, Zap, ArrowUpRight, ArrowDownRight, Volume2, VolumeX, Shield, Target, Play, Clock, Navigation } from 'lucide-react';
import { API_BASE_URL } from '@/lib/apiConfig';

interface TradeParams {
  entry: number;
  stop_loss: number;
  tp1: number;
  tp2: number;
  rationale: string;
}

interface SignalAnalysis {
  symbol: string;
  timeframe: string;
  latest_price: number;
  support: number;
  resistance: number;
  volume: number;
  vol_ratio: number;
  obi_score: number;
  price_position_pct: number;
  conditions: {
    support_retest: boolean;
    volume_surge: boolean;
    obi_demand: boolean;
  };
  signal_triggered: boolean;
  signal_type: string;
  trade_params: TradeParams;
}

interface NotificationItem {
  id: string;
  time_harare: string;
  type: 'BUY_NOW' | 'SELL_NOW' | 'STOP_LOSS_ALERT';
  title: string;
  message: string;
  entry: number;
  stop_loss: number;
  take_profit: number;
  rationale: string;
}

interface LiveSignalNotificationPanelProps {
  symbol: string;
  timeframe: string;
  onExecuteTradeParams?: (params: { signal_type: string; entry: number; stop_loss: number; take_profit: number }) => void;
}

export default function LiveSignalNotificationPanel({
  symbol,
  timeframe,
  onExecuteTradeParams,
}: LiveSignalNotificationPanelProps) {
  const [analysis, setAnalysis] = useState<SignalAnalysis | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

  const isHighValue = (analysis?.latest_price || 0) > 10.0;
  const precision = isHighValue ? 2 : 4;

  const fetchSignal = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/signals/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, timeframe, force_dispatch: false }),
      });
      if (res.ok) {
        const data = await res.json();
        const a: SignalAnalysis = data.analysis;
        setAnalysis(a);

        // Format Harare Time
        const now = new Date();
        const harareTime = now.toLocaleTimeString('en-US', {
          timeZone: 'Africa/Harare',
          hour12: true,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });

        const isBuy = a.signal_type.includes('BUY') || a.signal_type.includes('LONG');
        const notifType: 'BUY_NOW' | 'SELL_NOW' | 'STOP_LOSS_ALERT' = isBuy ? 'BUY_NOW' : 'SELL_NOW';
        
        const notifTitle = isBuy
          ? `🟢 BUY NOW! ENTRY FOR ${symbol}`
          : `🔴 SELL NOW! SHORT FOR ${symbol}`;

        const notifMsg = isBuy
          ? `Bullish Demand at $${a.latest_price.toFixed(precision)}. Stop Loss: $${a.trade_params.stop_loss.toFixed(precision)}`
          : `Bearish Rejection at $${a.latest_price.toFixed(precision)}. Stop Loss: $${a.trade_params.stop_loss.toFixed(precision)}`;

        const newNotif: NotificationItem = {
          id: Math.random().toString(36).substring(2, 9),
          time_harare: harareTime,
          type: notifType,
          title: notifTitle,
          message: notifMsg,
          entry: a.trade_params.entry,
          stop_loss: a.trade_params.stop_loss,
          take_profit: a.trade_params.tp1,
          rationale: a.trade_params.rationale,
        };

        setNotifications((prev) => [newNotif, ...prev.slice(0, 50)]);
      }
    } catch (e) {
      console.error('Signal notification error:', e);
    }
  };

  useEffect(() => {
    fetchSignal();
    const interval = setInterval(fetchSignal, 3000);
    return () => clearInterval(interval);
  }, [symbol, timeframe]);

  const latestNotif = notifications[0];

  return (
    <aside className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-2xl flex flex-col h-full max-h-[calc(100vh-2rem)] sticky top-4 space-y-4 font-mono overflow-hidden">
      {/* Sidebar Top Header */}
      <div className="space-y-3 pb-3 border-b border-slate-800 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-blue-950 p-2 rounded-lg border border-blue-800/80">
              <Navigation className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-tight">Signal Navigator</h2>
              <span className="text-[10px] text-emerald-400 font-bold block">
                ZIMBABWE HARARE ALERTS
              </span>
            </div>
          </div>

          {/* Audio Toggle Button */}
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={`p-1.5 rounded-lg border transition ${
              soundEnabled
                ? 'bg-blue-950 text-blue-400 border-blue-800'
                : 'bg-slate-950 text-slate-500 border-slate-800'
            }`}
            title={soundEnabled ? 'Mute Audio' : 'Enable Audio'}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Primary Active Action Card */}
      {latestNotif && (
        <div
          className={`p-3.5 rounded-xl border shadow-xl space-y-3 shrink-0 transition-all ${
            latestNotif.type === 'BUY_NOW'
              ? 'bg-gradient-to-b from-emerald-950/90 to-slate-950 border-emerald-600/80'
              : 'bg-gradient-to-b from-rose-950/90 to-slate-950 border-rose-600/80'
          }`}
        >
          <div className="flex items-center justify-between">
            {latestNotif.type === 'BUY_NOW' ? (
              <span className="px-2.5 py-1 bg-emerald-600 text-white font-extrabold text-xs rounded-lg animate-pulse flex items-center gap-1">
                <ArrowUpRight className="w-4 h-4" /> BUY NOW!
              </span>
            ) : (
              <span className="px-2.5 py-1 bg-rose-600 text-white font-extrabold text-xs rounded-lg animate-pulse flex items-center gap-1">
                <ArrowDownRight className="w-4 h-4" /> SELL NOW!
              </span>
            )}
            <span className="text-[11px] text-slate-300 font-bold flex items-center gap-1">
              <Clock className="w-3 h-3 text-blue-400" />
              <span>{latestNotif.time_harare}</span>
            </span>
          </div>

          <div>
            <h3 className="text-xs font-bold text-white leading-snug">{latestNotif.title}</h3>
            <p className="text-[11px] text-slate-300 mt-1 leading-snug">{latestNotif.message}</p>
          </div>

          {/* Trade Parameters List */}
          <div className="space-y-1.5 pt-2 border-t border-slate-800 text-[11px]">
            <div className="flex justify-between bg-slate-950/80 px-2 py-1 rounded border border-blue-950">
              <span className="text-blue-400 font-bold">ENTRY:</span>
              <span className="text-white font-bold">${latestNotif.entry.toFixed(precision)}</span>
            </div>
            <div className="flex justify-between bg-slate-950/80 px-2 py-1 rounded border border-rose-950">
              <span className="text-rose-400 font-bold">STOP LOSS:</span>
              <span className="text-rose-300 font-bold">${latestNotif.stop_loss.toFixed(precision)}</span>
            </div>
            <div className="flex justify-between bg-slate-950/80 px-2 py-1 rounded border border-emerald-950">
              <span className="text-emerald-400 font-bold">TAKE PROFIT:</span>
              <span className="text-emerald-300 font-bold">${latestNotif.take_profit.toFixed(precision)}</span>
            </div>
          </div>

          {/* Quick Auto-Fill Execution Button */}
          {onExecuteTradeParams && (
            <button
              onClick={() =>
                onExecuteTradeParams({
                  signal_type: latestNotif.type === 'BUY_NOW' ? 'BUY/LONG' : 'SELL/SHORT',
                  entry: latestNotif.entry,
                  stop_loss: latestNotif.stop_loss,
                  take_profit: latestNotif.take_profit,
                })
              }
              className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-lg shadow-lg transition flex items-center justify-center gap-1.5"
            >
              <Play className="w-3.5 h-3.5 fill-white" />
              <span>Auto-Fill Paper Order</span>
            </button>
          )}
        </div>
      )}

      {/* Vertical Navigation Signal Feed History (Stretches down to bottom) */}
      <div className="flex-1 min-h-0 flex flex-col space-y-2 overflow-hidden">
        <h4 className="text-[11px] font-bold text-slate-400 font-sans uppercase tracking-wider border-b border-slate-800 pb-1 shrink-0">
          Live Action History Log
        </h4>
        <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1 scrollbar-thin">
          {notifications.slice(1).map((item) => (
            <div
              key={item.id}
              className="bg-slate-950 border border-slate-800/80 rounded-lg p-2.5 space-y-1 text-[11px] transition hover:border-slate-700"
            >
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-slate-500">{item.time_harare}</span>
                <span
                  className={`px-1.5 py-0.5 rounded font-bold ${
                    item.type === 'BUY_NOW'
                      ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                      : 'bg-rose-950 text-rose-400 border border-rose-800'
                  }`}
                >
                  {item.type}
                </span>
              </div>
              <div className="text-slate-200 font-bold leading-tight">{item.title}</div>
              <div className="flex justify-between text-[10px] text-slate-400 pt-0.5 border-t border-slate-900">
                <span>Entry: ${item.entry.toFixed(precision)}</span>
                <span className="text-rose-400">SL: ${item.stop_loss.toFixed(precision)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
