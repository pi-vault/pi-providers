# Phase 1: Bare MiniMax-M3 OpenAI Provider

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register MiniMax-M3 on the OpenAI-compatible endpoint using Pi's built-in `openai-completions` driver with zero custom stream handling — fixes the fake-tool-call bug immediately.

**Architecture:** The extension calls `pi.registerProvider()` twice (global + CN) with `api: "openai-completions"`, appropriate `compat` settings, and a single M3 model each. Pi's native OpenAI driver handles all SSE parsing, tool call extraction, and usage reporting. No custom `streamSimple` needed at this phase.

**Tech Stack:** TypeScript (erasable syntax only), `@earendil-works/pi-coding-agent` (`ExtensionAPI`, `ProviderModelConfig`), Vitest, Biome.

**What this fixes:** The main bug — MiniMax-M3 emitting fake tool-call markup as plain text on the Anthropic endpoint. By routing to `/v1/chat/completions`, Pi receives native OpenAI `tool_calls` objects.

**What this does NOT fix (deferred to Phase 3):** Thinking leakage (`<think>` tags visible in text) and duplicate reasoning blocks. Those require stream cleaning.

---

## File Map

| File | Responsibility |
|------|---------------|
| `src/providers/minimax-openai.ts` | Provider factory (`makeProvider`) + M3 model config + compat |
| `src/index.ts` | Extension entry: registers both providers |
| `tests/providers/minimax-openai.test.ts` | Provider registration unit tests |
| `tests/index.test.ts` | Extension smoke test (update existing) |

---

## Verification Commands

```bash
# Lint
pnpm run lint

# Typecheck
pnpm run typecheck

# Test
pnpm run test

# All three (CI gate)
pnpm run check
```

---

### Task 1: Provider Factory + Model Config

**Files:**
- Create: `src/providers/minimax-openai.ts`
- Test: `tests/providers/minimax-openai.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
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

  it("registers with api set to openai-completions", () => {
    const registerProvider = vi.fn();
    const mockPi = { registerProvider } as unknown as Parameters<typeof makeProvider>[0];

    makeProvider(mockPi, "minimax-openai", "https://api.minimax.io/v1", "$MINIMAX_API_KEY", "MiniMax (OpenAI)");

    const [, config] = registerProvider.mock.calls[0];
    expect(config.api).toBe("openai-completions");
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

  it("does not provide a custom streamSimple", () => {
    const registerProvider = vi.fn();
    const mockPi = { registerProvider } as unknown as Parameters<typeof makeProvider>[0];

    makeProvider(mockPi, "minimax-openai", "https://api.minimax.io/v1", "$MINIMAX_API_KEY", "MiniMax (OpenAI)");

    const [, config] = registerProvider.mock.calls[0];
    expect(config.streamSimple).toBeUndefined();
  });
});

describe("M3_MODEL_CONFIG", () => {
  it("has correct pricing", () => {
    expect(M3_MODEL_CONFIG.cost).toEqual({ input: 0.6, output: 2.4, cacheRead: 0.12, cacheWrite: 0 });
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test -- tests/providers/minimax-openai.test.ts`
Expected: FAIL — cannot resolve `../../src/providers/minimax-openai.ts`

- [ ] **Step 3: Implement provider factory**

```ts
// src/providers/minimax-openai.ts

import type { OpenAICompletionsCompat } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ProviderModelConfig } from "@earendil-works/pi-coding-agent";

export const M3_COMPAT: OpenAICompletionsCompat = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
  maxTokensField: "max_tokens",
};

export const M3_MODEL_CONFIG: ProviderModelConfig = {
  id: "MiniMax-M3",
  name: "MiniMax-M3",
  reasoning: true,
  input: ["text", "image"],
  cost: { input: 0.6, output: 2.4, cacheRead: 0.12, cacheWrite: 0 },
  contextWindow: 1_000_000,
  maxTokens: 512_000,
  compat: M3_COMPAT,
};

export function makeProvider(
  pi: ExtensionAPI,
  name: string,
  baseUrl: string,
  apiKey: string,
  displayName: string,
): void {
  pi.registerProvider(name, {
    name: displayName,
    baseUrl,
    apiKey,
    api: "openai-completions",
    models: [M3_MODEL_CONFIG],
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run test -- tests/providers/minimax-openai.test.ts`
Expected: all 8 tests PASS

- [ ] **Step 5: Run typecheck**

Run: `pnpm run typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/providers/minimax-openai.ts tests/providers/minimax-openai.test.ts
git commit -m "feat: add minimax-openai provider factory with M3 model config"
```

---

### Task 2: Extension Entry Point

**Files:**
- Modify: `src/index.ts`
- Modify: `tests/index.test.ts`

- [ ] **Step 1: Update test file**

Replace `tests/index.test.ts` with:

```ts
// tests/index.test.ts

import { describe, expect, it, vi } from "vitest";
import createExtension from "../src/index.ts";

describe("providers extension", () => {
  it("exports a function", () => {
    expect(typeof createExtension).toBe("function");
  });

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
    expect(globalCall![1].baseUrl).toBe("https://api.minimax.io/v1");
    expect(globalCall![1].apiKey).toBe("$MINIMAX_API_KEY");
  });

  it("minimax-openai-cn uses CN endpoint and key", () => {
    const registerProvider = vi.fn();
    const mockPi = { registerProvider } as unknown as Parameters<typeof createExtension>[0];

    createExtension(mockPi);

    const cnCall = registerProvider.mock.calls.find((call: unknown[]) => call[0] === "minimax-openai-cn");
    expect(cnCall).toBeDefined();
    expect(cnCall![1].baseUrl).toBe("https://api.minimaxi.com/v1");
    expect(cnCall![1].apiKey).toBe("$MINIMAX_CN_API_KEY");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test -- tests/index.test.ts`
Expected: FAIL — `registerProvider` not called (current `src/index.ts` body is `// TBA`)

- [ ] **Step 3: Implement extension entry**

Replace `src/index.ts` with:

```ts
// src/index.ts

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { makeProvider } from "./providers/minimax-openai.ts";

export default function createExtension(pi: ExtensionAPI): void {
  makeProvider(pi, "minimax-openai", "https://api.minimax.io/v1", "$MINIMAX_API_KEY", "MiniMax (OpenAI)");
  makeProvider(pi, "minimax-openai-cn", "https://api.minimaxi.com/v1", "$MINIMAX_CN_API_KEY", "MiniMax CN (OpenAI)");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run test -- tests/index.test.ts`
Expected: all 4 tests PASS

- [ ] **Step 5: Run full check**

Run: `pnpm run check`
Expected: lint, typecheck, and all tests pass (12 total: 8 provider + 4 entry)

- [ ] **Step 6: Commit**

```bash
git add src/index.ts tests/index.test.ts
git commit -m "feat: wire extension entry to register minimax-openai providers

Routes MiniMax-M3 to /v1/chat/completions via Pi built-in
openai-completions driver. Fixes fake-tool-call bug by avoiding
the Anthropic-compatible endpoint entirely."
```

---

## Result After Phase 1

The extension is installable and functional:
- `minimax-openai / MiniMax-M3` routes through `https://api.minimax.io/v1`
- `minimax-openai-cn / MiniMax-M3` routes through `https://api.minimaxi.com/v1`
- Pi's built-in `openai-completions` driver handles SSE parsing and tool calls
- The fake-tool-call bug is fixed (OpenAI endpoint returns structured `tool_calls`)
- Thinking leakage (`<think>` tags in text) is still visible — addressed in Phase 3
