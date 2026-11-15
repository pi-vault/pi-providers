# MiniMax Native Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register `minimax-openai` and `minimax-openai-cn` as native Pi providers so a region without a key is skipped quietly, while a configured region keeps today's discovery behaviour exactly.

**Architecture:** Each region becomes `withMiniMaxCatalog(createProvider({ auth: envApiKeyAuth(...), fetchModels, api }))`. `createProvider` supplies key gating, dispatch, and the network publish. `withMiniMaxCatalog` overrides the model list (curated definitions filtered by an authoritative ID set) and wraps `refreshModels` with MiniMax's restore validation, 4-hour freshness, 10 s timeout, and sanitized errors, the same pattern `command-code.ts` uses.

**Tech Stack:** TypeScript ESM, `@earendil-works/pi-ai` / `@earendil-works/pi-coding-agent` `^1.4.0` (installed 1.4.0; reference checkout `/Users/lanh/Developer/pi-packages/pi` at 1.5.2), Vitest, native `fetch`/`AbortSignal`, pnpm, Biome.

**Spec:** [MiniMax native provider design](../specs/2026-11-15-minimax-native-provider-design.md). Read it before starting.

**References:**
- MiniMax models and limits: <https://platform.minimax.io/docs/guides/> and <https://platform.minimax.io/docs/api-reference/api-overview> (checked 2026-11-15: only `MiniMax-M3.1-Flash` and `MiniMax-M3`, 1,000,000-token context, consistent with `models.ts`; no metadata change).
- Pi SDK: `packages/ai/src/models.ts` (`createProvider`, `ModelsImpl.refresh`, `resolveRefreshCredential`, `publishProviderModels`), `packages/ai/src/auth/helpers.ts` (`envApiKeyAuth`), `packages/coding-agent/src/core/provider-composer.ts` (`composeApiKeyAuth`, the throwing path being escaped), `packages/coding-agent/src/core/model-runtime.ts` (`registerNativeProvider`, `refresh`).

## Global Constraints

- Pi floor stays `>=1.4.0`; no dependency, `engines`, or peer-range change.
- Provider IDs `minimax-openai` / `minimax-openai-cn`, base URLs `https://api.minimax.io/v1` / `https://api.minimaxi.com/v1`, env vars `MINIMAX_API_KEY` / `MINIMAX_CN_API_KEY`, display names `MiniMax (OpenAI)` / `MiniMax CN (OpenAI)`, and model IDs are unchanged.
- Credential precedence: a stored (`/login`) API key first, then the env var. A blank or whitespace-only env var counts as unset.
- Persisted records keep `provider = <id>`, `baseUrl = <regional URL>`, `api = <id>`, no `headers`; entries written by 0.5.0 must restore unchanged.
- Freshness window `4 * 60 * 60 * 1000` ms; discovery timeout `10_000` ms; error messages exactly `MiniMax model discovery failed`, `MiniMax model discovery failed (HTTP <status>)`, `MiniMax model discovery returned an invalid catalog`, `MiniMax model discovery timed out`, `MiniMax model persistence failed`.
- A failed discovery persists nothing (no failed-check `checkedAt`).
- Streams keep the pipeline `normalizeToolResults` → `prepareThinkingReplay` → `openai-completions` driver with `api: "openai-completions"` → `hardenToolCalls` → `cleanStream`.
- Import `createProvider`, `envApiKeyAuth`, and `Provider` from `@earendil-works/pi-ai` (not `/compat`): `tests/providers/minimax-openai.test.ts` mocks `@earendil-works/pi-ai/compat` down to `getApiProvider`.
- Model metadata, StepFun, Command Code, and TypeSafe are untouched. Automated tests use mocked HTTP only.

## Review Focus

1. **Env-only user's default model at startup.** With only `MINIMAX_API_KEY` set and no stored credential, `minimax-openai` models must be in `getAvailableSnapshot()` after `refresh({ allowNetwork: false })`. Native registration no longer gets Pi's "configured from `$ENV`" provisional mark. Test in Task 2.
2. **Whitespace-only env var.** `MINIMAX_CN_API_KEY="  "` must behave as unset: no error, no fetch, region unavailable. Test in Task 2.
3. **Stored key beats env var.** With both a stored credential and the env var, discovery and requests use the stored key. Test in Task 2.
4. **`models.json` overrides still apply** to the native provider's models (for example a `modelOverrides` rename). Test in Task 2.
5. **Non-simple `stream()` path.** Native `stream` must run the same hardening pipeline as `streamSimple`; previously it had no handler at all. Test in Task 1.

---

## Delivery and document rules

This parent is the complete implementation handoff. Keep it unchanged while executing; record progress in the phase copy. The phase file contains the common plan context plus an exact copy of its phase section.

| Order | Phase and usable result | Prerequisite | Phase plan |
| --- | --- | --- | --- |
| 1 | Unconfigured MiniMax regions no longer warn; configured regions keep discovery | Clean tree at `38be0c8` or later | [Native provider](2026-11-15-minimax-native-provider-phase-01-native-provider.md) |

There is one phase because the behaviour change is a single registration switch. Splitting it would ship either a refactor with no visible result or a temporary loss of discovery (an anti-goal).

### File responsibilities

- `src/providers/minimax-openai.ts`: region constants, `createMiniMaxProvider`, stream pipeline wiring, `registerMiniMax`.
- `src/providers/minimax-openai/catalog.ts`: cache restore validation, freshness, `/models` fetch and validation, canonicalisation, `withMiniMaxCatalog`.
- `src/providers/minimax-openai/models.ts`: unchanged curated definitions.
- `tests/providers/minimax-openai/catalog.test.ts`: provider-level catalog behaviour with fake contexts.
- `tests/providers/minimax-openai/catalog-runtime.test.ts`: real `ModelRuntime` behaviour, including the regression.
- `tests/providers/minimax-openai.test.ts`, `tests/providers/minimax-openai/wire-replay.test.ts`, `tests/index.test.ts`: registration shape and stream dispatch.
- `README.md`, `CHANGELOG.md`: user-facing notes.

### Baseline and discipline

Before starting, run `pnpm check`. Baseline at `38be0c8`: 14 files, 331 tests passing. Write failing tests before production edits. After each task, run the focused tests, then `pnpm check`; at the end also `pnpm pack:dry-run` (must list no `docs/superpowers` files).

<!-- phase:01:start -->
## Phase 1 — Native MiniMax providers

**Phase goal:** Replace name-based MiniMax registration with native providers that treat a missing key as "not configured".

**Prerequisites:** Clean tree at `38be0c8` or later.
**Usable result:** Opening `/model` with `MINIMAX_CN_API_KEY` unset no longer reports `Could not refresh minimax-openai-cn`; configured regions discover, cache, and stream as before.
**Spec:** All sections.

### Task 1: Native provider factory with MiniMax catalog semantics

**Files:**
- Modify: `src/providers/minimax-openai/catalog.ts`
- Modify: `src/providers/minimax-openai.ts` (add exports only; `registerMiniMax` unchanged in this task)
- Test: `tests/providers/minimax-openai/catalog.test.ts`, `tests/providers/minimax-openai.test.ts`

**Interfaces:**
- Consumes: `MINIMAX_MODELS` from `models.ts`; existing private helpers in `catalog.ts` (`restoreCatalog`, `isFresh`, `liveModelIds`, `canonicalModel`, `usableApiKey`); pipeline functions `normalizeToolResults`, `prepareThinkingReplay`, `hardenToolCalls`, `cleanStream`; `createProvider`, `envApiKeyAuth`, `Provider`, `RefreshModelsContext`, `Model`, `Api` from `@earendil-works/pi-ai`; `getApiProvider` from `@earendil-works/pi-ai/compat`.
- Produces (in `catalog.ts`):
  - `canonicalMiniMaxModels(providerId: string, baseUrl: string, ids?: ReadonlySet<string>): Model<Api>[]`: deep-cloned curated models in curated order with `provider`, `baseUrl`, `api = providerId`, `headers` removed; filtered to `ids` when given.
  - `fetchMiniMaxModels(context: RefreshModelsContext, providerId: string, baseUrl: string): Promise<Model<Api>[]>`: GET `${baseUrl}/models` with `Authorization: Bearer <context.credential.key>` and `signal: context.signal`; returns `canonicalMiniMaxModels(..., liveIds)`. On a transport or body error it rethrows `context.signal.reason` when `context.signal` is aborted, otherwise the sanitized failure/invalid message. No timeout of its own.
  - `withMiniMaxCatalog(provider: Provider, providerId: string, baseUrl: string): Provider`.
- Produces (in `minimax-openai.ts`):
  - `type MiniMaxRegion = { id: "minimax-openai" | "minimax-openai-cn"; name: string; baseUrl: string; envVar: "MINIMAX_API_KEY" | "MINIMAX_CN_API_KEY"; keyName: string }`
  - `MINIMAX_REGIONS: readonly MiniMaxRegion[]`, global first: `{ id: "minimax-openai", name: "MiniMax (OpenAI)", baseUrl: "https://api.minimax.io/v1", envVar: "MINIMAX_API_KEY", keyName: "MiniMax API key" }`, then `{ id: "minimax-openai-cn", name: "MiniMax CN (OpenAI)", baseUrl: "https://api.minimaxi.com/v1", envVar: "MINIMAX_CN_API_KEY", keyName: "MiniMax CN API key" }`.
  - `createMiniMaxProvider(region: MiniMaxRegion): Provider`: `withMiniMaxCatalog(createProvider({ id, name, baseUrl, auth: { apiKey: envApiKeyAuth(keyName, [envVar]) }, models: canonicalMiniMaxModels(id, baseUrl), fetchModels: (ctx) => fetchMiniMaxModels(ctx, id, baseUrl), api: { stream, streamSimple } }), id, baseUrl)`. Both stream functions run the pipeline through the driver's `stream` / `streamSimple` respectively and throw `openai-completions api provider not registered` when the driver is missing.

`withMiniMaxCatalog` algorithm (the tests don't fully determine this):

```ts
let ids: ReadonlySet<string> | undefined; // undefined = curated baseline
const models = () => canonicalMiniMaxModels(providerId, baseUrl, ids);
// returned provider: { ...provider, getModels: models, getAllModels: models, refreshModels }
async function refreshModels(context) {
  context.signal.throwIfAborted();
  const restored = restoreCatalog(context.stored, providerId, baseUrl);
  const restoredIds = restored.compatible ? new Set(restored.models.map((m) => m.id)) : undefined;
  if (!(await context.publish({ update: () => { ids = restoredIds; } }))) return;
  if (!context.allowNetwork || !usableApiKey(context)) return;
  if (!context.force && restored.compatible && isFresh(restored.checkedAt, Date.now())) return;

  const discovery = AbortSignal.any([context.signal, AbortSignal.timeout(DISCOVERY_TIMEOUT_MS)]);
  const timedOut = () => discovery.aborted && !context.signal.aborted;
  try {
    await provider.refreshModels!({
      ...context, stored: undefined, signal: discovery,
      publish: async (publication) => {
        const published = new Set(publication.persist?.models.map((m) => m.id) ?? []);
        try {
          return await context.publish({ ...publication, update: () => {
            if (discovery.aborted) return; // persisted after the deadline: keep prior state
            publication.update?.(); ids = published;
          } });
        } catch { throw new Error(PERSISTENCE_FAILED_MESSAGE); }
      },
    });
  } catch (error) {
    if (timedOut()) throw new Error(DISCOVERY_TIMEOUT_MESSAGE);
    throw error;
  }
  if (timedOut()) throw new Error(DISCOVERY_TIMEOUT_MESSAGE);
}
```

- [ ] **Step 1: Write failing provider-level catalog tests.** In `catalog.test.ts`, add a describe block `MiniMax native catalog` built on `createMiniMaxProvider(region)` with a `fakeContext` whose default `publish` is `vi.fn(async (p) => { p.update?.(); return true; })`. For every scenario in the existing `restoration`, `discovery requests`, `validation and publication`, and `failures and cancellation` blocks, add a counterpart. Replace "returned definitions" assertions with `idsOf(provider.getModels())` after `await provider.refreshModels(context)`; keep the publish, fetch-count, header, and error-message assertions. Required new cases:
  - `exposes the canonical curated baseline before any refresh`: `idsOf(getModels())` equals `["MiniMax-M3.1-Flash", "MiniMax-M3"]` and every model has `provider`, `baseUrl`, and `api === region.provider`, with no `headers`.
  - `restores a compatible cached subset without a key or network`: `credential: undefined`, `allowNetwork: false`, cached `["MiniMax-M3"]` → ids `["MiniMax-M3"]`, `fetch` not called.
  - `keeps prior models when persisted after the timeout`: mock `AbortSignal.timeout` to a controllable signal and abort it inside `publish` before calling `update`. The refresh rejects with `MiniMax model discovery timed out`, and the ids are unchanged.
  - `persists exactly the 0.5.0 record shape`: `publish.mock.calls.at(-1)[0].persist.models[0]` matches `{ provider, baseUrl, api: region.provider }` with no `headers`, and `checkedAt` is a number.
  - `routes stream and streamSimple through the hardening pipeline` (in `minimax-openai.test.ts`, using the mocked `getApiProvider`): both `provider.stream(...)` and `provider.streamSimple(...)` call the matching driver method once with `api: "openai-completions"` and strip an inline `<think>` from the output.

- [ ] **Step 2: Run them and confirm they fail.**
  Run: `pnpm test -- tests/providers/minimax-openai/catalog.test.ts tests/providers/minimax-openai.test.ts`
  Expected: FAIL (`createMiniMaxProvider` is not exported).

- [ ] **Step 3: Implement the Task 1 exports** in `catalog.ts` and `minimax-openai.ts` per the Interfaces block and the algorithm above. Leave `createMiniMaxModelRefresh` and `registerMiniMax` in place.

- [ ] **Step 4: Run the focused tests, then the full check.**
  Run: `pnpm test -- tests/providers/minimax-openai/catalog.test.ts tests/providers/minimax-openai.test.ts`, then `pnpm check`
  Expected: all pass; the old suites still pass unchanged.

- [ ] **Step 5: Commit.**
  ```bash
  git add src/providers/minimax-openai.ts src/providers/minimax-openai/catalog.ts tests/providers/minimax-openai/catalog.test.ts tests/providers/minimax-openai.test.ts
  git commit -m "feat(minimax): add native provider factory with catalog semantics"
  ```

### Task 2: Register native providers, prove host behaviour, document

**Files:**
- Modify: `src/providers/minimax-openai.ts`, `src/providers/minimax-openai/catalog.ts`
- Test: `tests/providers/minimax-openai/catalog-runtime.test.ts`, `tests/providers/minimax-openai/catalog.test.ts`, `tests/providers/minimax-openai.test.ts`, `tests/providers/minimax-openai/wire-replay.test.ts`, `tests/index.test.ts`
- Modify: `README.md`, `CHANGELOG.md`

**Interfaces:**
- Consumes: `MINIMAX_REGIONS`, `createMiniMaxProvider` (Task 1).
- Produces: `registerMiniMax(pi: ExtensionAPI): void`, which calls `pi.registerProvider(createMiniMaxProvider(region))` for each region in order. `createMiniMaxModelRefresh` is deleted.

- [ ] **Step 1: Write the failing host tests** in `catalog-runtime.test.ts`. Change `createHost` so `registerProvider(provider: Provider)` calls `runtime.registerNativeProvider(provider)`, and add an option `{ credentials?: boolean; modelsPath?: string }`. With `credentials: false`, seed no credential. `wrapPersistence` re-registers a native provider whose `refreshModels` swaps `context.publish`. Add:
  - `does not report or fetch for regions without a key` (the regression): no env, no credentials, a stored compatible entry for China. `await runtime.refresh({ providers: [GLOBAL.provider, CHINA.provider] })` gives `result.errors.size === 0`, `fetch` is not called, and China `getModels` shows the restored subset.
  - `discovers only the region whose env var is set`: `vi.stubEnv("MINIMAX_CN_API_KEY", "cn-env-key")`, no credentials. One fetch to `https://api.minimaxi.com/v1/models` with `authorization: Bearer cn-env-key`, no errors.
  - `treats a whitespace-only env var as unset`: `vi.stubEnv("MINIMAX_CN_API_KEY", "  ")` gives no error, no fetch, and `await runtime.checkAuth(CHINA.provider)` is `undefined`.
  - `prefers a stored key over the env var`: stored `minimax-openai-test-key` plus env `env-key`. The fetch authorization is `Bearer minimax-openai-test-key`.
  - `makes env-only models available after an offline startup refresh`: env `MINIMAX_API_KEY` set, no credentials, `await runtime.refresh({ allowNetwork: false })`. `getAvailableSnapshot()` contains `minimax-openai/MiniMax-M3.1-Flash` and nothing from `minimax-openai-cn`.
  - `restores a 0.5.0 cache entry without fetching`: seed the store with `{ models: [<0.5.0-shaped MiniMax-M3 record>], checkedAt: Date.now() }`, credentials on, refresh with network. No fetch, ids `["MiniMax-M3"]`.
  - `applies models.json overrides to native models`: a temporary `models.json` with `{ "providers": { "minimax-openai": { "modelOverrides": { "MiniMax-M3": { "name": "M3 override" } } } } }` passed as `modelsPath` gives `getModel(GLOBAL.provider, "MiniMax-M3")?.name === "M3 override"`.
  Keep every existing runtime scenario, adapted to the native harness.

- [ ] **Step 2: Run them and confirm the regression fails.**
  Run: `pnpm test -- tests/providers/minimax-openai/catalog-runtime.test.ts`
  Expected: FAIL. The regression reports `Failed to resolve API key for provider "minimax-openai-cn" from environment variable: MINIMAX_CN_API_KEY`; the env-only and whitespace cases fail similarly.

- [ ] **Step 3: Switch `registerMiniMax`** to native registration. Delete `createMiniMaxModelRefresh` and any helper only it used, together with its old describe blocks in `catalog.test.ts`.

- [ ] **Step 4: Update the registration-shape tests.**
  - `tests/index.test.ts`: the MiniMax calls are single-argument providers. Assert `call[0].id` order `["minimax-openai", "minimax-openai-cn"]` before `"stepfun-ai"`, `baseUrl` per region, `typeof refreshModels === "function"`, curated model ids, and distinct provider objects. Remove the `apiKey: "$..."` assertions.
  - `tests/providers/minimax-openai.test.ts`: the registration tests read `provider.getModels()` (already canonical) instead of `config.models`. Assert auth through `provider.auth.apiKey?.resolve({ ctx: { env: async (n) => (n === envVar ? "k" : undefined), fileExists: async () => false }, signal: new AbortController().signal })`, which returns `{ auth: { apiKey: "k" } }` and returns `undefined` when the env is empty. The `streamSimple pipeline` helpers use `provider.streamSimple`.
  - `wire-replay.test.ts`: `registerProviders()` maps `provider.id → Provider`, `modelFor` reads `provider.getModels()`, and `streamSimpleFor` returns `provider.streamSimple`. All wire assertions stay unchanged.

- [ ] **Step 5: Update the docs.** In `README.md`, rewrite the "Key matching" limit: MiniMax uses a stored `/login` key, else `MINIMAX_API_KEY` / `MINIMAX_CN_API_KEY`; a region with neither is not configured, and Pi skips its discovery without a warning. StepFun keeps the `$STEP_API_KEY` reference. Add one sentence about the missing-key case to "Availability discovery". In `CHANGELOG.md` under `## [Unreleased]`, add `### Fixed`: opening the model selector no longer warns `Could not refresh minimax-openai-cn` (or `minimax-openai`) when that region has no key. MiniMax regions are now native providers that treat a missing key as not configured.

- [ ] **Step 6: Run the full verification.**
  Run: `pnpm check`, then `pnpm pack:dry-run`
  Expected: format, lint, typecheck, and every test pass; the pack lists `src/providers/minimax-openai*.ts` and no `docs/superpowers` files.

- [ ] **Step 7: Verify in the real Pi.** From an empty directory, with `MINIMAX_CN_API_KEY` unset and `MINIMAX_API_KEY` set, run `pi -ne -e /Users/lanh/Developer/pi-vault/pi-providers/src/index.ts --no-session`. Open `/model` and wait for the status line.
  Expected: no `minimax-openai-cn` warning, and `MiniMax-M3.1-Flash` is listed under `minimax-openai`. Then select it, send `hi`, and confirm a streamed reply. Exit.

- [ ] **Step 8: Commit.**
  ```bash
  git add src tests README.md CHANGELOG.md
  git commit -m "fix(minimax): register native providers so unconfigured regions refresh silently"
  ```
<!-- phase:01:end -->
