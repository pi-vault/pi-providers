# StepFun AI Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register StepFun Step Plan's three current chat models in `@pi-vault/pi-providers` through Pi's native OpenAI-compatible driver.

**Architecture:** Add one focused provider module that supplies static model metadata to `pi.registerProvider("stepfun-ai", ...)`. The provider uses `https://api.stepfun.ai/step_plan/v1`, `$STEP_API_KEY`, and `api: "openai-completions"`; it does not add a custom stream or reuse MiniMax-specific hardening.

**Tech Stack:** TypeScript, `@earendil-works/pi-ai` compatibility types, `@earendil-works/pi-coding-agent` extension API, Vitest, Biome.

---

## Phased execution index

The standalone phase plans below are the execution order for this parent plan. Each phase leaves a usable, tested provider and adds the next model capability in increasing complexity. Where a phase plan differs from this full-scope reference, the phase plan is authoritative for sequencing and test-only implementation details.

1. [Phase 1: Step 3.5 Flash baseline](2026-07-11-phase-1-stepfun-3-5-flash.md) — native registration, automatic reasoning, extension wiring, and initial docs.
2. [Phase 2: Step 3.5 Flash 2603](2026-07-11-phase-2-stepfun-3-5-flash-2603.md) — low/high reasoning controls and second model.
3. [Phase 3: Step 3.7 Flash](2026-07-11-phase-3-stepfun-3-7-flash.md) — multimodal model, final catalog docs, changelog, and release checks.

The parent’s full metadata and verification sections remain the scope reference; the phase plans split delivery into independently usable increments. The revised Phase 1 plan is authoritative for its private constants, captured-registration tests, and credential-gated live acceptance; the parent examples below describe the eventual three-model catalog.

---

## File Map

- Create `src/providers/stepfun-ai.ts`: StepFun provider registration, compatibility flags, thinking maps, and three model records.
- Modify `src/index.ts`: register the new provider alongside the two MiniMax providers.
- Create `tests/providers/stepfun-ai.test.ts`: provider registration and metadata tests.
- Modify `tests/index.test.ts`: expect and validate the third registration.
- Modify `README.md`: document the provider, environment variable, endpoint, models, and model facts.
- Modify `CHANGELOG.md`: add the provider under `## [Unreleased]` / `### Added`.

## Metadata Decisions

- Provider ID: `stepfun-ai` (matches the supplied models.dev catalog).
- Display name: `StepFun AI`.
- API key reference: `$STEP_API_KEY`.
- Base URL: `https://api.stepfun.ai/step_plan/v1`.
- Models: `step-3.7-flash`, `step-3.5-flash-2603`, and `step-3.5-flash` only.
- Context and output limits: `256_000` for all three models, matching the supplied catalog.
- Costs are per million tokens: 3.7 is input `0.2`, output `1.15`, cache read `0.04`; both 3.5 models are input `0.1`, output `0.3`, cache read `0.02`; all cache-write rates are `0`.
- `step-3.7-flash` supports `low`, `medium`, and `high` reasoning effort.
- `step-3.5-flash-2603` supports `low` and `high` reasoning effort.
- `step-3.5-flash` performs automatic reasoning; expose only `high` as its available Pi thinking state and do not send `reasoning_effort`.
- Compatibility disables `store`, developer-role prompts, strict tool schemas, streaming usage request options, and long cache retention; it selects `max_tokens`.
- Pi already parses StepFun’s documented `reasoning` and `reasoning_content` fields, so no stream transformation is required.

### Task 1: Add StepFun Provider Tests

**Files:**

- Create: `tests/providers/stepfun-ai.test.ts`

- [ ] **Step 1: Write failing registration and metadata tests**

```ts
import { describe, expect, it, vi } from "vitest";
import {
  registerStepFun,
  STEPFUN_COMPAT,
  STEPFUN_MODELS,
} from "../../src/providers/stepfun-ai.ts";

describe("registerStepFun", () => {
  it("registers the StepFun Step Plan endpoint and key", () => {
    const registerProvider = vi.fn();
    const pi = { registerProvider } as unknown as Parameters<
      typeof registerStepFun
    >[0];

    registerStepFun(pi);

    expect(registerProvider).toHaveBeenCalledOnce();
    const [name, config] = registerProvider.mock.calls[0];
    expect(name).toBe("stepfun-ai");
    expect(config.name).toBe("StepFun AI");
    expect(config.baseUrl).toBe("https://api.stepfun.ai/step_plan/v1");
    expect(config.apiKey).toBe("$STEP_API_KEY");
    expect(config.api).toBe("openai-completions");
  });

  it("registers the three current Step Plan chat models", () => {
    const registerProvider = vi.fn();
    const pi = { registerProvider } as unknown as Parameters<
      typeof registerStepFun
    >[0];

    registerStepFun(pi);

    const [, config] = registerProvider.mock.calls[0];
    expect(config.models.map((model: { id: string }) => model.id)).toEqual([
      "step-3.7-flash",
      "step-3.5-flash-2603",
      "step-3.5-flash",
    ]);
  });
});

describe("StepFun model metadata", () => {
  it("matches the catalog limits, modalities, and prices", () => {
    expect(STEPFUN_MODELS).toHaveLength(3);
    expect(STEPFUN_MODELS[0]).toMatchObject({
      id: "step-3.7-flash",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 256_000,
      maxTokens: 256_000,
      cost: { input: 0.2, output: 1.15, cacheRead: 0.04, cacheWrite: 0 },
    });
    expect(STEPFUN_MODELS[1]).toMatchObject({
      id: "step-3.5-flash-2603",
      input: ["text"],
      contextWindow: 256_000,
      maxTokens: 256_000,
      cost: { input: 0.1, output: 0.3, cacheRead: 0.02, cacheWrite: 0 },
    });
    expect(STEPFUN_MODELS[2]).toMatchObject({
      id: "step-3.5-flash",
      input: ["text"],
      contextWindow: 256_000,
      maxTokens: 256_000,
      cost: { input: 0.1, output: 0.3, cacheRead: 0.02, cacheWrite: 0 },
    });
  });

  it("maps only the documented thinking levels", () => {
    expect(STEPFUN_MODELS[0].thinkingLevelMap).toEqual({
      off: null,
      minimal: null,
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: null,
    });
    expect(STEPFUN_MODELS[1].thinkingLevelMap).toEqual({
      off: null,
      minimal: null,
      low: "low",
      medium: null,
      high: "high",
      xhigh: null,
    });
    expect(STEPFUN_MODELS[2].thinkingLevelMap).toEqual({
      off: null,
      minimal: null,
      low: null,
      medium: null,
      high: "high",
      xhigh: null,
    });
  });

  it("uses the explicit StepFun OpenAI compatibility settings", () => {
    expect(STEPFUN_COMPAT).toEqual({
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsUsageInStreaming: false,
      maxTokensField: "max_tokens",
      supportsStrictMode: false,
      supportsLongCacheRetention: false,
    });
    expect(STEPFUN_MODELS[0].compat?.supportsReasoningEffort).toBe(true);
    expect(STEPFUN_MODELS[1].compat?.supportsReasoningEffort).toBe(true);
    expect(STEPFUN_MODELS[2].compat?.supportsReasoningEffort).toBe(false);
  });
});
```

- [ ] **Step 2: Run the focused test and confirm it fails because the provider module does not exist**

Run: `pnpm vitest run tests/providers/stepfun-ai.test.ts`

Expected: FAIL with an import/module-resolution error for `src/providers/stepfun-ai.ts`.

### Task 2: Implement the Native StepFun Provider

**Files:**

- Create: `src/providers/stepfun-ai.ts`

- [ ] **Step 1: Add the provider module with the exact registration and model configuration**

```ts
import type { OpenAICompletionsCompat } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";

export const STEPFUN_COMPAT: OpenAICompletionsCompat = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
  supportsUsageInStreaming: false,
  maxTokensField: "max_tokens",
  supportsStrictMode: false,
  supportsLongCacheRetention: false,
};

export const STEPFUN_MODELS: ProviderModelConfig[] = [
  {
    id: "step-3.7-flash",
    name: "Step 3.7 Flash",
    reasoning: true,
    thinkingLevelMap: {
      off: null,
      minimal: null,
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: null,
    },
    input: ["text", "image"],
    cost: { input: 0.2, output: 1.15, cacheRead: 0.04, cacheWrite: 0 },
    contextWindow: 256_000,
    maxTokens: 256_000,
    compat: { ...STEPFUN_COMPAT, supportsReasoningEffort: true },
  },
  {
    id: "step-3.5-flash-2603",
    name: "Step 3.5 Flash 2603",
    reasoning: true,
    thinkingLevelMap: {
      off: null,
      minimal: null,
      low: "low",
      medium: null,
      high: "high",
      xhigh: null,
    },
    input: ["text"],
    cost: { input: 0.1, output: 0.3, cacheRead: 0.02, cacheWrite: 0 },
    contextWindow: 256_000,
    maxTokens: 256_000,
    compat: { ...STEPFUN_COMPAT, supportsReasoningEffort: true },
  },
  {
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
    compat: { ...STEPFUN_COMPAT },
  },
];

export function registerStepFun(pi: ExtensionAPI): void {
  pi.registerProvider("stepfun-ai", {
    name: "StepFun AI",
    baseUrl: "https://api.stepfun.ai/step_plan/v1",
    apiKey: "$STEP_API_KEY",
    api: "openai-completions",
    models: STEPFUN_MODELS,
  });
}
```

- [ ] **Step 2: Run the focused provider tests and confirm they pass**

Run: `pnpm vitest run tests/providers/stepfun-ai.test.ts`

Expected: all StepFun provider tests pass.

- [ ] **Step 3: Commit the provider and its tests**

```bash
git add src/providers/stepfun-ai.ts tests/providers/stepfun-ai.test.ts
git commit -m "feat: add StepFun AI provider"
```

### Task 3: Wire the Provider Into the Extension

**Files:**

- Modify: `src/index.ts`
- Modify: `tests/index.test.ts`

- [ ] **Step 1: Update the extension entrypoint**

Add the import and registration call while preserving the existing MiniMax registrations:

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

- [ ] **Step 2: Update the extension smoke test**

Change the registration count from `2` to `3`, rename the test to cover all providers, and add assertions for the StepFun endpoint and key:

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
  expect(stepFunCall?.[1].api).toBe("openai-completions");
});
```

- [ ] **Step 3: Run the provider and extension tests**

Run: `pnpm vitest run tests/providers/stepfun-ai.test.ts tests/index.test.ts`

Expected: all focused tests pass, including the existing MiniMax assertions.

- [ ] **Step 4: Commit the wiring changes**

```bash
git add src/index.ts tests/index.test.ts
git commit -m "feat: register StepFun AI extension provider"
```

### Task 4: Document the Provider

**Files:**

- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add StepFun to the README provider list and configuration section**

Document these exact user-facing values:

```text
export STEP_API_KEY="..."
```

```text
Provider: stepfun-ai
Base URL: https://api.stepfun.ai/step_plan/v1
Models: step-3.7-flash, step-3.5-flash-2603, step-3.5-flash
```

State that the provider uses Pi's native OpenAI-completions driver, supports text/image input only for `step-3.7-flash`, and exposes the documented reasoning controls for 3.7 and 3.5-2603.

- [ ] **Step 2: Add an Unreleased changelog entry**

Insert this before the released `0.1.0` section:

```markdown
## [Unreleased]

### Added

- `stepfun-ai` provider for StepFun Step Plan models via the OpenAI-compatible endpoint.
```

- [ ] **Step 3: Review the documentation diff for stale environment names or endpoints**

Run: `rg -n "STEP_API_KEY|STEPFUN_API_KEY|stepfun-ai|step_plan/v1" README.md CHANGELOG.md`

Expected: only `STEP_API_KEY`, `stepfun-ai`, and `https://api.stepfun.ai/step_plan/v1` appear for the new provider.

- [ ] **Step 4: Commit the documentation changes**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: document StepFun AI provider"
```

### Task 5: Run Repository Verification

**Files:** None.

- [ ] **Step 1: Run the full package check**

Run: `pnpm check`

Expected: Biome lint, TypeScript typecheck, and all Vitest tests pass. Existing baseline lint warnings must not increase.

- [ ] **Step 2: Run the release packaging check**

Run: `pnpm release:check`

Expected: the full check passes and the package dry-run includes `src/providers/stepfun-ai.ts`, README, and changelog without adding dependencies.

- [ ] **Step 3: Run authenticated live Pi checkout verification when credentials are available**

With an active Step Plan subscription and `STEP_API_KEY` configured, run `pi -e ./src/index.ts --list-models stepfun-ai`, then exercise text, tool calling, `step-3.7-flash` image input, and each documented reasoning level. If credentials are unavailable, record the live check as pending rather than claiming the provider is live-verified.

## Self-Review

- All three requested Step Plan chat models are covered by Task 2.
- Provider ID, endpoint, API key, model limits, prices, modalities, and reasoning maps are asserted by tests.
- Existing MiniMax behavior is preserved and checked by the updated extension test.
- README and changelog updates are explicit and covered by a search check.
- No live Pi verification is assigned to the implementer, per user instruction.
- No placeholders or unspecified implementation decisions remain.
