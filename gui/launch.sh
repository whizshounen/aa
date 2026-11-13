#!/bin/sh
# Starts the RO Survivors Bot dashboard.
#
# What it does:
#   - makes sure exactly ONE supervisor is running (the supervisor keeps the
#     window alive if it ever crashes, and it does NOT keep the bots alive:
#     the bots live in the detached engine, so closing the window by hand
#     leaves the farm running)
#   - the window opens on the "Expedition" tab
#
# The old entry point (~/.local/bin/ro-survivors-bot) pointed at a second,
# duplicate copy of the app. Everything now uses this one.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
ELECTRON="$DIR/node_modules/electron/dist/electron"
SUPERVISOR="$DIR/supervise.sh"
PIDFILE="$DIR/logs/supervisor.pid"

[ -x "$ELECTRON" ] || { echo "electron is not installed in $DIR — run: (cd $DIR && npm install)"; exit 1; }

mkdir -p "$DIR/logs"

# Already supervised? Then the window is either up or on its way back up.
if [ -f "$PIDFILE" ]; then
  OLD=$(cat "$PIDFILE" 2>/dev/null || echo "")
  if [ -n "$OLD" ] && kill -0 "$OLD" 2>/dev/null; then
    echo "the RO Survivors Bot dashboard is already running (supervisor pid $OLD)"
    exit 0
  fi
fi

# No core dumps: the app occasionally segfaults natively (Electron + WebGL on
# Wayland) and systemd-coredump chewing through the dumps burns a whole core.
ulimit -c 0 2>/dev/null || true

setsid "$SUPERVISOR" >>"$DIR/logs/supervise.log" 2>&1 </dev/null &
echo $! > "$PIDFILE"
echo "RO Survivors Bot dashboard starting (supervisor pid $(cat "$PIDFILE"))"
