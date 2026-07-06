import { describe, expect, it, vi } from "vitest";
import createExtension from "../src/index.ts";

describe("providers extension", () => {
  it("registers minimax-openai and minimax-openai-cn providers", () => {
    const registerProvider = vi.fn();
    const mockPi = { registerProvider } as unknown as Parameters<typeof createExtension>[0];

    createExtension(mockPi);

    expect(registerProvider).toHaveBeenCalledTimes(2);
    const names = registerProvider.mock.calls.map((call: unknown[]) => call[0]);
    expect(names).toContain("minimax-openai");
    expect(names).toContain("minimax-openai-cn");
  });

  it("minimax-openai uses global endpoint and key", () => {
    const registerProvider = vi.fn();
    const mockPi = { registerProvider } as unknown as Parameters<typeof createExtension>[0];

    createExtension(mockPi);

    const globalCall = registerProvider.mock.calls.find((call: unknown[]) => call[0] === "minimax-openai");
    expect(globalCall).toBeDefined();
    expect(globalCall?.[1].baseUrl).toBe("https://api.minimax.io/v1");
    expect(globalCall?.[1].apiKey).toBe("$MINIMAX_API_KEY");
  });

  it("minimax-openai-cn uses CN endpoint and key", () => {
    const registerProvider = vi.fn();
    const mockPi = { registerProvider } as unknown as Parameters<typeof createExtension>[0];

    createExtension(mockPi);

    const cnCall = registerProvider.mock.calls.find((call: unknown[]) => call[0] === "minimax-openai-cn");
    expect(cnCall).toBeDefined();
    expect(cnCall?.[1].baseUrl).toBe("https://api.minimaxi.com/v1");
    expect(cnCall?.[1].apiKey).toBe("$MINIMAX_CN_API_KEY");
  });
});
