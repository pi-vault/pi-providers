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
