#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$REPO_ROOT/build"
APP_BUNDLE="$BUILD_DIR/ClaudianQt.app"

QT_BASE="/opt/homebrew/Cellar/qtbase/6.11.0"
QT_WEBENGINE="/opt/homebrew/Cellar/qtwebengine/6.11.0"

MACDEPLOYQT="/opt/homebrew/opt/qt/bin/macdeployqt"

# ── 1. Configure (only if CMakeCache is missing) ──────────────────────────────
if [[ ! -f "$BUILD_DIR/CMakeCache.txt" ]]; then
  echo "==> Configuring..."
  mkdir -p "$BUILD_DIR"
  ALL_QT_PATHS=$(ls /opt/homebrew/Cellar/ | grep "^qt" | grep -v "^qt$" | while read pkg; do
    echo -n "/opt/homebrew/Cellar/$pkg/6.11.0;"
  done)
  cmake -S "$REPO_ROOT" -B "$BUILD_DIR" \
    -DQt6_DIR="$QT_BASE/lib/cmake/Qt6" \
    -DQt6CoreTools_DIR="$QT_BASE/lib/cmake/Qt6CoreTools" \
    -DQt6GuiTools_DIR="$QT_BASE/lib/cmake/Qt6GuiTools" \
    -DQt6WidgetsTools_DIR="$QT_BASE/lib/cmake/Qt6WidgetsTools" \
    -DQt6QmlTools_DIR="/opt/homebrew/Cellar/qtdeclarative/6.11.0/lib/cmake/Qt6QmlTools" \
    "-DQT_ADDITIONAL_PACKAGES_PREFIX_PATH=${ALL_QT_PATHS}"
fi

# ── 2. Build ──────────────────────────────────────────────────────────────────
echo "==> Building..."
cmake --build "$BUILD_DIR" --parallel "$(sysctl -n hw.ncpu)"

# ── 3. Deploy Qt frameworks and plugins ───────────────────────────────────────
echo "==> Deploying Qt frameworks..."

# WebEngine helper process and resources must be present before macdeployqt runs
# so it can find and sign them. Copy from the Cellar if missing.
WEBENGINE_HELPER="$APP_BUNDLE/Contents/Frameworks/QtWebEngineCore.framework"
if [[ ! -d "$WEBENGINE_HELPER" ]]; then
  HELPER_SRC="$QT_WEBENGINE/lib/QtWebEngineCore.framework/Helpers"
  if [[ -d "$HELPER_SRC" ]]; then
    mkdir -p "$APP_BUNDLE/Contents/Frameworks/QtWebEngineCore.framework"
    cp -R "$HELPER_SRC" "$APP_BUNDLE/Contents/Frameworks/QtWebEngineCore.framework/"
  fi
fi

"$MACDEPLOYQT" "$APP_BUNDLE" \
  -verbose=1 \
  -no-strip

# ── 4. Copy qt.conf so the bundle finds its plugins ───────────────────────────
echo "==> Installing qt.conf..."
cp "$REPO_ROOT/qt.conf" "$APP_BUNDLE/Contents/Resources/qt.conf"

echo ""
echo "✅  Done: $APP_BUNDLE"
echo "   Run with:"
echo "   open $APP_BUNDLE"
