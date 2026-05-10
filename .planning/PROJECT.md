# ClaudianQt

## What This Is

A Qt6 desktop wrapper for the Claude Code CLI. It renders a WebEngine-based chat UI, spawns `claude --output-format stream-json` as a subprocess, and bridges the two via QWebChannel.

## Requirements

### Validated

- ✓ Qt6 WebEngine desktop app wrapping Claude Code CLI — existing
- ✓ QWebChannel bridge between C++ and JavaScript — existing
- ✓ Streaming JSON parsing of Claude CLI output — existing
- ✓ Session continuity via `--resume` flag — existing
- ✓ Claudian design system chat UI — existing

## Context

- ClaudianQt is a brownfield C++ / Qt6 / WebEngine project
- The Claude CLI subprocess outputs newline-delimited stream-json; all message content and metadata flows through `ClaudeProcess` → `ClaudeBridge` → JavaScript
- Session IDs come from `system/init` messages
- The app tracks `cwd` and `model` as properties on `ClaudeBridge`

## Constraints

- **Tech stack**: Must integrate with existing C++ / Qt6 architecture
- **Performance**: UI and streaming must not be blocked by any feature work
- **Compatibility**: macOS 12+ (current target platform)

---

*Last updated: 2026-05-10*