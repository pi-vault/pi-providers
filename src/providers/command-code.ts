import {
  createProvider,
  envApiKeyAuth,
  type Provider,
  type RefreshModelsContext,
} from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import {
  COMMAND_CODE_BASE_URL,
  commandCodeModels,
  type CommandCodeCatalogRecord,
  modelFromCatalogRecord,
} from "./command-code/models.ts";

const COMMAND_CODE_MODELS_URL = `${COMMAND_CODE_BASE_URL}/models`;
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

    const { id, name, context_length } = entry as Record<string, unknown>;
    if (
      typeof id !== "string" ||
      !id.trim() ||
      typeof name !== "string" ||
      !name.trim() ||
      typeof context_length !== "number" ||
      !Number.isInteger(context_length) ||
      context_length <= 0
    ) {
      throw new Error("Invalid Command Code model catalog");
    }

    return { id, name, contextWindow: context_length };
  });

  if (new Set(records.map((record) => record.id)).size !== records.length) {
    throw new Error("Invalid Command Code model catalog: duplicate IDs");
  }

  return records.map(modelFromCatalogRecord);
}

async function fetchCommandCodeModels(context: RefreshModelsContext) {
  const signal = AbortSignal.any([context.signal, AbortSignal.timeout(10_000)]);
  if (signal.aborted) throw new Error("Command Code model catalog request aborted");
  const response = await fetch(COMMAND_CODE_MODELS_URL, { signal });
  if (!response.ok) {
    throw new Error(`Command Code model catalog request failed: ${response.status}`);
  }

  return parseCommandCodeModels(await response.json());
}

export function createCommandCodeProvider(): Provider<"anthropic-messages" | "openai-completions"> {
  const headers = process.env.CMD_ZDR === "1" ? { "x-cmd-zdr": "1" } : undefined;

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
    const models = generatedGetModels();
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
    await generatedRefresh?.(context);
  };

  return provider;
}
