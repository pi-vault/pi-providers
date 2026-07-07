# Phase 5: Collapsed-Argument Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add collapsed-argument detection to `hardenToolCalls` that emits diagnostic text when M3 generates empty nested objects, stopping the model's retry loop.

**Architecture:** Extends `hardenToolCalls` (created in Phase 4) with a `hasCollapsedNestedArgs` detection heuristic and `emitDiagnosticText` helper. After JSON repair at `toolcall_end`, checks if any arrays contain empty objects. If detected, emits a synthetic text block warning the model not to retry.

**Tech Stack:** TypeScript, `@earendil-works/pi-ai`, Vitest

**Spec:** `docs/superpowers/specs/2026-07-06-m3-tool-hardening-design.md`

**Parent plan:** `docs/superpowers/plans/2026-07-06-m3-tool-hardening.md` (Phase 2)

**Prerequisite:** Phase 4 (JSON Repair) must be complete. `src/core/harden-tool-calls.ts` and `tests/core/harden-tool-calls.test.ts` must exist.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/core/harden-tool-calls.ts` | Modify | Add `hasCollapsedNestedArgs`, `emitDiagnosticText`, update `toolcall_end` handler |
| `tests/core/harden-tool-calls.test.ts` | Modify | Add collapsed-arg detection tests |

---

### Task 3: Test — collapsed-arg detection emits diagnostic text

**Files:**
- Modify: `tests/core/harden-tool-calls.test.ts`

- [ ] **Step 1: Add tests for collapsed-arg detection**

Append to the existing `describe("hardenToolCalls")` block in `tests/core/harden-tool-calls.test.ts`:

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
Expected: FAIL on "emits diagnostic text when array contains empty objects" (no diagnostic text emitted yet). The other two new tests should PASS (they assert absence of diagnostic text, which is already the behavior).

- [ ] **Step 3: Commit failing tests**

```bash
git add tests/core/harden-tool-calls.test.ts
git commit -m "test: add failing tests for collapsed-arg detection"
```

### Task 4: Implement — collapsed-arg detection

**Files:**
- Modify: `src/core/harden-tool-calls.ts`

- [ ] **Step 1: Add collapsed-arg detection helper**

Add this function after the `isEmptyArgs` function in `src/core/harden-tool-calls.ts`:

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

- [ ] **Step 2: Add the `emitDiagnosticText` helper**

Add this function before the `hardenToolCalls` export in `src/core/harden-tool-calls.ts`:

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

- [ ] **Step 3: Update the `toolcall_end` handler**

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

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/core/harden-tool-calls.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/harden-tool-calls.ts tests/core/harden-tool-calls.test.ts
git commit -m "feat: add collapsed-argument detection with diagnostic text"
```
