// src/providers/minimax-openai.ts

import type {
  Api,
  AssistantMessageEventStream,
  Model,
  SimpleStreamOptions,
  TranscriptContext,
} from "@earendil-works/pi-ai";
import { createProvider, envApiKeyAuth, type Provider } from "@earendil-works/pi-ai";
import { getApiProvider } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  canonicalMiniMaxModels,
  fetchMiniMaxModels,
  withMiniMaxCatalog,
} from "./minimax-openai/catalog.ts";
import { cleanStream } from "./minimax-openai/clean-stream.ts";
import { hardenToolCalls } from "./minimax-openai/harden-tool-calls.ts";
import { normalizeToolResults } from "./minimax-openai/normalize-tool-results.ts";
import { prepareThinkingReplay } from "./minimax-openai/prepare-thinking-replay.ts";

export type MiniMaxRegion = {
  id: "minimax-openai" | "minimax-openai-cn";
  name: string;
  baseUrl: string;
  envVar: "MINIMAX_API_KEY" | "MINIMAX_CN_API_KEY";
  keyName: string;
};

export const MINIMAX_REGIONS: readonly MiniMaxRegion[] = [
  {
    id: "minimax-openai",
    name: "MiniMax (OpenAI)",
    baseUrl: "https://api.minimax.io/v1",
    envVar: "MINIMAX_API_KEY",
    keyName: "MiniMax API key",
  },
  {
    id: "minimax-openai-cn",
    name: "MiniMax CN (OpenAI)",
    baseUrl: "https://api.minimaxi.com/v1",
    envVar: "MINIMAX_CN_API_KEY",
    keyName: "MiniMax CN API key",
  },
];

function pipeline(method: "stream" | "streamSimple") {
  return (
    model: Model<Api>,
    context: TranscriptContext,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream => {
    const driver = getApiProvider("openai-completions");
    if (!driver) throw new Error("openai-completions api provider not registered");
    const ctx = prepareThinkingReplay(normalizeToolResults(context), model);
    const base = driver[method]({ ...model, api: "openai-completions" }, ctx, options);
    return cleanStream(hardenToolCalls(base));
  };
}

export function createMiniMaxProvider(region: MiniMaxRegion): Provider {
  const { id, name, baseUrl, envVar, keyName } = region;
  return withMiniMaxCatalog(
    createProvider({
      id,
      name,
      baseUrl,
      auth: { apiKey: envApiKeyAuth(keyName, [envVar]) },
      models: canonicalMiniMaxModels(id, baseUrl),
      fetchModels: (context) => fetchMiniMaxModels(context, id, baseUrl),
      api: { stream: pipeline("stream"), streamSimple: pipeline("streamSimple") },
    }),
    id,
    baseUrl,
  );
}

export function registerMiniMax(pi: ExtensionAPI): void {
  for (const region of MINIMAX_REGIONS) pi.registerProvider(createMiniMaxProvider(region));
}
