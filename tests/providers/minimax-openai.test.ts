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
import { makeProvider, M3_MODEL_CONFIG, M3_COMPAT } from "../../src/providers/minimax-openai.ts";

vi.mock("@earendil-works/pi-ai/compat", () => ({
  getApiProvider: vi.fn(),
}));

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

describe("streamSimple pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function getStreamSimple() {
    const registerProvider = vi.fn();
    const mockPi = { registerProvider } as unknown as Parameters<typeof makeProvider>[0];
    makeProvider(mockPi, "test", "https://api.minimax.io/v1", "key", "Test");
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
    return { role: "toolResult", toolCallId: id, toolName: name, content: [{ type: "text", text: `result for ${id}` }], isError: false, timestamp: Date.now() };
  }

  async function collectEvents(stream: AsyncIterable<AssistantMessageEvent>): Promise<AssistantMessageEvent[]> {
    const events: AssistantMessageEvent[] = [];
    for await (const ev of stream) events.push(ev);
    return events;
  }

  it("normalizes out-of-order tool results before passing context to driver", () => {
    const tc1: ToolCall = { type: "toolCall", id: "tc_a", name: "read", arguments: {} };
    const tc2: ToolCall = { type: "toolCall", id: "tc_b", name: "bash", arguments: {} };
    const context: Context = { messages: [makeMsg([tc1, tc2]), makeResult("tc_b", "bash"), makeResult("tc_a", "read")] };

    let capturedContext: Context | undefined;
    vi.mocked(getApiProvider).mockReturnValue({
      streamSimple: (_model: unknown, ctx: Context) => { capturedContext = ctx; return createAssistantMessageEventStream(); },
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
    base.push({ type: "text_delta", contentIndex: 0, delta: "<think>hidden</think>visible", partial: msg });
    base.push({ type: "text_end", contentIndex: 0, content: "<think>hidden</think>visible", partial: msg });
    base.push({ type: "done", reason: "stop", message: msg });

    vi.mocked(getApiProvider).mockReturnValue({ streamSimple: () => base } as unknown as ReturnType<typeof getApiProvider>);

    const streamSimple = getStreamSimple();
    const events = await collectEvents(streamSimple({}, { messages: [] } as Context, undefined));

    const allText = events
      .filter((e): e is Extract<AssistantMessageEvent, { type: "text_delta" }> => e.type === "text_delta")
      .map((e) => e.delta).join("");
    expect(allText).toBe("visible");
  });

  it("repairs empty tool call arguments through the full pipeline", async () => {
    const brokenTool: ToolCall = { type: "toolCall", id: "tc_1", name: "read", arguments: {} };
    const msgWithTool = makeMsg([brokenTool]);
    const base = createAssistantMessageEventStream();
    base.push({ type: "start", partial: makeMsg() });
    base.push({ type: "toolcall_start", contentIndex: 0, partial: msgWithTool });
    base.push({ type: "toolcall_delta", contentIndex: 0, delta: '{"path":"foo"}', partial: msgWithTool });
    base.push({ type: "toolcall_end", contentIndex: 0, toolCall: brokenTool, partial: msgWithTool });
    base.push({ type: "done", reason: "toolUse", message: msgWithTool });

    vi.mocked(getApiProvider).mockReturnValue({ streamSimple: () => base } as unknown as ReturnType<typeof getApiProvider>);

    const streamSimple = getStreamSimple();
    const events = await collectEvents(streamSimple({}, { messages: [] } as Context, undefined));

    const toolcallEnd = events.find((e): e is Extract<AssistantMessageEvent, { type: "toolcall_end" }> => e.type === "toolcall_end");
    expect(toolcallEnd).toBeDefined();
    expect(toolcallEnd!.toolCall.arguments).toEqual({ path: "foo" });
  });
});
