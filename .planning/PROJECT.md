# ClaudianQt — Conversation Tracing

## What This Is

A conversation tracing system for ClaudianQt, the Qt6 desktop wrapper for Claude Code CLI. It captures every user prompt and assistant response (with rich metadata) into local log files for downstream data mining, usage analysis, and AI training dataset creation.

## Core Value

Every conversation is reliably captured with complete context — no messages lost, no metadata missing — so logs can be used as training data and for usage analysis without manual intervention.

## Requirements

### Validated

- ✓ Qt6 WebEngine desktop app wrapping Claude Code CLI — existing
- ✓ QWebChannel bridge between C++ and JavaScript — existing
- ✓ Streaming JSON parsing of Claude CLI output — existing
- ✓ Session continuity via `--resume` flag — existing
- ✓ Claudian design system chat UI — existing

### Active

- [ ] Always-on conversation logging (one file per session)
- [ ] Capture user prompts with timestamps
- [ ] Capture assistant responses with timestamps
- [ ] JSONL output format for machine consumption
- [ ] Markdown output format for human review
- [ ] Token count metadata per turn (input/output)
- [ ] Tool usage metadata (tool names, success/fail)
- [ ] Session info metadata (session ID, model name, CWD)
- [ ] Response duration metadata per assistant turn
- [ ] Configurable log storage location (default: `~/.claudian/logs/`)

### Out of Scope

- Log viewer/browser UI — defer to v2, use external tools for now
- Search/filter across logs — defer to v2
- Cloud sync or remote export — complexity, privacy concerns
- Real-time streaming to external services — not needed for local-first approach
- Anonymization/PII scrubbing — user controls their own data locally

## Context

- ClaudianQt is a brownfield C++ / Qt6 / WebEngine project
- The Claude CLI subprocess outputs newline-delimited stream-json; all message content and metadata flows through `ClaudeProcess` → `ClaudeBridge` → JavaScript
- Token counts and tool usage are available in the stream-json `result` messages
- Session IDs come from `system/init` messages
- The app already tracks `cwd` and `model` as properties on `ClaudeBridge`
- Dual format (JSONL + Markdown) means each session produces two files

## Constraints

- **Tech stack**: Must integrate with existing C++ / Qt6 architecture — logging should happen in the C++ layer for reliability
- **Performance**: Logging must not block the UI or slow streaming responses — use async file I/O or buffered writes
- **Compatibility**: macOS 12+ (current target platform)
- **File size**: Conversations can be long — consider file rotation or size limits for very large sessions

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Log in C++ layer, not JavaScript | C++ has direct access to all stream-json data and is more reliable than JS for file I/O | — Pending |
| Dual format (JSONL + Markdown) | JSONL for ML pipelines, Markdown for human review — different consumers | — Pending |
| Always-on, no opt-in toggle | User wants comprehensive capture; simplifies implementation | — Pending |
| Configurable storage path | Default `~/.claudian/logs/` but overridable for flexibility | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-03-28 after initialization*
