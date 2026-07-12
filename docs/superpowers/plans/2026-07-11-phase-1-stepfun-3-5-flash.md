# Phase 1: StepFun Step 3.5 Flash Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a usable `stepfun-ai` provider with StepFun's automatic-reasoning `step-3.5-flash` model.

**Architecture:** Register one static model through Pi's native `openai-completions` driver. Keep model and compatibility records private; Pi 0.80.3 already parses StepFun's documented `reasoning`/`reasoning_content` response fields, so no custom stream or MiniMax hardening is added. Automated tests assert the captured registration object, then an authenticated smoke test verifies a real text, reasoning, and tool-call round trip.

**Tech Stack:** TypeScript, `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, Vitest, Biome.

**Prerequisite:** The existing MiniMax provider and extension smoke tests pass. The current repository baseline has 73 passing tests; its existing non-failing Biome warnings are out of scope and must not increase.

**Source decisions:** StepFun's official Step Plan guides define the endpoint as `https://api.stepfun.ai/step_plan/v1` and use `STEP_API_KEY`; models.dev supplies the model limits and prices. `step-3.5-flash` supports automatic reasoning and text input only.

## File Map

- Create `src/providers/stepfun-ai.ts`: provider registration, one private compatibility record, and one private model record.
- Create `tests/providers/stepfun-ai.test.ts`: provider and model metadata assertions through the captured registration call.
- Modify `src/index.ts`: register StepFun after the two MiniMax providers.
- Modify `tests/index.test.ts`: expect the third provider while retaining the existing MiniMax endpoint tests.
- Modify `README.md`: document the StepFun key, endpoint, model, limits, pricing, and automatic reasoning.

### Task 1: Add the failing provider contract test

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

- [ ] **Step 2: Wire the provider into `src/index.ts`**

Add the import and call while preserving both existing MiniMax registrations:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerStepFun } from "./providers/stepfun-ai.ts";
import { makeProvider } from "./providers/minimax-openai.ts";

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

- [ ] **Step 4: Commit the provider implementation**

```bash
git add src/providers/stepfun-ai.ts src/index.ts tests/providers/stepfun-ai.test.ts
git commit -m "feat: add StepFun 3.5 Flash provider baseline"
```

### Task 3: Update extension coverage and README documentation

**Files:** Modify `tests/index.test.ts` and `README.md`.

- [ ] **Step 1: Update the extension smoke test**

Change the registration assertion to expect three providers and include `stepfun-ai`; retain the two existing MiniMax endpoint tests unchanged:

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
```

- [ ] **Step 2: Add the StepFun configuration block to `README.md`**

Add this key configuration beside the existing MiniMax keys:

```bash
# StepFun Step Plan endpoint (stepfun-ai)
export STEP_API_KEY="..."
```

Add a StepFun section documenting provider `stepfun-ai`, base URL `https://api.stepfun.ai/step_plan/v1`, model `step-3.5-flash`, text-only input, automatic reasoning with only Pi's `high` state exposed, 256,000 context/output limits, and pricing of `$0.10` input, `$0.30` output, `$0.02` cache reads, and free cache writes per million tokens. State that the provider uses Pi's native OpenAI-compatible driver and sends no explicit reasoning-effort parameter.

- [ ] **Step 3: Run focused tests and the repository check**

Run: `pnpm vitest run tests/providers/stepfun-ai.test.ts tests/index.test.ts` and `pnpm check`

Expected: focused tests pass, all existing tests pass, and the pre-existing Biome warnings do not increase.

- [ ] **Step 4: Commit wiring and documentation**

```bash
git add tests/index.test.ts README.md
git commit -m "docs: document StepFun baseline provider"
```

### Task 4: Perform authenticated live acceptance

**Files:** None.

- [ ] **Step 1: Confirm the model is discoverable**

With an active Step Plan subscription and `STEP_API_KEY` configured, run:

```bash
pi -e ./src/index.ts --list-models stepfun-ai
```

Expected: `stepfun-ai/step-3.5-flash` appears.

- [ ] **Step 2: Verify streamed reasoning and final text**

Run:

```bash
pi -e ./src/index.ts --model stepfun-ai/step-3.5-flash:high --mode json --no-session -p "Explain why 17 is prime."
```

Expected: the session emits reasoning and final text events, then exits successfully.

- [ ] **Step 3: Verify a native tool-call round trip**

Run:

```bash
pi -e ./src/index.ts --model stepfun-ai/step-3.5-flash:high --tools read --no-session -p "Use the read tool to read package.json and report only the package name."
```

Expected: StepFun emits a native tool call, Pi returns the tool result, and the model completes normally.

If credentials are unavailable, leave the automated checks as the verified result and explicitly record live acceptance as pending; do not claim the provider is live-verified.

## Self-Review

- Phase 1 contains only the baseline `step-3.5-flash` model; later model additions remain in Phases 2 and 3.
- The API key, endpoint, model limits, prices, modalities, reasoning map, and compatibility flags are asserted by tests.
- Private constants avoid test-only public exports.
- No duplicate StepFun endpoint test, custom stream, dependency, alias key, or MiniMax refactor is introduced.
- Every implementation step has an exact file, command, expected result, and commit boundary.
- No placeholders or unspecified implementation decisions remain.
