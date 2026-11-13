#!/bin/sh
# Keeps the dashboard window alive.
#
# The farm itself does NOT depend on this window (the brain runs detached),
# so a crashed window never stops the bots. This only restarts the WINDOW so
# you can see what the bots are doing. Closing the window on purpose stops
# the loop: the app writes quit.flag when you close it.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
ELECTRON="$DIR/node_modules/electron/dist/electron"
FLAG="$DIR/quit.flag"
PIDFILE="$DIR/logs/supervisor.pid"

[ -x "$ELECTRON" ] || { echo "electron is not installed in $DIR"; exit 1; }
mkdir -p "$DIR/logs"
ulimit -c 0 2>/dev/null || true

cleanup() { rm -f "$PIDFILE"; }
trap cleanup EXIT

while true; do
  rm -f "$FLAG"
  "$ELECTRON" "$DIR" --ozone-platform-hint=auto >"$DIR/logs/app.log" 2>&1 &
  APP=$!
  wait $APP 2>/dev/null
  CODE=$?
  # Closed on purpose -> stop supervising.
  [ -f "$FLAG" ] && exit 0
  echo "app exited (code $CODE) at $(date +%H:%M:%S), restarting in 5s" >&2
  sleep 5
done
