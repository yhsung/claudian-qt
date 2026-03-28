# Phase 1: Signal Extension - Context

**Gathered:** 2026-03-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Extend `ClaudeProcess` to parse the full `result` message from the Claude CLI subprocess and emit a new `resultReceived(QJsonObject)` signal carrying the complete payload — `usage.input_tokens`, `usage.output_tokens`, `duration_ms`, `total_cost_usd`, and `stop_reason`. This is a narrow C++ change to one class; no UI changes, no new dependencies, no new files beyond updating `claudeprocess.h` and `claudeprocess.cpp`.

</domain>

<decisions>
## Implementation Decisions

### Signal Payload Shape
- **D-01:** `resultReceived` emits the raw `QJsonObject` from the parsed `result` message — no pre-extraction or normalization. Phase 2 reads whatever fields it needs directly from the object.

### Error-Turn Behavior
- **D-02:** `resultReceived` fires **only when `is_error == false`**. The existing `errorOccurred` path remains the sole signal for error turns. This preserves the current error-handling contract exactly as required by the Phase 1 success criteria.

### Claude's Discretion
- Emit location: `parseLine()` is the natural place (consistent with all other signal emissions in ClaudeProcess). No reason to defer to the `finished` lambda.
- Signal name: `resultReceived(QJsonObject result)` — specified in REQUIREMENTS.md SIG-02.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` §Signal Extension — SIG-01, SIG-02: full text of the two requirements this phase delivers

### Existing Implementation
- `src/claudeprocess.h` — current signal declarations; new signal added here
- `src/claudeprocess.cpp:74-103` — `parseLine()` where the `result` branch lives; the change is confined to this method

### Phase Goal
- `.planning/ROADMAP.md` §Phase 1 — success criteria (three conditions that must be TRUE for the phase to be complete)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `parseLine()` method: already parses `system/init`, `assistant`, and `result` (error-only). The new success branch slots directly into the existing `else if (type == "result")` block.
- `QJsonObject` / `QJsonDocument` already imported in `claudeprocess.cpp` — no new includes needed.

### Established Patterns
- Signal declarations in `claudeprocess.h` under `signals:` section; implementations emit from `parseLine()`
- Signal payload types: `QString` for single values, `QJsonObject` for structured data (consistent with `toolUseStarted(const QString &name, const QString &inputJson)`)

### Integration Points
- `ClaudeBridge` connects to `ClaudeProcess` signals; it will need to connect to `resultReceived` in Phase 2, but Phase 1 only adds the signal — no connection required yet
- `claudebridge.cpp` will be the consumer in Phase 2; Phase 1 does not touch it

</code_context>

<specifics>
## Specific Ideas

No specific requirements — standard Qt signal/slot pattern applies.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 01-signal-extension*
*Context gathered: 2026-03-28*
