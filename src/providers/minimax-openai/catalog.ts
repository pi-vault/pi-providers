// src/providers/minimax-openai/catalog.ts

import type { Api, Model, RefreshModelsContext } from "@earendil-works/pi-ai";
import type { ProviderConfig, ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { MINIMAX_MODELS } from "./models.ts";

const CATALOG_REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000;
const DISCOVERY_TIMEOUT_MS = 10_000;
const INVALID_CATALOG_MESSAGE = "MiniMax model discovery returned an invalid catalog";
const DISCOVERY_FAILED_MESSAGE = "MiniMax model discovery failed";
const DISCOVERY_TIMEOUT_MESSAGE = "MiniMax model discovery timed out";
const PERSISTENCE_FAILED_MESSAGE = "MiniMax model persistence failed";

type StoredCatalog = NonNullable<RefreshModelsContext["stored"]>;

type RestoredCatalog = {
  models: ProviderModelConfig[];
  compatible: boolean;
  checkedAt?: number;
};

function cloneDefinitions(definitions: readonly ProviderModelConfig[]): ProviderModelConfig[] {
  return definitions.map((definition) => structuredClone(definition));
}

function isFresh(checkedAt: number | undefined, now: number): boolean {
  return (
    checkedAt !== undefined &&
    Number.isFinite(checkedAt) &&
    checkedAt >= 0 &&
    checkedAt <= now &&
    now - checkedAt < CATALOG_REFRESH_INTERVAL_MS
  );
}

function isCompatibleRecord(
  record: Model<Api> | null | undefined,
  providerId: string,
  baseUrl: string,
): boolean {
  return (
    !!record &&
    typeof record === "object" &&
    record.provider === providerId &&
    record.baseUrl === baseUrl &&
    record.api === providerId
  );
}

function restoreCatalog(
  stored: StoredCatalog | undefined,
  providerId: string,
  baseUrl: string,
): RestoredCatalog {
  if (!stored) {
    return { models: cloneDefinitions(MINIMAX_MODELS), compatible: false };
  }

  if (!Array.isArray(stored.models)) {
    return { models: cloneDefinitions(MINIMAX_MODELS), compatible: false };
  }

  if (stored.models.length === 0) {
    return { models: [], compatible: true, checkedAt: stored.checkedAt };
  }

  if (!stored.models.every((record) => isCompatibleRecord(record, providerId, baseUrl))) {
    return { models: cloneDefinitions(MINIMAX_MODELS), compatible: false };
  }

  const cachedIds = new Set(stored.models.map((record) => record.id));
  const models = cloneDefinitions(
    MINIMAX_MODELS.filter((definition) => cachedIds.has(definition.id)),
  );

  return { models, compatible: true, checkedAt: stored.checkedAt };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function liveModelIds(value: unknown): string[] {
  if (!isObjectRecord(value) || value.object !== "list" || !Array.isArray(value.data)) {
    throw new Error(INVALID_CATALOG_MESSAGE);
  }

  const ids = value.data.map((item) => {
    if (!isObjectRecord(item) || typeof item.id !== "string" || !/\S/.test(item.id)) {
      throw new Error(INVALID_CATALOG_MESSAGE);
    }
    return item.id;
  });

  if (new Set(ids).size !== ids.length) {
    throw new Error(INVALID_CATALOG_MESSAGE);
  }

  return ids;
}

function canonicalModel(
  definition: ProviderModelConfig,
  providerId: string,
  baseUrl: string,
): Model<Api> {
  const model = structuredClone(definition) as Model<Api>;
  delete model.headers;
  return {
    ...model,
    provider: providerId,
    baseUrl,
    api: providerId as Api,
  };
}

function ensureActive(callerSignal: AbortSignal, signal: AbortSignal): void {
  if (callerSignal.aborted) callerSignal.throwIfAborted();
  if (signal.aborted) throw new Error(DISCOVERY_TIMEOUT_MESSAGE);
}

function usableApiKey(context: RefreshModelsContext): string | undefined {
  const credential = context.credential;
  if (credential?.type !== "api_key" || typeof credential.key !== "string") return undefined;
  return credential.key.trim() ? credential.key : undefined;
}

async function discoverModels(
  context: RefreshModelsContext,
  providerId: string,
  baseUrl: string,
  prior: ProviderModelConfig[],
  apiKey: string,
): Promise<ProviderModelConfig[]> {
  const signal = AbortSignal.any([context.signal, AbortSignal.timeout(DISCOVERY_TIMEOUT_MS)]);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    });
  } catch {
    ensureActive(context.signal, signal);
    throw new Error(DISCOVERY_FAILED_MESSAGE);
  }

  if (!response.ok) {
    throw new Error(`${DISCOVERY_FAILED_MESSAGE} (HTTP ${response.status})`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    ensureActive(context.signal, signal);
    throw new Error(INVALID_CATALOG_MESSAGE);
  }

  ensureActive(context.signal, signal);

  const liveIds = new Set(liveModelIds(payload));
  const candidates = cloneDefinitions(
    MINIMAX_MODELS.filter((definition) => liveIds.has(definition.id)),
  );
  const models = candidates.map((definition) => canonicalModel(definition, providerId, baseUrl));

  let published: boolean;
  try {
    published = await context.publish({
      persist: { models, checkedAt: Date.now() },
    });
  } catch {
    ensureActive(context.signal, signal);
    throw new Error(PERSISTENCE_FAILED_MESSAGE);
  }

  if (context.signal.aborted) return prior;
  ensureActive(context.signal, signal);
  return published ? candidates : prior;
}

export function createMiniMaxModelRefresh(
  providerId: string,
  baseUrl: string,
): NonNullable<ProviderConfig["refreshModels"]> {
  return async (context) => {
    context.signal.throwIfAborted();

    const restored = restoreCatalog(context.stored, providerId, baseUrl);
    const apiKey = usableApiKey(context);

    if (!context.allowNetwork || !apiKey) return restored.models;
    if (!context.force && restored.compatible && isFresh(restored.checkedAt, Date.now())) {
      return restored.models;
    }

    return discoverModels(context, providerId, baseUrl, restored.models, apiKey);
  };
}
