#!/bin/sh
# Copies the built server and web bundle to a staging directory OUTSIDE the repo, then (re)starts the
# launchd-managed server from there.
#
# Why staging exists: on macOS, launchd background agents cannot read files under ~/Desktop,
# ~/Documents or ~/Downloads (TCC protection) -- a server launched from a repo in one of those folders
# fails with "Operation not permitted". Running from a copy in a plain directory like ~/opentune sides-
# steps that entirely. If your repo is not under a protected folder you do not need this; point the
# launchd job straight at the repo instead.
#
# Run build.sh first, then this. Override the target with OPENTUNE_STAGE.
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STAGE="${OPENTUNE_STAGE:-$HOME/opentune}"

DIST="$ROOT/webapi/build/install/webapi"
WEB="$ROOT/web-app/dist"
if [ ! -x "$DIST/bin/webapi" ] || [ ! -d "$WEB" ]; then
  echo "Build output missing -- run webapi/deploy/build.sh first." >&2
  exit 1
fi

echo "==> Staging to $STAGE"
rm -rf "$STAGE/server" "$STAGE/web-dist"
mkdir -p "$STAGE"
cp -R "$DIST" "$STAGE/server"
cp -R "$WEB" "$STAGE/web-dist"

# If the launchd job is loaded, restart it so it picks up the new build.
if launchctl list 2>/dev/null | grep -q com.opentune.web; then
  echo "==> Restarting the launchd server job"
  launchctl kickstart -k "gui/$(id -u)/com.opentune.web"
fi

echo "==> Staged. Server root: $STAGE/server/bin/webapi   Web root: $STAGE/web-dist"
