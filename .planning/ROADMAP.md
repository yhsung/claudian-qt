# Roadmap: ClaudianQt — Conversation Tracing

## Overview

This milestone adds always-on conversation logging to an existing Qt6/WebEngine app. The work is purely additive C++ — no UI changes, no new dependencies. Phase 1 unlocks metadata that is currently discarded. Phase 2 introduces the ConversationLogger class with the full JSONL output pipeline. Phase 3 adds the human-readable Markdown sidecar. Every phase builds on the one before it; none can be reordered.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Signal Extension** - Expose the full `result` message from ClaudeProcess so token counts, cost, and duration are available to the logger
- [ ] **Phase 2: Core Logger (JSONL)** - Introduce ConversationLogger with session lifecycle, turn state model, and JSONL output including all capture, metadata, and storage requirements
- [ ] **Phase 3: Markdown Sidecar** - Add the human-readable `.md` companion file driven from the same Turn struct established in Phase 2

## Phase Details

### Phase 1: Signal Extension
**Goal**: ClaudeProcess exposes complete `result` payload so all downstream metadata is accessible
**Depends on**: Nothing (first phase)
**Requirements**: SIG-01, SIG-02
**Success Criteria** (what must be TRUE):
  1. A breakpoint or log statement on `resultReceived` fires after every successful Claude turn
  2. The emitted QJsonObject contains `usage.input_tokens`, `usage.output_tokens`, `duration_ms`, and `total_cost_usd` fields
  3. Existing error handling behavior (is_error path) is unchanged — error turns still emit errorOccurred as before
**Plans**: TBD

### Phase 2: Core Logger (JSONL)
**Goal**: Every conversation is captured to a JSONL file with complete turn data, session metadata, and safe handling of aborted and crashed turns
**Depends on**: Phase 1
**Requirements**: CAP-01, CAP-02, CAP-03, CAP-04, META-01, META-02, META-03, META-04, FMT-01, FMT-03, FMT-04, STOR-01, STOR-02, STOR-03, STOR-04
**Success Criteria** (what must be TRUE):
  1. After a two-turn conversation, `~/.claudian/logs/` contains a `.jsonl` file with exactly two turn records, each containing prompt, response, timestamps, token counts, duration, cost, and stop reason
  2. The log file name includes the session ID fragment and a UTC timestamp (e.g. `2026-03-28T143012Z_abc123de.jsonl`)
  3. An aborted turn (via the Abort button) produces a record with `"status": "aborted"` rather than being silently dropped or corrupting the file
  4. Setting `CLAUDIAN_LOG_DIR=/tmp/test` causes new session files to appear in `/tmp/test/` rather than the default path
  5. Starting a new conversation in a different CWD opens a new log file rather than appending to the previous session's file
**Plans**: TBD

### Phase 3: Markdown Sidecar
**Goal**: Each session also produces a human-readable `.md` file alongside the `.jsonl`, driven from the same Turn struct with no format divergence
**Depends on**: Phase 2
**Requirements**: FMT-02
**Success Criteria** (what must be TRUE):
  1. After a two-turn conversation, a `.md` file exists next to the `.jsonl` file with the same session ID in its name
  2. The Markdown file contains the session header (session ID, model, CWD), each user prompt and assistant response as readable prose, and per-turn metadata (tokens, duration, cost)
  3. Editing the JSONL serialization path and the Markdown serialization path requires changing only one shared data structure (the Turn struct) — verified by code review
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Signal Extension | 0/? | Not started | - |
| 2. Core Logger (JSONL) | 0/? | Not started | - |
| 3. Markdown Sidecar | 0/? | Not started | - |
