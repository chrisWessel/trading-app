'use client';

import React, { useEffect, useState, useRef } from 'react';
import { Bell, Zap, ArrowUpRight, ArrowDownRight, Volume2, VolumeX, Shield, Target, Play, Clock, Navigation, Square, XCircle, Bot, Server, Trophy, AlertTriangle } from 'lucide-react';
import { API_BASE_URL } from '@/lib/apiConfig';
import { fetchWithFastTimeout, fetchBrowserLiveBars, computeBrowserSignalAnalysis, calculateRiskBasedLevels } from '@/lib/browserFallbackEngine';

export interface RunawayTrendInfo {
  detected: boolean;
  override_triggered: boolean;
  direction: 'BEARISH' | 'BULLISH' | 'NONE';
  points_moved: number;
  threshold_pts: number;
  live_bar_pts: number;
  net_2bar_pts?: number;
  net_3bar_pts: number;
  adverse_excursion_pts: number;
  intensity_ratio: number;
  banner: string;
}

interface TradeParams {
  entry: number;
  entry_zones: number[];
  stop_loss: number;
  tp1: number;
  tp2: number;
  tp_levels: number[];
  rationale: string;
  probability?: number;
  hold_remaining_sec?: number;
  hold_total_sec?: number;
  runaway_trend?: RunawayTrendInfo;
}

interface SignalAnalysis {
  symbol: string;
  timeframe: string;
  data_source?: string;
  latest_price: number;
  support: number;
  resistance: number;
  trend?: string;
  probability?: number;
  hold_remaining_sec?: number;
  hold_total_sec?: number;
  runaway_trend?: RunawayTrendInfo;
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
  type: 'BUY_NOW' | 'SELL_NOW' | 'STOP_LOSS_ALERT' | 'MONITORING' | 'CLOSED';
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
  currentPrice?: number;
  onTimeframeChange?: (tf: string) => void;
  onExecuteTradeParams?: (params: { signal_type: string; entry: number; stop_loss: number; tp1: number; tp2: number; tp_levels: number[]; entry_zones: number[] }) => void;
}

const ALL_TIMEFRAMES = ['1s', '1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d'];

export const TIMEFRAME_HOLD_SECONDS: Record<string, number> = {
  '1s': 15,
  '5s': 30,
  '15s': 45,
  '30s': 60,
  '1m': 60,
  '2m': 120,
  '3m': 180,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '45m': 2700,
  '1h': 3600,
  '2h': 7200,
  '4h': 14400,
  '1d': 86400,
};

export interface LockedSignalState {
  key: string;
  symbol: string;
  timeframe: string;
  signal_type: string;
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  entry: number;
  entry_zones: number[];
  stop_loss: number;
  tp1: number;
  tp2: number;
  tp_levels: number[];
  probability: number;
  rationale: string;
  lockedAtMs: number;
  holdTotalSec: number;
}

export function formatHoldTimer(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (h > 0) return `${h}h ${m}m ${rem}s`;
  if (m > 0) return `${m}m ${rem < 10 ? '0' : ''}${rem}s`;
  return `${rem}s`;
}

export default function LiveSignalNotificationPanel({
  symbol,
  timeframe,
  currentPrice,
  onTimeframeChange,
  onExecuteTradeParams,
}: LiveSignalNotificationPanelProps) {
  const [analysis, setAnalysis] = useState<SignalAnalysis | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [showTpGuidance, setShowTpGuidance] = useState<boolean>(false);
  const [selectedTpIndex, setSelectedTpIndex] = useState<number>(0); // which TP level is highlighted
  
  // Risk management parameters: customizable Lot Size, Risk %, and Account Balance
  const [accountBalance, setAccountBalance] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const s = localStorage.getItem('wessignal_last_mt5_balance');
      if (s) {
        const n = parseFloat(s);
        if (!isNaN(n) && n > 0) return n;
      }
    }
    return 16.72;
  });
  // balanceInput is a raw string so the user can freely clear & type any amount
  const [balanceInput, setBalanceInput] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const s = localStorage.getItem('wessignal_last_mt5_balance');
      if (s) return s;
    }
    return '16.72';
  });
  const userEditedBalanceRef = useRef<boolean>(false);
  const [lotSize, setLotSize] = useState<number>(0.01);
  const [riskPercent, setRiskPercent] = useState<number>(2.0); // default 2%
  const [showRiskConfig, setShowRiskConfig] = useState<boolean>(true);

  // Frozen params — locked once per signal direction change.
  // This prevents SL/TP from jittering on every poll.
  const frozenRef = useRef<FrozenParams | null>(null);
  const [frozenParams, setFrozenParams] = useState<FrozenParams | null>(null);

  // Strict client-side timeframe hold lock so signals NEVER flip every 10-50 seconds
  const signalLockRef = useRef<LockedSignalState | null>(null);
  const [holdRemainingSec, setHoldRemainingSec] = useState<number>(TIMEFRAME_HOLD_SECONDS[timeframe] || 300);

  // ── MT5 Bridge & Cloudflare Tunnel 4-Button Execution Console State ──
  const [mt5Syncing, setMt5Syncing] = useState<boolean>(false);
  const [mt5Ordering, setMt5Ordering] = useState<boolean>(false);
  const [mt5Cancelling, setMt5Cancelling] = useState<boolean>(false);
  const [mt5Stopping, setMt5Stopping] = useState<boolean>(false);
  const [mt5BridgeState, setMt5BridgeState] = useState<{
    online: boolean;
    botArmed?: boolean;
    openPositionsCount?: number;
    tunnelUrl: string;
    accountLogin?: number | string;
    accountServer?: string;
    accountBalance?: number;
    terminalName?: string;
    gitSynced?: boolean;
    message?: string;
  } | null>(null);
  const [mt5OrderReceipt, setMt5OrderReceipt] = useState<any | null>(null);

  // Worker Algorithm State Synchronization
  const [workerDailyTarget, setWorkerDailyTarget] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('wessignal_daily_profit_target');
      if (v) {
        const num = parseFloat(v);
        if (!isNaN(num) && num > 0) return num;
      }
    }
    return 10.0;
  });
  const [workerSessionProfit, setWorkerSessionProfit] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const savedPnl = localStorage.getItem('wessignal_session_realized_pnl');
      if (savedPnl) {
        const num = parseFloat(savedPnl);
        if (!isNaN(num)) return num;
      }
    }
    return 0;
  });
  const [workerGoalMet, setWorkerGoalMet] = useState<boolean>(false);

  useEffect(() => {
    const onWorkerUpdate = (e: Event) => {
      const d = (e as CustomEvent)?.detail;
      if (!d) return;
      if (typeof d.dailyProfitTarget === 'number') setWorkerDailyTarget(d.dailyProfitTarget);
      if (typeof d.sessionRealizedPnl === 'number') setWorkerSessionProfit(d.sessionRealizedPnl);
      if (typeof d.isGoalAchieved === 'boolean') setWorkerGoalMet(d.isGoalAchieved);
    };
    window.addEventListener('wessignal-worker-goal-update', onWorkerUpdate);
    return () => window.removeEventListener('wessignal-worker-goal-update', onWorkerUpdate);
  }, []);

  const MT5_LOCAL_TOKEN = 'wessignal_mt5_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a';

  const checkMt5BridgeHealth = async () => {
    try {
      let json: any = null;
      try {
        const localRes = await fetchWithFastTimeout(
          'http://127.0.0.1:8001/health',
          1500,
          { headers: { Authorization: `Bearer ${MT5_LOCAL_TOKEN}` } }
        );
        if (localRes.ok) json = await localRes.json();
      } catch {}

      if (!json) {
        const apiRes = await fetchWithFastTimeout('/api/mt5', 4000);
        if (apiRes.ok) json = await apiRes.json();
      }

      if (json && json.bridge === 'online') {
        const term = json.mt5_terminal || {};
        if (
          term.account_balance !== undefined &&
          Number(term.account_balance) > 0
        ) {
          const liveBal = Number(Number(term.account_balance).toFixed(2));
          setAccountBalance(liveBal);
          setBalanceInput(String(liveBal));
          if (typeof window !== 'undefined') {
            localStorage.setItem('wessignal_last_mt5_balance', String(liveBal));
          }
        }
        setMt5BridgeState((prev) => ({
          online: Boolean(json.mt5_ipc_connected),
          botArmed: json.bot_armed !== false,
          openPositionsCount: Number(json.open_positions_count || 0),
          tunnelUrl: json.tunnel_url || json.resolved_bridge_url || prev?.tunnelUrl || '',
          accountLogin: term.account_login,
          accountServer: term.account_server,
          accountBalance: term.account_balance,
          terminalName: term.terminal_name,
          gitSynced: prev?.gitSynced,
          message: term.connected
            ? `Connected: ${term.terminal_name || 'MT5'} (#${term.account_login} · ${term.account_server})`
            : term.hint || 'MT5 Bridge online',
        }));
      }
    } catch {}
  };

  useEffect(() => {
    checkMt5BridgeHealth();
    const interval = setInterval(checkMt5BridgeHealth, 3000);
    return () => clearInterval(interval);
  }, []);

  const [startingBridgeServer, setStartingBridgeServer] = useState<boolean>(false);

  // BUTTON 0: Start Bridge Server (Port 8001)
  const handleStartBridgeServer = async () => {
    setStartingBridgeServer(true);
    try {
      const res = await fetchWithFastTimeout('/api/mt5', 12000, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'start_bridge_bat' }),
      });
      const data = await res?.json().catch(() => ({}));
      if (data?.bridge === 'online' || data?.status === 'online') {
        const term = data?.mt5_terminal || {};
        setMt5BridgeState((prev) => ({
          online: true,
          botArmed: true,
          tunnelUrl: data?.tunnel_url || prev?.tunnelUrl || '',
          accountLogin: term.account_login,
          accountServer: term.account_server,
          accountBalance: term.account_balance,
          terminalName: term.terminal_name,
          gitSynced: prev?.gitSynced,
          message: `✅ Port 8001 LIVE! ${term.terminal_name || 'MT5'} (#${term.account_login || ''}) · Bal: $${term.account_balance || '0.00'}`,
        }));
      } else if (data?.isCloud) {
        setMt5BridgeState((prev) => ({
          online: false,
          tunnelUrl: prev?.tunnelUrl || '',
          message: '⚠️ On Vercel: Double-click START_PORT_8001.bat or mt5_bridge\\start_bridge.bat on your PC. Once running, port 8001 connects automatically!',
        }));
      } else {
        setMt5BridgeState((prev) => ({
          online: false,
          tunnelUrl: prev?.tunnelUrl || '',
          message: data?.message || data?.error || '⚠️ Run mt5_bridge/start_bridge.bat on your PC to start Port 8001.',
        }));
      }
    } catch (e: any) {
      setMt5BridgeState((prev) => ({
        online: false,
        tunnelUrl: prev?.tunnelUrl || '',
        message: `⚠️ Start error: ${e?.message}`,
      }));
    } finally {
      setStartingBridgeServer(false);
      checkMt5BridgeHealth();
    }
  };

  // Helper to resolve active tunnel URL in browser
  const getBrowserTunnelUrl = async (): Promise<string> => {
    if (mt5BridgeState?.tunnelUrl && mt5BridgeState.tunnelUrl.startsWith('https://')) {
      return mt5BridgeState.tunnelUrl.replace(/\/+$/, '');
    }
    try {
      const res = await fetchWithFastTimeout(`/mt5_tunnel.json?t=${Date.now()}`, 2000);
      if (res.ok) {
        const data = await res.json();
        if (data?.tunnel_url && String(data.tunnel_url).startsWith('https://')) {
          return String(data.tunnel_url).replace(/\/+$/, '');
        }
      }
    } catch {}
    return '';
  };

  // BUTTON 1: Execute Bridge (Start Cloudflare Tunnel + Push New URL to GitHub & Vercel)
  const handleExecuteBridgeSync = async () => {
    setMt5Syncing(true);
    try {
      let json: any = null;
      // 1. Direct local PC bridge (http://127.0.0.1:8001)
      try {
        const localRes = await fetchWithFastTimeout(
          'http://127.0.0.1:8001/bridge/execute-sync',
          25000,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${MT5_LOCAL_TOKEN}`,
              'Content-Type': 'application/json',
            },
          }
        );
        if (localRes.ok) json = await localRes.json();
      } catch {}

      // 2. Direct active Cloudflare Tunnel URL if available
      if (!json) {
        const tun = await getBrowserTunnelUrl();
        if (tun) {
          try {
            const tunRes = await fetchWithFastTimeout(
              `${tun}/bridge/execute-sync`,
              25000,
              {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${MT5_LOCAL_TOKEN}`,
                  'Content-Type': 'application/json',
                },
              }
            );
            if (tunRes.ok) json = await tunRes.json();
          } catch {}
        }
      }

      // 3. Next.js /api/mt5 route (auto-spawns mt5_bridge/server.py on local Windows PC!)
      if (!json) {
        const apiRes = await fetchWithFastTimeout(
          '/api/mt5',
          25000,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mode: 'execute_sync',
              tunnel_url: mt5BridgeState?.tunnelUrl || undefined,
            }),
          }
        );
        json = await apiRes.json();
      }

      const term = json?.mt5_terminal || {};
      const pushed = Boolean(json?.git_sync?.pushed || json?.status === 'synced');
      setMt5BridgeState({
        online: Boolean(json?.mt5_ipc_connected),
        botArmed: true,
        tunnelUrl: json?.tunnel_url || json?.resolved_bridge_url || '',
        accountLogin: term.account_login,
        accountServer: term.account_server,
        accountBalance: term.account_balance,
        terminalName: term.terminal_name,
        gitSynced: pushed,
        message: pushed
          ? `✅ Tunnel active & pushed to GitHub/Vercel! (${json?.tunnel_url || 'Synced'})`
          : json?.message || json?.error || 'Bridge sync completed.',
      });
    } catch (err: any) {
      setMt5BridgeState((prev) => ({
        online: prev?.online || false,
        tunnelUrl: prev?.tunnelUrl || '',
        message: `⚠️ Bridge sync error: ${err?.message || 'Ensure start_bridge.bat or server.py is running on your PC.'}`,
      }));
    } finally {
      setMt5Syncing(false);
    }
  };

  // BUTTON 2: Place Order / Trade Now (Executes real TRADE_ACTION_DEAL on MT5 with automatic TP & SL)
  const handlePlaceMt5Order = async (directionOverride?: 'BUY' | 'SELL', selectedTpPrice?: number, slPrice?: number) => {
    setMt5Ordering(true);
    setMt5OrderReceipt(null);
    const dir = directionOverride || (isSellTrade ? 'SELL' : 'BUY');
    const payload = {
      mode: 'place_order',
      symbol,
      action: dir,
      volume: lotSize,
      stop_loss: slPrice && slPrice > 0 ? slPrice : undefined,
      take_profit: selectedTpPrice && selectedTpPrice > 0 ? selectedTpPrice : undefined,
      timeframe,
      dry_run: false,
      tunnel_url: mt5BridgeState?.tunnelUrl || undefined,
    };

    try {
      let json: any = null;
      // 1. Try direct local port 8001 first for sub-10ms execution when on the trading PC
      try {
        const localRes = await fetchWithFastTimeout(
          'http://127.0.0.1:8001/webhook/mt5',
          10000,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${MT5_LOCAL_TOKEN}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
          }
        );
        if (localRes.ok) json = await localRes.json();
      } catch {}

      // 2. Try active Cloudflare Tunnel URL directly from browser
      if (!json) {
        const tun = await getBrowserTunnelUrl();
        if (tun) {
          try {
            const tunRes = await fetchWithFastTimeout(
              `${tun}/webhook/mt5`,
              10000,
              {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${MT5_LOCAL_TOKEN}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
              }
            );
            if (tunRes.ok) json = await tunRes.json();
          } catch {}
        }
      }

      // 3. Otherwise route via Next.js /api/mt5 -> active Cloudflare Tunnel URL
      if (!json) {
        const apiRes = await fetchWithFastTimeout(
          '/api/mt5',
          12000,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }
        );
        json = await apiRes.json();
      }

      setMt5OrderReceipt(json);
      checkMt5BridgeHealth();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('wessignal-open-bot-window', {
            detail: { enableAutopilot: false },
          })
        );
      }
    } catch (err: any) {
      setMt5OrderReceipt({
        status: 'error',
        retcode_name: err?.message || 'Failed to reach MT5 Bridge.',
      });
    } finally {
      setMt5Ordering(false);
    }
  };

  // BUTTON 3: Cancel / Close Trade for Active Symbol on MT5
  const handleCancelOrCloseTrade = async (closeAll = false) => {
    setMt5Cancelling(true);
    setMt5OrderReceipt(null);
    try {
      let json: any = null;
      try {
        const localRes = await fetchWithFastTimeout(
          'http://127.0.0.1:8001/bridge/cancel-close',
          10000,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${MT5_LOCAL_TOKEN}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ symbol, close_all: closeAll }),
          }
        );
        if (localRes.ok) json = await localRes.json();
      } catch {}

      if (!json) {
        const apiRes = await fetchWithFastTimeout(
          '/api/mt5',
          12000,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'cancel_close', symbol, close_all: closeAll }),
          }
        );
        json = await apiRes.json();
      }

      setMt5OrderReceipt({
        status: json?.closed_positions_count > 0 || json?.cancelled_orders_count > 0 ? 'executed' : 'notice',
        direction: `CLOSED (${symbol})`,
        retcode_name: json?.message || 'Cancel/Close completed.',
      });
      checkMt5BridgeHealth();
    } catch (err: any) {
      setMt5OrderReceipt({
        status: 'error',
        retcode_name: err?.message || 'Failed to cancel/close trades on MT5.',
      });
    } finally {
      setMt5Cancelling(false);
    }
  };

  // BUTTON 4: Stop Auto-Bot & Close All Open Trades (Emergency Kill-Switch)
  const handleStopAutoBot = async () => {
    setMt5Stopping(true);
    setMt5OrderReceipt(null);
    try {
      let json: any = null;
      try {
        const localRes = await fetchWithFastTimeout(
          'http://127.0.0.1:8001/bridge/stop-bot',
          10000,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${MT5_LOCAL_TOKEN}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ close_all_trades: true }),
          }
        );
        if (localRes.ok) json = await localRes.json();
      } catch {}

      if (!json) {
        const apiRes = await fetchWithFastTimeout(
          '/api/mt5',
          12000,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'stop_bot', close_all_trades: true }),
          }
        );
        json = await apiRes.json();
      }

      setMt5BridgeState((prev) => ({
        online: prev?.online ?? false,
        botArmed: false,
        openPositionsCount: 0,
        tunnelUrl: prev?.tunnelUrl || '',
        accountLogin: prev?.accountLogin,
        accountServer: prev?.accountServer,
        accountBalance: prev?.accountBalance,
        message: json?.message || '🛑 Auto-Bot STOPPED & all open MT5 trades closed.',
      }));
      setMt5OrderReceipt({
        status: 'stopped',
        direction: 'BOT STOPPED',
        retcode_name: json?.message || '🛑 Auto-Bot disarmed & open MT5 trades closed.',
      });
    } catch (err: any) {
      setMt5OrderReceipt({
        status: 'error',
        retcode_name: err?.message || 'Auto-Bot stopped locally.',
      });
    } finally {
      setMt5Stopping(false);
    }
  };

  const isHighValue = (analysis?.latest_price || 0) > 10.0;
  const precision = isHighValue ? 2 : 4;

  const fetchSignal = async () => {
    try {
      let a: SignalAnalysis | null = null;
      try {
        const res = await fetchWithFastTimeout(
          `${API_BASE_URL}/api/signals/check`,
          2200,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              symbol,
              timeframe,
              force_dispatch: false,
              account_balance: accountBalance,
              lot_size: lotSize,
              risk_percent: riskPercent,
              current_price: currentPrice && currentPrice > 0 ? currentPrice : undefined,
            }),
          }
        );
        if (res.ok) {
          const data = await res.json();
          a = data.analysis;
        }
      } catch {}

      if (!a) {
        const { bars, source } = await fetchBrowserLiveBars(symbol, timeframe);
        a = computeBrowserSignalAnalysis(
          symbol,
          timeframe,
          bars,
          source,
          currentPrice && currentPrice > 0 ? currentPrice : undefined,
          accountBalance,
          lotSize,
          riskPercent
        ) as unknown as SignalAnalysis;
      }

      if (a) {
        if (a.data_source === 'SIMULATED') {
          setAnalysis(a);
          frozenRef.current = null;
          setFrozenParams(null);
          signalLockRef.current = null;
          setNotifications([]);
          return;
        }

        // Format Harare Time
        const now = new Date();
        const nowMs = now.getTime();
        const harareDateString = now.toLocaleString('en-US', { timeZone: 'Africa/Harare' });
        const harareTime = now.toLocaleTimeString('en-US', {
          timeZone: 'Africa/Harare',
          hour12: true,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
        
        const harareDate = new Date(harareDateString);
        const isCrypto = symbol.includes('BTC') || symbol.includes('ETH') || symbol.includes('SOL') || symbol.includes('REXT') || symbol.includes('USDT');
        const isWeekend = (harareDate.getDay() === 0 || harareDate.getDay() === 6) && !isCrypto;

        // ── INSTITUTIONAL STRUCTURE & MILESTONE-DRIVEN TRADE LIFECYCLE ──
        // A setup is established from SMC/FVG confluence and pinned.
        // It NEVER flips or resets because of a timer! Market fluctuations toward TP are protected.
        // The lifecycle completes ONLY when:
        //   1. Take Profit TP1 is reached -> Profit banked, Stop Loss moved to Breakeven.
        //   2. Stop Loss is breached -> Controlled exit.
        //   3. A confirmed multi-candle Change of Character (CHoCH) structural reversal forms.
        const lockKey = `${symbol.toUpperCase()}:${timeframe}`;
        const tfHoldSec = TIMEFRAME_HOLD_SECONDS[timeframe] || a.hold_total_sec || 300;
        const existingLock = signalLockRef.current;
        const effectiveCurrentPrice = currentPrice && currentPrice > 0 ? currentPrice : a.latest_price;

        let lockActive = false;
        if (
          existingLock &&
          existingLock.key === lockKey &&
          existingLock.signal_type !== 'NEUTRAL'
        ) {
          const prevIsBuy = existingLock.signal_type === 'BUY/LONG';
          const directionReversedByEngine =
            a.signal_type !== 'NEUTRAL' && a.signal_type !== existingLock.signal_type;

          const slHit =
            (prevIsBuy && effectiveCurrentPrice <= existingLock.stop_loss) ||
            (!prevIsBuy && effectiveCurrentPrice >= existingLock.stop_loss);

          const tp1Hit =
            (prevIsBuy && effectiveCurrentPrice >= existingLock.tp1) ||
            (!prevIsBuy && effectiveCurrentPrice <= existingLock.tp1);

          const isGold = symbol.toUpperCase().includes('XAU') || symbol.toUpperCase().includes('GOLD');
          const maxDrift = isGold ? 3.50 : existingLock.entry * 0.003;
          const staleDrift = Math.abs(effectiveCurrentPrice - existingLock.entry) > maxDrift;

          const beTriggerDist = Math.max(1.8, Math.abs(existingLock.entry - existingLock.stop_loss) * 0.65);
          const breakevenHit =
            (prevIsBuy && effectiveCurrentPrice >= existingLock.entry + beTriggerDist) ||
            (!prevIsBuy && effectiveCurrentPrice <= existingLock.entry - beTriggerDist);

          // Confirmed Structural Reversal requires a genuine opposing market move (not a minor 1-candle noise)
          const confirmedOpposingReversal =
            (prevIsBuy && directionReversedByEngine && effectiveCurrentPrice < existingLock.entry - 4.5) ||
            (!prevIsBuy && directionReversedByEngine && effectiveCurrentPrice > existingLock.entry + 4.5);

          if (!slHit && !confirmedOpposingReversal && !staleDrift) {
            lockActive = true;
            // Auto Breakeven Lock: Once price passes 65% of the distance to TP1, move SL to Entry (risk-free!)
            if (breakevenHit || tp1Hit) {
              existingLock.stop_loss = prevIsBuy
                ? Math.max(existingLock.stop_loss, existingLock.entry)
                : Math.min(existingLock.stop_loss, existingLock.entry);
            }

            a.signal_type = existingLock.signal_type;
            a.trend = prevIsBuy ? 'UPTREND' : 'DOWNTREND';
            a.probability = existingLock.probability;
            a.trade_params = {
              ...a.trade_params,
              entry: existingLock.entry,
              entry_zones: existingLock.entry_zones,
              stop_loss: existingLock.stop_loss,
              tp1: existingLock.tp1,
              tp2: existingLock.tp2,
              tp_levels: existingLock.tp_levels,
              rationale: existingLock.rationale,
              probability: existingLock.probability,
            };
          } else {
            // Signal reached SL or confirmed CHoCH reversal: clear lock so fresh structure forms cleanly
            signalLockRef.current = null;
            if (soundEnabled && typeof window !== 'undefined') {
              try {
                const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
                if (AudioCtx) {
                  const ctx = new AudioCtx();
                  const osc = ctx.createOscillator();
                  const gain = ctx.createGain();
                  osc.type = 'sawtooth';
                  osc.frequency.setValueAtTime(880, ctx.currentTime);
                  osc.frequency.setValueAtTime(660, ctx.currentTime + 0.12);
                  gain.gain.setValueAtTime(0.08, ctx.currentTime);
                  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
                  osc.connect(gain);
                  gain.connect(ctx.destination);
                  osc.start();
                  osc.stop(ctx.currentTime + 0.3);
                }
              } catch {}
            }
          }
        }

        const isBuy = isWeekend ? false : a.signal_type === 'BUY/LONG';
        const isSell = isWeekend ? false : a.signal_type === 'SELL/SHORT';
        const notifType: 'BUY_NOW' | 'SELL_NOW' | 'MONITORING' | 'CLOSED' = isWeekend ? 'CLOSED' : isBuy ? 'BUY_NOW' : isSell ? 'SELL_NOW' : 'MONITORING';

        let incoming_zones: number[] = [];
        let effectiveSL = 0;
        let effectiveTpLevels: number[] = [];
        let effectiveTp1 = 0;
        let effectiveTp2 = 0;

        if (lockActive && existingLock) {
          incoming_zones = existingLock.entry_zones;
          effectiveSL = existingLock.stop_loss;
          effectiveTpLevels = existingLock.tp_levels;
          effectiveTp1 = existingLock.tp1;
          effectiveTp2 = existingLock.tp2;
          a.trade_params.entry = existingLock.entry;
        } else {
          // Ensure entry and structural swing levels are anchored to the live chart price if starting a fresh setup
          const rawEntry = a.trade_params.entry || a.latest_price;
          const chartAnchor = currentPrice && currentPrice > 0 ? currentPrice : rawEntry;
          const feedDelta = chartAnchor && rawEntry ? chartAnchor - rawEntry : 0;
          const shouldShiftToChart = Math.abs(feedDelta) > (symbol.toUpperCase().includes('XAU') ? 0.5 : rawEntry * 0.0005);
          const syncedEntry = shouldShiftToChart ? Number(chartAnchor.toFixed(precision)) : rawEntry;
          const rawSwingLow = (a.trade_params as any)?.swing_low ?? a.support;
          const rawSwingHigh = (a.trade_params as any)?.swing_high ?? a.resistance;
          const syncedSwingLow =
            typeof rawSwingLow === 'number' && rawSwingLow > 0
              ? Number((shouldShiftToChart ? rawSwingLow + feedDelta : rawSwingLow).toFixed(precision))
              : undefined;
          const syncedSwingHigh =
            typeof rawSwingHigh === 'number' && rawSwingHigh > 0
              ? Number((shouldShiftToChart ? rawSwingHigh + feedDelta : rawSwingHigh).toFixed(precision))
              : undefined;

          const riskBased = calculateRiskBasedLevels({
            symbol,
            entryPrice: syncedEntry,
            isBuy: !isSell,
            accountBalance,
            lotSize,
            riskPercent,
            precision,
            structuralSwingLow: syncedSwingLow,
            structuralSwingHigh: syncedSwingHigh,
            atr: (a.trade_params as any)?.atr,
          });

          incoming_zones = riskBased.entryZones;
          effectiveSL = riskBased.stopLoss;
          effectiveTpLevels = riskBased.tpLevels;
          effectiveTp1 = riskBased.tp1;
          effectiveTp2 = riskBased.tp2;

          a.latest_price = syncedEntry;
          a.trade_params = {
            ...a.trade_params,
            entry: syncedEntry,
            entry_zones: incoming_zones,
            stop_loss: effectiveSL,
            tp1: effectiveTp1,
            tp2: effectiveTp2,
            tp_levels: effectiveTpLevels,
            ...(syncedSwingLow ? { swing_low: syncedSwingLow } : {}),
            ...(syncedSwingHigh ? { swing_high: syncedSwingHigh } : {}),
          } as any;

          const newLock: LockedSignalState = {
            key: lockKey,
            symbol,
            timeframe,
            signal_type: a.signal_type,
            bias: isBuy ? 'BULLISH' : isSell ? 'BEARISH' : 'NEUTRAL',
            entry: a.trade_params.entry,
            entry_zones: incoming_zones,
            stop_loss: effectiveSL,
            tp1: effectiveTp1,
            tp2: effectiveTp2,
            tp_levels: effectiveTpLevels,
            probability: a.probability ?? a.trade_params.probability ?? 91,
            rationale: a.trade_params.rationale,
            lockedAtMs: nowMs,
            holdTotalSec: tfHoldSec,
          };
          signalLockRef.current = newLock;
        }

        // Broadcast active lock globally so ICT Strategy & Trend panels stay 100% synchronized
        if (typeof window !== 'undefined' && signalLockRef.current) {
          (window as any).__wessignalActiveSignal = signalLockRef.current;
          window.dispatchEvent(new CustomEvent('wessignal-signal-sync', { detail: signalLockRef.current }));
        }

        setAnalysis(a);

        const prevFrozen = frozenRef.current;
        const directionChanged = Boolean(prevFrozen && prevFrozen.signal_type !== a.signal_type);

        // AUTO-REVERSAL PROTECTION: If market direction flipped (e.g. BUY -> SELL or SELL -> BUY)
        // and there is an open MT5 position on this account, automatically close the old wrong-way trade!
        if (
          directionChanged &&
          prevFrozen?.signal_type &&
          prevFrozen.signal_type !== 'NEUTRAL' &&
          a.signal_type !== 'NEUTRAL' &&
          (mt5BridgeState?.openPositionsCount || 0) > 0
        ) {
          handleCancelOrCloseTrade(false);
        }

        const latestParams: FrozenParams = {
          signal_type: a.signal_type,
          entry: a.trade_params.entry,
          entry_zones: incoming_zones,
          stop_loss: effectiveSL,
          tp1: effectiveTp1,
          tp2: effectiveTp2,
          tp_levels: effectiveTpLevels,
        };

        frozenRef.current = latestParams;
        setFrozenParams(latestParams);
        if (directionChanged) {
          setSelectedTpIndex(0); // reset chip selection only on direction flip
        }

        let notifTitle = '';
        let notifMsg = '';

        if (isWeekend) {
          notifTitle = `🛑 MARKETS CLOSED ON WEEKENDS`;
          notifMsg = `Trading resumes on Monday starting with the Asia market. Signal Navigator is disabled for non-crypto assets.`;
        } else if (isBuy) {
          notifTitle = `🟢 BUY NOW! [${timeframe.toUpperCase()}] ENTRY FOR ${symbol}`;
          notifMsg = a.trade_params.rationale || `Bullish Demand on ${timeframe} timeframe at $${a.latest_price.toFixed(precision)}. Stop Loss: $${effectiveSL.toFixed(precision)}`;
        } else if (isSell) {
          notifTitle = `🔴 SELL NOW! [${timeframe.toUpperCase()}] SHORT FOR ${symbol}`;
          notifMsg = a.trade_params.rationale || `Bearish Rejection on ${timeframe} timeframe at $${a.latest_price.toFixed(precision)}. Stop Loss: $${effectiveSL.toFixed(precision)}`;
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
          stop_loss: effectiveSL,
          tp1: effectiveTp1,
          tp2: effectiveTp2,
          tp_levels: effectiveTpLevels,
          rationale: a.trade_params.rationale,
        };

        setNotifications((prev) => {
          const top = prev[0];
          const updated =
            top && top.type === notifType && top.timeframe === timeframe
              ? [{ ...newNotif, id: top.id }, ...prev.slice(1)]
              : [newNotif, ...prev.filter(n => n.timeframe === timeframe).slice(0, 49)];
          if (typeof window !== 'undefined') {
            try {
              window.sessionStorage.setItem(
                `wessignal_nav_${symbol.toUpperCase()}_${timeframe}`,
                JSON.stringify({ analysis: a, notifications: updated.slice(0, 10) })
              );
            } catch {}
          }
          return updated;
        });
      }
    } catch (e) {
      console.error('Signal notification error:', e);
    }
  };

  useEffect(() => {
    // Restore cached state immediately on symbol/timeframe change so the panel NEVER blanks out!
    if (typeof window !== 'undefined') {
      try {
        const cachedRaw = window.sessionStorage.getItem(`wessignal_nav_${symbol.toUpperCase()}_${timeframe}`);
        if (cachedRaw) {
          const parsed = JSON.parse(cachedRaw);
          if (parsed?.analysis) setAnalysis(parsed.analysis);
          if (Array.isArray(parsed?.notifications) && parsed.notifications.length > 0) {
            setNotifications(parsed.notifications);
          }
        }
      } catch {}
    }
    frozenRef.current = null;
    setFrozenParams(null);
    signalLockRef.current = null;
    setHoldRemainingSec(TIMEFRAME_HOLD_SECONDS[timeframe] || 300);
    setSelectedTpIndex(0);
  }, [symbol, timeframe]);

  useEffect(() => {
    fetchSignal();
    const interval = setInterval(fetchSignal, 6000);
    return () => clearInterval(interval);
  }, [symbol, timeframe, accountBalance, lotSize, riskPercent]);

  // 1-second live interval countdown ticker for the Signal Navigator hold lock
  useEffect(() => {
    const tick = setInterval(() => {
      const lock = signalLockRef.current;
      if (!lock) return;
      const rem = Math.max(0, Math.ceil((lock.lockedAtMs + lock.holdTotalSec * 1000 - Date.now()) / 1000));
      setHoldRemainingSec(rem);
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  const getFallbackPairPrice = (sym: string): number => {
    const s = sym.toUpperCase();
    if (s.includes('XAU') || s.includes('GOLD')) return 4125.0;
    if (s.includes('XAG')) return 31.45;
    if (s.includes('OIL')) return 71.25;
    if (s.includes('BTC')) return 79450.0;
    if (s.includes('ETH')) return 3480.0;
    if (s.includes('SOL')) return 148.5;
    if (s.includes('BNB')) return 595.0;
    if (s.includes('XRP')) return 0.548;
    if (s.includes('DOGE')) return 0.145;
    if (s.includes('ADA')) return 0.365;
    if (s.includes('US30') || s.includes('DJ30')) return 42350.0;
    if (s.includes('NAS') || s.includes('USTEC') || s.includes('US100')) return 20380.0;
    if (s.includes('SPX') || s.includes('US500')) return 5840.0;
    if (s.includes('GER') || s.includes('DE30') || s.includes('DE40')) return 19450.0;
    if (s.includes('GBPJPY')) return 197.6;
    if (s.includes('EURJPY')) return 165.3;
    if (s.includes('JPY')) return 152.45;
    if (s.includes('GBP')) return 1.2965;
    if (s.includes('EURGBP')) return 0.8365;
    if (s.includes('EUR')) return 1.0845;
    if (s.includes('AUD')) return 0.664;
    if (s.includes('CAD')) return 1.378;
    if (s.includes('CHF')) return 0.8845;
    if (s.includes('NZD')) return 0.604;
    if (s.includes('REXT')) return 0.045;
    return 1.0845;
  };
  const fallbackPrice = currentPrice && currentPrice > 0 ? currentPrice : getFallbackPairPrice(symbol);
  const initStep = fallbackPrice > 500 ? 3.0 : fallbackPrice > 20 ? 0.15 : 0.0015;
  const latestNotif: NotificationItem = notifications[0] || {
    id: 'instant-init',
    time_harare: 'LIVE SYNC',
    timeframe,
    type: 'BUY_NOW',
    title: `⚡ SYNCING [${timeframe.toUpperCase()}] SIGNAL FOR ${symbol}...`,
    message: `Calculating institutional entry, fixed stop loss, and 7 take-profit targets for ${symbol} (${timeframe.toUpperCase()})...`,
    entry: fallbackPrice,
    entry_zones: [
      fallbackPrice,
      Number((fallbackPrice - initStep * 0.3).toFixed(precision)),
      Number((fallbackPrice - initStep * 0.6).toFixed(precision)),
      Number((fallbackPrice - initStep * 0.9).toFixed(precision)),
      Number((fallbackPrice - initStep * 1.2).toFixed(precision)),
    ],
    stop_loss: Number((fallbackPrice - initStep * 1.5).toFixed(precision)),
    tp1: Number((fallbackPrice + initStep).toFixed(precision)),
    tp2: Number((fallbackPrice + initStep * 2).toFixed(precision)),
    tp_levels: [1, 2, 3, 4, 5, 6, 7].map((idx) => Number((fallbackPrice + initStep * idx).toFixed(precision))),
    rationale: `Syncing live ${timeframe.toUpperCase()} market structure & order flow...`,
  };

  // Active locked setup takes absolute precedence to keep entry, SL and TPs stable during fluctuations
  const activeLock = signalLockRef.current;
  const isLocked = Boolean(
    activeLock &&
    activeLock.key === `${symbol.toUpperCase()}:${timeframe}` &&
    activeLock.signal_type !== 'NEUTRAL'
  );

  const displayEntry = isLocked && activeLock
    ? activeLock.entry
    : (analysis?.trade_params?.entry ?? latestNotif?.entry ?? frozenParams?.entry ?? fallbackPrice);

  const isSellTrade = isLocked && activeLock
    ? activeLock.signal_type === 'SELL/SHORT'
    : (analysis?.signal_type === 'SELL/SHORT') || (!analysis && (latestNotif?.type === 'SELL_NOW' || frozenParams?.signal_type === 'SELL/SHORT'));
  const isBuyTrade = !isSellTrade;

  // Real-time Risk Calculator + Chart Swing Structure computation:
  // Changing Account Balance ($40 vs $1000), Lot Size, or Risk % updates sizing
  // while anchoring Stop Loss outside market wicks and below/above swing structure!
  const liveRiskCalc = calculateRiskBasedLevels({
    symbol,
    entryPrice: displayEntry > 0 ? displayEntry : fallbackPrice,
    isBuy: !isSellTrade,
    accountBalance,
    lotSize,
    riskPercent,
    precision,
    structuralSwingLow: (analysis?.trade_params as any)?.swing_low ?? analysis?.support,
    structuralSwingHigh: (analysis?.trade_params as any)?.swing_high ?? analysis?.resistance,
    atr: (analysis?.trade_params as any)?.atr,
  });

  const displayEntryZones = isLocked && activeLock?.entry_zones?.length ? activeLock.entry_zones : liveRiskCalc.entryZones;
  const rawSL = isLocked && activeLock?.stop_loss ? activeLock.stop_loss : liveRiskCalc.stopLoss;
  const currentChartPrice = currentPrice && currentPrice > 0 ? currentPrice : displayEntry;

  // ABSOLUTE SAFETY INVARIANT FOR ORDERS & DISPLAY:
  // For SELL: Stop Loss CAN NEVER BE <= current market price! Must be strictly above currentChartPrice + slDistance.
  // For BUY: Stop Loss CAN NEVER BE >= current market price! Must be strictly below currentChartPrice - slDistance.
  const displaySL = isSellTrade
    ? Math.max(rawSL, Number((currentChartPrice + liveRiskCalc.slDistance).toFixed(precision)))
    : Math.min(rawSL, Number((currentChartPrice - liveRiskCalc.slDistance).toFixed(precision)));

  const displayTpLevels = isLocked && activeLock?.tp_levels?.length ? activeLock.tp_levels : liveRiskCalc.tpLevels;
  const displayTp1 = isLocked && activeLock?.tp1 ? activeLock.tp1 : liveRiskCalc.tp1;
  const displayTp2 = isLocked && activeLock?.tp2 ? activeLock.tp2 : liveRiskCalc.tp2;

  // Broadcast live direction & Risk-Calculated SL/TP to page.tsx Top Bar so both consoles stay 100% synced
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('wessignal-live-params', {
          detail: {
            symbol,
            direction: isSellTrade ? 'SELL' : 'BUY',
            entry: displayEntry,
            stopLoss: displaySL,
            takeProfit: displayTpLevels[selectedTpIndex] ?? displayTp1,
            lotSize,
            accountBalance,
            riskPercent,
            slDistance: liveRiskCalc.slDistance,
            maxRiskDollars: liveRiskCalc.actualDollarRisk,
            probability: analysis?.probability ?? 92,
          },
        })
      );
    }
  }, [symbol, isSellTrade, displayEntry, displaySL, displayTpLevels, selectedTpIndex, displayTp1, lotSize, accountBalance, riskPercent, analysis?.probability]);

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
    <aside className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-2xl flex flex-col h-full max-h-[calc(100vh-2rem)] sticky top-4 space-y-4 font-mono overflow-y-auto scrollbar-navigator">
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
                {analysis?.data_source && (
                  <span className={`text-[9px] px-1.5 py-0.5 rounded border ${analysis.data_source === 'SIMULATED' ? 'text-amber-300 bg-amber-950 border-amber-800' : 'text-emerald-300 bg-emerald-950 border-emerald-800'}`}>
                    {analysis.data_source === 'SIMULATED'
                      ? (symbol.toUpperCase().includes('XAU') || symbol.toUpperCase().includes('GOLD') ? 'OANDA TOKEN NEEDED' : 'SIMULATED · NO SIGNAL')
                      : analysis.data_source.toUpperCase()}
                  </span>
                )}
              </span>
            </div>
          </div>

          {/* Audio Toggle & TP Help */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowRiskConfig(!showRiskConfig)}
              className={`p-1.5 rounded-lg border text-[10px] font-bold transition flex items-center gap-1 ${
                showRiskConfig
                  ? 'bg-blue-600 border-blue-400 text-white'
                  : 'bg-blue-950/80 border-blue-800 text-blue-300 hover:bg-blue-900'
              }`}
              title="Risk & Lot Size Management"
            >
              <Shield className="w-3 h-3" />
              <span>Risk</span>
            </button>
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

        {/* All Timeframes Selector Bar (1s to 1d) */}
        <div className="bg-slate-950 border border-slate-800 rounded-lg p-1.5 space-y-1">
          <div className="flex items-center justify-between text-[9px] text-slate-400 px-1">
            <span className="font-bold uppercase tracking-wider">Select Timeframe (Predictor Window):</span>
            <span className="text-blue-400 font-bold">{timeframe.toUpperCase()}</span>
          </div>
          <div className="grid grid-cols-9 gap-1">
            {ALL_TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => onTimeframeChange && onTimeframeChange(tf)}
                className={`py-1 rounded text-[9px] font-bold transition border ${
                  timeframe === tf
                    ? 'bg-blue-600 border-blue-400 text-white shadow'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>

        {/* ── TOP-LEVEL MT5 4-BUTTON EXECUTION & STOP/CANCEL CONSOLE (ALWAYS VISIBLE FOR ALL PAIRS) ── */}
        <div className="bg-gradient-to-b from-indigo-950/90 to-slate-950 border-2 border-indigo-500/80 p-3 rounded-xl space-y-2.5 shadow-xl">
          <div className="flex items-center justify-between border-b border-indigo-800/70 pb-1.5">
            <div className="flex items-center gap-1.5">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  mt5BridgeState?.botArmed === false
                    ? 'bg-rose-500'
                    : mt5BridgeState?.online
                    ? 'bg-emerald-400 animate-ping'
                    : 'bg-amber-400'
                }`}
              />
              <span className="text-[11px] font-black text-white uppercase tracking-wider">
                MT5 Auto-Bridge ({symbol})
              </span>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <div
                className={`text-[8.5px] font-mono px-2 py-0.5 rounded border flex items-center gap-1 ${
                  workerGoalMet
                    ? 'bg-amber-950/80 border-amber-400 text-amber-300 font-bold animate-pulse'
                    : 'bg-slate-900 border-slate-700 text-slate-300'
                }`}
                title="Daily Worker Target quota tracking"
              >
                <Trophy className="w-2.5 h-2.5 text-amber-400" />
                <span>Goal: ${workerDailyTarget.toFixed(0)}</span>
                <span className="text-slate-500">·</span>
                <span className={workerSessionProfit >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                  {workerSessionProfit >= 0 ? `+$${workerSessionProfit.toFixed(2)}` : `-$${Math.abs(workerSessionProfit).toFixed(2)}`}
                </span>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    window.dispatchEvent(
                      new CustomEvent('wessignal-open-bot-window', {
                        detail: { enableAutopilot: false },
                      })
                    );
                  }
                }}
                className={`text-[9px] font-mono px-2 py-0.5 rounded border font-extrabold flex items-center gap-1 transition ${
                  workerGoalMet
                    ? 'bg-amber-600 border-amber-300 text-white shadow-lg'
                    : 'bg-indigo-900/90 border-indigo-600 text-indigo-100 hover:bg-indigo-800'
                }`}
                title="Opens the Live Bot & AI Autopilot Window (Safe Mode)"
              >
                {workerGoalMet ? (
                  <>
                    <Trophy className="w-3 h-3 text-amber-200" />
                    <span>PARKED: GOAL MET</span>
                  </>
                ) : (
                  <>
                    <Bot className="w-3 h-3" />
                    <span>OPEN AI BOT</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Dynamic Risk Calculator & Account Balance Stop-Loss Sizer (Always Visible) */}
          <div className="bg-slate-900/95 border border-indigo-700/80 rounded-lg p-2 space-y-1.5 text-[10px]">
            <div className="flex items-center justify-between text-[9.5px]">
              <span className="text-indigo-200 font-bold flex items-center gap-1">
                <Shield className="w-3 h-3 text-emerald-400" />
                <span>Risk Calculator (Dynamic SL Sizer)</span>
              </span>
              <span className="text-emerald-300 font-mono font-bold">
                Max Risk: ${liveRiskCalc.actualDollarRisk.toFixed(2)} ({riskPercent}%)
              </span>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <label className="text-[8.5px] text-slate-400">Balance ($)</label>
                  <div className="flex gap-0.5">
                    {[40, 100, 1000].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => {
                          userEditedBalanceRef.current = true;
                          setAccountBalance(preset);
                          setBalanceInput(String(preset));
                        }}
                        className={`px-1 py-0.2 rounded text-[7.5px] font-mono border ${
                          Math.round(accountBalance) === preset
                            ? 'bg-emerald-600 border-emerald-400 text-white font-bold'
                            : 'bg-slate-950 border-slate-700 text-slate-400 hover:text-white'
                        }`}
                      >
                        ${preset}
                      </button>
                    ))}
                  </div>
                </div>
                <input
                  type="text"
                  inputMode="decimal"
                  value={balanceInput}
                  onChange={(e) => {
                    userEditedBalanceRef.current = true;
                    const raw = e.target.value.replace(/[^0-9.]/g, '');
                    setBalanceInput(raw);
                    const num = parseFloat(raw);
                    if (!isNaN(num) && num >= 1) setAccountBalance(num);
                  }}
                  onBlur={() => {
                    const num = parseFloat(balanceInput);
                    if (isNaN(num) || num < 1) {
                      setBalanceInput(String(accountBalance));
                    } else {
                      setAccountBalance(num);
                      setBalanceInput(String(num));
                    }
                  }}
                  className="w-full bg-slate-950 border border-indigo-700 rounded px-1.5 py-0.5 text-white font-mono text-[10.5px] font-bold"
                  placeholder="40.45"
                />
              </div>

              <div>
                <label className="text-[8.5px] text-slate-400 block mb-0.5">Lot Size</label>
                <select
                  value={lotSize}
                  onChange={(e) => setLotSize(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-indigo-700 rounded px-1.5 py-0.5 text-white font-mono text-[10.5px] font-bold"
                >
                  <option value={0.01}>0.01 Lot</option>
                  <option value={0.02}>0.02 Lot</option>
                  <option value={0.05}>0.05 Lot</option>
                  <option value={0.10}>0.10 Lot</option>
                  <option value={0.20}>0.20 Lot</option>
                  <option value={0.50}>0.50 Lot</option>
                  <option value={1.00}>1.00 Lot</option>
                </select>
              </div>

              <div>
                <label className="text-[8.5px] text-slate-400 block mb-0.5">Risk %</label>
                <div className="flex gap-0.5">
                  {[1.0, 2.0, 3.0].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => setRiskPercent(pct)}
                      className={`flex-1 py-0.5 rounded text-[9.5px] font-bold border ${
                        riskPercent === pct
                          ? 'bg-indigo-600 border-indigo-400 text-white'
                          : 'bg-slate-950 border-slate-700 text-slate-400 hover:text-white'
                      }`}
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1 border-t border-slate-800 font-mono text-[9px]">
              <span className="text-rose-300 font-bold flex items-center gap-1">
                <span>Dynamic SL: ${displaySL.toFixed(precision)} (Dist: {liveRiskCalc.slDistance.toFixed(precision)})</span>
                {liveRiskCalc.slDistance >= 3.8 && symbol.toUpperCase().includes('XAU') && (
                  <span className="text-emerald-400 text-[8px] bg-emerald-950/80 px-1 rounded border border-emerald-800">
                    🛡️ Shielded
                  </span>
                )}
              </span>
              <span className="text-emerald-300 font-bold">
                {mt5BridgeState?.accountBalance !== undefined
                  ? `MT5 Bal: $${Number(mt5BridgeState.accountBalance).toFixed(2)}`
                  : mt5BridgeState?.online
                  ? 'IPC ONLINE'
                  : 'READY'}
              </span>
            </div>
          </div>

          {mt5BridgeState?.tunnelUrl && (
            <div className="text-[8.5px] text-sky-300 font-mono bg-slate-950/90 px-2 py-1 rounded border border-slate-800 truncate" title={mt5BridgeState.tunnelUrl}>
              🌐 Tunnel: {mt5BridgeState.tunnelUrl}
            </div>
          )}
          {mt5BridgeState?.message && (
            <div className="text-[9px] text-indigo-200 leading-tight font-sans bg-indigo-950/50 px-2 py-1 rounded">
              {mt5BridgeState.message}
            </div>
          )}

          {/* BUTTON 0: START SERVER (PORT 8001) */}
          <button
            type="button"
            disabled={startingBridgeServer}
            onClick={handleStartBridgeServer}
            className={`w-full py-2 px-3 text-[10.5px] font-black rounded-lg shadow-lg border transition flex items-center justify-center gap-1.5 font-mono ${
              mt5BridgeState?.online
                ? 'bg-emerald-950/80 border-emerald-500/80 text-emerald-300'
                : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 border-emerald-300 text-white animate-pulse'
            } disabled:opacity-60`}
            title="Starts or verifies the local MT5 execution bridge server on port 8001"
          >
            <Server className={`w-3.5 h-3.5 ${startingBridgeServer ? 'animate-spin' : ''}`} />
            <span>
              {startingBridgeServer
                ? 'Starting Port 8001...'
                : mt5BridgeState?.online
                ? '✅ PORT 8001: ONLINE (CONNECTED)'
                : '0. START SERVER (start_bridge.bat)'}
            </span>
          </button>

          {!mt5BridgeState?.online && (
            <div className="text-[9px] text-amber-200/90 font-sans leading-tight bg-slate-950/80 p-2 rounded border border-slate-800 space-y-1">
              <div className="flex items-center gap-1 font-bold text-amber-300">
                <AlertTriangle className="w-3 h-3 text-amber-400" />
                <span>How to start MT5 Bridge on Port 8001:</span>
              </div>
              <div>
                • <strong>On Local PC:</strong> Click the button above to launch <code className="text-white">mt5_bridge/start_bridge.bat</code>.
              </div>
              <div>
                • <strong>On Vercel Cloud:</strong> Double-click <code className="text-white">START_PORT_8001.bat</code> or <code className="text-white">mt5_bridge\start_bridge.bat</code> on your PC desktop. Once opened, this card connects automatically!
              </div>
            </div>
          )}

          {/* BUTTON 1: EXECUTE (Start Cloudflare Tunnel + Push New URL to GitHub & Vercel) */}
          <button
            type="button"
            disabled={mt5Syncing}
            onClick={handleExecuteBridgeSync}
            className="w-full py-2 px-3 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 disabled:opacity-60 text-white text-[10.5px] font-black rounded-lg shadow-lg border border-indigo-300/60 transition flex items-center justify-center gap-1.5"
          >
            <Zap className={`w-3.5 h-3.5 text-amber-300 ${mt5Syncing ? 'animate-spin' : ''}`} />
            <span>
              {mt5Syncing
                ? '1. Starting Cloudflare & Pushing URL to Git/Vercel...'
                : '1. EXECUTE (Start Tunnel & Push URL to Git/Vercel)'}
            </span>
          </button>

          {/* BUTTON 2: PLACE ORDER / TRADE NOW (Executes Live Trade on MT5 for Any Pair with Auto TP/SL) */}
          <button
            type="button"
            disabled={mt5Ordering}
            onClick={() =>
              handlePlaceMt5Order(
                isSellTrade ? 'SELL' : 'BUY',
                displayTpLevels[selectedTpIndex] ?? displayTp1,
                displaySL
              )
            }
            className={`w-full py-2.5 px-3 text-white text-xs font-black rounded-lg shadow-xl border transition flex items-center justify-center gap-1.5 ${
              isSellTrade
                ? 'bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 border-rose-300/70'
                : 'bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 border-emerald-300/70'
            } disabled:opacity-60`}
          >
            <Play className="w-3.5 h-3.5 fill-white" />
            <span>
              {mt5Ordering
                ? `Executing ${isSellTrade ? 'SELL' : 'BUY'} ${symbol} (${lotSize} Lot)...`
                : `2. PLACE ORDER / TRADE NOW (${isSellTrade ? 'SELL' : 'BUY'} ${symbol} · SL $${displaySL.toFixed(precision)})`}
            </span>
          </button>

          {/* Direct Manual Override BUY / SELL Buttons for Any Selected Pair */}
          <div className="grid grid-cols-2 gap-1.5 pt-0.5">
            <button
              type="button"
              disabled={mt5Ordering}
              onClick={() => {
                const buyLevels = calculateRiskBasedLevels({
                  symbol,
                  entryPrice: displayEntry > 0 ? displayEntry : fallbackPrice,
                  isBuy: true,
                  accountBalance,
                  lotSize,
                  riskPercent,
                  precision,
                });
                const buyTp = buyLevels.tpLevels[selectedTpIndex] ?? buyLevels.tp1;
                handlePlaceMt5Order('BUY', buyTp, buyLevels.stopLoss);
              }}
              className="py-1.5 px-2 bg-emerald-900/80 hover:bg-emerald-700 border border-emerald-500/60 text-emerald-100 text-[10px] font-extrabold rounded-md transition flex items-center justify-center gap-1 disabled:opacity-50"
            >
              <ArrowUpRight className="w-3 h-3 text-emerald-300" />
              <span>Instant BUY {symbol}</span>
            </button>
            <button
              type="button"
              disabled={mt5Ordering}
              onClick={() => {
                const sellLevels = calculateRiskBasedLevels({
                  symbol,
                  entryPrice: displayEntry > 0 ? displayEntry : fallbackPrice,
                  isBuy: false,
                  accountBalance,
                  lotSize,
                  riskPercent,
                  precision,
                });
                const sellTp = sellLevels.tpLevels[selectedTpIndex] ?? sellLevels.tp1;
                handlePlaceMt5Order('SELL', sellTp, sellLevels.stopLoss);
              }}
              className="py-1.5 px-2 bg-rose-900/80 hover:bg-rose-700 border border-rose-500/60 text-rose-100 text-[10px] font-extrabold rounded-md transition flex items-center justify-center gap-1 disabled:opacity-50"
            >
              <ArrowDownRight className="w-3 h-3 text-rose-300" />
              <span>Instant SELL {symbol}</span>
            </button>
          </div>

          {/* BUTTON 3 (CANCEL / CLOSE PAIR TRADE) & BUTTON 4 (STOP BOT / CLOSE ALL) */}
          <div className="grid grid-cols-2 gap-1.5 pt-1 border-t border-indigo-900/80">
            <button
              type="button"
              disabled={mt5Cancelling}
              onClick={() => handleCancelOrCloseTrade(false)}
              className="py-2 px-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-slate-950 text-[10px] font-black rounded-lg shadow border border-amber-300 transition flex items-center justify-center gap-1"
              title="Immediately closes open MT5 position(s) & cancels pending orders for this pair"
            >
              <XCircle className="w-3.5 h-3.5" />
              <span>{mt5Cancelling ? 'Closing...' : `3. CANCEL / CLOSE (${symbol})`}</span>
            </button>
            <button
              type="button"
              disabled={mt5Stopping}
              onClick={handleStopAutoBot}
              className="py-2 px-2 bg-rose-700 hover:bg-rose-600 disabled:opacity-50 text-white text-[10px] font-black rounded-lg shadow border border-rose-400 transition flex items-center justify-center gap-1"
              title="Stops the Auto-Bot and immediately closes ALL open MT5 positions across all pairs"
            >
              <Square className="w-3 h-3 fill-white" />
              <span>{mt5Stopping ? 'Stopping...' : '4. STOP BOT (CLOSE ALL)'}</span>
            </button>
          </div>

          {/* BUTTON 5: AI CLEARANCE CHAT (VOLATILITY, NEWS & DIRECTION ADVISOR) */}
          <button
            type="button"
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('wessignal-open-ai-copilot'));
              }
            }}
            className="w-full py-2 px-3 bg-gradient-to-r from-violet-600 via-indigo-600 to-teal-600 hover:from-violet-500 hover:to-teal-500 text-white text-[10.5px] font-black rounded-lg shadow-lg border border-violet-300/70 transition flex items-center justify-center gap-1.5"
          >
            <Bot className="w-3.5 h-3.5 text-amber-300 animate-pulse" />
            <span>5. AI CLEARANCE CHAT (Check Volatility &amp; Market News)</span>
          </button>

          {/* BUTTON 6: LIVE AUTONOMOUS BOT & AI COMMANDER WINDOW (MIMIC + INTERVENE) */}
          <button
            type="button"
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.dispatchEvent(
                  new CustomEvent('wessignal-open-bot-window', {
                    detail: { enableAutopilot: false },
                  })
                );
              }
            }}
            className="w-full py-2 px-3 bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white text-[10.5px] font-black rounded-lg shadow-lg border border-emerald-300/80 transition flex items-center justify-center gap-1.5"
          >
            <Zap className="w-3.5 h-3.5 text-amber-200 animate-pulse" />
            <span>6. LIVE BOT &amp; AI AUTOPILOT WINDOW (Auto-Trade &amp; Intervene)</span>
          </button>

          {/* Auto-Stop & Server-Side TP/SL Protection Note */}
          <div className="text-[8.5px] text-slate-300 bg-slate-900/90 border border-slate-800 rounded px-2 py-1 font-sans leading-tight">
            🛡️ <strong>Auto-Stop Built-In:</strong> Every order attaches hard <strong>SL (${displaySL.toFixed(precision)})</strong> &amp; <strong>TP{selectedTpIndex + 1} (${(displayTpLevels[selectedTpIndex] ?? displayTp1).toFixed(precision)})</strong> on the Exness MT5 server, so trades close automatically on their own at profit/stop even if your PC is off.
          </div>

          {/* Instant MT5 Execution Receipt */}
          {mt5OrderReceipt && (
            <div
              className={`p-2 rounded-lg border text-[9.5px] font-mono space-y-1 ${
                mt5OrderReceipt.status === 'executed'
                  ? 'bg-emerald-950/95 border-emerald-400 text-emerald-200'
                  : mt5OrderReceipt.status === 'stopped' || mt5OrderReceipt.status === 'notice'
                  ? 'bg-amber-950/95 border-amber-400 text-amber-200'
                  : 'bg-rose-950/95 border-rose-400 text-rose-200'
              }`}
            >
              <div className="flex items-center justify-between font-bold">
                <span>
                  {mt5OrderReceipt.status === 'executed'
                    ? `✅ MT5 ACTION COMPLETED (${mt5OrderReceipt.direction})`
                    : mt5OrderReceipt.status === 'stopped'
                    ? '🛑 AUTO-BOT STOPPED & TRADES CLOSED'
                    : `ℹ️ MT5: ${String(mt5OrderReceipt.status || 'NOTICE').toUpperCase()}`}
                </span>
                {mt5OrderReceipt.deal_ticket && (
                  <span className="bg-emerald-900 px-1.5 py-0.5 rounded text-white">
                    Deal #{mt5OrderReceipt.deal_ticket}
                  </span>
                )}
              </div>
              {mt5OrderReceipt.symbol_resolved && (
                <div className="flex justify-between text-[9px]">
                  <span>
                    Symbol: <strong>{mt5OrderReceipt.symbol_resolved}</strong> ({mt5OrderReceipt.volume_normalized} Lot)
                  </span>
                  {mt5OrderReceipt.executed_price && (
                    <span>
                      Price: <strong>${mt5OrderReceipt.executed_price}</strong>
                    </span>
                  )}
                </div>
              )}
              <div className="text-[8.5px] opacity-90">
                {mt5OrderReceipt.retcode_name || mt5OrderReceipt.broker_comment || mt5OrderReceipt.error}
              </div>
            </div>
          )}
        </div>

        {/* Risk & Lot Size Management Panel */}
        {showRiskConfig && (
          <div className="bg-slate-950 border border-blue-800/80 p-3 rounded-lg text-[10px] space-y-2.5 text-slate-300 font-sans">
            <div className="font-bold text-blue-400 flex items-center justify-between">
              <span className="flex items-center gap-1">
                <Shield className="w-3.5 h-3.5 text-blue-400" />
                <span>Risk & Lot Size Settings (1-3% Rule)</span>
              </span>
              <span className="text-[9px] text-slate-400 font-mono">
                Max Loss: ${((accountBalance * riskPercent) / 100).toFixed(2)}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[9px] text-slate-400 block mb-0.5">Balance ($)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={balanceInput}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^0-9.]/g, '');
                    setBalanceInput(raw);
                    const num = parseFloat(raw);
                    if (!isNaN(num) && num >= 1) setAccountBalance(num);
                  }}
                  onBlur={() => {
                    const num = parseFloat(balanceInput);
                    if (isNaN(num) || num < 1) {
                      setBalanceInput(String(accountBalance));
                    } else {
                      setAccountBalance(num);
                      setBalanceInput(String(num));
                    }
                  }}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white font-mono text-[11px]"
                  placeholder="e.g. 100"
                />
              </div>

              <div>
                <label className="text-[9px] text-slate-400 block mb-0.5">Lot Size</label>
                <select
                  value={lotSize}
                  onChange={(e) => setLotSize(Number(e.target.value))}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white font-mono text-[11px]"
                >
                  <option value={0.01}>0.01 (Micro)</option>
                  <option value={0.02}>0.02</option>
                  <option value={0.05}>0.05</option>
                  <option value={0.10}>0.10 (Mini)</option>
                  <option value={0.20}>0.20</option>
                  <option value={0.50}>0.50</option>
                  <option value={1.00}>1.00 (Standard)</option>
                </select>
              </div>

              <div>
                <label className="text-[9px] text-slate-400 block mb-0.5">Risk %</label>
                <div className="flex gap-1">
                  {[1.0, 2.0, 3.0].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => setRiskPercent(pct)}
                      className={`flex-1 py-1 rounded text-[10px] font-bold border ${
                        riskPercent === pct
                          ? 'bg-blue-600 border-blue-400 text-white'
                          : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
                      }`}
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="text-[9px] text-slate-400 pt-1 border-t border-slate-800 flex justify-between">
              <span>Risk: <strong>{riskPercent}%</strong> of ${accountBalance}</span>
              <span className="text-emerald-400 font-mono">
                SL auto-sizes to never exceed 1-3% account drawdown
              </span>
            </div>
          </div>
        )}

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
            latestNotif.type === 'CLOSED'
              ? 'bg-gradient-to-b from-slate-800 to-slate-950 border-slate-600'
              : latestNotif.type === 'BUY_NOW'
              ? 'bg-gradient-to-b from-emerald-950/90 to-slate-950 border-emerald-600/80'
              : latestNotif.type === 'SELL_NOW'
              ? 'bg-gradient-to-b from-rose-950/90 to-slate-950 border-rose-600/80'
              : 'bg-gradient-to-b from-slate-900 to-slate-950 border-amber-600/60'
          }`}
        >
          <div className="flex items-center justify-between">
            {latestNotif.type === 'CLOSED' ? (
              <span className="px-2.5 py-1 bg-slate-700 text-white font-extrabold text-xs rounded-lg flex items-center gap-1">
                <Clock className="w-4 h-4" /> MARKETS CLOSED
              </span>
            ) : (analysis?.signal_type === 'BUY/LONG' || (!analysis && latestNotif.type === 'BUY_NOW')) ? (
              <span className="px-2.5 py-1 bg-emerald-600 text-white font-extrabold text-xs rounded-lg animate-pulse flex items-center gap-1">
                <ArrowUpRight className="w-4 h-4" /> BUY NOW · BULLISH [{timeframe.toUpperCase()}]
              </span>
            ) : (analysis?.signal_type === 'SELL/SHORT' || (!analysis && latestNotif.type === 'SELL_NOW')) ? (
              <span className="px-2.5 py-1 bg-rose-600 text-white font-extrabold text-xs rounded-lg animate-pulse flex items-center gap-1">
                <ArrowDownRight className="w-4 h-4" /> SELL NOW · BEARISH [{timeframe.toUpperCase()}]
              </span>
            ) : (
              <span className="px-2.5 py-1 bg-amber-600 text-white font-extrabold text-xs rounded-lg flex items-center gap-1">
                <Clock className="w-4 h-4" /> STANDBY [{timeframe.toUpperCase()}]
              </span>
            )}
            <span className="text-[11px] text-slate-300 font-bold flex items-center gap-1">
              <Clock className="w-3 h-3 text-blue-400" />
              <span>{latestNotif.time_harare}</span>
            </span>
          </div>

          {/* Predictive Probability & Active Target Progress Bar (Replaces timer countdown!) */}
          {latestNotif.type !== 'CLOSED' && (
            <div className="flex items-center justify-between bg-slate-950/90 border border-slate-800 px-2.5 py-1.5 rounded-lg text-[10px]">
              <span className="text-emerald-400 font-bold flex items-center gap-1">
                <Target className="w-3 h-3" />
                <span>PROBABILITY: {analysis?.probability ?? analysis?.trade_params?.probability ?? 84}%</span>
              </span>
              <span className="text-amber-300 font-mono font-bold flex items-center gap-1">
                <Target className="w-3 h-3 text-amber-400" />
                <span>
                  {displaySL === displayEntry ? '🛡️ BE LOCKED' : '🎯 TARGET'}: TP1 ${displayTp1.toFixed(precision)}
                  <span className="text-slate-400 font-normal ml-1">
                    ({isBuyTrade
                      ? `${(currentPrice || displayEntry) - displayEntry >= 0 ? '+' : ''}${((currentPrice || displayEntry) - displayEntry).toFixed(precision)}`
                      : `${displayEntry - (currentPrice || displayEntry) >= 0 ? '+' : ''}${(displayEntry - (currentPrice || displayEntry)).toFixed(precision)}`} pts)
                  </span>
                </span>
              </span>
            </div>
          )}

          {/* Runaway Trend Points Calculator & Precedence Override Banner */}
          {latestNotif.type !== 'CLOSED' && analysis?.runaway_trend && (
            <div
              className={`px-2.5 py-2 rounded-lg border text-[10px] font-mono space-y-1 transition-all ${
                analysis.runaway_trend.detected
                  ? analysis.runaway_trend.direction === 'BEARISH'
                    ? 'bg-rose-950/90 border-rose-500 text-rose-200 shadow-lg shadow-rose-950/50'
                    : 'bg-emerald-950/90 border-emerald-500 text-emerald-200 shadow-lg shadow-emerald-950/50'
                  : 'bg-slate-950/80 border-slate-800 text-slate-300'
              }`}
            >
              <div className="flex items-center justify-between font-bold">
                <span className="flex items-center gap-1">
                  <Zap
                    className={`w-3.5 h-3.5 ${
                      analysis.runaway_trend.detected
                        ? 'text-amber-300 animate-pulse'
                        : 'text-slate-400'
                    }`}
                  />
                  <span>
                    {analysis.runaway_trend.detected
                      ? `⚡ INSTITUTIONAL MOMENTUM (${analysis.runaway_trend.direction})`
                      : 'INSTITUTIONAL STRUCTURE SENTINEL'}
                  </span>
                </span>
                <span
                  className={`px-1.5 py-0.5 rounded text-[9px] font-extrabold ${
                    analysis.runaway_trend.detected
                      ? 'bg-amber-500 text-slate-950'
                      : 'bg-slate-900 text-slate-400 border border-slate-700'
                  }`}
                >
                  {analysis.runaway_trend.detected
                    ? `${analysis.runaway_trend.intensity_ratio}x IMPULSE`
                    : 'STRUCTURE LOCKED'}
                </span>
              </div>
              <div className="flex items-center justify-between text-[9px] pt-0.5 border-t border-slate-800/80">
                <span>
                  Move:{' '}
                  <strong
                    className={
                      analysis.runaway_trend.points_moved < 0
                        ? 'text-rose-300'
                        : 'text-emerald-300'
                    }
                  >
                    {analysis.runaway_trend.points_moved > 0 ? '+' : ''}
                    {analysis.runaway_trend.points_moved.toFixed(precision)} pts
                  </strong>
                </span>
                <span>
                  Velocity Threshold [{timeframe.toUpperCase()}]:{' '}
                  <strong className="text-amber-300">
                    ±{analysis.runaway_trend.threshold_pts.toFixed(precision)} pts
                  </strong>
                </span>
              </div>
              {analysis.runaway_trend.detected ? (
                <div className="text-[9px] text-amber-200 font-sans leading-tight pt-0.5">
                  ⚡ High-velocity momentum actively aligned with institutional {analysis.runaway_trend.direction === 'BEARISH' ? 'Short' : 'Long'} order flow toward TP1. Intra-candle noise is filtered; structure remains protected!
                </div>
              ) : (
                <div className="text-[9px] text-slate-400 font-sans leading-tight pt-0.5">
                  🛡️ Forecast locked to multi-candle SMC structure. Normal intra-candle fluctuations will NOT flip the forecast — only a confirmed body close CHoCH can break structure.
                </div>
              )}
            </div>
          )}

          <div>
            <h3 className="text-xs font-bold text-white leading-snug">
              {latestNotif.type === 'CLOSED'
                ? latestNotif.title
                : analysis?.signal_type === 'BUY/LONG'
                ? `🟢 BUY NOW! [${timeframe.toUpperCase()}] ENTRY FOR ${symbol}`
                : analysis?.signal_type === 'SELL/SHORT'
                ? `🔴 SELL NOW! [${timeframe.toUpperCase()}] SHORT FOR ${symbol}`
                : `⏸️ MARKET STANDBY [${timeframe.toUpperCase()}] FOR ${symbol}`}
            </h3>
            <p className="text-[11px] text-slate-300 mt-1 leading-snug">
              {latestNotif.type === 'CLOSED'
                ? latestNotif.message
                : analysis?.trade_params?.rationale
                ? analysis.trade_params.rationale
                : analysis?.signal_type === 'BUY/LONG'
                ? `Bullish Momentum / Demand on ${timeframe} timeframe at $${displayEntry.toFixed(precision)}. Stop Loss: $${displaySL.toFixed(precision)}`
                : analysis?.signal_type === 'SELL/SHORT'
                ? `Bearish Momentum / Rejection on ${timeframe} timeframe at $${displayEntry.toFixed(precision)}. Stop Loss: $${displaySL.toFixed(precision)}`
                : `Consolidation on ${timeframe}. Monitoring market for high-probability setups.`}
            </p>
          </div>

          {/* Trade Parameters — FROZEN (constant across polls, always visible for all pairs) */}
          <div className="space-y-2 pt-2 border-t border-slate-800 text-[11px]">

            {/* Stop Loss — dynamically sized from Risk Calculator ($40 vs $1000 Balance) */}
            <div className="bg-slate-950/80 px-2 py-1.5 rounded border border-rose-950 space-y-0.5">
              <div className="flex justify-between items-center">
                <span className="text-rose-400 font-bold flex items-center gap-1">
                  <Shield className="w-3 h-3" /> STOP LOSS (RISK-SIZED):
                </span>
                <span className="text-rose-300 font-bold font-mono">${displaySL.toFixed(precision)}</span>
              </div>
              <div className="flex justify-between text-[9px] text-slate-400 font-mono">
                <span>Bal: ${accountBalance} · {lotSize} Lot · {riskPercent}% Risk</span>
                <span className="text-rose-400 flex items-center gap-1">
                  <span>Dist: {liveRiskCalc.slDistance.toFixed(precision)} (-${liveRiskCalc.actualDollarRisk.toFixed(2)})</span>
                  {liveRiskCalc.slDistance >= 3.8 && symbol.toUpperCase().includes('XAU') && (
                    <span className="text-emerald-400 text-[8px] bg-emerald-950/80 px-1 rounded border border-emerald-800" title="Protected against broker spread & 1m tick fluctuations">
                      🛡️ Wick Shield
                    </span>
                  )}
                </span>
              </div>
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

            {/* INSTITUTIONAL SMC: FAIR VALUE GAPS (FVG), TREND REVERSAL ZONES & "TAKE MONEY" PROFIT MAXIMIZER */}
            {(() => {
              const smc = (analysis as any)?.smc_principles || (analysis?.trade_params as any)?.smc_principles;
              const supp = analysis?.support ?? Number((displayEntry - liveRiskCalc.slDistance * 1.5).toFixed(precision));
              const res = analysis?.resistance ?? Number((displayEntry + liveRiskCalc.slDistance * 1.5).toFixed(precision));
              const bullFvgBottom = smc?.bullishFvg?.bottom ?? supp;
              const bullFvgTop = smc?.bullishFvg?.top ?? Number((supp + liveRiskCalc.slDistance * 0.4).toFixed(precision));
              const bearFvgBottom = smc?.bearishFvg?.bottom ?? Number((res - liveRiskCalc.slDistance * 0.4).toFixed(precision));
              const bearFvgTop = smc?.bearishFvg?.top ?? res;
              const rangePct = smc?.dealingRange?.positionPct ?? analysis?.price_position_pct ?? 50;
              const breakevenAt = smc?.profitMaximizer?.breakevenTriggerPrice ?? Number((isSellTrade ? displayEntry - liveRiskCalc.slDistance * 0.65 : displayEntry + liveRiskCalc.slDistance * 0.65).toFixed(precision));
              const reversalZone = isSellTrade ? bullFvgTop : bearFvgBottom;
              const tp1Dollars = Number((liveRiskCalc.actualDollarRisk * 1.15).toFixed(2));

              return (
                <div className="bg-slate-950/95 px-2.5 py-2 rounded-lg border border-indigo-800/80 space-y-1.5 font-mono text-[9.5px]">
                  <div className="flex items-center justify-between border-b border-indigo-900/70 pb-1">
                    <span className="text-indigo-300 font-extrabold flex items-center gap-1">
                      <Target className="w-3 h-3 text-amber-400" />
                      <span>FAIR VALUE GAPS (FVG) &amp; TAKE MONEY ENGINE</span>
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-indigo-950 border border-indigo-700 text-indigo-200 text-[8.5px] font-bold">
                      {rangePct}% Range
                    </span>
                  </div>

                  {/* Bullish & Bearish Fair Value Gaps */}
                  <div className="grid grid-cols-2 gap-1.5">
                    <div className="bg-emerald-950/50 border border-emerald-800/70 rounded px-1.5 py-1">
                      <div className="text-[8px] text-emerald-400 font-bold">BULLISH FVG (DEMAND BUY)</div>
                      <div className="text-emerald-200 font-bold">
                        ${bullFvgBottom.toFixed(precision)} – ${bullFvgTop.toFixed(precision)}
                      </div>
                      <div className="text-[8px] text-slate-400">
                        {rangePct <= 38 ? '⚡ ACTIVE BUY BOUNCE ZONE' : 'Buy on Pullback / Take Sell Profit'}
                      </div>
                    </div>
                    <div className="bg-rose-950/50 border border-rose-800/70 rounded px-1.5 py-1">
                      <div className="text-[8px] text-rose-400 font-bold">BEARISH FVG (SUPPLY SELL)</div>
                      <div className="text-rose-200 font-bold">
                        ${bearFvgBottom.toFixed(precision)} – ${bearFvgTop.toFixed(precision)}
                      </div>
                      <div className="text-[8px] text-slate-400">
                        {rangePct >= 62 ? '⚡ ACTIVE SELL REJECT ZONE' : 'Sell on Rally / Take Buy Profit'}
                      </div>
                    </div>
                  </div>

                  {/* Trend Exhaustion & Profit-Taking Action Plan */}
                  <div className="bg-amber-950/40 border border-amber-700/60 rounded px-2 py-1.5 space-y-1 font-sans">
                    <div className="text-[9px] font-extrabold text-amber-300 flex items-center justify-between">
                      <span>💰 TAKE MONEY &amp; TREND REVERSAL PLAN ({timeframe.toUpperCase()}):</span>
                      <span className="font-mono text-emerald-300">TP1: +${tp1Dollars.toFixed(2)}</span>
                    </div>
                    <div className="text-[9px] text-slate-200 leading-snug space-y-0.5">
                      <div>
                        1. <strong>Breakeven Lock:</strong> Move SL to Entry (${displayEntry.toFixed(precision)}) once price hits <strong>${breakevenAt.toFixed(precision)}</strong>.
                      </div>
                      <div>
                        2. <strong>Take Money at TP1:</strong> Harvest 50–100% profit at <strong>${displayTp1.toFixed(precision)}</strong> (+${tp1Dollars.toFixed(2)}).
                      </div>
                      <div>
                        3. <strong>Trend Reversal Point:</strong> If trend reaches <strong>${reversalZone.toFixed(precision)}</strong> ({isSellTrade ? 'Demand FVG' : 'Supply FVG'}), take all profit &amp; prepare to <strong>{isSellTrade ? 'BUY' : 'SELL'}</strong>!
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={mt5Cancelling}
                      onClick={() => handleCancelOrCloseTrade(false)}
                      className="w-full mt-1 py-1 px-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-[9.5px] font-black rounded border border-emerald-400 transition flex items-center justify-center gap-1"
                    >
                      <span>💰 TAKE MONEY NOW (Close Open {symbol} Trade &amp; Lock Profit)</span>
                    </button>
                  </div>
                </div>
              );
            })()}
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

          {/* Quick Auto-Fill Execution Button — always shown */}
          {onExecuteTradeParams && (
            <button
              onClick={() =>
                onExecuteTradeParams({
                  signal_type: isSellTrade ? 'SELL/SHORT' : 'BUY/LONG',
                  entry: displayEntry,
                  stop_loss: displaySL,
                  tp1: displayTpLevels[selectedTpIndex] ?? displayTp1,
                  tp2: displayTpLevels[3] ?? displayTp2,
                  tp_levels: displayTpLevels,
                  entry_zones: displayEntryZones,
                })
              }
              className={`w-full py-2 text-white text-xs font-bold rounded-lg shadow-lg transition flex items-center justify-center gap-1.5 ${
                isSellTrade
                  ? 'bg-rose-600 hover:bg-rose-500'
                  : 'bg-emerald-600 hover:bg-emerald-500'
              }`}
            >
              <Play className="w-3.5 h-3.5 fill-white" />
              <span>Auto-Fill Paper Order ({latestNotif.timeframe}) — TP{selectedTpIndex + 1}</span>
            </button>
          )}
          
          {latestNotif.type === 'CLOSED' && (
            <div className="bg-slate-950/90 border border-slate-700/60 p-2 rounded-lg text-[9.5px] text-slate-400 font-sans text-center">
              Weekend session for OTC/Forex (Crypto 24/7 active on Exness MT5).
            </div>
          )}
          
        </div>
      )}

      {/* Vertical Navigation Signal Feed History (Stretches down to bottom) */}
      <div className="flex-1 min-h-[180px] flex flex-col space-y-2 shrink-0">
        <h4 className="text-[11px] font-bold text-slate-400 font-sans uppercase tracking-wider border-b border-slate-800 pb-1 shrink-0">
          Live Action History Log
        </h4>
        <div className="max-h-[340px] overflow-y-auto space-y-2 pr-1.5 scrollbar-navigator">
          {notifications.slice(1).map((item) => (
            <div
              key={item.id}
              className="bg-slate-950 border border-slate-800/80 rounded-lg p-2.5 space-y-1 text-[11px] transition hover:border-slate-700"
            >
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-slate-500">{item.time_harare}</span>
                <span
                  className={`px-1.5 py-0.5 rounded font-bold ${
                    item.type === 'CLOSED'
                      ? 'bg-slate-900 text-slate-400 border border-slate-700'
                      : item.type === 'BUY_NOW'
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
