import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const DEFAULT_SECRET_TOKEN =
  process.env.MT5_BRIDGE_SECRET_TOKEN ||
  'wessignal_mt5_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a';

const GITHUB_RAW_TUNNEL_JSON =
  'https://raw.githubusercontent.com/chrisWessel/trading-app/main/frontend/public/mt5_tunnel.json';

const LOCAL_BRIDGE_BASE = 'http://127.0.0.1:8001';

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 6000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' });
  } finally {
    clearTimeout(timer);
  }
}

async function resolveActiveBridgeBaseUrl(): Promise<{ baseUrl: string; source: string }> {
  // 1. Check if running locally where 127.0.0.1:8001 is directly reachable
  try {
    const localRes = await fetchWithTimeout(
      `${LOCAL_BRIDGE_BASE}/health`,
      { headers: { Authorization: `Bearer ${DEFAULT_SECRET_TOKEN}` } },
      1200
    );
    if (localRes.ok) {
      return { baseUrl: LOCAL_BRIDGE_BASE, source: 'local_8001' };
    }
  } catch {}

  // 2. Fetch latest tunnel URL pushed to GitHub main branch (instant update even before Vercel rebuilds)
  try {
    const ghRes = await fetchWithTimeout(
      `${GITHUB_RAW_TUNNEL_JSON}?t=${Date.now()}`,
      {},
      3000
    );
    if (ghRes.ok) {
      const data = await ghRes.json();
      const tunnelUrl = String(data?.tunnel_url || '').trim().replace(/\/+$/, '');
      if (tunnelUrl.startsWith('https://')) {
        return { baseUrl: tunnelUrl, source: 'github_synced_tunnel' };
      }
    }
  } catch {}

  // 3. Fallback to MT5_BRIDGE_URL environment variable if set in Vercel
  const envUrl = (process.env.MT5_BRIDGE_URL || '').trim().replace(/\/webhook\/mt5\/?$/, '').replace(/\/+$/, '');
  if (envUrl.startsWith('http')) {
    return { baseUrl: envUrl, source: 'vercel_env' };
  }

  return {
    baseUrl: 'https://minneapolis-citizen-varied-musical.trycloudflare.com',
    source: 'default_tunnel',
  };
}

export async function GET() {
  try {
    const { baseUrl, source } = await resolveActiveBridgeBaseUrl();
    const res = await fetchWithTimeout(
      `${baseUrl}/health`,
      {
        headers: {
          Authorization: `Bearer ${DEFAULT_SECRET_TOKEN}`,
        },
      },
      5000
    );
    const json = await res.json().catch(() => ({}));
    return NextResponse.json(
      {
        ...json,
        resolved_bridge_url: baseUrl,
        resolution_source: source,
      },
      { status: res.ok ? 200 : res.status }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        bridge: 'offline',
        mt5_ipc_connected: false,
        error: err?.message || 'Could not reach MT5 bridge tunnel.',
      },
      { status: 503 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const mode = body?.mode || 'place_order';
    const { baseUrl, source } = await resolveActiveBridgeBaseUrl();

    if (mode === 'execute_sync') {
      // Button 1: Start/verify Cloudflare tunnel, write frontend/public/mt5_tunnel.json, push to GitHub/Vercel
      const syncRes = await fetchWithTimeout(
        `${baseUrl}/bridge/execute-sync`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${DEFAULT_SECRET_TOKEN}`,
            'Content-Type': 'application/json',
          },
        },
        25000
      );
      const syncJson = await syncRes.json().catch(() => ({}));
      return NextResponse.json(
        {
          ...syncJson,
          resolved_bridge_url: syncJson?.tunnel_url || baseUrl,
          resolution_source: source,
        },
        { status: syncRes.ok ? 200 : syncRes.status }
      );
    }

    // Button 2: Place Order / Trade Now -> POST /webhook/mt5
    const orderPayload = {
      symbol: body.symbol || 'XAU/USD',
      action: body.action || 'BUY',
      volume: Number(body.volume || 0.01),
      stop_loss: body.stop_loss ? Number(body.stop_loss) : undefined,
      take_profit: body.take_profit ? Number(body.take_profit) : undefined,
      timeframe: body.timeframe || '5m',
      dry_run: Boolean(body.dry_run),
    };

    const orderRes = await fetchWithTimeout(
      `${baseUrl}/webhook/mt5`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${DEFAULT_SECRET_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(orderPayload),
      },
      12000
    );
    const orderJson = await orderRes.json().catch(() => ({}));
    return NextResponse.json(
      {
        ...orderJson,
        resolved_bridge_url: baseUrl,
        resolution_source: source,
      },
      { status: orderRes.ok ? 200 : orderRes.status }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        status: 'error',
        error: err?.message || 'MT5 Bridge request failed.',
      },
      { status: 503 }
    );
  }
}

