# Phase 3: Stream Cleaning Integration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `cleanStream` transformer and upgrade the providers to use a custom `streamSimple` that delegates to Pi's built-in `openai-completions` driver wrapped with real-time stream cleaning — fixing both fake-tool-call and thinking-leakage bugs.

**Architecture:** `cleanStream` consumes events from the base `AssistantMessageEventStream`, merges multiple thinking blocks into one (deduplicating re-streamed reasoning prefixes), strips `<think>` tags from text deltas using `ThinkScanner`, and remaps content indices for tool calls. The provider factory is upgraded from bare `api: "openai-completions"` registration to a custom `streamSimple` with `api` set to the provider name (custom api id), which calls `getApiProvider("openai-completions").streamSimple()` and pipes through `cleanStream`.

**Tech Stack:** TypeScript (erasable syntax only), `@earendil-works/pi-ai` (`getApiProvider` from `/compat`, `createAssistantMessageEventStream`, types), `@earendil-works/pi-coding-agent` (`ExtensionAPI`), Vitest.

**Prerequisite:** Phase 1 (providers registered) + Phase 2 (ThinkScanner implemented).

---

## File Map

| File | Responsibility |
|------|---------------|
| `src/core/clean-stream.ts` | Stream rewriting: merge thinking, strip tags, remap indices |
| `src/providers/minimax-openai.ts` | Upgrade: add custom `streamSimple` using `cleanStream` |
| `tests/core/clean-stream.test.ts` | cleanStream integration tests with mock event streams |
| `tests/providers/minimax-openai.test.ts` | Update: verify `streamSimple` is present and calls driver |

---

## Verification Commands

```bash
pnpm run check
```

---

### Task 1: cleanStream Implementation

**Files:**
- Create: `src/core/clean-stream.ts`
- Test: `tests/core/clean-stream.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/core/clean-stream.test.ts

import { describe, expect, it } from "vitest";
import type {
  AssistantMessage,
  AssistantMessageEvent,
  TextContent,
  ThinkingContent,
  ToolCall,
} from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { cleanStream } from "../../src/core/clean-stream.ts";

function makePartial(content: AssistantMessage["content"] = []): AssistantMessage {
  return {
    role: "assistant",
    content,
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
    stopReason: "stop",
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

describe("cleanStream", () => {
  describe("text handling", () => {
    it("trims leading whitespace from visible text", async () => {
      const base = createAssistantMessageEventStream();
      const partial = makePartial();
      partial.content.push({ type: "text", text: "" } as TextContent);

      pushEvents(base, [
        { type: "start", partial },
        { type: "text_start", contentIndex: 0, partial },
        { type: "text_delta", contentIndex: 0, delta: "  hello", partial },
        { type: "text_delta", contentIndex: 0, delta: " world", partial },
        { type: "text_end", contentIndex: 0, content: "  hello world", partial },
        { type: "done", reason: "stop", message: partial },
      ]);

      const events = await collectEvents(cleanStream(base));
      const deltas = events
        .filter((e) => e.type === "text_delta")
        .map((e) => (e.type === "text_delta" ? e.delta : ""))
        .join("");
      expect(deltas).toBe("hello world");
    });

    it("suppresses text blocks that are entirely <think> content", async () => {
      const base = createAssistantMessageEventStream();
      const partial = makePartial();
      partial.content.push({ type: "text", text: "" } as TextContent);

      pushEvents(base, [
        { type: "start", partial },
        { type: "text_start", contentIndex: 0, partial },
        { type: "text_delta", contentIndex: 0, delta: "<think>only thinking</think>", partial },
        { type: "text_end", contentIndex: 0, content: "<think>only thinking</think>", partial },
        { type: "done", reason: "stop", message: partial },
      ]);

      const events = await collectEvents(cleanStream(base));
      const textStarts = events.filter((e) => e.type === "text_start");
      expect(textStarts.length).toBe(0);
    });
  });

  describe("thinking with no structured blocks (re-route from text)", () => {
    it("re-routes <think> content to a thinking block", async () => {
      const base = createAssistantMessageEventStream();
      const partial = makePartial();
      partial.content.push({ type: "text", text: "" } as TextContent);

      pushEvents(base, [
        { type: "start", partial },
        { type: "text_start", contentIndex: 0, partial },
        { type: "text_delta", contentIndex: 0, delta: "<think>reasoning</think>answer", partial },
        { type: "text_end", contentIndex: 0, content: "<think>reasoning</think>answer", partial },
        { type: "done", reason: "stop", message: partial },
      ]);

      const events = await collectEvents(cleanStream(base));
      const thinkDeltas = events
        .filter((e) => e.type === "thinking_delta")
        .map((e) => (e.type === "thinking_delta" ? e.delta : ""))
        .join("");
      const textDeltas = events
        .filter((e) => e.type === "text_delta")
        .map((e) => (e.type === "text_delta" ? e.delta : ""))
        .join("");
      expect(thinkDeltas).toBe("reasoning");
      expect(textDeltas).toBe("answer");
    });

    it("emits thinking_start and thinking_end around re-routed content", async () => {
      const base = createAssistantMessageEventStream();
      const partial = makePartial();
      partial.content.push({ type: "text", text: "" } as TextContent);

      pushEvents(base, [
        { type: "start", partial },
        { type: "text_start", contentIndex: 0, partial },
        { type: "text_delta", contentIndex: 0, delta: "<think>thought</think>text", partial },
        { type: "text_end", contentIndex: 0, content: "<think>thought</think>text", partial },
        { type: "done", reason: "stop", message: partial },
      ]);

      const events = await collectEvents(cleanStream(base));
      const thinkStarts = events.filter((e) => e.type === "thinking_start");
      const thinkEnds = events.filter((e) => e.type === "thinking_end");
      expect(thinkStarts.length).toBe(1);
      expect(thinkEnds.length).toBe(1);
    });
  });

  describe("thinking with structured blocks (drop inline duplicates)", () => {
    it("drops <think> from text when structured thinking already exists", async () => {
      const base = createAssistantMessageEventStream();
      const partial = makePartial();
      partial.content.push({ type: "thinking", thinking: "" } as ThinkingContent);

      pushEvents(base, [
        { type: "start", partial },
        { type: "thinking_start", contentIndex: 0, partial },
        { type: "thinking_delta", contentIndex: 0, delta: "real reasoning", partial },
        { type: "thinking_end", contentIndex: 0, content: "real reasoning", partial },
        { type: "text_start", contentIndex: 1, partial },
        { type: "text_delta", contentIndex: 1, delta: "<think>duplicate</think>answer", partial },
        { type: "text_end", contentIndex: 1, content: "<think>duplicate</think>answer", partial },
        { type: "done", reason: "stop", message: partial },
      ]);

      const events = await collectEvents(cleanStream(base));
      const thinkDeltas = events
        .filter((e) => e.type === "thinking_delta")
        .map((e) => (e.type === "thinking_delta" ? e.delta : ""))
        .join("");
      const textDeltas = events
        .filter((e) => e.type === "text_delta")
        .map((e) => (e.type === "text_delta" ? e.delta : ""))
        .join("");
      expect(thinkDeltas).toBe("real reasoning");
      expect(textDeltas).toBe("answer");
    });
  });

  describe("thinking block merging", () => {
    it("merges multiple thinking blocks into one", async () => {
      const base = createAssistantMessageEventStream();
      const partial = makePartial();
      partial.content.push(
        { type: "thinking", thinking: "" } as ThinkingContent,
        { type: "thinking", thinking: "" } as ThinkingContent,
      );

      pushEvents(base, [
        { type: "start", partial },
        { type: "thinking_start", contentIndex: 0, partial },
        { type: "thinking_delta", contentIndex: 0, delta: "first ", partial },
        { type: "thinking_end", contentIndex: 0, content: "first ", partial },
        { type: "thinking_start", contentIndex: 1, partial },
        { type: "thinking_delta", contentIndex: 1, delta: "second", partial },
        { type: "thinking_end", contentIndex: 1, content: "second", partial },
        { type: "done", reason: "stop", message: partial },
      ]);

      const events = await collectEvents(cleanStream(base));
      const thinkStarts = events.filter((e) => e.type === "thinking_start");
      const thinkEnds = events.filter((e) => e.type === "thinking_end");
      expect(thinkStarts.length).toBe(1);
      expect(thinkEnds.length).toBe(1);
      const thinkText = events
        .filter((e) => e.type === "thinking_delta")
        .map((e) => (e.type === "thinking_delta" ? e.delta : ""))
        .join("");
      expect(thinkText).toBe("first second");
    });

    it("deduplicates re-streamed reasoning prefix", async () => {
      const base = createAssistantMessageEventStream();
      const partial = makePartial();
      partial.content.push(
        { type: "thinking", thinking: "" } as ThinkingContent,
        { type: "thinking", thinking: "" } as ThinkingContent,
      );

      pushEvents(base, [
        { type: "start", partial },
        { type: "thinking_start", contentIndex: 0, partial },
        { type: "thinking_delta", contentIndex: 0, delta: "ABC", partial },
        { type: "thinking_end", contentIndex: 0, content: "ABC", partial },
        { type: "thinking_start", contentIndex: 1, partial },
        { type: "thinking_delta", contentIndex: 1, delta: "ABCDEF", partial },
        { type: "thinking_end", contentIndex: 1, content: "ABCDEF", partial },
        { type: "done", reason: "stop", message: partial },
      ]);

      const events = await collectEvents(cleanStream(base));
      const thinkText = events
        .filter((e) => e.type === "thinking_delta")
        .map((e) => (e.type === "thinking_delta" ? e.delta : ""))
        .join("");
      expect(thinkText).toBe("ABCDEF");
    });
  });

  describe("tool call pass-through", () => {
    it("passes tool calls through with remapped indices", async () => {
      const base = createAssistantMessageEventStream();
      const partial = makePartial();
      const toolCall: ToolCall = {
        type: "toolCall",
        id: "tc1",
        name: "read",
        arguments: { path: "/foo" },
      };
      partial.content.push(
        { type: "thinking", thinking: "" } as ThinkingContent,
        toolCall,
      );

      pushEvents(base, [
        { type: "start", partial },
        { type: "thinking_start", contentIndex: 0, partial },
        { type: "thinking_delta", contentIndex: 0, delta: "planning", partial },
        { type: "thinking_end", contentIndex: 0, content: "planning", partial },
        { type: "toolcall_start", contentIndex: 1, partial },
        { type: "toolcall_delta", contentIndex: 1, delta: '{"path":"/foo"}', partial },
        { type: "toolcall_end", contentIndex: 1, toolCall, partial },
        { type: "done", reason: "toolUse", message: partial },
      ]);

      const events = await collectEvents(cleanStream(base));
      const toolStarts = events.filter((e) => e.type === "toolcall_start");
      const toolEnds = events.filter((e) => e.type === "toolcall_end");
      expect(toolStarts.length).toBe(1);
      expect(toolEnds.length).toBe(1);
      if (toolEnds[0].type === "toolcall_end") {
        expect(toolEnds[0].toolCall.name).toBe("read");
        expect(toolEnds[0].toolCall.arguments).toEqual({ path: "/foo" });
      }
    });

    it("closes thinking segment before tool call", async () => {
      const base = createAssistantMessageEventStream();
      const partial = makePartial();
      const toolCall: ToolCall = {
        type: "toolCall",
        id: "tc1",
        name: "bash",
        arguments: { command: "ls" },
      };
      partial.content.push(
        { type: "thinking", thinking: "" } as ThinkingContent,
        toolCall,
      );

      pushEvents(base, [
        { type: "start", partial },
        { type: "thinking_start", contentIndex: 0, partial },
        { type: "thinking_delta", contentIndex: 0, delta: "let me check", partial },
        { type: "thinking_end", contentIndex: 0, content: "let me check", partial },
        { type: "toolcall_start", contentIndex: 1, partial },
        { type: "toolcall_delta", contentIndex: 1, delta: '{"command":"ls"}', partial },
        { type: "toolcall_end", contentIndex: 1, toolCall, partial },
        { type: "done", reason: "toolUse", message: partial },
      ]);

      const events = await collectEvents(cleanStream(base));
      const thinkEnd = events.findIndex((e) => e.type === "thinking_end");
      const toolStart = events.findIndex((e) => e.type === "toolcall_start");
      expect(thinkEnd).toBeLessThan(toolStart);
    });
  });

  describe("error handling", () => {
    it("propagates base stream errors", async () => {
      const base = createAssistantMessageEventStream();
      const partial = makePartial();

      pushEvents(base, [
        { type: "start", partial },
        {
          type: "error",
          reason: "error",
          error: { ...partial, stopReason: "error", errorMessage: "upstream fail" },
        },
      ]);

      const events = await collectEvents(cleanStream(base));
      const errors = events.filter((e) => e.type === "error");
      expect(errors.length).toBe(1);
      if (errors[0].type === "error") {
        expect(errors[0].error.errorMessage).toBe("upstream fail");
      }
    });
  });

  describe("done event", () => {
    it("carries the cleaned message content", async () => {
      const base = createAssistantMessageEventStream();
      const partial = makePartial();
      partial.content.push({ type: "text", text: "" } as TextContent);

      pushEvents(base, [
        { type: "start", partial },
        { type: "text_start", contentIndex: 0, partial },
        { type: "text_delta", contentIndex: 0, delta: "result", partial },
        { type: "text_end", contentIndex: 0, content: "result", partial },
        { type: "done", reason: "stop", message: partial },
      ]);

      const events = await collectEvents(cleanStream(base));
      const done = events.find((e) => e.type === "done");
      expect(done).toBeDefined();
      if (done?.type === "done") {
        const texts = done.message.content.filter(
          (c): c is TextContent => c.type === "text",
        );
        expect(texts.length).toBe(1);
        expect(texts[0].text).toBe("result");
      }
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test -- tests/core/clean-stream.test.ts`
Expected: FAIL — cannot resolve `../../src/core/clean-stream.ts`

- [ ] **Step 3: Implement cleanStream**

```ts
// src/core/clean-stream.ts

import type {
  AssistantMessage,
  AssistantMessageEventStream,
  TextContent,
  ThinkingContent,
  ToolCall,
} from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { ThinkScanner } from "./think-scanner.ts";

interface TextState {
  scanner: ThinkScanner;
  started: boolean;
  index: number;
  block: TextContent;
}

interface ThinkingSegment {
  block: ThinkingContent;
  index: number;
  open: boolean;
  text: string;
  signature?: string;
}

export function cleanStream(base: AssistantMessageEventStream): AssistantMessageEventStream {
  const out = createAssistantMessageEventStream();

  void (async () => {
    let output: AssistantMessage | undefined;
    const toolIndexMap = new Map<number, number>();
    const textStates = new Map<number, TextState>();
    const baseThinkingAccs = new Map<number, string>();
    let sawBaseThinking = false;
    let segment: ThinkingSegment | undefined;

    const ensureOutput = (partial: AssistantMessage): AssistantMessage => {
      if (!output) output = { ...partial, content: [] };
      return output;
    };

    const syncMeta = (partial: AssistantMessage) => {
      if (!output) {
        ensureOutput(partial);
        return;
      }
      for (const key of Object.keys(partial)) {
        if (key === "content") continue;
        (output as Record<string, unknown>)[key] = (partial as Record<string, unknown>)[key];
      }
    };

    const ensureSegment = (): ThinkingSegment => {
      if (segment?.open) return segment;
      const block: ThinkingContent = { type: "thinking", thinking: "" };
      output!.content.push(block);
      segment = { block, index: output!.content.length - 1, open: true, text: "" };
      baseThinkingAccs.clear();
      out.push({ type: "thinking_start", contentIndex: segment.index, partial: output! });
      return segment;
    };

    const closeSegment = () => {
      if (!segment?.open) return;
      segment.open = false;
      segment.text = segment.text.trimEnd();
      segment.block.thinking = segment.text;
      if (segment.signature) {
        (segment.block as ThinkingContent & { thinkingSignature?: string }).thinkingSignature =
          segment.signature;
      }
      out.push({
        type: "thinking_end",
        contentIndex: segment.index,
        content: segment.text,
        partial: output!,
      });
    };

    const appendThinking = (delta: string) => {
      if (!delta || !output) return;
      const seg = ensureSegment();
      if (seg.text === "") {
        delta = delta.replace(/^\s+/, "");
        if (!delta) return;
      }
      seg.text += delta;
      seg.block.thinking = seg.text;
      out.push({ type: "thinking_delta", contentIndex: seg.index, delta, partial: output });
    };

    const pushBaseThinking = (contentIndex: number, delta: string) => {
      const acc = (baseThinkingAccs.get(contentIndex) ?? "") + delta;
      baseThinkingAccs.set(contentIndex, acc);
      const have = segment?.open ? segment.text : "";
      const norm = acc.replace(/^\s+/, "");
      if (norm.length <= have.length) {
        if (have.startsWith(norm)) return;
        appendThinking(delta);
      } else if (norm.startsWith(have)) {
        appendThinking(norm.slice(have.length));
      } else {
        appendThinking(delta);
      }
    };

    const pushInlineThinking = (think: string) => {
      if (!think || sawBaseThinking || !output) return;
      appendThinking(think);
    };

    const pushText = (state: TextState, text: string) => {
      if (!text || !output) return;
      if (!state.started) {
        text = text.replace(/^\s+/, "");
        if (!text) return;
        closeSegment();
        output.content.push(state.block);
        state.index = output.content.length - 1;
        state.started = true;
        out.push({ type: "text_start", contentIndex: state.index, partial: output });
      }
      state.block.text += text;
      out.push({ type: "text_delta", contentIndex: state.index, delta: text, partial: output });
    };

    try {
      for await (const ev of base) {
        switch (ev.type) {
          case "start": {
            ensureOutput(ev.partial);
            out.push({ type: "start", partial: output! });
            break;
          }
          case "thinking_start": {
            sawBaseThinking = true;
            syncMeta(ev.partial);
            baseThinkingAccs.set(ev.contentIndex, "");
            break;
          }
          case "thinking_delta": {
            syncMeta(ev.partial);
            pushBaseThinking(ev.contentIndex, ev.delta);
            break;
          }
          case "thinking_end": {
            syncMeta(ev.partial);
            const baseBlock = ev.partial.content[ev.contentIndex] as
              | (ThinkingContent & { thinkingSignature?: string })
              | undefined;
            if (segment && baseBlock?.type === "thinking" && baseBlock.thinkingSignature) {
              segment.signature = baseBlock.thinkingSignature;
            }
            break;
          }
          case "text_start": {
            syncMeta(ev.partial);
            textStates.set(ev.contentIndex, {
              scanner: new ThinkScanner(),
              started: false,
              index: -1,
              block: { type: "text", text: "" },
            });
            break;
          }
          case "text_delta": {
            syncMeta(ev.partial);
            const state = textStates.get(ev.contentIndex);
            if (!state) break;
            const { text, think } = state.scanner.feed(ev.delta);
            pushInlineThinking(think);
            pushText(state, text);
            break;
          }
          case "text_end": {
            syncMeta(ev.partial);
            const state = textStates.get(ev.contentIndex);
            if (!state) break;
            const tail = state.scanner.flush();
            pushInlineThinking(tail.think);
            pushText(state, tail.text);
            if (state.started) {
              state.block.text = state.block.text.trimEnd();
              out.push({
                type: "text_end",
                contentIndex: state.index,
                content: state.block.text,
                partial: output!,
              });
            }
            break;
          }
          case "toolcall_start": {
            syncMeta(ev.partial);
            closeSegment();
            const baseBlock = ev.partial.content[ev.contentIndex];
            output!.content.push(baseBlock as ToolCall);
            toolIndexMap.set(ev.contentIndex, output!.content.length - 1);
            out.push({
              type: "toolcall_start",
              contentIndex: toolIndexMap.get(ev.contentIndex)!,
              partial: output!,
            });
            break;
          }
          case "toolcall_delta": {
            syncMeta(ev.partial);
            const idx = toolIndexMap.get(ev.contentIndex);
            if (idx === undefined) break;
            out.push({
              type: "toolcall_delta",
              contentIndex: idx,
              delta: ev.delta,
              partial: output!,
            });
            break;
          }
          case "toolcall_end": {
            syncMeta(ev.partial);
            const idx = toolIndexMap.get(ev.contentIndex);
            if (idx === undefined) break;
            output!.content[idx] = ev.toolCall;
            out.push({
              type: "toolcall_end",
              contentIndex: idx,
              toolCall: ev.toolCall,
              partial: output!,
            });
            break;
          }
          case "done": {
            closeSegment();
            const message: AssistantMessage = {
              ...ev.message,
              content: output ? output.content : ev.message.content,
            };
            out.push({ type: "done", reason: ev.reason, message });
            break;
          }
          case "error": {
            closeSegment();
            const error: AssistantMessage = {
              ...ev.error,
              content: output ? output.content : ev.error.content,
            };
            out.push({ type: "error", reason: ev.reason, error });
            break;
          }
        }
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      const fallback: AssistantMessage = output ?? {
        role: "assistant",
        content: [],
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run test -- tests/core/clean-stream.test.ts`
Expected: all 10 tests PASS

- [ ] **Step 5: Run full check**

Run: `pnpm run check`
Expected: lint, typecheck, and all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/core/clean-stream.ts tests/core/clean-stream.test.ts
git commit -m "feat: implement cleanStream for thinking merge and <think> stripping

Merges multiple thinking blocks into one, deduplicates re-streamed
reasoning prefixes, strips <think> tags from text (re-routes to
thinking if no structured thinking exists), and passes tool calls
through with index remapping."
```

---

### Task 2: Upgrade Provider to Custom streamSimple

**Files:**
- Modify: `src/providers/minimax-openai.ts`
- Modify: `tests/providers/minimax-openai.test.ts`

- [ ] **Step 1: Update provider tests**

Replace `tests/providers/minimax-openai.test.ts` with:

```ts
// tests/providers/minimax-openai.test.ts

import { describe, expect, it, vi } from "vitest";
import { makeProvider, M3_MODEL_CONFIG, M3_COMPAT } from "../../src/providers/minimax-openai.ts";

describe("makeProvider", () => {
  it("registers a provider with the correct name and baseUrl", () => {
    const registerProvider = vi.fn();
    const mockPi = { registerProvider } as unknown as Parameters<typeof makeProvider>[0];

    makeProvider(mockPi, "minimax-openai", "https://api.minimax.io/v1", "$MINIMAX_API_KEY", "MiniMax (OpenAI)");

    expect(registerProvider).toHaveBeenCalledOnce();
    const [name, config] = registerProvider.mock.calls[0];
    expect(name).toBe("minimax-openai");
    expect(config.baseUrl).toBe("https://api.minimax.io/v1");
    expect(config.apiKey).toBe("$MINIMAX_API_KEY");
    expect(config.name).toBe("MiniMax (OpenAI)");
  });

  it("provides a custom streamSimple function", () => {
    const registerProvider = vi.fn();
    const mockPi = { registerProvider } as unknown as Parameters<typeof makeProvider>[0];

    makeProvider(mockPi, "minimax-openai", "https://api.minimax.io/v1", "$MINIMAX_API_KEY", "MiniMax (OpenAI)");

    const [, config] = registerProvider.mock.calls[0];
    expect(typeof config.streamSimple).toBe("function");
  });

  it("sets api to the provider name (custom api id for routing)", () => {
    const registerProvider = vi.fn();
    const mockPi = { registerProvider } as unknown as Parameters<typeof makeProvider>[0];

    makeProvider(mockPi, "minimax-openai", "https://api.minimax.io/v1", "$MINIMAX_API_KEY", "MiniMax (OpenAI)");

    const [, config] = registerProvider.mock.calls[0];
    expect(config.api).toBe("minimax-openai");
  });

  it("registers a single MiniMax-M3 model", () => {
    const registerProvider = vi.fn();
    const mockPi = { registerProvider } as unknown as Parameters<typeof makeProvider>[0];

    makeProvider(mockPi, "minimax-openai", "https://api.minimax.io/v1", "$MINIMAX_API_KEY", "MiniMax (OpenAI)");

    const [, config] = registerProvider.mock.calls[0];
    expect(config.models).toHaveLength(1);
    expect(config.models[0].id).toBe("MiniMax-M3");
    expect(config.models[0].reasoning).toBe(true);
    expect(config.models[0].input).toEqual(["text", "image"]);
  });
});

describe("M3_MODEL_CONFIG", () => {
  it("has correct pricing", () => {
    expect(M3_MODEL_CONFIG.cost).toEqual({
      input: 0.6,
      output: 2.4,
      cacheRead: 0.12,
      cacheWrite: 0,
    });
  });

  it("has correct context and output limits", () => {
    expect(M3_MODEL_CONFIG.contextWindow).toBe(1_000_000);
    expect(M3_MODEL_CONFIG.maxTokens).toBe(512_000);
  });

  it("has compat settings that disable unsupported features", () => {
    expect(M3_MODEL_CONFIG.compat).toEqual(M3_COMPAT);
  });
});

describe("M3_COMPAT", () => {
  it("disables store, developer role, and reasoning effort", () => {
    expect(M3_COMPAT.supportsStore).toBe(false);
    expect(M3_COMPAT.supportsDeveloperRole).toBe(false);
    expect(M3_COMPAT.supportsReasoningEffort).toBe(false);
  });

  it("uses max_tokens field", () => {
    expect(M3_COMPAT.maxTokensField).toBe("max_tokens");
  });
});
```

- [ ] **Step 2: Run tests to verify the new assertions fail**

Run: `pnpm run test -- tests/providers/minimax-openai.test.ts`
Expected: FAIL on "provides a custom streamSimple function" (Phase 1 version has no streamSimple) and "sets api to the provider name" (Phase 1 sets `api: "openai-completions"`, not `"minimax-openai"`)

- [ ] **Step 3: Update provider factory to use custom streamSimple**

Replace `src/providers/minimax-openai.ts` with:

```ts
// src/providers/minimax-openai.ts

import type {
  Api,
  AssistantMessageEventStream,
  Context,
  Model,
  OpenAICompletionsCompat,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { getApiProvider } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { cleanStream } from "../core/clean-stream.ts";

export const M3_COMPAT: OpenAICompletionsCompat = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
  maxTokensField: "max_tokens",
};

export const M3_MODEL_CONFIG: ProviderModelConfig = {
  id: "MiniMax-M3",
  name: "MiniMax-M3",
  reasoning: true,
  input: ["text", "image"],
  cost: { input: 0.6, output: 2.4, cacheRead: 0.12, cacheWrite: 0 },
  contextWindow: 1_000_000,
  maxTokens: 512_000,
  compat: M3_COMPAT,
};

export function makeProvider(
  pi: ExtensionAPI,
  name: string,
  baseUrl: string,
  apiKey: string,
  displayName: string,
): void {
  pi.registerProvider(name, {
    name: displayName,
    baseUrl,
    apiKey,
    api: name as Api,
    streamSimple(
      model: Model<Api>,
      context: Context,
      options?: SimpleStreamOptions,
    ): AssistantMessageEventStream {
      const driver = getApiProvider("openai-completions");
      if (!driver) throw new Error("openai-completions api provider not registered");
      const base = driver.streamSimple(
        { ...model, api: "openai-completions" },
        context,
        options,
      );
      return cleanStream(base);
    },
    models: [M3_MODEL_CONFIG],
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run test -- tests/providers/minimax-openai.test.ts`
Expected: all 8 tests PASS

- [ ] **Step 5: Run full check**

Run: `pnpm run check`
Expected: lint, typecheck, and all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/providers/minimax-openai.ts tests/providers/minimax-openai.test.ts
git commit -m "feat: upgrade provider to custom streamSimple with cleanStream

Uses a custom api id (the provider name) so only our models route
through our handler. streamSimple delegates to the built-in
openai-completions driver and wraps the stream with cleanStream
for thinking deduplication and <think> tag removal."
```

---

### Task 3: Final Verification

**Files:**
- No new files

- [ ] **Step 1: Run full check suite**

Run: `pnpm run check`
Expected: zero errors from lint, typecheck, and tests

- [ ] **Step 2: Verify test count**

Run: `pnpm run test`
Expected test files and approximate counts:
- `tests/core/think-scanner.test.ts` — 18 tests
- `tests/core/clean-stream.test.ts` — 10 tests
- `tests/providers/minimax-openai.test.ts` — 8 tests
- `tests/index.test.ts` — 4 tests

Total: ~40 tests, all passing.

- [ ] **Step 3: Verify file structure**

Run: `find src tests -type f -name "*.ts" | sort`

Expected:
```
src/core/clean-stream.ts
src/core/think-scanner.ts
src/index.ts
src/providers/minimax-openai.ts
src/shared/types.ts
tests/core/clean-stream.test.ts
tests/core/think-scanner.test.ts
tests/index.test.ts
tests/providers/minimax-openai.test.ts
```

- [ ] **Step 4: Commit any cleanup**

If formatter made changes:

```bash
git add -u
git commit -m "chore: apply formatting fixes"
```

---

## Result After Phase 3

The extension is complete:
- `minimax-openai / MiniMax-M3` and `minimax-openai-cn / MiniMax-M3` route through OpenAI-compatible endpoints
- Custom api ids ensure only our models route through our handler (no global driver override)
- Custom `streamSimple` delegates to Pi's built-in `openai-completions` driver
- `cleanStream` wraps the output:
  - Multiple thinking blocks merged into one
  - Re-streamed reasoning prefixes deduplicated
  - `<think>` tags stripped from visible text (re-routed to thinking when no structured thinking exists, dropped when structured thinking already present)
  - Tool calls pass through unchanged with correct index remapping
  - Leading whitespace trimmed from visible text
- Both the fake-tool-call bug and thinking-leakage bug are fixed
- ~40 tests covering scanner, stream transformer, provider registration, and extension entry

## Notes for the Implementing Engineer

### Import paths

- `getApiProvider` is at `@earendil-works/pi-ai/compat` (subpath export), NOT the main package.
- `createAssistantMessageEventStream` is at the main `@earendil-works/pi-ai` package.
- All type imports (`Model`, `Api`, `Context`, `SimpleStreamOptions`, `AssistantMessage`, etc.) come from the main `@earendil-works/pi-ai` package.
- `ExtensionAPI` and `ProviderModelConfig` are from `@earendil-works/pi-coding-agent`.

### How the custom streamSimple works

When Pi calls our `streamSimple(model, context, options)`:
1. We get the built-in OpenAI completions driver via `getApiProvider("openai-completions")`
2. We call its `streamSimple` with the model's `api` overridden to `"openai-completions"` (so it knows to use OpenAI protocol)
3. The driver handles HTTP/SSE communication with `https://api.minimax.io/v1/chat/completions`
4. We wrap the returned event stream with `cleanStream` before returning to Pi
5. Pi's agent loop consumes our cleaned stream for rendering and tool execution

### Why use a custom api id

Pi's `ModelRegistry.validateProviderConfig` requires `api` when `streamSimple` is provided:
```
if (config.streamSimple && !config.api) {
    throw new Error(`Provider ${providerName}: "api" is required when registering streamSimple.`);
}
```

When `streamSimple` is registered, Pi calls `registerApiProvider` with `config.api` as the api id. This means **all models with that api field** route through our handler. If we used `api: "openai-completions"`, we'd override the built-in driver globally for ALL providers.

Instead, we use the provider name as a custom api id (`api: name as Api`). This ensures:
- Only our models (whose api field is set to the provider name) route through our `streamSimple`
- Other providers' models continue using the built-in openai-completions driver
- In `streamSimple`, we override `model.api` to `"openai-completions"` when calling the driver so it knows which protocol to speak
