# Command Code Provider — Phase 2 Pricing Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Parent plan:** [2026-08-08-command-code-provider.md](./2026-08-08-command-code-provider.md)

**Previous phase:** [Phase 1 static provider](./2026-08-08-command-code-provider-phase-1-static-provider.md)

**Goal:** Add a stable Command-specific pricing snapshot without changing transport, model identity, routing, capabilities, or ZDR.

**Architecture:** Keep the Phase 1 catalog and donor conversion. Add a private exact-ID ModelCost overlay in src/providers/command-code/models.ts. Use post-promotion rates for temporary offers, Pi-native tiers for GPT-5.6 Terra/Luna above 272K input tokens, and the existing zero-cost fallback for unknown or intentionally excluded prices.

**Tech Stack:** TypeScript, @earendil-works/pi-ai 0.84.1 ModelCost, official Command Code pricing, Vitest, Biome, pnpm.

---

## Files

- Modify src/providers/command-code/models.ts for the typed cost overlay and converter application.
- Modify tests/providers/command-code.test.ts for pricing invariants and policy-edge assertions.
- Modify README.md and CHANGELOG.md for the static snapshot documentation.

## Locked pricing policy

- Rates are USD per 1M tokens: input, output, cacheRead, cacheWrite.
- Permanent Command discounts are encoded at their published rates.
- Temporary offers use stable post-promotion rates: Claude Sonnet 5 is 3 / 15 / 0.3 / 3.75; GPT Terra is 2 / 12 / 0.2 / 2.5 with a >272K tier of 4 / 18 / 0.4 / 5; GPT Luna is 0.2 / 1.2 / 0.02 / 0.25 with a >272K tier of 0.4 / 1.8 / 0.04 / 0.5.
- A documented em dash cache-write value becomes zero. Pi’s tiers field is used only where the published bands differ.
- Omit poolside/laguna-s-2.1-free because “free while capacity lasts” has no stable fallback; zero means unknown estimate.
- The pricing page has 55 rows, while the captured Provider API catalog has 52. Do not add Ling 3.0 Flash, Claude Opus 4.6, or Claude Sonnet 4.5 because they are absent from COMMAND_CODE_CATALOG.

## Task 1: Add failing pricing tests

**Files:**

- Test: tests/providers/command-code.test.ts

- [ ] **Step 1: Replace the Phase 1 all-zero assertion.** Keep the 52-model and routing assertions. Assert Laguna has the existing zero-cost object and every other bundled model has finite, nonnegative rates with positive input and output.

```ts
const laguna = commandCodeModels.find(
  (model) => model.id === "poolside/laguna-s-2.1-free",
);
expect(laguna?.cost).toEqual({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
});
expect(
  commandCodeModels
    .filter((model) => model.id !== "poolside/laguna-s-2.1-free")
    .every((model) => {
      const rates = [
        model.cost.input,
        model.cost.output,
        model.cost.cacheRead,
        model.cost.cacheWrite,
      ];
      return (
        rates.every((rate) => Number.isFinite(rate) && rate >= 0) &&
        model.cost.input > 0 &&
        model.cost.output > 0
      );
    }),
).toBe(true);
```

- [ ] **Step 2: Add permanent-discount assertions.** Assert these exact costs:

```ts
expect(
  modelFromCatalogRecord({
    id: "deepseek/deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    contextWindow: 1_000_000,
  }).cost,
).toEqual({ input: 0.435, output: 0.87, cacheRead: 0.003625, cacheWrite: 0 });
expect(
  modelFromCatalogRecord({
    id: "MiniMaxAI/MiniMax-M3",
    name: "MiniMax M3",
    contextWindow: 1_000_000,
  }).cost,
).toEqual({ input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 });
expect(
  modelFromCatalogRecord({
    id: "xiaomi/mimo-v2.5-pro",
    name: "MiMo V2.5 Pro",
    contextWindow: 1_000_000,
  }).cost,
).toEqual({ input: 0.435, output: 0.87, cacheRead: 0.0036, cacheWrite: 0 });
expect(
  modelFromCatalogRecord({
    id: "xiaomi/mimo-v2.5",
    name: "MiMo V2.5",
    contextWindow: 1_000_000,
  }).cost,
).toEqual({ input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 });
```

- [ ] **Step 3: Add stable-promotion and tier assertions.** Assert Claude Sonnet 5 has 3 / 15 / 0.3 / 3.75. Assert GPT Terra has base 2 / 12 / 0.2 / 2.5 plus tiers [{ inputTokensAbove: 272_000, input: 4, output: 18, cacheRead: 0.4, cacheWrite: 5 }]. Assert GPT Luna has base 0.2 / 1.2 / 0.02 / 0.25 plus tiers [{ inputTokensAbove: 272_000, input: 0.4, output: 1.8, cacheRead: 0.04, cacheWrite: 0.5 }].

- [ ] **Step 4: Retain the unknown fallback test.** Assert an arbitrary future ID still gets ZERO_COST while retaining Command identity and the supplied context window.

- [ ] **Step 5: Run the focused tests and confirm failure.**

Run: pnpm vitest run tests/providers/command-code.test.ts

Expected: the new positive-rate and exact-rate assertions fail because Phase 1 assigns ZERO_COST to every model.

## Task 2: Implement the exact-ID cost overlay

**Files:**

- Modify: src/providers/command-code/models.ts

- [ ] **Step 1: Import ModelCost** from @earendil-works/pi-ai alongside the existing Model and API types.

- [ ] **Step 2: Preserve catalog ID literals and add COMMAND_COSTS after COMMAND_CODE_CATALOG.** Add as const before satisfies readonly CommandCodeCatalogRecord[] on the catalog declaration, then use the literal-ID map below so TypeScript rejects an orphan key:

```ts
type CommandCodeCatalogId = (typeof COMMAND_CODE_CATALOG)[number]["id"];
const COMMAND_COSTS: Readonly<
  Partial<Record<CommandCodeCatalogId, ModelCost>>
> = {
  // Snapshot source: https://commandcode.ai/docs/resources/pricing-limits
  // Stable post-promotion rates captured 2026-08-08; USD per 1M tokens.
};
```

- [ ] **Step 3: Populate every priced catalog ID with the official table values.** Use this complete rate inventory (input / output / cache read / cache write); omit only Laguna:

| Catalog IDs                                     | Rates                                           |
| ----------------------------------------------- | ----------------------------------------------- |
| claude-sonnet-5, claude-sonnet-4-6              | 3 / 15 / 0.3 / 3.75                             |
| claude-fable-5                                  | 10 / 50 / 1 / 12.5                              |
| claude-opus-5, claude-opus-4-8, claude-opus-4-7 | 5 / 25 / 0.5 / 6.25                             |
| claude-haiku-4-5-20251001                       | 1 / 5 / 0.1 / 1.25                              |
| gpt-5.6-sol                                     | 5 / 30 / 0.5 / 6.25                             |
| gpt-5.6-terra                                   | 2 / 12 / 0.2 / 2.5 plus the tier in Task 1      |
| gpt-5.6-luna                                    | 0.2 / 1.2 / 0.02 / 0.25 plus the tier in Task 1 |
| gpt-5.5                                         | 5 / 30 / 0.5 / 0                                |
| gpt-5.4                                         | 2.5 / 15 / 0.25 / 0                             |
| gpt-5.3-codex                                   | 2 / 8 / 0.5 / 0                                 |
| gpt-5.4-mini                                    | 0.75 / 4.5 / 0.075 / 0                          |
| deepseek/deepseek-v4-pro                        | 0.435 / 0.87 / 0.003625 / 0                     |
| deepseek/deepseek-v4-flash                      | 0.14 / 0.28 / 0.0028 / 0                        |
| moonshotai/Kimi-K3                              | 3 / 15 / 0.3 / 0                                |
| moonshotai/Kimi-K2.7-Code                       | 0.95 / 4 / 0.19 / 0                             |
| moonshotai/Kimi-K2.7-Code-Highspeed             | 1.9 / 8 / 0.38 / 0                              |
| moonshotai/Kimi-K2.6                            | 0.95 / 4 / 0.16 / 0                             |
| moonshotai/Kimi-K2.5                            | 0.6 / 3 / 0.1 / 0                               |
| zai-org/GLM-5.2, zai-org/GLM-5.1                | 1.4 / 4.4 / 0.26 / 0                            |
| zai-org/GLM-5.2-Fast                            | 3 / 10.25 / 0.5 / 0                             |
| zai-org/GLM-5                                   | 1 / 3.2 / 0.2 / 0                               |
| MiniMaxAI/MiniMax-M3, MiniMaxAI/MiniMax-M2.7    | 0.3 / 1.2 / 0.06 / 0                            |
| MiniMaxAI/MiniMax-M2.5                          | 0.3 / 1.2 / 0.03 / 0                            |
| xiaomi/mimo-v2.5-pro                            | 0.435 / 0.87 / 0.0036 / 0                       |
| xiaomi/mimo-v2.5                                | 0.14 / 0.28 / 0.0028 / 0                        |
| Qwen/Qwen3.8-Max                                | 2 / 6 / 0.25 / 2.5                              |
| Qwen/Qwen3.7-Max                                | 2.5 / 7.5 / 0.5 / 3.13                          |
| Qwen/Qwen3.7-Plus                               | 0.4 / 1.6 / 0.08 / 0.5                          |
| Qwen/Qwen3.7-Flash                              | 0.03 / 0.13 / 0.006 / 0.038                     |
| Qwen/Qwen3.6-Max-Preview                        | 1.3 / 7.8 / 0.26 / 1.63                         |
| Qwen/Qwen3.6-Plus                               | 0.5 / 3 / 0.1 / 0                               |
| stepfun/Step-3.7-Flash                          | 0.2 / 1.15 / 0.04 / 0                           |
| stepfun/Step-3.5-Flash                          | 0.1 / 0.3 / 0.02 / 0                            |
| tencent/hy3-paid                                | 0.14 / 0.58 / 0.035 / 0                         |
| google/gemini-3.6-flash                         | 1.5 / 7.5 / 0.15 / 0                            |
| google/gemini-3.5-flash                         | 1.5 / 9 / 0.15 / 0                              |
| google/gemini-3.5-flash-lite                    | 0.3 / 2.5 / 0.03 / 0                            |
| google/gemini-3.1-flash-lite                    | 0.25 / 1.5 / 0.03 / 0                           |
| sakana/fugu-ultra                               | 5 / 30 / 0.5 / 0                                |
| nvidia/nemotron-3-ultra-550b-a55b               | 0.6 / 2.4 / 0.12 / 0                            |
| thinkingmachines/inkling                        | 1 / 4.05 / 0.17 / 0                             |
| thinkingmachines/inkling-small                  | 0.5 / 1.2 / 0.1 / 0                             |
| meta/muse-spark-1.1, meta/muse-spark-1.2        | 1.25 / 4.25 / 0.15 / 0                          |
| meta/muse-spark-1.2-contributor                 | 0.1 / 0.2 / 0.002 / 0                           |
| xai/grok-4.5                                    | 2 / 6 / 0.5 / 0                                 |

- [ ] **Step 4: Apply the overlay.** Replace cost: ZERO_COST in modelFromCatalogRecord with cost: COMMAND_COSTS[record.id as CommandCodeCatalogId] ?? ZERO_COST. The cast keeps the existing runtime fallback for future string IDs; it does not expand the static map. Do not alter routing, donor metadata, identity, context, max-token clamping, compatibility, headers, or provider construction.

- [ ] **Step 5: Run focused tests and commit.**

Run: pnpm vitest run tests/providers/command-code.test.ts

Expected: all provider tests pass without network access.

```bash
git add src/providers/command-code/models.ts tests/providers/command-code.test.ts
git commit -m "feat: add Command Code pricing metadata"
```

## Task 3: Update user-facing documentation

**Files:**

- Modify: README.md
- Modify: CHANGELOG.md

- [ ] **Step 1: Replace the README’s zero/unknown Command pricing statement.** State that the 52-model provider includes a dated static Command pricing snapshot, that Laguna remains unknown because its free offer is capacity-limited, and that rates are per 1M tokens.

- [ ] **Step 2: Add estimate caveats.** State that temporary promotions are normalized to post-promotion list rates and actual open-model or ZDR requests may vary with upstream routing.

- [ ] **Step 3: Extend the Unreleased changelog entry.** Mention permanent discounts, GPT context tiers, stable promotion handling, and the intentional unknown fallback.

- [ ] **Step 4: Commit documentation.**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: describe Command Code pricing snapshot"
```

## Task 4: Verify the Phase 2 gate

- [ ] **Step 1: Run focused provider and registration tests.**

Run: pnpm vitest run tests/providers/command-code.test.ts tests/index.test.ts

Expected: all focused tests pass and both API families remain registered.

- [ ] **Step 2: Run pnpm check under Node 24.15+.** If the local npm cache is root-owned, rerun package verification with a writable temporary npm_config_cache, then rerun the full gate under the supported runtime.

- [ ] **Step 3: Inspect the final diff.**

```bash
git diff origin/master...HEAD --check
git status --short
```

Expected: only pricing metadata, tests, README/changelog, and intended plan changes appear; no runtime catalog fetch or Phase 1 transport change appears.

## Phase 2 acceptance criteria

- 51 of 52 bundled models have positive official Command rate snapshots.
- Laguna remains unknown instead of encoding a capacity-limited free promotion.
- Permanent discounts and GPT >272K tiers are accurate.
- Temporary GPT/Claude promotions do not become stale code.
- Pricing-only models absent from the 52-model Provider API catalog are not added.
- Phase 1 routing, identity, capabilities, transport, registration, and ZDR remain unchanged.
- pnpm check passes under Node 24.15+.
