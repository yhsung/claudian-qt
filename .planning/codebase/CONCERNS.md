# Codebase Concerns

**Analysis Date:** 2025-03-28

## Tech Debt

**Obsidian Shim as Architectural Centerpiece:**
- Issue: The entire application depends on a massive 527-line mock/shim (`resources/chat/obsidian-shim.js`) to make a plugin designed for Obsidian run in a plain WebEngine. This is not a small adaptation but a full reimplementation of Obsidian APIs.
- Files: `resources/chat/obsidian-shim.js`, `resources/chat/index.html` (bootstrap logic lines 356-758)
- Impact: Any changes to Obsidian API surface require shim updates. The approach is fundamentally brittle—upgrading ClaudianPlugin or Obsidian breaking changes will require manual shim patches. The plugin was never designed for this environment.
- Fix approach: Investigate whether a purpose-built UI for Qt (custom React/Vue or Qt QML) would be more sustainable than retrofitting Obsidian. If keeping the shim, document its fragility and create a deprecation timeline.

**QWebChannel JSON String Marshaling:**
- Issue: All data between C++ and JS is serialized to JSON strings. Signals carry JSON as QString (`sessionsListed`, `sessionHistoryLoaded`). The JS side must parse these manually.
- Files: `src/claudebridge.cpp` (lines 116, 194), `resources/chat/index.html` (lines 584-585, 608-610)
- Impact: No type safety. Parsing errors are silent (try-catch swallows errors). Adding new fields requires synchronization in two places. If JSON format changes, both layers must update in lockstep.
- Fix approach: Consider a more structured IPC mechanism (e.g., structured QML bindings if available), or at minimum document the JSON schema and add validation.

**Streaming JSON Parsing Without Validation:**
- Issue: `ClaudeProcess::parseLine()` (lines 74-104 in claudeprocess.cpp) parses newline-delimited JSON from the claude CLI with minimal error handling. Parsing errors are silently ignored (line 77).
- Files: `src/claudeprocess.cpp` (lines 74-104)
- Impact: If the claude CLI changes its stream-json format, malformed lines are dropped silently. The user sees no errors or warnings—the response simply stalls or becomes incomplete. No logging facility to debug what was received.
- Fix approach: Add structured logging of parse errors (with throttling to avoid spam). Add a schema validation layer or at least log rejected lines for debugging.

**Hardcoded Session Directory Encoding:**
- Issue: Session paths are encoded by replacing `/` with `-` in `claudeProjectDir()` (lines 66-70 in claudebridge.cpp). This works but is fragile and undocumented.
- Files: `src/claudebridge.cpp` (lines 66-70)
- Impact: If claude CLI changes how it encodes session paths, the entire history feature breaks. No version negotiation or fallback.
- Fix approach: Query the claude CLI for the correct project directory structure, or at least document and version this assumption.

## Known Bugs

**History Panel Toggle State Not Preserved Across Sessions:**
- Symptoms: Opening/closing the history panel works locally, but if you switch folders/sessions and come back, the panel state is lost.
- Files: `resources/chat/index.html` (lines 532-641, specifically `closeHistory()` at line 622)
- Cause: No persistent state storage for UI preferences. The history panel defaults to hidden every time.
- Workaround: Open the history panel again.
- Fix approach: Store UI state in localStorage or a Qt property.

**Error Messages May Be Truncated or Malformed:**
- Symptoms: Long error messages from the claude CLI may not display fully, or may contain escape sequences.
- Files: `src/claudeprocess.cpp` (lines 42-43: `readAllStandardError()`)
- Cause: No escaping or length limiting of stderr before emitting `errorOccurred`.
- Fix approach: Escape HTML entities and truncate long errors gracefully.

**Session History Reconstruction Only Shows First User Message:**
- Symptoms: In `loadSession()`, when scanning for the preview text, the loop breaks after finding the first user message and extracting the first text block. Subsequent content blocks in that user message are ignored in the preview.
- Files: `src/claudebridge.cpp` (lines 77-104, specifically lines 90-104)
- Cause: The preview extraction prioritizes speed over accuracy; it takes the first "text" it finds.
- Impact: Multi-part user messages (e.g., with images + text) show only the text part in the history preview.
- Fix approach: Aggregate all text blocks from the first user message into the preview.

## Security Considerations

**No Input Validation on Working Directory:**
- Risk: `setCwd()` accepts any QString path without validation. A malicious JS caller could set cwd to `/` or other sensitive directories.
- Files: `src/claudebridge.cpp` (lines 46-51)
- Current mitigation: The pickFolder() dialog uses `QFileDialog::DontResolveSymlinks`, but setCwd() can be called directly from JS with any path.
- Recommendations: Validate that the path is readable and not a system directory. Consider a whitelist of allowed base paths.

**Session IDs Passed to Claude CLI Without Escaping:**
- Risk: Session IDs are read from filesystem and passed directly to the `claude` subprocess as arguments (line 30 in claudeprocess.cpp).
- Files: `src/claudeprocess.cpp` (lines 29-30)
- Current mitigation: Session IDs are filesystem basenames (extracted from .jsonl filenames), so injection is unlikely, but not explicitly prevented.
- Recommendations: Validate session IDs as alphanumeric + hyphen only. Use QProcess argument lists instead of shell escaping.

**Model Parameter Not Validated:**
- Risk: User-supplied model name is passed to `claude --model <model>` without validation (line 32 in claudeprocess.cpp).
- Files: `src/claudeprocess.cpp` (lines 31-32)
- Current mitigation: The claude CLI would reject invalid models, so it fails safely.
- Recommendations: Document allowed model values and validate on the C++ side before passing to subprocess.

**Obsidian Shim Permits Arbitrary Require() Calls:**
- Risk: `window.require()` (obsidian-shim.js lines 18-144) is globally available. Malicious code in ClaudianPlugin could call require() for Node.js modules.
- Files: `resources/chat/obsidian-shim.js` (lines 18-144)
- Current mitigation: The shim only mocks common modules; it returns empty objects for unknown modules.
- Recommendations: This is inherent to running Obsidian plugins in a non-sandboxed environment. Document that untrusted plugins should not be used.

## Performance Bottlenecks

**Session History Reconstruction Reads Entire JSONL File:**
- Problem: `loadSession()` reads the entire .jsonl file line-by-line and reconstructs the conversation from scratch. For long sessions (1000+ turns), this is slow.
- Files: `src/claudebridge.cpp` (lines 119-195)
- Cause: No caching of reconstructed history. Every time the user loads a session, full reconstruction occurs.
- Improvement path: Cache reconstructed turns in memory or persist a separate `.turns.json` file that stores the pre-computed turns array.

**No Pagination on Session List:**
- Problem: `requestSessions()` loads all .jsonl files from ~/.claude/projects/<cwd>/ and returns them as a single JSON array. With hundreds of sessions, this is slow and the UI renders all at once.
- Files: `src/claudebridge.cpp` (lines 72-117)
- Cause: No pagination or lazy loading.
- Improvement path: Implement pagination or virtual scrolling in the UI. Load sessions in batches.

**Streaming Text Not Batched:**
- Problem: Each `textReady()` signal (emitted for every text chunk) triggers a JS rendering update. For fast responses, this could cause many reflows.
- Files: `src/claudeprocess.cpp` (line 92), `resources/chat/index.html` (lines 289-290)
- Cause: No batching of small text chunks.
- Improvement path: Buffer small text chunks in ClaudeProcess and emit periodically (e.g., every 100ms or 1KB).

## Fragile Areas

**ClaudeProcess::parseLine() Silent Failures:**
- Files: `src/claudeprocess.cpp` (lines 74-104)
- Why fragile: JSON parsing errors are caught but not logged. If the stream-json format changes, responses silently fail. The buffer management (lines 66-71) assumes newline-delimited JSON; any deviation causes data loss.
- Safe modification: Add logging before returning on parse error (line 77). Add a separate error signal for unrecognized message types. Consider a schema version in the stream-json format.
- Test coverage: No unit tests for invalid JSON inputs or protocol mismatches.

**MainWindow Widget Hierarchy:**
- Files: `src/mainwindow.cpp` (lines 1-18)
- Why fragile: The entire UI is delegated to JavaScript. If index.html fails to load or bootstrap (lines 356-758), the app shows a blank window. There is no fallback UI or error handling.
- Safe modification: Add a progress indicator or error dialog during bootstrap. Test with network errors simulated (e.g., missing qrc:// resources).
- Test coverage: Manual testing only.

**History Panel Event Listeners Not Cleaned Up:**
- Files: `resources/chat/index.html` (lines 613-631, 627-631)
- Why fragile: Event listeners are added to the history button and panel, but they're never removed. If the UI is re-rendered, duplicate listeners accumulate, causing multiple triggers per click.
- Safe modification: Use removeEventListener() or debounce clicks. Consider refactoring into a proper event manager.
- Test coverage: No automated testing for event delegation.

**Model and YOLO UI Sync via Mutation Observer:**
- Files: `resources/chat/index.html` (lines 707-730)
- Why fragile: The YOLO toggle state is synced using a MutationObserver watching class changes. This is brittle if ClaudianPlugin changes how it toggles classes.
- Safe modification: Replace with a proper state manager or event emitter. Verify that ClaudianPlugin's toggle behavior doesn't change between updates.
- Test coverage: No automated testing for UI sync logic.

**JSON Parsing in Signal Handlers:**
- Files: `resources/chat/index.html` (lines 584-610)
- Why fragile: signal handlers parse JSON with try-catch but log errors to console only. If JSON parsing fails, the UI silently stops updating.
- Safe modification: Add explicit error handling and user-facing notifications. Return early and emit a UI error state.
- Test coverage: No tests for malformed JSON responses.

## Scaling Limits

**Session File Storage:**
- Current capacity: Filesystem depends on available disk space; ~/.claude/projects/ is unmanaged.
- Limit: With thousands of sessions, directory listing (requestSessions) becomes slow. JSONL files grow indefinitely per session.
- Scaling path: Implement archival (compress old sessions), pagination, or a database backend (SQLite) instead of .jsonl files. Add quotas.

**Streaming Text Buffer in ClaudeProcess:**
- Current capacity: `m_buffer` (QByteArray) accumulates all stdout until a newline is found. For very large responses, this grows unbounded.
- Limit: In theory, very large text blocks (>100MB) could exhaust memory.
- Scaling path: Implement a fixed-size ring buffer or stream to disk for large responses. Add a configurable max chunk size.

**UI Rendering of Long Conversations:**
- Current capacity: ClaudianPlugin renders all messages in the DOM. With thousands of messages, scrolling becomes slow.
- Limit: Not quantified, but likely 1000+ messages cause noticeable lag.
- Scaling path: Implement virtual scrolling in ClaudianPlugin or in the Qt wrapper.

## Dependencies at Risk

**Obsidian Plugin Format (main.js):**
- Risk: `resources/claudian/main.js` is a pre-built CommonJS bundle (~69KB). It's not under source control (no .js files checked in). If ClaudianPlugin is updated, main.js must be regenerated.
- Impact: If the Obsidian plugin API changes, the bundle breaks and there's no way to rebuild it (no package.json or build script provided).
- Migration plan: Document how main.js is built and maintained. Consider vendoring source or using a git submodule for the Claudian plugin.

**Qt 6.11.0 Hardcoded in CMakeLists:**
- Risk: Build paths hardcode specific Qt 6.11.0 Cellar paths. CMakeLists.txt is not version-agnostic.
- Impact: Upgrading Qt breaks the build. Homebrew Qt updates silently change Cellar paths.
- Migration plan: Use `cmake --fresh` or detect Qt versions dynamically. Consider using Qt's config scripts (qt-cmake).

**Claude CLI Global Installation:**
- Risk: The app requires `npm install -g @anthropic-ai/claude-code` globally. If the CLI is uninstalled or incompatible, all features fail with a generic error.
- Impact: No graceful degradation or offline mode.
- Migration plan: Embed or vendor the claude CLI, or add a setup wizard to detect and install it.

## Missing Critical Features

**No Error Recovery or Retry Logic:**
- Problem: If a subprocess fails to start or crashes mid-response, there's no automatic retry. The user must manually resend the message.
- Blocks: Reliability in unstable network/system conditions.
- Fix: Add exponential backoff retry with user notification.

**No Conversation Export:**
- Problem: Session history is tied to .jsonl files in ~/.claude/projects/. There's no way to export to Markdown, PDF, or other formats.
- Blocks: Long-term record-keeping and sharing.
- Fix: Add export buttons to the history panel.

**No Search/Filter Over Sessions:**
- Problem: `requestSessions()` returns a flat list. With hundreds of sessions, finding a specific conversation is tedious.
- Blocks: Discoverability in large session collections.
- Fix: Add search by preview text or session date range.

**No Settings/Preferences UI:**
- Problem: Model selection and YOLO toggle are the only user-facing settings. No way to configure color scheme, font size, response timeout, etc.
- Blocks: Customization and accessibility.
- Fix: Add a settings panel or preferences file.

**No Offline/Cache Mode:**
- Problem: Every message requires a live connection to the claude CLI. If the CLI is unreachable, the app is unusable.
- Blocks: Offline usage.
- Fix: Consider caching recent responses or allowing local search of history.

## Test Coverage Gaps

**Untested JSON Stream Parsing:**
- What's not tested: `parseLine()` with malformed JSON, truncated lines, missing fields, extra fields.
- Files: `src/claudeprocess.cpp` (lines 74-104)
- Risk: Silent data loss if the claude CLI changes format.
- Priority: High

**Untested Session History Reconstruction:**
- What's not tested: JSONL files with missing fields, mixed content types, empty sessions, tool_result entries.
- Files: `src/claudebridge.cpp` (lines 119-195)
- Risk: Crashes or incorrect history display if session files are malformed.
- Priority: High

**Untested Process Lifecycle:**
- What's not tested: Subprocess crashes, timeouts, signal handling, buffer overflow on large responses.
- Files: `src/claudeprocess.cpp` (lines 20-59)
- Risk: Hung processes, memory leaks, zombie processes.
- Priority: High

**Untested UI Event Wiring:**
- What's not tested: History panel clicks, model selector updates, YOLO toggle, folder picker integration, XSS via history preview.
- Files: `resources/chat/index.html` (lines 532-756)
- Risk: Silent UI failures, event listener leaks, injection vulnerabilities.
- Priority: Medium

**No Integration Tests:**
- What's missing: End-to-end tests with a mock claude subprocess. Tests that verify the full signal chain from subprocess output to UI rendering.
- Risk: Regressions in the bridge layer go undetected.
- Priority: Medium

**No Obsidian Shim Tests:**
- What's not tested: The 527-line mock passes minimal stub implementations. Any plugin that deviates from expected behavior may break.
- Files: `resources/chat/obsidian-shim.js` (all)
- Risk: Plugin compatibility issues are discovered too late (runtime failures).
- Priority: Medium

---

*Concerns audit: 2025-03-28*
