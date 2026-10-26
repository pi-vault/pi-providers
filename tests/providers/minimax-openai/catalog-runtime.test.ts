// tests/providers/minimax-openai/catalog-runtime.test.ts

import {
  InMemoryCredentialStore,
  InMemoryModelsStore,
  type Model,
  type ModelsStore,
  type ModelsStoreEntry,
  type ModelsStoreOperationOptions,
  normalizeContext,
} from "@earendil-works/pi-ai";
import { getApiProvider } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ProviderConfig } from "@earendil-works/pi-coding-agent";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerMiniMax } from "../../../src/providers/minimax-openai.ts";

const GLOBAL = {
  provider: "minimax-openai",
  baseUrl: "https://api.minimax.io/v1",
  env: "MINIMAX_API_KEY",
} as const;
const CHINA = {
  provider: "minimax-openai-cn",
  baseUrl: "https://api.minimaxi.com/v1",
  env: "MINIMAX_CN_API_KEY",
} as const;
const REGIONS = [GLOBAL, CHINA] as const;
const BASELINE = ["MiniMax-M3.1-Flash", "MiniMax-M3"];

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function listResponse(ids: string[]): Response {
  return jsonResponse({ object: "list", data: ids.map((id) => ({ id })) });
}

function sse(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function chunk(model: string, delta: Record<string, unknown>, finishReason: string | null = null) {
  return `data: ${JSON.stringify({
    id: "chatcmpl-minimax-runtime-test",
    object: "chat.completion.chunk",
    created: 0,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

function usageChunk(model: string) {
  return `data: ${JSON.stringify({
    id: "chatcmpl-minimax-runtime-test",
    object: "chat.completion.chunk",
    created: 0,
    model,
    choices: [],
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
  })}\n\n`;
}

function simpleResponse(model: string): Response {
  return sse(
    [
      chunk(model, { reasoning_content: "thinking" }),
      chunk(model, { content: "answer" }),
      chunk(model, {}, "stop"),
      usageChunk(model),
      "data: [DONE]\n\n",
    ].join(""),
  );
}

function idsOf(models: readonly { id: string }[]): string[] {
  return models.map((model) => model.id);
}

type Host = {
  runtime: ModelRuntime;
  modelsStore: ModelsStore;
  credentials: InMemoryCredentialStore;
  configs: Map<string, ProviderConfig>;
};

async function createHost(modelsStore: ModelsStore = new InMemoryModelsStore()): Promise<Host> {
  const credentials = new InMemoryCredentialStore();
  for (const region of REGIONS) {
    await credentials.modify(region.provider, async () => ({
      type: "api_key",
      key: `${region.provider}-test-key`,
    }));
  }

  const runtime = await ModelRuntime.create({
    credentials,
    modelsStore,
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  const configs = new Map<string, ProviderConfig>();
  const pi = {
    registerProvider(providerId: string, config: ProviderConfig) {
      configs.set(providerId, config);
      runtime.registerProvider(providerId, config);
    },
  } as unknown as ExtensionAPI;

  registerMiniMax(pi);
  return { runtime, modelsStore, credentials, configs };
}

function wrapPersistence(
  host: Host,
  providerId: string,
  publish: (publication: unknown) => Promise<boolean>,
) {
  const config = host.configs.get(providerId);
  if (!config?.refreshModels) throw new Error(`Missing refresh callback for ${providerId}`);
  const original = config.refreshModels;
  host.runtime.registerProvider(providerId, {
    ...config,
    refreshModels: (context) =>
      original({
        ...context,
        publish: (publication) => publish(publication),
      }),
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for condition");
}

class SignalAwareModelsStore implements ModelsStore {
  entry: ModelsStoreEntry | undefined;
  writeStarted: (() => void) | undefined;

  read(_providerId: string, _options?: ModelsStoreOperationOptions) {
    return Promise.resolve(this.entry);
  }

  write(
    _providerId: string,
    entry: ModelsStoreEntry,
    options?: ModelsStoreOperationOptions,
  ): Promise<void> {
    this.writeStarted?.();
    return new Promise((resolve, reject) => {
      const signal = options?.signal;
      const fail = () => reject(signal?.reason ?? new Error("cancelled"));
      if (signal?.aborted) {
        fail();
        return;
      }
      signal?.addEventListener("abort", fail, { once: true });
      setTimeout(() => {
        if (signal?.aborted) return;
        this.entry = entry;
        resolve();
      }, 10);
    });
  }

  delete(_providerId: string, _options?: ModelsStoreOperationOptions) {
    this.entry = undefined;
    return Promise.resolve();
  }
}

beforeEach(() => {
  for (const region of REGIONS) vi.stubEnv(region.env, undefined);
  vi.stubEnv("PI_OFFLINE", undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("MiniMax discovery in the real Pi host", () => {
  it("replaces the baseline through accepted publication and restores the subset offline", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(listResponse(["MiniMax-M3"]));
    const host = await createHost();

    expect(idsOf(host.runtime.getModels(GLOBAL.provider))).toEqual(BASELINE);
    const result = await host.runtime.refresh({
      providers: [GLOBAL.provider],
      allowNetwork: true,
      force: true,
    });

    expect(result.errors.size).toBe(0);
    expect(idsOf(host.runtime.getModels(GLOBAL.provider))).toEqual(["MiniMax-M3"]);
    const stored = await host.modelsStore.read(GLOBAL.provider);
    expect(stored?.checkedAt).toEqual(expect.any(Number));
    expect(idsOf(stored?.models ?? [])).toEqual(["MiniMax-M3"]);
    expect(stored?.models[0]).toMatchObject({
      provider: GLOBAL.provider,
      baseUrl: GLOBAL.baseUrl,
      api: GLOBAL.provider,
      name: "MiniMax-M3",
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
    });

    const restarted = await createHost(host.modelsStore);
    await restarted.runtime.refresh({ providers: [GLOBAL.provider], allowNetwork: false });

    expect(idsOf(restarted.runtime.getModels(GLOBAL.provider))).toEqual(["MiniMax-M3"]);
    expect(restarted.runtime.getModel(GLOBAL.provider, "MiniMax-M3")?.cost.input).toBe(0.3);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("restores an authoritative empty result and all-unsupported availability offline", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(listResponse([]))
      .mockResolvedValueOnce(listResponse(["MiniMax-M2.7", "future-minimax-model"]));
    const host = await createHost();

    const empty = await host.runtime.refresh({
      providers: [GLOBAL.provider],
      allowNetwork: true,
      force: true,
    });
    expect(empty.errors.size).toBe(0);
    expect(host.runtime.getModels(GLOBAL.provider)).toEqual([]);
    expect((await host.modelsStore.read(GLOBAL.provider))?.models).toEqual([]);

    const unsupported = await host.runtime.refresh({
      providers: [CHINA.provider],
      allowNetwork: true,
      force: true,
    });
    expect(unsupported.errors.size).toBe(0);
    expect(host.runtime.getModels(CHINA.provider)).toEqual([]);

    const restarted = await createHost(host.modelsStore);
    await restarted.runtime.refresh({
      providers: [GLOBAL.provider, CHINA.provider],
      allowNetwork: false,
    });
    expect(restarted.runtime.getModels(GLOBAL.provider)).toEqual([]);
    expect(restarted.runtime.getModels(CHINA.provider)).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps regional catalogs and credentials separate", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) =>
        String(input).includes("minimaxi.com")
          ? listResponse([])
          : listResponse(["MiniMax-M3.1-Flash"]),
      );
    const host = await createHost();

    await host.runtime.refresh({
      providers: [GLOBAL.provider],
      allowNetwork: true,
      force: true,
    });
    expect(idsOf(host.runtime.getModels(GLOBAL.provider))).toEqual(["MiniMax-M3.1-Flash"]);
    expect(idsOf(host.runtime.getModels(CHINA.provider))).toEqual(BASELINE);

    await host.runtime.refresh({
      providers: [CHINA.provider],
      allowNetwork: true,
      force: true,
    });
    expect(idsOf(host.runtime.getModels(GLOBAL.provider))).toEqual(["MiniMax-M3.1-Flash"]);
    expect(host.runtime.getModels(CHINA.provider)).toEqual([]);

    expect(fetch).toHaveBeenCalledTimes(2);
    const [globalInit, chinaInit] = fetch.mock.calls.map(([, init]) => init as RequestInit);
    expect(new Headers(globalInit.headers).get("authorization")).toBe(
      `Bearer ${GLOBAL.provider}-test-key`,
    );
    expect(new Headers(chinaInit.headers).get("authorization")).toBe(
      `Bearer ${CHINA.provider}-test-key`,
    );
    expect((await host.modelsStore.read(GLOBAL.provider))?.models.map((model) => model.id)).toEqual(
      ["MiniMax-M3.1-Flash"],
    );
    expect((await host.modelsStore.read(CHINA.provider))?.models).toEqual([]);
  });

  it("throttles a fresh successful catalog and fetches again when forced", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => listResponse(["MiniMax-M3"]));
    const host = await createHost();

    await host.runtime.refresh({
      providers: [GLOBAL.provider],
      allowNetwork: true,
      force: true,
    });
    expect(fetch).toHaveBeenCalledOnce();

    const fresh = await host.runtime.refresh({ providers: [GLOBAL.provider] });
    expect(fresh.errors.size).toBe(0);
    expect(fetch).toHaveBeenCalledOnce();
    expect(idsOf(host.runtime.getModels(GLOBAL.provider))).toEqual(["MiniMax-M3"]);

    const forced = await host.runtime.refresh({
      providers: [GLOBAL.provider],
      force: true,
    });
    expect(forced.errors.size).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("preserves prior models and their successful timestamp after a failed online refresh", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(listResponse(["MiniMax-M3"]))
      .mockResolvedValueOnce(new Response("upstream failure", { status: 503 }));
    const host = await createHost();

    await host.runtime.refresh({
      providers: [GLOBAL.provider],
      allowNetwork: true,
      force: true,
    });
    const checkedAt = (await host.modelsStore.read(GLOBAL.provider))?.checkedAt;

    const failed = await host.runtime.refresh({
      providers: [GLOBAL.provider],
      allowNetwork: true,
      force: true,
    });

    expect(failed.errors.has(GLOBAL.provider)).toBe(true);
    expect(failed.errors.get(GLOBAL.provider)?.message).not.toContain("upstream failure");
    expect(idsOf(host.runtime.getModels(GLOBAL.provider))).toEqual(["MiniMax-M3"]);
    const stored = await host.modelsStore.read(GLOBAL.provider);
    expect(idsOf(stored?.models ?? [])).toEqual(["MiniMax-M3"]);
    expect(stored?.checkedAt).toBe(checkedAt);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("installs neither the runtime nor the store catalog when callback persistence is rejected", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(listResponse(["MiniMax-M3"]));
    const host = await createHost();
    wrapPersistence(host, GLOBAL.provider, async () => false);

    const result = await host.runtime.refresh({
      providers: [GLOBAL.provider],
      allowNetwork: true,
      force: true,
    });

    expect(result.errors.size).toBe(0);
    expect(idsOf(host.runtime.getModels(GLOBAL.provider))).toEqual(BASELINE);
    expect(await host.modelsStore.read(GLOBAL.provider)).toBeUndefined();
  });

  it("keeps prior catalog state when callback persistence throws", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(listResponse(["MiniMax-M3"]));
    const host = await createHost();
    wrapPersistence(host, GLOBAL.provider, async () => {
      throw new Error("sentinel-runtime-persist-key");
    });

    const result = await host.runtime.refresh({
      providers: [GLOBAL.provider],
      allowNetwork: true,
      force: true,
    });

    expect(result.errors.has(GLOBAL.provider)).toBe(true);
    expect(result.errors.get(GLOBAL.provider)?.message).toBe("MiniMax model persistence failed");
    expect(String(result.errors.get(GLOBAL.provider))).not.toContain(
      "sentinel-runtime-persist-key",
    );
    expect(idsOf(host.runtime.getModels(GLOBAL.provider))).toEqual(BASELINE);
    expect(await host.modelsStore.read(GLOBAL.provider)).toBeUndefined();
  });

  it("lets the newer of two concurrent forced refreshes win", async () => {
    const older = deferred<Response>();
    const newer = deferred<Response>();
    let calls = 0;
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      calls += 1;
      return calls === 1 ? older.promise : newer.promise;
    });
    const host = await createHost();

    const first = host.runtime.refresh({
      providers: [GLOBAL.provider],
      allowNetwork: true,
      force: true,
    });
    await waitFor(() => calls === 1);

    const second = host.runtime.refresh({
      providers: [GLOBAL.provider],
      allowNetwork: true,
      force: true,
    });
    await waitFor(() => calls === 2);

    newer.resolve(listResponse(["MiniMax-M3"]));
    await second;
    expect(idsOf(host.runtime.getModels(GLOBAL.provider))).toEqual(["MiniMax-M3"]);
    const newerCheckedAt = (await host.modelsStore.read(GLOBAL.provider))?.checkedAt;

    older.resolve(listResponse(["MiniMax-M3.1-Flash"]));
    await first;

    expect(idsOf(host.runtime.getModels(GLOBAL.provider))).toEqual(["MiniMax-M3"]);
    const stored = await host.modelsStore.read(GLOBAL.provider);
    expect(idsOf(stored?.models ?? [])).toEqual(["MiniMax-M3"]);
    expect(stored?.checkedAt).toBe(newerCheckedAt);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("suppresses a pending cancelled write and leaves the runtime unchanged", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(listResponse(["MiniMax-M3"]));
    const modelsStore = new SignalAwareModelsStore();
    const writeStarted = deferred<void>();
    modelsStore.writeStarted = () => writeStarted.resolve(undefined);
    const host = await createHost(modelsStore);
    const caller = new AbortController();

    const refresh = host.runtime.refresh({
      providers: [GLOBAL.provider],
      allowNetwork: true,
      force: true,
      signal: caller.signal,
    });
    await writeStarted.promise;
    caller.abort();

    expect(await refresh).toMatchObject({ aborted: true, errors: new Map() });
    expect(idsOf(host.runtime.getModels(GLOBAL.provider))).toEqual(BASELINE);
    expect(modelsStore.entry).toBeUndefined();
  });

  it("dispatches refreshed models through the registered MiniMax stream handler", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(listResponse(["MiniMax-M3.1-Flash"]));
    const host = await createHost();
    await host.runtime.refresh({
      providers: [GLOBAL.provider],
      allowNetwork: true,
      force: true,
    });

    const model = host.runtime.getModel(
      GLOBAL.provider,
      "MiniMax-M3.1-Flash",
    ) as Model<"minimax-openai">;
    expect(model).toBeDefined();

    const driver = getApiProvider("openai-completions");
    if (!driver) throw new Error("openai-completions driver is not registered");
    const streamSimple = vi.spyOn(driver, "streamSimple");
    const fetch = vi.fn(async () => simpleResponse(model.id));

    const stream = host.runtime.streamSimple(
      model,
      normalizeContext({
        messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
      }),
      { apiKey: "test-key", fetch, maxRetries: 0 },
    );
    for await (const _event of stream) {
      // Consume the stream so lazy dispatch reaches the real driver.
    }
    await stream.result();

    expect(fetch).toHaveBeenCalledOnce();
    expect(streamSimple).toHaveBeenCalledOnce();
    expect(streamSimple.mock.calls[0]?.[0]).toMatchObject({
      id: "MiniMax-M3.1-Flash",
      provider: GLOBAL.provider,
      baseUrl: GLOBAL.baseUrl,
      api: "openai-completions",
    });
  });
});
