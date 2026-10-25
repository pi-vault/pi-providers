# Provider API Parity Specification

**Date:** 2026-10-25  
**Status:** Approved conversation decisions, recorded for implementation  
**Parent plan:** [Provider API Parity Implementation Plan](../plans/2026-10-25-provider-api-parity.md)

## Intent and success criteria

Update MiniMax, Command Code, and the TypeSafe decision tool against their current documented APIs. Preserve the existing Pi extension experience and credentials while correcting model availability, metadata, reasoning replay, and accepted question shapes. The audience is Pi users and an implementer working from this specification without the planning conversation.

Success means the direct MiniMax providers offer M3 and M3.1 Flash, never restore deprecated M2.7 entries, and retain reasoning through a tool round trip; Command Code has a dated, verified catalog and usable Flash controls; TypeSafe accepts the current text-question contract and respects the gateway's separate limit. Each implementation phase must leave a usable package with its own tests and documentation.

The user explicitly chose OpenAI transport for MiniMax, runtime availability refresh restricted to supported models, retention of TypeSafe's existing fallback policy, and removal of M2.7 from the direct MiniMax providers only. Command Code continues to reflect its own upstream availability.

## Global constraints

- Preserve provider IDs `minimax-openai`, `minimax-openai-cn`, and `command-code`, and tool name `typesafe_decide`.
- Preserve existing credential names, precedence, and login behavior.
- Keep MiniMax on OpenAI Chat Completions and preserve the custom stream-hardening pipeline.
- Keep the current dependencies, Node requirement `>=24.15.0`, and Pi development baseline `^0.87.1`.
- Leave StepFun behavior and registrations unchanged.
- Use mocked HTTP and frozen fixtures in automated tests; credentials and paid inference are not required for acceptance.
- Update README and an Unreleased changelog entry within each behavior phase; preserve historical release entries.
- Release numbering, publishing, and dependency upgrades are outside this work.

## 1. TypeSafe text-question compatibility

### Public interface

Retain `typesafe_decide({ state, questions })` and its existing result: `backend`, `model`, `answers`, raw token `usage`, and Pi usage. Continue direct HTTP requests rather than adding the SDK. Keep direct `jev-latest` at `https://api.typesafe.ai/v1/systemone` and fallback `typesafe/jev` at `https://api.commandcode.ai/provider/v1/systemone`.

`state` remains a JSON string, object, or array. Questions remain a nonempty map of Noul, Choice, and Score entries. Make TypeBox schemas, inferred parameter types, descriptions, and runtime validation agree:

| Field | Accepted contract |
| --- | --- |
| All `instructions` | Optional; string, JSON object, JSON array, or null |
| Noul `criteria` | Optional, null, or an object containing only `true` and/or `false` |
| Noul outcome descriptions | Optional string/object/array/null; without non-null instructions, at least one outcome must have a non-null description |
| Choice `criteria` | 1–255 named options; descriptions are string/object/array/null |
| Score `criteria` | 1–10 ordered levels; each level is a string/object/array, never null |

Follow the published OpenAPI schema's minimum of one Choice option and one Score level even where instructional prose recommends two. Preserve the distinction between omitted fields and explicit null; do not manufacture empty strings. Retain finite/cycle-free JSON checks, prototype-safe keys, and existing answer validation. A one-level Score answer has score `0` and probabilities `{ "0": 1 }`.

### Routing and gateway limits

Direct TypeSafe has no fixed question-count maximum; upstream token budgets remain authoritative. The normal documented budgets are 64K tokens across state plus all questions and 32K across state plus an individual question. Do not add local token estimation or opt into long context.

Before either path sends a Command Code System One POST, enforce a maximum of 100 questions. Direct requests with 101 or more questions may succeed. If direct access is absent, reject an oversized gateway request without fetching. If a retryable direct failure would require an oversized gateway request, report the sanitized direct failure and the gateway limit; do not send or split that request.

Preserve host TypeSafe credential precedence over nonblank `TYPESAFE_API_KEY`, followed by host-resolved Command Code fallback. Preserve the existing ten-second per-attempt timeout, one fallback at most, and current failover classification: direct `401`, `403`, `429`, `529`, other 5xx, transport failures, timeout, and malformed success responses may fall back. Other unsuccessful statuses and caller cancellation are terminal. This is backend failover, not an assertion that an authentication error is retryable against the same endpoint.

Never send `x-cmd-zdr` on System One requests. Direct credentials do not disable gateway fallback or imply ZDR. Preserve sanitized errors and current cost-reporting behavior; do not invent billing calculations.

## 2. Command Code catalog and Flash capability update

### Catalog source and policy

Use `https://api.commandcode.ai/provider/v1/models` for exact model IDs, names, context lengths, and endpoint declarations. A read during planning returned 93 chat models versus the existing 86-model snapshot. Those records did not contain pricing, modalities, reasoning flags, or output limits. The marketing model counts differed from the API; the API governs route and membership data.

Capture a fresh implementation-date response as `tests/fixtures/command-code-models.json`; record its capture date and source beside the bundled snapshot. Freeze assertions against that response rather than requiring a permanently fixed live count. Use the following planning delta as a cross-check, not a reason to reject newer upstream data:

| Added ID | Context | Advertised endpoints |
| --- | ---: | --- |
| `claude-haiku-5-5` | 1,000,000 | `/messages` |
| `moonshotai/Kimi-K3.1-Pro` | 1,048,576 | `/chat/completions`, `/responses` |
| `minimax/minimax-m3.1-flash` | 1,000,000 | `/chat/completions` |
| `ornith/ornith-1.5-122b` | 262,144 | `/chat/completions` |
| `Qwen/Qwen3.8-Max-Prime` | 1,000,000 | `/chat/completions`, `/responses` |
| `google/gemini-4-argon` | 1,000,000 | `/chat/completions`, `/responses` |
| `nvidia/nemotron-3.5-super-vl` | 262,144 | `/chat/completions`, `/responses` |
| `stealth/glyph-cluster:free` | 256,000 | `/chat/completions`, `/responses` |
| `reflection/beam:free` | 1,048,576 | `/chat/completions`, `/responses` |
| `inclusionai/ling-3.1-flash` | 262,144 | `/chat/completions` |
| `meta/muse-spark-open` | 1,048,576 | `/chat/completions`, `/responses` |
| `meta/muse-wonder-1.0` | 1,048,576 | `/chat/completions`, `/responses` |
| `mistral/mistral-large-4` | 524,288 | `/chat/completions`, `/responses` |

The six removed IDs were `inclusionai/ling-3.0-flash-sante:free`, `inclusionai/ling-3.1-flash:free`, `stealth/pixel-canary`, `stealth/space-bunny-alpha`, `xiaomi/mimo-v2.5`, and `xiaomi/mimo-v2.5-pro`.

Keep per-record endpoint lists in the bundled definitions; derive them from the captured response rather than guessing them from a family name. Keep current transport selection: advertised Messages first; GPT uses Responses when advertised; other models prefer Completions when advertised, otherwise Responses. System One-only entries stay outside the chat picker.

### Metadata and compatibility

Keep local metadata in the existing catalog module. Obtain newly bundled paid-model rates from official Command Code model/pricing pages and record dated source comments; retain tiered pricing and explain static estimates for UTC bands/promotions. Every new paid record must have sourced, nonzero input/output estimates; do not label a model free because pricing is missing. If a newly added paid record has no verifiable rate, stop phase 2 before shipping the refreshed snapshot and report the missing source. Do not invent a rate.

Use verified local input/reasoning metadata when the live record omits it, ahead of generic family defaults. Preserve explicit live metadata precedence and existing validation/cache behavior. Explicitly represent Flash as text/image, reasoning enabled, with only low/medium/high/xhigh/max effort levels. Its gateway ID is `minimax/minimax-m3.1-flash`; preserve its advertised Completions route, Completions `max_tokens` compatibility, and the gateway's 32,768 default output cap. Configure effort only for this model, without changing every open model's compatibility settings.

Free pricing applies only to officially confirmed current free IDs. Do not reuse free rates from the retired Ling alias for its new paid ID. Leave existing behavior for unknown future live models unchanged.

Keep `CMD_API_KEY` precedence over `COMMAND_CODE_API_KEY`, `/login command-code`, the catalog-only `CMD_MODELS_URL` override, four-hour refresh, offline restore, authoritative live membership, malformed-refresh retention, and request-only `CMD_ZDR` headers. Do not introduce a new cache format or migration for the snapshot refresh. GOAT API access is supported; the package does not filter to GOAT or calculate subscription entitlements.

## 3. Direct MiniMax models and reasoning continuity

### Registered models

Keep these regional registrations and attach identical curated model definitions:

| Provider | Base URL | Key |
| --- | --- | --- |
| `minimax-openai` | `https://api.minimax.io/v1` | `MINIMAX_API_KEY` |
| `minimax-openai-cn` | `https://api.minimaxi.com/v1` | `MINIMAX_CN_API_KEY` |

| Model | Input | Context | Maximum output | Input/output/cache read per 1M tokens |
| --- | --- | ---: | ---: | --- |
| `MiniMax-M3.1-Flash` | text, image | 1,000,000 | 524,288 | $0.15 / $0.60 / $0.015 |
| `MiniMax-M3` | text, image | 1,000,000 | 524,288 | $0.30 / $1.20 / $0.06 |

Cache writes remain zero. M3's standard pricing doubles above 512,000 input tokens: $0.60/$2.40/$0.12, represented with `ModelCost.tiers`. Pricing assumes the standard service tier; no priority service control is added.

Use `max_completion_tokens` for both direct models. Flash has reasoning enabled with `thinkingLevelMap` excluding `off` and `minimal` (null) and mapping low/medium/high/xhigh/max to those same strings; enable `supportsReasoningEffort`. Omitted effort sends no effort field and uses upstream's max default. M3 retains automatic thinking without advertising new depth or disable controls. Remove M2.7 and M2.7-highspeed from direct bundled definitions and current README tables; retain historical changelog entries and Command Code's upstream M2.7 records.

### Streaming and history

Continue delegating to Pi's OpenAI driver and passing through caller options, hooks, credentials, and cancellation. Normalize tool-result order before dispatch; retain hardening and cleanup around the returned stream.

Native `reasoning_content` must remain a thinking block with its `thinkingSignature`, exact reasoning whitespace, and no duplicate inline copy. Concatenate contiguous fragments in arrival order with no invented separator. Preserve ordered interleaved thinking segments around text/tool boundaries.

Before sending same-model history, convert unsigned legacy thinking blocks to text blocks containing `<think>${thinking}</think>` at the original position. Leave native signed reasoning to Pi's serializer. Apply this only to the same provider/model and OpenAI-compatible message history, using immutable context copies; leave cross-model histories to Pi. This preserves usable older saved sessions without changing displayed or stored transcript blocks.

Test a real Pi-driver serialization round trip with mocked SSE and a second request containing multiple tool results. A mocked driver that merely receives context is insufficient evidence for replay. Existing leaked-markup, tool-argument repair, and cancellation behavior must remain covered.

## 4. MiniMax runtime availability discovery

Extend the existing `ProviderConfig` registration with its supported `refreshModels(context)` callback; retain custom API IDs and stream registration. Keep discovery separate from inference and model metadata.

GET `{baseUrl}/models` using the effective host-resolved API-key credential in `Authorization: Bearer ...`. Global and China variants use their own URL, key, and provider-scoped cache. China path parity is an explicit assumption; failure there retains the fallback catalog and never switches regions.

Validate an object with `object: "list"` and a `data` array of records having nonblank, unique IDs. Ignore other documented fields. An empty array is valid. Intersect IDs with the curated M3/M3.1 definitions and retain curated order. Unknown, deprecated, and non-chat IDs do not gain fabricated metadata. A valid result containing no supported IDs authoritatively exposes zero models.

Persist successful full model records and `checkedAt` through `context.publish`; never persist credentials. During offline restore, select only matching-provider known IDs and rebuild their records from the current curated definitions. Distinguish absent cache from a successfully persisted empty catalog. Reject incompatible cached records rather than trusting old API/base URL/cost fields.

On first run, use the bundled two-model baseline until discovery succeeds. Offline, fresh (under four hours), or unconfigured calls perform no fetch. A forced online refresh bypasses freshness. Combine caller cancellation with a ten-second request timeout. Malformed responses, unsuccessful HTTP statuses, and timeouts retain the prior successful catalog or the initial baseline and surface a sanitized refresh error. Cancellation does not publish a candidate. Failed first-run checks do not write fake empty successful catalogs. The next permitted refresh can retry a failed check.

Use generation-checked `context.publish` before exposing a candidate. A false result, an aborted signal, or persistence failure must not update provider-private state or return a candidate for the host to publish. Retain Pi's host-managed storage; introduce no background timer, external cache file, or credential-bearing catalog URL.

## Phase boundaries and acceptance

1. TypeSafe contract parity: usable text decisions with backend-specific request counts.
2. Command Code catalog refresh: usable updated offline catalog and Flash inference through existing transport.
3. MiniMax model/replay update: usable static M3/M3.1 providers with multi-turn tool continuity.
4. MiniMax discovery: the phase-3 providers gain safe online/offline availability updates.

Phases 1 and 2 are independent; phase 3 builds on the existing direct provider; phase 4 requires phase 3's curated model module. This order moves from localized validation to catalog conversion, then stream serialization, then authenticated persistent state. Documentation and regression tests ship with each phase. At every phase boundary run `pnpm check` and `pnpm pack:dry-run`. Authenticated paid smoke tests are optional and require separately available credentials.

Planning baseline: 9 test files / 187 tests passed before implementation. No claim is made that these tests already exercise the new behaviors.

## Non-goals

No Anthropic transport migration, SDK installation, TypeSafe image/Box/long-context features, model pinning or backend selector, MiniMax video/file APIs, priority-tier UI, account-specific billing enforcement, StepFun changes, or publication. The parent plan is a frozen handoff; phase plans are verbatim phase extracts with progress tracked in their copies.

## Evidence and precedence

The approved conversation defines scope. The current API schema defines accepted wire values where introductory examples differ. Live catalog responses define availability/routes; dated official pricing and capability pages define missing metadata. Recheck mutable catalog data when implementing phase 2, then freeze it for tests.

- [Command Code Provider API](https://commandcode.ai/docs/provider): transports, discovery, System One gateway limit, authentication, and ZDR.
- [Command Code GOAT](https://commandcode.ai/docs/plans/goat): API eligibility, model pricing, and upstream plan limits.
- [MiniMax guides](https://platform.minimax.io/docs/guides/) and [API overview](https://platform.minimax.io/docs/api-reference/api-overview): model context and supported integration formats.
- [MiniMax OpenAI compatibility](https://platform.minimax.io/docs/api-reference/text-openai-api) and [tool use](https://platform.minimax.io/docs/guides/text-m3-function-call): effort and reasoning replay.
- [MiniMax Create Chat Completion](https://platform.minimax.io/docs/api-reference/text-chat-openai): generation limit of 524,288 and `max_completion_tokens`.
- [MiniMax pricing](https://platform.minimax.io/docs/pricing/overview): standard prices and M3 input tiers.
- [MiniMax List Models](https://platform.minimax.io/docs/api-reference/models/openai/list-models): authenticated availability response; its illustrative older IDs do not override the approved support list.
- [TypeSafe quickstart](https://docs.typesafe.ai/introduction/quickstart), [System One schema](https://docs.typesafe.ai/api/system-one.md), [models](https://docs.typesafe.ai/models), and [request rules](https://docs.typesafe.ai/api/errors): text primitives, nullable fields, cardinalities, context budgets, and HTTP errors.
