@echo off
title REXT/USDT Trading & Signal Dispatcher System Launcher

echo ============================================================
echo   Starting REXT/USDT Full-Stack Trading & Signal System
echo ============================================================
echo.

:: 1. Start FastAPI Backend Server in new window
echo Starting FastAPI Backend Engine (Port 8000)...
start "FastAPI Backend Engine (Port 8000)" cmd /k "cd /d "%~dp0" && python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload"

:: 2. Start Next.js Frontend Dev Server in new window
echo Starting Next.js Frontend Dashboard (Port 3000)...
start "Next.js Frontend Dashboard (Port 3000)" cmd /k "cd /d "%~dp0frontend" && npm run dev"

echo.
echo Waiting 5 seconds for servers to initialize...
timeout /t 5 /nobreak >nul

:: 3. Open Web Browser to Dashboard
echo Opening Dashboard at http://localhost:3000 ...
start http://localhost:3000

echo.
echo ============================================================
echo   System is now live!
echo   - UI Dashboard: http://localhost:3000
echo   - Backend REST API: http://127.0.0.1:8000
echo ============================================================
pause
