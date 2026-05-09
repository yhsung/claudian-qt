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
