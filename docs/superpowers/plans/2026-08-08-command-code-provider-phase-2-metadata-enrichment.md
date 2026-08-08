# Command Code Provider — Phase 2 Pricing Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Parent plan:** [2026-08-08-command-code-provider.md](./2026-08-08-command-code-provider.md)

**Previous phase:** [Phase 1 static provider](./2026-08-08-command-code-provider-phase-1-static-provider.md)

**Goal:** Add accurate Command-specific cost estimates without changing static transport, model identity, routing, or capability matching.

**Prerequisite:** Phase 1 is complete and its phase gate passes.

**Usable result:** Every bundled Command model has a cost snapshot sourced from Command’s pricing page; temporary promotions and capacity-limited free offers are excluded from stable estimates.

**Architecture:** Keep Pi-derived capabilities from Phase 1. Add a Command-ID keyed cost table from the official pricing page, with normalized-name matching only during snapshot creation. Permanent Command discounts are recorded; time-limited offers use their documented post-promotion list rate.

**Tech Stack:** TypeScript, official Command Code pricing docs, Vitest, Biome, pnpm.

---

## Files

- Modify `src/providers/command-code/models.ts` to add the static Command cost table and apply it after capability conversion.
- Modify `tests/providers/command-code.test.ts` with complete cost coverage and override tests.
- Modify `README.md` and `CHANGELOG.md` to describe the pricing snapshot.

### Task 1: Capture and test Command pricing

- [ ] **Step 1: Add failing cost tests**

Assert all bundled IDs resolve to a non-placeholder cost and assert the permanent rates documented by Command Code:

```ts
expect(modelFromCatalogRecord(deepseekPro).cost).toEqual({ input: 0.435, output: 0.87, cacheRead: 0.003625, cacheWrite: 0 });
expect(modelFromCatalogRecord(minimaxM3).cost).toEqual({ input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 });
expect(modelFromCatalogRecord(mimoPro).cost).toEqual({ input: 0.435, output: 0.87, cacheRead: 0.0036, cacheWrite: 0 });
expect(modelFromCatalogRecord(mimo).cost).toEqual({ input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 });
```

- [ ] **Step 2: Run tests and confirm failure**

Run `pnpm vitest run tests/providers/command-code.test.ts`. Expected: Phase 1’s zero-cost assertions fail for the new pricing tests.

- [ ] **Step 3: Add the complete static cost map**

Transcribe the 52 bundled model rates from [Command pricing and limits](https://commandcode.ai/docs/resources/pricing-limits), keyed by the exact Command IDs. Use current stable list rates for temporary GPT/Claude promotions and zero only when the official table explicitly lists a model as free without a stable rate. Preserve cache-read and cache-write values.

- [ ] **Step 4: Apply costs after capability conversion**

Use `COMMAND_COSTS[record.id] ?? ZERO_COST` so future unmatched IDs remain usable and visibly unknown. Do not alter Command identity, context, API selection, or donor traits.

- [ ] **Step 5: Run and commit pricing tests**

Run `pnpm vitest run tests/providers/command-code.test.ts`. Expected: every bundled model has the captured cost and permanent overrides match the official page.

```bash
git add src/providers/command-code/models.ts tests/providers/command-code.test.ts
git commit -m "feat: add Command Code pricing metadata"
```

### Task 2: Document and verify pricing

- [ ] **Step 1: Update README and changelog**

Explain that costs are a versioned Command snapshot, not a live billing query; temporary promotions are intentionally not encoded.

- [ ] **Step 2: Run the phase gate**

Run:

```bash
pnpm vitest run tests/providers/command-code.test.ts tests/index.test.ts
pnpm check
```

Expected: all checks pass and Phase 1 routing/ZDR behavior is unchanged.

- [ ] **Step 3: Commit the documentation**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: describe Command Code pricing snapshot"
```

## Phase 2 acceptance criteria

- Every bundled model has an official Command cost snapshot.
- Permanent discounts are represented accurately.
- Temporary promotions and capacity-limited free offers do not become stale code.
- Phase 1 transport, routing, metadata, and ZDR behavior remain unchanged.
- `pnpm check` passes.
