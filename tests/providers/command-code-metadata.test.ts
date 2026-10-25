import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";

vi.mock("@earendil-works/pi-ai/providers/all", () => ({
  getBuiltinProviders: () => [],
  getBuiltinModels: () => [],
}));

import {
  COMMAND_CODE_CATALOG,
  type CommandCodeCatalogRecord,
  modelFromCatalogRecord,
} from "../../src/providers/command-code/models.ts";

const FLASH_MODEL_ID = "minimax/minimax-m3.1-flash";

const expectedAdditions: Record<
  string,
  { input: ("text" | "image")[]; cost: Record<string, unknown> }
> = {
  "claude-haiku-5-5": {
    input: ["text", "image"],
    cost: {
      input: 0.1,
      output: 0.5,
      cacheRead: 0.01,
      cacheWrite: 0.125,
      tiers: [
        {
          inputTokensAbove: 100_000,
          input: 0.5,
          output: 2.5,
          cacheRead: 0.05,
          cacheWrite: 0.625,
        },
      ],
    },
  },
  "moonshotai/Kimi-K3.1-Pro": {
    input: ["text", "image"],
    cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 0 },
  },
  [FLASH_MODEL_ID]: {
    input: ["text", "image"],
    cost: { input: 0.15, output: 0.6, cacheRead: 0.015, cacheWrite: 0 },
  },
  "ornith/ornith-1.5-122b": {
    input: ["text", "image"],
    cost: { input: 0.16, output: 0.64, cacheRead: 0.02, cacheWrite: 0 },
  },
  "Qwen/Qwen3.8-Max-Prime": {
    input: ["text", "image"],
    cost: { input: 4, output: 12, cacheRead: 0.5, cacheWrite: 5 },
  },
  "google/gemini-4-argon": {
    input: ["text", "image"],
    cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 0 },
  },
  "nvidia/nemotron-3.5-super-vl": {
    input: ["text", "image"],
    cost: { input: 0.2, output: 0.5, cacheRead: 0.04, cacheWrite: 0 },
  },
  "stealth/glyph-cluster:free": {
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  "reflection/beam:free": {
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  "inclusionai/ling-3.1-flash": {
    input: ["text"],
    cost: { input: 0.3, output: 0.9, cacheRead: 0.06, cacheWrite: 0 },
  },
  "meta/muse-spark-open": {
    input: ["text", "image"],
    cost: { input: 1.25, output: 4.25, cacheRead: 0.15, cacheWrite: 0 },
  },
  "meta/muse-wonder-1.0": {
    input: ["text", "image"],
    cost: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 0 },
  },
  "mistral/mistral-large-4": {
    input: ["text", "image"],
    cost: { input: 1.36, output: 4.18, cacheRead: 0.14, cacheWrite: 0 },
  },
};

describe("Command Code local metadata", () => {
  it("uses verified capabilities without a Pi donor", () => {
    expect(Object.keys(expectedAdditions)).toHaveLength(13);

    for (const [id, expected] of Object.entries(expectedAdditions)) {
      const record = COMMAND_CODE_CATALOG.find((candidate) => candidate.id === id);
      if (!record) throw new Error(`Missing catalog record: ${id}`);

      expect(modelFromCatalogRecord(record), id).toMatchObject({
        reasoning: true,
        input: expected.input,
        cost: expected.cost,
      });
    }
  });

  it("adds Flash effort controls to bundled and metadata-poor records", () => {
    const bundled = COMMAND_CODE_CATALOG.find((record) => record.id === FLASH_MODEL_ID);
    if (!bundled) throw new Error(`Missing catalog record: ${FLASH_MODEL_ID}`);
    const live: CommandCodeCatalogRecord = {
      id: FLASH_MODEL_ID,
      name: "MiniMax M3.1 Flash",
      contextWindow: 1_000_000,
      supportedEndpoints: ["/chat/completions"],
    };

    for (const [label, record] of Object.entries({ bundled, live })) {
      const flash = modelFromCatalogRecord(record);

      expect(flash, label).toMatchObject({
        api: "openai-completions",
        input: ["text", "image"],
        reasoning: true,
        maxTokens: 32_768,
        cost: { input: 0.15, output: 0.6, cacheRead: 0.015, cacheWrite: 0 },
        compat: { supportsReasoningEffort: true, maxTokensField: "max_tokens" },
      });
      expect(flash.thinkingLevelMap, label).toEqual({
        off: null,
        minimal: null,
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "xhigh",
        max: "max",
      });
      expect(getSupportedThinkingLevels(flash), label).toEqual([
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
      ]);
    }
  });

  it("lets valid live metadata override local capabilities", () => {
    const flash = modelFromCatalogRecord({
      id: FLASH_MODEL_ID,
      name: "Renamed Flash",
      contextWindow: 64_000,
      supportedEndpoints: ["/chat/completions"],
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      maxOutputTokens: 1234,
    });

    expect(flash).toMatchObject({
      name: "Renamed Flash",
      contextWindow: 64_000,
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      maxTokens: 1234,
      api: "openai-completions",
      compat: { supportsReasoningEffort: false },
    });
    expect(flash.thinkingLevelMap).toBeUndefined();
    expect(getSupportedThinkingLevels(flash)).toEqual(["off"]);
  });

  it("uses live endpoints without Flash Completions controls", () => {
    const flash = modelFromCatalogRecord({
      id: FLASH_MODEL_ID,
      name: "Renamed Flash",
      contextWindow: 64_000,
      supportedEndpoints: ["/responses"],
      reasoning: true,
      input: ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      maxOutputTokens: 1234,
    });

    expect(flash.api).toBe("openai-responses");
    expect(flash.compat).toBeUndefined();
    expect(flash.thinkingLevelMap).toBeUndefined();
  });

  it("retains local Flash capabilities when live modalities are absent", () => {
    const flash = modelFromCatalogRecord({
      id: FLASH_MODEL_ID,
      name: "MiniMax M3.1 Flash",
      contextWindow: 1_000_000,
      supportedEndpoints: ["/chat/completions"],
    });

    expect(flash.input).toEqual(["text", "image"]);
  });
});
