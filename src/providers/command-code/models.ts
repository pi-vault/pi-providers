import type {
  AnthropicMessagesCompat,
  Api,
  Model,
  OpenAICompletionsCompat,
} from "@earendil-works/pi-ai";
import { getBuiltinModels, getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";

export const COMMAND_CODE_BASE_URL = "https://api.commandcode.ai/provider/v1";
const COMMAND_CODE_ANTHROPIC_BASE_URL = "https://api.commandcode.ai/provider";

export interface CommandCodeCatalogRecord {
  id: string;
  name: string;
  contextWindow: number;
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
  const model = {
    id: record.id,
    name: record.name,
    provider: "command-code",
    baseUrl: record.id.startsWith("claude-")
      ? COMMAND_CODE_ANTHROPIC_BASE_URL
      : COMMAND_CODE_BASE_URL,
    reasoning: donor?.reasoning ?? false,
    input: donor ? [...donor.input] : (["text"] as ("text" | "image")[]),
    cost: ZERO_COST,
    contextWindow: record.contextWindow,
    maxTokens: Math.min(donor?.maxTokens ?? 16_384, record.contextWindow),
  };

  if (record.id.startsWith("claude-")) {
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

export const COMMAND_CODE_CATALOG = [
  { id: "claude-sonnet-5", name: "Claude Sonnet 5", contextWindow: 1_000_000 },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", contextWindow: 1_000_000 },
  { id: "claude-fable-5", name: "Claude Fable 5", contextWindow: 1_000_000 },
  { id: "claude-opus-5", name: "Claude Opus 5", contextWindow: 1_000_000 },
  { id: "claude-opus-4-8", name: "Claude Opus 4.8", contextWindow: 1_000_000 },
  { id: "claude-opus-4-7", name: "Claude Opus 4.7", contextWindow: 1_000_000 },
  { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", contextWindow: 200_000 },
  { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", contextWindow: 1_050_000 },
  { id: "gpt-5.6-terra", name: "GPT-5.6 Terra", contextWindow: 1_050_000 },
  { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", contextWindow: 1_050_000 },
  { id: "gpt-5.5", name: "GPT-5.5", contextWindow: 200_000 },
  { id: "gpt-5.4", name: "GPT-5.4", contextWindow: 400_000 },
  { id: "gpt-5.3-codex", name: "GPT-5.3 Codex", contextWindow: 400_000 },
  { id: "gpt-5.4-mini", name: "GPT-5.4 Mini", contextWindow: 400_000 },
  { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro", contextWindow: 1_000_000 },
  {
    id: "deepseek/deepseek-v4-flash",
    name: "DeepSeek V4 Flash (latest)",
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
  { id: "MiniMaxAI/MiniMax-M3", name: "MiniMax M3", contextWindow: 1_000_000 },
  { id: "MiniMaxAI/MiniMax-M2.7", name: "MiniMax M2.7", contextWindow: 200_000 },
  { id: "MiniMaxAI/MiniMax-M2.5", name: "MiniMax M2.5", contextWindow: 200_000 },
  { id: "xiaomi/mimo-v2.5-pro", name: "MiMo V2.5 Pro", contextWindow: 1_000_000 },
  { id: "xiaomi/mimo-v2.5", name: "MiMo V2.5", contextWindow: 1_000_000 },
  { id: "Qwen/Qwen3.8-Max", name: "Qwen 3.8 Max", contextWindow: 1_000_000 },
  { id: "Qwen/Qwen3.7-Max", name: "Qwen 3.7 Max", contextWindow: 1_000_000 },
  { id: "Qwen/Qwen3.7-Plus", name: "Qwen 3.7 Plus", contextWindow: 1_000_000 },
  { id: "Qwen/Qwen3.7-Flash", name: "Qwen 3.7 Flash", contextWindow: 1_000_000 },
  { id: "Qwen/Qwen3.6-Max-Preview", name: "Qwen 3.6 Max Preview", contextWindow: 200_000 },
  { id: "Qwen/Qwen3.6-Plus", name: "Qwen 3.6 Plus", contextWindow: 200_000 },
  { id: "stepfun/Step-3.7-Flash", name: "Step 3.7 Flash", contextWindow: 256_000 },
  { id: "stepfun/Step-3.5-Flash", name: "Step 3.5 Flash", contextWindow: 1_000_000 },
  { id: "tencent/hy3-paid", name: "Tencent Hy3", contextWindow: 262_144 },
  { id: "google/gemini-3.6-flash", name: "Gemini 3.6 Flash", contextWindow: 1_000_000 },
  { id: "google/gemini-3.5-flash", name: "Gemini 3.5 Flash", contextWindow: 1_000_000 },
  { id: "google/gemini-3.5-flash-lite", name: "Gemini 3.5 Flash Lite", contextWindow: 1_000_000 },
  { id: "google/gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite", contextWindow: 1_000_000 },
  { id: "sakana/fugu-ultra", name: "Fugu Ultra", contextWindow: 1_000_000 },
  { id: "nvidia/nemotron-3-ultra-550b-a55b", name: "Nemotron 3 Ultra", contextWindow: 1_000_000 },
  { id: "thinkingmachines/inkling", name: "Inkling", contextWindow: 256_000 },
  { id: "thinkingmachines/inkling-small", name: "Inkling Small", contextWindow: 1_000_000 },
  { id: "poolside/laguna-s-2.1-free", name: "Laguna S 2.1", contextWindow: 256_000 },
  { id: "meta/muse-spark-1.1", name: "Muse Spark 1.1", contextWindow: 1_048_576 },
  { id: "meta/muse-spark-1.2", name: "Muse Spark 1.2", contextWindow: 1_048_576 },
  {
    id: "meta/muse-spark-1.2-contributor",
    name: "Muse Spark 1.2 Contributor",
    contextWindow: 1_048_576,
  },
  { id: "xai/grok-4.5", name: "Grok 4.5", contextWindow: 500_000 },
] satisfies readonly CommandCodeCatalogRecord[];

export const commandCodeModels = COMMAND_CODE_CATALOG.map(modelFromCatalogRecord);
