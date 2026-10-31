@echo off
title WesSignal Local MT5 Bridge (Port 8001) + Auto Git/Vercel Tunnel Sync
echo ============================================================================
echo   WesSignal Local MT5 Execution Bridge
echo   Local FastAPI Endpoint : http://127.0.0.1:8001
echo   Webhook Route          : POST /webhook/mt5
echo   Auto Git/Vercel Sync   : frontend/public/mt5_tunnel.json -> origin/main
echo ============================================================================

cd /d "%~dp0"

echo [1/2] Starting Local MT5 FastAPI Bridge on 127.0.0.1:8001...
start "WesSignal MT5 FastAPI Bridge (8001)" cmd /k "..\.venv\Scripts\python.exe -m uvicorn server:app --host 127.0.0.1 --port 8001 --workers 1"

timeout /t 3 /nobreak >nul

echo [2/2] Launching Cloudflare Quick Tunnel and pushing new URL to GitHub + Vercel...
..\.venv\Scripts\python.exe -c "import requests, json; from config import settings; r = requests.post(f'http://{settings.host}:{settings.port}/bridge/execute-sync', headers={'Authorization': f'Bearer {settings.secret_token}'}, timeout=30); print(json.dumps(r.json(), indent=2))"

echo ============================================================================
echo   Bridge and Cloudflare Tunnel are LIVE and synced to GitHub/Vercel!
echo ============================================================================
pause
