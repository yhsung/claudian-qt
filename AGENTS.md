# Repository Guidelines

## Project Structure & Module Organization
`src/` contains the Qt/C++ application layer: app entry (`main.cpp`), window/webview wiring (`mainwindow.*`), WebChannel bridge (`claudebridge.*`), and daemon bridge (`bridgedaemon.*`).  
`resources/chat/` contains the web UI (`index.html`, `chat.js`, `chat.css`, `marked.min.js`), bundled via `resources/resources.qrc`.  
`bridge/` contains the TypeScript daemon and protocol code (`src/*.ts`) plus tests (`bridge/tests/*.test.ts`).  
`docs/superpowers/plans/` stores design and implementation plans.

## Build, Test, and Development Commands
- Configure Qt build (from `build/`): use the explicit `Qt6_DIR`/`Qt6*Tools_DIR` Cellar paths described in `README.md` and `CLAUDE.md`.
- Build app: `cmake --build . --parallel $(sysctl -n hw.ncpu)`  
  Compiles C++ target and triggers TypeScript bridge build when `npm` is available.
- Run app: `QT_PLUGIN_PATH=/opt/homebrew/Cellar/qtbase/6.11.0/share/qt/plugins ./ClaudianQt`
- Run CTest suite (includes bridge test target): `ctest --output-on-failure`
- Run bridge tests directly: `cd bridge && npm test`
- Type-check bridge: `cd bridge && npm run typecheck`

## Coding Style & Naming Conventions
C++ uses C++17, 4-space indentation, `.h/.cpp` pairs, PascalCase classes, camelCase methods, and `m_`-prefixed members (Qt style).  
TypeScript/JS use 2-space indentation, ES module imports, and camelCase identifiers.  
No repository-wide auto-formatter is configured; preserve existing local style and keep includes/imports tidy.

## Testing Guidelines
Add/adjust tests for behavior changes in `bridge/src/*` using Vitest (`bridge/tests/*.test.ts`).  
Name tests by behavior (example: `session-history.test.ts`).  
For UI/bridge integration changes, run the app and verify message send/stream/abort/session flows manually in addition to automated tests.

## Commit & Pull Request Guidelines
Recent history follows Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`) with optional scopes (example: `fix(streaming): ...`). Use the same format.  
PRs should include: concise summary, rationale, test evidence (`ctest` / `npm test` output), and screenshots or short recordings for visible UI changes.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **claudian-qt** (812 symbols, 1253 relationships, 51 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/claudian-qt/context` | Codebase overview, check index freshness |
| `gitnexus://repo/claudian-qt/clusters` | All functional areas |
| `gitnexus://repo/claudian-qt/processes` | All execution flows |
| `gitnexus://repo/claudian-qt/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
