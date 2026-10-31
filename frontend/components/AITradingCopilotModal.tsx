'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Bot,
  Sparkles,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Bell,
  Send,
  X,
  Volume2,
  VolumeX,
  Zap,
  Newspaper,
  Activity,
  Play,
  RefreshCw,
  CheckCircle2,
  XCircle,
  TrendingUp,
  TrendingDown,
  Clock,
} from 'lucide-react';
import { API_BASE_URL } from '@/lib/apiConfig';
import {
  fetchBrowserLiveBars,
  computeBrowserSignalAnalysis,
  calculateRiskBasedLevels,
  fetchWithFastTimeout,
} from '@/lib/browserFallbackEngine';

export interface AIClearanceReport {
  symbol: string;
  timeframe: string;
  verdict: 'CLEAR_TO_TRADE' | 'CAUTION' | 'DO_NOT_TRADE';
  verdictTitle: string;
  verdictColor: 'emerald' | 'amber' | 'rose';
  clearanceScore: number; // 0-100
  direction: 'BUY' | 'SELL';
  signalConfidence: number;
  latestPrice: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  slDistance: number;
  maxRiskDollars: number;
  accountBalance: number;
  lotSize: number;
  riskPercent: number;
  volatility: {
    state: 'OPTIMAL' | 'HIGH_VOLATILITY' | 'EXTREME_WHIPSAW' | 'LOW_LIQUIDITY';
    label: string;
    atr: number;
    currentRange: number;
    volatilityRatio: number; // current bar range / ATR
    rsi14: number;
    summary: string;
  };
  news: {
    status: 'CLEAR' | 'WATCH' | 'BLOCKED_HIGH_IMPACT';
    label: string;
    highImpactCount: number;
    warCount: number;
    sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    headlines: Array<{
      title: string;
      category: string;
      impact: string;
      sentiment: string;
      time: string;
    }>;
    summary: string;
  };
  session: {
    name: string;
    quality: 'PEAK' | 'GOOD' | 'MODERATE' | 'LOW';
    summary: string;
  };
  reasons: string[];
  updatedAtHarare: string;
}

export interface AIChatMessage {
  id: string;
  sender: 'ai' | 'user' | 'alert';
  title?: string;
  text: string;
  timestamp: string;
  verdict?: 'CLEAR_TO_TRADE' | 'CAUTION' | 'DO_NOT_TRADE';
  direction?: 'BUY' | 'SELL' | 'NEUTRAL';
  actionable?: {
    symbol: string;
    direction: 'BUY' | 'SELL';
    entry: number;
    stopLoss: number;
    takeProfit: number;
    lotSize: number;
  };
}

interface AITradingCopilotModalProps {
  symbol: string;
  timeframe: string;
  currentPrice?: number;
  isOpen: boolean;
  onClose: () => void;
  onOpen: () => void;
  onQuickPlaceOrder?: (dir: 'BUY' | 'SELL') => void;
}

export default function AITradingCopilotModal({
  symbol,
  timeframe,
  currentPrice,
  isOpen,
  onClose,
  onOpen,
  onQuickPlaceOrder,
}: AITradingCopilotModalProps) {
  const [report, setReport] = useState<AIClearanceReport | null>(null);
  const [messages, setMessages] = useState<AIChatMessage[]>([]);
  const [inputQuery, setInputQuery] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [soundAlerts, setSoundAlerts] = useState<boolean>(true);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [toastAlert, setToastAlert] = useState<AIChatMessage | null>(null);

  // Synced live parameters from LiveSignalNotificationPanel
  const liveParamsRef = useRef<{
    direction: 'BUY' | 'SELL';
    entry: number;
    stopLoss: number;
    takeProfit: number;
    lotSize: number;
    accountBalance: number;
    riskPercent: number;
    probability: number;
  }>({
    direction: 'BUY',
    entry: currentPrice || 4125.0,
    stopLoss: 4124.2,
    takeProfit: 4126.5,
    lotSize: 0.01,
    accountBalance: 40.45,
    riskPercent: 2.0,
    probability: 92,
  });

  const prevVerdictRef = useRef<string>('');
  const prevDirectionRef = useRef<string>('');
  const prevSymbolRef = useRef<string>('');
  const currentPriceRef = useRef<number | undefined>(currentPrice);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (currentPrice && currentPrice > 0) {
      currentPriceRef.current = currentPrice;
    }
  }, [currentPrice]);

  const isCryptoPair = (sym: string): boolean => {
    const s = sym.toUpperCase();
    return (
      s.includes('BTC') ||
      s.includes('ETH') ||
      s.includes('SOL') ||
      s.includes('XRP') ||
      s.includes('BNB') ||
      s.includes('DOGE') ||
      s.includes('ADA') ||
      s.includes('REXT') ||
      s.includes('USDT')
    );
  };

  const isWeekendMarketClosed = (sym: string): boolean => {
    if (isCryptoPair(sym)) return false; // Crypto trades 24/7 on Exness MT5
    const now = new Date();
    const utcDay = now.getUTCDay();
    const utcHour = now.getUTCHours();
    // Forex, Gold/Metals, Oil & Indices close Friday 22:00 UTC and reopen Sunday 22:00 UTC (00:00 Monday Harare)
    if (utcDay === 6) return true; // All Saturday
    if (utcDay === 0 && utcHour < 22) return true; // Sunday before 22:00 UTC
    if (utcDay === 5 && utcHour >= 22) return true; // Friday after 22:00 UTC
    return false;
  };

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
      s.includes('DE40')
    ) {
      return 2;
    }
    return 5;
  };

  const precision = getPrecision(symbol);

  const playNotificationChime = useCallback(
    (isWarning = false) => {
      if (!soundAlerts || typeof window === 'undefined') return;
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = isWarning ? 'sawtooth' : 'sine';
        osc.frequency.setValueAtTime(isWarning ? 520 : 740, ctx.currentTime);
        osc.frequency.setValueAtTime(isWarning ? 420 : 980, ctx.currentTime + 0.12);
        gain.gain.setValueAtTime(0.06, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.32);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.32);
      } catch {}
    },
    [soundAlerts]
  );

  const pushAIAlert = useCallback(
    (msg: Omit<AIChatMessage, 'id' | 'timestamp'>, isWarning = false) => {
      const harareTime = new Date().toLocaleTimeString('en-US', {
        timeZone: 'Africa/Harare',
        hour12: true,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      const fullMsg: AIChatMessage = {
        ...msg,
        id: Math.random().toString(36).substring(2, 9),
        timestamp: harareTime,
      };
      setMessages((prev) => [...prev.slice(-39), fullMsg]);
      if (!isOpen) {
        setUnreadCount((c) => c + 1);
      }
      setToastAlert(fullMsg);
      playNotificationChime(isWarning);

      // Broadcast unread count & clearance state to header button in page.tsx
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('wessignal-ai-copilot-state', {
            detail: {
              verdict: fullMsg.verdict,
              direction: fullMsg.direction,
              lastAlert: fullMsg.title || fullMsg.text,
            },
          })
        );
      }
    },
    [isOpen, playNotificationChime]
  );

  // Listen for live risk & direction params from LiveSignalNotificationPanel
  useEffect(() => {
    const onLiveParams = (e: Event) => {
      const d = (e as CustomEvent)?.detail;
      if (!d) return;
      liveParamsRef.current = {
        direction: d.direction === 'SELL' ? 'SELL' : 'BUY',
        entry: Number(d.entry || currentPrice || 4125.0),
        stopLoss: Number(d.stopLoss || 0),
        takeProfit: Number(d.takeProfit || 0),
        lotSize: Number(d.lotSize || 0.01),
        accountBalance: Number(d.accountBalance || 40.45),
        riskPercent: Number(d.riskPercent || 2.0),
        probability: Number(d.probability || 92),
      };
    };
    window.addEventListener('wessignal-live-params', onLiveParams);
    return () => window.removeEventListener('wessignal-live-params', onLiveParams);
  }, [currentPrice]);

  // Evaluate session liquidity quality
  const evaluateSessionQuality = (sym: string) => {
    const now = new Date();
    const utcHour = now.getUTCHours();

    if (isWeekendMarketClosed(sym)) {
      return {
        name: 'Weekend Market Closed (Gold / Forex / Indices Standby)',
        quality: 'LOW' as const,
        summary: `${sym} is CLOSED for the weekend on Exness MT5 (reopens Sunday 22:00 UTC / 00:00 Monday Harare). Switch to BTC/USDT, ETH/USDT, or SOL/USDT for 24/7 weekend trading.`,
      };
    }

    if (isCryptoPair(sym) && (now.getUTCDay() === 0 || now.getUTCDay() === 6)) {
      return {
        name: '24/7 Weekend Crypto Liquidity Active',
        quality: 'GOOD' as const,
        summary: `${sym} trades 24/7 through the weekend on Exness MT5 and global spot exchanges.`,
      };
    }

    if (utcHour >= 12 && utcHour < 16) {
      return {
        name: 'London + New York Overlap (Peak Volume)',
        quality: 'PEAK' as const,
        summary: 'Peak institutional liquidity window — highest follow-through on breakouts and trend signals.',
      };
    }
    if (utcHour >= 7 && utcHour < 12) {
      return {
        name: 'London Institutional Session',
        quality: 'PEAK' as const,
        summary: 'Strong European institutional order flow — clean directional trends on Gold & Forex.',
      };
    }
    if (utcHour >= 16 && utcHour < 20) {
      return {
        name: 'New York Session',
        quality: 'GOOD' as const,
        summary: 'Active US session liquidity — watch for NY afternoon profit-taking reversals.',
      };
    }
    return {
      name: 'Asian / Tokyo Session',
      quality: 'MODERATE' as const,
      summary: 'Moderate range-bound liquidity — favor tight TP1–TP2 targets and strict risk-sized Stop Loss.',
    };
  };

  // Run full AI Clearance Analysis (Volatility + News + Direction + Risk)
  const evaluateMarketClearance = useCallback(
    async (announceToChat = false) => {
      setIsAnalyzing(true);
      try {
        const lp = liveParamsRef.current;
        const weekendClosed = isWeekendMarketClosed(symbol);
        const livePriceHint = currentPriceRef.current;

        // 1. Fetch live OHLCV bars & compute 6-factor technical/volatility metrics
        const { bars, source } = await fetchBrowserLiveBars(symbol, timeframe);
        const analysis = computeBrowserSignalAnalysis(
          symbol,
          timeframe,
          bars,
          source,
          livePriceHint && livePriceHint > 0 ? livePriceHint : undefined,
          lp.accountBalance,
          lp.lotSize,
          lp.riskPercent
        );

        const lastBar = bars[bars.length - 1];
        const recent14 = bars.slice(-14);
        const atr =
          recent14.reduce((acc, b) => acc + Math.max(b.high - b.low, 0.00001), 0) /
          Math.max(1, recent14.length);
        const currentRange = lastBar ? Math.abs(lastBar.high - lastBar.low) : atr;
        let volatilityRatio = Number((currentRange / Math.max(atr, 0.00001)).toFixed(2));

        // Calculate RSI(14)
        let gains = 0;
        let losses = 0;
        for (let i = Math.max(1, bars.length - 14); i < bars.length; i++) {
          const diff = bars[i].close - bars[i - 1].close;
          if (diff > 0) gains += diff;
          else losses -= diff;
        }
        const rs = (gains / 14) / Math.max(losses / 14, 0.000001);
        const rsi14 = Number((100 - 100 / (1 + rs)).toFixed(1));

        let volState: AIClearanceReport['volatility']['state'] = 'OPTIMAL';
        let volLabel = 'Optimal Institutional Volatility';
        let volSummary = `ATR(14) is ${atr.toFixed(precision)} with normal bar expansion (${volatilityRatio}x ATR). Ideal conditions for clean entry execution.`;

        if (weekendClosed) {
          volState = 'LOW_LIQUIDITY';
          volatilityRatio = 0;
          volLabel = 'Weekend Market Closed (0 Liquidity)';
          volSummary = `${symbol} spot & MT5 liquidity is CLOSED for the weekend. Price is frozen at Friday's close until Sunday 22:00 UTC (00:00 Monday Harare).`;
        } else if (volatilityRatio >= 2.3) {
          volState = 'EXTREME_WHIPSAW';
          volLabel = 'Extreme Whipsaw / Spike Volatility';
          volSummary = `Current candle range is ${volatilityRatio}x larger than average ATR (${atr.toFixed(precision)}). High slip/whipsaw risk — wait for candle close or use 0.01 Lot.`;
        } else if (volatilityRatio >= 1.7) {
          volState = 'HIGH_VOLATILITY';
          volLabel = 'High Momentum Expansion';
          volSummary = `Active momentum expansion (${volatilityRatio}x ATR). Strong trend velocity — ensure your Risk-Sized Stop Loss ($${analysis.trade_params.stop_loss.toFixed(precision)}) is attached.`;
        } else if (volatilityRatio <= 0.4) {
          volState = 'LOW_LIQUIDITY';
          volLabel = 'Tight Consolidation / Compression';
          volSummary = `Volatility is compressed (${volatilityRatio}x ATR). Market is coiling — take quick profits at TP1/TP2.`;
        }

        // 2. Fetch Market News & Red-Folder Economic Events
        let newsItems: any[] = [];
        let newsRec: any = null;
        try {
          const newsRes = await fetchWithFastTimeout(
            `${API_BASE_URL}/api/news?symbol=${encodeURIComponent(symbol)}`,
            2200
          );
          if (newsRes.ok) {
            const newsData = await newsRes.json();
            if (Array.isArray(newsData?.news)) newsItems = newsData.news;
            if (newsData?.recommendation) newsRec = newsData.recommendation;
          }
        } catch {}

        const highImpactNews = newsItems.filter(
          (n) => String(n.impact || '').toUpperCase() === 'HIGH'
        );
        const warCount = newsItems.filter(
          (n) => String(n.category || '').toUpperCase() === 'WAR'
        ).length;

        let newsStatus: AIClearanceReport['news']['status'] = 'CLEAR';
        let newsLabel = 'No High-Impact News Blockers';
        let newsSummary =
          newsItems.length > 0
            ? `Scanned ${newsItems.length} live macro/market headlines for ${symbol}. No red-folder shock blocking execution.`
            : `No red-folder economic release shock active on ${symbol} right now. Technical order flow is driving price.`;

        if (newsRec?.recommendation === 'HOLD ON' && highImpactNews.length >= 2) {
          newsStatus = 'BLOCKED_HIGH_IMPACT';
          newsLabel = 'High-Impact Geopolitical / Macro Risk Active';
          newsSummary =
            newsRec.directive ||
            `${highImpactNews.length} high-impact news events detected (${warCount} geopolitical). Trade with tight risk or wait for spike stabilization.`;
        } else if (highImpactNews.length === 1) {
          newsStatus = 'WATCH';
          newsLabel = '1 High-Impact Headline Monitored';
          newsSummary = `Headline active: "${highImpactNews[0].title}". Keep hard Stop Loss in place.`;
        }

        const headlines = newsItems.slice(0, 3).map((n) => ({
          title: n.title,
          category: n.category || 'MACRO',
          impact: n.impact || 'MEDIUM',
          sentiment: n.sentiment || 'NEUTRAL',
          time: n.time_harare || 'LIVE',
        }));

        // 3. Session Quality
        const sessionInfo = evaluateSessionQuality(symbol);

        // 4. Synchronize Direction & Risk Calculator Stop Loss
        const isSell = analysis.signal_type === 'SELL/SHORT';
        const direction: 'BUY' | 'SELL' = isSell ? 'SELL' : 'BUY';
        const entryPrice = analysis.trade_params.entry || analysis.latest_price;

        const riskCalc = calculateRiskBasedLevels({
          symbol,
          entryPrice,
          isBuy: !isSell,
          accountBalance: lp.accountBalance,
          lotSize: lp.lotSize,
          riskPercent: lp.riskPercent,
          precision,
        });

        // 5. Compute Overall AI Clearance Verdict & Score
        let score = analysis.probability || 91;
        const reasons: string[] = [];

        if (weekendClosed) {
          score = 0;
          reasons.push(
            `🛑 Weekend Market Closure: ${symbol} is CLOSED on Exness MT5 & global institutional desks during Saturday and Sunday.`
          );
          reasons.push(
            `⏰ Reopen Schedule: ${symbol} reopens Sunday at 22:00 UTC (00:00 Monday Harare Time) when the Sydney/Tokyo session begins.`
          );
          reasons.push(
            `⚡ Want to Trade Right Now? Select a 24/7 Crypto pair (BTC/USDT, ETH/USDT, SOL/USDT, XRP/USDT) from the top bar — Crypto markets are open and live on MT5 all weekend!`
          );
        } else {
          reasons.push(
            `Direction Confluence: ${direction} (${analysis.signal_type}) with ${analysis.probability}% 6-factor alignment.`
          );

          if (volState === 'OPTIMAL' || volState === 'HIGH_VOLATILITY') {
            reasons.push(`Volatility Check: PASSED (${volLabel}, ${volatilityRatio}x ATR).`);
          } else if (volState === 'EXTREME_WHIPSAW') {
            score -= 18;
            reasons.push(
              `Volatility Warning: Whipsaw candle (${volatilityRatio}x ATR) — wait for pullback or trade minimum lot.`
            );
          } else {
            score -= 6;
            reasons.push(`Volatility Note: Quiet consolidation (${volatilityRatio}x ATR) — target TP1/TP2.`);
          }

          if (newsStatus === 'CLEAR') {
            reasons.push(`Market News Check: CLEAR — no red-folder shock blocking ${symbol}.`);
          } else if (newsStatus === 'WATCH') {
            score -= 7;
            reasons.push(`Market News Check: WATCH — 1 macro headline active; hard SL required.`);
          } else {
            score -= 22;
            reasons.push(`Market News Alert: HIGH-IMPACT NEWS RISK (${highImpactNews.length} events).`);
          }

          if ((direction === 'BUY' && rsi14 > 74) || (direction === 'SELL' && rsi14 < 26)) {
            score -= 12;
            reasons.push(
              `RSI(14) Exhaustion Guard: RSI is ${rsi14} (${
                direction === 'BUY' ? 'Overbought' : 'Oversold'
              }) — wait for minor retracement to Entry Zone Z2.`
            );
          } else {
            reasons.push(`RSI(14) Momentum Room: ${rsi14} — clean room to reach TP1 & TP2.`);
          }

          reasons.push(
            `Risk Calculator Protection: $${lp.accountBalance.toFixed(2)} Balance @ ${lp.riskPercent}% Risk ($${riskCalc.actualDollarRisk.toFixed(2)} max loss) -> Hard SL at $${riskCalc.stopLoss.toFixed(precision)}.`
          );
        }

        const clampedScore = weekendClosed ? 0 : Math.max(45, Math.min(98, Math.round(score)));

        let verdict: AIClearanceReport['verdict'] = 'CLEAR_TO_TRADE';
        let verdictTitle = `✅ CLEAR TO ${direction} ${symbol} (${clampedScore}% AI Clearance)`;
        let verdictColor: AIClearanceReport['verdictColor'] = 'emerald';

        if (weekendClosed) {
          verdict = 'DO_NOT_TRADE';
          verdictTitle = `🛑 MARKET CLOSED FOR WEEKEND — ${symbol} Closed Until Sunday 22:00 UTC`;
          verdictColor = 'rose';
        } else if (newsStatus === 'BLOCKED_HIGH_IMPACT' || volState === 'EXTREME_WHIPSAW') {
          verdict = 'CAUTION';
          verdictTitle = `⚠️ CAUTION ON ${symbol}: ${
            newsStatus === 'BLOCKED_HIGH_IMPACT' ? 'HIGH-IMPACT NEWS' : 'VOLATILITY SPIKE'
          } (${clampedScore}%)`;
          verdictColor = 'amber';
        } else if (clampedScore < 65) {
          verdict = 'DO_NOT_TRADE';
          verdictTitle = `🛑 HOLD / STAND BY ON ${symbol} — Wait for Cleaner Setup (${clampedScore}%)`;
          verdictColor = 'rose';
        }

        const harareNow = new Date().toLocaleTimeString('en-US', {
          timeZone: 'Africa/Harare',
          hour12: true,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });

        const newReport: AIClearanceReport = {
          symbol,
          timeframe,
          verdict,
          verdictTitle,
          verdictColor,
          clearanceScore: clampedScore,
          direction,
          signalConfidence: weekendClosed ? 0 : analysis.probability || 91,
          latestPrice: analysis.latest_price,
          entryPrice,
          stopLoss: riskCalc.stopLoss,
          takeProfit1: riskCalc.tp1,
          takeProfit2: riskCalc.tp2,
          slDistance: riskCalc.slDistance,
          maxRiskDollars: riskCalc.actualDollarRisk,
          accountBalance: lp.accountBalance,
          lotSize: lp.lotSize,
          riskPercent: lp.riskPercent,
          volatility: {
            state: volState,
            label: volLabel,
            atr: Number(atr.toFixed(precision)),
            currentRange: Number(currentRange.toFixed(precision)),
            volatilityRatio,
            rsi14,
            summary: volSummary,
          },
          news: {
            status: newsStatus,
            label: newsLabel,
            highImpactCount: highImpactNews.length,
            warCount,
            sentiment:
              newsRec?.bullish_count > newsRec?.bearish_count
                ? 'BULLISH'
                : newsRec?.bearish_count > newsRec?.bullish_count
                ? 'BEARISH'
                : 'NEUTRAL',
            headlines,
            summary: newsSummary,
          },
          session: sessionInfo,
          reasons,
          updatedAtHarare: harareNow,
        };

        setReport(newReport);

        // Broadcast clearance state to header badge
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('wessignal-ai-copilot-state', {
              detail: {
                verdict: newReport.verdict,
                verdictTitle: newReport.verdictTitle,
                clearanceScore: newReport.clearanceScore,
                direction: newReport.direction,
              },
            })
          );
        }

        // Check if we should emit an automatic AI Notification!
        const symbolSwitched = prevSymbolRef.current !== `${symbol}:${timeframe}`;
        const verdictChanged = prevVerdictRef.current !== newReport.verdict;
        const directionFlipped =
          !weekendClosed &&
          prevDirectionRef.current !== '' &&
          prevDirectionRef.current !== newReport.direction &&
          !symbolSwitched;

        prevSymbolRef.current = `${symbol}:${timeframe}`;
        prevVerdictRef.current = newReport.verdict;
        prevDirectionRef.current = weekendClosed ? '' : newReport.direction;

        if (weekendClosed && (symbolSwitched || verdictChanged || announceToChat)) {
          // Clear any stale fake reversal alerts from chat when viewing a closed weekend market
          setMessages([
            {
              id: Math.random().toString(36).substring(2, 9),
              sender: 'ai',
              title: `🛑 WEEKEND MARKET CLOSED: ${symbol} Not Tradable Until Sunday Night`,
              text: `• Market Status: ${symbol} (Gold / Forex / Indices) is CLOSED for the weekend on Exness MT5.\n• Reopens: Sunday 22:00 UTC (00:00 Monday Harare Time).\n• Why Signals Are Paused: No live institutional Gold/Forex ticks or reversals occur over the weekend.\n• 💡 Trade 24/7 Right Now: Click BTC/USDT, ETH/USDT, or SOL/USDT at the top of the screen — Crypto markets are open 24/7 on Exness MT5!`,
              timestamp: harareNow,
              verdict: 'DO_NOT_TRADE',
              direction: newReport.direction,
            },
          ]);
        } else if (directionFlipped) {
          pushAIAlert(
            {
              sender: 'alert',
              title: `🔄 AI MARKET REVERSAL ALERT: ${symbol} Flipped to ${newReport.direction}!`,
              text: `Market order flow on ${symbol} (${timeframe.toUpperCase()}) just reversed to ${newReport.direction} at $${newReport.latestPrice.toFixed(precision)}. Do NOT hold opposing trades! New Risk-Sized SL (${lp.riskPercent}% of $${lp.accountBalance.toFixed(2)}): $${newReport.stopLoss.toFixed(precision)} | TP1: $${newReport.takeProfit1.toFixed(precision)}.`,
              verdict: newReport.verdict,
              direction: newReport.direction,
              actionable: {
                symbol,
                direction: newReport.direction,
                entry: newReport.entryPrice,
                stopLoss: newReport.stopLoss,
                takeProfit: newReport.takeProfit1,
                lotSize: lp.lotSize,
              },
            },
            true
          );
        } else if (!weekendClosed && (symbolSwitched || verdictChanged || announceToChat)) {
          pushAIAlert(
            {
              sender: 'ai',
              title: newReport.verdictTitle,
              text: `• Volatility: ${newReport.volatility.label} (${newReport.volatility.volatilityRatio}x ATR, RSI ${newReport.volatility.rsi14})\n• News Status: ${newReport.news.label}\n• Session: ${newReport.session.name}\n• Trade Setup: ${newReport.direction} ${symbol} @ $${newReport.entryPrice.toFixed(precision)} | SL: $${newReport.stopLoss.toFixed(precision)} (-$${newReport.maxRiskDollars.toFixed(2)}) | TP1: $${newReport.takeProfit1.toFixed(precision)}`,
              verdict: newReport.verdict,
              direction: newReport.direction,
              actionable:
                newReport.verdict !== 'DO_NOT_TRADE'
                  ? {
                      symbol,
                      direction: newReport.direction,
                      entry: newReport.entryPrice,
                      stopLoss: newReport.stopLoss,
                      takeProfit: newReport.takeProfit1,
                      lotSize: lp.lotSize,
                    }
                  : undefined,
            },
            newReport.verdict !== 'CLEAR_TO_TRADE'
          );
        }
      } catch (e) {
        console.error('AI Clearance evaluation error:', e);
      } finally {
        setIsAnalyzing(false);
      }
    },
    [symbol, timeframe, precision, pushAIAlert]
  );

  // Run initial evaluation and periodic 12-second background monitoring
  useEffect(() => {
    evaluateMarketClearance(false);
    const interval = setInterval(() => {
      evaluateMarketClearance(false);
    }, 12000);
    return () => clearInterval(interval);
  }, [evaluateMarketClearance]);

  // Clear unread badge when chat opens
  useEffect(() => {
    if (isOpen) {
      setUnreadCount(0);
      setToastAlert(null);
    }
  }, [isOpen]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (isOpen && chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  // Handle user natural-language question in the AI Chat
  const handleAskQuestion = async (customPrompt?: string) => {
    const q = (customPrompt ?? inputQuery).trim();
    if (!q) return;
    if (!customPrompt) setInputQuery('');

    const harareNow = new Date().toLocaleTimeString('en-US', {
      timeZone: 'Africa/Harare',
      hour12: true,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    const userMsg: AIChatMessage = {
      id: Math.random().toString(36).substring(2, 9),
      sender: 'user',
      text: q,
      timestamp: harareNow,
    };
    setMessages((prev) => [...prev.slice(-39), userMsg]);

    // Ensure report is fresh
    if (!report) {
      await evaluateMarketClearance(true);
      return;
    }

    const r = report;
    const weekendClosed = isWeekendMarketClosed(symbol);
    const lower = q.toLowerCase();
    let replyTitle = r.verdictTitle;
    let replyBody = '';

    if (weekendClosed && !lower.includes('stop loss') && !lower.includes('sl') && !lower.includes('risk') && !lower.includes('balance') && !lower.includes('news')) {
      replyTitle = `🛑 WEEKEND MARKET CLOSED: Do Not Trade ${symbol} Right Now`;
      replyBody = `NO — ${symbol} is CLOSED for the weekend on Exness MT5 and global spot desks.\n\n• Market Reopens: Sunday at 22:00 UTC (00:00 Monday Harare Time).\n• Why: Institutional Gold, Forex, and Index liquidity is offline on Saturdays and Sundays, so no real market reversals or entries occur.\n• 💡 Want to Trade Right Now? Click BTC/USDT, ETH/USDT, or SOL/USDT in the top asset bar — Crypto markets trade 24/7 on Exness MT5 all weekend!`;
    } else if (lower.includes('clear') || lower.includes('safe') || lower.includes('trade now') || lower.includes('can i trade')) {
      replyTitle = r.verdictTitle;
      replyBody =
        r.verdict === 'CLEAR_TO_TRADE'
          ? `YES — ${symbol} (${timeframe.toUpperCase()}) is CLEAR TO ${r.direction} right now (${r.clearanceScore}% clearance score).\n\n1. Volatility: ${r.volatility.label} (${r.volatility.volatilityRatio}x ATR, RSI ${r.volatility.rsi14}).\n2. Market News: ${r.news.label}.\n3. Session: ${r.session.name}.\n4. Exact Risk-Sized Order: ${r.direction} @ $${r.entryPrice.toFixed(precision)} | Stop Loss: $${r.stopLoss.toFixed(precision)} (Max loss $${r.maxRiskDollars.toFixed(2)} on $${r.accountBalance.toFixed(2)} balance) | TP1: $${r.takeProfit1.toFixed(precision)}.`
          : `NO / STAND BY — ${r.verdictTitle}.\n\n• Volatility: ${r.volatility.summary}\n• News: ${r.news.summary}\n• Session: ${r.session.summary}`;
    } else if (lower.includes('volatil') || lower.includes('atr') || lower.includes('chop') || lower.includes('whipsaw')) {
      replyTitle = `📊 Volatility Report for ${symbol} (${timeframe.toUpperCase()}): ${r.volatility.label}`;
      replyBody = `${r.volatility.summary}\n\n• 14-Bar ATR: ${r.volatility.atr.toFixed(precision)}\n• Current Candle Range: ${r.volatility.currentRange.toFixed(precision)} (${r.volatility.volatilityRatio}x ATR)\n• RSI(14): ${r.volatility.rsi14}\n• Active Session: ${r.session.name} — ${r.session.summary}`;
    } else if (lower.includes('news') || lower.includes('event') || lower.includes('calendar') || lower.includes('war') || lower.includes('cpi')) {
      replyTitle = `📰 Market News & Economic Scan (${symbol}): ${r.news.label}`;
      const headlineList =
        r.news.headlines.length > 0
          ? r.news.headlines
              .map((h, i) => `${i + 1}. [${h.impact}/${h.sentiment}] ${h.title} (${h.time})`)
              .join('\n')
          : '• No high-impact red-folder headlines blocking execution in the current window.';
      replyBody = `${r.news.summary}\n\nLatest Headlines:\n${headlineList}`;
    } else if (lower.includes('stop loss') || lower.includes('sl') || lower.includes('risk') || lower.includes('balance') || lower.includes('lot')) {
      replyTitle = `🛡️ Dynamic Risk-Calculator Stop Loss ($${r.accountBalance.toFixed(2)} Balance)`;
      replyBody = `For your $${r.accountBalance.toFixed(2)} account balance at ${r.riskPercent}% risk and ${r.lotSize} Lot:\n\n• Max Allowed Loss: $${r.maxRiskDollars.toFixed(2)}\n• Exact Stop Loss Distance: ${r.slDistance.toFixed(precision)} pts\n• Reference ${r.direction} Entry: $${r.entryPrice.toFixed(precision)}\n• Hard Stop Loss Price: $${r.stopLoss.toFixed(precision)}\n• Take Profit 1 (1.2R): $${r.takeProfit1.toFixed(precision)}\n• Take Profit 2 (2.0R): $${r.takeProfit2.toFixed(precision)}`;
    } else if (lower.includes('direction') || lower.includes('buy') || lower.includes('sell') || lower.includes('trend') || lower.includes('revers')) {
      replyTitle = `🧭 6-Factor Market Direction Verdict: ${r.direction} ${symbol} (${r.signalConfidence}%)`;
      replyBody = `The system's 6-Factor Direction Engine currently dictates ${r.direction} on ${symbol} (${timeframe.toUpperCase()}).\n\n${r.reasons.map((item) => `• ${item}`).join('\n')}\n\nRemember: If order flow reverses against ${r.direction}, the bot will immediately alert you and auto-close any wrong-way MT5 trade.`;
    } else {
      replyTitle = r.verdictTitle;
      replyBody = `${r.reasons.map((item) => `• ${item}`).join('\n')}\n\n• Entry: $${r.entryPrice.toFixed(precision)} | Hard SL: $${r.stopLoss.toFixed(precision)} | TP1: $${r.takeProfit1.toFixed(precision)}`;
    }

    const aiReply: AIChatMessage = {
      id: Math.random().toString(36).substring(2, 9),
      sender: 'ai',
      title: replyTitle,
      text: replyBody,
      timestamp: harareNow,
      verdict: r.verdict,
      direction: r.direction,
      actionable:
        !weekendClosed && r.verdict !== 'DO_NOT_TRADE'
          ? {
              symbol,
              direction: r.direction,
              entry: r.entryPrice,
              stopLoss: r.stopLoss,
              takeProfit: r.takeProfit1,
              lotSize: r.lotSize,
            }
          : undefined,
    };
    setMessages((prev) => [...prev.slice(-39), aiReply]);
  };

  const quickPrompts = [
    'Is it clear to trade right now?',
    'How is market volatility & ATR?',
    'Any market news or red-folder events?',
    'Should I BUY or SELL right now?',
    'What is my Stop Loss for my balance?',
  ];

  return (
    <>
      {/* ── FLOATING BOTTOM-RIGHT AI COPILOT BUTTON + LIVE NOTIFICATION TOAST ── */}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-2.5 max-w-sm">
        {/* Live Pop-Up Notification Toast when Chat is Closed */}
        {!isOpen && toastAlert && (
          <div
            onClick={onOpen}
            className={`cursor-pointer p-3 rounded-xl border-2 shadow-2xl backdrop-blur-md transition-all animate-in fade-in slide-in-from-bottom-4 ${
              toastAlert.verdict === 'CLEAR_TO_TRADE'
                ? 'bg-emerald-950/95 border-emerald-400 text-emerald-100'
                : toastAlert.verdict === 'DO_NOT_TRADE'
                ? 'bg-rose-950/95 border-rose-400 text-rose-100'
                : 'bg-indigo-950/95 border-indigo-400 text-indigo-100'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-1.5 font-mono text-[11px] font-black">
                <Bell className="w-3.5 h-3.5 text-amber-300 animate-bounce shrink-0" />
                <span>{toastAlert.title || '🤖 AI Trade Copilot Alert'}</span>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setToastAlert(null);
                }}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-[10px] text-slate-200 mt-1 line-clamp-2 font-sans">
              {toastAlert.text}
            </p>
            <div className="mt-1.5 flex items-center justify-between text-[9px] font-mono text-amber-300">
              <span>{toastAlert.timestamp}</span>
              <span className="underline font-bold">Click to open AI Chat →</span>
            </div>
          </div>
        )}

        {/* Floating AI Chat Launcher Pill */}
        <button
          type="button"
          onClick={isOpen ? onClose : onOpen}
          className={`group relative flex items-center gap-2.5 px-4 py-3 rounded-2xl font-mono text-xs font-black shadow-2xl border-2 transition-all ${
            report?.verdict === 'CLEAR_TO_TRADE'
              ? 'bg-gradient-to-r from-emerald-600 via-teal-600 to-indigo-700 border-emerald-300 text-white hover:scale-105'
              : report?.verdict === 'DO_NOT_TRADE'
              ? 'bg-gradient-to-r from-rose-700 to-red-800 border-rose-300 text-white hover:scale-105'
              : 'bg-gradient-to-r from-indigo-600 via-blue-600 to-violet-700 border-indigo-300 text-white hover:scale-105'
          }`}
        >
          <div className="relative">
            <Bot className="w-5 h-5 text-amber-300" />
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
          </div>
          <div className="text-left leading-tight">
            <div className="flex items-center gap-1.5">
              <span>AI TRADE COPILOT</span>
              {report && (
                <span className="px-1.5 py-0.2 rounded bg-slate-950/70 text-[9.5px] font-extrabold text-amber-300">
                  {report.clearanceScore}%
                </span>
              )}
            </div>
            <div className="text-[9.5px] font-normal opacity-95">
              {report
                ? report.verdict === 'CLEAR_TO_TRADE'
                  ? `🟢 CLEAR TO ${report.direction} ${symbol}`
                  : report.verdict === 'CAUTION'
                  ? `⚠️ CAUTION: ${symbol}`
                  : `🛑 HOLD ON ${symbol}`
                : 'Scanning Volatility & News...'}
            </div>
          </div>

          {unreadCount > 0 && (
            <span className="ml-1 px-2 py-0.5 rounded-full bg-rose-500 text-white text-[10px] font-black animate-bounce border border-white">
              {unreadCount}
            </span>
          )}
        </button>
      </div>

      {/* ── AI TRADING COPILOT SLIDE-OVER / MODAL CHAT SCREEN ── */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/70 backdrop-blur-sm p-2 sm:p-4">
          <div className="bg-slate-950 border-2 border-indigo-500/80 rounded-2xl w-full max-w-xl h-[92vh] flex flex-col shadow-2xl overflow-hidden font-mono">
            {/* Modal Top Header */}
            <div className="bg-gradient-to-r from-indigo-950 via-slate-900 to-emerald-950/80 p-3.5 border-b border-indigo-800/80 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-indigo-600/30 border border-indigo-400/60">
                  <Bot className="w-5 h-5 text-amber-300" />
                </div>
                <div>
                  <h2 className="text-sm font-black text-white flex items-center gap-2">
                    <span>AI Trading Copilot & Clearance Desk</span>
                    <span className="text-[9.5px] px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-700">
                      LIVE 24/7
                    </span>
                  </h2>
                  <p className="text-[10px] text-slate-300 font-sans">
                    Real-time Volatility (ATR) • Red-Folder News • 6-Factor Direction • Risk SL Alerts
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => evaluateMarketClearance(true)}
                  disabled={isAnalyzing}
                  className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-sky-300 text-[10px] flex items-center gap-1"
                  title="Re-scan Market Volatility & News Now"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isAnalyzing ? 'animate-spin' : ''}`} />
                  <span>Scan</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSoundAlerts(!soundAlerts)}
                  className={`p-1.5 rounded-lg border ${
                    soundAlerts
                      ? 'bg-indigo-950 border-indigo-600 text-indigo-300'
                      : 'bg-slate-900 border-slate-800 text-slate-500'
                  }`}
                  title={soundAlerts ? 'Mute AI Voice/Chime Alerts' : 'Enable AI Sound Alerts'}
                >
                  {soundAlerts ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="p-1.5 rounded-lg bg-slate-900 hover:bg-rose-900/60 border border-slate-700 text-slate-300 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* ── LIVE MARKET CLEARANCE SCORECARD (VOLATILITY + NEWS + DIRECTION + RISK) ── */}
            {report && (
              <div className="p-3 bg-slate-900/95 border-b border-slate-800 space-y-2.5 shrink-0">
                {/* Main Clearance Banner */}
                <div
                  className={`p-2.5 rounded-xl border-2 flex items-center justify-between ${
                    report.verdict === 'CLEAR_TO_TRADE'
                      ? 'bg-emerald-950/90 border-emerald-500 text-emerald-100'
                      : report.verdict === 'DO_NOT_TRADE'
                      ? 'bg-rose-950/90 border-rose-500 text-rose-100'
                      : 'bg-amber-950/90 border-amber-500 text-amber-100'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {report.verdict === 'CLEAR_TO_TRADE' ? (
                      <ShieldCheck className="w-6 h-6 text-emerald-400 shrink-0" />
                    ) : report.verdict === 'DO_NOT_TRADE' ? (
                      <XCircle className="w-6 h-6 text-rose-400 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-6 h-6 text-amber-400 shrink-0" />
                    )}
                    <div>
                      <div className="text-xs font-black tracking-wide">{report.verdictTitle}</div>
                      <div className="text-[10px] opacity-90 font-sans">
                        Active Pair: <strong>{symbol}</strong> ({timeframe.toUpperCase()}) • Live Price:{' '}
                        <strong>${report.latestPrice.toFixed(precision)}</strong> • Updated {report.updatedAtHarare}
                      </div>
                    </div>
                  </div>

                  {onQuickPlaceOrder && report.verdict !== 'DO_NOT_TRADE' && (
                    <button
                      type="button"
                      onClick={() => onQuickPlaceOrder(report.direction === 'SELL' ? 'SELL' : 'BUY')}
                      className={`px-3 py-1.5 rounded-lg text-[10.5px] font-black shadow-lg border flex items-center gap-1 shrink-0 ${
                        report.direction === 'SELL'
                          ? 'bg-rose-600 hover:bg-rose-500 border-rose-300 text-white'
                          : 'bg-emerald-600 hover:bg-emerald-500 border-emerald-300 text-white'
                      }`}
                    >
                      <Play className="w-3 h-3 fill-white" />
                      <span>
                        {report.direction} NOW
                      </span>
                    </button>
                  )}
                </div>

                {/* 3-Pillar Grid: Volatility | Market News | Session & Risk SL */}
                <div className="grid grid-cols-3 gap-2 text-[10px]">
                  {/* Pillar 1: Volatility */}
                  <div className="bg-slate-950 border border-slate-800 rounded-lg p-2 space-y-0.5">
                    <div className="flex items-center justify-between text-slate-400 text-[9px]">
                      <span className="flex items-center gap-1 font-bold">
                        <Activity className="w-3 h-3 text-sky-400" /> VOLATILITY
                      </span>
                      <span
                        className={`font-bold ${
                          report.volatility.state === 'OPTIMAL'
                            ? 'text-emerald-400'
                            : report.volatility.state === 'EXTREME_WHIPSAW'
                            ? 'text-rose-400'
                            : 'text-amber-300'
                        }`}
                      >
                        {report.volatility.volatilityRatio}x ATR
                      </span>
                    </div>
                    <div className="font-bold text-white truncate" title={report.volatility.label}>
                      {report.volatility.label}
                    </div>
                    <div className="text-[9px] text-slate-400">
                      ATR: {report.volatility.atr.toFixed(precision)} · RSI: {report.volatility.rsi14}
                    </div>
                  </div>

                  {/* Pillar 2: Market News */}
                  <div className="bg-slate-950 border border-slate-800 rounded-lg p-2 space-y-0.5">
                    <div className="flex items-center justify-between text-slate-400 text-[9px]">
                      <span className="flex items-center gap-1 font-bold">
                        <Newspaper className="w-3 h-3 text-amber-400" /> MARKET NEWS
                      </span>
                      <span
                        className={`font-bold ${
                          report.news.status === 'CLEAR'
                            ? 'text-emerald-400'
                            : report.news.status === 'BLOCKED_HIGH_IMPACT'
                            ? 'text-rose-400'
                            : 'text-amber-300'
                        }`}
                      >
                        {report.news.status}
                      </span>
                    </div>
                    <div className="font-bold text-white truncate" title={report.news.label}>
                      {report.news.label}
                    </div>
                    <div className="text-[9px] text-slate-400">
                      High-Impact: {report.news.highImpactCount} · Geo/War: {report.news.warCount}
                    </div>
                  </div>

                  {/* Pillar 3: Risk-Sized SL & Session */}
                  <div className="bg-slate-950 border border-slate-800 rounded-lg p-2 space-y-0.5">
                    <div className="flex items-center justify-between text-slate-400 text-[9px]">
                      <span className="flex items-center gap-1 font-bold">
                        <Clock className="w-3 h-3 text-emerald-400" /> RISK & SL
                      </span>
                      <span className="text-emerald-300 font-bold">
                        -${report.maxRiskDollars.toFixed(2)}
                      </span>
                    </div>
                    <div className="font-bold text-rose-300 truncate">
                      SL: ${report.stopLoss.toFixed(precision)}
                    </div>
                    <div className="text-[9px] text-slate-400 truncate">
                      Bal: ${report.accountBalance.toFixed(0)} · TP1: ${report.takeProfit1.toFixed(precision)}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── CONVERSATIONAL AI CHAT & LIVE NOTIFICATIONS STREAM ── */}
            <div className="flex-1 overflow-y-auto p-3.5 space-y-3 bg-slate-950">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex flex-col ${
                    m.sender === 'user' ? 'items-end' : 'items-start'
                  }`}
                >
                  <div
                    className={`max-w-[92%] rounded-xl p-3 border text-xs space-y-1.5 ${
                      m.sender === 'user'
                        ? 'bg-blue-600/90 border-blue-400 text-white'
                        : m.sender === 'alert'
                        ? 'bg-amber-950/90 border-amber-400 text-amber-100'
                        : m.verdict === 'CLEAR_TO_TRADE'
                        ? 'bg-slate-900 border-emerald-500/70 text-slate-100'
                        : m.verdict === 'DO_NOT_TRADE'
                        ? 'bg-slate-900 border-rose-500/70 text-slate-100'
                        : 'bg-slate-900 border-indigo-500/70 text-slate-100'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3 text-[9.5px] opacity-80 border-b border-white/10 pb-1">
                      <span className="font-bold flex items-center gap-1">
                        {m.sender === 'user' ? (
                          '👤 YOU'
                        ) : m.sender === 'alert' ? (
                          <>
                            <Bell className="w-3 h-3 text-amber-300" />
                            <span>LIVE AI NOTIFICATION</span>
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3 h-3 text-emerald-300" />
                            <span>WESSIGNAL AI COPILOT</span>
                          </>
                        )}
                      </span>
                      <span>{m.timestamp}</span>
                    </div>

                    {m.title && (
                      <div className="font-black text-white text-xs leading-snug">
                        {m.title}
                      </div>
                    )}

                    <div className="text-[11px] leading-relaxed whitespace-pre-line font-sans text-slate-200">
                      {m.text}
                    </div>

                    {m.actionable && onQuickPlaceOrder && (
                      <div className="pt-1.5 flex items-center justify-between gap-2 border-t border-slate-800">
                        <span className="text-[9.5px] text-slate-400 font-mono">
                          SL: ${m.actionable.stopLoss.toFixed(precision)} · TP1: ${m.actionable.takeProfit.toFixed(precision)}
                        </span>
                        <button
                          type="button"
                          onClick={() => onQuickPlaceOrder(m.actionable!.direction)}
                          className={`px-2.5 py-1 rounded text-[10px] font-black text-white flex items-center gap-1 ${
                            m.actionable.direction === 'SELL'
                              ? 'bg-rose-600 hover:bg-rose-500'
                              : 'bg-emerald-600 hover:bg-emerald-500'
                          }`}
                        >
                          <Play className="w-3 h-3 fill-white" />
                          <span>
                            Execute {m.actionable.direction} {m.actionable.symbol} ({m.actionable.lotSize} Lot)
                          </span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            {/* ── QUICK-ASK CHIPS & CHAT INPUT BOX ── */}
            <div className="p-3 bg-slate-900 border-t border-slate-800 space-y-2 shrink-0">
              <div className="flex flex-wrap gap-1.5">
                {quickPrompts.map((qp) => (
                  <button
                    key={qp}
                    type="button"
                    onClick={() => handleAskQuestion(qp)}
                    className="px-2.5 py-1 rounded-full bg-slate-950 hover:bg-indigo-950 border border-slate-700 hover:border-indigo-400 text-[10px] text-slate-200 transition"
                  >
                    {qp}
                  </button>
                ))}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleAskQuestion();
                }}
                className="flex items-center gap-2"
              >
                <input
                  type="text"
                  value={inputQuery}
                  onChange={(e) => setInputQuery(e.target.value)}
                  placeholder={`Ask AI Copilot about ${symbol} volatility, news, SL, or whether it's clear to trade...`}
                  className="flex-1 bg-slate-950 border border-slate-700 focus:border-indigo-400 rounded-xl px-3 py-2 text-xs text-white focus:outline-none font-sans"
                />
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white text-xs font-black flex items-center gap-1.5 shadow-lg"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Ask AI</span>
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
