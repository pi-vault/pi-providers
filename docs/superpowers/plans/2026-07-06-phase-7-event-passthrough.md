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

- [ ] **Step 1: Add passthrough tests**

Insert the following three `it(...)` blocks **inside** the existing `describe("event passthrough", () => { ... })` block (after the "stream terminates with done event" test, before the closing `});` of that describe):

```typescript
it("passes through thinking events unchanged", async () => {
  const base = createAssistantMessageEventStream();
  const partial = makePartial();

  pushEvents(base, [
    { type: "start", partial },
    { type: "thinking_start", contentIndex: 0, partial },
    { type: "thinking_delta", contentIndex: 0, delta: "reasoning", partial },
    { type: "thinking_end", contentIndex: 0, content: "reasoning", partial },
    { type: "done", reason: "stop", message: partial },
  ]);

  const events = await collectEvents(hardenToolCalls(base));
  const thinkDeltas = events
    .filter((e) => e.type === "thinking_delta")
    .map((e) => (e.type === "thinking_delta" ? e.delta : ""));
  expect(thinkDeltas).toEqual(["reasoning"]);
});

it("passes through text events unchanged", async () => {
  const base = createAssistantMessageEventStream();
  const partial = makePartial();

  pushEvents(base, [
    { type: "start", partial },
    { type: "text_start", contentIndex: 0, partial },
    { type: "text_delta", contentIndex: 0, delta: "hello", partial },
    { type: "text_end", contentIndex: 0, content: "hello", partial },
    { type: "done", reason: "stop", message: partial },
  ]);

  const events = await collectEvents(hardenToolCalls(base));
  const textDeltas = events
    .filter((e) => e.type === "text_delta")
    .map((e) => (e.type === "text_delta" ? e.delta : ""));
  expect(textDeltas).toEqual(["hello"]);
});

it("passes through error events unchanged when no repairs active", async () => {
  const base = createAssistantMessageEventStream();
  const partial = makePartial();

  pushEvents(base, [
    { type: "start", partial },
    {
      type: "error",
      reason: "error",
      error: {
        ...partial,
        stopReason: "error",
        errorMessage: "upstream fail",
      },
    },
  ]);

  const events = await collectEvents(hardenToolCalls(base));
  const errors = events.filter((e) => e.type === "error");
  expect(errors.length).toBe(1);
  if (errors[0].type === "error") {
    expect(errors[0].error.errorMessage).toBe("upstream fail");
  }
});
```

**Insertion point:** line 215 of the current file (after the closing `});` of "stream terminates with done event" test, before line 216 `});` that closes the describe block).

- [ ] **Step 2: Run tests to verify they pass**

Run: `pnpm test -- tests/core/harden-tool-calls.test.ts`
Expected: PASS (all existing + new tests)

- [ ] **Step 3: Commit**

```bash
git add tests/core/harden-tool-calls.test.ts
git commit -m "test: add event passthrough tests for hardenToolCalls"
```
