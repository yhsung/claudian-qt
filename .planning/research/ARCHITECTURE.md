# Architecture Patterns: Conversation Tracing

**Domain:** Qt6 desktop app conversation logging
**Researched:** 2026-03-28
**Confidence:** HIGH (based on direct source reading + verified stream-json schema)

---

## Existing Architecture (Brownfield Context)

Before prescribing additions, the current data flow must be understood precisely.

```
User input (JS)
    │  bridge.sendMessage(text)
    ▼
ClaudeBridge::sendMessage()
    │  m_claude->send(prompt, cwd, sessionId, model, yolo)
    ▼
ClaudeProcess::send()
    │  QProcess starts: claude --output-format stream-json --verbose --print <prompt>
    ▼
subprocess stdout (newline-delimited JSON stream)
    │  parsed line-by-line in ClaudeProcess::parseLine()
    │
    ├─ type=="system", subtype=="init"   → emit sessionInitialized(session_id)
    ├─ type=="assistant", content[text]  → emit textReady(text)
    ├─ type=="assistant", content[tool]  → emit toolUseStarted(name, inputJson)
    ├─ type=="result", is_error==true    → emit errorOccurred(result)
    └─ QProcess::finished               → emit turnFinished()
    │
    ▼
ClaudeBridge (signal forwarding)
    │  sessionInitialized → stores m_sessionId, emits sessionReady
    │  textReady         → forwarded as textReady
    │  toolUseStarted    → forwarded as toolUse
    │  turnFinished      → forwarded as turnComplete
    │  errorOccurred     → forwarded as errorOccurred
    ▼
QWebChannel → JavaScript (chat UI)
```

### What Stream-JSON `result` Contains (Verified)

The final message from each subprocess run (type=="result") carries:

| Field | Type | Relevance to Logging |
|---|---|---|
| `type` | `"result"` | Message type discriminator |
| `subtype` | `"success"` / `"error"` | Success vs error path |
| `is_error` | bool | Error flag |
| `session_id` | string | Session identifier |
| `result` | string | Final response text (full, not streamed) |
| `usage.input_tokens` | number | Token count for input |
| `usage.output_tokens` | number | Token count for output |
| `usage.service_tier` | string | API tier used |
| `total_cost_usd` | number | Cost for this turn |
| `duration_ms` | number | Total wall time |
| `duration_api_ms` | number | API-only time |
| `num_turns` | number | Number of agent loop turns |
| `permission_denials` | array | Tools blocked (tool_name, tool_use_id) |

**Critically:** The `result` message is the only source of token counts, cost, and duration. It arrives after all streaming text. The current `parseLine()` in `ClaudeProcess` ignores it entirely — it only handles the `is_error` field and discards everything else. This is the primary gap to close.

---

## Recommended Architecture

Conversation tracing belongs entirely in the C++ layer. The JavaScript side has no role in logging — it only renders what it receives via signals. C++ has full access to all stream-json data, owns the file system, and is more reliable for I/O.

### New Component: `ConversationLogger`

A dedicated `QObject` subclass responsible for all file I/O. It is owned by `ClaudeBridge`, receives events from `ClaudeBridge`'s existing signals (and one new one), and writes to two files per session.

```
ConversationLogger
    ├── m_jsonlFile   : QFile  (session.jsonl — machine-readable)
    ├── m_mdFile      : QFile  (session.md — human-readable)
    ├── m_sessionMeta : struct { sessionId, model, cwd, startedAt }
    └── m_turnState   : struct { startedAt, accumText, tools[] }
```

### Full Component Map (Post-Implementation)

```
ClaudeProcess
    │  (unchanged signals)
    │  + emit resultReceived(QJsonObject resultObj)   ← NEW signal
    ▼
ClaudeBridge
    │  owns ConversationLogger
    │  wires signals → ConversationLogger slots
    │
    ├── sendMessage() → logger.onUserMessage(text, timestamp)
    ├── sessionInitialized → logger.onSessionStarted(id, model, cwd)
    ├── textReady    → logger.onTextChunk(text)
    ├── toolUse      → logger.onToolUse(name, inputJson)
    ├── resultReceived → logger.onTurnResult(resultObj)   ← NEW
    └── turnComplete → logger.onTurnComplete()
    ▼
ConversationLogger
    ├── writes to ~/.claudian/logs/<date>-<sessionId>.jsonl
    └── writes to ~/.claudian/logs/<date>-<sessionId>.md
```

### Why `ClaudeBridge` Owns the Logger (Not `ClaudeProcess`)

`ClaudeBridge` holds `m_cwd`, `m_model`, and `m_sessionId` — all required for session metadata. `ClaudeProcess` only knows about the current subprocess. Placing the logger in `ClaudeBridge` avoids passing extra context down and keeps `ClaudeProcess` single-purpose.

---

## Data Flow: Per Turn

### Turn Start (User Sends)

```
ClaudeBridge::sendMessage(text)
    │
    ├── m_claude->send(...)        (existing)
    └── m_logger->onUserMessage(text, QDateTime::currentDateTime())
            │
            └── writes JSONL line:
                { "event": "user_message", "timestamp": "...", "text": "..." }
                writes Markdown:
                ## User [timestamp]
                <text>
```

### Streaming Response

```
ClaudeProcess emits textReady(chunk) → ClaudeBridge → ConversationLogger::onTextChunk(chunk)
    │
    └── accumulates into m_turnState.accumText (NOT written yet)
        (writing every chunk would cause excessive small writes)

ClaudeProcess emits toolUseStarted(name, json) → ClaudeBridge → ConversationLogger::onToolUse(name, json)
    │
    └── appends to m_turnState.tools[]
```

### Turn End (result message arrives)

```
ClaudeProcess::parseLine() handles type=="result"
    │
    ├── (existing) if is_error → emit errorOccurred(result)
    └── (new)      emit resultReceived(QJsonObject resultObj)    ← parse full result object

ClaudeBridge receives resultReceived → ConversationLogger::onTurnResult(resultObj)
    │
    └── flushes accumulated turn to disk:
        JSONL line: {
          "event": "assistant_turn",
          "timestamp": "...",
          "text": "<accumText>",
          "tools": [...],
          "token_input": usage.input_tokens,
          "token_output": usage.output_tokens,
          "cost_usd": total_cost_usd,
          "duration_ms": duration_ms,
          "session_id": session_id
        }
        Markdown section:
        ## Assistant [timestamp] (Ntok in, Mtok out, $X.XXXX)
        <accumText>
        [Tool used: <name>]
```

### Session Lifecycle

```
Session starts:
  ConversationLogger::onSessionStarted(id, model, cwd)
    └── opens two files in ~/.claudian/logs/
        filename: YYYY-MM-DD_<sessionId_prefix8>.jsonl / .md
        writes JSONL header line:
        { "event": "session_start", "session_id": "...", "model": "...", "cwd": "...", "timestamp": "..." }
        writes Markdown header:
        # Session <sessionId> [timestamp]
        **Model:** <model>
        **CWD:** <cwd>

Session ends (app closes or cwd changes):
  ConversationLogger::flush()
    └── QFile::flush() — ensures buffers written
        (no explicit "session_end" entry required; last turn is sufficient)
```

---

## File I/O Strategy

### Write Mode: Buffered Append, Flush Per Turn

**Rationale:** One flush per completed turn (not per streamed chunk) keeps I/O overhead negligible. QFile with `Append` mode is safe for sequential writes. Flushing after each turn ensures data is durable after the turn completes — losing the last in-progress turn on crash is acceptable for this use case.

```cpp
// Open once at session start
m_jsonlFile.open(QIODevice::Append | QIODevice::Text);
m_mdFile.open(QIODevice::Append | QIODevice::Text);

// Write at turn end
QTextStream(&m_jsonlFile) << jsonLine << "\n";
QTextStream(&m_mdFile) << mdBlock << "\n\n";
m_jsonlFile.flush();
m_mdFile.flush();
```

**Do not use `QSaveFile`:** It writes to a temp file then renames atomically. This is correct for single-write files (config saves) but wrong for growing append logs — it would copy the entire log on each turn.

**Do not use `QtConcurrent` for writes:** Turn-end flushes are fast (small writes, kernel-buffered). Adding thread complexity for non-blocking behaviour is premature optimisation. If profiling ever reveals a problem, a dedicated logger thread can be added later.

### File Naming

```
~/.claudian/logs/YYYY-MM-DD_<sessionId[0..7]>.jsonl
~/.claudian/logs/YYYY-MM-DD_<sessionId[0..7]>.md
```

Using the date prefix enables chronological directory listing. The first 8 characters of the session UUID provide enough uniqueness to avoid collisions within a day.

### Directory Bootstrap

Create `~/.claudian/logs/` at `ConversationLogger` construction time using `QDir::mkpath()`. This is idempotent and requires no separate installation step.

---

## Changes to Existing Code

### `ClaudeProcess` — Minimal Surgery

One change only: parse the `result` message fully and emit a new signal.

```cpp
// In claudeprocess.h — add signal:
void resultReceived(const QJsonObject &resultObj);

// In claudeprocess.cpp parseLine() — extend existing result handler:
} else if (type == "result") {
    if (obj["is_error"].toBool())
        emit errorOccurred(obj["result"].toString());
    emit resultReceived(obj);   // always emit, logger reads usage/cost
}
```

This is additive. The existing `errorOccurred` path is preserved unchanged.

### `ClaudeBridge` — Wire Logger

```cpp
// In claudebridge.h:
#include "conversationlogger.h"
// member:
ConversationLogger *m_logger;

// In claudebridge.cpp constructor:
m_logger = new ConversationLogger(this);
connect(m_claude, &ClaudeProcess::resultReceived,
        m_logger,  &ConversationLogger::onTurnResult);
connect(m_claude, &ClaudeProcess::sessionInitialized,
        m_logger,  &ConversationLogger::onSessionStarted);
// etc.
```

`sendMessage()` calls `m_logger->onUserMessage()` directly (synchronous, before subprocess starts).

### No Changes to `MainWindow`, `main.cpp`, or JavaScript

The logger is invisible to the UI layer. QWebChannel does not expose it. JS receives the same signals as before.

---

## JSONL Schema (per line)

Each line is a complete JSON object. Four event types:

```json
{ "event": "session_start",   "timestamp": "ISO8601", "session_id": "...", "model": "...", "cwd": "..." }
{ "event": "user_message",    "timestamp": "ISO8601", "text": "..." }
{ "event": "assistant_turn",  "timestamp": "ISO8601", "text": "...",
  "tools": [{"name":"...", "input":"..."}],
  "token_input": 1234, "token_output": 567,
  "cost_usd": 0.0023, "duration_ms": 4210 }
{ "event": "error",           "timestamp": "ISO8601", "message": "..." }
```

The `session_id` is only in `session_start` — downstream consumers join on file name, not per-line repetition.

---

## Markdown Schema (per session file)

```markdown
# Session abc12345 — 2026-03-28 14:23:07

**Model:** claude-opus-4-5
**CWD:** /Users/yhsung/dev-projects/claudian-qt

---

## User — 14:23:07

How does the QWebChannel work?

## Assistant — 14:23:11 (1,204 in / 387 out / $0.0019 / 4.2s)

QWebChannel exposes C++ QObject instances to JavaScript...

**Tool:** read_file — `{"path": "src/mainwindow.cpp"}`

---
```

---

## Suggested Build Order

Dependencies between components determine phase order.

| Step | Work | Depends On |
|---|---|---|
| 1 | Parse `result` message in `ClaudeProcess`, emit `resultReceived` | Nothing (additive) |
| 2 | Implement `ConversationLogger` class (JSONL writes only) | Step 1 |
| 3 | Wire `ConversationLogger` into `ClaudeBridge` | Step 2 |
| 4 | Add Markdown writer to `ConversationLogger` | Step 3 (uses same turn data) |
| 5 | Expose log directory path as `Q_PROPERTY` on `ClaudeBridge` for future UI | Step 3 |

Step 1 is the highest-leverage change — without it, token counts and cost are not available regardless of how the logger is designed. Steps 2-3 are the core implementation. Step 4 is parallel work that can happen concurrently with Step 3 or immediately after. Step 5 is optional infrastructure for a future log viewer and costs near-zero at this stage.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Logging in JavaScript

**What:** Capturing text in the JS chat UI and posting it back to C++ or writing via a JS file API.
**Why bad:** JS receives fragmented streamed chunks (not complete turns), has no access to the `result` message (token counts, cost), and browser-side file I/O is sandboxed in WebEngine.
**Instead:** Log in `ClaudeBridge` / `ConversationLogger` where complete data is available.

### Anti-Pattern 2: Flushing on Every Text Chunk

**What:** Calling `flush()` inside `onTextChunk()` for each streamed token.
**Why bad:** A typical assistant response is 200-2000 chunks. 2000 `flush()` calls per turn adds I/O syscall overhead and can cause observable latency on slower disks.
**Instead:** Accumulate chunks in memory, flush once when `resultReceived` fires.

### Anti-Pattern 3: New File Per Tool Call or Text Block

**What:** Opening a new file (or new log entry) for each assistant content block.
**Why bad:** A single assistant turn may contain multiple text blocks interleaved with tool calls. Splitting them produces incomplete, misleading records.
**Instead:** Buffer the entire turn, write one consolidated record when `turnFinished` fires.

### Anti-Pattern 4: Storing Full JSON in Both Files

**What:** Writing the raw stream-json lines verbatim into the JSONL log.
**Why bad:** Raw stream-json includes partial blocks, thinking blocks, and intermediate tool results that are noise for the stated use case (training data, usage analysis).
**Instead:** Parse and re-emit only the meaningful events as defined in the schema above.

### Anti-Pattern 5: Ignoring `cwd` Changes Mid-Session

**What:** Keeping the same log file open when the user changes the working directory.
**Why bad:** `ClaudeBridge::setCwd()` clears `m_sessionId`, starting a new Claude session. Logging across a cwd change conflates two separate contexts.
**Instead:** `ConversationLogger::onSessionStarted()` closes any open files and opens new ones. The existing `sessionInitialized` signal fires on every new subprocess start, providing the hook.

---

## Scalability Considerations

| Concern | This Version | Future |
|---|---|---|
| Large single session | Append-mode; no memory accumulation | Add size-based log rotation in v2 |
| Many sessions over time | Files accumulate in `~/.claudian/logs/` | Log viewer / search in v2 |
| Multiple concurrent windows | Not a concern — app is single-window | Per-window logger isolation if multi-window added |
| Session restore & logging | `loadSession()` reads Claude's own JSONL, not Claudian logs | Keep separate — they serve different purposes |

---

## Sources

- Direct reading of `src/claudeprocess.cpp`, `src/claudebridge.cpp`, `src/claudebridge.h`, `src/claudeprocess.h` — HIGH confidence
- [Claude Code stream-json cheatsheet](https://takopi.dev/reference/runners/claude/stream-json-cheatsheet/) — result message schema — MEDIUM confidence
- [Run Claude Code programmatically](https://code.claude.com/docs/en/headless) — official Claude Code docs, stream-json format — HIGH confidence
- [QSaveFile Class Qt6](https://doc.qt.io/qt-6/qsavefile.html) — confirms atomic rename pattern, confirms it is wrong for append logs — HIGH confidence
- [QFile Class Qt6](https://doc.qt.io/qt-6/qfile.html) — append mode, buffered writes — HIGH confidence
