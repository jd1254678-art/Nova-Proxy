@echo off
setlocal
title Nova Laptop Proxy
cd /d "%~dp0"

echo ============================================================
echo   Starting Nova Laptop Proxy...
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [!] Node.js is not installed.
  echo     Download the LTS version from https://nodejs.org, install it, then double-click start.bat again.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo [*] First run: installing Node packages (takes ~30 seconds)...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo [!] npm install failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
  echo.
)

if not exist cloudflared.exe (
  where cloudflared >nul 2>nul
  if errorlevel 1 (
    echo [*] First run: downloading Cloudflare Tunnel (cloudflared.exe)...
    curl.exe -fsSL -L "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -o cloudflared.exe
    if errorlevel 1 (
      echo [!] Could not download cloudflared.exe automatically.
      echo     Starting local-only proxy instead...
      node proxy.mjs
      pause
      exit /b 0
    )
    echo [*] Cloudflare Tunnel downloaded!
    echo.
  )
)

node proxy.mjs --tunnel
echo.
pause
