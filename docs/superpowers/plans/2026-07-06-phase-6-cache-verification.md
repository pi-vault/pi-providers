# Phase 6: Cache Verification Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cache hit/miss logging to `hardenToolCalls` so users can verify MiniMax-M3's passive caching is working.

**Architecture:** Extends `hardenToolCalls` (created in Phase 4) with a `done` event handler that reads `usage.cacheRead` and logs cache hit/miss statistics via `console.error`. Pure logging, no stream modification.

**Tech Stack:** TypeScript, `@earendil-works/pi-ai`, Vitest

**Spec:** `docs/superpowers/specs/2026-07-06-m3-tool-hardening-design.md`

**Parent plan:** `docs/superpowers/plans/2026-07-06-m3-tool-hardening.md` (Phase 3)

**Prerequisite:** Phase 4 (JSON Repair) must be complete. `src/core/harden-tool-calls.ts` and `tests/core/harden-tool-calls.test.ts` must exist.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/core/harden-tool-calls.ts` | Modify | Add `done` event handler with cache logging |
| `tests/core/harden-tool-calls.test.ts` | Modify | Add cache logging tests |

---

### Task 5: Test and implement — cache verification logging

**Files:**
- Modify: `tests/core/harden-tool-calls.test.ts`
- Modify: `src/core/harden-tool-calls.ts`

- [ ] **Step 1: Add cache logging tests**

First, ensure `vi` is imported at the top of `tests/core/harden-tool-calls.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
```

Then append to the `describe("hardenToolCalls")` block:

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

    it("does not log cache miss for small inputs", async () => {
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
  });
```

- [ ] **Step 2: Run tests to verify new ones fail**

Run: `pnpm test -- tests/core/harden-tool-calls.test.ts`
Expected: FAIL on cache logging tests (no `done` handler yet, the `default` case just passes through without logging)

- [ ] **Step 3: Add cache logging to the `done` event handler**

In `src/core/harden-tool-calls.ts`, add a new case for `"done"` in the switch statement (before the `default` case):

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
            out.push(ev);
            break;
          }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/core/harden-tool-calls.test.ts`
Expected: PASS (all tests including the 3 new cache logging tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/harden-tool-calls.ts tests/core/harden-tool-calls.test.ts
git commit -m "feat: add cache verification logging to hardenToolCalls"
```
