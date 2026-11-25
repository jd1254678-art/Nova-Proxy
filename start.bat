@echo off
setlocal
title Nova Laptop Proxy
cd /d "%~dp0"

echo ============================================================
echo   Starting Nova Laptop Proxy...
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 goto no_node

if exist node_modules goto check_cf
echo [*] First run: installing Node packages, takes about 30 seconds...
call npm install --no-audit --no-fund
if errorlevel 1 goto npm_fail
echo.

:check_cf
if exist cloudflared.exe goto run_tunnel
where cloudflared >nul 2>nul
if not errorlevel 1 goto run_tunnel

echo [*] First run: downloading Cloudflare Tunnel...
curl.exe -fsSL -L "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -o cloudflared.exe
if errorlevel 1 goto no_cf
echo [*] Cloudflare Tunnel downloaded!
echo.

:run_tunnel
node proxy.mjs --tunnel
echo.
echo Nova Proxy stopped.
pause
exit /b 0

:no_cf
echo [!] Could not download cloudflared.exe automatically.
echo     Starting local-only proxy instead...
node proxy.mjs
echo.
pause
exit /b 0

:no_node
echo [!] Node.js is not installed.
echo     Download the LTS version from https://nodejs.org, install it, then double-click start.bat again.
echo.
pause
exit /b 1

:npm_fail
echo [!] npm install failed. Check your internet connection and try again.
echo.
pause
exit /b 1
