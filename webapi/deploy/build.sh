#!/bin/sh
# Builds everything the server needs to run: the web app bundle and the server distribution.
#
# Run this once after pulling changes. It is deliberately separate from run.sh so the long-running
# service starts a pre-built launcher rather than a Gradle daemon.
set -eu

# The repo root, resolved from this script's own location, so it works from anywhere.
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# Gradle needs JDK 21. Point JAVA_HOME at one before running, e.g. Homebrew's openjdk@21 or the JDK
# that ships with Android Studio. Override by exporting JAVA_HOME yourself.
: "${JAVA_HOME:=${OPENTUNE_JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}}"
export JAVA_HOME
echo "Using JAVA_HOME=$JAVA_HOME"

echo "==> Building the web app bundle (web-app/dist)"
cd "$ROOT/web-app"
npm install
npm run build

echo "==> Building the server distribution"
cd "$ROOT"
./gradlew :webapi:installDist

echo "==> Done. Launcher at: webapi/build/install/webapi/bin/webapi"
