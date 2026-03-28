# Coding Conventions

**Analysis Date:** 2026-03-28

## Naming Patterns

**Files:**
- C++ headers: `.h` (not `.hpp`)
  - Example: `src/mainwindow.h`, `src/claudebridge.h`, `src/claudeprocess.h`
- C++ implementation: `.cpp`
  - Example: `src/main.cpp`, `src/mainwindow.cpp`
- JavaScript: `.js`
  - Example: `resources/chat/index.html` (inline), `resources/claudian/main.js`
- HTML: `index.html` (single entry point)
- CSS: `.css` files (e.g., `claudian.css`)
- QRC (Qt resources): `resources.qrc`

**Classes (C++):**
- PascalCase for class names
  - Example: `MainWindow`, `ClaudeBridge`, `ClaudeProcess`
- Qt convention: Classes inherit from `QObject` and use `Q_OBJECT` macro
  - Example: `class ClaudeBridge : public QObject`
- Member variables prefixed with `m_` (Qt convention)
  - Example: `m_webView`, `m_channel`, `m_claude`, `m_cwd`, `m_sessionId`

**Functions (C++):**
- camelCase for public methods
  - Example: `sendMessage()`, `abort()`, `setCwd()`, `requestSessions()`
- private methods also camelCase
  - Example: `onReadyRead()`, `onProcessError()`, `parseLine()`, `killCurrent()`
- getters: simple name or `get` prefix
  - Example: `cwd()`, `model()`, `yolo()` (Q_PROPERTY accessors)

**Slots and Signals (C++):**
- Slots: camelCase, prefixed with `on` for event handlers
  - Example: `onReadyRead`, `onProcessError`
- Signals: camelCase, emitted-as-event naming
  - Example: `textReady`, `toolUseStarted`, `turnFinished`, `errorOccurred`, `cwdChanged`

**JavaScript:**
- camelCase for variables and functions
  - Example: `QtBridgeService`, `_enqueue`, `_next`, `query()`, `abort()`
- UPPER_SNAKE_CASE for constants
  - Example: `TOOL_TODO_WRITE` (from `resources/claudian/main.js`)
- Private methods/properties: underscore prefix
  - Example: `_bridge`, `_queue`, `_waiter`, `_onText`, `_onTool`, `_onDone`, `_onError`
- Classes: PascalCase
  - Example: `QtBridgeService`

**Properties (Qt C++):**
- Q_PROPERTY macro defines properties with lowercase names
  - Example: `Q_PROPERTY(QString cwd READ cwd NOTIFY cwdChanged)`
  - Accessor: `cwd()`, Signal: `cwdChanged(const QString &)`

## Code Style

**Formatting:**
- No automated formatter configured (no `.clang-format`, `.prettier.rc`, or ESLint config)
- Manual formatting observed in codebase

**Indentation (C++):**
- 4 spaces (observed in all `.cpp` and `.h` files)
  - Example: `mainwindow.cpp` lines 3-18

**Indentation (JavaScript):**
- 2 spaces (observed in inline JS in `index.html`)
  - Example: line 267-330 in `index.html` (QtBridgeService class)

**Braces (C++):**
- Opening brace on same line for classes/functions
  - Example: `class ClaudeBridge : public QObject {`
  - Example: `void ClaudeBridge::sendMessage(const QString &text) {`
- Opening brace on same line for control flow
  - Example: `if (!dir.isEmpty()) {`

**Braces (JavaScript):**
- Opening brace on same line
  - Example: `constructor(bridge) {`
  - Example: `async *query(prompt, images, history, opts) {`

**Line Length:**
- No strict enforced limit observed
- Lines range from 40 to 100+ characters

## Import Organization

**C++ Includes:**
Order observed in source files:

1. Standard library: `<QApplication>`, `<QProcess>`, `<QDir>`, etc.
2. Qt framework: `<QMainWindow>`, `<QWebChannel>`, `<QWebEngineView>`
3. Local headers: `"mainwindow.h"`, `"claudebridge.h"`

Example from `claudebridge.cpp` (lines 1-8):
```cpp
#include "claudebridge.h"
#include <QDir>
#include <QFile>
#include <QFileDialog>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
```

**JavaScript Modules:**
- Inline in HTML (no module bundler)
- Load order critical: `qwebchannel.js` → `obsidian-shim.js` → `claudian/main.js` → bootstrap code
- Specified in `index.html` lines 261-265:
  ```html
  <script src="qrc:///qtwebchannel/qwebchannel.js"></script>
  <script src="qrc:///chat/obsidian-shim.js"></script>
  <script src="qrc:///claudian/main.js"></script>
  ```

**QRC Path Aliases:**
- `qrc:/chat/` — web UI files
- `qrc:///claudian/` — Claudian design system assets
- `qrc:///qtwebchannel/` — Qt WebChannel library

## Error Handling

**C++ Strategy:**
- Signals for error propagation (Qt pattern)
- No exceptions thrown; errors emitted as signals
- `errorOccurred(const QString &msg)` signal broadcasts errors

**Patterns:**

1. **JSON Parse Errors:** Silently skip invalid JSON
   - `claudeprocess.cpp` line 74-77:
   ```cpp
   QJsonParseError parseErr;
   const QJsonDocument doc = QJsonDocument::fromJson(line, &parseErr);
   if (parseErr.error != QJsonParseError::NoError || !doc.isObject()) return;
   ```

2. **File I/O Errors:** Check `open()` return value, skip on failure
   - `claudebridge.cpp` line 80-81:
   ```cpp
   QFile f(dir.filePath(filename));
   if (!f.open(QIODevice::ReadOnly | QIODevice::Text)) continue;
   ```

3. **Process Errors:** Emit `errorOccurred()` signal
   - `claudeprocess.cpp` line 106-109:
   ```cpp
   void ClaudeProcess::onProcessError(QProcess::ProcessError error) {
       if (error == QProcess::FailedToStart)
           emit errorOccurred("'claude' not found in PATH...");
   }
   ```

4. **Empty Input Validation:** Guard against empty/whitespace strings
   - `claudebridge.cpp` line 26:
   ```cpp
   if (text.trimmed().isEmpty()) return;
   ```

5. **State Redundancy Checks:** Return early if new value equals current
   - `claudebridge.cpp` line 30-31:
   ```cpp
   if (m_model == model) return;
   ```

**JavaScript Strategy:**
- Try-catch for JSON parsing; silently default on error
- `index.html` line 272-274:
  ```js
  let input = {};
  try { input = JSON.parse(json); } catch (_) {}
  ```

## Logging

**Framework:** `std::cout` for C++; `console` for JavaScript

**C++ Logging:**
- Not actively used in application code
- CLI subprocess (`claude --verbose`) provides diagnostic output captured via `QProcess::readAllStandardError()`

**JavaScript Logging:**
- Inline debugging with `console.log()` (not observed in current code; would be added if needed)

**Patterns:**
- Errors displayed in UI via `#qt-error` div
- `index.html` line 215-220:
  ```html
  #qt-error {
    color: #ff453a;
    padding: 16px;
    font-family: monospace;
    font-size: 12px;
    white-space: pre-wrap;
  }
  ```

## Comments

**When to Comment:**
- Comment non-obvious algorithm logic
- Explain Qt signal/slot mechanics
- Document intent for platform-specific code (e.g., macOS bundle layout)

**Patterns Observed:**

1. **Qt Signal Connections:** Explain why, not what
   - `claudebridge.cpp` line 15-22 (connects signals inline in constructor with lambda comments)

2. **Complex Logic:** Explain state transitions
   - `claudebridge.cpp` line 64-70 (comment explains Claude's path encoding scheme)

3. **Function Purpose:** Comment near declaration
   - `claudebridge.h` line 27-29 (comments explain session/folder dialogs)

4. **Algorithm Notes:** Inline explanations
   - `claudebridge.cpp` line 124-128 (explains turn grouping logic for JSONL parsing)

**JSDoc/TSDoc:**
- Not used in this codebase
- No formal documentation strings on functions

## Function Design

**Size:** Preference for short functions (40-100 lines typical)

**Parameters:**
- C++ uses const references for string/large objects
  - Example: `void send(const QString &prompt, const QString &cwd, ...)`
- JavaScript uses flexible parameter lists
  - Example: `async *query(prompt, images, history, opts)`

**Return Values:**
- C++ slots: `void` (Qt convention)
- C++ query methods: `QString` for ID, empty string if none
  - Example: `requestSessions()` returns nothing; emits signal
- JavaScript: Promises, async generators, or void
  - Example: `async *query()` yields chunks; `abort()` returns void

**Early Returns:**
- Used to guard against invalid inputs
- Example: `claudebridge.cpp` line 26, 30, 120 (return if conditions not met)

## Module Design

**Exports (JavaScript):**
- CommonJS `window.module.exports.default`
- `resources/claudian/main.js` exports ClaudianPlugin class
- Consumed by bootstrap code in `index.html` line 351:
  ```js
  const ClaudianPlugin = window.module?.exports?.default;
  ```

**Class Architecture (C++):**
- `main.cpp`: Qt app entry point
- `mainwindow.cpp`: Window setup, WebEngine initialization, QWebChannel registration
- `claudebridge.cpp`: Qt/JS bridge, property management, session persistence
- `claudeprocess.cpp`: Subprocess spawning, JSON streaming, signal emission

**Barrel Files:**
- Not used (no module bundler; direct includes)

**Qt Object Hierarchy:**
- `QApplication` (root)
  - `MainWindow` (inherits `QMainWindow`)
    - `QWebChannel` (owns communication)
    - `ClaudeBridge` (inherits `QObject`, registered as "claude")
      - `ClaudeProcess` (inherits `QObject`)

---

*Convention analysis: 2026-03-28*
