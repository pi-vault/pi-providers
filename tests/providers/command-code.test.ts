import {
  createModels,
  InMemoryCredentialStore,
  InMemoryModelsStore,
  type Model,
} from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMMAND_CODE_CATALOG,
  commandCodeModels,
  modelFromCatalogRecord,
} from "../../src/providers/command-code/models.ts";
import {
  createCommandCodeProvider,
  registerCommandCode,
} from "../../src/providers/command-code.ts";

const validPayload = {
  object: "list",
  data: [{ id: "new-model", name: "New Model", context_length: 32_000 }],
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
    maxTokens: 16_384,
  };
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
      { messages: [{ role: "user", content: "hello", timestamp: Date.now() }] },
      { apiKey: "test-key", fetch, maxRetries: 0 },
    )
    .result();

  if (!captured) throw new Error(`No request captured for: ${modelId}`);
  return captured;
}

describe("Command Code catalog conversion", () => {
  it("routes Claude records to Anthropic Messages", () => {
    expect(
      modelFromCatalogRecord({
        id: "claude-sonnet-5",
        name: "Claude Sonnet 5",
        contextWindow: 1_000_000,
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
      }).api,
    ).toBe("openai-completions");
  });

  it("uses conservative defaults for an unknown model", () => {
    expect(
      modelFromCatalogRecord({
        id: "new/vendor-model",
        name: "New Vendor Model",
        contextWindow: 32_000,
      }),
    ).toMatchObject({
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      maxTokens: 16_384,
    });
  });

  it("bundles the captured Command Code catalog", () => {
    expect(COMMAND_CODE_CATALOG).toHaveLength(52);
    expect(new Set(COMMAND_CODE_CATALOG.map((model) => model.id)).size).toBe(52);
    expect(new Set(COMMAND_CODE_CATALOG.map((model) => model.name)).size).toBe(52);
    expect(
      COMMAND_CODE_CATALOG.every(
        (model) =>
          model.id.trim().length > 0 &&
          model.name.trim().length > 0 &&
          Number.isInteger(model.contextWindow) &&
          model.contextWindow > 0,
      ),
    ).toBe(true);
    expect(commandCodeModels).toHaveLength(52);

    const laguna = commandCodeModels.find((model) => model.id === "poolside/laguna-s-2.1-free");
    expect(laguna?.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    expect(
      commandCodeModels.every((model) => {
        if (model.id === "poolside/laguna-s-2.1-free") return true;
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

  it("uses Command’s stable and tiered pricing", () => {
    const costFor = (id: string) =>
      modelFromCatalogRecord({ id, name: id, contextWindow: 1_000_000 }).cost;

    expect(costFor("deepseek/deepseek-v4-pro")).toEqual({
      input: 0.435,
      output: 0.87,
      cacheRead: 0.003625,
      cacheWrite: 0,
    });
    expect(costFor("MiniMaxAI/MiniMax-M3")).toEqual({
      input: 0.3,
      output: 1.2,
      cacheRead: 0.06,
      cacheWrite: 0,
    });
    expect(costFor("xiaomi/mimo-v2.5-pro")).toEqual({
      input: 0.435,
      output: 0.87,
      cacheRead: 0.0036,
      cacheWrite: 0,
    });
    expect(costFor("xiaomi/mimo-v2.5")).toEqual({
      input: 0.14,
      output: 0.28,
      cacheRead: 0.0028,
      cacheWrite: 0,
    });
    expect(costFor("claude-sonnet-5")).toEqual({
      input: 3,
      output: 15,
      cacheRead: 0.3,
      cacheWrite: 3.75,
    });
    expect(costFor("gpt-5.6-terra")).toEqual({
      input: 2,
      output: 12,
      cacheRead: 0.2,
      cacheWrite: 2.5,
      tiers: [{ inputTokensAbove: 272_000, input: 4, output: 18, cacheRead: 0.4, cacheWrite: 5 }],
    });
    expect(costFor("gpt-5.6-luna")).toEqual({
      input: 0.2,
      output: 1.2,
      cacheRead: 0.02,
      cacheWrite: 0.25,
      tiers: [
        { inputTokensAbove: 272_000, input: 0.4, output: 1.8, cacheRead: 0.04, cacheWrite: 0.5 },
      ],
    });
  });

  it("uses Pi metadata while preserving Command identity and context", () => {
    expect(
      modelFromCatalogRecord({
        id: "claude-sonnet-5",
        name: "Command Claude",
        contextWindow: 900_000,
      }),
    ).toMatchObject({
      name: "Command Claude",
      contextWindow: 900_000,
      reasoning: true,
      input: ["text", "image"],
      maxTokens: 128_000,
      cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      thinkingLevelMap: { xhigh: "xhigh", max: "max" },
      compat: { forceAdaptiveThinking: true },
    });
  });

  it("uses Pi metadata for current live vision models", () => {
    const cases = [
      {
        record: {
          id: "deepseek/deepseek-v4-flash-vision-exp",
          name: "DeepSeek V4 Flash Vision (exp)",
          contextWindow: 1_000_000,
        },
        expected: { reasoning: true, input: ["text", "image"], maxTokens: 384_000 },
      },
      {
        record: {
          id: "z-ai/glm-5.3-flash",
          name: "GLM-5.3 Flash",
          contextWindow: 1_048_576,
        },
        expected: { reasoning: true, input: ["text", "image"], maxTokens: 131_072 },
      },
      {
        record: {
          id: "Qwen/Qwen3.8-27B",
          name: "Qwen 3.8 27B",
          contextWindow: 262_144,
        },
        expected: { reasoning: true, input: ["text", "image"], maxTokens: 32_768 },
      },
      {
        record: {
          id: "Qwen/Qwen3.8-Flash",
          name: "Qwen 3.8 Flash",
          contextWindow: 1_000_000,
        },
        expected: { reasoning: true, input: ["text", "image"], maxTokens: 131_072 },
      },
      {
        record: {
          id: "google/gemini-3.7-flash",
          name: "Gemini 3.7 Flash",
          contextWindow: 1_048_576,
        },
        expected: { reasoning: true, input: ["text", "image"], maxTokens: 65_536 },
      },
      {
        record: {
          id: "xai/grok-4.6",
          name: "Grok 4.6",
          contextWindow: 500_000,
        },
        expected: { reasoning: true, input: ["text", "image"], maxTokens: 500_000 },
      },
    ] as const;

    for (const { record, expected } of cases) {
      expect(modelFromCatalogRecord(record), record.id).toMatchObject(expected);
    }
  });

  it("falls back to a normalized display-name match", () => {
    expect(
      modelFromCatalogRecord({
        id: "Qwen/Qwen3.7-Flash",
        name: "Qwen 3.7 Flash",
        contextWindow: 200_000,
      }),
    ).toMatchObject({
      reasoning: true,
      input: ["text", "image"],
      maxTokens: 64_000,
    });
  });

  it("creates a provider with both API families", () => {
    const provider = createCommandCodeProvider();

    expect(provider).toMatchObject({
      id: "command-code",
      name: "Command Code",
      baseUrl: "https://api.commandcode.ai/provider/v1",
    });
    expect(provider.getModels()).toHaveLength(52);
    expect(new Set(provider.getModels().map((model) => model.api))).toEqual(
      new Set(["anthropic-messages", "openai-completions"]),
    );
    expect(provider.refreshModels).toBeTypeOf("function");
    expect(provider.auth.apiKey?.name).toBe("Command Code API key");
  });

  it("resolves CMD_API_KEY authentication", async () => {
    const apiKey = createCommandCodeProvider().auth.apiKey;
    const auth = await apiKey?.resolve({
      ctx: {
        env: async (name) => (name === "CMD_API_KEY" ? "test-key" : undefined),
        fileExists: async () => false,
      },
      signal: new AbortController().signal,
    });

    expect(auth).toEqual({ auth: { apiKey: "test-key" }, source: "CMD_API_KEY" });
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
    expect(anthropic.url).toBe("https://api.commandcode.ai/provider/v1/messages");
    expect(anthropic.headers.get("x-api-key")).toBe("test-key");
    expect(anthropic.headers.get("x-cmd-zdr")).toBe("1");
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

describe("Command Code live catalog", () => {
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
      api: "openai-completions",
    });
    expect(stored?.models).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "new-model" })]),
    );
    expect(stored?.checkedAt).toEqual(expect.any(Number));
  });

  const invalidCases: Array<[name: string, payload: unknown, status?: number]> = [
    ["empty list", { object: "list", data: [] }],
    [
      "duplicate IDs",
      {
        object: "list",
        data: [
          { id: "same", name: "One", context_length: 1000 },
          { id: "same", name: "Two", context_length: 1000 },
        ],
      },
    ],
    ["blank ID", { object: "list", data: [{ id: "   ", name: "Name", context_length: 1000 }] }],
    ["blank name", { object: "list", data: [{ id: "id", name: "\t", context_length: 1000 }] }],
    ["zero context", { object: "list", data: [{ id: "id", name: "Name", context_length: 0 }] }],
    [
      "negative context",
      { object: "list", data: [{ id: "id", name: "Name", context_length: -1 }] },
    ],
    [
      "fractional context",
      { object: "list", data: [{ id: "id", name: "Name", context_length: 1.5 }] },
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
  });

  it("skips a fresh non-forced online refresh without rewriting checkedAt", async () => {
    const checkedAt = Date.now();
    const fetch = vi.spyOn(globalThis, "fetch");
    const { models, modelsStore, cached } = await createStoredRefreshModels(checkedAt);

    await models.refresh({ providers: ["command-code"] });

    expect(fetch).not.toHaveBeenCalled();
    expect(models.getModel("command-code", cached.id)).toEqual(cached);
    expect(await modelsStore.read("command-code")).toEqual({ models: [cached], checkedAt });
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

  it("removes live-only models absent from a later successful catalog", async () => {
    const payloads = [
      validPayload,
      {
        object: "list",
        data: [{ id: "another-model", name: "Another Model", context_length: 16_000 }],
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
    expect(models.getModel("command-code", "claude-sonnet-5")).toBeDefined();
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
