# Command Code Catalog Correctness — Phase 2 Catalog Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Parent plan:** [2026-08-29-command-code-catalog-correctness.md](./2026-08-29-command-code-catalog-correctness.md)

**Goal:** Expand the bundled Command Code baseline from 52 to the 62 Provider API records captured on 2026-08-29 and correct their identity and context metadata.

**Architecture:** Add only the ten records proven present in the public Provider API snapshot, grouped with their existing providers. Continue using the converter and Pi 0.84.4 donor lookup from Phase 1; defer changed pricing assertions and values to Phase 3 so this phase has a passing, catalog-focused gate.

**Tech Stack:** TypeScript 6, Node.js 24.15.0, pnpm, Vitest, and Pi 0.84.4.

**Spec:** [docs/superpowers/plans/2026-08-29-command-code-catalog-correctness.md](./2026-08-29-command-code-catalog-correctness.md)

## Global Constraints

- Treat the 62 records returned by the public Provider API on 2026-08-29 as the bundled baseline.
- Do not add Ling 3.0 Flash, Claude Opus 4.6, Claude Sonnet 4.5, or other pricing-page-only models absent from that response.
- Keep endpoints, auth, ZDR, live overlay, persistence, refresh, cancellation, registration, and public interfaces unchanged.
- Use Pi 0.84.4 donor metadata; do not add local capability overrides.
- Preserve the current cost overlay and unknown-ID `ZERO_COST` fallback until Phase 3.
- Do not modify MiniMax or StepFun source files or tests.

**Prerequisite:** Phase 1 is committed and both Pi packages resolve 0.84.4.

**Usable result:** Every model in the 2026-08-29 Provider API snapshot remains selectable offline with correct identity, context, routing, and donor capabilities.

---

### Task 1: Lock the 62-model snapshot

**Files:**

- Test: `tests/providers/command-code.test.ts`

**Interfaces:**

- Consumes: `COMMAND_CODE_CATALOG` and `commandCodeModels`.
- Produces: a regression contract for exact catalog count, membership, identity, context, and structural validity.

- [ ] **Step 1: Replace the 52-model snapshot assertions**

In `bundles the captured Command Code catalog`, replace the hard-coded 52 assertions with:

```ts
const newIds = [
  "deepseek/deepseek-v4-flash-vision-exp",
  "z-ai/glm-5.3-flash",
  "zai-org/GLM-5.3",
  "minimax/minimax-m3-free",
  "minimax/minimax-m2.7-free",
  "Qwen/Qwen3.8-27B",
  "Qwen/Qwen3.8-Flash",
  "tencent/hy4-preview",
  "google/gemini-3.7-flash",
  "xai/grok-4.6",
];

expect(COMMAND_CODE_CATALOG).toHaveLength(62);
expect(new Set(COMMAND_CODE_CATALOG.map((model) => model.id)).size).toBe(62);
expect(COMMAND_CODE_CATALOG.map((model) => model.id)).toEqual(
  expect.arrayContaining(newIds),
);
expect(
  COMMAND_CODE_CATALOG.find((model) => model.id === "gpt-5.5")?.contextWindow,
).toBe(400_000);
expect(
  COMMAND_CODE_CATALOG.find(
    (model) => model.id === "deepseek/deepseek-v4-pro",
  )?.name,
).toBe("DeepSeek V4 Pro (latest)");
expect(commandCodeModels).toHaveLength(62);
```

Retain the existing assertions for nonblank IDs/names, positive integer contexts, and unique IDs. Remove only the display-name uniqueness assertion because paid/free MiniMax aliases intentionally share display names.

Do not add the final positive-price invariant in this phase; newly bundled paid IDs intentionally retain the existing unknown-ID fallback until Phase 3.

- [ ] **Step 2: Run the catalog test and verify it fails**

Run:

```bash
pnpm vitest run tests/providers/command-code.test.ts -t "bundles the captured Command Code catalog"
```

Expected: FAIL because the baseline still has 52 records, GPT-5.5 still has a 200K context, and the DeepSeek Pro name is stale.

### Task 2: Expand the bundled baseline

**Files:**

- Modify: `src/providers/command-code/models.ts`
- Test: `tests/providers/command-code.test.ts`

**Interfaces:**

- Consumes: `CommandCodeCatalogRecord`, `modelFromCatalogRecord`, and the Pi 0.84.4 donor catalog.
- Produces: `COMMAND_CODE_CATALOG` and `commandCodeModels` with the exact 62-record offline baseline.

- [ ] **Step 1: Add the ten missing records**

Insert each record into its existing provider group in `COMMAND_CODE_CATALOG`:

```ts
{ id: "deepseek/deepseek-v4-flash-vision-exp", name: "DeepSeek V4 Flash Vision (exp)", contextWindow: 1_000_000 },
{ id: "z-ai/glm-5.3-flash", name: "GLM-5.3 Flash", contextWindow: 1_048_576 },
{ id: "zai-org/GLM-5.3", name: "GLM-5.3", contextWindow: 1_000_000 },
{ id: "minimax/minimax-m3-free", name: "MiniMax M3", contextWindow: 1_000_000 },
{ id: "minimax/minimax-m2.7-free", name: "MiniMax M2.7", contextWindow: 197_000 },
{ id: "Qwen/Qwen3.8-27B", name: "Qwen 3.8 27B", contextWindow: 262_144 },
{ id: "Qwen/Qwen3.8-Flash", name: "Qwen 3.8 Flash", contextWindow: 1_000_000 },
{ id: "tencent/hy4-preview", name: "Tencent Hy4 Preview", contextWindow: 1_048_576 },
{ id: "google/gemini-3.7-flash", name: "Gemini 3.7 Flash", contextWindow: 1_048_576 },
{ id: "xai/grok-4.6", name: "Grok 4.6", contextWindow: 500_000 },
```

- [ ] **Step 2: Correct the two existing records**

Replace the GPT-5.5 record with:

```ts
{ id: "gpt-5.5", name: "GPT-5.5", contextWindow: 400_000 },
```

Replace the DeepSeek Pro record with:

```ts
{ id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro (latest)", contextWindow: 1_000_000 },
```

Do not change any unrelated baseline record.

- [ ] **Step 3: Run the focused catalog and donor tests**

Run:

```bash
pnpm vitest run tests/providers/command-code.test.ts -t "bundles|uses Pi metadata for current live vision models"
```

Expected: both tests pass; the catalog contains 62 unique IDs and the current vision models retain their Phase 1 donor metadata.

- [ ] **Step 4: Run the complete Command Code test file**

Run:

```bash
pnpm vitest run tests/providers/command-code.test.ts
```

Expected: all tests pass. Any existing price assertions remain unchanged and no new final-price invariant exists yet.

- [ ] **Step 5: Commit the atomic phase**

```bash
git add src/providers/command-code/models.ts tests/providers/command-code.test.ts
git commit -m "fix: sync Command Code catalog snapshot"
```

## Phase 2 Acceptance Criteria

- `COMMAND_CODE_CATALOG` and `commandCodeModels` each contain exactly 62 records with 62 unique IDs.
- All ten captured IDs are present offline; GPT-5.5 has a 400K context and DeepSeek Pro uses the live display name.
- Intentional duplicate MiniMax paid/free display names are accepted without weakening ID uniqueness.
- Donor metadata, transport, refresh, persistence, registration, and existing pricing behavior remain intact.
- The complete Command Code test file passes.
