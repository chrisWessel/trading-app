'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Bot,
  Play,
  Pause,
  Square,
  ShieldCheck,
  ShieldAlert,
  Zap,
  TrendingUp,
  TrendingDown,
  DollarSign,
  RefreshCw,
  X,
  Minimize2,
  Maximize2,
  Lock,
  ArrowUpRight,
  ArrowDownRight,
  CheckCircle2,
  AlertTriangle,
  Activity,
  Volume2,
  VolumeX,
  Trophy,
  Target,
  Briefcase,
  Server,
} from 'lucide-react';
import {
  fetchBrowserLiveBars,
  computeBrowserSignalAnalysis,
  calculateRiskBasedLevels,
  type SMCPrinciplesSummary,
} from '@/lib/browserFallbackEngine';

const MT5_LOCAL_TOKEN =
  'wessignal_mt5_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a';

export interface ActiveBotTrade {
  id: string;
  ticket?: number;
  isRealMt5: boolean;
  symbol: string;
  direction: 'BUY' | 'SELL';
  volume: number;
  entryPrice: number;
  currentPrice: number;
  hardBrokerSl: number;
  softStructureSl: number;
  breakevenTriggerPrice: number;
  tp1Price: number;
  tp2Price: number;
  floatingPnlDollars: number;
  pointsMoved: number;
  openedAtMs: number;
  breakevenLocked: boolean;
  status: 'OPEN' | 'CLOSED_PROFIT' | 'CLOSED_STOP' | 'CLOSED_MANUAL';
}

export interface AIDirectiveLogItem {
  id: string;
  time: string;
  actionType:
    | 'AUTO_ENTER'
    | 'HOLD_SHIELD'
    | 'LOCK_BREAKEVEN'
    | 'TAKE_PROFIT'
    | 'STOP_REVERSE'
    | 'HUMAN_INTERVENE'
    | 'GOAL_ACHIEVED';
  headline: string;
  detail: string;
  pnlDollars?: number;
}

interface AutonomousBotLiveWindowProps {
  symbol: string;
  timeframe: string;
  currentPrice?: number;
  isOpen: boolean;
  onClose: () => void;
  onOpen: () => void;
  initialBalance?: number;
  onSelectSymbol?: (symbol: string) => void;
}

export default function AutonomousBotLiveWindow({
  symbol,
  timeframe,
  currentPrice,
  isOpen,
  onClose,
  onOpen,
  initialBalance,
  onSelectSymbol,
}: AutonomousBotLiveWindowProps) {
  // Autonomous Bot State — Autopilot is strictly OFF by default to prevent accidental executions
  const [autopilotEnabled, setAutopilotEnabled] = useState<boolean>(false);
  const [pipMinimized, setPipMinimized] = useState<boolean>(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [isExecutingAction, setIsExecutingAction] = useState<boolean>(false);
  const [statusBanner, setStatusBanner] = useState<string>(
    'AI Bot Standing By (Manual / Safe Mode) — Click "START FULL AI AUTOPILOT" to allow hands-free auto-trading.'
  );

  // Synced Risk Calculator & Signal State
  const [accountBalance, setAccountBalance] = useState<number>(() => {
    if (initialBalance !== undefined && initialBalance > 0) return initialBalance;
    if (typeof window !== 'undefined') {
      const s = localStorage.getItem('wessignal_last_mt5_balance');
      if (s) {
        const n = parseFloat(s);
        if (!isNaN(n) && n > 0) return n;
      }
    }
    return 7.59;
  });
  const [accountLeverage, setAccountLeverage] = useState<number>(400);
  const [liveMt5Equity, setLiveMt5Equity] = useState<number | null>(null);
  const [lotSize, setLotSize] = useState<number>(0.01);
  const [riskPercent, setRiskPercent] = useState<number>(2.0);
  const [livePrice, setLivePrice] = useState<number>(currentPrice || 3909.1);
  const [signalDirection, setSignalDirection] = useState<'BUY' | 'SELL'>('BUY');
  const [signalConfidence, setSignalConfidence] = useState<number>(93);
  const [smcSummary, setSmcSummary] = useState<SMCPrinciplesSummary | null>(null);

  // Worker Algorithm: Daily Profit Target Sentinel State
  const getTodayDateKey = (): string => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const [workerGoalEnabled, setWorkerGoalEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('wessignal_worker_goal_enabled');
      return v === null ? true : v === 'true';
    }
    return true;
  });

  const [dailyProfitTarget, setDailyProfitTarget] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('wessignal_daily_profit_target');
      if (v) {
        const num = parseFloat(v);
        if (!isNaN(num) && num > 0) return num;
      }
    }
    return 10.0; // Default $10.00 daily worker quota
  });

  const [customTargetInput, setCustomTargetInput] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('wessignal_daily_profit_target');
      if (v) return v;
    }
    return '10';
  });

  // Active MT5 / Mimic Trade State — synchronized per day
  const [activeTrade, setActiveTrade] = useState<ActiveBotTrade | null>(null);
  const [closedTradesCount, setClosedTradesCount] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      if (localStorage.getItem('wessignal_session_profit_date') === getTodayDateKey()) {
        const c = localStorage.getItem('wessignal_session_closed_trades');
        if (c) return parseInt(c, 10) || 0;
      }
    }
    return 0;
  });
  const [winsCount, setWinsCount] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      if (localStorage.getItem('wessignal_session_profit_date') === getTodayDateKey()) {
        const w = localStorage.getItem('wessignal_session_wins');
        if (w) return parseInt(w, 10) || 0;
      }
    }
    return 0;
  });
  const [sessionRealizedPnl, setSessionRealizedPnl] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      if (localStorage.getItem('wessignal_session_profit_date') === getTodayDateKey()) {
        const savedPnl = localStorage.getItem('wessignal_session_realized_pnl');
        if (savedPnl) {
          const num = parseFloat(savedPnl);
          if (!isNaN(num)) return num;
        }
      }
    }
    return 0;
  });

  const isDailyGoalAchieved = workerGoalEnabled && dailyProfitTarget > 0 && sessionRealizedPnl >= dailyProfitTarget;

  const saveSessionProfit = (pnl: number, closed?: number, wins?: number) => {
    if (typeof window !== 'undefined') {
      const today = getTodayDateKey();
      localStorage.setItem('wessignal_session_profit_date', today);
      localStorage.setItem('wessignal_session_realized_pnl', String(pnl));
      if (closed !== undefined) localStorage.setItem('wessignal_session_closed_trades', String(closed));
      if (wins !== undefined) localStorage.setItem('wessignal_session_wins', String(wins));
      window.dispatchEvent(
        new CustomEvent('wessignal-worker-goal-update', {
          detail: {
            workerGoalEnabled,
            dailyProfitTarget,
            sessionRealizedPnl: pnl,
            isGoalAchieved: workerGoalEnabled && dailyProfitTarget > 0 && pnl >= dailyProfitTarget,
          },
        })
      );
    }
  };

  // Live AI Directive Brain Stream ("AI telling us what to do & doing it automatically")
  const [aiCurrentCommand, setAiCurrentCommand] = useState<{
    badge: 'HOLD / RIDE TREND' | 'WICK SHIELD ACTIVE' | 'LOCKING BREAKEVEN' | 'TAKE MONEY NOW' | 'STOP & EXIT NOW' | 'SCANNING ENTRY' | 'DAILY GOAL MET';
    color: 'emerald' | 'blue' | 'amber' | 'rose';
    title: string;
    explanation: string;
  }>({
    badge: 'SCANNING ENTRY',
    color: 'blue',
    title: 'AI Scanning Institutional FVG & Swing Structure...',
    explanation:
      'Waiting for high-probability SMC/FVG alignment. Small-account Anti-Wick Shield ($3.80+ breathing room) is active.',
  });

  const [directiveLogs, setDirectiveLogs] = useState<AIDirectiveLogItem[]>([]);

  const activeTradeRef = useRef<ActiveBotTrade | null>(null);
  const autopilotRef = useRef<boolean>(false);
  const runBotBrainCycleRef = useRef<(() => void) | null>(null);
  const lastAutoEntryMsRef = useRef<number>(0);
  const lastAutoActionMsRef = useRef<number>(0);
  const lastLogHeadlineRef = useRef<string>('');

  useEffect(() => {
    activeTradeRef.current = activeTrade;
  }, [activeTrade]);

  useEffect(() => {
    autopilotRef.current = autopilotEnabled;
  }, [autopilotEnabled]);

  useEffect(() => {
    if (currentPrice && currentPrice > 0) {
      setLivePrice(currentPrice);
    }
  }, [currentPrice]);

  const getPrecision = (sym: string): number => {
    const s = sym.toUpperCase();
    if (s.includes('JPY')) return 3;
    if (
      s.includes('XAU') ||
      s.includes('GOLD') ||
      s.includes('XAG') ||
      s.includes('OIL') ||
      s.includes('BTC') ||
      s.includes('ETH') ||
      s.includes('SOL') ||
      s.includes('BNB') ||
      s.includes('US30') ||
      s.includes('NAS') ||
      s.includes('SPX') ||
      s.includes('GER')
    ) {
      return 2;
    }
    return 5;
  };

  const precision = getPrecision(symbol);

  const getContractMultiplier = (sym: string): number => {
    const s = sym.toUpperCase();
    if (s.includes('XAU') || s.includes('GOLD')) return 100.0;
    if (s.includes('XAG')) return 5000.0;
    if (s.includes('OIL')) return 1000.0;
    if (s.includes('BTC') || s.includes('ETH') || s.includes('SOL') || s.includes('BNB')) return 1.0;
    if (s.includes('US30') || s.includes('NAS') || s.includes('SPX') || s.includes('GER')) return 1.0;
    if (s.includes('JPY')) return 1000.0;
    return 100000.0;
  };

  const playBeep = useCallback(
    (freq = 780, isWarn = false) => {
      if (!soundEnabled || typeof window === 'undefined') return;
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = isWarn ? 'sawtooth' : 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        gain.gain.setValueAtTime(0.05, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.25);
      } catch {}
    },
    [soundEnabled]
  );

  const playVictoryChime = useCallback(() => {
    if (!soundEnabled || typeof window === 'undefined') return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const notes = [523.25, 659.25, 783.99, 1046.50]; // Celebratory C Major Arpeggio
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.12);
        gain.gain.setValueAtTime(0.08, ctx.currentTime + idx * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.12 + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + idx * 0.12);
        osc.stop(ctx.currentTime + idx * 0.12 + 0.35);
      });
    } catch {}
  }, [soundEnabled]);

  const handleSelectPresetTarget = (targetVal: number) => {
    setDailyProfitTarget(targetVal);
    setCustomTargetInput(String(targetVal));
    if (typeof window !== 'undefined') {
      localStorage.setItem('wessignal_daily_profit_target', String(targetVal));
      window.dispatchEvent(
        new CustomEvent('wessignal-worker-goal-update', {
          detail: {
            workerGoalEnabled,
            dailyProfitTarget: targetVal,
            sessionRealizedPnl,
            isGoalAchieved: workerGoalEnabled && targetVal > 0 && sessionRealizedPnl >= targetVal,
          },
        })
      );
    }
  };

  const handleCustomTargetChange = (raw: string) => {
    const clean = raw.replace(/[^0-9.]/g, '');
    setCustomTargetInput(clean);
    const num = parseFloat(clean);
    if (!isNaN(num) && num > 0) {
      setDailyProfitTarget(num);
      if (typeof window !== 'undefined') {
        localStorage.setItem('wessignal_daily_profit_target', String(num));
        window.dispatchEvent(
          new CustomEvent('wessignal-worker-goal-update', {
            detail: {
              workerGoalEnabled,
              dailyProfitTarget: num,
              sessionRealizedPnl,
              isGoalAchieved: workerGoalEnabled && num > 0 && sessionRealizedPnl >= num,
            },
          })
        );
      }
    }
  };

  const handleCustomTargetBlur = () => {
    const num = parseFloat(customTargetInput);
    if (isNaN(num) || num <= 0) {
      setCustomTargetInput(String(dailyProfitTarget));
    } else {
      setDailyProfitTarget(num);
      setCustomTargetInput(String(num));
      if (typeof window !== 'undefined') {
        localStorage.setItem('wessignal_daily_profit_target', String(num));
      }
    }
  };

  const appendDirectiveLog = useCallback(
    (
      actionType: AIDirectiveLogItem['actionType'],
      headline: string,
      detail: string,
      pnlDollars?: number
    ) => {
      if (lastLogHeadlineRef.current === headline) return;
      lastLogHeadlineRef.current = headline;
      const nowStr = new Date().toLocaleTimeString('en-US', {
        timeZone: 'Africa/Harare',
        hour12: true,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      setDirectiveLogs((prev) => [
        {
          id: Math.random().toString(36).substring(2, 9),
          time: nowStr,
          actionType,
          headline,
          detail,
          pnlDollars,
        },
        ...prev.slice(0, 39),
      ]);
    },
    []
  );

  // Listen for live risk parameters & external order events from LiveSignalNotificationPanel
  useEffect(() => {
    const onLiveParams = (e: Event) => {
      const d = (e as CustomEvent)?.detail;
      if (!d) return;
      if (d.direction === 'BUY' || d.direction === 'SELL') setSignalDirection(d.direction);
      if (typeof d.accountBalance === 'number' && d.accountBalance > 0) setAccountBalance(d.accountBalance);
      if (typeof d.lotSize === 'number' && d.lotSize > 0) setLotSize(d.lotSize);
      if (typeof d.riskPercent === 'number' && d.riskPercent > 0) setRiskPercent(d.riskPercent);
      if (typeof d.probability === 'number' && d.probability > 0) setSignalConfidence(d.probability);
    };
    const onOpenBotWindow = () => {
      // Opening the window is strictly for observation / manual control. Never auto-arm autopilot!
      onOpen();
    };
    window.addEventListener('wessignal-live-params', onLiveParams);
    window.addEventListener('wessignal-open-bot-window', onOpenBotWindow);
    return () => {
      window.removeEventListener('wessignal-live-params', onLiveParams);
      window.removeEventListener('wessignal-open-bot-window', onOpenBotWindow);
    };
  }, [onOpen]);

  // Execute Order on MT5 + Create Synchronized Live Mimic Trade
  const executeBotOrder = useCallback(
    async (
      dir: 'BUY' | 'SELL',
      entryHint: number,
      swingLow?: number,
      swingHigh?: number,
      atr?: number,
      reasonLabel = 'AI Autopilot High-Confluence Entry'
    ) => {
      if (isExecutingAction) return;

      // HARD SAFETY GATE: If this is an automated entry, strictly require autopilot to be ACTIVE
      if (reasonLabel.toLowerCase().includes('autopilot') && !autopilotRef.current) {
        console.warn('⛔ [BLOCKED AUTO-ENTRY]: Autopilot is strictly OFF. No order was sent.');
        return;
      }

      setIsExecutingAction(true);
      try {
        const levels = calculateRiskBasedLevels({
          symbol,
          entryPrice: entryHint,
          isBuy: dir === 'BUY',
          accountBalance,
          lotSize,
          riskPercent,
          precision,
          structuralSwingLow: swingLow,
          structuralSwingHigh: swingHigh,
          atr,
        });

        // Soft Structure SL sits right beyond the Swing Low/High (watched on candle close after 12s grace)
        const isGold = symbol.toUpperCase().includes('XAU') || symbol.toUpperCase().includes('GOLD');
        const maxSoftDollars = accountBalance <= 15 ? 0.75 : accountBalance <= 30 ? 1.25 : 1.80;
        const softDist = isGold
          ? Math.min(maxSoftDollars, Math.max(0.60, levels.slDistance * 0.45))
          : Math.min(entryHint * 0.0015, Math.max(entryHint * 0.0006, levels.slDistance * 0.50));
        const softSl = Number(
          (dir === 'BUY' ? entryHint - softDist : entryHint + softDist).toFixed(precision)
        );
        const beTrigger = Number(
          (dir === 'BUY'
            ? entryHint + (levels.tp1 - entryHint) * 0.55
            : entryHint - (entryHint - levels.tp1) * 0.55
          ).toFixed(precision)
        );

        const payload = {
          mode: 'place_order',
          symbol,
          action: dir,
          volume: lotSize,
          stop_loss: levels.stopLoss,
          take_profit: levels.tp1,
          timeframe,
          dry_run: false,
          confirmed: true,
        };

        let mt5Result: any = null;
        const isLocalhost =
          typeof window !== 'undefined' &&
          (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

        if (isLocalhost) {
          try {
            const localRes = await fetch('http://127.0.0.1:8001/webhook/mt5', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${MT5_LOCAL_TOKEN}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(payload),
            });
            mt5Result = await localRes.json();
          } catch (err: any) {
            mt5Result = { status: 'error', retcode_name: `Local Port 8001 error: ${err?.message || 'Check terminal'}` };
          }
        } else {
          try {
            const apiRes = await fetch('/api/mt5', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            mt5Result = await apiRes.json();
          } catch (err: any) {
            mt5Result = { status: 'error', retcode_name: `API error: ${err?.message || 'Network timeout'}` };
          }
        }

        const fillPrice =
          mt5Result?.executed_price && Number(mt5Result.executed_price) > 0
            ? Number(mt5Result.executed_price)
            : entryHint;
        const actualHardSl =
          mt5Result?.sl && Number(mt5Result.sl) > 0 ? Number(mt5Result.sl) : levels.stopLoss;
        const actualTp1 =
          mt5Result?.tp && Number(mt5Result.tp) > 0 ? Number(mt5Result.tp) : levels.tp1;
        const isReal = mt5Result?.status === 'executed';

        // STRICT REAL EXECUTION INTEGRITY:
        // If MT5 rejected the order (e.g. insufficient margin, market closed, etc.), NEVER create a ghost simulation!
        if (!isReal) {
          const retName = mt5Result?.retcode_name || mt5Result?.volumetric_fallback_note || mt5Result?.broker_comment || 'Order rejected by broker';
          const isNoMoney = String(retName).toLowerCase().includes('no money') || mt5Result?.retcode === 10019;
          const userHint = isNoMoney
            ? `⚠️ Exness rejected 0.01 ${symbol}: Insufficient margin ($${accountBalance.toFixed(2)} free vs ~$10.29 required). Increase account leverage to 1:1000/1:2000 in Exness Personal Area, or trade EUR/USD (only $2.71 margin needed)!`
            : `⚠️ MT5 Order Rejected: ${retName}. Real trade was NOT opened on Exness.`;

          setStatusBanner(userHint);
          setAiCurrentCommand({
            badge: 'SCANNING ENTRY',
            color: 'rose',
            title: `❌ MT5 ORDER REJECTED: ${isNoMoney ? 'Insufficient Margin (Need $10.29)' : retName}`,
            explanation: userHint,
          });
          appendDirectiveLog(
            'HUMAN_INTERVENE',
            `❌ ${dir} ${symbol} REJECTED BY EXNESS: ${retName}`,
            userHint
          );
          return;
        }

        const newTrade: ActiveBotTrade = {
          id: Math.random().toString(36).substring(2, 9),
          ticket: mt5Result?.deal_ticket || mt5Result?.order_ticket,
          isRealMt5: true,
          symbol,
          direction: dir,
          volume: lotSize,
          entryPrice: fillPrice,
          currentPrice: fillPrice,
          hardBrokerSl: actualHardSl,
          softStructureSl: softSl,
          breakevenTriggerPrice: beTrigger,
          tp1Price: actualTp1,
          tp2Price: levels.tp2,
          floatingPnlDollars: 0,
          pointsMoved: 0,
          openedAtMs: Date.now(),
          breakevenLocked: false,
          status: 'OPEN',
        };

        setActiveTrade(newTrade);
        lastAutoEntryMsRef.current = Date.now();
        playBeep(880, false);

        setStatusBanner(
          `✅ ${dir} ${symbol} Opened @ $${fillPrice.toFixed(precision)} (MT5 Deal #${newTrade.ticket || 'LIVE'}) — Anti-Wick Shield Active!`
        );
        appendDirectiveLog(
          'AUTO_ENTER',
          `🚀 ${dir} ${symbol} EXECUTED @ $${fillPrice.toFixed(precision)} (${lotSize} Lot)`,
          `${reasonLabel}. Hard Catastrophe SL placed safely at $${actualHardSl.toFixed(precision)} | Target TP1: $${actualTp1.toFixed(precision)}.`
        );
      } finally {
        setIsExecutingAction(false);
      }
    },
    [
      isExecutingAction,
      symbol,
      accountBalance,
      lotSize,
      riskPercent,
      precision,
      timeframe,
      playBeep,
      appendDirectiveLog,
    ]
  );

  // Close Active Trade (MT5 + Live Mimic)
  const closeActiveBotTrade = useCallback(
    async (
      reason: 'TAKE_PROFIT' | 'STOP_REVERSE' | 'HUMAN_INTERVENE',
      explanation: string
    ) => {
      const current = activeTradeRef.current;
      setIsExecutingAction(true);
      try {
        // Always send close command to MT5 Bridge for this symbol in case a real position is open
        try {
          await fetch('http://127.0.0.1:8001/bridge/cancel-close', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${MT5_LOCAL_TOKEN}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ symbol, close_all: false }),
          });
        } catch {
          try {
            await fetch('/api/mt5', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ mode: 'cancel_close', symbol, close_all: false }),
            });
          } catch {}
        }

        if (current) {
          const pnl = current.floatingPnlDollars;
          const newRealized = Number((sessionRealizedPnl + pnl).toFixed(2));
          const newClosed = closedTradesCount + 1;
          const newWins = pnl >= 0 ? winsCount + 1 : winsCount;
          setClosedTradesCount(newClosed);
          if (pnl >= 0) setWinsCount(newWins);
          setSessionRealizedPnl(newRealized);
          setAccountBalance((prev) => Number((prev + pnl).toFixed(2)));
          saveSessionProfit(newRealized, newClosed, newWins);

          setActiveTrade(null);
          playBeep(pnl >= 0 ? 960 : 480, pnl < 0);

          if (reason === 'STOP_REVERSE') {
            // Immediate eligibility to catch the new reversed trend direction
            lastAutoEntryMsRef.current = 0;
          }

          // Check if Worker Daily Profit Target was reached!
          if (workerGoalEnabled && dailyProfitTarget > 0 && newRealized >= dailyProfitTarget) {
            setAutopilotEnabled(false);
            autopilotRef.current = false;
            playVictoryChime();
            const goalTitle = `🏆 DAILY GOAL ACHIEVED: Banked +$${newRealized.toFixed(2)} (Target: $${dailyProfitTarget.toFixed(2)})`;
            const goalExpl = `Daily profit target reached! The Worker Bot has finished its job for today and safely shut down to protect your banked profits.`;
            setStatusBanner(`${goalTitle} — ${goalExpl}`);
            appendDirectiveLog('GOAL_ACHIEVED', goalTitle, goalExpl, newRealized);
            return;
          }

          const title =
            reason === 'TAKE_PROFIT'
              ? `💰 AI AUTO-HARVESTED PROFIT: ${ pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} on ${current.symbol}`
              : reason === 'STOP_REVERSE'
              ? `🛑 AI AUTO-STOP EXECUTED (${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)})`
              : `⚡ MANUAL INTERVENTION CLOSE (${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)})`;

          setStatusBanner(`${title} — ${explanation}`);
          appendDirectiveLog(reason, title, explanation, pnl);
        } else {
          setStatusBanner(`✅ Closed any open ${symbol} trades on MT5. ${explanation}`);
        }
      } finally {
        setIsExecutingAction(false);
      }
    },
    [
      symbol,
      sessionRealizedPnl,
      closedTradesCount,
      winsCount,
      workerGoalEnabled,
      dailyProfitTarget,
      playBeep,
      playVictoryChime,
      appendDirectiveLog,
    ]
  );

  // Move Open Position Stop Loss to Breakeven (MT5 + Live Mimic)
  const lockBreakevenOnActiveTrade = useCallback(
    async (isAuto = true) => {
      const current = activeTradeRef.current;
      if (!current || current.breakevenLocked) return;

      const isGold = symbol.toUpperCase().includes('XAU') || symbol.toUpperCase().includes('GOLD');
      const profitPad = isGold ? 0.25 : current.entryPrice * 0.0002;
      const newBeSl = Number(
        (current.direction === 'BUY'
          ? current.entryPrice + profitPad
          : current.entryPrice - profitPad
        ).toFixed(precision)
      );

      if (current.ticket) {
        try {
          await fetch('http://127.0.0.1:8001/bridge/modify-position', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${MT5_LOCAL_TOKEN}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              ticket: current.ticket,
              sl: newBeSl,
              tp: current.tp1Price,
              move_to_breakeven: true,
            }),
          });
        } catch {
          try {
            await fetch('/api/mt5', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                mode: 'modify_position',
                ticket: current.ticket,
                sl: newBeSl,
                tp: current.tp1Price,
                move_to_breakeven: true,
              }),
            });
          } catch {}
        }
      }

      setActiveTrade((prev) =>
        prev
          ? {
              ...prev,
              hardBrokerSl: newBeSl,
              softStructureSl: newBeSl,
              breakevenLocked: true,
            }
          : null
      );

      playBeep(840, false);
      const msg = `${isAuto ? '🔒 AI AUTO-LOCKED BREAKEVEN' : '🔒 BREAKEVEN LOCKED'}: Stop Loss moved to $${newBeSl.toFixed(precision)} (above entry $${current.entryPrice.toFixed(precision)}). Risk is now $0.00!`;
      setStatusBanner(msg);
      appendDirectiveLog('LOCK_BREAKEVEN', msg, 'Trade is now risk-free and riding toward TP1.');
    },
    [symbol, precision, playBeep, appendDirectiveLog]
  );

  // Core 3-Second Autonomous Brain Loop:
  // 1. Syncs real open MT5 positions (if any) + live market bars/SMC
  // 2. Updates live trade floating PnL & progress
  // 3. Evaluates AI Directives (Hold w/ Wick Shield, Lock Breakeven, Take Profit at TP1/FVG, or Stop on Confirmed CHoCH)
  // 4. Executes actions automatically when Autopilot is ON!
  useEffect(() => {
    let mounted = true;

    const runBotBrainCycle = async () => {
      try {
        // 1. Check real open MT5 positions & sync live broker balance/equity
        let mt5Positions: any[] = [];
        let hJson: any = null;
        try {
          const hRes = await fetch('http://127.0.0.1:8001/health', {
            headers: { Authorization: `Bearer ${MT5_LOCAL_TOKEN}` },
            cache: 'no-store',
          });
          if (hRes.ok) hJson = await hRes.json();
        } catch {}

        if (!hJson) {
          try {
            const apiRes = await fetch('/api/mt5', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ mode: 'health' }),
            });
            if (apiRes.ok) hJson = await apiRes.json();
          } catch {}
        }

        if (hJson) {
          if (Array.isArray(hJson.open_positions)) {
            mt5Positions = hJson.open_positions;
          }
          const term = hJson.mt5_terminal;
          if (term?.account_balance !== undefined && Number(term.account_balance) > 0) {
            const realBal = Number(Number(term.account_balance).toFixed(2));
            setAccountBalance(realBal);
            if (typeof window !== 'undefined') {
              localStorage.setItem('wessignal_last_mt5_balance', String(realBal));
            }
          }
          if (term?.account_equity !== undefined && Number(term.account_equity) > 0) {
            setLiveMt5Equity(Number(Number(term.account_equity).toFixed(2)));
          }
          if (term?.account_leverage !== undefined && Number(term.account_leverage) > 0) {
            setAccountLeverage(Number(term.account_leverage));
          }
        }

        // 2. Fetch live bars & SMC/FVG analysis
        const { bars, source } = await fetchBrowserLiveBars(symbol, timeframe);
        if (!mounted || !bars.length) return;

        const analysis = computeBrowserSignalAnalysis(
          symbol,
          timeframe,
          bars,
          source,
          undefined,
          accountBalance,
          lotSize,
          riskPercent
        );

        const tickNow = analysis.latest_price;
        const smc: SMCPrinciplesSummary | null =
          (analysis as any)?.smc_principles || (analysis.trade_params as any)?.smc_principles || null;
        const engineDir: 'BUY' | 'SELL' =
          analysis.signal_type === 'SELL/SHORT' ? 'SELL' : 'BUY';

        setLivePrice(tickNow);
        setSignalDirection(engineDir);
        setSignalConfidence(analysis.probability || 92);
        setSmcSummary(smc);

        // 3. Match open MT5 position for this symbol if one exists on the broker
        const cleanSym = symbol.toUpperCase().replace('/', '').replace('-', '');
        const matchingMt5Pos = mt5Positions.find((p) =>
          String(p.symbol || '')
            .toUpperCase()
            .includes(cleanSym.slice(0, 6))
        );

        let trade = activeTradeRef.current;

        if (matchingMt5Pos) {
          const pDir: 'BUY' | 'SELL' = matchingMt5Pos.type === 'SELL' ? 'SELL' : 'BUY';
          const pEntry = Number(matchingMt5Pos.price_open || tickNow);
          const pCurr = Number(matchingMt5Pos.price_current || tickNow);
          const pSl =
            Number(matchingMt5Pos.sl) > 0
              ? Number(matchingMt5Pos.sl)
              : analysis.trade_params.stop_loss;
          const pTp =
            Number(matchingMt5Pos.tp) > 0
              ? Number(matchingMt5Pos.tp)
              : analysis.trade_params.tp1;
          const ptsMoved = Number(
            (pDir === 'BUY' ? pCurr - pEntry : pEntry - pCurr).toFixed(precision)
          );
          const beLocked =
            trade?.breakevenLocked ||
            (pDir === 'BUY' && pSl >= pEntry) ||
            (pDir === 'SELL' && pSl > 0 && pSl <= pEntry);

          trade = {
            id: trade?.id || `mt5-${matchingMt5Pos.ticket}`,
            ticket: Number(matchingMt5Pos.ticket),
            isRealMt5: true,
            symbol,
            direction: pDir,
            volume: Number(matchingMt5Pos.volume || lotSize),
            entryPrice: pEntry,
            currentPrice: pCurr,
            hardBrokerSl: pSl,
            softStructureSl: trade?.softStructureSl || pSl,
            breakevenTriggerPrice:
              trade?.breakevenTriggerPrice ||
              Number(
                (pDir === 'BUY'
                  ? pEntry + Math.abs(pTp - pEntry) * 0.55
                  : pEntry - Math.abs(pEntry - pTp) * 0.55
                ).toFixed(precision)
              ),
            tp1Price: pTp,
            tp2Price: analysis.trade_params.tp2,
            floatingPnlDollars: Number(Number(matchingMt5Pos.profit || 0).toFixed(2)),
            pointsMoved: ptsMoved,
            openedAtMs:
              matchingMt5Pos.time_open && matchingMt5Pos.time_open > 0
                ? Number(matchingMt5Pos.time_open) * 1000
                : trade?.openedAtMs || Date.now(),
            breakevenLocked: Boolean(beLocked),
            status: 'OPEN',
          };
          setActiveTrade(trade);

          // AUTO-HEAL: If MT5 position has no Stop Loss on the broker, plug it in immediately!
          if (matchingMt5Pos.ticket && Number(matchingMt5Pos.sl || 0) === 0) {
            const healPayload = {
              ticket: Number(matchingMt5Pos.ticket),
              sl: pSl,
              tp: pTp,
            };
            fetch('http://127.0.0.1:8001/bridge/modify-position', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${MT5_LOCAL_TOKEN}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(healPayload),
            }).catch(() => {
              fetch('/api/mt5', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: 'modify_position', ...healPayload }),
              }).catch(() => {});
            });
            appendDirectiveLog(
              'AUTO_ENTER',
              `🛡️ AUTO-PLUGGED MISSING STOP LOSS ON MT5 (${pDir})`,
              `Position #${matchingMt5Pos.ticket} had no SL on Exness MT5. Attached hard SL at $${pSl.toFixed(precision)}.`
            );
          }
        } else if (trade && !trade.isRealMt5) {
          // Update Live Mimic Trade with latest market tick
          const ptsMoved = Number(
            (trade.direction === 'BUY'
              ? tickNow - trade.entryPrice
              : trade.entryPrice - tickNow
            ).toFixed(precision)
          );
          const mult = getContractMultiplier(symbol);
          const pnl = Number((ptsMoved * trade.volume * mult).toFixed(2));
          trade = {
            ...trade,
            currentPrice: tickNow,
            pointsMoved: ptsMoved,
            floatingPnlDollars: pnl,
          };
          setActiveTrade(trade);
        } else if (trade && trade.isRealMt5 && !matchingMt5Pos) {
          // Real MT5 position was closed on the server (hit TP or SL)
          const finalPnl = trade.floatingPnlDollars;
          setClosedTradesCount((c) => c + 1);
          if (finalPnl >= 0) setWinsCount((w) => w + 1);
          setSessionRealizedPnl((tot) => Number((tot + finalPnl).toFixed(2)));
          setActiveTrade(null);
          trade = null;
        }

        // 4. Evaluate AI Directives & Autonomous Execution
        const nowMs = Date.now();
        if (trade) {
          const ageSec = Math.max(0, Math.round((nowMs - trade.openedAtMs) / 1000));
          const inGracePeriod = ageSec <= 12;
          const hitTp1 =
            (trade.direction === 'BUY' && trade.currentPrice >= trade.tp1Price) ||
            (trade.direction === 'SELL' && trade.currentPrice <= trade.tp1Price);
          const hitExhaustionInProfit =
            trade.floatingPnlDollars >= 0.35 &&
            ((trade.direction === 'BUY' &&
              smc?.trendExhaustion.action === 'TAKE_PROFIT_AND_SELL') ||
              (trade.direction === 'SELL' &&
                smc?.trendExhaustion.action === 'TAKE_PROFIT_AND_BUY'));
          const hitBreakevenTrigger =
            !trade.breakevenLocked &&
            ((trade.direction === 'BUY' &&
              trade.currentPrice >= trade.breakevenTriggerPrice) ||
              (trade.direction === 'SELL' &&
                trade.currentPrice <= trade.breakevenTriggerPrice));

          // 1. FAST REACTION TO SHARP TURNS (Never turn a blind eye to sharp reversals!):
          // If the trade enters negative territory (-$0.30 or worse) AND the market order flow flips
          // (engineDir !== trade.direction OR opposing trend exhaustion/FVG formed),
          // CUT THE TRADE IMMEDIATELY with a micro-scratch loss (-$0.30 to -$0.50) to protect account capital!
          const sharpTurnAgainstTrade =
            !inGracePeriod &&
            trade.floatingPnlDollars <= -0.30 &&
            ((trade.direction === 'BUY' && engineDir === 'SELL') ||
              (trade.direction === 'SELL' && engineDir === 'BUY') ||
              (trade.direction === 'BUY' && smc?.trendExhaustion.action === 'TAKE_PROFIT_AND_SELL') ||
              (trade.direction === 'SELL' && smc?.trendExhaustion.action === 'TAKE_PROFIT_AND_BUY'));

          // 2. SMALL-ACCOUNT PROPORTIONAL CATASTROPHIC CIRCUIT BREAKER:
          // Strictly proportional to account size:
          // On a $10.22 account: max allowed loss is capped at $0.85 (under 8.5% of account, NEVER $2.20!)
          // On a $40 account: max allowed loss is capped at $1.50
          const maxAllowedLossDollars = Math.min(
            accountBalance <= 15 ? 0.85 : accountBalance <= 30 ? 1.35 : 2.20,
            Math.max(0.60, accountBalance * (riskPercent / 100) * 1.5)
          );
          const catastrophicLossBreached = trade.floatingPnlDollars <= -maxAllowedLossDollars;

          // Confirmed structural invalidation (beyond soft structure stop)
          const confirmedStructureBreak =
            !inGracePeriod &&
            ((trade.direction === 'BUY' &&
              engineDir === 'SELL' &&
              trade.currentPrice <= trade.softStructureSl) ||
              (trade.direction === 'SELL' &&
                engineDir === 'BUY' &&
                trade.currentPrice >= trade.softStructureSl) ||
              (trade.direction === 'BUY' && trade.currentPrice <= trade.hardBrokerSl) ||
              (trade.direction === 'SELL' && trade.currentPrice >= trade.hardBrokerSl));

          if (sharpTurnAgainstTrade) {
            setAiCurrentCommand({
              badge: 'STOP & EXIT NOW',
              color: 'rose',
              title: `⚡ SHARP TURN DETECTED: Cutting Loss Fast (-$${Math.abs(trade.floatingPnlDollars).toFixed(2)})`,
              explanation: `Market order flow flipped to ${engineDir} against our ${trade.direction}. Cutting trade fast at -$${Math.abs(trade.floatingPnlDollars).toFixed(2)} to protect capital from runaway drawdown!`,
            });
            if (autopilotRef.current && nowMs - lastAutoActionMsRef.current > 2500) {
              lastAutoActionMsRef.current = nowMs;
              await closeActiveBotTrade(
                'STOP_REVERSE',
                `Sharp market turn: Order flow flipped to ${engineDir} against ${trade.direction}. Cut fast at -$${Math.abs(trade.floatingPnlDollars).toFixed(2)}.`
              );
            }
          } else if (catastrophicLossBreached) {
            setAiCurrentCommand({
              badge: 'STOP & EXIT NOW',
              color: 'rose',
              title: `🚨 EMERGENCY RISK CIRCUIT BREAKER TRIGGERED (-$${Math.abs(trade.floatingPnlDollars).toFixed(2)})`,
              explanation: `Loss exceeded maximum allowed small-account budget (-$${maxAllowedLossDollars.toFixed(2)}). Emergency closing position immediately to protect account!`,
            });
            if (nowMs - lastAutoActionMsRef.current > 2500) {
              lastAutoActionMsRef.current = nowMs;
              await closeActiveBotTrade(
                'STOP_REVERSE',
                `Emergency circuit breaker: Loss -$${Math.abs(trade.floatingPnlDollars).toFixed(2)} exceeded safety limit -$${maxAllowedLossDollars.toFixed(2)}.`
              );
            }
          } else if (hitTp1 || hitExhaustionInProfit) {
            setAiCurrentCommand({
              badge: 'TAKE MONEY NOW',
              color: 'emerald',
              title: `💰 AI COMMAND: TAKE PROFIT NOW (+$${trade.floatingPnlDollars.toFixed(2)})`,
              explanation: hitTp1
                ? `Price reached TP1 ($${trade.tp1Price.toFixed(precision)})! Closing position automatically to bank profit.`
                : `Trend reached opposing Fair Value Gap exhaustion in profit (+$${trade.floatingPnlDollars.toFixed(2)})! Banking profit now.`,
            });
            if (autopilotRef.current && nowMs - lastAutoActionMsRef.current > 8000) {
              lastAutoActionMsRef.current = nowMs;
              await closeActiveBotTrade(
                'TAKE_PROFIT',
                `Target reached at $${trade.currentPrice.toFixed(precision)} (+$${trade.floatingPnlDollars.toFixed(2)} banked).`
              );
            }
          } else if (confirmedStructureBreak) {
            setAiCurrentCommand({
              badge: 'STOP & EXIT NOW',
              color: 'rose',
              title: `🛑 AI COMMAND: STOP / CLOSE POSITION NOW (Structure Invalidated)`,
              explanation: `Candle closed beyond Swing Structure ($${trade.softStructureSl.toFixed(precision)}) and order flow flipped to ${engineDir}. Exiting to protect account balance!`,
            });
            if (autopilotRef.current && nowMs - lastAutoActionMsRef.current > 8000) {
              lastAutoActionMsRef.current = nowMs;
              await closeActiveBotTrade(
                'STOP_REVERSE',
                `Confirmed ${engineDir} CHoCH structure break beyond $${trade.softStructureSl.toFixed(precision)}.`
              );
            }
          } else if (hitBreakevenTrigger) {
            setAiCurrentCommand({
              badge: 'LOCKING BREAKEVEN',
              color: 'amber',
              title: `🔒 AI COMMAND: LOCK BREAKEVEN AT $${trade.entryPrice.toFixed(precision)}`,
              explanation: `Trade is +$${trade.floatingPnlDollars.toFixed(2)} in profit. Moving Stop Loss to Entry so this trade can NEVER turn into a loss!`,
            });
            if (autopilotRef.current) {
              await lockBreakevenOnActiveTrade(true);
            }
          } else if (trade.floatingPnlDollars < 0) {
            setAiCurrentCommand({
              badge: 'WICK SHIELD ACTIVE',
              color: 'amber',
              title: inGracePeriod
                ? `🛡️ AI ENTRY GRACE SHIELD (${25 - ageSec}s): Ignoring Entry Spread / Tick Noise`
                : `🛡️ AI WICK SHIELD ACTIVE: Hold Position — Swing Structure Intact!`,
              explanation: `Floating ${trade.floatingPnlDollars >= 0 ? '+' : ''}$${trade.floatingPnlDollars.toFixed(2)} is inside normal candle fluctuation. Hard SL is safely at $${trade.hardBrokerSl.toFixed(precision)}. Do NOT panic-close!`,
            });
          } else {
            setAiCurrentCommand({
              badge: 'HOLD / RIDE TREND',
              color: 'emerald',
              title: `🟢 AI COMMAND: HOLD ${trade.direction} — Riding Order Flow (+$${trade.floatingPnlDollars.toFixed(2)})`,
              explanation: `Position is in profit (+$${trade.floatingPnlDollars.toFixed(2)}). ${
                trade.breakevenLocked ? 'Breakeven SL is locked!' : `Breakeven locks at $${trade.breakevenTriggerPrice.toFixed(precision)}.`
              } Target TP1: $${trade.tp1Price.toFixed(precision)}.`,
            });
          }
        } else {
          // Check if Worker Daily Profit Target has already been reached
          if (workerGoalEnabled && dailyProfitTarget > 0 && sessionRealizedPnl >= dailyProfitTarget) {
            setAiCurrentCommand({
              badge: 'DAILY GOAL MET',
              color: 'emerald',
              title: `🏆 DAILY WORKER GOAL ACHIEVED: +$${sessionRealizedPnl.toFixed(2)} / $${dailyProfitTarget.toFixed(2)}`,
              explanation: `Mission complete for today! Banked +$${sessionRealizedPnl.toFixed(2)}. The Worker Bot has safely shut down to protect your banked profits while you are away. Have a great day at work!`,
            });
            return;
          }

          // No open trade — evaluate state strictly from live ref to eliminate stale closure mismatch
          const isAutopilotOn = Boolean(autopilotRef.current);
          if (!isAutopilotOn) {
            setAiCurrentCommand({
              badge: 'SCANNING ENTRY',
              color: 'blue',
              title: `⏸️ AUTOPILOT IS OFF: ${engineDir} ${symbol} (${analysis.probability}% Confluence)`,
              explanation: `Market setup detected, but AI Autopilot is OFF. The bot will NOT place any trades on its own. Click "START FULL AI AUTOPILOT" to enable auto-trading.`,
            });
          } else {
            setAiCurrentCommand({
              badge: 'SCANNING ENTRY',
              color: 'blue',
              title: `🤖 AUTOPILOT ACTIVE: Scanning ${engineDir} ${symbol} (${analysis.probability}% SMC/FVG Confluence)`,
              explanation: `${smc?.structureLabel || 'Order flow aligned'}. Entry: $${tickNow.toFixed(precision)} | Anti-Wick SL: $${analysis.trade_params.stop_loss.toFixed(precision)} | TP1: $${analysis.trade_params.tp1.toFixed(precision)}.`,
            });

            if (
              isAutopilotOn &&
              (!workerGoalEnabled || dailyProfitTarget <= 0 || sessionRealizedPnl < dailyProfitTarget) &&
              (analysis.probability || 90) >= 90 &&
              nowMs - lastAutoEntryMsRef.current >= 45000
            ) {
              lastAutoEntryMsRef.current = nowMs;
              await executeBotOrder(
                engineDir,
                tickNow,
                (analysis.trade_params as any)?.swing_low ?? analysis.support,
                (analysis.trade_params as any)?.swing_high ?? analysis.resistance,
                (analysis.trade_params as any)?.atr,
                `AI Autopilot ${analysis.probability}% SMC/FVG Confluence (${smc?.structureLabel || timeframe})`
              );
            }
          }
        }
      } catch (e) {
        console.error('Autonomous Bot loop error:', e);
      }
    };

    runBotBrainCycleRef.current = runBotBrainCycle;
    runBotBrainCycle();
    const interval = setInterval(runBotBrainCycle, 3500);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [
    symbol,
    timeframe,
    accountBalance,
    lotSize,
    riskPercent,
    precision,
    executeBotOrder,
    closeActiveBotTrade,
    lockBreakevenOnActiveTrade,
  ]);

  if (!isOpen) return null;

  // Calculate visual progress percentage between Hard SL (0%) -> Entry (40%) -> TP1 (100%)
  const computeProgressPct = (t: ActiveBotTrade): number => {
    const isBuy = t.direction === 'BUY';
    const slDist = Math.max(Math.abs(t.entryPrice - t.hardBrokerSl), 1e-5);
    const tpDist = Math.max(Math.abs(t.tp1Price - t.entryPrice), 1e-5);
    const delta = isBuy ? t.currentPrice - t.entryPrice : t.entryPrice - t.currentPrice;
    if (delta >= 0) {
      return Math.min(100, Math.round(40 + (delta / tpDist) * 60));
    } else {
      return Math.max(0, Math.round(40 - (Math.abs(delta) / slDist) * 40));
    }
  };

  // Minimized Picture-in-Picture (PiP) Floating HUD so user can watch chart & intervene in 1 click
  if (pipMinimized) {
    return (
      <div className="fixed bottom-4 right-4 z-50 w-96 bg-slate-950/95 border-2 border-indigo-500 rounded-2xl shadow-2xl p-3.5 text-slate-100 space-y-2.5 backdrop-blur-md">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
          <div className="flex items-center gap-2">
            <Bot className="w-4 h-4 text-emerald-400 animate-pulse" />
            <span className="text-xs font-black tracking-wide text-white">
              AI AUTOPILOT HUD ({symbol})
            </span>
            <span
              className={`px-1.5 py-0.5 rounded text-[9px] font-black ${
                autopilotEnabled
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-800 text-slate-300'
              }`}
            >
              {autopilotEnabled ? 'AUTO ON' : 'MANUAL'}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPipMinimized(false)}
              className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
              title="Expand Full Cockpit Window"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded bg-slate-800 hover:bg-rose-800 text-slate-200"
              title="Close Window"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* AI Directive Pill */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-2 text-[10.5px]">
          <div className="font-black text-amber-300">{aiCurrentCommand.title}</div>
          <div className="text-slate-300 text-[9.5px] mt-0.5 leading-snug">
            {aiCurrentCommand.explanation}
          </div>
        </div>

        {/* Active Trade Mini Bar */}
        {activeTrade ? (
          <div className="bg-slate-900/90 border border-indigo-800/80 rounded-lg p-2 flex items-center justify-between text-xs font-mono">
            <div>
              <span
                className={`font-black ${
                  activeTrade.direction === 'BUY' ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {activeTrade.direction} {activeTrade.volume}L
              </span>{' '}
              <span className="text-slate-400">@ ${activeTrade.entryPrice.toFixed(precision)}</span>
            </div>
            <div
              className={`font-black text-sm ${
                activeTrade.floatingPnlDollars >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {activeTrade.floatingPnlDollars >= 0 ? '+' : ''}$
              {activeTrade.floatingPnlDollars.toFixed(2)}
            </div>
          </div>
        ) : null}

        {/* 1-Click Quick Intervention Row */}
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() =>
              closeActiveBotTrade('HUMAN_INTERVENE', 'Manual Take Profit / Close clicked from HUD.')
            }
            className="py-1.5 px-2 bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-black rounded-lg"
          >
            💰 TAKE MONEY / CLOSE
          </button>
          <button
            type="button"
            onClick={() => {
              setAutopilotEnabled(false);
              closeActiveBotTrade('HUMAN_INTERVENE', 'Emergency Stop clicked by user.');
            }}
            className="py-1.5 px-2 bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-black rounded-lg"
          >
            🛑 STOP BOT &amp; EXIT
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 sm:p-5 overflow-y-auto">
      <div className="w-full max-w-4xl bg-slate-950 border-2 border-indigo-500/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* TOP HEADER */}
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 px-4 py-3 border-b border-indigo-800/80 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-indigo-600/30 border border-indigo-400/60">
              <Bot className="w-6 h-6 text-emerald-400 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-base font-black text-white tracking-wide">
                  LIVE AUTONOMOUS BOT &amp; AI COMMANDER WINDOW ({symbol} · {timeframe.toUpperCase()})
                </h2>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-black border ${
                    autopilotEnabled
                      ? 'bg-emerald-600/30 border-emerald-400 text-emerald-200 animate-pulse'
                      : 'bg-amber-600/20 border-amber-500/50 text-amber-300'
                  }`}
                >
                  {autopilotEnabled ? '🟢 FULL AI AUTOPILOT RUNNING' : '⏸️ SUPERVISED / MANUAL'}
                </span>
              </div>
              <p className="text-[11px] text-slate-300">
                Mimics &amp; mirrors live MT5 trades · Anti-Wick Small-Account Shield · Automatic Breakeven, Profit-Taking &amp; Stop-Out + 1-Click Human Intervention
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSoundEnabled((s) => !s)}
              className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200"
              title="Toggle Voice/Sound Chimes"
            >
              {soundEnabled ? <Volume2 className="w-4 h-4 text-emerald-400" /> : <VolumeX className="w-4 h-4 text-slate-500" />}
            </button>
            <button
              type="button"
              onClick={() => setPipMinimized(true)}
              className="px-2.5 py-1.5 rounded-lg bg-indigo-900/70 hover:bg-indigo-800 border border-indigo-500/60 text-indigo-100 text-[11px] font-bold flex items-center gap-1"
              title="Dock as Floating Corner HUD while watching the chart"
            >
              <Minimize2 className="w-3.5 h-3.5" />
              <span>Float Over Chart</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg bg-slate-900 hover:bg-rose-900 border border-slate-700 text-slate-300"
              title="Close Window"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* BODY CONTENT */}
        <div className="p-4 space-y-4 overflow-y-auto">
          {/* TOP CONTROL BAR: FULL AUTOPILOT TOGGLE + SESSION SCOREBOARD */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Autopilot Master Switch */}
            <div className="md:col-span-2 bg-slate-900/90 border border-indigo-800/80 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-black text-white flex items-center gap-1.5">
                  <Zap className="w-4 h-4 text-amber-400" />
                  <span>HANDS-FREE AI AUTOPILOT ENGINE</span>
                </div>
                <div className="text-[11px] text-slate-300 mt-0.5">
                  When ON, the bot automatically enters high-confluence setups, shields against small-account wicks, locks Breakeven, and takes profit at TP1/FVG.
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  const next = !autopilotEnabled;
                  setAutopilotEnabled(next);
                  autopilotRef.current = next;
                  setStatusBanner(
                    next
                      ? '🟢 Full AI Autopilot ARMED — Bot is now trading & managing stops/profits automatically!'
                      : '⏸️ AI Autopilot Paused — You are in manual control.'
                  );
                  if (next) {
                    setAiCurrentCommand((prev) => ({
                      ...prev,
                      badge: 'SCANNING ENTRY',
                      color: 'blue',
                      title: `🤖 AUTOPILOT ACTIVE: Scanning High-Confluence Setup...`,
                      explanation: `AI Autopilot armed! Analyzing institutional SMC/FVG order flow and preparing execution.`,
                    }));
                    setTimeout(() => {
                      runBotBrainCycleRef.current?.();
                    }, 50);
                  } else {
                    setAiCurrentCommand((prev) => ({
                      ...prev,
                      badge: 'SCANNING ENTRY',
                      color: 'blue',
                      title: `⏸️ AUTOPILOT IS OFF (Manual / Safe Mode)`,
                      explanation: `Autopilot is paused. The bot will NOT enter any trades automatically. Click "START FULL AI AUTOPILOT" to resume.`,
                    }));
                  }
                }}
                className={`px-4 py-2.5 rounded-xl font-black text-xs shadow-lg border transition flex items-center gap-2 ${
                  autopilotEnabled
                    ? 'bg-emerald-600 hover:bg-emerald-500 border-emerald-300 text-white'
                    : 'bg-indigo-600 hover:bg-indigo-500 border-indigo-300 text-white'
                }`}
              >
                {autopilotEnabled ? (
                  <>
                    <Pause className="w-4 h-4" />
                    <span>AUTOPILOT: ON (CLICK TO PAUSE)</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-white" />
                    <span>START FULL AI AUTOPILOT</span>
                  </>
                )}
              </button>
            </div>

            {/* Session Realized PnL & Win Rate */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 flex items-center justify-between font-mono">
              <div>
                <div className="text-[10px] text-slate-400 uppercase font-sans font-bold">
                  Session Banked Profit
                </div>
                <div
                  className={`text-lg font-black ${
                    sessionRealizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {sessionRealizedPnl >= 0
                    ? `+$${sessionRealizedPnl.toFixed(2)}`
                    : `-$${Math.abs(sessionRealizedPnl).toFixed(2)}`}
                </div>
                <div className="text-[10px] text-slate-400 font-sans flex items-center gap-1.5 flex-wrap">
                  <span>
                    Balance: <strong className="text-white font-bold">${accountBalance.toFixed(2)}</strong>
                  </span>
                  {liveMt5Equity !== null && (
                    <span className="text-emerald-300 font-bold">
                      · Equity: ${liveMt5Equity.toFixed(2)}
                    </span>
                  )}
                  <span>· {lotSize} Lot</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-slate-400 font-sans font-bold">Trades / Wins</div>
                <div className="text-sm font-black text-indigo-300">
                  {winsCount}W / {closedTradesCount}T
                </div>
                <div className="text-[10px] text-emerald-400 font-sans font-bold flex items-center justify-end gap-1.5 mt-0.5">
                  <span>
                    {closedTradesCount > 0
                      ? `${Math.round((winsCount / closedTradesCount) * 100)}% Win Rate`
                      : 'Anti-Wick Shield Ready'}
                  </span>
                  {closedTradesCount > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setSessionRealizedPnl(0);
                        setClosedTradesCount(0);
                        setWinsCount(0);
                        saveSessionProfit(0, 0, 0);
                        setStatusBanner('🔄 Session scoreboard cleared.');
                      }}
                      className="text-[8px] bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white px-1.5 py-0.2 rounded border border-slate-700 font-mono transition"
                      title="Reset simulation scoreboard"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* EXNESS LEVERAGE & MARGIN SENTINEL (DYNAMIC ADVISOR) */}
          {(() => {
            const isGold = symbol.toUpperCase().includes('XAU') || symbol.toUpperCase().includes('GOLD');
            const isEurUsd = symbol.toUpperCase().includes('EUR') && symbol.toUpperCase().includes('USD');
            const isGbpUsd = symbol.toUpperCase().includes('GBP') && symbol.toUpperCase().includes('USD');

            // 0.01 Lot Nominal Value
            const nominalVal = isGold
              ? livePrice
              : isEurUsd
              ? 1085
              : isGbpUsd
              ? 1300
              : livePrice * 100 * lotSize;

            const margin400 = Number((nominalVal / 400).toFixed(2));
            const margin1000 = Number((nominalVal / 1000).toFixed(2));
            const margin2000 = Number((nominalVal / 2000).toFixed(2));
            const activeLev = accountLeverage || 400;
            const currentReqMargin = Number((nominalVal / activeLev).toFixed(2));
            const isMarginShort = accountBalance < currentReqMargin;
            const shortage = Number((currentReqMargin - accountBalance).toFixed(2));
            const freeCushion = Number((accountBalance - currentReqMargin).toFixed(2));

            // Dynamic Recommended Leverage based on Balance
            const recLev =
              accountBalance < 25
                ? '1:1000 or 1:2000'
                : accountBalance < 100
                ? '1:500 or 1:1000'
                : '1:200 or 1:400';

            return (
              <div
                className={`p-3 rounded-xl border transition-all ${
                  isMarginShort
                    ? 'bg-rose-950/40 border-rose-500/80 shadow-lg shadow-rose-950/40'
                    : 'bg-slate-900/90 border-slate-800'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2 pb-1.5 border-b border-slate-800/80">
                  <div className="flex items-center gap-2">
                    <div
                      className={`p-1.5 rounded-lg ${
                        isMarginShort ? 'bg-rose-500/20 text-rose-300' : 'bg-emerald-500/20 text-emerald-300'
                      }`}
                    >
                      <Briefcase className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-xs font-black text-white flex items-center gap-1.5 flex-wrap">
                        <span>EXNESS LEVERAGE &amp; MARGIN SENTINEL</span>
                        <span
                          className={`text-[9px] font-mono font-bold px-1.5 py-0.2 rounded border ${
                            isMarginShort
                              ? 'bg-rose-950 border-rose-600 text-rose-300 animate-pulse'
                              : 'bg-emerald-950 border-emerald-700 text-emerald-300'
                          }`}
                        >
                          {isMarginShort ? `SHORTAGE -$${shortage.toFixed(2)}` : `READY (+$${freeCushion.toFixed(2)} FREE)`}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-300">
                        {symbol} 0.01 Lot requires <strong className="text-white">${currentReqMargin.toFixed(2)}</strong> margin at 1:{activeLev} leverage.
                      </div>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="text-[10px] text-slate-400 font-sans">
                      Detected Leverage: <strong className="text-indigo-300 font-mono font-black">1:{activeLev}</strong>
                    </span>
                  </div>
                </div>

                {/* Leverage Tier Comparison Chips */}
                <div className="grid grid-cols-3 gap-2 text-center text-[10px] font-mono mb-2">
                  <div
                    className={`p-1.5 rounded-lg border ${
                      activeLev === 400
                        ? 'bg-slate-800 border-indigo-500 text-white'
                        : 'bg-slate-950/60 border-slate-800 text-slate-400'
                    }`}
                  >
                    <div className="text-[9px] text-slate-400">1:400 (Default)</div>
                    <div className={`font-black ${accountBalance < margin400 ? 'text-rose-400' : 'text-slate-200'}`}>
                      ${margin400.toFixed(2)} {accountBalance < margin400 ? '❌ Short' : '✅ OK'}
                    </div>
                  </div>
                  <div
                    className={`p-1.5 rounded-lg border ${
                      activeLev === 1000
                        ? 'bg-emerald-950/80 border-emerald-400 text-emerald-200'
                        : 'bg-emerald-950/30 border-emerald-800/60 text-emerald-300'
                    }`}
                  >
                    <div className="text-[9px] text-emerald-400 font-bold">1:1000 (Recommended)</div>
                    <div className="font-black text-emerald-300">
                      ${margin1000.toFixed(2)} ✅ Ready
                    </div>
                  </div>
                  <div
                    className={`p-1.5 rounded-lg border ${
                      activeLev === 2000
                        ? 'bg-indigo-950/80 border-indigo-400 text-indigo-200'
                        : 'bg-indigo-950/30 border-indigo-800/60 text-indigo-300'
                    }`}
                  >
                    <div className="text-[9px] text-indigo-400 font-bold">1:2000 (Micro Max)</div>
                    <div className="font-black text-indigo-200">
                      ${margin2000.toFixed(2)} 🚀 Max Free
                    </div>
                  </div>
                </div>

                {/* Balance-Based Recommendation & Quick Action Bar */}
                <div className="text-[10px] space-y-1.5 bg-slate-950/70 rounded-lg p-2 border border-slate-800/80">
                  <div className="flex items-start gap-1.5 text-slate-300">
                    <span className="text-amber-400 text-xs font-bold leading-none">💡</span>
                    <span>
                      For balance <strong className="text-emerald-300 font-mono">${accountBalance.toFixed(2)}</strong>, we recommend <strong className="text-amber-300">{recLev}</strong> leverage.
                      {isMarginShort && (
                        <span className="text-rose-300 ml-1">
                          Exness rejected 0.01 {symbol} because ${accountBalance.toFixed(2)} is ${shortage.toFixed(2)} short of the ${currentReqMargin.toFixed(2)} margin needed at 1:{activeLev}!
                        </span>
                      )}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-800/60">
                    {/* Option A: Direct Link to Exness Personal Area */}
                    <a
                      href="https://my.exness.com/pa/accounts"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-black text-[10px] rounded-lg shadow border border-indigo-400 flex items-center gap-1.5 transition"
                      title="Open Exness Personal Area in your browser to change leverage in 2 clicks"
                    >
                      <ArrowUpRight className="w-3.5 h-3.5" />
                      <span>Option A: Open Exness Account Settings (#223995620)</span>
                    </a>

                    {/* Option B: 1-Click Symbol Switch to EUR/USD */}
                    <button
                      type="button"
                      onClick={() => {
                        const targetSym = isGold ? 'EUR/USD' : 'XAU/USD';
                        if (onSelectSymbol) onSelectSymbol(targetSym);
                        if (typeof window !== 'undefined') {
                          window.dispatchEvent(new CustomEvent('wessignal-change-symbol', { detail: targetSym }));
                        }
                        setStatusBanner(
                          isGold
                            ? `🔄 Switched to EUR/USD (Margin only $2.71 @ 1:400 — your $${accountBalance.toFixed(2)} balance can trade right now)!`
                            : `🔄 Switched to XAU/USD!`
                        );
                      }}
                      className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-amber-300 hover:text-white font-black text-[10px] rounded-lg border border-slate-700 shadow flex items-center gap-1.5 transition"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>{isGold ? 'Option B: Switch to EUR/USD ($2.71 Margin — Ready Now)' : 'Switch back to XAU/USD'}</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* SMALL-ACCOUNT VOLATILITY SHIELD: WHY FOREX (EUR/USD) BEATS GOLD FOR SMALL ACCOUNTS */}
          {symbol.toUpperCase().includes('XAU') && accountBalance < 35 && (
            <div className="bg-gradient-to-r from-amber-950/70 via-slate-900 to-amber-950/50 border border-amber-500/80 rounded-xl p-3 space-y-2 text-[10px]">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-bold text-amber-300">
                  <ShieldAlert className="w-4 h-4 text-amber-400" />
                  <span>⚠️ Small-Balance Alert: Gold Noise Trap ($10 Balance)</span>
                </span>
                <span className="bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded font-mono font-bold">
                  EUR/USD Priority
                </span>
              </div>
              <p className="text-slate-200 leading-relaxed font-sans">
                On 0.01 Gold, every $1.00 move equals $1.00. To cap your risk at $0.85, the Stop Loss is forced to sit only <strong>0.85 points away</strong>, which is inside Gold's normal spread (0.35–0.45) and 1-minute noise ($2–$5)! That is why Gold trades stopped out at -$0.85.
              </p>
              <p className="text-emerald-300 font-semibold leading-relaxed font-sans">
                💡 <strong>The Solution:</strong> Switch to <strong>EUR/USD or GBP/USD</strong>! On EUR/USD, 0.01 lot is only <strong>$0.10/pip</strong>. Your $0.85 stop gives you <strong>8.5 to 12 pips of safe structural breathing room</strong> outside spread, giving you high win-rate SMC setups without suffocating!
              </p>
              <div className="flex items-center gap-2 pt-1 flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    if (onSelectSymbol) onSelectSymbol('EUR/USD');
                    if (typeof window !== 'undefined') {
                      window.dispatchEvent(new CustomEvent('wessignal-change-symbol', { detail: 'EUR/USD' }));
                    }
                    setStatusBanner('🔄 Switched to EUR/USD — Safe 8.5-pip structural stop loss now active!');
                  }}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-black rounded-lg border border-emerald-300 shadow flex items-center gap-1.5 transition"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Switch to EUR/USD Now (Recommended for $10 Balance)</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (onSelectSymbol) onSelectSymbol('GBP/USD');
                    if (typeof window !== 'undefined') {
                      window.dispatchEvent(new CustomEvent('wessignal-change-symbol', { detail: 'GBP/USD' }));
                    }
                    setStatusBanner('🔄 Switched to GBP/USD — Safe structural stop loss active!');
                  }}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-black rounded-lg border border-slate-700 shadow flex items-center gap-1.5 transition"
                >
                  <span>Switch to GBP/USD</span>
                </button>
              </div>
            </div>
          )}

          {/* LAUNCH MT5 BRIDGE (PORT 8001) SERVER BUTTON BAR */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-2.5 flex flex-wrap items-center justify-between gap-2 text-[10px]">
            <div className="flex items-center gap-2">
              <Server className="w-4 h-4 text-indigo-400" />
              <div>
                <span className="font-bold text-white">Local MT5 Bridge (Port 8001): </span>
                <span className="text-slate-300">FastAPI execution server on 127.0.0.1:8001</span>
              </div>
            </div>
            <button
              type="button"
              onClick={async () => {
                setStatusBanner('🚀 Launching mt5_bridge/start_bridge.bat...');
                try {
                  const res = await fetch('/api/mt5', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mode: 'start_bridge_bat' }),
                  });
                  const d = await res.json().catch(() => ({}));
                  if (d?.isCloud) {
                    alert('⚠️ On Vercel Cloud: Cloud websites cannot start local programs. Double-click START_PORT_8001.bat or mt5_bridge\\start_bridge.bat on your PC desktop.');
                    setStatusBanner('⚠️ On Vercel: Double-click START_PORT_8001.bat or mt5_bridge/start_bridge.bat on your PC.');
                  } else {
                    setStatusBanner(d?.message || '✅ mt5_bridge/start_bridge.bat launched!');
                  }
                } catch (e: any) {
                  setStatusBanner(`⚠️ Error launching bridge: ${e?.message}`);
                }
              }}
              className="px-3 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black rounded-lg border border-emerald-300 shadow flex items-center gap-1.5 transition"
              title="Runs mt5_bridge/start_bridge.bat"
            >
              <Play className="w-3.5 h-3.5 fill-white" />
              <span>Start mt5_bridge/start_bridge.bat</span>
            </button>
          </div>

          {/* WORKER ALGORITHM (DAILY PROFIT TARGET LOCK / SENTINEL) */}
          <div
            className={`p-3.5 rounded-xl border transition-all ${
              isDailyGoalAchieved
                ? 'bg-gradient-to-r from-emerald-950/95 via-teal-950/90 to-slate-900 border-emerald-400 shadow-xl shadow-emerald-950/60 ring-1 ring-emerald-400/50'
                : 'bg-slate-900/95 border-indigo-700/80 shadow-md'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5 pb-2 border-b border-slate-800/80">
              <div className="flex items-center gap-2">
                <div
                  className={`p-1.5 rounded-lg ${
                    isDailyGoalAchieved ? 'bg-amber-500/20 text-amber-300' : 'bg-indigo-600/20 text-indigo-300'
                  }`}
                >
                  <Trophy className="w-4 h-4 text-amber-400" />
                </div>
                <div>
                  <div className="text-xs font-black text-white flex items-center gap-1.5 flex-wrap">
                    <span>WORKER ALGORITHM (DAILY PROFIT TARGET LOCK)</span>
                    <span className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded bg-indigo-950 border border-indigo-800 text-indigo-300">
                      AUTO-SHUTDOWN SENTINEL
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-300">
                    Set your profit quota. Once reached, the bot automatically parks itself for the day so you can leave for work without watching the screen.
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const next = !workerGoalEnabled;
                    setWorkerGoalEnabled(next);
                    if (typeof window !== 'undefined') {
                      localStorage.setItem('wessignal_worker_goal_enabled', String(next));
                    }
                  }}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-black border transition flex items-center gap-1 ${
                    workerGoalEnabled
                      ? 'bg-emerald-600/30 border-emerald-400 text-emerald-200'
                      : 'bg-slate-800 border-slate-700 text-slate-400'
                  }`}
                >
                  <CheckCircle2 className="w-3 h-3" />
                  <span>{workerGoalEnabled ? 'WORKER QUOTA: ACTIVE' : 'WORKER QUOTA: OFF'}</span>
                </button>

                {isDailyGoalAchieved && (
                  <span className="px-2 py-0.5 rounded-md bg-emerald-500 text-slate-950 text-[10px] font-black font-mono animate-pulse">
                    🏆 GOAL MET · SHUTDOWN ACTIVE
                  </span>
                )}
              </div>
            </div>

            {/* Target Preset Selector & Progress Meter */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-center">
              {/* Left: Preset Selector */}
              <div className="lg:col-span-5 space-y-1">
                <div className="flex items-center justify-between text-[10px]">
                  <label className="text-slate-400 font-bold flex items-center gap-1">
                    <Target className="w-3 h-3 text-emerald-400" />
                    <span>Daily Target Goal ($):</span>
                  </label>
                  <span className="text-emerald-300 font-mono font-bold">
                    Target: ${dailyProfitTarget.toFixed(2)} / day
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-1">
                  {[5, 10, 20, 30, 50, 100].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => handleSelectPresetTarget(preset)}
                      className={`px-2 py-1 rounded text-[10px] font-mono font-bold border transition ${
                        dailyProfitTarget === preset
                          ? 'bg-emerald-600 border-emerald-300 text-white shadow'
                          : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-600'
                      }`}
                    >
                      ${preset}
                    </button>
                  ))}

                  <div className="flex items-center gap-1 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5">
                    <span className="text-[10px] text-slate-400 font-mono">$</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={customTargetInput}
                      onChange={(e) => handleCustomTargetChange(e.target.value)}
                      onBlur={handleCustomTargetBlur}
                      className="w-12 bg-transparent text-white font-mono text-[10.5px] font-bold focus:outline-none"
                      placeholder="10"
                    />
                  </div>
                </div>
              </div>

              {/* Right: Progress Meter & Status */}
              <div className="lg:col-span-7 bg-slate-950/80 border border-slate-800/90 rounded-lg p-2.5 space-y-1.5 font-mono">
                <div className="flex justify-between items-center text-[10.5px]">
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400 font-sans text-[10px]">Today&apos;s Banked:</span>
                    <span
                      className={`font-black ${
                        sessionRealizedPnl >= 0 ? 'text-emerald-300' : 'text-rose-400'
                      }`}
                    >
                      {sessionRealizedPnl >= 0
                        ? `+$${sessionRealizedPnl.toFixed(2)}`
                        : `-$${Math.abs(sessionRealizedPnl).toFixed(2)}`}
                    </span>
                    <span className="text-slate-500">/</span>
                    <span className="text-white font-bold">${dailyProfitTarget.toFixed(2)}</span>
                  </div>

                  <div className="font-bold text-[10px]">
                    {isDailyGoalAchieved ? (
                      <span className="text-emerald-300 flex items-center gap-1">
                        <span>100% COMPLETED</span>
                      </span>
                    ) : (
                      <span className="text-indigo-300">
                        {Math.min(
                          100,
                          Math.max(
                            0,
                            Math.round(
                              (sessionRealizedPnl / Math.max(1, dailyProfitTarget)) * 100
                            )
                          )
                        )}
                        % Progress
                      </span>
                    )}
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="w-full h-2.5 bg-slate-900 rounded-full overflow-hidden border border-slate-800 relative">
                  <div
                    className={`h-full transition-all duration-500 ${
                      isDailyGoalAchieved
                        ? 'bg-gradient-to-r from-emerald-500 via-teal-400 to-amber-300 animate-pulse'
                        : sessionRealizedPnl > 0
                        ? 'bg-gradient-to-r from-blue-600 via-teal-500 to-emerald-400'
                        : 'bg-slate-700'
                    }`}
                    style={{
                      width: `${Math.min(
                        100,
                        Math.max(
                          0,
                          (sessionRealizedPnl / Math.max(0.01, dailyProfitTarget)) * 100
                        )
                      )}%`,
                    }}
                  />
                </div>

                <div className="flex justify-between items-center text-[9px] text-slate-400 font-sans flex-wrap gap-1">
                  {isDailyGoalAchieved ? (
                    <span className="text-emerald-300 font-bold">
                      🎉 Worker mission complete! Autopilot paused to protect your $
                      {sessionRealizedPnl.toFixed(2)} profit.
                    </span>
                  ) : (
                    <span>
                      {sessionRealizedPnl >= 0
                        ? `+$${Math.max(0, dailyProfitTarget - sessionRealizedPnl).toFixed(2)} left to reach today's target`
                        : `Recovering drawdown: $${dailyProfitTarget.toFixed(2)} target`}
                    </span>
                  )}

                  {isDailyGoalAchieved && (
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          const nextTarget = dailyProfitTarget + 20;
                          handleSelectPresetTarget(nextTarget);
                          setAutopilotEnabled(true);
                          autopilotRef.current = true;
                          setStatusBanner(
                            `🚀 Target increased to $${nextTarget.toFixed(2)} — Worker Bot resumed!`
                          );
                        }}
                        className="text-[9px] bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-2 py-0.5 rounded transition"
                      >
                        + $20 More &amp; Resume
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSessionRealizedPnl(0);
                          saveSessionProfit(0, 0, 0);
                          setStatusBanner('🔄 Session quota reset — Worker Bot ready!');
                        }}
                        className="text-[9px] bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold px-2 py-0.5 rounded transition"
                      >
                        Reset Day
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* LIVE AI COMMANDER BRAIN BANNER ("AI TELLING US WHAT TO DO & DOING IT AUTOMATICALLY") */}
          <div
            className={`p-3.5 rounded-xl border-2 transition-all ${
              aiCurrentCommand.color === 'emerald'
                ? 'bg-emerald-950/60 border-emerald-500/80 text-emerald-100'
                : aiCurrentCommand.color === 'amber'
                ? 'bg-amber-950/60 border-amber-500/80 text-amber-100'
                : aiCurrentCommand.color === 'rose'
                ? 'bg-rose-950/70 border-rose-500 text-rose-100'
                : 'bg-indigo-950/60 border-indigo-500/80 text-indigo-100'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-black/40 border border-white/20 text-[10px] font-black font-mono uppercase">
                  AI DIRECTIVE: {aiCurrentCommand.badge}
                </span>
                <span className="text-xs sm:text-sm font-black">{aiCurrentCommand.title}</span>
              </div>
              <span className="text-xs font-mono font-bold bg-black/40 px-2.5 py-1 rounded-lg">
                Live {symbol}: ${livePrice.toFixed(precision)}
              </span>
            </div>
            <p className="text-xs mt-1.5 opacity-95 leading-relaxed">
              {aiCurrentCommand.explanation}
            </p>
          </div>

          {/* LIVE TRADE MIMIC & MT5 POSITION MIRROR COCKPIT */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-black text-white uppercase tracking-wider">
                  LIVE TRADE MIMIC &amp; MT5 POSITION TELEMETRY
                </span>
                {activeTrade && (
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-black ${
                      activeTrade.isRealMt5
                        ? 'bg-emerald-600 text-white'
                        : 'bg-indigo-600 text-white'
                    }`}
                  >
                    {activeTrade.isRealMt5
                      ? `LIVE EXNESS MT5 DEAL #${activeTrade.ticket}`
                      : 'LIVE BOT MIMIC POSITION'}
                  </span>
                )}
              </div>
              <span className="text-[11px] text-slate-400 font-mono">{statusBanner}</span>
            </div>

            {activeTrade ? (
              <div className="space-y-3">
                {/* Main Trade Numbers */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 font-mono">
                  <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5">
                    <div className="text-[10px] text-slate-400 font-sans">Direction &amp; Lot</div>
                    <div
                      className={`text-sm font-black flex items-center gap-1 ${
                        activeTrade.direction === 'BUY' ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {activeTrade.direction === 'BUY' ? (
                        <ArrowUpRight className="w-4 h-4" />
                      ) : (
                        <ArrowDownRight className="w-4 h-4" />
                      )}
                      <span>
                        {activeTrade.direction} ({activeTrade.volume} Lot)
                      </span>
                    </div>
                  </div>

                  <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5">
                    <div className="text-[10px] text-slate-400 font-sans">Entry → Current</div>
                    <div className="text-xs font-bold text-white">
                      ${activeTrade.entryPrice.toFixed(precision)} → ${activeTrade.currentPrice.toFixed(precision)}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      Move: {activeTrade.pointsMoved >= 0 ? '+' : ''}
                      {activeTrade.pointsMoved.toFixed(precision)} pts
                    </div>
                  </div>

                  <div className="bg-slate-950 border border-rose-900/60 rounded-lg p-2.5">
                    <div className="text-[10px] text-rose-400 font-sans font-bold">
                      Anti-Wick Hard SL
                    </div>
                    <div className="text-xs font-black text-rose-300">
                      ${activeTrade.hardBrokerSl.toFixed(precision)}
                    </div>
                    <div className="text-[9.5px] text-slate-400 font-sans">
                      {activeTrade.breakevenLocked
                        ? '🔒 Locked at Breakeven ($0 Risk)'
                        : 'Outside 1m wick fluctuation'}
                    </div>
                  </div>

                  <div className="bg-slate-950 border border-emerald-900/60 rounded-lg p-2.5">
                    <div className="text-[10px] text-emerald-400 font-sans font-bold">
                      Take Money Target (TP1)
                    </div>
                    <div className="text-xs font-black text-emerald-300">
                      ${activeTrade.tp1Price.toFixed(precision)}
                    </div>
                    <div className="text-[9.5px] text-slate-400 font-sans">
                      BE Lock @ ${activeTrade.breakevenTriggerPrice.toFixed(precision)}
                    </div>
                  </div>

                  <div
                    className={`rounded-lg p-2.5 border ${
                      activeTrade.floatingPnlDollars >= 0
                        ? 'bg-emerald-950/60 border-emerald-500/80'
                        : 'bg-rose-950/60 border-rose-500/80'
                    }`}
                  >
                    <div className="text-[10px] text-slate-300 font-sans font-bold">
                      Live Floating P&amp;L
                    </div>
                    <div
                      className={`text-base font-black ${
                        activeTrade.floatingPnlDollars >= 0 ? 'text-emerald-300' : 'text-rose-300'
                      }`}
                    >
                      {activeTrade.floatingPnlDollars >= 0 ? '+' : ''}$
                      {activeTrade.floatingPnlDollars.toFixed(2)}
                    </div>
                  </div>
                </div>

                {/* Visual Progress Bar from Hard SL -> Entry -> Breakeven -> TP1 */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] font-mono text-slate-400">
                    <span className="text-rose-400">
                      Hard SL (${activeTrade.hardBrokerSl.toFixed(precision)})
                    </span>
                    <span className="text-amber-300">
                      Soft Structure SL (${activeTrade.softStructureSl.toFixed(precision)})
                    </span>
                    <span className="text-blue-300">
                      Entry (${activeTrade.entryPrice.toFixed(precision)})
                    </span>
                    <span className="text-indigo-300">
                      BE Trigger (${activeTrade.breakevenTriggerPrice.toFixed(precision)})
                    </span>
                    <span className="text-emerald-400 font-bold">
                      TP1 Take Money (${activeTrade.tp1Price.toFixed(precision)})
                    </span>
                  </div>
                  <div className="w-full h-3 bg-slate-950 rounded-full overflow-hidden border border-slate-800 relative">
                    <div
                      className={`h-full transition-all duration-300 ${
                        activeTrade.floatingPnlDollars >= 0
                          ? 'bg-gradient-to-r from-blue-600 via-teal-500 to-emerald-400'
                          : 'bg-gradient-to-r from-rose-600 to-amber-500'
                      }`}
                      style={{ width: `${computeProgressPct(activeTrade)}%` }}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-xs font-bold text-slate-200">
                    No Open Trade on {symbol} — Ready to Execute {signalDirection} ({signalConfidence}% Confluence)
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Click <strong>Start Full AI Autopilot</strong> above for 100% automatic trading, or click a manual launch button below. Every trade uses our <strong>Anti-Wick Small-Account Cushion</strong> so entry fluctuations never stop you out early.
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isExecutingAction}
                    onClick={() =>
                      executeBotOrder(
                        'BUY',
                        livePrice,
                        smcSummary?.bullishOrderBlock.low,
                        smcSummary?.bearishOrderBlock.high,
                        undefined,
                        'Manual BUY Launch with Anti-Wick Shield'
                      )
                    }
                    className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-black rounded-lg shadow border border-emerald-400 flex items-center gap-1"
                  >
                    <ArrowUpRight className="w-4 h-4" />
                    <span>LAUNCH BUY {symbol}</span>
                  </button>
                  <button
                    type="button"
                    disabled={isExecutingAction}
                    onClick={() =>
                      executeBotOrder(
                        'SELL',
                        livePrice,
                        smcSummary?.bullishOrderBlock.low,
                        smcSummary?.bearishOrderBlock.high,
                        undefined,
                        'Manual SELL Launch with Anti-Wick Shield'
                      )
                    }
                    className="px-3.5 py-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-black rounded-lg shadow border border-rose-400 flex items-center gap-1"
                  >
                    <ArrowDownRight className="w-4 h-4" />
                    <span>LAUNCH SELL {symbol}</span>
                  </button>
                </div>
              </div>
            )}

            {/* 1-CLICK HUMAN INTERVENTION DECK ("LOOKING AT THE SCREEN AND INTERVENE IF POSSIBLE") */}
            <div className="pt-2 border-t border-slate-800">
              <div className="text-[10px] font-black text-amber-400 uppercase tracking-wider mb-2 flex items-center justify-between">
                <span>⚡ INSTANT HUMAN INTERVENTION CONTROLS (OVERRIDE BOT ANYTIME)</span>
                <span className="text-slate-400 font-mono">1-Click Direct MT5 Execution</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <button
                  type="button"
                  disabled={isExecutingAction}
                  onClick={() =>
                    closeActiveBotTrade(
                      'HUMAN_INTERVENE',
                      'User clicked TAKE MONEY / CLOSE NOW to harvest current trade.'
                    )
                  }
                  className="py-2.5 px-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-[11px] font-black rounded-xl border border-emerald-300 shadow flex items-center justify-center gap-1.5"
                >
                  <DollarSign className="w-4 h-4" />
                  <span>1. TAKE MONEY / CLOSE NOW</span>
                </button>

                <button
                  type="button"
                  disabled={isExecutingAction || !activeTrade || activeTrade.breakevenLocked}
                  onClick={() => lockBreakevenOnActiveTrade(false)}
                  className="py-2.5 px-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-[11px] font-black rounded-xl border border-indigo-300 shadow flex items-center justify-center gap-1.5"
                >
                  <Lock className="w-4 h-4" />
                  <span>2. LOCK BREAKEVEN SL</span>
                </button>

                <button
                  type="button"
                  disabled={isExecutingAction}
                  onClick={async () => {
                    const nextDir: 'BUY' | 'SELL' =
                      (activeTrade?.direction || signalDirection) === 'BUY' ? 'SELL' : 'BUY';
                    await closeActiveBotTrade(
                      'HUMAN_INTERVENE',
                      `User clicked REVERSE NOW — closing current position and flipping to ${nextDir}.`
                    );
                    await executeBotOrder(
                      nextDir,
                      livePrice,
                      smcSummary?.bullishOrderBlock.low,
                      smcSummary?.bearishOrderBlock.high,
                      undefined,
                      `Human Intervention Instant Reversal to ${nextDir}`
                    );
                  }}
                  className="py-2.5 px-3 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-slate-950 text-[11px] font-black rounded-xl border border-amber-300 shadow flex items-center justify-center gap-1.5"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>3. REVERSE TRADE NOW</span>
                </button>

                <button
                  type="button"
                  disabled={isExecutingAction}
                  onClick={async () => {
                    setAutopilotEnabled(false);
                    await closeActiveBotTrade(
                      'HUMAN_INTERVENE',
                      'Emergency Stop triggered — Autopilot disarmed & all trades closed.'
                    );
                  }}
                  className="py-2.5 px-3 bg-rose-700 hover:bg-rose-600 disabled:opacity-50 text-white text-[11px] font-black rounded-xl border border-rose-400 shadow flex items-center justify-center gap-1.5"
                >
                  <Square className="w-4 h-4 fill-white" />
                  <span>4. STOP BOT &amp; CLOSE ALL</span>
                </button>
              </div>
            </div>
          </div>

          {/* LIVE AI AUTOPILOT ACTION & DECISION STREAM */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 space-y-2">
            <div className="text-xs font-black text-indigo-300 uppercase tracking-wider flex items-center justify-between">
              <span>🧠 AI AUTONOMOUS DECISION &amp; EXECUTION LOG</span>
              <span className="text-[10px] text-slate-400 font-mono">
                Real-Time FVG · Wick Shield · Auto-Profit Actions
              </span>
            </div>
            <div className="max-h-44 overflow-y-auto space-y-1.5 pr-1">
              {directiveLogs.length === 0 ? (
                <div className="text-xs text-slate-400 py-3 text-center font-mono">
                  AI Autopilot is monitoring {symbol} ({timeframe.toUpperCase()}). Turn on Full AI Autopilot or launch a trade to see live autonomous actions.
                </div>
              ) : (
                directiveLogs.map((item) => (
                  <div
                    key={item.id}
                    className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-[11px] flex items-start justify-between gap-2"
                  >
                    <div>
                      <div className="font-bold text-white flex items-center gap-2">
                        <span className="text-[10px] font-mono text-slate-400">{item.time}</span>
                        <span>{item.headline}</span>
                      </div>
                      <div className="text-slate-300 text-[10px] mt-0.5">{item.detail}</div>
                    </div>
                    {typeof item.pnlDollars === 'number' && (
                      <span
                        className={`font-mono font-black text-xs shrink-0 ${
                          item.pnlDollars >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {item.pnlDollars >= 0 ? '+' : ''}${item.pnlDollars.toFixed(2)}
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

