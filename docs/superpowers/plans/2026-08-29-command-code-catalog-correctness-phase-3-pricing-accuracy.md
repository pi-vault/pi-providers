# Command Code Catalog Correctness — Phase 3 Pricing Accuracy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Parent plan:** [2026-08-29-command-code-catalog-correctness.md](./2026-08-29-command-code-catalog-correctness.md)

**Goal:** Apply Command Code's billed 2026-08-29 price snapshot to the 62-model baseline while retaining explicit free models and the unknown-model zero fallback.

**Architecture:** Keep pricing as the existing exact-ID overlay in `models.ts`; update only proven stale or newly required entries. Represent DeepSeek's UTC bands and temporary promotions with the rates billed on the snapshot date, documenting the static-model limitations and expiry dates beside the data.

**Tech Stack:** TypeScript 6, Node.js 24.15.0, pnpm, Vitest, and Pi's `ModelCost` shape.

**Spec:** [docs/superpowers/plans/2026-08-29-command-code-catalog-correctness.md](./2026-08-29-command-code-catalog-correctness.md)

**References:** [Command Code Provider API](https://commandcode.ai/docs/provider), [Command Code pricing](https://commandcode.ai/docs/resources/pricing-limits), and Pi's `ModelCost` definition at `/Users/lanh/Developer/pi-packages/pi/packages/ai/src/types.ts`.

## Global Constraints

- Costs are the effective rates billed on 2026-08-29 in USD per 1M tokens, including active promotions.
- Treat open-source rates as Command's displayed mean across upstream providers; request costs may vary slightly by route.
- Preserve the zero-cost fallback for unknown future IDs.
- Use exact IDs; do not introduce a pricing service, price-band abstraction, or runtime fetch.
- Keep the 62-model `/provider/v1/models` baseline; do not add pricing-page-only models.
- Keep every unrelated cost entry, public API, endpoint, auth, ZDR, refresh, persistence, and registration behavior unchanged.
- Do not modify MiniMax or StepFun source files or tests.

**Prerequisite:** Phases 1 and 2 are committed; the bundled baseline contains 62 models and Pi 0.84.4 supplies donor metadata.

**Usable result:** Every bundled model has the intended dated estimate or an explicit free-model zero, while unknown future models continue to degrade safely to zero.

---

### Task 1: Lock the final pricing contract

**Files:**

- Test: `tests/providers/command-code.test.ts`

**Interfaces:**

- Consumes: `costFor(id: string): ModelCost` indirectly through converted models.
- Produces: exact regression assertions for changed, new, free, tiered, and unknown pricing behavior.

- [ ] **Step 1: Add the final catalog cost invariant**

In `bundles the captured Command Code catalog`, add:

```ts
const zeroCostIds = new Set([
  "poolside/laguna-s-2.1-free",
  "minimax/minimax-m3-free",
  "minimax/minimax-m2.7-free",
]);

expect(
  commandCodeModels.every((model) => {
    if (zeroCostIds.has(model.id)) {
      return Object.values(model.cost).every((rate) =>
        Array.isArray(rate) ? true : rate === 0,
      );
    }
    return (
      model.cost.input > 0 &&
      model.cost.output > 0 &&
      [
        model.cost.input,
        model.cost.output,
        model.cost.cacheRead,
        model.cost.cacheWrite,
      ].every((rate) => Number.isFinite(rate) && rate >= 0)
    );
  }),
).toBe(true);
```

- [ ] **Step 2: Replace and add exact pricing assertions**

In `uses Command’s stable and tiered pricing`, keep the GPT-5.6 Terra/Luna tier assertions and unknown-model zero fallback unchanged. Replace the stale Claude Sonnet 5 and DeepSeek expectations and add:

```ts
expect(costFor("claude-sonnet-5")).toEqual({
  input: 2,
  output: 10,
  cacheRead: 0.2,
  cacheWrite: 2.5,
});
expect(costFor("deepseek/deepseek-v4-pro")).toEqual({
  input: 0.66,
  output: 1.98,
  cacheRead: 0.022,
  cacheWrite: 0,
});
expect(costFor("deepseek/deepseek-v4-flash")).toEqual({
  input: 0.22,
  output: 0.66,
  cacheRead: 0.007,
  cacheWrite: 0,
});
expect(costFor("deepseek/deepseek-v4-flash-vision-exp")).toEqual({
  input: 0.22,
  output: 0.66,
  cacheRead: 0.007,
  cacheWrite: 0,
});
expect(costFor("z-ai/glm-5.3-flash")).toEqual({
  input: 0.15,
  output: 0.5,
  cacheRead: 0.03,
  cacheWrite: 0,
});
expect(costFor("zai-org/GLM-5.3")).toEqual({
  input: 1.4,
  output: 4.4,
  cacheRead: 0.26,
  cacheWrite: 0,
});
expect(costFor("Qwen/Qwen3.8-27B")).toEqual({
  input: 0.4,
  output: 3,
  cacheRead: 0.04,
  cacheWrite: 0,
});
expect(costFor("Qwen/Qwen3.8-Flash")).toEqual({
  input: 0.16,
  output: 0.47,
  cacheRead: 0.016,
  cacheWrite: 0,
});
expect(costFor("tencent/hy4-preview")).toEqual({
  input: 0.834,
  output: 2.501,
  cacheRead: 0.042,
  cacheWrite: 0,
});
expect(costFor("google/gemini-3.7-flash")).toEqual({
  input: 0.75,
  output: 3.75,
  cacheRead: 0.075,
  cacheWrite: 0.04167,
});
expect(costFor("xai/grok-4.6")).toEqual({
  input: 2,
  output: 6,
  cacheRead: 0.5,
  cacheWrite: 0,
});
expect(costFor("minimax/minimax-m3-free")).toEqual({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
});
expect(costFor("minimax/minimax-m2.7-free")).toEqual({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
});
```

- [ ] **Step 3: Run the catalog and pricing tests and verify they fail**

Run:

```bash
pnpm vitest run tests/providers/command-code.test.ts -t "bundles|pricing"
```

Expected: FAIL because changed and newly added paid records do not match and the final positive-price invariant rejects their zero fallback.

### Task 2: Update the exact-ID cost overlay

**Files:**

- Modify: `src/providers/command-code/models.ts`
- Test: `tests/providers/command-code.test.ts`

**Interfaces:**

- Consumes: `COMMAND_COSTS`, `ZERO_COST`, and the 62 Phase 2 catalog IDs.
- Produces: final `ModelCost` values for converted Command Code models without changing `costFor` behavior.

- [ ] **Step 1: Update the snapshot annotation and DeepSeek limitation**

Change the cost snapshot comment date to `2026-08-29`. Place this comment immediately above the DeepSeek entries:

```ts
// ponytail: Pi ModelCost cannot express UTC price bands. These are Command's displayed
// off-peak estimates; refresh them if Command changes the bands or Pi gains time-band pricing.
// Peak input/output: Pro 1.32/3.96; Flash and Flash Vision 0.44/1.32.
```

Place this comment immediately above the MiniMax free entries:

```ts
// ponytail: ModelCost cannot expire rates. These IDs are free through 2026-09-05
// and go offline 2026-09-06; remove them when the bundled catalog is refreshed.
```

Place this comment immediately above the Gemini 3.7 Flash entry:

```ts
// ponytail: ModelCost cannot expire rates. Gemini 3.7 Flash is 50% off through
// 2026-12-31; refresh this snapshot after the promotion ends.
```

- [ ] **Step 2: Replace the three stale entries and add the new entries**

Update `COMMAND_COSTS` with the exact values asserted in Task 1. Use the existing object shape and ordering by provider group. For the explicit MiniMax free IDs, write:

```ts
"minimax/minimax-m3-free": ZERO_COST,
"minimax/minimax-m2.7-free": ZERO_COST,
```

Keep every unrelated cost entry unchanged.

- [ ] **Step 3: Run the focused and complete provider tests**

Run:

```bash
pnpm vitest run tests/providers/command-code.test.ts -t "bundles|pricing"
pnpm vitest run tests/providers/command-code.test.ts
```

Expected: the pricing contract passes, all non-free bundled models have positive finite input/output rates, the three explicit free IDs remain zero, and all other provider tests pass.

- [ ] **Step 4: Run static project checks**

Run:

```bash
env npm_config_cache=/private/tmp/pi-providers-command-pricing-npm-cache mise x node@24.15.0 -- pnpm check
```

Expected: formatting, linting, type checking, the complete test suite, and package verification pass. Existing unrelated `noNonNullAssertion` warnings may remain warnings; do not edit those files.

- [ ] **Step 5: Commit the atomic phase**

```bash
git add src/providers/command-code/models.ts tests/providers/command-code.test.ts
git commit -m "fix: refresh Command Code pricing"
```

## Phase 3 Acceptance Criteria

- Claude Sonnet 5, DeepSeek V4, Gemini 3.7 Flash, and all newly bundled paid records match the billed 2026-08-29 estimates in this plan.
- The three explicit free IDs have all-zero costs; unknown future IDs still receive `ZERO_COST`.
- The DeepSeek off-peak representation, peak rates, and temporary Gemini and MiniMax pricing expiry dates are documented beside the data.
- No unrelated price, provider behavior, or public interface changes.
- Focused tests, the full Command Code test file, and the supported-runtime `pnpm check` pass.
