# Project-Scoped Capture Workspace Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current session-first chat shell with a project-scoped capture workspace that keeps the existing daemon/session backend intact while making capture, trust, and navigation first-class in the GUI.

**Architecture:** Phase 1 is a frontend-first vertical slice. Keep the existing Qt bridge and daemon session model, then layer a project shell and record model on top in the web UI. Projects and promoted records are persisted in `localStorage`, while sessions and turns remain sourced from the existing bridge APIs. This gives us a working project/inbox/work-log/knowledge-rail experience without blocking on backend schema work.

**Tech Stack:** Qt WebEngine UI (`resources/chat/*`), vanilla JS ES modules, `localStorage`, Vitest frontend tests in `bridge/tests/frontend`

---

## Scope Check

The approved spec covers multiple future subsystems: project IA, record extraction, trust states, retrieval, and later leadership roll-ups. This file is intentionally the **phase-1 executable plan** for the first working slice:

- project shell
- inbox/work-log navigation
- promoted knowledge records with explicit states
- advanced controls hidden behind a drawer

Later phases should handle richer extraction automation, cross-project navigation, and director/GM roll-ups in separate plans.

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `resources/chat/chat-projects.js` | Pure helpers for project loading, default project creation, and project summaries |
| Create | `resources/chat/chat-records.js` | Pure helpers for promoted records, source refs, and record state updates |
| Modify | `resources/chat/index.html` | Replace session-first shell markup with project shell and advanced drawer trigger |
| Modify | `resources/chat/chat.css` | New left rail / center workspace / right rail layout and advanced drawer styling |
| Modify | `resources/chat/chat.js` | Project state, new rendering flow, knowledge rail actions, advanced drawer wiring |
| Create | `bridge/tests/frontend/chat-projects.test.ts` | Unit tests for project helper logic |
| Create | `bridge/tests/frontend/chat-records.test.ts` | Unit tests for record promotion/state transitions |
| Modify | `bridge/tests/frontend/chat-draft.test.ts` | Optional small adjustment only if helper imports need neighboring test pattern updates |

No C++ or daemon changes in phase 1.

## Task 1: Create pure project-state helpers and tests

**Files:**
- Create: `resources/chat/chat-projects.js`
- Create: `bridge/tests/frontend/chat-projects.test.ts`

- [ ] **Step 1: Create `chat-projects.js` with storage-safe helpers**

Create `resources/chat/chat-projects.js` with:

```js
const PROJECTS_KEY = 'claudian:projects:v1';
const ACTIVE_PROJECT_KEY = 'claudian:active-project:v1';

export function defaultProjectId(cwd) {
  return `cwd:${cwd || '~'}`;
}

export function createDefaultProject(cwd) {
  const id = defaultProjectId(cwd);
  return {
    id,
    name: cwd ? cwd.split('/').filter(Boolean).slice(-1)[0] || cwd : 'Workspace',
    cwd: cwd || '',
    sections: ['inbox', 'worklog', 'decisions', 'artifacts', 'questions', 'people'],
    createdAt: new Date(0).toISOString(),
    pinnedSessionIds: [],
  };
}

export function loadProjects(storage = localStorage) {
  try {
    const raw = storage.getItem(PROJECTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveProjects(projects, storage = localStorage) {
  storage.setItem(PROJECTS_KEY, JSON.stringify(projects));
}

export function ensureProjectForCwd(projects, cwd) {
  const id = defaultProjectId(cwd);
  const existing = projects.find(p => p.id === id);
  if (existing) return { projects, project: existing };
  const next = [...projects, createDefaultProject(cwd)];
  return { projects: next, project: next[next.length - 1] };
}

export function loadActiveProjectId(storage = localStorage) {
  return storage.getItem(ACTIVE_PROJECT_KEY) || '';
}

export function saveActiveProjectId(projectId, storage = localStorage) {
  storage.setItem(ACTIVE_PROJECT_KEY, projectId);
}

export function buildProjectSummary(project, sessions, records) {
  const projectSessions = sessions.filter(s => (s.cwd || '') === (project.cwd || ''));
  return {
    sessionCount: projectSessions.length,
    exportedCount: projectSessions.filter(s => s.exportedAt).length,
    recordCount: records.length,
    canonicalCount: records.filter(r => r.state === 'canonical').length,
    staleCount: records.filter(r => r.state === 'stale').length,
  };
}
```

- [ ] **Step 2: Add Vitest coverage for default-project and persistence behavior**

Create `bridge/tests/frontend/chat-projects.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  createDefaultProject,
  defaultProjectId,
  ensureProjectForCwd,
  buildProjectSummary,
} from '../../../resources/chat/chat-projects.js';

describe('defaultProjectId', () => {
  it('keys projects by cwd', () => {
    expect(defaultProjectId('/tmp/demo')).toBe('cwd:/tmp/demo');
  });
});

describe('ensureProjectForCwd', () => {
  it('creates a default project when none exists', () => {
    const result = ensureProjectForCwd([], '/tmp/demo');
    expect(result.projects).toHaveLength(1);
    expect(result.project.id).toBe('cwd:/tmp/demo');
  });

  it('reuses an existing project for the same cwd', () => {
    const existing = createDefaultProject('/tmp/demo');
    const result = ensureProjectForCwd([existing], '/tmp/demo');
    expect(result.projects).toHaveLength(1);
    expect(result.project).toBe(existing);
  });
});

describe('buildProjectSummary', () => {
  it('counts sessions and canonical records for one project', () => {
    const project = createDefaultProject('/tmp/demo');
    const sessions = [
      { id: 'a', cwd: '/tmp/demo' },
      { id: 'b', cwd: '/tmp/demo', exportedAt: '2026-05-30T00:00:00Z' },
      { id: 'c', cwd: '/tmp/other' },
    ];
    const records = [
      { id: 'r1', state: 'canonical' },
      { id: 'r2', state: 'raw' },
      { id: 'r3', state: 'stale' },
    ];
    expect(buildProjectSummary(project, sessions, records)).toEqual({
      sessionCount: 2,
      exportedCount: 1,
      recordCount: 3,
      canonicalCount: 1,
      staleCount: 1,
    });
  });
});
```

- [ ] **Step 3: Run the new targeted frontend test**

Run:

```bash
cd /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt/bridge
npm test -- tests/frontend/chat-projects.test.ts
```

Expected: `1 passed` test file with all helper assertions green.

- [ ] **Step 4: Commit**

```bash
git add resources/chat/chat-projects.js bridge/tests/frontend/chat-projects.test.ts
git commit -m "feat(gui): add project state helpers for workspace shell"
```

## Task 2: Create pure record helpers and tests for trust/provenance

**Files:**
- Create: `resources/chat/chat-records.js`
- Create: `bridge/tests/frontend/chat-records.test.ts`

- [ ] **Step 1: Create `chat-records.js`**

Create `resources/chat/chat-records.js`:

```js
export const RECORD_STATES = ['raw', 'extracted', 'reviewed', 'canonical', 'stale'];

export function recordsStorageKey(projectId) {
  return `claudian:records:${projectId}`;
}

export function loadRecords(projectId, storage = localStorage) {
  try {
    const raw = storage.getItem(recordsStorageKey(projectId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveRecords(projectId, records, storage = localStorage) {
  storage.setItem(recordsStorageKey(projectId), JSON.stringify(records));
}

export function buildSourceRef(sessionId, messageId, role, index) {
  return { sessionId, messageId, role, index };
}

export function promoteRecord(records, draft) {
  const record = {
    id: draft.id,
    type: draft.type,
    title: draft.title.trim(),
    body: draft.body.trim(),
    state: draft.state || 'extracted',
    source: draft.source,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt || draft.createdAt,
  };
  return [record, ...records.filter(r => r.id !== record.id)];
}

export function transitionRecordState(records, recordId, nextState) {
  if (!RECORD_STATES.includes(nextState)) return records;
  return records.map(r => r.id === recordId ? { ...r, state: nextState } : r);
}

export function groupRecordsByType(records) {
  return records.reduce((acc, record) => {
    (acc[record.type] ||= []).push(record);
    return acc;
  }, {});
}
```

- [ ] **Step 2: Add tests for promotion and state transitions**

Create `bridge/tests/frontend/chat-records.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  buildSourceRef,
  groupRecordsByType,
  promoteRecord,
  transitionRecordState,
} from '../../../resources/chat/chat-records.js';

describe('promoteRecord', () => {
  it('prepends a normalized promoted record', () => {
    const records = [];
    const source = buildSourceRef('sess-1', 'msg-1', 'assistant', 3);
    const next = promoteRecord(records, {
      id: 'rec-1',
      type: 'decision',
      title: ' Use sqlite ',
      body: ' Keep project storage local ',
      source,
      createdAt: '2026-05-30T00:00:00Z',
    });
    expect(next[0]).toMatchObject({
      id: 'rec-1',
      type: 'decision',
      title: 'Use sqlite',
      body: 'Keep project storage local',
      state: 'extracted',
      source,
    });
  });
});

describe('transitionRecordState', () => {
  it('changes only the targeted record', () => {
    const records = [
      { id: 'a', state: 'raw' },
      { id: 'b', state: 'reviewed' },
    ];
    expect(transitionRecordState(records, 'a', 'canonical')).toEqual([
      { id: 'a', state: 'canonical' },
      { id: 'b', state: 'reviewed' },
    ]);
  });
});

describe('groupRecordsByType', () => {
  it('groups records into type buckets', () => {
    const grouped = groupRecordsByType([
      { id: '1', type: 'decision' },
      { id: '2', type: 'artifact' },
      { id: '3', type: 'decision' },
    ]);
    expect(grouped.decision).toHaveLength(2);
    expect(grouped.artifact).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run the new targeted test**

Run:

```bash
cd /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt/bridge
npm test -- tests/frontend/chat-records.test.ts
```

Expected: all record helper tests pass with no TypeScript or ESM import errors.

- [ ] **Step 4: Commit**

```bash
git add resources/chat/chat-records.js bridge/tests/frontend/chat-records.test.ts
git commit -m "feat(gui): add promoted record helpers for knowledge rail"
```

## Task 3: Replace session-first HTML with project workspace shell

**Files:**
- Modify: `resources/chat/index.html`
- Modify: `resources/chat/chat.css`

- [ ] **Step 1: Restructure the main shell in `index.html`**

Replace the current sidebar/topbar framing with a project shell that still preserves existing message/input IDs. Add the new structural IDs without breaking current message rendering:

```html
<div id="app">
  <aside id="workspace-rail">
    <div id="project-switcher"></div>
    <nav id="project-sections">
      <button class="project-section-btn active" data-section="inbox">Inbox</button>
      <button class="project-section-btn" data-section="worklog">Work Log</button>
      <button class="project-section-btn" data-section="decisions">Decisions</button>
      <button class="project-section-btn" data-section="artifacts">Artifacts</button>
      <button class="project-section-btn" data-section="questions">Open Questions</button>
      <button class="project-section-btn" data-section="people">People</button>
    </nav>
    <div id="project-summary-cards"></div>
    <div id="session-list"></div>
  </aside>

  <main id="workspace-main">
    <header id="workspace-topbar">
      <div id="project-context">
        <span id="project-name">Workspace</span>
        <span id="project-subtitle">Inbox / Capture</span>
      </div>
      <div id="workspace-actions">
        <button id="search-btn" title="Search conversation (⌘F)">...</button>
        <button id="export-btn" title="Export transcript">...</button>
        <button id="advanced-toggle-btn" title="Advanced controls">Advanced</button>
      </div>
    </header>

    <div id="capture-layout">
      <section id="capture-center">
        <div id="search-bar">...</div>
        <div id="messages" class="fs-md"></div>
        <button id="scroll-to-bottom" title="Scroll to bottom">↓</button>
        <div id="summary-view"></div>
        <div id="typing-indicator"></div>
        <div id="attachment-tray"></div>
        <div id="statusline"></div>
        <div id="input-area"></div>
      </section>

      <aside id="knowledge-rail">
        <div id="knowledge-rail-header">
          <span>Knowledge</span>
          <span id="knowledge-rail-count">0 records</span>
        </div>
        <div id="knowledge-suggestions"></div>
        <div id="knowledge-records"></div>
      </aside>
    </div>
  </main>
</div>

<div id="advanced-drawer" class="advanced-drawer">
  <div id="settings-scroll-container" style="display:none">...</div>
</div>
```

Keep the existing child markup for `search-bar`, `summary-view`, `typing-indicator`, `attachment-tray`, `statusline`, and `input-area`; move those blocks into the new shell instead of rewriting their internals in this task.

- [ ] **Step 2: Add workspace-shell styles to `chat.css`**

Append the new layout styles before preview-pane styles so the shell is defined first:

```css
#workspace-rail {
  width: 280px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 12px;
  background: linear-gradient(180deg, #131316 0%, #17181d 100%);
  border-right: 1px solid var(--border);
}

#workspace-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

#workspace-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px 12px;
  border-bottom: 1px solid var(--border);
  background:
    radial-gradient(circle at top left, rgba(217,119,87,0.18), transparent 28%),
    linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0));
}

#capture-layout {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
}

#capture-center {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

#knowledge-rail {
  border-left: 1px solid var(--border);
  background: rgba(255,255,255,0.02);
  padding: 14px 12px;
  overflow-y: auto;
}

.advanced-drawer {
  position: fixed;
  inset: 0 0 0 auto;
  width: min(420px, 100vw);
  transform: translateX(100%);
  transition: transform 0.2s ease;
  background: #16171b;
  border-left: 1px solid var(--border);
  z-index: 120;
}

.advanced-drawer.open {
  transform: translateX(0);
}
```

- [ ] **Step 3: Build to verify the HTML/CSS changes are syntactically valid**

Run:

```bash
cd /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt/build
cmake --build . --parallel $(sysctl -n hw.ncpu)
```

Expected: CMake completes successfully; no resource bundling errors from malformed HTML.

- [ ] **Step 4: Commit**

```bash
git add resources/chat/index.html resources/chat/chat.css
git commit -m "feat(gui): add project-scoped workspace shell"
```

## Task 4: Rewire `chat.js` to drive projects, inbox/work-log navigation, and the advanced drawer

**Files:**
- Modify: `resources/chat/chat.js`

- [ ] **Step 1: Import the new helper modules and extend state**

At the top of `resources/chat/chat.js`, add:

```js
import {
  buildProjectSummary,
  ensureProjectForCwd,
  loadActiveProjectId,
  loadProjects,
  saveActiveProjectId,
  saveProjects,
} from './chat-projects.js';
import {
  buildSourceRef,
  groupRecordsByType,
  loadRecords,
  promoteRecord,
  saveRecords,
  transitionRecordState,
} from './chat-records.js';
```

Extend `state` with:

```js
  projects: [],
  activeProjectId: '',
  activeSection: 'inbox',
  records: [],
  selectedSourceRef: null,
  advancedOpen: false,
```

- [ ] **Step 2: Add DOM refs for the new workspace shell**

Inside `initDOM()` add:

```js
    projectSwitcher: document.getElementById('project-switcher'),
    projectSections: document.getElementById('project-sections'),
    projectSummaryCards: document.getElementById('project-summary-cards'),
    projectName: document.getElementById('project-name'),
    projectSubtitle: document.getElementById('project-subtitle'),
    advancedToggleBtn: document.getElementById('advanced-toggle-btn'),
    advancedDrawer: document.getElementById('advanced-drawer'),
    knowledgeRailCount: document.getElementById('knowledge-rail-count'),
    knowledgeSuggestions: document.getElementById('knowledge-suggestions'),
    knowledgeRecords: document.getElementById('knowledge-records'),
```

- [ ] **Step 3: Add project bootstrapping and rendering helpers**

Before `wireEvents()`, add:

```js
function currentProject() {
  return state.projects.find(p => p.id === state.activeProjectId) || null;
}

function bootProjects() {
  const loaded = loadProjects();
  const { projects, project } = ensureProjectForCwd(loaded, state.cwd);
  state.projects = projects;
  saveProjects(projects);
  state.activeProjectId = loadActiveProjectId() || project.id;
  saveActiveProjectId(state.activeProjectId);
  state.records = loadRecords(state.activeProjectId);
}

function renderProjectShell() {
  const project = currentProject();
  if (!project) return;
  const summary = buildProjectSummary(project, state.sessions, state.records);
  DOM.projectName.textContent = project.name;
  DOM.projectSubtitle.textContent = state.activeSection === 'inbox' ? 'Inbox / Capture' : state.activeSection;
  DOM.projectSummaryCards.innerHTML = `
    <div class="project-summary-card"><strong>${summary.sessionCount}</strong><span>sessions</span></div>
    <div class="project-summary-card"><strong>${summary.recordCount}</strong><span>records</span></div>
    <div class="project-summary-card"><strong>${summary.canonicalCount}</strong><span>canonical</span></div>
  `;
}

function sessionsForActiveProject() {
  const project = currentProject();
  if (!project) return [];
  return state.sessions.filter(s => (s.cwd || '') === (project.cwd || ''));
}
```

- [ ] **Step 4: Change session rendering to project-scoped session rendering**

In `renderSessions(sessions)`, stop rendering all sessions. Replace the starting dataset with:

```js
const visibleSessions = sessionsForActiveProject()
  .filter(s => state.showArchived ? true : !s.archived)
  .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
```

Then render `visibleSessions` instead of the raw `sessions` parameter.

- [ ] **Step 5: Wire the advanced drawer and project sections**

Inside `wireEvents()` add:

```js
DOM.advancedToggleBtn.addEventListener('click', () => {
  state.advancedOpen = !state.advancedOpen;
  DOM.advancedDrawer.classList.toggle('open', state.advancedOpen);
  DOM.settingsScrollContainer.style.display = state.advancedOpen ? 'block' : 'none';
});

DOM.projectSections.querySelectorAll('.project-section-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    state.activeSection = btn.dataset.section || 'inbox';
    DOM.projectSections.querySelectorAll('.project-section-btn').forEach(el =>
      el.classList.toggle('active', el === btn)
    );
    renderProjectShell();
    renderKnowledgeRail();
    renderMessages();
  });
});
```

- [ ] **Step 6: Initialize project state when bridge data arrives**

In `bridge.cwdChanged.connect`, `bridge.sessionsListed.connect`, and initial startup flow, call:

```js
bootProjects();
renderProjectShell();
renderSessions(state.sessions);
renderKnowledgeRail();
```

In `bridge.sessionsListed.connect`, preserve the existing parse but follow it with those render calls. In `bridge.cwdChanged.connect`, call `bootProjects()` before `bridge.listSessions()`.

- [ ] **Step 7: Run focused frontend tests plus app build**

Run:

```bash
cd /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt/bridge
npm test -- tests/frontend/chat-projects.test.ts tests/frontend/chat-records.test.ts

cd /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt/build
cmake --build . --parallel $(sysctl -n hw.ncpu)
```

Expected: helper tests pass and app build still succeeds.

- [ ] **Step 8: Commit**

```bash
git add resources/chat/chat.js
git commit -m "feat(gui): drive workspace shell from project-scoped frontend state"
```

## Task 5: Add the knowledge rail, work-log promotions, and explicit record states

**Files:**
- Modify: `resources/chat/chat.js`
- Modify: `resources/chat/chat.css`

- [ ] **Step 1: Add a work-log aware message action renderer**

Inside `renderMessages()`, keep existing message content rendering, but add project-record actions to assistant and user message cards. Use a helper:

```js
function buildPromoteActions(msg, index) {
  const wrap = document.createElement('div');
  wrap.className = 'record-promote-actions';
  ['decision', 'artifact', 'issue', 'next step'].forEach(type => {
    const btn = document.createElement('button');
    btn.className = 'record-promote-btn';
    btn.textContent = `+ ${type}`;
    btn.addEventListener('click', () => {
      const now = new Date().toISOString();
      const record = {
        id: `${type}:${msg.id || index}:${now}`,
        type,
        title: `${type}: ${(msg.content || '').slice(0, 48) || 'Untitled'}`,
        body: msg.content || '',
        createdAt: now,
        source: buildSourceRef(state.activeSessionId, msg.id || '', msg.role, index),
      };
      state.records = promoteRecord(state.records, record);
      saveRecords(state.activeProjectId, state.records);
      renderKnowledgeRail();
    });
    wrap.appendChild(btn);
  });
  return wrap;
}
```

Append `buildPromoteActions(msg, idx)` to each rendered message card after its content block.

- [ ] **Step 2: Add `renderKnowledgeRail()`**

Before `wireEvents()`, add:

```js
function renderKnowledgeRail() {
  const grouped = groupRecordsByType(state.records);
  DOM.knowledgeRailCount.textContent = `${state.records.length} record${state.records.length === 1 ? '' : 's'}`;
  DOM.knowledgeSuggestions.innerHTML = `
    <div class="knowledge-tip">Promote important chat turns into decisions, artifacts, issues, and next steps.</div>
  `;
  DOM.knowledgeRecords.innerHTML = '';

  Object.entries(grouped).forEach(([type, records]) => {
    const section = document.createElement('section');
    section.className = 'knowledge-record-group';
    section.innerHTML = `<h3>${type}</h3>`;
    records.forEach(record => {
      const card = document.createElement('article');
      card.className = 'knowledge-record-card';
      card.innerHTML = `
        <div class="knowledge-record-title">${escHtml(record.title)}</div>
        <div class="knowledge-record-meta">${record.state} · ${escHtml(record.source.sessionId || 'draft')}</div>
        <div class="knowledge-record-body">${escHtml(record.body)}</div>
      `;
      const stateRow = document.createElement('div');
      stateRow.className = 'knowledge-record-states';
      ['raw', 'reviewed', 'canonical', 'stale'].forEach(nextState => {
        const btn = document.createElement('button');
        btn.className = 'knowledge-state-btn';
        btn.textContent = nextState;
        btn.addEventListener('click', () => {
          state.records = transitionRecordState(state.records, record.id, nextState);
          saveRecords(state.activeProjectId, state.records);
          renderKnowledgeRail();
        });
        stateRow.appendChild(btn);
      });
      card.appendChild(stateRow);
      section.appendChild(card);
    });
    DOM.knowledgeRecords.appendChild(section);
  });
}
```

- [ ] **Step 3: Style record buttons and rail cards**

Append to `chat.css`:

```css
.record-promote-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.record-promote-btn,
.knowledge-state-btn {
  border: 1px solid var(--border);
  background: rgba(255,255,255,0.03);
  color: var(--text-muted);
  border-radius: 999px;
  padding: 4px 8px;
  font-size: 11px;
  cursor: pointer;
}

.knowledge-record-card {
  border: 1px solid var(--border);
  background: rgba(255,255,255,0.025);
  border-radius: 12px;
  padding: 10px;
  margin-bottom: 10px;
}

.knowledge-record-meta {
  font-size: 11px;
  color: var(--text-faint);
  margin: 4px 0 8px;
}
```

- [ ] **Step 4: Verify that knowledge records survive reload**

Manual check:

1. Launch the app.
2. Open a session in the current cwd.
3. Promote one assistant turn to `decision`.
4. Reload the app.
5. Confirm the knowledge rail still shows the promoted record and its state.

Expected: record is restored from `localStorage` for the active project and still links to the originating session ID in the UI.

- [ ] **Step 5: Commit**

```bash
git add resources/chat/chat.js resources/chat/chat.css
git commit -m "feat(gui): add knowledge rail with promoted records and trust states"
```

## Task 6: Full verification, responsive cleanup, and final polish

**Files:**
- Modify: `resources/chat/chat.css`
- Modify: `resources/chat/chat.js`

- [ ] **Step 1: Add mobile/narrow-width fallbacks**

Append to `chat.css`:

```css
@media (max-width: 1180px) {
  #capture-layout {
    grid-template-columns: minmax(0, 1fr);
  }

  #knowledge-rail {
    order: 3;
    border-left: none;
    border-top: 1px solid var(--border);
    max-height: 240px;
  }
}

@media (max-width: 860px) {
  #workspace-rail {
    width: 0;
    padding: 0;
    overflow: hidden;
    border-right: none;
  }
}
```

- [ ] **Step 2: Make sure old toggles still behave safely**

In `chat.js`, guard any old topbar/sidebar-only interactions so they no-op when the old nodes are gone:

```js
if (DOM.sidebarToggle) {
  DOM.sidebarToggle.addEventListener('click', toggleSidebar);
}
if (DOM.viewSelectorBtn) {
  DOM.viewSelectorBtn.addEventListener('click', toggleViewPopup);
}
```

Apply the same pattern anywhere old controls were assumed to be always present.

- [ ] **Step 3: Run the full bridge tests and typecheck**

Run:

```bash
cd /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt/bridge
npm run typecheck
npm test
```

Expected:

- `tsc --noEmit` exits 0
- `vitest run` exits 0, including the new frontend tests

- [ ] **Step 4: Run the app-level build**

Run:

```bash
cd /Volumes/Samsung970EVOPlus/dev-projects/claudian-qt/build
cmake --build . --parallel $(sysctl -n hw.ncpu)
ctest --output-on-failure
```

Expected:

- `ClaudianQt` builds successfully
- `ctest` passes, or any pre-existing unrelated failures are documented before merge

- [ ] **Step 5: Manual UX verification checklist**

Verify:

1. App opens into project-scoped shell rather than a generic session list feel
2. Existing sessions still load and stream normally
3. Search still works
4. Export still works
5. Advanced controls are hidden until `Advanced` is clicked
6. Promoted records persist across reload
7. Narrow-width layout keeps input usable

- [ ] **Step 6: Commit**

```bash
git add resources/chat/chat.css resources/chat/chat.js
git commit -m "fix(gui): finish responsive workspace shell and verification cleanup"
```

## Self-Review

### Spec Coverage

| Spec requirement | Covered by |
|---|---|
| Project becomes primary container | Tasks 1, 3, 4 |
| Inbox / Capture landing | Tasks 3, 4 |
| Left rail / center pane / right rail shell | Tasks 3, 5 |
| Trust via explicit record states | Tasks 2, 5 |
| Navigation from structured record to source | Tasks 2, 5 |
| Advanced controls hidden by default | Tasks 3, 4 |
| Engineer-first phase without leadership dashboard | Scope + all tasks |

### Placeholder Scan

- No TBD/TODO markers remain in the plan
- All created files are named exactly
- Every task contains commands and expected outcomes
- The plan explicitly avoids backend changes for phase 1

### Type Consistency

- Project helpers use `projectId`, `cwd`, `sessions`, and `records` consistently
- Record helpers use `state`, `source`, and `type` consistently
- `chat.js` uses `activeProjectId`, `activeSection`, and `records` consistently

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-30-project-scoped-capture-workspace-phase-1.md`.

Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
