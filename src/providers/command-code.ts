import {
  anthropicMessagesApi,
  createProvider,
  envApiKeyAuth,
  openAICompletionsApi,
  type Provider,
  type RefreshModelsContext,
} from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  COMMAND_CODE_BASE_URL,
  commandCodeModels,
  type CommandCodeCatalogRecord,
  modelFromCatalogRecord,
} from "./command-code/models.ts";

const CATALOG_REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000;

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

    const { id, name, context_length, supported_endpoints } = entry as Record<string, unknown>;
    if (
      typeof id !== "string" ||
      !id.trim() ||
      typeof name !== "string" ||
      !name.trim() ||
      typeof context_length !== "number" ||
      !Number.isInteger(context_length) ||
      context_length <= 0 ||
      !Array.isArray(supported_endpoints) ||
      !supported_endpoints.every((endpoint) => typeof endpoint === "string")
    ) {
      throw new Error("Invalid Command Code model catalog");
    }

    return { id, name, contextWindow: context_length, supportedEndpoints: supported_endpoints };
  });

  if (new Set(records.map((record) => record.id)).size !== records.length) {
    throw new Error("Invalid Command Code model catalog: duplicate IDs");
  }

  const chatRecords = records.filter((record) =>
    record.supportedEndpoints.some(
      (endpoint) => endpoint === "/messages" || endpoint === "/chat/completions",
    ),
  );
  if (chatRecords.length === 0) {
    throw new Error("Invalid Command Code model catalog: no supported chat endpoints");
  }

  return chatRecords.map(modelFromCatalogRecord);
}

async function fetchCommandCodeModels(context: RefreshModelsContext) {
  const signal = AbortSignal.any([context.signal, AbortSignal.timeout(10_000)]);
  const response = await fetch(`${COMMAND_CODE_BASE_URL}/models`, { signal });
  if (!response.ok) {
    throw new Error(`Command Code model catalog request failed: ${response.status}`);
  }

  return parseCommandCodeModels(await response.json());
}

export function createCommandCodeProvider(): Provider<"anthropic-messages" | "openai-completions"> {
  const headers = process.env.CMD_ZDR === "1" ? { "x-cmd-zdr": "1" } : undefined;
  let authoritativeModelIds: ReadonlySet<string> | undefined;

  const provider = createProvider({
    id: "command-code",
    name: "Command Code",
    baseUrl: COMMAND_CODE_BASE_URL,
    auth: { apiKey: envApiKeyAuth("Command Code API key", ["CMD_API_KEY"]) },
    models: commandCodeModels,
    fetchModels: fetchCommandCodeModels,
    api: {
      "anthropic-messages": anthropicMessagesApi(),
      "openai-completions": openAICompletionsApi(),
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
    if (
      context.allowNetwork &&
      !context.force &&
      context.stored?.checkedAt !== undefined &&
      Date.now() - context.stored.checkedAt < CATALOG_REFRESH_INTERVAL_MS
    ) {
      return;
    }
    try {
      await generatedRefresh?.({
        ...context,
        publish: (publication) =>
          context.publish({
            ...publication,
            update: publication.update
              ? () => {
                  publication.update?.();
                  const publishedModels = publication.persist?.models ?? context.stored?.models;
                  if (publishedModels) {
                    authoritativeModelIds = new Set(
                      publishedModels
                        .filter((model) => model.provider === provider.id)
                        .map((model) => model.id),
                    );
                  }
                }
              : undefined,
          }),
      });
    } catch (error) {
      if (context.allowNetwork && !context.signal.aborted) {
        await context.publish({
          persist: {
            ...(context.stored ?? { models: [] }),
            checkedAt: Date.now(),
          },
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
