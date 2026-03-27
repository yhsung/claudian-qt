# Claudian Qt

A native macOS desktop wrapper for [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code), built with Qt6. It spawns `claude` as a subprocess, communicates over its `--output-format stream-json` pipe, and renders the conversation in a WebEngine chat UI connected via QWebChannel.

## Architecture

```
QWebEngineView (HTML/JS chat UI)
        │  QWebChannel ("claude" object)
        ▼
  ClaudeBridge          ← QObject exposed to JS; translates signals/slots
        │
  ClaudeProcess         ← manages QProcess lifecycle, parses stream-json lines
        │
  claude CLI (subprocess)
```

**ClaudeProcess** (`src/claudeprocess.*`) — spawns `claude --output-format stream-json`, buffers stdout line by line, and parses each JSON event into typed signals (`textReady`, `toolUseStarted`, `turnFinished`, `sessionInitialized`).

**ClaudeBridge** (`src/claudebridge.*`) — registered with `QWebChannel` as `"claude"`. Exposes public slots callable from JavaScript (`sendMessage`, `abort`, `setCwd`, `pickFolder`) and re-emits process signals as JS-visible signals (`textReady`, `toolUse`, `turnComplete`, `errorOccurred`, `cwdChanged`).

**Chat UI** (`resources/chat/index.html`) — self-contained HTML/CSS/JS page loaded via `qrc://`. Uses `qwebchannel.js` to connect to the bridge and renders streaming text, animated tool-call blocks, and a typing indicator.

## Requirements

- macOS (Apple Silicon or Intel)
- Qt 6.6+ with `WebEngineWidgets` and `WebChannel` components
- CMake 3.16+
- Claude Code CLI installed and on `$PATH`

## Building

> **Note (Homebrew dual-install):** If you have both a monolithic `qt` formula and modular `qtbase`/`qtwebengine` formulae installed via Homebrew, CMake needs explicit Cellar paths. Use the commands below; skip the `ALL_QT_PATHS` prefix step if you have a standard single-Qt install.

```bash
mkdir build && cd build

# Resolve Cellar paths for all Qt 6 packages (skip if not needed)
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

## Running

```bash
QT_PLUGIN_PATH=/opt/homebrew/Cellar/qtbase/6.11.0/share/qt/plugins ./build/ClaudianQt
```

## Usage

1. Launch the app.
2. Click **Open Folder** in the header to set the working directory for Claude Code.
3. Type a message and press **Ctrl+Enter** (or click the send button) to start a conversation.
4. Tool calls appear as collapsible blocks with a spinner while in progress.
5. Press **Escape** or click the stop button to abort a running response.

## License

MIT
