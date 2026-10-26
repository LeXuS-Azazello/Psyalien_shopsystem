#!/usr/bin/env bash
set -euo pipefail

PORT_API=3000
PORT_WEB=5173

echo "Stopping any existing processes on ports $PORT_API and $PORT_WEB..."

kill_port() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    local pids
    pids=$(lsof -ti tcp:"$port" 2>/dev/null || true)
    if [ -n "$pids" ]; then
      echo "  killing pid(s) $pids on port $port"
      echo "$pids" | xargs -r kill 2>/dev/null || true
    fi
  elif command -v fuser >/dev/null 2>&1; then
    fuser -k "$port"/tcp 2>/dev/null || true
  else
    echo "  warning: neither lsof nor fuser available; cannot kill process on port $port"
  fi
}

kill_port "$PORT_API"
kill_port "$PORT_WEB"

sleep 1

echo "Starting backend API on :$PORT_API and frontend dev server on :$PORT_WEB..."

npm run dev &
API_PID=$!
npm run web:dev &
WEB_PID=$!

echo "Backend PID: $API_PID (http://127.0.0.1:$PORT_API — API routes only; GET / returns 404 by design)"
echo "Frontend PID: $WEB_PID (http://localhost:$PORT_WEB — the inventory UI)"
echo ""
echo "Press Ctrl+C to stop both."

stop() {
  echo ""
  echo "Stopping backend ($API_PID) and frontend ($WEB_PID)..."
  kill "$API_PID" 2>/dev/null || true
  kill "$WEB_PID" 2>/dev/null || true
  wait "$API_PID" 2>/dev/null || true
  wait "$WEB_PID" 2>/dev/null || true
  echo "Stopped."
  exit 0
}

trap stop INT TERM

wait
