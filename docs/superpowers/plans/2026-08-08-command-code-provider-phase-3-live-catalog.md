# Command Code Provider — Phase 3 Live Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Parent plan:** [2026-08-08-command-code-provider.md](./2026-08-08-command-code-provider.md)

**Previous phases:** [Phase 1 static provider](./2026-08-08-command-code-provider-phase-1-static-provider.md) and [Phase 2 pricing enrichment](./2026-08-08-command-code-provider-phase-2-metadata-enrichment.md)

**Goal:** Add validated live model discovery with Pi-managed persistence, offline restoration, four-hour freshness, and failure retention.

**Architecture:** Reuse Pi 0.84.1’s native createProvider({ fetchModels }) lifecycle. Pi owns restoration, transactional publication, persistence, and provider-error reporting; the extension only fetches and validates the complete live catalog and skips fresh online phases. Persisted catalogs are headerless; CMD_ZDR is applied to models at runtime so a cache cannot preserve an obsolete privacy setting.

**Tech Stack:** TypeScript, native fetch, @earendil-works/pi-ai 0.84.1, Vitest, Biome, pnpm.

**Reference contracts:** Pi’s createProvider and refresh lifecycle (../../../../pi-packages/pi/packages/ai/src/models.ts), Pi’s custom-provider guide (../../../../pi-packages/pi/packages/coding-agent/docs/custom-provider.md), and Command Code’s [Provider API](https://commandcode.ai/docs/provider). Command documents GET https://api.commandcode.ai/provider/v1/models returning an OpenAI-style list and documents x-cmd-zdr: 1 as the ZDR request header.

---

## Files and responsibilities

- Modify src/providers/command-code.ts: endpoint, response validation, timeout-bound fetch, native provider wiring, freshness wrapper, and runtime-only ZDR headers.
- Modify tests/providers/command-code.test.ts: fetch validation, Pi lifecycle, retention, cancellation, freshness, live-overlay removal, and ZDR-cache tests.
- Modify README.md: bundled baseline, live overlay, cache/freshness, offline behavior, configured-key requirement, and failure retention.
- Modify CHANGELOG.md: add the live-catalog feature under Unreleased.
- Modify this phase plan only to keep the checked-in implementation instructions aligned; do not change the parent plan.

The public factory remains createCommandCodeProvider(): Provider<"anthropic-messages" | "openai-completions">; no new exported API is required.

### Task 1: Add failing lifecycle and validation tests

**Files:**

- Test: tests/providers/command-code.test.ts

- [ ] **Step 1: Add reusable test setup for Pi models refresh.**

Import createModels, InMemoryCredentialStore, and InMemoryModelsStore from @earendil-works/pi-ai, and import afterEach, beforeEach, and vi from Vitest. Store the Command credential through InMemoryCredentialStore.modify("command-code", async () => ({ type: "api_key", key: "test-key" })) so Pi performs the network phase. Use a cached live-only model with provider: "command-code", api: "openai-completions", Command’s base URL, text input, zero cost, positive context window, and maxTokens below that context window. Isolate CMD_ZDR with vi.stubEnv and vi.unstubAllEnvs.

Define this response helper in the test file:

```
function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status });
}

const validPayload = {
  object: "list",
  data: [{ id: "new-model", name: "New Model", context_length: 32_000 }],
};
```

- [ ] **Step 2: Add the valid refresh test.**

Stub globalThis.fetch with vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(validPayload)), create a provider and Models collection with the credential and store, then call models.refresh({ providers: ["command-code"], force: true }). Assert errors.size === 0, the live model has ID new-model, name New Model, provider command-code, context window 32_000, and api === "openai-completions"; assert the store entry contains the model and a numeric checkedAt.

- [ ] **Step 3: Add table-driven invalid-response retention tests.**

For each payload below, seed the store with the cached live-only model and run a forced refresh. Assert result.errors.get("command-code") is an Error, the cached model remains available, and the stored cached model remains unchanged:

```
const invalidCases: Array<[string, unknown, number?]> = [
  ["empty list", { object: "list", data: [] }],
  ["duplicate IDs", { object: "list", data: [
    { id: "same", name: "One", context_length: 1000 },
    { id: "same", name: "Two", context_length: 1000 },
  ] }],
  ["blank ID", { object: "list", data: [{ id: "   ", name: "Name", context_length: 1000 }] }],
  ["blank name", { object: "list", data: [{ id: "id", name: "\t", context_length: 1000 }] }],
  ["zero context", { object: "list", data: [{ id: "id", name: "Name", context_length: 0 }] }],
  ["negative context", { object: "list", data: [{ id: "id", name: "Name", context_length: -1 }] }],
  ["fractional context", { object: "list", data: [{ id: "id", name: "Name", context_length: 1.5 }] }],
  ["wrong object", { object: "models", data: [{ id: "id", name: "Name", context_length: 1000 }] }],
  ["non-2xx", { error: "rate limited" }, 429],
];
```

Add a separate malformed-JSON case whose mocked Response body is "{" and whose status is 200.

- [ ] **Step 4: Add independent freshness tests.**

Cover all five branches with separate tests:

1. allowNetwork: false restores the cached model and does not call fetch.
2. A checkedAt of Date.now() skips a non-forced online fetch and leaves checkedAt byte-for-byte unchanged.
3. A checkedAt of 0 performs a non-forced fetch and stores the new catalog.
4. A fresh checkedAt plus force: true performs a fetch and stores the new catalog.
5. A failed stale check retains the cached catalog, advances checkedAt, and suppresses another non-forced request within four hours.

- [ ] **Step 5: Add timeout and caller-cancellation tests.**

For timeout, replace AbortSignal.timeout with a controllable signal using vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeoutController.signal). Mock fetch to reject when its supplied signal aborts, abort the timeout controller, and assert the refresh reports a provider error while the cached model remains available. Do not use fake timers for Node’s native AbortSignal.timeout.

For caller cancellation, mock a fetch that remains pending until its signal aborts, call models.refresh({ providers: ["command-code"], signal: callerController.signal }), abort the caller controller, and assert { aborted: true, errors: Map(0) } with the cached model still available.

- [ ] **Step 6: Add overlay-removal and ZDR persistence tests.**

Return a first live response containing new-model, then a forced second response containing only another valid model. Assert new-model disappears while a bundled model remains available, proving live-only removal without deleting the permanent baseline.

For ZDR, create a provider with CMD_ZDR=1, refresh a live catalog, assert the stored live model has no headers property while models.getModel("command-code", "new-model")?.headers contains { "x-cmd-zdr": "1" }. Create a second provider after clearing CMD_ZDR, restore from the same store with allowNetwork: false, and assert the restored model has no ZDR header.

- [ ] **Step 7: Run the new tests and confirm they fail.**

Run:

```bash
pnpm vitest run tests/providers/command-code.test.ts
```

Expected: the new refresh tests fail because Phase 2 has no fetchModels implementation.

### Task 2: Implement validated fetching

**Files:**

- Modify: src/providers/command-code.ts

- [ ] **Step 1: Add the endpoint, interval, and private fetcher types.**

Add the refresh interval below the existing imports:

```ts
const CATALOG_REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000;
```

Import type RefreshModelsContext and modelFromCatalogRecord from the existing modules. Keep the parser private; tests exercise it through the provider lifecycle.

- [ ] **Step 2: Implement strict parsing without a dependency.**

Add a private parseCommandCodeModels(value: unknown) that:

1. Requires a non-null object with object === "list" and a non-empty data array.
2. Requires every entry to be a non-null object whose id and name are strings with non-empty .trim() values and whose context_length is a positive integer.
3. Rejects duplicate IDs using a Set.
4. Converts each record to { id, name, contextWindow: context_length } and maps it through modelFromCatalogRecord only after all entries validate.

Throw Error messages that identify the invalid Command Code catalog condition. Never return a partially converted list.

- [ ] **Step 3: Implement the timeout-bound fetcher.**

Add:

```ts
async function fetchCommandCodeModels(context: RefreshModelsContext) {
  const signal = AbortSignal.any([context.signal, AbortSignal.timeout(10_000)]);
  const response = await fetch(`${COMMAND_CODE_BASE_URL}/models`, { signal });
  if (!response.ok) {
    throw new Error(
      `Command Code model catalog request failed: ${response.status}`,
    );
  }
  const payload: unknown = await response.json();
  return parseCommandCodeModels(payload);
}
```

Do not add authentication headers to this GET; Command documents the models route as public. Pi still performs the network refresh only when its provider credential resolution allows the network phase.

- [ ] **Step 4: Run the focused tests.**

Run pnpm vitest run tests/providers/command-code.test.ts. Expected: validation and timeout tests pass once provider wiring is complete; lifecycle tests may still fail until Task 3.

### Task 3: Wire Pi persistence, freshness, and runtime ZDR

**Files:**

- Modify: src/providers/command-code.ts

- [ ] **Step 1: Keep the provider’s baseline models headerless.**

Change createProvider construction to pass models: commandCodeModels and fetchModels: fetchCommandCodeModels. Do not add headers to static or fetched models. This ensures Pi’s persisted ModelsStoreEntry.models contains no environment-derived privacy setting.

- [ ] **Step 2: Apply ZDR only when models are read.**

After createProvider returns, capture its generated getter and replace it with a getter that maps every returned model to { ...model, headers } only when CMD_ZDR === "1" at provider creation; otherwise return the generated models unchanged:

```ts
const generatedGetModels = provider.getModels;
provider.getModels = () =>
  headers
    ? generatedGetModels().map((model) => ({ ...model, headers }))
    : generatedGetModels();
```

The generated refresh closure must continue to see its own internal headerless baseline and dynamic state.

- [ ] **Step 3: Wrap native refresh with the four-hour policy.**

Capture provider.refreshModels, then assign:

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
  try {
    await generatedRefresh?.(context);
  } catch (error) {
    if (context.allowNetwork && !context.signal.aborted) {
      await context.publish({
        persist: {
          ...(context.stored ?? { models: [] }),
          checkedAt: Date.now(),
        },
      });
    }
    throw error;
  }
};
```

Offline phases always delegate, allowing Pi to restore stored overlays. Fresh online phases return before publication, so checkedAt is not rewritten. Stale and forced phases delegate. Non-cancellation failures retain the stored overlay, record the check time to preserve the four-hour request limit, and still reject into Pi’s errors map.

- [ ] **Step 4: Run the complete provider test file.**

Run pnpm vitest run tests/providers/command-code.test.ts. Expected: valid conversion, all invalid responses, offline restore, freshness, timeout, cancellation, removal, persistence, and ZDR tests pass.

- [ ] **Step 5: Commit the provider implementation.**

Run:

```bash
git add src/providers/command-code.ts tests/providers/command-code.test.ts
git commit -m "feat: add Command Code live model catalog"
```

### Task 4: Document behavior and run release verification

**Files:**

- Modify: README.md
- Modify: CHANGELOG.md
- Modify: docs/superpowers/plans/2026-08-08-command-code-provider-phase-3-live-catalog.md

- [ ] **Step 1: Document the runtime catalog contract.**

In the existing Command Code section of README.md, state that the 52-model snapshot is always available, successful live responses add or replace overlay models, live-only removals are reflected, the last successful overlay is restored offline, online checks are limited to once per four hours unless forced, and failed refreshes retain the previous catalog. State that network refresh requires CMD_API_KEY, while first-run listing may show the bundled baseline before refresh completes. State that CMD_ZDR=1 is applied at request time and is not persisted in the model cache.

- [ ] **Step 2: Update the Unreleased changelog entry.**

Add live Command Code model discovery, Pi-managed persistence, four-hour freshness, offline restoration, validation, and failure retention. Do not alter released entries.

- [ ] **Step 3: Run focused and full checks under the supported runtime.**

Run:

```bash
pnpm vitest run tests/providers/command-code.test.ts tests/index.test.ts
env npm_config_cache=/private/tmp/pi-providers-phase3-npm-cache mise x node@24.15.0 -- pnpm check
```

Expected: focused tests pass; pnpm check exits 0. Existing Biome warning diagnostics in unrelated files may remain, but they must not become errors.

- [ ] **Step 4: Inspect the final diff and plan boundaries.**

Run:

```bash
git diff origin/master...HEAD --check
git status --short
git diff --stat
```

Expected: only the provider, its tests, README, changelog, and this phase plan are changed; the parent plan is unchanged; no new dependency, lockfile, startup hook, or direct model-store write appears.

- [ ] **Step 5: Perform the optional authenticated smoke test.**

With CMD_API_KEY configured, refresh the catalog and stream one Claude model and one non-Claude model. Repeat with CMD_ZDR=1; accept either successful streaming or Command Code’s documented 422 cmd_zdr_no_providers for a model without a ZDR-capable upstream.

## Phase 3 acceptance criteria

- Offline refresh restores the last successful live overlay.
- Fresh non-forced refreshes issue no request and do not rewrite checkedAt.
- Failed non-cancelled checks retain the prior overlay and suppress non-forced retries for four hours.
- Stale and forced refreshes validate, publish, and persist complete live overlays.
- Invalid HTTP, JSON, schema, timeout, and cancellation outcomes never remove a valid prior catalog.
- Live-only models removed by a later successful response disappear; bundled baseline models remain available.
- Persisted models contain no ZDR header; the current provider setting controls runtime requests.
- pnpm check passes under Node 24.15.0 and the parent plan remains unchanged.
