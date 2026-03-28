# Domain Pitfalls: Conversation Tracing in a Qt6 AI CLI Wrapper

**Domain:** Desktop app conversation logging / tracing for streaming CLI output
**Project:** ClaudianQt — conversation tracing milestone
**Researched:** 2026-03-28
**Confidence:** HIGH (most pitfalls verified against actual codebase + official Claude Code bug tracker)

---

## Critical Pitfalls

Mistakes that cause data loss, corrupt logs, or require architectural rewrites.

---

### Pitfall 1: Treating `abort()` as a Clean Turn Boundary

**What goes wrong:** When the user aborts a turn, `ClaudeProcess::abort()` calls
`killCurrent()` then emits `turnFinished`. The logger sees a `turnFinished` signal
and assumes the turn is complete. But the `result` message from the CLI (which
carries `usage`, `duration_ms`, `total_cost_usd`) never arrives — the process was
killed before it could emit it.

**Why it happens:** The logger is written to treat every `turnFinished` as a
complete, loggable turn. Aborted turns are superficially identical to completed
turns at the signal level.

**Consequences:**
- Aborted turns written to the log look like complete turns with no metadata
  (no tokens, no cost, no duration). This silently corrupts training data —
  partial assistant responses are recorded as if they were final answers.
- If the logger flushes the assistant response incrementally (text chunks), it
  may write a half-response and mark it as complete.

**Warning signs:**
- Log entries with empty/zero `usage` fields but a non-empty `assistant_text`
- Log entries where `assistant_text` ends mid-sentence

**Prevention:**
- Track whether a `result` message was received before `turnFinished`. Add a
  `bool m_resultReceived` flag in the logger, set it `true` only when a
  `type == "result"` line is parsed, reset it at turn start.
- Write the turn to the log only in response to the `result` message, not to
  `turnFinished`. Use `turnFinished` only to finalize/flush the file.
- For aborted turns, write a log entry with `"status": "aborted"` and omit
  token/cost metadata fields, rather than omitting the entry entirely.

**Phase:** Must be addressed in the core logging architecture phase (Phase 1).
Retrofitting this later requires restructuring all turn-assembly logic.

---

### Pitfall 2: The `result` Message Is Not Always Emitted

**What goes wrong:** Claude Code CLI has a documented bug (active as of early
2026 per GitHub issue #25629 and #1920) where the `result` message is not sent
after successful completion when certain tool executions are involved. The process
remains running with stdout open and never exits cleanly.

Additionally, the existing `ClaudeProcess::parseLine` only acts on the `result`
message when `is_error == true`. A `result` with `is_error == false` is silently
discarded. The token usage (`usage` object), cost (`total_cost_usd`),
and duration (`duration_ms`) in every successful `result` message are therefore
never surfaced to the logger.

**Why it happens:** The current architecture was written for rendering only; it
had no reason to capture the success path of `result`. Logging requires the
success path.

**Consequences:**
- Token count, cost, and duration metadata are always zero/missing for successful
  turns — the primary metadata the project exists to capture.
- If the `result` message never arrives (CLI bug), the logger hangs waiting for it.

**Warning signs:**
- All log entries have `input_tokens: 0, output_tokens: 0`
- Log rotation / flush never triggers

**Prevention:**
- Extend `ClaudeProcess::parseLine` to emit a new signal (`resultReceived`) for
  ALL `result` messages (not just errors), carrying `usage`, `duration_ms`,
  `total_cost_usd`, `session_id`.
- The logger subscribes to `resultReceived` and uses it to finalize the turn
  record.
- Implement a fallback timeout: if `turnFinished` fires but `resultReceived` was
  not received within the same turn lifecycle, write the turn with a
  `"metadata_missing": true` flag rather than blocking or dropping the turn.

**Phase:** Phase 1 (C++ signal extension). This is a prerequisite for all
metadata capture.

---

### Pitfall 3: Incomplete Turns Written on App Exit / Crash

**What goes wrong:** If the user quits the app mid-turn (or the app crashes), the
in-progress turn has accumulated text chunks in memory but no `result` message.
The `QFile` handle may be open with unflushed data, or the JSONL file may have a
partial line at the end, making it unparseable.

**Why it happens:** Buffered file I/O (`QTextStream` in particular) does not
flush on process death. `Qt::endl` flushes per-write but is expensive; `"\n"`
without flush leaves data in the kernel buffer.

**Consequences:**
- The last session file in `~/.claudian/logs/` is corrupt — a downstream parser
  reading it will fail on the final line.
- Claude Code's own bug tracker (issue #32160) shows a concrete crash loop caused
  by this pattern: a corrupt JSONL causes a crash on open, which auto-resumes,
  causing another crash.

**Warning signs:**
- Session files ending without a closing `}` or newline
- Downstream ML pipeline failing on the most recent file but not older ones

**Prevention:**
- Write each JSONL line atomically: build the complete JSON object in memory,
  call `QFile::write(line + "\n")`, then call `QFile::flush()` immediately after.
  One flush per complete record is acceptable; one flush per chunk is not needed.
- Keep a `bool m_turnInProgress` flag. In the `QApplication::aboutToQuit` signal
  handler (or `MainWindow` destructor), if `m_turnInProgress`, write a sentinel
  record: `{"type": "incomplete_turn", "reason": "app_exit"}` and flush.
- For Markdown format, keep the Markdown file append-only with no open
  transactions; each assistant chunk can be appended immediately. An incomplete
  turn leaves a partial paragraph, which is human-readable.

**Phase:** Phase 1 (file I/O strategy). Must be decided before any file writes.

---

### Pitfall 4: Dual Format Divergence (JSONL vs Markdown Out of Sync)

**What goes wrong:** JSONL and Markdown are written from the same event stream
but follow different code paths. Over time, one path gets a bug fix or a new
field that the other does not. Consumers of the Markdown file see a different
conversation than consumers of the JSONL file.

**Why it happens:** Developers write the Markdown flush "quickly" from the
`textReady` signal and forget to propagate the same fix to JSONL, or vice versa.
There is no structural enforcement that both formats are co-driven.

**Consequences:**
- A tool-use turn might appear in JSONL (via `toolUseStarted`) but not in
  Markdown because the Markdown writer only hooks `textReady`.
- Token metadata appears in JSONL but not Markdown — acceptable, but undocumented.
- For training data use, the JSONL is canonical; Markdown divergence is
  confusing for reviewers.

**Warning signs:**
- Markdown files missing tool-use sections that are visible in JSONL
- Different turn counts between formats for the same session

**Prevention:**
- Drive both formats from a single `ConversationLogger` class with one internal
  representation. The class receives events, updates a `Turn` struct, then writes
  to both file handles at the same commit point. Never let two separate classes
  subscribe independently to the same signals.
- Define a clear contract: JSONL is machine-canonical (full fidelity); Markdown
  is human-readable (may omit raw tool input JSON). Document what each format
  omits rather than letting omissions happen by accident.

**Phase:** Phase 1 architecture. The single-logger pattern must be established
before any format-specific code is written.

---

## Moderate Pitfalls

---

### Pitfall 5: Schema Drift Between Claude CLI Versions

**What goes wrong:** The `stream-json` format used by the Claude Code CLI is not
a versioned public API — it changes with CLI updates. Fields confirmed in 2025
research include `usage.input_tokens`, `usage.output_tokens`,
`usage.cache_read_input_tokens`, and a separate `modelUsage` object with per-model
breakdowns. Field names like `modelUsage` (camelCase) vs `model_usage`
(snake_case) may vary between CLI versions.

**Why it happens:** ClaudianQt upgrades the global `claude` npm package
periodically. A minor CLI update can silently drop or rename a field the logger
depends on.

**Consequences:**
- Token metadata silently becomes zero without any error
- `modelUsage` object missing, so per-model cost breakdown is unavailable

**Warning signs:**
- `usage.input_tokens` always zero after a CLI upgrade
- `QJsonObject::value("usage")` returning `QJsonValue::Undefined`

**Prevention:**
- Always use defensive access: `obj["usage"]["input_tokens"].toInt(0)` — the
  `toInt(0)` default prevents silent null propagation.
- Log the raw `result` JSON line verbatim as a `"raw_result"` field in JSONL
  during early development. This allows post-hoc re-parsing if the schema changes.
- In a later phase, add a version check: read the `session_id` from `system/init`
  and note the CLI version if the `--version` flag is used.

**Phase:** Phase 1 for defensive access; Phase 2 for version tracking.

---

### Pitfall 6: Log Directory Creation Failure Is Silent

**What goes wrong:** The default log path is `~/.claudian/logs/`. On first run,
this directory does not exist. `QFile::open()` on a path whose parent directory
does not exist returns `false` and sets an error string — but if the logger does
not check the return value of `QDir::mkpath()` and `QFile::open()`, logging
silently drops all data with no user feedback.

**Why it happens:** `QFile` on macOS does not throw — all errors are returned via
status codes that must be explicitly checked. The Qt Forum documents cases of
`QFile::open()` returning `false` with "Unknown error" on macOS when the directory
was missing.

**Consequences:**
- The entire session is lost with no indication to the user
- The user discovers the gap hours later when reviewing logs for training data

**Warning signs:**
- `~/.claudian/logs/` directory never appears on disk
- No error shown in the UI but no log files created

**Prevention:**
- On `ConversationLogger` initialization: call `QDir().mkpath(logDir)`, check its
  return value, and if it fails emit an error signal that surfaces in the UI.
- After `QFile::open()`, check `f.isOpen()`. If not, log to `qWarning()` with
  `f.errorString()` and surface a non-fatal warning banner in the UI.
- Never assume the log directory exists. Recreate it at the start of every session.

**Phase:** Phase 1 (file setup).

---

### Pitfall 7: `cwd` Change Clears Session But Logger Does Not Start a New File

**What goes wrong:** `ClaudeBridge::setCwd()` clears `m_sessionId`, which means
the next `sendMessage` starts a new Claude session with a new session ID. If the
logger keys files on session ID (received from `sessionInitialized` signal), the
new session gets a new file correctly. But if the logger opened a file at app
start rather than per-session, it continues writing to the old file, mixing two
logical sessions.

**Why it happens:** "One file per session" can be misimplemented as "one file per
app launch" if the logger is initialized only in the constructor.

**Consequences:**
- Two working-directory sessions mixed in one log file, breaking downstream
  session-level analysis.

**Warning signs:**
- Log file contains entries with different `cwd` values
- Session ID changes mid-file in JSONL

**Prevention:**
- Key every log file on the session ID obtained from `sessionInitialized`. Open
  the file only after the session ID is known, not at app startup.
- Filename pattern: `{ISO8601_timestamp}_{session_id_prefix8}.jsonl` (and `.md`).
  The timestamp prevents collisions if session IDs are ever re-used; the prefix
  provides human-readable identity.
- Subscribe to `ClaudeBridge::cwdChanged` in the logger to flush and close any
  in-progress session file, so a `cwd` change mid-session is handled correctly.

**Phase:** Phase 1 (session lifecycle management).

---

### Pitfall 8: Tool-Use Turns Are Logged as "Nothing Happened"

**What goes wrong:** A turn where Claude exclusively uses tools (no assistant text
block) results in `textReady` never firing. A logger that accumulates assistant
text via `textReady` and only writes a record when text is non-empty will silently
drop tool-only turns. These turns are valuable for training data because they show
agentic behavior.

**Why it happens:** `ClaudeProcess::parseLine` emits `textReady` and
`toolUseStarted` separately. A logger focused on text will only see the text signal.

**Consequences:**
- Gaps in the conversation log where tool-only turns occurred
- Token counts are incorrect (the tool turn's `usage` is in the `result` message
  for that turn, which goes unlogged)

**Warning signs:**
- Log shows user message followed immediately by a later user message, with no
  assistant response in between
- `num_turns` in the `result` message is higher than the number of logged turns

**Prevention:**
- Log every turn that has a `result` message, regardless of whether `textReady`
  ever fired. Use the `resultReceived` signal (see Pitfall 2) as the commit gate.
- If `toolUseStarted` fired but `textReady` did not, still write the turn with
  `"assistant_text": ""` and a populated `"tools"` array.

**Phase:** Phase 1 (turn model definition).

---

## Minor Pitfalls

---

### Pitfall 9: `Qt::endl` vs `"\n"` Performance in Tight Logging Loops

**What goes wrong:** `QTextStream << Qt::endl` flushes the buffer on every write.
In a streaming response with many `textReady` signals per second, this degrades
performance and can cause perceptible UI lag.

**Prevention:** Use `"\n"` for intra-turn writes. Call `QFile::flush()` explicitly
only at turn boundaries (once per `result` message). Avoid `QTextStream` for
JSONL writes entirely; prefer `QFile::write(QByteArray)` directly for full control.

**Phase:** Phase 1 implementation detail.

---

### Pitfall 10: Timestamp Timezone Ambiguity

**What goes wrong:** `QDateTime::currentDateTime()` returns local time.
`QDateTime::currentDateTimeUtc()` returns UTC. JSONL written with local time
and later analyzed in a different timezone produces misleading duration
calculations.

**Prevention:** Always use `QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs)`
for all log timestamps. This produces e.g. `2026-03-28T14:30:00.123Z`, which is
unambiguous and sortable.

**Phase:** Phase 1. Fix at schema design time; retroactive correction is painful.

---

### Pitfall 11: Markdown File Left Open Between Turns

**What goes wrong:** Opening a `QFile` in `Append` mode for the full session
lifetime (rather than open/write/close per record) means a crash leaves the file
handle dirty. On macOS, an unclosed file may have unflushed kernel buffer data.

**Prevention:** For JSONL, open in `Append` mode and call `flush()` after each
record. For Markdown, the same pattern is acceptable since Markdown records are
also line-oriented. Do not keep the file open indefinitely without periodic
flushes — flush on every `result` message at minimum.

**Phase:** Phase 1 implementation detail.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|----------------|------------|
| C++ signal wiring | Missing `result` success path (Pitfall 2) | Extend `parseLine` to emit `resultReceived` for all result messages |
| Turn assembly logic | Aborted turns logged as complete (Pitfall 1) | Gate log writes on `resultReceived`, not `turnFinished` |
| File I/O setup | Silent directory creation failure (Pitfall 6) | Check all `QFile` return values, surface errors to UI |
| Session lifecycle | File not re-keyed on `cwd` change (Pitfall 7) | Open new log file on `sessionInitialized`, close on `cwdChanged` |
| Turn model definition | Tool-only turns silently dropped (Pitfall 8) | Use `resultReceived` as the canonical turn commit trigger |
| Dual format impl | Format divergence (Pitfall 4) | Single `ConversationLogger` driving both formats from one Turn struct |
| App exit handling | Corrupt partial record on crash (Pitfall 3) | `aboutToQuit` handler writes sentinel record and flushes |
| Metadata parsing | Schema drift after CLI update (Pitfall 5) | Defensive `toInt(0)` defaults; store raw `result` JSON in early phase |

---

## Sources

- Claude Code GitHub issue #25629: CLI hangs after result event in stream-json mode
  https://github.com/anthropics/claude-code/issues/25629
- Claude Code GitHub issue #1920: Missing final result event with SDK
  https://github.com/anthropics/claude-code/issues/1920
- Claude Code GitHub issue #32160: Corrupted JSONL session file causes crash loop
  https://github.com/anthropics/claude-code/issues/32160
- Claude Code GitHub issue #20992: Stack overflow from concurrent JSONL writes
  https://github.com/anthropics/claude-code/issues/20992
- Claude Code GitHub issue #26964: Cross-session JSONL contamination
  https://github.com/anthropics/claude-code/issues/26964
- Qt Forum: QTextStream performance and Qt::endl flush overhead
  https://forum.qt.io/topic/159287/qtextstream-performance
- Qt Docs: QFile Class (Qt 6.11) — error handling, open() return values
  https://doc.qt.io/qt-6/qfile.html
- Qt Forum: QFile not writing on OS X (silent permission failure)
  https://forum.qt.io/topic/70886/qfile-file-not-writing-on-os-x
- Qt Docs: QProcess::finished signal and exitStatus
  https://doc.qt.io/qt-6/qprocess.html
- Claude Code stream-json cheatsheet (takopi.dev)
  https://takopi.dev/reference/runners/claude/stream-json-cheatsheet/
- Claude Code headless/programmatic usage docs (official)
  https://code.claude.com/docs/en/headless
- Codebase review: src/claudeprocess.cpp, src/claudebridge.cpp (direct inspection)
