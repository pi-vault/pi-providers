// tests/providers/minimax-openai.test.ts

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  ToolCall,
  ToolResultMessage,
} from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { getApiProvider } from "@earendil-works/pi-ai/compat";
import { registerMiniMax } from "../../src/providers/minimax-openai.ts";

vi.mock("@earendil-works/pi-ai/compat", () => ({
  getApiProvider: vi.fn(),
}));

describe("registerMiniMax", () => {
  function registerProviders() {
    const registerProvider = vi.fn();
    const mockPi = { registerProvider } as unknown as Parameters<typeof registerMiniMax>[0];

    registerMiniMax(mockPi);
    return registerProvider;
  }

  function registration(registerProvider: ReturnType<typeof vi.fn>, id: string) {
    return registerProvider.mock.calls.find(([name]) => name === id)?.[1];
  }

  it("registers global then China MiniMax variants", () => {
    const registerProvider = registerProviders();

    expect(registerProvider).toHaveBeenCalledTimes(2);
    expect(registerProvider.mock.calls.map(([id]) => id)).toEqual([
      "minimax-openai",
      "minimax-openai-cn",
    ]);

    const global = registration(registerProvider, "minimax-openai");
    const china = registration(registerProvider, "minimax-openai-cn");
    expect(global).toMatchObject({
      name: "MiniMax (OpenAI)",
      baseUrl: "https://api.minimax.io/v1",
      apiKey: "$MINIMAX_API_KEY",
      api: "minimax-openai",
    });
    expect(china).toMatchObject({
      name: "MiniMax CN (OpenAI)",
      baseUrl: "https://api.minimaxi.com/v1",
      apiKey: "$MINIMAX_CN_API_KEY",
      api: "minimax-openai-cn",
    });
  });

  it("provides a custom streamSimple function", () => {
    const registerProvider = registerProviders();

    const config = registration(registerProvider, "minimax-openai");
    expect(typeof config.streamSimple).toBe("function");
  });

  it("registers M3, M2.7, and M2.7-highspeed models with correct metadata", () => {
    const registerProvider = registerProviders();

    const config = registration(registerProvider, "minimax-openai");
    expect(config.models).toHaveLength(3);

    expect(config.models[0]).toMatchObject({
      id: "MiniMax-M3",
      name: "MiniMax-M3",
      reasoning: true,
      input: ["text", "image"],
      cost: { input: 0.6, output: 2.4, cacheRead: 0.12, cacheWrite: 0 },
      contextWindow: 1_000_000,
      maxTokens: 512_000,
      compat: {
        supportsStore: false,
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
        maxTokensField: "max_tokens",
      },
    });

    expect(config.models[1]).toMatchObject({
      id: "MiniMax-M2.7",
      name: "MiniMax-M2.7",
      reasoning: true,
      input: ["text"],
      cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0.375 },
      contextWindow: 204_800,
      maxTokens: 131_072,
      compat: {
        supportsStore: false,
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
        maxTokensField: "max_tokens",
      },
    });

    expect(config.models[2]).toMatchObject({
      id: "MiniMax-M2.7-highspeed",
      name: "MiniMax-M2.7-highspeed",
      reasoning: true,
      input: ["text"],
      cost: { input: 0.6, output: 2.4, cacheRead: 0.06, cacheWrite: 0.375 },
      contextWindow: 204_800,
      maxTokens: 131_072,
      compat: {
        supportsStore: false,
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
        maxTokensField: "max_tokens",
      },
    });
  });
});

describe("streamSimple pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function getStreamSimple() {
    const registerProvider = vi.fn();
    const mockPi = { registerProvider } as unknown as Parameters<typeof registerMiniMax>[0];
    registerMiniMax(mockPi);
    const [, config] = registerProvider.mock.calls[0];
    return config.streamSimple as (
      model: unknown,
      context: Context,
      options?: unknown,
    ) => AsyncIterable<AssistantMessageEvent>;
  }

  function makeMsg(content: AssistantMessage["content"] = []): AssistantMessage {
    return {
      role: "assistant",
      content,
      api: "openai-completions",
      provider: "test",
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

  function makeResult(id: string, name: string): ToolResultMessage {
    return {
      role: "toolResult",
      toolCallId: id,
      toolName: name,
      content: [{ type: "text", text: `result for ${id}` }],
      isError: false,
      timestamp: Date.now(),
    };
  }

  async function collectEvents(
    stream: AsyncIterable<AssistantMessageEvent>,
  ): Promise<AssistantMessageEvent[]> {
    const events: AssistantMessageEvent[] = [];
    for await (const ev of stream) events.push(ev);
    return events;
  }

  it("normalizes out-of-order tool results before passing context to driver", () => {
    const tc1: ToolCall = { type: "toolCall", id: "tc_a", name: "read", arguments: {} };
    const tc2: ToolCall = { type: "toolCall", id: "tc_b", name: "bash", arguments: {} };
    const context: Context = {
      messages: [makeMsg([tc1, tc2]), makeResult("tc_b", "bash"), makeResult("tc_a", "read")],
    };

    let capturedContext: Context | undefined;
    vi.mocked(getApiProvider).mockReturnValue({
      streamSimple: (_model: unknown, ctx: Context) => {
        capturedContext = ctx;
        return createAssistantMessageEventStream();
      },
    } as unknown as ReturnType<typeof getApiProvider>);

    const streamSimple = getStreamSimple();
    streamSimple({}, context, undefined);

    expect(capturedContext).toBeDefined();
    const msgs = capturedContext!.messages;
    expect((msgs[1] as ToolResultMessage).toolCallId).toBe("tc_a");
    expect((msgs[2] as ToolResultMessage).toolCallId).toBe("tc_b");
  });

  it("strips inline <think> tags via cleanStream in the pipeline", async () => {
    const base = createAssistantMessageEventStream();
    const msg = makeMsg();
    base.push({ type: "start", partial: msg });
    base.push({ type: "text_start", contentIndex: 0, partial: msg });
    base.push({
      type: "text_delta",
      contentIndex: 0,
      delta: "<think>hidden</think>visible",
      partial: msg,
    });
    base.push({
      type: "text_end",
      contentIndex: 0,
      content: "<think>hidden</think>visible",
      partial: msg,
    });
    base.push({ type: "done", reason: "stop", message: msg });

    vi.mocked(getApiProvider).mockReturnValue({ streamSimple: () => base } as unknown as ReturnType<
      typeof getApiProvider
    >);

    const streamSimple = getStreamSimple();
    const events = await collectEvents(streamSimple({}, { messages: [] } as Context, undefined));

    const allText = events
      .filter(
        (e): e is Extract<AssistantMessageEvent, { type: "text_delta" }> => e.type === "text_delta",
      )
      .map((e) => e.delta)
      .join("");
    expect(allText).toBe("visible");
  });

  it("repairs empty tool call arguments through the full pipeline", async () => {
    const brokenTool: ToolCall = { type: "toolCall", id: "tc_1", name: "read", arguments: {} };
    const msgWithTool = makeMsg([brokenTool]);
    const base = createAssistantMessageEventStream();
    base.push({ type: "start", partial: makeMsg() });
    base.push({ type: "toolcall_start", contentIndex: 0, partial: msgWithTool });
    base.push({
      type: "toolcall_delta",
      contentIndex: 0,
      delta: '{"path":"foo"}',
      partial: msgWithTool,
    });
    base.push({
      type: "toolcall_end",
      contentIndex: 0,
      toolCall: brokenTool,
      partial: msgWithTool,
    });
    base.push({ type: "done", reason: "toolUse", message: msgWithTool });

    vi.mocked(getApiProvider).mockReturnValue({ streamSimple: () => base } as unknown as ReturnType<
      typeof getApiProvider
    >);

    const streamSimple = getStreamSimple();
    const events = await collectEvents(streamSimple({}, { messages: [] } as Context, undefined));

    const toolcallEnd = events.find(
      (e): e is Extract<AssistantMessageEvent, { type: "toolcall_end" }> =>
        e.type === "toolcall_end",
    );
    expect(toolcallEnd).toBeDefined();
    expect(toolcallEnd!.toolCall.arguments).toEqual({ path: "foo" });
  });
});
