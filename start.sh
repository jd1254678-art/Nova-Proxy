#!/usr/bin/env bash
# Start Nova on Mac or Linux:  ./start.sh
# (On a Mac you can also double-click start.command.)
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js isn't installed. Get the LTS version from https://nodejs.org, install it, then run this again."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "First run: installing packages. This takes a minute..."
  npm install || { echo "npm install failed. Check your internet connection and try again."; exit 1; }
fi

exec node proxy.mjs
