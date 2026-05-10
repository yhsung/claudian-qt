# UX Enhancement Sprint 2 — Tiers A, B & C

> **Status: Planned** — synthesised from parallel gap-analysis + SDK-capability explorations after Sprint 1 shipped.

---

## Tier A — Quick wins (JS/CSS only, < 30 min each)

No C++ changes required for any of these.

| # | Feature | Location | What it takes |
|---|---------|----------|---------------|
| A1 | **Copy entire message** | `chat.js renderMessage()` | Hover-reveal "Copy" button on `.msg-assistant` and `.msg-user`, same `.msg-regenerate` pattern; `copyToClipboard(msg.content)` |
| A2 | **Draft persistence** | `chat.js sendMessage()` / `wireBridgeSignals()` | Save `textarea.value` to `sessionStorage[activeSessionId]` on `input`; restore on session load — survives reload, cleared on send |
| A3 | **"Allow this session" permission** | `chat.js showPermissionDialog()` / `index.html` | Fourth button between Allow Once and Always Allow; sets `state._sessionPermissions[toolName] = true`; permission_request gated before emitting |
| A4 | **Smart auto-scroll** | `chat.js flushStreamBuffer()` | Stop auto-scroll when user actively scrolled up (track `state._userScrolled`); show a "↓" scroll-to-bottom FAB while detached |
| A5 | **Search: center current match** | `chat.js navigateToMark()` | `block: 'nearest'` → `block: 'center'` — one character |
| A6 | **Inline code scales with font size** | `chat.css .msg-content code` | `font-size: 0.875em` instead of hardcoded `0.875em` (already correct) — verify scaling works with `.fs-lg` |
| A7 | **Copy all tool results** | `chat.js renderToolCalls()` | "Copy all" button at bottom of `.tool-group-body` (visible when expanded); concatenates all `tc.result` values with tool name headers |

---

## Tier B — SDK unlocks (daemon event + C++ signal + JS renderer)

Each item is self-contained and independent.

### B1 · Tool progress / elapsed time
**SDK hook:** `SDKToolProgressMessage` — fields: `tool_use_id`, `tool_name`, `elapsed_time_seconds`

**Flow:** daemon → new `tool_progress` event → `BridgeDaemon::toolProgressReceived` signal → `ClaudeBridge::toolProgress` signal → JS `updateToolProgress(toolUseId, elapsedSeconds)` updates the ⏳ running status in the matching `.tool-call-item` to show `⏳ 4.2s`.

**Value:** Makes long-running bash/search/curl operations visible without waiting for completion.

---

### B2 · Rate limit awareness
**SDK hook:** `SDKRateLimitEvent` — fields: `rate_limit_info.status` (`allowed` | `allowed_warning` | `rejected`), `resetsAt`, `rateLimitType` (`five_hour` | `seven_day`), `utilization`, `overageStatus`

**Flow:** daemon → `rate_limit` event → C++ signal → JS updates statusline badge; if `rejected` → blocking notice in the message area explaining when the limit resets.

**Value:** Replaces silent failures with actionable messaging.

---

### B3 · Session rename
**New slot:** `ClaudeBridge::renameSession(id, name)` → `rename_session` daemon command → daemon writes a `.name` field to a `session-meta.json` sidecar in the session dir → `sessions_listed` response includes the name.

**UI:** Double-click a sidebar session item → inline `<input>` replaces the preview text; Enter/blur commits; Escape cancels.

**Value:** Most-requested session management gap — "No conversations yet" loses meaning after 20 unnamed sessions.

---

### B4 · Fast mode indicator
**SDK hook:** `system/init` message already carries `fast_mode_state: 'off' | 'cooldown' | 'on'`

**Flow:** Extract in daemon → emit `fast_mode_state` event → C++ signal → JS shows a subtle `⚡` label in statusline when `on`, dim strikethrough when `cooldown`.

**Value:** Zero new UI chrome — just surfaces information already available.

---

## Tier C — Architectural features

These require more design work and cross-cutting changes.

### C1 · Prompt suggestions
**SDK hook:** `SDKPromptSuggestionMessage` — field: `suggestion: string` — emitted after `result` (note: must keep consuming iterator past `result` to receive it; SDK docs warn about this).

**Rendering:** Clickable chip below the last assistant message: `→ Ask about X`. Click populates textarea. Chips disappear on send.

**Value:** Discoverability — guides users toward follow-up actions without modal friction.

---

### C2 · Compact boundary separator
**SDK hook:** `SDKCompactBoundaryMessage` — `compact_metadata.trigger` (`manual` | `auto`), `pre_tokens`, `post_tokens`, `duration_ms`

**Rendering:** Visual separator injected into the message list at the compaction point: `— context compacted (200k → 18k tokens, 1.2s) —`. Currently invisible and confusing.

**Value:** Explains sudden "amnesia" in long sessions.

---

### C3 · Session forking / branching
**SDK:** `forkSession(sessionId, { upToMessageId? })` returns `{ sessionId }` of new branch.

**UI:** "Fork from here" in the message hover menu (same area as ↺ Retry). Creates a new session branched at that point; opens it in the sidebar as `Fork of <original>`.

**Value:** Enables prompt experimentation without losing history.

---

### C4 · Async task panel
**SDK hooks:** `SDKTaskStartedMessage` (`task_id`, `description`, `workflow_name`), `SDKTaskProgressMessage` (`elapsed_time_seconds`, `total_tokens`, `tool_uses`), `SDKTaskNotificationMessage` (`status: completed|failed|stopped`, `summary`)

**UI:** Collapsible "Tasks" section at the bottom of the sidebar, showing running/completed tasks with token burn and a summary on completion.

**Value:** Surfaces parallel/background work that currently runs silently.

---

## Gap analysis key findings

These came from inspecting the live codebase and are actionable without SDK changes:

- **`msg.content` copy** missing — regenerate button exists but copy-message does not
- **Draft recovery** — textarea is wiped on session switch; no sessionStorage persistence
- **Auto-scroll fights user** — `flushStreamBuffer()` forces scroll-to-bottom even when user scrolled up; breaks reading mid-stream
- **`block: 'nearest'` search UX** — matches scroll into edge of viewport, not centered
- **`state._sessionPermissions`** is not implemented — every repeated tool prompt shows the dialog regardless of how many times user allowed it this session
- **Tool progress is completely silent** — 30-second bash runs show no elapsed time indicator

## SDK capabilities not yet tapped (summary)

| Capability | SDK type | Priority |
|-----------|----------|----------|
| Tool progress + elapsed time | `SDKToolProgressMessage` | High |
| Rate limit events | `SDKRateLimitEvent` | High |
| Fast mode state | `system/init.fast_mode_state` | Medium |
| Prompt suggestions | `SDKPromptSuggestionMessage` | Medium |
| Compact boundary | `SDKCompactBoundaryMessage` | Medium |
| Session forking | `forkSession()` | Medium |
| Async tasks | `SDKTask*Message` | Low |
| Hook messages | `SDKHook*Message` | Low |
| Elicitation callback | `onElicitation` | Low |
