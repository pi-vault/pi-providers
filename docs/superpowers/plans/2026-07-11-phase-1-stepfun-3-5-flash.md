# Phase 1: StepFun Step 3.5 Flash Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a usable `stepfun-ai` provider with StepFun’s automatic-reasoning `step-3.5-flash` model.

**Architecture:** Register one model through Pi’s native `openai-completions` driver. Keep compatibility and model records private; tests assert the object captured by `registerProvider` rather than exposing test-only exports. No custom stream or MiniMax hardening is added.

**Tech Stack:** TypeScript, `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, Vitest, Biome.

**Prerequisite:** The repository has the existing MiniMax provider and extension smoke test described by the parent plan.

## File Map

- Create `src/providers/stepfun-ai.ts`: provider registration and the first model record.
- Create `tests/providers/stepfun-ai.test.ts`: registration and baseline metadata tests.
- Modify `src/index.ts`: call `registerStepFun` after the MiniMax registrations.
- Modify `tests/index.test.ts`: expect the third provider.
- Modify `README.md`: document the StepFun key, endpoint, and baseline model.

### Task 1: Add the baseline provider test

**Files:** Create `tests/providers/stepfun-ai.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { registerStepFun } from "../../src/providers/stepfun-ai.ts";

describe("registerStepFun", () => {
  it("registers the Step Plan endpoint and automatic-reasoning model", () => {
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
    expect(config.models).toHaveLength(1);
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
  });
});
```

- [ ] **Step 2: Confirm the test fails before implementation**

Run: `pnpm vitest run tests/providers/stepfun-ai.test.ts`

Expected: FAIL because `src/providers/stepfun-ai.ts` does not exist.

### Task 2: Implement and wire the baseline provider

**Files:** Create `src/providers/stepfun-ai.ts`; modify `src/index.ts`.

- [ ] **Step 1: Add the minimal provider module**

```ts
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

export function registerStepFun(pi: ExtensionAPI): void {
  pi.registerProvider("stepfun-ai", {
    name: "StepFun AI",
    baseUrl: "https://api.stepfun.ai/step_plan/v1",
    apiKey: "$STEP_API_KEY",
    api: "openai-completions",
    models: [model],
  });
}
```

- [ ] **Step 2: Wire the function into `src/index.ts`**

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { makeProvider } from "./providers/minimax-openai.ts";
import { registerStepFun } from "./providers/stepfun-ai.ts";

export default function createExtension(pi: ExtensionAPI): void {
  makeProvider(
    pi,
    "minimax-openai",
    "https://api.minimax.io/v1",
    "$MINIMAX_API_KEY",
    "MiniMax (OpenAI)",
  );
  makeProvider(
    pi,
    "minimax-openai-cn",
    "https://api.minimaxi.com/v1",
    "$MINIMAX_CN_API_KEY",
    "MiniMax CN (OpenAI)",
  );
  registerStepFun(pi);
}
```

- [ ] **Step 3: Run the focused provider test**

Run: `pnpm vitest run tests/providers/stepfun-ai.test.ts`

Expected: PASS.

### Task 3: Update extension coverage and documentation

**Files:** Modify `tests/index.test.ts` and `README.md`.

- [ ] **Step 1: Update the extension smoke test**

Replace the first test in `tests/index.test.ts` with this test; retain the two existing MiniMax endpoint tests unchanged:

```ts
it("registers both MiniMax providers and StepFun AI", () => {
  const registerProvider = vi.fn();
  const mockPi = { registerProvider } as unknown as Parameters<
    typeof createExtension
  >[0];

  createExtension(mockPi);

  expect(registerProvider).toHaveBeenCalledTimes(3);
  const names = registerProvider.mock.calls.map((call: unknown[]) => call[0]);
  expect(names).toContain("minimax-openai");
  expect(names).toContain("minimax-openai-cn");
  expect(names).toContain("stepfun-ai");
});

it("StepFun AI uses the Step Plan endpoint and key", () => {
  const registerProvider = vi.fn();
  const mockPi = { registerProvider } as unknown as Parameters<
    typeof createExtension
  >[0];

  createExtension(mockPi);

  const stepFunCall = registerProvider.mock.calls.find(
    (call: unknown[]) => call[0] === "stepfun-ai",
  );
  expect(stepFunCall).toBeDefined();
  expect(stepFunCall?.[1].baseUrl).toBe("https://api.stepfun.ai/step_plan/v1");
  expect(stepFunCall?.[1].apiKey).toBe("$STEP_API_KEY");
});
```

- [ ] **Step 2: Add baseline README configuration**

Add `export STEP_API_KEY="..."` beside the existing provider keys. Document provider `stepfun-ai`, base URL `https://api.stepfun.ai/step_plan/v1`, model `step-3.5-flash`, text-only input, automatic reasoning, and the `256_000` context/output limits.

- [ ] **Step 3: Run the phase checks**

Run: `pnpm vitest run tests/providers/stepfun-ai.test.ts tests/index.test.ts` and `pnpm check`

Expected: all focused tests, lint, typecheck, and the full suite pass.

- [ ] **Step 4: Commit the phase**

```bash
git add src/providers/stepfun-ai.ts src/index.ts tests/providers/stepfun-ai.test.ts tests/index.test.ts README.md
git commit -m "feat: add StepFun 3.5 Flash provider baseline"
```
