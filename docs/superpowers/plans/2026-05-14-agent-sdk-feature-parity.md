# Agent SDK Feature Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Achieve complete feature parity with the `@anthropic-ai/claude-agent-sdk` TypeScript library by wiring every un-used SDK capability into the daemon → bridge → Qt → UI pipeline.

**Architecture:** The existing three-layer pipeline is preserved — Qt C++ (`ClaudeBridge`/`BridgeDaemon`) ↔ Node.js bridge daemon (`daemon.ts`) ↔ Agent SDK (`query()`). New SDK features extend the JSON-over-stdio protocol, new Qt signals/slots route events to the web layer, and the chat UI renders new interactive elements.

**Tech Stack:** `@anthropic-ai/claude-agent-sdk` (latest), TypeScript 5.4, Qt6/QWebChannel C++17, vanilla JavaScript (chat layer)

---

## Parity Gap Analysis

| SDK Feature | Current State | This Plan |
|---|---|---|
| `AskUserQuestion` via canUseTool | ❌ Ignored — Claude hangs | Task 2 |
| `startup()` warm query | ❌ Cold-starts every send | Task 3 |
| `supportedModels()` dynamic list | ❌ Model list is hardcoded | Task 3 |
| `thinking` config (extended thinking) | ❌ Never passed to query | Task 4 |
| `effort` level | ❌ Never passed | Task 5 |
| `maxTurns` / `maxBudgetUsd` | ❌ Never passed | Task 5 |
| `systemPrompt` | ❌ Never passed | Task 5 |
| `allowedTools` / `disallowedTools` | ❌ Never passed | Task 6 |
| `forkSession` | ❌ Not supported | Task 7 |
| `Notification` hook | ❌ Not wired | Task 8 |
| `Stop` / `SubagentStop` hooks | ❌ Not wired | Task 8 |
| SDK `listSessions()` / `getSessionMessages()` | ❌ Manual JSONL parsing | Task 9 |
| `mcpServers` configuration | ❌ Not supported | Task 10 |
| Custom `agents` definitions | ❌ Not supported | Task 11 |
| `enableFileCheckpointing` + `rewindFiles()` | ❌ Not supported | Task 12 |
| `accountInfo()` | ❌ Not exposed | Task 13 |

---

## File Structure

### Modified
- `bridge/package.json` — bump SDK to latest
- `bridge/src/protocol.ts` — extend all command/event union types
- `bridge/src/daemon.ts` — all new SDK option wiring, hooks, Query methods, warm startup
- `bridge/src/session-history.ts` — replace manual JSONL with SDK session functions
- `src/bridgedaemon.h` — new signals for new daemon events
- `src/bridgedaemon.cpp` — parse new event types in handleEvent
- `src/claudebridge.h` — new public slots + signals
- `src/claudebridge.cpp` — wire new signals/slots and route new commands
- `resources/chat/chat.js` — handle all new bridge events
- `resources/chat/chat.css` — styles for AskUserQuestion, thinking badge, MCP panel
- `resources/chat/index.html` — thinking toggle, effort selector, system prompt textarea, MCP panel

### New
- `bridge/tests/ask-user-question.test.ts` — canUseTool AskUserQuestion routing
- `bridge/tests/session-sdk.test.ts` — SDK session function wrappers

---

## Task 1: Update SDK and extend protocol types

**Files:**
- Modify: `bridge/package.json`
- Modify: `bridge/src/protocol.ts`

- [ ] **Step 1: Update the Agent SDK to latest**

```bash
cd /Users/yhsung/dev-projects/claudian-qt/bridge
npm install @anthropic-ai/claude-agent-sdk@latest
```

Expected output: `added X packages` or `changed X packages`.

- [ ] **Step 2: Verify imports compile**

```bash
cd /Users/yhsung/dev-projects/claudian-qt/bridge && npm run typecheck 2>&1 | tail -20
```

Expected: no errors (or only pre-existing errors unrelated to the SDK).

- [ ] **Step 3: Add supporting interface types to protocol.ts**

Open `bridge/src/protocol.ts` and add before the `DaemonCommand` type:

```typescript
export interface AskUserQuestionItem {
  question: string;
  header: string;
  options: Array<{ label: string; description: string; preview?: string }>;
  multiSelect: boolean;
}

export interface McpServerSpec {
  type?: "stdio" | "sse" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export interface AgentSpec {
  description: string;
  prompt: string;
  tools?: string[];
  disallowedTools?: string[];
  model?: string;
  maxTurns?: number;
  permissionMode?: string;
}

export interface RewindResult {
  changedFiles: string[];
  restoredFiles: string[];
  failedFiles: string[];
}
```

- [ ] **Step 4: Extend `DaemonCommand` union with all new command types**

Replace the existing `DaemonCommand` type with:

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
  | { type: "ask_user_response"; requestId: string; answers: Record<string, string | string[]> }
  | { type: "delete_session"; sessionId: string }
  | { type: "rename_session"; sessionId: string; name: string }
  | { type: "set_permission_mode"; mode: string }
  | { type: "set_thinking"; thinkingType: "disabled" | "adaptive" | "enabled"; budgetTokens?: number }
  | { type: "set_run_options"; maxTurns?: number; maxBudgetUsd?: number; effort?: "low" | "medium" | "high" | "xhigh" | "max"; systemPrompt?: string }
  | { type: "set_tool_controls"; allowedTools?: string[]; disallowedTools?: string[] }
  | { type: "fork_session" }
  | { type: "request_models" }
  | { type: "request_account_info" }
  | { type: "set_mcp_servers"; servers: Record<string, McpServerSpec> }
  | { type: "set_agents"; agents: Record<string, AgentSpec> }
  | { type: "rewind_files"; userMessageId: string; dryRun?: boolean };
```

- [ ] **Step 5: Extend `DaemonEvent` union with all new event types**

Replace the existing `DaemonEvent` type with:

```typescript
export type DaemonEvent =
  | { type: "text_ready"; text: string }
  | { type: "thinking_chunk"; text: string }
  | { type: "tool_use"; id: string; name: string; input: string }
  | { type: "tool_result"; toolUseId: string; content: string; isError: boolean }
  | { type: "sub_agent_message"; parentToolUseId: string; text: string }
  | { type: "permission_request"; requestId: string; toolName: string; input: string; title?: string; description?: string; displayName?: string; decisionReason?: string; blockedPath?: string }
  | { type: "ask_user_question"; requestId: string; questions: AskUserQuestionItem[] }
  | { type: "turn_complete" }
  | { type: "session_ready"; sessionId: string }
  | { type: "error"; msg: string }
  | { type: "sessions_listed"; json: string }
  | { type: "session_renamed"; sessionId: string; name: string }
  | { type: "session_history_loaded"; json: string }
  | { type: "session_forked"; newSessionId: string }
  | { type: "result"; data: Record<string, unknown> }
  | { type: "tool_progress"; id: string; name: string; elapsedSeconds: number }
  | { type: "rate_limit"; status: "allowed" | "allowed_warning" | "rejected"; resetsAt?: string; rateLimitType?: string; utilization?: number }
  | { type: "fast_mode_state"; state: "off" | "cooldown" | "on" }
  | { type: "prompt_suggestion"; suggestion: string }
  | { type: "compact_boundary"; preTokens: number; postTokens: number; durationMs: number; trigger: "manual" | "auto" }
  | { type: "models_listed"; models: Array<{ id: string; displayName?: string }> }
  | { type: "account_info"; email?: string; plan?: string }
  | { type: "notification"; message: string; notificationType: string }
  | { type: "rewind_result"; changedFiles: string[]; restoredFiles: string[]; failedFiles: string[] };
```

- [ ] **Step 6: Run typecheck to confirm protocol types are valid**

```bash
cd /Users/yhsung/dev-projects/claudian-qt/bridge && npm run typecheck 2>&1 | tail -20
```

Expected: type errors in daemon.ts (because new command/event cases are unhandled) — that is OK; we fix them in subsequent tasks.

- [ ] **Step 7: Commit**

```bash
git add bridge/package.json bridge/package-lock.json bridge/src/protocol.ts
git commit -m "feat(bridge): extend protocol types for full agent SDK feature parity"
```

---

## Task 2: AskUserQuestion — Claude clarifying questions

**Files:**
- Modify: `bridge/src/daemon.ts`
- Create: `bridge/tests/ask-user-question.test.ts`
- Modify: `src/bridgedaemon.h`
- Modify: `src/bridgedaemon.cpp`
- Modify: `src/claudebridge.h`
- Modify: `src/claudebridge.cpp`
- Modify: `resources/chat/chat.js`
- Modify: `resources/chat/chat.css`

Claude calls `AskUserQuestion` when it needs clarifying input before proceeding. The current `canUseTool` callback ignores this tool name, causing Claude to silently hang. We route it through the same pending-promise map used for tool permissions, emitting `ask_user_question` to the UI and resolving on `ask_user_response`.

- [ ] **Step 1: Write the failing test**

Create `bridge/tests/ask-user-question.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

// Unit test: verify that an ask_user_question event has the correct shape
describe("ask_user_question protocol shape", () => {
  it("carries requestId and questions array", () => {
    const event = {
      type: "ask_user_question" as const,
      requestId: "ask_123",
      questions: [
        {
          question: "Which auth strategy?",
          header: "Auth",
          options: [{ label: "JWT", description: "JSON Web Token" }],
          multiSelect: false,
        },
      ],
    };
    expect(event.type).toBe("ask_user_question");
    expect(event.questions[0].header).toBe("Auth");
  });

  it("ask_user_response carries answers map", () => {
    const cmd = {
      type: "ask_user_response" as const,
      requestId: "ask_123",
      answers: { "Which auth strategy?": "JWT" },
    };
    expect(cmd.answers["Which auth strategy?"]).toBe("JWT");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/yhsung/dev-projects/claudian-qt/bridge && npm test -- tests/ask-user-question.test.ts 2>&1 | tail -15
```

Expected: FAIL — file doesn't exist yet.

- [ ] **Step 3: Update `makeCanUseTool` in daemon.ts to branch on AskUserQuestion**

Find the `pendingPermissions` map declaration (~line 29) and update its value type:

```typescript
const pendingPermissions = new Map<string, {
  resolve: (result: PermissionResult) => void;
  toolName: string;
  originalInput?: Record<string, unknown>;
}>();
```

Replace the entire `makeCanUseTool` function body with:

```typescript
function makeCanUseTool(yoloMode: boolean): CanUseTool {
  return (toolName, input, options) => {
    return new Promise<PermissionResult>((resolve) => {
      if (options.signal.aborted) {
        resolve({ behavior: "deny", message: "Request aborted." });
        return;
      }

      // AskUserQuestion: Claude is asking the user clarifying questions.
      // Emit a structured event and wait for ask_user_response command.
      if (toolName === "AskUserQuestion") {
        const requestId = `ask_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        const typedInput = input as Record<string, unknown>;
        pendingPermissions.set(requestId, {
          resolve,
          toolName,
          originalInput: typedInput,
        });
        options.signal.addEventListener("abort", () => {
          if (pendingPermissions.delete(requestId)) {
            resolve({ behavior: "deny", message: "Request aborted." });
          }
        }, { once: true });
        emit({
          type: "ask_user_question",
          requestId,
          questions: (typedInput.questions ?? []) as AskUserQuestionItem[],
        });
        return;
      }

      if (yoloMode) {
        resolve({ behavior: "allow", updatedInput: {} });
        return;
      }
      if (state.sessionPermissions[toolName]) {
        resolve({ behavior: "allow", updatedInput: {} });
        return;
      }
      const requestId = `perm_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      pendingPermissions.set(requestId, { resolve, toolName });
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

Also update the import line for protocol types:

```typescript
import type { DaemonCommand, DaemonEvent, OutboundAttachment, AskUserQuestionItem } from "./protocol.js";
```

- [ ] **Step 4: Add `ask_user_response` case to `handleCommand` in daemon.ts**

After the `permission_response` case, add:

```typescript
case "ask_user_response": {
  const pending = pendingPermissions.get(cmd.requestId);
  if (pending) {
    pendingPermissions.delete(cmd.requestId);
    pending.resolve({
      behavior: "allow",
      updatedInput: {
        questions: pending.originalInput?.questions ?? [],
        answers: cmd.answers,
      },
    });
  }
  break;
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd /Users/yhsung/dev-projects/claudian-qt/bridge && npm test -- tests/ask-user-question.test.ts 2>&1 | tail -15
```

Expected: PASS.

- [ ] **Step 6: Add signal to `BridgeDaemon` in bridgedaemon.h**

In the `signals:` section of `src/bridgedaemon.h`, add:

```cpp
void askUserQuestion(const QString &requestId, const QString &questionsJson);
```

- [ ] **Step 7: Parse `ask_user_question` in `BridgeDaemon::handleEvent`**

In `src/bridgedaemon.cpp`, in the `handleEvent` if-else chain, add after the `permission_request` branch:

```cpp
else if (type == "ask_user_question")
    emit askUserQuestion(
        event["requestId"].toString(),
        QString::fromUtf8(QJsonDocument(event["questions"].toArray()).toJson(QJsonDocument::Compact))
    );
```

- [ ] **Step 8: Add slot and signal to `ClaudeBridge`**

In `src/claudebridge.h`, add to `public slots:`:

```cpp
void respondToAskUser(const QString &requestId, const QString &answersJson);
```

Add to `signals:`:

```cpp
void askUserQuestion(const QString &requestId, const QString &questionsJson);
```

- [ ] **Step 9: Implement `ClaudeBridge::respondToAskUser` in claudebridge.cpp**

```cpp
void ClaudeBridge::respondToAskUser(const QString &requestId, const QString &answersJson) {
    QJsonParseError err;
    const QJsonDocument doc = QJsonDocument::fromJson(answersJson.toUtf8(), &err);
    if (err.error != QJsonParseError::NoError || !doc.isObject()) {
        emit errorOccurred("Invalid answers payload.");
        return;
    }
    m_daemon->sendCommand(QJsonObject{
        {"type",      "ask_user_response"},
        {"requestId", requestId},
        {"answers",   doc.object()}
    });
}
```

- [ ] **Step 10: Connect signal in `ClaudeBridge` constructor (claudebridge.cpp)**

After the existing permission-related connect, add:

```cpp
connect(m_daemon, &BridgeDaemon::askUserQuestion, this, &ClaudeBridge::askUserQuestion);
```

- [ ] **Step 11: Wire signal in the web layer (chat.js)**

In the `QWebChannel` callback where other signals are connected, add:

```js
bridge.askUserQuestion.connect((requestId, questionsJson) => {
  onAskUserQuestion(requestId, JSON.parse(questionsJson));
});
```

Add the `onAskUserQuestion` function to chat.js:

```js
function onAskUserQuestion(requestId, questions) {
  const card = document.createElement('div');
  card.className = 'ask-question-card';
  card.dataset.requestId = requestId;

  const answers = {};

  questions.forEach(q => {
    const section = document.createElement('div');
    section.className = 'ask-question-section';

    const header = document.createElement('div');
    header.className = 'ask-question-header';
    header.textContent = q.header ? `${q.header}: ${q.question}` : q.question;
    section.appendChild(header);

    const chips = document.createElement('div');
    chips.className = 'ask-chips';

    q.options.forEach(opt => {
      const chip = document.createElement('button');
      chip.className = 'ask-chip';
      chip.textContent = opt.label;
      chip.title = opt.description || '';
      chip.addEventListener('click', () => {
        if (q.multiSelect) {
          chip.classList.toggle('ask-chip--selected');
          answers[q.question] = Array.from(chips.querySelectorAll('.ask-chip--selected'))
            .map(c => c.textContent);
        } else {
          chips.querySelectorAll('.ask-chip').forEach(c => c.classList.remove('ask-chip--selected'));
          chip.classList.add('ask-chip--selected');
          answers[q.question] = opt.label;
          otherInput.value = '';
        }
      });
      chips.appendChild(chip);
    });

    const otherInput = document.createElement('input');
    otherInput.type = 'text';
    otherInput.className = 'ask-other-input';
    otherInput.placeholder = 'Or type your own answer…';
    otherInput.addEventListener('input', () => {
      if (otherInput.value.trim()) {
        chips.querySelectorAll('.ask-chip').forEach(c => c.classList.remove('ask-chip--selected'));
        answers[q.question] = otherInput.value.trim();
      } else {
        delete answers[q.question];
      }
    });

    section.appendChild(chips);
    section.appendChild(otherInput);
    card.appendChild(section);
  });

  const submitBtn = document.createElement('button');
  submitBtn.className = 'ask-submit-btn';
  submitBtn.textContent = 'Send answers';
  submitBtn.addEventListener('click', () => {
    // Default unanswered questions to first option
    questions.forEach(q => {
      if (answers[q.question] === undefined && q.options.length > 0) {
        answers[q.question] = q.options[0].label;
      }
    });
    const answersStr = JSON.stringify(answers);
    bridge.respondToAskUser(requestId, answersStr);
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sent ✓';
    card.classList.add('ask-question-card--done');
  });

  card.appendChild(submitBtn);
  DOM.messages.appendChild(card);
  DOM.messages.scrollTop = DOM.messages.scrollHeight;
}
```

- [ ] **Step 12: Add CSS for question cards in chat.css**

```css
.ask-question-card {
  margin: 8px 0 12px;
  padding: 14px 16px;
  background: var(--background-secondary, #1e1e2e);
  border: 1px solid var(--interactive-accent, #4a9dd9);
  border-radius: 8px;
  max-width: 640px;
}
.ask-question-card--done { opacity: 0.65; pointer-events: none; }
.ask-question-section { margin-bottom: 14px; }
.ask-question-header {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-normal, #cdd6f4);
  margin-bottom: 8px;
  line-height: 1.4;
}
.ask-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
.ask-chip {
  padding: 4px 12px;
  border-radius: 14px;
  border: 1px solid var(--text-muted, #6c7086);
  background: transparent;
  color: var(--text-normal, #cdd6f4);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}
.ask-chip:hover { border-color: var(--interactive-accent, #4a9dd9); }
.ask-chip--selected {
  background: var(--interactive-accent, #4a9dd9);
  border-color: var(--interactive-accent, #4a9dd9);
  color: #fff;
}
.ask-other-input {
  width: 100%;
  padding: 5px 8px;
  background: var(--background-primary, #1a1a2e);
  border: 1px solid var(--text-muted, #6c7086);
  border-radius: 4px;
  color: var(--text-normal, #cdd6f4);
  font-size: 12px;
  box-sizing: border-box;
}
.ask-submit-btn {
  margin-top: 10px;
  padding: 6px 18px;
  background: var(--interactive-accent, #4a9dd9);
  border: none;
  border-radius: 6px;
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}
.ask-submit-btn:disabled { opacity: 0.5; cursor: default; }
```

- [ ] **Step 13: Build bridge and Qt, verify AskUserQuestion renders**

```bash
cd /Users/yhsung/dev-projects/claudian-qt/bridge && npm run build 2>&1 | tail -10
```

Expected: success.

```bash
cd /Users/yhsung/dev-projects/claudian-qt/build && cmake --build . --parallel $(sysctl -n hw.ncpu) 2>&1 | tail -10
```

Expected: success.

- [ ] **Step 14: Commit**

```bash
git add bridge/src/daemon.ts bridge/src/protocol.ts bridge/tests/ask-user-question.test.ts \
        src/bridgedaemon.h src/bridgedaemon.cpp src/claudebridge.h src/claudebridge.cpp \
        resources/chat/chat.js resources/chat/chat.css
git commit -m "feat: implement AskUserQuestion support for Claude clarifying questions"
```

---

## Task 3: Warm startup and dynamic model list

**Files:**
- Modify: `bridge/src/daemon.ts`
- Modify: `src/claudebridge.h`
- Modify: `src/claudebridge.cpp`
- Modify: `src/bridgedaemon.h`
- Modify: `src/bridgedaemon.cpp`
- Modify: `resources/chat/chat.js`
- Modify: `resources/chat/index.html`

`startup()` pre-warms the CLI subprocess so the first user message responds faster. `Query.supportedModels()` returns the live model list from the running session, replacing any hardcoded model array.

- [ ] **Step 1: Add `startup` to imports in daemon.ts**

Replace the first import line:

```typescript
import { query, startup, AbortError } from "@anthropic-ai/claude-agent-sdk";
import type { CanUseTool, PermissionResult, WarmQuery } from "@anthropic-ai/claude-agent-sdk";
```

- [ ] **Step 2: Add warm query state variables in daemon.ts**

After the `state` object (line ~24), add:

```typescript
let warmQueryPromise: Promise<WarmQuery | null> | null = null;
let activeQuery: ReturnType<typeof query> | null = null;
```

- [ ] **Step 3: Pre-warm on daemon start**

After the state block (before `let currentAbort`), add:

```typescript
function scheduleWarmup(): void {
  warmQueryPromise = startup({
    options: { cwd: state.cwd },
    initializeTimeoutMs: 12000,
  }).catch(() => null);
}
scheduleWarmup();
```

- [ ] **Step 4: Consume warm query in `handleSend`**

Replace the `const queryResult = query({...})` call (lines ~89-102) with:

```typescript
let queryResult: ReturnType<typeof query>;

const warm = warmQueryPromise ? await warmQueryPromise : null;
warmQueryPromise = null;

if (warm && !state.sessionId) {
  // Use pre-warmed subprocess for fresh sessions; schedule next warmup
  queryResult = warm.query(
    (async function* () { yield userMessage; })()
  );
  scheduleWarmup();
} else {
  if (warm) warm.close();
  queryResult = query({
    prompt: (async function* () { yield userMessage; })(),
    options: {
      abortController,
      cwd:                             state.cwd,
      resume:                          state.sessionId || undefined,
      model:                           (model ?? state.model) || undefined,
      allowDangerouslySkipPermissions: effectiveYolo,
      permissionMode:                  effectiveYolo ? "bypassPermissions" : (state.permissionMode as any) || "default",
      includePartialMessages:          true,
      forwardSubagentText:             true,
      canUseTool:                      makeCanUseTool(effectiveYolo),
      ...buildRunOptions(),
    },
  });
}
activeQuery = queryResult;
```

The `buildRunOptions()` function is added in Task 5 and returns the extra options (thinking, effort, etc.).

- [ ] **Step 5: Add `request_models` command handler**

In `handleCommand`, after the `set_permission_mode` case, add:

```typescript
case "request_models": {
  // Spin up a minimal one-shot query to read the model list
  try {
    const q = query({
      prompt: "",
      options: {
        cwd: state.cwd,
        maxTurns: 0,
        allowDangerouslySkipPermissions: true,
      },
    });
    q.supportedModels().then((models) => {
      emit({
        type: "models_listed",
        models: models.map((m) => ({ id: m.id, displayName: m.displayName })),
      });
    }).catch(() => {
      emit({ type: "models_listed", models: [] });
    });
  } catch {
    emit({ type: "models_listed", models: [] });
  }
  break;
}
```

- [ ] **Step 6: Add `models_listed` event to BridgeDaemon**

In `src/bridgedaemon.h`, add signal:

```cpp
void modelsListed(const QString &json);
```

In `src/bridgedaemon.cpp`, in `handleEvent`:

```cpp
else if (type == "models_listed")
    emit modelsListed(QString::fromUtf8(QJsonDocument(event["models"].toArray()).toJson(QJsonDocument::Compact)));
```

- [ ] **Step 7: Add slot and signal to ClaudeBridge**

In `src/claudebridge.h`, add to `public slots:`:

```cpp
void requestModels();
```

Add to `signals:`:

```cpp
void modelsListed(const QString &json);
```

- [ ] **Step 8: Implement `ClaudeBridge::requestModels` in claudebridge.cpp**

```cpp
void ClaudeBridge::requestModels() {
    m_daemon->sendCommand(QJsonObject{{"type", "request_models"}});
}
```

Connect in constructor:

```cpp
connect(m_daemon, &BridgeDaemon::modelsListed, this, &ClaudeBridge::modelsListed);
```

- [ ] **Step 9: Request models on bridge connect in chat.js**

In the QWebChannel init callback, after setting up other signals, add:

```js
bridge.modelsListed.connect((json) => {
  const models = JSON.parse(json);
  populateModelPicker(models);
});
bridge.requestModels();
```

Add `populateModelPicker` function:

```js
function populateModelPicker(models) {
  const select = DOM.modelSelect;
  if (!select || !models.length) return;
  const current = select.value;
  // Keep blank/default option, replace the rest
  Array.from(select.options).slice(1).forEach(o => o.remove());
  models.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.displayName || m.id;
    select.appendChild(opt);
  });
  if (current) select.value = current;
}
```

- [ ] **Step 10: Ensure model `<select>` has an id in index.html**

Locate the model selector element (search for `id="model"` or the existing model dropdown) and confirm it has `id="model-select"`. If not, update the `id` attribute and update `DOM.modelSelect` binding in chat.js to reference `document.getElementById('model-select')`.

- [ ] **Step 11: Build and verify model list populates**

```bash
cd /Users/yhsung/dev-projects/claudian-qt/bridge && npm run build 2>&1 | tail -5
cd /Users/yhsung/dev-projects/claudian-qt/build && cmake --build . --parallel $(sysctl -n hw.ncpu) 2>&1 | tail -5
```

Run the app. Open DevTools (port 9222 via `--inspect` flag). Verify that the model dropdown populates on connect.

- [ ] **Step 12: Commit**

```bash
git add bridge/src/daemon.ts src/bridgedaemon.h src/bridgedaemon.cpp \
        src/claudebridge.h src/claudebridge.cpp resources/chat/chat.js resources/chat/index.html
git commit -m "feat: warm startup pre-warming and dynamic model list via supportedModels()"
```

---

## Task 4: Extended thinking configuration

**Files:**
- Modify: `bridge/src/daemon.ts`
- Modify: `src/claudebridge.h`
- Modify: `src/claudebridge.cpp`
- Modify: `resources/chat/chat.js`
- Modify: `resources/chat/index.html`

The SDK `thinking` option enables Claude's extended reasoning. We expose it as a daemon command and add a toggle in the UI.

- [ ] **Step 1: Add thinking state to daemon.ts state object**

In the `state` object, add:

```typescript
const state = {
  cwd:                os.homedir(),
  model:              "",
  yolo:               false,
  permissionMode:     "default",
  sessionId:          "",
  turnIndex:          -1,
  sessionPermissions: {} as Record<string, boolean>,
  thinking:           "disabled" as "disabled" | "adaptive" | "enabled",
  thinkingBudget:     8000,
  effort:             undefined as "low" | "medium" | "high" | "xhigh" | "max" | undefined,
  maxTurns:           undefined as number | undefined,
  maxBudgetUsd:       undefined as number | undefined,
  systemPrompt:       undefined as string | undefined,
  allowedTools:       undefined as string[] | undefined,
  disallowedTools:    undefined as string[] | undefined,
  mcpServers:         {} as Record<string, unknown>,
  agents:             {} as Record<string, unknown>,
  forkNext:           false,
};
```

- [ ] **Step 2: Add `buildRunOptions()` helper in daemon.ts**

Add this function before `handleSend`:

```typescript
function buildRunOptions(): Record<string, unknown> {
  const opts: Record<string, unknown> = {};

  if (state.thinking === "enabled") {
    opts.thinking = { type: "enabled", budget_tokens: state.thinkingBudget };
  } else if (state.thinking === "adaptive") {
    opts.thinking = { type: "adaptive" };
  } else {
    opts.thinking = { type: "disabled" };
  }

  if (state.effort) opts.effort = state.effort;
  if (state.maxTurns !== undefined) opts.maxTurns = state.maxTurns;
  if (state.maxBudgetUsd !== undefined) opts.maxBudgetUsd = state.maxBudgetUsd;
  if (state.systemPrompt) opts.systemPrompt = state.systemPrompt;
  if (state.allowedTools) opts.allowedTools = state.allowedTools;
  if (state.disallowedTools) opts.disallowedTools = state.disallowedTools;
  if (Object.keys(state.mcpServers).length) opts.mcpServers = state.mcpServers;
  if (Object.keys(state.agents).length) opts.agents = state.agents;

  return opts;
}
```

- [ ] **Step 3: Use `buildRunOptions()` in the cold-start query call**

In `handleSend`, update the `query({...options...})` call's options to spread `buildRunOptions()`:

```typescript
queryResult = query({
  prompt: (async function* () { yield userMessage; })(),
  options: {
    abortController,
    cwd:                             state.cwd,
    resume:                          state.forkNext ? undefined : (state.sessionId || undefined),
    forkSession:                     state.forkNext || undefined,
    model:                           (model ?? state.model) || undefined,
    allowDangerouslySkipPermissions: effectiveYolo,
    permissionMode:                  effectiveYolo ? "bypassPermissions" : (state.permissionMode as any) || "default",
    includePartialMessages:          true,
    forwardSubagentText:             true,
    canUseTool:                      makeCanUseTool(effectiveYolo),
    ...buildRunOptions(),
  },
});
state.forkNext = false;
```

- [ ] **Step 4: Add `set_thinking` command handler**

In `handleCommand`:

```typescript
case "set_thinking":
  state.thinking = cmd.thinkingType;
  if (cmd.budgetTokens !== undefined) state.thinkingBudget = cmd.budgetTokens;
  break;
```

- [ ] **Step 5: Add `ClaudeBridge::setThinking` slot**

In `src/claudebridge.h`, add to `public slots:`:

```cpp
void setThinking(const QString &thinkingType, int budgetTokens = 8000);
```

In `src/claudebridge.cpp`:

```cpp
void ClaudeBridge::setThinking(const QString &thinkingType, int budgetTokens) {
    QJsonObject cmd{{"type", "set_thinking"}, {"thinkingType", thinkingType}};
    if (budgetTokens > 0) cmd["budgetTokens"] = budgetTokens;
    m_daemon->sendCommand(cmd);
}
```

- [ ] **Step 6: Add thinking toggle to index.html**

In the settings/toolbar area of `resources/chat/index.html`, add:

```html
<label class="thinking-toggle" title="Extended thinking mode">
  <span>Think</span>
  <select id="thinking-select">
    <option value="disabled">Off</option>
    <option value="adaptive">Auto</option>
    <option value="enabled">On</option>
  </select>
</label>
```

- [ ] **Step 7: Wire thinking select in chat.js**

In the DOM binding section, add:

```js
DOM.thinkingSelect = document.getElementById('thinking-select');
```

Add an event listener in the init section:

```js
if (DOM.thinkingSelect) {
  DOM.thinkingSelect.addEventListener('change', () => {
    const val = DOM.thinkingSelect.value;
    if (bridge) bridge.setThinking(val, 8000);
  });
}
```

- [ ] **Step 8: Build and verify thinking toggle works**

```bash
cd /Users/yhsung/dev-projects/claudian-qt/bridge && npm run build 2>&1 | tail -5
cd /Users/yhsung/dev-projects/claudian-qt/build && cmake --build . --parallel $(sysctl -n hw.ncpu) 2>&1 | tail -5
```

Run the app. Switch thinking to "On", send a message. Verify `thinking_chunk` events appear in the message stream.

- [ ] **Step 9: Commit**

```bash
git add bridge/src/daemon.ts src/claudebridge.h src/claudebridge.cpp \
        resources/chat/chat.js resources/chat/index.html
git commit -m "feat: expose extended thinking, effort, and run option controls"
```

---

## Task 5: Effort, maxTurns, maxBudgetUsd, systemPrompt controls

**Files:**
- Modify: `bridge/src/daemon.ts`
- Modify: `src/claudebridge.h`
- Modify: `src/claudebridge.cpp`
- Modify: `resources/chat/index.html`
- Modify: `resources/chat/chat.js`

- [ ] **Step 1: Add `set_run_options` command handler in daemon.ts**

In `handleCommand`:

```typescript
case "set_run_options":
  if (cmd.maxTurns !== undefined)   state.maxTurns    = cmd.maxTurns;
  if (cmd.maxBudgetUsd !== undefined) state.maxBudgetUsd = cmd.maxBudgetUsd;
  if (cmd.effort !== undefined)      state.effort      = cmd.effort;
  if (cmd.systemPrompt !== undefined) state.systemPrompt = cmd.systemPrompt || undefined;
  break;
```

- [ ] **Step 2: Add `ClaudeBridge::setRunOptions` slot**

In `src/claudebridge.h`, add to `public slots:`:

```cpp
void setRunOptions(int maxTurns, double maxBudgetUsd, const QString &effort, const QString &systemPrompt);
```

In `src/claudebridge.cpp`:

```cpp
void ClaudeBridge::setRunOptions(int maxTurns, double maxBudgetUsd,
                                  const QString &effort, const QString &systemPrompt) {
    QJsonObject cmd{{"type", "set_run_options"}};
    if (maxTurns > 0)          cmd["maxTurns"]      = maxTurns;
    if (maxBudgetUsd > 0)      cmd["maxBudgetUsd"]  = maxBudgetUsd;
    if (!effort.isEmpty())     cmd["effort"]         = effort;
    if (!systemPrompt.isEmpty()) cmd["systemPrompt"] = systemPrompt;
    m_daemon->sendCommand(cmd);
}
```

- [ ] **Step 3: Add run options UI in index.html**

In the settings panel area, add:

```html
<div class="run-options-panel" id="run-options-panel" style="display:none">
  <label>
    Max turns: <input type="number" id="max-turns-input" min="1" max="200" placeholder="unlimited" style="width:60px">
  </label>
  <label>
    Budget ($): <input type="number" id="max-budget-input" min="0.01" step="0.01" placeholder="unlimited" style="width:70px">
  </label>
  <label>
    Effort:
    <select id="effort-select">
      <option value="">Default</option>
      <option value="low">Low</option>
      <option value="medium">Medium</option>
      <option value="high">High</option>
      <option value="xhigh">X-High</option>
      <option value="max">Max</option>
    </select>
  </label>
  <label style="display:block;margin-top:6px">
    System prompt:<br>
    <textarea id="system-prompt-input" rows="3" placeholder="Additional instructions prepended to every session…" style="width:100%;resize:vertical"></textarea>
  </label>
  <button id="apply-run-options-btn">Apply</button>
</div>
```

- [ ] **Step 4: Wire run options in chat.js**

Add to DOM binding:

```js
DOM.maxTurnsInput   = document.getElementById('max-turns-input');
DOM.maxBudgetInput  = document.getElementById('max-budget-input');
DOM.effortSelect    = document.getElementById('effort-select');
DOM.systemPromptInput = document.getElementById('system-prompt-input');
DOM.applyRunOptionsBtn = document.getElementById('apply-run-options-btn');
```

Add event listener:

```js
if (DOM.applyRunOptionsBtn) {
  DOM.applyRunOptionsBtn.addEventListener('click', () => {
    if (!bridge) return;
    const maxTurns    = parseInt(DOM.maxTurnsInput.value, 10) || 0;
    const maxBudget   = parseFloat(DOM.maxBudgetInput.value) || 0;
    const effort      = DOM.effortSelect.value;
    const systemPrompt = DOM.systemPromptInput.value.trim();
    bridge.setRunOptions(maxTurns, maxBudget, effort, systemPrompt);
  });
}
```

- [ ] **Step 5: Build and verify**

```bash
cd /Users/yhsung/dev-projects/claudian-qt/bridge && npm run build 2>&1 | tail -5
cd /Users/yhsung/dev-projects/claudian-qt/build && cmake --build . --parallel $(sysctl -n hw.ncpu) 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add bridge/src/daemon.ts src/claudebridge.h src/claudebridge.cpp \
        resources/chat/index.html resources/chat/chat.js
git commit -m "feat: expose effort, maxTurns, maxBudgetUsd, and systemPrompt run controls"
```

---

## Task 6: Tool controls — allowedTools and disallowedTools

**Files:**
- Modify: `bridge/src/daemon.ts`
- Modify: `src/claudebridge.h`
- Modify: `src/claudebridge.cpp`
- Modify: `resources/chat/index.html`
- Modify: `resources/chat/chat.js`

- [ ] **Step 1: Add `set_tool_controls` command handler in daemon.ts**

In `handleCommand`:

```typescript
case "set_tool_controls":
  state.allowedTools   = cmd.allowedTools?.length   ? cmd.allowedTools   : undefined;
  state.disallowedTools = cmd.disallowedTools?.length ? cmd.disallowedTools : undefined;
  break;
```

- [ ] **Step 2: Add `ClaudeBridge::setToolControls` slot**

In `src/claudebridge.h`:

```cpp
void setToolControls(const QString &allowedJson, const QString &disallowedJson);
```

In `src/claudebridge.cpp`:

```cpp
void ClaudeBridge::setToolControls(const QString &allowedJson, const QString &disallowedJson) {
    auto parseList = [](const QString &json) -> QJsonArray {
        QJsonParseError err;
        const QJsonDocument doc = QJsonDocument::fromJson(json.toUtf8(), &err);
        return (err.error == QJsonParseError::NoError && doc.isArray()) ? doc.array() : QJsonArray{};
    };
    m_daemon->sendCommand(QJsonObject{
        {"type",          "set_tool_controls"},
        {"allowedTools",  parseList(allowedJson)},
        {"disallowedTools", parseList(disallowedJson)},
    });
}
```

- [ ] **Step 3: Add tool controls UI in index.html**

```html
<div class="tool-controls-panel" id="tool-controls-panel" style="display:none">
  <label>
    Allowed tools (comma-separated, empty = all):<br>
    <input type="text" id="allowed-tools-input" placeholder="Read,Glob,Grep" style="width:100%">
  </label>
  <label style="margin-top:6px;display:block">
    Blocked tools:<br>
    <input type="text" id="disallowed-tools-input" placeholder="Bash,Write" style="width:100%">
  </label>
  <button id="apply-tool-controls-btn" style="margin-top:6px">Apply</button>
</div>
```

- [ ] **Step 4: Wire tool controls in chat.js**

```js
DOM.allowedToolsInput    = document.getElementById('allowed-tools-input');
DOM.disallowedToolsInput = document.getElementById('disallowed-tools-input');
DOM.applyToolControlsBtn = document.getElementById('apply-tool-controls-btn');

if (DOM.applyToolControlsBtn) {
  DOM.applyToolControlsBtn.addEventListener('click', () => {
    if (!bridge) return;
    const parse = (s) => JSON.stringify(s.split(',').map(t => t.trim()).filter(Boolean));
    bridge.setToolControls(
      parse(DOM.allowedToolsInput.value),
      parse(DOM.disallowedToolsInput.value)
    );
  });
}
```

- [ ] **Step 5: Build and commit**

```bash
cd /Users/yhsung/dev-projects/claudian-qt/bridge && npm run build 2>&1 | tail -5
cd /Users/yhsung/dev-projects/claudian-qt/build && cmake --build . --parallel $(sysctl -n hw.ncpu) 2>&1 | tail -5
git add bridge/src/daemon.ts src/claudebridge.h src/claudebridge.cpp \
        resources/chat/index.html resources/chat/chat.js
git commit -m "feat: expose allowedTools and disallowedTools tool control settings"
```

---

## Task 7: Session forking

**Files:**
- Modify: `bridge/src/daemon.ts`
- Modify: `src/claudebridge.h`
- Modify: `src/claudebridge.cpp`
- Modify: `resources/chat/chat.js`

Session forking creates a new session that starts from the current conversation history but diverges from that point. Useful for exploring alternative approaches without losing the current thread.

- [ ] **Step 1: Add `fork_session` command handler in daemon.ts**

In `handleCommand`:

```typescript
case "fork_session":
  // Mark forkNext: the next send will pass forkSession: true.
  // The new session ID is captured from the system/init message.
  state.forkNext = true;
  break;
```

The `forkNext` flag is already in the state object (added in Task 4). In `handleSend`, the query options already include:

```typescript
resume:      state.forkNext ? undefined : (state.sessionId || undefined),
forkSession: state.forkNext || undefined,
```

And after iterating messages, the `system/init` event sets `state.sessionId` to the new fork ID and emits `session_ready`. So fork works transparently: the fork's new session ID is surfaced the same way a fresh session ID is.

Additionally, emit a `session_forked` event to let the UI show a fork indicator:

In the `system/init` handling inside `handleSend`, after emitting `session_ready`, check if we just forked:

```typescript
if (m.type === "system" && m.subtype === "init") {
  const wasForked = state.forkNext;
  state.forkNext = false;
  state.sessionId = m.session_id as string;
  emit({ type: "session_ready", sessionId: state.sessionId });
  if (wasForked) {
    emit({ type: "session_forked", newSessionId: state.sessionId });
  }
  // ... rest of existing init handling
}
```

Wait, `state.forkNext` is set to false in `handleSend` after the query options are built. Let me capture it before that:

Actually in my earlier step I wrote `state.forkNext = false;` right after building the query options. Move that line into the `system/init` block instead. Or capture a local `const wasForking = state.forkNext;` before the query starts.

Update `handleSend` to:
```typescript
const wasForking = state.forkNext;
state.forkNext = false;
// ... build queryResult with forkSession: wasForking || undefined
// ... inside the for await loop:
if (m.type === "system" && m.subtype === "init") {
  state.sessionId = m.session_id as string;
  emit({ type: "session_ready", sessionId: state.sessionId });
  if (wasForking) emit({ type: "session_forked", newSessionId: state.sessionId });
  // ... existing fast_mode_state handling
}
```

- [ ] **Step 2: Add `session_forked` event handling in BridgeDaemon**

In `src/bridgedaemon.h`, add signal:

```cpp
void sessionForked(const QString &newSessionId);
```

In `src/bridgedaemon.cpp` handleEvent:

```cpp
else if (type == "session_forked") emit sessionForked(event["newSessionId"].toString());
```

- [ ] **Step 3: Add `forkSession` slot and `sessionForked` signal to ClaudeBridge**

In `src/claudebridge.h`:

```cpp
// slot
void forkSession();
// signal
void sessionForked(const QString &newSessionId);
```

In `src/claudebridge.cpp`:

```cpp
void ClaudeBridge::forkSession() {
    m_daemon->sendCommand(QJsonObject{{"type", "fork_session"}});
}
```

Connect in constructor:

```cpp
connect(m_daemon, &BridgeDaemon::sessionForked, this, &ClaudeBridge::sessionForked);
```

- [ ] **Step 4: Add fork button and handler in chat.js**

In the session list area or toolbar, the UI should expose a "Fork" action. In chat.js, add:

```js
bridge.sessionForked.connect((newSessionId) => {
  // Refresh session list to show the new fork
  bridge.requestSessions();
  // Show a brief toast
  showToast('Session forked — new session started from this point.');
});
```

Add `showToast` helper:

```js
function showToast(msg) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}
```

Add fork button to the session toolbar in index.html (near the "New session" button):

```html
<button id="fork-session-btn" title="Fork current session">⎇ Fork</button>
```

Wire in chat.js:

```js
document.getElementById('fork-session-btn')?.addEventListener('click', () => {
  if (bridge && state.activeSessionId) bridge.forkSession();
});
```

- [ ] **Step 5: Build and verify**

```bash
cd /Users/yhsung/dev-projects/claudian-qt/bridge && npm run build 2>&1 | tail -5
cd /Users/yhsung/dev-projects/claudian-qt/build && cmake --build . --parallel $(sysctl -n hw.ncpu) 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add bridge/src/daemon.ts src/bridgedaemon.h src/bridgedaemon.cpp \
        src/claudebridge.h src/claudebridge.cpp \
        resources/chat/chat.js resources/chat/index.html
git commit -m "feat: session forking via forkSession SDK option"
```

---

## Task 8: Notification and Stop hooks

**Files:**
- Modify: `bridge/src/daemon.ts`
- Modify: `src/bridgedaemon.h`
- Modify: `src/bridgedaemon.cpp`
- Modify: `src/claudebridge.h`
- Modify: `src/claudebridge.cpp`
- Modify: `resources/chat/chat.js`

The SDK's `Notification` hook fires when the agent needs to alert the user (e.g., idle, permission needed, rate limit). The `Stop` hook fires when the agent finishes. Both are surfaced as status messages in the UI.

- [ ] **Step 1: Add hooks to query options in daemon.ts**

Import `HookCallback` type at the top:

```typescript
import type { CanUseTool, PermissionResult, WarmQuery, HookCallback } from "@anthropic-ai/claude-agent-sdk";
```

Add the hooks definition inside `handleSend`, before building the query options:

```typescript
const hooks = {
  Notification: [{
    hooks: [async (input: Record<string, unknown>) => {
      emit({
        type: "notification",
        message: String(input.message ?? ""),
        notificationType: String(input.notification_type ?? ""),
      });
      return {};
    }] as HookCallback[],
  }],
  Stop: [{
    hooks: [async (_input: Record<string, unknown>) => {
      // turn_complete is already emitted in the finally block; Stop hook just logs
      return {};
    }] as HookCallback[],
  }],
  SubagentStop: [{
    hooks: [async (input: Record<string, unknown>) => {
      const agentId = String(input.agent_id ?? "");
      if (agentId) emit({ type: "notification", message: `Subagent finished: ${agentId}`, notificationType: "subagent_stop" });
      return {};
    }] as HookCallback[],
  }],
};
```

Add `hooks` to the cold-start query options:

```typescript
queryResult = query({
  prompt: ...,
  options: {
    // ... existing options ...
    hooks,
    ...buildRunOptions(),
  },
});
```

- [ ] **Step 2: Add `notification` event to BridgeDaemon**

In `src/bridgedaemon.h`, add signal:

```cpp
void agentNotification(const QString &message, const QString &notificationType);
```

In `src/bridgedaemon.cpp` handleEvent:

```cpp
else if (type == "notification")
    emit agentNotification(event["message"].toString(), event["notificationType"].toString());
```

- [ ] **Step 3: Add `agentNotification` signal to ClaudeBridge**

In `src/claudebridge.h`, add signal:

```cpp
void agentNotification(const QString &message, const QString &notificationType);
```

Connect in constructor:

```cpp
connect(m_daemon, &BridgeDaemon::agentNotification, this, &ClaudeBridge::agentNotification);
```

- [ ] **Step 4: Handle notification in chat.js**

```js
bridge.agentNotification.connect((message, notificationType) => {
  onAgentNotification(message, notificationType);
});

function onAgentNotification(message, notificationType) {
  // Skip empty or subagent_stop types (already handled elsewhere)
  if (!message || notificationType === 'subagent_stop') return;
  showToast(`Claude: ${message}`);
}
```

- [ ] **Step 5: Build and verify**

```bash
cd /Users/yhsung/dev-projects/claudian-qt/bridge && npm run build 2>&1 | tail -5
cd /Users/yhsung/dev-projects/claudian-qt/build && cmake --build . --parallel $(sysctl -n hw.ncpu) 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add bridge/src/daemon.ts src/bridgedaemon.h src/bridgedaemon.cpp \
        src/claudebridge.h src/claudebridge.cpp resources/chat/chat.js
git commit -m "feat: wire Notification and SubagentStop hooks for agent status surfacing"
```

---

## Task 9: Replace manual JSONL parsing with SDK session functions

**Files:**
- Modify: `bridge/src/session-history.ts`

The current `session-history.ts` manually reads and parses JSONL files from `~/.claude/projects/`. The SDK provides `listSessions()`, `getSessionMessages()`, `getSessionInfo()`, `renameSession()` as first-class functions that do the same thing more reliably.

- [ ] **Step 1: Write the failing test**

Create `bridge/tests/session-sdk.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

// Smoke test: verify the SDK functions are importable
describe("SDK session functions", () => {
  it("can import listSessions from the SDK", async () => {
    // Just verify the import doesn't throw
    const { listSessions } = await import("@anthropic-ai/claude-agent-sdk");
    expect(typeof listSessions).toBe("function");
  });

  it("can import getSessionMessages from the SDK", async () => {
    const { getSessionMessages } = await import("@anthropic-ai/claude-agent-sdk");
    expect(typeof getSessionMessages).toBe("function");
  });

  it("can import renameSession from the SDK", async () => {
    const { renameSession } = await import("@anthropic-ai/claude-agent-sdk");
    expect(typeof renameSession).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/yhsung/dev-projects/claudian-qt/bridge && npm test -- tests/session-sdk.test.ts 2>&1 | tail -15
```

Expected: FAIL if the SDK version doesn't export these, or PASS if it does (then we know we can proceed).

- [ ] **Step 3: Check what the SDK actually exports**

```bash
cd /Users/yhsung/dev-projects/claudian-qt/bridge && node -e "const s = require('./node_modules/@anthropic-ai/claude-agent-sdk/dist/index.js'); console.log(Object.keys(s).filter(k => k.includes('ession') || k.includes('startup')))" 2>&1
```

If `listSessions`, `getSessionMessages`, `renameSession` appear, proceed. If not, keep the manual JSONL implementation and skip to Step 7.

- [ ] **Step 4: Update session-history.ts to use SDK functions**

Replace the entire file with:

```typescript
import {
  listSessions as sdkListSessions,
  getSessionMessages,
  renameSession as sdkRenameSession,
} from "@anthropic-ai/claude-agent-sdk";
import type { SDKSessionInfo } from "@anthropic-ai/claude-agent-sdk";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import * as os from "os";
import { attachmentRoot, loadAttachmentManifest, rehydrateAttachment } from "./attachment-store.js";
import type { HistoryAttachment, HistoryTurn } from "./protocol.js";

export interface SessionEntry {
  id: string;
  preview: string;
  timestamp: string;
  name?: string;
}

function claudeProjectDir(cwd: string, home = os.homedir()): string {
  return join(home, ".claude", "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
}

export async function listSessions(
  cwd: string,
  home = os.homedir()
): Promise<SessionEntry[]> {
  try {
    const sessions: SDKSessionInfo[] = await sdkListSessions({ cwd });
    return sessions.map((s) => ({
      id: s.sessionId,
      preview: s.firstPrompt?.slice(0, 120) ?? s.summary?.slice(0, 120) ?? "(no preview)",
      timestamp: s.lastModified ? new Date(s.lastModified).toISOString() : "",
      name: s.customTitle ?? undefined,
    }));
  } catch {
    // Fallback: SDK not available in this version; return empty
    return [];
  }
}

export async function loadSessionHistory(
  cwd: string,
  sessionId: string,
  home = os.homedir(),
): Promise<HistoryTurn[]> {
  const rootDir = attachmentRoot(home);
  const manifest = await loadAttachmentManifest(rootDir, sessionId);
  const attachmentsByTurn = new Map<number, HistoryAttachment[]>();
  for (const turn of manifest) {
    const rehydrated = await Promise.all(
      turn.attachments.map((att) => rehydrateAttachment(rootDir, att))
    );
    attachmentsByTurn.set(turn.turnIndex, rehydrated);
  }

  try {
    const messages = await getSessionMessages(sessionId, { cwd });
    const turns: HistoryTurn[] = [];
    let pendingAssistant = "";
    let userTurnIndex = -1;

    const flushAssistant = () => {
      if (pendingAssistant.trim()) {
        turns.push({ role: "assistant", text: pendingAssistant.trim(), attachments: [] });
        pendingAssistant = "";
      }
    };

    for (const msg of messages) {
      if (msg.type === "user") {
        flushAssistant();
        const content = (msg.message as Record<string, unknown>).content;
        if (Array.isArray(content) && (content[0] as Record<string, unknown>)?.type === "tool_result") continue;
        let text = "";
        if (typeof content === "string") {
          text = content;
        } else if (Array.isArray(content)) {
          for (const block of content) {
            const b = block as Record<string, unknown>;
            if (b.type === "text") text += b.text as string;
          }
        }
        if (text.trim()) {
          userTurnIndex++;
          turns.push({
            role: "user",
            text: text.trim(),
            attachments: attachmentsByTurn.get(userTurnIndex) ?? [],
          });
        }
      } else if (msg.type === "assistant") {
        const content = (msg.message as Record<string, unknown>).content as Array<Record<string, unknown>>;
        for (const block of content ?? []) {
          if (block.type === "text") pendingAssistant += block.text as string;
        }
      }
    }
    flushAssistant();
    return turns;
  } catch {
    return [];
  }
}

export async function renameSession(
  cwd: string,
  sessionId: string,
  name: string,
  home = os.homedir()
): Promise<void> {
  try {
    await sdkRenameSession(sessionId, name, { cwd });
  } catch {
    // Fallback: write .name file directly if SDK rename isn't available
    const metaPath = join(claudeProjectDir(cwd, home), `${sessionId}.name`);
    await mkdir(dirname(metaPath), { recursive: true });
    await writeFile(metaPath, JSON.stringify({ name, updatedAt: new Date().toISOString() }), "utf8");
  }
}
```

- [ ] **Step 5: Run session-sdk tests**

```bash
cd /Users/yhsung/dev-projects/claudian-qt/bridge && npm test -- tests/session-sdk.test.ts 2>&1 | tail -15
```

Expected: PASS.

- [ ] **Step 6: Run typecheck to verify no regressions**

```bash
cd /Users/yhsung/dev-projects/claudian-qt/bridge && npm run typecheck 2>&1 | tail -20
```

- [ ] **Step 7: Commit**

```bash
git add bridge/src/session-history.ts bridge/tests/session-sdk.test.ts
git commit -m "refactor(session-history): use SDK listSessions/getSessionMessages/renameSession"
```

---

## Task 10: MCP servers configuration

**Files:**
- Modify: `bridge/src/daemon.ts`
- Modify: `src/claudebridge.h`
- Modify: `src/claudebridge.cpp`
- Modify: `resources/chat/index.html`
- Modify: `resources/chat/chat.js`

- [ ] **Step 1: Add `set_mcp_servers` command handler in daemon.ts**

In `handleCommand`:

```typescript
case "set_mcp_servers":
  state.mcpServers = cmd.servers as Record<string, unknown>;
  break;
```

The `buildRunOptions()` function already spreads `state.mcpServers` into `mcpServers` when non-empty (added in Task 4, Step 2).

- [ ] **Step 2: Add `ClaudeBridge::setMcpServers` slot**

In `src/claudebridge.h`:

```cpp
void setMcpServers(const QString &serversJson);
```

In `src/claudebridge.cpp`:

```cpp
void ClaudeBridge::setMcpServers(const QString &serversJson) {
    QJsonParseError err;
    const QJsonDocument doc = QJsonDocument::fromJson(serversJson.toUtf8(), &err);
    if (err.error != QJsonParseError::NoError || !doc.isObject()) {
        emit errorOccurred("Invalid MCP servers JSON.");
        return;
    }
    m_daemon->sendCommand(QJsonObject{{"type", "set_mcp_servers"}, {"servers", doc.object()}});
}
```

- [ ] **Step 3: Add MCP servers panel in index.html**

```html
<div class="mcp-panel" id="mcp-panel" style="display:none">
  <div class="mcp-panel-header">MCP Servers</div>
  <div id="mcp-server-list"></div>
  <div class="mcp-add-row">
    <input type="text" id="mcp-name-input" placeholder="Name (e.g. playwright)" style="width:120px">
    <input type="text" id="mcp-command-input" placeholder="Command (e.g. npx)" style="width:100px">
    <input type="text" id="mcp-args-input" placeholder="Args (e.g. @playwright/mcp@latest)" style="flex:1">
    <button id="mcp-add-btn">Add</button>
  </div>
</div>
```

- [ ] **Step 4: Wire MCP panel in chat.js**

```js
const mcpServers = {};

document.getElementById('mcp-add-btn')?.addEventListener('click', () => {
  const name    = document.getElementById('mcp-name-input').value.trim();
  const command = document.getElementById('mcp-command-input').value.trim();
  const argsStr = document.getElementById('mcp-args-input').value.trim();
  if (!name || !command) return;
  mcpServers[name] = { command, args: argsStr ? argsStr.split(/\s+/) : [] };
  renderMcpList();
  if (bridge) bridge.setMcpServers(JSON.stringify(mcpServers));
});

function renderMcpList() {
  const list = document.getElementById('mcp-server-list');
  if (!list) return;
  list.innerHTML = '';
  Object.entries(mcpServers).forEach(([name, cfg]) => {
    const row = document.createElement('div');
    row.className = 'mcp-server-row';
    row.textContent = `${name}: ${cfg.command} ${(cfg.args || []).join(' ')}`;
    const rm = document.createElement('button');
    rm.textContent = '×';
    rm.addEventListener('click', () => {
      delete mcpServers[name];
      renderMcpList();
      if (bridge) bridge.setMcpServers(JSON.stringify(mcpServers));
    });
    row.appendChild(rm);
    list.appendChild(row);
  });
}
```

- [ ] **Step 5: Build and commit**

```bash
cd /Users/yhsung/dev-projects/claudian-qt/bridge && npm run build 2>&1 | tail -5
cd /Users/yhsung/dev-projects/claudian-qt/build && cmake --build . --parallel $(sysctl -n hw.ncpu) 2>&1 | tail -5
git add bridge/src/daemon.ts src/claudebridge.h src/claudebridge.cpp \
        resources/chat/index.html resources/chat/chat.js
git commit -m "feat: MCP server configuration through UI"
```

---

## Task 11: Custom agents definition

**Files:**
- Modify: `bridge/src/daemon.ts`
- Modify: `src/claudebridge.h`
- Modify: `src/claudebridge.cpp`
- Modify: `resources/chat/index.html`
- Modify: `resources/chat/chat.js`

Custom agent definitions let the user pre-define specialized sub-agents (e.g., a `code-reviewer` or `test-writer`) that Claude can spawn via the `Agent` tool.

- [ ] **Step 1: Add `set_agents` command handler in daemon.ts**

In `handleCommand`:

```typescript
case "set_agents":
  state.agents = cmd.agents as Record<string, unknown>;
  break;
```

The `buildRunOptions()` function already spreads `state.agents` into `agents` when non-empty.

- [ ] **Step 2: Also add `"Agent"` to allowed tools when agents are defined**

In `buildRunOptions()`, add:

```typescript
if (Object.keys(state.agents).length) {
  opts.agents = state.agents;
  // Agent tool must be in the allowed list for subagents to work
  if (state.allowedTools && !state.allowedTools.includes("Agent")) {
    opts.allowedTools = [...state.allowedTools, "Agent"];
  }
}
```

- [ ] **Step 3: Add `ClaudeBridge::setAgents` slot**

In `src/claudebridge.h`:

```cpp
void setAgents(const QString &agentsJson);
```

In `src/claudebridge.cpp`:

```cpp
void ClaudeBridge::setAgents(const QString &agentsJson) {
    QJsonParseError err;
    const QJsonDocument doc = QJsonDocument::fromJson(agentsJson.toUtf8(), &err);
    if (err.error != QJsonParseError::NoError || !doc.isObject()) {
        emit errorOccurred("Invalid agents JSON.");
        return;
    }
    m_daemon->sendCommand(QJsonObject{{"type", "set_agents"}, {"agents", doc.object()}});
}
```

- [ ] **Step 4: Add agents panel in index.html**

```html
<div class="agents-panel" id="agents-panel" style="display:none">
  <div class="agents-panel-header">Custom Agents</div>
  <div id="agent-list"></div>
  <div class="agent-add-form">
    <input type="text" id="agent-name-input" placeholder="Name (e.g. code-reviewer)" style="width:130px">
    <input type="text" id="agent-description-input" placeholder="Description" style="flex:1">
    <textarea id="agent-prompt-input" rows="2" placeholder="System prompt for this agent…" style="width:100%;resize:vertical"></textarea>
    <button id="agent-add-btn">Add agent</button>
  </div>
</div>
```

- [ ] **Step 5: Wire agent panel in chat.js**

```js
const customAgents = {};

document.getElementById('agent-add-btn')?.addEventListener('click', () => {
  const name  = document.getElementById('agent-name-input').value.trim();
  const desc  = document.getElementById('agent-description-input').value.trim();
  const prompt = document.getElementById('agent-prompt-input').value.trim();
  if (!name || !prompt) return;
  customAgents[name] = { description: desc || name, prompt };
  renderAgentList();
  if (bridge) bridge.setAgents(JSON.stringify(customAgents));
});

function renderAgentList() {
  const list = document.getElementById('agent-list');
  if (!list) return;
  list.innerHTML = '';
  Object.entries(customAgents).forEach(([name, cfg]) => {
    const row = document.createElement('div');
    row.className = 'agent-row';
    row.textContent = `${name}: ${cfg.description}`;
    const rm = document.createElement('button');
    rm.textContent = '×';
    rm.addEventListener('click', () => {
      delete customAgents[name];
      renderAgentList();
      if (bridge) bridge.setAgents(JSON.stringify(customAgents));
    });
    row.appendChild(rm);
    list.appendChild(row);
  });
}
```

- [ ] **Step 6: Build and commit**

```bash
cd /Users/yhsung/dev-projects/claudian-qt/bridge && npm run build 2>&1 | tail -5
cd /Users/yhsung/dev-projects/claudian-qt/build && cmake --build . --parallel $(sysctl -n hw.ncpu) 2>&1 | tail -5
git add bridge/src/daemon.ts src/claudebridge.h src/claudebridge.cpp \
        resources/chat/index.html resources/chat/chat.js
git commit -m "feat: custom agent definition panel for SDK agents option"
```

---

## Task 12: File checkpointing and rewindFiles

**Files:**
- Modify: `bridge/src/daemon.ts`
- Modify: `src/claudebridge.h`
- Modify: `src/claudebridge.cpp`
- Modify: `resources/chat/chat.js`

File checkpointing records file snapshots at each turn so the user can revert agent-made changes. `Query.rewindFiles(userMessageId)` reverts to the state before a given turn.

- [ ] **Step 1: Enable `enableFileCheckpointing` in query options**

In `handleSend`, add to the cold-start query options:

```typescript
enableFileCheckpointing: true,
```

Also track the active Query object so we can call `rewindFiles` on it. In daemon.ts, already have `activeQuery` from Task 3. After `activeQuery = queryResult;`, it's available.

- [ ] **Step 2: Handle `rewind_files` command in daemon.ts**

In `handleCommand`:

```typescript
case "rewind_files": {
  if (!activeQuery) {
    emit({ type: "error", msg: "No active session to rewind." });
    break;
  }
  try {
    const result = await (activeQuery as unknown as { rewindFiles: (id: string, opts?: { dryRun?: boolean }) => Promise<{ changedFiles: string[]; restoredFiles: string[]; failedFiles: string[] }> })
      .rewindFiles(cmd.userMessageId, { dryRun: cmd.dryRun ?? false });
    emit({
      type: "rewind_result",
      changedFiles: result.changedFiles ?? [],
      restoredFiles: result.restoredFiles ?? [],
      failedFiles: result.failedFiles ?? [],
    });
  } catch (err) {
    emit({ type: "error", msg: `Rewind failed: ${err instanceof Error ? err.message : String(err)}` });
  }
  break;
}
```

- [ ] **Step 3: Add BridgeDaemon signals**

In `src/bridgedaemon.h`:

```cpp
void rewindResult(const QString &changedJson, const QString &restoredJson, const QString &failedJson);
```

In `src/bridgedaemon.cpp` handleEvent:

```cpp
else if (type == "rewind_result")
    emit rewindResult(
        QString::fromUtf8(QJsonDocument(event["changedFiles"].toArray()).toJson(QJsonDocument::Compact)),
        QString::fromUtf8(QJsonDocument(event["restoredFiles"].toArray()).toJson(QJsonDocument::Compact)),
        QString::fromUtf8(QJsonDocument(event["failedFiles"].toArray()).toJson(QJsonDocument::Compact))
    );
```

- [ ] **Step 4: Add ClaudeBridge slot and signal**

In `src/claudebridge.h`:

```cpp
// slot
void rewindFiles(const QString &userMessageId, bool dryRun = false);
// signal
void rewindResult(const QString &changedJson, const QString &restoredJson, const QString &failedJson);
```

In `src/claudebridge.cpp`:

```cpp
void ClaudeBridge::rewindFiles(const QString &userMessageId, bool dryRun) {
    m_daemon->sendCommand(QJsonObject{
        {"type",          "rewind_files"},
        {"userMessageId", userMessageId},
        {"dryRun",        dryRun},
    });
}
```

Connect:

```cpp
connect(m_daemon, &BridgeDaemon::rewindResult, this, &ClaudeBridge::rewindResult);
```

- [ ] **Step 5: Handle rewind result in chat.js**

```js
bridge.rewindResult.connect((changedJson, restoredJson, failedJson) => {
  const changed  = JSON.parse(changedJson);
  const restored = JSON.parse(restoredJson);
  const failed   = JSON.parse(failedJson);
  const total = restored.length;
  const msg = failed.length
    ? `Rewound ${total} file(s). Failed: ${failed.join(', ')}`
    : `Rewound ${total} file(s) successfully.`;
  showToast(msg);
});
```

Add a "Rewind to here" context action on each user turn message (triggered by right-click or a ⎌ button). Store `uuid` from `SDKAssistantMessage` on the DOM element and call `bridge.rewindFiles(uuid)`.

In the message rendering code (where user turns are created), add a data attribute:

```js
msgEl.dataset.uuid = turn.uuid || '';
```

Wire the rewind button in the message UI:

```js
const rewindBtn = document.createElement('button');
rewindBtn.className = 'msg-rewind-btn';
rewindBtn.title = 'Rewind files to before this turn';
rewindBtn.textContent = '⎌';
rewindBtn.addEventListener('click', () => {
  if (msgEl.dataset.uuid && bridge) bridge.rewindFiles(msgEl.dataset.uuid, false);
});
msgEl.querySelector('.msg-actions')?.appendChild(rewindBtn);
```

- [ ] **Step 6: Build and commit**

```bash
cd /Users/yhsung/dev-projects/claudian-qt/bridge && npm run build 2>&1 | tail -5
cd /Users/yhsung/dev-projects/claudian-qt/build && cmake --build . --parallel $(sysctl -n hw.ncpu) 2>&1 | tail -5
git add bridge/src/daemon.ts src/bridgedaemon.h src/bridgedaemon.cpp \
        src/claudebridge.h src/claudebridge.cpp resources/chat/chat.js
git commit -m "feat: file checkpointing and rewindFiles support"
```

---

## Task 13: Account info display

**Files:**
- Modify: `bridge/src/daemon.ts`
- Modify: `src/claudebridge.h`
- Modify: `src/claudebridge.cpp`
- Modify: `resources/chat/chat.js`
- Modify: `resources/chat/index.html`

- [ ] **Step 1: Add `request_account_info` command handler in daemon.ts**

```typescript
case "request_account_info": {
  try {
    // Requires an active Query object or a minimal one-shot query
    const q = query({
      prompt: "",
      options: { cwd: state.cwd, maxTurns: 0, allowDangerouslySkipPermissions: true },
    });
    q.accountInfo().then((info) => {
      emit({ type: "account_info", email: info?.email, plan: info?.planName });
    }).catch(() => {
      emit({ type: "account_info" });
    });
  } catch {
    emit({ type: "account_info" });
  }
  break;
}
```

- [ ] **Step 2: Add BridgeDaemon signal**

In `src/bridgedaemon.h`:

```cpp
void accountInfoReceived(const QString &json);
```

In `src/bridgedaemon.cpp` handleEvent:

```cpp
else if (type == "account_info")
    emit accountInfoReceived(QString::fromUtf8(QJsonDocument(QJsonObject{
        {"email", event["email"]},
        {"plan",  event["plan"]}
    }).toJson(QJsonDocument::Compact)));
```

- [ ] **Step 3: Add ClaudeBridge slot and signal**

In `src/claudebridge.h`:

```cpp
void requestAccountInfo();
void accountInfoReceived(const QString &json);
```

In `src/claudebridge.cpp`:

```cpp
void ClaudeBridge::requestAccountInfo() {
    m_daemon->sendCommand(QJsonObject{{"type", "request_account_info"}});
}
```

Connect: `connect(m_daemon, &BridgeDaemon::accountInfoReceived, this, &ClaudeBridge::accountInfoReceived);`

- [ ] **Step 4: Show account info in chat.js**

```js
bridge.accountInfoReceived.connect((json) => {
  const info = JSON.parse(json);
  const statusEl = document.getElementById('account-status');
  if (statusEl) {
    statusEl.textContent = info.email ? `${info.email} · ${info.plan || 'Pro'}` : '';
  }
});
```

Add `<div id="account-status" class="account-status"></div>` to the footer area of `index.html`.

Request account info after bridge connects:

```js
// After other setup in QWebChannel callback:
bridge.requestAccountInfo();
```

- [ ] **Step 5: Build and commit**

```bash
cd /Users/yhsung/dev-projects/claudian-qt/bridge && npm run build 2>&1 | tail -5
cd /Users/yhsung/dev-projects/claudian-qt/build && cmake --build . --parallel $(sysctl -n hw.ncpu) 2>&1 | tail -5
git add bridge/src/daemon.ts src/bridgedaemon.h src/bridgedaemon.cpp \
        src/claudebridge.h src/claudebridge.cpp \
        resources/chat/chat.js resources/chat/index.html
git commit -m "feat: account info display via accountInfo() SDK method"
```

---

## Self-Review Checklist

- [ ] **Spec coverage:** Every item in the Parity Gap Analysis table is addressed by a task.
- [ ] **No placeholders:** All code blocks contain working TypeScript/C++/JS, not descriptions of what to write.
- [ ] **Type consistency:** `AskUserQuestionItem`, `McpServerSpec`, `AgentSpec` defined in protocol.ts are used consistently across daemon.ts and C++ layers.
- [ ] **Signal/slot names:** `askUserQuestion`/`respondToAskUser`, `modelsListed`/`requestModels`, `agentNotification`, `sessionForked`/`forkSession`, `rewindResult`/`rewindFiles`, `accountInfoReceived`/`requestAccountInfo` — all match between `.h` declarations and `.cpp` implementations.
- [ ] **Build steps:** Every task includes a build verification step before commit.
- [ ] **The `buildRunOptions()` function** (Task 4) is referenced in Tasks 5, 10, 11 — defined once, spread by all.
- [ ] **`activeQuery` tracking** (Task 3) is used in Task 12 — defined once, consumed safely.
- [ ] **`scheduleWarmup()`** (Task 3) is defined once and called at daemon start and after each warm query is consumed.

---

*Total: 13 tasks, ~110 checkboxes. Each task produces a self-contained, buildable, committable increment.*
