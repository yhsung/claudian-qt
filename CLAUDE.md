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

<!-- GSD:project-start source:PROJECT.md -->
## Project

**ClaudianQt — Conversation Tracing**

A conversation tracing system for ClaudianQt, the Qt6 desktop wrapper for Claude Code CLI. It captures every user prompt and assistant response (with rich metadata) into local log files for downstream data mining, usage analysis, and AI training dataset creation.

**Core Value:** Every conversation is reliably captured with complete context — no messages lost, no metadata missing — so logs can be used as training data and for usage analysis without manual intervention.

### Constraints

- **Tech stack**: Must integrate with existing C++ / Qt6 architecture — logging should happen in the C++ layer for reliability
- **Performance**: Logging must not block the UI or slow streaming responses — use async file I/O or buffered writes
- **Compatibility**: macOS 12+ (current target platform)
- **File size**: Conversations can be long — consider file rotation or size limits for very large sessions
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- C++ 17 - Qt/WebEngine native application layer (`src/*.cpp`, `src/*.h`)
- JavaScript (ES6+) - Web UI bootstrap and QWebChannel integration (`resources/chat/index.html`)
- HTML5 - Main UI template (`resources/chat/index.html`)
- CSS3 - Styling (`resources/chat/claudian.css`, `resources/claudian/styles.css`)
- YAML - CI/CD workflow configuration (`.github/workflows/*.yml`)
## Runtime
- C++ compiled executable (macOS binary)
- Qt6 WebEngine (Chromium-based) - JavaScript/HTML runtime
- macOS 12 Monterey or later
- ARM64 architecture (optimized in CI/CD with `arm64.dmg` artifact)
## Frameworks & Libraries
- Qt 6.8+ - Desktop GUI framework
- Claudian plugin bundle (CommonJS via esbuild) - Chat UI loaded from `resources/claudian/main.js`
- Obsidian API mock (`obsidian-shim.js`) - Minimal compatibility layer for running Claudian outside Obsidian
- QWebChannel JavaScript API (built into Qt) - Bridges Qt signals/slots to JavaScript
- Claudian design system CSS - Dark mode theme via CSS variables (`resources/claudian/styles.css`)
- Obsidian CSS variable defaults - Fallback for `--background-primary`, `--text-normal`, etc.
## Key Dependencies
- Qt 6.8.x (modular Homebrew formulae: `qtbase`, `qtwebengine`, `qtdeclarative`)
- macOS system frameworks (Cocoa for native window management)
- QWebChannel transport (bundled with Qt6::WebChannel)
- Claudian plugin CommonJS bundle (bundled as `resources/claudian/main.js`)
- Minimal polyfills in `obsidian-shim.js` for Node.js/Electron APIs
- Claude Code CLI - `@anthropic-ai/claude-code` (installed globally via npm)
## Configuration
- CMake 3.16+ - Project configuration
- Environment variables (Qt/WebEngine):
- Working directory - Set at runtime via C++ `QProcess::setWorkingDirectory()`
- `qt.conf` - Configures plugin directory for sandboxed app bundle
- Cocoa integration plugin bundled at `Contents/PlugIns/platforms/libqcocoa.dylib`
## Build Configuration
- C++ standard: C++17 (`CMAKE_CXX_STANDARD`)
- Meta-object compilation: Automatic (`CMAKE_AUTOMOC ON`)
- Resource compilation: Automatic (`CMAKE_AUTORCC ON`)
- Output: Native macOS executable with app bundle structure
- `resources.qrc` - Qt resource file that embeds:
- macOS app bundle: `build/ClaudianQt.app` (from CMake on GitHub Actions)
- Disk image: `ClaudianQt-<version>-arm64.dmg` (release automation)
## Platform Requirements
- macOS 12+ with Xcode Command Line Tools
- Homebrew with modular Qt6 formulae (`qtbase`, `qtwebengine`, `qtdeclarative`)
- CMake 3.16+
- Node.js + `npm install -g @anthropic-ai/claude-code`
- macOS 12+ (no additional dependencies beyond bundled Qt libraries and system frameworks)
- Claude Code CLI must be installed: `npm install -g @anthropic-ai/claude-code`
## CI/CD Stack
- GitHub Actions (`.github/workflows/`)
- GitHub Releases API (for publishing DMG artifacts)
- macOS runner (`runs-on: macos-latest`)
- GitHub Actions Qt installation: `jurplel/install-qt-action@v4` (v6.8.*)
- macdeployqt (Qt tool) - Bundles dependencies into app
- hdiutil - Creates distributable disk image (DMG)
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Naming Patterns
- C++ headers: `.h` (not `.hpp`)
- C++ implementation: `.cpp`
- JavaScript: `.js`
- HTML: `index.html` (single entry point)
- CSS: `.css` files (e.g., `claudian.css`)
- QRC (Qt resources): `resources.qrc`
- PascalCase for class names
- Qt convention: Classes inherit from `QObject` and use `Q_OBJECT` macro
- Member variables prefixed with `m_` (Qt convention)
- camelCase for public methods
- private methods also camelCase
- getters: simple name or `get` prefix
- Slots: camelCase, prefixed with `on` for event handlers
- Signals: camelCase, emitted-as-event naming
- camelCase for variables and functions
- UPPER_SNAKE_CASE for constants
- Private methods/properties: underscore prefix
- Classes: PascalCase
- Q_PROPERTY macro defines properties with lowercase names
## Code Style
- No automated formatter configured (no `.clang-format`, `.prettier.rc`, or ESLint config)
- Manual formatting observed in codebase
- 4 spaces (observed in all `.cpp` and `.h` files)
- 2 spaces (observed in inline JS in `index.html`)
- Opening brace on same line for classes/functions
- Opening brace on same line for control flow
- Opening brace on same line
- No strict enforced limit observed
- Lines range from 40 to 100+ characters
## Import Organization
#include "claudebridge.h"
#include <QDir>
#include <QFile>
#include <QFileDialog>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
- Inline in HTML (no module bundler)
- Load order critical: `qwebchannel.js` → `obsidian-shim.js` → `claudian/main.js` → bootstrap code
- Specified in `index.html` lines 261-265:
- `qrc:/chat/` — web UI files
- `qrc:///claudian/` — Claudian design system assets
- `qrc:///qtwebchannel/` — Qt WebChannel library
## Error Handling
- Signals for error propagation (Qt pattern)
- No exceptions thrown; errors emitted as signals
- `errorOccurred(const QString &msg)` signal broadcasts errors
- Try-catch for JSON parsing; silently default on error
- `index.html` line 272-274:
## Logging
- Not actively used in application code
- CLI subprocess (`claude --verbose`) provides diagnostic output captured via `QProcess::readAllStandardError()`
- Inline debugging with `console.log()` (not observed in current code; would be added if needed)
- Errors displayed in UI via `#qt-error` div
- `index.html` line 215-220:
## Comments
- Comment non-obvious algorithm logic
- Explain Qt signal/slot mechanics
- Document intent for platform-specific code (e.g., macOS bundle layout)
- Not used in this codebase
- No formal documentation strings on functions
## Function Design
- C++ uses const references for string/large objects
- JavaScript uses flexible parameter lists
- C++ slots: `void` (Qt convention)
- C++ query methods: `QString` for ID, empty string if none
- JavaScript: Promises, async generators, or void
- Used to guard against invalid inputs
- Example: `claudebridge.cpp` line 26, 30, 120 (return if conditions not met)
## Module Design
- CommonJS `window.module.exports.default`
- `resources/claudian/main.js` exports ClaudianPlugin class
- Consumed by bootstrap code in `index.html` line 351:
- `main.cpp`: Qt app entry point
- `mainwindow.cpp`: Window setup, WebEngine initialization, QWebChannel registration
- `claudebridge.cpp`: Qt/JS bridge, property management, session persistence
- `claudeprocess.cpp`: Subprocess spawning, JSON streaming, signal emission
- Not used (no module bundler; direct includes)
- `QApplication` (root)
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## Pattern Overview
- **Subprocess-based architecture**: Each user message spawns a fresh `claude` CLI process, parsed as newline-delimited JSON stream
- **Stateless subprocess, stateful session**: The app manages session continuity (resuming via `--resume`) while the Claude CLI remains stateless per process
- **Two-way signal/slot communication**: C++ signals flow to JavaScript (streaming responses), JavaScript slots invoke C++ methods (send message, abort, settings)
- **Resource bundling**: Static assets (HTML, CSS, design system) compiled into the binary via Qt resource system (`qrc`)
## Layers
- Purpose: Render chat interface with Claudian design system, handle user input, display streaming responses
- Location: `resources/chat/index.html`, `resources/chat/claudian.css`, `resources/claudian/main.js` (Claudian plugin)
- Contains: HTML markup, inline CSS, embedded JavaScript (QtBridgeService, UI controllers from Claudian plugin)
- Depends on: QtBridgeService (adapter to C++ bridge), Claudian plugin (UI/state management)
- Used by: User interactions (send message, pick folder, view history)
- Purpose: Translate between JavaScript calls and C++ objects; expose C++ state and signals to web context
- Location: `src/claudebridge.h`, `src/claudebridge.cpp`
- Contains: Q_OBJECT with properties (`cwd`, `model`, `yolo`), public slots (`sendMessage`, `abort`, `setCwd`, `setModel`, `setYolo`, `pickFolder`, session history methods), signals (`textReady`, `toolUse`, `turnComplete`, `errorOccurred`, property change notifications)
- Depends on: ClaudeProcess (subprocess spawning and parsing)
- Used by: MainWindow (registration on QWebChannel), JavaScript (via QWebChannel binding to `bridge` object)
- Purpose: Spawn and manage `claude` CLI subprocess, parse streaming JSON output, emit parsed events
- Location: `src/claudeprocess.h`, `src/claudeprocess.cpp`
- Contains: QProcess lifecycle management, newline-delimited JSON parser, signal emissions for initialization, text chunks, tool invocations, errors
- Depends on: Qt Core (QProcess, JSON parsing)
- Used by: ClaudeBridge (receives parsed events, relays as signals)
- Purpose: Create QApplication, instantiate main window, initialize web view with QWebChannel bridge
- Location: `src/main.cpp`, `src/mainwindow.h`, `src/mainwindow.cpp`
- Contains: QApplication initialization, QMainWindow setup, QWebEngineView creation, QWebChannel registration, resource loading
- Depends on: ClaudeBridge, Qt Widgets, Qt WebEngine
- Used by: Operating system (entry point)
## Data Flow
## Key Abstractions
- Purpose: Qt/JS boundary object; translates between JavaScript calls and C++ method invocations, manages application state
- Examples: `src/claudebridge.h`, `src/claudebridge.cpp`
- Pattern: Qt `Q_OBJECT` with properties, slots (callable from JS), signals (received by JS); exposes state (`cwd`, `model`, `yolo`) and operations (`sendMessage`, `abort`, folder picker, session management)
- Purpose: Encapsulate subprocess lifecycle and output parsing
- Examples: `src/claudeprocess.h`, `src/claudeprocess.cpp`
- Pattern: Qt `QObject` managing single active `QProcess` instance; state machine: idle → running → finished; accumulates stdout in buffer, emits signals on JSON boundaries
- Purpose: Adapter translating C++ signal flow into async generator pattern expected by Claudian plugin
- Examples: Inline in `resources/chat/index.html` (lines 274–339)
- Pattern: Maintains queue of chunks (from C++ signals), implements async generator `query()` that yields chunks as they arrive or await if queue empty; `abort()` kills process and flushes queue
- Purpose: Provides chat UI state management, message rendering, input handling
- Examples: `resources/claudian/main.js` (third-party, not in-tree)
- Pattern: Plugin architecture expecting Obsidian App interface; instantiated by bootstrap code with mock App object; exposes ClaudianView (UI component) and controllers (InputController, StreamController)
## Entry Points
- Location: `src/main.cpp`
- Triggers: User launches `./ClaudianQt` binary
- Responsibilities: Create `QApplication`, instantiate `MainWindow`, enter event loop
- Location: `src/mainwindow.cpp` constructor
- Triggers: `MainWindow` object instantiation in main()
- Responsibilities:
- Location: `resources/chat/index.html` (lines 264–450+)
- Triggers: WebEngine finishes loading HTML
- Responsibilities:
## Error Handling
## Cross-Cutting Concerns
- C++ layer: `claude` subprocess run with `--verbose` flag (output captured in stderr, not parsed)
- JavaScript layer: Inline `console.log()` available in DevTools (launch with `--remote-debugging-port=9222`)
- Message text: `ClaudeBridge::sendMessage()` calls `text.trimmed().isEmpty()` — rejects empty input
- Session ID: `ClaudeBridge::loadSession()` guards against loading same session twice (no-op if `m_sessionId == sessionId`)
- Delegated to `claude` CLI — authentication token stored in `~/.claude/config.json` by CLI installer
- App never handles API keys directly
- User selects via folder picker → stored in `ClaudeBridge::m_cwd`
- Passed to every `claude` subprocess invocation (working directory for relative file paths)
- Changing cwd clears session ID (enforces fresh session per directory)
- Handled entirely by `claude` CLI — maintains `~/.claude/projects/<cwd-encoded>/*.jsonl` files
- App reads these files to display history but does not write them (CLI is sole writer)
- JSONL format: one JSON object per line, each representing a content block with metadata (type, timestamp, role, message)
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
