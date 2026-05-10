# Claudian Qt

A native macOS/Windows desktop wrapper for [Claude Code](https://claude.ai/code), built with Qt6 and WebEngine. It renders the [Claudian](https://github.com/YishenTu/claudian) chat interface inside a native window and bridges it to a persistent TypeScript daemon powered by the `@anthropic-ai/claude-agent-sdk`.

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
- **Web layer** — `index.html` renders the Claudian chat interface. It streams tokens incrementally, renders tool invocations and their output inline, and provides code block copy buttons and transcript export.
- **Image Support** — `AttachmentStore` (C++) handles native file staging for drag-and-drop, file picking, and clipboard paste. Clipboard images are read directly via `QApplication::clipboard()` (the DataTransfer web API is non-functional in Qt WebEngine). Any unsupported format (e.g. macOS TIFF screenshots) is converted to PNG via `QImage` before staging. Thumbnails are encoded as base64 data URLs so they load correctly from the `qrc://` page origin.


## Prerequisites

| Requirement | macOS | Windows |
|---|---|---|
| OS | 12 Monterey or later | Windows 10/11 |
| Compiler | Xcode Command Line Tools | MSVC 2022 (via Visual Studio) |
| CMake | ≥ 3.16 | ≥ 3.16 |
| Qt6 | 6.11.0 via Homebrew | 6.11.0 via Qt installer |
| Node.js | ≥ 18 | ≥ 18 |
| Shell | bash | Git Bash (MSYS2) |
| Claude Code CLI | `npm install -g @anthropic-ai/claude-code` | same |

### macOS — install Qt

```bash
brew install qtbase qtwebengine qtdeclarative
```

### Windows — install Qt

Download the Qt Online Installer from [qt.io/download](https://www.qt.io/download-open-source) and install the **MSVC 2022 64-bit** component for Qt 6.11.0. Note the compiler-specific directory it installs to, e.g.:

```
C:\Qt\6.11.0\msvc2022_64
```

You will set this path as `QT_HOME` before building.

## Build

Use the provided script — it detects the platform, configures on first run, and builds:

```bash
bash scripts/build.sh          # build only
bash scripts/build.sh --run    # build and launch
```

### macOS

No extra setup needed. The script resolves Qt from the Homebrew Cellar automatically.

### Windows (Git Bash)

Open a **Developer Command Prompt for VS 2022**, then launch Git Bash from it (so MSVC tools are on `PATH`). Set `QT_HOME` to your compiler-specific Qt directory and run the script:

```bash
export QT_HOME="C:/Qt/6.11.0/msvc2022_64"
bash scripts/build.sh --run
```

The script passes `QT_HOME` as `CMAKE_PREFIX_PATH` so CMake finds all Qt6 modules. On `--run` it prepends `$QT_HOME/bin` to `PATH` so Qt DLLs are resolved at launch.

> **Tip:** add `export QT_HOME=...` to your `~/.bashrc` so you don't have to set it each session.

### Manual configure (macOS)

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

### macOS

```bash
QT_PLUGIN_PATH=/opt/homebrew/Cellar/qtbase/6.11.0/share/qt/plugins \
  ./build/ClaudianQt.app/Contents/MacOS/ClaudianQt
```

### Windows

```bash
PATH="$QT_HOME/bin:$PATH" ./build/ClaudianQt.exe
```

### Remote debugging (Chrome DevTools)

Set `QTWEBENGINE_REMOTE_DEBUGGING=9222` before launching, then open `http://127.0.0.1:9222` in any Chromium-based browser.

```bash
# macOS
QTWEBENGINE_REMOTE_DEBUGGING=9222 \
QT_PLUGIN_PATH=/opt/homebrew/Cellar/qtbase/6.11.0/share/qt/plugins \
  ./build/ClaudianQt.app/Contents/MacOS/ClaudianQt

# Windows
QTWEBENGINE_REMOTE_DEBUGGING=9222 PATH="$QT_HOME/bin:$PATH" ./build/ClaudianQt.exe
```

## Project structure

```
claudian-qt/
├── bridge/                   # TypeScript persistent daemon & protocol
│   ├── src/
│   │   ├── daemon.ts          # SDK interaction & state management
│   │   ├── session-history.ts # JSONL parsing & history merge
│   │   ├── attachment-store.ts # Attachment finalization & manifest I/O
│   │   └── protocol.ts        # Shared command/event types
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
5. Streaming events (`text_ready`, `tool_use`, `tool_result`) are written to stdout and emitted as Qt signals.
6. `chat.js` renders chunks incrementally; the UI auto-scrolls and shows a "Stop" button.

**Tool use and results**
- When Claude invokes a tool, the daemon emits a `tool_use` event (with the tool's `id`, `name`, and `input`). These appear as a collapsible "Ran N commands" group inside the assistant message.
- After the SDK executes each tool and sends the result back to Claude, the daemon intercepts the `user` message containing `tool_result` blocks and emits a `tool_result` event with the tool's `id`, output text, and error status.
- The matching tool item in the UI is updated live: status changes from ⏳ to ✓/✗ and the output is displayed in an expandable `<pre>` block. The group auto-expands when the first result arrives.

**Attachment staging**
- Images enter via three paths: file picker (`pickImages()`), drag-and-drop onto the chat area, or clipboard paste (`pasteImageFromClipboard()` reads `QApplication::clipboard()` directly — Qt WebEngine does not expose clipboard image data through the JS DataTransfer API).
- `AttachmentStore` (C++) stages each image: unsupported formats (e.g. macOS TIFF screenshots) are converted to PNG via `QImage`, then written to `~/.claudian-qt/attachments/staging/`. The `fileUrl` field is a base64 data URL so thumbnails display from the `qrc://` page without cross-scheme restrictions.
- When a turn completes, the daemon moves staged files to `~/.claudian-qt/attachments/sessions/<id>/turn-NNNN/` and records the location in `manifest.json`.
- On session restore, `loadSessionHistory` re-reads each attachment file from disk and re-encodes it as a data URL so history thumbnails render correctly.

**Session continuity**
- The persistent daemon maintains the `session_id` and automatically resumes sessions using `--resume` logic via the SDK.
- Changing the working directory (`cwd`) resets the session state in the daemon.

**Streaming UX**
- Token streaming renders incrementally via `requestAnimationFrame` batching to prevent layout thrashing.
- The typing indicator label switches between "Claude is thinking…" (waiting for first token) and "Running tools…" (tool execution in progress), then disappears once text tokens arrive.
- Each code block rendered from Markdown gets a hover-revealed "Copy" button that writes to the clipboard.
- The "Stop" button sends an `abort` command to the daemon, which triggers the SDK's `AbortController`.

**Permission dialog**
- The Claude Agent SDK requires `--permission-prompt-tool stdio` on the spawned CLI process to route permission requests over IPC rather than a terminal. This flag is only added when a `canUseTool` callback is provided, so the daemon always supplies one.
- In normal mode, when the CLI requests permission for a tool (e.g. WebFetch, file writes outside the working directory), the daemon emits a `permission_request` event with the tool name, human-readable title and description, and any blocked path. This flows through `BridgeDaemon` → `ClaudeBridge` → JS via `QWebChannel`.
- The UI shows a modal dialog with **Deny**, **Allow Once**, and **Always Allow** buttons. The user's choice is sent back via `bridge.respondToPermission(requestId, allow, alwaysAllow)` → `ClaudeBridge::respondToPermission` → daemon stdin → the pending Promise resolves with the appropriate `PermissionResult`.
- In YOLO mode, the same `canUseTool` callback is used but resolves immediately with `{ behavior: "allow" }` without showing the dialog, preserving the IPC channel while bypassing all prompts.
- The dialog dismisses automatically on abort or turn complete. Escape also denies and closes it.

**Transcript export**
- The download icon in the top bar opens a native save dialog.
- `ClaudeBridge::writeTextFile` serializes the current conversation (user messages, assistant responses, tool calls with their output) to Markdown and writes the file.
- A brief toast notification confirms the save path.

## License

Apache 2.0 — see [LICENSE](LICENSE).
