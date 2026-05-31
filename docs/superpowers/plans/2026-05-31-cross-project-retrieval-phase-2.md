# Cross-Project Retrieval Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship trust-ranked cross-project retrieval with a global search entry, Explore view, mixed record/session results, preview-first navigation, and full validation.

**Architecture:** Keep the Phase 1 project workspace intact, add a retrieval adapter in the frontend for normalized mixed results, and extend the bridge/daemon search path only enough to support cross-project session hits. Ranking stays explicit and deterministic: trust tier first, match quality second, recency third.

**Tech Stack:** Qt WebEngine UI (`resources/chat/*`), vanilla JS ES modules, localStorage-backed project records, Qt bridge/daemon session search, Vitest frontend tests, bridge Vitest tests, CMake/CTest

---

## Scope Check

This plan implements the approved Phase 2 design in `docs/superpowers/specs/2026-05-31-cross-project-retrieval-phase-2-design.md`.

In scope:

- global retrieval entry point
- Explore view
- mixed cross-project results from records and sessions
- trust-ranked grouping
- preview-first navigation
- validation across frontend and bridge layers

Out of scope:

- vector or semantic indexing
- leadership rollups
- backend knowledge-store redesign

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `resources/chat/chat-retrieval.js` | Normalize record/session hits, rank results, build grouped result buckets, and produce preview payloads |
| Modify | `resources/chat/index.html` | Add global retrieval entry, Explore surface, and retrieval preview panel markup |
| Modify | `resources/chat/chat.css` | Style global search, Explore results, trust labels, and preview panel states |
| Modify | `resources/chat/chat.js` | Wire retrieval state, bridge search calls, result rendering, preview actions, and project/session navigation |
| Modify | `resources/resources.qrc` | Bundle any new frontend helper module |
| Modify | `src/claudebridge.h` | Declare cross-project session search bridge API if needed |
| Modify | `src/claudebridge.cpp` | Forward cross-project session search command to daemon |
| Modify | `bridge/src/daemon.ts` | Accept cross-project session search requests and return project-scoped raw session hits |
| Modify | `bridge/src/session-history.ts` | Add multi-cwd session search helper and normalized result metadata |
| Create | `bridge/tests/frontend/chat-retrieval.test.ts` | Unit tests for collection, ranking, grouping, and preview building |
| Modify | `bridge/tests/c2-knowledge.test.ts` | Add bridge-level coverage for multi-project session search |

## Task 1: Add cross-project session search to the bridge layer

**Files:**
- Modify: `bridge/src/session-history.ts`
- Modify: `bridge/src/daemon.ts`
- Modify: `src/claudebridge.h`
- Modify: `src/claudebridge.cpp`
- Modify: `bridge/tests/c2-knowledge.test.ts`

- [ ] **Step 1: Add a multi-project session search helper**

Extend `bridge/src/session-history.ts` with a helper that accepts multiple cwd values and returns session hits tagged with their originating cwd:

```ts
export type CrossProjectSearchResult = SearchResult & {
  cwd: string;
};

export async function searchSessionsAcrossProjects(
  cwds: string[],
  query: string,
  home = os.homedir(),
): Promise<CrossProjectSearchResult[]> {
  const uniqueCwds = [...new Set((cwds || []).filter(Boolean))];
  if (!query.trim() || !uniqueCwds.length) return [];

  const nested = await Promise.all(
    uniqueCwds.map(async (cwd) => {
      const hits = await searchSessions(cwd, query, home);
      return hits.map((hit) => ({ ...hit, cwd }));
    }),
  );

  return nested
    .flat()
    .sort((a, b) => b.hitCount - a.hitCount || b.sessionId.localeCompare(a.sessionId));
}
```

- [ ] **Step 2: Add bridge command plumbing**

Update `bridge/src/daemon.ts` and `src/claudebridge.*` so the frontend can request cross-project session search with an explicit cwd list:

```ts
case "search_sessions_across_projects": {
  const results = await searchSessionsAcrossProjects(cmd.cwds, cmd.query);
  emit({ type: "search_results", requestId: cmd.requestId, json: JSON.stringify(results) });
  break;
}
```

```cpp
Q_INVOKABLE void searchSessionsAcrossProjects(const QString &query, const QString &cwdsJson, const QString &requestId);
```

```cpp
void ClaudeBridge::searchSessionsAcrossProjects(const QString &query, const QString &cwdsJson, const QString &requestId) {
    m_daemon->sendCommand(QJsonObject{
        {"type", "search_sessions_across_projects"},
        {"query", query},
        {"cwds", QJsonDocument::fromJson(cwdsJson.toUtf8()).array()},
        {"requestId", requestId}
    });
}
```

- [ ] **Step 3: Add bridge tests for multiple cwd scopes**

Add targeted tests in `bridge/tests/c2-knowledge.test.ts` that prove:

- empty cwd lists return `[]`
- hits are returned from more than one cwd
- returned results carry the originating `cwd`
- hit count ordering still works

Run:

```bash
cd /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt/bridge
npm test -- tests/c2-knowledge.test.ts
```

Expected: targeted search tests pass with the new cross-project helper covered.

- [ ] **Step 4: Commit**

```bash
git add bridge/src/session-history.ts bridge/src/daemon.ts src/claudebridge.h src/claudebridge.cpp bridge/tests/c2-knowledge.test.ts
git commit -m "feat(retrieval): add cross-project session search"
```

## Task 2: Create frontend retrieval helpers and tests

**Files:**
- Create: `resources/chat/chat-retrieval.js`
- Create: `bridge/tests/frontend/chat-retrieval.test.ts`

- [ ] **Step 1: Add normalized retrieval helpers**

Create `resources/chat/chat-retrieval.js` with focused units for:

- collecting record results across projects
- normalizing raw session hits
- ranking by trust tier, match quality, then recency
- grouping results into `Best answers`, `Related records`, and `Raw session hits`
- building preview payloads

Target surface:

```js
export function collectRecordResults(projects, query, storage = localStorage) { /* ... */ }
export function collectSessionResults(projects, sessions, rawHits) { /* ... */ }
export function rankResults(results) { /* ... */ }
export function groupResults(results) { /* ... */ }
export function buildResultPreview(result) { /* ... */ }
```

The helper should encode trust tiers explicitly:

```js
const TRUST_TIER = {
  canonical: 0,
  reviewed: 1,
  extracted: 2,
  raw: 3,
  stale: 4,
  session: 5,
};
```

- [ ] **Step 2: Add frontend unit coverage**

Create `bridge/tests/frontend/chat-retrieval.test.ts` to cover:

- canonical records ranking above raw session hits
- reviewed records ranking above extracted records
- match quality breaking ties within a trust tier
- results grouped into the expected buckets
- preview payloads including project and source metadata

Run:

```bash
cd /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt/bridge
npm test -- tests/frontend/chat-retrieval.test.ts
```

Expected: retrieval helper tests pass and demonstrate trust-first ordering.

- [ ] **Step 3: Commit**

```bash
git add resources/chat/chat-retrieval.js bridge/tests/frontend/chat-retrieval.test.ts
git commit -m "feat(retrieval): add frontend retrieval helpers"
```

## Task 3: Add global retrieval and Explore UI shell

**Files:**
- Modify: `resources/chat/index.html`
- Modify: `resources/chat/chat.css`
- Modify: `resources/resources.qrc`

- [ ] **Step 1: Extend the shell markup**

Update `resources/chat/index.html` to add:

- a top-level global retrieval button or bar in the workspace header
- an `Explore` section button in project navigation
- a retrieval results surface in the main content area
- a dedicated retrieval preview panel separate from the existing code preview pane

The new markup should be explicit, not overloaded onto the current session search dropdown.

- [ ] **Step 2: Add retrieval styling**

Extend `resources/chat/chat.css` with styles for:

- global retrieval entry state
- Explore result cards
- trust/state badges
- grouped result sections
- preview panel layout and action buttons
- narrow-width behavior that keeps search usable

- [ ] **Step 3: Bundle any new helper modules**

If Task 2 introduced `chat-retrieval.js`, add it to `resources/resources.qrc`.

- [ ] **Step 4: Commit**

```bash
git add resources/chat/index.html resources/chat/chat.css resources/resources.qrc
git commit -m "feat(retrieval): add global retrieval shell"
```

## Task 4: Wire retrieval state, ranking, preview, and navigation

**Files:**
- Modify: `resources/chat/chat.js`

- [ ] **Step 1: Add retrieval state**

Extend the main frontend state with retrieval-specific fields:

```js
retrievalQuery: '',
retrievalResults: [],
retrievalGroups: [],
retrievalPreview: null,
retrievalOpen: false,
retrievalRequestId: 0,
sessionSearchHits: [],
```

- [ ] **Step 2: Replace project-scoped sidebar search with mixed retrieval orchestration**

In `chat.js`:

- keep the existing per-conversation search bar unchanged
- repurpose app-level session search into global retrieval
- call `bridge.searchSessionsAcrossProjects(...)` using known project `cwd` values
- collect record hits from all projects in local storage
- merge, rank, and group results through `chat-retrieval.js`

- [ ] **Step 3: Render Explore and preview-first flows**

Add rendering functions along these lines:

```js
function renderRetrievalResults() { /* grouped mixed results */ }
function openRetrievalPreview(result) { /* buildResultPreview + UI */ }
function openRetrievalSource(result) { /* load session and highlight source when possible */ }
function openRetrievalProject(result) { /* switch project, then focus section/result */ }
```

Behavior requirements:

- clicking a result opens preview first
- preview exposes `Open source`, `Open project`, `Copy link`
- canonical/reviewed records surface in `Best answers`
- raw sessions appear only in `Raw session hits`

- [ ] **Step 4: Preserve source highlighting and project switching**

When opening a session result from preview:

- switch active project if necessary
- load the owning session
- preserve excerpt-based highlighting if no exact source message is available

When opening a record result from preview:

- switch to the owning project
- select the section implied by record type where possible
- keep the preview-dismiss path predictable

- [ ] **Step 5: Commit**

```bash
git add resources/chat/chat.js
git commit -m "feat(retrieval): wire trust-ranked cross-project retrieval"
```

## Task 5: Verification, polish, and final validation

**Files:**
- Modify: `resources/chat/chat.js`
- Modify: `resources/chat/chat.css`
- Modify: any touched tests if fixes are required

- [ ] **Step 1: Run targeted frontend and bridge tests**

Run:

```bash
cd /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt/bridge
npm run typecheck
npm test -- tests/frontend/chat-projects.test.ts tests/frontend/chat-records.test.ts tests/frontend/chat-retrieval.test.ts tests/c2-knowledge.test.ts
npm test
```

Expected:

- `tsc --noEmit` exits 0
- targeted retrieval tests pass
- full bridge Vitest suite passes

- [ ] **Step 2: Run app-level build verification**

Run:

```bash
cd /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt/build
cmake --build . --parallel 8
ctest --output-on-failure
```

Expected:

- app bundle rebuilds successfully
- resource bundle includes retrieval helpers
- `ctest` passes or any unrelated pre-existing failure is documented

- [ ] **Step 3: Manual validation checklist**

Verify in the app:

1. Global retrieval is reachable from any project
2. Explore view shows mixed results across at least two projects
3. Canonical records rank above raw session hits for the same topic
4. Clicking a result opens preview first
5. `Open source` loads the expected session context
6. `Open project` switches workspace context correctly
7. Narrow-width layout keeps retrieval usable

- [ ] **Step 4: Commit**

```bash
git add resources/chat/chat.js resources/chat/chat.css bridge/tests/frontend/chat-retrieval.test.ts bridge/tests/c2-knowledge.test.ts resources/chat/chat-retrieval.js resources/chat/index.html resources/resources.qrc src/claudebridge.h src/claudebridge.cpp bridge/src/daemon.ts bridge/src/session-history.ts
git commit -m "fix(retrieval): finish phase-2 validation and polish"
```

## Self-Review

- Spec coverage: includes global search, Explore, mixed results, trust-first ranking, preview-first navigation, and validation.
- Placeholder scan: no TODO/TBD markers left in task steps.
- Scope check: still Phase 2 only; no vector retrieval, org rollups, or storage redesign.
