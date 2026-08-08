# Command Code Provider — Phase 2 Metadata Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Parent plan:** [2026-08-08-command-code-provider.md](./2026-08-08-command-code-provider.md)

**Previous phase:** [Phase 1 static provider](./2026-08-08-command-code-provider-phase-1-static-provider.md)

**Goal:** Enrich the static Command Code provider with Pi-derived capabilities, limits, thinking metadata, and stable Command-specific prices without changing transport or discovery.

**Prerequisite:** Phase 1 is complete and its phase gate passes.

**Usable result:** The existing provider remains offline-capable and static, but known models now expose accurate vision/reasoning metadata, output limits, and stable cost estimates. Unmatched models continue using Phase 1 defaults.

**Architecture:** Build a deterministic donor index from Pi’s bundled catalogs. Match Command records by exact ID, then normalized display name, copy only portable traits, preserve Command-authoritative identity/context/routing, and apply explicit permanent price overrides.

**Tech Stack:** TypeScript, `@earendil-works/pi-ai/providers/all`, Vitest, Biome, pnpm.

---

## Files

- Modify `src/providers/command-code/models.ts` to add donor indexing and enrichment.
- Modify `tests/providers/command-code.test.ts` with metadata and fallback tests.
- Modify `README.md` and `CHANGELOG.md` to describe metadata and pricing behavior.

### Task 1: Add failing donor-matching tests

- [ ] **Step 1: Test exact-ID metadata matching**

Add a test that converts `claude-sonnet-5` and asserts Pi-derived image input, reasoning, and a non-zero context-safe output limit while retaining the Command name and context supplied to the conversion function.

- [ ] **Step 2: Test display-name fallback**

Add a test using a Command ID that differs from Pi’s ID but has the same normalized display name. Assert that the donor’s portable traits are copied and the resulting model still has `provider: "command-code"`, Command’s ID, and Command’s context window.

- [ ] **Step 3: Test deterministic duplicate selection**

Create two donor candidates with the same ID and assert the fixed provider order selects the earlier provider. Repeat with equal priority and assert lexical provider-ID ordering.

- [ ] **Step 4: Test compat isolation and unknown fallback**

Assert that donor `baseUrl`, `provider`, `api`, headers, sampling parameters, and gateway-specific compatibility fields are absent from the resulting model. Assert an unmatched record keeps Phase 1 conservative defaults.

- [ ] **Step 5: Run tests and confirm failure**

Run `pnpm vitest run tests/providers/command-code.test.ts`. Expected: the new enrichment assertions fail because Phase 1 currently uses defaults for every model.

### Task 2: Implement the Pi catalog donor index

- [ ] **Step 1: Add the provider priority list**

Define this fixed ordering in `models.ts`:

```ts
const PREFERRED_METADATA_PROVIDERS = [
  "anthropic",
  "openai",
  "google",
  "xai",
  "deepseek",
  "moonshotai",
  "minimax",
  "zai",
  "together",
  "huggingface",
  "openrouter",
  "opencode",
  "vercel-ai-gateway",
];
```

- [ ] **Step 2: Index exact IDs and normalized names**

Import `getBuiltinProviders` and `getBuiltinModels` from `@earendil-works/pi-ai/providers/all`. Build maps from exact model ID and normalized display name to candidate models. Sort candidates by the fixed provider order and then provider ID.

- [ ] **Step 3: Copy only portable traits**

When a donor is found, copy `reasoning`, `input`, `cost`, `maxTokens`, and `thinkingLevelMap`. Keep Command’s `id`, `name`, `contextWindow`, `provider`, `baseUrl`, and API selection. Clamp `maxTokens` to the Command context window.

- [ ] **Step 4: Preserve Phase 1 defaults for misses**

If no donor is found, return the exact Phase 1 defaults: `reasoning: false`, `input: ["text"]`, zero cost, `maxTokens: Math.min(contextWindow, 16_384)`, and conservative OpenAI compatibility.

- [ ] **Step 5: Run enrichment tests**

Run `pnpm vitest run tests/providers/command-code.test.ts`. Expected: PASS for exact matching, name fallback, deterministic selection, compat isolation, and unknown fallback.

### Task 3: Add permanent Command pricing overrides

- [ ] **Step 1: Add failing pricing assertions**

Assert these output costs:

```ts
expect(modelFromCatalogRecord(deepseekPro).cost).toEqual({
  input: 0.435,
  output: 0.87,
  cacheRead: 0.003625,
  cacheWrite: 0,
});
expect(modelFromCatalogRecord(minimaxM3).cost).toEqual({
  input: 0.3,
  output: 1.2,
  cacheRead: 0.06,
  cacheWrite: 0,
});
```

- [ ] **Step 2: Implement the override map**

Apply these permanent rates after donor traits:

```ts
const COMMAND_COST_OVERRIDES = {
  "deepseek/deepseek-v4-pro": { input: 0.435, output: 0.87, cacheRead: 0.003625, cacheWrite: 0 },
  "MiniMaxAI/MiniMax-M3": { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 },
  "xiaomi/mimo-v2.5-pro": { input: 0.435, output: 0.87, cacheRead: 0.0036, cacheWrite: 0 },
  "xiaomi/mimo-v2.5": { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 },
} as const;
```

Do not encode temporary GPT discounts or Laguna’s capacity-limited free price.

- [ ] **Step 3: Run pricing tests**

Run `pnpm vitest run tests/providers/command-code.test.ts`. Expected: PASS with override values taking precedence over donor values.

### Task 4: Document and verify metadata enrichment

- [ ] **Step 1: Update README metadata behavior**

Document that Pi’s catalog supplies stable capabilities and limits, Command’s live record supplies identity/context, and permanent Command discounts are explicitly reflected in local estimates.

- [ ] **Step 2: Update the changelog**

Extend the Unreleased entry with Pi-derived model metadata and stable Command pricing.

- [ ] **Step 3: Run the phase gate**

Run:

```bash
pnpm vitest run tests/providers/command-code.test.ts tests/index.test.ts
pnpm check
```

Expected: all checks pass and Phase 1 transport/ZDR behavior remains unchanged.

- [ ] **Step 4: Commit the metadata phase**

```bash
git add src/providers/command-code/models.ts tests/providers/command-code.test.ts README.md CHANGELOG.md
git commit -m "feat: enrich Command Code model metadata"
```

## Phase 2 acceptance criteria

- Known models expose Pi-derived capabilities without inheriting donor routing or gateway quirks.
- Command’s ID, name, context, endpoint, and API family remain authoritative.
- Permanent Command prices override donor estimates.
- Unknown models remain usable with Phase 1 defaults.
- `pnpm check` passes.

