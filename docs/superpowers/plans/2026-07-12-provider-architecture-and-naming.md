# Provider Architecture and Naming Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax and should be completed task-by-task.

**Goal:** Give MiniMax and StepFun equally narrow provider registration interfaces, then colocate MiniMax-only stream hardening under its owning provider without changing runtime behavior.

**Architecture:** `src/index.ts` will know only the two provider registration operations. MiniMax will retain a private variant helper for its global and China adapters, while both provider modules use private `compat` and `models` records. MiniMax’s four nontrivial hardening modules remain separate but move beside the provider entry file so their seam and implementation have better locality.

**Tech Stack:** TypeScript, `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, Vitest, Biome, pnpm.

---

## Scope and file map

Stage 1 changes the provider interfaces and naming:

- `src/providers/minimax-openai.ts`: expose `registerMiniMax(pi)`, make model records private, and retain a private variant-registration helper.
- `src/providers/stepfun-ai.ts`: keep `registerStepFun(pi)` and replace three one-off model names with one private `models` catalog.
- `src/index.ts`: call the two provider registration operations only.
- `tests/providers/minimax-openai.test.ts`: test MiniMax through captured registration objects and the public registration function.
- `tests/providers/stepfun-ai.test.ts`: retain registration and metadata coverage through the registration seam.
- `tests/index.test.ts`: verify the package entry still registers all three provider IDs.

Stage 2 changes only locality and import paths:

- Move `src/core/clean-stream.ts`, `harden-tool-calls.ts`, `normalize-tool-results.ts`, and `think-scanner.ts` to `src/providers/minimax-openai/`.
- Move their tests from `tests/core/` to `tests/providers/minimax-openai/`.
- Update imports while preserving the existing pipeline order and implementations.

No README, changelog, historical plan, or design document changes are required. The undocumented exports `makeProvider`, `M3_COMPAT`, and `M3_MODEL_CONFIG` are removed; no compatibility aliases are added.

## Task 1: Lock the new registration and naming contract in tests

**Files:**

- Modify: `tests/providers/minimax-openai.test.ts`
- Modify: `tests/providers/stepfun-ai.test.ts`
- Modify: `tests/index.test.ts`

- [ ] **Step 1: Rewrite MiniMax test imports and registration setup**

Change the MiniMax test import to:

```ts
import { registerMiniMax } from "../../src/providers/minimax-openai.ts";
```

Replace each direct `makeProvider(...)` setup with `registerMiniMax(mockPi)` and select the desired registration from `registerProvider.mock.calls` by provider ID. Keep the existing stream assertions, but obtain `streamSimple` from the captured `minimax-openai` configuration.

- [ ] **Step 2: Assert both MiniMax variants through the new seam**

Add one focused test that calls `registerMiniMax` once and asserts:

```ts
expect(registerProvider).toHaveBeenCalledTimes(2);
expect(registerProvider.mock.calls.map(([id]) => id)).toEqual([
  "minimax-openai",
  "minimax-openai-cn",
]);
```

Retain endpoint, key, display-name, model, compatibility, and stream-pipeline assertions. Do not import any MiniMax model or compatibility constant.

- [ ] **Step 3: Keep StepFun metadata tests registration-based**

Leave `registerStepFun` as the only imported symbol. Capture `config.models` and assert the existing three IDs in this order:

```ts
expect(config.models.map((entry: { id: string }) => entry.id)).toEqual([
  "step-3.7-flash",
  "step-3.5-flash-2603",
  "step-3.5-flash",
]);
```

Keep the current per-model metadata, thinking-level, and compatibility assertions.

- [ ] **Step 4: Preserve package-entry coverage**

Keep `tests/index.test.ts` asserting exactly three registrations and the IDs `minimax-openai`, `minimax-openai-cn`, and `stepfun-ai`. The endpoint/key assertions remain unchanged.

- [ ] **Step 5: Run the contract tests and confirm the expected failure**

Run:

```bash
pnpm vitest run tests/providers/minimax-openai.test.ts tests/providers/stepfun-ai.test.ts tests/index.test.ts
```

Expected: tests fail because `registerMiniMax` does not exist yet and the old exported MiniMax constants are still referenced by the test file until the edits are complete.

## Task 2: Implement the narrow provider registration interfaces

**Files:**

- Modify: `src/providers/minimax-openai.ts`
- Modify: `src/providers/stepfun-ai.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Make MiniMax metadata private and consistently named**

Rename the exported records to private lower-camel declarations:

```ts
const compat: OpenAICompletionsCompat = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
  maxTokensField: "max_tokens",
};

const models: ProviderModelConfig[] = [{
  id: "MiniMax-M3",
  name: "MiniMax-M3",
  reasoning: true,
  input: ["text", "image"],
  cost: { input: 0.6, output: 2.4, cacheRead: 0.12, cacheWrite: 0 },
  contextWindow: 1_000_000,
  maxTokens: 512_000,
  compat,
}];
```

Keep the existing model values exactly unchanged.

- [ ] **Step 2: Rename and privatize the reusable MiniMax variant helper**

Rename `makeProvider` to a private `registerMiniMaxVariant` with the same five parameters and the same `streamSimple` implementation. Keep its driver lookup, `normalizeToolResults`, `hardenToolCalls`, and `cleanStream` ordering unchanged. Use `models` in the registration object.

- [ ] **Step 3: Add the public MiniMax registration operation**

Add this exported function after the private helper:

```ts
export function registerMiniMax(pi: ExtensionAPI): void {
  registerMiniMaxVariant(
    pi,
    "minimax-openai",
    "https://api.minimax.io/v1",
    "$MINIMAX_API_KEY",
    "MiniMax (OpenAI)",
  );
  registerMiniMaxVariant(
    pi,
    "minimax-openai-cn",
    "https://api.minimaxi.com/v1",
    "$MINIMAX_CN_API_KEY",
    "MiniMax CN (OpenAI)",
  );
}
```

This is the only exported symbol from the MiniMax provider module.

- [ ] **Step 4: Normalize StepFun’s private catalog names**

Keep the existing private `compat` record. Replace `model`, `model2603`, and `model37` with one private `models: ProviderModelConfig[]` array containing the same three objects in the current registration order. Update the registration object to `models`.

- [ ] **Step 5: Narrow the package entry**

Change `src/index.ts` to import `registerMiniMax` and replace the two five-argument calls with:

```ts
registerMiniMax(pi);
registerStepFun(pi);
```

Preserve the registration order: MiniMax global, MiniMax China, then StepFun.

- [ ] **Step 6: Run the focused tests**

Run:

```bash
pnpm vitest run tests/providers/minimax-openai.test.ts tests/providers/stepfun-ai.test.ts tests/index.test.ts
```

Expected: all focused tests pass, including the MiniMax stream integration assertions and all StepFun metadata assertions.

- [ ] **Step 7: Commit Stage 1**

```bash
git add src/providers/minimax-openai.ts src/providers/stepfun-ai.ts src/index.ts tests/providers/minimax-openai.test.ts tests/providers/stepfun-ai.test.ts tests/index.test.ts
git commit -m "refactor: narrow provider registration interfaces"
```

## Task 3: Move MiniMax hardening modules under provider ownership

**Files:**

- Move: `src/core/clean-stream.ts` → `src/providers/minimax-openai/clean-stream.ts`
- Move: `src/core/harden-tool-calls.ts` → `src/providers/minimax-openai/harden-tool-calls.ts`
- Move: `src/core/normalize-tool-results.ts` → `src/providers/minimax-openai/normalize-tool-results.ts`
- Move: `src/core/think-scanner.ts` → `src/providers/minimax-openai/think-scanner.ts`
- Move: `tests/core/clean-stream.test.ts` → `tests/providers/minimax-openai/clean-stream.test.ts`
- Move: `tests/core/harden-tool-calls.test.ts` → `tests/providers/minimax-openai/harden-tool-calls.test.ts`
- Move: `tests/core/normalize-tool-results.test.ts` → `tests/providers/minimax-openai/normalize-tool-results.test.ts`
- Move: `tests/core/think-scanner.test.ts` → `tests/providers/minimax-openai/think-scanner.test.ts`
- Modify: `src/providers/minimax-openai.ts`
- Modify: moved hardening tests’ relative imports

- [ ] **Step 1: Move source modules and tests without editing contents**

Use `git mv` to preserve history and create the destination directory:

```bash
mkdir -p src/providers/minimax-openai tests/providers/minimax-openai
git mv src/core/clean-stream.ts src/providers/minimax-openai/clean-stream.ts
git mv src/core/harden-tool-calls.ts src/providers/minimax-openai/harden-tool-calls.ts
git mv src/core/normalize-tool-results.ts src/providers/minimax-openai/normalize-tool-results.ts
git mv src/core/think-scanner.ts src/providers/minimax-openai/think-scanner.ts
git mv tests/core/clean-stream.test.ts tests/providers/minimax-openai/clean-stream.test.ts
git mv tests/core/harden-tool-calls.test.ts tests/providers/minimax-openai/harden-tool-calls.test.ts
git mv tests/core/normalize-tool-results.test.ts tests/providers/minimax-openai/normalize-tool-results.test.ts
git mv tests/core/think-scanner.test.ts tests/providers/minimax-openai/think-scanner.test.ts
```

- [ ] **Step 2: Update MiniMax source imports**

In `src/providers/minimax-openai.ts`, change the three imports from `../core/...` to:

```ts
import { cleanStream } from "./minimax-openai/clean-stream.ts";
import { hardenToolCalls } from "./minimax-openai/harden-tool-calls.ts";
import { normalizeToolResults } from "./minimax-openai/normalize-tool-results.ts";
```

Keep `clean-stream.ts`’s `./think-scanner.ts` import unchanged because both files now share the same directory.

- [ ] **Step 3: Update moved test imports**

In every moved test, change imports from `../../src/core/...` to `../../src/providers/minimax-openai/...`. Do not alter test logic or fixtures.

- [ ] **Step 4: Verify no generic-core references remain**

Run:

```bash
rg "src/core|\\.\\./core|from \\"\\.\\/core" src tests
```

Expected: no matches. The old `src/core/` directory should be empty and removable if Git leaves it present.

- [ ] **Step 5: Run moved-module and provider tests**

Run:

```bash
pnpm vitest run tests/providers/minimax-openai tests/providers/stepfun-ai.test.ts tests/index.test.ts
```

Expected: all moved hardening tests, MiniMax provider tests, StepFun tests, and entry tests pass.

- [ ] **Step 6: Commit Stage 2**

```bash
git add src/providers/minimax-openai.ts src/providers/minimax-openai tests/providers/minimax-openai
git commit -m "refactor: colocate MiniMax hardening modules"
```

## Task 4: Repository verification and self-review

**Files:** None.

- [ ] **Step 1: Run the complete quality check**

Run:

```bash
pnpm release:check
```

Expected: Biome lint, TypeScript compilation, all 74 tests, and package dry-run complete successfully. The existing 14 non-null-assertion warnings may remain; no new warnings should appear.

- [ ] **Step 2: Inspect the final diff and public exports**

Run:

```bash
git diff HEAD~2..HEAD --stat
git status --short
rg "export (const|function)" src/providers/minimax-openai.ts src/providers/stepfun-ai.ts
```

Expected: MiniMax exports only `registerMiniMax`; StepFun exports only `registerStepFun`; the worktree is clean.

- [ ] **Step 3: Confirm behavior-preserving scope**

Review that no model metadata, endpoint, environment-key reference, compatibility flag, stream transformation, error mode, or registration order changed. The only intentional interface changes are removal of undocumented deep imports and the new `registerMiniMax(pi)` seam.

## Self-review checklist

- Coverage: registration interface, constant naming, tests, source relocation, import updates, and final verification each have explicit tasks.
- Placeholder scan: no incomplete markers or unspecified implementation steps are used.
- Type consistency: both providers use `compat` and `models`; MiniMax exposes `registerMiniMax(pi)`; StepFun retains `registerStepFun(pi)`.
- Scope: no shared provider factory, model builder, test utility, or hardening merge is introduced.
