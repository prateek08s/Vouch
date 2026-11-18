@echo off
REM Stops the Vouch dev server started by start-dev.cmd, and anything else on port 3000.
taskkill /FI "WINDOWTITLE eq Vouch dev server*" /T /F >nul 2>&1
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000 " ^| findstr LISTENING') do taskkill /PID %%p /T /F >nul 2>&1
echo Vouch dev server stopped.
timeout /t 3 >nul
