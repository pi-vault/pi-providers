# Provider API Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update TypeSafe questions, Command Code's catalog, and MiniMax models/reasoning/discovery while preserving the approved compatibility boundaries.

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

---

## Delivery and document rules

This parent is the complete implementation handoff. Keep it unchanged when extracting or executing phase plans; record progress in the phase copies. Phase files contain the common plan context plus an exact copy of their phase section. Each phase is an independently reviewable, shippable diff including tests and documentation; a user can stop after any completed phase.

| Order | Phase and usable result | Prerequisite | Phase plan |
| --- | --- | --- | --- |
| 1 | TypeSafe accepts the current text contract and safe gateway limits | Existing baseline | [TypeSafe](2026-10-25-provider-api-parity-phase-01-typesafe.md) |
| 2 | Command Code exposes a verified current catalog with Flash controls | Existing baseline | [Command Code](2026-10-25-provider-api-parity-phase-02-command-code.md) |
| 3 | Direct MiniMax offers M3/M3.1 with correct multi-turn reasoning | Existing baseline | [MiniMax models and replay](2026-10-25-provider-api-parity-phase-03-minimax-models-replay.md) |
| 4 | Direct MiniMax availability refreshes safely online and offline | Phase 3 | [MiniMax discovery](2026-10-25-provider-api-parity-phase-04-minimax-discovery.md) |

The ordering is localized validation, catalog conversion, streamed inference/history, then authenticated persistent discovery. No phase is merely scaffolding, a failing test suite, or documentation for functionality deferred to the next phase.

### File responsibilities

- `src/tools/typesafe-decide.ts`: public tool schema, request validation, and backend-limit guard.
- `src/providers/command-code/models.ts`: captured catalog, local capability/pricing metadata, model-specific transport configuration. Retain `src/providers/command-code.ts` refresh behavior; touch it only if required to look up the existing local metadata during live conversion.
- `src/providers/minimax-openai.ts`: regional registrations, stream composition, and attachment of the phase-4 refresh callback.
- `src/providers/minimax-openai/models.ts` (new in phase 3): curated direct model definitions shared by registration and discovery.
- `src/providers/minimax-openai/prepare-thinking-replay.ts` (new in phase 3): immutable same-model legacy history conversion.
- `src/providers/minimax-openai/clean-stream.ts`: preservation of native reasoning content/signatures during cleanup.
- `src/providers/minimax-openai/catalog.ts` (new in phase 4): authenticated availability parsing, current-metadata rehydration, persistence, freshness, and cancellation.
- `tests/fixtures/command-code-models.json` (new in phase 2): frozen upstream response, used only by tests.
- Existing provider/tool tests plus phase-specific new tests: executable acceptance criteria described below.

### Baseline and implementation discipline

Before the first code phase, confirm a clean or understood working tree and run `pnpm check`. The planning baseline was 187 passing tests; record actual counts rather than pinning every future run to that count. Add failing regression tests before production edits. Use the existing test helpers where possible; any snippets below describe assertions to add inside the named harness, not standalone production implementations.

Complete the phase's focused command, then `pnpm check` and `pnpm pack:dry-run`. Packaging must include the new source modules and exclude the planning documents/test fixtures. Review the diff, then commit that phase's files together. Commit commands below are future implementation steps; writing these documents does not execute them.

<!-- phase:01:start -->
## Phase 1 — TypeSafe text contract and gateway limit

**Phase goal:** Ship compatible text-question validation and prevent invalid oversized gateway attempts.

**Prerequisites:** Existing baseline only; independent of other providers.  
**Usable result:** Existing TypeSafe calls still work, newly documented question shapes work, and a large direct call does not silently split or overrun gateway limits.  
**Spec:** Sections 1 and Global constraints.

### Task 1: Update the question contract and backend boundary

**Files:**

- Modify: `src/tools/typesafe-decide.ts`
- Test: `tests/tools/typesafe-decide.test.ts`
- Modify: `README.md`, `CHANGELOG.md`

**Interfaces:**

- Consumes: `registerTypeSafeDecisionTool(pi: ExtensionAPI): void`, existing `createHarness`, `installFetch`, `callTool` test helpers, and current fallback state machine.
- Produces: unchanged tool name/result; broader `DecideParams` through `decideParameters`; internal `assertCommandCodeQuestionLimit(questions: QuestionMap): void` with maximum `100`.
- Retains: `validateQuestion(id: string, raw: unknown): Question`, `validateQuestions(raw: unknown): QuestionMap`, direct/gateway aliases, and existing response checks.

- [ ] **Step 1: Add failing contract and wire tests.** Extend the existing table-driven tests with the following exact assertions; update obsolete tests that expect one-option Choice or one-level Score to fail.

```ts
// In the existing harness, provide a matching answer for each accepted question.
expect(choiceSchema.minProperties).toBe(1);
expect(choiceSchema.maxProperties).toBe(255);
expect(scoreSchema.minItems).toBe(1);
expect(scoreSchema.maxItems).toBe(10);
expect(Object.hasOwn(sent.questions.criteria_only, "instructions")).toBe(false);
expect(sent.questions.null_instructions.instructions).toBeNull();
expect(sent.questions.null_criteria.criteria).toBeNull();
expect(result.details.answers.single_score).toMatchObject({
  type: "score", score: 0, probabilities: { "0": 1 },
});
```

Add cases named `accepts criteria-only questions`, `preserves explicit null instructions and Noul criteria`, `requires a non-null Noul description without instructions`, and `preserves prototype-sensitive IDs in criteria-only questions`. Accept Noul null outcome values when another outcome or instructions supplies meaning. Reject Noul with no instructions and missing/null/empty/all-null criteria; reject Choice counts 0/256, Score counts 0/11, null Score levels, and existing invalid JSON inputs before fetching. Ensure host-level schema validation accepts every runtime-valid new shape.

Add `allows 101 direct questions`, `allows 100 gateway questions`, `rejects 101 gateway questions before fetching`, and `retains direct failure when 101 questions prevent fallback`. Build matching Noul responses for all requested IDs. Assert direct success uses exactly one direct POST, gateway rejection uses zero gateway POSTs, and a retryable direct failure produces exactly one direct POST plus a sanitized message matching `/100/` and the original failure category. Include cancellation before the guard and before fallback credential resolution.

- [ ] **Step 2: Run the focused tests and verify the intended failures.**

Run: `pnpm test -- tests/tools/typesafe-decide.test.ts`  
Expected: new cases fail on required instructions, minimum-two constraints, or an unwanted gateway POST; baseline failures must not be hidden.

- [ ] **Step 3: Implement schema/runtime parity in the existing tool module.** Make question instructions optional and nullable, Noul criteria/outcomes nullable, and the two minimum counts `1`. Preserve own-property presence during normalization; avoid adding an instructions key when it was absent. Require a non-null Noul outcome only when instructions are absent/null. Keep Score levels non-null. Keep TypeBox constraints and runtime checks aligned, expressing Noul's conditional requirement with schema composition and the same runtime rule. Keep prototype-safe construction.

Add `assertCommandCodeQuestionLimit` at both existing gateway dispatch paths after cancellation checks and before gateway fetch. On a failed direct attempt followed by a blocked oversized fallback, combine the sanitized direct failure with the gateway-limit explanation. Preserve the existing fallthrough statuses, ten-second timeout, credential precedence, answer validation, and absence of ZDR headers; do not introduce request chunking or SDK retries.

- [ ] **Step 4: Document the usable result.** Update current README question bounds, optional/null examples, direct token budgets versus gateway question count, and existing authentication-failure fallback/privacy behavior. Add an Unreleased TypeSafe entry. Retain historical examples that still satisfy the broader contract and the existing cost-reporting explanation.

- [ ] **Step 5: Verify the complete phase.**

Run: `pnpm test -- tests/tools/typesafe-decide.test.ts`  
Run: `pnpm check`  
Run: `pnpm pack:dry-run`  
Expected: all pass; the gateway never receives 101 questions; other provider registrations are unchanged.

- [ ] **Step 6: Review and commit the atomic phase.**

```sh
git add src/tools/typesafe-decide.ts tests/tools/typesafe-decide.test.ts README.md CHANGELOG.md
git commit -m "fix: align TypeSafe questions and gateway request limits"
```

**Phase acceptance:** All new question shapes work through the registered tool, invalid requests fail before network use, and the existing backend/fallback contract remains intact.
<!-- phase:01:end -->

<!-- phase:02:start -->
## Phase 2 — Command Code catalog and model-specific Flash controls

**Phase goal:** Ship a verified current bundled catalog and usable MiniMax Flash metadata/effort controls through Command Code.

**Prerequisites:** Existing baseline only; phase 1 may already be present.  
**Usable result:** Offline users see the refreshed bundle; successful live catalogs retain their existing authority, and Flash requests use their declared route and supported effort.  
**Spec:** Section 2 and Global constraints.

### Task 2: Refresh the snapshot and preserve transport/cache contracts

**Files:**

- Modify: `src/providers/command-code/models.ts`
- Modify only if needed for local metadata lookup: `src/providers/command-code.ts`
- Create: `tests/fixtures/command-code-models.json`
- Test: `tests/providers/command-code.test.ts`
- Modify: `README.md`, `CHANGELOG.md`

**Interfaces:**

- Consumes: `CommandCodeCatalogRecord`, `COMMAND_CODE_CATALOG`, `commandCodeModels`, `modelFromCatalogRecord(record: CommandCodeCatalogRecord): CommandCodeModel`, and `createCommandCodeProvider()`.
- Produces: the same exports with refreshed records; a local ID-keyed metadata overlay in the catalog module used for both bundled and live ID conversion.
- Retains: live fields over local metadata, local verified capabilities over donor/family defaults, existing unknown-live defaults, `COMMAND_CODE_FALLBACK_MAX_TOKENS = 32_768`, and the current cache version.

- [ ] **Step 1: Freeze catalog evidence before changing definitions.** Fetch the public models endpoint, using a normal HTTP User-Agent if a default client gets 403. Store the exact response in the fixture, with no credentials. Keep only supported chat records in production definitions. Record capture date/source in the catalog module. Resolve newly paid-model pricing and capabilities from official Command Code model/pricing pages; use the spec's 13-add/6-remove planning delta as a sanity check. A changed live response is acceptable when the fixture, definitions, and README all use the same capture. Report unverifiable prices explicitly; never substitute zero or claim a completed refresh without sourced rates.

- [ ] **Step 2: Add failing snapshot, conversion, and payload tests.** Replace brittle September count assertions with assertions against the frozen fixture. Compare exact ID sets, names, contexts, and endpoint declarations after excluding non-chat records. Pin newly added/retired IDs against the actual capture, and test that both bundled and metadata-poor live Flash records resolve identically.

```ts
expect([...bundledIds].sort()).toEqual([...fixtureChatIds].sort());
expect(flash.api).toBe("openai-completions");
expect(flash.input).toEqual(["text", "image"]);
expect(flash.maxTokens).toBe(32_768);
expect(flash.thinkingLevelMap).toEqual({
  off: null, minimal: null, low: "low", medium: "medium",
  high: "high", xhigh: "xhigh", max: "max",
});
expect(body.model).toBe("minimax/minimax-m3.1-flash");
expect(body.reasoning_effort).toBe("max");
expect(request.url).toBe("https://api.commandcode.ai/provider/v1/chat/completions");
```

Add cases named `keeps paid Ling separate from retired free aliases`, `uses captured endpoints rather than inferred endpoint families`, `uses verified capabilities without a Pi donor`, and `lets valid live metadata override local capabilities`. Assert every newly bundled paid model has sourced nonzero input/output rates and only verified current free models have zero rates. Preserve a test that Command Code still exposes `MiniMaxAI/MiniMax-M2.7` if the fixture advertises it. Exercise Flash low/medium/high/xhigh/max via the real Pi driver with mocked fetch, and assert its terminal stream usage is preserved.

Run the existing malformed catalog, offline restore, authoritative removal, credential, Responses, and ZDR tests unchanged wherever their assertions are not snapshot data.

- [ ] **Step 3: Verify the new tests fail before implementing the catalog changes.**

Run: `pnpm test -- tests/providers/command-code.test.ts`  
Expected: the bundle differs from the fixture and Flash's new capability/effort assertions fail.

- [ ] **Step 4: Update the existing catalog implementation.** Replace the bundled membership and exact endpoint declarations using the fixture. Refresh sourced costs/capabilities in the existing module; merge verified ID metadata into live conversions when those fields are absent. Do not overwrite explicit live values. Retain donor/family behavior for records without local metadata. Apply the Flash effort map and `supportsReasoningEffort` only to its Completions model; keep gateway `max_tokens` compatibility and the output fallback. Preserve transport selection and current cache/refresh implementation.

- [ ] **Step 5: Document the dated snapshot and verify the phase.** Update current README counts/date, example model availability, price caveats, and GOAT API access without hardcoding subscription entitlements. Add an Unreleased catalog entry. Run `pnpm test -- tests/providers/command-code.test.ts`, `pnpm check`, and `pnpm pack:dry-run`. Expected: all pass; the fixture stays out of the package and source definitions are included.

- [ ] **Step 6: Review and commit the atomic phase.**

```sh
git add src/providers/command-code/models.ts tests/fixtures/command-code-models.json tests/providers/command-code.test.ts README.md CHANGELOG.md
# Include src/providers/command-code.ts only if its metadata lookup changed.
git commit -m "feat: refresh Command Code catalog and Flash capabilities"
```

**Phase acceptance:** The fixture and bundle agree, paid/free metadata is accounted for, Flash makes valid gateway requests, and existing online/offline/ZDR behavior passes regression checks.
<!-- phase:02:end -->

<!-- phase:03:start -->
## Phase 3 — Direct MiniMax models and reasoning replay

**Phase goal:** Ship static M3/M3.1 direct providers with correct pricing, output fields, effort controls, and tool-round-trip reasoning.

**Prerequisites:** Existing baseline only; phase 2's Command Code updates do not supply direct-provider metadata.  
**Usable result:** Both direct variants can run M3 or Flash before discovery exists, and an existing saved M3 conversation can continue tool use.  
**Spec:** Section 3 and Global constraints.

### Task 3: Update direct models and verify real-driver replay

**Files:**

- Modify: `src/providers/minimax-openai.ts`, `src/providers/minimax-openai/clean-stream.ts`
- Create: `src/providers/minimax-openai/models.ts`, `src/providers/minimax-openai/prepare-thinking-replay.ts`
- Test: `tests/providers/minimax-openai.test.ts`, `tests/providers/minimax-openai/clean-stream.test.ts`
- Create: `tests/providers/minimax-openai/prepare-thinking-replay.test.ts`, `tests/providers/minimax-openai/wire-replay.test.ts`
- Modify: `README.md`, `CHANGELOG.md`

**Interfaces:**

- Consumes: `registerMiniMax(pi: ExtensionAPI): void`, `normalizeToolResults<TContext extends Context>(context: TContext): TContext`, and the existing stream wrappers.
- Produces: `MINIMAX_MODELS: readonly ProviderModelConfig[]` from `models.ts`, containing Flash first and M3 second; clone the definitions when a mutable registration array is required.
- Produces: `prepareThinkingReplay<TContext extends Context>(context: TContext, model: Model<Api>): TContext` from `prepare-thinking-replay.ts`; returns an immutable same-model replay view and preserves the input's context type.
- Retains: `cleanStream(base: AssistantMessageEventStream): AssistantMessageEventStream` and existing external registration/stream signatures.

- [ ] **Step 1: Add failing registration, pricing, and effort tests.** Replace direct-model expectations with these values for both regions; assert neither M2.7 ID is present and region-specific keys/bases remain unchanged.

```ts
expect(config.models.map((model) => model.id)).toEqual(["MiniMax-M3.1-Flash", "MiniMax-M3"]);
expect(flash).toMatchObject({
  input: ["text", "image"], contextWindow: 1_000_000, maxTokens: 524_288,
  cost: { input: 0.15, output: 0.6, cacheRead: 0.015, cacheWrite: 0 },
  compat: { supportsReasoningEffort: true, maxTokensField: "max_completion_tokens" },
});
expect(m3.cost).toMatchObject({
  input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0,
  tiers: [{ inputTokensAbove: 512_000, input: 0.6, output: 2.4, cacheRead: 0.12, cacheWrite: 0 }],
});
```

Pin Flash's exact effort map to off/minimal null and the five identity levels. Capture real-driver requests for each supported level and omitted effort: assert `max_completion_tokens` is sent, `max_tokens` is absent, no `thinking: disabled` or effort `none` is sent, and omitted effort stays omitted. Use Pi's cost calculation to assert the M3 rate selection at 512,000 and 512,001 uncached input tokens with cache/output held at zero.

- [ ] **Step 2: Add failing cleanup/history and second-turn wire tests.** In helper tests, assert an unsigned same-model thinking block `" first \n"` becomes a text block `"<think> first \n</think>"`; original block order, tool IDs, and source context remain unchanged. Native signed thinking stays signed, and foreign provider/model history is untouched.

In cleanup tests, stream native chunks with leading/trailing whitespace and `thinkingSignature: "reasoning_content"`; assert the final thinking equals the concatenation exactly. Keep inline-duplicate suppression and interleaved tool/text boundaries covered.

In `wire-replay.test.ts`, use the installed real OpenAI API driver (not the existing mocked-driver module), mocked SSE fetch responses, and two provider `streamSimple` calls. Feed the first call's terminal message and two deliberately reversed tool results into the second call. Assert:

```ts
expect(secondBody.messages.find((message) => message.role === "assistant").reasoning_content)
  .toBe(" first \nsecond ");
expect(secondBody.messages.filter((message) => message.role === "tool").map((message) => message.tool_call_id))
  .toEqual(["tool-a", "tool-b"]);
expect(originalContext).toEqual(originalContextSnapshot);
```

Add a separate legacy M3 replay request expecting ordered `<think>` blocks in assistant `content` and preserved tool calls. Assert caller `onPayload`/`onResponse` hooks each run once and caller replacement payloads are respected. Cover image input, aborted streams, usage/finish events, empty-argument repair, and leaked-markup errors through the existing pipeline tests; add a wire assertion where driver serialization matters.

- [ ] **Step 3: Run focused tests and establish the expected failures.**

Run: `pnpm test -- tests/providers/minimax-openai.test.ts tests/providers/minimax-openai`  
Expected: failures expose absent Flash definitions, incorrect caps/pricing, missing helper/replay content, or altered native reasoning whitespace. Existing hardening tests remain part of this focused run.

- [ ] **Step 4: Implement the complete static-provider behavior.** Extract curated definitions to `models.ts` with the exact metadata, pricing tier, output field, and effort map above. Remove direct M2.7 definitions. Keep M3 automatic thinking and existing key/base registrations. Compose `prepareThinkingReplay(normalizeToolResults(context), model)` before calling the OpenAI driver with the builtin API tag; forward options and preserve wrappers.

Implement immutable legacy conversion only for matching provider/model OpenAI-compatible history; wrap unsigned thinking at its original position, preserve native signed blocks, and leave cross-model conversion to Pi. Adjust cleanup to retain reasoning whitespace/signatures and concatenate arriving fragments without separators, while preserving visible-text cleanup and duplicate suppression. Keep all changes necessary for static Flash inference in this phase; do not defer replay correctness to discovery.

- [ ] **Step 5: Document and verify the usable static providers.** Replace current direct model tables/quickstart with Flash and M3, documented standard/tiered pricing, supported effort levels, and output caps. Explain M2.7 removal from direct providers only; retain historical changelog entries. Add an Unreleased MiniMax entry. Run the focused command, `pnpm check`, and `pnpm pack:dry-run`. Expected: all pass, new helper/model source files are packaged, and the actual second-turn bodies preserve reasoning/tools.

- [ ] **Step 6: Review and commit the atomic phase.**

```sh
git add src/providers/minimax-openai.ts src/providers/minimax-openai/models.ts src/providers/minimax-openai/prepare-thinking-replay.ts src/providers/minimax-openai/clean-stream.ts tests/providers/minimax-openai.test.ts tests/providers/minimax-openai README.md CHANGELOG.md
git commit -m "feat: update MiniMax models and preserve reasoning replay"
```

**Phase acceptance:** Both static direct providers are usable independently of discovery; supported effort/cost/output settings and same-model reasoning/tool replay are proven through the real serializer.
<!-- phase:03:end -->

<!-- phase:04:start -->
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
<!-- phase:04:end -->

## Final handoff

Each phase may be reviewed and shipped independently in the listed order. Track completion in the corresponding phase file, preserving this parent. After phase 4, report commands/results, the catalog capture date, removal of direct M2.7, and any unperformed authenticated smoke tests. Publish or bump a release only under a separate release instruction.
