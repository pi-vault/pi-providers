// tests/providers/minimax-openai/catalog.test.ts

import type {
  Api,
  Model,
  OpenAICompletionsCompat,
  RefreshModelsContext,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMiniMaxModelRefresh } from "../../../src/providers/minimax-openai/catalog.ts";
import { MINIMAX_MODELS } from "../../../src/providers/minimax-openai/models.ts";

const NOW = Date.UTC(2026, 9, 25, 12, 0, 0);
const FOUR_HOURS = 4 * 60 * 60 * 1000;

const GLOBAL = {
  provider: "minimax-openai",
  baseUrl: "https://api.minimax.io/v1",
  key: "global-test-key",
} as const;
const CHINA = {
  provider: "minimax-openai-cn",
  baseUrl: "https://api.minimaxi.com/v1",
  key: "china-test-key",
} as const;

type Region = typeof GLOBAL | typeof CHINA;
type Publish = RefreshModelsContext["publish"];
type PublishSpy = Publish & { mock: { calls: Array<[Parameters<Publish>[0]]> } };

function storedModel(
  region: Region,
  id: string,
  overrides: Record<string, unknown> = {},
): Model<Api> {
  const definition = MINIMAX_MODELS.find((model) => model.id === id);
  if (!definition) throw new Error(`Unknown MiniMax fixture: ${id}`);
  return structuredClone({
    ...definition,
    provider: region.provider,
    baseUrl: region.baseUrl,
    api: region.provider as Api,
    ...overrides,
  }) as Model<Api>;
}

type ContextOptions = {
  stored?: RefreshModelsContext["stored"];
  allowNetwork?: boolean;
  force?: boolean;
  credential?: RefreshModelsContext["credential"];
  signal?: AbortSignal;
  publish?: Publish;
};

function fakeContext(options: ContextOptions = {}) {
  const publishMock = options.publish ?? vi.fn(async () => true);
  const context: RefreshModelsContext = {
    credential: "credential" in options ? options.credential : { type: "api_key", key: "test-key" },
    stored: options.stored,
    publish: publishMock,
    allowNetwork: options.allowNetwork ?? false,
    force: options.force,
    signal: options.signal ?? new AbortController().signal,
  };
  return { context, publish: publishMock as unknown as PublishSpy };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function listResponse(ids: string[], extra: Record<string, unknown> = {}): Response {
  return jsonResponse({
    object: "list",
    data: ids.map((id) => ({ id, ...extra })),
  });
}

function refreshFor(region: Region) {
  return createMiniMaxModelRefresh(region.provider, region.baseUrl);
}

function idsOf(models: readonly { id: string }[]): string[] {
  return models.map((model) => model.id);
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("MiniMax catalog restoration", () => {
  it("returns a deep-cloned curated baseline when no cache exists", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const { context, publish } = fakeContext();

    const models = await refreshFor(GLOBAL)(context);

    expect(idsOf(models)).toEqual(["MiniMax-M3.1-Flash", "MiniMax-M3"]);
    expect(fetch).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(models[0].cost).not.toBe(MINIMAX_MODELS[0].cost);
    expect(models[0].compat).not.toBe(MINIMAX_MODELS[0].compat);
    expect(models[1].cost.tiers).not.toBe(MINIMAX_MODELS[1].cost.tiers);

    const firstTier = models[1].cost.tiers?.[0];
    if (!firstTier) throw new Error("Missing M3 pricing tier");
    models[0].cost.input = 99;
    (models[0].compat as OpenAICompletionsCompat).supportsReasoningEffort = false;
    firstTier.input = 99;
    expect(MINIMAX_MODELS[0].cost.input).toBe(0.15);
    expect((MINIMAX_MODELS[0].compat as OpenAICompletionsCompat).supportsReasoningEffort).toBe(
      true,
    );
    expect(MINIMAX_MODELS[1].cost.tiers?.[0]?.input).toBe(0.6);
  });

  it("restores a compatible subset with current curated metadata", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const stored = storedModel(GLOBAL, "MiniMax-M3", {
      name: "Old M3 Name",
      cost: { input: 9, output: 9, cacheRead: 9, cacheWrite: 9, tiers: [] },
      compat: { supportsStore: true },
      headers: { "x-old-header": "old" },
    });
    const { context, publish } = fakeContext({
      stored: { models: [stored], checkedAt: NOW },
    });

    const models = await refreshFor(GLOBAL)(context);

    expect(idsOf(models)).toEqual(["MiniMax-M3"]);
    expect(models[0]).toMatchObject({
      id: "MiniMax-M3",
      name: "MiniMax-M3",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 1_000_000,
      maxTokens: 524_288,
      cost: {
        input: 0.3,
        output: 1.2,
        cacheRead: 0.06,
        cacheWrite: 0,
        tiers: [
          { inputTokensAbove: 512_000, input: 0.6, output: 2.4, cacheRead: 0.12, cacheWrite: 0 },
        ],
      },
      compat: {
        supportsStore: false,
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
        maxTokensField: "max_completion_tokens",
      },
    });
    expect(models[0]).not.toHaveProperty("headers");
    expect(fetch).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("restores current Flash thinking controls rather than cached ones", async () => {
    const stored = storedModel(GLOBAL, "MiniMax-M3.1-Flash", {
      thinkingLevelMap: { low: "max" },
      compat: { supportsReasoningEffort: false },
    });
    const { context } = fakeContext({ stored: { models: [stored], checkedAt: NOW } });

    const [flash] = await refreshFor(GLOBAL)(context);

    expect(flash.thinkingLevelMap).toEqual({
      off: null,
      minimal: null,
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: "max",
    });
    expect((flash.compat as OpenAICompletionsCompat).supportsReasoningEffort).toBe(true);
  });

  it("restores an authoritative empty cache as empty", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const { context, publish } = fakeContext({
      stored: { models: [], checkedAt: NOW },
    });

    await expect(refreshFor(GLOBAL)(context)).resolves.toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("restores an all-unsupported compatible cache as empty", async () => {
    const unknown = { ...storedModel(GLOBAL, "MiniMax-M3"), id: "MiniMax-M2.7" };
    const { context } = fakeContext({ stored: { models: [unknown], checkedAt: NOW } });

    await expect(refreshFor(GLOBAL)(context)).resolves.toEqual([]);
  });

  it("selects unique known IDs in curated order", async () => {
    const stored = [
      storedModel(GLOBAL, "MiniMax-M3"),
      storedModel(GLOBAL, "MiniMax-M3.1-Flash"),
      storedModel(GLOBAL, "MiniMax-M3"),
    ];
    const { context } = fakeContext({ stored: { models: stored, checkedAt: NOW } });

    const models = await refreshFor(GLOBAL)(context);

    expect(idsOf(models)).toEqual(["MiniMax-M3.1-Flash", "MiniMax-M3"]);
  });

  it("rejects a cache whose provider, base URL, or API does not match", async () => {
    const mismatches = [
      storedModel(GLOBAL, "MiniMax-M3", { provider: "other-provider" }),
      storedModel(GLOBAL, "MiniMax-M3", { baseUrl: "https://example.test/v1" }),
      storedModel(GLOBAL, "MiniMax-M3", { api: "openai-completions" }),
    ];

    for (const incompatible of mismatches) {
      const { context } = fakeContext({ stored: { models: [incompatible], checkedAt: NOW } });
      const models = await refreshFor(GLOBAL)(context);
      expect(idsOf(models)).toEqual(["MiniMax-M3.1-Flash", "MiniMax-M3"]);
    }
  });

  it("rejects a whole cache containing mixed compatible and incompatible records", async () => {
    const stored = [storedModel(GLOBAL, "MiniMax-M3"), storedModel(CHINA, "MiniMax-M3.1-Flash")];
    const { context } = fakeContext({ stored: { models: stored, checkedAt: NOW } });

    const models = await refreshFor(GLOBAL)(context);

    expect(idsOf(models)).toEqual(["MiniMax-M3.1-Flash", "MiniMax-M3"]);
  });

  it("returns independent definitions per region and call", async () => {
    const { context } = fakeContext();
    const global = await refreshFor(GLOBAL)(context);
    const china = await refreshFor(CHINA)(context);
    const again = await refreshFor(GLOBAL)(context);

    const globalTier = global[1].cost.tiers?.[0];
    if (!globalTier || !global[0].thinkingLevelMap) throw new Error("Missing MiniMax fixture data");
    global[0].cost.input = 99;
    global[0].thinkingLevelMap.low = "max";
    globalTier.input = 99;

    expect(china[0].cost.input).toBe(0.15);
    expect(china[0].thinkingLevelMap?.low).toBe("low");
    expect(china[1].cost.tiers?.[0]?.input).toBe(0.6);
    expect(again[0].cost.input).toBe(0.15);
    expect(again[0].thinkingLevelMap?.low).toBe("low");
    expect(again[1].cost.tiers?.[0]?.input).toBe(0.6);
  });
});

describe("MiniMax catalog discovery requests", () => {
  it("requests each regional endpoint with its own key and no ZDR header", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(listResponse([]))
      .mockResolvedValueOnce(listResponse([]));

    await refreshFor(GLOBAL)(
      fakeContext({
        allowNetwork: true,
        force: true,
        credential: { type: "api_key", key: GLOBAL.key },
      }).context,
    );
    await refreshFor(CHINA)(
      fakeContext({
        allowNetwork: true,
        force: true,
        credential: { type: "api_key", key: CHINA.key },
      }).context,
    );

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map(([input]) => input)).toEqual([
      "https://api.minimax.io/v1/models",
      "https://api.minimaxi.com/v1/models",
    ]);
    const [globalInit, chinaInit] = fetch.mock.calls.map(([, init]) => init as RequestInit);
    expect(globalInit.method).toBe("GET");
    expect(chinaInit.method).toBe("GET");
    expect(new Headers(globalInit.headers).get("authorization")).toBe(`Bearer ${GLOBAL.key}`);
    expect(new Headers(chinaInit.headers).get("authorization")).toBe(`Bearer ${CHINA.key}`);
    expect(new Headers(globalInit.headers).get("x-cmd-zdr")).toBeNull();
    expect(globalInit.signal).toBeInstanceOf(AbortSignal);
    expect(chinaInit.signal).toBeInstanceOf(AbortSignal);
  });

  it("performs no request offline or without a usable API-key credential", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const scenarios: ContextOptions[] = [
      { allowNetwork: false, force: true },
      { allowNetwork: true, force: true, credential: undefined },
      { allowNetwork: true, force: true, credential: { type: "oauth" } as never },
      { allowNetwork: true, force: true, credential: { type: "api_key", key: "   " } },
      { allowNetwork: true, force: true, credential: { type: "api_key", key: "" } },
    ];

    for (const scenario of scenarios) {
      const { context, publish } = fakeContext(scenario);
      const models = await refreshFor(GLOBAL)(context);
      expect(idsOf(models)).toEqual(["MiniMax-M3.1-Flash", "MiniMax-M3"]);
      expect(publish).not.toHaveBeenCalled();
    }

    expect(fetch).not.toHaveBeenCalled();
  });

  it("throttles only a fresh compatible cache with a valid successful timestamp", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const target = storedModel(GLOBAL, "MiniMax-M3");
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => listResponse(["MiniMax-M3"]));

    const fresh = await refreshFor(GLOBAL)(
      fakeContext({
        allowNetwork: true,
        stored: { models: [target], checkedAt: NOW - (FOUR_HOURS - 1) },
      }).context,
    );
    expect(idsOf(fresh)).toEqual(["MiniMax-M3"]);
    expect(fetch).not.toHaveBeenCalled();

    const exact = await refreshFor(GLOBAL)(
      fakeContext({
        allowNetwork: true,
        stored: { models: [target], checkedAt: NOW - FOUR_HOURS },
      }).context,
    );
    expect(idsOf(exact)).toEqual(["MiniMax-M3"]);
    expect(fetch).toHaveBeenCalledTimes(1);

    const forced = await refreshFor(GLOBAL)(
      fakeContext({
        allowNetwork: true,
        force: true,
        stored: { models: [target], checkedAt: NOW },
      }).context,
    );
    expect(idsOf(forced)).toEqual(["MiniMax-M3"]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("treats missing, non-finite, negative, and future timestamps as stale", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const target = storedModel(GLOBAL, "MiniMax-M3");
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => listResponse(["MiniMax-M3"]));
    const timestamps = [undefined, Number.NaN, Number.POSITIVE_INFINITY, -1, NOW + 1];

    for (const checkedAt of timestamps) {
      await refreshFor(GLOBAL)(
        fakeContext({
          allowNetwork: true,
          stored: { models: [target], ...(checkedAt === undefined ? {} : { checkedAt }) },
        }).context,
      );
    }

    expect(fetch).toHaveBeenCalledTimes(timestamps.length);
  });

  it("fetches despite a fresh incompatible cache", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(listResponse(["MiniMax-M3"]));
    const incompatible = storedModel(CHINA, "MiniMax-M3");

    const models = await refreshFor(GLOBAL)(
      fakeContext({
        allowNetwork: true,
        stored: { models: [incompatible], checkedAt: NOW },
      }).context,
    );

    expect(fetch).toHaveBeenCalledOnce();
    expect(idsOf(models)).toEqual(["MiniMax-M3"]);
  });

  it("returns live IDs in curated order regardless of response order", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      listResponse(["MiniMax-M3", "MiniMax-M3.1-Flash"]),
    );

    const models = await refreshFor(GLOBAL)(
      fakeContext({ allowNetwork: true, force: true }).context,
    );

    expect(idsOf(models)).toEqual(["MiniMax-M3.1-Flash", "MiniMax-M3"]);
  });
});

describe("MiniMax catalog validation and publication", () => {
  it("accepts empty and all-unsupported availability as authoritative empty lists", async () => {
    const payloads = [[], ["MiniMax-M2.7", "future-minimax-model"]];
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => listResponse(payloads.shift() ?? []));

    for (let index = 0; index < 2; index += 1) {
      const { context, publish } = fakeContext({ allowNetwork: true, force: true });
      const models = await refreshFor(GLOBAL)(context);

      expect(models).toEqual([]);
      expect(publish).toHaveBeenCalledOnce();
      expect(publish.mock.calls[0]?.[0]).toMatchObject({
        persist: { models: [], checkedAt: expect.any(Number) },
      });
    }

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("publishes current canonical metadata without cached or upstream extras", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        object: "list",
        data: [
          {
            id: "MiniMax-M3.1-Flash",
            name: "Upstream Flash Name",
            cost: { input: 99 },
            headers: { Authorization: "sentinel-upstream-key" },
            extra: "ignored",
          },
          { id: "MiniMax-M3", object: "model" },
        ],
      }),
    );
    const { context, publish } = fakeContext({
      allowNetwork: true,
      force: true,
      credential: { type: "api_key", key: "sentinel-request-key" },
    });

    const models = await refreshFor(GLOBAL)(context);

    expect(idsOf(models)).toEqual(["MiniMax-M3.1-Flash", "MiniMax-M3"]);
    expect(models[0]).not.toHaveProperty("headers");
    expect(publish).toHaveBeenCalledOnce();
    const publication = publish.mock.calls[0]?.[0];
    expect(publication?.persist?.checkedAt).toBe(NOW);
    const persisted = publication?.persist?.models ?? [];
    expect(idsOf(persisted)).toEqual(["MiniMax-M3.1-Flash", "MiniMax-M3"]);
    expect(persisted[0]).toMatchObject({
      id: "MiniMax-M3.1-Flash",
      name: "MiniMax-M3.1-Flash",
      provider: GLOBAL.provider,
      baseUrl: GLOBAL.baseUrl,
      api: GLOBAL.provider,
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 1_000_000,
      maxTokens: 524_288,
      cost: { input: 0.15, output: 0.6, cacheRead: 0.015, cacheWrite: 0 },
      compat: { supportsReasoningEffort: true, maxTokensField: "max_completion_tokens" },
      thinkingLevelMap: { low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" },
    });
    expect(persisted[0]).not.toHaveProperty("headers");
    expect(persisted[1]).toMatchObject({
      id: "MiniMax-M3",
      provider: GLOBAL.provider,
      baseUrl: GLOBAL.baseUrl,
      api: GLOBAL.provider,
      cost: {
        input: 0.3,
        output: 1.2,
        cacheRead: 0.06,
        cacheWrite: 0,
        tiers: [
          { inputTokensAbove: 512_000, input: 0.6, output: 2.4, cacheRead: 0.12, cacheWrite: 0 },
        ],
      },
    });
    expect(JSON.stringify(publication)).not.toContain("sentinel-request-key");
    expect(JSON.stringify(publication)).not.toContain("sentinel-upstream-key");
  });

  it("matches exact untrimmed IDs and ignores unrelated fields", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        object: "list",
        data: [
          { id: " MiniMax-M3 ", name: "Padded" },
          { id: "MiniMax-M3.1-Flash", created: 1, owned_by: "minimax" },
        ],
      }),
    );
    const { context, publish } = fakeContext({ allowNetwork: true, force: true });

    const models = await refreshFor(GLOBAL)(context);

    expect(idsOf(models)).toEqual(["MiniMax-M3.1-Flash"]);
    expect(publish.mock.calls[0]?.[0]?.persist?.models.map((model) => model.id)).toEqual([
      "MiniMax-M3.1-Flash",
    ]);
  });

  it.each([
    ["duplicate IDs", { object: "list", data: [{ id: "MiniMax-M3" }, { id: "MiniMax-M3" }] }],
    ["duplicate unsupported IDs", { object: "list", data: [{ id: "future" }, { id: "future" }] }],
    ["a blank ID", { object: "list", data: [{ id: "   " }] }],
    ["an empty ID", { object: "list", data: [{ id: "" }] }],
    ["a non-string ID", { object: "list", data: [{ id: 42 }] }],
    ["a null item", { object: "list", data: [null] }],
    ["an array item", { object: "list", data: [[]] }],
    ["a string item", { object: "list", data: ["MiniMax-M3"] }],
    ["a wrong envelope object", { object: "chat", data: [] }],
    ["a missing envelope object", { data: [] }],
    ["an array envelope", []],
    ["non-array data", { object: "list", data: {} }],
    ["missing data", { object: "list" }],
  ])("rejects %s without publishing", async (_label, payload) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(payload));
    const { context, publish } = fakeContext({ allowNetwork: true, force: true });

    await expect(refreshFor(GLOBAL)(context)).rejects.toThrow(
      "MiniMax model discovery returned an invalid catalog",
    );
    expect(publish).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON without publishing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"object":"list",', { status: 200 }),
    );
    const { context, publish } = fakeContext({ allowNetwork: true, force: true });

    await expect(refreshFor(GLOBAL)(context)).rejects.toThrow(
      "MiniMax model discovery returned an invalid catalog",
    );
    expect(publish).not.toHaveBeenCalled();
  });

  it("returns the prior subset when persistence is rejected", async () => {
    const prior = storedModel(GLOBAL, "MiniMax-M3");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(listResponse(["MiniMax-M3.1-Flash"]));
    const publish = vi.fn(async () => false);
    const { context } = fakeContext({
      allowNetwork: true,
      force: true,
      stored: { models: [prior], checkedAt: 0 },
      publish,
    });

    const models = await refreshFor(GLOBAL)(context);

    expect(idsOf(models)).toEqual(["MiniMax-M3"]);
    expect(publish).toHaveBeenCalledOnce();
  });

  it("returns the prior empty availability when persistence is rejected", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(listResponse(["MiniMax-M3"]));
    const publish = vi.fn(async () => false);
    const { context } = fakeContext({
      allowNetwork: true,
      force: true,
      stored: { models: [], checkedAt: 0 },
      publish,
    });

    await expect(refreshFor(GLOBAL)(context)).resolves.toEqual([]);
    expect(publish).toHaveBeenCalledOnce();
  });

  it("rejects without returning a candidate when persistence throws", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(listResponse(["MiniMax-M3.1-Flash"]));
    const publish = vi.fn(async () => {
      throw new Error("store failed with sentinel-persist-key");
    });
    const { context } = fakeContext({ allowNetwork: true, force: true, publish });

    const error = await refreshFor(GLOBAL)(context).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("MiniMax model persistence failed");
    expect(String((error as Error).cause ?? "")).not.toContain("sentinel-persist-key");
    expect(String(error)).not.toContain("sentinel-persist-key");
    expect(publish).toHaveBeenCalledOnce();
  });
});

describe("MiniMax catalog failures and cancellation", () => {
  it.each([401, 403, 429, 500])("sanitizes HTTP %i failures without publishing", async (status) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("sentinel-response-key", { status }),
    );
    const { context, publish } = fakeContext({ allowNetwork: true, force: true });

    const error = await refreshFor(GLOBAL)(context).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(String(status));
    expect(String(error)).not.toContain("sentinel-response-key");
    expect(publish).not.toHaveBeenCalled();
  });

  it("sanitizes transport failures and keeps failed checks retryable", async () => {
    const valid = listResponse(["MiniMax-M3.1-Flash"]);
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("transport failed with sentinel-transport-key"))
      .mockResolvedValueOnce(valid);
    const prior = storedModel(GLOBAL, "MiniMax-M3");
    const stored = { models: [prior], checkedAt: 0 };
    const { context, publish } = fakeContext({ allowNetwork: true, stored });

    const error = await refreshFor(GLOBAL)(context).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("MiniMax model discovery failed");
    expect(String(error)).not.toContain("sentinel-transport-key");
    expect(publish).not.toHaveBeenCalled();

    const retried = await refreshFor(GLOBAL)(
      fakeContext({ allowNetwork: true, stored, publish }).context,
    );

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(idsOf(retried)).toEqual(["MiniMax-M3.1-Flash"]);
  });

  it("rejects before any work when the caller is already aborted", async () => {
    const caller = new AbortController();
    caller.abort();
    const fetch = vi.spyOn(globalThis, "fetch");
    const { context, publish } = fakeContext({
      allowNetwork: true,
      force: true,
      signal: caller.signal,
    });

    await expect(refreshFor(GLOBAL)(context)).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("cancels a pending fetch without publishing", async () => {
    let started!: () => void;
    const fetchStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      started();
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      });
    });
    const caller = new AbortController();
    const { context, publish } = fakeContext({
      allowNetwork: true,
      force: true,
      signal: caller.signal,
    });

    const refresh = refreshFor(GLOBAL)(context);
    await fetchStarted;
    caller.abort();

    await expect(refresh).rejects.toMatchObject({ name: "AbortError" });
    expect(publish).not.toHaveBeenCalled();
  });

  it("cancels a pending body parse without publishing", async () => {
    let started!: () => void;
    const bodyStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const caller = new AbortController();
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          new Promise((_resolve, reject) => {
            started();
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
              once: true,
            });
          }),
      } as Response);
    });
    const { context, publish } = fakeContext({
      allowNetwork: true,
      force: true,
      signal: caller.signal,
    });

    const refresh = refreshFor(GLOBAL)(context);
    await bodyStarted;
    caller.abort();

    await expect(refresh).rejects.toMatchObject({ name: "AbortError" });
    expect(publish).not.toHaveBeenCalled();
  });

  it("does not publish when cancellation arrives after parsing", async () => {
    const caller = new AbortController();
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        caller.abort();
        return { object: "list", data: [{ id: "MiniMax-M3" }] };
      },
    } as Response);
    const { context, publish } = fakeContext({
      allowNetwork: true,
      force: true,
      signal: caller.signal,
    });

    await expect(refreshFor(GLOBAL)(context)).rejects.toMatchObject({ name: "AbortError" });
    expect(publish).not.toHaveBeenCalled();
  });

  it("suppresses the candidate when cancellation arrives after accepted persistence", async () => {
    const caller = new AbortController();
    const prior = storedModel(GLOBAL, "MiniMax-M3");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(listResponse(["MiniMax-M3.1-Flash"]));
    const publish = vi.fn(async () => {
      caller.abort();
      return true;
    });
    const { context } = fakeContext({
      allowNetwork: true,
      force: true,
      signal: caller.signal,
      stored: { models: [prior], checkedAt: 0 },
      publish,
    });

    const models = await refreshFor(GLOBAL)(context);

    expect(idsOf(models)).toEqual(["MiniMax-M3"]);
    expect(publish).toHaveBeenCalledOnce();
  });

  it("rejects with a sanitized timeout error and returns no candidate", async () => {
    const timeout = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
    let started!: () => void;
    const fetchStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      started();
      return new Promise((_resolve, reject) => {
        init?.signal?.throwIfAborted();
        init?.signal?.addEventListener("abort", () => reject(new Error("timed out")), {
          once: true,
        });
      });
    });
    const { context, publish } = fakeContext({ allowNetwork: true, force: true });

    const refresh = refreshFor(GLOBAL)(context);
    await fetchStarted;
    timeout.abort();

    await expect(refresh).rejects.toThrow("MiniMax model discovery timed out");
    expect(timeoutSpy).toHaveBeenCalledWith(10_000);
    expect(publish).not.toHaveBeenCalled();
  });
});
