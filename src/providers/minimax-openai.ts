// src/providers/minimax-openai.ts

import type {
  Api,
  AssistantMessageEventStream,
  Context,
  Model,
  OpenAICompletionsCompat,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { getApiProvider } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { cleanStream } from "../core/clean-stream.ts";
import { hardenToolCalls } from "../core/harden-tool-calls.ts";
import { normalizeToolResults } from "../core/normalize-tool-results.ts";

export const M3_COMPAT: OpenAICompletionsCompat = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
  maxTokensField: "max_tokens",
};

export const M3_MODEL_CONFIG: ProviderModelConfig = {
  id: "MiniMax-M3",
  name: "MiniMax-M3",
  reasoning: true,
  input: ["text", "image"],
  cost: { input: 0.6, output: 2.4, cacheRead: 0.12, cacheWrite: 0 },
  contextWindow: 1_000_000,
  maxTokens: 512_000,
  compat: M3_COMPAT,
};

export function makeProvider(
  pi: ExtensionAPI,
  name: string,
  baseUrl: string,
  apiKey: string,
  displayName: string,
): void {
  pi.registerProvider(name, {
    name: displayName,
    baseUrl,
    apiKey,
    api: name as Api,
    streamSimple(
      model: Model<Api>,
      context: Context,
      options?: SimpleStreamOptions,
    ): AssistantMessageEventStream {
      const driver = getApiProvider("openai-completions");
      if (!driver) throw new Error("openai-completions api provider not registered");
      const ctx = normalizeToolResults(context);
      const base = driver.streamSimple(
        { ...model, api: "openai-completions" },
        ctx,
        options,
      );
      return cleanStream(hardenToolCalls(base));
    },
    models: [M3_MODEL_CONFIG],
  });
}
