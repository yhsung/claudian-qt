# External Integrations

**Analysis Date:** 2026-03-28

## APIs & External Services

**Claude Code API (via subprocess):**
- Service: Claude Code CLI (`@anthropic-ai/claude-code`)
- What it's used for: LLM interactions — text generation, tool use (code execution, file operations), session management
- SDK/Client: `claude` subprocess invoked with `QProcess`
- Invocation: `claude --output-format stream-json --verbose --print <prompt> [--resume <session_id>] [--model <model>] [--dangerously-skip-permissions]`
- Output Format: Newline-delimited JSON (stream-json)
- Key signals from subprocess (parsed in `src/claudeprocess.cpp`):
  - `system/init` → `sessionInitialized(sessionId)` - Starts new session
  - `assistant` (content blocks) → `textReady(text)` or `toolUseStarted(name, inputJson)` - Streaming response
  - `result` → `turnFinished()` - Turn complete
  - Errors → `errorOccurred(msg)` - Parse/runtime errors

## Data Storage

**Session Management (Local only):**
- Storage: Claude CLI manages sessions locally (not exposed to this app)
- Client: `ClaudeProcess` passes `--resume <session_id>` flag to resume conversation
- Session persistence: Automatic via Claude CLI; app receives `session_id` from `system/init` message
- Session ID cleared: When working directory changes (via `ClaudeBridge::setCwd()`)

**File System (Local only):**
- Location: User-selected working directory (via native folder picker in `ClaudeBridge::pickFolder()`)
- Purpose: Context for Claude to operate in (cwd passed to subprocess)
- Access: Via Qt's `QProcess::setWorkingDirectory()` — subprocess inherits cwd
- No remote file access

**In-Memory Storage:**
- Conversation history: Stored locally in Claude CLI; UI renders from streamed chunks
- Toolbar state: `cwd`, `model`, `yolo` properties stored in `ClaudeBridge` (reset on app exit)

## Authentication & Identity

**Auth Provider:** None - local execution only

**Implementation:**
- No authentication required — Claude Code CLI runs locally with user's own API key (configured in Claude CLI globally)
- Application does NOT handle credentials — Claude CLI manages API authentication internally
- Model selection passed via `--model` flag (Haiku, Sonnet, Opus); no API key transmission through this app

## Monitoring & Observability

**Error Tracking:**
- Error output from subprocess captured and emitted: `bridge.errorOccurred(msg)` signal
- Rendered in UI as red text in `#qt-error` div
- No external error tracking service

**Logs:**
- Qt verbose output: `--verbose` flag passed to `claude` subprocess
- Stderr captured: Printed on subprocess exit if `exitCode != 0`
- Console logging in JavaScript via `console.log()` (visible in Chrome DevTools if QTWEBENGINE_REMOTE_DEBUGGING enabled)
- No remote logging service

**Debug Mode:**
- Remote debugging enabled via environment variable: `QTWEBENGINE_REMOTE_DEBUGGING=9222`
- Accessible at `http://127.0.0.1:9222` in Chrome-based browser

## CI/CD & Deployment

**Hosting:**
- GitHub (repository host)
- GitHub Releases (artifact distribution)

**CI Pipeline:**
- GitHub Actions (`.github/workflows/ci.yml` for build verification)
- Triggers: Push to `main`, Pull Requests to `main`
- Build steps:
  1. Checkout code
  2. Install Qt6 via `jurplel/install-qt-action@v4` (version 6.8.*)
  3. CMake configure + build
  4. App bundle verification

**Release Pipeline:**
- GitHub Actions (`.github/workflows/release.yml`)
- Trigger: Tag push matching `v*` (semantic versioning)
- Steps:
  1. Build app bundle
  2. Run `macdeployqt` to bundle dependencies
  3. Create DMG via `hdiutil`
  4. Upload DMG to GitHub Releases via `softprops/action-gh-release@v2`

**Distribution:**
- DMG file (macOS disk image) for manual download/installation
- Single architecture: ARM64 (`ClaudianQt-<version>-arm64.dmg`)

## Environment Configuration

**Required Environment Variables:**
- `QT_PLUGIN_PATH` - Path to Qt platform plugins (required to run standalone app)
  - Example: `/opt/homebrew/Cellar/qtbase/6.11.0/share/qt/plugins`
- `PATH` - Must include `claude` CLI executable (installed via `npm install -g @anthropic-ai/claude-code`)

**Optional Environment Variables:**
- `QTWEBENGINE_REMOTE_DEBUGGING` - Port for Chrome DevTools debugging (e.g., `9222`)

**Runtime Configuration Files:**
- `qt.conf` - Generated at build time; embedded in macOS app bundle at `Contents/Resources/qt.conf`
  - Configures Qt to load plugins from app bundle's `PlugIns/` directory

## Subprocess Communication

**Claude Code Process Management:**
- Spawned by: `ClaudeProcess::send()` in `src/claudeprocess.cpp`
- Managed by: `QProcess` instance
- Working directory: Set to user's selected cwd via `QProcess::setWorkingDirectory()`
- Channel mode: Separate stdout/stderr channels
- Output parsing: Line-by-line JSON parsing in `ClaudeProcess::parseLine()`
- Termination: `QProcess::kill()` on user abort or app exit

**QWebChannel Communication (Qt ↔ JS):**
- Transport: Qt's built-in QWebChannel protocol over WebSocket-like connection
- Registered object: `ClaudeBridge` registered as `"claude"` on `QWebChannel`
- Signals (Qt → JS): `textReady`, `toolUse`, `turnComplete`, `errorOccurred`, `cwdChanged`, `modelChanged`, `yoloChanged`, `sessionsListed`, `sessionHistoryLoaded`
- Slots (JS → Qt): `sendMessage`, `abort`, `setCwd`, `setModel`, `setYolo`, `pickFolder`, `requestSessions`, `loadSession`, `newSession`
- Usage in JS: Bootstrap code in `index.html` initializes `new QWebChannel(qt.webChannelTransport, callback)`

## Webhooks & Callbacks

**Incoming:** None

**Outgoing:** None

**Signal/Slot Pattern (Qt only):**
- Qt uses signals/slots instead of traditional callbacks
- `ClaudeBridge` emits signals; JavaScript listeners connected via `bridge.<signal>.connect(callback)`
- Examples:
  - `bridge.cwdChanged.connect(updateCwd)` - Updates UI when working directory changes
  - `bridge.textReady.connect(onTextReady)` - Renders streaming text
  - `bridge.sessionHistoryLoaded.connect(json => ...)` - Renders loaded session history

---

*Integration audit: 2026-03-28*
