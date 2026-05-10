#!/usr/bin/env bash
set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$REPO_ROOT/build"

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
    # Qt install dir, e.g.:  C:\Qt\6.11.0\msvc2022_64
    if [ -z "$QT_HOME" ]; then
      echo "Error: QT_HOME is not set."
      echo "Set it to your Qt compiler dir, e.g.:"
      echo "  export QT_HOME='C:/Qt/6.11.0/msvc2022_64'"
      exit 1
    fi

    cmake "$REPO_ROOT" \
      -B "$BUILD_DIR" \
      -DCMAKE_PREFIX_PATH="$QT_HOME"
  fi
fi

# ── Build ─────────────────────────────────────────────────────────────────────
echo "Building..."
cmake --build "$BUILD_DIR" --parallel "$JOBS"

# ── Run ───────────────────────────────────────────────────────────────────────
if [ "${1}" = "--run" ]; then
  echo "Launching..."
  if [ "$PLATFORM" = "macos" ]; then
    pkill -f "ClaudianQt" 2>/dev/null || true
    sleep 0.3
    QT_PLUGIN_PATH=/opt/homebrew/Cellar/qtbase/6.11.0/share/qt/plugins \
      "$BUILD_DIR/ClaudianQt.app/Contents/MacOS/ClaudianQt" &

  else
    taskkill //F //IM ClaudianQt.exe 2>/dev/null || true
    sleep 0.3
    # Add QT_HOME/bin to PATH so Qt DLLs are found at runtime
    PATH="$QT_HOME/bin:$PATH" "$BUILD_DIR/ClaudianQt.exe" &
  fi
fi
