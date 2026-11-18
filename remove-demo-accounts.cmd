@echo off
REM One-off: stops the dev server, backs up the local database, removes accounts that
REM cannot sign in (the old demo people), then starts the dev server again.
cd /d "%~dp0"
call stop-dev.cmd
node scripts\remove-local-accounts.mjs
if errorlevel 1 (echo Removal failed. Your database was not changed after the backup. & pause & exit /b 1)
echo.
echo Done. Starting the dev server...
timeout /t 3 >nul
start "" "%~dp0start-dev.cmd"
