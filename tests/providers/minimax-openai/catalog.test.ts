// tests/providers/minimax-openai/catalog.test.ts

import type {
  Api,
  Model,
  OpenAICompletionsCompat,
  RefreshModelsContext,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMiniMaxProvider, MINIMAX_REGIONS } from "../../../src/providers/minimax-openai.ts";
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

  it.each([true, false])(
    "reports a timeout when persistence completes with %s after the deadline",
    async (accepted) => {
      const timeout = new AbortController();
      vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
      vi.spyOn(globalThis, "fetch").mockResolvedValue(listResponse(["MiniMax-M3.1-Flash"]));
      const { context } = fakeContext({
        allowNetwork: true,
        force: true,
        stored: { models: [storedModel(GLOBAL, "MiniMax-M3")], checkedAt: 0 },
        publish: async () => {
          timeout.abort(new Error("sentinel-timeout-key"));
          return accepted;
        },
      });

      const error = await refreshFor(GLOBAL)(context).catch((cause: unknown) => cause);

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("MiniMax model discovery timed out");
      expect(String(error)).not.toContain("sentinel-timeout-key");
      expect((error as Error).cause).toBeUndefined();
    },
  );
});

describe("MiniMax native catalog", () => {
  type Publication = Parameters<Publish>[0];

  function providerFor(region: Region) {
    const found = MINIMAX_REGIONS.find((candidate) => candidate.id === region.provider);
    if (!found) throw new Error(`Unknown region ${region.provider}`);
    return createMiniMaxProvider(found);
  }

  /** Applies updates like Pi does; `onPersist` handles publications that persist. */
  function publisher(onPersist?: (publication: Publication) => Promise<boolean>) {
    return vi.fn(async (publication: Publication) => {
      if (publication.persist && onPersist) return onPersist(publication);
      publication.update?.();
      return true;
    });
  }

  async function refresh(region: Region, options: ContextOptions = {}) {
    const provider = providerFor(region);
    const publish = options.publish ?? publisher();
    const { context } = fakeContext({ ...options, publish });
    const result = await provider.refreshModels?.(context).then(
      () => undefined,
      (error: unknown) => error,
    );
    const persisted = (publish as unknown as PublishSpy).mock.calls
      .map(([publication]) => publication)
      .filter((publication) => publication.persist);
    return {
      provider,
      error: result as Error | undefined,
      ids: idsOf(provider.getModels()),
      persisted,
    };
  }

  const online = { allowNetwork: true, force: true } as const;
  const BASELINE_IDS = ["MiniMax-M3.1-Flash", "MiniMax-M3"];

  it("exposes the canonical curated baseline before any refresh", () => {
    const provider = providerFor(GLOBAL);
    expect(idsOf(provider.getModels())).toEqual(BASELINE_IDS);
    for (const model of provider.getModels()) {
      expect(model).toMatchObject({
        provider: GLOBAL.provider,
        baseUrl: GLOBAL.baseUrl,
        api: GLOBAL.provider,
      });
      expect(model).not.toHaveProperty("headers");
    }
  });

  it("returns independent models per region and per call", () => {
    const global = providerFor(GLOBAL).getModels();
    const china = providerFor(CHINA).getModels();
    const again = providerFor(GLOBAL).getModels();
    const tier = global[1].cost.tiers?.[0];
    if (!tier) throw new Error("Missing M3 tier");
    global[0].cost.input = 99;
    tier.input = 99;
    expect(china[0].cost.input).toBe(0.15);
    expect(again[0].cost.input).toBe(0.15);
    expect(china[1].cost.tiers?.[0]?.input).toBe(0.6);
  });

  it("restores a compatible cached subset without a key or network", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const stored = storedModel(GLOBAL, "MiniMax-M3", {
      name: "Old M3 Name",
      cost: { input: 9, output: 9, cacheRead: 9, cacheWrite: 9, tiers: [] },
      headers: { "x-old-header": "old" },
    });
    const { provider, ids, persisted } = await refresh(GLOBAL, {
      credential: undefined,
      stored: { models: [stored], checkedAt: NOW },
    });
    expect(ids).toEqual(["MiniMax-M3"]);
    expect(provider.getModels()[0]).toMatchObject({ name: "MiniMax-M3", cost: { input: 0.3 } });
    expect(provider.getModels()[0]).not.toHaveProperty("headers");
    expect(fetch).not.toHaveBeenCalled();
    expect(persisted).toEqual([]);
  });

  it("restores empty and all-unsupported caches as empty", async () => {
    const unknown = { ...storedModel(GLOBAL, "MiniMax-M3"), id: "MiniMax-M2.7" };
    expect((await refresh(GLOBAL, { stored: { models: [], checkedAt: NOW } })).ids).toEqual([]);
    expect((await refresh(GLOBAL, { stored: { models: [unknown], checkedAt: NOW } })).ids).toEqual(
      [],
    );
  });

  it("rejects incompatible caches and keeps the baseline", async () => {
    const caches = [
      [storedModel(GLOBAL, "MiniMax-M3", { provider: "other-provider" })],
      [storedModel(GLOBAL, "MiniMax-M3", { baseUrl: "https://example.test/v1" })],
      [storedModel(GLOBAL, "MiniMax-M3", { api: "openai-completions" })],
      [storedModel(GLOBAL, "MiniMax-M3"), storedModel(CHINA, "MiniMax-M3.1-Flash")],
    ];
    for (const models of caches) {
      const { ids } = await refresh(GLOBAL, { stored: { models, checkedAt: NOW } });
      expect(ids).toEqual(BASELINE_IDS);
    }
  });

  it("selects unique known IDs in curated order", async () => {
    const models = [
      storedModel(GLOBAL, "MiniMax-M3"),
      storedModel(GLOBAL, "MiniMax-M3.1-Flash"),
      storedModel(GLOBAL, "MiniMax-M3"),
    ];
    expect((await refresh(GLOBAL, { stored: { models, checkedAt: NOW } })).ids).toEqual(
      BASELINE_IDS,
    );
  });

  it("requests each regional endpoint with its own key and no ZDR header", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(listResponse([]))
      .mockResolvedValueOnce(listResponse([]));
    await refresh(GLOBAL, { ...online, credential: { type: "api_key", key: GLOBAL.key } });
    await refresh(CHINA, { ...online, credential: { type: "api_key", key: CHINA.key } });

    expect(fetch.mock.calls.map(([input]) => String(input))).toEqual([
      "https://api.minimax.io/v1/models",
      "https://api.minimaxi.com/v1/models",
    ]);
    const [globalInit, chinaInit] = fetch.mock.calls.map(([, init]) => init as RequestInit);
    expect(globalInit.method).toBe("GET");
    expect(new Headers(globalInit.headers).get("authorization")).toBe(`Bearer ${GLOBAL.key}`);
    expect(new Headers(chinaInit.headers).get("authorization")).toBe(`Bearer ${CHINA.key}`);
    expect(new Headers(globalInit.headers).get("x-cmd-zdr")).toBeNull();
    expect(globalInit.signal).toBeInstanceOf(AbortSignal);
  });

  it("performs no request offline or without a usable API-key credential", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const scenarios: ContextOptions[] = [
      { allowNetwork: false, force: true },
      { ...online, credential: undefined },
      { ...online, credential: { type: "oauth" } as never },
      { ...online, credential: { type: "api_key", key: "   " } },
      { ...online, credential: { type: "api_key", key: "" } },
    ];
    for (const scenario of scenarios) {
      const { ids, persisted } = await refresh(GLOBAL, scenario);
      expect(ids).toEqual(BASELINE_IDS);
      expect(persisted).toEqual([]);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("throttles only a fresh compatible cache with a valid timestamp, and force bypasses it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const target = storedModel(GLOBAL, "MiniMax-M3");
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => listResponse(["MiniMax-M3"]));
    const run = (checkedAt: number | undefined, extra: ContextOptions = {}) =>
      refresh(GLOBAL, {
        allowNetwork: true,
        stored: { models: [target], ...(checkedAt === undefined ? {} : { checkedAt }) },
        ...extra,
      });

    expect((await run(NOW - (FOUR_HOURS - 1))).ids).toEqual(["MiniMax-M3"]);
    expect(fetch).not.toHaveBeenCalled();
    await run(NOW - FOUR_HOURS);
    expect(fetch).toHaveBeenCalledTimes(1);
    await run(NOW, { force: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const stale of [undefined, Number.NaN, Number.POSITIVE_INFINITY, -1, NOW + 1]) {
      await run(stale);
    }
    expect(fetch).toHaveBeenCalledTimes(7);
  });

  it("fetches despite a fresh incompatible cache", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(listResponse(["MiniMax-M3"]));
    const { ids } = await refresh(GLOBAL, {
      allowNetwork: true,
      stored: { models: [storedModel(CHINA, "MiniMax-M3")], checkedAt: NOW },
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(ids).toEqual(["MiniMax-M3"]);
  });

  it("returns live IDs in curated order and ignores unrelated or padded IDs", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      listResponse(["MiniMax-M3", "MiniMax-M3.1-Flash"]),
    );
    expect((await refresh(GLOBAL, online)).ids).toEqual(BASELINE_IDS);

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        object: "list",
        data: [{ id: " MiniMax-M3 " }, { id: "MiniMax-M3.1-Flash", owned_by: "minimax" }],
      }),
    );
    expect((await refresh(GLOBAL, online)).ids).toEqual(["MiniMax-M3.1-Flash"]);
  });

  it("accepts empty and all-unsupported availability as authoritative empty lists", async () => {
    for (const ids of [[], ["MiniMax-M2.7", "future-minimax-model"]]) {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(listResponse(ids));
      const result = await refresh(GLOBAL, online);
      expect(result.error).toBeUndefined();
      expect(result.ids).toEqual([]);
      expect(result.persisted).toHaveLength(1);
      expect(result.persisted[0]).toMatchObject({ persist: { models: [] } });
    }
  });

  it("persists exactly the 0.5.0 record shape without cached or upstream extras", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        object: "list",
        data: [
          {
            id: "MiniMax-M3.1-Flash",
            name: "Upstream Flash Name",
            headers: { Authorization: "sentinel-upstream-key" },
          },
          { id: "MiniMax-M3" },
        ],
      }),
    );
    const { persisted, ids } = await refresh(GLOBAL, {
      ...online,
      credential: { type: "api_key", key: "sentinel-request-key" },
    });

    expect(ids).toEqual(BASELINE_IDS);
    expect(persisted).toHaveLength(1);
    const persist = persisted[0]?.persist;
    expect(persist?.checkedAt).toBe(NOW);
    expect(persist?.models[0]).toMatchObject({
      id: "MiniMax-M3.1-Flash",
      name: "MiniMax-M3.1-Flash",
      provider: GLOBAL.provider,
      baseUrl: GLOBAL.baseUrl,
      api: GLOBAL.provider,
      cost: { input: 0.15, output: 0.6, cacheRead: 0.015, cacheWrite: 0 },
    });
    expect(persist?.models[0]).not.toHaveProperty("headers");
    expect(JSON.stringify(persisted)).not.toContain("sentinel-request-key");
    expect(JSON.stringify(persisted)).not.toContain("sentinel-upstream-key");
  });

  it.each([
    ["duplicate IDs", { object: "list", data: [{ id: "MiniMax-M3" }, { id: "MiniMax-M3" }] }],
    ["a blank ID", { object: "list", data: [{ id: "   " }] }],
    ["a non-string ID", { object: "list", data: [{ id: 42 }] }],
    ["a null item", { object: "list", data: [null] }],
    ["a wrong envelope object", { object: "chat", data: [] }],
    ["an array envelope", []],
    ["missing data", { object: "list" }],
  ])("rejects %s without persisting", async (_label, payload) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(payload));
    const result = await refresh(GLOBAL, online);
    expect(result.error?.message).toBe("MiniMax model discovery returned an invalid catalog");
    expect(result.persisted).toEqual([]);
    expect(result.ids).toEqual(BASELINE_IDS);
  });

  it("rejects malformed JSON without persisting", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"object":"list",', { status: 200 }),
    );
    const result = await refresh(GLOBAL, online);
    expect(result.error?.message).toBe("MiniMax model discovery returned an invalid catalog");
    expect(result.persisted).toEqual([]);
  });

  it("keeps the prior subset when persistence is rejected", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(listResponse(["MiniMax-M3.1-Flash"]));
    const result = await refresh(GLOBAL, {
      ...online,
      stored: { models: [storedModel(GLOBAL, "MiniMax-M3")], checkedAt: 0 },
      publish: publisher(async () => false),
    });
    expect(result.error).toBeUndefined();
    expect(result.ids).toEqual(["MiniMax-M3"]);
  });

  it("keeps the prior empty availability when persistence is rejected", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(listResponse(["MiniMax-M3"]));
    const result = await refresh(GLOBAL, {
      ...online,
      stored: { models: [], checkedAt: 0 },
      publish: publisher(async () => false),
    });
    expect(result.ids).toEqual([]);
  });

  it("sanitizes a persistence failure and keeps prior state", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(listResponse(["MiniMax-M3.1-Flash"]));
    const result = await refresh(GLOBAL, {
      ...online,
      publish: publisher(async () => {
        throw new Error("store failed with sentinel-persist-key");
      }),
    });
    expect(result.error?.message).toBe("MiniMax model persistence failed");
    expect(String(result.error)).not.toContain("sentinel-persist-key");
    expect(result.error?.cause).toBeUndefined();
    expect(result.ids).toEqual(BASELINE_IDS);
  });

  it.each([401, 403, 429, 500])("sanitizes HTTP %i failures", async (status) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("sentinel-response-key", { status }),
    );
    const result = await refresh(GLOBAL, online);
    expect(result.error?.message).toBe(`MiniMax model discovery failed (HTTP ${status})`);
    expect(String(result.error)).not.toContain("sentinel-response-key");
    expect(result.persisted).toEqual([]);
  });

  it("sanitizes transport failures and stays retryable without a failed-check timestamp", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("transport failed with sentinel-transport-key"))
      .mockResolvedValueOnce(listResponse(["MiniMax-M3.1-Flash"]));
    const stored = { models: [storedModel(GLOBAL, "MiniMax-M3")], checkedAt: 0 };

    const failed = await refresh(GLOBAL, { allowNetwork: true, stored });
    expect(failed.error?.message).toBe("MiniMax model discovery failed");
    expect(String(failed.error)).not.toContain("sentinel-transport-key");
    expect(failed.persisted).toEqual([]);
    expect(failed.ids).toEqual(["MiniMax-M3"]);

    const retried = await refresh(GLOBAL, { allowNetwork: true, stored });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(retried.ids).toEqual(["MiniMax-M3.1-Flash"]);
  });

  it("rejects before any work when the caller is already aborted", async () => {
    const caller = new AbortController();
    caller.abort();
    const fetch = vi.spyOn(globalThis, "fetch");
    const result = await refresh(GLOBAL, { ...online, signal: caller.signal });
    expect(result.error).toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
    expect(result.persisted).toEqual([]);
  });

  it("cancels a pending fetch without persisting", async () => {
    let started!: () => void;
    const fetchStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      started();
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    });
    const caller = new AbortController();
    const pending = refresh(GLOBAL, { ...online, signal: caller.signal });
    await fetchStarted;
    caller.abort();
    const result = await pending;
    expect(result.error).toMatchObject({ name: "AbortError" });
    expect(result.persisted).toEqual([]);
  });

  it("cancels a pending body parse and a cancellation after parsing without persisting", async () => {
    const caller = new AbortController();
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        caller.abort();
        return { object: "list", data: [{ id: "MiniMax-M3" }] };
      },
    } as Response);
    const result = await refresh(GLOBAL, { ...online, signal: caller.signal });
    expect(result.error).toMatchObject({ name: "AbortError" });
    expect(result.persisted).toEqual([]);
    expect(result.ids).toEqual(BASELINE_IDS);
  });

  it("leaves the runtime unchanged when cancelled after accepted persistence", async () => {
    const caller = new AbortController();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(listResponse(["MiniMax-M3.1-Flash"]));
    const result = await refresh(GLOBAL, {
      ...online,
      signal: caller.signal,
      stored: { models: [storedModel(GLOBAL, "MiniMax-M3")], checkedAt: 0 },
      publish: publisher(async () => {
        caller.abort();
        return true; // accepted, but the update is never applied
      }),
    });
    expect(result.ids).toEqual(["MiniMax-M3"]);
  });

  it("reports a sanitized timeout while the request is pending", async () => {
    const timeout = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
    let started!: () => void;
    const fetchStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      started();
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("timed out")), {
          once: true,
        });
      });
    });
    const pending = refresh(GLOBAL, online);
    await fetchStarted;
    timeout.abort();
    const result = await pending;
    expect(result.error?.message).toBe("MiniMax model discovery timed out");
    expect(timeoutSpy).toHaveBeenCalledWith(10_000);
    expect(result.persisted).toEqual([]);
  });

  it.each([true, false])(
    "reports a timeout and keeps prior models when persistence completes with %s after the deadline",
    async (accepted) => {
      const timeout = new AbortController();
      vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
      vi.spyOn(globalThis, "fetch").mockResolvedValue(listResponse(["MiniMax-M3.1-Flash"]));
      const result = await refresh(GLOBAL, {
        ...online,
        stored: { models: [storedModel(GLOBAL, "MiniMax-M3")], checkedAt: 0 },
        publish: publisher(async (publication) => {
          timeout.abort(new Error("sentinel-timeout-key"));
          if (accepted) publication.update?.();
          return accepted;
        }),
      });
      expect(result.error?.message).toBe("MiniMax model discovery timed out");
      expect(String(result.error)).not.toContain("sentinel-timeout-key");
      expect(result.error?.cause).toBeUndefined();
      expect(result.ids).toEqual(["MiniMax-M3"]);
    },
  );
});
