# Streaming UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real-time streaming UX to the Qt chat UI — animated typing indicator, Stop button, auto-scroll, and input lock — so users can see Claude responding token by token.

**Architecture:** All changes live in `resources/chat/index.html`. The Claudian plugin (`main.js`) already receives tokens one-by-one via `QtBridgeService.query()` and renders them incrementally. We wrap `query()` to hook the streaming lifecycle, then show/hide indicator + stop button and auto-scroll via a `MutationObserver`. No C++, no TypeScript bridge changes required.

**Tech Stack:** Vanilla JS (ES6), CSS3 animations, `MutationObserver`, QWebChannel JS bridge

---

## How the streaming pipeline works (context for implementers)

```
User submits message
  → Claudian plugin calls qtService.query(prompt)         ← we WRAP this
  → QtBridgeService.sendMessage() fires to bridge
  → C++ BridgeDaemon sends { type: "send" } to daemon.js
  → daemon.js calls SDK query(), streams events
  → each event hits bridge.textReady / turnComplete signals
  → QtBridgeService enqueues chunks, query() yields them
  → Claudian plugin renders each chunk in the DOM
```

We hook at the `query()` wrapper to detect stream start/end. We watch `bridge.textReady` to detect first token (to switch from "thinking" to "writing" state). We observe DOM mutations on `.claudian-messages` to auto-scroll.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `resources/chat/index.html` (CSS `<style>` block) | Add streaming indicator, stop button, disabled-input styles |
| Modify | `resources/chat/index.html` (HTML body) | Add `#qt-typing-indicator` div and `#qt-stop-btn` button |
| Modify | `resources/chat/index.html` (QWebChannel JS bootstrap) | Streaming state machine, `query()` wrapper, auto-scroll observer |

---

## Task 1: Add streaming CSS

**Files:**
- Modify: `resources/chat/index.html` — append to the `<style>` block (before `</style>`)

- [ ] **Step 1: Open index.html and find the end of the `<style>` block**

The `<style>` block ends around line 231 with `</style>`. Insert the new CSS rules immediately before `</style>`.

- [ ] **Step 2: Add the streaming CSS rules**

Insert before `</style>` on line 231:

```css
    /* ── Streaming UX ─────────────────────────────────────────────────── */
    /* Typing indicator — three bouncing dots shown before first token */
    #qt-typing-indicator {
      display: none;
      align-items: center;
      gap: 5px;
      padding: 6px 16px;
      flex-shrink: 0;
    }
    #qt-typing-indicator.visible { display: flex; }
    .qt-typing-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--text-muted, #8e8e93);
      animation: qt-bounce 1.2s ease-in-out infinite;
    }
    .qt-typing-dot:nth-child(2) { animation-delay: 0.2s; }
    .qt-typing-dot:nth-child(3) { animation-delay: 0.4s; }
    @keyframes qt-bounce {
      0%, 60%, 100% { transform: translateY(0);   opacity: 0.35; }
      30%           { transform: translateY(-5px); opacity: 1;    }
    }
    .qt-typing-label {
      font-size: 11px;
      color: var(--text-faint, #636366);
      margin-left: 2px;
    }
    /* Stop button — hidden by default, shown only while streaming */
    #qt-stop-btn {
      display: none;
      background: transparent;
      border: 1px solid var(--color-red, #ff453a);
      color: var(--color-red, #ff453a);
      cursor: pointer;
      padding: 3px 9px;
      border-radius: 5px;
      font-size: 11px;
      white-space: nowrap;
      flex-shrink: 0;
    }
    #qt-stop-btn.visible { display: block; }
    #qt-stop-btn:hover   { background: var(--background-modifier-error, #3d1f1f); }
    /* Dim the send button and textarea while streaming */
    .qt-send-btn.disabled   { opacity: 0.35; pointer-events: none; }
    .claudian-input textarea { transition: opacity 0.15s; }
    .qt-input-locked .claudian-input textarea { opacity: 0.5; pointer-events: none; }
```

- [ ] **Step 3: Verify no CSS syntax errors**

Build and launch the app — the page should load without console errors about CSS.

```bash
cmake --build /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt/build --parallel $(sysctl -n hw.ncpu) 2>&1 | tail -5
```

Expected: `[100%] Built target ClaudianQt` — no errors.

- [ ] **Step 4: Commit**

```bash
git -C /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt add resources/chat/index.html
git -C /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt commit -m "feat(streaming): add streaming UX CSS — indicator, stop button, input lock"
```

---

## Task 2: Add HTML elements for indicator and stop button

**Files:**
- Modify: `resources/chat/index.html` — HTML body, two insertions

The typing indicator sits between `#qt-toolbar-wrapper` and `#claudian-root` so it pushes the chat area down in-flow (same pattern as `#qt-history-panel`).

The stop button is inserted into `#qt-toolbar` next to the existing buttons.

- [ ] **Step 1: Add `#qt-stop-btn` to the toolbar HTML**

Find this line (around line 250):
```html
    <button id="qt-pick-btn">Open Folder</button>
```

Add the stop button immediately before `qt-pick-btn`:
```html
    <button id="qt-stop-btn" title="Stop generation">Stop</button>
    <button id="qt-pick-btn">Open Folder</button>
```

- [ ] **Step 2: Add `#qt-typing-indicator` between toolbar wrapper and claudian-root**

Find this line (around line 261):
```html
<div id="claudian-root"></div>
```

Insert the typing indicator immediately before it:
```html
<div id="qt-typing-indicator">
  <div class="qt-typing-dot"></div>
  <div class="qt-typing-dot"></div>
  <div class="qt-typing-dot"></div>
  <span class="qt-typing-label">Claude is thinking…</span>
</div>

<div id="claudian-root"></div>
```

- [ ] **Step 3: Build and verify elements appear in DOM**

```bash
cmake --build /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt/build --parallel $(sysctl -n hw.ncpu) 2>&1 | tail -5
```

Launch app. Open DevTools (`http://localhost:9222`). In console:
```javascript
document.getElementById('qt-stop-btn')        // should be a button element
document.getElementById('qt-typing-indicator') // should be a div element
```

Expected: Both elements found. Neither visible yet (CSS `display:none`).

- [ ] **Step 4: Commit**

```bash
git -C /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt add resources/chat/index.html
git -C /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt commit -m "feat(streaming): add typing indicator and stop button HTML elements"
```

---

## Task 3: Streaming state machine and query() wrapper

**Files:**
- Modify: `resources/chat/index.html` — QWebChannel bootstrap JS (inside the `new QWebChannel(...)` callback)

This is the core task. We:
1. Define `onStreamingStart()`, `onFirstToken()`, `onStreamingEnd()` state transitions
2. Wrap `qtService.query()` to trigger start/end
3. Connect `bridge.textReady` to trigger first-token detection
4. Wire the stop button to `qtService.abort()`

- [ ] **Step 1: Find the injection point in the bootstrap JS**

The `qtService` is created and injected in the bootstrap. Find this block (around line 653):
```javascript
    const qtService = new QtBridgeService(bridge);

    function injectIntoActiveTab() {
```

- [ ] **Step 2: Insert the streaming state machine immediately after `const qtService = new QtBridgeService(bridge);`**

Insert this block between `const qtService = new QtBridgeService(bridge);` and `function injectIntoActiveTab()`:

```javascript
    // ── Streaming state machine ───────────────────────────────────────
    const typingIndicator = document.getElementById('qt-typing-indicator');
    const stopBtn         = document.getElementById('qt-stop-btn');
    let isStreaming        = false;
    let firstTokenSeen     = false;

    function onStreamingStart() {
      isStreaming    = true;
      firstTokenSeen = false;
      typingIndicator.classList.add('visible');
      stopBtn.classList.add('visible');
      document.body.classList.add('qt-input-locked');
      const sendBtnEl = document.querySelector('.qt-send-btn');
      if (sendBtnEl) sendBtnEl.classList.add('disabled');
    }

    function onFirstToken() {
      if (firstTokenSeen) return;
      firstTokenSeen = true;
      typingIndicator.classList.remove('visible');
    }

    function onStreamingEnd() {
      isStreaming = false;
      typingIndicator.classList.remove('visible');
      stopBtn.classList.remove('visible');
      document.body.classList.remove('qt-input-locked');
      const sendBtnEl = document.querySelector('.qt-send-btn');
      if (sendBtnEl) sendBtnEl.classList.remove('disabled');
    }

    // Detect first token to switch "thinking" → "writing" state
    bridge.textReady.connect(() => { if (isStreaming) onFirstToken(); });

    // Clean up if bridge signals complete/error before the generator finishes
    bridge.turnComplete.connect(() => { if (isStreaming) onStreamingEnd(); });
    bridge.errorOccurred.connect(() => { if (isStreaming) onStreamingEnd(); });

    // Wrap qtService.query() to hook lifecycle
    const _origQuery = qtService.query.bind(qtService);
    qtService.query = async function*(prompt, images, history, opts) {
      onStreamingStart();
      try {
        for await (const chunk of _origQuery(prompt, images, history, opts)) {
          yield chunk;
        }
      } catch (err) {
        throw err;
      } finally {
        // Ensure clean-up even if generator is aborted early
        if (isStreaming) onStreamingEnd();
      }
    };

    // Wire stop button
    stopBtn.addEventListener('click', () => {
      qtService.abort();
    });
```

- [ ] **Step 3: Build and test**

```bash
cmake --build /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt/build --parallel $(sysctl -n hw.ncpu) 2>&1 | tail -5
```

Launch app. Send a message. Verify:
- Typing indicator + dots appear immediately after sending
- Dots disappear when first token arrives
- "Stop" button appears in toolbar during streaming
- "Stop" button disappears when response completes
- Send button is dimmed during streaming
- Input textarea is unresponsive during streaming (pointer-events: none)
- Clicking "Stop" mid-stream halts the response

- [ ] **Step 4: Commit**

```bash
git -C /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt add resources/chat/index.html
git -C /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt commit -m "feat(streaming): streaming state machine — indicator, stop button, input lock"
```

---

## Task 4: Auto-scroll during streaming

**Files:**
- Modify: `resources/chat/index.html` — QWebChannel bootstrap JS (append after the streaming state machine block)

Auto-scroll: as tokens arrive and the DOM changes, scroll the messages container to the bottom — but only if the user hasn't scrolled up (so we don't override intentional scrolling).

- [ ] **Step 1: Find the insertion point**

Find the `stopBtn.addEventListener('click', ...)` block you added in Task 3. Insert the auto-scroll code immediately after it.

- [ ] **Step 2: Insert the MutationObserver auto-scroll block**

```javascript
    // ── Auto-scroll during streaming ──────────────────────────────────
    // Set up observer lazily (`.claudian-messages` may not exist yet)
    let scrollObserver = null;

    function setupAutoScroll() {
      if (scrollObserver) return;
      const msgContainer = document.querySelector('.claudian-messages');
      if (!msgContainer) return;

      scrollObserver = new MutationObserver(() => {
        if (!isStreaming) return;
        // Only auto-scroll if user is already near the bottom (within 120px)
        const { scrollTop, scrollHeight, clientHeight } = msgContainer;
        const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
        if (distanceFromBottom < 120) {
          msgContainer.scrollTop = scrollHeight;
        }
      });

      scrollObserver.observe(msgContainer, {
        childList:     true,
        subtree:       true,
        characterData: true,
      });
    }

    // Try immediately; if not found, retry once after a short delay
    setupAutoScroll();
    setTimeout(setupAutoScroll, 500);
```

- [ ] **Step 3: Build and test**

```bash
cmake --build /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt/build --parallel $(sysctl -n hw.ncpu) 2>&1 | tail -5
```

Launch app. Send a long prompt (e.g. `"Write me a 10-paragraph story"`). Verify:
1. The chat scrolls automatically as tokens arrive
2. If you manually scroll up mid-stream, the auto-scroll stops overriding
3. Scrolling back down (within 120px of bottom) resumes auto-scroll

Also verify the short-conversation case: send `"Say hello"` — the response fits without scroll, no errors.

- [ ] **Step 4: Commit**

```bash
git -C /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt add resources/chat/index.html
git -C /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt commit -m "feat(streaming): auto-scroll messages container during streaming"
```

---

## Task 5: Edge case hardening + Enter-key guard

**Files:**
- Modify: `resources/chat/index.html` — small additions to the streaming state machine

Two edge cases to handle:
1. If the user presses Enter while `isStreaming`, we should swallow the submit to prevent double-sends (the Claudian plugin's input controller may still handle keydown independently of our input lock)
2. If the app is closed/refreshed mid-stream, `isStreaming` should reset cleanly (it does since JS state is lost on reload — no action needed)

- [ ] **Step 1: Add Enter-key guard on the input container**

Find the auto-scroll block you added. Insert after `setTimeout(setupAutoScroll, 500);`:

```javascript
    // ── Enter-key guard during streaming ─────────────────────────────
    // Belt-and-suspenders: prevent submit keydown while streaming
    // even if pointer-events lock doesn't fully stop the Claudian plugin.
    document.addEventListener('keydown', (e) => {
      if (!isStreaming) return;
      if (e.key === 'Enter' && !e.shiftKey) {
        const active = document.activeElement;
        const isInInput = active && (
          active.tagName === 'TEXTAREA' ||
          active.closest('.claudian-input-container')
        );
        if (isInInput) {
          e.stopImmediatePropagation();
          e.preventDefault();
        }
      }
    }, true); // capture phase — runs before Claudian plugin's listener
```

- [ ] **Step 2: Build and test Enter guard**

```bash
cmake --build /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt/build --parallel $(sysctl -n hw.ncpu) 2>&1 | tail -5
```

Launch app. Start a long stream. While streaming, click the input and press Enter repeatedly. Verify:
- No second message is submitted while streaming is active
- After `turn_complete`, Enter works normally again

- [ ] **Step 3: Commit**

```bash
git -C /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt add resources/chat/index.html
git -C /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt commit -m "feat(streaming): add Enter-key guard to prevent double-submit during streaming"
```

---

## Self-Review

### Spec Coverage

| Requirement | Task |
|-------------|------|
| Show text as it arrives (Claudian plugin already does this) | Already working |
| Typing indicator before first token | Task 2+3 |
| Stop button during streaming | Task 2+3 |
| Auto-scroll as tokens arrive | Task 4 |
| Input locked during streaming | Task 3 |
| Prevent double-submit via Enter | Task 5 |

### Placeholder Scan

- All CSS rules are complete with exact property values
- All JS functions are fully implemented (no `// TODO`)
- All test steps describe exact observable behaviors
- No "similar to Task N" shortcuts

### Type Consistency

- `isStreaming` is a `boolean` — set `true` in `onStreamingStart()`, `false` in `onStreamingEnd()`
- `firstTokenSeen` is a `boolean` — reset in `onStreamingStart()`, set in `onFirstToken()`
- `qtService.query` is wrapped and assigns to itself — the `_origQuery` binding preserves `this` context correctly
- `scrollObserver` is `MutationObserver | null` — set once in `setupAutoScroll()`, never reset
- `bridge.turnComplete` is already connected to `QtBridgeService._onDone` (Task 3 adds a second listener for `onStreamingEnd` — this is fine, both run)
- `bridge.errorOccurred` same pattern — dual listener, both run on error

### Potential Issue: Double `onStreamingEnd` call

`bridge.turnComplete` is connected both inside `QtBridgeService` (which enqueues `{ type: 'done' }` to end the generator) AND in Task 3 (`bridge.turnComplete.connect(() => { if (isStreaming) onStreamingEnd(); })`). The `if (isStreaming)` guard prevents double-execution of `onStreamingEnd()`. The `finally` block in the wrapped generator also calls `onStreamingEnd()` guarded by `if (isStreaming)`. Together: the first call sets `isStreaming = false`, subsequent calls are no-ops. ✓
