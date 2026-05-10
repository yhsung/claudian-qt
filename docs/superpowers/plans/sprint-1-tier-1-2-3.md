# UX Enhancement Sprint 1 — Tiers 1, 2 & 3

> **Status: Shipped** — all items committed to `main`.
> Synthesised from parallel gap-analysis + SDK-capability explorations.

---

## Tier 1 — Quick wins (JS/CSS only)

All items required no C++ changes.

| # | Feature | Implementation |
|---|---------|----------------|
| 1 | **Message timestamps** | `msg.timestamp` rendered with `relativeTime()` below each bubble; right-aligned for user, left for assistant |
| 2 | **Copy button on tool results** | `makeToolResultEl()` wraps `.tool-result <pre>` in a `.tool-result-wrapper` with a hover-revealed Copy→Copied! button, same pattern as code blocks |
| 3 | **Clear-all attachments** | "Clear all" button appears in the attachment tray when ≥ 2 images are staged |
| 4 | **In-session transcript search** | ⌘F / topbar icon → `#search-bar`; `TreeWalker` wraps each matching text node in `<mark class="search-highlight">`; ↑/↓ buttons + Enter/Shift+Enter navigate between occurrences; count shows `N of M`; Escape unwraps all marks |
| 5 | **Escape hierarchy** | Single prioritised `keydown` listener: image preview → permission dialog → search bar → summary view |

---

## Tier 2 — Medium (one new signal/slot each)

| # | Feature | C++ surface | Daemon command |
|---|---------|-------------|----------------|
| 6 | **Per-turn token badge + stop reason** | `usageUpdated` payload gains `stopReason`, `subtype`, `cacheReadTokens`, `cacheCreatedTokens` | Extracted from `result` message fields |
| 7 | **Regenerate last response** | No new slot — `bridge.sendMessage()` reused | `_lastPrompt` stored in JS state; ↺ Retry button appended to last assistant message after streaming; clicking removes the message and re-streams |
| 8 | **Session delete** | `ClaudeBridge::deleteSession(id)` → `delete_session` command | Daemon unlinks `.jsonl` from `~/.claude/projects/<cwd>/`; re-emits `sessions_listed` |
| 9 | **Permission mode selector** | `ClaudeBridge::setPermissionMode(mode)` → `set_permission_mode` | `state.permissionMode` passed as `permissionMode` to `query()` each turn |

**Permission mode values:** `default` (Safe — prompts all), `acceptEdits` (Smart — auto-approves file ops), `auto` (AI classifier). YOLO overrides to `bypassPermissions`.

---

## Tier 3 — SDK unlocks (protocol + C++ + JS)

| # | Feature | SDK hook | New event |
|---|---------|----------|-----------|
| 10 | **Extended thinking display** | `content_block_delta` → `thinking_delta` | `thinking_chunk` → `.thinking-block` above response; collapsible; expands by default in Thinking view mode; activates the dormant view mode selector option |
| 11 | **Cache hit indicator** | `message_delta.usage.cache_read_input_tokens` | Merged into `result` emit as `cacheReadTokens`/`cacheCreatedTokens`; `💾 cached` label in token badge with hover tooltip |
| 12 | **Sub-agent transparency** | `SDKAssistantMessage.parent_tool_use_id` non-null | `sub_agent_message` → `.sub-agent-block` with `↳ Sub-agent` label; progressive with `includePartialMessages` |

---

## Architecture notes

- `canUseTool` callback must **always** be provided — the SDK only adds `--permission-prompt-tool stdio` to the CLI when it is. Without that flag the CLI has no IPC channel for permission requests and fails every gated tool even in YOLO mode.
- `makeCanUseTool(effectiveYolo)` captures YOLO state at send time: YOLO → auto-approve; normal → emit `permission_request` and wait.
- `PermissionResult` allow branch requires `updatedInput: {}` (runtime Zod validation is stricter than the TypeScript types).
- `decisionClassification` is **not** in the CLI's Zod schema — omit it from the allow result.
- CMake `ClaudeBridge` custom target has a `POST_BUILD` copy of `bridge/dist` to the app bundle so TS-only changes don't require a C++ relink to update the running daemon.
