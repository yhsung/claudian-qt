# Testing Patterns

**Analysis Date:** 2026-03-28

## Test Framework

**No Test Infrastructure Configured**

The codebase does not currently include:
- Unit test framework (QTest, Catch2, Google Test)
- Test configuration files
- Test runner scripts
- Automated test suite

**Testing Status:**
- Manual testing only
- No CI test step (GitHub Actions CI workflow builds but does not run tests)

**Why This Matters:**
- All changes are tested manually
- Regression risk is high for subprocess communication and JSON parsing
- WebEngine/Qt integration is difficult to test without headless infrastructure

## Build/Run Without Tests

**CI Configuration:**
GitHub Actions workflow (`.github/workflows/ci.yml`) builds the app but runs no tests:
```bash
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel $(sysctl -n hw.ncpu)
# Only verifies app bundle structure; does not execute tests
```

## Areas Demanding Test Coverage

### 1. **JSON Stream Parsing** (`claudeprocess.cpp`)
**Current Risk:** No tests for the critical `parseLine()` function

- Line 74-104: Parses newline-delimited JSON from `claude` CLI
- Handles three message types: `system/init`, `assistant`, `result`
- Emits signals for text, tool use, errors
- Potential bugs:
  - Malformed JSON silently ignored (could miss errors)
  - Tool input `QJsonDocument` conversion on line 94-95 assumes valid structure
  - Thinking blocks intentionally skipped; no test that this behavior is correct

**Ideal Test:**
```cpp
// Pseudocode (not in codebase)
TEST(ClaudeProcess, ParsesTextBlocks) {
    ClaudeProcess proc;
    QSignalSpy textReady(&proc, &ClaudeProcess::textReady);
    QByteArray json = R"({"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]}})"_ba;
    proc.parseLine(json);
    ASSERT_EQ(textReady.count(), 1);
    ASSERT_EQ(textReady.at(0).at(0).toString(), "Hello");
}
```

### 2. **Session File I/O** (`claudebridge.cpp`)
**Current Risk:** No tests for `requestSessions()` and `loadSession()`

- Line 72-117: `requestSessions()` reads JSONL files, extracts previews
- Line 119-195: `loadSession()` reconstructs conversation turns, skips tool_result entries
- Potential bugs:
  - Empty file handling (loop may not terminate)
  - Malformed JSONL lines silently skipped
  - Tool result filtering logic (line 156-162) complex; could break on edge cases
  - Preview truncation (line 99, 124) assumes text exists

**Ideal Test:**
```cpp
// Pseudocode
TEST(ClaudeBridge, SkipsToolResultEntries) {
    ClaudeBridge bridge;
    // Create test JSONL file with user + tool_result entry
    // Call loadSession()
    // Verify tool_result is excluded from turns
}
```

### 3. **Signal/Slot Connections** (`mainwindow.cpp`, `claudebridge.cpp`)
**Current Risk:** Qt signal connections difficult to test without integration harness

- Line 15-22 in `claudebridge.cpp`: Signal forwarding with lambda
- Line 36-46 in `claudeprocess.cpp`: Multi-signal connections
- Potential bugs:
  - Disconnection on destruction could leak; no automated check
  - Emitting signals in destructor (line 58: `emit turnFinished()`) risky

**Ideal Test:**
```cpp
// Pseudocode
TEST(ClaudeBridge, SignalsEmittedOnSendMessage) {
    ClaudeBridge bridge;
    QSignalSpy textReady(&bridge, &ClaudeBridge::textReady);
    bridge.sendMessage("test");
    // Mock QtBridgeService to simulate response
    // Verify signals received
}
```

### 4. **Path Encoding** (`claudebridge.cpp`)
**Current Risk:** Path encoding logic untested

- Line 66-70: `claudeProjectDir()` replaces `/` with `-`
- Used to build session history directory path
- Potential bugs:
  - Windows paths with `\` not handled
  - Paths with `-` already in them could collide with encoded slashes
  - No validation that encoded path is unique

**Ideal Test:**
```cpp
// Pseudocode
TEST(ClaudeBridge, EncodesPathCorrectly) {
    ASSERT_EQ(claudeProjectDir("/home/user/project"),
              "~/.claude/projects/-home-user-project");
}
```

### 5. **JavaScript QtBridgeService** (`index.html` lines 267-330)
**Current Risk:** Queue management and promise chaining untested

- `_enqueue()`: Queues chunks or resolves pending promise
- `_next()`: Returns next chunk or waits for one
- `query()`: Async generator pumping chunks from C++ signals
- Potential bugs:
  - Race conditions if `_next()` called concurrently
  - Waiter promise never resolved if abort called mid-stream
  - Error handling in `catch (_)` swallows parse errors silently

**Ideal Test:**
```javascript
// Pseudocode (Jest or Vitest)
describe('QtBridgeService', () => {
  it('queues text and resolves next()', async () => {
    const service = new QtBridgeService(mockBridge);
    service._enqueue({ type: 'text', content: 'Hello' });
    const chunk = await service._next();
    expect(chunk.content).toBe('Hello');
  });
});
```

## Testing Constraints

**Hard Constraints:**
1. **Qt Dependency:** Tests require Qt libraries linked (QTest, Qt Core)
2. **Subprocess Spawning:** Tests would need to mock or sandbox `claude` subprocess
3. **File System:** Tests need temporary directories for session JSONL files
4. **WebEngine/QWebChannel:** No headless runner configured; testing JS/C++ bridge requires browser simulation

**Platform Constraints:**
- macOS-only CI (see `.github/workflows/ci.yml`)
- Qt6 with WebEngine requires Xcode/clang

## Recommended Testing Infrastructure

**For C++ Unit Tests:**
- Add CMake `enable_testing()` and link GoogleTest or Catch2
- Mock `QProcess` for subprocess tests
- Create fixture files for JSONL parsing tests
- Update CI to run `ctest` after build

**For JavaScript Tests:**
- Add Jest or Vitest to handle module loading (`window.module.exports`)
- Mock QWebChannel bridge callbacks
- Test QtBridgeService queue/promise behavior
- Update CI to run `npm test` (requires `package.json`)

**For Integration Tests:**
- Use Qt's `QTest` to spawn real app, query via QWebChannel
- Feed test JSON sequences to WebChannel signals
- Verify UI rendering (limited without screenshot diffing)

## Current Testing Approach

**Manual Testing:**
1. Build from command line (`.github/workflows/ci.yml` pattern)
2. Run app: `QT_PLUGIN_PATH=... ./ClaudianQt`
3. Test scenarios by hand:
   - Send message to Claude, verify text streaming
   - Switch directories, confirm session clears
   - Resume session from history, verify conversation loads
4. Check subprocess logs with `--verbose` flag

**Risks of Manual Approach:**
- Regressions in JSON parsing go unnoticed until app fails
- Session persistence bugs only caught if user explores history
- Platform-specific Qt issues (Windows/Linux) won't be caught on macOS CI
- No regression protection for complex C++ object ownership

## Code Areas with Implicit Contracts

**Areas requiring careful manual testing (no unit tests available):**

1. **Subprocess Lifecycle** (`claudeprocess.cpp` lines 10-18, 20-54)
   - Process spawning, killing, cleanup
   - Contract: `killCurrent()` always leaves `m_proc == nullptr` and buffer empty
   - Manual test: Send message, abort, send again — should work

2. **State Transitions** (`claudebridge.cpp` lines 46-51)
   - Changing `cwd` clears session ID
   - Contract: `m_sessionId` always empty after `setCwd()` called
   - Manual test: Load session, pick new folder, send message — new session ID should appear

3. **Qt Object Ownership** (`mainwindow.cpp`, `claudebridge.cpp`)
   - Destructors must be safe; all `QObject` children reparented correctly
   - Contract: No dangling pointers, no double-delete on exit
   - Manual test: Launch, close app, no segfault

4. **QWebChannel Signal Marshalling** (`claudebridge.h`)
   - Signals registered with correct signatures
   - Contract: JS callbacks match C++ signal definitions
   - Manual test: Send message, listen for signals in console

---

*Testing analysis: 2026-03-28*
