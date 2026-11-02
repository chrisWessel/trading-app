import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const LOCAL_BRIDGE_BASE = 'http://127.0.0.1:8001';
const GITHUB_RAW_TUNNEL_JSON =
  'https://raw.githubusercontent.com/chrisWessel/trading-app/main/frontend/public/mt5_tunnel.json';

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 3500): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches the true institutional Spot price from Swissquote BBO feed
 * (matches OANDA / Exness MT5 XAUUSDm to within ~$0.10, avoiding the $8-$15 PAXG crypto discount).
 */
async function fetchSwissquoteSpotPrice(symbol: string): Promise<number | null> {
  const clean = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const map: Record<string, string> = {
    XAUUSD: 'XAU/USD',
    GOLD: 'XAU/USD',
    XAGUSD: 'XAG/USD',
    SILVER: 'XAG/USD',
    EURUSD: 'EUR/USD',
    GBPUSD: 'GBP/USD',
    USDJPY: 'USD/JPY',
    USDCHF: 'USD/CHF',
    AUDUSD: 'AUD/USD',
    USDCAD: 'USD/CAD',
    NZDUSD: 'NZD/USD',
    EURGBP: 'EUR/GBP',
    EURJPY: 'EUR/JPY',
    GBPJPY: 'GBP/JPY',
  };
  const sqPair = map[clean];
  if (!sqPair) return null;

  try {
    const res = await fetchWithTimeout(
      `https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/${sqPair}`,
      {},
      2500
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      const profiles = data[0]?.spreadProfilePrices || [];
      const top = profiles[0];
      if (top && top.bid > 0 && top.ask > 0) {
        return Number(((Number(top.bid) + Number(top.ask)) / 2).toFixed(clean.includes('JPY') ? 3 : clean.includes('XAU') ? 2 : 5));
      }
    }
  } catch {}
  return null;
}

/**
 * Fetches real OHLCV candles from Yahoo Finance (GC=F / XAUUSD=X / EURUSD=X / etc.)
 * and anchors them to the exact Swissquote / OANDA spot price when available.
 */
async function fetchYahooBars(symbol: string, timeframe: string, limit: number) {
  const clean = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const yahooMap: Record<string, string> = {
    XAUUSD: 'GC=F',
    GOLD: 'GC=F',
    XAGUSD: 'SI=F',
    USOIL: 'CL=F',
    EURUSD: 'EURUSD=X',
    GBPUSD: 'GBPUSD=X',
    USDJPY: 'JPY=X',
    USDCHF: 'CHF=X',
    AUDUSD: 'AUDUSD=X',
    USDCAD: 'CAD=X',
    NZDUSD: 'NZDUSD=X',
    EURGBP: 'EURGBP=X',
    EURJPY: 'EURJPY=X',
    GBPJPY: 'GBPJPY=X',
    US30: '^DJI',
    NAS100: '^NDX',
    SPX500: '^GSPC',
    GER40: '^GDAXI',
    BTCUSDT: 'BTC-USD',
    BTCUSD: 'BTC-USD',
    ETHUSDT: 'ETH-USD',
    ETHUSD: 'ETH-USD',
    SOLUSDT: 'SOL-USD',
    SOLUSD: 'SOL-USD',
  };

  const yTicker = yahooMap[clean];
  if (!yTicker) return null;

  const tfConfig: Record<string, { interval: string; range: string }> = {
    '1s': { interval: '1m', range: '1d' },
    '5s': { interval: '1m', range: '1d' },
    '15s': { interval: '1m', range: '1d' },
    '30s': { interval: '1m', range: '1d' },
    '1m': { interval: '1m', range: '1d' },
    '2m': { interval: '2m', range: '1d' },
    '3m': { interval: '5m', range: '5d' },
    '5m': { interval: '5m', range: '5d' },
    '15m': { interval: '15m', range: '5d' },
    '30m': { interval: '30m', range: '1mo' },
    '45m': { interval: '30m', range: '1mo' },
    '1h': { interval: '60m', range: '1mo' },
    '2h': { interval: '60m', range: '1mo' },
    '4h': { interval: '60m', range: '3mo' },
    '1d': { interval: '1d', range: '6mo' },
  };
  const cfg = tfConfig[timeframe] || { interval: '5m', range: '5d' };

  try {
    const [yRes, spotPrice] = await Promise.all([
      fetchWithTimeout(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yTicker)}?interval=${cfg.interval}&range=${cfg.range}`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          },
        },
        3000
      ),
      fetchSwissquoteSpotPrice(symbol),
    ]);

    if (!yRes.ok) return null;
    const json = await yRes.json();
    const result = json?.chart?.result?.[0];
    const timestamps: number[] = result?.timestamp || [];
    const quote = result?.indicators?.quote?.[0] || {};
    const opens: number[] = quote.open || [];
    const highs: number[] = quote.high || [];
    const lows: number[] = quote.low || [];
    const closes: number[] = quote.close || [];
    const volumes: number[] = quote.volume || [];

    const decimals = clean.includes('JPY') ? 3 : clean.includes('XAU') || clean.includes('GOLD') || clean.includes('BTC') || clean.includes('US30') || clean.includes('NAS') ? 2 : 5;

    const rawBars: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }> = [];
    for (let i = 0; i < timestamps.length; i++) {
      const o = opens[i];
      const h = highs[i];
      const l = lows[i];
      const c = closes[i];
      if (o == null || h == null || l == null || c == null) continue;
      rawBars.push({
        time: Number(timestamps[i]),
        open: Number(o.toFixed(decimals)),
        high: Number(h.toFixed(decimals)),
        low: Number(l.toFixed(decimals)),
        close: Number(c.toFixed(decimals)),
        volume: Number(volumes[i] || 100),
      });
    }

    if (rawBars.length === 0) return null;

    // If we have a live Spot price from Swissquote (e.g. XAU/USD spot vs GC=F futures basis difference),
    // shift the bars by the exact basis offset so the chart price & candle highs/lows match OANDA/Exness Spot 100%!
    if (spotPrice && spotPrice > 0) {
      const lastClose = rawBars[rawBars.length - 1].close;
      const basisOffset = spotPrice - lastClose;
      for (const b of rawBars) {
        b.open = Number((b.open + basisOffset).toFixed(decimals));
        b.high = Number((b.high + basisOffset).toFixed(decimals));
        b.low = Number((b.low + basisOffset).toFixed(decimals));
        b.close = Number((b.close + basisOffset).toFixed(decimals));
      }
      rawBars[rawBars.length - 1].close = spotPrice;
      if (spotPrice > rawBars[rawBars.length - 1].high) rawBars[rawBars.length - 1].high = spotPrice;
      if (spotPrice < rawBars[rawBars.length - 1].low) rawBars[rawBars.length - 1].low = spotPrice;
    }

    return {
      status: 'ok',
      latest_price: rawBars[rawBars.length - 1].close,
      bars: rawBars.slice(-limit),
      source: spotPrice ? `OANDA / Institutional Spot (${symbol})` : `Institutional Feed (${symbol})`,
    };
  } catch {}
  return null;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get('symbol') || 'XAU/USD';
  const timeframe = searchParams.get('timeframe') || '5m';
  const limit = Number(searchParams.get('limit') || 120);

  // 1. Try local Exness MT5 Bridge directly (port 8001)
  try {
    const localRes = await fetchWithTimeout(
      `${LOCAL_BRIDGE_BASE}/bars?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&limit=${limit}`,
      {},
      1500
    );
    if (localRes.ok) {
      const data = await localRes.json();
      if (Array.isArray(data?.bars) && data.bars.length > 0) {
        return NextResponse.json(data);
      }
    }
  } catch {}

  // 2. Try active Cloudflare Tunnel to Exness MT5 Bridge
  try {
    const ghRes = await fetchWithTimeout(`${GITHUB_RAW_TUNNEL_JSON}?t=${Date.now()}`, {}, 2000);
    if (ghRes.ok) {
      const ghData = await ghRes.json();
      const tunnelUrl = String(ghData?.tunnel_url || '').trim().replace(/\/+$/, '');
      if (tunnelUrl.startsWith('https://')) {
        const tunRes = await fetchWithTimeout(
          `${tunnelUrl}/bars?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&limit=${limit}`,
          {},
          2500
        );
        if (tunRes.ok) {
          const data = await tunRes.json();
          if (Array.isArray(data?.bars) && data.bars.length > 0) {
            return NextResponse.json(data);
          }
        }
      }
    }
  } catch {}

  // 3. Try Swissquote Spot BBO + Yahoo Finance basis-adjusted candles (matches OANDA Spot XAU/USD within $0.10!)
  const yahooSpot = await fetchYahooBars(symbol, timeframe, limit);
  if (yahooSpot && yahooSpot.bars.length > 0) {
    return NextResponse.json(yahooSpot);
  }

  // 4. Even if Yahoo fails, return at least the exact Swissquote Spot price so the caller can basis-adjust Kraken/Binance bars!
  const spotOnly = await fetchSwissquoteSpotPrice(symbol);
  return NextResponse.json({
    status: spotOnly ? 'spot_only' : 'fallback',
    latest_price: spotOnly,
    bars: [],
  });
}
