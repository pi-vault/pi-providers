# Phase 4: JSON Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the `hardenToolCalls` stream wrapper with defensive JSON repair for tool-call arguments that the driver fails to parse.

**Architecture:** A new stream wrapper (`hardenToolCalls`) that sits between the base OpenAI driver stream and `cleanStream`. It accumulates raw tool-call argument deltas and, when the driver produces empty arguments (`{}`), attempts a second-chance parse via `parseJsonWithRepair`. The wrapper also patches `done`/`error` terminal events so the final message reflects any repaired tool calls.

**Context:** The upstream driver (`openai-completions`) already uses `parseStreamingJson` → `repairJson` which handles most control-character cases. This wrapper is a **defensive second-chance layer** for edge cases where the driver's parse chain still fails (e.g., `partial-json` library interference, future model output patterns, or complex escape sequences that confuse `repairJson`'s string-boundary tracking).

**Tech Stack:** TypeScript, `@earendil-works/pi-ai` (types, `createAssistantMessageEventStream`, `parseJsonWithRepair`), Vitest

**Spec:** `docs/superpowers/specs/2026-07-06-m3-tool-hardening-design.md`

**Parent plan:** `docs/superpowers/plans/2026-07-06-m3-tool-hardening.md` (Phase 4)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/core/harden-tool-calls.ts` | Create | Stream wrapper with JSON repair |
| `tests/core/harden-tool-calls.test.ts` | Create | Tests for JSON repair behavior |

---

## Design Notes

### Pipeline position

```
MiniMax API → base stream → hardenToolCalls → cleanStream → Pi
```

`hardenToolCalls` runs BEFORE `cleanStream` because it needs to see tool-call events at their original content indices (before `cleanStream` remaps them).

### Terminal event patching

When a tool call is repaired, the `done` event's `message.content` must also reflect the fix. Without this, consumers that read the terminal message directly (rather than replaying individual events) would see stale `{}` arguments.

The wrapper tracks repaired tool calls by content index and patches `done`/`error` messages before forwarding them.

### Error handling pattern

Matches `cleanStream`: if the base stream's async iterator throws, emit an `error` event using whatever output state has accumulated (provider/model metadata when available, generic fallback otherwise).

---

### Task 1: Tests for hardenToolCalls

**Files:**
- Create: `tests/core/harden-tool-calls.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/core/harden-tool-calls.test.ts

import { describe, expect, it } from "vitest";
import type {
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  ToolCall,
} from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { hardenToolCalls } from "../../src/core/harden-tool-calls.ts";

function makePartial(
  content: AssistantMessage["content"] = [],
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "minimax-openai",
    model: "MiniMax-M3",
    usage: {
      input: 100,
      output: 50,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 150,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "toolUse",
    timestamp: Date.now(),
  };
}

async function collectEvents(
  stream: AsyncIterable<AssistantMessageEvent>,
): Promise<AssistantMessageEvent[]> {
  const events: AssistantMessageEvent[] = [];
  for await (const ev of stream) {
    events.push(ev);
  }
  return events;
}

function pushEvents(
  stream: ReturnType<typeof createAssistantMessageEventStream>,
  events: AssistantMessageEvent[],
) {
  for (const ev of events) {
    stream.push(ev);
  }
}

describe("hardenToolCalls", () => {
  describe("JSON repair", () => {
    it("repairs tool args containing raw control characters", async () => {
      const base = createAssistantMessageEventStream();
      const partial = makePartial();
      const brokenToolCall: ToolCall = {
        type: "toolCall",
        id: "tc1",
        name: "edit",
        arguments: {},
      };
      partial.content.push(brokenToolCall);

      // Literal tab (0x09) and newline (0x0a) inside JSON string values
      const rawArgs = `{"path":"/foo.ts","old_string":"if (x) {\treturn 1;\n}"}`;

      pushEvents(base, [
        { type: "start", partial },
        { type: "toolcall_start", contentIndex: 0, partial },
        { type: "toolcall_delta", contentIndex: 0, delta: rawArgs, partial },
        { type: "toolcall_end", contentIndex: 0, toolCall: brokenToolCall, partial },
        { type: "done", reason: "toolUse", message: partial },
      ]);

      const events = await collectEvents(hardenToolCalls(base));
      const toolEnd = events.find((e) => e.type === "toolcall_end");
      expect(toolEnd).toBeDefined();
      if (toolEnd?.type === "toolcall_end") {
        expect(toolEnd.toolCall.arguments).toEqual({
          path: "/foo.ts",
          old_string: "if (x) {\treturn 1;\n}",
        });
      }
    });

    it("patches the done message to reflect repaired tool call", async () => {
      const base = createAssistantMessageEventStream();
      const partial = makePartial();
      const brokenToolCall: ToolCall = {
        type: "toolCall",
        id: "tc1",
        name: "edit",
        arguments: {},
      };
      partial.content.push(brokenToolCall);

      const rawArgs = `{"path":"/bar.ts","content":"line1\nline2"}`;

      pushEvents(base, [
        { type: "start", partial },
        { type: "toolcall_start", contentIndex: 0, partial },
        { type: "toolcall_delta", contentIndex: 0, delta: rawArgs, partial },
        { type: "toolcall_end", contentIndex: 0, toolCall: brokenToolCall, partial },
        { type: "done", reason: "toolUse", message: partial },
      ]);

      const events = await collectEvents(hardenToolCalls(base));
      const done = events.find((e) => e.type === "done");
      expect(done).toBeDefined();
      if (done?.type === "done") {
        const tc = done.message.content[0] as ToolCall;
        expect(tc.arguments).toEqual({ path: "/bar.ts", content: "line1\nline2" });
      }
    });

    it("does not modify already-valid tool args", async () => {
      const base = createAssistantMessageEventStream();
      const partial = makePartial();
      const validToolCall: ToolCall = {
        type: "toolCall",
        id: "tc1",
        name: "read",
        arguments: { path: "/foo.ts" },
      };
      partial.content.push(validToolCall);

      pushEvents(base, [
        { type: "start", partial },
        { type: "toolcall_start", contentIndex: 0, partial },
        { type: "toolcall_delta", contentIndex: 0, delta: '{"path":"/foo.ts"}', partial },
        { type: "toolcall_end", contentIndex: 0, toolCall: validToolCall, partial },
        { type: "done", reason: "toolUse", message: partial },
      ]);

      const events = await collectEvents(hardenToolCalls(base));
      const toolEnd = events.find((e) => e.type === "toolcall_end");
      if (toolEnd?.type === "toolcall_end") {
        expect(toolEnd.toolCall.arguments).toEqual({ path: "/foo.ts" });
      }
    });

    it("falls through gracefully when repair also fails", async () => {
      const base = createAssistantMessageEventStream();
      const partial = makePartial();
      const brokenToolCall: ToolCall = {
        type: "toolCall",
        id: "tc1",
        name: "edit",
        arguments: {},
      };
      partial.content.push(brokenToolCall);

      // Completely unparseable — not valid JSON even after repair
      const rawArgs = "not json at all {{{";

      pushEvents(base, [
        { type: "start", partial },
        { type: "toolcall_start", contentIndex: 0, partial },
        { type: "toolcall_delta", contentIndex: 0, delta: rawArgs, partial },
        { type: "toolcall_end", contentIndex: 0, toolCall: brokenToolCall, partial },
        { type: "done", reason: "toolUse", message: partial },
      ]);

      const events = await collectEvents(hardenToolCalls(base));
      const toolEnd = events.find((e) => e.type === "toolcall_end");
      expect(toolEnd).toBeDefined();
      if (toolEnd?.type === "toolcall_end") {
        // Falls through with original empty args — no crash
        expect(toolEnd.toolCall.arguments).toEqual({});
      }
    });
  });

  describe("event passthrough", () => {
    it("passes non-tool events through unchanged", async () => {
      const base = createAssistantMessageEventStream();
      const partial = makePartial();

      pushEvents(base, [
        { type: "start", partial },
        { type: "done", reason: "stop", message: partial },
      ]);

      const events = await collectEvents(hardenToolCalls(base));
      expect(events[0].type).toBe("start");
      expect(events[1].type).toBe("done");
      expect(events).toHaveLength(2);
    });

    it("stream terminates with done event", async () => {
      const base = createAssistantMessageEventStream();
      const partial = makePartial();
      const toolCall: ToolCall = {
        type: "toolCall",
        id: "tc1",
        name: "read",
        arguments: { path: "/x" },
      };
      partial.content.push(toolCall);

      pushEvents(base, [
        { type: "start", partial },
        { type: "toolcall_start", contentIndex: 0, partial },
        { type: "toolcall_delta", contentIndex: 0, delta: '{"path":"/x"}', partial },
        { type: "toolcall_end", contentIndex: 0, toolCall, partial },
        { type: "done", reason: "toolUse", message: partial },
      ]);

      const events = await collectEvents(hardenToolCalls(base));
      const last = events[events.length - 1];
      expect(last.type).toBe("done");
    });
  });

  describe("error handling", () => {
    it("catches base stream iteration errors and emits error event", async () => {
      const throwingStream = {
        [Symbol.asyncIterator]() {
          return {
            next() {
              return Promise.reject(new Error("upstream crash"));
            },
          };
        },
      } as unknown as AssistantMessageEventStream;

      const events = await collectEvents(hardenToolCalls(throwingStream));
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("error");
      if (events[0].type === "error") {
        expect(events[0].error.errorMessage).toBe("upstream crash");
      }
    });

    it("propagates base stream error events unchanged", async () => {
      const base = createAssistantMessageEventStream();
      const partial = makePartial();

      pushEvents(base, [
        { type: "start", partial },
        {
          type: "error",
          reason: "error",
          error: { ...partial, stopReason: "error", errorMessage: "api timeout" },
        },
      ]);

      const events = await collectEvents(hardenToolCalls(base));
      const errors = events.filter((e) => e.type === "error");
      expect(errors).toHaveLength(1);
      if (errors[0].type === "error") {
        expect(errors[0].error.errorMessage).toBe("api timeout");
      }
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/core/harden-tool-calls.test.ts`
Expected: FAIL (cannot resolve `hardenToolCalls`)

- [ ] **Step 3: Commit failing tests**

```bash
git add tests/core/harden-tool-calls.test.ts
git commit -m "test: add failing tests for hardenToolCalls JSON repair"
```

### Task 2: Implement hardenToolCalls

**Files:**
- Create: `src/core/harden-tool-calls.ts`

- [ ] **Step 1: Write the implementation**

```typescript
// src/core/harden-tool-calls.ts

import type {
  AssistantMessage,
  AssistantMessageEventStream,
  ToolCall,
} from "@earendil-works/pi-ai";
import {
  createAssistantMessageEventStream,
  parseJsonWithRepair,
} from "@earendil-works/pi-ai";

/**
 * Returns true when the parsed arguments object is effectively empty —
 * either `{}` or has zero own-keys.
 */
function isEmptyArgs(args: Record<string, unknown>): boolean {
  return Object.keys(args).length === 0;
}

/**
 * Defensive stream wrapper that accumulates raw tool-call argument deltas
 * and attempts a second-chance JSON parse when the upstream driver produces
 * empty arguments (`{}`).
 *
 * Designed to sit between the base driver stream and cleanStream:
 *   base → hardenToolCalls → cleanStream → Pi
 */
export function hardenToolCalls(
  base: AssistantMessageEventStream,
): AssistantMessageEventStream {
  const out = createAssistantMessageEventStream();

  void (async () => {
    const argDeltas = new Map<number, string>();
    const repairs = new Map<number, ToolCall>();
    let lastPartial: AssistantMessage | undefined;

    try {
      for await (const ev of base) {
        switch (ev.type) {
          case "start": {
            lastPartial = ev.partial;
            out.push(ev);
            break;
          }

          case "toolcall_start": {
            argDeltas.set(ev.contentIndex, "");
            out.push(ev);
            break;
          }

          case "toolcall_delta": {
            const acc = (argDeltas.get(ev.contentIndex) ?? "") + ev.delta;
            argDeltas.set(ev.contentIndex, acc);
            out.push(ev);
            break;
          }

          case "toolcall_end": {
            const toolCall = ev.toolCall;

            if (isEmptyArgs(toolCall.arguments)) {
              const raw = argDeltas.get(ev.contentIndex);
              if (raw) {
                try {
                  const repaired = parseJsonWithRepair<Record<string, unknown>>(raw);
                  if (!isEmptyArgs(repaired)) {
                    const fixed: ToolCall = { ...toolCall, arguments: repaired };
                    repairs.set(ev.contentIndex, fixed);
                    out.push({ ...ev, toolCall: fixed });
                    argDeltas.delete(ev.contentIndex);
                    break;
                  }
                } catch {
                  // Repair also failed — fall through to emit original
                }
              }
            }

            argDeltas.delete(ev.contentIndex);
            out.push(ev);
            break;
          }

          case "done": {
            if (repairs.size > 0) {
              const content = [...ev.message.content];
              for (const [idx, fixed] of repairs) {
                if (idx < content.length) content[idx] = fixed;
              }
              out.push({ ...ev, message: { ...ev.message, content } });
            } else {
              out.push(ev);
            }
            break;
          }

          case "error": {
            if (repairs.size > 0) {
              const content = [...ev.error.content];
              for (const [idx, fixed] of repairs) {
                if (idx < content.length) content[idx] = fixed;
              }
              out.push({ ...ev, error: { ...ev.error, content } });
            } else {
              out.push(ev);
            }
            break;
          }

          default:
            out.push(ev);
        }
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      const fallback: AssistantMessage = lastPartial ?? {
        role: "assistant",
        content: [],
        api: "unknown",
        provider: "unknown",
        model: "unknown",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "error",
        timestamp: Date.now(),
      };
      out.push({
        type: "error",
        reason: "error",
        error: { ...fallback, stopReason: "error", errorMessage },
      });
    }
  })();

  return out;
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `pnpm test -- tests/core/harden-tool-calls.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 3: Run full test suite**

Run: `pnpm test`
Expected: All tests pass (existing + new)

- [ ] **Step 4: Commit**

```bash
git add src/core/harden-tool-calls.ts
git commit -m "feat: implement hardenToolCalls with defensive JSON repair"
```
