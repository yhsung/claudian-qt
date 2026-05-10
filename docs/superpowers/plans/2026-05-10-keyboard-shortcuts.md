# Keyboard Shortcuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `↑/↓` to navigate between messages, `⌘K` to focus the input textarea, and `⌘N` to start a new session.

**Architecture:** Add a global `keydown` listener (already exists at line 1148) that handles shortcut routing. Message navigation uses the existing `state.messages` array and `DOM.messages` DOM references. When a message is focused, a subtle highlight ring appears on its left border.

**Tech Stack:** Vanilla JS (ES6), no dependencies

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `resources/chat/chat.js` | Message nav state, focused message tracking, `⌘K`/`⌘N`/`↑/↓` handlers |
| Modify | `resources/chat/chat.css` | Focused message ring highlight |

---

## Task 1: Message navigation state

**Files:**
- Modify: `resources/chat/chat.js:4-26`

- [ ] **Step 1: Add focused-message state**

Find the `state` object. Add `_focusedMsgIdx: -1,` after `_lastPrompt: null,`:

```js
  _lastPrompt: null,
  _focusedMsgIdx: -1,
  pendingAttachments: [],
```

- [ ] **Step 2: Add `clearFocusedMsg()` helper after renderMessages()**

Find `renderMessages()` (line ~315). After `DOM.messages.scrollTop = DOM.messages.scrollHeight;` add a comment and helper:

```js
  DOM.messages.scrollTop = DOM.messages.scrollHeight;
  state._userScrolled = false;
  DOM.messages.addEventListener('scroll', onUserScroll, { passive: true });
}

// ── Message focus ────────────────────────────────────────────────────────────
function clearFocusedMsg() {
  state._focusedMsgIdx = -1;
  DOM.messages.querySelectorAll('.msg-focused').forEach(el => el.classList.remove('msg-focused'));
}

function focusMsgByIdx(idx) {
  if (!state.messages.length) return;
  idx = Math.max(0, Math.min(idx, state.messages.length - 1));
  clearFocusedMsg();
  state._focusedMsgIdx = idx;
  const msg = state.messages[idx];
  const msgEl = DOM.messages.querySelector(`[data-msg-id="${msg.id}"]`);
  if (msgEl) {
    msgEl.classList.add('msg-focused');
    msgEl.scrollIntoView({ block: 'nearest' });
  }
}
```

- [ ] **Step 3: Build and verify**

```bash
cd build && cmake --build . --parallel $(sysctl -n hw.ncpu) 2>&1 | tail -5
```

Expected: `[100%] Built target ClaudianQt`

- [ ] **Step 4: Commit**

```bash
git add resources/chat/chat.js
git commit -m "feat: add _focusedMsgIdx state and focusMsgByIdx helper"
```

---

## Task 2: ↑/↓ keyboard navigation

**Files:**
- Modify: `resources/chat/chat.js:1148-1157`
- Modify: `resources/chat/chat.css`

- [ ] **Step 1: Find the existing global keydown listener**

Find the existing listener at line 1148:

```js
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
```

- [ ] **Step 2: Add shortcut routing inside the existing listener**

Add the following inside the `keydown` handler, before the `if (e.key === 'Escape')` block. This only activates when focus is NOT in the textarea (so typing `↑` in the input still works normally):

```js
  // Keyboard shortcuts — only when not focused on textarea (so typing ↑/↓ in input is unaffected)
  if (document.activeElement !== DOM.textarea) {
    if (e.key === 'ArrowUp' && state.messages.length) {
      e.preventDefault();
      focusMsgByIdx(state._focusedMsgIdx <= 0 ? state.messages.length - 1 : state._focusedMsgIdx - 1);
      return;
    }
    if (e.key === 'ArrowDown' && state.messages.length) {
      e.preventDefault();
      focusMsgByIdx(state._focusedMsgIdx < 0 ? 0 : Math.min(state._focusedMsgIdx + 1, state.messages.length - 1));
      return;
    }
  }
```

- [ ] **Step 3: Add CSS for the focus ring**

Find the `#image-preview-modal` rule in `chat.css` (around line ~560). Insert the focused-message style before it:

```css
/* ── Focused message highlight ─────────────────────────────────────────────── */
.msg-focused {
  position: relative;
}
.msg-focused::before {
  content: '';
  position: absolute;
  left: -8px;
  top: 4px;
  bottom: 4px;
  width: 3px;
  background: var(--accent);
  border-radius: 2px;
}
```

- [ ] **Step 4: Build and verify**

```bash
cd build && cmake --build . --parallel $(sysctl -n hw.ncpu) 2>&1 | tail -5
```

Launch. Press `↑` — the last message should get a purple left bar and scroll into view. Press `↑` again — moves to second-to-last. Press `↓` — moves forward. When at first message, `↑` wraps to last.

- [ ] **Step 5: Commit**

```bash
git add resources/chat/chat.js resources/chat/chat.css
git commit -m "feat: add ↑/↓ keyboard navigation between messages"
```

---

## Task 3: ⌘K to focus input, ⌘N for new session

**Files:**
- Modify: `resources/chat/chat.js:1148-1157`

- [ ] **Step 1: Add ⌘K and ⌘N to the existing keydown handler**

Find the `keydown` handler again. After the `if ((e.metaKey || e.ctrlKey) && e.key === 'f')` block (around line 1156), add:

```js
  if ((e.metaKey || e.ctrlKey) && e.key === 'f') { e.preventDefault(); openSearch(); }

  // ⌘K — focus the textarea
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    DOM.textarea.focus();
    DOM.textarea.scrollIntoView({ block: 'nearest' });
  }

  // ⌘N — new session (only when not typing in textarea)
  if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
    e.preventDefault();
    DOM.newSessionBtn.click();
  }
```

Note: `⌘K` activates regardless of current focus. `⌘N` should only trigger when textarea is NOT focused (to allow typing "n" in the message field normally).

To make `⌘N` only trigger when not in textarea, update the condition:

```js
  if ((e.metaKey || e.ctrlKey) && e.key === 'n' && document.activeElement !== DOM.textarea) {
    e.preventDefault();
    DOM.newSessionBtn.click();
  }
```

- [ ] **Step 2: Build and verify**

```bash
cd build && cmake --build . --parallel $(sysctl -n hw.ncpu) 2>&1 | tail -5
```

Launch. Press `⌘K` — the textarea should be focused. Press `⌘N` when textarea is not focused — a new session should be started.

- [ ] **Step 3: Commit**

```bash
git add resources/chat/chat.js
git commit -m "feat: add ⌘K focus input and ⌘N new session shortcuts"
```

---

## Self-Review

### Spec Coverage

| Requirement | Task |
|-------------|------|
| `↑` navigate to older message | Task 2 |
| `↓` navigate to newer message | Task 2 |
| Wrap-around (last → first, first → last) | Task 2 |
| Visual focus indicator on current message | Task 2 (CSS) |
| `⌘K` focus textarea | Task 3 |
| `⌘N` new session | Task 3 |
| Does not interfere with typing `↑/↓` in textarea | Task 2 |

### Placeholder Scan

- No TBD or TODO in any step
- All code shown inline, no "similar to X" references
- Step 2 shows exact line numbers and existing code context
- CSS selector `.msg-focused::before` and property values given

### Type Consistency

- `state._focusedMsgIdx` is a `number` — initialized to `-1` (no selection), set to valid indices in `focusMsgByIdx()`
- `clearFocusedMsg()` resets and cleans up both state and DOM class
- `focusMsgByIdx()` bounds `idx` with `Math.max`/`Math.min` before use — no out-of-bounds possible
- The `⌘N` condition correctly excludes textarea from triggering the shortcut