# Feature Landscape: Conversation Tracing / Logging

**Domain:** AI conversation capture and tracing for local desktop AI tool
**Researched:** 2026-03-28
**Confidence:** HIGH for table stakes; MEDIUM for differentiators

---

## Context

This research addresses a specific scope: a **local-first, always-on** conversation logger embedded in a desktop Qt6 app. It is NOT a SaaS observability platform (Langfuse, Helicone, Braintrust). The comparison set is:

- Local conversation logs from tools like Claude Code CLI, Cursor, AnythingLLM
- LLM observability platforms (Langfuse, Braintrust) for what fields they capture
- ML fine-tuning dataset formats (OpenAI fine-tune format, ShareGPT, Alpaca) for downstream ML consumption

The goal is a **reliable, zero-friction capture layer** that produces machine-consumable JSONL and human-readable Markdown — not a search UI or analytics dashboard.

---

## Table Stakes

Features users expect from any conversation logging system. Missing any of these breaks the core value proposition.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **One file per session** | Natural unit of conversation; maps to `--resume` session IDs in Claude CLI | Low | Session boundary = new `session_id` from `system/init` |
| **User prompt capture** | The primary input; useless without it | Low | Already flows through `ClaudeBridge::sendMessage` |
| **Assistant response capture** | The primary output | Low | Assembles from `textReady` signals in streaming |
| **Timestamps on every turn** | Ordering, duration calculations, freshness signals for ML | Low | ISO 8601 UTC; both start-of-turn and end-of-turn |
| **Session ID in log** | Links log file to Claude CLI session for `--resume`; required for dataset provenance | Low | From `system/init` message |
| **Model name in log** | Different models produce different quality output; critical for ML pipeline filtering | Low | Already on `ClaudeBridge::m_model` |
| **JSONL output format** | Machine consumption without parsing; line-by-line streaming append; standard for ML pipelines | Low | One JSON object per line; append-only write pattern |
| **Atomic turn capture** | Each user+assistant pair must be complete; partial turns are noise for training data | Medium | Buffer assistant text across `textReady` signals; flush on `turnComplete` |
| **Graceful handling of aborted turns** | User may abort; must mark turn as incomplete rather than silently dropping it | Low | `abort()` path needs to write a partial-turn marker |
| **No message loss on crash** | Logs must survive app crashes mid-session | Medium | Write user prompt immediately; flush assistant on each chunk or `turnComplete` |
| **Token counts per turn** | Cost tracking, context window awareness, ML dataset filtering by token budget | Low | Available in `result` message: `input_tokens`, `output_tokens` |
| **Tool usage metadata** | Tool calls are a first-class part of agentic conversations; omitting them makes logs incomplete | Medium | Tool names + success/fail; from `toolUseStarted` / result signals |
| **Working directory (CWD) in session header** | Contextualizes what project was active; changes session context in ClaudeBridge | Low | Already on `ClaudeBridge::m_cwd` |
| **Configurable log storage path** | Different users have different disk layouts; some want external drives | Low | Default `~/.claudian/logs/`; env var or config override |

---

## Differentiators

Features that add real value beyond baseline capture. Worth building in v1 if complexity is low; defer if high.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Markdown sidecar file** | Human-readable review without JSON tooling; diff-friendly for git-based logs | Low | Write in parallel with JSONL; same session, `.md` extension |
| **Response duration per turn** | Latency tracking; useful for identifying slow queries; quality signal for training data | Low | `QElapsedTimer` from prompt sent to `turnComplete`; add to result object |
| **Total cost USD in session footer** | `total_cost_usd` field available in Claude CLI result messages; nice audit trail | Low | Requires Claude CLI result message parse; already partially done |
| **Turn sequence numbers** | Stable ordering within a session independent of timestamps | Low | Simple counter; prevents ambiguity if timestamps have same millisecond |
| **Session footer / summary record** | Final line in JSONL: total turns, total tokens, duration, end reason | Low | Write on `sessionComplete` or app close; enables O(1) session stats |
| **Stop reason capture** | `end_turn`, `max_tokens`, `tool_use`, `stop_sequence` — distinguishes clean completions from truncations | Low | Available in Claude CLI result messages |
| **Filename includes timestamp + session ID fragment** | Enables chronological sort by filename without parsing contents; unique across machines | Low | e.g. `2026-03-28T143012Z_abc123de.jsonl` |
| **Error turn capture** | API errors, rate limits, network failures during a session — log them as error-type turns | Low | `errorOccurred` signal already exists in `ClaudeProcess` |
| **Configurable log format** | Some users want only JSONL, some only Markdown, some both | Low | Single config flag; build both writers with shared data model |

---

## Anti-Features

Things to deliberately NOT build in v1. These have clear reasons.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Log viewer / browser UI** | Out of scope per PROJECT.md; high complexity for low core value | Use `jq`, `cat`, or external Markdown viewer |
| **Full-text search across sessions** | Requires index, adds read-path complexity, changes the storage model | Use `grep` or `jq` on JSONL files; add in v2 with SQLite index |
| **Cloud sync / remote export** | Privacy risk; complexity with no clear user need for local-first use case | Local files only; user can choose to copy/sync via their own tools |
| **Real-time streaming to external services** | Not needed; adds latency risk to the logging hot path | Write-local only; no webhooks |
| **PII scrubbing / anonymization** | User controls their own local data; adds complexity and false sense of privacy | Document that logs contain raw conversation text; user's responsibility |
| **Per-message encryption** | Overkill for local files in user's home directory | Use OS-level disk encryption if needed |
| **Log rotation with auto-deletion** | Losing historical data defeats the "no messages lost" goal | Warn on high disk usage; let user manage manually |
| **Opt-in toggle** | Per PROJECT.md decision: always-on simplifies implementation; partial capture is worse than full capture | Always-on; document in README |
| **Log compression** | Premature optimization; JSONL files for typical sessions are small (< 1 MB) | Revisit if sessions regularly exceed 10 MB |
| **SQLite storage** | Adds a dependency and query layer; JSONL append-only writes are simpler, crash-safer, and more portable for ML pipelines | JSONL files are the right primitive for this use case |

---

## Feature Dependencies

```
Session ID (from system/init)
  └─> Log filename (requires session ID for uniqueness)
  └─> Session header record (requires session ID)

User prompt captured
  └─> Turn sequence number (increments on each user turn)
  └─> Response duration (starts timer on prompt captured)

Assistant response assembled (all textReady signals)
  └─> Token count (available in result message after assembly)
  └─> Stop reason (available in result message)
  └─> Response duration (ends timer on turnComplete)
  └─> Total cost USD (available in result message)

Tool use metadata
  └─> Requires toolUseStarted signal (already exists)
  └─> Requires tool result/error signals (verify coverage in ClaudeProcess)

JSONL writer (core)
  └─> Session header on init
  └─> Turn record on each turnComplete
  └─> Error record on errorOccurred
  └─> Session footer on session end / app close

Markdown writer (sidecar)
  └─> Depends on JSONL data model (same fields, different serialization)
  └─> Human-readable rendering of tool use blocks
```

---

## MVP Recommendation

**Build these in v1 — all low complexity, directly required by PROJECT.md:**

1. Session header record: `session_id`, `model`, `cwd`, `started_at`
2. Turn record per exchange: `turn_index`, `user_text`, `user_timestamp`, `assistant_text`, `assistant_timestamp`, `response_duration_ms`, `input_tokens`, `output_tokens`, `tools_used[]`, `stop_reason`
3. Error record: `turn_index`, `error_message`, `timestamp`
4. Session footer: `total_turns`, `total_input_tokens`, `total_output_tokens`, `total_cost_usd`, `ended_at`
5. JSONL file writer with append-on-turnComplete pattern
6. Markdown sidecar writer (same data, rendered)
7. Filename format: `YYYY-MM-DDTHHMMSSZ_<session_id_prefix>.jsonl`
8. Configurable base path (default `~/.claudian/logs/`)

**Defer explicitly:**
- Log viewer UI (v2)
- Cross-session search (v2)
- File size warnings (v2)

---

## ML Training Data Compatibility

For downstream fine-tuning compatibility, the JSONL format should be translatable to standard formats. The captured turn records map directly to:

- **OpenAI fine-tune format**: `{"messages": [{"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}]}`
- **ShareGPT format**: `{"conversations": [{"from": "human", "value": "..."}, {"from": "gpt", "value": "..."}]}`

A separate conversion script (not part of v1 scope) can transform ClaudianQt JSONL logs into these formats. The key requirement for conversion compatibility: **store raw text content separately from metadata** — don't embed text inside compound fields.

---

## Sources

- [Langfuse tracing data model](https://langfuse.com/docs/tracing-data-model) — session/trace/observation hierarchy, field conventions
- [Langfuse sessions docs](https://langfuse.com/docs/observability/features/sessions) — multi-turn session grouping patterns
- [Claude Code headless mode / stream-json format](https://code.claude.com/docs/en/headless) — authoritative stream-json field reference: `session_id`, `result`, `usage`, `total_cost_usd`, `stop_reason`, `num_turns`
- [OpenAI fine-tuning data format](https://help.openai.com/en/articles/6811186-how-do-i-format-my-fine-tuning-data-for-the-openai-api) — standard messages array format for ML consumption
- [Unified chat history logging (Medium)](https://medium.com/@mbonsign/unified-chat-history-and-logging-system-a-comprehensive-approach-to-ai-conversation-management-dc3b5d75499f) — hybrid JSON/SQLite patterns, anti-pattern analysis
- [Conversation dataset generator (GitHub)](https://github.com/cahlen/conversation-dataset-generator) — JSONL with rich metadata schema examples
- [Top LLM observability tools 2026 (Confident AI)](https://www.confident-ai.com/knowledge-base/top-7-llm-observability-tools) — Langfuse, Braintrust, Helicone feature comparison
- [AnythingLLM chat logs docs](https://docs.anythingllm.com/features/chat-logs) — desktop AI app local logging precedent
- [NVIDIA NeMo fine-tuning dataset format](https://docs.nvidia.com/nemo/microservices/latest/fine-tune/tutorials/format-training-dataset.html) — tool call capture in training data
