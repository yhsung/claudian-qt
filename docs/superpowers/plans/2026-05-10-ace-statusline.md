# ACE GUI Statusline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a slim statusline bar above the input area showing active model name, context window usage (progress bar + %, token detail on hover), and turn count — updated after each turn completes.

**Architecture:** Wire the already-present but unconnected `BridgeDaemon::resultReceived` signal through `ClaudeBridge` (new `usageUpdated` signal) to JavaScript, which updates a new `#statusline` div using existing CSS variables and the established signal-connection pattern.

**Tech Stack:** Qt6 C++ (signals/slots), JavaScript (ES6), CSS3 (CSS custom properties from `chat.css`)

---

## File Map

| File | Change |
|---|---|
| `src/claudebridge.h` | Add `usageUpdated(const QString &json)` signal |
| `src/claudebridge.cpp` | Connect `m_daemon->resultReceived` → lambda → emit `usageUpdated` |
| `resources/chat/index.html` | Add `#statusline` div between `#attachment-tray` and `#input-area` |
| `resources/chat/chat.css` | Add `#statusline` and child element styles |
| `resources/chat/chat.js` | Add DOM refs, helper functions, and signal connections |

No changes to `bridge/src/daemon.ts`, `BridgeDaemon`, or `resources.qrc`.

---

## Build commands (reference for all tasks)

**Build:**
```bash
cd /path/to/claudian-qt/build
cmake --build . --parallel $(sysctl -n hw.ncpu)
```

**Run:**
```bash
QT_PLUGIN_PATH=/opt/homebrew/Cellar/qtbase/6.11.0/share/qt/plugins ./ClaudianQt
```

---

## Task 1: Wire `usageUpdated` signal in C++

**Files:**
- Modify: `src/claudebridge.h`
- Modify: `src/claudebridge.cpp`

- [ ] **Step 1: Add signal declaration to `claudebridge.h`**

In `src/claudebridge.h`, add `usageUpdated` after `imageImported` in the `signals:` block:

```cpp
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
    void imagesPicked(const QString &json);
    void imageImported(const QString &requestId, const QString &json);
    void usageUpdated(const QString &json);
```

- [ ] **Step 2: Add `QJsonDocument` include if not present**

Verify `src/claudebridge.cpp` already has `#include <QJsonDocument>` — it does (line 5). No change needed.

- [ ] **Step 3: Connect `resultReceived` in the `ClaudeBridge` constructor**

In `src/claudebridge.cpp`, inside the constructor body after the existing `connect` calls (before `m_daemon->start()`), add:

```cpp
    connect(m_daemon, &BridgeDaemon::resultReceived, this, [this](const QJsonObject &result) {
        int inputTokens  = 0;
        int outputTokens = 0;
        int contextWindow = 0;
        int numTurns = result["num_turns"].toInt(0);

        const QJsonObject modelUsage = result["modelUsage"].toObject();
        for (auto it = modelUsage.begin(); it != modelUsage.end(); ++it) {
            const QJsonObject m = it.value().toObject();
            inputTokens  += m["inputTokens"].toInt(0);
            outputTokens += m["outputTokens"].toInt(0);
            contextWindow = qMax(contextWindow, m["contextWindow"].toInt(0));
        }

        if (modelUsage.isEmpty()) {
            const QJsonObject usage = result["usage"].toObject();
            inputTokens  = usage["input_tokens"].toInt(0);
            outputTokens = usage["output_tokens"].toInt(0);
        }

        const QJsonObject payload{
            {"inputTokens",   inputTokens},
            {"outputTokens",  outputTokens},
            {"contextWindow", contextWindow},
            {"numTurns",      numTurns}
        };
        emit usageUpdated(
            QString::fromUtf8(QJsonDocument(payload).toJson(QJsonDocument::Compact))
        );
    });
```

The full constructor should look like this after the change:

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

    connect(m_daemon, &BridgeDaemon::resultReceived, this, [this](const QJsonObject &result) {
        int inputTokens  = 0;
        int outputTokens = 0;
        int contextWindow = 0;
        int numTurns = result["num_turns"].toInt(0);

        const QJsonObject modelUsage = result["modelUsage"].toObject();
        for (auto it = modelUsage.begin(); it != modelUsage.end(); ++it) {
            const QJsonObject m = it.value().toObject();
            inputTokens  += m["inputTokens"].toInt(0);
            outputTokens += m["outputTokens"].toInt(0);
            contextWindow = qMax(contextWindow, m["contextWindow"].toInt(0));
        }

        if (modelUsage.isEmpty()) {
            const QJsonObject usage = result["usage"].toObject();
            inputTokens  = usage["input_tokens"].toInt(0);
            outputTokens = usage["output_tokens"].toInt(0);
        }

        const QJsonObject payload{
            {"inputTokens",   inputTokens},
            {"outputTokens",  outputTokens},
            {"contextWindow", contextWindow},
            {"numTurns",      numTurns}
        };
        emit usageUpdated(
            QString::fromUtf8(QJsonDocument(payload).toJson(QJsonDocument::Compact))
        );
    });

    connect(m_daemon, &BridgeDaemon::daemonStarted, this, [this]() {
        m_daemon->sendCommand(QJsonObject{{"type", "set_cwd"},   {"cwd",   m_cwd}});
        if (!m_model.isEmpty())
            m_daemon->sendCommand(QJsonObject{{"type", "set_model"}, {"model", m_model}});
        if (m_yolo)
            m_daemon->sendCommand(QJsonObject{{"type", "set_yolo"},  {"yolo",  m_yolo}});
    });

    m_daemon->start();
}
```

- [ ] **Step 4: Build and verify no errors**

```bash
cd build && cmake --build . --parallel $(sysctl -n hw.ncpu) 2>&1 | tail -5
```

Expected: `[100%] Linking CXX executable ClaudianQt` with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/claudebridge.h src/claudebridge.cpp
git commit -m "feat: emit usageUpdated signal from resultReceived"
```

---

## Task 2: Add `#statusline` HTML structure

**Files:**
- Modify: `resources/chat/index.html`

- [ ] **Step 1: Insert the statusline div**

In `resources/chat/index.html`, insert `#statusline` between `<div id="attachment-tray"></div>` and `<div id="input-area">`. The relevant section of `index.html` should look like this after the change:

```html
    <div id="attachment-tray"></div>

    <div id="statusline">
      <span id="statusline-model">default</span>
      <div id="statusline-usage">
        <div id="statusline-bar-track">
          <div id="statusline-bar-fill"></div>
        </div>
        <span id="statusline-pct">—</span>
      </div>
      <span id="statusline-turns">—</span>
    </div>

    <div id="input-area">
```

- [ ] **Step 2: Build and verify the app still loads**

```bash
cd build && cmake --build . --parallel $(sysctl -n hw.ncpu) 2>&1 | tail -3
QT_PLUGIN_PATH=/opt/homebrew/Cellar/qtbase/6.11.0/share/qt/plugins ./ClaudianQt
```

Expected: app opens, the statusline area is present (unstyled) and the input area still works.

- [ ] **Step 3: Commit**

```bash
git add resources/chat/index.html
git commit -m "feat: add statusline HTML structure"
```

---

## Task 3: Style the statusline

**Files:**
- Modify: `resources/chat/chat.css`

- [ ] **Step 1: Append statusline CSS at end of `chat.css`**

Add the following block at the very end of `resources/chat/chat.css` (after the last rule, currently the `#image-preview-caption` block):

```css
/* ── Statusline ──────────────────────────────────────────────────────────── */
#statusline {
  display: flex; align-items: center; gap: 10px;
  padding: 0 16px; height: 24px; flex-shrink: 0;
  background: var(--bg-surface);
  border-top: 1px solid var(--border);
  font-size: 11px; color: var(--text-faint);
  font-family: var(--font-mono);
  user-select: none;
}
#statusline-model {
  color: var(--text-muted); flex-shrink: 0;
}
#statusline-usage {
  display: flex; align-items: center; gap: 6px; flex: 1;
}
#statusline-bar-track {
  width: 80px; height: 6px;
  background: var(--border); border-radius: 3px;
  overflow: hidden; flex-shrink: 0; cursor: default;
}
#statusline-bar-fill {
  height: 100%; width: 0%; border-radius: 3px;
  background: var(--green);
  transition: width 0.3s ease, background-color 0.3s ease;
}
#statusline-bar-fill.bar-warn   { background: var(--orange); }
#statusline-bar-fill.bar-danger { background: var(--red); }
#statusline-pct { flex-shrink: 0; }
#statusline-turns { margin-left: auto; flex-shrink: 0; }
```

- [ ] **Step 2: Build and visually verify**

```bash
cd build && cmake --build . --parallel $(sysctl -n hw.ncpu) 2>&1 | tail -3
QT_PLUGIN_PATH=/opt/homebrew/Cellar/qtbase/6.11.0/share/qt/plugins ./ClaudianQt
```

Expected: A slim dark bar is visible between the message area and the input box. It shows `default` on the left, `—` for usage, `—` for turns. The bar track is not visible yet (width 0%).

- [ ] **Step 3: Commit**

```bash
git add resources/chat/chat.css
git commit -m "feat: style statusline bar"
```

---

## Task 4: Wire JS logic for the statusline

**Files:**
- Modify: `resources/chat/chat.js`

- [ ] **Step 1: Add statusline DOM refs to `initDOM()`**

In `chat.js`, inside the `initDOM()` function (line ~139), extend the `DOM` object with these four entries. Add them after `imagePreviewClose`:

```js
  DOM = {
    // ... existing entries ...
    imagePreviewClose:    document.getElementById('image-preview-close'),
    statuslineModel:      document.getElementById('statusline-model'),
    statuslineBarTrack:   document.getElementById('statusline-bar-track'),
    statuslineBarFill:    document.getElementById('statusline-bar-fill'),
    statuslinePct:        document.getElementById('statusline-pct'),
    statuslineTurns:      document.getElementById('statusline-turns'),
  };
```

- [ ] **Step 2: Add statusline helper functions**

Add the following three functions to `chat.js` in the `// ── Controls ─────` section, after `syncCwd()` (line ~555) and before `// ── Sidebar toggle`:

```js
// ── Statusline ─────────────────────────────────────────────────────────────
function shortModelName(model) {
  return model ? model.replace(/^claude-/, '') : 'default';
}

function syncStatuslineModel(model) {
  DOM.statuslineModel.textContent = shortModelName(model);
}

function resetStatusline() {
  DOM.statuslineBarFill.style.width = '0%';
  DOM.statuslineBarFill.classList.remove('bar-warn', 'bar-danger');
  DOM.statuslineBarTrack.style.display = '';
  DOM.statuslineBarTrack.title = '';
  DOM.statuslinePct.textContent = '—';
  DOM.statuslinePct.title = '';
  DOM.statuslineTurns.textContent = '—';
}

function onUsageUpdated(jsonStr) {
  let data;
  try { data = JSON.parse(jsonStr); } catch { return; }
  const { inputTokens = 0, outputTokens = 0, contextWindow = 0, numTurns = 0 } = data;

  DOM.statuslineTurns.textContent = numTurns === 1 ? '1 turn' : `${numTurns} turns`;

  if (contextWindow > 0) {
    const total = inputTokens + outputTokens;
    const pct   = Math.min(100, Math.round((total / contextWindow) * 100));
    const fmt   = n => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
    const tip   = `${fmt(inputTokens)} in + ${fmt(outputTokens)} out / ${fmt(contextWindow)} ctx tokens`;

    DOM.statuslineBarTrack.style.display = '';
    DOM.statuslineBarFill.style.width = pct + '%';
    DOM.statuslineBarFill.classList.toggle('bar-warn',   pct >= 60 && pct < 85);
    DOM.statuslineBarFill.classList.toggle('bar-danger', pct >= 85);
    DOM.statuslineBarTrack.title = tip;
    DOM.statuslinePct.textContent = pct + '%';
    DOM.statuslinePct.title = tip;
  } else {
    const total = inputTokens + outputTokens;
    const fmt   = n => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
    DOM.statuslineBarTrack.style.display = 'none';
    DOM.statuslinePct.textContent = `${fmt(total)} tokens`;
    DOM.statuslinePct.title = '';
    DOM.statuslineBarTrack.title = '';
  }
}
```

- [ ] **Step 3: Connect `usageUpdated` in `wireBridgeSignals()`**

In `wireBridgeSignals()` (line ~676), add the `usageUpdated` connection after the `imageImported` block:

```js
  bridge.usageUpdated.connect(json => onUsageUpdated(json));
```

- [ ] **Step 4: Reset statusline on session clear and cwd change**

Update two existing lines in `wireBridgeSignals()`:

**Before (line ~686):**
```js
  bridge.sessionReady.connect(id => { state.activeSessionId = id; bridge.requestSessions(); });
```
**After:**
```js
  bridge.sessionReady.connect(id => {
    state.activeSessionId = id;
    if (!id) resetStatusline();
    bridge.requestSessions();
  });
```

**Before (line ~689):**
```js
  bridge.cwdChanged.connect(path => { syncCwd(path); state.activeSessionId = ''; bridge.requestSessions(); });
```
**After:**
```js
  bridge.cwdChanged.connect(path => { syncCwd(path); state.activeSessionId = ''; resetStatusline(); bridge.requestSessions(); });
```

- [ ] **Step 5: Update model pill on `modelChanged` and on init**

**Before (line ~690):**
```js
  bridge.modelChanged.connect(model => syncModel(model));
```
**After:**
```js
  bridge.modelChanged.connect(model => { syncModel(model); syncStatuslineModel(model); });
```

Also update the sync block at the bottom of `wireBridgeSignals()` (lines ~709-711) to include model pill init:

**Before:**
```js
  syncCwd(bridge.cwd);
  syncModel(bridge.model);
  syncYolo(bridge.yolo);
```
**After:**
```js
  syncCwd(bridge.cwd);
  syncModel(bridge.model);
  syncStatuslineModel(bridge.model);
  syncYolo(bridge.yolo);
```

- [ ] **Step 6: Build and verify**

```bash
cd build && cmake --build . --parallel $(sysctl -n hw.ncpu) 2>&1 | tail -3
QT_PLUGIN_PATH=/opt/homebrew/Cellar/qtbase/6.11.0/share/qt/plugins ./ClaudianQt
```

Expected at launch: statusline shows correct model name (or `default`), `—` for usage and turns.

- [ ] **Step 7: Commit**

```bash
git add resources/chat/chat.js
git commit -m "feat: wire statusline JS logic for usageUpdated, model, and session reset"
```

---

## Task 5: End-to-end manual test

- [ ] **Step 1: Launch and send a message**

```bash
QT_PLUGIN_PATH=/opt/homebrew/Cellar/qtbase/6.11.0/share/qt/plugins ./build/ClaudianQt
```

Send any message (e.g. "say hi"). After the turn completes verify:
- Progress bar fills to a non-zero width
- Percentage label (e.g. `2%`) appears next to the bar
- Turn count shows `1 turn`
- Hovering over the bar shows token detail tooltip (e.g. `1.2k in + 0.3k out / 200.0k ctx tokens`)

- [ ] **Step 2: Send a second message**

Send another message. After it completes:
- Bar advances
- Turn count shows `2 turns`

- [ ] **Step 3: Verify model pill**

Open the model dropdown in the input toolbar and switch to a different model (e.g. Sonnet). The statusline model pill should update immediately (before the next turn).

- [ ] **Step 4: Verify session reset**

Click "New Session". The statusline should reset to `—` for usage and turns. Send a message in the new session — it should fill again from zero.

- [ ] **Step 5: Verify cwd reset**

Click the `~/` button and pick a different directory. The statusline should reset to `—` for usage and turns. Model pill should remain.

- [ ] **Step 6: Commit if any fixes were needed**

If no fixes were needed, no commit required here. If fixes were applied, commit with:
```bash
git add -p
git commit -m "fix: statusline edge case <describe what you fixed>"
```
