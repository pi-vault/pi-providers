// tests/providers/minimax-openai/normalize-tool-results.test.ts

import { describe, expect, it } from "vitest";
import type {
  AssistantMessage,
  Context,
  ToolCall,
  ToolResultMessage,
  UserMessage,
} from "@earendil-works/pi-ai";
import { normalizeToolResults } from "../../../src/providers/minimax-openai/normalize-tool-results.ts";

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
    // Returns same reference when no changes needed
    expect(result).toBe(ctx);
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

  it("handles missing tool results gracefully", () => {
    const assistant = makeAssistant([
      makeToolCall("tc_a", "read"),
      makeToolCall("tc_b", "bash"),
      makeToolCall("tc_c", "grep"),
    ]);

    const ctx: Context = {
      messages: [
        makeUser("do things"),
        assistant,
        // tc_b result is missing (aborted)
        makeToolResult("tc_c", "grep"),
        makeToolResult("tc_a", "read"),
      ],
    };

    const result = normalizeToolResults(ctx);
    const results = result.messages.filter(
      (m): m is ToolResultMessage => m.role === "toolResult",
    );

    // Should reorder to match tool call order, with tc_b missing
    expect(results.map((r) => r.toolCallId)).toEqual(["tc_a", "tc_c"]);
  });

  it("passes through orphaned tool results unchanged", () => {
    const ctx: Context = {
      messages: [
        makeUser("some user message"),
        makeToolResult("tc_a", "read"),
        makeToolResult("tc_b", "bash"),
      ],
    };

    const result = normalizeToolResults(ctx);
    const results = result.messages.filter(
      (m): m is ToolResultMessage => m.role === "toolResult",
    );

    expect(results.map((r) => r.toolCallId)).toEqual(["tc_a", "tc_b"]);
    expect(result).toBe(ctx);
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
