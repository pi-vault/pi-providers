// tests/providers/minimax-openai/wire-replay.test.ts

import { describe, expect, it, vi } from "vitest";
import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Model,
  SimpleStreamOptions,
  ThinkingLevel,
  ToolCall,
  ToolResultMessage,
} from "@earendil-works/pi-ai";
import { normalizeContext } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ProviderConfig } from "@earendil-works/pi-coding-agent";
import { registerMiniMax } from "../../../src/providers/minimax-openai.ts";

const FLASH = "MiniMax-M3.1-Flash";
const M3 = "MiniMax-M3";
const REGIONS = [
  { provider: "minimax-openai", baseUrl: "https://api.minimax.io/v1", apiKey: "$MINIMAX_API_KEY" },
  {
    provider: "minimax-openai-cn",
    baseUrl: "https://api.minimaxi.com/v1",
    apiKey: "$MINIMAX_CN_API_KEY",
  },
] as const;

const FLASH_LEVELS: ThinkingLevel[] = ["low", "medium", "high", "xhigh", "max"];

const TOOL_USAGE = {
  prompt_tokens: 11,
  completion_tokens: 7,
  total_tokens: 18,
};

const CACHED_USAGE = {
  ...TOOL_USAGE,
  prompt_tokens_details: { cached_tokens: 3 },
};

type WireMessage = {
  role: string;
  content?: string | null;
  reasoning_content?: string;
  tool_calls?: { id: string; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
};

type WireBody = {
  model: string;
  messages: WireMessage[];
  max_completion_tokens?: number;
  max_tokens?: number;
  reasoning_effort?: string;
  thinking?: unknown;
  stream_options?: { include_usage: boolean };
};

function registerProviders(): Map<string, ProviderConfig> {
  const registrations = new Map<string, ProviderConfig>();
  const pi = {
    registerProvider(name: string, config: ProviderConfig) {
      registrations.set(name, config);
    },
  } as unknown as ExtensionAPI;
  registerMiniMax(pi);
  return registrations;
}

function registrationFor(registrations: Map<string, ProviderConfig>, provider: string) {
  const config = registrations.get(provider);
  if (!config) throw new Error(`Missing provider registration: ${provider}`);
  return config;
}

function streamSimpleFor(config: ProviderConfig) {
  const streamSimple = config.streamSimple;
  if (!streamSimple) throw new Error("Missing streamSimple registration");
  return streamSimple;
}

function modelFor(config: ProviderConfig, region: (typeof REGIONS)[number], id: string) {
  const model = config.models?.find((candidate) => candidate.id === id);
  if (!model) throw new Error(`Missing registered model: ${id}`);
  return {
    ...model,
    provider: region.provider,
    api: region.provider,
    baseUrl: config.baseUrl ?? region.baseUrl,
  } as Model<Api>;
}

function data(value: unknown): string {
  return `data: ${JSON.stringify(value)}\n\n`;
}

const DONE = "data: [DONE]\n\n";

function chunk(model: string, delta: Record<string, unknown>, finishReason: string | null = null) {
  return data({
    id: "chatcmpl-minimax-test",
    object: "chat.completion.chunk",
    created: 0,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  });
}

function usageChunk(model: string, usage = TOOL_USAGE) {
  return data({
    id: "chatcmpl-minimax-test",
    object: "chat.completion.chunk",
    created: 0,
    model,
    choices: [],
    usage,
  });
}

function sse(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function simpleResponse(model: string, usage = TOOL_USAGE): Response {
  return sse(
    [
      chunk(model, { reasoning_content: "thinking through" }),
      chunk(model, { content: "answer" }),
      chunk(model, {}, "stop"),
      usageChunk(model, usage),
      DONE,
    ].join(""),
  );
}

function toolResponse(model: string): Response {
  return sse(
    [
      chunk(model, { reasoning_content: " first \n" }),
      chunk(model, { reasoning_content: "second " }),
      chunk(model, {
        tool_calls: [
          {
            index: 0,
            id: "tool-a",
            type: "function",
            function: { name: "read", arguments: '{"path":"a"}' },
          },
        ],
      }),
      chunk(model, {
        tool_calls: [
          {
            index: 1,
            id: "tool-b",
            type: "function",
            function: { name: "bash", arguments: '{"command":"ls"}' },
          },
        ],
      }),
      chunk(model, {}, "tool_calls"),
      usageChunk(model),
      DONE,
    ].join(""),
  );
}

function interleavedResponse(model: string): Response {
  return sse(
    [
      chunk(model, { reasoning_content: "A" }),
      chunk(model, { content: "one" }),
      chunk(model, { reasoning_content: "B" }),
      chunk(model, { content: "two" }),
      chunk(model, {}, "stop"),
      usageChunk(model),
      DONE,
    ].join(""),
  );
}

type RunOptions = SimpleStreamOptions & {
  onPayload?: (payload: unknown, model: Model<Api>) => unknown | undefined | Promise<unknown>;
  onResponse?: (
    response: { status: number; headers: Record<string, string> },
    model: Model<Api>,
  ) => void;
};

async function runStream(
  config: ProviderConfig,
  model: Model<Api>,
  context: Context,
  response: () => Response,
  options: RunOptions = {},
) {
  let captured: Request | undefined;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    captured = new Request(input, init);
    return response();
  };

  const stream = streamSimpleFor(config)(model, normalizeContext(context), {
    apiKey: "test-key",
    fetch,
    maxRetries: 0,
    ...options,
  } as SimpleStreamOptions);
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) events.push(event);
  const result = await stream.result();
  if (!captured) throw new Error("No request captured");
  return { request: captured, events, result, body: (await captured.json()) as WireBody };
}

function terminalMessage(events: AssistantMessageEvent[]): AssistantMessage {
  const done = events.find((event) => event.type === "done");
  if (done?.type !== "done") throw new Error("Missing done event");
  return done.message;
}

function userContext(text = "hello", image = false): Context {
  return {
    messages: [
      {
        role: "user",
        content: image
          ? [
              { type: "text", text },
              { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
            ]
          : text,
        timestamp: Date.now(),
      },
    ],
  };
}

function toolResult(id: string, name: string): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: id,
    toolName: name,
    content: [{ type: "text", text: `result for ${id}` }],
    isError: false,
    timestamp: Date.now(),
  };
}

function assistantWireMessage(body: WireBody): WireMessage {
  const message = body.messages.find((candidate) => candidate.role === "assistant");
  if (!message) throw new Error("Missing assistant message");
  return message;
}

describe("MiniMax direct request controls", () => {
  it("sends exact Flash effort and output fields for both regions", async () => {
    const registrations = registerProviders();

    for (const region of REGIONS) {
      const config = registrationFor(registrations, region.provider);
      const flash = modelFor(config, region, FLASH);

      for (const level of FLASH_LEVELS) {
        const run = await runStream(config, flash, userContext(), () => simpleResponse(FLASH), {
          reasoning: level,
        });

        expect(run.request.url).toBe(`${region.baseUrl}/chat/completions`);
        expect(run.request.headers.get("authorization")).toBe("Bearer test-key");
        expect(run.body.model).toBe(FLASH);
        expect(run.body.max_completion_tokens).toBe(524_288);
        expect(run.body).not.toHaveProperty("max_tokens");
        expect(run.body.reasoning_effort).toBe(level);
        expect(run.body.stream_options).toEqual({ include_usage: true });
        expect(run.body).not.toHaveProperty("thinking");
        expect(JSON.stringify(run.body)).not.toContain('"none"');
        expect(run.result.stopReason).toBe("stop");
      }
    }
  });

  it("omits Flash effort by default and clamps minimal to low", async () => {
    const registrations = registerProviders();

    for (const region of REGIONS) {
      const config = registrationFor(registrations, region.provider);
      const flash = modelFor(config, region, FLASH);

      const omitted = await runStream(config, flash, userContext(), () => simpleResponse(FLASH));
      expect(omitted.body).not.toHaveProperty("reasoning_effort");
      expect(omitted.body.max_completion_tokens).toBe(524_288);

      const minimal = await runStream(config, flash, userContext(), () => simpleResponse(FLASH), {
        reasoning: "minimal",
      });
      expect(minimal.body.reasoning_effort).toBe("low");
    }
  });

  it("keeps M3 automatic, forwards image input, and reports usage", async () => {
    const registrations = registerProviders();

    for (const region of REGIONS) {
      const config = registrationFor(registrations, region.provider);
      const m3 = modelFor(config, region, M3);

      for (const reasoning of [undefined, "high"] as const) {
        const run = await runStream(
          config,
          m3,
          userContext("describe", true),
          () => simpleResponse(M3),
          {
            ...(reasoning ? { reasoning } : {}),
            maxTokens: 1234,
          },
        );

        expect(run.request.url).toBe(`${region.baseUrl}/chat/completions`);
        expect(run.body.model).toBe(M3);
        expect(run.body.max_completion_tokens).toBe(1234);
        expect(run.body).not.toHaveProperty("max_tokens");
        expect(run.body).not.toHaveProperty("reasoning_effort");
        expect(run.body).not.toHaveProperty("thinking");
        expect(JSON.stringify(run.body.messages)).toContain('"image_url"');
        expect(JSON.stringify(run.body.messages)).toContain("data:image/png;base64,aGVsbG8=");
        expect(run.result.stopReason).toBe("stop");
      }

      const result = await runStream(config, m3, userContext(), () =>
        simpleResponse(M3, CACHED_USAGE),
      );
      expect(result.result.usage).toMatchObject({
        input: 8,
        cacheRead: 3,
        output: 7,
        totalTokens: 18,
      });
      expect(result.result.stopReason).toBe("stop");
    }
  });
});

describe("MiniMax native reasoning replay", () => {
  for (const modelId of [FLASH, M3]) {
    it(`round-trips signed reasoning and tools for ${modelId}`, async () => {
      const registrations = registerProviders();

      for (const region of REGIONS) {
        const config = registrationFor(registrations, region.provider);
        const model = modelFor(config, region, modelId);
        const originalContext = userContext();
        const originalContextSnapshot = structuredClone(originalContext);

        const first = await runStream(config, model, originalContext, () => toolResponse(modelId));
        const firstMessage = terminalMessage(first.events);

        expect(firstMessage.stopReason).toBe("toolUse");
        expect(firstMessage.content[0]).toMatchObject({
          type: "thinking",
          thinking: " first \nsecond ",
          thinkingSignature: "reasoning_content",
        });

        const secondContext: Context = {
          messages: [
            ...originalContext.messages,
            firstMessage,
            toolResult("tool-b", "bash"),
            toolResult("tool-a", "read"),
          ],
        };
        const second = await runStream(config, model, secondContext, () => simpleResponse(modelId));
        const secondAssistant = assistantWireMessage(second.body);

        expect(secondAssistant.reasoning_content).toBe(" first \nsecond ");
        expect(secondAssistant.tool_calls?.map((call) => call.id)).toEqual(["tool-a", "tool-b"]);
        expect(
          second.body.messages
            .filter((message) => message.role === "tool")
            .map((message) => message.tool_call_id),
        ).toEqual(["tool-a", "tool-b"]);
        expect(firstMessage.content.filter((block) => block.type === "toolCall")).toHaveLength(2);
        expect(originalContext).toEqual(originalContextSnapshot);
      }
    });
  }

  it("replays legacy unsigned M3 thinking as ordered think-tagged content", async () => {
    const registrations = registerProviders();

    for (const region of REGIONS) {
      const config = registrationFor(registrations, region.provider);
      const m3 = modelFor(config, region, M3);
      const toolA: ToolCall = {
        type: "toolCall",
        id: "tool-a",
        name: "read",
        arguments: { path: "a" },
      };
      const toolB: ToolCall = {
        type: "toolCall",
        id: "tool-b",
        name: "bash",
        arguments: { command: "ls" },
      };
      const legacy: AssistantMessage = {
        role: "assistant",
        api: "openai-completions",
        provider: region.provider,
        model: M3,
        content: [
          { type: "thinking", thinking: " first " },
          { type: "text", text: "visible" },
          { type: "thinking", thinking: "second" },
          toolA,
          toolB,
        ],
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
      const stored = structuredClone(legacy);
      const context: Context = {
        messages: [legacy, toolResult("tool-b", "bash"), toolResult("tool-a", "read")],
      };

      const run = await runStream(config, m3, context, () => simpleResponse(M3));
      const assistant = assistantWireMessage(run.body);

      expect(assistant.content).toBe("<think> first </think>visible<think>second</think>");
      expect(assistant).not.toHaveProperty("reasoning_content");
      expect(assistant.tool_calls?.map((call) => call.id)).toEqual(["tool-a", "tool-b"]);
      expect(
        run.body.messages
          .filter((message) => message.role === "tool")
          .map((message) => message.tool_call_id),
      ).toEqual(["tool-a", "tool-b"]);
      expect(legacy).toEqual(stored);
    }
  });

  it("does not invent reasoning for tool-only legacy turns", async () => {
    const registrations = registerProviders();
    const region = REGIONS[0];
    const config = registrationFor(registrations, region.provider);
    const m3 = modelFor(config, region, M3);
    const tool: ToolCall = {
      type: "toolCall",
      id: "tool-a",
      name: "read",
      arguments: { path: "a" },
    };
    const assistant: AssistantMessage = {
      role: "assistant",
      api: "openai-completions",
      provider: region.provider,
      model: M3,
      content: [tool],
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

    const run = await runStream(
      config,
      m3,
      { messages: [assistant, toolResult("tool-a", "read")] },
      () => simpleResponse(M3),
    );
    const wire = assistantWireMessage(run.body);

    expect(wire).not.toHaveProperty("reasoning_content");
    expect(wire.content).toBeNull();
    expect(wire.tool_calls?.map((call) => call.id)).toEqual(["tool-a"]);
  });

  it("splits interleaved native reasoning and pins serializer behavior", async () => {
    const registrations = registerProviders();
    const region = REGIONS[0];
    const config = registrationFor(registrations, region.provider);
    const flash = modelFor(config, region, FLASH);

    const first = await runStream(config, flash, userContext(), () => interleavedResponse(FLASH));
    const firstMessage = terminalMessage(first.events);

    expect(
      firstMessage.content.map((block) =>
        block.type === "thinking"
          ? { type: block.type, thinking: block.thinking, signature: block.thinkingSignature }
          : block.type === "text"
            ? { type: block.type, text: block.text }
            : { type: block.type },
      ),
    ).toEqual([
      { type: "thinking", thinking: "A", signature: "reasoning_content" },
      { type: "text", text: "one" },
      { type: "thinking", thinking: "B", signature: "reasoning_content" },
      { type: "text", text: "two" },
    ]);

    const second = await runStream(
      config,
      flash,
      { messages: [...userContext().messages, firstMessage] },
      () => simpleResponse(FLASH),
    );
    const wire = assistantWireMessage(second.body);

    expect(wire.reasoning_content).toBe("A\nB");
    expect(wire.content).toBe("onetwo");
  });

  it.each([
    { before: "  hello ", after: " world  ", text: "hello  world" },
    {
      before: "```ts\n",
      after: "  const x = 1;\n```  ",
      text: "```ts\n  const x = 1;\n```",
    },
  ])("preserves visible whitespace around reasoning: $text", async ({ before, after, text }) => {
    const registrations = registerProviders();
    const region = REGIONS[0];
    const config = registrationFor(registrations, region.provider);
    const flash = modelFor(config, region, FLASH);
    const first = await runStream(config, flash, userContext(), () =>
      sse(
        [
          chunk(FLASH, { content: before }),
          chunk(FLASH, { reasoning_content: "check" }),
          chunk(FLASH, { content: after }),
          chunk(FLASH, {}, "stop"),
          usageChunk(FLASH),
          DONE,
        ].join(""),
      ),
    );
    const message = terminalMessage(first.events);
    expect(
      message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join(""),
    ).toBe(text);

    const second = await runStream(
      config,
      flash,
      { messages: [...userContext().messages, message] },
      () => simpleResponse(FLASH),
    );
    expect(assistantWireMessage(second.body).content).toBe(text);
  });

  it("runs payload and response hooks once against the builtin driver model", async () => {
    const registrations = registerProviders();
    const region = REGIONS[0];
    const config = registrationFor(registrations, region.provider);
    const flash = modelFor(config, region, FLASH);
    const onPayload = vi.fn((payload: unknown, model: Model<Api>) => {
      expect(model).toMatchObject({
        api: "openai-completions",
        provider: region.provider,
        id: FLASH,
      });
      return { ...(payload as Record<string, unknown>), distinct_field: "from-hook" };
    });
    const onResponse = vi.fn((response: { status: number }, model: Model<Api>) => {
      expect(response.status).toBe(200);
      expect(model).toMatchObject({
        api: "openai-completions",
        provider: region.provider,
        id: FLASH,
      });
    });

    const controller = new AbortController();
    const run = await runStream(config, flash, userContext(), () => simpleResponse(FLASH), {
      onPayload,
      onResponse,
      headers: { "x-test-header": "present" },
      signal: controller.signal,
    });

    expect(onPayload).toHaveBeenCalledTimes(1);
    expect(onResponse).toHaveBeenCalledTimes(1);
    expect((run.body as Record<string, unknown>).distinct_field).toBe("from-hook");
    expect(run.request.headers.get("x-test-header")).toBe("present");
    expect(run.request.signal.aborted).toBe(false);
    controller.abort();
    expect(run.request.signal.aborted).toBe(true);
  });

  it("ends a real-driver cancellation as aborted without a done event", async () => {
    const registrations = registerProviders();
    const region = REGIONS[0];
    const config = registrationFor(registrations, region.provider);
    const flash = modelFor(config, region, FLASH);
    const controller = new AbortController();
    controller.abort();

    const fetch: typeof globalThis.fetch = async () => {
      throw new DOMException("Aborted", "AbortError");
    };
    const stream = streamSimpleFor(config)(flash, normalizeContext(userContext()), {
      apiKey: "test-key",
      fetch,
      maxRetries: 0,
      signal: controller.signal,
    });
    const events: AssistantMessageEvent[] = [];
    for await (const event of stream) events.push(event);

    expect(events.some((event) => event.type === "done")).toBe(false);
    expect(events.some((event) => event.type === "error" && event.reason === "aborted")).toBe(true);
    expect((await stream.result()).stopReason).toBe("aborted");
  });
});

describe("MiniMax registration data", () => {
  it("keeps regional URLs and key expressions", () => {
    const registrations = registerProviders();
    for (const region of REGIONS) {
      const config = registrationFor(registrations, region.provider);
      expect(config.baseUrl).toBe(region.baseUrl);
      expect(config.apiKey).toBe(region.apiKey);
      expect(config.api).toBe(region.provider);
    }
  });
});
