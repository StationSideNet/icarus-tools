#!/usr/bin/env bash
# Kill whatever is listening on the Vite dev-server port (default 5173).
PORT="${1:-5173}"
PID=$(lsof -ti :"$PORT" 2>/dev/null)

if [ -z "$PID" ]; then
  echo "Nothing listening on port $PORT"
  exit 0
fi

echo "Killing PID $PID on port $PORT"
kill "$PID" 2>/dev/null && echo "Done" || echo "Failed – try: sudo kill $PID"
