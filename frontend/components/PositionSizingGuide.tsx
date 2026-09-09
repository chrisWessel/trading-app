'use client';

import React, { useState } from 'react';
import { 
  Calculator, 
  HelpCircle, 
  Layers, 
  CheckCircle2, 
  BookOpen, 
  DollarSign, 
  TrendingUp, 
  Sparkles, 
  X,
  Info,
  Sliders,
  Zap,
  Briefcase
} from 'lucide-react';

interface PositionSizingGuideProps {
  initialSymbol?: string;
  onClose?: () => void;
  isModal?: boolean;
}

interface AssetSpec {
  symbol: string;
  name: string;
  category: 'Forex' | 'Gold/Metals' | 'Commodities' | 'Indices' | 'Crypto';
  contractSize: number;
  unitName: string;
  pipStep: number;
  defaultSlPips: number;
  puPrimeNotes: string;
}

const ASSET_SPECS: Record<string, AssetSpec> = {
  'EUR/USD': {
    symbol: 'EUR/USD',
    name: 'Euro / US Dollar',
    category: 'Forex',
    contractSize: 100000,
    unitName: 'EUR',
    pipStep: 0.0001,
    defaultSlPips: 25,
    puPrimeNotes: '1.00 Lot = €100,000. 1 Pip = $10 on 1 Lot. Min trade 0.01 lot ($0.10/pip).'
  },
  'GBP/USD': {
    symbol: 'GBP/USD',
    name: 'British Pound / US Dollar',
    category: 'Forex',
    contractSize: 100000,
    unitName: 'GBP',
    pipStep: 0.0001,
    defaultSlPips: 30,
    puPrimeNotes: '1.00 Lot = £100,000. 1 Pip = $10 on 1 Lot. High volatility pair.'
  },
  'USD/JPY': {
    symbol: 'USD/JPY',
    name: 'US Dollar / Japanese Yen',
    category: 'Forex',
    contractSize: 100000,
    unitName: 'USD',
    pipStep: 0.01,
    defaultSlPips: 35,
    puPrimeNotes: '1.00 Lot = $100,000. Pip is 2nd decimal place (0.01).'
  },
  'XAU/USD': {
    symbol: 'XAU/USD',
    name: 'Gold vs US Dollar',
    category: 'Gold/Metals',
    contractSize: 100,
    unitName: 'Ounces',
    pipStep: 0.10,
    defaultSlPips: 30,
    puPrimeNotes: '1.00 Lot = 100 Troy Ounces. $1.00 move in Gold = $100 profit/loss on 1 Lot. 0.01 Lot = 1 Oz.'
  },
  'WTI/USD': {
    symbol: 'WTI/USD',
    name: 'Crude Oil WTI',
    category: 'Commodities',
    contractSize: 1000,
    unitName: 'Barrels',
    pipStep: 0.01,
    defaultSlPips: 50,
    puPrimeNotes: '1.00 Lot = 1,000 Barrels of Crude Oil. $0.01 move = $10 on 1 Lot.'
  },
  'US30': {
    symbol: 'US30',
    name: 'Dow Jones Industrial 30',
    category: 'Indices',
    contractSize: 1,
    unitName: 'Index Contract',
    pipStep: 1.0,
    defaultSlPips: 50,
    puPrimeNotes: '1.00 Lot = $1 per index point. 50 point move = $50 PnL.'
  },
  'BTC/USDT': {
    symbol: 'BTC/USDT',
    name: 'Bitcoin / Tether',
    category: 'Crypto',
    contractSize: 1,
    unitName: 'BTC',
    pipStep: 1.0,
    defaultSlPips: 200,
    puPrimeNotes: '1.00 Lot = 1 BTC. Fractional lots (0.01 BTC) supported.'
  },
  'REXT/USD': {
    symbol: 'REXT/USD',
    name: 'REXT / US Dollar',
    category: 'Crypto',
    contractSize: 10000,
    unitName: 'REXT',
    pipStep: 0.001,
    defaultSlPips: 50,
    puPrimeNotes: '1.00 Lot = 10,000 REXT tokens. Custom signal engine.'
  }
};

export default function PositionSizingGuide({
  initialSymbol = 'XAU/USD',
  onClose,
  isModal = false
}: PositionSizingGuideProps) {
  const [activeTab, setActiveTab] = useState<'calculator' | 'guide' | 'assistant' | 'cheatsheet' | 'depositMatrix' | 'mtOrderTypes'>('calculator');
  
  // Calculator States
  const [balance, setBalance] = useState<number>(5000);
  const [riskPercent, setRiskPercent] = useState<number>(1.5);
  const [selectedSymbol, setSelectedSymbol] = useState<string>(initialSymbol in ASSET_SPECS ? initialSymbol : 'XAU/USD');
  const [stopLossPips, setStopLossPips] = useState<number>(ASSET_SPECS[initialSymbol]?.defaultSlPips || 30);
  const [leverage, setLeverage] = useState<number>(500); // 1:500 default PU Prime
  const [customPrice, setCustomPrice] = useState<number>(2650);

  // Matrix Filter States
  const [matrixSlPips, setMatrixSlPips] = useState<number>(30);

  // Assistant Wizard States
  const [assistCapital, setAssistCapital] = useState<number>(1000);
  const [assistStyle, setAssistStyle] = useState<'scalper' | 'daytrader' | 'swing'>('daytrader');
  const [assistRiskLevel, setAssistRiskLevel] = useState<'conservative' | 'moderate' | 'aggressive'>('moderate');
  const [assistAsset, setAssistAsset] = useState<string>('XAU/USD');

  const currentSpec = ASSET_SPECS[selectedSymbol] || ASSET_SPECS['XAU/USD'];

  // Calculations
  const riskAmountUSD = (balance * riskPercent) / 100;
  
  // Pip value for 1.00 lot
  let pipValuePerLot = 10;
  if (currentSpec.category === 'Forex') {
    pipValuePerLot = 10;
  } else if (currentSpec.symbol === 'XAU/USD') {
    pipValuePerLot = 10;
  } else if (currentSpec.category === 'Indices') {
    pipValuePerLot = 1.0;
  } else if (currentSpec.category === 'Crypto') {
    pipValuePerLot = 1.0;
  }

  // Calculate Lots
  const rawLots = stopLossPips > 0 ? riskAmountUSD / (stopLossPips * (pipValuePerLot / (currentSpec.symbol === 'XAU/USD' ? 1 : 1))) : 0.01;
  const calculatedLots = Math.max(0.01, Math.min(100, Number(rawLots.toFixed(2))));
  
  // USD Position Value (Notional)
  const notionalUSD = calculatedLots * currentSpec.contractSize * (customPrice > 0 ? customPrice : 1);
  const requiredMarginUSD = notionalUSD / leverage;

  // Assistant calculations
  const assistSpec = ASSET_SPECS[assistAsset] || ASSET_SPECS['XAU/USD'];
  const assistRiskPct = assistRiskLevel === 'conservative' ? 1.0 : assistRiskLevel === 'moderate' ? 2.0 : 4.0;
  const assistRiskDollars = (assistCapital * assistRiskPct) / 100;
  const assistPips = assistStyle === 'scalper' ? 15 : assistStyle === 'daytrader' ? 35 : 100;
  const assistRawLots = Math.max(0.01, Number((assistRiskDollars / (assistPips * 10)).toFixed(2)));

  const content = (
    <div className="bg-slate-900 border border-slate-800 text-slate-100 rounded-2xl shadow-2xl overflow-hidden max-w-5xl w-full mx-auto">
      {/* Header Bar */}
      <div className="bg-slate-950 border-b border-slate-800 p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-br from-blue-600 to-indigo-600 p-3 rounded-xl shadow-lg shadow-blue-900/40">
            <Calculator className="w-6 h-6 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-white tracking-tight">
                Position Sizing, MT4/MT5 Orders & Risk Guide
              </h2>
              <span className="text-[10px] bg-blue-950 text-blue-400 border border-blue-800 px-2 py-0.5 rounded-md font-mono font-bold">
                PU PRIME / METATRADER COMPATIBLE
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Calculate exact volume (Lots vs USD), MetaTrader Order Types (Limit, Stop, Stop Limit), and Deposit Tier Matrices.
            </p>
          </div>
        </div>

        {isModal && onClose && (
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-2 hover:bg-slate-800 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Main Navigation Tabs */}
      <div className="bg-slate-900/90 border-b border-slate-800 px-5 pt-3 flex flex-wrap items-center gap-2 font-mono text-xs overflow-x-auto">
        <button
          onClick={() => setActiveTab('mtOrderTypes')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-t-lg font-semibold transition border-b-2 ${
            activeTab === 'mtOrderTypes'
              ? 'bg-slate-950 text-amber-400 border-amber-500 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 border-transparent hover:bg-slate-850'
          }`}
        >
          <Zap className="w-4 h-4 text-amber-400" />
          <span>1. MetaTrader Order Types Guide (MT4/MT5)</span>
        </button>

        <button
          onClick={() => setActiveTab('depositMatrix')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-t-lg font-semibold transition border-b-2 ${
            activeTab === 'depositMatrix'
              ? 'bg-slate-950 text-emerald-400 border-emerald-500 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 border-transparent hover:bg-slate-850'
          }`}
        >
          <DollarSign className="w-4 h-4 text-emerald-400" />
          <span>2. Deposit Tier Lot Matrix ($10 - $100k)</span>
        </button>

        <button
          onClick={() => setActiveTab('calculator')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-t-lg font-semibold transition border-b-2 ${
            activeTab === 'calculator'
              ? 'bg-slate-950 text-blue-400 border-blue-500 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 border-transparent hover:bg-slate-850'
          }`}
        >
          <Sliders className="w-4 h-4" />
          <span>3. Live Lot & Margin Calculator</span>
        </button>

        <button
          onClick={() => setActiveTab('guide')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-t-lg font-semibold transition border-b-2 ${
            activeTab === 'guide'
              ? 'bg-slate-950 text-blue-400 border-blue-500 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 border-transparent hover:bg-slate-850'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          <span>4. Lots vs. Volume vs. USD</span>
        </button>

        <button
          onClick={() => setActiveTab('assistant')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-t-lg font-semibold transition border-b-2 ${
            activeTab === 'assistant'
              ? 'bg-slate-950 text-blue-400 border-blue-500 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 border-transparent hover:bg-slate-850'
          }`}
        >
          <Sparkles className="w-4 h-4 text-amber-400" />
          <span>5. PU Prime Assistant</span>
        </button>

        <button
          onClick={() => setActiveTab('cheatsheet')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-t-lg font-semibold transition border-b-2 ${
            activeTab === 'cheatsheet'
              ? 'bg-slate-950 text-blue-400 border-blue-500 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 border-transparent hover:bg-slate-850'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>6. Asset Specs</span>
        </button>
      </div>

      {/* Tab Body */}
      <div className="p-6 space-y-6">
        {/* TAB 0: METATRADER ORDER TYPES GUIDE */}
        {activeTab === 'mtOrderTypes' && (
          <div className="space-y-6">
            <div className="bg-slate-950 border border-slate-800 p-5 rounded-xl border-l-4 border-l-amber-500">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Zap className="w-5 h-5 text-amber-400" />
                    <span>MetaTrader (MT4 / MT5) Order Execution Types Master Guide</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Complete reference for Market Execution, Limit Orders, Stop Orders, and Stop Limit Orders — as shown on MetaTrader 4/5 screens.
                  </p>
                </div>
                <span className="bg-amber-950 text-amber-300 border border-amber-800 text-[10px] font-mono px-3 py-1 rounded-full font-bold">
                  7 METATRADER TYPES
                </span>
              </div>
            </div>

            {/* Grid of 7 MetaTrader Order Types */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 font-mono text-xs">
              {/* 1. Market Execution */}
              <div className="bg-slate-950 border border-slate-800 p-5 rounded-xl space-y-3 relative overflow-hidden">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded bg-blue-600 text-white font-bold text-xs flex items-center justify-center">1</span>
                    <span className="font-bold text-sm text-white">Market Execution</span>
                  </div>
                  <span className="bg-blue-950 text-blue-400 border border-blue-800 text-[10px] px-2 py-0.5 rounded font-bold">
                    INSTANT ENTRY
                  </span>
                </div>
                <p className="text-slate-300 text-xs font-sans leading-relaxed">
                  Fills your order immediately at the current live market price (Ask for Buy, Bid for Sell).
                </p>
                <div className="bg-slate-900 p-3 rounded-lg border border-slate-800 space-y-1">
                  <div className="text-amber-400 font-bold">⚡ When to Use:</div>
                  <div className="text-slate-300 text-[11px] font-sans">
                    Use when momentum is strong right NOW, or when an urgent signal notification triggers on your dashboard.
                  </div>
                </div>
                <div className="text-[10px] text-slate-400 border-t border-slate-900 pt-2 flex justify-between">
                  <span>Price Condition: Immediate</span>
                  <span className="text-emerald-400">Execution Speed: Instant (~35ms)</span>
                </div>
              </div>

              {/* 2. Buy Limit */}
              <div className="bg-slate-950 border border-slate-800 p-5 rounded-xl space-y-3 relative overflow-hidden">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded bg-emerald-600 text-white font-bold text-xs flex items-center justify-center">2</span>
                    <span className="font-bold text-sm text-white">Buy Limit</span>
                  </div>
                  <span className="bg-emerald-950 text-emerald-400 border border-emerald-800 text-[10px] px-2 py-0.5 rounded font-bold">
                    PULLBACK BUY
                  </span>
                </div>
                <p className="text-slate-300 text-xs font-sans leading-relaxed">
                  Places an order <strong className="text-emerald-400">BELOW</strong> the current price. Triggers when price drops down to your key support level.
                </p>
                <div className="bg-slate-900 p-3 rounded-lg border border-slate-800 space-y-1">
                  <div className="text-emerald-400 font-bold">📉 When to Use:</div>
                  <div className="text-slate-300 text-[11px] font-sans">
                    Use when Gold or Forex is in an uptrend, but you want to get a cheap entry on a dip to support. (e.g. Current $4403, Buy Limit at $4380).
                  </div>
                </div>
                <div className="text-[10px] text-slate-400 border-t border-slate-900 pt-2 flex justify-between">
                  <span>Order Price: &lt; Current Price</span>
                  <span className="text-emerald-400">Direction: Expect Bounce UP</span>
                </div>
              </div>

              {/* 3. Sell Limit */}
              <div className="bg-slate-950 border border-slate-800 p-5 rounded-xl space-y-3 relative overflow-hidden">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded bg-rose-600 text-white font-bold text-xs flex items-center justify-center">3</span>
                    <span className="font-bold text-sm text-white">Sell Limit</span>
                  </div>
                  <span className="bg-rose-950 text-rose-400 border border-rose-800 text-[10px] px-2 py-0.5 rounded font-bold">
                    REJECTION SELL
                  </span>
                </div>
                <p className="text-slate-300 text-xs font-sans leading-relaxed">
                  Places an order <strong className="text-rose-400">ABOVE</strong> the current price. Triggers when price rallies up to key resistance level.
                </p>
                <div className="bg-slate-900 p-3 rounded-lg border border-slate-800 space-y-1">
                  <div className="text-rose-400 font-bold">📈 When to Use:</div>
                  <div className="text-slate-300 text-[11px] font-sans">
                    Use when market is in a downtrend, but you want to sell high at resistance rejection. (e.g. Current $4403, Sell Limit at $4423).
                  </div>
                </div>
                <div className="text-[10px] text-slate-400 border-t border-slate-900 pt-2 flex justify-between">
                  <span>Order Price: &gt; Current Price</span>
                  <span className="text-rose-400">Direction: Expect Rejection DOWN</span>
                </div>
              </div>

              {/* 4. Buy Stop */}
              <div className="bg-slate-950 border border-slate-800 p-5 rounded-xl space-y-3 relative overflow-hidden">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded bg-emerald-700 text-white font-bold text-xs flex items-center justify-center">4</span>
                    <span className="font-bold text-sm text-white">Buy Stop</span>
                  </div>
                  <span className="bg-emerald-950 text-emerald-300 border border-emerald-800 text-[10px] px-2 py-0.5 rounded font-bold">
                    BREAKOUT BUY
                  </span>
                </div>
                <p className="text-slate-300 text-xs font-sans leading-relaxed">
                  Places an order <strong className="text-emerald-400">ABOVE</strong> the current price. Triggers when price breaks out upwards through key resistance.
                </p>
                <div className="bg-slate-900 p-3 rounded-lg border border-slate-800 space-y-1">
                  <div className="text-emerald-300 font-bold">🚀 When to Use:</div>
                  <div className="text-slate-300 text-[11px] font-sans">
                    Use to catch momentum when price breaks out of a consolidation pattern. (e.g. Current $4403, Buy Stop at $4415).
                  </div>
                </div>
                <div className="text-[10px] text-slate-400 border-t border-slate-900 pt-2 flex justify-between">
                  <span>Order Price: &gt; Current Price</span>
                  <span className="text-emerald-400">Direction: Continuation UP</span>
                </div>
              </div>

              {/* 5. Sell Stop */}
              <div className="bg-slate-950 border border-slate-800 p-5 rounded-xl space-y-3 relative overflow-hidden">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded bg-rose-700 text-white font-bold text-xs flex items-center justify-center">5</span>
                    <span className="font-bold text-sm text-white">Sell Stop</span>
                  </div>
                  <span className="bg-rose-950 text-rose-300 border border-rose-800 text-[10px] px-2 py-0.5 rounded font-bold">
                    BREAKDOWN SELL
                  </span>
                </div>
                <p className="text-slate-300 text-xs font-sans leading-relaxed">
                  Places an order <strong className="text-rose-400">BELOW</strong> the current price. Triggers when price breaks down downwards through key support.
                </p>
                <div className="bg-slate-900 p-3 rounded-lg border border-slate-800 space-y-1">
                  <div className="text-rose-300 font-bold">💥 When to Use:</div>
                  <div className="text-slate-300 text-[11px] font-sans">
                    Use to catch panic selling when support fails. (e.g. Current $4403, Sell Stop at $4372).
                  </div>
                </div>
                <div className="text-[10px] text-slate-400 border-t border-slate-900 pt-2 flex justify-between">
                  <span>Order Price: &lt; Current Price</span>
                  <span className="text-rose-400">Direction: Continuation DOWN</span>
                </div>
              </div>

              {/* 6. Buy Stop Limit */}
              <div className="bg-slate-950 border border-slate-800 p-5 rounded-xl space-y-3 relative overflow-hidden">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded bg-blue-700 text-white font-bold text-xs flex items-center justify-center">6</span>
                    <span className="font-bold text-sm text-white">Buy Stop Limit (MT5)</span>
                  </div>
                  <span className="bg-blue-950 text-blue-300 border border-blue-800 text-[10px] px-2 py-0.5 rounded font-bold">
                    BREAKOUT RETEST BUY
                  </span>
                </div>
                <p className="text-slate-300 text-xs font-sans leading-relaxed">
                  Combines Buy Stop & Buy Limit. When price hits Stop Price (above current), it places a Buy Limit order at a lower price.
                </p>
                <div className="bg-slate-900 p-3 rounded-lg border border-slate-800 space-y-1">
                  <div className="text-blue-300 font-bold">🔄 When to Use:</div>
                  <div className="text-slate-300 text-[11px] font-sans">
                    Use when you want to wait for price to break out AND THEN retest the breakout point before buying.
                  </div>
                </div>
                <div className="text-[10px] text-slate-400 border-t border-slate-900 pt-2 flex justify-between">
                  <span>Requires: Stop Price & Limit Price</span>
                  <span className="text-blue-400">MT5 Advanced Type</span>
                </div>
              </div>

              {/* 7. Sell Stop Limit */}
              <div className="bg-slate-950 border border-slate-800 p-5 rounded-xl space-y-3 relative overflow-hidden md:col-span-2">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded bg-indigo-700 text-white font-bold text-xs flex items-center justify-center">7</span>
                    <span className="font-bold text-sm text-white">Sell Stop Limit (MT5)</span>
                  </div>
                  <span className="bg-indigo-950 text-indigo-300 border border-indigo-800 text-[10px] px-2 py-0.5 rounded font-bold">
                    BREAKDOWN RETEST SELL
                  </span>
                </div>
                <p className="text-slate-300 text-xs font-sans leading-relaxed">
                  Combines Sell Stop & Sell Limit. When price hits Stop Price (below current), it places a Sell Limit order at a higher price for retest selling.
                </p>
                <div className="bg-slate-900 p-3 rounded-lg border border-slate-800 space-y-1">
                  <div className="text-indigo-300 font-bold">🔁 When to Use:</div>
                  <div className="text-slate-300 text-[11px] font-sans">
                    Use when waiting for key support to break, followed by a pullback retest into broken support before opening a sell position.
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 1: LIVE CALCULATOR */}
        {activeTab === 'calculator' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Input Controls (7 cols) */}
            <div className="lg:col-span-7 bg-slate-950 border border-slate-800 p-5 rounded-xl space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-blue-400" />
                  <span>Trade Risk Parameters</span>
                </h3>
                <span className="text-[11px] text-slate-400 font-mono">PU Prime Account Config</span>
              </div>

              {/* Asset Pair Selector */}
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                  Select Asset / Instrument
                </label>
                <select
                  value={selectedSymbol}
                  onChange={(e) => {
                    setSelectedSymbol(e.target.value);
                    const spec = ASSET_SPECS[e.target.value];
                    if (spec) setStopLossPips(spec.defaultSlPips);
                  }}
                  className="w-full bg-slate-900 border border-slate-700 text-white text-xs font-mono px-3 py-2 rounded-lg focus:outline-none focus:border-blue-500"
                >
                  {Object.keys(ASSET_SPECS).map((sym) => (
                    <option key={sym} value={sym}>
                      {ASSET_SPECS[sym].symbol} — {ASSET_SPECS[sym].name} ({ASSET_SPECS[sym].category})
                    </option>
                  ))}
                </select>
              </div>

              {/* Balance & Risk Percent Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                    Account Balance (USD)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2 text-slate-500 text-xs">$</span>
                    <input
                      type="number"
                      value={balance}
                      onChange={(e) => setBalance(Number(e.target.value))}
                      className="w-full bg-slate-900 border border-slate-700 text-white text-xs font-mono pl-7 pr-3 py-2 rounded-lg focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300 flex items-center justify-between mb-1.5">
                    <span>Risk Percentage</span>
                    <span className="text-blue-400 font-mono font-bold">${riskAmountUSD.toFixed(2)} USD</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min="0.5"
                      max="5.0"
                      step="0.5"
                      value={riskPercent}
                      onChange={(e) => setRiskPercent(Number(e.target.value))}
                      className="w-full accent-blue-500"
                    />
                    <span className="text-xs font-mono text-white bg-slate-900 border border-slate-700 px-2 py-1 rounded w-14 text-center font-bold">
                      {riskPercent}%
                    </span>
                  </div>
                </div>
              </div>

              {/* Stop Loss & Leverage */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                    Stop Loss Distance ({currentSpec.category === 'Forex' ? 'Pips' : 'Points/Pips'})
                  </label>
                  <input
                    type="number"
                    value={stopLossPips}
                    onChange={(e) => setStopLossPips(Math.max(1, Number(e.target.value)))}
                    className="w-full bg-slate-900 border border-slate-700 text-white text-xs font-mono px-3 py-2 rounded-lg focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    Default SL for {selectedSymbol} is ~{currentSpec.defaultSlPips} pips/points.
                  </p>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                    PU Prime Leverage
                  </label>
                  <select
                    value={leverage}
                    onChange={(e) => setLeverage(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-700 text-white text-xs font-mono px-3 py-2 rounded-lg focus:outline-none focus:border-blue-500"
                  >
                    <option value={500}>1:500 (PU Prime High Leverage)</option>
                    <option value={200}>1:200</option>
                    <option value={100}>1:100 (Standard)</option>
                    <option value={50}>1:50</option>
                    <option value={30}>1:30 (Conservative)</option>
                  </select>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-3 rounded-lg text-xs space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-amber-400">
                  <Info className="w-3.5 h-3.5" />
                  <span>PU Prime Spec Note for {selectedSymbol}:</span>
                </div>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  {currentSpec.puPrimeNotes}
                </p>
              </div>
            </div>

            {/* Calculated Output Card (5 cols) */}
            <div className="lg:col-span-5 flex flex-col justify-between bg-gradient-to-b from-slate-950 to-blue-950/40 border border-blue-900/40 p-5 rounded-xl space-y-5">
              <div>
                <span className="text-xs font-bold text-blue-400 uppercase tracking-wider font-mono">
                  Calculation Results
                </span>
                <h3 className="text-xl font-extrabold text-white mt-1">
                  What to Enter on PU Prime
                </h3>
              </div>

              {/* Main Big Result Cards */}
              <div className="space-y-3">
                {/* 1. Volume in Lots */}
                <div className="bg-slate-900/90 border border-blue-500/30 p-4 rounded-xl shadow-lg">
                  <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                    Option A: Volume / Lot Size (Recommended for MT4/MT5)
                  </div>
                  <div className="text-3xl font-extrabold text-blue-400 font-mono mt-1 flex items-baseline gap-2">
                    <span>{calculatedLots.toFixed(2)}</span>
                    <span className="text-sm text-slate-300 font-normal">Lots</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Enter <strong className="text-white font-mono">{calculatedLots.toFixed(2)}</strong> in the "Volume" field in PU Prime / MT4.
                  </p>
                </div>

                {/* 2. Volume in USD Position */}
                <div className="bg-slate-900/90 border border-slate-800 p-3.5 rounded-xl">
                  <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                    Option B: Equivalent USD Contract Size
                  </div>
                  <div className="text-xl font-extrabold text-emerald-400 font-mono mt-1">
                    ${notionalUSD.toLocaleString(undefined, { maximumFractionDigits: 0 })} USD
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    If trading on a USD-denominated app, select <strong className="text-white font-mono">${notionalUSD.toFixed(0)}</strong> total position size.
                  </p>
                </div>
              </div>

              {/* Required Margin & Risk Summary */}
              <div className="bg-slate-950 border border-slate-800 p-3.5 rounded-xl text-xs space-y-2 font-mono">
                <div className="flex items-center justify-between text-slate-300">
                  <span>Max USD Risk:</span>
                  <span className="text-rose-400 font-bold">${riskAmountUSD.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between text-slate-300">
                  <span>Required Margin (at 1:{leverage}):</span>
                  <span className="text-blue-400 font-bold">${requiredMarginUSD.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between text-slate-300">
                  <span>Est. Pip Value:</span>
                  <span className="text-amber-400 font-bold">${(calculatedLots * pipValuePerLot).toFixed(2)} / pip</span>
                </div>
              </div>

              <div className="bg-emerald-950/40 border border-emerald-800/40 p-3 rounded-lg text-[11px] text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                <span>Risk managed! This position guarantees you only risk <strong>{riskPercent}% (${riskAmountUSD.toFixed(0)})</strong> if stop loss hits.</span>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: EXPLANATIONS OF LOTS, VOLUME, AND USD */}
        {activeTab === 'guide' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {/* Card 1: What is a Lot */}
              <div className="bg-slate-950 border border-slate-800 p-5 rounded-xl space-y-3">
                <div className="w-10 h-10 bg-blue-900/40 text-blue-400 rounded-xl flex items-center justify-center font-bold">
                  <Briefcase className="w-5 h-5" />
                </div>
                <h4 className="text-sm font-bold text-white">1. What is a "Lot"?</h4>
                <p className="text-xs text-slate-300 leading-relaxed">
                  A <strong>Lot</strong> is the standardized measurement for contract quantity in financial markets. 
                  Instead of typing 100,000 units of currency, you simply type <code className="bg-slate-900 text-blue-400 px-1 py-0.5 rounded font-mono">1.00</code>.
                </p>
                <div className="bg-slate-900 p-3 rounded-lg text-xs font-mono space-y-1 text-slate-300">
                  <div>• 1.00 Standard Lot = 100,000 units</div>
                  <div>• 0.10 Mini Lot = 10,000 units</div>
                  <div>• 0.01 Micro Lot = 1,000 units</div>
                </div>
              </div>

              {/* Card 2: What is Volume */}
              <div className="bg-slate-950 border border-slate-800 p-5 rounded-xl space-y-3">
                <div className="w-10 h-10 bg-indigo-900/40 text-indigo-400 rounded-xl flex items-center justify-center font-bold">
                  <TrendingUp className="w-5 h-5" />
                </div>
                <h4 className="text-sm font-bold text-white">2. What is "Volume"?</h4>
                <p className="text-xs text-slate-300 leading-relaxed">
                  In PU Prime / MetaTrader (MT4 & MT5), the order field labeled <strong>"Volume"</strong> is where you specify your position size in <strong>Lots</strong>.
                </p>
                <div className="bg-slate-900 p-3 rounded-lg text-xs font-mono space-y-1 text-slate-300">
                  <div>Volume input = <strong className="text-blue-400">0.05</strong></div>
                  <div>Means: Trade size of 0.05 Lots</div>
                  <div>(5,000 units of currency)</div>
                </div>
              </div>

              {/* Card 3: Lots vs USD Selection */}
              <div className="bg-slate-950 border border-slate-800 p-5 rounded-xl space-y-3">
                <div className="w-10 h-10 bg-emerald-900/40 text-emerald-400 rounded-xl flex items-center justify-center font-bold">
                  <DollarSign className="w-5 h-5" />
                </div>
                <h4 className="text-sm font-bold text-white">3. Selecting "Lots" vs. "USD"</h4>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Some trading platforms allow choosing order entry units in either <strong>Lots</strong> or total <strong>USD Value</strong>.
                </p>
                <div className="bg-slate-900 p-3 rounded-lg text-xs font-mono space-y-1 text-slate-300">
                  <div>• Select <strong>Lots</strong>: Direct contract sizing for MT4/MT5.</div>
                  <div>• Select <strong>USD</strong>: Allocate exact cash / leverage value.</div>
                </div>
              </div>
            </div>

            {/* Direct Comparison Table */}
            <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
              <div className="bg-slate-900 px-5 py-3 border-b border-slate-800 text-xs font-bold text-white flex items-center gap-2">
                <HelpCircle className="w-4 h-4 text-blue-400" />
                <span>Direct Comparison: When to use Lots vs. USD on PU Prime</span>
              </div>
              <div className="p-5">
                <table className="w-full text-xs text-left text-slate-300 font-mono">
                  <thead className="bg-slate-900 text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="p-3">Feature / Platform</th>
                      <th className="p-3 text-blue-400">Selecting "Lots"</th>
                      <th className="p-3 text-emerald-400">Selecting "USD"</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-850">
                    <tr>
                      <td className="p-3 font-sans font-semibold text-white">PU Prime MT4 / MT5 App</td>
                      <td className="p-3 text-emerald-400 font-bold">✓ Standard (Volume field)</td>
                      <td className="p-3 text-slate-500">Requires manual conversion</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-sans font-semibold text-white">Precision Control</td>
                      <td className="p-3">Step sizes like 0.01, 0.02, 0.10</td>
                      <td className="p-3">Dollar allocations like $100, $500, $1,000</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-sans font-semibold text-white">Pip Value Calculation</td>
                      <td className="p-3 text-amber-400">Fixed per lot (e.g. $10/pip for 1.00 lot)</td>
                      <td className="p-3">Fluctuates with current asset price</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-sans font-semibold text-white">Best Suited For</td>
                      <td className="p-3">Forex, Gold, Commodities trading</td>
                      <td className="p-3">Crypto, Stocks, Fixed Cash Risk allocation</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: PU PRIME ASSISTANT ("WHAT TO SELECT ACCORDINGLY") */}
        {activeTab === 'assistant' && (
          <div className="bg-slate-950 border border-slate-800 p-6 rounded-xl space-y-6">
            <div className="border-b border-slate-800 pb-4">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-amber-400" />
                <span>PU Prime Order Assistant — What to Select Accordingly</span>
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Answer 3 quick questions about your trade, and get the exact Lot volume to input into PU Prime.
              </p>
            </div>

            {/* Interactive Assistant Wizard Steps */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {/* Step 1: Capital & Risk */}
              <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl space-y-3">
                <span className="text-[10px] font-mono font-bold bg-blue-950 text-blue-400 px-2 py-0.5 rounded">
                  STEP 1: ACCOUNT & RISK
                </span>
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">Account Balance ($)</label>
                  <input
                    type="number"
                    value={assistCapital}
                    onChange={(e) => setAssistCapital(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-700 text-white text-xs font-mono px-3 py-1.5 rounded focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">Risk Appetite</label>
                  <select
                    value={assistRiskLevel}
                    onChange={(e) => setAssistRiskLevel(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-700 text-white text-xs font-mono px-3 py-1.5 rounded focus:outline-none focus:border-blue-500"
                  >
                    <option value="conservative">Conservative (1% Risk = ${((assistCapital * 1) / 100).toFixed(0)})</option>
                    <option value="moderate">Moderate (2% Risk = ${((assistCapital * 2) / 100).toFixed(0)})</option>
                    <option value="aggressive">Aggressive (4% Risk = ${((assistCapital * 4) / 100).toFixed(0)})</option>
                  </select>
                </div>
              </div>

              {/* Step 2: Trade Style & Asset */}
              <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl space-y-3">
                <span className="text-[10px] font-mono font-bold bg-indigo-950 text-indigo-400 px-2 py-0.5 rounded">
                  STEP 2: TRADE SETUP
                </span>
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">Target Asset</label>
                  <select
                    value={assistAsset}
                    onChange={(e) => setAssistAsset(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 text-white text-xs font-mono px-3 py-1.5 rounded focus:outline-none focus:border-blue-500"
                  >
                    {Object.keys(ASSET_SPECS).map((sym) => (
                      <option key={sym} value={sym}>{sym} ({ASSET_SPECS[sym].category})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">Trading Strategy Style</label>
                  <select
                    value={assistStyle}
                    onChange={(e) => setAssistStyle(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-700 text-white text-xs font-mono px-3 py-1.5 rounded focus:outline-none focus:border-blue-500"
                  >
                    <option value="scalper">⚡ Scalp Trade (Tight SL: ~15 Pips)</option>
                    <option value="daytrader">🎯 Day Trade (Standard SL: ~35 Pips)</option>
                    <option value="swing">🌊 Swing Trade (Wide SL: ~100 Pips)</option>
                  </select>
                </div>
              </div>

              {/* Step 3: Recommendation Result */}
              <div className="bg-gradient-to-b from-blue-950/60 to-slate-900 border border-blue-500/40 p-4 rounded-xl space-y-3 flex flex-col justify-between">
                <div>
                  <span className="text-[10px] font-mono font-bold bg-emerald-950 text-emerald-400 px-2 py-0.5 rounded">
                    RECOMMENDED PU PRIME VOLUME
                  </span>
                  <div className="text-3xl font-extrabold text-amber-400 font-mono mt-2">
                    {assistRawLots.toFixed(2)} Lots
                  </div>
                  <p className="text-xs text-slate-300 mt-1">
                    For a <strong className="text-white">{assistStyle}</strong> on <strong className="text-white">{assistAsset}</strong>.
                  </p>
                </div>

                <div className="bg-slate-950 p-3 rounded-lg text-[11px] font-mono space-y-1 text-slate-300 border border-slate-800">
                  <div className="flex justify-between">
                    <span>Selected Field:</span>
                    <span className="text-blue-400 font-bold">Volume</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Enter Value:</span>
                    <span className="text-amber-400 font-bold">{assistRawLots.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Risk Amount:</span>
                    <span className="text-rose-400 font-bold">${assistRiskDollars.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: ASSET CHEAT SHEET & PIP MATRIX */}
        {activeTab === 'cheatsheet' && (
          <div className="space-y-6">
            <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
              <div className="bg-slate-900 px-5 py-3 border-b border-slate-800 text-xs font-bold text-white flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-blue-400" />
                  <span>PU Prime Asset Contract Specifications & Pip Values</span>
                </span>
                <span className="text-[11px] text-slate-400 font-mono">Standard Lots vs Pip PnL</span>
              </div>

              <div className="p-4 overflow-x-auto">
                <table className="w-full text-xs text-left text-slate-300 font-mono">
                  <thead className="bg-slate-900 text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="p-3">Asset Symbol</th>
                      <th className="p-3">Category</th>
                      <th className="p-3">1.00 Lot Contract Size</th>
                      <th className="p-3">0.10 Lot Size</th>
                      <th className="p-3">0.01 Lot (Min)</th>
                      <th className="p-3 text-amber-400">1.00 Lot Pip Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-850">
                    {Object.values(ASSET_SPECS).map((spec) => (
                      <tr key={spec.symbol} className="hover:bg-slate-900/50">
                        <td className="p-3 font-bold text-white font-sans">{spec.symbol}</td>
                        <td className="p-3">
                          <span className="bg-slate-900 text-slate-400 px-2 py-0.5 rounded text-[10px]">
                            {spec.category}
                          </span>
                        </td>
                        <td className="p-3 text-blue-400">{spec.contractSize.toLocaleString()} {spec.unitName}</td>
                        <td className="p-3">{(spec.contractSize * 0.1).toLocaleString()} {spec.unitName}</td>
                        <td className="p-3">{(spec.contractSize * 0.01).toLocaleString()} {spec.unitName}</td>
                        <td className="p-3 text-amber-400 font-bold">
                          {spec.category === 'Forex' ? '$10.00 / pip' : spec.symbol === 'XAU/USD' ? '$10.00 / $0.10 move' : '$1.00 / point'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: DEPOSIT TIER LOT MATRIX ($10 TO $100,000 USD) */}
        {activeTab === 'depositMatrix' && (
          <div className="space-y-6">
            <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
              {/* Header bar with filters */}
              <div className="bg-slate-900 p-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-emerald-400" />
                    <span>Deposit Amount vs. Required Lot Sizes ($10 to $100,000 USD)</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Recommended lot sizes for PU Prime based on account balance and risk management rules.
                  </p>
                </div>

                {/* Stop Loss Filter for Matrix */}
                <div className="flex items-center gap-2 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 text-xs font-mono">
                  <span className="text-slate-400">Assumed Stop Loss:</span>
                  <button
                    type="button"
                    onClick={() => setMatrixSlPips(15)}
                    className={`px-2 py-0.5 rounded font-bold transition ${matrixSlPips === 15 ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
                  >
                    15 Pips (Scalp)
                  </button>
                  <button
                    type="button"
                    onClick={() => setMatrixSlPips(30)}
                    className={`px-2 py-0.5 rounded font-bold transition ${matrixSlPips === 30 ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
                  >
                    30 Pips (Day Trade)
                  </button>
                  <button
                    type="button"
                    onClick={() => setMatrixSlPips(50)}
                    className={`px-2 py-0.5 rounded font-bold transition ${matrixSlPips === 50 ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
                  >
                    50 Pips (Swing)
                  </button>
                </div>
              </div>

              {/* Table */}
              <div className="p-4 overflow-x-auto">
                <table className="w-full text-xs text-left text-slate-300 font-mono">
                  <thead className="bg-slate-900 text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="p-3">Deposit Amount ($)</th>
                      <th className="p-3 text-blue-400">1% Risk (Cons.)</th>
                      <th className="p-3 text-emerald-400">2% Risk (Mod.)</th>
                      <th className="p-3 text-rose-400">4% Risk (Agg.)</th>
                      <th className="p-3 text-amber-400 font-bold">Recommended PU Prime Volume</th>
                      <th className="p-3">Min Margin (1:500)</th>
                      <th className="p-3">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-850">
                    {[
                      { amount: 10, label: '$10 USD (Micro Starter)' },
                      { amount: 25, label: '$25 USD' },
                      { amount: 50, label: '$50 USD' },
                      { amount: 100, label: '$100 USD (Standard Micro)' },
                      { amount: 250, label: '$250 USD' },
                      { amount: 500, label: '$500 USD' },
                      { amount: 1000, label: '$1,000 USD (Mini Account)' },
                      { amount: 2500, label: '$2,500 USD' },
                      { amount: 5000, label: '$5,000 USD' },
                      { amount: 10000, label: '$10,000 USD (Standard Account)' },
                      { amount: 25000, label: '$25,000 USD (Funded Tier)' },
                      { amount: 50000, label: '$50,000 USD' },
                      { amount: 100000, label: '$100,000 USD (Institutional Tier)' },
                    ].map((tier) => {
                      const risk1 = (tier.amount * 0.01) / (matrixSlPips * 10);
                      const risk2 = (tier.amount * 0.02) / (matrixSlPips * 10);
                      const risk4 = (tier.amount * 0.04) / (matrixSlPips * 10);

                      const lot1 = Math.max(0.01, Number(risk1.toFixed(2)));
                      const lot2 = Math.max(0.01, Number(risk2.toFixed(2)));
                      const lot4 = Math.max(0.01, Number(risk4.toFixed(2)));

                      const margin = (lot2 * 100000) / 500;

                      return (
                        <tr key={tier.amount} className="hover:bg-slate-900/60 transition">
                          <td className="p-3 font-bold text-white font-sans">
                            <span className="text-emerald-400 font-mono font-extrabold">{tier.label}</span>
                          </td>
                          <td className="p-3 text-blue-400 font-bold">{lot1.toFixed(2)} Lot</td>
                          <td className="p-3 text-emerald-400 font-bold">{lot2.toFixed(2)} Lot</td>
                          <td className="p-3 text-rose-400 font-bold">{lot4.toFixed(2)} Lot</td>
                          <td className="p-3 text-amber-300 font-bold bg-amber-950/20 rounded">
                            {lot1 === lot2 ? `${lot1.toFixed(2)} Lot` : `${lot1.toFixed(2)} - ${lot2.toFixed(2)} Lots`}
                          </td>
                          <td className="p-3 text-slate-400">${margin.toFixed(2)}</td>
                          <td className="p-3">
                            <button
                              type="button"
                              onClick={() => {
                                setBalance(tier.amount);
                                setStopLossPips(matrixSlPips);
                                setActiveTab('calculator');
                              }}
                              className="bg-blue-600/30 hover:bg-blue-600 text-blue-300 hover:text-white px-2.5 py-1 rounded text-[11px] font-sans font-semibold transition border border-blue-500/40"
                            >
                              Load in Sizer →
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer info bar */}
      <div className="bg-slate-950 border-t border-slate-800 px-6 py-3 flex flex-wrap items-center justify-between text-xs text-slate-500 font-mono">
        <span>PU Prime Position Sizer • Always risk no more than 1-2% of total capital per trade.</span>
        <div className="flex items-center gap-2 text-blue-400">
          <Zap className="w-3.5 h-3.5" />
          <span>Institutional Risk Standard</span>
        </div>
      </div>
    </div>
  );

  if (isModal) {
    return (
      <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
        {content}
      </div>
    );
  }

  return content;
}
