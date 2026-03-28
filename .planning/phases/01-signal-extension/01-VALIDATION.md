---
phase: 1
slug: signal-extension
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-28
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Manual — no automated test infrastructure in this project |
| **Config file** | none |
| **Quick run command** | Build + run: `cmake --build build/ --parallel $(sysctl -n hw.ncpu) && QT_PLUGIN_PATH=/opt/homebrew/Cellar/qtbase/6.11.0/share/qt/plugins ./build/ClaudianQt` |
| **Full suite command** | Same — build + manual smoke test |
| **Estimated runtime** | ~30-60 seconds |

---

## Sampling Rate

- **After every task commit:** Verify the build compiles cleanly
- **After every plan wave:** Build + send a message, confirm `resultReceived` fires in debug output
- **Before `/gsd:verify-work`:** Full manual smoke test per success criteria
- **Max feedback latency:** ~60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 1 | SIG-01 | manual | `cmake --build build/ --parallel $(sysctl -n hw.ncpu) 2>&1 | grep -E "error:|warning:"` | ✅ | ⬜ pending |
| 1-01-02 | 01 | 1 | SIG-02 | manual | `cmake --build build/ --parallel $(sysctl -n hw.ncpu) 2>&1 | grep -E "error:|warning:"` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. No test framework installation needed — project uses manual verification only.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `resultReceived` fires on successful turn | SIG-02 | No test harness; requires running app with live Claude CLI | Add `qDebug() << "resultReceived:" << result;` in ClaudeBridge slot, send a message, confirm output |
| Emitted object contains usage/duration/cost fields | SIG-02 | Requires live subprocess output | Inspect logged QJsonObject for `usage.input_tokens`, `usage.output_tokens`, `duration_ms`, `total_cost_usd` keys |
| Error turns still emit `errorOccurred` only | SIG-01 | Requires triggering an API error | Send malformed/empty message, confirm `errorOccurred` fires and `resultReceived` does NOT |

*All phase behaviors require manual verification due to absence of automated test infrastructure.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
