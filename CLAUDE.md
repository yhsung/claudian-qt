# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

A Qt6 desktop wrapper for the Claude Code CLI. It renders a WebEngine-based chat UI, spawns `claude --output-format stream-json` as a subprocess, and bridges the two via QWebChannel. The `claude` CLI must be installed globally (`npm install -g @anthropic-ai/claude-code`).

## Build & Run

This machine has two Homebrew prefixes (`~/homebrew` and `/opt/homebrew`), each with both monolithic `qt` and modular `qtbase`/`qtwebengine` formulae. Plain `cmake -DCMAKE_PREFIX_PATH=$(brew --prefix qt)` will fail — always use Cellar paths.

**Configure** (from `build/`):
```bash
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
```

**Build:**
```bash
cmake --build . --parallel $(sysctl -n hw.ncpu)
```

**Run:**
```bash
QT_PLUGIN_PATH=/opt/homebrew/Cellar/qtbase/6.11.0/share/qt/plugins ./ClaudianQt
```

## Architecture

### C++ layer (`src/`)

| File | Role |
|---|---|
| `main.cpp` | Creates `QApplication` + `MainWindow` |
| `mainwindow.cpp` | Creates `QWebEngineView`, registers `ClaudeBridge` on `QWebChannel` as `"claude"`, loads `qrc:/chat/index.html` |
| `claudebridge.cpp` | Qt/JS boundary — `Q_OBJECT` with properties (`cwd`, `model`, `yolo`), public slots callable from JS, signals emitted to JS. Owns `ClaudeProcess`. Changing `cwd` clears the session ID. |
| `claudeprocess.cpp` | Spawns `claude --output-format stream-json --verbose --print <prompt>` via `QProcess`. Parses newline-delimited JSON stream: `system/init` → `sessionInitialized`, `assistant` content blocks → `textReady` / `toolUseStarted`, `result` with `is_error` → `errorOccurred`. `abort()` kills the process. |

### Web layer (`resources/chat/`)

`index.html` is self-contained: all logic is inline JavaScript, styles are partly inline and partly loaded from `qrc:///chat/claudian.css`. It connects to the C++ side via `QWebChannel`:

```js
new QWebChannel(qt.webChannelTransport, function(channel) {
    bridge = channel.objects.claude;   // ClaudeBridge instance
    bridge.textReady.connect(onTextReady);
    bridge.toolUse.connect(onToolUse);
    bridge.turnComplete.connect(onTurnComplete);
    // ...
});
```

`bridge.sendMessage(text)` → `ClaudeBridge::sendMessage` → `ClaudeProcess::send`.

### Resources (`resources/`)

`resources.qrc` bundles files under the `/chat` prefix:
- `qrc:/chat/index.html` — main UI (loaded by `mainwindow.cpp`)
- `qrc:/chat/claudian.css` — Claudian design system styles

`resources/claudian/` contains `main.js` and other Claudian design-system assets. These are **not** currently registered in `resources.qrc` and are not served to the WebEngine — the CSS is copied to `resources/chat/claudian.css` instead.

## Key data flows

- **User sends message** → JS calls `bridge.sendMessage(text)` → `ClaudeProcess::send` starts a new `claude` subprocess.
- **Streaming response** → subprocess stdout parsed line-by-line as stream-json → `textReady` / `toolUseStarted` signals → JS renders incrementally.
- **Session continuity** → `session_id` from the `system/init` message is stored in `ClaudeBridge::m_sessionId` and passed as `--resume` on subsequent messages. Cleared when `cwd` changes.
- **Abort** → JS calls `bridge.abort()` → `ClaudeProcess::killCurrent()` terminates the subprocess.
