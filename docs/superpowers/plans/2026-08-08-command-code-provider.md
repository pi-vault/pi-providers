# Command Code Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `command-code` Pi provider with mixed OpenAI/Anthropic routing, live model discovery, cached catalogs, known-model metadata, conservative defaults, and optional ZDR headers.

**Architecture:** Register one provider at `https://api.commandcode.ai/provider/v1`. Ship a metadata-backed baseline immediately, then refresh Command Code’s public `/models` catalog through Pi’s `refreshModels` hook; persist the merged Pi model records in Pi’s provider-scoped model store. Claude IDs use `anthropic-messages`; all other IDs use `openai-completions`.

**Tech Stack:** TypeScript, `@earendil-works/pi-coding-agent` provider registration and `RefreshModelsContext.store`, `@earendil-works/pi-ai` model/compat types, native `fetch`, Vitest, Biome, pnpm.

**Reference contracts:** [Command Code Provider API](https://commandcode.ai/docs/provider), [Command Code pricing and limits](https://commandcode.ai/docs/resources/pricing-limits), and the [models.dev metadata schema](https://github.com/anomalyco/models.dev).

---

### Task 1: Define the Command Code metadata and baseline catalog

**Files:**
- Create: `src/providers/command-code/models.ts`
- Test: `tests/providers/command-code.test.ts`

- [ ] **Step 1: Write failing metadata tests**

Add tests that import the planned metadata exports and assert:

```ts
expect(commandCodeModels).not.toHaveLength(0);
expect(commandCodeModels.find((model) => model.id === "claude-sonnet-5")).toMatchObject({
  name: "Claude Sonnet 5",
  api: "anthropic-messages",
  input: ["text", "image"],
  contextWindow: 1_000_000,
});
expect(commandCodeModels.find((model) => model.id === "deepseek/deepseek-v4-flash")).toMatchObject({
  api: "openai-completions",
});
```

Populate the expected known IDs from Command Code’s current `/provider/v1/models` response. Include every model in that snapshot, not only the existing MiniMax and StepFun models.

- [ ] **Step 2: Run the focused test to confirm it fails**

Run:

```bash
pnpm vitest run tests/providers/command-code.test.ts
```

Expected: FAIL because `src/providers/command-code/models.ts` does not exist.

- [ ] **Step 3: Add the metadata table and deterministic model conversion**

In `models.ts`:

1. Define a `CommandCodeMetadata` record keyed by exact live model ID.
2. Store verified `name`, API family, `input`, `reasoning`, `thinkingLevelMap`, `cost`, `contextWindow`, `maxTokens`, and compatibility fields for known models.
3. Use Command Code’s permanent rates; use post-promotion standard rates for temporary deals.
4. Use models.dev only as a build-time reference for capabilities and limits; do not add it as a package or runtime request.
5. Export `commandCodeModels`, the bundled baseline used before the first successful network refresh, and a `modelFromCatalogRecord(record)` helper.
6. Make the helper authoritative for live `id`, `name`, and `contextWindow`, then overlay known metadata.
7. For unknown IDs, use exactly these defaults:

```ts
{
  api: id.startsWith("claude-") ? "anthropic-messages" : "openai-completions",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  maxTokens: Math.min(contextWindow, 16_384),
}
```

For unknown OpenAI-compatible models, set `supportsStore`, `supportsDeveloperRole`, `supportsReasoningEffort`, `supportsStrictMode`, and `supportsLongCacheRetention` to `false`, set `supportsUsageInStreaming` to `true`, and set `maxTokensField` to `"max_tokens"`. Do not set a thinking map for unknown models.

- [ ] **Step 4: Run the focused tests**

Run:

```bash
pnpm vitest run tests/providers/command-code.test.ts
```

Expected: PASS for known-model metadata, Claude/non-Claude API selection, and unknown defaults.

- [ ] **Step 5: Commit the metadata slice**

```bash
git add src/providers/command-code/models.ts tests/providers/command-code.test.ts
git commit -m "feat: define Command Code model metadata"
```

### Task 2: Implement live catalog refresh, validation, and cache fallback

**Files:**
- Create: `src/providers/command-code.ts`
- Modify: `tests/providers/command-code.test.ts`

- [ ] **Step 1: Add failing refresh/cache tests**

Extend the provider test with a fake `ProviderModelsStore` and `vi.stubGlobal("fetch", ...)`. Cover these cases:

```ts
it("returns a fresh cached catalog without fetching", async () => {
  const store = fakeStore({ models: cachedModels, checkedAt: Date.now() });
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  const result = await refreshCommandCodeModels({ store, allowNetwork: true });

  expect(result).toEqual(cachedModels);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("refreshes stale cache and persists merged models", async () => {
  const store = fakeStore({ models: cachedModels, checkedAt: 0 });
  vi.stubGlobal("fetch", jsonResponse({
    object: "list",
    data: [{ id: "new-model", name: "New Model", context_length: 32_000 }],
  }));

  const result = await refreshCommandCodeModels({ store, allowNetwork: true });

  expect(result[0]).toMatchObject({ id: "new-model", contextWindow: 32_000, maxTokens: 16_384 });
  expect(store.write).toHaveBeenCalledWith(expect.objectContaining({ checkedAt: expect.any(Number) }));
});

it("keeps stale cache when the remote response is invalid", async () => {
  const store = fakeStore({ models: cachedModels, checkedAt: 0 });
  vi.stubGlobal("fetch", jsonResponse({ object: "list", data: [] }));

  await expect(refreshCommandCodeModels({ store, allowNetwork: true })).resolves.toEqual(cachedModels);
});
```

Also test offline mode, `force: true`, duplicate/invalid records, aborts, HTTP failures, cache read failures, and cache write failures. The tests must assert that invalid remote data never replaces a valid catalog.

- [ ] **Step 2: Run the new tests to verify they fail**

Run:

```bash
pnpm vitest run tests/providers/command-code.test.ts
```

Expected: FAIL because the refresh helper and cache implementation are not defined.

- [ ] **Step 3: Implement the refresh helper**

In `command-code.ts`:

1. Define `COMMAND_CODE_MODELS_URL = "https://api.commandcode.ai/provider/v1/models"` and `CATALOG_TTL_MS = 86_400_000`.
2. Export a testable `refreshCommandCodeModels(context, fetchImpl = globalThis.fetch, modelsUrl = COMMAND_CODE_MODELS_URL)` function; pass only `context` from the registered `refreshModels` callback and use the optional arguments exclusively in tests.
3. Read `context.store`; treat malformed stored entries as unavailable.
4. If `allowNetwork` is false, return valid cached models or the bundled baseline.
5. If a valid cache is younger than 24 hours and `force` is not true, return it without HTTP.
6. Fetch with `context.signal` combined with a ten-second timeout.
7. Require a successful HTTP status and a JSON object whose `data` is a non-empty array. Require unique records with non-empty string `id`/`name` and positive integer `context_length`.
8. Convert every record using `modelFromCatalogRecord`, validate the complete converted list, add `provider: "command-code"` and the provider base URL for the store representation, then write `{ models, checkedAt: Date.now() }` to the provider store. Returning those stored `Model` objects is valid because they contain all `ProviderModelConfig` fields plus Pi runtime fields.
9. On HTTP, parse, validation, timeout, or abort failure, return valid stale cache when available; otherwise throw so Pi retains the bundled baseline.
10. Ignore cache write errors after a successful conversion so a read-only cache cannot disable the provider.

- [ ] **Step 4: Run the refresh/cache tests**

Run:

```bash
pnpm vitest run tests/providers/command-code.test.ts
```

Expected: PASS for every cache, validation, and fallback scenario.

- [ ] **Step 5: Commit the refresh slice**

```bash
git add src/providers/command-code.ts tests/providers/command-code.test.ts
git commit -m "feat: cache Command Code model catalog"
```

### Task 3: Register the provider and support ZDR

**Files:**
- Modify: `src/providers/command-code.ts`
- Modify: `src/index.ts`
- Modify: `tests/index.test.ts`
- Modify: `tests/providers/command-code.test.ts`

- [ ] **Step 1: Add failing registration tests**

Use a mock extension API with both `registerProvider` and `on` spies. Assert that `registerCommandCode(pi)` calls `registerProvider("command-code", config)` with:

```ts
{
  name: "Command Code",
  baseUrl: "https://api.commandcode.ai/provider/v1",
  apiKey: "$CMD_API_KEY",
  api: "openai-completions",
  models: commandCodeModels,
  refreshModels: expect.any(Function),
}
```

Stub `CMD_ZDR=1` and assert `headers` contains `{ "x-cmd-zdr": "1" }`; stub an unset or different value and assert the header is absent. Invoke the registered `session_start` handler and assert it starts `ctx.modelRegistry.refresh()` without blocking provider registration.

Update `tests/index.test.ts` to expect four providers in order: `minimax-openai`, `minimax-openai-cn`, `stepfun-ai`, `command-code`.

- [ ] **Step 2: Run the registration tests to verify they fail**

Run:

```bash
pnpm vitest run tests/index.test.ts tests/providers/command-code.test.ts
```

Expected: FAIL because the extension does not yet register Command Code.

- [ ] **Step 3: Register Command Code and schedule background refresh**

Implement `registerCommandCode(pi)` and call it from `src/index.ts` after the existing providers. Set `headers` only when `process.env.CMD_ZDR === "1"`. Register a `session_start` handler that calls `void ctx.modelRegistry.refresh().catch(() => undefined)` so the bundled/cache baseline remains available while live refresh runs in the background.

- [ ] **Step 4: Run the registration tests**

Run:

```bash
pnpm vitest run tests/index.test.ts tests/providers/command-code.test.ts
```

Expected: PASS with four registered providers and correct conditional ZDR behavior.

- [ ] **Step 5: Commit provider registration**

```bash
git add src/providers/command-code.ts src/index.ts tests/index.test.ts tests/providers/command-code.test.ts
git commit -m "feat: register Command Code provider"
```

### Task 4: Document the provider and package metadata

**Files:**
- Modify: `README.md`
- Modify: `package.json`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update package metadata**

Change the package description to mention Command Code and add `command-code`/`commandcode` keywords without removing existing provider keywords.

- [ ] **Step 2: Document installation and configuration**

Add `CMD_API_KEY` and optional `CMD_ZDR=1` to the Quick Start section. Document provider ID `command-code`, the live catalog endpoint, Claude/non-Claude endpoint routing, cache behavior, unknown-model defaults, and stable local pricing estimates.

- [ ] **Step 3: Add the provider to the model table and changelog**

Describe Command Code as exposing its current catalog through one provider rather than duplicating a volatile 50-model table in README. Add a changelog entry covering the new provider, cached discovery, mixed API routing, and ZDR support.

- [ ] **Step 4: Run documentation/package checks**

Run:

```bash
pnpm format:check
pnpm pack:verify
```

Expected: Biome reports no formatting changes and package verification succeeds.

- [ ] **Step 5: Commit documentation**

```bash
git add README.md package.json CHANGELOG.md
git commit -m "docs: document Command Code provider"
```

### Task 5: Run the complete verification suite

**Files:**
- Modify: none unless a check identifies a defect.

- [ ] **Step 1: Run the focused provider suite**

```bash
pnpm vitest run tests/providers/command-code.test.ts tests/index.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 2: Run the repository checks**

```bash
pnpm check
```

Expected: format check, lint, typecheck, all tests, and package verification pass.

- [ ] **Step 3: Inspect the final diff**

```bash
git diff origin/master...HEAD --check
git status --short
```

Expected: no whitespace errors, only the intended provider, tests, documentation, and plan commits are present, and no generated or temporary files are tracked.

- [ ] **Step 4: Perform an optional live smoke test**

When `CMD_API_KEY` is available, launch Pi with the extension, select one `claude-*` model and one non-Claude model, and confirm both stream successfully. Set `CMD_ZDR=1` for a separate request and confirm the request is accepted or fails with Command Code’s documented `cmd_zdr_no_providers` response for an unsupported model.
