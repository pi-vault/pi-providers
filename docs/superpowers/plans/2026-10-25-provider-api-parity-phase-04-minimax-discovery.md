# Phase 4 — Authenticated MiniMax availability discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe, region-scoped online/offline availability updates to the working phase-3 providers.

**Architecture:** Retain the current extension registrations and Pi transports. Change local TypeSafe validation, refresh Command Code's existing catalog module, extract direct MiniMax metadata for reuse, and add a provider-scoped availability callback using Pi's storage/publication lifecycle.

**Tech Stack:** TypeScript ESM, Pi AI/coding-agent `^0.87.1`, TypeBox, Vitest, native fetch/AbortSignal, pnpm, Biome.

**Spec:** [Provider API Parity Specification](../specs/2026-10-25-provider-api-parity-design.md). Read the relevant subsystem section before each phase.

## Global Constraints

- Preserve provider IDs `minimax-openai`, `minimax-openai-cn`, and `command-code`, and tool name `typesafe_decide`.
- Preserve existing credential names, precedence, and login behavior.
- Keep MiniMax on OpenAI Chat Completions and preserve the custom stream-hardening pipeline.
- Keep the current dependencies, Node requirement `>=24.15.0`, and Pi development baseline `^0.87.1`.
- Leave StepFun behavior and registrations unchanged.
- Use mocked HTTP and frozen fixtures in automated tests; credentials and paid inference are not required for acceptance.
- Update README and an Unreleased changelog entry within each behavior phase; preserve historical release entries.
- Release numbering, publishing, and dependency upgrades are outside this work.

## Review Focus

- Criteria-only/null TypeSafe inputs must survive schema validation and serialization; test in phase 1.
- An oversized direct request must never become an oversized gateway fallback; test in phase 1.
- New paid Command Code aliases must not inherit retired free prices or guessed routes; test in phase 2.
- MiniMax reasoning must survive the actual second-turn wire request, including whitespace and multiple tools; test in phase 3.
- Empty, stale, regional, cancelled, or rejected MiniMax publications must not resurrect models or replace valid state; test in phase 4.


**Parent:** [Provider API Parity Implementation Plan](2026-10-25-provider-api-parity.md)  
**Source phase:** 04  
**Parent SHA-256 at extraction:** `84f3e0a8688e63eafebe530318a8c5bc50d3bdb04811c7e383a88ff1e69e22f2`

The phase section below is copied verbatim from the parent. Read the linked spec and inherited constraints; execute only this phase. Track progress here and leave the parent unchanged.

---

## Phase 4 — Authenticated MiniMax availability discovery

**Phase goal:** Add safe, region-scoped online/offline availability updates to the working phase-3 providers.

**Prerequisites:** Phase 3's `MINIMAX_MODELS` curated definitions and working stream registration.  
**Usable result:** Supported models reflect a successful availability check, survive offline startup, and retain the previous usable catalog on failures.  
**Spec:** Section 4 and Global constraints.

### Task 4: Add discovery through the existing refresh callback

**Files:**

- Create: `src/providers/minimax-openai/catalog.ts`
- Modify: `src/providers/minimax-openai.ts`
- Create: `tests/providers/minimax-openai/catalog.test.ts`
- Test: `tests/providers/minimax-openai.test.ts`, `tests/index.test.ts`
- Modify: `README.md`, `CHANGELOG.md`

**Interfaces:**

- Consumes: `MINIMAX_MODELS` from phase 3; Pi's `ProviderConfig`, `RefreshModelsContext`, and `context.publish` lifecycle.
- Produces: `createMiniMaxModelRefresh(providerId: string, baseUrl: string): NonNullable<ProviderConfig["refreshModels"]>` from `catalog.ts`; attach one callback instance to each existing regional registration.
- Returns: current supported `ProviderModelConfig[]` for the host to publish; use `context.publish({ persist })` for successful canonical `Model<Api>[]` records plus `checkedAt`.
- Constants: successful refresh interval `4 * 60 * 60 * 1000`, request timeout `10_000` milliseconds. Keep them private to this module.
- Cache identity: existing provider-scoped Pi store; persist matching `provider`, region `baseUrl`, and custom API ID in model records. A stored entry with `models: []` is a valid successful empty catalog, distinct from no stored entry.

- [ ] **Step 1: Add failing availability and cache tests.** Exercise the callback directly with a mocked `RefreshModelsContext` and `publish`, and through a registered provider using Pi's extension composition/runtime harness for actual host publication. Reuse in-memory credential/model stores where supported; mock only HTTP/storage boundaries.

```ts
expect(globalRequest.url).toBe("https://api.minimax.io/v1/models");
expect(globalRequest.headers.get("authorization")).toBe("Bearer global-key");
expect(chinaRequest.url).toBe("https://api.minimaxi.com/v1/models");
expect(chinaRequest.headers.get("authorization")).toBe("Bearer china-key");
expect(selected.map((model) => model.id)).toEqual(["MiniMax-M3.1-Flash"]);
expect(restoredFlash.cost.input).toBe(0.15); // Cached old cost is discarded.
expect(emptyResult).toEqual([]); // A successful empty list is authoritative.
```

Required cases: initial baseline/no network; offline restore; cache with deprecated, unknown, or wrong-provider records; metadata rehydration; valid empty data; valid all-unknown/deprecated data yielding an empty intersection; duplicates/blank IDs/malformed envelope rejecting the refresh; missing key making no request; independent global/CN keys/caches. A nonempty cache belonging to another provider or incompatible region is ignored in favor of the bundled baseline, not interpreted as a successful empty supported catalog.

Add fake-clock cases at one millisecond before and exactly at the four-hour boundary, plus forced refresh. Successful checks throttle; failed checks preserve the previous `checkedAt` and remain eligible for the next permitted check.

- [ ] **Step 2: Add failing publication and error-path tests.** Cover HTTP 401/403/429/500, malformed JSON, ten-second timeout, pre-cancelled calls, cancellation while parsing the body, and abort after fetch but before publication. Assert failures keep the prior catalog; first-run failures leave no fake persisted empty catalog; no error includes the bearer key and neither region retries against the other.

For `publish` returning false, throwing, or losing its generation while a response is pending, assert that the candidate is neither returned for host publication nor installed in the provider. Simulate two concurrent refreshes resolving out of order through the host: the newer accepted result must win. After a valid empty result, restart offline and assert it remains empty. Verify no persisted serialized record contains credentials or ZDR headers.

- [ ] **Step 3: Run focused tests and establish the intended failures.**

Run: `pnpm test -- tests/providers/minimax-openai.test.ts tests/providers/minimax-openai/catalog.test.ts tests/index.test.ts`  
Expected: missing callback/module or failed discovery/publication assertions. Do not replace host-publication tests with callback-only assertions.

- [ ] **Step 4: Implement authenticated discovery and current-metadata restore.** Parse the documented OpenAI list envelope; intersect unique nonblank IDs with `MINIMAX_MODELS` in curated order. Keep metadata local. Rehydrate compatible stored IDs from the phase-3 definitions before freshness decisions; ignore deprecated/unknown entries and reject a mismatched nonempty regional/provider cache. Preserve successfully stored empty availability.

On allowed, configured, stale/forced online calls, fetch only the supplied regional base's `/models` with the host-resolved key and combined abort/timeout signal. Publish successful canonical model records with `checkedAt`; return the candidate only after persistence was accepted and the signal is still active. On a false publication return the prior rehydrated list; on cancellation let the host suppress updates; on unsuccessful HTTP, malformed data, timeout, or persistence error surface a sanitized error without publishing a replacement. Prefer deriving fallback from `context.stored` and curated definitions over introducing mutable provider-private catalogs. Add no background timer or new file store.

Attach the callback to each existing registration. Preserve the phase-3 inference path and custom API tags; discovery must not cause either region's stream to bypass hardening.

- [ ] **Step 5: Document and verify the complete feature.** Explain authenticated availability refresh, supported-model filtering, four-hour successful-check freshness, forced refresh through Pi's existing mechanism, offline fallback, and the fact that new model IDs still need curated metadata. Record China endpoint parity as an assumption with safe fallback. Add an Unreleased discovery entry.

Run: `pnpm test -- tests/providers/minimax-openai.test.ts tests/providers/minimax-openai tests/index.test.ts`  
Run: `pnpm check`  
Run: `pnpm pack:dry-run`  
Expected: all pass; discovery source is packaged; plans and test fixtures are excluded; real-driver reasoning/tool regressions remain green after discovery integration. State explicitly that authenticated regional endpoints were not exercised if no credentials were used.

- [ ] **Step 6: Review and commit the atomic phase.**

```sh
git add src/providers/minimax-openai/catalog.ts src/providers/minimax-openai.ts tests/providers/minimax-openai/catalog.test.ts tests/providers/minimax-openai.test.ts tests/index.test.ts README.md CHANGELOG.md
git commit -m "feat: discover supported MiniMax model availability"
```

**Phase acceptance:** Supported availability updates atomically and persists per region; offline/empty/error/cancellation paths behave as specified, deprecated models never reappear, and inference retains all phase-3 behavior.
