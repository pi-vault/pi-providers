# Phase 2 — Command Code catalog and Flash controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementation requires a separate user request.

**Goal:** Ship a dated, verified Command Code bundle and working MiniMax M3.1 Flash image/reasoning metadata and effort controls through the existing gateway transport.

**Architecture:** Refresh the existing catalog module with explicit per-record endpoints and an ID-keyed capability overlay shared by bundled and live conversion. Keep the provider factory, Pi drivers, discovery parser, and cache lifecycle. Apply Flash effort compatibility only to its Completions model.

**Tech Stack:** TypeScript ESM, Pi AI/coding-agent `^0.87.1`, Vitest, native fetch/AbortSignal, pnpm, Biome; Node `>=24.15.0`. No new dependencies.

**Spec:** [Provider API Parity Specification](../specs/2026-10-25-provider-api-parity-design.md), section 2 and Global constraints.

**Parent:** [Provider API Parity Implementation Plan](2026-10-25-provider-api-parity.md). This revision supersedes the original phase-2 extract for execution. The approved specification remains authoritative; leave the frozen parent, specification, and other phase plans unchanged.

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

**Verdict:** The original extract needed revision before implementation. This revision supplies the missing decisions; implementation can proceed after its evidence preflight succeeds.

Fresh builder review of this revision found nothing important left unanswered, including Pi option contracts, metadata precedence, donor isolation, streamed usage, and authoritative cache behavior.

1. The copied architecture included TypeSafe and direct MiniMax discovery changes. Neither belongs in this phase; phase 1 is already merged in `fdac86e`.
2. The original plan delegated all pricing/capability research to implementation. The evidence below resolves the 13 additions, paid Ling alias, Haiku context tier, exact Flash cache rate, and capability defaults without relying on a future Pi donor.
3. `modelFromCatalogRecord` currently inherits thinking maps only for Messages and disables effort for every Completions model. Specify a local overlay, field precedence, a Flash-only compatibility copy, and supported-level assertions.
4. Existing `captureRequest` deliberately returns HTTP 400. It proves headers/routes, but cannot prove Flash inference succeeds or terminal usage survives. Add a successful mocked SSE path through both Pi entry points and through refreshed provider state.
5. `pnpm test -- tests/providers/command-code.test.ts` ran all 9 files / 214 tests here. Use `pnpm exec vitest run tests/providers/command-code.test.ts` for the focused check: 1 file / 73 baseline tests.

Repository baseline: clean tree at `fdac86e90d23597fda2d746d1cfcaa287a1ee417`, branch `20261025-provider-api-parity-phase-02-command-code`; Node `v24.21.0`, pnpm `12.9.1`. `pnpm check` exited 0 with 214 tests passing. Biome reported 13 existing `noNonNullAssertion` warnings in MiniMax source/tests; do not expand this phase to fix them. `pnpm pack:dry-run` exited 0 and excluded tests/plans.

The reference checkout `/Users/lanh/Developer/pi-packages/pi` is at `d5b3de22d0e24a3e9c38a9410d3329b099717283` and reports Pi AI `1.4.0`; this repository installs `0.87.1`. Inspect its `packages/ai/src/api/openai-completions.ts`, `packages/ai/src/api/simple-options.ts`, `packages/ai/src/models.ts`, and `packages/ai/src/compat.ts` for the host flow. Compile and test against the installed `node_modules/@earendil-works/pi-ai/dist/` equivalents, not the newer checkout. Both expose the relevant map/effort behavior; no upgrade is required.

Installed Pi distinguishes `provider.stream(..., { reasoningEffort })` from `provider.streamSimple(..., { reasoning })`. The simple path clamps unsupported levels using `getSupportedThinkingLevels`/`clampThinkingLevel`; the raw Completions path uses a nullish fallback and does not reject arbitrary unsupported efforts. Test the supported values and normal host path; do not claim a null map validates raw caller options. Omitted reasoning sends no effort and preserves upstream's default; `minimal` on the simple path clamps to `low`. Only the simple path defaults `maxTokens` from model metadata; raw-stream tests must pass it explicitly.

A read-only probe with a synthetic in-memory Flash model and mocked SSE passed 13 cases against installed Pi: all five efforts plus omission through each entry point, and simple-path `minimal`→`low`. It confirmed the proposed map/compatibility settings, `max_tokens`, usage inclusion, and final 8 input / 3 cached / 7 output tokens. This validates Pi's contract; repository Flash implementation/tests are still outstanding.

### Evidence and precedence

- [Provider API](https://commandcode.ai/docs/provider): exact advertised endpoints govern routing. GOAT can use the API; membership does not establish account entitlement. Keep System One outside chat conversion even though this particular capture contains only chat records.
- [Public models endpoint](https://api.commandcode.ai/provider/v1/models): unauthenticated review capture returned 93 records, all chat-capable: 11 Messages-only, 10 Completions-only, 72 Completions+Responses. It has IDs/names/context/endpoints, without price, input, reasoning, or output-limit fields. The 13-add/6-remove delta matches spec section 2. Exact response bytes captured during review have SHA-256 `3af4f8e4ceb9e9c78c2c509f3d98589502e2065ab4ec1ccde1afdbdf1320c356`; a later capture may differ.
- [GOAT model table](https://commandcode.ai/docs/plans/goat): its embedded public model data supplies precise `id`, `vision`, `reasoning`, costs, and `tiers` used below. Use its actual ID fields to join metadata, never its rounded model counts or display names. Marketing pages sometimes lowercase IDs; preserve the API's exact case. Do not ship a runtime HTML scraper.
- [Pricing & Limits](https://commandcode.ai/docs/resources/pricing-limits): cross-check cache-write rates and current free offers. Its rendered table also includes free Flash/Ornith aliases absent from this API capture; do not add them or assign their prices to the paid API IDs.
- [MiniMax OpenAI compatibility](https://platform.minimax.io/docs/api-reference/text-openai-api): Flash accepts `low`, `medium`, `high`, `xhigh`, `max`; omission defaults to `max`; disabling thinking/`none` is unsupported. Streaming usage requires `stream_options.include_usage`. The gateway keeps its existing `max_tokens` compatibility and 32,768 default output ceiling; direct MiniMax's larger limit is not a gateway limit.
- [MiniMax guides](https://platform.minimax.io/docs/guides/) and [API overview](https://platform.minimax.io/docs/api-reference/api-overview): confirm multimodal model scope. Direct provider definitions, replay hardening, regional discovery, and video/file APIs remain phases 3–4 or non-goals.
- [TypeSafe quickstart](https://docs.typesafe.ai/introduction/quickstart): Jev returns typed decisions through System One. Phase 1 owns its contract and limits; add no SDK, tool changes, or selectable Jev chat model here.

### Dated metadata decisions

USD per 1M tokens. All 13 additions have `reasoning: true`. `image` means `input: ["text", "image"]`; otherwise `input: ["text"]`. Values come from the official GOAT page's embedded model data, checked against the linked individual pages and pricing table on 2026-10-25. A missing cache-write rate stays the existing zero estimate; it does not imply free inference.

| Exact API ID                   | Input / output / cache read / cache write | Image | Individual price source                                         |
| ------------------------------ | ----------------------------------------- | ----- | --------------------------------------------------------------- |
| `claude-haiku-5-5`             | 0.10 / 0.50 / 0.01 / 0.125                | yes   | [Haiku](https://commandcode.ai/models/claude-haiku-5-5)         |
| `moonshotai/Kimi-K3.1-Pro`     | 2 / 10 / 0.20 / 0                         | yes   | [Kimi](https://commandcode.ai/models/kimi-k3-1-pro)             |
| `minimax/minimax-m3.1-flash`   | 0.15 / 0.60 / 0.015 / 0                   | yes   | [Flash](https://commandcode.ai/models/minimax-m3-1-flash)       |
| `ornith/ornith-1.5-122b`       | 0.16 / 0.64 / 0.02 / 0                    | yes   | [Ornith](https://commandcode.ai/models/ornith-1-5-122b)         |
| `Qwen/Qwen3.8-Max-Prime`       | 4 / 12 / 0.50 / 5                         | yes   | [Qwen](https://commandcode.ai/models/qwen3-8-max-prime)         |
| `google/gemini-4-argon`        | 2 / 10 / 0.10 / 0                         | yes   | [Gemini](https://commandcode.ai/models/gemini-4-argon)          |
| `nvidia/nemotron-3.5-super-vl` | 0.20 / 0.50 / 0.04 / 0                    | yes   | [Nemotron](https://commandcode.ai/models/nemotron-3-5-super-vl) |
| `stealth/glyph-cluster:free`   | 0 / 0 / 0 / 0                             | no    | [Current free offers](https://commandcode.ai/docs/provider)     |
| `reflection/beam:free`         | 0 / 0 / 0 / 0                             | no    | [Current free offers](https://commandcode.ai/docs/provider)     |
| `inclusionai/ling-3.1-flash`   | 0.30 / 0.90 / 0.06 / 0                    | no    | [Ling](https://commandcode.ai/models/ling-3-1-flash)            |
| `meta/muse-spark-open`         | 1.25 / 4.25 / 0.15 / 0                    | yes   | [Muse Spark](https://commandcode.ai/models/muse-spark-open)     |
| `meta/muse-wonder-1.0`         | 4 / 20 / 0.20 / 0                         | yes   | [Muse Wonder](https://commandcode.ai/models/muse-wonder-1-0)    |
| `mistral/mistral-large-4`      | 1.36 / 4.18 / 0.14 / 0                    | yes   | [Mistral](https://commandcode.ai/models/mistral-large-4)        |

Haiku additionally has `cost.tiers: [{ inputTokensAbove: 100_000, input: 0.50, output: 2.50, cacheRead: 0.05, cacheWrite: 0.625 }]`. The [Haiku page](https://commandcode.ai/models/claude-haiku-5-5) confirms the >100K band; the GOAT data includes its cache-write rate. Flash's individual page rounds cache read to `$0.01`; use the more precise `$0.015` in the official table/data. Retained `claude-sonnet-5-5` now has cache read `0.10`, versus the September bundle's `0.20`; update that sourced estimate during this refresh. Preserve existing tiers and UTC-band/promotional comments unless fresh exact-ID evidence changes them.

Only `poolside/laguna-s-2.1-free`, `stealth/glyph-cluster:free`, and `reflection/beam:free` have free prices in the captured chat set. Remove retired Ling/stealth/MiMo records and their unused cost entries. Paid Ling must never inherit either retired `:free` alias's zero costs. Retain `MiniMaxAI/MiniMax-M2.7` because this gateway still advertises it.

## File map and boundaries

| File                                                  | Responsibility                                                                                       |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/providers/command-code/models.ts`                | Explicit captured records, dated local costs/capabilities, shared conversion, Flash-only map/compat  |
| `tests/fixtures/command-code-models.json` (new)       | Exact unauthenticated JSON response; no wrapper or hand edits                                        |
| `tests/providers/command-code.test.ts`                | Fixture parity, metadata precedence, real Pi request/SSE and existing cache/auth/routing regressions |
| `tests/providers/command-code-metadata.test.ts` (new) | Local metadata conversion with the builtin donor registry explicitly empty                           |
| `README.md`, `CHANGELOG.md`                           | Current snapshot/Flash documentation and Unreleased entry                                            |

`src/providers/command-code.ts` needs no production edit: its parser already preserves optional live fields and calls `modelFromCatalogRecord` for each supported chat record. Do not extract shared direct MiniMax metadata or modify its parser/cache/version/refresh policy. Successful live catalogs and persisted catalogs keep their existing authority; the refreshed bundle does not backfill removed IDs. Offline cached full records remain authoritative until a successful refresh; this phase does not rehydrate them with new local fields or promise new controls for old cached Flash records.

## Review Focus

- Metadata-poor live additions need the same local capabilities/costs as bundled records, even without a matching Pi donor.
- Explicit live `false`, text-only input, zero cost, output cap, name/context, and endpoints must override local metadata; unknown live IDs keep existing defaults.
- New paid aliases must have sourced nonzero rates, retain applicable price tiers, and remain separate from retired free aliases.
- Flash must expose only five supported thinking levels, send their exact effort strings through the real driver, and preserve successful streamed usage.
- Snapshot changes must preserve endpoint selection, authoritative live removals/offline restore, four-hour freshness, credentials, and request-only ZDR behavior.

## Task 2: Refresh the catalog and verify usable Flash inference

**Files:** Modify the catalog module, existing Command Code tests, README, and changelog; create the fixture and isolated donor test listed above.

**Interfaces:**

- Retain exports `CommandCodeCatalogRecord`, `COMMAND_CODE_CATALOG`, `commandCodeModels`, `modelFromCatalogRecord(record: CommandCodeCatalogRecord): CommandCodeModel`, `COMMAND_CODE_BASE_URL`, and `COMMAND_CODE_FALLBACK_MAX_TOKENS`.
- Add internal `COMMAND_CAPABILITIES` in `models.ts`: `Readonly<Partial<Record<string, { input: ("text" | "image")[]; reasoning: boolean }>>>`, populated for the 13 verified additions. Keep costs in `COMMAND_COSTS`; retain donor/family fallbacks for other IDs.
- Keep `CommandCodeCatalogRecord` unchanged. Resolve input/reasoning as explicit record field → local ID metadata → donor → existing family/default. Resolve cost as explicit record cost → dated exact-ID `COMMAND_COSTS` → existing zero fallback. Never merge partial live pricing differently from today's parser.
- Name/context/endpoints always come from the supplied record; `maxTokens = Math.min(record.maxOutputTokens ?? 32_768, record.contextWindow)`. Do not copy direct MiniMax output limits or donor max output into the gateway.
- Retain transport selection: Messages first; otherwise GPT uses Responses if advertised; other models prefer Completions, then Responses. Unsupported endpoint-only records are filtered by the existing live parser.
- Only when the ID is `minimax/minimax-m3.1-flash`, the selected API is `openai-completions`, and effective reasoning is true, attach `{ off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }` as `thinkingLevelMap` and `{ ...OPENAI_COMPAT, supportsReasoningEffort: true }` as compat. Do not mutate the shared compatibility object. An explicit live `reasoning: false` suppresses these controls. Keep Messages donor behavior and Responses conversion unchanged.

- [ ] **Step 1: Freeze implementation-date evidence and verify the price gate.**

Fetch without credentials into a temporary file, validate `object: "list"`, unique nonblank IDs, names, positive integral contexts and endpoint arrays, then copy the successful response bytes to the fixture. A normal User-Agent avoids the default-client 403 encountered during earlier planning:

```sh
curl --fail --silent --show-error -A 'Mozilla/5.0' \
  https://api.commandcode.ai/provider/v1/models \
  -o /tmp/command-code-models.json
```

Record capture date/source beside the production snapshot. Recheck the metadata table against official exact-ID evidence on the same date. The review's 93/13/6 counts and spec delta are cross-checks; if upstream changes, update fixture/definitions/docs/tests consistently. Resolve any new paid ID's nonzero rates before proceeding. Stop before shipping if a rate is unverifiable; do not omit it from fixture parity, invent a rate, or apply a similarly named free model's prices. No authenticated or paid request is needed.

- [ ] **Step 2: Add failing fixture and pricing tests.**

Load the JSON fixture using a top-level import with `{ type: "json" }`. Independently select records advertising any of `/messages`, `/chat/completions`, `/responses`, then project `id`, `name`, `context_length`→`contextWindow`, `supported_endpoints`→`supportedEndpoints`. Compare sorted complete projections with `COMMAND_CODE_CATALOG`, not just counts. Replace hardcoded September assertions in both `bundles the captured Command Code catalog` and `creates a provider with all API families`.

Add named cases `uses captured endpoints rather than inferred endpoint families`, `keeps paid Ling separate from retired free aliases`, and `preserves Haiku context pricing tiers`. Assert the captured 13 additions/six removals, new exact costs from the table, Haiku's threshold/rates, retained M2.7, and the three-ID free allowlist. Refresh retained Sonnet 5.5 cache-read expectations to `0.10`; preserve unrelated behavior assertions. Every bundled paid ID needs finite, nonzero input/output estimates. Add a synthetic System One-only record to the existing mixed-catalog refresh fixture and assert it never enters provider models or persistence; the real capture alone cannot exercise exclusion.

- [ ] **Step 3: Add failing shared-conversion and live-precedence tests.**

Use `modelFromCatalogRecord` directly and the existing `createRefreshModels` harness with mocked `globalThis.fetch`. Refresh the captured fixture through `models.refresh({ providers: ["command-code"], force: true })`; compare exposed IDs with fixture chat IDs and assert new model metadata is persisted.

In `tests/providers/command-code-metadata.test.ts`, add `uses verified capabilities without a Pi donor`. Use a top-level `vi.mock("@earendil-works/pi-ai/providers/all", () => ({ getBuiltinProviders: () => [], getBuiltinModels: () => [] }))` and a top-level import of `modelFromCatalogRecord`; Vitest's file isolation keeps existing donor tests unaffected. Assert all 13 local input/reasoning values and exact paid costs. Do not depend on whichever donors a future Pi install happens to contain.

Add `lets valid live metadata override local capabilities` for the exact Flash ID with a different name/context, `reasoning: false`, text-only modalities, explicit zero pricing, and `max_output_tokens: 1234`. Assert those values win, five-level controls are absent, and the effective cap is 1234. A second valid payload changing advertised endpoints to Responses-only must select Responses, without Flash Completions compatibility. Check `modalities: {}` retains the local fallback. Keep existing unknown-model defaults and malformed metadata rejection unchanged.

For the ordinary bundled and metadata-poor live Flash model, assert:

```ts
expect(flash).toMatchObject({
  api: "openai-completions",
  input: ["text", "image"],
  reasoning: true,
  maxTokens: 32_768,
  cost: { input: 0.15, output: 0.6, cacheRead: 0.015, cacheWrite: 0 },
  compat: { supportsReasoningEffort: true, maxTokensField: "max_tokens" },
});
expect(flash.thinkingLevelMap).toEqual({
  off: null,
  minimal: null,
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
});
expect(getSupportedThinkingLevels(flash)).toEqual([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
```

- [ ] **Step 4: Add failing successful Pi-driver Flash tests.**

Keep the existing error-response `captureRequest` for header tests. Add a focused successful SSE helper in the test file, with typed `fetch` capturing a real `Request`, status 200 and `content-type: text/event-stream`. Emit native `reasoning_content`, answer text, a `stop` finish chunk, a final `choices: []` usage chunk, then `[DONE]`. Use usage `{ prompt_tokens: 11, completion_tokens: 7, total_tokens: 18, prompt_tokens_details: { cached_tokens: 3 } }` and assert result input `8`, cacheRead `3`, output `7`, totalTokens `18`, thinking/text content and terminal `stopReason: "stop"`. Consume `.result()` so parse errors cannot masquerade as a captured request.

Exercise both bundled Flash and the model read from successful host refresh. For `provider.stream`, pass `reasoningEffort` for each low/medium/high/xhigh/max value and explicit `maxTokens: flash.maxTokens`. For `provider.streamSimple`, pass `reasoning` for the same values and leave `maxTokens` omitted to prove the model fallback; also test `minimal`→`low` and omitted reasoning→no effort property. Use explicit fake `apiKey`, injected fetch and `maxRetries: 0`; mock catalog GET separately from inference. No Pi driver mocks.

Assert the wire URL `https://api.commandcode.ai/provider/v1/chat/completions`, exact gateway model ID, requested `reasoning_effort`, `max_tokens: 32768`, absent `max_completion_tokens`, and `stream_options.include_usage: true`. Include an image in one normalized user context and assert it reaches an `image_url` content part. Ensure a second non-Flash Completions model still has `supportsReasoningEffort: false` and sends no effort even when requested. Retain existing authentication/ZDR tests for all three APIs.

- [ ] **Step 5: Run the focused tests and confirm the intended failures.**

Run `pnpm exec vitest run tests/providers/command-code.test.ts tests/providers/command-code-metadata.test.ts`. Expected: new assertions fail because the bundle is still September's, local addition metadata/prices are absent, and Flash controls are missing. Ensure imports, mocks and SSE framing work; a missing-module error is not evidence of the desired failing behavior.

- [ ] **Step 6: Implement the catalog changes in the existing module.**

Replace snapshot membership/names/contexts with the fixture projection, and put each captured `supportedEndpoints` list directly in its record. Remove obsolete `MESSAGES_MODEL_IDS`/`CHAT_ONLY_MODEL_IDS` endpoint synthesis. Keep `COMMAND_CODE_CATALOG`'s readonly record-array export and literal ID union for cost typing. Populate sourced addition costs and capabilities, Haiku's tier, and the Sonnet cache-read correction; delete cost entries made obsolete by removed records. Add dated source comments. Apply the precedence and Flash-only conversion rules from Interfaces. No transport wrapper, stream hardening, new cache version, direct-provider metadata extraction, or discovery changes.

- [ ] **Step 7: Verify focused behavior and unchanged cache contracts.**

Run `pnpm exec vitest run tests/providers/command-code.test.ts tests/providers/command-code-metadata.test.ts`. Expected: all pass, including malformed catalog retention, credential precedence/login registration, Responses/Messages/Completions routing, catalog-only override, freshness, offline restore, authoritative live removal, and ZDR. Keep a regression that a cached authoritative catalog missing Flash does not gain it from the refreshed bundle, then a successful refreshed Flash record gains its local controls. Reuse the existing offline/authoritative harness; keep cache version `1` and stored fields unchanged.

- [ ] **Step 8: Document the current behavior and run package checks.**

Update current README provider/technical notes with the actual capture date/count, exact Flash ID, text/image support, five supported efforts, omitted-effort default and gateway 32,768 output fallback. Describe missing live metadata using the new local-ID layer before donor/family defaults. Add GOAT API access with a link to current eligibility/limits; calculate no subscription entitlements. Keep dated release-history sections accurate to their release rather than rewriting old snapshot counts. Add an Unreleased changelog entry covering catalog additions/removals and Flash controls. Leave direct MiniMax/TypeSafe/StepFun documentation alone.

Run `pnpm check` and `pnpm pack:dry-run`. Expected: exit 0, no new warnings, all tests pass; the 13 recorded MiniMax warnings remain outside scope. Inspect the package list: source definitions included, test fixture/plans/tests excluded. A paid smoke test is optional and cannot replace mocked acceptance.

- [ ] **Step 9: Review the atomic implementation diff and commit.**

```sh
git diff --check
git add src/providers/command-code/models.ts tests/fixtures/command-code-models.json tests/providers/command-code.test.ts tests/providers/command-code-metadata.test.ts README.md CHANGELOG.md
git commit -m "feat: refresh Command Code catalog and Flash capabilities"
```

No other production files should change. Commit only as part of an authorized implementation workflow.

**Phase acceptance:** Fixture and bundle agree on every supported chat record and endpoint; all new paid rates and local capabilities have dated exact-ID evidence; Flash works through real Pi request serialization and successful mocked SSE for bundled/live records; existing discovery, persistence, credentials and ZDR behavior remains intact. Phases 3–4 are not prerequisites.
