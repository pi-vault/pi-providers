import {
  createModels,
  InMemoryCredentialStore,
  InMemoryModelsStore,
  type Api,
  type Model,
  normalizeContext,
} from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import commandCodeModelsFixture from "../fixtures/command-code-models.json";
import {
  COMMAND_CODE_CATALOG,
  commandCodeModels,
  modelFromCatalogRecord,
} from "../../src/providers/command-code/models.ts";
import {
  createCommandCodeProvider,
  registerCommandCode,
} from "../../src/providers/command-code.ts";

const FLASH_MODEL_ID = "minimax/minimax-m3.1-flash";
const CHAT_ENDPOINTS = ["/messages", "/chat/completions", "/responses"] as const;

const fixtureChatRecords = commandCodeModelsFixture.data.filter((record) =>
  record.supported_endpoints.some((endpoint) =>
    CHAT_ENDPOINTS.includes(endpoint as (typeof CHAT_ENDPOINTS)[number]),
  ),
);

type CatalogProjectionRecord = {
  id: string;
  name: string;
  contextWindow: number;
  supportedEndpoints: readonly string[];
};

function catalogProjection(records: readonly CatalogProjectionRecord[]) {
  return records
    .map((record) => ({
      id: record.id,
      name: record.name,
      contextWindow: record.contextWindow,
      supportedEndpoints: [...record.supportedEndpoints],
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

const fixtureCatalogProjection = catalogProjection(
  fixtureChatRecords.map((record) => ({
    id: record.id,
    name: record.name,
    contextWindow: record.context_length,
    supportedEndpoints: record.supported_endpoints,
  })),
);

const validPayload = {
  object: "list",
  data: [
    {
      id: "new-model",
      name: "New Model",
      context_length: 32_000,
      max_output_tokens: 24_000,
      supported_endpoints: ["/chat/completions"],
    },
  ],
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status });
}

function cachedLiveOnlyModel(): Model<"openai-completions"> {
  return {
    id: "cached-live-only",
    name: "Cached Live Only",
    api: "openai-completions",
    provider: "command-code",
    baseUrl: "https://api.commandcode.ai/provider/v1",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32_000,
    maxTokens: 32_000,
  };
}

type CommandCodeTestStoredCatalog = {
  models: Model<Api>[];
  checkedAt?: number;
  commandCodeCatalogVersion?: number;
  commandCodeModelsUrl?: string;
};

async function writeCommandCodeCatalog(
  modelsStore: InMemoryModelsStore,
  entry: CommandCodeTestStoredCatalog,
) {
  await modelsStore.write("command-code", entry);
}

async function createRefreshModels(modelsStore = new InMemoryModelsStore()) {
  const credentials = new InMemoryCredentialStore();
  await credentials.modify("command-code", async () => ({ type: "api_key", key: "test-key" }));

  const models = createModels({ credentials, modelsStore });
  models.setProvider(createCommandCodeProvider());
  return { models, modelsStore };
}

async function createStoredRefreshModels(checkedAt = 0) {
  const modelsStore = new InMemoryModelsStore();
  const cached = cachedLiveOnlyModel();
  await modelsStore.write("command-code", { models: [cached], checkedAt });
  return { cached, ...(await createRefreshModels(modelsStore)) };
}

beforeEach(() => vi.stubEnv("CMD_ZDR", undefined));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function captureRequest(modelId: string): Promise<Request> {
  const provider = createCommandCodeProvider();
  const model = provider.getModels().find((candidate) => candidate.id === modelId);
  if (!model) throw new Error(`Missing test model: ${modelId}`);

  let captured: Request | undefined;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    captured = new Request(input, init);
    return new Response(
      JSON.stringify({ error: { type: "invalid_request_error", message: "test stop" } }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  };

  await provider
    .stream(
      model,
      normalizeContext({ messages: [{ role: "user", content: "hello", timestamp: Date.now() }] }),
      { apiKey: "test-key", fetch, maxRetries: 0 },
    )
    .result();

  if (!captured) throw new Error(`No request captured for: ${modelId}`);
  return captured;
}

type FlashEffort = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

function flashSseResponse(): Response {
  const chunk = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
  const base = {
    id: "chatcmpl-flash-test",
    object: "chat.completion.chunk",
    created: 0,
    model: FLASH_MODEL_ID,
  };
  const body = [
    chunk({
      ...base,
      choices: [
        { index: 0, delta: { reasoning_content: "thinking through" }, finish_reason: null },
      ],
    }),
    chunk({
      ...base,
      choices: [{ index: 0, delta: { content: "answer" }, finish_reason: null }],
    }),
    chunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }),
    chunk({
      ...base,
      choices: [],
      usage: {
        prompt_tokens: 11,
        completion_tokens: 7,
        total_tokens: 18,
        prompt_tokens_details: { cached_tokens: 3 },
      },
    }),
    "data: [DONE]\n\n",
  ].join("");

  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function flashContext() {
  return normalizeContext({
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "hello" },
          { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
        ],
        timestamp: Date.now(),
      },
    ],
  });
}

function flashFor(
  provider: ReturnType<typeof createCommandCodeProvider>,
  modelId = FLASH_MODEL_ID,
): Model<"openai-completions"> {
  const model = provider.getModels().find((candidate) => candidate.id === modelId);
  if (model?.api !== "openai-completions") {
    throw new Error(`Missing completions test model: ${modelId}`);
  }
  return model as Model<"openai-completions">;
}

async function runFlashStream(
  provider: ReturnType<typeof createCommandCodeProvider>,
  model: Model<"openai-completions">,
  mode: "stream" | "simple",
  options: { reasoningEffort?: FlashEffort; reasoning?: FlashEffort; maxTokens?: number } = {},
) {
  let captured: Request | undefined;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    captured = new Request(input, init);
    return flashSseResponse();
  };
  const shared = { apiKey: "test-key", fetch, maxRetries: 0 };
  const stream =
    mode === "stream"
      ? provider.stream(model, flashContext(), {
          ...shared,
          reasoningEffort: options.reasoningEffort,
          maxTokens: options.maxTokens,
        })
      : provider.streamSimple(model, flashContext(), {
          ...shared,
          reasoning: options.reasoning,
          maxTokens: options.maxTokens,
        });
  const result = await stream.result();

  if (!captured) throw new Error(`No request captured for: ${model.id}`);
  return { request: captured, result };
}

function expectFlashUsage(result: Awaited<ReturnType<typeof runFlashStream>>["result"]) {
  expect(result.usage).toMatchObject({
    input: 8,
    cacheRead: 3,
    output: 7,
    totalTokens: 18,
  });
  expect(result.content).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: "thinking", thinking: "thinking through" }),
      expect.objectContaining({ type: "text", text: "answer" }),
    ]),
  );
  expect(result.stopReason).toBe("stop");
}

function expectFlashRequestBody(body: Record<string, unknown>, effort?: string) {
  expect(body.model).toBe(FLASH_MODEL_ID);
  expect(body.max_tokens).toBe(32_768);
  expect(body).not.toHaveProperty("max_completion_tokens");
  expect(body.stream_options).toEqual({ include_usage: true });
  if (effort === undefined) {
    expect(body).not.toHaveProperty("reasoning_effort");
  } else {
    expect(body.reasoning_effort).toBe(effort);
  }
  expect(JSON.stringify(body.messages)).toContain("image_url");
}

describe("Command Code catalog conversion", () => {
  it("routes Claude records to Anthropic Messages", () => {
    expect(
      modelFromCatalogRecord({
        id: "claude-sonnet-5",
        name: "Claude Sonnet 5",
        contextWindow: 1_000_000,
        supportedEndpoints: ["/messages"],
      }),
    ).toMatchObject({
      id: "claude-sonnet-5",
      api: "anthropic-messages",
      provider: "command-code",
      contextWindow: 1_000_000,
    });
  });

  it("routes non-Claude records to OpenAI Completions", () => {
    expect(
      modelFromCatalogRecord({
        id: "deepseek/deepseek-v4-flash",
        name: "DeepSeek V4 Flash",
        contextWindow: 1_000_000,
        supportedEndpoints: ["/chat/completions"],
      }).api,
    ).toBe("openai-completions");
  });

  it("routes GPT records to OpenAI Responses when advertised", () => {
    expect(
      modelFromCatalogRecord({
        id: "gpt-6.1-sol",
        name: "GPT-6.1 Sol",
        contextWindow: 1_050_000,
        supportedEndpoints: ["/chat/completions", "/responses"],
      }).api,
    ).toBe("openai-responses");
  });

  it("uses conservative defaults for an unknown model", () => {
    expect(
      modelFromCatalogRecord({
        id: "new/vendor-model",
        name: "New Vendor Model",
        contextWindow: 32_000,
        supportedEndpoints: ["/chat/completions"],
      }),
    ).toMatchObject({
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      maxTokens: 32_000,
    });
  });

  it("uses Command Code output limits instead of donor limits", () => {
    expect(
      modelFromCatalogRecord({
        id: "deepseek/deepseek-v4.1-flash",
        name: "DeepSeek V4.1 Flash",
        contextWindow: 1_000_000,
        supportedEndpoints: ["/chat/completions", "/responses"],
      }).maxTokens,
    ).toBe(32_768);

    expect(
      modelFromCatalogRecord({
        id: "new/vendor-model",
        name: "New Vendor Model",
        contextWindow: 500_000,
        maxOutputTokens: 393_216,
        supportedEndpoints: ["/chat/completions"],
      }).maxTokens,
    ).toBe(393_216);

    expect(
      modelFromCatalogRecord({
        id: "new/vendor-model",
        name: "New Vendor Model",
        contextWindow: 16_000,
        maxOutputTokens: 32_768,
        supportedEndpoints: ["/chat/completions"],
      }).maxTokens,
    ).toBe(16_000);
  });

  it("routes a non-Claude ID to Anthropic Messages when /messages is declared", () => {
    expect(
      modelFromCatalogRecord({
        id: "vendor/message-model",
        name: "Message Model",
        contextWindow: 32_000,
        supportedEndpoints: ["/messages"],
      }).api,
    ).toBe("anthropic-messages");
  });

  it("routes a Claude-looking ID to OpenAI Completions when /chat/completions is declared", () => {
    expect(
      modelFromCatalogRecord({
        id: "claude-not-messages",
        name: "Claude-looking Chat Model",
        contextWindow: 32_000,
        supportedEndpoints: ["/chat/completions"],
      }).api,
    ).toBe("openai-completions");
  });

  it("prefers Anthropic Messages when both chat endpoints are declared", () => {
    expect(
      modelFromCatalogRecord({
        id: "vendor/both-endpoints",
        name: "Both Endpoints",
        contextWindow: 32_000,
        supportedEndpoints: ["/chat/completions", "/messages"],
      }).api,
    ).toBe("anthropic-messages");
  });

  it("bundles the captured Command Code catalog", () => {
    const addedIds = [
      "claude-haiku-5-5",
      "moonshotai/Kimi-K3.1-Pro",
      FLASH_MODEL_ID,
      "ornith/ornith-1.5-122b",
      "Qwen/Qwen3.8-Max-Prime",
      "google/gemini-4-argon",
      "nvidia/nemotron-3.5-super-vl",
      "stealth/glyph-cluster:free",
      "reflection/beam:free",
      "inclusionai/ling-3.1-flash",
      "meta/muse-spark-open",
      "meta/muse-wonder-1.0",
      "mistral/mistral-large-4",
    ];
    const removedIds = [
      "inclusionai/ling-3.0-flash-sante:free",
      "inclusionai/ling-3.1-flash:free",
      "stealth/pixel-canary",
      "stealth/space-bunny-alpha",
      "xiaomi/mimo-v2.5",
      "xiaomi/mimo-v2.5-pro",
    ];
    const ids = COMMAND_CODE_CATALOG.map((model) => model.id);

    expect(COMMAND_CODE_CATALOG).toHaveLength(93);
    expect(new Set(ids).size).toBe(93);
    expect(
      COMMAND_CODE_CATALOG.every(
        (model) =>
          model.id.trim().length > 0 &&
          model.name.trim().length > 0 &&
          Number.isInteger(model.contextWindow) &&
          model.contextWindow > 0 &&
          model.supportedEndpoints.length > 0 &&
          model.supportedEndpoints.every((endpoint) => typeof endpoint === "string"),
      ),
    ).toBe(true);
    expect(ids).toEqual(expect.arrayContaining(addedIds));
    expect(ids).not.toEqual(expect.arrayContaining(removedIds));
    expect(
      COMMAND_CODE_CATALOG.filter((model) => model.supportedEndpoints.includes("/messages")),
    ).toHaveLength(11);
    expect(
      COMMAND_CODE_CATALOG.filter(
        (model) =>
          model.supportedEndpoints.length === 1 &&
          model.supportedEndpoints[0] === "/chat/completions",
      ),
    ).toHaveLength(10);
    expect(
      COMMAND_CODE_CATALOG.filter(
        (model) =>
          model.supportedEndpoints.length === 2 &&
          model.supportedEndpoints.includes("/chat/completions") &&
          model.supportedEndpoints.includes("/responses"),
      ),
    ).toHaveLength(72);
    expect(COMMAND_CODE_CATALOG.find((model) => model.id === "gpt-5.5")?.contextWindow).toBe(
      400_000,
    );
    expect(
      COMMAND_CODE_CATALOG.find((model) => model.id === "stepfun/Step-3.5-Flash")?.contextWindow,
    ).toBe(262_144);
    expect(
      COMMAND_CODE_CATALOG.find((model) => model.id === "deepseek/deepseek-v4-pro")?.name,
    ).toBe("DeepSeek V4 Pro (latest)");
    expect(
      COMMAND_CODE_CATALOG.find((model) => model.id === "MiniMaxAI/MiniMax-M2.7"),
    ).toBeDefined();
    expect(commandCodeModels).toHaveLength(93);

    const zeroCostIds = new Set([
      "poolside/laguna-s-2.1-free",
      "stealth/glyph-cluster:free",
      "reflection/beam:free",
    ]);

    expect(
      commandCodeModels.every((model) => {
        if (zeroCostIds.has(model.id)) {
          return Object.values(model.cost).every((rate) =>
            Array.isArray(rate) ? true : rate === 0,
          );
        }
        return (
          model.cost.input > 0 &&
          model.cost.output > 0 &&
          [model.cost.input, model.cost.output, model.cost.cacheRead, model.cost.cacheWrite].every(
            (rate) => Number.isFinite(rate) && rate >= 0,
          )
        );
      }),
    ).toBe(true);
  });

  it("matches the captured fixture record for record", () => {
    expect(catalogProjection(COMMAND_CODE_CATALOG)).toEqual(fixtureCatalogProjection);
  });

  it("uses captured endpoints rather than inferred endpoint families", () => {
    const endpointsFor = (id: string) =>
      COMMAND_CODE_CATALOG.find((model) => model.id === id)?.supportedEndpoints;

    expect(endpointsFor("claude-haiku-5-5")).toEqual(["/messages"]);
    expect(endpointsFor(FLASH_MODEL_ID)).toEqual(["/chat/completions"]);
    expect(endpointsFor("mistral/mistral-large-4")).toEqual(["/chat/completions", "/responses"]);
    expect(endpointsFor("Qwen/Qwen3.8-Max-0902")).toEqual(["/chat/completions"]);
  });

  it("keeps paid Ling separate from retired free aliases", () => {
    const ling = COMMAND_CODE_CATALOG.find((model) => model.id === "inclusionai/ling-3.1-flash");

    expect(ling).toMatchObject({
      supportedEndpoints: ["/chat/completions"],
    });
    expect(
      modelFromCatalogRecord(ling ?? { id: "", name: "", contextWindow: 0, supportedEndpoints: [] })
        .cost,
    ).toEqual({ input: 0.3, output: 0.9, cacheRead: 0.06, cacheWrite: 0 });
    expect(COMMAND_CODE_CATALOG.map((model) => model.id)).not.toEqual(
      expect.arrayContaining([
        "inclusionai/ling-3.0-flash-sante:free",
        "inclusionai/ling-3.1-flash:free",
      ]),
    );
  });

  it("preserves Haiku context pricing tiers", () => {
    const model = COMMAND_CODE_CATALOG.find((record) => record.id === "claude-haiku-5-5");
    if (!model) throw new Error("Missing claude-haiku-5-5");

    expect(modelFromCatalogRecord(model).cost).toEqual({
      input: 0.1,
      output: 0.5,
      cacheRead: 0.01,
      cacheWrite: 0.125,
      tiers: [
        {
          inputTokensAbove: 100_000,
          input: 0.5,
          output: 2.5,
          cacheRead: 0.05,
          cacheWrite: 0.625,
        },
      ],
    });
    expect(
      modelFromCatalogRecord({ ...model, id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" }).cost,
    ).toMatchObject({ cacheRead: 0.1 });
  });

  it("uses Command’s stable and tiered pricing", () => {
    const costFor = (id: string) =>
      modelFromCatalogRecord({
        id,
        name: id,
        contextWindow: 1_000_000,
        supportedEndpoints: ["/chat/completions"],
      }).cost;

    const expectedCosts = {
      "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
      "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
      "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
      "claude-haiku-5-5": {
        input: 0.1,
        output: 0.5,
        cacheRead: 0.01,
        cacheWrite: 0.125,
        tiers: [
          {
            inputTokensAbove: 100_000,
            input: 0.5,
            output: 2.5,
            cacheRead: 0.05,
            cacheWrite: 0.625,
          },
        ],
      },
      "moonshotai/Kimi-K3.1-Pro": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 0 },
      "minimax/minimax-m3.1-flash": {
        input: 0.15,
        output: 0.6,
        cacheRead: 0.015,
        cacheWrite: 0,
      },
      "ornith/ornith-1.5-122b": { input: 0.16, output: 0.64, cacheRead: 0.02, cacheWrite: 0 },
      "Qwen/Qwen3.8-Max-Prime": { input: 4, output: 12, cacheRead: 0.5, cacheWrite: 5 },
      "google/gemini-4-argon": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 0 },
      "nvidia/nemotron-3.5-super-vl": {
        input: 0.2,
        output: 0.5,
        cacheRead: 0.04,
        cacheWrite: 0,
      },
      "stealth/glyph-cluster:free": { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      "reflection/beam:free": { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      "inclusionai/ling-3.1-flash": { input: 0.3, output: 0.9, cacheRead: 0.06, cacheWrite: 0 },
      "meta/muse-spark-open": { input: 1.25, output: 4.25, cacheRead: 0.15, cacheWrite: 0 },
      "meta/muse-wonder-1.0": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 0 },
      "mistral/mistral-large-4": { input: 1.36, output: 4.18, cacheRead: 0.14, cacheWrite: 0 },
      "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
      "gpt-6-astra": {
        input: 10,
        output: 50,
        cacheRead: 1,
        cacheWrite: 12.5,
        tiers: [{ inputTokensAbove: 272_000, input: 20, output: 75, cacheRead: 2, cacheWrite: 25 }],
      },
      "gpt-6.1-sol": {
        input: 2,
        output: 10,
        cacheRead: 0.1,
        cacheWrite: 2.5,
        tiers: [{ inputTokensAbove: 272_000, input: 4, output: 15, cacheRead: 0.2, cacheWrite: 5 }],
      },
      "gpt-6-sol": {
        input: 2,
        output: 10,
        cacheRead: 0.2,
        cacheWrite: 2.5,
        tiers: [{ inputTokensAbove: 272_000, input: 4, output: 15, cacheRead: 0.4, cacheWrite: 5 }],
      },
      "gpt-6-luna": {
        input: 0.1,
        output: 0.5,
        cacheRead: 0.01,
        cacheWrite: 0.125,
        tiers: [
          {
            inputTokensAbove: 272_000,
            input: 0.2,
            output: 0.75,
            cacheRead: 0.02,
            cacheWrite: 0.25,
          },
        ],
      },
      "gpt-5.6-sol": {
        input: 5,
        output: 30,
        cacheRead: 0.5,
        cacheWrite: 6.25,
        tiers: [
          { inputTokensAbove: 272_000, input: 10, output: 45, cacheRead: 1, cacheWrite: 12.5 },
        ],
      },
      "gpt-5.6-terra": {
        input: 2,
        output: 12,
        cacheRead: 0.2,
        cacheWrite: 2.5,
        tiers: [{ inputTokensAbove: 272_000, input: 4, output: 18, cacheRead: 0.4, cacheWrite: 5 }],
      },
      "gpt-5.6-luna": {
        input: 0.2,
        output: 1.2,
        cacheRead: 0.02,
        cacheWrite: 0.25,
        tiers: [
          { inputTokensAbove: 272_000, input: 0.4, output: 1.8, cacheRead: 0.04, cacheWrite: 0.5 },
        ],
      },
      "deepseek/deepseek-v4-pro": { input: 0.66, output: 1.98, cacheRead: 0.022, cacheWrite: 0 },
      "deepseek/deepseek-v4-flash": { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 },
      "deepseek/deepseek-v4-flash-vision-exp": {
        input: 0.15,
        output: 0.6,
        cacheRead: 0.003,
        cacheWrite: 0,
      },
      "deepseek/deepseek-v4-flash-fast": {
        input: 0.28,
        output: 0.56,
        cacheRead: 0.07,
        cacheWrite: 0,
      },
      "deepseek/deepseek-v4.1-flash": {
        input: 0.15,
        output: 0.6,
        cacheRead: 0.003,
        cacheWrite: 0,
      },
      "deepseek/deepseek-v4.1-flash-fast": {
        input: 0.16,
        output: 0.58,
        cacheRead: 0.016,
        cacheWrite: 0,
      },
      "MiniMaxAI/MiniMax-M3": { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 },
      "z-ai/glm-5.3-flashx": { input: 0.37, output: 1.25, cacheRead: 0.075, cacheWrite: 0 },
      "xiaomi/mimo-v2.6-pro": { input: 0.435, output: 0.87, cacheRead: 0.0036, cacheWrite: 0 },
      "xiaomi/mimo-v2.6-pro-ultraspeed": {
        input: 4.35,
        output: 8.7,
        cacheRead: 0.036,
        cacheWrite: 0,
      },
      "xiaomi/mimo-v2.6-flash": { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 },
      "Qwen/Qwen3.8-Omni-Flash": { input: 0.15, output: 0.47, cacheRead: 0.016, cacheWrite: 0 },
      "Qwen/Qwen3.8-Max-0902": { input: 2, output: 6, cacheRead: 0.25, cacheWrite: 0 },
      "z-ai/glm-5.3-flash": { input: 0.15, output: 0.5, cacheRead: 0.03, cacheWrite: 0 },
      "zai-org/GLM-5.3": { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
      "Qwen/Qwen3.8-27B": { input: 0.4, output: 3, cacheRead: 0.04, cacheWrite: 0 },
      "Qwen/Qwen3.8-Flash": { input: 0.16, output: 0.47, cacheRead: 0.016, cacheWrite: 0 },
      "Qwen/Qwen3.7-Plus": {
        input: 0.4,
        output: 1.6,
        cacheRead: 0.08,
        cacheWrite: 0.5,
        tiers: [
          { inputTokensAbove: 256_000, input: 1.2, output: 4.8, cacheRead: 0.24, cacheWrite: 1.5 },
        ],
      },
      "Qwen/Qwen3.7-Flash": {
        input: 0.03,
        output: 0.13,
        cacheRead: 0.006,
        cacheWrite: 0.038,
        tiers: [
          { inputTokensAbove: 32_000, input: 0.1, output: 0.4, cacheRead: 0.02, cacheWrite: 0.125 },
          { inputTokensAbove: 256_000, input: 0.2, output: 0.8, cacheRead: 0.04, cacheWrite: 0.25 },
        ],
      },
      "meituan/LongCat-2.0": { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 },
      "stepfun/Step-5-Preview": { input: 1, output: 2.7, cacheRead: 0.05, cacheWrite: 0 },
      "stepfun/Step-3.5-Flash": { input: 0.09, output: 0.3, cacheRead: 0.02, cacheWrite: 0 },
      "tencent/hy4-preview": { input: 0.834, output: 2.501, cacheRead: 0.042, cacheWrite: 0 },
      "google/gemini-3.8-flash": { input: 1.5, output: 7.5, cacheRead: 0.15, cacheWrite: 0 },
      "google/gemini-3.7-flash": {
        input: 1.5,
        output: 7.5,
        cacheRead: 0.15,
        cacheWrite: 0.08334,
      },
      "meta/muse-spark-1.3": { input: 1.25, output: 4.25, cacheRead: 0.15, cacheWrite: 0 },
      "meta/muse-spark-1.3-contributor": {
        input: 0.1,
        output: 0.2,
        cacheRead: 0.002,
        cacheWrite: 0,
      },
      "xai/grok-4.6": {
        input: 2,
        output: 6,
        cacheRead: 0.5,
        cacheWrite: 0,
        tiers: [{ inputTokensAbove: 200_000, input: 4, output: 12, cacheRead: 1, cacheWrite: 0 }],
      },
      "xai/grok-4.7": {
        input: 2,
        output: 6,
        cacheRead: 0.5,
        cacheWrite: 0,
        tiers: [{ inputTokensAbove: 200_000, input: 4, output: 12, cacheRead: 1, cacheWrite: 0 }],
      },
    };

    for (const [id, expected] of Object.entries(expectedCosts)) {
      expect(costFor(id), id).toEqual(expected);
    }
  });

  it("uses donor metadata when live capability metadata is absent", () => {
    expect(
      modelFromCatalogRecord({
        id: "claude-sonnet-5",
        name: "Command Claude",
        contextWindow: 900_000,
        supportedEndpoints: ["/messages"],
      }),
    ).toMatchObject({
      name: "Command Claude",
      contextWindow: 900_000,
      reasoning: true,
      input: ["text", "image"],
      maxTokens: 32_768,
      cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
      thinkingLevelMap: { xhigh: "xhigh", max: "max" },
      compat: { forceAdaptiveThinking: true },
    });
  });

  it("prefers Command Code metadata over donor and bundled metadata", () => {
    expect(
      modelFromCatalogRecord({
        id: "claude-sonnet-5",
        name: "Command Claude",
        contextWindow: 1_000_000,
        supportedEndpoints: ["/messages"],
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      }),
    ).toMatchObject({
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    });
  });

  it("uses official capability defaults when no Pi donor exists", () => {
    expect(
      modelFromCatalogRecord({
        id: "gpt-future",
        name: "GPT Future",
        contextWindow: 100_000,
        supportedEndpoints: ["/responses"],
      }),
    ).toMatchObject({ reasoning: true, input: ["text", "image"] });

    expect(
      modelFromCatalogRecord({
        id: "vendor/future",
        name: "Vendor Future",
        contextWindow: 100_000,
        supportedEndpoints: ["/chat/completions"],
      }),
    ).toMatchObject({ reasoning: true, input: ["text"] });
  });

  it("forces adaptive thinking for future Claude families without a donor", () => {
    expect(
      modelFromCatalogRecord({
        id: "claude-mythos-5",
        name: "Claude Mythos 5",
        contextWindow: 1_000_000,
        supportedEndpoints: ["/messages"],
      }),
    ).toMatchObject({ compat: { forceAdaptiveThinking: true } });
  });

  it.each([
    ["deepseek/deepseek-v4-flash-vision-exp", "DeepSeek V4 Flash Vision (exp)", 1_000_000, 32_768],
    ["z-ai/glm-5.3-flash", "GLM-5.3 Flash", 1_048_576, 32_768],
    ["Qwen/Qwen3.8-27B", "Qwen 3.8 27B", 262_144, 32_768],
    ["Qwen/Qwen3.8-Flash", "Qwen 3.8 Flash", 1_000_000, 32_768],
    ["google/gemini-3.7-flash", "Gemini 3.7 Flash", 1_048_576, 32_768],
    ["xai/grok-4.6", "Grok 4.6", 500_000, 32_768],
  ])(
    "uses Pi metadata for current live vision models: %s",
    (id, name, contextWindow, maxTokens) => {
      expect(
        modelFromCatalogRecord({
          id,
          name,
          contextWindow,
          supportedEndpoints: ["/chat/completions"],
        }),
        id,
      ).toMatchObject({
        reasoning: true,
        input: ["text", "image"],
        maxTokens,
      });
    },
  );

  it("falls back to a normalized display-name match", () => {
    expect(
      modelFromCatalogRecord({
        id: "Qwen/Qwen3.7-Flash",
        name: "Qwen 3.7 Flash",
        contextWindow: 200_000,
        supportedEndpoints: ["/chat/completions"],
      }),
    ).toMatchObject({
      reasoning: true,
      input: ["text", "image"],
      maxTokens: 32_768,
    });
  });

  it("creates a provider with all API families", () => {
    const provider = createCommandCodeProvider();

    expect(provider).toMatchObject({
      id: "command-code",
      name: "Command Code",
      baseUrl: "https://api.commandcode.ai/provider/v1",
    });
    expect(provider.getModels()).toHaveLength(93);
    expect(new Set(provider.getModels().map((model) => model.api))).toEqual(
      new Set(["anthropic-messages", "openai-completions", "openai-responses"]),
    );
    expect(provider.refreshModels).toBeTypeOf("function");
    expect(provider.auth.apiKey?.name).toBe("Command Code API key");
  });

  async function resolveApiKey(env: Record<string, string | undefined>) {
    const apiKey = createCommandCodeProvider().auth.apiKey;
    return apiKey?.resolve({
      ctx: {
        env: async (name) => env[name],
        fileExists: async () => false,
      },
      signal: new AbortController().signal,
    });
  }

  it("resolves CMD_API_KEY authentication", async () => {
    await expect(resolveApiKey({ CMD_API_KEY: "primary" })).resolves.toMatchObject({
      auth: { apiKey: "primary" },
      source: "CMD_API_KEY",
    });
  });

  it("resolves COMMAND_CODE_API_KEY authentication", async () => {
    await expect(resolveApiKey({ COMMAND_CODE_API_KEY: "alias" })).resolves.toMatchObject({
      auth: { apiKey: "alias" },
      source: "COMMAND_CODE_API_KEY",
    });
  });

  it("prefers CMD_API_KEY over COMMAND_CODE_API_KEY", async () => {
    await expect(
      resolveApiKey({ CMD_API_KEY: "primary", COMMAND_CODE_API_KEY: "alias" }),
    ).resolves.toMatchObject({
      auth: { apiKey: "primary" },
      source: "CMD_API_KEY",
    });
  });

  it("adds model ZDR headers only when CMD_ZDR is 1", () => {
    const modelsUseZdr = () => {
      const models = createCommandCodeProvider().getModels();
      expect(models).not.toHaveLength(0);
      return models.every((model) => model.headers?.["x-cmd-zdr"] === "1");
    };

    expect(modelsUseZdr()).toBe(false);

    vi.stubEnv("CMD_ZDR", "true");
    expect(modelsUseZdr()).toBe(false);

    vi.stubEnv("CMD_ZDR", "1");
    expect(modelsUseZdr()).toBe(true);
  });

  it("sends ZDR and authentication headers through both API families", async () => {
    vi.stubEnv("CMD_ZDR", "1");

    const openAI = await captureRequest("deepseek/deepseek-v4-flash");
    expect(openAI.url).toBe("https://api.commandcode.ai/provider/v1/chat/completions");
    expect(openAI.headers.get("authorization")).toBe("Bearer test-key");
    expect(openAI.headers.get("x-cmd-zdr")).toBe("1");

    const anthropic = await captureRequest("claude-sonnet-5");
    expect(new URL(anthropic.url).pathname).toBe("/provider/v1/messages");
    expect(anthropic.headers.get("x-api-key")).toBe("test-key");
    expect(anthropic.headers.get("x-cmd-zdr")).toBe("1");

    const responses = await captureRequest("gpt-6.1-sol");
    expect(responses.url).toBe("https://api.commandcode.ai/provider/v1/responses");
    expect(responses.headers.get("authorization")).toBe("Bearer test-key");
    expect(responses.headers.get("x-cmd-zdr")).toBe("1");
  });
});

describe("Command Code registration", () => {
  it("registers the native Command Code provider", () => {
    const registerProvider = vi.fn();
    const pi = { registerProvider } as unknown as Parameters<typeof registerCommandCode>[0];

    registerCommandCode(pi);

    expect(registerProvider).toHaveBeenCalledOnce();
    expect(registerProvider.mock.calls[0]?.[0]).toMatchObject({
      id: "command-code",
    });
  });
});

describe("Command Code Flash inference", () => {
  const efforts = ["low", "medium", "high", "xhigh", "max"] as const;

  it.each(efforts)("sends raw Flash reasoning effort %s", async (effort) => {
    const provider = createCommandCodeProvider();
    const flash = flashFor(provider);
    const { request, result } = await runFlashStream(provider, flash, "stream", {
      reasoningEffort: effort,
      maxTokens: flash.maxTokens,
    });

    expect(request.url).toBe("https://api.commandcode.ai/provider/v1/chat/completions");
    expectFlashRequestBody((await request.json()) as Record<string, unknown>, effort);
    expectFlashUsage(result);
  });

  it.each(efforts)("sends simple Flash reasoning %s with the model output cap", async (effort) => {
    const provider = createCommandCodeProvider();
    const { request, result } = await runFlashStream(provider, flashFor(provider), "simple", {
      reasoning: effort,
    });

    expect(request.url).toBe("https://api.commandcode.ai/provider/v1/chat/completions");
    expectFlashRequestBody((await request.json()) as Record<string, unknown>, effort);
    expectFlashUsage(result);
  });

  it("clamps simple Flash minimal reasoning to low", async () => {
    const provider = createCommandCodeProvider();
    const { request, result } = await runFlashStream(provider, flashFor(provider), "simple", {
      reasoning: "minimal",
    });

    expectFlashRequestBody((await request.json()) as Record<string, unknown>, "low");
    expectFlashUsage(result);
  });

  it("omits Flash effort when simple reasoning is omitted", async () => {
    const provider = createCommandCodeProvider();
    const { request, result } = await runFlashStream(provider, flashFor(provider), "simple");

    expectFlashRequestBody((await request.json()) as Record<string, unknown>);
    expectFlashUsage(result);
  });

  it("sends no effort for a non-Flash Completions model", async () => {
    const provider = createCommandCodeProvider();
    const model = flashFor(provider, "deepseek/deepseek-v4-flash");
    expect(model.compat?.supportsReasoningEffort).toBe(false);

    const { request, result } = await runFlashStream(provider, model, "stream", {
      reasoningEffort: "high",
      maxTokens: model.maxTokens,
    });
    const body = (await request.json()) as Record<string, unknown>;

    expect(body.model).toBe("deepseek/deepseek-v4-flash");
    expect(body).not.toHaveProperty("reasoning_effort");
    expect(body.max_tokens).toBe(32_768);
    expectFlashUsage(result);
  });

  it("streams refreshed Flash with its local controls", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(commandCodeModelsFixture));
    const { models } = await createRefreshModels();
    const result = await models.refresh({ providers: ["command-code"], force: true });
    expect(result.errors.size).toBe(0);

    const provider = models.getProvider("command-code") as ReturnType<
      typeof createCommandCodeProvider
    >;
    const flash = flashFor(provider);
    const streamed = await runFlashStream(provider, flash, "stream", {
      reasoningEffort: "max",
      maxTokens: flash.maxTokens,
    });

    expectFlashRequestBody((await streamed.request.json()) as Record<string, unknown>, "max");
    expectFlashUsage(streamed.result);
  });
});

describe("Command Code live catalog", () => {
  it("publishes models whose IDs match inherited object properties", async () => {
    const ids = ["constructor", "toString", "__proto__"];
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        object: "list",
        data: ids.map((id) => ({
          id,
          name: "Unknown Gateway Model",
          context_length: 32_000,
          supported_endpoints: ["/chat/completions"],
        })),
      }),
    );
    const { models, modelsStore } = await createRefreshModels();

    const result = await models.refresh({ providers: ["command-code"], force: true });

    expect(result.errors.size).toBe(0);
    expect(models.getModels("command-code").map((model) => model.id)).toEqual(ids);
    expect((await modelsStore.read("command-code"))?.models).toEqual(
      ids.map((id) =>
        expect.objectContaining({
          id,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        }),
      ),
    );
  });

  it("fetches the default Command Code models URL", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(validPayload));
    const { models } = await createRefreshModels();

    await models.refresh({ providers: ["command-code"], force: true });

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[0]).toBe("https://api.commandcode.ai/provider/v1/models");
  });

  it("uses the default models URL for a blank CMD_MODELS_URL", async () => {
    vi.stubEnv("CMD_MODELS_URL", "  ");
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(validPayload));
    const { models } = await createRefreshModels();

    await models.refresh({ providers: ["command-code"], force: true });

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[0]).toBe("https://api.commandcode.ai/provider/v1/models");
  });

  it("fetches a configured CMD_MODELS_URL despite a fresh cache from another source", async () => {
    const configuredUrl = "https://catalog.example.test/models";
    vi.stubEnv("CMD_MODELS_URL", configuredUrl);
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(validPayload));
    const modelsStore = new InMemoryModelsStore();
    await writeCommandCodeCatalog(modelsStore, {
      models: [cachedLiveOnlyModel()],
      checkedAt: Date.now(),
      commandCodeCatalogVersion: 1,
      commandCodeModelsUrl: "https://api.commandcode.ai/provider/v1/models",
    });
    const { models } = await createRefreshModels(modelsStore);

    await models.refresh({ providers: ["command-code"] });

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[0]).toBe(configuredUrl);
    expect(
      (await modelsStore.read("command-code")) as CommandCodeTestStoredCatalog | undefined,
    ).toMatchObject({ commandCodeModelsUrl: configuredUrl });
  });

  it("throttles a fresh cache from the configured source", async () => {
    const configuredUrl = "https://catalog.example.test/models";
    vi.stubEnv("CMD_MODELS_URL", configuredUrl);
    const fetch = vi.spyOn(globalThis, "fetch");
    const modelsStore = new InMemoryModelsStore();
    await writeCommandCodeCatalog(modelsStore, {
      models: [cachedLiveOnlyModel()],
      checkedAt: Date.now(),
      commandCodeCatalogVersion: 1,
      commandCodeModelsUrl: configuredUrl,
    });
    const { models } = await createRefreshModels(modelsStore);

    await models.refresh({ providers: ["command-code"] });

    expect(fetch).not.toHaveBeenCalled();
  });

  it("retries a configured source after its previous refresh failed", async () => {
    const configuredUrl = "https://catalog.example.test/models";
    const defaultUrl = "https://api.commandcode.ai/provider/v1/models";
    vi.stubEnv("CMD_MODELS_URL", configuredUrl);
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("down", { status: 503 }))
      .mockResolvedValueOnce(jsonResponse(validPayload));
    const modelsStore = new InMemoryModelsStore();
    const cached = cachedLiveOnlyModel();
    await writeCommandCodeCatalog(modelsStore, {
      models: [cached],
      checkedAt: Date.now(),
      commandCodeCatalogVersion: 1,
      commandCodeModelsUrl: defaultUrl,
    });
    const { models } = await createRefreshModels(modelsStore);

    const first = await models.refresh({ providers: ["command-code"] });
    const failed = (await modelsStore.read("command-code")) as
      | CommandCodeTestStoredCatalog
      | undefined;
    const second = await models.refresh({ providers: ["command-code"] });

    expect(first.errors.get("command-code")).toBeInstanceOf(Error);
    expect(failed?.models).toEqual([cached]);
    expect(failed?.commandCodeModelsUrl).toBe(defaultUrl);
    expect(second.errors.size).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]?.[0]).toBe(configuredUrl);
    expect(fetch.mock.calls[1]?.[0]).toBe(configuredUrl);
    expect(
      (await modelsStore.read("command-code")) as CommandCodeTestStoredCatalog | undefined,
    ).toMatchObject({ commandCodeModelsUrl: configuredUrl });
  });

  it("converts and persists a valid forced refresh", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(validPayload));
    const { models, modelsStore } = await createRefreshModels();

    const result = await models.refresh({ providers: ["command-code"], force: true });
    const model = models.getModel("command-code", "new-model");
    const stored = await modelsStore.read("command-code");

    expect(result.errors.size).toBe(0);
    expect(model).toMatchObject({
      id: "new-model",
      name: "New Model",
      provider: "command-code",
      contextWindow: 32_000,
      maxTokens: 24_000,
      api: "openai-completions",
    });
    expect(stored?.models).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "new-model" })]),
    );
    expect(stored?.checkedAt).toEqual(expect.any(Number));
  });

  it("refreshes the captured fixture with local Flash capabilities", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(commandCodeModelsFixture));
    const { models, modelsStore } = await createRefreshModels();

    const result = await models.refresh({ providers: ["command-code"], force: true });

    expect(result.errors.size).toBe(0);
    expect(
      models
        .getModels("command-code")
        .map((model) => model.id)
        .sort(),
    ).toEqual(fixtureChatRecords.map((record) => record.id).sort());
    const flash = models.getModel("command-code", FLASH_MODEL_ID) as Model<"openai-completions">;
    expect(flash).toMatchObject({
      api: "openai-completions",
      input: ["text", "image"],
      reasoning: true,
      maxTokens: 32_768,
      cost: { input: 0.15, output: 0.6, cacheRead: 0.015, cacheWrite: 0 },
      compat: { supportsReasoningEffort: true, maxTokensField: "max_tokens" },
    });
    expect(flash.thinkingLevelMap).toEqual({
      off: null,
      minimal: null,
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: "max",
    });
    const storedFlash = (await modelsStore.read("command-code"))?.models.find(
      (model) => model.id === FLASH_MODEL_ID,
    );
    expect(storedFlash).toMatchObject({
      id: FLASH_MODEL_ID,
      reasoning: true,
      input: ["text", "image"],
      cost: { input: 0.15, output: 0.6, cacheRead: 0.015, cacheWrite: 0 },
      compat: { supportsReasoningEffort: true, maxTokensField: "max_tokens" },
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
  });

  it("parses and persists optional Command Code metadata", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        object: "list",
        data: [
          {
            id: "metadata-model",
            name: "Metadata Model",
            context_length: 32_000,
            supported_endpoints: ["/chat/completions"],
            pricing: { input: 0, output: 9, cache_read: 0.25 },
            modalities: { input: ["text", "image"] },
            reasoning: false,
          },
        ],
      }),
    );
    const { models, modelsStore } = await createRefreshModels();

    await models.refresh({ providers: ["command-code"], force: true });

    const expected = {
      reasoning: false,
      input: ["text", "image"],
      cost: { input: 0, output: 9, cacheRead: 0.25, cacheWrite: 0 },
    };
    expect(models.getModel("command-code", "metadata-model")).toMatchObject(expected);
    expect((await modelsStore.read("command-code"))?.models).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "metadata-model", ...expected })]),
    );
  });

  it("treats modalities without input as absent metadata", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        object: "list",
        data: [
          {
            id: "claude-sonnet-5",
            name: "Claude Sonnet 5",
            context_length: 1_000_000,
            supported_endpoints: ["/messages"],
            modalities: {},
          },
          {
            id: FLASH_MODEL_ID,
            name: "MiniMax M3.1 Flash",
            context_length: 1_000_000,
            supported_endpoints: ["/chat/completions"],
            modalities: {},
          },
        ],
      }),
    );
    const { models } = await createRefreshModels();

    await models.refresh({ providers: ["command-code"], force: true });

    expect(models.getModel("command-code", "claude-sonnet-5")).toMatchObject({
      input: ["text", "image"],
    });
    expect(models.getModel("command-code", FLASH_MODEL_ID)).toMatchObject({
      api: "openai-completions",
      input: ["text", "image"],
      reasoning: true,
      cost: { input: 0.15, output: 0.6, cacheRead: 0.015, cacheWrite: 0 },
      compat: { supportsReasoningEffort: true },
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
  });

  const invalidCases: Array<[name: string, payload: unknown, status?: number]> = [
    ["empty list", { object: "list", data: [] }],
    [
      "duplicate IDs",
      {
        object: "list",
        data: [
          {
            id: "same",
            name: "One",
            context_length: 1000,
            supported_endpoints: ["/chat/completions"],
          },
          {
            id: "same",
            name: "Two",
            context_length: 1000,
            supported_endpoints: ["/chat/completions"],
          },
        ],
      },
    ],
    [
      "missing endpoint metadata",
      { object: "list", data: [{ id: "id", name: "Name", context_length: 1000 }] },
    ],
    [
      "non-array endpoint metadata",
      {
        object: "list",
        data: [{ id: "id", name: "Name", context_length: 1000, supported_endpoints: "/messages" }],
      },
    ],
    [
      "non-string endpoint metadata",
      {
        object: "list",
        data: [
          { id: "id", name: "Name", context_length: 1000, supported_endpoints: ["/messages", 1] },
        ],
      },
    ],
    [
      "no usable chat endpoints",
      {
        object: "list",
        data: [
          {
            id: "unknown-endpoint",
            name: "Unknown Endpoint",
            context_length: 1000,
            supported_endpoints: ["/future"],
          },
        ],
      },
    ],
    [
      "blank ID",
      {
        object: "list",
        data: [
          { id: "   ", name: "Name", context_length: 1000, supported_endpoints: ["/messages"] },
        ],
      },
    ],
    [
      "blank name",
      {
        object: "list",
        data: [{ id: "id", name: "\t", context_length: 1000, supported_endpoints: ["/messages"] }],
      },
    ],
    [
      "zero context",
      {
        object: "list",
        data: [{ id: "id", name: "Name", context_length: 0, supported_endpoints: ["/messages"] }],
      },
    ],
    [
      "negative context",
      {
        object: "list",
        data: [{ id: "id", name: "Name", context_length: -1, supported_endpoints: ["/messages"] }],
      },
    ],
    [
      "fractional context",
      {
        object: "list",
        data: [{ id: "id", name: "Name", context_length: 1.5, supported_endpoints: ["/messages"] }],
      },
    ],
    [
      "zero max output",
      {
        object: "list",
        data: [
          {
            id: "id",
            name: "Name",
            context_length: 1000,
            max_output_tokens: 0,
            supported_endpoints: ["/messages"],
          },
        ],
      },
    ],
    [
      "negative max output",
      {
        object: "list",
        data: [
          {
            id: "id",
            name: "Name",
            context_length: 1000,
            max_output_tokens: -1,
            supported_endpoints: ["/messages"],
          },
        ],
      },
    ],
    [
      "fractional max output",
      {
        object: "list",
        data: [
          {
            id: "id",
            name: "Name",
            context_length: 1000,
            max_output_tokens: 1.5,
            supported_endpoints: ["/messages"],
          },
        ],
      },
    ],
    [
      "string max output",
      {
        object: "list",
        data: [
          {
            id: "id",
            name: "Name",
            context_length: 1000,
            max_output_tokens: "32768",
            supported_endpoints: ["/messages"],
          },
        ],
      },
    ],
    [
      "array pricing",
      {
        object: "list",
        data: [
          {
            id: "id",
            name: "Name",
            context_length: 1000,
            supported_endpoints: ["/messages"],
            pricing: [],
          },
        ],
      },
    ],
    [
      "negative pricing input",
      {
        object: "list",
        data: [
          {
            id: "id",
            name: "Name",
            context_length: 1000,
            supported_endpoints: ["/messages"],
            pricing: { input: -1 },
          },
        ],
      },
    ],
    [
      "string pricing output",
      {
        object: "list",
        data: [
          {
            id: "id",
            name: "Name",
            context_length: 1000,
            supported_endpoints: ["/messages"],
            pricing: { output: "9" },
          },
        ],
      },
    ],
    [
      "array modalities",
      {
        object: "list",
        data: [
          {
            id: "id",
            name: "Name",
            context_length: 1000,
            supported_endpoints: ["/messages"],
            modalities: [],
          },
        ],
      },
    ],
    [
      "non-string modality input",
      {
        object: "list",
        data: [
          {
            id: "id",
            name: "Name",
            context_length: 1000,
            supported_endpoints: ["/messages"],
            modalities: { input: ["text", 1] },
          },
        ],
      },
    ],
    [
      "string reasoning",
      {
        object: "list",
        data: [
          {
            id: "id",
            name: "Name",
            context_length: 1000,
            supported_endpoints: ["/messages"],
            reasoning: "true",
          },
        ],
      },
    ],
    [
      "wrong object",
      { object: "models", data: [{ id: "id", name: "Name", context_length: 1000 }] },
    ],
    ["non-2xx", { error: "rate limited" }, 429],
  ];

  it.each(invalidCases)("retains the cached catalog for %s", async (_name, payload, status) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(payload, status));
    const { models, modelsStore, cached } = await createStoredRefreshModels();

    const result = await models.refresh({ providers: ["command-code"], force: true });
    const stored = await modelsStore.read("command-code");

    expect(result.errors.get("command-code")).toBeInstanceOf(Error);
    expect(models.getModel("command-code", cached.id)).toEqual(cached);
    expect(stored?.models).toEqual([cached]);
  });

  it("skips non-chat live records while publishing usable chat models", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        object: "list",
        data: [
          {
            id: "chat-model",
            name: "Chat Model",
            context_length: 32_000,
            supported_endpoints: ["/chat/completions"],
          },
          {
            id: "responses-only",
            name: "Responses Only",
            context_length: 32_000,
            supported_endpoints: ["/responses"],
          },
          {
            id: "unknown-endpoint",
            name: "Unknown Endpoint",
            context_length: 32_000,
            supported_endpoints: ["/future"],
          },
          {
            id: "typesafe/jev",
            name: "Jev",
            context_length: 32_000,
            supported_endpoints: ["/system-one"],
          },
        ],
      }),
    );
    const { models, modelsStore } = await createRefreshModels();

    await models.refresh({ providers: ["command-code"], force: true });

    expect(models.getModel("command-code", "chat-model")).toBeDefined();
    expect(models.getModel("command-code", "responses-only")).toMatchObject({
      api: "openai-responses",
    });
    expect(models.getModel("command-code", "unknown-endpoint")).toBeUndefined();
    expect(models.getModel("command-code", "typesafe/jev")).toBeUndefined();
    expect((await modelsStore.read("command-code"))?.models).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "typesafe/jev" })]),
    );
  });

  it("removes a bundled model that no longer advertises a chat endpoint", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        object: "list",
        data: [
          {
            id: "claude-sonnet-5",
            name: "Claude Sonnet 5",
            context_length: 1_000_000,
            supported_endpoints: ["/future"],
          },
          {
            id: "new-model",
            name: "New Model",
            context_length: 32_000,
            supported_endpoints: ["/chat/completions"],
          },
        ],
      }),
    );
    const { models } = await createRefreshModels();

    const result = await models.refresh({ providers: ["command-code"], force: true });

    expect(result.errors.size).toBe(0);
    expect(models.getModel("command-code", "new-model")).toBeDefined();
    expect(models.getModel("command-code", "claude-sonnet-5")).toBeUndefined();
  });

  it("retains the cached catalog for malformed JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{", { status: 200 }));
    const { models, modelsStore, cached } = await createStoredRefreshModels();

    const result = await models.refresh({ providers: ["command-code"], force: true });
    const stored = await modelsStore.read("command-code");

    expect(result.errors.get("command-code")).toBeInstanceOf(Error);
    expect(models.getModel("command-code", cached.id)).toEqual(cached);
    expect(stored?.models).toEqual([cached]);
  });

  it("restores the cached catalog offline without fetching", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const { models, cached } = await createStoredRefreshModels(Date.now());

    await models.refresh({ providers: ["command-code"], allowNetwork: false });

    expect(fetch).not.toHaveBeenCalled();
    expect(models.getModel("command-code", cached.id)).toEqual(cached);
    expect(models.getModel("command-code", "claude-sonnet-5")).toBeUndefined();
  });

  it("keeps bundled Flash hidden offline until a successful catalog refresh", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(commandCodeModelsFixture));
    const { models, modelsStore, cached } = await createStoredRefreshModels(Date.now());

    await models.refresh({ providers: ["command-code"], allowNetwork: false });

    expect(fetch).not.toHaveBeenCalled();
    expect(models.getModel("command-code", cached.id)).toEqual(cached);
    expect(models.getModel("command-code", FLASH_MODEL_ID)).toBeUndefined();

    const result = await models.refresh({ providers: ["command-code"], force: true });

    expect(result.errors.size).toBe(0);
    expect(fetch).toHaveBeenCalledOnce();
    expect(models.getModel("command-code", cached.id)).toBeUndefined();
    const expectedFlash = {
      id: FLASH_MODEL_ID,
      api: "openai-completions",
      compat: { supportsReasoningEffort: true },
      thinkingLevelMap: {
        off: null,
        minimal: null,
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "xhigh",
        max: "max",
      },
    };
    expect(models.getModel("command-code", FLASH_MODEL_ID)).toMatchObject(expectedFlash);
    const storedFlash = (await modelsStore.read("command-code"))?.models.find(
      (model) => model.id === FLASH_MODEL_ID,
    );
    expect(storedFlash).toMatchObject(expectedFlash);
  });

  it("migrates legacy output limits without capping versioned explicit limits", async () => {
    const modelsStore = new InMemoryModelsStore();
    const legacyModel = {
      ...cachedLiveOnlyModel(),
      id: "deepseek/deepseek-v4.1-flash",
      name: "DeepSeek V4.1 Flash",
      contextWindow: 1_000_000,
      maxTokens: 943_718,
    } satisfies Model<"openai-completions">;
    await modelsStore.write("command-code", { models: [legacyModel], checkedAt: Date.now() });

    const legacy = await createRefreshModels(modelsStore);
    await legacy.models.refresh({ providers: ["command-code"], allowNetwork: false });

    expect(legacy.models.getModel("command-code", legacyModel.id)?.maxTokens).toBe(32_768);
    expect((await modelsStore.read("command-code"))?.models[0]?.maxTokens).toBe(32_768);

    const versionedModel = { ...legacyModel, maxTokens: 393_216 };
    const versionedEntry = {
      models: [versionedModel],
      checkedAt: Date.now(),
      commandCodeCatalogVersion: 1,
    };
    await modelsStore.write("command-code", versionedEntry);

    const versioned = await createRefreshModels(modelsStore);
    await versioned.models.refresh({ providers: ["command-code"], allowNetwork: false });

    expect(versioned.models.getModel("command-code", versionedModel.id)?.maxTokens).toBe(393_216);
  });

  it("skips a fresh non-forced online refresh without rewriting checkedAt", async () => {
    const checkedAt = Date.now();
    const fetch = vi.spyOn(globalThis, "fetch");
    const { models, modelsStore, cached } = await createStoredRefreshModels(checkedAt);

    await models.refresh({ providers: ["command-code"] });

    expect(fetch).not.toHaveBeenCalled();
    expect(models.getModel("command-code", cached.id)).toEqual(cached);
    expect(await modelsStore.read("command-code")).toEqual({
      models: [cached],
      checkedAt,
      commandCodeCatalogVersion: 1,
      commandCodeModelsUrl: "https://api.commandcode.ai/provider/v1/models",
    });
  });

  it("fetches and stores a stale non-forced catalog", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(validPayload));
    const { models, modelsStore } = await createStoredRefreshModels();

    await models.refresh({ providers: ["command-code"] });

    expect(fetch).toHaveBeenCalledOnce();
    expect(models.getModel("command-code", "new-model")).toMatchObject({ name: "New Model" });
    expect((await modelsStore.read("command-code"))?.models).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "new-model" })]),
    );
  });

  it("throttles non-forced retries after a failed catalog check", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("down", { status: 503 }));
    const { models, modelsStore, cached } = await createStoredRefreshModels();

    const first = await models.refresh({ providers: ["command-code"] });

    expect(first.errors.get("command-code")).toBeInstanceOf(Error);
    expect((await modelsStore.read("command-code"))?.checkedAt).toBeGreaterThan(0);

    const second = await models.refresh({ providers: ["command-code"] });

    expect(second.errors.size).toBe(0);
    expect(fetch).toHaveBeenCalledOnce();
    expect(models.getModel("command-code", cached.id)).toEqual(cached);
  });

  it("keeps the bundled catalog after restarting from a first-run failure cache", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("down", { status: 503 }));
    const modelsStore = new InMemoryModelsStore();
    const first = await createRefreshModels(modelsStore);

    const failed = await first.models.refresh({ providers: ["command-code"] });

    expect(failed.errors.get("command-code")).toBeInstanceOf(Error);
    expect(first.models.getModels("command-code")).toHaveLength(93);
    expect(await modelsStore.read("command-code")).toMatchObject({ models: [] });

    const restarted = await createRefreshModels(modelsStore);
    await restarted.models.refresh({ providers: ["command-code"] });

    expect(fetch).toHaveBeenCalledOnce();
    expect(restarted.models.getModels("command-code")).toHaveLength(93);
  });

  it("fetches and stores a fresh catalog when forced", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(validPayload));
    const { models, modelsStore } = await createStoredRefreshModels(Date.now());

    await models.refresh({ providers: ["command-code"], force: true });

    expect(fetch).toHaveBeenCalledOnce();
    expect(models.getModel("command-code", "new-model")).toMatchObject({ name: "New Model" });
    expect((await modelsStore.read("command-code"))?.models).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "new-model" })]),
    );
  });

  it("retains the cached catalog when the fetch timeout aborts", async () => {
    const timeout = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) =>
        new Promise((_, reject) => {
          init?.signal?.throwIfAborted();
          init?.signal?.addEventListener("abort", () => reject(new Error("timed out")), {
            once: true,
          });
        }),
    );
    const { models, cached } = await createStoredRefreshModels();

    const refresh = models.refresh({ providers: ["command-code"], force: true });
    timeout.abort();
    const result = await refresh;

    expect(result.errors.get("command-code")).toBeInstanceOf(Error);
    expect(models.getModel("command-code", cached.id)).toEqual(cached);
  });

  it("reports caller cancellation without an error and retains the cached catalog", async () => {
    let resolveFetchStarted!: () => void;
    const fetchStarted = new Promise<void>((resolve) => {
      resolveFetchStarted = resolve;
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) =>
        new Promise((_, reject) => {
          resolveFetchStarted();
          init?.signal?.addEventListener("abort", () => reject(new Error("cancelled")), {
            once: true,
          });
        }),
    );
    const { models, cached } = await createStoredRefreshModels();
    const caller = new AbortController();

    const refresh = models.refresh({ providers: ["command-code"], signal: caller.signal });
    await fetchStarted;
    caller.abort();

    expect(await refresh).toEqual({ aborted: true, errors: new Map() });
    expect(models.getModel("command-code", cached.id)).toEqual(cached);
  });

  it("replaces the previous catalog with a later successful catalog", async () => {
    const payloads = [
      validPayload,
      {
        object: "list",
        data: [
          {
            id: "another-model",
            name: "Another Model",
            context_length: 16_000,
            supported_endpoints: ["/chat/completions"],
          },
        ],
      },
    ];
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse(payloads.shift()));
    const { models } = await createRefreshModels();

    await models.refresh({ providers: ["command-code"], force: true });
    await models.refresh({ providers: ["command-code"], force: true });

    expect(models.getModel("command-code", "new-model")).toBeUndefined();
    expect(models.getModel("command-code", "another-model")).toMatchObject({
      name: "Another Model",
    });
    expect(models.getModel("command-code", "claude-sonnet-5")).toBeUndefined();
  });

  it("persists headerless models and applies ZDR only to each provider instance", async () => {
    vi.stubEnv("CMD_ZDR", "1");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(validPayload));
    const modelsStore = new InMemoryModelsStore();
    const first = await createRefreshModels(modelsStore);

    await first.models.refresh({ providers: ["command-code"], force: true });

    const stored = await modelsStore.read("command-code");
    expect(stored?.models).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "new-model" })]),
    );
    expect(stored?.models.every((model) => model.headers === undefined)).toBe(true);
    expect(first.models.getModel("command-code", "new-model")?.headers).toEqual({
      "x-cmd-zdr": "1",
    });

    vi.stubEnv("CMD_ZDR", undefined);
    const second = await createRefreshModels(modelsStore);
    await second.models.refresh({ providers: ["command-code"], allowNetwork: false });

    expect(second.models.getModel("command-code", "new-model")?.headers).toBeUndefined();
  });
});
