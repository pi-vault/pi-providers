// src/providers/minimax-openai/models.ts

import type { ModelCost, OpenAICompletionsCompat, ThinkingLevelMap } from "@earendil-works/pi-ai";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";

// Sources checked 2026-10-25:
// - https://platform.minimax.io/docs/guides/ and
//   https://platform.minimax.io/docs/api-reference/api-overview: 1,000,000-token context.
// - https://platform.minimax.io/docs/api-reference/text-chat-openai: 524,288 maximum output
//   through max_completion_tokens; max_tokens is deprecated.
// - https://platform.minimax.io/docs/api-reference/text-openai-api: Flash efforts and
//   omitted-effort behavior.
// - https://platform.minimax.io/docs/pricing/overview: standard USD per 1M input/output/
//   cache-read tokens, with M3 doubling above 512,000 input tokens.
const COMPAT: OpenAICompletionsCompat = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
  maxTokensField: "max_completion_tokens",
};

const FLASH_THINKING_LEVEL_MAP = {
  off: null,
  minimal: null,
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
} satisfies ThinkingLevelMap;

const FLASH_COST: ModelCost = {
  input: 0.15,
  output: 0.6,
  cacheRead: 0.015,
  cacheWrite: 0,
};

const M3_COST: ModelCost = {
  input: 0.3,
  output: 1.2,
  cacheRead: 0.06,
  cacheWrite: 0,
  tiers: [{ inputTokensAbove: 512_000, input: 0.6, output: 2.4, cacheRead: 0.12, cacheWrite: 0 }],
};

export const MINIMAX_MODELS: readonly ProviderModelConfig[] = [
  {
    id: "MiniMax-M3.1-Flash",
    name: "MiniMax-M3.1-Flash",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 524_288,
    cost: FLASH_COST,
    compat: { ...COMPAT, supportsReasoningEffort: true },
    thinkingLevelMap: FLASH_THINKING_LEVEL_MAP,
  },
  {
    id: "MiniMax-M3",
    name: "MiniMax-M3",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 524_288,
    cost: M3_COST,
    compat: COMPAT,
  },
];
