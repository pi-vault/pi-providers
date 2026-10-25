// tests/providers/minimax-openai/prepare-thinking-replay.test.ts

import { describe, expect, it } from "vitest";
import type {
  Api,
  AssistantMessage,
  Context,
  Model,
  TextContent,
  ThinkingContent,
  ToolCall,
  TranscriptContext,
  Usage,
} from "@earendil-works/pi-ai";
import { normalizeContext } from "@earendil-works/pi-ai";
import { prepareThinkingReplay } from "../../../src/providers/minimax-openai/prepare-thinking-replay.ts";

function emptyUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function model(
  provider = "minimax-openai",
  id = "MiniMax-M3",
  api: Api = "minimax-openai",
): Model<Api> {
  return {
    id,
    name: id,
    provider,
    api,
    baseUrl: "https://api.minimax.io/v1",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 524_288,
  };
}

function assistant(
  content: AssistantMessage["content"],
  overrides: Partial<AssistantMessage> = {},
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "minimax-openai",
    model: "MiniMax-M3",
    usage: emptyUsage(),
    stopReason: "toolUse",
    timestamp: 42,
    ...overrides,
  };
}

function text(value: string): TextContent {
  return { type: "text", text: value };
}

function thinking(value: string, extra: Partial<ThinkingContent> = {}): ThinkingContent {
  return { type: "thinking", thinking: value, ...extra };
}

function tool(id: string, name = "read"): ToolCall {
  return { type: "toolCall", id, name, arguments: { path: id } };
}

describe("prepareThinkingReplay", () => {
  it("wraps unsigned same-model OpenAI thinking at its original position", () => {
    const context: Context = {
      messages: [
        assistant([
          text("before"),
          thinking(" first \n"),
          tool("tool-a"),
          thinking("second"),
          tool("tool-b"),
        ]),
      ],
    };

    const result = prepareThinkingReplay(context, model());
    const content = (result.messages[0] as AssistantMessage).content;

    expect(content).toEqual([
      text("before"),
      text("<think> first \n</think>"),
      tool("tool-a"),
      text("<think>second</think>"),
      tool("tool-b"),
    ]);
    expect((result.messages[0] as AssistantMessage).responseId).toBeUndefined();
    expect(result.messages[0]).not.toBe(context.messages[0]);
  });

  it("wraps empty and whitespace-only unsigned thinking", () => {
    const context: Context = {
      messages: [assistant([thinking(""), thinking("  \n "), thinking("plain")])],
    };

    const result = prepareThinkingReplay(context, model());
    const content = (result.messages[0] as AssistantMessage).content;

    expect(content).toEqual([
      text("<think></think>"),
      text("<think>  \n </think>"),
      text("<think>plain</think>"),
    ]);
  });

  it("preserves signed and redacted thinking", () => {
    const signed = thinking("signed", { thinkingSignature: "reasoning_content" });
    const redacted = thinking("", { redacted: true, thinkingSignature: "opaque" });
    const context: Context = { messages: [assistant([signed, redacted, thinking("legacy")])] };

    const result = prepareThinkingReplay(context, model());

    expect((result.messages[0] as AssistantMessage).content).toEqual([
      signed,
      redacted,
      text("<think>legacy</think>"),
    ]);
  });

  it("converts both regions while preserving foreign provider, model, and API history", () => {
    const globalAssistant = assistant([thinking("global")]);
    const chinaAssistant = assistant([thinking("china")], {
      provider: "minimax-openai-cn",
    });
    const foreignProvider = assistant([thinking("foreign-provider")], {
      provider: "other-provider",
    });
    const foreignModel = assistant([thinking("foreign-model")], { model: "MiniMax-M3.1-Flash" });
    const foreignApi = assistant([thinking("foreign-api")], { api: "anthropic-messages" });

    const globalResult = prepareThinkingReplay(
      { messages: [globalAssistant] },
      model("minimax-openai"),
    );
    const chinaResult = prepareThinkingReplay(
      { messages: [chinaAssistant] },
      model("minimax-openai-cn"),
    );

    expect((globalResult.messages[0] as AssistantMessage).content).toEqual([
      text("<think>global</think>"),
    ]);
    expect((chinaResult.messages[0] as AssistantMessage).content).toEqual([
      text("<think>china</think>"),
    ]);

    for (const foreign of [foreignProvider, foreignModel, foreignApi]) {
      const context = { messages: [foreign] };
      expect(prepareThinkingReplay(context, model())).toBe(context);
    }
  });

  it("returns the input reference when nothing changes", () => {
    const context: Context = {
      messages: [
        assistant([
          thinking("signed", { thinkingSignature: "reasoning_content" }),
          text("<think>already text</think>"),
          tool("tool-a"),
        ]),
      ],
    };

    expect(prepareThinkingReplay(context, model())).toBe(context);
  });

  it("does not mutate input and reapplying is a no-op", () => {
    const context: Context = {
      messages: [
        assistant([text("before"), thinking("legacy"), tool("tool-a")], { responseId: "r1" }),
      ],
    };
    const snapshot = structuredClone(context);

    const once = prepareThinkingReplay(context, model());
    const twice = prepareThinkingReplay(once, model());

    expect(context).toEqual(snapshot);
    expect(twice).toBe(once);
    expect((once.messages[0] as AssistantMessage).responseId).toBe("r1");
  });

  it("preserves the normalized TranscriptContext type and content", () => {
    const context: TranscriptContext = normalizeContext({
      messages: [assistant([thinking("legacy")])],
    });

    const result = prepareThinkingReplay(context, model());

    expect(result.messages).toHaveLength(1);
    expect((result.messages[0] as AssistantMessage).content).toEqual([
      text("<think>legacy</think>"),
    ]);
  });
});
