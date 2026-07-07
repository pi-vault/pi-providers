# Phase 4: JSON Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the `hardenToolCalls` stream wrapper with JSON repair that fixes control-character-induced `{}` tool argument crashes.

**Architecture:** A new async generator stream wrapper (`hardenToolCalls`) that sits between the base OpenAI driver stream and `cleanStream`. It accumulates raw tool-call argument deltas and, when the driver produces empty arguments, attempts repair using `parseJsonWithRepair` which escapes raw control characters before parsing.

**Tech Stack:** TypeScript, `@earendil-works/pi-ai` (types, `createAssistantMessageEventStream`, `parseJsonWithRepair`), Vitest

**Spec:** `docs/superpowers/specs/2026-07-06-m3-tool-hardening-design.md`

**Parent plan:** `docs/superpowers/plans/2026-07-06-m3-tool-hardening.md` (Phase 1)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/core/harden-tool-calls.ts` | Create | Stream wrapper with JSON repair |
| `tests/core/harden-tool-calls.test.ts` | Create | Tests for JSON repair behavior |

---

### Task 1: Test — JSON repair fixes control-character crashes

**Files:**
- Create: `tests/core/harden-tool-calls.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/core/harden-tool-calls.test.ts

import { describe, expect, it } from "vitest";
import type {
  AssistantMessage,
  AssistantMessageEvent,
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
      // Simulate driver producing empty args due to JSON.parse crash
      const brokenToolCall: ToolCall = {
        type: "toolCall",
        id: "tc1",
        name: "edit",
        arguments: {},
      };
      partial.content.push(brokenToolCall);

      // Build a delta with ACTUAL control characters (0x09=tab, 0x0a=newline)
      // inside a JSON string value — this is invalid JSON that crashes JSON.parse
      const rawArgs = `{"path":"/foo.ts","old_string":"if (x) {\treturn 1;\n}"}`;

      pushEvents(base, [
        { type: "start", partial },
        { type: "toolcall_start", contentIndex: 0, partial },
        { type: "toolcall_delta", contentIndex: 0, delta: rawArgs, partial },
        {
          type: "toolcall_end",
          contentIndex: 0,
          toolCall: brokenToolCall,
          partial,
        },
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
        {
          type: "toolcall_delta",
          contentIndex: 0,
          delta: '{"path":"/foo.ts"}',
          partial,
        },
        {
          type: "toolcall_end",
          contentIndex: 0,
          toolCall: validToolCall,
          partial,
        },
        { type: "done", reason: "toolUse", message: partial },
      ]);

      const events = await collectEvents(hardenToolCalls(base));
      const toolEnd = events.find((e) => e.type === "toolcall_end");
      if (toolEnd?.type === "toolcall_end") {
        expect(toolEnd.toolCall.arguments).toEqual({ path: "/foo.ts" });
      }
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/core/harden-tool-calls.test.ts`
Expected: FAIL with "Cannot find module" or "hardenToolCalls is not a function"

- [ ] **Step 3: Commit failing tests**

```bash
git add tests/core/harden-tool-calls.test.ts
git commit -m "test: add failing tests for hardenToolCalls JSON repair"
```

### Task 2: Implement — JSON repair in `hardenToolCalls`

**Files:**
- Create: `src/core/harden-tool-calls.ts`

- [ ] **Step 1: Write the implementation**

```typescript
// src/core/harden-tool-calls.ts

import type {
  AssistantMessage,
  AssistantMessageEvent,
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

export function hardenToolCalls(
  base: AssistantMessageEventStream,
): AssistantMessageEventStream {
  const out = createAssistantMessageEventStream();

  void (async () => {
    const argDeltas = new Map<number, string>();

    try {
      for await (const ev of base) {
        switch (ev.type) {
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

            // Attempt repair if driver produced empty args
            if (isEmptyArgs(toolCall.arguments)) {
              const raw = argDeltas.get(ev.contentIndex);
              if (raw) {
                try {
                  const repaired =
                    parseJsonWithRepair<Record<string, unknown>>(raw);
                  if (!isEmptyArgs(repaired)) {
                    const fixed: ToolCall = {
                      ...toolCall,
                      arguments: repaired,
                    };
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

          default:
            out.push(ev);
        }
      }
    } catch (e) {
      out.push({
        type: "error",
        reason: "error",
        error: {
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
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          },
          stopReason: "error",
          errorMessage: e instanceof Error ? e.message : String(e),
          timestamp: Date.now(),
        } as AssistantMessage,
      });
    }
  })();

  return out;
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `pnpm test -- tests/core/harden-tool-calls.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 3: Commit**

```bash
git add src/core/harden-tool-calls.ts
git commit -m "feat: implement hardenToolCalls with JSON repair"
```
