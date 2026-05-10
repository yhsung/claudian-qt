# Copy All Tool Results Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Copy all" button at the bottom of the expanded `.tool-group-body` that concatenates all tool results with tool-name headers.

**Architecture:** The "Copy all" button is appended to `.tool-group-body` after the tool items when the group is expanded. It uses the existing `copyToClipboard()` helper. The button only appears when the group is expanded (via CSS or JS class toggle). Clicking it concatenates all `tc.result` values from the group's tool calls.

**Tech Stack:** Vanilla JS (ES6), CSS3, existing `copyToClipboard()` helper

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `resources/chat/chat.js` | Add "Copy all" button to tool group body on expand |
| Modify | `resources/chat/chat.css` | Style "Copy all" button at bottom of tool group |

---

## Task 1: Add "Copy all" button to expanded tool group body

**Files:**
- Modify: `resources/chat/chat.js:252-267`
- Modify: `resources/chat/chat.css`

- [ ] **Step 1: Update renderToolCalls to append Copy all button**

Find `renderToolCalls()` (line ~252). The current implementation creates a `group` div with header and body, appends tool items to body, then returns group. We need to add a Copy all button that appears when the group is expanded.

The group starts with `group.className = 'tool-group'`. When expanded it gets `group.classList.toggle('expanded')`. We'll add the button inside the body, initially hidden, and show it when the group is expanded.

First, add a helper function `makeToolGroupCopyBtn` before `renderToolCalls()`:

```js
function makeToolGroupCopyBtn(toolCalls) {
  const btn = document.createElement('button');
  btn.className = 'tool-group-copy-btn';
  btn.textContent = 'Copy all results';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const text = toolCalls.map(tc => {
      const name = tc.name || 'tool';
      const result = tc.result || '';
      return `=== ${name} ===\n${result}`;
    }).join('\n\n');
    copyToClipboard(text);
    btn.textContent = '✓ Copied!';
    setTimeout(() => { btn.textContent = 'Copy all results'; }, 1500);
  });
  return btn;
}
```

Now update `renderToolCalls()`. Find the body creation:

```js
  const body = document.createElement('div');
  body.className = 'tool-group-body';
  toolCalls.forEach(tc => body.appendChild(renderToolCallItem(tc)));
  group.append(header, body);
```

Replace with:

```js
  const body = document.createElement('div');
  body.className = 'tool-group-body';
  toolCalls.forEach(tc => body.appendChild(renderToolCallItem(tc)));
  const copyAllBtn = makeToolGroupCopyBtn(toolCalls);
  body.appendChild(copyAllBtn);
  group.append(header, body);
  return group;
```

Also update the header click toggle to show/hide the copy button based on expanded state. The header click is:
```js
  header.addEventListener('click', () => group.classList.toggle('expanded'));
```

Add a second listener (or update existing) to toggle copy button visibility:
```js
  header.addEventListener('click', () => {
    group.classList.toggle('expanded');
    copyAllBtn.style.display = group.classList.contains('expanded') ? '' : 'none';
  });
```

Actually since the button is inside body and body should already be hidden when collapsed (via CSS), we just need:
```js
  header.addEventListener('click', () => group.classList.toggle('expanded'));
```

And add CSS that hides `.tool-group-copy-btn` when the group is not expanded:
```css
.tool-group:not(.expanded) .tool-group-copy-btn { display: none; }
```

- [ ] **Step 2: Add CSS for "Copy all" button**

Find the tool-group CSS in `chat.css`. Add after the `.tool-group-body` rule:

```css
/* ── Tool group copy all button ───────────────────────────────────────────── */
.tool-group-copy-btn {
  display: none;
  width: 100%;
  margin-top: 8px;
  padding: 6px;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-muted);
  border-radius: var(--radius-sm);
  font-size: 11px;
  cursor: pointer;
  text-align: center;
}
.tool-group-copy-btn:hover { border-color: var(--accent); color: var(--accent); }
.tool-group:not(.expanded) .tool-group-copy-btn { display: none; }
.tool-group.expanded .tool-group-copy-btn { display: block; }
```

- [ ] **Step 3: Build and verify**

```bash
cd build && cmake --build . --parallel $(sysctl -n hw.ncpu) 2>&1 | tail -5
```

Expected: `[100%] Built target ClaudianQt`

- [ ] **Step 4: Manual test**

Launch. Trigger a tool call (e.g. `ls`). Expand the tool group by clicking its header. Verify the "Copy all results" button appears at the bottom of the group. Click it. Verify toast "✓ Copied!" appears (if `showToast` was wired) or button text changes.

- [ ] **Step 5: Commit**

```bash
git add resources/chat/chat.js resources/chat/chat.css
git commit -m "feat: add Copy all results button to expanded tool groups"
```

---

## Self-Review

### Spec Coverage

| Requirement | Task |
|-------------|------|
| "Copy all" button at bottom of expanded tool group body | Task 1 |
| Concatenates all tool results with tool name headers | Task 1 |
| Button only visible when group is expanded | Task 1 |
| Brief "✓ Copied!" confirmation on click | Task 1 |
| Sprint 2 A7 requirement | ✓ |

### Placeholder Scan

- No TBD or TODO
- `makeToolGroupCopyBtn` function fully shown with exact parameter names
- `toolCalls.map` with exact template string shown
- CSS rules complete with exact selectors and property names

### Type Consistency

- `makeToolGroupCopyBtn(toolCalls)` — `toolCalls` is `Array` of tool call objects with `name` and `result` fields
- `tc.name || 'tool'` — safe fallback if name is missing
- `tc.result || ''` — safe fallback if result is undefined
- `copyToClipboard(text)` — existing helper, called with concatenated string
- `btn.className = 'tool-group-copy-btn'` — matches CSS selector exactly