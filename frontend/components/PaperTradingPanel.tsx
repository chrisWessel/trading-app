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

  const isHighValueAsset = currentPrice > 10.0;
  const precision = isHighValueAsset ? 2 : 4;

  // Sync with external signal parameters when user clicks "Auto-Fill Paper Order"
  useEffect(() => {
    if (externalParams) {
      const type = externalParams.signal_type.includes('BUY') ? 'BUY/LONG' : 'SELL/SHORT';
      setSignalType(type);
      setEntryPrice(externalParams.entry);
      setStopLoss(externalParams.stop_loss);
      setTp1(externalParams.tp1);
      setTp2(externalParams.tp2);
      setStatusMessage(`✅ Synchronized trade parameters with live signal (${type} at $${externalParams.entry.toFixed(precision)})`);
      setTimeout(() => setStatusMessage(null), 3000);
    }
  }, [externalParams]);

  // Auto-sync default entry price, stop loss, and target prices when current price changes (if not external)
  useEffect(() => {
    if (!externalParams && currentPrice && currentPrice > 0) {
      setEntryPrice(currentPrice);
      if (signalType === 'BUY/LONG') {
        setStopLoss(Number((currentPrice * 0.985).toFixed(precision)));
        setTp1(Number((currentPrice * 1.02).toFixed(precision)));
        setTp2(Number((currentPrice * 1.04).toFixed(precision)));
      } else {
        setStopLoss(Number((currentPrice * 1.015).toFixed(precision)));
        setTp1(Number((currentPrice * 0.98).toFixed(precision)));
        setTp2(Number((currentPrice * 0.96).toFixed(precision)));
      }
    }
  }, [currentPrice, symbol, signalType]);

  // Calculated Lots & Margin
  const computedLots = sizeMode === 'LOTS' ? lotsInput : Math.max(0.01, Number((positionSizeUsd / (currentPrice * 100)).toFixed(2)));
  const estimatedNotionalUsd = symbol.includes('XAU') ? computedLots * 100 * (entryPrice || currentPrice) : computedLots * 100000;
  const estimatedMarginUsd = estimatedNotionalUsd / 500; // 1:500 leverage default

  const handleUseCurrentPrice = () => {
    if (currentPrice > 0) {
      setEntryPrice(currentPrice);
      if (signalType === 'BUY/LONG') {
        setStopLoss(Number((currentPrice * 0.985).toFixed(precision)));
        setTp1(Number((currentPrice * 1.02).toFixed(precision)));
        setTp2(Number((currentPrice * 1.04).toFixed(precision)));
      } else {
        setStopLoss(Number((currentPrice * 1.015).toFixed(precision)));
        setTp1(Number((currentPrice * 0.98).toFixed(precision)));
        setTp2(Number((currentPrice * 0.96).toFixed(precision)));
      }
    }
  };

  // Open simulated trade position
  const handleOpenTrade = (e: React.FormEvent) => {
    e.preventDefault();
    if (!entryPrice || entryPrice <= 0) {
      setStatusMessage('Invalid entry price. Please sync with live asset price.');
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

  // Close simulated position & log to SQLite DB via FastAPI endpoint
  const handleClosePosition = async (outcome: 'WIN' | 'LOSS', exitPriceOverride?: number) => {
    if (!activePosition) return;

    setIsSubmitting(true);
    const exitPrice = exitPriceOverride !== undefined 
      ? exitPriceOverride 
      : (outcome === 'WIN' ? activePosition.tp1 : activePosition.stop_loss);

    try {
      const res = await fetch(`${API_BASE_URL}/api/trade/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: activePosition.symbol,
          signal_type: activePosition.signal_type,
          entry_price: activePosition.entry_price,
          exit_price: exitPrice,
          stop_loss: activePosition.stop_loss,
          take_profit: activePosition.tp1,
          position_size_usd: activePosition.position_size_usd,
          outcome: outcome,
          rationale: `Paper trade simulation closed as ${outcome} at $${exitPrice.toFixed(precision)}.`,
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to log closed trade to SQLite');
      }

      setActivePosition(null);
      setStatusMessage(`Trade closed cleanly (${outcome}) and logged to trade_signals.db database.`);
      onTradeClosed();
    } catch (err: any) {
      console.error(err);
      setStatusMessage(`Error closing trade: ${err.message}`);
    } finally {
      setIsSubmitting(false);
      setTimeout(() => setStatusMessage(null), 4000);
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
              onChange={(e) => setOrderType(e.target.value as MTOrderType)}
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
              onClick={() => setSignalType('BUY/LONG')}
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
              onClick={() => setSignalType('SELL/SHORT')}
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

          {/* Entry Price & Volume (Lot Size) Input */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-slate-400 text-[11px]">ENTRY PRICE ($)</label>
                <button
                  type="button"
                  onClick={handleUseCurrentPrice}
                  className="text-[10px] text-blue-400 hover:underline flex items-center gap-0.5"
                >
                  <RefreshCw className="w-2.5 h-2.5" />
                  <span>Sync Price</span>
                </button>
              </div>
              <input
                type="number"
                step="any"
                value={entryPrice}
                onChange={(e) => setEntryPrice(parseFloat(e.target.value))}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white font-bold focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-slate-400 text-[11px]">VOLUME (LOTS)</label>
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
                onChange={(e) => setLotsInput(parseFloat(e.target.value))}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-amber-300 font-bold focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>

          {/* Stop Loss, TP1, and TP2 Grid */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-slate-400 text-[10px] block mb-1">STOP LOSS ($)</label>
              <input
                type="number"
                step="any"
                value={stopLoss}
                onChange={(e) => setStopLoss(parseFloat(e.target.value))}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-rose-400 font-bold focus:outline-none focus:border-rose-500 text-xs"
              />
            </div>

            <div>
              <label className="text-slate-400 text-[10px] block mb-1">TP 1 (CONSERVATIVE)</label>
              <input
                type="number"
                step="any"
                value={tp1}
                onChange={(e) => setTp1(parseFloat(e.target.value))}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-emerald-400 font-bold focus:outline-none focus:border-emerald-500 text-xs"
              />
            </div>

            <div>
              <label className="text-slate-400 text-[10px] block mb-1">TP 2 (EXTENDED)</label>
              <input
                type="number"
                step="any"
                value={tp2}
                onChange={(e) => setTp2(parseFloat(e.target.value))}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-blue-400 font-bold focus:outline-none focus:border-blue-500 text-xs"
              />
            </div>
          </div>

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
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-extrabold py-2.5 rounded-lg transition flex items-center justify-center gap-2 shadow-lg shadow-blue-950 text-sm"
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
