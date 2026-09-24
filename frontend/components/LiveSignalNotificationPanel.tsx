'use client';

import React, { useEffect, useState, useRef } from 'react';
import { Bell, Zap, ArrowUpRight, ArrowDownRight, Volume2, VolumeX, Shield, Target, Play, Clock, Navigation } from 'lucide-react';
import { API_BASE_URL } from '@/lib/apiConfig';

interface TradeParams {
  entry: number;
  entry_zones: number[];
  stop_loss: number;
  tp1: number;
  tp2: number;
  tp_levels: number[];
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
  timeframe: string;
  type: 'BUY_NOW' | 'SELL_NOW' | 'STOP_LOSS_ALERT' | 'MONITORING';
  title: string;
  message: string;
  entry: number;
  entry_zones: number[];
  stop_loss: number;
  tp1: number;
  tp2: number;
  tp_levels: number[];
  rationale: string;
}

// Frozen params are locked on the first signal trigger of a given direction.
// They only reset when the signal direction changes (BUY → SELL or vice versa).
interface FrozenParams {
  signal_type: string;
  entry: number;
  entry_zones: number[];
  stop_loss: number;
  tp1: number;
  tp2: number;
  tp_levels: number[];
}

interface LiveSignalNotificationPanelProps {
  symbol: string;
  timeframe: string;
  onExecuteTradeParams?: (params: { signal_type: string; entry: number; stop_loss: number; tp1: number; tp2: number; tp_levels: number[]; entry_zones: number[] }) => void;
}

export default function LiveSignalNotificationPanel({
  symbol,
  timeframe,
  onExecuteTradeParams,
}: LiveSignalNotificationPanelProps) {
  const [analysis, setAnalysis] = useState<SignalAnalysis | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [showTpGuidance, setShowTpGuidance] = useState<boolean>(false);
  const [selectedTpIndex, setSelectedTpIndex] = useState<number>(0); // which TP level is highlighted

  // Frozen params — locked once per signal direction change.
  // This prevents SL/TP from jittering on every 3-second poll.
  const frozenRef = useRef<FrozenParams | null>(null);
  const [frozenParams, setFrozenParams] = useState<FrozenParams | null>(null);

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

        const isBuy = a.signal_type === 'BUY/LONG';
        const isSell = a.signal_type === 'SELL/SHORT';
        const notifType: 'BUY_NOW' | 'SELL_NOW' | 'MONITORING' = isBuy ? 'BUY_NOW' : isSell ? 'SELL_NOW' : 'MONITORING';

        // ── LIVE VALUES: backend computes everything from the current live price each poll.
        // Always update zones, SL, and TPs so they stay accurate with the market.
        // Only reset the TP chip selection when the signal DIRECTION changes.
        const incoming_zones: number[] = a.trade_params.entry_zones || [];
        const incoming_tp_levels: number[] = a.trade_params.tp_levels || [];

        const prevFrozen = frozenRef.current;
        const directionChanged = !prevFrozen || prevFrozen.signal_type !== a.signal_type;

        const latestParams: FrozenParams = {
          signal_type: a.signal_type,
          entry: a.trade_params.entry,
          entry_zones: incoming_zones,
          stop_loss: a.trade_params.stop_loss,
          tp1: a.trade_params.tp1,
          tp2: a.trade_params.tp2,
          tp_levels: incoming_tp_levels,
        };
        frozenRef.current = latestParams;
        setFrozenParams(latestParams);

        if (directionChanged) {
          setSelectedTpIndex(0); // reset chip selection only on direction flip
        }


        let notifTitle = '';
        let notifMsg = '';

        if (isBuy) {
          notifTitle = `🟢 BUY NOW! [${timeframe.toUpperCase()}] ENTRY FOR ${symbol}`;
          notifMsg = `Bullish Demand on ${timeframe} timeframe at $${a.latest_price.toFixed(precision)}. Stop Loss: $${a.trade_params.stop_loss.toFixed(precision)}`;
        } else if (isSell) {
          notifTitle = `🔴 SELL NOW! [${timeframe.toUpperCase()}] SHORT FOR ${symbol}`;
          notifMsg = `Bearish Rejection / Downtrend on ${timeframe} timeframe at $${a.latest_price.toFixed(precision)}. Stop Loss: $${a.trade_params.stop_loss.toFixed(precision)}`;
        } else {
          notifTitle = `⏸️ MARKET STANDBY [${timeframe.toUpperCase()}] FOR ${symbol}`;
          notifMsg = `Consolidation on ${timeframe}. Monitoring market for high-probability setups.`;
        }

        const newNotif: NotificationItem = {
          id: Math.random().toString(36).substring(2, 9),
          time_harare: harareTime,
          timeframe: timeframe,
          type: notifType,
          title: notifTitle,
          message: notifMsg,
          entry: a.trade_params.entry,
          entry_zones: incoming_zones,
          stop_loss: a.trade_params.stop_loss,
          tp1: a.trade_params.tp1,
          tp2: a.trade_params.tp2,
          tp_levels: incoming_tp_levels,
          rationale: a.trade_params.rationale,
        };

        setNotifications((prev) => {
          const top = prev[0];
          if (top && top.type === notifType && top.title === notifTitle && top.timeframe === timeframe) {
            return [{ ...top, time_harare: harareTime }, ...prev.slice(1)];
          }
          return [newNotif, ...prev.filter(n => n.timeframe === timeframe).slice(0, 49)];
        });
      }
    } catch (e) {
      console.error('Signal notification error:', e);
    }
  };

  useEffect(() => {
    // Clear stale state when switching symbol or timeframe
    setNotifications([]);
    frozenRef.current = null;
    setFrozenParams(null);
    setSelectedTpIndex(0);
    fetchSignal();
    const interval = setInterval(fetchSignal, 3000);
    return () => clearInterval(interval);
  }, [symbol, timeframe]);

  const latestNotif = notifications[0];

  // Use frozen params for display (constant); fall back to latest notif while loading
  const displayEntry = frozenParams?.entry ?? latestNotif?.entry ?? 0;
  const displayEntryZones = frozenParams?.entry_zones ?? latestNotif?.entry_zones ?? [];
  const displaySL = frozenParams?.stop_loss ?? latestNotif?.stop_loss ?? 0;
  const displayTpLevels = frozenParams?.tp_levels ?? latestNotif?.tp_levels ?? [];
  const displayTp1 = frozenParams?.tp1 ?? latestNotif?.tp1 ?? 0;
  const displayTp2 = frozenParams?.tp2 ?? latestNotif?.tp2 ?? 0;

  // TP chip colors cycling green → teal → blue → purple
  const tpColors = [
    'border-emerald-700 text-emerald-300 bg-emerald-950/60',
    'border-teal-700 text-teal-300 bg-teal-950/60',
    'border-cyan-700 text-cyan-300 bg-cyan-950/60',
    'border-sky-700 text-sky-300 bg-sky-950/60',
    'border-blue-700 text-blue-300 bg-blue-950/60',
    'border-indigo-700 text-indigo-300 bg-indigo-950/60',
    'border-violet-700 text-violet-300 bg-violet-950/60',
  ];

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
              <span className="text-[10px] text-emerald-400 font-bold block flex items-center gap-1">
                <span>TIMEFRAME:</span>
                <span className="bg-blue-950 text-blue-300 border border-blue-800 px-1.5 py-0.2 rounded font-mono">
                  {timeframe.toUpperCase()}
                </span>
              </span>
            </div>
          </div>

          {/* Audio Toggle & TP Help */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowTpGuidance(!showTpGuidance)}
              className="p-1.5 rounded-lg border border-amber-800 bg-amber-950 text-amber-300 text-[10px] font-bold transition hover:bg-amber-900"
              title="When to use TP1 vs TP7"
            >
              TP Info
            </button>
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

        {showTpGuidance && (
          <div className="bg-slate-950 border border-amber-800/80 p-3 rounded-lg text-[10px] space-y-1.5 text-slate-300 font-sans">
            <div className="font-bold text-amber-400 flex items-center gap-1">
              <Target className="w-3.5 h-3.5" />
              <span>Take Profit Level Strategy:</span>
            </div>
            <div><strong className="text-emerald-400 font-mono">TP1–TP2 (Conservative):</strong> Lock in profits fast — close 50–75% of position here, move SL to entry (breakeven).</div>
            <div><strong className="text-sky-400 font-mono">TP3–TP5 (Standard):</strong> Strong momentum targets with 1:3–1:5 Risk-Reward ratio.</div>
            <div><strong className="text-violet-400 font-mono">TP6–TP7 (Runner):</strong> Extended trend targets — let 15–25% ride with a trailing stop. 1:6 plus R:R.</div>
            <div className="text-slate-400 pt-1 border-t border-slate-800">
              Each TP level is <span className="text-amber-300 font-bold">30 pips</span> further from entry.
              For <span className="text-rose-400 font-bold">SELL</span>: TPs go <strong>below</strong> entry price.
              For <span className="text-emerald-400 font-bold">BUY</span>: TPs go <strong>above</strong> entry price.
            </div>
          </div>
        )}
      </div>

      {/* Primary Active Action Card */}
      {latestNotif && (
        <div
          className={`p-3.5 rounded-xl border shadow-xl space-y-3 shrink-0 transition-all ${
            latestNotif.type === 'BUY_NOW'
              ? 'bg-gradient-to-b from-emerald-950/90 to-slate-950 border-emerald-600/80'
              : latestNotif.type === 'SELL_NOW'
              ? 'bg-gradient-to-b from-rose-950/90 to-slate-950 border-rose-600/80'
              : 'bg-gradient-to-b from-slate-900 to-slate-950 border-amber-600/60'
          }`}
        >
          <div className="flex items-center justify-between">
            {latestNotif.type === 'BUY_NOW' ? (
              <span className="px-2.5 py-1 bg-emerald-600 text-white font-extrabold text-xs rounded-lg animate-pulse flex items-center gap-1">
                <ArrowUpRight className="w-4 h-4" /> BUY NOW [{latestNotif.timeframe.toUpperCase()}]
              </span>
            ) : latestNotif.type === 'SELL_NOW' ? (
              <span className="px-2.5 py-1 bg-rose-600 text-white font-extrabold text-xs rounded-lg animate-pulse flex items-center gap-1">
                <ArrowDownRight className="w-4 h-4" /> SELL NOW [{latestNotif.timeframe.toUpperCase()}]
              </span>
            ) : (
              <span className="px-2.5 py-1 bg-amber-600 text-white font-extrabold text-xs rounded-lg flex items-center gap-1">
                <Clock className="w-4 h-4" /> STANDBY [{latestNotif.timeframe.toUpperCase()}]
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

          {/* Trade Parameters — FROZEN (constant across polls) */}
          <div className="space-y-2 pt-2 border-t border-slate-800 text-[11px]">

            {/* Stop Loss — single constant value */}
            <div className="flex justify-between bg-slate-950/80 px-2 py-1.5 rounded border border-rose-950">
              <span className="text-rose-400 font-bold flex items-center gap-1">
                <Shield className="w-3 h-3" /> STOP LOSS (FIXED):
              </span>
              <span className="text-rose-300 font-bold font-mono">${displaySL.toFixed(precision)}</span>
            </div>

            {/* Entry Zone Range — 5 levels, Z1 = current market price */}
            <div className="bg-slate-950/80 px-2 py-1.5 rounded border border-blue-950 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-blue-400 font-bold">ENTRY ZONE (5 LEVELS):</span>
                <span className="text-[9px] text-slate-500 font-mono">
                  {latestNotif.type === 'SELL_NOW' ? 'Z1=now, Z2-5 higher↑' : 'Z1=now, Z2-5 lower↓'}
                </span>
              </div>
              <div className="grid grid-cols-5 gap-1">
                {displayEntryZones.length > 0
                  ? displayEntryZones.map((z, i) => (
                      <div
                        key={i}
                        className={`text-center rounded px-1 py-0.5 border text-[9px] font-bold ${
                          i === 0
                            ? 'bg-blue-700 border-blue-500 text-white'  // Z1 = current market price
                            : 'bg-slate-900 border-slate-700 text-slate-300'
                        }`}
                        title={i === 0 ? 'Z1 = Current Market Price (immediate entry)' : `Zone ${i + 1}`}
                      >
                        <div className="text-slate-400 text-[8px]">{i === 0 ? 'NOW' : `Z${i + 1}`}</div>
                        ${z.toFixed(precision)}
                      </div>
                    ))
                  : <span className="col-span-5 text-slate-500 text-[10px]">${displayEntry.toFixed(precision)}</span>
                }
              </div>
            </div>

            {/* 7 TP Levels — selectable chips */}
            <div className="bg-slate-950/80 px-2 py-1.5 rounded border border-emerald-950 space-y-1">
              <span className="text-emerald-400 font-bold block">TAKE PROFIT LEVELS (7 levels — timeframe-scaled):</span>
              <div className="grid grid-cols-4 gap-1">
                {displayTpLevels.length > 0
                  ? displayTpLevels.map((tp, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setSelectedTpIndex(i)}
                        className={`text-center rounded px-1 py-1 border text-[9px] font-bold transition ${
                          selectedTpIndex === i
                            ? tpColors[i].replace('/60', '') + ' ring-1 ring-white/30'
                            : tpColors[i]
                        }`}
                        title={`TP${i + 1}`}
                      >
                        <div className="text-[8px] opacity-70">TP{i + 1}</div>
                        ${tp.toFixed(precision)}
                      </button>
                    ))
                  : <>
                      <div className="bg-emerald-950 border border-emerald-800 rounded px-1 py-1 text-emerald-300 text-[9px] font-bold">
                        <div className="text-[8px] opacity-70">TP1</div>${displayTp1.toFixed(precision)}
                      </div>
                      <div className="col-span-3 bg-blue-950 border border-blue-800 rounded px-1 py-1 text-blue-300 text-[9px] font-bold">
                        <div className="text-[8px] opacity-70">TP2</div>${displayTp2.toFixed(precision)}
                      </div>
                    </>
                }
              </div>
              {displayTpLevels.length > 0 && (
                <div className="text-[9px] text-slate-400 pt-0.5">
                  Selected: <span className="text-white font-bold">TP{selectedTpIndex + 1}</span> at <span className="text-emerald-300 font-bold">${displayTpLevels[selectedTpIndex]?.toFixed(precision)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Trader Discretion Notice Box */}
          <div className="bg-slate-950/90 border border-amber-800/60 p-2.5 rounded-lg text-[10px] space-y-1 text-slate-300 font-sans">
            <div className="flex items-center gap-1.5 text-amber-400 font-bold font-mono">
              <Zap className="w-3.5 h-3.5" />
              <span>TRADER DISCRETION ENABLED</span>
            </div>
            <p className="text-[10px] text-slate-300 leading-snug">
              Signals remain <strong>100% live & active</strong>. Despite any news hold recommendations, you can execute trades at any time at your discretion.
            </p>
          </div>

          {/* Quick Auto-Fill Execution Button — always shown for BUY/SELL signals */}
          {onExecuteTradeParams && latestNotif.type !== 'MONITORING' && (
            <button
              onClick={() =>
                onExecuteTradeParams({
                  signal_type: latestNotif.type === 'BUY_NOW' ? 'BUY/LONG' : 'SELL/SHORT',
                  entry: displayEntry,
                  stop_loss: displaySL,
                  tp1: displayTpLevels[selectedTpIndex] ?? displayTp1,
                  tp2: displayTpLevels[3] ?? displayTp2,
                  tp_levels: displayTpLevels,
                  entry_zones: displayEntryZones,
                })
              }
              className={`w-full py-2 text-white text-xs font-bold rounded-lg shadow-lg transition flex items-center justify-center gap-1.5 ${
                latestNotif.type === 'BUY_NOW'
                  ? 'bg-emerald-600 hover:bg-emerald-500'
                  : 'bg-rose-600 hover:bg-rose-500'
              }`}
            >
              <Play className="w-3.5 h-3.5 fill-white" />
              <span>Auto-Fill Paper Order ({latestNotif.timeframe}) — TP{selectedTpIndex + 1}</span>
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
                      : item.type === 'SELL_NOW'
                      ? 'bg-rose-950 text-rose-400 border border-rose-800'
                      : 'bg-amber-950 text-amber-400 border border-amber-800'
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
