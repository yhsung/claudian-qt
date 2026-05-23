---
name: test-coverage
description: Use when asked about "coverage", "test coverage", "code coverage", "branch coverage", or "coverage report" in this repo — runs combined vitest v8 + NODE_V8_COVERAGE for both directly-imported and subprocess-spawned modules
---

# Test Coverage

Two-method coverage for ClaudianQt bridge layer.

## Problem

`daemon.ts` and `index.ts` are tested via subprocess spawning — vitest v8 cannot trace child processes. They show as 0% coverage.

## Solution

| Method | What it covers | Command |
|--------|---------------|---------|
| vitest v8 | Directly-imported `.ts` (attachment-store, message-input, session-history) | `npx vitest run --coverage` |
| NODE_V8_COVERAGE | All Node processes including spawned children (daemon.ts, index.ts) | `NODE_V8_COVERAGE=coverage/raw npx vitest run` |

## Quick Reference

```bash
# Full combined run (from bridge/)
cd bridge

# 1. Direct coverage (TS source, high accuracy)
npx vitest run --coverage

# 2. Subprocess coverage (traces spawned daemon/index processes)
mkdir -p coverage/raw
NODE_V8_COVERAGE=coverage/raw npx vitest run
npx c8 report \
  --temp-directory=coverage/raw \
  --reporter=text --reporter=text-summary \
  --src=src --exclude="src/protocol.ts"

# 3. Cleanup
rm -rf coverage/raw
```

## Config

`vitest.config.ts` excludes from v8 (subprocess-tested, v8 can't trace):
- `src/protocol.ts` — pure type definitions
- `src/daemon.ts` — spawned as `node dist/daemon.js`
- `src/index.ts` — spawned as `node dist/index.js`

## How NODE_V8_COVERAGE Works

Set `NODE_V8_COVERAGE=dir` — Node writes `<dir>/coverage-<pid>-<timestamp>.json` for every process including children spawned via `child_process.spawn()`. Use `npx c8 report --temp-directory=dir` to merge and report.

c8 measures compiled `dist/*.js`, not TS source — numbers appear ~30% lower than vitest v8 due to runtime helpers. Treat as directional, not authoritative.

## Interpreting Results

- **vitest v8 %**: TS source coverage for library modules. Target: >90% statements.
- **NODE_V8_COVERAGE %**: JS coverage for entry points. Lower because of compiled output. Focus on uncovered line numbers, not percentages.

## Dependencies

```bash
npm install -D @vitest/coverage-v8@^2.0.0
# c8 auto-installs via npx
```
