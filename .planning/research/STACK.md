# Technology Stack: Conversation Tracing

**Project:** ClaudianQt — Conversation Tracing Milestone
**Researched:** 2026-03-28
**Scope:** Stack additions only — existing Qt6/WebEngine/QWebChannel stack is unchanged

---

## Recommended Stack

### Core I/O: QFile + QTextStream (Qt6 built-in)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `QFile` | Qt 6.11.0 (already in project) | File handle for JSONL and Markdown log files | Already a project dependency; `QIODevice::Append` flag gives append-only writes without full-file rewrites |
| `QTextStream` | Qt 6.11.0 (already in project) | Buffered UTF-8 text writer | Maintains an internal buffer; avoids a syscall per line when using `\n` (not `Qt::endl`); auto-flushes on destruction |

**Key pattern:** Open once at session start with `QIODevice::WriteOnly | QIODevice::Append | QIODevice::Text`, write lines across the session lifetime, let the destructor flush. This is the standard append-only log pattern for Qt desktop apps.

**Performance note:** Use `\n` not `Qt::endl` — `Qt::endl` and `std::endl` both force a flush on every write, which turns buffered I/O into unbuffered I/O. For a low-volume conversation log this is not catastrophic, but it is unnecessary overhead with no correctness benefit.

**Confidence: HIGH** — Qt6 official documentation confirms behavior; pattern verified across multiple Qt Forum discussions.

---

### JSON Serialization: QJsonDocument + QJsonObject (Qt6 built-in)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `QJsonDocument` | Qt 6.11.0 (already in project) | Serialize each log record to a compact JSON line | Already used in `claudeprocess.cpp` for stream-json parsing; `toJson(QJsonDocument::Compact)` produces a single-line output suitable for JSONL |
| `QJsonObject` | Qt 6.11.0 (already in project) | Build structured log records | Consistent with existing codebase patterns |

**JSONL format:** One `QJsonDocument::Compact` line per record, terminated with `\n`. No third-party library needed — `QJsonDocument::toJson(QJsonDocument::Compact)` produces exactly this.

**What not to use:** `QJsonDocument::Indented` — produces multi-line output that breaks JSONL parsers. Always use `Compact` for JSONL.

**Confidence: HIGH** — Qt6 official documentation confirms `toJson(QJsonDocument::Compact)` produces single-line output; project already uses this exact call in `claudeprocess.cpp:95`.

---

### File Storage Path: QStandardPaths (Qt6 built-in)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `QStandardPaths` | Qt 6.11.0 (already in project) | Resolve `~/.claudian/logs/` at runtime | Cross-platform safe; avoids hardcoding `~/`; correct on macOS 12+ |

**Recommended path strategy:**

```cpp
// Default: ~/.claudian/logs/
// QStandardPaths::HomeLocation resolves to ~ on all platforms.
// Append .claudian/logs to match PROJECT.md's stated default.
QString defaultLogDir = QDir(QStandardPaths::writableLocation(
    QStandardPaths::HomeLocation)).filePath(".claudian/logs");
```

**Why not `AppDataLocation`?** On macOS, `AppDataLocation` resolves to `~/Library/Application Support/ClaudianQt/`, which is not the user-visible `~/.claudian/logs/` path specified in the project requirements. The project explicitly wants `~/.claudian/logs/` as the default, so `HomeLocation` + manual path append is the right approach.

**Why not `CacheLocation`?** Cache directories can be cleared by the OS or user tools (e.g., `brew cleanup`, disk space utilities). Conversation logs should persist.

**Confidence: HIGH** — Qt6 official documentation shows macOS path resolution; `HomeLocation` = `~` is consistent across all Qt6 documentation.

---

### Async Write Dispatch: QtConcurrent with single-thread QThreadPool (Qt6 built-in)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `QtConcurrent::run` | Qt 6.11.0 (already available via Qt6::Core) | Offload file writes to a background thread | Keeps file I/O off the main thread; prevents any disk latency from affecting UI or streaming response latency |
| `QThreadPool` (dedicated, maxThreadCount=1) | Qt 6.11.0 | Serialize write operations | A single-thread pool ensures log records are written in-order; eliminates the need for mutexes in the write path |

**Pattern:**

```cpp
// In ConversationLogger constructor:
m_writePool.setMaxThreadCount(1);

// On each write:
QtConcurrent::run(&m_writePool, [this, record]{ writeRecordToFiles(record); });
```

**Why a dedicated pool and not the global pool?** The global QThreadPool is shared by all `QtConcurrent::run` calls in the app. A dedicated single-thread pool guarantees sequential writes without starving other concurrent work.

**Alternative considered — synchronous writes:** For typical conversation pacing (one turn per several seconds), synchronous `QTextStream` writes would have negligible UI impact. Synchronous is acceptable as a Phase 1 implementation and can be promoted to async if profiling shows issues. The async pattern is documented here as the production target.

**Confidence: HIGH** — Qt6 documentation and multiple community sources confirm this QtConcurrent + dedicated QThreadPool pattern for ordered async task execution.

---

### Directory Management: QDir (Qt6 built-in)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `QDir::mkpath` | Qt 6.11.0 (already in project) | Create `~/.claudian/logs/` on first run | One call creates the full path including intermediate directories; no-op if already exists |

**Confidence: HIGH** — Standard Qt idiom.

---

## No New Dependencies Required

All components needed for this milestone are already available in Qt6::Core, which is already a `target_link_libraries` entry in `CMakeLists.txt`. No new `find_package` calls, no new Homebrew formulae, no third-party libraries.

The only CMake change needed is adding `Qt6::Concurrent` if async writes are used:

```cmake
find_package(Qt6 REQUIRED COMPONENTS Core Gui Widgets WebEngineWidgets WebChannel Concurrent)
target_link_libraries(ClaudianQt PRIVATE Qt6::Concurrent)
```

`Qt6::Concurrent` ships with the `qtbase` Homebrew formula already installed at `/opt/homebrew/Cellar/qtbase/6.11.0/`. No additional installation needed.

---

## What NOT to Use

### Do not use QLoggingCategory / qInstallMessageHandler

**What it is:** Qt's built-in diagnostic logging system (qDebug, qWarning, qInfo).

**Why not:** It is designed for developer diagnostics, not structured conversation data. It has one global handler for the whole application, produces unstructured text by default, and requires significant overengineering to produce JSONL. It would intercept all Qt framework debug output, not just conversation events. Use it for developer logs only.

### Do not use QSaveFile

**What it is:** Qt's atomic write class that writes to a temp file then renames.

**Why not:** It explicitly does not support `Append` mode (documented as unsupported in Qt6 official docs). It is designed for full-file overwrites. An append-only log file requires `QFile` with `QIODevice::Append`.

### Do not use qtlogger (yamixst/qtlogger)

**What it is:** Third-party Qt logging library with async JSON sinks, rotating files, Sentry integration.

**Why not:** It is a "beta" status library. It is designed for routing `qDebug()`-style messages, not for writing custom structured records. Adding a third-party dependency for something fully achievable with Qt6 built-ins adds risk with no benefit. It would also require integrating a header-only or CMake subdirectory into a project that currently has zero third-party deps.

### Do not use std::ofstream / POSIX file APIs

**Why not:** Qt's `QFile` and `QTextStream` handle platform encoding, cross-platform path separators, and integrate naturally with Qt's object lifetime model. Mixing `std::ofstream` with Qt objects creates inconsistent resource management patterns.

---

## Data Available from Existing Stream-JSON

The following fields are available from the Claude CLI stream-json messages and require no new subprocess or API calls to capture:

| Datum | Source message type | Field path |
|-------|---------------------|------------|
| Session ID | `system/init` | `session_id` |
| User prompt text | captured in `ClaudeBridge::sendMessage` before subprocess start | direct parameter |
| Assistant text (streaming) | `assistant` | `message.content[].text` |
| Tool name + input | `assistant` | `message.content[].name`, `.input` |
| Token counts (input/output) | `result` | `usage.input_tokens`, `usage.output_tokens` |
| Total cost (USD) | `result` | `total_cost_usd` |
| Turn duration (ms) | `result` | `duration_ms` |
| API duration (ms) | `result` | `duration_api_ms` |
| Number of turns | `result` | `num_turns` |
| Error flag | `result` | `is_error` |
| Permission denials | `result` | `permission_denials` |

The `result` message type is currently only partially parsed in `claudeprocess.cpp` (only `is_error` is read). The logger will need to read the full `result` object. This is an additive change with no breaking impact on existing behavior.

---

## Implementation Location

Logging should be implemented as a new `ConversationLogger` class in `src/`:

- `src/conversationlogger.h` / `src/conversationlogger.cpp`
- Owned by `ClaudeBridge` (same pattern as `ClaudeProcess`)
- `ClaudeBridge` calls logger methods at the appropriate signal connection points
- `ClaudeProcess` needs to expose the full `result` object (not just `is_error`) — this requires a new signal or expanding the existing `turnFinished` signal

This keeps all file I/O in the C++ layer, consistent with the project constraint documented in PROJECT.md.

---

## Sources

- [Qt6 QFile Class — Qt 6.11.0](https://doc.qt.io/qt-6/qfile.html)
- [Qt6 QTextStream Class — Qt 6.11.0](https://doc.qt.io/qt-6/qtextstream.html)
- [Qt6 QTextStream flush behavior — runebook.dev](https://runebook.dev/en/docs/qt/qtextstream/flush)
- [Qt6 QJsonDocument Class — Qt 6.11.0](https://doc.qt.io/qt-6/qjsondocument.html)
- [Qt6 JSON Support overview — Qt 6.11.0](https://doc.qt.io/qt-6/json.html)
- [Qt6 QStandardPaths Class — Qt 6.10.2](https://doc.qt.io/qt-6/qstandardpaths.html)
- [Qt6 QSaveFile Class — Qt 6.10.1](https://doc.qt.io/qt-6/qsavefile.html) (confirms Append is unsupported)
- [Qt6 QtConcurrent — Qt 6.11.0](https://doc.qt.io/qt-6/qtconcurrent-index.html)
- [Qt6 QThreadPool — Qt 6.10.2](https://doc.qt.io/qt-6/qthreadpool.html)
- [Claude Code stream-json cheatsheet — takopi.dev](https://takopi.dev/reference/runners/claude/stream-json-cheatsheet/)
- [Claude Code headless/programmatic docs — code.claude.com](https://code.claude.com/docs/en/headless)
- [Claude Code cost tracking — platform.claude.com](https://platform.claude.com/docs/en/agent-sdk/cost-tracking)
- [qtlogger library — github.com/yamixst/qtlogger](https://github.com/yamixst/qtlogger) (reviewed, not recommended)
