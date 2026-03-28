# Phase 1: Signal Extension - Research

**Researched:** 2026-03-28
**Domain:** Qt6 C++ signal/slot extension — ClaudeProcess stream-json parsing
**Confidence:** HIGH

## Summary

Phase 1 is a narrow, in-tree C++ change to one class. The existing `parseLine()` method in `claudeprocess.cpp` already reaches the `type == "result"` branch but only acts on the `is_error == true` case. The new `resultReceived(QJsonObject)` signal is emitted on the `is_error == false` case and carries the raw, un-normalized `QJsonObject` from the parsed JSON line.

All required infrastructure already exists: `QJsonObject`, `QJsonDocument`, and `QJsonArray` are imported; the signal declaration pattern is established; the emit site is already identified. No new files, headers, or dependencies are needed. The entire change is three additions: one signal declaration in the `.h` file and one `else` branch + `emit` in the `.cpp` file.

The success criteria require that `usage.input_tokens`, `usage.output_tokens`, `duration_ms`, and `total_cost_usd` fields be present in the emitted object. These fields live directly in the `result` message's top-level JSON and in a nested `usage` object — they are present in the raw `QJsonObject` as-is when it is emitted without transformation.

**Primary recommendation:** Declare `resultReceived(QJsonObject result)` in `claudeprocess.h` under `signals:`, then add an `else` branch to the `type == "result"` block in `parseLine()` that emits the signal with `obj`.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** `resultReceived` emits the raw `QJsonObject` from the parsed `result` message — no pre-extraction or normalization. Phase 2 reads whatever fields it needs directly from the object.
- **D-02:** `resultReceived` fires **only when `is_error == false`**. The existing `errorOccurred` path remains the sole signal for error turns. This preserves the current error-handling contract exactly as required by the Phase 1 success criteria.

### Claude's Discretion

- Emit location: `parseLine()` is the natural place (consistent with all other signal emissions in ClaudeProcess). No reason to defer to the `finished` lambda.
- Signal name: `resultReceived(QJsonObject result)` — specified in REQUIREMENTS.md SIG-02.

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SIG-01 | System parses the full `result` message from Claude CLI subprocess (currently only `is_error` is read; `usage`, `duration_ms`, `total_cost_usd`, `stop_reason` are discarded) | The `type == "result"` branch in `parseLine()` already parses the full `QJsonObject`; only the emit is missing for the non-error case. The raw `obj` contains all fields. |
| SIG-02 | System emits a `resultReceived(QJsonObject)` signal from `ClaudeProcess` when a successful `result` message is parsed | Qt6 signal-with-QJsonObject-payload is idiomatic; the pattern is already used for structured data in this codebase (`toolUseStarted`). One declaration + one emit completes SIG-02. |
</phase_requirements>

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Qt6::Core | 6.11.0 (installed) | `QObject`, `Q_OBJECT`, signals/slots, `QJsonObject` | Already the project runtime; no alternative |
| Qt6::Core JSON | 6.11.0 | `QJsonDocument`, `QJsonObject` parsing | Already imported in `claudeprocess.cpp` lines 2-4 |

### Supporting

No additional libraries needed. All required types are already in scope.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Raw `QJsonObject` payload | Pre-extracted struct | Struct would couple ClaudeProcess to logger schema — D-01 locks the raw approach |
| Emit in `parseLine()` | Emit in `finished` lambda | `finished` fires after process exit; `parseLine()` fires at stream time, consistent with other signals — discretion area, `parseLine()` is correct |

**Installation:** No new packages. Build with existing CMake configuration from `CLAUDE.md`.

**Version verification:** Qt 6.11.0 confirmed installed at `/opt/homebrew/Cellar/qtbase/6.11.0/`.

---

## Architecture Patterns

### Existing Signal Declaration Pattern

Signals in `claudeprocess.h` under the `signals:` section, one per event type:

```cpp
// Source: src/claudeprocess.h lines 18-24
signals:
    void sessionInitialized(const QString &sessionId);
    void textReady(const QString &text);
    void toolUseStarted(const QString &name, const QString &inputJson);
    void turnFinished();
    void errorOccurred(const QString &msg);
```

New signal follows the same pattern:

```cpp
void resultReceived(const QJsonObject &result);
```

### Existing parseLine() Branching Pattern

The emit-from-branch pattern in `parseLine()` (lines 74-103 of `claudeprocess.cpp`):

```cpp
// Source: src/claudeprocess.cpp lines 101-103 — CURRENT CODE
} else if (type == "result" && obj["is_error"].toBool()) {
    emit errorOccurred(obj["result"].toString());
}
```

The new branch slots in as an `else` on this condition:

```cpp
} else if (type == "result") {
    if (obj["is_error"].toBool()) {
        emit errorOccurred(obj["result"].toString());
    } else {
        emit resultReceived(obj);
    }
}
```

This is the only structural change required.

### ClaudeBridge Connection Pattern

In `claudebridge.cpp` (lines 15-22), `ClaudeBridge` connects to `ClaudeProcess` signals in the constructor. Phase 1 does NOT add a connection here — that is Phase 2's responsibility. The signal is emitted with no consumer until Phase 2 connects it.

```cpp
// Source: src/claudebridge.cpp lines 15-22 — existing pattern for Phase 2 reference
connect(m_claude, &ClaudeProcess::sessionInitialized, this, [...]);
connect(m_claude, &ClaudeProcess::textReady,     this, &ClaudeBridge::textReady);
connect(m_claude, &ClaudeProcess::toolUseStarted,this, &ClaudeBridge::toolUse);
connect(m_claude, &ClaudeProcess::turnFinished,  this, &ClaudeBridge::turnComplete);
connect(m_claude, &ClaudeProcess::errorOccurred, this, &ClaudeBridge::errorOccurred);
```

### Anti-Patterns to Avoid

- **Extracting fields before emitting:** D-01 prohibits this. Emit `obj` directly.
- **Emitting on error turns:** D-02 prohibits this. The `is_error == true` branch must continue emitting `errorOccurred` only.
- **Adding ClaudeBridge wiring in this phase:** Phase 1 is ClaudeProcess-only. Do not touch `claudebridge.cpp` or `claudebridge.h`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON parsing | Custom string parser | `QJsonDocument::fromJson()` | Already used in `parseLine()`; handles malformed input with `QJsonParseError` |
| Signal dispatch | Manual callback list | Qt `signals:` + `emit` | MOC generates all boilerplate; thread-safe across Qt event loop |

**Key insight:** Qt MOC handles all signal/slot registration and dispatch automatically once the signal is declared in the `signals:` section with `Q_OBJECT` present. No registration code is needed.

---

## Common Pitfalls

### Pitfall 1: `const QJsonObject &` vs `QJsonObject` in signal parameter

**What goes wrong:** Declaring the signal parameter as `const QJsonObject &result` vs `QJsonObject result` — both compile, but Qt signal parameters are passed by value across queued connections. Using a reference in the declaration is idiomatic for direct connections (same thread, same process) and is the convention used in the codebase.

**Why it happens:** Developers copy patterns from regular C++ function declarations without considering Qt's signal argument passing rules.

**How to avoid:** Use `const QJsonObject &result` in the declaration (matches Qt docs for intra-thread signals). Confirm the connection type is `Qt::DirectConnection` (default for same-thread objects).

**Warning signs:** Compile warning about passing non-copyable type across queued connection — not applicable here since `QJsonObject` is copyable.

### Pitfall 2: Breaking the `is_error` branch

**What goes wrong:** Replacing `} else if (type == "result" && obj["is_error"].toBool())` with a single unconditional `type == "result"` branch that loses the `is_error` guard.

**Why it happens:** Refactoring the condition without preserving the error path.

**How to avoid:** The correct structure nests the `is_error` check inside the outer `type == "result"` branch — `if/else` inside, not removing the outer guard. Success criterion 3 explicitly requires the error path to be unchanged.

**Warning signs:** Test with an intentionally failing prompt — `errorOccurred` must still fire; `resultReceived` must not fire.

### Pitfall 3: Emitting from `finished` lambda instead of `parseLine()`

**What goes wrong:** Adding the emit to the `QProcess::finished` lambda in `send()` instead of `parseLine()`. The `result` line arrives before the process exits, so the lambda could fire with a stale or unconsumed object.

**Why it happens:** The `finished` lambda already exists as a convenient place to add end-of-turn logic.

**How to avoid:** Emit from `parseLine()` — that is where all other content signals are emitted, consistent with the CONTEXT.md discretion note.

---

## Code Examples

### Complete Diff Pattern

```cpp
// src/claudeprocess.h — add ONE line under signals:
signals:
    void sessionInitialized(const QString &sessionId);
    void textReady(const QString &text);
    void toolUseStarted(const QString &name, const QString &inputJson);
    void turnFinished();
    void errorOccurred(const QString &msg);
    void resultReceived(const QJsonObject &result);   // NEW
```

```cpp
// src/claudeprocess.cpp — replace the result branch in parseLine()
// BEFORE (lines 101-103):
} else if (type == "result" && obj["is_error"].toBool()) {
    emit errorOccurred(obj["result"].toString());
}

// AFTER:
} else if (type == "result") {
    if (obj["is_error"].toBool()) {
        emit errorOccurred(obj["result"].toString());
    } else {
        emit resultReceived(obj);
    }
}
```

No other files change in Phase 1.

### Expected Payload Fields (from Claude CLI stream-json format)

The `result` message emitted by `claude --output-format stream-json` for a successful turn contains:

```json
{
  "type": "result",
  "subtype": "success",
  "is_error": false,
  "duration_ms": 4231,
  "duration_api_ms": 3910,
  "num_turns": 1,
  "result": "...",
  "session_id": "...",
  "total_cost_usd": 0.0041,
  "usage": {
    "input_tokens": 1204,
    "output_tokens": 183,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0
  }
}
```

When emitted as `obj` (the raw `QJsonObject`), all fields listed in SIG-01 are present at the top level or one level deep under `"usage"`. Phase 2 accesses them via `obj["duration_ms"].toDouble()`, `obj["total_cost_usd"].toDouble()`, `obj["usage"].toObject()["input_tokens"].toInt()`, etc.

**Confidence note:** This schema is from CLI inspection and existing project research (`.planning/STATE.md` blockers note it is not a versioned public API). The fields named in SIG-01 (`usage.input_tokens`, `usage.output_tokens`, `duration_ms`, `total_cost_usd`) are verified against the project's own prior research. Treat as MEDIUM confidence — verification against a live CLI run is recommended in Phase 2.

---

## Runtime State Inventory

Step 2.5: SKIPPED — This phase is a pure C++ source addition, not a rename/refactor/migration.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Apple Clang | C++ compilation | Yes | 21.0.0 (clang-2100.0.123.102) | — |
| CMake | Build configuration | Yes | 3.31.3 | — |
| Qt6::Core (qtbase) | QObject, QJsonObject | Yes | 6.11.0 | — |
| Qt6::WebEngine | UI runtime (not needed for Phase 1) | Assumed yes | 6.11.0 | — |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** None.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | None detected — no test config, no `tests/` directory |
| Config file | None — Wave 0 gap |
| Quick run command | Manual: build + run with `qDebug` breakpoint on `resultReceived` |
| Full suite command | Manual: same |

No automated test infrastructure exists in this project. The phase success criteria specify a "breakpoint or log statement on `resultReceived` fires" — this is an integration-level manual verification, not a unit test. This is intentional per the project's current state.

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SIG-01 | `parseLine()` reads `usage`, `duration_ms`, `total_cost_usd`, `stop_reason` from `result` message | Manual smoke | Run app, send message, check `qDebug` output | No test infrastructure |
| SIG-02 | `resultReceived(QJsonObject)` fires after successful turn | Manual smoke | Set breakpoint in debugger OR add `qDebug() << "resultReceived"` in a connected slot | No test infrastructure |

### Sampling Rate

- **Per task commit:** Manual: build (`cmake --build . --parallel $(sysctl -n hw.ncpu)`) confirms no compile errors
- **Per wave merge:** Manual: launch app, send one message, confirm `resultReceived` fires and payload is correct
- **Phase gate:** All three success criteria verified manually before `/gsd:verify-work`

### Wave 0 Gaps

No test framework to install. Verification is manual per the project's current practice. The planner should include a manual smoke-test step as the final task rather than automated test scaffolding.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `result` branch emits only on `is_error` | Emit `resultReceived` on success branch | Phase 1 | Downstream phases can consume usage/cost/duration |

**Deprecated/outdated:** Nothing — this is purely additive.

---

## Open Questions

1. **Exact `result` message schema across Claude CLI versions**
   - What we know: Fields `usage.input_tokens`, `usage.output_tokens`, `duration_ms`, `total_cost_usd`, `stop_reason` are expected from prior research
   - What's unclear: Schema is not a versioned public API; fields could be absent in older or future CLI releases
   - Recommendation: Emit the raw `QJsonObject` (D-01) so consumers can check field presence rather than assuming it. Phase 2 should use `.contains()` guards when reading individual fields. This is a Phase 2 concern, not Phase 1.

2. **Whether `result` is always emitted before process exit**
   - What we know: `STATE.md` blockers reference a Claude CLI bug (issues #25629, #1920) where `result` is never emitted
   - What's unclear: Whether this affects the signal at all (if `result` never arrives, `parseLine()` never reaches the branch — signal simply never fires)
   - Recommendation: Phase 1 is unaffected — if `result` is absent, `resultReceived` does not fire. Phase 2 must handle the case where `resultReceived` never fires for a given turn (timeout/fallback). Not a Phase 1 concern.

---

## Project Constraints (from CLAUDE.md)

Directives the planner must verify compliance with:

- **Tech stack**: C++ changes only; must integrate with existing Qt6/`QProcess` architecture
- **No new dependencies**: `QJsonObject` and related types are already imported
- **C++ 17 standard**: `CMAKE_CXX_STANDARD` is C++17 — no C++20 features
- **Member variable naming**: `m_` prefix for instance variables (not applicable to this change — no new member variables)
- **Signal naming**: camelCase, emitted-as-event naming — `resultReceived` satisfies this
- **Error handling**: No exceptions; errors via signals — already the pattern
- **File change scope**: Only `src/claudeprocess.h` and `src/claudeprocess.cpp` — confirmed correct per CONTEXT.md
- **GSD workflow**: All file edits must go through a GSD workflow (`/gsd:execute-phase`) — research does not bypass this

---

## Sources

### Primary (HIGH confidence)

- Direct code inspection: `src/claudeprocess.h` (lines 1-35), `src/claudeprocess.cpp` (lines 74-103) — signal pattern and parseLine() structure
- Direct code inspection: `src/claudebridge.cpp` (lines 15-22) — connection pattern for Phase 2 reference
- Qt6 documentation pattern (verified from CLAUDE.md architecture section): `Q_OBJECT`, `signals:`, `emit` — standard Qt6 idiom
- `.planning/phases/01-signal-extension/01-CONTEXT.md` — locked decisions D-01, D-02

### Secondary (MEDIUM confidence)

- `.planning/STATE.md` — result schema fields and known CLI bugs noted as Phase 2 concerns
- `.planning/REQUIREMENTS.md` — SIG-01, SIG-02 field list (`usage.input_tokens`, `usage.output_tokens`, `duration_ms`, `total_cost_usd`)
- Claude CLI `stream-json` format — inferred from existing `parseLine()` implementation and REQUIREMENTS.md field names; not independently verified against live CLI in this research session

### Tertiary (LOW confidence)

- None.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Qt6 qtbase 6.11.0 confirmed installed; all required types already imported
- Architecture: HIGH — change is fully specified by existing code patterns; no novel patterns required
- Pitfalls: HIGH — derived from direct code reading and Qt signal/slot semantics
- Result schema fields: MEDIUM — from prior project research and REQUIREMENTS.md; not verified against live CLI

**Research date:** 2026-03-28
**Valid until:** 2026-04-28 (Qt6 API is stable; Claude CLI schema is not versioned — re-verify at Phase 2 implementation)
