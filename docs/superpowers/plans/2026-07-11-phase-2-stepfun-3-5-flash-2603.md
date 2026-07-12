# Phase 2: StepFun Step 3.5 Flash 2603 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `step-3.5-flash-2603` with its documented low/high reasoning controls while preserving the Phase 1 provider.

**Architecture:** Extend the existing private model list with one model-level compatibility override. The provider remains native OpenAI-compatible; no stream code or new dependency is introduced.

**Tech Stack:** TypeScript, `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, Vitest, Biome.

**Prerequisite:** Phase 1 is complete and `pnpm check` passes.

## File Map

- Modify `src/providers/stepfun-ai.ts`: add the 2603 model record and include it in registration.
- Modify `tests/providers/stepfun-ai.test.ts`: assert model order and 2603 metadata.
- Modify `README.md`: list the second model and its reasoning levels.

### Task 1: Add failing coverage for the 2603 model

**Files:** Modify `tests/providers/stepfun-ai.test.ts`.

- [ ] **Step 1: Add the metadata assertions**

After calling `registerStepFun`, assert:

```ts
expect(config.models.map((model: { id: string }) => model.id)).toEqual([
  "step-3.5-flash",
  "step-3.5-flash-2603",
]);
expect(config.models[1]).toMatchObject({
  id: "step-3.5-flash-2603",
  name: "Step 3.5 Flash 2603",
  reasoning: true,
  input: ["text"],
  contextWindow: 256_000,
  maxTokens: 256_000,
  cost: { input: 0.1, output: 0.3, cacheRead: 0.02, cacheWrite: 0 },
  thinkingLevelMap: {
    off: null,
    minimal: null,
    low: "low",
    medium: null,
    high: "high",
    xhigh: null,
  },
  compat: {
    supportsStore: false,
    supportsDeveloperRole: false,
    supportsReasoningEffort: true,
    supportsUsageInStreaming: false,
    maxTokensField: "max_tokens",
    supportsStrictMode: false,
    supportsLongCacheRetention: false,
  },
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `pnpm vitest run tests/providers/stepfun-ai.test.ts`

Expected: FAIL because the second model is not registered.

### Task 2: Add the 2603 model with explicit reasoning support

**Files:** Modify `src/providers/stepfun-ai.ts`.

- [ ] **Step 1: Define the model record**

Add this record beside the existing baseline model:

```ts
const model2603: ProviderModelConfig = {
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
  compat: { ...compat, supportsReasoningEffort: true },
};
```

- [ ] **Step 2: Register both models in order**

Change the provider config from `models: [model]` to `models: [model, model2603]`.

- [ ] **Step 3: Run focused and full checks**

Run: `pnpm vitest run tests/providers/stepfun-ai.test.ts` and `pnpm check`

Expected: the new metadata assertions pass and the full repository check is clean.

### Task 3: Update model documentation and commit

**Files:** Modify `README.md`.

- [ ] **Step 1: Extend the StepFun model list**

List `step-3.5-flash-2603` beside `step-3.5-flash`, state that it accepts text input, has `256_000` context/output limits, costs `$0.10 / $0.30` per million input/output tokens with `$0.02` cache reads, and exposes low/high reasoning selection.

- [ ] **Step 2: Review provider-specific values**

Run: `rg -n "STEP_API_KEY|stepfun-ai|step_plan/v1|step-3.5-flash" README.md`

Expected: the StepFun documentation uses only `STEP_API_KEY`, the Step Plan endpoint, and the two Phase 2 model IDs.

- [ ] **Step 3: Commit the phase**

```bash
git add src/providers/stepfun-ai.ts tests/providers/stepfun-ai.test.ts README.md
git commit -m "feat: add StepFun 3.5 Flash 2603 model"
```
