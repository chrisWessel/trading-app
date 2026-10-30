@echo off
title WesSignal Local MT5 Bridge (Port 8001) + Cloudflare Tunnel
echo ============================================================================
echo   WesSignal Local MT5 Execution Bridge
echo   Local FastAPI Endpoint : http://127.0.0.1:8001
echo   Webhook Route          : POST /webhook/mt5
echo ============================================================================

cd /d "%~dp0"

echo [1/2] Starting Local MT5 FastAPI Bridge on 127.0.0.1:8001...
start "WesSignal MT5 FastAPI Bridge (8001)" cmd /k "..\.venv\Scripts\python.exe -m uvicorn server:app --host 127.0.0.1 --port 8001 --workers 1"

timeout /t 3 /nobreak >nul

if exist "%~dp0cloudflared.exe" (
    echo [2/2] Starting Cloudflare Quick Tunnel to http://127.0.0.1:8001...
    echo Copy the https://*.trycloudflare.com URL printed below into Vercel!
    "%~dp0cloudflared.exe" tunnel --url http://127.0.0.1:8001
) else (
    where cloudflared >nul 2>nul
    if %ERRORLEVEL% EQU 0 (
        echo [2/2] Starting Cloudflare Quick Tunnel to http://127.0.0.1:8001...
        echo Copy the https://*.trycloudflare.com URL printed below into Vercel!
        cloudflared tunnel --url http://127.0.0.1:8001
    ) else (
        echo [!] cloudflared binary not found.
        pause
    )
)

