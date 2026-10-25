// tests/providers/minimax-openai.test.ts

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Model,
  ToolCall,
  ToolResultMessage,
  Usage,
} from "@earendil-works/pi-ai";
import {
  calculateCost,
  createAssistantMessageEventStream,
  getSupportedThinkingLevels,
} from "@earendil-works/pi-ai";
import { getApiProvider } from "@earendil-works/pi-ai/compat";
import { registerMiniMax } from "../../src/providers/minimax-openai.ts";

const MINIMAX_OPENAI_COMPAT = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
  maxTokensField: "max_completion_tokens" as const,
};

const MINIMAX_FLASH_COMPAT = {
  ...MINIMAX_OPENAI_COMPAT,
  supportsReasoningEffort: true,
};

const MINIMAX_M3_COST = {
  input: 0.3,
  output: 1.2,
  cacheRead: 0.06,
  cacheWrite: 0,
  tiers: [{ inputTokensAbove: 512_000, input: 0.6, output: 2.4, cacheRead: 0.12, cacheWrite: 0 }],
};

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

function usage(input: number, cacheRead = 0, output = 0): Usage {
  return { ...emptyUsage(), input, cacheRead, output, totalTokens: input + cacheRead + output };
}

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

  it("registers Flash first and M3 second with the curated contract", () => {
    const registerProvider = registerProviders();

    for (const id of ["minimax-openai", "minimax-openai-cn"]) {
      const config = registration(registerProvider, id);
      expect(config.models.map((model: { id: string }) => model.id)).toEqual([
        "MiniMax-M3.1-Flash",
        "MiniMax-M3",
      ]);

      expect(config.models[0]).toMatchObject({
        id: "MiniMax-M3.1-Flash",
        name: "MiniMax-M3.1-Flash",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 1_000_000,
        maxTokens: 524_288,
        cost: { input: 0.15, output: 0.6, cacheRead: 0.015, cacheWrite: 0 },
        compat: MINIMAX_FLASH_COMPAT,
        thinkingLevelMap: {
          off: null,
          minimal: null,
          low: "low",
          medium: "medium",
          high: "high",
          xhigh: "xhigh",
          max: "max",
        },
      });
      expect(config.models[0].cost).not.toHaveProperty("tiers");

      expect(config.models[1]).toMatchObject({
        id: "MiniMax-M3",
        name: "MiniMax-M3",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 1_000_000,
        maxTokens: 524_288,
        cost: MINIMAX_M3_COST,
        compat: MINIMAX_OPENAI_COMPAT,
      });
      expect(config.models[1].thinkingLevelMap).toBeUndefined();
      expect(config.models.some((model: { id: string }) => model.id.includes("M2.7"))).toBe(false);
    }
  });

  it("exposes the five Flash thinking levels", () => {
    const registerProvider = registerProviders();
    const config = registration(registerProvider, "minimax-openai");
    const flash: Model<Api> = {
      ...config.models[0],
      provider: "minimax-openai",
      api: "minimax-openai",
      baseUrl: config.baseUrl,
    };

    expect(getSupportedThinkingLevels(flash)).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });

  it("clones nested registration metadata per region", () => {
    const registerProvider = registerProviders();
    const global = registration(registerProvider, "minimax-openai");
    const china = registration(registerProvider, "minimax-openai-cn");

    expect(global.models[0]).not.toBe(china.models[0]);
    expect(global.models[0].cost).not.toBe(china.models[0].cost);
    expect(global.models[0].compat).not.toBe(china.models[0].compat);
    expect(global.models[0].input).not.toBe(china.models[0].input);
    expect(global.models[1].cost.tiers).not.toBe(china.models[1].cost.tiers);

    global.models[0].cost.input = 99;
    global.models[0].compat.supportsReasoningEffort = false;
    global.models[1].cost.tiers[0].input = 99;
    expect(china.models[0].cost.input).toBe(0.15);
    expect(china.models[0].compat.supportsReasoningEffort).toBe(true);
    expect(china.models[1].cost.tiers[0].input).toBe(0.6);
  });

  it("prices M3 request-wide above 512,000 input tokens", () => {
    const registerProvider = registerProviders();
    const config = registration(registerProvider, "minimax-openai");
    const m3: Model<Api> = {
      ...config.models[1],
      provider: "minimax-openai",
      api: "minimax-openai",
      baseUrl: config.baseUrl,
    };

    expect(calculateCost(m3, usage(512_000)).total).toBeCloseTo(0.1536);
    expect(calculateCost(m3, usage(512_001)).total).toBeCloseTo(0.3072006);

    const mixed = calculateCost(m3, usage(500_000, 12_001, 10));
    expect(mixed.input).toBeCloseTo(0.3);
    expect(mixed.cacheRead).toBeCloseTo(0.00144012);
    expect(mixed.output).toBeCloseTo(0.000024);
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
