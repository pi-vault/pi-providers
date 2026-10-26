import { describe, expect, it, vi } from "vitest";
import createExtension from "../src/index.ts";

describe("providers extension", () => {
  it("registers Command Code before MiniMax providers and StepFun AI, plus the typesafe_decide tool", () => {
    const registerProvider = vi.fn();
    const registerTool = vi.fn();
    const mockPi = { registerProvider, registerTool } as unknown as Parameters<
      typeof createExtension
    >[0];

    createExtension(mockPi);

    expect(registerProvider).toHaveBeenCalledTimes(4);
    const commandCodeProvider = registerProvider.mock.calls[0]?.[0];
    expect(commandCodeProvider).toMatchObject({ id: "command-code" });
    expect(
      new Set(commandCodeProvider.getModels().map((model: { api: string }) => model.api)),
    ).toEqual(new Set(["anthropic-messages", "openai-completions", "openai-responses"]));
    expect(registerProvider.mock.calls.slice(1).map((call: unknown[]) => call[0])).toEqual([
      "minimax-openai",
      "minimax-openai-cn",
      "stepfun-ai",
    ]);

    expect(registerTool).toHaveBeenCalledTimes(1);
    expect(registerTool.mock.calls[0]?.[0]).toMatchObject({
      name: "typesafe_decide",
      label: "TypeSafe Decide",
    });
  });

  it("minimax-openai uses global endpoint and key", () => {
    const registerProvider = vi.fn();
    const registerTool = vi.fn();
    const mockPi = { registerProvider, registerTool } as unknown as Parameters<
      typeof createExtension
    >[0];

    createExtension(mockPi);

    const globalCall = registerProvider.mock.calls.find(
      (call: unknown[]) => call[0] === "minimax-openai",
    );
    expect(globalCall).toBeDefined();
    expect(globalCall?.[1].baseUrl).toBe("https://api.minimax.io/v1");
    expect(globalCall?.[1].apiKey).toBe("$MINIMAX_API_KEY");
    expect(typeof globalCall?.[1].refreshModels).toBe("function");
  });

  it("minimax-openai-cn uses CN endpoint and key", () => {
    const registerProvider = vi.fn();
    const registerTool = vi.fn();
    const mockPi = { registerProvider, registerTool } as unknown as Parameters<
      typeof createExtension
    >[0];

    createExtension(mockPi);

    const cnCall = registerProvider.mock.calls.find(
      (call: unknown[]) => call[0] === "minimax-openai-cn",
    );
    expect(cnCall).toBeDefined();
    expect(cnCall?.[1].baseUrl).toBe("https://api.minimaxi.com/v1");
    expect(cnCall?.[1].apiKey).toBe("$MINIMAX_CN_API_KEY");
    expect(typeof cnCall?.[1].refreshModels).toBe("function");
  });

  it("keeps MiniMax registrations distinct while preserving their contract", () => {
    const registerProvider = vi.fn();
    const registerTool = vi.fn();
    const mockPi = { registerProvider, registerTool } as unknown as Parameters<
      typeof createExtension
    >[0];

    createExtension(mockPi);

    const globalCall = registerProvider.mock.calls.find(
      (call: unknown[]) => call[0] === "minimax-openai",
    );
    const cnCall = registerProvider.mock.calls.find(
      (call: unknown[]) => call[0] === "minimax-openai-cn",
    );
    expect(globalCall?.[1].refreshModels).not.toBe(cnCall?.[1].refreshModels);
    expect(globalCall?.[1].models.map((model: { id: string }) => model.id)).toEqual([
      "MiniMax-M3.1-Flash",
      "MiniMax-M3",
    ]);
    expect(cnCall?.[1].models.map((model: { id: string }) => model.id)).toEqual([
      "MiniMax-M3.1-Flash",
      "MiniMax-M3",
    ]);
    expect(globalCall?.[1].streamSimple).not.toBe(cnCall?.[1].streamSimple);
  });
});
