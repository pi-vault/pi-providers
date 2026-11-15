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
    expect(
      registerProvider.mock.calls
        .slice(1, 3)
        .map((call: unknown[]) => (call[0] as { id: string }).id),
    ).toEqual(["minimax-openai", "minimax-openai-cn"]);
    expect(registerProvider.mock.calls[3]?.[0]).toBe("stepfun-ai");

    expect(registerTool).toHaveBeenCalledTimes(1);
    expect(registerTool.mock.calls[0]?.[0]).toMatchObject({
      name: "typesafe_decide",
      label: "TypeSafe Decide",
    });
  });

  function minimaxProviders() {
    const registerProvider = vi.fn();
    const registerTool = vi.fn();
    const mockPi = { registerProvider, registerTool } as unknown as Parameters<
      typeof createExtension
    >[0];
    createExtension(mockPi);
    const find = (id: string) =>
      registerProvider.mock.calls
        .map((call: unknown[]) => call[0])
        .find((provider) => (provider as { id?: string })?.id === id) as {
        id: string;
        baseUrl: string;
        refreshModels: unknown;
        getModels(): { id: string }[];
        streamSimple: unknown;
      };
    return { global: find("minimax-openai"), china: find("minimax-openai-cn") };
  }

  it("minimax-openai uses the global endpoint", () => {
    const { global } = minimaxProviders();
    expect(global.baseUrl).toBe("https://api.minimax.io/v1");
    expect(typeof global.refreshModels).toBe("function");
  });

  it("minimax-openai-cn uses the CN endpoint", () => {
    const { china } = minimaxProviders();
    expect(china.baseUrl).toBe("https://api.minimaxi.com/v1");
    expect(typeof china.refreshModels).toBe("function");
  });

  it("keeps MiniMax registrations distinct while preserving their contract", () => {
    const { global, china } = minimaxProviders();
    expect(global).not.toBe(china);
    expect(global.refreshModels).not.toBe(china.refreshModels);
    expect(global.getModels().map((model) => model.id)).toEqual([
      "MiniMax-M3.1-Flash",
      "MiniMax-M3",
    ]);
    expect(china.getModels().map((model) => model.id)).toEqual([
      "MiniMax-M3.1-Flash",
      "MiniMax-M3",
    ]);
    expect(global.streamSimple).not.toBe(china.streamSimple);
  });
});
