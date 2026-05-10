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

# ── 2. Build (clean link so macdeployqt sees original Homebrew paths) ─────────
echo "==> Building..."
# Remove the binary so the linker re-runs and restores Homebrew install names.
# macdeployqt rewrites install names in-place; a clean link is needed each time.
rm -f "$APP_BUNDLE/Contents/MacOS/ClaudianQt"
cmake --build "$BUILD_DIR" --parallel "$(sysctl -n hw.ncpu)"

# ── 3. Deploy Qt frameworks and plugins ───────────────────────────────────────
echo "==> Deploying Qt frameworks..."

# Remove previously-deployed Frameworks so macdeployqt runs cleanly.
rm -rf "$APP_BUNDLE/Contents/Frameworks"

"$MACDEPLOYQT" "$APP_BUNDLE" \
  -verbose=1 \
  -no-strip

# ── 4. Copy qt.conf so the bundle finds its plugins ───────────────────────────
echo "==> Installing qt.conf..."
cp "$REPO_ROOT/qt.conf" "$APP_BUNDLE/Contents/Resources/qt.conf"

# ── 5. Re-sign the entire bundle (ad-hoc) ────────────────────────────────────
# macdeployqt copies Homebrew dylibs/frameworks but does not re-sign them.
# macOS 13+ requires all binaries in a bundle to share a coherent signature,
# so dyld kills the process with CODESIGNING/Invalid Page without this step.
echo "==> Re-signing bundle (ad-hoc)..."
find "$APP_BUNDLE/Contents/Frameworks" -name "*.dylib" -o -name "*.so" 2>/dev/null | while read lib; do
  codesign --force --sign - "$lib" 2>/dev/null || true
done
find "$APP_BUNDLE/Contents/PlugIns" -name "*.dylib" -o -name "*.so" 2>/dev/null | while read lib; do
  codesign --force --sign - "$lib" 2>/dev/null || true
done
# Sign nested .app helpers (e.g. QtWebEngineProcess.app) before the outer bundle
find "$APP_BUNDLE/Contents/Frameworks" -name "*.app" 2>/dev/null | while read helper; do
  codesign --force --sign - "$helper" 2>/dev/null || true
done
# Sign top-level frameworks
find "$APP_BUNDLE/Contents/Frameworks" -name "*.framework" -maxdepth 1 2>/dev/null | while read fw; do
  codesign --force --sign - "$fw" 2>/dev/null || true
done
# Finally sign the outer bundle
codesign --force --sign - "$APP_BUNDLE"
echo "==> Bundle signed."

echo ""
echo "✅  Done: $APP_BUNDLE"
echo "   Run with:"
echo "   open $APP_BUNDLE"
