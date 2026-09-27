import type {
  AnthropicMessagesCompat,
  Api,
  Model,
  ModelCost,
  OpenAICompletionsCompat,
} from "@earendil-works/pi-ai";
import { getBuiltinModels, getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";

export const COMMAND_CODE_BASE_URL = "https://api.commandcode.ai/provider/v1";
const COMMAND_CODE_ANTHROPIC_BASE_URL = "https://api.commandcode.ai/provider";

export interface CommandCodeCatalogRecord {
  id: string;
  name: string;
  contextWindow: number;
  supportedEndpoints: readonly string[];
}

type CommandCodeModel = Model<"anthropic-messages"> | Model<"openai-completions">;

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

const OPENAI_COMPAT: OpenAICompletionsCompat = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
  supportsUsageInStreaming: true,
  supportsStrictMode: false,
  supportsLongCacheRetention: false,
  maxTokensField: "max_tokens",
};

const PREFERRED_METADATA_PROVIDERS = [
  "anthropic",
  "openai",
  "google",
  "google-vertex",
  "xai",
  "deepseek",
  "moonshotai",
  "minimax",
  "xiaomi",
  "zai",
  "qwen-token-plan",
  "kimi-coding",
  "together",
  "groq",
  "fireworks",
  "nvidia",
  "huggingface",
  "openrouter",
  "opencode",
  "cloudflare-ai-gateway",
  "github-copilot",
] as const;

const providerPriority = new Map<string, number>(
  PREFERRED_METADATA_PROVIDERS.map((provider, index) => [provider, index]),
);

const builtinModels = getBuiltinProviders().flatMap(
  (provider) => getBuiltinModels(provider) as Model<Api>[],
);

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function donorFor(record: CommandCodeCatalogRecord): Model<Api> | undefined {
  const exactMatches = builtinModels.filter((model) => model.id === record.id);
  const candidates =
    exactMatches.length > 0
      ? exactMatches
      : builtinModels.filter((model) => normalizeName(model.name) === normalizeName(record.name));

  return candidates.sort((left, right) => {
    const leftPriority = providerPriority.get(left.provider) ?? Infinity;
    const rightPriority = providerPriority.get(right.provider) ?? Infinity;
    return leftPriority - rightPriority || left.provider.localeCompare(right.provider);
  })[0];
}

export function modelFromCatalogRecord(record: CommandCodeCatalogRecord): CommandCodeModel {
  const donor = donorFor(record);
  const usesMessages = record.supportedEndpoints.includes("/messages");
  const usesCompletions = record.supportedEndpoints.includes("/chat/completions");
  if (!usesMessages && !usesCompletions) {
    throw new Error(`Unsupported Command Code model endpoints: ${record.id}`);
  }
  const model = {
    id: record.id,
    name: record.name,
    provider: "command-code",
    baseUrl: usesMessages ? COMMAND_CODE_ANTHROPIC_BASE_URL : COMMAND_CODE_BASE_URL,
    reasoning: donor?.reasoning ?? false,
    input: donor ? [...donor.input] : (["text"] as ("text" | "image")[]),
    cost: COMMAND_COSTS[record.id as CommandCodeCatalogId] ?? ZERO_COST,
    contextWindow: record.contextWindow,
    maxTokens: Math.min(donor?.maxTokens ?? 16_384, record.contextWindow),
  };

  if (usesMessages) {
    const anthropic = {
      ...model,
      api: "anthropic-messages" as const,
      ...(donor?.thinkingLevelMap ? { thinkingLevelMap: donor.thinkingLevelMap } : {}),
    };
    const anthropicDonor =
      donor?.api === "anthropic-messages" ? (donor as Model<"anthropic-messages">) : undefined;
    const forceAdaptiveThinking = anthropicDonor?.compat?.forceAdaptiveThinking;
    return forceAdaptiveThinking
      ? { ...anthropic, compat: { forceAdaptiveThinking } satisfies AnthropicMessagesCompat }
      : anthropic;
  }

  return { ...model, api: "openai-completions", compat: OPENAI_COMPAT };
}

const COMMAND_CODE_CATALOG_SNAPSHOT = [
  { id: "claude-sonnet-5", name: "Claude Sonnet 5", contextWindow: 1_000_000 },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", contextWindow: 1_000_000 },
  { id: "claude-fable-5-1", name: "Claude Fable 5.1", contextWindow: 1_000_000 },
  { id: "claude-fable-5", name: "Claude Fable 5", contextWindow: 1_000_000 },
  { id: "claude-opus-5-5", name: "Claude Opus 5.5", contextWindow: 1_000_000 },
  { id: "claude-opus-5", name: "Claude Opus 5", contextWindow: 1_000_000 },
  { id: "claude-opus-4-8", name: "Claude Opus 4.8", contextWindow: 1_000_000 },
  { id: "claude-opus-4-7", name: "Claude Opus 4.7", contextWindow: 1_000_000 },
  { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", contextWindow: 200_000 },
  { id: "gpt-6-astra", name: "GPT-6 Astra", contextWindow: 1_050_000 },
  { id: "gpt-6-sol", name: "GPT-6 Sol", contextWindow: 1_050_000 },
  { id: "gpt-6-luna", name: "GPT-6 Luna", contextWindow: 1_050_000 },
  { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", contextWindow: 1_050_000 },
  { id: "gpt-5.6-terra", name: "GPT-5.6 Terra", contextWindow: 1_050_000 },
  { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", contextWindow: 1_050_000 },
  { id: "gpt-5.5", name: "GPT-5.5", contextWindow: 400_000 },
  { id: "gpt-5.4", name: "GPT-5.4", contextWindow: 400_000 },
  { id: "gpt-5.3-codex", name: "GPT-5.3 Codex", contextWindow: 400_000 },
  { id: "gpt-5.4-mini", name: "GPT-5.4 Mini", contextWindow: 400_000 },
  { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro (latest)", contextWindow: 1_000_000 },
  {
    id: "deepseek/deepseek-v4-flash",
    name: "DeepSeek V4 Flash (latest)",
    contextWindow: 1_000_000,
  },
  {
    id: "deepseek/deepseek-v4-flash-vision-exp",
    name: "DeepSeek V4 Flash Vision (exp)",
    contextWindow: 1_000_000,
  },
  {
    id: "deepseek/deepseek-v4-flash-fast",
    name: "DeepSeek V4 Flash Fast",
    contextWindow: 1_000_000,
  },
  {
    id: "deepseek/deepseek-v4.1-flash",
    name: "DeepSeek V4.1 Flash",
    contextWindow: 1_000_000,
  },
  { id: "moonshotai/Kimi-K3", name: "Kimi K3", contextWindow: 1_000_000 },
  { id: "moonshotai/Kimi-K2.7-Code", name: "Kimi K2.7 Code", contextWindow: 256_000 },
  {
    id: "moonshotai/Kimi-K2.7-Code-Highspeed",
    name: "Kimi K2.7 Code HighSpeed",
    contextWindow: 262_000,
  },
  { id: "moonshotai/Kimi-K2.6", name: "Kimi K2.6", contextWindow: 256_000 },
  { id: "moonshotai/Kimi-K2.5", name: "Kimi K2.5", contextWindow: 256_000 },
  { id: "zai-org/GLM-5.2", name: "GLM-5.2", contextWindow: 1_000_000 },
  { id: "zai-org/GLM-5.2-Fast", name: "GLM-5.2 Fast", contextWindow: 1_000_000 },
  { id: "zai-org/GLM-5.1", name: "GLM-5.1", contextWindow: 200_000 },
  { id: "zai-org/GLM-5", name: "GLM-5", contextWindow: 200_000 },
  { id: "z-ai/glm-5.3-flash", name: "GLM-5.3 Flash", contextWindow: 1_048_576 },
  { id: "z-ai/glm-5.3-flashx", name: "GLM-5.3 FlashX", contextWindow: 1_000_000 },
  { id: "zai-org/GLM-5.3", name: "GLM-5.3", contextWindow: 1_000_000 },
  { id: "MiniMaxAI/MiniMax-M3", name: "MiniMax M3", contextWindow: 1_000_000 },
  { id: "MiniMaxAI/MiniMax-M2.7", name: "MiniMax M2.7", contextWindow: 200_000 },
  { id: "MiniMaxAI/MiniMax-M2.5", name: "MiniMax M2.5", contextWindow: 200_000 },
  { id: "xiaomi/mimo-v2.6-pro", name: "MiMo V2.6 Pro", contextWindow: 1_048_576 },
  {
    id: "xiaomi/mimo-v2.6-pro-ultraspeed",
    name: "MiMo V2.6 Pro UltraSpeed",
    contextWindow: 1_048_576,
  },
  { id: "xiaomi/mimo-v2.6-flash", name: "MiMo V2.6 Flash", contextWindow: 1_048_576 },
  { id: "xiaomi/mimo-v2.5-pro", name: "MiMo V2.5 Pro", contextWindow: 1_000_000 },
  { id: "xiaomi/mimo-v2.5", name: "MiMo V2.5", contextWindow: 1_000_000 },
  { id: "Qwen/Qwen3.8-Omni-Flash", name: "Qwen 3.8 Omni Flash", contextWindow: 1_000_000 },
  { id: "Qwen/Qwen3.8-Max-0902", name: "Qwen 3.8 Max 0902", contextWindow: 1_000_000 },
  { id: "Qwen/Qwen3.8-Max", name: "Qwen 3.8 Max", contextWindow: 1_000_000 },
  { id: "Qwen/Qwen3.8-27B", name: "Qwen 3.8 27B", contextWindow: 262_144 },
  { id: "Qwen/Qwen3.8-Flash", name: "Qwen 3.8 Flash", contextWindow: 1_000_000 },
  { id: "Qwen/Qwen3.7-Max", name: "Qwen 3.7 Max", contextWindow: 1_000_000 },
  { id: "Qwen/Qwen3.7-Plus", name: "Qwen 3.7 Plus", contextWindow: 1_000_000 },
  { id: "Qwen/Qwen3.7-Flash", name: "Qwen 3.7 Flash", contextWindow: 1_000_000 },
  { id: "Qwen/Qwen3.6-Max-Preview", name: "Qwen 3.6 Max Preview", contextWindow: 200_000 },
  { id: "Qwen/Qwen3.6-Plus", name: "Qwen 3.6 Plus", contextWindow: 200_000 },
  { id: "meituan/LongCat-2.0", name: "LongCat 2.0", contextWindow: 1_048_576 },
  { id: "stepfun/Step-5-Preview", name: "Step 5 Preview", contextWindow: 1_000_000 },
  { id: "stepfun/Step-3.7-Flash", name: "Step 3.7 Flash", contextWindow: 256_000 },
  { id: "stepfun/Step-3.5-Flash", name: "Step 3.5 Flash", contextWindow: 262_144 },
  { id: "tencent/hy3-paid", name: "Tencent Hy3", contextWindow: 262_144 },
  { id: "tencent/hy4-preview", name: "Tencent Hy4 Preview", contextWindow: 1_048_576 },
  { id: "google/gemini-3.6-flash", name: "Gemini 3.6 Flash", contextWindow: 1_000_000 },
  { id: "google/gemini-3.8-flash", name: "Gemini 3.8 Flash", contextWindow: 1_000_000 },
  { id: "google/gemini-3.7-flash", name: "Gemini 3.7 Flash", contextWindow: 1_048_576 },
  { id: "google/gemini-3.5-flash", name: "Gemini 3.5 Flash", contextWindow: 1_000_000 },
  { id: "google/gemini-3.5-flash-lite", name: "Gemini 3.5 Flash Lite", contextWindow: 1_000_000 },
  { id: "google/gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite", contextWindow: 1_000_000 },
  { id: "sakana/fugu-ultra", name: "Fugu Ultra", contextWindow: 1_000_000 },
  { id: "nvidia/nemotron-3-ultra-550b-a55b", name: "Nemotron 3 Ultra", contextWindow: 1_000_000 },
  { id: "thinkingmachines/inkling", name: "Inkling", contextWindow: 256_000 },
  { id: "thinkingmachines/inkling-small", name: "Inkling Small", contextWindow: 1_000_000 },
  { id: "stealth/space-bunny-alpha", name: "Space Bunny Alpha", contextWindow: 1_000_000 },
  { id: "stealth/pixel-canary", name: "Pixel Canary", contextWindow: 262_144 },
  { id: "poolside/laguna-s-2.1-free", name: "Laguna S 2.1", contextWindow: 256_000 },
  {
    id: "inclusionai/ling-3.0-flash-sante:free",
    name: "Ling 3.0 Flash Sante",
    contextWindow: 262_144,
  },
  { id: "meta/muse-spark-1.1", name: "Muse Spark 1.1", contextWindow: 1_048_576 },
  { id: "meta/muse-spark-1.2", name: "Muse Spark 1.2", contextWindow: 1_048_576 },
  {
    id: "meta/muse-spark-1.2-contributor",
    name: "Muse Spark 1.2 Contributor",
    contextWindow: 1_048_576,
  },
  { id: "meta/muse-spark-1.3", name: "Muse Spark 1.3", contextWindow: 1_048_576 },
  {
    id: "meta/muse-spark-1.3-contributor",
    name: "Muse Spark 1.3 Contributor",
    contextWindow: 1_048_576,
  },
  { id: "xai/grok-4.5", name: "Grok 4.5", contextWindow: 500_000 },
  { id: "xai/grok-4.6", name: "Grok 4.6", contextWindow: 500_000 },
  { id: "xai/grok-4.7", name: "Grok 4.7", contextWindow: 500_000 },
] as const;

const MESSAGES_MODEL_IDS = new Set([
  "claude-sonnet-5",
  "claude-sonnet-4-6",
  "claude-fable-5-1",
  "claude-fable-5",
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-haiku-4-5-20251001",
]);
const CHAT_ONLY_MODEL_IDS = new Set([
  "deepseek/deepseek-v4-flash-fast",
  "Qwen/Qwen3.8-Max-0902",
  "Qwen/Qwen3.8-Flash",
  "meituan/LongCat-2.0",
  "tencent/hy4-preview",
  "google/gemini-3.7-flash",
  "stealth/space-bunny-alpha",
  "inclusionai/ling-3.0-flash-sante:free",
]);

export const COMMAND_CODE_CATALOG: readonly CommandCodeCatalogRecord[] =
  COMMAND_CODE_CATALOG_SNAPSHOT.map((record) => ({
    ...record,
    supportedEndpoints: MESSAGES_MODEL_IDS.has(record.id)
      ? ["/messages"]
      : CHAT_ONLY_MODEL_IDS.has(record.id)
        ? ["/chat/completions"]
        : ["/chat/completions", "/responses"],
  }));

type CommandCodeCatalogId = (typeof COMMAND_CODE_CATALOG)[number]["id"];

// Snapshot source: https://commandcode.ai/docs/resources/pricing-limits
// Effective rates billed 2026-08-29, USD per 1M tokens.
const COMMAND_COSTS: Readonly<Partial<Record<CommandCodeCatalogId, ModelCost>>> = {
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
  "claude-fable-5": { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-7": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  "gpt-6-astra": {
    input: 10,
    output: 50,
    cacheRead: 1,
    cacheWrite: 12.5,
    tiers: [{ inputTokensAbove: 272_000, input: 20, output: 75, cacheRead: 2, cacheWrite: 25 }],
  },
  "gpt-6-sol": {
    input: 2,
    output: 10,
    cacheRead: 0.2,
    cacheWrite: 2.5,
    tiers: [{ inputTokensAbove: 272_000, input: 4, output: 15, cacheRead: 0.4, cacheWrite: 5 }],
  },
  "gpt-6-luna": {
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01,
    cacheWrite: 0.125,
    tiers: [
      { inputTokensAbove: 272_000, input: 0.2, output: 0.75, cacheRead: 0.02, cacheWrite: 0.25 },
    ],
  },
  "gpt-5.6-sol": {
    input: 5,
    output: 30,
    cacheRead: 0.5,
    cacheWrite: 6.25,
    tiers: [{ inputTokensAbove: 272_000, input: 10, output: 45, cacheRead: 1, cacheWrite: 12.5 }],
  },
  "gpt-5.6-terra": {
    input: 2,
    output: 12,
    cacheRead: 0.2,
    cacheWrite: 2.5,
    tiers: [{ inputTokensAbove: 272_000, input: 4, output: 18, cacheRead: 0.4, cacheWrite: 5 }],
  },
  "gpt-5.6-luna": {
    input: 0.2,
    output: 1.2,
    cacheRead: 0.02,
    cacheWrite: 0.25,
    tiers: [
      { inputTokensAbove: 272_000, input: 0.4, output: 1.8, cacheRead: 0.04, cacheWrite: 0.5 },
    ],
  },
  "gpt-5.5": { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
  "gpt-5.4": { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 0 },
  "gpt-5.3-codex": { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 0 },
  "gpt-5.4-mini": { input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0 },
  // ponytail: Pi ModelCost cannot express UTC price bands. These are Command's displayed
  // off-peak rates for V4 Flash variants; peak rates are 0.3/1.2/0.006.
  "deepseek/deepseek-v4-pro": { input: 0.66, output: 1.98, cacheRead: 0.022, cacheWrite: 0 },
  "deepseek/deepseek-v4-flash": { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 },
  "deepseek/deepseek-v4-flash-vision-exp": {
    input: 0.15,
    output: 0.6,
    cacheRead: 0.003,
    cacheWrite: 0,
  },
  "deepseek/deepseek-v4-flash-fast": { input: 0.28, output: 0.56, cacheRead: 0.07, cacheWrite: 0 },
  "deepseek/deepseek-v4.1-flash": { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 },
  "moonshotai/Kimi-K3": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 0 },
  "moonshotai/Kimi-K2.7-Code": { input: 0.95, output: 4, cacheRead: 0.19, cacheWrite: 0 },
  "moonshotai/Kimi-K2.7-Code-Highspeed": { input: 1.9, output: 8, cacheRead: 0.38, cacheWrite: 0 },
  "moonshotai/Kimi-K2.6": { input: 0.95, output: 4, cacheRead: 0.16, cacheWrite: 0 },
  "moonshotai/Kimi-K2.5": { input: 0.6, output: 3, cacheRead: 0.1, cacheWrite: 0 },
  "zai-org/GLM-5.2": { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
  "zai-org/GLM-5.2-Fast": { input: 3, output: 10.25, cacheRead: 0.5, cacheWrite: 0 },
  "zai-org/GLM-5.1": { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
  "zai-org/GLM-5": { input: 1, output: 3.2, cacheRead: 0.2, cacheWrite: 0 },
  "z-ai/glm-5.3-flash": { input: 0.15, output: 0.5, cacheRead: 0.03, cacheWrite: 0 },
  "z-ai/glm-5.3-flashx": { input: 0.37, output: 1.25, cacheRead: 0.075, cacheWrite: 0 },
  "zai-org/GLM-5.3": { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
  "MiniMaxAI/MiniMax-M3": { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 },
  "MiniMaxAI/MiniMax-M2.7": { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 },
  "MiniMaxAI/MiniMax-M2.5": { input: 0.3, output: 1.2, cacheRead: 0.03, cacheWrite: 0 },
  "xiaomi/mimo-v2.6-pro": { input: 0.435, output: 0.87, cacheRead: 0.0036, cacheWrite: 0 },
  "xiaomi/mimo-v2.6-pro-ultraspeed": {
    input: 4.35,
    output: 8.7,
    cacheRead: 0.036,
    cacheWrite: 0,
  },
  "xiaomi/mimo-v2.6-flash": { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 },
  "xiaomi/mimo-v2.5-pro": { input: 0.435, output: 0.87, cacheRead: 0.0036, cacheWrite: 0 },
  "xiaomi/mimo-v2.5": { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 },
  "Qwen/Qwen3.8-Omni-Flash": { input: 0.15, output: 0.47, cacheRead: 0.016, cacheWrite: 0 },
  "Qwen/Qwen3.8-Max-0902": { input: 2, output: 6, cacheRead: 0.25, cacheWrite: 0 },
  "Qwen/Qwen3.8-Max": { input: 2, output: 6, cacheRead: 0.25, cacheWrite: 2.5 },
  "Qwen/Qwen3.8-27B": { input: 0.4, output: 3, cacheRead: 0.04, cacheWrite: 0 },
  "Qwen/Qwen3.8-Flash": { input: 0.16, output: 0.47, cacheRead: 0.016, cacheWrite: 0 },
  "Qwen/Qwen3.7-Max": { input: 2.5, output: 7.5, cacheRead: 0.5, cacheWrite: 3.13 },
  "Qwen/Qwen3.7-Plus": {
    input: 0.4,
    output: 1.6,
    cacheRead: 0.08,
    cacheWrite: 0.5,
    tiers: [
      { inputTokensAbove: 256_000, input: 1.2, output: 4.8, cacheRead: 0.24, cacheWrite: 1.5 },
    ],
  },
  "Qwen/Qwen3.7-Flash": {
    input: 0.03,
    output: 0.13,
    cacheRead: 0.006,
    cacheWrite: 0.038,
    tiers: [
      { inputTokensAbove: 32_000, input: 0.1, output: 0.4, cacheRead: 0.02, cacheWrite: 0.125 },
      { inputTokensAbove: 256_000, input: 0.2, output: 0.8, cacheRead: 0.04, cacheWrite: 0.25 },
    ],
  },
  "Qwen/Qwen3.6-Max-Preview": { input: 1.3, output: 7.8, cacheRead: 0.26, cacheWrite: 1.63 },
  "Qwen/Qwen3.6-Plus": { input: 0.5, output: 3, cacheRead: 0.1, cacheWrite: 0 },
  "meituan/LongCat-2.0": { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 },
  "stepfun/Step-5-Preview": { input: 1, output: 2.7, cacheRead: 0.05, cacheWrite: 0 },
  "stepfun/Step-3.7-Flash": { input: 0.2, output: 1.15, cacheRead: 0.04, cacheWrite: 0 },
  "stepfun/Step-3.5-Flash": { input: 0.09, output: 0.3, cacheRead: 0.02, cacheWrite: 0 },
  "tencent/hy3-paid": { input: 0.14, output: 0.58, cacheRead: 0.035, cacheWrite: 0 },
  "tencent/hy4-preview": { input: 0.834, output: 2.501, cacheRead: 0.042, cacheWrite: 0 },
  "google/gemini-3.8-flash": { input: 1.5, output: 7.5, cacheRead: 0.15, cacheWrite: 0 },
  "google/gemini-3.7-flash": { input: 1.5, output: 7.5, cacheRead: 0.15, cacheWrite: 0.08334 },
  "google/gemini-3.6-flash": { input: 1.5, output: 7.5, cacheRead: 0.15, cacheWrite: 0 },
  "google/gemini-3.5-flash": { input: 1.5, output: 9, cacheRead: 0.15, cacheWrite: 0 },
  "google/gemini-3.5-flash-lite": { input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0 },
  "google/gemini-3.1-flash-lite": { input: 0.25, output: 1.5, cacheRead: 0.03, cacheWrite: 0 },
  "sakana/fugu-ultra": { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
  "nvidia/nemotron-3-ultra-550b-a55b": { input: 0.6, output: 2.4, cacheRead: 0.12, cacheWrite: 0 },
  "thinkingmachines/inkling": { input: 1, output: 4.05, cacheRead: 0.17, cacheWrite: 0 },
  "thinkingmachines/inkling-small": { input: 0.5, output: 1.2, cacheRead: 0.1, cacheWrite: 0 },
  "stealth/space-bunny-alpha": ZERO_COST,
  "stealth/pixel-canary": ZERO_COST,
  "inclusionai/ling-3.0-flash-sante:free": ZERO_COST,
  "meta/muse-spark-1.1": { input: 1.25, output: 4.25, cacheRead: 0.15, cacheWrite: 0 },
  "meta/muse-spark-1.2": { input: 1.25, output: 4.25, cacheRead: 0.15, cacheWrite: 0 },
  "meta/muse-spark-1.2-contributor": { input: 0.1, output: 0.2, cacheRead: 0.002, cacheWrite: 0 },
  "meta/muse-spark-1.3": { input: 1.25, output: 4.25, cacheRead: 0.15, cacheWrite: 0 },
  "meta/muse-spark-1.3-contributor": {
    input: 0.1,
    output: 0.2,
    cacheRead: 0.002,
    cacheWrite: 0,
  },
  "xai/grok-4.5": { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0 },
  "xai/grok-4.6": {
    input: 2,
    output: 6,
    cacheRead: 0.5,
    cacheWrite: 0,
    tiers: [{ inputTokensAbove: 200_000, input: 4, output: 12, cacheRead: 1, cacheWrite: 0 }],
  },
  "xai/grok-4.7": {
    input: 2,
    output: 6,
    cacheRead: 0.5,
    cacheWrite: 0,
    tiers: [{ inputTokensAbove: 200_000, input: 4, output: 12, cacheRead: 1, cacheWrite: 0 }],
  },
};

export const commandCodeModels = COMMAND_CODE_CATALOG.map(modelFromCatalogRecord);
