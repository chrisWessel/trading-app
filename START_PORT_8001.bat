@echo off
title MT5 Bridge Server (Port 8001) Launcher
cd /d "%~dp0"
echo ============================================================
echo   Starting MT5 Bridge Execution Server (Port 8001)
echo ============================================================
echo.

set "PYTHON_EXE=%~dp0.venv\Scripts\python.exe"
if not exist "%PYTHON_EXE%" set "PYTHON_EXE=python"

echo Using Python: %PYTHON_EXE%
echo Starting server...
echo.

"%PYTHON_EXE%" mt5_bridge\server.py

pause

