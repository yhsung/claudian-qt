#!/usr/bin/env bash
set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$REPO_ROOT/build"

ALL_QT_PATHS=$(ls /opt/homebrew/Cellar/ | grep "^qt" | grep -v "^qt$" | while read pkg; do
  echo -n "/opt/homebrew/Cellar/$pkg/6.11.0;"
done)

# Configure if build dir is empty or CMakeCache is missing
if [ ! -f "$BUILD_DIR/CMakeCache.txt" ]; then
  echo "Configuring..."
  mkdir -p "$BUILD_DIR"
  cmake "$REPO_ROOT" \
    -B "$BUILD_DIR" \
    -DQt6_DIR="/opt/homebrew/Cellar/qtbase/6.11.0/lib/cmake/Qt6" \
    -DQt6CoreTools_DIR="/opt/homebrew/Cellar/qtbase/6.11.0/lib/cmake/Qt6CoreTools" \
    -DQt6GuiTools_DIR="/opt/homebrew/Cellar/qtbase/6.11.0/lib/cmake/Qt6GuiTools" \
    -DQt6WidgetsTools_DIR="/opt/homebrew/Cellar/qtbase/6.11.0/lib/cmake/Qt6WidgetsTools" \
    -DQt6QmlTools_DIR="/opt/homebrew/Cellar/qtdeclarative/6.11.0/lib/cmake/Qt6QmlTools" \
    "-DQT_ADDITIONAL_PACKAGES_PREFIX_PATH=${ALL_QT_PATHS}"
fi

echo "Building..."
cmake --build "$BUILD_DIR" --parallel "$(sysctl -n hw.ncpu)"

if [ "${1}" = "--run" ]; then
  echo "Launching..."
  pkill -f "ClaudianQt" 2>/dev/null || true
  sleep 0.3
  QT_PLUGIN_PATH=/opt/homebrew/Cellar/qtbase/6.11.0/share/qt/plugins \
    "$BUILD_DIR/ClaudianQt.app/Contents/MacOS/ClaudianQt" &
fi
