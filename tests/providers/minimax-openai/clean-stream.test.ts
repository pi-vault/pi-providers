// tests/providers/minimax-openai/clean-stream.test.ts

import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  TextContent,
  ThinkingContent,
  ToolCall,
} from "@earendil-works/pi-ai";
import {
  createAssistantMessageEventStream,
  isRetryableAssistantError,
} from "@earendil-works/pi-ai";
import { cleanStream } from "../../../src/providers/minimax-openai/clean-stream.ts";

const leakedSentinel = "]<]minimax[>[<";
const postMarkerSecret = "secret-after-marker";

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

async function cleanTextDeltas(...deltas: string[]): Promise<AssistantMessageEvent[]> {
  const base = createAssistantMessageEventStream();
  const partial = makePartial([{ type: "text", text: "" } as TextContent]);
  const content = deltas.join("");

  pushEvents(base, [
    { type: "start", partial },
    { type: "text_start", contentIndex: 0, partial },
    ...deltas.map<AssistantMessageEvent>((delta) => ({
      type: "text_delta",
      contentIndex: 0,
      delta,
      partial,
    })),
    { type: "text_end", contentIndex: 0, content, partial },
    { type: "done", reason: "stop", message: partial },
  ]);

  return collectEvents(cleanStream(base));
}

function joinedTextDeltas(events: AssistantMessageEvent[]): string {
  return events
    .filter((event) => event.type === "text_delta")
    .map((event) => event.delta)
    .join("");
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
      partial.content.push({ type: "thinking", thinking: "" } as ThinkingContent, toolCall);

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
      partial.content.push({ type: "thinking", thinking: "" } as ThinkingContent, toolCall);

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

    it("catches exceptions thrown during iteration and emits error event", async () => {
      const throwingStream = {
        [Symbol.asyncIterator]() {
          return {
            next() {
              return Promise.reject(new Error("stream exploded"));
            },
          };
        },
      } as unknown as AssistantMessageEventStream;

      const events = await collectEvents(cleanStream(throwingStream));
      const errors = events.filter((e) => e.type === "error");
      expect(errors.length).toBe(1);
      if (errors[0].type === "error") {
        expect(errors[0].error.errorMessage).toBe("stream exploded");
        expect(errors[0].error.provider).toBe("unknown");
        expect(errors[0].error.model).toBe("unknown");
      }
    });

    it("uses output metadata if available when catching exceptions", async () => {
      const partial = makePartial();
      let callCount = 0;
      const throwAfterStartStream = {
        [Symbol.asyncIterator]() {
          return {
            next() {
              callCount++;
              if (callCount === 1) {
                return Promise.resolve({
                  value: { type: "start" as const, partial },
                  done: false,
                });
              }
              return Promise.reject(new Error("mid-stream crash"));
            },
          };
        },
      } as unknown as AssistantMessageEventStream;

      const events = await collectEvents(cleanStream(throwAfterStartStream));
      const errors = events.filter((e) => e.type === "error");
      expect(errors.length).toBe(1);
      if (errors[0].type === "error") {
        expect(errors[0].error.errorMessage).toBe("mid-stream crash");
        expect(errors[0].error.provider).toBe("minimax-openai");
        expect(errors[0].error.model).toBe("MiniMax-M3");
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
        const texts = done.message.content.filter((c): c is TextContent => c.type === "text");
        expect(texts.length).toBe(1);
        expect(texts[0].text).toBe("result");
      }
    });
  });

  describe("leaked tool-call markup", () => {
    afterEach(() => vi.restoreAllMocks());

    it("emits a retryable error and stops the stream when the sentinel is complete", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const leaked =
        `Preparing the edit. ${leakedSentinel}` +
        `<invoke name="write">${leakedSentinel}` +
        `<path>src/file.ts</path>${leakedSentinel}` +
        `</invoke>${postMarkerSecret}`;

      const events = await cleanTextDeltas(leaked);

      expect(events.map((event) => event.type)).toEqual([
        "start",
        "text_start",
        "text_delta",
        "text_end",
        "error",
      ]);
      expect(events.some((event) => event.type === "done")).toBe(false);
      expect(joinedTextDeltas(events)).toBe("Preparing the edit. ");

      const error = events.find((event) => event.type === "error");
      expect(error).toBeDefined();
      if (error?.type === "error") {
        const serialized = JSON.stringify(error.error);
        expect(serialized.includes(leakedSentinel)).toBe(false);
        expect(serialized.includes(postMarkerSecret)).toBe(false);
        expect(error.error.errorMessage).toBe(
          "MiniMax returned malformed tool-call markup. Please retry your request.",
        );
        expect(isRetryableAssistantError(error.error)).toBe(true);
      }

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith("[minimax-openai] leaked tool-call markup detected");
    });

    it("detects the sentinel split across text_delta boundaries", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const safePrefix = "safe<thi";

      for (let split = 1; split < leakedSentinel.length; split++) {
        const first = safePrefix + leakedSentinel.slice(0, split);
        const second = `${leakedSentinel.slice(split)}<invoke>${postMarkerSecret}`;
        const events = await cleanTextDeltas(first, second);

        expect(
          events.some((event) => event.type === "done"),
          `split=${split}`,
        ).toBe(false);
        expect(
          events.filter((event) => event.type === "error"),
          `split=${split}`,
        ).toHaveLength(1);
        expect(joinedTextDeltas(events), `split=${split}`).toBe(safePrefix);
      }
    });

    it("passes incomplete sentinel prefixes through unchanged", async () => {
      const events = await cleanTextDeltas("Hello world]<]mini");

      expect(joinedTextDeltas(events)).toBe("Hello world]<]mini");
      expect(events.at(-1)?.type).toBe("done");
      expect(events.some((event) => event.type === "error")).toBe(false);
    });

    it("catches the sentinel before ThinkScanner can re-route it", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const dangerous =
        `<think>reasoning${leakedSentinel}` + `<invoke name="x">${postMarkerSecret}`;

      const events = await cleanTextDeltas(dangerous);

      expect(events.some((event) => event.type === "done")).toBe(false);
      expect(events.some((event) => event.type === "error")).toBe(true);

      const serialized = JSON.stringify(events);
      expect(serialized.includes(leakedSentinel)).toBe(false);
      expect(serialized.includes(postMarkerSecret)).toBe(false);
    });
  });
});
