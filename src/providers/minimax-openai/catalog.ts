// src/providers/minimax-openai/catalog.ts

import type { Api, Model, Provider, RefreshModelsContext } from "@earendil-works/pi-ai";
import { MINIMAX_MODELS, type MiniMaxModelConfig } from "./models.ts";

const CATALOG_REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000;
const DISCOVERY_TIMEOUT_MS = 10_000;
const INVALID_CATALOG_MESSAGE = "MiniMax model discovery returned an invalid catalog";
const DISCOVERY_FAILED_MESSAGE = "MiniMax model discovery failed";
const DISCOVERY_TIMEOUT_MESSAGE = "MiniMax model discovery timed out";
const PERSISTENCE_FAILED_MESSAGE = "MiniMax model persistence failed";

type StoredCatalog = NonNullable<RefreshModelsContext["stored"]>;

type RestoredCatalog = {
  models: MiniMaxModelConfig[];
  compatible: boolean;
  checkedAt?: number;
};

function cloneDefinitions(definitions: readonly MiniMaxModelConfig[]): MiniMaxModelConfig[] {
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
  definition: MiniMaxModelConfig,
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

function usableApiKey(context: RefreshModelsContext): string | undefined {
  const credential = context.credential;
  if (credential?.type !== "api_key" || typeof credential.key !== "string") return undefined;
  return credential.key.trim() ? credential.key : undefined;
}

/** Curated models for a region in curated order, optionally limited to `ids`. */
export function canonicalMiniMaxModels(
  providerId: string,
  baseUrl: string,
  ids?: ReadonlySet<string>,
): Model<Api>[] {
  return MINIMAX_MODELS.filter((definition) => !ids || ids.has(definition.id)).map((definition) =>
    canonicalModel(definition, providerId, baseUrl),
  );
}

/** Authenticated `${baseUrl}/models` discovery; the caller owns timeout and publication. */
export async function fetchMiniMaxModels(
  context: RefreshModelsContext,
  providerId: string,
  baseUrl: string,
): Promise<Model<Api>[]> {
  const apiKey = usableApiKey(context);
  if (!apiKey) throw new Error(DISCOVERY_FAILED_MESSAGE);
  const { signal } = context;

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    });
  } catch {
    signal.throwIfAborted();
    throw new Error(DISCOVERY_FAILED_MESSAGE);
  }
  if (!response.ok) throw new Error(`${DISCOVERY_FAILED_MESSAGE} (HTTP ${response.status})`);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    signal.throwIfAborted();
    throw new Error(INVALID_CATALOG_MESSAGE);
  }
  signal.throwIfAborted();

  return canonicalMiniMaxModels(providerId, baseUrl, new Set(liveModelIds(payload)));
}

/**
 * Wraps a `createProvider` provider with MiniMax catalog semantics: the model list is the curated
 * set filtered by an authoritative ID set (restored from cache or published by discovery), and
 * refresh restores, throttles, times out, and sanitizes errors.
 */
export function withMiniMaxCatalog(
  provider: Provider,
  providerId: string,
  baseUrl: string,
): Provider {
  let ids: ReadonlySet<string> | undefined; // undefined = curated baseline
  const models = () => canonicalMiniMaxModels(providerId, baseUrl, ids);
  const generatedRefresh = provider.refreshModels;

  return {
    ...provider,
    getModels: models,
    getAllModels: models,
    refreshModels: async (context) => {
      context.signal.throwIfAborted();
      const restored = restoreCatalog(context.stored, providerId, baseUrl);
      const restoredIds = restored.compatible
        ? new Set(restored.models.map((model) => model.id))
        : undefined;
      if (
        !(await context.publish({
          update: () => {
            ids = restoredIds;
          },
        }))
      ) {
        return;
      }
      if (!context.allowNetwork || !usableApiKey(context) || !generatedRefresh) return;
      if (!context.force && restored.compatible && isFresh(restored.checkedAt, Date.now())) return;

      const discovery = AbortSignal.any([
        context.signal,
        AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      ]);
      const timedOut = () => discovery.aborted && !context.signal.aborted;
      try {
        await generatedRefresh({
          ...context,
          stored: undefined,
          signal: discovery,
          publish: async (publication) => {
            const published = new Set(publication.persist?.models.map((model) => model.id) ?? []);
            try {
              return await context.publish({
                ...publication,
                update: () => {
                  if (discovery.aborted) return; // persisted after the deadline: keep prior state
                  publication.update?.();
                  ids = published;
                },
              });
            } catch {
              throw new Error(PERSISTENCE_FAILED_MESSAGE);
            }
          },
        });
      } catch (error) {
        if (timedOut()) throw new Error(DISCOVERY_TIMEOUT_MESSAGE);
        throw error;
      }
      if (timedOut()) throw new Error(DISCOVERY_TIMEOUT_MESSAGE);
    },
  };
}
