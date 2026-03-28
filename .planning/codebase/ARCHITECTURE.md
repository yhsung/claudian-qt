# Architecture

**Analysis Date:** 2026-03-28

## Pattern Overview

**Overall:** Qt6 Desktop Wrapper with WebEngine Bridge

A **three-tier desktop application** that acts as a native GUI for the Claude Code CLI. The architecture separates concerns into:
1. **C++ application layer** — Native desktop window, process lifecycle, IPC bridge
2. **Web bridge** — QWebChannel-based communication layer
3. **JavaScript/UI layer** — Claudian design system chat interface embedded in WebEngine

Key Characteristics:
- **Subprocess-based architecture**: Each user message spawns a fresh `claude` CLI process, parsed as newline-delimited JSON stream
- **Stateless subprocess, stateful session**: The app manages session continuity (resuming via `--resume`) while the Claude CLI remains stateless per process
- **Two-way signal/slot communication**: C++ signals flow to JavaScript (streaming responses), JavaScript slots invoke C++ methods (send message, abort, settings)
- **Resource bundling**: Static assets (HTML, CSS, design system) compiled into the binary via Qt resource system (`qrc`)

## Layers

**Presentation / UI Layer:**
- Purpose: Render chat interface with Claudian design system, handle user input, display streaming responses
- Location: `resources/chat/index.html`, `resources/chat/claudian.css`, `resources/claudian/main.js` (Claudian plugin)
- Contains: HTML markup, inline CSS, embedded JavaScript (QtBridgeService, UI controllers from Claudian plugin)
- Depends on: QtBridgeService (adapter to C++ bridge), Claudian plugin (UI/state management)
- Used by: User interactions (send message, pick folder, view history)

**Bridge / IPC Layer:**
- Purpose: Translate between JavaScript calls and C++ objects; expose C++ state and signals to web context
- Location: `src/claudebridge.h`, `src/claudebridge.cpp`
- Contains: Q_OBJECT with properties (`cwd`, `model`, `yolo`), public slots (`sendMessage`, `abort`, `setCwd`, `setModel`, `setYolo`, `pickFolder`, session history methods), signals (`textReady`, `toolUse`, `turnComplete`, `errorOccurred`, property change notifications)
- Depends on: ClaudeProcess (subprocess spawning and parsing)
- Used by: MainWindow (registration on QWebChannel), JavaScript (via QWebChannel binding to `bridge` object)

**Process Management / Core Logic Layer:**
- Purpose: Spawn and manage `claude` CLI subprocess, parse streaming JSON output, emit parsed events
- Location: `src/claudeprocess.h`, `src/claudeprocess.cpp`
- Contains: QProcess lifecycle management, newline-delimited JSON parser, signal emissions for initialization, text chunks, tool invocations, errors
- Depends on: Qt Core (QProcess, JSON parsing)
- Used by: ClaudeBridge (receives parsed events, relays as signals)

**Window / Application Container:**
- Purpose: Create QApplication, instantiate main window, initialize web view with QWebChannel bridge
- Location: `src/main.cpp`, `src/mainwindow.h`, `src/mainwindow.cpp`
- Contains: QApplication initialization, QMainWindow setup, QWebEngineView creation, QWebChannel registration, resource loading
- Depends on: ClaudeBridge, Qt Widgets, Qt WebEngine
- Used by: Operating system (entry point)

## Data Flow

**User sends a message:**

1. User types in chat input (rendered by Claudian plugin)
2. JavaScript calls `bridge.sendMessage(text)` — C++ slot
3. `ClaudeBridge::sendMessage()` validates text, calls `ClaudeProcess::send()` with current `cwd`, `sessionId`, `model`, `yolo` flag
4. `ClaudeProcess::send()` kills any running process, creates new `QProcess`, constructs `claude` command:
   - `claude --output-format stream-json --verbose --print "<prompt>"`
   - Appends `--resume <sessionId>` if resuming existing session
   - Appends `--model <model>` if model override set
   - Appends `--dangerously-skip-permissions` if yolo enabled
5. Process starts; stdout connected to `onReadyRead()` slot

**Streaming response:**

1. `claude` subprocess writes newline-delimited JSON to stdout
2. `onReadyRead()` appends bytes to `m_buffer`, splits on `\n`, calls `parseLine()` for each complete line
3. `parseLine()` deserializes JSON and dispatches based on `type` field:
   - `system/init` → emits `sessionInitialized(sessionId)` → ClaudeBridge stores in `m_sessionId`
   - `assistant` content blocks → for each block:
     - `type: "text"` → emits `textReady(text)` — JavaScript receives via signal, appends to current message
     - `type: "tool_use"` → emits `toolUseStarted(name, inputJson)` — JavaScript displays tool invocation
     - `type: "thinking"` skipped (not rendered in POC)
   - `result/is_error` → emits `errorOccurred(msg)` — JavaScript displays error banner
4. Process finishes; `finished()` signal emits `turnFinished()` → JavaScript ends turn, enables input

**Session continuity:**

1. `ClaudeBridge` maintains `m_sessionId` — extracted from first `system/init` message
2. On subsequent `sendMessage()` calls within same `cwd`, passes `m_sessionId` as `--resume` argument
3. `cwd` change clears `m_sessionId` → next message starts fresh session

**Session history retrieval:**

1. JavaScript calls `bridge.requestSessions()` — scans `~/.claude/projects/<cwd-encoded>/` for `.jsonl` files
2. For each session file, reads first user message as preview and extracts timestamp
3. Returns JSON array: `[{id, preview, timestamp}, ...]`
4. User selects session → calls `bridge.loadSession(sessionId)`
5. `ClaudeBridge::loadSession()` reads JSONL file, reconstructs turns by grouping consecutive `assistant` lines and extracting user messages
6. Emits `sessionHistoryLoaded(turns)` with turn history for UI to render

## Key Abstractions

**ClaudeBridge:**
- Purpose: Qt/JS boundary object; translates between JavaScript calls and C++ method invocations, manages application state
- Examples: `src/claudebridge.h`, `src/claudebridge.cpp`
- Pattern: Qt `Q_OBJECT` with properties, slots (callable from JS), signals (received by JS); exposes state (`cwd`, `model`, `yolo`) and operations (`sendMessage`, `abort`, folder picker, session management)

**ClaudeProcess:**
- Purpose: Encapsulate subprocess lifecycle and output parsing
- Examples: `src/claudeprocess.h`, `src/claudeprocess.cpp`
- Pattern: Qt `QObject` managing single active `QProcess` instance; state machine: idle → running → finished; accumulates stdout in buffer, emits signals on JSON boundaries

**QtBridgeService:**
- Purpose: Adapter translating C++ signal flow into async generator pattern expected by Claudian plugin
- Examples: Inline in `resources/chat/index.html` (lines 274–339)
- Pattern: Maintains queue of chunks (from C++ signals), implements async generator `query()` that yields chunks as they arrive or await if queue empty; `abort()` kills process and flushes queue

**Claudian Plugin (main.js):**
- Purpose: Provides chat UI state management, message rendering, input handling
- Examples: `resources/claudian/main.js` (third-party, not in-tree)
- Pattern: Plugin architecture expecting Obsidian App interface; instantiated by bootstrap code with mock App object; exposes ClaudianView (UI component) and controllers (InputController, StreamController)

## Entry Points

**Application startup:**
- Location: `src/main.cpp`
- Triggers: User launches `./ClaudianQt` binary
- Responsibilities: Create `QApplication`, instantiate `MainWindow`, enter event loop

**Window creation:**
- Location: `src/mainwindow.cpp` constructor
- Triggers: `MainWindow` object instantiation in main()
- Responsibilities:
  - Create `ClaudeBridge` (app state and IPC)
  - Create `QWebChannel` and register bridge as `"claude"`
  - Create `QWebEngineView` and attach channel
  - Load `qrc:/chat/index.html` (bundled HTML)
  - Set window title, size, central widget

**Page load / JavaScript execution:**
- Location: `resources/chat/index.html` (lines 264–450+)
- Triggers: WebEngine finishes loading HTML
- Responsibilities:
  - Load QWebChannel library (`qrc:///qtwebchannel/qwebchannel.js`)
  - Load Obsidian shim (`qrc:///chat/obsidian-shim.js`)
  - Load Claudian plugin (`qrc:///claudian/main.js`)
  - Bootstrap async IIFE:
    - Instantiate `QtBridgeService` (wraps C++ bridge for Claudian)
    - Create mock Obsidian `App` object
    - Instantiate `ClaudianPlugin`
    - Inject QtBridgeService into plugin's active tab
    - Mount plugin to `#claudian-root` DOM node

## Error Handling

**Strategy:** Layered error containment — C++ errors logged and signaled, JS errors caught and displayed in UI

**Patterns:**

1. **Process startup failure:**
   - `ClaudeProcess::send()` → `m_proc->waitForStarted(3000)` fails
   - Emits `errorOccurred("Failed to start 'claude'. Is it installed?...")`
   - JavaScript receives via `bridge.errorOccurred` signal, displays red banner in `#qt-error`

2. **Process error (ProcessError signal):**
   - `onProcessError()` slot triggered if process fails to start
   - Emits `errorOccurred()` with diagnostic message

3. **JSON parse error during streaming:**
   - `parseLine()` → `QJsonDocument::fromJson()` fails or not an object
   - Line silently skipped (no error signal) — allows malformed/verbose lines to pass through

4. **Result error in stream:**
   - JSON message with `type: "result"` and `is_error: true`
   - Emits `errorOccurred(msg)`
   - JavaScript displays error, re-enables input

5. **JavaScript error in page:**
   - Caught by browser console
   - IIFE bootstrap wraps plugin instantiation in try/catch, displays stack to `#qt-error` div if constructor fails

## Cross-Cutting Concerns

**Logging:**
- C++ layer: `claude` subprocess run with `--verbose` flag (output captured in stderr, not parsed)
- JavaScript layer: Inline `console.log()` available in DevTools (launch with `--remote-debugging-port=9222`)

**Validation:**
- Message text: `ClaudeBridge::sendMessage()` calls `text.trimmed().isEmpty()` — rejects empty input
- Session ID: `ClaudeBridge::loadSession()` guards against loading same session twice (no-op if `m_sessionId == sessionId`)

**Authentication:**
- Delegated to `claude` CLI — authentication token stored in `~/.claude/config.json` by CLI installer
- App never handles API keys directly

**Directory context (cwd):**
- User selects via folder picker → stored in `ClaudeBridge::m_cwd`
- Passed to every `claude` subprocess invocation (working directory for relative file paths)
- Changing cwd clears session ID (enforces fresh session per directory)

**Session persistence:**
- Handled entirely by `claude` CLI — maintains `~/.claude/projects/<cwd-encoded>/*.jsonl` files
- App reads these files to display history but does not write them (CLI is sole writer)
- JSONL format: one JSON object per line, each representing a content block with metadata (type, timestamp, role, message)

---

*Architecture analysis: 2026-03-28*
