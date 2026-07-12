# Phase 3: StepFun Step 3.7 Flash and Release Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the StepFun catalog with multimodal `step-3.7-flash`, finalize user-facing documentation, and verify the package is release-ready.

**Architecture:** Add the third static model to the same native OpenAI-compatible registration. Its model-level reasoning map enables low/medium/high, while its compatibility override enables `reasoning_effort`; all shared endpoint and compatibility behavior remains unchanged.

**Tech Stack:** TypeScript, `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, Vitest, Biome, pnpm packaging.

**Prerequisite:** Phases 1 and 2 are complete and the provider currently registers the two 3.5 models.

## File Map

- Modify `src/providers/stepfun-ai.ts`: add the multimodal 3.7 model and final ordering.
- Modify `tests/providers/stepfun-ai.test.ts`: assert the complete three-model catalog.
- Modify `README.md`: document final modalities, reasoning, prices, and limits.
- Modify `CHANGELOG.md`: add the Unreleased StepFun entry.

### Task 1: Add failing coverage for Step 3.7 Flash

**Files:** Modify `tests/providers/stepfun-ai.test.ts`.

- [ ] **Step 1: Assert final model order and 3.7 metadata**

```ts
expect(config.models.map((model: { id: string }) => model.id)).toEqual([
  "step-3.7-flash",
  "step-3.5-flash-2603",
  "step-3.5-flash",
]);
expect(config.models[0]).toMatchObject({
  id: "step-3.7-flash",
  name: "Step 3.7 Flash",
  reasoning: true,
  input: ["text", "image"],
  contextWindow: 256_000,
  maxTokens: 256_000,
  cost: { input: 0.2, output: 1.15, cacheRead: 0.04, cacheWrite: 0 },
  thinkingLevelMap: {
    off: null,
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: null,
  },
  compat: { supportsReasoningEffort: true },
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `pnpm vitest run tests/providers/stepfun-ai.test.ts`

Expected: FAIL because the 3.7 model is not registered and the order is incomplete.

### Task 2: Implement the multimodal model and final ordering

**Files:** Modify `src/providers/stepfun-ai.ts`.

- [ ] **Step 1: Define the 3.7 model**

Add this private record:

```ts
const model37: ProviderModelConfig = {
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
  compat: { ...compat, supportsReasoningEffort: true },
};
```

- [ ] **Step 2: Register the final model list**

Change the provider config to `models: [model37, model2603, model]`.

- [ ] **Step 3: Run focused and full tests**

Run: `pnpm vitest run tests/providers/stepfun-ai.test.ts tests/index.test.ts` and `pnpm check`

Expected: all three models and existing MiniMax registrations pass without lint or type errors.

### Task 3: Complete release documentation

**Files:** Modify `README.md` and `CHANGELOG.md`.

- [ ] **Step 1: Complete the README provider section**

Document all three IDs, the Step Plan endpoint, `$STEP_API_KEY`, `256_000` context/output limits, per-model pricing, text/image input only for `step-3.7-flash`, and the reasoning controls: low/medium/high for 3.7, low/high for 3.5-2603, and high-only automatic reasoning for 3.5.

- [ ] **Step 2: Add the Unreleased changelog entry**

Insert before the `0.1.0` section:

```markdown
## [Unreleased]

### Added

- `stepfun-ai` provider for StepFun Step Plan models via the OpenAI-compatible endpoint.
```

- [ ] **Step 3: Check for stale names and endpoints**

Run: `rg -n "STEP_API_KEY|STEPFUN_API_KEY|stepfun-ai|step_plan/v1|step-3\\.(5|7)-flash" README.md CHANGELOG.md`

Expected: the new provider uses `STEP_API_KEY`, `stepfun-ai`, and `https://api.stepfun.ai/step_plan/v1`; no `STEPFUN_API_KEY` appears.

### Task 4: Run release verification and commit

**Files:** None beyond the documentation and source changes above.

- [ ] **Step 1: Run the complete checks**

Run: `pnpm release:check`

Expected: Biome lint, TypeScript typecheck, all Vitest tests, and `pnpm pack --dry-run` pass; the dry-run includes `src/providers/stepfun-ai.ts`, README, and changelog.

- [ ] **Step 2: Commit the completed provider**

```bash
git add src/providers/stepfun-ai.ts tests/providers/stepfun-ai.test.ts README.md CHANGELOG.md
git commit -m "feat: complete StepFun AI provider catalog"
```

- [ ] **Step 3: Perform manual live verification after authentication**

With `STEP_API_KEY` configured in the user’s Pi checkout, confirm all three `stepfun-ai/*` models appear, text requests work, 3.7 accepts image input, tool calls remain native, and each documented reasoning selection is available. This is an external verification step, not part of the package test suite.
