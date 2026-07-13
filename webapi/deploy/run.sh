#!/bin/sh
# Starts the OpenTune web API from its built distribution.
#
# Run build.sh first. This is what launchd (or you, by hand) invokes to keep the server up. It runs
# in the foreground and logs to stdout/stderr, which is what a service manager wants.
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# The server is a JVM app; it needs a Java 21+ runtime on JAVA_HOME. The Gradle launcher falls back to
# `java` on PATH, but the system default may be the wrong version, so pin it here.
: "${JAVA_HOME:=${OPENTUNE_JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}}"
export JAVA_HOME

# Port the server binds. It listens on every interface so the tunnel (or a phone on the LAN) can reach
# it; the access token is what actually guards it.
export PORT="${PORT:-8080}"

LAUNCHER="$ROOT/webapi/build/install/webapi/bin/webapi"
if [ ! -x "$LAUNCHER" ]; then
  echo "Launcher not found at $LAUNCHER -- run webapi/deploy/build.sh first." >&2
  exit 1
fi

exec "$LAUNCHER"
