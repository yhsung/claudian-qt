# TypeScript Agent SDK Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `ClaudeProcess`'s direct `claude` CLI subprocess invocation with a TypeScript bridge process that uses the `@anthropic-ai/claude-agent-sdk` programmatic `query()` API.

**Architecture:** A new `bridge/` TypeScript project is compiled and bundled alongside the Qt app. `ClaudeProcess::send()` spawns `node bridge/dist/index.js`, writes a JSON command to its stdin, and reads `SDKMessage` JSON lines from stdout — the same wire format `parseLine()` already handles. C++ kill-on-abort is replaced by graceful `SIGTERM` → `AbortController.abort()` in the bridge. Session resume, model selection, and yolo/permission bypass all pass through the bridge's stdin command.

**Tech Stack:** TypeScript 5, Node.js 18+, `@anthropic-ai/claude-agent-sdk`, Qt6 C++17, CMake 3.16+

---

## File Map

| Action  | Path                            | Responsibility                                                 |
|---------|---------------------------------|----------------------------------------------------------------|
| Create  | `bridge/package.json`           | SDK dep, build script via `tsc`                                |
| Create  | `bridge/tsconfig.json`          | ESM output, NodeNext modules                                   |
| Create  | `bridge/.gitignore`             | Ignore `node_modules/` and `dist/`                             |
| Create  | `bridge/src/index.ts`           | Reads stdin JSON command, calls `query()`, writes events to stdout |
| Modify  | `src/claudeprocess.cpp`         | Replace `findClaudeBinary()`+args with bridge spawn + stdin write |
| Modify  | `src/claudeprocess.h`           | No signature changes; internal only                             |
| Modify  | `CMakeLists.txt`                | Custom target to `npm install && tsc`, copy dist into app bundle |

---

## Task 1: Scaffold the bridge TypeScript project

**Files:**
- Create: `bridge/package.json`
- Create: `bridge/tsconfig.json`
- Create: `bridge/.gitignore`

- [ ] **Step 1: Create bridge/package.json**

```json
{
  "name": "claudian-bridge",
  "version": "1.0.0",
  "description": "TypeScript bridge between ClaudianQt and the Claude Agent SDK",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc --noEmit false",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.2.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0"
  },
  "engines": {
    "node": ">=18"
  }
}
```

- [ ] **Step 2: Create bridge/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create bridge/.gitignore**

```
node_modules/
dist/
```

- [ ] **Step 4: Install dependencies**

```bash
cd bridge && npm install
```

Expected: `node_modules/@anthropic-ai/claude-agent-sdk` exists.

```bash
ls bridge/node_modules/@anthropic-ai/claude-agent-sdk/
```

Expected output includes: `sdk.d.ts`, `sdk.mjs`, `package.json`

- [ ] **Step 5: Commit**

```bash
git add bridge/package.json bridge/tsconfig.json bridge/.gitignore bridge/package-lock.json
git commit -m "feat(bridge): scaffold TypeScript bridge project with claude-agent-sdk"
```

---

## Task 2: Implement the bridge entry point

**Files:**
- Create: `bridge/src/index.ts`

- [ ] **Step 1: Create bridge/src/index.ts**

```typescript
import { query, AbortError } from "@anthropic-ai/claude-agent-sdk";

interface BridgeCommand {
  prompt: string;
  cwd?: string;
  sessionId?: string;
  model?: string;
  yolo?: boolean;
}

async function readStdinCommand(): Promise<BridgeCommand> {
  const chunks: string[] = [];
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    chunks.push(chunk as string);
  }
  return JSON.parse(chunks.join("").trim()) as BridgeCommand;
}

async function main(): Promise<void> {
  const cmd = await readStdinCommand();

  const abortController = new AbortController();
  const abort = (): void => abortController.abort();
  process.once("SIGTERM", abort);
  process.once("SIGINT", abort);

  try {
    const queryResult = query({
      prompt: cmd.prompt,
      options: {
        abortController,
        cwd: cmd.cwd,
        resume: cmd.sessionId || undefined,
        model: cmd.model || undefined,
        allowDangerouslySkipPermissions: cmd.yolo ?? false,
      },
    });

    for await (const message of queryResult) {
      process.stdout.write(JSON.stringify(message) + "\n");
    }
  } catch (err) {
    if (err instanceof AbortError) {
      process.exitCode = 0;
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(msg + "\n");
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  process.stderr.write(String(err) + "\n");
  process.exitCode = 1;
});
```

- [ ] **Step 2: Build the bridge**

```bash
cd bridge && npm run build
```

Expected: No TypeScript errors. `bridge/dist/index.js` exists.

```bash
ls bridge/dist/
```

Expected output: `index.js`

- [ ] **Step 3: Commit**

```bash
git add bridge/src/index.ts
git commit -m "feat(bridge): implement TypeScript bridge entry point using query()"
```

---

## Task 3: Smoke-test the bridge in isolation

**Files:**
- No changes — this is a test-only task

- [ ] **Step 1: Send a minimal prompt to the bridge via stdin**

```bash
echo '{"prompt":"Say hello in exactly 4 words","cwd":"/tmp","sessionId":"","model":"","yolo":false}' \
  | node bridge/dist/index.js
```

Expected: Multiple NDJSON lines on stdout, including:
1. A line with `"type":"system","subtype":"init"` containing a `session_id` string
2. One or more lines with `"type":"assistant"` containing `message.content`
3. A final line with `"type":"result","subtype":"success","is_error":false`

Example of expected lines (values will differ):
```
{"type":"system","subtype":"init","session_id":"abc123",...}
{"type":"assistant","message":{"content":[{"type":"text","text":"Hello there dear friend"}]},...}
{"type":"result","subtype":"success","is_error":false,"result":"Hello there dear friend",...}
```

- [ ] **Step 2: Verify SIGTERM abort behavior**

```bash
echo '{"prompt":"Count to 1000 slowly","cwd":"/tmp"}' | node bridge/dist/index.js &
PID=$!
sleep 1
kill -TERM $PID
wait $PID
echo "Exit code: $?"
```

Expected: Process exits with code 0 after receiving SIGTERM.

---

## Task 4: Modify ClaudeProcess to spawn the bridge

**Files:**
- Modify: `src/claudeprocess.cpp`

- [ ] **Step 1: Read current src/claudeprocess.cpp**

Read the full file before editing to understand existing structure.

- [ ] **Step 2: Replace findClaudeBinary() and update includes**

Replace the entire `findClaudeBinary()` function with `findNodeBinary()` and `findBridgeScript()`. Also add the `QCoreApplication` include.

Change the includes block at the top from:
```cpp
#include "claudeprocess.h"
#include <QDir>
#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QProcessEnvironment>
#include <QStandardPaths>
```

To:
```cpp
#include "claudeprocess.h"
#include <QCoreApplication>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QProcessEnvironment>
#include <QStandardPaths>
```

- [ ] **Step 3: Replace findClaudeBinary() with two new helper functions**

Remove `findClaudeBinary()` entirely and replace with:

```cpp
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

static QString findBridgeScript() {
    // Production: inside app bundle at Contents/Resources/bridge/index.js
    const QString bundlePath = QCoreApplication::applicationDirPath()
                               + "/../Resources/bridge/index.js";
    const QFileInfo bundleInfo(bundlePath);
    if (bundleInfo.exists())
        return bundleInfo.canonicalFilePath();

    // Development: <project-root>/bridge/dist/index.js
    // Binary location in dev: build/ClaudianQt.app/Contents/MacOS/ClaudianQt
    // That's 4 levels up to reach project root
    const QString devPath = QCoreApplication::applicationDirPath()
                            + "/../../../bridge/dist/index.js";
    const QFileInfo devInfo(devPath);
    if (devInfo.exists())
        return devInfo.canonicalFilePath();

    return {};
}
```

- [ ] **Step 4: Rewrite ClaudeProcess::send() to spawn the bridge**

Replace the entire `send()` method body with:

```cpp
void ClaudeProcess::send(const QString &prompt, const QString &cwd,
                         const QString &sessionId, const QString &model, bool yolo) {
    killCurrent();

    m_proc = new QProcess(this);
    m_proc->setWorkingDirectory(cwd);
    m_proc->setProcessChannelMode(QProcess::SeparateChannels);

    const QString nodePath   = findNodeBinary();
    const QString bridgePath = findBridgeScript();

    if (nodePath.isEmpty()) {
        emit errorOccurred("'node' not found.\n  Install Node.js 18+ to use the TypeScript bridge.");
        m_proc->deleteLater();
        m_proc = nullptr;
        return;
    }
    if (bridgePath.isEmpty()) {
        emit errorOccurred("Bridge script not found.\n  Run: cd bridge && npm install && npm run build");
        m_proc->deleteLater();
        m_proc = nullptr;
        return;
    }

    connect(m_proc, &QProcess::readyReadStandardOutput, this, &ClaudeProcess::onReadyRead);
    connect(m_proc, &QProcess::errorOccurred,           this, &ClaudeProcess::onProcessError);
    connect(m_proc, QOverload<int, QProcess::ExitStatus>::of(&QProcess::finished),
            this, [this](int exitCode, QProcess::ExitStatus) {
        onReadyRead();
        if (exitCode != 0) {
            const QString err = QString::fromUtf8(m_proc->readAllStandardError()).trimmed();
            if (!err.isEmpty()) emit errorOccurred(err);
        }
        emit turnFinished();
    });

    m_proc->start(nodePath, {bridgePath});
    if (!m_proc->waitForStarted(3000)) {
        emit errorOccurred("Failed to start bridge: " + bridgePath);
        m_proc->deleteLater();
        m_proc = nullptr;
        return;
    }

    QJsonObject cmd;
    cmd["prompt"]    = prompt;
    cmd["cwd"]       = cwd;
    cmd["sessionId"] = sessionId;
    cmd["model"]     = model;
    cmd["yolo"]      = yolo;
    m_proc->write(QJsonDocument(cmd).toJson(QJsonDocument::Compact) + "\n");
    m_proc->closeWriteChannel();
}
```

- [ ] **Step 5: Update onProcessError to reference node instead of claude**

Replace:
```cpp
void ClaudeProcess::onProcessError(QProcess::ProcessError error) {
    if (error == QProcess::FailedToStart)
        emit errorOccurred("'claude' not found in PATH.\n  npm install -g @anthropic-ai/claude-code");
}
```

With:
```cpp
void ClaudeProcess::onProcessError(QProcess::ProcessError error) {
    if (error == QProcess::FailedToStart)
        emit errorOccurred("'node' not found in PATH.\n  Install Node.js 18+ to use the TypeScript bridge.");
}
```

- [ ] **Step 6: Commit**

```bash
git add src/claudeprocess.cpp
git commit -m "feat(bridge): wire ClaudeProcess to spawn TypeScript bridge instead of claude CLI"
```

---

## Task 5: Fix parseLine for the new SDK result error format

**Files:**
- Modify: `src/claudeprocess.cpp`

**Context:** The old `claude --output-format stream-json` placed the error message in `result.result` (a string). The new `claude-agent-sdk` places errors in `result.errors` (a string array). `result.result` is absent on error subtypes.

- [ ] **Step 1: Update the result branch in parseLine()**

Find this block in `parseLine()`:
```cpp
    } else if (type == "result") {
        if (obj["is_error"].toBool()) {
            emit errorOccurred(obj["result"].toString());
        } else {
            qDebug() << "resultReceived:" << obj;
            emit resultReceived(obj);
        }
    }
```

Replace with:
```cpp
    } else if (type == "result") {
        if (obj["is_error"].toBool()) {
            QString msg;
            const QJsonArray errors = obj["errors"].toArray();
            if (!errors.isEmpty())
                msg = errors[0].toString();
            else if (obj.contains("result"))
                msg = obj["result"].toString();
            else
                msg = obj["subtype"].toString();
            emit errorOccurred(msg);
        } else {
            emit resultReceived(obj);
        }
    }
```

- [ ] **Step 2: Commit**

```bash
git add src/claudeprocess.cpp
git commit -m "fix(bridge): handle claude-agent-sdk errors[] array in parseLine result branch"
```

---

## Task 6: CMake integration — build bridge and bundle it

**Files:**
- Modify: `CMakeLists.txt`

- [ ] **Step 1: Read current CMakeLists.txt**

Read the full file before editing.

- [ ] **Step 2: Add bridge build target and bundle copy**

Append the following after the existing `add_custom_command(TARGET ClaudianQt POST_BUILD ...)` block:

```cmake
# Build the TypeScript bridge and bundle its output into the app
find_program(NPM_EXECUTABLE npm PATHS /opt/homebrew/bin /usr/local/bin)
if(NPM_EXECUTABLE)
    add_custom_target(ClaudeBridge ALL
        COMMAND ${NPM_EXECUTABLE} install --prefer-offline
        COMMAND ${NPM_EXECUTABLE} run build
        WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}/bridge
        COMMENT "Building TypeScript Claude Agent SDK bridge"
        VERBATIM
    )
    add_dependencies(ClaudianQt ClaudeBridge)

    # Copy dist/index.js into app bundle Resources/bridge/
    add_custom_command(TARGET ClaudianQt POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E make_directory
            "$<TARGET_BUNDLE_DIR:ClaudianQt>/Contents/Resources/bridge"
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "${CMAKE_SOURCE_DIR}/bridge/dist/index.js"
            "$<TARGET_BUNDLE_DIR:ClaudianQt>/Contents/Resources/bridge/index.js"
        COMMENT "Bundling TypeScript bridge into app bundle"
        VERBATIM
    )
    # Copy node_modules into app bundle so Node can resolve imports at runtime
    add_custom_command(TARGET ClaudianQt POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_directory
            "${CMAKE_SOURCE_DIR}/bridge/node_modules"
            "$<TARGET_BUNDLE_DIR:ClaudianQt>/Contents/Resources/bridge/node_modules"
        COMMENT "Copying bridge node_modules into app bundle"
        VERBATIM
    )
else()
    message(WARNING "npm not found — bridge will not be built automatically. "
                    "Run: cd bridge && npm install && npm run build")
endif()
```

- [ ] **Step 3: Verify the CMake configure step accepts the new target**

```bash
cd build && cmake .. \
  -DQt6_DIR="/opt/homebrew/Cellar/qtbase/6.11.0/lib/cmake/Qt6" \
  -DQt6CoreTools_DIR="/opt/homebrew/Cellar/qtbase/6.11.0/lib/cmake/Qt6CoreTools" \
  -DQt6GuiTools_DIR="/opt/homebrew/Cellar/qtbase/6.11.0/lib/cmake/Qt6GuiTools" \
  -DQt6WidgetsTools_DIR="/opt/homebrew/Cellar/qtbase/6.11.0/lib/cmake/Qt6WidgetsTools" \
  -DQt6QmlTools_DIR="/opt/homebrew/Cellar/qtdeclarative/6.11.0/lib/cmake/Qt6QmlTools" \
  "-DQT_ADDITIONAL_PACKAGES_PREFIX_PATH=$(ls /opt/homebrew/Cellar/ | grep '^qt' | grep -v '^qt$' | while read pkg; do echo -n "/opt/homebrew/Cellar/$pkg/6.11.0;"; done)" \
  2>&1 | grep -E "ClaudeBridge|npm|WARNING|Error"
```

Expected: No errors. Output may include `-- Found npm: /opt/homebrew/bin/npm`.

- [ ] **Step 4: Commit**

```bash
git add CMakeLists.txt
git commit -m "build: add CMake target to build and bundle TypeScript bridge"
```

---

## Task 7: Full build and integration test

**Files:**
- No new changes — build and run

- [ ] **Step 1: Build bridge manually (ensures dist/ exists before cmake build)**

```bash
cd bridge && npm install && npm run build && cd ..
ls bridge/dist/index.js
```

Expected: `bridge/dist/index.js` listed.

- [ ] **Step 2: CMake build**

```bash
cd build && cmake --build . --parallel $(sysctl -n hw.ncpu) 2>&1 | tail -20
```

Expected: Build succeeds. Last lines show `[100%] Built target ClaudianQt`.

- [ ] **Step 3: Verify bridge.js is present in app bundle**

```bash
ls build/ClaudianQt.app/Contents/Resources/bridge/
```

Expected: `index.js` and `node_modules/` directory listed.

- [ ] **Step 4: Launch the app**

```bash
QT_PLUGIN_PATH=/opt/homebrew/Cellar/qtbase/6.11.0/share/qt/plugins ./build/ClaudianQt.app/Contents/MacOS/ClaudianQt &
APP_PID=$!
```

- [ ] **Step 5: Verify it doesn't crash on startup**

Wait 3 seconds, then check the process is still running:

```bash
sleep 3 && ps -p $APP_PID > /dev/null && echo "App is running" || echo "App crashed"
```

Expected: `App is running`

- [ ] **Step 6: Send a message and verify response**

In the UI:
1. Type a short message (e.g. `"What is 2 + 2?"`)
2. Press Send
3. Verify a streaming response appears in the chat window
4. Verify the response completes (no spinner stuck)

- [ ] **Step 7: Verify session continuity**

1. Send a first message: `"My name is TestUser"`
2. Wait for response
3. Send a second message: `"What is my name?"`
4. Verify the response references `TestUser` (proves `session_id` resume works)

- [ ] **Step 8: Verify abort**

1. Send a long-running message: `"Count from 1 to 100, one number per line"`
2. While streaming, click the Abort button
3. Verify streaming stops cleanly (no crash, no stuck spinner)

- [ ] **Step 9: Kill the app and commit**

```bash
kill $APP_PID
```

```bash
git add -p  # stage any incidental fixes
git commit -m "test(bridge): integration verified — session, abort, streaming all functional"
```

---

## Self-Review Checklist

### Spec Coverage
- [x] Bridge spawns `node dist/index.js` instead of `claude` CLI
- [x] Bridge reads JSON command from stdin (handles special chars in prompt safely)
- [x] Bridge uses `@anthropic-ai/claude-agent-sdk` `query()` API
- [x] Session resume via `options.resume`
- [x] Model selection via `options.model`
- [x] yolo mode via `options.allowDangerouslySkipPermissions`
- [x] Abort via SIGTERM → `AbortController.abort()`
- [x] Wire format is NDJSON — `parseLine()` unchanged except error handling
- [x] Bridge bundled into app bundle for production
- [x] CMake builds bridge automatically
- [x] Error message extraction handles `errors[]` array (new SDK format)

### Placeholder Scan
- All code blocks are complete — no TBD or TODO in implementation steps
- All commands include expected output

### Type Consistency
- `BridgeCommand` interface in `index.ts` matches the `QJsonObject cmd` fields in `send()`:
  - `prompt` ↔ `cmd["prompt"]`
  - `cwd` ↔ `cmd["cwd"]`
  - `sessionId` ↔ `cmd["sessionId"]`
  - `model` ↔ `cmd["model"]`
  - `yolo` ↔ `cmd["yolo"]`
- `findBridgeScript()` returns the same filename (`index.js`) that `bridge/dist/` produces
- App bundle path in `findBridgeScript()` matches the CMake copy destination (`Contents/Resources/bridge/index.js`)
