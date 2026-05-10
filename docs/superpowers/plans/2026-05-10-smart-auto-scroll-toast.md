# Smart Auto-Scroll + Toast Notifications

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop auto-scroll from fighting the user when they scroll up to read during streaming; add a `showToast()` helper and wire it to copy, delete, and export feedback.

**Architecture:** Track `state._userScrolled` boolean; only auto-scroll if user is within 120px of bottom. Add a floating "↓" FAB visible only when detached. Create a `showToast(msg)` helper that appends a `.toast-visible` div and auto-removes it; wire to clipboard copy, session delete, and export success.

**Tech Stack:** Vanilla JS (ES6), CSS3, existing `flushStreamBuffer()` / toast CSS

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `resources/chat/chat.js` | `state._userScrolled`, smart `flushStreamBuffer()`, scroll FAB, `showToast()` |
| Modify | `resources/chat/chat.css` | Scroll FAB positioning and animation |
| Modify | `resources/chat/index.html` | Scroll FAB button element |

---

## Task 1: Smart auto-scroll

**Files:**
- Modify: `resources/chat/chat.js:385-397`

- [ ] **Step 1: Add `_userScrolled` to state**

Find `state` object (line ~4). Add `_userScrolled: false,` after `_rafPending: false,`:

```js
const state = {
  // ... existing fields ...
  _rafPending: false,
  _streamBuffer: '',
  _userScrolled: false,
  // ...
```

- [ ] **Step 2: Update flushStreamBuffer() with user-scroll guard**

Replace `flushStreamBuffer()` (lines 385–397) with this version:

```js
function flushStreamBuffer() {
  state._rafPending = false;
  if (!state.currentMsgId) return;
  const msgEl = DOM.messages.querySelector(`[data-msg-id="${state.currentMsgId}"]`);
  if (!msgEl) return;
  const contentDiv = msgEl.querySelector('.msg-content');
  if (contentDiv) {
    contentDiv.innerHTML = window.marked.parse(state._streamBuffer);
    postProcessCodeBlocks(contentDiv);
  }
  // Smart auto-scroll: only scroll if user hasn't scrolled up
  const { scrollTop, scrollHeight, clientHeight } = DOM.messages;
  const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
  if (distanceFromBottom < 120) {
    DOM.messages.scrollTop = scrollHeight;
    state._userScrolled = false;
  }
}
```

- [ ] **Step 3: Track user-initiated scroll**

Find `renderMessages()` (line ~315). After the initial `DOM.messages.scrollTop = DOM.messages.scrollHeight;` add a listener that sets `_userScrolled = true` when the user scrolls away from bottom:

```js
function renderMessages() {
  if (state.viewMode === 'summary') { showSummaryView(); return; }
  hideSummaryView();
  DOM.messages.innerHTML = '';
  state.messages.forEach(msg => DOM.messages.appendChild(renderMessage(msg)));
  applyFontSize();
  DOM.messages.scrollTop = DOM.messages.scrollHeight;
  state._userScrolled = false;
  DOM.messages.addEventListener('scroll', onUserScroll, { passive: true });
}
```

Then add the `onUserScroll` handler after `renderMessages()`:

```js
function onUserScroll() {
  if (!state.currentMsgId) return;
  const { scrollTop, scrollHeight, clientHeight } = DOM.messages;
  const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
  state._userScrolled = distanceFromBottom >= 120;
}
```

- [ ] **Step 4: Build and verify**

```bash
cd build && cmake --build . --parallel $(sysctl -n hw.ncpu) 2>&1 | tail -5
```

Expected: `[100%] Built target ClaudianQt`

- [ ] **Step 5: Commit**

```bash
git add resources/chat/chat.js
git commit -m "feat: smart auto-scroll — skip when user scrolled up"
```

---

## Task 2: Floating scroll-to-bottom FAB

**Files:**
- Modify: `resources/chat/index.html:73-74`
- Modify: `resources/chat/chat.css`
- Modify: `resources/chat/chat.js`

- [ ] **Step 1: Add scroll-FAB button to index.html**

Find the `#messages` div (line 73). Add the FAB immediately after it:

```html
    <div id="messages" class="fs-md"></div>

    <button id="scroll-to-bottom" title="Scroll to bottom">↓</button>

    <div id="summary-view">
```

- [ ] **Step 2: Add scroll-FAB CSS**

Find `/* ── Toast notification ── */` in `chat.css` (line ~594). Insert before it:

```css
/* ── Scroll-to-bottom FAB ─────────────────────────────────────────────────── */
#scroll-to-bottom {
  display: none;
  position: fixed;
  bottom: 80px;
  right: 24px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  border: none;
  font-size: 18px;
  cursor: pointer;
  z-index: 500;
  box-shadow: 0 2px 8px rgba(0,0,0,0.4);
  transition: opacity 0.2s, transform 0.2s;
}
#scroll-to-bottom.visible {
  display: flex;
  align-items: center;
  justify-content: center;
}
#scroll-to-bottom:hover { background: var(--accent-hover); }
```

- [ ] **Step 3: Wire scroll-FAB in JS**

Find `initDOM()` and add the FAB reference:

```js
scrollToBottomBtn: document.getElementById('scroll-to-bottom'),
```

Find `onUserScroll()` and add FAB visibility logic. Replace the `onUserScroll` body with:

```js
function onUserScroll() {
  if (!state.currentMsgId) return;
  const { scrollTop, scrollHeight, clientHeight } = DOM.messages;
  const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
  state._userScrolled = distanceFromBottom >= 120;
  if (DOM.scrollToBottomBtn) {
    DOM.scrollToBottomBtn.classList.toggle('visible', state._userScrolled);
  }
}
```

Find `wireEvents()` in `chat.js`. After `DOM.sidebarToggle` line, add:

```js
DOM.scrollToBottomBtn.addEventListener('click', () => {
  DOM.messages.scrollTop = DOM.messages.scrollHeight;
  state._userScrolled = false;
  DOM.scrollToBottomBtn.classList.remove('visible');
});
```

Also add `DOM.scrollToBottomBtn.classList.remove('visible')` inside `startStreaming()` (line ~489) to hide it when a new message begins.

- [ ] **Step 4: Build and verify**

```bash
cd build && cmake --build . --parallel $(sysctl -n hw.ncpu) 2>&1 | tail -5
```

Launch and send a long prompt. While streaming, manually scroll up — verify the FAB appears. Click the FAB — verify it scrolls to bottom and hides.

- [ ] **Step 5: Commit**

```bash
git add resources/chat/index.html resources/chat/chat.css resources/chat/chat.js
git commit -m "feat: floating scroll-to-bottom FAB"
```

---

## Task 3: showToast() helper and feedback wiring

**Files:**
- Modify: `resources/chat/chat.js:356-362`

- [ ] **Step 1: Add showToast() helper after copyToClipboard()**

Find `copyToClipboard()` (line ~354). After its closing `}`, add:

```js
// ── Toast helper ────────────────────────────────────────────────────────────
function showToast(msg, duration = 2500) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast-visible'));
  setTimeout(() => {
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}
```

- [ ] **Step 2: Wire copy-message toasts**

The existing `postProcessCodeBlocks()` adds a Copy button to code blocks that calls `copyToClipboard()` — no user feedback is given. Find the Copy button in `postProcessCodeBlocks()` (look for `btn.addEventListener('click', ...)` around line 371). Update the click handler:

```js
btn.addEventListener('click', () => {
  copyToClipboard(pre.textContent || '');
  showToast('Copied!');
});
```

For message-level copy (not in plan yet), wire in the next task.

- [ ] **Step 3: Build and verify**

```bash
cd build && cmake --build . --parallel $(sysctl -n hw.ncpu) 2>&1 | tail -5
```

Launch. Copy a code block. Verify toast appears and disappears.

- [ ] **Step 4: Commit**

```bash
git add resources/chat/chat.js
git commit -m "feat: showToast helper — wired to code block copy"
```

---

## Task 4: Wire toasts for session delete and export

**Files:**
- Modify: `resources/chat/chat.js`

- [ ] **Step 1: Find and update delete session handler**

Find the session delete click handler (search for `session-delete-btn` or `unlink` or `deleteSession`). The delete button fires `bridge.deleteSession(id)`. The bridge emits `sessionsListed` after delete — no explicit callback. Find where `bridge.deleteSession` is called (look for `.deleteSession`).

The code that handles session deletion likely has no toast. After identifying where `bridge.deleteSession(id)` is called, wrap it:

```js
// The bridge deleteSession call — after it:
showToast('Session deleted');
```

Or if it uses a callback/handler in `wireEvents()`, find the `bridge.deleteSession` call and add `showToast('Session deleted')` after it.

- [ ] **Step 2: Find and update export feedback**

Find `exportTranscript()` function (~line 797). It calls `bridge.exportTranscript()`. The `bridge.fileWritten` signal (already wired at ~line 1210) shows a toast on success — verify it exists and covers export. If it does, export is already covered. If not, add `showToast('Transcript saved')` after `bridge.exportTranscript()` call.

To verify, check around line 1210:
```js
bridge.fileWritten.connect((success, path) => {
  if (!success) return;
  const name = path.split('/').pop() || 'transcript.md';
  // toast is already shown here — export is covered
```

This is already in the codebase from prior work. No change needed for export.

- [ ] **Step 3: Build and verify**

```bash
cd build && cmake --build . --parallel $(sysctl -n hw.ncpu) 2>&1 | tail -5
```

- [ ] **Step 4: Commit only if changes were made**

If delete or export toasts were added:
```bash
git add resources/chat/chat.js
git commit -m "feat: wire delete-session toast feedback"
```

Otherwise:
```bash
echo "No changes needed — export toast already present, session delete handled differently"
```

---

## Self-Review

### Spec Coverage

| Requirement | Task |
|-------------|------|
| Smart auto-scroll (don't fight user) | Task 1 |
| Scroll-to-bottom FAB when user scrolled up | Task 2 |
| Toast helper `showToast(msg)` | Task 3 |
| Copy code block → toast | Task 3 Step 2 |
| Session delete → toast | Task 4 |
| Export → toast (already present, verified) | Task 4 Step 2 |

### Placeholder Scan

- No TBD, TODO, or "implement later" in any step
- All `flushStreamBuffer()` logic spelled out with exact variable names
- `showToast()` function signature given with exact parameter names
- `onUserScroll()` handler defined completely
- FAB listener and CSS all complete

### Type Consistency

- `state._userScrolled` is a `boolean` — set by `onUserScroll()`, checked in `flushStreamBuffer()`
- `showToast(msg, duration)` — `msg` is `string`, `duration` is `number`
- FAB `DOM.scrollToBottomBtn` referenced consistently across Tasks 2 and 3
- `distanceFromBottom` threshold of 120px is consistent (same value used in `flushStreamBuffer()` and `onUserScroll()`)

### Verification

All tasks are independently testable:
- Task 1: Send a long message, manually scroll up during streaming, verify auto-scroll does not fight
- Task 2: Scroll up mid-stream, verify FAB appears; click FAB, verify scroll + hide
- Task 3: Copy a code block, verify toast appears and disappears
- Task 4: Delete a session, verify toast appears