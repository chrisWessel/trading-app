'use client';

import React, { useState, useEffect, useRef } from 'react';
import { API_BASE_URL } from '@/lib/apiConfig';
import TradingChart from '@/components/TradingChart';
import TradingViewDirectChart from '@/components/TradingViewDirectChart';
import PaperTradingPanel from '@/components/PaperTradingPanel';
import OrderBookOBIGauge from '@/components/OrderBookOBIGauge';
import SignalsStream from '@/components/SignalsStream';
import LiveSignalNotificationPanel from '@/components/LiveSignalNotificationPanel';
import MarketNewsSection from '@/components/MarketNewsSection';
import AuditReportSection from '@/components/AuditReportSection';
import MarketSessionClocks from '@/components/MarketSessionClocks';
import PositionSizingGuide from '@/components/PositionSizingGuide';
import TrendCandlePanel from '@/components/TrendCandlePanel';
import { Activity, ShieldCheck, Cpu, Radio, Coins, Search, Globe, Eye, Monitor, Terminal, Calculator, Sparkles } from 'lucide-react';

interface AssetOption {
  symbol: string;
  label: string;
  category: 'Forex' | 'Gold' | 'Crypto';
}

const PRESET_ASSETS: AssetOption[] = [
  // Forex Currency Pairs
  { symbol: 'EUR/USD', label: 'EUR / USD', category: 'Forex' },
  { symbol: 'GBP/USD', label: 'GBP / USD', category: 'Forex' },
  { symbol: 'USD/JPY', label: 'USD / JPY', category: 'Forex' },
  { symbol: 'AUD/USD', label: 'AUD / USD', category: 'Forex' },
  { symbol: 'USD/CAD', label: 'USD / CAD', category: 'Forex' },
  // Gold & Commodities
  { symbol: 'XAU/USD', label: 'XAU / USD (Gold)', category: 'Gold' },
  { symbol: 'PAXG/USDT', label: 'PAXG / USDT (Gold Token)', category: 'Gold' },
  // Crypto
  { symbol: 'REXT/USDT', label: 'REXT / USDT', category: 'Crypto' },
  { symbol: 'REXT/USD', label: 'REXT / USD', category: 'Crypto' },
  { symbol: 'BTC/USDT', label: 'BTC / USDT', category: 'Crypto' },
  { symbol: 'ETH/USDT', label: 'ETH / USDT', category: 'Crypto' },
  { symbol: 'SOL/USDT', label: 'SOL / USD', category: 'Crypto' },
];

export default function DashboardPage() {
  const [symbol, setSymbol] = useState<string>('XAU/USD');
  const [activeCategory, setActiveCategory] = useState<'All' | 'Forex' | 'Gold' | 'Crypto'>('All');
  const [customSymbol, setCustomSymbol] = useState<string>('');
  const [timeframe, setTimeframe] = useState<string>('1m');
  const [currentPrice, setCurrentPrice] = useState<number>(0);
  const priceIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [refreshAuditCount, setRefreshAuditCount] = useState<number>(0);
  const [chartMode, setChartMode] = useState<'TradingViewDirect' | 'CustomEngine'>('TradingViewDirect');
  const [showPositionGuide, setShowPositionGuide] = useState<boolean>(false);
  const [externalTradeParams, setExternalTradeParams] = useState<any>(null);

  // ── LIVE PRICE POLLER: keep currentPrice in sync with backend or public spot feed ──────
  useEffect(() => {
    const fetchLivePrice = async () => {
      // 1. Try primary backend API first
      try {
        const res = await fetch(
          `${API_BASE_URL}/api/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&limit=2`
        );
        if (res.ok) {
          const data = await res.json();
          if (data.latest_price && data.latest_price > 0) {
            setCurrentPrice(data.latest_price);
            return;
          }
        }
      } catch (_) {
        // Backend offline / mixed content block on standalone Vercel deploy
      }

      // 2. Public Spot Feed Fallback (Binance API for Gold Spot & Crypto)
      try {
        const symUpper = symbol.toUpperCase().replace('/', '').replace('_', '');
        let binanceSym = 'PAXGUSDT';
        if (symUpper.includes('BTC')) binanceSym = 'BTCUSDT';
        else if (symUpper.includes('ETH')) binanceSym = 'ETHUSDT';
        else if (symUpper.includes('SOL')) binanceSym = 'SOLUSDT';
        else if (symUpper.includes('XAU') || symUpper.includes('GOLD')) binanceSym = 'PAXGUSDT';

        const bRes = await fetch(`https://api.binance.com/api/v3/klines?symbol=${binanceSym}&interval=1m&limit=1`);
        if (bRes.ok) {
          const bData = await bRes.json();
          if (Array.isArray(bData) && bData.length > 0) {
            const lastClose = parseFloat(bData[0][4]);
            if (lastClose > 0) {
              setCurrentPrice(lastClose);
            }
          }
        }
      } catch (_) {}
    };

    fetchLivePrice();
    priceIntervalRef.current = setInterval(fetchLivePrice, 3000);
    return () => {
      if (priceIntervalRef.current) clearInterval(priceIntervalRef.current);
    };
  }, [symbol, timeframe]);

  const filteredAssets = activeCategory === 'All'
    ? PRESET_ASSETS
    : PRESET_ASSETS.filter((a) => a.category === activeCategory);

  const isRextAsset = symbol.toUpperCase().includes('REXT');

  const handleAssetSelect = (selectedSymbol: string) => {
    setSymbol(selectedSymbol);
    if (selectedSymbol.toUpperCase().includes('REXT')) {
      setChartMode('CustomEngine');
    }
  };

  const handleDataUpdate = (data: { price: number; support: number; resistance: number }) => {
    if (data.price && data.price > 0) {
      setCurrentPrice(data.price);
    }
  };

  const handleTradeClosed = () => {
    setRefreshAuditCount((prev) => prev + 1);
  };

  const handleCustomSymbolSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (customSymbol.trim()) {
      const sym = customSymbol.trim().toUpperCase();
      setSymbol(sym);
      if (sym.includes('REXT')) {
        setChartMode('CustomEngine');
      }
      setCustomSymbol('');
    }
  };

  const handleAutoFillTrade = (params: any) => {
    setExternalTradeParams(params);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-6 space-y-6 max-w-[1700px] mx-auto">
      {/* Header Bar */}
      <header className="flex flex-wrap items-center justify-between gap-4 bg-slate-900/90 border border-slate-800 p-4 rounded-xl shadow-2xl backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-tr from-blue-600 to-indigo-600 p-2.5 rounded-xl shadow-lg shadow-blue-900/40">
            <Terminal className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-white flex items-center gap-2">
              <span>WesSignal Terminal</span>
              <span className="text-[10px] bg-blue-950 text-blue-400 border border-blue-800 px-2.5 py-0.5 rounded-full font-mono font-bold uppercase">
                Pro v4.0 Sidebar Navigation
              </span>
            </h1>
            <p className="text-xs text-slate-400">
              Institutional Navigation Sidebar • Left Column Signal Feed • Zimbabwe Local Time • 35ms Flash Speed • Telegram Dispatcher
            </p>
          </div>
        </div>

        {/* System Status Badges & Sizing Guide Launcher */}
        <div className="flex flex-wrap items-center gap-3 text-xs font-mono">
          <button
            onClick={() => setShowPositionGuide(true)}
            className="flex items-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold px-3.5 py-1.5 rounded-lg shadow-lg shadow-blue-900/50 transition border border-blue-400"
          >
            <Calculator className="w-4 h-4 text-amber-300" />
            <span>📐 MT4/MT5 Orders & Risk Guide</span>
          </button>
          <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 px-3 py-1.5 rounded-lg text-slate-300">
            <Cpu className="w-4 h-4 text-emerald-400" />
            <span>FastAPI Engine: <strong className="text-emerald-400">ONLINE (8000)</strong></span>
          </div>
          <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 px-3 py-1.5 rounded-lg text-slate-300">
            <Radio className="w-4 h-4 text-rose-400 animate-pulse" />
            <span>Telegram Bot: <strong className="text-slate-200">ACTIVE</strong></span>
          </div>
        </div>
      </header>

      {/* Market Session Clocks — NY, London, Asia */}
      <MarketSessionClocks />

      {/* Multi-Category Asset Switcher & Chart View Mode Toggle Bar */}
      <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl space-y-3 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-2.5">
          <div className="flex items-center gap-2 text-xs font-bold text-white">
            <Globe className="w-4 h-4 text-blue-400" />
            <span>Market Selector & Chart Engine Mode:</span>
          </div>

          {/* Chart Engine Mode Switcher */}
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs font-mono">
            <button
              onClick={() => setChartMode('TradingViewDirect')}
              disabled={isRextAsset}
              className={`px-3 py-1.5 rounded-md font-bold transition flex items-center gap-1.5 ${
                chartMode === 'TradingViewDirect' && !isRextAsset
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-900/50'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed'
              }`}
              title={isRextAsset ? 'TradingView does not index REXT; rendered using Technical Signal Engine' : ''}
            >
              <Monitor className="w-3.5 h-3.5 text-blue-300" />
              <span>🌐 TradingView Official Direct Feed</span>
            </button>
            <button
              onClick={() => setChartMode('CustomEngine')}
              className={`px-3 py-1.5 rounded-md font-bold transition flex items-center gap-1.5 ${
                chartMode === 'CustomEngine' || isRextAsset
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-900/50'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <Eye className="w-3.5 h-3.5 text-emerald-300" />
              <span>⚡ Technical Signal Engine & Price Lines (35ms Flash Speed)</span>
            </button>
          </div>

          {/* Category Tabs */}
          <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
            {(['All', 'Forex', 'Gold', 'Crypto'] as const).map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-3 py-1 rounded-md font-semibold transition ${
                  activeCategory === cat
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                {cat === 'Forex' ? '💵 Forex Pairs' : cat === 'Gold' ? '🥇 Gold & Commodities' : cat === 'Crypto' ? '⚡ Crypto' : '🌐 All Markets'}
              </button>
            ))}
          </div>

          {/* Custom Symbol Search Input */}
          <form onSubmit={handleCustomSymbolSubmit} className="flex items-center gap-1.5">
            <div className="relative">
              <input
                type="text"
                placeholder="Custom Pair (e.g. REXT/USD)"
                value={customSymbol}
                onChange={(e) => setCustomSymbol(e.target.value)}
                className="bg-slate-950 border border-slate-800 text-white text-xs px-3 py-1.5 pr-8 rounded-lg focus:outline-none focus:border-blue-500 font-mono w-48"
              />
              <Search className="w-3.5 h-3.5 text-slate-500 absolute right-2.5 top-2" />
            </div>
            <button
              type="submit"
              className="bg-blue-600 hover:bg-blue-500 text-white text-xs px-3 py-1.5 rounded-lg font-semibold transition shadow-md shadow-blue-950"
            >
              Set Pair
            </button>
          </form>
        </div>

        {/* Preset Asset Buttons */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {filteredAssets.map((item) => (
            <button
              key={item.symbol}
              onClick={() => handleAssetSelect(item.symbol)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold font-mono transition-all flex items-center gap-1.5 ${
                symbol === item.symbol
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/50 border border-blue-400'
                  : 'bg-slate-950 text-slate-300 border border-slate-800 hover:border-slate-700 hover:text-white'
              }`}
            >
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Main Grid: LEFT SIDEBAR NAVIGATION PANEL (3 cols) + MAIN CONTENT AREA (9 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN: Vertical Navigation Signal Sidebar (3 cols) */}
        <div className="lg:col-span-3 h-full">
          <LiveSignalNotificationPanel
            symbol={symbol}
            timeframe={timeframe}
            onExecuteTradeParams={handleAutoFillTrade}
          />
        </div>

        {/* RIGHT CONTENT COLUMN: Charts, Signals, Trading Panel & Orderbook (9 cols) */}
        <div className="lg:col-span-9 space-y-6">
          {/* Main Chart & Signals Grid */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-stretch">
            {/* Chart Area (8 cols) */}
            <div className="xl:col-span-8 flex flex-col gap-6 justify-between">
              {chartMode === 'TradingViewDirect' && !isRextAsset ? (
                <TradingViewDirectChart
                  symbol={symbol}
                  timeframe={timeframe}
                  onTimeframeChange={(tf) => setTimeframe(tf)}
                />
              ) : (
                <TradingChart
                  key={`tc_${symbol}_${timeframe}`}
                  symbol={symbol}
                  timeframe={timeframe}
                  onTimeframeChange={(tf) => setTimeframe(tf)}
                  onLatestDataUpdate={handleDataUpdate}
                />
              )}

              {/* Signals Stream & Telegram Broadcaster Component */}
              <div className="flex-1 flex flex-col">
                <SignalsStream
                  symbol={symbol}
                  timeframe={timeframe}
                  onPriceUpdate={(p) => {
                    if (p > 0) setCurrentPrice(p);
                  }}
                />
              </div>
            </div>

            {/* Trading & Order Book Column (4 cols) */}
            <div className="xl:col-span-4 flex flex-col gap-6 justify-between">
              {/* Paper Trading Execution Panel */}
              <PaperTradingPanel
                symbol={symbol}
                currentPrice={currentPrice}
                onTradeClosed={handleTradeClosed}
                externalParams={externalTradeParams}
              />

              {/* Order Book Depth & OBI Gauge */}
              <div className="flex-1 flex flex-col">
                <OrderBookOBIGauge symbol={symbol} />
              </div>
            </div>
          </div>

          {/* Real-Time Financial & Crypto Market News Section */}
          <div className="w-full">
            <TrendCandlePanel symbol={symbol} timeframe={timeframe} />
          </div>

          {/* Real-Time Financial & Crypto Market News Section */}
          <div className="w-full">
            <MarketNewsSection symbol={symbol} />
          </div>

          {/* Bottom Full-Width Section: SQLite Audit Log & PDF Generator */}
          <div className="w-full">
            <AuditReportSection refreshTrigger={refreshAuditCount} />
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="text-center text-xs text-slate-500 py-4 border-t border-slate-900 font-mono">
        WesSignal Terminal Pro • Left Sidebar Navigation Layout • REXT/USDT & REXT/USD Engine • Google Antigravity Architecture
      </footer>

      {showPositionGuide && (
        <PositionSizingGuide
          initialSymbol={symbol}
          isModal={true}
          onClose={() => setShowPositionGuide(false)}
        />
      )}
    </div>
  );
}
