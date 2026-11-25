@echo off
setlocal
title Nova Auto-Sync Setup
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto no_node

node proxy.mjs --setup-sync
echo.
pause
exit /b 0

:no_node
echo Node.js is not installed. Get it from https://nodejs.org first.
pause
exit /b 1
