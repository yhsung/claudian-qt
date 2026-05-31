# Cross-Project Retrieval Phase 2 Design

**Date:** 2026-05-31
**Status:** Approved

## Goal

Add a trust-first cross-project retrieval layer to ClaudianQt so engineers can find useful prior knowledge across projects without falling back to raw transcript hunting.

Phase 2 should preserve the Phase 1 project-scoped workspace, then add a global retrieval experience that helps users answer:

- where does this knowledge live
- which result is trustworthy
- how do I get from the result to the right working context quickly

## Product Direction

The approved Phase 2 direction is `Trust-Ranked Global Retrieval`.

This means:

- cross-project retrieval becomes a first-class product capability
- engineers can enter retrieval from anywhere through a global search bar
- deeper investigation is available in a dedicated `Explore` view
- results are `mixed` across promoted records and raw sessions
- ranking is intentionally `trust-first`, not neutral or exhaustive
- clicking a result opens a `preview panel` before switching project or transcript context

This phase is not a backend knowledge-store redesign. It is a retrieval and navigation layer built on top of the current frontend-first architecture.

## Core Problem

Phase 1 made project capture and project-local trust legible. It did not solve cross-project retrieval well enough for daily engineering work.

The main failures to solve now are:

1. `I can’t remember where something lives`
2. `I can’t tell which result is most trustworthy`

The user should not need to remember the owning project, the exact session, or the wording used in the original conversation before they can recover useful context.

## User Priority

### Day-1 Primary User

`Engineers`

Phase 2 should optimize for engineers trying to recover prior context while actively working:

- prior decisions
- prior artifacts
- similar implementation discussions
- source conversations
- project ownership context

### Later Consumers

`Directors`, then `GMs`

Later retrieval layers may summarize or roll up this knowledge for broader organizational use, but Phase 2 should not start there. Leadership retrieval built on weak or confusing engineering retrieval will not be trusted.

## Day-1 Product Job

The dominant job for Phase 2 is `Retrieve`.

More specifically:

- help users locate useful knowledge across projects
- rank results so the best answer is obvious
- preserve trust signals from Phase 1
- make transitions into project or source context deliberate and fast

This phase should not try to fully automate richer extraction, semantic indexing, or org-wide rollups yet.

## Retrieval Entry Points

Phase 2 should add two connected entry points that operate over the same retrieval model.

### Global Search Bar

Purpose: quick lookup from anywhere

Requirements:

- visible at the top level of the app
- usable without first selecting the correct project
- returns mixed cross-project results
- supports fast keyboard-first lookup

This is the default entry point for “where did we already decide or discuss this?”

### Explore View

Purpose: deeper investigation across projects

Requirements:

- reachable from the main shell
- uses the same backend-less retrieval layer as global search
- supports broader scanning, filtering, and previewing
- keeps the user oriented across multiple projects and result types

The Explore view is not a separate data model. It is a fuller surface over the same retrieval capabilities.

## Retrieval Sources

Day-1 retrieval should operate over two source families.

### Promoted Records

From project-local record storage introduced in Phase 1:

- decisions
- artifacts
- issues
- open questions
- notes
- ownership signals
- other promoted record types

These are the preferred retrieval targets because they already carry trust state and provenance.

### Raw Sessions

From the existing bridge/session layer:

- session metadata
- transcript text
- message-level hits where available

These remain important fallback evidence, but they should not dominate when a trusted structured answer exists.

## Result Model

The approved retrieval model is `mixed results, trust-labeled, preview-first`.

A single search action should return both:

- `record results`
- `session results`

The UI should present them together, but not blur them into one undifferentiated list.

### Result Grouping

Day-1 results should be grouped into:

1. `Best answers`
2. `Related records`
3. `Raw session hits`

`Best answers` is intentionally opinionated. When a `canonical` or `reviewed` record matches, the app should make that obvious rather than forcing the user to compare it manually against raw logs.

## Trust Model for Retrieval

Retrieval ranking should favor trust over exhaustiveness.

### Ranking Order

Day-1 ranking priority:

1. `canonical` records
2. `reviewed` records
3. other promoted records
4. raw session hits

Within each tier:

1. stronger text match quality ranks higher
2. more recent results break ties

This keeps the behavior legible. Users should be able to understand why a result surfaced near the top.

### Trust Signals in Results

Each result should expose enough context to justify its placement:

- record state
- owning project
- result type
- timestamp
- source session or message reference when present

Phase 2 should not introduce opaque scoring labels or “AI confidence” language.

## Preview-First Navigation

Clicking a cross-project result should open a `preview panel` first.

This is the default destination for both global search and Explore results.

### Preview Panel Contents

Each preview should show:

- title
- snippet or summary
- record state
- owning project
- source session or message reference
- timestamp

And day-1 actions should include:

- `Open source`
- `Open project`
- `Copy link`

Later actions such as `Promote`, `Mark canonical`, or richer editing can be layered on top, but should not define the first release.

### Why Preview First

Preview-first interaction solves two problems:

- it lets users judge trust before leaving their current context
- it prevents jarring project switches when the clicked result turns out not to be the right one

The preview is therefore not optional polish. It is part of the retrieval architecture.

## Information Architecture

Phase 2 extends the Phase 1 shell rather than replacing it.

### Global Layer

New app-level concepts:

- `global search`
- `Explore`
- cross-project preview panel

### Project Layer

Existing project workspaces remain the place where users:

- capture work
- review records
- inspect full transcripts
- continue active execution

Retrieval should help users move between these layers cleanly:

`search anywhere -> inspect preview -> open source or project workspace`

## Frontend Architecture

Phase 2 should stay `frontend-first`, but introduce a clean retrieval boundary so ranking, collection, and rendering do not get tangled inside one large UI file.

### Required Retrieval Units

The implementation should introduce explicit units along these lines:

- `collectRecordResults()`
- `collectSessionResults()`
- `rankResults()`
- `buildResultPreview()`

The exact filenames can follow repo conventions, but the responsibilities should stay separated:

- collection logic gathers candidates
- ranking logic orders them
- preview-building logic produces preview payloads
- rendering code only consumes normalized result data

### Architectural Intent

This boundary is what keeps Phase 2 from becoming dead-end UI glue.

It should make later upgrades possible without redesigning the retrieval UX:

- daemon-backed local index
- richer scoring
- better snippet generation
- cross-project summaries
- director and GM retrieval surfaces

## Normalized Retrieval Result Shape

Even if the implementation is lightweight, the UI should normalize both records and sessions into one result shape before rendering.

That normalized result should be able to represent:

- result id
- result kind (`record` or `session`)
- display title
- snippet
- project id / project name
- trust state
- source references
- timestamp
- raw ranking metadata kept internal if needed

The goal is not schema perfection. The goal is preventing record-specific and session-specific rendering logic from leaking through every UI path.

## Error Handling and Empty States

Cross-project retrieval must remain usable even when the data is sparse or uneven.

### Empty Results

If nothing matches:

- say that clearly
- offer a path back to the current project context
- avoid implying the app searched a richer knowledge source than it actually has

### Partial Trust

If only raw session hits exist:

- still show them
- label them clearly as transcript-derived results
- do not style them as equivalent to reviewed or canonical records

### Missing Provenance

If older data lacks strong source metadata:

- show what is available
- degrade gracefully
- never fabricate precision

## Testing Strategy

Phase 2 should be tested at three levels.

### Retrieval Logic Tests

Add targeted frontend tests for:

- record result collection
- session result collection
- trust-tier ranking
- tie-breaking by match quality and recency
- preview payload generation

### UI Behavior Tests

Add targeted tests for:

- grouped mixed results rendering
- correct labels for `Best answers`, `Related records`, and `Raw session hits`
- preview opening from both record and session results
- navigation actions from preview

### Manual Verification

Verify in the app that:

1. global search is reachable from anywhere
2. Explore shows mixed results across multiple projects
3. canonical records outrank raw session hits for the same topic
4. preview opens before project/context switching
5. `Open source` and `Open project` land in the expected place

## Non-Goals

Phase 2 should explicitly avoid:

- backend knowledge-store redesign
- semantic/vector retrieval infrastructure
- automatic leadership rollups
- complex permissions or sharing layers
- cross-project editing workflows beyond preview and navigation

## Future Phases Enabled

If Phase 2 is implemented with the right boundaries, it should enable later work such as:

- lightweight local indexing in the daemon
- stronger snippet and match explanations
- saved searches or explore views
- retrieval-driven promotion workflows
- director blocker/owner views
- GM strategic rollups

## Summary

Phase 2 should ship a trust-ranked, mixed, cross-project retrieval experience that is fast to enter, explicit about trust, and careful about navigation.

The day-1 product should feel like:

- one obvious place to search
- one clear explanation of which result is best
- one deliberate preview step before context switching

That is the next meaningful layer of the organizational brain after project-scoped capture.
