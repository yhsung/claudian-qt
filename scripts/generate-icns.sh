#!/usr/bin/env bash
# Generate ClaudianQt.icns from the source SVG.
# Requires: rsvg-convert (brew install librsvg), iconutil (macOS built-in)
#
# Usage: ./scripts/generate-icns.sh [--open]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SVG="$REPO_ROOT/resources/icons/claudianqt-icon.svg"
ICONSET="$REPO_ROOT/resources/icons/ClaudianQt.iconset"
ICNS="$REPO_ROOT/resources/icons/ClaudianQt.icns"

if ! command -v rsvg-convert &>/dev/null; then
    echo "Error: rsvg-convert not found. Install it with: brew install librsvg"
    exit 1
fi

echo "→ Generating iconset from $SVG"
rm -rf "$ICONSET"
mkdir -p "$ICONSET"

# Standard macOS icon sizes: "filename size" pairs
ENTRIES=(
    "icon_16x16.png       16"
    "icon_16x16@2x.png    32"
    "icon_32x32.png       32"
    "icon_32x32@2x.png    64"
    "icon_128x128.png    128"
    "icon_128x128@2x.png 256"
    "icon_256x256.png    256"
    "icon_256x256@2x.png 512"
    "icon_512x512.png    512"
    "icon_512x512@2x.png 1024"
)

for ENTRY in "${ENTRIES[@]}"; do
    FILENAME=$(echo "$ENTRY" | awk '{print $1}')
    SIZE=$(echo "$ENTRY" | awk '{print $2}')
    OUT="$ICONSET/$FILENAME"
    rsvg-convert -w "$SIZE" -h "$SIZE" "$SVG" -o "$OUT"
    echo "   ✓ $FILENAME (${SIZE}×${SIZE})"
done

echo "→ Compiling $ICNS"
iconutil -c icns "$ICONSET" -o "$ICNS"

echo "✓ Done: $ICNS"

if [[ "${1:-}" == "--open" ]]; then
    qlmanage -p "$ICNS" &>/dev/null &
fi
