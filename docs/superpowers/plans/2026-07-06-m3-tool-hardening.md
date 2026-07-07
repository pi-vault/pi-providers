# M3 Tool Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden MiniMax-M3 tool calls with JSON repair, collapsed-argument detection, cache verification logging, and tool result ordering.

**Architecture:** Two new modules compose into the existing pipeline. `hardenToolCalls` wraps the base stream (post-response) to repair tool args, detect collapsed args, and log cache stats. `normalizeToolResults` transforms the context (pre-request) to reorder tool results. Pipeline: `cleanStream(hardenToolCalls(base))` with `normalizeToolResults(context)` applied before the driver call.

**Tech Stack:** TypeScript, `@earendil-works/pi-ai` (types, `createAssistantMessageEventStream`, `parseJsonWithRepair`), Vitest

**Spec:** `docs/superpowers/specs/2026-07-06-m3-tool-hardening-design.md`

---

## File Map

| File                                        | Action | Responsibility                                      |
| ------------------------------------------- | ------ | --------------------------------------------------- |
| `src/core/harden-tool-calls.ts`             | Create | JSON repair, collapsed-arg detection, cache logging |
| `src/core/normalize-tool-results.ts`        | Create | Reorder tool results to match tool_use order        |
| `src/providers/minimax-openai.ts`           | Modify | Compose new modules into pipeline                   |
| `tests/core/harden-tool-calls.test.ts`      | Create | Tests for all hardenToolCalls behavior              |
| `tests/core/normalize-tool-results.test.ts` | Create | Tests for tool result reordering                    |

---

## Phase 1: JSON Repair (simplest, self-contained stream wrapper)

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

---

## Phase 2: Collapsed-Argument Detection (builds on Phase 1)

### Task 3: Test — collapsed-arg detection emits diagnostic text

**Files:**

- Modify: `tests/core/harden-tool-calls.test.ts`

- [ ] **Step 1: Add tests for collapsed-arg detection**

Append to the existing `describe("hardenToolCalls")` block:

```typescript
describe("collapsed-arg detection", () => {
  it("emits diagnostic text when array contains empty objects", async () => {
    const base = createAssistantMessageEventStream();
    const partial = makePartial();
    const collapsedToolCall: ToolCall = {
      type: "toolCall",
      id: "tc1",
      name: "questionnaire",
      arguments: { questions: [{}] },
    };
    partial.content.push(collapsedToolCall);

    pushEvents(base, [
      { type: "start", partial },
      { type: "toolcall_start", contentIndex: 0, partial },
      {
        type: "toolcall_delta",
        contentIndex: 0,
        delta: '{"questions":[{}]}',
        partial,
      },
      {
        type: "toolcall_end",
        contentIndex: 0,
        toolCall: collapsedToolCall,
        partial,
      },
      { type: "done", reason: "toolUse", message: partial },
    ]);

    const events = await collectEvents(hardenToolCalls(base));

    // Tool call should still pass through
    const toolEnd = events.find((e) => e.type === "toolcall_end");
    expect(toolEnd).toBeDefined();

    // Diagnostic text should be emitted
    const textDeltas = events
      .filter((e) => e.type === "text_delta")
      .map((e) => (e.type === "text_delta" ? e.delta : ""));
    const fullText = textDeltas.join("");
    expect(fullText).toContain("questionnaire");
    expect(fullText).toContain("empty nested arguments");
    expect(fullText).toContain("Do not retry");
  });

  it("does not emit diagnostic for valid nested args", async () => {
    const base = createAssistantMessageEventStream();
    const partial = makePartial();
    const validToolCall: ToolCall = {
      type: "toolCall",
      id: "tc1",
      name: "questionnaire",
      arguments: {
        questions: [
          {
            type: "single-choice",
            id: "q1",
            header: "Test",
            prompt: "Pick one",
            options: [],
          },
        ],
      },
    };
    partial.content.push(validToolCall);

    pushEvents(base, [
      { type: "start", partial },
      { type: "toolcall_start", contentIndex: 0, partial },
      {
        type: "toolcall_delta",
        contentIndex: 0,
        delta: JSON.stringify(validToolCall.arguments),
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
    const textEvents = events.filter((e) => e.type === "text_delta");
    expect(textEvents.length).toBe(0);
  });

  it("does not flag empty top-level args (those are JSON repair territory)", async () => {
    const base = createAssistantMessageEventStream();
    const partial = makePartial();
    const emptyToolCall: ToolCall = {
      type: "toolCall",
      id: "tc1",
      name: "bash",
      arguments: {},
    };
    partial.content.push(emptyToolCall);

    pushEvents(base, [
      { type: "start", partial },
      { type: "toolcall_start", contentIndex: 0, partial },
      { type: "toolcall_delta", contentIndex: 0, delta: "{}", partial },
      {
        type: "toolcall_end",
        contentIndex: 0,
        toolCall: emptyToolCall,
        partial,
      },
      { type: "done", reason: "toolUse", message: partial },
    ]);

    const events = await collectEvents(hardenToolCalls(base));
    const textEvents = events.filter((e) => e.type === "text_delta");
    expect(textEvents.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify new ones fail**

Run: `pnpm test -- tests/core/harden-tool-calls.test.ts`
Expected: FAIL on collapsed-arg tests (no diagnostic text emitted yet)

- [ ] **Step 3: Commit failing tests**

```bash
git add tests/core/harden-tool-calls.test.ts
git commit -m "test: add failing tests for collapsed-arg detection"
```

### Task 4: Implement — collapsed-arg detection

**Files:**

- Modify: `src/core/harden-tool-calls.ts`

- [ ] **Step 1: Add collapsed-arg detection helper**

Add this function after the `isEmptyArgs` function:

```typescript
/**
 * Returns true when any array in the object contains at least one
 * empty object — a sign that M3 failed to generate nested JSON.
 */
function hasCollapsedNestedArgs(args: Record<string, unknown>): boolean {
  for (const value of Object.values(args)) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (
        item !== null &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        Object.keys(item as Record<string, unknown>).length === 0
      ) {
        return true;
      }
    }
  }
  return false;
}
```

- [ ] **Step 2: Add diagnostic text emission in the `toolcall_end` handler**

Replace the `toolcall_end` case in `hardenToolCalls` with:

```typescript
          case "toolcall_end": {
            const toolCall = ev.toolCall;

            // Attempt repair if driver produced empty args
            if (isEmptyArgs(toolCall.arguments)) {
              const raw = argDeltas.get(ev.contentIndex);
              if (raw) {
                try {
                  const repaired = parseJsonWithRepair<Record<string, unknown>>(raw);
                  if (!isEmptyArgs(repaired)) {
                    const fixed: ToolCall = { ...toolCall, arguments: repaired };
                    out.push({ ...ev, toolCall: fixed });

                    // Check repaired args for collapse
                    if (hasCollapsedNestedArgs(repaired)) {
                      emitDiagnosticText(out, toolCall.name, ev.partial);
                    }

                    argDeltas.delete(ev.contentIndex);
                    break;
                  }
                } catch {
                  // Repair also failed — fall through to emit original
                }
              }
            }

            // Emit original, then check for collapsed args
            out.push(ev);
            if (!isEmptyArgs(toolCall.arguments) && hasCollapsedNestedArgs(toolCall.arguments)) {
              emitDiagnosticText(out, toolCall.name, ev.partial);
            }

            argDeltas.delete(ev.contentIndex);
            break;
          }
```

- [ ] **Step 3: Add the `emitDiagnosticText` helper**

Add this function before the `hardenToolCalls` export:

```typescript
function emitDiagnosticText(
  out: ReturnType<typeof createAssistantMessageEventStream>,
  toolName: string,
  partial: AssistantMessage,
): void {
  const msg =
    `\n[Note: Tool "${toolName}" received empty nested arguments -- ` +
    "this is a known MiniMax-M3 limitation with complex JSON schemas. " +
    "Do not retry this tool call.]\n";

  console.error(
    `[minimax-openai] collapsed args detected for tool "${toolName}"`,
  );

  // contentIndex doesn't matter for downstream since cleanStream
  // will remap it; use a high value to avoid collisions
  const idx = 9999;
  out.push({ type: "text_start", contentIndex: idx, partial });
  out.push({ type: "text_delta", contentIndex: idx, delta: msg, partial });
  out.push({ type: "text_end", contentIndex: idx, content: msg, partial });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/core/harden-tool-calls.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/harden-tool-calls.ts tests/core/harden-tool-calls.test.ts
git commit -m "feat: add collapsed-argument detection with diagnostic text"
```

---

## Phase 3: Cache Verification Logging (builds on Phase 1)

### Task 5: Test and implement — cache verification logging

**Files:**

- Modify: `tests/core/harden-tool-calls.test.ts`
- Modify: `src/core/harden-tool-calls.ts`

- [ ] **Step 1: Add cache logging tests**

Append to the `describe("hardenToolCalls")` block:

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

Also add `vi` to the import at the top of the file:

```typescript
import { describe, expect, it, vi } from "vitest";
```

- [ ] **Step 2: Run tests to verify new ones fail**

Run: `pnpm test -- tests/core/harden-tool-calls.test.ts`
Expected: FAIL on cache logging tests

- [ ] **Step 3: Add cache logging to the `done` event handler**

In `src/core/harden-tool-calls.ts`, update the default case in the switch to handle `done`:

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

Remove `"done"` from the default fallthrough — it now has its own case.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/core/harden-tool-calls.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/harden-tool-calls.ts tests/core/harden-tool-calls.test.ts
git commit -m "feat: add cache verification logging to hardenToolCalls"
```

---

## Phase 4: Event Passthrough Verification (completes hardenToolCalls)

### Task 6: Test — non-tool events pass through unchanged

**Files:**

- Modify: `tests/core/harden-tool-calls.test.ts`

- [ ] **Step 1: Add passthrough tests**

Append to the `describe("hardenToolCalls")` block:

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
Expected: PASS (all 11 tests — passthrough already works from the default case)

- [ ] **Step 3: Commit**

```bash
git add tests/core/harden-tool-calls.test.ts
git commit -m "test: add event passthrough tests for hardenToolCalls"
```

---

## Phase 5: Tool Result Ordering (independent pre-request module)

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

---

## Phase 6: Wire Into Provider (integrates all phases)

### Task 9: Wire `hardenToolCalls` and `normalizeToolResults` into the provider

**Files:**

- Modify: `src/providers/minimax-openai.ts`

- [ ] **Step 1: Update imports**

Add new imports to the top of `src/providers/minimax-openai.ts`:

```typescript
import { hardenToolCalls } from "../core/harden-tool-calls.ts";
import { normalizeToolResults } from "../core/normalize-tool-results.ts";
```

- [ ] **Step 2: Update the `streamSimple` function**

Replace the existing `streamSimple` method body:

```typescript
    streamSimple(
      model: Model<Api>,
      context: Context,
      options?: SimpleStreamOptions,
    ): AssistantMessageEventStream {
      const driver = getApiProvider("openai-completions");
      if (!driver) throw new Error("openai-completions api provider not registered");
      const ctx = normalizeToolResults(context);
      const base = driver.streamSimple(
        { ...model, api: "openai-completions" },
        ctx,
        options,
      );
      return cleanStream(hardenToolCalls(base));
    },
```

- [ ] **Step 3: Add the `Context` import**

The `Context` type is already imported (it's used in the `streamSimple` signature). Verify it's in the existing import line from `@earendil-works/pi-ai`. If not, add it.

- [ ] **Step 4: Run the full test suite**

Run: `pnpm test`
Expected: ALL PASS

- [ ] **Step 5: Run typecheck**

Run: `pnpm run typecheck`
Expected: No errors

- [ ] **Step 6: Run lint**

Run: `pnpm run lint`
Expected: No errors (fix any formatting issues with `pnpm run format` if needed)

- [ ] **Step 7: Commit**

```bash
git add src/providers/minimax-openai.ts
git commit -m "feat: wire hardenToolCalls and normalizeToolResults into provider pipeline"
```

### Task 10: Final verification

- [ ] **Step 1: Run the full check suite**

Run: `pnpm run check`
Expected: lint + typecheck + tests all pass

- [ ] **Step 2: Review the diff**

Run: `git diff main...HEAD --stat` and `git log --oneline main...HEAD`
Verify:

- 4 new files (2 source, 2 test)
- 1 modified file (minimax-openai.ts)
- No unrelated changes

- [ ] **Step 3: Final commit if any formatting changes**

```bash
git add -A
git status  # should be clean
```
