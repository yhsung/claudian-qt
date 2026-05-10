# SDK Events: Tool Progress, Rate Limit, Fast Mode, Suggestions, Compact

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire five SDK events into the daemon bridge: tool elapsed time (SDKToolProgressMessage), rate limit awareness (SDKRateLimitEvent), fast mode indicator (fast_mode_state from system/init), prompt suggestions (SDKPromptSuggestionMessage), and compact boundary (SDKCompactBoundaryMessage).

**Architecture:** Each event is consumed in `daemon.ts` inside the `for await (const message of queryResult)` loop. Each emits a typed `DaemonEvent`. C++ exposes the new signals. JS renders the UI updates. All five are independent — implement in any order.

**Tech Stack:** TypeScript (daemon), C++ signals (bridgedaemon), Vanilla JS (UI)

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `bridge/src/protocol.ts` | Add 5 new event types to DaemonEvent union |
| Modify | `bridge/src/daemon.ts` | Consume all 5 SDK event types in query loop |
| Modify | `src/bridgedaemon.h` | Add 5 new signals |
| Modify | `src/bridgedaemon.cpp` | Connect daemon events to signals |
| Modify | `src/claudebridge.h` | Re-expose the 5 signals |
| Modify | `src/claudebridge.cpp` | Connect bridgedaemon signals to claudebridge signals |
| Modify | `resources/chat/chat.js` | Render tool progress, rate limit, fast mode, suggestions, compact UI |
| Modify | `resources/chat/chat.css` | Style rate limit banner, suggestion chips, compact separator |
| Modify | `resources/chat/index.html` | Rate limit banner element |

---

## Task 1: Protocol + Daemon event wiring

**Files:**
- Modify: `bridge/src/protocol.ts:44-56`
- Modify: `bridge/src/daemon.ts:99-214`

- [ ] **Step 1: Add 5 new event types to DaemonEvent**

Find `DaemonEvent` in `protocol.ts` (line ~44). Add before the closing `;`:

```typescript
  | { type: "tool_progress"; id: string; name: string; elapsedSeconds: number }
  | { type: "rate_limit"; status: "allowed" | "allowed_warning" | "rejected"; resetsAt?: string; rateLimitType?: string; utilization?: number }
  | { type: "fast_mode_state"; state: "off" | "cooldown" | "on" }
  | { type: "prompt_suggestion"; suggestion: string }
  | { type: "compact_boundary"; preTokens: number; postTokens: number; durationMs: number; trigger: "manual" | "auto" }
```

- [ ] **Step 2: Wire tool_progress in daemon query loop**

In `daemon.ts` inside the `for await (const message of queryResult)` loop (after `message_delta` handling, around line 120), add:

```typescript
        } else if (event.type === "tool_progress") {
          const tp = event as Record<string, unknown>;
          emit({
            type: "tool_progress",
            id: String(tp.id || ""),
            name: String(tp.tool_name || ""),
            elapsedSeconds: Number(tp.elapsed_time_seconds || 0),
          });
        }
```

Note: `SDKToolProgressMessage` has fields `tool_use_id`, `tool_name`, `elapsed_time_seconds`. Map `tool_use_id → id`, `tool_name → name`, `elapsed_time_seconds → elapsedSeconds`.

- [ ] **Step 3: Wire rate_limit event in daemon**

Add to the `for await` loop. The `SDKRateLimitEvent` is a top-level message type (not inside `stream_event`). Find `m.type === "result"` and add a new `else if` before it:

```typescript
      } else if (m.type === "rate_limit") {
        const r = m as Record<string, unknown>;
        const rli = r.rate_limit_info as Record<string, unknown> | undefined;
        emit({
          type: "rate_limit",
          status: String(rli?.status || "allowed"),
          resetsAt: rli?.resetsAt ? String(rli.resetsAt) : undefined,
          rateLimitType: rli?.rateLimitType ? String(rli.rateLimitType) : undefined,
          utilization: typeof rli?.utilization === "number" ? rli.utilization : undefined,
        });
      }
```

- [ ] **Step 4: Wire fast_mode_state from system/init**

Find the `m.type === "system" && m.subtype === "init"` block (line ~103). Add after `emit({ type: "session_ready", sessionId: state.sessionId })`:

```typescript
        const fastModeState = (m as Record<string, unknown>).fast_mode_state as string | undefined;
        if (fastModeState) {
          emit({ type: "fast_mode_state", state: fastModeState as "off" | "cooldown" | "on" });
        }
```

- [ ] **Step 5: Wire prompt_suggestion (emitted after result)**

After `emit({ type: "result", ...})` in the `m.type === "result"` branch (after `emit({ type: "result", ...})`), add:

```typescript
      } else if (m.type === "prompt_suggestion") {
        const ps = m as Record<string, unknown>;
        emit({ type: "prompt_suggestion", suggestion: String(ps.suggestion || "") });
      }
```

Note: `SDKPromptSuggestionMessage` is `type: "prompt_suggestion"` with field `suggestion: string`. The SDK emits this after `result` — the `for await` loop continues after result so we catch it here.

- [ ] **Step 6: Wire compact_boundary separator**

In the `m.type === "result"` branch, after handling `is_error`, add:

```typescript
      } else if (m.type === "compact_boundary") {
        const cb = m as Record<string, unknown>;
        emit({
          type: "compact_boundary",
          preTokens: Number(cb.pre_tokens || 0),
          postTokens: Number(cb.post_tokens || 0),
          durationMs: Number(cb.duration_ms || 0),
          trigger: String(cb.trigger || "auto") as "manual" | "auto",
        });
      }
```

Note: `SDKCompactBoundaryMessage` has fields `compact_metadata.trigger`, `pre_tokens`, `post_tokens`, `duration_ms`. The message type is `compact_boundary`.

- [ ] **Step 7: Build and verify**

```bash
cd bridge && npm run build 2>&1
```

Expected: No TypeScript errors. `bridge/dist/daemon.js` updated.

- [ ] **Step 8: Commit**

```bash
git add bridge/src/protocol.ts bridge/src/daemon.ts
git commit -m "feat(daemon): wire SDKToolProgress, SDKRateLimitEvent, fast_mode_state, prompt_suggestion, compact_boundary"
```

---

## Task 2: C++ signal passthrough

**Files:**
- Modify: `src/bridgedaemon.h`
- Modify: `src/bridgedaemon.cpp`
- Modify: `src/claudebridge.h`
- Modify: `src/claudebridge.cpp`

- [ ] **Step 1: Add 5 new signals to BridgeDaemon in bridgedaemon.h**

Find the `signals:` section in `src/bridgedaemon.h` (around line 12). Add before the closing `};`:

```cpp
    void toolProgress(const QString &id, const QString &name, double elapsedSeconds);
    void rateLimit(const QString &json);
    void fastModeStateChanged(const QString &state);
    void promptSuggestion(const QString &suggestion);
    void compactBoundary(const QString &json);
```

- [ ] **Step 2: Connect daemon events to signals in bridgedaemon.cpp**

Find `handleEvent()` in `src/bridgedaemon.cpp` (around line 53). Add before the final `else`:

```cpp
    else if (type == "tool_progress")        emit toolProgress(event["id"].toString(), event["name"].toString(), event["elapsedSeconds"].toDouble());
    else if (type == "rate_limit")           emit rateLimit(QString::fromUtf8(QJsonDocument(event).toJson(QJsonDocument::Compact)));
    else if (type == "fast_mode_state")      emit fastModeStateChanged(event["state"].toString());
    else if (type == "prompt_suggestion")   emit promptSuggestion(event["suggestion"].toString());
    else if (type == "compact_boundary")     emit compactBoundary(QString::fromUtf8(QJsonDocument(QJsonObject{
        {"preTokens", event["preTokens"]},
        {"postTokens", event["postTokens"]},
        {"durationMs", event["durationMs"]},
        {"trigger", event["trigger"]}
    }).toJson(QJsonDocument::Compact)));
```

- [ ] **Step 3: Add 5 new signals to ClaudeBridge in claudebridge.h**

Find `signals:` section. Add before the closing `};`:

```cpp
    void toolProgress(const QString &id, const QString &name, double elapsedSeconds);
    void rateLimit(const QString &json);
    void fastModeStateChanged(const QString &state);
    void promptSuggestion(const QString &suggestion);
    void compactBoundary(const QString &json);
```

- [ ] **Step 4: Wire bridgedaemon signals to claudebridge signals in claudebridge.cpp**

Find the `connect(m_daemon, ...)` calls in `ClaudeBridge` constructor. Add after the existing ones:

```cpp
    connect(m_daemon, &BridgeDaemon::toolProgress,        this, &ClaudeBridge::toolProgress);
    connect(m_daemon, &BridgeDaemon::rateLimit,           this, &ClaudeBridge::rateLimit);
    connect(m_daemon, &BridgeDaemon::fastModeStateChanged, this, &ClaudeBridge::fastModeStateChanged);
    connect(m_daemon, &BridgeDaemon::promptSuggestion,    this, &ClaudeBridge::promptSuggestion);
    connect(m_daemon, &BridgeDaemon::compactBoundary,     this, &ClaudeBridge::compactBoundary);
```

- [ ] **Step 5: Build and verify**

```bash
cd build && cmake --build . --parallel $(sysctl -n hw.ncpu) 2>&1 | tail -10
```

Expected: `[100%] Built target ClaudianQt` — no compile errors.

- [ ] **Step 6: Commit**

```bash
git add src/bridgedaemon.h src/bridgedaemon.cpp src/claudebridge.h src/claudebridge.cpp
git commit -m "feat(bridge): expose toolProgress, rateLimit, fastMode, promptSuggestion, compact signals"
```

---

## Task 3: Tool elapsed time in JS

**Files:**
- Modify: `resources/chat/chat.js`
- Modify: `resources/chat/chat.css`

- [ ] **Step 1: Add elapsed timer to tool call state**

Find `state` object (line ~4). Add `_toolTimers: {} as Record<string, number>` after `toolCallCount: 0,`. This tracks tool start times by tool ID.

- [ ] **Step 2: Wire toolProgress signal in wireEvents()**

Find `bridge.toolUse.connect(...)` in `wireEvents()`. Add after it:

```js
  bridge.toolProgress.connect((id, name, elapsedSeconds) => {
    const tc = state.messages.find(m => m.id === state.currentMsgId)?.toolCalls.find(t => t.id === id);
    if (!tc) return;
    tc.elapsedSeconds = elapsedSeconds;
    const el = DOM.messages.querySelector(`[data-tool-id="${id}"]`);
    if (!el) return;
    const statusEl = el.querySelector('.tool-status');
    if (statusEl) {
      const prev = tc.status === 'running' ? '⏳ running' : statusEl.textContent;
      if (elapsedSeconds > 0) statusEl.textContent = `⏳ ${elapsedSeconds.toFixed(1)}s`;
    }
  });
```

- [ ] **Step 3: Update renderToolCallItem to show elapsed time**

Find `renderToolCallItem()` (line ~232). The `statusText` assignment is:

```js
  const statusText = tc.status === 'running' ? '⏳ running'
    : tc.status === 'done' ? '✓ done' : '✗ error';
```

If `tc.elapsedSeconds` is set, append it to the status:

```js
  const elapsedStr = tc.elapsedSeconds != null ? ` (${tc.elapsedSeconds.toFixed(1)}s)` : '';
  const statusText = tc.status === 'running' ? `⏳ running${elapsedStr}`
    : tc.status === 'done' ? `✓ done${elapsedStr}` : `✗ error${elapsedStr}`;
```

- [ ] **Step 4: Build and verify**

```bash
cd build && cmake --build . --parallel $(sysctl -n hw.ncpu) 2>&1 | tail -5
```

Expected: `[100%] Built target ClaudianQt`

- [ ] **Step 5: Commit**

```bash
git add resources/chat/chat.js
git commit -m "feat: show elapsed time on running tool calls"
```

---

## Task 4: Rate limit banner in JS

**Files:**
- Modify: `resources/chat/index.html`
- Modify: `resources/chat/chat.css`
- Modify: `resources/chat/chat.js`

- [ ] **Step 1: Add rate limit banner HTML**

Find `#permission-modal` in `index.html`. Add the banner before it:

```html
<div id="rate-limit-banner">
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
  <span id="rate-limit-text"></span>
</div>

<div id="permission-modal">
```

- [ ] **Step 2: Add rate limit banner CSS**

Add before `#permission-modal` in `chat.css`:

```css
/* ── Rate limit banner ─────────────────────────────────────────────────────── */
#rate-limit-banner {
  display: none;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: var(--orange);
  color: #000;
  font-size: 12px;
  font-weight: 500;
}
#rate-limit-banner.visible { display: flex; }
#rate-limit-banner.warning { background: var(--orange); }
#rate-limit-banner.rejected { background: var(--red); color: #fff; }
#rate-limit-banner svg { flex-shrink: 0; }
```

- [ ] **Step 3: Add DOM ref and wire bridge signal**

In `initDOM()`, add:

```js
rateLimitBanner: document.getElementById('rate-limit-banner'),
rateLimitText:   document.getElementById('rate-limit-text'),
```

In `wireEvents()`, add:

```js
  bridge.rateLimit.connect(json => {
    const data = JSON.parse(json);
    const { status, resetsAt, rateLimitType } = data;
    const banner = DOM.rateLimitBanner;
    const text = DOM.rateLimitText;
    banner.classList.remove('visible', 'warning', 'rejected');
    if (status === 'rejected') {
      banner.classList.add('visible', 'rejected');
      text.textContent = `Rate limit reached${rateLimitType ? ` (${rateLimitType})` : ''}. Limit resets at ${resetsAt || 'unknown'}.`;
    } else if (status === 'allowed_warning') {
      banner.classList.add('visible', 'warning');
      text.textContent = `Approaching rate limit${rateLimitType ? ` (${rateLimitType})` : ''}.`;
    } else {
      banner.classList.remove('visible');
    }
  });
```

Also add `DOM.rateLimitBanner.classList.remove('visible')` inside `startStreaming()` to clear the banner on a new message.

- [ ] **Step 4: Build and verify**

```bash
cd build && cmake --build . --parallel $(sysctl -n hw.ncpu) 2>&1 | tail -5
```

Expected: `[100%] Built target ClaudianQt`

- [ ] **Step 5: Commit**

```bash
git add resources/chat/index.html resources/chat/chat.css resources/chat/chat.js
git commit -m "feat: add rate limit banner with warning/rejected states"
```

---

## Task 5: Fast mode indicator

**Files:**
- Modify: `resources/chat/chat.js`
- Modify: `resources/chat/chat.css`

- [ ] **Step 1: Add fast mode badge to statusline**

Find `syncStatuslineModel()` (line ~986). Update it to also sync fast mode:

```js
function syncStatuslineModel(model) {
  DOM.statuslineModel.textContent = shortModelName(model);
}

let _fastModeState = 'off';
function syncFastMode(state) {
  _fastModeState = state;
  if (!DOM.statuslineFastMode) return;
  DOM.statuslineFastMode.className = 'fast-mode-badge ' + (state === 'on' ? 'fast-mode-on' : state === 'cooldown' ? 'fast-mode-cooldown' : '');
  DOM.statuslineFastMode.textContent = state === 'on' ? '⚡' : state === 'cooldown' ? '⚡̱' : '';
  DOM.statuslineFastMode.title = state === 'on' ? 'Fast mode on' : state === 'cooldown' ? 'Fast mode recharging' : '';
}
```

In `initDOM()`, add:
```js
statuslineFastMode: document.getElementById('statusline-fast-mode'),
```

In `index.html`, find `#statusline-model` and add after it:
```html
<span id="statusline-fast-mode"></span>
```

Add to `chat.css`:
```css
/* ── Fast mode badge ───────────────────────────────────────────────────────── */
.fast-mode-badge {
  font-size: 11px; margin-left: 2px;
}
.fast-mode-badge.fast-mode-on { color: var(--green); }
.fast-mode-badge.fast-mode-cooldown { color: var(--text-faint); }
```

Wire the bridge signal in `wireEvents()`:
```js
  bridge.fastModeStateChanged.connect(state => syncFastMode(state));
```

- [ ] **Step 2: Build and verify**

```bash
cd build && cmake --build . --parallel $(sysctl -n hw.ncpu) 2>&1 | tail -5
```

Expected: `[100%] Built target ClaudianQt`

- [ ] **Step 3: Commit**

```bash
git add resources/chat/index.html resources/chat/chat.css resources/chat/chat.js
git commit -m "feat: show fast mode indicator in statusline"
```

---

## Task 6: Prompt suggestions

**Files:**
- Modify: `resources/chat/chat.js`
- Modify: `resources/chat/chat.css`

- [ ] **Step 1: Render suggestion chips below last assistant message**

Find `endStreaming()` (line ~504). After `DOM.stopBtn.classList.remove('visible')`, add:

```js
  bridge.promptSuggestion.connect(suggestion => {
    if (!suggestion) return;
    // Remove any existing chips
    DOM.messages.querySelectorAll('.suggestion-chips').forEach(el => el.remove());
    const lastAsst = [...DOM.messages.querySelectorAll('[data-msg-id]')].reverse()
      .find(el => el.classList.contains('msg-assistant'));
    if (!lastAsst) return;
    const chips = document.createElement('div');
    chips.className = 'suggestion-chips';
    const chip = document.createElement('button');
    chip.className = 'suggestion-chip';
    chip.textContent = `→ ${suggestion}`;
    chip.addEventListener('click', () => {
      DOM.textarea.value = suggestion;
      DOM.textarea.focus();
      chips.remove();
    });
    chips.appendChild(chip);
    lastAsst.appendChild(chips);
  });
```

Add CSS:
```css
/* ── Prompt suggestions ────────────────────────────────────────────────────── */
.suggestion-chips {
  display: flex; gap: 8px; padding: 8px 0; flex-wrap: wrap;
}
.suggestion-chip {
  background: var(--bg-surface); border: 1px solid var(--border);
  color: var(--text-muted); border-radius: 16px; padding: 4px 12px;
  font-size: 12px; cursor: pointer; transition: border-color 0.15s;
}
.suggestion-chip:hover { border-color: var(--accent); color: var(--accent); }
```

- [ ] **Step 2: Build and verify**

```bash
cd build && cmake --build . --parallel $(sysctl -n hw.ncpu) 2>&1 | tail -5
```

Expected: `[100%] Built target ClaudianQt`

- [ ] **Step 3: Commit**

```bash
git add resources/chat/chat.css resources/chat/chat.js
git commit -m "feat: render clickable prompt suggestion chips after response"
```

---

## Task 7: Compact boundary separator

**Files:**
- Modify: `resources/chat/chat.js`
- Modify: `resources/chat/chat.css`

- [ ] **Step 1: Inject compact separator into message list**

Find `bridge.turnComplete.connect(...)` in `wireEvents()` or the `endStreaming()` area. Add after it:

```js
  bridge.compactBoundary.connect(json => {
    const data = JSON.parse(json);
    const { preTokens, postTokens, durationMs, trigger } = data;
    const fmt = n => n >= 1000 ? (n / 1000).toFixed(0) + 'k' : String(n);
    const label = `— context compacted (${fmt(preTokens)} → ${fmt(postTokens)} tokens, ${((durationMs || 0) / 1000).toFixed(1)}s${trigger === 'manual' ? ', manual' : ''}) —`;
    const sep = document.createElement('div');
    sep.className = 'compact-separator';
    sep.textContent = label;
    DOM.messages.appendChild(sep);
    DOM.messages.scrollTop = DOM.messages.scrollHeight;
  });
```

Add CSS:
```css
/* ── Compact boundary separator ─────────────────────────────────────────────── */
.compact-separator {
  text-align: center; color: var(--text-faint); font-size: 11px;
  padding: 8px 16px; margin: 4px 0;
}
```

- [ ] **Step 2: Build and verify**

```bash
cd build && cmake --build . --parallel $(sysctl -n hw.ncpu) 2>&1 | tail -5
```

Expected: `[100%] Built target ClaudianQt`

- [ ] **Step 3: Commit**

```bash
git add resources/chat/chat.css resources/chat/chat.js
git commit -m "feat: show compact boundary separator when context is compacted"
```

---

## Self-Review

### Spec Coverage

| Requirement | Task |
|-------------|------|
| Tool elapsed time (SDKToolProgressMessage) | Task 3 |
| Rate limit banner (SDKRateLimitEvent) | Task 4 |
| Fast mode indicator (fast_mode_state) | Task 5 |
| Prompt suggestions (SDKPromptSuggestionMessage) | Task 6 |
| Compact boundary separator (SDKCompactBoundaryMessage) | Task 7 |
| All 5 event types in daemon protocol | Task 1 |
| All 5 signals wired through C++ bridge | Task 2 |

### Placeholder Scan

- No TBD or TODO
- Each step shows exact file paths with line references
- All TypeScript types shown for event shapes
- C++ signal signatures given in full
- JS signal connection callbacks shown inline

### Type Consistency

- `toolProgress(id, name, elapsedSeconds)` — `id` is `QString`, `name` is `QString`, `elapsedSeconds` is `double`
- `rateLimit(json)` — JSON string passed through; parsed in JS
- `fastModeStateChanged(state)` — `"off" | "cooldown" | "on"` passed as `QString`, matched in `syncFastMode()`
- `promptSuggestion(suggestion)` — plain string
- `compactBoundary(json)` — JSON string passed through; parsed in JS
- `tc.elapsedSeconds` on tool call state — `number | undefined`, formatted with `.toFixed(1)`