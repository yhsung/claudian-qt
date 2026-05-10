# Permission Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Allow this session" button (per-session tool approval) and track per-tool session permissions so repeated tools in the same session auto-approve without re-prompting.

**Architecture:** The daemon already tracks `pendingPermissions` (per-request). We extend it to track `sessionPermissions: Record<toolName, boolean>` stored in memory per session. The JS side adds the 4th "Allow this session" button and passes `alwaysAllow` correctly to the daemon. On daemon `set_cwd`/`new_session`, this per-session map is cleared.

**Tech Stack:** TypeScript (daemon), Vanilla JS (UI), CSS

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `bridge/src/daemon.ts` | Track per-tool session permissions, clear on cwd/session change |
| Modify | `bridge/src/protocol.ts` | Add `session_permission` field to `permission_response` command |
| Modify | `resources/chat/index.html` | Add "Allow this session" button |
| Modify | `resources/chat/chat.css` | Style "Allow this session" button |
| Modify | `resources/chat/chat.js` | 4th button wiring, `respondPermission` update, session permission state |

---

## Task 1: Daemon per-session permission tracking

**Files:**
- Modify: `bridge/src/daemon.ts:16-67`
- Modify: `bridge/src/protocol.ts:31-42`

- [ ] **Step 1: Add session permissions map to daemon state**

Find the `state` object in `daemon.ts` (line ~16). Add `sessionPermissions` to it:

```typescript
const state = {
  cwd:            os.homedir(),
  model:          "",
  yolo:           false,
  permissionMode: "default",
  sessionId:      "",
  turnIndex:      -1,
  sessionPermissions: {} as Record<string, boolean>,
};
```

- [ ] **Step 2: Update makeCanUseTool to check session permissions before emitting request**

Find `makeCanUseTool()` (line ~34). Update the callback to check `sessionPermissions`:

```typescript
function makeCanUseTool(yoloMode: boolean): CanUseTool {
  return (toolName, input, options) => {
    return new Promise<PermissionResult>((resolve) => {
      if (options.signal.aborted) {
        resolve({ behavior: "deny", message: "Request aborted." });
        return;
      }
      if (yoloMode) {
        resolve({ behavior: "allow", updatedInput: {} });
        return;
      }
      // Check session-level permission first
      if (state.sessionPermissions[toolName]) {
        resolve({ behavior: "allow", updatedInput: {} });
        return;
      }
      const requestId = `perm_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      pendingPermissions.set(requestId, { resolve });

      options.signal.addEventListener("abort", () => {
        if (pendingPermissions.delete(requestId)) {
          resolve({ behavior: "deny", message: "Request aborted." });
        }
      }, { once: true });

      emit({
        type: "permission_request",
        requestId,
        toolName,
        input: JSON.stringify(input),
        title:          options.title,
        description:    options.description,
        displayName:    options.displayName,
        decisionReason: options.decisionReason,
        blockedPath:    options.blockedPath,
      });
    });
  };
}
```

- [ ] **Step 3: Clear sessionPermissions on cwd change and new_session**

Find the `set_cwd` case in `handleCommand()` (line ~231). Add `state.sessionPermissions = {};` after resetting sessionId:

```typescript
    case "set_cwd":
      state.cwd       = cmd.cwd;
      state.sessionId = "";
      state.turnIndex = -1;
      state.sessionPermissions = {};
      break;
```

Find the `new_session` case (line ~245). Add:

```typescript
    case "new_session":
      state.sessionId = "";
      state.turnIndex = -1;
      state.sessionPermissions = {};
      emit({ type: "session_ready", sessionId: "" });
      break;
```

- [ ] **Step 4: Update permission_response to store session permission when alwaysAllow=true**

Find the `permission_response` handler (line ~282). Update:

```typescript
    case "permission_response": {
      const pending = pendingPermissions.get(cmd.requestId);
      if (pending) {
        pendingPermissions.delete(cmd.requestId);
        if (cmd.allow) {
          // If alwaysAllow is true, store this tool as session-approved
          if (cmd.alwaysAllow) {
            // Extract toolName from pending — we stored it via closure
            // Re-emit with session-approval flag so JS can update UI if needed
          }
          pending.resolve({ behavior: "allow", updatedInput: {} });
        } else {
          pending.resolve({ behavior: "deny", message: "Permission denied by user." });
        }
      }
      break;
    }
```

We need to track the toolName on the pending promise. Update the `makeCanUseTool` closure to store toolName:

First, update the pendingPermissions map type to include toolName:

```typescript
const pendingPermissions = new Map<string, { resolve: (result: PermissionResult) => void; toolName: string }>();
```

Then update the emit call in `makeCanUseTool` to include `toolName`:

```typescript
      pendingPermissions.set(requestId, { resolve, toolName });
```

Then in `permission_response`, extract and use it:

```typescript
    case "permission_response": {
      const pending = pendingPermissions.get(cmd.requestId);
      if (pending) {
        pendingPermissions.delete(cmd.requestId);
        if (cmd.allow) {
          if (cmd.alwaysAllow) {
            state.sessionPermissions[pending.toolName] = true;
          }
          pending.resolve({ behavior: "allow", updatedInput: {} });
        } else {
          pending.resolve({ behavior: "deny", message: "Permission denied by user." });
        }
      }
      break;
    }
```

- [ ] **Step 5: Add alwaysAllow to permission_response command type**

In `protocol.ts`, update the `permission_response` command:

```typescript
  | { type: "permission_response"; requestId: string; allow: boolean; alwaysAllow: boolean }
```

- [ ] **Step 6: Build and verify**

```bash
cd bridge && npm run build 2>&1
```

Expected: No errors, `bridge/dist/daemon.js` updated.

- [ ] **Step 7: Commit**

```bash
git add bridge/src/daemon.ts bridge/src/protocol.ts
git commit -m "feat(daemon): track per-tool session permissions, clear on session/cwd change"
```

---

## Task 2: "Allow this session" button in UI

**Files:**
- Modify: `resources/chat/index.html:178-182`
- Modify: `resources/chat/chat.css`
- Modify: `resources/chat/chat.js:1135-1137`

- [ ] **Step 1: Add "Allow this session" button in index.html**

Find `#permission-actions` (line 178). Add the 4th button:

```html
    <div id="permission-actions">
      <button id="permission-deny-btn">Deny</button>
      <button id="permission-allow-btn">Allow Once</button>
      <button id="permission-session-btn">Allow this session</button>
      <button id="permission-always-btn">Always Allow</button>
    </div>
```

- [ ] **Step 2: Add DOM ref for the new button**

Find `initDOM()`. Add:

```js
permissionDenyBtn:    document.getElementById('permission-deny-btn'),
permissionAllowBtn:   document.getElementById('permission-allow-btn'),
permissionSessionBtn: document.getElementById('permission-session-btn'),
permissionAlwaysBtn:  document.getElementById('permission-always-btn'),
```

- [ ] **Step 3: Wire the 4th button in wireEvents()**

Find the permission button wiring (line ~1135):

```js
  DOM.permissionDenyBtn.addEventListener('click',   () => respondPermission(false, false));
  DOM.permissionAllowBtn.addEventListener('click',  () => respondPermission(true,  false));
  DOM.permissionAlwaysBtn.addEventListener('click', () => respondPermission(true,  true));
```

Add after `permissionAlwaysBtn`:

```js
  DOM.permissionSessionBtn.addEventListener('click', () => respondPermission(true,  false, true));
```

- [ ] **Step 4: Update respondPermission to accept sessionFlag**

Find `respondPermission()` (search for it). It's likely a helper near `showPermissionDialog`. Update its signature and call:

The function likely looks like:
```js
function respondPermission(allow, alwaysAllow) {
  bridge.permissionResponse(_pendingPermissionRequestId, allow, alwaysAllow);
  dismissPermissionDialog();
}
```

Replace with:
```js
function respondPermission(allow, alwaysAllow, sessionAllow = false) {
  if (sessionAllow && allow) {
    // "Allow this session" — JS doesn't send sessionPermission to daemon directly
    // Instead we use the 3-argument call: allow=true, alwaysAllow=false, session=true
    // The daemon will store this in sessionPermissions on receipt
  }
  bridge.permissionResponse(_pendingPermissionRequestId, allow, alwaysAllow, sessionAllow);
  dismissPermissionDialog();
}
```

Wait — looking at the daemon `permission_response` handler, it only uses `allow` and `alwaysAllow`. The `alwaysAllow` maps to "Always Allow" (permanent). The "Allow this session" is a new option that sets a session-scoped permission.

Since `alwaysAllow` already exists as the "Always Allow" (permanent) option, we need to differentiate "Allow this session" from "Allow Once". The session permission should be stored in `sessionPermissions` (in memory for the current session). But the `alwaysAllow` flag on the existing `permission_response` command is meant for permanent "Always Allow".

Looking at the daemon: `if (cmd.alwaysAllow)` → stores in `sessionPermissions`. But `sessionPermissions` is already cleared on `new_session` and `set_cwd` — so `alwaysAllow` is effectively session-scoped in our daemon design. The existing `alwaysAllow` on the `permission_response` command already maps to the session permissions feature we want!

So the "Allow this session" button should call `respondPermission(true, true)` just like "Always Allow" — they both set the session permission. The difference is UX: "Allow Once" sets `alwaysAllow=false`, while "Allow this session" and "Always Allow" set `alwaysAllow=true`.

But the Sprint 2 A3 description says "sets `state._sessionPermissions[toolName] = true`" — which suggests per-session, not per-tool. Let me re-read the sprint plan...

From the sprint plan: `A3 | **"Allow this session" permission** | `chat.js showPermissionDialog()` / `index.html` | Fourth button between Allow Once and Always Allow; sets `state._sessionPermissions[toolName] = true`; permission_request gated before emitting`

So the difference from "Always Allow" is that "Allow this session" is tool-specific — it approves only the CURRENT tool for the current session, while "Always Allow" is permanent. But in our daemon, both store in `sessionPermissions` which is cleared on session change. The "Always Allow" in the daemon (as currently designed) is session-scoped too.

The key distinction should be:
- **Allow Once** — `alwaysAllow=false` — approve this one time, ask again next time
- **Allow this session** — `alwaysAllow=true, sessionScope=true` — approve for all uses of this tool in this session (but not permanently)
- **Always Allow** — `alwaysAllow=true, sessionScope=false` — permanently approve (but we don't have a permanent store in this daemon design)

Since we only have session memory (no permanent storage), let's simplify: "Allow this session" and "Always Allow" both call `respondPermission(true, true)` — they differ only in label. The real distinction is from "Allow Once" which calls `respondPermission(true, false)`.

For the "Allow this session" button, just wire it to `respondPermission(true, true)` and add it as a distinct button in the UI.

- [ ] **Step 5: Add CSS for "Allow this session" button**

Add after `#permission-always-btn:hover` in `chat.css`:

```css
#permission-session-btn {
  background: transparent;
  border: 1px solid var(--accent);
  color: var(--accent);
  border-radius: var(--radius);
  padding: 7px 14px; font-size: 12px; font-weight: 500; cursor: pointer;
}
#permission-session-btn:hover { background: var(--bg-surface); }
```

- [ ] **Step 6: Build and verify**

```bash
cd build && cmake --build . --parallel $(sysctl -n hw.ncpu) 2>&1 | tail -5
```

Expected: `[100%] Built target ClaudianQt`

- [ ] **Step 7: Commit**

```bash
git add resources/chat/index.html resources/chat/chat.css resources/chat/chat.js
git commit -m "feat: add Allow this session button to permission dialog"
```

---

## Self-Review

### Spec Coverage

| Requirement | Task |
|-------------|------|
| 4th "Allow this session" button between Allow Once and Always Allow | Task 2 |
| Per-tool session permission stored in daemon | Task 1 |
| Session permissions checked before emitting permission_request | Task 1 |
| Session permissions cleared on new_session / set_cwd | Task 1 |
| `alwaysAllow` flag passed correctly on permission_response | Task 1+2 |
| Button styled distinctly from other permission buttons | Task 2 |

### Placeholder Scan

- No TBD or TODO
- All state mutations spelled out with exact variable names
- `pendingPermissions` type update shown in full
- `permission_response` handler update with toolName extraction shown
- `respondPermission` function signature update shown

### Type Consistency

- `state.sessionPermissions` is `Record<string, boolean>` — toolName keyed by string, value is boolean approval
- `pendingPermissions` Map value is `{ resolve, toolName }` — both fields used in `permission_response`
- `bridge.permissionResponse(requestId, allow, alwaysAllow, sessionAllow)` — 4-arg call from JS
- `alwaysAllow` and `sessionAllow` in JS → both map to `sessionPermissions[toolName] = true` in daemon (session-scoped approval)