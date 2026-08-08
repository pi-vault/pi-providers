# Command Code Provider — Phase 3 Live Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Parent plan:** [2026-08-08-command-code-provider.md](./2026-08-08-command-code-provider.md)

**Previous phases:** [Phase 1 static provider](./2026-08-08-command-code-provider-phase-1-static-provider.md) and [Phase 2 pricing enrichment](./2026-08-08-command-code-provider-phase-2-metadata-enrichment.md)

**Goal:** Add validated live model discovery with Pi-managed persistence, restoration, freshness, and failure retention.

**Prerequisite:** Phases 1 and 2 are complete and their phase gates pass.

**Usable result:** The provider starts with the capability- and pricing-enriched bundled catalog, restores the last successful live overlay offline, checks the public catalog at most every four hours, and retains a valid previous catalog through all refresh failures.

**Architecture:** Use `createProvider`’s native `fetchModels` lifecycle so Pi owns the provider-scoped model store and transactional publication. Add only a wrapper that skips fresh online phases; never write the store directly or refresh from `session_start`.

**Tech Stack:** TypeScript, native `fetch`, Pi 0.84 model lifecycle, Vitest, Biome, pnpm.

---

## Files

- Modify `src/providers/command-code.ts` to add fetch, validation, and freshness wrapping.
- Modify `tests/providers/command-code.test.ts` with lifecycle and failure tests.
- Modify `README.md` and `CHANGELOG.md` with live-catalog behavior.

### Task 1: Write live-catalog validation tests

- [ ] **Step 1: Test valid conversion**

Stub `fetch` with a successful response:

```ts
jsonResponse({
  object: "list",
  data: [{
    id: "new-model",
    name: "New Model",
    context_length: 32_000,
  }],
})
```

Assert the returned model has ID `new-model`, name `New Model`, context window `32_000`, provider `command-code`, and the non-Claude API.

- [ ] **Step 2: Test invalid payloads**

Add separate tests for an empty list, duplicate IDs, blank IDs, blank names, zero context length, negative context length, fractional context length, malformed JSON, and non-2xx responses. Each test must assert the refresh reports an error and the previous model remains available.

- [ ] **Step 3: Test timeout and caller cancellation**

Use an unresolved fetch promise and a caller `AbortController`. Assert refresh returns as aborted or reports no provider error for caller cancellation. Use fake timers for the internal 10-second timeout and assert the active catalog remains usable.

- [ ] **Step 4: Run tests and confirm failure**

Run `pnpm vitest run tests/providers/command-code.test.ts`. Expected: the new lifecycle tests fail because Phase 2 has no fetcher or dynamic refresh.

### Task 2: Implement fetching and validation

- [ ] **Step 1: Define the response type and endpoint**

In `src/providers/command-code.ts`, define:

```ts
const COMMAND_CODE_MODELS_URL = `${COMMAND_CODE_BASE_URL}/models`;
const CATALOG_REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000;

interface CommandCodeModelsResponse {
  object: "list";
  data: Array<{ id: string; name: string; context_length: number }>;
}
```

- [ ] **Step 2: Implement strict response validation**

Parse the JSON as unknown, verify `object === "list"`, require a non-empty `data` array, require unique non-empty string IDs and names, and require positive integer `context_length`. Convert each record to the Phase 2 model converter.

- [ ] **Step 3: Implement the timed fetcher**

Use `AbortSignal.any([context.signal, AbortSignal.timeout(10_000)])` and call the endpoint with `fetch`. Throw an informative error for non-2xx responses, malformed JSON, or validation failures. Return the complete converted model list only after all records validate.

- [ ] **Step 4: Run focused validation tests**

Run `pnpm vitest run tests/providers/command-code.test.ts`. Expected: valid responses pass and all invalid responses fail without replacing the active catalog.

### Task 3: Add Pi-native persistence and freshness

- [ ] **Step 1: Add failing cache lifecycle tests**

Using `createModels`, `InMemoryModelsStore`, and configured credentials, add tests for:

```ts
it("restores cached models offline", async () => {
  await modelsStore.write("command-code", { models: [cachedModel], checkedAt: Date.now() });
  const result = await models.refresh({ allowNetwork: false });
  expect(result.errors.size).toBe(0);
  expect(models.getModel("command-code", cachedModel.id)).toBeDefined();
});

it("skips fresh online refresh without rewriting checkedAt", async () => {
  const checkedAt = Date.now();
  await modelsStore.write("command-code", { models: [cachedModel], checkedAt });
  vi.stubGlobal("fetch", vi.fn());
  await models.refresh({ providers: ["command-code"] });
  expect(fetch).not.toHaveBeenCalled();
  expect((await modelsStore.read("command-code"))?.checkedAt).toBe(checkedAt);
});

it("fetches stale and forced catalogs", async () => {
  await modelsStore.write("command-code", { models: [cachedModel], checkedAt: 0 });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(validPayload)));
  await models.refresh({ providers: ["command-code"], force: true });
  expect(models.getModel("command-code", "new-model")).toBeDefined();
  expect((await modelsStore.read("command-code"))?.checkedAt).toEqual(expect.any(Number));
});
```

- [ ] **Step 2: Implement `fetchModels` on the native provider**

Pass `fetchModels: fetchCommandCodeModels` to the existing `createProvider` call. Keep all response conversion in the existing model module so static and live records use identical metadata and pricing rules.

- [ ] **Step 3: Wrap the generated refresh function**

After creating the provider, retain its generated refresh function and replace it with:

```ts
const generatedRefresh = provider.refreshModels;
provider.refreshModels = async (context) => {
  if (
    context.allowNetwork &&
    !context.force &&
    context.stored?.checkedAt !== undefined &&
    Date.now() - context.stored.checkedAt < CATALOG_REFRESH_INTERVAL_MS
  ) {
    return;
  }
  await generatedRefresh?.(context);
};
```

The cache-only phase must always delegate so Pi restores persisted models. A fresh online phase must return without publishing or rewriting `checkedAt`.

- [ ] **Step 4: Verify failure retention**

Assert that a failed stale or forced fetch returns a provider error while `models.getModel("command-code", cachedModel.id)` remains defined. Do not catch the error into a successful stale result; Pi’s provider lifecycle owns retention.

- [ ] **Step 5: Run lifecycle tests**

Run `pnpm vitest run tests/providers/command-code.test.ts`. Expected: PASS for offline restore, fresh skip, stale fetch, forced fetch, persistence, and failure retention.

### Task 4: Finalize documentation and release verification

- [ ] **Step 1: Document live discovery**

Update `README.md` to explain the bundled baseline, persisted overlay, four-hour freshness, offline restoration, and error-retention behavior. State that first-run model listing may use the bundled snapshot until Pi’s normal refresh completes.

- [ ] **Step 2: Update the changelog**

Extend the Unreleased entry with live catalog discovery, Pi-managed cache persistence, and safe fallback behavior.

- [ ] **Step 3: Run focused and full checks**

Run:

```bash
pnpm vitest run tests/providers/command-code.test.ts tests/index.test.ts
pnpm format:check
pnpm lint
pnpm typecheck
pnpm pack:verify
pnpm check
```

Expected: all commands pass.

- [ ] **Step 4: Inspect the final diff**

Run:

```bash
git diff origin/master...HEAD --check
git status --short
```

Expected: only intended provider, tests, package metadata/lockfile, documentation, and phase-plan files are changed. The parent plan must remain unchanged.

- [ ] **Step 5: Perform the optional live smoke test**

With `CMD_API_KEY` configured, select one Claude and one non-Claude model and confirm both stream. Repeat with `CMD_ZDR=1`; accept either success or Command Code’s documented `422 cmd_zdr_no_providers` response for a model without a ZDR-capable upstream.

## Phase 3 acceptance criteria

- Offline startup restores the last successful live catalog.
- Fresh caches do not issue requests or rewrite `checkedAt`.
- Stale and forced refreshes validate, persist, and publish complete model lists.
- HTTP, parsing, validation, timeout, and cancellation failures never remove a valid catalog.
- `pnpm check` passes and the parent plan is unchanged.
