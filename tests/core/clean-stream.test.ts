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
