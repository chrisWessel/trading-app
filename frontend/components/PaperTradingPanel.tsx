'use client';

import React, { useState, useEffect } from 'react';
import { Play, CheckCircle, XCircle, DollarSign, Target, Shield, ArrowUpRight, ArrowDownRight, RefreshCw, Calculator, HelpCircle } from 'lucide-react';
import { API_BASE_URL } from '@/lib/apiConfig';
import PositionSizingGuide from '@/components/PositionSizingGuide';

export interface ExternalTradeParams {
  signal_type: string;
  entry: number;
  stop_loss: number;
  tp1: number;
  tp2: number;
  tp_levels?: number[];
  entry_zones?: number[];
}

interface PaperTradingPanelProps {
  symbol: string;
  currentPrice: number;
  onTradeClosed: () => void;
  externalParams?: ExternalTradeParams | null;
}

export type MTOrderType = 
  | 'Market Execution'
  | 'Buy Limit'
  | 'Sell Limit'
  | 'Buy Stop'
  | 'Sell Stop'
  | 'Buy Stop Limit'
  | 'Sell Stop Limit';

interface ActivePosition {
  id: string;
  symbol: string;
  signal_type: 'BUY/LONG' | 'SELL/SHORT';
  order_type: MTOrderType;
  entry_price: number;
  stop_loss: number;
  tp1: number;
  tp2: number;
  position_size_usd: number;
  lots: number;
  margin_usd: number;
  target_mode: 'TP1' | 'TP2';
  timestamp: string;
}

export default function PaperTradingPanel({
  symbol,
  currentPrice,
  onTradeClosed,
  externalParams,
}: PaperTradingPanelProps) {
  const [signalType, setSignalType] = useState<'BUY/LONG' | 'SELL/SHORT'>('BUY/LONG');
  const [orderType, setOrderType] = useState<MTOrderType>('Market Execution');
  const [targetChoice, setTargetChoice] = useState<'TP1' | 'TP2'>('TP1');
  const [entryPrice, setEntryPrice] = useState<number>(currentPrice || 100);
  const [stopLoss, setStopLoss] = useState<number>(0);
  const [tp1, setTp1] = useState<number>(0);
  const [tp2, setTp2] = useState<number>(0);
  const [positionSizeUsd, setPositionSizeUsd] = useState<number>(500);
  const [sizeMode, setSizeMode] = useState<'USD' | 'LOTS'>('LOTS');
  const [lotsInput, setLotsInput] = useState<number>(0.01);
  const [showGuideModal, setShowGuideModal] = useState<boolean>(false);
  const [showMTGuideModal, setShowMTGuideModal] = useState<boolean>(false);

  const [activePosition, setActivePosition] = useState<ActivePosition | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Entry zone & TP level selection (from signal auto-fill)
  const [entryZones, setEntryZones] = useState<number[]>([]);
  const [selectedZoneIndex, setSelectedZoneIndex] = useState<number>(2); // Zone 3 = signal price
  const [tpLevels, setTpLevels] = useState<number[]>([]);
  const [selectedTpLevelIndex, setSelectedTpLevelIndex] = useState<number>(0); // TP1 default

  // Stored pip offsets from the signal (so we can recalculate absolute SL/TP when entry changes)
  const [signalSlOffset, setSignalSlOffset] = useState<number>(0);
  const [signalTpOffsets, setSignalTpOffsets] = useState<number[]>([]);
  const [signalDirection, setSignalDirection] = useState<'BUY/LONG' | 'SELL/SHORT'>('BUY/LONG');

  const isHighValueAsset = currentPrice > 10.0;
  const precision = isHighValueAsset ? 2 : 4;

  const getAssetOffsets = (sym: string, price: number) => {
    const isGold = sym.toUpperCase().includes('XAU') || sym.toUpperCase().includes('GOLD');
    const isCrypto = sym.toUpperCase().includes('BTC') || sym.toUpperCase().includes('ETH') || sym.toUpperCase().includes('SOL');
    const isForex = !isGold && !isCrypto;

    if (isGold) {
      return { slOffset: 3.00, tp1Offset: 4.50, tp2Offset: 9.00 };
    } else if (isCrypto) {
      const mult = price > 10000 ? 150 : price > 1000 ? 15 : 1.5;
      return { slOffset: mult, tp1Offset: mult * 1.5, tp2Offset: mult * 3.0 };
    } else if (isForex) {
      return { slOffset: 0.0015, tp1Offset: 0.0025, tp2Offset: 0.0050 };
    }
    return { slOffset: price * 0.005, tp1Offset: price * 0.01, tp2Offset: price * 0.02 };
  };

  const autoFixParameters = (targetOrderType?: MTOrderType, targetDir?: 'BUY/LONG' | 'SELL/SHORT') => {
    const dir = targetDir || signalType;
    const oType = targetOrderType || orderType;
    const refPrice = currentPrice > 0 ? currentPrice : entryPrice || 100;
    const offsets = getAssetOffsets(symbol, refPrice);

    let newEntry = refPrice;
    if (oType === 'Buy Limit') {
      newEntry = Number((refPrice - offsets.slOffset * 0.5).toFixed(precision));
    } else if (oType === 'Buy Stop') {
      newEntry = Number((refPrice + offsets.slOffset * 0.5).toFixed(precision));
    } else if (oType === 'Sell Limit') {
      newEntry = Number((refPrice + offsets.slOffset * 0.5).toFixed(precision));
    } else if (oType === 'Sell Stop') {
      newEntry = Number((refPrice - offsets.slOffset * 0.5).toFixed(precision));
    } else if (oType === 'Market Execution') {
      newEntry = refPrice;
    }

    setEntryPrice(newEntry);
    // Clear signal zones on manual fix
    setEntryZones([]);
    setTpLevels([]);
    setSignalSlOffset(0);
    setSignalTpOffsets([]);

    if (dir === 'BUY/LONG') {
      setStopLoss(Number((newEntry - offsets.slOffset).toFixed(precision)));
      setTp1(Number((newEntry + offsets.tp1Offset).toFixed(precision)));
      setTp2(Number((newEntry + offsets.tp2Offset).toFixed(precision)));
    } else {
      setStopLoss(Number((newEntry + offsets.slOffset).toFixed(precision)));
      setTp1(Number((newEntry - offsets.tp1Offset).toFixed(precision)));
      setTp2(Number((newEntry - offsets.tp2Offset).toFixed(precision)));
    }
  };

  /**
   * Recalculate absolute SL and TP levels from a given entry price using stored pip offsets.
   * For Market Execution: entry = currentPrice (live market price).
   * For Pending Orders: entry = chosen zone or signal entry.
   */
  const recalcFromEntry = (
    entry: number,
    dir: 'BUY/LONG' | 'SELL/SHORT',
    slOff: number,
    tpOffs: number[],
    prec: number
  ) => {
    const isBuy = dir === 'BUY/LONG';
    const newSL = isBuy
      ? Number((entry - slOff).toFixed(prec))
      : Number((entry + slOff).toFixed(prec));
    setStopLoss(newSL);

    if (tpOffs.length > 0) {
      const recalcedTps = tpOffs.map(off =>
        isBuy ? Number((entry + off).toFixed(prec)) : Number((entry - off).toFixed(prec))
      );
      setTpLevels(recalcedTps);
      setTp1(recalcedTps[0]);
      setTp2(recalcedTps[Math.min(3, recalcedTps.length - 1)]); // TP4 or last
    }
  };


  // Sync with external signal parameters when user clicks "Auto-Fill Paper Order"
  useEffect(() => {
    if (!externalParams) return;

    const type = externalParams.signal_type.includes('BUY') ? 'BUY/LONG' : 'SELL/SHORT';
    setSignalType(type);
    setSignalDirection(type);

    const signalEntry = externalParams.entry;
    const isBuy = type === 'BUY/LONG';

    // Compute pip offsets from the SIGNAL entry (absolute distances)
    const slOff = Math.abs(externalParams.stop_loss - signalEntry);
    const rawTps: number[] = externalParams.tp_levels ?? [];
    const tpOffs = rawTps.length > 0
      ? rawTps.map(tp => Math.abs(tp - signalEntry))
      : [
          Math.abs(externalParams.tp1 - signalEntry),
          Math.abs(externalParams.tp2 - signalEntry),
        ];

    setSignalSlOffset(slOff);
    setSignalTpOffsets(tpOffs);

    // Entry zones from signal (useful for pending orders)
    const zones = externalParams.entry_zones ?? [];
    setEntryZones(zones);
    setSelectedZoneIndex(0); // Z1 = current market price (immediate entry)
    setSelectedTpLevelIndex(0);

    // ── KEY FIX: For Market Execution, ALWAYS use currentPrice as entry.
    // For pending orders, use the signal entry / zone.
    const useEntry = orderType === 'Market Execution'
      ? (currentPrice > 0 ? currentPrice : signalEntry)
      : (zones.length > 0 ? zones[2] : signalEntry);

    setEntryPrice(useEntry);

    // Recalculate absolute SL and all TP levels from the ACTUAL entry used
    recalcFromEntry(useEntry, type, slOff, tpOffs, precision);

    setStatusMessage(
      `✅ Auto-filled from signal (${type}). Entry: $${useEntry.toFixed(precision)} | SL: ` +
      `$${(isBuy ? useEntry - slOff : useEntry + slOff).toFixed(precision)}`
    );
    setTimeout(() => setStatusMessage(null), 4000);
  }, [externalParams]);

  // When order type changes TO Market Execution and we have signal offsets → recalculate from currentPrice
  useEffect(() => {
    if (signalSlOffset > 0 && orderType === 'Market Execution' && currentPrice > 0) {
      const newEntry = currentPrice;
      setEntryPrice(newEntry);
      recalcFromEntry(newEntry, signalDirection, signalSlOffset, signalTpOffsets, precision);
    }
  }, [orderType]);

  // For Market Execution: always keep entry pinned to the live current price.
  // Runs on every currentPrice update regardless of whether a signal is active.
  useEffect(() => {
    if (orderType === 'Market Execution' && currentPrice > 0 && !activePosition) {
      const newEntry = currentPrice;
      setEntryPrice(newEntry);
      // If we have signal offsets (from auto-fill), recalculate SL/TPs from live entry
      if (signalSlOffset > 0) {
        recalcFromEntry(newEntry, signalDirection, signalSlOffset, signalTpOffsets, precision);
      } else {
        // No signal: just update entry price, keep relative SL/TP distances
        const offsets = getAssetOffsets(symbol, newEntry);
        const isBuy = signalType === 'BUY/LONG';
        setStopLoss(Number((isBuy ? newEntry - offsets.slOffset : newEntry + offsets.slOffset).toFixed(precision)));
        setTp1(Number((isBuy ? newEntry + offsets.tp1Offset : newEntry - offsets.tp1Offset).toFixed(precision)));
        setTp2(Number((isBuy ? newEntry + offsets.tp2Offset : newEntry - offsets.tp2Offset).toFixed(precision)));
      }
    }
  }, [currentPrice]);

  // Initial setup for default entry price, stop loss, and target prices if empty
  useEffect(() => {
    if (!externalParams && currentPrice && currentPrice > 0 && (entryPrice === 0 || stopLoss === 0)) {
      autoFixParameters(orderType, signalType);
    }
  }, [symbol]);


  const getMetaTraderValidationError = (): string | null => {
    if (!entryPrice || isNaN(entryPrice) || entryPrice <= 0) {
      return 'Invalid entry price. Please sync with live asset price.';
    }
    if (isNaN(stopLoss) || stopLoss <= 0) {
      return 'Invalid Stop Loss price.';
    }
    if (isNaN(tp1) || tp1 <= 0) {
      return 'Invalid Take Profit (TP1) price.';
    }

    const isBuy = signalType === 'BUY/LONG';
    
    // Check SL & TP direction
    if (isBuy) {
      if (stopLoss >= entryPrice) {
        return `MetaTrader Error: For BUY orders, Stop Loss ($${stopLoss.toFixed(precision)}) must be BELOW Entry ($${entryPrice.toFixed(precision)}).`;
      }
      if (tp1 <= entryPrice) {
        return `MetaTrader Error: For BUY orders, Take Profit ($${tp1.toFixed(precision)}) must be ABOVE Entry ($${entryPrice.toFixed(precision)}).`;
      }
    } else {
      if (stopLoss <= entryPrice) {
        return `MetaTrader Error: For SELL orders, Stop Loss ($${stopLoss.toFixed(precision)}) must be ABOVE Entry ($${entryPrice.toFixed(precision)}).`;
      }
      if (tp1 >= entryPrice) {
        return `MetaTrader Error: For SELL orders, Take Profit ($${tp1.toFixed(precision)}) must be BELOW Entry ($${entryPrice.toFixed(precision)}).`;
      }
    }

    // Check Order Type Price Relationship vs current market price
    if (orderType === 'Buy Limit' && entryPrice >= currentPrice) {
      return `MetaTrader Rule: Buy Limit entry price ($${entryPrice.toFixed(precision)}) must be BELOW live price ($${currentPrice.toFixed(precision)}).`;
    }
    if (orderType === 'Buy Stop' && entryPrice <= currentPrice) {
      return `MetaTrader Rule: Buy Stop entry price ($${entryPrice.toFixed(precision)}) must be ABOVE live price ($${currentPrice.toFixed(precision)}).`;
    }
    if (orderType === 'Sell Limit' && entryPrice <= currentPrice) {
      return `MetaTrader Rule: Sell Limit entry price ($${entryPrice.toFixed(precision)}) must be ABOVE live price ($${currentPrice.toFixed(precision)}).`;
    }
    if (orderType === 'Sell Stop' && entryPrice >= currentPrice) {
      return `MetaTrader Rule: Sell Stop entry price ($${entryPrice.toFixed(precision)}) must be BELOW live price ($${currentPrice.toFixed(precision)}).`;
    }

    return null;
  };

  const validationError = getMetaTraderValidationError();

  // Calculated Lots & Margin
  const computedLots = sizeMode === 'LOTS' ? lotsInput : Math.max(0.01, Number((positionSizeUsd / (currentPrice * 100)).toFixed(2)));
  const estimatedNotionalUsd = symbol.includes('XAU') ? computedLots * 100 * (entryPrice || currentPrice) : computedLots * 100000;
  const estimatedMarginUsd = estimatedNotionalUsd / 500; // 1:500 leverage default

  const handleUseCurrentPrice = () => {
    autoFixParameters(orderType, signalType);
  };

  // Open simulated trade position
  const handleOpenTrade = (e: React.FormEvent) => {
    e.preventDefault();
    if (validationError) {
      setStatusMessage(validationError);
      return;
    }
    const harareTimeStr = new Date().toLocaleTimeString('en-US', { timeZone: 'Africa/Harare' });
    const newPos: ActivePosition = {
      id: 'MT5-' + Math.floor(Math.random() * 10000),
      symbol: symbol,
      signal_type: signalType,
      order_type: orderType,
      entry_price: entryPrice,
      stop_loss: stopLoss,
      tp1: tp1,
      tp2: tp2,
      position_size_usd: positionSizeUsd,
      lots: computedLots,
      margin_usd: estimatedMarginUsd,
      target_mode: targetChoice,
      timestamp: harareTimeStr,
    };
    setActivePosition(newPos);
    setStatusMessage(`Simulated MetaTrader [${orderType}] order placed on ${symbol} at $${entryPrice.toFixed(precision)} (${computedLots} Lots, Margin: ~$${estimatedMarginUsd.toFixed(2)} USD).`);
    setTimeout(() => setStatusMessage(null), 4000);
  };

  // Close simulated position & log to SQLite DB via FastAPI endpoint (with offline fallback & localStorage backup)
  const handleClosePosition = async (outcome: 'WIN' | 'LOSS', exitPriceOverride?: number) => {
    if (!activePosition) return;

    setIsSubmitting(true);
    const exitPrice = exitPriceOverride !== undefined 
      ? exitPriceOverride 
      : (outcome === 'WIN' 
          ? (activePosition.target_mode === 'TP2' ? activePosition.tp2 : activePosition.tp1) 
          : activePosition.stop_loss);

    const isBuy = activePosition.signal_type.includes('BUY') || activePosition.signal_type.includes('LONG');
    const pnlPct = isBuy 
      ? ((exitPrice - activePosition.entry_price) / activePosition.entry_price) * 100
      : ((activePosition.entry_price - exitPrice) / activePosition.entry_price) * 100;
    const pnlUsd = activePosition.position_size_usd * (pnlPct / 100);

    const harareTimeStr = new Date().toLocaleTimeString('en-US', { timeZone: 'Africa/Harare' });

    const newLog = {
      id: Date.now(),
      timestamp: harareTimeStr,
      symbol: activePosition.symbol,
      signal_type: activePosition.signal_type,
      entry_price: activePosition.entry_price,
      exit_price: exitPrice,
      stop_loss: activePosition.stop_loss,
      take_profit: activePosition.target_mode === 'TP2' ? activePosition.tp2 : activePosition.tp1,
      position_size_usd: activePosition.position_size_usd,
      outcome: outcome,
      pnl_usd: pnlUsd,
      pnl_percentage: pnlPct,
      rationale: `Paper trade simulation closed as ${outcome} at $${exitPrice.toFixed(precision)} (${activePosition.target_mode}).`,
    };

    // 1. Instantly store in localStorage for offline persistence & Audit table display
    try {
      const existing = JSON.parse(localStorage.getItem('paper_trades_history') || '[]');
      localStorage.setItem('paper_trades_history', JSON.stringify([newLog, ...existing]));
    } catch (e) {
      // Storage fallback ignore
    }

    // 2. Post to backend FastAPI endpoint if online
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      const res = await fetch(`${API_BASE_URL}/api/trade/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          symbol: activePosition.symbol,
          signal_type: activePosition.signal_type,
          entry_price: activePosition.entry_price,
          exit_price: exitPrice,
          stop_loss: activePosition.stop_loss,
          take_profit: activePosition.target_mode === 'TP2' ? activePosition.tp2 : activePosition.tp1,
          position_size_usd: activePosition.position_size_usd,
          outcome: outcome,
          rationale: newLog.rationale,
        }),
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        setStatusMessage(`✅ Trade closed cleanly (${outcome}) & logged to SQLite database! PnL: ${pnlUsd >= 0 ? '+' : ''}$${pnlUsd.toFixed(2)} USD (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%).`);
      } else {
        setStatusMessage(`✅ Trade closed cleanly (${outcome}) in Paper Simulation! PnL: ${pnlUsd >= 0 ? '+' : ''}$${pnlUsd.toFixed(2)} USD (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%).`);
      }
    } catch (err: any) {
      setStatusMessage(`✅ Trade closed cleanly (${outcome}) in Paper Simulation! PnL: ${pnlUsd >= 0 ? '+' : ''}$${pnlUsd.toFixed(2)} USD (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%).`);
    } finally {
      setActivePosition(null);
      setIsSubmitting(false);
      onTradeClosed();
      setTimeout(() => setStatusMessage(null), 5000);
    }
  };

  // Calculate live unrealized PnL based on current ticking price
  let unrealizedPnlPct = 0;
  let unrealizedPnlUsd = 0;
  if (activePosition && currentPrice > 0) {
    if (activePosition.signal_type.includes('BUY') || activePosition.signal_type.includes('LONG')) {
      unrealizedPnlPct = ((currentPrice - activePosition.entry_price) / activePosition.entry_price) * 100;
    } else {
      unrealizedPnlPct = ((activePosition.entry_price - currentPrice) / activePosition.entry_price) * 100;
    }
    unrealizedPnlUsd = activePosition.position_size_usd * (unrealizedPnlPct / 100);
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl flex flex-col gap-5">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-emerald-400" />
          <h2 className="text-lg font-bold text-white">Paper Simulation Trading</h2>
        </div>
        <span className="text-xs bg-emerald-950 text-emerald-400 border border-emerald-800/50 px-2.5 py-1 rounded-full font-mono">
          Harare Time Execution
        </span>
      </div>

      {statusMessage && (
        <div className="bg-blue-950/80 border border-blue-800 text-blue-300 text-xs px-3 py-2 rounded-lg font-mono">
          {statusMessage}
        </div>
      )}

      {/* Active Position Display */}
      {activePosition ? (
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-4 shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
            <div className="flex items-center gap-2">
              <span className={`px-2.5 py-0.5 text-xs font-bold rounded ${
                activePosition.signal_type.includes('BUY')
                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                  : 'bg-rose-950 text-rose-400 border border-rose-800'
              }`}>
                {activePosition.signal_type}
              </span>
              <span className="text-sm font-bold text-white font-mono">{activePosition.symbol}</span>
              <span className="text-xs text-slate-500 font-mono">({activePosition.id})</span>
            </div>
            <div className="flex items-center gap-1 font-mono text-sm">
              <span className="text-slate-400 text-xs">Live PnL:</span>
              <span className={`font-bold flex items-center ${unrealizedPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {unrealizedPnlUsd >= 0 ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                ${unrealizedPnlUsd.toFixed(2)} ({unrealizedPnlPct >= 0 ? '+' : ''}{unrealizedPnlPct.toFixed(2)}%)
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs font-mono">
            <div className="bg-slate-900 p-2 rounded-lg border border-slate-800">
              <span className="text-slate-400 block text-[10px]">ENTRY PRICE</span>
              <span className="text-white font-bold">${activePosition.entry_price.toFixed(precision)}</span>
            </div>
            <div className="bg-slate-900 p-2 rounded-lg border border-slate-800">
              <span className="text-slate-400 block text-[10px]">STOP LOSS</span>
              <span className="text-rose-400 font-bold">${activePosition.stop_loss.toFixed(precision)}</span>
            </div>
            <div className="bg-slate-900 p-2 rounded-lg border border-slate-800">
              <span className="text-slate-400 block text-[10px]">TARGET (TP1)</span>
              <span className="text-emerald-400 font-bold">${activePosition.tp1.toFixed(precision)}</span>
            </div>
            <div className="bg-slate-900 p-2 rounded-lg border border-slate-800">
              <span className="text-slate-400 block text-[10px]">POSITION SIZE</span>
              <span className="text-blue-400 font-bold">${activePosition.position_size_usd.toFixed(2)}</span>
            </div>
          </div>

          {/* Action Buttons to Close Trade */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => handleClosePosition('WIN')}
              disabled={isSubmitting}
              className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-2 px-3 rounded-lg text-xs flex items-center justify-center gap-1.5 transition shadow-lg shadow-emerald-950"
            >
              <CheckCircle className="w-4 h-4" />
              <span>Close as WIN (+ Take Profit)</span>
            </button>

            <button
              onClick={() => handleClosePosition('LOSS')}
              disabled={isSubmitting}
              className="flex-1 bg-rose-600 hover:bg-rose-500 text-white font-semibold py-2 px-3 rounded-lg text-xs flex items-center justify-center gap-1.5 transition shadow-lg shadow-rose-950"
            >
              <XCircle className="w-4 h-4" />
              <span>Close as LOSS (- Stop Loss)</span>
            </button>
          </div>
        </div>
      ) : (
        /* Order Form to Open Position */
        <form onSubmit={handleOpenTrade} className="space-y-4 text-xs font-mono">
          {/* Order Execution Type Dropdown (MT4/MT5 style) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-slate-400 text-[11px] font-bold">METATRADER ORDER TYPE</label>
              <button
                type="button"
                onClick={() => setShowMTGuideModal(true)}
                className="text-[10px] text-amber-400 hover:underline flex items-center gap-1 font-bold"
              >
                <HelpCircle className="w-3 h-3" />
                <span>When to use which order?</span>
              </button>
            </div>
            <select
              value={orderType}
              onChange={(e) => {
                const newType = e.target.value as MTOrderType;
                setOrderType(newType);
                autoFixParameters(newType, signalType);
              }}
              className="w-full bg-slate-950 border border-slate-700 text-amber-300 font-bold px-3 py-2 rounded-lg focus:outline-none focus:border-amber-500 text-xs"
            >
              <option value="Market Execution">⚡ Market Execution (Instant Fill at Current Price)</option>
              <option value="Buy Limit">📉 Buy Limit (Buy below current price on pullback)</option>
              <option value="Sell Limit">📈 Sell Limit (Sell above current price on rejection)</option>
              <option value="Buy Stop">🚀 Buy Stop (Buy above current price on breakout)</option>
              <option value="Sell Stop">💥 Sell Stop (Sell below current price on breakdown)</option>
              <option value="Buy Stop Limit">🔄 Buy Stop Limit (Breakout retest buy)</option>
              <option value="Sell Stop Limit">🔁 Sell Stop Limit (Breakdown retest sell)</option>
            </select>
          </div>

          {/* BUY / SELL Direction Switcher */}
          <div className="flex items-center justify-between bg-slate-950 p-1.5 rounded-lg border border-slate-800">
            <button
              type="button"
              onClick={() => {
                setSignalType('BUY/LONG');
                autoFixParameters(orderType, 'BUY/LONG');
              }}
              className={`flex-1 py-2 rounded-md font-bold transition flex items-center justify-center gap-1.5 ${
                signalType === 'BUY/LONG'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <ArrowUpRight className="w-4 h-4" />
              <span>BUY / LONG</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setSignalType('SELL/SHORT');
                autoFixParameters(orderType, 'SELL/SHORT');
              }}
              className={`flex-1 py-2 rounded-md font-bold transition flex items-center justify-center gap-1.5 ${
                signalType === 'SELL/SHORT'
                  ? 'bg-rose-600 text-white shadow-md shadow-rose-950'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <ArrowDownRight className="w-4 h-4" />
              <span>SELL / SHORT</span>
            </button>
          </div>

          {/* Entry Price — Zone Selector (5 levels) or manual */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-slate-400 text-[11px] font-bold">ENTRY PRICE ($)</label>
              <button
                type="button"
                onClick={handleUseCurrentPrice}
                className="text-[10px] text-blue-400 hover:underline flex items-center gap-0.5"
              >
                <RefreshCw className="w-2.5 h-2.5" />
                <span>Sync Price</span>
              </button>
            </div>

            {/* Market Execution: live price is always the entry */}
            {orderType === 'Market Execution' ? (
              <div className="bg-slate-950 border border-emerald-900/60 rounded-lg px-3 py-2.5 flex items-center justify-between">
                <div>
                  <div className="text-[9px] text-emerald-400 font-bold mb-0.5 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
                    LIVE MARKET PRICE (Market Execution)
                  </div>
                  <span className="text-white font-bold font-mono text-sm">${currentPrice > 0 ? currentPrice.toFixed(precision) : '...'}</span>
                </div>
                <span className="text-[9px] text-emerald-500 bg-emerald-950 border border-emerald-900 rounded px-1.5 py-0.5">Auto-synced</span>
              </div>
            ) : entryZones.length > 0 ? (
              /* Zone Selector: 5 bracketed entry prices — for PENDING ORDERS only */
              <div className="space-y-1">
                <div className="text-[9px] text-amber-400 mb-1">📌 Select entry zone for pending order:</div>
                <div className="grid grid-cols-5 gap-1">
                  {entryZones.map((z, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        setSelectedZoneIndex(i);
                        setEntryPrice(z);
                        // Recalculate SL and TP from the selected zone price
                        if (signalSlOffset > 0) {
                          recalcFromEntry(z, signalDirection, signalSlOffset, signalTpOffsets, precision);
                        }
                      }}
                      className={`text-center rounded px-1 py-1.5 border text-[9px] font-bold transition ${
                        selectedZoneIndex === i
                          ? 'bg-blue-600 border-blue-400 text-white shadow-md shadow-blue-950'
                          : 'bg-slate-950 border-slate-700 text-slate-300 hover:border-blue-600 hover:text-blue-300'
                      }`}
                      title={i === 0 ? 'Z1 = Current Market Price (immediate entry)' : `Zone ${i + 1}`}
                    >
                      <div className="text-[8px] opacity-70">{i === 0 ? 'NOW★' : `Z${i + 1}`}</div>
                      ${z.toFixed(precision)}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded px-2 py-1">
                  <span className="text-slate-400 text-[10px]">Selected Entry:</span>
                  <span className="text-white font-bold text-[11px] font-mono">${entryPrice.toFixed(precision)}</span>
                </div>
              </div>
            ) : (
              /* Fallback: manual entry input */
              <input
                type="number"
                step="any"
                value={entryPrice}
                onChange={(e) => setEntryPrice(parseFloat(e.target.value) || 0)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white font-bold focus:outline-none focus:border-blue-500"
              />
            )}
          </div>

          {/* Volume (Lot Size) Input */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-slate-400 text-[11px] font-bold">VOLUME (LOTS)</label>
              <span className="text-[10px] text-emerald-400 font-bold">
                Margin ≈ ${estimatedMarginUsd.toFixed(2)}
              </span>
            </div>
            <input
              type="number"
              step="0.01"
              min="0.01"
              max="100"
              value={lotsInput}
              onChange={(e) => setLotsInput(parseFloat(e.target.value) || 0.01)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-amber-300 font-bold focus:outline-none focus:border-amber-500 text-xs"
            />
          </div>

          {/* Stop Loss — read-only display (frozen from signal) */}
          <div>
            <label className="text-slate-400 text-[10px] block mb-1 font-bold">STOP LOSS (FIXED — from signal)</label>
            <div className="w-full bg-slate-950 border border-rose-900 rounded-lg px-3 py-2 text-rose-400 font-bold text-xs flex items-center justify-between">
              <span>${stopLoss.toFixed(precision)}</span>
              <button
                type="button"
                onClick={() => {
                  const offsets = getAssetOffsets(symbol, entryPrice);
                  if (signalType === 'BUY/LONG') setStopLoss(Number((entryPrice - offsets.slOffset).toFixed(precision)));
                  else setStopLoss(Number((entryPrice + offsets.slOffset).toFixed(precision)));
                }}
                className="text-[10px] text-slate-400 hover:text-rose-300 border border-slate-700 rounded px-1.5 py-0.5 transition"
              >
                Auto
              </button>
            </div>
          </div>

          {/* TP Level Selector — 7 levels as chips */}
          <div>
            <label className="text-slate-400 text-[10px] block mb-1 font-bold">TAKE PROFIT LEVEL</label>
            {tpLevels.length > 0 ? (
              <div className="space-y-1.5">
                <div className="grid grid-cols-4 gap-1">
                  {tpLevels.map((tp, i) => {
                    const chipColors = [
                      'border-emerald-700 text-emerald-300', 'border-teal-700 text-teal-300',
                      'border-cyan-700 text-cyan-300', 'border-sky-700 text-sky-300',
                      'border-blue-700 text-blue-300', 'border-indigo-700 text-indigo-300',
                      'border-violet-700 text-violet-300',
                    ];
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => {
                          setSelectedTpLevelIndex(i);
                          setTp1(tp);
                        }}
                        className={`text-center rounded px-1 py-1.5 border text-[9px] font-bold transition ${
                          selectedTpLevelIndex === i
                            ? chipColors[i] + ' bg-slate-800 ring-1 ring-white/20 shadow-md'
                            : chipColors[i] + ' bg-slate-950/60 opacity-60 hover:opacity-100'
                        }`}
                      >
                        <div className="text-[8px] opacity-60">TP{i + 1}</div>
                        ${tp.toFixed(precision)}
                      </button>
                    );
                  })}
                </div>
                <div className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-[10px] flex justify-between">
                  <span className="text-slate-400">Selected TP:</span>
                  <span className="text-emerald-300 font-bold font-mono">
                    TP{selectedTpLevelIndex + 1} — ${tpLevels[selectedTpLevelIndex]?.toFixed(precision)}
                  </span>
                </div>
              </div>
            ) : (
              /* Fallback: manual TP inputs if no tp_levels from signal */
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-400 text-[10px] block mb-1">TP 1 (CONSERVATIVE)</label>
                  <input
                    type="number"
                    step="any"
                    value={tp1}
                    onChange={(e) => setTp1(parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-emerald-400 font-bold focus:outline-none focus:border-emerald-500 text-xs"
                  />
                </div>
                <div>
                  <label className="text-slate-400 text-[10px] block mb-1">TP 2 (EXTENDED)</label>
                  <input
                    type="number"
                    step="any"
                    value={tp2}
                    onChange={(e) => setTp2(parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-blue-400 font-bold focus:outline-none focus:border-blue-500 text-xs"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Validation Error Banner & Auto-Fix Button */}
          {validationError && (
            <div className="bg-amber-950/80 border border-amber-600/80 rounded-lg p-2.5 space-y-2 text-amber-200 text-[11px] font-sans">
              <div className="flex items-center gap-1.5 font-bold text-amber-300">
                <HelpCircle className="w-4 h-4 text-amber-400" />
                <span>MetaTrader Order Rule Check:</span>
              </div>
              <p>{validationError}</p>
              <button
                type="button"
                onClick={() => autoFixParameters(orderType, signalType)}
                className="w-full py-1.5 bg-amber-600 hover:bg-amber-500 text-slate-950 font-extrabold rounded text-xs transition shadow-md"
              >
                ⚡ Auto-Fix Order Parameters to Valid MetaTrader Levels
              </button>
            </div>
          )}

          {/* TP1 vs TP2 Target Strategy Selector */}
          <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 flex items-center justify-between gap-2">
            <span className="text-[10px] text-slate-400 font-bold">TARGET STRATEGY:</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setTargetChoice('TP1')}
                className={`px-2.5 py-1 rounded text-[10px] font-bold transition ${
                  targetChoice === 'TP1'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-900 text-slate-400 hover:text-white'
                }`}
              >
                TP1 (Lock Profit)
              </button>
              <button
                type="button"
                onClick={() => setTargetChoice('TP2')}
                className={`px-2.5 py-1 rounded text-[10px] font-bold transition ${
                  targetChoice === 'TP2'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-900 text-slate-400 hover:text-white'
                }`}
              >
                TP2 (Runner Target)
              </button>
            </div>
          </div>
          <button
            type="submit"
            disabled={!!validationError}
            className={`w-full font-extrabold py-2.5 rounded-lg transition flex items-center justify-center gap-2 shadow-lg text-sm ${
              validationError
                ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-950'
            }`}
          >
            <Play className="w-4 h-4 fill-white" />
            <span>Open Simulated MetaTrader Order ({symbol})</span>
          </button>
        </form>
      )}

      {showGuideModal && (
        <PositionSizingGuide
          initialSymbol={symbol}
          isModal={true}
          onClose={() => setShowGuideModal(false)}
        />
      )}

      {showMTGuideModal && (
        <PositionSizingGuide
          initialSymbol={symbol}
          isModal={true}
          onClose={() => setShowMTGuideModal(false)}
        />
      )}
    </div>
  );
}
