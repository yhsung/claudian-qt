# Phase 1: Signal Extension - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-28
**Phase:** 01-signal-extension
**Mode:** --auto (all decisions auto-selected)
**Areas discussed:** Signal Payload Shape, Error-Turn Behavior

---

## Signal Payload Shape

| Option | Description | Selected |
|--------|-------------|----------|
| Raw object | Emit the complete `result` QJsonObject as-is from parseLine() | ✓ |
| Normalized subset | Pre-extract specific fields into a new QJsonObject | |

**User's choice:** [auto] Raw object (recommended default)
**Notes:** Phase 2 will extract whatever fields it needs; Phase 1 should not be lossy.

---

## Error-Turn Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Success only | `resultReceived` fires only when `is_error == false` | ✓ |
| Both paths | `resultReceived` fires for both success and error turns | |

**User's choice:** [auto] Success only (recommended default)
**Notes:** Phase 1 success criteria explicitly requires the error path to be unchanged. Phase 2 can connect to `errorOccurred` for error-turn logging if needed.

---

## Claude's Discretion

- Emit location in `parseLine()` (consistent with all other signals)
- Signal name `resultReceived(QJsonObject)` (specified in REQUIREMENTS.md SIG-02)

## Deferred Ideas

None.
