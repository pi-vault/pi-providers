import { describe, expect, it } from "vitest";
import {
  COMMAND_CODE_CATALOG,
  commandCodeModels,
  modelFromCatalogRecord,
} from "../../src/providers/command-code/models.ts";
import { createCommandCodeProvider } from "../../src/providers/command-code.ts";

async function captureRequest(modelId: string): Promise<Request> {
  const provider = createCommandCodeProvider();
  const model = provider.getModels().find((candidate) => candidate.id === modelId);
  if (!model) throw new Error(`Missing test model: ${modelId}`);

  let captured: Request | undefined;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    captured = new Request(input, init);
    return new Response(
      JSON.stringify({ error: { type: "invalid_request_error", message: "test stop" } }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  };

  await provider
    .stream(
      model,
      { messages: [{ role: "user", content: "hello", timestamp: Date.now() }] },
      { apiKey: "test-key", fetch, maxRetries: 0 },
    )
    .result();

  if (!captured) throw new Error(`No request captured for: ${modelId}`);
  return captured;
}

describe("Command Code catalog conversion", () => {
  it("routes Claude records to Anthropic Messages", () => {
    expect(
      modelFromCatalogRecord({
        id: "claude-sonnet-5",
        name: "Claude Sonnet 5",
        contextWindow: 1_000_000,
      }),
    ).toMatchObject({
      id: "claude-sonnet-5",
      api: "anthropic-messages",
      provider: "command-code",
      contextWindow: 1_000_000,
    });
  });

  it("routes non-Claude records to OpenAI Completions", () => {
    expect(
      modelFromCatalogRecord({
        id: "deepseek/deepseek-v4-flash",
        name: "DeepSeek V4 Flash",
        contextWindow: 1_000_000,
      }).api,
    ).toBe("openai-completions");
  });

  it("uses conservative defaults for an unknown model", () => {
    expect(
      modelFromCatalogRecord({
        id: "new/vendor-model",
        name: "New Vendor Model",
        contextWindow: 32_000,
      }),
    ).toMatchObject({
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      maxTokens: 16_384,
    });
  });

  it("bundles the captured Command Code catalog", () => {
    expect(COMMAND_CODE_CATALOG).toHaveLength(52);
    expect(new Set(COMMAND_CODE_CATALOG.map((model) => model.id)).size).toBe(52);
    expect(new Set(COMMAND_CODE_CATALOG.map((model) => model.name)).size).toBe(52);
    expect(
      COMMAND_CODE_CATALOG.every(
        (model) =>
          model.id.trim().length > 0 &&
          model.name.trim().length > 0 &&
          Number.isInteger(model.contextWindow) &&
          model.contextWindow > 0,
      ),
    ).toBe(true);
    expect(commandCodeModels).toHaveLength(52);
    expect(
      commandCodeModels.every(
        (model) =>
          model.cost.input === 0 &&
          model.cost.output === 0 &&
          model.cost.cacheRead === 0 &&
          model.cost.cacheWrite === 0,
      ),
    ).toBe(true);
  });

  it("uses Pi metadata while preserving Command identity and context", () => {
    expect(
      modelFromCatalogRecord({
        id: "claude-sonnet-5",
        name: "Command Claude",
        contextWindow: 900_000,
      }),
    ).toMatchObject({
      name: "Command Claude",
      contextWindow: 900_000,
      reasoning: true,
      input: ["text", "image"],
      maxTokens: 128_000,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      thinkingLevelMap: { xhigh: "xhigh", max: "max" },
      compat: { forceAdaptiveThinking: true },
    });
  });

  it("falls back to a normalized display-name match", () => {
    expect(
      modelFromCatalogRecord({
        id: "Qwen/Qwen3.7-Flash",
        name: "Qwen 3.7 Flash",
        contextWindow: 200_000,
      }),
    ).toMatchObject({
      reasoning: true,
      input: ["text", "image"],
      maxTokens: 64_000,
    });
  });

  it("creates a static provider with both API families", () => {
    const provider = createCommandCodeProvider();

    expect(provider).toMatchObject({
      id: "command-code",
      name: "Command Code",
      baseUrl: "https://api.commandcode.ai/provider/v1",
    });
    expect(provider.getModels()).toHaveLength(52);
    expect(new Set(provider.getModels().map((model) => model.api))).toEqual(
      new Set(["anthropic-messages", "openai-completions"]),
    );
    expect(provider.refreshModels).toBeUndefined();
    expect(provider.auth.apiKey?.name).toBe("Command Code API key");
  });

  it("resolves CMD_API_KEY authentication", async () => {
    const apiKey = createCommandCodeProvider().auth.apiKey;
    const auth = await apiKey?.resolve({
      ctx: {
        env: async (name) => (name === "CMD_API_KEY" ? "test-key" : undefined),
        fileExists: async () => false,
      },
      signal: new AbortController().signal,
    });

    expect(auth).toEqual({ auth: { apiKey: "test-key" }, source: "CMD_API_KEY" });
  });

  it("adds the ZDR header only when CMD_ZDR is 1", () => {
    const original = process.env.CMD_ZDR;
    try {
      delete process.env.CMD_ZDR;
      expect(createCommandCodeProvider().headers).toBeUndefined();

      process.env.CMD_ZDR = "true";
      expect(createCommandCodeProvider().headers).toBeUndefined();

      process.env.CMD_ZDR = "1";
      expect(createCommandCodeProvider().headers).toEqual({ "x-cmd-zdr": "1" });
    } finally {
      if (original === undefined) delete process.env.CMD_ZDR;
      else process.env.CMD_ZDR = original;
    }
  });

  it("sends ZDR and authentication headers through both API families", async () => {
    const original = process.env.CMD_ZDR;
    process.env.CMD_ZDR = "1";

    try {
      const openAI = await captureRequest("deepseek/deepseek-v4-flash");
      expect(openAI.url).toBe("https://api.commandcode.ai/provider/v1/chat/completions");
      expect(openAI.headers.get("authorization")).toBe("Bearer test-key");
      expect(openAI.headers.get("x-cmd-zdr")).toBe("1");

      const anthropic = await captureRequest("claude-sonnet-5");
      expect(anthropic.url).toBe("https://api.commandcode.ai/provider/v1/messages");
      expect(anthropic.headers.get("x-api-key")).toBe("test-key");
      expect(anthropic.headers.get("x-cmd-zdr")).toBe("1");
    } finally {
      if (original === undefined) delete process.env.CMD_ZDR;
      else process.env.CMD_ZDR = original;
    }
  });
});
