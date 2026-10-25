// src/providers/minimax-openai.ts

import type {
  Api,
  AssistantMessageEventStream,
  Model,
  SimpleStreamOptions,
  TranscriptContext,
} from "@earendil-works/pi-ai";
import { getApiProvider } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { cleanStream } from "./minimax-openai/clean-stream.ts";
import { hardenToolCalls } from "./minimax-openai/harden-tool-calls.ts";
import { MINIMAX_MODELS } from "./minimax-openai/models.ts";
import { normalizeToolResults } from "./minimax-openai/normalize-tool-results.ts";
import { prepareThinkingReplay } from "./minimax-openai/prepare-thinking-replay.ts";

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
      context: TranscriptContext,
      options?: SimpleStreamOptions,
    ): AssistantMessageEventStream {
      const driver = getApiProvider("openai-completions");
      if (!driver) throw new Error("openai-completions api provider not registered");
      const ctx = prepareThinkingReplay(normalizeToolResults(context), model);
      const base = driver.streamSimple({ ...model, api: "openai-completions" }, ctx, options);
      return cleanStream(hardenToolCalls(base));
    },
    models: structuredClone([...MINIMAX_MODELS]),
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
