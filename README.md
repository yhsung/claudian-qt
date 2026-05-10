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
- Each code block rendered from Markdown gets a hover-revealed "Copy" button that writes to the clipboard. Tool result output blocks get the same treatment via `makeToolResultEl()`.
- The "Stop" button sends an `abort` command to the daemon, which triggers the SDK's `AbortController`.

**Message timestamps**
- Every user and assistant message shows a relative timestamp (`just now`, `3m ago`, `2h ago`, etc.) rendered below the bubble using the `relativeTime()` helper. User timestamps are right-aligned; assistant timestamps are left-aligned.

**Transcript search**
- ⌘F or the magnifier icon in the top bar opens an inline search bar. Typing uses a `TreeWalker` to wrap every matching text node in a `<mark>` element inside `.msg-content`, `.msg-bubble`, and `.tool-result` blocks — preserving the HTML structure. Non-matching messages are dimmed.
- ↑ / ↓ buttons and Shift+Enter / Enter navigate between individual occurrences. The current mark is highlighted with a brighter amber; the count shows `N of M`. Escape or × unwraps all marks and restores the DOM.

**Attachment tray**
- When two or more images are staged for sending, a "Clear all" button appears alongside the individual × remove buttons.

**Keyboard shortcuts**
- Escape is handled by a single prioritised listener that dismisses overlays from innermost to outermost: image preview → permission dialog → search bar → summary view.
- ⌘F / Ctrl+F opens transcript search from anywhere.

**Per-turn token badge and stop reason**
- After each assistant turn the C++ `resultReceived` handler now includes `stopReason`, `subtype`, `cacheReadTokens`, and `cacheCreatedTokens` in the `usageUpdated` payload alongside the token counts.
- A `.msg-meta-badge` is stamped below the last assistant message showing total tokens for the turn (e.g. `3.2k tokens`). When the turn ended for a reason other than `end_turn` (e.g. `max_tokens`, an error subtype) that reason is appended after a `·` separator. A `💾 cached` label appears when prompt-cache hits are detected; hovering reveals a breakdown of read vs. created cache tokens.

**Regenerate last response**
- Every `sendMessage` call saves `_lastPrompt` (text + attachments JSON). After streaming completes, a hover-revealed "↺ Retry" button appears on the last assistant message.
- Clicking removes that message from `state.messages` and the DOM, then re-calls `bridge.sendMessage` with the cached prompt so a new response streams into a fresh slot.

**Session management**
- Each sidebar session item shows a hover-revealed `×` delete button. Confirming sends a `delete_session` command to the daemon, which unlinks the `.jsonl` file from `~/.claude/projects/<cwd>/` and re-emits `sessions_listed` to refresh the sidebar.
- If the deleted session was active, the message list and statusline are cleared locally before deletion.

**Permission mode**
- A three-state cycle button sits left of the YOLO toggle: **Safe** (default — prompts for all tool permissions), **Smart** (`acceptEdits` — auto-approves file read/write operations, prompts for network and shell), **Auto** (SDK classifier approves or denies without user interaction).
- The selected mode is persisted in `localStorage` and sent to the daemon as `permissionMode` on every `query()` call. YOLO overrides to `bypassPermissions` regardless of this setting.

**Permission dialog**
- The Claude Agent SDK requires `--permission-prompt-tool stdio` on the spawned CLI process to route permission requests over IPC rather than a terminal. This flag is only added when a `canUseTool` callback is provided, so the daemon always supplies one.
- In normal mode, when the CLI requests permission for a tool (e.g. WebFetch, file writes outside the working directory), the daemon emits a `permission_request` event with the tool name, human-readable title and description, and any blocked path. This flows through `BridgeDaemon` → `ClaudeBridge` → JS via `QWebChannel`.
- The UI shows a modal dialog with **Deny**, **Allow Once**, and **Always Allow** buttons. The user's choice is sent back via `bridge.respondToPermission(requestId, allow, alwaysAllow)` → `ClaudeBridge::respondToPermission` → daemon stdin → the pending Promise resolves with the appropriate `PermissionResult`.
- In YOLO mode, the same `canUseTool` callback is used but resolves immediately with `{ behavior: "allow" }` without showing the dialog, preserving the IPC channel while bypassing all prompts.
- The dialog dismisses automatically on abort or turn complete. Escape also denies and closes it.

**Extended thinking display**
- The daemon intercepts `thinking_delta` events from the SDK's content-block stream (same path as `text_delta`) and emits `thinking_chunk` events through `BridgeDaemon` → `ClaudeBridge` → JS.
- `appendThinkingChunk()` builds a collapsible `.thinking-block` above the response text, progressively updating as chunks arrive. The block shows a ▶ toggle header labelled "Thinking".
- The **Thinking** view mode (previously a no-op in the view selector) now controls default expand state: blocks start expanded in Thinking mode and collapsed in all others. Switching modes expands or collapses all existing thinking blocks live. The thinking text is stored on `msg.thinking` so session history replay also shows the section.

**Cache hit indicator**
- `message_delta` stream events carry `cache_read_input_tokens` and `cache_creation_input_tokens` in their usage object. The daemon accumulates these across the turn and merges them into the `result` emit as `cacheReadTokens`/`cacheCreatedTokens`.
- C++ passes them through the `usageUpdated` payload. When `cacheReadTokens > 0`, a `💾 cached` label is added to the turn meta badge; the hover tooltip shows the exact read and created token counts.

**Sub-agent transparency**
- The daemon checks `parent_tool_use_id` on every `assistant` message from the SDK iterator. A non-null value means a sub-agent produced the message. Text blocks are collected and emitted as `sub_agent_message` events; with `includePartialMessages: true` these fire incrementally, giving progressive disclosure as the sub-agent generates output.
- `appendSubAgentMessage()` creates or updates a collapsible `.sub-agent-block` with a left accent border and `↳ Sub-agent` label inside the parent assistant message element.

**Transcript export**
- The download icon in the top bar opens a native save dialog.
- `ClaudeBridge::writeTextFile` serializes the current conversation (user messages, assistant responses, tool calls with their output) to Markdown and writes the file.
- A brief toast notification confirms the save path.

## License

Apache 2.0 — see [LICENSE](LICENSE).
