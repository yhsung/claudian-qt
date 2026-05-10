# Claudian Qt

A native macOS desktop wrapper for [Claude Code](https://claude.ai/code), built with Qt6 and WebEngine. It renders the [Claudian](https://github.com/YishenTu/claudian) chat interface inside a native window and bridges it to a persistent TypeScript daemon powered by the `@anthropic-ai/claude-agent-sdk`.

## How it works

```
┌───────────────────────────────────────────┐
│  Qt MainWindow (native window)            │
│  ┌─────────────────────────────────────┐  │
│  │ QWebEngineView                      │  │
│  │  index.html + Claudian UI           │  │
│  │  ↕ QWebChannel ("claude")           │  │
│  │  ClaudeBridge (C++ adapter)         │  │
│  │  ↕ Qt Signals/Slots                 │  │
│  │  BridgeDaemon (C++ manager)         │  │
│  │  ↕ stdin/stdout (NDJSON)            │  │
│  │  daemon.js (Persistent Node process) │  │
│  │  ↕ Claude Agent SDK                 │  │
│  └─────────────────────────────────────┘  │
└───────────────────────────────────────────┘
```

- **Persistent Daemon** — A long-lived Node.js process (`bridge/src/daemon.ts`) manages all communication with the Claude Agent SDK. It maintains session state, handles history persistence, and processes image attachments.
- **C++ layer** — `ClaudeBridge` is a thin protocol adapter that exposes properties and slots to the web UI. `BridgeDaemon` manages the lifecycle of the Node.js process and translates NDJSON events into Qt signals.
- **Web layer** — `index.html` renders the Claudian chat interface. It uses an async generator to stream chunks from the bridge into the UI, supporting real-time streaming with a "Stop" button to abort generations.
- **Image Support** — `AttachmentStore` (C++) handles native file staging for drag-and-drop, paste, and file picking, allowing multi-image attachments to be sent with any prompt.


## Prerequisites

| Requirement | Version |
|---|---|
| macOS | 12 Monterey or later |
| Xcode Command Line Tools | any recent |
| CMake | ≥ 3.16 |
| Qt6 (modular Homebrew formulae) | 6.11.0 |
| Node.js | ≥ 18 |
| Claude Code CLI | `npm install -g @anthropic-ai/claude-code` |

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
├── bridge/                   # TypeScript persistent daemon & protocol
│   ├── src/
│   │   ├── daemon.ts        # SDK interaction & state management
│   │   ├── session-history.ts # JSONL parsing & history merge
│   │   └── protocol.ts      # Shared command/event types
│   └── tests/               # Bridge & daemon unit tests
├── src/
│   ├── main.cpp              # QApplication entry point
│   ├── mainwindow.cpp/.h     # QWebEngineView setup, QWebChannel registration
│   ├── bridgedaemon.cpp/.h   # Persistent Node process manager
│   ├── claudebridge.cpp/.h   # Qt/JS boundary adapter
│   └── attachmentstore.cpp/.h # Native image staging & MIME validation
└── resources/
    ├── resources.qrc          # Bundles web assets into the binary
    └── chat/
        ├── index.html        # Bootstrap: Claudian UI, QWebChannel wiring
        ├── chat.js           # Chat logic, session management, rendering
        ├── chat.css          # Chat UI styles (with streaming & gallery support)
        └── marked.min.js     # Markdown parser
```

## Key data flows

**Sending a message**
1. User types in `input-textarea` and/or attaches images (via button, drag-drop, or paste).
2. `chat.js` calls `bridge.sendMessage(text, attachmentsJson)` over `QWebChannel`.
3. `ClaudeBridge` sends a `send` command over the persistent stdin pipe to the Node.js daemon.
4. The daemon uses the Claude Agent SDK's `query()` API with an `AbortController`.
5. Streaming events (`text_ready`, `tool_use`) are written to stdout and emitted as Qt signals.
6. `chat.js` renders chunks incrementally; the UI auto-scrolls and shows a "Stop" button.

**Attachment staging**
- Images are imported via `AttachmentStore` (C++), which validates MIME types and copies them to a local staging directory.
- When a turn completes successfully, the daemon moves staged files to a session-specific attachment folder and updates a `manifest.json`.
- History turns merge manifest data to render image galleries above message text.

**Session continuity**
- The persistent daemon maintains the `session_id` and automatically resumes sessions using `--resume` logic via the SDK.
- Changing the working directory (`cwd`) resets the session state in the daemon.

**Streaming UX**
- A `MutationObserver` in the web view detects DOM changes during streaming to provide intelligent auto-scroll.
- A typing indicator shows "Claude is thinking..." before the first token arrives.
- The "Stop" button sends an `abort` command to the daemon, which triggers the SDK's `AbortController`.

## License

Apache 2.0 — see [LICENSE](LICENSE).
