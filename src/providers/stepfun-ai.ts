import type { OpenAICompletionsCompat } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";

const compat: OpenAICompletionsCompat = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
  supportsUsageInStreaming: false,
  maxTokensField: "max_tokens",
  supportsStrictMode: false,
  supportsLongCacheRetention: false,
};

const model: ProviderModelConfig = {
  id: "step-3.5-flash",
  name: "Step 3.5 Flash",
  reasoning: true,
  thinkingLevelMap: {
    off: null,
    minimal: null,
    low: null,
    medium: null,
    high: "high",
    xhigh: null,
  },
  input: ["text"],
  cost: { input: 0.1, output: 0.3, cacheRead: 0.02, cacheWrite: 0 },
  contextWindow: 256_000,
  maxTokens: 256_000,
  compat,
};

const model2603: ProviderModelConfig = {
  id: "step-3.5-flash-2603",
  name: "Step 3.5 Flash 2603",
  reasoning: true,
  thinkingLevelMap: {
    off: null,
    minimal: null,
    low: "low",
    medium: null,
    high: "high",
    xhigh: null,
  },
  input: ["text"],
  cost: { input: 0.1, output: 0.3, cacheRead: 0.02, cacheWrite: 0 },
  contextWindow: 256_000,
  maxTokens: 256_000,
  compat: { ...compat, supportsReasoningEffort: true },
};

export function registerStepFun(pi: ExtensionAPI): void {
  pi.registerProvider("stepfun-ai", {
    name: "StepFun AI",
    baseUrl: "https://api.stepfun.ai/step_plan/v1",
    apiKey: "$STEP_API_KEY",
    api: "openai-completions",
    models: [model, model2603],
  });
}
