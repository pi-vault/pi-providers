# Phase 7: Event Passthrough Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify that `hardenToolCalls` passes through all non-tool events (thinking, text, error) unchanged. This completes the `hardenToolCalls` module.

**Architecture:** Test-only phase. Adds passthrough verification tests to the existing `hardenToolCalls` test file. No implementation changes needed — the `default` case in the switch already handles passthrough.

**Tech Stack:** TypeScript, `@earendil-works/pi-ai`, Vitest

**Spec:** `docs/superpowers/specs/2026-07-06-m3-tool-hardening-design.md`

**Parent plan:** `docs/superpowers/plans/2026-07-06-m3-tool-hardening.md` (Phase 4)

**Prerequisite:** Phase 4 (JSON Repair) must be complete. `tests/core/harden-tool-calls.test.ts` must exist.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `tests/core/harden-tool-calls.test.ts` | Modify | Add event passthrough tests |

---

### Task 6: Test — non-tool events pass through unchanged

**Files:**
- Modify: `tests/core/harden-tool-calls.test.ts`

- [ ] **Step 1: Add passthrough tests**

Append to the `describe("hardenToolCalls")` block in `tests/core/harden-tool-calls.test.ts`:

```typescript
  describe("event passthrough", () => {
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

    it("passes through error events unchanged", async () => {
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
  });
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `pnpm test -- tests/core/harden-tool-calls.test.ts`
Expected: PASS (all tests — passthrough already works from the `default` case)

- [ ] **Step 3: Commit**

```bash
git add tests/core/harden-tool-calls.test.ts
git commit -m "test: add event passthrough tests for hardenToolCalls"
```
