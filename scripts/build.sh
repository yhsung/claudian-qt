#!/usr/bin/env bash
set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$REPO_ROOT/build"
DEBUG_MODE="${DEBUG:-off}"

# ── Platform detection ────────────────────────────────────────────────────────
case "$(uname -s)" in
  Darwin*)            PLATFORM="macos" ;;
  MINGW*|MSYS*|CYGWIN*) PLATFORM="windows" ;;
  *)  echo "Unsupported platform: $(uname -s)"; exit 1 ;;
esac

# ── Parallel job count ────────────────────────────────────────────────────────
if [ "$PLATFORM" = "macos" ]; then
  JOBS="$(sysctl -n hw.ncpu)"
else
  JOBS="${NUMBER_OF_PROCESSORS:-$(nproc 2>/dev/null || echo 4)}"
fi

# ── Debug mode ────────────────────────────────────────────────────────────────
if [ "${1}" = "--inspect" ] || [ "${DEBUG}" = "on" ]; then
  DEBUG_MODE="on"
  export QTWEBENGINE_REMOTE_DEBUGGING="9222"
  export NODE_OPTIONS="--inspect=9229"
  echo "⚡ Debug mode: WebEngine DevTools on :9222, Node inspector on :9229"
  echo "  → Chrome: chrome://inspect → Targets → configure port 9222"
  echo "  → Node:   open http://localhost:9229/json"
  shift
fi

# ── Configure ─────────────────────────────────────────────────────────────────
if [ ! -f "$BUILD_DIR/CMakeCache.txt" ]; then
  echo "Configuring ($PLATFORM)..."
  mkdir -p "$BUILD_DIR"

  if [ "$PLATFORM" = "macos" ]; then
    ALL_QT_PATHS=$(ls /opt/homebrew/Cellar/ | grep "^qt" | grep -v "^qt$" | while read pkg; do
      echo -n "/opt/homebrew/Cellar/$pkg/6.11.0;"
    done)

    cmake "$REPO_ROOT" \
      -B "$BUILD_DIR" \
      -DQt6_DIR="/opt/homebrew/Cellar/qtbase/6.11.0/lib/cmake/Qt6" \
      -DQt6CoreTools_DIR="/opt/homebrew/Cellar/qtbase/6.11.0/lib/cmake/Qt6CoreTools" \
      -DQt6GuiTools_DIR="/opt/homebrew/Cellar/qtbase/6.11.0/lib/cmake/Qt6GuiTools" \
      -DQt6WidgetsTools_DIR="/opt/homebrew/Cellar/qtbase/6.11.0/lib/cmake/Qt6WidgetsTools" \
      -DQt6QmlTools_DIR="/opt/homebrew/Cellar/qtdeclarative/6.11.0/lib/cmake/Qt6QmlTools" \
      "-DQT_ADDITIONAL_PACKAGES_PREFIX_PATH=${ALL_QT_PATHS}"

  else
    # Windows (Git Bash / MSYS2): QT_HOME must point to the compiler-specific
    # Qt install dir, e.g.:  D:\loggin-tool-ws\qt653_windows_20250822
    if [ -z "$QT_HOME" ]; then
      echo "Error: QT_HOME is not set."
      echo "Set it to your Qt compiler dir, e.g.:"
      echo "  export QT_HOME='D:/loggin-tool-ws/qt653_windows_20250822'"
      exit 1
    fi

    cmake "$REPO_ROOT" \
      -B "$BUILD_DIR" \
      -DCMAKE_PREFIX_PATH="$QT_HOME" \
      -G "Visual Studio 16 2019" \
      -A x64
  fi
fi

# ── Icon (macOS only) ─────────────────────────────────────────────────────────
if [ "$PLATFORM" = "macos" ]; then
  SVG="$REPO_ROOT/resources/icons/claudianqt-icon.svg"
  ICNS="$REPO_ROOT/resources/icons/ClaudianQt.icns"
  if [ ! -f "$ICNS" ] || [ "$SVG" -nt "$ICNS" ]; then
    echo "Generating icon..."
    bash "$REPO_ROOT/scripts/generate-icns.sh"
  fi
fi

# ── Build ─────────────────────────────────────────────────────────────────────
echo "Building..."
if [ "$PLATFORM" = "macos" ]; then
  cmake --build "$BUILD_DIR" --parallel "$JOBS"
else
  cmake --build "$BUILD_DIR" --config Release --parallel "$JOBS"
fi

# ── Run ───────────────────────────────────────────────────────────────────────
if [ "${1}" = "--run" ]; then
  echo "Launching..."
  if [ "$PLATFORM" = "macos" ]; then
    pkill -f "ClaudianQt" 2>/dev/null || true
    sleep 0.3
    if [ "$DEBUG_MODE" = "on" ]; then
      QTWEBENGINE_REMOTE_DEBUGGING="9222" NODE_OPTIONS="--inspect=9229" \
        QT_PLUGIN_PATH=/opt/homebrew/Cellar/qtbase/6.11.0/share/qt/plugins \
        "$BUILD_DIR/ClaudianQt.app/Contents/MacOS/ClaudianQt" &
    else
      QT_PLUGIN_PATH=/opt/homebrew/Cellar/qtbase/6.11.0/share/qt/plugins \
        "$BUILD_DIR/ClaudianQt.app/Contents/MacOS/ClaudianQt" &
    fi

  else
    taskkill //F //IM ClaudianQt.exe 2>/dev/null || true
    sleep 0.3
    if [ "$DEBUG_MODE" = "on" ]; then
      QTWEBENGINE_REMOTE_DEBUGGING="9222" NODE_OPTIONS="--inspect=9229" \
        "$BUILD_DIR/Release/ClaudianQt.exe" &
    else
      "$BUILD_DIR/Release/ClaudianQt.exe" &
    fi
  fi
fi
