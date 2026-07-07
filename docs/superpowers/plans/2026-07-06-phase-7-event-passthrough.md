# Phase 7: Event Passthrough Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify that `hardenToolCalls` passes through all non-tool events (thinking, text, error) unchanged when no tool-call repairs are active. This completes the `hardenToolCalls` test coverage.

**Architecture:** Test-only phase. Adds tests to the **existing** `describe("event passthrough")` block in `tests/core/harden-tool-calls.test.ts`. No implementation changes needed:

- `thinking_*` and `text_*` events hit the `default` case which calls `out.push(ev)`.
- `error` events have an explicit case but pass through unchanged when `repairs.size === 0` (no broken tool calls to patch).

**Tech Stack:** TypeScript, `@earendil-works/pi-ai`, Vitest

**Spec:** `docs/superpowers/specs/2026-07-06-m3-tool-hardening-design.md`

**Parent plan:** `docs/superpowers/plans/2026-07-06-m3-tool-hardening.md` (Phase 4)

**Prerequisite:** Phase 6 (Cache Verification) must be complete. `tests/core/harden-tool-calls.test.ts` must exist with the `describe("event passthrough")` block (lines 177-216).

---

## File Map

| File                                   | Action | Responsibility                                                  |
| -------------------------------------- | ------ | --------------------------------------------------------------- |
| `tests/core/harden-tool-calls.test.ts` | Modify | Add tests inside existing `describe("event passthrough")` block |

---

### Task 6: Test — thinking, text, and error events pass through unchanged

**Files:**

- Modify: `tests/core/harden-tool-calls.test.ts`

- [x] **Step 1: Add passthrough tests**

Inserted two `it(...)` blocks inside the existing `describe("event passthrough")` block (after "stream terminates with done event"). Each test verifies the full event type sequence via `events.map(e => e.type)` and the delta content.

Dropped the error passthrough test — already covered by "propagates base stream error events unchanged" in `describe("error handling")`.

- [x] **Step 2: Run tests to verify they pass**

Run: `pnpm test -- tests/core/harden-tool-calls.test.ts`
Result: PASS — 20 tests in file, 63 total

- [x] **Step 3: Commit**

```
7f79336 test: add event passthrough tests for hardenToolCalls
```
