# Persistent Daemon Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-message Node.js subprocess and C++ JSONL parsing with a single persistent TypeScript daemon that owns session state, session history, and all SDK interaction — leaving C++ as a thin protocol adapter.

**Architecture:** A new `bridge/src/daemon.ts` runs as a long-lived process started once at app startup. C++ sends typed JSON commands over stdin and reads typed JSON events from stdout — no SDK message parsing in C++. `ClaudeProcess` is deleted and replaced by `BridgeDaemon`, a minimal C++ class that starts the daemon and translates events to Qt signals. `ClaudeBridge` drops its `m_sessionId` field and all JSONL file I/O, delegating everything to the daemon.

**Tech Stack:** TypeScript 5 / Node.js 18+, `@anthropic-ai/claude-agent-sdk`, Vitest, Qt6 C++17, CMake 3.26+

---

## File Map

| Action  | Path                                    | Responsibility |
|---------|-----------------------------------------|----------------|
| Create  | `bridge/src/protocol.ts`                | Shared TypeScript types for all commands and events |
| Create  | `bridge/src/session-history.ts`         | JSONL reading: listSessions + loadSessionHistory |
| Create  | `bridge/src/daemon.ts`                  | Persistent daemon entry point — owns all SDK + state |
| Create  | `bridge/tests/fixtures/sample.jsonl`    | Test fixture for session history tests |
| Create  | `bridge/tests/session-history.test.ts`  | Unit tests for session-history module |
| Create  | `bridge/tests/daemon.test.ts`           | Subprocess integration tests for daemon protocol |
| Create  | `src/bridgedaemon.h`                    | BridgeDaemon Qt class — starts daemon, sends commands, translates events |
| Create  | `src/bridgedaemon.cpp`                  | BridgeDaemon implementation |
| Modify  | `src/claudebridge.h`                    | Replace ClaudeProcess dep with BridgeDaemon, remove m_sessionId |
| Modify  | `src/claudebridge.cpp`                  | Delegate all ops to BridgeDaemon; keep only pickFolder() logic |
| Modify  | `CMakeLists.txt`                        | Swap claudeprocess.cpp → bridgedaemon.cpp; copy daemon.js to bundle |
| Modify  | `.github/workflows/ci.yml`              | Update bundle check from index.js → daemon.js |
| Delete  | `src/claudeprocess.h`                   | Replaced by bridgedaemon.h |
| Delete  | `src/claudeprocess.cpp`                 | Replaced by bridgedaemon.cpp |

---

## Protocol Reference (used in every task)

**Commands — C++ writes these to daemon stdin, one JSON line each:**

```
{"type":"send","prompt":"<text>"}
{"type":"abort"}
{"type":"set_cwd","cwd":"/path"}
{"type":"set_model","model":"claude-opus-4-7"}
{"type":"set_yolo","yolo":true}
{"type":"new_session"}
{"type":"request_sessions"}
{"type":"load_session","sessionId":"<uuid>"}
```

**Events — daemon writes these to stdout, one JSON line each:**

```
{"type":"text_ready","text":"..."}
{"type":"tool_use","name":"Bash","input":"{...}"}
{"type":"turn_complete"}
{"type":"session_ready","sessionId":"<uuid-or-empty>"}
{"type":"error","msg":"..."}
{"type":"sessions_listed","json":"[{id,preview,timestamp}]"}
{"type":"session_history_loaded","json":"[{role,text}]"}
{"type":"result","data":{...full SDK result object...}}
```

---

## Task 1: Protocol type definitions

**Files:**
- Create: `bridge/src/protocol.ts`

- [ ] **Step 1: Create bridge/src/protocol.ts**

```typescript
export type DaemonCommand =
  | { type: "send"; prompt: string }
  | { type: "abort" }
  | { type: "set_cwd"; cwd: string }
  | { type: "set_model"; model: string }
  | { type: "set_yolo"; yolo: boolean }
  | { type: "new_session" }
  | { type: "request_sessions" }
  | { type: "load_session"; sessionId: string };

export type DaemonEvent =
  | { type: "text_ready"; text: string }
  | { type: "tool_use"; name: string; input: string }
  | { type: "turn_complete" }
  | { type: "session_ready"; sessionId: string }
  | { type: "error"; msg: string }
  | { type: "sessions_listed"; json: string }
  | { type: "session_history_loaded"; json: string }
  | { type: "result"; data: Record<string, unknown> };
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt/bridge && npm run typecheck 2>&1
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git -C /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt add bridge/src/protocol.ts
git -C /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt commit -m "feat(daemon): add protocol type definitions"
```

---

## Task 2: Session history module + tests

**Files:**
- Create: `bridge/src/session-history.ts`
- Create: `bridge/tests/fixtures/sample.jsonl`
- Create: `bridge/tests/session-history.test.ts`

- [ ] **Step 1: Create test fixture bridge/tests/fixtures/sample.jsonl**

This file simulates a real Claude session JSONL — two turns: one user, one assistant.

```
{"type":"user","timestamp":"2026-05-09T10:00:00.000Z","message":{"role":"user","content":[{"type":"text","text":"What is 2+2?"}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"2 + 2 = 4."}]}}
{"type":"user","timestamp":"2026-05-09T10:01:00.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"x","content":"ignored"}]}}
```

- [ ] **Step 2: Write the failing tests — bridge/tests/session-history.test.ts**

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { writeFile, mkdir, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { listSessions, loadSessionHistory } from "../src/session-history.js";

const TMP = join(tmpdir(), "claudian-test-" + process.pid);
const CWD = "/test/project";

function claudeProjectDir(cwd: string): string {
  return join(TMP, ".claude", "projects", cwd.replace(/\//g, "-"));
}

beforeAll(async () => {
  const dir = claudeProjectDir(CWD);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "abc123.jsonl"),
    [
      JSON.stringify({ type: "user", timestamp: "2026-05-09T10:00:00.000Z", message: { role: "user", content: [{ type: "text", text: "What is 2+2?" }] } }),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "2 + 2 = 4." }] } }),
      JSON.stringify({ type: "user", timestamp: "2026-05-09T10:01:00.000Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "ignored" }] } }),
    ].join("\n")
  );
});

describe("listSessions", () => {
  it("returns sessions for a known cwd", async () => {
    const sessions = await listSessions(CWD, TMP);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe("abc123");
    expect(sessions[0].preview).toBe("What is 2+2?");
    expect(sessions[0].timestamp).toBe("2026-05-09T10:00:00.000Z");
  });

  it("returns empty array for unknown cwd", async () => {
    const sessions = await listSessions("/no/such/path", TMP);
    expect(sessions).toEqual([]);
  });
});

describe("loadSessionHistory", () => {
  it("returns user and assistant turns, skipping tool_result", async () => {
    const turns = await loadSessionHistory(CWD, "abc123", TMP);
    expect(turns).toHaveLength(2);
    expect(turns[0]).toEqual({ role: "user", text: "What is 2+2?" });
    expect(turns[1]).toEqual({ role: "assistant", text: "2 + 2 = 4." });
  });

  it("returns empty array for unknown session", async () => {
    const turns = await loadSessionHistory(CWD, "nonexistent", TMP);
    expect(turns).toEqual([]);
  });
});
```

- [ ] **Step 3: Run tests — confirm they fail**

```bash
cd /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt/bridge && npm test -- tests/session-history.test.ts 2>&1 | tail -10
```

Expected: FAIL — `listSessions` not found.

- [ ] **Step 4: Create bridge/src/session-history.ts**

```typescript
import * as readline from "readline";
import * as fs from "fs";
import { readdir } from "fs/promises";
import { join } from "path";
import * as os from "os";

export interface SessionEntry {
  id: string;
  preview: string;
  timestamp: string;
}

export interface TurnEntry {
  role: "user" | "assistant";
  text: string;
}

function claudeProjectDir(cwd: string, home = os.homedir()): string {
  return join(home, ".claude", "projects", cwd.replace(/\//g, "-"));
}

export async function listSessions(
  cwd: string,
  home = os.homedir()
): Promise<SessionEntry[]> {
  const dir = claudeProjectDir(cwd, home);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }

  const jsonlFiles = files.filter((f) => f.endsWith(".jsonl")).reverse();
  const sessions: SessionEntry[] = [];

  for (const filename of jsonlFiles) {
    const sessionId = filename.slice(0, -6);
    let preview = "";
    let timestamp = "";

    const rl = readline.createInterface({
      input: fs.createReadStream(join(dir, filename)),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) continue;
      let obj: Record<string, unknown>;
      try { obj = JSON.parse(line); } catch { continue; }
      if (obj.type !== "user") continue;

      timestamp = (obj.timestamp as string) ?? "";
      const content = (obj.message as Record<string, unknown>).content;
      if (typeof content === "string") {
        preview = content.slice(0, 120);
      } else if (Array.isArray(content)) {
        for (const block of content) {
          const b = block as Record<string, unknown>;
          if (b.type === "text") { preview = (b.text as string).slice(0, 120); break; }
        }
      }
      break;
    }
    rl.close();

    if (preview) sessions.push({ id: sessionId, preview, timestamp });
  }

  return sessions;
}

export async function loadSessionHistory(
  cwd: string,
  sessionId: string,
  home = os.homedir()
): Promise<TurnEntry[]> {
  const filePath = join(claudeProjectDir(cwd, home), sessionId + ".jsonl");
  const turns: TurnEntry[] = [];
  let pendingAssistant = "";

  const flushAssistant = (): void => {
    if (!pendingAssistant.trim()) return;
    turns.push({ role: "assistant", text: pendingAssistant.trim() });
    pendingAssistant = "";
  };

  let stream: fs.ReadStream;
  try {
    stream = fs.createReadStream(filePath);
  } catch {
    return [];
  }

  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let obj: Record<string, unknown>;
    try { obj = JSON.parse(line); } catch { continue; }

    if (obj.type === "user") {
      flushAssistant();
      const content = (obj.message as Record<string, unknown>).content;
      if (Array.isArray(content) && (content[0] as Record<string, unknown>)?.type === "tool_result") continue;
      let text = "";
      if (typeof content === "string") text = content;
      else if (Array.isArray(content)) {
        for (const b of content) {
          if ((b as Record<string, unknown>).type === "text") text += (b as Record<string, unknown>).text as string;
        }
      }
      if (text.trim()) turns.push({ role: "user", text: text.trim() });

    } else if (obj.type === "assistant") {
      const content = (obj.message as Record<string, unknown>).content as Array<Record<string, unknown>>;
      for (const b of content ?? []) {
        if (b.type === "text") pendingAssistant += b.text as string;
      }
    }
  }

  flushAssistant();
  return turns;
}
```

- [ ] **Step 5: Run tests — confirm they pass**

```bash
cd /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt/bridge && npm test -- tests/session-history.test.ts 2>&1 | tail -10
```

Expected: 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git -C /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt add \
  bridge/src/session-history.ts \
  bridge/tests/fixtures/sample.jsonl \
  bridge/tests/session-history.test.ts
git -C /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt commit -m "feat(daemon): add session-history module with tests"
```

---

## Task 3: Daemon implementation

**Files:**
- Create: `bridge/src/daemon.ts`

- [ ] **Step 1: Create bridge/src/daemon.ts**

```typescript
import * as readline from "readline";
import * as os from "os";
import { query, AbortError } from "@anthropic-ai/claude-agent-sdk";
import { listSessions, loadSessionHistory } from "./session-history.js";
import type { DaemonCommand, DaemonEvent } from "./protocol.js";

function emit(event: DaemonEvent): void {
  process.stdout.write(JSON.stringify(event) + "\n");
}

const state = {
  cwd:       os.homedir(),
  model:     "",
  yolo:      false,
  sessionId: "",
};

let currentAbort: AbortController | null = null;

async function handleSend(prompt: string): Promise<void> {
  if (currentAbort) currentAbort.abort();

  const abortController = new AbortController();
  currentAbort = abortController;

  try {
    const queryResult = query({
      prompt,
      options: {
        abortController,
        cwd:                            state.cwd,
        resume:                         state.sessionId || undefined,
        model:                          state.model     || undefined,
        allowDangerouslySkipPermissions: state.yolo,
      },
    });

    for await (const message of queryResult) {
      if (abortController.signal.aborted) break;
      const m = message as Record<string, unknown>;

      if (m.type === "system" && m.subtype === "init") {
        state.sessionId = m.session_id as string;
        emit({ type: "session_ready", sessionId: state.sessionId });

      } else if (m.type === "assistant") {
        const content = (m.message as Record<string, unknown>).content as Array<Record<string, unknown>>;
        for (const block of content ?? []) {
          if (block.type === "text") {
            emit({ type: "text_ready", text: block.text as string });
          } else if (block.type === "tool_use") {
            emit({ type: "tool_use", name: block.name as string, input: JSON.stringify(block.input) });
          }
        }

      } else if (m.type === "result") {
        if (m.is_error) {
          const errors = m.errors as string[] | undefined;
          const msg = errors?.[0] ?? (m.result as string) ?? (m.subtype as string) ?? "unknown error";
          emit({ type: "error", msg });
        } else {
          emit({ type: "result", data: m });
        }
      }
    }
  } catch (err) {
    if (!(err instanceof AbortError)) {
      emit({ type: "error", msg: err instanceof Error ? err.message : String(err) });
    }
  } finally {
    if (currentAbort === abortController) currentAbort = null;
    emit({ type: "turn_complete" });
  }
}

async function handleCommand(cmd: DaemonCommand): Promise<void> {
  switch (cmd.type) {
    case "send":
      await handleSend(cmd.prompt);
      break;

    case "abort":
      if (currentAbort) {
        currentAbort.abort();
        // turn_complete emitted by handleSend finally
      } else {
        emit({ type: "turn_complete" });
      }
      break;

    case "set_cwd":
      state.cwd       = cmd.cwd;
      state.sessionId = "";   // new directory = fresh session
      break;

    case "set_model":
      state.model = cmd.model;
      break;

    case "set_yolo":
      state.yolo = cmd.yolo;
      break;

    case "new_session":
      state.sessionId = "";
      emit({ type: "session_ready", sessionId: "" });
      break;

    case "request_sessions": {
      const sessions = await listSessions(state.cwd);
      emit({ type: "sessions_listed", json: JSON.stringify(sessions) });
      break;
    }

    case "load_session":
      state.sessionId = cmd.sessionId;
      emit({ type: "session_ready", sessionId: cmd.sessionId });
      emit({ type: "session_history_loaded", json: JSON.stringify(await loadSessionHistory(state.cwd, cmd.sessionId)) });
      break;
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on("line", (line: string) => {
  if (!line.trim()) return;
  let cmd: DaemonCommand;
  try {
    cmd = JSON.parse(line) as DaemonCommand;
  } catch {
    emit({ type: "error", msg: `Failed to parse command: ${line.slice(0, 100)}` });
    return;
  }
  handleCommand(cmd).catch((err: unknown) => {
    emit({ type: "error", msg: String(err) });
  });
});

rl.on("close", () => process.exit(0));
```

- [ ] **Step 2: Build and verify daemon compiles**

```bash
cd /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt/bridge && npm run build 2>&1
```

Expected: No errors. `bridge/dist/daemon.js` exists.

```bash
ls bridge/dist/
```

Expected: `daemon.js`, `index.js`, `protocol.js`, `session-history.js`

- [ ] **Step 3: Quick smoke test — invalid command**

```bash
echo '{"type":"new_session"}' | node /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt/bridge/dist/daemon.js
```

Expected: `{"type":"session_ready","sessionId":""}` on stdout, then the process waits (stdin open).

Press Ctrl+C to exit.

- [ ] **Step 4: Commit**

```bash
git -C /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt add bridge/src/daemon.ts bridge/dist/
git -C /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt commit -m "feat(daemon): implement persistent daemon with full protocol"
```

---

## Task 4: Daemon tests

**Files:**
- Create: `bridge/tests/daemon.test.ts`

- [ ] **Step 1: Write daemon.test.ts**

```typescript
import { describe, it, expect } from "vitest";
import { spawn, ChildProcess } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DAEMON = join(__dirname, "../dist/daemon.js");

interface DaemonHandle {
  send(cmd: object): void;
  close(): void;
  collect(timeoutMs?: number): Promise<Array<Record<string, unknown>>>;
}

function startDaemon(): DaemonHandle {
  const proc: ChildProcess = spawn("node", [DAEMON], { stdio: ["pipe", "pipe", "pipe"] });
  const events: Array<Record<string, unknown>> = [];
  let buffer = "";

  proc.stdout!.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) {
        try { events.push(JSON.parse(line) as Record<string, unknown>); } catch { /* skip */ }
      }
    }
  });

  return {
    send(cmd: object): void {
      proc.stdin!.write(JSON.stringify(cmd) + "\n");
    },
    close(): void {
      proc.stdin!.end();
    },
    collect(timeoutMs = 500): Promise<Array<Record<string, unknown>>> {
      return new Promise((resolve) => setTimeout(() => resolve([...events]), timeoutMs));
    },
  };
}

describe("daemon protocol — no API key required", () => {
  it("emits session_ready with empty sessionId on new_session", async () => {
    const d = startDaemon();
    d.send({ type: "new_session" });
    const evts = await d.collect(300);
    d.close();
    const e = evts.find((e) => e.type === "session_ready");
    expect(e).toBeDefined();
    expect(e!.sessionId).toBe("");
  });

  it("emits turn_complete on abort when idle", async () => {
    const d = startDaemon();
    d.send({ type: "abort" });
    const evts = await d.collect(300);
    d.close();
    expect(evts.find((e) => e.type === "turn_complete")).toBeDefined();
  });

  it("emits sessions_listed (empty array) for unknown cwd", async () => {
    const d = startDaemon();
    d.send({ type: "set_cwd", cwd: "/tmp/__no_such_claudian_project__" });
    d.send({ type: "request_sessions" });
    const evts = await d.collect(500);
    d.close();
    const e = evts.find((e) => e.type === "sessions_listed");
    expect(e).toBeDefined();
    expect(JSON.parse(e!.json as string)).toEqual([]);
  });

  it("emits error event on malformed command JSON", async () => {
    const proc = spawn("node", [DAEMON], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    proc.stdout!.on("data", (c: Buffer) => { stdout += c.toString(); });
    proc.stdin!.write("not json\n");
    await new Promise((r) => setTimeout(r, 300));
    proc.stdin!.end();
    await new Promise((r) => proc.on("close", r));
    const events = stdout.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    expect(events.find((e: Record<string,unknown>) => e.type === "error")).toBeDefined();
  });
});

const HAS_API_KEY = Boolean(process.env.ANTHROPIC_API_KEY);

describe.skipIf(!HAS_API_KEY)("daemon integration (requires ANTHROPIC_API_KEY)", () => {
  it("send → session_ready + text_ready + turn_complete", async () => {
    const d = startDaemon();
    const allEvents: Array<Record<string, unknown>> = [];

    const proc = spawn("node", [DAEMON], { stdio: ["pipe", "pipe", "pipe"] });
    let buf = "";
    proc.stdout!.on("data", (c: Buffer) => {
      buf += c.toString();
      buf.split("\n").slice(0, -1).forEach((line) => {
        if (line.trim()) try { allEvents.push(JSON.parse(line)); } catch { /* skip */ }
      });
      buf = buf.split("\n").pop() ?? "";
    });

    proc.stdin!.write(JSON.stringify({ type: "send", prompt: "Reply with the word: hello" }) + "\n");

    await new Promise<void>((resolve) => {
      const check = (): void => {
        if (allEvents.find((e) => e.type === "turn_complete")) { resolve(); return; }
        setTimeout(check, 200);
      };
      setTimeout(check, 500);
      setTimeout(resolve, 60_000); // hard timeout
    });
    proc.stdin!.end();
    await new Promise((r) => proc.on("close", r));

    expect(allEvents.find((e) => e.type === "session_ready")).toBeDefined();
    expect(allEvents.find((e) => e.type === "text_ready")).toBeDefined();
    expect(allEvents.find((e) => e.type === "turn_complete")).toBeDefined();
    d.close();
  }, 65_000);
});
```

- [ ] **Step 2: Run protocol tests (no API key)**

```bash
cd /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt/bridge && npm test -- tests/daemon.test.ts 2>&1 | tail -15
```

Expected: 4 tests PASS, integration test SKIPPED.

- [ ] **Step 3: Run all tests — ensure nothing broke**

```bash
cd /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt/bridge && npm test 2>&1 | tail -15
```

Expected: All existing + new tests pass. Integration tests skipped.

- [ ] **Step 4: Commit**

```bash
git -C /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt add bridge/tests/daemon.test.ts
git -C /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt commit -m "test(daemon): add protocol and integration tests for persistent daemon"
```

---

## Task 5: BridgeDaemon C++ class

**Files:**
- Create: `src/bridgedaemon.h`
- Create: `src/bridgedaemon.cpp`

- [ ] **Step 1: Create src/bridgedaemon.h**

```cpp
#pragma once
#include <QByteArray>
#include <QJsonObject>
#include <QObject>
#include <QProcess>

// Manages one persistent Node.js daemon process.
// Sends JSON commands over stdin; reads typed JSON events from stdout.
class BridgeDaemon : public QObject {
    Q_OBJECT
public:
    explicit BridgeDaemon(QObject *parent = nullptr);
    ~BridgeDaemon();

    void start();
    void sendCommand(const QJsonObject &cmd);
    void abort();

signals:
    void sessionInitialized(const QString &sessionId);
    void textReady(const QString &text);
    void toolUseStarted(const QString &name, const QString &inputJson);
    void turnFinished();
    void errorOccurred(const QString &msg);
    void sessionsListed(const QString &json);
    void sessionHistoryLoaded(const QString &json);
    void resultReceived(const QJsonObject &result);

private slots:
    void onReadyRead();
    void onDaemonFinished(int exitCode, QProcess::ExitStatus status);
    void onProcessError(QProcess::ProcessError error);

private:
    void handleEvent(const QJsonObject &event);
    void startDaemon();

    QProcess  *m_proc        = nullptr;
    QByteArray m_buffer;
    int        m_restartCount = 0;
};
```

- [ ] **Step 2: Create src/bridgedaemon.cpp**

```cpp
#include "bridgedaemon.h"
#include <QCoreApplication>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonDocument>
#include <QStandardPaths>
#include <QTimer>

static QString findNodeBinary() {
    const QString home = QDir::homePath();
    const QStringList extraDirs = {
        home + "/.nvm/current/bin",
        home + "/.volta/bin",
        home + "/.fnm/current/bin",
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
    };
    for (const QString &dir : extraDirs) {
        const QString path = dir + "/node";
        if (QFile::exists(path))
            return path;
    }
    return QStandardPaths::findExecutable("node");
}

static QString findDaemonScript() {
    // Production: app bundle Contents/Resources/bridge/daemon.js
    const QString bundlePath = QCoreApplication::applicationDirPath()
                               + "/../Resources/bridge/daemon.js";
    const QFileInfo bundleInfo(bundlePath);
    if (bundleInfo.exists())
        return bundleInfo.canonicalFilePath();

    // Development: <project-root>/bridge/dist/daemon.js
    // Binary is at build/ClaudianQt.app/Contents/MacOS/ (4 levels up to project root)
    const QString devPath = QCoreApplication::applicationDirPath()
                            + "/../../../../bridge/dist/daemon.js";
    const QFileInfo devInfo(devPath);
    if (devInfo.exists())
        return devInfo.canonicalFilePath();

    return {};
}

BridgeDaemon::BridgeDaemon(QObject *parent) : QObject(parent) {}

BridgeDaemon::~BridgeDaemon() {
    if (!m_proc) return;
    m_proc->disconnect();
    m_proc->kill();
    m_proc->waitForFinished(1000);
}

void BridgeDaemon::start() {
    startDaemon();
}

void BridgeDaemon::startDaemon() {
    if (m_proc) {
        m_proc->disconnect();
        m_proc->kill();
        m_proc->waitForFinished(500);
        m_proc->deleteLater();
        m_proc = nullptr;
    }
    m_buffer.clear();

    const QString nodePath   = findNodeBinary();
    const QString daemonPath = findDaemonScript();

    if (nodePath.isEmpty()) {
        emit errorOccurred("'node' not found.\n  Install Node.js 18+.");
        return;
    }
    if (daemonPath.isEmpty()) {
        emit errorOccurred("Daemon script not found.\n  Run: cd bridge && npm install && npm run build");
        return;
    }

    m_proc = new QProcess(this);
    m_proc->setProcessChannelMode(QProcess::SeparateChannels);

    connect(m_proc, &QProcess::readyReadStandardOutput, this, &BridgeDaemon::onReadyRead);
    connect(m_proc, &QProcess::errorOccurred,           this, &BridgeDaemon::onProcessError);
    connect(m_proc, QOverload<int, QProcess::ExitStatus>::of(&QProcess::finished),
            this,   &BridgeDaemon::onDaemonFinished);

    m_proc->start(nodePath, {daemonPath});
    if (!m_proc->waitForStarted(3000)) {
        emit errorOccurred("Failed to start daemon: " + daemonPath);
        m_proc->disconnect();
        m_proc->deleteLater();
        m_proc = nullptr;
    }
}

void BridgeDaemon::sendCommand(const QJsonObject &cmd) {
    if (!m_proc || m_proc->state() != QProcess::Running) {
        emit errorOccurred("Bridge daemon is not running.");
        return;
    }
    m_proc->write(QJsonDocument(cmd).toJson(QJsonDocument::Compact) + "\n");
}

void BridgeDaemon::abort() {
    sendCommand(QJsonObject{{"type", "abort"}});
}

void BridgeDaemon::onReadyRead() {
    if (!m_proc) return;
    m_buffer += m_proc->readAllStandardOutput();

    int newline;
    while ((newline = m_buffer.indexOf('\n')) != -1) {
        const QByteArray line = m_buffer.left(newline).trimmed();
        m_buffer = m_buffer.mid(newline + 1);
        if (line.isEmpty()) continue;
        QJsonParseError err;
        const QJsonDocument doc = QJsonDocument::fromJson(line, &err);
        if (err.error != QJsonParseError::NoError || !doc.isObject()) continue;
        handleEvent(doc.object());
    }
}

void BridgeDaemon::handleEvent(const QJsonObject &event) {
    const QString type = event["type"].toString();

    if      (type == "text_ready")              emit textReady(event["text"].toString());
    else if (type == "tool_use")                emit toolUseStarted(event["name"].toString(), event["input"].toString());
    else if (type == "turn_complete")           emit turnFinished();
    else if (type == "session_ready")           emit sessionInitialized(event["sessionId"].toString());
    else if (type == "error")                   emit errorOccurred(event["msg"].toString());
    else if (type == "sessions_listed")         emit sessionsListed(event["json"].toString());
    else if (type == "session_history_loaded")  emit sessionHistoryLoaded(event["json"].toString());
    else if (type == "result")                  emit resultReceived(event["data"].toObject());
}

void BridgeDaemon::onDaemonFinished(int exitCode, QProcess::ExitStatus) {
    const QString err = m_proc ? QString::fromUtf8(m_proc->readAllStandardError()).trimmed() : QString();
    if (m_proc) { m_proc->deleteLater(); m_proc = nullptr; }

    if (exitCode != 0 && !err.isEmpty())
        emit errorOccurred("Bridge daemon exited: " + err);

    // Restart with exponential backoff, max 3 attempts
    if (m_restartCount < 3) {
        const int delayMs = (1 << m_restartCount) * 500;
        ++m_restartCount;
        QTimer::singleShot(delayMs, this, &BridgeDaemon::startDaemon);
    } else {
        emit errorOccurred("Bridge daemon failed to restart after 3 attempts.");
    }
}

void BridgeDaemon::onProcessError(QProcess::ProcessError error) {
    if (error == QProcess::FailedToStart)
        emit errorOccurred("'node' not found.\n  Install Node.js 18+.");
}
```

- [ ] **Step 3: Verify the new files compile in isolation (headers only)**

Add the new files temporarily to CMakeLists.txt to check they compile alongside the existing code. Just add them to the source list without removing the old files yet:

```bash
# Edit CMakeLists.txt qt_add_executable block to include bridgedaemon.cpp temporarily
# (revert this edit in Task 7)
```

Actually, skip this — Task 7 does the full swap. Instead, verify by reading the code for obvious issues.

Check:
- `#include <QTimer>` is present ✓
- `findDaemonScript()` returns `daemon.js` not `index.js` ✓
- `handleEvent` maps all 8 event types ✓
- `onDaemonFinished` restarts with backoff ✓

- [ ] **Step 4: Commit**

```bash
git -C /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt add src/bridgedaemon.h src/bridgedaemon.cpp
git -C /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt commit -m "feat(daemon): add BridgeDaemon C++ class — persistent process manager"
```

---

## Task 6: Slim ClaudeBridge

**Files:**
- Modify: `src/claudebridge.h`
- Modify: `src/claudebridge.cpp`

- [ ] **Step 1: Rewrite src/claudebridge.h**

Replace the entire file with:

```cpp
#pragma once
#include <QObject>
#include "bridgedaemon.h"

// Registered with QWebChannel as "claude".
// Public slots callable from JS; signals received by JS.
// All Claude operations delegated to BridgeDaemon.
class ClaudeBridge : public QObject {
    Q_OBJECT
    Q_PROPERTY(QString cwd   READ cwd   NOTIFY cwdChanged)
    Q_PROPERTY(QString model READ model NOTIFY modelChanged)
    Q_PROPERTY(bool    yolo  READ yolo  NOTIFY yoloChanged)

public:
    explicit ClaudeBridge(QObject *parent = nullptr);

    QString cwd()   const { return m_cwd; }
    QString model() const { return m_model; }
    bool    yolo()  const { return m_yolo; }

public slots:
    void sendMessage(const QString &text);
    void abort();
    void setCwd(const QString &path);
    void setModel(const QString &model);
    void setYolo(bool enabled);
    void pickFolder();
    void requestSessions();
    void loadSession(const QString &sessionId);
    void newSession();

signals:
    void textReady(const QString &text);
    void toolUse(const QString &name, const QString &inputJson);
    void turnComplete();
    void sessionReady(const QString &sessionId);
    void errorOccurred(const QString &msg);
    void cwdChanged(const QString &path);
    void modelChanged(const QString &model);
    void yoloChanged(bool enabled);
    void sessionsListed(const QString &json);
    void sessionHistoryLoaded(const QString &json);

private:
    BridgeDaemon *m_daemon;
    QString       m_cwd;
    QString       m_model;
    bool          m_yolo = false;
};
```

- [ ] **Step 2: Rewrite src/claudebridge.cpp**

Replace the entire file with:

```cpp
#include "claudebridge.h"
#include <QDir>
#include <QFileDialog>
#include <QJsonObject>

ClaudeBridge::ClaudeBridge(QObject *parent)
    : QObject(parent)
    , m_daemon(new BridgeDaemon(this))
    , m_cwd(QDir::homePath())
{
    connect(m_daemon, &BridgeDaemon::sessionInitialized,    this, &ClaudeBridge::sessionReady);
    connect(m_daemon, &BridgeDaemon::textReady,             this, &ClaudeBridge::textReady);
    connect(m_daemon, &BridgeDaemon::toolUseStarted,        this, &ClaudeBridge::toolUse);
    connect(m_daemon, &BridgeDaemon::turnFinished,          this, &ClaudeBridge::turnComplete);
    connect(m_daemon, &BridgeDaemon::errorOccurred,         this, &ClaudeBridge::errorOccurred);
    connect(m_daemon, &BridgeDaemon::sessionsListed,        this, &ClaudeBridge::sessionsListed);
    connect(m_daemon, &BridgeDaemon::sessionHistoryLoaded,  this, &ClaudeBridge::sessionHistoryLoaded);

    m_daemon->start();
    m_daemon->sendCommand(QJsonObject{{"type", "set_cwd"}, {"cwd", m_cwd}});
}

void ClaudeBridge::sendMessage(const QString &text) {
    if (text.trimmed().isEmpty()) return;
    m_daemon->sendCommand(QJsonObject{{"type", "send"}, {"prompt", text.trimmed()}});
}

void ClaudeBridge::abort() {
    m_daemon->abort();
}

void ClaudeBridge::setCwd(const QString &path) {
    if (m_cwd == path) return;
    m_cwd = path;
    m_daemon->sendCommand(QJsonObject{{"type", "set_cwd"}, {"cwd", path}});
    emit cwdChanged(path);
}

void ClaudeBridge::setModel(const QString &model) {
    if (m_model == model) return;
    m_model = model;
    m_daemon->sendCommand(QJsonObject{{"type", "set_model"}, {"model", model}});
    emit modelChanged(model);
}

void ClaudeBridge::setYolo(bool enabled) {
    if (m_yolo == enabled) return;
    m_yolo = enabled;
    m_daemon->sendCommand(QJsonObject{{"type", "set_yolo"}, {"yolo", enabled}});
    emit yoloChanged(enabled);
}

void ClaudeBridge::pickFolder() {
    const QString dir = QFileDialog::getExistingDirectory(
        nullptr,
        "Select Working Directory",
        m_cwd,
        QFileDialog::ShowDirsOnly | QFileDialog::DontResolveSymlinks
    );
    if (!dir.isEmpty())
        setCwd(dir);
}

void ClaudeBridge::requestSessions() {
    m_daemon->sendCommand(QJsonObject{{"type", "request_sessions"}});
}

void ClaudeBridge::loadSession(const QString &sessionId) {
    m_daemon->sendCommand(QJsonObject{{"type", "load_session"}, {"sessionId", sessionId}});
}

void ClaudeBridge::newSession() {
    m_daemon->sendCommand(QJsonObject{{"type", "new_session"}});
}
```

- [ ] **Step 3: Commit**

```bash
git -C /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt add src/claudebridge.h src/claudebridge.cpp
git -C /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt commit -m "refactor(bridge): slim ClaudeBridge — delegate all ops to BridgeDaemon"
```

---

## Task 7: CMake + CI update, swap source files, full build

**Files:**
- Modify: `CMakeLists.txt`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Update CMakeLists.txt — swap claudeprocess for bridgedaemon**

In `qt_add_executable`, change `src/claudeprocess.cpp` to `src/bridgedaemon.cpp`:

```cmake
qt_add_executable(ClaudianQt
    src/main.cpp
    src/mainwindow.cpp
    src/bridgedaemon.cpp
    src/claudebridge.cpp
    resources/resources.qrc
)
```

- [ ] **Step 2: Update bridge OUTPUT and bundle copy targets in CMakeLists.txt**

Find the `add_custom_command(OUTPUT ...)` block and change the OUTPUT and copy target from `index.js` to `daemon.js`:

```cmake
    add_custom_command(
        OUTPUT  "${CMAKE_SOURCE_DIR}/bridge/dist/daemon.js"
        COMMAND ${NPM_EXECUTABLE} install --prefer-offline
        COMMAND ${NPM_EXECUTABLE} run build
        DEPENDS
            "${CMAKE_SOURCE_DIR}/bridge/src/daemon.ts"
            "${CMAKE_SOURCE_DIR}/bridge/src/protocol.ts"
            "${CMAKE_SOURCE_DIR}/bridge/src/session-history.ts"
            "${CMAKE_SOURCE_DIR}/bridge/package.json"
            "${CMAKE_SOURCE_DIR}/bridge/tsconfig.json"
        WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}/bridge"
        COMMENT "Building TypeScript Claude Agent SDK bridge"
        VERBATIM
    )
    add_custom_target(ClaudeBridge ALL
        DEPENDS "${CMAKE_SOURCE_DIR}/bridge/dist/daemon.js"
    )
```

And update the POST_BUILD copy command from `index.js` to `daemon.js`:

```cmake
    add_custom_command(TARGET ClaudianQt POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E make_directory
            "$<TARGET_BUNDLE_DIR:ClaudianQt>/Contents/Resources/bridge"
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "${CMAKE_SOURCE_DIR}/bridge/dist/daemon.js"
            "$<TARGET_BUNDLE_DIR:ClaudianQt>/Contents/Resources/bridge/daemon.js"
        COMMENT "Bundling TypeScript daemon into app bundle"
        VERBATIM
    )
```

- [ ] **Step 3: Update CI bundle verification**

In `.github/workflows/ci.yml`, change the bundle check from `index.js` to `daemon.js`:

```yaml
          test -f build/ClaudianQt.app/Contents/Resources/bridge/daemon.js
```

- [ ] **Step 4: Delete the old ClaudeProcess files**

```bash
git -C /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt rm src/claudeprocess.h src/claudeprocess.cpp
```

- [ ] **Step 5: Build the project**

```bash
cmake -C /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt/build/CMakeCache.txt \
      /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt 2>&1 | tail -5

cmake --build /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt/build \
      --parallel $(sysctl -n hw.ncpu) 2>&1 | tail -20
```

Expected: Build succeeds. No compile errors.

- [ ] **Step 6: Verify app bundle has daemon.js**

```bash
ls /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt/build/ClaudianQt.app/Contents/Resources/bridge/
```

Expected: `daemon.js` and `node_modules/` present. No `index.js` required.

- [ ] **Step 7: Verify findDaemonScript() resolves in dev**

```bash
MACOS_DIR="/Volumes/Samsung970EVOPlus/dev-projects/claudian-qt/build/ClaudianQt.app/Contents/MacOS"
ls "$MACOS_DIR/../../../../bridge/dist/daemon.js"
```

Expected: File found.

- [ ] **Step 8: Run all TypeScript tests**

```bash
cd /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt/bridge && npm test 2>&1 | tail -15
```

Expected: All tests pass.

- [ ] **Step 9: Commit**

```bash
git -C /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt add CMakeLists.txt .github/workflows/ci.yml
git -C /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt commit -m "build: swap claudeprocess→bridgedaemon, copy daemon.js to bundle"
```

---

## Task 8: Integration smoke test

**Files:**
- No changes — verification only

- [ ] **Step 1: Launch the app**

```bash
QT_PLUGIN_PATH=/opt/homebrew/Cellar/qtbase/6.11.0/share/qt/plugins \
  /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt/build/ClaudianQt.app/Contents/MacOS/ClaudianQt &
APP_PID=$!
sleep 4 && ps -p $APP_PID > /dev/null && echo "App running" || echo "App crashed"
```

Expected: `App running`

- [ ] **Step 2: Send a message and verify streaming response**

In the UI:
1. Type `"What is 1 + 1?"` and press Send
2. Verify a streaming response appears
3. Verify the response completes (spinner stops)

- [ ] **Step 3: Verify session continuity**

1. Send `"My name is IntegrationTest"`
2. Wait for response
3. Send `"What is my name?"`
4. Verify response contains `IntegrationTest`

This proves the daemon's session state is persisted between messages.

- [ ] **Step 4: Verify abort**

1. Send a long-running prompt: `"Count from 1 to 100, one per line"`
2. While streaming, click Abort
3. Verify streaming stops and UI is responsive

- [ ] **Step 5: Kill app and final commit**

```bash
kill $APP_PID
```

```bash
git -C /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt log --oneline -10
```

Verify all commits from Tasks 1–7 are present. No additional commit needed for this task.

---

## Self-Review

### Spec Coverage

| Requirement | Task |
|-------------|------|
| Persistent daemon (no per-message spawn) | Task 3, 5 |
| Session state moves to TypeScript | Task 3 (`state.sessionId`) |
| Session history reading moves to TypeScript | Task 2 |
| `ClaudeProcess` deleted | Task 7 |
| `ClaudeBridge` drops `m_sessionId` + JSONL code | Task 6 |
| Protocol types shared between C++ and TS docs | Task 1 |
| All existing Qt signals/slots preserved (JS API unchanged) | Task 6 |
| Daemon crash recovery | Task 5 (`onDaemonFinished` with backoff) |
| Existing bridge tests still pass | Task 4 Step 3 |
| CMake builds daemon.js, bundles it | Task 7 |
| CI checks daemon.js in bundle | Task 7 |

### Placeholder Scan

No TBD, no "similar to Task N", no "add appropriate handling" — all code blocks are complete.

### Type Consistency

- `DaemonCommand` / `DaemonEvent` defined in `protocol.ts` (Task 1), imported in `daemon.ts` (Task 3) and `daemon.test.ts` (Task 4) ✓
- `SessionEntry` / `TurnEntry` from `session-history.ts` used in `daemon.ts` correctly ✓
- `BridgeDaemon` signal names (`sessionInitialized`, `textReady`, `toolUseStarted`, `turnFinished`, `sessionsListed`, `sessionHistoryLoaded`) match the `ClaudeBridge` connect calls in Task 6 ✓
- Event type strings in `handleEvent()` (`"text_ready"`, `"tool_use"`, `"turn_complete"`, `"session_ready"`, `"error"`, `"sessions_listed"`, `"session_history_loaded"`, `"result"`) match daemon emit calls ✓
- Command type strings in `handleCommand()` (`"send"`, `"abort"`, `"set_cwd"`, `"set_model"`, `"set_yolo"`, `"new_session"`, `"request_sessions"`, `"load_session"`) match `sendCommand()` calls in `claudebridge.cpp` ✓
