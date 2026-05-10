# Image Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add desktop-style multi-image attachments to Claudian Qt, including picker/drag-drop/paste intake, managed-copy persistence, Claude SDK image turns, and reopened history galleries.

**Architecture:** Keep the current split between the web UI, the Qt `QWebChannel` bridge, and the persistent Node daemon. Add a small C++ staging store for native file import, a TypeScript attachment store for session-finalized manifests, and a richer send/history protocol so the UI can render pending and persisted galleries without replacing Claude's transcript store.

**Tech Stack:** Qt 6 / C++17, QWebEngine + QWebChannel, vanilla JS/CSS/HTML, Node 18+, TypeScript, Vitest, `@anthropic-ai/claude-agent-sdk`, `@anthropic-ai/sdk`

---

## File Structure

- Create: `bridge/src/message-input.ts`
  Responsibility: Convert `prompt + attachments` into an `SDKUserMessage` using Anthropic image content blocks.
- Create: `bridge/src/attachment-store.ts`
  Responsibility: Finalize staged image files into `~/.claudian-qt/attachments/sessions/<sessionId>/...` and maintain a manifest per session.
- Create: `bridge/tests/message-input.test.ts`
  Responsibility: Prove text+image message construction before touching the daemon.
- Create: `bridge/tests/attachment-store.test.ts`
  Responsibility: Prove manifest write/read/finalize behavior in isolation.
- Create: `bridge/tests/session-history.test.ts`
  Responsibility: Prove transcript + manifest merge behavior.
- Create: `src/attachmentstore.h`
  Responsibility: Declare a focused Qt helper for importing local files or pasted bytes into the staging area.
- Create: `src/attachmentstore.cpp`
  Responsibility: Implement staging writes, MIME validation, image metadata extraction, and returned JSON payloads.
- Modify: `bridge/src/protocol.ts:1-19`
  Responsibility: Introduce attachment-aware command and history types.
- Modify: `bridge/src/index.ts:1-57`
  Responsibility: Keep the standalone bridge path compatible with structured image input.
- Modify: `bridge/src/daemon.ts:1-150`
  Responsibility: Switch `send` from plain string prompts to structured `SDKUserMessage` input and persist manifests on successful turns.
- Modify: `bridge/src/session-history.ts:1-131`
  Responsibility: Return `HistoryTurn[]` with attachment galleries merged onto user turns.
- Modify: `bridge/tests/bridge.test.ts:1-85`
  Responsibility: Update bridge input validation for image-aware payloads.
- Modify: `bridge/tests/daemon.test.ts:1-130`
  Responsibility: Preserve daemon protocol coverage after the send shape changes.
- Modify: `src/claudebridge.h:1-49`
  Responsibility: Expose attachment picker/import/send APIs and signals to the web UI.
- Modify: `src/claudebridge.cpp:1-81`
  Responsibility: Marshal new attachment commands between JS and the daemon.
- Modify: `src/mainwindow.cpp:1-18`
  Responsibility: Allow the embedded `qrc:` page to render managed-file thumbnails from `file://` URLs.
- Modify: `CMakeLists.txt:1-110`
  Responsibility: Compile the new C++ helper into the app target.
- Modify: `resources/chat/index.html`
  Responsibility: Add the attachment tray and image preview modal skeleton.
- Modify: `resources/chat/chat.css`
  Responsibility: Style pending attachments, history galleries, drag/drop states, and the preview modal.
- Modify: `resources/chat/chat.js:4-503`
  Responsibility: Manage attachment state, bridge calls, send behavior, history rendering, and preview interactions.

## Data Contracts To Keep Consistent

Use these names consistently across the implementation:

```ts
export type ImageMediaType =
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp";

export interface OutboundAttachment {
  id: string;
  originalName: string;
  mimeType: ImageMediaType;
  stagedPath: string;
  fileUrl: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
}

export interface HistoryAttachment {
  id: string;
  originalName: string;
  mimeType: ImageMediaType;
  relativePath: string;
  fileUrl: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
}

export interface HistoryTurn {
  role: "user" | "assistant";
  text: string;
  attachments: HistoryAttachment[];
}
```

## Task 1: Shared Protocol And SDK Message Builder

**Files:**
- Create: `bridge/src/message-input.ts`
- Modify: `bridge/src/protocol.ts:1-19`
- Test: `bridge/tests/message-input.test.ts`

- [ ] **Step 1: Write the failing message-input test**

```ts
import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { buildUserMessage } from "../src/message-input.js";
import type { OutboundAttachment } from "../src/protocol.js";

describe("buildUserMessage", () => {
  it("builds a Claude SDK user message with text and image blocks", async () => {
    const dir = await mkdtemp(join(tmpdir(), "claudian-message-input-"));
    const imagePath = join(dir, "diagram.png");
    await writeFile(imagePath, Buffer.from("fake-png"));

    const attachments: OutboundAttachment[] = [{
      id: "att-1",
      originalName: "diagram.png",
      mimeType: "image/png",
      stagedPath: imagePath,
      fileUrl: "file://" + imagePath,
      sizeBytes: 8,
      width: 320,
      height: 200,
    }];

    const msg = await buildUserMessage("Compare these screenshots", attachments);
    expect(msg.type).toBe("user");
    expect(msg.parent_tool_use_id).toBeNull();
    expect(msg.message.role).toBe("user");
    expect(Array.isArray(msg.message.content)).toBe(true);
    expect(msg.message.content).toEqual([
      { type: "text", text: "Compare these screenshots" },
      expect.objectContaining({
        type: "image",
        source: expect.objectContaining({
          type: "base64",
          media_type: "image/png",
        }),
      }),
    ]);
  });
});
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run from `bridge/`:

```bash
npm test -- message-input.test.ts
```

Expected: FAIL with `Cannot find module '../src/message-input.js'` and missing attachment types in `protocol.ts`.

- [ ] **Step 3: Expand the shared protocol types**

```ts
export type ImageMediaType =
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp";

export interface OutboundAttachment {
  id: string;
  originalName: string;
  mimeType: ImageMediaType;
  stagedPath: string;
  fileUrl: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
}

export interface HistoryAttachment {
  id: string;
  originalName: string;
  mimeType: ImageMediaType;
  relativePath: string;
  fileUrl: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
}

export interface HistoryTurn {
  role: "user" | "assistant";
  text: string;
  attachments: HistoryAttachment[];
}

export type DaemonCommand =
  | { type: "send"; prompt: string; attachments: OutboundAttachment[] }
  | { type: "abort" }
  | { type: "set_cwd"; cwd: string }
  | { type: "set_model"; model: string }
  | { type: "set_yolo"; yolo: boolean }
  | { type: "new_session" }
  | { type: "request_sessions" }
  | { type: "load_session"; sessionId: string };
```

- [ ] **Step 4: Implement the SDK message builder**

```ts
import { readFile } from "fs/promises";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type {
  ContentBlockParam,
  ImageBlockParam,
  MessageParam,
} from "@anthropic-ai/sdk/resources/messages/messages";
import type { OutboundAttachment } from "./protocol.js";

export async function buildUserMessage(
  prompt: string,
  attachments: OutboundAttachment[],
): Promise<SDKUserMessage> {
  const content: ContentBlockParam[] = [];
  if (prompt.trim()) content.push({ type: "text", text: prompt.trim() });

  for (const attachment of attachments) {
    const bytes = await readFile(attachment.stagedPath);
    const imageBlock: ImageBlockParam = {
      type: "image",
      source: {
        type: "base64",
        media_type: attachment.mimeType,
        data: bytes.toString("base64"),
      },
    };
    content.push(imageBlock);
  }

  return {
    type: "user",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content,
    } satisfies MessageParam,
  };
}
```

- [ ] **Step 5: Run the targeted test to verify it passes**

Run from `bridge/`:

```bash
npm test -- message-input.test.ts
```

Expected: PASS with 1 test file and 1 passing test.

- [ ] **Step 6: Commit**

```bash
git add bridge/src/protocol.ts bridge/src/message-input.ts bridge/tests/message-input.test.ts
git commit -m "feat(images): add attachment protocol and SDK message builder"
```

### Task 2: Attachment Manifest Store

**Files:**
- Create: `bridge/src/attachment-store.ts`
- Test: `bridge/tests/attachment-store.test.ts`

- [ ] **Step 1: Write the failing attachment-store test**

```ts
import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  appendManifestTurn,
  finalizeAttachmentsForTurn,
  loadAttachmentManifest,
} from "../src/attachment-store.js";
import type { OutboundAttachment } from "../src/protocol.js";

describe("attachment-store", () => {
  it("finalizes staged attachments and appends a manifest turn", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "claudian-attachment-store-"));
    const stagedPath = join(rootDir, "staging", "att-1.png");
    await mkdir(join(rootDir, "staging"), { recursive: true });
    await writeFile(stagedPath, Buffer.from("fake-png"));

    const finalized = await finalizeAttachmentsForTurn({
      rootDir,
      sessionId: "session-1",
      turnIndex: 0,
      attachments: [{
        id: "att-1",
        originalName: "diagram.png",
        mimeType: "image/png",
        stagedPath,
        fileUrl: "file://" + stagedPath,
        sizeBytes: 8,
        width: 320,
        height: 200,
      } satisfies OutboundAttachment],
    });

    await appendManifestTurn({
      rootDir,
      sessionId: "session-1",
      turnIndex: 0,
      attachments: finalized,
    });

    expect(await readFile(join(rootDir, "sessions", "session-1", "turn-0000", "00-att-1.png"))).toEqual(Buffer.from("fake-png"));
    expect(await loadAttachmentManifest(rootDir, "session-1")).toEqual([
      expect.objectContaining({
        turnIndex: 0,
        attachments: [expect.objectContaining({ id: "att-1", mimeType: "image/png" })],
      }),
    ]);
  });
});
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run from `bridge/`:

```bash
npm test -- attachment-store.test.ts
```

Expected: FAIL with `Cannot find module '../src/attachment-store.js'`.

- [ ] **Step 3: Implement the attachment-store helper**

```ts
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import * as os from "os";
import { dirname, extname, join } from "path";
import { pathToFileURL } from "url";
import type { HistoryAttachment, OutboundAttachment } from "./protocol.js";

export interface ManifestTurn {
  turnIndex: number;
  attachments: HistoryAttachment[];
}

export function attachmentRoot(home = os.homedir()): string {
  return join(home, ".claudian-qt", "attachments");
}

function manifestPath(rootDir: string, sessionId: string): string {
  return join(rootDir, "sessions", sessionId, "manifest.json");
}

function turnDir(rootDir: string, sessionId: string, turnIndex: number): string {
  return join(rootDir, "sessions", sessionId, `turn-${String(turnIndex).padStart(4, "0")}`);
}

export async function finalizeAttachmentsForTurn(args: {
  rootDir: string;
  sessionId: string;
  turnIndex: number;
  attachments: OutboundAttachment[];
}): Promise<HistoryAttachment[]> {
  const destDir = turnDir(args.rootDir, args.sessionId, args.turnIndex);
  await mkdir(destDir, { recursive: true });

  const finalized: HistoryAttachment[] = [];
  for (const [index, attachment] of args.attachments.entries()) {
    const ext = extname(attachment.originalName) || ".img";
    const filename = `${String(index).padStart(2, "0")}-${attachment.id}${ext}`;
    const absolutePath = join(destDir, filename);
    await rename(attachment.stagedPath, absolutePath);
    finalized.push({
      id: attachment.id,
      originalName: attachment.originalName,
      mimeType: attachment.mimeType,
      relativePath: join("sessions", args.sessionId, `turn-${String(args.turnIndex).padStart(4, "0")}`, filename),
      fileUrl: pathToFileURL(absolutePath).toString(),
      sizeBytes: attachment.sizeBytes,
      width: attachment.width,
      height: attachment.height,
    });
  }

  return finalized;
}

export async function loadAttachmentManifest(
  rootDir: string,
  sessionId: string,
): Promise<ManifestTurn[]> {
  try {
    return JSON.parse(await readFile(manifestPath(rootDir, sessionId), "utf8")) as ManifestTurn[];
  } catch {
    return [];
  }
}

export async function appendManifestTurn(args: {
  rootDir: string;
  sessionId: string;
  turnIndex: number;
  attachments: HistoryAttachment[];
}): Promise<void> {
  const existing = await loadAttachmentManifest(args.rootDir, args.sessionId);
  const next = [...existing, { turnIndex: args.turnIndex, attachments: args.attachments }];
  const path = manifestPath(args.rootDir, args.sessionId);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(next, null, 2));
}
```

- [ ] **Step 4: Run the targeted test to verify it passes**

Run from `bridge/`:

```bash
npm test -- attachment-store.test.ts
```

Expected: PASS with the staged file moved into `sessions/session-1/turn-0000/`.

- [ ] **Step 5: Commit**

```bash
git add bridge/src/attachment-store.ts bridge/tests/attachment-store.test.ts
git commit -m "feat(images): add attachment manifest store"
```

### Task 3: Daemon Send Path And History Merge

**Files:**
- Modify: `bridge/src/daemon.ts:1-150`
- Modify: `bridge/src/index.ts:1-57`
- Modify: `bridge/src/session-history.ts:1-131`
- Modify: `bridge/tests/bridge.test.ts:1-85`
- Modify: `bridge/tests/daemon.test.ts:1-130`
- Create: `bridge/tests/session-history.test.ts`

- [ ] **Step 1: Write the failing history and bridge tests**

```ts
import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { loadSessionHistory } from "../src/session-history.js";

describe("loadSessionHistory", () => {
  it("merges manifest attachments onto user turns by turn index", async () => {
    const home = await mkdtemp(join(tmpdir(), "claudian-history-home-"));
    const projectDir = join(home, ".claude", "projects", "-tmp-project");
    const attachmentDir = join(home, ".claudian-qt", "attachments", "sessions", "session-1");
    await mkdir(projectDir, { recursive: true });
    await mkdir(attachmentDir, { recursive: true });
    await writeFile(join(projectDir, "session-1.jsonl"), [
      JSON.stringify({ type: "user", message: { content: [{ type: "text", text: "look at this" }] } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "done" }] } }),
    ].join("\n"));
    await writeFile(join(attachmentDir, "manifest.json"), JSON.stringify([
      {
        turnIndex: 0,
        attachments: [{
          id: "att-1",
          originalName: "diagram.png",
          mimeType: "image/png",
          relativePath: "sessions/session-1/turn-0000/00-att-1.png",
          fileUrl: "file:///tmp/fake.png",
          sizeBytes: 8,
          width: 320,
          height: 200,
        }],
      },
    ]));

    const turns = await loadSessionHistory("/tmp/project", "session-1", home);
    expect(turns[0]).toEqual(expect.objectContaining({
      role: "user",
      text: "look at this",
      attachments: [expect.objectContaining({ id: "att-1" })],
    }));
  });
});
```

```ts
it("accepts image-aware bridge input when attachments are present", async () => {
  const result = await runBridge(JSON.stringify({
    prompt: "",
    attachments: [{
      id: "att-1",
      originalName: "diagram.png",
      mimeType: "image/png",
      stagedPath: "/tmp/diagram.png",
      fileUrl: "file:///tmp/diagram.png",
      sizeBytes: 8,
      width: 320,
      height: 200,
    }],
  }));
  expect(result.exitCode).not.toBe(1);
});
```

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run from `bridge/`:

```bash
npm test -- session-history.test.ts bridge.test.ts daemon.test.ts
```

Expected: FAIL because `loadSessionHistory()` still returns `{ role, text }` only and `index.ts` still requires a non-empty `prompt` string.

- [ ] **Step 3: Update the daemon send path and standalone bridge**

```ts
import { query, AbortError } from "@anthropic-ai/claude-agent-sdk";
import { appendManifestTurn, attachmentRoot, finalizeAttachmentsForTurn } from "./attachment-store.js";
import { buildUserMessage } from "./message-input.js";
import { countUserTurns, listSessions, loadSessionHistory } from "./session-history.js";
import type { DaemonCommand, DaemonEvent } from "./protocol.js";

async function handleSend(prompt: string, attachments: OutboundAttachment[]): Promise<void> {
  if (currentAbort) currentAbort.abort();
  const abortController = new AbortController();
  currentAbort = abortController;
  let successful = false;

  try {
    const queryResult = query({
      prompt: (async function* () {
        yield await buildUserMessage(prompt, attachments);
      })(),
      options: {
        abortController,
        cwd: state.cwd,
        resume: state.sessionId || undefined,
        model: state.model || undefined,
        allowDangerouslySkipPermissions: state.yolo,
        includePartialMessages: true,
      },
    });

    for await (const message of queryResult) {
      const m = message as Record<string, unknown>;
      if (m.type === "system" && m.subtype === "init") {
        state.sessionId = m.session_id as string;
        emit({ type: "session_ready", sessionId: state.sessionId });
      } else if (m.type === "result" && !m.is_error) {
        successful = true;
        emit({ type: "result", data: m });
      }
    }

    if (successful && attachments.length && state.sessionId) {
      const turnIndex = Math.max(0, (await countUserTurns(state.cwd, state.sessionId)) - 1);
      const finalized = await finalizeAttachmentsForTurn({
        rootDir: attachmentRoot(),
        sessionId: state.sessionId,
        turnIndex,
        attachments,
      });
      await appendManifestTurn({
        rootDir: attachmentRoot(),
        sessionId: state.sessionId,
        turnIndex,
        attachments: finalized,
      });
    }
  } catch (err) {
    if (!(err instanceof AbortError)) emit({ type: "error", msg: err instanceof Error ? err.message : String(err) });
  } finally {
    if (currentAbort === abortController) currentAbort = null;
    emit({ type: "turn_complete" });
  }
}
```

```ts
interface BridgeCommand {
  prompt?: string;
  attachments?: OutboundAttachment[];
  cwd?: string;
  sessionId?: string;
  model?: string;
  yolo?: boolean;
}

if ((!cmd.prompt || !cmd.prompt.trim()) && !(cmd.attachments && cmd.attachments.length)) {
  throw new Error("Missing required input: provide prompt text and/or attachments");
}
```

- [ ] **Step 4: Merge manifest attachments into session history**

```ts
export interface HistoryTurn {
  role: "user" | "assistant";
  text: string;
  attachments: HistoryAttachment[];
}

export async function countUserTurns(
  cwd: string,
  sessionId: string,
  home = os.homedir(),
): Promise<number> {
  const turns = await loadSessionHistory(cwd, sessionId, home);
  return turns.filter((turn) => turn.role === "user").length;
}

export async function loadSessionHistory(
  cwd: string,
  sessionId: string,
  home = os.homedir(),
): Promise<HistoryTurn[]> {
  const manifest = await loadAttachmentManifest(join(home, ".claudian-qt", "attachments"), sessionId);
  const attachmentsByTurn = new Map(manifest.map((turn) => [turn.turnIndex, turn.attachments]));
  const filePath = join(claudeProjectDir(cwd, home), sessionId + ".jsonl");
  const turns: HistoryTurn[] = [];
  let pendingAssistant = "";
  let userTurnIndex = -1;
  let stream: fs.ReadStream;

  const flushAssistant = (): void => {
    if (!pendingAssistant.trim()) return;
    turns.push({ role: "assistant", text: pendingAssistant.trim(), attachments: [] });
    pendingAssistant = "";
  };

  try {
    stream = fs.createReadStream(filePath);
    await new Promise<void>((resolve, reject) => {
      stream.once("error", reject);
      stream.once("readable", resolve);
      stream.once("end", resolve);
    });
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
        for (const block of content) {
          const typed = block as Record<string, unknown>;
          if (typed.type === "text") text += typed.text as string;
        }
      }

      if (text.trim()) {
        userTurnIndex += 1;
        turns.push({
          role: "user",
          text: text.trim(),
          attachments: attachmentsByTurn.get(userTurnIndex) ?? [],
        });
      }
    } else if (obj.type === "assistant") {
      const content = (obj.message as Record<string, unknown>).content as Array<Record<string, unknown>>;
      for (const block of content ?? []) {
        if (block.type === "text") pendingAssistant += block.text as string;
      }
    }
  }

  flushAssistant();
  return turns;
}
```

- [ ] **Step 5: Run the targeted tests to verify they pass**

Run from `bridge/`:

```bash
npm test -- session-history.test.ts bridge.test.ts daemon.test.ts
```

Expected: PASS with history turns returning `attachments: []` for plain text and populated arrays where manifest data exists.

- [ ] **Step 6: Commit**

```bash
git add bridge/src/daemon.ts bridge/src/index.ts bridge/src/session-history.ts bridge/tests/bridge.test.ts bridge/tests/daemon.test.ts bridge/tests/session-history.test.ts
git commit -m "feat(images): wire daemon send path and history merge"
```

### Task 4: Qt Attachment Staging And Bridge API

**Files:**
- Create: `src/attachmentstore.h`
- Create: `src/attachmentstore.cpp`
- Modify: `src/claudebridge.h:1-49`
- Modify: `src/claudebridge.cpp:1-81`
- Modify: `src/mainwindow.cpp:1-18`
- Modify: `CMakeLists.txt:1-110`

- [ ] **Step 1: Add the focused C++ staging helper declarations**

```cpp
#pragma once

#include <QObject>

class AttachmentStore : public QObject {
    Q_OBJECT
public:
    explicit AttachmentStore(QObject *parent = nullptr);

    QString importFile(const QString &sourcePath);
    QString importBase64Image(
        const QString &originalName,
        const QString &mimeType,
        const QString &base64Data
    );

private:
    QString stagingRoot() const;
    QString importBytes(
        const QByteArray &bytes,
        const QString &originalName,
        const QString &mimeType
    );
    bool isSupportedImageMime(const QString &mimeType) const;
};
```

- [ ] **Step 2: Implement managed staging imports in C++**

```cpp
#include "attachmentstore.h"
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QImageReader>
#include <QJsonDocument>
#include <QJsonObject>
#include <QMimeDatabase>
#include <QSaveFile>
#include <QStandardPaths>
#include <QUuid>
#include <QUrl>

QString AttachmentStore::stagingRoot() const {
    const QString home = QDir::homePath();
    return home + "/.claudian-qt/attachments/staging";
}

QString AttachmentStore::importBytes(
    const QByteArray &bytes,
    const QString &originalName,
    const QString &mimeType
) {
    if (!isSupportedImageMime(mimeType)) return {};

    QDir().mkpath(stagingRoot());
    const QString id = QUuid::createUuid().toString(QUuid::WithoutBraces);
    const QString path = stagingRoot() + "/" + id + "-" + QFileInfo(originalName).fileName();

    QSaveFile file(path);
    if (!file.open(QIODevice::WriteOnly)) return {};
    file.write(bytes);
    if (!file.commit()) return {};

    QImageReader reader(path);
    const QSize size = reader.size();

    return QString::fromUtf8(QJsonDocument(QJsonObject{
        {"id", id},
        {"originalName", originalName},
        {"mimeType", mimeType},
        {"stagedPath", path},
        {"fileUrl", QUrl::fromLocalFile(path).toString()},
        {"sizeBytes", static_cast<qint64>(bytes.size())},
        {"width", size.isValid() ? size.width() : QJsonValue()},
        {"height", size.isValid() ? size.height() : QJsonValue()}
    }).toJson(QJsonDocument::Compact));
}

QString AttachmentStore::importFile(const QString &sourcePath) {
    QFile file(sourcePath);
    if (!file.open(QIODevice::ReadOnly)) return {};
    const QString mimeType = QMimeDatabase().mimeTypeForFile(sourcePath).name();
    return importBytes(file.readAll(), QFileInfo(sourcePath).fileName(), mimeType);
}

QString AttachmentStore::importBase64Image(
    const QString &originalName,
    const QString &mimeType,
    const QString &base64Data
) {
    return importBytes(QByteArray::fromBase64(base64Data.toUtf8()), originalName, mimeType);
}

bool AttachmentStore::isSupportedImageMime(const QString &mimeType) const {
    return mimeType == "image/png"
        || mimeType == "image/jpeg"
        || mimeType == "image/gif"
        || mimeType == "image/webp";
}
```

- [ ] **Step 3: Expose picker/import/send APIs through `ClaudeBridge` and enable file thumbnails**

```cpp
public slots:
    void sendMessage(const QString &text, const QString &attachmentsJson);
    void pickImages();
    void importImageData(
        const QString &requestId,
        const QString &originalName,
        const QString &mimeType,
        const QString &base64Data
    );

signals:
    void imagesPicked(const QString &json);
    void imageImported(const QString &requestId, const QString &json);

private:
    BridgeDaemon    *m_daemon;
    AttachmentStore *m_attachmentStore;
    QString          m_cwd;
    QString          m_model;
    bool             m_yolo = false;
```

```cpp
ClaudeBridge::ClaudeBridge(QObject *parent)
    : QObject(parent)
    , m_daemon(new BridgeDaemon(this))
    , m_attachmentStore(new AttachmentStore(this))
    , m_cwd(QDir::homePath())
{
    connect(m_daemon, &BridgeDaemon::sessionInitialized,   this, &ClaudeBridge::sessionReady);
    connect(m_daemon, &BridgeDaemon::textReady,            this, &ClaudeBridge::textReady);
    connect(m_daemon, &BridgeDaemon::toolUseStarted,       this, &ClaudeBridge::toolUse);
    connect(m_daemon, &BridgeDaemon::turnFinished,         this, &ClaudeBridge::turnComplete);
    connect(m_daemon, &BridgeDaemon::errorOccurred,        this, &ClaudeBridge::errorOccurred);
    connect(m_daemon, &BridgeDaemon::sessionsListed,       this, &ClaudeBridge::sessionsListed);
    connect(m_daemon, &BridgeDaemon::sessionHistoryLoaded, this, &ClaudeBridge::sessionHistoryLoaded);

    connect(m_daemon, &BridgeDaemon::daemonStarted, this, [this]() {
        m_daemon->sendCommand(QJsonObject{{"type", "set_cwd"}, {"cwd", m_cwd}});
        if (!m_model.isEmpty())
            m_daemon->sendCommand(QJsonObject{{"type", "set_model"}, {"model", m_model}});
        if (m_yolo)
            m_daemon->sendCommand(QJsonObject{{"type", "set_yolo"}, {"yolo", m_yolo}});
    });

    m_daemon->start();
}

void ClaudeBridge::sendMessage(const QString &text, const QString &attachmentsJson) {
    QJsonParseError err;
    const QJsonDocument doc = QJsonDocument::fromJson(attachmentsJson.toUtf8(), &err);
    if (err.error != QJsonParseError::NoError || !doc.isArray()) {
        emit errorOccurred("Invalid attachment payload.");
        return;
    }
    if (text.trimmed().isEmpty() && doc.array().isEmpty()) return;
    m_daemon->sendCommand(QJsonObject{
        {"type", "send"},
        {"prompt", text.trimmed()},
        {"attachments", doc.array()}
    });
}

void ClaudeBridge::pickImages() {
    const QStringList paths = QFileDialog::getOpenFileNames(
        nullptr,
        "Select Images",
        m_cwd,
        "Images (*.png *.jpg *.jpeg *.gif *.webp)"
    );

    QJsonArray imported;
    for (const QString &path : paths) {
        const QString json = m_attachmentStore->importFile(path);
        if (!json.isEmpty()) imported.append(QJsonDocument::fromJson(json.toUtf8()).object());
    }
    emit imagesPicked(QString::fromUtf8(QJsonDocument(imported).toJson(QJsonDocument::Compact)));
}

void ClaudeBridge::importImageData(
    const QString &requestId,
    const QString &originalName,
    const QString &mimeType,
    const QString &base64Data
) {
    const QString json = m_attachmentStore->importBase64Image(originalName, mimeType, base64Data);
    if (json.isEmpty()) {
        emit errorOccurred("Failed to import image data.");
        return;
    }
    emit imageImported(requestId, json);
}
```

```cpp
m_webView->settings()->setAttribute(
    QWebEngineSettings::LocalContentCanAccessFileUrls,
    true
);
```

```cmake
qt_add_executable(ClaudianQt
    src/main.cpp
    src/mainwindow.cpp
    src/bridgedaemon.cpp
    src/claudebridge.cpp
    src/attachmentstore.cpp
    resources/resources.qrc
)
```

- [ ] **Step 4: Build the app target to verify the Qt changes compile**

Run from the repo root:

```bash
cmake --build /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt/build --parallel $(sysctl -n hw.ncpu)
```

Expected: PASS with `ClaudianQt` rebuilt and the bridge TypeScript target still succeeding.

- [ ] **Step 5: Commit**

```bash
git add CMakeLists.txt src/attachmentstore.h src/attachmentstore.cpp src/claudebridge.h src/claudebridge.cpp src/mainwindow.cpp
git commit -m "feat(images): add Qt attachment staging bridge"
```

### Task 5: Web UI Attachment Tray, Galleries, And Preview Modal

**Files:**
- Modify: `resources/chat/index.html`
- Modify: `resources/chat/chat.css`
- Modify: `resources/chat/chat.js:4-503`

- [ ] **Step 1: Add attachment and preview markup to the HTML shell**

```html
<div id="attachment-tray"></div>

<div id="input-area">
  <div id="textarea-wrapper">
    <textarea id="input-textarea" rows="1" placeholder="Message Claude…"></textarea>
  </div>
  <div id="input-toolbar">
    <button id="attach-btn" title="Attach images">Attach</button>
    <button id="cwd-btn" title="Change working directory">~/</button>
    <div id="model-selector">
      <button id="model-btn">
        <span id="model-btn-label">Default</span>
      </button>
      <div id="model-dropdown"></div>
    </div>
    <button id="yolo-btn">Safe</button>
    <button id="send-btn" title="Send (Enter)">Send</button>
    <button id="stop-btn" title="Stop generation">Stop</button>
  </div>
</div>

<div id="image-preview-modal">
  <button id="image-preview-close" title="Close preview">×</button>
  <img id="image-preview-img" alt="">
  <div id="image-preview-caption"></div>
</div>
```

- [ ] **Step 2: Add CSS for pending attachments, history galleries, and modal preview**

```css
#attachment-tray {
  display: none;
  gap: 10px;
  padding: 12px 16px 0;
  overflow-x: auto;
}

#attachment-tray.visible {
  display: flex;
}

.attachment-tile {
  position: relative;
  width: 88px;
  flex: 0 0 88px;
}

.attachment-thumb,
.history-attachment-thumb {
  width: 88px;
  height: 88px;
  object-fit: cover;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--bg-surface);
}

.attachment-remove {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 999px;
  background: rgba(0,0,0,0.75);
  color: #fff;
  cursor: pointer;
}

.history-attachment-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

#main.drag-over #textarea-wrapper,
#main.drag-over #attachment-tray {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px rgba(124,106,247,0.35);
}

#image-preview-modal {
  position: fixed;
  inset: 0;
  display: none;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 12px;
  background: rgba(0, 0, 0, 0.7);
  z-index: 1200;
}

#image-preview-modal.visible {
  display: flex;
}

#image-preview-img {
  max-width: min(80vw, 960px);
  max-height: 80vh;
  border-radius: 16px;
}
```

- [ ] **Step 3: Add attachment state and rendering helpers in `chat.js`**

```js
const state = {
  messages: [],
  pendingAttachments: [],
  streaming: false,
  currentMsgId: null,
  sessions: [],
  activeSessionId: "",
  cwd: "",
  model: "",
  yolo: false,
  viewMode: localStorage.getItem("viewMode") || "normal",
  fontSize: localStorage.getItem("fontSize") || "md",
  summaryData: null,
  tokenCount: 0,
  toolCallCount: 0,
  previewAttachment: null,
  _rafPending: false,
  _streamBuffer: "",
  _summaryCapturing: false,
};

const pendingImports = new Map();

function renderAttachmentRow(attachments, { removable = false } = {}) {
  const row = document.createElement("div");
  row.className = "history-attachment-row";
  attachments.forEach((attachment) => {
    const tile = document.createElement("div");
    tile.className = "attachment-tile";
    tile.innerHTML =
      `<img class="attachment-thumb" src="${escHtml(attachment.fileUrl)}" alt="${escHtml(attachment.originalName)}">` +
      (removable ? `<button class="attachment-remove" data-attachment-id="${escHtml(attachment.id)}">×</button>` : "");
    tile.querySelector("img").addEventListener("click", () => openImagePreview(attachment));
    row.appendChild(tile);
  });
  return row;
}

function renderPendingAttachments() {
  DOM.attachmentTray.innerHTML = "";
  DOM.attachmentTray.classList.toggle("visible", state.pendingAttachments.length > 0);
  if (!state.pendingAttachments.length) return;
  DOM.attachmentTray.appendChild(renderAttachmentRow(state.pendingAttachments, { removable: true }));
}

function openImagePreview(attachment) {
  state.previewAttachment = attachment;
  DOM.imagePreviewImg.src = attachment.fileUrl;
  DOM.imagePreviewImg.alt = attachment.originalName;
  DOM.imagePreviewCaption.textContent = attachment.originalName;
  DOM.imagePreviewModal.classList.add("visible");
}

function initDOM() {
  DOM = {
    sessionList: document.getElementById("session-list"),
    newSessionBtn: document.getElementById("new-session-btn"),
    messages: document.getElementById("messages"),
    typingIndicator: document.getElementById("typing-indicator"),
    summaryView: document.getElementById("summary-view"),
    summaryStats: document.getElementById("summary-stats"),
    summaryLastTurn: document.getElementById("summary-last-turn"),
    summaryContent: document.getElementById("summary-content"),
    generateSummaryBtn: document.getElementById("generate-summary-btn"),
    exitSummaryBtn: document.getElementById("exit-summary-btn"),
    inputArea: document.getElementById("input-area"),
    attachmentTray: document.getElementById("attachment-tray"),
    attachBtn: document.getElementById("attach-btn"),
    textarea: document.getElementById("input-textarea"),
    sendBtn: document.getElementById("send-btn"),
    stopBtn: document.getElementById("stop-btn"),
    cwdBtn: document.getElementById("cwd-btn"),
    modelBtn: document.getElementById("model-btn"),
    modelBtnLabel: document.getElementById("model-btn-label"),
    modelDropdown: document.getElementById("model-dropdown"),
    yoloBtn: document.getElementById("yolo-btn"),
    viewSelectorBtn: document.getElementById("view-selector-btn"),
    viewSelectorLabel: document.getElementById("view-selector-label"),
    viewPopup: document.getElementById("view-popup"),
    imagePreviewModal: document.getElementById("image-preview-modal"),
    imagePreviewImg: document.getElementById("image-preview-img"),
    imagePreviewCaption: document.getElementById("image-preview-caption"),
    imagePreviewClose: document.getElementById("image-preview-close"),
  };
}
```

- [ ] **Step 4: Wire picker, drag/drop, paste, send, and history rendering**

```js
function normalizeAttachment(raw) {
  return {
    id: raw.id,
    originalName: raw.originalName,
    mimeType: raw.mimeType,
    stagedPath: raw.stagedPath,
    fileUrl: raw.fileUrl,
    sizeBytes: raw.sizeBytes,
    width: raw.width ?? null,
    height: raw.height ?? null,
  };
}

async function importClipboardFile(file) {
  return new Promise((resolve, reject) => {
    const requestId = mkId();
    const reader = new FileReader();
    pendingImports.set(requestId, { resolve, reject });
    reader.onload = () => {
      const base64 = String(reader.result).split(",")[1] || "";
      bridge.importImageData(requestId, file.name || "clipboard-image.png", file.type || "image/png", base64);
    };
    reader.onerror = () => {
      pendingImports.delete(requestId);
      reject(reader.error);
    };
    reader.readAsDataURL(file);
  });
}

function sendMessage() {
  const text = DOM.textarea.value.trim();
  if ((!text && !state.pendingAttachments.length) || state.streaming || !bridge) return;

  const attachments = state.pendingAttachments.map(({ id, originalName, mimeType, stagedPath, fileUrl, sizeBytes, width, height }) => ({
    id, originalName, mimeType, stagedPath, fileUrl, sizeBytes, width, height,
  }));

  state.messages.push({
    id: mkId(),
    role: "user",
    content: text,
    attachments,
    toolCalls: [],
    timestamp: new Date().toISOString(),
  });

  DOM.textarea.value = "";
  state.pendingAttachments = [];
  renderPendingAttachments();
  startStreaming();
  bridge.sendMessage(text, JSON.stringify(attachments));
}

function renderMessage(msg) {
  const outer = document.createElement("div");
  outer.dataset.msgId = msg.id;
  if (msg.role === "user") {
    outer.className = "msg-user";
    const bubble = document.createElement("div");
    bubble.className = "msg-bubble";
    bubble.textContent = msg.content;
    if (msg.attachments && msg.attachments.length) {
      outer.appendChild(renderAttachmentRow(msg.attachments));
    }
    outer.appendChild(bubble);
    return outer;
  }

  outer.className = "msg-assistant";
  const contentDiv = document.createElement("div");
  contentDiv.className = "msg-content";
  if (msg.content) contentDiv.innerHTML = window.marked.parse(msg.content);
  outer.appendChild(contentDiv);
  if (msg.toolCalls && msg.toolCalls.length > 0 && state.viewMode !== "summary") {
    const toolEl = renderToolCalls(msg.toolCalls);
    if (toolEl) outer.appendChild(toolEl);
  }
  return outer;
}

function loadSessionHistory(turns) {
  state.messages = turns.map((turn) => ({
    id: mkId(),
    role: turn.role,
    content: turn.text,
    attachments: turn.attachments || [],
    toolCalls: [],
    timestamp: new Date().toISOString(),
  }));
  renderMessages();
}

bridge.imagesPicked.connect((json) => {
  try {
    const imported = JSON.parse(json).map(normalizeAttachment);
    state.pendingAttachments.push(...imported);
    renderPendingAttachments();
  } catch {}
});

bridge.imageImported.connect((requestId, json) => {
  const pending = pendingImports.get(requestId);
  if (!pending) return;
  pendingImports.delete(requestId);
  pending.resolve(normalizeAttachment(JSON.parse(json)));
});

DOM.attachBtn.addEventListener("click", () => {
  if (bridge) bridge.pickImages();
});

DOM.textarea.addEventListener("paste", async (event) => {
  const files = [...(event.clipboardData?.files || [])].filter((file) => file.type.startsWith("image/"));
  if (!files.length) return;
  event.preventDefault();
  const imported = await Promise.all(files.map(importClipboardFile));
  state.pendingAttachments.push(...imported);
  renderPendingAttachments();
});

DOM.messages.addEventListener("dragover", (event) => {
  event.preventDefault();
  document.getElementById("main")?.classList.add("drag-over");
});

DOM.messages.addEventListener("drop", async (event) => {
  event.preventDefault();
  document.getElementById("main")?.classList.remove("drag-over");
  const files = [...(event.dataTransfer?.files || [])].filter((file) => file.type.startsWith("image/"));
  const imported = await Promise.all(files.map(importClipboardFile));
  state.pendingAttachments.push(...imported);
  renderPendingAttachments();
});

DOM.imagePreviewClose.addEventListener("click", () => {
  DOM.imagePreviewModal.classList.remove("visible");
});

function generateSummary() {
  if (state.streaming || !bridge) return;
  state._summaryCapturing = true;
  DOM.generateSummaryBtn.disabled = true;
  DOM.generateSummaryBtn.textContent = "Generating…";
  startStreaming();
  bridge.sendMessage(
    'Summarize this conversation in exactly this JSON format (respond with only the JSON, no markdown fences): {"purpose": "one sentence", "current_state": "2-3 sentences", "outcome": "2-3 sentences"}',
    "[]",
  );
}
```

- [ ] **Step 5: Check the browser-side JavaScript for syntax errors**

Run from the repo root:

```bash
node --check resources/chat/chat.js
```

Expected: no output and exit code `0`.

- [ ] **Step 6: Commit**

```bash
git add resources/chat/index.html resources/chat/chat.css resources/chat/chat.js
git commit -m "feat(ui): add image attachment tray and history galleries"
```

### Task 6: Full Verification And Final Integration Commit

**Files:**
- Modify: all image-support changes already staged in prior tasks
- Test: `bridge/tests/*.test.ts`

- [ ] **Step 1: Run the full bridge test suite**

Run from `bridge/`:

```bash
npm test
```

Expected: PASS for all Vitest suites that do not require `ANTHROPIC_API_KEY`; integration tests remain skipped without the env var.

- [ ] **Step 2: Run bridge type-checking**

Run from `bridge/`:

```bash
npm run typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 3: Rebuild the desktop app**

Run from the repo root:

```bash
cmake --build /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt/build --parallel $(sysctl -n hw.ncpu)
```

Expected: PASS with `ClaudianQt` and the TypeScript bridge rebuilt.

- [ ] **Step 4: Run the project test suite**

Run from `build/`:

```bash
ctest --output-on-failure
```

Expected: PASS, including the `BridgeTests` target.

- [ ] **Step 5: Run the app and execute the manual checklist**

Run from `build/ClaudianQt.app/Contents/MacOS/`:

```bash
QT_PLUGIN_PATH=/opt/homebrew/Cellar/qtbase/6.11.0/share/qt/plugins ./ClaudianQt
```

Expected: the main chat window opens.

Manual checklist:

- Pick multiple `.png`/`.jpg` images with the Attach button and send them with text.
- Drag multiple images from Finder into the composer area and send them.
- Paste an image from the clipboard into the composer.
- Remove one pending image before sending and confirm only the remaining images are sent.
- Start a brand-new session, send images on the first turn, then reopen that session.
- Confirm reopened user turns render thumbnail galleries above the message text.
- Click a gallery thumbnail and confirm the larger preview modal opens and closes.
- Trigger a send failure intentionally and confirm pending attachments remain in the tray for retry.

- [ ] **Step 6: Create the final feature commit**

```bash
git add resources/chat/index.html resources/chat/chat.css resources/chat/chat.js src/attachmentstore.h src/attachmentstore.cpp src/claudebridge.h src/claudebridge.cpp src/mainwindow.cpp bridge/src/protocol.ts bridge/src/message-input.ts bridge/src/attachment-store.ts bridge/src/daemon.ts bridge/src/index.ts bridge/src/session-history.ts bridge/tests/message-input.test.ts bridge/tests/attachment-store.test.ts bridge/tests/session-history.test.ts bridge/tests/bridge.test.ts bridge/tests/daemon.test.ts CMakeLists.txt
git commit -m "feat(images): add desktop-style image attachments"
```

## Self-Review

### Spec Coverage

- Multi-image support: covered by Tasks 1, 3, and 5.
- Picker / drag-drop / paste intake: covered by Tasks 4 and 5.
- Managed copies: covered by Tasks 2 and 4.
- Persistent history thumbnails: covered by Tasks 2, 3, and 5.
- First-turn session finalization: covered by Task 3.
- Automated testing: covered by Tasks 1, 2, 3, and 6.
- Manual verification: covered by Task 6.

No gaps found.

### Placeholder Scan

- No `TBD`, `TODO`, or “implement later” placeholders remain.
- Every task uses exact file paths and concrete command lines.
- Every code-changing step includes concrete code to write.

### Type Consistency

- `OutboundAttachment`, `HistoryAttachment`, and `HistoryTurn` are reused consistently across the plan.
- `send` command shape is `prompt + attachments` everywhere.
- Session history returns `attachments: []` for all turns, avoiding optional-property drift between daemon and UI.
