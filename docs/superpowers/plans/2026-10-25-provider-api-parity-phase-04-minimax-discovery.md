# Phase 4 — Authenticated MiniMax availability discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add authenticated, region-scoped availability refresh to the working phase-3 MiniMax providers while preserving offline use and reasoning/tool behavior.

**Architecture:** Keep both existing `registerProvider(id, config)` registrations and their custom stream handlers. Add a stateless refresh callback that rebuilds cached availability from current curated metadata, persists successful discoveries through Pi, and returns definitions for Pi's extension composer to install.

**Tech Stack:** TypeScript ESM, installed Pi AI/coding-agent `0.87.1` (development ranges `^0.87.1`), Vitest, native fetch/AbortSignal, pnpm, Biome. No new dependency.

**Spec:** [Provider API Parity Specification](../specs/2026-10-25-provider-api-parity-design.md), Section 4 and Global constraints.

**Parent:** [Provider API Parity Implementation Plan](2026-10-25-provider-api-parity.md). This revision supersedes the original phase-04 extract; leave the frozen parent and approved spec unchanged.

## Global Constraints

- Preserve provider IDs `minimax-openai`, `minimax-openai-cn`, and `command-code`, and tool name `typesafe_decide`.
- Preserve existing credential names, precedence, and login behavior.
- Keep MiniMax on OpenAI Chat Completions and preserve the custom stream-hardening pipeline.
- Keep the current dependencies, Node requirement `>=24.15.0`, and Pi development baseline `^0.87.1`.
- Leave StepFun behavior and registrations unchanged.
- Use mocked HTTP and frozen fixtures in automated tests; credentials and paid inference are not required for acceptance.
- Update README and an Unreleased changelog entry within each behavior phase; preserve historical release entries.
- Release numbering, publishing, and dependency upgrades are outside this work.

## Readiness review — 2026-10-25

**Original verdict: revise before implementation.** Phase 3 is merged at HEAD `0022b5e`; `src/providers/minimax-openai/models.ts` already exports `MINIMAX_MODELS`, with Flash first and M3 second. Both registrations clone these definitions and retain the hardened stream pipeline. Metadata extraction and earlier-phase work are complete.

Verified baseline: Node `v24.21.0`, pnpm `12.9.1`, both installed Pi packages `0.87.1`; `pnpm check` passed 12 files / 269 tests with 13 existing Biome warnings; `pnpm pack:dry-run` passed. A read-only public `ModelRuntime` check registered both current variants and restored their two custom-API models offline without errors.

Original readiness gaps:

1. Earlier-phase architecture/review text remained, and the host test harness was unnamed.
2. The supplied Pi checkout at `d5b3de22d` uses package version `1.4.0`; it is a reference, not this repo's baseline. Its `RefreshModelsContext.baseUrl` and model-type additions are absent from installed `0.87.1`.
3. Pi's extension composer installs the returned definitions through a second generation-checked publication. Persistence acceptance alone does not install an extension catalog; callback-only tests cannot prove the integration.
4. Cache identity, empty-list handling, invalid freshness values, and publication cancellation needed explicit decisions. The contract and tests below settle these within the approved scope.

**Revised verdict: ready to implement against Pi 0.87.1.** An independent builder check found no remaining blocking ambiguity after the cancellation guarantees were made explicit. A public-runtime probe confirmed the pre-aborted refresh recomposition limitation documented below. Implementation remains unstarted; all task steps are unchecked.

## Evidence and applicability

Checked the requested references on 2026-10-25:

| Source                                                                                                                                     | Application to this phase                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/Users/lanh/Developer/pi-packages/pi`                                                                                                     | Read `packages/ai/src/models.ts`, `models-store.ts`, `packages/coding-agent/src/core/provider-composer.ts`, and `test/model-runtime-modify-models-compat.test.ts`. Confirm signatures against installed `node_modules/@earendil-works/*/dist` before implementation. |
| [MiniMax List Models](https://platform.minimax.io/docs/api-reference/models/openai/list-models)                                            | Authenticated `GET https://api.minimax.io/v1/models`; `object: "list"` and `data` records with IDs. Older IDs in examples do not define our supported model set.                                                                                                     |
| [MiniMax guides](https://platform.minimax.io/docs/guides/) and [API overview](https://platform.minimax.io/docs/api-reference/api-overview) | The guide redirects to a broad model page still mentioning older IDs; the overview names M3.1 Flash/M3. Preserve phase-3 metadata and intersect availability with it. China `/v1/models` parity remains an unverified assumption.                                    |
| [Command Code Provider API](https://commandcode.ai/docs/provider) and [GOAT](https://commandcode.ai/docs/plans/goat)                       | Gateway discovery and GOAT API access remain separate from direct MiniMax. Preserve existing routing, credentials, subscription policy, and ZDR behavior. Command Code's failure timestamp/empty-list handling is not a template for this callback.                  |
| [TypeSafe quick start](https://docs.typesafe.ai/introduction/quickstart)                                                                   | Jev uses a separate System One endpoint and typed questions. Phase 1 is merged; no TypeSafe changes belong here.                                                                                                                                                     |

No authenticated MiniMax endpoint or paid inference was exercised during review. Mocked contracts are the implementation acceptance gate; live regional checks remain optional.

## Review Focus

1. Incompatible cached identities must restore baseline; compatible records must acquire current metadata. Task 4.1 covers both.
2. Successful empty/all-unsupported availability must remain empty after offline restart. Tasks 4.2 and 4.3 cover callback and host behavior.
3. Only compatible caches with valid successful timestamps may throttle refresh; failures remain retryable. Tasks 4.1 and 4.2 pin those boundaries.
4. Cancellation, rejected/failed persistence, and superseded requests must not install candidates. Tasks 4.2 and 4.3 exercise both publication stages.
5. Refreshed regional models must retain custom API IDs and the hardened inference path. Task 4.3 checks dispatch and reruns real-driver wire replay.

## Callback contract and implementation choices

Export only this factory from `src/providers/minimax-openai/catalog.ts`:

```ts
createMiniMaxModelRefresh(
  providerId: string,
  baseUrl: string,
): NonNullable<ProviderConfig["refreshModels"]>
```

Use type imports `ProviderConfig` / `ProviderModelConfig` from `@earendil-works/pi-coding-agent` and `RefreshModelsContext` / `Api` / `Model` from `@earendil-works/pi-ai`. Reuse `MINIMAX_MODELS` from `./models.ts`. The callback returns `Promise<ProviderModelConfig[]>`; helpers and constants stay private. No provider-private mutable catalog, background timer, new configuration, or file store.

### Restore and freshness

- No stored entry means a deep clone of the curated two-model baseline. A stored `models: []` means authoritative empty availability, scoped by Pi's provider store key; an empty entry has no record identity to inspect.
- For nonempty caches, check every record's `provider`, `baseUrl`, and `api` against `(providerId, baseUrl, providerId)` before selecting IDs. Any incompatible record rejects the whole cache and its freshness, including mixed compatible/incompatible records; use baseline until discovery succeeds.
- For compatible caches, select unique known IDs in curated order and deep-clone current definitions. Unknown/deprecated IDs disappear; a compatible all-unsupported cache restores `[]`. Never reuse cached names, costs, input/context/output metadata, compat, thinking maps, or headers.
- A compatible cache is fresh only when `checkedAt` is finite, `0 <= checkedAt <= Date.now()`, and age is strictly less than `4 * 60 * 60 * 1000`. Missing, NaN, infinite, negative, and future timestamps are stale. These corrupt-cache/clock-skew rules are implementation choices, not an upstream API claim.
- Offline, missing/non-`api_key`/blank-key credentials, and fresh non-forced calls return the restored definitions without HTTP or persistence. `force` bypasses freshness only when online and configured. Use `context.credential.key`; credential precedence belongs to Pi, not this module.

### Fetch and publication

- Check caller cancellation before work. GET exactly `${baseUrl}/models`, with `Authorization: Bearer <host-resolved key>` and `AbortSignal.any([context.signal, AbortSignal.timeout(10_000)])`. Keep the combined signal through JSON parsing, and check it before and after persistence.
- Require a non-array object with `object === "list"` and array `data`. Each item must be a non-array object with a string ID containing a non-whitespace character. Duplicate exact IDs reject the whole response, even when unsupported. Ignore other fields. Match exact IDs; do not trim them into supported IDs.
- Intersect valid IDs with curated definitions in curated order. Empty data and all-unknown/deprecated/non-chat data authoritatively select `[]`.
- Build fresh canonical `Model<Api>` records from selected definitions, adding `provider: providerId`, `baseUrl`, and `api: providerId as Api`. Deep-clone nested metadata; omit credentials, request headers, and upstream metadata. Publish only successful, validated records through `context.publish({ persist: { models, checkedAt: Date.now() } })`.
- After `publish` returns `true`, return the candidate definitions only if the combined signal remains active. On `false`, return the prior restored definitions, including prior `[]`. Pi separately publishes this return value through the extension composer; do not re-register models or implement its state update.
- Non-2xx status, JSON/schema failure, transport failure, timeout, or persistence exception throws a sanitized refresh error without returning a candidate or persisting a failed-check timestamp. Use fixed provider-specific messages, optionally a numeric HTTP status; omit bodies, raw exceptions/causes, and keys. Caller abort remains cancellation and lets the host suppress publication.
- Pi 0.87.1 serializes publications and checks generation/signal before and after storage writes. It cannot roll back a completed store write when cancellation arrives afterward. Rely on signal-aware storage and suppress candidate installation; do not promise transactional rollback or add compensating cache writes.
- `ModelRuntime.refresh` recomposes registrations before restoring the cache. An already-cancelled host refresh can therefore expose baseline models before our callback runs. Pin pre-abort behavior directly at the callback and assert candidate suppression through the host; preserving a prior visible subset across that host-only window would require separate Pi changes outside this phase.

## File map

| File                                                                   | Responsibility                                                                                                                      |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Create `src/providers/minimax-openai/catalog.ts`                       | Restore, freshness, authenticated validation, canonical persistence.                                                                |
| Modify `src/providers/minimax-openai.ts`                               | Attach one callback per region; retain stream closure and cloned baseline definitions.                                              |
| Create `tests/providers/minimax-openai/catalog.test.ts`                | Callback restoration, requests, validation, freshness, errors, cancellation.                                                        |
| Create `tests/providers/minimax-openai/catalog-runtime.test.ts`        | Real public host composition, persistence, restart, generations, and dispatch. Separate from the existing whole-module compat mock. |
| Modify `tests/providers/minimax-openai.test.ts`, `tests/index.test.ts` | Assert distinct callbacks and preserved registration contract.                                                                      |
| Modify `README.md`, `CHANGELOG.md`                                     | Explain discovery and add an Unreleased entry.                                                                                      |

`models.ts`, stream helpers, Command Code, TypeSafe, StepFun, dependencies, lockfile, parent plan, and spec need no edits.

### Task 4.1: Offline restoration and registration

**Interfaces:** Produces the factory above and its `Promise<ProviderModelConfig[]>` return. This task requires no HTTP or persistence; Task 4.2 extends the same callback.

- [ ] **Step 1: Add failing tests.** In `catalog.test.ts`, create typed `RefreshModelsContext` fixtures with an active signal, mocked `publish`, optional stored records, and mocked fetch. Assert baseline/no-cache, compatible subset, compatible empty, compatible all-unsupported, curated ordering/deduplication, and rejection of mismatched provider/base/API or mixed-region caches. Assert old costs/compat/headers are discarded, current Flash thinking controls and M3 tiers return, and mutations cannot affect another returned region or `MINIMAX_MODELS`. Extend registration/index tests to assert distinct function-valued callbacks and unchanged IDs, keys, baseline, order, and stream handlers.
- [ ] **Step 2: Establish failures.** Run `pnpm test -- tests/providers/minimax-openai/catalog.test.ts tests/providers/minimax-openai.test.ts tests/index.test.ts`. Expect missing module/factory or missing callback assertions to fail.
- [ ] **Step 3: Implement restore and registration.** Create `catalog.ts`; add `refreshModels: createMiniMaxModelRefresh(name, baseUrl)` inside `registerMiniMaxVariant`. Implement the restore rules above and return restored definitions for offline/unconfigured calls. Leave each existing stream operation intact.
- [ ] **Step 4: Verify.** Repeat Step 2; expect all passing and no fetch/persist calls for restore-only cases.

### Task 4.2: Authenticated discovery and accepted persistence

**Interfaces:** Consumes Task 4.1's factory. Produces validated definitions through the same callback return and canonical persistence through `context.publish`; constants remain private.

- [ ] **Step 1: Add failing request/freshness tests in `catalog.test.ts`.** Pin both regional URLs, GET, exact bearer header, combined signal, absence of ZDR headers, and independent keys. Offline `force`, absent/non-key/blank credentials produce no request. Freeze `Date.now()` and test `fourHours - 1`, exactly `fourHours`, fresh `force`, invalid timestamps, and incompatible fresh cache. Reverse live IDs to prove curated ordering.
- [ ] **Step 2: Add failing validation/publication tests.** Cover valid empty/all-unsupported data, ignored extra fields, exact untrimmed ID matching, duplicate/blank/non-string IDs, non-object items, wrong/missing envelope fields, non-array data, and malformed JSON. Pin successful persisted records to current metadata and matching provider/base/custom API, with `checkedAt` and no credential/request-header fields. Test `publish === false` returns the prior subset or prior `[]`; throwing persistence must reject without returning the candidate.
- [ ] **Step 3: Add failing errors/cancellation tests.** Parameterize 401/403/429/500, transport/body-parse failures, and persistence errors containing a sentinel key; assert surfaced errors, including causes, disclose no key. Failures publish no replacement or failure timestamp; a subsequent non-forced attempt with the same stale snapshot must fetch and succeed. Cover pre-abort, pending fetch, pending body parse, abort after parsing before persistence, and abort after accepted persistence before return. For timeout, spy on `AbortSignal.timeout`, assert `10_000`, inject a controllable signal, and make mock HTTP/body work honor it. Fake-clock advancement alone does not reliably drive Node's native timeout signal. Timeout rejects with a sanitized error; no aborted candidate is returned. Respect the completed-write limitation above.
- [ ] **Step 4: Establish failures.** Run `pnpm test -- tests/providers/minimax-openai/catalog.test.ts`; expect discovery assertions to fail while restore cases stay green.
- [ ] **Step 5: Implement discovery in `catalog.ts`.** Follow the callback contract. Separate prior restored definitions from candidate definitions and return candidates only after accepted persistence and active-signal checks. Keep failure freshness unchanged; Command Code's catch block that persists a failed-check timestamp is unsuitable here.
- [ ] **Step 6: Verify.** Repeat Step 4; expect all passing. Restore fake clocks, environment stubs, fetch globals, and timeout spies after each test.

### Task 4.3: Real host lifecycle, regression checks, and documentation

**Interfaces:** Consumes the actual registrations/callback. Use installed public `ModelRuntime` from coding-agent and `InMemoryCredentialStore` / `InMemoryModelsStore` from pi-ai, not absolute imports into the external Pi checkout or a replacement composer.

- [ ] **Step 1: Add the runtime harness in `catalog-runtime.test.ts`.** Construct `ModelRuntime.create({ credentials, modelsStore, modelsPath: null, allowModelNetwork: false, refreshOnCreate: false })`. Capture real configurations from `registerMiniMax`, forwarding them to `runtime.registerProvider(id, config)`. Seed fake keys with `credentials.modify(id, async () => ({ type: "api_key", key: "test-key" }))`. Isolate MiniMax environment variables and `PI_OFFLINE`, and stub fetch before host construction. Refresh explicitly with `runtime.refresh({ providers: [id], allowNetwork: ..., force: ... })`. An online host refresh first invokes cache-only restoration: assert final state/HTTP count without assuming one callback or publication per refresh.
- [ ] **Step 2: Test accepted publication and restart.** Assert a one-model success replaces the baseline in `runtime.getModels(id)` and persists canonical records; empty/all-unsupported successes install `[]`. Recreate the host using the same store and offline refresh to prove subset/empty restart, current metadata, no deprecated resurrection, and regional separation. Fresh success suppresses HTTP, forced refresh performs it, and failed online refresh preserves prior models/store with `result.errors.has(id) === true`.
- [ ] **Step 3: Test rejection and concurrency through the host.** Wrap only the captured callback's `context.publish` boundary to return `false` for persistence, then separately throw, letting the real composer handle its own publication. Assert neither the runtime nor store acquires the candidate. Use deferred responses for two forced refreshes: accept the newer result, then resolve the older response even if its fetch mock ignored abort. Assert newer catalog/timestamp win. Cover caller cancellation and a controllable signal-aware store rejecting a cancelled pending write. Callback-array assertions alone are insufficient.
- [ ] **Step 4: Test stream dispatch after refresh.** Spy on the real compat OpenAI driver's `streamSimple`, select a refreshed runtime model, and call the host stream path. Assert it uses the registered regional handler and passes `api: "openai-completions"` to the driver. Existing tests retain hardening assertions; run `wire-replay.test.ts` with the real Pi driver for reasoning/tool serialization. Do not import the whole-module compat mock from `minimax-openai.test.ts` into the runtime harness.
- [ ] **Step 5: Verify integration.** Run `pnpm test -- tests/providers/minimax-openai.test.ts tests/providers/minimax-openai tests/index.test.ts`. Expect all passing, including both new suites and existing replay/hardening tests; resolve integration failures before completion.
- [ ] **Step 6: Update README and Unreleased changelog.** Explain authenticated filtering, initial baseline, authoritative empty results, regional offline restore, four-hour successful freshness, prior catalog retention on failure, and curated updates for new IDs. SDK force refresh is `ModelRuntime.refresh({ providers: [id], allowNetwork: true, force: true })`; describe model-picker/reload behavior only as verified in Pi's existing UI, without inventing commands. State China parity is assumed and failure never crosses regions. Preserve historical entries.
- [ ] **Step 7: Run acceptance checks.** Run `pnpm check`, `pnpm pack:dry-run`, and `git diff --check`. Expect exit 0; pack includes discovery source and excludes tests/fixtures and plans. Report existing warnings separately. Check the diff excludes unrelated providers and dependency changes; state if authenticated regional endpoints were not exercised.
- [ ] **Step 8: Commit the complete behavior phase.**

```sh
git add src/providers/minimax-openai/catalog.ts src/providers/minimax-openai.ts tests/providers/minimax-openai/catalog.test.ts tests/providers/minimax-openai/catalog-runtime.test.ts tests/providers/minimax-openai.test.ts tests/index.test.ts README.md CHANGELOG.md
git commit -m "feat: discover supported MiniMax model availability"
```

**Phase acceptance:** Real host tests prove supported availability replaces baseline through accepted publication, compatible empty/subset availability survives offline restart, failures preserve prior usable state and retry eligibility, regional credentials/caches stay separate, and phase-3 inference remains covered. Live China parity and service availability remain unverified until optional authenticated checks.
