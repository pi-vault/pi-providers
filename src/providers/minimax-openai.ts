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
import { cleanStream } from "./minimax-openai/clean-stream.ts";
import { hardenToolCalls } from "./minimax-openai/harden-tool-calls.ts";
import { normalizeToolResults } from "./minimax-openai/normalize-tool-results.ts";

const compat: OpenAICompletionsCompat = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
  maxTokensField: "max_tokens",
};

const models: ProviderModelConfig[] = [{
  id: "MiniMax-M3",
  name: "MiniMax-M3",
  reasoning: true,
  input: ["text", "image"],
  cost: { input: 0.6, output: 2.4, cacheRead: 0.12, cacheWrite: 0 },
  contextWindow: 1_000_000,
  maxTokens: 512_000,
  compat,
}];

function registerMiniMaxVariant(
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
    models,
  });
}

export function registerMiniMax(pi: ExtensionAPI): void {
  registerMiniMaxVariant(
    pi,
    "minimax-openai",
    "https://api.minimax.io/v1",
    "$MINIMAX_API_KEY",
    "MiniMax (OpenAI)",
  );
  registerMiniMaxVariant(
    pi,
    "minimax-openai-cn",
    "https://api.minimaxi.com/v1",
    "$MINIMAX_CN_API_KEY",
    "MiniMax CN (OpenAI)",
  );
}
