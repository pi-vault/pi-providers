# MiniMax-M3 OpenAI Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register MiniMax-M3 providers that route through the OpenAI-compatible endpoint with real-time stream cleaning to fix fake-tool-call and thinking-leakage bugs.

**Architecture:** Extension registers two providers (`minimax-openai`, `minimax-openai-cn`) with a custom `streamSimple` that delegates to Pi's built-in `openai-completions` driver via `getApiProvider`, then wraps the stream with a `cleanStream` layer that merges thinking blocks and strips `<think>` tags from text deltas.

**Tech Stack:** TypeScript (erasable syntax only), `@earendil-works/pi-ai` (types + `getApiProvider` + `createAssistantMessageEventStream`), `@earendil-works/pi-coding-agent` (`ExtensionAPI`), Vitest for testing, Biome for linting.

---

## File Map

| File                                     | Responsibility                                              |
| ---------------------------------------- | ----------------------------------------------------------- |
| `src/shared/types.ts`                    | Internal type alias shared between core modules             |
| `src/core/think-scanner.ts`              | Incremental `<think>` tag parser for streaming text         |
| `src/core/clean-stream.ts`               | Stream rewriting: merge thinking, strip tags, remap indices |
| `src/providers/minimax-openai.ts`        | Provider factory (`makeProvider`) + M3 model config         |
| `src/index.ts`                           | Extension entry: registers both providers                   |
| `tests/core/think-scanner.test.ts`       | ThinkScanner unit tests                                     |
| `tests/core/clean-stream.test.ts`        | cleanStream integration tests with mock events              |
| `tests/providers/minimax-openai.test.ts` | Provider registration unit tests                            |
| `tests/index.test.ts`                    | Extension smoke test (update existing)                      |

---

## Verification Commands

```bash
# Lint
pnpm run lint

# Typecheck
pnpm run typecheck

# Test
pnpm run test

# All three (CI gate)
pnpm run check
```

---

### Task 1: Shared Types

**Files:**

- Create: `src/shared/types.ts`

- [ ] **Step 1: Create the shared types file**

```ts
// src/shared/types.ts

export interface ThinkScanResult {
  text: string;
  think: string;
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `pnpm run typecheck`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add shared internal types module"
```

---

### Task 2: ThinkScanner

**Files:**

- Create: `src/core/think-scanner.ts`
- Test: `tests/core/think-scanner.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/core/think-scanner.test.ts

import { describe, expect, it } from "vitest";
import { ThinkScanner } from "../../src/core/think-scanner.ts";

describe("ThinkScanner", () => {
  it("passes plain text through unchanged", () => {
    const scanner = new ThinkScanner();
    const result = scanner.feed("hello world");
    expect(result).toEqual({ text: "hello world", think: "" });
  });

  it("extracts <think> content from text", () => {
    const scanner = new ThinkScanner();
    const result = scanner.feed("before<think>reasoning</think>after");
    expect(result).toEqual({ text: "beforeafter", think: "reasoning" });
  });

  it("handles multiple <think> blocks in one chunk", () => {
    const scanner = new ThinkScanner();
    const result = scanner.feed("a<think>one</think>b<think>two</think>c");
    expect(result).toEqual({ text: "abc", think: "onetwo" });
  });

  it("handles tag split across two chunks", () => {
    const scanner = new ThinkScanner();
    const r1 = scanner.feed("hello<thi");
    const r2 = scanner.feed("nk>inside</think>after");
    expect(r1.text).toBe("hello");
    expect(r1.think).toBe("");
    expect(r2.text).toBe("after");
    expect(r2.think).toBe("inside");
  });

  it("handles closing tag split across chunks", () => {
    const scanner = new ThinkScanner();
    const r1 = scanner.feed("<think>reasoning</th");
    const r2 = scanner.feed("ink>visible");
    expect(r1.text).toBe("");
    expect(r1.think).toBe("reasoning");
    expect(r2.text).toBe("visible");
    expect(r2.think).toBe("");
  });

  it("handles unterminated <think> on flush", () => {
    const scanner = new ThinkScanner();
    const r1 = scanner.feed("before<think>still thinking");
    const r2 = scanner.flush();
    expect(r1.text).toBe("before");
    expect(r1.think).toBe("still thinking");
    expect(r2).toEqual({ text: "", think: "" });
  });

  it("flush emits buffered partial tag as text when outside think", () => {
    const scanner = new ThinkScanner();
    const r1 = scanner.feed("end<thi");
    const r2 = scanner.flush();
    expect(r1.text).toBe("end");
    expect(r2.text).toBe("<thi");
    expect(r2.think).toBe("");
  });

  it("returns empty for empty input", () => {
    const scanner = new ThinkScanner();
    expect(scanner.feed("")).toEqual({ text: "", think: "" });
    expect(scanner.flush()).toEqual({ text: "", think: "" });
  });

  it("handles angle brackets that are not think tags", () => {
    const scanner = new ThinkScanner();
    const result = scanner.feed("a < b > c <div>html</div>");
    expect(result).toEqual({ text: "a < b > c <div>html</div>", think: "" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test -- tests/core/think-scanner.test.ts`
Expected: FAIL — cannot resolve `../src/core/think-scanner.ts`

- [ ] **Step 3: Implement ThinkScanner**

```ts
// src/core/think-scanner.ts

import type { ThinkScanResult } from "../shared/types.ts";

const OPEN_TAG = "<think>";
const CLOSE_TAG = "</think>";

export class ThinkScanner {
  private buf = "";
  private inThink = false;

  feed(chunk: string): ThinkScanResult {
    let text = "";
    let think = "";
    const s = this.buf + chunk;
    this.buf = "";
    let i = 0;
    while (i < s.length) {
      const tag = this.inThink ? CLOSE_TAG : OPEN_TAG;
      const idx = s.indexOf(tag, i);
      if (idx !== -1) {
        const piece = s.slice(i, idx);
        if (this.inThink) think += piece;
        else text += piece;
        this.inThink = !this.inThink;
        i = idx + tag.length;
      } else {
        const keep = partialTagSuffix(s, i, tag);
        const piece = s.slice(i, s.length - keep);
        if (this.inThink) think += piece;
        else text += piece;
        this.buf = s.slice(s.length - keep);
        i = s.length;
      }
    }
    return { text, think };
  }

  flush(): ThinkScanResult {
    const rest = this.buf;
    this.buf = "";
    if (!rest) return { text: "", think: "" };
    return this.inThink ? { text: "", think: rest } : { text: rest, think: "" };
  }
}

function partialTagSuffix(s: string, from: number, tag: string): number {
  const tail = s.slice(from);
  const max = Math.min(tag.length - 1, tail.length);
  for (let k = max; k > 0; k--) {
    if (tail.endsWith(tag.slice(0, k))) return k;
  }
  return 0;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run test -- tests/core/think-scanner.test.ts`
Expected: all 9 tests PASS

- [ ] **Step 5: Run full check**

Run: `pnpm run check`
Expected: lint, typecheck, and tests all pass

- [ ] **Step 6: Commit**

```bash
git add src/core/think-scanner.ts tests/core/think-scanner.test.ts
git commit -m "feat: implement ThinkScanner for incremental <think> tag parsing"
```

---

### Task 3: cleanStream

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
  it("passes text-only stream through with leading whitespace trimmed", async () => {
    const base = createAssistantMessageEventStream();
    const partial = makePartial();
    const textBlock: TextContent = { type: "text", text: "" };
    partial.content.push(textBlock);

    pushEvents(base, [
      { type: "start", partial },
      { type: "text_start", contentIndex: 0, partial },
      { type: "text_delta", contentIndex: 0, delta: "  hello", partial },
      { type: "text_delta", contentIndex: 0, delta: " world", partial },
      { type: "text_end", contentIndex: 0, content: "  hello world", partial },
      { type: "done", reason: "stop", message: partial },
    ]);

    const out = cleanStream(base);
    const events = await collectEvents(out);
    const textDeltas = events.filter((e) => e.type === "text_delta");
    const combined = textDeltas
      .map((e) => (e.type === "text_delta" ? e.delta : ""))
      .join("");
    expect(combined).toBe("hello world");
  });

  it("strips <think> from text and re-routes to thinking when no structured thinking exists", async () => {
    const base = createAssistantMessageEventStream();
    const partial = makePartial();
    const textBlock: TextContent = { type: "text", text: "" };
    partial.content.push(textBlock);

    pushEvents(base, [
      { type: "start", partial },
      { type: "text_start", contentIndex: 0, partial },
      {
        type: "text_delta",
        contentIndex: 0,
        delta: "<think>reasoning</think>answer",
        partial,
      },
      {
        type: "text_end",
        contentIndex: 0,
        content: "<think>reasoning</think>answer",
        partial,
      },
      { type: "done", reason: "stop", message: partial },
    ]);

    const out = cleanStream(base);
    const events = await collectEvents(out);
    const thinkDeltas = events.filter((e) => e.type === "thinking_delta");
    const textDeltas = events.filter((e) => e.type === "text_delta");
    expect(thinkDeltas.length).toBeGreaterThan(0);
    expect(
      thinkDeltas
        .map((e) => (e.type === "thinking_delta" ? e.delta : ""))
        .join(""),
    ).toBe("reasoning");
    expect(
      textDeltas.map((e) => (e.type === "text_delta" ? e.delta : "")).join(""),
    ).toBe("answer");
  });

  it("drops <think> from text when structured thinking already exists", async () => {
    const base = createAssistantMessageEventStream();
    const partial = makePartial();
    const thinkBlock: ThinkingContent = { type: "thinking", thinking: "" };
    partial.content.push(thinkBlock);

    pushEvents(base, [
      { type: "start", partial },
      { type: "thinking_start", contentIndex: 0, partial },
      {
        type: "thinking_delta",
        contentIndex: 0,
        delta: "real reasoning",
        partial,
      },
      {
        type: "thinking_end",
        contentIndex: 0,
        content: "real reasoning",
        partial,
      },
      { type: "text_start", contentIndex: 1, partial },
      {
        type: "text_delta",
        contentIndex: 1,
        delta: "<think>duplicate</think>answer",
        partial,
      },
      {
        type: "text_end",
        contentIndex: 1,
        content: "<think>duplicate</think>answer",
        partial,
      },
      { type: "done", reason: "stop", message: partial },
    ]);

    const out = cleanStream(base);
    const events = await collectEvents(out);
    const thinkDeltas = events.filter((e) => e.type === "thinking_delta");
    const textDeltas = events.filter((e) => e.type === "text_delta");
    const thinkText = thinkDeltas
      .map((e) => (e.type === "thinking_delta" ? e.delta : ""))
      .join("");
    const visibleText = textDeltas
      .map((e) => (e.type === "text_delta" ? e.delta : ""))
      .join("");
    expect(thinkText).toBe("real reasoning");
    expect(visibleText).toBe("answer");
  });

  it("merges multiple thinking blocks into one", async () => {
    const base = createAssistantMessageEventStream();
    const partial = makePartial();
    const think1: ThinkingContent = { type: "thinking", thinking: "" };
    const think2: ThinkingContent = { type: "thinking", thinking: "" };
    partial.content.push(think1, think2);

    pushEvents(base, [
      { type: "start", partial },
      { type: "thinking_start", contentIndex: 0, partial },
      { type: "thinking_delta", contentIndex: 0, delta: "part one", partial },
      { type: "thinking_end", contentIndex: 0, content: "part one", partial },
      { type: "thinking_start", contentIndex: 1, partial },
      { type: "thinking_delta", contentIndex: 1, delta: "part two", partial },
      { type: "thinking_end", contentIndex: 1, content: "part two", partial },
      { type: "done", reason: "stop", message: partial },
    ]);

    const out = cleanStream(base);
    const events = await collectEvents(out);
    const thinkStarts = events.filter((e) => e.type === "thinking_start");
    const thinkEnds = events.filter((e) => e.type === "thinking_end");
    const thinkDeltas = events.filter((e) => e.type === "thinking_delta");
    expect(thinkStarts.length).toBe(1);
    expect(thinkEnds.length).toBe(1);
    const thinkText = thinkDeltas
      .map((e) => (e.type === "thinking_delta" ? e.delta : ""))
      .join("");
    expect(thinkText).toBe("part onepart two");
  });

  it("deduplicates re-streamed reasoning prefix", async () => {
    const base = createAssistantMessageEventStream();
    const partial = makePartial();
    const think1: ThinkingContent = { type: "thinking", thinking: "" };
    const think2: ThinkingContent = { type: "thinking", thinking: "" };
    partial.content.push(think1, think2);

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

    const out = cleanStream(base);
    const events = await collectEvents(out);
    const thinkDeltas = events.filter((e) => e.type === "thinking_delta");
    const thinkText = thinkDeltas
      .map((e) => (e.type === "thinking_delta" ? e.delta : ""))
      .join("");
    expect(thinkText).toBe("ABCDEF");
  });

  it("passes tool calls through with correct index remapping", async () => {
    const base = createAssistantMessageEventStream();
    const partial = makePartial();
    const thinkBlock: ThinkingContent = { type: "thinking", thinking: "" };
    const toolCall: ToolCall = {
      type: "toolCall",
      id: "tc1",
      name: "read",
      arguments: { path: "/foo" },
    };
    partial.content.push(thinkBlock, toolCall);

    pushEvents(base, [
      { type: "start", partial },
      { type: "thinking_start", contentIndex: 0, partial },
      { type: "thinking_delta", contentIndex: 0, delta: "planning", partial },
      { type: "thinking_end", contentIndex: 0, content: "planning", partial },
      { type: "toolcall_start", contentIndex: 1, partial },
      {
        type: "toolcall_delta",
        contentIndex: 1,
        delta: '{"path":"/foo"}',
        partial,
      },
      { type: "toolcall_end", contentIndex: 1, toolCall, partial },
      { type: "done", reason: "toolUse", message: partial },
    ]);

    const out = cleanStream(base);
    const events = await collectEvents(out);
    const toolStarts = events.filter((e) => e.type === "toolcall_start");
    const toolEnds = events.filter((e) => e.type === "toolcall_end");
    expect(toolStarts.length).toBe(1);
    expect(toolEnds.length).toBe(1);
    if (toolEnds[0].type === "toolcall_end") {
      expect(toolEnds[0].toolCall.name).toBe("read");
      expect(toolEnds[0].toolCall.arguments).toEqual({ path: "/foo" });
    }
  });

  it("propagates base stream errors", async () => {
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

    const out = cleanStream(base);
    const events = await collectEvents(out);
    const errors = events.filter((e) => e.type === "error");
    expect(errors.length).toBe(1);
    if (errors[0].type === "error") {
      expect(errors[0].error.errorMessage).toBe("upstream fail");
    }
  });

  it("done event carries cleaned message", async () => {
    const base = createAssistantMessageEventStream();
    const partial = makePartial();
    const textBlock: TextContent = { type: "text", text: "" };
    partial.content.push(textBlock);

    pushEvents(base, [
      { type: "start", partial },
      { type: "text_start", contentIndex: 0, partial },
      { type: "text_delta", contentIndex: 0, delta: "result", partial },
      { type: "text_end", contentIndex: 0, content: "result", partial },
      { type: "done", reason: "stop", message: partial },
    ]);

    const out = cleanStream(base);
    const events = await collectEvents(out);
    const done = events.find((e) => e.type === "done");
    expect(done).toBeDefined();
    if (done?.type === "done") {
      const textContent = done.message.content.filter(
        (c): c is TextContent => c.type === "text",
      );
      expect(textContent.length).toBe(1);
      expect(textContent[0].text).toBe("result");
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test -- tests/core/clean-stream.test.ts`
Expected: FAIL — cannot resolve `../src/core/clean-stream.ts`

- [ ] **Step 3: Implement cleanStream**

```ts
// src/core/clean-stream.ts

import type {
  AssistantMessage,
  AssistantMessageEvent,
  TextContent,
  ThinkingContent,
  ToolCall,
} from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { AssistantMessageEventStream } from "@earendil-works/pi-ai";
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

export function cleanStream(
  base: AssistantMessageEventStream,
): AssistantMessageEventStream {
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
        (output as Record<string, unknown>)[key] = (
          partial as Record<string, unknown>
        )[key];
      }
    };

    const ensureSegment = (): ThinkingSegment => {
      if (segment?.open) return segment;
      const block: ThinkingContent = { type: "thinking", thinking: "" };
      output!.content.push(block);
      segment = {
        block,
        index: output!.content.length - 1,
        open: true,
        text: "",
      };
      baseThinkingAccs.clear();
      out.push({
        type: "thinking_start",
        contentIndex: segment.index,
        partial: output!,
      });
      return segment;
    };

    const closeSegment = () => {
      if (!segment?.open) return;
      segment.open = false;
      segment.text = segment.text.trimEnd();
      segment.block.thinking = segment.text;
      if (segment.signature) {
        (
          segment.block as ThinkingContent & { thinkingSignature?: string }
        ).thinkingSignature = segment.signature;
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
      out.push({
        type: "thinking_delta",
        contentIndex: seg.index,
        delta,
        partial: output,
      });
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
        out.push({
          type: "text_start",
          contentIndex: state.index,
          partial: output,
        });
      }
      state.block.text += text;
      out.push({
        type: "text_delta",
        contentIndex: state.index,
        delta: text,
        partial: output,
      });
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
            if (
              segment &&
              baseBlock?.type === "thinking" &&
              baseBlock.thinkingSignature
            ) {
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
Expected: all 8 tests PASS

- [ ] **Step 5: Run full check**

Run: `pnpm run check`
Expected: lint, typecheck, and tests all pass

- [ ] **Step 6: Commit**

```bash
git add src/core/clean-stream.ts tests/core/clean-stream.test.ts
git commit -m "feat: implement cleanStream for thinking merge and <think> stripping"
```

---

### Task 4: Provider Factory

**Files:**

- Create: `src/providers/minimax-openai.ts`
- Test: `tests/providers/minimax-openai.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/providers/minimax-openai.test.ts

import { describe, expect, it, vi } from "vitest";
import {
  makeProvider,
  M3_MODEL_CONFIG,
  M3_COMPAT,
} from "../../src/providers/minimax-openai.ts";

describe("makeProvider", () => {
  it("registers a provider with the correct name and config", () => {
    const registerProvider = vi.fn();
    const mockPi = { registerProvider } as unknown as Parameters<
      typeof makeProvider
    >[0];

    makeProvider(
      mockPi,
      "minimax-openai",
      "https://api.minimax.io/v1",
      "$MINIMAX_API_KEY",
      "MiniMax (OpenAI)",
    );

    expect(registerProvider).toHaveBeenCalledOnce();
    const [name, config] = registerProvider.mock.calls[0];
    expect(name).toBe("minimax-openai");
    expect(config.baseUrl).toBe("https://api.minimax.io/v1");
    expect(config.apiKey).toBe("$MINIMAX_API_KEY");
    expect(config.name).toBe("MiniMax (OpenAI)");
    expect(typeof config.streamSimple).toBe("function");
    expect(config.models).toHaveLength(1);
    expect(config.models[0].id).toBe("MiniMax-M3");
  });

  it("model config has correct properties", () => {
    expect(M3_MODEL_CONFIG.id).toBe("MiniMax-M3");
    expect(M3_MODEL_CONFIG.name).toBe("MiniMax-M3");
    expect(M3_MODEL_CONFIG.reasoning).toBe(true);
    expect(M3_MODEL_CONFIG.input).toEqual(["text", "image"]);
    expect(M3_MODEL_CONFIG.contextWindow).toBe(1_000_000);
    expect(M3_MODEL_CONFIG.maxTokens).toBe(512_000);
    expect(M3_MODEL_CONFIG.cost.cacheWrite).toBe(0);
  });

  it("compat disables unsupported features", () => {
    expect(M3_COMPAT.supportsStore).toBe(false);
    expect(M3_COMPAT.supportsDeveloperRole).toBe(false);
    expect(M3_COMPAT.supportsReasoningEffort).toBe(false);
    expect(M3_COMPAT.maxTokensField).toBe("max_tokens");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test -- tests/providers/minimax-openai.test.ts`
Expected: FAIL — cannot resolve `../src/providers/minimax-openai.ts`

- [ ] **Step 3: Implement provider factory**

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
import type {
  ExtensionAPI,
  ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
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
    streamSimple(
      model: Model<Api>,
      context: Context,
      options?: SimpleStreamOptions,
    ): AssistantMessageEventStream {
      const driver = getApiProvider("openai-completions");
      if (!driver)
        throw new Error("openai-completions api provider not registered");
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
Expected: all 3 tests PASS

- [ ] **Step 5: Run full check**

Run: `pnpm run check`
Expected: lint, typecheck, and tests all pass

- [ ] **Step 6: Commit**

```bash
git add src/providers/minimax-openai.ts tests/providers/minimax-openai.test.ts
git commit -m "feat: add minimax-openai provider factory with M3 model config"
```

---

### Task 5: Extension Entry Point

**Files:**

- Modify: `src/index.ts`
- Modify: `tests/index.test.ts`

- [ ] **Step 1: Update the existing test file**

Replace the contents of `tests/index.test.ts` with:

```ts
// tests/index.test.ts

import { describe, expect, it, vi } from "vitest";
import createExtension from "../src/index.ts";

describe("providers extension", () => {
  it("exports a function", () => {
    expect(typeof createExtension).toBe("function");
  });

  it("registers minimax-openai and minimax-openai-cn providers", () => {
    const registerProvider = vi.fn();
    const mockPi = { registerProvider } as unknown as Parameters<
      typeof createExtension
    >[0];

    createExtension(mockPi);

    expect(registerProvider).toHaveBeenCalledTimes(2);
    const names = registerProvider.mock.calls.map((call: unknown[]) => call[0]);
    expect(names).toContain("minimax-openai");
    expect(names).toContain("minimax-openai-cn");
  });

  it("minimax-openai uses global endpoint", () => {
    const registerProvider = vi.fn();
    const mockPi = { registerProvider } as unknown as Parameters<
      typeof createExtension
    >[0];

    createExtension(mockPi);

    const globalCall = registerProvider.mock.calls.find(
      (call: unknown[]) => call[0] === "minimax-openai",
    );
    expect(globalCall).toBeDefined();
    expect(globalCall![1].baseUrl).toBe("https://api.minimax.io/v1");
    expect(globalCall![1].apiKey).toBe("$MINIMAX_API_KEY");
  });

  it("minimax-openai-cn uses CN endpoint", () => {
    const registerProvider = vi.fn();
    const mockPi = { registerProvider } as unknown as Parameters<
      typeof createExtension
    >[0];

    createExtension(mockPi);

    const cnCall = registerProvider.mock.calls.find(
      (call: unknown[]) => call[0] === "minimax-openai-cn",
    );
    expect(cnCall).toBeDefined();
    expect(cnCall![1].baseUrl).toBe("https://api.minimaxi.com/v1");
    expect(cnCall![1].apiKey).toBe("$MINIMAX_CN_API_KEY");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test -- tests/index.test.ts`
Expected: FAIL — `registerProvider` not called (current `src/index.ts` is empty)

- [ ] **Step 3: Implement extension entry**

Replace the contents of `src/index.ts` with:

```ts
// src/index.ts

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { makeProvider } from "./providers/minimax-openai.ts";

export default function createExtension(pi: ExtensionAPI): void {
  makeProvider(
    pi,
    "minimax-openai",
    "https://api.minimax.io/v1",
    "$MINIMAX_API_KEY",
    "MiniMax (OpenAI)",
  );
  makeProvider(
    pi,
    "minimax-openai-cn",
    "https://api.minimaxi.com/v1",
    "$MINIMAX_CN_API_KEY",
    "MiniMax CN (OpenAI)",
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run test -- tests/index.test.ts`
Expected: all 4 tests PASS

- [ ] **Step 5: Run full check**

Run: `pnpm run check`
Expected: lint, typecheck, and all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/index.ts tests/index.test.ts
git commit -m "feat: wire extension entry to register minimax-openai providers"
```

---

### Task 6: Final Verification and Cleanup

**Files:**

- Review all files for lint/type issues

- [ ] **Step 1: Run full check suite**

Run: `pnpm run check`
Expected: zero errors from lint, typecheck, and tests

- [ ] **Step 2: Verify test count**

Run: `pnpm run test`
Expected output should show test files:

- `tests/core/think-scanner.test.ts` — 9 tests
- `tests/core/clean-stream.test.ts` — 8 tests
- `tests/providers/minimax-openai.test.ts` — 3 tests
- `tests/index.test.ts` — 4 tests

Total: 24 tests, all passing.

- [ ] **Step 3: Review file structure matches spec**

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

If any formatting or lint fixes were applied:

```bash
git add -u
git commit -m "chore: apply formatting fixes"
```

---

## Notes for the Implementing Engineer

### Import paths

- `getApiProvider` is at `@earendil-works/pi-ai/compat` (subpath export), NOT the main `@earendil-works/pi-ai` package.
- `createAssistantMessageEventStream` is at the main `@earendil-works/pi-ai` package.
- All type imports from `@earendil-works/pi-ai` use the main package.
- `ExtensionAPI` and `ProviderModelConfig` are from `@earendil-works/pi-coding-agent`.

### TypeScript constraints

- Use erasable TypeScript syntax only (no enums, no parameter properties, no namespace).
- `tsconfig.json` has `allowImportingTsExtensions: true` — always use `.ts` extensions in relative imports.
- No inline/dynamic imports. All imports must be top-level.

### How `streamSimple` works

The custom `streamSimple` in the provider config is called by Pi when the user sends a message using this provider's model. It receives the full model object, conversation context, and options. It must return an `AssistantMessageEventStream` synchronously (the stream fills asynchronously). The stream is consumed by Pi's agent loop to render thinking, text, and tool calls.

### How `getApiProvider` works

`getApiProvider("openai-completions")` returns the built-in API provider implementation that handles raw HTTP/SSE communication with OpenAI-compatible endpoints. Its `streamSimple` method takes a model (with `api: "openai-completions"`) and does all the HTTP request construction, SSE parsing, and event emission. We override `model.api` when calling it because our provider registers with a custom API name to avoid conflicts.

### Environment variables

- `MINIMAX_API_KEY` — required for `minimax-openai` to appear in `/model`
- `MINIMAX_CN_API_KEY` — required for `minimax-openai-cn` to appear in `/model`

If the env var is unset, the provider is silently not shown. This is Pi's standard behavior.

### Testing without real API calls

All tests use mock data. No real MiniMax API calls are made. The `cleanStream` tests create mock `AssistantMessageEventStream` instances, push events into them, and assert on the output events. The provider tests mock `pi.registerProvider` and verify it was called with the right arguments.
