import { describe, expect, it, vi } from "vitest";
import { registerStepFun } from "../../src/providers/stepfun-ai.ts";

describe("registerStepFun", () => {
  it("registers the Step Plan endpoint and both Step 3.5 models", () => {
    const registerProvider = vi.fn();
    const pi = { registerProvider } as unknown as Parameters<
      typeof registerStepFun
    >[0];

    registerStepFun(pi);

    expect(registerProvider).toHaveBeenCalledOnce();
    const [name, config] = registerProvider.mock.calls[0];
    expect(name).toBe("stepfun-ai");
    expect(config).toMatchObject({
      name: "StepFun AI",
      baseUrl: "https://api.stepfun.ai/step_plan/v1",
      apiKey: "$STEP_API_KEY",
      api: "openai-completions",
    });
    expect(config.models.map((model: { id: string }) => model.id)).toEqual([
      "step-3.5-flash",
      "step-3.5-flash-2603",
    ]);
    expect(config.models[0]).toMatchObject({
      id: "step-3.5-flash",
      name: "Step 3.5 Flash",
      reasoning: true,
      input: ["text"],
      contextWindow: 256_000,
      maxTokens: 256_000,
      cost: { input: 0.1, output: 0.3, cacheRead: 0.02, cacheWrite: 0 },
      thinkingLevelMap: {
        off: null,
        minimal: null,
        low: null,
        medium: null,
        high: "high",
        xhigh: null,
      },
      compat: {
        supportsStore: false,
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
        supportsUsageInStreaming: false,
        maxTokensField: "max_tokens",
        supportsStrictMode: false,
        supportsLongCacheRetention: false,
      },
    });
    expect(config.models[1]).toMatchObject({
      id: "step-3.5-flash-2603",
      name: "Step 3.5 Flash 2603",
      reasoning: true,
      input: ["text"],
      contextWindow: 256_000,
      maxTokens: 256_000,
      cost: { input: 0.1, output: 0.3, cacheRead: 0.02, cacheWrite: 0 },
      thinkingLevelMap: {
        off: null,
        minimal: null,
        low: "low",
        medium: null,
        high: "high",
        xhigh: null,
      },
      compat: {
        supportsStore: false,
        supportsDeveloperRole: false,
        supportsReasoningEffort: true,
        supportsUsageInStreaming: false,
        maxTokensField: "max_tokens",
        supportsStrictMode: false,
        supportsLongCacheRetention: false,
      },
    });
  });
});
