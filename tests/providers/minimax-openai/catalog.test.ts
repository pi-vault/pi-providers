// tests/providers/minimax-openai/catalog.test.ts

import type { Api, Model, RefreshModelsContext } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMiniMaxProvider, MINIMAX_REGIONS } from "../../../src/providers/minimax-openai.ts";
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

function idsOf(models: readonly { id: string }[]): string[] {
  return models.map((model) => model.id);
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
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
