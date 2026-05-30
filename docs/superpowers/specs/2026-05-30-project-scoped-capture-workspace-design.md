# Project-Scoped Capture Workspace Design

**Date:** 2026-05-30
**Status:** Approved

## Goal

Redesign ClaudianQt from a power-user chat console into an engineer-first organizational brain. The day-1 product should make it easy to capture mixed operational work inside a project, trust what was captured, and navigate from structured knowledge back to its exact source.

## Product Direction

The approved direction is a `Project-Scoped Capture Workspace`.

This means:

- The primary organizing unit becomes the `project`, not the session
- The default landing experience becomes `Inbox / Capture`
- The first release optimizes for `engineers`, with `directors` and `GMs` consuming the same data through thinner roll-up views later
- The app is designed around `mixed operational records`, not polished standalone documents
- Trust and navigation are treated as one information-architecture problem

The current GUI exposes too many operator controls in the main workflow. The redesign preserves advanced capability, but moves it behind an `Advanced` layer so the default experience feels operational and durable instead of experimental.

## Core Problem

The current app is session-centric and chat-centric:

- sessions are the top-level navigation unit
- knowledge lives mostly inside raw transcripts
- advanced controls sit directly in the primary workflow
- users must infer what is important, final, and reusable

That creates two failures for the intended organizational-brain use case:

1. `Low trust`: users cannot quickly tell what is canonical, reviewed, or worth reusing
2. `Poor navigation`: users cannot easily move across sessions, decisions, artifacts, and follow-up work within a project

The redesign must solve both failures together by changing the information model, not by restyling the current chat layout.

## User Priority

### Day-1 Primary User

`Engineers`

The first release should help engineers capture project work as it happens:

- prompts
- outputs
- files
- links
- decisions
- issues
- next steps
- ownership

### Later Consumers

`Directors`, then `GMs`

These users should consume roll-up views built from the same trusted project records. They should not drive the initial information architecture. Leadership views built on weak capture will not be trusted.

## Day-1 Product Jobs

The product’s long-term job is a mix of:

- `Capture`
- `Retrieve`
- `Synthesize`
- `Operate`

For day 1, the dominant starting point is `Capture`.

That means the redesign should prioritize:

- fast ingestion of mixed operational work
- immediate structuring of important records
- strong provenance on every structured record
- easy movement from structured record back to originating context

Retrieval, synthesis, and operational roll-up should be enabled by this structure, not forced into the first release as separate top-level experiences.

## Information Architecture

### Primary Container

The top-level unit is the `project`.

Each project contains:

- capture inbox
- work log
- decisions
- artifacts
- open questions
- people / owners
- linked sessions

Sessions remain important, but they are subordinate to the project. A session is one source of project knowledge, not the main object the app is built around.

### Primary Navigation

Day-1 project navigation should be:

- `Inbox`
- `Work Log`
- `Decisions`
- `Artifacts`
- `Open Questions`
- `People`

This is intentionally not a generic chat sidebar. It is a project knowledge structure with capture at the center.

### Landing Experience

The app should open into `Inbox / Capture`.

This gives users a fast place to drop new work while still anchoring that work inside the active project. The landing experience should answer:

- what needs to be captured now
- what was just captured
- what has not yet been structured or reviewed

It should not open into a leadership dashboard or a raw session list.

## Workspace Layout

The main project workspace should stabilize around three persistent zones.

### Left Rail

Purpose: navigation and project orientation

Contains:

- project switcher
- project sections
- saved views or filters
- lightweight status markers

The left rail replaces the current session-first sidebar.

### Center Pane

Purpose: active capture and working record

Contains:

- fast capture composer
- active session thread
- mixed operational log
- inline markers for extracted items

The center pane is where users work. It should support raw capture without demanding too much structure up front.

### Right Rail

Purpose: structure, provenance, and promotion

Contains:

- extracted knowledge suggestions
- source metadata
- linked files and related records
- actions such as:
  - promote to decision
  - mark canonical
  - assign owner
  - create open question
  - attach artifact

The right rail is what turns a transcript into an organizational brain. It should make the status and reusability of knowledge explicit.

## Capture Model

The center of the redesign is `capture first, structure immediately after`.

Day-1 capture should handle a mixed operational record, including:

- prompt text
- assistant output
- tool output
- attached files
- links
- notes
- experiments
- failures
- decisions
- next steps

The desired user flow is:

1. The user drops in a prompt, note, file, link, or result
2. The app records it in the project work log with time and source
3. The app suggests structured extractions in the right rail
4. The user accepts, edits, or ignores those suggestions
5. Accepted items become reusable project records linked back to the exact origin

This flow preserves speed while building durable structure.

## Structured Record Types

Day-1 structured records should include:

- `decision`
- `artifact`
- `issue`
- `open question`
- `next step`
- `note`
- `link`
- `owner`
- `status change`

Not every record type needs a complex editor in the first release. What matters is that the system can identify and persist these units distinctly rather than burying everything in message bubbles.

## Trust Model

Trust depends on provenance and explicit record state.

Every important record should show:

- where it came from
- which project it belongs to
- the originating session or turn
- who edited or promoted it
- whether it is still draft or considered canonical

### Record States

Day-1 records should support explicit states such as:

- `raw`
- `extracted`
- `reviewed`
- `canonical`
- `stale`

These states are more important than decorative polish. Without them, the app remains a transcript browser with nicer visuals.

## Navigation Model

Navigation must work in both directions:

- from raw work log to structured record
- from structured record back to exact source

Users should be able to move quickly between:

- a decision and the conversation that produced it
- an artifact and the files or outputs linked to it
- an open question and the unresolved discussion around it
- a status change and the work that triggered it

The redesign should therefore treat source links and related-record links as first-class UI elements, not secondary metadata.

## Role Layering

The app should support multiple organizational roles from one shared knowledge base, but not by launching three separate products.

### Engineer View

Default emphasis:

- fast capture
- linked artifacts
- source traceability
- project work log
- structured extraction

### Director View

Later emphasis:

- decision timeline
- open questions
- cross-team blockers
- owner/status views
- recent project movement

### GM View

Later emphasis:

- project health
- major decisions
- strategic risks
- execution summaries
- memory across projects

The product rule is:

build the engineer workspace first, then layer director and GM views on top of stronger underlying records.

## Advanced Controls Strategy

The app already contains advanced controls such as:

- model selection
- permission mode
- tool allow/block lists
- MCP server setup
- custom agents
- run budgets and effort

These should remain available, but move out of the primary workflow.

Recommended day-1 behavior:

- hide advanced controls by default
- expose them through an `Advanced` drawer, project settings, or admin surface
- keep the primary capture path clean and legible

The product should feel like a project workspace first and an operator console second.

## UX Principles

### 1. Project Before Session

Users should feel that they are working inside a project memory system, not browsing independent chat logs.

### 2. Capture Before Curation

The app should allow messy real-world input first, then help structure it immediately after.

### 3. Provenance Before Summary

Summaries and roll-ups are useful only when users can inspect their source and trust their status.

### 4. Structure Without Friction

The app should not require users to fill out forms before doing work. Structure should emerge through suggestion, promotion, and review.

### 5. Hide Operator Complexity

Advanced AI/runtime controls should not dominate the UI for ordinary project capture.

## Out of Scope for Day 1

The redesign should not try to deliver all future organizational-brain features at once.

Out of scope for the initial overhaul:

- full GM dashboard
- multi-project executive reporting
- complex role-specific permission systems
- heavy workflow automation
- a total rewrite of underlying bridge/daemon architecture unless required by the new IA

The first release succeeds if it creates a trustworthy project-scoped capture workspace that can later support retrieval, synthesis, and leadership views.

## Impact on Current UI

The current UI likely needs these conceptual changes:

- sidebar changes from session list to project navigation
- topbar changes from utility strip to project context and search
- main center area changes from pure chat transcript to project work log plus capture
- right-side knowledge rail becomes a first-class surface
- advanced runtime controls move out of the always-visible input toolbar

The result should feel less like a generic AI chat app and more like a project memory cockpit.

## Success Criteria

The GUI overhaul is successful when:

- an engineer can capture mixed project work without friction
- important records become structured without losing source context
- users can tell what is draft, reviewed, or canonical
- users can navigate from record to source and back quickly
- advanced controls no longer dominate the main workflow
- the system creates a clean path for later director and GM roll-up views

## Implementation Shape

This design implies a multi-phase implementation, likely including:

- information-architecture changes in the web UI
- new project and record concepts in the frontend model
- session-to-project association changes
- structured extraction and record-state UX
- search and linking changes
- relocation of advanced controls

The implementation plan should decompose these into staged tasks, but the product design should remain anchored to one principle:

`make project knowledge trustworthy and navigable while preserving fast capture`
