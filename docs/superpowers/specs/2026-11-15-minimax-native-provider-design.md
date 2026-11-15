# MiniMax native provider design

Date: 2026-11-15
Status: proposed

## Intent

Opening Pi's model selector (`/model`) shows `Could not refresh minimax-openai-cn; showing cached models.` whenever `MINIMAX_CN_API_KEY` is unset and no China credential is stored. The same thing happens for `minimax-openai` when `MINIMAX_API_KEY` is unset. A user who never configured a region should never see a warning about it.

### Root cause

`registerMiniMax` registers both regions with the name-based `pi.registerProvider(name, config)` API, with `apiKey: "$MINIMAX_CN_API_KEY"` and a `refreshModels` callback. For every provider with `refreshModels`, Pi's catalog refresh (`ModelsImpl.refresh` → `resolveNetworkRefresh` → `resolveRefreshCredential` in `pi-ai/src/models.ts`) asks for the API key. Pi wraps name-registered `$ENV` keys in `composeApiKeyAuth` (`coding-agent/src/core/provider-composer.ts`). Its `resolve` calls `resolveConfigValueOrThrow`, which **throws** when the variable is unset. Its `check` returns "not configured" instead. The throw becomes a per-provider refresh error, and the model selector shows that error as the warning. Our `createMiniMaxModelRefresh` never runs, so nothing in this package can catch the error today.

Native providers built with `envApiKeyAuth` (`pi-ai/src/auth/helpers.ts`) return `undefined` from `resolve` when no key exists. Pi then skips the network phase quietly. `command-code` already works this way.

### Not in scope: the ~1 s delay

Measured in a real terminal session against the user's config, the selector renders in about 60 ms. The refresh status appears roughly 1.6 s later, when Pi's refresh of every catalog finishes. That time is dominated by OpenRouter (the pi.dev catalog plus `openrouter.ai/api/v1/models/user`), which this package doesn't own. The China failure takes about 2 ms, and the global MiniMax check is usually skipped by its 4-hour freshness window.

## Goals

- No refresh warning for a MiniMax region without a key (neither a stored credential nor its env var).
- A region with a key keeps its current discovery behaviour exactly (below).
- Both regions stay registered whether or not a key exists, so `/login` can offer them and a stored credential works without an env var.

## Non-goals

- Speeding up Pi's overall catalog refresh, or changing OpenRouter, StepFun, or Command Code.
- Changing any model metadata, pricing, thinking maps, or the stream-repair pipeline.
- Patching Pi upstream (option 2 of the original discussion; still worth reporting separately).

## Anti-goals (a failure even if the warning disappears)

- A configured region loses discovery, freshness throttling, cache restore, or region isolation.
- A cached subset or authoritative empty result no longer hides models (for example the baseline reappears after `/models` dropped an ID).
- Cached metadata overrides current curated metadata after a package upgrade.
- Users with `minimax-openai/MiniMax-M3.1-Flash` as their default model lose it at startup or must re-authenticate.
- Existing `models-store.json` entries for `minimax-openai` / `minimax-openai-cn` become invalid and force a refetch or hide models.
- `models.json` overrides for these provider IDs stop applying.

## Constraints

- Pi `>=1.4.0`. The native `pi.registerProvider(provider: Provider)` overload and `createProvider` / `envApiKeyAuth` from `@earendil-works/pi-ai/compat` already exist there (`command-code.ts` uses them).
- Provider IDs, base URLs, env var names, and model IDs stay unchanged.
- Persisted model records keep `provider = <id>`, `baseUrl = <regional URL>`, `api = <id>`, matching what 0.5.0 writes, so old stores stay compatible (`isCompatibleRecord`).
- Streams still go through the existing pipeline: `normalizeToolResults` → `prepareThinkingReplay` → `openai-completions` driver with `api` rewritten → `hardenToolCalls` → `cleanStream`.

## Approaches

1. **Hand-written `Provider` object around the existing catalog code.** Smallest diff, and `catalog.ts` with its unit tests stays almost the same. It doesn't follow the factory pattern the rest of the package uses. *Not chosen.*
2. **`createProvider` + `envApiKeyAuth`, like `command-code.ts`.** Follows the package's existing native-provider pattern. `createProvider`'s built-in refresh doesn't match MiniMax semantics: no throttle, cached models laid over the baseline, cached metadata restored as-is, no compatibility check. So like Command Code it needs a `refreshModels` wrapper and a `getModels`/`getAllModels` override. `catalog.ts` and its tests are reshaped around that. **Chosen by the user.**
3. **Register a region only when its env var is set.** One line, but breaks `/login` and stored-credential-only use. *Rejected.*

## Design (decided)

### Registration

`registerMiniMax(pi)` calls `pi.registerProvider(createMiniMaxProvider(region))` once per region, global first, then China:

| id | name | baseUrl | env var |
|---|---|---|---|
| `minimax-openai` | `MiniMax (OpenAI)` | `https://api.minimax.io/v1` | `MINIMAX_API_KEY` |
| `minimax-openai-cn` | `MiniMax CN (OpenAI)` | `https://api.minimaxi.com/v1` | `MINIMAX_CN_API_KEY` |

`createMiniMaxProvider` is exported so tests and the runtime can build a region without a fake `ExtensionAPI`. It calls `createProvider` with:

- `auth: { apiKey: envApiKeyAuth("<name> API key", [envVar]) }`.
- `models`: the curated `MINIMAX_MODELS` made canonical for the region (`provider`, `baseUrl`, `api = id`, no `headers`), deep-cloned.
- `fetchModels`: the authenticated `${baseUrl}/models` discovery (below).
- `api: { stream, streamSimple }`. Both run the existing pipeline, `streamSimple` through the driver's `streamSimple` and `stream` through the driver's `stream`.

### Model list (override on the created provider)

The provider keeps one piece of state, the *authoritative ID set*, which is unset until a cache restore or a successful discovery sets it. `getModels()` / `getAllModels()` return the canonical curated models, filtered to that set when it exists, always in curated order. Because the result is built from curated definitions, current metadata always wins over cached metadata, and an empty set hides every model.

### Refresh (wrapper around the created provider's `refreshModels`)

On every call, in order:

1. `context.signal.throwIfAborted()`.
2. **Restore.** Validate `context.stored` with today's `restoreCatalog` rules:
   - no entry, or non-array `models` → incompatible, baseline;
   - empty array → compatible, empty;
   - any record whose `provider` / `baseUrl` / `api` doesn't match → the whole cache is incompatible, baseline;
   - otherwise, the compatible subset of known IDs.

   Publish an `update` that sets the authoritative set: undefined for incompatible (shows the baseline), otherwise the restored IDs. Stop if `publish` returns false.
3. **Gate.** Stop if `!allowNetwork`, if there is no usable API-key credential, or if the cache is compatible and fresh (`checkedAt` finite, `0 <= checkedAt <= now`, `now - checkedAt < 4h`) and `!force`.
4. **Discover.** Delegate to the created provider's own refresh, passing a context whose `stored` is `undefined` so it skips its own restore and only runs `fetchModels` + publish. `fetchModels` is today's `discoverModels` minus the publishing: a 10 s timeout combined with the caller signal, `Authorization: Bearer <key>`, the same validation (`object === "list"`, unique non-blank string IDs) and sanitized errors (`MiniMax model discovery failed (HTTP n)`, `… returned an invalid catalog`, `… timed out`). It returns canonical curated models whose IDs the endpoint listed. Wrap `publish` so the accepted update also sets the authoritative set to the published IDs, and the persisted entry is `{ models, checkedAt }`. Persistence failure is reported as `MiniMax model persistence failed`.
5. **Failure.** Errors propagate (Pi reports them), the prior state is kept, and nothing is persisted, so the next refresh retries. Unlike Command Code, no `checkedAt` is written on failure.

Cancellation keeps today's guarantees: an aborted caller never publishes, and a cancellation that lands after persistence was accepted leaves the runtime unchanged.

### Files

- `src/providers/minimax-openai.ts`: `createMiniMaxProvider`, `registerMiniMax`, stream wiring.
- `src/providers/minimax-openai/catalog.ts`: restore validation, freshness, discovery fetch/validation, canonicalisation, and the refresh wrapper / model-list override builder. Drop `createMiniMaxModelRefresh`.
- Tests: `tests/index.test.ts`, `tests/providers/minimax-openai.test.ts`, `tests/providers/minimax-openai/catalog.test.ts`, `tests/providers/minimax-openai/catalog-runtime.test.ts` move to the native registration shape. Each existing scenario keeps a test.
- Docs: README "Key matching" and "Availability discovery" notes; a CHANGELOG `Unreleased` entry.

### Required new tests

- **Regression:** register both regions in a real `ModelRuntime` with no env vars and no stored credentials. `runtime.refresh({ allowNetwork: true })` reports no error for either MiniMax ID, and `fetch` is never called for them.
- With only `MINIMAX_CN_API_KEY` set, China discovery fetches with that key and the global region stays silent.
- A stored credential with no env var still discovers.
- A 0.5.0-shaped `models-store.json` entry (compatible subset, fresh) restores the subset without a fetch.
- `checkAuth` / `getAvailable` show a region as available exactly when it has a key.

## Left to the builder

- Internal names, file split within `catalog.ts`, and how the override state is shared between the wrapper and `getModels`.
- Whether `fetchModels` receives the key through `context.credential` (expected) or another seam, provided behaviour matches the above.
- Test helper structure, and which old unit tests merge or move, as long as every listed scenario stays covered.
- Exact README / CHANGELOG wording.

## Verification

- `pnpm check` (format, lint, typecheck, tests).
- Manual check against the installed Pi with the local package linked: `/model` with `MINIMAX_CN_API_KEY` unset shows `Model catalogs refreshed.` (or only non-MiniMax warnings). The default `minimax-openai/MiniMax-M3.1-Flash` is still selected after restart, and one prompt streams successfully.
