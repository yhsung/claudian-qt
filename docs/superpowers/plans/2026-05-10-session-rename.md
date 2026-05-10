# Session Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow double-clicking a session sidebar item to rename it inline — an `<input>` replaces the preview text; Enter/blur commits; Escape cancels.

**Architecture:** Session names are stored in a `session-meta.json` sidecar file per session in the Claude project directory. The daemon writes this file on `rename_session` command. The sidebar re-renders after rename. The UI pattern mirrors the existing inline-edit pattern used for session preview.

**Tech Stack:** TypeScript (daemon), Vanilla JS (UI)

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `bridge/src/protocol.ts` | Add `rename_session` command and `session_renamed` event types |
| Modify | `bridge/src/daemon.ts` | Handle `rename_session` — write `.name` field to session-meta.json |
| Modify | `bridge/src/session-history.ts` | Add `renameSession()` to write session metadata |
| Modify | `src/claudebridge.h` | Add `renameSession(id, name)` slot |
| Modify | `src/claudebridge.cpp` | Marshal `renameSession` → daemon command |
| Modify | `resources/chat/chat.js` | Double-click → inline input → commit/cancel/ESC |
| Modify | `resources/chat/chat.css` | Inline input styling in session list |

---

## Task 1: Protocol types for session rename

**Files:**
- Modify: `bridge/src/protocol.ts:31-42`

- [ ] **Step 1: Add rename command and event to protocol types**

Find the `DaemonCommand` type (line ~31). Add the `rename_session` variant:

```typescript
export type DaemonCommand =
  | { type: "send"; prompt: string; attachments?: OutboundAttachment[]; model?: string; yolo?: boolean }
  | { type: "abort" }
  | { type: "set_cwd"; cwd: string }
  | { type: "set_model"; model: string }
  | { type: "set_yolo"; yolo: boolean }
  | { type: "new_session" }
  | { type: "request_sessions" }
  | { type: "load_session"; sessionId: string }
  | { type: "permission_response"; requestId: string; allow: boolean; alwaysAllow: boolean }
  | { type: "delete_session"; sessionId: string }
  | { type: "set_permission_mode"; mode: string }
  | { type: "rename_session"; sessionId: string; name: string };
```

Find the `DaemonEvent` type (line ~44). Add the `session_renamed` event:

```typescript
export type DaemonEvent =
  | { type: "text_ready"; text: string }
  | { type: "thinking_chunk"; text: string }
  | { type: "tool_use"; id: string; name: string; input: string }
  | { type: "tool_result"; toolUseId: string; content: string; isError: boolean }
  | { type: "sub_agent_message"; parentToolUseId: string; text: string }
  | { type: "permission_request"; requestId: string; toolName: string; input: string; title?: string; description?: string; displayName?: string; decisionReason?: string; blockedPath?: string }
  | { type: "turn_complete" }
  | { type: "session_ready"; sessionId: string }
  | { type: "error"; msg: string }
  | { type: "sessions_listed"; json: string }
  | { type: "session_history_loaded"; json: string }
  | { type: "result"; data: Record<string, unknown> }
  | { type: "session_renamed"; sessionId: string; name: string };
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd bridge && npm run typecheck 2>&1
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add bridge/src/protocol.ts
git commit -m "feat(daemon): add rename_session command and session_renamed event"
```

---

## Task 2: Daemon rename handling

**Files:**
- Modify: `bridge/src/session-history.ts`
- Modify: `bridge/src/daemon.ts:216-294`

- [ ] **Step 1: Add renameSession() to session-history.ts**

Find the end of `session-history.ts` (after `loadSessionHistory`). Add:

```typescript
import { writeFile, readFile } from "fs/promises";
import { dirname } from "path";

export async function renameSession(
  cwd: string,
  sessionId: string,
  name: string,
  home = os.homedir()
): Promise<void> {
  const metaPath = join(claudeProjectDir(cwd, home), `${sessionId}.name`);
  await mkdir(dirname(metaPath), { recursive: true });
  await writeFile(metaPath, JSON.stringify({ name, updatedAt: new Date().toISOString() }), "utf8");
}

export async function getSessionName(
  cwd: string,
  sessionId: string,
  home = os.homedir()
): Promise<string> {
  const metaPath = join(claudeProjectDir(cwd, home), `${sessionId}.name`);
  try {
    const data = JSON.parse(await readFile(metaPath, "utf8"));
    return data.name || "";
  } catch {
    return "";
  }
}
```

- [ ] **Step 2: Handle rename_session in daemon handleCommand()**

Find the `handleCommand()` function in `daemon.ts`. Add the `rename_session` case in the switch:

```typescript
    case "delete_session": {
      const sessionFile = join(
        os.homedir(), ".claude", "projects",
        state.cwd.replace(/\//g, "-"),
        cmd.sessionId + ".jsonl"
      );
      try { await unlink(sessionFile); } catch { /* already gone */ }
      const sessions = await listSessions(state.cwd);
      emit({ type: "sessions_listed", json: JSON.stringify(sessions) });
      break;
    }

    case "rename_session": {
      await renameSession(state.cwd, cmd.sessionId, cmd.name);
      emit({ type: "session_renamed", sessionId: cmd.sessionId, name: cmd.name });
      const sessions = await listSessions(state.cwd);
      emit({ type: "sessions_listed", json: JSON.stringify(sessions) });
      break;
    }
```

Also add the import for `renameSession` at the top of `daemon.ts`:

```typescript
import { listSessions, loadSessionHistory, renameSession } from "./session-history.js";
```

- [ ] **Step 3: Build and verify**

```bash
cd bridge && npm run build 2>&1
```

Expected: `bridge/dist/daemon.js` updated.

- [ ] **Step 4: Commit**

```bash
git add bridge/src/session-history.ts bridge/src/daemon.ts
git commit -m "feat(daemon): handle rename_session command and write .name sidecar"
```

---

## Task 3: ClaudeBridge rename slot

**Files:**
- Modify: `src/claudebridge.h`
- Modify: `src/claudebridge.cpp`

- [ ] **Step 1: Add renameSession slot to claudebridge.h**

Find `void newSession();` (around line 18 in the slots section). Add after it:

```cpp
void renameSession(const QString &sessionId, const QString &name);
```

- [ ] **Step 2: Add renameSession implementation to claudebridge.cpp**

Find `ClaudeBridge::newSession()` (around line 32). After it, add:

```cpp
void ClaudeBridge::renameSession(const QString &sessionId, const QString &name) {
    m_daemon->sendCommand(QJsonObject{
        {"type", "rename_session"},
        {"sessionId", sessionId},
        {"name", name}
    });
}
```

- [ ] **Step 3: Build C++**

```bash
cd build && cmake --build . --parallel $(sysctl -n hw.ncpu) 2>&1 | tail -10
```

Expected: `[100%] Built target ClaudianQt` — no compile errors.

- [ ] **Step 4: Commit**

```bash
git add src/claudebridge.h src/claudebridge.cpp
git commit -m "feat(bridge): add renameSession(slot) to expose session rename to JS"
```

---

## Task 4: Double-click inline edit in sidebar

**Files:**
- Modify: `resources/chat/chat.js`
- Modify: `resources/chat/chat.css`

- [ ] **Step 1: Add makeSessionItem() helper to create inline-editable session items**

Find `renderSessions()` (line ~605). Before it, add:

```js
// ── Session rename ───────────────────────────────────────────────────────────
function makeSessionItem(s) {
  const item = document.createElement('div');
  item.className = 'session-item' + (s.id === state.activeSessionId ? ' active' : '');
  item.dataset.sid = s.id;

  const preview = document.createElement('div');
  preview.className = 'session-preview';
  preview.textContent = s.name || s.preview;

  const time = document.createElement('div');
  time.className = 'session-time';
  time.textContent = relativeTime(s.timestamp);

  const delBtn = document.createElement('button');
  delBtn.className = 'session-delete-btn';
  delBtn.title = 'Delete session';
  delBtn.textContent = '×';
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!confirm('Delete this session? This cannot be undone.')) return;
    if (s.id === state.activeSessionId) {
      state.messages = [];
      state.activeSessionId = '';
      DOM.messages.innerHTML = '';
      hideSummaryView();
      resetStatusline();
    }
    bridge.deleteSession(s.id);
  });

  item.appendChild(preview);
  item.appendChild(time);
  item.appendChild(delBtn);

  // Double-click to rename
  preview.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    startSessionRename(item, s.id, preview);
  });

  item.addEventListener('click', () => {
    state.activeSessionId = s.id;
    DOM.sessionList.querySelectorAll('.session-item').forEach(el => el.classList.toggle('active', el.dataset.sid === s.id));
    bridge.loadSession(s.id);
  });

  return item;
}

function startSessionRename(item, sessionId, previewEl) {
  const currentText = previewEl.textContent;
  const input = document.createElement('input');
  input.className = 'session-rename-input';
  input.type = 'text';
  input.value = currentText;
  input.maxLength = 80;

  previewEl.replaceWith(input);
  input.focus();
  input.select();

  function commit() {
    const newName = input.value.trim() || currentText;
    bridge.renameSession(sessionId, newName);
  }

  function cancel() {
    input.replaceWith(previewEl);
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); input.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });

  input.addEventListener('blur', () => { commit(); });
  input.addEventListener('click', (e) => { e.stopPropagation(); });
}
```

- [ ] **Step 2: Update renderSessions() to use makeSessionItem()**

Find the `state.sessions.forEach(s => {` block inside `renderSessions()` (line ~612). Replace the entire forEach body with:

```js
  state.sessions.forEach(s => {
    DOM.sessionList.appendChild(makeSessionItem(s));
  });
```

- [ ] **Step 3: Add session rename CSS**

Find the `#session-list` style in `chat.css`. Add after it:

```css
/* ── Session rename input ──────────────────────────────────────────────────── */
.session-rename-input {
  width: 100%;
  background: var(--bg);
  border: 1px solid var(--accent);
  color: var(--text);
  border-radius: var(--radius-sm);
  padding: 2px 6px;
  font-size: 12px;
  font-family: var(--font-ui);
  outline: none;
}
```

- [ ] **Step 4: Build and verify**

```bash
cd build && cmake --build . --parallel $(sysctl -n hw.ncpu) 2>&1 | tail -5
```

Expected: `[100%] Built target ClaudianQt`

- [ ] **Step 5: Manual test**

Launch. Double-click a session preview in the sidebar — it should become an input field. Type a new name and press Enter — it should commit and show the new name. Press Escape — it should cancel and revert. Click elsewhere (blur) — it should commit.

- [ ] **Step 6: Commit**

```bash
git add resources/chat/chat.js resources/chat/chat.css
git commit -m "feat: add double-click session rename with inline input"
```

---

## Self-Review

### Spec Coverage

| Requirement | Task |
|-------------|------|
| Double-click to enter rename mode | Task 4 |
| Inline input replaces preview text | Task 4 |
| Enter commits the rename | Task 4 |
| Escape cancels the rename | Task 4 |
| Blur commits the rename | Task 4 |
| Daemon writes `.name` sidecar file | Task 2 |
| BridgeDaemon marshals renameSession | Task 3 |
| C++ slot exposed to JS | Task 3 |
| Sidebar re-renders with new name after commit | Task 2 (`sessions_listed` event) |

### Placeholder Scan

- No TBD, TODO, "implement later", or "similar to"
- All code shown inline with exact variable names
- `makeSessionItem(s)` replaces the entire session rendering — no duplication
- `startSessionRename` handles all three exit paths (Enter/blur/Escape) with cleanup

### Type Consistency

- `makeSessionItem(s)` — `s` has shape `{ id, preview, name?, timestamp }` — `name` field is optional string
- `startSessionRename(item, sessionId, previewEl)` — `item` is DOM element, `sessionId` is string, `previewEl` is the `.session-preview` div being replaced
- `bridge.renameSession(sessionId, newName)` — matches `ClaudeBridge::renameSession` slot signature
- `.replaceWith(input)` replaces the preview div with an input — native DOM API, no library needed
- `input.maxLength = 80` prevents unreasonably long session names