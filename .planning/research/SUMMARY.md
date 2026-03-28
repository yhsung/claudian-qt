# Project Research Summary

**Project:** ClaudianQt — Conversation Tracing Milestone
**Domain:** Qt6 desktop app conversation logging / AI session tracing
**Researched:** 2026-03-28
**Confidence:** HIGH

## Executive Summary

ClaudianQt needs to add always-on conversation logging to an existing Qt6/WebEngine/QWebChannel app that wraps the Claude Code CLI. The approach is well-understood and requires no new dependencies: Qt6's built-in `QFile`, `QTextStream`, `QJsonDocument`, and `QStandardPaths` are sufficient to produce both JSONL (machine-consumable) and Markdown (human-readable) log files per session. All required data — user prompts, assistant responses, token counts, cost, duration — is already present in the stream-json output piped from the `claude` subprocess; the only gap is that the existing `ClaudeProcess::parseLine` discards the `result` message success path, which is where token/cost/duration metadata lives.

The recommended architecture introduces a single new class, `ConversationLogger`, owned by `ClaudeBridge`. It receives events via Qt signals, accumulates turn state in memory, and flushes one complete record to both file formats on each `result` message. This keeps all I/O in the C++ layer (consistent with the existing project constraint), invisible to the JavaScript UI, and requires only additive changes to `ClaudeProcess` (one new signal) and `ClaudeBridge` (wiring). No changes to `MainWindow`, `main.cpp`, or any JavaScript are needed.

The primary risk is data integrity at the boundaries: aborted turns, app-exit mid-turn, and the known Claude CLI bug where `result` is not always emitted. All three have concrete mitigations (abort flag, `aboutToQuit` sentinel record, `metadata_missing` fallback). These must be addressed in the initial architecture — retrofitting turn-assembly logic later is expensive. A secondary risk is schema drift when the Claude CLI npm package is updated; defensive `toInt(0)` defaults and storing the raw `result` JSON in early builds are the mitigations.

---

## Key Findings

### Recommended Stack

All required technology is already present in the project. Qt6::Core (already linked) provides every primitive needed: `QFile` for append-mode file handles, `QTextStream` for buffered UTF-8 writing, `QJsonDocument`/`QJsonObject` for JSONL serialization (already used in `claudeprocess.cpp`), `QStandardPaths` for cross-platform path resolution, and `QDir::mkpath` for directory bootstrapping. The only optional addition is `Qt6::Concurrent` (already installed via qtbase Homebrew formula) if async write dispatch is desired, but synchronous per-turn flushes are adequate for this use case and simpler to reason about.

**Core technologies:**
- `QFile` + `QTextStream`: append-mode file handles — already in project, correct open-once/flush-per-turn pattern
- `QJsonDocument::toJson(Compact)`: JSONL serialization — already used in codebase, no new API
- `QStandardPaths::HomeLocation` + manual path append: resolves `~/.claudian/logs/` — required because `AppDataLocation` maps to `~/Library/Application Support/` on macOS, not the user-visible path specified in project requirements
- `QDir::mkpath`: idempotent directory bootstrap — one call at logger construction, no-op if directory exists
- `QDateTime::currentDateTimeUtc()`: UTC timestamps — must use UTC form, not `currentDateTime()`, to avoid timezone ambiguity in JSONL

**What not to use:** `QSaveFile` (does not support Append mode), `Qt::endl` for turn-internal writes (forces flush on every write), `std::ofstream` (inconsistent resource management with Qt objects), any third-party logging library (zero-dep project; Qt built-ins are sufficient).

### Expected Features

The feature set is well-defined by PROJECT.md requirements and cross-validated against LLM observability platforms (Langfuse, Braintrust) and local AI tool logging precedents (AnythingLLM, Claude Code CLI's own session files).

**Must have (table stakes):**
- One file per session (JSONL + Markdown sidecar) — natural unit; maps to `--resume` session IDs
- User prompt capture — flows through `ClaudeBridge::sendMessage`, already available
- Assistant response capture (assembled, not streamed chunks) — accumulate across `textReady` signals, flush on `result`
- Timestamps (UTC ISO 8601) on every turn — both start-of-turn and end-of-turn
- Session ID in log — from `system/init`; required for dataset provenance
- Model name in log — already on `ClaudeBridge::m_model`
- Token counts per turn (`input_tokens`, `output_tokens`) — from `result` message
- Tool usage metadata — tool names + inputs; from `toolUseStarted` signal
- Working directory (CWD) in session header — already on `ClaudeBridge::m_cwd`
- Graceful aborted turn handling — write `"status": "aborted"` rather than drop or corrupt
- Configurable log storage path — default `~/.claudian/logs/`, env var or config override

**Should have (differentiators — all low complexity):**
- Response duration per turn — `QElapsedTimer` from prompt sent to `turnComplete`
- Total cost USD in session footer — `total_cost_usd` from `result` message
- Turn sequence numbers — simple counter; prevents timestamp collision ambiguity
- Session footer record — total turns, total tokens, duration, end reason; enables O(1) session stats
- Stop reason capture — `end_turn`, `max_tokens`, `tool_use`; distinguishes clean completions from truncations
- Filename includes timestamp + session ID fragment — e.g. `2026-03-28T143012Z_abc123de.jsonl`; chronological sort without parsing contents
- Error turn capture — API errors logged as error-type turns

**Defer (v2+):**
- Log viewer / browser UI — out of scope per PROJECT.md; use `jq`/`cat` in v1
- Cross-session full-text search — requires index; use `grep`/`jq` in v1
- Cloud sync / remote export — privacy risk; not needed for local-first use case
- SQLite storage — adds dependency and query layer; JSONL is simpler and more ML-portable
- Log compression — premature optimization; typical sessions are under 1 MB

### Architecture Approach

The logger is a new `ConversationLogger` QObject owned by `ClaudeBridge`, with `QFile` handles for two output files per session (`.jsonl` and `.md`). It subscribes to existing signals (`sessionInitialized`, `textReady`, `toolUseStarted`, `turnComplete`, `errorOccurred`) plus one new signal (`resultReceived` on `ClaudeProcess`) that exposes the full `result` JSON object. Turn state is accumulated in a `TurnState` struct in memory; a complete record is written to both file formats when `resultReceived` fires. The `result` message is the canonical commit gate — not `turnFinished` — because it carries the token/cost/duration metadata that makes each log record useful.

**Major components:**
1. `ConversationLogger` (new) — owns both file handles, accumulates turn state, serializes JSONL and Markdown at turn boundaries
2. `ClaudeProcess` (modified, additive) — parse full `result` message and emit `resultReceived(QJsonObject)` signal; existing behavior unchanged
3. `ClaudeBridge` (modified, additive) — instantiate and own `ConversationLogger`; wire signals; call `m_logger->onUserMessage()` directly in `sendMessage()`

Files opened per session (not at app start): `~/.claudian/logs/YYYY-MM-DD_<sessionId[0..7]>.jsonl` and `.md`. Directory created via `QDir::mkpath` at `ConversationLogger` construction.

### Critical Pitfalls

1. **Abort treated as clean turn boundary** — `turnFinished` fires after `abort()` but `result` never arrives. Gate all log writes on `resultReceived`, not `turnFinished`. Track `bool m_resultReceived`; write an `"aborted"` sentinel if `turnFinished` fires without a preceding `resultReceived`.

2. **`result` message success path is currently discarded** — `ClaudeProcess::parseLine` only reads `is_error` from `result` and ignores everything else. Without fixing this first, token counts and cost are permanently unavailable. This is the single highest-priority code change — everything else depends on it.

3. **Corrupt partial record on app exit / crash** — in-progress turn is in memory with no `result`. Fix: `QApplication::aboutToQuit` handler writes `{"type": "incomplete_turn", "reason": "app_exit"}` sentinel and calls `flush()`. Also: write each complete JSONL record with an explicit `QFile::flush()` call immediately after, so only the in-progress turn is at risk.

4. **Dual format divergence** — JSONL and Markdown written from separate code paths drift over time. Fix: drive both from one `ConversationLogger` class with a single internal `Turn` struct. Both formats are serialized from the same data at the same commit point.

5. **File not re-keyed on `cwd` change** — `setCwd()` starts a new Claude session. If the logger opened a file at app start instead of on `sessionInitialized`, two logical sessions mix in one file. Fix: open new log files only after `sessionInitialized` fires; subscribe to `cwdChanged` to flush and close any in-progress session.

---

## Implications for Roadmap

Based on research, the implementation has a clear dependency order that dictates phase structure.

### Phase 1: C++ Signal Extension
**Rationale:** All metadata capture depends on `resultReceived`. Without it, token counts, cost, and duration are permanently inaccessible regardless of logger design. This is a 10-line additive change to `ClaudeProcess::parseLine` and is the prerequisite for everything else.
**Delivers:** `resultReceived(QJsonObject)` signal on `ClaudeProcess` carrying full `result` payload
**Addresses:** Table-stakes token counts, cost, duration (all currently zero)
**Avoids:** Pitfall 2 (discarded result success path) — must be fixed before any logger code is written

### Phase 2: Core ConversationLogger (JSONL)
**Rationale:** JSONL is the canonical format; Markdown is derived from the same data. Establish the single logger class, turn state model, session lifecycle (open on `sessionInitialized`, close on `cwdChanged`), and abort/crash safety before adding any second format.
**Delivers:** `ConversationLogger` class writing `.jsonl` files per session to `~/.claudian/logs/`; session header, turn records, error records, aborted-turn sentinels
**Addresses:** All table-stakes features; session/turn lifecycle
**Avoids:** Pitfall 1 (abort boundary), Pitfall 3 (crash corruption), Pitfall 6 (silent directory failure), Pitfall 7 (cwd change), Pitfall 8 (tool-only turns dropped), Pitfall 10 (timestamp timezone)

### Phase 3: Markdown Sidecar Writer
**Rationale:** Markdown derives from the same `Turn` struct already populated in Phase 2. Adding it is low-risk because the data model is fixed; it is a second serialization path, not a new data flow.
**Delivers:** `.md` sidecar file per session with human-readable conversation rendering including tool-use blocks and per-turn metadata header
**Addresses:** Differentiator features (human-readable review, git-diffable logs)
**Avoids:** Pitfall 4 (dual format divergence) — both formats driven from same Turn struct in same class

### Phase 4: Differentiators and Polish
**Rationale:** Once the core logger is stable, low-complexity differentiators can be added incrementally with minimal risk to the existing turn model.
**Delivers:** Session footer record, response duration per turn, stop reason, configurable log base path exposed as `Q_PROPERTY`, defensive raw `result` JSON storage for schema drift resilience
**Addresses:** Should-have features; Pitfall 5 (schema drift)
**Avoids:** Scope creep into v2 features (log viewer, search)

### Phase Ordering Rationale

- Phase 1 before Phase 2: `ConversationLogger` needs `resultReceived` to exist before wiring. Writing the logger first and patching signals later is backwards and risks an incomplete signal graph.
- Phase 2 before Phase 3: Markdown format shares the Turn struct defined in Phase 2. The single-logger constraint (Pitfall 4 mitigation) means both formats must be in the same class, and that class's data model must be stable before adding a second serialization path.
- Phase 4 after Phase 3: Differentiators are additive fields on an established Turn struct. Adding them before the struct is stable causes churn.
- No JavaScript changes in any phase: the logger is invisible to the UI layer by design.

### Research Flags

Phases with standard patterns — no further research needed:
- **Phase 1:** Qt signal extension is a well-documented, standard Qt pattern; official Qt6 docs are authoritative
- **Phase 2:** `QFile`/`QTextStream` append-mode logging is a standard Qt idiom; pattern is fully documented
- **Phase 3:** Markdown rendering is trivial string concatenation; no research needed
- **Phase 4:** `Q_PROPERTY` exposure is standard Qt; configurable path is a single string member

Phases that warrant implementation-time caution (not pre-research, but careful verification):
- **Phase 2:** The `result` message schema from Claude CLI should be verified against the live CLI at implementation time — stream-json is not a versioned public API (Pitfall 5). Store raw `result` JSON in early builds as a hedge.
- **Phase 2:** The Claude CLI bug where `result` is never emitted (GitHub issues #25629, #1920) should be reproduced locally and confirmed before shipping the logger, so the `metadata_missing` fallback is tested against a real case.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All technologies are Qt6 built-ins already in the project; official Qt6 docs are definitive; no new dependencies |
| Features | HIGH | Table stakes verified against multiple LLM observability platforms and Claude Code CLI docs; ML format compatibility cross-checked against OpenAI and ShareGPT specs |
| Architecture | HIGH | Based on direct codebase inspection of `claudeprocess.cpp` and `claudebridge.cpp`; stream-json schema verified against official Claude Code headless docs |
| Pitfalls | HIGH | Critical pitfalls 1-4 verified against actual codebase behavior; pitfalls 2 and 3 backed by active Claude Code GitHub issues with concrete reproduction cases |

**Overall confidence:** HIGH

### Gaps to Address

- **`result` schema stability:** The stream-json `result` message schema is not a versioned public API. Fields confirmed at research time (`usage.input_tokens`, `usage.output_tokens`, `total_cost_usd`, `duration_ms`) should be treated as implementation-time assumptions, not guarantees. Mitigation: store the raw `result` JSON verbatim in early builds so any schema changes can be re-parsed post-hoc.

- **CLI bug reproducibility:** GitHub issues #25629 and #1920 document cases where the `result` message is never emitted. The exact trigger conditions are not fully characterized. The `metadata_missing` fallback in Phase 2 should be verified against the actual installed CLI version before shipping.

- **Tool result signals:** FEATURES.md notes that tool result/error signals should be verified for coverage in `ClaudeProcess`. The existing `toolUseStarted` signal is confirmed, but whether tool results (success/failure) are separately signaled is not verified. If tool results are not separately emitted, tool-use logging will record tool name and input but not outcome. This is acceptable for v1 but should be confirmed during Phase 2 implementation.

---

## Sources

### Primary (HIGH confidence)
- Qt6 QFile Class — Qt 6.11.0: https://doc.qt.io/qt-6/qfile.html
- Qt6 QTextStream Class — Qt 6.11.0: https://doc.qt.io/qt-6/qtextstream.html
- Qt6 QJsonDocument Class — Qt 6.11.0: https://doc.qt.io/qt-6/qjsondocument.html
- Qt6 QStandardPaths Class — Qt 6.10.2: https://doc.qt.io/qt-6/qstandardpaths.html
- Qt6 QSaveFile Class (Append unsupported): https://doc.qt.io/qt-6/qsavefile.html
- Claude Code headless/programmatic docs: https://code.claude.com/docs/en/headless
- Codebase direct inspection: `src/claudeprocess.cpp`, `src/claudebridge.cpp`, `src/claudebridge.h`, `src/claudeprocess.h`

### Secondary (MEDIUM confidence)
- Claude Code stream-json cheatsheet: https://takopi.dev/reference/runners/claude/stream-json-cheatsheet/
- Claude Code cost tracking docs: https://platform.claude.com/docs/en/agent-sdk/cost-tracking
- Langfuse tracing data model: https://langfuse.com/docs/tracing-data-model
- OpenAI fine-tuning data format: https://help.openai.com/en/articles/6811186
- AnythingLLM chat logs docs: https://docs.anythingllm.com/features/chat-logs

### Tertiary (issue tracker — specific bug behavior)
- Claude Code GitHub issue #25629 — `result` message not emitted in some tool executions
- Claude Code GitHub issue #1920 — missing final result event with SDK
- Claude Code GitHub issue #32160 — corrupt JSONL session file causes crash loop
- Qt Forum: QFile not writing on macOS (silent permission failure): https://forum.qt.io/topic/70886

---
*Research completed: 2026-03-28*
*Ready for roadmap: yes*
