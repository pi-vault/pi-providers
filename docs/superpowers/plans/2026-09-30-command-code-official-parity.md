# Command Code Official Provider Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the useful compatibility behavior from Command Code's official Pi extension without removing this package's bundled catalog, pricing, strict validation, or offline cache.

**Architecture:** Extend the existing Command Code catalog record as the single handoff between API parsing and Pi model construction. Live metadata overrides local estimates; Pi donor metadata and the bundled catalog remain fallbacks. Add catalog-source provenance to the existing cache wrapper so `CMD_MODELS_URL` changes take effect immediately without weakening normal four-hour caching.

**Tech Stack:** TypeScript 7, `@earendil-works/pi-ai` provider APIs, Vitest 5, Biome, pnpm.

**Spec:** Approved in-chat design from 2026-09-30 (bounded change; no separate spec file).

## Global Constraints

- Preserve provider ID `command-code` and the existing Anthropic Messages, OpenAI Chat Completions, and OpenAI Responses route selection.
- Preserve the 86-model snapshot, dated static pricing, strict catalog validation, four-hour refresh interval, offline restoration, ZDR behavior, and authoritative live-ID filtering.
- Preserve `maxTokens = Math.min(max_output_tokens ?? 32_768, contextWindow)` and the existing legacy-cache migration.
- Live `pricing`, `modalities`, and `reasoning` values override local metadata when present; missing fields continue through existing fallbacks.
- `CMD_API_KEY` has precedence over the new `COMMAND_CODE_API_KEY` alias.
- `CMD_MODELS_URL` changes only the catalog endpoint, never inference base URLs.
- Require Pi 0.86 or newer in user-facing documentation.
- Add no dependencies, live-network tests, provider commands, or unrelated refactors.

## Review Focus

- Explicit `false` reasoning and zero prices must override truthy donor/static values; Task 1 pins both cases.
- Malformed nested `pricing`, `modalities`, or `reasoning` data must reject the refresh and retain the cached catalog; Task 1 extends the invalid-catalog table.
- A `modalities` object without `input` must behave as absent metadata, not force text-only mode; Task 1 covers donor fallback.
- A fresh cache from one models URL must not suppress a configured URL change; Task 2 covers cache-source mismatch.
- A failed refresh against a new URL must retain the old source marker so the next refresh retries the new URL; Task 2 covers failure provenance.

---

### Task 1: Catalog Capabilities and Adaptive Thinking

**Files:**

- Modify: `src/providers/command-code/models.ts:13-132`
- Modify: `src/providers/command-code.ts:52-123`
- Test: `tests/providers/command-code.test.ts:100-218,513-572,654-847`

**Interfaces:**

- Consumes: existing `modelFromCatalogRecord(record: CommandCodeCatalogRecord): CommandCodeModel` and the private `parseCommandCodeModels(value: unknown)` refresh path.
- Produces: `CommandCodeCatalogRecord` fields `reasoning?: boolean`, `input?: ("text" | "image")[]`, and `cost?: ModelCost`; later tasks continue using the same converter and provider factory.

- [ ] **Step 1: Write failing conversion tests for metadata precedence and official fallbacks**

Add tests named:

- `prefers Command Code metadata over donor and bundled metadata`
- `uses official capability defaults when no Pi donor exists`
- `uses donor metadata when live capability metadata is absent`
- `forces adaptive thinking for future Claude families without a donor`

Pin these assertions:

```ts
expect(
  modelFromCatalogRecord({
    id: "claude-sonnet-5",
    name: "Command Claude",
    contextWindow: 1_000_000,
    supportedEndpoints: ["/messages"],
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }),
).toMatchObject({
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
});

expect(
  modelFromCatalogRecord({
    id: "gpt-future",
    name: "GPT Future",
    contextWindow: 100_000,
    supportedEndpoints: ["/responses"],
  }),
).toMatchObject({ reasoning: true, input: ["text", "image"] });

expect(
  modelFromCatalogRecord({
    id: "vendor/future",
    name: "Vendor Future",
    contextWindow: 100_000,
    supportedEndpoints: ["/chat/completions"],
  }),
).toMatchObject({ reasoning: true, input: ["text"] });

expect(
  modelFromCatalogRecord({
    id: "claude-mythos-5",
    name: "Claude Mythos 5",
    contextWindow: 1_000_000,
    supportedEndpoints: ["/messages"],
  }),
).toMatchObject({ compat: { forceAdaptiveThinking: true } });
```

Keep the existing `claude-sonnet-5` donor assertion to prove absent live metadata still supplies image input, thinking levels, and static price.

- [ ] **Step 2: Run the conversion tests to verify RED**

Run: `pnpm exec vitest run tests/providers/command-code.test.ts -t "catalog conversion"`

Expected: FAIL because `CommandCodeCatalogRecord` does not expose the new fields, explicit metadata is ignored, unknown reasoning is `false`, and adaptive thinking depends only on a donor.

- [ ] **Step 3: Extend `CommandCodeCatalogRecord` and model conversion**

In `src/providers/command-code/models.ts`:

- Add `reasoning?: boolean`, `input?: ("text" | "image")[]`, and `cost?: ModelCost`.
- Add an official vision-family match for IDs beginning `claude-`, `gpt-`, or `google/`.
- Add the official adaptive-thinking match covering Opus 4.6/4.7/4.8/5, Sonnet 4.6/5, Fable 5, and Mythos 5.
- Resolve fields with these exact precedences:
  - `reasoning`: record value, donor value, then `true`.
  - `input`: record value, cloned donor input, family `['text', 'image']`, then `['text']`.
  - `cost`: record value, `COMMAND_COSTS[id]`, then `ZERO_COST`.
- For Anthropic models, set `forceAdaptiveThinking` when either the donor requests it or the model ID matches the official adaptive family expression. Keep donor `thinkingLevelMap` unchanged.
- Do not change route selection, base URLs, OpenAI compatibility flags, output-token handling, or snapshot contents.

- [ ] **Step 4: Run the conversion tests to verify GREEN**

Run: `pnpm exec vitest run tests/providers/command-code.test.ts -t "catalog conversion"`

Expected: PASS.

- [ ] **Step 5: Write failing live-catalog tests for optional metadata parsing**

Add `parses and persists optional Command Code metadata` using a forced refresh whose record includes:

```ts
pricing: { input: 0, output: 9, cache_read: 0.25 },
modalities: { input: ["text", "image"] },
reasoning: false,
```

Assert the stored/exposed model has:

```ts
{
  reasoning: false,
  input: ["text", "image"],
  cost: { input: 0, output: 9, cacheRead: 0.25, cacheWrite: 0 },
}
```

Add `treats modalities without input as absent metadata` with `modalities: {}` on `claude-sonnet-5`; assert donor-backed `input: ["text", "image"]` remains.

Extend `invalidCases` with exact cases for:

- `pricing: []`
- `pricing: { input: -1 }`
- `pricing: { output: "9" }`
- `modalities: []`
- `modalities: { input: ["text", 1] }`
- `reasoning: "true"`

Reuse the existing assertion that each invalid refresh reports an error and leaves the cached model untouched.

- [ ] **Step 6: Run the focused live-catalog tests to verify RED**

Run: `pnpm exec vitest run tests/providers/command-code.test.ts -t "optional Command Code metadata|modalities without input|retains the cached catalog"`

Expected: FAIL because the parser ignores optional capability fields and accepts their malformed forms.

- [ ] **Step 7: Parse and validate the optional API fields**

In `parseCommandCodeModels(value: unknown)`:

- Read `pricing`, `modalities`, and `reasoning` alongside the existing fields.
- When `pricing` exists, require a non-array object whose `input`, `output`, `cache_read`, and `cache_write` properties are absent or finite non-negative numbers. Map absent components to zero and emit `cost`.
- When `modalities` exists, require a non-array object. If `input` exists, require a string array and emit `input: ['text', 'image']` when it contains `image`, otherwise `input: ['text']`. If `input` is absent, emit no record override.
- When `reasoning` exists, require a boolean and emit it unchanged, including `false`.
- Keep required ID, name, context, endpoint, uniqueness, and usable-chat validation unchanged. Any malformed optional field invalidates the whole refresh so the existing cache-retention path applies.

- [ ] **Step 8: Run the complete Command Code suite**

Run: `pnpm exec vitest run tests/providers/command-code.test.ts`

Expected: PASS with all existing and new tests.

- [ ] **Step 9: Commit Task 1**

```bash
git add src/providers/command-code/models.ts src/providers/command-code.ts tests/providers/command-code.test.ts
git commit -m "feat: honor Command Code model metadata"
```

### Task 2: Authentication Alias and Catalog URL Provenance

**Files:**

- Modify: `src/providers/command-code.ts:19-50,115-202`
- Test: `tests/providers/command-code.test.ts:590-617,654-1123`

**Interfaces:**

- Consumes: `createCommandCodeProvider()`, `RefreshModelsContext`, `COMMAND_CODE_BASE_URL`, and Task 1's unchanged live-model conversion path.
- Produces: support for `COMMAND_CODE_API_KEY`, `CMD_MODELS_URL`, and internal persisted field `commandCodeModelsUrl?: string` on `CommandCodeStoredCatalog`.

- [ ] **Step 1: Write failing authentication precedence tests**

Replace the single-key test with table/individual tests proving:

```ts
// Primary only
expect(resolve({ CMD_API_KEY: "primary" })).resolves.toMatchObject({
  source: "CMD_API_KEY",
});

// Alias only
expect(resolve({ COMMAND_CODE_API_KEY: "alias" })).resolves.toMatchObject({
  auth: { apiKey: "alias" },
  source: "COMMAND_CODE_API_KEY",
});

// Both set
expect(
  resolve({ CMD_API_KEY: "primary", COMMAND_CODE_API_KEY: "alias" }),
).resolves.toMatchObject({
  auth: { apiKey: "primary" },
  source: "CMD_API_KEY",
});
```

Use the existing `apiKey.resolve()` test setup; do not add a custom auth implementation.

- [ ] **Step 2: Run the authentication tests to verify RED**

Run: `pnpm exec vitest run tests/providers/command-code.test.ts -t "API_KEY"`

Expected: FAIL for alias-only resolution.

- [ ] **Step 3: Add the API-key alias**

Change the existing auth declaration to:

```ts
envApiKeyAuth("Command Code API key", ["CMD_API_KEY", "COMMAND_CODE_API_KEY"]);
```

- [ ] **Step 4: Run the authentication tests to verify GREEN**

Run: `pnpm exec vitest run tests/providers/command-code.test.ts -t "API_KEY"`

Expected: PASS.

- [ ] **Step 5: Write failing catalog-URL and cache-provenance tests**

Add tests named:

- `fetches the default Command Code models URL`
- `fetches a configured CMD_MODELS_URL despite a fresh cache from another source`
- `throttles a fresh cache from the configured source`
- `retries a configured source after its previous refresh failed`

Use `https://catalog.example.test/models` as the override. Pin these behaviors:

- With no override, forced refresh calls `https://api.commandcode.ai/provider/v1/models`.
- With a fresh stored entry marked with the default URL and the override set, non-forced refresh still fetches the override and successful persistence includes `commandCodeModelsUrl: "https://catalog.example.test/models"`.
- A second non-forced refresh using that fresh matching source does not fetch.
- When the first override request returns 503, cached models remain, the stored source remains the default URL, and the next non-forced refresh calls the override again despite the failure timestamp.
- A blank/whitespace `CMD_MODELS_URL` uses the default URL.

- [ ] **Step 6: Run the catalog-URL tests to verify RED**

Run: `pnpm exec vitest run tests/providers/command-code.test.ts -t "models URL|configured CMD_MODELS_URL|configured source"`

Expected: FAIL because fetch uses a constant URL and stored catalogs have no source provenance.

- [ ] **Step 7: Implement stable URL selection and source-aware freshness**

In `src/providers/command-code.ts`:

- Define the default models URL once as `${COMMAND_CODE_BASE_URL}/models`.
- At `createCommandCodeProvider()` time, capture `process.env.CMD_MODELS_URL?.trim() || DEFAULT_COMMAND_CODE_MODELS_URL` so each provider instance has one stable catalog URL.
- Change `fetchCommandCodeModels` to accept that URL and wire `fetchModels` through a one-line closure.
- Add `commandCodeModelsUrl?: string` to `CommandCodeStoredCatalog`.
- Treat a missing stored source as the default URL for backward compatibility.
- Require both a fresh `checkedAt` and matching stored/current URLs before skipping a non-forced online refresh.
- Stamp the current URL only on a successful catalog publication.
- During legacy max-token migration and failed-refresh timestamp writes, preserve the stored source; for entries without one, stamp/assume the default URL. Never stamp a failed override as successful.
- Keep offline restore, forced refresh, caller cancellation, authoritative IDs, and ZDR header behavior unchanged.

- [ ] **Step 8: Run the complete Command Code suite**

Run: `pnpm exec vitest run tests/providers/command-code.test.ts`

Expected: PASS with authentication, URL provenance, migration, throttle, failure, cancellation, and existing routing tests.

- [ ] **Step 9: Commit Task 2**

```bash
git add src/providers/command-code.ts tests/providers/command-code.test.ts
git commit -m "feat: align Command Code provider configuration"
```

### Task 3: Documentation and Final Verification

**Files:**

- Modify: `README.md:8-44,71-90,131-137`
- Modify: `CHANGELOG.md:1-20`

**Interfaces:**

- Consumes: the final runtime behavior from Tasks 1 and 2.
- Produces: current installation/configuration guidance and an Unreleased changelog entry; no code interface.

- [ ] **Step 1: Update current README guidance**

Make these exact documentation changes while leaving the historical `What's New In 0.4.0` section unchanged:

- Raise the Command Code requirement from Pi 0.84.4 to Pi 0.86.
- Document `/login command-code`, `CMD_API_KEY`, secondary alias `COMMAND_CODE_API_KEY`, `CMD_ZDR=1`, and catalog-only `CMD_MODELS_URL`.
- Change the provider table/current catalog description to 86 bundled models captured 2026-09-30 with a 32,768 default max output capped by context.
- Update Known Limits to describe Messages/Responses/Chat Completions routing, optional live metadata precedence, source-aware four-hour caching, and dated pricing fallback.
- Remove current-behavior claims that Responses is unsupported or responses-only records are filtered out; retain them only inside the historical 0.4.0 release note.

- [ ] **Step 2: Add an Unreleased changelog section**

Above 0.4.0, record:

- 86-model snapshot and refreshed 2026-09-30 prices.
- 32,768 output fallback and legacy cache migration.
- OpenAI Responses routing.
- Live `pricing`, `modalities`, and `reasoning` support with strict validation.
- `COMMAND_CODE_API_KEY` and `CMD_MODELS_URL` support.
- Official family/adaptive-thinking fallbacks while retaining local cache/snapshot behavior.

- [ ] **Step 3: Run focused and full verification**

Run:

```bash
pnpm exec vitest run tests/providers/command-code.test.ts
pnpm check
pnpm pack:dry-run
git diff --check
```

Expected:

- Command Code tests pass.
- `pnpm check` exits 0; the existing 13 MiniMax non-null assertion warnings may remain, with no new warnings.
- The package dry run succeeds and includes runtime source plus README/changelog package metadata.
- `git diff --check` prints no errors.

- [ ] **Step 4: Review the final diff for scope**

Confirm only the Command Code model/provider code, focused tests, README, changelog, and this plan changed. Confirm no dependency, snapshot-ID, price, provider-ID, TypeSafe tool, MiniMax, or StepFun changes slipped in.

- [ ] **Step 5: Commit Task 3**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: document Command Code provider parity"
```
