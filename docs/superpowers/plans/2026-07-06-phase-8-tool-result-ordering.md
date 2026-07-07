# Phase 8: Tool Result Ordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the `normalizeToolResults` pre-request function that reorders tool result messages to match the order of tool calls in the preceding assistant message, preventing MiniMax 400 errors on parallel tool calls.

**Architecture:** A pure function that takes a Pi `Context` object and returns a new one with tool results reordered. Walks messages, finds assistant turns with multiple tool calls, and reorders the subsequent tool result messages to match. Does not mutate the input.

**Tech Stack:** TypeScript, `@earendil-works/pi-ai` (types), Vitest

**Spec:** `docs/superpowers/specs/2026-07-06-m3-tool-hardening-design.md`

**Parent plan:** `docs/superpowers/plans/2026-07-06-m3-tool-hardening.md` (Phase 5)

**Prerequisite:** None — this module is independent of `hardenToolCalls`.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/core/normalize-tool-results.ts` | Create | Reorder tool results to match tool_use order |
| `tests/core/normalize-tool-results.test.ts` | Create | Tests for tool result reordering |

---

### Task 7: Test — tool results are reordered to match tool_use order

**Files:**
- Create: `tests/core/normalize-tool-results.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/core/normalize-tool-results.test.ts

import { describe, expect, it } from "vitest";
import type {
  AssistantMessage,
  Context,
  ToolCall,
  ToolResultMessage,
  UserMessage,
} from "@earendil-works/pi-ai";
import { normalizeToolResults } from "../../src/core/normalize-tool-results.ts";

function makeAssistant(toolCalls: ToolCall[]): AssistantMessage {
  return {
    role: "assistant",
    content: toolCalls,
    api: "openai-completions",
    provider: "minimax-openai",
    model: "MiniMax-M3",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "toolUse",
    timestamp: Date.now(),
  };
}

function makeToolCall(id: string, name: string): ToolCall {
  return { type: "toolCall", id, name, arguments: {} };
}

function makeToolResult(
  toolCallId: string,
  toolName: string,
): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId,
    toolName,
    content: [{ type: "text", text: `result for ${toolCallId}` }],
    isError: false,
    timestamp: Date.now(),
  };
}

function makeUser(text: string): UserMessage {
  return { role: "user", content: text, timestamp: Date.now() };
}

describe("normalizeToolResults", () => {
  it("reorders out-of-order tool results to match tool_use order", () => {
    const assistant = makeAssistant([
      makeToolCall("tc_a", "read"),
      makeToolCall("tc_b", "bash"),
      makeToolCall("tc_c", "grep"),
    ]);

    const ctx: Context = {
      messages: [
        makeUser("do things"),
        assistant,
        // Results arrive out of order: C, A, B
        makeToolResult("tc_c", "grep"),
        makeToolResult("tc_a", "read"),
        makeToolResult("tc_b", "bash"),
      ],
    };

    const result = normalizeToolResults(ctx);
    const results = result.messages.filter(
      (m): m is ToolResultMessage => m.role === "toolResult",
    );

    expect(results.map((r) => r.toolCallId)).toEqual(["tc_a", "tc_b", "tc_c"]);
  });

  it("does not modify already-ordered results", () => {
    const assistant = makeAssistant([
      makeToolCall("tc_a", "read"),
      makeToolCall("tc_b", "bash"),
    ]);

    const ctx: Context = {
      messages: [
        makeUser("do things"),
        assistant,
        makeToolResult("tc_a", "read"),
        makeToolResult("tc_b", "bash"),
      ],
    };

    const result = normalizeToolResults(ctx);
    const results = result.messages.filter(
      (m): m is ToolResultMessage => m.role === "toolResult",
    );

    expect(results.map((r) => r.toolCallId)).toEqual(["tc_a", "tc_b"]);
  });

  it("passes through single tool call turns unchanged", () => {
    const assistant = makeAssistant([makeToolCall("tc_a", "read")]);

    const ctx: Context = {
      messages: [
        makeUser("read something"),
        assistant,
        makeToolResult("tc_a", "read"),
      ],
    };

    const result = normalizeToolResults(ctx);
    expect(result.messages.length).toBe(3);
  });

  it("does not mutate the input context", () => {
    const assistant = makeAssistant([
      makeToolCall("tc_a", "read"),
      makeToolCall("tc_b", "bash"),
    ]);

    const resultC = makeToolResult("tc_b", "bash");
    const resultA = makeToolResult("tc_a", "read");

    const ctx: Context = {
      messages: [makeUser("do things"), assistant, resultC, resultA],
    };

    const originalOrder = ctx.messages.map((m) =>
      m.role === "toolResult" ? m.toolCallId : m.role,
    );

    normalizeToolResults(ctx);

    const afterOrder = ctx.messages.map((m) =>
      m.role === "toolResult" ? m.toolCallId : m.role,
    );

    expect(afterOrder).toEqual(originalOrder);
  });

  it("handles multiple assistant-result groups", () => {
    const assistant1 = makeAssistant([
      makeToolCall("tc_a", "read"),
      makeToolCall("tc_b", "bash"),
    ]);
    const assistant2 = makeAssistant([
      makeToolCall("tc_x", "grep"),
      makeToolCall("tc_y", "write"),
    ]);

    const ctx: Context = {
      messages: [
        makeUser("first"),
        assistant1,
        makeToolResult("tc_b", "bash"),
        makeToolResult("tc_a", "read"),
        makeUser("second"),
        assistant2,
        makeToolResult("tc_y", "write"),
        makeToolResult("tc_x", "grep"),
      ],
    };

    const result = normalizeToolResults(ctx);
    const results = result.messages.filter(
      (m): m is ToolResultMessage => m.role === "toolResult",
    );

    expect(results.map((r) => r.toolCallId)).toEqual([
      "tc_a",
      "tc_b", // first group reordered
      "tc_x",
      "tc_y", // second group reordered
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/core/normalize-tool-results.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Commit failing tests**

```bash
git add tests/core/normalize-tool-results.test.ts
git commit -m "test: add failing tests for normalizeToolResults"
```

### Task 8: Implement — `normalizeToolResults`

**Files:**
- Create: `src/core/normalize-tool-results.ts`

- [ ] **Step 1: Write the implementation**

```typescript
// src/core/normalize-tool-results.ts

import type {
  AssistantMessage,
  Context,
  ToolCall,
  ToolResultMessage,
} from "@earendil-works/pi-ai";

/**
 * Reorders tool result messages so they match the order of the
 * corresponding tool_use blocks in the preceding assistant message.
 * MiniMax requires strict ordering — mismatches cause 400 errors.
 *
 * Returns a new Context; does not mutate the input.
 */
export function normalizeToolResults(context: Context): Context {
  const messages = [...context.messages];
  let changed = false;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;

    const toolCalls = (msg as AssistantMessage).content.filter(
      (c): c is ToolCall => c.type === "toolCall",
    );
    if (toolCalls.length < 2) continue;

    // Collect consecutive toolResult messages after this assistant message
    const resultStart = i + 1;
    let resultEnd = resultStart;
    while (
      resultEnd < messages.length &&
      messages[resultEnd].role === "toolResult"
    ) {
      resultEnd++;
    }

    const results = messages.slice(
      resultStart,
      resultEnd,
    ) as ToolResultMessage[];
    if (results.length < 2) continue;

    // Build the desired order based on tool call IDs
    const idOrder = toolCalls.map((tc) => tc.id);
    const resultMap = new Map<string, ToolResultMessage>();
    for (const r of results) {
      resultMap.set(r.toolCallId, r);
    }

    const sorted: ToolResultMessage[] = [];
    for (const id of idOrder) {
      const r = resultMap.get(id);
      if (r) {
        sorted.push(r);
        resultMap.delete(id);
      }
    }
    // Append any results not matched to a tool call (shouldn't happen, but be safe)
    for (const r of resultMap.values()) {
      sorted.push(r);
    }

    // Check if order actually changed
    const orderChanged = sorted.some(
      (r, idx) => r.toolCallId !== results[idx]?.toolCallId,
    );
    if (orderChanged) {
      messages.splice(resultStart, results.length, ...sorted);
      changed = true;
    }
  }

  return changed ? { ...context, messages } : context;
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `pnpm test -- tests/core/normalize-tool-results.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 3: Commit**

```bash
git add src/core/normalize-tool-results.ts
git commit -m "feat: implement normalizeToolResults for tool result ordering"
```
