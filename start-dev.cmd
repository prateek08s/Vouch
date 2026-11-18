@echo off
REM Starts (or restarts) the Vouch dev server and opens it in your browser.
cd /d "%~dp0"
REM Close a server window this script started earlier.
taskkill /FI "WINDOWTITLE eq Vouch dev server*" /T /F >nul 2>&1
REM Stop anything still listening on port 3000.
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000 " ^| findstr LISTENING') do taskkill /PID %%p /T /F >nul 2>&1
title Vouch dev server
start "" cmd /c "timeout /t 12 >nul & start http://localhost:3000"
npm run dev
pause
