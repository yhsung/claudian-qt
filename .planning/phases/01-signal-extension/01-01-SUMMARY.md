---
phase: 01-signal-extension
plan: 01
subsystem: api
tags: [qt6, cpp, signals, qprocess, streaming-json]

# Dependency graph
requires: []
provides:
  - resultReceived(QJsonObject) signal on ClaudeProcess emitted after each successful Claude CLI turn
  - Full result payload (usage.input_tokens, usage.output_tokens, duration_ms, total_cost_usd, stop_reason) available to observers
affects:
  - 02-conversation-logger

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Emit raw QJsonObject from result branch — Phase 2 logger consumes it without re-parsing"
    - "Nested if/else in result branch — error path preserved, success path newly exposed"

key-files:
  created: []
  modified:
    - src/claudeprocess.h
    - src/claudeprocess.cpp

key-decisions:
  - "Emit raw QJsonObject (not a struct or subset) — gives Phase 2 access to all fields without schema coupling"
  - "Error path (is_error) unchanged — errorOccurred signal behavior preserved per D-02"

patterns-established:
  - "Signal carries full QJsonObject payload — logger decides which fields to extract"

requirements-completed:
  - SIG-01
  - SIG-02

# Metrics
duration: 5min
completed: 2026-03-28
---

# Phase 01 Plan 01: Signal Extension Summary

**ClaudeProcess now emits resultReceived(QJsonObject) after every successful Claude CLI turn, exposing token counts, cost, duration, and stop reason for Phase 2 logging**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-28T09:48:09Z
- **Completed:** 2026-03-28T09:49:29Z
- **Tasks:** 2 (1 auto + 1 human-verify auto-approved)
- **Files modified:** 2

## Accomplishments
- Added `#include <QJsonObject>` to `claudeprocess.h` so MOC generates correct marshalling code for the new signal parameter type
- Declared `void resultReceived(const QJsonObject &result)` in the `signals:` section of ClaudeProcess
- Expanded the `result` branch in `parseLine()` from a single-condition guard to a nested if/else: `is_error` path emits `errorOccurred` (unchanged), success path emits `resultReceived(obj)` with the full raw JSON object
- Build compiled with zero errors and zero warnings for the changed files

## Task Commits

Each task was committed atomically:

1. **Task 1: Add resultReceived signal and emit from parseLine** - `a23a9de` (feat)
2. **Task 2: Smoke test (auto-approved checkpoint)** - no separate commit

**Plan metadata:** (docs commit below)

## Files Created/Modified
- `src/claudeprocess.h` - Added `#include <QJsonObject>` and `void resultReceived(const QJsonObject &result)` signal declaration
- `src/claudeprocess.cpp` - Expanded `result` branch in `parseLine()` to emit `resultReceived(obj)` on non-error result

## Decisions Made
- Emit raw `QJsonObject` (the full parsed result message) rather than extracting individual fields — Phase 2 logger gets access to all metadata fields without requiring this layer to know the schema in advance
- No new member variables added — signal is fire-and-forget, no state retained

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - build succeeded on first attempt with zero errors.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `resultReceived(QJsonObject)` signal is wired and emitting; Phase 2 (ConversationLogger) can connect to it immediately
- Reminder from STATE.md blockers: verify `result` message schema against live CLI version before shipping Phase 2 (schema is not a versioned public API)
- Reminder: reproduce Claude CLI bug (issues #25629, #1920) where `result` is never emitted; confirm Phase 2 `metadata_missing` fallback handles it
- ClaudeBridge does not yet connect to `resultReceived` — that is Phase 2 work

---
*Phase: 01-signal-extension*
*Completed: 2026-03-28*
