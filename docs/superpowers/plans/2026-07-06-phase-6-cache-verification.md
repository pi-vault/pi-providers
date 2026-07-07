# Phase 6: Cache Verification Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cache hit/miss logging to `hardenToolCalls` so users can verify MiniMax-M3's passive caching is working.

**Architecture:** Extends the existing `done` case in `hardenToolCalls` (created in Phase 4) with cache-hit/miss logging that reads `ev.message.usage` and logs via `console.error`. Pure logging — no stream modification beyond what Phase 4 already does (content patching for repairs).

**Tech Stack:** TypeScript, `@earendil-works/pi-ai`, Vitest

**Spec:** `docs/superpowers/specs/2026-07-06-m3-tool-hardening-design.md`

**Parent plan:** `docs/superpowers/plans/2026-07-06-m3-tool-hardening.md` (Phase 3)

**Prerequisite:** Phase 5 (Collapsed-Arg Detection) must be complete. `src/core/harden-tool-calls.ts` must contain the `done` case with content-patching logic from Phase 4.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/core/harden-tool-calls.ts` | Modify | Add cache logging to existing `done` case |
| `tests/core/harden-tool-calls.test.ts` | Modify | Add cache logging tests |

---

## Context: Existing `done` case (Phase 4)

The `done` case already handles patching repaired tool call content:

```typescript
case "done": {
  if (repairs.size === 0) { out.push(ev); break; }
  const content = ev.message.content.map((c, i) => repairs.get(i) ?? c);
  out.push({ ...ev, message: { ...ev.message, content } });
  break;
}
```

Cache logging must be merged INTO this case, not added as a separate case.

---

### Task 5: Test and implement — cache verification logging

**Files:**
- Modify: `tests/core/harden-tool-calls.test.ts`
- Modify: `src/core/harden-tool-calls.ts`

- [ ] **Step 1: Add cache logging tests**

First, add `vi` to the vitest import at the top of `tests/core/harden-tool-calls.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
```

Then append a new `describe("cache verification logging")` block inside the top-level `describe("hardenToolCalls")`, after the `"collapsed-arg detection"` block:

```typescript
  describe("cache verification logging", () => {
    it("logs cache hit when cacheRead > 0", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const base = createAssistantMessageEventStream();
      const partial = makePartial();
      partial.usage.cacheRead = 5000;
      partial.usage.input = 10000;

      pushEvents(base, [
        { type: "start", partial },
        { type: "done", reason: "stop", message: partial },
      ]);

      await collectEvents(hardenToolCalls(base));

      const logCalls = spy.mock.calls.map((c) => c.join(" "));
      expect(
        logCalls.some((l) => l.includes("cache hit") && l.includes("5000")),
      ).toBe(true);
      spy.mockRestore();
    });

    it("logs cache miss when cacheRead is 0 and input > 1000", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const base = createAssistantMessageEventStream();
      const partial = makePartial();
      partial.usage.cacheRead = 0;
      partial.usage.input = 5000;

      pushEvents(base, [
        { type: "start", partial },
        { type: "done", reason: "stop", message: partial },
      ]);

      await collectEvents(hardenToolCalls(base));

      const logCalls = spy.mock.calls.map((c) => c.join(" "));
      expect(
        logCalls.some((l) => l.includes("cache miss") && l.includes("5000")),
      ).toBe(true);
      spy.mockRestore();
    });

    it("does not log cache info for small inputs without cache", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const base = createAssistantMessageEventStream();
      const partial = makePartial();
      partial.usage.cacheRead = 0;
      partial.usage.input = 500;

      pushEvents(base, [
        { type: "start", partial },
        { type: "done", reason: "stop", message: partial },
      ]);

      await collectEvents(hardenToolCalls(base));

      const logCalls = spy.mock.calls.map((c) => c.join(" "));
      expect(logCalls.some((l) => l.includes("cache"))).toBe(false);
      spy.mockRestore();
    });

    it("logs cache info even when repairs exist", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const base = createAssistantMessageEventStream();
      const partial = makePartial();
      partial.usage.cacheRead = 8000;
      partial.usage.input = 2000;
      const brokenToolCall: ToolCall = {
        type: "toolCall",
        id: "tc1",
        name: "edit",
        arguments: {},
      };
      partial.content.push(brokenToolCall);

      const rawArgs = '{"path":"/foo.ts","content":"hello"}';

      pushEvents(base, [
        { type: "start", partial },
        { type: "toolcall_start", contentIndex: 0, partial },
        { type: "toolcall_delta", contentIndex: 0, delta: rawArgs, partial },
        { type: "toolcall_end", contentIndex: 0, toolCall: brokenToolCall, partial },
        { type: "done", reason: "toolUse", message: partial },
      ]);

      await collectEvents(hardenToolCalls(base));

      const logCalls = spy.mock.calls.map((c) => c.join(" "));
      expect(
        logCalls.some((l) => l.includes("cache hit") && l.includes("8000")),
      ).toBe(true);
      spy.mockRestore();
    });
  });
```

- [ ] **Step 2: Run tests to verify new ones fail**

Run: `pnpm test -- tests/core/harden-tool-calls.test.ts`
Expected: FAIL on all 4 cache logging tests (existing `done` case doesn't log anything).

- [ ] **Step 3: Add cache logging to the existing `done` case**

In `src/core/harden-tool-calls.ts`, replace the existing `done` case (lines 142-147) with:

```typescript
          case "done": {
            const { usage } = ev.message;
            if (usage.cacheRead > 0) {
              console.error(
                `[minimax-openai] cache hit: ${usage.cacheRead} tokens cached`,
              );
            } else if (usage.input > 1000) {
              console.error(
                `[minimax-openai] cache miss: ${usage.input} input tokens, 0 cached`,
              );
            }
            if (repairs.size === 0) { out.push(ev); break; }
            const content = ev.message.content.map((c, i) => repairs.get(i) ?? c);
            out.push({ ...ev, message: { ...ev.message, content } });
            break;
          }
```

Key: cache logging runs FIRST (reads `ev.message.usage` which is unaffected by content patching), then the existing content-patching logic follows.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/core/harden-tool-calls.test.ts`
Expected: ALL tests pass — new cache logging tests AND existing Phase 4/5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/harden-tool-calls.ts tests/core/harden-tool-calls.test.ts
git commit -m "feat: add cache verification logging to hardenToolCalls"
```
