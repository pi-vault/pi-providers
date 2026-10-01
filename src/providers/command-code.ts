import {
  anthropicMessagesApi,
  createProvider,
  envApiKeyAuth,
  openAICompletionsApi,
  openAIResponsesApi,
  type Provider,
  type RefreshModelsContext,
} from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  COMMAND_CODE_BASE_URL,
  COMMAND_CODE_FALLBACK_MAX_TOKENS,
  commandCodeModels,
  type CommandCodeCatalogRecord,
  modelFromCatalogRecord,
} from "./command-code/models.ts";

const CATALOG_REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000;
const COMMAND_CODE_CATALOG_VERSION = 1;
const DEFAULT_COMMAND_CODE_MODELS_URL = `${COMMAND_CODE_BASE_URL}/models`;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

type CommandCodeStoredCatalog = NonNullable<RefreshModelsContext["stored"]> & {
  commandCodeCatalogVersion?: number;
  commandCodeModelsUrl?: string;
};

function versionedCatalogEntry(entry: CommandCodeStoredCatalog) {
  const stored = entry;
  return {
    ...stored,
    commandCodeCatalogVersion: COMMAND_CODE_CATALOG_VERSION,
    commandCodeModelsUrl: stored.commandCodeModelsUrl ?? DEFAULT_COMMAND_CODE_MODELS_URL,
  };
}

function migrateStoredCatalog(stored: RefreshModelsContext["stored"]) {
  const versioned = stored as CommandCodeStoredCatalog | undefined;
  if (!versioned || versioned.commandCodeCatalogVersion === COMMAND_CODE_CATALOG_VERSION) {
    return { stored, migrated: false };
  }

  return {
    stored: versionedCatalogEntry({
      ...versioned,
      models: versioned.models.map((model) =>
        model.provider === "command-code"
          ? {
              ...model,
              maxTokens: Math.min(COMMAND_CODE_FALLBACK_MAX_TOKENS, model.contextWindow),
            }
          : model,
      ),
    }),
    migrated: true,
  };
}

function parseCommandCodeModels(value: unknown) {
  const payload = value as { object?: unknown; data?: unknown };
  if (
    !value ||
    typeof value !== "object" ||
    payload.object !== "list" ||
    !Array.isArray(payload.data) ||
    payload.data.length === 0
  ) {
    throw new Error("Invalid Command Code model catalog");
  }

  const records: CommandCodeCatalogRecord[] = payload.data.map((entry) => {
    if (!entry || typeof entry !== "object") throw new Error("Invalid Command Code model catalog");

    const {
      id,
      name,
      context_length,
      max_output_tokens,
      supported_endpoints,
      pricing,
      modalities,
      reasoning,
    } = entry as Record<string, unknown>;
    if (
      typeof id !== "string" ||
      !id.trim() ||
      typeof name !== "string" ||
      !name.trim() ||
      typeof context_length !== "number" ||
      !Number.isInteger(context_length) ||
      context_length <= 0 ||
      (max_output_tokens !== undefined &&
        (typeof max_output_tokens !== "number" ||
          !Number.isInteger(max_output_tokens) ||
          max_output_tokens <= 0)) ||
      !Array.isArray(supported_endpoints) ||
      !supported_endpoints.every((endpoint) => typeof endpoint === "string")
    ) {
      throw new Error("Invalid Command Code model catalog");
    }

    let cost: CommandCodeCatalogRecord["cost"];
    if (pricing !== undefined) {
      if (!isObjectRecord(pricing)) throw new Error("Invalid Command Code model catalog");
      const { input, output, cache_read, cache_write } = pricing;
      const prices = [input, output, cache_read, cache_write];
      if (
        prices.some(
          (price) =>
            price !== undefined &&
            (typeof price !== "number" || !Number.isFinite(price) || price < 0),
        )
      ) {
        throw new Error("Invalid Command Code model catalog");
      }
      cost = {
        input: (input as number | undefined) ?? 0,
        output: (output as number | undefined) ?? 0,
        cacheRead: (cache_read as number | undefined) ?? 0,
        cacheWrite: (cache_write as number | undefined) ?? 0,
      };
    }

    let input: ("text" | "image")[] | undefined;
    if (modalities !== undefined) {
      if (!isObjectRecord(modalities)) throw new Error("Invalid Command Code model catalog");
      const modalityInput = modalities.input;
      if (modalityInput !== undefined) {
        if (
          !Array.isArray(modalityInput) ||
          !modalityInput.every((value) => typeof value === "string")
        ) {
          throw new Error("Invalid Command Code model catalog");
        }
        input = modalityInput.includes("image") ? ["text", "image"] : ["text"];
      }
    }

    if (reasoning !== undefined && typeof reasoning !== "boolean") {
      throw new Error("Invalid Command Code model catalog");
    }

    return {
      id,
      name,
      contextWindow: context_length,
      supportedEndpoints: supported_endpoints,
      ...(max_output_tokens === undefined ? {} : { maxOutputTokens: max_output_tokens }),
      ...(cost === undefined ? {} : { cost }),
      ...(input === undefined ? {} : { input }),
      ...(reasoning === undefined ? {} : { reasoning }),
    };
  });

  if (new Set(records.map((record) => record.id)).size !== records.length) {
    throw new Error("Invalid Command Code model catalog: duplicate IDs");
  }

  const chatRecords = records.filter((record) =>
    record.supportedEndpoints.some(
      (endpoint) =>
        endpoint === "/messages" || endpoint === "/chat/completions" || endpoint === "/responses",
    ),
  );
  if (chatRecords.length === 0) {
    throw new Error("Invalid Command Code model catalog: no supported chat endpoints");
  }

  return chatRecords.map(modelFromCatalogRecord);
}

async function fetchCommandCodeModels(modelsUrl: string, context: RefreshModelsContext) {
  const signal = AbortSignal.any([context.signal, AbortSignal.timeout(10_000)]);
  const response = await fetch(modelsUrl, { signal });
  if (!response.ok) {
    throw new Error(`Command Code model catalog request failed: ${response.status}`);
  }

  return parseCommandCodeModels(await response.json());
}

export function createCommandCodeProvider(): Provider<
  "anthropic-messages" | "openai-completions" | "openai-responses"
> {
  const headers = process.env.CMD_ZDR === "1" ? { "x-cmd-zdr": "1" } : undefined;
  const commandCodeModelsUrl =
    process.env.CMD_MODELS_URL?.trim() || DEFAULT_COMMAND_CODE_MODELS_URL;
  let authoritativeModelIds: ReadonlySet<string> | undefined;

  const provider = createProvider({
    id: "command-code",
    name: "Command Code",
    baseUrl: COMMAND_CODE_BASE_URL,
    auth: {
      apiKey: envApiKeyAuth("Command Code API key", ["CMD_API_KEY", "COMMAND_CODE_API_KEY"]),
    },
    models: commandCodeModels,
    fetchModels: (context) => fetchCommandCodeModels(commandCodeModelsUrl, context),
    api: {
      "anthropic-messages": anthropicMessagesApi(),
      "openai-completions": openAICompletionsApi(),
      "openai-responses": openAIResponsesApi(),
    },
  });

  const generatedGetModels = provider.getModels;
  provider.getModels = () => {
    const modelIds = authoritativeModelIds;
    const models = modelIds
      ? generatedGetModels().filter((model) => modelIds.has(model.id))
      : generatedGetModels();
    return headers ? models.map((model) => ({ ...model, headers })) : models;
  };

  const generatedRefresh = provider.refreshModels;
  provider.refreshModels = async (context) => {
    const migration = migrateStoredCatalog(context.stored);
    const stored = migration.stored;
    const storedCatalog = stored as CommandCodeStoredCatalog | undefined;
    if (migration.migrated) {
      if (!(await context.publish({ persist: stored }))) return;
    }
    if (
      context.allowNetwork &&
      !context.force &&
      stored?.checkedAt !== undefined &&
      (storedCatalog?.commandCodeModelsUrl ?? DEFAULT_COMMAND_CODE_MODELS_URL) ===
        commandCodeModelsUrl &&
      Date.now() - stored.checkedAt < CATALOG_REFRESH_INTERVAL_MS
    ) {
      return;
    }
    try {
      await generatedRefresh?.({
        ...context,
        stored,
        publish: (publication) =>
          context.publish({
            ...publication,
            persist:
              publication.persist === null || publication.persist === undefined
                ? publication.persist
                : versionedCatalogEntry({
                    ...publication.persist,
                    commandCodeModelsUrl,
                  }),
            update: publication.update
              ? () => {
                  publication.update?.();
                  const publishedModels = publication.persist?.models ?? stored?.models;
                  if (publishedModels) {
                    const modelIds = publishedModels
                      .filter((model) => model.provider === provider.id)
                      .map((model) => model.id);
                    authoritativeModelIds = modelIds.length > 0 ? new Set(modelIds) : undefined;
                  }
                }
              : undefined,
          }),
      });
    } catch (error) {
      if (context.allowNetwork && !context.signal.aborted) {
        await context.publish({
          persist: versionedCatalogEntry({ ...(stored ?? { models: [] }), checkedAt: Date.now() }),
        });
      }
      throw error;
    }
  };

  return provider;
}

export function registerCommandCode(pi: ExtensionAPI): void {
  pi.registerProvider(createCommandCodeProvider());
}
