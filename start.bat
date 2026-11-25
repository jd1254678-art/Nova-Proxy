@echo off
rem Double-click this file on Windows to start Nova.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js isn't installed. Get the LTS version from https://nodejs.org, install it, then run this again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo First run: installing packages. This takes a minute...
  call npm install
  if errorlevel 1 (
    echo npm install failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

node proxy.mjs
pause
