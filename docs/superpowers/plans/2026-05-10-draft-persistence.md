# Draft Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the textarea content in `sessionStorage` keyed by `activeSessionId`, so drafts survive page reloads and session switches.

**Architecture:** On every textarea `input` event, save `textarea.value` to `sessionStorage[activeSessionId]`. On session load (`bridge.sessionHistoryLoaded` or `bridge.sessionReady`), restore the draft if one exists. Clear the draft when the message is sent (in `sendMessage()`).

**Tech Stack:** Vanilla JS (ES6), `sessionStorage` (no external dependencies)

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `resources/chat/chat.js` | Save draft on input, restore on session load, clear on send |

---

## Task 1: Save draft on textarea input

**Files:**
- Modify: `resources/chat/chat.js:1066-1069`

- [ ] **Step 1: Find the existing textarea input handler**

Find the `DOM.textarea.addEventListener('input', ...)` handler (line ~1066):

```js
DOM.textarea.addEventListener('input', () => {
  DOM.textarea.style.height = 'auto';
  DOM.textarea.style.height = Math.min(DOM.textarea.scrollHeight, 200) + 'px';
});
```

- [ ] **Step 2: Add draft save to the input handler**

Replace the existing input handler with:

```js
DOM.textarea.addEventListener('input', () => {
  DOM.textarea.style.height = 'auto';
  DOM.textarea.style.height = Math.min(DOM.textarea.scrollHeight, 200) + 'px';
  saveDraft();
});
```

- [ ] **Step 3: Add saveDraft() function before wireEvents()**

Find `wireEvents()` (line ~1063). Before it, add the draft save function:

```js
// ── Draft persistence ───────────────────────────────────────────────────────
function saveDraft() {
  const sid = state.activeSessionId || 'draft';
  if (DOM.textarea.value.trim()) {
    sessionStorage.setItem(`draft:${sid}`, DOM.textarea.value);
  } else {
    sessionStorage.removeItem(`draft:${sid}`);
  }
}

function restoreDraft() {
  const sid = state.activeSessionId || 'draft';
  const draft = sessionStorage.getItem(`draft:${sid}`);
  if (draft) DOM.textarea.value = draft;
}

function clearDraft() {
  const sid = state.activeSessionId || 'draft';
  sessionStorage.removeItem(`draft:${sid}`);
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
git commit -m "feat: save textarea draft to sessionStorage on input"
```

---

## Task 2: Restore draft on session load

**Files:**
- Modify: `resources/chat/chat.js`

- [ ] **Step 1: Find session history loaded and session ready handlers**

Find `bridge.sessionHistoryLoaded.connect` (search for it). It likely calls `loadSessionHistory()`. Also find `bridge.sessionReady.connect`.

Around lines ~1229–1233:

```js
bridge.sessionReady.connect(id => {
  state.activeSessionId = id;
  // ...
});
```

And `bridge.sessionHistoryLoaded` handler.

- [ ] **Step 2: Add restoreDraft() call**

In the `bridge.sessionHistoryLoaded` handler (after `loadSessionHistory(turns)`), add `restoreDraft()`:

```js
bridge.sessionHistoryLoaded.connect(turns => {
  loadSessionHistory(JSON.parse(turns));
  restoreDraft();
});
```

In `bridge.sessionReady.connect`, after `state.activeSessionId = id;` add `restoreDraft()`:

```js
bridge.sessionReady.connect(id => {
  state.activeSessionId = id;
  restoreDraft();
  // ...existing code...
});
```

Also add `restoreDraft()` in `bridge.loadSession` callback — find where `loadSession` is called in response to sidebar click.

Actually, looking at the session click handler (around line 634):

```js
item.addEventListener('click', () => {
  state.activeSessionId = s.id;
  DOM.sessionList.querySelectorAll('.session-item').forEach(el => el.classList.toggle('active', el.dataset.sid === s.id));
  bridge.loadSession(s.id);
});
```

Add `restoreDraft()` after `bridge.loadSession(s.id)`:

```js
  bridge.loadSession(s.id);
  restoreDraft();
```

- [ ] **Step 3: Build and verify**

```bash
cd build && cmake --build . --parallel $(sysctl -n hw.ncpu) 2>&1 | tail -5
```

Expected: `[100%] Built target ClaudianQt`

- [ ] **Step 4: Commit**

```bash
git add resources/chat/chat.js
git commit -m "feat: restore draft textarea when loading a session"
```

---

## Task 3: Clear draft on send

**Files:**
- Modify: `resources/chat/chat.js`

- [ ] **Step 1: Find sendMessage() and add clearDraft()**

Find `sendMessage()` (around line 560). Look for where the textarea is cleared:

```js
DOM.textarea.value = '';
DOM.textarea.style.height = '';
```

After `DOM.textarea.value = '';`, add `clearDraft();`:

```js
DOM.textarea.value = '';
clearDraft();
DOM.textarea.style.height = '';
```

- [ ] **Step 2: Also clear draft on new session**

Find `DOM.newSessionBtn.addEventListener('click', ...)` (around line 1081). In that handler, after `bridge.newSession()` add `clearDraft()`:

```js
bridge.newSession();
clearDraft();
```

Also clear the textarea value if there is one in the new session handler — find where `state.messages = []` is set and add:

```js
DOM.textarea.value = '';
clearDraft();
```

- [ ] **Step 3: Build and verify**

```bash
cd build && cmake --build . --parallel $(sysctl -n hw.ncpu) 2>&1 | tail -5
```

Expected: `[100%] Built target ClaudianQt`

- [ ] **Step 4: Commit**

```bash
git add resources/chat/chat.js
git commit -m "feat: clear draft textarea on send and new session"
```

---

## Self-Review

### Spec Coverage

| Requirement | Task |
|-------------|------|
| Save draft to sessionStorage on input | Task 1 |
| Restore draft on session load | Task 2 |
| Clear draft on send | Task 3 |
| Clear draft on new session | Task 3 |
| Uses `activeSessionId` as storage key | Task 1 |
| Handles empty draft (removes key, doesn't store empty string) | Task 1 |

### Placeholder Scan

- No TBD or TODO
- All functions defined inline with exact parameter names
- `sessionStorage` API used correctly (`setItem`, `getItem`, `removeItem`)
- `restoreDraft()` called in 3 places: `sessionHistoryLoaded`, `sessionReady`, session item click
- `clearDraft()` called in 2 places: `sendMessage()`, new session click

### Type Consistency

- `saveDraft()` — no parameters, reads from `DOM.textarea.value` directly
- `restoreDraft()` — no parameters, writes to `DOM.textarea.value` directly
- `clearDraft()` — no parameters, removes from sessionStorage
- Storage key format: `draft:${sid}` where `sid` is `activeSessionId` or `'draft'` for the default/new-session case
- Draft is saved before textarea is cleared in `sendMessage()` — save happens on `input` event, not on submit