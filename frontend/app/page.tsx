'use client';

import React, { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { API_BASE_URL } from '@/lib/apiConfig';
import TradingChart from '@/components/TradingChart';
import type { ChartTabId } from '@/components/TradingChart';
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
import { Activity, ShieldCheck, Cpu, Radio, Coins, Search, Globe, Eye, Monitor, Calculator, Sparkles, Zap, Play, ArrowUpRight, ArrowDownRight } from 'lucide-react';

interface AssetOption {
  symbol: string;
  label: string;
  category: 'Forex' | 'Gold' | 'Indices' | 'Crypto';
}

const PRESET_ASSETS: AssetOption[] = [
  // Gold, Metals & Commodities
  { symbol: 'XAU/USD', label: 'XAU / USD (Gold)', category: 'Gold' },
  { symbol: 'XAG/USD', label: 'XAG / USD (Silver)', category: 'Gold' },
  { symbol: 'USOIL', label: 'USOIL (WTI Crude)', category: 'Gold' },
  // Forex Majors & Crosses
  { symbol: 'EUR/USD', label: 'EUR / USD', category: 'Forex' },
  { symbol: 'GBP/USD', label: 'GBP / USD', category: 'Forex' },
  { symbol: 'USD/JPY', label: 'USD / JPY', category: 'Forex' },
  { symbol: 'USD/CHF', label: 'USD / CHF', category: 'Forex' },
  { symbol: 'AUD/USD', label: 'AUD / USD', category: 'Forex' },
  { symbol: 'USD/CAD', label: 'USD / CAD', category: 'Forex' },
  { symbol: 'NZD/USD', label: 'NZD / USD', category: 'Forex' },
  { symbol: 'EUR/GBP', label: 'EUR / GBP', category: 'Forex' },
  { symbol: 'EUR/JPY', label: 'EUR / JPY', category: 'Forex' },
  { symbol: 'GBP/JPY', label: 'GBP / JPY', category: 'Forex' },
  // Global Indices (Exness MT5)
  { symbol: 'US30', label: 'US30 (Dow Jones)', category: 'Indices' },
  { symbol: 'NAS100', label: 'NAS100 (USTEC)', category: 'Indices' },
  { symbol: 'SPX500', label: 'SPX500 (S&P 500)', category: 'Indices' },
  { symbol: 'GER40', label: 'GER40 (DAX)', category: 'Indices' },
  // Crypto (24/7 Exness MT5 & Spot)
  { symbol: 'BTC/USDT', label: 'BTC / USD', category: 'Crypto' },
  { symbol: 'ETH/USDT', label: 'ETH / USD', category: 'Crypto' },
  { symbol: 'SOL/USDT', label: 'SOL / USD', category: 'Crypto' },
  { symbol: 'XRP/USDT', label: 'XRP / USD', category: 'Crypto' },
  { symbol: 'BNB/USDT', label: 'BNB / USD', category: 'Crypto' },
  { symbol: 'DOGE/USDT', label: 'DOGE / USD', category: 'Crypto' },
  { symbol: 'ADA/USDT', label: 'ADA / USD', category: 'Crypto' },
  { symbol: 'REXT/USDT', label: 'REXT / USDT', category: 'Crypto' },
];

const MT5_LOCAL_TOKEN = 'wessignal_mt5_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a';

export default function DashboardPage() {
  const [symbol, setSymbol] = useState<string>('XAU/USD');
  const [activeCategory, setActiveCategory] = useState<'All' | 'Forex' | 'Gold' | 'Indices' | 'Crypto'>('All');
  const [customSymbol, setCustomSymbol] = useState<string>('');
  const [timeframe, setTimeframe] = useState<string>('5m');
  const [currentPrice, setCurrentPrice] = useState<number>(0);
  const priceIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [refreshAuditCount, setRefreshAuditCount] = useState<number>(0);
  const [chartMode, setChartMode] = useState<'TradingViewDirect' | 'CustomEngine'>('CustomEngine');
  const [showPositionGuide, setShowPositionGuide] = useState<boolean>(false);
  const [externalTradeParams, setExternalTradeParams] = useState<any>(null);
  const [engineStatus, setEngineStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [telegramStatus, setTelegramStatus] = useState<'unknown' | 'configured' | 'simulation'>('unknown');
  const [goldFeedLabel, setGoldFeedLabel] = useState<string>('CHECKING');
  const [goldFeedMessage, setGoldFeedMessage] = useState<string>('');

  // Top-level MT5 2-Button Execution Bar State
  const [topLotSize, setTopLotSize] = useState<number>(0.01);
  const [topDirection, setTopDirection] = useState<'BUY' | 'SELL'>('BUY');
  const [topMt5Syncing, setTopMt5Syncing] = useState<boolean>(false);
  const [topMt5Ordering, setTopMt5Ordering] = useState<boolean>(false);
  const [topMt5Status, setTopMt5Status] = useState<string>('MT5 Bridge Ready (Port 8001 + Cloudflare Tunnel)');
  const [topMt5Receipt, setTopMt5Receipt] = useState<any | null>(null);

  const handleTopExecuteSync = async () => {
    setTopMt5Syncing(true);
    setTopMt5Status('1. Starting Cloudflare Tunnel & Pushing new URL to GitHub/Vercel...');
    try {
      let json: any = null;
      try {
        const localRes = await fetch('http://127.0.0.1:8001/bridge/execute-sync', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${MT5_LOCAL_TOKEN}`,
            'Content-Type': 'application/json',
          },
        });
        if (localRes.ok) json = await localRes.json();
      } catch {}

      if (!json) {
        const apiRes = await fetch('/api/mt5', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'execute_sync' }),
        });
        json = await apiRes.json();
      }

      const url = json?.tunnel_url || json?.resolved_bridge_url || '';
      const pushed = Boolean(json?.git_sync?.pushed || json?.status === 'synced');
      setTopMt5Status(
        pushed
          ? `✅ Tunnel Active & Pushed to GitHub/Vercel! URL: ${url}`
          : json?.message || json?.error || `Tunnel: ${url || 'Active'}`
      );
    } catch (e: any) {
      setTopMt5Status(`⚠️ Sync notice: ${e?.message || 'Ensure start_bridge.bat is running on your PC.'}`);
    } finally {
      setTopMt5Syncing(false);
    }
  };

  const handleTopPlaceOrder = async (dirOverride?: 'BUY' | 'SELL') => {
    const dir = dirOverride || topDirection;
    setTopDirection(dir);
    setTopMt5Ordering(true);
    setTopMt5Receipt(null);
    const payload = {
      mode: 'place_order',
      symbol,
      action: dir,
      volume: topLotSize,
      timeframe,
      dry_run: false,
    };
    try {
      let json: any = null;
      try {
        const localRes = await fetch('http://127.0.0.1:8001/webhook/mt5', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${MT5_LOCAL_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });
        json = await localRes.json();
      } catch {}

      if (!json) {
        const apiRes = await fetch('/api/mt5', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        json = await apiRes.json();
      }
      setTopMt5Receipt(json);
    } catch (e: any) {
      setTopMt5Receipt({
        status: 'error',
        retcode_name: e?.message || 'Could not reach MT5 bridge.',
      });
    } finally {
      setTopMt5Ordering(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    const checkServices = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/`, { cache: 'no-store' });
        if (!res.ok) throw new Error('Backend health check failed');
        const data = await res.json();
        if (mounted) {
          setEngineStatus('online');
          setTelegramStatus(data.telegram_configured ? 'configured' : 'simulation');
          setGoldFeedLabel(data.gold_feed?.label || 'FREE PAXG REFERENCE');
          setGoldFeedMessage(data.gold_feed?.message || '');
        }
      } catch {
        if (mounted) {
          setEngineStatus('offline');
          setTelegramStatus('unknown');
          setGoldFeedLabel('BACKEND OFFLINE');
          setGoldFeedMessage('Backend health check failed.');
        }
      }
    };
    checkServices();
    const interval = setInterval(checkServices, 15000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

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
          if (data.data_source !== 'SIMULATED' && data.latest_price && data.latest_price > 0) {
            setCurrentPrice(data.latest_price);
            return;
          }
        }
      } catch (_) {
        // Backend offline / mixed content block on standalone Vercel deploy
      }

      const normalizedSymbol = symbol.toUpperCase();
      const isGold = normalizedSymbol.includes('XAU') || normalizedSymbol.includes('GOLD');

      // 2. Public Spot Feed Fallback (Kraken / Binance with browser CORS support)
      try {
        if (isGold) {
          const kRes = await fetch('https://api.kraken.com/0/public/Ticker?pair=PAXGUSD');
          if (kRes.ok) {
            const kData = await kRes.json();
            const p = parseFloat(kData?.result?.PAXGUSD?.c?.[0]);
            if (p > 2000) {
              setCurrentPrice(p);
              return;
            }
          }
        }

        const symUpper = symbol.toUpperCase().replace('/', '').replace('_', '');
        let binanceSym = isGold ? 'PAXGUSDT' : 'BTCUSDT';
        if (symUpper.includes('BTC')) binanceSym = 'BTCUSDT';
        else if (symUpper.includes('ETH')) binanceSym = 'ETHUSDT';
        else if (symUpper.includes('SOL')) binanceSym = 'SOLUSDT';
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
    priceIntervalRef.current = setInterval(fetchLivePrice, 10000);
    return () => {
      if (priceIntervalRef.current) clearInterval(priceIntervalRef.current);
    };
  }, [symbol, timeframe]);

  const [workspaceTab, setWorkspaceTab] = useState<'terminal' | 'paperDesk'>('terminal');
  const [activeChartTab, setActiveChartTab] = useState<ChartTabId>('live_signals');

  useEffect(() => {
    const storedTab = window.sessionStorage.getItem('wesignal.active-chart-tab');
    if (
      storedTab === 'live_signals' ||
      storedTab === 'algo_market_structure' ||
      storedTab === 'ict_scalp' ||
      storedTab === 'news_trading' ||
      storedTab === 'daily_sweep' ||
      storedTab === 's_tier' ||
      storedTab === 'a_tier' ||
      storedTab === 'b_tier'
    ) {
      setActiveChartTab(storedTab);
    }
  }, []);

  const handleChartTabChange = (tab: ChartTabId) => {
    setActiveChartTab(tab);
    window.sessionStorage.setItem('wesignal.active-chart-tab', tab);
  };

  const filteredAssets = activeCategory === 'All'
    ? PRESET_ASSETS
    : PRESET_ASSETS.filter((a) => a.category === activeCategory);

  const isRextAsset = symbol.toUpperCase().includes('REXT');
  const isGoldAsset = symbol.toUpperCase().includes('XAU') || symbol.toUpperCase().includes('GOLD');

  const handleAssetSelect = (selectedSymbol: string) => {
    setSymbol(selectedSymbol);
    setCurrentPrice(0);
    // Keep CustomEngine active for ALL pairs so all 8 strategy tabs and Signal Lines work on every pair
    setChartMode('CustomEngine');
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
      setCurrentPrice(0);
      setChartMode('CustomEngine');
      setCustomSymbol('');
    }
  };

  const handleAutoFillTrade = (params: any) => {
    setExternalTradeParams(params);
    setWorkspaceTab('paperDesk');
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-6 space-y-6 max-w-[1700px] mx-auto">
      {/* Header Bar */}
      <header className="flex flex-wrap items-center justify-between gap-4 bg-slate-900/90 border border-slate-800 p-4 rounded-xl shadow-2xl backdrop-blur-md">
        <div className="flex items-center gap-3">
          {/* Brand lockup is a 3.33:1 raster, so it is sized by height to keep
              the proportions and the header row height stable. Served unoptimized:
              it is one static 38 KB asset, so the resize pipeline would add a
              sharp dependency without changing what is delivered. */}
          <Image
            src="/logo.jpg"
            alt="WesSignal Trading"
            width={1200}
            height={360}
            className="h-11 w-auto rounded-lg"
            priority
            unoptimized
          />
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-white flex items-center gap-2">
              <span>WesSignal Terminal</span>
              <span className="text-[10px] bg-blue-950 text-blue-400 border border-blue-800 px-2.5 py-0.5 rounded-full font-mono font-bold uppercase">
                Pro v4.0 · All Markets + MT5 Auto-Bridge
              </span>
            </h1>
            <p className="text-xs text-slate-400">
              Multi-Asset Signal Engine (Forex • Metals • Indices • Crypto) • Exness MT5 Live Execution Bridge
            </p>
          </div>
        </div>

        {/* System Status Badges, Workspace Switcher & Sizing Guide Launcher */}
        <div className="flex flex-wrap items-center gap-3 text-xs font-mono">
          {/* Workspace View Mode Tab Switcher */}
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
            <button
              onClick={() => setWorkspaceTab('terminal')}
              className={`px-3 py-1.5 rounded-md font-bold transition flex items-center gap-1.5 ${
                workspaceTab === 'terminal'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-900/50'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Monitor className="w-3.5 h-3.5" />
              <span>📊 Main Terminal View</span>
            </button>
            <button
              onClick={() => setWorkspaceTab('paperDesk')}
              className={`px-3 py-1.5 rounded-md font-bold transition flex items-center gap-1.5 ${
                workspaceTab === 'paperDesk'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/50'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-300" />
              <span>📝 Paper Simulation Desk</span>
            </button>
          </div>

          <button
            onClick={() => setShowPositionGuide(true)}
            className="flex items-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold px-3.5 py-1.5 rounded-lg shadow-lg shadow-blue-900/50 transition border border-blue-400"
          >
            <Calculator className="w-4 h-4 text-amber-300" />
            <span>📐 MT4/MT5 Orders & Risk Guide</span>
          </button>
          <div title={goldFeedMessage} className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 px-3 py-1.5 rounded-lg text-emerald-400">
            <Activity className="w-4 h-4" />
            <span>Active Pair: <strong>{symbol}</strong> (All Pairs Enabled)</span>
          </div>
          <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 px-3 py-1.5 rounded-lg text-slate-300">
            <Cpu className={`w-4 h-4 ${engineStatus === 'online' ? 'text-emerald-400' : 'text-rose-400'}`} />
            <span>FastAPI Engine: <strong className={engineStatus === 'online' ? 'text-emerald-400' : 'text-rose-400'}>{engineStatus.toUpperCase()}</strong></span>
          </div>
          <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 px-3 py-1.5 rounded-lg text-slate-300">
            <Radio className={`w-4 h-4 ${telegramStatus === 'configured' ? 'text-emerald-400' : 'text-amber-400'}`} />
            <span>Telegram: <strong className={telegramStatus === 'configured' ? 'text-emerald-400' : 'text-amber-300'}>{telegramStatus === 'configured' ? 'CONFIGURED' : telegramStatus === 'simulation' ? 'SIMULATION' : 'UNKNOWN'}</strong></span>
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
            <span>Market Selector & Chart Engine Mode (All 355 Exness MT5 Pairs Supported):</span>
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
              title="External TradingView reference feed"
            >
              <Monitor className="w-3.5 h-3.5 text-blue-300" />
              <span>🌐 TradingView Chart Only</span>
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
              <span>⚡ 8-Tab Strategy Engine + Signal Lines (All Pairs)</span>
            </button>
          </div>

          {/* Category Tabs */}
          <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
            {(['All', 'Forex', 'Gold', 'Indices', 'Crypto'] as const).map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-3 py-1 rounded-md font-semibold transition ${
                  activeCategory === cat
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                {cat === 'Forex'
                  ? '💵 Forex'
                  : cat === 'Gold'
                  ? '🥇 Metals & Oil'
                  : cat === 'Indices'
                  ? '📊 Indices'
                  : cat === 'Crypto'
                  ? '⚡ Crypto'
                  : '🌐 All Pairs'}
              </button>
            ))}
          </div>

          {/* Custom Symbol Search Input */}
          <form onSubmit={handleCustomSymbolSubmit} className="flex items-center gap-1.5">
            <div className="relative">
              <input
                type="text"
                placeholder="Any MT5 Pair (e.g. GBP/JPY)"
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

        {/* ── HIGH-VISIBILITY TOP 2-BUTTON MT5 BRIDGE & ORDER EXECUTION BAR ── */}
        <div className="mt-3 pt-3 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-indigo-950/80 via-slate-950 to-emerald-950/60 p-3 rounded-xl border border-indigo-500/60">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
              <span className="text-xs font-black text-white uppercase tracking-wider font-mono">
                MT5 Live Bridge ({symbol}):
              </span>
            </div>

            {/* Lot Size Selector */}
            <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-700 px-2.5 py-1 rounded-lg text-xs font-mono">
              <span className="text-slate-400">Lot:</span>
              <select
                value={topLotSize}
                onChange={(e) => setTopLotSize(Number(e.target.value))}
                className="bg-transparent text-white font-bold focus:outline-none"
              >
                <option value={0.01} className="bg-slate-900">0.01</option>
                <option value={0.02} className="bg-slate-900">0.02</option>
                <option value={0.05} className="bg-slate-900">0.05</option>
                <option value={0.10} className="bg-slate-900">0.10</option>
                <option value={0.20} className="bg-slate-900">0.20</option>
                <option value={0.50} className="bg-slate-900">0.50</option>
                <option value={1.00} className="bg-slate-900">1.00</option>
              </select>
            </div>

            {/* Direction Selector */}
            <div className="flex items-center gap-1 bg-slate-900 border border-slate-700 p-0.5 rounded-lg text-xs font-mono">
              <button
                type="button"
                onClick={() => setTopDirection('BUY')}
                className={`px-2.5 py-1 rounded font-extrabold transition ${
                  topDirection === 'BUY'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                BUY
              </button>
              <button
                type="button"
                onClick={() => setTopDirection('SELL')}
                className={`px-2.5 py-1 rounded font-extrabold transition ${
                  topDirection === 'SELL'
                    ? 'bg-rose-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                SELL
              </button>
            </div>

            <span className="text-[11px] text-indigo-200 font-mono truncate max-w-md">
              {topMt5Status}
            </span>
          </div>

          {/* THE 2 CORE BUTTONS: 1. EXECUTE & 2. PLACE ORDER / TRADE NOW */}
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={topMt5Syncing}
              onClick={handleTopExecuteSync}
              className="px-4 py-2 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 disabled:opacity-60 text-white text-xs font-black rounded-lg shadow-lg border border-indigo-300/70 transition flex items-center gap-1.5 font-mono"
            >
              <Zap className={`w-4 h-4 text-amber-300 ${topMt5Syncing ? 'animate-spin' : ''}`} />
              <span>
                {topMt5Syncing
                  ? '1. Starting Cloudflare & Pushing to Git/Vercel...'
                  : '1. EXECUTE (Start Tunnel & Push URL to Git/Vercel)'}
              </span>
            </button>

            <button
              type="button"
              disabled={topMt5Ordering}
              onClick={() => handleTopPlaceOrder(topDirection)}
              className={`px-4 py-2 text-white text-xs font-black rounded-lg shadow-xl border transition flex items-center gap-1.5 font-mono ${
                topDirection === 'SELL'
                  ? 'bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 border-rose-300/80'
                  : 'bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 border-emerald-300/80'
              } disabled:opacity-60`}
            >
              <Play className="w-4 h-4 fill-white" />
              <span>
                {topMt5Ordering
                  ? `Executing ${topDirection} ${symbol}...`
                  : `2. PLACE ORDER / TRADE NOW (${topDirection} ${symbol} · ${topLotSize} Lot)`}
              </span>
            </button>
          </div>
        </div>

        {topMt5Receipt && (
          <div
            className={`px-3 py-2 rounded-lg border text-xs font-mono flex flex-wrap items-center justify-between gap-2 ${
              topMt5Receipt.status === 'executed'
                ? 'bg-emerald-950/90 border-emerald-500 text-emerald-200'
                : 'bg-rose-950/90 border-rose-500 text-rose-200'
            }`}
          >
            <span>
              {topMt5Receipt.status === 'executed'
                ? `✅ MT5 LIVE ORDER EXECUTED: ${topMt5Receipt.direction} ${topMt5Receipt.volume_normalized} Lot ${topMt5Receipt.symbol_resolved} @ $${topMt5Receipt.executed_price} (Deal #${topMt5Receipt.deal_ticket})`
                : `⚠️ MT5 Bridge Response: ${topMt5Receipt.retcode_name || topMt5Receipt.broker_comment || topMt5Receipt.error || JSON.stringify(topMt5Receipt)}`}
            </span>
            <button
              type="button"
              onClick={() => setTopMt5Receipt(null)}
              className="text-[10px] underline opacity-80 hover:opacity-100"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* Main Grid: LEFT SIDEBAR NAVIGATION PANEL (3 cols) + MAIN CONTENT AREA (9 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN: Vertical Navigation Signal Sidebar (3 cols) */}
        <div className="lg:col-span-3 h-full">
          <LiveSignalNotificationPanel
            symbol={symbol}
            timeframe={timeframe}
            currentPrice={currentPrice}
            onTimeframeChange={(tf) => setTimeframe(tf)}
            onExecuteTradeParams={handleAutoFillTrade}
          />
        </div>

        {/* RIGHT CONTENT COLUMN: Charts, Signals, Trading Panel & Orderbook (9 cols) */}
        <div className="lg:col-span-9 space-y-6">
          {workspaceTab === 'terminal' ? (
            /* TAB 1: MAIN TERMINAL VIEW (Full-Width Ultra Chart & Live Market Feed) */
            <>
              {/* Full-Width Chart & Signals Stream Area — Expands to full right edge */}
              <div className="w-full flex flex-col gap-6">
                {chartMode === 'TradingViewDirect' && !isRextAsset ? (
                  <TradingViewDirectChart
                    symbol={symbol}
                    timeframe={timeframe}
                    currentPrice={isGoldAsset ? undefined : currentPrice}
                    onTimeframeChange={(tf) => setTimeframe(tf)}
                  />
                ) : (
                  <TradingChart
                    key={`tc_${symbol}`}
                    symbol={symbol}
                    timeframe={timeframe}
                    activeTab={activeChartTab}
                    onActiveTabChange={handleChartTabChange}
                    onTimeframeChange={(tf) => setTimeframe(tf)}
                    onLatestDataUpdate={handleDataUpdate}
                    onAutoFillTrade={handleAutoFillTrade}
                  />
                )}

                {/* Signals Stream & Telegram Broadcaster Component */}
                <div className="w-full">
                  <SignalsStream
                    symbol={symbol}
                    timeframe={timeframe}
                    onPriceUpdate={(p) => {
                      if (p > 0) setCurrentPrice(p);
                    }}
                  />
                </div>
              </div>

              {/* Trend & Candle Pattern Panel */}
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
            </>
          ) : (
            /* TAB 2: SEPARATE DEDICATED PAPER SIMULATION & ORDERBOOK DESK */
            <div className="space-y-6">
              <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex items-center justify-between font-mono text-xs shadow-xl">
                <div className="flex items-center gap-2 text-white font-bold">
                  <Sparkles className="w-4 h-4 text-emerald-400" />
                  <span>Paper Trading Simulation Execution Desk & Order Book Depth</span>
                </div>
                <button
                  onClick={() => setWorkspaceTab('terminal')}
                  className="bg-blue-600/30 hover:bg-blue-600 text-blue-300 hover:text-white px-3 py-1.5 rounded-lg transition border border-blue-500/40 font-sans"
                >
                  ← Back to Full-Width Chart & Terminal
                </button>
              </div>

              {/* Side-by-Side Grid: Paper Trading Panel (7 cols) + Order Book & OBI Gauge (5 cols) — Equal height alignment */}
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-stretch">
                <div className="xl:col-span-7 h-full">
                  <PaperTradingPanel
                    symbol={symbol}
                    currentPrice={currentPrice}
                    onTradeClosed={handleTradeClosed}
                    externalParams={externalTradeParams}
                  />
                </div>
                <div className="xl:col-span-5 h-full">
                  <OrderBookOBIGauge symbol={symbol} />
                </div>
              </div>

              <div className="w-full">
                <AuditReportSection refreshTrigger={refreshAuditCount} />
              </div>
            </div>
          )}
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
