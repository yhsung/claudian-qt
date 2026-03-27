# Claudian Qt

A native macOS desktop wrapper for the [Claude Code](https://claude.ai/code) CLI, built with Qt6 and WebEngine. It renders the [Claudian](https://github.com/claudian) chat interface inside a native window and bridges it to the `claude` subprocess via `QWebChannel`.

## How it works

```
┌─────────────────────────────────────┐
│  Qt MainWindow (native window)      │
│  ┌───────────────────────────────┐  │
│  │ QWebEngineView                │  │
│  │  index.html + Claudian UI     │  │
│  │  ↕ QWebChannel ("claude")     │  │
│  │  ClaudeBridge (C++ QObject)   │  │
│  │  ↕ QProcess                   │  │
│  │  claude --output-format       │  │
│  │         stream-json           │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

- **C++ layer** — `ClaudeBridge` exposes properties (`cwd`, `model`, `yolo`) and slots (`sendMessage`, `abort`, `pickFolder`, `setModel`, `setYolo`) over `QWebChannel`. `ClaudeProcess` manages the `claude` subprocess and parses its newline-delimited JSON stream.
- **Web layer** — `index.html` loads the Claudian plugin bundle (`main.js`) inside a minimal Obsidian shim. A `QtBridgeService` class replaces Claudian's internal agent service, routing the streaming chunks from `QWebChannel` signals into Claudian's async generator protocol.
- **Toolbar controls** — Model selector (Haiku / Sonnet / Opus), YOLO toggle, and send button are wired bidirectionally to the Qt bridge so selections propagate to the next `claude` invocation as `--model` / `--dangerously-skip-permissions` flags.

## Prerequisites

| Requirement | Version |
|---|---|
| macOS | 12 Monterey or later |
| Xcode Command Line Tools | any recent |
| CMake | ≥ 3.16 |
| Qt6 (modular Homebrew formulae) | 6.11.0 |
| Node.js + claude CLI | `npm install -g @anthropic-ai/claude-code` |

Install Qt via Homebrew:

```bash
brew install qtbase qtwebengine qtdeclarative
```

## Build

```bash
git clone https://github.com/yhsung/claudian-qt
cd claudian-qt && mkdir build && cd build

ALL_QT_PATHS=$(ls /opt/homebrew/Cellar/ | grep "^qt" | grep -v "^qt$" | while read pkg; do
  echo -n "/opt/homebrew/Cellar/$pkg/6.11.0;"
done)

cmake .. \
  -DQt6_DIR="/opt/homebrew/Cellar/qtbase/6.11.0/lib/cmake/Qt6" \
  -DQt6CoreTools_DIR="/opt/homebrew/Cellar/qtbase/6.11.0/lib/cmake/Qt6CoreTools" \
  -DQt6GuiTools_DIR="/opt/homebrew/Cellar/qtbase/6.11.0/lib/cmake/Qt6GuiTools" \
  -DQt6WidgetsTools_DIR="/opt/homebrew/Cellar/qtbase/6.11.0/lib/cmake/Qt6WidgetsTools" \
  -DQt6QmlTools_DIR="/opt/homebrew/Cellar/qtdeclarative/6.11.0/lib/cmake/Qt6QmlTools" \
  "-DQT_ADDITIONAL_PACKAGES_PREFIX_PATH=${ALL_QT_PATHS}"

cmake --build . --parallel $(sysctl -n hw.ncpu)
```

## Run

```bash
QT_PLUGIN_PATH=/opt/homebrew/Cellar/qtbase/6.11.0/share/qt/plugins ./ClaudianQt
```

### Remote debugging (Chrome DevTools)

```bash
QTWEBENGINE_REMOTE_DEBUGGING=9222 \
QT_PLUGIN_PATH=/opt/homebrew/Cellar/qtbase/6.11.0/share/qt/plugins \
./ClaudianQt
```

Then open `http://127.0.0.1:9222` in any Chromium-based browser.

## Project structure

```
claudian-qt/
├── src/
│   ├── main.cpp              # QApplication entry point
│   ├── mainwindow.cpp/.h     # QWebEngineView setup, QWebChannel registration
│   ├── claudebridge.cpp/.h   # Qt/JS boundary — properties, slots, signals
│   └── claudeprocess.cpp/.h  # claude subprocess management, stream-json parser
└── resources/
    ├── resources.qrc          # Bundles web assets into the binary
    ├── chat/
    │   ├── index.html         # Bootstrap: Obsidian shim → Claudian plugin → Qt wiring
    │   └── obsidian-shim.js   # Minimal Obsidian API mock (no Obsidian, no Node.js)
    └── claudian/
        ├── main.js            # Claudian plugin bundle (esbuild CommonJS)
        └── styles.css         # Claudian design system styles
```

## Key data flows

**Sending a message**
1. User types in `textarea.claudian-input` and presses Enter (or clicks the send button)
2. Claudian's `InputController.sendMessage()` calls `QtBridgeService.query(prompt)`
3. `QtBridgeService` calls `bridge.sendMessage(prompt)` over `QWebChannel`
4. `ClaudeBridge` passes prompt + current `cwd` / `model` / `yolo` / `sessionId` to `ClaudeProcess`
5. `ClaudeProcess` spawns `claude --output-format stream-json --print <prompt> [--model …] [--resume …] [--dangerously-skip-permissions]`
6. Stdout is parsed line-by-line; `textReady` / `toolUse` signals stream chunks back to JS
7. Claudian renders chunks incrementally; `turnComplete` ends the turn

**Session continuity**
- The `session_id` from the `system/init` message is stored in `ClaudeBridge::m_sessionId`
- Passed as `--resume <id>` on subsequent turns; cleared when `cwd` changes

**Toolbar controls**
- Model selector click → `bridge.setModel(value)` → stored, used on next invocation
- YOLO toggle → `bridge.setYolo(bool)` → adds/removes `--dangerously-skip-permissions`
- Both sync bidirectionally via `modelChanged` / `yoloChanged` signals

## License

Apache 2.0 — see [LICENSE](LICENSE).
