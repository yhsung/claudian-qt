# ACE GUI Statusline — Design Spec

**Date:** 2026-05-10
**Status:** Approved

## Overview

Add a persistent statusline bar to ACE GUI (ClaudianQt) that displays the active model name, current context window usage, and turn count. The bar sits between the message area and the input area, updating after each turn completes.

---

## Data Flow

The Claude Agent SDK emits a `result` message at the end of each successful turn. The daemon already serializes this as `{ type: "result", data: m }` and `BridgeDaemon` already parses it into a `resultReceived(QJsonObject)` signal — but that signal is currently not connected in `ClaudeBridge`.

**C++ changes (two lines):**

1. Add signal `usageUpdated(const QString &json)` to `ClaudeBridge`.
2. In `ClaudeBridge` constructor, connect `m_daemon->resultReceived` to a lambda that extracts relevant fields and emits `usageUpdated`.

The lambda reads from the result object:
- `usage` — for input/output token totals (summed across the `NonNullableUsage` struct)
- `modelUsage` — a `Record<string, ModelUsage>` where each entry has `inputTokens`, `outputTokens`, `contextWindow`
- `num_turns` — integer turn count

**JSON payload emitted to JS:**
```json
{
  "inputTokens": 45200,
  "outputTokens": 1800,
  "contextWindow": 200000,
  "numTurns": 3
}
```

When `modelUsage` contains multiple entries (multiple models used in one turn), input and output tokens are summed across all entries; `contextWindow` is the maximum value found (conservative — avoids over-alarming).

If `modelUsage` is absent or `contextWindow` is 0, `contextWindow` is emitted as 0 so JS can degrade gracefully.

---

## UI Layout

A new `#statusline` div is inserted in `index.html` between the message/typing area and `#input-area`, inside `#main`.

```
┌────────────────────────────────────────────────┐
│  topbar                                        │
├────────────────────────────────────────────────┤
│                                                │
│  messages                                      │
│                                                │
├────────────────────────────────────────────────┤
│  ◉ sonnet-4-6  │  ▓▓▓▓░░░░░░  42%  │  3 turns │  ← #statusline
├────────────────────────────────────────────────┤
│  input area                                    │
└────────────────────────────────────────────────┘
```

**Elements (left → right):**

| Element | Detail |
|---|---|
| Model pill | Short name: strip `claude-` prefix. Shows `default` when no model is set. Updates on `bridge.modelChanged` (no need to wait for a turn). |
| Context progress bar | CSS `<div>` with filled inner div at `pct%` width. Color: green < 60%, orange 60–85%, red > 85%. |
| Percentage label | `42%` alongside the bar. |
| Tooltip | `title` attribute on the bar+label wrapper: `45,200 in + 1,800 out / 200,000 ctx tokens`. |
| Turn counter | `3 turns`, right-aligned. Shows `—` until first `usageUpdated`. |

**Visual spec:**
- Height: 24px
- Font size: 11px
- Colors: `--text-faint` text, `--bg-surface` background, `--border` separator lines
- Visually receding — does not compete with the chat content

---

## JS / CSS Changes

**`index.html`:** Add `#statusline` div with inner structure for model pill, bar container, and turn counter.

**`chat.js`:**
- On init: connect `bridge.usageUpdated` → parse JSON → update bar width, percentage, tooltip, turn counter.
- On `bridge.modelChanged`: update model pill immediately.
- On `bridge.sessionReady` with empty `sessionId` (new session button): reset bar and turn counter to `—`.
- On `bridge.cwdChanged` (directory change): reset bar and turn counter to `—`. Note: `set_cwd` in the daemon resets `sessionId` silently without emitting `session_ready`, so `cwdChanged` is the correct reset trigger for directory changes.

**`chat.css`:** Add styles for `#statusline`, `.statusline-model`, `.statusline-bar-track`, `.statusline-bar-fill`, `.statusline-pct`, `.statusline-turns`. Color transitions via CSS custom property thresholds (`.bar-warn`, `.bar-danger` classes toggled by JS).

---

## Edge Cases

| Scenario | Behaviour |
|---|---|
| No result yet (fresh load) | Bar shows `—`, turn count shows `—` |
| Model = "Default" / unset | Model pill shows `default` |
| `contextWindow` = 0 or missing | Hide progress bar, show raw token count (`45.2k tokens`) instead of percentage |
| Multiple models in one turn | Sum tokens; use max `contextWindow` |
| Session cleared (`newSession`) | Reset bar and turns to `—` on `sessionReady` with empty session ID |
| Working directory changed (`setCwd`) | Reset bar and turns to `—` on `cwdChanged` signal (daemon does not emit `session_ready` on cwd change) |
| Streaming in progress | Bar holds previous turn's values; no mid-turn updates |
| Malformed result JSON | Lambda emits `{}`, JS detects missing fields and shows `—` |

---

## Files Changed

| File | Change |
|---|---|
| `src/claudebridge.h` | Add `usageUpdated(const QString &json)` signal |
| `src/claudebridge.cpp` | Connect `resultReceived` → lambda → emit `usageUpdated` |
| `resources/chat/index.html` | Add `#statusline` div |
| `resources/chat/chat.js` | Handle `usageUpdated`, `modelChanged`, `sessionReady` for statusline |
| `resources/chat/chat.css` | Style `#statusline` and child elements |

No changes to `bridge/src/daemon.ts`, `BridgeDaemon`, or `resources.qrc`.
