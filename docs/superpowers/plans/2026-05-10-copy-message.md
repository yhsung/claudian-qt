# Copy Entire Message Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a hover-reveal "Copy" button on both user bubbles and assistant messages, matching the existing `.msg-regenerate` pattern used on assistant messages.

**Architecture:** Insert a Copy button into the `.msg-user` and `.msg-assistant` outer elements via `renderMessage()`. The button calls `copyToClipboard(msg.content)` and shows a "Copied!" toast. Visibility is handled by CSS `opacity` transition on hover of the message container.

**Tech Stack:** Vanilla JS (ES6), CSS3, existing `copyToClipboard()` and `showToast()` helpers

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `resources/chat/chat.js` | Copy button in `renderMessage()`, `copyMsgContent()` helper |
| Modify | `resources/chat/chat.css` | Copy button positioning and hover-reveal animation |

---

## Task 1: Copy button in renderMessage()

**Files:**
- Modify: `resources/chat/chat.js:269-313`

- [ ] **Step 1: Add copyMsgContent() helper before renderMessage()**

Find `renderMessage()` (line ~269). Before it, add:

```js
// ── Message copy ─────────────────────────────────────────────────────────────
function copyMsgContent(msg, btnEl) {
  const text = msg.content || '';
  copyToClipboard(text);
  // Change button label briefly to confirm
  const original = btnEl.textContent;
  btnEl.textContent = '✓';
  setTimeout(() => { btnEl.textContent = original; }, 1500);
}
```

- [ ] **Step 2: Update renderMessage() for user bubbles**

In `renderMessage()`, find the user bubble section (lines 279–282):

```js
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.textContent = msg.content;
    outer.appendChild(bubble);
```

Replace with:

```js
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.textContent = msg.content;
    outer.appendChild(bubble);

    // Copy button (user messages)
    const copyBtn = document.createElement('button');
    copyBtn.className = 'msg-copy-btn';
    copyBtn.title = 'Copy message';
    copyBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    copyBtn.addEventListener('click', (e) => { e.stopPropagation(); copyMsgContent(msg, copyBtn); });
    outer.appendChild(copyBtn);
```

- [ ] **Step 3: Update renderMessage() for assistant messages**

In the `} else {` branch (after `outer.className = 'msg-assistant';`), find after `contentDiv` is appended:

```js
    outer.appendChild(contentDiv);
    if (msg.toolCalls && msg.toolCalls.length > 0 && state.viewMode !== 'summary') {
```

Insert the copy button before the tool calls check:

```js
    outer.appendChild(contentDiv);

    // Copy button (assistant messages)
    const copyBtn = document.createElement('button');
    copyBtn.className = 'msg-copy-btn';
    copyBtn.title = 'Copy message';
    copyBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    copyBtn.addEventListener('click', (e) => { e.stopPropagation(); copyMsgContent(msg, copyBtn); });
    outer.appendChild(copyBtn);

    if (msg.toolCalls && msg.toolCalls.length > 0 && state.viewMode !== 'summary') {
```

- [ ] **Step 4: Build and verify**

```bash
cd build && cmake --build . --parallel $(sysctl -n hw.ncpu) 2>&1 | tail -5
```

Expected: `[100%] Built target ClaudianQt`

- [ ] **Step 5: Commit**

```bash
git add resources/chat/chat.js
git commit -m "feat: add copy button to user and assistant message bubbles"
```

---

## Task 2: CSS for hover-reveal copy button

**Files:**
- Modify: `resources/chat/chat.css`

- [ ] **Step 1: Add copy button CSS**

Find the `/* ── Scroll-to-bottom FAB ── */` comment (or any appropriate place near message styles). Add the copy button styles:

```css
/* ── Message copy button ──────────────────────────────────────────────────── */
.msg-copy-btn {
  position: absolute;
  top: 6px;
  right: 6px;
  background: transparent;
  border: none;
  color: var(--text-faint);
  cursor: pointer;
  padding: 4px;
  border-radius: var(--radius-sm);
  opacity: 0;
  transition: opacity 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}
.msg-user, .msg-assistant {
  position: relative;
}
.msg-user:hover .msg-copy-btn,
.msg-assistant:hover .msg-copy-btn {
  opacity: 1;
}
.msg-copy-btn:hover {
  color: var(--text-muted);
  background: var(--bg-surface);
}
```

- [ ] **Step 2: Build and verify**

```bash
cd build && cmake --build . --parallel $(sysctl -n hw.ncpu) 2>&1 | tail -5
```

Expected: `[100%] Built target ClaudianQt`

- [ ] **Step 3: Commit**

```bash
git add resources/chat/chat.css
git commit -m "feat: add hover-reveal copy button CSS for message bubbles"
```

---

## Self-Review

### Spec Coverage

| Requirement | Task |
|-------------|------|
| Copy button on `.msg-user` | Task 1 Step 2 |
| Copy button on `.msg-assistant` | Task 1 Step 3 |
| Hover-reveal animation | Task 2 |
| Button shows ✓ briefly on click | Task 1 Step 1 (`copyMsgContent`) |
| Icon uses existing SVG (clipboard icon) | Task 1 Step 2+3 |
| Does not block message interaction | Task 1 Step 2+3 (`e.stopPropagation()`) |

### Placeholder Scan

- No TBD or TODO
- Full CSS properties given with exact values
- `copyMsgContent` function shown in full
- `renderMessage` changes shown with exact old→new code
- SVG icon inlined so no external asset needed

### Type Consistency

- `copyMsgContent(msg, btnEl)` — `msg` is the message object from `state.messages`, `btnEl` is the button element
- `copyToClipboard(text)` already exists — called with `msg.content || ''`
- `btnEl.textContent = '✓'` temporarily changes button label — `original` captures and restores via `setTimeout`
- Button positioned `absolute` inside `position: relative` message container — correct CSS stacking
- `e.stopPropagation()` ensures clicking copy does not trigger message click handlers