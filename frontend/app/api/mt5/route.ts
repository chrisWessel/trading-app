import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

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

function findRepoRoot(): string {
  const candidates = [
    process.cwd(),
    path.resolve(process.cwd(), '..'),
    path.resolve(__dirname, '../../..'),
    path.resolve(__dirname, '../../../..'),
    path.resolve(__dirname, '../../../../..'),
    'C:\\Users\\Admin\\Desktop\\Trading App',
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'mt5_bridge', 'server.py'))) {
      return dir;
    }
  }
  return process.cwd();
}

/**
 * When running on the local Windows trading PC, if port 8001 is not running yet
 * automatically spawn `mt5_bridge/server.py` in the background and wait for it to listen!
 */
async function tryAutoSpawnLocalBridge(): Promise<{ ok: boolean; message: string }> {
  // 1. Check if 8001 is already alive
  try {
    const healthCheck = await fetchWithTimeout(
      `${LOCAL_BRIDGE_BASE}/health`,
      { headers: { Authorization: `Bearer ${DEFAULT_SECRET_TOKEN}` } },
      1000
    );
    if (healthCheck.ok) {
      return { ok: true, message: 'Bridge server is already running on port 8001.' };
    }
  } catch {}

  if (process.platform !== 'win32' || process.env.VERCEL) {
    return {
      ok: false,
      message: 'Automatic process spawning requires local Windows PC. On cloud deployments, start the bridge on your PC.',
    };
  }

  try {
    const repoRoot = findRepoRoot();
    const serverScript = path.join(repoRoot, 'mt5_bridge', 'server.py');
    const venvPython = path.join(repoRoot, '.venv', 'Scripts', 'python.exe');
    if (!fs.existsSync(serverScript)) {
      return { ok: false, message: `server.py not found in repo root: ${repoRoot}` };
    }
    const pythonExe = fs.existsSync(venvPython) ? venvPython : 'python';

    const child = spawn(
      pythonExe,
      [serverScript],
      {
        cwd: repoRoot,
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      }
    );
    child.unref();

    // Poll 127.0.0.1:8001/health for up to 6.5 seconds
    for (let i = 0; i < 13; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        const res = await fetchWithTimeout(
          `${LOCAL_BRIDGE_BASE}/health`,
          { headers: { Authorization: `Bearer ${DEFAULT_SECRET_TOKEN}` } },
          1000
        );
        if (res.ok) {
          return { ok: true, message: 'Successfully started MT5 Bridge server on port 8001!' };
        }
      } catch {}
    }
    return { ok: false, message: 'Bridge process spawned but port 8001 did not respond in time.' };
  } catch (err: any) {
    return { ok: false, message: `Failed to spawn bridge: ${err?.message || err}` };
  }
}

/**
 * Executes mt5_bridge/start_bridge.bat in a visible command window
 * on local Windows machines, or returns an explicit instruction for cloud/Vercel users.
 */
async function tryLaunchStartBridgeBat(): Promise<{ ok: boolean; message: string; isCloud?: boolean }> {
  // Check if 8001 is already alive
  try {
    const healthCheck = await fetchWithTimeout(
      `${LOCAL_BRIDGE_BASE}/health`,
      { headers: { Authorization: `Bearer ${DEFAULT_SECRET_TOKEN}` } },
      1000
    );
    if (healthCheck.ok) {
      return { ok: true, message: 'MT5 Bridge is already running and online on port 8001!' };
    }
  } catch {}

  if (process.platform !== 'win32' || process.env.VERCEL) {
    return {
      ok: false,
      isCloud: true,
      message: 'You are on Vercel Cloud! Cloud web servers cannot launch files on your local Windows PC. Double-click mt5_bridge\\start_bridge.bat or START_PORT_8001.bat on your PC desktop.',
    };
  }

  try {
    const repoRoot = findRepoRoot();
    const batPath = path.join(repoRoot, 'mt5_bridge', 'start_bridge.bat');
    if (!fs.existsSync(batPath)) {
      return { ok: false, message: `start_bridge.bat not found at: ${batPath}` };
    }

    // Launch start_bridge.bat in a new visible cmd window
    const child = spawn('cmd.exe', ['/c', 'start', 'WesSignal MT5 Bridge (8001)', batPath], {
      cwd: path.join(repoRoot, 'mt5_bridge'),
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    // Poll 127.0.0.1:8001/health for up to 8 seconds
    for (let i = 0; i < 16; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        const res = await fetchWithTimeout(
          `${LOCAL_BRIDGE_BASE}/health`,
          { headers: { Authorization: `Bearer ${DEFAULT_SECRET_TOKEN}` } },
          1000
        );
        if (res.ok) {
          return { ok: true, message: 'Successfully started mt5_bridge/start_bridge.bat (Port 8001 is ONLINE)!' };
        }
      } catch {}
    }
    return { ok: true, message: 'start_bridge.bat launched! Server is initializing on port 8001.' };
  } catch (err: any) {
    return { ok: false, message: `Failed to launch start_bridge.bat: ${err?.message || err}` };
  }
}

async function resolveActiveBridgeBaseUrl(hintTunnelUrl?: string): Promise<{ baseUrl: string; source: string }> {
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

  // 1b. If running on local Windows PC and port 8001 wasn't up yet, auto-start mt5_bridge/server.py!
  const spawned = await tryAutoSpawnLocalBridge();
  if (spawned.ok) {
    return { baseUrl: LOCAL_BRIDGE_BASE, source: 'local_8001_autospawned' };
  }

  // 2. If caller passed an explicit active tunnel URL
  if (hintTunnelUrl && hintTunnelUrl.startsWith('https://')) {
    return { baseUrl: hintTunnelUrl.replace(/\/+$/, ''), source: 'client_hint_tunnel' };
  }

  // 3. Fetch latest tunnel URL pushed to GitHub main branch (instant update even before Vercel rebuilds)
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

  // 4. Fallback to MT5_BRIDGE_URL environment variable if set in Vercel
  const envUrl = (process.env.MT5_BRIDGE_URL || '').trim().replace(/\/webhook\/mt5\/?$/, '').replace(/\/+$/, '');
  if (envUrl.startsWith('http')) {
    return { baseUrl: envUrl, source: 'vercel_env' };
  }

  return {
    baseUrl: 'https://julie-require-associations-undo.trycloudflare.com',
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

    // Direct Start Bridge / Port 8001 Action via .bat or server
    if (mode === 'start_bridge_bat' || mode === 'start_bat') {
      const batResult = await tryLaunchStartBridgeBat();
      let healthData: any = {};
      try {
        const hRes = await fetchWithTimeout(
          `${LOCAL_BRIDGE_BASE}/health`,
          { headers: { Authorization: `Bearer ${DEFAULT_SECRET_TOKEN}` } },
          1500
        );
        if (hRes.ok) healthData = await hRes.json();
      } catch {}

      return NextResponse.json(
        {
          status: batResult.ok ? 'online' : 'error',
          bridge: batResult.ok ? 'online' : 'offline',
          port: 8001,
          message: batResult.message,
          isCloud: batResult.isCloud,
          ...healthData,
        },
        { status: 200 }
      );
    }

    if (mode === 'start_server' || mode === 'start_bridge') {
      const spawnResult = await tryAutoSpawnLocalBridge();
      let healthData: any = {};
      try {
        const hRes = await fetchWithTimeout(
          `${LOCAL_BRIDGE_BASE}/health`,
          { headers: { Authorization: `Bearer ${DEFAULT_SECRET_TOKEN}` } },
          1500
        );
        if (hRes.ok) healthData = await hRes.json();
      } catch {}

      return NextResponse.json(
        {
          status: spawnResult.ok ? 'online' : 'error',
          bridge: spawnResult.ok ? 'online' : 'offline',
          port: 8001,
          message: spawnResult.message,
          ...healthData,
        },
        { status: spawnResult.ok ? 200 : 500 }
      );
    }

    const { baseUrl, source } = await resolveActiveBridgeBaseUrl(body?.tunnel_url);

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

    if (mode === 'cancel_close') {
      // Button 3: Cancel pending orders & close open positions for the pair (or all)
      const cancelRes = await fetchWithTimeout(
        `${baseUrl}/bridge/cancel-close`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${DEFAULT_SECRET_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            symbol: body.symbol,
            ticket: body.ticket,
            close_all: Boolean(body.close_all),
          }),
        },
        12000
      );
      const cancelJson = await cancelRes.json().catch(() => ({}));
      return NextResponse.json(
        {
          ...cancelJson,
          resolved_bridge_url: baseUrl,
          resolution_source: source,
        },
        { status: cancelRes.ok ? 200 : cancelRes.status }
      );
    }

    if (mode === 'stop_bot') {
      // Button 4: Disarm Auto-Bot & Close All Open Positions on MT5
      const stopRes = await fetchWithTimeout(
        `${baseUrl}/bridge/stop-bot`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${DEFAULT_SECRET_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            close_all_trades: body.close_all_trades !== false,
          }),
        },
        12000
      );
      const stopJson = await stopRes.json().catch(() => ({}));
      return NextResponse.json(
        {
          ...stopJson,
          resolved_bridge_url: baseUrl,
          resolution_source: source,
        },
        { status: stopRes.ok ? 200 : stopRes.status }
      );
    }

    if (mode === 'modify_position') {
      // Autonomous Bot SL/TP Modifier (Breakeven Lock / Trailing Stop)
      const modRes = await fetchWithTimeout(
        `${baseUrl}/bridge/modify-position`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${DEFAULT_SECRET_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ticket: Number(body.ticket),
            sl: body.sl !== undefined ? Number(body.sl) : undefined,
            tp: body.tp !== undefined ? Number(body.tp) : undefined,
            move_to_breakeven: Boolean(body.move_to_breakeven),
          }),
        },
        10000
      );
      const modJson = await modRes.json().catch(() => ({}));
      return NextResponse.json(
        {
          ...modJson,
          resolved_bridge_url: baseUrl,
          resolution_source: source,
        },
        { status: modRes.ok ? 200 : modRes.status }
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
    const rawMsg = String(err?.message || '');
    const friendlyError =
      rawMsg.toLowerCase().includes('fetch failed') || rawMsg.toLowerCase().includes('abort')
        ? 'Local MT5 Bridge is offline on your PC (or Cloudflare tunnel expired after PC restart). Start mt5_bridge/start_bridge.bat on your PC, then click "1. EXECUTE"!'
        : rawMsg || 'MT5 Bridge request failed.';
    return NextResponse.json(
      {
        status: 'error',
        error: friendlyError,
        retcode_name: friendlyError,
      },
      { status: 503 }
    );
  }
}

