// tests/providers/minimax-openai.test.ts

import { describe, expect, it, vi } from "vitest";
import { makeProvider, M3_MODEL_CONFIG, M3_COMPAT } from "../../src/providers/minimax-openai.ts";

describe("makeProvider", () => {
  it("registers a provider with the correct name and baseUrl", () => {
    const registerProvider = vi.fn();
    const mockPi = { registerProvider } as unknown as Parameters<typeof makeProvider>[0];

    makeProvider(mockPi, "minimax-openai", "https://api.minimax.io/v1", "$MINIMAX_API_KEY", "MiniMax (OpenAI)");

    expect(registerProvider).toHaveBeenCalledOnce();
    const [name, config] = registerProvider.mock.calls[0];
    expect(name).toBe("minimax-openai");
    expect(config.baseUrl).toBe("https://api.minimax.io/v1");
    expect(config.apiKey).toBe("$MINIMAX_API_KEY");
    expect(config.name).toBe("MiniMax (OpenAI)");
  });

  it("provides a custom streamSimple function", () => {
    const registerProvider = vi.fn();
    const mockPi = { registerProvider } as unknown as Parameters<typeof makeProvider>[0];

    makeProvider(mockPi, "minimax-openai", "https://api.minimax.io/v1", "$MINIMAX_API_KEY", "MiniMax (OpenAI)");

    const [, config] = registerProvider.mock.calls[0];
    expect(typeof config.streamSimple).toBe("function");
  });

  it("sets api to the provider name (custom api id for routing)", () => {
    const registerProvider = vi.fn();
    const mockPi = { registerProvider } as unknown as Parameters<typeof makeProvider>[0];

    makeProvider(mockPi, "minimax-openai", "https://api.minimax.io/v1", "$MINIMAX_API_KEY", "MiniMax (OpenAI)");

    const [, config] = registerProvider.mock.calls[0];
    expect(config.api).toBe("minimax-openai");
  });

  it("registers a single MiniMax-M3 model", () => {
    const registerProvider = vi.fn();
    const mockPi = { registerProvider } as unknown as Parameters<typeof makeProvider>[0];

    makeProvider(mockPi, "minimax-openai", "https://api.minimax.io/v1", "$MINIMAX_API_KEY", "MiniMax (OpenAI)");

    const [, config] = registerProvider.mock.calls[0];
    expect(config.models).toHaveLength(1);
    expect(config.models[0].id).toBe("MiniMax-M3");
    expect(config.models[0].reasoning).toBe(true);
    expect(config.models[0].input).toEqual(["text", "image"]);
  });
});

describe("M3_MODEL_CONFIG", () => {
  it("has correct pricing", () => {
    expect(M3_MODEL_CONFIG.cost).toEqual({
      input: 0.6,
      output: 2.4,
      cacheRead: 0.12,
      cacheWrite: 0,
    });
  });

  it("has correct context and output limits", () => {
    expect(M3_MODEL_CONFIG.contextWindow).toBe(1_000_000);
    expect(M3_MODEL_CONFIG.maxTokens).toBe(512_000);
  });

  it("has compat settings that disable unsupported features", () => {
    expect(M3_MODEL_CONFIG.compat).toEqual(M3_COMPAT);
  });
});

describe("M3_COMPAT", () => {
  it("disables store, developer role, and reasoning effort", () => {
    expect(M3_COMPAT.supportsStore).toBe(false);
    expect(M3_COMPAT.supportsDeveloperRole).toBe(false);
    expect(M3_COMPAT.supportsReasoningEffort).toBe(false);
  });

  it("uses max_tokens field", () => {
    expect(M3_COMPAT.maxTokensField).toBe("max_tokens");
  });
});
