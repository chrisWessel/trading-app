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
import AITradingCopilotModal from '@/components/AITradingCopilotModal';
import AutonomousBotLiveWindow from '@/components/AutonomousBotLiveWindow';
import { Activity, ShieldCheck, Cpu, Radio, Coins, Search, Globe, Eye, Monitor, Calculator, Sparkles, Zap, Play, ArrowUpRight, ArrowDownRight, Square, XCircle, Bot, Bell, Server } from 'lucide-react';

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
  const [showAICopilot, setShowAICopilot] = useState<boolean>(false);
  const [showBotWindow, setShowBotWindow] = useState<boolean>(false);
  const [aiClearanceState, setAiClearanceState] = useState<{
    verdict?: 'CLEAR_TO_TRADE' | 'CAUTION' | 'DO_NOT_TRADE';
    clearanceScore?: number;
    direction?: 'BUY' | 'SELL' | 'NEUTRAL';
  }>({ verdict: 'CLEAR_TO_TRADE', clearanceScore: 92, direction: 'BUY' });
  const [externalTradeParams, setExternalTradeParams] = useState<any>(null);
  const [engineStatus, setEngineStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [telegramStatus, setTelegramStatus] = useState<'unknown' | 'configured' | 'simulation'>('unknown');
  const [goldFeedLabel, setGoldFeedLabel] = useState<string>('CHECKING');
  const [goldFeedMessage, setGoldFeedMessage] = useState<string>('');

  // Top-level MT5 4-Button Execution & Cancel/Stop Bar State
  const [topLotSize, setTopLotSize] = useState<number>(0.01);
  const [topDirection, setTopDirection] = useState<'BUY' | 'SELL'>('BUY');
  const [topStopLoss, setTopStopLoss] = useState<number | undefined>(undefined);
  const [topTakeProfit, setTopTakeProfit] = useState<number | undefined>(undefined);
  const [topMt5Syncing, setTopMt5Syncing] = useState<boolean>(false);
  const [topMt5Ordering, setTopMt5Ordering] = useState<boolean>(false);
  const [topMt5Cancelling, setTopMt5Cancelling] = useState<boolean>(false);
  const [topMt5Stopping, setTopMt5Stopping] = useState<boolean>(false);
  const [topMt5StartingServer, setTopMt5StartingServer] = useState<boolean>(false);
  const [topBridgeOnline, setTopBridgeOnline] = useState<boolean>(false);
  const [topMt5Status, setTopMt5Status] = useState<string>('MT5 Bridge Ready (Auto-Stop SL/TP Active)');
  const [topMt5Receipt, setTopMt5Receipt] = useState<any | null>(null);

  // Poll bridge health on mount (supports both local and Vercel cloud with fallback)
  useEffect(() => {
    let mounted = true;
    const checkBridge = async () => {
      try {
        let res: Response | null = null;
        try {
          res = await fetch('http://127.0.0.1:8001/health', {
            headers: { Authorization: `Bearer ${MT5_LOCAL_TOKEN}` },
            cache: 'no-store',
          });
        } catch {}

        // Fallback to /api/mt5 (essential for Vercel where browser blocks unencrypted http://127.0.0.1)
        if (!res || !res.ok) {
          try {
            res = await fetch('/api/mt5', { cache: 'no-store' });
          } catch {}
        }

        if (res && res.ok) {
          const d = await res.json();
          if (mounted && (d?.bridge === 'online' || d?.status === 'online' || d?.mt5_ipc_connected)) {
            setTopBridgeOnline(true);
            const term = d?.mt5_terminal;
            if (term?.account_login) {
              setTopMt5Status(
                `✅ Port 8001 Online · ${term?.terminal_name || 'MT5'} (#${term.account_login}) · Bal: $${term?.account_balance !== undefined ? Number(term.account_balance).toFixed(2) : '0.00'}`
              );
            } else {
              setTopMt5Status('✅ Port 8001 Online (Bridge Ready)');
            }
          } else if (mounted) {
            setTopBridgeOnline(false);
          }
        }
      } catch {}
    };
    checkBridge();
    const interval = setInterval(checkBridge, 3500);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const handleTopStartBridge = async () => {
    setTopMt5StartingServer(true);
    setTopMt5Status('🚀 Verifying / Starting MT5 Bridge on port 8001...');
    try {
      // 1. Check if already reachable directly or via tunnel
      let checkRes: any = null;
      try {
        const c1 = await fetch('http://127.0.0.1:8001/health', {
          headers: { Authorization: `Bearer ${MT5_LOCAL_TOKEN}` },
          cache: 'no-store',
        });
        if (c1.ok) checkRes = await c1.json();
      } catch {}

      if (!checkRes) {
        try {
          const c2 = await fetch('/api/mt5', { cache: 'no-store' });
          if (c2.ok) checkRes = await c2.json();
        } catch {}
      }

      if (checkRes && (checkRes?.bridge === 'online' || checkRes?.status === 'online' || checkRes?.mt5_ipc_connected)) {
        setTopBridgeOnline(true);
        const term = checkRes?.mt5_terminal;
        setTopMt5Status(
          `✅ Port 8001 is ALREADY ONLINE! ${term?.terminal_name || 'MT5'} (#${term?.account_login || 'Active'}) · Bal: $${term?.account_balance !== undefined ? Number(term.account_balance).toFixed(2) : '0.00'}`
        );
        return;
      }

      // 2. Request auto-spawn if running on local environment
      const res = await fetch('/api/mt5', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'start_server' }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.bridge === 'online' || data?.status === 'online' || data?.mt5_ipc_connected) {
        setTopBridgeOnline(true);
        const term = data?.mt5_terminal;
        setTopMt5Status(
          `✅ Port 8001 LIVE! ${term?.terminal_name || 'MT5'} (${term?.account_server || 'Connected'}) · Bal: $${term?.account_balance !== undefined ? Number(term.account_balance).toFixed(2) : '0.00'}`
        );
      } else {
        setTopMt5Status(
          data?.message || '⚠️ Double-click run_app.bat on your PC to start Port 8001.'
        );
      }
    } catch (err: any) {
      setTopMt5Status(`⚠️ Start error: ${err?.message || 'Check terminal'}`);
    } finally {
      setTopMt5StartingServer(false);
    }
  };

  // Sync Top Command Bar direction & Risk-Calculated SL/TP with the live Signal Navigator
  useEffect(() => {
    const onLiveParams = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      if (!detail) return;
      if (detail.direction === 'BUY' || detail.direction === 'SELL') {
        setTopDirection(detail.direction);
      }
      if (typeof detail.stopLoss === 'number' && detail.stopLoss > 0) {
        setTopStopLoss(detail.stopLoss);
      }
      if (typeof detail.takeProfit === 'number' && detail.takeProfit > 0) {
        setTopTakeProfit(detail.takeProfit);
      }
      if (typeof detail.lotSize === 'number' && detail.lotSize > 0) {
        setTopLotSize(detail.lotSize);
      }
    };
    const onAiCopilotState = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      if (!detail) return;
      setAiClearanceState((prev) => ({
        verdict: detail.verdict || prev.verdict,
        clearanceScore: detail.clearanceScore ?? prev.clearanceScore,
        direction: detail.direction || prev.direction,
      }));
    };
    const onOpenAiCopilot = () => setShowAICopilot(true);
    const onChangeSymbol = (e: any) => {
      if (e?.detail && typeof e.detail === 'string') {
        handleAssetSelect(e.detail);
      }
    };
    window.addEventListener('wessignal-live-params', onLiveParams);
    window.addEventListener('wessignal-ai-copilot-state', onAiCopilotState);
    window.addEventListener('wessignal-open-ai-copilot', onOpenAiCopilot);
    window.addEventListener('wessignal-change-symbol', onChangeSymbol);
    return () => {
      window.removeEventListener('wessignal-live-params', onLiveParams);
      window.removeEventListener('wessignal-ai-copilot-state', onAiCopilotState);
      window.removeEventListener('wessignal-open-ai-copilot', onOpenAiCopilot);
      window.removeEventListener('wessignal-change-symbol', onChangeSymbol);
    };
  }, []);

  const handleTopExecuteSync = async () => {
    setTopMt5Syncing(true);
    setTopMt5Status('1. Starting Bridge / Cloudflare Tunnel & Pushing URL to GitHub/Vercel...');
    try {
      // 0. If local port 8001 is not online yet, boot it first
      if (!topBridgeOnline) {
        try {
          await fetch('/api/mt5', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'start_server' }),
          });
        } catch {}
      }

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
      stop_loss: topStopLoss && topStopLoss > 0 ? topStopLoss : undefined,
      take_profit: topTakeProfit && topTakeProfit > 0 ? topTakeProfit : undefined,
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
      setShowBotWindow(true);
    } catch (e: any) {
      setTopMt5Receipt({
        status: 'error',
        retcode_name: e?.message || 'Could not reach MT5 bridge.',
      });
    } finally {
      setTopMt5Ordering(false);
    }
  };

  const handleTopCancelClose = async () => {
    setTopMt5Cancelling(true);
    setTopMt5Receipt(null);
    try {
      let json: any = null;
      try {
        const localRes = await fetch('http://127.0.0.1:8001/bridge/cancel-close', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${MT5_LOCAL_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ symbol, close_all: false }),
        });
        if (localRes.ok) json = await localRes.json();
      } catch {}

      if (!json) {
        const apiRes = await fetch('/api/mt5', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'cancel_close', symbol, close_all: false }),
        });
        json = await apiRes.json();
      }
      setTopMt5Receipt({
        status: json?.closed_positions_count > 0 || json?.cancelled_orders_count > 0 ? 'executed' : 'notice',
        retcode_name: json?.message || `Cancel/Close executed for ${symbol}.`,
      });
    } catch (e: any) {
      setTopMt5Receipt({
        status: 'error',
        retcode_name: e?.message || 'Failed to cancel/close trades on MT5.',
      });
    } finally {
      setTopMt5Cancelling(false);
    }
  };

  const handleTopStopBot = async () => {
    setTopMt5Stopping(true);
    setTopMt5Receipt(null);
    try {
      let json: any = null;
      try {
        const localRes = await fetch('http://127.0.0.1:8001/bridge/stop-bot', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${MT5_LOCAL_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ close_all_trades: true }),
        });
        if (localRes.ok) json = await localRes.json();
      } catch {}

      if (!json) {
        const apiRes = await fetch('/api/mt5', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'stop_bot', close_all_trades: true }),
        });
        json = await apiRes.json();
      }
      setTopMt5Status('🛑 Auto-Bot Disarmed & All Open MT5 Trades Closed.');
      setTopMt5Receipt({
        status: 'stopped',
        retcode_name: json?.message || '🛑 Auto-Bot stopped & open MT5 trades closed.',
      });
    } catch (e: any) {
      setTopMt5Receipt({
        status: 'error',
        retcode_name: e?.message || 'Auto-Bot stopped locally.',
      });
    } finally {
      setTopMt5Stopping(false);
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

  // ── LIVE PRICE POLLER: keep currentPrice in sync with Exness MT5 / OANDA Spot / Swissquote Spot ──────
  useEffect(() => {
    const fetchLivePrice = async () => {
      // 1. Try local Exness MT5 Bridge first (exact broker Bid/Ask tick on user's PC)
      try {
        const mt5Res = await fetch(
          `http://127.0.0.1:8001/bars?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&limit=2`,
          { cache: 'no-store' }
        );
        if (mt5Res.ok) {
          const mt5Data = await mt5Res.json();
          if (mt5Data?.status === 'success' && Number(mt5Data.latest_price) > 0) {
            setCurrentPrice(Number(mt5Data.latest_price));
            return;
          }
        }
      } catch (_) {}

      // 2. Try Next.js /api/spot-bars (Cloudflare Tunnel MT5 -> Swissquote Institutional Spot XAU/USD -> Yahoo Spot)
      try {
        const spotRes = await fetch(
          `/api/spot-bars?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&limit=2`,
          { cache: 'no-store' }
        );
        if (spotRes.ok) {
          const spotData = await spotRes.json();
          if (spotData?.status === 'success' && Number(spotData.latest_price) > 0) {
            setCurrentPrice(Number(spotData.latest_price));
            return;
          }
        }
      } catch (_) {}

      // 3. Try primary FastAPI backend API
      try {
        const res = await fetch(
          `${API_BASE_URL}/api/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&limit=2`,
          { cache: 'no-store' }
        );
        if (res.ok) {
          const data = await res.json();
          if (data.data_source !== 'SIMULATED' && data.latest_price && data.latest_price > 0) {
            setCurrentPrice(data.latest_price);
            return;
          }
        }
      } catch (_) {}
    };

    fetchLivePrice();
    priceIntervalRef.current = setInterval(fetchLivePrice, 5000);
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
            onClick={() => setShowAICopilot(true)}
            className={`flex items-center gap-2 font-black px-3.5 py-1.5 rounded-lg shadow-lg transition border ${
              aiClearanceState.verdict === 'CLEAR_TO_TRADE'
                ? 'bg-gradient-to-r from-emerald-600 via-teal-600 to-indigo-600 hover:from-emerald-500 hover:to-indigo-500 text-white border-emerald-300 shadow-emerald-900/50'
                : aiClearanceState.verdict === 'DO_NOT_TRADE'
                ? 'bg-gradient-to-r from-rose-700 to-red-700 hover:from-rose-600 hover:to-red-600 text-white border-rose-300 shadow-rose-900/50'
                : 'bg-gradient-to-r from-amber-600 to-indigo-600 hover:from-amber-500 hover:to-indigo-500 text-white border-amber-300'
            }`}
          >
            <Bot className="w-4 h-4 text-amber-300 animate-pulse" />
            <span>
              🤖 AI Trade Copilot:{' '}
              {aiClearanceState.verdict === 'CLEAR_TO_TRADE'
                ? `CLEAR TO ${aiClearanceState.direction || 'TRADE'} (${aiClearanceState.clearanceScore || 92}%)`
                : aiClearanceState.verdict === 'DO_NOT_TRADE'
                ? 'HOLD / NEWS RISK'
                : 'CAUTION'}
            </span>
          </button>

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

          {/* THE 5 CORE BUTTONS: 0. START SERVER | 1. EXECUTE | 2. PLACE ORDER | 3. CANCEL/CLOSE | 4. STOP BOT */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={topMt5StartingServer}
              onClick={handleTopStartBridge}
              className={`px-3.5 py-2 text-white text-xs font-black rounded-lg shadow-lg border transition flex items-center gap-1.5 font-mono ${
                topBridgeOnline
                  ? 'bg-emerald-950/80 hover:bg-emerald-900 border-emerald-500/80 text-emerald-200'
                  : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 border-emerald-300 shadow-emerald-900/40 animate-pulse'
              } disabled:opacity-60`}
              title="Starts or verifies the local MT5 execution bridge server on port 8001"
            >
              <Server className={`w-4 h-4 ${topMt5StartingServer ? 'animate-spin' : ''}`} />
              <span>
                {topMt5StartingServer
                  ? 'Starting Port 8001...'
                  : topBridgeOnline
                  ? 'PORT 8001: ONLINE'
                  : '0. START SERVER (Port 8001)'}
              </span>
            </button>

            <button
              type="button"
              disabled={topMt5Syncing}
              onClick={handleTopExecuteSync}
              className="px-3.5 py-2 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 disabled:opacity-60 text-white text-xs font-black rounded-lg shadow-lg border border-indigo-300/70 transition flex items-center gap-1.5 font-mono"
            >
              <Zap className={`w-4 h-4 text-amber-300 ${topMt5Syncing ? 'animate-spin' : ''}`} />
              <span>
                {topMt5Syncing
                  ? '1. Syncing Tunnel...'
                  : '1. EXECUTE (Start Tunnel & Sync Git/Vercel)'}
              </span>
            </button>

            <button
              type="button"
              disabled={topMt5Ordering}
              onClick={() => handleTopPlaceOrder(topDirection)}
              className={`px-3.5 py-2 text-white text-xs font-black rounded-lg shadow-xl border transition flex items-center gap-1.5 font-mono ${
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

            <button
              type="button"
              disabled={topMt5Cancelling}
              onClick={handleTopCancelClose}
              className="px-3.5 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-60 text-slate-950 text-xs font-black rounded-lg shadow-lg border border-amber-300 transition flex items-center gap-1.5 font-mono"
              title="Closes open position(s) and cancels pending orders on MT5 for the active pair"
            >
              <XCircle className="w-4 h-4" />
              <span>
                {topMt5Cancelling
                  ? 'Closing...'
                  : `3. CANCEL / CLOSE (${symbol})`}
              </span>
            </button>

            <button
              type="button"
              disabled={topMt5Stopping}
              onClick={handleTopStopBot}
              className="px-3.5 py-2 bg-rose-700 hover:bg-rose-600 disabled:opacity-60 text-white text-xs font-black rounded-lg shadow-lg border border-rose-400 transition flex items-center gap-1.5 font-mono"
              title="Stops the Auto-Bot and immediately closes ALL open MT5 positions across all pairs"
            >
              <Square className="w-3.5 h-3.5 fill-white" />
              <span>
                {topMt5Stopping
                  ? 'Stopping...'
                  : '4. STOP BOT (CLOSE ALL)'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setShowAICopilot(true)}
              className="px-3.5 py-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-black rounded-lg shadow-lg border border-violet-300 transition flex items-center gap-1.5 font-mono"
              title="Open AI Trade Copilot & Live Volatility/News Clearance Chat"
            >
              <Bot className="w-4 h-4 text-amber-300" />
              <span>5. AI CLEARANCE CHAT</span>
            </button>

            <button
              type="button"
              onClick={() => setShowBotWindow(true)}
              className="px-3.5 py-2 bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white text-xs font-black rounded-lg shadow-lg border border-emerald-300 transition flex items-center gap-1.5 font-mono"
              title="Open Live Autonomous Bot & AI Commander Window (Mimics & Mirrors MT5 Trading + 1-Click Human Intervention)"
            >
              <Activity className="w-4 h-4 text-amber-200 animate-pulse" />
              <span>6. LIVE BOT &amp; AI AUTOPILOT WINDOW</span>
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

      <AITradingCopilotModal
        symbol={symbol}
        timeframe={timeframe}
        currentPrice={currentPrice}
        isOpen={showAICopilot}
        onClose={() => setShowAICopilot(false)}
        onOpen={() => setShowAICopilot(true)}
        onQuickPlaceOrder={(dir) => handleTopPlaceOrder(dir)}
      />

      <AutonomousBotLiveWindow
        symbol={symbol}
        timeframe={timeframe}
        currentPrice={currentPrice}
        isOpen={showBotWindow}
        onClose={() => setShowBotWindow(false)}
        onOpen={() => setShowBotWindow(true)}
        onSelectSymbol={handleAssetSelect}
      />
    </div>
  );
}
