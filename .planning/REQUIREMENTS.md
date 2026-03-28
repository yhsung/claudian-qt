# Requirements: ClaudianQt Conversation Tracing

**Defined:** 2026-03-28
**Core Value:** Every conversation is reliably captured with complete context — no messages lost, no metadata missing — so logs can be used as training data and for usage analysis without manual intervention.

## v1 Requirements

### Signal Extension

- [x] **SIG-01**: System parses the full `result` message from Claude CLI subprocess (currently only `is_error` is read; `usage`, `duration_ms`, `total_cost_usd`, `stop_reason` are discarded)
- [x] **SIG-02**: System emits a `resultReceived(QJsonObject)` signal from `ClaudeProcess` when a successful `result` message is parsed

### Capture

- [ ] **CAP-01**: System captures every user prompt with ISO-8601 timestamp
- [ ] **CAP-02**: System captures the complete assembled assistant response with ISO-8601 timestamp
- [ ] **CAP-03**: System captures token counts per turn (input_tokens + output_tokens) from the `result` message
- [ ] **CAP-04**: System captures response duration per turn (duration_ms) from the `result` message

### Metadata

- [ ] **META-01**: Each log file header includes session ID, model name, and CWD from ClaudeBridge properties
- [ ] **META-02**: System captures tool usage per turn — tool names and success/fail status
- [ ] **META-03**: System captures stop reason per turn (end_turn, max_tokens, tool_use) from the `result` message
- [ ] **META-04**: System captures cost per turn (total_cost_usd) from the `result` message

### Output Format

- [ ] **FMT-01**: Each session produces a JSONL file — one JSON object per completed turn, appended on turn completion
- [ ] **FMT-02**: Each session produces a companion Markdown file — human-readable conversation with metadata headers
- [ ] **FMT-03**: JSONL and Markdown files are written from a single shared Turn data model (no format divergence)
- [ ] **FMT-04**: Aborted/killed turns are logged as incomplete records with partial metadata rather than silently dropped

### Storage

- [ ] **STOR-01**: Log files are stored at `~/.claudian/logs/` by default
- [ ] **STOR-02**: Log storage path can be overridden via `CLAUDIAN_LOG_DIR` environment variable
- [ ] **STOR-03**: Log directory is created automatically on first use if it does not exist
- [ ] **STOR-04**: Each session produces a unique log file named by session ID and timestamp (e.g., `session-<id>-<date>.jsonl`)

## v2 Requirements

### Viewer

- **VIEW-01**: User can browse past conversation logs from within ClaudianQt
- **VIEW-02**: User can search logs by text content
- **VIEW-03**: User can filter logs by date, model, or session

### Export

- **EXP-01**: User can export logs in OpenAI fine-tuning format (prompt/completion pairs)
- **EXP-02**: User can export logs in ShareGPT format
- **EXP-03**: User can export a filtered subset of logs

### Management

- **MGMT-01**: User can configure log retention period
- **MGMT-02**: System warns when log directory exceeds a configurable size threshold
- **MGMT-03**: User can delete individual session logs from within the app

## Out of Scope

| Feature | Reason |
|---------|--------|
| Log viewer UI | Deferred to v2 — external tools sufficient for v1 |
| Cloud sync / remote export | Privacy concerns; local-first is intentional |
| PII scrubbing / anonymization | User controls their own local data |
| SQLite or database storage | Flat files are simpler and directly usable |
| Opt-in toggle | Always-on is a design requirement |
| Per-message encryption | Out of scope for v1 — OS-level encryption available |
| Log compression | Adds complexity; disk space not a concern at conversation scale |
| Configurable log path via GUI | Env var is sufficient for v1; GUI settings deferred |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SIG-01 | Phase 1 | Complete |
| SIG-02 | Phase 1 | Complete |
| CAP-01 | Phase 2 | Pending |
| CAP-02 | Phase 2 | Pending |
| CAP-03 | Phase 2 | Pending |
| CAP-04 | Phase 2 | Pending |
| META-01 | Phase 2 | Pending |
| META-02 | Phase 2 | Pending |
| META-03 | Phase 2 | Pending |
| META-04 | Phase 2 | Pending |
| FMT-01 | Phase 2 | Pending |
| FMT-02 | Phase 3 | Pending |
| FMT-03 | Phase 2 | Pending |
| FMT-04 | Phase 2 | Pending |
| STOR-01 | Phase 2 | Pending |
| STOR-02 | Phase 2 | Pending |
| STOR-03 | Phase 2 | Pending |
| STOR-04 | Phase 2 | Pending |

**Coverage:**
- v1 requirements: 18 total
- Mapped to phases: 18
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-28*
*Last updated: 2026-03-28 after roadmap creation*
